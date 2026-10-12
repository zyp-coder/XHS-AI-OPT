/* 手机看板 · 中转 HTTP 冒烟：打真的本地中转（relay/local/server.mjs），把整条链路走一遍
   用法：node relay/local/server.mjs    （另开一个窗口）
         node scripts/dev/_smoke_bridge_http.mjs [http://127.0.0.1:8788]
   覆盖：体检 / 配对 / 认领 / 推送 / 取快照 / 手机页静态托管 / 解绑 / 404 / CORS 预检
   注意：它会在中转里留一条设备记录（用 --leave 才会留下，默认跑完自己解绑清掉） */
const BASE = (process.argv[2] || 'http://127.0.0.1:8788').replace(/\/+$/, '');

let failed = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('✅ ' + name + (extra ? '（' + extra + '）' : ''));
  else { failed++; console.log('❌ ' + name + (extra ? ' → ' + extra : '')); }
};
const j = async (path, opt) => {
  const o = opt || {};
  const r = await fetch(BASE + path, {
    method: o.method || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json' }, o.token ? { Authorization: 'Bearer ' + o.token } : {}),
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  let d = {};
  try { d = await r.json(); } catch (_) {}
  return { status: r.status, d };
};

/* 一份和主包 bridgeSnapshot() 同形的快照（字段少一个都算契约破了） */
const SNAPSHOT = {
  at: Date.now(), app: '3.15.7',
  queue: { todo: 7, waiting: 4, done: 12, total: 19, carry: 1, current: '装修公司 · ⚡ 抢位', live: '第 2/5 篇 · 已发 1/3 条' },
  run: { running: true, auto: true },
  daily: { on: true, views: 58, comments: 5, replies: 2, follows: 3, dirs: [{ name: '装修', used: 12, quota: 20 }, { name: '全屋定制', used: 6, quota: 20 }] },
  autorun: { on: true, from: '09:00', to: '22:00', hold: false, broken: false, inWindow: true },
  err: '',
};

(async () => {
  const code = 'HTTP' + Math.floor(Math.random() * 9000 + 1000);
  const deviceId = 'a1b2c3d4'.repeat(4);
  const token = 'f0e1d2c3'.repeat(4);

  // 1) 体检
  let r = await j('/health');
  ok('中转活着', r.status === 200 && r.d.ok === true, 'v' + r.d.ver);
  ok('带出局域网地址（手机能开的）', Array.isArray(r.d.lan) && r.d.lan.length > 0, (r.d.lan || []).join(' '));

  // 2) 手机页静态托管
  const page = await fetch(BASE + '/');
  const html = await page.text();
  ok('手机页能打开', page.status === 200 && html.indexOf('<title>') >= 0, Math.round(html.length / 1024) + 'KB');
  ok('手机页带配对码入口与渲染器', /location\.hash/.test(html) && /api\/snap/.test(html) && /function render\(/.test(html));

  // 3) 配对 → 认领
  r = await j('/api/pair/new', { method: 'POST', body: { deviceId, token, pairCode: code, host: '冒烟测试机', ver: '3.15.7' } });
  ok('电脑登记配对码', r.status === 200 && r.d.ok === true, code);
  r = await j('/api/pair/claim', { method: 'POST', body: { pairCode: code.toLowerCase() } });
  ok('手机认领换到令牌', r.status === 200 && r.d.deviceId === deviceId && r.d.token === token && r.d.host === '冒烟测试机');
  const claimed = await fetch(BASE + '/#p=' + code);   // 带井号的一次性码：服务器只当首页回，认领在手机侧做
  ok('带配对码的地址照样给手机页（井号不上行）', claimed.status === 200);

  // 4) 推送 → 取回
  r = await j('/api/push', { method: 'POST', token, body: { deviceId, host: '冒烟测试机', ver: '3.15.7', snapshot: SNAPSHOT } });
  ok('推快照上去', r.status === 200 && r.d.ok === true);
  r = await j('/api/snap?d=' + deviceId, { token });
  ok('手机取回同一份快照', r.status === 200 && JSON.stringify(r.d.snapshot) === JSON.stringify(SNAPSHOT));
  ok('快照字段一个不少（契约）', r.d.snapshot && r.d.snapshot.queue.live === SNAPSHOT.queue.live && r.d.snapshot.daily.dirs.length === 2);
  r = await j('/api/snap?d=' + deviceId, { token: 'wrong'.repeat(8) });
  ok('错令牌取不到', r.status === 401);

  // 5) CORS 预检（手机页从浏览器发请求要靠它）
  const pre = await fetch(BASE + '/api/snap', { method: 'OPTIONS' });
  ok('OPTIONS 预检放行跨域', pre.status === 204 && pre.headers.get('access-control-allow-origin') === '*');

  // 6) 解绑
  r = await j('/api/unbind', { method: 'POST', token, body: { deviceId } });
  ok('解绑', r.status === 200 && r.d.ok === true);
  r = await j('/api/snap?d=' + deviceId, { token });
  ok('解绑后取不到', r.status === 401);

  // 7) 不存在的路径
  r = await j('/api/nope');
  ok('未知路径 404', r.status === 404);

  if (failed) { console.log('\n❌ ' + failed + ' 条没过'); process.exit(1); }
  console.log('\n🎉 中转 HTTP 全流程通过（' + BASE + '）');
})().catch(e => { console.error('❌ 打不通中转：' + e.message + '\n   先把中转跑起来：node relay/local/server.mjs'); process.exit(1); });
