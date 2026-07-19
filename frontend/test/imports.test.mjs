// すべての import が実在するファイルを指しているかの検査。
//
// なぜ必要か:
//   tsconfig は checkJs: false なので、**tsc は .js ファイルの import 解決を検査しない**。
//   つまり .js の中で壊れた import は tsc を素通りする。TS 化の途中は .js と .ts が
//   混在するため、`'./state.js'` の一括置換のような操作でここが壊れやすい
//   (実際に features/settings/state.js への import を app/state.ts への import と
//   取り違えて壊し、tsc も npm test も通ったのにビルドだけが落ちた)。
//
//   ビルドは落ちてくれるが、落ちるのが最後では気づくのが遅い。ここで先に落とす。
//
// alias の定義は vite.config.js と tsconfig.json の両方にあり、
// 片方だけ足すと「エディタでは解決するがビルドで落ちる」(またはその逆) になるため、
// 2 つが一致していることもここで検査する。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`NG★ ${name}\n     got =${JSON.stringify(got)}\n     want=${JSON.stringify(want)}`); }
  else console.log(`OK  ${name}`);
};

// ---- alias 定義を 2 つの設定ファイルから独立に読む ----
const tsconf = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8').replace(/^\s*\/\/.*$/gm, '')
);
const tsAliases = Object.fromEntries(
  Object.entries(tsconf.compilerOptions.paths).map(([k, v]) => [k.replace('/*', ''), v[0].replace('/*', '').replace(/^\.\//, '')])
);
const viteSrc = fs.readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8');
const viteAliases = Object.fromEntries(
  [...viteSrc.matchAll(/'(@[\w/]+)':\s*r\('\.\/([^']+)'\)/g)].map(m => [m[1], m[2]])
);

console.log('═══ alias 定義が tsconfig と vite.config で一致 ═══');
t('alias キーが一致', Object.keys(tsAliases).sort(), Object.keys(viteAliases).sort());
for (const k of Object.keys(tsAliases).sort()) {
  t(`${k} の指す先が一致`, tsAliases[k], viteAliases[k]);
}

// ---- 全 import の解決先 ----
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'vendor') walk(p, out); }
    else if (/\.(js|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}
// 静的 import / 動的 import / 副作用のみの import の 3 形態
const SPEC_RE = /(?:from\s+'|import\('|import\s+')([^']+)'/g;

console.log('\n═══ すべての import が実在ファイルを指す ═══');
const files = [...walk(path.join(ROOT, 'frontend/src')), ...walk(path.join(ROOT, 'packages/shared/src'))];
const broken = [];
let total = 0;
for (const f of files) {
  for (const [, spec] of fs.readFileSync(f, 'utf8').matchAll(SPEC_RE)) {
    if (spec.startsWith('http')) continue;   // CDN (firebase) はバンドルしない
    let target;
    if (spec.startsWith('.')) {
      target = path.resolve(path.dirname(f), spec);
    } else {
      const key = Object.keys(tsAliases).find(a => spec === a || spec.startsWith(a + '/'));
      if (!key) continue;                    // bare specifier (node_modules) は対象外
      target = path.resolve(ROOT, tsAliases[key], spec.slice(key.length + 1));
    }
    total++;
    if (!fs.existsSync(target)) broken.push(`${path.relative(ROOT, f)} → ${spec}`);
  }
}
t(`${total} 件の import すべてが実在ファイルを指す`, broken, []);

// ---- .js と .ts の取り違え検知 ----
// 同じディレクトリに同名の .js と .ts が両方あると、どちらが使われるか読み手に分からない。
console.log('\n═══ 同名の .js と .ts が共存していない ═══');
const dup = [];
for (const f of files) {
  if (!f.endsWith('.ts')) continue;
  if (fs.existsSync(f.replace(/\.ts$/, '.js'))) dup.push(path.relative(ROOT, f));
}
t('同名の .js/.ts が共存していない', dup, []);

console.log(fail ? `\n❌ ${fail} 件の問題` : '\n✅ 全て期待どおり');
process.exit(fail ? 1 : 0);
