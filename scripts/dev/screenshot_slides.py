# -*- coding: utf-8 -*-
import pathlib
from playwright.sync_api import sync_playwright

BASE = pathlib.Path(r'd:\AIproject\小红书运营\资料\视频\AI雕兄口播稿')
OUT = pathlib.Path(r'd:\AIproject\小红书运营\logs\shots')
OUT.mkdir(parents=True, exist_ok=True)

SCENES = [1, 3, 4, 9, 10, 11, 13, 16, 18, 19]
JOBS = [('v', BASE / 'AI雕兄-动效演示-竖屏.html', 1080, 1920), ('h', BASE / 'AI雕兄-动效演示.html', 1920, 1080)]

with sync_playwright() as p:
    b = p.chromium.launch()
    errs = []
    for tag, html, w, h in JOBS:
        pg = b.new_page(viewport={'width': w, 'height': h})
        pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
        url = html.as_uri()
        for n in SCENES:
            pg.goto(url + '#%d' % n)
            pg.reload()
            pg.wait_for_timeout(5000)
            pg.screenshot(path=str(OUT / ('%s-%02d.png' % (tag, n))))
        # 自动播放冒烟测试 + toast 截图
        pg.goto(url + '#1'); pg.reload(); pg.wait_for_timeout(1200)
        pg.keyboard.press('a'); pg.wait_for_timeout(500)
        pg.screenshot(path=str(OUT / ('%s-auto.png' % tag)))
        pg.wait_for_timeout(12000)
        print(tag, 'page after auto:', pg.evaluate("() => document.getElementById('cur').textContent"),
              '| tag visible:', pg.evaluate("() => document.getElementById('autotag').offsetWidth > 0"))
        pg.close()
    print('errors:', errs[:5] if errs else 'none')
    b.close()
print('done')
