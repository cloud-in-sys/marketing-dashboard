import { S } from '../app/state.js';

// 日付フィルタ (date_range / date_from / date_to) を単一の {field, from, to} に解決する。
//
// 背景: 期間フィルタは date_range (新形式・単一 def に from/to) と、旧形式の
// date_from / date_to が共存しうる (移行期は旧を消し忘れる可能性がある)。
// KPIカードの月モードはフロント描画 (cardsRender) とバックエンド集計 prefetch
// (aggregateBackend) の 2 経路で「基準となる日付カラム・期間」を必要とするが、
// 各所で優先順位が異なると同じ期間でも別の月を指すおそれがある。
// そこで解決ロジックをここに一元化し、両経路が必ず同じ結果を使うようにする。
//
// 優先順位: date_range を正規 (新形式) として最優先。無ければ date_from / date_to
// から組み立てる。混在時も date_range を優先することで挙動を一意に固定する。
// なお実データの絞り込み自体は applyFilters / serializeFilters が各 def を独立に
// AND 適用するため、この解決関数は「カード月モードの基準決め」専用。
export function resolveDateFilter() {
  const defs = S.FILTER_DEFS || [];
  const vals = S.FILTER_VALUES || {};
  const rangeDef = defs.find(d => d.type === 'date_range');
  const fromDef = defs.find(d => d.type === 'date_from');
  const toDef = defs.find(d => d.type === 'date_to');
  const rangeVal = rangeDef ? vals[rangeDef.id] : null;
  const field = rangeDef?.field || fromDef?.field || toDef?.field || 'action_date';
  const from = (rangeVal && rangeVal.from) || (fromDef ? vals[fromDef.id] : '') || '';
  const to = (rangeVal && rangeVal.to) || (toDef ? vals[toDef.id] : '') || '';
  return { field, from, to };
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
