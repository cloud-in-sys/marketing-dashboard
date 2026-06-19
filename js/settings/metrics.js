import { S, DEFAULT_BASE_FORMULAS, DEFAULT_FORMULAS,
  saveMetricDefs, saveFormulas, saveBaseFormulas } from '../state.js';
import { escapeHtml } from '../utils.js';
import { showModal } from '../modal.js';
import { parseBaseFormula, isPureBaseFormula } from '../aggregate/aggregate.js';
import { hasPerm } from '../auth.js';
import { renderViewNav } from '../tabs.js';
import { emit } from '../events.js';
import { makeSortable } from '../sortable.js';

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
        <div class="field-col"><label class="field-label">名称</label><textarea class="metric-label-input" data-def-label draggable="false" rows="1" placeholder="表示名 (Enter で改行・最大3行)">${escapeHtml(m.label)}</textarea></div>
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
      <summary>計算式の書き方（クリックで展開）</summary>
      <div class="metrics-syntax-help-body">
        <div class="metrics-syntax-help-section">
          <h4>基本</h4>
          <p>「集計関数」「算術演算」「他メトリクス参照」を自由に組み合わせて書けます。基礎/派生の分類は表示用のグループ分けで、書ける式は同じです。</p>
          <table>
            <tr><th>例</th><th>意味</th></tr>
            <tr><td><code>sum(revenue)</code></td><td>集計のみ</td></tr>
            <tr><td><code>cost / clicks</code></td><td>他メトリクス参照のみ（旧派生）</td></tr>
            <tr><td><code>sum(revenue) - sum(cost)</code></td><td>集計を組み合わせ</td></tr>
            <tr><td><code>profit / sum(cost) * 100</code></td><td>参照と集計の混在</td></tr>
          </table>
        </div>
        <div class="metrics-syntax-help-section">
          <h4>集計関数</h4>
          <table>
            <tr><th>関数</th><th>説明</th><th>例</th></tr>
            <tr><td><code>sum(field)</code></td><td>合計</td><td><code>sum(applications)</code></td></tr>
            <tr><td><code>count()</code></td><td>行数</td><td><code>count()</code></td></tr>
            <tr><td><code>count(field)</code></td><td>field が空でない行数</td><td><code>count(email)</code></td></tr>
            <tr><td><code>avg(field)</code></td><td>平均</td><td><code>avg(price)</code></td></tr>
            <tr><td><code>min(field)</code></td><td>最小</td><td><code>min(score)</code></td></tr>
            <tr><td><code>max(field)</code></td><td>最大</td><td><code>max(score)</code></td></tr>
            <tr><td><code>countDistinct(field)</code></td><td>ユニーク値の数</td><td><code>countDistinct(user_id)</code></td></tr>
          </table>
        </div>
        <div class="metrics-syntax-help-section">
          <h4>WHERE 条件</h4>
          <p>集計関数のパレ内に <code>where</code> を書けます。<code>and</code> / <code>or</code> で連結可能。</p>
          <table>
            <tr><th>例</th><th>意味</th></tr>
            <tr><td><code>sum(revenue where status='完了')</code></td><td>パレ内 where（混合式での推奨）</td></tr>
            <tr><td><code>sum(revenue) where status='完了'</code></td><td>パレ外 where（単一集計のみ・旧書式互換）</td></tr>
            <tr><td><code>sum(x where a='1') - sum(y where b='2')</code></td><td>集計ごとに where を変える</td></tr>
          </table>
          <h4 style="margin-top:14px">演算子</h4>
          <table>
            <tr><th>演算子</th><th>意味</th><th>例</th></tr>
            <tr><td><code>=</code></td><td>等しい</td><td><code>status = '完了'</code></td></tr>
            <tr><td><code>!=</code></td><td>等しくない</td><td><code>status != 'cancelled'</code></td></tr>
            <tr><td><code>&lt;</code></td><td>未満</td><td><code>amount &lt; 100</code></td></tr>
            <tr><td><code>&lt;=</code></td><td>以下</td><td><code>amount &lt;= 100</code></td></tr>
            <tr><td><code>&gt;</code></td><td>超</td><td><code>amount &gt; 100</code></td></tr>
            <tr><td><code>&gt;=</code></td><td>以上</td><td><code>amount &gt;= 100</code></td></tr>
            <tr><td><code>contains</code></td><td>含む（部分一致）</td><td><code>name contains '広告'</code></td></tr>
            <tr><td><code>notContains</code></td><td>含まない</td><td><code>name notContains 'テスト'</code></td></tr>
            <tr><td><code>startsWith</code></td><td>〜で始まる（前方一致）</td><td><code>url startsWith 'https://'</code></td></tr>
            <tr><td><code>endsWith</code></td><td>〜で終わる（後方一致）</td><td><code>email endsWith '@example.com'</code></td></tr>
          </table>
          <h4 style="margin-top:14px">AND と OR の優先順位</h4>
          <p>AND が OR より優先されます（×が+より先と同じ）。明示的にグループ化したい時は <code>(...)</code> を使えます。</p>
          <table>
            <tr><th>式</th><th>意味</th></tr>
            <tr><td><code>status='完了' and amount &gt; 1000 or status='保留'</code></td><td>(完了 かつ 1000超) または 保留</td></tr>
            <tr><td><code>status='完了' and (category='A' or category='B')</code></td><td>完了 かつ (A または B)</td></tr>
            <tr><td><code>(status='A' or status='B') and amount &gt; 100</code></td><td>(A または B) かつ 100超</td></tr>
            <tr><td><code>count() where url startsWith 'https://'</code></td><td>URL が https:// で始まる</td></tr>
            <tr><td><code>sum(x where category notContains 'テスト')</code></td><td>category に「テスト」を含まない</td></tr>
          </table>
          <p>※ カラム名は英数字とアンダースコアのみ。日本語カラムは BigQuery 側で <code>AS</code> で英名にリネームしてください。</p>
        </div>
        <div class="metrics-syntax-help-section">
          <h4>today() — 今日の日付</h4>
          <p>WHERE 句で日付比較に使用。<code>today()-N</code> で N 日前、<code>today()+N</code> で N 日後。</p>
          <table>
            <tr><th>例</th><th>意味</th></tr>
            <tr><td><code>sum(count where date = today())</code></td><td>今日のみ</td></tr>
            <tr><td><code>sum(count where date &gt;= today()-7)</code></td><td>過去 7 日（昨日含む）</td></tr>
            <tr><td><code>sum(count where date &gt;= today()-30 and date &lt; today())</code></td><td>直近 30 日（今日除く）</td></tr>
          </table>
        </div>
        <div class="metrics-syntax-help-section">
          <h4>算術・JavaScript 構文</h4>
          <p>集計値や他メトリクス値に対して <code>+ - * /</code>、三項演算子（<code>? :</code>）、論理演算子（<code>&amp;&amp;</code>, <code>||</code>）、<code>Math.*</code> が使えます。</p>
          <table>
            <tr><th>例</th><th>意味</th></tr>
            <tr><td><code>conversions / sessions * 100</code></td><td>CV率（%）</td></tr>
            <tr><td><code>Math.max(revenue, 0)</code></td><td>負数を0に丸める</td></tr>
            <tr><td><code>sessions &gt; 1000 ? bounce_rate : 0</code></td><td>セッション数が一定以上の時のみ</td></tr>
          </table>
        </div>
        <div class="metrics-syntax-help-section">
          <h4>スパークライン（ミニ進捗バー）</h4>
          <p>派生メトリクスの式で <code>sparkline(EXPR)</code> または <code>sparkline(EXPR, { オプション1: 値1, オプション2: 値2 })</code> と書くと、その列のセルに「行の値 ÷ 最大値」の比率を示す進捗バーが表示されます。EXPR は他のメトリクス式と同じ書き方。</p>
          <table>
            <tr><th>例</th><th>意味</th></tr>
            <tr><td><code>sparkline(cpa)</code></td><td>CPA 列。全行の中で最大の行が満タン、他はそれに対する比率</td></tr>
            <tr><td><code>sparkline(rev_first - ad_cost)</code></td><td>利益 (売上−広告費)。式は派生メトリクスと同じ書き方</td></tr>
            <tr><td><code>sparkline(ad_cost, { max: 1000000 })</code></td><td>固定目標 100 万円に対する達成率</td></tr>
            <tr><td><code>sparkline(cvr, { color: '#10b981' })</code></td><td>緑のバー</td></tr>
          </table>
          <p style="margin-top:8px"><strong>OPTIONS 一覧:</strong></p>
          <ul style="font-size:12px;line-height:1.6">
            <li><code>color</code>: バーの色 (例 <code>'#2563eb'</code> or <code>'red'</code>、デフォルト青)</li>
            <li><code>max</code>: 分母 (固定の目標値)。指定なし時は全行の最大値が自動的に分母になる。</li>
          </ul>
        </div>
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
  // 名称 textarea の初期高さを scrollHeight に合わせる
  el.querySelectorAll('textarea.metric-label-input').forEach(autosizeLabel);
}

// 名称 textarea を内容に合わせて自動リサイズ (3 行を上限とする CSS と組み合わせる)
function autosizeLabel(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
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
      // 3 行上限: 超えたら切り詰めてカーソルを末尾に
      const lines = e.target.value.split('\n');
      if (lines.length > 3) e.target.value = lines.slice(0, 3).join('\n');
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
      if (def.type === 'base') {
        if (!S.METRICS_DRAFT_BASE) S.METRICS_DRAFT_BASE = {...S.BASE_FORMULAS};
        S.METRICS_DRAFT_BASE[k] = e.target.value;
      } else {
        if (!S.METRICS_DRAFT) S.METRICS_DRAFT = {...S.METRIC_FORMULAS};
        S.METRICS_DRAFT[k] = e.target.value;
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
    clearMetricsDirty();
    emit('renderChips');
    emit('renderThresholds');
    renderViewNav();
    emit('render');
    await showModal({title: '保存完了', body: 'メトリクスを保存しました', okText: 'OK', cancelText: ''});
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
