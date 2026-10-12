/* 手机桥 · 跟中转说话的那一层（服务线程与弹窗共用）
 *
 * 只做四件事：登记配对码 / 推快照 / 解绑 / 体检。响应一律 { ok, ... }，失败不抛异常，
 * 由调用方决定怎么显示（弹窗要写给人看，服务线程只要一个错误码）。
 */
(function (root) {
  'use strict';

  /* 默认中转：本机版（relay/local/server.mjs，端口 8788）。换成云上地址时在弹窗里改。 */
  const DEFAULT_BASE = 'http://127.0.0.1:8788';
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 去掉了 I/O/0/1 这些看走眼的

  function randHex(n) {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    let s = '';
    for (const b of a) s += ('0' + b.toString(16)).slice(-2);
    return s.slice(0, n);
  }
  function newPairCode(len) {
    const a = new Uint8Array(len || 8);
    crypto.getRandomValues(a);
    let s = '';
    for (const b of a) s += CODE_CHARS[b % CODE_CHARS.length];
    return s;
  }
  const normBase = (u) => String(u || '').trim().replace(/\/+$/, '');
  /* 配对链接＝手机扫码要打开的东西：中转地址 + #p=配对码（配对码是一次性的，10 分钟过期） */
  const pairUrl = (base, code) => normBase(base) + '/#p=' + encodeURIComponent(code);

  async function ask(base, pathname, opt) {
    const o = opt || {};
    const headers = { 'Content-Type': 'application/json' };
    if (o.token) headers['Authorization'] = 'Bearer ' + o.token;
    try {
      const r = await fetch(normBase(base) + pathname, {
        method: o.method || 'GET',
        headers,
        body: o.body ? JSON.stringify(o.body) : undefined,
        cache: 'no-store',
      });
      let d = {};
      try { d = await r.json(); } catch (_) {}
      if (!d || typeof d !== 'object') d = {};
      if (!r.ok) return Object.assign({ ok: false, status: r.status }, d);
      return Object.assign({ ok: true, status: r.status }, d);
    } catch (e) {
      return { ok: false, net: true, error: String((e && e.message) || e) };
    }
  }

  /* 中转活没活 + 手机能用哪个地址进来（本地版会带回局域网地址） */
  const health = (base) => ask(base, '/health');

  /* 电脑侧登记一次配对：中转记下「配对码 → 设备与令牌」，等手机来认领 */
  const pairNew = (base, o) => ask(base, '/api/pair/new', {
    method: 'POST',
    body: { deviceId: o.deviceId, token: o.token, pairCode: o.pairCode, host: o.host, ver: o.ver },
  });

  /* 每分钟把快照推进去（手机从那头取） */
  const push = (base, o) => ask(base, '/api/push', {
    method: 'POST',
    token: o.token,
    body: { deviceId: o.deviceId, host: o.host, ver: o.ver, snapshot: o.snapshot },
  });

  /* 解绑：中转删掉这条设备，手机手里的令牌立刻失效 */
  const unbind = (base, o) => ask(base, '/api/unbind', { method: 'POST', token: o.token, body: { deviceId: o.deviceId } });

  root.RelayClient = { DEFAULT_BASE, randHex, newPairCode, pairUrl, normBase, health, pairNew, push, unbind };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.RelayClient;
})(typeof globalThis !== 'undefined' ? globalThis : this);
