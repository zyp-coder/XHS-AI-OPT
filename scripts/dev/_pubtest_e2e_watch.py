# -*- coding: utf-8 -*-
"""e2e 蹲守（重载已完成、旗子已翻）：现有控制台页 → npPubRearm → 每 8s 看回执/状态/标签页。"""
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
TIMEOUT_MIN = 22
SHOTS = 'tmp/pubtest_shots'

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
            print('没有控制台页')
            return
        page.bring_to_front()
        print('控制台:', page.url[:100])

        print('== 起跑前 ==')
        print(json.dumps(page.evaluate(JS_STATE), ensure_ascii=False))

        print('== npPubRearm ==')
        try:
            r = page.evaluate("async () => { try { return await chrome.runtime.sendMessage({ action: 'npPubRearm' }); } catch (e) { return 'ERR:' + e; } }")
            print(' ', r)
        except Exception as e:
            print('  rearm err', str(e)[:120])
        time.sleep(1)
        try:
            print('  闹钟:', page.evaluate("async () => await new Promise(res => chrome.alarms.getAll(a => res(a.map(x => x.name + '@' + new Date(x.scheduledTime).toTimeString().slice(0, 8)))) )"))
        except Exception as e:
            print('  alarm read err', e)

        # rearm 之后快起：同名覆盖成 +8s，别放在 rearm 之前（会被重排回 5 分钟）
        try:
            r = page.evaluate("async () => { await chrome.alarms.create('np-pub-tick', { when: Date.now() + 8000 }); return 'fast+8s'; }")
            print('  快起:', r)
        except Exception as e:
            print('  快起 err', str(e)[:120])

        print('== 蹲（每 8s，最长 %d 分钟） ==' % TIMEOUT_MIN)
        t0 = time.time()
        t0ms = int(time.time() * 1000)
        base_pages = {k: sum(1 for p in ctx.pages if v in p.url) for k, v in PLAT_URLS.items()}
        print('  起跑时三家页数:', base_pages)
        last = None
        done = False
        shot_done = set()
        while time.time() - t0 < TIMEOUT_MIN * 60:
            time.sleep(8)
            try:
                st = page.evaluate(JS_STATE)
            except Exception:
                page = next((p for p in ctx.pages if p.url.startswith(CONSOLE_URL)), None)
                if not page:
                    print('  控制台没了')
                    break
                continue
            counts = {k: sum(1 for p in ctx.pages if v in p.url) for k, v in PLAT_URLS.items()}
            line = json.dumps({'logN': st['logN'], 'status': st['status'], 'ran': st['ran'], 'tabs': counts, 'alarms': st['alarms']}, ensure_ascii=False)
            if line != last:
                print('  t+%4.0fs %s' % (time.time() - t0, line))
                last = line
            # 新开的标签页冒头就留个影
            for k, v in PLAT_URLS.items():
                if k in shot_done:
                    continue
                newn = counts[k] - base_pages[k]
                if newn > 0:
                    pages = [p for p in ctx.pages if v in p.url]
                    try:
                        pages[-1].screenshot(path=f'{SHOTS}/e2e_{k}_pending.png', timeout=15000)
                        print('  📷 e2e_%s_pending.png' % k)
                    except Exception as e:
                        print('  shot %s err: %s' % (k, str(e)[:80]))
                    shot_done.add(k)
            if st['logTop'] and int(st['logTop'][0].get('at') or 0) > t0ms:
                print('  ★ 回执落袋:', json.dumps(st['logTop'][0], ensure_ascii=False))
                print('  末态:', json.dumps(st, ensure_ascii=False, indent=1))
                done = True
                break
        if not done:
            print('  时间到还没回执——末次:', json.dumps(last, ensure_ascii=False))

        print('== 运行后三家标签页 ==')
        for k, v in PLAT_URLS.items():
            urls = [p.url[:120] for p in ctx.pages if v in p.url]
            print(' ', k, len(urls))
            for u in urls:
                print('    -', u)


if __name__ == '__main__':
    main()
