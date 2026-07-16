import { auth, db } from '../firebase.js';
import { ADMIN_PERMS, normalizePresetPerms } from '../utils/perms.js';
import { sourceVisible } from '../utils/sourceVisibility.js';
import { readTtlMs } from '../utils/env.js';

// 短 TTL のユーザープロフィールキャッシュ (Cloud Run インスタンス内)。
// 集計 / options / columns / config など API が多発するとリクエストごとの
// users/{uid} 読み込みが Firestore のコストになるので、ここで間引く。
//
// ■ 既知の仕様: 権限失効が最大 TTL 秒ぶん遅れる
//   キャッシュは Cloud Run インスタンスごとのメモリ上にあり、共有されていない。
//   invalidateUserCache() は「そのリクエストを処理したインスタンス」しか消せないため、
//   複数インスタンスが起動している場合、権限の剥奪・管理者降格・グループ変更が
//   他インスタンスへ伝わるまで最大 TTL 秒かかる。
//   つまり「権限を外した直後の最大 TTL 秒間、まだ旧権限で操作できる」ことがある。
//
//   これは許容している既知のリスク。即時失効が必要になったら、共有キャッシュ
//   (Redis 等)、users doc の permsVersion をトークンに載せる、Pub/Sub による
//   インスタンス間の無効化通知、のいずれかを検討すること。
//   なお「削除」は Firestore doc 自体が消えるため、キャッシュが切れた時点で
//   認証そのものが通らなくなる (not_registered)。
//
//   USER_CACHE_TTL_SECONDS=0 でキャッシュを完全に無効化できる (毎回 Firestore を読む)。
const USER_CACHE_TTL_MS = readTtlMs('USER_CACHE_TTL_SECONDS', 60);
const userCache = new Map();  // uid -> { user, expireAt }
function userCacheGet(uid) {
  const e = userCache.get(uid);
  if (!e) return null;
  if (Date.now() > e.expireAt) { userCache.delete(uid); return null; }
  return e.user;
}
function userCacheSet(uid, user) {
  if (USER_CACHE_TTL_MS <= 0) return;   // TTL=0 → キャッシュ無効 (毎回 Firestore を読む)
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
          if (user?.perms) user.perms = normalizePresetPerms(user.perms);
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

  // 旧権限 (viewPresets のみ) を editPreset へ引き上げる。読み取り時の正規化なので
  // Firestore のデータは書き換えず、保存時に新形式へ寄る。
  if (user?.perms) user.perms = normalizePresetPerms(user.perms);
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
// 判定ルールは utils/sourceVisibility.js の sourceVisible が唯一の基準
// (一覧 / 集計 / config / preset / 更新系すべてで同じ関数を使う)。
export async function canAccessSource(user, sid) {
  if (!user) return false;
  if (user.isAdmin) return true;
  const snap = await db.collection('sources').doc(sid).get();
  if (!snap.exists) return false;
  return sourceVisible(user, snap.data());
}

// パスパラメータの source に対する visibility を確認するミドルウェア。
// param 名はルートに合わせて指定する (/api/config/:sid は 'sid'、/api/sources/:id は 'id')。
// 権限 (manageSources 等) はスコープ「何をしてよいか」で、こちらはスコープ「どのソースに
// 対してか」。両方必要なルートでは requirePerm と併用する。
export function requireSourceAccess(param = 'sid') {
  return async (c, next) => {
    const user = c.get('user');
    const sid = c.req.param(param);
    if (!sid) return c.json({ error: `${param} required` }, 400);
    const ok = await canAccessSource(user, sid);
    if (!ok) return c.json({ error: 'Source not accessible' }, 403);
    await next();
  };
}
