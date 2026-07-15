import { S } from '../../../app/state.js';
import { escapeHtml, escapeHtmlNl } from '../../../shared/utils/utils.js';
import { dimLabel, dimSort } from '../../../aggregate/dimensions.js';
import { aggregate } from '../../../aggregate/aggregate.js';
import { openTableSettings, buildHeaderCellStyle, buildTableStyle, subtotalAt } from './tableSettings.js';
import { emit } from '../../../app/events.js';
import { sumAggs, evalDerivedWithContext } from './aggUtils.js';
import { passesFilter, makeBucketComparator, sortListFrom, customSortIndex } from './query.js';
import { thresholdClass, metricCellHtml, buildMetricCells, isSafeLink, isSafeImageSrc, dimCellHtml } from './cells.js';

// ===== Table rendering =====
// Collapsed state: key = "level:value|level:value..."
// 通常表示 (行の折り畳み) と転置表示 (列の折り畳み) で状態を分ける。
// 同じ groupKey でも「行を畳む」と「列を畳む」は別の操作なので、共有すると
// 転置を切り替えた瞬間に畳んでいないはずの側まで畳まれてしまう。
const collapsedRowGroups = new Set();
const collapsedColumnGroups = new Set();
// いま操作対象になる折り畳み状態 (toggle / ツールバーの展開・折りたたみ用)。
function activeCollapsed() {
  return S.TABLE_CONFIG?.transpose ? collapsedColumnGroups : collapsedRowGroups;
}

// Zoom
const ZOOM_KEY = 'dashboard.tableZoom';
const DEFAULT_ZOOM = 70;
let tableZoom = DEFAULT_ZOOM;
try { const saved = localStorage.getItem(ZOOM_KEY); if (saved != null) tableZoom = +saved; } catch (e) {}
if (!tableZoom || tableZoom < 50 || tableZoom > 200) tableZoom = DEFAULT_ZOOM;

// Frozen columns
const DEFAULT_FROZEN = 1; // default: first dim column frozen
let frozenCount = DEFAULT_FROZEN;

// 固定列に指定できる上限。renderTable が通常/転置どちらのパスでも更新する。
// 転置時は列構成が変わる (メトリクス名 + 総計 + 値列) ため dims+metrics の単純計算では合わず、
// 100 列打ち切りも反映されない。固定列の上限判定は必ずここを参照する。
// なお階層ヘッダー (転置 × 複数ディメンション) では親見出しが colspan するため
// ヘッダーの th と列が 1:1 で対応しない。applyFrozenColumns は th を順番に見て
// left を積むので、rowspan で全ヘッダー行を貫いている左端までしか正しく固定できない。
let freezableColCount = 0;
function maxFrozenCols() {
  return freezableColCount || (S.SELECTED_DIMS.length + S.SELECTED_METRICS.length);
}
// 描画に使う実効値。frozenCount (保存値) は描画では絶対に書き換えないこと。
// 書き換えると「通常表示で 4 列固定 → 転置 (上限 1-2) → 通常へ戻す」で 4 が失われる。
function effectiveFrozenCount() {
  return Math.min(frozenCount, maxFrozenCols());
}

// プリセット連携: テーブルの折り畳み/倍率/固定列を取得・適用
export function getTableState() {
  return {
    // collapsedGroups は「通常表示 (行)」の状態。旧プリセットと同じキーのまま保つ。
    collapsedGroups: [...collapsedRowGroups],
    // 転置 (列) は別キー。旧プリセットには存在しないので読み込み時は空になる。
    collapsedColumnGroups: [...collapsedColumnGroups],
    tableZoom,
    frozenCount,
  };
}
// プリセット適用時は tableState を持たない旧プリセットでも必ず呼ぶこと
// (呼ばないと直前のプリセットの折り畳み/倍率/固定列が residual として残る)。
// 欠けている項目は既定値へ戻す = 常に決定的な状態になる。
export function setTableState(state = {}) {
  if (!state || typeof state !== 'object') state = {};
  collapsedRowGroups.clear();
  collapsedColumnGroups.clear();
  // 旧形式 (collapsedGroups のみ) は通常表示用として読み込み、転置用は空で初期化する。
  if (Array.isArray(state.collapsedGroups)) {
    state.collapsedGroups.forEach(k => collapsedRowGroups.add(k));
  }
  if (Array.isArray(state.collapsedColumnGroups)) {
    state.collapsedColumnGroups.forEach(k => collapsedColumnGroups.add(k));
  }
  tableZoom = (typeof state.tableZoom === 'number' && state.tableZoom >= 50 && state.tableZoom <= 200)
    ? state.tableZoom : DEFAULT_ZOOM;
  try { localStorage.setItem(ZOOM_KEY, String(tableZoom)); } catch (e) {}
  frozenCount = (typeof state.frozenCount === 'number' && state.frozenCount >= 0)
    ? state.frozenCount : DEFAULT_FROZEN;
}

// 階層パス → 折り畳み用キー。通常表示 (行) / 転置表示 (列) 共通。
// 旧実装は `${i}:${v}` を '|' で連結していたが、ディメンション値自体に '|' や 'N:' が
// 含まれると別パスから同じキーが生成され、無関係なグループまで畳まれていた。
//   ["a|1:b","c"] と ["a","b|1:c"] → どちらも "0:a|1:b|1:c"
// 構造を保ったまま JSON 配列としてシリアライズすることで、区切り文字・引用符・改行・
// 型 (null / 数値 / 文字列) が混ざっても衝突しない。
// 注意: 形式を変えたため旧プリセットに保存された旧キーとは一致しない。
// → 旧プリセットの折り畳み状態は復元されず全展開で始まる (表示値・集計には影響なし)。
function makeGroupKey(path) {
  return JSON.stringify(path);
}

// Build hierarchy from pre-grouped data (avoids re-scanning rows)
let levelKeys = [];
// 全 dim 階層の parent groupKey を保持 (折りたたみ中の subtree も含む)。
// collapse-all で「DOM に出ていない deeper level の key」も拾うのに使う。
// これが無いと: 「全閉じ → +」で開いたとき、未登録の子 key が default=展開扱いになり cascade してしまう。
let allGroupKeys = new Set();

function collectGroupKeys(groups, totalDimCount) {
  const keys = new Set();
  function walk(bucket, dimIndex, parentPath) {
    if (dimIndex >= totalDimCount - 1) return; // 最終 dim は leaf。toggle 無し
    const byVal = new Map();
    for (const g of bucket) {
      const v = g.vals[dimIndex];
      if (!byVal.has(v)) byVal.set(v, []);
      byVal.get(v).push(g);
    }
    for (const [val, sub] of byVal) {
      const path = [...parentPath, val];
      keys.add(makeGroupKey(path));
      walk(sub, dimIndex + 1, path);
    }
  }
  walk(groups, 0, []);
  return keys;
}

function buildFromGroups(groups, dims, metrics, totalDimCount, totalAgg = null) {
  // groups = [{vals: [v0, v1, ...], rows: [...], agg: {...}}, ...]
  // Pre-compute aggregate for each group once
  for (let i = 0; i < groups.length; i++) {
    if (!groups[i].agg) groups[i].agg = aggregate(groups[i].rows);
  }

  allGroupKeys = collectGroupKeys(groups, totalDimCount);

  // Build nested structure: group by dim[0], then dim[1], etc.
  // 最上位レベルの parent は total 自身 (parent(X) と total(X) が同じ値になる)。
  return buildLevel(groups, dims, 0, totalDimCount, metrics, [], totalAgg, totalAgg);
}

// parentAgg: 直前の階層の集計 (= 親集計行の値)。最上位では total と同じ。
// totalAgg:   テーブル全体の集計 (常に同じ値が深い階層まで伝播)。
// pending をこの行の dim セルへ載せて消費する。pending は共有参照なので、
// 「その親グループで最初に出力された 1 行」だけが引き取り、以降の行は空セルのままになる。
function takePending(cells, pending) {
  if (!pending.length) return;
  for (const p of pending) cells[p.index] = p.html;
  pending.length = 0;
}

// pending: まだ行に載せていない上位の親セル [{index, html}]。
//   親は自分の dim セルを pending に積んで配下を描き、配下の「最初の行」がそれを引き取る。
//   これにより親ラベルと最初の子が同じ行に並ぶ (親専用の空行を作らない)。
//   全行が同じセル数を保つので、固定列 (tr.children[i]) や CSV は従来どおり動く。
function buildLevel(groups, dims, dimIndex, totalDimCount, metrics, parentPath, parentAgg = null, totalAgg = null, pending = []) {
  const isLastDim = dimIndex === dims.length - 1;
  // depthPriority=ON のとき、列ごとのインライン style を抑止して階層色 (CSS 変数) を優先。
  // 閾値カラー (cell-blue 等) は class なので別レイヤーで残る。
  const depthOpts = { skipColStyle: !!S.TABLE_CONFIG?.table?.depthPriority };

  // Group the flat groups by their value at dimIndex
  const buckets = new Map();
  for (let i = 0; i < groups.length; i++) {
    const val = groups[i].vals[dimIndex];
    if (!buckets.has(val)) buckets.set(val, []);
    buckets.get(val).push(groups[i]);
  }

  const userSort = S.TABLE_CONFIG?.sort;
  const sortedKeys = [...buckets.keys()].sort(makeBucketComparator(dimIndex, dims, userSort, buckets));
  let html = '';

  for (const val of sortedKeys) {
    const bucket = buckets.get(val);
    const path = [...parentPath, val];
    const groupKey = makeGroupKey(path);

    if (isLastDim) {
      // Leaf: each bucket entry is a single group
      for (const g of bucket) {
        const cells = [];
        for (let i = 0; i < totalDimCount; i++) {
          cells.push(i < dimIndex
            ? dimCellHtml(dims[i], '', '', '', i, depthOpts)
            : dimCellHtml(dims[i], g.vals[i], '', null, i, depthOpts));
        }
        takePending(cells, pending);   // 最初の行なら上位の親ラベルをここに載せる
        const dimCells = cells.join('');
        // \u6d3e\u751f\u30e1\u30c8\u30ea\u30af\u30b9\u306e\u5f0f\u4e2d\u3067 parent()/total() \u3092\u4f7f\u3046\u5834\u5408\u306b\u5099\u3048\u3066\u3001\u73fe\u5728\u306e parent/total context \u3067\u518d\u8a55\u4fa1\u3002
        // \u5f0f\u304c parent/total \u3092\u542b\u307e\u306a\u3051\u308c\u3070\u7d50\u679c\u306f g.agg \u3068\u540c\u3058\u3002
        const leafAgg = (parentAgg || totalAgg) ? evalDerivedWithContext(g.agg, parentAgg, totalAgg) : g.agg;
        html += `<tr class="pivot-leaf-row pivot-depth-${dimIndex}">${dimCells}${buildMetricCells(leafAgg, metrics, depthOpts, g.vals)}</tr>`;
      }
    } else {
      // \u901a\u5e38\u8868\u793a (\u884c) \u5c02\u7528\u30d1\u30b9\u306a\u306e\u3067\u884c\u7528\u306e\u72b6\u614b\u3060\u3051\u898b\u308b
      const isCollapsed = collapsedRowGroups.has(groupKey);
      const toggleIcon = isCollapsed ? '+' : '\u2212';

      // Summarize: sum base metrics across all groups in this bucket (parent/total context \u3064\u304d)
      const myAgg = sumAggs(bucket.map(g => g.agg), parentAgg, totalAgg);

      if (!levelKeys[dimIndex]) levelKeys[dimIndex] = new Set();
      levelKeys[dimIndex].add(groupKey);

      const inner = `<button type="button" class="pivot-toggle" data-pivot-key="${escapeHtml(groupKey)}" data-pivot-level="${dimIndex}">${toggleIcon}</button><span class="pivot-parent-label">${escapeHtml(val)}</span>`;
      const myCell = dimCellHtml(dims[dimIndex], val, 'pivot-parent-cell', inner, dimIndex, depthOpts);

      if (isCollapsed) {
        // 折り畳み中は 1 行に集約: 見出し + そのグループの集計値。
        // (転置で折り畳み中の親を 1 列に集約するのと同じ考え方)
        const cells = [];
        for (let i = 0; i < totalDimCount; i++) {
          cells.push(i === dimIndex ? myCell : dimCellHtml(dims[i], '', '', '', i, depthOpts));
        }
        takePending(cells, pending);   // 自分が最初の行なら上位の親ラベルも一緒に載せる
        html += `<tr class="pivot-parent-row pivot-depth-${dimIndex}">${cells.join('')}${buildMetricCells(myAgg, metrics, depthOpts, path)}</tr>`;
      } else {
        // 展開中は親専用の行を作らず、自分のセルを配下の「最初の行」へ載せる。
        // → 親ラベルと最初の子が同じ行に並び、集計値は最後の「計」行に入る。
        //
        // pending は同じ配列を共有したまま渡すこと。複製 ([...pending, x]) にすると
        // 上位の親セルが兄弟グループそれぞれの先頭行へ重複して出てしまう。
        // 共有参照なら最初の 1 行が全部引き取って空にするので、以降の兄弟は自分の分だけを積む。
        pending.push({ index: dimIndex, html: myCell });
        // 子階層の parent は自分自身の集計、total は最上位の集計を継承。
        html += buildLevel(bucket, dims, dimIndex + 1, totalDimCount, metrics, path, myAgg, totalAgg, pending);
        // 「計」行 = このグループの集計値。転置の「計」列と同じく最後に置く。
        // ラベルは配下と同じ階層 (dimIndex+1) のセルに入れて、子のすぐ下に揃える。
        if (subtotalAt(S.TABLE_CONFIG, dimIndex)) {
          let subCells = '';
          for (let i = 0; i < totalDimCount; i++) {
            subCells += (i === dimIndex + 1)
              ? dimCellHtml(dims[i], '', 'pivot-subtotal-cell', '計', i, depthOpts)
              : dimCellHtml(dims[i], '', '', '', i, depthOpts);
          }
          html += `<tr class="pivot-parent-row pivot-subtotal-row pivot-depth-${dimIndex}">${subCells}${buildMetricCells(myAgg, metrics, depthOpts, path)}</tr>`;
        }
      }
    }
  }
  return html;
}



// ===== 転置表示 (メトリクス=行 / ディメンション値=列) =====
// 行ピボット (buildLevel) と同じバケツ分割・ソートを使い (折り畳み状態のみ列用に分離)、
// 「親を常に出し、展開中だけ配下が続く」構造をそのまま列方向へ写す。
// toggle は行版と同一マークアップ (.pivot-toggle + data-pivot-key/data-pivot-level) なので、
// クリック処理もツールバーの展開/折りたたみ/レベル指定もそのまま効く。
const TRANSPOSE_MAX_COLS = 100;

// 列ノードのツリーを構築する (ヘッダーの階層化に親子関係が要るためフラットではなく木で持つ)。
// 打ち切った場合は state.truncated = true (呼び出し側が注意書きを出す)。
// state.count は「実際に描画される数値列数」。折り畳みで隠れた子は数えない。
function buildColumnTree(groups, dims, dimIndex, parentPath, parentAgg, totalAgg, state, showSub) {
  const out = [];
  const isLastDim = dimIndex === dims.length - 1;
  const buckets = new Map();
  for (let i = 0; i < groups.length; i++) {
    const val = groups[i].vals[dimIndex];
    if (!buckets.has(val)) buckets.set(val, []);
    buckets.get(val).push(groups[i]);
  }
  const sortedKeys = [...buckets.keys()].sort(makeBucketComparator(dimIndex, dims, S.TABLE_CONFIG?.sort, buckets));
  for (const val of sortedKeys) {
    if (state.count >= TRANSPOSE_MAX_COLS) { state.truncated = true; return out; }
    const bucket = buckets.get(val);
    const path = [...parentPath, val];
    if (isLastDim) {
      for (const g of bucket) {
        if (state.count >= TRANSPOSE_MAX_COLS) { state.truncated = true; return out; }
        state.count++;
        // 行版 leaf と同じく parent/total context で派生を再評価
        const leafAgg = (parentAgg || totalAgg) ? evalDerivedWithContext(g.agg, parentAgg, totalAgg) : g.agg;
        out.push({ isParent: false, hasOwnCol: true, label: g.vals[dimIndex], depth: dimIndex, agg: leafAgg, groupVals: g.vals, children: [] });
      }
    } else {
      const groupKey = makeGroupKey(path);
      // 転置 (列) 専用パスなので列用の状態だけ見る
      const isCollapsed = collapsedColumnGroups.has(groupKey);
      const myAgg = sumAggs(bucket.map(g => g.agg), parentAgg, totalAgg);
      if (!levelKeys[dimIndex]) levelKeys[dimIndex] = new Set();
      levelKeys[dimIndex].add(groupKey);
      const node = { isParent: true, hasOwnCol: false, label: val, depth: dimIndex, agg: myAgg, groupVals: path, groupKey, collapsed: isCollapsed, children: [] };
      // 配下を先に構築する。表示順が「子 → 小計」なので、100 列の消費順も同じにしないと
      // 「先頭 100 列」の注意書きと実際に残る列がズレる。
      if (!isCollapsed) node.children = buildColumnTree(bucket, dims, dimIndex + 1, path, myAgg, totalAgg, state, showSub);
      // 親自身の列は「折り畳み中 (唯一の列なので必須)」か「小計ON」のときだけ、配下の後ろに計上。
      if (isCollapsed || showSub(dimIndex)) {
        if (state.count < TRANSPOSE_MAX_COLS) { state.count++; node.hasOwnCol = true; }
        else state.truncated = true;
      }
      // 列が 1 本も無い親 (配下が全部打ち切られ、自分の列も無い) は描画しない
      if (node.hasOwnCol || node.children.length) out.push(node);
    }
  }
  return out;
}

// ツリー → 実際の列並び。本体セルの並びはこれに従う。
// 配下を先に出し、親自身の集計列「計」はそのグループの最終列に置く。
// (ヘッダーの walkHead も同じ順序で積むこと。ズレると列が総崩れする)
//
// showSub(depth)=false ならその階層の展開中の親の「計」列は出さない。ただし折り畳み中の親は
// 「計」列がそのグループ唯一の列なので、設定に関わらず必ず出す (消すとグループが消える)。
function flattenColumns(nodes, out = []) {
  for (const n of nodes) {
    if (n.children.length) flattenColumns(n.children, out);
    if (n.hasOwnCol) out.push(n);
  }
  return out;
}

// そのノードが占める列数 (展開中の配下 + 「計」列)。flattenColumns と同じ条件で数えること。
function nodeSpan(n) {
  let s = n.hasOwnCol ? 1 : 0;
  for (const c of n.children) s += nodeSpan(c);
  return s;
}

// 転置の複数行ヘッダーは thead th { position:sticky; top:0 } のままだと全行が
// 上端に重なってしまう。各行の高さを測って top を積み上げる。
// (rowspan のセルは自分が始まる行の top になるので、行単位で当てれば正しい)
// zoom で高さが変わるため applyZoom の後に呼ぶこと。
let _headObserver = null;
let _headRaf = 0;
function applyTransposeHeadOffsets() {
  const table = document.getElementById('data-table');
  if (!table) return;
  let top = 0;
  table.querySelectorAll('thead tr').forEach(tr => {
    tr.querySelectorAll('th').forEach(th => { th.style.top = top + 'px'; });
    top += tr.offsetHeight;
  });
}
// ヘッダー画像は loading="lazy" なので、読み込み後に行の高さが変わって
// 下段ヘッダーが上段に重なる。thead の高さ変化を監視して top を積み直す。
// 再描画のたびに古い observer を解除すること (通常表示へ戻した時も解除)。
function observeTransposeHead() {
  disconnectTransposeHead();
  const thead = document.querySelector('#data-table thead');
  if (!thead || typeof ResizeObserver === 'undefined') return;
  _headObserver = new ResizeObserver(() => {
    // 多重発火を 1 フレームにまとめる
    if (_headRaf) return;
    _headRaf = requestAnimationFrame(() => { _headRaf = 0; applyTransposeHeadOffsets(); });
  });
  _headObserver.observe(thead);
}
function disconnectTransposeHead() {
  if (_headObserver) { _headObserver.disconnect(); _headObserver = null; }
  if (_headRaf) { cancelAnimationFrame(_headRaf); _headRaf = 0; }
}

// 列打ち切り時の注意書き。テーブル本体の外 (.table-wrap の手前) に出して、
// 横スクロールに巻き込まれないようにする。msg が空なら消す。
function setTransposeNotice(msg) {
  const area = document.getElementById('table-area');
  if (!area) return;
  let el = document.getElementById('transpose-notice');
  if (!msg) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'transpose-notice';
    el.className = 'transpose-notice';
    area.insertBefore(el, area.querySelector('.table-wrap') || null);
  }
  el.textContent = msg;
}

// 転置ヘッダーに出すディメンション値の中身。
// 通常表示 (dimCellHtml) と同じ種別判定・同じ URL 安全判定・同じ見た目にする。
// 危険/空の URL は通常テキストへフォールバックするのも同様。
function tposeHeaderInner(dimKey, value) {
  const def = S.DIMENSIONS?.find(d => d.key === dimKey);
  const isImage = def?.type === 'image';
  const isLink  = def?.type === 'link';
  const hasValue = value != null && value !== '';
  const urlSafe = hasValue && (isImage ? isSafeImageSrc(String(value)) : isLink ? isSafeLink(String(value)) : false);
  if (!urlSafe) return `<span class="tpose-col-label">${escapeHtml(value)}</span>`;
  const href = escapeHtml(value);
  if (isImage) {
    const sizeParts = [];
    if (def.imageHeight) sizeParts.push(`max-height:${def.imageHeight}px;height:${def.imageHeight}px`);
    if (def.imageWidth)  sizeParts.push(`max-width:${def.imageWidth}px`);
    const sizeAttr = sizeParts.length ? ` style="${sizeParts.join(';')}"` : '';
    const img = `<img class="dim-image" src="${href}"${sizeAttr} alt="" loading="lazy" referrerpolicy="no-referrer" title="${href}" onerror="this.outerHTML='<span class=&quot;dim-image-broken&quot;></span>'">`;
    return `<a class="dim-link" href="${href}" target="_blank" rel="noopener noreferrer" title="${href}">${img}</a>`;
  }
  return `<a class="dim-link" href="${href}" target="_blank" rel="noopener noreferrer" title="${href}"><span class="dim-link-label">${escapeHtml(value)}</span></a>`;
}

// 転置表示の thead/tbody を組み立てる。
function buildTransposed(groups, dims, metrics, totalAgg) {
  for (let i = 0; i < groups.length; i++) {
    if (!groups[i].agg) groups[i].agg = aggregate(groups[i].rows);
  }
  allGroupKeys = collectGroupKeys(groups, dims.length);

  // 「計」(親の小計列) を階層ごとに出すか。折り畳み中の親は設定に関わらず必ず出す (唯一の列のため)。
  const showSub = d => subtotalAt(S.TABLE_CONFIG, d);
  const state = { truncated: false, count: 0 };
  const tree = groups.length ? buildColumnTree(groups, dims, 0, [], totalAgg, totalAgg, state, showSub) : [];
  const nodes = flattenColumns(tree);   // 本体セルの並び (配下 → 計)

  const depthOpts = { skipColStyle: !!S.TABLE_CONFIG?.table?.depthPriority };
  const totOpts   = { skipColStyle: !!S.TABLE_CONFIG?.table?.totalPriority };
  const showTotal = !!(S.TABLE_CONFIG?.showTotal && groups.length && totalAgg);

  // ===== ヘッダー: ディメンションの階層ごとに 1 行 =====
  // 親は配下の列数だけ colspan して見出しになり、その 1 つ下の行に親自身の集計列「計」が入る。
  // 左端 (ディメンション名 / 総計) は全ヘッダー行を rowspan で貫く。
  // 1 ディメンションのときは行数 1 = 従来と同じ単一行ヘッダーになる。
  const headRowCount = Math.max(1, dims.length);
  const headRows = Array.from({ length: headRowCount }, () => []);

  const cornerLabel = dims.map(d => dimLabel(d)).join(' / ');
  const rs = headRowCount > 1 ? ` rowspan="${headRowCount}"` : '';
  headRows[0].push(`<th class="group-col tpose-corner"${rs}>${escapeHtmlNl(cornerLabel)}<span class="col-resizer"></span></th>`);
  if (showTotal) headRows[0].push(`<th class="tpose-total-col"${rs}>総計<span class="col-resizer"></span></th>`);

  // ノード 1 つ分のヘッダーセル。dims[depth] のヘッダースタイルを当てる
  // (親列と末端列で階層が違うので depth で引く)。
  const headCell = (n, depth, colspan, rowspan, label, isSub) => {
    const style = buildHeaderCellStyle('dim:' + dims[depth]);
    const toggle = (n && n.isParent && !isSub)
      ? `<button type="button" class="pivot-toggle" data-pivot-key="${escapeHtml(n.groupKey)}" data-pivot-level="${n.depth}">${n.collapsed ? '+' : '−'}</button>`
      : '';
    const cls = 'tpose-col' + (n && n.isParent && !isSub ? ' tpose-parent-col' : '') + (isSub ? ' tpose-subtotal-col' : '');
    const cs = colspan > 1 ? ` colspan="${colspan}"` : '';
    const rsAttr = rowspan > 1 ? ` rowspan="${rowspan}"` : '';
    const inner = isSub ? `<span class="tpose-col-label">${escapeHtml(label)}</span>` : tposeHeaderInner(dims[depth], label);
    // colspan で複数列を束ねた見出しはリサイズ対象にしない。
    // 物理列と 1:1 でないため、掴むと子列への幅配分がブラウザ任せになりヘッダーとデータがズレる。
    const resizer = colspan > 1 ? '' : '<span class="col-resizer"></span>';
    return `<th class="${cls}" data-tpose-depth="${depth}"${cs}${rsAttr}${style ? ` style="${style}"` : ''}>${toggle}${inner}${resizer}</th>`;
  };

  (function walkHead(list) {
    for (const n of list) {
      if (!n.isParent) {
        // 末端 (最終ディメンション) は最下段
        headRows[n.depth].push(headCell(n, n.depth, 1, 1, n.label, false));
        continue;
      }
      if (n.collapsed) {
        // 折り畳み中は自分の集計列 1 本のみ。見出しを最下段まで貫かせ、冗長な「計」行は出さない。
        if (!n.hasOwnCol) continue;   // 打ち切りで列が無い
        headRows[n.depth].push(headCell(n, n.depth, 1, headRowCount - n.depth, n.label, false));
        continue;
      }
      const span = nodeSpan(n);
      if (span <= 0) continue;  // 打ち切りで配下が無く「計」も出さない場合は列が無いので描かない
      // 親: 配下すべてを束ねる見出し
      headRows[n.depth].push(headCell(n, n.depth, span, 1, n.label, false));
      // 配下を先に積む (flattenColumns と同じ順序にすること)
      if (n.children.length) walkHead(n.children);
      // 親自身の集計列「計」はグループの最終列。1 つ下の行から最下段まで貫く
      if (n.hasOwnCol) headRows[n.depth + 1].push(headCell(null, n.depth, 1, headRowCount - 1 - n.depth, '計', true));
    }
  })(tree);

  const headerHtml = headRows.map(cells => `<tr>${cells.join('')}</tr>`).join('');

  // 本体: 1 行 = 1 メトリクス。行頭セルはそのメトリクスのヘッダー扱い。
  const bodyRows = metrics.map(m => {
    const nameStyle = buildHeaderCellStyle(m.key);
    const nameCell = `<td class="group-col tpose-metric-name"${nameStyle ? ` style="${nameStyle}"` : ''}>${escapeHtmlNl(m.label)}</td>`;
    // 総計セルは行版の総計行と同じく groupVals=null (sparkline は空セル)
    const totalCell = showTotal ? metricCellHtml(m, totalAgg, totOpts, null, 'tpose-total-cell') : '';
    // 列の階層 (親=depth N / 末端) をセルに付与し、行版の階層色と同じ CSS 変数を効かせる。
    // 行版と同じく class は常に付け、階層色優先 (skipColStyle) で inline が消えた時に色が見える。
    const cells = nodes.map(n => {
      const cellCls = n.isParent ? `tpose-parent-cell tpose-depth-${n.depth}` : 'tpose-leaf-cell';
      return metricCellHtml(m, n.agg, depthOpts, n.groupVals, cellCls);
    }).join('');
    return `<tr class="tpose-row">${nameCell}${totalCell}${cells}</tr>`;
  }).join('');

  // 階層ヘッダー (複数ディメンション) では親見出しが colspan するため、
  // 固定できるのは rowspan で全ヘッダー行を貫く左端 (メトリクス名 [+ 総計]) まで。
  // 単一ディメンションはヘッダーが 1 行 = 列と 1:1 なので全列を固定対象にできる。
  const colCount = 1 + (showTotal ? 1 : 0) + nodes.length;
  const freezable = dims.length >= 2 ? (1 + (showTotal ? 1 : 0)) : colCount;
  return {
    headerHtml,
    bodyRows,
    freezable,
    truncated: state.truncated,
  };
}

function renderToolbar(dims) {
  const toolbar = document.getElementById('table-toolbar');
  if (!toolbar) return;

  // Don't re-render toolbar if freeze input is focused
  const freezeInput = document.getElementById('toolbar-freeze-val');
  if (freezeInput && document.activeElement === freezeInput) {
    toolbar.classList.remove('hidden');
    return;
  }

  toolbar.classList.remove('hidden');

  // Frozen columns control (上限は実描画列数。転置/通常で共通)
  // 表示は実効値。保存値 frozenCount はユーザー操作時のみ変更する。
  const totalCols = maxFrozenCols();
  const curFrozen = effectiveFrozenCount();
  const decDis = curFrozen <= 0 ? ' disabled' : '';
  const incDis = curFrozen >= totalCols ? ' disabled' : '';
  let html = '<div class="toolbar-group">'
    + '<span class="toolbar-label">\u56fa\u5b9a\u5217</span>'
    + '<button type="button" class="toolbar-zoom-btn" data-toolbar-action="freeze-dec"' + decDis + '>\u2212</button>'
    + '<input type="text" class="toolbar-num-input" id="toolbar-freeze-val" value="' + effectiveFrozenCount() + '" inputmode="numeric" data-toolbar-action="freeze-input">'
    + '<button type="button" class="toolbar-zoom-btn" data-toolbar-action="freeze-inc"' + incDis + '>+</button>'
    + '</div>';

  // Zoom control
  html += '<div class="toolbar-group">'
    + '<span class="toolbar-label">\u500d\u7387</span>'
    + '<button type="button" class="toolbar-zoom-btn" data-toolbar-action="zoom-out">\u2212</button>'
    + '<span class="toolbar-zoom-val" id="toolbar-zoom-val">' + tableZoom + '%</span>'
    + '<button type="button" class="toolbar-zoom-btn" data-toolbar-action="zoom-in">+</button>'
    + '<button type="button" class="link-btn" data-toolbar-action="zoom-reset">\u30ea\u30bb\u30c3\u30c8</button>'
    + '</div>';

  // Hierarchy controls (only when 2+ dims)
  if (dims.length >= 2) {
    const levels = dims.slice(0, -1);
    html += '<div class="toolbar-group"><span class="toolbar-label">\u5168\u4f53</span>'
      + '<button type="button" class="link-btn" data-toolbar-action="expand-all">\u5c55\u958b</button>'
      + '<button type="button" class="link-btn" data-toolbar-action="collapse-all">\u6298\u308a\u305f\u305f\u307f</button></div>';

    levels.forEach((dimKey, i) => {
      const label = dimLabel(dimKey);
      html += `<div class="toolbar-group"><span class="toolbar-label">${escapeHtml(label)}</span>`
        + `<button type="button" class="link-btn" data-toolbar-action="expand-level" data-level="${i}">\u5c55\u958b</button>`
        + `<button type="button" class="link-btn" data-toolbar-action="collapse-level" data-level="${i}">\u6298\u308a\u305f\u305f\u307f</button></div>`;
    });
  }

  html += '<div class="toolbar-spacer"></div>';
  html += '<button type="button" class="csv-download-btn" id="csv-download-btn">'
    + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
    + 'CSV</button>';
  html += '<button type="button" class="toolbar-zoom-btn" id="table-settings-btn" data-toolbar-action="open-settings" title="テーブル設定">⚙</button>';
  // 全画面トグル: ⛶ ↔ ⤡。アクティブ状態は table-area の is-fullscreen クラスで判別。
  const isFs = document.getElementById('table-area')?.classList.contains('is-fullscreen');
  html += `<button type="button" class="toolbar-zoom-btn" id="table-fullscreen-btn" data-toolbar-action="toggle-fullscreen" title="${isFs ? '全画面解除 (Esc)' : '全画面表示'}">${isFs ? '⤡' : '⛶'}</button>`;

  toolbar.innerHTML = html;
}

function applyFrozenColumns() {
  const frozen = effectiveFrozenCount();
  if (frozen <= 0) return;
  const table = document.getElementById('data-table');
  if (!table) return;
  // Get header ths to measure widths
  const ths = table.querySelectorAll('thead th');
  const lefts = [];
  let cumLeft = 0;
  for (let i = 0; i < frozen && i < ths.length; i++) {
    lefts.push(cumLeft);
    ths[i].classList.add('col-frozen');
    ths[i].style.left = cumLeft + 'px';
    cumLeft += ths[i].offsetWidth;
  }
  // Apply to all body rows + thead total row (総計行は thead 2 行目にある)
  table.querySelectorAll('tbody tr, thead .total-row').forEach(tr => {
    const tds = tr.children;
    for (let i = 0; i < frozen && i < tds.length; i++) {
      tds[i].classList.add('col-frozen');
      tds[i].style.left = lefts[i] + 'px';
    }
  });
}

function applyZoom() {
  const table = document.getElementById('data-table');
  if (table) {
    const baseFontSize = 12;
    table.style.fontSize = (baseFontSize * tableZoom / 100) + 'px';
    // thead 1 行目の高さを measure して総計行の sticky top に反映 (zoom 後に再計算が必要)。
    const firstRow = table.querySelector('thead tr:first-child');
    if (firstRow) table.style.setProperty('--head-row1-h', firstRow.offsetHeight + 'px');
  }
  const label = document.getElementById('toolbar-zoom-val');
  if (label) label.textContent = tableZoom + '%';
  try { localStorage.setItem(ZOOM_KEY, String(tableZoom)); } catch (e) {}
}

export function renderTable(groups) {
  const metrics = S.SELECTED_METRICS.map(k => S.METRIC_DEFS.find(m => m.key === k)).filter(Boolean);
  const dims = S.SELECTED_DIMS;
  // フィルタ適用 (groups[] = leaf 相当を絞る → 親集計も自動的にフィルタ後の値に)
  const filters = S.TABLE_CONFIG?.filters;
  if (filters && Object.keys(filters).length) {
    groups = groups.filter(g => passesFilter(g, dims, filters));
  }
  const cols = [
    ...dims.map(k => ({key: 'dim:' + k, label: dimLabel(k), isDim: true, defW: 130})),
    ...metrics.map(m => ({key: 'met:' + m.key, label: m.label, isDim: false, defW: 110})),
  ];
  freezableColCount = cols.length;
  const colgroup = '';
  // 列スタイルの key: metric は metric.key, dim は 'dim:<dimKey>'
  const headerCells = cols.map(c => {
    const styleKey = c.isDim ? ('dim:' + c.key.replace(/^dim:/, '')) : c.key.replace(/^met:/, '');
    const style = buildHeaderCellStyle(styleKey);
    return `<th class="${c.isDim ? 'group-col' : ''}" data-col-key="${c.key}"${style ? ` style="${style}"` : ''}>${escapeHtmlNl(c.label)}<span class="col-resizer"></span></th>`;
  }).join('');

  let bodyRows = '';
  levelKeys = [];

  // 全体総計 = parent()/total() の解決元。1 回計算してテーブル全体で使い回す。
  // ここで一度 derived を「self-referencing で評価」しておくことで、parent(X) / total(X) が
  // 「自分自身の値」になる (= 比率なら 1.0)。総計行の表示にも使う。
  let totalAgg = null;
  if (groups.length) {
    const baseTotal = sumAggs(groups.map(g => g.agg || aggregate(g.rows)));
    totalAgg = evalDerivedWithContext(baseTotal, baseTotal, baseTotal);
  }

  // 転置表示: メトリクスを行、ディメンション値を列にする。
  // 以降の通常パスとは完全に分離し、OFF 時は一切通らない。
  if (S.TABLE_CONFIG?.transpose && dims.length) {
    const t = buildTransposed(groups, dims, metrics, totalAgg);
    freezableColCount = t.freezable;   // 固定列の上限判定より前に更新する
    renderToolbar(dims);
    const table = document.getElementById('data-table');
    table.style.width = '';
    table.style.cssText = buildTableStyle();
    table.innerHTML = `<thead>${t.headerHtml}</thead><tbody>${t.bodyRows}</tbody>`;
    setTransposeNotice(t.truncated ? `列が多いため先頭 ${TRANSPOSE_MAX_COLS} 列のみ表示しています` : '');
    applyZoom();
    applyTransposeHeadOffsets();  // 複数ヘッダー行の sticky top を積み上げる (zoom 反映後に測る)
    observeTransposeHead();       // 画像読込で高さが変わったら積み直す
    applyFrozenColumns();
    return;
  }
  setTransposeNotice('');
  disconnectTransposeHead();   // 通常表示では複数段ヘッダーが無いので監視不要

  if (dims.length >= 2) {
    bodyRows = buildFromGroups(groups, dims, metrics, dims.length, totalAgg);
  } else {
    const depthOpts = { skipColStyle: !!S.TABLE_CONFIG?.table?.depthPriority };
    // 単一 dim パス: groups を直接ソート。複数キー対応。
    const sortList = sortListFrom(S.TABLE_CONFIG?.sort);
    let sortedGroups = groups;
    if (sortList.length) {
      const compareOne = (s, a, b) => {
        if (!s || !s.col) return 0;
        const dir = s.dir === 'desc' ? -1 : 1;
        if (s.col.startsWith('dim:')) {
          if (s.col !== 'dim:' + dims[0]) return 0;
          const customList = (s.custom || '').split('\n').map(x => x.trim()).filter(Boolean);
          const va = a.vals[0], vb = b.vals[0];
          if (customList.length) {
            const r = (customSortIndex(va, customList) - customSortIndex(vb, customList)) * dir;
            if (r !== 0) return r;
          }
          return dimSort(dims[0], va, vb) * dir;
        }
        const aAgg = a.agg || aggregate(a.rows);
        const bAgg = b.agg || aggregate(b.rows);
        return ((aAgg[s.col] || 0) - (bAgg[s.col] || 0)) * dir;
      };
      sortedGroups = [...groups].sort((a, b) => {
        for (const s of sortList) {
          const r = compareOne(s, a, b);
          if (r !== 0) return r;
        }
        return dimSort(dims[0], a.vals[0], b.vals[0]);
      });
    }
    bodyRows = sortedGroups.map(g => {
      // 単一 dim でも parent()/total() を解決可能に (parent も total も全体総計を指す)。
      const baseAgg = g.agg || aggregate(g.rows);
      const agg = totalAgg ? evalDerivedWithContext(baseAgg, totalAgg, totalAgg) : baseAgg;
      const dimCells = g.vals.map((v, i) => dimCellHtml(dims[i], v, '', null, i, depthOpts)).join('');
      const metCells = buildMetricCells(agg, metrics, depthOpts, g.vals);
      return `<tr>${dimCells}${metCells}</tr>`;
    }).join('');
  }

  // 総計行 (上部に表示)。renderTable 冒頭で計算した totalAgg をそのまま使う。
  // <thead> に入れることで、2 行目として自動的に sticky-top で 1 行目の下に
  // 重なる挙動になる。
  let totalRow = '';
  if (S.TABLE_CONFIG?.showTotal && groups.length && totalAgg) {
    // totalPriority=ON のとき、列ごとのインライン style を抑止して総計行 CSS 変数を優先。
    const totOpts = { skipColStyle: !!S.TABLE_CONFIG?.table?.totalPriority };
    const dimCells = dims.map((dk, i) => dimCellHtml(dk, '', 'total-label', i === 0 ? '総計' : '', i, totOpts)).join('');
    const metCells = buildMetricCells(totalAgg, metrics, totOpts);
    totalRow = `<tr class="total-row">${dimCells}${metCells}</tr>`;
  }

  renderToolbar(dims);

  const table = document.getElementById('data-table');
  table.style.width = '';
  // テーブル全体の color/background (table.color / table.bgColor) を inline で当てる。
  // 個別の cell style はさらに優先される (inline + 子要素 inline)。
  const tableStyle = buildTableStyle();
  table.style.cssText = tableStyle;
  table.innerHTML = `${colgroup}<thead><tr>${headerCells}</tr>${totalRow}</thead><tbody>${bodyRows}</tbody>`;
  applyZoom();
  applyFrozenColumns();
}

function rerender() {
  // emit を microtask に遅延させて呼び出し元 (トグル/ツールバーの click ハンドラ) を
  // 先に完了させる。旧実装は dynamic import の .then() でこの遅延を得ていたが、
  // code-split されないため static import + queueMicrotask に統一 (遅延タイミングは同一)。
  queueMicrotask(() => emit('render'));
}

// Toggle individual group
document.getElementById('data-table').addEventListener('click', e => {
  const btn = e.target.closest('.pivot-toggle');
  if (!btn) return;
  const key = btn.dataset.pivotKey;
  const collapsed = activeCollapsed();  // 現在の表示モード (行 / 列) の状態だけを操作する
  if (collapsed.has(key)) collapsed.delete(key);
  else collapsed.add(key);
  rerender();
});

// Toolbar actions
document.getElementById('table-toolbar').addEventListener('click', e => {
  const btn = e.target.closest('[data-toolbar-action]');
  if (!btn) return;
  const action = btn.dataset.toolbarAction;
  const level = btn.dataset.level != null ? +btn.dataset.level : null;

  // 展開/折りたたみ系はすべて現在の表示モード (行 / 列) の状態だけに反映する
  const collapsed = activeCollapsed();
  if (action === 'expand-all') {
    collapsed.clear();
  } else if (action === 'collapse-all') {
    // DOM の querySelectorAll では subtree が collapsed のときに deeper level の key を拾えないので、
    // データツリーから事前収集した allGroupKeys を使う (collectGroupKeys 参照)。
    for (const k of allGroupKeys) collapsed.add(k);
  } else if (action === 'expand-level' && level != null) {
    // Expand all at this level
    document.querySelectorAll(`.pivot-toggle[data-pivot-level="${level}"]`).forEach(t => {
      collapsed.delete(t.dataset.pivotKey);
    });
  } else if (action === 'collapse-level' && level != null) {
    document.querySelectorAll(`.pivot-toggle[data-pivot-level="${level}"]`).forEach(t => {
      collapsed.add(t.dataset.pivotKey);
    });
  } else if (action === 'zoom-in') {
    tableZoom = Math.min(200, tableZoom + 10);
    try { localStorage.setItem(ZOOM_KEY, String(tableZoom)); } catch (e) {}
  } else if (action === 'zoom-out') {
    tableZoom = Math.max(50, tableZoom - 10);
    try { localStorage.setItem(ZOOM_KEY, String(tableZoom)); } catch (e) {}
  } else if (action === 'zoom-reset') {
    tableZoom = DEFAULT_ZOOM;
    try { localStorage.setItem(ZOOM_KEY, String(tableZoom)); } catch (e) {}
  } else if (action === 'freeze-inc') {
    // 上限に達していたら完全な no-op。ここで Math.min を通すと
    // 「保存値 4 / 転置の上限 2」の状態で + を押しただけで保存値が 2 に潰れる。
    const cur = effectiveFrozenCount();
    if (cur >= maxFrozenCols()) return;
    frozenCount = cur + 1;
  } else if (action === 'freeze-dec') {
    const cur = effectiveFrozenCount();
    if (cur <= 0) return;   // 下限も no-op (保存値を 0 に潰さない)
    frozenCount = cur - 1;
  } else if (action === 'open-settings') {
    openTableSettings();
    return; // no rerender needed
  } else if (action === 'toggle-fullscreen') {
    toggleTableFullscreen();
    return;
  }
  rerender();
});

// 全画面表示の ON/OFF。CSS で position:fixed; inset:0 を当てるだけで Browser
// Fullscreen API は使わない (固定列の measure、ツールバーの sticky、設定パネル
// との重なりを自前で制御したいため)。
//
// 追従フィルタ (#filters-bar) は通常時 .main の直下にあり全画面表示 (fixed: inset:0)
// では画面外に押し出される。全画面中も操作できるよう、fullscreen 開始時に
// #filters-bar を #table-area の中に移動し、解除時に元の場所へ戻す。
let _filtersBarOriginalParent = null;
let _filtersBarOriginalNext = null;
function toggleTableFullscreen() {
  const area = document.getElementById('table-area');
  if (!area) return;
  const next = !area.classList.contains('is-fullscreen');
  area.classList.toggle('is-fullscreen', next);
  document.body.classList.toggle('table-fullscreen', next);
  const filtersBar = document.getElementById('filters-bar');
  if (filtersBar) {
    if (next) {
      _filtersBarOriginalParent = filtersBar.parentNode;
      _filtersBarOriginalNext = filtersBar.nextSibling;
      area.insertBefore(filtersBar, area.firstChild);
    } else if (_filtersBarOriginalParent && _filtersBarOriginalParent.isConnected) {
      _filtersBarOriginalParent.insertBefore(filtersBar, _filtersBarOriginalNext);
      _filtersBarOriginalParent = null;
      _filtersBarOriginalNext = null;
    } else {
      // parent が既に detach されていた場合の fallback: .main の先頭に戻す
      const main = document.querySelector('.main');
      if (main) main.insertBefore(filtersBar, main.firstChild);
      _filtersBarOriginalParent = null;
      _filtersBarOriginalNext = null;
    }
  }
  rerender();
}
// Esc キーで解除
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const area = document.getElementById('table-area');
  if (area?.classList.contains('is-fullscreen')) {
    // 入力中は誤爆させない
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    toggleTableFullscreen();
  }
});

// Freeze input: apply on Enter or blur
function handleFreezeInput(input) {
  // 表示していた実効値と比較する。focusout でも呼ばれるので、frozenCount と比べると
  // 「上限で縮んで表示されていた値」がそのまま保存値を上書きしてしまう。
  const shown = effectiveFrozenCount();
  const v = Math.max(0, Math.min(maxFrozenCols(), Math.round(+input.value) || 0));
  if (v !== shown) {
    frozenCount = v;   // ユーザーが実際に変えた時だけ保存値を更新
    rerender();
  } else {
    input.value = shown;
  }
}
document.getElementById('table-toolbar').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset.toolbarAction === 'freeze-input') {
    e.preventDefault();
    handleFreezeInput(e.target);
    e.target.blur();
  }
});
document.getElementById('table-toolbar').addEventListener('focusout', e => {
  if (e.target.dataset?.toolbarAction === 'freeze-input') {
    handleFreezeInput(e.target);
  }
});
