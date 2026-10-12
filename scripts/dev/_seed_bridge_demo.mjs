/* 手机看板 · 造一份演示数据（本机看手机页长什么样，不用真开电脑那一套）
   用法：node relay/local/server.mjs      （另开窗口）
         node scripts/dev/_seed_bridge_demo.mjs
   它会登记一张新配对码 + 推一份演示快照，然后把「手机该打开的地址」打出来。
   把这个地址在电脑浏览器里打开，就是手机扫完码看到的那一屏。 */
const BASE = (process.argv[2] || 'http://127.0.0.1:8788').replace(/\/+$/, '');

/* 想改演示内容就改这里：这几个字段就是主包 bridgeSnapshot() 交给手机的全部东西 */
const DEMO = {
  queue: { todo: 7, waiting: 4, done: 12, total: 19, carry: 1, current: '装修公司 · ⚡ 抢位', live: '第 2/5 篇 · 已发 1/3 条' },
  run: { running: true, auto: true },
  daily: { on: true, views: 58, comments: 5, replies: 2, follows: 3, dirs: [{ name: '装修', used: 12, quota: 20 }, { name: '全屋定制', used: 6, quota: 20 }] },
  autorun: { on: true, from: '09:00', to: '22:00', hold: false, broken: false, inWindow: true },
  err: '',
};

const post = async (path, body, token) => {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: JSON.stringify(body),
  });
  return { status: r.status, d: await r.json().catch(() => ({})) };
};
const rand = (n) => Array.from({ length: n }, () => 'abcdef0123456789'[Math.floor(Math.random() * 16)]).join('');

(async () => {
  const deviceId = rand(32), token = rand(32);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const h = await fetch(BASE + '/health').then(r => r.json()).catch(() => null);
  if (!h || !h.ok) throw new Error('中转没起来：先跑 node relay/local/server.mjs');

  let r = await post('/api/pair/new', { deviceId, token, pairCode: code, host: '演示电脑', ver: '3.15.7' });
  if (!r.d.ok) throw new Error('登记配对码失败：' + JSON.stringify(r.d));
  const snap = Object.assign({ at: Date.now(), app: '3.15.7' }, DEMO);
  r = await post('/api/push', { deviceId, host: '演示电脑', ver: '3.15.7', snapshot: snap }, token);
  if (!r.d.ok) throw new Error('推快照失败：' + JSON.stringify(r.d));

  const lan = (h.lan || [])[0] || BASE;
  console.log('演示数据已就位（电脑：演示电脑 · 快照 v3.15.7）');
  console.log('  电脑上看：' + BASE + '/#p=' + code);
  console.log('  手机上开：' + lan + '/#p=' + code);
  console.log('  配对码  ' + code + '（10 分钟内有效，页面一打开就认领掉）');
})().catch(e => { console.error('❌ ' + e.message); process.exit(1); });
