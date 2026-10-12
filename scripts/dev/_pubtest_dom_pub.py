# -*- coding: utf-8 -*-
"""dump 小红书 / 抖音 发布按钮候选结构（不点击） + 小红书「笔记管理」入口"""
import sys, json
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

JS_XHS_DUMP = """(() => {
  const roots = [document]; const seen = new Set(); const notes = [];
  const push = (r, how) => { if (r && !seen.has(r)) { seen.add(r); roots.push(r); notes.push(how); } };
  (window.__npaShadowRoots || []).forEach((r, i) => push(r, 'hook' + i));
  const walk = (node) => { let els = []; try { els = node.querySelectorAll('*'); } catch (e) { return; }
    for (const el of els) { if (el.shadowRoot) { push(el.shadowRoot, 'open:' + el.tagName); walk(el.shadowRoot); } } };
  walk(document);
  const cands = [];
  for (let ri = 0; ri < roots.length; ri++) {
    const root = roots[ri]; let els = [];
    try { els = root.querySelectorAll('button,div,span,a'); } catch (e) { continue; }
    for (const e of els) {
      const t = (e.innerText || '').trim();
      if (t !== '发布') continue;
      const r = e.getBoundingClientRect();
      cands.push({ root: ri === 0 ? 'doc' : (notes[ri - 1] || ('r' + ri)), tag: e.tagName,
        cls: String(e.className || '').slice(0, 110), kids: e.children.length,
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        disabledProp: e.disabled === undefined ? null : !!e.disabled,
        aria: e.getAttribute ? e.getAttribute('aria-disabled') : null,
        disCls: /disabled/i.test(String(e.className || '')),
        parent: e.parentElement ? (e.parentElement.tagName + '.' + String(e.parentElement.className || '').slice(0, 70)) : null,
        html: (e.outerHTML || '').replace(/\\s+/g, ' ').slice(0, 260) });
    }
  }
  const menu = [];
  for (const e of document.querySelectorAll('a,div,span,li')) {
    const t = (e.innerText || '').trim();
    if (t !== '笔记管理') continue;
    const a = e.closest('a');
    menu.push({ tag: e.tagName, href: (a && a.href) || e.href || '', cls: String(e.className || '').slice(0, 80) });
  }
  return { shadowRoots: roots.length, cands: cands, menu: menu.slice(0, 5) };
})()"""

JS_DY_DUMP = """(() => {
  const cands = [];
  for (const e of document.querySelectorAll('button,div,span')) {
    const t = (e.innerText || '').trim();
    if (!/^(发布|发布并保存|保存草稿|暂存离开)$/.test(t)) continue;
    if (e.children.length > 2) continue;
    const r = e.getBoundingClientRect();
    if (r.width <= 0) continue;
    cands.push({ tag: e.tagName, cls: String(e.className || '').slice(0, 100), kids: e.children.length,
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      disabledProp: e.disabled === undefined ? null : !!e.disabled,
      aria: e.getAttribute ? e.getAttribute('aria-disabled') : null,
      disCls: /disabled/i.test(String(e.className || '')),
      parent: e.parentElement ? (e.parentElement.tagName + '.' + String(e.parentElement.className || '').slice(0, 70)) : null });
  }
  cands.sort((a, b) => a.y - b.y);
  return { cands: cands };
})()"""

with sync_playwright() as p:
    b = p.chromium.connect_over_cdp('http://127.0.0.1:9333')
    ctx = b.contexts[0]
    for i, pg in enumerate(ctx.pages):
        u = pg.url
        if 'creator.xiaohongshu.com/publish' in u:
            r = pg.evaluate(JS_XHS_DUMP)
            print('== XHS tab %d | shadowRoots=%s | menu=%s ==' % (i, r.get('shadowRoots'), json.dumps(r.get('menu'), ensure_ascii=False)))
            for c in r.get('cands') or []:
                print(json.dumps(c, ensure_ascii=False))
            print()
        elif 'creator.douyin.com/creator-micro/content/post' in u:
            r = pg.evaluate(JS_DY_DUMP)
            print('== DY tab %d | cands=%s ==' % (i, len(r.get('cands') or [])))
            for c in r.get('cands') or []:
                print(json.dumps(c, ensure_ascii=False))
            print()
