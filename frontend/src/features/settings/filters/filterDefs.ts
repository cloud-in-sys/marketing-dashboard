import { S, saveFilterDefs } from '@app/state.ts';
import { flushConfigNow, clearPendingConfigKeys } from '@app/persistence.ts';
import { escapeHtml } from '@shared/utils/utils.ts';
import { showModal } from '@shared/ui/modal.ts';
import { hasPerm } from '@app/auth.ts';
import { renderFilters } from '@filters/index.ts';
import { emit } from '@app/events.ts';
import { buildSaveErrorMessage, setSaveButtonState } from '../saveFlow.ts';
import { makeSortable } from '@shared/ui/sortable.ts';

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
    {v: 'date_range', l: '期間 (開始〜終了)'},
    {v: 'multi',      l: '複数選択'},
  ];
  el.innerHTML = `
    <div class="metrics-doc-box">
      ${defs.map((f, i: number) => `
        <div class="metrics-doc-row" data-filter-idx="${i}" data-drag-key="${i}" draggable="true">
          <div class="metrics-doc-row-head filter-row-head">
            <span class="drag-handle" data-drag-handle title="ドラッグで並び替え">⋮⋮</span>
            <div class="field-col"><label class="field-label">名称</label><input type="text" class="metric-label-input" data-filter-label draggable="false" value="${escapeHtml(f.label)}" placeholder="表示名"></div>
            <div class="field-col"><label class="field-label">データカラム</label><input type="text" class="metric-key-input" data-filter-field draggable="false" value="${escapeHtml(f.field)}" placeholder="データカラム名"></div>
            <div class="field-col"><label class="field-label">種類</label><select class="metric-fmt-select" data-filter-type draggable="false">
              ${typeOpts.map((o: any) => `<option value="${o.v}"${f.type===o.v?' selected':''}>${o.l}</option>`).join('')}
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
  makeSortable(document.getElementById('filters-doc')!, (fromStr, toStr, before) => {
    if (!hasPerm('editFilters')) return;
    const from = +fromStr, to = +toStr;
    const defs = S.FILTER_DEFS_DRAFT || S.FILTER_DEFS;
    if (!defs || from === to || isNaN(from) || isNaN(to)) return;
    if (from < 0 || from >= defs.length || to < 0 || to >= defs.length) return;
    const item = defs[from];
    defs.splice(from, 1);
    const toAdjusted = (from < to) ? to - 1 : to;
    const insertAt = before ? toAdjusted : toAdjusted + 1;
    defs.splice(insertAt, 0, item);
    markFiltersDirty();
    renderFiltersDoc();
  });
  document.getElementById('filters-doc')!.addEventListener('input', e => {
    if (!hasPerm('editFilters')) return;
    const row = (e.target as HTMLElement).closest('[data-filter-idx]') as HTMLElement | null;
    if (!row) return;
    const idx = +row.dataset.filterIdx!;
    const defs = S.FILTER_DEFS_DRAFT || S.FILTER_DEFS;
    const def = defs[idx];
    if (!def) return;
    if ((e.target as HTMLElement).matches('[data-filter-label]')) def.label = (e.target as HTMLInputElement).value;
    else if ((e.target as HTMLElement).matches('[data-filter-field]')) def.field = (e.target as HTMLInputElement).value;
    markFiltersDirty();
  });
  document.getElementById('filters-doc')!.addEventListener('change', e => {
    if (!hasPerm('editFilters')) return;
    const row = (e.target as HTMLElement).closest('[data-filter-idx]') as HTMLElement | null;
    if (!row) return;
    const idx = +row.dataset.filterIdx!;
    const defs = S.FILTER_DEFS_DRAFT || S.FILTER_DEFS;
    const def = defs[idx];
    if (!def) return;
    if ((e.target as HTMLElement).matches('[data-filter-type]')) {
      def.type = (e.target as HTMLSelectElement).value;
      markFiltersDirty();
    }
  });
  document.getElementById('filters-doc')!.addEventListener('click', async e => {
    if (!hasPerm('editFilters')) return;
    if ((e.target as HTMLElement).closest('#filters-add-btn')) {
      const defs = S.FILTER_DEFS_DRAFT || S.FILTER_DEFS;
      let n = 1;
      let id = 'filter' + n;
      while (defs.some((f) => f.id === id)) { n++; id = 'filter' + n; }
      defs.push({id, type: 'multi', field: '', label: '新規フィルタ'});
      markFiltersDirty();
      renderFiltersDoc();
      return;
    }
    const rm = (e.target as HTMLElement).closest('[data-filter-remove]') as HTMLElement | null;
    if (rm) {
      const idx = +rm.dataset.filterRemove!;
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
  document.getElementById('filters-save-btn')!.addEventListener('click', async () => {
    if (!hasPerm('editFilters')) return;
    const defs = S.FILTER_DEFS_DRAFT || S.FILTER_DEFS;
    if (defs.some((f) => !f.field)) {
      await showModal({title: '保存できません', body: 'データカラム名が空のフィルタがあります', okText: 'OK', cancelText: ''});
      return;
    }
    const ok = await showModal({title: 'フィルタを保存', body: '変更内容を保存しますか？', okText: '保存'});
    if (!ok) return;

    // ----- Save flow with rollback -----
    const saveBtn = document.getElementById('filters-save-btn');
    const rootEl = document.getElementById('filters-doc-view');
    setSaveButtonState(saveBtn, true, rootEl);
    const prevFilterDefs = S.FILTER_DEFS;
    const prevFilterValues = { ...S.FILTER_VALUES };
    try {
      S.FILTER_DEFS = JSON.parse(JSON.stringify(defs));
      saveFilterDefs();
      for (const k of Object.keys(S.FILTER_VALUES)) delete S.FILTER_VALUES[k];
      renderFilters();
      try {
        await flushConfigNow();
      } catch (e) {
        // Rollback local state
        S.FILTER_DEFS = prevFilterDefs;
        Object.assign(S.FILTER_VALUES, prevFilterValues);
        clearPendingConfigKeys(['filterDefs']);
        renderFilters();
        await showModal({title: '保存に失敗しました', body: buildSaveErrorMessage(e), okText: 'OK', cancelText: ''});
        return;
      }
      clearFiltersDirty();
      emit('render');
      await showModal({title: '保存完了', body: 'フィルタ定義を保存しました', okText: 'OK', cancelText: ''});
    } finally {
      setSaveButtonState(saveBtn, false, rootEl);
    }
  });
}
