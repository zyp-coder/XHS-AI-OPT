# -*- coding: utf-8 -*-
"""测试窗口 SW 小工具：连 CDP → 找/唤醒扩展 SW → evaluate。"""
import time

from playwright.sync_api import sync_playwright

EXT_ID = 'eihbinbapmhgbohapphjmabbkgiflljd'
SW_URL = 'chrome-extension://' + EXT_ID + '/background.js'


def connect():
    pw = sync_playwright().start()
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
    return pw, b


def find_sw(ctx, b, wake=True):
    def find():
        return next((s for s in ctx.service_workers if s.url.startswith(SW_URL)), None)

    sw = find()
    popped = None
    if not sw and wake:
        sess = b.new_browser_cdp_session()
        popped = sess.send('Target.createTarget', {'url': 'chrome-extension://' + EXT_ID + '/popup.html'})['targetId']
        for _ in range(40):
            time.sleep(0.5)
            sw = find()
            if sw:
                break
    return sw, popped


def sw_eval(b, ctx, js, wake=True):
    sw, popped = find_sw(ctx, b, wake)
    if not sw:
        raise RuntimeError('扩展 SW 不在')
    try:
        return sw.evaluate(js)
    finally:
        if popped:
            try:
                b.new_browser_cdp_session().send('Target.closeTarget', {'targetId': popped})
            except Exception:
                pass
