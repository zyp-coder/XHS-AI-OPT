// _probe_reply.js - 专门定位「回复了我的评论」被抓成『取消评论』的问题
// 用法：打开 https://www.xiaohongshu.com/notification → F12 Console → 粘贴 → 回车
// 重点：找到 appleman 那条，把 [R2] 的完整 outerHTML 贴回来
(() => {
  'use strict';
  const out = [];
  const log = (s) => out.push(s);
  const has = (el, s) => { const t = (el.textContent || ''); return s && t.includes(s); };

  log('===== [R0] 页面 = ' + location.href + ' =====');

  // 1) 找出「含 取消 二字、且疑似是对方消息正文」的叶子元素
  const cancelNodes = [...document.querySelectorAll('div,span,p,button,a,li')].filter(el => {
    const t = (el.textContent || '').trim();
    if (!t || t.length > 30) return false;          // 只找短的
    if (!(t.includes('取消') || t.includes('删除'))) return false;
    if (el.children.length > 0) return false;         // 只要叶子
    return el.getBoundingClientRect ? el.getBoundingClientRect().width > 0 : true;
  });
  log('===== [R1] 页面正文=『取消/删除』的叶子节点数: ' + cancelNodes.length);
  cancelNodes.slice(0, 15).forEach((el, i) => {
    const cls = String(el.className || '');
    let anc = el, chain = [];
    for (let k = 0; k < 5 && anc; k++) { chain.unshift(anc.tagName + '.' + String(anc.className || '').split(' ')[0]); anc = anc.parentElement; }
    log(`  - 『${(el.textContent||'').trim()}』 在 ${chain.join(' > ')}  [closest .container: ${!!el.closest('.container')}]`);
  });

  // 2) 每个通知容器：读出代码会抓的 interaction-content / quote-info，并标出异常
  const conts = Array.from(document.querySelectorAll('div.container')).filter(el => el.querySelector('.interaction-hint') || el.querySelector('.user-avatar'));
  log('===== [R2] 通知容器数: ' + conts.length + ' （容器[i].interaction-content 就是代码抓回来的『对方消息』）');
  conts.forEach((c, i) => {
    const hint = (c.querySelector('.interaction-hint') || {}).textContent || '';
    const content = (c.querySelector('.interaction-content') || {}).textContent || '';
    const quote = (c.querySelector('.quote-info') || {}).textContent || '';
    const isReply = /回复/.test(hint);
    const flag = (content.includes('取消') || content.includes('删除')) ? ' ★★ 命中问题' : (isReply && content.length < 2 ? ' ⚠ 回复但内容为空' : '');
    log(`[${i}]${flag} hint=『${hint.replace(/\s+/g,' ').trim().slice(0,20)}』 | content=『${content.replace(/\s+/g,' ').trim().slice(0,30)}』 | quote=『${quote.replace(/\s+/g,' ').trim().slice(0,25)}』`);
  });

  // 3) 把 appleman / 与『取消评论』同一容器的完整 HTML 摘出来
  const target = conts.find(c => {
    const t = (c.textContent || '');
    return /appleman|apple/i.test(t) || (c.querySelector('.interaction-content') || {}).textContent.includes('取消');
  });
  if (target) {
    log('===== [R3] ★ 目标条目完整 outerHTML =====');
    log(target.outerHTML);
    log('===== [R3] ★ 这条的可见文本 innerText =====');
    log(target.innerText.replace(/\s+/g, ' ').trim());
    log('===== [R3] ★ class 清单 =====');
    log([...new Set([...target.querySelectorAll('*')].map(el => (el.className || '').toString()).filter(Boolean).slice(0, 20))].slice(0, 30).join(' | '));
  } else {
    log('===== [R3] 没找到 appleman / 取消 目标容器（可能这条不在当前 tab，试切到「评论和@」再跑） =====');
  }
  console.log(out.join('\n'));
})();