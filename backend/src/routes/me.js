import { Hono } from 'hono';
import { db } from '../firebase.js';

const app = new Hono();

app.get('/', c => {
  const user = c.get('user');
  return c.json({ user });
});

// 自分のソース毎ユーザー状態を取得 (フィルタ + 最後に開いたタブ等)
//   GET /api/me/state/:sid
//   レスポンス: { state: { tabFilters: { [viewKey]: {...} }, currentView } }
app.get('/state/:sid', async c => {
  const uid = c.get('uid');
  const sid = c.req.param('sid');
  const snap = await db.collection('users').doc(uid).get();
  const all = snap.exists ? (snap.data().userState || {}) : {};
  return c.json({ state: all[sid] || {} });
});

// 自分のソース毎ユーザー状態を更新
//   PUT /api/me/state/:sid
//   ボディ: { state: { tabFilters?, currentView? } } — 該当ソース全体を置換
app.put('/state/:sid', async c => {
  const uid = c.get('uid');
  const sid = c.req.param('sid');
  const body = await c.req.json();
  const state = (body && typeof body.state === 'object') ? body.state : {};
  await db.collection('users').doc(uid).update({
    [`userState.${sid}`]: state,
  });
  return c.json({ ok: true });
});

export default app;
