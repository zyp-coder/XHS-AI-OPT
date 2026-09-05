// 分析通知页 DOM：交互类型、导航链接、时间戳、输入框
const h = require('fs').readFileSync('d:/AIproject/小红书运营/_notification_dom.html', 'utf8');

// 1. 搜私信字样
console.log('=== 私信字样 ===');
console.log('出现次数:', (h.match(/私信/g) || []).length);

// 2. interaction-hint 的所有不同文本
console.log('=== interaction-hint 类型 ===');
const hints = [...h.matchAll(/interaction-hint">([\s\S]*?)<\/div>/g)].map((m) =>
  m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
);
console.log([...new Set(hints)].slice(0, 12));

// 3. 页面导航链接（notification/message 相关）
console.log('=== 导航/消息链接 ===');
const nav = [...h.matchAll(/<a[^>]*href="([^"]*(?:notification|message|im)[^"]*)"[^>]*>([\s\S]*?)<\/a>/g)]
  .map((m) => ({ href: m[1].slice(0, 110), text: m[2].replace(/<[^>]+>/g, '').trim() }))
  .slice(0, 12);
nav.forEach((n) => console.log(`[${n.text}] ${n.href}`));

// 4. 时间戳全部样本
console.log('=== 时间戳样本 ===');
const times = [...new Set([...h.matchAll(/interaction-time">([^<]+)<\/span>/g)].map((m) => m[1]))];
console.log(times);

// 5. 通知项总数
console.log('=== 通知项统计 ===');
console.log('container 通知项数:', (h.match(/class="container"/g) || []).length);
console.log('回复按钮(action-reply):', (h.match(/action-reply/g) || []).length);
console.log('点赞按钮(action-like):', (h.match(/action-like/g) || []).length);
console.log('已赞(like-active):', (h.match(/like-active/g) || []).length);
console.log('用户链接(user/profile):', (h.match(/\/user\/profile\//g) || []).length);

// 6. 回复输入框相关
console.log('=== 输入框检测 ===');
console.log('contenteditable:', (h.match(/contenteditable/g) || []).length);
console.log('placeholder:', (h.match(/placeholder/g) || []).length);
console.log('comment-input/reply-input/editor:', (h.match(/comment-input|reply-input|editor/g) || []).slice(0, 8));

// 7. 时间分组标题（昨天/今天等独立分组）
console.log('=== 分组标题候选 ===');
const groupTitles = [...h.matchAll(/class="[^"]*(?:group|section|date)[^"]*"[^>]*>([^<]{1,20})<\/[a-z]+>/g)]
  .map((m) => m[1].trim())
  .filter((t) => /^(今天|昨天|前天|\d+天前|\d{1,2}月\d{1,2}日|更早)/.test(t));
console.log([...new Set(groupTitles)].slice(0, 10));
