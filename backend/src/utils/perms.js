// フロントと同じ順・キーを保つこと (js/state.js の PERM_GROUPS)
export const PERM_GROUPS = [
  { group: 'sources', perms: ['viewSources', 'manageSources', 'connectAccount'] },
  { group: 'custom',  perms: ['viewCustom', 'addCustom', 'editCustom', 'deleteCustom'] },
  { group: 'settings', perms: [
    'editMetrics', 'editFilters', 'editDimensions', 'editDefaults',
    // プリセット系 (旧 preset group を統合)
    'viewPresets', 'editPreset', 'savePreset', 'deletePreset',
    'manageUsers', 'manageGroups',
  ]},
];

export const PERM_KEYS = PERM_GROUPS.flatMap(g => g.perms);

export const ADMIN_PERMS = Object.fromEntries(PERM_KEYS.map(k => [k, true]));
export const VIEWER_PERMS = Object.fromEntries(PERM_KEYS.map(k => [k, false]));
