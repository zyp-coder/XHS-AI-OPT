# -*- coding: utf-8 -*-
"""重连新会话找控制台页（旧连接 ctx.pages 刷新慢）→ 清 np_pub_ran/np_pub_log → 复核数据态。"""
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

EXT_ID = 'eihbinbapmhgbohapphjmabbkgiflljd'
CONSOLE_URL = 'chrome-extension://' + EXT_ID + '/popup.html'
NID = 'e2e20261009a'

JS_RESET = r'''(async () => {
  await chrome.storage.local.set({ np_pub_ran: {}, np_pub_log: [] });
  const d = await chrome.storage.local.get(['np_notes', 'np_pub_watch', 'np_pub_files', 'note_queue']);
  const n = (d.np_notes || []).find(x => x && x.id === '%s') || null;
  let alarms = [];
  try { alarms = await new Promise(res => chrome.alarms.getAll(a => res(a.map(x => x.name + '@' + new Date(x.scheduledTime).toLocaleTimeString())))) ; } catch (_) {}
  return {
    status: n ? n.status : 'GONE',
    adapted: n && n.pub && n.pub.adapted ? Object.keys(n.pub.adapted) : [],
    watch: d.np_pub_watch,
    files: Object.keys(d.np_pub_files || {}),
    rows: (() => { const q = d.note_queue; if (!q) return null; if (Array.isArray(q)) return q.map(r => (r && (r.key || r.id)) || JSON.stringify(r).slice(0, 60)).slice(0, 12); return Object.keys(q).slice(0, 12); })(),
    alarms,
  };
})()''' % NID

JS_ARMV = r'''(async () => {
  const d = await chrome.storage.local.get(['np_pub_ran', 'np_pub_log']);
  return { ran: d.np_pub_ran || {}, logN: (d.np_pub_log || []).length };
})()'''


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        page = None
        for i in range(20):
            page = next((p for p in ctx.pages if p.url.startswith(CONSOLE_URL)), None)
            if page:
                break
            time.sleep(1)
        if not page:
            print('没找到控制台页')
            for p in ctx.pages:
                print('  -', p.url[:110])
            return
        page.bring_to_front()
        time.sleep(0.5)
        print('控制台就绪:', page.url[:100])
        print('== 清 + 复核 ==')
        print(json.dumps(page.evaluate(JS_RESET), ensure_ascii=False, indent=1))
        print('清后:', json.dumps(page.evaluate(JS_ARMV), ensure_ascii=False))
        print('== 当前标签页 ==')
        for p in ctx.pages:
            print('  -', p.url[:110])


if __name__ == '__main__':
    main()
