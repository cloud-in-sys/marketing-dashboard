// @ts-check
import { Hono } from 'hono';
import { Storage } from '@google-cloud/storage';
import zlib from 'zlib';
import { promisify } from 'util';
import { google } from 'googleapis';
import { db } from '../firebase.js';
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

// Return just metadata (fast, for UI)
app.get('/:sid/meta', async c => {
  const sid = c.req.param('sid');
  const user = c.get('user');
  await requireSourceAccess(user, sid);
  const file = bucket().file(objectName(sid));
  const [exists] = await file.exists();
  if (!exists) return c.json(/** @type {import('@pkg/shared/api-types.ts').SnapshotMetaResult} */ ({ exists: false }));
  const [meta] = await file.getMetadata();
  /** @type {import('@pkg/shared/api-types.ts').SnapshotMetaResult} */
  const res = {
    exists: true,
    updatedAt: String(meta.metadata?.updatedAt || meta.updated || ''),
    rows: Number(meta.metadata?.rows || 0),
  };
  return c.json(res);
});

// Refresh a single source's snapshot.
// 更新はサービスアカウント (ADC) で行う。実行者本人の Google 連携は不要。
// manageSources だけでは「どのソースでも更新してよい」ことにならないので、
// 見えるソースかどうかも確認する (別グループの非公開ソースを更新させない)。
app.post('/:sid/refresh', requirePerm('manageSources'), async c => {
  const sid = c.req.param('sid');
  await requireSourceAccess(c.get('user'), sid);
  // SA で更新するため、更新実行者本人の Google 連携は不要。
  const result = await refreshSnapshot(sid);
  return c.json(result);
});

// Batch refresh all sources (for Cloud Scheduler)。SA (ADC) で更新するため、
// 連携ユーザーの有無に関わらず全 sheets/bq ソースを更新する。
export async function refreshAll() {
  const sources = await db.collection('sources').get();
  const results = [];
  for (const s of sources.docs) {
    // SA で更新するのは外部ソース (sheets / bq) のみ。CSV 等は取得元が無いのでスキップ。
    const method = s.data().method;
    if (method !== 'sheets' && method !== 'bq') continue;
    try {
      const r = await refreshSnapshot(s.id);
      results.push({ id: s.id, ...r });
    } catch (e) {
      results.push({ id: s.id, error: e.message });
    }
  }
  return results;
}

// Cloud Run のランタイム SA (ADC) で Sheets/BQ を読むための認証クライアント。
// ユーザーの OAuth には依存しない。SA (dashboard-backend@...) に対象シートを閲覧共有し、
// BQ プロジェクト/データセットへ jobUser / dataViewer を付与しておくこと。
// Sheets API / BigQuery API がプロジェクトで有効化されている必要がある。
let _saAuth = null;
function getServiceAccountAuth() {
  if (!_saAuth) {
    _saAuth = new google.auth.GoogleAuth({
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets.readonly',
        'https://www.googleapis.com/auth/bigquery',
      ],
    });
  }
  return _saAuth;
}

// Fetch rows from BQ or Sheets using the Cloud Run service account (ADC)。
async function fetchRows(source) {
  const auth = getServiceAccountAuth();

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

async function refreshSnapshot(sid) {
  const srcSnap = await db.collection('sources').doc(sid).get();
  if (!srcSnap.exists) throw httpError(404, 'Source not found');
  const source = srcSnap.data();
  if (!source.method) throw httpError(400, 'Source method not configured');

  const rows = await fetchRows(source);
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
