# -*- coding: utf-8 -*-
"""抖音：合成点击建议下拉条目 → 是否落 data-mention 芯片。"""
import sys, json, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from playwright.sync_api import sync_playwright

SHOTS = 'tmp/pubtest_shots'

JS_CLICK_ITEM = r'''(() => {
  const item = document.querySelector('[class*="mention-suggest-item-container"]');
  if (!item) return {err: 'no-item'};
  const sub = item.innerHTML.slice(0, 300);
  const r = item.getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const opts = {bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window};
  const target = document.elementFromPoint(cx, cy) || item;
  const chain = [];
  let p = target;
  for (let i = 0; i < 5 && p; i++) { chain.push(p.tagName + (p.className ? '.' + String(p.className).split(' ')[0] : '')); p = p.parentElement; }
  target.dispatchEvent(new PointerEvent('pointerdown', opts));
  target.dispatchEvent(new MouseEvent('mousedown', opts));
  target.dispatchEvent(new PointerEvent('pointerup', opts));
  target.dispatchEvent(new MouseEvent('mouseup', opts));
  target.dispatchEvent(new MouseEvent('click', opts));
  return {clickedAt: chain, sub};
})()'''

JS_CHIPS = r'''(() => {
  const chips = [...document.querySelectorAll('[data-mention]')].map(e => (e.textContent || '').slice(0, 60));
  const ed = [...document.querySelectorAll('.zone-container[contenteditable], [contenteditable="true"]')]
    .find(e => { const r = e.getBoundingClientRect(); return r.width > 100 && r.height > 20; });
  const suggestOpen = !!document.querySelector('[class*="mention-suggest-mount-dom"]');
  return {chips, bodyText: ed ? (ed.textContent || '').slice(0, 300) : '', suggestOpen};
})()'''


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        for p in ctx.pages:
            if 'creator.douyin.com' in p.url and 'post' in p.url:
                p.bring_to_front()
                time.sleep(0.4)
                r = p.evaluate(JS_CLICK_ITEM)
                print('click:', json.dumps(r, ensure_ascii=False))
                time.sleep(1.4)
                info = p.evaluate(JS_CHIPS)
                print('after:', json.dumps(info, ensure_ascii=False, indent=1))
                p.screenshot(path=f'{SHOTS}/douyin_after_item_click.png')
                return


if __name__ == '__main__':
    main()
