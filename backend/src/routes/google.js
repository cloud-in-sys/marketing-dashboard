import { Hono } from 'hono';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { db } from '../firebase.js';
import { getSecret } from '../utils/secrets.js';
import { httpError } from '../middleware/error.js';
import { requirePerm } from '../middleware/auth.js';

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
  if (Date.now() - Number(ts) > 5 * 60 * 1000) return null; // 5 min expiry
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
app.get('/auth/url', requirePerm('connectAccount'), async c => {
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
app.delete('/connection', requirePerm('connectAccount'), async c => {
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

export default app;
