// ===== Google Sheets Integration =====
import { S } from './state.js';

const TOKEN_KEY = 'dashboard.googleToken.v1';
let accessToken = null;
let tokenExpiry = 0;
let tokenClient = null;

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.readonly';

// Load token from localStorage on module init
try {
  const saved = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
  if (saved && saved.token && saved.expiry > Date.now()) {
    accessToken = saved.token;
    tokenExpiry = saved.expiry;
  }
} catch (e) {}

function saveToken(token, expiresIn) {
  accessToken = token;
  tokenExpiry = Date.now() + (expiresIn * 1000) - 60000; // 1min buffer
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

// Initialize token client
function ensureTokenClient() {
  if (tokenClient) return;
  if (!window.google?.accounts?.oauth2) return;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: S.API_SETTINGS.clientId,
    scope: SCOPES,
    callback: () => {},
  });
}

// Request OAuth access token
export function authenticate() {
  return new Promise((resolve, reject) => {
    if (!S.API_SETTINGS.clientId) {
      reject(new Error('\u30af\u30e9\u30a4\u30a2\u30f3\u30c8ID\u304c\u8a2d\u5b9a\u3055\u308c\u3066\u3044\u307e\u305b\u3093'));
      return;
    }
    if (!window.google?.accounts?.oauth2) {
      reject(new Error('Google\u8a8d\u8a3c\u30e9\u30a4\u30d6\u30e9\u30ea\u304c\u8aad\u307f\u8fbc\u307e\u308c\u3066\u3044\u307e\u305b\u3093\u3002\u30da\u30fc\u30b8\u3092\u30ea\u30ed\u30fc\u30c9\u3057\u3066\u304f\u3060\u3055\u3044'));
      return;
    }
    ensureTokenClient();
    tokenClient.callback = (response) => {
      if (response.error) {
        reject(new Error(response.error));
        return;
      }
      saveToken(response.access_token, response.expires_in || 3600);
      resolve(accessToken);
    };
    tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
  });
}

// Disconnect
export function disconnect() {
  if (accessToken && window.google?.accounts?.oauth2) {
    google.accounts.oauth2.revoke(accessToken);
  }
  clearToken();
  tokenClient = null;
}

// Fetch user's spreadsheets from Google Drive
export async function fetchSpreadsheetList() {
  const res = await fetch(
    "https://www.googleapis.com/drive/v3/files?q=mimeType%3D'application%2Fvnd.google-apps.spreadsheet'&orderBy=modifiedTime+desc&pageSize=50&fields=files(id%2Cname%2CmodifiedTime)",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      clearToken();
      throw new Error('\u8a8d\u8a3c\u306e\u6709\u52b9\u671f\u9650\u304c\u5207\u308c\u307e\u3057\u305f\u3002\u518d\u5ea6\u9023\u643a\u3057\u3066\u304f\u3060\u3055\u3044');
    }
    throw new Error(`\u30b9\u30d7\u30ec\u30c3\u30c9\u30b7\u30fc\u30c8\u4e00\u89a7\u306e\u53d6\u5f97\u306b\u5931\u6557\u3057\u307e\u3057\u305f (${res.status})`);
  }
  const data = await res.json();
  return (data.files || []).map(f => ({
    id: f.id,
    name: f.name,
    modified: f.modifiedTime,
  }));
}

// Fetch sheet names in a spreadsheet
export async function fetchSheetNames(spreadsheetId) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      clearToken();
      throw new Error('\u8a8d\u8a3c\u306e\u6709\u52b9\u671f\u9650\u304c\u5207\u308c\u307e\u3057\u305f');
    }
    throw new Error(`\u30b7\u30fc\u30c8\u4e00\u89a7\u306e\u53d6\u5f97\u306b\u5931\u6557 (${res.status})`);
  }
  const data = await res.json();
  return (data.sheets || []).map(s => s.properties.title);
}

// Extract spreadsheet ID from URL or raw ID
export function extractSpreadsheetId(input) {
  const urlMatch = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(input);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(input.trim())) return input.trim();
  return null;
}

// Fetch sheet data as row objects
export async function fetchSheetData(spreadsheetId, sheetName) {
  const range = encodeURIComponent(sheetName);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      clearToken();
      throw new Error('\u8a8d\u8a3c\u306e\u6709\u52b9\u671f\u9650\u304c\u5207\u308c\u307e\u3057\u305f');
    }
    throw new Error(`\u30c7\u30fc\u30bf\u306e\u53d6\u5f97\u306b\u5931\u6557 (${res.status})`);
  }
  const data = await res.json();
  const values = data.values || [];
  if (values.length < 2) throw new Error('\u30c7\u30fc\u30bf\u304c\u7a7a\u307e\u305f\u306f\u30d8\u30c3\u30c0\u30fc\u306e\u307f\u3067\u3059');
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
