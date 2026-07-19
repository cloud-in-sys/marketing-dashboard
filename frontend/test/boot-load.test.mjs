// 起動時の初期ロード検証。
// snapshot / 集計 / 描画の回数を厳密に数える (「> 0」のような緩い判定はしない)。
// main.js の onReady と同じ制御構造を再現し、末尾で実ファイルとの一致も検査する。
import fs from 'fs';
import { SCREEN } from '../src/app/routes.ts';

let fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`NG★ ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); }
  else console.log(`OK  ${name}`);
};

const SID = 'S1';

// 起動シーケンス (順序と分岐は main.js と同じ)
async function boot(routedScreen, {
  canManageSources = true, snapshotExists = true, snapshotFails = false, prevUpdatedAt = null, snapshotStale = false,
} = {}) {
  const S = { SOURCE_SNAPSHOT_UPDATED_AT: prevUpdatedAt ? { [SID]: prevUpdatedAt } : {} };
  const calls = { render: 0, loadSnapshot: 0, aggregate: 0, enterSource: 0, enterSettings: 0 };
  const aggregateKeys = [];
  let screen = SCREEN.DASHBOARD;
  let spinner = false;

  // 集計 (aggregateBackend の cacheKey 生成と同じ構造)
  const prefetchAggregates = () => {
    const updatedAt = S.SOURCE_SNAPSHOT_UPDATED_AT[SID] || '';
    calls.aggregate++; aggregateKeys.push(updatedAt);
  };
  // main.js の render(): settings-mode (設定 / ソース画面) なら集計せず抜ける
  const render = () => {
    calls.render++;
    if (screen === SCREEN.SETTINGS || screen === SCREEN.SOURCE) { spinner = false; return; }
    spinner = true; prefetchAggregates(); spinner = false;
  };
  const SNAPSHOT = { LOADED:'loaded', MISSING:'missing', FAILED:'failed', STALE:'stale' };
  const loadSnapshotIfNeeded = async (options = {}) => {
    const emitRender = options.emitRender !== false;
    calls.loadSnapshot++;
    try {
      if (snapshotFails) throw new Error('meta failed');
      if (snapshotStale) return SNAPSHOT.STALE;   // 取得中に別ソースへ切り替わった
      if (!snapshotExists) return SNAPSHOT.MISSING;
      S.SOURCE_SNAPSHOT_UPDATED_AT[SID] = '2026-07-19T00:00:00Z';
      if (emitRender) render();
      return SNAPSHOT.LOADED;
    } catch (e) { spinner = false; return SNAPSHOT.FAILED; }
  };
  const enterSourceView = async () => { calls.enterSource++; screen = SCREEN.SOURCE; await loadSnapshotIfNeeded(); };
  const enterSettingsMode = async () => { calls.enterSettings++; screen = SCREEN.SETTINGS; };

  // applyBootRoute 相当
  if (routedScreen === SCREEN.SOURCE) { if (canManageSources) await enterSourceView(); }
  else if (routedScreen === SCREEN.SETTINGS) { await enterSettingsMode(); }

  // 画面ごとの初期ロード
  let errorShown = false;
  const usable = (r) => r === SNAPSHOT.LOADED || r === SNAPSHOT.MISSING;
  if (screen !== SCREEN.SOURCE) {
    const r = await loadSnapshotIfNeeded({ emitRender: false });
    if (r === SNAPSHOT.FAILED) errorShown = true;
    else if (screen === SCREEN.DASHBOARD && usable(r)) render();
  }
  return { calls, screen, spinner, aggregateKeys, S, errorShown };
}

console.log('═══ ★ダッシュボード直打ち ═══');
{
  const { calls, aggregateKeys, spinner } = await boot(SCREEN.DASHBOARD);
  t('snapshot 取得 1 回', calls.loadSnapshot, 1);
  t('★集計 正確に 1 回', calls.aggregate, 1);
  t('★集計時に sourceUpdatedAt が確定済み', aggregateKeys, ['2026-07-19T00:00:00Z']);
  t('★空の updatedAt で集計しない', aggregateKeys.includes(''), false);
  t('スピナーが残らない', spinner, false);
}

console.log('\n═══ ★設定画面 直打ち ═══');
{
  const { calls, screen, spinner } = await boot(SCREEN.SETTINGS);
  t('設定画面が開く', screen, SCREEN.SETTINGS);
  t('★集計 0 回', calls.aggregate, 0);
  t('snapshot 取得 1 回 (フィルタ選択肢のため必要)', calls.loadSnapshot, 1);
  t('★スピナーが付かない', spinner, false);
}

console.log('\n═══ ★データソース画面 直打ち ═══');
{
  const { calls, screen, spinner } = await boot(SCREEN.SOURCE);
  t('ソース画面が開く', screen, SCREEN.SOURCE);
  t('★snapshot 取得 1 回 (二重にならない)', calls.loadSnapshot, 1);
  t('★集計 0 回', calls.aggregate, 0);
  t('スピナーが残らない', spinner, false);
}

console.log('\n═══ snapshot が存在しない場合 ═══');
{
  const { calls, aggregateKeys, spinner } = await boot(SCREEN.DASHBOARD, { snapshotExists: false });
  t('snapshot 取得 1 回', calls.loadSnapshot, 1);
  t('集計は 1 回 (空表示のために必要)', calls.aggregate, 1);
  t('updatedAt は空のまま', aggregateKeys, ['']);
  t('スピナーが残らない', spinner, false);
}

console.log('\n═══ ★snapshot 取得に失敗した場合 ═══');
{
  const { calls, spinner, errorShown, aggregateKeys } = await boot(SCREEN.DASHBOARD, { snapshotFails: true });
  t('snapshot 取得を試みる', calls.loadSnapshot, 1);
  t('★集計 0 回 (失敗したら撃たない)', calls.aggregate, 0);
  t('★空/古い updatedAt でキャッシュキーを作らない', aggregateKeys, []);
  t('★エラーを表示する', errorShown, true);
  t('スピナーが残らない', spinner, false);
}

console.log('\n═══ ★ソース切替でメタ取得に失敗 (前ソースの updatedAt が残る) ═══');
{
  // 前のソースの updatedAt が残った状態で失敗しても、その古い値で集計しないこと
  const { calls, aggregateKeys, errorShown } = await boot(SCREEN.DASHBOARD, {
    snapshotFails: true, prevUpdatedAt: '2026-07-01T00:00:00Z',
  });
  t('★集計 0 回', calls.aggregate, 0);
  t('★古い updatedAt で集計しない', aggregateKeys, []);
  t('エラーを表示する', errorShown, true);
}

console.log('\n═══ ★起動中にソースを切り替えた場合 (STALE) ═══');
{
  // 起動処理が STALE を返した = 切替側が自分で snapshot を取り直して描画する。
  // ここで render すると updatedAt 未確定のまま二重に集計が飛ぶ。
  const { calls, aggregateKeys, errorShown } = await boot(SCREEN.DASHBOARD, { snapshotStale: true });
  t('★集計 0 回 (切替側に任せる)', calls.aggregate, 0);
  t('★空の updatedAt で集計しない', aggregateKeys, []);
  t('エラーは出さない (失敗ではない)', errorShown, false);
}

console.log('\n═══ 権限が無くソース画面を開けない場合はダッシュボード扱い ═══');
{
  const { calls, screen, aggregateKeys } = await boot(SCREEN.SOURCE, { canManageSources: false });
  t('ダッシュボードになる', screen, SCREEN.DASHBOARD);
  t('★集計 正確に 1 回', calls.aggregate, 1);
  t('snapshot 取得 1 回', calls.loadSnapshot, 1);
  t('ソース画面は開かない', calls.enterSource, 0);
  t('updatedAt 確定済み', aggregateKeys, ['2026-07-19T00:00:00Z']);
}

console.log('\n═══ 実装との構造一致 ═══');
const main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const srcJs = fs.readFileSync(new URL('../src/features/sources/sources.ts', import.meta.url), 'utf8');
const onReady = /onReady: async \(\) => \{([\s\S]*?)\n  \},/.exec(main)[1];
t('applyBootRoute が初期ロードより先',
  onReady.indexOf('applyBootRoute(boot)') < onReady.indexOf('loadSnapshotIfNeeded'), true);
t('★snapshot を emitRender: false で取る',
  /await loadSnapshotIfNeeded\(\{ emitRender: false \}\);/.test(onReady), true);
// snapshot 取得 → (FAILED 判定) → render の順であること。
// render は起動シーケンス中に 1 箇所だけ (先行 render が無い)。
t('★その後に render を 1 回だけ呼ぶ',
  (onReady.match(/\brender\(\);/g) || []).length, 1);
t('★起動時の先行 render が無い (snapshot より前に render しない)',
  onReady.indexOf('render();') > onReady.indexOf('loadSnapshotIfNeeded'), true);
t('SOURCE では loadSnapshotIfNeeded を呼ばない (enterSourceView が呼ぶ)',
  /bootScreen !== SCREEN\.SOURCE\) \{/.test(onReady), true);
t('loadSnapshotIfNeeded が emitRender を受ける',
  // 引数と戻り値の型注釈を許容する (TS 化で付いたが意味は変わらない)。
  /export async function loadSnapshotIfNeeded\(options[^)]*\)[^{]*\{[\s\S]{0,200}?const emitRender = options\.emitRender !== false;/.test(srcJs), true);
t('内部の emit(render) が emitRender で制御される',
  (srcJs.match(/if \(emitRender\) emit\('render'\)/g) || []).length, 2);
t('render() が settings-mode で早期 return する',
  /async function render\(\) \{[\s\S]{0,600}?contains\('settings-mode'\)\) \{[\s\S]{0,120}?return;/.test(main), true);
t('その際 aggregating スピナーを外す',
  /contains\('settings-mode'\)\) \{\s*\n\s*document\.body\.classList\.remove\('aggregating'\);/.test(main), true);
t('設定画面を抜ける経路では render が走る (applyView の scheduleRender)',
  /_exitSettingsMode\(\)[\s\S]*?scheduleRender\(\)/.test(
    fs.readFileSync(new URL('../src/features/presets/tabs.ts', import.meta.url), 'utf8')), true);
t('戻るで設定を閉じる分岐でも render する',
  /exitSettingsMode\(\);[\s\S]{0,200}?emit\('render'\)/.test(main), true);

t('★loadSnapshotIfNeeded が状態を返す (SNAPSHOT 定数)',
  /export const SNAPSHOT = \{[\s\S]*?FAILED: 'failed'/.test(srcJs), true);
t('★catch が FAILED を返す (握りつぶさない)',
  // catch (e: any) の型注釈を許容する。
  /catch \(e(: \w+)?\) \{[\s\S]{0,300}?return SNAPSHOT\.FAILED;/.test(srcJs), true);
t('★起動時に FAILED なら集計せずエラー表示',
  /snapshotResult === SNAPSHOT\.FAILED\) \{[\s\S]{0,300}?showAggregateError/.test(main), true);
t('★LOADED / MISSING のときだけ render する (STALE を弾く)',
  /isSnapshotUsable\(snapshotResult\)/.test(main)
  && /function isSnapshotUsable\(result[^)]*\)[^{]*\{\s*\n\s*return result === SNAPSHOT\.LOADED \|\| result === SNAPSHOT\.MISSING;/.test(main), true);
t('★エラー文言が用途に合っている (集計エラーと呼ばない)',
  /showAggregateError\('スナップショットの取得に失敗しました', '読み込みエラー'\)/.test(main), true);
t('showAggregateError がラベルを受け取る',
  /function showAggregateError\(message[^,]*, label = '集計エラー'\)/.test(main), true);
t('FAILED 以外かつ使える結果なら render',
  /\} else if \(bootScreen === SCREEN\.DASHBOARD && isSnapshotUsable\(snapshotResult\)\) \{/.test(main), true);

console.log('\n' + (fail === 0 ? '✅ 全て期待どおり' : `❌ ${fail} 件 失敗`));
process.exit(fail ? 1 : 0);
