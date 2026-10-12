# -*- coding: utf-8 -*-
"""抖音：hook createElement 抓 detached input → 合成点击 → 塞文件 + change 验证上传。"""
import sys, base64, json, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from playwright.sync_api import sync_playwright

SHOTS = 'tmp/pubtest_shots'
IMG = '.tmpcheck/card-bw-正面.png'

JS_HOOK_AND_CLICK = r'''(() => {
  if (!window.__np_hooked) {
    window.__np_hooked = true;
    window.__np_inputs = [];
    const orig = document.createElement;
    document.createElement = function(tag, ...rest) {
      const el = orig.call(this, tag, ...rest);
      try { if (String(tag).toLowerCase() === 'input') window.__np_inputs.push(el); } catch (e) {}
      return el;
    };
  }
  const btn = [...document.querySelectorAll('button')].find(b => (b.innerText || '').trim() === '继续添加');
  if (!btn) return 'no-btn';
  const r = btn.getBoundingClientRect();
  const opts = {bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2};
  btn.dispatchEvent(new PointerEvent('pointerdown', opts));
  btn.dispatchEvent(new MouseEvent('mousedown', opts));
  btn.dispatchEvent(new PointerEvent('pointerup', opts));
  btn.dispatchEvent(new MouseEvent('mouseup', opts));
  btn.dispatchEvent(new MouseEvent('click', opts));
  const files = window.__np_inputs.filter(i => i.type === 'file');
  return {created: window.__np_inputs.length, fileInputs: files.length,
    lastAccept: files.length ? files[files.length - 1].accept : ''};
})()'''

JS_FEED = r'''(args => {
  const {b64, name} = args;
  const files = window.__np_inputs.filter(i => i.type === 'file');
  if (!files.length) return 'no-file-input-captured';
  const inp = files[files.length - 1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const file = new File([arr], name, {type: 'image/png'});
  const dt = new DataTransfer();
  dt.items.add(file);
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change', {bubbles: true}));
  return 'fed:' + inp.files.length;
})(%s)'''

JS_COUNT = r'''(() => {
  const m = document.body.innerText.match(/已添加(\d+)张图片/);
  return m ? m[1] : 'n/a';
})()'''


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        for p in ctx.pages:
            if 'creator.douyin.com' in p.url and 'post' in p.url:
                p.bring_to_front()
                time.sleep(0.4)
                print('count before:', p.evaluate(JS_COUNT))
                r = p.evaluate(JS_HOOK_AND_CLICK)
                print('hook+click:', json.dumps(r, ensure_ascii=False))
                time.sleep(0.3)
                b64 = base64.b64encode(open(IMG, 'rb').read()).decode()
                feed = p.evaluate(JS_FEED % json.dumps({'b64': b64, 'name': 'card-bw-正面.png'}))
                print('feed:', feed)
                for i in range(6):
                    time.sleep(1.0)
                    c = p.evaluate(JS_COUNT)
                    print(f'  t+{i+1}s count:', c)
                    if c == '3':
                        break
                p.screenshot(path=f'{SHOTS}/douyin_after_hook_feed.png')
                return


if __name__ == '__main__':
    main()
