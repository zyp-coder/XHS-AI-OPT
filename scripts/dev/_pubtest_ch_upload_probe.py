# -*- coding: utf-8 -*-
"""视频号上传通路诊断：列全部 file input → 装 change 监听 → 重设文件 → 观察
change 日志 / video src 变没变 / 有没有出现上传中字样。"""
import base64
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

ROOT = 'D:\\AIproject\\小红书运营'
VIDEO = ROOT + '\\资料\\视频\\客户模板样片\\演示片-六幕四版式.mp4'

JS_LIST_INPUTS = r'''(() => {
  return [...document.querySelectorAll('input[type="file"]')].map(i => {
    const r = i.getBoundingClientRect();
    return { accept: i.accept, multiple: i.multiple, cls: String(i.className).slice(0, 60),
             vis: r.width > 0 && r.height > 0, r: [Math.round(r.x), Math.round(r.y)],
             parent: String((i.parentElement && i.parentElement.className) || '').slice(0, 70),
             gp: String((i.parentElement && i.parentElement.parentElement && i.parentElement.parentElement.className) || '').slice(0, 70) };
  });
})()'''

JS_ARM = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  window.__chLog = [];
  document.addEventListener('change', e => {
    const t = e.target;
    window.__chLog.push({ tag: t.tagName, type: t.type || '', n: t.files ? t.files.length : -1,
                          name: t.files && t.files[0] ? t.files[0].name : '' });
  }, true);
  window.__chBefore = (document.querySelector('video') || {}).src || null;
  const inp = document.querySelector('input[type="file"][accept*="video"]');
  if (!inp) return { ok: false, msg: '没有 video 类 file input' };
  window.__chInp = inp;
  return { ok: true, before: window.__chBefore, inpAccept: inp.accept };
})()'''

JS_FEED = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const inp = window.__chInp;
  const txt = window.__VIDB64__;
  const bin = atob(txt);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const f = new File([arr], '演示片-六幕四版式.mp4', { type: 'video/mp4' });
  const dt = new DataTransfer();
  dt.items.add(f);
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(2500);
  const v = document.querySelector('video');
  const tip = (document.body.innerText || '');
  return { after: v ? String(v.currentSrc || v.src).slice(0, 50) : null,
           changed: (v ? String(v.currentSrc || v.src) : '') !== (window.__chBefore || ''),
           log: window.__chLog,
           uploading: /上传中|正在上传|处理中|转码|%.{0,2}发送/.test(tip) ? tip.slice(0, 80) : null };
})()'''


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        page = next(p for p in ctx.pages if 'channels.weixin.qq.com/platform/post/create' in p.url)
        page.bring_to_front()
        time.sleep(0.5)
        fr = next(f for f in page.frames if '/micro/content/post/create' in (f.url or ''))

        print('== inputs ==', json.dumps(fr.evaluate(JS_LIST_INPUTS), ensure_ascii=False, indent=1))
        print('== arm ==', json.dumps(fr.evaluate(JS_ARM), ensure_ascii=False))

        b64 = base64.b64encode(open(VIDEO, 'rb').read()).decode('ascii')
        fr.evaluate('window.__VIDB64__ = ' + json.dumps(b64))
        print('b64 注入完成', len(b64))
        print('== feed ==', json.dumps(fr.evaluate(JS_FEED), ensure_ascii=False, indent=1))
        time.sleep(3)
        print('== 3s 后 ==', json.dumps(fr.evaluate('''(() => {
          const v = document.querySelector('video');
          return { src: v ? String(v.currentSrc || v.src).slice(0, 50) : null, log: window.__chLog };
        })()'''), ensure_ascii=False))
        page.screenshot(path='tmp/pubtest_shots/ch_feed_test.png')


if __name__ == '__main__':
    main()
