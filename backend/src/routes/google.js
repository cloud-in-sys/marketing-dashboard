import { Hono } from 'hono';
import crypto from 'crypto';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { db } from '../firebase.js';
import { getSecret } from '../utils/secrets.js';
import { httpError } from '../middleware/error.js';

// HMAC-sign the state parameter with the OAuth client secret (server-side
// only) so Google's callback can be trusted without our auth header.
async function signState(uid) {
  const secret = await getSecret('google-oauth-client-secret');
  const ts = Date.now();
  const payload = `${uid}.${ts}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

async function verifyState(state) {
  if (!state) return null;
  const parts = state.split('.');
  if (parts.length !== 3) return null;
  const [uid, ts, sig] = parts;
  const secret = await getSecret('google-oauth-client-secret');
  const expected = crypto.createHmac('sha256', secret).update(`${uid}.${ts}`).digest('hex');
  if (sig !== expected) return null;
  if (Date.now() - Number(ts) > 10 * 60 * 1000) return null; // 10 min expiry
  return uid;
}

const app = new Hono();

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/bigquery',
  'openid', 'email', 'profile',
];

async function getOAuthClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = await getSecret('google-oauth-client-secret');
  const redirectUri = process.env.OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw httpError(500, 'Google OAuth env not configured');
  }
  return new OAuth2Client(clientId, clientSecret, redirectUri);
}

function tokenDoc(uid) {
  return db.collection('users').doc(uid).collection('tokens').doc('google');
}

// GET /api/google/status — check if user has connected Google
app.get('/status', async c => {
  const uid = c.get('uid');
  const snap = await tokenDoc(uid).get();
  return c.json({
    connected: snap.exists,
    scope: snap.exists ? snap.data().scope : null,
  });
});

// GET /api/google/auth/url — start OAuth, returns URL to redirect to
app.get('/auth/url', async c => {
  const uid = c.get('uid');
  const oauth = await getOAuthClient();
  const state = await signState(uid);
  const url = oauth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
  });
  return c.json({ url });
});

// Exported separately so it can be mounted as a PUBLIC route
// (Google redirects the browser here without our auth header).
export async function oauthCallback(c) {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const uid = await verifyState(state);
  if (!uid) return c.html('State の検証に失敗しました。もう一度連携をお試しください。', 400);
  if (!code) return c.html('認可コードがありません。', 400);
  const oauth = await getOAuthClient();
  const { tokens } = await oauth.getToken(code);
  await tokenDoc(uid).set({
    refreshToken: tokens.refresh_token || null,
    accessToken: tokens.access_token || null,
    expiryDate: tokens.expiry_date || null,
    scope: tokens.scope || SCOPES.join(' '),
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  return c.html('<script>window.close();</script>Google連携が完了しました。このウィンドウを閉じてください。');
}

// DELETE /api/google/connection — revoke & clear stored tokens
app.delete('/connection', async c => {
  const uid = c.get('uid');
  const snap = await tokenDoc(uid).get();
  if (snap.exists) {
    const { refreshToken, accessToken } = snap.data();
    const oauth = await getOAuthClient();
    try {
      if (refreshToken) await oauth.revokeToken(refreshToken);
      else if (accessToken) await oauth.revokeToken(accessToken);
    } catch (e) { /* ignore */ }
    await tokenDoc(uid).delete();
  }
  return c.json({ ok: true });
});

async function getAuthorizedClient(uid) {
  const snap = await tokenDoc(uid).get();
  if (!snap.exists) throw httpError(401, 'Google not connected');
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
    await tokenDoc(uid).set(patch, { merge: true });
  });
  return oauth;
}

// POST /api/google/sheets/fetch { url, tab }
app.post('/sheets/fetch', async c => {
  const uid = c.get('uid');
  const { url, tab } = await c.req.json();
  if (!url || !tab) throw httpError(400, 'url and tab are required');
  const idMatch = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(url);
  const spreadsheetId = idMatch ? idMatch[1] : (/^[a-zA-Z0-9_-]{20,}$/.test(url.trim()) ? url.trim() : null);
  if (!spreadsheetId) throw httpError(400, 'Invalid spreadsheet URL');

  const auth = await getAuthorizedClient(uid);
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: tab });
  const values = res.data.values || [];
  if (values.length < 2) return c.json({ rows: [] });
  const header = values[0].map(h => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row || row.every(v => v === '' || v == null)) continue;
    const obj = {};
    header.forEach((h, j) => { obj[h] = row[j] != null ? String(row[j]) : ''; });
    rows.push(obj);
  }
  return c.json({ rows });
});

// POST /api/google/bq/query { projectId, query }
app.post('/bq/query', async c => {
  const uid = c.get('uid');
  const { projectId, query } = await c.req.json();
  if (!projectId || !query) throw httpError(400, 'projectId and query are required');

  const auth = await getAuthorizedClient(uid);
  const bigquery = google.bigquery({ version: 'v2', auth });

  // Start query
  const qres = await bigquery.jobs.query({
    projectId,
    requestBody: {
      query,
      useLegacySql: false,
      maxResults: 100000,
      timeoutMs: 60000,
    },
  });

  const fields = (qres.data.schema?.fields || []).map(f => f.name);
  const rows = (qres.data.rows || []).map(r => {
    const obj = {};
    (r.f || []).forEach((cell, i) => { obj[fields[i]] = cell.v; });
    return obj;
  });
  return c.json({ rows, fields });
});

export default app;
