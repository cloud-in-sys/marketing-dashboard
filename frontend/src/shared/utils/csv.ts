// ===== CSV Parsing =====
export function parseCSV(text: string): Record<string, string>[] {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows: string[][] = [];
  let cur: string[] = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i+1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { cur.push(field); field = ''; }
      else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
      else if (c === '\r') {}
      else field += c;
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  // 1 行も無い CSV では shift() が undefined。呼び出し側が事前に中身を確認している前提。
  const header = rows.shift()!.map(h => h.trim());
  return rows
    .filter(r => r.length === header.length && r.some(v => v !== ''))
    .map(r => {
      const o: Record<string, string> = {};
      header.forEach((h, i) => o[h] = r[i]);
      return o;
    });
}
