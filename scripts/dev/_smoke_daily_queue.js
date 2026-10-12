/* 🌿 日常流程 × 队列 离线冒烟（2026-09-27 修「手插一轮被总开关跳掉」的回归）
   1) 队列派生：日常浏览关着时，手插的一轮照样进待跑、排最前；没手插就不排它（关＝只停自动排）
   2) 执行器拿到的项带 manual（＝force 的来源），_dailySkipReason 对手插项放行、对自动项照旧拦
   3) 方向停用 / 今日配额满：手插也拦（这两个是硬门槛）
   用法：node scripts/dev/_smoke_daily_queue.js */
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
const DailyBrowse = $('DailyBrowse');

/* 执行器那两个判定函数从 auto-bot.js 原样抽出来跑（不启动整个引擎） */
const autoBot = read('auto-bot.js');
function methodSource(name) {
  const m = new RegExp('^    ' + name + ': function \\([^)]*\\) \\{[\\s\\S]*?^    \\},', 'm').exec(autoBot);
  assert.ok(m, '找不到 AutoBot 方法: ' + name);
  return m[0].replace(/,\s*$/, '');
}
const AutoBot = $('({' + methodSource('_dailySkipReason') + ',\n' + methodSource('_dailyUsed') + '})');

const planOf = async () => $('drainQueuePlan')(await $('drainGetScanCfg')(), await $('drainGetQueue')(), Date.now(), await $('drainDailyCtx')());
const pad = (n) => String(n).padStart(2, '0');

(async () => {
  // 起手：日常浏览默认就是关的（老板踩到的正是这个状态）；种一个到点的获客格子
  const cfgOff = await DailyBrowse.getConfig();
  assert.equal(cfgOff.enabled, false, '默认总开关是关的');
  store.drain_scan_cfg = { v: 4, keywords: [{ k: '测试词', on: true, types: { latest: true } }], typeRun: { latest: { mode: 'each' }, top: { mode: 'off' }, local: { mode: 'off' }, pain: { mode: 'off' }, rival: { mode: 'off' } } };
  store.drain_queue = { manual: [], carry: [], done: [], dailyMark: { sinceN: 0, lastAt: 0 } };

  // 1) 关着 + 没手插 → 队列里没有日常流程这一项
  let p = await planOf();
  assert.equal(p.dbOn, false, '总开关关着 → dbOn=false（自动排这条线是断的）');
  assert.equal(p.todo.filter(x => x.daily).length, 0, '没手插时日常流程不进队列');
  assert.ok(p.todo.length > 0, '获客格子照排');

  // 2) 手插一轮「随便刷刷」→ 进待跑、排最前、带 manual
  await $('drainQueuePushFront')('d1', 'daily', '随便刷刷');
  p = await planOf();
  const dItems = p.todo.filter(x => x.daily);
  assert.equal(dItems.length, 1, '手插的一轮在待跑里');
  assert.equal(dItems[0].manual, true, '带「手插」标记');
  assert.equal(dItems[0].label, '随便刷刷', '显示方向名');
  assert.equal(p.todo[0].scenario, 'daily', '手插项排最前');

  // 3) 执行器取队首：拿到的就是它，且 manual=true（force 的来源）
  const got = await $('drainQueueTake')({});
  assert.equal(got.scenario, 'daily', '队首＝日常流程');
  assert.equal(got.manual, true, '执行器拿到的项带 manual');

  // 4) 判定：总开关关 / 不在时段 → 自动项跳过，手插项照跑；方向停用 / 配额满 → 手插也拦
  const dir = DailyBrowse.dirById(cfgOff, 'd1');
  const day0 = { byDirection: {} };
  assert.match(AutoBot._dailySkipReason(cfgOff, day0, dir, false), /日常浏览已关/, '自动项：关着就跳过');
  assert.equal(AutoBot._dailySkipReason(cfgOff, day0, dir, true), '', '手插项：关着也照跑');
  assert.match(AutoBot._dailySkipReason(cfgOff, day0, DailyBrowse.normDirection({ id: 'd1', name: '随便刷刷', enabled: false }, 0), true), /停用/,
    '方向停用：手插也拦');
  assert.match(AutoBot._dailySkipReason(cfgOff, { byDirection: { d1: 40 } }, dir, true), /刷满/, '配额满：手插也拦');

  const cfgOn = await DailyBrowse.saveConfig({ enabled: true });
  const h = (new Date().getHours() + 5) % 24;
  const dirWin = DailyBrowse.normDirection({ id: 'd2', name: '时段方向', windows: [{ start: pad(h) + ':00', end: pad((h + 1) % 24) + ':00' }] }, 0);
  assert.match(AutoBot._dailySkipReason(cfgOn, day0, dirWin, false), /不在时段/, '自动项：不在时段跳过');
  assert.equal(AutoBot._dailySkipReason(cfgOn, day0, dirWin, true), '', '手插项：不在时段也照跑');
  await DailyBrowse.saveConfig({ enabled: false });

  // 5) 手插项没跑完（欠账）→ 下一趟仍按手插跑（别被总开关跳掉）
  await $('drainQueueHold')(got, '页面没加载好');
  assert.equal(store.drain_queue.carry.length, 1, '欠账已落盘');
  p = await planOf();
  const c = p.todo.find(x => x.daily);
  assert.ok(c, '欠账后仍在待跑');
  assert.equal(c.manual, true, '手插标记没丢');
  assert.equal((await $('drainQueueTake')({})).manual, true, '下一趟取到的还是手插项');

  console.log('✅ 关着也照跑：手插一轮进待跑 / 排最前 / 执行器放行；自动排这条线仍然断着');
  console.log('✅ 硬门槛仍在：方向停用、今日配额满 → 手插也拦');
  console.log('\n🎉 日常流程 × 队列离线冒烟全部通过');
})().catch(e => { console.error('❌ 冒烟失败:', e.message); process.exit(1); });
