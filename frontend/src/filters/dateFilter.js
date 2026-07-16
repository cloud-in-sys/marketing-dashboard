import { S } from '../app/state.js';

// 期間フィルタ (date_range) を単一の {field, from, to} に解決する。
//
// KPIカードの月モードはフロント描画 (cardsRender) とバックエンド集計 prefetch
// (aggregateBackend) の 2 経路で「基準となる日付カラム・期間」を必要とする。
// 各所で解決の仕方が違うと同じ期間でも別の月を指すおそれがあるので、ここに一元化して
// 両経路が必ず同じ結果を使うようにする。
// なお実データの絞り込み自体は applyFilters / serializeFilters が各 def を独立に
// AND 適用するため、この解決関数は「カード月モードの基準決め」専用。
//
// 旧形式の date_from / date_to は廃止済み (2026-07-17)。本番の全ソースを date_range へ
// 移行したことを確認したうえでコードからも削除した。
export function resolveDateFilter() {
  const defs = S.FILTER_DEFS || [];
  const vals = S.FILTER_VALUES || {};
  const rangeDef = defs.find(d => d.type === 'date_range');
  const rangeVal = rangeDef ? vals[rangeDef.id] : null;
  return {
    field: rangeDef?.field || 'action_date',
    from: (rangeVal && rangeVal.from) || '',
    to: (rangeVal && rangeVal.to) || '',
  };
}

// 期間フィルタのクイック選択 (今週/先週/今月/先月) を {from, to} (YYYY-MM-DD) で返す。
// 週は月曜始まり (今週=今週月曜〜日曜, 今月=1日〜月末) のカレンダー基準。
export function computeRangePreset(preset) {
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (preset === 'thisWeek' || preset === 'lastWeek') {
    const dow = (now.getDay() + 6) % 7; // 月曜=0 ... 日曜=6
    const monday = new Date(now);
    monday.setDate(now.getDate() - dow - (preset === 'lastWeek' ? 7 : 0));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { from: fmt(monday), to: fmt(sunday) };
  }
  if (preset === 'thisMonth' || preset === 'lastMonth') {
    const m = now.getMonth() + (preset === 'lastMonth' ? -1 : 0);
    const first = new Date(now.getFullYear(), m, 1);
    const last = new Date(now.getFullYear(), m + 1, 0);
    return { from: fmt(first), to: fmt(last) };
  }
  return { from: '', to: '' };
}
