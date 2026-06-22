import { auth, db } from '../firebase.js';
import { ADMIN_PERMS, VIEWER_PERMS } from '../utils/perms.js';

// 短 TTL のユーザープロフィールキャッシュ (Cloud Run インスタンス内、60 秒)。
// 集計 / options / columns / config など API が多発するとリクエストごとの
// users/{uid} 読み込みが Firestore のコストになるので、ここで間引く。
// インスタンス内のみなので別インスタンスで作られた変更が即時反映されないが、
// 60 秒以内に admin 権限変更が即座に反映される必要は通常ない。
const USER_CACHE_TTL_MS = 60 * 1000;
const userCache = new Map();  // uid -> { user, expireAt }
function userCacheGet(uid) {
  const e = userCache.get(uid);
  if (!e) return null;
  if (Date.now() > e.expireAt) { userCache.delete(uid); return null; }
  return e.user;
}
function userCacheSet(uid, user) {
  userCache.set(uid, { user, expireAt: Date.now() + USER_CACHE_TTL_MS });
}
export function invalidateUserCache(uid) {
  if (uid) userCache.delete(uid);
  else userCache.clear();
}

// Verify Firebase ID token from Authorization: Bearer <token>
export async function authMiddleware(c, next) {
  const header = c.req.header('Authorization') || '';
  const m = /^Bearer\s+(.+)$/.exec(header);
  if (!m) return c.json({ error: 'Missing Authorization header' }, 401);

  let decoded;
  try {
    decoded = await auth.verifyIdToken(m[1]);
  } catch (e) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  // Google SSO のみを受け入れる (email/password 等は UI から廃止済み)。
  // 仮に password / その他プロバイダで Auth を作っても、ここで弾く。
  if (decoded.firebase?.sign_in_provider && decoded.firebase.sign_in_provider !== 'google.com') {
    return c.json({
      error: 'Google アカウントでログインしてください。',
      code: 'unsupported_provider',
    }, 403);
  }

  // 60 秒キャッシュ: 同 uid のリクエスト連発で Firestore を毎回叩かない。
  // 新規作成 / 移行 / patch のパスはキャッシュ更新後に通常通り走る。
  const cachedUser = userCacheGet(decoded.uid);
  if (cachedUser) {
    c.set('user', cachedUser);
    c.set('uid', decoded.uid);
    await next();
    return;
  }

  // Load/create user profile in Firestore
  const userRef = db.collection('users').doc(decoded.uid);
  const snap = await userRef.get();
  let user;
  if (!snap.exists) {
    const existing = await db.collection('users').limit(1).get();
    const isFirstUser = existing.empty;

    if (isFirstUser) {
      // Bootstrap: first user becomes admin
      user = {
        uid: decoded.uid,
        email: decoded.email || '',
        name: decoded.name || decoded.email?.split('@')[0] || 'User',
        photoURL: decoded.picture || '',
        isAdmin: true,
        perms: { ...ADMIN_PERMS },
        createdAt: new Date().toISOString(),
      };
      await userRef.set(user);
    } else {
      // admin が事前登録した pending_* doc にメール一致するものがあれば、新 UID へ移行。
      const email = decoded.email || '';
      if (email) {
        const byEmail = await db.collection('users').where('email', '==', email).limit(1).get();
        if (!byEmail.empty) {
          const prev = byEmail.docs[0];
          user = { ...prev.data(), uid: decoded.uid, photoURL: decoded.picture || prev.data().photoURL || '' };
          await userRef.set(user);
          await prev.ref.delete();
          userCacheSet(decoded.uid, user);
          c.set('user', user);
          c.set('uid', decoded.uid);
          await next();
          return;
        }
      }
      // Not pre-registered: reject sign-in and clean up Firebase Auth entry
      try { await auth.deleteUser(decoded.uid); } catch (e) { /* best effort */ }
      return c.json({
        error: 'このアカウントはこのダッシュボードにアクセス許可されていません。管理者にお問い合わせください。',
        code: 'not_registered',
      }, 403);
    }
  } else {
    user = snap.data();
    // Refresh email/photo from token, but keep manually-set name
    const patch = {};
    if (decoded.email && decoded.email !== user.email) patch.email = decoded.email;
    if (decoded.picture && decoded.picture !== user.photoURL) patch.photoURL = decoded.picture;
    if (Object.keys(patch).length) {
      await userRef.update(patch);
      Object.assign(user, patch);
    }
  }

  userCacheSet(decoded.uid, user);
  c.set('user', user);
  c.set('uid', decoded.uid);
  await next();
}

export async function adminOnly(c, next) {
  const user = c.get('user');
  if (!user?.isAdmin) return c.json({ error: 'Forbidden' }, 403);
  await next();
}

export function requirePerm(key) {
  return async (c, next) => {
    const user = c.get('user');
    if (!user?.perms?.[key] && !user?.isAdmin) {
      return c.json({ error: `Missing permission: ${key}` }, 403);
    }
    await next();
  };
}

// ひとつでも key を持っていれば通す
export function requireAnyPerm(...keys) {
  return async (c, next) => {
    const user = c.get('user');
    if (user?.isAdmin || keys.some(k => user?.perms?.[k])) {
      await next();
      return;
    }
    return c.json({ error: `Missing permission: one of ${keys.join(', ')}` }, 403);
  };
}

// このユーザーが指定 sid にアクセスできるかを判定。
// - admin: 常に可
// - allowedGroupIds が空: 全員可
// - 上記以外: user.groupId が allowedGroupIds に含まれていれば可
export async function canAccessSource(user, sid) {
  if (!user) return false;
  if (user.isAdmin) return true;
  const snap = await db.collection('sources').doc(sid).get();
  if (!snap.exists) return false;
  const source = snap.data();
  const allowed = source.allowedGroupIds || [];
  if (allowed.length === 0 && source.isPublic !== false) return true;
  if (allowed.length === 0) return false;
  return !!(user.groupId && allowed.includes(user.groupId));
}

// :sid パラメータを持つルートで source visibility を確認するミドルウェア
export function requireSourceAccess() {
  return async (c, next) => {
    const user = c.get('user');
    const sid = c.req.param('sid');
    if (!sid) return c.json({ error: 'sid required' }, 400);
    const ok = await canAccessSource(user, sid);
    if (!ok) return c.json({ error: 'Source not accessible' }, 403);
    await next();
  };
}
