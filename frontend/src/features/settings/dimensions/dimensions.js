import { S, saveDimensions } from '../../../app/state.js';
import { flushConfigNow, clearPendingConfigKeys } from '../../../app/persistence.js';
import { escapeHtml } from '../../../shared/utils/utils.js';
import { showModal } from '../../../shared/ui/modal.js';
import { hasPerm } from '../../../app/auth.js';
import { emit } from '../../../app/events.js';
import { makeSortable } from '../../../shared/ui/sortable.js';
import { buildSaveErrorMessage, setSaveButtonState } from '../saveFlow.js';

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
    {v: 'week',       l: '週 (YYYY-MM-DD〜YYYY-MM-DD)'},
    {v: 'week_md',    l: '週 (MM-DD〜MM-DD)'},
    {v: 'month',      l: '月 (YYYY-MM)'},
    {v: 'year',       l: '年 (YYYY)'},
    {v: 'dow',        l: '曜日'},
    {v: 'expression', l: '計算式'},
    {v: 'image',      l: '画像 (URL カラム)'},
    {v: 'link',       l: 'リンク (URL カラム)'},
  ];
  // 週ディメンション用: 週の開始曜日 (0=日, 1=月, ..., 6=土)
  const weekStartOpts = [
    {v: 1, l: '月曜始まり'},
    {v: 0, l: '日曜始まり'},
    {v: 2, l: '火曜始まり'},
    {v: 3, l: '水曜始まり'},
    {v: 4, l: '木曜始まり'},
    {v: 5, l: '金曜始まり'},
    {v: 6, l: '土曜始まり'},
  ];
  el.innerHTML = `
    <div class="metrics-doc-box">
      ${defs.map((d, i) => {
        const isExpr = d.type === 'expression';
        const isImage = d.type === 'image';
        const isWeek = d.type === 'week' || d.type === 'week_md';
        const ws = (d.weekStart != null) ? Number(d.weekStart) : 1;
        return `
        <div class="metrics-doc-row dim-row" data-dim-idx="${i}" data-drag-key="${i}" draggable="true">
          <div class="dim-row-head">
            <span class="drag-handle" data-drag-handle title="ドラッグで並び替え">⋮⋮</span>
            <div class="field-col"><label class="field-label">名称</label><textarea class="metric-label-input" data-dim-label draggable="false" rows="${Math.max(1, Math.min(5, String(d.label || '').split('\n').length))}" placeholder="表示名 (Enter で改行・最大5行)"></textarea></div>
            <button type="button" class="metric-del" data-dim-remove="${i}" title="削除">×</button>
          </div>
          <div class="dim-row-grid">
            <div class="dim-field">
              <label>種類</label>
              <select class="dim-type-select" data-dim-type draggable="false">
                ${typeOpts.map(o => `<option value="${o.v}"${d.type===o.v?' selected':''}>${o.l}</option>`).join('')}
              </select>
            </div>
            <div class="dim-field dim-field-source">
              <label>${isExpr ? '計算式' : 'データカラム'}</label>
              ${isExpr
                ? `<input type="text" class="metric-formula-input" data-dim-expr draggable="false" value="${escapeHtml(d.expression || '')}" placeholder="例: r.operator + ' / ' + r.media">`
                : `<input type="text" class="metric-key-input wide" data-dim-field draggable="false" value="${escapeHtml(d.field || '')}" placeholder="データカラム名">`}
            </div>
            ${isImage ? `
            <div class="dim-field">
              <label>画像の高さ (px)</label>
              <input type="number" class="metric-key-input" data-dim-image-height draggable="false" min="8" max="400" value="${d.imageHeight != null ? d.imageHeight : ''}" placeholder="40">
            </div>
            <div class="dim-field">
              <label>画像の幅 (px)</label>
              <input type="number" class="metric-key-input" data-dim-image-width draggable="false" min="8" max="600" value="${d.imageWidth != null ? d.imageWidth : ''}" placeholder="120">
            </div>` : ''}
            ${isWeek ? `
            <div class="dim-field">
              <label>週の開始曜日</label>
              <select class="dim-type-select" data-dim-week-start draggable="false">
                ${weekStartOpts.map(o => `<option value="${o.v}"${ws===o.v?' selected':''}>${o.l}</option>`).join('')}
              </select>
            </div>` : ''}
          </div>
        </div>`;
      }).join('') || '<div class="preset-empty">ディメンションがありません</div>'}
      <button type="button" class="metrics-add-btn" id="dims-add-btn">+ ディメンションを追加</button>
    </div>
  `;
  // textarea の値は innerHTML 経由だと HTML5 仕様で先頭の \n 1 個が strip される。
  // ここで明示的に DOM の value を代入することで、先頭改行 / 連続改行 / 末尾改行を全て保持する。
  el.querySelectorAll('.dim-row[data-dim-idx]').forEach(row => {
    const idx = +row.dataset.dimIdx;
    const def = defs[idx];
    const ta = row.querySelector('[data-dim-label]');
    if (ta && def) ta.value = def.label || '';
  });
}

// 名称 textarea の rows を内容の改行数に合わせる。入力中 (input イベント) から呼ばれる。
// 初期描画は HTML テンプレ側で rows 属性を計算してあるので、ここでは扱わない。
function autosizeLabel(el) {
  const lines = (el.value || '').split('\n').length;
  el.rows = Math.max(1, Math.min(5, lines));
}

export function setupDimensionsEvents() {
  // ----- DIMS DRAG-REORDER -----
  // dims-doc は持続する親要素。中身は renderDimsDoc で innerHTML 置換されるが、
  // makeSortable は親に delegate でリスナを張るので 1 度だけ呼べばよい。
  // data-drag-key には配列インデックスを使う (key 入力欄が無いので index で安定)。
  makeSortable(document.getElementById('dims-doc'), (fromStr, toStr, before) => {
    if (!hasPerm('editDimensions')) return;
    const from = +fromStr, to = +toStr;
    const defs = S.DIMENSIONS_DRAFT;
    if (!defs || from === to || isNaN(from) || isNaN(to)) return;
    if (from < 0 || from >= defs.length || to < 0 || to >= defs.length) return;
    const item = defs[from];
    defs.splice(from, 1);
    const toAdjusted = (from < to) ? to - 1 : to;
    const insertAt = before ? toAdjusted : toAdjusted + 1;
    defs.splice(insertAt, 0, item);
    markDimsDirty();
    renderDimsDoc();
  });

  // ----- DIMS HELP -----
  document.getElementById('dims-help-btn').addEventListener('click', async () => {
    const html = `
      <div class="ref-desc"><strong>ディメンション計算式は JavaScript式ベース</strong>です。行オブジェクト <code>r</code> を参照して任意のJS式を書けます。</div>
      <div class="ref-section-title">種類の意味</div>
      <div class="ref-syntax">
        <code>そのまま値</code> — データカラムの値をそのまま使う<br>
        <code>日付</code> — 日付として扱う（YYYY-MM-DD)<br>
        <code>週</code> — 日付を週単位にまとめる。表示は <code>YYYY-MM-DD〜YYYY-MM-DD</code>。週の開始曜日 (日〜土) は各ディメンションで個別に指定可能<br>
        <code>週 (MM-DD〜MM-DD)</code> — 上記の年を省いた表示。※年をまたぐと同じ月日の週が合算されるため、単一年内での利用を想定<br>
        <code>月 (YYYY-MM)</code> — 日付の先頭7文字を抽出<br>
        <code>年 (YYYY)</code> — 日付の先頭4文字を抽出<br>
        <code>曜日</code> — 日付から曜日(日/月/火/...)に変換<br>
        <code>計算式</code> — 任意のJS式で行から値を算出<br>
        <code>画像 (URL カラム)</code> — データカラムの値を画像 URL とみなし、ピボット列にサムネを表示。クリックで URL を新規タブで開く。サイズは「画像の高さ・幅 (px)」で指定可能 (未指定なら 40×120px)<br>
        <code>リンク (URL カラム)</code> — データカラムの値を URL として表示。クリックで新規タブで開く
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
    if (e.target.matches('[data-dim-label]')) {
      // 5 行上限: 超えたら切り詰めてカーソルを末尾に
      const lines = e.target.value.split('\n');
      if (lines.length > 5) e.target.value = lines.slice(0, 5).join('\n');
      def.label = e.target.value;
      autosizeLabel(e.target);
    }
    else if (e.target.matches('[data-dim-field]')) def.field = e.target.value;
    else if (e.target.matches('[data-dim-expr]')) def.expression = e.target.value;
    else if (e.target.matches('[data-dim-image-height]')) {
      const v = e.target.value;
      def.imageHeight = v === '' ? null : Math.max(8, Math.min(400, Number(v) || 40));
    } else if (e.target.matches('[data-dim-image-width]')) {
      const v = e.target.value;
      def.imageWidth = v === '' ? null : Math.max(8, Math.min(600, Number(v) || 120));
    }
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
      if (def.type === 'week' || def.type === 'week_md') {
        if (def.weekStart == null) def.weekStart = 1;
      } else {
        // type が week 系以外に変わったら weekStart は不要 — 残すと再度 week にした時に古い値が再利用される。
        delete def.weekStart;
      }
      markDimsDirty();
      renderDimsDoc();
    } else if (e.target.matches('[data-dim-week-start]')) {
      const n = Number(e.target.value);
      def.weekStart = (n >= 0 && n <= 6) ? n : 1;
      markDimsDirty();
      emit('renderChips');
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
    // ----- Frontend 事前チェック (backend と重複しない構造的なものだけ) -----
    // 式の構文/allowlist チェックは backend に委譲。ここではキー重複や必須欄の空チェックだけ。
    const keys = defs.map(d => d.key);
    if (keys.some(k => !k)) { await showModal({title: '保存できません', body: '空のキーがあります', okText: 'OK', cancelText: ''}); return; }
    if (new Set(keys).size !== keys.length) { await showModal({title: '保存できません', body: 'キーが重複しています', okText: 'OK', cancelText: ''}); return; }
    for (const d of defs) {
      if (d.type === 'expression') {
        if (!d.expression) { await showModal({title: '保存できません', body: `「${d.label || d.key}」の計算式が空です`, okText: 'OK', cancelText: ''}); return; }
      } else {
        if (!d.field) { await showModal({title: '保存できません', body: `「${d.label || d.key}」のデータカラム名が空です`, okText: 'OK', cancelText: ''}); return; }
      }
    }
    const ok = await showModal({title: 'ディメンション定義を保存', body: '変更内容を保存しますか？', okText: '保存'});
    if (!ok) return;
    // モーダル待ち中に権限が剥がれた可能性に備えて再チェック
    if (!hasPerm('editDimensions')) return;

    // ----- Save flow with rollback -----
    // 失敗時に draft / dirty を保持したまま state を巻き戻す。
    const saveBtn = document.getElementById('dims-save-btn');
    const rootEl = document.getElementById('dims-doc-view');
    setSaveButtonState(saveBtn, true, rootEl);
    const prevDimensions = S.DIMENSIONS;
    const prevSelectedDims = [...S.SELECTED_DIMS];
    try {
      S.DIMENSIONS = JSON.parse(JSON.stringify(defs));
      S.DIM_EXPR_CACHE.clear();
      saveDimensions();
      const validKeys = new Set(S.DIMENSIONS.map(d => d.key));
      S.SELECTED_DIMS = S.SELECTED_DIMS.filter(k => validKeys.has(k));
      emit('renderChips');
      try {
        await flushConfigNow();
      } catch (e) {
        // Rollback local state
        S.DIMENSIONS = prevDimensions;
        S.DIM_EXPR_CACHE.clear();
        S.SELECTED_DIMS = prevSelectedDims;
        // 失敗した dimensions patch を pending から落として無限リトライを防ぐ
        // (draft は UI に残っているので、修正して再保存すれば新 patch で上書きされる)
        clearPendingConfigKeys(['dimensions']);
        emit('renderChips');
        await showModal({title: '保存に失敗しました', body: buildSaveErrorMessage(e), okText: 'OK', cancelText: ''});
        return;
      }
      // 成功: dirty + draft を確定。draft は保持したまま S.DIMENSIONS と同期させておく。
      S.DIMENSIONS_DRAFT = JSON.parse(JSON.stringify(S.DIMENSIONS));
      clearDimsDirty();
      emit('render');
      await showModal({title: '保存完了', body: 'ディメンション定義を保存しました', okText: 'OK', cancelText: ''});
    } finally {
      setSaveButtonState(saveBtn, false, rootEl);
    }
  });
}
