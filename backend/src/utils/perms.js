// フロントと同じ順・キーを保つこと (frontend/src/app/state.js の PERM_GROUPS)
export const PERM_GROUPS = [
  // 閲覧可否はグループ管理 (canAccessSource) が判定する。旧 viewSources は廃止。
  { group: 'sources', perms: ['manageSources', 'connectAccount'] },
  { group: 'custom',  perms: ['viewCustom', 'addCustom', 'editCustom', 'deleteCustom'] },
  { group: 'settings', perms: [
    'editMetrics', 'editFilters', 'editDimensions', 'editDefaults',
    // プリセット系。editPreset = 「プリセット設定」(設定画面を開く + 既存を編集) の統合権限。
    // 旧 viewPresets (表示のみ) は廃止し editPreset へ統合した。
    // 旧データは normalizePresetPerms() が読み取り時に editPreset へ引き上げる。
    'editPreset', 'savePreset', 'deletePreset',
    // ユーザー管理は isAdmin 限定 (旧 manageUsers は廃止)。
    // backend は元から adminOnly で、manageUsers を持っていても全 API が 403 だった。
    // 権限として残すと「画面は出るが何もできない」ため、isAdmin に一本化した。
    'manageGroups', 'manageBranding',
  ]},
];

export const PERM_KEYS = PERM_GROUPS.flatMap(g => g.perms);

export const ADMIN_PERMS = Object.fromEntries(PERM_KEYS.map(k => [k, true]));
export const VIEWER_PERMS = Object.fromEntries(PERM_KEYS.map(k => [k, false]));

// ロール判定 (frontend/src/features/settings/users/users.js の getUserRole と揃える):
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

// 旧権限 (viewPresets) の互換: viewPresets だけ持つユーザーは editPreset を持つ扱いにする。
// 「プリセット設定」に統合したことで、旧データのままだと設定画面に入れなくなるため。
export function normalizePresetPerms(perms) {
  if (!perms || typeof perms !== 'object') return perms;
  if (perms.viewPresets && !perms.editPreset) return { ...perms, editPreset: true };
  return perms;
}
