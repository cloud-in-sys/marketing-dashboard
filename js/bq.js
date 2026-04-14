// BigQuery integration — now proxied through the backend.
// Shares Google OAuth connection state with sheets.js.

import { api } from './api.js';
import { refreshConnectionState, isAuthenticated as sheetsAuthed, authenticate as sheetsAuth, disconnect as sheetsDisconnect } from './sheets.js';

export function isConfigured() { return true; }

export function isAuthenticated() { return sheetsAuthed(); }

export async function authenticate() { return sheetsAuth(); }

export async function disconnect() { return sheetsDisconnect(); }

export { refreshConnectionState };

export async function runQuery(projectId, query) {
  const { rows } = await api.queryBq(projectId, query);
  return rows;
}

export async function listProjects() {
  // Backend endpoint intentionally not exposed yet; user types project ID.
  return [];
}
