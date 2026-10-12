# -*- coding: utf-8 -*-
"""xhs 单平台重试 v2：不重载、直接 fire 并【接住响应】打印错误原因；蹲回执 + 新标签页。"""
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

EXT_ID = 'eihbinbapmhgbohapphjmabbkgiflljd'
CONSOLE_URL = 'chrome-extension://' + EXT_ID + '/popup.html'
NID = 'e2e20261009a'
TIMEOUT_MIN = 15

JS_STATE = r'''(async () => {
  const d = await chrome.storage.local.get(['np_notes', 'np_pub_log', 'np_pub_files']);
  const note = (d.np_notes || []).find(n => n && n.id === '%s') || null;
  return {
    status: note ? note.status : 'GONE',
    logN: (d.np_pub_log || []).length,
    xhs: ((d.np_pub_log || [])[0] || {}).xhs || null,
    files: Object.keys(d.np_pub_files || {}),
  };
})()''' % NID


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        page = None
        for p in ctx.pages:
            if p.url.startswith(CONSOLE_URL):
                try:
                    p.evaluate('1+1')
                    page = p
                    break
                except Exception:
                    continue
        if not page:
            page = ctx.new_page()
            page.goto(CONSOLE_URL)
            time.sleep(2)
        page.bring_to_front()

        st0 = page.evaluate(JS_STATE)
        print('== 起跑态 ==', json.dumps(st0, ensure_ascii=False)[:300], flush=True)

        print('== fire npPubRetryBg xhs（接响应） ==', flush=True)
        r = page.evaluate(
            "chrome.runtime.sendMessage({ action: 'npPubRetryBg', id: '%s', platform: 'xhs' })"
            ".then(r => ({ ok: true, r: r })).catch(e => ({ ok: false, err: String(e && e.message || e) }))" % NID
        )
        print('  resp =', json.dumps(r, ensure_ascii=False)[:600], flush=True)

        print('== 蹲（每 8s，最长 %d 分钟；兼看 xhs 标签数） ==' % TIMEOUT_MIN, flush=True)
        t0 = time.time()
        last = None
        done = False
        while time.time() - t0 < TIMEOUT_MIN * 60:
            time.sleep(8)
            try:
                st = page.evaluate(JS_STATE)
                tabs = len([p for p in ctx.pages if 'creator.xiaohongshu.com' in p.url])
            except Exception:
                continue
            xt = json.dumps({'status': st['status'], 'logN': st['logN'], 'xhs': st['xhs'],
                             'files': st['files'], 'tabs': tabs}, ensure_ascii=False)
            if xt != last:
                print('  t+%4.0fs %s' % (time.time() - t0, xt), flush=True)
                last = xt
            x = st['xhs'] or {}
            if x.get('ok') or (x.get('msg') and '原地' in str(x.get('msg'))):
                print('  ★ xhs 结果:', json.dumps(x, ensure_ascii=False), flush=True)
                done = True
                break
        if not done:
            print('  时间到——末次:', last, flush=True)


if __name__ == '__main__':
    main()
