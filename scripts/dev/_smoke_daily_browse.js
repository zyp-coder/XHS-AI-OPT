/* 🌿 日常浏览 离线冒烟：用假 chrome API 跑通 归一化 / 方向轮转 / 时段（含 🛡 钳进 09:00–21:00）/ 配额 / 记账 / 保底时钟
   用法：node scripts/dev/_smoke_daily_browse.js
   注意：执行器与队列的接线在 background.js / auto-bot.js 里，这里只测引擎本身（P4 的判据也在这里）。 */
const path = require('path');
const assert = require('assert');

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
};
global.chrome = chrome;

const DailyBrowse = require(path.resolve(__dirname, '../../extension/lib/daily-browse.js'));

/* 造一个「今天某时某分」的时间戳（本地时区，和引擎口径一致） */
const mk = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); };
const D = (over) => DailyBrowse.normDirection(Object.assign({ id: 'dx', name: '方向' }, over || {}), 0);

(async () => {
  // 1) 默认配置：关着、不自动塞满、方向给一个「随便刷刷」兜底
  let cfg = await DailyBrowse.getConfig();
  assert.strictEqual(cfg.enabled, false, '默认关闭');
  assert.strictEqual(cfg.insert.everyN, 3, '默认每 3 格插 1 轮');
  assert.deepStrictEqual(cfg.autorun, { enabled: false, from: '09:00', to: '21:00' }, '默认不自动跑 + 09:00-21:00（🛡 静默期不跑）');
  assert.strictEqual(cfg.perRound, 6, '默认一轮 6 篇');
  assert.strictEqual(cfg.directions.length, 1, '没配方向时兜底一个方向');
  assert.strictEqual(cfg.directions[0].keywords.length, 0, '兜底方向走首页推荐（泛刷）');
  assert.deepStrictEqual(cfg.directions[0].windows.map(w => w.start + '-' + w.end),
    ['09:00-11:30', '14:00-17:30', '20:00-21:00'], '方向默认三段时段（🛡 都在 09:00–21:00 内）');
  assert.strictEqual(cfg.directions[0].dailyQuota, 40, '方向默认配额 40');
  console.log('✅ 默认配置：每', cfg.insert.everyN, '格插 1 轮 | autorun', cfg.autorun.from + '-' + cfg.autorun.to,
    '| 方向', cfg.directions[0].name, cfg.directions[0].dailyQuota + ' 篇');

  // 2) 越界值夹紧 / 非法值丢弃
  cfg = await DailyBrowse.saveConfig({
    enabled: true, perRound: 0, dwellMin: 300, dwellMax: 1,
    openRate: 500, likeRate: -3, collectRate: 12,
    insert: { everyN: 99 },
    comment: { rate: 500, dailyMax: -1 }, reply: { dailyMax: 999 }, follow: { rate: 8, dailyMax: 3 },
    pool: ['  A  ', '', 'B', null],
    directions: [{
      id: 'd1', name: '家居', keywords: ['  A  ', '', 'A', 'B', null],
      windows: [{ start: '8:00', end: '10:00' }, { start: 'abc', end: '10:00' }],
      dailyQuota: 9999, weight: 9,
    }],
  });
  assert.strictEqual(cfg.perRound, 1, '每轮篇数下限 1');
  assert.strictEqual(cfg.dwellMin, 120, '停留上限 120');
  assert.strictEqual(cfg.dwellMax, 120, '停留上限跟随下限');
  assert.strictEqual(cfg.openRate, 100, '打开比例上限 100');
  assert.strictEqual(cfg.likeRate, 0, '点赞比例下限 0');
  assert.strictEqual(cfg.insert.everyN, 20, '塞入间隔上限 20');
  assert.strictEqual(cfg.comment.rate, 100, '评论概率上限 100');
  assert.strictEqual(cfg.comment.dailyMax, 0, '评论每日上限下限 0');
  assert.strictEqual(cfg.reply.dailyMax, 100, '回复每日上限上限 100');
  assert.deepStrictEqual(cfg.pool, ['A', 'B'], '句池去空');
  const d1 = cfg.directions[0];
  assert.deepStrictEqual(d1.keywords, ['A', 'B'], '关键词去空去重');
  assert.strictEqual(d1.windows.length, 1, '非法时段（abc）被丢弃');
  assert.deepStrictEqual(d1.windows, [{ start: '09:00', end: '10:00' }], '🛡 8:00-10:00 钳进成 09:00-10:00');
  assert.strictEqual(d1.dailyQuota, 300, '方向配额上限 300');
  assert.strictEqual(d1.weight, 5, '方向权重上限 5');
  console.log('✅ 夹紧：轮', cfg.perRound, '| 停留', cfg.dwellMin + '-' + cfg.dwellMax, '| 比例', cfg.openRate + '/' + cfg.likeRate,
    '| 间隔', cfg.insert.everyN, '| 方向', d1.dailyQuota, JSON.stringify(d1.keywords), JSON.stringify(d1.windows));

  // 3) 老配置（全局关键词+时段+配额）一次性升级成一个方向，不丢配置
  const legacy = DailyBrowse.norm({
    enabled: true, keywords: ['猫', '狗'], windows: [{ start: '10:00', end: '12:00' }], dailyQuota: 12,
  });
  assert.strictEqual(legacy.directions.length, 1, '老配置升成 1 个方向');
  assert.deepStrictEqual(legacy.directions[0].keywords, ['猫', '狗'], '老关键词进了方向');
  assert.deepStrictEqual(legacy.directions[0].windows, [{ start: '10:00', end: '12:00' }], '老时段进了方向');
  assert.strictEqual(legacy.directions[0].dailyQuota, 12, '老配额进了方向');
  assert.ok(!('keywords' in legacy) && !('windows' in legacy) && !('dailyQuota' in legacy), '老键已从配置上摘掉');
  console.log('✅ 老配置升级：', legacy.directions[0].name, JSON.stringify(legacy.directions[0].keywords), legacy.directions[0].dailyQuota);

  // 4) 时段匹配（普通 / 跨零点 / 空=全天 / 一位数小时 / 🛡 钳进 09:00–21:00）
  const c3 = DailyBrowse.norm({ enabled: true, windows: [{ start: '09:00', end: '11:30' }, { start: '20:00', end: '22:30' }] });
  assert.deepStrictEqual(c3.directions[0].windows.map(w => w.start + '-' + w.end),
    ['09:00-11:30', '20:00-21:00'], '🛡 20:00-22:30 钳进成 20:00-21:00');
  assert.strictEqual(DailyBrowse.inWindow(c3.directions[0].windows, mk(10, 0)), true, '10:00 在窗口内');
  assert.strictEqual(DailyBrowse.inWindow(c3.directions[0].windows, mk(12, 0)), false, '12:00 不在窗口内');
  assert.strictEqual(DailyBrowse.inWindow(c3.directions[0].windows, mk(20, 30)), true, '20:30 在窗口内（钳后 20:00-21:00）');
  assert.strictEqual(DailyBrowse.inWindow(c3.directions[0].windows, mk(21, 0)), false, '21:00 出窗口（🛡 静默期）');
  assert.strictEqual(DailyBrowse.inWindow([{ start: '23:00', end: '02:00' }], mk(0, 30)), true, '跨零点时段命中（裸窗口直判）');
  assert.strictEqual(DailyBrowse.inWindow([], mk(3, 0)), true, '空时段 = 全天');
  assert.strictEqual(DailyBrowse.inWindow([{ start: '8:00', end: '9:30' }], mk(8, 30)), true, '一位数小时（8:00）也能命中');
  const cX = DailyBrowse.norm({ enabled: true, directions: [{ id: 'x', name: 'X', windows: [{ start: '20:00', end: '01:00' }, { start: '22:30', end: '23:30' }] }] });
  assert.deepStrictEqual(cX.directions[0].windows.map(w => w.start + '-' + w.end),
    ['20:00-21:00'], '🛡 跨零点 20:00-01:00 截断到 21:00 止；整段在静默期（22:30-23:30）丢弃');
  console.log('✅ 时段匹配（普通/跨零点/空=全天/一位数小时/🛡 钳进）通过');

  // 5) 方向轮转：停用 / 满配额 / 不在时段 → 挑不出来
  const day = { byDirection: {} };
  const cfgPick = DailyBrowse.norm({
    enabled: true, directions: [
      { id: 'a', name: 'A', enabled: false, windows: [] },
      { id: 'b', name: 'B', windows: [], dailyQuota: 2 },
      { id: 'c', name: 'C', windows: [{ start: '14:00', end: '15:00' }] },
    ],
  });
  assert.strictEqual(DailyBrowse.pickDirection(cfgPick, day, mk(10, 0)).id, 'b', '停用的 A 与不在时段的 C 都挑不中');
  assert.strictEqual(DailyBrowse.pickDirection(cfgPick, { byDirection: { b: 2 } }, mk(10, 0)), null, 'B 满配额后没得挑');
  assert.strictEqual(DailyBrowse.pickDirection(cfgPick, { byDirection: { b: 1 } }, mk(10, 0)).id, 'b', 'B 还差一条时仍能挑中');
  console.log('✅ 方向轮转：只在「启用 + 时段内 + 没满配额」的方向里挑');

  // 6) willWorkToday（保底时钟的判据）：现在挑不出 ≠ 今天没活
  const cfgToday = DailyBrowse.norm({
    enabled: true, directions: [{ id: 'n', name: 'Night', windows: [{ start: '20:00', end: '22:30' }] }],
  });
  assert.strictEqual(DailyBrowse.willWorkToday(cfgToday, day, mk(10, 0)), true, '还没到 20:00 → 今天仍算有活');
  assert.strictEqual(DailyBrowse.willWorkToday(cfgToday, day, mk(23, 0)), false, '今天那一段已经过去 → 今天没活了');
  assert.strictEqual(DailyBrowse.willWorkToday(cfgToday, { byDirection: { n: 40 } }, mk(10, 0)), false, '配额满了 → 今天没活了');
  assert.strictEqual(DailyBrowse.willWorkToday(DailyBrowse.norm({ enabled: false, directions: cfgToday.directions }), day, mk(10, 0)), false,
    '总开关关掉 → 今天没活了');
  console.log('✅ willWorkToday：没到点算有活、时段过了/配额满/总开关关掉都算没活');

  // 7) autorunOn（每天自动跑的时段；起止相同＝全天）
  const cfgAuto = DailyBrowse.norm({ enabled: true, autorun: { enabled: true, from: '08:30', to: '22:30' } });
  assert.deepStrictEqual([cfgAuto.autorun.from, cfgAuto.autorun.to], ['09:00', '21:00'], '🛡 08:30-22:30 钳进成 09:00-21:00');
  assert.strictEqual(DailyBrowse.autorunOn(cfgAuto, mk(10, 0)), true, '10:00 在自动跑时段内');
  assert.strictEqual(DailyBrowse.autorunOn(cfgAuto, mk(23, 0)), false, '23:00 出了自动跑时段');
  assert.strictEqual(DailyBrowse.autorunOn(DailyBrowse.norm({ enabled: true, autorun: { enabled: false } }), mk(10, 0)), false, '没开就不自动跑');
  assert.strictEqual(DailyBrowse.autorunOn(DailyBrowse.norm({ enabled: true, autorun: { enabled: true, from: '08:30', to: '08:30' } }), mk(3, 0)),
    true, '起止填一样＝全天');
  console.log('✅ autorunOn：时段内开、时段外关、起止相同＝全天');

  // 8) nextOpenMs（执行器驻留靠它决定"要不要接着等"）
  const now10 = mk(10, 0);
  const cfgN = DailyBrowse.norm({
    enabled: true, directions: [
      { id: 'n', name: 'Night', windows: [{ start: '20:00', end: '22:30' }] },
      { id: 'm', name: 'Morning', windows: [{ start: '09:00', end: '11:30' }] },
    ],
  });
  assert.strictEqual(DailyBrowse.nextOpenMs({ ...cfgN, directions: [{ id: 'm', name: 'M', windows: [{ start: '09:00', end: '11:30' }] }] }, day, now10),
    now10, '现在就在时段内且没满配额 → 立刻可跑（返回 now）');
  const nightOnly = DailyBrowse.norm({ enabled: true, directions: [{ id: 'n', name: 'Night', windows: [{ start: '20:00', end: '22:30' }] }] });
  assert.strictEqual(DailyBrowse.nextOpenMs(nightOnly, day, now10), mk(20, 0), '还没到 20:00 → 返回今天这一段开始时刻');
  assert.strictEqual(DailyBrowse.nextOpenMs(nightOnly, day, mk(23, 0)), 0, '今天这一段已经过去 → 返回 0（别再空等）');
  assert.strictEqual(DailyBrowse.nextOpenMs(nightOnly, { byDirection: { n: 40 } }, now10), 0, '配额满了 → 返回 0');
  assert.strictEqual(DailyBrowse.nextOpenMs(DailyBrowse.norm({ enabled: false, directions: nightOnly.directions }), day, now10), 0,
    '总开关关掉 → 返回 0');
  const allDay = DailyBrowse.norm({ enabled: true, directions: [{ id: 'a', name: 'AllDay', windows: [] }] });
  assert.strictEqual(DailyBrowse.nextOpenMs(allDay, { byDirection: { a: 40 } }, now10), 0, '全天方向但配额满了 → 返回 0');
  console.log('✅ nextOpenMs：可跑=now、未到点=今天那个 start、已过点/配额满/关掉=0');

  // 9) 「停止本轮」同时按住保底时钟（今天不再自动拉起），手动开始能解除
  await chrome.storage.local.remove(['daily_browse_auto_hold']);
  assert.strictEqual(await DailyBrowse.autoHoldUntil(), 0, '没按过停止 → 没有按住标记');
  const rStop = await DailyBrowse.stop();
  const holdUntil = await DailyBrowse.autoHoldUntil();
  const endToday = (() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); })();
  assert.strictEqual(holdUntil, endToday, '按住到当天 23:59:59');
  assert.strictEqual(rStop.holdUntil, endToday, 'stop() 把按住时刻回给调用方');
  assert.ok(store['daily_browse_stop_at'] > 0, '停止信号已落盘（页面侧逐单位读它）');
  await DailyBrowse.clearHold();
  assert.strictEqual(await DailyBrowse.autoHoldUntil(), 0, '手动开始后解除按住');
  assert.ok(store['daily_browse_stop_at'] > 0, '解除按住不动停止信号');
  console.log('✅ 停止→按住到当天 23:59:59，手动开始→解除按住');

  // 10) 记账：篇数落方向头上、顺手互动落全局、跨天自动归零
  await chrome.storage.local.remove('daily_browse_daily');
  await DailyBrowse.bumpDaily({ directionId: 'a', views: 5, comments: 1, replies: 2, follows: 1 });
  await DailyBrowse.bumpDaily({ directionId: 'b', views: 3, comments: 0, replies: 0, follows: 0 });
  let daily = await DailyBrowse.getDaily();
  assert.strictEqual(daily.count, 8, '总篇数 = 各方向之和');
  assert.strictEqual(daily.byDirection.a, 5, 'A 方向记 5 篇');
  assert.strictEqual(daily.byDirection.b, 3, 'B 方向记 3 篇');
  assert.deepStrictEqual([daily.comments, daily.replies, daily.follows], [1, 2, 1], '顺手互动记全局');
  assert.strictEqual(daily.rounds, 2, '两轮');
  await chrome.storage.local.set({ daily_browse_daily: { ...daily, date: '2000-01-01' } });
  daily = await DailyBrowse.getDaily();
  assert.deepStrictEqual([daily.count, daily.rounds, daily.comments], [0, 0, 0], '跨天自动归零');
  console.log('✅ 记账：方向篇数 + 全局互动 + 跨天归零');

  // 11) 今日进度（配置页/状态区展示用）
  const cfgP = DailyBrowse.norm({ enabled: true, directions: [
    { id: 'a', name: 'A', windows: [] },
    { id: 'b', name: 'B', windows: [{ start: '14:00', end: '15:00' }], dailyQuota: 2 },
  ] });
  const prog = DailyBrowse.progress(cfgP, { byDirection: { b: 2 } }, mk(10, 0));
  assert.deepStrictEqual(prog.map(x => [x.dir.id, x.used, x.left, x.inWindow, x.ok]),
    [['a', 0, 40, true, true], ['b', 2, 0, false, false]], '进度字段齐全且口径正确');
  console.log('✅ 今日进度：', prog.map(x => x.dir.name + ' ' + x.used + '/' + x.dir.dailyQuota + (x.ok ? ' 可跑' : ' 不可跑')).join(' | '));

  // 12) 状态快照字段齐全（配置页状态区 / 队列页读它）
  const st = await DailyBrowse.getStatus();
  ['ok', 'cfg', 'progress', 'today', 'inWindow', 'lastRound', 'logs'].forEach(k => {
    assert.ok(k in st, '状态缺字段: ' + k);
  });
  ['count', 'comments', 'replies', 'follows', 'rounds'].forEach(k => assert.ok(k in st.today, 'today 缺字段: ' + k));
  console.log('✅ 状态快照字段齐全 | 今日', JSON.stringify(st.today), '| inWindow =', st.inWindow);

  console.log('\n🎉 日常浏览引擎离线冒烟全部通过');
})().catch(e => { console.error('❌ 冒烟失败:', e.message); process.exit(1); });
