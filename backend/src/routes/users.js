import { Hono } from 'hono';
import { db, auth } from '../firebase.js';
import { adminOnly, invalidateUserCache } from '../middleware/auth.js';
import { ADMIN_PERMS, VIEWER_PERMS, PERM_KEYS } from '../utils/perms.js';
import { httpError } from '../middleware/error.js';

const app = new Hono();

// List all users (admin only)
app.get('/', adminOnly, async c => {
  const snap = await db.collection('users').orderBy('createdAt').get();
  return c.json({ users: snap.docs.map(d => d.data()) });
});

// Pre-register a user by email (admin only). Google ログインで本人が初回サインインした時に
// middleware/auth.js がメール一致で本物の UID へ doc を移行する。
app.post('/', adminOnly, async c => {
  const body = await c.req.json();
  const email = (body.email || '').trim();
  const name = (body.name || '').trim() || email.split('@')[0] || 'User';
  const isAdmin = !!body.isAdmin;
  if (!email) throw httpError(400, 'email is required');

  // 既に同 email で登録されていないかチェック
  const dup = await db.collection('users').where('email', '==', email).limit(1).get();
  if (!dup.empty) throw httpError(400, 'このメールアドレスは既に登録されています');

  const pendingId = 'pending_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const profile = {
    uid: pendingId,
    email,
    name,
    photoURL: '',
    isAdmin,
    perms: isAdmin ? { ...ADMIN_PERMS } : { ...VIEWER_PERMS },
    createdAt: new Date().toISOString(),
  };
  await db.collection('users').doc(pendingId).set(profile);
  return c.json(profile);
});

// Update user's role/perms (admin only)
app.put('/:uid', adminOnly, async c => {
  const uid = c.req.param('uid');
  const body = await c.req.json();
  const ref = db.collection('users').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw httpError(404, 'User not found');

  const patch = {};
  if (typeof body.name === 'string') patch.name = body.name;
  if (typeof body.isAdmin === 'boolean') {
    patch.isAdmin = body.isAdmin;
    if (body.isAdmin) patch.perms = { ...ADMIN_PERMS };
  }
  if (body.perms && typeof body.perms === 'object') {
    const clean = { ...VIEWER_PERMS };
    for (const k of PERM_KEYS) if (k in body.perms) clean[k] = !!body.perms[k];
    patch.perms = clean;
  }
  // groupId は単一値 (null で未分類)
  if ('groupId' in body) {
    patch.groupId = (typeof body.groupId === 'string' && body.groupId) ? body.groupId : null;
  }
  // Enforce at least one admin remains
  if (patch.isAdmin === false) {
    const adminsSnap = await db.collection('users').where('isAdmin', '==', true).get();
    const adminUids = adminsSnap.docs.map(d => d.id);
    if (adminUids.length === 1 && adminUids[0] === uid) {
      throw httpError(400, 'Cannot demote the last admin');
    }
  }
  await ref.update(patch);
  invalidateUserCache(uid);  // 権限/グループ変更を 60s 待たずに反映
  return c.json({ ok: true });
});

// Delete user (admin only)
app.delete('/:uid', adminOnly, async c => {
  const uid = c.req.param('uid');
  const me = c.get('uid');
  if (uid === me) throw httpError(400, 'Cannot delete yourself');

  const ref = db.collection('users').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw httpError(404, 'User not found');

  if (snap.data().isAdmin) {
    const adminsSnap = await db.collection('users').where('isAdmin', '==', true).get();
    if (adminsSnap.size <= 1) throw httpError(400, 'Cannot delete the last admin');
  }
  // Delete Firestore record and Firebase Auth account
  await ref.delete();
  try { await auth.deleteUser(uid); } catch (e) { /* already gone */ }
  invalidateUserCache(uid);
  return c.json({ ok: true });
});

export default app;
