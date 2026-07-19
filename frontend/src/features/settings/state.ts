// Shared module-level state for the settings sub-views.
// groupsCache is read by users.js (group dropdown in user detail) and
// owned/written by groups.js. Wrapped in an object so reassignment is
// visible across modules.
interface SettingsState {
  groupsCache: any[];
  sourcesCache: any[];
  /** グループ詳細で開いている group id (一覧表示中は null) */
  groupDetailId: string | null;
  /** ユーザー詳細で開いている index (一覧表示中は null) */
  userDetailIdx: number | null;
  groupMembersCache: any[];
}

export const settingsState: SettingsState = {
  groupsCache: [],
  sourcesCache: [],
  groupDetailId: null,
  userDetailIdx: null,
  // グループ管理画面のメンバー一覧 ({ uid, name, email, groupId } のみ / perms なし)。
  // S.USERS とは別に持つこと。S.USERS は getCurrentUser() が権限判定に使う配列なので、
  // perms を持たないメンバー一覧で上書きすると hasPerm() が総崩れになる。
  groupMembersCache: [],
};
