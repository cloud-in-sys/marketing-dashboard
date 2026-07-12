import { S, DEFAULT_BASE_FORMULAS, DEFAULT_FORMULAS } from '../app/state.js';
import { getBackendTotals } from './aggregateCache.js';

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

// メトリクスの式が parent() / total() を含むか。
// これらの関数はピボットテーブルの階層集計でのみ意味を持つので、
// カード/グラフ設定 UI で警告を出すための判定に使う。
const RE_PARENT_TOTAL = /\b(parent|total)\s*\(/;
export function metricUsesHierarchy(metricKey) {
  const f = (S.METRIC_FORMULAS && S.METRIC_FORMULAS[metricKey]) ?? DEFAULT_FORMULAS[metricKey] ?? '';
  return RE_PARENT_TOTAL.test(String(f));
}

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
  const ast = parseWhereStr(whereStr);
  if (ast === false) return null;  // パースエラー
  return { fn: fnName, column, filters: ast };  // ast: null = フィルタなし、ASTノード = フィルタあり
}

// where 句を AST にパース (and / or / カッコでのグループ化対応)。
// AST ノード:
//   { type: 'and', left, right }
//   { type: 'or',  left, right }
//   { type: 'clause', field, op, value }
// 戻り値:
//   null  → フィルタなし (空入力)
//   ASTノード → 有効なフィルタ
//   false → パースエラー (呼び出し側はこれを検出して伝播)
function tokenizeWhere(str) {
  const tokens = [];
  let i = 0;
  let buf = '';
  const flush = () => {
    const t = buf.trim();
    if (t) tokens.push({ type: 'CLAUSE', text: t });
    buf = '';
  };
  while (i < str.length) {
    const ch = str[i];
    // 引用文字列は中身をまとめて buffer に(中の AND/OR/() を演算子と誤認しない)
    if (ch === "'" || ch === '"') {
      const quote = ch;
      buf += ch;
      i++;
      while (i < str.length && str[i] !== quote) buf += str[i++];
      if (i < str.length) buf += str[i++];
      continue;
    }
    if (ch === '(') {
      // 識別子直後の '(' は関数呼び出し (例: today()) として CLAUSE に含める
      if (buf.length > 0 && /[a-zA-Z0-9_]$/.test(buf)) {
        let depth = 1, j = i + 1, inS = false, inD = false;
        while (j < str.length && depth > 0) {
          const c = str[j];
          if (!inS && !inD) {
            if (c === '(') depth++;
            else if (c === ')') depth--;
            else if (c === "'") inS = true;
            else if (c === '"') inD = true;
          } else if (inS && c === "'") inS = false;
          else if (inD && c === '"') inD = false;
          j++;
        }
        buf += str.slice(i, j);
        i = j;
        continue;
      }
      flush(); tokens.push({ type: 'LPAREN' }); i++; continue;
    }
    if (ch === ')') { flush(); tokens.push({ type: 'RPAREN' }); i++; continue; }
    const rest = str.slice(i);
    const am = /^\s+and\s+/i.exec(rest);
    if (am) { flush(); tokens.push({ type: 'AND' }); i += am[0].length; continue; }
    const om = /^\s+or\s+/i.exec(rest);
    if (om) { flush(); tokens.push({ type: 'OR' }); i += om[0].length; continue; }
    buf += ch;
    i++;
  }
  flush();
  return tokens;
}

// 再帰下降パーサー
//   expr    := orExpr
//   orExpr  := andExpr (OR andExpr)*
//   andExpr := atom    (AND atom)*
//   atom    := LPAREN expr RPAREN | CLAUSE
function parseWhereAst(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = () => tokens[pos++];
  function orExpr() {
    let left = andExpr();
    if (left === false) return false;
    while (peek() && peek().type === 'OR') {
      eat();
      const right = andExpr();
      if (right === false) return false;
      left = { type: 'or', left, right };
    }
    return left;
  }
  function andExpr() {
    let left = atom();
    if (left === false) return false;
    while (peek() && peek().type === 'AND') {
      eat();
      const right = atom();
      if (right === false) return false;
      left = { type: 'and', left, right };
    }
    return left;
  }
  function atom() {
    const t = peek();
    if (!t) return false;
    if (t.type === 'LPAREN') {
      eat();
      const inner = orExpr();
      if (inner === false) return false;
      const next = peek();
      if (!next || next.type !== 'RPAREN') return false;
      eat();
      return inner;
    }
    if (t.type === 'CLAUSE') {
      eat();
      const pc = parseClause(t.text);
      if (!pc) return false;
      return { type: 'clause', field: pc.field, op: pc.op, value: parseValue(pc.valueStr) };
    }
    return false;
  }
  const ast = orExpr();
  if (ast === false) return false;
  if (pos < tokens.length) return false; // トークン余り
  return ast;
}

function parseWhereStr(whereStr) {
  if (!whereStr || !whereStr.trim()) return null;
  const tokens = tokenizeWhere(whereStr);
  if (tokens.length === 0) return null;
  return parseWhereAst(tokens);
}

// AST ノードを行データに対して評価
function evalAst(node, row, today) {
  if (!node) return true;
  if (node.type === 'and') return evalAst(node.left, row, today) && evalAst(node.right, row, today);
  if (node.type === 'or')  return evalAst(node.left, row, today) || evalAst(node.right, row, today);
  if (node.type === 'clause') {
    const target = resolveValue(node.value, today);
    return evalFilter(row[node.field], node.op, target);
  }
  return true;
}

// 式から集計関数呼び出しを抽出 → placeholder で置換した式と spec マップを返す
export function liftFormula(formula) {
  const cacheKey = formula;
  if (liftCache.has(cacheKey)) return liftCache.get(cacheKey);

  // parent(metric) / total(metric) を識別子化: __parent_metric__ / __total_metric__
  // (compileLifted の identifier→ctx 書き換えで自然に ctx.__parent_metric__ になる)
  // ctx 側で渡せばその値が、未設定なら undefined → コンパイル後の try/catch で 0 にフォールバック。
  formula = String(formula)
    .replace(/\bparent\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/g, '__parent_$1__')
    .replace(/\btotal\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/g, '__total_$1__');

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
  // inner で where が無い(filters=null)集計のみが対象。inner where が既にある場合は曖昧なので統合しない
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
  liftCache.set(cacheKey, out);
  return out;
}

// 単一の集計仕様を rows に対して計算
function computeAggregate(rows, spec, today) {
  const { fn, column, filters } = spec;
  // filters は AST (or null = フィルタなし)
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

// 基礎メトリクスとして妥当か (= 「単一の集計関数だけ」かを判定)。
// 比率/割り算/引き算など複数の集計を組み合わせる式は基礎ではなく派生で書くべき。
// 多重ディメンションのピボット親行で sumAggs が base を素朴に合算するため、
// 基礎に非線形な式が入ると親行の値がデタラメになる (CTR が 1477.98% になる等)。
//
// 許可: sum(col) / count() / avg(col) / sum(col) where x='広告' / sum(col where x='広告')
// 拒否: sum(a)/sum(b)、sum(a)-sum(b)、sum(a)*100、定数、メトリクス参照のみ など
export function isPureBaseFormula(formula) {
  const f = String(formula || '').trim();
  if (!f) return false;
  const { lifted, specs } = liftFormula(f);
  const phKeys = Object.keys(specs);
  if (phKeys.length !== 1) return false;
  // lift 後に残るのが placeholder それ自体だけなら純粋な集計
  return lifted.trim() === phKeys[0];
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
  // バックエンド集計の prefetch 済み結果があればそれを返す (ブラウザ側の重い計算をスキップ)。
  const backend = getBackendTotals(rows);
  if (backend) return backend;
  ensureKeyCache();
  const today = todayStr();
  const cached = _aggregateCache.get(rows);
  if (cached && cached.ref === cachedMetricDefsRef && cached.today === today) return cached.result;

  const a = {};
  const ctxBase = { __proto__: null, min: Math.min, max: Math.max, abs: Math.abs, pow: Math.pow, sqrt: Math.sqrt, round: Math.round, Math };

  const evalKey = (key, formula) => {
    // sparkline(...) は通常の数式ではないので評価をスキップ (描画は別経路)
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

