// ディメンション値抽出 + グルーピング。js/dimensions.js から移植。

import { validateExpression } from '../utils/expression.js';

const DOW_LABELS = ['日','月','火','水','木','金','土'];
const DOW_ORDER = {'日':0,'月':1,'火':2,'水':3,'木':4,'金':5,'土':6};

// expression ディメンションのコンパイル結果キャッシュ (式文字列でキー付け)。
const dimExprCache = new Map();

function compileDimExpr(expr) {
  const key = String(expr || '');
  if (dimExprCache.has(key)) return dimExprCache.get(key);
  const validateErr = validateExpression(key, { label: 'dimension-expression' });
  if (validateErr) {
    const noop = () => '';
    dimExprCache.set(key, noop);
    return noop;
  }
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('r', `"use strict"; return (${key || "''"});`);
    dimExprCache.set(key, fn);
    return fn;
  } catch (e) {
    const noop = () => '';
    dimExprCache.set(key, noop);
    return noop;
  }
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
  if (def.type === 'dow') {
    const dt = new Date(raw);
    return isNaN(dt) ? '' : DOW_LABELS[dt.getDay()];
  }
  return raw;
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
