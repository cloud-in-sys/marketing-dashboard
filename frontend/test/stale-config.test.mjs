// ソース切替の stale ガード検証。
// state.js は api/firebase に依存するため、実装と同じ制御構造をここで動かす
// (末尾で実ファイルとの構造一致を確認して写し間違いを防ぐ)。
import fs from 'fs';
let fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`NG★ ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); }
  else console.log(`OK  ${name}`);
};

function makeApp(delays) {
  const S = { CURRENT_SOURCE: null, METRIC_DEFS: [], PRESETS_CACHE: [], CURRENT_VIEW: null };
  const applied = [];                     // applyConfig が走った回数の記録
  let configLoadVersion = 0;
  const isConfigFresh = (sid, v) => S.CURRENT_SOURCE === sid && configLoadVersion === v;
  const api = {
    getConfig: (sid) => new Promise(r => setTimeout(() => r({ config: { metricDefs: [`${sid}-metric`] } }), delays[sid])),
    listPresets: (sid) => new Promise(r => setTimeout(() => r({ presets: [`${sid}-preset`] }), delays[sid])),
    getMyState: (sid) => new Promise(r => setTimeout(() => r({ state: { currentView: `${sid}-view` } }), 1)),
  };
  async function loadSourceConfigFromServer(sid) {
    const version = ++configLoadVersion;
    const [{ config }, { presets }] = await Promise.all([api.getConfig(sid), api.listPresets(sid)]);
    if (!isConfigFresh(sid, version)) return 'stale';
    S.METRIC_DEFS = config.metricDefs; applied.push(sid);      // applyConfig 相当
    if (!isConfigFresh(sid, version)) return 'stale';
    S.PRESETS_CACHE = presets;
    await api.getMyState(sid);                                  // loadUserStateForCurrentSource 相当
    if (!isConfigFresh(sid, version)) return 'stale';
    S.CURRENT_VIEW = `${sid}-view`;
    return 'ok';
  }
  async function switchSource(id) {
    S.CURRENT_SOURCE = id;
    return (await loadSourceConfigFromServer(id)) === 'ok';
  }
  return { S, applied, switchSource };
}

console.log('═══ ★A(遅い) → B(速い): B が勝つこと ═══');
{
  const { S, applied, switchSource } = makeApp({ A: 100, B: 10 });
  const a = switchSource('A');
  await new Promise(r => setTimeout(r, 5));
  const b = switchSource('B');
  const [okA, okB] = await Promise.all([a, b]);
  t('CURRENT_SOURCE は B', S.CURRENT_SOURCE, 'B');
  t('★METRIC_DEFS が B (A に上書きされない)', S.METRIC_DEFS, ['B-metric']);
  t('★PRESETS_CACHE が B', S.PRESETS_CACHE, ['B-preset']);
  t('★CURRENT_VIEW が B', S.CURRENT_VIEW, 'B-view');
  t('A の switchSource は false (stale)', okA, false);
  t('B の switchSource は true', okB, true);
  t('★applyConfig は B の 1 回だけ (A は反映されない)', applied, ['B']);
}

console.log('\n═══ 逆順 A(速い) → B(遅い) ═══');
{
  const { S, applied, switchSource } = makeApp({ A: 10, B: 100 });
  const a = switchSource('A');
  await new Promise(r => setTimeout(r, 5));
  const b = switchSource('B');
  await Promise.all([a, b]);
  t('最終的に B', [S.CURRENT_SOURCE, S.METRIC_DEFS[0]], ['B', 'B-metric']);
  t('A は途中で捨てられる (applied に A が無い)', applied.includes('A'), false);
}

console.log('\n═══ 3 連続切替 A → B → C ═══');
{
  const { S, applied, switchSource } = makeApp({ A: 80, B: 50, C: 10 });
  const ps = [switchSource('A')];
  await new Promise(r => setTimeout(r, 2)); ps.push(switchSource('B'));
  await new Promise(r => setTimeout(r, 2)); ps.push(switchSource('C'));
  const res = await Promise.all(ps);
  t('最後の C が反映される', [S.CURRENT_SOURCE, S.METRIC_DEFS[0], S.CURRENT_VIEW], ['C', 'C-metric', 'C-view']);
  t('true を返すのは C だけ', res, [false, false, true]);
  t('applyConfig は C のみ', applied, ['C']);
}

console.log('\n═══ 単独切替は普通に成功する (退行なし) ═══');
{
  const { S, applied, switchSource } = makeApp({ A: 10 });
  const ok = await switchSource('A');
  t('成功する', ok, true);
  t('反映される', [S.METRIC_DEFS[0], S.PRESETS_CACHE[0], S.CURRENT_VIEW], ['A-metric', 'A-preset', 'A-view']);
  t('applyConfig 1 回', applied, ['A']);
}

console.log('\n═══ 実装との構造一致 ═══');
const src = fs.readFileSync(new URL('../src/app/state.ts', import.meta.url), 'utf8');
// 引数と戻り値の型注釈を許容する (TS 化で付いたが意味は変わらない)。
// 抽出に失敗したら「後続の検査が全部素通り」になるので、null を握りつぶさず明示的に落とす。
const bodyMatch = /async function loadSourceConfigFromServer\(sid[^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(src);
if (!bodyMatch) {
  console.log('NG★ loadSourceConfigFromServer の本文を抽出できない (シグネチャが変わった?)');
  process.exit(1);
}
const body = bodyMatch[1];
t('世代番号を採番している', /const version = \+\+configLoadVersion;/.test(body), true);
t('isConfigFresh は sid と version の両方を見る',
  /S\.CURRENT_SOURCE === sid && configLoadVersion === version/.test(src), true);
t('await 後に 3 回チェックしている', (body.match(/if \(!isConfigFresh\(sid, version\)\) return 'stale';/g) || []).length, 3);
t('applyConfig の前にチェックがある',
  body.indexOf("return 'stale'") < body.indexOf('applyConfig(config)'), true);
t('switchSource は ok 判定を返す', /return result === 'ok';/.test(src), true);
const mainSrc = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
// switchSource が false (キャンセル or stale) なら reloadFullUI へ進まないこと。
// 戻り値は理由付きオブジェクトになったので ROUTE_CANCELLED を返す形で検査する。
t('router は stale なら reloadFullUI しない',
  /if \(!\(await switchSource\(route\.sid\)\)\) return ROUTE_CANCELLED;\s*\n\s*await reloadFullUI\(\);/.test(mainSrc), true);

console.log('\n' + (fail === 0 ? '✅ 全て期待どおり' : `❌ ${fail} 件 失敗`));
process.exit(fail ? 1 : 0);
