/* 桩测试：服务器搜索链（2026-10-23 确认单第 2、3、4 条）
 *   立链 → 约 10 分钟派下一类 → 回执推进 → 跑完/停手；停手原因 login/guard/quiet/offline/fail；
 *   手动停这一趟＝撤链不弹横幅；新的搜索/队列开始＝撤旧链；旧单晚到的回执不立链。
 * 跑法：node scripts/dev/test-exec-chain.mjs
 */
import assert from 'node:assert/strict';
import { createExecChannel } from '../../server/exec-channel.mjs';
import { createExecSched } from '../../server/exec-sched.mjs';

const REAL_NOW = Date.now;
let clock = new Date(2026, 9, 23, 15, 0, 0, 0).getTime();   // 15:00 · 不在静默期
Date.now = () => clock;

const store = {
  accounts: {
    a1: { id: 'a1', name: '测试号', phone: '13800000000', tier: '全功能', pairCode: 'XHD-TEST',
      bindings: { xhs: { uid: 'x1', displayId: 'xhs_1' } } },
  },
  sessions: { sess1: { accountId: 'a1', expiresAt: clock + 86400000 } },
};

function json(res, code, obj) { res.code = code; res.body = obj; }

const ch = createExecChannel({
  store,
  persist: async () => {},
  json,
  resolveAccount(req) {
    const m = /demo_session=([A-Za-z0-9]+)/.exec((req && req.headers && req.headers.cookie) || '');
    const s = m ? store.sessions[m[1]] : null;
    return s ? store.accounts[s.accountId] : null;
  },
  readEnv: () => ({}),
  clientIp: () => '127.0.0.1',
});

const sched = createExecSched({
  store,
  persist: async () => {},
  bookBagFor: () => ({}),
  placeOrder: ch.api.placeOrder,
  report: ch.api.report,
  online: ch.api.online,
  sweepStale: ch.api.sweepStale,
  stopChain: ch.api.stopChain,
  pruneChains: ch.api.pruneChains,
});
ch.api.attachSched(sched);

const webReq = { headers: { cookie: 'demo_session=sess1' }, on() {} };
async function call(path, body, req = webReq) {
  const res = {};
  const handled = await ch.handle(path, body, req, res);
  assert.equal(handled, true, '通道应该认得这个口：' + path);
  return res.body;
}
const advance = (ms) => { clock += ms; };
let cred = null;
function beat() { const h = store.exec_hands[cred.handId]; if (h) h.lastSeen = clock; }
async function orderSearch(kw = '测试词') {
  const r = await call('/api/exec/order', { kind: 'acquire', params: { op: 'search', kw } });
  assert.equal(r.ok, true, r.error || '下单应该成功');
  return r.cmdId;
}
async function ack(cmdId, detail, opts = {}) {
  return call('/api/exec/ack', {
    ...cred, cmdId,
    ok: opts.ok !== false,
    note: opts.note || '',
    needLogin: !!opts.needLogin,
    detail: JSON.stringify(detail || {}),
  });
}
const firstDetail = (o = {}) => ({
  kind: 'acquire', op: 'search', ok: true, kw: '测试词', found: 5,
  round: 'latest', roundName: '最新',
  remain: ['top', 'local', 'pain'], remainNames: ['TOP', '本地', '求助'],
  latestNotDue: false, dayTotal: 12,
  notes: [{ noteId: 'n1', title: 't1' }],
  ...o,
});
async function queuedOf() {
  return Object.values(store.exec_cmds).filter((c) => c.accountId === 'a1' && (c.state === 'queued' || c.state === 'sent'));
}
async function tick() {
  const r = await sched.tick();
  beat();   // 执行器每趟都会心跳
  return r;
}

try {
  /* 0) 挂线 */
  const pair = await call('/api/exec/pair', {
    code: 'XHD-TEST', label: '测试机', version: '1.3.5', caps: ['acquire', 'acquire:search'],
  });
  assert.equal(pair.ok, true, pair.error);
  cred = { handId: pair.handId, token: pair.token };
  beat();

  /* 1) 首轮回执 → 立链：后面还有 3 类，约 10 分钟后派 */
  {
    const cmdId = await orderSearch();
    const a = await ack(cmdId, firstDetail());
    assert.equal(a.ok, true);
    const chain = ch.api.chainOf('a1');
    assert.equal(chain.status, 'waiting');
    assert.equal(chain.round, 'latest');
    assert.equal(chain.found, 5);
    assert.equal(chain.dayTotal, 12);
    assert.deepEqual([...chain.remain], ['top', 'local', 'pain']);
    assert.deepEqual([...chain.remainNames], ['TOP', '本地', '求助']);
    assert.ok(Math.abs(chain.nextAt - (clock + 10 * 60 * 1000)) < 100, '约 10 分钟后派下一类');
    const view = await call('/api/exec/orders');
    assert.equal(view.ok, true);
    assert.equal(view.chain.status, 'waiting');
    console.log('✅ 1 首轮回执立链：今天 12 篇，后面 TOP / 本地 / 求助，10 分钟后派');
  }

  /* 2) 到点派下一类 TOP；派单那一刻才从 remain 取走（回执不重复删） */
  {
    const before = ch.api.chainOf('a1');
    advance(10 * 60 * 1000 + 1000);
    beat();
    const r = await tick();
    assert.ok(r.did.some((x) => /搜索链派下一类：TOP/.test(x)), '这一钩应该派 TOP：' + r.did.join('；'));
    const q = await queuedOf();
    assert.equal(q.length, 1);
    assert.equal(q[0].params.scenario, 'top');
    assert.equal(q[0].params.chainId, before.id);
    assert.equal(q[0].params.force, true);
    assert.equal(q[0].by, 'sched');
    const chain = ch.api.chainOf('a1');
    assert.equal(chain.status, 'running');
    assert.deepEqual([...chain.remain], ['local', 'pain'], '派出去就取走，回执不重复删');
    const a = await ack(q[0].id, {
      kind: 'acquire', op: 'search', ok: true, kw: '测试词', found: 3,
      round: 'top', roundName: 'TOP', remain: [], remainNames: [], dayTotal: 15,
      notes: [{ noteId: 'n2', title: 't2' }],
    });
    assert.equal(a.ok, true);
    const after = ch.api.chainOf('a1');
    assert.equal(after.status, 'waiting');
    assert.deepEqual([...after.remain], ['local', 'pain']);
    assert.equal(after.found, 8, '累计篇数');
    assert.equal(after.dayTotal, 15);
    assert.equal(after.round, 'top');
    assert.ok(after.nextAt > clock, '下一类重新等约 10 分钟');
    console.log('✅ 2 到点派 TOP → 回执推进：累计 8 篇，剩余 本地 / 求助');
  }

  /* 3) 下一类失败且要登录 → 链停手，原因 login；停了就不再派 */
  {
    const chain = ch.api.chainOf('a1');
    advance(10 * 60 * 1000 + 1000);
    beat();
    await tick();
    const q = await queuedOf();
    assert.equal(q.length, 1);
    assert.equal(q[0].params.scenario, 'local');
    await ack(q[0].id, null, { ok: false, note: '小红书登录过期了', needLogin: true });
    const stopped = ch.api.chainOf('a1');
    assert.equal(stopped.status, 'stopped');
    assert.equal(stopped.stopKind, 'login');
    assert.match(stopped.stopReason, /登录过期/);
    advance(10 * 60 * 1000);
    beat();
    await tick();
    assert.equal((await queuedOf()).length, 0, '停手后不该再派');
    assert.equal(ch.api.chainOf('a1').status, 'stopped');
    console.log('✅ 3 登录过期 → 链停手（login），不再派后面的类');
  }

  /* 4) 手动「停这一趟」＝撤链（网页据此不弹横幅） */
  {
    const cmdId = await orderSearch();
    await ack(cmdId, firstDetail());
    assert.ok(ch.api.chainOf('a1'));
    const s = await call('/api/exec/stop', {});
    assert.equal(s.ok, true);
    assert.equal(ch.api.chainOf('a1'), null, '手动停＝链直接撤掉，不弹横幅');
    assert.ok(store.exec_hands[cred.handId].stopAt > 0);
    console.log('✅ 4 手动停这一趟 → 撤链，不弹横幅');
  }

  /* 5) 新的搜索开始 → 撤旧链；旧单晚到的回执不立新链 */
  {
    const first = await orderSearch();
    await ack(first, firstDetail());
    const old = ch.api.chainOf('a1');
    assert.equal(old.status, 'waiting');
    const second = await orderSearch('另一个词');
    assert.equal(ch.api.chainOf('a1'), null, '新搜索一来，旧链撤掉');
    const late = await ack(first, firstDetail({ kw: '测试词', remain: ['top'] }));
    assert.equal(late.ok, true);
    assert.equal(ch.api.chainOf('a1'), null, '旧单晚到的回执不立链');
    await ack(second, firstDetail({ kw: '另一个词', remain: ['top'], remainNames: ['TOP'], found: 2 }));
    const chain = ch.api.chainOf('a1');
    assert.equal(chain.kw, '另一个词');
    assert.deepEqual([...chain.remain], ['top']);
    console.log('✅ 5 新搜索撤旧链；旧单晚到的回执不立链');
  }

  /* 6) 「最新」没到点：首轮跑的是 TOP，链上的轮次也记 TOP（网页据此写提示） */
  {
    const cmdId = await orderSearch();
    await ack(cmdId, firstDetail({
      round: 'top', roundName: 'TOP', latestNotDue: true,
      remain: ['local', 'pain'], remainNames: ['本地', '求助'],
    }));
    const chain = ch.api.chainOf('a1');
    assert.equal(chain.round, 'top');
    assert.equal(chain.roundName, 'TOP');
    console.log('✅ 6 最新没到点 → 链上轮次记 TOP，后面 本地 / 求助');
  }

  /* 7) 静默期：停手 quiet（网页弹橙条） */
  {
    const cmdId = await orderSearch();
    await ack(cmdId, firstDetail({ remain: ['top'], remainNames: ['TOP'] }));
    clock = new Date(2026, 9, 23, 22, 0, 0, 0).getTime();   // 22:00
    const r = await tick();
    const chain = ch.api.chainOf('a1');
    assert.equal(chain.status, 'stopped');
    assert.equal(chain.stopKind, 'quiet');
    assert.ok(r.did.some((x) => /静默期/.test(x)));
    console.log('✅ 7 静默期 → 链停手（quiet）');
  }

  /* 8) 断线超 24 小时：作废 offline */
  {
    clock = new Date(2026, 9, 24, 15, 0, 0, 0).getTime();
    beat();
    const cmdId = await orderSearch();
    await ack(cmdId, firstDetail({ remain: ['top'], remainNames: ['TOP'] }));
    store.exec_hands[cred.handId].lastSeen = clock - 25 * 3600000;
    await tick();
    const chain = ch.api.chainOf('a1');
    assert.equal(chain.status, 'stopped');
    assert.equal(chain.stopKind, 'offline');
    console.log('✅ 8 断线超 24 小时 → 链作废（offline）');
  }

  /* 9) 下一类回执带账号安全 → guard；带别的失败 → fail */
  {
    clock = new Date(2026, 9, 25, 15, 0, 0, 0).getTime();
    beat();
    const cmdId = await orderSearch();
    await ack(cmdId, firstDetail({ remain: ['top'], remainNames: ['TOP'] }));
    advance(10 * 60 * 1000 + 1000);
    beat();
    await tick();
    let q = await queuedOf();
    await ack(q[0].id, null, { ok: false, note: '🛡 账号安全挡下了，今天先顺延' });
    assert.equal(ch.api.chainOf('a1').stopKind, 'guard');

    const cmdId2 = await orderSearch();
    await ack(cmdId2, firstDetail({ remain: ['top'], remainNames: ['TOP'] }));
    advance(10 * 60 * 1000 + 1000);
    beat();
    await tick();
    q = await queuedOf();
    await ack(q[0].id, null, { ok: false, note: '页面打不开' });
    const chain = ch.api.chainOf('a1');
    assert.equal(chain.status, 'stopped');
    assert.equal(chain.stopKind, 'fail');
    console.log('✅ 9 账号安全 → guard；普通失败 → fail');
  }

  console.log('\n全部通过：9 组');
} finally {
  Date.now = REAL_NOW;
}
