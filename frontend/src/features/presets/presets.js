import { S, DEFAULT_VIEWS_INIT, BUILTIN_SEED_VERSION, DEFAULT_TABLE_CONFIG, getPresets, createPresetOp, updatePresetOp, deletePresetOp, reorderPresetsOp, syncCurrentTabState, getTabFilterState, serializeFilterValues } from '../../app/state.js';
import { escapeHtml, hexToSoft } from '../../shared/utils/utils.js';
import { showModal } from '../../shared/ui/modal.js';
import { hasPerm } from '../../app/auth.js';
import { emit } from '../../app/events.js';
import { getTableState, setTableState } from '../dashboard/table/table.js';

// ===== Presets =====
// 共通閾値定義
const T_CTR       = {ctr:       {min:0.005, minOp:'<=', max:0.01,  maxOp:'<=', target:0.015, targetOp:'>='}};
const T_CPC       = {cpc:       {min:500,   minOp:'>=', max:300,   maxOp:'>=', target:150,   targetOp:'<='}};
const T_CVR       = {cvr:       {min:0.01,  minOp:'<=', max:0.03,  maxOp:'<=', target:0.05,  targetOp:'>='}};
const T_CPA_REG   = {cpa_reg:   {min:15000, minOp:'>=', max:10000, maxOp:'>=', target:5000,  targetOp:'<='}};
const T_CPA_ANS   = {cpa_answer:{min:25000, minOp:'>=', max:18000, maxOp:'>=', target:10000, targetOp:'<='}};
const T_CPA_JOIN  = {cpa_join:  {min:40000, minOp:'>=', max:30000, maxOp:'>=', target:20000, targetOp:'<='}};
const T_CPO       = {cpo:       {min:80000, minOp:'>=', max:60000, maxOp:'>=', target:40000, targetOp:'<='}};
const T_ROAS_LTV  = {roas_ltv:  {min:1.0,   minOp:'<=', max:2.0,   maxOp:'<=', target:3.0,   targetOp:'>='}};
const T_ANS_RATE  = {answer_rate:{min:0.3,  minOp:'<=', max:0.5,   maxOp:'<=', target:0.7,   targetOp:'>='}};
const T_JOIN_RATE = {join_rate:  {min:0.3,  minOp:'<=', max:0.5,   maxOp:'<=', target:0.7,   targetOp:'>='}};
const T_DEAL_RATE = {deal_rate:  {min:0.1,  minOp:'<=', max:0.2,   maxOp:'<=', target:0.3,   targetOp:'>='}};

export const BUILTIN_PRESET_DEFS = {
  summary_daily: {
    charts: [
      {metric: 'ad_cost',  type: 'area', size: 'main', color: '#2563eb'},
      {metric: 'clicks',   type: 'line', size: 'sub',  color: '#0ea5e9'},
      {metric: 'line_reg', type: 'bar',  size: 'sub',  color: '#10b981'},
      {metric: 'deal',     type: 'bar',  size: 'sub',  color: '#f59e0b'},
    ],
    metrics: ['ad_cost','ad_cost_fee','impression','clicks','ctr','cpc','line_reg','cpa_reg','answer','answer_rate','cpa_answer','booking','join','join_rate','cpa_join','deal','cpo','rev_ltv','roas_ltv'],
    thresholdMetrics: ['ctr','cpc','cpa_reg','cpa_answer','cpa_join','cpo','roas_ltv'],
    thresholds: {...T_CTR,...T_CPC,...T_CPA_REG,...T_CPA_ANS,...T_CPA_JOIN,...T_CPO,...T_ROAS_LTV},
  },
  summary_month: {
    charts: [
      {metric: 'ad_cost',  type: 'bar',  size: 'main', color: '#2563eb'},
      {metric: 'rev_ltv',  type: 'area', size: 'sub',  color: '#10b981'},
      {metric: 'roas_ltv', type: 'line', size: 'sub',  color: '#7c3aed'},
    ],
    metrics: ['ad_cost','ad_cost_fee','impression','clicks','line_reg','cpa_reg','answer','booking','join','deal','cpo','rev_first','rev_ltv','roas_first','roas_ltv'],
    thresholdMetrics: ['cpa_reg','cpo','roas_ltv'],
    thresholds: {...T_CPA_REG,...T_CPO,...T_ROAS_LTV},
  },
  non_ad: {
    charts: [
      {metric: 'line_reg', type: 'line', size: 'main', color: '#10b981'},
      {metric: 'answer',   type: 'bar',  size: 'sub',  color: '#0ea5e9'},
      {metric: 'join',     type: 'bar',  size: 'sub',  color: '#7c3aed'},
      {metric: 'deal',     type: 'bar',  size: 'sub',  color: '#f59e0b'},
    ],
    metrics: ['line_reg','answer','answer_rate','booking','join','join_rate','seat_first','seat_ltv','deal','deal_rate','avg_first','avg_ltv','rev_first','rev_ltv'],
    thresholdMetrics: ['answer_rate','join_rate','deal_rate'],
    thresholds: {...T_ANS_RATE,...T_JOIN_RATE,...T_DEAL_RATE},
  },
  ad_only: {
    charts: [
      {metric: 'ad_cost',    type: 'area', size: 'main', color: '#2563eb'},
      {metric: 'impression', type: 'bar',  size: 'sub',  color: '#0ea5e9'},
      {metric: 'ctr',        type: 'line', size: 'sub',  color: '#10b981'},
      {metric: 'cpc',        type: 'line', size: 'sub',  color: '#f59e0b'},
    ],
    metrics: ['ad_cost','ad_cost_fee','impression','cpm','reach','clicks','ctr','cpc','mcv','mcvr','cvr','divergence'],
    thresholdMetrics: ['ctr','cpc','cvr'],
    thresholds: {...T_CTR,...T_CPC,...T_CVR},
  },
  op_media: {
    charts: [
      {metric: 'ad_cost',  type: 'bar',  size: 'main', color: '#2563eb'},
      {metric: 'cpa_reg',  type: 'line', size: 'sub',  color: '#f59e0b'},
      {metric: 'roas_ltv', type: 'bar',  size: 'sub',  color: '#10b981'},
    ],
    metrics: ['ad_cost','impression','clicks','ctr','cpc','cvr','line_reg','cpa_reg','cpa_answer','cpa_booking','deal','cpo','roas_ltv'],
    thresholdMetrics: ['cpa_reg','cpo','roas_ltv'],
    thresholds: {...T_CPA_REG,...T_CPO,...T_ROAS_LTV},
  },
  op_dow: {
    charts: [
      {metric: 'ad_cost',  type: 'bar', size: 'main', color: '#2563eb'},
      {metric: 'cvr',      type: 'bar', size: 'sub',  color: '#10b981'},
      {metric: 'cpa_reg',  type: 'bar', size: 'sub',  color: '#f59e0b'},
    ],
    metrics: ['ad_cost','clicks','ctr','cvr','line_reg','cpa_reg','cpa_answer','deal','cpo'],
    thresholdMetrics: ['cvr','cpa_reg','cpo'],
    thresholds: {...T_CVR,...T_CPA_REG,...T_CPO},
  },
  seminar: {
    charts: [
      {metric: 'join',        type: 'bar',  size: 'main', color: '#7c3aed'},
      {metric: 'answer_rate', type: 'line', size: 'sub',  color: '#10b981'},
      {metric: 'join_rate',   type: 'line', size: 'sub',  color: '#0ea5e9'},
      {metric: 'cpo',         type: 'bar',  size: 'sub',  color: '#f59e0b'},
    ],
    metrics: ['line_reg','answer','answer_rate','cpa_answer','booking','join','join_rate','cpa_join','deal','deal_rate','cpo'],
    thresholdMetrics: ['answer_rate','join_rate','deal_rate','cpo'],
    thresholds: {...T_ANS_RATE,...T_JOIN_RATE,...T_DEAL_RATE,...T_CPO},
  },
  media: {
    charts: [
      {metric: 'ad_cost',  type: 'bar',  size: 'main', color: '#2563eb'},
      {metric: 'cpa_reg',  type: 'line', size: 'sub',  color: '#f59e0b'},
      {metric: 'cvr',      type: 'line', size: 'sub',  color: '#10b981'},
      {metric: 'roas_ltv', type: 'bar',  size: 'sub',  color: '#7c3aed'},
    ],
    metrics: ['ad_cost','impression','clicks','ctr','cpc','cvr','line_reg','cpa_reg','cpa_answer','deal','cpo','rev_ltv','roas_ltv'],
    thresholdMetrics: ['ctr','cvr','cpa_reg','cpo','roas_ltv'],
    thresholds: {...T_CTR,...T_CVR,...T_CPA_REG,...T_CPO,...T_ROAS_LTV},
  },
  lpcr: {
    charts: [
      {metric: 'cvr',        type: 'bar',  size: 'main', color: '#10b981'},
      {metric: 'mcvr',       type: 'line', size: 'sub',  color: '#0ea5e9'},
      {metric: 'divergence', type: 'area', size: 'sub',  color: '#f59e0b'},
      {metric: 'cpa_reg',    type: 'bar',  size: 'sub',  color: '#7c3aed'},
    ],
    metrics: ['clicks','mcv','mcvr','cvr','divergence','line_reg','cpa_reg'],
    thresholdMetrics: ['cvr','cpa_reg'],
    thresholds: {...T_CVR,...T_CPA_REG},
  },
};

export async function seedDefaultPresets() {
  // backend が POST/PUT 時点で同名を 409 で弾くので dedup ロジックは不要。
  // 既存プリセットがあれば seed 済み扱い。
  const existing = getPresets();
  if (existing.length > 0) return;
  // 初回 seed: 各 builtin を POST で作って id 付きでキャッシュ。
  for (const [k, v] of Object.entries(S.VIEWS)) {
    const initDef = DEFAULT_VIEWS_INIT[k];
    const presetDef = initDef ? (BUILTIN_PRESET_DEFS[k] || null) : null;
    const def = presetDef || {
      charts: [{metric: 'ad_cost', type: 'bar', size: 'main', color: '#2563eb'}],
      metrics: S.METRIC_DEFS.map(m => m.key),
    };
    const preset = {
      name: v.presetName || v.label,
      builtin: true,
      seedVersion: BUILTIN_SEED_VERSION,
      charts: def.charts.map((c, i) => ({id: i + 1, metric: c.metric, type: c.type, size: c.size, color: c.color, name: '', bucket: 'auto'})),
      dims: [...v.dims],
      metrics: [...def.metrics],
      thresholds: def.thresholds ? JSON.parse(JSON.stringify(def.thresholds)) : {},
      thresholdMetrics: def.thresholdMetrics ? [...def.thresholdMetrics] : [],
    };
    try { await createPresetOp(preset); }
    catch (e) { /* 個別失敗は無視、次回起動で再 seed される */ }
  }
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
        const ren = `<button type="button" class="preset-ren" data-idx="${i}" title="\u540d\u524d\u3092\u5909\u66f4">\u270e</button>`;
        const dup = `<button type="button" class="preset-dup" data-idx="${i}" title="\u8907\u88fd">\u29c9</button>`;
        const del = p.builtin ? '' : `<button type="button" class="preset-del" data-idx="${i}" title="\u524a\u9664">\u00d7</button>`;
        const editing = S.PRESET_EDIT_IDX === i ? ' editing' : '';
        const title = p.builtin ? '\u6a19\u6e96\u30d7\u30ea\u30bb\u30c3\u30c8\uff08\u30af\u30ea\u30c3\u30af\u3067\u7de8\u96c6\u3001\u524a\u9664\u4e0d\u53ef\uff09' : '\u30af\u30ea\u30c3\u30af\u3067\u7de8\u96c6';
        return `<div class="preset-item${p.builtin?' builtin':''}${editing}" data-idx="${i}" data-drag-key="${escapeHtml(p.name)}" draggable="true" style="--preset-color:${color};--preset-color-soft:${soft}"><span class="preset-name" title="${title}">${badge}${escapeHtml(p.name)}</span>${ren}${dup}${del}</div>`;
      }).join('')
    : '<div class="preset-empty">\u4fdd\u5b58\u306a\u3057</div>';
}

// FILTER_VALUES の Set ↔ Array 変換 (Array → Set のデシリアライズはここ、シリアライズは state.js から import)。
function deserializeFilterValues(values) {
  const out = {};
  for (const [k, v] of Object.entries(values || {})) {
    out[k] = Array.isArray(v) ? new Set(v) : v;
  }
  return out;
}

export function loadPresetIntoGlobals(p) {
  // 全フィールド保持(lines, smoothLine, dotSize, lineWidth, showDataLabels 等)
  // p.charts が空/未定義でも S.CHARTS を必ずリセット (= 削除タブの古いチャートが残らない)
  S.CHARTS = Array.isArray(p.charts) ? p.charts.map(c => ({...c, color: c.color || '#2563eb', name: c.name || '', bucket: c.bucket || 'auto'})) : [];
  S.CHART_ID_SEQ = S.CHARTS.length ? Math.max(0, ...S.CHARTS.map(c => c.id)) + 1 : 1;
  S.CARDS = Array.isArray(p.cards) ? p.cards.map(c => ({...c})) : [];
  S.CARD_ID_SEQ = S.CARDS.length ? Math.max(0, ...S.CARDS.map(c => c.id)) + 1 : 1;
  S.SELECTED_DIMS = Array.isArray(p.dims) && p.dims.length ? [...p.dims] : ['action_date'];
  S.SELECTED_METRICS = Array.isArray(p.metrics) && p.metrics.length ? [...p.metrics] : S.METRIC_DEFS.map(m => m.key);
  S.THRESHOLDS = p.thresholds && typeof p.thresholds === 'object' ? JSON.parse(JSON.stringify(p.thresholds)) : {};
  S.THRESHOLD_METRICS = Array.isArray(p.thresholdMetrics) ? [...p.thresholdMetrics] : [];
  if (p.tableState) setTableState(p.tableState);
  // プリセットにテーブル設定があれば復元、無ければデフォルトでリセット (前タブの設定が残らないように)。
  S.TABLE_CONFIG = p.tableConfig
    ? JSON.parse(JSON.stringify(p.tableConfig))
    : JSON.parse(JSON.stringify(DEFAULT_TABLE_CONFIG));
  if (!S.TABLE_CONFIG.table)        S.TABLE_CONFIG.table = {};
  if (!S.TABLE_CONFIG.styles)       S.TABLE_CONFIG.styles = {};
  if (!S.TABLE_CONFIG.headerStyles) S.TABLE_CONFIG.headerStyles = {};
}

// プリセット適用時のフィルタ上書き。
// preset 優先: filterValues が無い場合は空にする(リセット)。
export function applyPresetFilters(p) {
  if (p && p.filterValues && typeof p.filterValues === 'object') {
    S.FILTER_VALUES = deserializeFilterValues(p.filterValues);
    S.FILTER_CONDITIONS = p.filterConditions ? JSON.parse(JSON.stringify(p.filterConditions)) : {};
  } else {
    S.FILTER_VALUES = {};
    S.FILTER_CONDITIONS = {};
  }
}

export async function savePresetPrompt() {
  const name = await showModal({title: '\u65b0\u3057\u3044\u30d7\u30ea\u30bb\u30c3\u30c8\u3092\u4fdd\u5b58', body: '\u30d7\u30ea\u30bb\u30c3\u30c8\u540d\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044', input: true, placeholder: '\u4f8b: \u6708\u6b21\u30ec\u30d3\u30e5\u30fc\u7528', okText: '\u4fdd\u5b58', noEnter: true});
  if (!name) return;
  const list = getPresets();
  // \u6a19\u6e96/\u30de\u30a4\u554f\u308f\u305a\u540c\u540d\u304c\u3042\u308c\u3070\u4fdd\u5b58\u4e0d\u53ef (backend \u5074\u306e 409 \u3068\u6319\u52d5\u3092\u63c3\u3048\u308b)
  if (list.some(p => p.name === name)) {
    await showModal({title: '\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093', body: '\u540c\u3058\u540d\u524d\u306e\u30d7\u30ea\u30bb\u30c3\u30c8\u304c\u65e2\u306b\u5b58\u5728\u3057\u307e\u3059\u3002\u5225\u306e\u540d\u524d\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044\u3002', okText: 'OK', cancelText: ''});
    return;
  }
  const PRESET_COLORS = ['#7c3aed','#10b981','#f59e0b','#ef4444','#0ea5e9','#ec4899','#14b8a6','#8b5cf6'];
  const userCount = list.filter(p => !p.builtin).length;
  const entry = {
    name,
    color: PRESET_COLORS[userCount % PRESET_COLORS.length],
    charts: S.CHARTS.map(c => ({...c})),
    cards: S.CARDS.map(c => ({...c})),
    dims: [...S.SELECTED_DIMS],
    metrics: [...S.SELECTED_METRICS],
    thresholds: JSON.parse(JSON.stringify(S.THRESHOLDS)),
    thresholdMetrics: [...S.THRESHOLD_METRICS],
    tableState: getTableState(),
    tableConfig: JSON.parse(JSON.stringify(S.TABLE_CONFIG || DEFAULT_TABLE_CONFIG)),
    filterValues: serializeFilterValues(S.FILTER_VALUES),
    filterConditions: JSON.parse(JSON.stringify(S.FILTER_CONDITIONS || {})),
  };
  // 同名は上のチェックで弾かれているので純粋な新規作成のみ
  try { await createPresetOp(entry); }
  catch (e) { return; }
  renderPresets();
  const idx = S.PRESETS_CACHE.findIndex(p => p.name === name);
  const newItem = document.querySelector(`#preset-list [data-idx="${idx}"].preset-load`);
  if (newItem) {
    newItem.scrollIntoView({behavior: 'smooth', block: 'nearest'});
    newItem.closest('.preset-item')?.classList.add('preset-flash');
    setTimeout(() => newItem.closest('.preset-item')?.classList.remove('preset-flash'), 1400);
  }
  return name; // 呼び出し側 (カスタムタブからの保存) が新規プリセット名を利用できるよう返す
}

export async function duplicatePreset(i) {
  const list = getPresets();
  const src = list[i];
  if (!src) return;
  // 既存と被らない初期名を作る ("○○ のコピー" → "○○ のコピー 2" → ...)
  const base = `${src.name} のコピー`;
  let name = base;
  let n = 2;
  while (list.some(p => p.name === name)) name = `${base} ${n++}`;
  const input = await showModal({
    title: 'プリセットを複製',
    body: `「${src.name}」を複製します。新しいプリセット名を入力してください。`,
    input: true,
    placeholder: name,
    defaultValue: name,
    okText: '複製',
    noEnter: true,
  });
  if (!input) return;
  // 標準/マイ問わず同名があれば複製不可 (backend 側の 409 と挙動を揃える)
  if (list.some(p => p.name === input)) {
    await showModal({title: '複製できません', body: '同じ名前のプリセットが既に存在します。別の名前を入力してください。', okText: 'OK', cancelText: ''});
    return;
  }
  // builtin フラグと元 doc id は継承しない (id 継承すると batch 内で元が上書きされる)。
  const copy = JSON.parse(JSON.stringify(src));
  delete copy.builtin;
  delete copy.id;
  copy.name = input;
  const srcId = src.id;
  try {
    const created = await createPresetOp(copy);
    // 元の直後に並べ替える (作成直後は末尾に追加されているので reorder が必要)
    if (srcId && created?.id) {
      const cache = S.PRESETS_CACHE;
      const srcIdx = cache.findIndex(p => p.id === srcId);
      const newIdx = cache.findIndex(p => p.id === created.id);
      if (srcIdx >= 0 && newIdx >= 0 && newIdx !== srcIdx + 1) {
        const orderIds = cache.map(p => p.id);
        const [movedId] = orderIds.splice(newIdx, 1);
        // 削除で srcIdx が左にシフトするケースを補正
        const srcIdxAfter = newIdx < srcIdx ? srcIdx - 1 : srcIdx;
        orderIds.splice(srcIdxAfter + 1, 0, movedId);
        await reorderPresetsOp(orderIds);
      }
    }
  } catch (e) { return; }
  renderPresets();
  renderTabPresetSelect();
  const newIdx = S.PRESETS_CACHE.findIndex(p => p.name === input);
  const newItem = document.querySelector(`#preset-list [data-idx="${newIdx}"]`);
  if (newItem) {
    newItem.scrollIntoView({behavior: 'smooth', block: 'nearest'});
    newItem.classList.add('preset-flash');
    setTimeout(() => newItem.classList.remove('preset-flash'), 1400);
  }
}

export async function renamePreset(i) {
  const list = getPresets();
  const target = list[i];
  if (!target || !target.id) return;
  if (!hasPerm('editPreset')) {
    await showModal({title: '権限がありません', body: 'プリセット編集権限がありません', okText: 'OK', cancelText: ''});
    return;
  }
  const input = await showModal({
    title: 'プリセット名を変更',
    body: `「${target.name}」の新しい名前を入力してください。`,
    input: true,
    defaultValue: target.name,
    okText: '変更',
    noEnter: true,
  });
  if (!input) return;
  const newName = input.trim();
  if (!newName || newName === target.name) return;
  // 同名衝突チェック (backend も 409 で弾くが UX のため先に client 側でチェック)
  if (list.some(p => p.id !== target.id && p.name === newName)) {
    await showModal({title: '変更できません', body: '同じ名前のプリセットが既に存在します。別の名前を入力してください。', okText: 'OK', cancelText: ''});
    return;
  }
  try { await updatePresetOp(target.id, { ...target, name: newName }); }
  catch (e) { return; }
  // 標準タブが旧名を参照している場合は追従させる (再描画で反映)
  for (const [k, v] of Object.entries(S.VIEWS)) {
    if (v.presetName === target.name) v.presetName = newName;
  }
  renderPresets();
  renderTabPresetSelect();
}

export async function deletePreset(i) {
  const list = getPresets();
  const target = list[i];
  if (!target || target.builtin) return;
  const ok = await showModal({title: '\u30d7\u30ea\u30bb\u30c3\u30c8\u524a\u9664', body: `\u300c${target.name}\u300d\u3092\u524a\u9664\u3057\u307e\u3059\u304b\uff1f\u3053\u306e\u64cd\u4f5c\u306f\u53d6\u308a\u6d88\u305b\u307e\u305b\u3093\u3002`, okText: '\u524a\u9664', danger: true});
  if (!ok) return;
  if (!target.id) return; // id \u672a\u53d6\u5f97\u306e preset \u306f\u524a\u9664\u4e0d\u53ef (\u901a\u5e38\u306f listPresets \u7d4c\u7531\u3067\u5fc5\u305a id \u304c\u4ed8\u304f)
  try { await deletePresetOp(target.id); }
  catch (e) { return; }
  renderPresets();
  renderTabPresetSelect();
}

// プリセット編集の dirty 判定用ベースライン (シリアライズ済み)。
// enter で記録 → syncPresetEdit 成功で更新 → exit で null。
// null の間は「編集モードに入っていない」= dirty ではない扱い。
let _presetEditSnapshot = null;

// syncPresetEdit と同じフィールドをシリアライズ (save 内容と一致させる)。
function computePresetEditSnapshot() {
  if (S.PRESET_EDIT_IDX == null) return null;
  const picker = document.getElementById('preset-color-picker');
  return JSON.stringify({
    charts: S.CHARTS || [],
    cards: S.CARDS || [],
    dims: S.SELECTED_DIMS || [],
    metrics: S.SELECTED_METRICS || [],
    thresholds: S.THRESHOLDS || {},
    thresholdMetrics: S.THRESHOLD_METRICS || [],
    tableConfig: S.TABLE_CONFIG || DEFAULT_TABLE_CONFIG,
    tableState: getTableState(),
    filterValues: serializeFilterValues(S.FILTER_VALUES),
    filterConditions: S.FILTER_CONDITIONS || {},
    color: picker?.value || '',
  });
}

// 未保存変更ガード用。編集モードで snapshot と現在値が異なる時だけ dirty。
export function isPresetEditDirty() {
  if (S.PRESET_EDIT_IDX == null) return false;
  if (_presetEditSnapshot == null) return false;
  return _presetEditSnapshot !== computePresetEditSnapshot();
}

// 現在の編集内容を編集中プリセットに反映して PUT を投げる。
// 返り値は PUT 完了の Promise (呼び出し元が await して成功/失敗を判定できる)。
// 成功時のみ snapshot を更新して dirty をクリア。失敗時は dirty のまま残す。
export function syncPresetEdit() {
  if (S.PRESET_EDIT_IDX == null) return Promise.resolve();
  const list = getPresets();
  const p = list[S.PRESET_EDIT_IDX];
  if (!p || !p.id) return Promise.resolve();
  const updated = {
    ...p,
    charts: S.CHARTS.map(c => ({...c})),
    cards: S.CARDS.map(c => ({...c})),
    dims: [...S.SELECTED_DIMS],
    metrics: [...S.SELECTED_METRICS],
    thresholds: JSON.parse(JSON.stringify(S.THRESHOLDS)),
    thresholdMetrics: [...S.THRESHOLD_METRICS],
    tableState: getTableState(),
    tableConfig: JSON.parse(JSON.stringify(S.TABLE_CONFIG || DEFAULT_TABLE_CONFIG)),
    filterValues: serializeFilterValues(S.FILTER_VALUES),
    filterConditions: JSON.parse(JSON.stringify(S.FILTER_CONDITIONS || {})),
    color: document.getElementById('preset-color-picker').value || p.color,
  };
  const snapshotAtSave = computePresetEditSnapshot();
  return updatePresetOp(p.id, updated).then(res => {
    _presetEditSnapshot = snapshotAtSave;
    return res;
  });
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
  applyPresetFilters(p);
  emit('renderFilters');
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
  // globals / DOM 反映後にベースラインを記録
  _presetEditSnapshot = computePresetEditSnapshot();
}

export function exitPresetEdit() {
  S.PRESET_EDIT_IDX = null;
  _presetEditSnapshot = null;
  document.body.classList.remove('preset-editing');
}

// タブ別フィルタ値の復元 (配列→Set 変換)。
// フィルタ状態はユーザー毎に管理(state.js の getTabFilterState 経由で取得)。
// 保存値が無いタブは空フィルタにリセット。
function restoreFilterStateForTab(viewKey) {
  const fs = getTabFilterState(viewKey);
  if (!fs || !fs.filterValues) {
    S.FILTER_VALUES = {};
    S.FILTER_CONDITIONS = {};
    return;
  }
  const newValues = {};
  for (const [k, v] of Object.entries(fs.filterValues)) {
    newValues[k] = Array.isArray(v) ? new Set(v) : v;
  }
  S.FILTER_VALUES = newValues;
  S.FILTER_CONDITIONS = fs.filterConditions ? JSON.parse(JSON.stringify(fs.filterConditions)) : {};
}

export function loadTabState(viewKey) {
  if (S.VIEWS[viewKey]) {
    // 標準タブ: preset を全部優先(フィルタも preset の値を強制適用、per-user state からは復元しない)
    const view = S.VIEWS[viewKey];
    const presetName = view.presetName || view.label;
    const p = getPresets().find(x => x.name === presetName);
    if (p) {
      loadPresetIntoGlobals(p);
      applyPresetFilters(p);
    } else {
      // preset 未存在のフォールバック。CHARTS / CARDS / TABLE_CONFIG も一緒にリセットしないと
      // 直前のタブの内容が残って見える (削除タブの内容が残るバグの一因)。
      S.SELECTED_DIMS = [...view.dims];
      S.SELECTED_METRICS = S.METRIC_DEFS.map(m => m.key);
      S.THRESHOLDS = {};
      S.THRESHOLD_METRICS = [];
      S.FILTER_VALUES = {};
      S.FILTER_CONDITIONS = {};
      S.CHARTS = [];
      S.CHART_ID_SEQ = 1;
      S.CARDS = [];
      S.CARD_ID_SEQ = 1;
      S.TABLE_CONFIG = JSON.parse(JSON.stringify(DEFAULT_TABLE_CONFIG));
      if (!S.TABLE_CONFIG.table)        S.TABLE_CONFIG.table = {};
      if (!S.TABLE_CONFIG.styles)       S.TABLE_CONFIG.styles = {};
      if (!S.TABLE_CONFIG.headerStyles) S.TABLE_CONFIG.headerStyles = {};
    }
    return;
  }
  const st = S.TAB_STATES[viewKey];
  if (!st) return;
  S.SELECTED_DIMS = Array.isArray(st.dims) && st.dims.length ? [...st.dims] : ['action_date'];
  S.SELECTED_METRICS = Array.isArray(st.metrics) ? [...st.metrics] : S.METRIC_DEFS.map(m => m.key);
  S.THRESHOLDS = st.thresholds ? JSON.parse(JSON.stringify(st.thresholds)) : {};
  S.THRESHOLD_METRICS = Array.isArray(st.thresholdMetrics) ? [...st.thresholdMetrics] : [];
  S.TABLE_CONFIG = st.tableConfig
    ? JSON.parse(JSON.stringify(st.tableConfig))
    : JSON.parse(JSON.stringify(DEFAULT_TABLE_CONFIG));
  if (!S.TABLE_CONFIG.table)         S.TABLE_CONFIG.table = {};
  if (!S.TABLE_CONFIG.styles)        S.TABLE_CONFIG.styles = {};
  if (!S.TABLE_CONFIG.headerStyles)  S.TABLE_CONFIG.headerStyles = {};
  // カスタムタブは CHARTS/CARDS を持たない (TAB_STATES に保存していない) ので、
  // 標準タブ→カスタムタブ切替で前タブのチャートが残らないようリセット。
  S.CHARTS = [];
  S.CHART_ID_SEQ = 1;
  S.CARDS = [];
  S.CARD_ID_SEQ = 1;
  restoreFilterStateForTab(viewKey);
}

export function initTabStates() {
  Object.keys(S.VIEWS).forEach(k => {
    if (!S.TAB_STATES[k]) {
      S.TAB_STATES[k] = {
        dims: [...S.VIEWS[k].dims],
        metrics: S.METRIC_DEFS.map(m => m.key),
        thresholds: {},
        thresholdMetrics: [],
        tableConfig: JSON.parse(JSON.stringify(DEFAULT_TABLE_CONFIG)),
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
        tableConfig: JSON.parse(JSON.stringify(DEFAULT_TABLE_CONFIG)),
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

export async function createBuiltinPresetFor(baseName) {
  const list = getPresets();
  let name = baseName;
  let n = 2;
  while (list.some(p => p.name === name)) { name = `${baseName} (${n++})`; }
  const preset = {
    name,
    builtin: true,
    seedVersion: BUILTIN_SEED_VERSION,
    color: '#2563eb',
    charts: [{id: 1, metric: 'ad_cost', type: 'bar', size: 'main', color: '#2563eb', name: '', bucket: 'auto'}],
    dims: ['action_date'],
    metrics: S.METRIC_DEFS.map(m => m.key),
    thresholds: {},
    thresholdMetrics: [],
  };
  try { await createPresetOp(preset); }
  catch (e) { return null; }
  renderPresets();
  renderTabPresetSelect();
  return name;
}

// exitSettingsMode is imported lazily to break circular dep
let _exitSettingsMode = null;
export function setExitSettingsMode(fn) { _exitSettingsMode = fn; }
function exitSettingsMode() { if (_exitSettingsMode) _exitSettingsMode(); }
