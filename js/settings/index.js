import { S } from '../state.js';
import { api } from '../api.js';
import { escapeHtml } from '../utils.js';
import { showModal } from '../modal.js';
import { hasPerm, logout } from '../auth.js';
import { renderPresets, exitPresetEdit } from '../presets.js';

import { settingsState } from './state.js';
import { renderUsersModal, setupUsersEvents, clearUsersDirty } from './users.js';
import { renderMetricsDoc, setupMetricsEvents, clearMetricsDirty } from './metrics.js';
import { renderFiltersDoc, setupFilterDefsEvents, clearFiltersDirty } from './filterDefs.js';
import { renderDimsDoc, setupDimensionsEvents, clearDimsDirty } from './dimensions.js';
import { renderDefaultsDoc, setupDefaultsEvents, clearDefaultsDirty } from './defaults.js';
import { loadGroupsAndRender, setupGroupsEvents } from './groups.js';

// ----- ENTER / EXIT SETTINGS MODE -----
export function enterSettingsMode(target = 'users') {
  document.body.classList.add('settings-mode');
  document.getElementById('settings-view').classList.toggle('hidden', target !== 'users');
  document.getElementById('metrics-doc-view').classList.toggle('hidden', target !== 'metrics');
  document.getElementById('filters-doc-view').classList.toggle('hidden', target !== 'filters');
  document.getElementById('dims-doc-view').classList.toggle('hidden', target !== 'dims');
  document.getElementById('defaults-doc-view').classList.toggle('hidden', target !== 'defaults');
  document.getElementById('presets-settings-view').classList.toggle('hidden', target !== 'presets');
  document.getElementById('groups-view').classList.toggle('hidden', target !== 'groups');
  // source-view（データソース画面）も設定系メニューに入った時は必ず隠す
  document.getElementById('source-view').classList.add('hidden');
  document.querySelectorAll('#view-nav .nav-item, #custom-nav .nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById('open-settings').classList.toggle('active', target === 'users');
  document.getElementById('open-metrics-doc').classList.toggle('active', target === 'metrics');
  document.getElementById('open-filters-doc').classList.toggle('active', target === 'filters');
  document.getElementById('open-dims-doc').classList.toggle('active', target === 'dims');
  document.getElementById('open-defaults-doc').classList.toggle('active', target === 'defaults');
  document.getElementById('open-presets-settings').classList.toggle('active', target === 'presets');
  document.getElementById('open-groups').classList.toggle('active', target === 'groups');
  exitPresetEdit();
  if (target === 'users') {
    settingsState.userDetailIdx = null;
    // Load users + groups concurrently (グループはプルダウン選択肢として必要)
    Promise.all([api.listUsers(), api.listGroups()]).then(([uRes, gRes]) => {
      S.USERS = uRes.users || [];
      settingsState.groupsCache = gRes.groups || [];
      S.USERS_DRAFT = JSON.parse(JSON.stringify(S.USERS));
      renderUsersModal();
    }).catch(e => console.warn('[users] load failed', e));
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
  } else if (target === 'presets') {
    S.USERS_DRAFT = null;
    S.METRICS_DRAFT = null;
    S.METRICS_DRAFT_BASE = null;
    S.METRIC_DEFS_DRAFT = null;
    S.FILTER_DEFS_DRAFT = null;
    S.VIEWS_DRAFT = null;
    S.DIMENSIONS_DRAFT = null;
    renderPresets();
  } else if (target === 'groups') {
    S.USERS_DRAFT = null;
    S.METRICS_DRAFT = null;
    S.METRICS_DRAFT_BASE = null;
    S.METRIC_DEFS_DRAFT = null;
    S.FILTER_DEFS_DRAFT = null;
    S.VIEWS_DRAFT = null;
    S.DIMENSIONS_DRAFT = null;
    loadGroupsAndRender();
  }
}

export function exitSettingsMode() {
  document.body.classList.remove('settings-mode');
  document.getElementById('source-view').classList.add('hidden');
  document.getElementById('settings-view').classList.add('hidden');
  document.getElementById('metrics-doc-view').classList.add('hidden');
  document.getElementById('filters-doc-view').classList.add('hidden');
  document.getElementById('dims-doc-view').classList.add('hidden');
  document.getElementById('defaults-doc-view').classList.add('hidden');
  document.getElementById('presets-settings-view').classList.add('hidden');
  document.getElementById('groups-view').classList.add('hidden');
  document.getElementById('open-settings').classList.remove('active');
  document.getElementById('open-metrics-doc').classList.remove('active');
  document.getElementById('open-filters-doc').classList.remove('active');
  document.getElementById('open-dims-doc').classList.remove('active');
  document.getElementById('open-defaults-doc').classList.remove('active');
  document.getElementById('open-presets-settings').classList.remove('active');
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

// ----- CSV COLUMNS VIEW -----
export function renderCsvColumns() {
  const targets = [
    {el: document.getElementById('csv-columns'), count: document.getElementById('csv-column-count')},
    {el: document.getElementById('dims-csv-columns'), count: document.getElementById('dims-csv-column-count')},
    {el: document.getElementById('filters-csv-columns'), count: document.getElementById('filters-csv-column-count')},
  ].filter(t => t.el);
  if (!targets.length) return;
  if (!S.RAW.length) {
    const empty = '<div class="preset-empty">CSVが読み込まれていません。ヘッダー右上の「CSV読み込み」から読み込むとここにカラム一覧が表示されます。</div>';
    targets.forEach(t => { t.el.innerHTML = empty; if (t.count) t.count.textContent = ''; });
    return;
  }
  const columns = Object.keys(S.RAW[0]);
  targets.forEach(t => { if (t.count) t.count.textContent = `${columns.length}カラム × ${S.RAW.length.toLocaleString()}行`; });
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
    const kind = isNumeric ? '数値' : '文字列';
    return `<div class="csv-col-row">
      <div class="csv-col-head">
        <code class="csv-col-name">${escapeHtml(col)}</code>
        <span class="csv-col-kind">${kind}</span>
      </div>
      <div class="csv-col-sample">例: ${vals.length ? vals.map(v => `<span>${escapeHtml(String(v).slice(0, 30))}</span>`).join(' / ') : escapeHtml(String(S.RAW[0][col] || ''))}</div>
    </div>`;
  }).join('');
  targets.forEach(t => { t.el.innerHTML = items; });
}

// ===== setupSettingsEvents =====
export function setupSettingsEvents() {
  // Login is now handled via Firebase Auth (see main.js -> signIn())
  document.getElementById('header-logout').addEventListener('click', async () => {
    const ok = await showModal({title: 'ログアウト', body: 'ログアウトしますか？', okText: 'ログアウト'});
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
  document.getElementById('open-presets-settings').addEventListener('click', () => enterSettingsMode('presets'));
  document.getElementById('open-groups').addEventListener('click', () => { if (hasPerm('manageGroups')) enterSettingsMode('groups'); });

  // ----- Sub-view event wiring -----
  setupGroupsEvents();
  setupDimensionsEvents();
  setupDefaultsEvents();
  setupFilterDefsEvents();
  setupMetricsEvents();
  setupUsersEvents();
}
