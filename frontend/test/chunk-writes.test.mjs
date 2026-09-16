// Firestore 書き込みのサイズ/件数チャンク分割 (chunkBySize) の検査。
// データソースのコピー作成で「Transaction too big」を防ぐための分割ロジック。
import { chunkBySize } from '../../backend/src/utils/chunkWrites.js';

let fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`NG★ ${name}\n     got =${JSON.stringify(got)}\n     want=${JSON.stringify(want)}`); }
  else console.log(`OK  ${name}`);
};
const size = x => x.sz;      // テスト item は { sz } を持つ
const ids = chunks => chunks.map(c => c.map(x => x.id));

console.log('═══ chunkBySize ═══');
t('空配列は空チャンク', chunkBySize([], size, 100, 10), []);

{
  // 合計がサイズ上限以内・件数上限以内 → 1 チャンク
  const items = [{id:1,sz:30},{id:2,sz:30},{id:3,sz:30}];
  t('小さいものは 1 コミットにまとまる', ids(chunkBySize(items, size, 100, 10)), [[1,2,3]]);
}
{
  // サイズ上限で分割: 30+30+30=90 ≤100 だが +30=120>100 で区切る
  const items = [{id:1,sz:30},{id:2,sz:30},{id:3,sz:30},{id:4,sz:30}];
  t('★サイズ上限で分割', ids(chunkBySize(items, size, 100, 10)), [[1,2,3],[4]]);
}
{
  // 件数上限で分割 (サイズは余裕)
  const items = [{id:1,sz:1},{id:2,sz:1},{id:3,sz:1},{id:4,sz:1},{id:5,sz:1}];
  t('件数上限で分割', ids(chunkBySize(items, size, 1000, 2)), [[1,2],[3,4],[5]]);
}
{
  // 単一で上限超過のものは単独チャンク (それ以上分割不能)
  const items = [{id:1,sz:10},{id:2,sz:500},{id:3,sz:10}];
  t('★単一で上限超過は単独チャンク', ids(chunkBySize(items, size, 100, 10)), [[1],[2],[3]]);
}
{
  // 先頭が巨大でも単独で入る
  const items = [{id:1,sz:999},{id:2,sz:10}];
  t('先頭が巨大なら単独→次で新チャンク', ids(chunkBySize(items, size, 100, 10)), [[1],[2]]);
}
{
  // 順序保存: flatten が入力順と一致
  const items = [{id:1,sz:40},{id:2,sz:40},{id:3,sz:40},{id:4,sz:40}];
  const flat = chunkBySize(items, size, 100, 10).flat().map(x => x.id);
  t('順序保存', flat, [1,2,3,4]);
}
{
  // 実ケース: config 558KB + プリセット6件×~983KB を 3MiB 上限で分割
  const MB = 1024*1024;
  const items = [{id:'cfg',sz:0.558*MB}, ...Array.from({length:6},(_, i)=>({id:'p'+i, sz:0.983*MB}))];
  const chunks = chunkBySize(items, size, 3*MB, 400);
  const allUnder = chunks.every(c => c.reduce((s,x)=>s+x.sz,0) <= 3*MB);
  t('★各チャンクが 3MiB 以下', allUnder, true);
  t('全件が漏れなく含まれる', chunks.flat().length, 7);
}

console.log(fail ? `\n❌ ${fail} 件の不一致` : '\n✅ 全て期待どおり');
process.exit(fail ? 1 : 0);
