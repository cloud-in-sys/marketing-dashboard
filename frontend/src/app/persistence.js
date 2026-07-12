// Persistence layer: debounced writes to backend API.
// Keeps synchronous call-site ergonomics (saveXxx() returns immediately),
// and batches per-source config writes into PATCH requests.
//
// 重要な不変条件:
// - pending patch は sourceId ごとに分離 (_pending: Map<sid, patch>)。
//   source 切替で patch が別 source に混入しない。
// - 同じ sid に対する flush は _chain でシリアライズ。並行 PATCH を防ぐ。
// - drain ループで「呼び出し時点までに積まれた pending を完全に PATCH 完了」を保証。
//   in-flight 中に queueConfigPatch された分も同じ flushConfigNow() の await で拾う。
// - PATCH 失敗時は同じ sid の _pending に戻す (新しく上書きされた key は新値を優先)。

import { api } from '../api/index.js';

const CONFIG_DEBOUNCE_MS = 600;

let currentSid = null;
const _pending = new Map();   // sid -> partial patch object (mutable)
const _timers = new Map();    // sid -> setTimeout id
const _chain = new Map();     // sid -> Promise (直近の flush)

function ensurePending(sid) {
  let p = _pending.get(sid);
  if (!p) { p = {}; _pending.set(sid, p); }
  return p;
}

function clearDebounce(sid) {
  const t = _timers.get(sid);
  if (t) { clearTimeout(t); _timers.delete(sid); }
}

// 1 つの sid の pending を空になるまで PATCH し続ける。
// 途中で queueConfigPatch が走っても、次のループで拾う (= drain)。
async function doFlush(sid, opts) {
  while (true) {
    const pending = _pending.get(sid);
    if (!pending || Object.keys(pending).length === 0) return;
    // snapshot + clear: in-flight 中に積まれる新 patch は別バッチ扱いになる。
    _pending.set(sid, {});
    const patch = pending;
    try {
      await api.patchConfig(sid, patch, opts);
    } catch (e) {
      console.warn('[persistence] config patch failed', e);
      // 失敗した patch を同じ sid に戻す。
      // ただし in-flight 中に上書きされた key は新値を優先 (古い値で潰さない)。
      const back = ensurePending(sid);
      for (const k of Object.keys(patch)) {
        if (!(k in back)) back[k] = patch[k];
      }
      throw e;
    }
  }
}

// 同じ sid に対する flush を Promise チェーンでシリアライズ。
// 前回が失敗 (reject) しても catch でチェーンを継続させる。
// 呼び出し元には次の doFlush から throw が伝播する。
function flushConfigForSid(sid, opts) {
  if (!sid) return Promise.resolve();
  clearDebounce(sid);
  const prev = _chain.get(sid) || Promise.resolve();
  const next = prev.catch(() => {}).then(() => doFlush(sid, opts));
  _chain.set(sid, next);
  // チェーン末尾が落ち着いたら Map エントリを掃除 (リーク防止)。
  // 別の flush が割り込んで _chain[sid] を上書きしていれば手を出さない。
  next.catch(() => {}).finally(() => {
    if (_chain.get(sid) === next) _chain.delete(sid);
  });
  return next;
}

// 現在の sid を切替。旧 sid の pending は旧 sid に紐づけたまま flush を投げる
// (sid を閉じ込めた flushConfigForSid なので、新 sid への混線は無い)。
// 失敗した patch は旧 sid の _pending に戻る → 次回その source に戻った時に再送される。
export function setCurrentSourceId(sid) {
  const oldSid = currentSid;
  if (oldSid && oldSid !== sid) {
    // 旧 source の flush は fire-and-forget (UI ブロックを避ける)。
    // _chain が直列化を保証するので新 sid の操作と混ざらない。
    flushConfigForSid(oldSid).catch(() => { /* 失敗時は _pending に戻っている */ });
  }
  currentSid = sid;
}

// patch を currentSid の bucket に merge し、debounce 経由で flush をスケジュール。
// patch を queue した時点の sid を閉じ込めるので、後で currentSid が変わっても
// この patch は元の sid に紐づき続ける。
export function queueConfigPatch(patch) {
  if (!currentSid) return;
  const sid = currentSid;
  const bucket = ensurePending(sid);
  Object.assign(bucket, patch);
  clearDebounce(sid);
  _timers.set(sid, setTimeout(() => {
    flushConfigForSid(sid).catch(() => { /* debounce 経由の失敗は _pending に戻って次の debounce で再送 */ });
  }, CONFIG_DEBOUNCE_MS));
}

// 現在の sid の pending を完全に PATCH 完了させる。
// 戻り値の Promise が resolve した時点で同 sid の pending は空 (drain 完了)。
// 失敗時は throw して呼び出し元 (保存ボタン等) に伝える。
export async function flushConfigNow(opts) {
  return flushConfigForSid(currentSid, opts);
}

// 明示的な保存失敗時に、リトライさせたくない patch key を _pending から削除する。
// 通常の debounce 経由の失敗 (背景書き込み) は自動リトライして良いが、
// ユーザーが保存ボタンで押した式が backend で 400 なら「そのまま同じ値を再送」
// しても再度弾かれるだけなので、明示的に落とす方が UX が良い。
// (draft は UI 側で保持されるので、修正して再保存 → queueConfigPatch で上書きされる)
export function clearPendingConfigKeys(keys) {
  if (!currentSid) return;
  const p = _pending.get(currentSid);
  if (!p) return;
  for (const k of keys) delete p[k];
}
