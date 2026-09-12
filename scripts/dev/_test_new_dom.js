// 最新通知页（_notification_new.html）真实数据 → background.js 真实函数全链路验证（调试用临时脚本）
const fs = require('fs');
const vm = require('vm');

// ── 提取（与 _analyze_new_dom.js 同口径：标签平衡扫描 + classSeg 任意标签）──
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
function classSeg(seg, cls) {
  const i = seg.indexOf('class="' + cls + '"');
  if (i < 0) return '';
  const open = seg.lastIndexOf('<', i);
  const tagM = seg.slice(open).match(/^<([a-zA-Z][a-zA-Z0-9]*)/);
  const tag = tagM ? tagM[1] : 'div';
  const openTok = '<' + tag, closeTok = '</' + tag + '>';
  let depth = 0, k = open;
  while (k < seg.length) {
    const nextOpen = seg.indexOf(openTok, k);
    const nextClose = seg.indexOf(closeTok, k);
    if (nextClose === -1 || (nextOpen !== -1 && nextOpen < nextClose)) {
      depth++; k = nextOpen + openTok.length;
    } else {
      depth--; k = nextClose + closeTok.length;
      if (depth === 0) return seg.slice(open, k);
    }
  }
  return '';
}
function innerText(s) { return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }
function classText(seg, cls) { const sub = classSeg(seg, cls); return sub ? innerText(sub) : ''; }

const html = fs.readFileSync('d:/AIproject/小红书运营/_notification_new.html', 'utf8');
const containers = extractContainers(html);
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
  return {
    idx, userId: uidM ? uidM[1] : '', userName,
    time: classText(seg, 'interaction-time'),
    incoming: classText(seg, 'interaction-content'),
    myComment: classText(seg, 'quote-info'),
    hasReplyBtn: seg.indexOf('action-reply') >= 0,
  };
});
console.log('container 总数:', containers.length, '| 有uid:', items.filter(i => i.userId).length);

// ── 加载 background.js 真实函数 ──
const bg = fs.readFileSync('d:/AIproject/小红书运营/extension/background.js', 'utf8');
function extractFn(name, source) {
  const re = new RegExp('(?:async )?function ' + name + '\\([^)]*\\) \\{([\\s\\S]*?)\\n\\}');
  const m = source.match(re);
  if (!m) { console.error('❌ 未找到 ' + name); process.exit(1); }
  return m[0];
}
const buildChatFollowConversations = vm.runInNewContext(extractFn('buildChatFollowConversations', bg) + '; buildChatFollowConversations');

// ── 组装 ──
const conversations = buildChatFollowConversations(items);
console.log('会话数:', Object.keys(conversations).length);

// ── 重点验证三个用户 ──
function dump(uid) {
  const conv = conversations[uid];
  if (!conv) { console.log(`❌ ${uid} 无会话`); return; }
  console.log(`\n👤 @${conv.userName} 轮数=${conv.turnCount} 待回复=${conv.needReply} pendingIdx=${conv.pendingIdx}`);
  conv.history.forEach((m, i) => {
    const who = m.role === 'user' ? '对方' : (m.role === 'context' ? '【我此前的评论/回复】' : '【我的回复】');
    console.log(`  [${i + 1}] ${who}: ${m.content.slice(0, 80)}${m.content.length > 80 ? '…' : ''}`);
  });
  console.log(`  待回复原文: ${conv.pendingIncoming.slice(0, 60)}`);
}

const uidJWH = '679596d5000000000e01e5d4'; // 精卫填海
const uidMDZ = '5c7b5c3b0000000000000000'; // 绵菓子雲（前8位匹配）
const uidTSZ = '56a996d90000000000000000'; // 他说紫色很有韵味

for (const [label, uid] of [['精卫填海', Object.keys(conversations).find(u => u.startsWith('679596d5'))], ['绵菓子雲', Object.keys(conversations).find(u => u.startsWith('5c7b5c3b'))], ['他说紫色很有韵味', Object.keys(conversations).find(u => u.startsWith('56a996d9'))]]) {
  console.log(`\n========== ${label} ==========`);
  dump(uid);
}

// ── 断言 ──
let ok = true;
const mdz = conversations[Object.keys(conversations).find(u => u.startsWith('5c7b5c3b'))];
const jwh = conversations[Object.keys(conversations).find(u => u.startsWith('679596d5'))];
const tsz = conversations[Object.keys(conversations).find(u => u.startsWith('56a996d9'))];

// 绵菓子雲：完整 2 轮（4 条消息，context→user→context→user），pendingIdx = idx2（最新）
if (!mdz || mdz.turnCount !== 2 || mdz.history.length !== 4
  || mdz.history.map(m => m.role).join('→') !== 'context→user→context→user'
  || mdz.history[0].content.indexOf('我之前也跟你一样困惑') !== 0
  || mdz.history[1].content.indexOf('哇塞塞') !== 0
  || mdz.history[2].content.indexOf('其实。。上面那句话也是ai发的') !== 0
  || mdz.history[3].content.indexOf('但是有数据的话确实会更让人信服') !== 0
  || mdz.pendingIdx !== 2) {
  console.log('❌ 绵菓子雲 组装不符合预期');
  ok = false;
} else console.log('✅ 绵菓子雲：完整2轮 + 正确时序 + pendingIdx=2');

// 精卫填海：context→user→user（quote 去重），pendingIdx = idx0（最新）
// 时间戳权威顺序：18:54"没事，我已经转了电商运营"(旧) → 18:55"虽然店铺也会…"(新)
if (!jwh || jwh.turnCount !== 2 || jwh.history.length !== 3
  || jwh.history.map(m => m.role).join('→') !== 'context→user→user'
  || jwh.history[1].content.indexOf('没事，我已经转了电商运营') !== 0
  || jwh.history[2].content.indexOf('虽然店铺也会有多单和少单') !== 0
  || jwh.pendingIdx !== 0) {
  console.log('❌ 精卫填海 组装不符合预期');
  ok = false;
} else console.log('✅ 精卫填海：context→user→user + 背景去重 + pendingIdx=0');

// 他说紫色很有韵味：context→user→user（quote 去重），pendingIdx = idx6（最新）
if (!tsz || tsz.turnCount !== 2 || tsz.history.length !== 3
  || tsz.history.map(m => m.role).join('→') !== 'context→user→user'
  || tsz.pendingIdx !== 6) {
  console.log('❌ 他说紫色很有韵味 组装不符合预期');
  ok = false;
} else console.log('✅ 他说紫色很有韵味：context→user→user + pendingIdx=6');

console.log(ok ? '\n✅ 最新页面真实数据全链路验证通过' : '\n❌ 存在失败项');
