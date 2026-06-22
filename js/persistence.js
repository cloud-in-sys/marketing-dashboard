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

export async function flushConfigNow(opts) {
  if (configTimer) { clearTimeout(configTimer); configTimer = null; }
  if (!currentSid || Object.keys(pendingConfig).length === 0) return;
  const sid = currentSid;
  const patch = pendingConfig;
  pendingConfig = {};
  try {
    await api.patchConfig(sid, patch, opts);
  } catch (e) {
    console.warn('[persistence] config patch failed', e);
    // Re-queue on failure
    Object.assign(pendingConfig, patch);
  }
}
