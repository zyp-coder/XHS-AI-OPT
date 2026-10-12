# -*- coding: utf-8 -*-
"""真发档：摘「过目」旗子（np_pub_watch 置空）+ 清今天记账（np_pub_ran 置空）→ 链路重跑即真发。
只动这两个键，其余（料/稿/队列行/旧回执）保持。"""
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

EXT_ID = 'eihbinbapmhgbohapphjmabbkgiflljd'
CONSOLE_URL = 'chrome-extension://' + EXT_ID + '/popup.html'
NID = 'e2e20261009a'

JS_GO = r'''(async () => {
  await chrome.storage.local.set({ np_pub_watch: {}, np_pub_ran: {} });
  const d = await chrome.storage.local.get(['np_notes', 'np_pub_watch', 'np_pub_ran', 'np_pub_files', 'np_pub_log']);
  const n = (d.np_notes || []).find(x => x && x.id === '%s') || null;
  return {
    status: n ? n.status : 'GONE',
    watch: d.np_pub_watch,
    ran: d.np_pub_ran,
    files: Object.keys(d.np_pub_files || {}),
    logN: (d.np_pub_log || []).length,
    logTop: (d.np_pub_log || [])[0] || null,
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
        time.sleep(0.4)
        print('== 摘旗 + 清记账 ==')
        print(json.dumps(page.evaluate(JS_GO), ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
