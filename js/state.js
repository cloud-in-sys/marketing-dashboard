// ===== CONSTANTS & DEFAULTS =====
import { api } from './api.js';
import { setCurrentSourceId, queueConfigPatch, flushConfigNow } from './persistence.js';

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
    {key: 'viewSources',       label: '閲覧'},
    {key: 'manageSources',     label: '管理（追加・編集・削除・更新）'},
    {key: 'connectAccount',    label: 'Googleアカウント連携'},
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
    // プリセット系（以前は独立グループだったがサイドバーで「設定」に移動したので統合）
    {key: 'viewPresets',    label: 'プリセット表示'},
    {key: 'editPreset',     label: 'プリセット編集'},
    {key: 'savePreset',     label: 'プリセット新規保存'},
    {key: 'deletePreset',   label: 'プリセット削除'},
    // ユーザー/グループ管理 (サイドバー「ユーザー管理」セクション)
    {key: 'manageUsers',    label: 'ユーザー管理'},
    {key: 'manageGroups',   label: 'グループ管理'},
  ]},
];
export const PERM_DEFS = PERM_GROUPS.flatMap(g => g.perms);
export const ADMIN_PERMS = Object.fromEntries(PERM_DEFS.map(p => [p.key, true]));
export const VIEWER_PERMS = Object.fromEntries(PERM_DEFS.map(p => [p.key, false]));
export const PALETTE = ['#2563eb', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#7c3aed', '#ec4899', '#14b8a6'];
export const BUILTIN_SEED_VERSION = 3;

// ===== UI-ONLY local storage keys (NOT synced to server) =====
export const SIDEBAR_KEY = 'dashboard.sidebar.collapsed';
export const PANELS_KEY = 'dashboard.panels.collapsed';
export const GROUPS_KEY = 'dashboard.sidebarGroups.v1';

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
  CHART_SETTINGS_ID: null,
  CARDS: [],
  CARD_ID_SEQ: 1,
  CARD_SETTINGS_ID: null,
  THRESHOLDS: {},
  THRESHOLD_METRICS: [],
  CURRENT_FILTER: null,
  TAB_STATES: {},
  CUSTOM_TABS: [],
  PRESET_EDIT_IDX: null,
  VIEW_ORDER: [],
  FILTER_VALUES: {},
  FILTER_CONDITIONS: {},
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
  // Per-source inputs (persisted to source doc, not to config)
  SHEETS_INPUT: { url: '', tab: '' },
  BQ_INPUT: { project: '', query: '' },
  SOURCE_METHOD: '',
  // Cached presets (loaded separately from config)
  PRESETS_CACHE: [],
};

// ===== COMPILE FILTER =====
export function compileFilter(expr) {
  if (!expr) return null;
  try { return new Function('r', `"use strict"; return (${expr});`); }
  catch (e) { return null; }
}

// ===== SAVE HELPERS (queue patches to backend config doc) =====
function serializeViews() {
  const out = {};
  for (const [k, v] of Object.entries(S.VIEWS)) {
    out[k] = { label: v.label, dims: v.dims, filterExpr: v.filterExpr || null, presetName: v.presetName || v.label };
  }
  return out;
}

export function saveMetricDefs()  { queueConfigPatch({ metricDefs: S.METRIC_DEFS }); }
export function saveDimensions()  { queueConfigPatch({ dimensions: S.DIMENSIONS }); }
export function saveViews()       { queueConfigPatch({ views: serializeViews() }); }
export function saveFilterDefs()  { queueConfigPatch({ filterDefs: S.FILTER_DEFS }); }
export function saveColWidths()   { queueConfigPatch({ colWidths: S.COL_WIDTHS }); }
export function saveBaseFormulas(){ queueConfigPatch({ baseFormulas: S.BASE_FORMULAS }); }
export function saveFormulas()    { queueConfigPatch({ formulas: S.METRIC_FORMULAS }); }
export function saveCustomTabs()  { queueConfigPatch({ customTabs: S.CUSTOM_TABS }); }
export function saveViewOrder()   { queueConfigPatch({ viewOrder: S.VIEW_ORDER }); }

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
  queueConfigPatch({
    state: {
      charts: S.CHARTS,
      cards: S.CARDS,
      currentView: S.CURRENT_VIEW,
      tabStates: S.TAB_STATES,
    }
  });
}

// Source-level inputs (saved on the source doc, not on config)
export async function saveSheetsInput(url, tab) {
  S.SHEETS_INPUT = { url, tab };
  if (S.CURRENT_SOURCE) {
    try { await api.updateSource(S.CURRENT_SOURCE, { sheetsInput: { url, tab } }); } catch (e) { console.warn(e); }
  }
}
export function loadSheetsInput() { return S.SHEETS_INPUT; }

export async function saveBqInput(project, query) {
  S.BQ_INPUT = { project, query };
  if (S.CURRENT_SOURCE) {
    try { await api.updateSource(S.CURRENT_SOURCE, { bqInput: { project, query } }); } catch (e) { console.warn(e); }
  }
}
export function loadBqInput() { return S.BQ_INPUT; }

export async function saveSourceMethod(method) {
  S.SOURCE_METHOD = method || '';
  if (S.CURRENT_SOURCE) {
    try { await api.updateSource(S.CURRENT_SOURCE, { method: S.SOURCE_METHOD }); } catch (e) { console.warn(e); }
  }
}
export function loadSourceMethod() { return S.SOURCE_METHOD; }

// Session-only CSV (not persisted)
export function saveSourceRaw(sid, rows) {
  S.SOURCE_DATA[sid] = rows;
}
export function loadSourceRaw(sid) {
  return S.SOURCE_DATA[sid] || [];
}
export function clearSourceRaw(sid) {
  S.SOURCE_DATA[sid] = [];
}

// Presets: list replace semantics (matches frontend preset editor)
export function getPresets() { return S.PRESETS_CACHE; }
export function setPresets(list) {
  S.PRESETS_CACHE = list;
  if (S.CURRENT_SOURCE) {
    api.putPresets(S.CURRENT_SOURCE, list).catch(e => console.warn('[presets] save failed', e));
  }
}

// Data sources
export async function saveDataSources() {
  // Source list is CRUD'd individually; this is a no-op in the new model.
}

export function saveCurrentSource() {
  try {
    if (S.CURRENT_SOURCE) localStorage.setItem('dashboard.lastSource', S.CURRENT_SOURCE);
  } catch (e) {}
}

export function saveUsers() {
  // Users are saved explicitly via api.updateUser in settings.js
}
export function saveCurrentUser() {
  // Firebase Auth manages current user; no-op
}
export function saveApiSettings() {
  // OAuth is now backend-managed; no-op
}

// ===== LOAD SOURCE CONFIG FROM SERVER =====
async function applyConfig(cfg) {
  cfg = cfg || {};
  S.METRIC_DEFS = Array.isArray(cfg.metricDefs)
    ? cfg.metricDefs.map(m => ({key: m.key, label: m.label, fmt: m.fmt || 'int', type: m.type || 'derived'}))
    : ('metricDefs' in cfg ? [] : JSON.parse(JSON.stringify(DEFAULT_METRIC_DEFS)));
  S.SELECTED_METRICS = S.METRIC_DEFS.map(m => m.key);

  S.DIMENSIONS = Array.isArray(cfg.dimensions)
    ? cfg.dimensions.map(d => ({key: d.key, label: d.label, field: d.field || d.key, type: d.type || 'value'}))
    : ('dimensions' in cfg ? [] : JSON.parse(JSON.stringify(DEFAULT_DIMENSIONS)));

  S.VIEWS = {};
  const savedViews = cfg.views;
  if (savedViews && typeof savedViews === 'object') {
    for (const [k, v] of Object.entries(savedViews)) {
      S.VIEWS[k] = {label: v.label, dims: Array.isArray(v.dims) ? v.dims : [], filterExpr: v.filterExpr || null, filter: compileFilter(v.filterExpr), presetName: v.presetName || v.label};
    }
  } else if (!('views' in cfg)) {
    for (const [k, v] of Object.entries(DEFAULT_VIEWS_INIT)) {
      S.VIEWS[k] = {label: v.label, dims: [...v.dims], filterExpr: v.filter, filter: compileFilter(v.filter), presetName: v.label};
    }
  }

  S.VIEW_ORDER = Array.isArray(cfg.viewOrder)
    ? [...cfg.viewOrder.filter(k => S.VIEWS[k]), ...Object.keys(S.VIEWS).filter(k => !cfg.viewOrder.includes(k))]
    : Object.keys(S.VIEWS);

  S.FILTER_DEFS = Array.isArray(cfg.filterDefs)
    ? cfg.filterDefs
    : ('filterDefs' in cfg ? [] : JSON.parse(JSON.stringify(DEFAULT_FILTER_DEFS)));

  S.COL_WIDTHS = cfg.colWidths && typeof cfg.colWidths === 'object' ? cfg.colWidths : {};

  S.BASE_FORMULAS = 'baseFormulas' in cfg ? (cfg.baseFormulas || {}) : { ...DEFAULT_BASE_FORMULAS };
  S.METRIC_FORMULAS = 'formulas' in cfg ? (cfg.formulas || {}) : { ...DEFAULT_FORMULAS };

  S.CUSTOM_TABS = Array.isArray(cfg.customTabs) ? cfg.customTabs : [];

  // Restore charts/view/tab state
  const st = cfg.state || {};
  S.CURRENT_VIEW = (st.currentView && (S.VIEWS[st.currentView] || S.CUSTOM_TABS.some(t => t.key === st.currentView))) ? st.currentView : 'summary_daily';
  S.TAB_STATES = st.tabStates && typeof st.tabStates === 'object' ? st.tabStates : {};
  S.CHARTS = Array.isArray(st.charts)
    ? st.charts.map(c => ({...c, color: c.color || '#2563eb', name: c.name || '', bucket: c.bucket || 'auto'}))
    : ('charts' in st ? [] : [{id: 1, metric: 'ad_cost', type: 'bar', size: 'main', color: '#2563eb', bucket: 'auto'}]);
  S.CHART_ID_SEQ = Math.max(0, ...S.CHARTS.map(c => c.id)) + 1;
  S.CARDS = Array.isArray(st.cards) ? st.cards.map(c => ({...c})) : [];
  S.CARD_ID_SEQ = S.CARDS.length ? Math.max(0, ...S.CARDS.map(c => c.id)) + 1 : 1;

  // Resets
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

async function loadSourceConfigFromServer(sid) {
  const source = S.DATA_SOURCES.find(s => s.id === sid);
  S.SHEETS_INPUT = source?.sheetsInput || { url: '', tab: '' };
  S.BQ_INPUT = source?.bqInput || { project: '', query: '' };
  S.SOURCE_METHOD = source?.method || '';

  if (!S.SOURCE_DATA[sid]) S.SOURCE_DATA[sid] = [];
  S.RAW = S.SOURCE_DATA[sid];

  const [{ config }, { presets }] = await Promise.all([
    api.getConfig(sid),
    api.listPresets(sid),
  ]);
  await applyConfig(config);
  S.PRESETS_CACHE = presets || [];
}

// ===== SWITCH SOURCE =====
export async function switchSource(id) {
  if (S.CURRENT_SOURCE) await flushConfigNow();
  S.CURRENT_SOURCE = id;
  setCurrentSourceId(id);
  saveCurrentSource();
  await loadSourceConfigFromServer(id);
}

// ===== INIT (called once after login) =====
export async function initStateFromServer() {
  // Load user + sources
  const [{ user }, { sources }] = await Promise.all([
    api.me(),
    api.listSources(),
  ]);

  S.USERS = [user];
  S.CURRENT_USER = user.uid;

  S.DATA_SOURCES = sources;
  S.SOURCE_DATA = {};
  sources.forEach(s => { S.SOURCE_DATA[s.id] = []; });

  // Restore last selected source if valid
  let initial = null;
  try {
    const last = localStorage.getItem('dashboard.lastSource');
    if (last && sources.some(s => s.id === last)) initial = last;
  } catch (e) {}
  if (!initial) initial = sources[0]?.id || null;

  if (initial) {
    S.CURRENT_SOURCE = initial;
    setCurrentSourceId(initial);
    saveCurrentSource();
    await loadSourceConfigFromServer(initial);
  }
}

// Backwards-compat stub (some call sites still invoke this; make it a no-op)
export function initStateFromStorage() {
  console.warn('initStateFromStorage() is deprecated; use initStateFromServer()');
}
