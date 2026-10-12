# -*- coding: utf-8 -*-
"""排查 xhs 底部「发布」按钮：页面可见但 querySelectorAll 找不到。
手段：① 打印当前页 URL / viewport；② elementFromPoint 扫底部条带；
③ 递归（含 shadowRoot）找 textContent 恰为「发布」的叶子节点；④ dump 全部可见 button。"""
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

JS = r"""
() => {
  const out = { url: location.href, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio };

  // ① elementFromPoint 扫底部条带（y 从 vh-140 到 vh-5）
  const pts = [];
  const seen = new Set();
  for (let x = 200; x <= Math.min(1900, innerWidth - 10); x += 40) {
    for (let y = innerHeight - 140; y <= innerHeight - 5; y += 25) {
      const el = document.elementFromPoint(x, y);
      if (!el) continue;
      const t = (el.textContent || '').trim();
      const key = el.tagName + '|' + String(el.className).slice(0, 60) + '|' + el.getBoundingClientRect().x + ',' + el.getBoundingClientRect().y;
      if (!seen.has(key)) {
        seen.add(key);
        const r = el.getBoundingClientRect();
        pts.push({ x, y, tag: el.tagName, cls: String(el.className).slice(0, 90),
          rx: Math.round(r.x), ry: Math.round(r.y), rw: Math.round(r.width), rh: Math.round(r.height),
          t: t.slice(0, 30) });
      }
    }
  }
  out.pts = pts;

  // ② 递归含 shadowRoot 找 textContent 恰为「发布」的节点（含叶子与非叶子，仅可见）
  const hits = [];
  const walk = (root, depth) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
      const t = (el.textContent || '').trim();
      if ((t === '发布' || t.endsWith('发布')) && t.length <= 4) {
        const r = el.getBoundingClientRect();
        if (r.width > 2 && r.height > 2) {
          hits.push({ depth, tag: el.tagName, cls: String(el.className).slice(0, 90),
            x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
            kids: el.children.length, txt: JSON.stringify(el.textContent) });
        }
      }
    }
  };
  walk(document, 0);
  out.hits = hits;

  // ③ 全部可见 button 递归 dump
  const btns = [];
  const walk2 = (root) => {
    for (const el of root.querySelectorAll('button,[role=button]')) {
      const r = el.getBoundingClientRect();
      if (r.width > 2 && r.height > 2) {
        btns.push({ tag: el.tagName, cls: String(el.className).slice(0, 70),
          x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
          t: (el.innerText || '').slice(0, 16) });
      }
    }
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk2(el.shadowRoot);
  };
  walk2(document);
  out.btns = btns;

  // ④ 底部最靠下的可见固定/粘性容器
  const bars = [];
  for (const el of document.querySelectorAll('div,footer,section,aside')) {
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.position === 'sticky') {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.width > 100) bars.push({ cls: String(el.className).slice(0, 80),
        pos: cs.position, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        t: (el.innerText || '').slice(0, 40) });
    }
  }
  out.bars = bars;
  return out;
}
"""

with sync_playwright() as p:
    b = p.chromium.connect_over_cdp('http://127.0.0.1:9333')
    ctx = b.contexts[0]
    page = None
    for pg in ctx.pages:
        if 'creator.xiaohongshu.com/publish' in pg.url:
            page = pg
            break
    if not page:
        print('!! 没找到 xhs 发布页，现有页面：')
        for pg in ctx.pages:
            print('  -', pg.url)
        sys.exit(1)
    res = page.evaluate(JS)
    print(json.dumps(res, ensure_ascii=False, indent=1))
