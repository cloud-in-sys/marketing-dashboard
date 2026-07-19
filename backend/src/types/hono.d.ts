// Hono の Context 変数の型宣言 (module augmentation)。
// auth ミドルウェアが `c.set('user', ...)` / `c.set('uid', ...)` で入れる値を型付けし、
// 各 route の `c.get('user')` / `c.get('uid')` が unknown にならないようにする。
//
// 型だけのファイル (.d.ts)。実行時には存在せず、Dockerfile の COPY にも影響しない。
// user の形は packages/shared の UserProfile (= GET /api/me が返す形) を再利用する。
import type { UserProfile } from '@pkg/shared/api-types.ts';
import 'hono';

declare module 'hono' {
  interface ContextVariableMap {
    /** auth ミドルウェア通過後は必ずセットされている (認証必須ルートのみ) */
    user: UserProfile;
    uid: string;
  }
}
