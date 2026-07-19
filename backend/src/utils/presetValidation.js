// @ts-check
// プリセット全置換 (PUT /api/presets/:sid/:pid) の入力検証。
//
// PUT は tx.set で Firestore doc を丸ごと差し替えるので、部分データや未知フィールドを
// そのまま保存すると「送られなかった設定の消失」や「未知フィールドの混入」が起きる。
// TypeScript はブラウザ内の実装しか守らないため、backend でも ReplacePresetRequest
// (packages/shared/src/api-types.ts) と一致する実行時検証を行う。
//
// 純粋関数 (import 無し) なので frontend/test からもそのまま import してテストできる。

const isPlainObject = (/** @type {unknown} */ v) =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const isStringArray = (/** @type {unknown} */ v) =>
  Array.isArray(v) && v.every(x => typeof x === 'string');
const isFiniteNum = (/** @type {unknown} */ v) =>
  typeof v === 'number' && Number.isFinite(v);

/**
 * ReplacePresetRequest と一致する完全性・型検証を行い、**許可項目だけ**を詰め直した
 * clean オブジェクトを返す。1 つでも欠け/型不正があれば error を返す (Firestore は変更しない)。
 * id や未知フィールドは戻り値に含めない (= 保存しない)。
 *
 * @param {any} body - リクエスト body
 * @returns {{ error: string } | { preset: Record<string, unknown> }}
 */
export function validateReplacePreset(body) {
  if (!isPlainObject(body)) return { error: 'body must be an object' };
  const d = /** @type {Record<string, any>} */ (body);

  const name = typeof d.name === 'string' ? d.name.trim() : '';
  if (!name) return { error: 'preset name is required' };
  if (typeof d.builtin !== 'boolean') return { error: 'builtin must be a boolean' };
  if (!(d.color === null || typeof d.color === 'string')) return { error: 'color must be a string or null' };
  if (!isFiniteNum(d.order)) return { error: 'order must be a finite number' };
  if (!(d.seedVersion === null || isFiniteNum(d.seedVersion))) return { error: 'seedVersion must be a finite number or null' };
  if (!Array.isArray(d.charts)) return { error: 'charts must be an array' };
  if (!Array.isArray(d.cards)) return { error: 'cards must be an array' };
  if (!isStringArray(d.dims)) return { error: 'dims must be an array of strings' };
  if (!isStringArray(d.metrics)) return { error: 'metrics must be an array of strings' };
  if (!isPlainObject(d.thresholds)) return { error: 'thresholds must be an object' };
  if (!isStringArray(d.thresholdMetrics)) return { error: 'thresholdMetrics must be an array of strings' };
  if (!(d.tableState === null || isPlainObject(d.tableState))) return { error: 'tableState must be an object or null' };
  if (!(d.tableConfig === null || isPlainObject(d.tableConfig))) return { error: 'tableConfig must be an object or null' };
  if (!isPlainObject(d.filterValues)) return { error: 'filterValues must be an object' };
  if (!isPlainObject(d.filterConditions)) return { error: 'filterConditions must be an object' };

  // 許可項目だけを詰め直す (id / 未知フィールドは保存対象外)。
  return {
    preset: {
      name,
      builtin: d.builtin,
      color: d.color,
      order: d.order,
      seedVersion: d.seedVersion,
      charts: d.charts,
      cards: d.cards,
      dims: d.dims,
      metrics: d.metrics,
      thresholds: d.thresholds,
      thresholdMetrics: d.thresholdMetrics,
      tableState: d.tableState,
      tableConfig: d.tableConfig,
      filterValues: d.filterValues,
      filterConditions: d.filterConditions,
    },
  };
}
