import { S, DEFAULT_FORMULAS } from './state.js';
import { fmt, escapeHtml, escapeHtmlNl } from './utils.js';
import { getSparklineConfig, getSparklineSeries, renderSparklineSVG, rowKeyForSparkline, rowDepthForSparkline } from './sparkline.js';
import { dimLabel, dimSort } from './aggregate/dimensions.js';
import { aggregate, baseMetricKeys, derivedMetricKeys, evalFormula } from './aggregate/aggregate.js';
import { openTableSettings, buildCellStyle, buildHeaderCellStyle, buildTableStyle } from './tableSettings.js';

// ===== Table rendering =====
function compare(value, op, threshold) {
  switch (op) {
    case '<':  return value < threshold;
    case '<=': return value <= threshold;
    case '>':  return value > threshold;
    case '>=': return value >= threshold;
    default:   return false;
  }
}

function thresholdClass(metricKey, value) {
  const t = S.THRESHOLDS[metricKey];
  if (!t || !isFinite(value) || value === 0) return '';
  const min = t.min, max = t.max, target = t.target;
  const minOp = t.minOp || '<=';
  const maxOp = t.maxOp || '<=';
  const targetOp = t.targetOp || '>=';
  const hitMin = min != null && compare(value, minOp, min);
  const hitMax = max != null && compare(value, maxOp, max);
  const hitTarget = target != null && compare(value, targetOp, target);
  // 目標達成が最優先、次に最低許容値、最後に最大許容値
  if (hitTarget) return 'cell-blue';
  if (hitMin) return 'cell-red';
  if (hitMax) return 'cell-yellow';
  return '';
}

// Collapsed state: key = "level:value|level:value..."
const collapsedGroups = new Set();

// Zoom
const ZOOM_KEY = 'dashboard.tableZoom';
const DEFAULT_ZOOM = 70;
let tableZoom = DEFAULT_ZOOM;
try { const saved = localStorage.getItem(ZOOM_KEY); if (saved != null) tableZoom = +saved; } catch (e) {}
if (!tableZoom || tableZoom < 50 || tableZoom > 200) tableZoom = DEFAULT_ZOOM;

// Frozen columns
let frozenCount = 1; // default: first dim column frozen

// プリセット連携: テーブルの折り畳み/倍率/固定列を取得・適用
export function getTableState() {
  return {
    collapsedGroups: [...collapsedGroups],
    tableZoom,
    frozenCount,
  };
}
export function setTableState(state) {
  if (!state || typeof state !== 'object') return;
  collapsedGroups.clear();
  if (Array.isArray(state.collapsedGroups)) {
    state.collapsedGroups.forEach(k => collapsedGroups.add(k));
  }
  if (typeof state.tableZoom === 'number' && state.tableZoom >= 50 && state.tableZoom <= 200) {
    tableZoom = state.tableZoom;
    try { localStorage.setItem(ZOOM_KEY, String(tableZoom)); } catch (e) {}
  }
  if (typeof state.frozenCount === 'number' && state.frozenCount >= 0) {
    frozenCount = state.frozenCount;
  }
}

function makeGroupKey(path) {
  return path.map((v, i) => `${i}:${v}`).join('|');
}

function buildMetricCells(agg, metrics, opts = {}, groupVals = null) {
  return metrics.map(m => {
    const spark = getSparklineConfig(m.key);
    if (spark) {
      // sparkline (gauge): データ行・親集計行どちらでも描画。総計行 (groupVals==null) は空セル。
      // 行の agg と inner があれば series 無しでも描けるので、series 取得失敗を理由に空セルにはしない。
      const style = opts.skipColStyle ? '' : buildCellStyle(m.key);
      if (groupVals != null) {
        const series = getSparklineSeries(rowKeyForSparkline(groupVals)) || [];
        const svg = renderSparklineSVG(series, {
          ...spark.options,
          _metricKey: m.key,
          _depth: rowDepthForSparkline(groupVals),
          _rowAgg: agg,
          _innerFormula: spark.inner,
        }, 110, 28);
        return `<td class="sparkline-cell"${style ? ` style="${style}"` : ''}>${svg}</td>`;
      }
      return `<td class="sparkline-cell"${style ? ` style="${style}"` : ''}></td>`;
    }
    const v = agg[m.key];
    const cls = thresholdClass(m.key, v);
    const style = opts.skipColStyle ? '' : buildCellStyle(m.key);
    const attrs = (cls ? ` class="${cls}"` : '') + (style ? ` style="${style}"` : '');
    return `<td${attrs}>${fmt(v, m.fmt)}</td>`;
  }).join('');
}
// URL 安全判定: link は http/https のみ、image はそれに加えて data:image/* を許容。
// `javascript:` `data:text/html` 等の危険スキームは弾く。
function isSafeLink(s) {
  if (typeof s !== 'string' || !s) return false;
  return /^https?:\/\//i.test(s.trim());
}
function isSafeImageSrc(s) {
  if (typeof s !== 'string' || !s) return false;
  const t = s.trim();
  return /^https?:\/\//i.test(t) || /^data:image\/[a-zA-Z0-9+.-]+;/.test(t);
}

function dimCellHtml(dimKey, value, extraClasses = '', innerHtml = null, dimIdx = null, opts = {}) {
  const cls = 'group-col' + (extraClasses ? ' ' + extraClasses : '');
  const style = opts.skipColStyle ? '' : buildCellStyle('dim:' + dimKey);
  const styleAttr = style ? ` style="${style}"` : '';
  const idxAttr = dimIdx != null ? ` data-dim-idx="${dimIdx}"` : '';
  // type:'image' / type:'link' の dim は値を URL として描画。親集計行は toggle + 内容。
  const def = S.DIMENSIONS?.find(d => d.key === dimKey);
  const isImage = def?.type === 'image';
  const isLink  = def?.type === 'link';
  // 値が空 (null/undefined/'') の場合は URL 化せず空セル相当にする (リンク化で「" の href へ遷移」を防止)
  const hasValue = value != null && value !== '';
  // 危険 URL (javascript:, data:text/html 等) は href/src 化を拒否、通常テキスト表示にフォールバック
  const urlSafe = hasValue && (isImage ? isSafeImageSrc(String(value)) : isLink ? isSafeLink(String(value)) : false);
  let inner;
  if ((isImage || isLink) && urlSafe) {
    let mainHtml;
    if (isImage) {
      const sizeParts = [];
      if (def.imageHeight) sizeParts.push(`max-height:${def.imageHeight}px;height:${def.imageHeight}px`);
      if (def.imageWidth)  sizeParts.push(`max-width:${def.imageWidth}px`);
      const sizeAttr = sizeParts.length ? ` style="${sizeParts.join(';')}"` : '';
      // 失敗時のフォールバックは固定文字列のみ (元 URL を JS 文字列に埋め込まない)
      mainHtml = `<img class="dim-image" src="${escapeHtml(value)}"${sizeAttr} alt="" loading="lazy" referrerpolicy="no-referrer" title="${escapeHtml(value)}" onerror="this.outerHTML='<span class=&quot;dim-image-broken&quot;></span>'">`;
    } else {
      mainHtml = `<span class="dim-link-label">${escapeHtml(value)}</span>`;
    }
    // <a> でラップして新規タブで開く。dim-image-broken のフォールバックも <a> 内で生存する。
    const wrapped = `<a class="dim-link" href="${escapeHtml(value)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(value)}">${mainHtml}</a>`;
    if (innerHtml != null) {
      // 親集計行: toggle button を残しつつ label を差し替える
      inner = innerHtml.replace(/<span class="pivot-parent-label">[\s\S]*?<\/span>/, wrapped);
    } else {
      inner = wrapped;
    }
  } else {
    // image/link 型でも URL が不正/空の場合: 通常のテキスト表示にフォールバック
    inner = innerHtml != null ? innerHtml : escapeHtml(value);
  }
  return `<td class="${cls}"${idxAttr}${styleAttr}>${inner}</td>`;
}

// Build hierarchy from pre-grouped data (avoids re-scanning rows)
let levelKeys = [];
// 全 dim 階層の parent groupKey を保持 (折りたたみ中の subtree も含む)。
// collapse-all で「DOM に出ていない deeper level の key」も拾うのに使う。
// これが無いと: 「全閉じ → +」で開いたとき、未登録の子 key が default=展開扱いになり cascade してしまう。
let allGroupKeys = new Set();

function collectGroupKeys(groups, totalDimCount) {
  const keys = new Set();
  function walk(bucket, dimIndex, parentPath) {
    if (dimIndex >= totalDimCount - 1) return; // 最終 dim は leaf。toggle 無し
    const byVal = new Map();
    for (const g of bucket) {
      const v = g.vals[dimIndex];
      if (!byVal.has(v)) byVal.set(v, []);
      byVal.get(v).push(g);
    }
    for (const [val, sub] of byVal) {
      const path = [...parentPath, val];
      keys.add(makeGroupKey(path));
      walk(sub, dimIndex + 1, path);
    }
  }
  walk(groups, 0, []);
  return keys;
}

function buildFromGroups(groups, dims, metrics, totalDimCount, totalAgg = null) {
  // groups = [{vals: [v0, v1, ...], rows: [...], agg: {...}}, ...]
  // Pre-compute aggregate for each group once
  for (let i = 0; i < groups.length; i++) {
    if (!groups[i].agg) groups[i].agg = aggregate(groups[i].rows);
  }

  allGroupKeys = collectGroupKeys(groups, totalDimCount);

  // Build nested structure: group by dim[0], then dim[1], etc.
  // 最上位レベルの parent は total 自身 (parent(X) と total(X) が同じ値になる)。
  return buildLevel(groups, dims, 0, totalDimCount, metrics, [], totalAgg, totalAgg);
}

// parentAgg: 直前の階層の集計 (= 親集計行の値)。最上位では total と同じ。
// totalAgg:   テーブル全体の集計 (常に同じ値が深い階層まで伝播)。
function buildLevel(groups, dims, dimIndex, totalDimCount, metrics, parentPath, parentAgg = null, totalAgg = null) {
  const isLastDim = dimIndex === dims.length - 1;
  // depthPriority=ON のとき、列ごとのインライン style を抑止して階層色 (CSS 変数) を優先。
  // 閾値カラー (cell-blue 等) は class なので別レイヤーで残る。
  const depthOpts = { skipColStyle: !!S.TABLE_CONFIG?.table?.depthPriority };

  // Group the flat groups by their value at dimIndex
  const buckets = new Map();
  for (let i = 0; i < groups.length; i++) {
    const val = groups[i].vals[dimIndex];
    if (!buckets.has(val)) buckets.set(val, []);
    buckets.get(val).push(groups[i]);
  }

  const userSort = S.TABLE_CONFIG?.sort;
  const sortedKeys = [...buckets.keys()].sort(makeBucketComparator(dimIndex, dims, userSort, buckets));
  let html = '';

  for (const val of sortedKeys) {
    const bucket = buckets.get(val);
    const path = [...parentPath, val];
    const groupKey = makeGroupKey(path);

    if (isLastDim) {
      // Leaf: each bucket entry is a single group
      for (const g of bucket) {
        let dimCells = '';
        for (let i = 0; i < totalDimCount; i++) {
          dimCells += i < dimIndex
            ? dimCellHtml(dims[i], '', '', '', i, depthOpts)
            : dimCellHtml(dims[i], g.vals[i], '', null, i, depthOpts);
        }
        // \u6d3e\u751f\u30e1\u30c8\u30ea\u30af\u30b9\u306e\u5f0f\u4e2d\u3067 parent()/total() \u3092\u4f7f\u3046\u5834\u5408\u306b\u5099\u3048\u3066\u3001\u73fe\u5728\u306e parent/total context \u3067\u518d\u8a55\u4fa1\u3002
        // \u5f0f\u304c parent/total \u3092\u542b\u307e\u306a\u3051\u308c\u3070\u7d50\u679c\u306f g.agg \u3068\u540c\u3058\u3002
        const leafAgg = (parentAgg || totalAgg) ? evalDerivedWithContext(g.agg, parentAgg, totalAgg) : g.agg;
        html += `<tr class="pivot-leaf-row pivot-depth-${dimIndex}">${dimCells}${buildMetricCells(leafAgg, metrics, depthOpts, g.vals)}</tr>`;
      }
    } else {
      const isCollapsed = collapsedGroups.has(groupKey);
      const toggleIcon = isCollapsed ? '+' : '\u2212';

      // Summarize: sum base metrics across all groups in this bucket (parent/total context \u3064\u304d)
      const myAgg = sumAggs(bucket.map(g => g.agg), parentAgg, totalAgg);

      if (!levelKeys[dimIndex]) levelKeys[dimIndex] = new Set();
      levelKeys[dimIndex].add(groupKey);

      let dimCells = '';
      for (let i = 0; i < totalDimCount; i++) {
        if (i < dimIndex) {
          dimCells += dimCellHtml(dims[i], '', '', '', i, depthOpts);
        } else if (i === dimIndex) {
          const inner = `<button type="button" class="pivot-toggle" data-pivot-key="${escapeHtml(groupKey)}" data-pivot-level="${dimIndex}">${toggleIcon}</button><span class="pivot-parent-label">${escapeHtml(val)}</span>`;
          dimCells += dimCellHtml(dims[i], val, 'pivot-parent-cell', inner, i, depthOpts);
        } else {
          dimCells += dimCellHtml(dims[i], '', '', '', i, depthOpts);
        }
      }
      html += `<tr class="pivot-parent-row pivot-depth-${dimIndex}">${dimCells}${buildMetricCells(myAgg, metrics, depthOpts, path)}</tr>`;

      if (!isCollapsed) {
        // 子階層の parent は自分自身の集計、total は最上位の集計を継承。
        html += buildLevel(bucket, dims, dimIndex + 1, totalDimCount, metrics, path, myAgg, totalAgg);
      }
    }
  }
  return html;
}

// Sum pre-computed aggregates (avoids re-scanning rows)
// parentAgg / totalAgg を渡すと、派生メトリクスの式中で parent(X) / total(X) を解決可能。
function sumAggs(aggs, parentAgg = null, totalAgg = null) {
  if (aggs.length === 1 && !parentAgg && !totalAgg) return aggs[0];
  const result = {};
  const baseKeys = baseMetricKeys();
  for (const k of baseKeys) {
    let s = 0;
    for (let i = 0; i < aggs.length; i++) s += aggs[i][k] || 0;
    result[k] = s;
  }
  // Recompute derived with parent/total context
  return evalDerivedWithContext(result, parentAgg, totalAgg);
}

// 既存の baseAgg (= base + 旧 ctx で計算された derived) を、parent/total 集計を考慮して
// derived のみ再評価して返す。base のキー値は不変。
// 派生式が parent()/total() を使ってない場合でも結果は等価。
function evalDerivedWithContext(baseAgg, parentAgg, totalAgg) {
  const result = {...baseAgg};
  const ctx = {...result, min: Math.min, max: Math.max, abs: Math.abs, pow: Math.pow, sqrt: Math.sqrt, round: Math.round, Math};
  if (parentAgg) for (const k of Object.keys(parentAgg)) ctx['__parent_' + k + '__'] = parentAgg[k];
  if (totalAgg)  for (const k of Object.keys(totalAgg))  ctx['__total_'  + k + '__'] = totalAgg[k];
  const derivedKeys = derivedMetricKeys();
  for (const k of derivedKeys) {
    const f = S.METRIC_FORMULAS[k] || DEFAULT_FORMULAS[k] || '0';
    const v = evalFormula(f, ctx);
    ctx[k] = v;
    result[k] = v;
  }
  return result;
}

function renderToolbar(dims) {
  const toolbar = document.getElementById('table-toolbar');
  if (!toolbar) return;

  // Don't re-render toolbar if freeze input is focused
  const freezeInput = document.getElementById('toolbar-freeze-val');
  if (freezeInput && document.activeElement === freezeInput) {
    toolbar.classList.remove('hidden');
    return;
  }

  toolbar.classList.remove('hidden');

  // Frozen columns control
  const totalCols = dims.length + S.SELECTED_METRICS.length;
  if (frozenCount > totalCols) frozenCount = totalCols;
  let html = '<div class="toolbar-group">'
    + '<span class="toolbar-label">\u56fa\u5b9a\u5217</span>'
    + '<button type="button" class="toolbar-zoom-btn" data-toolbar-action="freeze-dec">\u2212</button>'
    + '<input type="text" class="toolbar-num-input" id="toolbar-freeze-val" value="' + frozenCount + '" inputmode="numeric" data-toolbar-action="freeze-input">'
    + '<button type="button" class="toolbar-zoom-btn" data-toolbar-action="freeze-inc">+</button>'
    + '</div>';

  // Zoom control
  html += '<div class="toolbar-group">'
    + '<span class="toolbar-label">\u500d\u7387</span>'
    + '<button type="button" class="toolbar-zoom-btn" data-toolbar-action="zoom-out">\u2212</button>'
    + '<span class="toolbar-zoom-val" id="toolbar-zoom-val">' + tableZoom + '%</span>'
    + '<button type="button" class="toolbar-zoom-btn" data-toolbar-action="zoom-in">+</button>'
    + '<button type="button" class="link-btn" data-toolbar-action="zoom-reset">\u30ea\u30bb\u30c3\u30c8</button>'
    + '</div>';

  // Hierarchy controls (only when 2+ dims)
  if (dims.length >= 2) {
    const levels = dims.slice(0, -1);
    html += '<div class="toolbar-group"><span class="toolbar-label">\u5168\u4f53</span>'
      + '<button type="button" class="link-btn" data-toolbar-action="expand-all">\u5c55\u958b</button>'
      + '<button type="button" class="link-btn" data-toolbar-action="collapse-all">\u6298\u308a\u305f\u305f\u307f</button></div>';

    levels.forEach((dimKey, i) => {
      const label = dimLabel(dimKey);
      html += `<div class="toolbar-group"><span class="toolbar-label">${escapeHtml(label)}</span>`
        + `<button type="button" class="link-btn" data-toolbar-action="expand-level" data-level="${i}">\u5c55\u958b</button>`
        + `<button type="button" class="link-btn" data-toolbar-action="collapse-level" data-level="${i}">\u6298\u308a\u305f\u305f\u307f</button></div>`;
    });
  }

  html += '<div class="toolbar-spacer"></div>';
  html += '<button type="button" class="csv-download-btn" id="csv-download-btn">'
    + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
    + 'CSV</button>';
  html += '<button type="button" class="toolbar-zoom-btn" id="table-settings-btn" data-toolbar-action="open-settings" title="テーブル設定">⚙</button>';
  // 全画面トグル: ⛶ ↔ ⤡。アクティブ状態は table-area の is-fullscreen クラスで判別。
  const isFs = document.getElementById('table-area')?.classList.contains('is-fullscreen');
  html += `<button type="button" class="toolbar-zoom-btn" id="table-fullscreen-btn" data-toolbar-action="toggle-fullscreen" title="${isFs ? '全画面解除 (Esc)' : '全画面表示'}">${isFs ? '⤡' : '⛶'}</button>`;

  toolbar.innerHTML = html;
}

function applyFrozenColumns() {
  if (frozenCount <= 0) return;
  const table = document.getElementById('data-table');
  if (!table) return;
  // Get header ths to measure widths
  const ths = table.querySelectorAll('thead th');
  const lefts = [];
  let cumLeft = 0;
  for (let i = 0; i < frozenCount && i < ths.length; i++) {
    lefts.push(cumLeft);
    ths[i].classList.add('col-frozen');
    ths[i].style.left = cumLeft + 'px';
    cumLeft += ths[i].offsetWidth;
  }
  // Apply to all body rows + thead total row (総計行は thead 2 行目にある)
  table.querySelectorAll('tbody tr, thead .total-row').forEach(tr => {
    const tds = tr.children;
    for (let i = 0; i < frozenCount && i < tds.length; i++) {
      tds[i].classList.add('col-frozen');
      tds[i].style.left = lefts[i] + 'px';
    }
  });
}

function applyZoom() {
  const table = document.getElementById('data-table');
  if (table) {
    const baseFontSize = 12;
    table.style.fontSize = (baseFontSize * tableZoom / 100) + 'px';
    // thead 1 行目の高さを measure して総計行の sticky top に反映 (zoom 後に再計算が必要)。
    const firstRow = table.querySelector('thead tr:first-child');
    if (firstRow) table.style.setProperty('--head-row1-h', firstRow.offsetHeight + 'px');
  }
  const label = document.getElementById('toolbar-zoom-val');
  if (label) label.textContent = tableZoom + '%';
  try { localStorage.setItem(ZOOM_KEY, String(tableZoom)); } catch (e) {}
}

// テーブル設定のフィルタ/ソートを groups[] に適用する。
//   filters: { [colKey]: { op, value } } で各 group の値を評価し、false なら除外。
//   sort:    { col, dir, custom }       で各 group / 親バケツ内の並び順を決定。
// colKey は 'dim:<dimKey>' または metric.key。
function evalFilterValue(group, colKey, dims) {
  if (colKey.startsWith('dim:')) {
    const idx = dims.indexOf(colKey.slice(4));
    return idx >= 0 ? group.vals[idx] : null;
  }
  // metric: agg がまだ無ければ計算
  if (!group.agg) group.agg = aggregate(group.rows);
  return group.agg[colKey];
}
// 順序比較ヘルパー。両辺の形に応じて数値 → 日付 → 文字列の順で型を選ぶ。
//   - 両方が「綺麗な数値文字列」: Number 比較
//   - 両方が Date.parse できる: timestamp 比較 (ISO 日付 / `2024-01-15` 等)
//   - それ以外: ロケール辞書順
function compareForFilter(v, target) {
  const sv = String(v ?? '').trim();
  const st = String(target ?? '').trim();
  const NUM = /^-?\d+(\.\d+)?$/;
  if (NUM.test(sv) && NUM.test(st)) return Number(sv) - Number(st);
  const dv = Date.parse(sv), dt = Date.parse(st);
  if (!isNaN(dv) && !isNaN(dt)) return dv - dt;
  return sv.localeCompare(st);
}
// null / undefined を空文字として正規化 (eq/ne で "null"/"undefined" の文字列扱いを避けるため)
const _normForCmp = v => v == null ? '' : String(v);
function passesFilter(group, dims, filters) {
  for (const [colKey, rule] of Object.entries(filters || {})) {
    if (!rule || !rule.op) continue;
    const v = evalFilterValue(group, colKey, dims);
    const target = rule.value;
    // 大小比較系: 値が null/undefined なら順序を判定不能としてフィルタ通過させない
    if (rule.op === 'gt' || rule.op === 'gte' || rule.op === 'lt' || rule.op === 'lte') {
      if (v == null) return false;
    }
    switch (rule.op) {
      case 'gt':  if (!(compareForFilter(v, target) >  0)) return false; break;
      case 'gte': if (!(compareForFilter(v, target) >= 0)) return false; break;
      case 'lt':  if (!(compareForFilter(v, target) <  0)) return false; break;
      case 'lte': if (!(compareForFilter(v, target) <= 0)) return false; break;
      case 'eq':  if (_normForCmp(v) !== _normForCmp(target)) return false; break;
      case 'ne':  if (_normForCmp(v) === _normForCmp(target)) return false; break;
      case 'contains': if (!_normForCmp(v).includes(_normForCmp(target))) return false; break;
    }
  }
  return true;
}
// カスタム順序: 改行区切りの文字列リスト。リストにある値はリスト順、無い値は末尾 (alpha)。
function customSortIndex(value, customList) {
  const i = customList.indexOf(String(value));
  return i >= 0 ? i : Number.MAX_SAFE_INTEGER;
}
// 親バケツ (buildLevel 内) のソート用 comparator を生成。
// 1 つの sort 条件 ({col, dir, custom}) で 2 つのバケツキーを比較。
// dim:<key> 条件は現在の level の dim と一致しないと適用しない (= 0 を返して次の条件に進む)。
function compareBySortEntry(s, a, b, dimIndex, dims, bucketsMap) {
  if (!s || !s.col) return 0;
  const dir = s.dir === 'desc' ? -1 : 1;
  if (s.col.startsWith('dim:')) {
    if (s.col !== 'dim:' + dims[dimIndex]) return 0;
    const customList = (s.custom || '').split('\n').map(x => x.trim()).filter(Boolean);
    if (customList.length) {
      const r = (customSortIndex(a, customList) - customSortIndex(b, customList)) * dir;
      if (r !== 0) return r;
    }
    return dimSort(dims[dimIndex], a, b) * dir;
  }
  const aSum = sumAggs((bucketsMap.get(a) || []).map(g => g.agg || aggregate(g.rows)))[s.col] || 0;
  const bSum = sumAggs((bucketsMap.get(b) || []).map(g => g.agg || aggregate(g.rows)))[s.col] || 0;
  return (aSum - bSum) * dir;
}

// 複数キーソート対応: sort.list[] を順に評価し、最初に差が出たもので決定。
// 互換: 旧 sort.col / sort.dir / sort.custom も 1 件としてラップして扱う。
function makeBucketComparator(dimIndex, dims, sort, bucketsMap) {
  const list = sortListFrom(sort);
  if (!list.length) return (a, b) => dimSort(dims[dimIndex], a, b);
  return (a, b) => {
    for (const s of list) {
      const r = compareBySortEntry(s, a, b, dimIndex, dims, bucketsMap);
      if (r !== 0) return r;
    }
    return dimSort(dims[dimIndex], a, b);
  };
}
function sortListFrom(sort) {
  if (!sort) return [];
  if (Array.isArray(sort.list)) return sort.list.filter(it => it && it.col);
  if (sort.col) return [{ col: sort.col, dir: sort.dir || 'asc', custom: sort.custom || '' }];
  return [];
}

export function renderTable(groups) {
  const metrics = S.SELECTED_METRICS.map(k => S.METRIC_DEFS.find(m => m.key === k)).filter(Boolean);
  const dims = S.SELECTED_DIMS;
  // フィルタ適用 (groups[] = leaf 相当を絞る → 親集計も自動的にフィルタ後の値に)
  const filters = S.TABLE_CONFIG?.filters;
  if (filters && Object.keys(filters).length) {
    groups = groups.filter(g => passesFilter(g, dims, filters));
  }
  const cols = [
    ...dims.map(k => ({key: 'dim:' + k, label: dimLabel(k), isDim: true, defW: 130})),
    ...metrics.map(m => ({key: 'met:' + m.key, label: m.label, isDim: false, defW: 110})),
  ];
  const colgroup = '';
  // 列スタイルの key: metric は metric.key, dim は 'dim:<dimKey>'
  const headerCells = cols.map(c => {
    const styleKey = c.isDim ? ('dim:' + c.key.replace(/^dim:/, '')) : c.key.replace(/^met:/, '');
    const style = buildHeaderCellStyle(styleKey);
    return `<th class="${c.isDim ? 'group-col' : ''}" data-col-key="${c.key}"${style ? ` style="${style}"` : ''}>${escapeHtmlNl(c.label)}<span class="col-resizer"></span></th>`;
  }).join('');

  let bodyRows = '';
  levelKeys = [];

  // 全体総計 = parent()/total() の解決元。1 回計算してテーブル全体で使い回す。
  // ここで一度 derived を「self-referencing で評価」しておくことで、parent(X) / total(X) が
  // 「自分自身の値」になる (= 比率なら 1.0)。総計行の表示にも使う。
  let totalAgg = null;
  if (groups.length) {
    const baseTotal = sumAggs(groups.map(g => g.agg || aggregate(g.rows)));
    totalAgg = evalDerivedWithContext(baseTotal, baseTotal, baseTotal);
  }

  if (dims.length >= 2) {
    bodyRows = buildFromGroups(groups, dims, metrics, dims.length, totalAgg);
  } else {
    const depthOpts = { skipColStyle: !!S.TABLE_CONFIG?.table?.depthPriority };
    // 単一 dim パス: groups を直接ソート。複数キー対応。
    const sortList = sortListFrom(S.TABLE_CONFIG?.sort);
    let sortedGroups = groups;
    if (sortList.length) {
      const compareOne = (s, a, b) => {
        if (!s || !s.col) return 0;
        const dir = s.dir === 'desc' ? -1 : 1;
        if (s.col.startsWith('dim:')) {
          if (s.col !== 'dim:' + dims[0]) return 0;
          const customList = (s.custom || '').split('\n').map(x => x.trim()).filter(Boolean);
          const va = a.vals[0], vb = b.vals[0];
          if (customList.length) {
            const r = (customSortIndex(va, customList) - customSortIndex(vb, customList)) * dir;
            if (r !== 0) return r;
          }
          return dimSort(dims[0], va, vb) * dir;
        }
        const aAgg = a.agg || aggregate(a.rows);
        const bAgg = b.agg || aggregate(b.rows);
        return ((aAgg[s.col] || 0) - (bAgg[s.col] || 0)) * dir;
      };
      sortedGroups = [...groups].sort((a, b) => {
        for (const s of sortList) {
          const r = compareOne(s, a, b);
          if (r !== 0) return r;
        }
        return dimSort(dims[0], a.vals[0], b.vals[0]);
      });
    }
    bodyRows = sortedGroups.map(g => {
      // 単一 dim でも parent()/total() を解決可能に (parent も total も全体総計を指す)。
      const baseAgg = g.agg || aggregate(g.rows);
      const agg = totalAgg ? evalDerivedWithContext(baseAgg, totalAgg, totalAgg) : baseAgg;
      const dimCells = g.vals.map((v, i) => dimCellHtml(dims[i], v, '', null, i, depthOpts)).join('');
      const metCells = buildMetricCells(agg, metrics, depthOpts, g.vals);
      return `<tr>${dimCells}${metCells}</tr>`;
    }).join('');
  }

  // 総計行 (上部に表示)。renderTable 冒頭で計算した totalAgg をそのまま使う。
  // <thead> に入れることで、2 行目として自動的に sticky-top で 1 行目の下に
  // 重なる挙動になる。
  let totalRow = '';
  if (S.TABLE_CONFIG?.showTotal && groups.length && totalAgg) {
    // totalPriority=ON のとき、列ごとのインライン style を抑止して総計行 CSS 変数を優先。
    const totOpts = { skipColStyle: !!S.TABLE_CONFIG?.table?.totalPriority };
    const dimCells = dims.map((dk, i) => dimCellHtml(dk, '', 'total-label', i === 0 ? '総計' : '', i, totOpts)).join('');
    const metCells = buildMetricCells(totalAgg, metrics, totOpts);
    totalRow = `<tr class="total-row">${dimCells}${metCells}</tr>`;
  }

  renderToolbar(dims);

  const table = document.getElementById('data-table');
  table.style.width = '';
  // テーブル全体の color/background (table.color / table.bgColor) を inline で当てる。
  // 個別の cell style はさらに優先される (inline + 子要素 inline)。
  const tableStyle = buildTableStyle();
  table.style.cssText = tableStyle;
  table.innerHTML = `${colgroup}<thead><tr>${headerCells}</tr>${totalRow}</thead><tbody>${bodyRows}</tbody>`;
  applyZoom();
  applyFrozenColumns();
}

function rerender() {
  import('./events.js').then(({ emit }) => emit('render'));
}

// Toggle individual group
document.getElementById('data-table').addEventListener('click', e => {
  const btn = e.target.closest('.pivot-toggle');
  if (!btn) return;
  const key = btn.dataset.pivotKey;
  if (collapsedGroups.has(key)) collapsedGroups.delete(key);
  else collapsedGroups.add(key);
  rerender();
});

// Toolbar actions
document.getElementById('table-toolbar').addEventListener('click', e => {
  const btn = e.target.closest('[data-toolbar-action]');
  if (!btn) return;
  const action = btn.dataset.toolbarAction;
  const level = btn.dataset.level != null ? +btn.dataset.level : null;

  if (action === 'expand-all') {
    collapsedGroups.clear();
  } else if (action === 'collapse-all') {
    // DOM の querySelectorAll では subtree が collapsed のときに deeper level の key を拾えないので、
    // データツリーから事前収集した allGroupKeys を使う (collectGroupKeys 参照)。
    for (const k of allGroupKeys) collapsedGroups.add(k);
  } else if (action === 'expand-level' && level != null) {
    // Expand all at this level
    document.querySelectorAll(`.pivot-toggle[data-pivot-level="${level}"]`).forEach(t => {
      collapsedGroups.delete(t.dataset.pivotKey);
    });
  } else if (action === 'collapse-level' && level != null) {
    document.querySelectorAll(`.pivot-toggle[data-pivot-level="${level}"]`).forEach(t => {
      collapsedGroups.add(t.dataset.pivotKey);
    });
  } else if (action === 'zoom-in') {
    tableZoom = Math.min(200, tableZoom + 10);
    try { localStorage.setItem(ZOOM_KEY, String(tableZoom)); } catch (e) {}
  } else if (action === 'zoom-out') {
    tableZoom = Math.max(50, tableZoom - 10);
    try { localStorage.setItem(ZOOM_KEY, String(tableZoom)); } catch (e) {}
  } else if (action === 'zoom-reset') {
    tableZoom = DEFAULT_ZOOM;
    try { localStorage.setItem(ZOOM_KEY, String(tableZoom)); } catch (e) {}
  } else if (action === 'freeze-inc') {
    const maxCols = S.SELECTED_DIMS.length + S.SELECTED_METRICS.length;
    frozenCount = Math.min(maxCols, frozenCount + 1);
  } else if (action === 'freeze-dec') {
    frozenCount = Math.max(0, frozenCount - 1);
  } else if (action === 'open-settings') {
    openTableSettings();
    return; // no rerender needed
  } else if (action === 'toggle-fullscreen') {
    toggleTableFullscreen();
    return;
  }
  rerender();
});

// 全画面表示の ON/OFF。CSS で position:fixed; inset:0 を当てるだけで Browser
// Fullscreen API は使わない (固定列の measure、ツールバーの sticky、設定パネル
// との重なりを自前で制御したいため)。
function toggleTableFullscreen() {
  const area = document.getElementById('table-area');
  if (!area) return;
  const next = !area.classList.contains('is-fullscreen');
  area.classList.toggle('is-fullscreen', next);
  document.body.classList.toggle('table-fullscreen', next);
  rerender();
}
// Esc キーで解除
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const area = document.getElementById('table-area');
  if (area?.classList.contains('is-fullscreen')) {
    // 入力中は誤爆させない
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    toggleTableFullscreen();
  }
});

// Freeze input: apply on Enter or blur
function handleFreezeInput(input) {
  const maxCols = S.SELECTED_DIMS.length + S.SELECTED_METRICS.length;
  const v = Math.max(0, Math.min(maxCols, Math.round(+input.value) || 0));
  if (v !== frozenCount) {
    frozenCount = v;
    rerender();
  } else {
    input.value = frozenCount;
  }
}
document.getElementById('table-toolbar').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset.toolbarAction === 'freeze-input') {
    e.preventDefault();
    handleFreezeInput(e.target);
    e.target.blur();
  }
});
document.getElementById('table-toolbar').addEventListener('focusout', e => {
  if (e.target.dataset?.toolbarAction === 'freeze-input') {
    handleFreezeInput(e.target);
  }
});
