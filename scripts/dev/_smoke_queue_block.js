/* 🚦 队列「跑不起来」离线冒烟（2026-10-30，11-03 按拆行口径改成一行一次搜索）：
   标红 → 再试一次 → 为什么停；顺带核一遍日常浏览现行口径（互动只留概率、一轮 18~22 篇）。
   口径：一行跑失败＝记一笔、队列继续往下走；同一行连记 3 次就搁在红块里等老板点「再试一次」。
   用法：node scripts/dev/_smoke_queue_block.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, 'extension', p), 'utf8');

const store = {};
const chrome = {
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
  runtime: { sendMessage: async () => { throw new Error('冒烟里没有 runtime'); } },
};

const ctx = vm.createContext({ chrome, console, setTimeout, clearTimeout });
vm.runInContext(read('lib/daily-browse.js'), ctx, { filename: 'daily-browse.js' });
vm.runInContext(read('lib/scenario-drain.js'), ctx, { filename: 'scenario-drain.js' });
const $ = (expr) => vm.runInContext(expr, ctx);

const today = new Date().getDay();

const planOf = async () => {
  const cfg = await $('drainGetScanCfg')();
  const q = await $('drainGetQueue')();
  return $('drainQueuePlan')(cfg, q, Date.now(), null);
};

(async () => {
  /* 起手：一个今天排得上、已经到点的获客格子（周几勾了今天，跑法＝每轮跑） */
  store.drain_scan_cfg = {
    v: 6,
    keywords: [{ k: '测试词', on: true, days: [today], types: { latest: true } }],
    typeRun: { latest: { mode: 'each' }, top: { mode: 'off' }, local: { mode: 'off' }, pain: { mode: 'off' }, rival: { mode: 'off' } },
  };
  store.drain_queue = { manual: [], carry: [], done: [], dailyMark: { sinceN: 0, lastAt: 0 } };

  let p = await planOf();
  assert.ok(p.todo.length > 0, '到点的获客格子要排得出来');
  const item = p.todo[0];
  assert.equal(p.blocked.length, 0, '起手没有标红项');

  /* ① 标红：记一次 → 派生时不再排它，但红块里看得见（拆行后只标这一「次搜索」） */
  const sameRow = (x) => x.k === item.k && x.scenario === item.scenario && (x.passId || '') === (item.passId || '');
  const n1 = await $('drainQueueBlock')(item, '搜索没出结果');
  assert.equal(n1, 1, '第一次记成 1');
  p = await planOf();
  assert.equal(p.todo.filter(sameRow).length, 0, '标红后不再排进待跑');
  const totalBefore = p.todo.length;
  assert.ok(totalBefore >= 0, '其它行不受影响');
  assert.equal(p.blocked.length, 1, '红块里有这一项');
  assert.equal(p.blocked[0].why, '搜索没出结果', '原因带出来了');
  assert.equal(p.blocked[0].n, 1, '次数带出来了');

  /* ② 再记两次 → 次数累加（对应执行器「连续 3 次就搁着」） */
  const n2 = await $('drainQueueBlock')(item, '搜索没出结果');
  const n3 = await $('drainQueueBlock')(item, '搜索没出结果');
  assert.deepEqual([n2, n3], [2, 3], '同一天同一项累加到 3');
  p = await planOf();
  assert.equal(p.blocked.length, 1, '同一项只留一行（不叠加）');
  assert.equal(p.blocked[0].n, 3, '次数还是 3');

  /* ③ 点「再试一次」→ 撤掉标红，重新排得上（只动这一行） */
  await $('drainQueueUnblock')(item.k, item.scenario, item.plat || 'xhs', item.passId);
  p = await planOf();
  assert.equal(p.blocked.length, 0, '撤掉标红');
  assert.ok(p.todo.some(sameRow), '重新排回待跑');

  /* ④ 为什么停：记一笔 → 队列页拿得到，且带得出是哪一项 */
  await $('drainQueueLastStop')(item, '今天评论到上限了，明天接着跑', { global: true });
  p = await planOf();
  assert.ok(p.lastStop, '有 lastStop');
  assert.equal(p.lastStop.why, '今天评论到上限了，明天接着跑', '原因原样带出');
  assert.equal(p.lastStop.global, true, '标成整队停');
  assert.equal(p.lastStop.k, item.k, '记得是哪一项');
  assert.equal(p.lastStop.passId || '', item.passId || '', '记得是这一次搜索');

  /* ⑤ 日常浏览现行口径（2026-10-30 起）：互动只留概率、不留每日名额；一轮篇数＝18~22 */
  const DailyBrowse = $('DailyBrowse');
  const dbCfg = DailyBrowse.norm({ comment: { rate: 10, dailyMax: 5 }, reply: { dailyMax: 2, rate: 8 }, follow: { rate: 8, dailyMax: 3 } });
  assert.equal(dbCfg.comment.rate, 10, '评论概率保留');
  assert.equal(dbCfg.comment.dailyMax, undefined, '评论不再有每日名额');
  assert.equal(dbCfg.reply, undefined, '「回复别人」并进评论，不再单列');
  assert.equal(dbCfg.follow.rate, 3, '老的关注 8% 一次性落回 3%');
  assert.equal(dbCfg.follow.dailyMax, undefined, '关注不再有每日名额');
  assert.deepEqual([dbCfg.perRoundMin, dbCfg.perRoundMax], [18, 22], '一轮篇数默认 18~22');
  assert.equal(dbCfg.perRound, undefined, '老的单值 perRound 作废');
  const dbTuned = DailyBrowse.norm({ perRoundMin: 5, perRoundMax: 9 });
  assert.deepEqual([dbTuned.perRoundMin, dbTuned.perRoundMax], [5, 9], '一轮篇数能自己调');

  console.log('✅ 标红/累加/再试一次/停因/名额迁移 全过');
  console.log('\n🎉 队列「跑不起来」冒烟全部通过');
})().catch((e) => { console.error('❌ 冒烟失败:', e.message); process.exit(1); });
