import { S } from './state.js';
import { escapeHtml } from './utils.js';
import { groupRows } from './dimensions.js';
import { aggregate } from './aggregate.js';

// ===== Chart rendering =====
export function buildChartSVG(chart, rows, W, H) {
  const mdef = S.METRIC_DEFS.find(m => m.key === chart.metric);
  const xDim = chart.bucket && chart.bucket !== 'auto' ? chart.bucket : S.SELECTED_DIMS[0];
  if (!mdef || !xDim) return '<div style="padding:24px;text-align:center;color:#64748b;font-size:12px">\u30c7\u30a3\u30e1\u30f3\u30b7\u30e7\u30f3\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044</div>';
  const groups = groupRows(rows, [xDim]);
  const data = groups.map(g => ({x: g.vals[0], y: aggregate(g.rows)[chart.metric] || 0}));
  if (!data.length) return '<div style="padding:24px;text-align:center;color:#64748b;font-size:12px">\u30c7\u30fc\u30bf\u306a\u3057</div>';

  const PL = 60, PR = 16, PT = 14, PB = 36;
  const iw = W - PL - PR, ih = H - PT - PB;
  const maxY = Math.max(...data.map(d => d.y), 0) || 1;
  const step = iw / data.length;
  const barW = Math.min(step * 0.7, 36);
  const color = chart.color || '#2563eb';
  const gradId = `grad_${chart.id}`;

  const yFmt = v => {
    if (mdef.fmt === 'yen') return '\u00a5' + Math.round(v).toLocaleString();
    if (mdef.fmt === 'pct') return (v * 100).toFixed(1) + '%';
    return Math.round(v).toLocaleString();
  };

  let s = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  s += `<defs><linearGradient id="${gradId}" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.55"/><stop offset="100%" stop-color="${color}" stop-opacity="0.05"/></linearGradient></defs>`;
  for (let i = 0; i <= 4; i++) {
    const y = PT + ih - ih * i / 4;
    const v = maxY * i / 4;
    s += `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="#e2e8f0"/>`;
    s += `<text x="${PL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#64748b">${yFmt(v)}</text>`;
  }
  const pts = data.map((d, i) => ({cx: PL + step * i + step / 2, cy: PT + ih - ih * (d.y / maxY), d}));
  S.CHART_POINTS.set(chart.id, {
    W, H, PT, ih,
    points: pts.map(p => ({cx: p.cx, cy: p.cy, x: p.d.x, label: yFmt(p.d.y), metric: mdef.label})),
  });
  if (chart.type === 'bar') {
    pts.forEach(p => {
      const h = PT + ih - p.cy;
      s += `<rect x="${p.cx - barW / 2}" y="${p.cy}" width="${barW}" height="${h}" fill="${color}" rx="2"><title>${p.d.x}: ${yFmt(p.d.y)}</title></rect>`;
    });
  } else if (chart.type === 'area') {
    const linePts = pts.map(p => `${p.cx},${p.cy}`).join(' ');
    const areaPts = `${pts[0].cx},${PT + ih} ${linePts} ${pts[pts.length - 1].cx},${PT + ih}`;
    s += `<polygon points="${areaPts}" fill="url(#${gradId})"/>`;
    s += `<polyline points="${linePts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    pts.forEach(p => {
      s += `<circle cx="${p.cx}" cy="${p.cy}" r="3" fill="${color}" stroke="#ffffff" stroke-width="1.5"><title>${p.d.x}: ${yFmt(p.d.y)}</title></circle>`;
    });
  } else if (chart.type === 'scatter') {
    pts.forEach(p => {
      s += `<circle cx="${p.cx}" cy="${p.cy}" r="4" fill="${color}" fill-opacity="0.75" stroke="${color}" stroke-width="1"><title>${p.d.x}: ${yFmt(p.d.y)}</title></circle>`;
    });
  } else {
    const linePts = pts.map(p => `${p.cx},${p.cy}`).join(' ');
    s += `<polyline points="${linePts}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
    pts.forEach(p => {
      s += `<circle cx="${p.cx}" cy="${p.cy}" r="3.5" fill="${color}" stroke="#ffffff" stroke-width="1.5"><title>${p.d.x}: ${yFmt(p.d.y)}</title></circle>`;
    });
  }
  const labelStride = Math.max(1, Math.ceil(data.length / (chart.size === 'sub' ? 8 : 16)));
  pts.forEach((p, i) => {
    if (i % labelStride !== 0) return;
    s += `<text x="${p.cx}" y="${H - PB + 16}" text-anchor="middle" font-size="10" fill="#64748b">${p.d.x}</text>`;
  });
  s += '</svg>';
  return s;
}

export function renderChart(rows) {
  const grid = document.getElementById('charts-grid');
  grid.innerHTML = S.CHARTS.map(c => `
    <div class="chart-card ${c.size}" data-id="${c.id}" draggable="true">
      <div class="chart-head">
        <div class="chart-title"><span class="drag-handle" title="\u30c9\u30e9\u30c3\u30b0\u3067\u4e26\u3073\u66ff\u3048">\u22ee\u22ee</span><input type="text" class="chart-name" data-role="name" value="${escapeHtml(c.name || '')}" placeholder="${c.size === 'main' ? '\u30e1\u30a4\u30f3' : '\u30b5\u30d6'}"></div>
        <div class="chart-ctrl">
          <select data-role="metric">${S.METRIC_DEFS.map(m => `<option value="${m.key}"${m.key === c.metric ? ' selected' : ''}>${m.label}</option>`).join('')}</select>
          <select data-role="bucket">
            <option value="auto"${(c.bucket||'auto')==='auto'?' selected':''}>\u81ea\u52d5</option>
            <option value="action_date"${c.bucket==='action_date'?' selected':''}>\u65e5\u6b21</option>
            <option value="month"${c.bucket==='month'?' selected':''}>\u6708\u6b21</option>
            <option value="dow"${c.bucket==='dow'?' selected':''}>\u66dc\u65e5</option>
          </select>
          <select data-role="type">
            <option value="bar"${c.type === 'bar' ? ' selected' : ''}>\u68d2</option>
            <option value="line"${c.type === 'line' ? ' selected' : ''}>\u6298\u308c\u7dda</option>
            <option value="area"${c.type === 'area' ? ' selected' : ''}>\u30a8\u30ea\u30a2</option>
            <option value="scatter"${c.type === 'scatter' ? ' selected' : ''}>\u6563\u5e03</option>
          </select>
          <input type="color" class="chart-color" data-role="color" value="${c.color || '#2563eb'}" title="\u8272">
          <button type="button" class="chart-remove" data-role="remove" aria-label="\u524a\u9664">\u00d7</button>
        </div>
      </div>
      <div class="chart-wrap">
        <div class="chart" data-chart-body="${c.id}"></div>
        <div class="chart-guide hidden" data-guide="${c.id}"></div>
        <div class="chart-tooltip hidden" data-tooltip="${c.id}"></div>
      </div>
    </div>
  `).join('');
  S.CHARTS.forEach(c => {
    const body = grid.querySelector(`[data-chart-body="${c.id}"]`);
    if (!body) return;
    const W = body.clientWidth || (c.size === 'main' ? 800 : 400);
    const H = c.size === 'main' ? 280 : 180;
    body.innerHTML = buildChartSVG(c, rows, W, H);
  });
}
