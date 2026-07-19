import { S, DOW_LABELS, DOW_ORDER } from '@app/state.ts';
import type { DimensionDefinition } from '@app/models.ts';
import { getBackendGroups } from './aggregateCache.ts';

// ===== Dimensions & Grouping (optimized) =====

/** 式ディメンション用にコンパイルした関数。_src は再コンパイル要否の判定に使う */
type DimExprFn = ((r: any) => any) & { _src?: string };

let dimMapRef: any[] | null = null;
let dimMap = new Map<string, DimensionDefinition>();

function ensureDimMap() {
  if (dimMapRef !== S.DIMENSIONS) {
    dimMapRef = S.DIMENSIONS;
    dimMap = new Map(S.DIMENSIONS.map((d) => [d.key, d]));
  }
}

export function dimValue(row: any, key: string): string {
  ensureDimMap();
  const def = dimMap.get(key);
  if (!def) return row[key] || '';
  if (def.type === 'expression') {
    let fn: DimExprFn | undefined = S.DIM_EXPR_CACHE.get(key);
    if (!fn || fn._src !== def.expression) {
      try {
        fn = new Function('r', `"use strict"; return (${def.expression || "''"})`) as DimExprFn;
        fn._src = def.expression;
      } catch (e) { fn = (() => '') as DimExprFn; fn._src = def.expression; }
      S.DIM_EXPR_CACHE.set(key, fn);
    }
    try { return String(fn(row) ?? ''); } catch (e) { return ''; }
  }
  const raw = row[def.field] || '';
  if (def.type === 'month') return String(raw).slice(0, 7);
  if (def.type === 'year') return String(raw).slice(0, 4);
  if (def.type === 'week') {
    return computeWeekRange(raw, def.weekStart);
  }
  if (def.type === 'week_md') {
    return computeWeekRange(raw, def.weekStart, true);
  }
  if (def.type === 'dow') {
    const dt = new Date(raw);
    // isNaN(Date) は実行時には valueOf 経由で動く。型の上だけ number へ寄せる。
    return isNaN(dt as unknown as number) ? '' : DOW_LABELS[dt.getDay()];
  }
  return raw;
}

// YYYY-MM-DD 文字列を [年, 月(1-12), 日] にパース。new Date(str) は UTC 解釈で
// TZ ずれが出るため避ける。
// 月/日の範囲も検証して、'2024-13-45' のような不正値が new Date のオーバーフロー経由で
// 別月の週ラベルに化けないようにする。
function parseYMD(raw: any): [number, number, number] | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(raw));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > 31) return null;
  // 日付の妥当性 (例: 2-30) は new Date 経由で再構築して比較。
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return [y, mo, d];
}
function pad2(n: number) { return n < 10 ? '0' + n : String(n); }
function fmtYMD(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function fmtMD(d: Date) { return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

// 週の開始曜日 weekStart (0=日..6=土、デフォルト 1=月) を起点に、
// raw 日付が属する週の [開始日〜終了日] を返す。
// monthDayOnly=true なら年を省いた MM-DD〜MM-DD で返す。
function computeWeekRange(raw: any, weekStart?: any, monthDayOnly = false): string {
  const ymd = parseYMD(raw);
  if (!ymd) return '';
  const ws = (weekStart != null && weekStart >= 0 && weekStart <= 6) ? Number(weekStart) : 1;
  const dt = new Date(ymd[0], ymd[1] - 1, ymd[2]);
  const offset = (dt.getDay() - ws + 7) % 7;
  const start = new Date(dt);
  start.setDate(dt.getDate() - offset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = monthDayOnly ? fmtMD : fmtYMD;
  return `${fmt(start)}〜${fmt(end)}`;
}

export function dimSort(key: string, a: any, b: any): number {
  ensureDimMap();
  const def = dimMap.get(key);
  // ディメンション type が 'dow' なら曜日固定順(日月火水木金土)で並べる
  if (def?.type === 'dow' || key === 'dow') {
    return (DOW_ORDER[a] ?? 99) - (DOW_ORDER[b] ?? 99);
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

export function dimLabel(key: string): string {
  ensureDimMap();
  return (dimMap.get(key) || {}).label || key;
}

// 同一 rows 参照 + 同一 dims キーに対するグルーピング結果を WeakMap にキャッシュ。
// render() 内で複数チャートが同じ xDim を使っても 1 回しか走らないようにする。
const _groupCache = new WeakMap<object, Map<string, any[]>>();
// DIMENSIONS の世代カウンタ。weekStart など def 変更後にキャッシュを再利用しないように
// _groupCache のキーに混ぜる。
let _dimsVersion = 0;
let _lastDimsRef: any[] | null = null;
function dimsVersion() {
  if (_lastDimsRef !== S.DIMENSIONS) {
    _lastDimsRef = S.DIMENSIONS;
    _dimsVersion++;
  }
  return _dimsVersion;
}

export function groupRows(rows: any[], dims: string[]): any[] {
  // バックエンド集計の prefetch 済み結果があればそれを使う。
  // 返り値要素は { vals, rows: [], agg } — レンダラは g.agg を優先参照する。
  const backend = getBackendGroups(rows, dims);
  if (backend) return backend;
  const dimsKey = dimsVersion() + ':' + dims.join('\u0001');
  let cache = _groupCache.get(rows);
  if (cache && cache.has(dimsKey)) return cache.get(dimsKey)!;

  const map = new Map<string, { vals: string[]; rows: any[] }>();
  for (let i = 0, len = rows.length; i < len; i++) {
    const r = rows[i];
    const vals = dims.map(k => dimValue(r, k));
    const key = vals.join('\u0001');
    if (!map.has(key)) map.set(key, {vals, rows: []});
    map.get(key)!.rows.push(r);
  }
  const result = [...map.values()].sort((a, b) => {
    for (let i = 0; i < dims.length; i++) {
      const c = dimSort(dims[i], a.vals[i], b.vals[i]);
      if (c) return c;
    }
    return 0;
  });

  if (!cache) { cache = new Map(); _groupCache.set(rows, cache); }
  cache.set(dimsKey, result);
  return result;
}
