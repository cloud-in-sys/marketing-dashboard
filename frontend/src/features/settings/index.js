import { S } from '../../app/state.js';
import { api } from '../../api/index.js';
import { escapeHtml } from '../../shared/utils/utils.js';
import { showModal } from '../../shared/ui/modal.js';
import { hasPerm, getCurrentUser, logout } from '../../app/auth.js';
import { renderPresets, exitPresetEdit, isPresetEditDirty } from '../presets/presets.js';
import { abortInFlightAggregate } from '../../aggregate/aggregateBackend.js';
import { emit } from '../../app/events.js';

import { settingsState } from './state.js';
import { renderUsersModal, setupUsersEvents, clearUsersDirty } from './users/users.js';
import { renderMetricsDoc, setupMetricsEvents, clearMetricsDirty } from './metrics/metrics.js';
import { renderFiltersDoc, setupFilterDefsEvents, clearFiltersDirty } from './filters/filterDefs.js';
import { renderDimsDoc, setupDimensionsEvents, clearDimsDirty } from './dimensions/dimensions.js';
import { renderDefaultsDoc, setupDefaultsEvents, clearDefaultsDirty } from './defaults/defaults.js';
import { loadGroupsAndRender, setupGroupsEvents } from './groups/groups.js';
import { loadBrandingForEdit, setupBrandingEvents } from './branding/branding.js';

// ----- UNSAVED CHANGES GUARD -----
// 設定画面ごとの dirty マーカ (save-btn.dirty / groups-list.has-dirty)。
// プリセット編集モードも「未保存の可能性あり」として扱う。
const DIRTY_SELECTORS = [
  '#users-save-btn.dirty',
  '#metrics-save-btn.dirty',
  '#filters-save-btn.dirty',
  '#defaults-save-btn.dirty',
  '#dims-save-btn.dirty',
  '#branding-save-btn.dirty',
  '#groups-list.has-dirty',
  // データソース (source-view) の Sheets URL/タブ名 / BQ project/query 入力欄
  '#sheets-fetch-btn.dirty',
  '#bq-fetch-btn.dirty',
];

export function hasUnsavedSettingsChanges() {
  for (const sel of DIRTY_SELECTORS) {
    if (document.querySelector(sel)) return true;
  }
  // プリセット編集中は「実際に snapshot と差分がある」時だけ dirty 扱い
  if (isPresetEditDirty()) return true;
  return false;
}

// 未保存変更があれば「保存せずに移動しますか？」モーダルを出す。
// 戻り値: true = 移動続行 (dirty も clear 済み) / false = キャンセル (移動中断)
// 二重表示を防ぐ単純フラグ。
let _confirmInflight = false;
export async function confirmDiscardUnsavedChanges() {
  if (!hasUnsavedSettingsChanges()) return true;
  if (_confirmInflight) return false; // 別の確認が既に走っている
  _confirmInflight = true;
  try {
    const ok = await showModal({
      title: '未保存の変更があります',
      body: '未保存の変更があります。保存せずに移動しますか？',
      okText: '保存せずに移動',
      cancelText: 'キャンセル',
      danger: true,
    });
    if (ok) discardAllDrafts();
    return !!ok;
  } finally {
    _confirmInflight = false;
  }
}

// 全 draft の破棄 + dirty のクリア。confirmDiscardUnsavedChanges 経由でのみ呼ぶ。
export function discardAllDrafts() {
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
  document.getElementById('branding-save-btn')?.classList.remove('dirty');
  document.getElementById('groups-list')?.classList.remove('has-dirty');
  // source view の未保存編集は入力欄 DOM の値を保存済み値に戻す
  document.getElementById('sheets-fetch-btn')?.classList.remove('dirty');
  document.getElementById('bq-fetch-btn')?.classList.remove('dirty');
  emit('sourceViewResetInputs');
  if (S.PRESET_EDIT_IDX != null) exitPresetEdit();
}

// ----- ENTER / EXIT SETTINGS MODE -----
export async function enterSettingsMode(target = 'users') {
  // 別の設定サブ画面 / 通常タブへの切替でも未保存確認を挟む
  if (!(await confirmDiscardUnsavedChanges())) return;
  return _doEnterSettingsMode(target);
}

function _doEnterSettingsMode(target) {
  // 設定画面では集計スピナーを出さない。in-flight aggregate も中断する。
  document.body.classList.remove('aggregating');
  abortInFlightAggregate('enter-settings');
  document.body.classList.add('settings-mode');
  document.getElementById('settings-view').classList.toggle('hidden', target !== 'users');
  document.getElementById('metrics-doc-view').classList.toggle('hidden', target !== 'metrics');
  document.getElementById('filters-doc-view').classList.toggle('hidden', target !== 'filters');
  document.getElementById('dims-doc-view').classList.toggle('hidden', target !== 'dims');
  document.getElementById('defaults-doc-view').classList.toggle('hidden', target !== 'defaults');
  document.getElementById('presets-settings-view').classList.toggle('hidden', target !== 'presets');
  document.getElementById('groups-view').classList.toggle('hidden', target !== 'groups');
  document.getElementById('branding-view').classList.toggle('hidden', target !== 'branding');
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
  document.getElementById('open-branding').classList.toggle('active', target === 'branding');
  exitPresetEdit();
  if (target === 'users') {
    settingsState.userDetailIdx = null;
    // Load users + groups concurrently (グループはプルダウン選択肢として必要)
    Promise.all([api.listUsers(), api.listGroups()]).then(([uRes, gRes]) => {
      const serverUsers = uRes.users || [];
      settingsState.groupsCache = gRes.groups || [];
      // 編集中 (dirty) の DRAFT を server data で上書きするとユーザーの未保存の編集が消える。
      //   - dirty: DRAFT を温存。S.USERS だけ最新化。server に新規 UID があれば DRAFT 末尾に追加。
      //   - clean: DRAFT を全更新 (server data が source of truth)。
      const isDirty = !!document.getElementById('users-save-btn')?.classList.contains('dirty');
      if (isDirty) {
        S.USERS = serverUsers;
        const draftUids = new Set((S.USERS_DRAFT || []).map(u => u.uid));
        for (const u of serverUsers) {
          if (!draftUids.has(u.uid)) (S.USERS_DRAFT ||= []).push(JSON.parse(JSON.stringify(u)));
        }
      } else {
        S.USERS = serverUsers;
        S.USERS_DRAFT = JSON.parse(JSON.stringify(serverUsers));
      }
      renderUsersModal();
    }).catch(e => console.warn('[users] load failed', e));
    // Promise.all が返るまでの仮表示 (キャッシュ済みの S.USERS = api.me() 結果を一旦見せる)
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
  } else if (target === 'branding') {
    S.USERS_DRAFT = null;
    S.METRICS_DRAFT = null;
    S.METRICS_DRAFT_BASE = null;
    S.METRIC_DEFS_DRAFT = null;
    S.FILTER_DEFS_DRAFT = null;
    S.VIEWS_DRAFT = null;
    S.DIMENSIONS_DRAFT = null;
    loadBrandingForEdit();
  }
}

// exitSettingsMode は sync のまま。未保存確認は user action 直下 (applyView / switchSource /
// logout 等) で行うので、内部呼び出しの exitSettingsMode は「確認後の実行」フェーズで呼ばれる想定。
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
  document.getElementById('branding-view').classList.add('hidden');
  document.getElementById('open-settings').classList.remove('active');
  document.getElementById('open-metrics-doc').classList.remove('active');
  document.getElementById('open-filters-doc').classList.remove('active');
  document.getElementById('open-dims-doc').classList.remove('active');
  document.getElementById('open-defaults-doc').classList.remove('active');
  document.getElementById('open-presets-settings').classList.remove('active');
  document.getElementById('open-groups')?.classList.remove('active');
  document.getElementById('open-branding')?.classList.remove('active');
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
// データソースのカラム一覧を表示。
// 優先順: ローカル S.RAW (CSV 読み込み直後等) → backend の S.COLUMN_INFO。
// 両方無く backend mode で source 選択済みなら、ここで lazy fetch して再描画。
// columns API も source 切替で abort されるよう、共通の AbortSignal を使う。
let _columnFetchInflight = null;
async function fetchColumnInfoIfNeeded() {
  if (S.COLUMN_INFO || !S.CURRENT_SOURCE) return;
  if (_columnFetchInflight) return _columnFetchInflight;
  // api は上部で static import 済み。
  // sources.js は静的 import にしない: sources.js → settings/settings.js → settings/index.js
  // という循環があり、static 化すると循環初期化 (この行のロード時に sources 側が未初期化)
  // になり得る。dynamic import で実行時まで遅延させて回避している。Vite の
  // INEFFECTIVE_DYNAMIC_IMPORT 警告 1 件はこの意図的な回避によるもので無害。
  const { getCurrentSourceSignal } = await import('../sources/sources.js');
  const signal = getCurrentSourceSignal();
  _columnFetchInflight = api.aggregateColumns(S.CURRENT_SOURCE, { signal })
    .then(ci => { S.COLUMN_INFO = ci; renderCsvColumns(); })
    .catch(e => {
      if (e?.code !== 'aborted') console.warn('column info fetch failed', e?.message || e);
    })
    .finally(() => { _columnFetchInflight = null; });
  return _columnFetchInflight;
}

export function renderCsvColumns() {
  const targets = [
    {el: document.getElementById('csv-columns'), count: document.getElementById('csv-column-count')},
    {el: document.getElementById('dims-csv-columns'), count: document.getElementById('dims-csv-column-count')},
    {el: document.getElementById('filters-csv-columns'), count: document.getElementById('filters-csv-column-count')},
  ].filter(t => t.el);
  if (!targets.length) return;

  // 優先順: ローカル S.RAW (CSV 読み込み直後等) → backend S.COLUMN_INFO
  let columns;     // [{ name, samples: [...], isNumeric }]
  let rowCount;
  if (S.RAW && S.RAW.length) {
    const names = Object.keys(S.RAW[0]);
    rowCount = S.RAW.length;
    columns = names.map(col => {
      const samples = [];
      const seen = new Set();
      for (const r of S.RAW) {
        const v = r[col];
        if (v == null || v === '' || seen.has(v)) continue;
        seen.add(v);
        samples.push(v);
        if (samples.length >= 5) break;
      }
      const isNumeric = samples.length > 0 && samples.slice(0, 10).every(v => !isNaN(Number(v)) && v !== '');
      return { name: col, samples, isNumeric };
    });
  } else if (S.COLUMN_INFO?.columns?.length) {
    columns = S.COLUMN_INFO.columns;
    // 設定画面プレビューでは accessibleRows (group filter 適用後) を表示。
    // これは「対象行数」(filteredRows) とは別物。
    rowCount = S.COLUMN_INFO.accessibleRows || 0;
  } else {
    // backend mode で未取得 → lazy fetch
    if (S.CURRENT_SOURCE) fetchColumnInfoIfNeeded();
    const msg = S.CURRENT_SOURCE
      ? '<div class="preset-empty">カラム情報を読み込み中...</div>'
      : '<div class="preset-empty">データソースを選択するとカラム一覧が表示されます。</div>';
    targets.forEach(t => { t.el.innerHTML = msg; if (t.count) t.count.textContent = ''; });
    return;
  }

  targets.forEach(t => { if (t.count) t.count.textContent = `${columns.length}カラム × ${rowCount.toLocaleString()}行`; });
  const items = columns.map(col => {
    const kind = col.isNumeric ? '数値' : '文字列';
    const sampleHtml = col.samples.length
      ? col.samples.map(v => `<span>${escapeHtml(String(v).slice(0, 30))}</span>`).join(' / ')
      : '(値なし)';
    return `<div class="csv-col-row">
      <div class="csv-col-head">
        <code class="csv-col-name">${escapeHtml(col.name)}</code>
        <span class="csv-col-kind">${kind}</span>
      </div>
      <div class="csv-col-sample">例: ${sampleHtml}</div>
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
    // logout 内で未保存変更ガードが走る (キャンセルされたら logout も中断)。
    // logout が実際にログアウトするまで exitSettingsMode は呼ばない (キャンセル時に
    // 設定画面 draft が消える事故を防ぐ)。
    await logout();
  });

  // ----- SETTINGS NAV -----
  // ユーザー管理は管理者限定 (backend も adminOnly。旧 manageUsers は廃止)
  document.getElementById('open-settings').addEventListener('click', () => { if (getCurrentUser().isAdmin) enterSettingsMode('users'); });
  document.getElementById('open-metrics-doc').addEventListener('click', () => { if (hasPerm('editMetrics')) enterSettingsMode('metrics'); });
  document.getElementById('open-filters-doc').addEventListener('click', () => { if (hasPerm('editFilters')) enterSettingsMode('filters'); });
  document.getElementById('open-defaults-doc').addEventListener('click', () => { if (hasPerm('editDefaults')) enterSettingsMode('defaults'); });
  document.getElementById('open-dims-doc').addEventListener('click', () => { if (hasPerm('editDimensions')) enterSettingsMode('dims'); });
  document.getElementById('open-presets-settings').addEventListener('click', () => enterSettingsMode('presets'));
  document.getElementById('open-groups').addEventListener('click', () => { if (hasPerm('manageGroups')) enterSettingsMode('groups'); });
  document.getElementById('open-branding').addEventListener('click', () => { if (hasPerm('manageBranding')) enterSettingsMode('branding'); });

  // ----- Sub-view event wiring -----
  setupBrandingEvents();
  setupGroupsEvents();
  setupDimensionsEvents();
  setupDefaultsEvents();
  setupFilterDefsEvents();
  setupMetricsEvents();
  setupUsersEvents();
}
