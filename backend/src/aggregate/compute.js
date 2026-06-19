// メトリクス集計エンジン。js/aggregate.js から移植 (S 依存を context 引数化)。

import { findCloseParen, parseAggregateInner, parseWhereStr } from './parser.js';
import { evalAst, num, todayStr } from './evalAst.js';
import { validateExpression } from '../utils/expression.js';

const FN_NAMES = ['sum', 'count', 'avg', 'min', 'max', 'countDistinct'];
const FN_ALT = FN_NAMES.join('|');
const FN_OPENER_REGEX_TEMPLATE = `\\b(${FN_ALT})\\s*\\(`;
const TRAILING_WHERE_REGEX = /^(__agg_\d+__)\s+where\s+(.+)$/i;

// 1 プロセス共通の lift / compile キャッシュ。式文字列でキー付けされる。
const liftCache = new Map();
const compiledLiftedCache = new Map();

function liftFormula(formula) {
  if (liftCache.has(formula)) return liftCache.get(formula);

  let nextId = 0;
  const specs = {};
  let result = '';
  let lastEnd = 0;

  const re = new RegExp(FN_OPENER_REGEX_TEMPLATE, 'gi');
  let m;
  while ((m = re.exec(formula)) !== null) {
    const start = m.index;
    const fnName = m[1].toLowerCase() === 'countdistinct' ? 'countDistinct' : m[1].toLowerCase();
    const innerStart = re.lastIndex;
    const closeIdx = findCloseParen(formula, innerStart);
    if (closeIdx < 0) break;
    const inner = formula.slice(innerStart, closeIdx);
    const spec = parseAggregateInner(fnName, inner);
    if (!spec) continue;
    const ph = `__agg_${nextId++}__`;
    specs[ph] = spec;
    result += formula.slice(lastEnd, start) + ph;
    lastEnd = closeIdx + 1;
    re.lastIndex = lastEnd;
  }
  result += formula.slice(lastEnd);

  const tw = TRAILING_WHERE_REGEX.exec(result.trim());
  if (tw) {
    const ph = tw[1];
    const whereStr = tw[2];
    const ast = parseWhereStr(whereStr);
    if (ast && ast !== false && specs[ph] && specs[ph].filters == null) {
      specs[ph].filters = ast;
      result = ph;
    }
  }

  const out = { lifted: result, specs };
  liftCache.set(formula, out);
  return out;
}

function computeAggregate(rows, spec, today) {
  const { fn, column, filters } = spec;
  const ast = filters || null;
  let s = 0, count = 0, minV = null, maxV = null, distinct = null;
  if (fn === 'countDistinct') distinct = new Set();
  for (let i = 0, len = rows.length; i < len; i++) {
    const r = rows[i];
    if (ast && !evalAst(ast, r, today)) continue;
    switch (fn) {
      case 'sum':
        s += num(r[column]);
        break;
      case 'count':
        if (column == null) {
          count++;
        } else {
          const v = r[column];
          if (v != null && v !== '') count++;
        }
        break;
      case 'avg':
        s += num(r[column]);
        count++;
        break;
      case 'min': {
        const v = r[column];
        if (v != null && v !== '') {
          const n = +v;
          if (n === n) {
            if (minV === null || n < minV) minV = n;
          }
        }
        break;
      }
      case 'max': {
        const v = r[column];
        if (v != null && v !== '') {
          const n = +v;
          if (n === n) {
            if (maxV === null || n > maxV) maxV = n;
          }
        }
        break;
      }
      case 'countDistinct': {
        const v = r[column];
        if (v != null && v !== '') distinct.add(v);
        break;
      }
    }
  }
  switch (fn) {
    case 'sum':           return s;
    case 'count':         return count;
    case 'avg':           return count > 0 ? s / count : 0;
    case 'min':           return minV ?? 0;
    case 'max':           return maxV ?? 0;
    case 'countDistinct': return distinct.size;
  }
  return 0;
}

// lifted 式を JS 関数にコンパイル。
// 入力は validateExpression を通った識別子 + 算術のみ。
// FORBIDDEN リストで constructor / eval / require / for / while 等は弾かれている。
function compileLifted(formula) {
  if (compiledLiftedCache.has(formula)) return compiledLiftedCache.get(formula);
  const validateErr = validateExpression(formula, { label: 'lifted-formula' });
  if (validateErr) {
    const noop = () => 0;
    compiledLiftedCache.set(formula, noop);
    return noop;
  }
  try {
    const code = formula.replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, m => `ctx.${m}`);
    // eslint-disable-next-line no-new-func
    const fn = new Function('ctx', `"use strict"; try{var v=(${code});return v===v&&v!==1/0&&v!==-1/0?v:0}catch(e){return 0}`);
    compiledLiftedCache.set(formula, fn);
    return fn;
  } catch (e) {
    const noop = () => 0;
    compiledLiftedCache.set(formula, noop);
    return noop;
  }
}

// メトリクス集計のメインエントリ。
// rows: 行配列, config: { metricDefs, baseFormulas, formulas } (Firestore から取得)
export function aggregate(rows, config) {
  const today = todayStr();
  const metricDefs = Array.isArray(config?.metricDefs) ? config.metricDefs : [];
  const baseFormulas = config?.baseFormulas || {};
  const formulas = config?.formulas || {};
  const baseKeys = metricDefs.filter(m => m.type === 'base').map(m => m.key);
  const derivedKeys = metricDefs.filter(m => m.type === 'derived').map(m => m.key);

  const a = {};
  const ctxBase = { __proto__: null, min: Math.min, max: Math.max, abs: Math.abs, pow: Math.pow, sqrt: Math.sqrt, round: Math.round, Math };

  const evalKey = (key, formula) => {
    // sparkline(...) は通常の数式ではなくフロント描画専用なのでスキップ
    if (/^\s*sparkline\s*\(/i.test(String(formula || ''))) {
      a[key] = NaN;
      return;
    }
    const { lifted, specs } = liftFormula(String(formula || ''));
    const aggValues = {};
    for (const ph of Object.keys(specs)) {
      aggValues[ph] = computeAggregate(rows, specs[ph], today);
    }
    const ctx = Object.assign({ __proto__: null }, ctxBase, a, aggValues);
    const v = compileLifted(lifted)(ctx);
    a[key] = v;
  };

  for (const k of baseKeys) evalKey(k, baseFormulas[k] || '0');
  for (const k of derivedKeys) evalKey(k, formulas[k] || '0');

  return a;
}

// view filter 式 (例: `r.status === '完了' && r.amount > 1000`) を行に適用する。
// validateExpression を通った後にコンパイルしてキャッシュ。
const viewFilterCache = new Map();
export function compileViewFilter(expr) {
  if (!expr || !String(expr).trim()) return null;
  const src = String(expr);
  if (viewFilterCache.has(src)) return viewFilterCache.get(src);
  const validateErr = validateExpression(src, { label: 'viewFilter' });
  if (validateErr) {
    viewFilterCache.set(src, null);
    return null;
  }
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('r', `"use strict"; try{return !!(${src})}catch(e){return false}`);
    viewFilterCache.set(src, fn);
    return fn;
  } catch (e) {
    viewFilterCache.set(src, null);
    return null;
  }
}
