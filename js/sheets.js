// Google Sheets integration — now proxied through the backend.
// The backend holds the refresh token and makes authenticated Google API calls.

import { api } from './api.js';

let connectedState = null; // null = unknown, true/false = known

export async function refreshConnectionState() {
  try {
    const s = await api.googleStatus();
    connectedState = !!s.connected;
    return connectedState;
  } catch (e) {
    connectedState = false;
    return false;
  }
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
  await refreshConnectionState();
  if (!connectedState) throw new Error('Google連携に失敗しました');
}

export async function disconnect() {
  await api.googleDisconnect();
  connectedState = false;
}

export function extractSpreadsheetId(input) {
  const urlMatch = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(input);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(input.trim())) return input.trim();
  return null;
}

