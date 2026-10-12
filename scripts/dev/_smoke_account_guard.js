/* 🛡 账号安全 离线冒烟：用假 chrome API 跑通 静默跨零点 / 单休抽签与顺延 / 总账扣减与挡位 / 降挡体检卡 / 发布缓冲 / 干歇节拍
   用法：node scripts/dev/_smoke_account_guard.js
   口径＝资料/账号行为层加固设计.md（2026-10-11）。 */
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

const G = require(path.resolve(__dirname, '../../extension/lib/account-guard.js'));

/* 造一个「今天某时某分」的时间戳（本地时区，和引擎口径一致） */
const mk = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); };
const dayAt = (off, h, m) => { const d = new Date(); d.setDate(d.getDate() + off); d.setHours(h, m, 0, 0); return d.getTime(); };
const TODAY = new Date().getDay();
const FAR = (TODAY + 3) % 7;   // 停用一个「3 天后的星期几」当休息日，保证今天/明天都不撞

(async () => {
  // 1) 默认配置：保守挡 + 本周抽了 1 天单休 + 日波动/起床延迟在带内
  let cfg = await G.getCfg();
  assert.strictEqual(cfg.level, '保守', '默认落最保守挡');
  assert.ok(cfg.restDay >= 0 && cfg.restDay <= 6, '单休日已抽出（0~6）');
  assert.strictEqual(G.WEEKDAYS.length, 7, '一周七个名字备好');
  let daily = await G.getDaily();
  assert.ok(daily.wave >= 0.6 && daily.wave <= 1, '日波动在 60%~100%');
  assert.ok(daily.wakeDelayMin >= 0 && daily.wakeDelayMin <= 40, '起床延迟 0~40 分钟');
  assert.strictEqual(daily.used.open, 0, '今天的账从 0 起');
  console.log('✅ 默认：挡位', cfg.level, '| 单休', G.WEEKDAYS[cfg.restDay], '| 波动', daily.wave, '| 起床延迟', daily.wakeDelayMin, '分');

  // 2) 静默期判定：21:00–09:00（含跨零点），边界不含 21:00 整点后的动作、09:00 放行
  assert.strictEqual(G.inQuiet(mk(20, 59)), false, '20:59 还能跑');
  assert.strictEqual(G.inQuiet(mk(21, 0)), true, '21:00 起静默');
  assert.strictEqual(G.inQuiet(mk(23, 30)), true, '夜里静默');
  assert.strictEqual(G.inQuiet(mk(3, 0)), true, '凌晨静默（跨零点）');
  assert.strictEqual(G.inQuiet(mk(8, 59)), true, '08:59 还没到开工');
  assert.strictEqual(G.inQuiet(mk(9, 0)), false, '09:00 放行');
  console.log('✅ 静默期：20:59 能跑 / 21:00–08:59 全静默 / 09:00 放行');

  // 3) 挡住跑：夜深与清晨 decide 给 quiet，且不扣账
  await G.saveCfg({ restDay: FAR });   // 把休息日停到别天，后面测静默不干扰
  let d1 = await G.decide('open', 1, mk(22, 0));
  assert.strictEqual(d1.ok, false, '22:00 不允许动');
  assert.strictEqual(d1.code, 'quiet', '原因＝静默期');
  let d2 = await G.decide('open', 1, mk(8, 30));
  assert.strictEqual(d2.ok, false, '08:30 不允许动');
  assert.strictEqual(d2.code, 'quiet', '原因＝静默期');
  console.log('✅ 静默挡住：22:00 / 08:30 都报 quiet');

  // 4) 起床延迟：09:00 后随机等 0~40 分钟，等满了才放行；顺延时刻精确到 wakeAt
  store.guard_daily = Object.assign({}, store.guard_daily, { wakeDelayMin: 30 });
  let d3 = await G.decide('open', 1, mk(9, 10));
  assert.strictEqual(d3.ok, false, '09:10 还没起床');
  assert.strictEqual(d3.code, 'quiet', '起床前按静默处理');
  let d4 = await G.decide('open', 1, mk(9, 31));
  assert.strictEqual(d4.ok, true, '09:31（过 30 分）放行');
  assert.strictEqual(G.nextRunAt(mk(9, 10), await G.getCfg(), await G.getDaily()), mk(9, 30), '顺延时刻＝今天 09:30（09:00+30）');
  console.log('✅ 起床延迟：09:10 挡 / 09:31 放 / 顺延到 09:30');

  // 5) 每周单休：当天全停；可手动换到别天；换完当周固定
  await G.saveCfg({ restDay: TODAY });
  let d5 = await G.decide('open', 1, mk(10, 0));
  assert.strictEqual(d5.ok, false, '休息日全停');
  assert.strictEqual(d5.code, 'rest', '原因＝休息日');
  assert.strictEqual(await G.isRestToday(), true, 'isRestToday 也说今天是');
  assert.strictEqual(G.nextRunAt(mk(10, 0), await G.getCfg(), await G.getDaily()), dayAt(1, 9, 0), '休息日顺延到明天 09:00');
  await G.saveCfg({ restDay: FAR });
  assert.strictEqual((await G.decide('open', 1, mk(10, 0))).ok, true, '换到别天就能跑');
  const wk = store.account_guard.restWeek;
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(wk), '记了本周（周一为界）');
  console.log('✅ 单休：今天停 / 换天放 / 顺延到明天 09:00 / 当周锚点', wk);

  // 6) 顺延跳过休息日：明晚是休息日 → 顺延到后天 09:00
  await G.saveCfg({ restDay: (TODAY + 1) % 7 });
  assert.strictEqual(G.nextRunAt(mk(22, 0), await G.getCfg(), await G.getDaily()), dayAt(2, 9, 0), '明天休 → 顺延到后天 09:00');
  await G.saveCfg({ restDay: FAR });
  console.log('✅ 顺延会跳过休息日（22:00 + 明天休 → 后天 09:00）');

  // 7) 总账扣减与挡位：日波动=1 时保守 open 上限 60，第 61 次停手；账本跨步持久
  store.guard_daily = { date: (await G.getDaily()).date, wave: 1, wakeDelayMin: 0, used: {}, beatH: -1, beatMin: 0, beatLast: -1 };
  let g = await G.spend('open', 1, mk(10, 0));
  assert.strictEqual(g.ok, true, '第一次能开');
  assert.strictEqual(g.cap, 60, '日波动=1 时按 60');
  let stopped = null;
  for (let i = 2; i <= 61; i++) { const r = await G.spend('open', 1, mk(10, 0)); if (!r.ok) { stopped = { i, r }; break; } }
  assert.ok(stopped, '总会停手');
  assert.strictEqual(stopped.i, 61, '第 61 次停手');
  assert.strictEqual(stopped.r.code, 'cap', '原因＝额度用完');
  assert.strictEqual(stopped.r.used, 60, '用了 60');
  assert.strictEqual(store.guard_daily.used.open, 60, '账本落盘 60');
  console.log('✅ 总账：保守上限 60（波=1）→ 第 61 次停手「cap」');

  // 8) 挡位切换：谨慎 140 / 正常 240；发笔记当天其它动作打折（保守 5 折）
  await G.saveCfg({ level: '谨慎' });
  g = await G.decide('open', 1, mk(10, 0));
  assert.strictEqual(g.cap, 140, '谨慎档 140');
  await G.saveCfg({ level: '正常' });
  g = await G.decide('open', 1, mk(10, 0));
  assert.strictEqual(g.cap, 240, '正常档 240');
  await G.saveCfg({ level: '保守' });
  g = await G.decide('open', 1, mk(10, 0));
  assert.strictEqual(g.cap, 60, '发笔记前不打折');
  store.guard_daily = Object.assign({}, store.guard_daily, { used: Object.assign({}, store.guard_daily.used, { post: 1 }) });
  g = await G.decide('like', 1, mk(10, 0));
  assert.strictEqual(g.cap, 10, '发过笔记当天其它动作 5 折（赞 20→10）');
  g = await G.decide('post', 1, mk(10, 0));
  assert.strictEqual(g.cap, 2, '发笔记本身不打折');
  store.guard_daily = Object.assign({}, store.guard_daily, { used: { open: 0 } });
  console.log('✅ 挡位：保守 60 / 谨慎 140 / 正常 240；发笔记当天其它 5 折、发笔记本身不打折');

  // 9) 干歇节拍：一小时动满 30 分钟 → 歇到下一小时；跨小时自动放行
  store.guard_daily = Object.assign({}, store.guard_daily, { beatH: 10, beatMin: 30, beatLast: 0 });
  let d6 = await G.decide('open', 1, mk(10, 20));
  assert.strictEqual(d6.ok, false, '动满 30 分钟停手');
  assert.strictEqual(d6.code, 'burst', '原因＝歇一歇');
  let next = await G.nextAllowedAt('open', mk(10, 20));
  assert.strictEqual(next.at, mk(11, 0), '歇到 11:00');
  assert.strictEqual((await G.decide('open', 1, mk(11, 0))).ok, true, '跨到下一小时放行');
  // 打点：同分钟连续只记 1 分钟、换分钟 +1
  store.guard_daily = Object.assign({}, store.guard_daily, { beatH: 10, beatMin: 0, beatLast: -1, used: { open: 0 } });
  await G.spend('open', 1, mk(10, 0));
  await G.spend('open', 1, mk(10, 0));
  assert.strictEqual(store.guard_daily.beatMin, 1, '同一分钟只记 1');
  await G.spend('open', 1, mk(10, 5));
  assert.strictEqual(store.guard_daily.beatMin, 2, '换了分钟 +1');
  console.log('✅ 干歇节拍：30 分钟满 → 歇到下一小时；打点按分钟，同分钟不重复');

  // 10) 发布缓冲：占线全停 / 发布前 15 分钟只许浏览 / 发布后 30 分钟全停 / 发笔记本身不拦
  store.np_pub_guard = { leadUntil: 0, busySince: mk(14, 50), postUntil: 0 };
  assert.strictEqual((await G.decide('open', 1, mk(15, 0))).ok, false, '发布占线浏览也停');
  store.np_pub_guard = { leadUntil: 0, busySince: mk(13, 0), postUntil: 0 };   // 超 60 分钟＝SW 被掐断的残留
  assert.strictEqual((await G.decide('open', 1, mk(15, 0))).ok, true, '残留占线（>60 分）自动忽略');
  store.np_pub_guard = { leadUntil: mk(15, 10), busySince: 0, postUntil: 0 };
  const lOpen = await G.decide('open', 1, mk(15, 0));
  const lCmt = await G.decide('comment', 1, mk(15, 0));
  assert.strictEqual(lOpen.ok, true, '发布前 15 分钟浏览放行');
  assert.strictEqual(lCmt.ok, false, '发布前 15 分钟不动手');
  assert.strictEqual(lCmt.code, 'hold', '原因＝hold');
  assert.strictEqual((await G.decide('post', 1, mk(15, 0))).ok, true, '发布本身不被发布前缓冲拦');
  store.np_pub_guard = { leadUntil: 0, busySince: 0, postUntil: mk(15, 30) };
  assert.strictEqual((await G.decide('open', 1, mk(15, 0))).ok, false, '发布后 30 分钟全停');
  const na = await G.nextAllowedAt('open', mk(15, 0));
  assert.ok(na && na.at === mk(15, 30), '给了恢复时刻＝postUntil');
  assert.strictEqual((await G.decide('open', 1, mk(16, 0))).ok, true, '过了 30 分钟放行');
  // pub.start/end 写键行为（时间用真实 now，不参与上面窗口断言）
  await G.pub.start();
  assert.ok(store.np_pub_guard.busySince > 0 && store.np_pub_guard.leadUntil === 0, 'start：占线置位、清发布前');
  await G.pub.end(true);
  assert.strictEqual(store.np_pub_guard.busySince, 0, 'end：收线');
  assert.ok(store.np_pub_guard.postUntil > Date.now(), 'end(true)：加 30 分钟缓冲');
  await G.pub.lead(mk(15, 10));
  assert.strictEqual(store.np_pub_guard.leadUntil, mk(15, 10), 'lead：写发布前起点');
  store.np_pub_guard = { leadUntil: 0, busySince: 0, postUntil: 0 };
  console.log('✅ 发布缓冲：占线全停（残留自动忽略）/ 前 15 分钟只浏览 / 后 30 分钟全停 / 发布本身不拦');

  // 11) 体检卡：警告降一级 / 处罚直落保守 / 已在保守再记只提醒（floor）/ 恢复一档
  await G.saveCfg({ level: '正常' });
  let h = await G.record({ kind: '警告', note: '测试警告' });
  assert.strictEqual(h.item.before, '正常', '记前正常');
  assert.strictEqual(h.level, '谨慎', '警告降一级到谨慎');
  assert.strictEqual((await G.getCfg()).level, '谨慎', '落盘');
  h = await G.record({ kind: '处罚', note: '测试处罚' });
  assert.strictEqual(h.level, '保守', '处罚直落保守');
  h = await G.record({ kind: '警告', note: '再记一笔' });
  assert.strictEqual(h.floor, true, '已在保守 → floor=true 只提醒');
  assert.strictEqual(h.level, '保守', '不再降');
  assert.ok((await G.healthList()).length >= 3, '历史三条都在');
  const rec = await G.recover();
  assert.strictEqual(rec.level, '谨慎', '恢复一档到谨慎');
  await G.saveCfg({ level: '保守' });
  console.log('✅ 体检卡：警告降级 / 处罚落底 / 再记只提醒 / 恢复一档');

  // 12) 跨天滚动：换天 → 重抽波动与起床延迟、清空用量（原来 50 篇归零）
  store.guard_daily = { date: '2000-01-01', wave: 1, wakeDelayMin: 5, used: { open: 50 }, beatH: 10, beatMin: 20, beatLast: 1 };
  daily = await G.getDaily();
  const t0 = new Date();
  const todayStr = t0.getFullYear() + '-' + String(t0.getMonth() + 1).padStart(2, '0') + '-' + String(t0.getDate()).padStart(2, '0');
  assert.strictEqual(daily.date, todayStr, '日期跟上今天');
  assert.strictEqual(daily.used.open, 0, '用量归零');
  const kept = daily.wave;
  await G.getDaily();
  assert.strictEqual((await G.getDaily()).wave, kept, '当天波动定死不变');
  console.log('✅ 跨天滚动：用量归零 / 波动与起床延迟当天定死');

  // 13) 状态快照字段齐全（弹窗小标 / 设置页读它）
  const st = await G.status(mk(10, 0));
  ['ok', 'level', 'wave', 'rows', 'rest', 'quiet', 'burst', 'blocked', 'health'].forEach(k => assert.ok(k in st, '状态缺字段: ' + k));
  assert.strictEqual(st.rows.length, 7, '额度墙 7 行');
  assert.strictEqual(st.rest.name, G.WEEKDAYS[FAR], '休息日名字对得上');
  console.log('✅ 状态快照：', st.level, '| 单休', st.rest.name, '| 墙', st.rows.map(r => r.kind + ' ' + r.used + '/' + r.cap).join(' '));

  // 14) 发布前窗口边界：leadUntil＝到点时刻，只拦它前面 15 分钟那一小段
  store.np_pub_guard = { leadUntil: mk(15, 10), busySince: 0, postUntil: 0 };
  assert.strictEqual((await G.decide('comment', 1, mk(14, 50))).ok, true, '14:50 还没进窗口（15:10 到点 → 14:55 才收手）');
  assert.strictEqual((await G.decide('comment', 1, mk(14, 55))).ok, false, '14:55 进窗口');
  assert.strictEqual((await G.decide('comment', 1, mk(14, 55))).code, 'hold', '原因＝hold');
  const nad = await G.nextAllowedAt('comment', mk(15, 0));
  assert.strictEqual(nad.at, mk(15, 10), '发布前窗口：恢复时刻＝到点');
  store.np_pub_guard = { leadUntil: 0, busySince: 0, postUntil: 0 };
  console.log('✅ 发布前窗口边界：14:50 放行 / 14:55（到点前 15 分钟）收手');

  // 15) 发布链自查（decideSelf / spendSelf）：占线与前后缓冲不拦自己，静默与额度照查
  store.np_pub_guard = { leadUntil: 0, busySince: mk(14, 50), postUntil: mk(15, 30) };
  assert.strictEqual((await G.decide('post', 1, mk(15, 0))).ok, false, '普通 decide：占线/缓冲挡发布');
  assert.strictEqual((await G.decideSelf('post', 1, mk(15, 0))).ok, true, 'decideSelf：发布链不拿自己的缓冲拦自己');
  const self2 = await G.decideSelf('post', 1, mk(22, 0));
  assert.strictEqual(self2.ok, false, 'decideSelf 静默照查');
  assert.strictEqual(self2.code, 'quiet', '原因＝quiet');
  const usedBefore = (await G.getDaily()).used.post || 0;
  await G.spendSelf('post', 1, mk(15, 0));
  assert.strictEqual((await G.getDaily()).used.post, usedBefore + 1, 'spendSelf：已发生的动作如实记账');
  store.np_pub_guard = { leadUntil: 0, busySince: 0, postUntil: 0 };
  console.log('✅ 发布链自查：decideSelf 放自己过墙 / 静默照查 / spendSelf 如实记账');

  // 16) 顺延账（defers）：写 / keepKeys 剪枝 / 清 / 不碰三把缓冲
  await G.pub.deferMany({ 'w1:mon:latest|n1': { to: dayAt(1, 9, 0), reason: '静默期' } }, ['w1:mon:latest|n1', 'w1:tue:top|n2']);
  await G.pub.deferMany({ 'w1:tue:top|n2': { to: dayAt(1, 9, 40), reason: '单休' } }, ['w1:tue:top|n2']);
  let dfs = await G.pub.defers();
  assert.ok(dfs['w1:tue:top|n2'], '第二条写进去了');
  assert.ok(!dfs['w1:mon:latest|n1'], 'keepKeys 里没有的行被剪掉');
  assert.strictEqual(dfs['w1:tue:top|n2'].reason, '单休', '顺延理由带着走（工作台回执用）');
  await G.pub.clearDefer('w1:tue:top|n2');
  assert.strictEqual(Object.keys(await G.pub.defers()).length, 0, 'clearDefer 之后为空');
  await G.pub.deferMany({ 'k|1': { to: 1, reason: 'x' } }, null);
  await G.pub.start();
  assert.ok((await G.pub.defers())['k|1'], 'start 不清顺延账');
  assert.strictEqual(store.np_pub_guard.leadUntil, 0, 'start：清发布前');
  await G.pub.clearDefer('k|1');
  store.np_pub_guard = { leadUntil: 0, busySince: 0, postUntil: 0 };
  console.log('✅ 顺延账：写 / 剪枝 / 清；顺延不动三把缓冲');

  console.log('\n🎉 账号安全引擎离线冒烟全部通过');
})().catch(e => { console.error('❌ 冒烟失败:', e && e.message, '\n', e && e.stack); process.exit(1); });
