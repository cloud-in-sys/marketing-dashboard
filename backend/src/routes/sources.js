// @ts-check
import { Hono } from 'hono';
import { db } from '../firebase.js';
import { requirePerm, canAccessSource, requireSourceAccess } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import { invalidateSourceAccessCache } from '../aggregate/sourceAccess.js';
import { canCreateSource } from '../utils/perms.js';
import { sourceVisible } from '../utils/sourceVisibility.js';

// Shared sources: stored at top-level `sources/{id}`.
// Permissions:
//   - list:    any logged-in user (可視性は sourceVisible で絞り込む)
//   - create:  admin or operator only (canCreateSource); 一般 (viewer) は manageSources を
//              個別付与されていても作成不可。初期 config も backend で作成し、
//              コピー作成も backend 側で完結する。
//   - update:  name / method / sheetsInput / bqInput → manageSources
//              allowedGroupIds / isPublic → manageGroups
//   - delete:  requires `manageSources` permission
//   - reorder: requires `manageSources` permission
//
// 更新系 (update / disconnect / delete / reorder) は権限に加えて requireSourceAccess で
// 「そのソースが自分に見えるか」も必ず確認する。manageSources は「ソースを操作してよい」
// という能力であって「全ソースに対して」ではないため、これがないと別グループの
// 非公開ソースの ID を知るだけで改名・切断・削除できてしまう。

const app = new Hono();

const sourcesCol = () => db.collection('sources');

// List all sources
// 可視性ルールは utils/sourceVisibility.js の sourceVisible が唯一の基準。
app.get('/', async c => {
  const snap = await sourcesCol().get();
  // Firestore doc をそのまま DataSource として返す (実データが従う前提でキャスト)。
  /** @type {import('@pkg/shared/api-types.ts').DataSource[]} */
  let sources = snap.docs.map(d => /** @type {any} */ ({ id: d.id, ...d.data() }));
  // 並び順は order フィールド (なければ createdAt 順) で安定化
  sources.sort((a, b) => {
    const ao = typeof a.order === 'number' ? a.order : Infinity;
    const bo = typeof b.order === 'number' ? b.order : Infinity;
    if (ao !== bo) return ao - bo;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
  // ソースが 0 件でもここで自動作成しない。
  // 以前は「一般ユーザーが一覧を GET しただけで、公開ソースが 1 件作られる」状態で、
  // 作成権限 (admin / operator のみ) のルールと矛盾していた。GET が副作用で書き込むと
  // 同時アクセスで重複作成もされうる。初期ソースは admin が POST /api/sources で作る。
  const user = c.get('user');
  sources = sources.filter(s => sourceVisible(user, s));

  /** @type {import('@pkg/shared/api-types.ts').ListSourcesResult} */
  const res = { sources };
  return c.json(res);
});

// Create
// 作成権限: admin または operator (非 admin で全 non-settings perms 持ち) のみ。
//   一般 (viewer) は manageSources を個別付与されていても作成不可。
// 作成者が直後にアクセスできるよう allowedGroupIds を初期化:
//   - admin                  : allowedGroupIds = [] (admin は常に見える)
//   - operator + groupId あり : allowedGroupIds = [user.groupId] (自グループのみ可視)
//   - operator + 未分類       : 403 (グループ未割当のユーザーは作成不可)
//
// 初期 config (sources/{id}/config/current) は backend 側で作成する。
//   copyFromId 指定なし → 空の最小限 config
//   copyFromId 指定あり → アクセス権を確認した上で config + presets をコピー
// 途中で失敗した場合は作成した source doc とサブコレクションを削除して
// 中途半端な状態を残さない。
const EMPTY_CONFIG_FIELDS = {
  metricDefs: [],
  dimensions: [],
  filterDefs: [],
  views: {},
  formulas: {},
  baseFormulas: {},
  defaults: {},
  presets: [],
};

async function cleanupFailedSource(ref) {
  try {
    for (const sub of ['config', 'presets']) {
      const subSnap = await ref.collection(sub).get();
      for (let i = 0; i < subSnap.docs.length; i += 400) {
        const batch = db.batch();
        subSnap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    }
    await ref.delete();
  } catch (e) {
    console.log(JSON.stringify({
      severity: 'ERROR',
      message: 'source create cleanup failed',
      sid: ref.id,
      error: e.message,
    }));
  }
}

app.post('/', async c => {
  const user = c.get('user');
  if (!canCreateSource(user)) {
    throw httpError(403, 'データソース作成は管理者または運用者のみ可能です');
  }
  const body = await c.req.json();
  const name = (body.name || '').trim();
  const copyFromId = (typeof body.copyFromId === 'string' && body.copyFromId.trim()) || null;
  if (!name) throw httpError(400, 'name is required');
  if (!user.isAdmin && !user.groupId) {
    throw httpError(403, 'グループに所属していないユーザーはデータソースを作成できません');
  }

  // コピー元へのアクセス権を先に確認 (NG なら source も作らない)
  let copyConfigData = null;
  let copyPresetsData = null;
  if (copyFromId) {
    const okAccess = await canAccessSource(user, copyFromId);
    if (!okAccess) throw httpError(403, 'コピー元のデータソースにアクセスできません');
    const srcRef = sourcesCol().doc(copyFromId);
    const [cfgSnap, prSnap] = await Promise.all([
      srcRef.collection('config').doc('current').get(),
      srcRef.collection('presets').orderBy('order').get(),
    ]);
    copyConfigData = cfgSnap.exists ? cfgSnap.data() : null;
    copyPresetsData = prSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  const allowedGroupIds = user.isAdmin ? [] : [user.groupId];
  const now = new Date().toISOString();
  const sourceDoc = {
    name,
    method: body.method || '',
    isPublic: false,
    allowedGroupIds,
    createdAt: now,
    createdBy: c.get('uid'),
  };
  const ref = await sourcesCol().add(sourceDoc);

  try {
    let configToSave;
    if (copyConfigData) {
      const { updatedAt: _u, createdAt: _c, ...rest } = copyConfigData;
      configToSave = { ...rest, createdAt: now, updatedAt: now };
    } else {
      configToSave = { ...EMPTY_CONFIG_FIELDS, createdAt: now, updatedAt: now };
    }

    // config + presets を 400 ops ずつ batch で書き込む。
    const writes = [{ ref: ref.collection('config').doc('current'), data: configToSave }];
    if (copyPresetsData && copyPresetsData.length) {
      copyPresetsData.forEach((p, i) => {
        const { id: _id, ...rest } = p;
        writes.push({ ref: ref.collection('presets').doc(), data: { ...rest, order: i } });
      });
    }
    for (let i = 0; i < writes.length; i += 400) {
      const batch = db.batch();
      writes.slice(i, i + 400).forEach(w => batch.set(w.ref, w.data));
      await batch.commit();
    }

    return c.json({ id: ref.id, ...sourceDoc });
  } catch (e) {
    await cleanupFailedSource(ref);
    throw httpError(500, 'データソースの初期化に失敗しました: ' + (e.message || e));
  }
});

// 並び替え: ids 配列の順に order フィールドを 0,1,2... と書き換える
//   PUT /api/sources/reorder  { ids: ['s1', 's2', ...] }
// ※ このルートは必ず PUT '/:id' より前に登録すること。Hono は登録順にマッチするので、
//    後ろに置くと '/reorder' が '/:id' (id='reorder') に食われて無反応になる。
app.put('/reorder', requirePerm('manageSources'), async c => {
  const body = await c.req.json();
  const ids = Array.isArray(body && body.ids) ? body.ids.filter(id => typeof id === 'string') : null;
  if (!ids) throw httpError(400, 'ids array required');
  // 見えないソースの order を書き換えられないよう、全 id のアクセス権を先に確認する
  const user = c.get('user');
  const okList = await Promise.all(ids.map(id => canAccessSource(user, id)));
  if (okList.some(ok => !ok)) throw httpError(403, 'アクセスできないデータソースが含まれています');
  const batch = db.batch();
  ids.forEach((id, index) => batch.update(sourcesCol().doc(id), { order: index }));
  await batch.commit();
  return c.json({ ok: true });
});

// Update
// 権限ルール:
//   - name / method / sheetsInput / bqInput → manageSources
//   - allowedGroupIds → manageGroups
app.put('/:id', requireSourceAccess('id'), async c => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const user = c.get('user');
  const patch = {};

  if (typeof body.name === 'string') patch.name = body.name.trim();
  if (typeof body.method === 'string') patch.method = body.method;
  if (body.sheetsInput) patch.sheetsInput = body.sheetsInput;
  if (body.bqInput) patch.bqInput = body.bqInput;
  const touchesSourceFields = patch.name !== undefined || patch.method !== undefined || patch.sheetsInput || patch.bqInput;
  if (touchesSourceFields && !user.isAdmin && !user.perms?.manageSources) {
    throw httpError(403, 'manageSources required');
  }

  if (Array.isArray(body.allowedGroupIds)) {
    if (!user.isAdmin && !user.perms?.manageGroups) throw httpError(403, 'manageGroups required');
    patch.allowedGroupIds = [...new Set(body.allowedGroupIds.filter(g => typeof g === 'string'))];
  }
  if (typeof body.isPublic === 'boolean') {
    if (!user.isAdmin && !user.perms?.manageGroups) throw httpError(403, 'manageGroups required');
    patch.isPublic = body.isPublic;
  }

  if (!Object.keys(patch).length) return c.json({ ok: true });
  await sourcesCol().doc(id).update(patch);
  invalidateSourceAccessCache(id);  // allowedGroupIds 等の変更を即時反映
  return c.json({ ok: true });
});

// Disconnect: clear method + inputs for this source.
app.post('/:id/disconnect', requirePerm('manageSources'), requireSourceAccess('id'), async c => {
  const id = c.req.param('id');
  const admin = (await import('firebase-admin')).default;
  const FieldValue = admin.firestore.FieldValue;
  await sourcesCol().doc(id).update({
    method: '',
    sheetsInput: FieldValue.delete(),
    bqInput: FieldValue.delete(),
  });
  return c.json({ ok: true });
});

// Delete (also wipes config + presets)
// Firestore batch は最大 500 operations なので、サブコレクションが大きい場合に備えて分割
app.delete('/:id', requirePerm('manageSources'), requireSourceAccess('id'), async c => {
  const id = c.req.param('id');
  const ref = sourcesCol().doc(id);
  const docsToDelete = [];
  for (const sub of ['config', 'presets']) {
    const subSnap = await ref.collection(sub).get();
    subSnap.docs.forEach(d => docsToDelete.push(d.ref));
  }
  docsToDelete.push(ref);
  for (let i = 0; i < docsToDelete.length; i += 400) {
    const batch = db.batch();
    docsToDelete.slice(i, i + 400).forEach(r => batch.delete(r));
    await batch.commit();
  }
  invalidateSourceAccessCache(id);
  return c.json({ ok: true });
});

export default app;
