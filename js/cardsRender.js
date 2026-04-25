import { S } from './state.js';
import { escapeHtml } from './utils.js';
import { aggregate } from './aggregate.js';
import { formatMetricValue } from './chart.js';

// ===== KPIカード =====
// 期間フィルタ用のヘルパー: 日付フィルタの field を特定してその月一覧を抽出
function getCardDateField() {
  const f = (S.FILTER_DEFS || []).find(x => x.type === 'date_from' || x.type === 'date_to');
  return f?.field || 'action_date';
}
// 日付値の YYYY-MM 部分を取得 (時刻や '/' 区切りも吸収)
function rowMonth(v) {
  if (v == null) return '';
  return String(v).slice(0, 10).replace(/\//g, '-').slice(0, 7);
}
function getMonthsAvailable(rows, field) {
  const set = new Set();
  for (const r of rows) {
    const m = rowMonth(r[field]);
    if (/^\d{4}-\d{2}$/.test(m)) set.add(m);
  }
  return [...set].sort();
}
// 期間フィルタに開始日 or 終了日のどちらかが未入力なら、
// データから月を拾わずに「昨日の月」を基準にする。
function isFilterRangeOpen() {
  const defs = S.FILTER_DEFS || [];
  const vals = S.FILTER_VALUES || {};
  const fromDef = defs.find(d => d.type === 'date_from');
  const toDef = defs.find(d => d.type === 'date_to');
  if (!fromDef || !toDef) return true;
  return !vals[fromDef.id] || !vals[toDef.id];
}
function yesterdayMonth(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() - 1);                 // yesterday
  d.setMonth(d.getMonth() - offset);          // offset 月分前 (0 = 昨日の月, 1 = その先月)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// rows をカードのフィルタモードに従って絞り込む
function applyCardFilter(rows, card) {
  const mode = card.filterMode || 'follow';
  if (mode === 'follow') return rows;
  if (mode === 'latest_month' || mode === 'prev_month') {
    const field = getCardDateField();
    let target;
    // 期間フィルタが片側でも空なら、昨日基準で対象月を決める
    if (isFilterRangeOpen()) {
      target = mode === 'latest_month' ? yesterdayMonth(0) : yesterdayMonth(1);
    } else {
      const months = getMonthsAvailable(rows, field);
      if (!months.length) return rows;
      target = mode === 'latest_month' ? months[months.length - 1] : months[months.length - 2];
    }
    if (!target) return [];
    // フィルタが空の場合は S.RAW から拾う(日付フィルタで切られていない原本)
    const source = isFilterRangeOpen() ? S.RAW : rows;
    return source.filter(r => rowMonth(r[field]) === target);
  }
  return rows;
}

export function renderCards(rows) {
  const grid = document.getElementById('cards-grid');
  if (!grid) return;
  // 設定パネルを開いていたカードが削除されたらパネルを閉じる
  // (中身の再描画は入力中のフォーカス/カーソルが飛ぶので行わない)
  if (S.CARD_SETTINGS_ID != null && !S.CARDS.some(c => c.id === S.CARD_SETTINGS_ID)) {
    closeCardSettings();
  }
  if (!S.CARDS.length) {
    grid.innerHTML = '<div class="cards-empty">右上の「+ カード」からカードを追加できます</div>';
    return;
  }
  // フィルタなしの全体集計はキャッシュ。期間カードはその都度。
  const fullAgg = aggregate(rows);
  grid.innerHTML = S.CARDS.map(card => {
    const mode = card.filterMode || 'follow';
    const agg = mode === 'follow' ? fullAgg : aggregate(applyCardFilter(rows, card));
    const mdef = S.METRIC_DEFS.find(m => m.key === card.metric);
    const val = mdef ? formatMetricValue(mdef, agg[card.metric] || 0) : '—';
    const subDef = S.METRIC_DEFS.find(m => m.key === card.subMetric);
    const subVal = subDef ? `${escapeHtml(card.subLabel || subDef.label)}: ${formatMetricValue(subDef, agg[card.subMetric] || 0)}` : '';
    const label = escapeHtml(card.label || (mdef ? mdef.label : 'カード'));
    const bg = card.bgColor || '';
    // 旧 textColor は3要素のフォールバックとして互換
    const fallback = card.textColor || '';
    const labelColor = card.labelColor || fallback;
    const valueColor = card.valueColor || fallback;
    const subColor   = card.subColor   || fallback;
    const cardStyle  = bg ? `background:${bg};` : '';
    const ls = labelColor ? `color:${labelColor};` : '';
    const vs = valueColor ? `color:${valueColor};` : '';
    const ss = subColor   ? `color:${subColor};`   : '';
    const sizeCls = card.size || 'small';
    return `
      <div class="kpi-card kpi-card-${sizeCls}" data-card-id="${card.id}" draggable="true" style="${cardStyle}">
        <div class="kpi-card-head">
          <input type="text" class="kpi-card-label" data-card-role="label" value="${label}" placeholder="名称" style="${ls}">
          <div class="kpi-card-actions">
            <button type="button" class="chart-settings-btn" data-card-role="settings" title="設定">⚙</button>
            <button type="button" class="chart-remove" data-card-role="remove" aria-label="削除">×</button>
          </div>
        </div>
        <div class="kpi-card-value" style="${vs}">${val}</div>
        ${subVal ? `<div class="kpi-card-sub" style="${ss}">${subVal}</div>` : ''}
      </div>
    `;
  }).join('');
}

export function openCardSettings(cardId) {
  S.CARD_SETTINGS_ID = cardId;
  renderCardSettingsPanel();
  document.getElementById('card-settings-panel').classList.remove('hidden');
  document.getElementById('card-settings-backdrop').classList.remove('hidden');
}

export function closeCardSettings() {
  S.CARD_SETTINGS_ID = null;
  document.getElementById('card-settings-panel').classList.add('hidden');
  document.getElementById('card-settings-backdrop').classList.add('hidden');
}

export function renderCardSettingsPanel() {
  const body = document.getElementById('card-settings-body');
  if (!body) return;
  const c = S.CARDS.find(x => x.id === S.CARD_SETTINGS_ID);
  if (!c) { body.innerHTML = ''; return; }
  body.innerHTML = `
    <div class="card-settings-section">
      <div class="card-settings-section-title">メイン</div>
      <label class="chart-settings-field">
        <span class="chart-settings-label">表示名</span>
        <input type="text" data-card-panel-role="label" value="${escapeHtml(c.label || '')}" placeholder="例: 売上">
      </label>
      <label class="chart-settings-field">
        <span class="chart-settings-label">サイズ</span>
        <select data-card-panel-role="size">
          <option value="small"${(c.size || 'small') === 'small' ? ' selected' : ''}>小</option>
          <option value="medium"${c.size === 'medium' ? ' selected' : ''}>中</option>
          <option value="large"${c.size === 'large' ? ' selected' : ''}>大</option>
          <option value="full"${c.size === 'full' ? ' selected' : ''}>横幅いっぱい</option>
        </select>
      </label>
      <label class="chart-settings-field">
        <span class="chart-settings-label">メトリクス</span>
        <select data-card-panel-role="metric">
          <option value="">— 選択してください —</option>
          ${S.METRIC_DEFS.map(m => `<option value="${m.key}"${c.metric === m.key ? ' selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="card-settings-section">
      <div class="card-settings-section-title">サブ（任意）</div>
      <label class="chart-settings-field">
        <span class="chart-settings-label">表示名</span>
        <input type="text" data-card-panel-role="subLabel" value="${escapeHtml(c.subLabel || '')}" placeholder="例: アイテム単価">
      </label>
      <label class="chart-settings-field">
        <span class="chart-settings-label">メトリクス</span>
        <select data-card-panel-role="subMetric">
          <option value="">— なし —</option>
          ${S.METRIC_DEFS.map(m => `<option value="${m.key}"${c.subMetric === m.key ? ' selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="card-settings-section">
      <div class="card-settings-section-title">期間</div>
      <label class="chart-settings-field">
        <span class="chart-settings-label">対象データ</span>
        <select data-card-panel-role="filterMode">
          <option value="follow"${(c.filterMode || 'follow') === 'follow' ? ' selected' : ''}>フィルタに追従</option>
          <option value="latest_month"${c.filterMode === 'latest_month' ? ' selected' : ''}>最新月のみ</option>
          <option value="prev_month"${c.filterMode === 'prev_month' ? ' selected' : ''}>先月のみ</option>
        </select>
      </label>
      <div class="card-settings-hint">「最新月/先月」は現在のフィルタ範囲内で自動判定</div>
    </div>
    <div class="card-settings-section">
      <div class="card-settings-section-title">配色</div>
      <label class="chart-settings-field">
        <span class="chart-settings-label">背景色</span>
        <input type="color" data-card-panel-role="bgColor" value="${c.bgColor || '#ffffff'}">
      </label>
      <div class="chart-settings-row">
        <label class="chart-settings-field" style="flex:1">
          <span class="chart-settings-label">表示名</span>
          <input type="color" data-card-panel-role="labelColor" value="${c.labelColor || c.textColor || '#64748b'}">
        </label>
        <label class="chart-settings-field" style="flex:1">
          <span class="chart-settings-label">集計結果</span>
          <input type="color" data-card-panel-role="valueColor" value="${c.valueColor || c.textColor || '#0f172a'}">
        </label>
        <label class="chart-settings-field" style="flex:1">
          <span class="chart-settings-label">サブ表示</span>
          <input type="color" data-card-panel-role="subColor" value="${c.subColor || c.textColor || '#64748b'}">
        </label>
      </div>
      <button type="button" class="card-color-reset" data-card-panel-role="resetColors">既定色に戻す</button>
    </div>
  `;
}
