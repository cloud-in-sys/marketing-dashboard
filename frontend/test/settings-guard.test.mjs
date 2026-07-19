// 「権限の無いユーザーが URL で設定画面を開けないか」の検証。
// canOpenSettings を実ファイルから抽出して、権限パターン総当たりで評価する。
import { SETTINGS_TARGETS } from '../src/app/routes.ts';
import fs from 'fs';

let fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`NG★ ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); }
  else console.log(`OK  ${name}`);
};

// main.js から canOpenSettings の実体を抜き出して評価可能にする
const main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
// 引数の型注釈 (target?: string) を許容する。抽出失敗を握りつぶさない。
const canOpenMatch = /function canOpenSettings\(target[^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(main);
if (!canOpenMatch) { console.log('NG★ canOpenSettings の本文を抽出できない'); process.exit(1); }
const body = canOpenMatch[1];
const makeCanOpen = (user) => new Function('target', 'hasPerm', 'getCurrentUser',
  body).bind(null);
const evalCanOpen = (target, user) =>
  makeCanOpen(user)(target, (k) => !!(user.isAdmin || user.perms?.[k]), () => user);

const TARGET_PERM = {
  users: null,  // isAdmin 限定
  metrics: 'editMetrics', filters: 'editFilters', dims: 'editDimensions',
  defaults: 'editDefaults', presets: 'editPreset',
  groups: 'manageGroups', branding: 'manageBranding',
};

console.log('═══ 権限なしユーザー (viewCustom のみ) は 1 つも開けない ═══');
const viewer = { isAdmin: false, perms: { viewCustom: true } };
for (const target of SETTINGS_TARGETS) {
  t(`${target.padEnd(9)} → 開けない`, evalCanOpen(target, viewer), false);
}

console.log('\n═══ admin は全部開ける ═══');
const admin = { isAdmin: true, perms: {} };
for (const target of SETTINGS_TARGETS) {
  t(`${target.padEnd(9)} → 開ける`, evalCanOpen(target, admin), true);
}

console.log('\n═══ 該当権限だけを持つ場合、その画面「だけ」開ける ═══');
for (const [target, perm] of Object.entries(TARGET_PERM)) {
  if (!perm) continue;   // users は isAdmin 限定なので別途
  const user = { isAdmin: false, perms: { [perm]: true } };
  t(`${perm.padEnd(15)} → ${target} が開ける`, evalCanOpen(target, user), true);
  // 他の画面は開けない
  const others = SETTINGS_TARGETS.filter(x => x !== target);
  const leaked = others.filter(x => evalCanOpen(x, user));
  t(`  ${' '.repeat(13)}   他 ${others.length} 画面は開けない`, leaked, []);
}

console.log('\n═══ ★ユーザー管理は admin 限定 (権限では開けない) ═══');
// 旧 manageUsers を持っていても開けないこと (廃止済み権限)
t('manageUsers を持っていても users は開けない',
  evalCanOpen('users', { isAdmin: false, perms: { manageUsers: true } }), false);
t('全権限を持つ非 admin でも users は開けない',
  evalCanOpen('users', { isAdmin: false, perms: Object.fromEntries(
    Object.values(TARGET_PERM).filter(Boolean).map(p => [p, true])) }), false);

console.log('\n═══ ★不正な target ═══');
for (const bad of ['evil', '', null, undefined, '../users', 'USERS']) {
  t(`target=${JSON.stringify(bad)} → 開けない`, evalCanOpen(bad, admin), false);
}

console.log('\n═══ メニュー押下時の条件と一致しているか (ねじれ検知) ═══');
// settings/index.js の各メニューハンドラの条件を抽出して突き合わせる
const idx = fs.readFileSync(new URL('../src/features/settings/index.ts', import.meta.url), 'utf8');
const navBlock = idx.slice(idx.indexOf('----- SETTINGS NAV -----'));
const menuConds = {};
// `getElementById(...)!.addEventListener` の `!` (non-null assertion) を許容する。
// TS 化で付いたもので、判定条件そのもの (hasPerm / isAdmin) の検査力は落ちていない。
for (const m of navBlock.matchAll(/getElementById\('open-([a-z-]+)'\)!?\.addEventListener\('click',[^\n]*?(?:hasPerm\('([a-zA-Z]+)'\)|getCurrentUser\(\)\.isAdmin)/g)) {
  menuConds[m[1]] = m[2] || '__isAdmin__';
}
const MENU_ID = { users:'settings', metrics:'metrics-doc', filters:'filters-doc',
  dims:'dims-doc', defaults:'defaults-doc', presets:'presets-settings',
  groups:'groups', branding:'branding' };
for (const target of SETTINGS_TARGETS) {
  const menuId = MENU_ID[target];
  const cond = menuConds[menuId];
  const expected = TARGET_PERM[target] || '__isAdmin__';
  t(`${target.padEnd(9)} メニュー条件と一致 (${cond ?? 'なし'})`, cond, expected);
}

console.log('\n═══ URL 経路のガード配置 ═══');
t('起動時 (applyBootRoute) が canOpenSettings で守られている',
  /routed\.screen === SCREEN\.SETTINGS[\s\S]{0,300}?if \(canOpenSettings\(routed\.target\)\)/.test(main), true);
t('popstate (applyRoute) が canOpenSettings で守られている',
  /route\.screen === SCREEN\.SETTINGS[\s\S]{0,200}?if \(!canOpenSettings\(route\.target\)\) return ROUTE_BLOCKED;/.test(main), true);
// main.js から enterSettingsMode を呼ぶのは 4 箇所:
//   1. 起動時 (applyBootRoute)      — canOpenSettings で守る
//   2. popstate (applyRoute)        — canOpenSettings で守る
//   3. プリセット編集の「終了」ボタン — プリセット一覧 (設定) へ戻す
//   4. プリセット編集中の戻る/進む (applyCurrentUrl) — 同じく一覧へ戻す
// 3,4 は preset 編集に入る時点で editPreset 権限を通過済みなので URL ガードは不要
// (コンテキストで守られる)。URL 経由 (1,2) にだけガードが要る。5 箇所目が増えたら
// ガード漏れに気づけるようにする。
// (import 行は `enterSettingsMode,` でカッコが無いのでこの正規表現には入らない)
t('enterSettingsMode の呼び出しは 4 箇所 (URL 2 + プリセット戻り 2)',
  (main.match(/await enterSettingsMode\(/g) || []).length, 4);
t('★プリセット編集の終了ボタンが一覧 (presets) へ戻す',
  /preset-exit-btn[\s\S]*?await enterSettingsMode\('presets'\)/.test(main), true);
t('★プリセット編集中の戻る/進む (popstate) も一覧 (presets) へ戻す',
  /PRESET_EDIT_IDX != null[\s\S]*?await enterSettingsMode\('presets'\)/.test(main), true);

console.log('\n═══ ソース画面 (/s/:sid/source) も manageSources が要る ═══');
// メニュー (⚙ 現在のソースの設定) は CSS の no-manage-sources で隠しているので、
// URL 経由だけ開けると「メニューに無いのに URL では開ける」ねじれになる。
t('メニューが no-manage-sources で隠れている (前提)',
  /body\.no-manage-sources #open-source-settings/.test(
    fs.readFileSync(new URL('../styles/layout/header.css', import.meta.url), 'utf8')), true);
t('起動時に manageSources を確認している',
  /routed\.screen === SCREEN\.SOURCE[\s\S]{0,300}?if \(hasPerm\('manageSources'\)\) await enterSourceView\(\)/.test(main), true);
t('popstate でも manageSources を確認している',
  /route\.screen === SCREEN\.SOURCE[\s\S]{0,200}?if \(!hasPerm\('manageSources'\)\) return ROUTE_BLOCKED;/.test(main), true);
t('ソース画面を開く URL 経路はこの 2 つだけ',
  (main.match(/await enterSourceView\(\)/g) || []).length, 2);

console.log('\n' + (fail === 0 ? '✅ 権限の無いユーザーは URL でも設定/ソース画面を開けない' : `❌ ${fail} 件 失敗`));
process.exit(fail ? 1 : 0);
