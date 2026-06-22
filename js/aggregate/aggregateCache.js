// バックエンド集計のフロント側キャッシュ。WeakMap で rows 参照ごとに保持。
//
// 書き込み: js/aggregateBackend.js (prefetchAggregates が API 取得後にセット)
// 読み込み: js/aggregate.js / js/dimensions.js (各レンダラの直前)
//
// FEATURES.useBackendAggregate が false のときは常に null を返す → ローカル経路。
//
// 行数の用語:
//   totalRows      snapshot meta の全行数 (このモジュールでは扱わない)
//   accessibleRows group sourceFilter 適用後の行数 (このモジュールでは扱わない)
//   filteredRows   現在のタブのフィルタ全て適用後 ← UI の「対象行数」はこれ

import { FEATURES } from '../config.js';

// dimensions.js の dimsKey と一致するセパレータ (U+0001)。
const SEP = String.fromCharCode(1);

const backendCache = new WeakMap();

export function setBackendCache(rows, cache) {
  backendCache.set(rows, cache);
}

// rows に対する prefetch 済み totals を返す。なければ null。
export function getBackendTotals(rows) {
  if (!FEATURES.useBackendAggregate) return null;
  const entry = backendCache.get(rows);
  return entry?.totals || null;
}

// rows に対する prefetch 済み groups を groupRows と同じ形に整えて返す。
// 戻り値要素は { vals, rows: [], agg } (agg はメトリクス連想配列)。
export function getBackendGroups(rows, dims) {
  if (!FEATURES.useBackendAggregate) return null;
  const entry = backendCache.get(rows);
  if (!entry) return null;
  const key = dims.join(SEP);
  const groups = entry.groupsByDimsKey.get(key);
  if (!groups) return null;
  return groups.map(g => ({ vals: g.vals, rows: [], agg: g.metrics }));
}

// aggregateBackend.js が同じ key を使えるよう公開。
export function dimsKeyFor(dims) {
  return dims.join(SEP);
}

// card.id ごとの per-card aggregate (latest_month / prev_month 用) を取得。
export function getBackendCardAgg(rows, cardId) {
  if (!FEATURES.useBackendAggregate) return null;
  const entry = backendCache.get(rows);
  if (!entry || !entry.cardAggs) return null;
  return entry.cardAggs.get(cardId) || null;
}

// 「対象行数」UI ヘッダ表示用: 追従フィルタ (ヘッダ multi-select + 日付) 適用後、
// タブ WHERE 適用前の行数。
export function getBackendFollowFilteredRows(rows) {
  if (!FEATURES.useBackendAggregate) return null;
  const entry = backendCache.get(rows);
  if (!entry) return null;
  return entry.followFilteredRows ?? null;
}
