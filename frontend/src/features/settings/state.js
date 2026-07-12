// Shared module-level state for the settings sub-views.
// groupsCache is read by users.js (group dropdown in user detail) and
// owned/written by groups.js. Wrapped in an object so reassignment is
// visible across modules.
export const settingsState = {
  groupsCache: [],
  sourcesCache: [],
  groupDetailId: null,
  userDetailIdx: null,
};
