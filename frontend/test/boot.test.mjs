// 起動時の「URL → 開くソース/タブ」決定ロジックの検証。
// state.js は firebase/api に依存するので、実装と同じ判定式をここに写して検査する
// (写し間違いを防ぐため、末尾で実ファイルとの構造一致も確認する)。
import { parsePath } from '../src/app/routes.ts';
import fs from 'fs';

let fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`NG★ ${name}\n     got =${JSON.stringify(got)} want=${JSON.stringify(want)}`); }
  else console.log(`OK  ${name}`);
};

const SID_A = '4T9FcHaO6V0n5KZItFHa';   // 見えるソース
const SID_B = 'LfmVkBDNMS7GecUJ9lqa';   // 見えるソース
const SID_X = 'HiddenSourceId000001';   // 見えない (一覧に無い)

// state.js の initStateFromServer と同じ決定順:
//   URL → localStorage → 先頭
function resolveSid(pathname, sources, lastSource) {
  const routed = parsePath(pathname);
  let initial = null;
  if (routed && sources.some(s => s.id === routed.sid)) initial = routed.sid;
  if (!initial && lastSource && sources.some(s => s.id === lastSource)) initial = lastSource;
  if (!initial) initial = sources[0]?.id || null;
  return initial;
}
// URL のタブを採用するか (isOpenableView 相当)
function resolveView(pathname, sid, openableViews, defaultView) {
  const routed = parsePath(pathname);
  if (routed && routed.sid === sid && routed.viewKey && openableViews.includes(routed.viewKey)) {
    return routed.viewKey;
  }
  return defaultView;
}

const SOURCES = [{id: SID_A}, {id: SID_B}];
const VIEWS = ['summary_daily', 'media', 'custom_1752000000000'];

console.log('═══ ソースの決定 (URL 優先 → localStorage → 先頭) ═══');
t('URL のソースを最優先',            resolveSid(`/s/${SID_B}/v/media`, SOURCES, SID_A), SID_B);
t('URL 無し → localStorage',        resolveSid('/', SOURCES, SID_B), SID_B);
t('URL も localStorage も無し → 先頭', resolveSid('/', SOURCES, null), SID_A);
t('★見えないソースの URL → localStorage へ', resolveSid(`/s/${SID_X}/v/media`, SOURCES, SID_B), SID_B);
t('★見えないソース + localStorage 無し → 先頭', resolveSid(`/s/${SID_X}`, SOURCES, null), SID_A);
t('壊れた URL → 先頭',              resolveSid('/s/../../etc', SOURCES, null), SID_A);
t('localStorage が無効ソース → 先頭', resolveSid('/', SOURCES, 'gone'), SID_A);
t('ソース 0 件 → null',             resolveSid(`/s/${SID_A}`, [], null), null);

console.log('\n═══ タブの決定 (URL のタブが開けるときだけ採用) ═══');
t('URL のタブを採用',                resolveView(`/s/${SID_A}/v/media`, SID_A, VIEWS, 'summary_daily'), 'media');
t('カスタムタブも採用',              resolveView(`/s/${SID_A}/v/custom_1752000000000`, SID_A, VIEWS, 'summary_daily'), 'custom_1752000000000');
t('★存在しないタブ → 既定へ',        resolveView(`/s/${SID_A}/v/deleted_tab`, SID_A, VIEWS, 'summary_daily'), 'summary_daily');
t('★viewCustom 無し (開けない) → 既定へ',
  resolveView(`/s/${SID_A}/v/custom_1752000000000`, SID_A, ['summary_daily','media'], 'summary_daily'), 'summary_daily');
t('★別ソースの URL のタブは無視',    resolveView(`/s/${SID_B}/v/media`, SID_A, VIEWS, 'summary_daily'), 'summary_daily');
t('タブ未指定 (/s/:sid) → 既定',     resolveView(`/s/${SID_A}`, SID_A, VIEWS, 'summary_daily'), 'summary_daily');
t('URL 無し → 既定',                 resolveView('/', SID_A, VIEWS, 'summary_daily'), 'summary_daily');

console.log('\n═══ 実装との構造一致 (写し間違い検知) ═══');
const stateSrc = fs.readFileSync(new URL('../src/app/state.ts', import.meta.url), 'utf8');
// 引数の型注釈 `(s: any) =>` を許容する。TS 化で付いたもので意味は変わらないため。
// 「routed.sid を sources 一覧と突き合わせている」という判定力は保っている。
t('URL を最優先で見ている',  /routed && sources\.some\(\(?s(: \w+)?\)? => s\.id === routed\.sid\)/.test(stateSrc), true);
t('localStorage は次点',     stateSrc.indexOf('routed && sources.some') < stateSrc.indexOf("localStorage.getItem('dashboard.lastSource')"), true);
t('タブは isOpenableView で判定', /routed\.viewKey && isOpenableView\(routed\.viewKey\)/.test(stateSrc), true);
t('タブ採用は sid 一致が条件', /routed\.sid === initial/.test(stateSrc), true);

const mainSrc = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
// Phase 2 で遷移時の pushState が入った。両方あるのは正しいが、役割が逆転していないことを見る:
//   normalizeUrl (起動時の正規化 / フォールバック) → replaceState でなければならない
//   syncUrl      (遷移時の履歴追加)                → pushState
t('normalizeUrl は replaceState を使う (フォールバックで履歴を汚さない)',
  /function normalizeUrl\(\)[\s\S]*?history\.replaceState[\s\S]*?\n\}/.test(mainSrc), true);
t('normalizeUrl が pushState を使っていない (無限ループ防止)',
  /function normalizeUrl\(\)([\s\S]*?)\n\}/.exec(mainSrc)[1].includes('pushState'), false);
t('syncUrl は pushState を使う (遷移で履歴を積む)',
  /export function syncUrl\(\)[\s\S]*?history\.pushState[\s\S]*?\n\}/.test(mainSrc), true);
t('syncUrl は同じ URL なら何もしない (連打で履歴が膨らまない)',
  /export function syncUrl\(\)([\s\S]*?)\n\}/.exec(mainSrc)[1].includes('if (path === window.location.pathname) return;'), true);
t('sid 不一致なら画面指定を無視', /sidMatched/.test(mainSrc), true);

console.log('\n═══ Phase 2: 遷移で URL が同期されるか (書き漏らし検知) ═══');
const tabsSrc  = fs.readFileSync(new URL('../src/features/presets/tabs.ts', import.meta.url), 'utf8');
const setSrc   = fs.readFileSync(new URL('../src/features/settings/index.ts', import.meta.url), 'utf8');
const srcSrc   = fs.readFileSync(new URL('../src/features/sources/sources.ts', import.meta.url), 'utf8');

// 画面を変える 4 経路すべてで _syncUrl が呼ばれること
const fnBody = (src, header) => {
  const i = src.indexOf(header);
  if (i < 0) return '';
  return src.slice(i, src.indexOf('\n}', i) + 2);
};
t('applyView (タブ切替) が同期する',
  fnBody(tabsSrc, 'export async function applyView').includes('_syncUrl()'), true);
t('enterSettingsMode (設定へ) が同期する',
  fnBody(setSrc, 'export async function enterSettingsMode').includes('_syncUrl()'), true);
t('enterSourceView (ソース画面へ) が同期する',
  fnBody(srcSrc, 'export async function enterSourceView').includes('_syncUrl()'), true);
t('reloadFullUI (ソース切替後) が同期する',
  fnBody(srcSrc, 'export async function reloadFullUI').includes('_syncUrl()'), true);

// ガードでキャンセルされたら同期しない = 画面が変わらないので URL も動かない構造
t('applyView: ガードは _syncUrl より前 (キャンセル時は到達しない)',
  (b => b.indexOf('_unsavedGuard()') < b.indexOf('_syncUrl()'))(fnBody(tabsSrc, 'export async function applyView')), true);
t('enterSettingsMode: ガードが先',
  (b => b.indexOf('confirmDiscardUnsavedChanges()') < b.indexOf('_syncUrl()'))(fnBody(setSrc, 'export async function enterSettingsMode')), true);
t('enterSourceView: ガードが先',
  (b => b.indexOf('confirmDiscardUnsavedChanges()') < b.indexOf('_syncUrl()'))(fnBody(srcSrc, 'export async function enterSourceView')), true);

// 各モジュールは注入で受け取る (直接 import すると main.js と循環する)
for (const [name, src] of [['tabs.js', tabsSrc], ['settings/index.js', setSrc], ['sources.js', srcSrc]]) {
  t(`${name} は setSyncUrl で注入を受ける`, /export function setSyncUrl/.test(src), true);
  t(`${name} は main を import していない`, /from '.*\/main\.(js|ts)'/.test(src), false);
}

// exitSettingsMode 単体では同期しない (applyView / reloadFullUI 経由で必ず同期されるため、
// ここで呼ぶと二重 push になる)
t('exitSettingsMode 単体では同期しない (二重 push 防止)',
  fnBody(setSrc, 'export function exitSettingsMode').includes('_syncUrl()'), false);

console.log('\n' + (fail === 0 ? '✅ Phase 2 も全て期待どおり' : `❌ ${fail} 件 失敗`));
process.exit(fail ? 1 : 0);
