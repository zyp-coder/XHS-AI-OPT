# -*- coding: utf-8 -*-
"""抖音：合成 drop（DataTransfer 塞文件）到上传区 → 是否触发上传。"""
import sys, base64, json, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from playwright.sync_api import sync_playwright

SHOTS = 'tmp/pubtest_shots'
IMG = '.tmpcheck/card-bw-正面.png'

JS_DROP = r'''(args => {
  const {b64, name} = args;
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const file = new File([arr], name, {type: 'image/png'});
  const dt = new DataTransfer();
  dt.items.add(file);

  // 候选 dropzone：缩略图区块 / 继续添加按钮 / 编辑器内容块
  const zones = [];
  const addBtn = [...document.querySelectorAll('button')].find(b => (b.innerText || '').trim() === '继续添加');
  if (addBtn) zones.push(addBtn);
  const info = [...document.querySelectorAll('div')].find(e => /已添加\d+张图片/.test(e.innerText || '') && e.innerText.length < 40);
  if (info) zones.push(info);
  const edc = document.querySelector('[class*="content-child-"]');
  if (edc) zones.push(edc);
  if (!zones.length) return 'no-zone';

  const results = [];
  for (const z of zones) {
    const r = z.getBoundingClientRect();
    const common = {bubbles: true, cancelable: true, dataTransfer: dt, view: window,
      clientX: r.x + r.width / 2, clientY: r.y + r.height / 2};
    try {
      z.dispatchEvent(new DragEvent('dragenter', common));
      z.dispatchEvent(new DragEvent('dragover', common));
      z.dispatchEvent(new DragEvent('drop', common));
      results.push('fired:' + (z.innerText || '').slice(0, 12));
    } catch (e) { results.push('err:' + e.message); }
  }
  return results.join(' | ');
})(%s)'''

JS_COUNT = r'''(() => {
  const t = document.body.innerText;
  const m = t.match(/已添加(\d+)张图片/);
  const thumbs = document.querySelectorAll('[class*="material-item"], [class*="image-item"], [class*="img-item"]').length;
  return {added: m ? m[1] : 'n/a', thumbs};
})()'''


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        for p in ctx.pages:
            if 'creator.douyin.com' in p.url and 'post' in p.url:
                p.bring_to_front()
                time.sleep(0.4)
                print('before:', p.evaluate(JS_COUNT))
                b64 = base64.b64encode(open(IMG, 'rb').read()).decode()
                args = json.dumps({'b64': b64, 'name': 'card-bw-正面.png'})
                r = p.evaluate(JS_DROP % args)
                print('drop:', r)
                time.sleep(3.0)
                print('after:', p.evaluate(JS_COUNT))
                p.screenshot(path=f'{SHOTS}/douyin_after_drop.png')
                return


if __name__ == '__main__':
    main()
