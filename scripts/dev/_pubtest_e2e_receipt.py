# -*- coding: utf-8 -*-
"""拉 np_pub_log 完整回执（含 scan）+ 标签清点 + 三家页面截图。"""
import sys, os, json
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

EXT = 'eihbinbapmhgbohapphjmabbkgiflljd'
SHOTS = 'D:/AIproject/小红书运营/tmp/pubtest_shots'
os.makedirs(SHOTS, exist_ok=True)

PATS = {
    'xhs': 'creator.xiaohongshu.com/publish',
    'dy': 'creator.douyin.com/creator-micro/content/post',
    'ch': 'channels.weixin.qq.com/platform/post/create',
}

with sync_playwright() as p:
    b = p.chromium.connect_over_cdp('http://127.0.0.1:9333')
    ctx = b.contexts[0]
    print('== TABS ==')
    for i, pg in enumerate(ctx.pages):
        try:
            print(i, pg.url[:130])
        except Exception as e:
            print(i, 'ERR', str(e)[:80])
    con = None
    for pg in ctx.pages:
        try:
            if EXT in pg.url and 'popup.html' in pg.url:
                con = pg; break
        except Exception:
            pass
    if not con:
        print('NO CONSOLE'); sys.exit(1)
    out = con.evaluate("""(async () => {
      const g = (k) => new Promise(r => chrome.storage.local.get(k, r));
      const d = await g(['np_pub_log','np_pub_ran','np_pub_watch','np_pub_files']);
      const log = d.np_pub_log || [];
      const files = d.np_pub_files || {};
      const fsum = {};
      for (const k of Object.keys(files)) {
        const v = files[k];
        fsum[k] = Array.isArray(v) ? v.length : (v && v.byteLength) || (v && Object.keys(v).length) || typeof v;
      }
      return {logLen: log.length, log: log.slice(0, 2), ran: d.np_pub_ran, watch: d.np_pub_watch, fsum};
    })()""")
    print('== STORAGE ==')
    print(json.dumps(out, ensure_ascii=False)[:9000])
    counts = {}
    for pg in ctx.pages:
        try:
            u = pg.url
        except Exception:
            continue
        for name, pat in PATS.items():
            if pat in u:
                counts[name] = counts.get(name, 0) + 1
                fn = os.path.join(SHOTS, 'rcpt_%s_%d.png' % (name, counts[name]))
                try:
                    pg.screenshot(path=fn, timeout=8000)
                    print('shot', fn)
                except Exception as e:
                    print('shotfail', name, counts[name], str(e)[:80])
    print('== DONE ==')
