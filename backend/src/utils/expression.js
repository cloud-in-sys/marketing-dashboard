// @ts-check
// ユーザーが保存する式 (メトリクス式 / ディメンション式 / ビューフィルタ式) の検証。
// AST ベースの allowlist 評価器 (safeExpr) で validate する。
// 旧実装は blocklist + new Function 構文チェック → constructor bracket 経由の脱出が可能だった。

import { validateSafeExpr } from './safeExpr.js';
import { liftFormula } from '../aggregate/compute.js';

// 検証して問題があればエラー文字列 (`<label>: <detail>`) を返す。OK なら null。
// options.allowAnyIdentifier: compileLifted のように識別子を呼び出し側で
// 解決するケース向け (default: false = 厳格モード)。
export function validateExpression(src, options = {}) {
  const { label = 'expression', allowAnyIdentifier = false } = options;
  if (src == null || src === '') return null; // 空はOK
  if (typeof src !== 'string') return `${label} must be a string`;
  const err = validateSafeExpr(src, { allowAnyIdentifier });
  if (err) return `${label}: ${err}`;
  return null;
}

// 内部ヘルパ: {field, detail} を返す (構造化エラー用)。OK なら null。
// validateExpression と挙動は同じだが、field と detail を分離。
function validateExpressionStructured(src, field, options = {}) {
  const { allowAnyIdentifier = false } = options;
  if (src == null || src === '') return null;
  if (typeof src !== 'string') return { field, detail: 'must be a string' };
  const err = validateSafeExpr(src, { allowAnyIdentifier });
  if (err) return { field, detail: err };
  return null;
}

// config body のうち、式を含むフィールドをすべて検証する。
// 問題があれば {field, detail} を返す。OK なら null。
// (旧 API: `Invalid expression: ${field}: expression error: ${detail}` を組み立てていた;
//  今は field / detail を構造化して呼び出し側に渡す)
//
// フィールド別の識別子ポリシー:
//   - formulas / baseFormulas: メトリクスキー / sum/count/avg 等 DSL 関数 / __agg_N__ を含む
//     → allowAnyIdentifier=true。identifier はランタイムで ctx (__proto__: null) 経由に
//        置き換わるので、識別子の allowlist は不要 (構文構造の危険は引き続きブロック)。
//   - dimensions[].expression / views.filter / cards.filterExpr: r-スコープの JS 式
//     → 厳格 allowlist (r + Math + String + Number + parseInt 等) のみ許可。
export function validateConfigExpressions(body) {
  if (!body || typeof body !== 'object') return null;

  // formulas / baseFormulas:
  //   `sum(x where cond)` などの DSL は JS 文法上不正なので、liftFormula で
  //   `__agg_N__` プレースホルダに変換してから AST validate する。
  const formulaFields = ['formulas', 'baseFormulas'];
  for (const field of formulaFields) {
    if (body[field] && typeof body[field] === 'object') {
      for (const [k, v] of Object.entries(body[field])) {
        if (v == null || v === '') continue;
        if (typeof v !== 'string') return { field: `${field}.${k}`, detail: 'must be a string' };
        const { lifted } = liftFormula(v);
        const e = validateExpressionStructured(lifted, `${field}.${k}`, { allowAnyIdentifier: true });
        if (e) return e;
      }
    }
  }

  // dimensions: [{ key, type, expression? }]  — r-スコープ (厳格)
  if (Array.isArray(body.dimensions)) {
    for (const d of body.dimensions) {
      if (d && d.type === 'expression') {
        const e = validateExpressionStructured(d.expression, `dimensions[${d.key || ''}].expression`);
        if (e) return e;
      }
    }
  }

  // views: { [k]: { filter? filterExpr? } }  — r-スコープ (厳格)
  if (body.views && typeof body.views === 'object') {
    for (const [k, v] of Object.entries(body.views)) {
      if (!v) continue;
      const e1 = validateExpressionStructured(v.filter, `views.${k}.filter`);
      if (e1) return e1;
      const e2 = validateExpressionStructured(v.filterExpr, `views.${k}.filterExpr`);
      if (e2) return e2;
    }
  }

  // state.cards: [{ filterExpr? }]  — r-スコープ (厳格)
  if (body.state && Array.isArray(body.state.cards)) {
    for (const card of body.state.cards) {
      if (!card) continue;
      const e = validateExpressionStructured(card.filterExpr, `cards[${card.id || ''}].filterExpr`);
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
