// ===== Dashboard - ES Module Entry Point =====
import { on, emit } from './events.js';
import { S, PALETTE, SIDEBAR_KEY, PANELS_KEY, GROUPS_KEY,
  initStateFromServer, saveState, saveColWidths, saveCustomTabs, saveViewOrder,
  syncCurrentTabState, getPresets, setPresets,
  switchSource, saveSheetsInput, loadSheetsInput,
  saveBqInput, loadBqInput,
  saveSourceMethod, loadSourceMethod,
  clearSourceRaw } from './state.js';
import { escapeHtml, hexToSoft } from './utils.js';
import { parseCSV } from './csv.js';
import { showModal } from './modal.js';
import { makeSortable } from './sortable.js';
import { applyFilters, renderFilters, populateFilters } from './filters.js';
import * as sheets from './sheets.js';
import * as bq from './bq.js';
import { api } from './api.js';
import { renderChart, openChartSettings, closeChartSettings, renderCards, openCardSettings, closeCardSettings, renderCardSettingsPanel } from './chart.js';
import { renderTable } from './table.js';
import { groupRows } from './dimensions.js';
import { dimLabel } from './dimensions.js';
import { getCurrentUser, hasPerm, renderCurrentUserLabel, applyPermissionUI, hideLogin, observeAuth, signIn, signInEmailPassword, resetPassword, logout } from './auth.js';
import { seedDefaultPresets, renderPresets, loadPresetIntoGlobals, renderTabPresetSelect,
  enterPresetEdit, exitPresetEdit, syncPresetEdit, deletePreset, savePresetPrompt,
  loadTabState, initTabStates, setExitSettingsMode as setExitSettingsModePresets } from './presets.js';
import { loadCustomTabs, renderCustomTabs, loadViewOrder, renderViewNav, applyView, highlightActiveView,
  setExitSettingsMode as setExitSettingsModeTabs } from './tabs.js';
import { setupSettingsEvents, exitSettingsMode, enterSettingsMode, renderCsvColumns } from './settings.js';
import { BRAND } from './config.js';

// ===== ブランドロゴ描画 (各社で assets/logo.png を差し替え) =====
// 画像が無い/読込失敗時は "LOGO" プレースホルダを表示 (設定漏れを視認しやすく)
(function renderBrand() {
  const alt = escapeHtml(BRAND.appName);
  const headerEl = document.getElementById('brand-logo');
  if (headerEl) {
    headerEl.innerHTML = `
      <img class="brand-logo-img" src="${BRAND.logoUrl}" alt="${alt}" onerror="this.outerHTML='<span class=&quot;brand-logo-fallback&quot;>LOGO</span>'">
      <span class="logo-text">Marketing Metrics<em>DASHBOARD</em></span>
    `;
  }
  const loginEl = document.getElementById('login-brand-logo');
  if (loginEl) {
    loginEl.innerHTML = `<img class="login-brand-logo-img" src="${BRAND.logoUrl}" alt="${alt}" onerror="this.outerHTML='<span class=&quot;login-brand-logo-fallback&quot;>LOGO</span>'">`;
  }
})();

// ===== Wire up circular dep breakers =====
setExitSettingsModePresets(exitSettingsMode);
setExitSettingsModeTabs(exitSettingsMode);

// ===== THRESHOLDS =====
function toDisplayThreshold(v, fmt) {
  if (v == null) return '';
  return fmt === 'pct' ? v * 100 : v;
}
function fromDisplayThreshold(v, fmtType) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!isFinite(n)) return null;
  return fmtType === 'pct' ? n / 100 : n;
}

function renderThresholds() {
  const el = document.getElementById('threshold-list');
  const head = document.getElementById('threshold-head');
  if (!S.THRESHOLD_METRICS.length) {
    head.classList.add('hidden');
    el.innerHTML = '<div class="threshold-empty">\u53f3\u4e0a\u306e\u300c+ \u6307\u6a19\u3092\u8ffd\u52a0\u300d\u304b\u3089\u6307\u6a19\u3092\u9078\u3093\u3067\u304f\u3060\u3055\u3044</div>';
  } else {
    head.classList.remove('hidden');
    el.innerHTML = S.THRESHOLD_METRICS.map(k => {
      const m = S.METRIC_DEFS.find(x => x.key === k);
      if (!m) return '';
      const t = S.THRESHOLDS[k] || {};
      const unit = m.fmt === 'yen' ? '\u00a5' : m.fmt === 'pct' ? '%' : '';
      const opMin = t.minOp || '<=';
      const opMax = t.maxOp || '<=';
      const opTarget = t.targetOp || '>=';
      const opSelect = (role, val) => `<select class="threshold-op" data-role="${role}Op">
        <option value="<"${val==='<'?' selected':''}>&lt; (\u672a\u6e80)</option>
        <option value="<="${val==='<='?' selected':''}>&le; (\u4ee5\u4e0b)</option>
        <option value=">"${val==='>'?' selected':''}>&gt; (\u8d85)</option>
        <option value=">="${val==='>='?' selected':''}>&ge; (\u4ee5\u4e0a)</option>
      </select>`;
      return `<div class="threshold-row" data-key="${k}">
        <div class="threshold-label">${m.label}${unit ? `<span class="unit">${unit}</span>` : ''}</div>
        ${opSelect('min', opMin)}
        <input type="number" step="any" data-role="min" placeholder="\u2014" value="${toDisplayThreshold(t.min, m.fmt)}">
        ${opSelect('max', opMax)}
        <input type="number" step="any" data-role="max" placeholder="\u2014" value="${toDisplayThreshold(t.max, m.fmt)}">
        ${opSelect('target', opTarget)}
        <input type="number" step="any" data-role="target" placeholder="\u2014" value="${toDisplayThreshold(t.target, m.fmt)}">
        <button type="button" class="threshold-remove" data-remove="${k}" aria-label="\u524a\u9664">\u00d7</button>
      </div>`;
    }).join('');
  }
  const menu = document.getElementById('threshold-add-menu');
  const avail = S.METRIC_DEFS.filter(m => !S.THRESHOLD_METRICS.includes(m.key));
  menu.innerHTML = avail.length
    ? avail.map(m => `<button type="button" class="add-menu-item" data-add="${m.key}">${m.label}</button>`).join('')
    : '<div class="add-menu-empty">\u8ffd\u52a0\u3067\u304d\u308b\u6307\u6a19\u306f\u3042\u308a\u307e\u305b\u3093</div>';
}

// ===== CHIPS & PILLS =====
function renderDimPills() {
  document.getElementById('dim-pills').innerHTML = S.SELECTED_DIMS.map(k => `
    <span class="pill" data-drag-key="${k}" draggable="true">${dimLabel(k)}<button type="button" class="pill-remove" data-remove="${k}">\u00d7</button></span>
  `).join('');
  const menu = document.getElementById('dim-add-menu');
  const avail = S.DIMENSIONS.filter(d => !S.SELECTED_DIMS.includes(d.key));
  menu.innerHTML = avail.length
    ? avail.map(d => `<button type="button" class="add-menu-item" data-add="${d.key}">${d.label}</button>`).join('')
    : '<div class="add-menu-empty">\u8ffd\u52a0\u3067\u304d\u308b\u9805\u76ee\u306f\u3042\u308a\u307e\u305b\u3093</div>';
}

function renderChips() {
  renderDimPills();
  const selectedSet = new Set(S.SELECTED_METRICS);
  const selectedDefs = S.SELECTED_METRICS.map(k => S.METRIC_DEFS.find(m => m.key === k)).filter(Boolean);
  const unselected = S.METRIC_DEFS.filter(m => !selectedSet.has(m.key));
  const ordered = [...selectedDefs, ...unselected];
  document.getElementById('metric-chips').innerHTML = ordered.map(m => {
    const active = selectedSet.has(m.key) ? ' active' : '';
    const dragAttr = active ? ` data-drag-key="${m.key}" draggable="true"` : '';
    return `<button type="button" class="chip${active}" data-metric="${m.key}"${dragAttr}>${m.label}</button>`;
  }).join('');
}

// ===== MAIN RENDER =====
function render() {
  let rows = applyFilters(S.RAW);
  if (S.CURRENT_FILTER) rows = rows.filter(S.CURRENT_FILTER);
  const dims = S.SELECTED_DIMS.length ? S.SELECTED_DIMS : ['action_date'];
  const groups = groupRows(rows, dims);
  renderCards(rows);
  renderChart(rows);
  renderTable(groups);
  const titleEl = document.getElementById('view-title');
  const crumbEl = document.getElementById('view-crumb');
  const headerEl = document.querySelector('.view-header');
  let title = '', crumb = '', accent = '#2563eb';
  if (S.PRESET_EDIT_IDX != null) {
    const p = getPresets()[S.PRESET_EDIT_IDX];
    title = p ? p.name : '\u30d7\u30ea\u30bb\u30c3\u30c8\u7de8\u96c6';
    crumb = '\u30d7\u30ea\u30bb\u30c3\u30c8\u7de8\u96c6\u30e2\u30fc\u30c9';
    accent = p?.color || '#7c3aed';
  } else if (S.VIEWS[S.CURRENT_VIEW]) {
    title = S.VIEWS[S.CURRENT_VIEW].label;
    crumb = '\u30c7\u30d5\u30a9\u30eb\u30c8';
    const preset = getPresets().find(p => p.builtin && p.name === title);
    accent = preset?.color || '#2563eb';
  } else {
    const tab = S.CUSTOM_TABS.find(t => t.key === S.CURRENT_VIEW);
    title = tab ? tab.label : '\u30ab\u30b9\u30bf\u30e0';
    crumb = '\u30ab\u30b9\u30bf\u30e0';
    accent = tab?.color || '#64748b';
  }
  titleEl.textContent = title;
  crumbEl.textContent = crumb;
  if (headerEl) {
    headerEl.style.setProperty('--tab-accent', accent);
    headerEl.style.setProperty('--tab-accent-soft', hexToSoft(accent));
  }
  document.getElementById('row-count').textContent = rows.length.toLocaleString();
  renderHeaderSourceIcon();
  saveState();
}

function renderHeaderSourceIcon() {
  const el = document.getElementById('header-source-icon');
  if (!el) return;
  const rows = S.SOURCE_DATA[S.CURRENT_SOURCE] || [];
  if (rows.length === 0) { el.innerHTML = ''; return; }
  const method = loadSourceMethod();
  const icons = {
    csv: {label: 'CSV', html: '\u{1F4C4}'},
    sheets: {label: 'Sheets', html: '<svg viewBox="0 0 48 48" width="14" height="14"><path fill="#43a047" d="M37 45H11c-1.7 0-3-1.3-3-3V6c0-1.7 1.3-3 3-3h19l10 10v29c0 1.7-1.3 3-3 3z"/><path fill="#c8e6c9" d="M40 13H30V3z"/><path fill="#e8f5e9" d="M31 23H17v14h14V23z"/></svg>'},
    bq: {label: 'BQ', html: '<svg viewBox="0 0 48 48" width="14" height="14"><circle cx="24" cy="22" r="16" fill="#4285f4"/><circle cx="25" cy="23" r="6" fill="none" stroke="#fff" stroke-width="2"/><path fill="#fff" d="M30 28l4 4-1.4 1.4-4-4z"/></svg>'},
  };
  const cfg = icons[method] || icons.csv;
  el.innerHTML = `<span class="src-icon" title="${cfg.label}">${cfg.html}</span>`;
}

// ===== STATE LOADING =====
function loadState() {
  // Now handled by loadSourceConfig in state.js
}

// ===== SIDEBAR HELPERS =====
function getCollapsedPanels() {
  try { return new Set(JSON.parse(localStorage.getItem(PANELS_KEY) || '[]')); }
  catch (e) { return new Set(); }
}
function setCollapsedPanels(set) {
  try { localStorage.setItem(PANELS_KEY, JSON.stringify([...set])); } catch (e) {}
}
function initPanelCollapse() {
  const collapsed = getCollapsedPanels();
  document.querySelectorAll('.panel.collapsible').forEach(p => {
    if (collapsed.has(p.dataset.panel)) p.classList.add('collapsed');
  });
}
function getSidebarGroupState() {
  try { return JSON.parse(localStorage.getItem(GROUPS_KEY) || '{}'); }
  catch (e) { return {}; }
}
function setSidebarGroupState(s) {
  try { localStorage.setItem(GROUPS_KEY, JSON.stringify(s)); } catch (e) {}
}
function applySidebarGroupState() {
  const s = getSidebarGroupState();
  document.querySelectorAll('.sidebar-group').forEach(g => {
    g.classList.toggle('collapsed', !!s.collapsed?.[g.dataset.group]);
  });
}
function initSidebar() {
  const saved = localStorage.getItem(SIDEBAR_KEY);
  const collapsed = saved === null ? true : saved === '1';
  document.body.classList.toggle('sidebar-collapsed', collapsed);
}

function nextColor() {
  return PALETTE[S.CHARTS.length % PALETTE.length];
}

// ===== Register event bus listeners =====
on('render', render);
on('renderChips', renderChips);
on('renderThresholds', renderThresholds);

// ===== INITIALIZATION =====
setupSettingsEvents();

// ===== EVENT HANDLERS: TABS & NAVIGATION =====
document.getElementById('view-nav').addEventListener('click', e => {
  const btn = e.target.closest('[data-view]');
  if (btn) applyView(btn.dataset.view);
});
document.getElementById('custom-nav').addEventListener('click', e => {
  const del = e.target.closest('[data-del-custom]');
  if (del) {
    const key = del.dataset.delCustom;
    const tab = S.CUSTOM_TABS.find(t => t.key === key);
    const tabName = tab ? tab.label : key;
    showModal({title: '\u30ab\u30b9\u30bf\u30e0\u30bf\u30d6\u3092\u524a\u9664', body: `\u300c${tabName}\u300d\u3092\u524a\u9664\u3057\u307e\u3059\u304b\uff1f\u3053\u306e\u64cd\u4f5c\u306f\u53d6\u308a\u6d88\u305b\u307e\u305b\u3093\u3002`, okText: '\u524a\u9664', danger: true}).then(ok => {
      if (!ok) return;
      S.CUSTOM_TABS = S.CUSTOM_TABS.filter(t => t.key !== key);
      delete S.TAB_STATES[key];
      saveCustomTabs();
      if (S.CURRENT_VIEW === key) applyView('summary_daily');
      else renderCustomTabs();
    });
    return;
  }
  const btn = e.target.closest('[data-custom]');
  if (btn) applyView(btn.dataset.custom);
});
document.getElementById('custom-nav').addEventListener('input', e => {
  const picker = e.target.closest('[data-color-key]');
  if (!picker) return;
  const tab = S.CUSTOM_TABS.find(t => t.key === picker.dataset.colorKey);
  if (!tab) return;
  tab.color = picker.value;
  saveCustomTabs();
  renderCustomTabs();
});
document.getElementById('add-custom-tab').addEventListener('click', async () => {
  const label = await showModal({title: '\u30ab\u30b9\u30bf\u30e0\u30bf\u30d6\u3092\u8ffd\u52a0', body: '\u30bf\u30d6\u306e\u540d\u524d\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044', input: true, placeholder: '\u4f8b: \u81ea\u5206\u7528\u306e\u5206\u6790', okText: '\u6b21\u3078'});
  if (!label) return;
  const ok = await showModal({title: '\u4f5c\u6210\u306e\u78ba\u8a8d', body: `\u30ab\u30b9\u30bf\u30e0\u30bf\u30d6\u300c${label}\u300d\u3092\u4f5c\u6210\u3057\u307e\u3059\u304b\uff1f`, okText: '\u4f5c\u6210'});
  if (!ok) return;
  const key = 'custom_' + Date.now();
  const color = '#64748b';
  S.CUSTOM_TABS.push({key, label, color});
  S.TAB_STATES[key] = {
    dims: ['action_date'],
    metrics: S.METRIC_DEFS.map(m => m.key),
    thresholds: {},
    thresholdMetrics: [],
  };
  saveCustomTabs();
  applyView(key);
});

// ===== EVENT HANDLERS: DIMS & METRICS =====
document.getElementById('dim-pills').addEventListener('click', e => {
  const btn = e.target.closest('[data-remove]');
  if (!btn) return;
  const k = btn.dataset.remove;
  S.SELECTED_DIMS = S.SELECTED_DIMS.filter(x => x !== k);
  renderDimPills();
  render();
});
document.getElementById('dim-add-btn').addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('dim-add-menu').classList.toggle('hidden');
});
document.getElementById('dim-add-menu').addEventListener('click', e => {
  const btn = e.target.closest('[data-add]');
  if (!btn) return;
  S.SELECTED_DIMS = [...S.SELECTED_DIMS, btn.dataset.add];
  document.getElementById('dim-add-menu').classList.add('hidden');
  renderDimPills();
  render();
});
document.addEventListener('click', e => {
  if (!e.target.closest('.pivot-add')) {
    document.getElementById('dim-add-menu').classList.add('hidden');
  }
});
document.getElementById('metric-chips').addEventListener('click', e => {
  const btn = e.target.closest('[data-metric]');
  if (!btn) return;
  const k = btn.dataset.metric;
  if (S.SELECTED_METRICS.includes(k)) S.SELECTED_METRICS = S.SELECTED_METRICS.filter(x => x !== k);
  else S.SELECTED_METRICS = [...S.SELECTED_METRICS, k];
  btn.classList.toggle('active');
  render();
});
document.getElementById('metric-all').addEventListener('click', () => {
  S.SELECTED_METRICS = S.METRIC_DEFS.map(m => m.key);
  renderChips();
  render();
});
document.getElementById('metric-none').addEventListener('click', () => {
  S.SELECTED_METRICS = [];
  renderChips();
  render();
});

// ===== EVENT HANDLERS: CHARTS =====
document.getElementById('add-main-chart').addEventListener('click', () => {
  S.CHARTS.push({id: S.CHART_ID_SEQ++, metric: 'ad_cost', type: 'bar', size: 'main', color: nextColor(), bucket: 'auto', name: ''});
  render();
});
document.getElementById('add-sub-chart').addEventListener('click', () => {
  S.CHARTS.push({id: S.CHART_ID_SEQ++, metric: 'clicks', type: 'line', size: 'sub', color: nextColor(), bucket: 'auto', name: ''});
  render();
});
document.getElementById('add-mini-chart').addEventListener('click', () => {
  S.CHARTS.push({id: S.CHART_ID_SEQ++, metric: 'mcv', type: 'bar', size: 'mini', color: nextColor(), bucket: 'auto', name: ''});
  render();
});

// ===== KPI CARDS =====
document.getElementById('add-card').addEventListener('click', () => {
  const firstMetric = S.METRIC_DEFS[0]?.key || '';
  S.CARDS.push({ id: S.CARD_ID_SEQ++, metric: firstMetric, label: '', subMetric: '', subLabel: '' });
  render();
});
document.getElementById('cards-grid').addEventListener('click', e => {
  const card = e.target.closest('[data-card-id]');
  if (!card) return;
  const id = +card.dataset.cardId;
  if (e.target.closest('[data-card-role="remove"]')) {
    S.CARDS = S.CARDS.filter(c => c.id !== id);
    if (S.CARD_SETTINGS_ID === id) closeCardSettings();
    render();
    return;
  }
  if (e.target.closest('[data-card-role="settings"]')) {
    openCardSettings(id);
  }
});
// インライン名前変更
document.getElementById('cards-grid').addEventListener('input', e => {
  const role = e.target.dataset.cardRole;
  if (role !== 'label') return;
  const card = e.target.closest('[data-card-id]');
  const c = S.CARDS.find(x => x.id === +card.dataset.cardId);
  if (!c) return;
  c.label = e.target.value;
  // ライブ再描画は重いので、フォーカス保持のため再描画はスキップ。値は state にのみ保存。
  saveState();
});
function onCardPanelChange(e) {
  const role = e.target.dataset.cardPanelRole;
  if (!role) return;
  const c = S.CARDS.find(x => x.id === S.CARD_SETTINGS_ID);
  if (!c) return;
  c[role] = e.target.value;
  render();
}
document.getElementById('card-settings-body').addEventListener('input', onCardPanelChange);
document.getElementById('card-settings-body').addEventListener('change', onCardPanelChange);
document.getElementById('card-settings-body').addEventListener('click', e => {
  const btn = e.target.closest('[data-card-panel-role="resetColors"]');
  if (!btn) return;
  const c = S.CARDS.find(x => x.id === S.CARD_SETTINGS_ID);
  if (!c) return;
  delete c.bgColor;
  delete c.textColor;
  delete c.labelColor;
  delete c.valueColor;
  delete c.subColor;
  render();
});
document.getElementById('card-settings-close').addEventListener('click', closeCardSettings);
document.getElementById('card-settings-backdrop').addEventListener('click', closeCardSettings);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.CARD_SETTINGS_ID != null) closeCardSettings();
});
document.getElementById('charts-grid').addEventListener('click', e => {
  const card = e.target.closest('.chart-card');
  if (!card) return;
  const id = +card.dataset.id;
  const removeBtn = e.target.closest('[data-role="remove"]');
  if (removeBtn) {
    S.CHARTS = S.CHARTS.filter(c => c.id !== id);
    if (S.CHART_SETTINGS_ID === id) closeChartSettings();
    render();
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
  render();
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
    render();
  }
  if (role === 'line-remove') {
    const idx = Number(btn.dataset.lineIdx);
    const lines = ensureLines(chart);
    lines.splice(idx, 1);
    render();
  }
}
document.getElementById('chart-settings-body').addEventListener('change', onPanelChange);
document.getElementById('chart-settings-body').addEventListener('input', onPanelChange);
document.getElementById('chart-settings-body').addEventListener('click', onPanelClick);
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
  render();
});

// ===== CARD DRAG REORDER =====
let CARD_DRAG_ID = null;
const cardsGrid = document.getElementById('cards-grid');
cardsGrid.addEventListener('dragstart', e => {
  if (e.target.closest('input, textarea, button')) { e.preventDefault(); return; }
  const card = e.target.closest('.kpi-card');
  if (!card) return;
  CARD_DRAG_ID = +card.dataset.cardId;
  card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', String(CARD_DRAG_ID)); } catch (_) {}
});
cardsGrid.addEventListener('dragend', () => {
  cardsGrid.querySelectorAll('.kpi-card').forEach(c => {
    c.classList.remove('dragging');
    c.classList.remove('drop-target');
  });
  CARD_DRAG_ID = null;
});
cardsGrid.addEventListener('dragover', e => {
  if (CARD_DRAG_ID == null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const card = e.target.closest('.kpi-card');
  cardsGrid.querySelectorAll('.kpi-card').forEach(c => c.classList.remove('drop-target'));
  if (card && +card.dataset.cardId !== CARD_DRAG_ID) card.classList.add('drop-target');
});
cardsGrid.addEventListener('drop', e => {
  if (CARD_DRAG_ID == null) return;
  e.preventDefault();
  const card = e.target.closest('.kpi-card');
  if (!card) return;
  const targetId = +card.dataset.cardId;
  if (targetId === CARD_DRAG_ID) return;
  const from = S.CARDS.findIndex(c => c.id === CARD_DRAG_ID);
  const to = S.CARDS.findIndex(c => c.id === targetId);
  if (from < 0 || to < 0) return;
  const [moved] = S.CARDS.splice(from, 1);
  S.CARDS.splice(to, 0, moved);
  CARD_DRAG_ID = null;
  render();
});

// ===== CSV DOWNLOAD =====
document.addEventListener('click', e => {
  const btn = e.target.closest('#csv-download-btn');
  if (!btn) return;
  const table = document.getElementById('data-table');
  if (!table) return;
  const rows = [];
  table.querySelectorAll('tr').forEach(tr => {
    const cells = [];
    tr.querySelectorAll('th, td').forEach(cell => {
      // 展開/折りたたみボタンやリサイズハンドルを除外
      const clone = cell.cloneNode(true);
      clone.querySelectorAll('button, .col-resizer, .toggle-btn').forEach(el => el.remove());
      let text = clone.textContent.trim();
      if (text.includes(',') || text.includes('"') || text.includes('\n')) {
        text = '"' + text.replace(/"/g, '""') + '"';
      }
      cells.push(text);
    });
    rows.push(cells.join(','));
  });
  const csv = '\uFEFF' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const ds = S.DATA_SOURCES.find(d => d.id === S.CURRENT_SOURCE);
  a.download = `${ds?.name || 'data'}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// ===== TABLE COLUMN RESIZE =====
let resizingCol = null;
document.getElementById('data-table').addEventListener('mousedown', e => {
  const handle = e.target.closest('.col-resizer');
  if (!handle) return;
  e.preventDefault();
  e.stopPropagation();
  const th = handle.closest('th');
  resizingCol = {th, startX: e.clientX, startWidth: th.offsetWidth};
  document.body.classList.add('col-resizing');
});
document.addEventListener('mousemove', e => {
  if (!resizingCol) return;
  const delta = e.clientX - resizingCol.startX;
  const w = Math.max(40, resizingCol.startWidth + delta);
  resizingCol.th.style.width = w + 'px';
  resizingCol.th.style.minWidth = w + 'px';
});
document.addEventListener('mouseup', () => {
  if (!resizingCol) return;
  resizingCol = null;
  document.body.classList.remove('col-resizing');
});

// ===== CHART TOOLTIPS =====
function hideAllChartTooltips() {
  document.querySelectorAll('.chart-tooltip, .chart-guide').forEach(t => t.classList.add('hidden'));
}
chartsGrid.addEventListener('mousemove', e => {
  const body = e.target.closest('[data-chart-body]');
  if (!body) { hideAllChartTooltips(); return; }
  const id = +body.dataset.chartBody;
  const info = S.CHART_POINTS.get(id);
  if (!info || !info.points.length) return;
  const rect = body.getBoundingClientRect();
  const localX = (e.clientX - rect.left) / rect.width * info.W;
  let nearest = info.points[0], minD = Infinity;
  for (const p of info.points) {
    const d = Math.abs(p.cx - localX);
    if (d < minD) { minD = d; nearest = p; }
  }
  const guide = document.querySelector(`[data-guide="${id}"]`);
  const tooltip = document.querySelector(`[data-tooltip="${id}"]`);
  const wrap = body.parentElement;
  const wrapRect = wrap.getBoundingClientRect();
  const bodyOffset = rect.left - wrapRect.left;
  const xPx = bodyOffset + (nearest.cx / info.W) * rect.width;
  const topPx = (info.PT / info.H) * rect.height;
  const bottomPx = ((info.PT + info.ih) / info.H) * rect.height;
  guide.classList.remove('hidden');
  guide.style.left = xPx + 'px';
  guide.style.top = topPx + 'px';
  guide.style.height = (bottomPx - topPx) + 'px';
  tooltip.classList.remove('hidden');
  tooltip.innerHTML = `<div class="tt-x">${escapeHtml(String(nearest.x ?? ''))}</div><div class="tt-m">${escapeHtml(String(nearest.metric ?? ''))}</div><div class="tt-y">${escapeHtml(String(nearest.label ?? ''))}</div>`;
  const ttW = tooltip.offsetWidth;
  let leftPos = xPx - ttW / 2;
  const maxLeft = wrapRect.width - ttW - 4;
  if (leftPos < 4) leftPos = 4;
  if (leftPos > maxLeft) leftPos = maxLeft;
  tooltip.style.left = leftPos + 'px';
  tooltip.style.top = Math.max(4, topPx - 8) + 'px';
});
chartsGrid.addEventListener('mouseleave', hideAllChartTooltips);

// ===== RESIZE =====
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const rows = applyFilters(S.RAW).filter(r => !S.CURRENT_FILTER || S.CURRENT_FILTER(r));
    renderChart(rows);
  }, 120);
});

// ===== FILTERS, PANELS, FILE =====
document.addEventListener('click', () => {
  document.querySelectorAll('.ms-menu').forEach(m => m.classList.add('hidden'));
});
document.querySelectorAll('.panel.collapsible .collapse-btn').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const panel = btn.closest('.panel');
    panel.classList.toggle('collapsed');
    const set = getCollapsedPanels();
    if (panel.classList.contains('collapsed')) set.add(panel.dataset.panel);
    else { set.delete(panel.dataset.panel); setTimeout(render, 0); }
    setCollapsedPanels(set);
  });
});

// ===== DATA SOURCES =====
function reloadFullUI() {
  exitSettingsMode();
  const main = document.querySelector('.main');
  if (main) { main.classList.remove('source-transition'); void main.offsetWidth; main.classList.add('source-transition'); }
  renderFilters();
  populateFilters();
  loadViewOrder();
  renderViewNav();
  loadCustomTabs();
  initTabStates();
  loadTabState(S.CURRENT_VIEW);
  highlightActiveView();
  renderCustomTabs();
  renderChips();
  renderThresholds();
  renderPresets();
  renderTabPresetSelect();
  renderCsvColumns();
  renderSourceNav();
  loadSnapshotIfNeeded();
  render();
}

function renderSourceNav() {
  // ヘッダードロップダウン内のソース一覧を描画
  const list = document.getElementById('source-nav');
  if (list) {
    list.innerHTML = S.DATA_SOURCES.map(ds => {
      const active = S.CURRENT_SOURCE === ds.id ? ' active' : '';
      const count = (S.SOURCE_DATA[ds.id] || []).length;
      const countLabel = count > 0 ? `${count.toLocaleString()}行` : '未取得';
      // ドロップダウンは「切替」のみに徹する。編集・削除は設定画面(source-view)で行う。
      return `<div class="source-dropdown-row${active}" data-source="${ds.id}">
        <span class="source-nav-item-label">${escapeHtml(ds.name)}</span>
        <span class="source-count">${countLabel}</span>
      </div>`;
    }).join('');
  }
  // ドロップダウンのボタンラベルも更新
  const labelEl = document.getElementById('source-dropdown-label');
  if (labelEl) {
    const current = S.DATA_SOURCES.find(d => d.id === S.CURRENT_SOURCE);
    labelEl.textContent = current ? current.name : 'データソース';
  }
}

// ドロップダウンの開閉
function toggleSourceDropdown(force) {
  const menu = document.getElementById('source-dropdown-menu');
  if (!menu) return;
  const willShow = force !== undefined ? force : menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !willShow);
}
document.getElementById('source-dropdown-btn')?.addEventListener('click', e => {
  e.stopPropagation();
  toggleSourceDropdown();
});
// 外側クリックで閉じる
document.addEventListener('click', e => {
  const menu = document.getElementById('source-dropdown-menu');
  if (!menu || menu.classList.contains('hidden')) return;
  if (!e.target.closest('#source-dropdown')) toggleSourceDropdown(false);
});
// Escキーで閉じる
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') toggleSourceDropdown(false);
});
// 「⚙ 現在のソースの設定」ボタン
document.getElementById('open-source-settings')?.addEventListener('click', () => {
  toggleSourceDropdown(false);
  enterSourceView();
});

// アクセス権はグループ管理側に統合済み

// 現在のソースの名前変更 (source-view 内のボタン)
document.getElementById('source-rename-btn')?.addEventListener('click', async () => {
  const ds = S.DATA_SOURCES.find(d => d.id === S.CURRENT_SOURCE);
  if (!ds) return;
  const newName = await showModal({title: '名前を変更', body: `「${ds.name}」の新しい名前を入力してください`, input: true, defaultValue: ds.name, okText: '次へ'});
  if (!newName || newName === ds.name) return;
  const ok = await showModal({title: '名前変更の確認', body: `「${ds.name}」を「${newName}」に変更しますか？`, okText: '変更'});
  if (!ok) return;
  try {
    await api.updateSource(ds.id, { name: newName });
    ds.name = newName;
    document.getElementById('source-view-title').textContent = newName;
    renderSourceNav();
  } catch (err) {
    showModal({title: '名前変更に失敗', body: err.message || '名前変更に失敗しました', okText: 'OK', cancelText: ''});
  }
});

// 現在のソースの削除
document.getElementById('source-delete-btn')?.addEventListener('click', async () => {
  const ds = S.DATA_SOURCES.find(d => d.id === S.CURRENT_SOURCE);
  if (!ds) return;
  if (S.DATA_SOURCES.length <= 1) {
    await showModal({title: '削除できません', body: 'データソースは最低1つ必要です', okText: 'OK', cancelText: ''});
    return;
  }
  const ok = await showModal({
    title: 'データソースを削除',
    body: `「${ds.name}」を削除しますか？\nこのデータソースの全ての設定・プリセット・スナップショットが削除されます。`,
    okText: '削除',
    danger: true,
  });
  if (!ok) return;
  const typed = await showModal({
    title: '本当に削除しますか？',
    body: `「${ds.name}」の削除は取り消せません。確認のため「削除」と入力してください。`,
    input: true,
    placeholder: '削除',
    okText: '削除する',
    danger: true,
    noEnter: true,
  });
  if (typed !== '削除') return;
  try {
    await api.deleteSource(ds.id);
    S.DATA_SOURCES = S.DATA_SOURCES.filter(d => d.id !== ds.id);
    delete S.SOURCE_DATA[ds.id];
    clearSourceRaw(ds.id);
    await switchSource(S.DATA_SOURCES[0].id);
    exitSettingsMode();
    reloadFullUI();
  } catch (err) {
    showModal({title: '削除に失敗', body: err.message || '削除に失敗しました', okText: 'OK', cancelText: ''});
  }
});

document.getElementById('source-nav').addEventListener('click', e => {
  const del = e.target.closest('[data-del-source]');
  if (del) {
    const id = del.dataset.delSource;
    if (S.DATA_SOURCES.length <= 1) {
      showModal({title: '\u524a\u9664\u3067\u304d\u307e\u305b\u3093', body: '\u30c7\u30fc\u30bf\u30bd\u30fc\u30b9\u306f\u6700\u4f4e1\u3064\u5fc5\u8981\u3067\u3059', okText: 'OK', cancelText: ''});
      return;
    }
    const dsName = S.DATA_SOURCES.find(d=>d.id===id)?.name||id;
    showModal({title: '\u30c7\u30fc\u30bf\u30bd\u30fc\u30b9\u3092\u524a\u9664', body: `\u300c${dsName}\u300d\u3092\u524a\u9664\u3057\u307e\u3059\u304b\uff1f\n\u3053\u306e\u30c7\u30fc\u30bf\u30bd\u30fc\u30b9\u306e\u5168\u3066\u306e\u8a2d\u5b9a\u30fb\u30d7\u30ea\u30bb\u30c3\u30c8\u304c\u524a\u9664\u3055\u308c\u307e\u3059\u3002`, okText: '\u524a\u9664', danger: true}).then(async ok => {
      if (!ok) return;
      const typed = await showModal({title: '\u672c\u5f53\u306b\u524a\u9664\u3057\u307e\u3059\u304b\uff1f', body: `\u300c${dsName}\u300d\u306e\u524a\u9664\u306f\u53d6\u308a\u6d88\u305b\u307e\u305b\u3093\u3002\u78ba\u8a8d\u306e\u305f\u3081\u300c\u524a\u9664\u300d\u3068\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044\u3002`, input: true, placeholder: '\u524a\u9664', okText: '\u524a\u9664\u3059\u308b', danger: true, noEnter: true});
      if (typed !== '\u524a\u9664') return;
      try {
        await api.deleteSource(id);
        S.DATA_SOURCES = S.DATA_SOURCES.filter(d => d.id !== id);
        delete S.SOURCE_DATA[id];
        clearSourceRaw(id);
        if (S.CURRENT_SOURCE === id) {
          await switchSource(S.DATA_SOURCES[0].id);
        }
        reloadFullUI();
      } catch (err) {
        showModal({title: '\u524a\u9664\u306b\u5931\u6557', body: err.message || '削除に失敗しました', okText: 'OK', cancelText: ''});
      }
    });
    return;
  }
  const rename = e.target.closest('[data-rename-source]');
  if (rename) {
    const id = rename.dataset.renameSource;
    const ds = S.DATA_SOURCES.find(d => d.id === id);
    if (!ds) return;
    (async () => {
      const newName = await showModal({title: '\u540d\u524d\u3092\u5909\u66f4', body: `\u300c${ds.name}\u300d\u306e\u65b0\u3057\u3044\u540d\u524d\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044`, input: true, defaultValue: ds.name, okText: '\u6b21\u3078'});
      if (!newName || newName === ds.name) return;
      const ok = await showModal({title: '\u540d\u524d\u5909\u66f4\u306e\u78ba\u8a8d', body: `\u300c${ds.name}\u300d\u3092\u300c${newName}\u300d\u306b\u5909\u66f4\u3057\u307e\u3059\u304b\uff1f`, okText: '\u5909\u66f4'});
      if (!ok) return;
      try {
        await api.updateSource(id, { name: newName });
        ds.name = newName;
        renderSourceNav();
      } catch (err) {
        showModal({title: '\u540d\u524d\u5909\u66f4\u306b\u5931\u6557', body: err.message || '名前変更に失敗しました', okText: 'OK', cancelText: ''});
      }
    })();
    return;
  }
  const btn = e.target.closest('[data-source]');
  if (btn) {
    // 編集・削除アイコンのクリックは上で処理済み。ここに来るのはラベル本体クリック時のみ。
    const id = btn.dataset.source;
    (async () => {
      if (S.CURRENT_SOURCE !== id) {
        await switchSource(id);
        reloadFullUI();
      }
      // ドロップダウンを閉じてダッシュボードに戻る（設定画面は開かない）
      toggleSourceDropdown(false);
      exitSettingsMode();
    })();
  }
});

// ===== SOURCE VIEW =====
function enterSourceView() {
  exitSettingsMode();
  document.body.classList.add('settings-mode');
  document.getElementById('source-view').classList.remove('hidden');
  document.querySelectorAll('#view-nav .nav-item, #custom-nav .nav-item').forEach(b => b.classList.remove('active'));
  renderSourceView();
  renderSourceNav();
  // Load snapshot data (cached daily batch or on-demand refresh)
  loadSnapshotIfNeeded();
}

function formatRelativeTime(iso) {
  if (!iso) return 'まだ更新されていません';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'たった今';
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  const d = Math.floor(hr / 24);
  return `${d}日前`;
}

function renderSnapshotMeta(method, meta) {
  const el = document.getElementById(method === 'sheets' ? 'sheets-snapshot-meta' : 'bq-snapshot-meta');
  if (!el) return;
  if (!meta?.exists) {
    el.textContent = 'まだスナップショットがありません。「今すぐ更新」を押して取得してください。';
    return;
  }
  const when = formatRelativeTime(meta.updatedAt);
  el.textContent = `最終更新: ${when}  (${(meta.rows || 0).toLocaleString()}行)`;
}

async function loadSnapshotIfNeeded() {
  const sid = S.CURRENT_SOURCE;
  if (!sid) return;
  await sheets.refreshConnectionState();
  const currentRows = S.SOURCE_DATA[sid] || [];
  const ds = S.DATA_SOURCES.find(d => d.id === sid);
  const method = ds?.method || '';

  try {
    const meta = await api.getSnapshotMeta(sid);
    renderSnapshotMeta(method, meta);
    if (!meta.exists) return;
    if (currentRows.length > 0) return; // already loaded
    const rowCountEl = document.getElementById('row-count');
    if (rowCountEl) rowCountEl.textContent = '読み込み中...';
    document.querySelector('.meta')?.classList.add('meta-loading');
    const data = await api.getSnapshot(sid);
    S.SOURCE_DATA[sid] = data.rows || [];
    S.RAW = S.SOURCE_DATA[sid];
    populateFilters();
    renderSourceView();
    renderSourceNav();
    renderCsvColumns();
    render();
  } catch (e) {
    console.warn('Snapshot load failed:', e.message);
  } finally {
    document.querySelector('.meta')?.classList.remove('meta-loading');
  }
}

// このデータソースのメソッド + 入力をクリアする。
// Google OAuth（ユーザー単位）には影響しない。
async function disconnectCurrentSource() {
  const sid = S.CURRENT_SOURCE;
  if (!sid) return;
  try {
    await api.disconnectSource(sid);
    const ds = S.DATA_SOURCES.find(d => d.id === sid);
    if (ds) {
      ds.method = '';
      delete ds.sheetsInput;
      delete ds.bqInput;
    }
    S.SOURCE_METHOD = '';
    S.SHEETS_INPUT = { url: '', tab: '' };
    S.BQ_INPUT = { project: '', query: '' };
    document.querySelectorAll('.source-method-card').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.method-detail-panel').forEach(p => p.classList.add('hidden'));
    renderSourceView();
    renderSourceNav();
  } catch (e) {
    await showModal({title: '解除失敗', body: e.message || '連携解除に失敗しました', okText: 'OK', cancelText: ''});
  }
}

async function refreshSnapshotNow(method) {
  const sid = S.CURRENT_SOURCE;
  if (!sid) return;
  const fetchBtn = document.getElementById(method === 'sheets' ? 'sheets-fetch-btn' : 'bq-fetch-btn');
  const metaEl = document.getElementById(method === 'sheets' ? 'sheets-snapshot-meta' : 'bq-snapshot-meta');
  const origLabel = fetchBtn ? fetchBtn.textContent : '';
  if (fetchBtn) { fetchBtn.textContent = '更新中...'; fetchBtn.disabled = true; }
  if (metaEl) { metaEl.textContent = 'データを取得しています（大量データの場合は数分かかります）...'; metaEl.classList.add('updating'); }
  try {
    await api.refreshSnapshot(sid);
    S.SOURCE_DATA[sid] = []; // invalidate cache
    await loadSnapshotIfNeeded();
    if (metaEl) metaEl.classList.add('update-success');
    await showModal({title: '更新完了', body: 'スナップショットを更新しました。', okText: 'OK', cancelText: ''});
  } catch (e) {
    const msg = e.message || '更新に失敗しました';
    if (/再度連携|not connected/i.test(msg)) {
      await sheets.refreshConnectionState();
      renderSourceView();
      await showModal({title: 'Google連携の期限切れ', body: 'Google連携の有効期限が切れました。「Googleアカウント連携」ボタンから再度連携してください。', okText: 'OK', cancelText: ''});
    } else {
      await showModal({title: '更新失敗', body: msg, okText: 'OK', cancelText: ''});
    }
  } finally {
    if (fetchBtn) { fetchBtn.textContent = origLabel; fetchBtn.disabled = false; }
    if (metaEl) { metaEl.classList.remove('updating'); setTimeout(() => metaEl.classList.remove('update-success'), 2000); }
  }
}

// (Live Sheets/BQ auto-refresh removed — data comes from daily snapshot now)

function renderSourceView() {
  const ds = S.DATA_SOURCES.find(d => d.id === S.CURRENT_SOURCE);
  const name = ds ? ds.name : S.CURRENT_SOURCE;
  document.getElementById('source-view-title').textContent = name;

  // メソッドカードのアクティブ表示と詳細パネルを現在の source.method に合わせる
  const currentMethod = ds?.method || '';
  document.querySelectorAll('.source-method-card').forEach(c => {
    c.classList.toggle('active', !!currentMethod && c.dataset.method === currentMethod);
    // 未連携ソースでは全カードをクリック可、連携済みでは同じメソッドカード以外を薄く表示
    if (currentMethod && c.dataset.method !== currentMethod) {
      c.classList.add('locked');
    } else {
      c.classList.remove('locked');
    }
  });
  document.querySelectorAll('.method-detail-panel').forEach(p => p.classList.add('hidden'));
  if (currentMethod) {
    document.getElementById('detail-' + currentMethod)?.classList.remove('hidden');
  }

  // アクセス権はグループ管理側に統合済み

  const rows = S.SOURCE_DATA[S.CURRENT_SOURCE] || [];
  const info = document.getElementById('source-info');
  if (rows.length === 0) {
    info.innerHTML = '<div class="source-info-empty"><div class="source-info-icon">\u{1F4C1}</div><div class="source-info-text">\u30C7\u30FC\u30BF\u304C\u8AAD\u307F\u8FBC\u307E\u308C\u3066\u3044\u307E\u305B\u3093</div><div class="source-info-hint">\u4E0A\u306E\u300CCSV\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u300D\u307E\u305F\u306F\u300CGoogle\u30B9\u30D7\u30EC\u30C3\u30C9\u30B7\u30FC\u30C8\u300D\u304B\u3089\u30C7\u30FC\u30BF\u3092\u53D6\u5F97\u3057\u3066\u304F\u3060\u3055\u3044</div></div>';
  } else {
    const cols = Object.keys(rows[0]);
    info.innerHTML = `<div class="source-info-grid">
      <div class="source-info-card"><div class="source-info-label">\u884C\u6570</div><div class="source-info-value">${rows.length.toLocaleString()}</div></div>
      <div class="source-info-card"><div class="source-info-label">\u30AB\u30E9\u30E0\u6570</div><div class="source-info-value">${cols.length}</div></div>
    </div>`;
  }

  // CSV columns
  const colEl = document.getElementById('source-csv-columns');
  const countEl = document.getElementById('source-csv-column-count');
  if (rows.length === 0) {
    colEl.innerHTML = '<div class="preset-empty">CSV\u304C\u8AAD\u307F\u8FBC\u307E\u308C\u3066\u3044\u307E\u305B\u3093</div>';
    if (countEl) countEl.textContent = '';
  } else {
    const columns = Object.keys(rows[0]);
    if (countEl) countEl.textContent = `${columns.length}\u30AB\u30E9\u30E0`;
    colEl.innerHTML = columns.map(col => {
      const vals = [];
      const seen = new Set();
      for (const r of rows) {
        const v = r[col];
        if (v == null || v === '' || seen.has(v)) continue;
        seen.add(v);
        vals.push(v);
        if (vals.length >= 5) break;
      }
      const isNumeric = vals.slice(0, 10).every(v => !isNaN(Number(v)) && v !== '');
      const kind = isNumeric ? '\u6570\u5024' : '\u6587\u5B57\u5217';
      return `<div class="csv-col-row">
        <div class="csv-col-head">
          <code class="csv-col-name">${escapeHtml(col)}</code>
          <span class="csv-col-kind">${kind}</span>
        </div>
        <div class="csv-col-sample">\u4F8B: ${vals.length ? vals.map(v => `<span>${escapeHtml(String(v).slice(0, 30))}</span>`).join(' / ') : ''}</div>
      </div>`;
    }).join('');
  }

  // Preview
  const previewEl = document.getElementById('source-preview');
  if (rows.length === 0) {
    previewEl.innerHTML = '<div class="preset-empty">\u30C7\u30FC\u30BF\u306A\u3057</div>';
  } else {
    const cols = Object.keys(rows[0]);
    const previewRows = rows.slice(0, 20);
    previewEl.innerHTML = `<div class="source-preview-wrap"><table class="source-preview-table">
      <thead><tr>${cols.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
      <tbody>${previewRows.map(r => `<tr>${cols.map(c => `<td>${escapeHtml(String(r[c] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  }

  // Sheets UI state
  const sheetsConnect = document.getElementById('sheets-connect');
  const sheetsForm = document.getElementById('sheets-form');
  const sheetsNoclient = document.getElementById('sheets-noclient');
  if (sheets.isConfigured()) {
    sheetsNoclient.classList.add('hidden');
    if (sheets.isAuthenticated()) {
      sheetsConnect.classList.add('hidden');
      sheetsForm.classList.remove('hidden');
      document.getElementById('sheets-status').innerHTML = '<span class="api-status-ok" style="font-size:11px">\u2713 Google\u30a2\u30ab\u30a6\u30f3\u30c8\u9023\u643a\u6e08\u307f</span>';
      const savedInput = loadSheetsInput();
      document.getElementById('sheets-url-input').value = savedInput.url || '';
      document.getElementById('sheets-tab-input').value = savedInput.tab || '';
    } else {
      sheetsConnect.classList.remove('hidden');
      sheetsForm.classList.add('hidden');
    }
  } else {
    sheetsConnect.classList.add('hidden');
    sheetsForm.classList.add('hidden');
    sheetsNoclient.classList.remove('hidden');
  }

  // BQ UI state
  const bqConnect = document.getElementById('bq-connect');
  const bqForm = document.getElementById('bq-form');
  const bqNoclient = document.getElementById('bq-noclient');
  if (bq.isConfigured()) {
    bqNoclient.classList.add('hidden');
    if (bq.isAuthenticated()) {
      bqConnect.classList.add('hidden');
      bqForm.classList.remove('hidden');
      document.getElementById('bq-status').innerHTML = '<span class="api-status-ok" style="font-size:11px">\u2713 Google\u30a2\u30ab\u30a6\u30f3\u30c8\u9023\u643a\u6e08\u307f</span>';
      const savedBq = loadBqInput();
      document.getElementById('bq-project-input').value = savedBq.project || '';
      document.getElementById('bq-query-input').value = savedBq.query || '';
    } else {
      bqConnect.classList.remove('hidden');
      bqForm.classList.add('hidden');
    }
  } else {
    bqConnect.classList.add('hidden');
    bqForm.classList.add('hidden');
    bqNoclient.classList.remove('hidden');
  }
}

// Save input on change
['sheets-url-input', 'sheets-tab-input'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', () => {
    const url = document.getElementById('sheets-url-input').value;
    const tab = document.getElementById('sheets-tab-input').value;
    saveSheetsInput(url, tab);
  });
});
['bq-project-input', 'bq-query-input'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', () => {
    const project = document.getElementById('bq-project-input').value;
    const query = document.getElementById('bq-query-input').value;
    saveBqInput(project, query);
  });
});

// Confirm overwrite when data already loaded from another method
async function confirmOverwriteData(newMethod) {
  const existing = S.SOURCE_DATA[S.CURRENT_SOURCE] || [];
  if (existing.length === 0) return true;
  const methodLabel = { csv: 'CSV', sheets: 'Google\u30b9\u30d7\u30ec\u30c3\u30c9\u30b7\u30fc\u30c8', bq: 'BigQuery' }[newMethod] || newMethod;
  const ok1 = await showModal({
    title: '\u30c7\u30fc\u30bf\u3092\u4e0a\u66f8\u304d\u3057\u307e\u3059\u304b\uff1f',
    body: `\u73fe\u5728\u306e\u30c7\u30fc\u30bf\u30bd\u30fc\u30b9\u306b\u306f\u65e2\u306b${existing.length.toLocaleString()}\u884c\u306e\u30c7\u30fc\u30bf\u304c\u5165\u3063\u3066\u3044\u307e\u3059\u3002${methodLabel}\u3067\u4e0a\u66f8\u304d\u3057\u307e\u3059\u304b\uff1f`,
    okText: '\u6b21\u3078', danger: true,
  });
  if (!ok1) return false;
  const ok2 = await showModal({
    title: '\u6700\u7d42\u78ba\u8a8d',
    body: `\u73fe\u5728\u306e\u30c7\u30fc\u30bf\u306f\u5931\u308f\u308c\u307e\u3059\u3002${methodLabel}\u3067\u4e0a\u66f8\u304d\u3057\u307e\u3059\u304b\uff1f`,
    okText: '\u4e0a\u66f8\u304d', danger: true,
  });
  return !!ok2;
}

// Source file upload
document.getElementById('source-file').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  if (!(await confirmOverwriteData('csv'))) { e.target.value = ''; return; }
  const text = await f.text();
  const rows = parseCSV(text);
  S.SOURCE_DATA[S.CURRENT_SOURCE] = rows;
  S.RAW = rows;
  saveSourceMethod('csv');
  populateFilters();
  renderSourceView();
  renderSourceNav();
  renderCsvColumns();
});

// ----- METHOD CARD SELECTION -----
// 排他制御: 既に連携済みのソースで別メソッドに切り替えたい場合は、
// 先に「連携を解除」する必要がある。
document.querySelectorAll('.source-method-card').forEach(card => {
  card.addEventListener('click', async e => {
    if (card.classList.contains('disabled')) return;
    if (e.target.closest('input,button,label.file-btn')) return;

    const targetMethod = card.dataset.method;
    const ds = S.DATA_SOURCES.find(d => d.id === S.CURRENT_SOURCE);
    const currentMethod = ds?.method || '';

    // 既に別メソッドに連携済みなら切替をブロック
    if (currentMethod && currentMethod !== targetMethod) {
      const labels = { csv: 'CSVアップロード', sheets: 'Google スプレッドシート', bq: 'BigQuery' };
      await showModal({
        title: '連携を変更できません',
        body: `このデータソースは既に「${labels[currentMethod] || currentMethod}」に連携されています。別の方法に切り替えるには、まず現在の連携を解除してください。`,
        okText: 'OK',
        cancelText: '',
      });
      return;
    }

    document.querySelectorAll('.source-method-card').forEach(c => c.classList.toggle('active', c === card));
    document.querySelectorAll('.method-detail-panel').forEach(p => p.classList.add('hidden'));
    const panel = document.getElementById('detail-' + targetMethod);
    if (panel) panel.classList.remove('hidden');
  });
});

// ----- SHEETS: AUTH -----
document.getElementById('sheets-auth-btn').addEventListener('click', async () => {
  try {
    await sheets.authenticate();
    renderSourceView();
    await showModal({title: '連携完了', body: 'Googleアカウントの連携が完了しました。', okText: 'OK', cancelText: ''});
  } catch (e) {
    await showModal({title: '認証エラー', body: e.message, okText: 'OK', cancelText: ''});
  }
});

// ----- SHEETS: 今すぐ更新 (save config + refresh snapshot) -----
document.getElementById('sheets-fetch-btn').addEventListener('click', async () => {
  const urlOrId = document.getElementById('sheets-url-input').value.trim();
  const fileId = sheets.extractSpreadsheetId(urlOrId);
  const tab = document.getElementById('sheets-tab-input').value.trim();
  if (!fileId) { await showModal({title: 'エラー', body: 'スプレッドシートのURLまたはIDが正しくありません', okText: 'OK', cancelText: ''}); return; }
  if (!tab) { await showModal({title: 'エラー', body: 'タブ名を入力してください', okText: 'OK', cancelText: ''}); return; }
  // Persist inputs on the source doc so the batch job can read them
  await saveSheetsInput(urlOrId, tab);
  await saveSourceMethod('sheets');
  await refreshSnapshotNow('sheets');
});

// ----- SHEETS: このソースの連携を解除 (method + inputs クリア) -----
document.getElementById('sheets-disconnect').addEventListener('click', async () => {
  const ok = await showModal({
    title: 'このデータソースの連携を解除',
    body: 'このデータソースのスプレッドシート連携を解除します。スナップショットは残りますが、以後「今すぐ更新」はできなくなります。別の方法（CSV / BigQuery）に切り替えたい場合はこの操作を実行してください。',
    okText: '解除',
    danger: true,
  });
  if (!ok) return;
  await disconnectCurrentSource();
});

// ----- BQ: AUTH -----
document.getElementById('bq-auth-btn').addEventListener('click', async () => {
  try {
    await bq.authenticate();
    renderSourceView();
    await showModal({title: '連携完了', body: 'Googleアカウントの連携が完了しました。', okText: 'OK', cancelText: ''});
  } catch (e) {
    await showModal({title: '認証エラー', body: e.message, okText: 'OK', cancelText: ''});
  }
});

// ----- BQ: 今すぐ更新 (save config + refresh snapshot) -----
document.getElementById('bq-fetch-btn').addEventListener('click', async () => {
  const project = document.getElementById('bq-project-input').value.trim();
  const query = document.getElementById('bq-query-input').value.trim();
  if (!project) { await showModal({title: 'エラー', body: 'プロジェクトIDを入力してください', okText: 'OK', cancelText: ''}); return; }
  if (!query) { await showModal({title: 'エラー', body: 'SQLクエリを入力してください', okText: 'OK', cancelText: ''}); return; }
  await saveBqInput(project, query);
  await saveSourceMethod('bq');
  await refreshSnapshotNow('bq');
});

// ----- BQ: このソースの連携を解除 (method + inputs クリア) -----
document.getElementById('bq-disconnect').addEventListener('click', async () => {
  const ok = await showModal({
    title: 'このデータソースの連携を解除',
    body: 'このデータソースのBigQuery連携を解除します。スナップショットは残りますが、以後「今すぐ更新」はできなくなります。別の方法（CSV / スプレッドシート）に切り替えたい場合はこの操作を実行してください。',
    okText: '解除',
    danger: true,
  });
  if (!ok) return;
  await disconnectCurrentSource();
});

document.getElementById('add-source').addEventListener('click', async () => {
  const name = await showModal({title: 'データソースを追加', body: 'データソースの名前を入力してください', input: true, placeholder: '例: CRMデータ', okText: '次へ'});
  if (!name) return;
  // コピー元選択
  const copyOpts = S.DATA_SOURCES.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
  const copyHtml = `<p>設定をコピーするデータソースを選択してください。</p>
    <select id="copy-source-select" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:inherit;margin-top:8px;">
      <option value="">白紙で作成（設定なし）</option>
      ${copyOpts}
    </select>`;
  const copyConfirm = await showModal({title: `「${name}」を作成`, html: true, body: copyHtml, okText: '作成'});
  if (!copyConfirm) return;
  const copyFromId = document.getElementById('copy-source-select')?.value || '';
  try {
    const created = await api.createSource({ name });
    S.DATA_SOURCES.push(created);
    S.SOURCE_DATA[created.id] = [];
    if (copyFromId) {
      // 既存ソースの設定とプリセットをコピー
      const [srcConfig, srcPresets] = await Promise.all([
        api.getConfig(copyFromId),
        api.listPresets(copyFromId),
      ]);
      await api.putConfig(created.id, srcConfig);
      if (srcPresets.presets?.length) {
        await api.putPresets(created.id, srcPresets.presets.map(p => {
          const { id, ...rest } = p;
          return rest;
        }));
      }
    } else {
      // 白紙の設定を保存
      await api.putConfig(created.id, {
        metricDefs: [],
        dimensions: [],
        filterDefs: [],
        views: {},
        formulas: {},
        baseFormulas: {},
        defaults: {},
        presets: [],
      });
    }
    await switchSource(created.id);
    reloadFullUI();
  } catch (e) {
    await showModal({title: '作成に失敗', body: e.message || 'データソースの作成に失敗しました', okText: 'OK', cancelText: ''});
  }
});

// ===== FILTERS TOGGLE =====
document.getElementById('filters-toggle').addEventListener('click', () => {
  document.getElementById('filters-bar').classList.toggle('collapsed');
});

document.getElementById('filters').addEventListener('change', e => {
  const input = e.target.closest('input[type=date][data-filter-id]');
  if (!input) return;
  S.FILTER_VALUES[input.dataset.filterId] = input.value;
  render();
});

// ===== THRESHOLDS EVENT HANDLERS =====
document.getElementById('threshold-list').addEventListener('input', e => {
  const row = e.target.closest('.threshold-row');
  if (!row) return;
  const key = row.dataset.key;
  const role = e.target.dataset.role;
  if (!role) return;
  if (!S.THRESHOLDS[key]) S.THRESHOLDS[key] = {};
  if (role.endsWith('Op')) {
    S.THRESHOLDS[key][role] = e.target.value;
  } else {
    const mdef = S.METRIC_DEFS.find(m => m.key === key);
    if (!mdef) return;
    const raw = fromDisplayThreshold(e.target.value, mdef.fmt);
    if (raw == null) delete S.THRESHOLDS[key][role];
    else S.THRESHOLDS[key][role] = raw;
  }
  render();
});
document.getElementById('threshold-list').addEventListener('change', e => {
  const row = e.target.closest('.threshold-row');
  if (!row) return;
  const key = row.dataset.key;
  const role = e.target.dataset.role;
  if (!role || !role.endsWith('Op')) return;
  if (!S.THRESHOLDS[key]) S.THRESHOLDS[key] = {};
  S.THRESHOLDS[key][role] = e.target.value;
  render();
});
document.getElementById('threshold-list').addEventListener('click', e => {
  const btn = e.target.closest('[data-remove]');
  if (!btn) return;
  const key = btn.dataset.remove;
  S.THRESHOLD_METRICS = S.THRESHOLD_METRICS.filter(k => k !== key);
  delete S.THRESHOLDS[key];
  renderThresholds();
  render();
});
document.getElementById('threshold-add-btn').addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('threshold-add-menu').classList.toggle('hidden');
});
document.getElementById('threshold-add-menu').addEventListener('click', e => {
  const btn = e.target.closest('[data-add]');
  if (!btn) return;
  const key = btn.dataset.add;
  if (!S.THRESHOLD_METRICS.includes(key)) S.THRESHOLD_METRICS.push(key);
  document.getElementById('threshold-add-menu').classList.add('hidden');
  renderThresholds();
  render();
});
document.addEventListener('click', e => {
  if (!e.target.closest('#threshold-add-btn') && !e.target.closest('#threshold-add-menu')) {
    document.getElementById('threshold-add-menu').classList.add('hidden');
  }
});
document.getElementById('threshold-clear').addEventListener('click', () => {
  S.THRESHOLDS = {};
  S.THRESHOLD_METRICS = [];
  renderThresholds();
  render();
});

// ===== PRESETS EVENT HANDLERS =====
document.getElementById('save-preset').addEventListener('click', savePresetPrompt);
document.getElementById('preset-save-btn').addEventListener('click', async () => {
  if (S.PRESET_EDIT_IDX == null) return;
  const list = getPresets();
  const p = list[S.PRESET_EDIT_IDX];
  if (!p) return;
  const ok = await showModal({title: '\u30d7\u30ea\u30bb\u30c3\u30c8\u3092\u4fdd\u5b58', body: `\u300c${p.name}\u300d\u306b\u73fe\u5728\u306e\u7de8\u96c6\u5185\u5bb9\u3092\u4fdd\u5b58\u3057\u307e\u3059\u304b\uff1f`, okText: '\u4fdd\u5b58'});
  if (!ok) return;
  syncPresetEdit();
  renderPresets();
  renderTabPresetSelect();
  await showModal({title: '\u4fdd\u5b58\u5b8c\u4e86', body: `\u300c${p.name}\u300d\u3092\u4fdd\u5b58\u3057\u307e\u3057\u305f`, okText: 'OK', cancelText: ''});
});
document.getElementById('preset-exit-btn').addEventListener('click', async () => {
  if (S.PRESET_EDIT_IDX == null) return;
  const ok = await showModal({title: '\u7de8\u96c6\u3092\u7d42\u4e86', body: '\u4fdd\u5b58\u3057\u3066\u3044\u306a\u3044\u5909\u66f4\u306f\u7834\u68c4\u3055\u308c\u307e\u3059\u3002\u7d42\u4e86\u3057\u307e\u3059\u304b\uff1f', okText: '\u7d42\u4e86', danger: true});
  if (!ok) return;
  applyView(S.CUSTOM_TABS[0]?.key || 'summary_daily');
});
document.getElementById('preset-list').addEventListener('click', e => {
  const del = e.target.closest('.preset-del');
  if (del) { deletePreset(+del.dataset.idx); return; }
  const name = e.target.closest('.preset-name');
  if (name) {
    const idx = +name.closest('.preset-item').dataset.idx;
    enterPresetEdit(idx);
  }
});

document.getElementById('tab-preset').addEventListener('change', async e => {
  const v = e.target.value;
  const sel = e.target;
  const prev = sel.dataset.prev || '';
  if (v === '') { sel.dataset.prev = ''; return; }
  const idx = +v;
  const tab = S.CUSTOM_TABS.find(t => t.key === S.CURRENT_VIEW);
  if (!tab) { sel.value = prev; return; }
  const list = getPresets();
  if (!list[idx]) { sel.value = prev; return; }
  const ok = await showModal({
    title: '\u30d7\u30ea\u30bb\u30c3\u30c8\u3092\u9069\u7528',
    body: `\u300c${list[idx].name}\u300d\u3092\u3053\u306e\u30bf\u30d6\u306b\u9069\u7528\u3057\u307e\u3059\u304b\uff1f\u73fe\u5728\u306e\u7de8\u96c6\u5185\u5bb9\u306f\u4e0a\u66f8\u304d\u3055\u308c\u307e\u3059\u3002`,
    okText: '\u9069\u7528',
    danger: true,
  });
  if (!ok) { sel.value = prev; return; }
  tab.presetName = list[idx].name;
  saveCustomTabs();
  loadPresetIntoGlobals(list[idx]);
  syncCurrentTabState();
  renderChips();
  renderThresholds();
  render();
  sel.dataset.prev = v;
});

// ===== SIDEBAR GROUPS =====
document.querySelectorAll('.sidebar-group .group-title').forEach(title => {
  title.addEventListener('click', () => {
    const group = title.closest('.sidebar-group');
    group.classList.toggle('collapsed');
    const s = getSidebarGroupState();
    s.collapsed = s.collapsed || {};
    s.collapsed[group.dataset.group] = group.classList.contains('collapsed');
    setSidebarGroupState(s);
  });
});

// ===== SORTABLE WIRING =====
makeSortable(document.getElementById('view-nav'), (from, to, before) => {
  const fromIdx = S.VIEW_ORDER.indexOf(from);
  if (fromIdx < 0) return;
  const [moved] = S.VIEW_ORDER.splice(fromIdx, 1);
  let toIdx = S.VIEW_ORDER.indexOf(to);
  if (!before) toIdx += 1;
  S.VIEW_ORDER.splice(toIdx, 0, moved);
  saveViewOrder();
  renderViewNav();
});
makeSortable(document.getElementById('custom-nav'), (from, to, before) => {
  const fromIdx = S.CUSTOM_TABS.findIndex(t => t.key === from);
  if (fromIdx < 0) return;
  const [moved] = S.CUSTOM_TABS.splice(fromIdx, 1);
  let toIdx = S.CUSTOM_TABS.findIndex(t => t.key === to);
  if (!before) toIdx += 1;
  S.CUSTOM_TABS.splice(toIdx, 0, moved);
  saveCustomTabs();
  renderCustomTabs();
});
makeSortable(document.getElementById('dim-pills'), (from, to, before) => {
  const fromIdx = S.SELECTED_DIMS.indexOf(from);
  if (fromIdx < 0) return;
  const [moved] = S.SELECTED_DIMS.splice(fromIdx, 1);
  let toIdx = S.SELECTED_DIMS.indexOf(to);
  if (toIdx < 0) toIdx = S.SELECTED_DIMS.length;
  if (!before) toIdx += 1;
  S.SELECTED_DIMS.splice(toIdx, 0, moved);
  syncCurrentTabState();
  renderDimPills();
  render();
});
makeSortable(document.getElementById('metric-chips'), (from, to, before) => {
  const fromIdx = S.SELECTED_METRICS.indexOf(from);
  if (fromIdx < 0) return;
  const [moved] = S.SELECTED_METRICS.splice(fromIdx, 1);
  let toIdx = S.SELECTED_METRICS.indexOf(to);
  if (toIdx < 0) toIdx = S.SELECTED_METRICS.length;
  if (!before) toIdx += 1;
  S.SELECTED_METRICS.splice(toIdx, 0, moved);
  syncCurrentTabState();
  renderChips();
  render();
});
makeSortable(document.getElementById('preset-list'), (from, to, before) => {
  const list = getPresets();
  const fromIdx = list.findIndex(p => p.name === from);
  if (fromIdx < 0) return;
  const [moved] = list.splice(fromIdx, 1);
  let toIdx = list.findIndex(p => p.name === to);
  if (!before) toIdx += 1;
  list.splice(toIdx, 0, moved);
  setPresets(list);
  renderPresets();
});

// ===== PRESET COLOR PICKER =====
document.getElementById('preset-color-picker').addEventListener('input', e => {
  if (S.PRESET_EDIT_IDX == null) return;
  const list = getPresets();
  const p = list[S.PRESET_EDIT_IDX];
  if (!p) return;
  p.color = e.target.value;
  renderPresets();
  renderViewNav();
});

// ===== SIDEBAR TOGGLE =====
document.getElementById('toggle-sidebar').addEventListener('click', () => {
  const collapsed = document.body.classList.toggle('sidebar-collapsed');
  localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
  setTimeout(render, 230);
});

// ===== INITIALIZATION SEQUENCE =====
// UI-only init runs immediately (doesn't need user data).
initSidebar();
initPanelCollapse();
applySidebarGroupState();

// Wire login/logout buttons
document.getElementById('login-google-btn')?.addEventListener('click', () => signIn());
document.getElementById('login-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const id = document.getElementById('login-id').value.trim();
  const pw = document.getElementById('login-pw').value;
  if (!id || !pw) return;
  signInEmailPassword(id, pw);
});
document.getElementById('login-forgot-btn')?.addEventListener('click', async () => {
  const email = await showModal({
    title: 'パスワードリセット',
    body: '登録済みのメールアドレスを入力してください。リセット用メールをお送りします。',
    input: true,
    defaultValue: document.getElementById('login-id').value.trim(),
    placeholder: 'user@example.com',
    okText: '送信',
  });
  if (!email) return;
  const ok = await resetPassword(email);
  if (ok) {
    await showModal({title: '送信しました', body: `${email} にリセット用メールを送りました。届かない場合は迷惑メールフォルダも確認してください。`, okText: 'OK', cancelText: ''});
  }
});
document.getElementById('header-logout')?.addEventListener('click', () => logout());

// After user signs in, load data from backend and render.
observeAuth({
  onReady: async () => {
    await initStateFromServer();
    // Hydrate Google connection state from backend (shared by sheets+bq)
    await sheets.refreshConnectionState();
    renderFilters();
    renderCurrentUserLabel();
    applyPermissionUI();
    hideLogin();

    renderSourceNav();
    loadViewOrder();
    renderViewNav();
    loadCustomTabs();
    loadState();
    seedDefaultPresets();
    initTabStates();
    loadTabState(S.CURRENT_VIEW);
    highlightActiveView();
    renderCustomTabs();
    renderChips();
    renderThresholds();
    renderPresets();
    renderTabPresetSelect();
    render();
    // Auto-refresh Sheets/BQ data on startup if configured
    setTimeout(() => { loadSnapshotIfNeeded(); }, 300);
  },
  onLoggedOut: () => {
    // Clear everything; user sees login overlay
    S.RAW = [];
    S.SOURCE_DATA = {};
  },
});
