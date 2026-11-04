/* 桩测试：获客按平台派单 / 分平台暂停（2026-10-25）
 *   队列配置勾了哪个平台，获客单就带哪几个平台；某一头暂停或没认号 → 只跳过那一头，
 *   另一头照跑（skipPlats 交给执行器）；全跳过才不派。老快照没写 plats ＝ 只投小红书。
 *   顺带核：日常浏览仍只认小红书格的暂停；发笔记的暂停口径没变。
 * 跑法：node scripts/dev/test-exec-platform.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createExecChannel } from '../../server/exec-channel.mjs';
import { createExecSched } from '../../server/exec-sched.mjs';

/* 服务器有「版本闸」：执行器版本必须等于发出去的包。桩里照抄那个版本号，
   免得包里换了一版这条测试就整片红（那闸本身另有测试管）。 */
const HAND_VER = (() => {
  try { return readFileSync(new URL('../../web/download/executor.version', import.meta.url), 'utf8').trim(); }
  catch (_) { return '1.3.5'; }
})();

const REAL_NOW = Date.now;
let clock = new Date(2026, 9, 25, 15, 0, 0, 0).getTime();   // 15:00 · 不在静默期
Date.now = () => clock;

const store = {
  accounts: {
    a1: {
      id: 'a1', name: '测试号', phone: '13800000000', tier: '全平台', pairCode: 'XHD-TEST',
      bindings: { xhs: { uid: 'x1', displayId: 'xhs_1' }, douyin: { uid: 'd1', displayId: 'dy_1' } },
    },
  },
  sessions: { sess1: { accountId: 'a1', expiresAt: clock + 86400000 } },
};
const acc = store.accounts.a1;

function json(res, code, obj) { res.code = code; res.body = obj; }
let bag = {};

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
  bookBagFor: () => bag,
});

const sched = createExecSched({
  store,
  persist: async () => {},
  bookBagFor: () => bag,
  placeOrder: ch.api.placeOrder,
  report: ch.api.report,
  online: ch.api.online,
  sweepStale: ch.api.sweepStale,
  stopChain: ch.api.stopChain,
  pruneChains: ch.api.pruneChains,
  platformPauseOf: ch.api.platformPauseOf,
});
ch.api.attachSched(sched);

const webReq = { headers: { cookie: 'demo_session=sess1' }, on() {} };
async function call(path, params, req = webReq) {
  const res = {};
  const handled = await ch.handle(path, params, req, res);
  assert.equal(handled, true, '通道应该认得这个口：' + path);
  return res.body;
}
const beat = () => { const h = store.exec_hands[cred.handId]; if (h) h.lastSeen = clock; };
let cred = null;
const snap = (plats) => ({ drain_scan_cfg: plats ? { keywords: [], plats } : { keywords: [] } });
const acquire = (plats) => call('/api/exec/order', {
  kind: 'acquire', params: { op: 'round', scope: 'all', pace: 'once', snapshot: snap(plats) },
});
const queuedOf = (kind) => Object.values(store.exec_cmds)
  .filter((c) => c.accountId === 'a1' && (!kind || c.kind === kind) && (c.state === 'queued' || c.state === 'sent'));
async function ackAll(detail = { kind: 'acquire', op: 'round', ok: true }) {
  for (const c of queuedOf()) {
    await call('/api/exec/ack', { ...cred, cmdId: c.id, ok: true, note: '', detail: JSON.stringify(detail) });
  }
  assert.equal(queuedOf().length, 0, '回执后不该还有在飞的单');
}
const pause = async (platform, paused) => {
  const r = await ch.api.setPlatformPause(acc, platform, paused, 'test');
  assert.equal(r.ok, true, r.error);
};

try {
  /* 0) 挂线：三个平台 / 三种活都会 */
  {
    const pair = await call('/api/exec/pair', {
      code: 'XHD-TEST', label: '测试机', version: HAND_VER,
      caps: ['acquire', 'acquire:search', 'acquire:dy', 'daily_browse', 'note_publish'],
    });
    assert.equal(pair.ok, true, pair.error);
    cred = { handId: pair.handId, token: pair.token };
    beat();
    console.log('✅ 0 挂线');
  }

  /* 1) 两个平台都勾、都没暂停 → 获客单照派，不带 skipPlats */
  {
    const r = await acquire({ xhs: true, dy: true });
    assert.equal(r.ok, true, r.error);
    const cmd = store.exec_cmds[r.cmdId];
    assert.equal(cmd.params.skipPlats, undefined, '没暂停就不该有 skipPlats');
    await ackAll();
    console.log('✅ 1 双平台都勾、没暂停：照派、不跳过');
  }

  /* 2) 抖音格暂停 → 获客单只跳过抖音，小红书照跑 */
  {
    await pause('douyin', true);
    const r = await acquire({ xhs: true, dy: true });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(store.exec_cmds[r.cmdId].params.skipPlats, ['dy']);
    await ackAll();
    console.log('✅ 2 抖音暂停：获客单照派，skipPlats=[dy]（小红书照跑）');
  }

  /* 3) 两头都暂停 → 不派（带 paused 标记，排期据此不记失败） */
  {
    await pause('xhs', true);
    const r = await acquire({ xhs: true, dy: true });
    assert.equal(r.ok, false);
    assert.equal(r.paused, true);
    assert.match(r.error, /暂停/);
    console.log('✅ 3 两头都暂停：不派、标 paused');
  }

  /* 4) 只勾抖音、抖音格暂停 → 目标只有抖音，也不派 */
  {
    const r = await acquire({ xhs: false, dy: true });
    assert.equal(r.ok, false);
    assert.equal(r.paused, true);
    console.log('✅ 4 只投抖音且抖音暂停：不派');
  }

  await pause('xhs', false);
  await pause('douyin', false);

  /* 5) 抖音没认号 → 只跳过抖音；只投抖音时则拒派并让去认号 */
  {
    const keep = acc.bindings.douyin;
    delete acc.bindings.douyin;
    const r = await acquire({ xhs: true, dy: true });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(store.exec_cmds[r.cmdId].params.skipPlats, ['dy']);
    await ackAll();
    const r2 = await acquire({ xhs: false, dy: true });
    assert.equal(r2.ok, false);
    assert.match(r2.error, /认一下抖音/);
    acc.bindings.douyin = keep;
    console.log('✅ 5 抖音没认号：双平台只跳过抖音；只投抖音则拒派并提示认号');
  }

  /* 6) 老快照没写 plats → 只投小红书：抖音暂停不影响，小红书暂停才不派 */
  {
    await pause('douyin', true);
    const r = await acquire(null);
    assert.equal(r.ok, true, r.error);
    assert.equal(store.exec_cmds[r.cmdId].params.skipPlats, undefined);
    await ackAll();
    await pause('douyin', false);
    await pause('xhs', true);
    const r2 = await acquire(null);
    assert.equal(r2.paused, true);
    await pause('xhs', false);
    console.log('✅ 6 老配置（没写 plats）：只投小红书，暂停口径跟升级前一样');
  }

  /* 7) 日常浏览只认小红书格；发笔记的暂停口径没变（抖音暂停只剔抖音） */
  {
    await pause('douyin', true);
    const d = await call('/api/exec/order', { kind: 'daily_browse', params: { snapshot: {}, scope: 'all' } });
    assert.equal(d.ok, true, d.error);
    await ackAll({ kind: 'daily_browse', ok: true });
    const p = await call('/api/exec/order', {
      kind: 'note_publish',
      params: {
        note: { id: 'n1', form: '图文', title: 't' },
        platform: 'xhs', platforms: [{ platform: 'xhs' }, { platform: 'douyin' }], files: [],
      },
    });
    assert.equal(p.ok, true, p.error);
    assert.deepEqual(store.exec_cmds[p.cmdId].params.platforms.map((x) => x.platform), ['xhs']);
    await ackAll({ kind: 'note_publish', ok: true });
    await pause('douyin', false);
    console.log('✅ 7 日常浏览不受抖音暂停影响；发笔记只剔掉抖音');
  }

  /* 8) 排期自动跑：一头暂停照派（带 skipPlats），全暂停整趟不派 */
  {
    bag = { drain_scan_cfg: { keywords: [], plats: { xhs: true, dy: true }, queueAuto: { enabled: true, days: [], from: '09:00', to: '09:00' } } };
    await pause('douyin', true);
    let r = await sched.tick();
    assert.ok(r.did.some((x) => /队列自动跑派单/.test(x)), '一头暂停时应该照派：' + r.did.join('；'));
    const q = queuedOf('acquire');
    assert.equal(q.length, 1);
    assert.deepEqual(q[0].params.skipPlats, ['dy']);
    await ackAll();
    await pause('xhs', true);
    store.exec_sched.auto = {};   // 清趟数帽，让这一钩真的会去看
    r = await sched.tick();
    assert.ok(!r.did.some((x) => /队列自动跑派单/.test(x)), '全暂停不该派：' + r.did.join('；'));
    assert.equal(queuedOf('acquire').length, 0);
    await pause('xhs', false);
    await pause('douyin', false);
    console.log('✅ 8 排期自动跑：一头暂停照派并跳过那头，全暂停整趟不派');
  }

  /* 9) 老包不会抖音（没报 acquire:dy）：要投抖音的单直接拒派、提示升级；抖音被跳过时照派 */
  {
    const old = await call('/api/exec/pair', {
      code: 'XHD-TEST', label: '老包', version: HAND_VER,
      caps: ['acquire', 'acquire:search', 'daily_browse', 'note_publish'],
    });
    assert.equal(old.ok, true, old.error);
    cred = { handId: old.handId, token: old.token };
    beat();
    const r = await acquire({ xhs: true, dy: true });
    assert.equal(r.ok, false);
    assert.match(r.error, /版本太旧/);
    assert.equal(queuedOf('acquire').length, 0, '不会抖音就不该把单派下去');
    await pause('douyin', true);
    const r2 = await acquire({ xhs: true, dy: true });
    assert.equal(r2.ok, true, r2.error);
    assert.deepEqual(store.exec_cmds[r2.cmdId].params.skipPlats, ['dy']);
    await ackAll();
    await pause('douyin', false);
    console.log('✅ 9 老包不会抖音：要投抖音直接拒派提示升级；抖音那头跳过时照派');
  }

  /* 10) 前三档（没「全平台」）只做小红书：发笔记剔掉抖音/视频号、只发这两家则拒派；
         获客把抖音塞进 skipPlats、只投抖音则拒派。恢复全平台后一路放行。 */
  {
    acc.tier = '全功能';
    const p = await call('/api/exec/order', {
      kind: 'note_publish',
      params: {
        note: { id: 'n2', form: '图文', title: 't2' },
        platform: 'xhs', platforms: [{ platform: 'xhs' }, { platform: 'douyin' }, { platform: 'channels' }], files: [],
      },
    });
    assert.equal(p.ok, true, p.error);
    assert.deepEqual(store.exec_cmds[p.cmdId].params.platforms.map((x) => x.platform), ['xhs']);
    await ackAll({ kind: 'note_publish', ok: true });

    const p2 = await call('/api/exec/order', {
      kind: 'note_publish',
      params: { note: { id: 'n3', form: '图文', title: 't3' }, platform: 'douyin', platforms: [{ platform: 'douyin' }], files: [] },
    });
    assert.equal(p2.ok, false);
    assert.match(p2.error, /全平台版/);

    const a1 = await acquire({ xhs: true, dy: true });
    assert.equal(a1.ok, true, a1.error);
    assert.deepEqual(store.exec_cmds[a1.cmdId].params.skipPlats, ['dy']);
    await ackAll();

    const a2 = await acquire({ xhs: false, dy: true });
    assert.equal(a2.ok, false);
    assert.equal(a2.paused, undefined, '不该被当成暂停');
    assert.match(a2.error, /全平台版/);
    assert.equal(queuedOf('acquire').length, 0, '这档不该把抖音获客派下去');

    acc.tier = '全平台';
    console.log('✅ 10 前三档只做小红书：发笔记剔抖音/视频号、只发这两家拒派；获客跳过抖音、只投抖音拒派');
  }

  console.log('\n全部通过');
} finally {
  Date.now = REAL_NOW;
}
