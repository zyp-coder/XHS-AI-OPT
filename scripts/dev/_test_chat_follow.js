// 联调单测 v2：适配真实语义（quote-info = 我的原评论 context 角色）
// 用 background.js 里的真实函数验证：
//   1. buildChatFollowConversations —— 消息整理（按用户分组、时间正序、context/user 角色）
//   2. 待回复定位保存（pendingIdx / pendingIncoming = 组内最新一条）
//   3. handleChatFollowSync + handleChatFollowMarkSent —— 防重复链路（MarkSent 后重同步不再待回复；新消息到来恢复待回复）
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('d:/AIproject/小红书运营/_notification_dom2.html', 'utf8');

// ── 1. 提取 div.container（标签平衡扫描）──
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
      if (nextClose < 0) break;
      if (nextOpen >= 0 && nextOpen < nextClose) { depth++; k = nextOpen + 4; }
      else { depth--; k = nextClose + 6; if (depth <= 0) break; }
    }
    segs.push(h.slice(start, k));
    pos = i + 'class="container"'.length;
  }
  return segs;
}

// 提取 class 元素文本
function classText(seg, cls) {
  const m = seg.match(new RegExp('class="[^"]*' + cls + '[^"]*"[^>]*>'));
  if (!m) return '';
  const inner = seg.slice(m.index + m[0].length);
  const end = inner.search(/<div class="|<\/div>|<span class="|<\/span>/);
  const chunk = end < 0 ? inner : inner.slice(0, end);
  return chunk.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// 提取 items（与 content.js extractNotifications 同口径：myComment = quote-info = 我的原评论）
const containers = extractContainers(html);
const items = containers.map((seg, idx) => {
  const hrefM = seg.match(/href="([^"]*\/user\/profile\/[^"]*)"/);
  const href = hrefM ? hrefM[1] : '';
  const uidM = href.match(/\/user\/profile\/([0-9a-fA-F]+)/);
  const userM = seg.match(/class="[^"]*user-info[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/);
  return {
    idx,
    userId: uidM ? uidM[1] : '',
    userName: userM ? userM[1].trim() : '',
    time: classText(seg, 'interaction-time'),
    incoming: classText(seg, 'interaction-content'),
    myComment: classText(seg, 'quote-info'),
    hasReplyBtn: seg.indexOf('action-reply') >= 0,
  };
});

console.log('=== 提取统计 ===');
console.log('container 总数:', containers.length);
console.log('有 userId:', items.filter(i => i.userId).length, '| 有 myComment:', items.filter(i => i.myComment).length, '| 有回复按钮:', items.filter(i => i.hasReplyBtn).length);
console.log('无回复按钮（展开中/原评论已删除，应被过滤）:', items.filter(i => !i.hasReplyBtn).map(i => `idx${i.idx}`).join(','));
console.log('时间戳样本:', items.slice(0, 6).map(i => i.time).join(' / '));

// ── 2. 从 background.js 提取真实函数并在隔离沙箱执行 ──
const bg = fs.readFileSync('d:/AIproject/小红书运营/extension/background.js', 'utf8');
function extractFn(name, source) {
  // 仅匹配顶层函数体：函数体内闭合花括号均有缩进，行首 `}` 即函数结束（本地可信源码，无外部输入）
  const re = new RegExp('(?:async )?function ' + name + '\\([^)]*\\) \\{([\\s\\S]*?)\\n\\}');
  const m = source.match(re);
  if (!m) { console.error('❌ 未从 background.js 找到 ' + name); process.exit(1); }
  return m[0];
}

const buildChatFollowConversations = vm.runInNewContext(extractFn('buildChatFollowConversations', bg) + '; buildChatFollowConversations');
console.log('✅ 已加载 background.js 中的真实函数（buildChatFollowConversations / handleChatFollowSync / handleChatFollowMarkSent）\n');

// ── 3. 组装验证（消息整理 + 定位保存）──
const conversations = buildChatFollowConversations(items);
const userIds = Object.keys(conversations);
console.log('=== 组装结果 ===');
console.log('会话数（按用户分组）:', userIds.length);
let ok = true;

// 被过滤规则：无 userId / incoming 空 / “已删除”占位 / 无回复按钮
const expectedItems = items.filter(i => i.userId && i.incoming && i.incoming.trim() && !/已删除|已移除|已被删除/.test(i.incoming) && i.hasReplyBtn);
const expectedUsers = new Set(expectedItems.map(i => i.userId));
console.log('应生成会话的用户数（过滤后）:', expectedUsers.size);
if (userIds.length !== expectedUsers.size) {
  console.log('  ❌ 会话数不匹配');
  ok = false;
}

for (const uid of userIds) {
  const conv = conversations[uid];
  const groupItems = expectedItems.filter(i => i.userId === uid).sort((a, b) => b.idx - a.idx); // 时间正序 = idx 降序
  const idxs = groupItems.map(i => i.idx);

  // 验证1：组内 idx 降序（DOM 倒序 → 时间正序：旧→新）
  const sorted = [...idxs].sort((a, b) => b - a);
  const timeAsc = idxs.every((v, i) => v === sorted[i]);
  console.log(`\n👤 @${conv.userName} (${uid.slice(0, 8)}…) 轮数=${conv.turnCount} 待回复=${conv.needReply} pendingIdx=${conv.pendingIdx} 组内idx=[${idxs.join(',')}] 时间正序=${timeAsc ? '✓' : '✗'}`);
  if (!timeAsc) ok = false;

  // 验证2：角色合法 = 只有 context/user（初始组装无 assistant）；context 后必须紧跟 user；user 前可以是 context/user/开头
  const roles = conv.history.map(m => m.role);
  let roleOk = roles.length > 0;
  for (let i = 0; i < roles.length && roleOk; i++) {
    if (roles[i] === 'context') {
      if (roles[i + 1] !== 'user') roleOk = false; // context 后必须紧跟 user
    } else if (roles[i] !== 'user') {
      roleOk = false; // 初始组装不该有 assistant
    }
  }
  console.log(`  history(${roles.length}条) 角色=${roles.join('→')} ${roleOk ? '✓' : '✗'}`);
  if (!roleOk) ok = false;

  // 验证3：history 内容与原始通知逐条一致
  //   a) user 序列 = 各条 incoming（旧→新）；b) context 序列 = 去重后的 myComment（相同背景只放一次）
  const userMsgs = conv.history.filter(m => m.role === 'user');
  const expectedIncoming = groupItems.map(i => i.incoming);
  const contentOk = userMsgs.length === expectedIncoming.length
    && userMsgs.every((m, i) => m.content === expectedIncoming[i]);
  const ctxMsgs = conv.history.filter(m => m.role === 'context');
  const seenCtx = [];
  for (const it of groupItems) {
    const c = it.myComment && it.myComment.trim();
    if (c && !seenCtx.includes(c)) seenCtx.push(c);
  }
  const ctxOk = ctxMsgs.length === seenCtx.length
    && ctxMsgs.every((m, i) => m.content === seenCtx[i]);
  const bothOk = contentOk && ctxOk;
  console.log(`  history内容与原始通知逐条一致(user=${contentOk ? '✓' : '✗'}, context去重=${ctxOk ? '✓' : '✗'})`);
  if (!bothOk) ok = false;

  // 验证4：待回复定位 = 组内最新一条（idx 最小，DOM 最上），needReply 默认 true
  const last = groupItems[groupItems.length - 1];
  if (conv.needReply !== true || conv.pendingIdx !== last.idx || conv.pendingIncoming !== last.incoming) {
    console.log(`  ❌ 待回复定位错误：needReply=${conv.needReply}(应true) pendingIdx=${conv.pendingIdx}(应${last.idx})`);
    ok = false;
  } else {
    console.log(`  待回复定位 ✓ (pendingIdx=${conv.pendingIdx}) | 原文: ${conv.pendingIncoming.slice(0, 30)}`);
  }

  // 验证5：轮数 = 该组有效消息数
  if (conv.turnCount !== groupItems.length) {
    console.log(`  ❌ 轮数错误：${conv.turnCount} (应${groupItems.length})`);
    ok = false;
  }
}

// ── 3.5 去重验证：同一句话重复回复只保留最新一条 ──
console.log('\n=== 重复回复去重验证 ===');
const dupUser = 'dup_test_user_001';
const dupItems = [
  { idx: 3, userId: dupUser, userName: '测试用户', time: '4天前', incoming: '第一句', myComment: '我的原评论D', hasReplyBtn: true },
  { idx: 2, userId: dupUser, userName: '测试用户', time: '3天前', incoming: '这句说了两遍', myComment: '我的原评论A', hasReplyBtn: true },
  { idx: 1, userId: dupUser, userName: '测试用户', time: '2天前', incoming: '这句说了两遍', myComment: '我的原评论B', hasReplyBtn: true },
  { idx: 0, userId: dupUser, userName: '测试用户', time: '1天前', incoming: '这句说了两遍', myComment: '我的原评论C', hasReplyBtn: true },
];
const dupConv = buildChatFollowConversations(dupItems)[dupUser];
const dupOk = !!dupConv && dupConv.turnCount === 2
  && dupConv.pendingIncoming === '这句说了两遍' && dupConv.pendingIdx === 0
  && dupConv.history.length === 4
  && dupConv.history[1].content === '第一句'
  && dupConv.history[3].content === '这句说了两遍';
console.log(`重复回复去重：轮数=${dupConv ? dupConv.turnCount : '无'} (应2) pendingIdx=${dupConv ? dupConv.pendingIdx : '无'} (应0，最新那条) 历史角色=${dupConv ? dupConv.history.map(m => m.role).join('→') : '无'} ${dupOk ? '✓' : '✗'}`);
if (!dupOk) ok = false;

// ── 3.6 真实场景验证：同一原评论被对方连续回复两句（quote 相同背景不重复）──
console.log('\n=== 真实场景1：同一原评论被连续回复两句（精卫填海） ===');
const realItems = [
  { idx: 1, userId: 'jwh_001', userName: '精卫填海何尝不是另一种形式的搬砖', time: '2天前', incoming: '虽然店铺也会有多单和少单的时候，但好歹一直有较稳定的出单', myComment: '我特别理解这种纠结…（原评论）', hasReplyBtn: true },
  { idx: 0, userId: 'jwh_001', userName: '精卫填海何尝不是另一种形式的搬砖', time: '1天前', incoming: '没事，我已经转了电商运营', myComment: '我特别理解这种纠结…（原评论）', hasReplyBtn: true },
];
const realConv = buildChatFollowConversations(realItems)['jwh_001'];
const realOk = !!realConv && realConv.turnCount === 2
  && realConv.history.length === 3   // context + user + user（背景不重复）
  && realConv.history[0].role === 'context' && realConv.history[0].content === '我特别理解这种纠结…（原评论）'
  && realConv.history[1].role === 'user' && realConv.history[1].content === '虽然店铺也会有多单和少单的时候，但好歹一直有较稳定的出单'
  && realConv.history[2].role === 'user' && realConv.history[2].content === '没事，我已经转了电商运营'
  && realConv.pendingIdx === 0 && realConv.pendingIncoming === '没事，我已经转了电商运营';
console.log(`连续回复两句：轮数=${realConv ? realConv.turnCount : '无'} (应2) 角色=${realConv ? realConv.history.map(m => m.role).join('→') : '无'} (应context→user→user) 定位=${realConv ? realConv.pendingIdx : '无'} ${realOk ? '✓' : '✗'}`);
if (!realOk) ok = false;

// ── 3.7 真实场景验证：对方回复我的回复（quote=我的回复，绵菓子雲）──
console.log('\n=== 真实场景2：对方回复我的回复（绵菓子雲 2 轮） ===');
const mdzItems = [
  { idx: 1, userId: 'mgz_001', userName: '绵菓子雲🍭', time: '2天前', incoming: '哇塞塞，你这个感觉会更有依据哈哈哈哈', myComment: '我之前也跟你一样困惑，后来才明白…（我的原评论）', hasReplyBtn: true },
  { idx: 0, userId: 'mgz_001', userName: '绵菓子雲🍭', time: '1天前', incoming: '但是有数据的话确实会更让人信服', myComment: '其实。。上面那句话也是ai发的（我的回复）', hasReplyBtn: true },
];
const mdzConv = buildChatFollowConversations(mdzItems)['mgz_001'];
const mdzOk = !!mdzConv && mdzConv.turnCount === 2
  && mdzConv.history.length === 4   // context+user+context+user（两个不同背景都保留）
  && mdzConv.history[0].content === '我之前也跟你一样困惑，后来才明白…（我的原评论）'
  && mdzConv.history[1].content === '哇塞塞，你这个感觉会更有依据哈哈哈哈'
  && mdzConv.history[2].content === '其实。。上面那句话也是ai发的（我的回复）'
  && mdzConv.history[3].content === '但是有数据的话确实会更让人信服'
  && mdzConv.pendingIdx === 0 && mdzConv.pendingIncoming === '但是有数据的话确实会更让人信服';
console.log(`对方回复我的回复：轮数=${mdzConv ? mdzConv.turnCount : '无'} (应2) 角色=${mdzConv ? mdzConv.history.map(m => m.role).join('→') : '无'} (应context→user→context→user) ${mdzOk ? '✓' : '✗'}`);
if (!mdzOk) ok = false;

// ── 3.8 礼貌性结束语识别验证（真实函数 isChatFollowEnding）──
console.log('\n=== 礼貌性结束语识别（isChatFollowEnding） ===');
const isChatFollowEnding = vm.runInNewContext((bg.match(/const CHAT_FOLLOW_ENDING_WORDS = \[[^\]]*\];/) || [''])[0] + extractFn('isChatFollowEnding', bg) + '; isChatFollowEnding');
const endingCases = [
  // [消息, 期望]
  ['谢谢', true], ['谢谢啊', true], ['非常感谢', true], ['感谢感谢', true], ['辛苦你了', true], ['好的', true],
  ['好的收到', true], ['嗯嗯', true], ['收到', true], ['好的好的', true], ['谢谢你的回答', true], ['谢谢🙏', true], ['OK', true], ['嗯', true],
  ['好的，那我也去买来试试！', false], ['谢谢。我贷款68万30年，准备提前还15万', false], ['哈哈哈', false], ['谢谢老板', false], ['你好', false], ['谢谢姐妹帮我看看', false], ['', false],
];
let endingOk = true;
for (const [msg, want] of endingCases) {
  const got = isChatFollowEnding(msg);
  const pass = got === want;
  if (!pass) { endingOk = false; console.log(`  ✗ "${msg}" → ${got}（应${want}）`); }
}
console.log(`礼貌结束语识别：${endingCases.length} 组用例 ${endingOk ? '全部通过 ✓' : '存在失败 ✗'}`);
if (!endingOk) ok = false;

// ── 4. 防重复链路 + 完整对话展示（async IIFE，避免顶层 await 触发 ESM 检测）──
(async () => {
  console.log('\n=== 防重复链路（handleChatFollowSync + handleChatFollowMarkSent） ===');
  // mock Storage（注入沙箱全局，真实函数内部可直接引用）
  const sandboxStorage = {
    state: { conversations: {} },
    history: [],
    async getChatFollowState() { return this.state; },
    async setChatFollowState(s) { this.state = s; },
    async getChatFollowReplyHistory() { return this.history; },
    async addChatFollowReplyHistory(entry) { this.history.unshift(entry); return this.history; },
  };
  const sandbox = { Storage: sandboxStorage, Date, Object, Map, Promise, console, buildChatFollowConversations };
  const loadSyncPair = vm.runInNewContext(
    `async () => { const f = ${extractFn('handleChatFollowSync', bg)}; const g = ${extractFn('handleChatFollowMarkSent', bg)}; return { f, g }; }`,
    sandbox
  );
  const { f: syncFn, g: markFn } = await loadSyncPair();

  // 第一轮同步
  const r1 = await syncFn({ items });
  const targetId = r1.conversations.find(c => c.needReply)?.userId;
  if (!targetId) { console.log('❌ 第一轮同步后没有待回复会话'); process.exit(1); }
  const targetBefore = r1.conversations.find(c => c.userId === targetId);
  console.log(`第一轮同步：@${targetBefore.userName} 待回复=${targetBefore.needReply} pendingIdx=${targetBefore.pendingIdx} 原文="${targetBefore.pendingIncoming.slice(0, 20)}…" ✓`);

  // 模拟发送成功 → MarkSent
  await markFn({ userId: targetId, replyText: '好的呀，谢谢你喜欢！', lastRepliedIncoming: targetBefore.pendingIncoming });
  console.log('MarkSent 已记录 lastRepliedIncoming =', JSON.stringify(sandboxStorage.state.conversations[targetId].lastRepliedIncoming.slice(0, 20)) + '… ✓');
  // 验证回复历史追加（独立日志，最新在前）
  const histOk = sandboxStorage.history.length === 1
    && sandboxStorage.history[0].userId === targetId
    && sandboxStorage.history[0].replyText === '好的呀，谢谢你喜欢！'
    && sandboxStorage.history[0].repliedIncoming === targetBefore.pendingIncoming;
  console.log(`回复历史已记录：${sandboxStorage.history.length} 条（应1）内容=“${sandboxStorage.history[0] ? sandboxStorage.history[0].replyText.slice(0, 12) + '…' : ''}” ${histOk ? '✓' : '✗'}`);
  if (!histOk) ok = false;

  // 第二轮同步（页面数据不变 → 应判为已回复，不重复）
  const r2 = await syncFn({ items });
  const targetAfter = r2.conversations.find(c => c.userId === targetId);
  const dupOk = targetAfter.needReply === false && targetAfter.pendingIdx === -1
    && targetAfter.history[targetAfter.history.length - 1].role === 'assistant'
    && targetAfter.history[targetAfter.history.length - 1].content === '好的呀，谢谢你喜欢！';
  console.log(`重同步（无新消息）：needReply=${targetAfter.needReply} pendingIdx=${targetAfter.pendingIdx} history尾部assistant="${targetAfter.history.at(-1).content.slice(0, 15)}…" ${dupOk ? '✓ 防重复生效' : '✗'}`);
  if (!dupOk) ok = false;

  // 模拟对方又发来新消息（新提取：新通知插到最前 idx=0，原组 idx 整体 +1）
  const shifted = expectedItems
    .filter(i => i.userId === targetId)
    .map(i => ({ ...i, idx: i.idx + 1 }));
  const newMsg = { idx: 0, userId: targetId, userName: targetBefore.userName, time: '刚刚', incoming: '好的，那我也去买来试试！', myComment: '我的原评论', hasReplyBtn: true };
  const items2 = expectedItems.filter(i => i.userId !== targetId).concat(shifted, newMsg);
  const r3 = await syncFn({ items: items2 });
  const targetNew = r3.conversations.find(c => c.userId === targetId);
  const newOk = targetNew.needReply === true && targetNew.pendingIdx === 0 && targetNew.pendingIncoming === newMsg.incoming;
  console.log(`新消息到来：needReply=${targetNew.needReply} pendingIdx=${targetNew.pendingIdx} 原文="${targetNew.pendingIncoming.slice(0, 20)}…" ${newOk ? '✓ 恢复待回复' : '✗'}`);
  if (!newOk) ok = false;

  // 展示一个多轮会话的完整对话（如果有）
  const multi = Object.values(conversations).find(c => c.turnCount >= 2);
  if (multi) {
    console.log('\n=== 多轮会话完整对话（旧→新）示例 ===');
    multi.history.forEach((m, i) => {
      const who = m.role === 'user' ? '@' + multi.userName : (m.role === 'context' ? '我(原评论)' : '我(回复)');
      console.log(`  [${i + 1}] ${who}: ${m.content.slice(0, 60)}`);
    });
  }

  console.log('\n' + (ok ? '✅ 组装 + 防重复链路全部验证通过' : '❌ 存在验证失败项'));
  process.exit(ok ? 0 : 1);
})().catch(err => { console.error('防重复链路验证异常:', err); process.exit(1); });
