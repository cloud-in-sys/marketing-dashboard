// データソースの可視性チェック + group sourceFilter の取得。
// /api/snapshots と /api/aggregate で共有する。
//
// 可視性ルール:
//   admin                                                        → 全部 OK
//   非 admin かつ groupId なし (未分類)                         → 全部拒否
//   非 admin かつ allowedGroupIds 空 かつ isPublic !== false     → OK (公開)
//   非 admin かつ allowedGroupIds 空 かつ isPublic === false     → 拒否 (非公開)
//   非 admin かつ allowedGroupIds あり かつ自分の groupId 含む   → OK
//   それ以外                                                     → 拒否
//
// 行絞り込みルール:
//   admin → なし
//   非 admin かつ groupId あり → group.sourceFilters[sid] があれば適用
//   (非 admin かつ未分類は上の可視性ルールで弾かれるので到達しない)

import { db } from '../firebase.js';
import { httpError } from '../middleware/error.js';

// 60 秒メモリキャッシュ: 同じ source / group に対する Firestore read を間引く。
// admin の権限編集や source の allowedGroupIds 変更は 60 秒以内に反映されないが、
// /api/aggregate, /api/aggregate/options, /api/aggregate/columns で多発する
// requireSourceAccess + getGroupFilter のコストを大幅に削れる。
const ACCESS_TTL_MS = 60 * 1000;
const sourceDocCache = new Map();    // sid -> { source, expireAt }
const groupFilterCache = new Map();  // sid|groupId|admin -> { filter, expireAt }
function cacheGet(map, key) {
  const e = map.get(key);
  if (!e) return null;
  if (Date.now() > e.expireAt) { map.delete(key); return null; }
  return e;
}
function cacheSet(map, key, value) {
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
// 一覧ルート (routes/sources.js GET /) と同じ判定で揃える:
//   admin                                                        → 全部 OK
//   非 admin かつ未分類                                          → 拒否
//   非 admin かつ allowedGroupIds 空 かつ isPublic !== false     → OK (公開)
//   非 admin かつ allowedGroupIds 空 かつ isPublic === false     → 拒否 (非公開)
//   非 admin かつ allowedGroupIds あり かつ自分の groupId 含む   → OK
export async function requireSourceAccess(user, sid) {
  // source doc 60s キャッシュ
  let source = cacheGet(sourceDocCache, sid)?.source;
  if (!source) {
    const srcSnap = await db.collection('sources').doc(sid).get();
    if (!srcSnap.exists) throw httpError(404, 'Source not found');
    source = srcSnap.data();
    cacheSet(sourceDocCache, sid, { source });
  }
  if (!user.isAdmin) {
    // 未分類ユーザーはどのソースにもアクセスできない (admin が group 設定するまで)
    if (!user.groupId) {
      throw httpError(403, 'このデータソースへのアクセス権がありません');
    }
    const allowed = source.allowedGroupIds || [];
    if (allowed.length === 0) {
      if (source.isPublic === false) {
        throw httpError(403, 'このデータソースへのアクセス権がありません');
      }
      // isPublic !== false (true or undefined) → 公開
    } else if (!allowed.includes(user.groupId)) {
      throw httpError(403, 'このデータソースへのアクセス権がありません');
    }
  }
  return source;
}

// 非 admin + group 所属時の sourceFilter を取得。null = 絞り込みなし。
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
    if (sf && sf.field) filter = sf;
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

// group sourceFilter に基づく単一行マッチ判定。
export function matchGroupFilter(row, f) {
  if (!f || !f.field) return true;
  const v = row[f.field];
  if (f.op === 'equals') return String(v) === String(f.value ?? '');
  if (f.op === 'in') return Array.isArray(f.values) && f.values.some(x => String(v) === String(x));
  if (f.op === 'notIn') return Array.isArray(f.values) && !f.values.some(x => String(v) === String(x));
  if (f.op === 'regex') {
    const r = getRegex(String(f.value ?? ''));
    return r.ok ? r.re.test(String(v ?? '')) : true;
  }
  if (f.op === 'notRegex') {
    const r = getRegex(String(f.value ?? ''));
    return r.ok ? !r.re.test(String(v ?? '')) : true;
  }
  return true;
}

// rows に group filter を適用 (filter=null なら元配列をそのまま返す)。
export function applyGroupFilter(rows, filter) {
  if (!filter) return rows;
  return rows.filter(r => matchGroupFilter(r, filter));
}
