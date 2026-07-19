// backend が返すレスポンスの形。
//
// **型だけ**を置くファイル。実行時の値を持たないので、backend がこのファイルを
// 読めなくても問題ない (Dockerfile の COPY 対象外でよい)。
// frontend は `@pkg/shared/api-types.ts` から import する。
//
// ここは「API の仕様を新しく決める場所」ではなく、**backend が現に返している形を
// 書き起こす場所**。実装 (backend/src/routes/*.js) と食い違ったら、直すのは
// こちらではなく「どちらが正しいか」を確認してから。
//
// 由来: backend/src/routes/aggregate.js の runAggregation / 各 c.json(...)

/** 集計の 1 グループ。dims を 1 つ以上指定した時だけ返る */
export interface AggregateGroup {
  /** ディメンション値の配列 (input.dims と同じ順序) */
  vals: any[];
  /** メトリクスキー -> 値。input.metrics のキーが必ず全部揃う (欠損は 0) */
  metrics: Record<string, number>;
  rowCount: number;
}

export interface AggregateMeta {
  /** snapshot の更新時刻 (ISO8601)。未生成なら null */
  sourceUpdatedAt: string | null;
  /** config doc の updatedAt。未設定なら '' */
  configUpdatedAt: string;
}

/** POST /api/aggregate のレスポンス、および batch の results 各要素 */
export interface AggregateResult {
  /** dims が空なら [] */
  groups: AggregateGroup[];
  totals: Record<string, number>;
  /** タブの WHERE も含めて全フィルタ適用後の行数 */
  filteredRows: number;
  /** 追従フィルタ (ヘッダ multi-select + 日付) のみ適用後の行数 = UI の「対象行数」 */
  followFilteredRows: number;
  /** group の sourceFilter 適用後 (= そのユーザーが見られる全行) */
  accessibleRows: number;
  meta: AggregateMeta;
}

/** POST /api/aggregate/batch のレスポンス。results のキーは request の id */
export interface AggregateBatchResult {
  results: Record<string, AggregateResult>;
  meta: AggregateMeta;
}

/**
 * options の値。backend (aggregate.js /options) は snapshot の生値を `String()` せず
 * そのまま distinct 収集して返すため、数値・boolean・null も入り得る。
 */
export type AggregateOptionValue = string | number | boolean | null;

/** POST /api/aggregate/options のレスポンス */
export interface AggregateOptionsResult {
  /** field -> distinct 値 (ソート済み・上限あり)。文字列とは限らない */
  options: Record<string, AggregateOptionValue[]>;
  meta: { sourceUpdatedAt: string | null };
}

export interface ColumnInfo {
  name: string;
  /** 先頭のユニークなサンプル値 */
  samples: any[];
  isNumeric: boolean;
}

/** POST /api/aggregate/columns のレスポンス */
export interface AggregateColumnsResult {
  columns: ColumnInfo[];
  accessibleRows: number;
  sourceUpdatedAt: string | null;
}

// ===== リクエスト =====

/** aggregate / batch の 1 リクエスト分。filters の op は backend の allowlist と一致すること */
export interface AggregateFilter {
  field: string;
  op: string;
  value?: any;
  values?: string[];
}

export interface AggregateInput {
  dims: string[];
  metrics: string[];
  filters: AggregateFilter[];
  /** タブの WHERE 式。空文字なら絞り込みなし */
  viewFilterExpr?: string;
}

export interface AggregateBatchRequest extends AggregateInput {
  /** results のキーになる識別子 */
  id: string;
}

// ===== ソース =====
// 由来: backend/src/routes/sources.js の sourceDoc / GET /api/sources

export interface SheetsInput { url: string; tab: string }
export interface BqInput { project: string; query: string }

export interface DataSource {
  id: string;
  name: string;
  /** '' | 'csv' | 'sheets' | 'bq'。未連携は '' */
  method: string;
  /** 空配列 + isPublic!==false なら全員に見える (可視性の正は backend の sourceVisible) */
  allowedGroupIds?: string[];
  isPublic?: boolean;
  /** 一覧の並び順 (GET /api/sources が order → createdAt でソート)。未設定は末尾 */
  order?: number;
  createdAt?: string;
  /** 定期更新で優先的に使う OAuth の持ち主。作成者が削除されると backend が null にする */
  createdBy?: string | null;
  sheetsInput?: SheetsInput;
  bqInput?: BqInput;
}

export interface ListSourcesResult { sources: DataSource[] }

// ===== スナップショット =====
// 由来: backend/src/routes/snapshots.js

/** 「定期更新の優先アカウント」。CSV / 権限なし / レガシーでは null */
export interface SnapshotConnector {
  name: string;
  connected: boolean;
}

export type SnapshotMetaResult =
  | { exists: false; connector: SnapshotConnector | null; updatedAt?: undefined; rows?: undefined }
  | { exists: true; updatedAt: string; rows: number; connector: SnapshotConnector | null };

// GET /api/snapshots/:sid。存在時は本体 { rows } のみで updatedAt はヘッダ
// (X-Snapshot-Updated-At)。未生成時のみ { rows: [], updatedAt: null } を返す。
// frontend は data.rows しか使わない (updatedAt は meta API / ヘッダ経由)。
export interface SnapshotResult { rows: any[]; updatedAt?: string | null }
export interface RefreshSnapshotResult { updatedAt: string; rows: number }

// ===== プリセット =====
// 由来: backend/src/routes/presets.js。中身は frontend 側の編集内容をそのまま持つ。

export interface Preset {
  id: string;
  name: string;
  /** 標準タブに紐づく preset。× で削除できない */
  builtin?: boolean;
  color?: string;
  order?: number;
  seedVersion?: number;
  charts?: any[];
  cards?: any[];
  dims?: string[];
  metrics?: string[];
  thresholds?: Record<string, any>;
  thresholdMetrics?: string[];
  tableState?: any;
  tableConfig?: any;
  filterValues?: Record<string, any>;
  filterConditions?: Record<string, any>;
}

export interface ListPresetsResult { presets: Preset[] }

/**
 * プリセット **作成** (POST) で送信する形。`id` は backend が採番するので送らない。
 * `name` 必須。charts / cards / dims 等は任意 (builtin seed や空プリセットは部分的なため)。
 */
export type CreatePresetRequest = Omit<Preset, 'id'> & { name: string };

/**
 * プリセット **全置換更新** (PUT) で送信する形。
 *
 * `PUT /api/presets/:sid/:pid` は backend が `tx.set` で doc を丸ごと差し替えるため、
 * `Partial` や optional 項目だけの送信を許すと、送っていない項目 (charts / cards / dims 等)
 * が黙って消える。**全フィールドを必須**にして、部分データがコンパイル時に弾かれるようにする。
 * `id` は URL の :pid で指定するので含めない。
 *
 * 中身が無い項目は「未設定」ではなく空 (`[]` / `{}` / `null`) を明示的に送ること
 * (frontend は `toReplacePresetRequest` で Preset から正規化する)。
 * フィールドは `Preset` (id を除く) と 1:1。増やす時は両方に足すこと。
 */
export interface ReplacePresetRequest {
  name: string;
  builtin: boolean;
  color: string | null;
  order: number;
  seedVersion: number | null;
  charts: unknown[];
  cards: unknown[];
  dims: string[];
  metrics: string[];
  thresholds: Record<string, unknown>;
  thresholdMetrics: string[];
  tableState: unknown | null;
  tableConfig: unknown | null;
  filterValues: Record<string, unknown>;
  filterConditions: Record<string, unknown>;
}

// ===== config =====
// 由来: backend/src/routes/config.js。未作成なら config: null。

export interface GetConfigResult { config: any | null }

// ===== ユーザー / グループ =====
// 由来: backend/src/routes/{me,users,groups}.js

export interface UserProfile {
  uid: string;
  name?: string;
  email?: string;
  photoURL?: string;
  isAdmin?: boolean;
  perms?: Record<string, boolean>;
  groupId?: string | null;
  createdAt?: string;
}

export interface MeResult { user: UserProfile }
export interface ListUsersResult { users: UserProfile[] }
export interface MyStateResult { state: Record<string, any> }

export interface Group {
  id: string;
  name: string;
  /** sid -> 行フィルタ。壊れた設定は backend が fail-closed で扱う */
  sourceFilters?: Record<string, any>;
  /** 作成日時 (ISO8601)。POST /api/groups と一覧の doc に含まれる */
  createdAt?: string;
}
export interface ListGroupsResult { groups: Group[] }

/** グループ画面のメンバー一覧。perms は返らない (S.USERS を上書きしないこと) */
export interface GroupMember {
  uid: string;
  name?: string;
  email?: string;
  groupId?: string | null;
  isAdmin?: boolean;
}
export interface ListGroupMembersResult { members: GroupMember[] }

// ===== Google 連携 =====
// 由来: backend/src/routes/google.js

export interface GoogleStatusResult { connected: boolean; scope: string | null }
export interface GoogleAuthUrlResult { url: string }

// ===== 共通 =====

/** 副作用だけのエンドポイント (PUT / PATCH / DELETE 等) */
export interface OkResult { ok: true }
