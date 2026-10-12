# -*- coding: utf-8 -*-
"""控制台小工具：开/复用扩展页面（popup.html）当控制台，可在其中 evaluate（chrome.* 全可用）。"""
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

EXT_ID = 'eihbinbapmhgbohapphjmabbkgiflljd'
CONSOLE_URL = 'chrome-extension://' + EXT_ID + '/popup.html'


def open_console(b, ctx):
    """开一个独立控制台页（不碰已有的）。返回 (page, target_id)"""
    sess = b.new_browser_cdp_session()
    tid = sess.send('Target.createTarget', {'url': CONSOLE_URL})['targetId']
    page = None
    for _ in range(40):
        time.sleep(0.25)
        for p in ctx.pages:
            if p.url.startswith(CONSOLE_URL):
                # 认新开的那个：把它跟 tabId 对上较麻烦，直接按“最后打开”的找
                page = p
        if page:
            break
    return page, tid, sess


def close_target(sess, tid):
    try:
        sess.send('Target.closeTarget', {'targetId': tid})
    except Exception:
        pass


PROBE_PERMS = r'''(async () => {
  const ask = async (o) => { try { return await chrome.permissions.contains({ origins: [o] }); } catch (e) { return 'err:' + e; } };
  const perms = {
    xhs: await ask('https://creator.xiaohongshu.com/*'),
    douyin: await ask('https://creator.douyin.com/*'),
    channels: await ask('https://channels.weixin.qq.com/*'),
  };
  let origins = null;
  try { origins = (await chrome.permissions.getAll()).origins; } catch (_) {}
  const ext = { id: chrome.runtime.id, v: chrome.runtime.getManifest().version };
  return { perms, origins, ext };
})()'''

if __name__ == '__main__':
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        page, tid, sess = open_console(b, ctx)
        if not page:
            print('控制台开不出来')
            sys.exit(1)
        print('控制台:', page.url)
        try:
            import json
            print(json.dumps(page.evaluate(PROBE_PERMS), ensure_ascii=False, indent=1))
        finally:
            pass  # 先留着，后面 e2e 还要用
