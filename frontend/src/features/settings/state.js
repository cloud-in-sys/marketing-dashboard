// Shared module-level state for the settings sub-views.
// groupsCache is read by users.js (group dropdown in user detail) and
// owned/written by groups.js. Wrapped in an object so reassignment is
// visible across modules.
export const settingsState = {
  groupsCache: [],
  sourcesCache: [],
  groupDetailId: null,
  userDetailIdx: null,
  // グループ管理画面のメンバー一覧 ({ uid, name, email, groupId } のみ / perms なし)。
  // S.USERS とは別に持つこと。S.USERS は getCurrentUser() が権限判定に使う配列なので、
  // perms を持たないメンバー一覧で上書きすると hasPerm() が総崩れになる。
  groupMembersCache: [],
};
