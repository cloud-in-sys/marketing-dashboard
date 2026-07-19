// @ts-check
// スナップショット rows のメモリキャッシュ (Cloud Run インスタンス単位)。
//
// 2 段構成:
//   1) metadataCache: getMetadata の結果を短い TTL でキャッシュ (毎リクエストで GCS を叩かない)
//   2) rowsCache: gunzip 済み rows 配列を LRU でキャッシュ (etag/updatedAt が一致すれば再ダウンロード不要)
//
// 重要: rowsCache は group filter 適用前の raw rows。
//       レスポンスには raw を含めず、必ず group filter を適用してから集計する。

import { Storage } from '@google-cloud/storage';
import zlib from 'zlib';
import { promisify } from 'util';

const gunzip = promisify(zlib.gunzip);

const storage = new Storage();
// バケット名は環境ごとの値なので env から取る。無ければ GCP_PROJECT_ID から導出。
// どちらも無ければ起動時に落とす。既定のバケット名にフォールバックすると、
// 設定を忘れた環境が別環境のスナップショットを黙って読んでしまう。
const BUCKET = process.env.SNAPSHOT_BUCKET
  || (process.env.GCP_PROJECT_ID ? `${process.env.GCP_PROJECT_ID}-snapshots` : null);
if (!BUCKET) throw new Error('SNAPSHOT_BUCKET or GCP_PROJECT_ID must be set');
const bucket = () => storage.bucket(BUCKET);
const objectName = (sid) => `snapshots/${sid}.json.gz`;

const META_TTL_MS = 60 * 1000;        // 60 秒
const ROWS_CACHE_MAX = 5;             // インスタンス内に保持するソース数の上限

// metadataCache: sid -> { updatedAt, fetchedAt }
const metadataCache = new Map();
// rowsCache: sid -> { updatedAt, rows, lastAccessAt }
const rowsCache = new Map();
// in-flight ロードの dedupe: sid -> Promise<{rows, updatedAt}>
// 同一 sid に複数 (options / columns / aggregate × N) が同時に来ても download/gunzip は 1 回。
const inFlightLoads = new Map();

async function getMetadata(sid) {
  const cached = metadataCache.get(sid);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < META_TTL_MS) {
    return cached;
  }
  const file = bucket().file(objectName(sid));
  const [exists] = await file.exists();
  if (!exists) {
    const entry = { exists: false, updatedAt: null, fetchedAt: now };
    metadataCache.set(sid, entry);
    return entry;
  }
  const [meta] = await file.getMetadata();
  const updatedAt = meta.metadata?.updatedAt || meta.updated || '';
  const entry = { exists: true, updatedAt, fetchedAt: now };
  metadataCache.set(sid, entry);
  return entry;
}

// LRU eviction: lastAccessAt が古い順に削除
function evictIfNeeded() {
  if (rowsCache.size <= ROWS_CACHE_MAX) return;
  const sorted = [...rowsCache.entries()].sort((a, b) => a[1].lastAccessAt - b[1].lastAccessAt);
  const toRemove = sorted.slice(0, rowsCache.size - ROWS_CACHE_MAX);
  for (const [sid] of toRemove) rowsCache.delete(sid);
}

// raw rows をキャッシュから取得 (なければ GCS から取得)。
// 返り値: { rows, updatedAt }  /  存在しないソースなら null
export async function getSnapshotRows(sid) {
  const meta = await getMetadata(sid);
  if (!meta.exists) {
    console.log(JSON.stringify({ severity: 'INFO', kind: 'snapshot-load', sid, status: 'not-exists' }));
    return null;
  }
  const cached = rowsCache.get(sid);
  if (cached && cached.updatedAt === meta.updatedAt) {
    cached.lastAccessAt = Date.now();
    console.log(JSON.stringify({ severity: 'INFO', kind: 'snapshot-load', sid, status: 'cache-hit', rows: cached.rows.length }));
    return { rows: cached.rows, updatedAt: meta.updatedAt };
  }
  // 同じ sid に対して並行リクエストが来ているなら in-flight を共有 (gunzip 重複回避)。
  const inFlight = inFlightLoads.get(sid);
  if (inFlight) {
    console.log(JSON.stringify({ severity: 'INFO', kind: 'snapshot-load', sid, status: 'inflight-dedupe' }));
    return inFlight;
  }

  const startedAt = Date.now();
  const promise = (async () => {
    try {
      const file = bucket().file(objectName(sid));
      const [buf] = await file.download();
      const downloadMs = Date.now() - startedAt;
      const json = (await gunzip(buf)).toString('utf8');
      const parsed = JSON.parse(json);
      const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
      rowsCache.set(sid, { updatedAt: meta.updatedAt, rows, lastAccessAt: Date.now() });
      evictIfNeeded();
      console.log(JSON.stringify({
        severity: 'INFO', kind: 'snapshot-load', sid,
        status: 'cache-miss',
        rows: rows.length,
        sizeBytes: buf.length,
        downloadMs,
        totalMs: Date.now() - startedAt,
      }));
      return { rows, updatedAt: meta.updatedAt };
    } finally {
      inFlightLoads.delete(sid);
    }
  })();
  inFlightLoads.set(sid, promise);
  return promise;
}

// テスト/デプロイ後の即時無効化用
export function invalidate(sid) {
  metadataCache.delete(sid);
  rowsCache.delete(sid);
}
