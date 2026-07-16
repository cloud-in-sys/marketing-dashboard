// ===== データソース可視性の唯一の判定基準 =====
// かつて middleware/auth.js の canAccessSource と aggregate/sourceAccess.js の
// requireSourceAccess、routes/sources.js の一覧フィルタに 3 つの実装が並んでいて、
// 「未分類ユーザー × 公開ソース」だけ結果が食い違っていた (middleware だけ許可)。
// 画面には 0 件なのに ID を知っていれば config / preset / 更新系の API が通る、という
// ズレの原因になるため、ルールはここ 1 箇所に集約する。
//
// ルール:
//   admin                                                      → 全部 OK
//   非 admin かつ groupId なし (未分類)                        → 全部拒否
//   非 admin かつ allowedGroupIds 空 かつ isPublic !== false   → OK (公開)
//   非 admin かつ allowedGroupIds 空 かつ isPublic === false   → 拒否 (非公開)
//   非 admin かつ allowedGroupIds に自分の groupId を含む      → OK
//   それ以外                                                   → 拒否
//
// Firestore に依存しない純粋関数 (source は取得済みの doc data を渡す)。
export function sourceVisible(user, source) {
  if (!user || !source) return false;
  if (user.isAdmin) return true;
  // 未分類ユーザーは admin が group を設定するまでどのソースにもアクセスできない
  if (!user.groupId) return false;
  const allowed = Array.isArray(source.allowedGroupIds) ? source.allowedGroupIds : [];
  if (allowed.length === 0) return source.isPublic !== false;
  return allowed.includes(user.groupId);
}
