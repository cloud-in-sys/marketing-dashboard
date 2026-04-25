import { S, saveFilterDefs } from '../state.js';
import { escapeHtml } from '../utils.js';
import { showModal } from '../modal.js';
import { hasPerm } from '../auth.js';
import { renderFilters } from '../filters.js';
import { emit } from '../events.js';

// ----- DIRTY FLAGS -----
export function markFiltersDirty() {
  document.getElementById('filters-save-btn')?.classList.add('dirty');
}
export function clearFiltersDirty() {
  document.getElementById('filters-save-btn')?.classList.remove('dirty');
}

// ----- FILTERS VIEW -----
export function renderFiltersDoc() {
  const el = document.getElementById('filters-doc');
  if (!el) return;
  const defs = S.FILTER_DEFS_DRAFT || S.FILTER_DEFS;
  const typeOpts = [
    {v: 'date_from', l: '開始日 (>=)'},
    {v: 'date_to',   l: '終了日 (<=)'},
    {v: 'multi',     l: '複数選択'},
  ];
  el.innerHTML = `
    <div class="metrics-doc-box">
      ${defs.map((f, i) => `
        <div class="metrics-doc-row" data-filter-idx="${i}">
          <div class="metrics-doc-row-head">
            <div class="field-col"><label class="field-label">名称</label><input type="text" class="metric-label-input" data-filter-label value="${escapeHtml(f.label)}" placeholder="表示名"></div>
            <div class="field-col"><label class="field-label">データカラム</label><input type="text" class="metric-key-input" data-filter-field value="${escapeHtml(f.field)}" placeholder="データカラム名"></div>
            <div class="field-col"><label class="field-label">種類</label><select class="metric-fmt-select" data-filter-type>
              ${typeOpts.map(o => `<option value="${o.v}"${f.type===o.v?' selected':''}>${o.l}</option>`).join('')}
            </select></div>
            <button type="button" class="metric-del" data-filter-remove="${i}" title="削除">×</button>
          </div>
        </div>
      `).join('') || '<div class="preset-empty">フィルタがありません</div>'}
      <button type="button" class="metrics-add-btn" id="filters-add-btn">+ フィルタを追加</button>
    </div>
  `;
}

export function setupFilterDefsEvents() {
  // ----- FILTERS DOC EVENTS -----
  document.getElementById('filters-doc').addEventListener('input', e => {
    if (!hasPerm('editFilters')) return;
    const row = e.target.closest('[data-filter-idx]');
    if (!row) return;
    const idx = +row.dataset.filterIdx;
    const defs = S.FILTER_DEFS_DRAFT || S.FILTER_DEFS;
    const def = defs[idx];
    if (!def) return;
    if (e.target.matches('[data-filter-label]')) def.label = e.target.value;
    else if (e.target.matches('[data-filter-field]')) def.field = e.target.value;
    markFiltersDirty();
  });
  document.getElementById('filters-doc').addEventListener('change', e => {
    if (!hasPerm('editFilters')) return;
    const row = e.target.closest('[data-filter-idx]');
    if (!row) return;
    const idx = +row.dataset.filterIdx;
    const defs = S.FILTER_DEFS_DRAFT || S.FILTER_DEFS;
    const def = defs[idx];
    if (!def) return;
    if (e.target.matches('[data-filter-type]')) {
      def.type = e.target.value;
      markFiltersDirty();
    }
  });
  document.getElementById('filters-doc').addEventListener('click', async e => {
    if (!hasPerm('editFilters')) return;
    if (e.target.closest('#filters-add-btn')) {
      const defs = S.FILTER_DEFS_DRAFT || S.FILTER_DEFS;
      let n = 1;
      let id = 'filter' + n;
      while (defs.some(f => f.id === id)) { n++; id = 'filter' + n; }
      defs.push({id, type: 'multi', field: '', label: '新規フィルタ'});
      markFiltersDirty();
      renderFiltersDoc();
      return;
    }
    const rm = e.target.closest('[data-filter-remove]');
    if (rm) {
      const idx = +rm.dataset.filterRemove;
      const defs = S.FILTER_DEFS_DRAFT || S.FILTER_DEFS;
      const def = defs[idx];
      if (!def) return;
      const ok = await showModal({title: 'フィルタを削除', body: `「${def.label || def.id}」を削除しますか？`, okText: '削除', danger: true});
      if (!ok) return;
      defs.splice(idx, 1);
      markFiltersDirty();
      renderFiltersDoc();
    }
  });
  document.getElementById('filters-save-btn').addEventListener('click', async () => {
    if (!hasPerm('editFilters')) return;
    const defs = S.FILTER_DEFS_DRAFT || S.FILTER_DEFS;
    if (defs.some(f => !f.field)) {
      await showModal({title: '保存できません', body: 'データカラム名が空のフィルタがあります', okText: 'OK', cancelText: ''});
      return;
    }
    const ok = await showModal({title: 'フィルタを保存', body: '変更内容を保存しますか？', okText: '保存'});
    if (!ok) return;
    S.FILTER_DEFS = JSON.parse(JSON.stringify(defs));
    saveFilterDefs();
    for (const k of Object.keys(S.FILTER_VALUES)) delete S.FILTER_VALUES[k];
    renderFilters();
    clearFiltersDirty();
    emit('render');
    await showModal({title: '保存完了', body: 'フィルタ定義を保存しました', okText: 'OK', cancelText: ''});
  });
}
