// @ts-check
// AST 評価ロジック。WHERE 句の各 clause を行データに対して評価する。

export function num(v) { const n = +v; return n === n ? n : 0; }

export function todayStr() {
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

export function resolveValue(val, today) {
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

export function evalFilter(cell, op, target) {
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

export function evalAst(node, row, today) {
  if (!node) return true;
  if (node.type === 'and') return evalAst(node.left, row, today) && evalAst(node.right, row, today);
  if (node.type === 'or')  return evalAst(node.left, row, today) || evalAst(node.right, row, today);
  if (node.type === 'clause') {
    const target = resolveValue(node.value, today);
    return evalFilter(row[node.field], node.op, target);
  }
  return true;
}
