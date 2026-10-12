"""后台启动冒烟：确认 background.js 顶层跑完、消息路由活着。

为什么单独一条：lib/*.js 是被 background.js 用 importScripts 加载的（Service Worker 里没有 window/document），
任一库顶层裸写 window.xxx 都会让 importScripts 抛错、后台脚本整体中断——
此时扩展看着能开，但所有「popup → 后台」消息永远不返回，界面就卡在转圈上。这条检查专门盯这个。
"""
import os
import pathlib
import tempfile

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(os.environ.get('XHS_ROOT') or '.').resolve()
EXT = ROOT / 'extension'

with tempfile.TemporaryDirectory(prefix='xhs-boot-') as profile, sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        profile, headless=False, channel='msedge',
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    try:
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
        sw.on('console', lambda m: print('[SW]', m.type, m.text[:300]))
        assert sw.evaluate('chrome.runtime.onMessage.hasListeners()'), \
            'background.js 的消息路由没注册上：多半是某个 lib 顶层抛错，importScripts 中断了'
        assert sw.evaluate('typeof VisualMotif === "object" && VisualMotif.keys().length >= 10'), \
            '画面流派那张表在后台读不到：lib/visual-motif.js 没进 background.js 的 importScripts'
        page = ctx.new_page()
        page.on('pageerror', lambda e: print('[popup pageerror]', str(e)[:300]))
        page.goto(sw.url.replace('background.js', 'popup.html?mode=big'))
        page.wait_for_function('typeof switchMainTab === "function"')
        assert page.evaluate('typeof VisualMotif === "object" && VisualMotif.VISUAL_MOTIFS.length >= 10'), \
            '画面流派那张表在 popup 读不到：popup.html 少了 lib/visual-motif.js 那行 script'
        rtt = page.evaluate('''async () => {
            const t0 = Date.now();
            try {
                const res = await Promise.race([
                    chrome.runtime.sendMessage({ action: 'getEdition' }),
                    new Promise(r => setTimeout(() => r('__TIMEOUT__'), 8000)),
                ]);
                return { ms: Date.now() - t0, res: (res === '__TIMEOUT__') ? res : JSON.stringify(res).slice(0, 120) };
            } catch (e) { return { ms: Date.now() - t0, res: 'ERR ' + (e && e.message || e) }; }
        }''')
        assert rtt['res'] != '__TIMEOUT__', 'popup 发消息后台不响应：路由没跑起来'
        assert 'ERR ' not in rtt['res'], 'popup → 后台消息报错：' + rtt['res']
        print('PASS: 后台路由已注册，popup → 后台往返 %dms：%s' % (rtt['ms'], rtt['res']))
        print('ALL PASS')
    finally:
        ctx.close()
