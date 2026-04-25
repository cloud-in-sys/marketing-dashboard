import { S } from './state.js';
import { escapeHtml } from './utils.js';
import { getComboLines } from './chart.js';

// ===== グラフ設定サイドパネル =====
export function openChartSettings(chartId) {
  S.CHART_SETTINGS_ID = chartId;
  renderChartSettingsPanel();
  document.getElementById('chart-settings-panel').classList.remove('hidden');
  document.getElementById('chart-settings-backdrop').classList.remove('hidden');
}

export function closeChartSettings() {
  S.CHART_SETTINGS_ID = null;
  document.getElementById('chart-settings-panel').classList.add('hidden');
  document.getElementById('chart-settings-backdrop').classList.add('hidden');
}

export function renderChartSettingsPanel() {
  const body = document.getElementById('chart-settings-body');
  if (!body) return;
  const c = S.CHARTS.find(x => x.id === S.CHART_SETTINGS_ID);
  if (!c) { body.innerHTML = ''; return; }
  const typeOpts = `
    <option value="bar"${c.type === 'bar' ? ' selected' : ''}>棒</option>
    <option value="line"${c.type === 'line' ? ' selected' : ''}>折れ線</option>
    <option value="area"${c.type === 'area' ? ' selected' : ''}>エリア</option>
    <option value="scatter"${c.type === 'scatter' ? ' selected' : ''}>散布</option>
    <option value="pie"${c.type === 'pie' ? ' selected' : ''}>円グラフ</option>
    <option value="stacked"${c.type === 'stacked' ? ' selected' : ''}>積み上げ棒</option>
    <option value="combo"${c.type === 'combo' ? ' selected' : ''}>複合（棒+折れ線）</option>`;
  const xAxisSelect = `
    <select data-panel-role="bucket">
      <option value="auto"${(c.bucket||'auto')==='auto'?' selected':''}>ピボットに追従</option>
      ${(S.DIMENSIONS || []).map(d => `<option value="${d.key}"${c.bucket === d.key ? ' selected' : ''}>${escapeHtml(d.label)}</option>`).join('')}
    </select>`;
  const y1Select = `
    <select data-panel-role="metric">${S.METRIC_DEFS.map(m => `<option value="${m.key}"${m.key === c.metric ? ' selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}</select>`;

  // 折れ線系(line / area / combo の折れ線)でドット表示オプションを出す
  const hasDots = c.type === 'line' || c.type === 'area' || c.type === 'combo';
  const showDots = c.showDots !== false; // 既定は true
  const dotSize = c.dotSize ?? 3.5;
  const dotControls = hasDots ? `
    <label class="chart-settings-field">
      <span class="chart-settings-label">ドット表示</span>
      <label class="chart-settings-check"><input type="checkbox" data-panel-role="showDots"${showDots ? ' checked' : ''}> <span>折れ線にドットを表示</span></label>
    </label>
    ${showDots ? `
    <label class="chart-settings-field">
      <span class="chart-settings-label">ドットの大きさ (${dotSize})</span>
      <input type="range" min="1" max="8" step="0.5" data-panel-role="dotSize" value="${dotSize}">
    </label>` : ''}
    <label class="chart-settings-field">
      <span class="chart-settings-label">折れ線の太さ (${c.lineWidth ?? 2.5})</span>
      <input type="range" min="0.5" max="6" step="0.5" data-panel-role="lineWidth" value="${c.lineWidth ?? 2.5}">
    </label>
    <label class="chart-settings-field">
      <span class="chart-settings-label">折れ線の形状</span>
      <label class="chart-settings-check"><input type="checkbox" data-panel-role="smoothLine"${c.smoothLine ? ' checked' : ''}> <span>曲線にする</span></label>
    </label>
  ` : '';
  // データラベル(ほぼ全種類で意味あるので共通)
  const labelControls = `
    <label class="chart-settings-field">
      <span class="chart-settings-label">データラベル</span>
      <label class="chart-settings-check"><input type="checkbox" data-panel-role="showDataLabels"${c.showDataLabels ? ' checked' : ''}> <span>数値を各データに表示</span></label>
    </label>`;

  body.innerHTML = `
    <label class="chart-settings-field">
      <span class="chart-settings-label">グラフ名</span>
      <input type="text" data-panel-role="name" value="${escapeHtml(c.name || '')}" placeholder="グラフ名">
    </label>

    <label class="chart-settings-field">
      <span class="chart-settings-label">種類</span>
      <select data-panel-role="type">${typeOpts}</select>
    </label>

    <label class="chart-settings-field">
      <span class="chart-settings-label">X軸（ディメンション）</span>
      ${xAxisSelect}
    </label>

    <label class="chart-settings-field">
      <span class="chart-settings-label">${c.type === 'combo' ? 'Y軸（第1メトリクス）' : 'Y軸（メトリクス）'}</span>
      ${y1Select}
    </label>

    ${c.type === 'combo' ? `
    <div class="chart-settings-field">
      <span class="chart-settings-label">折れ線（第2メトリクス以降）</span>
      <div class="combo-lines">
        ${getComboLines(c).map((l, idx) => `
          <div class="combo-line" data-line-idx="${idx}">
            <select data-panel-role="line-metric" data-line-idx="${idx}">
              <option value="">— 未選択 —</option>
              ${S.METRIC_DEFS.map(m => `<option value="${m.key}"${l.metric === m.key ? ' selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
            </select>
            <input type="color" data-panel-role="line-color" data-line-idx="${idx}" value="${l.color || '#ef4444'}">
            <button type="button" class="combo-line-remove" data-panel-role="line-remove" data-line-idx="${idx}" aria-label="削除">×</button>
          </div>
        `).join('')}
        <button type="button" class="combo-line-add" data-panel-role="line-add">+ 折れ線を追加</button>
      </div>
    </div>` : ''}

    ${c.type === 'stacked' ? `
    <label class="chart-settings-field">
      <span class="chart-settings-label">積み上げ軸（内訳）</span>
      <select data-panel-role="stackBy">
        <option value=""${!c.stackBy ? ' selected' : ''}>— 選択してください —</option>
        ${(S.DIMENSIONS || []).map(d => `<option value="${d.key}"${c.stackBy === d.key ? ' selected' : ''}>${escapeHtml(d.label)}</option>`).join('')}
      </select>
    </label>` : ''}

    ${c.type === 'combo' ? `
    <label class="chart-settings-field">
      <span class="chart-settings-label">棒の色</span>
      <input type="color" data-panel-role="color" value="${c.color || '#2563eb'}">
    </label>` : ''}

    ${c.type !== 'stacked' && c.type !== 'combo' ? `
    <label class="chart-settings-field">
      <span class="chart-settings-label">色</span>
      <input type="color" class="chart-color" data-panel-role="color" value="${c.color || '#2563eb'}">
    </label>` : ''}

    ${dotControls}
    ${labelControls}
  `;
}
