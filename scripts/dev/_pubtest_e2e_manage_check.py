# -*- coding: utf-8 -*-
"""查真发结果：开三家内容管理页，扫「彩排」有没有出贴。只读不动。"""
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

SHOTS = 'tmp/pubtest_shots'
MANAGE = {
    'xhs': 'https://creator.xiaohongshu.com/note-manage/note-manage',
    'douyin': 'https://creator.douyin.com/creator-micro/content/manage',
    'channels': 'https://channels.weixin.qq.com/platform/post/list',
}

JS_SCAN = r'''(() => {
  const txt = (document.body ? document.body.innerText : '');
  const lines = txt.split('\n').map(s => s.trim()).filter(Boolean);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (/彩排/.test(lines[i])) hits.push({ i, seg: lines.slice(Math.max(0, i - 1), i + 4).join(' | ').slice(0, 240) });
  }
  return { href: location.href.slice(0, 90), title: document.title.slice(0, 50), n: lines.length, hits: hits.slice(0, 4), head: lines.slice(0, 25).join('|').slice(0, 400) };
})()'''


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        for k, url in MANAGE.items():
            p = ctx.new_page()
            try:
                p.goto(url, wait_until='domcontentloaded', timeout=30000)
                time.sleep(9)
                st = p.evaluate(JS_SCAN)
                print('== %s ==' % k)
                print(json.dumps(st, ensure_ascii=False))
                p.screenshot(path=f'{SHOTS}/e2e_mg_{k}.png', timeout=15000)
                print('  📷 e2e_mg_%s.png' % k)
            except Exception as e:
                print(k, 'err:', str(e)[:130])
            finally:
                try:
                    p.close()
                except Exception:
                    pass


if __name__ == '__main__':
    main()
