// ===== Chart UI events (split out of main.js) =====
import { emit } from '../../../app/events.js';
import { S, PALETTE, saveState } from '../../../app/state.js';
import { openChartSettings, closeChartSettings, renderChartSettingsPanel } from './chartSettings.js';
import { canEditCurrentTab } from '../../../app/auth.js';

function nextColor() {
  return PALETTE[S.CHARTS.length % PALETTE.length];
}

// ===== EVENT HANDLERS: CHARTS =====
// 新規作成時にメトリクスは未選択。ハードコード ('ad_cost' 等) は metric key が
// 任意命名のテナントで存在せず初期表示が空になる UX バグを起こすので避ける。
// ユーザーはチャートを追加した直後に設定パネルからメトリクスを選ぶ。
document.getElementById('add-main-chart').addEventListener('click', () => {
  // カスタムタブのグラフは TAB_STATES に保存される = editCustom が要る (CSS 頼みにしない)
  if (!canEditCurrentTab()) return;
  S.CHARTS.push({id: S.CHART_ID_SEQ++, metric: '', type: 'bar', size: 'main', color: nextColor(), bucket: 'auto', name: ''});
  emit('render');
});
document.getElementById('add-sub-chart').addEventListener('click', () => {
  if (!canEditCurrentTab()) return;
  S.CHARTS.push({id: S.CHART_ID_SEQ++, metric: '', type: 'line', size: 'sub', color: nextColor(), bucket: 'auto', name: ''});
  emit('render');
});
document.getElementById('add-mini-chart').addEventListener('click', () => {
  if (!canEditCurrentTab()) return;
  S.CHARTS.push({id: S.CHART_ID_SEQ++, metric: '', type: 'bar', size: 'mini', color: nextColor(), bucket: 'auto', name: ''});
  emit('render');
});

document.getElementById('charts-grid').addEventListener('click', e => {
  const card = e.target.closest('.chart-card');
  if (!card) return;
  if (!canEditCurrentTab()) return;
  const id = +card.dataset.id;
  const removeBtn = e.target.closest('[data-role="remove"]');
  if (removeBtn) {
    S.CHARTS = S.CHARTS.filter(c => c.id !== id);
    if (S.CHART_SETTINGS_ID === id) closeChartSettings();
    emit('render');
    return;
  }
  const settingsBtn = e.target.closest('[data-role="settings"]');
  if (settingsBtn) {
    openChartSettings(id);
    return;
  }
});

// 設定パネル: select/input 変更
const DEFAULT_LINE_COLORS = ['#ef4444', '#10b981', '#f59e0b', '#7c3aed', '#0ea5e9', '#ec4899', '#14b8a6', '#f97316'];
function ensureLines(chart) {
  if (!Array.isArray(chart.lines)) {
    chart.lines = [];
    if (chart.metric2) chart.lines.push({ metric: chart.metric2, color: chart.color2 || DEFAULT_LINE_COLORS[0] });
    if (chart.metric3) chart.lines.push({ metric: chart.metric3, color: chart.color3 || DEFAULT_LINE_COLORS[1] });
    if (chart.metric4) chart.lines.push({ metric: chart.metric4, color: chart.color4 || DEFAULT_LINE_COLORS[2] });
    // 旧フィールド掃除
    delete chart.metric2; delete chart.metric3; delete chart.metric4;
    delete chart.color2; delete chart.color3; delete chart.color4;
  }
  return chart.lines;
}
function onPanelChange(e) {
  const el = e.target;
  const role = el.dataset.panelRole;
  if (!role) return;
  const chart = S.CHARTS.find(c => c.id === S.CHART_SETTINGS_ID);
  if (!chart) return;
  if (role === 'name') {
    chart.name = el.value;
    const header = document.querySelector(`.chart-card[data-id="${chart.id}"] .chart-name-label`);
    if (header) header.textContent = el.value || (S.METRIC_DEFS.find(m => m.key === chart.metric)?.label || 'グラフ');
    saveState();
    return;
  }
  if (role === 'metric') chart.metric = el.value;
  if (role === 'bucket') chart.bucket = el.value;
  if (role === 'type') chart.type = el.value;
  if (role === 'color') chart.color = el.value;
  if (role === 'stackBy') chart.stackBy = el.value;
  if (role === 'showDots') chart.showDots = el.checked;
  if (role === 'dotSize') chart.dotSize = Number(el.value);
  if (role === 'lineWidth') chart.lineWidth = Number(el.value);
  if (role === 'smoothLine') chart.smoothLine = el.checked;
  if (role === 'showDataLabels') chart.showDataLabels = el.checked;
  if (role === 'line-metric') {
    const idx = Number(el.dataset.lineIdx);
    const lines = ensureLines(chart);
    if (lines[idx]) lines[idx].metric = el.value;
  }
  if (role === 'line-color') {
    const idx = Number(el.dataset.lineIdx);
    const lines = ensureLines(chart);
    if (lines[idx]) lines[idx].color = el.value;
  }
  emit('render');
}
function onPanelClick(e) {
  const btn = e.target.closest('[data-panel-role]');
  if (!btn) return;
  const role = btn.dataset.panelRole;
  const chart = S.CHARTS.find(c => c.id === S.CHART_SETTINGS_ID);
  if (!chart) return;
  if (role === 'line-add') {
    const lines = ensureLines(chart);
    const used = new Set(lines.map(l => l.metric));
    const next = S.METRIC_DEFS.find(m => !used.has(m.key));
    lines.push({ metric: next?.key || '', color: DEFAULT_LINE_COLORS[lines.length % DEFAULT_LINE_COLORS.length] });
    emit('render');
  }
  if (role === 'line-remove') {
    const idx = Number(btn.dataset.lineIdx);
    const lines = ensureLines(chart);
    lines.splice(idx, 1);
    emit('render');
  }
}
document.getElementById('chart-settings-body').addEventListener('change', onPanelChange);
document.getElementById('chart-settings-body').addEventListener('input', onPanelChange);
document.getElementById('chart-settings-body').addEventListener('click', onPanelClick);
// ピッカー閉じた瞬間に遅延 render を流す (ピッカー open 中に chart.js 側で skip された再 render を回収)。
document.addEventListener('dashboard-picker-closed', () => {
  if (S.CHART_SETTINGS_ID != null && S.CHARTS.some(c => c.id === S.CHART_SETTINGS_ID)) renderChartSettingsPanel();
});
document.getElementById('chart-settings-close').addEventListener('click', closeChartSettings);
document.getElementById('chart-settings-backdrop').addEventListener('click', closeChartSettings);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.CHART_SETTINGS_ID != null) closeChartSettings();
});

// ===== CHART DRAG REORDER =====
let DRAG_ID = null;
const chartsGrid = document.getElementById('charts-grid');
chartsGrid.addEventListener('dragstart', e => {
  const card = e.target.closest('.chart-card');
  if (!card) return;
  DRAG_ID = +card.dataset.id;
  card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', String(DRAG_ID)); } catch (_) {}
});
chartsGrid.addEventListener('dragend', () => {
  chartsGrid.querySelectorAll('.chart-card').forEach(c => {
    c.classList.remove('dragging');
    c.classList.remove('drop-target');
  });
  DRAG_ID = null;
});
chartsGrid.addEventListener('dragover', e => {
  if (DRAG_ID == null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const card = e.target.closest('.chart-card');
  chartsGrid.querySelectorAll('.chart-card').forEach(c => c.classList.remove('drop-target'));
  if (card && +card.dataset.id !== DRAG_ID) card.classList.add('drop-target');
});
chartsGrid.addEventListener('drop', e => {
  if (DRAG_ID == null) return;
  e.preventDefault();
  const card = e.target.closest('.chart-card');
  if (!card) return;
  const targetId = +card.dataset.id;
  if (targetId === DRAG_ID) return;
  const from = S.CHARTS.findIndex(c => c.id === DRAG_ID);
  const to = S.CHARTS.findIndex(c => c.id === targetId);
  if (from < 0 || to < 0) return;
  const [moved] = S.CHARTS.splice(from, 1);
  S.CHARTS.splice(to, 0, moved);
  DRAG_ID = null;
  emit('render');
});
