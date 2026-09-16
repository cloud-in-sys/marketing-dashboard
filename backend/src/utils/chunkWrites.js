// @ts-check
// Firestore の 1 コミット上限を超えないよう、書き込みをチャンクに分ける純粋ヘルパ。
//
// なぜ「件数」だけでなく「バイト数」でも分けるか:
//   1 コミットの上限はオペレーション数(500)とサイズ(10 MiB)の両方。育ったプリセット
//   (~1MB) を数件まとめると、件数は少なくてもサイズ上限に当たり
//   「Transaction too big. Decrease transaction size.」で失敗する。
//   Firestore はネストしたフィールドをインデックスするので実効サイズは生バイトより
//   膨らむため、maxBytes は上限より十分小さく取ること。
//
// 単一の書き込みが maxBytes を超えても、それだけのチャンクにする (それ以上分割不能)。
// 元々 Firestore から読めたドキュメントは 1 MiB 以下なので単独コミットは安全。
//
// import を持たないこと (node のテストが直接読めるように)。

/**
 * @template T
 * @param {T[]} items
 * @param {(item: T) => number} sizeOf 各 item の概算バイト数
 * @param {number} maxBytes 1 チャンクの合計バイト上限
 * @param {number} maxOps 1 チャンクの件数上限
 * @returns {T[][]}
 */
export function chunkBySize(items, sizeOf, maxBytes, maxOps) {
  /** @type {T[][]} */
  const chunks = [];
  /** @type {T[]} */
  let cur = [];
  let bytes = 0;
  for (const item of items) {
    const sz = sizeOf(item) || 0;
    // 現チャンクに何か入っていて、追加すると件数 or サイズ上限を超えるなら先に区切る。
    if (cur.length > 0 && (cur.length >= maxOps || bytes + sz > maxBytes)) {
      chunks.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(item);
    bytes += sz;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}
