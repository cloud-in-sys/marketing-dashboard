import { S, ADMIN_PERMS, VIEWER_PERMS, PERM_DEFS, USERS_KEY, CURRENT_USER_KEY } from './state.js';
import { saveCurrentUser } from './state.js';

// ===== Authentication / Users / Permissions =====
export function loadUsers() {
  try {
    const list = JSON.parse(localStorage.getItem(USERS_KEY) || 'null');
    if (Array.isArray(list) && list.length) S.USERS = list.map(u => ({
      id: u.id || u.name,
      password: u.password || '',
      name: u.name || u.id,
      isAdmin: !!u.isAdmin,
      perms: {...VIEWER_PERMS, ...(u.perms || {})},
    }));
  } catch (e) {}
  S.USERS.forEach(u => { if (u.isAdmin) u.perms = {...ADMIN_PERMS, ...u.perms, ...Object.fromEntries(PERM_DEFS.map(p => [p.key, true]))}; });
  if (!S.USERS.some(u => u.isAdmin)) S.USERS[0].isAdmin = true;
  const cu = localStorage.getItem(CURRENT_USER_KEY);
  if (cu && S.USERS.some(u => u.id === cu)) S.CURRENT_USER = cu;
}

export function getCurrentUser() {
  return S.USERS.find(u => u.id === S.CURRENT_USER) || {name: '', perms: VIEWER_PERMS, isAdmin: false};
}

export function hasPerm(key) {
  return !!getCurrentUser().perms?.[key];
}

export function renderCurrentUserLabel() {
  const u = getCurrentUser();
  const nameEl = document.getElementById('header-user-name');
  const roleEl = document.getElementById('header-user-role');
  const avatarEl = document.getElementById('header-user-avatar');
  if (nameEl) nameEl.textContent = u.name || '-';
  if (roleEl) roleEl.textContent = u.id ? `@${u.id}${u.isAdmin ? ' \u00b7 \u7ba1\u7406\u8005' : ''}` : '';
  if (avatarEl) avatarEl.textContent = (u.name || u.id || '?').slice(0, 1).toUpperCase();
}

export function applyPermissionUI() {
  const u = getCurrentUser();
  document.body.classList.toggle('is-admin', !!u.isAdmin);
  document.body.classList.toggle('no-add-custom', !u.perms.addCustom);
  document.body.classList.toggle('no-save-preset', !u.perms.savePreset);
  document.body.classList.toggle('no-edit-custom', !u.perms.editCustom);
  document.body.classList.toggle('no-edit-preset', !u.perms.editPreset);
  document.body.classList.toggle('no-delete-custom', !u.perms.deleteCustom);
  document.body.classList.toggle('no-delete-preset', !u.perms.deletePreset);
  document.body.classList.toggle('no-edit-metrics', !u.perms.editMetrics);
  document.body.classList.toggle('no-edit-filters', !u.perms.editFilters);
  document.body.classList.toggle('no-edit-defaults', !u.perms.editDefaults);
  document.body.classList.toggle('no-edit-dimensions', !u.perms.editDimensions);
  document.body.classList.toggle('no-manage-users', !u.perms.manageUsers);
}

export function showLogin() {
  document.getElementById('login-overlay').classList.remove('hidden');
  document.getElementById('login-id').value = '';
  document.getElementById('login-pw').value = '';
  document.getElementById('login-error').classList.add('hidden');
  setTimeout(() => document.getElementById('login-id').focus(), 50);
}

export function hideLogin() {
  document.getElementById('login-overlay').classList.add('hidden');
}

export function tryLogin(id, password) {
  const u = S.USERS.find(u => u.id === id && u.password === password);
  if (!u) return false;
  S.CURRENT_USER = u.id;
  saveCurrentUser();
  applyPermissionUI();
  renderCurrentUserLabel();
  return true;
}

export function logout() {
  S.CURRENT_USER = null;
  saveCurrentUser();
  applyPermissionUI();
  renderCurrentUserLabel();
  showLogin();
}
