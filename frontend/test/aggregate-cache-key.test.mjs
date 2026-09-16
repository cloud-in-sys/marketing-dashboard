// 集計/選択肢/列 のキャッシュキーに「グループ行フィルタの内容」が含まれることの固定検査。
// これが無いと、同じグループのフィルタを変更しても鍵が変わらず古い結果に hit し続け、
// 「データは新フィルタで絞られるのに選択肢/集計が変更前のまま」という不整合が起きる。
import fs from 'fs';

const src = fs.readFileSync(new URL('../../backend/src/routes/aggregate.js', import.meta.url), 'utf8');
let fail = 0;
const t = (name, cond) => { if (!cond) { fail++; console.log(`NG★ ${name}`); } else console.log(`OK  ${name}`); };

t('★buildCacheKey が groupFilter を引数に取る', /function buildCacheKey\([^)]*,\s*groupFilter\)/.test(src));
t('★buildCacheKey の鍵に groupFilter を含める', /groupFilter \|\| 'nofilter'/.test(src));
t('★buildCacheKey 呼び出し (single) が groupFilter を渡す', /buildCacheKey\(sid, user, sourceUpdatedAt, configUpdatedAt, input, groupFilter\)/.test(src));
t('★buildCacheKey 呼び出し (batch) が groupFilter を渡す', /buildCacheKey\(sid, user, sourceUpdatedAt, configUpdatedAt, v\.input, groupFilter\)/.test(src));
t('★/options 系が filterHash を鍵に含める', /filterHash = groupFilter \? hashKey\(\[groupFilter\]\) : 'nofilter'/.test(src));
// options と columns の 2 エンドポイントで filterHash を使っている
t('filterHash がキャッシュキー文字列に埋め込まれている', (src.match(/\$\{filterHash\}/g) || []).length >= 2);

console.log(fail ? `\n❌ ${fail} 件の不一致` : '\n✅ 全て期待どおり');
process.exit(fail ? 1 : 0);
