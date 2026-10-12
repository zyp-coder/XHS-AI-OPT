/* 手机桥 · 云端中转（Cloudflare Worker）离线冒烟 —— 不用 wrangler、不用联网
   用法：node scripts/dev/_smoke_bridge_worker.mjs
   做法：把 KV 和静态资源（手机页）打两个桩，用 Node 的 Request/Response 直接打 relay/worker/index.mjs，
        走的是**跟线上同一份** relay/core.mjs。
   覆盖：手机页透传 / 配对 → 认领（一次性、过期）→ 推快照（鉴权）→ 取快照（24h 过期）→ 解绑 / CORS / 写 TTL */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ORIGIN = 'https://relay.example';

let failed = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('✅ ' + name + (extra ? '（' + extra + '）' : ''));
  else { failed++; console.log('❌ ' + name + (extra ? ' → ' + extra : '')); }
};

/* ───────── KV 桩：照着真 KV 的 API 来（get('json') / put 带 expirationTtl / delete / list 分页） ───────── */
function makeKV() {
  const map = new Map();          // key → { value: 字符串, ttl: number|undefined }
  const writes = [];              // 每次 put 记一笔，用来查写法和 TTL
  const kv = {
    async get(key, type) {
      const it = map.get(key);
      if (!it) return null;
      return type === 'json' ? JSON.parse(it.value) : it.value;
    },
    async put(key, value, opts) {
      const ttl = opts && opts.expirationTtl;
      /* 真 KV 的 deadline 小于 60 秒会直接报错：桩也这么干，免得线上才发现 */
      if (ttl != null && ttl < 60) throw new Error('expirationTtl 至少 60 秒（真 KV 的规矩）');
      map.set(key, { value: String(value), ttl });
      writes.push({ key, ttl });
    },
    async delete(key) { map.delete(key); },
    /* 现在没有路由用得到 list，但真 KV 有这个 API，照实实现，免得以后加了路由这条桩骗人 */
    async list({ prefix = '', cursor } = {}) {
      const all = [...map.keys()].filter((k) => k.startsWith(prefix)).sort();
      const from = cursor ? all.indexOf(cursor) : 0;
      const page = all.slice(from, from + 2);            // 一次只给两条：逼出分页循环
      const done = from + page.length >= all.length;
      return { keys: page.map((name) => ({ name })), list_complete: done, cursor: done ? undefined : page[page.length - 1] };
    },
  };
  return { kv, map, writes };
}

/* ───────── 静态资源桩：手机页由 Worker 一并托管（[assets] binding=ASSETS） ───────── */
const PAGES = new Map([
  ['/', '<!doctype html><title>手机看板</title><body>PHONE_PAGE</body>'],
  ['/index.html', '<!doctype html><title>手机看板</title><body>PHONE_PAGE</body>'],
]);
const assets = {
  async fetch(request) {
    const p = new URL(request.url).pathname;
    const html = PAGES.get(p);
    if (!html) return new Response('nope', { status: 404, headers: { 'Content-Type': 'text/plain' } });
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  },
};

const worker = (await import(pathToFileURL(path.join(ROOT, 'relay/worker/index.mjs')).href)).default;

const call = async (p, { method = 'GET', body, token } = {}) => {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const req = new Request(ORIGIN + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const res = await worker.fetch(req, { RELAY_KV: kvStub, ASSETS: assets });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, headers: res.headers, text, d: json };
};

const { kv: kvStub, map, writes } = makeKV();
const fresh = { deviceId: 'a'.repeat(32), token: 'b'.repeat(32) };

(async () => {
  /* 1) 健康检查：云版不带 lan（本机版才报「手机能直接开的地址」） */
  const h = await call('/health');
  ok('/health 通', h.status === 200 && h.d.ok === true, 'v' + h.d.ver);
  ok('云版 health 不带 lan', Array.isArray(h.d.lan) && h.d.lan.length === 0);
  ok('/health 带 CORS 头', h.headers.get('access-control-allow-origin') === '*');

  /* 2) 手机页：不是 /api/、不是 /health 的，全交给静态资源 */
  const page = await call('/');
  ok('根路径吐的就是手机页', page.status === 200 && page.text.includes('PHONE_PAGE'), page.status + ' ' + page.text.length + ' 字节');
  ok('没有的静态文件照样 404', (await call('/nope.html')).status === 404);
  ok('手机页不带缓存（改完立刻生效）', page.headers.get('cache-control') === 'no-store');

  /* 3) 预检和未知接口 */
  const opt = await worker.fetch(new Request(ORIGIN + '/api/push', { method: 'OPTIONS' }), { RELAY_KV: kvStub.kv, ASSETS: assets });
  ok('OPTIONS 预检放行（204 + CORS）', opt.status === 204 && opt.headers.get('access-control-allow-methods').includes('POST'));
  ok('未知 /api 路由 404', (await call('/api/nope')).status === 404);

  /* 4) 配对登记：参数校验 + 写 KV（配对码带 TTL，设备记录不带） */
  ok('配对参数不合法被拦', (await call('/api/pair/new', { method: 'POST', body: { deviceId: 'x' } })).status === 400);
  writes.length = 0;
  const pn = await call('/api/pair/new', { method: 'POST', body: { deviceId: fresh.deviceId, token: fresh.token, pairCode: 'ABCD2345', host: '这台电脑', ver: '3.15.7' } });
  ok('配对登记成功', pn.status === 200 && pn.d.ok === true);
  const codeWrite = writes.find((w) => w.key === 'pair:ABCD2345');
  const devWrite = writes.find((w) => w.key === 'dev:' + fresh.deviceId);
  ok('配对码进 KV 且 1 小时后自灭', !!codeWrite && codeWrite.ttl === 3600, codeWrite ? 'ttl=' + codeWrite.ttl : '没写这张键');
  ok('设备记录长期留着（手机令牌的比对靠它）', !!devWrite && devWrite.ttl == null);

  /* 5) 手机认领：一次性；过期的不给；重放拿不到 */
  const claim = await call('/api/pair/claim', { method: 'POST', body: { pairCode: 'abcd2345' } });   // 小写也该认
  ok('认领换到长期令牌', claim.status === 200 && claim.d.token === fresh.token && claim.d.deviceId === fresh.deviceId);
  ok('认领后配对码作废（重放 404）', (await call('/api/pair/claim', { method: 'POST', body: { pairCode: 'ABCD2345' } })).status === 404);

  await call('/api/pair/new', { method: 'POST', body: { deviceId: fresh.deviceId, token: fresh.token, pairCode: 'OLD12345', host: '这台电脑' } });
  map.set('pair:OLD12345', { value: JSON.stringify({ deviceId: fresh.deviceId, at: Date.now() - 11 * 60 * 1000 }), ttl: 3600 });  // 摆一个 11 分钟前的码
  const old = await call('/api/pair/claim', { method: 'POST', body: { pairCode: 'OLD12345' } });
  ok('超过 10 分钟的配对码不给（410）', old.status === 410 && old.d.error === 'expired', old.status + ' ' + old.d.error);

  /* 6) 推快照：令牌不对直接拒 */
  const SNAP = {
    at: Date.now(), app: '3.15.7',
    queue: { todo: 7, waiting: 4, done: 12, total: 19, carry: 1, current: '装修公司 · ⚡ 抢位', live: '第 2/5 篇 · 已发 1/3 条' },
    run: { running: true, auto: true },
    daily: { on: true, views: 58, comments: 5, replies: 2, follows: 3, dirs: [{ name: '装修', used: 12, quota: 20 }] },
    autorun: { on: true, from: '09:00', to: '22:00', hold: false, broken: false, inWindow: true },
    err: '',
  };
  ok('没带令牌的推送被拒（401）', (await call('/api/push', { method: 'POST', body: { deviceId: fresh.deviceId, snapshot: SNAP } })).status === 401);
  ok('令牌不对的推送被拒（401）', (await call('/api/push', { method: 'POST', body: { deviceId: fresh.deviceId, snapshot: SNAP }, token: 'c'.repeat(32) })).status === 401);
  const pu = await call('/api/push', { method: 'POST', body: { deviceId: fresh.deviceId, snapshot: SNAP, host: '办公室电脑', ver: '3.15.7' }, token: fresh.token });
  ok('正常推送 200', pu.status === 200 && pu.d.ok === true && typeof pu.d.at === 'number');

  /* 7) 手机取快照：字段原样、只回最后一份 */
  const sn = await call('/api/snap?d=' + fresh.deviceId, { token: fresh.token });
  ok('手机取回快照', sn.status === 200 && JSON.stringify(sn.d.snapshot) === JSON.stringify(SNAP));
  ok('顺带带出电脑名/版本/上报时刻', sn.d.host === '办公室电脑' && sn.d.ver === '3.15.7' && sn.d.at > 0);
  ok('取快照也要令牌（401）', (await call('/api/snap?d=' + fresh.deviceId, { token: 'c'.repeat(32) })).status === 401);

  /* 8) 24 小时没新推送 → 当作没有（手机看到"离线"），记录不删 */
  const devKey = 'dev:' + fresh.deviceId;
  const dev = JSON.parse(map.get(devKey).value);
  map.set(devKey, { value: JSON.stringify(Object.assign({}, dev, { lastPushAt: Date.now() - 25 * 60 * 60 * 1000 })), ttl: undefined });
  const stale = await call('/api/snap?d=' + fresh.deviceId, { token: fresh.token });
  ok('超过 24 小时 → 快照不给了（但记录还在）', stale.status === 200 && stale.d.snapshot === null && stale.d.at > 0 && map.has(devKey));

  /* 9) 解绑：手机立刻失效 */
  ok('解绑', (await call('/api/unbind', { method: 'POST', body: { deviceId: fresh.deviceId }, token: fresh.token })).status === 200);
  ok('解绑后手机取不到（401）', (await call('/api/snap?d=' + fresh.deviceId, { token: fresh.token })).status === 401);
  ok('解绑后设备记录删干净了', !map.has(devKey));

  if (failed) { console.log('\n❌ ' + failed + ' 条没过'); process.exit(1); }
  console.log('\n🎉 云端中转（Worker）离线冒烟全部通过');
})().catch((e) => { console.error('❌ 冒烟失败：' + e.message); if (process.env.DBG) console.error(e.stack); process.exit(1); });
