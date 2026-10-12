# -*- coding: utf-8 -*-
"""tick 诊断：闹钟在不在、控制台页死活、手动 rearm+快起再蹲一轮。"""
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

EXT_ID = 'eihbinbapmhgbohapphjmabbkgiflljd'
CONSOLE_URL = 'chrome-extension://' + EXT_ID + '/popup.html'
NID = 'e2e20261009a'

JS_ALARMS = r'''(async () => {
  const alarms = await new Promise(res => chrome.alarms.getAll(a => res(a.map(x => x.name + '@' + new Date(x.scheduledTime).toLocaleTimeString()))));
  const d = await chrome.storage.local.get(['np_pub_ran', 'np_pub_log', 'note_queue', 'np_queue_times']);
  const q = d.note_queue;
  return {
    alarms,
    ran: d.np_pub_ran || {},
    logN: (d.np_pub_log || []).length,
    qType: Array.isArray(q) ? 'array(' + q.length + ')' : typeof q,
    q: Array.isArray(q) ? q.slice(0, 8).map(r => (r && (r.key || r.id)) || JSON.stringify(r).slice(0, 80)) : (q ? Object.keys(q).slice(0, 10) : null),
    times: d.np_queue_times || null,
  };
})()'''


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        page = next((p for p in ctx.pages if p.url.startswith(CONSOLE_URL)), None)
        if not page:
            print('没找到控制台页，现有页面：')
            for p in ctx.pages:
                print('  -', p.url[:110])
            return
        page.bring_to_front()
        time.sleep(0.4)
        print('控制台:', page.url[:100], '| title:', page.title()[:40])
        print('== 诊断 ==')
        print(json.dumps(page.evaluate(JS_ALARMS), ensure_ascii=False, indent=1))

        print('== 手动 rearm ==')
        r = page.evaluate("async () => { try { return await chrome.runtime.sendMessage({ action: 'npPubRearm' }); } catch (e) { return 'ERR:' + e; } }")
        print(' ', r)
        time.sleep(0.8)
        print('== rearm 后闹钟 ==')
        print(' ', page.evaluate("async () => await new Promise(res => chrome.alarms.getAll(a => res(a.map(x => x.name + '@' + new Date(x.scheduledTime).toLocaleTimeString()))))"))
        print('== 快起 +8s ==')
        print(' ', page.evaluate("async () => { await chrome.alarms.create('np-pub-tick', { when: Date.now() + 8000 }); return 'fast+8s'; }"))


if __name__ == '__main__':
    main()
