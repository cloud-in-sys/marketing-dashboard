// ===== Utility functions =====
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

export function hexToSoft(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return 'rgba(37, 99, 235, 0.15)';
  return `rgba(${parseInt(m[1],16)},${parseInt(m[2],16)},${parseInt(m[3],16)},0.15)`;
}

export function fmt(v, type) {
  if (!isFinite(v)) v = 0;
  if (type === 'yen') return '\u00a5' + Math.round(v).toLocaleString();
  if (type === 'pct') return (v * 100).toFixed(2) + '%';
  return Math.round(v).toLocaleString();
}

export function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

export function getOptions(rows, key) {
  return [...new Set(rows.map(r => r[key]).filter(Boolean))].sort();
}
