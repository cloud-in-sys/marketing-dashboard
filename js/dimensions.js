import { S, DOW_LABELS, DOW_ORDER } from './state.js';

// ===== Dimensions & Grouping =====
export function dimValue(row, key) {
  const def = S.DIMENSIONS.find(d => d.key === key);
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
  if (def.type === 'dow') {
    const dt = new Date(raw);
    return isNaN(dt) ? '' : DOW_LABELS[dt.getDay()];
  }
  return raw;
}

export function dimSort(key, a, b) {
  if (key === 'dow') return (DOW_ORDER[a] ?? 99) - (DOW_ORDER[b] ?? 99);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function dimLabel(key) {
  return (S.DIMENSIONS.find(d => d.key === key) || {}).label || key;
}

export function groupRows(rows, dims) {
  const map = new Map();
  for (const r of rows) {
    const vals = dims.map(k => dimValue(r, k));
    const key = vals.join('\u0001');
    if (!map.has(key)) map.set(key, {vals, rows: []});
    map.get(key).rows.push(r);
  }
  return [...map.values()].sort((a, b) => {
    for (let i = 0; i < dims.length; i++) {
      const c = dimSort(dims[i], a.vals[i], b.vals[i]);
      if (c) return c;
    }
    return 0;
  });
}
