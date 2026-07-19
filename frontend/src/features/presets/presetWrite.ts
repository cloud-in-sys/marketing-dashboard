// プリセット全置換更新 (PUT) 用の正規化。
//
// PUT は backend が tx.set で doc を丸ごと差し替えるので、送信データに欠けた項目は
// Firestore から消える。旧プリセットや builtin seed は optional 項目 (cards / tableConfig
// 等) を持たないことがあるため、更新前にここで「完全な ReplacePresetRequest」へ正規化し、
// 未設定は空 ([] / {} / null) を明示する。元の preset は破壊しない (新しいオブジェクトを返す)。
//
// 型だけを import する純粋関数 (S / api に依存しない) なので、そのままテストできる。
import type { Preset, ReplacePresetRequest } from '@pkg/shared/api-types.ts';

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const asArray = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const asStrArray = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);

/**
 * `Preset` を全置換用の完全データへ正規化する。`name` は trim し、空ならエラー。
 * `order` は既存値を維持 (数値でなければ 0)。`id` は URL で指定するので含めない。
 */
export function toReplacePresetRequest(preset: Preset): ReplacePresetRequest {
  const name = (preset.name || '').trim();
  if (!name) throw new Error('preset name is required');
  return {
    name,
    builtin: preset.builtin ?? false,
    color: preset.color ?? null,
    order: typeof preset.order === 'number' ? preset.order : 0,
    seedVersion: typeof preset.seedVersion === 'number' ? preset.seedVersion : null,
    charts: asArray(preset.charts),
    cards: asArray(preset.cards),
    dims: asStrArray(preset.dims),
    metrics: asStrArray(preset.metrics),
    thresholds: asObject(preset.thresholds),
    thresholdMetrics: asStrArray(preset.thresholdMetrics),
    tableState: preset.tableState ?? null,
    tableConfig: preset.tableConfig ?? null,
    filterValues: asObject(preset.filterValues),
    filterConditions: asObject(preset.filterConditions),
  };
}
