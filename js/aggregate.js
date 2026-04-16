import { S, DEFAULT_BASE_FORMULAS, DEFAULT_FORMULAS } from './state.js';

// ===== Aggregation (optimized) =====

// Cache parsed formulas and compiled functions
const parsedBaseCache = new Map();   // formula string -> parsed object
const compiledDerivedCache = new Map(); // formula string -> compiled Function
let cachedBaseKeys = null;
let cachedDerivedKeys = null;
let cachedMetricDefsRef = null;

function ensureKeyCache() {
  if (cachedMetricDefsRef !== S.METRIC_DEFS) {
    cachedMetricDefsRef = S.METRIC_DEFS;
    cachedBaseKeys = S.METRIC_DEFS.filter(m => m.type === 'base').map(m => m.key);
    cachedDerivedKeys = S.METRIC_DEFS.filter(m => m.type === 'derived').map(m => m.key);
  }
}

export function baseMetricKeys() { ensureKeyCache(); return cachedBaseKeys; }
export function derivedMetricKeys() { ensureKeyCache(); return cachedDerivedKeys; }

export function parseBaseFormula(formula) {
  const key = String(formula || '');
  if (parsedBaseCache.has(key)) return parsedBaseCache.get(key);
  const m = /^\s*sum\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)(?:\s*where\s+(.+?))?\s*$/i.exec(key);
  if (!m) { parsedBaseCache.set(key, null); return null; }
  const column = m[1];
  const filters = [];
  if (m[2]) {
    m[2].split(/\s+and\s+/i).forEach(clause => {
      const cm = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?:'([^']*)'|"([^"]*)"|(\S+))\s*$/.exec(clause);
      if (cm) filters.push({field: cm[1], value: cm[2] ?? cm[3] ?? cm[4]});
    });
  }
  const result = {column, filters};
  parsedBaseCache.set(key, result);
  return result;
}

function num(v) { const n = +v; return n === n ? n : 0; }  // inline, avoids import overhead

function aggregateBase(rows, formula) {
  const parsed = parseBaseFormula(formula);
  if (!parsed) return 0;
  const col = parsed.column;
  const filters = parsed.filters;
  const fLen = filters.length;
  let s = 0;
  if (fLen === 0) {
    for (let i = 0, len = rows.length; i < len; i++) {
      s += num(rows[i][col]);
    }
  } else if (fLen === 1) {
    const f0field = filters[0].field, f0val = filters[0].value;
    for (let i = 0, len = rows.length; i < len; i++) {
      const r = rows[i];
      if (r[f0field] === f0val) s += num(r[col]);
    }
  } else {
    for (let i = 0, len = rows.length; i < len; i++) {
      const r = rows[i];
      let ok = true;
      for (let j = 0; j < fLen; j++) {
        if (r[filters[j].field] !== filters[j].value) { ok = false; break; }
      }
      if (ok) s += num(r[col]);
    }
  }
  return s;
}

function compileDerived(formula) {
  const key = String(formula);
  if (compiledDerivedCache.has(key)) return compiledDerivedCache.get(key);
  try {
    const code = key.replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, m => {
      // known math names stay as-is in ctx
      return `ctx.${m}`;
    });
    const fn = new Function('ctx', `"use strict"; try{var v=(${code});return v===v&&v!==1/0&&v!==-1/0?v:0}catch(e){return 0}`);
    compiledDerivedCache.set(key, fn);
    return fn;
  } catch (e) {
    const noop = () => 0;
    compiledDerivedCache.set(key, noop);
    return noop;
  }
}

export function evalFormula(formula, ctx) {
  return compileDerived(formula)(ctx);
}

// 同じ rows 配列参照に対する集計結果をキャッシュ (WeakMap で GC フレンドリー)
const _aggregateCache = new WeakMap();

export function aggregate(rows) {
  ensureKeyCache();
  const cached = _aggregateCache.get(rows);
  if (cached && cached.ref === cachedMetricDefsRef) return cached.result;
  const a = {};
  for (let i = 0, len = cachedBaseKeys.length; i < len; i++) {
    const key = cachedBaseKeys[i];
    a[key] = aggregateBase(rows, S.BASE_FORMULAS[key] || DEFAULT_BASE_FORMULAS[key] || '');
  }
  const ctx = {__proto__: null, ...a, min: Math.min, max: Math.max, abs: Math.abs, pow: Math.pow, sqrt: Math.sqrt, round: Math.round, Math};
  for (let i = 0, len = cachedDerivedKeys.length; i < len; i++) {
    const key = cachedDerivedKeys[i];
    const f = S.METRIC_FORMULAS[key] || DEFAULT_FORMULAS[key] || '0';
    const v = compileDerived(f)(ctx);
    ctx[key] = v;
    a[key] = v;
  }
  _aggregateCache.set(rows, { ref: cachedMetricDefsRef, result: a });
  return a;
}

// Clear caches when metric defs change
export function clearAggregateCache() {
  parsedBaseCache.clear();
  compiledDerivedCache.clear();
  cachedMetricDefsRef = null;
}
