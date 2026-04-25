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

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const storage = new Storage();
const BUCKET = process.env.SNAPSHOT_BUCKET || 'marketing-493303-snapshots';
const bucket = () => storage.bucket(BUCKET);
const objectName = (sid) => `snapshots/${sid}.json.gz`;

const app = new Hono();

// Return latest snapshot for a source.
// 可視性:
//   admin → 全部OK
//   非admin → source.allowedGroupIds が空 OR 自分の groupId が含まれる
// 行絞り込み:
//   admin → 絞らない
//   非admin + source.tenantField 未設定 → 絞らない
//   非admin + source.tenantField 設定 + user.groupId = null → **全行ブロック** (未分類=見せない)
//   非admin + source.tenantField 設定 + user.groupId あり → row[tenantField] === group.name の行のみ
app.get('/:sid', async c => {
  const sid = c.req.param('sid');
  const user = c.get('user');

  // (1) 可視性チェック
  const srcSnap = await db.collection('sources').doc(sid).get();
  if (!srcSnap.exists) return c.json({ rows: [], updatedAt: null }, 404);
  const source = srcSnap.data();
  if (!user.isAdmin) {
    const allowed = source.allowedGroupIds || [];
    if (allowed.length > 0) {
      if (!user.groupId || !allowed.includes(user.groupId)) {
        return c.json({ error: 'このデータソースへのアクセス権がありません' }, 403);
      }
    }
  }

  // (2) スナップショット取得
  const file = bucket().file(objectName(sid));
  const [exists] = await file.exists();
  if (!exists) return c.json({ rows: [], updatedAt: null });
  const [meta] = await file.getMetadata();
  const updatedAt = meta.metadata?.updatedAt || meta.updated || '';

  // (3) 行絞り込みの条件を決定
  // ルール:
  //   admin → 絞らない
  //   未分類 (groupId なし) → 絞らない (アクセスが許可されたソースは全行見える)
  //   グループ所属 → group.sourceFilters[sid] があればそのフィルタを適用
  let filter = null;  // null = 絞らない
  if (!user.isAdmin && user.groupId) {
    const gSnap = await db.collection('groups').doc(user.groupId).get();
    if (gSnap.exists) {
      const sf = (gSnap.data().sourceFilters || {})[sid];
      if (sf && sf.field) filter = sf;
    }
  }

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
    return c.body(buf);
  }

  // (6) 絞り込み: 解凍→フィルタ→再圧縮
  const json = (await gunzip(buf)).toString('utf8');
  const parsed = JSON.parse(json);
  const allRows = Array.isArray(parsed.rows) ? parsed.rows : [];
  const filtered = allRows.filter(row => matchFilter(row, filter));
  const outBuf = await gzip(Buffer.from(JSON.stringify({ rows: filtered }), 'utf8'));
  c.header('Content-Encoding', 'gzip');
  c.header('Content-Type', 'application/json');
  c.header('ETag', etag);
  c.header('Cache-Control', 'private, no-cache');
  c.header('X-Snapshot-Updated-At', updatedAt);
  c.header('X-Snapshot-Filtered-Rows', String(filtered.length));
  return c.body(outBuf);
});

// ETag 用の軽量ハッシュ (djb2)
function hashFast(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

// 正規表現キャッシュ。pattern → {ok, re} (ok=false なら不正パターンで毎回 true 扱い)
const _regexCache = new Map();
function getRegex(pattern) {
  if (_regexCache.has(pattern)) return _regexCache.get(pattern);
  let entry;
  try { entry = { ok: true, re: new RegExp(pattern) }; }
  catch { entry = { ok: false, re: null }; }
  _regexCache.set(pattern, entry);
  return entry;
}

// 単一フィルタの行マッチ判定
function matchFilter(row, f) {
  const v = row[f.field];
  if (f.op === 'equals') return String(v) === String(f.value ?? '');
  if (f.op === 'in') return Array.isArray(f.values) && f.values.some(x => String(v) === String(x));
  if (f.op === 'notIn') return Array.isArray(f.values) && !f.values.some(x => String(v) === String(x));
  if (f.op === 'regex') {
    const r = getRegex(String(f.value ?? ''));
    return r.ok ? r.re.test(String(v ?? '')) : true;  // 不正パターンは絞らない(全件通す)
  }
  if (f.op === 'notRegex') {
    const r = getRegex(String(f.value ?? ''));
    return r.ok ? !r.re.test(String(v ?? '')) : true;
  }
  return true;
}

// Return just metadata (fast, for UI)
app.get('/:sid/meta', async c => {
  const sid = c.req.param('sid');
  const file = bucket().file(objectName(sid));
  const [exists] = await file.exists();
  if (!exists) return c.json({ exists: false });
  const [meta] = await file.getMetadata();
  return c.json({
    exists: true,
    updatedAt: meta.metadata?.updatedAt || meta.updated,
    rows: Number(meta.metadata?.rows || 0),
  });
});

// Refresh a single source's snapshot.
// Uses the CALLER's Google OAuth token (not createdBy)
app.post('/:sid/refresh', requirePerm('manageSources'), async c => {
  const sid = c.req.param('sid');
  const uid = c.get('uid');
  const result = await refreshSnapshot(sid, uid);
  return c.json(result);
});

// Find any user that has a Google connection (for batch refresh fallback).
async function findAnyConnectedUser() {
  const tokens = await db.collectionGroup('tokens').limit(10).get();
  for (const t of tokens.docs) {
    if (t.id === 'google' && t.data().refreshToken) {
      // parent is users/{uid}/tokens
      const uid = t.ref.parent.parent.id;
      return uid;
    }
  }
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
      // Prefer createdBy if they have a Google connection
      let uid = s.data().createdBy;
      if (uid) {
        const t = await db.collection('users').doc(uid).collection('tokens').doc('google').get();
        if (!t.exists) uid = fallback;
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
  await file.save(compressed, {
    contentType: 'application/json',
    contentEncoding: 'gzip',
    metadata: {
      metadata: { updatedAt, rows: String(rows.length) },
    },
  });

  return { updatedAt, rows: rows.length };
}

export default app;
