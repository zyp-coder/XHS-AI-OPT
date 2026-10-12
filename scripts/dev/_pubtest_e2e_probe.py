# -*- coding: utf-8 -*-
"""旁路探针：直读回执/状态/ran/闹钟/三家标签页数。每跑一次打一行（不阻塞蹲守）。"""
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

EXT_ID = 'eihbinbapmhgbohapphjmabbkgiflljd'
CONSOLE_URL = 'chrome-extension://' + EXT_ID + '/popup.html'
NID = 'e2e20261009a'
PLAT = {'xhs': 'creator.xiaohongshu.com', 'douyin': 'creator.douyin.com', 'channels': 'channels.weixin.qq.com'}

JS = r'''(async () => {
  const d = await chrome.storage.local.get(['np_notes', 'np_pub_log', 'np_pub_ran', 'np_pub_files']);
  const n = (d.np_notes || []).find(x => x && x.id === '%s') || null;
  let alarms = [];
  try { alarms = await new Promise(res => chrome.alarms.getAll(a => res(a.map(x => x.name + '@' + new Date(x.scheduledTime).toTimeString().slice(0, 8))))); } catch (_) {}
  return {
    status: n ? n.status : 'GONE',
    logN: (d.np_pub_log || []).length,
    logTop: (d.np_pub_log || [])[0] || null,
    ran: d.np_pub_ran,
    files: Object.keys(d.np_pub_files || {}),
    alarms,
  };
})()''' % NID

with sync_playwright() as pw:
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
    ctx = b.contexts[0]
    page = next((p for p in ctx.pages if p.url.startswith(CONSOLE_URL)), None)
    if not page:
        print('!! 控制台页不在')
        sys.exit(0)
    st = page.evaluate(JS)
    st['tabs'] = {k: sum(1 for p in ctx.pages if v in p.url) for k, v in PLAT.items()}
    st['t'] = time.strftime('%H:%M:%S')
    print(json.dumps(st, ensure_ascii=False))
