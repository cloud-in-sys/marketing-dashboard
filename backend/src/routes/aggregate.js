// POST /api/aggregate — ブラウザ側集計のバックエンド版。
//
// 入力:
//   { sourceId, dims, metrics, filters, viewFilterExpr, cardFilterExpr }
//
// 処理:
//   1) ソース可視性チェック (admin / allowedGroupIds)
//   2) スナップショット rows をキャッシュから取得
//   3) group sourceFilter 適用 (グループに見えてはいけない行をここで除外)
//   4) 入力検証 (dims/metrics は config に存在する key のみ、式は validateExpression)
//   5) viewFilterExpr / cardFilterExpr を適用
//   6) filters (multi-select / range) を適用
//   7) totals (全行集計) と groups (ディメンション別集計) を計算
//   8) groups/totals/rowCount/meta のみ返す (raw rows は絶対に含めない)

import { Hono } from 'hono';
import crypto from 'crypto';
import { db } from '../firebase.js';
import { httpError } from '../middleware/error.js';
import { requireSourceAccess, getGroupFilter, applyGroupFilter } from '../aggregate/sourceAccess.js';
import { getSnapshotRows } from '../aggregate/snapshotCache.js';
import { aggregate, compileViewFilter } from '../aggregate/compute.js';
import { groupRows } from '../aggregate/dimensions.js';
import { DEFAULT_DIMENSIONS, resolveConfig } from '../aggregate/defaults.js';
import { validateExpression } from '../utils/expression.js';

const app = new Hono();

// ----- 入力サイズ上限 -----
const MAX_DIMS = 20;
const MAX_METRICS = 200;
const MAX_FILTERS = 50;
const MAX_FILTER_VALUES = 5000;
const MAX_EXPR_LEN = 2000;

// ----- レスポンスキャッシュ (LRU, 30 秒 TTL) -----
const RESPONSE_CACHE_TTL_MS = 30 * 1000;
const RESPONSE_CACHE_MAX = 200;
const responseCache = new Map(); // key -> { result, expireAt }

function cacheGet(key) {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expireAt) {
    responseCache.delete(key);
    return null;
  }
  // LRU 用に末尾へ
  responseCache.delete(key);
  responseCache.set(key, entry);
  return entry.result;
}

function cacheSet(key, result) {
  if (responseCache.size >= RESPONSE_CACHE_MAX) {
    const oldest = responseCache.keys().next().value;
    if (oldest) responseCache.delete(oldest);
  }
  responseCache.set(key, { result, expireAt: Date.now() + RESPONSE_CACHE_TTL_MS });
}

function hashKey(parts) {
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

// ----- 入力検証 -----
function validateInputs(body, config) {
  if (!body || typeof body !== 'object') throw httpError(400, 'Invalid body');
  const { sourceId, dims, metrics, filters, viewFilterExpr, cardFilterExpr } = body;
  if (typeof sourceId !== 'string' || !sourceId) throw httpError(400, 'sourceId required');

  // dims: 配列 / 存在する key のみ / 上限
  const dimsArr = Array.isArray(dims) ? dims : [];
  if (dimsArr.length > MAX_DIMS) throw httpError(400, `Too many dims (max ${MAX_DIMS})`);
  const dimKeys = new Set([
    ...DEFAULT_DIMENSIONS.map(d => d.key),
    ...(config?.dimensions || []).map(d => d.key),
  ]);
  for (const d of dimsArr) {
    if (typeof d !== 'string') throw httpError(400, 'dims must be array of strings');
    if (!dimKeys.has(d)) throw httpError(400, `Unknown dimension: ${d}`);
  }

  // metrics: 配列 / 存在する key のみ / 上限
  const metricsArr = Array.isArray(metrics) ? metrics : [];
  if (metricsArr.length > MAX_METRICS) throw httpError(400, `Too many metrics (max ${MAX_METRICS})`);
  const metricKeys = new Set((config?.metricDefs || []).map(m => m.key));
  for (const m of metricsArr) {
    if (typeof m !== 'string') throw httpError(400, 'metrics must be array of strings');
    if (!metricKeys.has(m)) throw httpError(400, `Unknown metric: ${m}`);
  }

  // filters: 配列 / 上限 / 構造チェック
  const filtersArr = Array.isArray(filters) ? filters : [];
  if (filtersArr.length > MAX_FILTERS) throw httpError(400, `Too many filters (max ${MAX_FILTERS})`);
  for (const f of filtersArr) {
    if (!f || typeof f !== 'object') throw httpError(400, 'Invalid filter');
    if (typeof f.field !== 'string' || !f.field) throw httpError(400, 'filter.field required');
    if (typeof f.op !== 'string') throw httpError(400, 'filter.op required');
    if (Array.isArray(f.values) && f.values.length > MAX_FILTER_VALUES) {
      throw httpError(400, `Too many filter values (max ${MAX_FILTER_VALUES})`);
    }
  }

  // 式: 長さ + validateExpression
  if (viewFilterExpr != null && viewFilterExpr !== '') {
    if (typeof viewFilterExpr !== 'string' || viewFilterExpr.length > MAX_EXPR_LEN) {
      throw httpError(400, 'viewFilterExpr invalid');
    }
    const err = validateExpression(viewFilterExpr, { label: 'viewFilterExpr' });
    if (err) throw httpError(400, err);
  }
  if (cardFilterExpr != null && cardFilterExpr !== '') {
    if (typeof cardFilterExpr !== 'string' || cardFilterExpr.length > MAX_EXPR_LEN) {
      throw httpError(400, 'cardFilterExpr invalid');
    }
    const err = validateExpression(cardFilterExpr, { label: 'cardFilterExpr' });
    if (err) throw httpError(400, err);
  }

  return { sourceId, dims: dimsArr, metrics: metricsArr, filters: filtersArr, viewFilterExpr, cardFilterExpr };
}

// ----- multi-select / range / 条件フィルタのマッチング -----
// フロント側 frontend/src/filters/index.js の applyFilters / matchCondition と等価なロジック。
function matchFilter(row, f) {
  const v = row[f.field];
  switch (f.op) {
    case 'in': {
      if (!Array.isArray(f.values)) return true;
      const s = String(v ?? '');
      return f.values.some(x => String(x) === s);
    }
    case 'notIn': {
      if (!Array.isArray(f.values)) return true;
      const s = String(v ?? '');
      return !f.values.some(x => String(x) === s);
    }
    case 'between': {
      // 日付/数値レンジ
      const s = String(v ?? '');
      if (f.from != null && f.from !== '' && s < String(f.from)) return false;
      if (f.to != null && f.to !== '' && s > String(f.to)) return false;
      return true;
    }
    case 'dateGte': {
      // 日付正規化 (YYYY-MM-DD, 時刻部削除, / → -)
      const cell = String(v ?? '').slice(0, 10).replace(/\//g, '-');
      const cond = String(f.value ?? '').slice(0, 10).replace(/\//g, '-');
      return cond === '' ? true : cell >= cond;
    }
    case 'dateLte': {
      const cell = String(v ?? '').slice(0, 10).replace(/\//g, '-');
      const cond = String(f.value ?? '').slice(0, 10).replace(/\//g, '-');
      return cond === '' ? true : cell <= cond;
    }
    case 'equals':      return String(v ?? '') === String(f.value ?? '');
    case 'notEquals':   return String(v ?? '') !== String(f.value ?? '');
    case 'contains':    return String(v ?? '').includes(String(f.value ?? ''));
    case 'notContains': return !String(v ?? '').includes(String(f.value ?? ''));
    case 'startsWith':  return String(v ?? '').startsWith(String(f.value ?? ''));
    case 'endsWith':    return String(v ?? '').endsWith(String(f.value ?? ''));
    case 'gt':  return Number(v) >  Number(f.value);
    case 'gte': return Number(v) >= Number(f.value);
    case 'lt':  return Number(v) <  Number(f.value);
    case 'lte': return Number(v) <= Number(f.value);
    case 'empty':    return String(v ?? '') === '';
    case 'notEmpty': return String(v ?? '') !== '';
    default: return true;
  }
}

// 単一集計実行ヘルパー (single / batch エンドポイントで共有)。
// rowsAfterGroup は既に group filter を適用済みの行配列 (accessibleRows = rowsAfterGroup.length)。
//
// 行数の意味:
//   accessibleRows:      group sourceFilter 適用後 (= このユーザーが見える行の総数)
//   followFilteredRows:  上記 + ヘッダの multi-select + 日付フィルタ適用後
//                        ("追従フィルタ" 後の対象行数 — UI ヘッダ「対象行数」はこれを表示)
//   filteredRows:        上記 + view filter (タブの WHERE) + card filter 適用後
//                        (実際に集計関数に渡される行数)
function runAggregation({ rowsAfterGroup, config, input, sourceUpdatedAt, configUpdatedAt, cacheKey }) {
  const cached = cacheKey ? cacheGet(cacheKey) : null;
  if (cached) return { result: cached, cacheHit: true };

  // 全フィルタ段を 1 ループでまとめて適用 (中間配列を作らない)。
  // 旧実装: applyFilters→viewFn→cardFn ごとに rows.filter() で配列をコピーしていた。
  // 大量データではここの中間配列 (N×8B × 3 段) が GC 圧の主因だったので 1-pass に統合。
  const viewFn = compileViewFilter(input.viewFilterExpr);
  const cardFn = compileViewFilter(input.cardFilterExpr);
  const filters = input.filters && input.filters.length ? input.filters : null;
  const rows = [];
  let followFilteredRows = 0;
  for (let i = 0, len = rowsAfterGroup.length; i < len; i++) {
    const r = rowsAfterGroup[i];
    if (filters) {
      let ok = true;
      for (let j = 0; j < filters.length; j++) {
        if (!matchFilter(r, filters[j])) { ok = false; break; }
      }
      if (!ok) continue;
    }
    followFilteredRows++;
    if (viewFn && !viewFn(r)) continue;
    if (cardFn && !cardFn(r)) continue;
    rows.push(r);
  }

  // 集計
  const totalsFull = aggregate(rows, config);
  const totals = {};
  for (const k of input.metrics) totals[k] = totalsFull[k] ?? 0;

  let groups = [];
  if (input.dims.length > 0) {
    const grouped = groupRows(rows, input.dims, config.dimensions || []);
    groups = grouped.map(g => {
      const gAgg = aggregate(g.rows, config);
      const m = {};
      for (const k of input.metrics) m[k] = gAgg[k] ?? 0;
      return { vals: g.vals, metrics: m, rowCount: g.rows.length };
    });
  }

  const result = {
    groups,
    totals,
    filteredRows: rows.length,
    followFilteredRows,
    accessibleRows: rowsAfterGroup.length,
    meta: { sourceUpdatedAt, configUpdatedAt },
  };
  if (cacheKey) cacheSet(cacheKey, result);
  return { result, cacheHit: false };
}

function buildCacheKey(sid, user, sourceUpdatedAt, configUpdatedAt, input) {
  return hashKey([
    sid,
    user.isAdmin ? 'admin' : (user.groupId || 'nogroup'),
    sourceUpdatedAt,
    configUpdatedAt,
    input.dims,
    input.metrics,
    input.filters,
    input.viewFilterExpr || '',
    input.cardFilterExpr || '',
  ]);
}

// ----- メインルート -----
app.post('/', async c => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  if (!body) throw httpError(400, 'Invalid JSON');

  if (typeof body.sourceId !== 'string') throw httpError(400, 'sourceId required');
  const sid = body.sourceId;

  await requireSourceAccess(user, sid);

  const cfgSnap = await db.collection('sources').doc(sid).collection('config').doc('current').get();
  const config = resolveConfig(cfgSnap.exists ? cfgSnap.data() : {});
  const configUpdatedAt = config.updatedAt || '';

  const input = validateInputs(body, config);

  const snap = await getSnapshotRows(sid);
  if (!snap) {
    return c.json({ groups: [], totals: {}, filteredRows: 0, followFilteredRows: 0, accessibleRows: 0, meta: { sourceUpdatedAt: null, configUpdatedAt } });
  }
  const { rows: rawRows, updatedAt: sourceUpdatedAt } = snap;

  const groupFilter = await getGroupFilter(user, sid);
  const rowsAfterGroup = applyGroupFilter(rawRows, groupFilter);

  const cacheKey = buildCacheKey(sid, user, sourceUpdatedAt, configUpdatedAt, input);
  const { result, cacheHit } = runAggregation({
    rowsAfterGroup, config, input, sourceUpdatedAt, configUpdatedAt, cacheKey,
  });
  c.header('X-Aggregate-Cache', cacheHit ? 'hit' : 'miss');
  return c.json(result);
});

// ----- バッチルート -----
// 1 リクエストで複数集計をまとめて実行。snapshot ロード + group filter を 1 回だけにする。
//
// 入力: { sourceId, requests: [{ id, dims, metrics, filters, viewFilterExpr, cardFilterExpr }] }
// 出力: { results: { [id]: { groups, totals, filteredRows, ... } }, meta }
const MAX_BATCH_REQUESTS = 30;
app.post('/batch', async c => {
  const startedAt = Date.now();
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  if (!body) throw httpError(400, 'Invalid JSON');
  if (typeof body.sourceId !== 'string') throw httpError(400, 'sourceId required');
  const sid = body.sourceId;
  const requests = Array.isArray(body.requests) ? body.requests : [];
  if (requests.length === 0) throw httpError(400, 'requests required');
  if (requests.length > MAX_BATCH_REQUESTS) throw httpError(400, `Too many requests (max ${MAX_BATCH_REQUESTS})`);

  await requireSourceAccess(user, sid);

  const cfgSnap = await db.collection('sources').doc(sid).collection('config').doc('current').get();
  const config = resolveConfig(cfgSnap.exists ? cfgSnap.data() : {});
  const configUpdatedAt = config.updatedAt || '';

  // 各サブリクエストの入力検証 (1 件でも不正なら全体を 400)
  const validated = requests.map((r, idx) => {
    if (!r || typeof r !== 'object') throw httpError(400, `requests[${idx}] invalid`);
    if (typeof r.id !== 'string' || !r.id) throw httpError(400, `requests[${idx}].id required`);
    return { id: r.id, input: validateInputs({ ...r, sourceId: sid }, config) };
  });

  const snap = await getSnapshotRows(sid);
  if (!snap) {
    const emptyResults = {};
    for (const v of validated) {
      emptyResults[v.id] = { groups: [], totals: {}, filteredRows: 0, followFilteredRows: 0, accessibleRows: 0, meta: { sourceUpdatedAt: null, configUpdatedAt } };
    }
    console.log(JSON.stringify({ severity: 'INFO', kind: 'aggregate-batch', sid, requestCount: validated.length, snapshotMissing: true, durationMs: Date.now() - startedAt }));
    return c.json({ results: emptyResults, meta: { sourceUpdatedAt: null, configUpdatedAt } });
  }
  const { rows: rawRows, updatedAt: sourceUpdatedAt } = snap;
  const groupFilter = await getGroupFilter(user, sid);
  const rowsAfterGroup = applyGroupFilter(rawRows, groupFilter);
  const accessibleRows = rowsAfterGroup.length;

  const results = {};
  let hits = 0, misses = 0;
  let maxFilteredRows = 0;
  let totalGroupCount = 0;
  for (const v of validated) {
    const cacheKey = buildCacheKey(sid, user, sourceUpdatedAt, configUpdatedAt, v.input);
    const { result, cacheHit } = runAggregation({
      rowsAfterGroup, config, input: v.input, sourceUpdatedAt, configUpdatedAt, cacheKey,
    });
    results[v.id] = result;
    if (cacheHit) hits++; else misses++;
    if ((result.filteredRows || 0) > maxFilteredRows) maxFilteredRows = result.filteredRows || 0;
    totalGroupCount += (result.groups?.length || 0);
  }
  c.header('X-Aggregate-Batch', `hits=${hits},misses=${misses}`);

  // 構造化ログ: 502/OOM/timeout 切り分け用。raw row や個人情報は出さない。
  const durationMs = Date.now() - startedAt;
  console.log(JSON.stringify({
    severity: durationMs > 5000 ? 'WARNING' : 'INFO',
    kind: 'aggregate-batch',
    sid,
    rawRows: rawRows.length,
    accessibleRows,
    maxFilteredRows,
    requestCount: validated.length,
    hits,
    misses,
    totalGroupCount,
    durationMs,
  }));
  return c.json({ results, meta: { sourceUpdatedAt, configUpdatedAt } });
});

// POST /api/aggregate/options
// 指定 field の distinct 値配列を返す (フィルタ UI の選択肢用)。
// 現在の interaction filter は無視 (フロント getOptions(S.RAW, field) と同じ挙動)。
//
// 入力: { sourceId, fields: ['operator', 'media'], limit? }
// 出力: { options: { operator: ['A社', ...], ... }, meta: {...} }
const MAX_OPTION_FIELDS = 50;
const DEFAULT_OPTION_LIMIT = 5000;

// options レスポンスキャッシュ: sourceUpdatedAt + groupKey + fieldsKey で
// 同条件なら全行 scan を回避。snapshot が更新されると key が変わって自動 miss。
const OPTIONS_CACHE_TTL_MS = 10 * 60 * 1000;  // 10 分 (snapshot 更新で key が変わるので TTL は余裕めで OK)
const OPTIONS_CACHE_MAX = 50;
const optionsCache = new Map();
function optionsCacheGet(key) {
  const e = optionsCache.get(key);
  if (!e) return null;
  if (Date.now() > e.expireAt) { optionsCache.delete(key); return null; }
  optionsCache.delete(key); optionsCache.set(key, e);
  return e.result;
}
function optionsCacheSet(key, result) {
  if (optionsCache.size >= OPTIONS_CACHE_MAX) {
    const oldest = optionsCache.keys().next().value;
    if (oldest) optionsCache.delete(oldest);
  }
  optionsCache.set(key, { result, expireAt: Date.now() + OPTIONS_CACHE_TTL_MS });
}

app.post('/options', async c => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.sourceId !== 'string') throw httpError(400, 'sourceId required');
  const sid = body.sourceId;
  const fields = Array.isArray(body.fields) ? body.fields : [];
  if (fields.length === 0) throw httpError(400, 'fields required');
  if (fields.length > MAX_OPTION_FIELDS) throw httpError(400, `Too many fields (max ${MAX_OPTION_FIELDS})`);
  // CSV/Sheets の実カラム名は日本語・スペース・ハイフン等を含むので緩める。
  // r[f] は読み込み専用なので任意キーで安全 (`__proto__` 等も既定で undefined を返す)。
  for (const f of fields) {
    if (typeof f !== 'string' || f.length === 0 || f.length > 200) {
      throw httpError(400, `Invalid field name`);
    }
  }
  const limit = Math.min(Math.max(Number(body.limit) || DEFAULT_OPTION_LIMIT, 1), DEFAULT_OPTION_LIMIT);

  await requireSourceAccess(user, sid);
  const snap = await getSnapshotRows(sid);
  if (!snap) return c.json({ options: {}, meta: { sourceUpdatedAt: null } });
  const { rows: rawRows, updatedAt: sourceUpdatedAt } = snap;
  const groupFilter = await getGroupFilter(user, sid);

  // sourceUpdatedAt + groupKey + fieldsKey でキャッシュ。snapshot 更新で key 変わって自動 miss。
  const groupKey = user.isAdmin ? 'admin' : (user.groupId || 'nogroup');
  const fieldsKey = [...fields].sort().join(',');
  const cacheKey = `${sid}|${sourceUpdatedAt}|${groupKey}|${fieldsKey}|${limit}`;
  const cached = optionsCacheGet(cacheKey);
  if (cached) {
    c.header('X-Options-Cache', 'hit');
    return c.json(cached);
  }

  const rows = applyGroupFilter(rawRows, groupFilter);
  const sets = {};
  for (const f of fields) sets[f] = new Set();
  for (let i = 0, len = rows.length; i < len; i++) {
    const r = rows[i];
    for (const f of fields) {
      const v = r[f];
      if (v != null && v !== '') sets[f].add(v);
    }
  }
  const options = {};
  for (const f of fields) {
    const arr = [...sets[f]].sort();
    options[f] = arr.slice(0, limit);
  }
  const result = { options, meta: { sourceUpdatedAt } };
  optionsCacheSet(cacheKey, result);
  c.header('X-Options-Cache', 'miss');
  return c.json(result);
});

// POST /api/aggregate/columns
// 設定画面のカラム一覧プレビュー用。snapshot の全カラム名 + 各カラムの先頭 5 件の
// 非空 distinct サンプルと、数値らしさの判定を返す。
//
// 入力: { sourceId }
// 出力: { columns: [{ name, samples: [], isNumeric }], accessibleRows, sourceUpdatedAt }
// (accessibleRows = group filter 適用後の行数。設定画面プレビュー用であり「対象行数」ではない)
const columnsCache = new Map();
function columnsCacheGet(key) {
  const e = columnsCache.get(key);
  if (!e) return null;
  if (Date.now() > e.expireAt) { columnsCache.delete(key); return null; }
  columnsCache.delete(key); columnsCache.set(key, e);
  return e.result;
}
function columnsCacheSet(key, result) {
  if (columnsCache.size >= 30) {
    const oldest = columnsCache.keys().next().value;
    if (oldest) columnsCache.delete(oldest);
  }
  columnsCache.set(key, { result, expireAt: Date.now() + OPTIONS_CACHE_TTL_MS });
}

app.post('/columns', async c => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.sourceId !== 'string') throw httpError(400, 'sourceId required');
  const sid = body.sourceId;
  await requireSourceAccess(user, sid);
  const snap = await getSnapshotRows(sid);
  if (!snap) return c.json({ columns: [], accessibleRows: 0, sourceUpdatedAt: null });
  const { rows: rawRows, updatedAt: sourceUpdatedAt } = snap;
  const groupFilter = await getGroupFilter(user, sid);

  // sourceUpdatedAt + groupKey でキャッシュ
  const groupKey = user.isAdmin ? 'admin' : (user.groupId || 'nogroup');
  const cacheKey = `${sid}|${sourceUpdatedAt}|${groupKey}`;
  const cached = columnsCacheGet(cacheKey);
  if (cached) {
    c.header('X-Columns-Cache', 'hit');
    return c.json(cached);
  }

  const rows = applyGroupFilter(rawRows, groupFilter);
  if (rows.length === 0) {
    const r = { columns: [], accessibleRows: 0, sourceUpdatedAt };
    columnsCacheSet(cacheKey, r);
    return c.json(r);
  }

  // カラム名は最初の数行で union を取る (一行目に欠落がある場合に備える)
  const colSet = new Set();
  const SCAN_HEADER = Math.min(rows.length, 20);
  for (let i = 0; i < SCAN_HEADER; i++) {
    for (const k of Object.keys(rows[i])) colSet.add(k);
  }
  const cols = [...colSet];

  // 各カラムの distinct sample (最大 5 件) + 数値判定 (10 件の先頭値が全て数値なら numeric)
  const out = [];
  for (const name of cols) {
    const samples = [];
    const seen = new Set();
    let numericTest = [];
    for (let i = 0, len = rows.length; i < len; i++) {
      const v = rows[i][name];
      if (v == null || v === '') continue;
      if (numericTest.length < 10) numericTest.push(v);
      if (seen.has(v)) continue;
      seen.add(v);
      samples.push(v);
      if (samples.length >= 5 && numericTest.length >= 10) break;
    }
    const isNumeric = numericTest.length > 0 && numericTest.every(v => !isNaN(Number(v)) && v !== '');
    out.push({ name, samples, isNumeric });
  }

  const result = { columns: out, accessibleRows: rows.length, sourceUpdatedAt };
  columnsCacheSet(cacheKey, result);
  c.header('X-Columns-Cache', 'miss');
  return c.json(result);
});

export default app;
