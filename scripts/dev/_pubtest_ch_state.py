# -*- coding: utf-8 -*-
"""视频号摸底：content iframe 当前状态（表单在不在/有没有已挂视频/弹窗）。"""
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

JS_SCAN = r'''(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const inputs = [...document.querySelectorAll('input')].filter(vis).map(i => ({
    type: i.type, accept: i.accept, ph: i.placeholder, cls: String(i.className).slice(0, 40),
    v: i.type === 'file' ? ('files:' + i.files.length) : String(i.value).slice(0, 30),
  })).slice(0, 14);
  const eds = [...document.querySelectorAll('[contenteditable]')].filter(vis).map(e => ({
    cls: String(e.className).slice(0, 50), t: (e.textContent || '').replace(/\u200b/g, '').slice(0, 80),
  })).slice(0, 6);
  const btns = [...document.querySelectorAll('button')].filter(vis).map(b => ({
    t: (b.innerText || '').trim().slice(0, 16), cls: String(b.className).slice(0, 50), en: !b.disabled,
  })).slice(0, 14);
  const txt = (document.body.innerText || '').slice(0, 600);
  const dlg = [...document.querySelectorAll('[class*="dialog"],[class*="Dialog"]')].filter(vis)
    .map(d => String(d.className).slice(0, 50) + '::' + (d.innerText || '').replace(/\n/g, '|').slice(0, 60)).slice(0, 5);
  return { href: location.href, inputs, eds, btns, dlg, txt };
})()'''


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        page = next(p for p in ctx.pages if 'channels.weixin.qq.com/platform/post/create' in p.url)
        page.bring_to_front()
        time.sleep(0.5)
        fr = None
        for f in page.frames:
            if f.name == 'content' or '/micro/content/post/create' in (f.url or ''):
                fr = f
                break
        print('frame:', fr.url if fr else 'NONE')
        print('== scan ==', json.dumps(fr.evaluate(JS_SCAN), ensure_ascii=False, indent=1))
        page.screenshot(path='tmp/pubtest_shots/ch_state.png')
        print('shot -> tmp/pubtest_shots/ch_state.png')


if __name__ == '__main__':
    main()
