// _probe_notif_tabs.js - 勘探 通知页(/notification) 顶部分类筛选 tab，找出「赞和收藏/关注」的去哪了
// 只读 + 自动逐个点一次 tab（用于勘探）。在通知页运行。
// 用法:
//   1. 登录小红书网页版，打开 https://www.xiaohongshu.com/notification
//   2. F12 → Console → 粘贴本文件 → 输入「允许粘贴」→ 回车
//   3. 约 40~60 秒后，把整段报告复制回来（重点看 [NT2]：点每个 tab 后各类信号量，找出"赞/收藏"在哪个 tab 里出现）
(async () => {
  'use strict';
  const out = [];
  const log = (s) => out.push(s);
  const esc = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // 复刻 content.js: _getNotificationContainers + signalType 分类
  const KEYS = ['关注', '回复', '点赞'];
  const _classify = (txt) => {
    if (/(关注了你|关注了你的)/.test(txt)) return '关注';
    if (/(回复了你的|回复你的评论|评论了你的|评论你的|回复了你|回复你)/.test(txt)) return '回复';
    if (/(赞了你的|收藏了你的|赞了你的评论|赞了你的笔记|收藏了你的笔记|赞了你的分享|收藏了你的分享|赞了你的|赞了|收藏了|赞了你|收藏了你)/.test(txt)) return '点赞';
    if (/你的/.test(txt)) return '点赞';
    if (txt.length > 0) return '互动';
    return '';
  };
  const _containers = () => Array.from(document.querySelectorAll('div.container'))
    .filter(el => el.querySelector('.interaction-hint') || el.querySelector('.user-avatar'));

  const _countSignals = () => {
    const c = _containers();
    const counts = { 关注: 0, 回复: 0, 点赞: 0, 互动: 0 };
    for (const el of c) {
      const s = _classify(el.textContent.replace(/\s+/g, ' '));
      if (counts[s] !== undefined) counts[s]++;
    }
    return { total: c.length, counts };
  };

  log('===== [N1] 页面 =====');
  log('URL: ' + location.href);
  log('在通知页(/notification)? ' + (/notification/i.test(location.href) ? '是' : '否'));

  // ── 找顶部分类/筛选可点元素（文本含 赞|收藏|关注|评论|回复|粉丝|互动|全部|公开 的叶子节点） ──
  log('');
  log('===== [NT1] 候选筛选 tab =====');
  const tabRe = /(赞|收藏|关注|评论|回复|粉丝|互动|全部|公开)/;
  const cands = [];
  [...document.querySelectorAll('div,span,button,a,li,[role="tab"],[role="button"],li[class*="item"]')].forEach((el) => {
    const t = (el.textContent || '').trim();
    if (t.length === 0 || t.length > 12) return;
    if (el.children.length > 4) return;                 // 叶子/近叶子节点
    if (!tabRe.test(t)) return;
    let r = { width: 0, height: 0 };
    try { r = el.getBoundingClientRect(); } catch (_) {}
    if (r.width < 20 || r.height < 12) return;          // 可见
    const c = String(el.className || '').slice(0, 60);
    const tag = el.tagName.toLowerCase();
    const info = { tag, text: t, cls: c, href: (el.getAttribute && el.getAttribute('href') || '').slice(0, 40) };
    const key = tag + '|' + c + '|' + t;
    if (!cands.some(x => x.key === key)) cands.push({ key, ...info });
  });
  // 优先把更像 tab 的排前面：target/Text、无 href、短文本、带 tab/class
  const sortScore = (x) => (/\btab\b|nav|filter|item|menu|link/.test(x.cls) ? -3 : 3)
    + (x.href ? 2 : -1) + (x.text.length <= 4 ? -2 : 1);
  cands.sort((a, b) => sortScore(a) - sortScore(b));
  cands.slice(0, 25).forEach((c, i) => {
    log(`[tab${i}] <${c.tag}> "${c.text}" | cls=${c.cls} | href=${c.href}`);
  });
  log('候选 tab 总数(去重后): ' + cands.length);

  // ── 逐个候选点一下，看各信号量变化 ──
  log('');
  log('===== [NT2] 逐个点击候选 tab 后的信号量（找"赞/收藏"在哪出现） =====');
  const tested = new Set();
  for (let i = 0; i < Math.min(cands.length, 15); i++) {
    const c = cands[i];
    const reDoEl = [...document.querySelectorAll('div,span,button,a,li')].find(el =>
      String(el.className || '').slice(0, 60) === c.cls
      && el.tagName.toLowerCase() === c.tag
      && (el.textContent || '').trim() === c.text);
    if (tested.has(c.key)) continue;
    if (!reDoEl) continue;
    tested.add(c.key);
    let hit = true;
    try { reDoEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })) || reDoEl.click(); } catch (_) { try { reDoEl.click(); } catch (e) { hit = false; } }
    if (!hit) continue;
    await sleep(2000);
    const before = _countSignals();
    const s = before.counts;
    log(`[点击 tab${i} "<${c.tag}> ${c.text}" | cls=${c.cls}] → 通知项 ${before.total}（赞${s.点赞}/藏↘ 关注${s.关注}/回复${s.回复}/互动${s.互动}）`);
    // 点到没反应的先滚一下，排除纯布局节点
    if (before.total === _containers().length && before.total === 0) {
      const old = _containers().length;
      const sc = document.scrollingElement || document.documentElement;
      sc.scrollTop = sc.scrollHeight; await sleep(1200); sc.scrollTop = 0; await sleep(200);
      const after = _countSignals();
      log(`      ↑ 点后没反应，补滚动后: 通知项 ${after.total} 赞${after.counts.点赞} 关注${after.counts.关注} 回复${after.counts.回复}`);
    }
    // 若该 tab 能收到"赞"(counts.点赞>0)，停下来突出提示"找到了"
    if (s.点赞 > 0) log(`      ⭐ 此 tab 出现了赞(${s.点赞}) → 目标定位！`);
  }

  log('');
  log('===== 完成 =====');
  log('重点回复：①[NT1] 顶部有哪些 tab？②[NT2] 哪个 tab 后"赞/收藏"计数 > 0（那就是 collectLikers 该先去点的那一个）？③当前页面在默认状态下到底有没有赞。');
  console.log(out.join('\n'));
})();