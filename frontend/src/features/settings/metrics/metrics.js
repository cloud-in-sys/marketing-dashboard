import { S, DEFAULT_BASE_FORMULAS, DEFAULT_FORMULAS,
  saveMetricDefs, saveFormulas, saveBaseFormulas } from '../../../app/state.js';
import { flushConfigNow, clearPendingConfigKeys } from '../../../app/persistence.js';
import { escapeHtml } from '../../../shared/utils/utils.js';
import { showModal } from '../../../shared/ui/modal.js';
import { parseBaseFormula, isPureBaseFormula } from '../../../aggregate/aggregate.js';
import { hasPerm } from '../../../app/auth.js';
import { renderViewNav } from '../../presets/tabs.js';
import { emit } from '../../../app/events.js';
import { makeSortable } from '../../../shared/ui/sortable.js';
import { buildSaveErrorMessage, setSaveButtonState } from '../saveFlow.js';

// 式の validation は保存ボタン押下時の backend PATCH に任せる。
// 旧実装は keystroke ごとに debounce validate していたが、
// 「1 文字入力 = API」を避けるため live 判定は廃止 (typo は保存時にエラー表示)。

// ----- DIRTY FLAGS -----
export function markMetricsDirty() {
  document.getElementById('metrics-save-btn')?.classList.add('dirty');
}
export function clearMetricsDirty() {
  document.getElementById('metrics-save-btn')?.classList.remove('dirty');
}

// ----- METRICS VIEW -----
export function renderMetricsDoc() {
  const el = document.getElementById('metrics-doc');
  if (!el) return;
  const defs = S.METRIC_DEFS_DRAFT || S.METRIC_DEFS;
  const baseSrc = S.METRICS_DRAFT_BASE || S.BASE_FORMULAS;
  const derivedSrc = S.METRICS_DRAFT || S.METRIC_FORMULAS;
  const fmtOptions = [{v:'int', l:'整数'}, {v:'dec2', l:'小数第2位'}, {v:'yen', l:'¥金額'}, {v:'pct', l:'%割合'}];
  const renderRow = (m, i) => {
    const formula = m.type === 'base'
      ? (baseSrc[m.key] || DEFAULT_BASE_FORMULAS[m.key] || '')
      : (derivedSrc[m.key] || DEFAULT_FORMULAS[m.key] || '');
    return `<div class="metrics-doc-row" data-def-idx="${i}" data-drag-key="${i}" draggable="true">
      <div class="metrics-doc-row-head">
        <span class="drag-handle" data-drag-handle title="ドラッグで並び替え (同じ種類の中でのみ)">⋮⋮</span>
        <div class="field-col"><label class="field-label">名称</label><textarea class="metric-label-input" data-def-label draggable="false" rows="${Math.max(1, Math.min(5, String(m.label || '').split('\n').length))}" placeholder="表示名 (Enter で改行・最大5行)"></textarea></div>
        <div class="field-col"><label class="field-label">キー</label><input type="text" class="metric-key-input" data-def-key draggable="false" value="${escapeHtml(m.key)}" placeholder="key"></div>
        <div class="field-col"><label class="field-label">書式</label><select class="metric-fmt-select" data-def-fmt draggable="false">
          ${fmtOptions.map(o => `<option value="${o.v}"${m.fmt===o.v?' selected':''}>${o.l}</option>`).join('')}
        </select></div>
        <button type="button" class="metric-del" data-def-remove="${i}" title="削除">×</button>
      </div>
      <label class="field-label">計算式</label>
      <input type="text" class="metric-formula-input" data-def-formula="${i}" draggable="false" value="${escapeHtml(formula)}" placeholder="${m.type==='base'?"sum(column) where funnel = '広告'":'ad_cost / clicks'}">
    </div>`;
  };
  const baseRows = defs.map((m, i) => ({m, i})).filter(x => x.m.type === 'base');
  const derivedRows = defs.map((m, i) => ({m, i})).filter(x => x.m.type === 'derived');
  // 既存の基礎メトリクスにルール違反 (単一集計でない式) があれば警告を出す。
  // ピボット親行で値が壊れるので「派生」に変える必要がある旨を案内。
  const violators = baseRows
    .map(x => ({ m: x.m, formula: (baseSrc[x.m.key] || DEFAULT_BASE_FORMULAS[x.m.key] || '') }))
    .filter(x => x.formula && !isPureBaseFormula(x.formula));
  const warningHtml = violators.length
    ? `<div class="metrics-doc-warning">
        <strong>⚠ 基礎メトリクスのルール違反があります</strong>
        <div>以下は「単一の集計関数」になっていないため、多重ディメンションのピボット親行で値が壊れます。「派生」型に変更し、式は基礎メトリクスを参照する形 (例: <code>clicks / impression</code>) に書き換えてください。</div>
        <ul>${violators.map(v => `<li><strong>${escapeHtml(v.m.label || v.m.key)}</strong>: <code>${escapeHtml(v.formula)}</code></li>`).join('')}</ul>
      </div>`
    : '';
  el.innerHTML = `
    <details class="metrics-syntax-help" id="metrics-syntax-help">
      <summary>計算式の書き方 (クリックで展開)</summary>
      <div class="metrics-syntax-help-body">
        <p style="margin:0 0 10px;color:var(--muted);font-size:12px">トピックごとに開閉できます。基本以外は必要なときだけ開いてください。</p>

        <details class="metrics-syntax-help-section">
          <summary><strong>基本</strong> — 式の組み立て</summary>
          <p>「集計関数」「算術演算」「他メトリクス参照」を自由に組み合わせて書けます。基礎/派生の分類は表示用のグループ分けで、書ける式は同じです。</p>
          <div class="metrics-help-table-wrap"><table>
            <tr><th>例</th><th>意味</th></tr>
            <tr><td><code>sum(revenue)</code></td><td>集計のみ</td></tr>
            <tr><td><code>cost / clicks</code></td><td>他メトリクス参照のみ (旧派生)</td></tr>
            <tr><td><code>sum(revenue) - sum(cost)</code></td><td>集計を組み合わせ</td></tr>
            <tr><td><code>profit / sum(cost) * 100</code></td><td>参照と集計の混在</td></tr>
          </table></div>
        </details>

        <details class="metrics-syntax-help-section">
          <summary><strong>集計関数</strong> — sum / count / avg / min / max / countDistinct</summary>
          <div class="metrics-help-table-wrap"><table>
            <tr><th>関数</th><th>説明</th><th>例</th></tr>
            <tr><td><code>sum(field)</code></td><td>合計</td><td><code>sum(applications)</code></td></tr>
            <tr><td><code>count()</code></td><td>行数</td><td><code>count()</code></td></tr>
            <tr><td><code>count(field)</code></td><td>field が空でない行数</td><td><code>count(email)</code></td></tr>
            <tr><td><code>avg(field)</code></td><td>平均</td><td><code>avg(price)</code></td></tr>
            <tr><td><code>min(field)</code></td><td>最小</td><td><code>min(score)</code></td></tr>
            <tr><td><code>max(field)</code></td><td>最大</td><td><code>max(score)</code></td></tr>
            <tr><td><code>countDistinct(field)</code></td><td>ユニーク値の数</td><td><code>countDistinct(user_id)</code></td></tr>
          </table></div>
        </details>

        <details class="metrics-syntax-help-section">
          <summary><strong>WHERE 条件</strong> — 集計を絞り込む</summary>
          <p>集計関数のパレ内に <code>where</code> を書けます。<code>and</code> / <code>or</code> で連結可能。</p>
          <div class="metrics-help-table-wrap"><table>
            <tr><th>例</th><th>意味</th></tr>
            <tr><td><code>sum(revenue where status='完了')</code></td><td>パレ内 where (混合式での推奨)</td></tr>
            <tr><td><code>sum(revenue) where status='完了'</code></td><td>パレ外 where (単一集計のみ・旧書式互換)</td></tr>
            <tr><td><code>sum(x where a='1') - sum(y where b='2')</code></td><td>集計ごとに where を変える</td></tr>
          </table></div>
          <p>※ カラム名は英数字とアンダースコアのみ。日本語カラムは BigQuery 側で <code>AS</code> で英名にリネームしてください。</p>
        </details>

        <details class="metrics-syntax-help-section">
          <summary><strong>WHERE の比較演算子</strong> — = / != / contains / startsWith ...</summary>
          <div class="metrics-help-table-wrap"><table>
            <tr><th>演算子</th><th>意味</th><th>例</th></tr>
            <tr><td><code>=</code></td><td>等しい</td><td><code>status = '完了'</code></td></tr>
            <tr><td><code>!=</code></td><td>等しくない</td><td><code>status != 'cancelled'</code></td></tr>
            <tr><td><code>&lt;</code></td><td>未満</td><td><code>amount &lt; 100</code></td></tr>
            <tr><td><code>&lt;=</code></td><td>以下</td><td><code>amount &lt;= 100</code></td></tr>
            <tr><td><code>&gt;</code></td><td>超</td><td><code>amount &gt; 100</code></td></tr>
            <tr><td><code>&gt;=</code></td><td>以上</td><td><code>amount &gt;= 100</code></td></tr>
            <tr><td><code>contains</code></td><td>含む (部分一致)</td><td><code>name contains '広告'</code></td></tr>
            <tr><td><code>notContains</code></td><td>含まない</td><td><code>name notContains 'テスト'</code></td></tr>
            <tr><td><code>startsWith</code></td><td>〜で始まる (前方一致)</td><td><code>url startsWith 'https://'</code></td></tr>
            <tr><td><code>endsWith</code></td><td>〜で終わる (後方一致)</td><td><code>email endsWith '@example.com'</code></td></tr>
          </table></div>
        </details>

        <details class="metrics-syntax-help-section">
          <summary><strong>AND / OR の優先順位</strong> — 複雑な条件</summary>
          <p>AND が OR より優先されます (×が+より先と同じ)。明示的にグループ化したい時は <code>(...)</code> を使えます。</p>
          <div class="metrics-help-table-wrap"><table>
            <tr><th>式</th><th>意味</th></tr>
            <tr><td><code>status='完了' and amount &gt; 1000 or status='保留'</code></td><td>(完了 かつ 1000超) または 保留</td></tr>
            <tr><td><code>status='完了' and (category='A' or category='B')</code></td><td>完了 かつ (A または B)</td></tr>
            <tr><td><code>(status='A' or status='B') and amount &gt; 100</code></td><td>(A または B) かつ 100超</td></tr>
            <tr><td><code>count() where url startsWith 'https://'</code></td><td>URL が https:// で始まる</td></tr>
            <tr><td><code>sum(x where category notContains 'テスト')</code></td><td>category に「テスト」を含まない</td></tr>
          </table></div>
        </details>

        <details class="metrics-syntax-help-section">
          <summary><strong>today()</strong> — 今日の日付</summary>
          <p>WHERE 句で日付比較に使用。<code>today()-N</code> で N 日前、<code>today()+N</code> で N 日後。</p>
          <div class="metrics-help-table-wrap"><table>
            <tr><th>例</th><th>意味</th></tr>
            <tr><td><code>sum(count where date = today())</code></td><td>今日のみ</td></tr>
            <tr><td><code>sum(count where date &gt;= today()-7)</code></td><td>過去 7 日 (昨日含む)</td></tr>
            <tr><td><code>sum(count where date &gt;= today()-30 and date &lt; today())</code></td><td>直近 30 日 (今日除く)</td></tr>
          </table></div>
        </details>

        <details class="metrics-syntax-help-section">
          <summary><strong>parent() / total()</strong> — 親集計・全体総計の参照 (シェア計算)</summary>
          <p style="margin:0 0 10px;padding:8px 10px;background:#fef3c7;border-left:3px solid #f59e0b;font-size:12px"><strong>※ この関数はピボットテーブル上でしか正しく動きません</strong> (ディメンションを 1 つ以上選択した状態)。それ以外のビューでは <code>parent</code> と <code>total</code> は全て全体総計と等価になります。</p>
          <p>派生メトリクスの式で <code>parent(metric)</code> と書くと <strong>1 つ上の階層</strong> の値、<code>total(metric)</code> と書くと <strong>全体総計</strong> の値が取れます。データ行 (集計じゃない 1 行ごと) ・親集計行のそれぞれで、自分の親 / 全体に対するシェアを表現できます。</p>
          <div class="metrics-help-table-wrap"><table>
            <tr><th>式</th><th>意味</th></tr>
            <tr><td><code>ad_cost / parent(ad_cost)</code></td><td>親階層内シェア (例: 月内で各日の広告費比率)</td></tr>
            <tr><td><code>revenue / total(revenue)</code></td><td>全体シェア (テーブル全体に占める割合)</td></tr>
            <tr><td><code>(ad_cost / line_reg) - (parent(ad_cost) / parent(line_reg))</code></td><td>親階層 CPA との差分</td></tr>
            <tr><td><code>revenue / ad_cost - total(revenue) / total(ad_cost)</code></td><td>全体平均 ROI からの乖離</td></tr>
          </table></div>
          <p style="margin-top:6px;font-size:12px;color:var(--muted)">※ ピボットの最上位 (depth 0) 行では <code>parent</code> と <code>total</code> は同じ値 (= 全体総計) になります。<br>※ 単一ディメンションの場合も <code>parent</code> と <code>total</code> は等価。</p>
          <p style="margin-top:6px;font-size:12px;color:var(--muted)">引数に渡すのは <strong>メトリクスのキー名</strong> (例 <code>ad_cost</code>, <code>line_reg</code>) で、文字列ではなくそのまま書きます。</p>
        </details>

        <details class="metrics-syntax-help-section">
          <summary><strong>算術 / JavaScript 構文</strong> — 三項演算子・Math.*</summary>
          <p>集計値や他メトリクス値に対して <code>+ - * /</code>、三項演算子 (<code>? :</code>)、論理演算子 (<code>&amp;&amp;</code>, <code>||</code>)、<code>Math.*</code> が使えます。</p>
          <div class="metrics-help-table-wrap"><table>
            <tr><th>例</th><th>意味</th></tr>
            <tr><td><code>conversions / sessions * 100</code></td><td>CV 率 (%)</td></tr>
            <tr><td><code>Math.max(revenue, 0)</code></td><td>負数を 0 に丸める</td></tr>
            <tr><td><code>sessions &gt; 1000 ? bounce_rate : 0</code></td><td>セッション数が一定以上のときのみ</td></tr>
          </table></div>
        </details>

        <details class="metrics-syntax-help-section">
          <summary><strong>sparkline()</strong> — ミニ進捗バー</summary>
          <p>派生メトリクスの式で <code>sparkline(EXPR)</code> または <code>sparkline(EXPR, { オプション1: 値1, オプション2: 値2 })</code> と書くと、その列のセルに「行の値 ÷ 最大値」の比率を示す進捗バーが表示されます。EXPR は他のメトリクス式と同じ書き方。</p>
          <div class="metrics-help-table-wrap"><table>
            <tr><th>例</th><th>意味</th></tr>
            <tr><td><code>sparkline(cpa)</code></td><td>CPA 列。全行の中で最大の行が満タン、他はそれに対する比率</td></tr>
            <tr><td><code>sparkline(rev_first - ad_cost)</code></td><td>利益 (売上−広告費)。式は派生メトリクスと同じ書き方</td></tr>
            <tr><td><code>sparkline(ad_cost, { max: 1000000 })</code></td><td>固定目標 100 万円に対する達成率</td></tr>
            <tr><td><code>sparkline(cvr, { color: '#10b981' })</code></td><td>緑のバー</td></tr>
            <tr><td><code>sparkline(cpa, { width: 160, height: 18 })</code></td><td>バーの横幅と高さを変更</td></tr>
          </table></div>
          <p style="margin-top:8px"><strong>OPTIONS 一覧:</strong></p>
          <ul style="font-size:12px;line-height:1.6">
            <li><code>color</code>: バーの色 (例 <code>'#2563eb'</code> or <code>'red'</code>、デフォルト青)</li>
            <li><code>max</code>: 分母 (固定の目標値)。指定なし時は全行の最大値が自動的に分母になる。</li>
            <li><code>width</code>: バー全体の横幅 (px、デフォルト 110)。<code>20〜400</code> の範囲にクランプ</li>
            <li><code>height</code>: バー全体の高さ (px、デフォルト 28)。<code>10〜100</code> の範囲にクランプ</li>
          </ul>
        </details>
      </div>
    </details>
    ${warningHtml}
    <div class="metrics-doc-box">
      <div class="metrics-doc-section"><span>基礎メトリクス</span></div>
      <div class="metrics-doc-hint">※ 基礎は「単一の集計関数」のみ (例: <code>sum(clicks)</code>)。比率/割り算/引き算は「派生」へ。</div>
      ${baseRows.map(x => renderRow(x.m, x.i)).join('') || '<div class="preset-empty">基礎メトリクスがありません</div>'}
      <button type="button" class="metrics-add-btn admin-only" data-add-type="base">+ 基礎メトリクスを追加</button>
    </div>
    <div class="metrics-doc-box">
      <div class="metrics-doc-section"><span>派生メトリクス</span></div>
      <div class="metrics-doc-hint">※ 派生は基礎メトリクスを参照して組み合わせる (例: <code>clicks / impression</code>、<code>ad_cost / clicks</code>)。</div>
      ${derivedRows.map(x => renderRow(x.m, x.i)).join('') || '<div class="preset-empty">派生メトリクスがありません</div>'}
      <button type="button" class="metrics-add-btn admin-only" data-add-type="derived">+ 派生メトリクスを追加</button>
    </div>
  `;
  // textarea の値は innerHTML 経由だと HTML5 仕様で先頭の \n 1 個が strip される。
  // ここで明示的に DOM の value を代入することで、先頭改行 / 連続改行 / 末尾改行を全て保持する。
  el.querySelectorAll('.metrics-doc-row[data-def-idx]').forEach(row => {
    const idx = +row.dataset.defIdx;
    const def = defs[idx];
    const ta = row.querySelector('[data-def-label]');
    if (ta && def) ta.value = def.label || '';
  });
  // 式のバリデーションは保存ボタン押下時のみ (backend PATCH の validate エラーで返る)。
}

// 名称 textarea の rows を内容の改行数に合わせる。入力中 (input イベント) から呼ばれる。
// 初期描画は HTML テンプレ側で rows 属性を計算してあるので、ここでは扱わない。
function autosizeLabel(el) {
  const lines = (el.value || '').split('\n').length;
  el.rows = Math.max(1, Math.min(5, lines));
}

export function setupMetricsEvents() {
  // ----- METRICS DRAG-REORDER -----
  // metrics-doc は persistent の親。基礎/派生は同一 defs 配列にあり、render 時に
  // type でフィルタして 2 セクションに分かれて表示される。異種間の並び替えは
  // 受け付けない (type === 'base' / 'derived' を比較)。
  // data-drag-key は配列インデックス (key 入力は user-editable のため index が安全)。
  makeSortable(document.getElementById('metrics-doc'), (fromStr, toStr, before) => {
    if (!hasPerm('editMetrics')) return;
    const from = +fromStr, to = +toStr;
    if (isNaN(from) || isNaN(to) || from === to) return;
    if (!S.METRIC_DEFS_DRAFT) S.METRIC_DEFS_DRAFT = JSON.parse(JSON.stringify(S.METRIC_DEFS));
    const defs = S.METRIC_DEFS_DRAFT;
    if (from < 0 || from >= defs.length || to < 0 || to >= defs.length) return;
    const fromItem = defs[from];
    const toItem = defs[to];
    if (!fromItem || !toItem || fromItem.type !== toItem.type) return;
    defs.splice(from, 1);
    const toAdjusted = (from < to) ? to - 1 : to;
    const insertAt = before ? toAdjusted : toAdjusted + 1;
    defs.splice(insertAt, 0, fromItem);
    markMetricsDirty();
    renderMetricsDoc();
  });

  // ----- METRICS DOC EVENTS -----
  document.getElementById('metrics-doc').addEventListener('input', e => {
    if (!hasPerm("editMetrics")) return;
    const row = e.target.closest('[data-def-idx]');
    if (!row) return;
    const idx = +row.dataset.defIdx;
    const defs = S.METRIC_DEFS_DRAFT || S.METRIC_DEFS;
    const def = defs[idx];
    if (!def) return;
    if (e.target.matches('[data-def-label]')) {
      // 5 行上限: 超えたら切り詰めてカーソルを末尾に
      const lines = e.target.value.split('\n');
      if (lines.length > 5) e.target.value = lines.slice(0, 5).join('\n');
      def.label = e.target.value;
      autosizeLabel(e.target);
    }
    else if (e.target.matches('[data-def-key]')) {
      const oldKey = def.key;
      const newKey = e.target.value;
      def.key = newKey;
      if (oldKey !== newKey) {
        if (def.type === 'base') {
          if (!S.METRICS_DRAFT_BASE) S.METRICS_DRAFT_BASE = {...S.BASE_FORMULAS};
          if (oldKey in S.METRICS_DRAFT_BASE) {
            S.METRICS_DRAFT_BASE[newKey] = S.METRICS_DRAFT_BASE[oldKey];
            delete S.METRICS_DRAFT_BASE[oldKey];
          }
        } else {
          if (!S.METRICS_DRAFT) S.METRICS_DRAFT = {...S.METRIC_FORMULAS};
          if (oldKey in S.METRICS_DRAFT) {
            S.METRICS_DRAFT[newKey] = S.METRICS_DRAFT[oldKey];
            delete S.METRICS_DRAFT[oldKey];
          }
        }
      }
    }
    else if (e.target.matches('[data-def-fmt]')) def.fmt = e.target.value;
    else if (e.target.matches('[data-def-formula]')) {
      const k = def.key;
      const v = e.target.value;
      if (def.type === 'base') {
        if (!S.METRICS_DRAFT_BASE) S.METRICS_DRAFT_BASE = {...S.BASE_FORMULAS};
        S.METRICS_DRAFT_BASE[k] = v;
      } else {
        if (!S.METRICS_DRAFT) S.METRICS_DRAFT = {...S.METRIC_FORMULAS};
        S.METRICS_DRAFT[k] = v;
      }
    }
    markMetricsDirty();
  });
  document.getElementById('metrics-doc').addEventListener('click', async e => {
    if (!hasPerm("editMetrics")) return;
    const rm = e.target.closest('[data-def-remove]');
    if (rm) {
      const idx = +rm.dataset.defRemove;
      const defs = S.METRIC_DEFS_DRAFT || S.METRIC_DEFS;
      const def = defs[idx];
      if (!def) return;
      const ok = await showModal({title: 'メトリクスを削除', body: `「${def.label || def.key}」を削除しますか？（保存ボタンまで確定されません）`, okText: '削除', danger: true});
      if (!ok) return;
      defs.splice(idx, 1);
      markMetricsDirty();
      renderMetricsDoc();
      return;
    }
    const add = e.target.closest('[data-add-type]');
    if (add) {
      const type = add.dataset.addType;
      const defs = S.METRIC_DEFS_DRAFT || S.METRIC_DEFS;
      let base = 'metric';
      let n = 1;
      let newKey = base + n;
      while (defs.some(d => d.key === newKey)) { n++; newKey = base + n; }
      defs.push({key: newKey, label: type === 'base' ? '新規基礎' : '新規派生', fmt: 'int', type});
      if (type === 'base') {
        if (!S.METRICS_DRAFT_BASE) S.METRICS_DRAFT_BASE = {...S.BASE_FORMULAS};
        S.METRICS_DRAFT_BASE[newKey] = "sum(amount) where funnel = ''";
      } else {
        if (!S.METRICS_DRAFT) S.METRICS_DRAFT = {...S.METRIC_FORMULAS};
        S.METRICS_DRAFT[newKey] = '0';
      }
      markMetricsDirty();
      renderMetricsDoc();
    }
  });
  document.getElementById('metrics-save-btn').addEventListener('click', async () => {
    if (!hasPerm("editMetrics")) return;
    const defs = S.METRIC_DEFS_DRAFT || S.METRIC_DEFS;
    const keys = defs.map(d => d.key);
    if (keys.some(k => !k)) {
      await showModal({title: '保存できません', body: '空のキーがあります', okText: 'OK', cancelText: ''});
      return;
    }
    if (new Set(keys).size !== keys.length) {
      await showModal({title: '保存できません', body: 'キーが重複しています', okText: 'OK', cancelText: ''});
      return;
    }
    // 式の構文/allowlist チェックは backend に委譲 (保存時に PATCH が 400 で戻せば
    // buildSaveErrorMessage が field / detail 付きで表示する)。
    // ここでは semantic な業務ルール (基礎メトリクスは単一集計関数のみ) だけチェック。
    for (const d of defs) {
      if (d.type === 'base') {
        const v = (S.METRICS_DRAFT_BASE || S.BASE_FORMULAS)[d.key] || '';
        if (!parseBaseFormula(v)) {
          await showModal({title: '保存できません', body: `基礎メトリクス「${d.label || d.key}」の構文が不正です:\n${v}`, okText: 'OK', cancelText: ''});
          return;
        }
        if (!isPureBaseFormula(v)) {
          await showModal({
            title: '保存できません',
            body: `基礎メトリクス「${d.label || d.key}」の式は「単一の集計関数」だけにしてください。

現在の式:
${v}

OK の例:
  sum(clicks)
  sum(amount) where funnel = '広告'
  count()

NG の例:
  sum(a) / sum(b)   ← 比率は「派生」へ
  sum(a) - sum(b)   ← 引き算も「派生」へ

CTR / CPC / CPM 等の割り算は派生型にして、基礎メトリクスを参照する式 (例: clicks / impression) にしてください。多重ディメンションのピボット親行で値が壊れるのを防ぐためです。`,
            okText: 'OK', cancelText: '',
          });
          return;
        }
      }
    }
    const ok = await showModal({title: 'メトリクスを保存', body: '変更内容を保存しますか？全タブに反映されます。', okText: '保存'});
    if (!ok) return;

    // ----- Save flow with rollback -----
    // 失敗時に draft / dirty を保持したまま state を巻き戻す。
    const saveBtn = document.getElementById('metrics-save-btn');
    const rootEl = document.getElementById('metrics-doc-view');
    setSaveButtonState(saveBtn, true, rootEl);
    const prevMetricDefs = S.METRIC_DEFS;
    const prevMetricFormulas = S.METRIC_FORMULAS;
    const prevBaseFormulas = S.BASE_FORMULAS;
    try {
      if (S.METRIC_DEFS_DRAFT) { S.METRIC_DEFS = JSON.parse(JSON.stringify(S.METRIC_DEFS_DRAFT)); saveMetricDefs(); }
      const validKeys = new Set(S.METRIC_DEFS.map(d => d.key));
      if (S.METRICS_DRAFT) {
        const next = {};
        for (const k of Object.keys(S.METRICS_DRAFT)) if (validKeys.has(k) && S.METRIC_DEFS.find(d => d.key === k && d.type === 'derived')) next[k] = S.METRICS_DRAFT[k];
        S.METRIC_FORMULAS = next;
        saveFormulas();
      }
      if (S.METRICS_DRAFT_BASE) {
        const next = {};
        for (const k of Object.keys(S.METRICS_DRAFT_BASE)) if (validKeys.has(k) && S.METRIC_DEFS.find(d => d.key === k && d.type === 'base')) next[k] = S.METRICS_DRAFT_BASE[k];
        S.BASE_FORMULAS = next;
        saveBaseFormulas();
      }
      emit('renderChips');
      emit('renderThresholds');
      renderViewNav();
      // backend PATCH 完了を待ってから aggregate API を叩く。
      try {
        await flushConfigNow();
      } catch (e) {
        // Rollback local state
        S.METRIC_DEFS = prevMetricDefs;
        S.METRIC_FORMULAS = prevMetricFormulas;
        S.BASE_FORMULAS = prevBaseFormulas;
        // 失敗した patch を pending から落として無限リトライを防ぐ
        clearPendingConfigKeys(['metricDefs', 'formulas', 'baseFormulas']);
        emit('renderChips');
        emit('renderThresholds');
        renderViewNav();
        await showModal({title: '保存に失敗しました', body: buildSaveErrorMessage(e), okText: 'OK', cancelText: ''});
        return;
      }
      // 成功: draft と dirty を確定
      clearMetricsDirty();
      emit('render');
      await showModal({title: '保存完了', body: 'メトリクスを保存しました', okText: 'OK', cancelText: ''});
    } finally {
      setSaveButtonState(saveBtn, false, rootEl);
    }
  });

  // ----- METRICS HELP -----
  // インライン展開ヘルプ(.metrics-syntax-help) を開いてスクロール
  document.getElementById('metrics-help-btn').addEventListener('click', () => {
    const help = document.getElementById('metrics-syntax-help');
    if (!help) return;
    help.open = true;
    help.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
