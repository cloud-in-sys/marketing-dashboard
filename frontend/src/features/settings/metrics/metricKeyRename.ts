// メトリクスキーのリネーム (old -> new) を、プリセット / タブ状態 / ライブ状態の
// **全参照サイト**へ波及させる純粋ロジック。
//
// メトリクス設定でキーを変えても、プリセット側の参照は追従しないため、リネームした
// メトリクスが列・カード・グラフ・しきい値から孤立する。それを防ぐためのキー付け替え。
//
// 参照サイト (1 つの「バンドル」= preset / TabState / ライブ収集 が持ちうる項目):
//   metrics[], metricOrder[], thresholdMetrics[]        … メトリクスキーの配列
//   thresholds{key}                                     … キーで引くオブジェクト
//   charts[].metric / .lines[].metric / .metric2..4     … グラフのメトリクス参照
//   cards[].metric / .subMetric                         … カードのメトリクス参照
//   tableConfig.styles/headerStyles/filters{colKey}     … colKey は metric key か 'dim:<k>'
//   tableConfig.sort.list[].col                         … 同上
//
// 対象外 (別途): 派生フォーミュラの**式の中**でのキー参照 (例 `ad_cost / clicks`)。
//   これは文字列トークナイズが要るため、このリネーム波及には含めない。
//
// import を持たないこと (node のテストが直接読めるように)。

interface MaybeRenamed { key: string; _origKey?: string }

/** ドラフト defs (各 def に _origKey を仕込んである) から old->new のリネーム表を作る。 */
export function computeRenames(draftDefs: MaybeRenamed[]): Record<string, string> {
  const renames: Record<string, string> = {};
  for (const d of draftDefs || []) {
    const orig = d && d._origKey;
    if (orig && d.key && orig !== d.key) renames[orig] = d.key;
  }
  return renames;
}

const rk = (k: unknown, r: Record<string, string>): unknown =>
  (typeof k === 'string' && Object.prototype.hasOwnProperty.call(r, k)) ? r[k] : k;

function remapArr(arr: unknown, r: Record<string, string>): { v: unknown; changed: boolean } {
  if (!Array.isArray(arr)) return { v: arr, changed: false };
  let changed = false;
  const v = arr.map((k) => { const nk = rk(k, r); if (nk !== k) changed = true; return nk; });
  return { v, changed };
}

function remapObjKeys(obj: unknown, r: Record<string, string>): { v: unknown; changed: boolean } {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { v: obj, changed: false };
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(obj as Record<string, unknown>)) {
    const nk = rk(k, r) as string;
    if (nk !== k) changed = true;
    out[nk] = val;
  }
  return { v: out, changed };
}

/**
 * バンドル (preset / TabState / ライブ収集オブジェクト) のメトリクスキー参照を付け替える。
 * 元は破壊せず、新しいバンドル (全項目を含む) と changed フラグを返す。
 */
export function remapMetricRefs(
  bundle: any,
  renames: Record<string, string>,
): { bundle: any; changed: boolean } {
  if (!bundle || !renames || !Object.keys(renames).length) return { bundle, changed: false };
  let changed = false;
  const out: any = { ...bundle };

  for (const field of ['metrics', 'metricOrder', 'thresholdMetrics']) {
    const rr = remapArr(bundle[field], renames);
    if (rr.changed) { out[field] = rr.v; changed = true; }
  }

  const th = remapObjKeys(bundle.thresholds, renames);
  if (th.changed) { out.thresholds = th.v; changed = true; }

  if (Array.isArray(bundle.charts)) {
    let cch = false;
    const charts = bundle.charts.map((c: any) => {
      if (!c || typeof c !== 'object') return c;
      const nc = { ...c };
      for (const f of ['metric', 'metric2', 'metric3', 'metric4']) {
        if (c[f] !== undefined) { const nk = rk(c[f], renames); if (nk !== c[f]) { nc[f] = nk; cch = true; } }
      }
      if (Array.isArray(c.lines)) {
        let lch = false;
        const lines = c.lines.map((ln: any) => {
          if (!ln || typeof ln !== 'object') return ln;
          const nk = rk(ln.metric, renames);
          if (nk !== ln.metric) { lch = true; return { ...ln, metric: nk }; }
          return ln;
        });
        if (lch) { nc.lines = lines; cch = true; }
      }
      return nc;
    });
    if (cch) { out.charts = charts; changed = true; }
  }

  if (Array.isArray(bundle.cards)) {
    let cch = false;
    const cards = bundle.cards.map((c: any) => {
      if (!c || typeof c !== 'object') return c;
      const nc = { ...c };
      for (const f of ['metric', 'subMetric']) {
        if (c[f] !== undefined) { const nk = rk(c[f], renames); if (nk !== c[f]) { nc[f] = nk; cch = true; } }
      }
      return nc;
    });
    if (cch) { out.cards = cards; changed = true; }
  }

  if (bundle.tableConfig && typeof bundle.tableConfig === 'object') {
    const tc: any = { ...bundle.tableConfig };
    let tch = false;
    for (const bucket of ['styles', 'headerStyles', 'filters']) {
      const rr = remapObjKeys(tc[bucket], renames);
      if (rr.changed) { tc[bucket] = rr.v; tch = true; }
    }
    if (tc.sort && Array.isArray(tc.sort.list)) {
      let sch = false;
      const list = tc.sort.list.map((it: any) => {
        if (!it || typeof it !== 'object') return it;
        const nk = rk(it.col, renames);
        if (nk !== it.col) { sch = true; return { ...it, col: nk }; }
        return it;
      });
      if (sch) { tc.sort = { ...tc.sort, list }; tch = true; }
    }
    if (tch) { out.tableConfig = tc; changed = true; }
  }

  return { bundle: out, changed };
}
