/* 手机看板 · 中转离线冒烟：配对 / 认领 / 推送 / 读取 / 解绑 / 过期 全流程
   用法：node scripts/dev/_smoke_bridge_relay.mjs
   说明：直接用内存存储打核心逻辑（不起 HTTP），HTTP 与手机页另跑 relay/local/server.mjs 手测。*/
import assert from 'node:assert';
import { handle, sweep, RELAY_TTLS } from '../../relay/core.mjs';

/* 内存存储 */
function memStore() {
  const kv = new Map();
  return {
    kv,
    async get(k) { return kv.has(k) ? kv.get(k) : null; },
    async put(k, v) { kv.set(k, v); },
    async del(k) { kv.delete(k); },
    async list(prefix) { return [...kv.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value })); },
  };
}
const call = (store, req, now) => handle({ query: {}, headers: {}, body: {}, ...req }, store, now ? { now } : undefined);

const DEV = 'a'.repeat(32);
const TOK = 'b'.repeat(32);
const CODE = 'K7M2QP4X';

(async () => {
  const store = memStore();
  const t0 = 1758000000000;

  // 0) 体检
  let r = await call(store, { method: 'GET', path: '/health' }, t0);
  assert.strictEqual(r.status, 200, 'health 200');
  let h = JSON.parse(r.body);
  assert.strictEqual(h.ok, true, 'health ok');
  assert.ok(h.ver, 'health 带版本号');
  assert.deepStrictEqual(h.lan, [], '云版不带局域网地址');
  r = await handle({ method: 'GET', path: '/health', query: {}, headers: {}, body: {} }, store, { lan: ['http://192.168.1.23:8788'] });
  assert.deepStrictEqual(JSON.parse(r.body).lan, ['http://192.168.1.23:8788'], '本地版把手机能开的地址带回来（二维码画它）');
  console.log('✅ 体检：版本号 + 本地版带出局域网地址');

  // 1) 参数不合法一律拦下（deviceId/token/配对码都要 [a-z0-9]{8,64}）
  r = await call(store, { method: 'POST', path: '/api/pair/new', body: { deviceId: '短', token: TOK, pairCode: CODE } }, t0);
  assert.strictEqual(r.status, 400, '非法 deviceId 被拦');
  r = await call(store, { method: 'POST', path: '/api/pair/new', body: { deviceId: DEV, token: TOK, pairCode: '有中文' } }, t0);
  assert.strictEqual(r.status, 400, '非法配对码被拦');
  console.log('✅ 参数校验：非法 deviceId / 配对码 → 400');

  // 2) 电脑登记配对
  r = await call(store, { method: 'POST', path: '/api/pair/new', body: { deviceId: DEV, token: TOK, pairCode: CODE, host: '办公室的电脑' } }, t0);
  assert.strictEqual(r.status, 200, 'pair/new 200');
  console.log('✅ 电脑登记配对码（10 分钟内有效）');

  // 3) 手机认领：换到长期令牌，且只能换一次
  r = await call(store, { method: 'POST', path: '/api/pair/claim', body: { pairCode: CODE.toLowerCase() } }, t0 + 1000);
  assert.strictEqual(r.status, 200, 'claim 200');
  let d = JSON.parse(r.body);
  assert.strictEqual(d.deviceId, DEV, '换回 deviceId');
  assert.strictEqual(d.token, TOK, '换回 token');
  assert.strictEqual(d.host, '办公室的电脑', '带出电脑名');
  r = await call(store, { method: 'POST', path: '/api/pair/claim', body: { pairCode: CODE } }, t0 + 2000);
  assert.strictEqual(r.status, 404, '配对码一次性，重放拿不到');
  console.log('✅ 认领：换到令牌；同一个码再用 → 404（一次性）');

  // 4) 过期码不认（10 分钟）
  await call(store, { method: 'POST', path: '/api/pair/new', body: { deviceId: DEV, token: TOK, pairCode: 'OLDCODE1' } }, t0);
  r = await call(store, { method: 'POST', path: '/api/pair/claim', body: { pairCode: 'OLDCODE1' } }, t0 + RELAY_TTLS.PAIR_TTL_MS + 1);
  assert.strictEqual(r.status, 410, '过期码 → 410');
  console.log('✅ 配对码 10 分钟过期 → 410');

  // 5) 推送：令牌不对一律 401
  const snap = { run: { running: true, auto: true }, queue: { todo: 7, done: 12, total: 22, current: '关键词格 · 装修公司' }, daily: { on: true, views: 58 } };
  r = await call(store, { method: 'POST', path: '/api/push', headers: { authorization: 'Bearer wrong' }, body: { deviceId: DEV, snapshot: snap } }, t0 + 3000);
  assert.strictEqual(r.status, 401, '错令牌 → 401');
  r = await call(store, { method: 'POST', path: '/api/push', headers: { authorization: 'Bearer ' + TOK }, body: { deviceId: DEV, snapshot: snap, host: '办公室的电脑', ver: '3.15.7' } }, t0 + 3000);
  assert.strictEqual(r.status, 200, 'push 200');
  console.log('✅ 推送：错令牌 401；对令牌 200');

  // 6) 手机读：拿得到刚推的那一份
  r = await call(store, { method: 'GET', path: '/api/snap', query: { d: DEV }, headers: { authorization: 'Bearer ' + TOK } }, t0 + 4000);
  assert.strictEqual(r.status, 200, 'snap 200');
  d = JSON.parse(r.body);
  assert.deepStrictEqual(d.snapshot, snap, '快照原样取回');
  assert.strictEqual(d.at, t0 + 3000, '带出上报时刻');
  assert.strictEqual(d.host, '办公室的电脑', '带出电脑名');
  assert.strictEqual(d.ver, '3.15.7', '带出主包版本');
  const before = d.at;
  r = await call(store, { method: 'GET', path: '/api/snap', query: { d: DEV }, headers: { authorization: 'Bearer wrong' } }, t0 + 4000);
  assert.strictEqual(r.status, 401, '手机侧错令牌 → 401');
  console.log('✅ 读取：快照 + 上报时刻 + 电脑名/版本都带回来（错令牌 401）');

  // 7) 24 小时没推送 → 快照不再下发（记录还在，手机看到的是"离线"）
  //    注意要从「最后一次推送时刻」往后算满 24 小时
  r = await call(store, { method: 'GET', path: '/api/snap', query: { d: DEV }, headers: { authorization: 'Bearer ' + TOK } }, t0 + 3000 + RELAY_TTLS.SNAP_TTL_MS + 1);
  d = JSON.parse(r.body);
  assert.strictEqual(d.snapshot, null, '超过 24 小时 → snapshot 置空');
  assert.strictEqual(d.at, before, '上报时刻留着（手机据此显示"最后一次上报"）');
  console.log('✅ 快照保留 24 小时，之后只留"最后一次上报"时间');

  // 8) 解绑：手机的令牌立刻失效
  r = await call(store, { method: 'POST', path: '/api/unbind', headers: { authorization: 'Bearer ' + TOK }, body: { deviceId: DEV } }, t0 + 5000);
  assert.strictEqual(r.status, 200, 'unbind 200');
  r = await call(store, { method: 'GET', path: '/api/snap', query: { d: DEV }, headers: { authorization: 'Bearer ' + TOK } }, t0 + 6000);
  assert.strictEqual(r.status, 401, '解绑后手机 → 401');
  console.log('✅ 解绑：设备记录删掉，手机立刻 401');

  // 9) 清过期配对码
  const s2 = memStore();
  await call(s2, { method: 'POST', path: '/api/pair/new', body: { deviceId: DEV, token: TOK, pairCode: 'OLDCODE1' } }, t0);
  await call(s2, { method: 'POST', path: '/api/pair/new', body: { deviceId: 'c'.repeat(32), token: TOK, pairCode: 'NEWCODE1' } }, t0 + RELAY_TTLS.PAIR_TTL_MS + 1);
  const n = await sweep(s2, { now: t0 + RELAY_TTLS.PAIR_TTL_MS + 2 });
  assert.strictEqual(n, 1, '只清掉过期那一个');
  assert.strictEqual(await s2.get('pair:OLDCODE1'), null, '过期码已清');
  assert.ok(await s2.get('pair:NEWCODE1'), '没过期的留着');
  console.log('✅ 清过期配对码：过期的清掉、没过期的留着');

  console.log('\n🎉 中转离线冒烟全部通过');
})().catch(e => { console.error('❌ 冒烟失败:', e.message); process.exit(1); });
