# -*- coding: utf-8 -*-
"""重载扩展（chrome.runtime.reload()）→ 重连新会话 → 确认 SW 复活 → 清 np_pub_watch/np_pub_ran → 复核数据态。"""
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

EXT_ID = 'eihbinbapmhgbohapphjmabbkgiflljd'
CONSOLE_URL = 'chrome-extension://' + EXT_ID + '/popup.html'
NID = 'e2e20261009a'


def find_console(ctx):
    for _ in range(20):
        page = next((p for p in ctx.pages if p.url.startswith('chrome-extension://' + EXT_ID)), None)
        if page:
            return page
        time.sleep(1)
    return None


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        page = find_console(ctx)
        if not page:
            print('没找到扩展页，先新开一个')
            page = ctx.new_page()
            page.goto(CONSOLE_URL)
            time.sleep(1)
        print('控制台就绪:', page.url[:100])
        # 重载前先看 SW 在不在
        pre = page.evaluate("(async () => { try { const r = await chrome.runtime.sendMessage({type: 'PING_NP'}); return JSON.stringify(r||null); } catch (e) { return 'sendMessage-err:' + String(e).slice(0,80); } })()")
        print('重载前 SW 应答:', str(pre)[:150])

        print('== 调 chrome.runtime.reload() ==')
        try:
            page.evaluate("chrome.runtime.reload()")
        except Exception as e:
            print('reload 调用异常（预期页面会死）:', str(e)[:120])
        time.sleep(4)

    # 重连新会话（ctx.pages 刷新慢，必须重连）
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        page = find_console(ctx)
        if not page:
            print('reload 后旧控制台页没了，重开一个')
            page = ctx.new_page()
            page.goto(CONSOLE_URL)
            time.sleep(2)
        page.bring_to_front()
        print('重连后扩展页:', page.url[:100])
        # 验证新 SW 起来（storage 读得到 = SW 活着）
        alive = None
        for i in range(15):
            try:
                alive = page.evaluate("(async () => { const d = await chrome.storage.local.get(['np_pub_ran', 'np_pub_watch']); return { ranKeys: Object.keys(d.np_pub_ran || {}).length, watchKeys: Object.keys(d.np_pub_watch || {}).length }; })()")
                break
            except Exception as e:
                alive = 'err:' + str(e)[:80]
                time.sleep(1)
        print('新 SW 存储应答:', json.dumps(alive, ensure_ascii=False) if isinstance(alive, dict) else alive)

        print('== 清 np_pub_watch + np_pub_ran ==')
        JS_CLEAR = r'''(async () => {
          await chrome.storage.local.set({ np_pub_watch: {}, np_pub_ran: {} });
          const d = await chrome.storage.local.get(['np_pub_ran', 'np_pub_watch', 'np_pub_log', 'np_notes', 'np_pub_files']);
          const n = (d.np_notes || []).find(x => x && x.id === '%s') || null;
          return {
            ran: d.np_pub_ran,
            watch: d.np_pub_watch,
            logN: (d.np_pub_log || []).length,
            status: n ? n.status : 'GONE',
            files: Object.keys(d.np_pub_files || {}),
          };
        })()''' % NID
        print(json.dumps(page.evaluate(JS_CLEAR), ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
