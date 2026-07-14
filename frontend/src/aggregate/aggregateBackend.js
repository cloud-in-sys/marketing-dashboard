// バックエンド集計の prefetch ヘルパー。
//
// render の冒頭で prefetchAggregates(rows) を await すると、必要な集計を並列で
// API から取得して aggregateCache へ格納する。後段の aggregate() / groupRows()
// は cache を覗いてヒットすればローカル計算をスキップ → ブラウザは描画専用に。

import { S } from '../app/state.js';
import { api } from '../api/index.js';
import { FEATURES, dlog } from '../app/config.js';
import { setBackendCache, dimsKeyFor } from './aggregateCache.js';
import { hasVisibleSparklineMetric } from '../features/dashboard/table/sparkline.js';
import { resolveDateFilter } from '../filters/dateFilter.js';

// S.FILTER_VALUES / S.FILTER_CONDITIONS / FILTER_DEFS から API 用フィルタ配列を生成。
// API への送信内容と cacheKey 安定化のため、values は文字列化してソートする。
// 「A → B → A」と「B → A」が同じ条件なら同じ key になり、cache hit する。
export function serializeFilters() {
  const out = [];
  const defs = S.FILTER_DEFS || [];
  const values = S.FILTER_VALUES || {};
  const conds = S.FILTER_CONDITIONS || {};
  for (const def of defs) {
    const v = values[def.id];
    if (def.type === 'date_from') {
      if (v) out.push({ field: def.field, op: 'dateGte', value: v });
    } else if (def.type === 'date_to') {
      if (v) out.push({ field: def.field, op: 'dateLte', value: v });
    } else if (def.type === 'date_range') {
      // {from, to} を dateGte / dateLte の2条件に展開
      if (v && typeof v === 'object') {
        if (v.from) out.push({ field: def.field, op: 'dateGte', value: v.from });
        if (v.to) out.push({ field: def.field, op: 'dateLte', value: v.to });
      }
    } else if (def.type === 'multi') {
      if (v instanceof Set && v.size > 0) {
        // 選択順に依存しないよう values を文字列化してソート
        const sorted = [...v].map(x => String(x)).sort();
        out.push({ field: def.field, op: 'in', values: sorted });
      }
      const cond = conds[def.id];
      if (cond && cond.op && cond.op !== 'none') {
        out.push({ field: def.field, op: cond.op, value: cond.value });
      }
    }
  }
  return out;
}

// カードの latest_month / prev_month 用にターゲット月を計算する。
// 期間フィルタが閉じている (from/to 両方あり) → TO 日付の月を基準にする。
// 開いている → 昨日基準。
// follow / 未知のモードは null を返す → カードのバックエンド prefetch 対象外。
function computeCardMonthFilter(card) {
  const mode = card.filterMode || 'follow';
  if (mode !== 'latest_month' && mode !== 'prev_month' && mode !== 'current_month') return null;
  const { field, from: fromVal, to: toVal } = resolveDateFilter();
  let target;
  if (mode === 'current_month') {
    // 「今月」はカレンダー上の当月を無条件で使う (フィルタ範囲外なら 0 件)
    const d = new Date();
    target = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  } else if (fromVal && toVal) {
    const baseMonth = String(toVal).slice(0, 7);
    target = mode === 'latest_month' ? baseMonth : monthSubtract(baseMonth, 1);
  } else {
    target = yesterdayMonth(mode === 'prev_month' ? 1 : 0);
  }
  if (!target) return null;
  return { field, op: 'startsWith', value: target };
}

function yesterdayMonth(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setMonth(d.getMonth() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthSubtract(yyyymm, offset) {
  const [y, m] = yyyymm.split('-').map(Number);
  if (!y || !m) return '';
  const d = new Date(y, m - 1 - offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ===== フロント側のリクエストキャッシュ =====
// 同じ条件 (sid + view + filters + dims + cards) で render が再発火しても
// バックエンドを再度叩かないように、cacheKey ベースの Map で保持。
// TTL: 5 分。LRU で上限 50 件。
// 同一 cacheKey の並行リクエストは in-flight Map で 1 本に束ねる (dedupe)。
const KEYED_CACHE_TTL_MS = 5 * 60 * 1000;
const KEYED_CACHE_MAX = 50;
const keyedCache = new Map();    // cacheKey -> { cache, expiresAt }
const inflightByKey = new Map(); // cacheKey -> Promise<cache>

function keyedCacheGet(key) {
  const entry = keyedCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { keyedCache.delete(key); return null; }
  // LRU 用に末尾へ
  keyedCache.delete(key);
  keyedCache.set(key, entry);
  return entry.cache;
}

function keyedCacheSet(key, cache) {
  if (keyedCache.size >= KEYED_CACHE_MAX) {
    const oldest = keyedCache.keys().next().value;
    if (oldest) keyedCache.delete(oldest);
  }
  keyedCache.set(key, { cache, expiresAt: Date.now() + KEYED_CACHE_TTL_MS });
}

// source 切替や config 編集を反映するため、外部 (sources.js / state.js) から
// 呼び出してキャッシュ全体を捨てられる API。
export function invalidateAggregateCache() {
  keyedCache.clear();
  // in-flight は abort できないので残す (返ってきても破棄される)
}

// 現在のビュー状態から prefetch すべき dim 組合せ (配列の配列) を抽出。
// 重複は dimsKeyFor で除去 (例: 同じ xDim を使うチャートが複数あっても 1 リクエスト)。
function collectPrefetchDimCombos() {
  const seen = new Map(); // key -> dims[]
  const add = dims => { const k = dimsKeyFor(dims); if (!seen.has(k)) seen.set(k, dims); };
  add([]);  // totals
  const tableDims = S.SELECTED_DIMS.length ? S.SELECTED_DIMS : ['action_date'];
  add(tableDims);
  const defaultX = S.SELECTED_DIMS[0] || 'action_date';
  for (const c of (S.CHARTS || [])) {
    const xDim = c.bucket && c.bucket !== 'auto' ? c.bucket : defaultX;
    if (!xDim) continue;
    const stackDim = c.stackBy || '';
    if (stackDim && stackDim !== xDim) add([xDim, stackDim]);
    else add([xDim]);
  }
  // sparkline メトリクスが表示中なら [...tableDims, 'action_date'] も取得
  // (各 row の時系列バケットを backend で 1 ショット集計)
  if (hasVisibleSparklineMetric()) {
    if (!tableDims.includes('action_date')) add([...tableDims, 'action_date']);
  }
  return [...seen.values()];
}

// 最新の in-flight aggregate request の AbortController。
// 新しい render が始まるたびに前回のを abort する → 古いリクエストが
// 走り続けて Cloud Run に余計な負荷をかけるのを防ぐ。
let currentAbortController = null;

// source 切替などの外部イベントから即座に aggregate を abort するための公開 API。
// reloadFullUI の冒頭で呼ぶことで、前 source のタブ aggregate が
// Cloud Run 上で走り続ける時間を 300ms 程度短縮できる。
export function abortInFlightAggregate(reason = 'external') {
  if (currentAbortController) {
    dlog('aggregate abort (external)', { reason });
    currentAbortController.abort();
    currentAbortController = null;
  }
}

// render の冒頭で呼び、API から必要な集計を並列取得して rows 参照に紐付けたキャッシュへ格納。
// 戻り値: { ok: true } 成功 / { ok: false, error } 失敗 / { ok: true, skipped: true } 対象なし
//        / { ok: true, aborted: true } 古い render なので abort された (エラー扱いしない)
//
// 重要: useBackendAggregate ON で S.RAW を持たない構成では、ここが失敗すると aggregate([])
// が 0 を返し続け「全タブ 0」状態になる。呼び出し側 (main.js render) は ok=false を見て
// エラーバナーを出し、レンダラの呼び出しを中止する責務がある。
export async function prefetchAggregates(rows) {
  if (!FEATURES.useBackendAggregate) return { ok: true, skipped: true };
  const sid = S.CURRENT_SOURCE;
  if (!sid) return { ok: true, skipped: true };
  const allMetrics = (S.METRIC_DEFS || []).map(m => m.key);
  if (allMetrics.length === 0) return { ok: true, skipped: true };
  const filters = serializeFilters();
  const viewFilterExpr = S.VIEWS[S.CURRENT_VIEW]?.filterExpr || '';
  const dimCombos = collectPrefetchDimCombos();

  // 非 follow カードの prefetch 対象も収集
  const cardJobs = [];
  for (const card of (S.CARDS || [])) {
    const monthFilter = computeCardMonthFilter(card);
    if (monthFilter) cardJobs.push({ cardId: card.id, monthFilter });
  }

  // すべての集計を 1 リクエスト (POST /api/aggregate/batch) にまとめる。
  // snapshot ロード + group filter を backend で 1 回しか走らせない。
  const batchRequests = [];
  for (let i = 0; i < dimCombos.length; i++) {
    batchRequests.push({
      id: `dim:${i}`,
      dims: dimCombos[i], metrics: allMetrics, filters, viewFilterExpr,
    });
  }
  for (const j of cardJobs) {
    batchRequests.push({
      id: `card:${j.cardId}`,
      dims: [], metrics: allMetrics,
      filters: [...filters, j.monthFilter], viewFilterExpr,
    });
  }

  // ===== cacheKey: ビュー状態を一意に表すキー =====
  // 入力 (batchRequests と等価) を JSON 化して key にする。同じ条件で render が
  // 再発火しても backend を呼ばずに前回結果を流用。
  // 含める要素:
  //   - sid + sourceUpdatedAt: snapshot 更新で自動 invalidate
  //   - view / dims / cards / metrics / viewFilterExpr: 表示条件
  //   - filters: 安定化のため field, op, value/values でソート済みオブジェクト
  //   - formula / dimension: admin 編集で変わるので含める (5 分 TTL でも保険)
  const sourceUpdatedAt = (S.SOURCE_SNAPSHOT_UPDATED_AT && S.SOURCE_SNAPSHOT_UPDATED_AT[sid]) || '';
  // filters の配列順は serializeFilters が定義順で出すので元々安定だが、
  // 念のため field+op で並べて key 化することでさらにぶれを抑える。
  const filtersForKey = [...filters].sort((a, b) => {
    if (a.field !== b.field) return a.field < b.field ? -1 : 1;
    return (a.op || '') < (b.op || '') ? -1 : 1;
  });
  const cacheKey = JSON.stringify({
    sid,
    sourceUpdatedAt,
    view: S.CURRENT_VIEW,
    dims: dimCombos.map(d => d.join('|')),
    cards: cardJobs.map(j => `${j.cardId}:${j.monthFilter.value}`),
    metricsKey: allMetrics.join(','),
    filtersKey: JSON.stringify(filtersForKey),
    viewFilterExpr,
    baseFmls: JSON.stringify(S.BASE_FORMULAS || {}),
    derivedFmls: JSON.stringify(S.METRIC_FORMULAS || {}),
    dimDefs: JSON.stringify((S.DIMENSIONS || []).map(d => [d.key, d.field, d.type, d.expression || '', d.weekStart ?? ''])),
  });

  // 1) cache hit (フロント側 TTL 5分)
  const hit = keyedCacheGet(cacheKey);
  if (hit) {
    dlog('prefetch cache hit (frontend)', { sid, view: S.CURRENT_VIEW });
    setBackendCache(rows, hit);
    return { ok: true, cached: true };
  }

  // 2) in-flight: 同じ cacheKey で別 render が既に投げているなら結果を共有
  const inflight = inflightByKey.get(cacheKey);
  if (inflight) {
    dlog('prefetch in-flight dedupe', { sid, view: S.CURRENT_VIEW });
    try {
      const sharedCache = await inflight;
      setBackendCache(rows, sharedCache);
      return { ok: true, cached: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  dlog('prefetch start', {
    sid, view: S.CURRENT_VIEW,
    dimCombos: dimCombos.map(d => d.join('+') || '(totals)'),
    filterCount: filters.length,
    viewFilter: !!viewFilterExpr,
    cards: cardJobs.length,
  });

  // 3) miss: 実 API 発火。promise を inflight に登録して同条件の並行 render を dedupe。
  // AbortController で前回 in-flight をキャンセル: タブ連打時に古いリクエストが
  // バックエンドに残り続けるのを防ぐ。abort された fetch はネットワーク層で
  // キャンセルされ、Cloud Run も socket close で abort 検知できる。
  if (currentAbortController) currentAbortController.abort();
  const controller = new AbortController();
  currentAbortController = controller;
  const promise = (async () => {
    const resp = await api.aggregateBatch({ sourceId: sid, requests: batchRequests }, { signal: controller.signal });
    const cache = {
      totals: {},
      groupsByDimsKey: new Map(),
      cardAggs: new Map(),
      filteredRows: 0,
      followFilteredRows: 0,
    };
    for (let i = 0; i < dimCombos.length; i++) {
      const dims = dimCombos[i];
      const res = resp.results[`dim:${i}`] || {};
      if (dims.length === 0) {
        cache.totals = res.totals || {};
        cache.filteredRows = res.filteredRows ?? 0;
        cache.followFilteredRows = res.followFilteredRows ?? 0;
      } else {
        cache.groupsByDimsKey.set(dimsKeyFor(dims), res.groups || []);
      }
    }
    for (const j of cardJobs) {
      const res = resp.results[`card:${j.cardId}`] || {};
      cache.cardAggs.set(j.cardId, res.totals || {});
    }
    keyedCacheSet(cacheKey, cache);
    return cache;
  })();
  inflightByKey.set(cacheKey, promise);

  let cache;
  try {
    cache = await promise;
  } catch (e) {
    if (e?.code === 'aborted') {
      dlog('prefetch aborted (newer render took over)', { sid });
      return { ok: true, aborted: true };
    }
    const msg = e?.message || String(e);
    console.warn('[backend aggregate] prefetch failed', msg);
    return { ok: false, error: msg };
  } finally {
    inflightByKey.delete(cacheKey);
    if (currentAbortController === controller) currentAbortController = null;
  }

  setBackendCache(rows, cache);
  dlog('prefetch end', { sid, filteredRows: cache.filteredRows, groupKeys: cache.groupsByDimsKey.size, cardCount: cache.cardAggs.size });
  return { ok: true };
}
