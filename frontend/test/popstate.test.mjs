// popstate (戻る/進む) のロジックを、履歴スタックを模して実際に動かす。
// main.js は DOM/firebase に依存するため、同じ制御構造をここに再現して検証する
// (末尾で実ファイルとの構造一致を確認し、写し間違いを防ぐ)。
import { parsePath, buildPath, sameRoute, SCREEN } from '../src/app/routes.ts';
import fs from 'fs';

let fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`NG★ ${name}\n     got =${JSON.stringify(got)} want=${JSON.stringify(want)}`); }
  else console.log(`OK  ${name}`);
};
const SID = 'SourceA00000000000001';
const SID2 = 'SourceB00000000000002';

// ---- ブラウザ履歴の模擬 ----
function makeHistory(initialPath) {
  return {
    stack: [initialPath], idx: 0, pushCount: 0,
    get current() { return this.stack[this.idx]; },
    pushState(_s, _t, path) { this.pushCount++; this.stack = this.stack.slice(0, this.idx + 1); this.stack.push(path); this.idx++; },
    replaceState(_s, _t, path) { this.stack[this.idx] = path; },
    back() { if (this.idx > 0) { this.idx--; return true; } return false; },
    forward() { if (this.idx < this.stack.length - 1) { this.idx++; return true; } return false; },
  };
}

// ---- アプリの模擬 (main.js の applyPopState / syncUrl と同じ制御構造) ----
function makeApp({ guardAllows = () => true, openableViews = ['summary_daily','media'], sources = [SID, SID2] } = {}) {
  const app = {
    sid: SID, view: 'summary_daily', screen: SCREEN.DASHBOARD, target: null,
    applyingPop: false, pendingPop: false, routeVersion: 0, renders: 0, guardCalls: 0,
  };
  const currentRoute = () => ({ screen: app.screen, sid: app.sid,
    viewKey: app.screen === SCREEN.DASHBOARD ? app.view : undefined,
    target: app.screen === SCREEN.SETTINGS ? app.target : undefined });
  const h = makeHistory(buildPath(currentRoute()));

  const syncUrl = () => {                       // 遷移時 (main.js の syncUrl)
    if (app.applyingPop) return;
    const path = buildPath(currentRoute());
    if (path === h.current) return;
    h.pushState(null, '', path);
  };
  const normalizeUrl = () => {                  // 正規化 (main.js の normalizeUrl)
    const path = buildPath(currentRoute());
    if (path !== h.current) h.replaceState(null, '', path);
  };
  // 画面適用 (main.js の applyRoute)。ガードは遷移関数の中にある想定。
  const OK = { ok: true }, CANCELLED = { ok: false, reason: 'cancelled' }, BLOCKED = { ok: false, reason: 'blocked' };
  const applyRoute = async (route) => {
    if (route.sid !== app.sid) {
      if (!sources.includes(route.sid)) return BLOCKED;
      app.guardCalls++; if (!guardAllows()) return CANCELLED;
      app.sid = route.sid;
    }
    if (route.screen === SCREEN.SOURCE) { app.guardCalls++; if (!guardAllows()) return CANCELLED; app.screen = SCREEN.SOURCE; return OK; }
    if (route.screen === SCREEN.SETTINGS) { app.guardCalls++; if (!guardAllows()) return CANCELLED; app.screen = SCREEN.SETTINGS; app.target = route.target; return OK; }
    if (route.viewKey && route.viewKey !== app.view) {
      if (!openableViews.includes(route.viewKey)) return BLOCKED;
      app.guardCalls++; if (!guardAllows()) return CANCELLED;
      app.view = route.viewKey; app.screen = SCREEN.DASHBOARD; app.renders++;
      return OK;
    }
    // 設定画面から同じタブへ戻る経路。applyView を通らないのでここでガードする。
    if (app.screen !== SCREEN.DASHBOARD) {
      app.guardCalls++; if (!guardAllows()) return CANCELLED;
      app.screen = SCREEN.DASHBOARD; app.renders++;
    }
    return OK;
  };
  const applyCurrentUrl = async () => {         // main.js の applyCurrentUrl
    const target = parsePath(h.current);
    if (!target || sameRoute(target, currentRoute())) { if (!app.pendingPop) normalizeUrl(); return; }
    const myVersion = ++app.routeVersion;
    const result = await applyRoute(target);
    if (myVersion !== app.routeVersion) return;
    const restore = () => { const p = buildPath(currentRoute()); if (p !== h.current) h.pushState(null, '', p); };
    if (result.reason === 'cancelled') { app.pendingPop = false; restore(); return; }
    if (app.pendingPop) return;
    if (result.ok) { normalizeUrl(); return; }
    restore();
  };
  const applyPopState = async () => {           // main.js の applyPopState
    if (app.applyingPop) { app.pendingPop = true; return; }
    app.applyingPop = true;
    try {
      do { app.pendingPop = false; await applyCurrentUrl(); } while (app.pendingPop);
    } finally { app.applyingPop = false; }
  };
  // ユーザー操作による遷移 (Phase 2 相当)
  const goView = async (v) => { app.guardCalls++; if (!guardAllows()) return; app.view = v; app.screen = SCREEN.DASHBOARD; app.renders++; syncUrl(); };
  const goSettings = async (tg) => { app.guardCalls++; if (!guardAllows()) return; app.screen = SCREEN.SETTINGS; app.target = tg; syncUrl(); };
  return { app, h, applyPopState, goView, goSettings, currentRoute };
}

console.log('═══ 基本: 戻る / 進む ═══');
{
  const { app, h, applyPopState, goView } = makeApp();
  await goView('media');
  t('遷移で履歴が 1 つ増える', h.stack.length, 2);
  h.back(); await applyPopState();
  t('戻ると前のタブへ', app.view, 'summary_daily');
  t('戻った後も履歴の長さは変わらない', h.stack.length, 2);
  h.forward(); await applyPopState();
  t('進むと元のタブへ', app.view, 'media');
}

console.log('\n═══ ★無限ループしないか (popstate 中に pushState しない) ═══');
{
  const { h, applyPopState, goView } = makeApp();
  await goView('media');
  const before = h.stack.length;
  h.back(); await applyPopState();
  t('戻る適用で履歴が増えない', h.stack.length, before);
  h.back();  // これ以上戻れない
  await applyPopState();
  t('端で戻っても壊れない', h.stack.length, before);
}

console.log('\n═══ ★戻る連打 ═══');
{
  const { app, h, applyPopState, goView, goSettings } = makeApp();
  await goView('media');
  await goSettings('metrics');
  t('履歴は 3 つ', h.stack.length, 3);
  h.back(); await applyPopState();
  h.back(); await applyPopState();
  t('2 回戻って最初のタブへ', [app.screen, app.view], [SCREEN.DASHBOARD, 'summary_daily']);
  t('履歴の長さは不変', h.stack.length, 3);
}

console.log('\n═══ ★ガードでキャンセルした場合 ═══');
{
  let allow = true;
  const { app, h, applyPopState, goView } = makeApp({ guardAllows: () => allow });
  await goView('media');
  const stackLen = h.stack.length;
  allow = false;                     // ここから未保存ガードが「キャンセル」を返す
  h.back(); await applyPopState();
  t('キャンセルなら画面は変わらない', app.view, 'media');
  t('URL は表示中の画面に一致', parsePath(h.current).viewKey, 'media');
  t('履歴が 1 つ積み直される (戻る余地を残す)', h.stack.length, stackLen);
}

console.log('\n═══ ★開けない画面へ戻った場合 (タブ削除 / 権限剥奪) ═══');
{
  const { app, h, applyPopState, goView } = makeApp({ openableViews: ['summary_daily','media'] });
  await goView('media');
  h.pushState(null, '', `/s/${SID}/v/deleted_tab`);   // 存在しないタブの履歴を差し込む
  h.back(); h.forward();                              // その位置へ移動
  await applyPopState();
  t('開けないタブでは画面が変わらない', app.view, 'media');
  t('URL が表示中の画面へ修正される', parsePath(h.current).viewKey, 'media');
}

console.log('\n═══ ★ソースをまたぐ戻る ═══');
{
  const { app, h, applyPopState } = makeApp();
  h.pushState(null, '', `/s/${SID2}/v/summary_daily`);
  await applyPopState();
  t('別ソースへ切り替わる', app.sid, SID2);
  h.back(); await applyPopState();
  t('戻ると元のソースへ', app.sid, SID);
}
{
  const { app, h, applyPopState } = makeApp({ sources: [SID] });   // SID2 は見えない
  h.pushState(null, '', `/s/${SID2}/v/summary_daily`);
  await applyPopState();
  t('見えないソースへは切り替わらない', app.sid, SID);
  t('URL が現在の画面へ修正される', parsePath(h.current).sid, SID);
}

console.log('\n═══ ★同じ画面への popstate (二重描画しない) ═══');
{
  const { app, h, applyPopState } = makeApp();
  const renders = app.renders;
  h.replaceState(null, '', buildPath({ screen: SCREEN.DASHBOARD, sid: SID, viewKey: 'summary_daily' }));
  await applyPopState();
  t('同じ画面なら再描画しない', app.renders, renders);
}

console.log('\n═══ ★壊れた URL への popstate ═══');
{
  const { app, h, applyPopState } = makeApp();
  h.pushState(null, '', '/s/../../etc/passwd');
  await applyPopState();
  t('画面は変わらない', app.view, 'summary_daily');
  t('URL が正規化される', parsePath(h.current) !== null, true);
}

console.log('\n═══ 実装との構造一致 (写し間違い検知) ═══');
const main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
t('popstate を購読している', /addEventListener\('popstate'/.test(main), true);
t('適用中フラグ _applyingPop がある', /_applyingPop/.test(main), true);
t('syncUrl は適用中なら何もしない', /export function syncUrl\(\)\s*\{\s*\n\s*if \(_applyingPop\) return;/.test(main), true);
t('再入を弾く (適用中の popstate は無視)', /if \(_applyingPop\) return;[\s\S]*?const target = parsePath/.test(main), true);
t('routeVersion で追い越しを捨てる', /myVersion !== _routeVersion/.test(main), true);
t('キャンセル時は pushState で積み直す', /if \(!ok\) \{[\s\S]*?history\.pushState/.test(main), true);
t('applyRoute は既存入口だけを使う',
  /applyRoute[\s\S]*?switchSource\([\s\S]*?enterSourceView\([\s\S]*?enterSettingsMode\([\s\S]*?applyView\(/.test(main), true);
t('ソースは S.DATA_SOURCES で存在確認 (権限を再実装しない)',
  /S\.DATA_SOURCES\.some\(\(?s(: \w+)?\)? => s\.id === route\.sid\)/.test(main), true);

console.log('\n═══ ★戻る連打 (完了を待たずに同時実行) ═══');
{
  // 履歴: タブA → タブB → 設定。戻るを素早く 2 回押す。
  const { app, h, applyPopState, goView, goSettings } = makeApp({ applyDelayMs: 20 });
  await goView('media');
  await goSettings('metrics');
  const stackLen = h.stack.length;

  h.back(); const first = applyPopState();
  h.back(); const second = applyPopState();
  await Promise.all([first, second]);

  // 2 回目の back で履歴位置は既に tabA 相当まで動いている。適用ループが
  // 最新の URL を見るので、1 回目の適用結果 (media) で止まらない。
  t('★最後に要求された画面 (2 つ戻った先) が表示される', app.view, 'summary_daily');
  t('★URL と表示画面が一致する', parsePath(h.current).viewKey, app.view);
  t('履歴が不必要に増えない', h.stack.length, stackLen);
  t('_applyingPop が確実に解除される', app.applyingPop, false);
  t('pendingPop も残らない', app.pendingPop, false);
}

console.log('\n═══ ★戻る 3 連打 ═══');
{
  // ブラウザは戻るを押すたびに履歴位置を動かし popstate を発火する。
  // アプリの適用 (非同期) より押下の方が速いので、押下をまとめてから適用が走る形になる。
  const { app, h, applyPopState, goView } = makeApp({ applyDelayMs: 15 });
  await goView('media');
  await goView('lpcr');
  await goView('op_media');
  const stackLen = h.stack.length;
  const ps = [];
  for (let i = 0; i < 3; i++) { h.back(); ps.push(applyPopState()); }
  await Promise.all(ps);
  t('3 つ戻った先が表示される', app.view, 'summary_daily');
  t('URL と一致', parsePath(h.current).viewKey, app.view);
  t('履歴の中身は変わらない', h.stack.length, stackLen);
  t('フラグが解除される', [app.applyingPop, app.pendingPop], [false, false]);
}

console.log('\n═══ ★連打中にガードでキャンセルされた場合 ═══');
{
  let allow = true;
  const { app, h, applyPopState, goView } = makeApp({ applyDelayMs: 15, guardAllows: () => allow });
  await goView('media');
  await goView('lpcr');
  allow = false;                       // ここから全てキャンセルされる
  h.back(); const a = applyPopState();
  h.back(); const b = applyPopState();
  await Promise.all([a, b]);
  t('画面は動かない', app.view, 'lpcr');
  t('★URL と表示画面が一致する', parsePath(h.current).viewKey, app.view);
  t('フラグが解除される', [app.applyingPop, app.pendingPop], [false, false]);
}

console.log('\n═══ ★連打の途中で開けない画面が混ざる ═══');
{
  const { app, h, applyPopState, goView } = makeApp({ applyDelayMs: 15, openableViews: ['summary_daily','media'] });
  await goView('media');
  h.pushState(null, '', `/s/${SID}/v/deleted_tab`);   // 開けないタブ
  h.pushState(null, '', `/s/${SID}/v/summary_daily`);
  h.back(); const a = applyPopState();                // deleted_tab へ (開けない)
  h.back(); const b = applyPopState();                // media へ
  await Promise.all([a, b]);
  t('開ける画面まで戻れる', app.view, 'media');
  t('URL と一致', parsePath(h.current).viewKey, app.view);
}

console.log('\n═══ ★未保存でキャンセル: モーダルが再表示されない ═══');
{
  let allow = true, modalCount = 0;
  const { app, h, applyPopState, goView, goSettings } =
    makeApp({ applyDelayMs: 20, guardAllows: () => { modalCount++; return allow; } });
  await goView('media');
  await goSettings('metrics');
  modalCount = 0; allow = false;          // ここから未保存ガードがキャンセルを返す
  h.pushCount = 0;

  h.back(); const a = applyPopState();
  h.back(); const b = applyPopState();
  await Promise.all([a, b]);

  t('★モーダルは 1 回だけ (連打しても再表示しない)', modalCount, 1);
  t('★画面は元のまま', [app.screen, app.target], [SCREEN.SETTINGS, 'metrics']);
  t('★URL と表示画面が一致', parsePath(h.current).target, app.target);
  // 戻った位置から push するので stack の総数は減る (先の履歴が切り捨てられる)。
  // 見るべきは「補正を何回やったか」。
  t('★履歴補正 (pushState) は 1 回だけ', h.pushCount, 1);
  t('戻る先は残っている (media へ戻れる)', h.stack.length >= 2, true);
  t('_applyingPop が解除される', app.applyingPop, false);
  t('★_pendingPop も破棄される', app.pendingPop, false);
}

console.log('\n═══ ★未保存で「保存せずに移動」を選んだ場合は最新の戻り先へ ═══');
{
  const { app, h, applyPopState, goView, goSettings } = makeApp({ applyDelayMs: 20 });
  await goView('media');
  await goSettings('metrics');
  h.back(); const a = applyPopState();
  h.back(); const b = applyPopState();
  await Promise.all([a, b]);
  t('2 つ戻った先が表示される', [app.screen, app.view], [SCREEN.DASHBOARD, 'summary_daily']);
  t('URL と一致', parsePath(h.current).viewKey, app.view);
}

console.log('\n═══ ★開けないタブ (blocked) は連打を止めない ═══');
{
  // blocked (削除済みタブ) は再試行しても同じなので、pending を破棄せず次へ進む
  const { app, h, applyPopState, goView } = makeApp({ applyDelayMs: 15, openableViews: ['summary_daily','media'] });
  await goView('media');
  h.pushState(null, '', `/s/${SID}/v/deleted_tab`);
  h.pushState(null, '', `/s/${SID}/v/summary_daily`);
  h.back(); const a = applyPopState();      // deleted_tab (blocked)
  h.back(); const b = applyPopState();      // media
  await Promise.all([a, b]);
  t('開ける画面まで進める', app.view, 'media');
  t('URL と一致', parsePath(h.current).viewKey, app.view);
}

console.log('\n═══ 設定画面から戻った時にタブ表示が復元されるか ═══');
// 設定へ入る時に _doEnterSettingsMode がタブの active を全部外すので、
// 閉じるだけだと「どのタブを見ているか分からない」状態になる。
const setIdx = fs.readFileSync(new URL('../src/features/settings/index.ts', import.meta.url), 'utf8');
t('設定へ入る時にタブの active を外している (前提の確認)',
  /nav-item'\)\.forEach\(b => b\.classList\.remove\('active'\)\)/.test(setIdx), true);
// main.js には settings-mode の判定が 2 箇所ある (currentRoute と applyRoute)。
// 対象は applyRoute 側なので、関数の実体を切り出してから探す。
const applyRouteBody = /async function applyRoute\(route[^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(main)?.[1] || '';
const closeBranch = /contains\('settings-mode'\)\) \{([\s\S]*?)\n  \}/.exec(applyRouteBody)?.[1] || '';
t('設定を閉じる分岐で標準タブを復元する', closeBranch.includes('highlightActiveView()'), true);
t('設定を閉じる分岐でカスタムタブを復元する', closeBranch.includes('renderCustomTabs()'), true);
t('設定を閉じる分岐で再描画する', closeBranch.includes("emit('render')"), true);

console.log('\n' + (fail === 0 ? '✅ 全て期待どおり' : `❌ ${fail} 件 失敗`));
process.exit(fail ? 1 : 0);
