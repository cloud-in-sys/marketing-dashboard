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
import { renderChart } from './chart.js';
import { renderTable } from './table.js';
import { groupRows } from './dimensions.js';
import { dimLabel } from './dimensions.js';
import { getCurrentUser, hasPerm, renderCurrentUserLabel, applyPermissionUI, hideLogin, observeAuth, signIn, logout } from './auth.js';
import { seedDefaultPresets, renderPresets, loadPresetIntoGlobals, renderTabPresetSelect,
  enterPresetEdit, exitPresetEdit, syncPresetEdit, deletePreset, savePresetPrompt,
  loadTabState, initTabStates, setExitSettingsMode as setExitSettingsModePresets } from './presets.js';
import { loadCustomTabs, renderCustomTabs, loadViewOrder, renderViewNav, applyView, highlightActiveView,
  setExitSettingsMode as setExitSettingsModeTabs } from './tabs.js';
import { setupSettingsEvents, exitSettingsMode, enterSettingsMode, renderCsvColumns } from './settings.js';

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
document.getElementById('charts-grid').addEventListener('change', e => {
  const card = e.target.closest('.chart-card');
  if (!card) return;
  const id = +card.dataset.id;
  const chart = S.CHARTS.find(c => c.id === id);
  if (!chart) return;
  const role = e.target.dataset.role;
  if (role === 'metric') chart.metric = e.target.value;
  if (role === 'type') chart.type = e.target.value;
  if (role === 'bucket') chart.bucket = e.target.value;
  if (role === 'color') chart.color = e.target.value;
  if (role === 'name') { chart.name = e.target.value; saveState(); return; }
  render();
});
document.getElementById('charts-grid').addEventListener('input', e => {
  const card = e.target.closest('.chart-card');
  if (!card) return;
  const chart = S.CHARTS.find(c => c.id === +card.dataset.id);
  if (!chart) return;
  const role = e.target.dataset.role;
  if (role === 'color') { chart.color = e.target.value; render(); }
  else if (role === 'name') { chart.name = e.target.value; saveState(); }
});
document.getElementById('charts-grid').addEventListener('click', e => {
  const btn = e.target.closest('[data-role="remove"]');
  if (!btn) return;
  const id = +btn.closest('.chart-card').dataset.id;
  S.CHARTS = S.CHARTS.filter(c => c.id !== id);
  render();
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
  tooltip.innerHTML = `<div class="tt-x">${nearest.x}</div><div class="tt-m">${nearest.metric}</div><div class="tt-y">${nearest.label}</div>`;
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
  render();
}

function renderSourceNav() {
  const el = document.getElementById('source-nav');
  if (!el) return;
  el.innerHTML = S.DATA_SOURCES.map(ds => {
    const active = S.CURRENT_SOURCE === ds.id ? ' active' : '';
    const count = (S.SOURCE_DATA[ds.id] || []).length;
    const badge = count > 0 ? `<span class="source-count">${count.toLocaleString()}\u884c</span>` : '<span class="source-count source-empty">\u672a\u8aad\u307f\u8fbc\u307f</span>';
    return `<div class="source-item">
      <button type="button" class="nav-item${active}" data-source="${ds.id}">
        <span class="source-name">${escapeHtml(ds.name)}</span>${badge}
      </button>
      <button type="button" class="source-rename" data-rename-source="${ds.id}" title="\u540d\u524d\u3092\u5909\u66f4">\u270e</button>
      <button type="button" class="preset-del source-del" data-del-source="${ds.id}" title="\u524a\u9664">\u00d7</button>
    </div>`;
  }).join('');
}

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
    const id = btn.dataset.source;
    if (S.CURRENT_SOURCE !== id) {
      switchSource(id);
      reloadFullUI();
    }
    enterSourceView();
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
  // Auto-refresh sheets/bq data if configured
  autoRefreshSheetsIfNeeded();
  autoRefreshBqIfNeeded();
}

async function autoRefreshBqIfNeeded() {
  if (!bq.isAuthenticated()) return;
  const saved = loadBqInput();
  if (!saved.project || !saved.query) return;
  const currentRows = S.SOURCE_DATA[S.CURRENT_SOURCE] || [];
  if (currentRows.length > 0) return;
  const rowCountEl = document.getElementById('row-count');
  try {
    const status = document.getElementById('bq-status');
    if (status) status.innerHTML = '<span class="api-status-ok" style="font-size:11px">\u2b6f \u30af\u30a8\u30ea\u5b9f\u884c\u4e2d...</span>';
    if (rowCountEl) rowCountEl.textContent = '\u5b9f\u884c\u4e2d...';
    document.querySelector('.meta')?.classList.add('meta-loading');
    const rows = await bq.runQuery(saved.project, saved.query);
    S.SOURCE_DATA[S.CURRENT_SOURCE] = rows;
    S.RAW = rows;
    saveSourceMethod('bq');
    populateFilters();
    renderSourceView();
    renderSourceNav();
    renderCsvColumns();
    render();
  } catch (e) {
    console.warn('BQ auto-refresh failed:', e.message);
    if (rowCountEl) rowCountEl.textContent = '0';
    renderSourceView();
  } finally {
    document.querySelector('.meta')?.classList.remove('meta-loading');
  }
}

async function autoRefreshSheetsIfNeeded() {
  if (!sheets.isAuthenticated()) return;
  const saved = loadSheetsInput();
  if (!saved.url || !saved.tab) return;
  // Already has fresh data? Skip
  const currentRows = S.SOURCE_DATA[S.CURRENT_SOURCE] || [];
  if (currentRows.length > 0) return;
  const fileId = sheets.extractSpreadsheetId(saved.url);
  if (!fileId) return;
  const rowCountEl = document.getElementById('row-count');
  try {
    const status = document.getElementById('sheets-status');
    if (status) status.innerHTML = '<span class="api-status-ok" style="font-size:11px">\u2b6f \u30c7\u30fc\u30bf\u3092\u53d6\u5f97\u4e2d...</span>';
    if (rowCountEl) rowCountEl.textContent = '\u8aad\u307f\u8fbc\u307f\u4e2d...';
    document.querySelector('.meta')?.classList.add('meta-loading');
    const rows = await sheets.fetchSheetData(fileId, saved.tab);
    S.SOURCE_DATA[S.CURRENT_SOURCE] = rows;
    S.RAW = rows;
    saveSourceMethod('sheets');
    populateFilters();
    renderSourceView();
    renderSourceNav();
    renderCsvColumns();
    render();
  } catch (e) {
    console.warn('Auto-refresh failed:', e.message);
    if (rowCountEl) rowCountEl.textContent = '0';
    renderSourceView();
  } finally {
    document.querySelector('.meta')?.classList.remove('meta-loading');
  }
}

function renderSourceView() {
  const ds = S.DATA_SOURCES.find(d => d.id === S.CURRENT_SOURCE);
  const name = ds ? ds.name : S.CURRENT_SOURCE;
  document.getElementById('source-view-title').textContent = name;

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
document.querySelectorAll('.source-method-card').forEach(card => {
  card.addEventListener('click', e => {
    if (card.classList.contains('disabled')) return;
    if (e.target.closest('input,button,label.file-btn')) return;
    const method = card.dataset.method;
    document.querySelectorAll('.source-method-card').forEach(c => c.classList.toggle('active', c === card));
    document.querySelectorAll('.method-detail-panel').forEach(p => p.classList.add('hidden'));
    const panel = document.getElementById('detail-' + method);
    if (panel) panel.classList.remove('hidden');
  });
});

// ----- SHEETS: AUTH -----
document.getElementById('sheets-auth-btn').addEventListener('click', async () => {
  try {
    await sheets.authenticate();
    renderSourceView();
  } catch (e) {
    await showModal({title: '\u8a8d\u8a3c\u30a8\u30e9\u30fc', body: e.message, okText: 'OK', cancelText: ''});
  }
});

// ----- SHEETS: fetch data -----
document.getElementById('sheets-fetch-btn').addEventListener('click', async () => {
  const urlOrId = document.getElementById('sheets-url-input').value.trim();
  const fileId = sheets.extractSpreadsheetId(urlOrId);
  const sheet = document.getElementById('sheets-tab-input').value.trim();
  if (!fileId) { await showModal({title: '\u30a8\u30e9\u30fc', body: '\u30b9\u30d7\u30ec\u30c3\u30c9\u30b7\u30fc\u30c8\u306eURL\u307e\u305f\u306fID\u304c\u6b63\u3057\u304f\u3042\u308a\u307e\u305b\u3093', okText: 'OK', cancelText: ''}); return; }
  if (!sheet) { await showModal({title: '\u30a8\u30e9\u30fc', body: '\u30bf\u30d6\u540d\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044', okText: 'OK', cancelText: ''}); return; }
  if (!(await confirmOverwriteData('sheets'))) return;
  try {
    const rows = await sheets.fetchSheetData(fileId, sheet);
    S.SOURCE_DATA[S.CURRENT_SOURCE] = rows;
    S.RAW = rows;
    saveSourceMethod('sheets');
    populateFilters();
    renderSourceView();
    renderSourceNav();
    renderCsvColumns();
    await showModal({title: '\u53d6\u5f97\u5b8c\u4e86', body: `${rows.length.toLocaleString()}\u884c\u306e\u30c7\u30fc\u30bf\u3092\u8aad\u307f\u8fbc\u307f\u307e\u3057\u305f`, okText: 'OK', cancelText: ''});
  } catch (e) {
    await showModal({title: '\u53d6\u5f97\u30a8\u30e9\u30fc', body: e.message, okText: 'OK', cancelText: ''});
  }
});

// ----- SHEETS: disconnect -----
document.getElementById('sheets-disconnect').addEventListener('click', async () => {
  const ok = await showModal({title: '\u9023\u643a\u89e3\u9664', body: 'Google\u30a2\u30ab\u30a6\u30f3\u30c8\u306e\u9023\u643a\u3092\u89e3\u9664\u3057\u307e\u3059\u304b\uff1f', okText: '\u89e3\u9664', danger: true});
  if (!ok) return;
  sheets.disconnect();
  renderSourceView();
});

// ----- BQ: AUTH -----
document.getElementById('bq-auth-btn').addEventListener('click', async () => {
  try {
    await bq.authenticate();
    renderSourceView();
  } catch (e) {
    await showModal({title: '\u8a8d\u8a3c\u30a8\u30e9\u30fc', body: e.message, okText: 'OK', cancelText: ''});
  }
});

// ----- BQ: RUN QUERY -----
document.getElementById('bq-fetch-btn').addEventListener('click', async () => {
  const project = document.getElementById('bq-project-input').value.trim();
  const query = document.getElementById('bq-query-input').value.trim();
  if (!project) { await showModal({title: '\u30a8\u30e9\u30fc', body: '\u30d7\u30ed\u30b8\u30a7\u30af\u30c8ID\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044', okText: 'OK', cancelText: ''}); return; }
  if (!query) { await showModal({title: '\u30a8\u30e9\u30fc', body: 'SQL\u30af\u30a8\u30ea\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044', okText: 'OK', cancelText: ''}); return; }
  if (!(await confirmOverwriteData('bq'))) return;
  const rowCountEl = document.getElementById('row-count');
  try {
    if (rowCountEl) rowCountEl.textContent = '\u5b9f\u884c\u4e2d...';
    document.querySelector('.meta')?.classList.add('meta-loading');
    const rows = await bq.runQuery(project, query);
    S.SOURCE_DATA[S.CURRENT_SOURCE] = rows;
    S.RAW = rows;
    saveSourceMethod('bq');
    populateFilters();
    renderSourceView();
    renderSourceNav();
    renderCsvColumns();
    render();
    await showModal({title: '\u53d6\u5f97\u5b8c\u4e86', body: `${rows.length.toLocaleString()}\u884c\u306e\u30c7\u30fc\u30bf\u3092\u53d6\u5f97\u3057\u307e\u3057\u305f`, okText: 'OK', cancelText: ''});
  } catch (e) {
    await showModal({title: '\u30af\u30a8\u30ea\u30a8\u30e9\u30fc', body: e.message, okText: 'OK', cancelText: ''});
  } finally {
    document.querySelector('.meta')?.classList.remove('meta-loading');
  }
});

// ----- BQ: DISCONNECT -----
document.getElementById('bq-disconnect').addEventListener('click', async () => {
  const ok = await showModal({title: '\u9023\u643a\u89e3\u9664', body: 'Google\u30a2\u30ab\u30a6\u30f3\u30c8\u306e\u9023\u643a\u3092\u89e3\u9664\u3057\u307e\u3059\u304b\uff1f', okText: '\u89e3\u9664', danger: true});
  if (!ok) return;
  bq.disconnect();
  renderSourceView();
});

document.getElementById('add-source').addEventListener('click', async () => {
  const name = await showModal({title: '\u30c7\u30fc\u30bf\u30bd\u30fc\u30b9\u3092\u8ffd\u52a0', body: '\u30c7\u30fc\u30bf\u30bd\u30fc\u30b9\u306e\u540d\u524d\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044', input: true, placeholder: '\u4f8b: CRM\u30c7\u30fc\u30bf', okText: '\u6b21\u3078'});
  if (!name) return;
  const confirm = await showModal({title: '\u4f5c\u6210\u306e\u78ba\u8a8d', body: `\u30c7\u30fc\u30bf\u30bd\u30fc\u30b9\u300c${name}\u300d\u3092\u4f5c\u6210\u3057\u307e\u3059\u304b\uff1f`, okText: '\u4f5c\u6210'});
  if (!confirm) return;
  try {
    const created = await api.createSource({ name });
    S.DATA_SOURCES.push(created);
    S.SOURCE_DATA[created.id] = [];
    await switchSource(created.id);
    seedDefaultPresets();
    reloadFullUI();
  } catch (e) {
    await showModal({title: '\u4f5c\u6210\u306b\u5931\u6557', body: e.message || 'データソースの作成に失敗しました', okText: 'OK', cancelText: ''});
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
document.getElementById('header-logout')?.addEventListener('click', () => logout());

// After user signs in, load data from backend and render.
observeAuth({
  onReady: async () => {
    await initStateFromServer();
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
    setTimeout(() => { autoRefreshSheetsIfNeeded(); autoRefreshBqIfNeeded(); }, 500);
  },
  onLoggedOut: () => {
    // Clear everything; user sees login overlay
    S.RAW = [];
    S.SOURCE_DATA = {};
  },
});
