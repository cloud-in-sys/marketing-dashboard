import { S, PERM_GROUPS, PERM_DEFS, ADMIN_PERMS, VIEWER_PERMS } from '../state.js';
import { api } from '../api.js';
import { escapeHtml } from '../utils.js';
import { showModal } from '../modal.js';
import { hasPerm, renderCurrentUserLabel, applyPermissionUI } from '../auth.js';
import { settingsState } from './state.js';

// ----- DIRTY FLAGS -----
export function markUsersDirty() {
  document.getElementById('users-save-btn')?.classList.add('dirty');
}
export function clearUsersDirty() {
  document.getElementById('users-save-btn')?.classList.remove('dirty');
}

// ===== USER ROLES =====
// Operator perms: everything except settings group
const OPERATOR_PERMS = Object.fromEntries(PERM_DEFS.map(p => {
  const isSettings = PERM_GROUPS.find(g => g.group === 'settings')?.perms.some(sp => sp.key === p.key);
  return [p.key, !isSettings];
}));

function getUserRole(u) {
  if (u.isAdmin) return 'admin';
  const settingsPerms = PERM_GROUPS.find(g => g.group === 'settings')?.perms.map(p => p.key) || [];
  const nonSettingsPerms = PERM_DEFS.filter(p => !settingsPerms.includes(p.key));
  const hasAllNonSettings = nonSettingsPerms.every(p => u.perms[p.key]);
  const hasNoSettings = settingsPerms.every(k => !u.perms[k]);
  if (hasAllNonSettings && hasNoSettings) return 'operator';
  return 'viewer';
}

function applyRole(u, role) {
  if (role === 'admin') {
    u.isAdmin = true;
    u.perms = {...ADMIN_PERMS};
  } else if (role === 'operator') {
    u.isAdmin = false;
    u.perms = {...OPERATOR_PERMS};
  } else {
    u.isAdmin = false;
    u.perms = {...VIEWER_PERMS};
  }
}

// ----- USERS VIEW -----
const ROLE_LABEL = { admin: '管理者', operator: '運用者', viewer: '一般' };

export function renderUsersModal() {
  const list = document.getElementById('users-list');
  if (!list) return;
  const src = S.USERS_DRAFT || S.USERS;
  if (settingsState.userDetailIdx != null && !src[settingsState.userDetailIdx]) settingsState.userDetailIdx = null;
  if (settingsState.userDetailIdx != null) {
    renderUserDetail(list, src, settingsState.userDetailIdx);
  } else {
    renderUserListView(list, src);
  }
}

function renderUserListView(list, src) {
  list.innerHTML = `<div class="user-list-compact">${src.map((u, i) => {
    const role = getUserRole(u);
    return `
      <div class="user-list-row" data-user-open="${i}">
        <div class="user-avatar">${escapeHtml((u.name || u.email || '?').slice(0, 1).toUpperCase())}</div>
        <div class="user-list-info">
          <div class="user-list-name">${escapeHtml(u.name || '(無名)')}</div>
          <div class="user-list-id">${escapeHtml(u.email || '')}</div>
        </div>
        <span class="user-list-role user-list-role-${role}">${ROLE_LABEL[role]}</span>
        <span class="user-list-caret">›</span>
      </div>`;
  }).join('')}</div>`;
}

function renderUserDetail(list, src, i) {
  const u = src[i];
  const role = getUserRole(u);
  list.innerHTML = `
    <button type="button" class="user-back-btn" data-user-back>← 一覧に戻る</button>
    <div class="user-row" data-user-idx="${i}">
      <div class="user-row-top">
        <div class="user-avatar">${escapeHtml((u.name || u.email || '?').slice(0, 1).toUpperCase())}</div>
        <div class="user-row-main">
          <input type="text" class="user-name-input" data-user-name value="${escapeHtml(u.name || '')}" placeholder="表示名">
          <select class="user-role-select" data-user-role>
            <option value="admin"${role==='admin'?' selected':''}>管理者</option>
            <option value="operator"${role==='operator'?' selected':''}>運用者</option>
            <option value="viewer"${role==='viewer'?' selected':''}>一般</option>
          </select>
        </div>
        <button type="button" class="user-del" data-user-del="${i}" title="削除"${src.length<=1?' disabled':''}>×</button>
      </div>
      <div class="user-field-grid">
        <div class="user-field">
          <label>メールアドレス</label>
          <input type="text" value="${escapeHtml(u.email || '')}" disabled>
        </div>
        <div class="user-field">
          <label>所属グループ</label>
          <select data-user-group>
            <option value=""${!u.groupId ? ' selected' : ''}>未分類</option>
            ${settingsState.groupsCache.map(g => `<option value="${escapeHtml(g.id)}"${u.groupId === g.id ? ' selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="user-perms-section">
        <div class="user-perms-title">操作権限</div>
        ${PERM_GROUPS.map(g => `
          <div class="user-perms-group">
            <div class="user-perms-group-label">${g.label}</div>
            <div class="user-perms">
              ${g.perms.map(p => `<label><input type="checkbox" data-perm="${p.key}"${u.perms[p.key]?' checked':''}><span>${p.label}</span></label>`).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
}

async function addUser() {
  const email = await showModal({title: 'ユーザーを追加', body: '新しいユーザーのメールアドレスを入力してください', input: true, placeholder: 'user@example.com', okText: '次へ'});
  if (!email) return;
  const password = await showModal({title: 'パスワード', body: '初期パスワード（8文字以上、英字と数字を両方含む）を入力してください', input: true, placeholder: 'password', okText: '次へ'});
  if (!password) return;
  const name = await showModal({title: '表示名', body: '表示名を入力してください', input: true, defaultValue: email.split('@')[0], placeholder: '例: 田中', okText: '作成', noEnter: true});
  if (!name) return;
  try {
    const created = await api.createUser({ email, password, name, isAdmin: false });
    S.USERS.push(created);
    S.USERS_DRAFT = JSON.parse(JSON.stringify(S.USERS));
    settingsState.userDetailIdx = S.USERS_DRAFT.length - 1;
    renderUsersModal();
    await showModal({title: '作成完了', body: `${email} を追加しました。初期パスワードを本人に伝えてください。`, okText: 'OK', cancelText: ''});
  } catch (e) {
    await showModal({title: '作成失敗', body: e.message || 'ユーザー作成に失敗しました', okText: 'OK', cancelText: ''});
  }
}

async function removeUser(idx) {
  const draft = S.USERS_DRAFT || S.USERS;
  if (draft.length <= 1) return;
  const u = draft[idx];
  const ok = await showModal({title: 'ユーザー削除', body: `「${u.name}」を削除しますか？（保存ボタンを押すまで確定しません）`, okText: '削除', danger: true});
  if (!ok) return;
  if (u.isAdmin && draft.filter(x => x.isAdmin).length <= 1) {
    await showModal({title: '削除できません', body: '少なくとも1人の管理者が必要です', okText: 'OK', cancelText: ''});
    return;
  }
  draft.splice(idx, 1);
  markUsersDirty();
  settingsState.userDetailIdx = null;
  renderUsersModal();
}

export function setupUsersEvents() {
  document.getElementById('add-user-btn').addEventListener('click', addUser);
  document.getElementById('users-list').addEventListener('click', e => {
    const del = e.target.closest('[data-user-del]');
    if (del) { removeUser(+del.dataset.userDel); return; }
    const back = e.target.closest('[data-user-back]');
    if (back) { settingsState.userDetailIdx = null; renderUsersModal(); return; }
    const open = e.target.closest('[data-user-open]');
    if (open) { settingsState.userDetailIdx = +open.dataset.userOpen; renderUsersModal(); return; }
  });
  document.getElementById('users-list').addEventListener('input', e => {
    const row = e.target.closest('[data-user-idx]');
    if (!row) return;
    const idx = +row.dataset.userIdx;
    const draft = S.USERS_DRAFT || S.USERS;
    const u = draft[idx];
    if (!u) return;
    if (e.target.matches('[data-user-name]')) u.name = e.target.value;
    else if (e.target.matches('[data-perm]')) u.perms[e.target.dataset.perm] = e.target.checked;
    else if (e.target.matches('[data-user-group]')) u.groupId = e.target.value || null;
    markUsersDirty();
  });
  document.getElementById('users-list').addEventListener('change', e => {
    const row = e.target.closest('[data-user-idx]');
    if (!row) return;
    const idx = +row.dataset.userIdx;
    const draft = S.USERS_DRAFT || S.USERS;
    const u = draft[idx];
    if (!u) return;
    if (e.target.matches('[data-user-role]')) {
      applyRole(u, e.target.value);
      markUsersDirty();
      renderUsersModal();
    }
  });
  document.getElementById('users-save-btn').addEventListener('click', async () => {
    if (!hasPerm('manageUsers')) return;
    if (!S.USERS_DRAFT) return;
    if (!S.USERS_DRAFT.some(u => u.isAdmin)) {
      await showModal({title: '保存できません', body: '少なくとも1人の管理者が必要です', okText: 'OK', cancelText: ''});
      return;
    }
    const ok = await showModal({title: 'ユーザー情報を保存', body: '変更内容を保存しますか？', okText: '保存'});
    if (!ok) return;
    try {
      // Diff against original and save changed ones
      const originalMap = Object.fromEntries(S.USERS.map(u => [u.uid, u]));
      for (const u of S.USERS_DRAFT) {
        const orig = originalMap[u.uid];
        if (!orig) continue;
        if (JSON.stringify(orig) !== JSON.stringify(u)) {
          await api.updateUser(u.uid, { name: u.name, isAdmin: u.isAdmin, perms: u.perms, groupId: u.groupId ?? null });
        }
      }
      // Deletions
      for (const orig of S.USERS) {
        if (!S.USERS_DRAFT.some(u => u.uid === orig.uid)) {
          await api.deleteUser(orig.uid);
        }
      }
      S.USERS = JSON.parse(JSON.stringify(S.USERS_DRAFT));
      renderCurrentUserLabel();
      applyPermissionUI();
      clearUsersDirty();
      await showModal({title: '保存完了', body: 'ユーザー情報を保存しました', okText: 'OK', cancelText: ''});
    } catch (err) {
      await showModal({title: '保存できません', body: err.message || '保存に失敗しました', okText: 'OK', cancelText: ''});
    }
  });
}
