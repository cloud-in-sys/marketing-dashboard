// メトリクスキーのリネーム波及 (computeRenames / remapMetricRefs) の検査。
import { computeRenames, remapMetricRefs } from '../src/features/settings/metrics/metricKeyRename.ts';

let fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`NG★ ${name}\n     got =${JSON.stringify(got)}\n     want=${JSON.stringify(want)}`); }
  else console.log(`OK  ${name}`);
};

console.log('═══ computeRenames ═══');
t('_origKey と現キーが違えば old->new', computeRenames([{ key: 'B', _origKey: 'A' }]), { A: 'B' });
t('変更なし(_origKey==key)は含めない', computeRenames([{ key: 'A', _origKey: 'A' }]), {});
t('新規(_origKey なし)は含めない', computeRenames([{ key: 'X' }]), {});
t('A->B->C は最終 A->C (単一 def)', computeRenames([{ key: 'C', _origKey: 'A' }]), { A: 'C' });
t('複数リネーム', computeRenames([{ key: 'b', _origKey: 'a' }, { key: 'y', _origKey: 'x' }]), { a: 'b', x: 'y' });

const R = { ad_cost: 'cost', clicks: 'click' };

console.log('\n═══ remapMetricRefs: 配列 / thresholds ═══');
{
  const { bundle, changed } = remapMetricRefs({
    metrics: ['ad_cost', 'clicks', 'cv'],
    metricOrder: ['clicks', 'ad_cost', 'cv'],
    thresholdMetrics: ['ad_cost'],
    thresholds: { ad_cost: { warn: 1 }, cv: { warn: 2 } },
  }, R);
  t('changed', changed, true);
  t('metrics 付け替え', bundle.metrics, ['cost', 'click', 'cv']);
  t('metricOrder 付け替え', bundle.metricOrder, ['click', 'cost', 'cv']);
  t('thresholdMetrics 付け替え', bundle.thresholdMetrics, ['cost']);
  t('thresholds のキー付け替え(値は保持)', bundle.thresholds, { cost: { warn: 1 }, cv: { warn: 2 } });
}

console.log('\n═══ charts (metric / lines / metric2..4) ═══');
{
  const { bundle } = remapMetricRefs({
    charts: [
      { id: 1, metric: 'ad_cost', lines: [{ metric: 'clicks', color: '#000' }, { metric: 'cv', color: '#111' }] },
      { id: 2, metric: 'cv', metric2: 'ad_cost', metric3: 'clicks' },
    ],
  }, R);
  t('chart.metric', bundle.charts[0].metric, 'cost');
  t('chart.lines[].metric', bundle.charts[0].lines.map(l => l.metric), ['click', 'cv']);
  t('chart.lines の色は保持', bundle.charts[0].lines[0].color, '#000');
  t('chart.metric2/3 (旧スキーマ)', [bundle.charts[1].metric2, bundle.charts[1].metric3], ['cost', 'click']);
  t('chart.metric (変更なしは維持)', bundle.charts[1].metric, 'cv');
}

console.log('\n═══ cards (metric / subMetric) ═══');
{
  const { bundle } = remapMetricRefs({
    cards: [{ id: 1, metric: 'ad_cost', subMetric: 'clicks' }, { id: 2, metric: 'cv' }],
  }, R);
  t('card.metric', bundle.cards[0].metric, 'cost');
  t('card.subMetric', bundle.cards[0].subMetric, 'click');
  t('card 変更なしは維持', bundle.cards[1].metric, 'cv');
}

console.log('\n═══ tableConfig (styles/headerStyles/filters/sort、dim: は不変) ═══');
{
  const { bundle } = remapMetricRefs({
    tableConfig: {
      styles: { ad_cost: { bold: true }, 'dim:action_date': { bold: false } },
      headerStyles: { clicks: { align: 'right' } },
      filters: { ad_cost: { op: '>' } },
      sort: { list: [{ col: 'ad_cost', dir: 'desc' }, { col: 'dim:action_date', dir: 'asc' }] },
    },
  }, R);
  t('styles のメトリクスキー付け替え', bundle.tableConfig.styles.cost, { bold: true });
  t('styles の dim: は不変', 'dim:action_date' in bundle.tableConfig.styles, true);
  t('headerStyles 付け替え', bundle.tableConfig.headerStyles.click, { align: 'right' });
  t('filters 付け替え', bundle.tableConfig.filters.cost, { op: '>' });
  t('sort.list[].col 付け替え', bundle.tableConfig.sort.list[0].col, 'cost');
  t('sort.list の dim: は不変', bundle.tableConfig.sort.list[1].col, 'dim:action_date');
}

console.log('\n═══ 無関係/空 は変更しない ═══');
{
  const src = { metrics: ['cv'], charts: [{ id: 1, metric: 'cv' }] };
  const { bundle, changed } = remapMetricRefs(src, R);
  t('該当キーが無ければ changed=false', changed, false);
  t('空リネームは素通り', remapMetricRefs(src, {}).changed, false);
  t('bundle は元の項目を保持', bundle.metrics, ['cv']);
}

console.log(fail ? `\n❌ ${fail} 件の不一致` : '\n✅ 全て期待どおり');
process.exit(fail ? 1 : 0);
