// WHERE 句のトークナイザ + AST パーサー。frontend/src/aggregate/aggregate.js から移植 (純粋ロジック)。

const WORD_OP_REGEX = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+(contains|notContains|startsWith|endsWith)\s+(.+?)\s*$/i;
const SYM_OP_REGEX  = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(<=|>=|!=|<|>|=)\s*(.+?)\s*$/;

function parseClause(clause) {
  const wm = WORD_OP_REGEX.exec(clause);
  if (wm) return { field: wm[1], op: wm[2].toLowerCase(), valueStr: wm[3] };
  const sm = SYM_OP_REGEX.exec(clause);
  if (sm) return { field: sm[1], op: sm[2], valueStr: sm[3] };
  return null;
}

function parseValue(s) {
  s = s.trim();
  const qm = /^'([^']*)'$/.exec(s) || /^"([^"]*)"$/.exec(s);
  if (qm) return { kind: 'literal', value: qm[1] };
  const tm = /^today\s*\(\s*\)\s*(?:([+\-])\s*(\d+))?\s*$/i.exec(s);
  if (tm) {
    const sign = tm[1] === '-' ? -1 : 1;
    const offset = tm[2] ? sign * Number(tm[2]) : 0;
    return { kind: 'today', offset };
  }
  return { kind: 'literal', value: s };
}

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
    if (ch === "'" || ch === '"') {
      const quote = ch;
      buf += ch;
      i++;
      while (i < str.length && str[i] !== quote) buf += str[i++];
      if (i < str.length) buf += str[i++];
      continue;
    }
    if (ch === '(') {
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
  if (pos < tokens.length) return false;
  return ast;
}

export function parseWhereStr(whereStr) {
  if (!whereStr || !whereStr.trim()) return null;
  const tokens = tokenizeWhere(whereStr);
  if (tokens.length === 0) return null;
  return parseWhereAst(tokens);
}

// クオート文字列を考慮した対応括弧探索。start は '(' の次の位置。
export function findCloseParen(str, start) {
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

export function parseAggregateInner(fnName, inner) {
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
  if (ast === false) return null;
  return { fn: fnName, column, filters: ast };
}
