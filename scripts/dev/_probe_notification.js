// _probe_notification.js - 勘探 通知页(/notification) DOM，复刻 collectLikers 的判别逻辑，找出"读不到客户"的差距
// 只读，不发任何请求。在通知页运行。
// 用法:
//   1. 登录小红书网页版，打开 https://www.xiaohongshu.com/notification
//   2. F12 → Console → 粘贴本文件 → 输入「允许粘贴」→ 回车
//   3. 把整段报告复制回来（重点看 [N3] 每条通知项的原始文本 vs collectLikers 判什么、[N4] 用户链接能不能提 ID）
(() => {
  'use strict';
  const out = [];
  const log = (s) => out.push(s);
  const esc = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);

  log('===== [N1] 页面 =====');
  log('URL: ' + location.href);
  log('在通知页(/notification)? ' + (/notification/i.test(location.href) ? '是' : '否'));
  log('登录? ' + (document.querySelectorAll('button,a,div,span').length && ![...document.querySelectorAll('button,a,div,span')].some((el) => { const t = (el.innerText || '').trim(); return /登录|立即登录/.test(t) && el.children.length === 0 && el.getBoundingClientRect().width > 0; }) ? '✓' : '可能未登录'));

  // 复刻 content.js: _getNotificationContainers
  const conts = Array.from(document.querySelectorAll('div.container')).filter((el) => el.querySelector('.interaction-hint') || el.querySelector('.user-avatar'));
  log('');
  log('===== [N2] 复刻 _getNotificationContainers =====');
  log('div.container 总数: ' + document.querySelectorAll('div.container').length);
  log('命中(含 interaction-hint / user-avatar): ' + conts.length);

  // 复刻 collectLikers 的判别
  const regexes = {
    '关注': /(关注了你|关注了你的)/,
    '回复': /(回复了你的|回复你的评论|评论了你的|评论你的)/,
    '点赞/收藏': /(赞了你的|收藏了你的|赞了你的评论|赞了你的笔记|收藏了你的笔记|赞了你的分享|收藏了你的分享|赞了你的)|(赞了|收藏了)/,
  };
  log('');
  log('===== [N3] 每条通知项：原始文本 vs 判成什么 =====');
  let matched = 0;
  conts.slice(0, 20).forEach((c, i) => {
    const txt = c.textContent.replace(/\s+/g, ' ').trim().slice(0, 90);
    let type = '';
    for (const k in regexes) { if (regexes[k].test(c.textContent)) { type = k; break; } }
    if (type) matched++;
    const ul = c.querySelector('a[href*="/user/"]');
    const href = ul ? (ul.getAttribute('href') || '').slice(0, 60) : '';
    const m = (href || '').match(/\/user\/(?:profile\/)?([0-9a-f]+)/i);
    log(`[${i}] →${type || '❌不判'} | ${esc(txt)} | uid=${m ? m[1] : '?(取不到)'} href=${href}`);
  });
  log('命中判定: ' + matched + '/' + conts.length);

  log('');
  log('===== [N4] 诊断：如果命中很少，可能的原因 =====');
  // 看有没有别的可用容器 / 头像 /
  const hasAvatar = document.querySelectorAll('.user-avatar').length;
  const hasHint = document.querySelectorAll('.interaction-hint').length;
  log('页面 .user-avatar 数: ' + hasAvatar + ' | .interaction-hint 数: ' + hasHint);
  log('页面所有 /user/ 链接数: ' + document.querySelectorAll('a[href*="/user/"]').length);
  log('页面内 <article>/<li>/通知点关键词节点数 sample:');
  ['赞', '评论', '关注', '回复', 'follow', 'like'].forEach((k) => {
    const n = [...document.querySelectorAll('div,span,button')].filter((el) => { const t = (el.innerText || '').trim(); return t.length > 0 && t.length <= 40 && (t.includes(k) || (k === 'like' && /like/i.test(t))) && el.children.length === 0 && el.getBoundingClientRect().width > 0; }).length;
    log(`  含「${k}」可见文本节点: ${n}`);
  });
  log('');
  log('===== 完成 =====');
  log('重点回复：①[N2] 命中实多少？②[N3] 每条变成/没变成啥？③有没有明显一条「张三 赞了你的笔记」却没被识别？④[N4] 里 .user-avatar/.interaction-hint 数，看是不是通知页改成了别的 class。');
  console.log(out.join('\n'));
})();