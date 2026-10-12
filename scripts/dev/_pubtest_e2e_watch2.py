# -*- coding: utf-8 -*-
"""终验蹲守 v2：ping 验活找控制台 → 每 8s 看回执/状态/标签（tick 已由诊断脚本快起）。"""
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
TIMEOUT_MIN = 25
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


def pick_console(ctx):
    cands = [p for p in ctx.pages if p.url.startswith(CONSOLE_URL)]
    for p in cands:
        try:
            p.evaluate("1+1")
            return p
        except Exception:
            continue
    return None


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        page = pick_console(ctx)
        if not page:
            print('没有活的控制台页', flush=True)
            return
        page.bring_to_front()
        print('控制台:', page.url[:100], flush=True)

        print('== 起跑态 ==', flush=True)
        st0 = page.evaluate(JS_STATE)
        print(json.dumps(st0, ensure_ascii=False)[:600], flush=True)

        print('== 蹲（每 8s，最长 %d 分钟） ==' % TIMEOUT_MIN, flush=True)
        t0 = time.time()
        t0ms = int(time.time() * 1000)
        base_pages = {k: sum(1 for p in ctx.pages if v in p.url) for k, v in PLAT_URLS.items()}
        print('  起跑时三家页数:', base_pages, flush=True)
        last = None
        done = False
        shot_done = set()
        while time.time() - t0 < TIMEOUT_MIN * 60:
            time.sleep(8)
            try:
                st = page.evaluate(JS_STATE)
            except Exception:
                page = pick_console(ctx)
                if not page:
                    print('  控制台没了', flush=True)
                    break
                continue
            counts = {k: sum(1 for p in ctx.pages if v in p.url) for k, v in PLAT_URLS.items()}
            line = json.dumps({'logN': st['logN'], 'status': st['status'], 'ran': st['ran'], 'tabs': counts, 'files': st['filesLeft'], 'alarms': st['alarms']}, ensure_ascii=False)
            if line != last:
                print('  t+%4.0fs %s' % (time.time() - t0, line), flush=True)
                last = line
            for k, v in PLAT_URLS.items():
                if k in shot_done:
                    continue
                newn = counts[k] - base_pages[k]
                if newn > 0:
                    pages = [p for p in ctx.pages if v in p.url]
                    try:
                        pages[-1].screenshot(path=f'{SHOTS}/w2_{k}_pending.png', timeout=15000)
                        print('  📷 w2_%s_pending.png' % k, flush=True)
                    except Exception as e:
                        print('  shot %s err: %s' % (k, str(e)[:80]), flush=True)
                    shot_done.add(k)
            if st['logTop'] and int(st['logTop'][0].get('at') or 0) > t0ms:
                print('  ★ 回执落袋:', json.dumps(st['logTop'][0], ensure_ascii=False), flush=True)
                print('  末态:', json.dumps(st, ensure_ascii=False, indent=1), flush=True)
                done = True
                break
        if not done:
            print('  时间到还没回执（或还在跑）——末次:', json.dumps(last, ensure_ascii=False), flush=True)

        print('== 运行后三家标签页 ==', flush=True)
        for k, v in PLAT_URLS.items():
            urls = [p.url[:120] for p in ctx.pages if v in p.url]
            print(' ', k, len(urls), flush=True)
            for u in urls:
                print('    -', u, flush=True)


if __name__ == '__main__':
    main()
