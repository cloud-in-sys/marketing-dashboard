import { Hono } from 'hono';
import { db } from '../firebase.js';
import { requirePerm } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';

// Shared sources: stored at top-level `sources/{id}`. All users see them.
// Permissions:
//   - list:   any logged-in user
//   - create: requires `addSource` permission
//   - update: any logged-in user (rename / set method etc.)
//   - delete: requires `deleteSource` permission

const app = new Hono();

const sourcesCol = () => db.collection('sources');

// List all sources
// 可視性ルール:
//   - admin: 全件
//   - 非admin: allowedGroupIds が空 (全員公開) OR 自分の groupId が含まれる
app.get('/', async c => {
  const snap = await sourcesCol().orderBy('createdAt').get();
  let sources = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (sources.length === 0) {
    const doc = {
      name: 'デフォルト',
      method: '',
      allowedGroupIds: [],
      createdAt: new Date().toISOString(),
      createdBy: c.get('uid'),
    };
    const ref = await sourcesCol().add(doc);
    sources.push({ id: ref.id, ...doc });
  }

  const user = c.get('user');
  if (!user.isAdmin) {
    sources = sources.filter(s => {
      const allowed = s.allowedGroupIds || [];
      if (allowed.length === 0) return true; // 全員公開
      return user.groupId && allowed.includes(user.groupId);
    });
  }

  return c.json({ sources });
});

// Create
app.post('/', requirePerm('manageSources'), async c => {
  const body = await c.req.json();
  const name = (body.name || '').trim();
  if (!name) throw httpError(400, 'name is required');
  const doc = {
    name,
    method: body.method || '',
    createdAt: new Date().toISOString(),
    createdBy: c.get('uid'),
  };
  const ref = await sourcesCol().add(doc);
  return c.json({ id: ref.id, ...doc });
});

// Update
// 権限ルール:
//   - name / method / sheetsInput / bqInput → manageSources
//   - allowedGroupIds → manageGroups
app.put('/:id', async c => {
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

  if (!Object.keys(patch).length) return c.json({ ok: true });
  await sourcesCol().doc(id).update(patch);
  return c.json({ ok: true });
});

// Disconnect: clear method + inputs for this source.
app.post('/:id/disconnect', requirePerm('manageSources'), async c => {
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
app.delete('/:id', requirePerm('manageSources'), async c => {
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
  return c.json({ ok: true });
});

export default app;
