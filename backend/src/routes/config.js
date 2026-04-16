import { Hono } from 'hono';
import { db } from '../firebase.js';
import { httpError } from '../middleware/error.js';
import { requireSourceAccess } from '../middleware/auth.js';
import { validateConfigExpressions, diffExpressionFields } from '../utils/expression.js';

const app = new Hono();

const configDoc = (sid) =>
  db.collection('sources').doc(sid).collection('config').doc('current');

// チーム共有(編集権限が必要): メトリクス/フィルタ/ディメンション/ビュー定義など
const METRICS_FIELDS    = ['metricDefs', 'baseFormulas', 'formulas'];
const FILTERS_FIELDS    = ['filterDefs'];
const DIMENSIONS_FIELDS = ['dimensions'];
const DEFAULTS_FIELDS   = ['views'];
// viewOrder / customTabs はユーザーが自由に並べ替え/追加するUI寄りの情報なので
// 権限ゲートしない(shared だが誰でも書ける)
const FIELD_PERM = {};
METRICS_FIELDS.forEach(f => FIELD_PERM[f] = 'editMetrics');
FILTERS_FIELDS.forEach(f => FIELD_PERM[f] = 'editFilters');
DIMENSIONS_FIELDS.forEach(f => FIELD_PERM[f] = 'editDimensions');
DEFAULTS_FIELDS.forEach(f => FIELD_PERM[f] = 'editDefaults');

// UI状態 (per-user 的だが shared config に置いているため誰でも書ける): state, colWidths
// ※将来的には per-user ドキュメントに分離が望ましい

function checkFieldPerms(body, user) {
  if (user?.isAdmin) return null;
  for (const key of Object.keys(body || {})) {
    const required = FIELD_PERM[key];
    if (required && !user?.perms?.[required]) {
      return required;
    }
  }
  return null;
}

app.get('/:sid', requireSourceAccess(), async c => {
  const sid = c.req.param('sid');
  const snap = await configDoc(sid).get();
  return c.json({ config: snap.exists ? snap.data() : null });
});

// 差分を式変更履歴として Firestore に記録 (非同期 / best-effort)
async function logExpressionHistory(sid, before, after, user) {
  try {
    const diffs = diffExpressionFields(before, after);
    if (!diffs.length) return;
    const col = db.collection('sources').doc(sid).collection('expressionHistory');
    const now = new Date().toISOString();
    const batch = db.batch();
    diffs.forEach(d => {
      batch.set(col.doc(), {
        ...d,
        changedBy: user?.uid || null,
        changedByEmail: user?.email || null,
        changedAt: now,
      });
    });
    await batch.commit();
  } catch (e) {
    // 構造化ログで確実に残す(Cloud Logging で検索可能)
    console.log(JSON.stringify({
      severity: 'ERROR',
      message: 'expression history write failed',
      sid,
      changedBy: user?.uid || null,
      changedByEmail: user?.email || null,
      error: e.message,
    }));
  }
}

app.put('/:sid', requireSourceAccess(), async c => {
  const sid = c.req.param('sid');
  const body = await c.req.json();
  if (!body || typeof body !== 'object') throw httpError(400, 'Body must be an object');
  const user = c.get('user');
  const missing = checkFieldPerms(body, user);
  if (missing) return c.json({ error: `Missing permission: ${missing}` }, 403);
  const invalid = validateConfigExpressions(body);
  if (invalid) return c.json({ error: `Invalid expression: ${invalid}` }, 400);
  const beforeSnap = await configDoc(sid).get();
  const before = beforeSnap.exists ? beforeSnap.data() : {};
  await configDoc(sid).set({ ...body, updatedAt: new Date().toISOString() });
  logExpressionHistory(sid, before, body, user);
  return c.json({ ok: true });
});

app.patch('/:sid', requireSourceAccess(), async c => {
  const sid = c.req.param('sid');
  const body = await c.req.json();
  if (!body || typeof body !== 'object') throw httpError(400, 'Body must be an object');
  const user = c.get('user');
  const missing = checkFieldPerms(body, user);
  if (missing) return c.json({ error: `Missing permission: ${missing}` }, 403);
  const invalid = validateConfigExpressions(body);
  if (invalid) return c.json({ error: `Invalid expression: ${invalid}` }, 400);
  const beforeSnap = await configDoc(sid).get();
  const before = beforeSnap.exists ? beforeSnap.data() : {};
  await configDoc(sid).set({ ...body, updatedAt: new Date().toISOString() }, { merge: true });
  logExpressionHistory(sid, before, { ...before, ...body }, user);
  return c.json({ ok: true });
});

export default app;
