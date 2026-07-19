import { API_BASE } from '@app/config.ts';
import { getIdToken, getAppCheckHeader } from '@app/firebaseClient.js';
import type {
  AggregateResult, AggregateBatchResult, AggregateOptionsResult, AggregateColumnsResult,
  AggregateInput, AggregateBatchRequest,
  ListSourcesResult, DataSource, SnapshotMetaResult, SnapshotResult, RefreshSnapshotResult,
  ListPresetsResult, Preset, CreatePresetRequest, ReplacePresetRequest, GetConfigResult,
  MeResult, MyStateResult, ListUsersResult, UserProfile,
  ListGroupsResult, ListGroupMembersResult, Group,
  GoogleStatusResult, GoogleAuthUrlResult, OkResult,
} from '@pkg/shared/api-types.ts';

export interface RequestOptions {
  /** 渡すと fetch をキャンセルできる */
  signal?: AbortSignal;
  /** pagehide / beforeunload 中でもリクエストを継続する (size <= 64KB) */
  keepalive?: boolean;
}

/**
 * request() が throw する Error。素の Error に情報を足して投げている。
 * 呼び出し側 (buildSaveErrorMessage 等) が status / field / detail を直接見る。
 */
export interface ApiError extends Error {
  /** abort された場合のみ 'aborted' */
  code?: string;
  status?: number;
  field?: string;
  detail?: any;
  body?: any;
}


// signal: AbortSignal を渡すと fetch をキャンセル可能。
// abort された場合は `Error: aborted` を投げる (err.code === 'aborted')。
// keepalive: true で pagehide / beforeunload 中でもリクエストを継続できる (size <= 64KB)。
// 戻り値は呼び出し側が TResponse で指定する。既定は any なので、まだ型を付けていない
// エンドポイントは従来どおり動く (段階的に絞り込んでいく)。
async function request<TResponse = any, TRequest = unknown>(method: string, path: string, body?: TRequest, opts: RequestOptions = {}): Promise<TResponse> {
  const [token, appCheckToken] = await Promise.all([getIdToken(), getAppCheckHeader()]);
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(appCheckToken ? { 'X-Firebase-AppCheck': appCheckToken } : {}),
      },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: opts.signal,
      keepalive: !!opts.keepalive,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      const err: ApiError = new Error('aborted'); err.code = 'aborted'; throw err;
    }
    throw e;
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    let payload: any = null;
    try {
      payload = await res.json();
      // backend が構造化エラー ({error, field, detail, message}) を返す場合は
      // message を優先 (旧 message 文字列との後方互換)、なければ error を使う。
      if (payload?.message) msg = payload.message;
      else if (payload?.error) msg = payload.error;
    } catch (e) {}
    const err: ApiError = new Error(msg);
    err.status = res.status;
    if (payload) {
      // 構造化エラーの生プロパティを attach。呼び出し側 (buildSaveErrorMessage 等) が field/detail
      // を直接参照できる。存在しない場合は undefined。
      err.field = payload.field;
      err.detail = payload.detail;
      err.body = payload;
    }
    throw err;
  }
  // 204 (No Content) と非 JSON レスポンスは TResponse を経由しない。
  // これらを返すエンドポイント (DELETE 等) に非 null な TResponse を指定しないこと。
  if (res.status === 204) return null as TResponse;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text() as TResponse;
}

export const api = {
  // Me
  me:            () => request<MeResult>('GET', '/api/me'),
  getMyState:    (sid: string) => request<MyStateResult>('GET', `/api/me/state/${sid}`),
  putMyState:    (sid: string, state: { tabFilters?: Record<string, any>; currentView?: string | null }, opts?: RequestOptions) => request<OkResult>('PUT', `/api/me/state/${sid}`, { state }, opts),

  // Users
  // listUsers は adminOnly (perms 込みの全ユーザー)。グループ画面からは使わず
  // listGroupMembers (manageGroups でも取得可 / perms なし) を使うこと。
  listUsers:     () => request<ListUsersResult>('GET', '/api/users'),
  createUser:    (data: { email: string; name: string; isAdmin?: boolean }) => request<UserProfile>('POST', '/api/users', data),
  updateUser:    (uid: string, patch: Partial<UserProfile>) => request<OkResult>('PUT', `/api/users/${uid}`, patch),
  deleteUser:    (uid: string) => request<OkResult>('DELETE', `/api/users/${uid}`),

  // Branding
  // branding は doc の中身をそのまま返す (項目は運用で増える) ので any のまま
  getBranding:   () => request('GET', '/api/branding'),
  putBranding:   (patch: any) => request('PUT', '/api/branding', patch),

  // Groups
  listGroups:    () => request<ListGroupsResult>('GET', '/api/groups'),
  // グループ画面のメンバー一覧 (uid/name/email/groupId/isAdmin のみ。perms は返らない)
  listGroupMembers: () => request<ListGroupMembersResult>('GET', '/api/groups/members'),
  createGroup:   (data: Partial<Group>) => request<Group>('POST', '/api/groups', data),
  updateGroup:   (gid: string, patch: Partial<Group>) => request<OkResult>('PUT', `/api/groups/${gid}`, patch),
  deleteGroup:   (gid: string) => request<OkResult>('DELETE', `/api/groups/${gid}`),

  // Sources
  listSources:   () => request<ListSourcesResult>('GET', '/api/sources'),
  reorderSources:(ids: string[]) => request<OkResult>('PUT', '/api/sources/reorder', { ids }),
  createSource:  (data: { name: string; copyFromId?: string }) => request<DataSource>('POST', '/api/sources', data),
  updateSource:  (id: string, patch: Partial<DataSource>) => request<OkResult>('PUT', `/api/sources/${id}`, patch),
  deleteSource:  (id: string) => request<OkResult>('DELETE', `/api/sources/${id}`),
  disconnectSource: (id: string) => request<OkResult>('POST', `/api/sources/${id}/disconnect`),

  // Config
  getConfig:     (sid: string) => request<GetConfigResult>('GET', `/api/config/${sid}`),
  putConfig:     (sid: string, config: Record<string, unknown>) => request<OkResult>('PUT', `/api/config/${sid}`, config),
  patchConfig:   (sid: string, patch: Record<string, unknown>, opts?: RequestOptions) => request<OkResult>('PATCH', `/api/config/${sid}`, patch, opts),
  // 検証のみ (副作用なし)。frontend の live validation で使う。
  // 成功時: { ok: true } / 失敗時: 400 + { ok: false, error, field, detail } を throw。
  // AbortSignal サポート済み。
  validateConfig: (sid: string, body: Record<string, unknown>, opts?: RequestOptions) => request('POST', `/api/config/${sid}/validate`, body, opts),

  // Presets
  listPresets:   (sid: string) => request<ListPresetsResult>('GET', `/api/presets/${sid}`),
  // 作成は CreatePresetRequest (name 必須・他は任意)。
  // 更新は ReplacePresetRequest (全フィールド必須) — PUT は全置換なので部分データを
  // 型で弾く。呼び出し側は toReplacePresetRequest で Preset から正規化して渡すこと。
  createPreset:  (sid: string, preset: CreatePresetRequest, opts?: RequestOptions) => request<Preset>('POST', `/api/presets/${sid}`, preset, opts),
  updatePreset:  (sid: string, pid: string, preset: ReplacePresetRequest, opts?: RequestOptions) => request<OkResult>('PUT', `/api/presets/${sid}/${encodeURIComponent(pid)}`, preset, opts),
  deletePreset:  (sid: string, pid: string, opts?: RequestOptions) => request<OkResult>('DELETE', `/api/presets/${sid}/${encodeURIComponent(pid)}`, null, opts),
  reorderPresets: (sid: string, order: string[], opts?: RequestOptions) => request<OkResult>('PATCH', `/api/presets/${sid}`, { order }, opts),

  // Google integration
  googleStatus:  () => request<GoogleStatusResult>('GET', '/api/google/status'),
  googleAuthUrl: () => request<GoogleAuthUrlResult>('GET', '/api/google/auth/url'),
  googleDisconnect: () => request<OkResult>('DELETE', '/api/google/connection'),

  // Snapshots (daily batch + on-demand refresh)
  getSnapshot:   (sid: string) => request<SnapshotResult>('GET', `/api/snapshots/${sid}`),
  getSnapshotMeta: (sid: string) => request<SnapshotMetaResult>('GET', `/api/snapshots/${sid}/meta`),
  refreshSnapshot: (sid: string) => request<RefreshSnapshotResult>('POST', `/api/snapshots/${sid}/refresh`),

  // Backend aggregation (offload heavy compute to Cloud Run)
  aggregate:        (body: { sourceId: string } & AggregateInput, opts?: RequestOptions) =>
                      request<AggregateResult>('POST', '/api/aggregate', body, opts),
  aggregateBatch:   (body: { sourceId: string; requests: AggregateBatchRequest[] }, opts?: RequestOptions) =>
                      request<AggregateBatchResult>('POST', '/api/aggregate/batch', body, opts),
  aggregateOptions: (sourceId: string, fields: string[], opts?: RequestOptions) =>
                      request<AggregateOptionsResult>('POST', '/api/aggregate/options', { sourceId, fields }, opts),
  aggregateColumns: (sourceId: string, opts?: RequestOptions) =>
                      request<AggregateColumnsResult>('POST', '/api/aggregate/columns', { sourceId }, opts),
};
