// @ts-check
import { Hono } from 'hono';
import { Storage } from '@google-cloud/storage';
import zlib from 'zlib';
import { promisify } from 'util';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { db } from '../firebase.js';
import { getSecret } from '../utils/secrets.js';
import { requirePerm } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import { requireSourceAccess, getGroupFilter, matchGroupFilter } from '../aggregate/sourceAccess.js';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const storage = new Storage();
// バケット名は環境ごとの値なので env から取る。無ければ GCP_PROJECT_ID から導出。
// どちらも無ければ起動時に落とす。既定のバケット名にフォールバックすると、
// 設定を忘れた環境が別環境のスナップショットを黙って読んでしまう。
const BUCKET = process.env.SNAPSHOT_BUCKET
  || (process.env.GCP_PROJECT_ID ? `${process.env.GCP_PROJECT_ID}-snapshots` : null);
if (!BUCKET) throw new Error('SNAPSHOT_BUCKET or GCP_PROJECT_ID must be set');
const bucket = () => storage.bucket(BUCKET);
const objectName = (sid) => `snapshots/${sid}.json.gz`;

const app = new Hono();

// Return latest snapshot for a source.
// 可視性: utils/sourceVisibility.js の sourceVisible が唯一の基準。
// 行絞り込み:
//   admin → 絞らない
//   非 admin かつ groupId あり → group.sourceFilters[sid] を適用
//   (非 admin かつ未分類は可視性チェックで弾かれるので到達しない)
app.get('/:sid', async c => {
  const sid = c.req.param('sid');
  const user = c.get('user');

  // (1) 可視性チェック (共通ヘルパー)
  await requireSourceAccess(user, sid);

  // (2) スナップショット取得
  const file = bucket().file(objectName(sid));
  const [exists] = await file.exists();
  if (!exists) return c.json({ rows: [], updatedAt: null });
  const [meta] = await file.getMetadata();
  // GCS メタは string|number|boolean を取り得る型なので、ヘッダ/ハッシュ用に文字列化する
  // (実体は ISO 文字列。String() は文字列に対しては恒等)。
  const updatedAt = String(meta.metadata?.updatedAt || meta.updated || '');

  // (3) 行絞り込みの条件を決定 (共通ヘルパー)
  const filter = await getGroupFilter(user, sid);

  // (4) ETag
  const filterKey = filter ? JSON.stringify(filter) : '';
  const etag = `W/"${hashFast(`${updatedAt}|${user.uid}|${filterKey}`)}"`;
  const ifNoneMatch = c.req.header('If-None-Match');
  if (ifNoneMatch && ifNoneMatch === etag) {
    c.header('ETag', etag);
    c.header('Cache-Control', 'private, no-cache');
    return c.body(null, 304);
  }

  // (5) 絞り込み不要なら圧縮済み buf をそのまま返す
  const [buf] = await file.download();
  if (!filter) {
    c.header('Content-Encoding', 'gzip');
    c.header('Content-Type', 'application/json');
    c.header('ETag', etag);
    c.header('Cache-Control', 'private, no-cache');
    c.header('X-Snapshot-Updated-At', updatedAt);
    // Node の Buffer は Hono の body 型に含まれないが node-server は受理する。
    return c.body(/** @type {any} */ (buf));
  }

  // (6) 絞り込み: 解凍→フィルタ→再圧縮
  const json = (await gunzip(buf)).toString('utf8');
  const parsed = JSON.parse(json);
  const allRows = Array.isArray(parsed.rows) ? parsed.rows : [];
  const filtered = allRows.filter(row => matchGroupFilter(row, filter));
  const outBuf = await gzip(Buffer.from(JSON.stringify({ rows: filtered }), 'utf8'));
  c.header('Content-Encoding', 'gzip');
  c.header('Content-Type', 'application/json');
  c.header('ETag', etag);
  c.header('Cache-Control', 'private, no-cache');
  c.header('X-Snapshot-Updated-At', updatedAt);
  c.header('X-Snapshot-Filtered-Rows', String(filtered.length));
  return c.body(/** @type {any} */ (outBuf));
});

// ETag 用の軽量ハッシュ (djb2)
function hashFast(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

// 「定期更新の優先アカウント」= source.createdBy の表示名 + その人が今も Google 連携中か。
// sheets/bq ソースかつ createdBy がある場合のみ生成。連携判定は token doc の存在
// (GET /api/google/status と同基準)。返すのは name と connected のみで、
// トークン値 / refreshToken / uid は絶対に含めない。
async function buildConnector(source) {
  const method = source?.method || '';
  const createdBy = source?.createdBy;
  if ((method !== 'sheets' && method !== 'bq') || !createdBy) return null; // CSV / レガシー
  const userRef = db.collection('users').doc(createdBy);
  const [userSnap, tokenSnap] = await Promise.all([
    userRef.get(),
    userRef.collection('tokens').doc('google').get(),
  ]);
  const profile = userSnap.exists ? userSnap.data() : null;
  const name = profile?.name || profile?.email || null;
  if (!name) return null;
  return { name, connected: tokenSnap.exists };
}

// Return just metadata (fast, for UI)
app.get('/:sid/meta', async c => {
  const sid = c.req.param('sid');
  const user = c.get('user');
  // requireSourceAccess は source data を返す (60s キャッシュ)。source doc を再取得しない。
  const source = await requireSourceAccess(user, sid);
  // connector は admin / manageSources 保有者にだけ返す (UI 非表示だけでは API 直叩きで
  // 氏名・連携状態が漏れる)。閲覧者には null を返し、追加の Firestore read もしない。
  // meta 本体 (exists/updatedAt/rows) は閲覧者の集計にも必要なので、connector の read が
  // 失敗しても 500 にせず connector: null にフォールバックする。
  const canViewConnector = user?.isAdmin || user?.perms?.manageSources;
  let connector = null;
  if (canViewConnector) {
    try { connector = await buildConnector(source); }
    catch (e) { connector = null; }
  }
  const file = bucket().file(objectName(sid));
  const [exists] = await file.exists();
  if (!exists) return c.json(/** @type {import('@pkg/shared/api-types.ts').SnapshotMetaResult} */ ({ exists: false, connector }));
  const [meta] = await file.getMetadata();
  /** @type {import('@pkg/shared/api-types.ts').SnapshotMetaResult} */
  const res = {
    exists: true,
    updatedAt: String(meta.metadata?.updatedAt || meta.updated || ''),
    rows: Number(meta.metadata?.rows || 0),
    connector,
  };
  return c.json(res);
});

// Refresh a single source's snapshot.
// Uses the CALLER's Google OAuth token (not createdBy)
// manageSources だけでは「どのソースでも更新してよい」ことにならないので、
// 見えるソースかどうかも確認する (別グループの非公開ソースを更新させない)。
app.post('/:sid/refresh', requirePerm('manageSources'), async c => {
  const sid = c.req.param('sid');
  const uid = c.get('uid');
  await requireSourceAccess(c.get('user'), sid);
  const result = await refreshSnapshot(sid, uid);
  return c.json(result);
});

// ユーザー doc が存在する = まだ在籍しているか。削除済みユーザーの残留トークンを
// 使わないための確認。users.js の削除処理でトークンも消しているが、そちらが
// 失敗した場合の保険としてここでも見る (fail-closed)。
async function isActiveUser(uid) {
  if (!uid) return false;
  const snap = await db.collection('users').doc(uid).get();
  return snap.exists;
}

// 1 ページあたりのユーザー数と、探索するユーザー数の上限。
// 上限は無限ループ / 全件大量読み込みの歯止め。到達したらログを出して諦める。
const USER_SCAN_PAGE = 25;
const USER_SCAN_MAX = 1000;

// Find any user that has a Google connection (for batch refresh fallback).
//
// users をページングして、各ユーザーの google トークンを見る。
// 以前は collectionGroup('tokens').limit(10) で先頭 10 件だけを見ていたため、
//   - 有効な連携ユーザーが 11 件目以降にいると見つけられない
//   - 先頭 10 件が削除済みユーザーの残留トークンだと候補ゼロになる
// という問題があった。users 側から辿れば、削除済みユーザーのトークンは
// 構造上いっさい候補に入らない (ユーザー doc が無ければ辿り着かない)。
async function findAnyConnectedUser() {
  let last = null;
  let scanned = 0;
  while (scanned < USER_SCAN_MAX) {
    let q = db.collection('users').orderBy('__name__').limit(USER_SCAN_PAGE);
    if (last) q = q.startAfter(last);
    const page = await q.get();
    if (page.empty) return null;
    // このページぶんのトークンをまとめて確認 (直列だと人数ぶん待つため)
    const tokens = await Promise.all(
      page.docs.map(d => d.ref.collection('tokens').doc('google').get())
    );
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].exists && tokens[i].data()?.refreshToken) return page.docs[i].id;
    }
    scanned += page.size;
    if (page.size < USER_SCAN_PAGE) return null;   // 最終ページまで見て候補なし
    last = page.docs[page.docs.length - 1];
  }
  console.log(JSON.stringify({
    severity: 'WARNING',
    message: 'findAnyConnectedUser hit scan limit without finding a connected user',
    scanned, limit: USER_SCAN_MAX,
  }));
  return null;
}

// Batch refresh all sources (for Cloud Scheduler). Tries createdBy first,
// falls back to any connected user.
export async function refreshAll() {
  const sources = await db.collection('sources').get();
  const fallback = await findAnyConnectedUser();
  const results = [];
  for (const s of sources.docs) {
    try {
      // Prefer createdBy if they are still an active user AND have a Google connection.
      // 在籍確認をしないと、削除ユーザーの残留トークンで更新が回り続ける。
      let uid = s.data().createdBy;
      if (uid) {
        const [active, t] = await Promise.all([
          isActiveUser(uid),
          db.collection('users').doc(uid).collection('tokens').doc('google').get(),
        ]);
        if (!active || !t.exists) uid = fallback;
      } else {
        uid = fallback;
      }
      if (!uid) throw new Error('No user has a Google connection');
      const r = await refreshSnapshot(s.id, uid);
      results.push({ id: s.id, ...r });
    } catch (e) {
      results.push({ id: s.id, error: e.message });
    }
  }
  return results;
}

async function getOAuthClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = await getSecret('google-oauth-client-secret');
  const redirectUri = process.env.OAUTH_REDIRECT_URI;
  return new OAuth2Client(clientId, clientSecret, redirectUri);
}

async function getAuthorizedClientFor(uid) {
  const tokenRef = db.collection('users').doc(uid).collection('tokens').doc('google');
  const snap = await tokenRef.get();
  if (!snap.exists) throw new Error('Google連携されていません。連携ボタンから接続してください。');
  const { refreshToken, accessToken, expiryDate } = snap.data();
  const oauth = await getOAuthClient();
  oauth.setCredentials({
    refresh_token: refreshToken,
    access_token: accessToken,
    expiry_date: expiryDate,
  });
  oauth.on('tokens', async tokens => {
    const patch = { updatedAt: new Date().toISOString() };
    if (tokens.access_token) patch.accessToken = tokens.access_token;
    if (tokens.expiry_date) patch.expiryDate = tokens.expiry_date;
    if (tokens.refresh_token) patch.refreshToken = tokens.refresh_token;
    await tokenRef.set(patch, { merge: true });
  });
  // トークン有効性チェック — invalid_grant なら自動削除して再連携を促す
  try {
    await oauth.getAccessToken();
  } catch (e) {
    const msg = String(e?.response?.data?.error || e.message || e);
    if (/invalid_grant|invalid_rapt/.test(msg)) {
      await tokenRef.delete();
      throw new Error('Google連携の有効期限が切れました。再度連携してください。');
    }
    throw e;
  }
  return oauth;
}

// Fetch rows from BQ or Sheets using the given user's OAuth token
async function fetchRows(source, uid) {
  if (!uid) throw new Error('No uid provided for fetch');
  const auth = await getAuthorizedClientFor(uid);

  if (source.method === 'sheets') {
    const { url, tab } = source.sheetsInput || {};
    if (!url || !tab) throw new Error('sheetsInput not configured');
    const idMatch = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(url);
    const spreadsheetId = idMatch ? idMatch[1] : (/^[a-zA-Z0-9_-]{20,}$/.test(url.trim()) ? url.trim() : null);
    if (!spreadsheetId) throw new Error('Invalid spreadsheet URL');
    const sheets = google.sheets({ version: 'v4', auth });
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: tab });
    const values = res.data.values || [];
    if (values.length < 2) return [];
    const header = values[0].map(h => String(h).trim());
    const rows = [];
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      if (!row || row.every(v => v === '' || v == null)) continue;
      const obj = {};
      header.forEach((h, j) => { obj[h] = row[j] != null ? String(row[j]) : ''; });
      rows.push(obj);
    }
    return rows;
  }

  if (source.method === 'bq') {
    const { project, query } = source.bqInput || {};
    if (!project || !query) throw new Error('bqInput not configured');
    const bigquery = google.bigquery({ version: 'v2', auth });
    const qres = await bigquery.jobs.query({
      projectId: project,
      requestBody: { query, useLegacySql: false, maxResults: 50000, timeoutMs: 60000 },
    });
    const jobId = qres.data.jobReference?.jobId;
    const location = qres.data.jobReference?.location;
    const fields = (qres.data.schema?.fields || []).map(f => f.name);
    const toRow = r => {
      const obj = {};
      (r.f || []).forEach((cell, i) => { obj[fields[i]] = cell.v; });
      return obj;
    };
    const rows = (qres.data.rows || []).map(toRow);
    let pageToken = qres.data.pageToken;
    const MAX_ROWS = 1000000;
    while (pageToken && rows.length < MAX_ROWS) {
      const next = await bigquery.jobs.getQueryResults({
        projectId: project, jobId, location, pageToken, maxResults: 50000,
      });
      (next.data.rows || []).forEach(r => rows.push(toRow(r)));
      pageToken = next.data.pageToken;
    }
    return rows;
  }

  throw new Error(`Unsupported source method: ${source.method}`);
}

async function refreshSnapshot(sid, uid) {
  const srcSnap = await db.collection('sources').doc(sid).get();
  if (!srcSnap.exists) throw httpError(404, 'Source not found');
  const source = srcSnap.data();
  if (!source.method) throw httpError(400, 'Source method not configured');

  const rows = await fetchRows(source, uid);
  const json = JSON.stringify({ rows });
  const compressed = await gzip(Buffer.from(json, 'utf8'));
  const updatedAt = new Date().toISOString();

  const file = bucket().file(objectName(sid));
  // contentEncoding は GCS の SaveOptions 型に無いが実行時は有効。options ごとキャストする。
  await file.save(compressed, /** @type {any} */ ({
    contentType: 'application/json',
    contentEncoding: 'gzip',
    metadata: {
      metadata: { updatedAt, rows: String(rows.length) },
    },
  }));

  return { updatedAt, rows: rows.length };
}

export default app;
