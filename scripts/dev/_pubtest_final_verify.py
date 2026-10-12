# -*- coding: utf-8 -*-
"""终验取证：回执全文 + ran/watch/files/note 状态 + 三家标签清点 + 截图。"""
import sys, os, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

EXT = 'eihbinbapmhgbohapphjmabbkgiflljd'
NID = 'e2e20261009a'
SHOTS = 'D:/AIproject/小红书运营/tmp/pubtest_shots'
os.makedirs(SHOTS, exist_ok=True)

PATS = {
    'xhs': 'creator.xiaohongshu.com',
    'dy': 'creator.douyin.com',
    'ch': 'channels.weixin.qq.com',
}

JS = r'''(async () => {
  const d = await chrome.storage.local.get(['np_pub_log','np_pub_ran','np_pub_watch','np_pub_files','np_notes']);
  const log = d.np_pub_log || [];
  const n = (d.np_notes || []).find(x => x && x.id === '%s') || null;
  return {
    logLen: log.length,
    logTop: log.slice(0, 3),
    ran: d.np_pub_ran,
    watch: d.np_pub_watch,
    files: Object.keys(d.np_pub_files || {}),
    noteStatus: n ? n.status : 'GONE',
    adapted: n && n.pub && n.pub.adapted ? Object.keys(n.pub.adapted) : [],
  };
})()''' % NID

with sync_playwright() as p:
    b = p.chromium.connect_over_cdp('http://127.0.0.1:9333')
    ctx = b.contexts[0]
    con = next((pg for pg in ctx.pages if EXT in pg.url and 'popup.html' in pg.url), None)
    if not con:
        print('NO CONSOLE')
        sys.exit(1)
    out = con.evaluate(JS)
    print('== STORAGE ==')
    print(json.dumps(out, ensure_ascii=False, indent=1))
    print('== TABS ==')
    counts = {}
    for pg in ctx.pages:
        try:
            u = pg.url
        except Exception:
            continue
        for name, pat in PATS.items():
            if pat in u:
                counts[name] = counts.get(name, 0) + 1
                print(' [%s#%d] %s' % (name, counts[name], u[:130]))
                fn = os.path.join(SHOTS, 'final_%s_%d.png' % (name, counts[name]))
                try:
                    pg.screenshot(path=fn, timeout=8000)
                    print('   shot ->', fn)
                except Exception as e:
                    print('   shotfail', str(e)[:80])
    print('== counts ==', json.dumps(counts, ensure_ascii=False))
