import { S } from './state.js';
import { escapeHtml } from './utils.js';
import { groupRows } from './dimensions.js';
import { aggregate } from './aggregate.js';
import { renderChartSettingsPanel, closeChartSettings } from './chartSettings.js';

// 円グラフ / 積み上げ用のカラーパレット
export const PIE_PALETTE = ['#2563eb', '#f59e0b', '#10b981', '#ef4444', '#7c3aed', '#ec4899', '#14b8a6', '#0ea5e9', '#84cc16', '#f97316'];
export const STACK_PALETTE = PIE_PALETTE;

export function formatMetricValue(mdef, v) {
  if (mdef.fmt === 'yen') return '¥' + Math.round(v).toLocaleString();
  if (mdef.fmt === 'pct') return (v * 100).toFixed(1) + '%';
  if (mdef.fmt === 'dec2') return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return Math.round(v).toLocaleString();
}

// 滑らかな折れ線パス (Cardinal spline 風の水平制御)
export function smoothPath(pts) {
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
  if (!mdef || !xDim) return '<div style="padding:24px;text-align:center;color:#64748b;font-size:12px">ディメンションを選択してください</div>';
  const groups = groupRows(rows, [xDim]);
  let data = groups.map(g => ({x: g.vals[0], y: aggregate(g.rows)[chart.metric] || 0}))
    .filter(d => d.y > 0)
    .sort((a, b) => b.y - a.y);
  if (!data.length) return '<div style="padding:24px;text-align:center;color:#64748b;font-size:12px">データなし</div>';

  // 12 項目以上あると見づらいので、上位 11 + 「その他」に集約
  if (data.length > 12) {
    const top = data.slice(0, 11);
    const otherY = data.slice(11).reduce((s, d) => s + d.y, 0);
    data = [...top, { x: 'その他', y: otherY }];
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
  // ツールチップ用ポイント登録（スライス中心をポイントに）
  S.CHART_POINTS.set(chart.id, {
    W, H, PT: 0, ih: H,
    points: slices.map((sl, i) => {
      const midAngle = -Math.PI / 2 + data.slice(0, i).reduce((s, d) => s + (d.y / total) * Math.PI * 2, 0) + (data[i].y / total) * Math.PI;
      return { cx: (cx + radius * 0.5 * Math.cos(midAngle)) / W * W, cy: cy + radius * 0.5 * Math.sin(midAngle), x: sl.label, label: `${formatMetricValue(mdef, sl.value)} (${(sl.pct * 100).toFixed(1)}%)`, metric: mdef.label };
    }),
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
  if (!mdef || !xDim) return '<div style="padding:24px;text-align:center;color:#64748b;font-size:12px">ディメンションを選択してください</div>';
  if (!stackDim) return '<div style="padding:24px;text-align:center;color:#64748b;font-size:12px">設定で「積み上げ軸」を選択してください</div>';
  if (xDim === stackDim) return '<div style="padding:24px;text-align:center;color:#64748b;font-size:12px">軸と積み上げ軸は異なるものを選択してください</div>';

  // グループを 2軸で分ける
  const groups = groupRows(rows, [xDim, stackDim]);
  if (!groups.length) return '<div style="padding:24px;text-align:center;color:#64748b;font-size:12px">データなし</div>';

  // x 値と stack 値の一覧を保持しつつ、2次元テーブルに詰める
  const xOrder = [];
  const xSeen = new Set();
  const stackOrder = [];
  const stackSeen = new Set();
  const cell = new Map(); // `${x}${s}` -> y
  groups.forEach(g => {
    const xv = g.vals[0];
    const sv = g.vals[1];
    if (!xSeen.has(xv)) { xSeen.add(xv); xOrder.push(xv); }
    if (!stackSeen.has(sv)) { stackSeen.add(sv); stackOrder.push(sv); }
    cell.set(`${xv}${sv}`, aggregate(g.rows)[chart.metric] || 0);
  });

  // 合計の最大値(スケール用)
  const totals = xOrder.map(x => stackOrder.reduce((s, sv) => s + (cell.get(`${x}${sv}`) || 0), 0));
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
      const v = cell.get(`${xv}${sv}`) || 0;
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
export function getComboLines(chart) {
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
  if (!m1 || !xDim) return '<div style="padding:24px;text-align:center;color:#64748b;font-size:12px">ディメンションを選択してください</div>';

  const lineDefs = getComboLines(chart)
    .map(l => ({ ...l, mdef: S.METRIC_DEFS.find(m => m.key === l.metric) }))
    .filter(l => l.mdef);

  if (!lineDefs.length) return '<div style="padding:24px;text-align:center;color:#64748b;font-size:12px">設定で「第2メトリクス」以降を選択してください</div>';

  const groups = groupRows(rows, [xDim]);
  const data = groups.map(g => {
    const a = aggregate(g.rows);
    const row = { x: g.vals[0], y1: a[chart.metric] || 0 };
    lineDefs.forEach((l, idx) => { row[`y${idx + 2}`] = a[l.metric] || 0; });
    return row;
  });
  if (!data.length) return '<div style="padding:24px;text-align:center;color:#64748b;font-size:12px">データなし</div>';

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
  // ツールチップ用ポイント登録
  S.CHART_POINTS.set(chart.id, {
    W, H, PT, ih,
    points: data.map((d, i) => {
      const cx = PL + step * i + step / 2;
      const parts = [`${escapeHtml(m1.label)}: ${formatMetricValue(m1, d.y1)}`];
      lineDefs.forEach((l, idx) => { parts.push(`${escapeHtml(l.mdef.label)}: ${formatMetricValue(l.mdef, d[`y${idx + 2}`])}`); });
      return { cx, cy: PT + ih - ih * (d.y1 / max1), x: d.x, label: parts.join('\n'), metric: '' };
    }),
  });
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
  if (!mdef || !xDim) return '<div style="padding:24px;text-align:center;color:#64748b;font-size:12px">ディメンションを選択してください</div>';
  const groups = groupRows(rows, [xDim]);
  const data = groups.map(g => ({x: g.vals[0], y: aggregate(g.rows)[chart.metric] || 0}));
  if (!data.length) return '<div style="padding:24px;text-align:center;color:#64748b;font-size:12px">データなし</div>';

  const PL = 60, PR = 16, PT = 14, PB = 36;
  const iw = W - PL - PR, ih = H - PT - PB;
  const maxY = Math.max(...data.map(d => d.y), 0) || 1;
  const step = iw / data.length;
  const barW = Math.min(step * 0.7, 36);
  const color = chart.color || '#2563eb';
  const gradId = `grad_${chart.id}`;

  const yFmt = v => {
    if (mdef.fmt === 'yen') return '¥' + Math.round(v).toLocaleString();
    if (mdef.fmt === 'pct') return (v * 100).toFixed(1) + '%';
    if (mdef.fmt === 'dec2') return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
        <div class="chart-title"><span class="drag-handle" title="ドラッグで並び替え">⋮⋮</span><span class="chart-name-label">${escapeHtml(c.name || (c.size === 'main' ? 'メイン' : c.size === 'mini' ? 'ミニ' : 'サブ'))}</span></div>
        <div class="chart-ctrl">
          <button type="button" class="chart-settings-btn" data-role="settings" title="設定">⚙</button>
          <button type="button" class="chart-remove" data-role="remove" aria-label="削除">×</button>
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
