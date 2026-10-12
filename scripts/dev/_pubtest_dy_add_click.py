# -*- coding: utf-8 -*-
"""抖音：点「继续添加」→ 观察 filechooser 与 input 是否常驻 DOM。"""
import sys, json, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from playwright.sync_api import sync_playwright

JS_COUNT_FILES = "() => [...document.querySelectorAll('input[type=file]')].map(e => ({accept: e.accept, multiple: e.multiple, value: (e.value||'').slice(0,60), connected: e.isConnected}))"

JS_CLICK_ADD = r'''(() => {
  const btn = [...document.querySelectorAll('button')].find(b => (b.innerText || '').trim() === '继续添加');
  if (!btn) return 'no-btn';
  const r = btn.getBoundingClientRect();
  const opts = {bubbles: true, cancelable: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2, view: window};
  btn.dispatchEvent(new PointerEvent('pointerdown', opts));
  btn.dispatchEvent(new MouseEvent('mousedown', opts));
  btn.dispatchEvent(new PointerEvent('pointerup', opts));
  btn.dispatchEvent(new MouseEvent('mouseup', opts));
  btn.dispatchEvent(new MouseEvent('click', opts));
  return 'clicked';
})()'''


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        for p in ctx.pages:
            if 'creator.douyin.com' in p.url and 'post' in p.url:
                p.bring_to_front()
                time.sleep(0.4)
                print('before:', p.evaluate(JS_COUNT_FILES))

                got = {'fc': False}
                def on_fc(fc):
                    got['fc'] = True
                    got['multiple'] = fc.is_multiple()
                p.on('filechooser', on_fc)
                r = p.evaluate(JS_CLICK_ADD)
                print('click:', r)
                time.sleep(1.5)
                print('filechooser fired:', got)
                print('after:', p.evaluate(JS_COUNT_FILES))
                p.screenshot(path='tmp/pubtest_shots/douyin_add_clicked.png')

                if got['fc']:
                    # 关掉原生对话框：用 CDP Escape
                    try:
                        cdp = ctx.new_cdp_session(p)
                        for t in ('rawKeyDown', 'keyUp'):
                            cdp.send('Input.dispatchKeyEvent', {'type': t, 'key': 'Escape', 'code': 'Escape', 'windowsVirtualKeyCode': 27, 'nativeVirtualKeyCode': 27})
                        cdp.detach()
                        print('esc sent')
                    except Exception as ex:
                        print('esc err:', ex)
                    time.sleep(0.8)
                    print('after-esc:', p.evaluate(JS_COUNT_FILES))
                return


if __name__ == '__main__':
    main()
