// 環境変数の読み取りヘルパー。

// TTL(秒) を環境変数から読む。未設定 / 不正値なら既定値を使う。
// 0 を指定するとキャッシュ無効 (呼び出し側が <= 0 を見て判断する)。
export function readTtlMs(envKey, defaultSeconds) {
  const raw = process.env[envKey];
  if (raw === undefined || raw === '') return defaultSeconds * 1000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.log(JSON.stringify({
      severity: 'WARNING',
      message: `invalid ${envKey}, falling back to default`,
      value: raw,
      defaultSeconds,
    }));
    return defaultSeconds * 1000;
  }
  return n * 1000;
}
