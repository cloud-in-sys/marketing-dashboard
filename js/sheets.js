// Google Sheets integration — now proxied through the backend.
// The backend holds the refresh token and makes authenticated Google API calls.

import { api } from './api.js';

let connectedState = null; // null = unknown, true/false = known
let lastCheckedAt = 0;
let inflightCheck = null;
const CONNECTION_TTL_MS = 3 * 60 * 1000;  // 3 分

// source 切替のたびに本当に API を叩く必要は薄い。3 分 TTL で間引く。
// 明示的な authenticate / disconnect / refresh 失敗時は lastCheckedAt をリセットして
// 次回の refreshConnectionState で必ず再確認する。
export async function refreshConnectionState() {
  const now = Date.now();
  if (connectedState !== null && now - lastCheckedAt < CONNECTION_TTL_MS) return connectedState;
  if (inflightCheck) return inflightCheck;  // 並行呼び出しを 1 本に集約
  inflightCheck = (async () => {
    try {
      const s = await api.googleStatus();
      connectedState = !!s.connected;
      lastCheckedAt = Date.now();
      return connectedState;
    } catch (e) {
      connectedState = false;
      lastCheckedAt = 0;  // 失敗時は TTL を効かさず次回再確認
      return false;
    } finally {
      inflightCheck = null;
    }
  })();
  return inflightCheck;
}

export function isAuthenticated() {
  return connectedState === true;
}

export async function authenticate() {
  const { url } = await api.googleAuthUrl();
  // Open Google consent in a popup; server saves the refresh token.
  const popup = window.open(url, 'google-auth', 'width=500,height=650');
  if (!popup) throw new Error('ポップアップがブロックされました。許可してください。');
  // Poll until popup closes, then refresh state.
  await new Promise(resolve => {
    const t = setInterval(() => {
      if (popup.closed) { clearInterval(t); resolve(); }
    }, 500);
  });
  lastCheckedAt = 0;  // 強制再確認
  await refreshConnectionState();
  if (!connectedState) throw new Error('Google連携に失敗しました');
}

export async function disconnect() {
  await api.googleDisconnect();
  connectedState = false;
  lastCheckedAt = Date.now();  // 解除済みを TTL 内で信頼
}

export function extractSpreadsheetId(input) {
  const urlMatch = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(input);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(input.trim())) return input.trim();
  return null;
}

