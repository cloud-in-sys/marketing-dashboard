// プリセット保存 API の型・検証・正規化・楽観更新の検査。
// backend の name/完全性検証と PUT 全置換の挙動、frontend の正規化 (toReplacePresetRequest)
// と楽観更新/rollback をテストし、末尾で実ソースとの構造一致を確認する (写し間違い防止)。
import fs from 'fs';
import { toReplacePresetRequest } from '../src/features/presets/presetWrite.ts';
import { validateReplacePreset } from '../../backend/src/utils/presetValidation.js';

let fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`NG★ ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); }
  else console.log(`OK  ${name}`);
};

// ===== A. name 必須検証 (backend POST/PUT と同じロジック) =====
function validatePresetName(data) {
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) return { status: 400 };
  return { name };
}
console.log('═══ A. name 必須検証 ═══');
t('名前ありは通る (trim 済み)', validatePresetName({ name: '  売上  ' }), { name: '売上' });
t('空名は 400', validatePresetName({ name: '' }).status, 400);
t('空白のみの名は 400', validatePresetName({ name: '   ' }).status, 400);
t('name 欠落は 400', validatePresetName({ charts: [1] }).status, 400);
t('name が文字列でない (数値) は 400', validatePresetName({ name: 123 }).status, 400);

// ===== B. toReplacePresetRequest 正規化 (frontend の実関数) =====
console.log('\n═══ B. toReplacePresetRequest 正規化 ═══');
{
  // 部分的な (旧/空) プリセットでも、未設定項目が空で埋まって完全になる
  const out = toReplacePresetRequest({ id: 'p1', name: '  売上  ', charts: [9], order: 3 });
  t('★id は除外される', 'id' in out, false);
  t('name は trim される', out.name, '売上');
  t('★未設定の配列は [] に埋まる (cards/dims/metrics/thresholdMetrics)',
    [out.cards, out.dims, out.metrics, out.thresholdMetrics], [[], [], [], []]);
  t('★未設定の map は {} に埋まる (thresholds/filterValues/filterConditions)',
    [out.thresholds, out.filterValues, out.filterConditions], [{}, {}, {}]);
  t('★未設定の nullable は null に埋まる (color/tableState/tableConfig/seedVersion)',
    [out.color, out.tableState, out.tableConfig, out.seedVersion], [null, null, null, null]);
  t('builtin 未設定は false', out.builtin, false);
  t('order は既存値を維持', out.order, 3);
  t('設定済みの配列はそのまま', out.charts, [9]);
}
{
  const src = { id: 'p1', name: 'x', charts: [1], cards: [2] };
  const snap = JSON.stringify(src);
  toReplacePresetRequest(src);
  t('★元のプリセットを破壊しない', JSON.stringify(src), snap);
}
{
  let threw = false;
  try { toReplacePresetRequest({ id: 'p', name: '   ' }); } catch { threw = true; }
  t('空名は throw する', threw, true);
}
{
  // 完全なプリセットはそのまま完全な形で通る
  const full = { id: 'p', name: 'A', builtin: true, color: '#fff', order: 2, seedVersion: 3,
    charts: [1], cards: [2], dims: ['d'], metrics: ['m'], thresholds: { a: 1 },
    thresholdMetrics: ['t'], tableState: { x: 1 }, tableConfig: { y: 2 },
    filterValues: { f: 1 }, filterConditions: { c: 1 } };
  const out = toReplacePresetRequest(full);
  const { id, ...rest } = full;
  t('完全なプリセットは (id を除き) そのまま', out, rest);
}

// ===== C. 楽観更新 + rollback + source ガード (state.ts updatePresetOp 相当) =====
// 実関数と同じく body = toReplacePresetRequest(preset)、optimistic は入力 preset を使う。
function makeApp() {
  const S = { CURRENT_SOURCE: 'A', PRESETS_CACHE: [{ id: 'p1', name: '元', charts: [1], cards: [2], dims: ['d'], metrics: ['m'] }] };
  async function updatePresetOp(pid, preset, apiFn) {
    const sid = S.CURRENT_SOURCE;
    const body = toReplacePresetRequest(preset);
    let rollback = null;
    if (S.CURRENT_SOURCE === sid) {
      const idx = S.PRESETS_CACHE.findIndex(p => p.id === pid);
      if (idx >= 0) {
        const prev = S.PRESETS_CACHE[idx];
        S.PRESETS_CACHE[idx] = { ...prev, ...preset, id: pid };
        rollback = () => {
          if (S.CURRENT_SOURCE !== sid) return;
          const cur = S.PRESETS_CACHE.findIndex(p => p.id === pid);
          if (cur >= 0) S.PRESETS_CACHE[cur] = prev;
        };
      }
    }
    try { await apiFn(sid, pid, body); }
    catch (e) { if (rollback) rollback(); throw e; }
  }
  return { S, updatePresetOp };
}
console.log('\n═══ C. 楽観更新 / rollback / source ガード ═══');
{
  // 部分入力でも送信 body は完全 (charts/cards/dims/metrics が正規化で埋まる)
  const { updatePresetOp } = makeApp();
  let sent = null;
  await updatePresetOp('p1', { id: 'p1', name: '新', charts: [9] }, async (_s, _p, body) => { sent = body; });
  t('★送信 body に id が含まれない', 'id' in sent, false);
  t('★部分入力でも送信 body は完全 (未設定は空で埋まる)',
    [sent.charts, sent.cards, sent.dims, sent.metrics], [[9], [], [], []]);
}
{
  const { S, updatePresetOp } = makeApp();
  const before = JSON.parse(JSON.stringify(S.PRESETS_CACHE[0]));
  let threw = false;
  try { await updatePresetOp('p1', { id: 'p1', name: '新', charts: [9] }, async () => { throw new Error('save failed'); }); }
  catch { threw = true; }
  t('失敗は throw される', threw, true);
  t('★rollback で元のプリセットが復元 (charts 等保持)', S.PRESETS_CACHE[0], before);
}
{
  const { S, updatePresetOp } = makeApp();
  const p = updatePresetOp('p1', { id: 'p1', name: '新', charts: [9] }, async () => {
    S.CURRENT_SOURCE = 'B';
    S.PRESETS_CACHE = [{ id: 'other', name: 'B側', charts: [7] }];
    throw new Error('fail after switch');
  });
  await p.catch(() => {});
  t('★別 source 切替後は別 source のキャッシュを rollback で汚さない',
    S.PRESETS_CACHE, [{ id: 'other', name: 'B側', charts: [7] }]);
}

// ===== D. backend presets.js の構造一致 =====
console.log('\n═══ D. backend presets.js の構造 ═══');
const be = fs.readFileSync(new URL('../../backend/src/routes/presets.js', import.meta.url), 'utf8');
// POST は name を inline 検証、PUT は validateReplacePreset に委譲 (name 検証も内包・F 参照)。
t('POST に name 必須検証がある (inline)',
  (be.match(/if \(!name\) throw httpError\(400, 'preset name is required'\);/g) || []).length, 1);
t('POST は name を trim してから検査する', /typeof data\.name === 'string' \? data\.name\.trim\(\) : ''/.test(be), true);
const putBody = /app\.put\('\/:sid\/:pid'[\s\S]*?\n\}\);/.exec(be)?.[0] || '';
t('★PUT は validateReplacePreset で検証し、その戻り (v.preset) を tx.set する',
  /const v = validateReplacePreset\(body\);/.test(putBody) &&
  /const data = v\.preset;/.test(putBody) &&
  /tx\.set\(ref, data\)/.test(putBody), true);
t('★PUT の検証は runTransaction より前 (400 時に既存を変更しない)',
  putBody.indexOf('validateReplacePreset(body)') < putBody.indexOf('db.runTransaction'), true);
t('★PUT は body を直接 tx.set しない (許可項目だけの v.preset を保存)',
  /tx\.set\(ref, body\)/.test(putBody), false);
const postBody = /app\.post\('\/:sid'[\s\S]*?\n\}\);/.exec(be)?.[0] || '';
t('POST は validateReplacePreset を使わない (builtin seed は部分的なため name のみ)',
  /validateReplacePreset/.test(postBody), false);

// ===== E. frontend / api-types の型構造 (Create / Replace 分離) =====
console.log('\n═══ E. 型構造 (Create / Replace 分離) ═══');
const apiTypes = fs.readFileSync(new URL('../../packages/shared/src/api-types.ts', import.meta.url), 'utf8');
t('CreatePresetRequest = Omit<Preset,id> & {name} (作成は部分可)',
  /export type CreatePresetRequest = Omit<Preset, 'id'> & \{ name: string \}/.test(apiTypes), true);
t('ReplacePresetRequest が interface で定義されている (全置換用)',
  /export interface ReplacePresetRequest \{/.test(apiTypes), true);
// ReplacePresetRequest は全フィールド必須 (optional の `?:` が無い)
const replBody = /export interface ReplacePresetRequest \{([\s\S]*?)\}/.exec(apiTypes)?.[1] || '';
t('★ReplacePresetRequest は optional 項目を持たない (全必須)', /\?\s*:/.test(replBody), false);
t('PresetWriteRequest は廃止された', /PresetWriteRequest/.test(apiTypes), false);
const apiIdx = fs.readFileSync(new URL('../src/api/index.ts', import.meta.url), 'utf8');
t('createPreset は CreatePresetRequest', /createPreset:\s*\(sid: string, preset: CreatePresetRequest/.test(apiIdx), true);
t('★updatePreset は ReplacePresetRequest (部分更新不可)',
  /updatePreset:\s*\(sid: string, pid: string, preset: ReplacePresetRequest/.test(apiIdx), true);
t('preset 系 API に Partial<Preset> が残っていない', /preset: Partial<Preset>/.test(apiIdx), false);
const stateSrc = fs.readFileSync(new URL('../src/app/state.ts', import.meta.url), 'utf8');
t('createPresetOp は CreatePresetRequest を取る',
  /export async function createPresetOp\(preset: CreatePresetRequest\)/.test(stateSrc), true);
t('★updatePresetOp は Preset を取り toReplacePresetRequest で正規化する',
  /export async function updatePresetOp\(pid: string, preset: Preset\)/.test(stateSrc) &&
  /const body = toReplacePresetRequest\(preset\);/.test(stateSrc), true);
t('preset 系 state op に preset?: any が残っていない', /preset\?: any/.test(stateSrc), false);

// ===== F. backend validateReplacePreset (実行時検証 + 許可項目の詰め直し) =====
console.log('\n═══ F. validateReplacePreset (backend 実行時検証) ═══');
const complete = () => ({
  name: 'X', builtin: false, color: null, order: 0, seedVersion: null,
  charts: [], cards: [], dims: [], metrics: [], thresholds: {},
  thresholdMetrics: [], tableState: null, tableConfig: null,
  filterValues: {}, filterConditions: {},
});
const isErr = (input) => 'error' in validateReplacePreset(input);

// 完全なリクエストは通り、preset が返る
{
  const r = validateReplacePreset(complete());
  t('完全なリクエストは通る (preset を返す)', 'preset' in r, true);
  t('★preset は許可 15 項目ちょうど (未知/ id なし)', Object.keys(r.preset).sort(), Object.keys(complete()).sort());
}
// 各必須項目が欠けると 400
for (const k of Object.keys(complete())) {
  const input = complete(); delete input[k];
  t(`${k} が欠けると error`, isErr(input), true);
}
// 型不正
t('name が空文字は error', isErr({ ...complete(), name: '  ' }), true);
t('name が非文字列は error', isErr({ ...complete(), name: 123 }), true);
t('builtin が非 boolean は error', isErr({ ...complete(), builtin: 'yes' }), true);
t('color が number は error', isErr({ ...complete(), color: 1 }), true);
t('color は null 可', isErr({ ...complete(), color: null }), false);
t('order が NaN は error', isErr({ ...complete(), order: NaN }), true);
t('order が Infinity は error', isErr({ ...complete(), order: Infinity }), true);
t('seedVersion は null 可', isErr({ ...complete(), seedVersion: null }), false);
t('seedVersion が Infinity は error', isErr({ ...complete(), seedVersion: Infinity }), true);
t('★dims に文字列以外があると error', isErr({ ...complete(), dims: ['a', 1] }), true);
t('★metrics に文字列以外があると error', isErr({ ...complete(), metrics: [null] }), true);
t('thresholdMetrics に文字列以外があると error', isErr({ ...complete(), thresholdMetrics: [{}] }), true);
t('★配列をオブジェクト項目 (thresholds) に渡すと error', isErr({ ...complete(), thresholds: [] }), true);
t('filterValues が配列は error', isErr({ ...complete(), filterValues: [] }), true);
t('tableConfig は null 可', isErr({ ...complete(), tableConfig: null }), false);
t('tableConfig が配列は error', isErr({ ...complete(), tableConfig: [] }), true);
t('charts が配列でないと error', isErr({ ...complete(), charts: {} }), true);
t('body が非オブジェクトは error', isErr(null), true);
// 未知フィールド / id は保存対象に含まれない
{
  const r = validateReplacePreset({ ...complete(), id: 'should-drop', extra: 'x' });
  t('★id は保存 preset に含まれない', 'id' in r.preset, false);
  t('★未知フィールドは保存 preset に含まれない', 'extra' in r.preset, false);
}
// name は trim される
t('name は trim される', validateReplacePreset({ ...complete(), name: '  売上  ' }).preset.name, '売上');

// ===== G. 整合: frontend 正規化の出力は必ず backend 検証を通る =====
console.log('\n═══ G. toReplacePresetRequest ⊆ validateReplacePreset ═══');
const fullPreset = { id: 'p', name: 'A', builtin: true, color: '#fff', order: 2, seedVersion: 3,
  charts: [1], cards: [2], dims: ['d'], metrics: ['m'], thresholds: { a: 1 }, thresholdMetrics: ['t'],
  tableState: { x: 1 }, tableConfig: { y: 2 }, filterValues: { f: 1 }, filterConditions: { c: 1 } };
t('★完全プリセットの正規化は backend 検証を通る',
  isErr(toReplacePresetRequest(fullPreset)), false);
t('★部分/旧プリセットの正規化も backend 検証を通る (欠損が空で埋まる)',
  isErr(toReplacePresetRequest({ id: 'p', name: 'A', charts: [9] })), false);

console.log('\n' + (fail === 0 ? '✅ 全て期待どおり' : `❌ ${fail} 件 失敗`));
process.exit(fail ? 1 : 0);
