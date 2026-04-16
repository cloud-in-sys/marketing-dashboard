// ユーザーが保存する JavaScript 式(メトリクス式 / ディメンション式 / ビューフィルタ式)の検証。
// フロントで new Function() 経由で各ユーザーのブラウザで実行されるため、
// 悪意ある管理者アカウントから全ユーザーへ JS を配布されるのを防ぐ。

const MAX_LEN = 2000;

// トークン/文字列として検出したら拒否する正規表現リスト
const FORBIDDEN = [
  /\bimport\b/i,
  /\brequire\b/i,
  /\beval\b/i,
  /\bFunction\s*\(/,
  /\bfunction\s*\(/,        // 関数宣言/式
  /\bfetch\s*\(/i,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bglobalThis\b/,
  /\bwindow\b/,
  /\bdocument\b/,
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
  /\bindexedDB\b/,
  /\bnavigator\b/,
  /\blocation\b/,
  /\bprocess\b/,
  /\bconstructor\s*\./i,    // fn.constructor("...")("") 経由の Function 呼び出し回避
  /\bprototype\b/,
  /\b__proto__\b/,
  /\bwhile\s*\(/,            // while 全般 (無限ループ回避)
  /\bfor\s*\(/,              // for 全般
  /\bdo\s*\{/,               // do { } while
  /\bsetInterval\s*\(/,
  /\bsetTimeout\s*\(/,
  /`/,                        // テンプレートリテラル(文字列補完経由の回避を封じる)
];

// 検証して問題があればエラーメッセージを返す。OK なら null。
export function validateExpression(src, { label = 'expression' } = {}) {
  if (src == null || src === '') return null; // 空はOK
  if (typeof src !== 'string') return `${label} must be a string`;
  if (src.length > MAX_LEN) return `${label} too long (max ${MAX_LEN} chars)`;
  for (const re of FORBIDDEN) {
    if (re.test(src)) return `${label} contains forbidden token: ${re.source}`;
  }
  // 構文チェック: new Function でパースのみ試みる(実行はしない)。
  // フロントは 'r' を引数にして実行するのでここも 'r' で検証する。
  try {
    // eslint-disable-next-line no-new-func
    new Function('r', `"use strict"; return (${src});`);
  } catch (e) {
    return `${label} has syntax error: ${e.message}`;
  }
  return null;
}

// config body のうち、式を含むフィールドをすべて検証する。
// 問題があれば最初のエラーメッセージを返す。
export function validateConfigExpressions(body) {
  if (!body || typeof body !== 'object') return null;

  // formulas: { [key]: 'js expression' }
  if (body.formulas && typeof body.formulas === 'object') {
    for (const [k, v] of Object.entries(body.formulas)) {
      const e = validateExpression(v, { label: `formulas.${k}` });
      if (e) return e;
    }
  }

  // dimensions: [{ key, type, expression? }]
  if (Array.isArray(body.dimensions)) {
    for (const d of body.dimensions) {
      if (d && d.type === 'expression') {
        const e = validateExpression(d.expression, { label: `dimensions[${d.key || ''}].expression` });
        if (e) return e;
      }
    }
  }

  // views: { [k]: { filter? filterExpr? } }
  if (body.views && typeof body.views === 'object') {
    for (const [k, v] of Object.entries(body.views)) {
      if (!v) continue;
      const e1 = validateExpression(v.filter, { label: `views.${k}.filter` });
      if (e1) return e1;
      const e2 = validateExpression(v.filterExpr, { label: `views.${k}.filterExpr` });
      if (e2) return e2;
    }
  }

  // state.cards: [{ filterExpr? }]
  if (body.state && Array.isArray(body.state.cards)) {
    for (const card of body.state.cards) {
      if (!card) continue;
      const e = validateExpression(card.filterExpr, { label: `cards[${card.id || ''}].filterExpr` });
      if (e) return e;
    }
  }

  return null;
}

// 式フィールドの差分を抽出 (before/after を配列で返す)
// 呼び出し側は変更があったもののみ履歴に記録する。
export function diffExpressionFields(before = {}, after = {}) {
  const diffs = [];
  const b = before || {};
  const a = after || {};

  const pushDiff = (fieldKind, fieldKey, beforeVal, afterVal) => {
    const bs = beforeVal == null ? '' : String(beforeVal);
    const as = afterVal == null ? '' : String(afterVal);
    if (bs !== as) diffs.push({ fieldKind, fieldKey, before: bs, after: as });
  };

  // formulas
  const bf = b.formulas || {};
  const af = a.formulas || {};
  const keys = new Set([...Object.keys(bf), ...Object.keys(af)]);
  for (const k of keys) pushDiff('formula', k, bf[k], af[k]);

  // dimensions (expression only)
  const bd = Array.isArray(b.dimensions) ? b.dimensions : [];
  const ad = Array.isArray(a.dimensions) ? a.dimensions : [];
  const bdMap = new Map(bd.map(d => [d.key, d]));
  const adMap = new Map(ad.map(d => [d.key, d]));
  const dkeys = new Set([...bdMap.keys(), ...adMap.keys()]);
  for (const k of dkeys) {
    const be = bdMap.get(k)?.expression;
    const ae = adMap.get(k)?.expression;
    pushDiff('dimension', k, be, ae);
  }

  // views.filter / filterExpr
  const bv = b.views || {};
  const av = a.views || {};
  const vkeys = new Set([...Object.keys(bv), ...Object.keys(av)]);
  for (const k of vkeys) {
    pushDiff('view.filter', k, bv[k]?.filter, av[k]?.filter);
    pushDiff('view.filterExpr', k, bv[k]?.filterExpr, av[k]?.filterExpr);
  }

  return diffs;
}
