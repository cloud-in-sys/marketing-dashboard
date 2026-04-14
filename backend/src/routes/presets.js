import { Hono } from 'hono';
import { db } from '../firebase.js';
import { requirePerm } from '../middleware/auth.js';

const app = new Hono();

function presetsCol(uid, sid) {
  return db.collection('users').doc(uid).collection('sources').doc(sid).collection('presets');
}

// List all presets for a source
app.get('/:sid', async c => {
  const uid = c.get('uid');
  const sid = c.req.param('sid');
  const snap = await presetsCol(uid, sid).orderBy('order').get();
  return c.json({ presets: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
});

// Replace entire preset list (simpler than per-item CRUD, matches frontend pattern)
app.put('/:sid', requirePerm('savePreset'), async c => {
  const uid = c.get('uid');
  const sid = c.req.param('sid');
  const body = await c.req.json();
  const list = Array.isArray(body.presets) ? body.presets : [];

  const col = presetsCol(uid, sid);
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
