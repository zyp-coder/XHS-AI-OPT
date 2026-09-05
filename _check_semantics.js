// 核实通知页语义：interaction-hint 文案 + quote-info 的真实含义
const fs = require('fs');
const h = fs.readFileSync('d:/AIproject/小红书运营/_notification_dom2.html', 'utf8');

// 1. 所有 interaction-hint 的完整文本
console.log('=== interaction-hint 文案统计 ===');
const hints = [...h.matchAll(/class="[^"]*interaction-hint[^"]*"[^>]*>([\s\S]*?)<\/div>/g)];
const hintTexts = hints.map(m => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
const hintCount = {};
for (const t of hintTexts) hintCount[t] = (hintCount[t] || 0) + 1;
console.log(hintCount);

// 2. 找"我的回复"可能的结构：搜索关键文案
console.log('\n=== 搜索"回复了你的"等文案 ===');
for (const kw of ['回复了你的', '回复了你', '你的评论', 'TA回复了', '我回复']) {
  const n = (h.match(new RegExp(kw, 'g')) || []).length;
  console.log(`  "${kw}": ${n} 处`);
}

// 3. 检查是否有 "我的回复" 标识结构：quote-info 前的交互类型
console.log('\n=== 前 3 个 container 的 interaction-hint + interaction-content + quote-info 文本 ===');
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
for (let i = 0; i < Math.min(4, segs.length); i++) {
  console.log(`\n[idx${i}]`);
  console.log('  hint  :', classText(segs[i], 'interaction-hint'));
  console.log('  对方  :', classText(segs[i], 'interaction-content').slice(0, 50));
  console.log('  quote :', classText(segs[i], 'quote-info').slice(0, 50));
}

// 4. 找一条“没有 quote-info”的 container（如果存在，它代表什么？）
console.log('\n=== 无 quote-info 的 container 数 ===');
let noQuote = 0;
for (const seg of segs) if (!seg.includes('quote-info')) noQuote++;
console.log('  ', noQuote, '/', segs.length);
if (noQuote > 0) {
  const seg = segs.find(s => !s.includes('quote-info'));
  console.log('  示例 hint:', classText(seg, 'interaction-hint'), '| 对方:', classText(seg, 'interaction-content').slice(0, 40));
}
