// @ts-check
// ディメンション値抽出 + グルーピング。frontend/src/aggregate/dimensions.js から移植。

import { compileSafeExpr } from '../utils/safeExpr.js';

const DOW_LABELS = ['日','月','火','水','木','金','土'];
const DOW_ORDER = {'日':0,'月':1,'火':2,'水':3,'木':4,'金':5,'土':6};

// expression ディメンションのコンパイル結果キャッシュ (式文字列でキー付け)。
const dimExprCache = new Map();

function compileDimExpr(expr) {
  const key = String(expr || '');
  if (dimExprCache.has(key)) return dimExprCache.get(key);
  const noop = () => '';
  const evalFn = compileSafeExpr(key);
  if (!evalFn) {
    dimExprCache.set(key, noop);
    return noop;
  }
  dimExprCache.set(key, evalFn);
  return evalFn;
}

function buildDimMap(dimensions) {
  const map = new Map();
  for (const d of (dimensions || [])) {
    if (d && d.key) map.set(d.key, d);
  }
  return map;
}

function dimValue(row, key, dimMap) {
  const def = dimMap.get(key);
  if (!def) return row[key] || '';
  if (def.type === 'expression') {
    const fn = compileDimExpr(def.expression);
    try { return String(fn(row) ?? ''); } catch (e) { return ''; }
  }
  const raw = row[def.field] || '';
  if (def.type === 'month') return String(raw).slice(0, 7);
  if (def.type === 'year') return String(raw).slice(0, 4);
  if (def.type === 'week') {
    return computeWeekRange(raw, def.weekStart);
  }
  if (def.type === 'week_md') {
    return computeWeekRange(raw, def.weekStart, true);
  }
  if (def.type === 'dow') {
    const dt = new Date(raw);
    // isNaN(dt) は内部で Number(dt)=dt.getTime() に変換されるのと同義。明示して型も通す。
    return isNaN(dt.getTime()) ? '' : DOW_LABELS[dt.getDay()];
  }
  return raw;
}

// YYYY-MM-DD を [年, 月(1-12), 日] にパース (new Date(str) の UTC ずれを回避)。
// 月/日の範囲も検証して、'2024-13-45' のような不正値が new Date のオーバーフロー経由で
// 別月の週ラベルに化けないようにする。
function parseYMD(raw) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(raw));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return [y, mo, d];
}
function pad2(n) { return n < 10 ? '0' + n : String(n); }
function fmtYMD(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function fmtMD(d) { return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

// 週の開始曜日 (0=日..6=土、デフォルト 1=月) を起点に週範囲を返す。
// monthDayOnly=true なら年を省いた MM-DD〜MM-DD で返す。
function computeWeekRange(raw, weekStart, monthDayOnly = false) {
  const ymd = parseYMD(raw);
  if (!ymd) return '';
  const ws = (weekStart != null && weekStart >= 0 && weekStart <= 6) ? Number(weekStart) : 1;
  const dt = new Date(ymd[0], ymd[1] - 1, ymd[2]);
  const offset = (dt.getDay() - ws + 7) % 7;
  const start = new Date(dt);
  start.setDate(dt.getDate() - offset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = monthDayOnly ? fmtMD : fmtYMD;
  return `${fmt(start)}〜${fmt(end)}`;
}

function dimSort(key, a, b, dimMap) {
  const def = dimMap.get(key);
  if (def?.type === 'dow' || key === 'dow') {
    return (DOW_ORDER[a] ?? 99) - (DOW_ORDER[b] ?? 99);
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

// rows を dims でグルーピング。{vals, rows} の配列を返す (ソート済み)。
export function groupRows(rows, dims, dimensions) {
  const dimMap = buildDimMap(dimensions);
  const map = new Map();
  for (let i = 0, len = rows.length; i < len; i++) {
    const r = rows[i];
    const vals = dims.map(k => dimValue(r, k, dimMap));
    const key = vals.join('');
    if (!map.has(key)) map.set(key, { vals, rows: [] });
    map.get(key).rows.push(r);
  }
  return [...map.values()].sort((a, b) => {
    for (let i = 0; i < dims.length; i++) {
      const c = dimSort(dims[i], a.vals[i], b.vals[i], dimMap);
      if (c) return c;
    }
    return 0;
  });
}
