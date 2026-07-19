// テストランナー。
//
// 以前は package.json で `node a.mjs && node b.mjs && ...` と繋いでいたが、
// これだと**テストファイルが例外で落ちた時に後続が 1 件も実行されない**のに、
// 出力を見ると NG が 0 件なので成功したように見える、という事故が起きた
// (実際に TS 化でソース検査の正規表現が null を返し、42 件が黙って消えた)。
//
// そのためこのランナーは:
//   - 途中で失敗しても**全ファイルを最後まで実行する** (被害範囲が一度で分かる)
//   - ファイルごとに終了コードと OK/NG 件数を出す
//   - 1 つでも落ちたら非ゼロで終了する
//
// テストファイル自体は node が直接 import する形のままなので、
// .ts のソースを読むために --experimental-strip-types が要る (下の NODE_ARGS)。

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const NODE_ARGS = ['--experimental-strip-types', '--no-warnings=ExperimentalWarning'];

const files = fs.readdirSync(here).filter(f => f.endsWith('.test.mjs')).sort();
if (files.length === 0) {
  console.error('テストファイルが 1 つも見つからない');
  process.exit(1);
}

const results = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [...NODE_ARGS, path.join(here, f)], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const ok = (out.match(/^OK/gm) || []).length;
  const ng = (out.match(/^NG/gm) || []).length;
  const passed = r.status === 0;
  results.push({ f, ok, ng, passed, out });
  console.log(`${passed ? '✅' : '❌'} ${f.padEnd(28)} OK ${String(ok).padStart(3)}  NG ${ng}${passed ? '' : `  (exit ${r.status})`}`);
  if (!passed) {
    // 失敗したファイルだけ詳細を出す。NG 行と、例外で落ちた場合の末尾。
    for (const line of out.split('\n').filter(l => l.startsWith('NG'))) console.log('    ' + line);
    if (ng === 0) console.log(out.split('\n').slice(-12).map(l => '    ' + l).join('\n'));
  }
}

const totalOk = results.reduce((a, r) => a + r.ok, 0);
const totalNg = results.reduce((a, r) => a + r.ng, 0);
const failed = results.filter(r => !r.passed);

console.log(`\n${files.length} ファイル / OK ${totalOk} / NG ${totalNg}`);
console.log(failed.length ? `❌ ${failed.length} ファイルが失敗: ${failed.map(r => r.f).join(', ')}` : '✅ 全て期待どおり');
process.exit(failed.length ? 1 : 0);
