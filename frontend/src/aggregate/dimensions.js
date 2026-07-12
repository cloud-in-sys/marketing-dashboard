import { S, DOW_LABELS, DOW_ORDER } from '../app/state.js';
import { getBackendGroups } from './aggregateCache.js';

// ===== Dimensions & Grouping (optimized) =====
let dimMapRef = null;
let dimMap = new Map();

function ensureDimMap() {
  if (dimMapRef !== S.DIMENSIONS) {
    dimMapRef = S.DIMENSIONS;
    dimMap = new Map(S.DIMENSIONS.map(d => [d.key, d]));
  }
}

export function dimValue(row, key) {
  ensureDimMap();
  const def = dimMap.get(key);
  if (!def) return row[key] || '';
  if (def.type === 'expression') {
    let fn = S.DIM_EXPR_CACHE.get(key);
    if (!fn || fn._src !== def.expression) {
      try {
        fn = new Function('r', `"use strict"; return (${def.expression || "''"})`);
        fn._src = def.expression;
      } catch (e) { fn = () => ''; fn._src = def.expression; }
      S.DIM_EXPR_CACHE.set(key, fn);
    }
    try { return String(fn(row) ?? ''); } catch (e) { return ''; }
  }
  const raw = row[def.field] || '';
  if (def.type === 'month') return String(raw).slice(0, 7);
  if (def.type === 'year') return String(raw).slice(0, 4);
  if (def.type === 'week') {
    return computeWeekRange(raw, def.weekStart);
  }
  if (def.type === 'dow') {
    const dt = new Date(raw);
    return isNaN(dt) ? '' : DOW_LABELS[dt.getDay()];
  }
  return raw;
}

// YYYY-MM-DD 文字列を [年, 月(1-12), 日] にパース。new Date(str) は UTC 解釈で
// TZ ずれが出るため避ける。
// 月/日の範囲も検証して、'2024-13-45' のような不正値が new Date のオーバーフロー経由で
// 別月の週ラベルに化けないようにする。
function parseYMD(raw) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(raw));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > 31) return null;
  // 日付の妥当性 (例: 2-30) は new Date 経由で再構築して比較。
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return [y, mo, d];
}
function pad2(n) { return n < 10 ? '0' + n : String(n); }
function fmtYMD(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

// 週の開始曜日 weekStart (0=日..6=土、デフォルト 1=月) を起点に、
// raw 日付が属する週の [開始日〜終了日] を YYYY-MM-DD〜YYYY-MM-DD で返す。
function computeWeekRange(raw, weekStart) {
  const ymd = parseYMD(raw);
  if (!ymd) return '';
  const ws = (weekStart != null && weekStart >= 0 && weekStart <= 6) ? Number(weekStart) : 1;
  const dt = new Date(ymd[0], ymd[1] - 1, ymd[2]);
  const offset = (dt.getDay() - ws + 7) % 7;
  const start = new Date(dt);
  start.setDate(dt.getDate() - offset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${fmtYMD(start)}〜${fmtYMD(end)}`;
}

export function dimSort(key, a, b) {
  ensureDimMap();
  const def = dimMap.get(key);
  // ディメンション type が 'dow' なら曜日固定順(日月火水木金土)で並べる
  if (def?.type === 'dow' || key === 'dow') {
    return (DOW_ORDER[a] ?? 99) - (DOW_ORDER[b] ?? 99);
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

export function dimLabel(key) {
  ensureDimMap();
  return (dimMap.get(key) || {}).label || key;
}

// 同一 rows 参照 + 同一 dims キーに対するグルーピング結果を WeakMap にキャッシュ。
// render() 内で複数チャートが同じ xDim を使っても 1 回しか走らないようにする。
const _groupCache = new WeakMap();
// DIMENSIONS の世代カウンタ。weekStart など def 変更後にキャッシュを再利用しないように
// _groupCache のキーに混ぜる。
let _dimsVersion = 0;
let _lastDimsRef = null;
function dimsVersion() {
  if (_lastDimsRef !== S.DIMENSIONS) {
    _lastDimsRef = S.DIMENSIONS;
    _dimsVersion++;
  }
  return _dimsVersion;
}

export function groupRows(rows, dims) {
  // バックエンド集計の prefetch 済み結果があればそれを使う。
  // 返り値要素は { vals, rows: [], agg } — レンダラは g.agg を優先参照する。
  const backend = getBackendGroups(rows, dims);
  if (backend) return backend;
  const dimsKey = dimsVersion() + ':' + dims.join('\u0001');
  let cache = _groupCache.get(rows);
  if (cache && cache.has(dimsKey)) return cache.get(dimsKey);

  const map = new Map();
  for (let i = 0, len = rows.length; i < len; i++) {
    const r = rows[i];
    const vals = dims.map(k => dimValue(r, k));
    const key = vals.join('\u0001');
    if (!map.has(key)) map.set(key, {vals, rows: []});
    map.get(key).rows.push(r);
  }
  const result = [...map.values()].sort((a, b) => {
    for (let i = 0; i < dims.length; i++) {
      const c = dimSort(dims[i], a.vals[i], b.vals[i]);
      if (c) return c;
    }
    return 0;
  });

  if (!cache) { cache = new Map(); _groupCache.set(rows, cache); }
  cache.set(dimsKey, result);
  return result;
}
