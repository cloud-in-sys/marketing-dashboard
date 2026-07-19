// 権限定義が frontend (packages/shared) と backend でズレていないことの検査。
//
// なぜ機械検査が要るか:
//   backend は packages/shared を実行時に読めない (Dockerfile が COPY src ./src、
//   deploy.sh が --source backend で、ビルドコンテキストが backend/ だけ)。
//   そのため backend はキーだけの写しを持っている。
//   写しがズレると「設定画面にチェックボックスは出るのに backend の
//   ホワイトリストで黙って捨てられ、リロードするとチェックが外れている」という、
//   エラーも警告も出ない不具合になる。それを落とすのがこのテスト。
//
// 文字列の正規表現ではなく**両方の実値を import して突き合わせる**。
// これができるのは shared/perms.js と backend/utils/perms.js が
// どちらも import ゼロ (node が素で読める) だから。両者に import を足さないこと。

import * as shared from '../../packages/shared/src/perms.ts';
import * as backend from '../../backend/src/utils/perms.js';
import fs from 'fs';

let fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`NG★ ${name}\n     got =${JSON.stringify(got)}\n     want=${JSON.stringify(want)}`); }
  else console.log(`OK  ${name}`);
};

console.log('═══ キー集合が frontend と backend で一致 ═══');
const sharedKeys = shared.PERM_KEYS;
const backendKeys = backend.PERM_KEYS;
t('★キーが順序込みで完全一致', sharedKeys, backendKeys);
t('frontend にしか無いキーは無い', sharedKeys.filter(k => !backendKeys.includes(k)), []);
t('backend にしか無いキーは無い', backendKeys.filter(k => !sharedKeys.includes(k)), []);
t('キーの重複が無い (shared)', sharedKeys.length, new Set(sharedKeys).size);
t('キーの重複が無い (backend)', backendKeys.length, new Set(backendKeys).size);

console.log('\n═══ グループ構成が一致 ═══');
t('グループ名が順序込みで一致',
  shared.PERM_GROUPS.map(g => g.group),
  backend.PERM_GROUPS.map(g => g.group));
for (const sg of shared.PERM_GROUPS) {
  const bg = backend.PERM_GROUPS.find(g => g.group === sg.group);
  t(`群 ${sg.group} のキーが一致`, sg.perms.map(p => p.key), bg?.perms);
}

console.log('\n═══ 派生オブジェクトが一致 ═══');
t('ADMIN_PERMS のキー', Object.keys(shared.ADMIN_PERMS), Object.keys(backend.ADMIN_PERMS));
t('VIEWER_PERMS のキー', Object.keys(shared.VIEWER_PERMS), Object.keys(backend.VIEWER_PERMS));
t('ADMIN_PERMS は全部 true', Object.values(shared.ADMIN_PERMS).every(v => v === true), true);
t('VIEWER_PERMS は全部 false', Object.values(shared.VIEWER_PERMS).every(v => v === false), true);

console.log('\n═══ operator 判定の区分が一致 ═══');
// backend は SETTINGS_PERMS を export していないので PERM_GROUPS から同じ手順で導出する
const backendSettings = backend.PERM_GROUPS.find(g => g.group === 'settings')?.perms || [];
t('settings 群のキーが一致', shared.SETTINGS_PERM_KEYS, backendSettings);
t('settings 以外のキーが一致',
  shared.NON_SETTINGS_PERM_KEYS,
  backendKeys.filter(k => !backendSettings.includes(k)));
// backend の isOperator に shared 由来の perms を食わせて期待どおり判定されるか
const operatorPerms = Object.fromEntries(sharedKeys.map(k => [k, !shared.SETTINGS_PERM_KEYS.includes(k)]));
t('★operator の perms を backend が operator と判定する',
  backend.isOperator({ isAdmin: false, perms: operatorPerms }), true);
t('admin は operator ではない', backend.isOperator({ isAdmin: true, perms: operatorPerms }), false);
t('viewer は operator ではない',
  backend.isOperator({ isAdmin: false, perms: { ...shared.VIEWER_PERMS } }), false);
t('全権限持ちは operator ではない (settings も持つため)',
  backend.isOperator({ isAdmin: false, perms: { ...shared.ADMIN_PERMS } }), false);
t('operator からキーを 1 つ落とすと operator ではなくなる',
  backend.isOperator({ isAdmin: false, perms: { ...operatorPerms, [shared.NON_SETTINGS_PERM_KEYS[0]]: false } }), false);
t('データソース作成は operator に許可される',
  backend.canCreateSource({ isAdmin: false, perms: operatorPerms }), true);
t('データソース作成は viewer に不許可',
  backend.canCreateSource({ isAdmin: false, perms: { ...shared.VIEWER_PERMS, manageSources: true } }), false);

console.log('\n═══ parent の整合性 ═══');
const parents = shared.PERM_DEFS.filter(p => p.parent);
t('parent は 2 件 (savePreset / deletePreset)', parents.map(p => p.key), ['savePreset', 'deletePreset']);
t('parent はすべて実在するキーを指す',
  parents.filter(p => !sharedKeys.includes(p.parent)).map(p => p.key), []);
t('親自身は parent を持たない (入れ子は 1 段まで)',
  parents.filter(p => shared.PERM_DEFS.find(x => x.key === p.parent)?.parent).map(p => p.key), []);
t('すべての perm に label がある', shared.PERM_DEFS.filter(p => !p.label).map(p => p.key), []);

console.log('\n═══ 旧権限の互換 (normalizePresetPerms) ═══');
t('viewPresets だけ持つ旧データは editPreset に引き上げられる',
  backend.normalizePresetPerms({ viewPresets: true }).editPreset, true);
t('editPreset を既に持つなら変えない',
  backend.normalizePresetPerms({ editPreset: true }).viewPresets, undefined);
t('廃止済みキーは現行の定義に残っていない',
  sharedKeys.filter(k => ['viewSources', 'manageUsers', 'viewPresets'].includes(k)), []);

console.log('\n═══ PermissionKey (literal union) の健全性 ═══');
// PERM_GROUPS に as const が付いていないと union が string に広がり、
// hasPerm('typo') が素通りするようになる。付いていることを固定する。
const sharedRaw = fs.readFileSync(new URL('../../packages/shared/src/perms.ts', import.meta.url), 'utf8');
t('★PERM_GROUPS に as const が付いている (外すと typo が検出できなくなる)',
  /\]\s*as const;/.test(sharedRaw), true);
t('★PermissionKey を PERM_GROUPS から導出している (キー一覧を書き写していない)',
  /export type PermissionKey = typeof PERM_GROUPS\[number\]\['perms'\]\[number\]\['key'\]/.test(sharedRaw), true);
t('PermissionKey の候補数が実キー数と一致', sharedKeys.length, 15);

console.log('\n═══ 定義が 1 箇所にしか無い (再定義の再発防止) ═══');
const stateSrc = fs.readFileSync(new URL('../src/app/state.ts', import.meta.url), 'utf8');
t('★state.js は PERM_GROUPS を再定義せず再エクスポートしている',
  /export const PERM_GROUPS\s*=/.test(stateSrc), false);
t('state.ts が shared から再エクスポートしている',
  /export\s*\{[\s\S]*?PERM_GROUPS[\s\S]*?\}\s*from\s*'@pkg\/shared\/perms\.(js|ts)'/.test(stateSrc), true);
const sharedSrc = fs.readFileSync(new URL('../../packages/shared/src/perms.ts', import.meta.url), 'utf8');
t('★shared/perms.ts は import を持たない (node から直接読めること)',
  /^\s*import\s/m.test(sharedSrc), false);
const backendSrc = fs.readFileSync(new URL('../../backend/src/utils/perms.js', import.meta.url), 'utf8');
t('★backend/perms.js は import を持たない (同上)', /^\s*import\s/m.test(backendSrc), false);

// operator 判定の土台 (settings 群かどうか) は以前 3 箇所で個別に導出していた。
// shared の定数を使うようになったことを固定する (自前導出に戻ると落ちる)。
const authSrc = fs.readFileSync(new URL('../src/app/auth.ts', import.meta.url), 'utf8');
t('★auth.js は shared の区分定数を使う',
  /NON_SETTINGS_PERM_KEYS.*every[\s\S]{0,80}SETTINGS_PERM_KEYS.*every/.test(authSrc), true);
t('auth.js は settings 群を自前で導出していない',
  /g\.group\s*===\s*'settings'/.test(authSrc), false);
const usersSrc = fs.readFileSync(new URL('../src/features/settings/users/users.ts', import.meta.url), 'utf8');
t('★users.js は shared の区分定数を使う', /SETTINGS_PERM_KEYS\.includes/.test(usersSrc), true);
t('users.js は settings 群を自前で導出していない',
  /g\.group\s*===\s*'settings'/.test(usersSrc), false);

console.log(fail ? `\n❌ ${fail} 件の不一致` : '\n✅ 全て期待どおり');
process.exit(fail ? 1 : 0);
