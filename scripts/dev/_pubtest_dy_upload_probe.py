# -*- coding: utf-8 -*-
"""抖音：dump 上传相关按钮/区域结构（含已传图片后的添加入口）。"""
import sys, json, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from playwright.sync_api import sync_playwright

SHOTS = 'tmp/pubtest_shots'

JS_PROBE = r'''(() => {
  const out = [];
  const kw = ['上传', '添加', '继续', '拖拽', '点击'];
  document.querySelectorAll('button,div,span,a,label').forEach(e => {
    if (e.children.length > 4) return;
    const txt = (e.innerText || '').trim();
    if (!txt || txt.length > 20) return;
    if (!kw.some(k => txt.includes(k))) return;
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    out.push({tag: e.tagName, txt, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      cls: String(e.className || '').slice(0, 70)});
  });
  // 缩略图区域 & 添加钮附近
  const thumbs = [];
  document.querySelectorAll('[class*="upload"], [class*="image-list"], [class*="img-list"], [class*="material"]').forEach(e => {
    const r = e.getBoundingClientRect();
    if (r.width < 40 || r.height < 40 || r.width > 600) return;
    thumbs.push({tag: e.tagName, cls: String(e.className || '').slice(0, 80), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)});
  });
  return {candidates: out.slice(0, 40), zones: thumbs.slice(0, 25)};
})()'''


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        for p in ctx.pages:
            if 'creator.douyin.com' in p.url and 'post' in p.url:
                p.bring_to_front()
                time.sleep(0.5)
                info = p.evaluate(JS_PROBE)
                print(json.dumps(info, ensure_ascii=False, indent=1))
                p.screenshot(path=f'{SHOTS}/douyin_probe_upload.png')
                return


if __name__ == '__main__':
    main()
