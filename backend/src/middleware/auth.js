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
    // First login: bootstrap. If no users exist yet, make this user admin.
    const existing = await db.collection('users').limit(1).get();
    const isFirstUser = existing.empty;
    user = {
      uid: decoded.uid,
      email: decoded.email || '',
      name: decoded.name || decoded.email?.split('@')[0] || 'User',
      photoURL: decoded.picture || '',
      isAdmin: isFirstUser,
      perms: isFirstUser ? { ...ADMIN_PERMS } : { ...VIEWER_PERMS },
      createdAt: new Date().toISOString(),
    };
    await userRef.set(user);
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
