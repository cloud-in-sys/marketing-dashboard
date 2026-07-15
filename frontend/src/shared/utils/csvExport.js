// ===== CSV DOWNLOAD =====
import { S } from '../../app/state.js';

document.addEventListener('click', e => {
  const btn = e.target.closest('#csv-download-btn');
  if (!btn) return;
  const table = document.getElementById('data-table');
  if (!table) return;
  // colspan/rowspan を展開してグリッドへ流し込む。
  // 転置表示の階層ヘッダーは親見出しを colspan、左端や「計」を rowspan するため、
  // 素直に th/td を並べると画面と列がズレる。
  //   - colspan: 同じ値を占有列ぶん繰り返す (CSV にセル結合が無いため)
  //   - rowspan: 開始行だけ値を入れ、続きの行は空にする
  // 通常表示は colspan/rowspan を使っておらず全て 1 なので、出力は従来と完全に同じ。
  const grid = [];
  const cellAt = (r, c) => { if (!grid[r]) grid[r] = []; return grid[r][c]; };
  let r = 0;
  table.querySelectorAll('tr').forEach(tr => {
    if (!grid[r]) grid[r] = [];
    let c = 0;
    tr.querySelectorAll('th, td').forEach(cell => {
      // 上の行の rowspan が占有している列は飛ばす
      while (cellAt(r, c) !== undefined) c++;
      // 展開/折りたたみボタンやリサイズハンドルを除外
      const clone = cell.cloneNode(true);
      clone.querySelectorAll('button, .col-resizer, .toggle-btn').forEach(el => el.remove());
      let text = clone.textContent.trim();
      if (text.includes(',') || text.includes('"') || text.includes('\n')) {
        text = '"' + text.replace(/"/g, '""') + '"';
      }
      const cs = cell.colSpan || 1;
      const rs = cell.rowSpan || 1;
      for (let i = 0; i < rs; i++) {
        if (!grid[r + i]) grid[r + i] = [];
        for (let j = 0; j < cs; j++) grid[r + i][c + j] = (i === 0) ? text : '';
      }
      c += cs;
    });
    r++;
  });
  const rows = grid.map(cells => Array.from(cells, v => v === undefined ? '' : v).join(','));
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
