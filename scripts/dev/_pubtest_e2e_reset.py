# -*- coding: utf-8 -*-
"""e2e 重置：重载扩展（装上新修复）→ 关旧控制台页 → CDP 开新控制台页（耐心轮询）→
清 np_pub_ran/np_pub_log → 复核数据态（待发/料/watch/队列行/闹钟）。不开跑。"""
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


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]

        print('== 当前标签页 ==')
        for p in ctx.pages:
            print('  -', p.url[:110])

        olds = [p for p in ctx.pages if p.url.startswith(CONSOLE_URL)]
        print('旧控制台页数:', len(olds))
        if olds:
            try:
                print('reload:', olds[0].evaluate("() => { chrome.runtime.reload(); return 'sent'; }"))
            except Exception as e:
                print('reload err', str(e)[:120])
        time.sleep(4)

        for p in olds:
            try:
                p.close()
            except Exception:
                pass
        time.sleep(1)

        anchor = next((p for p in ctx.pages if 'http' in p.url), None) or (ctx.pages[0] if ctx.pages else None)
        if not anchor:
            print('没有可挂 CDP 的页面')
            return
        cdp = ctx.new_cdp_session(anchor)
        try:
            tid = cdp.send('Target.createTarget', {'url': CONSOLE_URL})
            print('createTarget:', tid)
        except Exception as e:
            print('createTarget err', str(e)[:160])
            return

        new = None
        for i in range(60):
            time.sleep(1)
            for c in [p for p in ctx.pages if p.url.startswith(CONSOLE_URL)]:
                try:
                    if c.evaluate("() => typeof chrome !== 'undefined' && !!chrome.storage"):
                        new = c
                        break
                except Exception:
                    continue
            if new:
                break
        if not new:
            print('新控制台页没等到（60s）')
            return
        new.bring_to_front()
        print('新控制台就绪:', new.url[:100])

        print('== 清 + 复核 ==')
        print(json.dumps(new.evaluate(JS_RESET), ensure_ascii=False, indent=1))

        print('== 清后标签页 ==')
        for p in ctx.pages:
            print('  -', p.url[:110])


if __name__ == '__main__':
    main()
