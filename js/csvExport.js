// ===== CSV DOWNLOAD =====
import { S } from './state.js';

document.addEventListener('click', e => {
  const btn = e.target.closest('#csv-download-btn');
  if (!btn) return;
  const table = document.getElementById('data-table');
  if (!table) return;
  const rows = [];
  table.querySelectorAll('tr').forEach(tr => {
    const cells = [];
    tr.querySelectorAll('th, td').forEach(cell => {
      // 展開/折りたたみボタンやリサイズハンドルを除外
      const clone = cell.cloneNode(true);
      clone.querySelectorAll('button, .col-resizer, .toggle-btn').forEach(el => el.remove());
      let text = clone.textContent.trim();
      if (text.includes(',') || text.includes('"') || text.includes('\n')) {
        text = '"' + text.replace(/"/g, '""') + '"';
      }
      cells.push(text);
    });
    rows.push(cells.join(','));
  });
  const csv = '﻿' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const ds = S.DATA_SOURCES.find(d => d.id === S.CURRENT_SOURCE);
  a.download = `${ds?.name || 'data'}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});
