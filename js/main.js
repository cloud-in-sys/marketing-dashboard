// ===== Dashboard - ES Module Entry Point =====
import { on, emit } from './events.js';
import { S, PALETTE, SIDEBAR_KEY, PANELS_KEY, GROUPS_KEY, STATE_KEY,
  initStateFromStorage, saveState, saveColWidths, saveCustomTabs, saveViewOrder,
  syncCurrentTabState, getPresets, setPresets } from './state.js';
import { escapeHtml, hexToSoft } from './utils.js';
import { parseCSV } from './csv.js';
import { showModal } from './modal.js';
import { makeSortable } from './sortable.js';
import { applyFilters, renderFilters, populateFilters } from './filters.js';
import { renderChart } from './chart.js';
import { renderTable } from './table.js';
import { groupRows } from './dimensions.js';
import { dimLabel } from './dimensions.js';
import { loadUsers, getCurrentUser, hasPerm, renderCurrentUserLabel, applyPermissionUI, showLogin, hideLogin } from './auth.js';
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
      return `<div class="threshold-row" data-key="${k}">
        <div class="threshold-label">${m.label}${unit ? `<span class="unit">${unit}</span>` : ''}</div>
        <input type="number" step="any" data-role="min" placeholder="\u2014" value="${toDisplayThreshold(t.min, m.fmt)}">
        <input type="number" step="any" data-role="max" placeholder="\u2014" value="${toDisplayThreshold(t.max, m.fmt)}">
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
    <span class="pill">${dimLabel(k)}<button type="button" class="pill-remove" data-remove="${k}">\u00d7</button></span>
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
  saveState();
}

// ===== STATE LOADING =====
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
    if (!s) return;
    if (s.tabStates && typeof s.tabStates === 'object') S.TAB_STATES = s.tabStates;
    if (s.currentView && S.VIEWS[s.currentView]) S.CURRENT_VIEW = s.currentView;
    if (Array.isArray(s.charts) && s.charts.length) {
      S.CHARTS = s.charts.map(c => ({id: c.id, metric: c.metric, type: c.type, size: c.size, color: c.color || '#2563eb', name: c.name || '', bucket: c.bucket || 'auto'}));
      S.CHART_ID_SEQ = Math.max(...S.CHARTS.map(c => c.id)) + 1;
    }
    if (!s.tabStates && (Array.isArray(s.dims) || Array.isArray(s.metrics) || s.thresholds)) {
      S.TAB_STATES[S.CURRENT_VIEW] = {
        dims: Array.isArray(s.dims) && s.dims.length ? [...s.dims] : [...S.VIEWS[S.CURRENT_VIEW].dims],
        metrics: Array.isArray(s.metrics) && s.metrics.length ? [...s.metrics] : S.METRIC_DEFS.map(m => m.key),
        thresholds: s.thresholds && typeof s.thresholds === 'object' ? s.thresholds : {},
        thresholdMetrics: Array.isArray(s.thresholdMetrics) ? s.thresholdMetrics : [],
      };
    }
  } catch (e) {}
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
initStateFromStorage();
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
    S.CUSTOM_TABS = S.CUSTOM_TABS.filter(t => t.key !== key);
    delete S.TAB_STATES[key];
    saveCustomTabs();
    if (S.CURRENT_VIEW === key) applyView('summary_daily');
    else renderCustomTabs();
    return;
  }
  const btn = e.target.closest('[data-custom]');
  if (btn) applyView(btn.dataset.custom);
});
document.getElementById('add-custom-tab').addEventListener('click', async () => {
  const label = await showModal({title: '\u30ab\u30b9\u30bf\u30e0\u30bf\u30d6\u3092\u8ffd\u52a0', body: '\u30bf\u30d6\u306e\u540d\u524d\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044', input: true, placeholder: '\u4f8b: \u81ea\u5206\u7528\u306e\u5206\u6790', okText: '\u8ffd\u52a0'});
  if (!label) return;
  const palette = ['#7c3aed','#10b981','#f59e0b','#ef4444','#0ea5e9','#ec4899','#14b8a6','#8b5cf6'];
  const key = 'custom_' + Date.now();
  const color = palette[S.CUSTOM_TABS.length % palette.length];
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
  const colKey = th.dataset.colKey;
  const table = th.closest('table');
  const idx = [...th.parentElement.children].indexOf(th);
  const col = table.querySelector('colgroup').children[idx];
  resizingCol = {colKey, col, startX: e.clientX, startWidth: th.offsetWidth};
  document.body.classList.add('col-resizing');
});
document.addEventListener('mousemove', e => {
  if (!resizingCol) return;
  const delta = e.clientX - resizingCol.startX;
  const w = Math.max(50, resizingCol.startWidth + delta);
  resizingCol.col.style.width = w + 'px';
  const table = document.getElementById('data-table');
  let total = 0;
  table.querySelectorAll('colgroup col').forEach(c => { total += parseFloat(c.style.width) || 0; });
  table.style.width = total + 'px';
});
document.addEventListener('mouseup', () => {
  if (!resizingCol) return;
  const w = parseFloat(resizingCol.col.style.width);
  if (w) { S.COL_WIDTHS[resizingCol.colKey] = w; saveColWidths(); }
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

document.getElementById('file').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  const text = await f.text();
  S.RAW = parseCSV(text);
  populateFilters();
  renderCsvColumns();
  render();
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
  const mdef = S.METRIC_DEFS.find(m => m.key === key);
  if (!mdef) return;
  const raw = fromDisplayThreshold(e.target.value, mdef.fmt);
  if (!S.THRESHOLDS[key]) S.THRESHOLDS[key] = {};
  if (raw == null) delete S.THRESHOLDS[key][role];
  else S.THRESHOLDS[key][role] = raw;
  if (Object.keys(S.THRESHOLDS[key]).length === 0) delete S.THRESHOLDS[key];
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
initSidebar();
initPanelCollapse();
applySidebarGroupState();
renderFilters();
loadUsers();
renderCurrentUserLabel();
applyPermissionUI();
if (!S.CURRENT_USER) showLogin();
else hideLogin();

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
