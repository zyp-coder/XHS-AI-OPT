/* 🛡 「手点开跑」一次性放行 离线冒烟（2026-10-26 老板定）：
   静默期 + 手点票 → 放行；静默期 + 无票 → 照挡；单休 + 手点票 → 放行、收票照挡；额度用完 + 手点票 → 照挡；
   顺手验：起床延迟 / 发布占线 / 干歇节拍 / 票过期 / 收回 / status 与 nextAllowedAt。
   用法：node scripts/dev/_smoke_guard_manual_once.js */
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

const G = require(path.resolve(__dirname, '../../extension/lib/account-guard.js'));

const mk = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); };
const TODAY = new Date().getDay();
const FAR = (TODAY + 3) % 7;

/* 把当天账本摆成可控的一份（波动 1、起床延迟 0、没用过） */
async function resetDaily(extra) {
  const d = await G.getDaily();
  store.guard_daily = Object.assign({
    date: d.date, wave: 1, wakeDelayMin: 0,
    used: { open: 0, like: 0, save: 0, comment: 0, follow: 0, dm: 0, post: 0 },
    beatH: -1, beatMin: 0, beatLast: -1,
  }, extra || {});
  store.np_pub_guard = { leadUntil: 0, busySince: 0, postUntil: 0 };
}

(async () => {
  await G.saveCfg({ level: '保守', restDay: FAR });
  await resetDaily();

  // 1) 静默期 + 无票 → 照挡
  assert.strictEqual((await G.blockAllReason(mk(23, 0))).code, 'quiet', '无票静默期照挡');
  const a1 = await G.decide('open', 1, mk(23, 0));
  assert.strictEqual(a1.ok, false, '无票 decide 挡');
  assert.strictEqual(a1.code, 'quiet', '原因＝quiet');
  console.log('✅ 静默期 + 没票：照样挡（原因 quiet）');

  // 2) 静默期 + 手点票 → 放行（只这一趟）
  const rec = await G.openOnce({ minutes: 180, reason: '手点开跑' }, mk(23, 0));
  assert.ok(rec.until - rec.at === 180 * 60000, '票有效期 180 分钟');
  assert.strictEqual(await G.blockAllReason(mk(23, 0)), null, '有票时墙不挡');
  const a2 = await G.decide('open', 1, mk(23, 0));
  assert.strictEqual(a2.ok, true, '有票 decide 放行');
  const spendOk = await G.spend('open', 1, mk(23, 0));
  assert.strictEqual(spendOk.ok, true, '有票 spend 记账成功');
  assert.strictEqual(store.guard_daily.used.open, 1, '账本照记（放行不等于不记账）');
  console.log('✅ 静默期 + 手点票：放行，且照常记账');

  // 3) 票过期 → 回到照挡
  await G.openOnce({ minutes: 1 }, mk(23, 0));
  assert.strictEqual((await G.blockAllReason(mk(23, 2))).code, 'quiet', '票过期 2 分钟 → 照挡');
  await G.openOnce({ minutes: 9999 }, mk(23, 0));
  assert.strictEqual(store.guard_once.until - store.guard_once.at, 180 * 60000, '票最长夹到 180 分钟');
  console.log('✅ 票过期自动作废；最长 180 分钟');

  // 4) 收回（这一趟跑完）→ 照挡
  await G.clearOnce();
  assert.strictEqual(await G.getOnce(mk(23, 0)), null, '收回后没票');
  assert.strictEqual((await G.blockAllReason(mk(23, 0))).code, 'quiet', '收回后静默期照挡');
  console.log('✅ 收回票：下一轮/自动跑照旧挡');

  // 5) 起床延迟：09:00 后随机等 0~40 分钟，手点票也给放
  await resetDaily({ wakeDelayMin: 40 });
  assert.strictEqual((await G.blockAllReason(mk(9, 10))).code, 'quiet', '无票：还没到起床时间');
  await G.openOnce({ minutes: 30 }, mk(9, 10));
  assert.strictEqual((await G.blockAllReason(mk(9, 10))), null, '有票：起床延迟不挡');
  await G.clearOnce();
  // 09:45 已过起床时间：没票也放（确认放宽没把正常路径弄坏）
  assert.strictEqual((await G.blockAllReason(mk(9, 45))), null, '过了起床时间本来就能跑');
  console.log('✅ 起床延迟：有票放 / 无票挡 / 过了起床时间照旧能跑');

  // 6) 单休：手点票 → 放行；没票 → 照挡一整天
  await resetDaily();
  await G.saveCfg({ restDay: TODAY });
  await G.openOnce({ minutes: 180 }, mk(10, 0));
  const a6 = await G.decide('open', 1, mk(10, 0));
  assert.strictEqual(a6.ok, true, '单休日手点也放行（老板定的：手点说要跑就跑）');
  assert.strictEqual(await G.blockAllReason(mk(10, 0)), null, 'blockAllReason 有票不挡');
  await G.clearOnce();
  const a6b = await G.decide('open', 1, mk(10, 0));
  assert.strictEqual(a6b.ok, false, '票一收，单休日照挡');
  assert.strictEqual(a6b.code, 'rest', '原因＝rest');
  console.log('✅ 单休：有票放 / 收票照挡（rest）');

  // 7) 额度用完 + 手点票 → 照挡
  await G.saveCfg({ restDay: FAR });
  await resetDaily({ used: { open: 60, like: 0, save: 0, comment: 0, follow: 0, dm: 0, post: 0 } });
  await G.openOnce({ minutes: 180 }, mk(10, 0));
  const a7 = await G.decide('open', 1, mk(10, 0));
  assert.strictEqual(a7.ok, false, '额度用完有票也挡');
  assert.strictEqual(a7.code, 'cap', '原因＝cap');
  console.log('✅ 额度用完 + 手点票：照挡（cap）');

  // 8) 干歇节拍 + 手点票 → 照挡
  await resetDaily({ beatH: 10, beatMin: 30, beatLast: mk(10, 0) });
  await G.openOnce({ minutes: 180 }, mk(10, 20));
  const a8 = await G.decide('open', 1, mk(10, 20));
  assert.strictEqual(a8.ok, false, '干歇节拍到顶有票也挡');
  assert.strictEqual(a8.code, 'burst', '原因＝burst');
  console.log('✅ 干歇节拍 + 手点票：照挡（burst）');

  // 9) 发布占线 / 发布后缓冲 + 手点票 → 照挡
  await resetDaily();
  store.np_pub_guard = { leadUntil: 0, busySince: mk(10, 0) - 60000, postUntil: 0 };
  await G.openOnce({ minutes: 180 }, mk(10, 0));
  assert.strictEqual((await G.decide('open', 1, mk(10, 0))).code, 'hold', '发布占线有票也挡');
  store.np_pub_guard = { leadUntil: 0, busySince: 0, postUntil: mk(10, 30) };
  assert.strictEqual((await G.decide('open', 1, mk(10, 0))).code, 'hold', '发布后缓冲有票也挡');
  store.np_pub_guard = { leadUntil: 0, busySince: 0, postUntil: 0 };
  console.log('✅ 发布占线 / 发布后缓冲 + 手点票：照挡（hold）');

  // 10) 发布链自查（decideSelf）：静默期有票 → 放；没票 → 挡
  await resetDaily();
  await G.openOnce({ minutes: 60 }, mk(23, 0));
  assert.strictEqual((await G.decideSelf('post', 1, mk(23, 0))).ok, true, '发笔记：有票夜里能发');
  await G.clearOnce();
  assert.strictEqual((await G.decideSelf('post', 1, mk(23, 0))).code, 'quiet', '没票夜里照挡');
  console.log('✅ 发笔记（decideSelf）：有票放 / 没票挡');

  // 11) status / nextAllowedAt 跟着票走
  await resetDaily();
  const s0 = await G.status(mk(23, 0));
  assert.strictEqual(s0.once, null, '没票时 status.once 为空');
  assert.strictEqual(s0.blocked.code, 'quiet', '没票时 status 报静默');
  await G.openOnce({ minutes: 60, reason: '手点开跑' }, mk(23, 0));
  const s1 = await G.status(mk(23, 0));
  assert.ok(s1.once && s1.once.until > mk(23, 0), '有票时 status.once 带着到期时刻');
  assert.strictEqual(s1.once.reason, '手点开跑', '票上写了理由');
  assert.strictEqual(s1.blocked, null, '有票时 status 不再报墙');
  assert.strictEqual(await G.nextAllowedAt('open', mk(23, 0)), null, '有票时「现在就能动」');
  await G.clearOnce();
  assert.ok((await G.nextAllowedAt('open', mk(23, 0))).at > mk(23, 0), '没票时顺延到明早');
  console.log('✅ status / nextAllowedAt：票在就放、票收了就顺延');

  console.log('\n🎉 「手点开跑」放行冒烟全部通过');
})().catch(e => { console.error('❌ 冒烟失败:', e && e.message, '\n', e && e.stack); process.exit(1); });
