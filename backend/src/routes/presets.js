import { Hono } from 'hono';
import { db } from '../firebase.js';
import { requireSourceAccess, requireAnyPerm } from '../middleware/auth.js';

const app = new Hono();

const presetsCol = (sid) =>
  db.collection('sources').doc(sid).collection('presets');

// viewPresets を持たない非 admin には空配列を返す(UI は壊さず API 直叩きも封じる)
app.get('/:sid', requireSourceAccess(), async c => {
  const user = c.get('user');
  if (!user?.isAdmin && !user?.perms?.viewPresets) {
    return c.json({ presets: [] });
  }
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
