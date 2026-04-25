import { API_BASE } from './config.js';
import { getIdToken, getAppCheckHeader } from './firebaseClient.js';

async function request(method, path, body) {
  const [token, appCheckToken] = await Promise.all([getIdToken(), getAppCheckHeader()]);
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(appCheckToken ? { 'X-Firebase-AppCheck': appCheckToken } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch (e) {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

export const api = {
  // Me
  me:            () => request('GET', '/api/me'),
  getMyState:    (sid) => request('GET', `/api/me/state/${sid}`),
  putMyState:    (sid, state) => request('PUT', `/api/me/state/${sid}`, { state }),

  // Users
  listUsers:     () => request('GET', '/api/users'),
  createUser:    (data) => request('POST', '/api/users', data),
  updateUser:    (uid, patch) => request('PUT', `/api/users/${uid}`, patch),
  deleteUser:    (uid) => request('DELETE', `/api/users/${uid}`),

  // Groups
  listGroups:    () => request('GET', '/api/groups'),
  createGroup:   (data) => request('POST', '/api/groups', data),
  updateGroup:   (gid, patch) => request('PUT', `/api/groups/${gid}`, patch),
  deleteGroup:   (gid) => request('DELETE', `/api/groups/${gid}`),

  // Sources
  listSources:   () => request('GET', '/api/sources'),
  createSource:  (data) => request('POST', '/api/sources', data),
  updateSource:  (id, patch) => request('PUT', `/api/sources/${id}`, patch),
  deleteSource:  (id) => request('DELETE', `/api/sources/${id}`),
  disconnectSource: (id) => request('POST', `/api/sources/${id}/disconnect`),

  // Config
  getConfig:     (sid) => request('GET', `/api/config/${sid}`),
  putConfig:     (sid, config) => request('PUT', `/api/config/${sid}`, config),
  patchConfig:   (sid, patch) => request('PATCH', `/api/config/${sid}`, patch),

  // Presets
  listPresets:   (sid) => request('GET', `/api/presets/${sid}`),
  putPresets:    (sid, presets) => request('PUT', `/api/presets/${sid}`, { presets }),

  // Google integration
  googleStatus:  () => request('GET', '/api/google/status'),
  googleAuthUrl: () => request('GET', '/api/google/auth/url'),
  googleDisconnect: () => request('DELETE', '/api/google/connection'),

  // Data fetch (live - discouraged, use snapshots instead)
  fetchSheets:   (url, tab) => request('POST', '/api/google/sheets/fetch', { url, tab }),
  queryBq:       (projectId, query) => request('POST', '/api/google/bq/query', { projectId, query }),

  // Snapshots (daily batch + on-demand refresh)
  getSnapshot:   (sid) => request('GET', `/api/snapshots/${sid}`),
  getSnapshotMeta: (sid) => request('GET', `/api/snapshots/${sid}/meta`),
  refreshSnapshot: (sid) => request('POST', `/api/snapshots/${sid}/refresh`),
};
