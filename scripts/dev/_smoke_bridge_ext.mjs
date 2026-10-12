/* 手机桥 · 离线冒烟（不开浏览器也能测：把 chrome.* 打桩，让 bridge/background.js 真跑一遍）
   用法：node relay/local/server.mjs      （另开窗口，得有个真中转）
         node scripts/dev/_smoke_bridge_ext.mjs
   两块：
     A. 字段契约：主包发出去的字段、手机页读的字段、这里造的快照，三边必须对得上
        （对不上就是手机上一串 "—"，谁都不会报错，所以必须靠这条挡住）
     B. 桥的真跑：配对 → 认领 → 每分钟上报 → 手机取回 → 解绑，全打真中转的 HTTP
     C. 节流：内容没变、或者变了但离上次不到 100 秒 → 不推（省云上 KV 的写额度）
   说明：假主扩展只回一份快照，字段表在 FIXTURE；换字段先过 A 那块。 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '../..');
const BRIDGE = path.join(ROOT, 'bridge');
const RELAY = (process.argv[2] || 'http://127.0.0.1:8788').replace(/\/+$/, '');

let failed = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('✅ ' + name + (extra ? '（' + extra + '）' : ''));
  else { failed++; console.log('❌ ' + name + (extra ? ' → ' + extra : '')); }
};

/* 假主扩展回的那一份（＝主包 bridgeSnapshot() 的形状） */
const FIXTURE = {
  at: Date.now(), app: '3.15.7',
  queue: { todo: 7, waiting: 4, done: 12, total: 19, carry: 1, current: '装修公司 · ⚡ 抢位', live: '第 2/5 篇 · 已发 1/3 条' },
  run: { running: true, auto: true },
  daily: { on: true, views: 58, comments: 5, replies: 2, follows: 3, dirs: [{ name: '装修', used: 12, quota: 20 }] },
  autorun: { on: true, from: '09:00', to: '22:00', hold: false, broken: false, inWindow: true },
  err: '',
};

/* ───────── A. 字段契约 ───────── */
const mainSrc = readFileSync(path.join(ROOT, 'extension/background.js'), 'utf8');
const phoneSrc = readFileSync(path.join(ROOT, 'relay/phone/index.html'), 'utf8');

/* 从主包 bridgeSnapshot() 里抠出 out.queue / out.run / out.daily / out.autorun 各发了哪些键。
   只认「第一层」的键（值里嵌套的对象/数组不算），多发的键一个都不能有——那是隐私红线。 */
const fnBody = ((mainSrc.match(/async function bridgeSnapshot\(\)\s*\{([\s\S]*?)\n\}/) || [])[1]) || '';
ok('能找到主包的 bridgeSnapshot()', fnBody.length > 200, fnBody.length + ' 字符');

function emittedKeys(section) {
  const m = fnBody.match(new RegExp('out\\.' + section + '\\s*=\\s*\\{'));
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1, paren = 0, keys = new Set(), atKey = true;
  while (i < fnBody.length && depth > 0) {
    if (atKey && depth === 1) {
      const id = /^\s*([A-Za-z_]\w*)\s*:/.exec(fnBody.slice(i, i + 80));
      if (id) { keys.add(id[1]); i += id[0].length; atKey = false; continue; }
    }
    const c = fnBody[i];
    if (c === '{') { depth++; atKey = true; }
    else if (c === '}') depth--;
    else if (c === '(') paren++;
    else if (c === ')') paren = Math.max(0, paren - 1);
    else if (c === ',' && depth === 1 && paren === 0) atKey = true;
    i++;
  }
  return [...keys].sort();
}
const expect = (name, got, want) => ok('主包发的 ' + name + ' 字段：' + want.join('/'), got && got.join(',') === want.join(','), got ? got.join(',') : '没找到 out.' + name);

const topKeys = ['at', 'app', 'queue', 'run', 'daily', 'autorun', 'err'];
ok('顶层字段：' + topKeys.join('/'), topKeys.every(k => new RegExp('[{\\s]' + k + '\\s*:').test(fnBody.slice(0, 600))));

expect('queue', emittedKeys('queue'), ['carry', 'current', 'done', 'live', 'todo', 'total', 'waiting']);
expect('run', emittedKeys('run'), ['auto', 'running']);
expect('daily', emittedKeys('daily'), ['comments', 'dirs', 'follows', 'on', 'replies', 'views']);
expect('autorun', emittedKeys('autorun'), ['broken', 'from', 'hold', 'inWindow', 'on', 'to']);

/* 手机页读的字段（snap.* / q.* / run.* / day.* / au.*），必须都在上面这些键里 */
const wantRead = (re) => [...new Set([...phoneSrc.matchAll(re)].map(m => m[1]))].sort();
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const qRead = wantRead(/\bq\.(\w+)/g);
const dayRead = wantRead(/\bday\.(\w+)/g);
const runRead = wantRead(/\brun\.(\w+)/g);
const auRead = wantRead(/\bau\.(\w+)/g);
const snapRead = wantRead(/\bsnap\.(\w+)/g);
const missing = [
  ...qRead.filter(k => !has(FIXTURE.queue, k)).map(k => 'queue.' + k),
  ...dayRead.filter(k => !has(FIXTURE.daily, k)).map(k => 'daily.' + k),
  ...runRead.filter(k => !has(FIXTURE.run, k)).map(k => 'run.' + k),
  ...auRead.filter(k => !has(FIXTURE.autorun, k)).map(k => 'autorun.' + k),
  ...snapRead.filter(k => !topKeys.includes(k)).map(k => k),
];
ok('手机页读的字段这边都有', missing.length === 0, missing.join(', '));

/* ───────── B. 桥的真跑 ───────── */
/* 手填兜底用的 ID：格式合法（32 位 a–p）、且会在 sendMessage 里回话 */
const MANUAL_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

/* chrome.* 打桩：storage.local / alarms / management / runtime.onMessage / sendMessage(给假主扩展) */
function makeChrome() {
  const store = new Map();
  const listeners = { message: [], alarm: [] };
  const alarms = new Map();
  const chrome = {
    runtime: {
      id: 'cpfhpplfnkmdhjnpjldfpfpbdjabgmnl',
      lastError: undefined,
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
      /* 只有假主扩展（和手填的那个 ID）回话；别的扩展一律"连不上"（跟真环境一样） */
      sendMessage: (id, message, cb) => {
        if (id !== 'fake-main' && id !== MANUAL_ID) { cb && cb(undefined); return; }
        if (message.action === 'bridgeHello') return cb && cb({ ok: true, app: '3.15.7', name: '小红书评论助手 · 开发版' });
        if (message.action === 'bridgeSnapshot') return cb && cb({ ok: true, snapshot: FIXTURE });
        cb && cb(undefined);
      },
    },
    storage: {
      local: {
        get: async (keys) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const k of list) if (store.has(k)) out[k] = store.get(k);
          return out;
        },
        set: async (obj) => { for (const [k, v] of Object.entries(obj)) store.set(k, v); },
        remove: async (keys) => { for (const k of [].concat(keys)) store.delete(k); },
      },
    },
    alarms: {
      onAlarm: { addListener: (fn) => listeners.alarm.push(fn) },
      get: async (name) => alarms.get(name) || null,
      create: (name, info) => alarms.set(name, Object.assign({ name }, info)),
      clear: (name, cb) => { alarms.delete(name); cb && cb(); },
    },
    management: {
      getAll: async () => [
        { id: chrome.runtime.id, type: 'extension', enabled: true, name: '手机桥自己' },
        { id: 'other-ext', type: 'extension', enabled: true, name: '不相干的扩展' },
        { id: 'fake-main', type: 'extension', enabled: true, name: '小红书评论助手 · 开发版' },
      ],
    },
  };
  return { chrome, listeners };
}

const { chrome, listeners } = makeChrome();
/* 可控时钟：桥里到处是 Date.now()，节流（100 秒 / 5 分钟）得靠把表往前拨才测得到 */
const clock = { t: Date.now() };
class FakeDate extends Date {
  constructor(...a) { if (a.length === 0) super(clock.t); else super(...a); }
  static now() { return clock.t; }
}
/* 数一数真推了几次（只看打到中转的 /api/push；算在响应回来之后，免得跟中转的写抢时间） */
let pushCalls = 0;
const countingFetch = async (u, ...rest) => { const r = await fetch(u, ...rest); if (String(u).includes('/api/push')) pushCalls++; return r; };
const ctx = vm.createContext({
  chrome, console, crypto, setTimeout, clearTimeout, setInterval, clearInterval,
  fetch: countingFetch, URL, Uint8Array, Date: FakeDate, Math, JSON, String, Number, Array, Object, Promise, RegExp, Error,
});
/* importScripts 的替身：按 bridge/ 目录里的路径照常加载（跟 SW 里的语义一样，共享同一个全局） */
ctx.importScripts = (...names) => {
  for (const n of names) vm.runInContext(readFileSync(path.join(BRIDGE, n), 'utf8'), ctx, { filename: n });
};
const call = (action, extra) => new Promise((resolve) => {
  const fn = listeners.message[0];
  fn(Object.assign({ action }, extra || {}), {}, resolve);
});

const jget = async (p, token) => {
  const r = await fetch(RELAY + p, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  return { status: r.status, d: await r.json().catch(() => ({})) };
};

(async () => {
  vm.runInContext(readFileSync(path.join(BRIDGE, 'background.js'), 'utf8'), ctx, { filename: 'background.js' });
  ok('桥的服务线程能加载（importScripts 三个文件都在）', typeof ctx.RelayClient === 'object' && ctx.BRIDGE_ID);

  const hp = await jget('/health');
  if (!hp.d.ok) throw new Error('中转没起来：先跑 node relay/local/server.mjs');

  /* 1) 状态：中转通、主扩展找到（假的那个）、还没配对 */
  let s = await call('bridgeStatus');
  ok('状态：中转通了', s.relay && s.relay.ok === true, 'v' + (s.relay || {}).ver);
  ok('状态：自动认出了主扩展', !!(s.main && s.main.id === 'fake-main'), s.main && s.main.name);
  ok('状态：还没配对', s.paired === false);

  /* 1.5) 兜底：主扩展 ID 手填（自动找不到/填错 ID 时才用） */
  const badId = await call('bridgeSetMainId', { mainId: '不是个ID' });
  ok('手填格式不对的 ID 被拦下', badId.ok === false, badId.error);
  const setId = await call('bridgeSetMainId', { mainId: MANUAL_ID });
  ok('手填有效 ID → 就认它（自动找到的让位）', setId.ok === true && setId.mainId === MANUAL_ID, setId.mainId);
  s = await call('bridgeStatus');
  ok('状态：主扩展＝手填的（标记 auto=false）', !!(s.main && s.main.id === MANUAL_ID && s.main.auto === false), s.main && s.main.id + ' auto=' + s.main.auto);
  const clearId = await call('bridgeSetMainId', { mainId: '' });
  ok('清空 → 回到自动发现', clearId.ok === true && clearId.mainId === 'fake-main', clearId.mainId);
  s = await call('bridgeStatus');
  ok('状态：主扩展＝自动找到的（标记 auto=true）', !!(s.main && s.main.id === 'fake-main' && s.main.auto === true), s.main && s.main.id + ' auto=' + s.main.auto);

  /* 2) 出配对码 */
  const np = await call('bridgePairNew');
  ok('出配对码', np.ok === true && np.pair && np.pair.code.length === 8, np.pair && np.pair.code);
  ok('二维码画的是手机能开的地址', !!np.pair && /^http:\/\/\d+\.\d+\.\d+\.\d+:8788\/#p=/.test(np.pair.url), np.pair && np.pair.url);

  /* 3) 手机认领（就是手机页那一步） */
  const claim = await fetch(RELAY + '/api/pair/claim', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pairCode: np.pair.code }),
  }).then(r => r.json());
  ok('手机认领拿到令牌', claim.ok === true && claim.deviceId === np.pair.deviceId);

  /* 4) 上报一次 → 手机取回 */
  const pu = await call('bridgePushNow');
  ok('上报成功', pu.ok === true, pu.err || '');
  const snap = await jget('/api/snap?d=' + np.pair.deviceId, np.pair.token);
  ok('手机取回的就是假主扩展那份快照', snap.status === 200 && JSON.stringify(snap.d.snapshot) === JSON.stringify(FIXTURE));
  ok('顺带带出电脑名/主包版本', snap.d.host === '这台电脑' && snap.d.ver === '3.15.7', snap.d.host + ' v' + snap.d.ver);

  /* 5) 改名字 / 换中转地址 */
  await call('bridgeSetName', { name: '办公室电脑' });
  await call('bridgePushNow');
  const snap2 = await jget('/api/snap?d=' + np.pair.deviceId, np.pair.token);
  ok('改完名字下一次上报就生效', snap2.d.host === '办公室电脑');
  const bad = await call('bridgeSetRelay', { base: '不是个地址' });
  ok('中转地址写错被拦下', bad.ok === false);
  await call('bridgeSetRelay', { base: RELAY });

  /* 5.5) 节流：内容没变 / 变得太勤都不推，省云上 KV 的写额度 */
  const tick = () => { if (listeners.alarm[0]) listeners.alarm[0]({ name: 'bridge-push' }); };
  const settle = () => new Promise(r => setTimeout(r, 350));
  const until = async (fn, ms = 3000) => { const t0 = Date.now(); for (;;) { if (fn()) return true; if (Date.now() - t0 > ms) return false; await new Promise(r => setTimeout(r, 20)); } };

  await call('bridgePushNow');                                  // 先强制推一次，让「上次推过」落定
  let n0 = pushCalls;
  tick(); await settle();
  ok('刚推完、内容没变 → 这一分钟不推', pushCalls === n0);
  FIXTURE.queue.todo = 8;                                       // 队列动了：内容变了
  tick(); await settle();
  ok('内容变了但离上次不到 100 秒 → 也先攒着', pushCalls === n0);
  clock.t += 2 * 60 * 1000;
  tick();
  ok('过了 100 秒 → 推上去', await until(() => pushCalls === n0 + 1));
  const snap3 = await jget('/api/snap?d=' + np.pair.deviceId, np.pair.token);
  ok('推上去的确实是新内容', !!(snap3.d.snapshot && snap3.d.snapshot.queue.todo === 8), 'todo=' + (snap3.d.snapshot || {}).queue?.todo);
  n0 = pushCalls;
  clock.t += 6 * 60 * 1000;
  tick();
  ok('内容没变、过了 5 分钟 → 心跳推一次', await until(() => pushCalls === n0 + 1));
  n0 = pushCalls;
  await call('bridgePairNew');
  tick();
  ok('重新配对后第一次不被吞', await until(() => pushCalls === n0 + 1));
  n0 = pushCalls;
  clock.t += 10 * 1000;
  await call('bridgeSetRelay', { base: RELAY });
  tick();
  ok('换中转地址后第一次不被吞', await until(() => pushCalls === n0 + 1));

  /* 6) 解绑：手机立刻失效，桥这边也清干净 */
  const ub = await call('bridgeUnbind');
  ok('解绑', ub.ok === true);
  ok('解绑后手机取不到', (await jget('/api/snap?d=' + np.pair.deviceId, np.pair.token)).status === 401);
  s = await call('bridgeStatus');
  ok('解绑后状态回到"还没配对"', s.paired === false);

  /* 7) 没配对时不联网空转 */
  const pu2 = await call('bridgePushNow');
  ok('没配对时上报直接跳过', pu2.ok === false && pu2.err === 'not_paired');

  if (failed) { console.log('\n❌ ' + failed + ' 条没过'); process.exit(1); }
  console.log('\n🎉 手机桥离线冒烟全部通过（契约 + 桥 × 中转 ' + RELAY + '）');
})().catch(e => { console.error('❌ 冒烟失败：' + e.message); process.exit(1); });
