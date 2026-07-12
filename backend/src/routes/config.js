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

// 検証のみ (副作用なし)。frontend の live validation 用。
// body の全式を validate して、通ればステータス 200 と { ok: true }、
// 弾かれれば 400 と { ok: false, error, field, detail } を返す。
app.post('/:sid/validate', requireSourceAccess(), async c => {
  const body = await c.req.json();
  if (!body || typeof body !== 'object') throw httpError(400, 'Body must be an object');
  const invalid = validateConfigExpressions(body);
  if (invalid) {
    return c.json({
      ok: false,
      error: 'Invalid expression',
      field: invalid.field,
      detail: invalid.detail,
    }, 400);
  }
  return c.json({ ok: true });
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
  if (invalid) return c.json({
    error: 'Invalid expression',
    field: invalid.field,
    detail: invalid.detail,
    // 後方互換: 旧 frontend が message から parse する経路のために文字列 message も含める
    message: `Invalid expression: ${invalid.field}: expression error: ${invalid.detail}`,
  }, 400);
  const beforeSnap = await configDoc(sid).get();
  const before = beforeSnap.exists ? beforeSnap.data() : {};
  // セキュリティ: PUT は doc 全体を上書きするので、権限のないフィールドを body から
  // 「省略」することで既存値を実質削除できる脆弱性がある (ex: editMetrics 権限を
  // 持たない user が他のフィールドだけ送って metricDefs を消去)。
  // gated field は、対応する permission を持たない限り body の有無に関わらず
  // 既存値を保つ。admin は通常通り全フィールド上書き可能。
  const final = { ...body };
  if (!user?.isAdmin) {
    for (const [field, perm] of Object.entries(FIELD_PERM)) {
      if (!user?.perms?.[perm] && (field in before)) {
        final[field] = before[field];
      }
    }
  }
  final.updatedAt = new Date().toISOString();
  await configDoc(sid).set(final);
  logExpressionHistory(sid, before, final, user);
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
  if (invalid) return c.json({
    error: 'Invalid expression',
    field: invalid.field,
    detail: invalid.detail,
    message: `Invalid expression: ${invalid.field}: expression error: ${invalid.detail}`,
  }, 400);
  const docRef = configDoc(sid);
  const beforeSnap = await docRef.get();
  const before = beforeSnap.exists ? beforeSnap.data() : {};
  // update() を使ってトップレベルフィールドを完全置換する。
  // set({merge:true}) だと map 型(views など)が deep merge され、削除キーが残ってしまう。
  const patch = { ...body, updatedAt: new Date().toISOString() };
  if (beforeSnap.exists) {
    await docRef.update(patch);
  } else {
    await docRef.set(patch);
  }
  logExpressionHistory(sid, before, { ...before, ...body }, user);
  return c.json({ ok: true });
});

export default app;
