# -*- coding: utf-8 -*-
"""e2e 核收：三家最新标签终态扫描（跨同源 iframe 收集文档）＋补拍截图。只读不动。"""
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

SHOTS = 'tmp/pubtest_shots'
PLAT_URLS = {
    'xhs': 'creator.xiaohongshu.com',
    'douyin': 'creator.douyin.com',
    'channels': 'channels.weixin.qq.com',
}

JS_SCAN = r'''(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const docs = [document];
  for (const f of document.querySelectorAll('iframe')) { let d = null; try { d = f.contentDocument; } catch (e) { continue; } if (d) docs.push(d); }
  const grab = (fn) => { const out = []; for (const d of docs) { try { fn(d, out); } catch (e) {} } return out; };
  const editors = grab((d, out) => { d.querySelectorAll('[contenteditable]').forEach(e => { if (vis(e) && e.getBoundingClientRect().width > 120) out.push((e.textContent || '').replace(/\u200b/g, '').slice(0, 120)); }); });
  const titles = grab((d, out) => { d.querySelectorAll('input,textarea').forEach(i => { if (vis(i) && (i.value || '').trim() && /标题|title/i.test((i.placeholder || '') + (i.className || ''))) out.push(String(i.value).slice(0, 60)); }); });
  const videos = grab((d, out) => { d.querySelectorAll('video').forEach(v => { if (v.currentSrc || v.src) out.push(String(v.currentSrc || v.src).slice(0, 60)); }); });
  const btns = grab((d, out) => { d.querySelectorAll('button,div,span').forEach(e => { const t = (e.innerText || '').trim(); if ((t === '发布' || t === '发表' || t === '立即发布') && e.children.length <= 2 && vis(e)) out.push(t + (e.disabled ? '(灰)' : '')); }); });
  const imgs = grab((d, out) => { out.push(String(d.querySelectorAll('img[src^="blob"], img[src^="data"]').length)); });
  const txt = ((document.body ? document.body.innerText : '')).slice(0, 300);
  return { editors: editors.slice(0, 3), titles: titles.slice(0, 3), videos: videos.slice(0, 2), btns: [...new Set(btns)], blobImgs: imgs, txt: txt.replace(/\n/g, '|').slice(0, 220) };
})()'''


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        for k, v in PLAT_URLS.items():
            pages = [p for p in ctx.pages if v in p.url]
            if not pages:
                print(k, ': 没有标签')
                continue
            p = pages[-1]
            try:
                p.bring_to_front()
                time.sleep(0.6)
                st = p.evaluate(JS_SCAN)
                print('== %s ==' % k, p.url[:90])
                print(json.dumps(st, ensure_ascii=False))
                p.screenshot(path=f'{SHOTS}/e2e_v_{k}.png', timeout=15000)
                print('  📷 e2e_v_%s.png' % k)
            except Exception as e:
                print(k, '扫不动:', str(e)[:120])


if __name__ == '__main__':
    main()
