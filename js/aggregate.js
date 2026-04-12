import { S, DEFAULT_BASE_FORMULAS, DEFAULT_FORMULAS } from './state.js';
import { num } from './utils.js';

// ===== Aggregation =====
export function baseMetricKeys() { return S.METRIC_DEFS.filter(m => m.type === 'base').map(m => m.key); }
export function derivedMetricKeys() { return S.METRIC_DEFS.filter(m => m.type === 'derived').map(m => m.key); }

export function parseBaseFormula(formula) {
  const m = /^\s*sum\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)(?:\s*where\s+(.+?))?\s*$/i.exec(String(formula || ''));
  if (!m) return null;
  const column = m[1];
  const filters = [];
  if (m[2]) {
    m[2].split(/\s+and\s+/i).forEach(clause => {
      const cm = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?:'([^']*)'|"([^"]*)"|(\S+))\s*$/.exec(clause);
      if (cm) filters.push({field: cm[1], value: cm[2] ?? cm[3] ?? cm[4]});
    });
  }
  return {column, filters};
}

export function aggregateBase(rows, formula) {
  const parsed = parseBaseFormula(formula);
  if (!parsed) return 0;
  let s = 0;
  for (const r of rows) {
    if (!parsed.filters.every(f => r[f.field] === f.value)) continue;
    s += num(r[parsed.column]);
  }
  return s;
}

export function evalFormula(formula, ctx) {
  try {
    const code = String(formula).replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, m => {
      if (m in ctx) return `ctx.${m}`;
      return m;
    });
    const fn = new Function('ctx', `"use strict"; return (${code});`);
    const v = fn(ctx);
    return Number.isFinite(v) ? v : 0;
  } catch (e) {
    return 0;
  }
}

export function aggregate(rows) {
  const a = {};
  for (const key of baseMetricKeys()) {
    const formula = S.BASE_FORMULAS[key] || DEFAULT_BASE_FORMULAS[key] || '';
    a[key] = aggregateBase(rows, formula);
  }
  const ctx = {...a, min: Math.min, max: Math.max, abs: Math.abs, pow: Math.pow, sqrt: Math.sqrt, round: Math.round, Math};
  for (const key of derivedMetricKeys()) {
    const f = S.METRIC_FORMULAS[key] || DEFAULT_FORMULAS[key] || '0';
    const v = evalFormula(f, ctx);
    ctx[key] = v;
    a[key] = v;
  }
  return a;
}
