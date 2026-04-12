import { S } from './state.js';
import { fmt } from './utils.js';
import { dimLabel } from './dimensions.js';
import { aggregate } from './aggregate.js';

// ===== Table rendering =====
function thresholdClass(metricKey, value) {
  const t = S.THRESHOLDS[metricKey];
  if (!t || !isFinite(value)) return '';
  const min = t.min, max = t.max, target = t.target;
  if (min != null && value <= min) return 'cell-red';
  if (target != null && value >= target) return 'cell-blue';
  if (min != null && max != null && value > min && value < max) return 'cell-yellow';
  return '';
}

export function renderTable(groups) {
  const metrics = S.SELECTED_METRICS.map(k => S.METRIC_DEFS.find(m => m.key === k)).filter(Boolean);
  const cols = [
    ...S.SELECTED_DIMS.map(k => ({key: 'dim:' + k, label: dimLabel(k), isDim: true, defW: 130})),
    ...metrics.map(m => ({key: 'met:' + m.key, label: m.label, isDim: false, defW: 110})),
  ];
  const widths = cols.map(c => S.COL_WIDTHS[c.key] || c.defW);
  const colgroup = '<colgroup>' + widths.map(w => `<col style="width:${w}px">`).join('') + '</colgroup>';
  const totalW = widths.reduce((a, b) => a + b, 0);
  const headerCells = cols.map(c => `<th class="${c.isDim ? 'group-col' : ''}" data-col-key="${c.key}">${c.label}<span class="col-resizer"></span></th>`).join('');
  const bodyRows = groups.map(g => {
    const agg = aggregate(g.rows);
    const dimCells = g.vals.map(v => `<td class="group-col">${v}</td>`).join('');
    const metCells = metrics.map(m => {
      const v = agg[m.key];
      const cls = thresholdClass(m.key, v);
      return `<td${cls ? ` class="${cls}"` : ''}>${fmt(v, m.fmt)}</td>`;
    }).join('');
    return `<tr>${dimCells}${metCells}</tr>`;
  }).join('');
  const table = document.getElementById('data-table');
  table.style.width = totalW + 'px';
  table.innerHTML = `${colgroup}<thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody>`;
}
