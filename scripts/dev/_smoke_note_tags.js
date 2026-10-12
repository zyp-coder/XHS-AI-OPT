/* 话题采集池离线冒烟：用假 chrome API 跑通 抽取 / 去重 / 累计 / 淘汰 / 排序 / 两个采集入口
   用法：node scripts/dev/_smoke_note_tags.js */
const path = require('path');
const assert = require('assert');

const store = {};
global.chrome = {
  storage: {
    local: {
      async get(keys) {
        if (keys == null) return Object.assign({}, store);
        if (typeof keys === 'string') return { [keys]: store[keys] };
        if (Array.isArray(keys)) { const o = {}; keys.forEach(k => { if (k in store) o[k] = store[k]; }); return o; }
        const o = {}; Object.keys(keys).forEach(k => { o[k] = k in store ? store[k] : keys[k]; }); return o;
      },
      async set(obj) { Object.assign(store, obj); },
      async remove(keys) { (Array.isArray(keys) ? keys : [keys]).forEach(k => delete store[k]); },
    },
  },
};
global.window = {};

require(path.resolve(__dirname, '../../extension/lib/note-tags.js'));
const T = global.window.NoteTags;
assert.ok(T && typeof T.extract === 'function', 'NoteTags 已挂到 window');

(async () => {
  // 1) 抽取：去重保序 / 纯数字丢弃 / 全角＃可识别 / 尾部标点剪掉 / 超长丢弃
  const tags = T.extract('今天聊 #装修 #装修 #北京买房＃厨房改造, #12345 #' + 'x'.repeat(30) + ' 结尾');
  assert.deepStrictEqual(tags, ['装修', '北京买房', '厨房改造'], '抽取结果：' + JSON.stringify(tags));
  assert.deepStrictEqual(T.extract('没有话题的正文'), [], '无 # 返回空');
  assert.strictEqual(T.extract(Array.from({ length: 14 }, (_, i) => '#话题' + i).join(' ')).length, 12, '单次最多 12 个');
  console.log('✅ 抽取:', JSON.stringify(tags));

  // 2) 累计：新词计数；同一批里的重复各计一次（出现次数口径）
  assert.strictEqual(await T.merge(['装修', '装修', '北京买房']), 2, '新词 2 个：装修 / 北京买房');
  let pool = await T.list();
  assert.strictEqual(pool.find(x => x.tag === '装修').n, 2, '装修累计 2 次');
  assert.strictEqual(pool.find(x => x.tag === '北京买房').n, 1, '北京买房 1 次');
  assert.strictEqual(pool[0].tag, '装修', '按次数降序排第一');
  assert.strictEqual(await T.merge(['装修']), 0, '已有词不再算新词');
  pool = await T.list();
  assert.strictEqual(pool.find(x => x.tag === '装修').n, 3, '再来一次 → 3 次');
  console.log('✅ 累计:', pool.map(x => x.tag + '×' + x.n).join(' '));

  // 3) 淘汰：超上限按「次数低的先淘汰」，高次数保住
  const many = [];
  for (let i = 0; i < 200; i++) many.push('词' + i);
  await T.merge(many);
  const full = await T.list();
  assert.strictEqual(full.length, T.MAX_TAGS, '池子被夹到上限 ' + T.MAX_TAGS);
  assert.ok(full.some(x => x.tag === '装修'), '高频词在淘汰后仍保留');
  console.log('✅ 淘汰: 池子长度', full.length, '上限', T.MAX_TAGS);

  // 4) 两个采集入口：笔记详情（标题+正文，同一篇内去重）/ 笔记列表（逐卡片计数）
  //    先清池，免得上一步塞进的 200 个陪跑词把只出现 1 次的词挤出池子
  await chrome.storage.local.remove('topic_pool');
  await T.merge(['装修', '装修', '装修', '北京买房']);
  const beforeTop = (await T.list()).find(x => x.tag === '装修').n;
  await T.recordFromPage({ title: '#装修 第 3 篇', description: '正文里再提一次 #装修 #避坑指南' });
  assert.strictEqual((await T.list()).find(x => x.tag === '装修').n, beforeTop + 1, '同一篇里多次提到只按一篇计');
  assert.ok((await T.list()).some(x => x.tag === '避坑指南'), '正文话题已入池');
  await T.recordFromNotes([{ tags: ['装修'] }, { tags: ['装修', '全屋定制'] }, {}]);
  assert.strictEqual((await T.list()).find(x => x.tag === '装修').n, beforeTop + 3, '列表里 2 张卡片的装修各计一次');
  console.log('✅ 采集入口: 装修累计', (await T.list()).find(x => x.tag === '装修').n);

  // 5) 空输入不报错、不落库
  assert.strictEqual(await T.merge([]), 0, '空数组返回 0');
  assert.deepStrictEqual(await T.recordFromNotes(null), 0, 'null 笔记返回 0');
  assert.strictEqual(await T.recordFromPage(null), 0, 'null 详情返回 0');
  console.log('✅ 空输入安全');

  console.log('\n全部通过 ✔');
})().catch(e => { console.error('❌', e && e.message || e); process.exit(1); });
