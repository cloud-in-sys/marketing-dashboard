// 権限定義の正 (single source of truth)。
//
// ここが唯一の定義。frontend は `@pkg/shared/perms.ts` から import する
// (`app/state.js` が再エクスポートしているので、既存の import 元は変えなくてよい)。
//
// backend (`backend/src/utils/perms.js`) は**このファイルを実行時に読めない**。
// Dockerfile が `COPY src ./src`、deploy.sh が `--source backend` で、
// ビルドコンテキストが backend/ だけだから (packages/ はコンテナに入らない)。
// そのため backend はキーだけの写しを持ち続ける。
//
//   → 写しがズレていないことは `frontend/test/perms.test.mjs` が機械検査する。
//     権限を足す時は「ここ」と「backend/src/utils/perms.js」の両方に足すこと。
//     片方だけだと、設定画面にチェックボックスは出るのに backend の
//     ホワイトリストで黙って捨てられ、リロードするとチェックが外れている、という
//     エラーも警告も出ない不具合になる。テストはこれを落とすためにある。
//
// このファイルは **import を持たないこと**。node のテストが frontend/backend 両方の
// 定義を直接 import して実値で突き合わせられるのは、双方が依存ゼロだからで、
// ここに import を足すと (alias が node で解決できず) テストが書けなくなる。
// (拡張子は .ts でよい。npm test は --experimental-strip-types 付きで動く)

export interface PermDef {
  /** 保存キー。backend のホワイトリストと一致していること */
  key: PermissionKey;
  /** 設定画面の表示名 */
  label: string;
  /** 親権限のキー。親が OFF の時は自動で OFF になる */
  parent?: PermissionKey;
}

export interface PermGroup {
  /** グループ識別子 */
  group: string;
  /** 設定画面の見出し */
  label: string;
  perms: readonly PermDef[];
}

// as const を付けることで PERM_KEYS が literal union になり、
// PermissionKey を「実際のキーから」導出できる (手作業の写しを作らない)。
// これを外すと string に広がり、hasPerm('editMetrcs') のような typo が通ってしまう。
export const PERM_GROUPS = [
  // 閲覧可否はグループ管理 (allowedGroupIds / isPublic) が唯一の判定基準。
  // 旧 viewSources はサイドバーを隠すだけで backend の認可 (canAccessSource) では
  // 一切見ておらず、グループ管理と役割が重複していたため廃止した。
  {group: 'sources', label: 'データソース', perms: [
    {key: 'manageSources',     label: '管理（追加・編集・削除・更新）'},
    {key: 'connectAccount',    label: 'Googleアカウント連携'},
  ]},
  {group: 'custom', label: 'カスタムタブ', perms: [
    {key: 'viewCustom',   label: 'グループを表示'},
    {key: 'addCustom',    label: '追加'},
    {key: 'editCustom',   label: '編集'},
    {key: 'deleteCustom', label: '削除'},
  ]},
  {group: 'settings', label: '設定', perms: [
    {key: 'editMetrics',    label: 'メトリクス設定'},
    {key: 'editFilters',    label: 'フィルタ設定'},
    {key: 'editDimensions', label: 'ディメンション設定'},
    {key: 'editDefaults',   label: '標準タブ設定'},
    // プリセット系。editPreset =「プリセット設定」= 設定画面を開ける + 既存プリセットを編集できる。
    // 旧 viewPresets (表示のみ) は廃止し editPreset に統合した (表示だけ許可しても編集
    // できなければ意味がないため)。旧データは backend の normalizePresetPerms が引き上げる。
    {key: 'editPreset',     label: 'プリセット設定'},
    // parent 付きの権限は「親が ON の時だけ意味を持つ」追加権限。
    // UI では親配下にネストして表示し、親を OFF にすると自動で外す (users.js)。
    {key: 'savePreset',     label: '新規追加・複製', parent: 'editPreset'},
    {key: 'deletePreset',   label: '削除',    parent: 'editPreset'},
    // 管理者設定 (サイドバー「管理者設定」セクション)
    // ユーザー管理は isAdmin 限定 (旧 manageUsers は廃止)。backend は元から
    // adminOnly なので、権限を持たせても一覧・保存・追加・削除すべて 403 だった。
    // 「画面は出るが何もできない」状態を解消するため isAdmin に一本化した。
    // (ユーザー管理は自分の権限も変えられる = 実質 admin 昇格なので、権限で配らない)
    {key: 'manageGroups',   label: 'グループ管理'},
    {key: 'manageBranding', label: 'ブランディング (ロゴ・タイトル・テーマ)'},
  ]},
] as const;

// readonly タプルに対する flatMap は要素型 (タプルの union) を推論しきれないので
// as で確定させる。as は型だけなので出力される JS は変わらない。
export const PERM_DEFS = PERM_GROUPS.flatMap(g => g.perms as readonly PermDef[]);
export const PERM_KEYS = PERM_DEFS.map(p => p.key);

/**
 * 実在する権限キーの literal union。
 * PERM_GROUPS (as const) から導出しているので、**キーの一覧をどこにも書き写していない**。
 * 権限を足すと自動で union に入り、typo (`hasPerm('editMetrcs')` 等) は
 * コンパイル時に落ちる。
 */
export type PermissionKey = typeof PERM_GROUPS[number]['perms'][number]['key'];
export const ADMIN_PERMS = Object.fromEntries(PERM_DEFS.map(p => [p.key, true]));
export const VIEWER_PERMS = Object.fromEntries(PERM_DEFS.map(p => [p.key, false]));

// operator 判定に使う区分。
// operator = 非 admin かつ「settings 以外の全 perms 持ち」かつ「settings perms 全部なし」。
// 同じ判定が backend (`utils/perms.js` の isOperator)、frontend の `app/auth.js` と
// `features/settings/users/users.js` にもある。三者がズレると
// 「ロール表示は operator なのに backend では operator 扱いされない」が起きるため、
// 区分の元になるこの 2 つはここに置き、テストで backend との一致を検査する。
export const SETTINGS_PERM_KEYS: readonly PermissionKey[] = PERM_GROUPS.find(g => g.group === 'settings')?.perms.map(p => p.key) || [];
export const NON_SETTINGS_PERM_KEYS: readonly PermissionKey[] = PERM_KEYS.filter(k => !SETTINGS_PERM_KEYS.includes(k));
