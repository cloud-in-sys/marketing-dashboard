// グループの行フィルタ (groups/{gid}.sourceFilters[sid]) の検証。
//
// 行フィルタは「このグループには条件に一致する行だけ見せる」という絞り込みで、
// 認可の一部。したがって壊れた設定は fail-closed (何も見せない) で扱う。
// 以前は未知の op や不正な正規表現を「一致 = true」として扱っており、
// 設定が壊れた瞬間に全行が見えてしまう状態だった。
//
// 保存時 (routes/groups.js) と実行時 (aggregate/sourceAccess.js) で同じ
// allowlist を使うこと。片方だけ緩いと、保存できてしまった不正値が実行時に
// どう扱われるか分からなくなる。

// 単一値を取る op と、配列を取る op (このファイル内でのみ使う)
const SINGLE_VALUE_OPS = ['equals', 'regex', 'notRegex'];
const MULTI_VALUE_OPS = ['in', 'notIn'];
const FILTER_OPS = [...SINGLE_VALUE_OPS, ...MULTI_VALUE_OPS];

// フィルタ 1 件を検証。問題があればエラーメッセージ、なければ null。
// 「フィルタなし」(null / undefined / field 空) は正当なので null を返す。
export function validateGroupFilter(f) {
  if (f == null) return null;
  if (typeof f !== 'object' || Array.isArray(f)) return 'filter must be an object';
  // field 未設定 = 絞り込みなし (UI の初期状態)。op/value は見ない。
  if (f.field === undefined || f.field === null || f.field === '') return null;
  if (typeof f.field !== 'string') return 'filter.field must be a string';

  const op = f.op;
  if (!FILTER_OPS.includes(op)) return `filter.op must be one of: ${FILTER_OPS.join(', ')}`;

  if (MULTI_VALUE_OPS.includes(op)) {
    if (!Array.isArray(f.values)) return `filter.values must be an array for op=${op}`;
    if (f.values.some(v => typeof v === 'object' && v !== null)) {
      return `filter.values must contain primitives for op=${op}`;
    }
  } else {
    // equals / regex / notRegex は単一値。undefined/null は「空文字と一致」の意味で許容する
    // (既存データが value なしで保存されているため。後方互換)
    if (f.value !== undefined && f.value !== null && typeof f.value === 'object') {
      return `filter.value must be a primitive for op=${op}`;
    }
  }

  if (op === 'regex' || op === 'notRegex') {
    try { new RegExp(String(f.value ?? '')); }
    catch (e) { return `invalid regex: ${e.message}`; }
  }
  return null;
}

// sourceFilters マップ全体を検証。問題があればエラーメッセージ、なければ null。
export function validateSourceFilters(sf) {
  if (sf == null) return null;
  if (typeof sf !== 'object' || Array.isArray(sf)) return 'sourceFilters must be an object';
  for (const [sid, f] of Object.entries(sf)) {
    const err = validateGroupFilter(f);
    if (err) return `source ${sid}: ${err}`;
  }
  return null;
}
