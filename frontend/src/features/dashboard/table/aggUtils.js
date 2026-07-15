// テーブル描画で使う集計ヘルパー。
// 行ピボット (pivot) と転置 (transpose) の両方から使うため table.js から切り出した。
// module スコープの可変状態 (折り畳み/固定列/倍率) には依存しない純粋な処理のみ置くこと。
import { S, DEFAULT_FORMULAS } from '../../../app/state.js';
import { baseMetricKeys, derivedMetricKeys, evalFormula } from '../../../aggregate/aggregate.js';

// Sum pre-computed aggregates (avoids re-scanning rows)
// parentAgg / totalAgg を渡すと、派生メトリクスの式中で parent(X) / total(X) を解決可能。
export function sumAggs(aggs, parentAgg = null, totalAgg = null) {
  if (aggs.length === 1 && !parentAgg && !totalAgg) return aggs[0];
  const result = {};
  const baseKeys = baseMetricKeys();
  for (const k of baseKeys) {
    let s = 0;
    for (let i = 0; i < aggs.length; i++) s += aggs[i][k] || 0;
    result[k] = s;
  }
  // Recompute derived with parent/total context
  return evalDerivedWithContext(result, parentAgg, totalAgg);
}

// base 集計に対して派生メトリクスを parent/total context つきで評価する。
// ctx に __parent_X__ / __total_X__ を積むことで、式中の parent(X) / total(X) が解決される。
export function evalDerivedWithContext(baseAgg, parentAgg, totalAgg) {
  const result = {...baseAgg};
  const ctx = {...result, min: Math.min, max: Math.max, abs: Math.abs, pow: Math.pow, sqrt: Math.sqrt, round: Math.round, Math};
  if (parentAgg) for (const k of Object.keys(parentAgg)) ctx['__parent_' + k + '__'] = parentAgg[k];
  if (totalAgg)  for (const k of Object.keys(totalAgg))  ctx['__total_'  + k + '__'] = totalAgg[k];
  const derivedKeys = derivedMetricKeys();
  for (const k of derivedKeys) {
    const f = S.METRIC_FORMULAS[k] || DEFAULT_FORMULAS[k] || '0';
    const v = evalFormula(f, ctx);
    ctx[k] = v;
    result[k] = v;
  }
  return result;
}
