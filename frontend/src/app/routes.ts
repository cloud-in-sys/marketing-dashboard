// URL ↔ 画面状態 の相互変換。
//
// ここは純粋関数だけを置く (DOM も Firestore も見ない)。router.js が「いつ変換するか」を、
// このファイルが「どう変換するか」を担当する。副作用を持たせないことで、境界条件
// (壊れた URL / 未知の画面 / エスケープ) を単体テストで潰しきれるようにしている。
//
// URL 設計 (docs/ROADMAP.md の決定に対応):
//   /                                  → ルート。既定のソース/タブへ解決する
//   /s/:sid/v/:viewKey                 → ダッシュボード (標準タブ + カスタムタブ共通)
//   /s/:sid/source                     → データソース画面
//   /s/:sid/settings/:target           → 設定 8 サブ画面
//
// 設定はソース横断のもの (users/groups/branding) も含めて :sid を付ける。
// :sid が無いと「どのソースの設定か」を復元できず、リロードで別ソースの設定を
// 開く事故になるため (ROADMAP (c))。
//
// 引数の型が緩い (unknown / Partial) のは意図的。この 3 関数は「壊れた入力が来る前提で
// 弾く」のが役目なので、型で入力を絞ると防御コードが「到達しない」ことになってしまう。

// 設定サブ画面。features/settings/index.js の enterSettingsMode(target) と一致させること。
export const SETTINGS_TARGETS = [
  'users', 'metrics', 'filters', 'dims', 'defaults', 'presets', 'groups', 'branding',
] as const;

export type SettingsTarget = typeof SETTINGS_TARGETS[number];

// 画面種別
export const SCREEN = {
  DASHBOARD: 'dashboard',
  SOURCE: 'source',
  SETTINGS: 'settings',
} as const;

export type ScreenKind = typeof SCREEN[keyof typeof SCREEN];

export interface Route {
  screen: ScreenKind;
  sid: string;
  /** ダッシュボードのみ。/s/:sid だけの URL では null (呼び出し側が既定タブを決める) */
  viewKey?: string | null;
  /** 設定のみ */
  target?: SettingsTarget;
}

// パスセグメントとして安全か。Firestore の自動 ID とカスタムタブキー (custom_...) を
// 通し、パス区切りやクエリ/ハッシュを含むものは弾く。
// URL に出す前にここで弾いておくと、encode 漏れによる壊れた URL を防げる。
function isSafeSegment(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0 && s.length <= 200 && /^[A-Za-z0-9_-]+$/.test(s);
}

function isSettingsTarget(v: unknown): v is SettingsTarget {
  return typeof v === 'string' && (SETTINGS_TARGETS as readonly string[]).includes(v);
}

// ===== 状態 → URL =====
// route: { screen, sid, viewKey?, target? }
// sid が無い (ソース 0 件) 場合は '/' を返す。
export function buildPath(route: Partial<Route> | null | undefined): string {
  if (!route || !isSafeSegment(route.sid)) return '/';
  const base = `/s/${route.sid}`;
  if (route.screen === SCREEN.SOURCE) return `${base}/source`;
  if (route.screen === SCREEN.SETTINGS) {
    return isSettingsTarget(route.target) ? `${base}/settings/${route.target}` : base;
  }
  if (route.screen === SCREEN.DASHBOARD && isSafeSegment(route.viewKey)) {
    return `${base}/v/${route.viewKey}`;
  }
  return base;
}

// ===== URL → 状態 =====
// 解釈できない URL は null を返す (呼び出し側が既定値へフォールバックする)。
// ここでは「形として妥当か」だけを見る。存在確認・権限判定はしない
// (可視性は backend が唯一の基準。router で再実装しない = ROADMAP 不変条件 1)。
export function parsePath(pathname: unknown): Route | null {
  if (typeof pathname !== 'string') return null;
  // 先頭/末尾のスラッシュを落として分解。'//a//b/' のような崩れた入力も許容する。
  const decoded = pathname.split('/').filter(Boolean).map(decodeSegment);
  if (decoded.some(p => p === null)) return null; // decode 不能 (壊れた %エスケープ)
  if (decoded.length === 0) return null;          // '/' → 既定へ
  const parts = decoded as string[];              // 直前の some で null は除外済み

  if (parts[0] !== 's' || !isSafeSegment(parts[1])) return null;
  const sid = parts[1];

  // /s/:sid だけ → ダッシュボードの既定タブへ (viewKey は呼び出し側が決める)
  if (parts.length === 2) return { screen: SCREEN.DASHBOARD, sid, viewKey: null };

  if (parts[2] === 'source' && parts.length === 3) {
    return { screen: SCREEN.SOURCE, sid };
  }
  if (parts[2] === 'v' && parts.length === 4 && isSafeSegment(parts[3])) {
    return { screen: SCREEN.DASHBOARD, sid, viewKey: parts[3] };
  }
  if (parts[2] === 'settings' && parts.length === 4 && isSettingsTarget(parts[3])) {
    return { screen: SCREEN.SETTINGS, sid, target: parts[3] };
  }
  return null;
}

function decodeSegment(s: string): string | null {
  try { return decodeURIComponent(s); }
  catch { return null; }   // '%' 単体などで throw する
}

// 2 つの route が同じ画面を指すか。URL の二重 push を防ぐのに使う。
export function sameRoute(a: Partial<Route> | null | undefined, b: Partial<Route> | null | undefined): boolean {
  if (!a || !b) return a === b;
  return a.screen === b.screen
    && a.sid === b.sid
    && (a.viewKey || null) === (b.viewKey || null)
    && (a.target || null) === (b.target || null);
}
