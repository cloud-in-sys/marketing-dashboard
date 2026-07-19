// テーブルのセル生成。閾値カラー / 列ごとスタイル / sparkline / URL 安全判定を含む。
// 通常表示 (行ピボット) と転置表示の両方から使うため table.js から切り出した。
// module スコープの可変状態 (折り畳み/固定列/倍率) には依存しない。
import { S } from '@app/state.ts';
import { fmt, escapeHtml } from '@shared/utils/utils.ts';
import { getSparklineConfig, getSparklineSeries, renderSparklineSVG, rowKeyForSparkline, rowDepthForSparkline } from './sparkline.ts';
import { buildCellStyle } from './tableSettings.ts';

function compare(value: number, op: string, threshold: number): boolean {
  switch (op) {
    case '<':  return value < threshold;
    case '<=': return value <= threshold;
    case '>':  return value > threshold;
    case '>=': return value >= threshold;
    default:   return false;
  }
}

export function thresholdClass(metricKey: string, value: number): string {
  const t = S.THRESHOLDS[metricKey];
  if (!t || !isFinite(value) || value === 0) return '';
  const min = t.min, max = t.max, target = t.target;
  const minOp = t.minOp || '<=';
  const maxOp = t.maxOp || '<=';
  const targetOp = t.targetOp || '>=';
  const hitMin = min != null && compare(value, minOp, min);
  const hitMax = max != null && compare(value, maxOp, max);
  const hitTarget = target != null && compare(value, targetOp, target);
  // 目標達成が最優先、次に最低許容値、最後に最大許容値
  if (hitTarget) return 'cell-blue';
  if (hitMin) return 'cell-red';
  if (hitMax) return 'cell-yellow';
  return '';
}

// 1 メトリクス分の <td>。通常表示 (buildMetricCells) と転置表示の両方から使う。
// 転置でも閾値カラー・列ごとスタイル・sparkline の扱いを同一にするため共通化している。
export function metricCellHtml(m: any, agg: any, opts: any = {}, groupVals: any = null, extraClass = ''): string {
  const spark = getSparklineConfig(m.key);
  if (spark) {
    // sparkline (gauge): データ行・親集計行どちらでも描画。総計 (groupVals==null) は空セル。
    // 行の agg と inner があれば series 無しでも描けるので、series 取得失敗を理由に空セルにはしない。
    const style = opts.skipColStyle ? '' : buildCellStyle(m.key);
    const sparkCls = ['sparkline-cell', extraClass].filter(Boolean).join(' ');
    if (groupVals != null) {
      const series = getSparklineSeries(rowKeyForSparkline(groupVals)) || [];
      const svg = renderSparklineSVG(series, {
        ...spark.options,
        _metricKey: m.key,
        _depth: rowDepthForSparkline(groupVals),
        _rowAgg: agg,
        _innerFormula: spark.inner,
      }, 110, 28);
      return `<td class="${sparkCls}"${style ? ` style="${style}"` : ''}>${svg}</td>`;
    }
    return `<td class="${sparkCls}"${style ? ` style="${style}"` : ''}></td>`;
  }
  const v = agg[m.key];
  const cls = [extraClass, thresholdClass(m.key, v)].filter(Boolean).join(' ');
  const style = opts.skipColStyle ? '' : buildCellStyle(m.key);
  const attrs = (cls ? ` class="${cls}"` : '') + (style ? ` style="${style}"` : '');
  return `<td${attrs}>${fmt(v, m.fmt)}</td>`;
}

export function buildMetricCells(agg: any, metrics: any[], opts: any = {}, groupVals: any = null): string {
  return metrics.map((m: any) => metricCellHtml(m, agg, opts, groupVals)).join('');
}
// URL 安全判定: link は http/https のみ、image はそれに加えて data:image/* を許容。
// `javascript:` `data:text/html` 等の危険スキームは弾く。
export function isSafeLink(s: any): boolean {
  if (typeof s !== 'string' || !s) return false;
  return /^https?:\/\//i.test(s.trim());
}
export function isSafeImageSrc(s: any): boolean {
  if (typeof s !== 'string' || !s) return false;
  const t = s.trim();
  return /^https?:\/\//i.test(t) || /^data:image\/[a-zA-Z0-9+.-]+;/.test(t);
}

export function dimCellHtml(dimKey: string, value: any, extraClasses = '', innerHtml: string | null = null, dimIdx: number | null = null, opts: any = {}): string {
  const cls = 'group-col' + (extraClasses ? ' ' + extraClasses : '');
  const style = opts.skipColStyle ? '' : buildCellStyle('dim:' + dimKey);
  const styleAttr = style ? ` style="${style}"` : '';
  const idxAttr = dimIdx != null ? ` data-dim-idx="${dimIdx}"` : '';
  // type:'image' / type:'link' の dim は値を URL として描画。親集計行は toggle + 内容。
  const def = S.DIMENSIONS?.find((d: any) => d.key === dimKey);
  const isImage = def?.type === 'image';
  const isLink  = def?.type === 'link';
  // 値が空 (null/undefined/'') の場合は URL 化せず空セル相当にする (リンク化で「" の href へ遷移」を防止)
  const hasValue = value != null && value !== '';
  // 危険 URL (javascript:, data:text/html 等) は href/src 化を拒否、通常テキスト表示にフォールバック
  const urlSafe = hasValue && (isImage ? isSafeImageSrc(String(value)) : isLink ? isSafeLink(String(value)) : false);
  let inner: string;
  if ((isImage || isLink) && urlSafe) {
    let mainHtml: string;
    if (isImage) {
      const sizeParts = [];
      if (def.imageHeight) sizeParts.push(`max-height:${def.imageHeight}px;height:${def.imageHeight}px`);
      if (def.imageWidth)  sizeParts.push(`max-width:${def.imageWidth}px`);
      const sizeAttr = sizeParts.length ? ` style="${sizeParts.join(';')}"` : '';
      // 失敗時のフォールバックは固定文字列のみ (元 URL を JS 文字列に埋め込まない)
      mainHtml = `<img class="dim-image" src="${escapeHtml(value)}"${sizeAttr} alt="" loading="lazy" referrerpolicy="no-referrer" title="${escapeHtml(value)}" onerror="this.outerHTML='<span class=&quot;dim-image-broken&quot;></span>'">`;
    } else {
      mainHtml = `<span class="dim-link-label">${escapeHtml(value)}</span>`;
    }
    // <a> でラップして新規タブで開く。dim-image-broken のフォールバックも <a> 内で生存する。
    const wrapped = `<a class="dim-link" href="${escapeHtml(value)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(value)}">${mainHtml}</a>`;
    if (innerHtml != null) {
      // 親集計行: toggle button を残しつつ label を差し替える
      inner = innerHtml.replace(/<span class="pivot-parent-label">[\s\S]*?<\/span>/, wrapped);
    } else {
      inner = wrapped;
    }
  } else {
    // image/link 型でも URL が不正/空の場合: 通常のテキスト表示にフォールバック
    inner = innerHtml != null ? innerHtml : escapeHtml(value);
  }
  return `<td class="${cls}"${idxAttr}${styleAttr}>${inner}</td>`;
}
