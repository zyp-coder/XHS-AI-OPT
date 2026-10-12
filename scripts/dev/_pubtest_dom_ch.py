# -*- coding: utf-8 -*-
"""dump 视频号 iframe 里「发表/发布」附近的 DOM 结构（不点击）"""
import sys, json
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

JS_DUMP = """(() => {
  const findDoc = () => {
    if (document.querySelector('.input-editor, [class*="input-editor"]')) return document;
    for (const f of document.querySelectorAll('iframe')) {
      let d = null; try { d = f.contentDocument; } catch (e) { continue; }
      if (d && d.querySelector('.input-editor, [class*="input-editor"]')) return d;
    }
    return null;
  };
  const doc = findDoc();
  if (!doc) return { ok: false, msg: 'no form' };
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const cands = [];
  for (const e of doc.querySelectorAll('button,div,span,a')) {
    const t = (e.innerText || '').trim();
    if (!/^(发表|发布|保存草稿|手机预览)$/.test(t)) continue;
    const r = e.getBoundingClientRect();
    cands.push({
      tag: e.tagName, cls: String(e.className || '').slice(0, 110),
      kids: e.children.length, y: Math.round(r.y), x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height),
      vis: vis(e), disabledProp: e.disabled === undefined ? null : !!e.disabled,
      disAttr: e.hasAttribute ? e.hasAttribute('disabled') : null,
      aria: e.getAttribute ? e.getAttribute('aria-disabled') : null,
      parent: e.parentElement ? (e.parentElement.tagName + '.' + String(e.parentElement.className || '').slice(0, 80)) : null,
      html: (e.outerHTML || '').replace(/\\s+/g, ' ').slice(0, 340)
    });
  }
  cands.sort((a, b) => a.y - b.y || a.x - b.x);
  return { ok: true, cands: cands };
})()"""

with sync_playwright() as p:
    b = p.chromium.connect_over_cdp('http://127.0.0.1:9333')
    ctx = b.contexts[0]
    for i, pg in enumerate(ctx.pages):
        if '/platform/post/create' not in pg.url:
            continue
        r = pg.evaluate(JS_DUMP)
        print('== tab %d | ok=%s cands=%s ==' % (i, r.get('ok'), len(r.get('cands') or [])))
        for c in (r.get('cands') or []):
            print(json.dumps(c, ensure_ascii=False))
        print()
