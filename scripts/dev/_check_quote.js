// 检查 idx0 / idx1 的 quote-info 原始 HTML
const fs = require('fs');
const h = fs.readFileSync('d:/AIproject/小红书运营/_notification_dom2.html', 'utf8');

const i0 = h.indexOf('class="container"');
const i1 = h.indexOf('class="container"', i0 + 10);

function showQuote(segStart, label) {
  const qi = h.indexOf('quote-info', segStart);
  if (qi < 0) { console.log(label + ': 无 quote-info'); return; }
  console.log('=== ' + label + ' quote-info 区域 ===');
  console.log(h.slice(qi - 150, qi + 800));
  console.log('');
}

showQuote(i0, 'idx0');
showQuote(i1, 'idx1');
