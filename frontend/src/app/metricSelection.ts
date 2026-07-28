// メトリクスの並び順 (order) と表示中集合 (selected) を保存データから解決する純粋関数。
//
// state.ts の setMetricSelection / ensureMetricOrder がこれに委譲する。
// state.ts は firebase 等に依存して node から import できないため、ロジックだけを
// ここに切り出してテスト可能にしている (perms / presetWrite と同じ方針)。import を持たないこと。
//
// savedMetrics の意味 (undefined と [] を区別するのが肝):
//   - undefined      : 未設定 (旧データ・初期状態) → **全表示**
//   - []             : 明示的な全非表示 → **全非表示** (この状態を保存・復元できるようにする)
//   - ['a','b', ...] : その値だけ表示
//
// savedOrder (全並び順):
//   - 未設定・空       : [...表示中, ...残りを定義順] で導出 (旧データの見た目を再現)
//   - 値あり           : 保存順を使用
//   - 定義に無いキー    : 除外 / 定義にあって順序に無いキー: 末尾へ / 重複: 1 件に正規化
//   ※ 全非表示でも order は全メトリクスを保持する (表示に戻すと元の位置へ復帰できる)。

export function resolveMetricSelection(
  defKeys: string[],
  savedMetrics: unknown,
  savedOrder: unknown,
): { order: string[]; selected: string[] } {
  const defSet = new Set(defKeys);
  // Array なら (空配列 [] を含めて) その値をそのまま使う。undefined/非配列のときだけ全表示。
  const visible = Array.isArray(savedMetrics)
    ? (savedMetrics as unknown[]).filter((k): k is string => typeof k === 'string' && defSet.has(k))
    : defKeys.slice();
  const base = (Array.isArray(savedOrder) && savedOrder.length)
    ? (savedOrder as unknown[])
    : [...visible, ...defKeys];
  const seen = new Set<string>();
  const order: string[] = [];
  for (const k of base) if (typeof k === 'string' && defSet.has(k) && !seen.has(k)) { order.push(k); seen.add(k); }
  for (const k of defKeys) if (!seen.has(k)) { order.push(k); seen.add(k); }
  const visSet = new Set(visible);
  return { order, selected: order.filter(k => visSet.has(k)) };
}
