import { S, saveDimensions } from '../state.js';
import { escapeHtml } from '../utils.js';
import { showModal } from '../modal.js';
import { hasPerm } from '../auth.js';
import { emit } from '../events.js';

// ----- DIRTY FLAGS -----
export function markDimsDirty() {
  document.getElementById('dims-save-btn')?.classList.add('dirty');
}
export function clearDimsDirty() {
  document.getElementById('dims-save-btn')?.classList.remove('dirty');
}

// ----- DIMENSIONS VIEW -----
export function renderDimsDoc() {
  const el = document.getElementById('dims-doc');
  if (!el) return;
  const defs = S.DIMENSIONS_DRAFT || [];
  const typeOpts = [
    {v: 'value',      l: 'そのまま値'},
    {v: 'date',       l: '日付'},
    {v: 'month',      l: '月 (YYYY-MM)'},
    {v: 'dow',        l: '曜日'},
    {v: 'expression', l: '計算式'},
  ];
  el.innerHTML = `
    <div class="metrics-doc-box">
      ${defs.map((d, i) => {
        const isExpr = d.type === 'expression';
        return `
        <div class="metrics-doc-row dim-row" data-dim-idx="${i}">
          <div class="dim-row-head">
            <div class="field-col"><label class="field-label">名称</label><input type="text" class="metric-label-input" data-dim-label value="${escapeHtml(d.label)}" placeholder="表示名"></div>
            <button type="button" class="metric-del" data-dim-remove="${i}" title="削除">×</button>
          </div>
          <div class="dim-row-grid">
            <div class="dim-field">
              <label>種類</label>
              <select class="dim-type-select" data-dim-type>
                ${typeOpts.map(o => `<option value="${o.v}"${d.type===o.v?' selected':''}>${o.l}</option>`).join('')}
              </select>
            </div>
            <div class="dim-field dim-field-source">
              <label>${isExpr ? '計算式' : 'データカラム'}</label>
              ${isExpr
                ? `<input type="text" class="metric-formula-input" data-dim-expr value="${escapeHtml(d.expression || '')}" placeholder="例: r.operator + ' / ' + r.media">`
                : `<input type="text" class="metric-key-input wide" data-dim-field value="${escapeHtml(d.field || '')}" placeholder="データカラム名">`}
            </div>
          </div>
        </div>`;
      }).join('') || '<div class="preset-empty">ディメンションがありません</div>'}
      <button type="button" class="metrics-add-btn" id="dims-add-btn">+ ディメンションを追加</button>
    </div>
  `;
}

export function setupDimensionsEvents() {
  // ----- DIMS HELP -----
  document.getElementById('dims-help-btn').addEventListener('click', async () => {
    const html = `
      <div class="ref-desc"><strong>ディメンション計算式は JavaScript式ベース</strong>です。行オブジェクト <code>r</code> を参照して任意のJS式を書けます。</div>
      <div class="ref-section-title">種類の意味</div>
      <div class="ref-syntax">
        <code>そのまま値</code> — データカラムの値をそのまま使う<br>
        <code>日付</code> — 日付として扱う（YYYY-MM-DD)<br>
        <code>月 (YYYY-MM)</code> — 日付の先頭7文字を抽出<br>
        <code>曜日</code> — 日付から曜日(日/月/火/...)に変換<br>
        <code>計算式</code> — 任意のJS式で行から値を算出
      </div>
      <div class="ref-section-title">計算式で使える要素</div>
      <div class="metrics-doc-info-grid">
        <div><code>r.カラム名</code> 行から値を取得</div>
        <div><code>+</code> 文字列結合 / 加算</div>
        <div><code>( )</code> 優先順位</div>
        <div><code>x > 0 ? 'A' : 'B'</code> 条件分岐</div>
        <div><code>String(r.x).slice(0,7)</code> 文字列切出</div>
        <div><code>r.x.toUpperCase()</code> 大文字化</div>
        <div><code>Number(r.x)</code> 数値変換</div>
        <div><code>r.x ?? '不明'</code> null埋め</div>
      </div>
      <div class="ref-desc">
        <code>r</code> はCSVの1行分のオブジェクト。<code>r.operator</code> のようにデータカラム名で値を参照できます。
      </div>
      <div class="ref-section-title">計算式の例</div>
      <div class="ref-syntax">
        <code>r.operator + ' / ' + r.media</code> → "代理店A / Meta"<br>
        <code>r.funnel === '広告' ? '広告' : 'CV'</code> → "広告" または "CV"<br>
        <code>String(r.action_date).slice(0, 4)</code> → "2024"（年のみ）<br>
        <code>r.clicks > 100 ? '高' : '低'</code> → "高" or "低"
      </div>
      <div class="ref-desc">エラー時や未定義値の場合は空文字になります。変更は「変更を保存」ボタンで確定し、全タブに反映されます。</div>
    `;
    await showModal({title: 'ディメンション定義の使い方', body: html, html: true, wide: true, okText: '閉じる', cancelText: ''});
  });

  // ----- DIMS DOC EVENTS -----
  document.getElementById('dims-doc').addEventListener('input', e => {
    if (!hasPerm('editDimensions')) return;
    const row = e.target.closest('[data-dim-idx]');
    if (!row) return;
    const idx = +row.dataset.dimIdx;
    const defs = S.DIMENSIONS_DRAFT || [];
    const def = defs[idx];
    if (!def) return;
    if (e.target.matches('[data-dim-label]')) def.label = e.target.value;
    else if (e.target.matches('[data-dim-field]')) def.field = e.target.value;
    else if (e.target.matches('[data-dim-expr]')) def.expression = e.target.value;
    markDimsDirty();
  });
  document.getElementById('dims-doc').addEventListener('change', e => {
    if (!hasPerm('editDimensions')) return;
    const row = e.target.closest('[data-dim-idx]');
    if (!row) return;
    const idx = +row.dataset.dimIdx;
    const defs = S.DIMENSIONS_DRAFT || [];
    const def = defs[idx];
    if (!def) return;
    if (e.target.matches('[data-dim-type]')) {
      def.type = e.target.value;
      markDimsDirty();
      renderDimsDoc();
    }
  });
  document.getElementById('dims-doc').addEventListener('click', async e => {
    if (!hasPerm('editDimensions')) return;
    if (e.target.closest('#dims-add-btn')) {
      const defs = S.DIMENSIONS_DRAFT || [];
      let n = 1;
      let key = 'dim' + n;
      while (defs.some(d => d.key === key)) { n++; key = 'dim' + n; }
      defs.push({key, label: '新規ディメンション', field: '', type: 'value'});
      markDimsDirty();
      renderDimsDoc();
      return;
    }
    const rm = e.target.closest('[data-dim-remove]');
    if (rm) {
      const idx = +rm.dataset.dimRemove;
      const defs = S.DIMENSIONS_DRAFT || [];
      const def = defs[idx];
      if (!def) return;
      const ok = await showModal({title: 'ディメンションを削除', body: `「${def.label || def.key}」を削除しますか？`, okText: '削除', danger: true});
      if (!ok) return;
      defs.splice(idx, 1);
      markDimsDirty();
      renderDimsDoc();
    }
  });
  document.getElementById('dims-save-btn').addEventListener('click', async () => {
    if (!hasPerm('editDimensions')) return;
    const defs = S.DIMENSIONS_DRAFT || [];
    const keys = defs.map(d => d.key);
    if (keys.some(k => !k)) { await showModal({title: '保存できません', body: '空のキーがあります', okText: 'OK', cancelText: ''}); return; }
    if (new Set(keys).size !== keys.length) { await showModal({title: '保存できません', body: 'キーが重複しています', okText: 'OK', cancelText: ''}); return; }
    for (const d of defs) {
      if (d.type === 'expression') {
        if (!d.expression) { await showModal({title: '保存できません', body: `「${d.label || d.key}」の計算式が空です`, okText: 'OK', cancelText: ''}); return; }
        try { new Function('r', `"use strict"; return (${d.expression})`); }
        catch (err) { await showModal({title: '保存できません', body: `「${d.label || d.key}」の計算式に構文エラーがあります`, okText: 'OK', cancelText: ''}); return; }
      } else {
        if (!d.field) { await showModal({title: '保存できません', body: `「${d.label || d.key}」のデータカラム名が空です`, okText: 'OK', cancelText: ''}); return; }
      }
    }
    const ok = await showModal({title: 'ディメンション定義を保存', body: '変更内容を保存しますか？', okText: '保存'});
    if (!ok) return;
    S.DIMENSIONS = JSON.parse(JSON.stringify(defs));
    S.DIM_EXPR_CACHE.clear();
    saveDimensions();
    const validKeys = new Set(S.DIMENSIONS.map(d => d.key));
    S.SELECTED_DIMS = S.SELECTED_DIMS.filter(k => validKeys.has(k));
    clearDimsDirty();
    emit('renderChips');
    emit('render');
    await showModal({title: '保存完了', body: 'ディメンション定義を保存しました', okText: 'OK', cancelText: ''});
  });
}
