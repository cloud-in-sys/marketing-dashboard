import { Hono } from 'hono';
import { db } from '../firebase.js';
import { requirePerm } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';

// グループ: ユーザーが所属する「テナント」を表す単純な名前付きレコード。
// - 行フィルタや可視性のロジックは sources 側で定義する
// - ユーザーは 1 グループに所属する (users.groupId)
//
// schema:
//   groups/{gid}
//     name: string
//     createdAt

const app = new Hono();
const groupsCol = () => db.collection('groups');

// 一覧
// manageUsers / manageGroups 権限保有者のみ。それ以外には空配列を返してプルダウン表示を壊さない。
app.get('/', async c => {
  const user = c.get('user');
  const allowed = user?.isAdmin || user?.perms?.manageUsers || user?.perms?.manageGroups;
  if (!allowed) return c.json({ groups: [] });
  const snap = await groupsCol().orderBy('createdAt').get();
  return c.json({ groups: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
});

// 作成 (manageGroups)
app.post('/', requirePerm('manageGroups'), async c => {
  const body = await c.req.json();
  const name = (body.name || '').trim();
  if (!name) throw httpError(400, 'name is required');
  const doc = {
    name,
    sourceFilters: body.sourceFilters && typeof body.sourceFilters === 'object' ? body.sourceFilters : {},
    createdAt: new Date().toISOString(),
  };
  const ref = await groupsCol().add(doc);
  return c.json({ id: ref.id, ...doc });
});

// 更新
// - name: 名前 (manageGroups)
// - sourceFilters: 各ソースに対する行フィルタ map
//   形式: { [sid]: { field, op: 'equals'|'in'|'notIn', value?, values? } }
//   (manageGroups 必須)
app.put('/:gid', requirePerm('manageGroups'), async c => {
  const gid = c.req.param('gid');
  const body = await c.req.json();
  const patch = {};

  if (typeof body.name === 'string') patch.name = body.name.trim();
  if (body.sourceFilters && typeof body.sourceFilters === 'object') {
    patch.sourceFilters = body.sourceFilters;
  }

  if (!Object.keys(patch).length) return c.json({ ok: true });
  await groupsCol().doc(gid).update(patch);
  return c.json({ ok: true });
});

// 削除 (manageGroups)
// 削除前に: このグループを参照しているユーザー / ソースから外す
app.delete('/:gid', requirePerm('manageGroups'), async c => {
  const gid = c.req.param('gid');
  const admin = (await import('firebase-admin')).default;
  const FieldValue = admin.firestore.FieldValue;
  const users = await db.collection('users').where('groupId', '==', gid).get();
  const sources = await db.collection('sources').where('allowedGroupIds', 'array-contains', gid).get();
  const batch = db.batch();
  // ユーザーの groupId を null に戻す (未分類扱い)
  users.docs.forEach(d => batch.update(d.ref, { groupId: null }));
  // ソースの allowedGroupIds から除外
  sources.docs.forEach(d => batch.update(d.ref, { allowedGroupIds: FieldValue.arrayRemove(gid) }));
  batch.delete(groupsCol().doc(gid));
  await batch.commit();
  return c.json({ ok: true });
});

export default app;
