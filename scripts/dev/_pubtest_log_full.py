# -*- coding: utf-8 -*-
"""拉全量 np_pub_log 逐条（含 key/at 逐字）+ ran + 标签清点。只读。"""
import json
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

EXT = 'eihbinbapmhgbohapphjmabbkgiflljd'

with sync_playwright() as pw:
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
    ctx = b.contexts[0]
    con = None
    for p in ctx.pages:
        if EXT in p.url and 'popup.html' in p.url:
            try:
                p.evaluate('1+1')
                con = p
                break
            except Exception:
                continue
    if not con:
        print('NO CONSOLE')
        sys.exit(1)
    out = con.evaluate("""(async () => {
      const d = await chrome.storage.local.get(['np_pub_log','np_pub_ran','np_pub_watch','np_pub_files','np_pub_plats','note_queue','np_queue_times']);
      return { log: d.np_pub_log || [], ran: d.np_pub_ran, watch: d.np_pub_watch, files: Object.keys(d.np_pub_files || {}), plats: d.np_pub_plats, queue: d.note_queue, times: d.np_queue_times };
    })()""")
    log = out['log']
    print('logN =', len(log))
    for i, e in enumerate(log):
        print('── #%d ──' % i)
        print(json.dumps(e, ensure_ascii=False, indent=1))
    print('== ran ==', json.dumps(out['ran'], ensure_ascii=False))
    print('== watch ==', json.dumps(out['watch'], ensure_ascii=False))
    print('== files ==', out['files'])
    print('== plats ==', json.dumps(out['plats'], ensure_ascii=False))
    print('== queue ==', json.dumps(out['queue'], ensure_ascii=False)[:800])
    print('== times ==', json.dumps(out['times'], ensure_ascii=False)[:400])
