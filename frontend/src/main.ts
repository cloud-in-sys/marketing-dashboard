// ===== Dashboard - ES Module Entry Point =====
import '@shared/ui/colorPicker.ts'; // <dashboard-color-picker> カスタム要素を登録 (各設定パネルで使用)
import { on, emit } from '@app/events.ts';
import { S,
  initStateFromServer, saveState, saveCustomTabs, saveViewOrder,
  syncCurrentTabState, getPresets,
  loadSourceMethod, flushUserStateNow, flushPresetsNow, setPresetsErrorNotifier,
  reorderPresetsOp, setUnsavedGuard as setUnsavedGuardState, setTableStateGetter,
  setCanViewCustom, switchSource } from '@app/state.ts';
import { flushConfigNow } from '@app/persistence.ts';
import { buildPath, parsePath, sameRoute, SCREEN, SETTINGS_TARGETS } from '@app/routes.ts';
import { escapeHtml, hexToSoft } from '@shared/utils/utils.ts';
import { showModal } from '@shared/ui/modal.ts';
import { makeSortable } from '@shared/ui/sortable.ts';
import { applyFilters, renderFilters, closeFloatingMs } from '@filters/index.ts';
import { computeRangePreset } from '@filters/dateFilter.ts';
import * as sheets from '@features/sources/sheets.ts';
import { renderChart } from '@features/dashboard/charts/chart.ts';
import { renderCards } from '@features/dashboard/cards/cardsRender.ts';
import { renderTable, getTableState } from '@features/dashboard/table/table.ts';
import { groupRows } from '@aggregate/dimensions.ts';
import { dimLabel } from '@aggregate/dimensions.ts';
import { renderCurrentUserLabel, applyPermissionUI, hideLogin, observeAuth, signIn, hasPerm, getCurrentUser,
  setUnsavedGuard as setUnsavedGuardAuth } from '@app/auth.ts';
import { seedDefaultPresets, renderPresets, loadPresetIntoGlobals, applyPresetFilters, renderTabPresetSelect,
  enterPresetEdit, exitPresetEdit, syncPresetEdit, deletePreset, duplicatePreset, renamePreset, savePresetPrompt,
  loadTabState, initTabStates, setExitSettingsMode as setExitSettingsModePresets } from '@features/presets/presets.ts';
import { renderCustomTabs, renderViewNav, applyView, highlightActiveView, toggleCustomTabGroup, listCustomTabGroups,
  setExitSettingsMode as setExitSettingsModeTabs, setUnsavedGuard as setUnsavedGuardTabs,
  setSyncUrl as setSyncUrlTabs } from '@features/presets/tabs.ts';
import { setupSettingsEvents, exitSettingsMode, enterSettingsMode, confirmDiscardUnsavedChanges, hasUnsavedSettingsChanges,
  setSyncUrl as setSyncUrlSettings } from '@features/settings/settings.ts';
import { FEATURES } from '@app/config.ts';
import { getBackendFollowFilteredRows } from '@aggregate/aggregateCache.ts';
import { renderSourceNav, loadSnapshotIfNeeded, SNAPSHOT, getCurrentLoadVersion, enterSourceView, reloadFullUI,
  setSyncUrl as setSyncUrlSources } from '@features/sources/sources.ts';
import { dlog } from '@app/config.ts';
import { loadState } from '@features/layout/sidebar.ts';
import '@features/dashboard/cards/cards.ts';
import '@features/dashboard/charts/chartsUI.ts';
import '@features/dashboard/table/tableSettings.ts';
import '@features/dashboard/filters/thresholds.ts';
import '@features/layout/sidebar.ts';
import '@shared/utils/csvExport.ts';
import { prefetchAggregates } from '@aggregate/aggregateBackend.ts';
// branding / sparkline は他所でも static import 済み (dynamic import は code-split されないため static に統一)
import { fetchAndApplyBranding } from '@features/sources/branding.ts';
import { prepareSparklineSeries } from '@features/dashboard/table/sparkline.ts';

// ブランド/テーマの初期適用。public GET なので未認証 (ログイン画面表示中) でも取得できる。
fetchAndApplyBranding();

// ===== Wire up circular dep breakers =====
// state.js の syncCurrentTabState がタブ毎に tableState (折り畳み/固定列/倍率) を保存できるようにする
setTableStateGetter(getTableState);
// state.js が viewCustom を見られるようにする (直接 import すると auth.js との循環になる)。
// これが無いと、viewCustom を持たないユーザーにもカスタムタブが初期表示で復元される。
setCanViewCustom(() => hasPerm('viewCustom'));
setExitSettingsModePresets(exitSettingsMode);
setExitSettingsModeTabs(exitSettingsMode);
// 未保存変更ガード注入。auth/tabs/state から呼ばれると settings/index.js の confirm を叩く。
setUnsavedGuardAuth(confirmDiscardUnsavedChanges);
setUnsavedGuardTabs(confirmDiscardUnsavedChanges);
setUnsavedGuardState(confirmDiscardUnsavedChanges);
// 遷移後の URL 同期を各モジュールへ注入 (直接 import すると main.js との循環になる)
setSyncUrlTabs(syncUrl);
setSyncUrlSettings(syncUrl);
setSyncUrlSources(syncUrl);

// beforeunload: 未保存変更があれば browser 標準の離脱警告を出す。カスタムモーダルは出せないので e.returnValue のみ。
window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedSettingsChanges()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ===== CHIPS & PILLS =====
function renderDimPills() {
  document.getElementById('dim-pills')!.innerHTML = S.SELECTED_DIMS.map((k: string) => `
    <span class="pill" data-drag-key="${k}" draggable="true">${dimLabel(k)}<button type="button" class="pill-remove" data-remove="${k}">\u00d7</button></span>
  `).join('');
  const menu = document.getElementById('dim-add-menu')!;
  const avail = S.DIMENSIONS.filter((d) => !S.SELECTED_DIMS.includes(d.key));
  menu.innerHTML = avail.length
    ? avail.map((d: any) => `<button type="button" class="add-menu-item" data-add="${d.key}">${d.label}</button>`).join('')
    : '<div class="add-menu-empty">\u8ffd\u52a0\u3067\u304d\u308b\u9805\u76ee\u306f\u3042\u308a\u307e\u305b\u3093</div>';
}

function renderChips() {
  renderDimPills();
  const selectedSet = new Set(S.SELECTED_METRICS);
  const selectedDefs = S.SELECTED_METRICS.map((k: string) => S.METRIC_DEFS.find((m) => m.key === k)).filter(Boolean);
  const unselected = S.METRIC_DEFS.filter((m) => !selectedSet.has(m.key));
  const ordered = [...selectedDefs, ...unselected];
  document.getElementById('metric-chips')!.innerHTML = ordered.map((m: any) => {
    const active = selectedSet.has(m.key) ? ' active' : '';
    const derived = m.type === 'derived' ? ' derived' : '';
    const dragAttr = active ? ` data-drag-key="${m.key}" draggable="true"` : '';
    return `<button type="button" class="chip${active}${derived}" data-metric="${m.key}"${dragAttr}>${m.label}</button>`;
  }).join('');
}

// バックエンド集計の失敗時に画面上部へ赤バナーを出す。view-header の直下に挿入。
// 画面上部の赤バナー。label は用途に応じて変える (既定は集計エラー)。
// snapshot 取得の失敗は集計より前の段階なので「集計エラー」とは呼ばない。
function showAggregateError(message: any, label = '集計エラー') {
  let el = document.getElementById('aggregate-error');
  if (!el) {
    el = document.createElement('div');
    el.id = 'aggregate-error';
    el.style.cssText = 'background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:8px 14px;margin:6px 12px;border-radius:6px;font-size:13px;display:flex;justify-content:space-between;align-items:center;gap:12px;';
    const header = document.querySelector('.view-header');
    (header?.parentNode || document.body).insertBefore(el, header?.nextSibling || null);
  }
  el.innerHTML = `<span>${label}: ${(message || '不明').toString().replace(/[<>&]/g, '')} — ページをリロードしてください</span><button type="button" onclick="location.reload()" style="background:#991b1b;color:#fff;border:0;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:12px;">リロード</button>`;
  el.style.display = '';
}
function clearAggregateError() {
  const el = document.getElementById('aggregate-error');
  if (el) el.style.display = 'none';
}

// ===== MAIN RENDER =====
// render() は async (prefetchAggregates を await するため)。
// race guard 2 段構え:
//   renderVersion: 同じ source 内で連続呼び出しが起きた時、最新だけ描画
//   sourceVersion: prefetch 中に source が切替わったら結果を捨てる
// 最後に render() が使った rows 参照を保持。resize や軽い再描画で
// 同じ参照を渡すと WeakMap キャッシュにヒットして集計 API を再発火しない。
let lastRenderedRows: any[] | null = null;
let renderVersion = 0;
async function render() {
  // 設定画面 / データソース画面を見ている間はダッシュボードを描画しない。
  // これらの画面は表示していないので、集計 API を撃っても結果は使われず、
  // Cloud Run の CPU 時間と .aggregating スピナーが無駄になるだけ。
  // emit('render') は 40 箇所以上から飛ぶ (フィルタ変更・メトリクス保存・
  // snapshot 取得後など) ので、呼び出し側ではなくここで一度に止める。
  // 画面を戻る時は applyView / applyRoute が改めて render を呼ぶ。
  if (document.body.classList.contains('settings-mode')) {
    document.body.classList.remove('aggregating');
    return;
  }
  const myVersion = ++renderVersion;
  const sourceAtStart = S.CURRENT_SOURCE;
  const loadVersionAtStart = getCurrentLoadVersion();
  const useBackend = FEATURES.useBackendAggregate;
  // useBackend ON: S.RAW を持たないので applyFilters は走らせない (空配列を参照キーとして使う)。
  // useBackend OFF: 従来通りローカルでフィルタ後の rows を作る。
  let rows: any[];
  if (useBackend) {
    rows = [];
  } else {
    rows = applyFilters(S.RAW);
    if (S.CURRENT_FILTER) rows = rows.filter(S.CURRENT_FILTER as any);
  }
  // lastRenderedRows は描画が成功してからセットする (try ブロックの最後)。
  // abort / 例外 / discard された rows は resize 用に保存しない。
  const dims = S.SELECTED_DIMS.length ? S.SELECTED_DIMS : ['action_date'];
  dlog('render start', { sid: sourceAtStart, view: S.CURRENT_VIEW, dims, filterCount: Object.keys(S.FILTER_VALUES || {}).length });
  // ===== 1) SHELL を先に更新 (data なしで決まる UI 部分) =====
  // タブ切替の体感を即時にするため、prefetch を待たずに以下を先に反映:
  //   タイトル / クラム / アクセント色 / ソースアイコン
  // カード/グラフ/表/対象行数は data に依存するので後段。その間は .aggregating
  // クラスでデータ領域を視覚的に「読み込み中」状態にする。
  const titleEl = document.getElementById('view-title');
  const crumbEl = document.getElementById('view-crumb');
  const headerEl = document.querySelector('.view-header') as HTMLElement | null;
  let title = '', crumb = '', accent = '#2563eb';
  if (S.PRESET_EDIT_IDX != null) {
    const p = getPresets()[S.PRESET_EDIT_IDX];
    title = p ? p.name : '\u30d7\u30ea\u30bb\u30c3\u30c8\u7de8\u96c6';
    crumb = '\u30d7\u30ea\u30bb\u30c3\u30c8\u7de8\u96c6\u30e2\u30fc\u30c9';
    accent = p?.color || '#7c3aed';
  } else if (S.VIEWS[S.CURRENT_VIEW!]) {
    title = S.VIEWS[S.CURRENT_VIEW!].label;
    crumb = '\u30c7\u30d5\u30a9\u30eb\u30c8';
    const preset = getPresets().find((p: any) => p.builtin && p.name === title);
    accent = preset?.color || '#2563eb';
  } else {
    const tab = S.CUSTOM_TABS.find((t) => t.key === S.CURRENT_VIEW);
    title = tab ? tab.label : '\u30ab\u30b9\u30bf\u30e0';
    crumb = '\u30ab\u30b9\u30bf\u30e0';
    accent = tab?.color || '#64748b';
  }
  if (titleEl) titleEl.textContent = title;
  if (crumbEl) crumbEl.textContent = crumb;
  if (headerEl) {
    headerEl.style.setProperty('--tab-accent', accent);
    headerEl.style.setProperty('--tab-accent-soft', hexToSoft(accent));
  }
  renderHeaderSourceIcon();

  // ===== 2) DATA 取得中はデータ領域をロード表示 =====
  if (useBackend) {
    document.body.classList.add('aggregating');
    // 旧値が見えると「数字が動いている」ように感じるので、
    // ロード中は「読み込み中...」を表示 (CSS .aggregating でオレンジ点滅)。
    const rcEl = document.getElementById('row-count');
    if (rcEl) rcEl.textContent = '読み込み中...';
  }

  // try/finally で .aggregating の解除を保証 (例外 / abort / 早期 return でも残らない)。
  // ただし「自分が最新でなくなった」ケースは後続 render が制御するため触らない。
  let didPaint = false;
  try {
    // FEATURES.useBackendAggregate ON のとき: 集計をバックエンドへ投げてキャッシュにロード。
    // ローカル経路 (useBackend=false) では結果は常に ok。
    const prefetchResult = await prefetchAggregates(rows);
    if (myVersion !== renderVersion) {
      dlog('render discard: newer render started');
      return;  // 後続 render が .aggregating を制御
    }
    if (S.CURRENT_SOURCE !== sourceAtStart || getCurrentLoadVersion() !== loadVersionAtStart) {
      dlog('render discard: source switched during prefetch');
      return;
    }
    // abort された (前回 in-flight が新 render で取り消された) ケース: エラーバナーは出さず静かに撤退
    if (useBackend && prefetchResult && prefetchResult.aborted) {
      dlog('render discard: prefetch aborted');
      return;
    }
    if (useBackend && prefetchResult && prefetchResult.ok === false) {
      showAggregateError(prefetchResult.error);
      return;
    }
    clearAggregateError();

    // ===== 3) DATA 描画 (集計結果が揃ったので一気に置換) =====
    const groups = groupRows(rows, dims);
    // sparkline メトリクス用の時系列キャッシュを構築 (renderTable 前に必要)
    prepareSparklineSeries(rows, dims);
    renderCards(rows);
    renderChart(rows);
    renderTable(groups);
    didPaint = true;
    // 描画成功後に rows を保存 → resize 時の renderChart で参照される。
    // abort/失敗/discard の場合はここに到達しないので、前回成功時の rows が残り続け、
    // resize 時のチャート再描画は最後に正常表示された状態を維持する。
    lastRenderedRows = rows;

    // 「対象行数」は追従フィルタ (ヘッダ multi-select + 日付) 適用後の行数を表示する。
    // タブの WHERE 式 (view filter) や card filter は含めない (= followFilteredRows)。
    const displayRows = useBackend ? (getBackendFollowFilteredRows(rows) ?? 0) : rows.length;
    document.getElementById('row-count')!.textContent = displayRows.toLocaleString();
    dlog('render end', { sid: sourceAtStart, displayRows });
    saveState();
  } finally {
    // 自分が最新でない (後続 render が走っている) なら触らない。
    // それ以外は確定状態 (描画成功 or 中断) → 必ず .aggregating を外す。
    if (myVersion === renderVersion) {
      document.body.classList.remove('aggregating');
      // 描画していない (discard 等) なら row-count の「読み込み中...」も残らないよう、
      // 直近成功した render の値か空に戻す。ただし最新 render が描画していれば
      // didPaint=true で既に確定値が入っているので、ここは else 分岐のみ。
      if (!didPaint && useBackend) {
        const rcEl = document.getElementById('row-count');
        if (rcEl && rcEl.textContent === '読み込み中...') rcEl.textContent = '—';
      }
    }
  }
}

function renderHeaderSourceIcon() {
  const el = document.getElementById('header-source-icon');
  if (!el) return;
  const rows = S.SOURCE_DATA[S.CURRENT_SOURCE!] || [];
  if (rows.length === 0) { el.innerHTML = ''; return; }
  const method = loadSourceMethod();
  const icons: Record<string, { label: string; html: string }> = {
    csv: {label: 'CSV', html: '\u{1F4C4}'},
    sheets: {label: 'Sheets', html: '<svg viewBox="0 0 48 48" width="14" height="14"><path fill="#43a047" d="M37 45H11c-1.7 0-3-1.3-3-3V6c0-1.7 1.3-3 3-3h19l10 10v29c0 1.7-1.3 3-3 3z"/><path fill="#c8e6c9" d="M40 13H30V3z"/><path fill="#e8f5e9" d="M31 23H17v14h14V23z"/></svg>'},
    bq: {label: 'BQ', html: '<svg viewBox="0 0 48 48" width="14" height="14"><circle cx="24" cy="22" r="16" fill="#4285f4"/><circle cx="25" cy="23" r="6" fill="none" stroke="#fff" stroke-width="2"/><path fill="#fff" d="M30 28l4 4-1.4 1.4-4-4z"/></svg>'},
  };
  const cfg = icons[method] || icons.csv;
  el.innerHTML = `<span class="src-icon" title="${cfg.label}">${cfg.html}</span>`;
}

// ===== Register event bus listeners =====
on('render', render);
on('renderChips', renderChips);
on('renderFilters', renderFilters);

// ===== INITIALIZATION =====
setupSettingsEvents();

// ===== EVENT HANDLERS: TABS & NAVIGATION =====
document.getElementById('view-nav')!.addEventListener('click', e => {
  const btn = (e.target as HTMLElement).closest('[data-view]') as HTMLElement | null;
  if (btn) applyView(btn.dataset.view!);
});
document.getElementById('custom-nav')!.addEventListener('click', e => {
  // グループ ヘッダー: 折りたたみトグル
  const groupBtn = (e.target as HTMLElement).closest('[data-group-toggle]') as HTMLElement | null;
  if (groupBtn) {
    toggleCustomTabGroup(groupBtn.dataset.groupToggle!);
    renderCustomTabs();
    return;
  }
  const del = (e.target as HTMLElement).closest('[data-del-custom]') as HTMLElement | null;
  if (del) {
    // CSS (no-delete-custom) で隠しているが、権限制御を CSS だけに依存しない
    if (!hasPerm('deleteCustom')) return;
    const key = del.dataset.delCustom!;
    const tab = S.CUSTOM_TABS.find((t) => t.key === key);
    const tabName = tab ? tab.label : key;
    showModal({title: '\u30ab\u30b9\u30bf\u30e0\u30bf\u30d6\u3092\u524a\u9664', body: `\u300c${tabName}\u300d\u3092\u524a\u9664\u3057\u307e\u3059\u304b\uff1f\u3053\u306e\u64cd\u4f5c\u306f\u53d6\u308a\u6d88\u305b\u307e\u305b\u3093\u3002`, okText: '\u524a\u9664', danger: true}).then(ok => {
      if (!ok) return;
      const wasCurrent = S.CURRENT_VIEW === key;
      // \u524a\u9664\u524d\u306b CURRENT_VIEW \u3092\u4e00\u6642\u7684\u306b\u5916\u3057\u3066\u304a\u304f\u3002\u3053\u308c\u306b\u3088\u308a applyView \u5185\u306e
      // syncCurrentTabState() \u304c\u300c\u73fe\u5728\u306e\u30bf\u30d6\u306e globals \u3092\u4fdd\u5b58\u3059\u308b\u300d\u51e6\u7406\u3092\u5b9f\u884c\u3057\u3066\u3082\u3001
      // \u524a\u9664\u6e08\u307f\u30bf\u30d6\u306e\u672a\u4fdd\u5b58\u5909\u66f4\u304c\u30d5\u30a9\u30fc\u30eb\u30d0\u30c3\u30af\u5148\u306e\u30bf\u30d6\u3092\u7834\u58ca\u3057\u306a\u3044\u3002
      // CURRENT_VIEW は AppState 上 string | null。フォールバック先が無い
      // (標準タブもカスタムタブも 0 件) 場合は null のまま残る。
      if (wasCurrent) S.CURRENT_VIEW = null;
      S.CUSTOM_TABS = S.CUSTOM_TABS.filter((t) => t.key !== key);
      delete S.TAB_STATES[key];
      saveCustomTabs();
      if (wasCurrent) {
        // \u30d5\u30a9\u30fc\u30eb\u30d0\u30c3\u30af\u5148: summary_daily \u2192 \u4efb\u610f\u306e builtin \u2192 \u6b8b\u30ab\u30b9\u30bf\u30e0\u306e\u5148\u982d
        const fallbackKey = S.VIEWS['summary_daily']
          ? 'summary_daily'
          : Object.keys(S.VIEWS)[0] || S.CUSTOM_TABS[0]?.key;
        if (fallbackKey) {
          applyView(fallbackKey);
        } else {
          renderCustomTabs();
        }
      } else {
        renderCustomTabs();
      }
    });
    return;
  }
  const btn = (e.target as HTMLElement).closest('[data-custom]') as HTMLElement | null;
  if (btn) applyView(btn.dataset.custom!);
});
// \u30c0\u30c3\u30b7\u30e5\u30dc\u30fc\u30c9\u4e0a\u90e8\u306e\u7de8\u96c6\u30dc\u30bf\u30f3 (view-tab-edit) \u30af\u30ea\u30c3\u30af\u3067\u30ab\u30b9\u30bf\u30e0\u30bf\u30d6\u3092\u7de8\u96c6 (\u540d\u524d + \u30b0\u30eb\u30fc\u30d7)\u3002
// \u6a19\u6e96\u30bf\u30d6\u306f\u30ea\u30cd\u30fc\u30e0\u4e0d\u53ef\u306a\u306e\u3067\u30dc\u30bf\u30f3\u81ea\u4f53\u304c CSS \u3067\u975e\u8868\u793a\u3002
document.getElementById('view-tab-edit')!.addEventListener('click', async () => {
  // CSS (no-edit-custom) でもボタンを隠しているが、ここでも必ず確認する
  if (!hasPerm('editCustom')) return;
  const tab = S.CUSTOM_TABS.find((t) => t.key === S.CURRENT_VIEW);
  if (!tab) return;
  const existingGroups = listCustomTabGroups();
  const datalistOptions = existingGroups.map(g => `<option value="${escapeHtml(g)}">`).join('');
  const html = `
    <div class="tab-edit-form">
      <label class="tab-edit-row">
        <span class="tab-edit-label">\u30bf\u30d6\u540d</span>
        <input type="text" id="modal-tab-name" value="${escapeHtml(tab.label)}" placeholder="${escapeHtml(tab.label)}">
      </label>
      <label class="tab-edit-row">
        <span class="tab-edit-label">\u30b0\u30eb\u30fc\u30d7 <small>(\u7a7a\u6b04\u3067\u672a\u30b0\u30eb\u30fc\u30d7\u306b)</small></span>
        <input type="text" id="modal-tab-group" value="${escapeHtml(tab.group || '')}" list="modal-existing-groups" placeholder="\u4f8b: \u55b6\u696d">
        <datalist id="modal-existing-groups">${datalistOptions}</datalist>
      </label>
    </div>
  `;
  const ok = await showModal({title: '\u30bf\u30d6\u3092\u7de8\u96c6', body: html, html: true, okText: '\u4fdd\u5b58'});
  if (!ok) return;
  const newName = ((document.getElementById('modal-tab-name') as HTMLInputElement | null)?.value || '').trim();
  const newGroup = ((document.getElementById('modal-tab-group') as HTMLInputElement | null)?.value || '').trim();
  if (!newName) return;
  const labelChanged = newName !== tab.label;
  const groupChanged = (tab.group || '') !== newGroup;
  if (!labelChanged && !groupChanged) return;
  tab.label = newName;
  if (newGroup) tab.group = newGroup;
  else delete tab.group;
  saveCustomTabs();
  renderCustomTabs();
  document.getElementById('view-title')!.textContent = newName;
});
document.getElementById('custom-nav')!.addEventListener('input', e => {
  const picker = (e.target as HTMLElement).closest('[data-color-key]') as any;
  if (!picker) return;
  if (!hasPerm('editCustom')) return;   // 色も customTabs の変更 = editCustom
  const tab = S.CUSTOM_TABS.find((t) => t.key === picker.dataset.colorKey);
  if (!tab) return;
  const newColor = picker.value;
  tab.color = newColor;
  // 再 render すると picker 自体が作り直されてドラッグ中の操作が奪われるので、
  // CSS 変数だけ in-place で更新する。保存 (debounced) は実行。
  const item = picker.closest('.custom-tab-item') as HTMLElement | null;
  if (item) {
    item.style.setProperty('--tab-color', newColor);
    item.style.setProperty('--tab-color-soft', hexToSoft(newColor));
  }
  saveCustomTabs();
});
document.getElementById('add-custom-tab')!.addEventListener('click', async () => {
  // addCustom は単独付与を許可する仕様 (作成したタブは既定の dims/metrics で開ける)。
  // その後の中身の編集には別途 editCustom が要る。
  if (!hasPerm('addCustom')) return;
  const label = await showModal({title: '\u30ab\u30b9\u30bf\u30e0\u30bf\u30d6\u3092\u8ffd\u52a0', body: '\u30bf\u30d6\u306e\u540d\u524d\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044', input: true, placeholder: '\u4f8b: \u81ea\u5206\u7528\u306e\u5206\u6790', okText: '\u6b21\u3078', noEnter: true});
  if (!label) return;
  const ok = await showModal({title: '\u4f5c\u6210\u306e\u78ba\u8a8d', body: `\u30ab\u30b9\u30bf\u30e0\u30bf\u30d6\u300c${label}\u300d\u3092\u4f5c\u6210\u3057\u307e\u3059\u304b\uff1f`, okText: '\u4f5c\u6210'});
  if (!ok) return;
  const key = 'custom_' + Date.now();
  const color = '#64748b';
  S.CUSTOM_TABS.push({key, label, color});
  S.TAB_STATES[key] = {
    dims: ['action_date'],
    metrics: S.METRIC_DEFS.map((m) => m.key),
    thresholds: {},
    thresholdMetrics: [],
  };
  saveCustomTabs();
  applyView(key);
});

// ===== EVENT HANDLERS: DIMS & METRICS =====
document.getElementById('dim-pills')!.addEventListener('click', e => {
  const btn = (e.target as HTMLElement).closest('[data-remove]') as HTMLElement | null;
  if (!btn) return;
  const k = btn.dataset.remove!;
  S.SELECTED_DIMS = S.SELECTED_DIMS.filter((x: string) => x !== k);
  renderDimPills();
  render();
});
document.getElementById('dim-add-btn')!.addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('dim-add-menu')!.classList.toggle('hidden');
});
document.getElementById('dim-add-menu')!.addEventListener('click', e => {
  const btn = (e.target as HTMLElement).closest('[data-add]') as HTMLElement | null;
  if (!btn) return;
  S.SELECTED_DIMS = [...S.SELECTED_DIMS, btn.dataset.add!];
  document.getElementById('dim-add-menu')!.classList.add('hidden');
  renderDimPills();
  render();
});
document.addEventListener('click', e => {
  if (!(e.target as HTMLElement).closest('.pivot-add')) {
    document.getElementById('dim-add-menu')!.classList.add('hidden');
  }
});
document.getElementById('metric-chips')!.addEventListener('click', e => {
  const btn = (e.target as HTMLElement).closest('[data-metric]') as HTMLElement | null;
  if (!btn) return;
  const k = btn.dataset.metric!;
  if (S.SELECTED_METRICS.includes(k)) S.SELECTED_METRICS = S.SELECTED_METRICS.filter((x: string) => x !== k);
  else S.SELECTED_METRICS = [...S.SELECTED_METRICS, k];
  btn.classList.toggle('active');
  render();
});
document.getElementById('metric-all')!.addEventListener('click', () => {
  S.SELECTED_METRICS = S.METRIC_DEFS.map((m) => m.key);
  renderChips();
  render();
});
document.getElementById('metric-none')!.addEventListener('click', () => {
  S.SELECTED_METRICS = [];
  renderChips();
  render();
});

// ===== TABLE COLUMN RESIZE =====
let resizingCol: { th: HTMLElement; startX: number; startWidth: number } | null = null;
document.getElementById('data-table')!.addEventListener('mousedown', e => {
  const handle = (e.target as HTMLElement).closest('.col-resizer');
  if (!handle) return;
  e.preventDefault();
  e.stopPropagation();
  const th = handle.closest('th') as HTMLElement;
  resizingCol = {th, startX: e.clientX, startWidth: th.offsetWidth};
  document.body.classList.add('col-resizing');
});
document.addEventListener('mousemove', e => {
  if (!resizingCol) return;
  const delta = e.clientX - resizingCol.startX;
  const w = Math.max(40, resizingCol.startWidth + delta);
  resizingCol.th.style.width = w + 'px';
  resizingCol.th.style.minWidth = w + 'px';
});
document.addEventListener('mouseup', () => {
  if (!resizingCol) return;
  resizingCol = null;
  document.body.classList.remove('col-resizing');
});

// ===== CHART TOOLTIPS =====
function hideAllChartTooltips() {
  document.querySelectorAll('.chart-tooltip, .chart-guide').forEach(t => t.classList.add('hidden'));
}
const chartsGrid = document.getElementById('charts-grid')!;
chartsGrid.addEventListener('mousemove', e => {
  const body = (e.target as HTMLElement).closest('[data-chart-body]') as HTMLElement | null;
  if (!body) { hideAllChartTooltips(); return; }
  const id = +body.dataset.chartBody!;
  const info = S.CHART_POINTS.get(id);
  if (!info || !info.points.length) return;
  const rect = body.getBoundingClientRect();
  const localX = (e.clientX - rect.left) / rect.width * info.W;
  let nearest = info.points[0], minD = Infinity;
  for (const p of info.points) {
    const d = Math.abs(p.cx - localX);
    if (d < minD) { minD = d; nearest = p; }
  }
  const guide = document.querySelector(`[data-guide="${id}"]`) as HTMLElement;
  const tooltip = document.querySelector(`[data-tooltip="${id}"]`) as HTMLElement;
  const wrap = body.parentElement!;
  const wrapRect = wrap.getBoundingClientRect();
  const bodyOffset = rect.left - wrapRect.left;
  const xPx = bodyOffset + (nearest.cx / info.W) * rect.width;
  const topPx = (info.PT / info.H) * rect.height;
  const bottomPx = ((info.PT + info.ih) / info.H) * rect.height;
  guide.classList.remove('hidden');
  guide.style.left = xPx + 'px';
  guide.style.top = topPx + 'px';
  guide.style.height = (bottomPx - topPx) + 'px';
  tooltip.classList.remove('hidden');
  const labelLines = String(nearest.label ?? '').split('\n');
  const metricHtml = nearest.metric ? `<div class="tt-m">${escapeHtml(String(nearest.metric))}</div>` : '';
  tooltip.innerHTML = `<div class="tt-x">${escapeHtml(String(nearest.x ?? ''))}</div>${metricHtml}${labelLines.map(l => `<div class="tt-y">${escapeHtml(l)}</div>`).join('')}`;
  const ttW = tooltip.offsetWidth;
  let leftPos = xPx - ttW / 2;
  const maxLeft = wrapRect.width - ttW - 4;
  if (leftPos < 4) leftPos = 4;
  if (leftPos > maxLeft) leftPos = maxLeft;
  tooltip.style.left = leftPos + 'px';
  tooltip.style.top = Math.max(4, topPx - 8) + 'px';
});
chartsGrid.addEventListener('mouseleave', hideAllChartTooltips);

// ===== RESIZE =====
// チャート SVG だけ再描画 (テーブル/カードは寸法変化で再構成不要)。
// 重要: ここで emit('render') すると render() → prefetchAggregates() となり、
// cache miss 時にバックエンド集計 API が発火してしまう。resize で API 課金は
// 完全に不要なので、保存済み rows 参照を使って renderChart() だけ呼び直す。
// rows 参照は WeakMap キャッシュのキーなので、同じ参照なら必ず cache hit。
let resizeTimer: ReturnType<typeof setTimeout>;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (lastRenderedRows !== null) renderChart(lastRenderedRows);
  }, 120);
});

// ===== FILTERS, PANELS, FILE =====
// 外側クリックで floating multi-select を閉じる (Escape は filters/floatingMenu.js 側で処理)。
document.addEventListener('click', () => {
  closeFloatingMs();
});

// ページを閉じる/隠す前に保留中の保存を best-effort で flush。
// fetch keepalive で unload 中も送信を継続する (auth ヘッダ含むので backend は受理可能)。
window.addEventListener('pagehide', () => {
  flushConfigNow({ keepalive: true });
  flushUserStateNow({ keepalive: true });
  flushPresetsNow({ keepalive: true });
});

// プリセット保存失敗をユーザーに通知。連続失敗でモーダルが重ならないよう単純フラグでガード。
// rollback で cache は元に戻っているが optimistic 表示が残るので UI も再 render する。
let _presetsErrModalOpen = false;
setPresetsErrorNotifier(async (e: any) => {
  renderPresets();
  renderTabPresetSelect();
  if (_presetsErrModalOpen) return;
  _presetsErrModalOpen = true;
  try {
    const msg = e?.message || String(e);
    // 409 (同名衝突) は専用モーダル。それ以外は汎用エラー。
    const isConflict = e?.status === 409 || /同じ名前/.test(msg);
    const title = isConflict ? '同じ名前のプリセットがあります' : 'プリセット保存に失敗しました';
    const body = isConflict
      ? `${msg}\n\n別の名前で保存してください。`
      : `プリセットの保存に失敗しました。編集内容は元の状態に戻ります (rollback)。ネットワーク接続を確認してもう一度お試しください。\n\n${msg}`;
    await showModal({ title, body, okText: 'OK', cancelText: '' });
  } finally { _presetsErrModalOpen = false; }
});

// ===== FILTERS TOGGLE =====
document.getElementById('filters-toggle')!.addEventListener('click', () => {
  document.getElementById('filters-bar')!.classList.toggle('collapsed');
});

document.getElementById('filters')!.addEventListener('change', e => {
  const input = (e.target as HTMLElement).closest('input[type=date][data-filter-id]') as HTMLInputElement | null;
  if (!input) return;
  const id = input.dataset.filterId!;
  if (input.dataset.range) {
    // 期間フィルタ: {from, to} オブジェクトの該当キーだけ更新
    const cur = (S.FILTER_VALUES[id] && typeof S.FILTER_VALUES[id] === 'object' && !(S.FILTER_VALUES[id] instanceof Set))
      ? S.FILTER_VALUES[id] : { from: '', to: '' };
    cur[input.dataset.range!] = input.value;
    S.FILTER_VALUES[id] = cur;
  } else {
    S.FILTER_VALUES[id] = input.value;
  }
  render();
});

// 期間フィルタのクイック選択ボタン (今週/先週/今月/先月)
document.getElementById('filters')!.addEventListener('click', e => {
  const btn = (e.target as HTMLElement).closest('[data-range-preset]') as HTMLElement | null;
  if (!btn) return;
  const id = btn.dataset.filterId!;
  const { from, to } = computeRangePreset(btn.dataset.rangePreset!);
  S.FILTER_VALUES[id] = { from, to };
  const fromEl = document.querySelector(`input[data-filter-id="${id}"][data-range="from"]`) as HTMLInputElement | null;
  const toEl = document.querySelector(`input[data-filter-id="${id}"][data-range="to"]`) as HTMLInputElement | null;
  if (fromEl) fromEl.value = from;
  if (toEl) toEl.value = to;
  render();
});

// ===== PRESETS EVENT HANDLERS =====
document.getElementById('save-preset')!.addEventListener('click', savePresetPrompt);
document.getElementById('preset-save-btn')!.addEventListener('click', async () => {
  if (S.PRESET_EDIT_IDX == null) return;
  const list = getPresets();
  const p = list[S.PRESET_EDIT_IDX];
  if (!p) return;
  const ok = await showModal({title: '\u30d7\u30ea\u30bb\u30c3\u30c8\u3092\u4fdd\u5b58', body: `\u300c${p.name}\u300d\u306b\u73fe\u5728\u306e\u7de8\u96c6\u5185\u5bb9\u3092\u4fdd\u5b58\u3057\u307e\u3059\u304b\uff1f`, okText: '\u4fdd\u5b58'});
  if (!ok) return;
  // syncPresetEdit \u306f\u5f53\u8a72 preset \u306e\u66f4\u65b0 Promise \u3092\u8fd4\u3059\u3002await \u3057\u3066\u6210\u529f\u6642\u306e\u307f\u300c\u4fdd\u5b58\u5b8c\u4e86\u300d\u3092\u51fa\u3059\u3002
  // \u5931\u6557\u6642\u306f setPresetsErrorNotifier \u304c\u5225\u30e2\u30fc\u30c0\u30eb\u3092\u51fa\u3059\u306e\u3067\u3001\u3053\u3053\u306f silent return\u3002
  const savePromise = syncPresetEdit();
  renderPresets();
  renderTabPresetSelect();
  try { await savePromise; }
  catch (e) { return; }
  await showModal({title: '\u4fdd\u5b58\u5b8c\u4e86', body: `\u300c${p.name}\u300d\u3092\u4fdd\u5b58\u3057\u307e\u3057\u305f`, okText: 'OK', cancelText: ''});
});
document.getElementById('preset-exit-btn')!.addEventListener('click', async () => {
  if (S.PRESET_EDIT_IDX == null) return;
  const ok = await showModal({title: '\u7de8\u96c6\u3092\u7d42\u4e86', body: '\u4fdd\u5b58\u3057\u3066\u3044\u306a\u3044\u5909\u66f4\u306f\u7834\u68c4\u3055\u308c\u307e\u3059\u3002\u7d42\u4e86\u3057\u307e\u3059\u304b\uff1f', okText: '\u7d42\u4e86', danger: true});
  if (!ok) return;
  // \u30d7\u30ea\u30bb\u30c3\u30c8\u7de8\u96c6\u306f\u8a2d\u5b9a\u306e\u30d7\u30ea\u30bb\u30c3\u30c8\u4e00\u89a7\u304b\u3089\u3057\u304b\u5165\u308c\u306a\u3044\u306e\u3067\u3001\u7d42\u4e86\u3057\u305f\u3089\u4e00\u89a7\u3078\u623b\u3059\u3002
  // \u5148\u306b exitPresetEdit \u3067 isPresetEditDirty \u3092 false \u306b\u3057\u3066\u304b\u3089 enterSettingsMode \u3092
  // \u547c\u3076 (\u3067\u306a\u3044\u3068 enterSettingsMode \u5074\u306e\u672a\u4fdd\u5b58\u78ba\u8a8d\u304c\u4e8c\u91cd\u306b\u51fa\u308b)\u3002
  exitPresetEdit();
  await enterSettingsMode('presets');
});
document.getElementById('preset-list')!.addEventListener('click', e => {
  const ren = (e.target as HTMLElement).closest('.preset-ren') as HTMLElement | null;
  if (ren) { renamePreset(+ren.dataset.idx!); return; }
  const dup = (e.target as HTMLElement).closest('.preset-dup') as HTMLElement | null;
  if (dup) { duplicatePreset(+dup.dataset.idx!); return; }
  const del = (e.target as HTMLElement).closest('.preset-del') as HTMLElement | null;
  if (del) { deletePreset(+del.dataset.idx!); return; }
  const name = (e.target as HTMLElement).closest('.preset-name');
  if (name) {
    const idx = +(name.closest('.preset-item') as HTMLElement).dataset.idx!;
    enterPresetEdit(idx);
  }
});

document.getElementById('tab-preset')!.addEventListener('change', async e => {
  const v = (e.target as HTMLSelectElement).value;
  // 元から sel という別名変数がある (実行時コードは変えていない)
  const sel = e.target as HTMLSelectElement;
  const prev = sel.dataset.prev || '';
  if (v === '') { sel.dataset.prev = ''; return; }
  const idx = +v;
  if (!hasPerm('editCustom')) { sel.value = prev; return; }   // presetName の書き換え = editCustom
  const tab = S.CUSTOM_TABS.find((t) => t.key === S.CURRENT_VIEW);
  if (!tab) { sel.value = prev; return; }
  const list = getPresets();
  if (!list[idx]) { sel.value = prev; return; }
  const ok = await showModal({
    title: '\u30d7\u30ea\u30bb\u30c3\u30c8\u3092\u9069\u7528',
    body: `\u300c${list[idx].name}\u300d\u3092\u3053\u306e\u30bf\u30d6\u306b\u9069\u7528\u3057\u307e\u3059\u304b\uff1f\u73fe\u5728\u306e\u7de8\u96c6\u5185\u5bb9\u306f\u4e0a\u66f8\u304d\u3055\u308c\u307e\u3059\u3002`,
    okText: '\u9069\u7528',
    danger: true,
  });
  if (!ok) { sel.value = prev; return; }
  tab.presetName = list[idx].name;
  saveCustomTabs();
  loadPresetIntoGlobals(list[idx]);
  applyPresetFilters(list[idx]);
  renderFilters();
  syncCurrentTabState();
  renderChips();
  emit('renderThresholds');
  render();
  sel.dataset.prev = v;
});

// カスタムタブの現在内容を新規プリセットとして保存し、そのタブに紐付ける。
document.getElementById('tab-save-preset')!.addEventListener('click', async () => {
  // プリセット新規作成 (savePreset) + タブへの紐付け (presetName の書き換え = editCustom)
  if (!hasPerm('savePreset') || !hasPerm('editCustom')) return;
  const name = await savePresetPrompt();
  if (!name) return;
  const tab = S.CUSTOM_TABS.find((t) => t.key === S.CURRENT_VIEW);
  if (tab) {
    tab.presetName = name;
    saveCustomTabs();
  }
  renderTabPresetSelect();
});

// ===== SORTABLE WIRING =====
makeSortable(document.getElementById('view-nav')!, (from, to, before) => {
  const fromIdx = S.VIEW_ORDER.indexOf(from);
  if (fromIdx < 0) return;
  const [moved] = S.VIEW_ORDER.splice(fromIdx, 1);
  let toIdx = S.VIEW_ORDER.indexOf(to);
  if (!before) toIdx += 1;
  S.VIEW_ORDER.splice(toIdx, 0, moved);
  saveViewOrder();
  renderViewNav();
});
makeSortable(document.getElementById('custom-nav')!, (from, to, before) => {
  // 並べ替え / グループ移動は customTabs の書き換えなので editCustom が要る。
  // (backend の config PATCH も同じ権限で弾くので、ここで止めないと 403 になる)
  if (!hasPerm('editCustom')) return;
  const GROUP_PREFIX = '__group__:';
  const isGroupFrom = from.startsWith(GROUP_PREFIX);
  const isGroupTo = to.startsWith(GROUP_PREFIX);

  if (isGroupFrom) {
    // グループ塊 (子タブ全部) を to の位置に移動
    const groupName = from.slice(GROUP_PREFIX.length);
    const groupTabs = S.CUSTOM_TABS.filter((t) => (t.group || '') === groupName);
    if (!groupTabs.length) return;
    const otherTabs = S.CUSTOM_TABS.filter((t) => (t.group || '') !== groupName);

    let insertIdx: number;
    if (isGroupTo) {
      const targetName = to.slice(GROUP_PREFIX.length);
      if (targetName === groupName) return;
      if (before) {
        const idx = otherTabs.findIndex((t) => (t.group || '') === targetName);
        insertIdx = idx >= 0 ? idx : otherTabs.length;
      } else {
        let last = -1;
        for (let i = 0; i < otherTabs.length; i++) {
          if ((otherTabs[i].group || '') === targetName) last = i;
        }
        insertIdx = last >= 0 ? last + 1 : otherTabs.length;
      }
    } else {
      // タブ ターゲット。他グループの子タブ上なら、そのグループ塊の前後に配置
      const targetIdx = otherTabs.findIndex((t) => t.key === to);
      if (targetIdx < 0) return;
      const targetGroup = otherTabs[targetIdx].group || '';
      if (targetGroup) {
        if (before) {
          insertIdx = otherTabs.findIndex((t) => (t.group || '') === targetGroup);
        } else {
          let last = -1;
          for (let i = 0; i < otherTabs.length; i++) {
            if ((otherTabs[i].group || '') === targetGroup) last = i;
          }
          insertIdx = last + 1;
        }
      } else {
        insertIdx = before ? targetIdx : targetIdx + 1;
      }
    }
    // in-place で mutate (参照を保持しているモジュール向け)
    S.CUSTOM_TABS.splice(0, S.CUSTOM_TABS.length,
      ...otherTabs.slice(0, insertIdx), ...groupTabs, ...otherTabs.slice(insertIdx));
    saveCustomTabs();
    renderCustomTabs();
    return;
  }

  const fromTab = S.CUSTOM_TABS.find((t) => t.key === from);
  if (!fromTab) return;

  if (isGroupTo) {
    // タブをグループ container にドロップ = そのグループへ移動 (先頭 or 末尾)
    const targetName = to.slice(GROUP_PREFIX.length);
    fromTab.group = targetName;
    const fromIdx = S.CUSTOM_TABS.indexOf(fromTab);
    S.CUSTOM_TABS.splice(fromIdx, 1);
    if (before) {
      const idx = S.CUSTOM_TABS.findIndex((t) => (t.group || '') === targetName);
      S.CUSTOM_TABS.splice(idx >= 0 ? idx : S.CUSTOM_TABS.length, 0, fromTab);
    } else {
      let last = -1;
      for (let i = 0; i < S.CUSTOM_TABS.length; i++) {
        if ((S.CUSTOM_TABS[i].group || '') === targetName) last = i;
      }
      S.CUSTOM_TABS.splice(last + 1, 0, fromTab);
    }
    saveCustomTabs();
    renderCustomTabs();
    return;
  }

  const toTab = S.CUSTOM_TABS.find((t) => t.key === to);
  if (!toTab) return;
  // 別グループにドロップしたらグループ移動も合わせて行う (group も書き換え)。
  if ((fromTab.group || '') !== (toTab.group || '')) {
    if (toTab.group) fromTab.group = toTab.group;
    else delete fromTab.group;
  }
  const fromIdx = S.CUSTOM_TABS.indexOf(fromTab);
  S.CUSTOM_TABS.splice(fromIdx, 1);
  let toIdx = S.CUSTOM_TABS.indexOf(toTab);
  if (!before) toIdx += 1;
  S.CUSTOM_TABS.splice(toIdx, 0, fromTab);
  saveCustomTabs();
  renderCustomTabs();
});
makeSortable(document.getElementById('dim-pills')!, (from, to, before) => {
  const fromIdx = S.SELECTED_DIMS.indexOf(from);
  if (fromIdx < 0) return;
  const [moved] = S.SELECTED_DIMS.splice(fromIdx, 1);
  let toIdx = S.SELECTED_DIMS.indexOf(to);
  if (toIdx < 0) toIdx = S.SELECTED_DIMS.length;
  if (!before) toIdx += 1;
  S.SELECTED_DIMS.splice(toIdx, 0, moved);
  syncCurrentTabState();
  renderDimPills();
  render();
});
makeSortable(document.getElementById('metric-chips')!, (from, to, before) => {
  const fromIdx = S.SELECTED_METRICS.indexOf(from);
  if (fromIdx < 0) return;
  const [moved] = S.SELECTED_METRICS.splice(fromIdx, 1);
  let toIdx = S.SELECTED_METRICS.indexOf(to);
  if (toIdx < 0) toIdx = S.SELECTED_METRICS.length;
  if (!before) toIdx += 1;
  S.SELECTED_METRICS.splice(toIdx, 0, moved);
  syncCurrentTabState();
  renderChips();
  render();
});
makeSortable(document.getElementById('preset-list')!, (from, to, before) => {
  const list = getPresets();
  const fromIdx = list.findIndex((p: any) => p.name === from);
  if (fromIdx < 0) return;
  const [moved] = list.splice(fromIdx, 1);
  let toIdx = list.findIndex((p: any) => p.name === to);
  if (!before) toIdx += 1;
  list.splice(toIdx, 0, moved);
  // 並替のみを PATCH で送る (bulk 置換ではないので他ユーザーの編集を潰さない)
  const ids = list.map((p: any) => p.id).filter(Boolean);
  reorderPresetsOp(ids).catch(() => {});
  renderPresets();
});

// ===== PRESET COLOR PICKER =====
document.getElementById('preset-color-picker')!.addEventListener('input', e => {
  if (S.PRESET_EDIT_IDX == null) return;
  const list = getPresets();
  const p = list[S.PRESET_EDIT_IDX];
  if (!p) return;
  p.color = (e.target as any).value;
  renderPresets();
  renderViewNav();
});

// ===== ROUTING (Phase 1: URL を読むだけ。書き込みは正規化の replaceState のみ) =====
// 起動時に URL で要求された画面を開き、最後に URL を「実際に開けた状態」へ揃える。
//
// 方針 (docs/ROADMAP.md):
//   - 開けない URL はエラー画面を出さず、黙って既定へフォールバックする
//     (「権限がありません」はそのソース/画面の存在を教えてしまうため)
//   - 正規化は必ず replaceState。pushState だと戻るボタンで不正 URL に戻り、
//     また弾かれて無限ループになる
//   - 権限判定を router に再実装しない。ソースは S.DATA_SOURCES に載っているか、
//     タブは isOpenableView (state.js) に任せる
async function applyBootRoute(boot: any) {
  const routed = boot?.routed || null;
  const sid = boot?.resolvedSid || S.CURRENT_SOURCE || null;

  // URL の sid が実際に開けたソースと違う (見えない / 存在しない) 場合は、
  // 画面指定 (source / settings) も信用せずダッシュボードへ落とす。
  const sidMatched = !!routed && routed.sid === sid;

  if (sidMatched && routed.screen === SCREEN.SOURCE) {
    // メニュー (⚙ 現在のソースの設定) は no-manage-sources で隠しているので、
    // URL 経由だけ開けるとねじれる。権限が無ければダッシュボードのままにする。
    if (hasPerm('manageSources')) await enterSourceView();
  } else if (sidMatched && routed.screen === SCREEN.SETTINGS) {
    // 権限が無ければ enterSettingsMode を呼ばない = ダッシュボードのまま。
    // 判定は各画面のメニュー押下時と同じものを使い、ここで独自ルールを作らない。
    if (canOpenSettings(routed.target)) await enterSettingsMode(routed.target);
  }

  normalizeUrl();
}

// snapshot の取得結果が「このまま描画してよい」ものか。
// LOADED  : 取得できた
// MISSING : スナップショット未作成。backend が空結果を正常に返すので描画してよい
// FAILED / STALE : 描画しない (呼び出し側で別途扱う)
function isSnapshotUsable(result: string): boolean {
  return result === SNAPSHOT.LOADED || result === SNAPSHOT.MISSING;
}

// 設定サブ画面を開ける権限があるか。settings/index.js のメニュー押下時の条件と揃える。
// (ここがズレると「メニューは出ないのに URL では開ける」等の穴になる)
function canOpenSettings(target?: string): boolean {
  switch (target) {
    case 'users':    return !!getCurrentUser().isAdmin;
    case 'metrics':  return hasPerm('editMetrics');
    case 'filters':  return hasPerm('editFilters');
    case 'dims':     return hasPerm('editDimensions');
    case 'defaults': return hasPerm('editDefaults');
    case 'presets':  return hasPerm('editPreset');
    case 'groups':   return hasPerm('manageGroups');
    case 'branding': return hasPerm('manageBranding');
    default:         return false;
  }
}

// 現在の画面状態から URL を組み立て、今の URL と違えば replaceState で揃える。
// 起動直後の正規化に使う (履歴を積まない)。
function normalizeUrl() {
  const path = buildPath(currentRoute());
  if (path !== window.location.pathname) {
    window.history.replaceState(null, '', path + window.location.search + window.location.hash);
  }
}

// 戻る/進む (popstate) を適用している最中かどうか。
// この間は syncUrl の pushState を止める。popstate の適用で遷移関数を呼ぶと
// その中の syncUrl が走り、「戻ったのに履歴が 1 つ増える」= 戻れなくなるため。
let _applyingPop = false;
// 適用中に新しい戻る/進むが来たことを示すフラグ。適用ループが拾って続けて処理する。
let _pendingPop = false;
// 適用中の route 世代。非同期の適用中に新しい適用が始まったら古い方の後処理を捨てる
// (ROADMAP の route intent token)。
let _routeVersion = 0;

// 遷移後に呼ぶ URL 同期。画面が実際に変わっていれば履歴を 1 つ積む。
//
// 各遷移関数の「中」で URL を作るのではなく、遷移が終わった後に DOM から現在地を
// 読んで同期する方式にしている。理由:
//   - exitSettingsMode は 5 箇所から呼ばれ、applyView の中でも呼ばれる。
//     個別に URL 更新を仕込むと二重 push や順序ズレが起きる。
//   - ガードでキャンセルされた場合、画面は変わらないので currentRoute も変わらず、
//     結果として URL も動かない (「キャンセルしたのに URL だけ進む」が構造的に起きない)。
// 同じ画面なら何もしない (連打やリフレッシュで履歴が膨らまない)。
export function syncUrl() {
  if (_applyingPop) return;   // 戻る/進むの適用中は履歴を積まない
  const route = currentRoute();
  if (!route) return;
  const path = buildPath(route);
  if (path === window.location.pathname) return;
  window.history.pushState(null, '', path + window.location.search + window.location.hash);
}

// 現在どの画面を見ているかを組み立てる。
// 画面種別は DOM (body.settings-mode / 各 view の hidden) が持っているのでそこから読む。
function currentRoute(): any {
  const sid = S.CURRENT_SOURCE;
  if (!sid) return null;
  if (document.body.classList.contains('settings-mode')) {
    if (!document.getElementById('source-view')?.classList.contains('hidden')) {
      return { screen: SCREEN.SOURCE, sid };
    }
    const target = SETTINGS_TARGETS.find(
      t => !document.getElementById(SETTINGS_VIEW_IDS[t])?.classList.contains('hidden')
    );
    if (target) return { screen: SCREEN.SETTINGS, sid, target };
  }
  return { screen: SCREEN.DASHBOARD, sid, viewKey: S.CURRENT_VIEW };
}

// ===== 戻る / 進む (popstate) =====
//
// popstate が来た時点で URL と history は既にブラウザ側で動いている。
// そのため「ガードでキャンセルされたら、URL を元へ戻す」必要がある。
//
// 方針 (docs/ROADMAP.md の 4 点):
//   1. キャンセル時は表示中の画面の URL を pushState で 1 つだけ積み直す
//   2. 適用中に来た分は捨てずに _pendingPop に畳み、今の適用後に最新状態で処理する
//   3. 適用中は syncUrl の pushState を止める (_applyingPop)
//   4. 非同期の適用中に新しい適用が始まったら古い方の後処理を捨てる (_routeVersion)
window.addEventListener('popstate', () => {
  // ログイン前 / ソース未確定のうちは何もしない (起動時の applyBootRoute が担当)
  if (!S.CURRENT_SOURCE) return;
  applyPopState().catch((e: any) => console.warn('[router] popstate failed', e));
});

async function applyPopState() {
  // 適用中に来た分は捨てずに「最後の要求」として覚えておき、今の適用が終わってから
  // 続けて処理する。捨ててしまうと、戻るを素早く 2 回押したときに 1 回分しか
  // 戻らない (ブラウザの履歴位置は 2 つ動いているのに画面は 1 つ手前で止まる)。
  if (_applyingPop) { _pendingPop = true; return; }

  _applyingPop = true;
  try {
    do {
      _pendingPop = false;
      await applyCurrentUrl();
      // 適用中に新しい戻る/進むが来ていたら、その最新状態で繰り返す
    } while (_pendingPop);
  } finally {
    _applyingPop = false;
  }
}

// 「今の window.location」を画面へ適用して URL を辻褄合わせする 1 回分の処理。
async function applyCurrentUrl() {
  // プリセット編集中の戻る/進むは、通常の route 適用 (= settings/presets の 1 つ手前へ) に
  // 任せず、編集を抜けてプリセット一覧 (設定) へ戻す。preset 編集は固有 URL を持たず
  // settings/presets の上に重なっているだけなので、URL だけ動くと画面とズレるため。
  if (S.PRESET_EDIT_IDX != null) {
    if (!(await confirmDiscardUnsavedChanges())) {
      // 未保存の破棄をキャンセル = 編集に留まる。back で動いた URL を settings/presets に戻す。
      const stay = buildPath({ screen: SCREEN.SETTINGS, sid: S.CURRENT_SOURCE!, target: 'presets' });
      if (stay !== window.location.pathname) {
        history.pushState(null, '', stay + window.location.search + window.location.hash);
      }
      return;
    }
    exitPresetEdit();
    await enterSettingsMode('presets');   // 一覧を表示し URL も settings/presets に同期
    return;
  }
  const target = parsePath(window.location.pathname);
  // 解釈できない URL / 同じ画面なら、URL だけ正規化して終わり。
  // ただし新しい戻る/進むが来ている間は URL を触らない (次のループが処理する)。
  if (!target || sameRoute(target, currentRoute())) {
    if (!_pendingPop) normalizeUrl();
    return;
  }

  const myVersion = ++_routeVersion;
  const result = await applyRoute(target);
  if (myVersion !== _routeVersion) return;   // 新しい適用に追い越された

  if (result.reason === 'cancelled') {
    // ユーザーが未保存ガードでキャンセルした = 今の画面に留まりたい。
    // 溜まっている戻る/進むも破棄する。続けると同じモーダルが連打回数ぶん出る。
    _pendingPop = false;
    restoreUrlToCurrentScreen();
    return;
  }
  // 適用中に新しい戻る/進むが来ていたら、URL の方が新しい。ここで URL を
  // 「今の画面」に揃えると、ユーザーが要求した行き先を消してしまう
  // (戻るを 2 回押しても 1 回分しか戻らない原因になる)。次のループに任せる。
  if (_pendingPop) return;
  if (result.ok) {
    normalizeUrl();   // 開けた画面と URL がズレていれば揃える (フォールバック時など)
    return;
  }
  restoreUrlToCurrentScreen();   // 権限なし / 削除済みタブ
}

// ブラウザが既に動かした履歴に対して、「実際に表示している画面」の URL を
// 1 つだけ積み直して辻褄を合わせる。
// replaceState ではなく pushState なのは、戻る操作で消費された履歴位置を
// 埋め直すため (replace だと戻る先が 1 つ足りなくなる)。
function restoreUrlToCurrentScreen() {
  const path = buildPath(currentRoute());
  if (path !== window.location.pathname) {
    window.history.pushState(null, '', path + window.location.search + window.location.hash);
  }
}

// route を実際の画面へ適用する。開けたら true、ガードでキャンセル / 権限なしなら false。
// 既存の遷移入口だけを使う (描画を自前でやらない = ROADMAP 不変条件 3)。
// 戻り値は理由付き。'cancelled' (ユーザーが未保存ガードでキャンセル) と
// それ以外 (権限なし / 削除済み) を呼び出し側で区別するため。
// キャンセルなら「ユーザーは今の画面に留まりたい」ので、溜まっている戻る/進むも含めて
// 一連の処理をやめる。区別せずに続けると、同じモーダルが連打回数ぶん再表示される。
const ROUTE_OK = { ok: true };
const ROUTE_CANCELLED = { ok: false, reason: 'cancelled' };
const ROUTE_BLOCKED = { ok: false, reason: 'blocked' };   // 権限なし / 存在しない

async function applyRoute(route: any): Promise<{ ok: boolean; reason?: string }> {
  // ソースが違うなら先に切り替える。見えないソースなら何もしない。
  if (route.sid !== S.CURRENT_SOURCE) {
    if (!S.DATA_SOURCES.some((s) => s.id === route.sid)) return ROUTE_BLOCKED;
    // switchSource は「ガードでキャンセル」と「別の切替に追い越された (stale)」の
    // どちらでも false を返す。どちらもユーザーを今の画面に留めるので同じ扱いでよい。
    if (!(await switchSource(route.sid))) return ROUTE_CANCELLED;
    await reloadFullUI();
  }

  if (route.screen === SCREEN.SOURCE) {
    if (!hasPerm('manageSources')) return ROUTE_BLOCKED;
    return (await enterSourceView()) ? ROUTE_OK : ROUTE_CANCELLED;
  }
  if (route.screen === SCREEN.SETTINGS) {
    if (!canOpenSettings(route.target)) return ROUTE_BLOCKED;
    await enterSettingsMode(route.target);
    // enterSettingsMode はキャンセル時に undefined を返すため、実際に開けたかは
    // DOM で確認する (戻り値の形に依存しない)
    return currentRoute()?.screen === SCREEN.SETTINGS ? ROUTE_OK : ROUTE_CANCELLED;
  }
  // ダッシュボード
  const viewKey = route.viewKey;
  if (viewKey && viewKey !== S.CURRENT_VIEW) {
    await applyView(viewKey);
    // applyView は「ガードでキャンセル」でも「開けないタブ (削除済み / viewCustom
    // なし)」でも黙って何もしないので、DOM の結果で判定する。
    // 開けないタブなら再試行しても同じなので blocked 扱いにして次へ進ませる。
    if (S.CURRENT_VIEW === viewKey) return ROUTE_OK;
    const openable = S.VIEWS[viewKey] || (hasPerm('viewCustom') && (S.CUSTOM_TABS || []).some((t) => t.key === viewKey));
    return openable ? ROUTE_CANCELLED : ROUTE_BLOCKED;
  }
  // 同じタブで設定画面から戻ってきたケース: 設定を閉じてタブ表示を復元する。
  // このルートは applyView を通らない (viewKey が現在のタブと同じため) ので、
  // 未保存ガードをここで自前に通す必要がある。通さないと、設定を編集したまま
  // 戻るを押した時に確認なしで破棄される。
  // 設定へ入る時に _doEnterSettingsMode がタブの active を全部外している
  // (settings/index.js) ため、閉じるだけだと「どのタブを見ているか分からない」
  // 状態になる。applyView と同じく標準タブ (highlightActiveView) と
  // カスタムタブ (renderCustomTabs) の両方を復元する。
  if (document.body.classList.contains('settings-mode')) {
    if (!(await confirmDiscardUnsavedChanges())) return ROUTE_CANCELLED;
    exitSettingsMode();
    highlightActiveView();
    renderCustomTabs();
    emit('render');
  }
  return ROUTE_OK;
}

// 設定サブ画面 → その画面の要素 id (settings/index.js の _doEnterSettingsMode と対応)
const SETTINGS_VIEW_IDS: Record<string, string> = {
  users: 'settings-view',
  metrics: 'metrics-doc-view',
  filters: 'filters-doc-view',
  dims: 'dims-doc-view',
  defaults: 'defaults-doc-view',
  presets: 'presets-settings-view',
  groups: 'groups-view',
  branding: 'branding-view',
};

// ===== INITIALIZATION SEQUENCE =====
// Wire login buttons (logout は settings/index.js:setupSettingsEvents で「ログアウトしますか？」
// モーダル + 未保存確認付きで登録されるのでここでは不要)。
document.getElementById('login-google-btn')?.addEventListener('click', () => signIn());

// After user signs in, load data from backend and render.
observeAuth({
  onReady: async () => {
    const boot = await initStateFromServer();
    // テナント全体のブランディングを Firestore から取得して反映
    fetchAndApplyBranding();
    // Hydrate Google connection state from backend (shared by sheets+bq)
    await sheets.refreshConnectionState();
    renderFilters();
    renderCurrentUserLabel();
    applyPermissionUI();
    hideLogin();

    renderSourceNav();
    renderViewNav();
    loadState();
    await seedDefaultPresets();
    initTabStates();
    loadTabState(S.CURRENT_VIEW);
    // タブ毎にフィルタが復元されるため UI を再描画
    renderFilters();
    highlightActiveView();
    renderCustomTabs();
    renderChips();
    emit('renderThresholds');
    renderPresets();
    renderTabPresetSelect();
    // 先に URL で要求された画面 (source / settings) を開いてから初期ロードを決める。
    // 順序が逆だと、設定画面を直接開いた場合でもダッシュボードの集計を撃ってから
    // 中断することになり、無駄な API と一瞬のスピナーが出る。
    // ソースとタブは initStateFromServer が既に反映済みなので、ここでは画面だけ。
    await applyBootRoute(boot);

    // 画面ごとに初期ロードを分ける。
    //   ダッシュボード   : snapshot meta を取ってから集計を 1 回。順序が逆だと
    //                      集計の cacheKey に入る updatedAt が空のまま 1 回撃ち、
    //                      取得後にもう 1 回別キーで撃つことになる (dedupe も
    //                      キャッシュも効かず、Cloud Run 側で 2 回集計が走る)。
    //   設定画面         : 集計は撃たない (render 側でも settings-mode を弾いている)。
    //                      ただし snapshot meta とフィルタ選択肢は取る。ここで取らないと
    //                      設定画面からダッシュボードへ移った時にフィルタが空になる
    //                      (populateFilters は reloadFullUI からしか呼ばれないため)。
    //   データソース画面 : enterSourceView が既に loadSnapshotIfNeeded を呼んでいるので
    //                      ここでは呼ばない (二重取得を避ける)
    const bootScreen = currentRoute()?.screen;
    if (bootScreen !== SCREEN.SOURCE) {
      // emitRender: false で「取得だけ」。描画はこの後 1 回だけ自分で行う。
      const snapshotResult = await loadSnapshotIfNeeded({ emitRender: false });
      if (snapshotResult === SNAPSHOT.FAILED) {
        // 取得に失敗した状態で集計を撃つと、空または前ソースの updatedAt で
        // cacheKey が作られ、誤ったキーのキャッシュに当たり続ける。
        // 集計は撃たずにエラーを出す (ユーザーはリロードで復帰できる)。
        showAggregateError('スナップショットの取得に失敗しました', '読み込みエラー');
      } else if (bootScreen === SCREEN.DASHBOARD && isSnapshotUsable(snapshotResult)) {
        // STALE (起動処理中にユーザーがソースを切り替えた) の場合は描画しない。
        // 切替側が自分で snapshot を取り直して描画するので、ここで撃つと
        // updatedAt が未確定のまま二重に集計が飛ぶ。
        render();
      }
    }
  },
  onLoggedOut: () => {
    // Clear everything; user sees login overlay
    S.RAW = [];
    S.SOURCE_DATA = {};
  },
});
