import { S, saveViews, saveViewOrder, getPresets, setPresets, compileFilter } from '../state.js';
import { escapeHtml } from '../utils.js';
import { showModal } from '../modal.js';
import { hasPerm } from '../auth.js';
import { renderPresets, renderTabPresetSelect, createBuiltinPresetFor } from '../presets.js';
import { renderViewNav } from '../tabs.js';

// ----- DIRTY FLAGS -----
export function markDefaultsDirty() {
  document.getElementById('defaults-save-btn')?.classList.add('dirty');
}
export function clearDefaultsDirty() {
  document.getElementById('defaults-save-btn')?.classList.remove('dirty');
}

// ----- DEFAULTS VIEW -----
export function renderDefaultsDoc() {
  const el = document.getElementById('defaults-doc');
  if (!el) return;
  const defs = S.VIEWS_DRAFT || [];
  const presets = getPresets();
  el.innerHTML = `
    <div class="metrics-doc-box">
      ${defs.map((v, i) => `
        <div class="metrics-doc-row defaults-row" data-view-idx="${i}">
          <div class="defaults-row-head">
            <div class="field-col"><label class="field-label">名称</label><input type="text" class="metric-label-input" data-view-label value="${escapeHtml(v.label)}" placeholder="タブ名"></div>
            <button type="button" class="metric-del" data-view-remove="${i}" title="削除">×</button>
          </div>
          <div class="defaults-row-preset">
            <label class="defaults-row-label">適用プリセット</label>
            <select class="defaults-preset-select" data-view-preset>
              ${v.presetName ? '' : '<option value="">— 保存時にタブ名で自動作成 —</option>'}
              ${presets.map(p => `<option value="${escapeHtml(p.name)}"${v.presetName===p.name?' selected':''}>${p.builtin?'[標準] ':''}${escapeHtml(p.name)}</option>`).join('')}
            </select>
          </div>
        </div>
      `).join('') || '<div class="preset-empty">デフォルトタブがありません</div>'}
      <button type="button" class="metrics-add-btn" id="defaults-add-btn">+ 標準タブを追加</button>
    </div>
  `;
}

export function setupDefaultsEvents() {
  // ----- DEFAULTS DOC EVENTS -----
  document.getElementById('defaults-doc').addEventListener('input', e => {
    if (!hasPerm('editDefaults')) return;
    const row = e.target.closest('[data-view-idx]');
    if (!row) return;
    const idx = +row.dataset.viewIdx;
    const defs = S.VIEWS_DRAFT || [];
    const def = defs[idx];
    if (!def) return;
    if (e.target.matches('[data-view-label]')) def.label = e.target.value;
    markDefaultsDirty();
  });
  document.getElementById('defaults-doc').addEventListener('change', e => {
    if (!hasPerm('editDefaults')) return;
    const row = e.target.closest('[data-view-idx]');
    if (!row) return;
    const idx = +row.dataset.viewIdx;
    const defs = S.VIEWS_DRAFT || [];
    const def = defs[idx];
    if (!def) return;
    if (e.target.matches('[data-view-preset]')) {
      def.presetName = e.target.value;
      markDefaultsDirty();
    }
  });
  document.getElementById('defaults-doc').addEventListener('click', async e => {
    if (!hasPerm('editDefaults')) return;
    if (e.target.closest('#defaults-add-btn')) {
      const defs = S.VIEWS_DRAFT || [];
      const key = 'view_' + Date.now();
      const existingLabels = new Set(defs.map(v => v.label));
      let label = '新規タブ';
      let n = 2;
      while (existingLabels.has(label)) { label = `新規タブ ${n++}`; }
      defs.push({key, label, dims: ['action_date'], filterExpr: '', presetName: ''});
      markDefaultsDirty();
      renderDefaultsDoc();
      return;
    }
    const rm = e.target.closest('[data-view-remove]');
    if (rm) {
      const idx = +rm.dataset.viewRemove;
      const defs = S.VIEWS_DRAFT || [];
      const def = defs[idx];
      if (!def) return;
      const ok = await showModal({title: '標準定義を削除', body: `「${def.label || def.key}」を削除しますか？`, okText: '削除', danger: true});
      if (!ok) return;
      defs.splice(idx, 1);
      markDefaultsDirty();
      renderDefaultsDoc();
    }
  });
  document.getElementById('defaults-save-btn').addEventListener('click', async () => {
    if (!hasPerm('editDefaults')) return;
    const defs = S.VIEWS_DRAFT || [];
    const keys = defs.map(v => v.key);
    if (keys.some(k => !k)) { await showModal({title: '保存できません', body: '空のキーがあります', okText: 'OK', cancelText: ''}); return; }
    if (new Set(keys).size !== keys.length) { await showModal({title: '保存できません', body: 'キーが重複しています', okText: 'OK', cancelText: ''}); return; }
    const ok = await showModal({title: '標準定義を保存', body: '変更内容を保存しますか？', okText: '保存'});
    if (!ok) return;
    // Build old preset name mapping from current VIEWS
    const oldPresetNames = {};
    for (const [k, v] of Object.entries(S.VIEWS)) {
      oldPresetNames[k] = v.presetName || v.label;
    }

    // Create presets for new tabs / rename presets for renamed tabs
    const presetList = getPresets();
    defs.forEach(v => {
      if (!v.presetName) {
        // New tab: create a builtin preset
        v.presetName = createBuiltinPresetFor(v.label || '新規タブ');
      } else {
        // Existing tab: if label changed, rename the linked preset too
        const oldName = oldPresetNames[v.key];
        if (oldName && oldName !== v.label && v.presetName === oldName) {
          const preset = presetList.find(p => p.name === oldName && p.builtin);
          if (preset) {
            preset.name = v.label;
            v.presetName = v.label;
          }
        }
      }
    });

    const next = {};
    defs.forEach(v => {
      next[v.key] = {
        label: v.label,
        dims: Array.isArray(v.dims) ? [...v.dims] : ['action_date'],
        filterExpr: v.filterExpr || null,
        filter: compileFilter(v.filterExpr),
        presetName: v.presetName,
      };
    });
    S.VIEWS = next;
    saveViews();
    S.VIEW_ORDER = S.VIEW_ORDER.filter(k => S.VIEWS[k]);
    Object.keys(S.VIEWS).forEach(k => { if (!S.VIEW_ORDER.includes(k)) S.VIEW_ORDER.push(k); });
    saveViewOrder();
    if (!S.VIEWS[S.CURRENT_VIEW] && !S.CUSTOM_TABS.some(t => t.key === S.CURRENT_VIEW)) {
      S.CURRENT_VIEW = S.VIEW_ORDER[0] || 'summary_daily';
    }

    // Delete orphan builtin presets (not referenced by any view)
    const referenced = new Set(Object.values(S.VIEWS).map(v => v.presetName));
    const latestPresets = getPresets();
    const cleaned = latestPresets.filter(p => {
      if (!p.builtin) return true;
      return referenced.has(p.name);
    });
    setPresets(cleaned);
    renderPresets();
    renderTabPresetSelect();
    clearDefaultsDirty();
    renderViewNav();
    await showModal({title: '保存完了', body: '標準定義を保存しました', okText: 'OK', cancelText: ''});
  });
}
