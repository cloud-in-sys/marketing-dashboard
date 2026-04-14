import { Hono } from 'hono';
import { db } from '../firebase.js';
import { requirePerm } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';

const app = new Hono();

function sourcesCol(uid) {
  return db.collection('users').doc(uid).collection('sources');
}

// List sources for current user
app.get('/', async c => {
  const uid = c.get('uid');
  const snap = await sourcesCol(uid).orderBy('createdAt').get();
  const sources = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (sources.length === 0) {
    // Bootstrap default source
    const ref = await sourcesCol(uid).add({
      name: 'デフォルト',
      method: '',
      createdAt: new Date().toISOString(),
    });
    sources.push({ id: ref.id, name: 'デフォルト', method: '', createdAt: new Date().toISOString() });
  }
  return c.json({ sources });
});

// Create source
app.post('/', requirePerm('addSource'), async c => {
  const uid = c.get('uid');
  const body = await c.req.json();
  const name = (body.name || '').trim();
  if (!name) throw httpError(400, 'name is required');
  const doc = {
    name,
    method: body.method || '',
    createdAt: new Date().toISOString(),
  };
  const ref = await sourcesCol(uid).add(doc);
  return c.json({ id: ref.id, ...doc });
});

// Rename / update source
app.put('/:id', async c => {
  const uid = c.get('uid');
  const id = c.req.param('id');
  const body = await c.req.json();
  const patch = {};
  if (typeof body.name === 'string') patch.name = body.name.trim();
  if (typeof body.method === 'string') patch.method = body.method;
  if (body.sheetsInput) patch.sheetsInput = body.sheetsInput;
  if (body.bqInput) patch.bqInput = body.bqInput;
  await sourcesCol(uid).doc(id).update(patch);
  return c.json({ ok: true });
});

// Delete source
app.delete('/:id', requirePerm('deleteSource'), async c => {
  const uid = c.get('uid');
  const id = c.req.param('id');
  // Delete source doc and its config/presets subcollections
  const ref = sourcesCol(uid).doc(id);
  const batches = [];
  for (const sub of ['config', 'presets']) {
    const subSnap = await ref.collection(sub).get();
    subSnap.docs.forEach(d => batches.push(d.ref.delete()));
  }
  await Promise.all(batches);
  await ref.delete();
  return c.json({ ok: true });
});

export default app;
