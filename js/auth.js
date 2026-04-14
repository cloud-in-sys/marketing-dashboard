// Firebase Auth (Google SSO) wrapper. Keeps same exported surface as the
// previous localStorage-based auth module where possible.

import { S, VIEWER_PERMS } from './state.js';
import { signInWithGoogle, signOutUser, onAuthChange } from './firebaseClient.js';

export function getCurrentUser() {
  return S.USERS.find(u => u.uid === S.CURRENT_USER)
    || { uid: null, name: '', email: '', photoURL: '', perms: { ...VIEWER_PERMS }, isAdmin: false };
}

export function hasPerm(key) {
  const u = getCurrentUser();
  return !!(u.isAdmin || u.perms?.[key]);
}

export function renderCurrentUserLabel() {
  const u = getCurrentUser();
  const nameEl = document.getElementById('header-user-name');
  const roleEl = document.getElementById('header-user-role');
  const avatarEl = document.getElementById('header-user-avatar');
  if (nameEl) nameEl.textContent = u.name || u.email || '-';
  if (roleEl) roleEl.textContent = u.email ? `${u.email}${u.isAdmin ? ' \u00b7 \u7ba1\u7406\u8005' : ''}` : '';
  if (avatarEl) {
    if (u.photoURL) {
      avatarEl.style.backgroundImage = `url(${u.photoURL})`;
      avatarEl.style.backgroundSize = 'cover';
      avatarEl.textContent = '';
    } else {
      avatarEl.style.backgroundImage = '';
      avatarEl.textContent = (u.name || u.email || '?').slice(0, 1).toUpperCase();
    }
  }
}

export function applyPermissionUI() {
  const u = getCurrentUser();
  document.body.classList.toggle('is-admin', !!u.isAdmin);
  const keys = [
    'viewSources','addSource','deleteSource',
    'viewPresets','viewCustom','addCustom','savePreset',
    'editCustom','editPreset','deleteCustom','deletePreset',
    'editMetrics','editFilters','editDefaults','editDimensions','manageUsers',
  ];
  const camelToKebab = s => s.replace(/([A-Z])/g, '-$1').toLowerCase();
  for (const k of keys) {
    const cls = 'no-' + camelToKebab(k);
    const ok = u.isAdmin || u.perms?.[k];
    document.body.classList.toggle(cls, !ok);
  }
}

export function showLogin() {
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.classList.remove('hidden');
}

export function hideLogin() {
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.classList.add('hidden');
}

export async function signIn() {
  try {
    await signInWithGoogle();
    // Auth state change listener will fire and trigger app init
  } catch (e) {
    const errEl = document.getElementById('login-error');
    if (errEl) {
      errEl.textContent = e.message || 'ログインに失敗しました';
      errEl.classList.remove('hidden');
    }
  }
}

export async function logout() {
  await signOutUser();
  S.CURRENT_USER = null;
  applyPermissionUI();
  renderCurrentUserLabel();
  showLogin();
}

// Legacy API compatibility (old login form). Always returns false — password login removed.
export function tryLogin() {
  console.warn('tryLogin() is deprecated — use signIn() (Google SSO)');
  return false;
}
export function loadUsers() { /* no-op; users loaded from server */ }

// Register the auth state change handler. Called once by main.js during bootstrap.
// onReady callback fires when user is authenticated AND profile is loaded.
// onLoggedOut fires when user signs out.
export function observeAuth({ onReady, onLoggedOut }) {
  return onAuthChange(async fbUser => {
    if (!fbUser) {
      S.CURRENT_USER = null;
      applyPermissionUI();
      renderCurrentUserLabel();
      showLogin();
      onLoggedOut?.();
      return;
    }
    hideLogin();
    try {
      await onReady?.(fbUser);
    } catch (e) {
      console.error('[auth] onReady failed', e);
      const errEl = document.getElementById('login-error');
      if (errEl) {
        errEl.textContent = 'データの読み込みに失敗しました: ' + (e.message || e);
        errEl.classList.remove('hidden');
      }
      showLogin();
    }
  });
}
