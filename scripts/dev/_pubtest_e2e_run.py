# -*- coding: utf-8 -*-
"""e2e 正式跑：重载扩展（带新旗子）→ 控制台重开 → npPubRearm 拉起 alarm →
蹲到点这一趟（tick → 三家 ✋过目）→ 收集回执 / 标签页 / 状态。全程不点发布。"""
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

EXT_ID = 'eihbinbapmhgbohapphjmabbkgiflljd'
CONSOLE_URL = 'chrome-extension://' + EXT_ID + '/popup.html'
NID = 'e2e20261009a'
PLAT_URLS = {
    'xhs': 'creator.xiaohongshu.com',
    'douyin': 'creator.douyin.com',
    'channels': 'channels.weixin.qq.com',
}
TIMEOUT_MIN = 16


def open_console(b, ctx):
    sess = b.new_browser_cdp_session()
    tid = sess.send('Target.createTarget', {'url': CONSOLE_URL})['targetId']
    for _ in range(60):
        time.sleep(0.25)
        pg = next((p for p in ctx.pages if p.url.startswith(CONSOLE_URL)), None)
        if pg:
            return pg, tid, sess
    return None, tid, sess


JS_STATE = r'''(async () => {
  const d = await chrome.storage.local.get(['np_notes', 'np_pub_log', 'np_pub_ran', 'np_pub_files']);
  const note = (d.np_notes || []).find(n => n && n.id === '%s') || null;
  let alarms = [];
  try { alarms = await new Promise(res => chrome.alarms.getAll(a => res(a.map(x => x.name + '@' + new Date(x.scheduledTime).toTimeString().slice(0, 8))))); } catch (_) {}
  return {
    status: note ? note.status : 'GONE',
    logN: (d.np_pub_log || []).length,
    logTop: (d.np_pub_log || []).slice(0, 2),
    ran: d.np_pub_ran || {},
    filesLeft: Object.keys(d.np_pub_files || {}),
    alarms,
  };
})()''' % NID

def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        page = next((p for p in ctx.pages if p.url.startswith(CONSOLE_URL)), None)
        if not page:
            print('没有控制台页；开一个')
            page, tid, _ = open_console(b, ctx)
        print('== 重载扩展（带新旗子） ==')
        try:
            page.evaluate("() => { chrome.runtime.reload(); return 'bye'; }")
        except Exception as e:
            print('  reload 触发（页面随之关闭）:', str(e)[:80])
        time.sleep(4)

        page2, tid2, sess2 = open_console(b, ctx)
        if not page2:
            print('重载后控制台开不出来')
            return
        print('控制台:', page2.url[:100])

        print('== 拉响下一趟 ==')
        try:
            r = page2.evaluate("async () => { try { return await chrome.runtime.sendMessage({ action: 'npPubRearm' }); } catch (e) { return 'ERR:' + e; } }")
            print('  rearm:', r)
        except Exception as e:
            print('  rearm err', e)

        print('== 蹲（每 8s 看一次，最长 %d 分钟） ==' % TIMEOUT_MIN)
        t0 = time.time()
        base_pages = {k: sum(1 for p in ctx.pages if v in p.url) for k, v in PLAT_URLS.items()}
        print('  起跑时三家页数:', base_pages)
        last = None
        done = False
        while time.time() - t0 < TIMEOUT_MIN * 60:
            time.sleep(8)
            try:
                st = page2.evaluate(JS_STATE)
            except Exception as e:
                # 控制台页被关/换了就再找一个
                page2 = next((p for p in ctx.pages if p.url.startswith(CONSOLE_URL)), None)
                if not page2:
                    page2, tid2, sess2 = open_console(b, ctx)
                continue
            counts = {k: sum(1 for p in ctx.pages if v in p.url) for k, v in PLAT_URLS.items()}
            line = json.dumps({'logN': st['logN'], 'status': st['status'], 'ran': st['ran'], 'tabs': counts, 'alarms': st['alarms']}, ensure_ascii=False)
            if line != last:
                print('  t+%4.0fs %s' % (time.time() - t0, line))
                last = line
            if st['logTop']:
                print('  ★ 回执落袋:', json.dumps(st['logTop'][0], ensure_ascii=False))
                print('  末态:', json.dumps(st, ensure_ascii=False, indent=1))
                done = True
                break
        if not done:
            print('  时间到还没回执——末次:', json.dumps(last, ensure_ascii=False))

        print('== 运行后三家标签页 ==')
        for k, v in PLAT_URLS.items():
            urls = [p.url[:110] for p in ctx.pages if v in p.url]
            print(' ', k, len(urls))
            for u in urls:
                print('    -', u)


if __name__ == '__main__':
    main()
