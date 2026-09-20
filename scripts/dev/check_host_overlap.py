# -*- coding: utf-8 -*-
"""检查各幕文字与右下角形象的关系：重叠面积 + 越界元素

输出每幕：
  ov   文字墨迹与 #host 盒子的最大重叠面积（px²，理想为 0）
  maxX 落在形象高度区间内的文字，最靠右的右边界（px，需 < host.left）
  low  该幕文字最低点 y
"""
import pathlib, json
from playwright.sync_api import sync_playwright

BASE = pathlib.Path(r'd:\AIproject\小红书运营\资料\视频\AI雕兄口播稿')
JOBS = [('竖屏', BASE / 'AI雕兄-动效演示-竖屏.html', 1080, 1920, 19),
        ('横屏', BASE / 'AI雕兄-动效演示.html', 1920, 1080, 19)]

JS = """async () => {
  const host = document.getElementById('hostwrap');
  const hp = document.getElementById('host').getBoundingClientRect();
  const np = document.getElementById('nameplate').getBoundingClientRect();
  const scenes = [...document.querySelectorAll('.scene')];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const out = [];
  for (const sc of scenes) {
    scenes.forEach(s => s.classList.remove('active'));
    sc.classList.add('active');
    await sleep(1500);                       // 等入场动画走完再量，避免量到动画中途的位置
    const kk0 = sc.querySelector('.kicker');
    const items = [];
    const w = document.createTreeWalker(sc, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (!n.data.trim()) continue;
      const r = document.createRange();
      r.selectNodeContents(n);
      const inKick = !!(kk0 && n.parentElement && kk0.contains(n.parentElement));
      for (const rc of r.getClientRects())
        if (rc.width > 2 && rc.height > 2) items.push({ rc, t: n.data.trim().slice(0, 16), inKick });
    }
    // 配图等非文字墨迹：[data-ink] 容器（必须是几何稳定的容器，不能挂在播放入场动画的元素上）
    sc.querySelectorAll('[data-ink]').forEach(el => {
      const rc = el.getBoundingClientRect();
      const im = el.querySelector('img');
      if (rc.width > 2 && rc.height > 2) items.push({ rc, t: 'IMG:' + (im ? im.id : '?'), inKick: false });
    });
    const hitIn = (h, arr) => {
      let worst = 0, s = '';
      arr.forEach(o => {
        const x = Math.min(h.right, o.rc.right) - Math.max(h.left, o.rc.left);
        const y = Math.min(h.bottom, o.rc.bottom) - Math.max(h.top, o.rc.top);
        if (x > 0 && y > 0) { const a = x * y; if (a > worst) { worst = a; s = o.t; } }
      });
      return [Math.round(worst), s];
    };
    const hit = (h) => hitIn(h, items);
    let maxX = 0, maxXt = '', low = 0;
    items.forEach(o => {
      if (o.rc.bottom > hp.top) { if (o.rc.right > maxX) { maxX = o.rc.right; maxXt = o.t; } }
      if (o.rc.bottom > low) low = o.rc.bottom;
    });
    const [hOv, hT] = hit(hp), [nOv, nT] = hit(np);
    const kk = sc.querySelector('.kicker');
    const kb = kk ? kk.getBoundingClientRect() : null;
    const [kOv, kT] = kb ? hitIn(kb, items.filter(o => !o.inKick)) : [0, ''];
    // 孤行：折行后最后一行过短（只剩一两个字）
    const wid = [];
    const w2 = document.createTreeWalker(sc, NodeFilter.SHOW_TEXT);
    let n2;
    while ((n2 = w2.nextNode())) {
      const s = n2.data.trim();
      if (!s) continue;
      const r2 = document.createRange();
      r2.selectNodeContents(n2);
      const rcs = [...r2.getClientRects()].filter(x => x.width > 2 && x.height > 2);
      if (rcs.length < 2) continue;
      const byTop = {};
      rcs.forEach(rc => { const k = Math.round(rc.top / 6); byTop[k] = (byTop[k] || 0) + rc.width; });
      const ws = Object.keys(byTop).sort((a, b) => a - b).map(k => byTop[k]);
      const mx = Math.max.apply(null, ws);
      if (ws[ws.length - 1] < mx * 0.3) wid.push(s.slice(0, 18) + '  ' + ws.map(v => Math.round(v)).join('/'));
    }
    out.push({ n: sc.dataset.name, h: hOv, ht: hT, no: nOv, nt: nT, ko: kOv, kt: kT,
               mx: Math.round(maxX), mxt: maxXt, low: Math.round(low), wid,
               kx: kb ? Math.round(kb.right) : 0, kw: kb ? Math.round(kb.width) : 0 });
  }
  return JSON.stringify({
    host: [Math.round(hp.left), Math.round(hp.top), Math.round(hp.width), Math.round(hp.height)],
    np: [Math.round(np.left), Math.round(np.top), Math.round(np.width), Math.round(np.height)],
    out });
}"""

with sync_playwright() as p:
    b = p.chromium.launch()
    for label, html, w, h, n in JOBS:
        pg = b.new_page(viewport={'width': w, 'height': h})
        pg.goto(html.as_uri() + '#1')
        pg.wait_for_timeout(2800)
        d = json.loads(pg.evaluate(JS))
        print('==', label, 'host', d['host'], ' nameplate', d['np'])
        margin = 70 if label == '竖屏' else 120
        for r in d['out']:
            flag = 'OVERLAP' if r['h'] > 0 else ('  tight' if r['mx'] > d['host'][0] else '     ok')
            print('  %-7s %-18s host%6d  maxX%5d  low%5d  题头宽%4d 右%4d%s  | %s' %
                  (flag, r['n'], r['h'], r['mx'], r['low'], r['kw'], r['kx'],
                   ' 越界!' if r['kx'] > w - margin else '     ',
                   r['ht'] if r['h'] > 0 else (r['mxt'] if r['mx'] > d['host'][0] else '')))
            if r['no'] > 0:
                print('           ^^ 与名牌重叠 %d px²  %s' % (r['no'], r['nt']))
            if r.get('ko', 0) > 0:
                print('           ^^ 与题头重叠 %d px²  %s' % (r['ko'], r['kt']))
            for wl in r.get('wid', []):
                print('           孤行: ' + wl)
        pg.close()
    b.close()
