# -*- coding: utf-8 -*-
"""重载扩展（带 xhs SEND 修复）→ fire npPubRetryBg(xhs) → 蹲回执 patch。"""
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

EXT_ID = 'eihbinbapmhgbohapphjmabbkgiflljd'
CONSOLE_URL = 'chrome-extension://' + EXT_ID + '/popup.html'
NID = 'e2e20261009a'
TIMEOUT_MIN = 12

JS_STATE = r'''(async () => {
  const d = await chrome.storage.local.get(['np_notes', 'np_pub_log', 'np_pub_ran', 'np_pub_files', 'np_pub_watch']);
  const note = (d.np_notes || []).find(n => n && n.id === '%s') || null;
  return {
    status: note ? note.status : 'GONE',
    logN: (d.np_pub_log || []).length,
    top: (d.np_pub_log || [])[0] || null,
    ran: d.np_pub_ran || {},
    files: Object.keys(d.np_pub_files || {}),
    watch: d.np_pub_watch || {},
  };
})()''' % NID


def pick_console(ctx):
    for p in ctx.pages:
        if p.url.startswith(CONSOLE_URL):
            try:
                p.evaluate("1+1")
                return p
            except Exception:
                continue
    return None


def open_console(ctx):
    p = ctx.new_page()
    p.goto(CONSOLE_URL)
    time.sleep(2)
    return p


def main():
    # 阶段1：重载
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        page = pick_console(ctx)
        if page:
            print('调 chrome.runtime.reload()', flush=True)
            try:
                page.evaluate("chrome.runtime.reload()")
            except Exception:
                pass
            time.sleep(4)
    # 阶段2：重连找新控制台 → fire retry
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        page = pick_console(ctx) or open_console(ctx)
        page.bring_to_front()
        print('重载后控制台:', page.url[:100], flush=True)
        alive = page.evaluate("(async () => { const d = await chrome.storage.local.get(['np_pub_ran']); return Object.keys(d.np_pub_ran || {}).length; })()")
        print('新 SW 存储应答 ranKeys =', alive, flush=True)

        st0 = page.evaluate(JS_STATE)
        print('== 起跑态 ==', json.dumps(st0, ensure_ascii=False)[:500], flush=True)

        print('== fire npPubRetryBg xhs ==', flush=True)
        r = page.evaluate("(() => { try { chrome.runtime.sendMessage({ action: 'npPubRetryBg', id: '%s', platform: 'xhs' }).catch(e => {}); return 'fired'; } catch (e) { return 'ERR:' + e; } })()" % NID)
        print(' ', r, flush=True)

        print('== 蹲（每 8s，最长 %d 分钟） ==' % TIMEOUT_MIN, flush=True)
        t0 = time.time()
        last = None
        done = False
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
            try:
                xt = json.dumps({'status': st['status'], 'logN': st['logN'], 'xhs': (st['top'] or {}).get('xhs'), 'files': st['files'], 'ran': st['ran']}, ensure_ascii=False)
            except Exception:
                xt = 'dump-err'
            if xt != last:
                print('  t+%4.0fs %s' % (time.time() - t0, xt), flush=True)
                last = xt
            top = st.get('top') or {}
            xhs = top.get('xhs') or {}
            if xhs.get('ok') or (xhs.get('msg') and '原地' in str(xhs.get('msg'))):
                print('  ★ xhs 结果:', json.dumps(xhs, ensure_ascii=False), flush=True)
                done = True
                break
        if not done:
            print('  时间到——末次:', last, flush=True)

        print('== 运行后三家标签页 ==', flush=True)
        for k, v in {'xhs': 'creator.xiaohongshu.com', 'douyin': 'creator.douyin.com', 'channels': 'channels.weixin.qq.com'}.items():
            urls = [p.url[:125] for p in ctx.pages if v in p.url]
            print(' ', k, len(urls), flush=True)
            for u in urls:
                print('    -', u, flush=True)


if __name__ == '__main__':
    main()
