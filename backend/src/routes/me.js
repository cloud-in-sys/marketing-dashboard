// @ts-check
import { Hono } from 'hono';
import { db } from '../firebase.js';
import { httpError } from '../middleware/error.js';
import { requireSourceAccess } from '../middleware/auth.js';

const app = new Hono();

app.get('/', c => {
  const user = c.get('user');
  /** @type {import('@pkg/shared/api-types.ts').MeResult} */
  const res = { user };
  return c.json(res);
});

// userState に保存してよいのは tabFilters / currentView だけ (下の sanitizeUserState が
// このキーだけを拾う)。それ以外は黙って捨てる。
// state は users/{uid} 本体の 1 フィールドなので、野放しにすると doc が肥大化して
// Firestore の 1MB 上限に当たり、そのユーザーが一切ログインできなくなる。
// 1 ソース分の userState のサイズ上限。tabFilters は「タブ × フィルタの選択値」なので
// 通常は数 KB。極端に大きいものは壊れた入力とみなす。
const MAX_STATE_BYTES = 256 * 1024;

const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);

// 受信した state を許可キーだけに絞り、型とサイズを検証する。
// 戻り値: { error } か { state }
function sanitizeUserState(raw) {
  if (raw === undefined || raw === null) return { state: {} };
  if (!isPlainObject(raw)) return { error: 'state must be an object' };
  const out = {};
  if ('tabFilters' in raw) {
    if (!isPlainObject(raw.tabFilters)) return { error: 'state.tabFilters must be an object' };
    out.tabFilters = raw.tabFilters;
  }
  if ('currentView' in raw) {
    if (raw.currentView !== null && typeof raw.currentView !== 'string') {
      return { error: 'state.currentView must be a string or null' };
    }
    out.currentView = raw.currentView;
  }
  // ALLOWED_STATE_KEYS 以外は out に入れない = 保存されない
  const bytes = Buffer.byteLength(JSON.stringify(out), 'utf8');
  if (bytes > MAX_STATE_BYTES) {
    return { error: `state too large: ${bytes} bytes (max ${MAX_STATE_BYTES})` };
  }
  return { state: out };
}

// 自分のソース毎ユーザー状態を取得 (フィルタ + 最後に開いたタブ等)
//   GET /api/me/state/:sid
//   レスポンス: { state: { tabFilters: { [viewKey]: {...} }, currentView } }
// アクセスできないソースの状態は読ませない (存在確認にも使わせない)。
app.get('/state/:sid', requireSourceAccess(), async c => {
  const uid = c.get('uid');
  const sid = c.req.param('sid');
  const snap = await db.collection('users').doc(uid).get();
  const all = snap.exists ? (snap.data().userState || {}) : {};
  /** @type {import('@pkg/shared/api-types.ts').MyStateResult} */
  const res = { state: all[sid] || {} };
  return c.json(res);
});

// 自分のソース毎ユーザー状態を更新
//   PUT /api/me/state/:sid
//   ボディ: { state: { tabFilters?, currentView? } } — 該当ソース全体を置換
// requireSourceAccess が無いと、存在しない sid を大量に書き込んで users/{uid} を
// 肥大化させられる (自分の doc とはいえ、壊れるとログイン不能になる)。
app.put('/state/:sid', requireSourceAccess(), async c => {
  const uid = c.get('uid');
  const sid = c.req.param('sid');
  const body = await c.req.json();
  const r = sanitizeUserState(body?.state);
  if (r.error) throw httpError(400, r.error);
  await db.collection('users').doc(uid).update({
    [`userState.${sid}`]: r.state,
  });
  return c.json({ ok: true });
});

export default app;
