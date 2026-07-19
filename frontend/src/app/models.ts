// アプリ全体で使うドメイン型。
//
// ここは**型だけ**を置き、実行時の値は持たない (import しても実行時の依存が増えない)。
// state.ts と auth.ts の双方が使うため、どちらに置いても循環になるので独立させている。
//
// 将来 backend と共有したくなったら packages/shared へ移す。今は frontend 側の
// 「API から返ってくるものをどう扱っているか」の記述に留める
// (backend の Firestore ドキュメント定義そのものではない)。

import type { PermissionKey } from '@pkg/shared/perms.ts';
import type { Preset, DataSource, AggregateColumnsResult } from '@pkg/shared/api-types.ts';

export type { PermissionKey };

/**
 * ユーザーの権限マップ。キーは packages/shared の `PERM_GROUPS` から導出した
 * literal union なので、存在しない権限キーはコンパイル時に落ちる。
 * **キーの一覧をここに書き写してはいけない** (三重定義になり、Phase 2 で潰した問題が戻る)。
 *
 * Partial なのは「未設定 = false」を許すため (backend の VIEWER_PERMS は全キーを
 * false で持つが、Firestore の古いデータは一部キーを持たないことがある)。
 */
export type Perms = Partial<Record<PermissionKey, boolean>>;

/**
 * ログインユーザー / ユーザー管理画面で扱うユーザー。
 * `GET /api/me` と `GET /api/users` が返す形。
 */
export interface AppUser {
  uid: string | null;
  name?: string;
  email?: string;
  photoURL?: string;
  /** admin は perms を見ずに全許可。判定は必ず `isAdmin || perms?.[k]` の順で行う */
  isAdmin?: boolean;
  perms?: Perms;
  /** 所属グループ。データソースの可視性判定に使う (判定の正は backend) */
  groupId?: string | null;
}

// ===== 設定オブジェクトの形 =====
// backend は config doc をそのまま返すだけなので、正規化は frontend の applyConfig が行う。
// ここは「applyConfig を通った後の形」= 描画側が前提にしてよい形を書く。

/** メトリクスの表示書式。fmt() の分岐と 1:1 */
export type MetricFormat = 'int' | 'dec2' | 'yen' | 'pct';

/**
 * base = 単一の集計関数だけ (sum(x) 等)。多重ディメンションの親行で合算されるため、
 * 比率や引き算は derived にすること (metrics.ts の isPureBaseFormula が保存時に検査)。
 */
export type MetricKind = 'base' | 'derived';

export interface MetricDefinition {
  key: string;
  label: string;
  fmt: MetricFormat;
  type: MetricKind;
}

/** ディメンションの種別。dimValue() の分岐と 1:1 */
export type DimensionKind =
  | 'value' | 'date' | 'week' | 'week_md' | 'month' | 'year' | 'dow'
  | 'expression' | 'image' | 'link';

export interface DimensionDefinition {
  key: string;
  label: string;
  /** 参照するデータカラム。未設定なら key と同じ (applyConfig が埋める) */
  field: string;
  type: DimensionKind;
  /** type: 'expression' のときの JS 式 */
  expression?: string;
  /**
   * type: 'image' のサイズ指定 (px)。
   * `null` は「入力欄を空にした = 指定なし」。設定画面が明示的に null を入れるので
   * undefined と別物として扱う (applyConfig は null/undefined どちらも項目ごと落とす)。
   */
  imageHeight?: number | null;
  imageWidth?: number | null;
  /** type: 'week' / 'week_md' の週開始曜日 (0=日 .. 6=土)。既定 1 */
  weekStart?: number;
}

/**
 * タブ 1 つ分の保存済み表示状態 (`S.TAB_STATES` の値、config の tabStates に保存)。
 * loadTabState がここから S.SELECTED_DIMS / CHARTS / CARDS 等へ復元する。
 *
 * 全フィールド optional: 構築サイトごとに埋める部分集合が違う (新規カスタムタブは
 * dims/metrics/thresholds のみ、切替時の保存は charts/cards まで全部)。
 * charts/cards/tableConfig/tableState は「保存された生データ」なので、正規化前の
 * 緩い型 (any) のまま持つ (復元側の map で ChartConfig/CardConfig 等へ整える)。
 */
export interface TabState {
  dims?: string[];
  metrics?: string[];
  thresholds?: Record<string, any>;
  thresholdMetrics?: string[];
  /** 保存時点の tableConfig (normalizeTableConfig を通す前の生データ) */
  tableConfig?: any;
  /** 折り畳み/固定列/倍率など (_getTableState の戻り) */
  tableState?: any;
  charts?: any[];
  cards?: any[];
}

/**
 * ピボットテーブルの表示設定 (`S.TABLE_CONFIG`)。タブごとに持ち、TAB_STATES に永続化。
 *
 * ここはトップレベルのキー typo (`S.TABLE_CONFIG?.tabel`) を落とすのが目的。
 * ネスト (列別設定・スタイル・ソート) は動的キーのマップなので `Record<string, any>` で
 * 緩く保つ。実体は必ず `normalizeTableConfig` を通った形 (初期値も同関数の戻り値)。
 */
export interface TableConfig {
  showTotal?: boolean;
  transpose?: boolean;
  /** 旧: 単一 bool の小計フラグ。subtotalAt() が後方互換で解釈し subtotalDepths へ移行 */
  showSubtotal?: boolean;
  /** 階層深さ -> 小計表示 bool */
  subtotalDepths?: Record<string, any>;
  /** 列/設定ごとの値 (depthPriority / totalPriority / 列別表示 等) */
  table?: Record<string, any>;
  styles?: Record<string, any>;
  headerStyles?: Record<string, any>;
  filters?: Record<string, any>;
  /** ソート設定。{ list: [...] } に正規化 (旧 {col,dir,custom} から移行) */
  sort?: Record<string, any>;
}

/**
 * カスタムタブ 1 つ (`S.CUSTOM_TABS` の要素、config の customTabs に保存)。
 * ここはタブの見出し情報のみ。中身 (charts/cards/tableConfig 等) は
 * `S.TAB_STATES[key]` 側に入る。
 */
export interface CustomTab {
  key: string;
  /** タブ生成時 (main.ts の追加) に必ず設定。表示見出しに `||` なしで使う */
  label: string;
  color?: string;
  /** タブのグループ名。未分類は '' / undefined */
  group?: string;
  /** 紐づく preset 名 */
  presetName?: string;
}

/**
 * タブ (ビュー) 1 つの定義 (`S.VIEWS` の値)。キーはタブ識別子 ('summary_daily' 等)。
 * config には serializeViews が `filter` (コンパイル済み関数) を除いた形で保存する。
 */
export interface ViewDefinition {
  label: string;
  /** このタブで既定表示するディメンション */
  dims: string[];
  /** タブの WHERE 式。未設定は null */
  filterExpr: string | null;
  /** compileFilter(filterExpr) の結果。式が不正・未設定なら null (実行時に生成、保存しない) */
  filter: Function | null;
  /** このタブに紐づく preset 名。既定は label */
  presetName: string;
}

/**
 * フィルタ 1 つの定義 (`S.FILTER_DEFS` の要素、config の filterDefs に保存)。
 * 設定画面で自由に追加/編集できる。値の実体は S.FILTER_VALUES[id] 側に入る。
 */
export interface FilterDefinition {
  /** フィルタ識別子。値 (FILTER_VALUES) / 条件 (FILTER_CONDITIONS) の索引キー。'filter1' 等 */
  id: string;
  /** 'date_range' | 'multi' | それ以外は単純入力扱い */
  type: string;
  /** 参照するデータカラム */
  field: string;
  label: string;
}

/** 複合/折れ線グラフの追加線。旧 metric2/3/4 スキーマから移行される (chart.ts getComboLines) */
export interface ComboLine {
  metric: string;
  color: string;
}

/**
 * ダッシュボードのグラフ 1 枚分の設定 (`S.CHARTS` の要素)。
 *
 * 値の型が広め (`type`/`size`/`bucket` 等が literal union でなく string) なのは意図的:
 * 設定パネルが `chart.type = el.value` のように **string をそのまま代入する**ため。
 * ここの主目的は「どのキーがあるか」を固定して `chart.smothLine` のような
 * キーの打ち間違いをコンパイル時に落とすこと (値の絞り込みは別途)。
 */
export interface ChartConfig {
  id: number;
  /** 'bar' | 'line' | 'area' | 'scatter' | 'pie' | 'stacked' | 'combo' */
  type: string;
  /** 'main' | 'sub' | 'mini' */
  size: string;
  metric: string;
  name?: string;
  /** X 軸ディメンション。'auto' でピボットに追従 */
  bucket?: string;
  color?: string;
  /** type: 'stacked' の内訳ディメンション */
  stackBy?: string;
  showDataLabels?: boolean;
  showDots?: boolean;
  dotSize?: number;
  lineWidth?: number;
  smoothLine?: boolean;
  /** combo / line の追加折れ線 */
  lines?: ComboLine[];
  // --- 旧スキーマ。getComboLines / ensureLines が lines へ移行し次第 delete される ---
  metric2?: string;
  metric3?: string;
  metric4?: string;
  color2?: string;
  color3?: string;
  color4?: string;
}

/**
 * KPI カード 1 枚分の設定 (`S.CARDS` の要素)。
 * `type`/`size` 同様、`filterMode`/`size` は設定パネルが string を直接代入するので string。
 */
export interface CardConfig {
  id: number;
  metric: string;
  label?: string;
  subMetric?: string;
  subLabel?: string;
  /** 'follow' | 'current_month' | 'latest_month' | 'prev_month' */
  filterMode?: string;
  /** 'small' | 'medium' | 'large' | 'full' */
  size?: string;
  bgColor?: string;
  /** 旧: 3 要素 (labelColor/valueColor/subColor) 共通のフォールバック色 */
  textColor?: string;
  labelColor?: string;
  valueColor?: string;
  subColor?: string;
}

/**
 * 共有可変状態 (`app/state.ts` の `S`)。
 *
 * `any` が多いのは意図的。ここは「S にどんなキーがあるか」を固定するのが目的で、
 * 個々の値の形 (プリセット / チャート設定 / tableConfig 等) は各 feature が持っている。
 * これだけでも `S.CURENT_SOURCE` のようなキーの打ち間違いはコンパイル時に落ちる。
 * 形を詰めるのは、その feature を `.ts` にする時に一緒にやる。
 */
export interface AppState {
  DATA_SOURCES: DataSource[];
  CURRENT_SOURCE: string | null;
  SOURCE_DATA: Record<string, any[]>;
  RAW: any[];
  /**
   * 表示中のタブキー。
   * `null` は一時的な状態ではなく**残り得る**: カスタムタブを削除して標準タブも
   * カスタムタブも 0 件になると、フォールバック先が無く null のままになる
   * (main.ts の削除ハンドラ)。state.ts の syncCurrentTabState も
   * `if (!S.CURRENT_VIEW) return` で既に null を前提に書かれている。
   */
  CURRENT_VIEW: string | null;
  SELECTED_DIMS: string[];
  SELECTED_METRICS: string[];
  CHARTS: ChartConfig[];
  CHART_ID_SEQ: number;
  CHART_POINTS: Map<any, any>;
  CHART_SETTINGS_ID: number | null;
  CARDS: CardConfig[];
  CARD_ID_SEQ: number;
  CARD_SETTINGS_ID: number | null;
  THRESHOLDS: Record<string, any>;
  THRESHOLD_METRICS: string[];
  /** compileFilter() が返す関数。式が不正なら null */
  CURRENT_FILTER: Function | null;
  TABLE_CONFIG: TableConfig;
  TAB_STATES: Record<string, TabState>;
  CUSTOM_TABS: CustomTab[];
  PRESET_EDIT_IDX: number | null;
  VIEW_ORDER: string[];
  FILTER_VALUES: Record<string, any>;
  FILTER_CONDITIONS: Record<string, any>;
  COL_WIDTHS: Record<string, any>;
  METRIC_DEFS: MetricDefinition[];
  DIMENSIONS: DimensionDefinition[];
  VIEWS: Record<string, ViewDefinition>;
  FILTER_DEFS: FilterDefinition[];
  METRIC_FORMULAS: Record<string, string>;
  BASE_FORMULAS: Record<string, string>;
  USERS: AppUser[];
  CURRENT_USER: string | null;
  USERS_DRAFT: AppUser[] | null;
  METRICS_DRAFT: any;
  METRICS_DRAFT_BASE: any;
  /** 設定画面の編集中コピー。未編集は null */
  METRIC_DEFS_DRAFT: MetricDefinition[] | null;
  FILTER_DEFS_DRAFT: FilterDefinition[] | null;
  VIEWS_DRAFT: any;
  DIMENSIONS_DRAFT: DimensionDefinition[] | null;
  DIM_EXPR_CACHE: Map<string, any>;
  SHEETS_INPUT: { url: string; tab: string };
  BQ_INPUT: { project: string; query: string };
  SOURCE_METHOD: string;
  PRESETS_CACHE: Preset[];

  // --- ここから下は S の初期リテラルに無く、後から代入で生えるプロパティ ---
  // そのため optional。実際、利用側は S.FILTER_OPTIONS?.[...] や
  // `S.SPARKLINE_SERIES instanceof Map` のように undefined を前提に書かれている。
  // リテラルへ移すと初期値が変わる = 実行時の変更になるので、型付けとは別に整理する。

  /** { [field]: [distinct values] } — フィルタ UI の選択肢 */
  FILTER_OPTIONS?: Record<string, any[]>;
  /** 設定画面プレビュー用。`POST /api/aggregate/columns` の結果そのもの (未取得は null) */
  COLUMN_INFO?: AggregateColumnsResult | null;
  /** sid -> snapshot の updatedAt (ISO8601)。集計の cacheKey に入る */
  SOURCE_SNAPSHOT_UPDATED_AT?: Record<string, string>;
  /** Map<pathKey, [{ x, agg }]> — sparkline 用の階層別時系列 */
  SPARKLINE_SERIES?: Map<string, any[]>;
}
