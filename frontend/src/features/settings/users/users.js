import { S, PERM_GROUPS, PERM_DEFS, ADMIN_PERMS, VIEWER_PERMS } from '../../../app/state.js';
import { api } from '../../../api/index.js';
import { escapeHtml } from '../../../shared/utils/utils.js';
import { showModal } from '../../../shared/ui/modal.js';
import { getCurrentUser, renderCurrentUserLabel, applyPermissionUI } from '../../../app/auth.js';
import { settingsState } from '../state.js';
import { buildSaveErrorMessage, setSaveButtonState } from '../saveFlow.js';

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

// 権限セットからロールを逆算する (ロール自体は保存しておらず perms から求める)。
// 以前は最後が return 'viewer' だったため、運用者に settings 権限を 1 つ足しただけで
// 「一般」と表示されていた。viewer は本来 VIEWER_PERMS = 全権限なし を指す。
function getUserRole(u) {
  if (u.isAdmin) return 'admin';
  const perms = u.perms || {};
  const matches = preset => PERM_DEFS.every(p => !!perms[p.key] === !!preset[p.key]);
  // プリセットちょうどならそのロール名
  if (matches(OPERATOR_PERMS)) return 'operator';
  if (matches(VIEWER_PERMS)) return 'viewer';
  // 運用者の権限を全部持った上で足している → 運用者+
  const hasAllOperator = PERM_DEFS.every(p => !OPERATOR_PERMS[p.key] || !!perms[p.key]);
  if (hasAllOperator) return 'operatorPlus';
  // 運用者の土台には乗らないが、運用者の領域 (settings 以外) を 1 つも持たない
  //   = 一般 (全部なし) に settings 権限だけ足した状態 → 一般+
  const hasNoOperatorArea = PERM_DEFS.every(p => !OPERATOR_PERMS[p.key] || !perms[p.key]);
  if (hasNoOperatorArea) return 'viewerPlus';
  // 運用者の領域を一部だけ持つ (運用者から減らした等) → どのロールの土台にも乗らない
  return 'custom';
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
const ROLE_LABEL = { admin: '管理者', operator: '運用者', operatorPlus: '運用者+', viewer: '一般', viewerPlus: '一般+', custom: 'カスタム' };

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
            ${ROLE_LABEL[role] && !['admin','operator','viewer'].includes(role)
              // 派生ロール (運用者+ / 一般+ / カスタム) は「今その状態の時」だけ現在値として出す。
              // 常時 option に置くと選べない項目がプルダウンに並んで邪魔になる。
              ? `<option value="${role}" selected>${ROLE_LABEL[role]}</option>` : ''}
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
              ${g.perms.filter(p => !p.parent).map(p => {
                const children = g.perms.filter(c => c.parent === p.key);
                const parentOn = !!u.perms[p.key];
                const self = `<label><input type="checkbox" data-perm="${p.key}"${parentOn?' checked':''}><span>${p.label}</span></label>`;
                if (!children.length) return self;
                // 子は親が ON の時だけ出す (親が無いと意味を持たない追加権限のため)
                return `<div class="perm-with-children">${self}
                  ${parentOn ? `<div class="perm-children">${children.map(c =>
                    `<label><input type="checkbox" data-perm="${c.key}"${u.perms[c.key]?' checked':''}><span>${c.label}</span></label>`
                  ).join('')}</div>` : ''}
                </div>`;
              }).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
}

async function addUser() {
  const email = await showModal({title: 'ユーザーを追加', body: '新しいユーザーのメールアドレスを入力してください（Google アカウント）', input: true, placeholder: 'user@example.com', okText: '次へ'});
  if (!email) return;
  const name = await showModal({title: '表示名', body: '表示名を入力してください', input: true, defaultValue: email.split('@')[0], placeholder: '例: 田中', okText: '作成', noEnter: true});
  if (!name) return;
  try {
    const created = await api.createUser({ email, name, isAdmin: false });
    // server-side cache (S.USERS) と DRAFT に「追加」する。DRAFT 全体を replace すると
    // 他ユーザーで進行中の編集が消えるので append のみ。
    S.USERS.push(created);
    if (!Array.isArray(S.USERS_DRAFT)) S.USERS_DRAFT = JSON.parse(JSON.stringify(S.USERS));
    else S.USERS_DRAFT.push(JSON.parse(JSON.stringify(created)));
    settingsState.userDetailIdx = S.USERS_DRAFT.length - 1;
    renderUsersModal();
    await showModal({title: '作成完了', body: `${email} を追加しました。本人が Google でログインすると有効化されます。`, okText: 'OK', cancelText: ''});
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
    else if (e.target.matches('[data-perm]')) {
      const key = e.target.dataset.perm;
      u.perms[key] = e.target.checked;
      // 親子の整合を保つ。親 OFF → 配下も OFF (親が無いと機能しないため)。
      //          子 ON  → 親も ON (設定画面に入れないのに追加だけできる矛盾を防ぐ)。
      const def = PERM_DEFS.find(p => p.key === key);
      if (!e.target.checked) {
        for (const c of PERM_DEFS.filter(p => p.parent === key)) u.perms[c.key] = false;
      } else if (def?.parent) {
        u.perms[def.parent] = true;
      }
      renderUsersModal();   // 子の表示/非表示を反映
    }
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
    // ユーザー管理は管理者限定 (backend も adminOnly)
    if (!getCurrentUser().isAdmin) return;
    if (!S.USERS_DRAFT) return;
    if (!S.USERS_DRAFT.some(u => u.isAdmin)) {
      await showModal({title: '保存できません', body: '少なくとも1人の管理者が必要です', okText: 'OK', cancelText: ''});
      return;
    }
    const ok = await showModal({title: 'ユーザー情報を保存', body: '変更内容を保存しますか？', okText: '保存'});
    if (!ok) return;

    // ----- Save flow -----
    // ユーザーは api.updateUser / api.deleteUser を直接呼ぶので config PATCH と違って
    // 「部分成功」があり得る。失敗時は S.USERS を committed せず、draft / dirty を保持。
    //
    // TODO(future): 部分成功を防ぐには batch endpoint or Firestore transaction 化が必要。
    //   案 1) POST /api/users/batch を用意して backend で一括 transaction 更新
    //   案 2) frontend で差分を全部 collect → 1 度に送る (backend で all-or-nothing 判定)
    // 現状は失敗時に draft/dirty を保持することで retry 可能なため運用上の実害は小さいと判断。
    const saveBtn = document.getElementById('users-save-btn');
    const rootEl = document.getElementById('settings-view');
    setSaveButtonState(saveBtn, true, rootEl);
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
      // 全 API 呼び出し成功: local commit + dirty clear
      S.USERS = JSON.parse(JSON.stringify(S.USERS_DRAFT));
      renderCurrentUserLabel();
      applyPermissionUI();
      clearUsersDirty();
      await showModal({title: '保存完了', body: 'ユーザー情報を保存しました', okText: 'OK', cancelText: ''});
    } catch (err) {
      // 途中で失敗 → draft/dirty はそのまま。ユーザーが修正して再試行できる。
      await showModal({title: '保存に失敗しました', body: buildSaveErrorMessage(err), okText: 'OK', cancelText: ''});
    } finally {
      setSaveButtonState(saveBtn, false, rootEl);
    }
  });
}
