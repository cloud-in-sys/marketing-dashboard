import { Hono } from 'hono';
import { db } from '../firebase.js';
import { httpError } from '../middleware/error.js';

// Stores per-source config as a single document.
// Frontend treats this as an opaque JSON blob containing:
// { metricDefs, dimensions, views, filterDefs, formulas, baseFormulas,
//   customTabs, viewOrder, colWidths, state }

const app = new Hono();

function configDoc(uid, sid) {
  return db.collection('users').doc(uid).collection('sources').doc(sid).collection('config').doc('current');
}

app.get('/:sid', async c => {
  const uid = c.get('uid');
  const sid = c.req.param('sid');
  const snap = await configDoc(uid, sid).get();
  return c.json({ config: snap.exists ? snap.data() : null });
});

app.put('/:sid', async c => {
  const uid = c.get('uid');
  const sid = c.req.param('sid');
  const body = await c.req.json();
  if (!body || typeof body !== 'object') throw httpError(400, 'Body must be an object');
  // Merge-style: caller sends the full config blob; we overwrite.
  await configDoc(uid, sid).set({ ...body, updatedAt: new Date().toISOString() });
  return c.json({ ok: true });
});

// Partial patch for specific keys (optimization for saving single slices)
app.patch('/:sid', async c => {
  const uid = c.get('uid');
  const sid = c.req.param('sid');
  const body = await c.req.json();
  if (!body || typeof body !== 'object') throw httpError(400, 'Body must be an object');
  await configDoc(uid, sid).set({ ...body, updatedAt: new Date().toISOString() }, { merge: true });
  return c.json({ ok: true });
});

export default app;
