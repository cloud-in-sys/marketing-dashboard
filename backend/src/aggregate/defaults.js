// @ts-check
// frontend/src/app/state.js の DEFAULT_* と一致する必要があります。両方を同期して更新してください。
// (Firestore config に該当フィールドが無いソースで、フロントとバックエンドの解釈を揃えるため)

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

// Firestore config と defaults をマージ。
// フロント state.js と同じ規則:
//   フィールドが存在 (キーがある) → そちらを優先 (空でも採用)
//   フィールドが存在しない → defaults を使う
export function resolveConfig(raw) {
  const c = raw || {};
  return {
    metricDefs:   ('metricDefs'   in c) ? (c.metricDefs   || []) : DEFAULT_METRIC_DEFS,
    dimensions:   ('dimensions'   in c) ? (c.dimensions   || []) : DEFAULT_DIMENSIONS,
    baseFormulas: ('baseFormulas' in c) ? (c.baseFormulas || {}) : DEFAULT_BASE_FORMULAS,
    formulas:     ('formulas'     in c) ? (c.formulas     || {}) : DEFAULT_FORMULAS,
    updatedAt: c.updatedAt || '',
  };
}
