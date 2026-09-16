// Google Sheets integration — fetch は backend (SA/ADC) で行う。
// ここに残るのは入力からスプレッドシート ID を抽出するヘルパのみ。

export function extractSpreadsheetId(input: string): string | null {
  const urlMatch = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(input);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(input.trim())) return input.trim();
  return null;
}
