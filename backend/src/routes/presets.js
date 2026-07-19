// @ts-check
import { Hono } from 'hono';
import { db } from '../firebase.js';
import { requireSourceAccess, requirePerm } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import { validateReplacePreset } from '../utils/presetValidation.js';

const app = new Hono();

const presetsCol = (sid) =>
  db.collection('sources').doc(sid).collection('presets');

// リスト取得 (ソースアクセス権があれば全ユーザー可)
app.get('/:sid', requireSourceAccess(), async c => {
  const sid = c.req.param('sid');
  const snap = await presetsCol(sid).orderBy('order').get();
  /** @type {import('@pkg/shared/api-types.ts').ListPresetsResult} */
  const res = { presets: snap.docs.map(d => /** @type {any} */ ({ id: d.id, ...d.data() })) };
  return c.json(res);
});

// 新規作成: 1 プリセットだけ追加。他プリセットには一切触れないので他ユーザー編集と衝突しない。
// 同名 preset が既にあれば 409。race を防ぐため Firestore transaction 内で存在確認 + write。
app.post('/:sid', requireSourceAccess(), requirePerm('savePreset'), async c => {
  const sid = c.req.param('sid');
  const body = await c.req.json();
  if (!body || typeof body !== 'object') throw httpError(400, 'body required');
  const col = presetsCol(sid);
  const { id: _ignoreId, ...data } = body;
  // name は必須 (全置換 API。空 name の preset を作らせない)。
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) throw httpError(400, 'preset name is required');
  data.name = name;
  const created = await db.runTransaction(async tx => {
    const dup = await tx.get(col.where('name', '==', data.name).limit(1));
    if (!dup.empty) throw httpError(409, `同じ名前のプリセットが既に存在します: ${data.name}`);
    if (data.order == null) {
      const orderSnap = await tx.get(col.orderBy('order', 'desc').limit(1));
      data.order = orderSnap.empty ? 0 : ((orderSnap.docs[0].data().order ?? 0) + 1);
    }
    const ref = col.doc();
    tx.set(ref, data);
    return { id: ref.id, ...data };
  });
  // name は上で runtime 検証済みなので Preset として返せる (無条件 cast ではない)。
  /** @type {import('@pkg/shared/api-types.ts').Preset} */
  const res = created;
  return c.json(res);
});

// 個別更新: 単一 preset だけ書き換え。他プリセットは無傷。
// name 変更時は「別 doc に同名が存在しないか」を transaction で確認。
app.put('/:sid/:pid', requireSourceAccess(), requirePerm('editPreset'), async c => {
  const sid = c.req.param('sid');
  const pid = c.req.param('pid');
  const body = await c.req.json();
  const col = presetsCol(sid);
  const ref = col.doc(pid);
  // PUT は全置換。ReplacePresetRequest と一致する完全性・型検証を行い、**許可項目だけ**を
  // 詰め直した clean データだけを保存する (部分データで既存設定を消させない / 未知フィールドや
  // id を混入させない)。検証は transaction より前 = 400 時に既存 doc を一切変更しない。
  const v = validateReplacePreset(body);
  if ('error' in v) throw httpError(400, v.error);
  const data = v.preset;
  await db.runTransaction(async tx => {
    const cur = await tx.get(ref);
    if (!cur.exists) throw httpError(404, 'preset not found');
    if (data.name !== cur.data().name) {
      const dup = await tx.get(col.where('name', '==', data.name).limit(1));
      // 自分と同 name の他 doc があれば 409
      if (!dup.empty && dup.docs[0].id !== pid) {
        throw httpError(409, `同じ名前のプリセットが既に存在します: ${data.name}`);
      }
    }
    tx.set(ref, data);
  });
  return c.json({ ok: true });
});

// 個別削除
app.delete('/:sid/:pid', requireSourceAccess(), requirePerm('deletePreset'), async c => {
  const sid = c.req.param('sid');
  const pid = c.req.param('pid');
  await presetsCol(sid).doc(pid).delete();
  return c.json({ ok: true });
});

// 並替のみ: body.order = [pid, pid, ...] を受けて order フィールドだけ更新。
// preset の中身は書き換えないので他ユーザーの編集を潰さない。
// 存在しない pid は skip (Firestore batch は 1 件でも NOT_FOUND だと全滅するため、
// 事前に存在チェックする)。
app.patch('/:sid', requireSourceAccess(), requirePerm('editPreset'), async c => {
  const sid = c.req.param('sid');
  const body = await c.req.json();
  if (!Array.isArray(body?.order)) throw httpError(400, 'order (array) required');
  const col = presetsCol(sid);
  const snap = await col.get();
  const existing = new Set(snap.docs.map(d => d.id));
  const batch = db.batch();
  let i = 0;
  for (const pid of body.order) {
    if (typeof pid !== 'string' || !pid) continue;
    if (!existing.has(pid)) continue;
    batch.update(col.doc(pid), { order: i });
    i++;
  }
  await batch.commit();
  return c.json({ ok: true });
});

export default app;
