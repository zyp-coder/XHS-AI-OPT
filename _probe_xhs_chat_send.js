// _probe_xhs_chat_send.js - 微调 /chat 自动发送：勘探「输入栏 + 发送按钮」真实 DOM（只读，绝不发送）
// 用途: 锁定 chatSendMessage 的发送按钮选择器（上次 B4 没探到发送按钮结构）
// 用法:
//   1. 登录小红书网页版
//   2. 手动点开【一个真实会话】，让地址变成 https://www.xiaohongshu.com/chat/{convId}
//   3. F12 → Console → 粘贴本文件 → 输入「允许粘贴」→ 回车
//   4. 把 [C1]~[C5] 报告整段复制回来
(() => {
  'use strict';
  const out = [];
  const log = (s) => out.push(s);
  const esc = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  function briefPath(el) {
    let p = el.tagName.toLowerCase();
    if (el.id) p += '#' + el.id;
    else if (typeof el.className === 'string' && el.className.trim()) p += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    return p;
  }
  function isVisible(el) { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }

  log('===== [C1] 页面 =====');
  log('URL: ' + location.href);
  log('是否在具体会话(/chat/xxx): ' + (/\/chat\/[a-zA-Z0-9]{8,}/i.test(location.href) ? '是' : '否（请打开一个真实会话后重跑）'));

  const inputBar = document.querySelector('.xhs-im-input-bar');
  log('');
  log('===== [C2] 输入栏容器 .xhs-im-input-bar =====');
  log(inputBar ? '找到了: ' + briefPath(inputBar) : '未找到 .xhs-im-input-bar');
  log('');
  log('---- .xhs-im-input-bar 原始 HTML（截断 1400 字）----');
  if (inputBar) log(inputBar.outerHTML.length > 1400 ? inputBar.outerHTML.slice(0, 1400) + '…<truncated>' : inputBar.outerHTML);

  log('');
  log('===== [C3] 输入栏内所有可见 button / svg / [role=button] 候选（发送按钮大概率在此） =====');
  const scope = inputBar || document;
  const cands = [...scope.querySelectorAll('button, [role="button"], svg, [class*="send" i], [class*="send" i] *, [type="submit"]')].filter(isVisible);
  const seen = new Set();
  cands.slice(0, 20).forEach((el) => {
    const c = String(el.className || '');
    const aria = el.getAttribute('aria-label') || '';
    const title = el.tagName === 'svg' ? ((el.querySelector('title') || { textContent: '' }).textContent || '') : '';
    const t = (el.innerText || '').trim();
    const k = briefPath(el) + c;
    if (seen.has(k)) return; seen.add(k);
    log(`  <${el.tagName}> cls="${esc(c)}" aria="${esc(aria)}" title="${esc(title)}" txt="${esc(t)}" | ${briefPath(el)}`);
  });

  log('');
  log('===== [C4] 输入框本身（内容可编辑元素） =====');
  const inp = document.querySelector('.xhs-im-input-bar-editor, [contenteditable="true"]');
  log(inp ? '输入框: ' + briefPath(inp) + ' | placeholder?属性=' + esc(inp.getAttribute('placeholder') || inp.getAttribute('data-placeholder') || '(无)') : '未找到输入框');

  log('');
  log('===== [C5] 输入栏外层文本量 Top3 容器（看发送按钮挂在哪个容器下） =====');
  const all = [...document.querySelectorAll('div,section,main')]
    .map((el) => ({ el, len: (el.innerText || '').trim().length, children: el.children.length }))
    .filter((x) => x.len > 20 && x.len < 3000 && x.children > 1)
    .sort((a, b) => b.len - a.len).slice(0, 3);
  all.forEach((s, i) => log(`[${i}] ${briefPath(s.el)} | 文本${s.len} | ${esc(s.el.innerText).slice(0, 40)}`));

  log('');
  log('===== 勘探完成 =====');
  log('重点回复：①本次 URL 是不是 /chat/{convId}？②[C3] 里有没有一个明显是「发送」(剪刀/纸飞机/发送 图标) 的按钮？它的 class/aria 长啥样？③[C2] 原始HTML里的发送区长什么样。');
  console.log(out.join('\n'));
})();