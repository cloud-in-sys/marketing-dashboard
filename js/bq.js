// ===== BigQuery Integration =====
import { S } from './state.js';

const TOKEN_KEY = 'dashboard.googleToken.v1';  // share with sheets.js
let accessToken = null;
let tokenExpiry = 0;
let tokenClient = null;

const SCOPES = 'https://www.googleapis.com/auth/bigquery https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.readonly';

// Load from localStorage (shared with sheets)
try {
  const saved = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
  if (saved && saved.token && saved.expiry > Date.now()) {
    accessToken = saved.token;
    tokenExpiry = saved.expiry;
  }
} catch (e) {}

function saveToken(token, expiresIn) {
  accessToken = token;
  tokenExpiry = Date.now() + (expiresIn * 1000) - 60000;
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, expiry: tokenExpiry })); } catch (e) {}
}

function clearToken() {
  accessToken = null;
  tokenExpiry = 0;
  try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
}

export function isConfigured() {
  return !!S.API_SETTINGS.clientId;
}

export function isAuthenticated() {
  return !!accessToken && tokenExpiry > Date.now();
}

function ensureTokenClient() {
  if (tokenClient) return;
  if (!window.google?.accounts?.oauth2) return;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: S.API_SETTINGS.clientId,
    scope: SCOPES,
    callback: () => {},
  });
}

export function authenticate() {
  return new Promise((resolve, reject) => {
    if (!S.API_SETTINGS.clientId) { reject(new Error('\u30af\u30e9\u30a4\u30a2\u30f3\u30c8ID\u304c\u8a2d\u5b9a\u3055\u308c\u3066\u3044\u307e\u305b\u3093')); return; }
    if (!window.google?.accounts?.oauth2) { reject(new Error('Google\u8a8d\u8a3c\u30e9\u30a4\u30d6\u30e9\u30ea\u304c\u8aad\u307f\u8fbc\u307e\u308c\u3066\u3044\u307e\u305b\u3093')); return; }
    ensureTokenClient();
    tokenClient.callback = (response) => {
      if (response.error) { reject(new Error(response.error)); return; }
      saveToken(response.access_token, response.expires_in || 3600);
      resolve(accessToken);
    };
    tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
  });
}

export function disconnect() {
  if (accessToken && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(accessToken);
  clearToken();
  tokenClient = null;
}

// Run a BQ query (synchronous API)
export async function runQuery(projectId, query) {
  const res = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/queries`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        useLegacySql: false,
        maxResults: 100000,
      }),
    }
  );
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      clearToken();
      throw new Error('\u8a8d\u8a3c\u306e\u6709\u52b9\u671f\u9650\u304c\u5207\u308c\u307e\u3057\u305f');
    }
    const err = await res.json().catch(() => null);
    throw new Error(err?.error?.message || `\u30af\u30a8\u30ea\u5b9f\u884c\u306b\u5931\u6557 (${res.status})`);
  }
  const data = await res.json();
  if (!data.jobComplete) throw new Error('\u30af\u30a8\u30ea\u304c\u5b8c\u4e86\u3057\u306a\u304b\u3063\u305f\u305f\u3081\u7d50\u679c\u3092\u53d6\u5f97\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f');

  const fields = (data.schema?.fields || []).map(f => f.name);
  const rows = (data.rows || []).map(r => {
    const obj = {};
    (r.f || []).forEach((cell, i) => { obj[fields[i] || `col${i}`] = cell.v != null ? String(cell.v) : ''; });
    return obj;
  });
  return rows;
}

// List BQ projects
export async function listProjects() {
  const res = await fetch('https://bigquery.googleapis.com/bigquery/v2/projects?maxResults=100', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      clearToken();
      throw new Error('\u8a8d\u8a3c\u306e\u6709\u52b9\u671f\u9650\u304c\u5207\u308c\u307e\u3057\u305f');
    }
    throw new Error(`\u30d7\u30ed\u30b8\u30a7\u30af\u30c8\u4e00\u89a7\u306e\u53d6\u5f97\u306b\u5931\u6557 (${res.status})`);
  }
  const data = await res.json();
  return (data.projects || []).map(p => ({ id: p.id, name: p.friendlyName || p.id }));
}
