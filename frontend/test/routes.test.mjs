import { buildPath, parsePath, sameRoute, SCREEN, SETTINGS_TARGETS } from '../src/app/routes.ts';
let fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`NG★ ${name}\n     got =${JSON.stringify(got)}\n     want=${JSON.stringify(want)}`); }
  else console.log(`OK  ${name}`);
};
const SID = '4T9FcHaO6V0n5KZItFHa';

console.log('═══ buildPath (状態 → URL) ═══');
t('ダッシュボード 標準タブ', buildPath({screen:SCREEN.DASHBOARD, sid:SID, viewKey:'summary_daily'}), `/s/${SID}/v/summary_daily`);
t('ダッシュボード カスタムタブ', buildPath({screen:SCREEN.DASHBOARD, sid:SID, viewKey:'custom_1752000000000'}), `/s/${SID}/v/custom_1752000000000`);
t('データソース画面', buildPath({screen:SCREEN.SOURCE, sid:SID}), `/s/${SID}/source`);
t('設定 users', buildPath({screen:SCREEN.SETTINGS, sid:SID, target:'users'}), `/s/${SID}/settings/users`);
t('設定 branding', buildPath({screen:SCREEN.SETTINGS, sid:SID, target:'branding'}), `/s/${SID}/settings/branding`);
t('viewKey なし → /s/:sid', buildPath({screen:SCREEN.DASHBOARD, sid:SID}), `/s/${SID}`);
t('不正な target → /s/:sid', buildPath({screen:SCREEN.SETTINGS, sid:SID, target:'evil'}), `/s/${SID}`);
t('sid なし → /', buildPath({screen:SCREEN.DASHBOARD, viewKey:'x'}), '/');
t('route が null → /', buildPath(null), '/');
t('route が undefined → /', buildPath(undefined), '/');
t('sid に / が混入 → /', buildPath({screen:SCREEN.DASHBOARD, sid:'a/b', viewKey:'x'}), '/');
t('sid に .. が混入 → /', buildPath({screen:SCREEN.DASHBOARD, sid:'..', viewKey:'x'}), '/');
t('viewKey に / 混入 → /s/:sid', buildPath({screen:SCREEN.DASHBOARD, sid:SID, viewKey:'a/b'}), `/s/${SID}`);
t('未知の screen → /s/:sid', buildPath({screen:'bogus', sid:SID}), `/s/${SID}`);

console.log('\n═══ parsePath (URL → 状態) ═══');
t('/s/:sid/v/:key', parsePath(`/s/${SID}/v/summary_daily`), {screen:'dashboard', sid:SID, viewKey:'summary_daily'});
t('/s/:sid/source', parsePath(`/s/${SID}/source`), {screen:'source', sid:SID});
t('/s/:sid/settings/users', parsePath(`/s/${SID}/settings/users`), {screen:'settings', sid:SID, target:'users'});
t('/s/:sid (タブ未指定)', parsePath(`/s/${SID}`), {screen:'dashboard', sid:SID, viewKey:null});
t('末尾スラッシュ許容', parsePath(`/s/${SID}/v/media/`), {screen:'dashboard', sid:SID, viewKey:'media'});
t('二重スラッシュ許容', parsePath(`//s//${SID}//v//media`), {screen:'dashboard', sid:SID, viewKey:'media'});

console.log('\n─── 解釈できない URL は null (既定へフォールバック) ───');
for (const [name, p] of [
  ['ルート /', '/'],
  ['空文字', ''],
  ['/foo', '/foo'],
  ['/s (sid なし)', '/s'],
  ['/s/ (sid 空)', '/s/'],
  ['未知の画面 /s/:sid/bogus', `/s/${SID}/bogus`],
  ['不正な settings target', `/s/${SID}/settings/evil`],
  ['settings に target なし', `/s/${SID}/settings`],
  ['v に key なし', `/s/${SID}/v`],
  ['余分なセグメント', `/s/${SID}/v/media/extra`],
  ['source に余分', `/s/${SID}/source/extra`],
  ['壊れた %エスケープ', `/s/${SID}/v/%`],
  ['数値', 123],
  ['null', null],
  ['undefined', undefined],
]) t(name, parsePath(p), null);

console.log('\n═══ 往復変換 (buildPath → parsePath で元に戻るか) ═══');
const roundtrips = [
  {screen:SCREEN.DASHBOARD, sid:SID, viewKey:'summary_daily'},
  {screen:SCREEN.DASHBOARD, sid:SID, viewKey:'custom_1752000000000'},
  {screen:SCREEN.SOURCE, sid:SID},
  ...SETTINGS_TARGETS.map(target => ({screen:SCREEN.SETTINGS, sid:SID, target})),
];
for (const r of roundtrips) {
  const back = parsePath(buildPath(r));
  const label = r.viewKey || r.target || r.screen;
  t(`往復: ${r.screen}/${label}`, back && back.screen === r.screen && back.sid === r.sid
      && (back.viewKey||null) === (r.viewKey||null) && (back.target||null) === (r.target||null), true);
}

console.log('\n═══ sameRoute (二重 push 防止) ═══');
const A = {screen:SCREEN.DASHBOARD, sid:SID, viewKey:'media'};
t('同一 → true', sameRoute(A, {...A}), true);
t('viewKey 違い → false', sameRoute(A, {...A, viewKey:'lpcr'}), false);
t('sid 違い → false', sameRoute(A, {...A, sid:'other'}), false);
t('screen 違い → false', sameRoute(A, {screen:SCREEN.SOURCE, sid:SID}), false);
t('target 違い → false', sameRoute({screen:SCREEN.SETTINGS,sid:SID,target:'users'}, {screen:SCREEN.SETTINGS,sid:SID,target:'groups'}), false);
t('viewKey undefined と null は同じ', sameRoute({screen:'source',sid:SID}, {screen:'source',sid:SID,viewKey:null}), true);
t('両方 null → true', sameRoute(null, null), true);
t('片方 null → false', sameRoute(A, null), false);

console.log('\n═══ 設定サブ画面の網羅 ═══');
t('SETTINGS_TARGETS は 8 件', SETTINGS_TARGETS.length, 8);
for (const target of SETTINGS_TARGETS) {
  t(`  ${target} が往復する`, parsePath(buildPath({screen:SCREEN.SETTINGS, sid:SID, target}))?.target, target);
}

console.log('\n═══ 実装との同期 (定数のズレ検知) ═══');
// SETTINGS_TARGETS は features/settings/index.js の enterSettingsMode(target) と
// 一致していなければならない。片方だけ増やすと、URL は作れるのに画面が開かない
// (またはその逆) という分かりにくい不具合になるので、ここで機械的に検査する。
import fs from 'fs';
const implSrc = fs.readFileSync(new URL('../src/features/settings/index.ts', import.meta.url), 'utf8');
const actual = [...new Set([...implSrc.matchAll(/target !== '([a-z]+)'/g)].map(m => m[1]))].sort();
t('SETTINGS_TARGETS が実装と一致', [...SETTINGS_TARGETS].sort(), actual);

console.log('\n' + (fail === 0 ? '✅ 全て期待どおり' : `❌ ${fail} 件 失敗`));
process.exit(fail ? 1 : 0);
