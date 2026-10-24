/* hand-mode.js — 执行器（客户浏览器里那只手）专用：内部页只认一次性通行证
 *
 * 规矩（换手 1A）：
 *   · 外壳派单打开时，网址上带 ?t=<通行证>；本页拿它找后台换"放行"，换完票当场作废。
 *   · 没有票、票不对、票用过、手工改网址、旧的 ?aw=1 —— 一律整页挡掉，不留任何按钮。
 *   · 页里嵌的 iframe 只有在"外层这本就是放行的干活页"时才让过。
 *   · 放行后把网址上的 t 抹掉（不把可复用的入口留在地址栏/历史里）。
 *
 * 这是"手包"的标记文件：extension/（自测包）里没有它，自测照旧能点。
 * 本文件由 sync-executor.js 注入到各页面最前面。
 */
(() => {
  'use strict';

  const q = new URLSearchParams(location.search || '');
  const isFrame = window.top !== window;

  /* 嵌在页里的：外层放行了才让过（同源才读得到；读不到就当没放行）。
     外层可能正在等票，给它最多 3 秒。 */
  if (isFrame) {
    let ok = false;
    try { ok = window.top.__XHS_HAND__ === true; } catch (_) {}
    if (ok) { window.__XHS_HAND__ = true; return; }
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      let pass = false;
      try { pass = window.top.__XHS_HAND__ === true; } catch (_) {}
      if (pass) { window.__XHS_HAND__ = true; clearInterval(timer); }
      else if (tries >= 30) clearInterval(timer);
    }, 100);
    return;
  }

  /* ── 最外层：先藏起来，验票通过才显示（防"先闪一眼产品界面"） ── */
  const hide = document.createElement('style');
  hide.id = '__hm_hide';
  hide.textContent = 'html{visibility:hidden !important;background:#f6f7f9 !important}';
  (document.head || document.documentElement).appendChild(hide);
  window.__XHS_HAND__ = false;

  const showBlock = (why) => {
    const h = document.getElementById('__hm_hide');
    if (h) h.remove();
    if (document.getElementById('__hm_block')) return;
    const box = document.createElement('div');
    box.id = '__hm_block';
    box.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#f6f7f9;'
      + 'font:14px/1.9 system-ui,-apple-system,"Microsoft YaHei",sans-serif;color:#333;'
      + 'display:flex;align-items:center;justify-content:center;text-align:center';
    box.innerHTML = '<div><div style="font-size:36px">🖐</div>'
      + '<div style="font-size:16px;font-weight:600;margin:6px 0">这页是给机器用的，不给人点</div>'
      + '<div style="color:#666">干活请打开网页——发笔记 / 获客 / 客服都在网页上点。</div>'
      + (why ? '<div style="color:#b45309;font-size:12px;margin-top:6px">' + why + '</div>' : '')
      + '<div id="hmSrv" style="color:#999;font-size:12px;margin-top:10px"></div></div>';
    (document.body || document.documentElement).appendChild(box);
    try {
      chrome.storage.local.get('ex.cred', (r) => {
        const c = r && r['ex.cred'];
        const el = document.getElementById('hmSrv');
        if (el && c && c.server) el.textContent = '网页地址：' + c.server;
      });
    } catch (_) {}
  };

  const block = (why) => {
    window.__XHS_HAND_PENDING__ = false;
    window.__XHS_HAND_BLOCKED__ = true;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => showBlock(why), { once: true });
    else showBlock(why);
    window.addEventListener('load', () => showBlock(why), { once: true });
  };

  const ticket = String(q.get('t') || '');
  if (!ticket) { block(''); return; }   // 手工打开 / 旧的 ?aw=1：没有票
  window.__XHS_HAND_PENDING__ = true;

  let settled = false;
  const pass = () => {
    if (settled) return;
    settled = true;
    window.__XHS_HAND__ = true;
    window.__XHS_HAND_PENDING__ = false;
    const h = document.getElementById('__hm_hide');
    if (h) h.remove();
    /* 票已经从网址上消失了：拍屏、翻历史都摸不到可复用的入口 */
    try {
      const u = new URL(location.href);
      u.searchParams.delete('t');
      history.replaceState(null, '', u.pathname + (u.search || '') + (u.hash || ''));
    } catch (_) {}
    try { window.dispatchEvent(new Event('xhs-hand-ready')); } catch (_) {}
  };
  const fail = (why) => {
    if (settled) return;
    settled = true;
    block(String(why || '通行证不对或已经用过'));
  };

  /* 走专用端口：普通 sendMessage 会被后台里那个"总机"先回一句「未知 action」，
     页面只认第一份答复，票据就永远换不成。 */
  try {
    const port = chrome.runtime.connect({ name: 'ex-ticket' });
    let got = false;
    const timer = setTimeout(() => {
      if (got) return;
      got = true;
      try { port.disconnect(); } catch (_) {}
      fail('执行器后台没应声');
    }, 4000);
    port.onMessage.addListener((r) => {
      if (got) return;
      got = true;
      clearTimeout(timer);
      try { port.disconnect(); } catch (_) {}
      if (r && r.ok) return pass();
      fail((r && r.error) || '通行证不对或已经用过');
    });
    port.onDisconnect.addListener(() => {
      if (got) return;
      got = true;
      clearTimeout(timer);
      let why = '';
      try { why = (chrome.runtime.lastError && chrome.runtime.lastError.message) || ''; } catch (_) {}
      fail('执行器后台没应声' + (why ? '：' + why : ''));
    });
    port.postMessage({ type: 'consume', ticket });
  } catch (e) {
    fail('执行器后台没应声：' + ((e && e.message) || e));
  }
})();
