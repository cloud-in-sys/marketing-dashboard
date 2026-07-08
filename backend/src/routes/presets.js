import { Hono } from 'hono';
import { db } from '../firebase.js';
import { requireSourceAccess, requireAnyPerm } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';

const app = new Hono();

const presetsCol = (sid) =>
  db.collection('sources').doc(sid).collection('presets');

// リスト取得 (ソースアクセス権があれば全ユーザー可)
app.get('/:sid', requireSourceAccess(), async c => {
  const sid = c.req.param('sid');
  const snap = await presetsCol(sid).orderBy('order').get();
  return c.json({ presets: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
});

// 新規作成: 1 プリセットだけ追加。他プリセットには一切触れないので他ユーザー編集と衝突しない。
// 同名 preset が既にあれば 409。race を防ぐため Firestore transaction 内で存在確認 + write。
app.post('/:sid', requireSourceAccess(), requireAnyPerm('savePreset', 'editPreset'), async c => {
  const sid = c.req.param('sid');
  const body = await c.req.json();
  if (!body || typeof body !== 'object') throw httpError(400, 'body required');
  const col = presetsCol(sid);
  const { id: _ignoreId, ...data } = body;
  const created = await db.runTransaction(async tx => {
    if (data.name) {
      const dup = await tx.get(col.where('name', '==', data.name).limit(1));
      if (!dup.empty) throw httpError(409, `同じ名前のプリセットが既に存在します: ${data.name}`);
    }
    if (data.order == null) {
      const orderSnap = await tx.get(col.orderBy('order', 'desc').limit(1));
      data.order = orderSnap.empty ? 0 : ((orderSnap.docs[0].data().order ?? 0) + 1);
    }
    const ref = col.doc();
    tx.set(ref, data);
    return { id: ref.id, ...data };
  });
  return c.json(created);
});

// 個別更新: 単一 preset だけ書き換え。他プリセットは無傷。
// name 変更時は「別 doc に同名が存在しないか」を transaction で確認。
app.put('/:sid/:pid', requireSourceAccess(), requireAnyPerm('editPreset', 'savePreset'), async c => {
  const sid = c.req.param('sid');
  const pid = c.req.param('pid');
  const body = await c.req.json();
  if (!body || typeof body !== 'object') throw httpError(400, 'body required');
  const col = presetsCol(sid);
  const ref = col.doc(pid);
  const { id: _ignoreId, ...data } = body;
  await db.runTransaction(async tx => {
    const cur = await tx.get(ref);
    if (!cur.exists) throw httpError(404, 'preset not found');
    if (data.name && data.name !== cur.data().name) {
      const dup = await tx.get(col.where('name', '==', data.name).limit(1));
      // 自分と同 name の他 doc があれば 409
      if (!dup.empty && dup.docs[0].id !== pid) {
        throw httpError(409, `同じ名前のプリセットが既に存在します: ${data.name}`);
      }
    }
    if (data.order == null) data.order = cur.data().order ?? 0;
    tx.set(ref, data);
  });
  return c.json({ ok: true });
});

// 個別削除
app.delete('/:sid/:pid', requireSourceAccess(), requireAnyPerm('deletePreset'), async c => {
  const sid = c.req.param('sid');
  const pid = c.req.param('pid');
  await presetsCol(sid).doc(pid).delete();
  return c.json({ ok: true });
});

// 並替のみ: body.order = [pid, pid, ...] を受けて order フィールドだけ更新。
// preset の中身は書き換えないので他ユーザーの編集を潰さない。
// 存在しない pid は skip (Firestore batch は 1 件でも NOT_FOUND だと全滅するため、
// 事前に存在チェックする)。
app.patch('/:sid', requireSourceAccess(), requireAnyPerm('editPreset'), async c => {
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
