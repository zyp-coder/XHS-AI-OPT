# -*- coding: utf-8 -*-
"""试给三家创作者域名授权：控制台页注入按钮 → Playwright 真手势点 → 看结果。
若原生授权框弹出，__grantRes 会迟迟不出、contains 仍 false。"""
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

EXT_ID = 'eihbinbapmhgbohapphjmabbkgiflljd'
CONSOLE_URL = 'chrome-extension://' + EXT_ID + '/popup.html'
ORIGINS = [
    'https://creator.xiaohongshu.com/*',
    'https://creator.douyin.com/*',
    'https://channels.weixin.qq.com/*',
]

JS_INJECT = r'''((origins) => {
  const old = document.getElementById('npE2eGrant');
  if (old) old.remove();
  const b = document.createElement('button');
  b.id = 'npE2eGrant';
  b.textContent = 'grant';
  b.style.cssText = 'position:fixed;left:8px;top:8px;z-index:2147483647;width:120px;height:48px;background:#c00;color:#fff;font-size:18px';
  b.addEventListener('click', () => {
    window.__grantRes = 'pending';
    try {
      chrome.permissions.request({ origins: origins }).then(
        r => { window.__grantRes = { ok: !!r }; },
        e => { window.__grantRes = { err: String((e && e.message) || e) }; }
      );
    } catch (e) { window.__grantRes = { throwErr: String((e && e.message) || e) }; }
  });
  document.body.appendChild(b);
  return !!document.getElementById('npE2eGrant');
})'''

JS_CHECK = r'''(async () => {
  const ask = async (o) => { try { return await chrome.permissions.contains({ origins: [o] }); } catch (e) { return 'err:' + e; } };
  return {
    grantRes: (typeof window.__grantRes === 'object') ? window.__grantRes : String(window.__grantRes),
    xhs: await ask('https://creator.xiaohongshu.com/*'),
    douyin: await ask('https://creator.douyin.com/*'),
    channels: await ask('https://channels.weixin.qq.com/*'),
  };
})()'''


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        page = next((p for p in ctx.pages if p.url.startswith(CONSOLE_URL)), None)
        if not page:
            print('没有控制台页——先跑 _pubtest_console.py')
            return
        page.bring_to_front()
        print('控制台:', page.url[:110])
        print('注入:', page.evaluate(JS_INJECT, ORIGINS))
        page.click('#npE2eGrant', timeout=8000)
        print('点了')
        for i in range(10):
            time.sleep(1)
            r = page.evaluate(JS_CHECK)
            print(f'  t+{i+1}s:', json.dumps(r, ensure_ascii=False))
            if r.get('grantRes') not in ('pending', None):
                break


if __name__ == '__main__':
    main()
