import { API_BASE } from './config.js';
import { getIdToken, getAppCheckHeader } from './firebaseClient.js';

// signal: AbortSignal を渡すと fetch をキャンセル可能。
// abort された場合は `Error: aborted` を投げる (err.code === 'aborted')。
// keepalive: true で pagehide / beforeunload 中でもリクエストを継続できる (size <= 64KB)。
async function request(method, path, body, opts = {}) {
  const [token, appCheckToken] = await Promise.all([getIdToken(), getAppCheckHeader()]);
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(appCheckToken ? { 'X-Firebase-AppCheck': appCheckToken } : {}),
      },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: opts.signal,
      keepalive: !!opts.keepalive,
    });
  } catch (e) {
    if (e?.name === 'AbortError') {
      const err = new Error('aborted'); err.code = 'aborted'; throw err;
    }
    throw e;
  }
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
  putMyState:    (sid, state, opts) => request('PUT', `/api/me/state/${sid}`, { state }, opts),

  // Users
  listUsers:     () => request('GET', '/api/users'),
  createUser:    (data) => request('POST', '/api/users', data),
  updateUser:    (uid, patch) => request('PUT', `/api/users/${uid}`, patch),
  deleteUser:    (uid) => request('DELETE', `/api/users/${uid}`),

  // Branding
  getBranding:   () => request('GET', '/api/branding'),
  putBranding:   (patch) => request('PUT', '/api/branding', patch),

  // Groups
  listGroups:    () => request('GET', '/api/groups'),
  createGroup:   (data) => request('POST', '/api/groups', data),
  updateGroup:   (gid, patch) => request('PUT', `/api/groups/${gid}`, patch),
  deleteGroup:   (gid) => request('DELETE', `/api/groups/${gid}`),

  // Sources
  listSources:   () => request('GET', '/api/sources'),
  reorderSources:(ids) => request('PUT', '/api/sources/reorder', { ids }),
  createSource:  (data) => request('POST', '/api/sources', data),
  updateSource:  (id, patch) => request('PUT', `/api/sources/${id}`, patch),
  deleteSource:  (id) => request('DELETE', `/api/sources/${id}`),
  disconnectSource: (id) => request('POST', `/api/sources/${id}/disconnect`),

  // Config
  getConfig:     (sid) => request('GET', `/api/config/${sid}`),
  putConfig:     (sid, config) => request('PUT', `/api/config/${sid}`, config),
  patchConfig:   (sid, patch, opts) => request('PATCH', `/api/config/${sid}`, patch, opts),

  // Presets
  listPresets:   (sid) => request('GET', `/api/presets/${sid}`),
  createPreset:  (sid, preset, opts) => request('POST', `/api/presets/${sid}`, preset, opts),
  updatePreset:  (sid, pid, preset, opts) => request('PUT', `/api/presets/${sid}/${encodeURIComponent(pid)}`, preset, opts),
  deletePreset:  (sid, pid, opts) => request('DELETE', `/api/presets/${sid}/${encodeURIComponent(pid)}`, null, opts),
  reorderPresets: (sid, order, opts) => request('PATCH', `/api/presets/${sid}`, { order }, opts),

  // Google integration
  googleStatus:  () => request('GET', '/api/google/status'),
  googleAuthUrl: () => request('GET', '/api/google/auth/url'),
  googleDisconnect: () => request('DELETE', '/api/google/connection'),

  // Snapshots (daily batch + on-demand refresh)
  getSnapshot:   (sid) => request('GET', `/api/snapshots/${sid}`),
  getSnapshotMeta: (sid) => request('GET', `/api/snapshots/${sid}/meta`),
  refreshSnapshot: (sid) => request('POST', `/api/snapshots/${sid}/refresh`),

  // Backend aggregation (offload heavy compute to Cloud Run)
  aggregate:        (body, opts) => request('POST', '/api/aggregate', body, opts),
  aggregateBatch:   (body, opts) => request('POST', '/api/aggregate/batch', body, opts),
  aggregateOptions: (sourceId, fields, opts) => request('POST', '/api/aggregate/options', { sourceId, fields }, opts),
  aggregateColumns: (sourceId, opts) => request('POST', '/api/aggregate/columns', { sourceId }, opts),
};
