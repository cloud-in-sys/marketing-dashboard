import { Hono } from 'hono';
import { db } from '../firebase.js';
import { requireSourceAccess, requireAnyPerm } from '../middleware/auth.js';

const app = new Hono();

const presetsCol = (sid) =>
  db.collection('sources').doc(sid).collection('presets');

// プリセットは全ユーザーに公開（ソースアクセス権があれば閲覧可）
app.get('/:sid', requireSourceAccess(), async c => {
  const sid = c.req.param('sid');
  const snap = await presetsCol(sid).orderBy('order').get();
  return c.json({ presets: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
});

// 保存系はプリセット関連いずれかの権限で可 (MVP)
app.put('/:sid', requireSourceAccess(), requireAnyPerm('savePreset', 'editPreset', 'deletePreset'), async c => {
  const sid = c.req.param('sid');
  const body = await c.req.json();
  const list = Array.isArray(body.presets) ? body.presets : [];

  const col = presetsCol(sid);
  const existing = await col.get();

  const batch = db.batch();
  existing.docs.forEach(d => batch.delete(d.ref));
  list.forEach((p, i) => {
    const { id, ...rest } = p;
    const ref = id ? col.doc(id) : col.doc();
    batch.set(ref, { ...rest, order: i });
  });
  await batch.commit();
  return c.json({ ok: true });
});

export default app;
