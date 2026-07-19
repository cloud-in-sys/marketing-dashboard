// Firebase Auth (Google SSO) wrapper.
import type { AppUser, PermissionKey } from './models.ts';
import { S, VIEWER_PERMS, SETTINGS_PERM_KEYS, NON_SETTINGS_PERM_KEYS } from './state.ts';
import { signInWithGoogle, signOutUser, onAuthChange, consumeGoogleRedirectResult } from './firebaseClient.js';

export function getCurrentUser(): AppUser {
  return S.USERS.find(u => u.uid === S.CURRENT_USER)
    || { uid: null, name: '', email: '', photoURL: '', perms: { ...VIEWER_PERMS }, isAdmin: false };
}

export function hasPerm(key: PermissionKey): boolean {
  const u = getCurrentUser();
  return !!(u.isAdmin || u.perms?.[key]);
}

// 現在のタブの内容 (カード / グラフ / dims / metrics 等) を編集できるか。
// カスタムタブの内容は TAB_STATES = shared config に保存されるので editCustom が要る。
// 標準タブのカード/グラフは preset 側に保存されるため、ここでは編集可として扱う
// (保存にはプリセットの権限が別途かかる)。
export function canEditCurrentTab(): boolean {
  const isCustom = (S.CUSTOM_TABS || []).some(t => t.key === S.CURRENT_VIEW);
  return !isCustom || hasPerm('editCustom');
}

// ロール判定 (settings/users.js getUserRole / backend utils/perms.js isOperator と一致):
// operator = 非 admin かつ「settings 以外の全 perms 持ち」かつ「settings perms 全部なし」
// 区分 (SETTINGS_PERM_KEYS / NON_SETTINGS_PERM_KEYS) は packages/shared が持つ。
// 以前はここで PERM_GROUPS から自前で導出しており、三者が独立に同じ計算をしていた。
export function isOperator(user?: AppUser | null): boolean {
  const u = user || getCurrentUser();
  if (!u || u.isAdmin) return false;
  if (!u.perms) return false;
  return NON_SETTINGS_PERM_KEYS.every(k => u.perms![k]) && SETTINGS_PERM_KEYS.every(k => !u.perms![k]);
}
// データソース作成権限: admin または operator のみ。
export function canCreateSource(user?: AppUser | null): boolean {
  const u = user || getCurrentUser();
  return !!u && (u.isAdmin || isOperator(u));
}

export function renderCurrentUserLabel(): void {
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

export function applyPermissionUI(): void {
  const u = getCurrentUser();
  document.body.classList.toggle('is-admin', !!u.isAdmin);
  // PermissionKey で縛る。ここは CSS クラス (no-xxx) で UI を隠す判定の元なので、
  // typo すると「その機能が一般ユーザーにだけ永久に隠れる」(admin は isAdmin で
  // 短絡するため気づけない)。型で落とす。
  const keys: PermissionKey[] = [
    'manageSources','connectAccount',
    'viewCustom','addCustom','savePreset',
    'editCustom','editPreset','deleteCustom','deletePreset',
    'editMetrics','editFilters','editDefaults','editDimensions','manageGroups','manageBranding',
  ];
  const camelToKebab = (s: string) => s.replace(/([A-Z])/g, '-$1').toLowerCase();
  for (const k of keys) {
    const cls = 'no-' + camelToKebab(k);
    const ok = u.isAdmin || u.perms?.[k];
    document.body.classList.toggle(cls, !ok);
  }
  // ロール (operator) 由来の追加クラス: 一般ユーザーには「データソース作成」を出さない
  document.body.classList.toggle('no-create-source', !canCreateSource(u));
}

export function showLogin(): void {
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.classList.remove('hidden');
  showLoginForm();
}

export function hideLogin(): void {
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.classList.add('hidden');
}

function showLoginForm(): void {
  const overlay = document.getElementById('login-overlay');
  const body = document.getElementById('login-body');
  const checking = document.getElementById('login-checking');
  const subtitle = document.getElementById('login-subtitle');
  // ログインフォームではロゴ/アプリ名を出す (どのアプリに入るのか示す必要があるため)
  if (overlay) overlay.classList.remove('checking');
  if (body) body.classList.remove('hidden');
  if (checking) checking.classList.add('hidden');
  if (subtitle) subtitle.classList.remove('hidden');
}

function showLoginChecking(): void {
  const overlay = document.getElementById('login-overlay');
  const body = document.getElementById('login-body');
  const checking = document.getElementById('login-checking');
  const subtitle = document.getElementById('login-subtitle');
  const errEl = document.getElementById('login-error');
  // 認証確認中はすぐ消える画面なのでロゴ/アプリ名は出さず、スピナーとテキストだけにする
  if (overlay) overlay.classList.add('checking');
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

function showAuthError(e: any): void {
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
let _unsavedGuard: () => Promise<boolean> = () => Promise.resolve(true);
export function setUnsavedGuard(fn: () => Promise<boolean>) { _unsavedGuard = fn; }

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
interface ObserveAuthOptions {
  /** 認証済み & プロフィール取得完了で発火。throw するとサインアウトしてエラー表示する */
  onReady?: (fbUser: any) => Promise<void> | void;
  onLoggedOut?: () => void;
}

export function observeAuth({ onReady, onLoggedOut }: ObserveAuthOptions) {
  // signInWithRedirect 経由で戻ってきた場合、onAuthChange が user を拾う前に
  // エラー有無を確認してUIに出す（例: ドメイン不一致、cancel 等）
  consumeGoogleRedirectResult().catch(e => showAuthError(e));
  return onAuthChange(async (fbUser: any) => {
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
    } catch (e: any) {
      console.error('[auth] onReady failed', e);
      const isForbidden = (e as any)?.status === 403;
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
