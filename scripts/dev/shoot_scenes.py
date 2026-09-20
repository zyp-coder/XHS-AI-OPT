# -*- coding: utf-8 -*-
"""抓取每一幕的定妆照（等待动画走完），用于人工核对排版。
用法：python3 scripts/dev/shoot_scenes.py [竖屏|横屏|both] [幕号,如 2,4,6]"""
import pathlib, sys
from playwright.sync_api import sync_playwright

BASE = pathlib.Path(r'd:\AIproject\小红书运营\资料\视频\AI雕兄口播稿')
OUT = pathlib.Path(r'd:\AIproject\小红书运营\logs\shots')
JOBS = {'竖屏': ('v', BASE / 'AI雕兄-动效演示-竖屏.html', 1080, 1920),
        '横屏': ('h', BASE / 'AI雕兄-动效演示.html', 1920, 1080)}

which = sys.argv[1] if len(sys.argv) > 1 else '竖屏'
nums = ([int(x) for x in sys.argv[2].split(',')] if len(sys.argv) > 2 else range(1, 19))
tag, html, w, h = JOBS[which]
out = OUT / ('v3-' + tag)
out.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': w, 'height': h})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    url = html.as_uri()
    for n in nums:
        pg.goto(url + '#%d' % n)
        pg.reload()
        pg.wait_for_timeout(5200)
        pg.screenshot(path=str(out / ('%02d.png' % n)))
    print('shots ->', out, '| errors:', errs[:5] if errs else 'none')
    b.close()
