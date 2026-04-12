// ===== CONSTANTS & DEFAULTS =====
export const DEFAULT_METRIC_DEFS = [
  {key:'ad_cost',        label:'\u5e83\u544a\u8cbb',                      fmt:'yen', type:'base'},
  {key:'ad_cost_fee',    label:'\u5e83\u544a\u8cbb(\u624b\u6570\u6599\u542b\u3080)',          fmt:'yen', type:'base'},
  {key:'impression',     label:'impression',                  fmt:'int', type:'base'},
  {key:'reach',          label:'reach',                       fmt:'int', type:'base'},
  {key:'clicks',         label:'clicks',                      fmt:'int', type:'base'},
  {key:'mcv',            label:'mcv',                         fmt:'int', type:'base'},
  {key:'line_reg',       label:'LINE\u767b\u9332',                    fmt:'int', type:'base'},
  {key:'answer',         label:'\u56de\u7b54',                        fmt:'int', type:'base'},
  {key:'booking',        label:'\u4e88\u7d04',                        fmt:'int', type:'base'},
  {key:'join',           label:'\u53c2\u52a0',                        fmt:'int', type:'base'},
  {key:'deal',           label:'\u6210\u7d04',                        fmt:'int', type:'base'},
  {key:'rev_first',      label:'\u58f2\u4e0a(\u521d\u56de)',                  fmt:'yen', type:'base'},
  {key:'rev_ltv',        label:'\u58f2\u4e0a(LTV12m)',                fmt:'yen', type:'base'},
  {key:'cpm',            label:'CPM',                         fmt:'yen', type:'derived'},
  {key:'ctr',            label:'CTR',                         fmt:'pct', type:'derived'},
  {key:'cpc',            label:'CPC',                         fmt:'yen', type:'derived'},
  {key:'mcvr',           label:'mCVR',                        fmt:'pct', type:'derived'},
  {key:'cvr',            label:'CVR',                         fmt:'pct', type:'derived'},
  {key:'divergence',     label:'\u4e56\u96e2\u7387',                      fmt:'pct', type:'derived'},
  {key:'cpa_reg',        label:'\u767b\u9332CPA',                     fmt:'yen', type:'derived'},
  {key:'answer_rate',    label:'\u56de\u7b54\u7387',                      fmt:'pct', type:'derived'},
  {key:'cpa_answer',     label:'\u56de\u7b54CPA',                     fmt:'yen', type:'derived'},
  {key:'cpa_booking',    label:'\u4e88\u7d04CPA',                     fmt:'yen', type:'derived'},
  {key:'join_rate',      label:'\u53c2\u52a0\u7387',                      fmt:'pct', type:'derived'},
  {key:'cpa_join',       label:'\u53c2\u52a0CPA',                     fmt:'yen', type:'derived'},
  {key:'cpa_join_calc',  label:'\u53c2\u52a0CPA(\u56de\u7b54CPA\u00f7\u53c2\u52a0\u7387)',    fmt:'yen', type:'derived'},
  {key:'seat_first',     label:'\u7740\u5ea7\u5358\u4fa1(\u521d\u56de)',              fmt:'yen', type:'derived'},
  {key:'seat_ltv',       label:'\u7740\u5ea7\u5358\u4fa1(LTV12m)',            fmt:'yen', type:'derived'},
  {key:'deal_rate',      label:'\u6210\u7d04\u7387',                      fmt:'pct', type:'derived'},
  {key:'cpo',            label:'CPO',                         fmt:'yen', type:'derived'},
  {key:'avg_first',      label:'\u5e73\u5747\u5358\u4fa1(\u521d\u56de)',              fmt:'yen', type:'derived'},
  {key:'avg_ltv',        label:'\u5e73\u5747\u5358\u4fa1(LTV12m)',            fmt:'yen', type:'derived'},
  {key:'roas_first',     label:'ROAS(\u521d\u56de)',                  fmt:'pct', type:'derived'},
  {key:'roas_ltv',       label:'ROAS(LTV12m)',                fmt:'pct', type:'derived'},
  {key:'ad_ratio_first', label:'\u5e83\u544a\u8cbb\u7387(\u521d\u56de)',              fmt:'pct', type:'derived'},
  {key:'ad_ratio_ltv',   label:'\u5e83\u544a\u8cbb\u7387(LTV12m)',            fmt:'pct', type:'derived'},
];

export const DEFAULT_DIMENSIONS = [
  {key:'action_date',  label:'\u65e5\u4ed8',   field:'action_date', type:'date'},
  {key:'month',        label:'\u6708',     field:'action_date', type:'month'},
  {key:'dow',          label:'\u66dc\u65e5',   field:'action_date', type:'dow'},
  {key:'operator',     label:'\u4ee3\u7406\u5e97', field:'operator',    type:'value'},
  {key:'media',        label:'\u5a92\u4f53',   field:'media',       type:'value'},
  {key:'route',        label:'\u30eb\u30fc\u30c8', field:'route',       type:'value'},
  {key:'seminar_type', label:'\u8a34\u6c42',   field:'seminar_type',type:'value'},
  {key:'funnel',       label:'\u30d5\u30a1\u30cd\u30eb',field:'funnel',     type:'value'},
];

export const DEFAULT_VIEWS_INIT = {
  summary_daily: {label:'\u5168\u4f53\u30b5\u30de\u30ea\u30fc',         dims:['action_date'], filter: null},
  summary_month: {label:'\u5168\u4f53\u30b5\u30de\u30ea\u30fc_\u6708\u5168\u4f53',  dims:['month'],       filter: null},
  non_ad:        {label:'\u5e83\u544a\u4ee5\u5916\u5408\u7b97',         dims:['action_date'], filter: "r.funnel !== '\u5e83\u544a'"},
  ad_only:       {label:'\u5e83\u544a\u5408\u7b97',             dims:['action_date'], filter: "r.funnel === '\u5e83\u544a'"},
  op_media:      {label:'\u4ee3\u7406\u5e97\u00d7\u5a92\u4f53\u3054\u3068',      dims:['action_date','operator','media'], filter: null},
  op_dow:        {label:'\u4ee3\u7406\u5e97\u00d7\u66dc\u65e5\u3054\u3068',      dims:['dow','operator'], filter: null},
  seminar:       {label:'\u8a34\u6c42\u3054\u3068',             dims:['action_date','seminar_type'], filter: null},
  media:         {label:'\u5a92\u4f53\u3054\u3068',             dims:['action_date','media'], filter: null},
  lpcr:          {label:'LP-CR\u3054\u3068',            dims:['action_date','route'], filter: null},
};

export const DEFAULT_FILTER_DEFS = [
  {id: 'from',     type: 'date_from', field: 'action_date', label: '\u958b\u59cb\u65e5'},
  {id: 'to',       type: 'date_to',   field: 'action_date', label: '\u7d42\u4e86\u65e5'},
  {id: 'operator', type: 'multi',     field: 'operator',    label: 'operator'},
  {id: 'media',    type: 'multi',     field: 'media',       label: 'media'},
];

export const DEFAULT_BASE_FORMULAS = {
  ad_cost:     "sum(amount_1) where funnel = '\u5e83\u544a'",
  ad_cost_fee: "sum(amount_2) where funnel = '\u5e83\u544a'",
  impression:  "sum(impression) where funnel = '\u5e83\u544a'",
  reach:       "sum(reach) where funnel = '\u5e83\u544a'",
  clicks:      "sum(clicks) where funnel = '\u5e83\u544a'",
  mcv:         "sum(cv) where funnel = '\u5e83\u544a'",
  line_reg:    "sum(ac_count) where funnel = 'LINE\u767b\u9332'",
  answer:      "sum(ac_count) where funnel = '\u56de\u7b54'",
  booking:     "sum(ac_count) where funnel = '\u4e88\u7d04'",
  join:        "sum(ac_count) where funnel = '\u53c2\u52a0'",
  deal:        "sum(ac_count) where funnel = '\u6210\u7d04'",
  rev_first:   "sum(amount_1) where funnel = '\u6210\u7d04'",
  rev_ltv:     "sum(amount_2) where funnel = '\u6210\u7d04'",
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

export const DOW_LABELS = ['\u65e5','\u6708','\u706b','\u6c34','\u6728','\u91d1','\u571f'];
export const DOW_ORDER = {'\u65e5':0,'\u6708':1,'\u706b':2,'\u6c34':3,'\u6728':4,'\u91d1':5,'\u571f':6};

export const PERM_DEFS = [
  {key: 'editPreset',   label: '\u30d7\u30ea\u30bb\u30c3\u30c8\u3092\u7de8\u96c6'},
  {key: 'savePreset',   label: '\u30d7\u30ea\u30bb\u30c3\u30c8\u3092\u65b0\u898f\u4fdd\u5b58'},
  {key: 'deletePreset', label: '\u30d7\u30ea\u30bb\u30c3\u30c8\u3092\u524a\u9664'},
  {key: 'addCustom',    label: '\u30ab\u30b9\u30bf\u30e0\u30bf\u30d6\u3092\u8ffd\u52a0'},
  {key: 'editCustom',   label: '\u30ab\u30b9\u30bf\u30e0\u30bf\u30d6\u3092\u7de8\u96c6'},
  {key: 'deleteCustom', label: '\u30ab\u30b9\u30bf\u30e0\u30bf\u30d6\u3092\u524a\u9664'},
  {key: 'editMetrics',  label: '\u30e1\u30c8\u30ea\u30af\u30b9\u5b9a\u7fa9\u3092\u5909\u66f4'},
  {key: 'editFilters',  label: '\u30d5\u30a3\u30eb\u30bf\u5b9a\u7fa9\u3092\u5909\u66f4'},
  {key: 'editDimensions', label: '\u30c7\u30a3\u30e1\u30f3\u30b7\u30e7\u30f3\u5b9a\u7fa9\u3092\u5909\u66f4'},
  {key: 'editDefaults', label: '\u6a19\u6e96\u5b9a\u7fa9\u3092\u5909\u66f4'},
  {key: 'manageUsers',  label: '\u30e6\u30fc\u30b6\u30fc\u7ba1\u7406'},
];

export const ADMIN_PERMS = Object.fromEntries(PERM_DEFS.map(p => [p.key, true]));
export const VIEWER_PERMS = Object.fromEntries(PERM_DEFS.map(p => [p.key, false]));
export const PALETTE = ['#2563eb', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#7c3aed', '#ec4899', '#14b8a6'];

// ===== STORAGE KEYS =====
export const METRIC_DEFS_KEY = 'dashboard.metricDefs.v1';
export const DIMENSIONS_KEY = 'dashboard.dimensions.v1';
export const VIEWS_KEY = 'dashboard.views.v1';
export const FILTER_DEFS_KEY = 'dashboard.filterDefs.v1';
export const STATE_KEY = 'dashboard.state.v1';
export const PRESETS_KEY = 'dashboard.presets.all.v1';
export const SIDEBAR_KEY = 'dashboard.sidebar.collapsed';
export const PANELS_KEY = 'dashboard.panels.collapsed';
export const COL_WIDTHS_KEY = 'dashboard.colWidths.v1';
export const CUSTOM_TABS_KEY = 'dashboard.customTabs.v1';
export const GROUPS_KEY = 'dashboard.sidebarGroups.v1';
export const VIEW_ORDER_KEY = 'dashboard.viewOrder.v1';
export const USERS_KEY = 'dashboard.users.v1';
export const CURRENT_USER_KEY = 'dashboard.currentUser.v1';
export const FORMULAS_KEY = 'dashboard.metricFormulas.v1';
export const BASE_FORMULAS_KEY = 'dashboard.baseMetricFormulas.v1';
export const BUILTIN_SEED_VERSION = 2;

// ===== SHARED MUTABLE STATE =====
export const S = {
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
};

// ===== COMPILE FILTER =====
export function compileFilter(expr) {
  if (!expr) return null;
  try { return new Function('r', `"use strict"; return (${expr});`); }
  catch (e) { return null; }
}

// ===== STORAGE HELPERS =====
export function saveMetricDefs() {
  try { localStorage.setItem(METRIC_DEFS_KEY, JSON.stringify(S.METRIC_DEFS)); } catch (e) {}
}
export function saveDimensions() {
  try { localStorage.setItem(DIMENSIONS_KEY, JSON.stringify(S.DIMENSIONS)); } catch (e) {}
}
export function saveViews() {
  try {
    const serialize = {};
    for (const [k, v] of Object.entries(S.VIEWS)) {
      serialize[k] = {label: v.label, dims: v.dims, filterExpr: v.filterExpr || null, presetName: v.presetName || v.label};
    }
    localStorage.setItem(VIEWS_KEY, JSON.stringify(serialize));
  } catch (e) {}
}
export function saveFilterDefs() {
  try { localStorage.setItem(FILTER_DEFS_KEY, JSON.stringify(S.FILTER_DEFS)); } catch (e) {}
}
export function saveColWidths() {
  try { localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(S.COL_WIDTHS)); } catch (e) {}
}
export function saveBaseFormulas() {
  try { localStorage.setItem(BASE_FORMULAS_KEY, JSON.stringify(S.BASE_FORMULAS)); } catch (e) {}
}
export function saveFormulas() {
  try { localStorage.setItem(FORMULAS_KEY, JSON.stringify(S.METRIC_FORMULAS)); } catch (e) {}
}
export function getPresets() {
  try {
    const v = JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}
export function setPresets(list) {
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(list)); } catch (e) {}
}
export function saveCustomTabs() {
  try { localStorage.setItem(CUSTOM_TABS_KEY, JSON.stringify(S.CUSTOM_TABS)); } catch (e) {}
}
export function saveViewOrder() {
  try { localStorage.setItem(VIEW_ORDER_KEY, JSON.stringify(S.VIEW_ORDER)); } catch (e) {}
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
    localStorage.setItem(STATE_KEY, JSON.stringify({
      charts: S.CHARTS,
      currentView: S.CURRENT_VIEW,
      tabStates: S.TAB_STATES,
    }));
  } catch (e) {}
}

// ===== INIT STATE FROM STORAGE =====
export function initStateFromStorage() {
  // METRIC_DEFS
  S.METRIC_DEFS = JSON.parse(JSON.stringify(DEFAULT_METRIC_DEFS));
  try {
    const saved = JSON.parse(localStorage.getItem(METRIC_DEFS_KEY) || 'null');
    if (Array.isArray(saved) && saved.length) S.METRIC_DEFS = saved.map(m => ({key: m.key, label: m.label, fmt: m.fmt || 'int', type: m.type || 'derived'}));
  } catch (e) {}
  S.SELECTED_METRICS = S.METRIC_DEFS.map(m => m.key);

  // DIMENSIONS
  S.DIMENSIONS = JSON.parse(JSON.stringify(DEFAULT_DIMENSIONS));
  try {
    const saved = JSON.parse(localStorage.getItem(DIMENSIONS_KEY) || 'null');
    if (Array.isArray(saved) && saved.length) S.DIMENSIONS = saved.map(d => ({key: d.key, label: d.label, field: d.field || d.key, type: d.type || 'value'}));
  } catch (e) {}

  // VIEWS
  S.VIEWS = {};
  for (const [k, v] of Object.entries(DEFAULT_VIEWS_INIT)) {
    S.VIEWS[k] = {label: v.label, dims: [...v.dims], filterExpr: v.filter, filter: compileFilter(v.filter), presetName: v.label};
  }
  try {
    const saved = JSON.parse(localStorage.getItem(VIEWS_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      S.VIEWS = {};
      for (const [k, v] of Object.entries(saved)) {
        S.VIEWS[k] = {label: v.label, dims: Array.isArray(v.dims) ? v.dims : [], filterExpr: v.filterExpr || null, filter: compileFilter(v.filterExpr), presetName: v.presetName || v.label};
      }
    }
  } catch (e) {}
  S.VIEW_ORDER = Object.keys(S.VIEWS);

  // FILTER_DEFS
  S.FILTER_DEFS = JSON.parse(JSON.stringify(DEFAULT_FILTER_DEFS));
  try {
    const saved = JSON.parse(localStorage.getItem(FILTER_DEFS_KEY) || 'null');
    if (Array.isArray(saved) && saved.length) S.FILTER_DEFS = saved;
  } catch (e) {}

  // COL_WIDTHS
  try { S.COL_WIDTHS = JSON.parse(localStorage.getItem(COL_WIDTHS_KEY) || '{}'); } catch (e) {}

  // FORMULAS
  S.BASE_FORMULAS = {...DEFAULT_BASE_FORMULAS};
  try {
    const saved = JSON.parse(localStorage.getItem(BASE_FORMULAS_KEY) || '{}');
    if (saved && typeof saved === 'object') S.BASE_FORMULAS = {...DEFAULT_BASE_FORMULAS, ...saved};
  } catch (e) {}
  S.METRIC_FORMULAS = {...DEFAULT_FORMULAS};
  try {
    const saved = JSON.parse(localStorage.getItem(FORMULAS_KEY) || '{}');
    if (saved && typeof saved === 'object') S.METRIC_FORMULAS = {...DEFAULT_FORMULAS, ...saved};
  } catch (e) {}

  // USERS
  S.USERS = [
    {id: 'admin',  password: 'admin',  name: '\u7ba1\u7406\u8005', isAdmin: true,  perms: {...ADMIN_PERMS}},
    {id: 'viewer', password: 'viewer', name: '\u95b2\u89a7\u8005', isAdmin: false, perms: {...VIEWER_PERMS}},
  ];
}
