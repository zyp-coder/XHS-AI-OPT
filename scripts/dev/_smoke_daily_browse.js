/* 日常浏览引擎离线冒烟：用假 chrome API 跑通 归一化 / 排程 / 时段 / 配额 / 对账
   用法：node scripts/dev/_smoke_daily_browse.js */
const path = require('path');
const assert = require('assert');

const store = {};
const alarms = {};
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
  alarms: {
    create(name, info) { alarms[name] = info; },
    clear(name, cb) { delete alarms[name]; if (cb) cb(true); },
  },
};
global.chrome = chrome;

const DailyBrowse = require(path.resolve(__dirname, '../../extension/lib/daily-browse.js'));

(async () => {
  // 1) 默认配置归一化
  let cfg = await DailyBrowse.getConfig();
  assert.strictEqual(cfg.enabled, false, '默认关闭');
  assert.strictEqual(cfg.dailyQuota, 40, '默认每日配额 40');
  assert.deepStrictEqual(cfg.windows.map(w => w.start + '-' + w.end),
    ['09:00-11:30', '14:00-17:30', '20:00-22:30'], '默认三段时段');
  console.log('✅ 默认配置:', JSON.stringify(cfg.windows), cfg.dailyQuota, cfg.perRound, cfg.intervalMin, cfg.dwellMin + '-' + cfg.dwellMax);

  // 2) 越界值被夹紧 / 非法关键词与时段被丢弃
  cfg = await DailyBrowse.saveConfig({
    enabled: true, dailyQuota: 9999, perRound: 0, intervalMin: -5,
    dwellMin: 300, dwellMax: 1, openRate: 500, likeRate: -3, collectRate: 12,
    windows: [{ start: '8:00', end: '9:00' }, { start: 'abc', end: '10:00' }, { start: '10:00', end: '11:00' }],
    keywords: ['  A  ', '', 'B', null],
  });
  assert.strictEqual(cfg.dailyQuota, 300, '配额上限 300');
  assert.strictEqual(cfg.perRound, 1, '每轮下限 1');
  assert.strictEqual(cfg.intervalMin, 5, '间隔下限 5');
  assert.strictEqual(cfg.dwellMin, 120, '停留上限 120');
  assert.strictEqual(cfg.dwellMax, 120, '停留下限跟随 dwellMin');
  assert.strictEqual(cfg.openRate, 100, '打开比例上限 100');
  assert.strictEqual(cfg.likeRate, 0, '点赞比例下限 0');
  assert.strictEqual(cfg.windows.length, 2, '非法时段（abc）被丢弃');
  assert.deepStrictEqual(cfg.keywords, ['A', 'B'], '关键词去空后保留');
  console.log('✅ 夹紧后:', cfg.dailyQuota, cfg.perRound, cfg.intervalMin, cfg.dwellMin + '-' + cfg.dwellMax, cfg.openRate, cfg.likeRate, JSON.stringify(cfg.windows), JSON.stringify(cfg.keywords));

  // 3) 排程：开启 → 建闹钟；关闭 → 清闹钟
  await DailyBrowse.applySchedule();
  assert.ok(alarms['daily-browse-tick'], '开启后应有闹钟');
  assert.ok(alarms['daily-browse-tick'].delayInMinutes >= 1, '延迟 ≥ 1 分钟');
  assert.ok(store['daily_browse_next_at'] > Date.now(), '写入下次运行时间');
  console.log('✅ 排程: delayInMinutes =', alarms['daily-browse-tick'].delayInMinutes, '| next_at =', new Date(store['daily_browse_next_at']).toLocaleString());
  await DailyBrowse.saveConfig({ enabled: false });
  assert.ok(!alarms['daily-browse-tick'], '关闭后闹钟应清掉');
  assert.strictEqual(store['daily_browse_next_at'], 0, '关闭后清空下次时间');
  console.log('✅ 关闭后闹钟已清、next_at = 0');

  // 4) 时段匹配
  const mk = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); };
  const c3 = DailyBrowse.norm({ enabled: true, windows: [{ start: '09:00', end: '11:30' }, { start: '20:00', end: '22:30' }] });
  assert.strictEqual(DailyBrowse.inWindow(c3, mk(10, 0)), true, '10:00 在窗口内');
  assert.strictEqual(DailyBrowse.inWindow(c3, mk(12, 0)), false, '12:00 不在窗口内');
  assert.strictEqual(DailyBrowse.inWindow(c3, mk(21, 0)), true, '21:00 在窗口内');
  const cNight = DailyBrowse.norm({ enabled: true, windows: [{ start: '23:00', end: '02:00' }] });
  assert.strictEqual(DailyBrowse.inWindow(cNight, mk(0, 30)), true, '跨零点时段命中');
  const cAll = DailyBrowse.norm({ enabled: true, windows: [] });
  assert.strictEqual(DailyBrowse.inWindow(cAll, mk(3, 0)), true, '空时段 = 全天');
  const cOneDigit = DailyBrowse.norm({ enabled: true, windows: [{ start: '8:00', end: '9:30' }] });
  assert.strictEqual(DailyBrowse.inWindow(cOneDigit, mk(8, 30)), true, '一位数小时（8:00）也能命中');
  console.log('✅ 时段匹配（普通/跨零点/空=全天/一位数小时）通过');

  // 5) 未开启 / 配额用尽 → 不跑
  let r = await DailyBrowse.runRound({});
  assert.strictEqual(r.ok, false);
  assert.ok(/未开启/.test(r.error), '未开启拦截: ' + r.error);
  console.log('✅ 未开启拦截:', r.error);

  await DailyBrowse.saveConfig({ enabled: true, windows: [], dailyQuota: 2, perRound: 6 });
  await chrome.storage.local.set({ daily_browse_daily: { date: DailyBrowse._today(), count: 2, countedRounds: [] } });
  r = await DailyBrowse.runRound({});
  assert.strictEqual(r.ok, false);
  assert.ok(/上限/.test(r.error), '配额拦截: ' + r.error);
  console.log('✅ 配额拦截:', r.error);

  // 6) 对账：上一轮跑了一半被 SW 杀掉，剩余条目补记
  await chrome.storage.local.set({
    daily_browse_daily: { date: DailyBrowse._today(), count: 2, countedRounds: ['rOld'] },
    daily_browse_last: { roundId: 'rNew', startedAt: Date.now() - 60000, items: [{ noteId: 'a' }, { noteId: 'b' }, { noteId: 'c' }], viewed: 3 },
  });
  const before = await DailyBrowse._getDaily();
  await DailyBrowse.reconcile();
  const after = await DailyBrowse._getDaily();
  assert.strictEqual(before.count, 2, '对账前 2');
  assert.strictEqual(after.count, 5, '对账后 +3');
  assert.strictEqual(after.countedRounds.includes('rNew'), true, '未记账轮次已登记');
  await DailyBrowse.reconcile();
  const again = await DailyBrowse._getDaily();
  assert.strictEqual(again.count, 5, '重复对账不重复计数');
  console.log('✅ 对账（SW 死亡补记 + 幂等）通过: count =', again.count);

  // 7) 状态快照字段齐全
  const st = await DailyBrowse.getStatus();
  ['ok', 'cfg', 'running', 'inWindow', 'todayCount', 'dailyQuota', 'lastRound', 'nextAt', 'logs'].forEach(k => {
    assert.ok(k in st, '状态缺字段: ' + k);
  });
  console.log('✅ 状态快照字段齐全 | todayCount =', st.todayCount, '| inWindow =', st.inWindow, '| running =', st.running);

  console.log('\n🎉 日常浏览引擎离线冒烟全部通过');
})().catch(e => { console.error('❌ 冒烟失败:', e.message); process.exit(1); });
