// @ts-check
// データソースの可視性チェック + group sourceFilter の取得。
// /api/snapshots と /api/aggregate で共有する。
//
// 可視性ルールは utils/sourceVisibility.js の sourceVisible が唯一の基準。
//
// 行絞り込みルール:
//   admin → なし
//   非 admin かつ groupId あり → group.sourceFilters[sid] があれば適用
//   (非 admin かつ未分類は可視性ルールで弾かれるので到達しない)

import { db } from '../firebase.js';
import { httpError } from '../middleware/error.js';
import { sourceVisible } from '../utils/sourceVisibility.js';
import { validateGroupFilter } from '../utils/groupFilter.js';
import { readTtlMs } from '../utils/env.js';

// メモリキャッシュ: 同じ source / group に対する Firestore read を間引く。
// /api/aggregate, /api/aggregate/options, /api/aggregate/columns で多発する
// requireSourceAccess + getGroupFilter のコストを大幅に削れる。
//
// ■ 既知の仕様: 可視性 / 行フィルタの変更が最大 TTL 秒ぶん遅れる
//   middleware/auth.js のユーザーキャッシュと同じで、インスタンスごとのメモリ上に
//   あるため invalidateSourceAccessCache() は他インスタンスに届かない。
//   source の allowedGroupIds や group の sourceFilters を絞る変更をしても、
//   他インスタンスでは最大 TTL 秒のあいだ旧設定で見えることがある。
//   SOURCE_ACCESS_TTL_SECONDS=0 で無効化できる (毎回 Firestore を読む)。
const ACCESS_TTL_MS = readTtlMs('SOURCE_ACCESS_TTL_SECONDS', 60);
const sourceDocCache = new Map();    // sid -> { source, expireAt }
const groupFilterCache = new Map();  // sid|groupId|admin -> { filter, expireAt }
function cacheGet(map, key) {
  const e = map.get(key);
  if (!e) return null;
  if (Date.now() > e.expireAt) { map.delete(key); return null; }
  return e;
}
function cacheSet(map, key, value) {
  if (ACCESS_TTL_MS <= 0) return;   // TTL=0 → キャッシュ無効 (毎回 Firestore を読む)
  if (map.size >= 200) {
    const oldest = map.keys().next().value;
    if (oldest) map.delete(oldest);
  }
  map.set(key, { ...value, expireAt: Date.now() + ACCESS_TTL_MS });
}
export function invalidateSourceAccessCache(sid) {
  if (sid) {
    sourceDocCache.delete(sid);
    for (const k of [...groupFilterCache.keys()]) if (k.startsWith(sid + '|')) groupFilterCache.delete(k);
  } else {
    sourceDocCache.clear();
    groupFilterCache.clear();
  }
}

// 可視性チェック。NG なら httpError を throw。OK なら source data を返す。
export async function requireSourceAccess(user, sid) {
  // source doc 60s キャッシュ
  let source = cacheGet(sourceDocCache, sid)?.source;
  if (!source) {
    const srcSnap = await db.collection('sources').doc(sid).get();
    if (!srcSnap.exists) throw httpError(404, 'Source not found');
    source = srcSnap.data();
    cacheSet(sourceDocCache, sid, { source });
  }
  if (!sourceVisible(user, source)) {
    throw httpError(403, 'このデータソースへのアクセス権がありません');
  }
  return source;
}

// 壊れたフィルタ設定に当たった時の番人。「絞り込みなし」(null) と区別するために
// 専用の番兵を返す。null にしてしまうと全行素通しになり fail-open になる。
const DENY_ALL = Object.freeze({ __deny: true, field: '', op: '__invalid__' });

// 非 admin + group 所属時の sourceFilter を取得。null = 絞り込みなし。
// 設定が壊れている場合は DENY_ALL を返す (fail-closed)。
export async function getGroupFilter(user, sid) {
  if (user.isAdmin) return null;
  if (!user.groupId) return null;
  const key = `${sid}|${user.groupId}`;
  const cached = cacheGet(groupFilterCache, key);
  if (cached) return cached.filter || null;
  const gSnap = await db.collection('groups').doc(user.groupId).get();
  let filter = null;
  if (gSnap.exists) {
    const sf = (gSnap.data().sourceFilters || {})[sid];
    if (sf != null) {
      const err = validateGroupFilter(sf);
      if (err) {
        // 保存時にも検証しているが、旧データや直接書き換えで壊れている可能性がある。
        // 「読めない設定 = 絞り込み不能」なので全行拒否にする。
        console.log(JSON.stringify({
          severity: 'ERROR',
          message: 'invalid group row filter in Firestore — denying all rows (fail-closed)',
          groupId: user.groupId, sid, reason: err,
        }));
        filter = DENY_ALL;
      } else if (sf.field) {
        filter = sf;
      }
      // field 未設定 (絞り込みなし) は filter = null のまま = 全行対象
    }
  }
  cacheSet(groupFilterCache, key, { filter });
  return filter;
}

// 正規表現キャッシュ (group filter 用)。
const _regexCache = new Map();
function getRegex(pattern) {
  if (_regexCache.has(pattern)) return _regexCache.get(pattern);
  let entry;
  try { entry = { ok: true, re: new RegExp(pattern) }; }
  catch { entry = { ok: false, re: null }; }
  _regexCache.set(pattern, entry);
  return entry;
}

// 不正フィルタのログを 1 設定につき 1 回だけ出す (行数ぶん出さない)。
const _loggedBadFilters = new Set();
function logBadFilter(f, reason) {
  const key = `${f?.field}|${f?.op}|${reason}`;
  if (_loggedBadFilters.has(key)) return;
  if (_loggedBadFilters.size > 100) _loggedBadFilters.clear();
  _loggedBadFilters.add(key);
  console.log(JSON.stringify({
    severity: 'ERROR',
    message: 'invalid group row filter — denying all rows (fail-closed)',
    field: f?.field, op: f?.op, reason,
  }));
}

// group sourceFilter に基づく単一行マッチ判定。
//
// 重要: 行フィルタは認可の一部なので fail-closed にする。未知の op や壊れた
// 正規表現を「一致」として扱うと、設定が壊れた瞬間に全行が見えてしまう。
// 判定できない場合は必ず false (= その行は見せない) を返す。
// なお「フィルタ自体が無い」(f が null / field 未設定) は getGroupFilter が
// null を返して applyGroupFilter が素通しするため、ここには到達しない。
export function matchGroupFilter(row, f) {
  if (f?.__deny) return false;       // 壊れた設定 (getGroupFilter が DENY_ALL を返した)
  if (!f || !f.field) return true;   // 絞り込み条件なし = 全行対象 (fail-closed の対象外)
  const v = row[f.field];
  if (f.op === 'equals') return String(v) === String(f.value ?? '');
  if (f.op === 'in' || f.op === 'notIn') {
    if (!Array.isArray(f.values)) { logBadFilter(f, 'values is not an array'); return false; }
    const hit = f.values.some(x => String(v) === String(x));
    return f.op === 'in' ? hit : !hit;
  }
  if (f.op === 'regex' || f.op === 'notRegex') {
    const r = getRegex(String(f.value ?? ''));
    if (!r.ok) { logBadFilter(f, 'invalid regex'); return false; }
    const hit = r.re.test(String(v ?? ''));
    return f.op === 'regex' ? hit : !hit;
  }
  logBadFilter(f, 'unknown op');
  return false;
}

// rows に group filter を適用 (filter=null なら元配列をそのまま返す)。
export function applyGroupFilter(rows, filter) {
  if (!filter) return rows;
  return rows.filter(r => matchGroupFilter(r, filter));
}
