// Keep in sync with frontend js/state.js PERM_GROUPS
export const PERM_GROUPS = [
  { group: 'sources', perms: ['viewSources', 'addSource', 'deleteSource'] },
  { group: 'preset', perms: ['viewPresets', 'editPreset', 'savePreset', 'deletePreset'] },
  { group: 'custom', perms: ['viewCustom', 'addCustom', 'editCustom', 'deleteCustom'] },
  { group: 'settings', perms: ['editMetrics', 'editFilters', 'editDimensions', 'editDefaults', 'manageUsers'] },
];

export const PERM_KEYS = PERM_GROUPS.flatMap(g => g.perms);

export const ADMIN_PERMS = Object.fromEntries(PERM_KEYS.map(k => [k, true]));
export const VIEWER_PERMS = Object.fromEntries(PERM_KEYS.map(k => [k, false]));
