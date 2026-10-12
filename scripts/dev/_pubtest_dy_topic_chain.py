# -*- coding: utf-8 -*-
"""抖音：合成聚焦 + 打字开建议下拉 → dump 条目结构（第二步再点）。"""
import sys, json, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from playwright.sync_api import sync_playwright

SHOTS = 'tmp/pubtest_shots'

JS_FOCUS_TYPE = r'''(() => {
  const eds = [...document.querySelectorAll('.zone-container[contenteditable], [contenteditable="true"]')];
  const ed = eds.find(e => { const r = e.getBoundingClientRect(); return r.width > 100 && r.height > 20; });
  if (!ed) return 'no-editor';
  const r = ed.getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const opts = {bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window};
  ed.dispatchEvent(new PointerEvent('pointerdown', opts));
  ed.dispatchEvent(new MouseEvent('mousedown', opts));
  ed.dispatchEvent(new PointerEvent('pointerup', opts));
  ed.dispatchEvent(new MouseEvent('mouseup', opts));
  ed.dispatchEvent(new MouseEvent('click', opts));
  ed.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(ed);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  document.execCommand('insertText', false, ' #冒烟话题丙');
  return 'typed';
})()'''

JS_DUMP_SUGGEST = r'''(() => {
  const items = [];
  document.querySelectorAll('[class*="mention-suggest"]').forEach(e => {
    const r = e.getBoundingClientRect();
    const visible = r.width > 0 && r.height > 0;
    items.push({tag: e.tagName, cls: String(e.className).slice(0, 100), text: (e.innerText || '').trim().slice(0, 50),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), visible});
  });
  const chips = [...document.querySelectorAll('[data-mention]')].map(e => (e.textContent || '').slice(0, 40));
  return {items, chips};
})()'''


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        for p in ctx.pages:
            if 'creator.douyin.com' in p.url and 'post' in p.url:
                p.bring_to_front()
                time.sleep(0.6)
                r = p.evaluate(JS_FOCUS_TYPE)
                print('focus+type:', r)
                time.sleep(1.2)
                info = p.evaluate(JS_DUMP_SUGGEST)
                print(json.dumps(info, ensure_ascii=False, indent=1))
                p.screenshot(path=f'{SHOTS}/douyin_typed_suggest.png')
                return


if __name__ == '__main__':
    main()
