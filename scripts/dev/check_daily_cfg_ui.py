# -*- coding: utf-8 -*-
"""🌿 日常浏览配置页：改版后的版面（说明收成问号 + 两处折叠）跑一遍真扩展看一眼。
用法：python3 scripts/dev/check_daily_cfg_ui.py
出图：%TEMP%/xhs_daily_cfg_ui/{panel,hover,expand}.png
"""
import os
import pathlib
import sys
import time

from playwright.sync_api import sync_playwright

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / 'extension'
OUT = pathlib.Path(os.environ.get('TEMP', '/tmp')) / 'xhs_daily_cfg_ui'
OUT.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        str(OUT / 'profile'), headless=False, channel='msedge',
        viewport={'width': 1160, 'height': 900},
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    t0 = time.time()
    while time.time() - t0 < 20 and not ctx.service_workers:
        time.sleep(0.3)
    eid = ctx.service_workers[0].url.split('/')[2]
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(f'chrome-extension://{eid}/popup.html?mode=big&tabId=0')
    pg.wait_for_timeout(1500)
    # 新 profile 没配 AI 时会盖一层首启面板（挡住点击）→ 先关掉
    try:
        pg.wait_for_selector('#fsClose', timeout=3000)
        pg.click('#fsClose')
        pg.wait_for_timeout(200)
    except Exception:
        pass
    pg.click('#tabHuoke')
    pg.wait_for_timeout(300)
    pg.click('#tabTaskCfg')
    pg.wait_for_timeout(600)
    pg.click('#drainCfgContent [data-sec="daily"]')
    pg.wait_for_selector('#dbStatus', timeout=8000)
    pg.wait_for_timeout(400)

    keeps = pg.eval_on_selector_all(
        '#sxScanCfgPanel [class^="sx-count"], #sxScanCfgPanel .sx-hint',
        'els => els.map(e => e.textContent.trim()).filter(Boolean)')
    print('面板上还常显的说明行:', keeps)
    print('问号个数:', pg.eval_on_selector_all('#sxScanCfgPanel .qhelp', 'els => els.length'))
    for n in ['不进消息', '点过「⏹ 停止本轮」当天不会再自动拉起', '打开 / 点赞 / 收藏都是']:
        assert n not in pg.inner_text('#sxScanCfgPanel'), '这段说明本该收进问号: ' + n
    pg.screenshot(path=str(OUT / 'panel.png'))

    pg.hover('#sxScanCfgPanel .qhelp')
    pg.wait_for_timeout(300)
    pg.screenshot(path=str(OUT / 'hover.png'))

    pg.click('#dbDetRound > summary')
    pg.click('#dbDetSocial > summary')
    pg.wait_for_timeout(300)
    pg.screenshot(path=str(OUT / 'expand.png'))

    # 旋钮改完摘要行跟着刷新；切 tab 回来折叠状态还记着
    pg.fill('#dbDetRound input[data-dbn="perRound"]', '4')
    pg.dispatch_event('#dbDetRound input[data-dbn="perRound"]', 'change')
    pg.wait_for_timeout(500)
    assert pg.inner_text('#dbSumRound').startswith('4 篇/轮'), '摘要没跟着刷新: ' + pg.inner_text('#dbSumRound')
    pg.click('#drainCfgContent [data-sec="kw"]')
    pg.wait_for_timeout(400)
    pg.click('#drainCfgContent [data-sec="daily"]')
    pg.wait_for_selector('#dbStatus', timeout=8000)
    pg.wait_for_timeout(400)
    assert pg.eval_on_selector('#dbDetRound', 'e => e.open'), '切 tab 回来「一轮怎么刷」被收起了'
    assert pg.eval_on_selector('#dbDetSocial', 'e => e.open'), '切 tab 回来「顺手互动」被收起了'
    assert pg.inner_text('#dbSumRound').startswith('4 篇/轮'), '重渲染后摘要没重算: ' + pg.inner_text('#dbSumRound')
    print('摘要行:', pg.inner_text('#dbDetRound > summary').replace('\n', ' '), '|', pg.inner_text('#dbDetSocial > summary').replace('\n', ' '))

    assert not errs, '页面报错: ' + ' | '.join(errs)
    print('出图:', OUT)
    print('✅ 日常浏览配置页改版 UI 检查通过')
    ctx.close()
