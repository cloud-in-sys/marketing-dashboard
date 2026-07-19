// バックエンド集計のフロント側キャッシュ。WeakMap で rows 参照ごとに保持。
//
// 書き込み: aggregate/aggregateBackend.js (prefetchAggregates が API 取得後にセット)
// 読み込み: aggregate/aggregate.js / aggregate/dimensions.js (各レンダラの直前)
//
// FEATURES.useBackendAggregate が false のときは常に null を返す → ローカル経路。
//
// 行数の用語:
//   totalRows      snapshot meta の全行数 (このモジュールでは扱わない)
//   accessibleRows group sourceFilter 適用後の行数 (このモジュールでは扱わない)
//   filteredRows   現在のタブのフィルタ全て適用後 ← UI の「対象行数」はこれ

import { FEATURES } from '@app/config.ts';

// dimensions.js の dimsKey と一致するセパレータ (U+0001)。
const SEP = String.fromCharCode(1);

/** prefetchAggregates が rows 参照ごとに詰める中身 */
export interface BackendCacheEntry {
  totals?: Record<string, number> | null;
  /** dims の join(SEP) -> グループ配列 */
  groupsByDimsKey: Map<string, { vals: any[]; metrics: Record<string, number> }[]>;
  /** card.id -> per-card aggregate (latest_month / prev_month 用) */
  cardAggs?: Map<any, any> | null;
  /** 追従フィルタ適用後・タブ WHERE 適用前の行数 */
  followFilteredRows?: number | null;
  /** そのタブのフィルタを全て適用した後の行数 (UI の「対象行数」) */
  filteredRows?: number | null;
}

/** API に送るフィルタ 1 件。op によって value / values のどちらを使うかが決まる */
export interface FilterSpec {
  field: string;
  op: string;
  value?: any;
  values?: string[];
}

const backendCache = new WeakMap<object, BackendCacheEntry>();

export function setBackendCache(rows: object, cache: BackendCacheEntry) {
  backendCache.set(rows, cache);
}

// rows に対する prefetch 済み totals を返す。なければ null。
export function getBackendTotals(rows: object) {
  if (!FEATURES.useBackendAggregate) return null;
  const entry = backendCache.get(rows);
  return entry?.totals || null;
}

// rows に対する prefetch 済み groups を groupRows と同じ形に整えて返す。
// 戻り値要素は { vals, rows: [], agg } (agg はメトリクス連想配列)。
export function getBackendGroups(rows: object, dims: string[]) {
  if (!FEATURES.useBackendAggregate) return null;
  const entry = backendCache.get(rows);
  if (!entry) return null;
  const key = dims.join(SEP);
  const groups = entry.groupsByDimsKey.get(key);
  if (!groups) return null;
  return groups.map(g => ({ vals: g.vals, rows: [], agg: g.metrics }));
}

// aggregateBackend.js が同じ key を使えるよう公開。
export function dimsKeyFor(dims: string[]): string {
  return dims.join(SEP);
}

// card.id ごとの per-card aggregate (latest_month / prev_month 用) を取得。
export function getBackendCardAgg(rows: object, cardId: any) {
  if (!FEATURES.useBackendAggregate) return null;
  const entry = backendCache.get(rows);
  if (!entry || !entry.cardAggs) return null;
  return entry.cardAggs.get(cardId) || null;
}

// 「対象行数」UI ヘッダ表示用: 追従フィルタ (ヘッダ multi-select + 日付) 適用後、
// タブ WHERE 適用前の行数。
export function getBackendFollowFilteredRows(rows: object) {
  if (!FEATURES.useBackendAggregate) return null;
  const entry = backendCache.get(rows);
  if (!entry) return null;
  return entry.followFilteredRows ?? null;
}
