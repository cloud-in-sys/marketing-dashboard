// BigQuery integration — now proxied through the backend.
// Shares Google OAuth connection state with sheets.js.

import { refreshConnectionState, isAuthenticated as sheetsAuthed, authenticate as sheetsAuth, disconnect as sheetsDisconnect } from './sheets.js';

export function isAuthenticated() { return sheetsAuthed(); }

export async function authenticate() { return sheetsAuth(); }

export async function disconnect() { return sheetsDisconnect(); }

export { refreshConnectionState };
