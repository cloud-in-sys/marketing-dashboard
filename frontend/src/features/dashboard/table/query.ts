// テーブル設定の「フィルタ」「並び替え」を groups[] に適用するロジック。
// module スコープの可変状態 (折り畳み/固定列/倍率) には依存しない純粋な処理。
import { dimSort } from '@aggregate/dimensions.ts';
import { aggregate } from '@aggregate/aggregate.ts';
import { sumAggs } from './aggUtils.ts';

// テーブル設定のフィルタ/ソートを groups[] に適用する。
//   filters: { [colKey]: { op, value } } で各 group の値を評価し、false なら除外。
//   sort:    { col, dir, custom }       で各 group / 親バケツ内の並び順を決定。
// colKey は 'dim:<dimKey>' または metric.key。
function evalFilterValue(group: any, colKey: string, dims: string[]): any {
  if (colKey.startsWith('dim:')) {
    const idx = dims.indexOf(colKey.slice(4));
    return idx >= 0 ? group.vals[idx] : null;
  }
  // metric: agg がまだ無ければ計算
  if (!group.agg) group.agg = aggregate(group.rows);
  return group.agg[colKey];
}
// 順序比較ヘルパー。両辺の形に応じて数値 → 日付 → 文字列の順で型を選ぶ。
//   - 両方が「綺麗な数値文字列」: Number 比較
//   - 両方が Date.parse できる: timestamp 比較 (ISO 日付 / `2024-01-15` 等)
//   - それ以外: ロケール辞書順
function compareForFilter(v: any, target: any): number {
  const sv = String(v ?? '').trim();
  const st = String(target ?? '').trim();
  const NUM = /^-?\d+(\.\d+)?$/;
  if (NUM.test(sv) && NUM.test(st)) return Number(sv) - Number(st);
  const dv = Date.parse(sv), dt = Date.parse(st);
  if (!isNaN(dv) && !isNaN(dt)) return dv - dt;
  return sv.localeCompare(st);
}
// null / undefined を空文字として正規化 (eq/ne で "null"/"undefined" の文字列扱いを避けるため)
const _normForCmp = (v: any) => v == null ? '' : String(v);
export function passesFilter(group: any, dims: string[], filters: any): boolean {
  for (const [colKey, rule] of Object.entries<any>(filters || {})) {
    if (!rule || !rule.op) continue;
    const v = evalFilterValue(group, colKey, dims);
    const target = rule.value;
    // 大小比較系: 値が null/undefined なら順序を判定不能としてフィルタ通過させない
    if (rule.op === 'gt' || rule.op === 'gte' || rule.op === 'lt' || rule.op === 'lte') {
      if (v == null) return false;
    }
    switch (rule.op) {
      case 'gt':  if (!(compareForFilter(v, target) >  0)) return false; break;
      case 'gte': if (!(compareForFilter(v, target) >= 0)) return false; break;
      case 'lt':  if (!(compareForFilter(v, target) <  0)) return false; break;
      case 'lte': if (!(compareForFilter(v, target) <= 0)) return false; break;
      case 'eq':  if (_normForCmp(v) !== _normForCmp(target)) return false; break;
      case 'ne':  if (_normForCmp(v) === _normForCmp(target)) return false; break;
      case 'contains': if (!_normForCmp(v).includes(_normForCmp(target))) return false; break;
    }
  }
  return true;
}
// カスタム順序: 改行区切りの文字列リスト。リストにある値はリスト順、無い値は末尾 (alpha)。
export function customSortIndex(value: any, customList: string[]): number {
  const i = customList.indexOf(String(value));
  return i >= 0 ? i : Number.MAX_SAFE_INTEGER;
}
// 親バケツ (buildLevel 内) のソート用 comparator を生成。
// 1 つの sort 条件 ({col, dir, custom}) で 2 つのバケツキーを比較。
// dim:<key> 条件は現在の level の dim と一致しないと適用しない (= 0 を返して次の条件に進む)。
function compareBySortEntry(s: any, a: any, b: any, dimIndex: number, dims: string[], bucketsMap: Map<any, any[]>): number {
  if (!s || !s.col) return 0;
  const dir = s.dir === 'desc' ? -1 : 1;
  if (s.col.startsWith('dim:')) {
    if (s.col !== 'dim:' + dims[dimIndex]) return 0;
    const customList = (s.custom || '').split('\n').map((x: string) => x.trim()).filter(Boolean);
    if (customList.length) {
      const r = (customSortIndex(a, customList) - customSortIndex(b, customList)) * dir;
      if (r !== 0) return r;
    }
    return dimSort(dims[dimIndex], a, b) * dir;
  }
  const aSum = sumAggs((bucketsMap.get(a) || []).map((g: any) => g.agg || aggregate(g.rows)))[s.col] || 0;
  const bSum = sumAggs((bucketsMap.get(b) || []).map((g: any) => g.agg || aggregate(g.rows)))[s.col] || 0;
  return (aSum - bSum) * dir;
}

// 複数キーソート対応: sort.list[] を順に評価し、最初に差が出たもので決定。
// 互換: 旧 sort.col / sort.dir / sort.custom も 1 件としてラップして扱う。
export function makeBucketComparator(dimIndex: number, dims: string[], sort: any, bucketsMap: Map<any, any[]>) {
  const list = sortListFrom(sort);
  if (!list.length) return (a: any, b: any) => dimSort(dims[dimIndex], a, b);
  return (a: any, b: any) => {
    for (const s of list) {
      const r = compareBySortEntry(s, a, b, dimIndex, dims, bucketsMap);
      if (r !== 0) return r;
    }
    return dimSort(dims[dimIndex], a, b);
  };
}
export function sortListFrom(sort: any): any[] {
  if (!sort) return [];
  if (Array.isArray(sort.list)) return sort.list.filter((it: any) => it && it.col);
  if (sort.col) return [{ col: sort.col, dir: sort.dir || 'asc', custom: sort.custom || '' }];
  return [];
}
