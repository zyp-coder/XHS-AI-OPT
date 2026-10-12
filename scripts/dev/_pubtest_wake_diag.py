# -*- coding: utf-8 -*-
"""诊断：开 popup 后目标列表 / Playwright service_workers 里到底有没有扩展 SW。"""
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

EXT_ID = 'eihbinbapmhgbohapphjmabbkgiflljd'
SW_URL = 'chrome-extension://' + EXT_ID + '/background.js'


def dump(b, ctx, label):
    print('==', label)
    sess = b.new_browser_cdp_session()
    ts = sess.send('Target.getTargets')['targetInfos']
    for t in ts:
        if t.get('url', '').startswith('chrome-extension://') or t.get('type') in ('service_worker', 'background_page', 'other'):
            print('  tgt:', t.get('type'), t.get('url', '')[:100])
    print('  pw service_workers:', [s.url[:100] for s in ctx.service_workers])


with sync_playwright() as pw:
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
    ctx = b.contexts[0]
    dump(b, ctx, '连接时')

    sess = b.new_browser_cdp_session()
    tid = sess.send('Target.createTarget', {'url': 'chrome-extension://' + EXT_ID + '/popup.html'})['targetId']
    print('popup 开了:', tid)
    for i in range(12):
        time.sleep(1)
        ts = sess.send('Target.getTargets')['targetInfos']
        sw = [t for t in ts if t.get('type') == 'service_worker' and EXT_ID in t.get('url', '')]
        pages = [t for t in ts if t.get('targetId') == tid]
        if i in (0, 2, 5, 11):
            print(f'  t+{i+1}s: sw={len(sw)} popup页={"在" if pages else "没了"} pw列表={len(list(ctx.service_workers))}')
    dump(b, ctx, '等待后')
    try:
        sess.send('Target.closeTarget', {'targetId': tid})
        print('popup closed')
    except Exception as e:
        print('close err', e)
