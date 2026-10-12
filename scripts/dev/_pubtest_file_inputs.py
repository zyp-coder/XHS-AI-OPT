# -*- coding: utf-8 -*-
"""侦察：三平台编辑器页面的 input[type=file]（含 iframe），决定扩展上传通路。"""
import sys, json, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from playwright.sync_api import sync_playwright

JS_FILES = r'''(() => {
  const out = [];
  document.querySelectorAll('input[type="file"]').forEach(e => {
    const r = e.getBoundingClientRect();
    out.push({
      accept: e.accept || '', multiple: e.multiple,
      name: e.name || '', id: e.id || '',
      cls: String(e.className || '').slice(0, 80),
      visible: (r.width > 0 && r.height > 0),
      x: Math.round(r.x), y: Math.round(r.y),
      parentChain: (() => { const c = []; let p = e.parentElement; for (let i = 0; i < 4 && p; i++) { c.push(p.tagName + (p.className ? '.' + String(p.className).split(' ')[0] : '')); p = p.parentElement; } return c; })()
    });
  });
  return out;
})()'''


def dump_page(p, host):
    print(f'== {host} ==', p.url)
    for fr in p.frames:
        try:
            res = fr.evaluate(JS_FILES)
        except Exception as ex:
            print(' frame(err):', (fr.url or '')[:80], ex)
            continue
        if res:
            print(' frame:', (fr.url or '')[0:90])
            print(json.dumps(res, ensure_ascii=False, indent=1))


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        for p in ctx.pages:
            u = p.url
            if 'creator.xiaohongshu.com' in u and 'publish' in u:
                dump_page(p, 'XHS')
            elif 'creator.douyin.com' in u and 'post' in u:
                dump_page(p, 'DOUYIN')
            elif 'channels.weixin.qq.com' in u:
                dump_page(p, 'CHANNELS')


if __name__ == '__main__':
    main()
