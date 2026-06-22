// メトリクスの計算式 `sparkline(EXPR [, { オプション }])` を検知して、
// テーブルセル内にゲージ進捗バー (SVG) を描画するモジュール。
//
// データモデル:
//   - render の前に prepareSparklineSeries(rows, currentDims) を呼び、
//     backend 集計から「path 階層別の時系列」を S.SPARKLINE_SERIES に格納
//   - セル描画時は rowKeyForSparkline(rowVals) で series を引いて
//     renderSparklineSVG に渡す
//   - 行レベルの集計値を分母 max と比較した進捗バー (gauge) を描く
import { evalFormula, baseMetricKeys, derivedMetricKeys } from './aggregate/aggregate.js';
import { S, DEFAULT_FORMULAS } from './state.js';
import { getBackendGroups } from './aggregate/aggregateCache.js';

// ===== 計算式パーサ =====
// formula 例:
//   "sparkline(cpa)"
//   "sparkline(rev_first - ad_cost, { color: 'red', max: 1000 })"
// 返り値: { inner: 'cpa', options: {...} } または null
export function parseSparkline(formula) {
  if (typeof formula !== 'string') return null;
  const trimmed = formula.trim();
  const m = /^sparkline\s*\(([\s\S]+)\)\s*$/i.exec(trimmed);
  if (!m) return null;
  const split = splitTopLevelComma(m[1]);
  const inner = split[0]?.trim() || '0';
  let options = {};
  if (split[1]) {
    try {
      // 信頼された admin 設定なので Function eval で許容
      // eslint-disable-next-line no-new-func
      options = new Function('return (' + split[1] + ');')() || {};
      if (typeof options !== 'object') options = {};
    } catch (e) {
      console.warn('[sparkline] options parse failed', e);
      options = {};
    }
  }
  return { inner, options };
}

// メトリクスの key を渡すと sparkline 設定を返す (なければ null)
export function getSparklineConfig(metricKey) {
  const f = (S.METRIC_FORMULAS && S.METRIC_FORMULAS[metricKey]) ?? DEFAULT_FORMULAS[metricKey];
  return parseSparkline(f);
}

// color allow-list: SVG fill 属性に差し込む文字列をホワイトリストで限定し、
// `red" onload="..."` のような属性インジェクションを防ぐ。
// 受け入れ: hex (#rgb / #rrggbb / #rrggbbaa) または CSS named color (英字のみ、上限 20 文字)
// それ以外は null を返してデフォルト色にフォールバックさせる。
const RE_COLOR_HEX  = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RE_COLOR_NAME = /^[a-zA-Z]{1,20}$/;
function sanitizeColor(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (RE_COLOR_HEX.test(t) || RE_COLOR_NAME.test(t)) return t;
  return null;
}

// 最上位カンマ (括弧外、文字列外) で文字列を分割
function splitTopLevelComma(s) {
  const out = [];
  let depth = 0, start = 0, quote = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote && s[i - 1] !== '\\') quote = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out;
}

// ===== SVG レンダラ (gauge) =====
// 行レベルの集計値を max と比較した単一の進捗バー。
// 分母 max は opts.max 指定があればそれを、無ければ全行の最大値を自動で使う。
// series は無くても _rowAgg + _innerFormula があれば描画可能。
export function renderSparklineSVG(series, opts = {}, width = 100, height = 28) {
  const hasRowAgg = opts._rowAgg && opts._innerFormula;
  const hasSeries = Array.isArray(series) && series.length > 0;
  if (!hasRowAgg && !hasSeries) {
    return `<svg width="${width}" height="${height}"></svg>`;
  }
  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;
  // 色は allow-list で検証 (SVG 属性インジェクション防止)。
  //   - hex: #rgb / #rrggbb / #rrggbbaa
  //   - CSS named color: 英字のみ、最大 20 文字
  // 検証失敗時はデフォルト色にフォールバック。
  const color = sanitizeColor(opts.color) || '#2563eb';

  // 行レベルの値を取得 (派生メトリクスでも overcount しない)
  let rowValue = 0;
  if (hasRowAgg) {
    const v = Number(evalFormula(opts._innerFormula, opts._rowAgg));
    if (isFinite(v)) rowValue = v;
  }

  // 分母 (max): metricKey + depth ごとの「行単位の最大」を使う。
  //   opts.max 指定 → 固定値 (最優先)
  //   それ以外 → 同じ depth の他行の中で最大の値 (= 同列の行同士で比較)
  const globalKey = (opts._metricKey != null && opts._depth != null)
    ? `${opts._metricKey}:${opts._depth}` : null;
  const globalMax = globalKey ? _globalMaxMap.get(globalKey) : null;
  const maxVal = opts.max != null ? Number(opts.max)
    : (globalMax > 0 ? globalMax : Math.max(rowValue, 1));
  const fillRatio = Math.max(0, Math.min(1, rowValue / maxVal));

  const barH = Math.max(4, h * 0.6);
  const yTop = pad + (h - barH) / 2;
  let body = `<rect x="${pad}" y="${yTop.toFixed(2)}" width="${w.toFixed(2)}" height="${barH.toFixed(2)}" fill="#e2e8f0" rx="2"/>`;
  const fillW = w * fillRatio;
  if (fillW > 0) {
    body += `<rect x="${pad}" y="${yTop.toFixed(2)}" width="${fillW.toFixed(2)}" height="${barH.toFixed(2)}" fill="${color}" rx="2"/>`;
  }
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" shape-rendering="crispEdges">${body}</svg>`;
}

// ===== series データ参照 =====
// S.SPARKLINE_SERIES は Map<pathKey, [{ x, agg }]>。
// pathKey は makeGroupSeriesKey で組み立てた文字列。
export function getSparklineSeries(groupKey) {
  return (S.SPARKLINE_SERIES instanceof Map ? S.SPARKLINE_SERIES.get(groupKey) : null) || null;
}
function makeGroupSeriesKey(vals) {
  return vals.map(v => String(v ?? '')).join('');
}

// 各 sparkline メトリクス × depth ごとの「行単位の最大」を保存。
// gauge のデフォルト分母 (= 同じ depth の他行と比較) に使う。
//   - 親集計行と子行を混ぜると子が極小になるので、depth ごとに分ける
//   - 総計 pathKey === '' は max 計算から除外
//   - depth 0 の特例: pathKey === '' (= 非時間 dim 無し) のバケット毎の値を
//     depth 0 max として採用 (日付のみの dim 構成で、行 = 日 1 件のケース用)
const _globalMaxMap = new Map(); // Map<`${metricKey}:${depth}`, number>
const _pathDepthMap = new Map(); // Map<pathKey, depth>
function recomputeGlobalMax() {
  _globalMaxMap.clear();
  const sparkMetrics = getVisibleSparklineMetrics();
  if (!sparkMetrics.length) return;
  const series = S.SPARKLINE_SERIES;
  if (!(series instanceof Map)) return;
  for (const sm of sparkMetrics) {
    const depthMax = new Map(); // depth -> max
    for (const [pathKey, arr] of series.entries()) {
      if (pathKey === '') {
        // 総計 path: 非時間 dim 無しの構成 (例: 行 = 日付) では、バケット毎の値が
        // そのまま「行 1 件の値」になるので depth 0 max に採用する。
        for (const b of arr) {
          const y = Number(evalFormula(sm.cfg.inner, b.agg));
          if (!isFinite(y)) continue;
          if (!depthMax.has(0) || y > depthMax.get(0)) depthMax.set(0, y);
        }
        continue;
      }
      const depth = _pathDepthMap.get(pathKey);
      if (depth == null) continue; // pathDepthMap に登録されてない pathKey は安全のためスキップ
      // 行単位の値: その path 配下の全バケット agg を合算した上で inner を評価
      const rowAgg = sumBucketAggs(arr.map(b => b.agg));
      const y = Number(evalFormula(sm.cfg.inner, rowAgg));
      if (!isFinite(y)) continue;
      if (!depthMax.has(depth) || y > depthMax.get(depth)) depthMax.set(depth, y);
    }
    for (const [depth, max] of depthMax) {
      _globalMaxMap.set(`${sm.key}:${depth}`, max);
    }
  }
}

// 現在 SELECTED_METRICS に sparkline 設定の派生メトリクスが含まれているか
function getVisibleSparklineMetrics() {
  return (S.SELECTED_METRICS || [])
    .map(k => ({ key: k, cfg: getSparklineConfig(k) }))
    .filter(x => x.cfg);
}
export function hasVisibleSparklineMetric() {
  return getVisibleSparklineMetrics().length > 0;
}

// テーブル側で「データ行 vals → series マップキー」を計算するため、
// 直近 prepareSparklineSeries で使った時間軸の位置を保持する。
//   _seriesTimeIdxInCurrentDims < 0: 時間軸が currentDims に含まれない (追加 dim 経由)
//   _seriesTimeIdxInCurrentDims >= 0: 時間軸が currentDims のその位置にある
let _seriesTimeIdxInCurrentDims = -1;
export function rowKeyForSparkline(rowVals) {
  if (_seriesTimeIdxInCurrentDims < 0) return makeGroupSeriesKey(rowVals);
  return makeGroupSeriesKey(rowVals.filter((_, i) => i !== _seriesTimeIdxInCurrentDims));
}
// 行の depth (= series マップの pathKey と同じ流儀で時間軸を除いた dim 値の数)。
// _globalMaxMap の `${metricKey}:${depth}` キー解決に使う。
export function rowDepthForSparkline(rowVals) {
  if (_seriesTimeIdxInCurrentDims < 0) return rowVals.length;
  return rowVals.filter((_, i) => i !== _seriesTimeIdxInCurrentDims).length;
}

// 各 path 深さに対して時系列を組み立てる (親集計行でもスパークラインを表示できるように)。
// バケット単位の agg は基礎 metric を合算して派生を再計算 (sumAggs と同じ流儀)。
function sumBucketAggs(aggs) {
  if (aggs.length === 1) return { ...aggs[0] };
  const result = {};
  for (const k of baseMetricKeys()) {
    let s = 0;
    for (const a of aggs) s += a[k] || 0;
    result[k] = s;
  }
  const ctx = { ...result, min: Math.min, max: Math.max, abs: Math.abs, pow: Math.pow, sqrt: Math.sqrt, round: Math.round, Math };
  for (const k of derivedMetricKeys()) {
    const f = S.METRIC_FORMULAS[k] || DEFAULT_FORMULAS[k] || '0';
    if (/^\s*sparkline\s*\(/i.test(String(f))) continue; // スパークライン自体は値ではないので除外
    const v = evalFormula(f, ctx);
    ctx[k] = v;
    result[k] = v;
  }
  return result;
}

// render の直前に呼ぶ。currentDims 末尾に action_date を足した dim 組合せの
// backend キャッシュから series マップを組み立てて S.SPARKLINE_SERIES に保存。
export function prepareSparklineSeries(rows, currentDims) {
  if (!hasVisibleSparklineMetric()) {
    S.SPARKLINE_SERIES = new Map();
    _seriesTimeIdxInCurrentDims = -1;
    _globalMaxMap.clear();
    _pathDepthMap.clear();
    return;
  }
  const timeDim = 'action_date';
  const timeIdxInCurrent = currentDims.indexOf(timeDim);
  _seriesTimeIdxInCurrentDims = timeIdxInCurrent;
  const seriesDims = timeIdxInCurrent >= 0 ? currentDims : [...currentDims, timeDim];
  const bucketGroups = getBackendGroups(rows, seriesDims) || [];
  const timeIdxInBucket = timeIdxInCurrent >= 0 ? timeIdxInCurrent : currentDims.length;

  // pathKey → Map<x, [agg]> を組み、最後に sumBucketAggs で各 x のセル agg を確定。
  // path は 0 から fullVals.length まで全部 (= 総計から葉まで全階層)。
  // pathKey ごとの depth (= 非時間 dim の数) を _pathDepthMap に保存。
  _pathDepthMap.clear();
  const temp = new Map();
  for (const g of bucketGroups) {
    const fullVals = g.vals.filter((_, i) => i !== timeIdxInBucket);
    const x = g.vals[timeIdxInBucket];
    for (let k = 0; k <= fullVals.length; k++) {
      const pathKey = makeGroupSeriesKey(fullVals.slice(0, k));
      _pathDepthMap.set(pathKey, k);
      let timeMap = temp.get(pathKey);
      if (!timeMap) { timeMap = new Map(); temp.set(pathKey, timeMap); }
      let aggList = timeMap.get(x);
      if (!aggList) { aggList = []; timeMap.set(x, aggList); }
      aggList.push(g.agg);
    }
  }
  const map = new Map();
  for (const [pathKey, timeMap] of temp) {
    const arr = [];
    for (const [x, aggs] of timeMap) arr.push({ x, agg: sumBucketAggs(aggs) });
    arr.sort((a, b) => String(a.x).localeCompare(String(b.x)));
    map.set(pathKey, arr);
  }
  S.SPARKLINE_SERIES = map;
  // gauge のデフォルト分母用に全行 max を再計算
  recomputeGlobalMax();
}
