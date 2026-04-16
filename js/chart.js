import { S } from './state.js';
import { escapeHtml } from './utils.js';
import { groupRows } from './dimensions.js';
import { aggregate } from './aggregate.js';

// 円グラフ / 積み上げ用のカラーパレット
const PIE_PALETTE = ['#2563eb', '#f59e0b', '#10b981', '#ef4444', '#7c3aed', '#ec4899', '#14b8a6', '#0ea5e9', '#84cc16', '#f97316'];
const STACK_PALETTE = PIE_PALETTE;

function formatMetricValue(mdef, v) {
  if (mdef.fmt === 'yen') return '\u00a5' + Math.round(v).toLocaleString();
  if (mdef.fmt === 'pct') return (v * 100).toFixed(1) + '%';
  return Math.round(v).toLocaleString();
}

// 滑らかな折れ線パス (Cardinal spline 風の水平制御)
function smoothPath(pts) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].cx} ${pts[0].cy}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const cur = pts[i], next = pts[i + 1];
    const cx = (cur.cx + next.cx) / 2;
    d += ` C ${cx},${cur.cy} ${cx},${next.cy} ${next.cx},${next.cy}`;
  }
  return d;
}

function buildPieSVG(chart, rows, W, H) {
  const mdef = S.METRIC_DEFS.find(m => m.key === chart.metric);
  const xDim = chart.bucket && chart.bucket !== 'auto' ? chart.bucket : S.SELECTED_DIMS[0];
  if (!mdef || !xDim) return '<div style="padding:24px;text-align:center;color:#64748b;font-size:12px">\u30c7\u30a3\u30e1\u30f3\u30b7\u30e7\u30f3\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044</div>';
  const groups = groupRows(rows, [xDim]);
  let data = groups.map(g => ({x: g.vals[0], y: aggregate(g.rows)[chart.metric] || 0}))
    .filter(d => d.y > 0)
    .sort((a, b) => b.y - a.y);
  if (!data.length) return '<div style="padding:24px;text-align:center;color:#64748b;font-size:12px">\u30c7\u30fc\u30bf\u306a\u3057</div>';

  // 12 項目以上あると見づらいので、上位 11 + 「その他」に集約
  if (data.length > 12) {
    const top = data.slice(0, 11);
    const otherY = data.slice(11).reduce((s, d) => s + d.y, 0);
    data = [...top, { x: '\u305d\u306e\u4ed6', y: otherY }];
  }

  const total = data.reduce((s, d) => s + d.y, 0) || 1;
  const cx = W * 0.35, cy = H / 2;
  const radius = Math.min(cx, cy) - 12;
  const legendX = W * 0.6;

  let s = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">`;
  // パイスライス
  let angle = -Math.PI / 2;
  const slices = [];
  data.forEach((d, i) => {
    const sweep = (d.y / total) * Math.PI * 2;
    const x1 = cx + radius * Math.cos(angle);
    const y1 = cy + radius * Math.sin(angle);
    const x2 = cx + radius * Math.cos(angle + sweep);
    const y2 = cy + radius * Math.sin(angle + sweep);
    const largeArc = sweep > Math.PI ? 1 : 0;
    const color = PIE_PALETTE[i % PIE_PALETTE.length];
    slices.push({ color, label: d.x, value: d.y, pct: d.y / total });
    if (data.length === 1) {
      s += `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${color}"><title>${escapeHtml(String(d.x))}: ${formatMetricValue(mdef, d.y)}</title></circle>`;
    } else {
      s += `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z" fill="${color}" stroke="#fff" stroke-width="1.5"><title>${escapeHtml(String(d.x))}: ${formatMetricValue(mdef, d.y)} (${(d.y / total * 100).toFixed(1)}%)</title></path>`;
    }
    // データラベル(円グラフはスライス内に%表記)
    if (chart.showDataLabels && sweep > 0.15) { // 小さすぎるスライスには書かない
      const midAngle = angle + sweep / 2;
      const lr = radius * 0.6;
      const lx = cx + lr * Math.cos(midAngle);
      const ly = cy + lr * Math.sin(midAngle);
      s += `<text x="${lx}" y="${ly + 3}" text-anchor="middle" font-size="11" fill="#ffffff" font-weight="700">${(d.y / total * 100).toFixed(0)}%</text>`;
    }
    angle += sweep;
  });
  // 凡例
  const lineH = 16;
  const maxLegend = Math.min(slices.length, Math.floor((H - 20) / lineH));
  for (let i = 0; i < maxLegend; i++) {
    const sl = slices[i];
    const ly = 14 + i * lineH;
    s += `<rect x="${legendX}" y="${ly - 9}" width="10" height="10" fill="${sl.color}" rx="2"/>`;
    const label = `${String(sl.label).slice(0, 18)} ${(sl.pct * 100).toFixed(1)}%`;
    s += `<text x="${legendX + 16}" y="${ly}" font-size="11" fill="#334155">${escapeHtml(label)}</text>`;
  }
  s += '</svg>';
  return s;
}

// 積み上げ棒グラフ (x軸 = bucket, 内訳 = stackBy)
function buildStackedSVG(chart, rows, W, H) {
  const mdef = S.METRIC_DEFS.find(m => m.key === chart.metric);
  const xDim = chart.bucket && chart.bucket !== 'auto' ? chart.bucket : S.SELECTED_DIMS[0];
  const stackDim = chart.stackBy || '';
  if (!mdef || !xDim) return '<div style="padding:24px;text-align:center;color:#64748b;font-size:12px">\u30c7\u30a3\u30e1\u30f3\u30b7\u30e7\u30f3\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044</div>';
  if (!stackDim) return '<div style="padding:24px;text-align:center;color:#64748b;font-size:12px">\u8a2d\u5b9a\u3067\u300c\u7a4d\u307f\u4e0a\u3052\u8ef8\u300d\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044</div>';
  if (xDim === stackDim) return '<div style="padding:24px;text-align:center;color:#64748b;font-size:12px">\u8ef8\u3068\u7a4d\u307f\u4e0a\u3052\u8ef8\u306f\u7570\u306a\u308b\u3082\u306e\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044</div>';

  // グループを 2軸で分ける
  const groups = groupRows(rows, [xDim, stackDim]);
  if (!groups.length) return '<div style="padding:24px;text-align:center;color:#64748b;font-size:12px">\u30c7\u30fc\u30bf\u306a\u3057</div>';

  // x 値と stack 値の一覧を保持しつつ、2次元テーブルに詰める
  const xOrder = [];
  const xSeen = new Set();
  const stackOrder = [];
  const stackSeen = new Set();
  const cell = new Map(); // `${x}\u0001${s}` -> y
  groups.forEach(g => {
    const xv = g.vals[0];
    const sv = g.vals[1];
    if (!xSeen.has(xv)) { xSeen.add(xv); xOrder.push(xv); }
    if (!stackSeen.has(sv)) { stackSeen.add(sv); stackOrder.push(sv); }
    cell.set(`${xv}\u0001${sv}`, aggregate(g.rows)[chart.metric] || 0);
  });

  // 合計の最大値(スケール用)
  const totals = xOrder.map(x => stackOrder.reduce((s, sv) => s + (cell.get(`${x}\u0001${sv}`) || 0), 0));
  const maxY = Math.max(...totals, 0) || 1;

  const PL = 60, PR = 16, PT = 14, PB = 36;
  const iw = W - PL - PR, ih = H - PT - PB;
  const step = iw / xOrder.length;
  const barW = Math.min(step * 0.7, 36);

  let s = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  // グリッド
  for (let i = 0; i <= 4; i++) {
    const y = PT + ih - ih * i / 4;
    const v = maxY * i / 4;
    s += `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="#e2e8f0"/>`;
    s += `<text x="${PL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#64748b">${formatMetricValue(mdef, v)}</text>`;
  }
  // バー
  xOrder.forEach((xv, i) => {
    const cx = PL + step * i + step / 2;
    let yCursor = PT + ih; // 下端から積み上げ
    stackOrder.forEach((sv, si) => {
      const v = cell.get(`${xv}\u0001${sv}`) || 0;
      if (v <= 0) return;
      const h = ih * (v / maxY);
      yCursor -= h;
      const color = STACK_PALETTE[si % STACK_PALETTE.length];
      s += `<rect x="${cx - barW / 2}" y="${yCursor}" width="${barW}" height="${h}" fill="${color}"><title>${escapeHtml(String(xv))} / ${escapeHtml(String(sv))}: ${formatMetricValue(mdef, v)}</title></rect>`;
    });
  });
  // x ラベル
  const labelStride = Math.max(1, Math.ceil(xOrder.length / (chart.size === 'sub' ? 8 : 16)));
  xOrder.forEach((xv, i) => {
    if (i % labelStride !== 0) return;
    const cx = PL + step * i + step / 2;
    s += `<text x="${cx}" y="${H - PB + 16}" text-anchor="middle" font-size="10" fill="#64748b">${escapeHtml(String(xv))}</text>`;
  });
  // データラベル(積み上げ合計値)
  if (chart.showDataLabels) {
    xOrder.forEach((xv, i) => {
      const cx = PL + step * i + step / 2;
      const total = totals[i];
      if (total <= 0) return;
      const y = PT + ih - ih * (total / maxY) - 4;
      s += `<text x="${cx}" y="${y}" text-anchor="middle" font-size="10" fill="#334155" font-weight="600">${formatMetricValue(mdef, total)}</text>`;
    });
  }
  // 凡例 (右上)
  stackOrder.slice(0, 6).forEach((sv, si) => {
    const color = STACK_PALETTE[si % STACK_PALETTE.length];
    const lx = W - PR - 120;
    const ly = 10 + si * 14;
    s += `<rect x="${lx}" y="${ly - 8}" width="10" height="10" fill="${color}" rx="2"/>`;
    s += `<text x="${lx + 14}" y="${ly}" font-size="10" fill="#334155">${escapeHtml(String(sv).slice(0, 14))}</text>`;
  });
  s += '</svg>';
  return s;
}

// lines 配列を正規化 (旧 metric2/3/4 からのマイグレーションもここで行う)
function getComboLines(chart) {
  if (Array.isArray(chart.lines) && chart.lines.length) return chart.lines;
  // 旧スキーマ -> 新スキーマへの互換変換
  const DEFAULT_COLORS = ['#ef4444', '#10b981', '#f59e0b', '#7c3aed', '#0ea5e9', '#ec4899'];
  const out = [];
  if (chart.metric2) out.push({ metric: chart.metric2, color: chart.color2 || DEFAULT_COLORS[0] });
  if (chart.metric3) out.push({ metric: chart.metric3, color: chart.color3 || DEFAULT_COLORS[1] });
  if (chart.metric4) out.push({ metric: chart.metric4, color: chart.color4 || DEFAULT_COLORS[2] });
  return out;
}

// 複合グラフ: 棒(第1メトリクス、左軸) + 折れ線 × 任意本数
function buildComboSVG(chart, rows, W, H) {
  const m1 = S.METRIC_DEFS.find(m => m.key === chart.metric);
  const xDim = chart.bucket && chart.bucket !== 'auto' ? chart.bucket : S.SELECTED_DIMS[0];
  if (!m1 || !xDim) return '<div style="padding:24px;text-align:center;color:#64748b;font-size:12px">\u30c7\u30a3\u30e1\u30f3\u30b7\u30e7\u30f3\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044</div>';

  const lineDefs = getComboLines(chart)
    .map(l => ({ ...l, mdef: S.METRIC_DEFS.find(m => m.key === l.metric) }))
    .filter(l => l.mdef);

  if (!lineDefs.length) return '<div style="padding:24px;text-align:center;color:#64748b;font-size:12px">\u8a2d\u5b9a\u3067\u300c\u7b2c2\u30e1\u30c8\u30ea\u30af\u30b9\u300d\u4ee5\u964d\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044</div>';

  const groups = groupRows(rows, [xDim]);
  const data = groups.map(g => {
    const a = aggregate(g.rows);
    const row = { x: g.vals[0], y1: a[chart.metric] || 0 };
    lineDefs.forEach((l, idx) => { row[`y${idx + 2}`] = a[l.metric] || 0; });
    return row;
  });
  if (!data.length) return '<div style="padding:24px;text-align:center;color:#64748b;font-size:12px">\u30c7\u30fc\u30bf\u306a\u3057</div>';

  const PL = 60, PR = 60, PT = 14, PB = 36;
  const iw = W - PL - PR, ih = H - PT - PB;
  const max1 = Math.max(...data.map(d => d.y1), 0) || 1;
  // 右軸は複数線の最大値を共有
  const maxR = Math.max(
    ...data.flatMap(d => lineDefs.map((_, idx) => d[`y${idx + 2}`])),
    0
  ) || 1;
  const step = iw / data.length;
  const barW = Math.min(step * 0.6, 32);
  const color1 = chart.color || '#2563eb';

  let s = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  // 左軸グリッド + 目盛り (m1)
  for (let i = 0; i <= 4; i++) {
    const y = PT + ih - ih * i / 4;
    const v = max1 * i / 4;
    s += `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="#e2e8f0"/>`;
    s += `<text x="${PL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="${color1}">${formatMetricValue(m1, v)}</text>`;
  }
  // 右軸目盛り (最初の折れ線 mdef の書式を使う)
  for (let i = 0; i <= 4; i++) {
    const y = PT + ih - ih * i / 4;
    const v = maxR * i / 4;
    s += `<text x="${W - PR + 6}" y="${y + 4}" text-anchor="start" font-size="10" fill="${lineDefs[0].color}">${formatMetricValue(lineDefs[0].mdef, v)}</text>`;
  }
  // 棒 (m1)
  data.forEach((d, i) => {
    const cx = PL + step * i + step / 2;
    const h1 = ih * (d.y1 / max1);
    const y1 = PT + ih - h1;
    s += `<rect x="${cx - barW / 2}" y="${y1}" width="${barW}" height="${h1}" fill="${color1}" rx="2"><title>${escapeHtml(String(d.x))} / ${escapeHtml(m1.label)}: ${formatMetricValue(m1, d.y1)}</title></rect>`;
  });
  // 折れ線群
  const linePtsByIdx = lineDefs.map((l, idx) =>
    data.map((d, i) => {
      const cx = PL + step * i + step / 2;
      const cy = PT + ih - ih * (d[`y${idx + 2}`] / maxR);
      return { cx, cy, d, val: d[`y${idx + 2}`] };
    })
  );
  lineDefs.forEach((l, idx) => {
    const pts = linePtsByIdx[idx];
    if (chart.smoothLine) {
      s += `<path d="${smoothPath(pts)}" fill="none" stroke="${l.color}" stroke-width="${chart.lineWidth ?? 2.5}" stroke-linejoin="round" stroke-linecap="round"/>`;
    } else {
      s += `<polyline points="${pts.map(p => `${p.cx},${p.cy}`).join(' ')}" fill="none" stroke="${l.color}" stroke-width="${chart.lineWidth ?? 2.5}" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    if (chart.showDots !== false) {
      const r = chart.dotSize ?? 3.5;
      pts.forEach(p => {
        s += `<circle cx="${p.cx}" cy="${p.cy}" r="${r}" fill="${l.color}" stroke="#ffffff" stroke-width="1.5"><title>${escapeHtml(String(p.d.x))} / ${escapeHtml(l.mdef.label)}: ${formatMetricValue(l.mdef, p.val)}</title></circle>`;
      });
    }
  });
  // データラベル(複合: 棒と全ての折れ線)
  if (chart.showDataLabels) {
    const stride = Math.max(1, Math.ceil(data.length / (chart.size === 'mini' ? 6 : chart.size === 'sub' ? 10 : 20)));
    data.forEach((d, i) => {
      if (i % stride !== 0) return;
      const cx = PL + step * i + step / 2;
      const y1 = PT + ih - ih * (d.y1 / max1);
      s += `<text x="${cx}" y="${y1 - 4}" text-anchor="middle" font-size="10" fill="${color1}" font-weight="600">${formatMetricValue(m1, d.y1)}</text>`;
      lineDefs.forEach((l, idx) => {
        const p = linePtsByIdx[idx][i];
        s += `<text x="${p.cx}" y="${p.cy - 6}" text-anchor="middle" font-size="10" fill="${l.color}" font-weight="600">${formatMetricValue(l.mdef, p.val)}</text>`;
      });
    });
  }
  // x ラベル
  const labelStride = Math.max(1, Math.ceil(data.length / (chart.size === 'sub' ? 8 : 16)));
  data.forEach((d, i) => {
    if (i % labelStride !== 0) return;
    const cx = PL + step * i + step / 2;
    s += `<text x="${cx}" y="${H - PB + 16}" text-anchor="middle" font-size="10" fill="#64748b">${escapeHtml(String(d.x))}</text>`;
  });
  // 凡例
  const legendItems = [{ color: color1, label: m1.label }, ...lineDefs.map(l => ({ color: l.color, label: l.mdef.label }))];
  legendItems.forEach((li, i) => {
    const lx = PL + i * 110;
    s += `<rect x="${lx}" y="2" width="10" height="10" fill="${li.color}" rx="2"/>`;
    s += `<text x="${lx + 14}" y="11" font-size="10" fill="#334155">${escapeHtml(li.label.slice(0, 12))}</text>`;
  });
  s += '</svg>';
  return s;
}

// ===== Chart rendering =====
export function buildChartSVG(chart, rows, W, H) {
  if (chart.type === 'pie') return buildPieSVG(chart, rows, W, H);
  if (chart.type === 'stacked') return buildStackedSVG(chart, rows, W, H);
  if (chart.type === 'combo') return buildComboSVG(chart, rows, W, H);

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
    if (chart.showDataLabels) {
      const stride = Math.max(1, Math.ceil(pts.length / (chart.size === 'mini' ? 6 : chart.size === 'sub' ? 10 : 20)));
      pts.forEach((p, i) => {
        if (i % stride !== 0) return;
        s += `<text x="${p.cx}" y="${p.cy - 4}" text-anchor="middle" font-size="10" fill="#334155" font-weight="600">${yFmt(p.d.y)}</text>`;
      });
    }
  } else if (chart.type === 'area') {
    if (chart.smoothLine) {
      const d = smoothPath(pts);
      const areaD = `${d} L ${pts[pts.length - 1].cx} ${PT + ih} L ${pts[0].cx} ${PT + ih} Z`;
      s += `<path d="${areaD}" fill="url(#${gradId})"/>`;
      s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${chart.lineWidth ?? 2.5}" stroke-linejoin="round" stroke-linecap="round"/>`;
    } else {
      const linePts = pts.map(p => `${p.cx},${p.cy}`).join(' ');
      const areaPts = `${pts[0].cx},${PT + ih} ${linePts} ${pts[pts.length - 1].cx},${PT + ih}`;
      s += `<polygon points="${areaPts}" fill="url(#${gradId})"/>`;
      s += `<polyline points="${linePts}" fill="none" stroke="${color}" stroke-width="${chart.lineWidth ?? 2.5}" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    if (chart.showDots !== false) {
      const r = chart.dotSize ?? 3;
      pts.forEach(p => {
        s += `<circle cx="${p.cx}" cy="${p.cy}" r="${r}" fill="${color}" stroke="#ffffff" stroke-width="1.5"><title>${p.d.x}: ${yFmt(p.d.y)}</title></circle>`;
      });
    }
  } else if (chart.type === 'scatter') {
    const r = chart.dotSize ?? 4;
    pts.forEach(p => {
      s += `<circle cx="${p.cx}" cy="${p.cy}" r="${r}" fill="${color}" fill-opacity="0.75" stroke="${color}" stroke-width="1"><title>${p.d.x}: ${yFmt(p.d.y)}</title></circle>`;
    });
  } else {
    const lw = chart.lineWidth ?? 3;
    if (chart.smoothLine) {
      s += `<path d="${smoothPath(pts)}" fill="none" stroke="${color}" stroke-width="${lw}" stroke-linejoin="round" stroke-linecap="round"/>`;
    } else {
      const linePts = pts.map(p => `${p.cx},${p.cy}`).join(' ');
      s += `<polyline points="${linePts}" fill="none" stroke="${color}" stroke-width="${lw}" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    if (chart.showDots !== false) {
      const r = chart.dotSize ?? 3.5;
      pts.forEach(p => {
        s += `<circle cx="${p.cx}" cy="${p.cy}" r="${r}" fill="${color}" stroke="#ffffff" stroke-width="1.5"><title>${p.d.x}: ${yFmt(p.d.y)}</title></circle>`;
      });
    }
  }
  // データラベル
  if (chart.showDataLabels) {
    const stride = Math.max(1, Math.ceil(pts.length / (chart.size === 'mini' ? 6 : chart.size === 'sub' ? 10 : 20)));
    pts.forEach((p, i) => {
      if (i % stride !== 0) return;
      s += `<text x="${p.cx}" y="${p.cy - 6}" text-anchor="middle" font-size="10" fill="#334155" font-weight="600">${yFmt(p.d.y)}</text>`;
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
        <div class="chart-title"><span class="drag-handle" title="\u30c9\u30e9\u30c3\u30b0\u3067\u4e26\u3073\u66ff\u3048">\u22ee\u22ee</span><span class="chart-name-label">${escapeHtml(c.name || (c.size === 'main' ? '\u30e1\u30a4\u30f3' : c.size === 'mini' ? '\u30df\u30cb' : '\u30b5\u30d6'))}</span></div>
        <div class="chart-ctrl">
          <button type="button" class="chart-settings-btn" data-role="settings" title="\u8a2d\u5b9a">\u2699</button>
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
    const W = body.clientWidth || (c.size === 'main' ? 800 : c.size === 'mini' ? 260 : 400);
    const H = c.size === 'main' ? 280 : c.size === 'mini' ? 140 : 180;
    body.innerHTML = buildChartSVG(c, rows, W, H);
  });
  // 設定パネルが開いていたら中身を更新
  if (S.CHART_SETTINGS_ID != null) {
    const stillExists = S.CHARTS.some(c => c.id === S.CHART_SETTINGS_ID);
    if (stillExists) renderChartSettingsPanel();
    else closeChartSettings();
  }
}

// ===== KPIカード =====
// 期間フィルタ用のヘルパー: 日付フィルタの field を特定してその月一覧を抽出
function getCardDateField() {
  const f = (S.FILTER_DEFS || []).find(x => x.type === 'date_from' || x.type === 'date_to');
  return f?.field || 'action_date';
}
// 日付値の YYYY-MM 部分を取得 (時刻や '/' 区切りも吸収)
function rowMonth(v) {
  if (v == null) return '';
  return String(v).slice(0, 10).replace(/\//g, '-').slice(0, 7);
}
function getMonthsAvailable(rows, field) {
  const set = new Set();
  for (const r of rows) {
    const m = rowMonth(r[field]);
    if (/^\d{4}-\d{2}$/.test(m)) set.add(m);
  }
  return [...set].sort();
}
// 期間フィルタに開始日 or 終了日のどちらかが未入力なら、
// データから月を拾わずに「昨日の月」を基準にする。
function isFilterRangeOpen() {
  const defs = S.FILTER_DEFS || [];
  const vals = S.FILTER_VALUES || {};
  const fromDef = defs.find(d => d.type === 'date_from');
  const toDef = defs.find(d => d.type === 'date_to');
  if (!fromDef || !toDef) return true;
  return !vals[fromDef.id] || !vals[toDef.id];
}
function yesterdayMonth(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() - 1);                 // yesterday
  d.setMonth(d.getMonth() - offset);          // offset 月分前 (0 = 昨日の月, 1 = その先月)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// rows をカードのフィルタモードに従って絞り込む
function applyCardFilter(rows, card) {
  const mode = card.filterMode || 'follow';
  if (mode === 'follow') return rows;
  if (mode === 'latest_month' || mode === 'prev_month') {
    const field = getCardDateField();
    let target;
    // 期間フィルタが片側でも空なら、昨日基準で対象月を決める
    if (isFilterRangeOpen()) {
      target = mode === 'latest_month' ? yesterdayMonth(0) : yesterdayMonth(1);
    } else {
      const months = getMonthsAvailable(rows, field);
      if (!months.length) return rows;
      target = mode === 'latest_month' ? months[months.length - 1] : months[months.length - 2];
    }
    if (!target) return [];
    // フィルタが空の場合は S.RAW から拾う(日付フィルタで切られていない原本)
    const source = isFilterRangeOpen() ? S.RAW : rows;
    return source.filter(r => rowMonth(r[field]) === target);
  }
  return rows;
}

export function renderCards(rows) {
  const grid = document.getElementById('cards-grid');
  if (!grid) return;
  // 設定パネル開いていたら中身も更新
  if (S.CARD_SETTINGS_ID != null) {
    if (S.CARDS.some(c => c.id === S.CARD_SETTINGS_ID)) renderCardSettingsPanel();
    else closeCardSettings();
  }
  if (!S.CARDS.length) {
    grid.innerHTML = '<div class="cards-empty">右上の「+ カード」からカードを追加できます</div>';
    return;
  }
  // フィルタなしの全体集計はキャッシュ。期間カードはその都度。
  const fullAgg = aggregate(rows);
  grid.innerHTML = S.CARDS.map(card => {
    const mode = card.filterMode || 'follow';
    const agg = mode === 'follow' ? fullAgg : aggregate(applyCardFilter(rows, card));
    const mdef = S.METRIC_DEFS.find(m => m.key === card.metric);
    const val = mdef ? formatMetricValue(mdef, agg[card.metric] || 0) : '—';
    const subDef = S.METRIC_DEFS.find(m => m.key === card.subMetric);
    const subVal = subDef ? `${escapeHtml(card.subLabel || subDef.label)}: ${formatMetricValue(subDef, agg[card.subMetric] || 0)}` : '';
    const label = escapeHtml(card.label || (mdef ? mdef.label : 'カード'));
    const bg = card.bgColor || '';
    // 旧 textColor は3要素のフォールバックとして互換
    const fallback = card.textColor || '';
    const labelColor = card.labelColor || fallback;
    const valueColor = card.valueColor || fallback;
    const subColor   = card.subColor   || fallback;
    const cardStyle  = bg ? `background:${bg};` : '';
    const ls = labelColor ? `color:${labelColor};` : '';
    const vs = valueColor ? `color:${valueColor};` : '';
    const ss = subColor   ? `color:${subColor};`   : '';
    const sizeCls = card.size || 'small';
    return `
      <div class="kpi-card kpi-card-${sizeCls}" data-card-id="${card.id}" style="${cardStyle}">
        <div class="kpi-card-head">
          <input type="text" class="kpi-card-label" data-card-role="label" value="${label}" placeholder="名称" style="${ls}">
          <div class="kpi-card-actions">
            <button type="button" class="chart-settings-btn" data-card-role="settings" title="設定">⚙</button>
            <button type="button" class="chart-remove" data-card-role="remove" aria-label="削除">×</button>
          </div>
        </div>
        <div class="kpi-card-value" style="${vs}">${val}</div>
        ${subVal ? `<div class="kpi-card-sub" style="${ss}">${subVal}</div>` : ''}
      </div>
    `;
  }).join('');
}

export function openCardSettings(cardId) {
  S.CARD_SETTINGS_ID = cardId;
  renderCardSettingsPanel();
  document.getElementById('card-settings-panel').classList.remove('hidden');
  document.getElementById('card-settings-backdrop').classList.remove('hidden');
}

export function closeCardSettings() {
  S.CARD_SETTINGS_ID = null;
  document.getElementById('card-settings-panel').classList.add('hidden');
  document.getElementById('card-settings-backdrop').classList.add('hidden');
}

export function renderCardSettingsPanel() {
  const body = document.getElementById('card-settings-body');
  if (!body) return;
  const c = S.CARDS.find(x => x.id === S.CARD_SETTINGS_ID);
  if (!c) { body.innerHTML = ''; return; }
  body.innerHTML = `
    <div class="card-settings-section">
      <div class="card-settings-section-title">メイン</div>
      <label class="chart-settings-field">
        <span class="chart-settings-label">表示名</span>
        <input type="text" data-card-panel-role="label" value="${escapeHtml(c.label || '')}" placeholder="例: 売上">
      </label>
      <label class="chart-settings-field">
        <span class="chart-settings-label">サイズ</span>
        <select data-card-panel-role="size">
          <option value="small"${(c.size || 'small') === 'small' ? ' selected' : ''}>小</option>
          <option value="medium"${c.size === 'medium' ? ' selected' : ''}>中</option>
          <option value="large"${c.size === 'large' ? ' selected' : ''}>大</option>
          <option value="full"${c.size === 'full' ? ' selected' : ''}>横幅いっぱい</option>
        </select>
      </label>
      <label class="chart-settings-field">
        <span class="chart-settings-label">メトリクス</span>
        <select data-card-panel-role="metric">
          <option value="">— 選択してください —</option>
          ${S.METRIC_DEFS.map(m => `<option value="${m.key}"${c.metric === m.key ? ' selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="card-settings-section">
      <div class="card-settings-section-title">サブ（任意）</div>
      <label class="chart-settings-field">
        <span class="chart-settings-label">表示名</span>
        <input type="text" data-card-panel-role="subLabel" value="${escapeHtml(c.subLabel || '')}" placeholder="例: アイテム単価">
      </label>
      <label class="chart-settings-field">
        <span class="chart-settings-label">メトリクス</span>
        <select data-card-panel-role="subMetric">
          <option value="">— なし —</option>
          ${S.METRIC_DEFS.map(m => `<option value="${m.key}"${c.subMetric === m.key ? ' selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="card-settings-section">
      <div class="card-settings-section-title">期間</div>
      <label class="chart-settings-field">
        <span class="chart-settings-label">対象データ</span>
        <select data-card-panel-role="filterMode">
          <option value="follow"${(c.filterMode || 'follow') === 'follow' ? ' selected' : ''}>フィルタに追従</option>
          <option value="latest_month"${c.filterMode === 'latest_month' ? ' selected' : ''}>最新月のみ</option>
          <option value="prev_month"${c.filterMode === 'prev_month' ? ' selected' : ''}>先月のみ</option>
        </select>
      </label>
      <div class="card-settings-hint">「最新月/先月」は現在のフィルタ範囲内で自動判定</div>
    </div>
    <div class="card-settings-section">
      <div class="card-settings-section-title">配色</div>
      <label class="chart-settings-field">
        <span class="chart-settings-label">背景色</span>
        <input type="color" data-card-panel-role="bgColor" value="${c.bgColor || '#ffffff'}">
      </label>
      <div class="chart-settings-row">
        <label class="chart-settings-field" style="flex:1">
          <span class="chart-settings-label">表示名</span>
          <input type="color" data-card-panel-role="labelColor" value="${c.labelColor || c.textColor || '#64748b'}">
        </label>
        <label class="chart-settings-field" style="flex:1">
          <span class="chart-settings-label">集計結果</span>
          <input type="color" data-card-panel-role="valueColor" value="${c.valueColor || c.textColor || '#0f172a'}">
        </label>
        <label class="chart-settings-field" style="flex:1">
          <span class="chart-settings-label">サブ表示</span>
          <input type="color" data-card-panel-role="subColor" value="${c.subColor || c.textColor || '#64748b'}">
        </label>
      </div>
      <button type="button" class="card-color-reset" data-card-panel-role="resetColors">既定色に戻す</button>
    </div>
  `;
}

// ===== グラフ設定サイドパネル =====
export function openChartSettings(chartId) {
  S.CHART_SETTINGS_ID = chartId;
  renderChartSettingsPanel();
  document.getElementById('chart-settings-panel').classList.remove('hidden');
  document.getElementById('chart-settings-backdrop').classList.remove('hidden');
}

export function closeChartSettings() {
  S.CHART_SETTINGS_ID = null;
  document.getElementById('chart-settings-panel').classList.add('hidden');
  document.getElementById('chart-settings-backdrop').classList.add('hidden');
}

export function renderChartSettingsPanel() {
  const body = document.getElementById('chart-settings-body');
  if (!body) return;
  const c = S.CHARTS.find(x => x.id === S.CHART_SETTINGS_ID);
  if (!c) { body.innerHTML = ''; return; }
  const typeOpts = `
    <option value="bar"${c.type === 'bar' ? ' selected' : ''}>\u68d2</option>
    <option value="line"${c.type === 'line' ? ' selected' : ''}>\u6298\u308c\u7dda</option>
    <option value="area"${c.type === 'area' ? ' selected' : ''}>\u30a8\u30ea\u30a2</option>
    <option value="scatter"${c.type === 'scatter' ? ' selected' : ''}>\u6563\u5e03</option>
    <option value="pie"${c.type === 'pie' ? ' selected' : ''}>\u5186\u30b0\u30e9\u30d5</option>
    <option value="stacked"${c.type === 'stacked' ? ' selected' : ''}>\u7a4d\u307f\u4e0a\u3052\u68d2</option>
    <option value="combo"${c.type === 'combo' ? ' selected' : ''}>\u8907\u5408\uff08\u68d2+\u6298\u308c\u7dda\uff09</option>`;
  const xAxisSelect = `
    <select data-panel-role="bucket">
      <option value="auto"${(c.bucket||'auto')==='auto'?' selected':''}>\u30d4\u30dc\u30c3\u30c8\u306b\u8ffd\u5f93</option>
      ${(S.DIMENSIONS || []).map(d => `<option value="${d.key}"${c.bucket === d.key ? ' selected' : ''}>${escapeHtml(d.label)}</option>`).join('')}
    </select>`;
  const y1Select = `
    <select data-panel-role="metric">${S.METRIC_DEFS.map(m => `<option value="${m.key}"${m.key === c.metric ? ' selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}</select>`;

  // 折れ線系(line / area / combo の折れ線)でドット表示オプションを出す
  const hasDots = c.type === 'line' || c.type === 'area' || c.type === 'combo';
  const showDots = c.showDots !== false; // 既定は true
  const dotSize = c.dotSize ?? 3.5;
  const dotControls = hasDots ? `
    <label class="chart-settings-field">
      <span class="chart-settings-label">\u30c9\u30c3\u30c8\u8868\u793a</span>
      <label class="chart-settings-check"><input type="checkbox" data-panel-role="showDots"${showDots ? ' checked' : ''}> <span>\u6298\u308c\u7dda\u306b\u30c9\u30c3\u30c8\u3092\u8868\u793a</span></label>
    </label>
    ${showDots ? `
    <label class="chart-settings-field">
      <span class="chart-settings-label">\u30c9\u30c3\u30c8\u306e\u5927\u304d\u3055 (${dotSize})</span>
      <input type="range" min="1" max="8" step="0.5" data-panel-role="dotSize" value="${dotSize}">
    </label>` : ''}
    <label class="chart-settings-field">
      <span class="chart-settings-label">\u6298\u308c\u7dda\u306e\u592a\u3055 (${c.lineWidth ?? 2.5})</span>
      <input type="range" min="0.5" max="6" step="0.5" data-panel-role="lineWidth" value="${c.lineWidth ?? 2.5}">
    </label>
    <label class="chart-settings-field">
      <span class="chart-settings-label">\u6298\u308c\u7dda\u306e\u5f62\u72b6</span>
      <label class="chart-settings-check"><input type="checkbox" data-panel-role="smoothLine"${c.smoothLine ? ' checked' : ''}> <span>\u66f2\u7dda\u306b\u3059\u308b</span></label>
    </label>
  ` : '';
  // データラベル(ほぼ全種類で意味あるので共通)
  const labelControls = `
    <label class="chart-settings-field">
      <span class="chart-settings-label">\u30c7\u30fc\u30bf\u30e9\u30d9\u30eb</span>
      <label class="chart-settings-check"><input type="checkbox" data-panel-role="showDataLabels"${c.showDataLabels ? ' checked' : ''}> <span>\u6570\u5024\u3092\u5404\u30c7\u30fc\u30bf\u306b\u8868\u793a</span></label>
    </label>`;

  body.innerHTML = `
    <label class="chart-settings-field">
      <span class="chart-settings-label">\u7a2e\u985e</span>
      <select data-panel-role="type">${typeOpts}</select>
    </label>

    <label class="chart-settings-field">
      <span class="chart-settings-label">X\u8ef8\uff08\u30c7\u30a3\u30e1\u30f3\u30b7\u30e7\u30f3\uff09</span>
      ${xAxisSelect}
    </label>

    <label class="chart-settings-field">
      <span class="chart-settings-label">${c.type === 'combo' ? 'Y\u8ef8\uff08\u7b2c1\u30e1\u30c8\u30ea\u30af\u30b9\uff09' : 'Y\u8ef8\uff08\u30e1\u30c8\u30ea\u30af\u30b9\uff09'}</span>
      ${y1Select}
    </label>

    ${c.type === 'combo' ? `
    <div class="chart-settings-field">
      <span class="chart-settings-label">\u6298\u308c\u7dda\uff08\u7b2c2\u30e1\u30c8\u30ea\u30af\u30b9\u4ee5\u964d\uff09</span>
      <div class="combo-lines">
        ${getComboLines(c).map((l, idx) => `
          <div class="combo-line" data-line-idx="${idx}">
            <select data-panel-role="line-metric" data-line-idx="${idx}">
              <option value="">\u2014 \u672a\u9078\u629e \u2014</option>
              ${S.METRIC_DEFS.map(m => `<option value="${m.key}"${l.metric === m.key ? ' selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
            </select>
            <input type="color" data-panel-role="line-color" data-line-idx="${idx}" value="${l.color || '#ef4444'}">
            <button type="button" class="combo-line-remove" data-panel-role="line-remove" data-line-idx="${idx}" aria-label="\u524a\u9664">\u00d7</button>
          </div>
        `).join('')}
        <button type="button" class="combo-line-add" data-panel-role="line-add">+ \u6298\u308c\u7dda\u3092\u8ffd\u52a0</button>
      </div>
    </div>` : ''}

    ${c.type === 'stacked' ? `
    <label class="chart-settings-field">
      <span class="chart-settings-label">\u7a4d\u307f\u4e0a\u3052\u8ef8\uff08\u5185\u8a33\uff09</span>
      <select data-panel-role="stackBy">
        <option value=""${!c.stackBy ? ' selected' : ''}>\u2014 \u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044 \u2014</option>
        ${(S.DIMENSIONS || []).map(d => `<option value="${d.key}"${c.stackBy === d.key ? ' selected' : ''}>${escapeHtml(d.label)}</option>`).join('')}
      </select>
    </label>` : ''}

    ${c.type === 'combo' ? `
    <label class="chart-settings-field">
      <span class="chart-settings-label">\u68d2\u306e\u8272</span>
      <input type="color" data-panel-role="color" value="${c.color || '#2563eb'}">
    </label>` : ''}

    ${c.type !== 'stacked' && c.type !== 'combo' ? `
    <label class="chart-settings-field">
      <span class="chart-settings-label">\u8272</span>
      <input type="color" class="chart-color" data-panel-role="color" value="${c.color || '#2563eb'}">
    </label>` : ''}

    ${dotControls}
    ${labelControls}
  `;
}
