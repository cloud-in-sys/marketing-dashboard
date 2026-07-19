// ===== Utility functions =====
//
// 引数が any のものは「何が来ても壊れないように書いてある」関数。
// 型で狭めると、既存の防御コード (isFinite / String() など) が到達不能になり
// 意味が変わってしまうため、あえて広いままにしている。
export function escapeHtml(s: any): string {
  return String(s).replace(/[&<>"']/g, c => (({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}) as Record<string, string>)[c]);
}
// HTML エスケープした上で改行 (\n) を <br> に変換。複数行ラベル用。
export function escapeHtmlNl(s: any): string {
  return escapeHtml(s).replace(/\n/g, '<br>');
}

export function hexToSoft(hex?: string | null): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return 'rgba(37, 99, 235, 0.15)';
  return `rgba(${parseInt(m[1],16)},${parseInt(m[2],16)},${parseInt(m[3],16)},0.15)`;
}

export function fmt(v: any, type?: string | null): string {
  if (!isFinite(v)) v = 0;
  if (type === 'yen') return '\u00a5' + Math.round(v).toLocaleString();
  if (type === 'pct') return (v * 100).toFixed(2) + '%';
  if (type === 'dec2') return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return Math.round(v).toLocaleString();
}

export function num(v: any): number { const n = Number(v); return isFinite(n) ? n : 0; }

export function getOptions(rows: any[], key: string): any[] {
  return [...new Set(rows.map(r => r[key]).filter(Boolean))].sort();
}
