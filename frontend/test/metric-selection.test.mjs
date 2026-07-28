// resolveMetricSelection の復元ルール検査。
// 肝は「metrics: undefined (未設定→全表示)」と「metrics: [] (明示的な全非表示)」の区別。
// setMetricSelection / ensureMetricOrder はこの純粋関数へ委譲している。

import { resolveMetricSelection } from '../src/app/metricSelection.ts';

let fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`NG★ ${name}\n     got =${JSON.stringify(got)}\n     want=${JSON.stringify(want)}`); }
  else console.log(`OK  ${name}`);
};

const DEFS = ['ad_cost', 'clicks', 'cv'];

console.log('═══ metrics の undefined と [] を区別する ═══');
{
  // 未設定 (旧データ・初期状態) → 全表示
  const r = resolveMetricSelection(DEFS, undefined, undefined);
  t('★metrics 未設定は全表示', r.selected, DEFS);
  t('未設定でも order は全キー', r.order, DEFS);
}
{
  // 明示的な [] → 全非表示 (これが今回の修正の主眼)
  const r = resolveMetricSelection(DEFS, [], undefined);
  t('★metrics: [] は全非表示のまま', r.selected, []);
  t('★全非表示でも METRIC_ORDER は全キーを保持', r.order, DEFS);
}
{
  // 一部表示・一部非表示は維持
  const r = resolveMetricSelection(DEFS, ['clicks'], undefined);
  t('一部表示は維持 (selected)', r.selected, ['clicks']);
  // metricOrder 未設定の旧データ → [表示中, ...残りを定義順]
  t('旧データの order は表示中を先頭に導出', r.order, ['clicks', 'ad_cost', 'cv']);
}

console.log('\n═══ 全非表示から 1 件表示すると元の位置へ戻る ═══');
{
  // 全非表示状態 (order は保持済み) で 'cv' を表示に切り替えた想定
  const fullOrder = ['ad_cost', 'clicks', 'cv'];
  const r = resolveMetricSelection(DEFS, ['cv'], fullOrder);
  t('selected は cv のみ', r.selected, ['cv']);
  t('★order は保存順のまま (cv は元の index=2)', r.order, fullOrder);
  t('cv の位置が末尾でなく元位置', r.order.indexOf('cv'), 2);
}

console.log('\n═══ ensureMetricOrder 相当 (現在の selected を配列で渡す) ═══');
{
  // 全非表示 [] を渡しても全表示に化けない (空=全表示ルールは array には効かない)
  const r = resolveMetricSelection(DEFS, [], ['ad_cost', 'clicks', 'cv']);
  t('★空 selected を渡しても全非表示のまま', r.selected, []);
}

console.log('\n═══ order の正規化 (増減・重複・不明キー) ═══');
{
  // 新規メトリクスは末尾へ
  const r = resolveMetricSelection(DEFS, ['ad_cost'], ['ad_cost', 'clicks']);
  t('定義にあって order に無いキー (cv) は末尾へ', r.order, ['ad_cost', 'clicks', 'cv']);
}
{
  // order 内の重複は 1 件に
  const r = resolveMetricSelection(DEFS, undefined, ['ad_cost', 'ad_cost', 'clicks']);
  t('order の重複は 1 件に正規化', r.order, ['ad_cost', 'clicks', 'cv']);
}
{
  // 定義に無いキーは除外 (metrics 側・order 側の両方)
  const r = resolveMetricSelection(DEFS, ['clicks', 'ghost'], ['ghost', 'cv', 'ad_cost']);
  t('metrics の不明キー (ghost) は selected から除外', r.selected, ['clicks']);
  t('order の不明キー (ghost) は除外', r.order.includes('ghost'), false);
  t('order は既知キーのみ', r.order, ['cv', 'ad_cost', 'clicks']);
}

console.log(fail ? `\n❌ ${fail} 件の不一致` : '\n✅ 全て期待どおり');
process.exit(fail ? 1 : 0);
