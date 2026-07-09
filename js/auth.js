// Firebase Auth (Google SSO) wrapper.
import { S, VIEWER_PERMS, PERM_GROUPS, PERM_DEFS } from './state.js';
import { signInWithGoogle, signOutUser, onAuthChange, consumeGoogleRedirectResult } from './firebaseClient.js';

export function getCurrentUser() {
  return S.USERS.find(u => u.uid === S.CURRENT_USER)
    || { uid: null, name: '', email: '', photoURL: '', perms: { ...VIEWER_PERMS }, isAdmin: false };
}

export function hasPerm(key) {
  const u = getCurrentUser();
  return !!(u.isAdmin || u.perms?.[key]);
}

// ロール判定 (settings/users.js getUserRole と一致するロジック):
// operator = 非 admin かつ「settings 以外の全 perms 持ち」かつ「settings perms 全部なし」
const _SETTINGS_PERMS = PERM_GROUPS.find(g => g.group === 'settings')?.perms.map(p => p.key) || [];
const _NON_SETTINGS_PERMS = PERM_DEFS.filter(p => !_SETTINGS_PERMS.includes(p.key)).map(p => p.key);
export function isOperator(user) {
  const u = user || getCurrentUser();
  if (!u || u.isAdmin) return false;
  if (!u.perms) return false;
  return _NON_SETTINGS_PERMS.every(k => u.perms[k]) && _SETTINGS_PERMS.every(k => !u.perms[k]);
}
// データソース作成権限: admin または operator のみ。
export function canCreateSource(user) {
  const u = user || getCurrentUser();
  return !!u && (u.isAdmin || isOperator(u));
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
    'viewSources','manageSources','connectAccount',
    'viewPresets','viewCustom','addCustom','savePreset',
    'editCustom','editPreset','deleteCustom','deletePreset',
    'editMetrics','editFilters','editDefaults','editDimensions','manageUsers','manageGroups','manageBranding',
  ];
  const camelToKebab = s => s.replace(/([A-Z])/g, '-$1').toLowerCase();
  for (const k of keys) {
    const cls = 'no-' + camelToKebab(k);
    const ok = u.isAdmin || u.perms?.[k];
    document.body.classList.toggle(cls, !ok);
  }
  // ロール (operator) 由来の追加クラス: 一般ユーザーには「データソース作成」を出さない
  document.body.classList.toggle('no-create-source', !canCreateSource(u));
}

export function showLogin() {
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.classList.remove('hidden');
  showLoginForm();
}

export function hideLogin() {
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.classList.add('hidden');
}

function showLoginForm() {
  const body = document.getElementById('login-body');
  const checking = document.getElementById('login-checking');
  const subtitle = document.getElementById('login-subtitle');
  if (body) body.classList.remove('hidden');
  if (checking) checking.classList.add('hidden');
  if (subtitle) subtitle.classList.remove('hidden');
}

function showLoginChecking() {
  const body = document.getElementById('login-body');
  const checking = document.getElementById('login-checking');
  const subtitle = document.getElementById('login-subtitle');
  const errEl = document.getElementById('login-error');
  if (body) body.classList.add('hidden');
  if (checking) checking.classList.remove('hidden');
  if (subtitle) subtitle.classList.add('hidden');
  if (errEl) errEl.classList.add('hidden');
}

export async function signIn() {
  try {
    await signInWithGoogle();
  } catch (e) {
    showAuthError(e);
  }
}

function showAuthError(e) {
  const errEl = document.getElementById('login-error');
  if (!errEl) return;
  const code = e?.code || '';
  let msg = e?.message || 'ログインに失敗しました';
  if (code.includes('popup-closed') || code.includes('cancelled-popup')) {
    msg = 'ログインがキャンセルされました';
  } else if (code.includes('too-many-requests')) {
    msg = '試行回数が多すぎます。しばらくしてから再度お試しください';
  } else if (code.includes('network-request-failed')) {
    msg = 'ネットワークエラー';
  }
  errEl.textContent = msg;
  errEl.classList.remove('hidden');
}

// main.js から setUnsavedGuard で inject する。未保存確認モーダルを await する。
let _unsavedGuard = () => Promise.resolve(true);
export function setUnsavedGuard(fn) { _unsavedGuard = fn; }

export async function logout() {
  if (!(await _unsavedGuard())) return;
  await signOutUser();
  S.CURRENT_USER = null;
  applyPermissionUI();
  renderCurrentUserLabel();
  showLogin();
}

// Register the auth state change handler. Called once by main.js during bootstrap.
// onReady callback fires when user is authenticated AND profile is loaded.
// onLoggedOut fires when user signs out.
export function observeAuth({ onReady, onLoggedOut }) {
  // signInWithRedirect 経由で戻ってきた場合、onAuthChange が user を拾う前に
  // エラー有無を確認してUIに出す（例: ドメイン不一致、cancel 等）
  consumeGoogleRedirectResult().catch(e => showAuthError(e));
  return onAuthChange(async fbUser => {
    if (!fbUser) {
      S.CURRENT_USER = null;
      applyPermissionUI();
      renderCurrentUserLabel();
      showLogin();
      onLoggedOut?.();
      return;
    }
    showLoginChecking();
    try {
      await onReady?.(fbUser);
      hideLogin();
    } catch (e) {
      console.error('[auth] onReady failed', e);
      const isForbidden = e?.status === 403;
      const msg = isForbidden
        ? (e.message || 'このアカウントはアクセス許可されていません')
        : 'データの読み込みに失敗しました: ' + (e.message || e);
      // Sign out so the session doesn't linger
      try { await signOutUser(); } catch (_) {}
      const errEl = document.getElementById('login-error');
      if (errEl) {
        errEl.textContent = msg;
        errEl.classList.remove('hidden');
      }
      showLogin();
    }
  });
}
