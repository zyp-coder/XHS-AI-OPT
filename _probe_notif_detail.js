// _probe_notif_detail.js - 勘探「赞和收藏 / 新增关注」tab 的单条通知 DOM，拿到名字/被赞笔记的正确选择器
// 在通知页运行。会自动切 tab 并还原。只读。
// 用法: 通知页 → F12 → Console → 粘贴运行 → 把报告发回
(async () => {
  'use strict';
  const out = [];
  const log = (s) => out.push(s);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const esc = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);

  const _tabs = () => [...document.querySelectorAll('.reds-tab-item')].filter(el => ['赞和收藏', '新增关注', '评论和@'].includes((el.textContent || '').trim()));
  const clickTab = async (name) => {
    const t = _tabs().find(e => (e.textContent || '').trim() === name);
    if (!t) { log(`  ⚠ 找不到 tab ${name}`); return false; }
    if (/\bactive\b/.test(String(t.className || ''))) { log(`  [已激活] ${name}`); return true; }
    try { t.click(); } catch (_) { try { t.dispatchEvent(new MouseEvent('click', { bubbles: true, view: window })); } catch (__) { return false; } }
    await sleep(900);
    return true;
  };
  const containers = () => Array.from(document.querySelectorAll('div.container')).filter(el => el.querySelector('.interaction-hint') || el.querySelector('.user-avatar'));

  log('===== [N1] 页面: ' + location.href + ' / 通知页? ' + (/notification/i.test(location.href) ? '是' : '否'));

  for (const name of ['赞和收藏', '新增关注']) {
    if (!(await clickTab(name))) continue;
    await sleep(500);
    const cs = containers();
    log('');
    log('===== [D] tab = 「' + name + '」通知项 ' + cs.length + ' =====');
    cs.slice(0, 6).forEach((c, i) => {
      log(`\n--- 第${i}条 ---`);
      log('全文: ' + esc(c.textContent));
      const links = [...c.querySelectorAll('a[href*="/user/"]')].map(a => ({ href: (a.getAttribute('href') || '').slice(0, 45), txt: (a.textContent || '').trim().slice(0, 20) }));
      log('user 链接: ' + JSON.stringify(links));
      log('interaction-hint: ' + esc((c.querySelector('.interaction-hint') || {}).textContent));
      log('interaction-content: ' + esc((c.querySelector('.interaction-content') || {}).textContent));
      log('quote-info: ' + esc((c.querySelector('.quote-info') || {}).textContent));
      log('.note-title: ' + esc((c.querySelector('.note-title') || {}).textContent));
      // 找出最像"笔记标题"的元素（含 note/title/整条链接的父级）
      const candTitles = [...c.querySelectorAll('[class*="title"],[class*="note"],[class*="feed"]')].map(el => ({ cls: (el.className || '').slice(0, 40), txt: (el.textContent || '').trim().slice(0, 40) })).filter(x => x.txt.length >= 3);
      log('候选标题元素: ' + JSON.stringify(candTitles.slice(0, 5)));
      // 子结构 class 清单
      const kids = [...c.querySelectorAll('*')].map(el => (el.className || '')).filter(s => s && s.length < 40);
      log('出现过的 class(前10): ' + [...new Set(kids)].slice(0, 10).join(' | '));
    });
  }
  await clickTab('评论和@'); // 还原
  log('');
  log('===== 完成 =====');
  log('重点回复：每条通知全文 + user链接是否有文本 + 笔记标题在哪个 class 里（给出 .note-title 之外真实存在的那个）。');
  console.log(out.join('\n'));
})();