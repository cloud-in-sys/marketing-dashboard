// メトリクス式 / ディメンション式 / ビューフィルタ式の検証。
//
// backend/src/utils/expression.js の validateExpression と同じロジック。
// 同じエラーメッセージを返すことで、サーバー側で初めて気付くのではなく入力時点で UI に出せる。
// ※ FORBIDDEN リスト等を変更するときは backend 側も同期すること。

const MAX_LEN = 2000;

const FORBIDDEN = [
  /\bimport\b/i,
  /\brequire\b/i,
  /\beval\b/i,
  /\bFunction\s*\(/,
  /\bfunction\s*\(/,
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
  /\bconstructor\s*\./i,
  /\bprototype\b/,
  /\b__proto__\b/,
  /\bwhile\s*\(/,
  /\bfor\s*\(/,
  /\bdo\s*\{/,
  /\bsetInterval\s*\(/,
  /\bsetTimeout\s*\(/,
  /`/,
];

// 検証して問題があればエラーメッセージを返す。OK なら null。
// label は backend と揃えて 'formulas.<key>' 'dimensions[<key>].expression' 等を使う。
export function validateExpression(src, { label = 'expression' } = {}) {
  if (src == null || src === '') return null; // 空は OK
  if (typeof src !== 'string') return `${label} must be a string`;
  if (src.length > MAX_LEN) return `${label} too long (max ${MAX_LEN} chars)`;
  for (const re of FORBIDDEN) {
    if (re.test(src)) return `${label} contains forbidden token: ${re.source}`;
  }
  try {
    // eslint-disable-next-line no-new-func
    new Function('r', `"use strict"; return (${src});`);
  } catch (e) {
    return `${label} has syntax error: ${e.message}`;
  }
  return null;
}
