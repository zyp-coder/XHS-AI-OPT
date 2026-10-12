# -*- coding: utf-8 -*-
"""测试：合成事件点击小红书话题下拉条目 → 是否落芯片；以及抖音 data-mention 细查。"""
import sys, json, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from playwright.sync_api import sync_playwright

SHOTS = 'tmp/pubtest_shots'

JS_XHS_TOPICS = "() => document.querySelectorAll('.tiptap.ProseMirror a.tiptap-topic').length"

JS_XHS_CLICK_ITEM = r'''(() => {
  // 点 dropdown 第一条 .item（tippy 浮层内的）
  const boxes = [...document.querySelectorAll('.tippy-box')].filter(b => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && b.querySelector('.item');
  });
  if (!boxes.length) return 'no-tippy';
  const box = boxes[0];
  const item = box.querySelector('.item');
  if (!item) return 'no-item';
  const r = item.getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const opts = {bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window};
  const fire = (type, Ctor) => {
    const el = document.elementFromPoint(cx, cy);
    const target = el || item;
    target.dispatchEvent(new Ctor(type, opts));
  };
  fire('pointerdown', PointerEvent);
  fire('mousedown', MouseEvent);
  fire('pointerup', PointerEvent);
  fire('mouseup', MouseEvent);
  fire('click', MouseEvent);
  return 'clicked:' + (box.querySelector('.item .name') || {}).innerText;
})()'''


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        for p in ctx.pages:
            u = p.url
            if 'creator.xiaohongshu.com' in u:
                p.bring_to_front()
                time.sleep(0.5)
                before = p.evaluate(JS_XHS_TOPICS)
                r = p.evaluate(JS_XHS_CLICK_ITEM)
                print('XHS click result:', r, '| topics before:', before)
                time.sleep(1.6)
                after = p.evaluate(JS_XHS_TOPICS)
                print('XHS topics after:', after)
                # dump 正文里的芯片文本
                txts = p.evaluate("() => [...document.querySelectorAll('.tiptap.ProseMirror a.tiptap-topic')].map(a=>a.innerText)")
                print('chips:', json.dumps(txts, ensure_ascii=False))
                p.screenshot(path=f'{SHOTS}/xhs_after_item_click.png')
            elif 'creator.douyin.com' in u:
                p.bring_to_front()
                time.sleep(0.5)
                info = p.evaluate(r'''(() => {
                  const out = {mentions: [], bodyText: ''};
                  document.querySelectorAll('[data-mention]').forEach(e => {
                    const r = e.getBoundingClientRect();
                    out.mentions.push({tag: e.tagName, attr: e.getAttribute('data-mention'),
                      text: (e.textContent || '').slice(0, 50), x: Math.round(r.x), y: Math.round(r.y),
                      html: e.outerHTML.slice(0, 260)});
                  });
                  const ed = document.querySelector('.zone-container[contenteditable], [contenteditable="true"]');
                  if (ed) out.bodyText = (ed.textContent || '').slice(0, 300);
                  return out;
                })()''')
                print('== DOUYIN ==')
                print(json.dumps(info, ensure_ascii=False, indent=1))
                p.screenshot(path=f'{SHOTS}/douyin_dd_fine.png')


if __name__ == '__main__':
    main()
