import { S, DEFAULT_VIEWS_INIT, BUILTIN_SEED_VERSION, getPresets, setPresets, syncCurrentTabState, saveCustomTabs } from './state.js';
import { escapeHtml, hexToSoft } from './utils.js';
import { showModal } from './modal.js';
import { hasPerm } from './auth.js';
import { emit } from './events.js';

// ===== Presets =====
export const BUILTIN_PRESET_DEFS = {
  summary_daily: {
    charts: [
      {metric: 'ad_cost',  type: 'area', size: 'main', color: '#2563eb'},
      {metric: 'clicks',   type: 'line', size: 'sub',  color: '#0ea5e9'},
      {metric: 'line_reg', type: 'bar',  size: 'sub',  color: '#10b981'},
      {metric: 'deal',     type: 'bar',  size: 'sub',  color: '#f59e0b'},
    ],
    metrics: ['ad_cost','ad_cost_fee','impression','clicks','ctr','cpc','line_reg','cpa_reg','answer','answer_rate','cpa_answer','booking','join','join_rate','cpa_join','deal','cpo','rev_ltv','roas_ltv'],
  },
  summary_month: {
    charts: [
      {metric: 'ad_cost',  type: 'bar',  size: 'main', color: '#2563eb'},
      {metric: 'rev_ltv',  type: 'area', size: 'sub',  color: '#10b981'},
      {metric: 'roas_ltv', type: 'line', size: 'sub',  color: '#7c3aed'},
    ],
    metrics: ['ad_cost','ad_cost_fee','impression','clicks','line_reg','cpa_reg','answer','booking','join','deal','cpo','rev_first','rev_ltv','roas_first','roas_ltv'],
  },
  non_ad: {
    charts: [
      {metric: 'line_reg', type: 'line', size: 'main', color: '#10b981'},
      {metric: 'answer',   type: 'bar',  size: 'sub',  color: '#0ea5e9'},
      {metric: 'join',     type: 'bar',  size: 'sub',  color: '#7c3aed'},
      {metric: 'deal',     type: 'bar',  size: 'sub',  color: '#f59e0b'},
    ],
    metrics: ['line_reg','answer','answer_rate','booking','join','join_rate','seat_first','seat_ltv','deal','deal_rate','avg_first','avg_ltv','rev_first','rev_ltv'],
  },
  ad_only: {
    charts: [
      {metric: 'ad_cost',    type: 'area', size: 'main', color: '#2563eb'},
      {metric: 'impression', type: 'bar',  size: 'sub',  color: '#0ea5e9'},
      {metric: 'ctr',        type: 'line', size: 'sub',  color: '#10b981'},
      {metric: 'cpc',        type: 'line', size: 'sub',  color: '#f59e0b'},
    ],
    metrics: ['ad_cost','ad_cost_fee','impression','cpm','reach','clicks','ctr','cpc','mcv','mcvr','cvr','divergence'],
  },
  op_media: {
    charts: [
      {metric: 'ad_cost',  type: 'bar',  size: 'main', color: '#2563eb'},
      {metric: 'cpa_reg',  type: 'line', size: 'sub',  color: '#f59e0b'},
      {metric: 'roas_ltv', type: 'bar',  size: 'sub',  color: '#10b981'},
    ],
    metrics: ['ad_cost','impression','clicks','ctr','cpc','cvr','line_reg','cpa_reg','cpa_answer','cpa_booking','deal','cpo','roas_ltv'],
  },
  op_dow: {
    charts: [
      {metric: 'ad_cost',  type: 'bar', size: 'main', color: '#2563eb'},
      {metric: 'cvr',      type: 'bar', size: 'sub',  color: '#10b981'},
      {metric: 'cpa_reg',  type: 'bar', size: 'sub',  color: '#f59e0b'},
    ],
    metrics: ['ad_cost','clicks','ctr','cvr','line_reg','cpa_reg','cpa_answer','deal','cpo'],
  },
  seminar: {
    charts: [
      {metric: 'join',        type: 'bar',  size: 'main', color: '#7c3aed'},
      {metric: 'answer_rate', type: 'line', size: 'sub',  color: '#10b981'},
      {metric: 'join_rate',   type: 'line', size: 'sub',  color: '#0ea5e9'},
      {metric: 'cpo',         type: 'bar',  size: 'sub',  color: '#f59e0b'},
    ],
    metrics: ['line_reg','answer','answer_rate','cpa_answer','booking','join','join_rate','cpa_join','deal','deal_rate','cpo'],
  },
  media: {
    charts: [
      {metric: 'ad_cost',  type: 'bar',  size: 'main', color: '#2563eb'},
      {metric: 'cpa_reg',  type: 'line', size: 'sub',  color: '#f59e0b'},
      {metric: 'cvr',      type: 'line', size: 'sub',  color: '#10b981'},
      {metric: 'roas_ltv', type: 'bar',  size: 'sub',  color: '#7c3aed'},
    ],
    metrics: ['ad_cost','impression','clicks','ctr','cpc','cvr','line_reg','cpa_reg','cpa_answer','deal','cpo','rev_ltv','roas_ltv'],
  },
  lpcr: {
    charts: [
      {metric: 'cvr',        type: 'bar',  size: 'main', color: '#10b981'},
      {metric: 'mcvr',       type: 'line', size: 'sub',  color: '#0ea5e9'},
      {metric: 'divergence', type: 'area', size: 'sub',  color: '#f59e0b'},
      {metric: 'cpa_reg',    type: 'bar',  size: 'sub',  color: '#7c3aed'},
    ],
    metrics: ['clicks','mcv','mcvr','cvr','divergence','line_reg','cpa_reg'],
  },
};

export function seedDefaultPresets() {
  const existing = getPresets();
  const existingBuiltins = new Map(existing.filter(p => p.builtin).map(p => [p.name, p]));
  const userPresets = existing.filter(p => !p.builtin);
  const initLabels = new Set(Object.values(DEFAULT_VIEWS_INIT).map(v => v.label));
  const customBuiltins = existing.filter(p => p.builtin && !initLabels.has(p.name));
  const newBuiltins = Object.entries(DEFAULT_VIEWS_INIT).map(([k, v]) => {
    const prev = existingBuiltins.get(v.label);
    if (prev && (prev.seedVersion || 0) >= BUILTIN_SEED_VERSION) return prev;
    const def = BUILTIN_PRESET_DEFS[k] || {
      charts: [{metric: 'ad_cost', type: 'bar', size: 'main', color: '#2563eb'}],
      metrics: S.METRIC_DEFS.map(m => m.key),
    };
    return {
      name: v.label,
      builtin: true,
      seedVersion: BUILTIN_SEED_VERSION,
      charts: def.charts.map((c, i) => ({id: i + 1, metric: c.metric, type: c.type, size: c.size, color: c.color, name: '', bucket: 'auto'})),
      dims: [...v.dims],
      metrics: [...def.metrics],
      thresholds: {},
      thresholdMetrics: [],
    };
  });
  setPresets([...newBuiltins, ...customBuiltins, ...userPresets]);
}

export function renderPresets() {
  const el = document.getElementById('preset-list');
  if (!el) return;
  const list = getPresets();
  el.innerHTML = list.length
    ? list.map((p, i) => {
        const color = p.color || (p.builtin ? '#2563eb' : '#64748b');
        const soft = hexToSoft(color);
        const badgeText = p.builtin ? '\u6a19\u6e96' : '\u30de\u30a4';
        const badge = `<span class="preset-badge">${badgeText}</span>`;
        const del = p.builtin ? '' : `<button type="button" class="preset-del" data-idx="${i}" title="\u524a\u9664">\u00d7</button>`;
        const editing = S.PRESET_EDIT_IDX === i ? ' editing' : '';
        const title = p.builtin ? '\u6a19\u6e96\u30d7\u30ea\u30bb\u30c3\u30c8\uff08\u30af\u30ea\u30c3\u30af\u3067\u7de8\u96c6\u3001\u524a\u9664\u4e0d\u53ef\uff09' : '\u30af\u30ea\u30c3\u30af\u3067\u7de8\u96c6';
        return `<div class="preset-item${p.builtin?' builtin':''}${editing}" data-idx="${i}" data-drag-key="${escapeHtml(p.name)}" draggable="true" style="--preset-color:${color};--preset-color-soft:${soft}"><span class="preset-name" title="${title}">${badge}${escapeHtml(p.name)}</span>${del}</div>`;
      }).join('')
    : '<div class="preset-empty">\u4fdd\u5b58\u306a\u3057</div>';
}

export function loadPresetIntoGlobals(p) {
  if (Array.isArray(p.charts) && p.charts.length) {
    S.CHARTS = p.charts.map(c => ({id: c.id, metric: c.metric, type: c.type, size: c.size, color: c.color || '#2563eb', name: c.name || '', bucket: c.bucket || 'auto'}));
    S.CHART_ID_SEQ = Math.max(...S.CHARTS.map(c => c.id)) + 1;
  }
  S.SELECTED_DIMS = Array.isArray(p.dims) && p.dims.length ? [...p.dims] : ['action_date'];
  S.SELECTED_METRICS = Array.isArray(p.metrics) && p.metrics.length ? [...p.metrics] : S.METRIC_DEFS.map(m => m.key);
  S.THRESHOLDS = p.thresholds && typeof p.thresholds === 'object' ? JSON.parse(JSON.stringify(p.thresholds)) : {};
  S.THRESHOLD_METRICS = Array.isArray(p.thresholdMetrics) ? [...p.thresholdMetrics] : [];
}

export function loadPreset(i) {
  const p = getPresets()[i];
  if (!p) return;
  loadPresetIntoGlobals(p);
  syncCurrentTabState();
  emit('renderChips');
  emit('renderThresholds');
  emit('render');
}

export async function savePresetPrompt() {
  const name = await showModal({title: '\u65b0\u3057\u3044\u30d7\u30ea\u30bb\u30c3\u30c8\u3092\u4fdd\u5b58', body: '\u30d7\u30ea\u30bb\u30c3\u30c8\u540d\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044', input: true, placeholder: '\u4f8b: \u6708\u6b21\u30ec\u30d3\u30e5\u30fc\u7528', okText: '\u4fdd\u5b58'});
  if (!name) return;
  const list = getPresets();
  if (list.some(p => p.name === name && p.builtin)) {
    await showModal({title: '\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093', body: '\u6a19\u6e96\u30d7\u30ea\u30bb\u30c3\u30c8\u3068\u540c\u3058\u540d\u524d\u306f\u4f7f\u7528\u3067\u304d\u307e\u305b\u3093', okText: 'OK', cancelText: ''});
    return;
  }
  const dup = list.some(p => p.name === name && !p.builtin);
  if (dup) {
    const ok = await showModal({title: '\u4e0a\u66f8\u304d\u4fdd\u5b58', body: `\u300c${name}\u300d\u306f\u65e2\u306b\u5b58\u5728\u3057\u307e\u3059\u3002\u4e0a\u66f8\u304d\u3057\u307e\u3059\u304b\uff1f`, okText: '\u4e0a\u66f8\u304d', danger: true});
    if (!ok) return;
  }
  const PRESET_COLORS = ['#7c3aed','#10b981','#f59e0b','#ef4444','#0ea5e9','#ec4899','#14b8a6','#8b5cf6'];
  const userCount = list.filter(p => !p.builtin).length;
  const entry = {
    name,
    color: PRESET_COLORS[userCount % PRESET_COLORS.length],
    charts: S.CHARTS.map(c => ({id: c.id, metric: c.metric, type: c.type, size: c.size, color: c.color || '#2563eb', name: c.name || '', bucket: c.bucket || 'auto'})),
    dims: [...S.SELECTED_DIMS],
    metrics: [...S.SELECTED_METRICS],
    thresholds: JSON.parse(JSON.stringify(S.THRESHOLDS)),
    thresholdMetrics: [...S.THRESHOLD_METRICS],
  };
  const existing = list.findIndex(p => p.name === name && !p.builtin);
  if (existing >= 0) { entry.color = list[existing].color || entry.color; list[existing] = entry; }
  else list.push(entry);
  setPresets(list);
  renderPresets();
  const idx = list.findIndex(p => p.name === name);
  const newItem = document.querySelector(`#preset-list [data-idx="${idx}"].preset-load`);
  if (newItem) {
    newItem.scrollIntoView({behavior: 'smooth', block: 'nearest'});
    newItem.closest('.preset-item')?.classList.add('preset-flash');
    setTimeout(() => newItem.closest('.preset-item')?.classList.remove('preset-flash'), 1400);
  }
}

export async function deletePreset(i) {
  const list = getPresets();
  if (!list[i] || list[i].builtin) return;
  const name = list[i].name;
  const ok = await showModal({title: '\u30d7\u30ea\u30bb\u30c3\u30c8\u524a\u9664', body: `\u300c${name}\u300d\u3092\u524a\u9664\u3057\u307e\u3059\u304b\uff1f\u3053\u306e\u64cd\u4f5c\u306f\u53d6\u308a\u6d88\u305b\u307e\u305b\u3093\u3002`, okText: '\u524a\u9664', danger: true});
  if (!ok) return;
  list.splice(i, 1);
  setPresets(list);
  renderPresets();
  renderTabPresetSelect();
}

export function syncPresetEdit() {
  if (S.PRESET_EDIT_IDX == null) return;
  const list = getPresets();
  const p = list[S.PRESET_EDIT_IDX];
  if (!p) return;
  p.charts = S.CHARTS.map(c => ({id: c.id, metric: c.metric, type: c.type, size: c.size, color: c.color || '#2563eb', name: c.name || '', bucket: c.bucket || 'auto'}));
  p.dims = [...S.SELECTED_DIMS];
  p.metrics = [...S.SELECTED_METRICS];
  p.thresholds = JSON.parse(JSON.stringify(S.THRESHOLDS));
  p.thresholdMetrics = [...S.THRESHOLD_METRICS];
  p.color = document.getElementById('preset-color-picker').value || p.color;
  setPresets(list);
}

export function enterPresetEdit(idx) {
  if (!hasPerm('editPreset')) { showModal({title: '\u6a29\u9650\u304c\u3042\u308a\u307e\u305b\u3093', body: '\u30d7\u30ea\u30bb\u30c3\u30c8\u7de8\u96c6\u6a29\u9650\u304c\u3042\u308a\u307e\u305b\u3093', okText: 'OK', cancelText: ''}); return; }
  const list = getPresets();
  const p = list[idx];
  if (!p) return;
  exitSettingsMode();
  syncCurrentTabState();
  S.PRESET_EDIT_IDX = idx;
  loadPresetIntoGlobals(p);
  document.querySelectorAll('#view-nav .nav-item, #custom-nav .nav-item').forEach(b => b.classList.remove('active'));
  document.body.classList.add('preset-editing');
  document.body.classList.remove('readonly-tab', 'tab-custom');
  document.getElementById('view-title').textContent = `\u30d7\u30ea\u30bb\u30c3\u30c8\u7de8\u96c6: ${p.name}`;
  document.getElementById('preset-color-picker').value = p.color || (p.builtin ? '#2563eb' : '#64748b');
  emit('renderChips');
  emit('renderThresholds');
  renderPresets();
  emit('render');
  const viewEl = document.querySelector('.view');
  if (viewEl) { viewEl.classList.remove('animating'); void viewEl.offsetWidth; viewEl.classList.add('animating'); }
}

export function exitPresetEdit() {
  S.PRESET_EDIT_IDX = null;
  document.body.classList.remove('preset-editing');
}

export function loadTabState(viewKey) {
  if (S.VIEWS[viewKey]) {
    const view = S.VIEWS[viewKey];
    const presetName = view.presetName || view.label;
    const p = getPresets().find(x => x.name === presetName);
    if (p) {
      loadPresetIntoGlobals(p);
    } else {
      S.SELECTED_DIMS = [...view.dims];
      S.SELECTED_METRICS = S.METRIC_DEFS.map(m => m.key);
      S.THRESHOLDS = {};
      S.THRESHOLD_METRICS = [];
    }
    return;
  }
  const st = S.TAB_STATES[viewKey];
  if (!st) return;
  S.SELECTED_DIMS = Array.isArray(st.dims) && st.dims.length ? [...st.dims] : ['action_date'];
  S.SELECTED_METRICS = Array.isArray(st.metrics) ? [...st.metrics] : S.METRIC_DEFS.map(m => m.key);
  S.THRESHOLDS = st.thresholds ? JSON.parse(JSON.stringify(st.thresholds)) : {};
  S.THRESHOLD_METRICS = Array.isArray(st.thresholdMetrics) ? [...st.thresholdMetrics] : [];
}

export function initTabStates() {
  Object.keys(S.VIEWS).forEach(k => {
    if (!S.TAB_STATES[k]) {
      S.TAB_STATES[k] = {
        dims: [...S.VIEWS[k].dims],
        metrics: S.METRIC_DEFS.map(m => m.key),
        thresholds: {},
        thresholdMetrics: [],
      };
    }
  });
  S.CUSTOM_TABS.forEach(t => {
    if (!S.TAB_STATES[t.key]) {
      S.TAB_STATES[t.key] = {
        dims: ['action_date'],
        metrics: S.METRIC_DEFS.map(m => m.key),
        thresholds: {},
        thresholdMetrics: [],
      };
    }
  });
}

export function renderTabPresetSelect() {
  document.body.classList.toggle('readonly-tab', !!S.VIEWS[S.CURRENT_VIEW]);
  const sel = document.getElementById('tab-preset');
  if (!sel) return;
  const list = getPresets();
  sel.innerHTML = '<option value="">\u2014 \u9078\u629e \u2014</option>' + list.map((p, i) => `<option value="${i}">${p.builtin ? '[\u6a19\u6e96] ' : ''}${escapeHtml(p.name)}</option>`).join('');
  const tabPreset = S.CUSTOM_TABS.find(t => t.key === S.CURRENT_VIEW)?.presetName;
  const idx = tabPreset ? list.findIndex(p => p.name === tabPreset) : -1;
  sel.value = idx >= 0 ? String(idx) : '';
}

export function createBuiltinPresetFor(baseName) {
  const list = getPresets();
  let name = baseName;
  let n = 2;
  while (list.some(p => p.name === name)) { name = `${baseName} (${n++})`; }
  list.push({
    name,
    builtin: true,
    seedVersion: BUILTIN_SEED_VERSION,
    color: '#2563eb',
    charts: [{id: 1, metric: 'ad_cost', type: 'bar', size: 'main', color: '#2563eb', name: '', bucket: 'auto'}],
    dims: ['action_date'],
    metrics: S.METRIC_DEFS.map(m => m.key),
    thresholds: {},
    thresholdMetrics: [],
  });
  setPresets(list);
  renderPresets();
  renderTabPresetSelect();
  return name;
}

// exitSettingsMode is imported lazily to break circular dep
let _exitSettingsMode = null;
export function setExitSettingsMode(fn) { _exitSettingsMode = fn; }
function exitSettingsMode() { if (_exitSettingsMode) _exitSettingsMode(); }
