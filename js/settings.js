import { S, PERM_DEFS, ADMIN_PERMS, VIEWER_PERMS, DEFAULT_BASE_FORMULAS, DEFAULT_FORMULAS,
  saveMetricDefs, saveDimensions, saveViews, saveFilterDefs, saveFormulas, saveBaseFormulas,
  saveUsers, saveViewOrder, getPresets, setPresets, compileFilter } from './state.js';
import { escapeHtml } from './utils.js';
import { showModal } from './modal.js';
import { parseBaseFormula } from './aggregate.js';
import { hasPerm, getCurrentUser, tryLogin, hideLogin, logout, renderCurrentUserLabel, applyPermissionUI } from './auth.js';
import { renderPresets, renderTabPresetSelect, createBuiltinPresetFor, exitPresetEdit } from './presets.js';
import { renderViewNav } from './tabs.js';
import { renderFilters } from './filters.js';
import { emit } from './events.js';

// ----- DIRTY FLAGS -----
function markUsersDirty() {
  document.getElementById('users-save-btn')?.classList.add('dirty');
}
function clearUsersDirty() {
  document.getElementById('users-save-btn')?.classList.remove('dirty');
}
function markMetricsDirty() {
  document.getElementById('metrics-save-btn')?.classList.add('dirty');
}
function clearMetricsDirty() {
  document.getElementById('metrics-save-btn')?.classList.remove('dirty');
}
function markFiltersDirty() {
  document.getElementById('filters-save-btn')?.classList.add('dirty');
}
function clearFiltersDirty() {
  document.getElementById('filters-save-btn')?.classList.remove('dirty');
}
function markDimsDirty() {
  document.getElementById('dims-save-btn')?.classList.add('dirty');
}
function clearDimsDirty() {
  document.getElementById('dims-save-btn')?.classList.remove('dirty');
}
function markDefaultsDirty() {
  document.getElementById('defaults-save-btn')?.classList.add('dirty');
}
function clearDefaultsDirty() {
  document.getElementById('defaults-save-btn')?.classList.remove('dirty');
}

// ----- ENTER / EXIT SETTINGS MODE -----
export function enterSettingsMode(target = 'users') {
  document.body.classList.add('settings-mode');
  document.getElementById('settings-view').classList.toggle('hidden', target !== 'users');
  document.getElementById('metrics-doc-view').classList.toggle('hidden', target !== 'metrics');
  document.getElementById('filters-doc-view').classList.toggle('hidden', target !== 'filters');
  document.getElementById('dims-doc-view').classList.toggle('hidden', target !== 'dims');
  document.getElementById('defaults-doc-view').classList.toggle('hidden', target !== 'defaults');
  document.querySelectorAll('#view-nav .nav-item, #custom-nav .nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById('open-settings').classList.toggle('active', target === 'users');
  document.getElementById('open-metrics-doc').classList.toggle('active', target === 'metrics');
  document.getElementById('open-filters-doc').classList.toggle('active', target === 'filters');
  document.getElementById('open-dims-doc').classList.toggle('active', target === 'dims');
  document.getElementById('open-defaults-doc').classList.toggle('active', target === 'defaults');
  exitPresetEdit();
  if (target === 'users') {
    S.USERS_DRAFT = JSON.parse(JSON.stringify(S.USERS));
    S.METRICS_DRAFT = null;
    S.METRICS_DRAFT_BASE = null;
    S.METRIC_DEFS_DRAFT = null;
    S.FILTER_DEFS_DRAFT = null;
    clearUsersDirty();
    clearMetricsDirty();
    clearFiltersDirty();
    renderUsersModal();
  } else if (target === 'metrics') {
    S.USERS_DRAFT = null;
    S.METRICS_DRAFT = {...S.METRIC_FORMULAS};
    S.METRICS_DRAFT_BASE = {...S.BASE_FORMULAS};
    S.METRIC_DEFS_DRAFT = JSON.parse(JSON.stringify(S.METRIC_DEFS));
    S.FILTER_DEFS_DRAFT = null;
    clearUsersDirty();
    clearMetricsDirty();
    clearFiltersDirty();
    renderCsvColumns();
    renderMetricsDoc();
  } else if (target === 'filters') {
    S.USERS_DRAFT = null;
    S.METRICS_DRAFT = null;
    S.METRICS_DRAFT_BASE = null;
    S.METRIC_DEFS_DRAFT = null;
    S.FILTER_DEFS_DRAFT = JSON.parse(JSON.stringify(S.FILTER_DEFS));
    S.VIEWS_DRAFT = null;
    clearUsersDirty();
    clearMetricsDirty();
    clearFiltersDirty();
    clearDefaultsDirty();
    renderFiltersDoc();
  } else if (target === 'defaults') {
    S.USERS_DRAFT = null;
    S.METRICS_DRAFT = null;
    S.METRICS_DRAFT_BASE = null;
    S.METRIC_DEFS_DRAFT = null;
    S.FILTER_DEFS_DRAFT = null;
    S.DIMENSIONS_DRAFT = null;
    S.VIEWS_DRAFT = Object.entries(S.VIEWS).map(([k, v]) => ({key: k, label: v.label, dims: [...v.dims], filterExpr: v.filterExpr || '', presetName: v.presetName || v.label}));
    clearUsersDirty();
    clearMetricsDirty();
    clearFiltersDirty();
    clearDimsDirty();
    clearDefaultsDirty();
    renderDefaultsDoc();
  } else if (target === 'dims') {
    S.USERS_DRAFT = null;
    S.METRICS_DRAFT = null;
    S.METRICS_DRAFT_BASE = null;
    S.METRIC_DEFS_DRAFT = null;
    S.FILTER_DEFS_DRAFT = null;
    S.VIEWS_DRAFT = null;
    S.DIMENSIONS_DRAFT = JSON.parse(JSON.stringify(S.DIMENSIONS));
    clearUsersDirty();
    clearMetricsDirty();
    clearFiltersDirty();
    clearDefaultsDirty();
    clearDimsDirty();
    renderCsvColumns();
    renderDimsDoc();
  }
}

export function exitSettingsMode() {
  document.body.classList.remove('settings-mode');
  document.getElementById('settings-view').classList.add('hidden');
  document.getElementById('metrics-doc-view').classList.add('hidden');
  document.getElementById('filters-doc-view').classList.add('hidden');
  document.getElementById('dims-doc-view').classList.add('hidden');
  document.getElementById('defaults-doc-view').classList.add('hidden');
  document.getElementById('open-settings').classList.remove('active');
  document.getElementById('open-metrics-doc').classList.remove('active');
  document.getElementById('open-filters-doc').classList.remove('active');
  document.getElementById('open-dims-doc').classList.remove('active');
  document.getElementById('open-defaults-doc').classList.remove('active');
  S.USERS_DRAFT = null;
  S.METRICS_DRAFT = null;
  S.METRICS_DRAFT_BASE = null;
  S.METRIC_DEFS_DRAFT = null;
  S.FILTER_DEFS_DRAFT = null;
  S.VIEWS_DRAFT = null;
  S.DIMENSIONS_DRAFT = null;
  clearUsersDirty();
  clearMetricsDirty();
  clearFiltersDirty();
  clearDefaultsDirty();
  clearDimsDirty();
}

// ----- USERS VIEW -----
function renderUsersModal() {
  const list = document.getElementById('users-list');
  if (!list) return;
  const src = S.USERS_DRAFT || S.USERS;
  list.innerHTML = src.map((u, i) => `
    <div class="user-row" data-user-idx="${i}">
      <div class="user-row-top">
        <div class="user-avatar">${escapeHtml((u.name || u.id || '?').slice(0, 1).toUpperCase())}</div>
        <div class="user-row-main">
          <input type="text" class="user-name-input" data-user-name value="${escapeHtml(u.name)}" placeholder="\u8868\u793a\u540d">
          <label class="user-admin-toggle"><input type="checkbox" data-admin${u.isAdmin?' checked':''}>\u7ba1\u7406\u8005</label>
        </div>
        <button type="button" class="user-del" data-user-del="${i}" title="\u524a\u9664"${S.USERS.length<=1?' disabled':''}>×</button>
      </div>
      <div class="user-field-grid">
        <div class="user-field">
          <label>\u30ed\u30b0\u30a4\u30f3ID</label>
          <input type="text" data-user-id value="${escapeHtml(u.id)}" placeholder="user01">
        </div>
        <div class="user-field">
          <label>\u30d1\u30b9\u30ef\u30fc\u30c9</label>
          <input type="text" data-user-pw value="${escapeHtml(u.password)}" placeholder="\u30d1\u30b9\u30ef\u30fc\u30c9">
        </div>
      </div>
      <div class="user-perms-section">
        <div class="user-perms-title">\u64cd\u4f5c\u6a29\u9650</div>
        <div class="user-perms">
          ${PERM_DEFS.map(p => `<label><input type="checkbox" data-perm="${p.key}"${u.perms[p.key]?' checked':''}><span>${p.label}</span></label>`).join('')}
        </div>
      </div>
    </div>
  `).join('');
}

async function addUser() {
  const name = await showModal({title: '\u30e6\u30fc\u30b6\u30fc\u3092\u8ffd\u52a0', body: '\u65b0\u3057\u3044\u30e6\u30fc\u30b6\u30fc\u306e\u8868\u793a\u540d\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044', input: true, placeholder: '\u4f8b: \u7530\u4e2d', okText: '\u8ffd\u52a0'});
  if (!name) return;
  const draft = S.USERS_DRAFT || S.USERS;
  let baseId = name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
  let id = baseId;
  let n = 1;
  while (draft.some(u => u.id === id)) { id = baseId + n++; }
  draft.push({id, password: '', name, isAdmin: false, perms: {...VIEWER_PERMS}});
  markUsersDirty();
  renderUsersModal();
}

async function removeUser(idx) {
  const draft = S.USERS_DRAFT || S.USERS;
  if (draft.length <= 1) return;
  const u = draft[idx];
  const ok = await showModal({title: '\u30e6\u30fc\u30b6\u30fc\u524a\u9664', body: `\u300c${u.name}\u300d\u3092\u524a\u9664\u3057\u307e\u3059\u304b\uff1f\uff08\u4fdd\u5b58\u30dc\u30bf\u30f3\u3092\u62bc\u3059\u307e\u3067\u78ba\u5b9a\u3057\u307e\u305b\u3093\uff09`, okText: '\u524a\u9664', danger: true});
  if (!ok) return;
  if (u.isAdmin && draft.filter(x => x.isAdmin).length <= 1) {
    await showModal({title: '\u524a\u9664\u3067\u304d\u307e\u305b\u3093', body: '\u5c11\u306a\u304f\u3068\u30821\u4eba\u306e\u7ba1\u7406\u8005\u304c\u5fc5\u8981\u3067\u3059', okText: 'OK', cancelText: ''});
    return;
  }
  draft.splice(idx, 1);
  markUsersDirty();
  renderUsersModal();
}

// ----- CSV COLUMNS VIEW -----
export function renderCsvColumns() {
  const targets = [
    {el: document.getElementById('csv-columns'), count: document.getElementById('csv-column-count')},
    {el: document.getElementById('dims-csv-columns'), count: document.getElementById('dims-csv-column-count')},
  ].filter(t => t.el);
  if (!targets.length) return;
  if (!S.RAW.length) {
    const empty = '<div class="preset-empty">CSV\u304c\u8aad\u307f\u8fbc\u307e\u308c\u3066\u3044\u307e\u305b\u3093\u3002\u30d8\u30c3\u30c0\u30fc\u53f3\u4e0a\u306e\u300cCSV\u8aad\u307f\u8fbc\u307f\u300d\u304b\u3089\u8aad\u307f\u8fbc\u3080\u3068\u3053\u3053\u306b\u30ab\u30e9\u30e0\u4e00\u89a7\u304c\u8868\u793a\u3055\u308c\u307e\u3059\u3002</div>';
    targets.forEach(t => { t.el.innerHTML = empty; if (t.count) t.count.textContent = ''; });
    return;
  }
  const columns = Object.keys(S.RAW[0]);
  targets.forEach(t => { if (t.count) t.count.textContent = `${columns.length}\u30ab\u30e9\u30e0 \u00d7 ${S.RAW.length.toLocaleString()}\u884c`; });
  const items = columns.map(col => {
    const vals = [];
    const seen = new Set();
    for (const r of S.RAW) {
      const v = r[col];
      if (v == null || v === '' || seen.has(v)) continue;
      seen.add(v);
      vals.push(v);
      if (vals.length >= 5) break;
    }
    const isNumeric = vals.slice(0, 10).every(v => !isNaN(Number(v)) && v !== '');
    const kind = isNumeric ? '\u6570\u5024' : '\u6587\u5b57\u5217';
    return `<div class="csv-col-row">
      <div class="csv-col-head">
        <code class="csv-col-name">${escapeHtml(col)}</code>
        <span class="csv-col-kind">${kind}</span>
      </div>
      <div class="csv-col-sample">\u4f8b: ${vals.length ? vals.map(v => `<span>${escapeHtml(String(v).slice(0, 30))}</span>`).join(' / ') : escapeHtml(String(S.RAW[0][col] || ''))}</div>
    </div>`;
  }).join('');
  targets.forEach(t => { t.el.innerHTML = items; });
}

// ----- METRICS VIEW -----
function renderMetricsDoc() {
  const el = document.getElementById('metrics-doc');
  if (!el) return;
  const defs = S.METRIC_DEFS_DRAFT || S.METRIC_DEFS;
  const baseSrc = S.METRICS_DRAFT_BASE || S.BASE_FORMULAS;
  const derivedSrc = S.METRICS_DRAFT || S.METRIC_FORMULAS;
  const fmtOptions = [{v:'int', l:'\u6574\u6570'}, {v:'yen', l:'\u00a5\u91d1\u984d'}, {v:'pct', l:'%\u5272\u5408'}];
  const renderRow = (m, i) => {
    const formula = m.type === 'base'
      ? (baseSrc[m.key] || DEFAULT_BASE_FORMULAS[m.key] || '')
      : (derivedSrc[m.key] || DEFAULT_FORMULAS[m.key] || '');
    return `<div class="metrics-doc-row" data-def-idx="${i}">
      <div class="metrics-doc-row-head">
        <div class="field-col"><label class="field-label">\u540d\u79f0</label><input type="text" class="metric-label-input" data-def-label value="${escapeHtml(m.label)}" placeholder="\u8868\u793a\u540d"></div>
        <div class="field-col"><label class="field-label">\u30ad\u30fc</label><input type="text" class="metric-key-input" data-def-key value="${escapeHtml(m.key)}" placeholder="key"></div>
        <div class="field-col"><label class="field-label">\u66f8\u5f0f</label><select class="metric-fmt-select" data-def-fmt>
          ${fmtOptions.map(o => `<option value="${o.v}"${m.fmt===o.v?' selected':''}>${o.l}</option>`).join('')}
        </select></div>
        <button type="button" class="metric-del" data-def-remove="${i}" title="\u524a\u9664">\u00d7</button>
      </div>
      <label class="field-label">\u8a08\u7b97\u5f0f</label>
      <input type="text" class="metric-formula-input" data-def-formula="${i}" value="${escapeHtml(formula)}" placeholder="${m.type==='base'?"sum(column) where funnel = '\u5e83\u544a'":'ad_cost / clicks'}">
    </div>`;
  };
  const baseRows = defs.map((m, i) => ({m, i})).filter(x => x.m.type === 'base');
  const derivedRows = defs.map((m, i) => ({m, i})).filter(x => x.m.type === 'derived');
  el.innerHTML = `
    <div class="metrics-doc-box">
      <div class="metrics-doc-section"><span>\u57fa\u790e\u30e1\u30c8\u30ea\u30af\u30b9</span></div>
      ${baseRows.map(x => renderRow(x.m, x.i)).join('') || '<div class="preset-empty">\u57fa\u790e\u30e1\u30c8\u30ea\u30af\u30b9\u304c\u3042\u308a\u307e\u305b\u3093</div>'}
      <button type="button" class="metrics-add-btn admin-only" data-add-type="base">+ \u57fa\u790e\u30e1\u30c8\u30ea\u30af\u30b9\u3092\u8ffd\u52a0</button>
    </div>
    <div class="metrics-doc-box">
      <div class="metrics-doc-section"><span>\u6d3e\u751f\u30e1\u30c8\u30ea\u30af\u30b9</span></div>
      ${derivedRows.map(x => renderRow(x.m, x.i)).join('') || '<div class="preset-empty">\u6d3e\u751f\u30e1\u30c8\u30ea\u30af\u30b9\u304c\u3042\u308a\u307e\u305b\u3093</div>'}
      <button type="button" class="metrics-add-btn admin-only" data-add-type="derived">+ \u6d3e\u751f\u30e1\u30c8\u30ea\u30af\u30b9\u3092\u8ffd\u52a0</button>
    </div>
  `;
}

// ----- FILTERS VIEW -----
function renderFiltersDoc() {
  const el = document.getElementById('filters-doc');
  if (!el) return;
  const defs = S.FILTER_DEFS_DRAFT || S.FILTER_DEFS;
  const typeOpts = [
    {v: 'date_from', l: '\u958b\u59cb\u65e5 (>=)'},
    {v: 'date_to',   l: '\u7d42\u4e86\u65e5 (<=)'},
    {v: 'multi',     l: '\u8907\u6570\u9078\u629e'},
  ];
  el.innerHTML = `
    <div class="metrics-doc-box">
      ${defs.map((f, i) => `
        <div class="metrics-doc-row" data-filter-idx="${i}">
          <div class="metrics-doc-row-head">
            <div class="field-col"><label class="field-label">\u540d\u79f0</label><input type="text" class="metric-label-input" data-filter-label value="${escapeHtml(f.label)}" placeholder="\u8868\u793a\u540d"></div>
            <div class="field-col"><label class="field-label">CSV\u30ab\u30e9\u30e0</label><input type="text" class="metric-key-input" data-filter-field value="${escapeHtml(f.field)}" placeholder="CSV\u30ab\u30e9\u30e0\u540d"></div>
            <div class="field-col"><label class="field-label">\u7a2e\u985e</label><select class="metric-fmt-select" data-filter-type>
              ${typeOpts.map(o => `<option value="${o.v}"${f.type===o.v?' selected':''}>${o.l}</option>`).join('')}
            </select></div>
            <button type="button" class="metric-del" data-filter-remove="${i}" title="\u524a\u9664">\u00d7</button>
          </div>
        </div>
      `).join('') || '<div class="preset-empty">\u30d5\u30a3\u30eb\u30bf\u304c\u3042\u308a\u307e\u305b\u3093</div>'}
      <button type="button" class="metrics-add-btn" id="filters-add-btn">+ \u30d5\u30a3\u30eb\u30bf\u3092\u8ffd\u52a0</button>
    </div>
  `;
}

// ----- DIMENSIONS VIEW -----
function renderDimsDoc() {
  const el = document.getElementById('dims-doc');
  if (!el) return;
  const defs = S.DIMENSIONS_DRAFT || [];
  const typeOpts = [
    {v: 'value',      l: '\u305d\u306e\u307e\u307e\u5024'},
    {v: 'date',       l: '\u65e5\u4ed8'},
    {v: 'month',      l: '\u6708 (YYYY-MM)'},
    {v: 'dow',        l: '\u66dc\u65e5'},
    {v: 'expression', l: '\u8a08\u7b97\u5f0f'},
  ];
  el.innerHTML = `
    <div class="metrics-doc-box">
      ${defs.map((d, i) => {
        const isExpr = d.type === 'expression';
        return `
        <div class="metrics-doc-row dim-row" data-dim-idx="${i}">
          <div class="dim-row-head">
            <div class="field-col"><label class="field-label">\u540d\u79f0</label><input type="text" class="metric-label-input" data-dim-label value="${escapeHtml(d.label)}" placeholder="\u8868\u793a\u540d"></div>
            <button type="button" class="metric-del" data-dim-remove="${i}" title="\u524a\u9664">\u00d7</button>
          </div>
          <div class="dim-row-grid">
            <div class="dim-field">
              <label>\u7a2e\u985e</label>
              <select class="dim-type-select" data-dim-type>
                ${typeOpts.map(o => `<option value="${o.v}"${d.type===o.v?' selected':''}>${o.l}</option>`).join('')}
              </select>
            </div>
            <div class="dim-field dim-field-source">
              <label>${isExpr ? '\u8a08\u7b97\u5f0f' : 'CSV\u30ab\u30e9\u30e0'}</label>
              ${isExpr
                ? `<input type="text" class="metric-formula-input" data-dim-expr value="${escapeHtml(d.expression || '')}" placeholder="\u4f8b: r.operator + ' / ' + r.media">`
                : `<input type="text" class="metric-key-input wide" data-dim-field value="${escapeHtml(d.field || '')}" placeholder="CSV\u30ab\u30e9\u30e0\u540d">`}
            </div>
          </div>
        </div>`;
      }).join('') || '<div class="preset-empty">\u30c7\u30a3\u30e1\u30f3\u30b7\u30e7\u30f3\u304c\u3042\u308a\u307e\u305b\u3093</div>'}
      <button type="button" class="metrics-add-btn" id="dims-add-btn">+ \u30c7\u30a3\u30e1\u30f3\u30b7\u30e7\u30f3\u3092\u8ffd\u52a0</button>
    </div>
  `;
}

// ----- DEFAULTS VIEW -----
function renderDefaultsDoc() {
  const el = document.getElementById('defaults-doc');
  if (!el) return;
  const defs = S.VIEWS_DRAFT || [];
  const presets = getPresets();
  el.innerHTML = `
    <div class="metrics-doc-box">
      ${defs.map((v, i) => `
        <div class="metrics-doc-row defaults-row" data-view-idx="${i}">
          <div class="defaults-row-head">
            <div class="field-col"><label class="field-label">\u540d\u79f0</label><input type="text" class="metric-label-input" data-view-label value="${escapeHtml(v.label)}" placeholder="\u30bf\u30d6\u540d"></div>
            <button type="button" class="metric-del" data-view-remove="${i}" title="\u524a\u9664">\u00d7</button>
          </div>
          <div class="defaults-row-preset">
            <label class="defaults-row-label">\u9069\u7528\u30d7\u30ea\u30bb\u30c3\u30c8</label>
            <select class="defaults-preset-select" data-view-preset>
              ${v.presetName ? '' : '<option value="">\u2014 \u4fdd\u5b58\u6642\u306b\u30bf\u30d6\u540d\u3067\u81ea\u52d5\u4f5c\u6210 \u2014</option>'}
              ${presets.map(p => `<option value="${escapeHtml(p.name)}"${v.presetName===p.name?' selected':''}>${p.builtin?'[\u6a19\u6e96] ':''}${escapeHtml(p.name)}</option>`).join('')}
            </select>
          </div>
        </div>
      `).join('') || '<div class="preset-empty">\u30c7\u30d5\u30a9\u30eb\u30c8\u30bf\u30d6\u304c\u3042\u308a\u307e\u305b\u3093</div>'}
      <button type="button" class="metrics-add-btn" id="defaults-add-btn">+ \u6a19\u6e96\u30bf\u30d6\u3092\u8ffd\u52a0</button>
    </div>
  `;
}

// ===== setupSettingsEvents =====
export function setupSettingsEvents() {
  // ----- LOGIN -----
  document.getElementById('login-form').addEventListener('submit', e => {
    e.preventDefault();
    const id = document.getElementById('login-id').value.trim();
    const pw = document.getElementById('login-pw').value;
    if (tryLogin(id, pw)) {
      hideLogin();
    } else {
      document.getElementById('login-error').classList.remove('hidden');
    }
  });
  document.getElementById('header-logout').addEventListener('click', async () => {
    const ok = await showModal({title: '\u30ed\u30b0\u30a2\u30a6\u30c8', body: '\u30ed\u30b0\u30a2\u30a6\u30c8\u3057\u307e\u3059\u304b\uff1f', okText: '\u30ed\u30b0\u30a2\u30a6\u30c8'});
    if (!ok) return;
    exitSettingsMode();
    logout();
  });

  // ----- SETTINGS NAV -----
  document.getElementById('open-settings').addEventListener('click', () => { if (hasPerm('manageUsers')) enterSettingsMode('users'); });
  document.getElementById('open-metrics-doc').addEventListener('click', () => { if (hasPerm('editMetrics')) enterSettingsMode('metrics'); });
  document.getElementById('open-filters-doc').addEventListener('click', () => { if (hasPerm('editFilters')) enterSettingsMode('filters'); });
  document.getElementById('open-defaults-doc').addEventListener('click', () => { if (hasPerm('editDefaults')) enterSettingsMode('defaults'); });
  document.getElementById('open-dims-doc').addEventListener('click', () => { if (hasPerm('editDimensions')) enterSettingsMode('dims'); });

  // ----- DIMS HELP -----
  document.getElementById('dims-help-btn').addEventListener('click', async () => {
    const html = `
      <div class="ref-desc"><strong>\u30c7\u30a3\u30e1\u30f3\u30b7\u30e7\u30f3\u8a08\u7b97\u5f0f\u306f JavaScript\u5f0f\u30d9\u30fc\u30b9</strong>\u3067\u3059\u3002\u884c\u30aa\u30d6\u30b8\u30a7\u30af\u30c8 <code>r</code> \u3092\u53c2\u7167\u3057\u3066\u4efb\u610f\u306eJS\u5f0f\u3092\u66f8\u3051\u307e\u3059\u3002</div>
      <div class="ref-section-title">\u7a2e\u985e\u306e\u610f\u5473</div>
      <div class="ref-syntax">
        <code>\u305d\u306e\u307e\u307e\u5024</code> \u2014 CSV\u30ab\u30e9\u30e0\u306e\u5024\u3092\u305d\u306e\u307e\u307e\u4f7f\u3046<br>
        <code>\u65e5\u4ed8</code> \u2014 \u65e5\u4ed8\u3068\u3057\u3066\u6271\u3046\uff08YYYY-MM-DD)<br>
        <code>\u6708 (YYYY-MM)</code> \u2014 \u65e5\u4ed8\u306e\u5148\u982d7\u6587\u5b57\u3092\u62bd\u51fa<br>
        <code>\u66dc\u65e5</code> \u2014 \u65e5\u4ed8\u304b\u3089\u66dc\u65e5(\u65e5/\u6708/\u706b/...)\u306b\u5909\u63db<br>
        <code>\u8a08\u7b97\u5f0f</code> \u2014 \u4efb\u610f\u306eJS\u5f0f\u3067\u884c\u304b\u3089\u5024\u3092\u7b97\u51fa
      </div>
      <div class="ref-section-title">\u8a08\u7b97\u5f0f\u3067\u4f7f\u3048\u308b\u8981\u7d20</div>
      <div class="metrics-doc-info-grid">
        <div><code>r.\u30ab\u30e9\u30e0\u540d</code> \u884c\u304b\u3089\u5024\u3092\u53d6\u5f97</div>
        <div><code>+</code> \u6587\u5b57\u5217\u7d50\u5408 / \u52a0\u7b97</div>
        <div><code>( )</code> \u512a\u5148\u9806\u4f4d</div>
        <div><code>x > 0 ? 'A' : 'B'</code> \u6761\u4ef6\u5206\u5c90</div>
        <div><code>String(r.x).slice(0,7)</code> \u6587\u5b57\u5217\u5207\u51fa</div>
        <div><code>r.x.toUpperCase()</code> \u5927\u6587\u5b57\u5316</div>
        <div><code>Number(r.x)</code> \u6570\u5024\u5909\u63db</div>
        <div><code>r.x ?? '\u4e0d\u660e'</code> null\u57cb\u3081</div>
      </div>
      <div class="ref-desc">
        <code>r</code> \u306fCSV\u306e1\u884c\u5206\u306e\u30aa\u30d6\u30b8\u30a7\u30af\u30c8\u3002<code>r.operator</code> \u306e\u3088\u3046\u306bCSV\u30ab\u30e9\u30e0\u540d\u3067\u5024\u3092\u53c2\u7167\u3067\u304d\u307e\u3059\u3002
      </div>
      <div class="ref-section-title">\u8a08\u7b97\u5f0f\u306e\u4f8b</div>
      <div class="ref-syntax">
        <code>r.operator + ' / ' + r.media</code> \u2192 "\u4ee3\u7406\u5e97A / Meta"<br>
        <code>r.funnel === '\u5e83\u544a' ? '\u5e83\u544a' : 'CV'</code> \u2192 "\u5e83\u544a" \u307e\u305f\u306f "CV"<br>
        <code>String(r.action_date).slice(0, 4)</code> \u2192 "2024"\uff08\u5e74\u306e\u307f\uff09<br>
        <code>r.clicks > 100 ? '\u9ad8' : '\u4f4e'</code> \u2192 "\u9ad8" or "\u4f4e"
      </div>
      <div class="ref-desc">\u30a8\u30e9\u30fc\u6642\u3084\u672a\u5b9a\u7fa9\u5024\u306e\u5834\u5408\u306f\u7a7a\u6587\u5b57\u306b\u306a\u308a\u307e\u3059\u3002\u5909\u66f4\u306f\u300c\u5909\u66f4\u3092\u4fdd\u5b58\u300d\u30dc\u30bf\u30f3\u3067\u78ba\u5b9a\u3057\u3001\u5168\u30bf\u30d6\u306b\u53cd\u6620\u3055\u308c\u307e\u3059\u3002</div>
    `;
    await showModal({title: '\u30c7\u30a3\u30e1\u30f3\u30b7\u30e7\u30f3\u5b9a\u7fa9\u306e\u4f7f\u3044\u65b9', body: html, html: true, wide: true, okText: '\u9589\u3058\u308b', cancelText: ''});
  });

  // ----- DIMS DOC EVENTS -----
  document.getElementById('dims-doc').addEventListener('input', e => {
    if (!hasPerm('editDimensions')) return;
    const row = e.target.closest('[data-dim-idx]');
    if (!row) return;
    const idx = +row.dataset.dimIdx;
    const defs = S.DIMENSIONS_DRAFT || [];
    const def = defs[idx];
    if (!def) return;
    if (e.target.matches('[data-dim-label]')) def.label = e.target.value;
    else if (e.target.matches('[data-dim-field]')) def.field = e.target.value;
    else if (e.target.matches('[data-dim-expr]')) def.expression = e.target.value;
    markDimsDirty();
  });
  document.getElementById('dims-doc').addEventListener('change', e => {
    if (!hasPerm('editDimensions')) return;
    const row = e.target.closest('[data-dim-idx]');
    if (!row) return;
    const idx = +row.dataset.dimIdx;
    const defs = S.DIMENSIONS_DRAFT || [];
    const def = defs[idx];
    if (!def) return;
    if (e.target.matches('[data-dim-type]')) {
      def.type = e.target.value;
      markDimsDirty();
      renderDimsDoc();
    }
  });
  document.getElementById('dims-doc').addEventListener('click', async e => {
    if (!hasPerm('editDimensions')) return;
    if (e.target.closest('#dims-add-btn')) {
      const defs = S.DIMENSIONS_DRAFT || [];
      let n = 1;
      let key = 'dim' + n;
      while (defs.some(d => d.key === key)) { n++; key = 'dim' + n; }
      defs.push({key, label: '\u65b0\u898f\u30c7\u30a3\u30e1\u30f3\u30b7\u30e7\u30f3', field: '', type: 'value'});
      markDimsDirty();
      renderDimsDoc();
      return;
    }
    const rm = e.target.closest('[data-dim-remove]');
    if (rm) {
      const idx = +rm.dataset.dimRemove;
      const defs = S.DIMENSIONS_DRAFT || [];
      const def = defs[idx];
      if (!def) return;
      const ok = await showModal({title: '\u30c7\u30a3\u30e1\u30f3\u30b7\u30e7\u30f3\u3092\u524a\u9664', body: `\u300c${def.label || def.key}\u300d\u3092\u524a\u9664\u3057\u307e\u3059\u304b\uff1f`, okText: '\u524a\u9664', danger: true});
      if (!ok) return;
      defs.splice(idx, 1);
      markDimsDirty();
      renderDimsDoc();
    }
  });
  document.getElementById('dims-save-btn').addEventListener('click', async () => {
    if (!hasPerm('editDimensions')) return;
    const defs = S.DIMENSIONS_DRAFT || [];
    const keys = defs.map(d => d.key);
    if (keys.some(k => !k)) { await showModal({title: '\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093', body: '\u7a7a\u306e\u30ad\u30fc\u304c\u3042\u308a\u307e\u3059', okText: 'OK', cancelText: ''}); return; }
    if (new Set(keys).size !== keys.length) { await showModal({title: '\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093', body: '\u30ad\u30fc\u304c\u91cd\u8907\u3057\u3066\u3044\u307e\u3059', okText: 'OK', cancelText: ''}); return; }
    for (const d of defs) {
      if (d.type === 'expression') {
        if (!d.expression) { await showModal({title: '\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093', body: `\u300c${d.label || d.key}\u300d\u306e\u8a08\u7b97\u5f0f\u304c\u7a7a\u3067\u3059`, okText: 'OK', cancelText: ''}); return; }
        try { new Function('r', `"use strict"; return (${d.expression})`); }
        catch (err) { await showModal({title: '\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093', body: `\u300c${d.label || d.key}\u300d\u306e\u8a08\u7b97\u5f0f\u306b\u69cb\u6587\u30a8\u30e9\u30fc\u304c\u3042\u308a\u307e\u3059`, okText: 'OK', cancelText: ''}); return; }
      } else {
        if (!d.field) { await showModal({title: '\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093', body: `\u300c${d.label || d.key}\u300d\u306eCSV\u30ab\u30e9\u30e0\u540d\u304c\u7a7a\u3067\u3059`, okText: 'OK', cancelText: ''}); return; }
      }
    }
    const ok = await showModal({title: '\u30c7\u30a3\u30e1\u30f3\u30b7\u30e7\u30f3\u5b9a\u7fa9\u3092\u4fdd\u5b58', body: '\u5909\u66f4\u5185\u5bb9\u3092\u4fdd\u5b58\u3057\u307e\u3059\u304b\uff1f', okText: '\u4fdd\u5b58'});
    if (!ok) return;
    S.DIMENSIONS = JSON.parse(JSON.stringify(defs));
    S.DIM_EXPR_CACHE.clear();
    saveDimensions();
    const validKeys = new Set(S.DIMENSIONS.map(d => d.key));
    S.SELECTED_DIMS = S.SELECTED_DIMS.filter(k => validKeys.has(k));
    clearDimsDirty();
    emit('renderChips');
    emit('render');
    await showModal({title: '\u4fdd\u5b58\u5b8c\u4e86', body: '\u30c7\u30a3\u30e1\u30f3\u30b7\u30e7\u30f3\u5b9a\u7fa9\u3092\u4fdd\u5b58\u3057\u307e\u3057\u305f', okText: 'OK', cancelText: ''});
  });

  // ----- DEFAULTS DOC EVENTS -----
  document.getElementById('defaults-doc').addEventListener('input', e => {
    if (!hasPerm('editDefaults')) return;
    const row = e.target.closest('[data-view-idx]');
    if (!row) return;
    const idx = +row.dataset.viewIdx;
    const defs = S.VIEWS_DRAFT || [];
    const def = defs[idx];
    if (!def) return;
    if (e.target.matches('[data-view-label]')) def.label = e.target.value;
    markDefaultsDirty();
  });
  document.getElementById('defaults-doc').addEventListener('change', e => {
    if (!hasPerm('editDefaults')) return;
    const row = e.target.closest('[data-view-idx]');
    if (!row) return;
    const idx = +row.dataset.viewIdx;
    const defs = S.VIEWS_DRAFT || [];
    const def = defs[idx];
    if (!def) return;
    if (e.target.matches('[data-view-preset]')) {
      def.presetName = e.target.value;
      markDefaultsDirty();
    }
  });
  document.getElementById('defaults-doc').addEventListener('click', async e => {
    if (!hasPerm('editDefaults')) return;
    if (e.target.closest('#defaults-add-btn')) {
      const defs = S.VIEWS_DRAFT || [];
      const key = 'view_' + Date.now();
      const existingLabels = new Set(defs.map(v => v.label));
      let label = '\u65b0\u898f\u30bf\u30d6';
      let n = 2;
      while (existingLabels.has(label)) { label = `\u65b0\u898f\u30bf\u30d6 ${n++}`; }
      defs.push({key, label, dims: ['action_date'], filterExpr: '', presetName: ''});
      markDefaultsDirty();
      renderDefaultsDoc();
      return;
    }
    const rm = e.target.closest('[data-view-remove]');
    if (rm) {
      const idx = +rm.dataset.viewRemove;
      const defs = S.VIEWS_DRAFT || [];
      const def = defs[idx];
      if (!def) return;
      const ok = await showModal({title: '\u6a19\u6e96\u5b9a\u7fa9\u3092\u524a\u9664', body: `\u300c${def.label || def.key}\u300d\u3092\u524a\u9664\u3057\u307e\u3059\u304b\uff1f`, okText: '\u524a\u9664', danger: true});
      if (!ok) return;
      defs.splice(idx, 1);
      markDefaultsDirty();
      renderDefaultsDoc();
    }
  });
  document.getElementById('defaults-save-btn').addEventListener('click', async () => {
    if (!hasPerm('editDefaults')) return;
    const defs = S.VIEWS_DRAFT || [];
    const keys = defs.map(v => v.key);
    if (keys.some(k => !k)) { await showModal({title: '\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093', body: '\u7a7a\u306e\u30ad\u30fc\u304c\u3042\u308a\u307e\u3059', okText: 'OK', cancelText: ''}); return; }
    if (new Set(keys).size !== keys.length) { await showModal({title: '\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093', body: '\u30ad\u30fc\u304c\u91cd\u8907\u3057\u3066\u3044\u307e\u3059', okText: 'OK', cancelText: ''}); return; }
    const ok = await showModal({title: '\u6a19\u6e96\u5b9a\u7fa9\u3092\u4fdd\u5b58', body: '\u5909\u66f4\u5185\u5bb9\u3092\u4fdd\u5b58\u3057\u307e\u3059\u304b\uff1f', okText: '\u4fdd\u5b58'});
    if (!ok) return;
    defs.forEach(v => {
      if (!v.presetName) {
        v.presetName = createBuiltinPresetFor(v.label || '\u65b0\u898f\u30bf\u30d6');
      }
    });
    const next = {};
    defs.forEach(v => {
      next[v.key] = {
        label: v.label,
        dims: Array.isArray(v.dims) ? [...v.dims] : ['action_date'],
        filterExpr: v.filterExpr || null,
        filter: compileFilter(v.filterExpr),
        presetName: v.presetName,
      };
    });
    S.VIEWS = next;
    saveViews();
    S.VIEW_ORDER = S.VIEW_ORDER.filter(k => S.VIEWS[k]);
    Object.keys(S.VIEWS).forEach(k => { if (!S.VIEW_ORDER.includes(k)) S.VIEW_ORDER.push(k); });
    saveViewOrder();
    if (!S.VIEWS[S.CURRENT_VIEW] && !S.CUSTOM_TABS.some(t => t.key === S.CURRENT_VIEW)) {
      S.CURRENT_VIEW = S.VIEW_ORDER[0] || 'summary_daily';
    }
    const referenced = new Set(Object.values(S.VIEWS).map(v => v.presetName));
    const initLabels = new Set(Object.values(S.DEFAULT_VIEWS_INIT || {}).map(v => v.label));
    const cleaned = getPresets().filter(p => {
      if (!p.builtin) return true;
      if (initLabels.has(p.name)) return true;
      return referenced.has(p.name);
    });
    setPresets(cleaned);
    renderPresets();
    renderTabPresetSelect();
    clearDefaultsDirty();
    renderViewNav();
    await showModal({title: '\u4fdd\u5b58\u5b8c\u4e86', body: '\u6a19\u6e96\u5b9a\u7fa9\u3092\u4fdd\u5b58\u3057\u307e\u3057\u305f', okText: 'OK', cancelText: ''});
  });

  // ----- FILTERS DOC EVENTS -----
  document.getElementById('filters-doc').addEventListener('input', e => {
    if (!hasPerm('editFilters')) return;
    const row = e.target.closest('[data-filter-idx]');
    if (!row) return;
    const idx = +row.dataset.filterIdx;
    const defs = S.FILTER_DEFS_DRAFT || S.FILTER_DEFS;
    const def = defs[idx];
    if (!def) return;
    if (e.target.matches('[data-filter-label]')) def.label = e.target.value;
    else if (e.target.matches('[data-filter-field]')) def.field = e.target.value;
    markFiltersDirty();
  });
  document.getElementById('filters-doc').addEventListener('change', e => {
    if (!hasPerm('editFilters')) return;
    const row = e.target.closest('[data-filter-idx]');
    if (!row) return;
    const idx = +row.dataset.filterIdx;
    const defs = S.FILTER_DEFS_DRAFT || S.FILTER_DEFS;
    const def = defs[idx];
    if (!def) return;
    if (e.target.matches('[data-filter-type]')) {
      def.type = e.target.value;
      markFiltersDirty();
    }
  });
  document.getElementById('filters-doc').addEventListener('click', async e => {
    if (!hasPerm('editFilters')) return;
    if (e.target.closest('#filters-add-btn')) {
      const defs = S.FILTER_DEFS_DRAFT || S.FILTER_DEFS;
      let n = 1;
      let id = 'filter' + n;
      while (defs.some(f => f.id === id)) { n++; id = 'filter' + n; }
      defs.push({id, type: 'multi', field: '', label: '\u65b0\u898f\u30d5\u30a3\u30eb\u30bf'});
      markFiltersDirty();
      renderFiltersDoc();
      return;
    }
    const rm = e.target.closest('[data-filter-remove]');
    if (rm) {
      const idx = +rm.dataset.filterRemove;
      const defs = S.FILTER_DEFS_DRAFT || S.FILTER_DEFS;
      const def = defs[idx];
      if (!def) return;
      const ok = await showModal({title: '\u30d5\u30a3\u30eb\u30bf\u3092\u524a\u9664', body: `\u300c${def.label || def.id}\u300d\u3092\u524a\u9664\u3057\u307e\u3059\u304b\uff1f`, okText: '\u524a\u9664', danger: true});
      if (!ok) return;
      defs.splice(idx, 1);
      markFiltersDirty();
      renderFiltersDoc();
    }
  });
  document.getElementById('filters-save-btn').addEventListener('click', async () => {
    if (!hasPerm('editFilters')) return;
    const defs = S.FILTER_DEFS_DRAFT || S.FILTER_DEFS;
    if (defs.some(f => !f.field)) {
      await showModal({title: '\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093', body: 'CSV\u30ab\u30e9\u30e0\u540d\u304c\u7a7a\u306e\u30d5\u30a3\u30eb\u30bf\u304c\u3042\u308a\u307e\u3059', okText: 'OK', cancelText: ''});
      return;
    }
    const ok = await showModal({title: '\u30d5\u30a3\u30eb\u30bf\u3092\u4fdd\u5b58', body: '\u5909\u66f4\u5185\u5bb9\u3092\u4fdd\u5b58\u3057\u307e\u3059\u304b\uff1f', okText: '\u4fdd\u5b58'});
    if (!ok) return;
    S.FILTER_DEFS = JSON.parse(JSON.stringify(defs));
    saveFilterDefs();
    for (const k of Object.keys(S.FILTER_VALUES)) delete S.FILTER_VALUES[k];
    renderFilters();
    clearFiltersDirty();
    emit('render');
    await showModal({title: '\u4fdd\u5b58\u5b8c\u4e86', body: '\u30d5\u30a3\u30eb\u30bf\u5b9a\u7fa9\u3092\u4fdd\u5b58\u3057\u307e\u3057\u305f', okText: 'OK', cancelText: ''});
  });

  // ----- METRICS DOC EVENTS -----
  document.getElementById('metrics-doc').addEventListener('input', e => {
    if (!hasPerm("editMetrics")) return;
    const row = e.target.closest('[data-def-idx]');
    if (!row) return;
    const idx = +row.dataset.defIdx;
    const defs = S.METRIC_DEFS_DRAFT || S.METRIC_DEFS;
    const def = defs[idx];
    if (!def) return;
    if (e.target.matches('[data-def-label]')) def.label = e.target.value;
    else if (e.target.matches('[data-def-key]')) def.key = e.target.value;
    else if (e.target.matches('[data-def-fmt]')) def.fmt = e.target.value;
    else if (e.target.matches('[data-def-formula]')) {
      const k = def.key;
      if (def.type === 'base') {
        if (!S.METRICS_DRAFT_BASE) S.METRICS_DRAFT_BASE = {...S.BASE_FORMULAS};
        S.METRICS_DRAFT_BASE[k] = e.target.value;
      } else {
        if (!S.METRICS_DRAFT) S.METRICS_DRAFT = {...S.METRIC_FORMULAS};
        S.METRICS_DRAFT[k] = e.target.value;
      }
    }
    markMetricsDirty();
  });
  document.getElementById('metrics-doc').addEventListener('click', async e => {
    if (!hasPerm("editMetrics")) return;
    const rm = e.target.closest('[data-def-remove]');
    if (rm) {
      const idx = +rm.dataset.defRemove;
      const defs = S.METRIC_DEFS_DRAFT || S.METRIC_DEFS;
      const def = defs[idx];
      if (!def) return;
      const ok = await showModal({title: '\u30e1\u30c8\u30ea\u30af\u30b9\u3092\u524a\u9664', body: `\u300c${def.label || def.key}\u300d\u3092\u524a\u9664\u3057\u307e\u3059\u304b\uff1f\uff08\u4fdd\u5b58\u30dc\u30bf\u30f3\u307e\u3067\u78ba\u5b9a\u3055\u308c\u307e\u305b\u3093\uff09`, okText: '\u524a\u9664', danger: true});
      if (!ok) return;
      defs.splice(idx, 1);
      markMetricsDirty();
      renderMetricsDoc();
      return;
    }
    const add = e.target.closest('[data-add-type]');
    if (add) {
      const type = add.dataset.addType;
      const defs = S.METRIC_DEFS_DRAFT || S.METRIC_DEFS;
      let base = 'metric';
      let n = 1;
      let newKey = base + n;
      while (defs.some(d => d.key === newKey)) { n++; newKey = base + n; }
      defs.push({key: newKey, label: type === 'base' ? '\u65b0\u898f\u57fa\u790e' : '\u65b0\u898f\u6d3e\u751f', fmt: 'int', type});
      if (type === 'base') {
        if (!S.METRICS_DRAFT_BASE) S.METRICS_DRAFT_BASE = {...S.BASE_FORMULAS};
        S.METRICS_DRAFT_BASE[newKey] = "sum(amount) where funnel = ''";
      } else {
        if (!S.METRICS_DRAFT) S.METRICS_DRAFT = {...S.METRIC_FORMULAS};
        S.METRICS_DRAFT[newKey] = '0';
      }
      markMetricsDirty();
      renderMetricsDoc();
    }
  });
  document.getElementById('metrics-save-btn').addEventListener('click', async () => {
    if (!hasPerm("editMetrics")) return;
    const defs = S.METRIC_DEFS_DRAFT || S.METRIC_DEFS;
    const keys = defs.map(d => d.key);
    if (keys.some(k => !k)) {
      await showModal({title: '\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093', body: '\u7a7a\u306e\u30ad\u30fc\u304c\u3042\u308a\u307e\u3059', okText: 'OK', cancelText: ''});
      return;
    }
    if (new Set(keys).size !== keys.length) {
      await showModal({title: '\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093', body: '\u30ad\u30fc\u304c\u91cd\u8907\u3057\u3066\u3044\u307e\u3059', okText: 'OK', cancelText: ''});
      return;
    }
    for (const d of defs) {
      if (d.type === 'base') {
        const v = (S.METRICS_DRAFT_BASE || S.BASE_FORMULAS)[d.key] || '';
        if (!parseBaseFormula(v)) {
          await showModal({title: '\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093', body: `\u57fa\u790e\u30e1\u30c8\u30ea\u30af\u30b9\u300c${d.label || d.key}\u300d\u306e\u69cb\u6587\u304c\u4e0d\u6b63\u3067\u3059:\n${v}`, okText: 'OK', cancelText: ''});
          return;
        }
      }
    }
    const ok = await showModal({title: '\u30e1\u30c8\u30ea\u30af\u30b9\u3092\u4fdd\u5b58', body: '\u5909\u66f4\u5185\u5bb9\u3092\u4fdd\u5b58\u3057\u307e\u3059\u304b\uff1f\u5168\u30bf\u30d6\u306b\u53cd\u6620\u3055\u308c\u307e\u3059\u3002', okText: '\u4fdd\u5b58'});
    if (!ok) return;
    if (S.METRIC_DEFS_DRAFT) { S.METRIC_DEFS = JSON.parse(JSON.stringify(S.METRIC_DEFS_DRAFT)); saveMetricDefs(); }
    const validKeys = new Set(S.METRIC_DEFS.map(d => d.key));
    if (S.METRICS_DRAFT) {
      const next = {};
      for (const k of Object.keys(S.METRICS_DRAFT)) if (validKeys.has(k) && S.METRIC_DEFS.find(d => d.key === k && d.type === 'derived')) next[k] = S.METRICS_DRAFT[k];
      S.METRIC_FORMULAS = next;
      saveFormulas();
    }
    if (S.METRICS_DRAFT_BASE) {
      const next = {};
      for (const k of Object.keys(S.METRICS_DRAFT_BASE)) if (validKeys.has(k) && S.METRIC_DEFS.find(d => d.key === k && d.type === 'base')) next[k] = S.METRICS_DRAFT_BASE[k];
      S.BASE_FORMULAS = next;
      saveBaseFormulas();
    }
    clearMetricsDirty();
    emit('renderChips');
    emit('renderThresholds');
    renderViewNav();
    emit('render');
    await showModal({title: '\u4fdd\u5b58\u5b8c\u4e86', body: '\u30e1\u30c8\u30ea\u30af\u30b9\u3092\u4fdd\u5b58\u3057\u307e\u3057\u305f', okText: 'OK', cancelText: ''});
  });

  // ----- METRICS HELP -----
  document.getElementById('metrics-help-btn').addEventListener('click', async () => {
    const baseRows = [
      ['ad_cost',     "sum(amount_1) where funnel = '\u5e83\u544a'"],
      ['ad_cost_fee', "sum(amount_2) where funnel = '\u5e83\u544a'"],
      ['impression',  "sum(impression) where funnel = '\u5e83\u544a'"],
      ['reach',       "sum(reach) where funnel = '\u5e83\u544a'"],
      ['clicks',      "sum(clicks) where funnel = '\u5e83\u544a'"],
      ['mcv',         "sum(cv) where funnel = '\u5e83\u544a'"],
      ['line_reg',    "sum(ac_count) where funnel = 'LINE\u767b\u9332'"],
      ['answer',      "sum(ac_count) where funnel = '\u56de\u7b54'"],
      ['booking',     "sum(ac_count) where funnel = '\u4e88\u7d04'"],
      ['join',        "sum(ac_count) where funnel = '\u53c2\u52a0'"],
      ['deal',        "sum(ac_count) where funnel = '\u6210\u7d04'"],
      ['rev_first',   "sum(amount_1) where funnel = '\u6210\u7d04'"],
      ['rev_ltv',     "sum(amount_2) where funnel = '\u6210\u7d04'"],
    ];
    const html = `
      <div class="ref-desc"><strong>\u57fa\u790e\u30e1\u30c8\u30ea\u30af\u30b9\u306f\u7591\u4f3cSQL\u3001\u6d3e\u751f\u30e1\u30c8\u30ea\u30af\u30b9\u306fJavaScript\u5f0f</strong>\u3067\u66f8\u304d\u307e\u3059\u3002JS\u306e\u6f14\u7b97\u5b50\u30fb\u95a2\u6570\u30fb\u6761\u4ef6\u5206\u5c90\u304c\u305d\u306e\u307e\u307e\u4f7f\u3048\u307e\u3059\u3002</div>
      <div class="ref-section-title">\u6d3e\u751f\u30e1\u30c8\u30ea\u30af\u30b9\u3067\u4f7f\u3048\u308b\u8981\u7d20</div>
      <div class="metrics-doc-info-grid">
        <div><code>+ - * /</code> \u56db\u5247\u6f14\u7b97</div>
        <div><code>( )</code> \u512a\u5148\u9806\u4f4d</div>
        <div><code>min(a, b)</code> \u5c0f\u3055\u3044\u65b9</div>
        <div><code>max(a, b)</code> \u5927\u304d\u3044\u65b9</div>
        <div><code>abs(x)</code> \u7d76\u5bfe\u5024</div>
        <div><code>pow(x, n)</code> \u3079\u304d\u4e57</div>
        <div><code>sqrt(x)</code> \u5e73\u65b9\u6839</div>
        <div><code>x > 0 ? a : b</code> \u6761\u4ef6\u5206\u5c90</div>
      </div>
      <div class="ref-desc">\u5909\u6570\u306f\u57fa\u790e\u30e1\u30c8\u30ea\u30af\u30b9\u306e\u30ad\u30fc(\u4f8b: <code>ad_cost</code>, <code>clicks</code>)\u3002\u4ed6\u306e\u6d3e\u751f\u30e1\u30c8\u30ea\u30af\u30b9\u3082\u53c2\u7167\u53ef\u80fd\u30020\u9664\u7b97\u3084\u30a8\u30e9\u30fc\u6642\u306f\u81ea\u52d5\u7684\u306b 0 \u306b\u306a\u308a\u307e\u3059\u3002</div>
      <div class="ref-section-title">\u57fa\u790e\u30e1\u30c8\u30ea\u30af\u30b9\u306e\u96c6\u8a08\u69cb\u6587</div>
      <div class="ref-syntax"><code>sum(<em>column</em>)</code> \u2014 \u6307\u5b9a\u5217\u3092\u5408\u8a08<br><code>where <em>field</em> = <em>\u5024</em></code> \u2014 \u7d5e\u308a\u8fbc\u307f\u6761\u4ef6 (\u8907\u6570\u6761\u4ef6\u306f <code>and</code> \u3067\u9023\u7d50)</div>
      <table class="ref-table">
        <thead><tr><th>\u30ad\u30fc</th><th>\u30c7\u30d5\u30a9\u30eb\u30c8\u96c6\u8a08\u5f0f</th></tr></thead>
        <tbody>${baseRows.map(([k, f]) => `<tr><td><code>${k}</code></td><td><code>${escapeHtml(f)}</code></td></tr>`).join('')}</tbody>
      </table>
      <div class="ref-desc">\u5909\u66f4\u306f\u300c\u5909\u66f4\u3092\u4fdd\u5b58\u300d\u30dc\u30bf\u30f3\u3092\u62bc\u3057\u305f\u6642\u306e\u307f\u53cd\u6620\u3055\u308c\u3001\u5168\u30bf\u30d6\u306b\u81ea\u52d5\u9069\u7528\u3055\u308c\u307e\u3059\u3002</div>
    `;
    await showModal({title: '\u30e1\u30c8\u30ea\u30af\u30b9\u5b9a\u7fa9\u306e\u4f7f\u3044\u65b9', body: html, html: true, wide: true, okText: '\u9589\u3058\u308b', cancelText: ''});
  });

  // ----- USERS EVENTS -----
  document.getElementById('add-user-btn').addEventListener('click', addUser);
  document.getElementById('users-list').addEventListener('click', e => {
    const del = e.target.closest('[data-user-del]');
    if (del) removeUser(+del.dataset.userDel);
  });
  document.getElementById('users-list').addEventListener('input', e => {
    const row = e.target.closest('[data-user-idx]');
    if (!row) return;
    const idx = +row.dataset.userIdx;
    const draft = S.USERS_DRAFT || S.USERS;
    const u = draft[idx];
    if (!u) return;
    if (e.target.matches('[data-user-name]')) u.name = e.target.value;
    else if (e.target.matches('[data-user-id]')) u.id = e.target.value;
    else if (e.target.matches('[data-user-pw]')) u.password = e.target.value;
    else if (e.target.matches('[data-perm]')) u.perms[e.target.dataset.perm] = e.target.checked;
    else if (e.target.matches('[data-admin]')) u.isAdmin = e.target.checked;
    markUsersDirty();
  });
  document.getElementById('users-save-btn').addEventListener('click', async () => {
    if (!hasPerm('manageUsers')) return;
    if (!S.USERS_DRAFT) return;
    if (!S.USERS_DRAFT.some(u => u.isAdmin)) {
      await showModal({title: '\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093', body: '\u5c11\u306a\u304f\u3068\u30821\u4eba\u306e\u7ba1\u7406\u8005\u304c\u5fc5\u8981\u3067\u3059', okText: 'OK', cancelText: ''});
      return;
    }
    const ids = S.USERS_DRAFT.map(u => u.id);
    if (new Set(ids).size !== ids.length) {
      await showModal({title: '\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093', body: '\u30ed\u30b0\u30a4\u30f3ID\u304c\u91cd\u8907\u3057\u3066\u3044\u307e\u3059', okText: 'OK', cancelText: ''});
      return;
    }
    if (ids.some(id => !id)) {
      await showModal({title: '\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093', body: '\u30ed\u30b0\u30a4\u30f3ID\u304c\u7a7a\u306e\u30e6\u30fc\u30b6\u30fc\u304c\u3044\u307e\u3059', okText: 'OK', cancelText: ''});
      return;
    }
    const ok = await showModal({title: '\u30e6\u30fc\u30b6\u30fc\u60c5\u5831\u3092\u4fdd\u5b58', body: '\u5909\u66f4\u5185\u5bb9\u3092\u4fdd\u5b58\u3057\u307e\u3059\u304b\uff1f', okText: '\u4fdd\u5b58'});
    if (!ok) return;
    S.USERS = JSON.parse(JSON.stringify(S.USERS_DRAFT));
    saveUsers();
    if (!S.USERS.some(u => u.id === S.CURRENT_USER)) {
      logout();
      return;
    }
    renderCurrentUserLabel();
    applyPermissionUI();
    S.USERS_DRAFT = JSON.parse(JSON.stringify(S.USERS));
    clearUsersDirty();
    await showModal({title: '\u4fdd\u5b58\u5b8c\u4e86', body: '\u30e6\u30fc\u30b6\u30fc\u60c5\u5831\u3092\u4fdd\u5b58\u3057\u307e\u3057\u305f', okText: 'OK', cancelText: ''});
  });
}
