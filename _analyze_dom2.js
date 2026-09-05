// 分析第二份快照：回复框、发送按钮、分页
const h = require('fs').readFileSync('d:/AIproject/小红书运营/_notification_dom2.html', 'utf8');

// 第二个 textarea
console.log('=== 第二个 textarea 位置 ===');
const i1 = h.indexOf('<textarea');
const i2 = h.indexOf('<textarea', i1 + 10);
if (i2 >= 0) {
  console.log(h.slice(i2 - 700, i2 + 500));
} else {
  console.log('只有一个 textarea');
}

// 分页/加载更多
console.log('=== 分页/加载更多 ===');
const more = [...h.matchAll(/class="[^"]*(?:load-more|loadMore|more-btn|pagination|page-more)[^"]*"[^>]*>([\s\S]*?)<\/[a-z]+>/g)]
  .map((m) => m[1].replace(/<[^>]+>/g, '').trim())
  .slice(0, 5);
console.log(more);
console.log('加载更多:', (h.match(/加载更多/g) || []).length, '处; 查看更多:', (h.match(/查看更多/g) || []).length, '处');

// 数量对比
console.log('=== 数量统计 ===');
console.log('container:', (h.match(/class="container"/g) || []).length);
console.log('comment-input:', (h.match(/comment-input/g) || []).length);
console.log('submit按钮:', (h.match(/class="submit"/g) || []).length);
console.log('comment-wrapper:', (h.match(/comment-wrapper action-comment/g) || []).length);
console.log('action-reply:', (h.match(/action-reply/g) || []).length);
console.log('action-cancel:', (h.match(/action-cancel/g) || []).length);

// 发送按钮的完整标签
console.log('=== submit 按钮标签 ===');
const si = h.indexOf('class="submit"');
console.log(h.slice(si - 300, si + 200));
