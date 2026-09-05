// 关键核查：没有 action-reply 的通知项特征（可能是"已回复过"的信号）
const fs = require('fs');
const h = fs.readFileSync('d:/AIproject/小红书运营/_notification_dom2.html', 'utf8');

function extractContainers(html) {
  const segs = [];
  let pos = 0;
  while (true) {
    const i = html.indexOf('class="container"', pos);
    if (i < 0) break;
    const start = html.lastIndexOf('<div', i);
    let depth = 0, k = start;
    while (k < html.length) {
      const nextOpen = html.indexOf('<div', k);
      const nextClose = html.indexOf('</div>', k);
      if (nextClose < 0) break;
      if (nextOpen >= 0 && nextOpen < nextClose) { depth++; k = nextOpen + 4; }
      else { depth--; k = nextClose + 6; if (depth <= 0) break; }
    }
    segs.push(html.slice(start, k));
    pos = i + 'class="container"'.length;
  }
  return segs;
}
function classText(seg, cls) {
  const m = seg.match(new RegExp('class="[^"]*' + cls + '[^"]*"[^>]*>'));
  if (!m) return '';
  const inner = seg.slice(m.index + m[0].length);
  const end = inner.search(/<div class="|<\/div>|<span class="|<\/span>/);
  const chunk = end < 0 ? inner : inner.slice(0, end);
  return chunk.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

const segs = extractContainers(h);
console.log('=== 无 action-reply 的通知项 ===');
segs.forEach((seg, idx) => {
  if (seg.includes('action-reply')) return;
  // 提取该段的可见文本特征
  const text = seg.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  console.log(`\n[idx${idx}] 无回复按钮`);
  console.log('  hint:', classText(seg, 'interaction-hint'));
  console.log('  对方:', classText(seg, 'interaction-content').slice(0, 60));
  console.log('  quote:', classText(seg, 'quote-info').slice(0, 60));
  console.log('  有action-like:', seg.includes('action-like'), '| 有like-active:', seg.includes('like-active'));
  console.log('  全文前200字:', text.slice(0, 200));
});

// 对比：有 action-reply 的 idx1 全文结构
console.log('\n=== 有 action-reply 的 idx1 结构（对比） ===');
const seg1 = segs[1];
console.log('  actions 区域:', seg1.slice(seg1.indexOf('class="actions"'), seg1.indexOf('class="actions"') + 400));
