// @ts-check
import { Hono } from 'hono';
import { db } from '../firebase.js';
import { requirePerm } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import { invalidateSourceAccessCache } from '../aggregate/sourceAccess.js';
import { validateSourceFilters } from '../utils/groupFilter.js';

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
// admin / manageGroups 保有者のみ。それ以外には空配列を返してプルダウン表示を壊さない。
app.get('/', async c => {
  const user = c.get('user');
  const allowed = user?.isAdmin || user?.perms?.manageGroups;
  if (!allowed) return c.json(/** @type {import('@pkg/shared/api-types.ts').ListGroupsResult} */ ({ groups: [] }));
  const snap = await groupsCol().orderBy('createdAt').get();
  /** @type {import('@pkg/shared/api-types.ts').ListGroupsResult} */
  const res = { groups: snap.docs.map(d => /** @type {any} */ ({ id: d.id, ...d.data() })) };
  return c.json(res);
});

// グループ管理画面用のメンバー一覧。
// GET /api/users は adminOnly なので、manageGroups だけを持つ非管理者が
// グループ画面を開くと 403 で画面全体が落ちていた。グループ画面の表示に必要な
// 項目だけを返す専用エンドポイントを用意する。
//
// 返すのは uid / name / email / groupId / isAdmin だけ。
// perms (権限の中身) は絶対に返さない — グループ画面では使わず、他人がどの権限を
// 持っているかが漏れるだけだから。isAdmin はメンバー一覧の「（管理者）」表示に使う。
app.get('/members', async c => {
  const user = c.get('user');
  if (!user?.isAdmin && !user?.perms?.manageGroups) {
    return c.json({ error: 'Missing permission: manageGroups' }, 403);
  }
  const snap = await db.collection('users').get();
  const members = snap.docs.map(d => {
    const u = d.data();
    return {
      uid: u.uid || d.id,
      name: u.name || '',
      email: u.email || '',
      groupId: u.groupId || null,
      isAdmin: !!u.isAdmin,
    };
  });
  members.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, 'ja'));
  /** @type {import('@pkg/shared/api-types.ts').ListGroupMembersResult} */
  const res = { members };
  return c.json(res);
});

// 作成 (manageGroups)
app.post('/', requirePerm('manageGroups'), async c => {
  const body = await c.req.json();
  const name = (body.name || '').trim();
  if (!name) throw httpError(400, 'name is required');
  const sourceFilters = body.sourceFilters && typeof body.sourceFilters === 'object' ? body.sourceFilters : {};
  assertValidSourceFilters(sourceFilters);
  const doc = {
    name,
    sourceFilters,
    createdAt: new Date().toISOString(),
  };
  const ref = await groupsCol().add(doc);
  /** @type {import('@pkg/shared/api-types.ts').Group} */
  const res = { id: ref.id, ...doc };
  return c.json(res);
});

// sourceFilters を検証。不正があれば 400。
// 以前は正規表現の構文しか見ておらず、未知の op や不正な型を保存できてしまい、
// 実行時に「判定不能 → 全行表示」という fail-open を招いていた。
// 検証ロジックは実行時 (aggregate/sourceAccess.js) と同じ utils/groupFilter.js を使う。
function assertValidSourceFilters(sf) {
  const err = validateSourceFilters(sf);
  if (err) throw httpError(400, `Invalid row filter: ${err}`);
}

// 更新
// - name: 名前 (manageGroups)
// - sourceFilters: 各ソースに対する行フィルタ map
//   形式: { [sid]: { field, op: 'equals'|'in'|'notIn'|'regex'|'notRegex', value?, values? } }
//   (manageGroups 必須)
app.put('/:gid', requirePerm('manageGroups'), async c => {
  const gid = c.req.param('gid');
  const body = await c.req.json();
  const patch = {};

  if (typeof body.name === 'string') patch.name = body.name.trim();
  if (body.sourceFilters && typeof body.sourceFilters === 'object') {
    assertValidSourceFilters(body.sourceFilters);
    patch.sourceFilters = body.sourceFilters;
  }

  if (!Object.keys(patch).length) return c.json({ ok: true });
  await groupsCol().doc(gid).update(patch);
  invalidateSourceAccessCache();  // sourceFilters 変更を即時反映
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
  invalidateSourceAccessCache();
  return c.json({ ok: true });
});

export default app;
