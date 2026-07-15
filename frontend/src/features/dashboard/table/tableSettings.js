// ピボットテーブルの「設定」サイドパネル。
// 状態は S.TABLE_CONFIG に保持 (タブごと、TAB_STATES に永続化)。
//
// データモデル:
//   { showTotal: bool,
//     transpose: bool,   // ON でメトリクス=行 / ディメンション値=列 に転置 (table.js の buildTransposed)
//     subtotalDepths: { [depth]: bool }, // 階層ごとの小計「計」表示 (通常=最終行 / 転置=最終列)。未設定=表示
//                                        // 旧 showSubtotal (単一 bool) は subtotalAt() が後方互換で解釈
//     table: {
//       headerBg, headerColor,                                  // ヘッダー (列ラベル)
//       totalBg, totalColor,                                    // 総計 色
//       totalBold, totalItalic, totalUnderline, totalFontSize,  // 総計 装飾
//       totalPriority,                                          // 総計を項目ごとより優先
//       depthBg0..depthBg19, leafBg,                            // 階層別 背景 (最大 20 ディメンション)
//       depthPriority,                                          // 階層別を項目ごとより優先
//       hoverBg                                                 // 行 hover 背景 (転置時も行単位)
//     },
//     styles:       { [colKey]: { color, bgColor, bold, italic, underline, fontSize, align } },  // 項目ごと (データ)
//     headerStyles: { [colKey]: { color, bgColor, bold, italic, underline, fontSize, align } } } // 項目ごと (ヘッダー)
//   colKey は metric key または 'dim:<dimKey>'。「項目」= メトリクス / ディメンション。
//   通常表示ではこれが列に対応し、転置表示ではメトリクスが行になる (軸に依存しない単位)。
import { S } from '../../../app/state.js';
import { escapeHtml } from '../../../shared/utils/utils.js';
import { emit, on } from '../../../app/events.js';
import { dimLabel } from '../../../aggregate/dimensions.js';
import { isAnyColorPickerOpen } from '../../../shared/ui/colorPicker.js';

function ensureConfig() {
  if (!S.TABLE_CONFIG) S.TABLE_CONFIG = {};
  const c = S.TABLE_CONFIG;
  if (typeof c.showTotal !== 'boolean') c.showTotal = false;
  if (typeof c.transpose !== 'boolean') c.transpose = false;
  if (!c.table) c.table = {};
  if (!c.styles) c.styles = {};
  if (!c.headerStyles) c.headerStyles = {};
  if (!c.filters) c.filters = {};
  if (!c.sort) c.sort = {};
  return c;
}
// sort スキーマ: 旧 { col, dir, custom } → 新 { list: [{ col, dir, custom }, ...] }
// table.js 側の sortListFrom() で実行時に同様の互換読み出しをする。
function ensureSortList(cfg) {
  if (!cfg.sort) cfg.sort = {};
  if (!Array.isArray(cfg.sort.list)) {
    cfg.sort.list = cfg.sort.col
      ? [{ col: cfg.sort.col, dir: cfg.sort.dir || 'asc', custom: cfg.sort.custom || '' }]
      : [];
    delete cfg.sort.col;
    delete cfg.sort.dir;
    delete cfg.sort.custom;
  }
  return cfg.sort.list;
}
// 第 depth ディメンションの小計「計」を出すか。未設定は true (既定で表示)。
// 旧形式の showSubtotal=false (全階層まとめて非表示) も後方互換で尊重する。
export function subtotalAt(cfg, depth) {
  const c = cfg || S.TABLE_CONFIG || {};
  const map = c.subtotalDepths;
  // 階層ごとの明示設定が最優先。
  // normalizeTableConfig が subtotalDepths: {} を必ず付けるので「map の有無」で
  // 旧設定を判定してはいけない (空オブジェクトでも旧 showSubtotal:false を無視してしまう)。
  if (map && Object.prototype.hasOwnProperty.call(map, depth)) return map[depth] !== false;
  // 未設定の階層は旧形式 (showSubtotal: 単一 bool) へフォールバック
  if (c.showSubtotal === false) return false;
  return true;
}

function setField(bucket, key, field, value) {
  const c = ensureConfig();
  if (key == null) {
    if (!c[bucket]) c[bucket] = {};
    c[bucket][field] = value;
  } else {
    if (!c[bucket][key]) c[bucket][key] = {};
    c[bucket][key][field] = value;
  }
}

export function openTableSettings() {
  document.getElementById('table-settings-panel').classList.remove('hidden');
  document.getElementById('table-settings-backdrop').classList.remove('hidden');
  renderTableSettingsPanel();
}

export function closeTableSettings() {
  document.getElementById('table-settings-panel').classList.add('hidden');
  document.getElementById('table-settings-backdrop').classList.add('hidden');
}

// 装飾チェックボックスのトリオ (B/I/U) + 文字サイズ (px)
function decoControls(style, roleNs) {
  const sizeVal = style.fontSize != null ? style.fontSize : '';
  return `
    <label class="table-settings-deco" title="太字">
      <input type="checkbox" data-table-role="${roleNs}.bold"${style.bold ? ' checked' : ''}>
      <span style="font-weight:700">B</span>
    </label>
    <label class="table-settings-deco" title="斜体">
      <input type="checkbox" data-table-role="${roleNs}.italic"${style.italic ? ' checked' : ''}>
      <span style="font-style:italic">I</span>
    </label>
    <label class="table-settings-deco" title="下線">
      <input type="checkbox" data-table-role="${roleNs}.underline"${style.underline ? ' checked' : ''}>
      <span style="text-decoration:underline">U</span>
    </label>
    <label class="table-settings-size" title="文字サイズ (px、空欄でデフォルト)">
      <span>px</span>
      <input type="number" min="8" max="48" step="1" data-table-role="${roleNs}.fontSize" value="${sizeVal}" placeholder="–">
    </label>
    ${alignControls(style, roleNs)}
    ${vAlignControls(style, roleNs)}`;
}
// 配置 (左/中央/右)。未指定 = デフォルト (dim は左、metric は右など列ごとの既定)。
function alignControls(style, roleNs) {
  const cur = style.align || '';
  const opt = (v, label, title) => `
    <label class="table-settings-deco table-settings-align" title="${title}">
      <input type="radio" name="${roleNs}.align" data-table-role="${roleNs}.align" value="${v}"${cur === v ? ' checked' : ''}>
      <span>${label}</span>
    </label>`;
  // 「指定なし」に戻すためのクリアボタンを末尾に。
  return `<span class="table-settings-align-group">
    ${opt('left',   '←', '左揃え')}
    ${opt('center', '↔', '中央揃え')}
    ${opt('right',  '→', '右揃え')}
    <button type="button" class="table-settings-clear" data-table-role="clear:${roleNs}.align" title="配置を指定なしに戻す" aria-label="クリア"${cur ? '' : ' disabled'}>×</button>
  </span>`;
}
// 縦方向の配置 (上/中央/下)。未指定 = ブラウザのデフォルト (middle)。改行を含むラベルで他列の揃え方を調整する用途。
function vAlignControls(style, roleNs) {
  const cur = style.vAlign || '';
  const opt = (v, label, title) => `
    <label class="table-settings-deco table-settings-align" title="${title}">
      <input type="radio" name="${roleNs}.vAlign" data-table-role="${roleNs}.vAlign" value="${v}"${cur === v ? ' checked' : ''}>
      <span>${label}</span>
    </label>`;
  return `<span class="table-settings-align-group">
    ${opt('top',    '↑', '上揃え')}
    ${opt('middle', '↕', '中央揃え (縦)')}
    ${opt('bottom', '↓', '下揃え')}
    <button type="button" class="table-settings-clear" data-table-role="clear:${roleNs}.vAlign" title="縦配置を指定なしに戻す" aria-label="クリア"${cur ? '' : ' disabled'}>×</button>
  </span>`;
}
// 1 つのカラーピッカー + (デフォルト) タグ + ✕ クリアボタン。
//   value 未指定なら "(デフォルト)" を表示 + ✕ ボタンを disabled。
function colorField(label, role, val, fallback) {
  const isDefault = !val;
  // タグは常に DOM に置いて、未指定でない時は visibility:hidden で幅を保持 → UI のガタつき防止。
  const tagCls = 'table-settings-default-tag' + (isDefault ? '' : ' is-hidden');
  const labelCls = 'table-settings-color' + (isDefault ? ' is-default' : '');
  return `<span class="table-settings-color-wrap">
    <span class="${labelCls}">
      <span>${label} <span class="${tagCls}">(指定なし)</span></span>
      <dashboard-color-picker data-table-role="${role}" value="${val || fallback || '#ffffff'}"></dashboard-color-picker>
    </span>
    <button type="button" class="table-settings-clear" data-table-role="clear:${role}" title="指定なしに戻す" aria-label="クリア"${isDefault ? ' disabled' : ''}>×</button>
  </span>`;
}
// 文字色 / 背景色 のペア
function colorControls(style, roleNs, defaults = { color: '#334155', bgColor: '#ffffff' }) {
  return colorField('文字', `${roleNs}.color`, style.color, defaults.color)
       + colorField('背景', `${roleNs}.bgColor`, style.bgColor, defaults.bgColor);
}

function syncColorFieldUi(el, hasValue) {
  const wrap = el.closest('.table-settings-color-wrap');
  if (!wrap) return;
  const label = wrap.querySelector('.table-settings-color');
  const tag = wrap.querySelector('.table-settings-default-tag');
  const clear = wrap.querySelector('.table-settings-clear');
  if (label) label.classList.toggle('is-default', !hasValue);
  if (tag) tag.classList.toggle('is-hidden', hasValue);
  if (clear) clear.disabled = !hasValue;
}

// セクションの open 状態は innerHTML 再構築で消えるので、再描画前に記録 → 後で復元。
const _openSections = new Set();
function captureOpenSections() {
  _openSections.clear();
  document.querySelectorAll('#table-settings-body details.table-settings-section').forEach((d, i) => {
    if (d.open) _openSections.add(i);
  });
}
function applyOpenSections() {
  document.querySelectorAll('#table-settings-body details.table-settings-section').forEach((d, i) => {
    if (_openSections.has(i)) d.open = true;
  });
}

export function renderTableSettingsPanel() {
  const body = document.getElementById('table-settings-body');
  if (!body) return;
  captureOpenSections();
  const cfg = ensureConfig();
  // ディメンション + メトリクスを同一名前空間の「列」として扱う。
  // key 衝突が起きる場合 (dim と metric が同名) のために、dim は 'dim:<key>' で
  // 内部識別し、データ td 側でも data-dim-key を持たせる。
  const dimCols = (S.SELECTED_DIMS || []).map(k => ({ key: 'dim:' + k, label: dimLabel(k), kind: 'dim' }));
  const metCols = (S.METRIC_DEFS || []).filter(m => (S.SELECTED_METRICS || []).includes(m.key))
    .map(m => ({ key: m.key, label: m.label, kind: 'metric' }));
  const columns = [...dimCols, ...metCols];

  const colStyleRow = (c, bucket) => {
    const s = cfg[bucket][c.key] || {};
    return `<div class="table-settings-metric-row" data-col-key="${escapeHtml(c.key)}" data-bucket="${bucket}">
      <div class="table-settings-metric-label">${escapeHtml(c.label)}</div>
      <div class="table-settings-metric-controls">
        ${colorControls(s, bucket + ':' + c.key)}
        ${decoControls(s, bucket + ':' + c.key)}
        <button type="button" class="link-btn" data-table-role="reset:${bucket}:${escapeHtml(c.key)}" title="リセット">↺</button>
      </div>
    </div>`;
  };

  const t = cfg.table;
  const defField = (label, role, val, fallback = '') => colorField(label, role, val, fallback);

  // ディメンション階層別の背景色設定。
  // dim 数 N に対して N 個の control を出す:
  //   0 〜 N-2 → 親行 (集計行) bg, CSS 変数 --depth-i-bg
  //   N-1     → データ行 (= 集計じゃない 1 件ごとの行) bg, CSS 変数 --leaf-bg
  const numDims = (S.SELECTED_DIMS || []).length;
  const depthDefaults = ['#fef3c7', '#fef9c3', '#ecfccb', '#dcfce7', '#dbeafe', '#ffffff'];
  const depthFields = [];
  for (let i = 0; i < Math.max(1, numDims); i++) {
    const isLeaf = i === numDims - 1;
    const role = isLeaf ? 'table.leafBg' : `table.depthBg${i}`;
    const cur = isLeaf ? (t.leafBg || '') : (t['depthBg' + i] || '');
    const fallback = isLeaf ? '#ffffff' : (depthDefaults[i] || '#f1f5f9');
    const label = `第${i + 1}ディメンション`;
    depthFields.push(`
      <div class="table-settings-inline">
        ${defField(label, role, cur, fallback)}
      </div>`);
  }

  // 階層ごとの小計「計」表示。最終ディメンションは配下を持たない = 小計が無いので出さない。
  // 通常表示ではグループの最終行、転置表示では最終列に出る。
  const subtotalFields = [];
  for (let i = 0; i < numDims - 1; i++) {
    subtotalFields.push(`
      <div class="table-settings-inline">
        <label class="table-settings-field" title="${escapeHtml(dimLabel(S.SELECTED_DIMS[i]))} の小計">
          <input type="checkbox" data-table-role="subtotalDepth:${i}"${subtotalAt(cfg, i) ? ' checked' : ''}>
          <span>第${i + 1}ディメンション</span>
        </label>
      </div>`);
  }

  body.innerHTML = `
    <details class="table-settings-section">
      <summary>全体</summary>
      <div class="table-settings-section-body">
        <div class="table-settings-field-title">ヘッダー (列ラベルの行)</div>
        <div class="table-settings-inline">
          ${defField('背景', 'table.headerBg', t.headerBg, '#eef2ff')}
          ${defField('文字', 'table.headerColor', t.headerColor, '#2563eb')}
        </div>
        <div class="table-settings-inline">
          <span class="table-settings-align-group">
            <label class="table-settings-deco table-settings-align" title="左揃え">
              <input type="radio" name="table.headerAlign" data-table-role="table.headerAlign" value="left"${t.headerAlign === 'left' ? ' checked' : ''}>
              <span>←</span>
            </label>
            <label class="table-settings-deco table-settings-align" title="中央揃え">
              <input type="radio" name="table.headerAlign" data-table-role="table.headerAlign" value="center"${t.headerAlign === 'center' ? ' checked' : ''}>
              <span>↔</span>
            </label>
            <label class="table-settings-deco table-settings-align" title="右揃え">
              <input type="radio" name="table.headerAlign" data-table-role="table.headerAlign" value="right"${t.headerAlign === 'right' ? ' checked' : ''}>
              <span>→</span>
            </label>
            <button type="button" class="table-settings-clear" data-table-role="clear:table.headerAlign" title="配置を指定なしに戻す" aria-label="クリア"${t.headerAlign ? '' : ' disabled'}>×</button>
          </span>
          <span class="table-settings-align-group">
            <label class="table-settings-deco table-settings-align" title="上揃え">
              <input type="radio" name="table.headerVAlign" data-table-role="table.headerVAlign" value="top"${t.headerVAlign === 'top' ? ' checked' : ''}>
              <span>↑</span>
            </label>
            <label class="table-settings-deco table-settings-align" title="中央揃え (縦)">
              <input type="radio" name="table.headerVAlign" data-table-role="table.headerVAlign" value="middle"${t.headerVAlign === 'middle' ? ' checked' : ''}>
              <span>↕</span>
            </label>
            <label class="table-settings-deco table-settings-align" title="下揃え">
              <input type="radio" name="table.headerVAlign" data-table-role="table.headerVAlign" value="bottom"${t.headerVAlign === 'bottom' ? ' checked' : ''}>
              <span>↓</span>
            </label>
            <button type="button" class="table-settings-clear" data-table-role="clear:table.headerVAlign" title="縦配置を指定なしに戻す" aria-label="クリア"${t.headerVAlign ? '' : ' disabled'}>×</button>
          </span>
        </div>
        <div class="table-settings-field-title" title="通常表示では上部の総計行、転置表示では左端の総計列に適用されます">総計</div>
        <div class="table-settings-inline">
          ${defField('背景', 'table.totalBg', t.totalBg, '#eef2ff')}
          ${defField('文字', 'table.totalColor', t.totalColor, '#1e293b')}
        </div>
        <div class="table-settings-inline">
          <label class="table-settings-deco" title="太字">
            <input type="checkbox" data-table-role="table.totalBold"${(t.totalBold !== false) ? ' checked' : ''}>
            <span style="font-weight:700">B</span>
          </label>
          <label class="table-settings-deco" title="斜体">
            <input type="checkbox" data-table-role="table.totalItalic"${t.totalItalic ? ' checked' : ''}>
            <span style="font-style:italic">I</span>
          </label>
          <label class="table-settings-deco" title="下線">
            <input type="checkbox" data-table-role="table.totalUnderline"${t.totalUnderline ? ' checked' : ''}>
            <span style="text-decoration:underline">U</span>
          </label>
          <label class="table-settings-size" title="文字サイズ (px、空欄でデフォルト)">
            <span>px</span>
            <input type="number" min="8" max="48" step="1" data-table-role="table.totalFontSize" value="${t.totalFontSize != null ? t.totalFontSize : ''}" placeholder="–">
          </label>
          <span class="table-settings-align-group">
            <label class="table-settings-deco table-settings-align" title="左揃え">
              <input type="radio" name="table.totalAlign" data-table-role="table.totalAlign" value="left"${t.totalAlign === 'left' ? ' checked' : ''}>
              <span>←</span>
            </label>
            <label class="table-settings-deco table-settings-align" title="中央揃え">
              <input type="radio" name="table.totalAlign" data-table-role="table.totalAlign" value="center"${t.totalAlign === 'center' ? ' checked' : ''}>
              <span>↔</span>
            </label>
            <label class="table-settings-deco table-settings-align" title="右揃え">
              <input type="radio" name="table.totalAlign" data-table-role="table.totalAlign" value="right"${t.totalAlign === 'right' ? ' checked' : ''}>
              <span>→</span>
            </label>
            <button type="button" class="table-settings-clear" data-table-role="clear:table.totalAlign" title="配置を指定なしに戻す" aria-label="クリア"${t.totalAlign ? '' : ' disabled'}>×</button>
          </span>
          <span class="table-settings-align-group">
            <label class="table-settings-deco table-settings-align" title="上揃え">
              <input type="radio" name="table.totalVAlign" data-table-role="table.totalVAlign" value="top"${t.totalVAlign === 'top' ? ' checked' : ''}>
              <span>↑</span>
            </label>
            <label class="table-settings-deco table-settings-align" title="中央揃え (縦)">
              <input type="radio" name="table.totalVAlign" data-table-role="table.totalVAlign" value="middle"${t.totalVAlign === 'middle' ? ' checked' : ''}>
              <span>↕</span>
            </label>
            <label class="table-settings-deco table-settings-align" title="下揃え">
              <input type="radio" name="table.totalVAlign" data-table-role="table.totalVAlign" value="bottom"${t.totalVAlign === 'bottom' ? ' checked' : ''}>
              <span>↓</span>
            </label>
            <button type="button" class="table-settings-clear" data-table-role="clear:table.totalVAlign" title="縦配置を指定なしに戻す" aria-label="クリア"${t.totalVAlign ? '' : ' disabled'}>×</button>
          </span>
        </div>
        <label class="table-settings-field" style="margin-top:10px" title="ONでメトリクスを行、ディメンションの値を列に入れ替えて表示します">
          <input type="checkbox" data-table-role="root.transpose"${cfg.transpose ? ' checked' : ''}>
          <span>行と列を入れ替える (メトリクスを行に)</span>
        </label>
        <label class="table-settings-field" style="margin-top:10px" title="通常表示では上部の行、転置表示では左側の列に表示します">
          <input type="checkbox" data-table-role="root.showTotal"${cfg.showTotal ? ' checked' : ''}>
          <span>総計を表示</span>
        </label>
        <label class="table-settings-field" title="ONで総計のスタイルを「項目ごと」の設定より優先">
          <input type="checkbox" data-table-role="table.totalPriority"${t.totalPriority ? ' checked' : ''}>
          <span>総計のスタイルを項目ごとより優先</span>
        </label>
        <div class="table-settings-field-title" title="親ディメンションの小計「計」を階層ごとに表示します。通常表示ではグループの最終行、転置表示では最終列に出ます。折り畳み中のグループは唯一の行/列なのでOFFでも集計値を表示します">小計「計」を表示</div>
        ${subtotalFields.join('') || '<div class="preset-empty">ディメンションが1つのため小計はありません</div>'}
        <div class="table-settings-field-title" title="第1〜第N-1 は各階層の小計「計」の背景、第N (末端) はデータ行の背景です。通常表示では行、転置表示では列に適用されます">階層別 背景 (小計 / データ)</div>
        ${depthFields.join('') || '<div class="preset-empty">ディメンションを選択してください</div>'}
        <label class="table-settings-field" style="margin-top:10px" title="ONで階層別のスタイルを「項目ごと」の設定より優先 (閾値カラーは維持)">
          <input type="checkbox" data-table-role="table.depthPriority"${t.depthPriority ? ' checked' : ''}>
          <span>階層別のスタイルを項目ごとより優先</span>
        </label>
        <div class="table-settings-field-title">ホバー</div>
        <div class="table-settings-inline">
          ${defField('行 hover 背景', 'table.hoverBg', t.hoverBg, '#dbeafe')}
          <button type="button" class="link-btn" data-table-role="reset:table" title="全体リセット">↺</button>
        </div>
      </div>
    </details>
    <details class="table-settings-section">
      <summary title="メトリクス / ディメンションごとの設定。通常表示では列、転置表示では行に適用されます">項目ごと (ヘッダー)</summary>
      <div class="table-settings-section-body">
        ${columns.length ? columns.map(c => colStyleRow(c, 'headerStyles')).join('') : '<div class="preset-empty">表示中の項目がありません</div>'}
      </div>
    </details>
    <details class="table-settings-section">
      <summary title="メトリクス / ディメンションごとの設定。通常表示では列、転置表示では行に適用されます">項目ごと (データ)</summary>
      <div class="table-settings-section-body">
        ${columns.length ? columns.map(c => colStyleRow(c, 'styles')).join('') : '<div class="preset-empty">表示中の項目がありません</div>'}
      </div>
    </details>
    <details class="table-settings-section">
      <summary>フィルタ</summary>
      <div class="table-settings-section-body">
        ${columns.length ? columns.map(c => filterRow(c, cfg)).join('') : '<div class="preset-empty">表示中の列がありません</div>'}
      </div>
    </details>
    <details class="table-settings-section">
      <summary>並び替え</summary>
      <div class="table-settings-section-body">
        ${sortBlock(columns, cfg)}
      </div>
    </details>
  `;
  applyOpenSections();
}

// ===== フィルタ =====
const FILTER_OPS = [
  { v: '',         l: '指定なし' },
  { v: 'ne',       l: '≠ (除外)' },
  { v: 'eq',       l: '= (一致)' },
  { v: 'gt',       l: '> (より大)' },
  { v: 'gte',      l: '≥ (以上)' },
  { v: 'lt',       l: '< (より小)' },
  { v: 'lte',      l: '≤ (以下)' },
  { v: 'contains', l: '含む' },
];
function filterRow(c, cfg) {
  const rule = (cfg.filters || {})[c.key] || {};
  const op = rule.op || '';
  const val = rule.value != null ? rule.value : '';
  const isMetric = c.kind === 'metric';
  const quickZero = isMetric
    ? `<button type="button" class="link-btn" data-table-role="filter-zero:${escapeHtml(c.key)}" title="0 を除外するショートカット">0 を除外</button>`
    : '';
  return `<div class="table-settings-metric-row" data-col-key="${escapeHtml(c.key)}">
    <div class="table-settings-metric-label">${escapeHtml(c.label)}</div>
    <div class="table-settings-metric-controls">
      <select data-table-role="filters:${escapeHtml(c.key)}.op">
        ${FILTER_OPS.map(o => `<option value="${o.v}"${op === o.v ? ' selected' : ''}>${o.l}</option>`).join('')}
      </select>
      <input type="text" data-table-role="filters:${escapeHtml(c.key)}.value" value="${escapeHtml(String(val))}" placeholder="${isMetric ? '0' : '値'}" ${op ? '' : 'disabled'}>
      ${quickZero}
      <button type="button" class="link-btn" data-table-role="clear:filters:${escapeHtml(c.key)}" title="フィルタをクリア">×</button>
    </div>
  </div>`;
}

// ===== 並び替え =====
// 複数キーソート対応: 並び替え 1 → 2 → 3 ... の順で評価し、最初に差が出たもので決定。
// 各エントリは旧 sort.col / sort.dir / sort.custom と同じ shape ({col, dir, custom})。
//
// UI は cfg.sort.list を素直にレンダリングする (col 未設定の項目も非表示にしない)。
// 初回オープン時のために list が空なら 1 件の空エントリで初期化しておく → ユーザは
// プルダウンから列を選ぶだけで動き出す。
function sortBlock(columns, cfg) {
  if (!columns.length) return '<div class="preset-empty">表示中の列がありません</div>';
  // 描画では設定を変更しないこと。ensureSortList は cfg.sort.list の「実体」を返すので、
  // ここで push すると「設定を開いただけ」で保存済みの [] が空条件入りに変わり dirty になる。
  const savedList = ensureSortList(cfg);
  const list = savedList.length ? savedList : [{ col: '', dir: 'asc', custom: '' }];  // 表示用
  const renderItem = (item, i) => {
    const colKey = item.col || '';
    const dir = item.dir || 'asc';
    const custom = item.custom || '';
    return `
    <div class="sort-item" data-sort-idx="${i}" style="border:1px solid var(--border);border-radius:6px;padding:10px;margin-top:8px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <strong style="font-size:12px;color:var(--muted)">並べ替え ${i + 1}</strong>
        ${list.length > 1 ? `<button type="button" class="link-btn" data-table-role="remove-sort:${i}" title="この並び替えを削除">× 削除</button>` : ''}
      </div>
      <select data-table-role="sortItem:${i}.col" style="width:100%">
        <option value=""${!colKey ? ' selected' : ''}>指定なし</option>
        ${columns.map(c => `<option value="${escapeHtml(c.key)}"${colKey === c.key ? ' selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
      </select>
      <div class="table-settings-inline" style="margin-top:8px">
        <label class="table-settings-deco" title="昇順">
          <input type="radio" name="sortItem.${i}.dir" data-table-role="sortItem:${i}.dir" value="asc"${dir === 'asc' ? ' checked' : ''}>
          <span>昇順</span>
        </label>
        <label class="table-settings-deco" title="降順">
          <input type="radio" name="sortItem.${i}.dir" data-table-role="sortItem:${i}.dir" value="desc"${dir === 'desc' ? ' checked' : ''}>
          <span>降順</span>
        </label>
      </div>
      <div class="table-settings-field-title" style="margin-top:8px">カスタム順序 <small style="font-weight:400;color:var(--muted)">(任意・1 行 1 値、リストにある値が先に並ぶ)</small></div>
      <textarea data-table-role="sortItem:${i}.custom" rows="3" style="width:100%;box-sizing:border-box;font-family:inherit;font-size:12px;border:1px solid var(--border);border-radius:6px;padding:6px 8px" placeholder="例:\n広告A\n広告B\n広告C">${escapeHtml(custom)}</textarea>
    </div>`;
  };
  return `
    ${list.map(renderItem).join('')}
    <div style="margin-top:10px;display:flex;gap:8px">
      <button type="button" class="link-btn" data-table-role="add-sort">+ 並び替えを追加</button>
      ${list.some(it => it && it.col) ? '<button type="button" class="link-btn" data-table-role="clear:sort" title="並び替えを全てリセット">すべてリセット</button>' : ''}
    </div>
  `;
}

// data-table-role の構文:
//   "root.showTotal"             ← cfg.showTotal (トップレベル真偽値)
//   "table.headerBg"             ← cfg.table.headerBg (全体セクションの色/装飾全般)
//   "styles:colKey.color"        ← cfg.styles[colKey].color
//   "headerStyles:colKey.bold"   ← cfg.headerStyles[colKey].bold
//   "reset:table" / "reset:styles:colKey" / "reset:headerStyles:colKey"
//   "clear:table.headerBg" / "clear:styles:colKey.color"  ← 単一フィールドクリア
function onPanelChange(e) {
  const el = e.target;
  const role = el.dataset.tableRole;
  if (!role) return;
  if (role === 'root.showTotal') {
    ensureConfig().showTotal = !!el.checked;
    emit('render');
    return;
  }
  if (role === 'root.transpose') {
    ensureConfig().transpose = !!el.checked;
    emit('render');
    return;
  }
  if (role.startsWith('subtotalDepth:')) {
    const cfg = ensureConfig();
    // 旧形式 (showSubtotal 単一フラグ) から階層別へ移行する。
    if (!cfg.subtotalDepths) {
      cfg.subtotalDepths = {};
      if (cfg.showSubtotal === false) {
        // 旧「全部非表示」を階層別へ引き写してから、触った階層だけ上書きする
        const n = (S.SELECTED_DIMS || []).length;
        for (let i = 0; i < n; i++) cfg.subtotalDepths[i] = false;
      }
      delete cfg.showSubtotal;
    }
    cfg.subtotalDepths[+role.slice('subtotalDepth:'.length)] = !!el.checked;
    emit('render');
    return;
  }
  // 複数キーソート: sortItem:<idx>.<field>
  if (role.startsWith('sortItem:')) {
    const m = role.match(/^sortItem:(\d+)\.(\w+)$/);
    if (m) {
      const cfg = ensureConfig();
      const list = ensureSortList(cfg);
      const idx = +m[1];
      const field = m[2];
      while (list.length <= idx) list.push({ col: '', dir: 'asc', custom: '' });
      list[idx][field] = el.value;
      emit('render');
      return;
    }
  }
  // {bucket}.{field}   or   {bucket}:{metricKey}.{field}
  const dot = role.lastIndexOf('.');
  if (dot < 0) return;
  const prefix = role.slice(0, dot);
  const field = role.slice(dot + 1);
  const colon = prefix.indexOf(':');
  const bucket = colon < 0 ? prefix : prefix.slice(0, colon);
  const key = colon < 0 ? null : prefix.slice(colon + 1);
  let value;
  if (el.type === 'checkbox') value = !!el.checked;
  else if (el.type === 'number') value = el.value === '' ? null : Number(el.value);
  else value = el.value;
  setField(bucket, key, field, value);
  if (el.tagName === 'DASHBOARD-COLOR-PICKER') syncColorFieldUi(el, !!value);
  emit('render');
}

function onPanelClick(e) {
  // 並び替えを追加
  const addS = e.target.closest('[data-table-role="add-sort"]');
  if (addS) {
    const cfg = ensureConfig();
    const list = ensureSortList(cfg);
    list.push({ col: '', dir: 'asc', custom: '' });
    renderTableSettingsPanel();
    // 並び替え条件が空 (col='') のままなら render しない方が無駄が無いが、UI 上の整合のため emit
    emit('render');
    return;
  }
  // 並び替えを削除 (remove-sort:<idx>)
  const rmS = e.target.closest('[data-table-role^="remove-sort:"]');
  if (rmS) {
    const idx = +rmS.dataset.tableRole.slice('remove-sort:'.length);
    const cfg = ensureConfig();
    const list = ensureSortList(cfg);
    if (Number.isInteger(idx) && idx >= 0 && idx < list.length) list.splice(idx, 1);
    renderTableSettingsPanel();
    emit('render');
    return;
  }
  // 0 除外ショートカット (フィルタ): filter-zero:<colKey>
  const fz = e.target.closest('[data-table-role^="filter-zero:"]');
  if (fz) {
    const colKey = fz.dataset.tableRole.slice('filter-zero:'.length);
    const c = ensureConfig();
    if (!c.filters[colKey]) c.filters[colKey] = {};
    c.filters[colKey].op = 'ne';
    c.filters[colKey].value = 0;
    renderTableSettingsPanel();
    emit('render');
    return;
  }
  // 単一フィールドクリア (× ボタン)
  const clr = e.target.closest('[data-table-role^="clear:"]');
  if (clr && !clr.disabled) {
    const body = clr.dataset.tableRole.slice('clear:'.length);
    const c = ensureConfig();
    const dot = body.lastIndexOf('.');
    if (dot < 0) {
      // bucket 全削除 or bucket:key 全削除
      const colon = body.indexOf(':');
      if (colon < 0) {
        // bucket 全クリア (例: clear:sort)
        c[body] = {};
      } else {
        const bucket = body.slice(0, colon);
        const key = body.slice(colon + 1);
        if (c[bucket]) delete c[bucket][key];
      }
    } else {
      const prefix = body.slice(0, dot);
      const field = body.slice(dot + 1);
      const colon = prefix.indexOf(':');
      const bucket = colon < 0 ? prefix : prefix.slice(0, colon);
      const key = colon < 0 ? null : prefix.slice(colon + 1);
      if (key) {
        if (c[bucket] && c[bucket][key]) delete c[bucket][key][field];
      } else if (c[bucket]) {
        delete c[bucket][field];
      }
    }
    renderTableSettingsPanel();
    emit('render');
    return;
  }
  const btn = e.target.closest('[data-table-role^="reset"]');
  if (!btn) return;
  const role = btn.dataset.tableRole; // reset:bucket  or  reset:bucket:colKey (colKey は dim:foo を含み得る)
  // 最初のコロン以降は bucket / 残り全部を key とする (dim:action_date のような key 対応)。
  const m = /^reset:([^:]+)(?::(.+))?$/.exec(role);
  if (!m) return;
  const bucket = m[1];
  const key = m[2];
  const c = ensureConfig();
  if (key && c[bucket]) {
    delete c[bucket][key];
  } else if (!key && c[bucket]) {
    c[bucket] = {};
  }
  renderTableSettingsPanel();
  emit('render');
}

// change のみ (input にすると number 入力が 1 文字ごとに再描画されてフォーカスが飛ぶ)。
// color picker はダイアログ閉じる時に change が発火するので live preview にはならないが許容。
document.getElementById('table-settings-body').addEventListener('change', onPanelChange);
document.getElementById('table-settings-body').addEventListener('click', onPanelClick);
document.getElementById('table-settings-close').addEventListener('click', closeTableSettings);
document.getElementById('table-settings-backdrop').addEventListener('click', closeTableSettings);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !document.getElementById('table-settings-panel').classList.contains('hidden')) {
    closeTableSettings();
  }
});
on('render', () => {
  const panel = document.getElementById('table-settings-panel');
  // カラーピッカーがドラッグ中だと再 render で picker DOM が破棄されるのでスキップ。
  if (panel && !panel.classList.contains('hidden') && !isAnyColorPickerOpen()) renderTableSettingsPanel();
});
// ピッカー閉じた瞬間に遅延 render を流す (ピッカー open 中に skip された再 render を回収)。
document.addEventListener('dashboard-picker-closed', () => {
  const panel = document.getElementById('table-settings-panel');
  if (panel && !panel.classList.contains('hidden')) renderTableSettingsPanel();
});

// ===== Style builders (table.js から使う) =====
// bgColor は `background:` shorthand で出す → 深度ベース gradient を完全に上書き。
function styleToCss(s, includeDeco = true) {
  if (!s) return '';
  const parts = [];
  if (s.color) parts.push(`color:${s.color}`);
  if (s.bgColor) parts.push(`background:${s.bgColor}`);
  if (includeDeco) {
    if (s.bold) parts.push('font-weight:700');
    if (s.italic) parts.push('font-style:italic');
    if (s.underline) parts.push('text-decoration:underline');
    if (s.fontSize) parts.push(`font-size:${s.fontSize}px`);
  }
  if (s.align) parts.push(`text-align:${s.align}`);
  if (s.vAlign) parts.push(`vertical-align:${s.vAlign}`);
  return parts.join(';');
}
// 列セル (データ td) のスタイル。key は metric key または 'dim:<dimKey>'。
export function buildCellStyle(key) {
  return styleToCss(S.TABLE_CONFIG?.styles?.[key]);
}
// 列ヘッダー (th) のスタイル: 列ごとのヘッダー設定のみ (全体ヘッダー設定は廃止)。
export function buildHeaderCellStyle(key) {
  return styleToCss((S.TABLE_CONFIG?.headerStyles || {})[key]);
}
// テーブル全体のデフォルトスタイル: CSS 変数で各セルにカスケード。
//   --header-bg / --header-color : ヘッダー (列ラベル)
//   --depth-N-bg                 : 親行 第N+1 ディメンションの集計行背景 (N=0,1,2,...)
//   --leaf-bg                    : データ行背景
//   --dim-color / --data-color   : 列タイプ別デフォルト文字色
//   --hover-bg                   : 行 hover 背景
// 列ごと (列ごとセクション) の inline style はこれより優先される (specificity 1000)。
export function buildTableStyle() {
  const t = S.TABLE_CONFIG?.table || {};
  const parts = [];
  if (t.headerBg)    parts.push(`--header-bg:${t.headerBg}`);
  if (t.headerColor) parts.push(`--header-color:${t.headerColor}`);
  if (t.totalBg)     parts.push(`--total-bg:${t.totalBg}`);
  if (t.totalColor)  parts.push(`--total-color:${t.totalColor}`);
  if (t.totalBold === false) parts.push(`--total-font-weight:400`);
  else if (t.totalBold === true) parts.push(`--total-font-weight:700`);
  if (t.totalItalic)    parts.push(`--total-font-style:italic`);
  if (t.totalUnderline) parts.push(`--total-text-decoration:underline`);
  if (t.totalFontSize)  parts.push(`--total-font-size:${t.totalFontSize}px`);
  if (t.totalAlign)     parts.push(`--total-text-align:${t.totalAlign}`);
  if (t.totalVAlign)    parts.push(`--total-vertical-align:${t.totalVAlign}`);
  if (t.headerVAlign)   parts.push(`--header-vertical-align:${t.headerVAlign}`);
  if (t.headerAlign)    parts.push(`--header-text-align:${t.headerAlign}`);
  // ディメンションは最大 20 まで扱えるので depthBg0..19 を出力する。
  // (8 までしか出していないと、UI 上は色を変えられるのに反映されず故障に見える)
  for (let i = 0; i < 20; i++) {
    if (t['depthBg' + i]) parts.push(`--depth-${i}-bg:${t['depthBg' + i]}`);
  }
  if (t.leafBg)    parts.push(`--leaf-bg:${t.leafBg}`);
  if (t.hoverBg)   parts.push(`--hover-bg:${t.hoverBg}`);
  return parts.join(';');
}
