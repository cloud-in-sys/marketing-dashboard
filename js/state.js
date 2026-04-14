// ===== CONSTANTS & DEFAULTS =====
export const DEFAULT_METRIC_DEFS = [
  {key:'ad_cost',        label:'広告費',                      fmt:'yen', type:'base'},
  {key:'ad_cost_fee',    label:'広告費(手数料含む)',          fmt:'yen', type:'base'},
  {key:'impression',     label:'impression',                  fmt:'int', type:'base'},
  {key:'reach',          label:'reach',                       fmt:'int', type:'base'},
  {key:'clicks',         label:'clicks',                      fmt:'int', type:'base'},
  {key:'mcv',            label:'mcv',                         fmt:'int', type:'base'},
  {key:'line_reg',       label:'LINE登録',                    fmt:'int', type:'base'},
  {key:'answer',         label:'回答',                        fmt:'int', type:'base'},
  {key:'booking',        label:'予約',                        fmt:'int', type:'base'},
  {key:'join',           label:'参加',                        fmt:'int', type:'base'},
  {key:'deal',           label:'成約',                        fmt:'int', type:'base'},
  {key:'rev_first',      label:'売上(初回)',                  fmt:'yen', type:'base'},
  {key:'rev_ltv',        label:'売上(LTV12m)',                fmt:'yen', type:'base'},
  {key:'cpm',            label:'CPM',                         fmt:'yen', type:'derived'},
  {key:'ctr',            label:'CTR',                         fmt:'pct', type:'derived'},
  {key:'cpc',            label:'CPC',                         fmt:'yen', type:'derived'},
  {key:'mcvr',           label:'mCVR',                        fmt:'pct', type:'derived'},
  {key:'cvr',            label:'CVR',                         fmt:'pct', type:'derived'},
  {key:'divergence',     label:'乖離率',                      fmt:'pct', type:'derived'},
  {key:'cpa_reg',        label:'登録CPA',                     fmt:'yen', type:'derived'},
  {key:'answer_rate',    label:'回答率',                      fmt:'pct', type:'derived'},
  {key:'cpa_answer',     label:'回答CPA',                     fmt:'yen', type:'derived'},
  {key:'cpa_booking',    label:'予約CPA',                     fmt:'yen', type:'derived'},
  {key:'join_rate',      label:'参加率',                      fmt:'pct', type:'derived'},
  {key:'cpa_join',       label:'参加CPA',                     fmt:'yen', type:'derived'},
  {key:'cpa_join_calc',  label:'参加CPA(回答CPA÷参加率)',    fmt:'yen', type:'derived'},
  {key:'seat_first',     label:'着座単価(初回)',              fmt:'yen', type:'derived'},
  {key:'seat_ltv',       label:'着座単価(LTV12m)',            fmt:'yen', type:'derived'},
  {key:'deal_rate',      label:'成約率',                      fmt:'pct', type:'derived'},
  {key:'cpo',            label:'CPO',                         fmt:'yen', type:'derived'},
  {key:'avg_first',      label:'平均単価(初回)',              fmt:'yen', type:'derived'},
  {key:'avg_ltv',        label:'平均単価(LTV12m)',            fmt:'yen', type:'derived'},
  {key:'roas_first',     label:'ROAS(初回)',                  fmt:'pct', type:'derived'},
  {key:'roas_ltv',       label:'ROAS(LTV12m)',                fmt:'pct', type:'derived'},
  {key:'ad_ratio_first', label:'広告費率(初回)',              fmt:'pct', type:'derived'},
  {key:'ad_ratio_ltv',   label:'広告費率(LTV12m)',            fmt:'pct', type:'derived'},
];

export const DEFAULT_DIMENSIONS = [
  {key:'action_date',  label:'日付',   field:'action_date', type:'date'},
  {key:'month',        label:'月',     field:'action_date', type:'month'},
  {key:'dow',          label:'曜日',   field:'action_date', type:'dow'},
  {key:'operator',     label:'代理店', field:'operator',    type:'value'},
  {key:'media',        label:'媒体',   field:'media',       type:'value'},
  {key:'route',        label:'ルート', field:'route',       type:'value'},
  {key:'seminar_type', label:'訴求',   field:'seminar_type',type:'value'},
  {key:'funnel',       label:'ファネル',field:'funnel',     type:'value'},
];

export const DEFAULT_VIEWS_INIT = {
  summary_daily: {label:'全体サマリー',         dims:['action_date'], filter: null},
  summary_month: {label:'全体サマリー_月全体',  dims:['month'],       filter: null},
  non_ad:        {label:'広告以外合算',         dims:['action_date'], filter: "r.funnel !== '広告'"},
  ad_only:       {label:'広告合算',             dims:['action_date'], filter: "r.funnel === '広告'"},
  op_media:      {label:'代理店×媒体ごと',      dims:['action_date','operator','media'], filter: null},
  op_dow:        {label:'代理店×曜日ごと',      dims:['dow','operator'], filter: null},
  seminar:       {label:'訴求ごと',             dims:['action_date','seminar_type'], filter: null},
  media:         {label:'媒体ごと',             dims:['action_date','media'], filter: null},
  lpcr:          {label:'LP-CRごと',            dims:['action_date','route'], filter: null},
};

export const DEFAULT_FILTER_DEFS = [
  {id: 'from',     type: 'date_from', field: 'action_date', label: '開始日'},
  {id: 'to',       type: 'date_to',   field: 'action_date', label: '終了日'},
  {id: 'operator', type: 'multi',     field: 'operator',    label: 'operator'},
  {id: 'media',    type: 'multi',     field: 'media',       label: 'media'},
];

export const DEFAULT_BASE_FORMULAS = {
  ad_cost:     "sum(amount_1) where funnel = '広告'",
  ad_cost_fee: "sum(amount_2) where funnel = '広告'",
  impression:  "sum(impression) where funnel = '広告'",
  reach:       "sum(reach) where funnel = '広告'",
  clicks:      "sum(clicks) where funnel = '広告'",
  mcv:         "sum(cv) where funnel = '広告'",
  line_reg:    "sum(ac_count) where funnel = 'LINE登録'",
  answer:      "sum(ac_count) where funnel = '回答'",
  booking:     "sum(ac_count) where funnel = '予約'",
  join:        "sum(ac_count) where funnel = '参加'",
  deal:        "sum(ac_count) where funnel = '成約'",
  rev_first:   "sum(amount_1) where funnel = '成約'",
  rev_ltv:     "sum(amount_2) where funnel = '成約'",
};

export const DEFAULT_FORMULAS = {
  cpm:            'ad_cost / impression * 1000',
  ctr:            'clicks / impression',
  cpc:            'ad_cost / clicks',
  mcvr:           'mcv / clicks',
  cvr:            'line_reg / clicks',
  divergence:     '(mcv - line_reg) / mcv',
  cpa_reg:        'ad_cost / line_reg',
  answer_rate:    'answer / line_reg',
  cpa_answer:     'ad_cost / answer',
  cpa_booking:    'ad_cost / booking',
  join_rate:      'join / booking',
  cpa_join:       'ad_cost / join',
  cpa_join_calc:  'cpa_answer / join_rate',
  seat_first:     'rev_first / join',
  seat_ltv:       'rev_ltv / join',
  deal_rate:      'deal / join',
  cpo:            'ad_cost / deal',
  avg_first:      'rev_first / deal',
  avg_ltv:        'rev_ltv / deal',
  roas_first:     'rev_first / ad_cost',
  roas_ltv:       'rev_ltv / ad_cost',
  ad_ratio_first: 'ad_cost / rev_first',
  ad_ratio_ltv:   'ad_cost / rev_ltv',
};

export const DOW_LABELS = ['日','月','火','水','木','金','土'];
export const DOW_ORDER = {'日':0,'月':1,'火':2,'水':3,'木':4,'金':5,'土':6};

export const PERM_GROUPS = [
  {group: 'sources', label: 'データソース', perms: [
    {key: 'viewSources',   label: 'グループを表示'},
    {key: 'addSource',     label: '追加'},
    {key: 'deleteSource',  label: '削除'},
  ]},
  {group: 'preset', label: 'プリセット', perms: [
    {key: 'viewPresets',   label: 'グループを表示'},
    {key: 'editPreset',   label: '編集'},
    {key: 'savePreset',   label: '新規保存'},
    {key: 'deletePreset', label: '削除'},
  ]},
  {group: 'custom', label: 'カスタムタブ', perms: [
    {key: 'viewCustom',   label: 'グループを表示'},
    {key: 'addCustom',    label: '追加'},
    {key: 'editCustom',   label: '編集'},
    {key: 'deleteCustom', label: '削除'},
  ]},
  {group: 'settings', label: '設定', perms: [
    {key: 'editMetrics',    label: 'メトリクス設定'},
    {key: 'editFilters',    label: 'フィルタ設定'},
    {key: 'editDimensions', label: 'ディメンション設定'},
    {key: 'editDefaults',   label: '標準タブ設定'},
    {key: 'manageUsers',    label: 'ユーザー管理'},
  ]},
];
export const PERM_DEFS = PERM_GROUPS.flatMap(g => g.perms);

export const ADMIN_PERMS = Object.fromEntries(PERM_DEFS.map(p => [p.key, true]));
export const VIEWER_PERMS = Object.fromEntries(PERM_DEFS.map(p => [p.key, false]));
export const PALETTE = ['#2563eb', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#7c3aed', '#ec4899', '#14b8a6'];
export const BUILTIN_SEED_VERSION = 3;

// ===== GLOBAL STORAGE KEYS (not per-source) =====
export const SIDEBAR_KEY = 'dashboard.sidebar.collapsed';
export const PANELS_KEY = 'dashboard.panels.collapsed';
export const GROUPS_KEY = 'dashboard.sidebarGroups.v1';
export const USERS_KEY = 'dashboard.users.v1';
export const CURRENT_USER_KEY = 'dashboard.currentUser.v1';
export const DATA_SOURCES_KEY = 'dashboard.dataSources.v1';
export const CURRENT_SOURCE_KEY = 'dashboard.currentSource.v1';
export const API_SETTINGS_KEY = 'dashboard.apiSettings.v1';

// ===== PER-SOURCE STORAGE KEY HELPER =====
function sk(base) { return `${base}.${S.CURRENT_SOURCE}`; }
const METRIC_DEFS_BASE   = 'dashboard.metricDefs.v1';
const DIMENSIONS_BASE    = 'dashboard.dimensions.v1';
const VIEWS_BASE         = 'dashboard.views.v1';
const FILTER_DEFS_BASE   = 'dashboard.filterDefs.v1';
const STATE_BASE         = 'dashboard.state.v1';
const PRESETS_BASE       = 'dashboard.presets.all.v1';
const COL_WIDTHS_BASE    = 'dashboard.colWidths.v1';
const CUSTOM_TABS_BASE   = 'dashboard.customTabs.v1';
const VIEW_ORDER_BASE    = 'dashboard.viewOrder.v1';
const FORMULAS_BASE      = 'dashboard.metricFormulas.v1';
const BASE_FORMULAS_BASE = 'dashboard.baseMetricFormulas.v1';
const SHEETS_INPUT_BASE  = 'dashboard.sheetsInput.v1';
const BQ_INPUT_BASE      = 'dashboard.bqInput.v1';
const SOURCE_METHOD_BASE = 'dashboard.sourceMethod.v1';
const SOURCE_RAW_BASE    = 'dashboard.sourceRaw.v1';

// Export key bases for migration
export const STATE_KEY = STATE_BASE;

// ===== SHARED MUTABLE STATE =====
export const S = {
  DATA_SOURCES: [],
  CURRENT_SOURCE: null,
  SOURCE_DATA: {},
  RAW: [],
  CURRENT_VIEW: 'summary_daily',
  SELECTED_DIMS: ['action_date'],
  SELECTED_METRICS: [],
  CHARTS: [{id: 1, metric: 'ad_cost', type: 'bar', size: 'main', color: '#2563eb', bucket: 'auto'}],
  CHART_ID_SEQ: 2,
  CHART_POINTS: new Map(),
  THRESHOLDS: {},
  THRESHOLD_METRICS: [],
  CURRENT_FILTER: null,
  TAB_STATES: {},
  CUSTOM_TABS: [],
  PRESET_EDIT_IDX: null,
  VIEW_ORDER: [],
  FILTER_VALUES: {},
  COL_WIDTHS: {},
  METRIC_DEFS: [],
  DIMENSIONS: [],
  VIEWS: {},
  FILTER_DEFS: [],
  METRIC_FORMULAS: {},
  BASE_FORMULAS: {},
  USERS: [],
  CURRENT_USER: null,
  USERS_DRAFT: null,
  METRICS_DRAFT: null,
  METRICS_DRAFT_BASE: null,
  METRIC_DEFS_DRAFT: null,
  FILTER_DEFS_DRAFT: null,
  VIEWS_DRAFT: null,
  DIMENSIONS_DRAFT: null,
  DIM_EXPR_CACHE: new Map(),
  API_SETTINGS: { clientId: '' },
};

// ===== COMPILE FILTER =====
export function compileFilter(expr) {
  if (!expr) return null;
  try { return new Function('r', `"use strict"; return (${expr});`); }
  catch (e) { return null; }
}

// ===== PER-SOURCE STORAGE HELPERS =====
export function saveMetricDefs() {
  try { localStorage.setItem(sk(METRIC_DEFS_BASE), JSON.stringify(S.METRIC_DEFS)); } catch (e) {}
}
export function saveDimensions() {
  try { localStorage.setItem(sk(DIMENSIONS_BASE), JSON.stringify(S.DIMENSIONS)); } catch (e) {}
}
export function saveViews() {
  try {
    const serialize = {};
    for (const [k, v] of Object.entries(S.VIEWS)) {
      serialize[k] = {label: v.label, dims: v.dims, filterExpr: v.filterExpr || null, presetName: v.presetName || v.label};
    }
    localStorage.setItem(sk(VIEWS_BASE), JSON.stringify(serialize));
  } catch (e) {}
}
export function saveFilterDefs() {
  try { localStorage.setItem(sk(FILTER_DEFS_BASE), JSON.stringify(S.FILTER_DEFS)); } catch (e) {}
}
export function saveColWidths() {
  try { localStorage.setItem(sk(COL_WIDTHS_BASE), JSON.stringify(S.COL_WIDTHS)); } catch (e) {}
}
export function saveBaseFormulas() {
  try { localStorage.setItem(sk(BASE_FORMULAS_BASE), JSON.stringify(S.BASE_FORMULAS)); } catch (e) {}
}
export function saveFormulas() {
  try { localStorage.setItem(sk(FORMULAS_BASE), JSON.stringify(S.METRIC_FORMULAS)); } catch (e) {}
}
export function saveSourceRaw(sourceId, rows) {
  try {
    localStorage.setItem(`${SOURCE_RAW_BASE}.${sourceId}`, JSON.stringify(rows));
  } catch (e) {
    console.warn('Source data too large to save to localStorage', e);
  }
}
export function loadSourceRaw(sourceId) {
  try {
    const saved = JSON.parse(localStorage.getItem(`${SOURCE_RAW_BASE}.${sourceId}`) || 'null');
    return Array.isArray(saved) ? saved : [];
  } catch (e) { return []; }
}
export function clearSourceRaw(sourceId) {
  try { localStorage.removeItem(`${SOURCE_RAW_BASE}.${sourceId}`); } catch (e) {}
}
export function saveSheetsInput(url, tab) {
  try { localStorage.setItem(sk(SHEETS_INPUT_BASE), JSON.stringify({ url, tab })); } catch (e) {}
}
export function loadSheetsInput() {
  try {
    const saved = JSON.parse(localStorage.getItem(sk(SHEETS_INPUT_BASE)) || 'null');
    return saved || { url: '', tab: '' };
  } catch (e) { return { url: '', tab: '' }; }
}
export function saveBqInput(project, query) {
  try { localStorage.setItem(sk(BQ_INPUT_BASE), JSON.stringify({ project, query })); } catch (e) {}
}
export function loadBqInput() {
  try {
    const saved = JSON.parse(localStorage.getItem(sk(BQ_INPUT_BASE)) || 'null');
    return saved || { project: '', query: '' };
  } catch (e) { return { project: '', query: '' }; }
}
export function saveSourceMethod(method) {
  try { localStorage.setItem(sk(SOURCE_METHOD_BASE), method || ''); } catch (e) {}
}
export function loadSourceMethod() {
  try { return localStorage.getItem(sk(SOURCE_METHOD_BASE)) || ''; } catch (e) { return ''; }
}
export function getPresets() {
  try {
    const v = JSON.parse(localStorage.getItem(sk(PRESETS_BASE)) || '[]');
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}
export function setPresets(list) {
  try { localStorage.setItem(sk(PRESETS_BASE), JSON.stringify(list)); } catch (e) {}
}
export function saveCustomTabs() {
  try { localStorage.setItem(sk(CUSTOM_TABS_BASE), JSON.stringify(S.CUSTOM_TABS)); } catch (e) {}
}
export function saveViewOrder() {
  try { localStorage.setItem(sk(VIEW_ORDER_BASE), JSON.stringify(S.VIEW_ORDER)); } catch (e) {}
}

// ===== GLOBAL STORAGE HELPERS =====
export function saveDataSources() {
  try { localStorage.setItem(DATA_SOURCES_KEY, JSON.stringify(S.DATA_SOURCES)); } catch (e) {}
}
export function saveCurrentSource() {
  try {
    if (S.CURRENT_SOURCE) localStorage.setItem(CURRENT_SOURCE_KEY, S.CURRENT_SOURCE);
    else localStorage.removeItem(CURRENT_SOURCE_KEY);
  } catch (e) {}
}
export function saveApiSettings() {
  try { localStorage.setItem(API_SETTINGS_KEY, JSON.stringify(S.API_SETTINGS)); } catch (e) {}
}
export function saveUsers() {
  try { localStorage.setItem(USERS_KEY, JSON.stringify(S.USERS)); } catch (e) {}
}
export function saveCurrentUser() {
  try {
    if (S.CURRENT_USER) localStorage.setItem(CURRENT_USER_KEY, S.CURRENT_USER);
    else localStorage.removeItem(CURRENT_USER_KEY);
  } catch (e) {}
}
export function syncCurrentTabState() {
  if (S.PRESET_EDIT_IDX != null) return;
  if (!S.CURRENT_VIEW) return;
  if (S.VIEWS[S.CURRENT_VIEW]) return;
  S.TAB_STATES[S.CURRENT_VIEW] = {
    dims: [...S.SELECTED_DIMS],
    metrics: [...S.SELECTED_METRICS],
    thresholds: JSON.parse(JSON.stringify(S.THRESHOLDS)),
    thresholdMetrics: [...S.THRESHOLD_METRICS],
  };
}
export function saveState() {
  syncCurrentTabState();
  try {
    localStorage.setItem(sk(STATE_BASE), JSON.stringify({
      charts: S.CHARTS,
      currentView: S.CURRENT_VIEW,
      tabStates: S.TAB_STATES,
    }));
  } catch (e) {}
}

// ===== LOAD SOURCE CONFIG (load per-source settings into globals) =====
function loadSourceConfig() {
  const sid = S.CURRENT_SOURCE;
  // Data is session-only (not persisted); keep existing in-memory if any
  if (!S.SOURCE_DATA[sid]) S.SOURCE_DATA[sid] = [];
  S.RAW = S.SOURCE_DATA[sid];

  // METRIC_DEFS
  S.METRIC_DEFS = JSON.parse(JSON.stringify(DEFAULT_METRIC_DEFS));
  try {
    const saved = JSON.parse(localStorage.getItem(sk(METRIC_DEFS_BASE)) || 'null');
    if (Array.isArray(saved) && saved.length) S.METRIC_DEFS = saved.map(m => ({key: m.key, label: m.label, fmt: m.fmt || 'int', type: m.type || 'derived'}));
  } catch (e) {}
  S.SELECTED_METRICS = S.METRIC_DEFS.map(m => m.key);

  // DIMENSIONS
  S.DIMENSIONS = JSON.parse(JSON.stringify(DEFAULT_DIMENSIONS));
  try {
    const saved = JSON.parse(localStorage.getItem(sk(DIMENSIONS_BASE)) || 'null');
    if (Array.isArray(saved) && saved.length) S.DIMENSIONS = saved.map(d => ({key: d.key, label: d.label, field: d.field || d.key, type: d.type || 'value'}));
  } catch (e) {}

  // VIEWS
  S.VIEWS = {};
  for (const [k, v] of Object.entries(DEFAULT_VIEWS_INIT)) {
    S.VIEWS[k] = {label: v.label, dims: [...v.dims], filterExpr: v.filter, filter: compileFilter(v.filter), presetName: v.label};
  }
  try {
    const saved = JSON.parse(localStorage.getItem(sk(VIEWS_BASE)) || 'null');
    if (saved && typeof saved === 'object') {
      S.VIEWS = {};
      for (const [k, v] of Object.entries(saved)) {
        S.VIEWS[k] = {label: v.label, dims: Array.isArray(v.dims) ? v.dims : [], filterExpr: v.filterExpr || null, filter: compileFilter(v.filterExpr), presetName: v.presetName || v.label};
      }
    }
  } catch (e) {}
  S.VIEW_ORDER = Object.keys(S.VIEWS);
  try {
    const saved = JSON.parse(localStorage.getItem(sk(VIEW_ORDER_BASE)) || 'null');
    if (Array.isArray(saved)) {
      const valid = saved.filter(k => S.VIEWS[k]);
      const missing = Object.keys(S.VIEWS).filter(k => !valid.includes(k));
      S.VIEW_ORDER = [...valid, ...missing];
    }
  } catch (e) {}

  // FILTER_DEFS
  S.FILTER_DEFS = JSON.parse(JSON.stringify(DEFAULT_FILTER_DEFS));
  try {
    const saved = JSON.parse(localStorage.getItem(sk(FILTER_DEFS_BASE)) || 'null');
    if (Array.isArray(saved) && saved.length) S.FILTER_DEFS = saved;
  } catch (e) {}

  // COL_WIDTHS
  try { S.COL_WIDTHS = JSON.parse(localStorage.getItem(sk(COL_WIDTHS_BASE)) || '{}'); } catch (e) { S.COL_WIDTHS = {}; }

  // FORMULAS
  S.BASE_FORMULAS = {...DEFAULT_BASE_FORMULAS};
  try {
    const saved = JSON.parse(localStorage.getItem(sk(BASE_FORMULAS_BASE)) || '{}');
    if (saved && typeof saved === 'object') S.BASE_FORMULAS = {...DEFAULT_BASE_FORMULAS, ...saved};
  } catch (e) {}
  S.METRIC_FORMULAS = {...DEFAULT_FORMULAS};
  try {
    const saved = JSON.parse(localStorage.getItem(sk(FORMULAS_BASE)) || '{}');
    if (saved && typeof saved === 'object') S.METRIC_FORMULAS = {...DEFAULT_FORMULAS, ...saved};
  } catch (e) {}

  // CUSTOM_TABS
  try { S.CUSTOM_TABS = JSON.parse(localStorage.getItem(sk(CUSTOM_TABS_BASE)) || '[]'); }
  catch (e) { S.CUSTOM_TABS = []; }

  // STATE (charts, currentView, tabStates)
  S.CURRENT_VIEW = 'summary_daily';
  S.CHARTS = [{id: 1, metric: 'ad_cost', type: 'bar', size: 'main', color: '#2563eb', bucket: 'auto'}];
  S.CHART_ID_SEQ = 2;
  S.TAB_STATES = {};
  try {
    const s = JSON.parse(localStorage.getItem(sk(STATE_BASE)) || 'null');
    if (s) {
      if (s.tabStates && typeof s.tabStates === 'object') S.TAB_STATES = s.tabStates;
      if (s.currentView && (S.VIEWS[s.currentView] || S.CUSTOM_TABS.some(t => t.key === s.currentView))) S.CURRENT_VIEW = s.currentView;
      if (Array.isArray(s.charts) && s.charts.length) {
        S.CHARTS = s.charts.map(c => ({id: c.id, metric: c.metric, type: c.type, size: c.size, color: c.color || '#2563eb', name: c.name || '', bucket: c.bucket || 'auto'}));
        S.CHART_ID_SEQ = Math.max(...S.CHARTS.map(c => c.id)) + 1;
      }
    }
  } catch (e) {}

  // Reset filter values & drafts
  S.FILTER_VALUES = {};
  S.SELECTED_DIMS = ['action_date'];
  S.THRESHOLDS = {};
  S.THRESHOLD_METRICS = [];
  S.CURRENT_FILTER = null;
  S.PRESET_EDIT_IDX = null;
  S.USERS_DRAFT = null;
  S.METRICS_DRAFT = null;
  S.METRICS_DRAFT_BASE = null;
  S.METRIC_DEFS_DRAFT = null;
  S.FILTER_DEFS_DRAFT = null;
  S.VIEWS_DRAFT = null;
  S.DIMENSIONS_DRAFT = null;
  S.DIM_EXPR_CACHE.clear();
}

// ===== SWITCH SOURCE =====
// Save ALL per-source settings for current source
function saveAllSourceConfig() {
  saveState();
  saveMetricDefs();
  saveDimensions();
  saveViews();
  saveFilterDefs();
  saveColWidths();
  saveBaseFormulas();
  saveFormulas();
  saveCustomTabs();
  saveViewOrder();
}

export function switchSource(id) {
  // Save current source settings before switching
  if (S.CURRENT_SOURCE) saveAllSourceConfig();
  // Switch
  S.CURRENT_SOURCE = id;
  saveCurrentSource();
  // Load new source config
  loadSourceConfig();
}

// ===== MIGRATE: move old global keys to default source =====
function migrateToSourceScoped() {
  const migrated = localStorage.getItem('dashboard.migrated.v2');
  if (!migrated) {
    const bases = [METRIC_DEFS_BASE, DIMENSIONS_BASE, VIEWS_BASE, FILTER_DEFS_BASE,
      STATE_BASE, PRESETS_BASE, COL_WIDTHS_BASE, CUSTOM_TABS_BASE, VIEW_ORDER_BASE,
      FORMULAS_BASE, BASE_FORMULAS_BASE];
    for (const base of bases) {
      const old = localStorage.getItem(base);
      if (old != null && !localStorage.getItem(base + '.default')) {
        localStorage.setItem(base + '.default', old);
      }
    }
    try { localStorage.setItem('dashboard.migrated.v2', '1'); } catch (e) {}
  }
  // Clean up previously saved raw data (session-only policy)
  const cleaned = localStorage.getItem('dashboard.rawCleanup.v1');
  if (!cleaned) {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(SOURCE_RAW_BASE)) keysToRemove.push(key);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    try { localStorage.setItem('dashboard.rawCleanup.v1', '1'); } catch (e) {}
  }
}

// ===== INIT (called once at startup) =====
export function initStateFromStorage() {
  // DATA SOURCES (global)
  S.DATA_SOURCES = [{id: 'default', name: 'デフォルト'}];
  try {
    const saved = JSON.parse(localStorage.getItem(DATA_SOURCES_KEY) || 'null');
    if (Array.isArray(saved) && saved.length) S.DATA_SOURCES = saved;
  } catch (e) {}
  S.SOURCE_DATA = {};
  S.DATA_SOURCES.forEach(ds => { S.SOURCE_DATA[ds.id] = []; });
  const savedSource = localStorage.getItem(CURRENT_SOURCE_KEY);
  S.CURRENT_SOURCE = (savedSource && S.DATA_SOURCES.some(ds => ds.id === savedSource)) ? savedSource : S.DATA_SOURCES[0]?.id || 'default';

  // Migrate old keys to default source
  migrateToSourceScoped();

  // USERS (global, not per-source)
  S.USERS = [
    {id: 'admin',  password: 'admin',  name: '管理者', isAdmin: true,  perms: {...ADMIN_PERMS}},
    {id: 'viewer', password: 'viewer', name: '閲覧者', isAdmin: false, perms: {...VIEWER_PERMS}},
  ];

  // API SETTINGS (global)
  try {
    const saved = JSON.parse(localStorage.getItem(API_SETTINGS_KEY) || 'null');
    if (saved) S.API_SETTINGS = { clientId: saved.clientId || '' };
  } catch (e) {}

  // Load current source config
  loadSourceConfig();
}
