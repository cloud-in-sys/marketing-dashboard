import { S, DEFAULT_BASE_FORMULAS, DEFAULT_FORMULAS } from './state.js';

// ===== Aggregation =====
// 統一モデル: どの計算式も「集計関数 + 算術 + メトリクス参照」を自由に混ぜられる。
//
// サポートする書き方:
//   pure aggregate:        sum(x)           count()         avg(price)
//   aggregate + where:     sum(x) where y='z'                 (旧来の書式・互換)
//                          sum(x where y='z')                 (新書式・パレ内 where)
//   mixed expression:      sum(revenue) - sum(cost)
//                          sum(x where a='1') / sum(y where b='2')
//                          profit / sum(cost) * 100           (集計と参照の混在)
//   pure derived:          ad_cost / clicks                   (旧derived・参照のみ)
//
// 評価フロー:
//   1) 各式を lift → インラインの集計関数呼び出しを placeholder __agg_N__ に置換
//   2) placeholder ごとに行ループで集計値を計算
//   3) 残りの算術式を JS として評価し、ctx に既計算メトリクス + placeholder 値を入れて実行

const FN_NAMES = ['sum', 'count', 'avg', 'min', 'max', 'countDistinct'];
const FN_ALT = FN_NAMES.join('|');
const FN_OPENER_REGEX = new RegExp(`\\b(${FN_ALT})\\s*\\(`, 'gi');
// 単語演算子(空白必須) と 記号演算子(空白任意) の両方を試す
const WORD_OP_REGEX = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+(contains|notContains|startsWith|endsWith)\s+(.+?)\s*$/i;
const SYM_OP_REGEX  = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(<=|>=|!=|<|>|=)\s*(.+?)\s*$/;
const TRAILING_WHERE_REGEX = /^(__agg_\d+__)\s+where\s+(.+)$/i;

// where 句の1節をパース。{field, op, valueStr} を返す。op は小文字正規化。
function parseClause(clause) {
  const wm = WORD_OP_REGEX.exec(clause);
  if (wm) return { field: wm[1], op: wm[2].toLowerCase(), valueStr: wm[3] };
  const sm = SYM_OP_REGEX.exec(clause);
  if (sm) return { field: sm[1], op: sm[2], valueStr: sm[3] };
  return null;
}

const liftCache = new Map();          // formula -> { lifted, specs }
const compiledLiftedCache = new Map(); // lifted -> compiled fn
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

function num(v) { const n = +v; return n === n ? n : 0; }

// ===== Date utilities (today() 用) =====
function todayStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
function addDays(yyyymmdd, days) {
  const d = new Date(yyyymmdd + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
function resolveValue(val, today) {
  if (val.kind === 'today') return addDays(today, val.offset);
  return val.value;
}
function normMaybeDate(s) {
  if (s == null) return '';
  const str = String(s);
  if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(str)) {
    return str.slice(0, 10).replace(/\//g, '-');
  }
  return str;
}
function evalFilter(cell, op, target) {
  // 文字列ベースの演算子(数値化しない)
  if (op === 'contains' || op === 'notcontains' || op === 'startswith' || op === 'endswith') {
    const cs = String(cell ?? '');
    const ts = String(target ?? '');
    switch (op) {
      case 'contains':    return cs.includes(ts);
      case 'notcontains': return !cs.includes(ts);
      case 'startswith':  return cs.startsWith(ts);
      case 'endswith':    return cs.endsWith(ts);
    }
  }
  // 後方互換: '=' は生値の === も成立として扱う
  if (op === '=' && cell === target) return true;
  const targetStr = String(target ?? '').trim();
  const cellStr = String(cell ?? '').trim();
  const targetIsNumeric = targetStr !== '' && /^-?\d+(\.\d+)?$/.test(targetStr);
  const cellIsNumeric = cellStr !== '' && /^-?\d+(\.\d+)?$/.test(cellStr);
  if (targetIsNumeric && cellIsNumeric) {
    const a = Number(cellStr), b = Number(targetStr);
    switch (op) {
      case '=':  return a === b;
      case '!=': return a !== b;
      case '<':  return a < b;
      case '<=': return a <= b;
      case '>':  return a > b;
      case '>=': return a >= b;
    }
  }
  const cs = normMaybeDate(cell);
  const ts = normMaybeDate(target);
  switch (op) {
    case '=':  return cs === ts;
    case '!=': return cs !== ts;
    case '<':  return cs < ts;
    case '<=': return cs <= ts;
    case '>':  return cs > ts;
    case '>=': return cs >= ts;
  }
  return false;
}

// WHERE 句の右辺をパース (string literal | today() | bareword)
function parseValue(s) {
  s = s.trim();
  let qm = /^'([^']*)'$/.exec(s) || /^"([^"]*)"$/.exec(s);
  if (qm) return { kind: 'literal', value: qm[1] };
  let tm = /^today\s*\(\s*\)\s*(?:([+\-])\s*(\d+))?\s*$/i.exec(s);
  if (tm) {
    const sign = tm[1] === '-' ? -1 : 1;
    const offset = tm[2] ? sign * Number(tm[2]) : 0;
    return { kind: 'today', offset };
  }
  return { kind: 'literal', value: s };
}

// 文字列の position から始まる "(" に対応する ")" の index を返す。
// クオート文字列内のパレは無視。見つからなければ -1。
function findCloseParen(str, start) {
  let depth = 1;
  let inSingle = false, inDouble = false;
  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (!inSingle && !inDouble) {
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) return i; }
      else if (ch === "'") inSingle = true;
      else if (ch === '"') inDouble = true;
    } else if (inSingle && ch === "'") inSingle = false;
    else if (inDouble && ch === '"') inDouble = false;
  }
  return -1;
}

// 集計関数のパレ内: "<col>" または "<col> where <conds>" または "" (count() のみ)
function parseAggregateInner(fnName, inner) {
  inner = inner.trim();
  const wm = /\bwhere\b/i.exec(inner);
  let column, whereStr;
  if (wm) {
    column = inner.slice(0, wm.index).trim();
    whereStr = inner.slice(wm.index + 5).trim();
  } else {
    column = inner;
    whereStr = '';
  }
  if (column === '') {
    if (fnName !== 'count') return null;
    column = null;
  } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column)) {
    return null;
  }
  const filters = parseWhereStr(whereStr);
  if (filters === null) return null;
  return { fn: fnName, column, filters };
}

// where 句を OR-of-AND の構造でパース。
// 戻り値: [[{field, op, value}, ...], ...]  外側が OR、内側が AND。
// 空リストは「フィルタなし(全件マッチ)」。失敗時は null。
function parseWhereStr(whereStr) {
  if (!whereStr) return [];
  const orGroups = [];
  for (const group of whereStr.split(/\s+or\s+/i)) {
    const ands = [];
    for (const c of group.split(/\s+and\s+/i)) {
      const pc = parseClause(c);
      if (!pc) return null;
      ands.push({ field: pc.field, op: pc.op, value: parseValue(pc.valueStr) });
    }
    if (ands.length) orGroups.push(ands);
  }
  return orGroups;
}

// 式から集計関数呼び出しを抽出 → placeholder で置換した式と spec マップを返す
function liftFormula(formula) {
  if (liftCache.has(formula)) return liftCache.get(formula);

  let nextId = 0;
  const specs = {};
  let result = '';
  let lastEnd = 0;

  FN_OPENER_REGEX.lastIndex = 0;
  let m;
  while ((m = FN_OPENER_REGEX.exec(formula)) !== null) {
    const start = m.index;
    const fnName = m[1].toLowerCase() === 'countdistinct' ? 'countDistinct' : m[1].toLowerCase();
    const innerStart = FN_OPENER_REGEX.lastIndex;
    const closeIdx = findCloseParen(formula, innerStart);
    if (closeIdx < 0) break; // unbalanced
    const inner = formula.slice(innerStart, closeIdx);
    const spec = parseAggregateInner(fnName, inner);
    if (!spec) {
      // skip invalid, leave original text
      continue;
    }
    const ph = `__agg_${nextId++}__`;
    specs[ph] = spec;
    result += formula.slice(lastEnd, start) + ph;
    lastEnd = closeIdx + 1;
    FN_OPENER_REGEX.lastIndex = lastEnd;
  }
  result += formula.slice(lastEnd);

  // 旧書式 "fn(col) where ..." 互換: lifted が "__agg_X__ where ..." の形なら where を spec に統合
  // inner で where が無い(filters が空)集計のみが対象。inner where が既にある場合は曖昧なので統合しない
  const tw = TRAILING_WHERE_REGEX.exec(result.trim());
  if (tw) {
    const ph = tw[1];
    const whereStr = tw[2];
    const filters = parseWhereStr(whereStr);
    if (filters !== null && specs[ph] && specs[ph].filters.length === 0) {
      specs[ph].filters = filters;
      result = ph;
    }
  }

  const out = { lifted: result, specs };
  liftCache.set(formula, out);
  return out;
}

// 単一の集計仕様を rows に対して計算
function computeAggregate(rows, spec, today) {
  const { fn, column, filters } = spec;
  // filters は OR-of-AND: [[{field,op,value}, ...], ...] (空配列はフィルタなし)
  const orGroups = filters.length
    ? filters.map(group => group.map(f => ({
        field: f.field, op: f.op, value: resolveValue(f.value, today),
      })))
    : null;
  let s = 0, count = 0, minV = null, maxV = null, distinct = null;
  if (fn === 'countDistinct') distinct = new Set();
  for (let i = 0, len = rows.length; i < len; i++) {
    const r = rows[i];
    if (orGroups) {
      // どれか1つの OR グループの AND 条件が全部 true なら通る
      let matched = false;
      for (let g = 0, gLen = orGroups.length; g < gLen; g++) {
        const ands = orGroups[g];
        let allMatch = true;
        for (let j = 0, aLen = ands.length; j < aLen; j++) {
          const f = ands[j];
          if (!evalFilter(r[f.field], f.op, f.value)) { allMatch = false; break; }
        }
        if (allMatch) { matched = true; break; }
      }
      if (!matched) continue;
    }
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

// 後方互換用: 旧 parseBaseFormula のシグネチャを維持。
// 「式が syntax として valid か」を判定する用途で使われる(settings.js の保存時バリデーション)。
// 新仕様では「式に1つ以上の集計関数を含むこと」を条件とする(従来の挙動と同等)。
export function parseBaseFormula(formula) {
  const key = String(formula || '');
  const { lifted, specs } = liftFormula(key);
  if (Object.keys(specs).length === 0) return null;
  // 1つ目の spec を返す(従来 API は単一の spec オブジェクトを期待していたので近い形に)
  const firstPh = Object.keys(specs)[0];
  return { ...specs[firstPh], lifted, specs };
}

// liftされた式をJS関数にコンパイル。識別子は ctx.X に書き換え。
function compileLifted(formula) {
  if (compiledLiftedCache.has(formula)) return compiledLiftedCache.get(formula);
  try {
    const code = formula.replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, m => `ctx.${m}`);
    const fn = new Function('ctx', `"use strict"; try{var v=(${code});return v===v&&v!==1/0&&v!==-1/0?v:0}catch(e){return 0}`);
    compiledLiftedCache.set(formula, fn);
    return fn;
  } catch (e) {
    const noop = () => 0;
    compiledLiftedCache.set(formula, noop);
    return noop;
  }
}

export function evalFormula(formula, ctx) {
  const { lifted } = liftFormula(String(formula || ''));
  return compileLifted(lifted)(ctx);
}

const _aggregateCache = new WeakMap();

export function aggregate(rows) {
  ensureKeyCache();
  const today = todayStr();
  const cached = _aggregateCache.get(rows);
  if (cached && cached.ref === cachedMetricDefsRef && cached.today === today) return cached.result;

  const a = {};
  const ctxBase = { __proto__: null, min: Math.min, max: Math.max, abs: Math.abs, pow: Math.pow, sqrt: Math.sqrt, round: Math.round, Math };

  const evalKey = (key, formula) => {
    const { lifted, specs } = liftFormula(String(formula || ''));
    const aggValues = {};
    for (const ph of Object.keys(specs)) {
      aggValues[ph] = computeAggregate(rows, specs[ph], today);
    }
    const ctx = Object.assign({ __proto__: null }, ctxBase, a, aggValues);
    const v = compileLifted(lifted)(ctx);
    a[key] = v;
  };

  // base → derived の順で評価 (派生は基礎を参照できる)
  for (const k of cachedBaseKeys) {
    const f = S.BASE_FORMULAS[k] || DEFAULT_BASE_FORMULAS[k] || '0';
    evalKey(k, f);
  }
  for (const k of cachedDerivedKeys) {
    const f = S.METRIC_FORMULAS[k] || DEFAULT_FORMULAS[k] || '0';
    evalKey(k, f);
  }

  _aggregateCache.set(rows, { ref: cachedMetricDefsRef, today, result: a });
  return a;
}

