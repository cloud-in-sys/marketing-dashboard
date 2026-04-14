import { auth, db } from '../firebase.js';
import { ADMIN_PERMS, VIEWER_PERMS } from '../utils/perms.js';

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
      // Check if an existing doc has this email (admin pre-registered the user
      // via email/password flow, but they chose to sign in with Google).
      // In that case, migrate the doc to the new UID.
      const email = decoded.email || '';
      if (email) {
        const byEmail = await db.collection('users').where('email', '==', email).limit(1).get();
        if (!byEmail.empty) {
          const prev = byEmail.docs[0];
          user = { ...prev.data(), uid: decoded.uid, photoURL: decoded.picture || prev.data().photoURL || '' };
          await userRef.set(user);
          await prev.ref.delete();
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
    // Always refresh email/name/photo from token (source of truth: Google)
    const patch = {};
    if (decoded.email && decoded.email !== user.email) patch.email = decoded.email;
    if (decoded.name && decoded.name !== user.name) patch.name = decoded.name;
    if (decoded.picture && decoded.picture !== user.photoURL) patch.photoURL = decoded.picture;
    if (Object.keys(patch).length) {
      await userRef.update(patch);
      Object.assign(user, patch);
    }
  }

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
