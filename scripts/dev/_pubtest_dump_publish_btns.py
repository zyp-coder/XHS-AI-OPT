# -*- coding: utf-8 -*-
"""dump xhs 页面上所有 innerText 含「发布」的元素（结构/坐标/children）"""
import sys, json, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from playwright.sync_api import sync_playwright

JS = r'''(() => {
  const out = [];
  document.querySelectorAll('*').forEach(e => {
    const t = (e.innerText || '').trim();
    if (!t || t.length > 12) return;
    if (!/发布/.test(t)) return;
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    out.push({tag: e.tagName, cls: String(e.className || '').slice(0, 60), t,
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      kids: e.children.length});
  });
  return out;
})()'''

with sync_playwright() as pw:
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
    ctx = b.contexts[0]
    for p in ctx.pages:
        if 'creator.xiaohongshu.com' in p.url and 'publish' in p.url:
            p.bring_to_front()
            time.sleep(0.5)
            info = p.evaluate(JS)
            # 去重打印
            for e in info[:60]:
                print(json.dumps(e, ensure_ascii=False))
            print('total:', len(info))
            break
