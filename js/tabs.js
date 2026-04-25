import { S, getPresets, syncCurrentTabState, setUserCurrentView } from './state.js';
import { escapeHtml, hexToSoft } from './utils.js';
import { loadTabState, exitPresetEdit, renderTabPresetSelect } from './presets.js';
import { emit } from './events.js';
import { renderFilters } from './filters.js';

// ===== Tabs & View navigation =====
export function loadCustomTabs() {
  // Now loaded by loadSourceConfig in state.js
}

export function renderCustomTabs() {
  const el = document.getElementById('custom-nav');
  if (!el) return;
  el.innerHTML = S.CUSTOM_TABS.length
    ? S.CUSTOM_TABS.map(t => {
        const color = t.color || '#64748b';
        const soft = hexToSoft(color);
        return `<div class="custom-tab-item" data-drag-key="${t.key}" draggable="true" style="--tab-color:${color};--tab-color-soft:${soft}"><button type="button" class="nav-item${S.CURRENT_VIEW===t.key?' active':''}" data-custom="${t.key}"><span class="tab-badge">\u30de\u30a4</span>${escapeHtml(t.label)}</button><input type="color" class="custom-tab-color" data-color-key="${t.key}" value="${color}" title="\u8272\u3092\u5909\u66f4"><button type="button" class="preset-del" data-del-custom="${t.key}" title="\u524a\u9664">\u00d7</button></div>`;
      }).join('')
    : '<div class="preset-empty">\u30ab\u30b9\u30bf\u30e0\u30bf\u30d6\u306a\u3057</div>';
}

export function loadViewOrder() {
  // Now loaded by loadSourceConfig in state.js
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

export function applyView(viewKey) {
  const isBuiltin = !!S.VIEWS[viewKey];
  const isCustom = S.CUSTOM_TABS.some(t => t.key === viewKey);
  if (!isBuiltin && !isCustom) return;
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
