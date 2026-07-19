// source 切替時に、前 source 用の補助 API (snapshot meta / columns fetch 等) を
// 一括 cancel するための AbortController。aggregate は別レイヤーで cancel される。
//
// この状態を独立モジュールに置く理由:
//   sources.ts は settings/settings.ts を import し、そこから settings/index.ts へ
//   繋がる循環がある。settings/index.ts が sources.ts を静的 import すると循環初期化に
//   なり得るため、以前は settings 側が dynamic import で回避していた。しかし sources.ts は
//   main.ts が静的 import 済みなので、その dynamic import はチャンク分割の実効が無く
//   (Vite の INEFFECTIVE_DYNAMIC_IMPORT 警告)、遅延させる意味しか無かった。
//   必要なのは getCurrentSourceSignal() だけなので、それを**依存の無い**この小モジュールへ
//   切り出し、sources.ts と settings/index.ts の双方が静的 import できるようにした。

let currentSourceController: AbortController | null = null;

/** 現在の source 補助 API 用 AbortSignal。まだ source 切替をしていなければ undefined */
export function getCurrentSourceSignal(): AbortSignal | undefined {
  return currentSourceController?.signal;
}

/** 前 source の controller を abort し、新しい controller を作ってその signal を返す */
export function startNewSourceSignal(): AbortSignal {
  if (currentSourceController) currentSourceController.abort();
  const controller = new AbortController();
  currentSourceController = controller;
  return controller.signal;
}
