// ===== Dashboard - ES Module Entry Point =====
import { on, emit } from './events.js';
import { S,
  initStateFromServer, saveState, saveCustomTabs, saveViewOrder,
  syncCurrentTabState, getPresets, setPresets,
  loadSourceMethod } from './state.js';
import { escapeHtml, hexToSoft } from './utils.js';
import { showModal } from './modal.js';
import { makeSortable } from './sortable.js';
import { applyFilters, renderFilters } from './filters.js';
import * as sheets from './sheets.js';
import { renderChart } from './chart.js';
import { renderCards } from './cardsRender.js';
import { renderTable } from './table.js';
import { groupRows } from './dimensions.js';
import { dimLabel } from './dimensions.js';
import { renderCurrentUserLabel, applyPermissionUI, hideLogin, observeAuth, signIn, signInEmailPassword, resetPassword, logout } from './auth.js';
import { seedDefaultPresets, renderPresets, loadPresetIntoGlobals, renderTabPresetSelect,
  enterPresetEdit, syncPresetEdit, deletePreset, savePresetPrompt,
  loadTabState, initTabStates, setExitSettingsMode as setExitSettingsModePresets } from './presets.js';
import { loadCustomTabs, renderCustomTabs, loadViewOrder, renderViewNav, applyView, highlightActiveView,
  setExitSettingsMode as setExitSettingsModeTabs } from './tabs.js';
import { setupSettingsEvents, exitSettingsMode } from './settings.js';
import { BRAND } from './config.js';
import { renderSourceNav, loadSnapshotIfNeeded } from './sources.js';
import { loadState } from './sidebar.js';
import './cards.js';
import './chartsUI.js';
import './thresholds.js';
import './sidebar.js';
import './csvExport.js';

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

// ===== Register event bus listeners =====
on('render', render);
on('renderChips', renderChips);

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
const chartsGrid = document.getElementById('charts-grid');
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
  const labelLines = String(nearest.label ?? '').split('\n');
  const metricHtml = nearest.metric ? `<div class="tt-m">${escapeHtml(String(nearest.metric))}</div>` : '';
  tooltip.innerHTML = `<div class="tt-x">${escapeHtml(String(nearest.x ?? ''))}</div>${metricHtml}${labelLines.map(l => `<div class="tt-y">${escapeHtml(l)}</div>`).join('')}`;
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
  emit('renderThresholds');
  render();
  sel.dataset.prev = v;
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

// ===== INITIALIZATION SEQUENCE =====
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
    // タブ毎にフィルタが復元されるため UI を再描画
    renderFilters();
    highlightActiveView();
    renderCustomTabs();
    renderChips();
    emit('renderThresholds');
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
