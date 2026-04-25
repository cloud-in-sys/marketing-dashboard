// Persistence layer: debounced writes to backend API.
// Keeps synchronous call-site ergonomics (saveXxx() returns immediately),
// and batches per-source config writes into PATCH requests.

import { api } from './api.js';

let currentSid = null;
let pendingConfig = {};
let configTimer = null;
const CONFIG_DEBOUNCE_MS = 600;

export function setCurrentSourceId(sid) {
  flushConfigNow(); // flush before switching
  currentSid = sid;
  pendingConfig = {};
}

// Queue a partial config update. Flushed after debounce window.
export function queueConfigPatch(patch) {
  if (!currentSid) return;
  Object.assign(pendingConfig, patch);
  if (configTimer) clearTimeout(configTimer);
  configTimer = setTimeout(flushConfigNow, CONFIG_DEBOUNCE_MS);
}

export async function flushConfigNow() {
  if (configTimer) { clearTimeout(configTimer); configTimer = null; }
  if (!currentSid || Object.keys(pendingConfig).length === 0) return;
  const sid = currentSid;
  const patch = pendingConfig;
  pendingConfig = {};
  try {
    await api.patchConfig(sid, patch);
  } catch (e) {
    console.warn('[persistence] config patch failed', e);
    // Re-queue on failure
    Object.assign(pendingConfig, patch);
  }
}

// Flush on page unload so we don't lose edits
window.addEventListener('beforeunload', () => {
  if (configTimer) clearTimeout(configTimer);
  if (currentSid && Object.keys(pendingConfig).length) {
    // Best-effort sync beacon. May or may not succeed depending on auth header.
    try {
      const blob = new Blob([JSON.stringify(pendingConfig)], { type: 'application/json' });
      navigator.sendBeacon(`/api/config/${currentSid}?beacon=1`, blob);
    } catch (e) {}
  }
});
