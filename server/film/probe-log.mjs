// 把 /api/film/probe 的返回打印成人话（安装脚本收尾用）
let s = '';
process.stdin.on('data', (d) => { s += d; }).on('end', () => {
  let j;
  try { j = JSON.parse(s); } catch { console.log('      返回看不懂：' + s.slice(0, 200)); return; }
  if (!j.ok && j.error) { console.log('      体检被挡了：' + j.error); return; }
  const v = j.env || {};
  const rows = [
    ['能不能出片', v.ok ? '能' : '不能，下面缺哪样补哪样'],
    ['念稿用的 python', v.python],
    ['念稿库', v.lib],
    ['量片长的工具', v.ffprobe],
    ['画画面的浏览器', v.browser],
    ['压片合声的剪辑工具', v.ffmpeg],
    ['每人每天', v.daily + ' 条'],
    ['一次同时跑', v.conc + ' 条'],
    ['一条最长', v.maxSecs + ' 秒'],
    ['当下排队', v.queued + ' 条、在跑 ' + v.running + ' 条'],
  ];
  for (const [k, x] of rows) console.log('      ' + k + '：' + (x || '？'));
});
