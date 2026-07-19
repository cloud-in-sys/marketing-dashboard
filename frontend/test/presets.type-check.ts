// プリセット保存 API の「型の否定テスト」(typecheck 専用。run.mjs は *.test.mjs だけを
// 実行するので、この .ts は tsc に検査されるだけで実行はされない)。
//
// updatePreset に部分データを渡せないことを、下記の expect-error ディレクティブで保証する。
// 型の穴が開いて対象行がエラーでなくなると、tsc が「未使用ディレクティブ」(TS2578) として
// 失敗する = 退行に気づける。完全な ReplacePresetRequest なら通ることも併せて確認する。
import { api } from '@api/index.ts';
import { toReplacePresetRequest } from '@features/presets/presetWrite.ts';
import type { Preset } from '@pkg/shared/api-types.ts';

export function __presetWriteTypeChecks(sid: string, pid: string, full: Preset): void {
  // ----- 更新 (PUT は全置換なので部分データ不可) -----
  // @ts-expect-error 部分データ (name + color だけ) は全置換 API へ渡せない
  api.updatePreset(sid, pid, { name: '売上', color: '#ff0000' });
  // @ts-expect-error name だけの部分データも不可 (charts 等が消えるため)
  api.updatePreset(sid, pid, { name: '売上' });
  // @ts-expect-error 空オブジェクトも不可
  api.updatePreset(sid, pid, {});
  // 完全な ReplacePresetRequest (toReplacePresetRequest の戻り) なら OK (エラーが出ないこと)
  api.updatePreset(sid, pid, toReplacePresetRequest(full));

  // ----- 作成 (name 必須・他は任意) -----
  api.createPreset(sid, { name: '売上' });
  // @ts-expect-error 作成でも name は必須
  api.createPreset(sid, { color: '#fff' });
}
