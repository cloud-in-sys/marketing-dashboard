import { S } from '../state.js';
import { api } from '../api.js';
import { escapeHtml } from '../utils.js';
import { showModal } from '../modal.js';
import { settingsState } from './state.js';

function markGroupsDirty() { document.getElementById('groups-list')?.classList.add('has-dirty'); }

export async function loadGroupsAndRender() {
  try {
    const [gRes, uRes, sRes] = await Promise.all([api.listGroups(), api.listUsers(), api.listSources()]);
    settingsState.groupsCache = gRes.groups || [];
    S.USERS = uRes.users || [];
    settingsState.sourcesCache = sRes.sources || [];
    renderGroupsView();
  } catch (e) {
    console.warn('[groups] load failed', e);
    const list = document.getElementById('groups-list');
    if (list) list.innerHTML = `<div class="preset-empty">読み込みに失敗しました: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

function renderGroupsView() {
  const list = document.getElementById('groups-list');
  if (!list) return;
  if (settingsState.groupDetailId == null) {
    renderGroupsListView(list);
  } else {
    renderGroupDetail(list, settingsState.groupDetailId);
  }
}

function renderGroupsListView(list) {
  if (settingsState.groupsCache.length === 0) {
    list.innerHTML = '<div class="preset-empty">まだグループがありません。「+ グループを追加」で作成できます。</div>';
    return;
  }
  list.innerHTML = `<div class="user-list-compact">${settingsState.groupsCache.map(g => {
    const memberCount = S.USERS.filter(u => u.groupId === g.id).length;
    return `
      <div class="user-list-row" data-group-open="${g.id}">
        <div class="user-avatar">${escapeHtml((g.name || '?').slice(0, 1).toUpperCase())}</div>
        <div class="user-list-info">
          <div class="user-list-name">${escapeHtml(g.name)}</div>
          <div class="user-list-id">メンバー ${memberCount}人</div>
        </div>
        <span class="user-list-caret">›</span>
      </div>`;
  }).join('')}</div>`;
}

function renderGroupDetail(list, gid) {
  const isNew = gid === '__new__';
  const group = isNew
    ? { id: '__new__', name: '', sourceFilters: {} }
    : settingsState.groupsCache.find(g => g.id === gid);
  if (!group) { settingsState.groupDetailId = null; renderGroupsView(); return; }

  const members = S.USERS.filter(u => u.groupId === group.id);
  const sourceFilters = group.sourceFilters || {};

  // ソース一覧を表示。各ソース行に「見せる/見せない」と行フィルタ設定。
  // ソースの可視性は source.allowedGroupIds が source-of-truth なので、ここでは
  // group.id がそのソースの allowedGroupIds に含まれているかをチェックしてレンダ。
  const sourcesHtml = settingsState.sourcesCache.map(src => {
    const allowed = src.allowedGroupIds || [];
    const isPublicSource = allowed.length === 0 && src.isPublic !== false;
    const isVisible = isPublicSource
      ? true
      : allowed.includes(group.id);
    const visState = isPublicSource ? 'public' : (isVisible ? 'allowed' : 'blocked');
    const f = sourceFilters[src.id] || { field: '', op: 'equals', value: '' };
    const fieldVal = f.field || '';
    const op = f.op || 'equals';
    const isSingleValue = op === 'equals' || op === 'regex' || op === 'notRegex';
    const valStr = isSingleValue
      ? (f.value || '')
      : (Array.isArray(f.values) ? f.values.join(',') : '');
    const valuePlaceholder = (op === 'regex' || op === 'notRegex')
      ? '正規表現 (例: ^広告.*$)'
      : (op === 'equals' ? '値' : '値（複数はカンマ区切り）');
    return `<div class="group-source-row" data-source-id="${escapeHtml(src.id)}">
      <div class="group-source-head">
        <div class="group-source-name">${escapeHtml(src.name)}</div>
        <label class="group-source-vis-toggle" title="このソースをこのグループに見せるか">
          <input type="checkbox" data-group-source-visible${isVisible !== false ? ' checked' : ''}>
          <span>${visState === 'public' ? '公開中' : isVisible ? '公開中' : '非公開中'}</span>
        </label>
      </div>
      <div class="group-source-filter">
        <span class="group-source-filter-label">行絞り込み:</span>
        <input type="text" class="api-input" data-group-filter-field value="${escapeHtml(fieldVal)}" placeholder="フィールド名 (例: operator)">
        <select data-group-filter-op>
          <option value="equals"${op === 'equals' ? ' selected' : ''}>等しい</option>
          <option value="in"${op === 'in' ? ' selected' : ''}>いずれか</option>
          <option value="notIn"${op === 'notIn' ? ' selected' : ''}>いずれでもない</option>
          <option value="regex"${op === 'regex' ? ' selected' : ''}>正規表現に一致</option>
          <option value="notRegex"${op === 'notRegex' ? ' selected' : ''}>正規表現に一致しない</option>
        </select>
        <input type="text" class="api-input" data-group-filter-values value="${escapeHtml(valStr)}" placeholder="${escapeHtml(valuePlaceholder)}">
      </div>
    </div>`;
  }).join('');

  list.innerHTML = `
    <button type="button" class="user-back-btn" data-group-back>← 一覧に戻る</button>
    <div class="user-row" data-group-id="${escapeHtml(group.id)}">
      <div class="user-row-top">
        <div class="user-avatar">${escapeHtml((group.name || '?').slice(0, 1).toUpperCase())}</div>
        <div class="user-row-main">
          <input type="text" class="user-name-input" data-group-name value="${escapeHtml(group.name)}" placeholder="グループ名（例: 代理店A）">
        </div>
      </div>

      <div class="user-perms-section">
        <div class="user-perms-title">所属メンバー</div>
        <div class="group-filters-desc">メンバーの変更は「ユーザー一覧」→ 各ユーザーの詳細画面から行ってください。</div>
        ${members.length === 0
          ? '<div class="preset-empty" style="padding:8px 0">まだ所属メンバーがいません</div>'
          : `<ul class="group-member-list">${members.map(u => `<li>${escapeHtml(u.name || u.email)}${u.isAdmin ? '（管理者）' : ''}</li>`).join('')}</ul>`}
      </div>

      <div class="user-perms-section">
        <div class="user-perms-title">データソース別アクセス権</div>
        <div class="group-filters-desc">
          ・「見せる」: このグループのメンバーがこのソースを開ける<br>
          ・「行絞り込み」: 設定すると、行のうち条件に一致するものだけ見せる（空欄なら絞らない）
        </div>
        ${isNew
          ? '<div class="preset-empty" style="padding:8px 0">グループを保存後に設定できます</div>'
          : (settingsState.sourcesCache.length === 0
              ? '<div class="preset-empty" style="padding:8px 0">データソースがありません</div>'
              : `<div class="group-source-list">${sourcesHtml}</div>`)}
      </div>

      <div class="user-row-actions">
        <button type="button" class="save-btn" data-group-save>${isNew ? '作成' : '保存'}</button>
        ${isNew ? '' : '<button type="button" class="link-btn danger" data-group-delete>削除</button>'}
      </div>
    </div>`;
}

// 詳細画面のDOMから編集中のデータを読み取る
// name + 各ソース行のフィルタ + 可視性チェックボックスを集める
function collectGroupDetailData() {
  const row = document.querySelector('[data-group-id]');
  if (!row) return null;
  const id = row.dataset.groupId;
  const name = row.querySelector('[data-group-name]').value.trim();

  const sourceFilters = {};
  const visibility = {};  // sid → bool (チェックされたら見せる)
  row.querySelectorAll('.group-source-row').forEach(r => {
    const sid = r.dataset.sourceId;
    const visible = r.querySelector('[data-group-source-visible]')?.checked;
    visibility[sid] = !!visible;
    const field = r.querySelector('[data-group-filter-field]')?.value.trim() || '';
    const op = r.querySelector('[data-group-filter-op]')?.value || 'equals';
    const raw = r.querySelector('[data-group-filter-values]')?.value.trim() || '';
    if (field) {
      if (op === 'equals' || op === 'regex' || op === 'notRegex') {
        sourceFilters[sid] = { field, op, value: raw };
      } else {
        sourceFilters[sid] = { field, op, values: raw.split(',').map(s => s.trim()).filter(Boolean) };
      }
    }
  });
  return { id, name, sourceFilters, visibility };
}

async function saveGroup() {
  const data = collectGroupDetailData();
  if (!data) return;
  if (!data.name) {
    await showModal({title: '保存できません', body: 'グループ名を入力してください', okText: 'OK', cancelText: ''});
    return;
  }
  try {
    let gid = data.id;

    // (1) グループ本体: name と sourceFilters を保存
    if (gid === '__new__') {
      const created = await api.createGroup({ name: data.name, sourceFilters: data.sourceFilters });
      gid = created.id;
      settingsState.groupsCache.push(created);
    } else {
      await api.updateGroup(gid, { name: data.name, sourceFilters: data.sourceFilters });
      const target = settingsState.groupsCache.find(g => g.id === gid);
      if (target) { target.name = data.name; target.sourceFilters = data.sourceFilters; }
    }

    // (2) ソース側 allowedGroupIds の更新 (可視性)
    for (const src of settingsState.sourcesCache) {
      const allowed = src.allowedGroupIds || [];
      const isPublic = allowed.length === 0 && src.isPublic !== false;
      const want = data.visibility[src.id];
      if (isPublic && want === false) {
        // 全員公開 → 制限モードに切替
        const allGids = settingsState.groupsCache.map(g => g.id).filter(g => g !== gid);
        await api.updateSource(src.id, { allowedGroupIds: allGids, isPublic: false });
        src.allowedGroupIds = allGids;
        src.isPublic = false;
      } else if (isPublic) {
        continue;
      } else {
        const has = allowed.includes(gid);
        if (want && !has) {
          const next = [...allowed, gid];
          await api.updateSource(src.id, { allowedGroupIds: next });
          src.allowedGroupIds = next;
        } else if (!want && has) {
          const next = allowed.filter(g => g !== gid);
          await api.updateSource(src.id, { allowedGroupIds: next });
          src.allowedGroupIds = next;
        }
      }
    }

    await showModal({title: '保存完了', body: 'グループを保存しました', okText: 'OK', cancelText: ''});
    settingsState.groupDetailId = null;
    await loadGroupsAndRender();
  } catch (e) {
    await showModal({title: '保存失敗', body: e.message || '保存に失敗しました', okText: 'OK', cancelText: ''});
  }
}

async function deleteGroup() {
  const data = collectGroupDetailData();
  if (!data || data.id === '__new__') return;
  const g = settingsState.groupsCache.find(x => x.id === data.id);
  const hasMembers = S.USERS.some(u => u.groupId === data.id);
  const ok = await showModal({
    title: 'グループを削除',
    body: `「${g?.name || data.id}」を削除しますか？` + (hasMembers ? '\n\n所属メンバーは自動的に「未分類」に戻ります。' : ''),
    okText: '削除', danger: true,
  });
  if (!ok) return;
  try {
    await api.deleteGroup(data.id);
    settingsState.groupsCache = settingsState.groupsCache.filter(x => x.id !== data.id);
    // ローカルのユーザーキャッシュも整合させる
    S.USERS.forEach(u => { if (u.groupId === data.id) u.groupId = null; });
    settingsState.groupDetailId = null;
    renderGroupsView();
  } catch (e) {
    await showModal({title: '削除失敗', body: e.message || '削除に失敗しました', okText: 'OK', cancelText: ''});
  }
}

export function setupGroupsEvents() {
  document.getElementById('add-group-btn')?.addEventListener('click', () => {
    settingsState.groupDetailId = '__new__';
    renderGroupsView();
  });

  document.getElementById('groups-list')?.addEventListener('click', async e => {
    // 一覧 → 詳細
    const openBtn = e.target.closest('[data-group-open]');
    if (openBtn) { settingsState.groupDetailId = openBtn.dataset.groupOpen; renderGroupsView(); return; }

    // 詳細 → 一覧に戻る
    if (e.target.closest('[data-group-back]')) { settingsState.groupDetailId = null; renderGroupsView(); return; }

    // 保存
    if (e.target.closest('[data-group-save]')) {
      await saveGroup();
      return;
    }

    // 削除
    if (e.target.closest('[data-group-delete]')) {
      await deleteGroup();
      return;
    }
  });

  document.getElementById('groups-list')?.addEventListener('input', () => markGroupsDirty());
  document.getElementById('groups-list')?.addEventListener('change', () => markGroupsDirty());
}
