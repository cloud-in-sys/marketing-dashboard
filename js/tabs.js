import { S, getPresets, syncCurrentTabState, setUserCurrentView } from './state.js';
import { escapeHtml, hexToSoft } from './utils.js';
import { loadTabState, exitPresetEdit, renderTabPresetSelect } from './presets.js';
import { emit } from './events.js';
import { renderFilters } from './filters/index.js';
import { dlog } from './config.js';

// ===== Tabs & View navigation =====
// \u30ab\u30b9\u30bf\u30e0\u30bf\u30d6\u306e\u30b0\u30eb\u30fc\u30d7\u6298\u308a\u305f\u305f\u307f\u72b6\u614b\u306f per-user \u3067 localStorage \u306b\u4fdd\u5b58\u3002
const COLLAPSED_GROUPS_KEY = 'custom-tab-collapsed-groups-v1';
function readCollapsedGroups() {
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSED_GROUPS_KEY) || '[]')); }
  catch (e) { return new Set(); }
}
function writeCollapsedGroups(set) {
  try { localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...set])); }
  catch (e) {}
}
export function toggleCustomTabGroup(name) {
  const set = readCollapsedGroups();
  if (set.has(name)) set.delete(name);
  else set.add(name);
  writeCollapsedGroups(set);
}
export function listCustomTabGroups() {
  // \u65e2\u5b58\u30b0\u30eb\u30fc\u30d7\u306e\u4e00\u89a7 (\u91cd\u8907\u306a\u3057\u3001CUSTOM_TABS \u306e\u51fa\u73fe\u9806)
  const seen = new Set();
  const out = [];
  for (const t of S.CUSTOM_TABS) {
    const g = t.group;
    if (g && !seen.has(g)) { seen.add(g); out.push(g); }
  }
  return out;
}

function renderCustomTabItem(t) {
  const color = t.color || '#64748b';
  const soft = hexToSoft(color);
  return `<div class="custom-tab-item" data-drag-key="${t.key}" draggable="true" style="--tab-color:${color};--tab-color-soft:${soft}"><button type="button" class="nav-item${S.CURRENT_VIEW===t.key?' active':''}" data-custom="${t.key}" data-drag-handle><span class="tab-badge">\u30de\u30a4</span>${escapeHtml(t.label)}</button><dashboard-color-picker class="custom-tab-color" data-color-key="${t.key}" value="${color}" title="\u8272\u3092\u5909\u66f4"></dashboard-color-picker><button type="button" class="preset-del" data-del-custom="${t.key}" title="\u524a\u9664">\u00d7</button></div>`;
}

export function renderCustomTabs() {
  const el = document.getElementById('custom-nav');
  if (!el) return;
  if (!S.CUSTOM_TABS.length) {
    el.innerHTML = '<div class="preset-empty">\u30ab\u30b9\u30bf\u30e0\u30bf\u30d6\u306a\u3057</div>';
    return;
  }
  const collapsed = readCollapsedGroups();
  // ungrouped \u3068 groups \u3092\u5206\u96e2\u3002\u9806\u5e8f\u306f CUSTOM_TABS \u306e\u4e26\u3073\u3092\u7dad\u6301\u3002
  const ungrouped = [];
  const groups = new Map(); // name \u2192 tabs[]
  for (const t of S.CUSTOM_TABS) {
    const g = t.group;
    if (!g) ungrouped.push(t);
    else {
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(t);
    }
  }
  let html = ungrouped.map(renderCustomTabItem).join('');
  for (const [name, tabs] of groups) {
    const isCollapsed = collapsed.has(name);
    // group \u584a\u81ea\u4f53\u3092\u30c9\u30e9\u30c3\u30b0\u5bfe\u8c61\u306b\u3059\u308b\u3002\u63b4\u3081\u308b\u306e\u306f\u30ad\u30e3\u30ec\u30c3\u30c8 (\u25be) \u9818\u57df\u306e\u307f\u3002
    // \u30b0\u30eb\u30fc\u30d7\u540d\u30af\u30ea\u30c3\u30af\u306f\u6298\u308a\u7573\u307f\u30c8\u30b0\u30eb\u3068\u3057\u3066\u6a5f\u80fd\u3055\u305b\u305f\u3044\u306e\u3067\u3001data-drag-handle \u3092\u30ad\u30e3\u30ec\u30c3\u30c8\u306b\u9650\u5b9a\u3002
    html += `<div class="custom-tab-group${isCollapsed ? ' collapsed' : ''}" data-group-name="${escapeHtml(name)}" data-drag-key="__group__:${escapeHtml(name)}" draggable="true">`
      + `<button type="button" class="custom-tab-group-header" data-group-toggle="${escapeHtml(name)}" data-drag-preview>`
      + `<span class="custom-tab-group-caret" data-drag-handle title="\u30c9\u30e9\u30c3\u30b0\u3067\u30b0\u30eb\u30fc\u30d7\u3092\u4e26\u3073\u66ff\u3048">\u25be</span>`
      + `<span class="custom-tab-group-name">${escapeHtml(name)}</span>`
      + `<span class="custom-tab-group-count">${tabs.length}</span>`
      + `</button>`
      + `<div class="custom-tab-group-children">${tabs.map(renderCustomTabItem).join('')}</div>`
      + `</div>`;
  }
  el.innerHTML = html;
}

export function renderViewNav() {
  const el = document.getElementById('view-nav');
  if (!el) return;
  const presets = getPresets();
  el.innerHTML = S.VIEW_ORDER.map(k => {
    const label = S.VIEWS[k].label;
    const preset = presets.find(p => p.builtin && p.name === label);
    const color = preset?.color || '#2563eb';
    const soft = hexToSoft(color);
    return `<button class="nav-item${S.CURRENT_VIEW===k?' active':''}" data-view="${k}" data-drag-key="${k}" draggable="true" style="--tab-color:${color};--tab-color-soft:${soft}"><span class="tab-badge">\u6a19\u6e96</span>${escapeHtml(label)}</button>`;
  }).join('');
}

let _exitSettingsMode = null;
export function setExitSettingsMode(fn) { _exitSettingsMode = fn; }
let _unsavedGuard = () => Promise.resolve(true);
export function setUnsavedGuard(fn) { _unsavedGuard = fn; }

export async function applyView(viewKey) {
  const isBuiltin = !!S.VIEWS[viewKey];
  const isCustom = S.CUSTOM_TABS.some(t => t.key === viewKey);
  if (!isBuiltin && !isCustom) return;
  if (!(await _unsavedGuard())) return; // 未保存変更ガード
  dlog('applyView', { from: S.CURRENT_VIEW, to: viewKey, sid: S.CURRENT_SOURCE });
  if (_exitSettingsMode) _exitSettingsMode();
  syncCurrentTabState();
  exitPresetEdit();
  S.CURRENT_VIEW = viewKey;
  // 最後に開いたタブをユーザー状態に記録(他ユーザーのCURRENT_VIEWは上書きしない)
  setUserCurrentView(viewKey);
  S.CURRENT_FILTER = isBuiltin ? (S.VIEWS[viewKey].filter || null) : null;
  loadTabState(viewKey);
  // タブ毎にフィルタが復元される可能性があるため UI を再描画
  renderFilters();
  highlightActiveView();
  renderCustomTabs();
  emit('renderChips');
  emit('renderThresholds');
  renderTabPresetSelect();
  document.body.classList.toggle('tab-custom', isCustom);
  const viewEl = document.querySelector('.view');
  if (viewEl) {
    viewEl.classList.remove('animating');
    void viewEl.offsetWidth;
    viewEl.classList.add('animating');
  }
  // タブの active 表示を先にフラッシュしてから重い集計/描画を実行。
  // 連打時は最後の1回分だけ描画(中間の重い計算をスキップ)
  scheduleRender();
}

let _renderRafId = null;
function scheduleRender() {
  if (_renderRafId != null) cancelAnimationFrame(_renderRafId);
  _renderRafId = requestAnimationFrame(() => {
    _renderRafId = null;
    emit('render');
  });
}

export function highlightActiveView() {
  document.querySelectorAll('#view-nav .nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.view === S.CURRENT_VIEW);
  });
}
