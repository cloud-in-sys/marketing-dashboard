// ===== Data sources / source view (split out of main.js) =====
import { emit, on } from '../../app/events.js';
import { S, switchSource, saveSheetsInput, loadSheetsInput,
  saveBqInput, loadBqInput,
  saveSourceMethod,
  clearSourceRaw } from '../../app/state.js';
import { escapeHtml } from '../../shared/utils/utils.js';
import { parseCSV } from '../../shared/utils/csv.js';
import { showModal } from '../../shared/ui/modal.js';
import { populateFilters, renderFilters, renderMSDynamic, closeFloatingMs } from '../../filters/index.js';
import { renderViewNav, highlightActiveView, renderCustomTabs } from '../presets/tabs.js';
import { initTabStates, loadTabState, renderPresets, renderTabPresetSelect } from '../presets/presets.js';
import { exitSettingsMode, renderCsvColumns, confirmDiscardUnsavedChanges } from '../settings/settings.js';
import { api } from '../../api/index.js';
import * as sheets from './sheets.js';
import * as bq from './bq.js';
import { makeSortable } from '../../shared/ui/sortable.js';
import { hasPerm } from '../../app/auth.js';
import { FEATURES, dlog } from '../../app/config.js';
import { getOptions } from '../../shared/utils/utils.js';
import { invalidateAggregateCache, abortInFlightAggregate } from '../../aggregate/aggregateBackend.js';

// ===== DATA SOURCES =====
// source 切替後の UI 全体再構築。
// 1) クリティカル UI (filters / tab nav / chips / source nav) は同期で先に出す
// 2) 非クリティカル UI (presets / preset select / csv columns) は次フレームへ
//    遅延 → 同期 DOM ワークを切り上げてユーザー操作の受付を優先
// 3) loadSnapshotIfNeeded() を await して snapshot meta + filter options を取得
//    (loadSnapshotIfNeeded 内で emit('render') が走るので、ここでは追加で render を呼ばない)
export async function reloadFullUI() {
  // 新 source に切り替えた瞬間、前 source / 前タブの aggregate を即 abort。
  // これがないと、後段の loadSnapshotIfNeeded が emit('render') して新 render が
  // prefetchAggregates を呼ぶまで (≈300ms) 前 aggregate が Cloud Run で走り続ける。
  abortInFlightAggregate('source-switch');
  dlog('reloadFullUI start', { sid: S.CURRENT_SOURCE });
  exitSettingsMode();
  const main = document.querySelector('.main');
  if (main) { main.classList.remove('source-transition'); void main.offsetWidth; main.classList.add('source-transition'); }
  // クリティカル: ユーザーが直後に触る可能性が高い部分
  renderFilters();
  populateFilters();
  renderViewNav();
  initTabStates();
  loadTabState(S.CURRENT_VIEW);
  highlightActiveView();
  renderCustomTabs();
  renderSourceNav();
  emit('renderChips');
  emit('renderThresholds');
  // 非クリティカル: panel / dropdown / 設定ページなど、即時表示しなくても問題ない部分。
  // 次フレームに回すことで、現在の同期ブロックを切り上げてクリック等のイベントを処理させる。
  requestAnimationFrame(() => {
    renderPresets();
    renderTabPresetSelect();
    renderCsvColumns();
  });
  await loadSnapshotIfNeeded();
}

export function renderSourceNav() {
  // ヘッダードロップダウン内のソース一覧を描画
  const list = document.getElementById('source-nav');
  if (list) {
    const canManage = hasPerm('manageSources');
    list.innerHTML = S.DATA_SOURCES.map(ds => {
      const active = S.CURRENT_SOURCE === ds.id ? ' active' : '';
      const count = (S.SOURCE_DATA[ds.id] || []).length;
      const countLabel = count > 0 ? `${count.toLocaleString()}行` : '未取得';
      // ドロップダウンは「切替」のみに徹する。編集・削除は設定画面(source-view)で行う。
      // canManage の人にはドラッグで並び替え可能 (data-drag-key を付与)
      const dragAttrs = canManage ? ` draggable="true" data-drag-key="${ds.id}"` : '';
      return `<div class="source-dropdown-row${active}"${dragAttrs} data-source="${ds.id}">
        <span class="source-nav-item-label">${escapeHtml(ds.name)}</span>
        <span class="source-count">${countLabel}</span>
      </div>`;
    }).join('');
    // 並び替えハンドラ (manageSources 権限保持者のみ)
    if (canManage && !list._sortableAttached) {
      makeSortable(list, async (movedId, targetId, before) => {
        const ids = S.DATA_SOURCES.map(d => d.id);
        const fromIdx = ids.indexOf(movedId);
        const targetIdx = ids.indexOf(targetId);
        if (fromIdx < 0 || targetIdx < 0) return;
        const [moved] = S.DATA_SOURCES.splice(fromIdx, 1);
        // splice 後のインデックスは要計算
        let insertAt = S.DATA_SOURCES.findIndex(d => d.id === targetId);
        if (insertAt < 0) return;
        if (!before) insertAt += 1;
        S.DATA_SOURCES.splice(insertAt, 0, moved);
        renderSourceNav();
        try {
          await api.reorderSources(S.DATA_SOURCES.map(d => d.id));
        } catch (e) {
          console.warn('[sources] reorder failed', e);
        }
      });
      list._sortableAttached = true;
    }
  }
  // ドロップダウンのボタンラベルも更新
  const labelEl = document.getElementById('source-dropdown-label');
  if (labelEl) {
    const current = S.DATA_SOURCES.find(d => d.id === S.CURRENT_SOURCE);
    labelEl.textContent = current ? current.name : 'データソース';
  }
}

// ドロップダウンの開閉
function toggleSourceDropdown(force) {
  const menu = document.getElementById('source-dropdown-menu');
  if (!menu) return;
  const willShow = force !== undefined ? force : menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !willShow);
}
document.getElementById('source-dropdown-btn')?.addEventListener('click', e => {
  e.stopPropagation();
  toggleSourceDropdown();
});
// 外側クリックで閉じる
document.addEventListener('click', e => {
  const menu = document.getElementById('source-dropdown-menu');
  if (!menu || menu.classList.contains('hidden')) return;
  if (!e.target.closest('#source-dropdown')) toggleSourceDropdown(false);
});
// Escキーで閉じる
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') toggleSourceDropdown(false);
});
// 「⚙ 現在のソースの設定」ボタン
document.getElementById('open-source-settings')?.addEventListener('click', async () => {
  toggleSourceDropdown(false);
  if (!(await confirmDiscardUnsavedChanges())) return;
  enterSourceView();
});

// アクセス権はグループ管理側に統合済み

// 現在のソースの名前変更 (source-view 内のボタン)
document.getElementById('source-rename-btn')?.addEventListener('click', async () => {
  const ds = S.DATA_SOURCES.find(d => d.id === S.CURRENT_SOURCE);
  if (!ds) return;
  const newName = await showModal({title: '名前を変更', body: `「${ds.name}」の新しい名前を入力してください`, input: true, defaultValue: ds.name, okText: '次へ'});
  if (!newName || newName === ds.name) return;
  const ok = await showModal({title: '名前変更の確認', body: `「${ds.name}」を「${newName}」に変更しますか？`, okText: '変更'});
  if (!ok) return;
  try {
    await api.updateSource(ds.id, { name: newName });
    ds.name = newName;
    document.getElementById('source-view-title').textContent = newName;
    renderSourceNav();
  } catch (err) {
    showModal({title: '名前変更に失敗', body: err.message || '名前変更に失敗しました', okText: 'OK', cancelText: ''});
  }
});

// 現在のソースの削除
document.getElementById('source-delete-btn')?.addEventListener('click', async () => {
  const ds = S.DATA_SOURCES.find(d => d.id === S.CURRENT_SOURCE);
  if (!ds) return;
  if (S.DATA_SOURCES.length <= 1) {
    await showModal({title: '削除できません', body: 'データソースは最低1つ必要です', okText: 'OK', cancelText: ''});
    return;
  }
  // 未保存 draft は削除対象ソースのものなので、破壊的操作前に確認して discard
  if (!(await confirmDiscardUnsavedChanges())) return;
  const ok = await showModal({
    title: 'データソースを削除',
    body: `「${ds.name}」を削除しますか？\nこのデータソースの全ての設定・プリセット・スナップショットが削除されます。`,
    okText: '削除',
    danger: true,
  });
  if (!ok) return;
  const typed = await showModal({
    title: '本当に削除しますか？',
    body: `「${ds.name}」の削除は取り消せません。確認のため「削除」と入力してください。`,
    input: true,
    placeholder: '削除',
    okText: '削除する',
    danger: true,
    noEnter: true,
  });
  if (typed !== '削除') return;
  try {
    await api.deleteSource(ds.id);
    S.DATA_SOURCES = S.DATA_SOURCES.filter(d => d.id !== ds.id);
    delete S.SOURCE_DATA[ds.id];
    clearSourceRaw(ds.id);
    await switchSource(S.DATA_SOURCES[0].id, { skipGuard: true });
    exitSettingsMode();
    reloadFullUI();
  } catch (err) {
    showModal({title: '削除に失敗', body: err.message || '削除に失敗しました', okText: 'OK', cancelText: ''});
  }
});

document.getElementById('source-nav').addEventListener('click', e => {
  const del = e.target.closest('[data-del-source]');
  if (del) {
    const id = del.dataset.delSource;
    if (S.DATA_SOURCES.length <= 1) {
      showModal({title: '削除できません', body: 'データソースは最低1つ必要です', okText: 'OK', cancelText: ''});
      return;
    }
    const dsName = S.DATA_SOURCES.find(d=>d.id===id)?.name||id;
    (async () => {
      // reloadFullUI で exitSettingsMode されるため、非 current 削除でも先に未保存確認
      if (!(await confirmDiscardUnsavedChanges())) return;
      const ok = await showModal({title: 'データソースを削除', body: `「${dsName}」を削除しますか？\nこのデータソースの全ての設定・プリセットが削除されます。`, okText: '削除', danger: true});
      if (!ok) return;
      const typed = await showModal({title: '本当に削除しますか？', body: `「${dsName}」の削除は取り消せません。確認のため「削除」と入力してください。`, input: true, placeholder: '削除', okText: '削除する', danger: true, noEnter: true});
      if (typed !== '削除') return;
      try {
        await api.deleteSource(id);
        S.DATA_SOURCES = S.DATA_SOURCES.filter(d => d.id !== id);
        delete S.SOURCE_DATA[id];
        clearSourceRaw(id);
        if (S.CURRENT_SOURCE === id) {
          await switchSource(S.DATA_SOURCES[0].id, { skipGuard: true });
        }
        reloadFullUI();
      } catch (err) {
        showModal({title: '削除に失敗', body: err.message || '削除に失敗しました', okText: 'OK', cancelText: ''});
      }
    })();
    return;
  }
  const rename = e.target.closest('[data-rename-source]');
  if (rename) {
    const id = rename.dataset.renameSource;
    const ds = S.DATA_SOURCES.find(d => d.id === id);
    if (!ds) return;
    (async () => {
      const newName = await showModal({title: '名前を変更', body: `「${ds.name}」の新しい名前を入力してください`, input: true, defaultValue: ds.name, okText: '次へ'});
      if (!newName || newName === ds.name) return;
      const ok = await showModal({title: '名前変更の確認', body: `「${ds.name}」を「${newName}」に変更しますか？`, okText: '変更'});
      if (!ok) return;
      try {
        await api.updateSource(id, { name: newName });
        ds.name = newName;
        renderSourceNav();
      } catch (err) {
        showModal({title: '名前変更に失敗', body: err.message || '名前変更に失敗しました', okText: 'OK', cancelText: ''});
      }
    })();
    return;
  }
  const btn = e.target.closest('[data-source]');
  if (btn) {
    // 編集・削除アイコンのクリックは上で処理済み。ここに来るのはラベル本体クリック時のみ。
    const id = btn.dataset.source;
    (async () => {
      if (S.CURRENT_SOURCE !== id) {
        const switched = await switchSource(id);
        if (!switched) return;
        reloadFullUI();
      } else {
        // 同一ソースクリック: 設定画面から離脱するので未保存確認を挟む
        if (!(await confirmDiscardUnsavedChanges())) return;
      }
      // ドロップダウンを閉じてダッシュボードに戻る（設定画面は開かない）
      toggleSourceDropdown(false);
      exitSettingsMode();
    })();
  }
});

// ===== SOURCE VIEW =====
function enterSourceView() {
  closeFloatingMs();
  exitSettingsMode();
  document.body.classList.add('settings-mode');
  document.getElementById('source-view').classList.remove('hidden');
  document.querySelectorAll('#view-nav .nav-item, #custom-nav .nav-item').forEach(b => b.classList.remove('active'));
  renderSourceView();
  renderSourceNav();
  // Load snapshot data (cached daily batch or on-demand refresh)
  loadSnapshotIfNeeded();
}

function formatRelativeTime(iso) {
  if (!iso) return 'まだ更新されていません';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'たった今';
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  const d = Math.floor(hr / 24);
  return `${d}日前`;
}

function renderSnapshotMeta(method, meta) {
  const el = document.getElementById(method === 'sheets' ? 'sheets-snapshot-meta' : 'bq-snapshot-meta');
  if (!el) return;
  if (!meta?.exists) {
    el.textContent = 'まだスナップショットがありません。「今すぐ更新」を押して取得してください。';
    return;
  }
  const when = formatRelativeTime(meta.updatedAt);
  el.textContent = `最終更新: ${when}  (${(meta.rows || 0).toLocaleString()}行)`;
}

// source 切替ごとに増えるバージョン。await から戻った時に「呼び出し時の sid と
// 現在の sid」+「呼び出し時の version と現在の version」を両方比較して、
// 古いレスポンスを無視する。getCurrentLoadVersion はテスト/外部参照用。
let sourceLoadVersion = 0;
export function getCurrentLoadVersion() { return sourceLoadVersion; }

// source 切替単位の AbortController。前 source の補助 API (options/columns) や
// meta fetch を新 source 切替時に一括 cancel する → 古い source 用の重い処理が
// Cloud Run で走り続けるのを防ぐ。aggregate は別レイヤーで cancel される。
let currentSourceController = null;
export function getCurrentSourceSignal() { return currentSourceController?.signal; }

// stale guard: 呼び出し時の (sid, version) が現在と一致するか
function isFresh(sid, version) {
  return S.CURRENT_SOURCE === sid && sourceLoadVersion === version;
}

// 各 multi フィルタの選択肢を populate (バックエンド or S.RAW から)。
async function populateFilterOptionsFor(sid, version, signal) {
  const fields = (S.FILTER_DEFS || []).filter(f => f.type === 'multi').map(f => f.field);
  if (fields.length === 0) {
    if (!isFresh(sid, version)) return;
    S.FILTER_OPTIONS = {};
    return;
  }
  if (FEATURES.useBackendAggregate) {
    try {
      const res = await api.aggregateOptions(sid, fields, { signal });
      if (!isFresh(sid, version)) { dlog('discard stale aggregateOptions', { sid, version }); return; }
      S.FILTER_OPTIONS = res.options || {};
    } catch (e) {
      if (e?.code === 'aborted') { dlog('aggregateOptions aborted', { sid, version }); return; }
      if (!isFresh(sid, version)) return;
      console.warn('aggregateOptions failed; falling back to S.RAW', e?.message || e);
      S.FILTER_OPTIONS = {};
      for (const f of fields) S.FILTER_OPTIONS[f] = getOptions(S.RAW, f);
    }
  } else {
    if (!isFresh(sid, version)) return;
    S.FILTER_OPTIONS = {};
    for (const f of fields) S.FILTER_OPTIONS[f] = getOptions(S.RAW, f);
  }
}

export async function loadSnapshotIfNeeded() {
  const sid = S.CURRENT_SOURCE;
  if (!sid) return;
  const version = ++sourceLoadVersion;
  // 前 source の補助 API を一括 cancel (新規 controller を作る)
  if (currentSourceController) currentSourceController.abort();
  const controller = new AbortController();
  currentSourceController = controller;
  const signal = controller.signal;
  dlog('source switch start', { sid, version });
  await sheets.refreshConnectionState();
  if (!isFresh(sid, version)) { dlog('discard: switched during refreshConnectionState'); return; }
  const ds = S.DATA_SOURCES.find(d => d.id === sid);
  const method = ds?.method || '';

  try {
    const meta = await api.getSnapshotMeta(sid);
    if (!isFresh(sid, version)) { dlog('discard: switched during getSnapshotMeta'); return; }
    renderSnapshotMeta(method, meta);
    // aggregate cacheKey 用に updatedAt を保存 → snapshot 更新時に自動 invalidate
    if (meta?.updatedAt) {
      if (!S.SOURCE_SNAPSHOT_UPDATED_AT) S.SOURCE_SNAPSHOT_UPDATED_AT = {};
      S.SOURCE_SNAPSHOT_UPDATED_AT[sid] = meta.updatedAt;
    }
    if (!meta.exists) return;
    document.querySelector('.meta')?.classList.add('meta-loading');

    if (FEATURES.useBackendAggregate) {
      // バックエンド集計モード: snapshot 全行はダウンロードしない。
      // UI は即時切替。集計とフィルタ選択肢の取得は非同期で並行進行する。
      // - aggregateColumns は設定画面を開いたときに lazy load (通常切替では呼ばない)
      // - aggregateOptions は初回 render をブロックせず、到着次第フィルタ UI を再描画
      // 重要: populateFilters はここで呼ばない (caller reloadFullUI で既に走り、
      //       その後 loadTabState が値を復元している。ここで再呼びすると消える)。
      S.RAW = [];
      S.SOURCE_DATA[sid] = [];
      S.FILTER_OPTIONS = {};
      S.COLUMN_INFO = null;
      renderSourceView();
      renderSourceNav();
      renderCsvColumns();
      emit('render');  // batch aggregate を即座にキック (フィルタオプション待ちしない)
      // バックグラウンドでフィルタ選択肢をロード。aggregate を優先したいので
      // 80ms 程度遅らせて Cloud Run の同時負荷を下げる (タブ移動や連打時に
      // aggregate と options/columns の snapshot scan が重なるのを防ぐ)。
      setTimeout(() => {
        if (!isFresh(sid, version)) return;
        populateFilterOptionsFor(sid, version, signal).then(() => {
          if (!isFresh(sid, version)) return;
          for (const f of (S.FILTER_DEFS || [])) {
            if (f.type === 'multi') renderMSDynamic(f);
          }
          dlog('source switch options loaded', { sid, version });
        });
      }, 80);
      return;
    }

    const currentRows = S.SOURCE_DATA[sid] || [];
    if (currentRows.length > 0) return; // already loaded
    const rowCountEl = document.getElementById('row-count');
    if (rowCountEl) rowCountEl.textContent = '読み込み中...';
    const data = await api.getSnapshot(sid);
    if (!isFresh(sid, version)) { dlog('discard: switched during getSnapshot'); return; }
    S.SOURCE_DATA[sid] = data.rows || [];
    S.RAW = S.SOURCE_DATA[sid];
    await populateFilterOptionsFor(sid, version, signal);
    if (!isFresh(sid, version)) return;
    // populateFilters はここで呼ばない (caller で済んでいる、値を消さない)。
    // multi-select の選択肢 UI だけ更新する。
    for (const f of (S.FILTER_DEFS || [])) {
      if (f.type === 'multi') renderMSDynamic(f);
    }
    renderSourceView();
    renderSourceNav();
    renderCsvColumns();
    emit('render');
  } catch (e) {
    console.warn('Snapshot load failed:', e.message);
  } finally {
    document.querySelector('.meta')?.classList.remove('meta-loading');
    dlog('source switch end', { sid, version });
  }
}

// このデータソースのメソッド + 入力をクリアする。
// Google OAuth（ユーザー単位）には影響しない。
async function disconnectCurrentSource() {
  const sid = S.CURRENT_SOURCE;
  if (!sid) return;
  try {
    await api.disconnectSource(sid);
    const ds = S.DATA_SOURCES.find(d => d.id === sid);
    if (ds) {
      ds.method = '';
      delete ds.sheetsInput;
      delete ds.bqInput;
    }
    S.SOURCE_METHOD = '';
    S.SHEETS_INPUT = { url: '', tab: '' };
    S.BQ_INPUT = { project: '', query: '' };
    document.querySelectorAll('.source-method-card').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.method-detail-panel').forEach(p => p.classList.add('hidden'));
    renderSourceView();
    renderSourceNav();
  } catch (e) {
    await showModal({title: '解除失敗', body: e.message || '連携解除に失敗しました', okText: 'OK', cancelText: ''});
  }
}

async function refreshSnapshotNow(method) {
  const sid = S.CURRENT_SOURCE;
  if (!sid) return;
  const fetchBtn = document.getElementById(method === 'sheets' ? 'sheets-fetch-btn' : 'bq-fetch-btn');
  const metaEl = document.getElementById(method === 'sheets' ? 'sheets-snapshot-meta' : 'bq-snapshot-meta');
  const origLabel = fetchBtn ? fetchBtn.textContent : '';
  if (fetchBtn) { fetchBtn.textContent = '更新中...'; fetchBtn.disabled = true; }
  if (metaEl) { metaEl.textContent = 'データを取得しています（大量データの場合は数分かかります）...'; metaEl.classList.add('updating'); }
  try {
    await api.refreshSnapshot(sid);
    S.SOURCE_DATA[sid] = []; // invalidate cache
    invalidateAggregateCache();  // snapshot 更新 → 集計キャッシュも破棄
    await loadSnapshotIfNeeded();
    if (metaEl) metaEl.classList.add('update-success');
    await showModal({title: '更新完了', body: 'スナップショットを更新しました。', okText: 'OK', cancelText: ''});
  } catch (e) {
    const msg = e.message || '更新に失敗しました';
    if (/再度連携|not connected/i.test(msg)) {
      await sheets.refreshConnectionState();
      renderSourceView();
      await showModal({title: 'Google連携の期限切れ', body: 'Google連携の有効期限が切れました。「Googleアカウント連携」ボタンから再度連携してください。', okText: 'OK', cancelText: ''});
    } else {
      await showModal({title: '更新失敗', body: msg, okText: 'OK', cancelText: ''});
    }
  } finally {
    if (fetchBtn) { fetchBtn.textContent = origLabel; fetchBtn.disabled = false; }
    if (metaEl) { metaEl.classList.remove('updating'); setTimeout(() => metaEl.classList.remove('update-success'), 2000); }
  }
}

// backend mode で source-view を開いた時、行データを持たないので列情報を遅延取得。
// 1 ソースにつき 1 回だけ走らせる (S.COLUMN_INFO がセットされたら以降スキップ)。
let _sourceViewColInfoInflight = null;
async function fetchColumnInfoForSourceView() {
  if (S.COLUMN_INFO || _sourceViewColInfoInflight || !S.CURRENT_SOURCE) return;
  const sid = S.CURRENT_SOURCE;
  _sourceViewColInfoInflight = api.aggregateColumns(sid, { signal: getCurrentSourceSignal() })
    .then(ci => {
      if (S.CURRENT_SOURCE !== sid) return; // ソース切替済み
      S.COLUMN_INFO = ci;
      renderSourceView();
    })
    .catch(e => {
      if (e?.code !== 'aborted') console.warn('[source-view] column info fetch failed', e?.message || e);
    })
    .finally(() => { _sourceViewColInfoInflight = null; });
}

function renderSourceView() {
  // 入力欄が保存済み値で再描画される (loadSheetsInput/loadBqInput 経由) ので dirty をクリア
  document.getElementById('sheets-fetch-btn')?.classList.remove('dirty');
  document.getElementById('bq-fetch-btn')?.classList.remove('dirty');
  const ds = S.DATA_SOURCES.find(d => d.id === S.CURRENT_SOURCE);
  const name = ds ? ds.name : S.CURRENT_SOURCE;
  document.getElementById('source-view-title').textContent = name;

  // メソッドカードのアクティブ表示と詳細パネルを現在の source.method に合わせる
  const currentMethod = ds?.method || '';
  document.querySelectorAll('.source-method-card').forEach(c => {
    c.classList.toggle('active', !!currentMethod && c.dataset.method === currentMethod);
    // 未連携ソースでは全カードをクリック可、連携済みでは同じメソッドカード以外を薄く表示
    if (currentMethod && c.dataset.method !== currentMethod) {
      c.classList.add('locked');
    } else {
      c.classList.remove('locked');
    }
  });
  document.querySelectorAll('.method-detail-panel').forEach(p => p.classList.add('hidden'));
  if (currentMethod) {
    document.getElementById('detail-' + currentMethod)?.classList.remove('hidden');
  }

  // アクセス権はグループ管理側に統合済み

  const rows = S.SOURCE_DATA[S.CURRENT_SOURCE] || [];
  // backend mode で行データを持たない場合は COLUMN_INFO (= 列名・サンプル値・行数) を使う
  const colInfo = S.COLUMN_INFO;
  const hasRows = rows.length > 0;
  const hasColInfo = !hasRows && colInfo?.columns?.length;
  const info = document.getElementById('source-info');
  if (hasRows) {
    const cols = Object.keys(rows[0]);
    info.innerHTML = `<div class="source-info-grid">
      <div class="source-info-card"><div class="source-info-label">行数</div><div class="source-info-value">${rows.length.toLocaleString()}</div></div>
      <div class="source-info-card"><div class="source-info-label">カラム数</div><div class="source-info-value">${cols.length}</div></div>
    </div>`;
  } else if (hasColInfo) {
    info.innerHTML = `<div class="source-info-grid">
      <div class="source-info-card"><div class="source-info-label">行数</div><div class="source-info-value">${(colInfo.accessibleRows || 0).toLocaleString()}</div></div>
      <div class="source-info-card"><div class="source-info-label">カラム数</div><div class="source-info-value">${colInfo.columns.length}</div></div>
    </div>`;
  } else {
    info.innerHTML = '<div class="source-info-empty"><div class="source-info-icon">\u{1F4C1}</div><div class="source-info-text">データが読み込まれていません</div><div class="source-info-hint">上の「CSVアップロード」または「Googleスプレッドシート」からデータを取得してください</div></div>';
    // backend mode で source 選択済みなら lazy fetch を試みる
    if (FEATURES.useBackendAggregate && S.CURRENT_SOURCE) fetchColumnInfoForSourceView();
  }

  // CSV columns + preview: backend mode で行データが無い時は COLUMN_INFO のサンプル値から再構築
  const colEl = document.getElementById('source-csv-columns');
  const countEl = document.getElementById('source-csv-column-count');
  const previewEl = document.getElementById('source-preview');

  let columns;          // [{ name, samples, isNumeric }]
  let previewRows;      // 配列
  if (hasRows) {
    columns = Object.keys(rows[0]).map(col => {
      const vals = [];
      const seen = new Set();
      for (const r of rows) {
        const v = r[col];
        if (v == null || v === '' || seen.has(v)) continue;
        seen.add(v); vals.push(v);
        if (vals.length >= 5) break;
      }
      const isNumeric = vals.slice(0, 10).every(v => !isNaN(Number(v)) && v !== '');
      return { name: col, samples: vals, isNumeric };
    });
    previewRows = rows.slice(0, 20);
  } else if (hasColInfo) {
    columns = colInfo.columns;
    // サンプル値配列から「擬似 row」を行ごとに再構築 (各列の i 番目を集めて 1 行に)
    const maxRows = Math.max(0, ...columns.map(c => (c.samples || []).length));
    previewRows = [];
    for (let i = 0; i < maxRows; i++) {
      const row = {};
      for (const c of columns) row[c.name] = (c.samples || [])[i] ?? '';
      previewRows.push(row);
    }
  }

  if (columns?.length) {
    if (countEl) countEl.textContent = `${columns.length}カラム`;
    colEl.innerHTML = columns.map(col => {
      const kind = col.isNumeric ? '数値' : '文字列';
      const sampleHtml = (col.samples || []).length
        ? (col.samples || []).map(v => `<span>${escapeHtml(String(v).slice(0, 30))}</span>`).join(' / ')
        : '';
      return `<div class="csv-col-row">
        <div class="csv-col-head">
          <code class="csv-col-name">${escapeHtml(col.name)}</code>
          <span class="csv-col-kind">${kind}</span>
        </div>
        <div class="csv-col-sample">例: ${sampleHtml}</div>
      </div>`;
    }).join('');
    if (previewRows?.length) {
      const colNames = columns.map(c => c.name);
      previewEl.innerHTML = `<div class="source-preview-wrap"><table class="source-preview-table">
        <thead><tr>${colNames.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
        <tbody>${previewRows.map(r => `<tr>${colNames.map(c => `<td>${escapeHtml(String(r[c] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`;
    } else {
      previewEl.innerHTML = '<div class="preset-empty">プレビュー行がありません</div>';
    }
  } else {
    colEl.innerHTML = '<div class="preset-empty">データが読み込まれていません</div>';
    if (countEl) countEl.textContent = '';
    previewEl.innerHTML = '<div class="preset-empty">データなし</div>';
  }

  // Sheets UI state
  const sheetsConnect = document.getElementById('sheets-connect');
  const sheetsForm = document.getElementById('sheets-form');
  if (sheets.isAuthenticated()) {
    sheetsConnect.classList.add('hidden');
    sheetsForm.classList.remove('hidden');
    document.getElementById('sheets-status').innerHTML = '<span class="api-status-ok" style="font-size:11px">✓ Googleアカウント連携済み</span>';
    const savedInput = loadSheetsInput();
    document.getElementById('sheets-url-input').value = savedInput.url || '';
    document.getElementById('sheets-tab-input').value = savedInput.tab || '';
  } else {
    sheetsConnect.classList.remove('hidden');
    sheetsForm.classList.add('hidden');
  }

  // BQ UI state
  const bqConnect = document.getElementById('bq-connect');
  const bqForm = document.getElementById('bq-form');
  if (bq.isAuthenticated()) {
    bqConnect.classList.add('hidden');
    bqForm.classList.remove('hidden');
    document.getElementById('bq-status').innerHTML = '<span class="api-status-ok" style="font-size:11px">✓ Googleアカウント連携済み</span>';
    const savedBq = loadBqInput();
    document.getElementById('bq-project-input').value = savedBq.project || '';
    document.getElementById('bq-query-input').value = savedBq.query || '';
  } else {
    bqConnect.classList.remove('hidden');
    bqForm.classList.add('hidden');
  }
}

// Sheets / BQ の入力欄は自動保存しない。「今すぐ更新」ボタン押下時のみ saveSheetsInput /
// saveBqInput が動く (line 759, 793 参照)。
//
// 未保存編集は fetch-btn の .dirty クラスで検知 → 未保存変更ガード対象
// (settings/index.js の DIRTY_SELECTORS に含める)。
// タブ切替 / ソース切替 / 設定画面遷移 / logout / リロードで警告を出す。
function _markSheetsDirty() { document.getElementById('sheets-fetch-btn')?.classList.add('dirty'); }
function _clearSheetsDirty() { document.getElementById('sheets-fetch-btn')?.classList.remove('dirty'); }
function _markBqDirty() { document.getElementById('bq-fetch-btn')?.classList.add('dirty'); }
function _clearBqDirty() { document.getElementById('bq-fetch-btn')?.classList.remove('dirty'); }
['sheets-url-input', 'sheets-tab-input'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', _markSheetsDirty);
});
['bq-project-input', 'bq-query-input'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', _markBqDirty);
});
// 「保存せずに移動」で discardAllDrafts が発火した時、入力欄を保存済み値に戻す
on('sourceViewResetInputs', () => {
  const sheetsInput = loadSheetsInput() || {};
  const bqInput = loadBqInput() || {};
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  setVal('sheets-url-input', sheetsInput.url);
  setVal('sheets-tab-input', sheetsInput.tab);
  setVal('bq-project-input', bqInput.project);
  setVal('bq-query-input', bqInput.query);
});

// Confirm overwrite when data already loaded from another method
async function confirmOverwriteData(newMethod) {
  const existing = S.SOURCE_DATA[S.CURRENT_SOURCE] || [];
  if (existing.length === 0) return true;
  const methodLabel = { csv: 'CSV', sheets: 'Googleスプレッドシート', bq: 'BigQuery' }[newMethod] || newMethod;
  const ok1 = await showModal({
    title: 'データを上書きしますか？',
    body: `現在のデータソースには既に${existing.length.toLocaleString()}行のデータが入っています。${methodLabel}で上書きしますか？`,
    okText: '次へ', danger: true,
  });
  if (!ok1) return false;
  const ok2 = await showModal({
    title: '最終確認',
    body: `現在のデータは失われます。${methodLabel}で上書きしますか？`,
    okText: '上書き', danger: true,
  });
  return !!ok2;
}

// Source file upload
document.getElementById('source-file').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  if (!(await confirmOverwriteData('csv'))) { e.target.value = ''; return; }
  const text = await f.text();
  const rows = parseCSV(text);
  S.SOURCE_DATA[S.CURRENT_SOURCE] = rows;
  S.RAW = rows;
  saveSourceMethod('csv');
  populateFilters();
  renderSourceView();
  renderSourceNav();
  renderCsvColumns();
});

// ----- METHOD CARD SELECTION -----
// 排他制御: 既に連携済みのソースで別メソッドに切り替えたい場合は、
// 先に「連携を解除」する必要がある。
document.querySelectorAll('.source-method-card').forEach(card => {
  card.addEventListener('click', async e => {
    if (card.classList.contains('disabled')) return;
    if (e.target.closest('input,button,label.file-btn')) return;

    const targetMethod = card.dataset.method;
    const ds = S.DATA_SOURCES.find(d => d.id === S.CURRENT_SOURCE);
    const currentMethod = ds?.method || '';

    // 既に別メソッドに連携済みなら切替をブロック
    if (currentMethod && currentMethod !== targetMethod) {
      const labels = { csv: 'CSVアップロード', sheets: 'Google スプレッドシート', bq: 'BigQuery' };
      await showModal({
        title: '連携を変更できません',
        body: `このデータソースは既に「${labels[currentMethod] || currentMethod}」に連携されています。別の方法に切り替えるには、まず現在の連携を解除してください。`,
        okText: 'OK',
        cancelText: '',
      });
      return;
    }

    document.querySelectorAll('.source-method-card').forEach(c => c.classList.toggle('active', c === card));
    document.querySelectorAll('.method-detail-panel').forEach(p => p.classList.add('hidden'));
    const panel = document.getElementById('detail-' + targetMethod);
    if (panel) panel.classList.remove('hidden');
  });
});

// ----- SHEETS: AUTH -----
document.getElementById('sheets-auth-btn').addEventListener('click', async () => {
  try {
    await sheets.authenticate();
    renderSourceView();
    await showModal({title: '連携完了', body: 'Googleアカウントの連携が完了しました。', okText: 'OK', cancelText: ''});
  } catch (e) {
    await showModal({title: '認証エラー', body: e.message, okText: 'OK', cancelText: ''});
  }
});

// ----- SHEETS: 今すぐ更新 (save config + refresh snapshot) -----
document.getElementById('sheets-fetch-btn').addEventListener('click', async () => {
  const urlOrId = document.getElementById('sheets-url-input').value.trim();
  const fileId = sheets.extractSpreadsheetId(urlOrId);
  const tab = document.getElementById('sheets-tab-input').value.trim();
  if (!fileId) { await showModal({title: 'エラー', body: 'スプレッドシートのURLまたはIDが正しくありません', okText: 'OK', cancelText: ''}); return; }
  if (!tab) { await showModal({title: 'エラー', body: 'タブ名を入力してください', okText: 'OK', cancelText: ''}); return; }
  // Persist inputs on the source doc so the batch job can read them
  await saveSheetsInput(urlOrId, tab);
  await saveSourceMethod('sheets');
  _clearSheetsDirty();
  await refreshSnapshotNow('sheets');
});

// ----- SHEETS: このソースの連携を解除 (method + inputs クリア) -----
document.getElementById('sheets-disconnect').addEventListener('click', async () => {
  const ok = await showModal({
    title: 'このデータソースの連携を解除',
    body: 'このデータソースのスプレッドシート連携を解除します。スナップショットは残りますが、以後「今すぐ更新」はできなくなります。別の方法（CSV / BigQuery）に切り替えたい場合はこの操作を実行してください。',
    okText: '解除',
    danger: true,
  });
  if (!ok) return;
  await disconnectCurrentSource();
});

// ----- BQ: AUTH -----
document.getElementById('bq-auth-btn').addEventListener('click', async () => {
  try {
    await bq.authenticate();
    renderSourceView();
    await showModal({title: '連携完了', body: 'Googleアカウントの連携が完了しました。', okText: 'OK', cancelText: ''});
  } catch (e) {
    await showModal({title: '認証エラー', body: e.message, okText: 'OK', cancelText: ''});
  }
});

// ----- BQ: 今すぐ更新 (save config + refresh snapshot) -----
document.getElementById('bq-fetch-btn').addEventListener('click', async () => {
  const project = document.getElementById('bq-project-input').value.trim();
  const query = document.getElementById('bq-query-input').value.trim();
  if (!project) { await showModal({title: 'エラー', body: 'プロジェクトIDを入力してください', okText: 'OK', cancelText: ''}); return; }
  if (!query) { await showModal({title: 'エラー', body: 'SQLクエリを入力してください', okText: 'OK', cancelText: ''}); return; }
  await saveBqInput(project, query);
  await saveSourceMethod('bq');
  _clearBqDirty();
  await refreshSnapshotNow('bq');
});

// ----- BQ: このソースの連携を解除 (method + inputs クリア) -----
document.getElementById('bq-disconnect').addEventListener('click', async () => {
  const ok = await showModal({
    title: 'このデータソースの連携を解除',
    body: 'このデータソースのBigQuery連携を解除します。スナップショットは残りますが、以後「今すぐ更新」はできなくなります。別の方法（CSV / スプレッドシート）に切り替えたい場合はこの操作を実行してください。',
    okText: '解除',
    danger: true,
  });
  if (!ok) return;
  await disconnectCurrentSource();
});

document.getElementById('add-source').addEventListener('click', async () => {
  const name = await showModal({title: 'データソースを追加', body: 'データソースの名前を入力してください', input: true, placeholder: '例: CRMデータ', okText: '次へ'});
  if (!name) return;
  // コピー元選択
  const copyOpts = S.DATA_SOURCES.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
  const copyHtml = `<p>設定をコピーするデータソースを選択してください。</p>
    <select id="copy-source-select" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:inherit;margin-top:8px;">
      <option value="">白紙で作成（設定なし）</option>
      ${copyOpts}
    </select>`;
  const copyConfirm = await showModal({title: `「${name}」を作成`, html: true, body: copyHtml, okText: '作成'});
  if (!copyConfirm) return;
  const copyFromId = document.getElementById('copy-source-select')?.value || '';
  try {
    // 初期 config 作成 + プリセットコピーは backend 側で完結する。
    // operator は settings 系権限を持たないので、フロント側で putConfig すると
    // Missing permission: editMetrics 等で弾かれてしまうため。
    const created = await api.createSource({ name, copyFromId: copyFromId || undefined });
    S.DATA_SOURCES.push(created);
    S.SOURCE_DATA[created.id] = [];
    const switched = await switchSource(created.id);
    if (!switched) return;
    reloadFullUI();
  } catch (e) {
    await showModal({title: '作成に失敗', body: e.message || 'データソースの作成に失敗しました', okText: 'OK', cancelText: ''});
  }
});
