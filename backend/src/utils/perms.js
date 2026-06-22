// フロントと同じ順・キーを保つこと (js/state.js の PERM_GROUPS)
export const PERM_GROUPS = [
  { group: 'sources', perms: ['viewSources', 'manageSources', 'connectAccount'] },
  { group: 'custom',  perms: ['viewCustom', 'addCustom', 'editCustom', 'deleteCustom'] },
  { group: 'settings', perms: [
    'editMetrics', 'editFilters', 'editDimensions', 'editDefaults',
    // プリセット系 (旧 preset group を統合)
    'viewPresets', 'editPreset', 'savePreset', 'deletePreset',
    'manageUsers', 'manageGroups', 'manageBranding',
  ]},
];

export const PERM_KEYS = PERM_GROUPS.flatMap(g => g.perms);

export const ADMIN_PERMS = Object.fromEntries(PERM_KEYS.map(k => [k, true]));
export const VIEWER_PERMS = Object.fromEntries(PERM_KEYS.map(k => [k, false]));

// ロール判定 (frontend の js/settings/users.js getUserRole と揃える):
// operator = 非 admin かつ「settings 以外の全 perms 持ち」かつ「settings perms 全部なし」
const SETTINGS_PERMS = PERM_GROUPS.find(g => g.group === 'settings')?.perms || [];
const NON_SETTINGS_PERMS = PERM_KEYS.filter(k => !SETTINGS_PERMS.includes(k));
export function isOperator(user) {
  if (!user || user.isAdmin) return false;
  if (!user.perms) return false;
  return NON_SETTINGS_PERMS.every(k => user.perms[k]) && SETTINGS_PERMS.every(k => !user.perms[k]);
}
// データソース作成は admin か operator のみ。一般 (viewer) は manageSources を
// 個別付与されていても作成不可。
export function canCreateSource(user) {
  return !!user && (user.isAdmin || isOperator(user));
}
