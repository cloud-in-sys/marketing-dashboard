import { S, DEFAULT_FORMULAS } from './state.js';
import { fmt, escapeHtml } from './utils.js';
import { dimLabel, dimSort } from './dimensions.js';
import { aggregate, baseMetricKeys, derivedMetricKeys, evalFormula } from './aggregate.js';

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

function makeGroupKey(path) {
  return path.map((v, i) => `${i}:${v}`).join('|');
}

function buildMetricCells(agg, metrics) {
  return metrics.map(m => {
    const v = agg[m.key];
    const cls = thresholdClass(m.key, v);
    return `<td${cls ? ` class="${cls}"` : ''}>${fmt(v, m.fmt)}</td>`;
  }).join('');
}

// Build hierarchy from pre-grouped data (avoids re-scanning rows)
let levelKeys = [];

function buildFromGroups(groups, dims, metrics, totalDimCount) {
  // groups = [{vals: [v0, v1, ...], rows: [...], agg: {...}}, ...]
  // Pre-compute aggregate for each group once
  for (let i = 0; i < groups.length; i++) {
    if (!groups[i].agg) groups[i].agg = aggregate(groups[i].rows);
  }

  // Build nested structure: group by dim[0], then dim[1], etc.
  return buildLevel(groups, dims, 0, totalDimCount, metrics, []);
}

function buildLevel(groups, dims, dimIndex, totalDimCount, metrics, parentPath) {
  const isLastDim = dimIndex === dims.length - 1;

  // Group the flat groups by their value at dimIndex
  const buckets = new Map();
  for (let i = 0; i < groups.length; i++) {
    const val = groups[i].vals[dimIndex];
    if (!buckets.has(val)) buckets.set(val, []);
    buckets.get(val).push(groups[i]);
  }

  const sortedKeys = [...buckets.keys()].sort((a, b) => dimSort(dims[dimIndex], a, b));
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
            ? '<td class="group-col"></td>'
            : `<td class="group-col">${escapeHtml(g.vals[i])}</td>`;
        }
        html += `<tr class="pivot-leaf-row pivot-depth-${dimIndex}">${dimCells}${buildMetricCells(g.agg, metrics)}</tr>`;
      }
    } else {
      const isCollapsed = collapsedGroups.has(groupKey);
      const toggleIcon = isCollapsed ? '+' : '\u2212';

      // Summarize: sum base metrics across all groups in this bucket
      const parentAgg = sumAggs(bucket.map(g => g.agg));

      if (!levelKeys[dimIndex]) levelKeys[dimIndex] = new Set();
      levelKeys[dimIndex].add(groupKey);

      let dimCells = '';
      for (let i = 0; i < totalDimCount; i++) {
        if (i < dimIndex) {
          dimCells += '<td class="group-col"></td>';
        } else if (i === dimIndex) {
          dimCells += `<td class="group-col pivot-parent-cell"><button type="button" class="pivot-toggle" data-pivot-key="${escapeHtml(groupKey)}" data-pivot-level="${dimIndex}">${toggleIcon}</button><span class="pivot-parent-label">${escapeHtml(val)}</span></td>`;
        } else {
          dimCells += '<td class="group-col"></td>';
        }
      }
      html += `<tr class="pivot-parent-row pivot-depth-${dimIndex}">${dimCells}${buildMetricCells(parentAgg, metrics)}</tr>`;

      if (!isCollapsed) {
        html += buildLevel(bucket, dims, dimIndex + 1, totalDimCount, metrics, path);
      }
    }
  }
  return html;
}

// Sum pre-computed aggregates (avoids re-scanning rows)
function sumAggs(aggs) {
  if (aggs.length === 1) return aggs[0];
  const result = {};
  const baseKeys = baseMetricKeys();
  for (const k of baseKeys) {
    let s = 0;
    for (let i = 0; i < aggs.length; i++) s += aggs[i][k] || 0;
    result[k] = s;
  }
  // Recompute derived from summed base
  const ctx = {...result, min: Math.min, max: Math.max, abs: Math.abs, pow: Math.pow, sqrt: Math.sqrt, round: Math.round, Math};
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
  // Apply to all body rows
  table.querySelectorAll('tbody tr').forEach(tr => {
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
  }
  const label = document.getElementById('toolbar-zoom-val');
  if (label) label.textContent = tableZoom + '%';
  try { localStorage.setItem(ZOOM_KEY, String(tableZoom)); } catch (e) {}
}

export function renderTable(groups) {
  const metrics = S.SELECTED_METRICS.map(k => S.METRIC_DEFS.find(m => m.key === k)).filter(Boolean);
  const dims = S.SELECTED_DIMS;
  const cols = [
    ...dims.map(k => ({key: 'dim:' + k, label: dimLabel(k), isDim: true, defW: 130})),
    ...metrics.map(m => ({key: 'met:' + m.key, label: m.label, isDim: false, defW: 110})),
  ];
  const colgroup = '';
  const headerCells = cols.map(c => `<th class="${c.isDim ? 'group-col' : ''}" data-col-key="${c.key}">${c.label}<span class="col-resizer"></span></th>`).join('');

  let bodyRows = '';
  levelKeys = [];

  if (dims.length >= 2) {
    bodyRows = buildFromGroups(groups, dims, metrics, dims.length);
  } else {
    bodyRows = groups.map(g => {
      const agg = aggregate(g.rows);
      const dimCells = g.vals.map(v => `<td class="group-col">${escapeHtml(v)}</td>`).join('');
      const metCells = buildMetricCells(agg, metrics);
      return `<tr>${dimCells}${metCells}</tr>`;
    }).join('');
  }

  renderToolbar(dims);

  const table = document.getElementById('data-table');
  table.style.width = '';
  table.innerHTML = `${colgroup}<thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody>`;
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
    // Collapse all levels: need to collect all keys by re-rendering first expanded, then collapsing
    document.querySelectorAll('.pivot-toggle').forEach(t => collapsedGroups.add(t.dataset.pivotKey));
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
  }
  rerender();
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
