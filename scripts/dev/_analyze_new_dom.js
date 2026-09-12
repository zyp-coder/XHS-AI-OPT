// 分析最新通知页 HTML：模拟 content.js extractNotifications 口径，定位问题1/2（调试用临时脚本）
const fs = require('fs');
const html = fs.readFileSync('d:/AIproject/小红书运营/_notification_new.html', 'utf8');

// ── 与 _test_chat_follow.js 相同的容器提取（标签平衡扫描）──
function extractContainers(h) {
  const segs = [];
  let pos = 0;
  while (true) {
    const i = h.indexOf('class="container"', pos);
    if (i < 0) break;
    const start = h.lastIndexOf('<div', i);
    let depth = 0, k = start;
    while (k < h.length) {
      const nextOpen = h.indexOf('<div', k);
      const nextClose = h.indexOf('</div>', k);
      if (nextOpen === -1 && nextClose === -1) break;
      if (nextClose === -1 || (nextOpen !== -1 && nextOpen < nextClose)) {
        depth++; k = nextOpen + 4;
      } else {
        depth--; k = nextClose + 5;
        if (depth === 0) { segs.push(h.slice(start, k)); break; }
      }
    }
    pos = i + 1;
  }
  return segs;
}

// ── 模拟 DOM 查询 ──
function hasClassAttr(seg, cls) {
  return new RegExp('class="[^"]*\\b' + cls + '\\b').test(seg);
}
function classText(seg, cls) {
  // 取 class 开头 div 段（标签平衡）再取纯文本（闭合标签是 </div> 而非 </class>）
  const sub = classSeg(seg, cls);
  return sub ? innerText(sub) : '';
}
function classSeg(seg, cls) {
  const i = seg.indexOf('class="' + cls + '"');
  if (i < 0) return '';
  const open = seg.lastIndexOf('<', i);
  const tagM = seg.slice(open).match(/^<([a-zA-Z][a-zA-Z0-9]*)/);
  const tag = tagM ? tagM[1] : 'div';
  const start = open;
  const openTok = '<' + tag, closeTok = '</' + tag + '>';
  let depth = 0, k = start;
  while (k < seg.length) {
    const nextOpen = seg.indexOf(openTok, k);
    const nextClose = seg.indexOf(closeTok, k);
    if (nextClose === -1 || (nextOpen !== -1 && nextOpen < nextClose)) {
      depth++; k = nextOpen + openTok.length;
    } else {
      depth--; k = nextClose + closeTok.length;
      if (depth === 0) return seg.slice(start, k);
    }
  }
  return '';
}
function innerText(s) {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

const containers = extractContainers(html);
console.log('container 总数:', containers.length);

// 0. dump 前两个 container 原始 HTML（排查页面结构变化）
if (process.argv[2] === 'dump') {
  for (let n = 0; n < 2 && n < containers.length; n++) {
    console.log(`\n===== container[${n}] 原始 HTML =====`);
    console.log(containers[n].slice(0, 5000));
  }
  process.exit(0);
}

// 模拟 content.js 口径提取
const items = containers.map((seg, idx) => {
  const hrefM = seg.match(/href="([^"]*\/user\/profile\/[^"]*)"/);
  const href = hrefM ? hrefM[1] : '';
  const uidM = href.match(/\/user\/profile\/([0-9a-fA-F]+)/);
  // userName 多级回退（content.js 口径）
  let userName = '';
  const linkM = seg.match(/<a[^>]*href="[^"]*\/user\/profile\/[^"]*"[^>]*>([^<]*)<\/a>/);
  if (linkM && linkM[1].trim()) userName = linkM[1].trim();
  if (!userName) {
    const m = seg.match(/class="[^"]*\b(user-info|interaction-user|user-name|nickname|name)\b[^"]*"[^>]*>([^<]{1,60})<\/[^>]+>/);
    if (m) userName = m[2].trim();
  }
  if (!userName) {
    const infoSeg = classSeg(seg, 'user-info');
    if (infoSeg) {
      const m = infoSeg.match(/<a[^>]*>([^<]+)<\/a>/);
      if (m) userName = m[1].trim();
    }
  }
  const time = classText(seg, 'interaction-time');
  const incoming = classText(seg, 'interaction-content');
  const myComment = classText(seg, 'quote-info');
  const hasReplyBtn = hasClassAttr(seg, 'action-reply');
  return { idx, userId: uidM ? uidM[1] : '', userName, time, incoming, myComment, hasReplyBtn, href: href.slice(0, 60) };
});

// 1. 输出全列表
console.log('\n===== 全列表（content.js 口径）=====');
for (const it of items) {
  const flags = [];
  if (!it.userId) flags.push('❌无uid');
  if (!it.userName) flags.push('❌无名');
  if (!it.hasReplyBtn) flags.push('❌无回复按钮');
  if (!it.incoming) flags.push('❌incoming空');
  if (!it.myComment) flags.push('⚠无quote');
  console.log(`[${String(it.idx).padStart(2)}] uid=${(it.userId || '❌').slice(0, 8)} 名="${it.userName}" 时=${it.time} ${flags.join(' ')}`);
  console.log(`    incoming="${it.incoming.slice(0, 60)}"`);
  console.log(`    quote   ="${it.myComment.slice(0, 60)}"`);
}

// 2. 按用户分组
console.log('\n===== 按用户分组 =====');
const groups = new Map();
for (const it of items) {
  if (!it.userId) continue;
  if (!groups.has(it.userId)) groups.set(it.userId, []);
  groups.get(it.userId).push(it);
}
for (const [uid, list] of groups) {
  const ordered = [...list].sort((a, b) => b.idx - a.idx); // 时间正序
  console.log(`\n👤 @${ordered[0].userName || '(无名)'} (${uid.slice(0, 8)}…) ${list.length}条`);
  for (const it of ordered) {
    console.log(`  [idx=${it.idx}] 时=${it.time} 可回复=${it.hasReplyBtn}`);
    console.log(`    incoming="${it.incoming.slice(0, 50)}"`);
    console.log(`    quote   ="${it.myComment.slice(0, 50)}"`);
  }
}
