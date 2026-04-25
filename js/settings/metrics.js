import { S, DEFAULT_BASE_FORMULAS, DEFAULT_FORMULAS,
  saveMetricDefs, saveFormulas, saveBaseFormulas } from '../state.js';
import { escapeHtml } from '../utils.js';
import { showModal } from '../modal.js';
import { parseBaseFormula } from '../aggregate.js';
import { hasPerm } from '../auth.js';
import { renderViewNav } from '../tabs.js';
import { emit } from '../events.js';

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
    return `<div class="metrics-doc-row" data-def-idx="${i}">
      <div class="metrics-doc-row-head">
        <div class="field-col"><label class="field-label">名称</label><input type="text" class="metric-label-input" data-def-label value="${escapeHtml(m.label)}" placeholder="表示名"></div>
        <div class="field-col"><label class="field-label">キー</label><input type="text" class="metric-key-input" data-def-key value="${escapeHtml(m.key)}" placeholder="key"></div>
        <div class="field-col"><label class="field-label">書式</label><select class="metric-fmt-select" data-def-fmt>
          ${fmtOptions.map(o => `<option value="${o.v}"${m.fmt===o.v?' selected':''}>${o.l}</option>`).join('')}
        </select></div>
        <button type="button" class="metric-del" data-def-remove="${i}" title="削除">×</button>
      </div>
      <label class="field-label">計算式</label>
      <input type="text" class="metric-formula-input" data-def-formula="${i}" value="${escapeHtml(formula)}" placeholder="${m.type==='base'?"sum(column) where funnel = '広告'":'ad_cost / clicks'}">
    </div>`;
  };
  const baseRows = defs.map((m, i) => ({m, i})).filter(x => x.m.type === 'base');
  const derivedRows = defs.map((m, i) => ({m, i})).filter(x => x.m.type === 'derived');
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
          <h4 style="margin-top:14px">AND と OR を混ぜる時の読み方</h4>
          <p><strong>AND の方が先に評価されます</strong>（算数で「×」が「+」より先なのと同じ感覚）。</p>
          <p>例: <code>status='完了' and amount &gt; 1000 or status='保留'</code></p>
          <p>↓ こう読まれます:</p>
          <p style="padding-left:16px"><code>(status='完了' <strong>かつ</strong> amount &gt; 1000) <strong>または</strong> status='保留'</code></p>
          <p>つまり「完了で1000超」 <strong>または</strong> 「保留」のいずれか。</p>
          <p style="margin-top:8px"><strong>もし</strong>「完了 <strong>かつ</strong> (1000超 <strong>または</strong> 保留)」と書きたい時はカッコでまとめる必要がありますが、現状カッコでのグループ化は未対応です。その場合は次のように2つに分けてください:</p>
          <p style="padding-left:16px">
            <code>m1 = sum(x where status='完了' and amount &gt; 1000)</code><br>
            <code>m2 = sum(x where status='完了' and status='保留')</code><br>
            <code>合計 = m1 + m2</code>
          </p>
          <h4 style="margin-top:14px">もう少し例</h4>
          <table>
            <tr><th>式</th><th>意味</th></tr>
            <tr><td><code>count() where status='A' or status='B'</code></td><td>A または B</td></tr>
            <tr><td><code>sum(x where name contains '広告' or category='ad')</code></td><td>名前に「広告」を含む、またはカテゴリが ad</td></tr>
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
      </div>
    </details>
    <div class="metrics-doc-box">
      <div class="metrics-doc-section"><span>基礎メトリクス</span></div>
      ${baseRows.map(x => renderRow(x.m, x.i)).join('') || '<div class="preset-empty">基礎メトリクスがありません</div>'}
      <button type="button" class="metrics-add-btn admin-only" data-add-type="base">+ 基礎メトリクスを追加</button>
    </div>
    <div class="metrics-doc-box">
      <div class="metrics-doc-section"><span>派生メトリクス</span></div>
      ${derivedRows.map(x => renderRow(x.m, x.i)).join('') || '<div class="preset-empty">派生メトリクスがありません</div>'}
      <button type="button" class="metrics-add-btn admin-only" data-add-type="derived">+ 派生メトリクスを追加</button>
    </div>
  `;
}

export function setupMetricsEvents() {
  // ----- METRICS DOC EVENTS -----
  document.getElementById('metrics-doc').addEventListener('input', e => {
    if (!hasPerm("editMetrics")) return;
    const row = e.target.closest('[data-def-idx]');
    if (!row) return;
    const idx = +row.dataset.defIdx;
    const defs = S.METRIC_DEFS_DRAFT || S.METRIC_DEFS;
    const def = defs[idx];
    if (!def) return;
    if (e.target.matches('[data-def-label]')) def.label = e.target.value;
    else if (e.target.matches('[data-def-key]')) def.key = e.target.value;
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
