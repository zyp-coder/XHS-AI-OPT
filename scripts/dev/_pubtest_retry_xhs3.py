# -*- coding: utf-8 -*-
"""xhs 单平台重试 v3：action 名修正为 npPubRetry（不是 npPubRetryBg）→ 非阻塞 fire，
响应存 window.__retryResp；每 8s 蹲回执 + 响应 + xhs 标签数，任一落袋即报。"""
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

JS_FIRE = r'''(() => {
  window.__retryResp = { pending: true };
  chrome.runtime.sendMessage({ action: 'npPubRetry', id: '%s', platform: 'xhs' })
    .then(r => { window.__retryResp = r; })
    .catch(e => { window.__retryResp = { portErr: String((e && e.message) || e) }; });
  return 'fired';
})()''' % NID

JS_STATE = r'''(async () => {
  const d = await chrome.storage.local.get(['np_notes', 'np_pub_log', 'np_pub_files']);
  const note = (d.np_notes || []).find(n => n && n.id === '%s') || null;
  return {
    status: note ? note.status : 'GONE',
    logN: (d.np_pub_log || []).length,
    xhs: ((d.np_pub_log || [])[0] || {}).xhs || null,
    files: Object.keys(d.np_pub_files || {}),
    resp: window.__retryResp || null,
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
        print('== 起跑态 ==', json.dumps({k: v for k, v in st0.items() if k != 'resp'}, ensure_ascii=False)[:300], flush=True)
        print('== fire npPubRetry xhs ==', flush=True)
        print(' ', page.evaluate(JS_FIRE), flush=True)

        print('== 蹲（每 8s，最长 %d 分钟） ==' % TIMEOUT_MIN, flush=True)
        t0 = time.time()
        last = None
        while time.time() - t0 < TIMEOUT_MIN * 60:
            time.sleep(8)
            try:
                st = page.evaluate(JS_STATE)
                tabs = len([p for p in ctx.pages if 'creator.xiaohongshu.com' in p.url])
            except Exception:
                continue
            xt = json.dumps({'status': st['status'], 'logN': st['logN'], 'xhs': st['xhs'],
                             'files': st['files'], 'tabs': tabs, 'resp': st['resp']}, ensure_ascii=False)
            if xt != last:
                print('  t+%4.0fs %s' % (time.time() - t0, xt), flush=True)
                last = xt
            x = st['xhs'] or {}
            resp = st['resp'] or {}
            if (resp and not resp.get('pending')) or x.get('ok') or (x.get('msg') and '原地' in str(x.get('msg'))):
                print('  ★ 落袋: xhs=%s resp=%s' % (json.dumps(x, ensure_ascii=False), json.dumps(resp, ensure_ascii=False)[:400]), flush=True)
                break
        else:
            print('  时间到——末次:', last, flush=True)


if __name__ == '__main__':
    main()
