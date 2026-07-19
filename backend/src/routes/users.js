// @ts-check
import { Hono } from 'hono';
import { db, auth } from '../firebase.js';
import { adminOnly, invalidateUserCache } from '../middleware/auth.js';
import { ADMIN_PERMS, VIEWER_PERMS, PERM_KEYS } from '../utils/perms.js';
import { httpError } from '../middleware/error.js';
import { revokeAndDeleteGoogleToken } from '../utils/googleTokens.js';

const app = new Hono();

// List all users (admin only)。
// orderBy('createdAt') を使うと Firestore 仕様で「createdAt フィールドを持たない doc」は
// 結果から除外されてしまう (旧スクリプト/手動投入された admin doc などが消える)。
// 全件取って JS 側で並べる: createdAt 無しの doc は最初に置いて UI から見えるようにする。
app.get('/', adminOnly, async c => {
  const snap = await db.collection('users').get();
  const users = snap.docs.map(d => /** @type {any} */ (d.data()));
  users.sort((a, b) => {
    const ca = a.createdAt || '';
    const cb = b.createdAt || '';
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  });
  /** @type {import('@pkg/shared/api-types.ts').ListUsersResult} */
  const res = { users };
  return c.json(res);
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
  /** @type {import('@pkg/shared/api-types.ts').UserProfile} */
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
  // 管理者数の確認と更新は必ず同一 transaction 内で行う (原子性)。
  // read → write を分けると、管理者 A と B が同時に互いを降格した場合に
  // 両方が「管理者は 2 人いる」と読んでから両方が書き込み、管理者 0 人になる。
  await db.runTransaction(async tx => {
    const cur = await tx.get(ref);
    if (!cur.exists) throw httpError(404, 'User not found');
    if (patch.isAdmin === false) {
      const admins = await tx.get(db.collection('users').where('isAdmin', '==', true));
      const remaining = admins.docs.filter(d => d.id !== uid);
      if (remaining.length === 0) throw httpError(400, 'Cannot demote the last admin');
    }
    tx.update(ref, patch);
  });
  invalidateUserCache(uid);  // 権限/グループ変更を 60s 待たずに反映
  return c.json({ ok: true });
});

// Delete user (admin only)
// Firestore は親 doc を消してもサブコレクションを消さないので、users/{uid} を
// 消すだけでは users/{uid}/tokens/google が残り、退職者の Google 資格情報で
// 自動更新が回り続ける。ユーザー doc 削除に成功したら必ずトークンも失効させる。
app.delete('/:uid', adminOnly, async c => {
  const uid = c.req.param('uid');
  const me = c.get('uid');
  if (uid === me) throw httpError(400, 'Cannot delete yourself');

  const ref = db.collection('users').doc(uid);

  // 「最後の管理者か」の確認と削除を同一 transaction で行う (PUT と同じ理由)
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw httpError(404, 'User not found');
    if (snap.data().isAdmin) {
      const admins = await tx.get(db.collection('users').where('isAdmin', '==', true));
      const remaining = admins.docs.filter(d => d.id !== uid);
      if (remaining.length === 0) throw httpError(400, 'Cannot delete the last admin');
    }
    tx.delete(ref);
  });

  // ここから先は「ユーザー doc は既に消えた」後の後始末。個別に失敗しても
  // 削除自体は成立しているので 500 にせず、構造化ログに残して続行する。
  // (トークンが万一残っても、refreshAll / findAnyConnectedUser 側で
  //  ユーザー doc の存在を確認しているので使われることはない)
  await revokeAndDeleteGoogleToken(uid, { reason: 'user_deleted', deletedBy: me })
    .catch(e => logCleanupFailure('token cleanup failed', uid, e));
  await clearCreatedBy(uid).catch(e => logCleanupFailure('createdBy cleanup failed', uid, e));
  try { await auth.deleteUser(uid); } catch (e) { /* already gone */ }
  invalidateUserCache(uid);
  return c.json({ ok: true });
});

function logCleanupFailure(message, uid, e) {
  console.log(JSON.stringify({ severity: 'ERROR', message, uid, error: e?.message || String(e) }));
}

// 削除ユーザーが作成したソースの createdBy を外す。
// 残すと「定期更新の優先アカウント」に存在しないユーザーが表示され続け、
// refreshAll も毎回そのユーザーのトークンを探しにいく。null にして
// 管理者に再設定を促す (フォールバックの連携ユーザーで更新は継続する)。
async function clearCreatedBy(uid) {
  const snap = await db.collection('sources').where('createdBy', '==', uid).get();
  if (snap.empty) return;
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch();
    snap.docs.slice(i, i + 400).forEach(d => batch.update(d.ref, { createdBy: null }));
    await batch.commit();
  }
  console.log(JSON.stringify({
    severity: 'INFO',
    message: 'cleared createdBy for deleted user',
    uid,
    sources: snap.docs.length,
  }));
}

export default app;
