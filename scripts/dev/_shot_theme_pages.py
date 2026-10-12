# -*- coding: utf-8 -*-
"""出图：套一个主题后，把主要页面整屏截一遍（看艳色有没有把哪个界面弄脏）。

跑法：python3 scripts/dev/_shot_theme_pages.py lime
出图：%TEMP%/xhs_themes/pages-<preset>.png
"""
import os
import pathlib
import sys
import tempfile

from playwright.sync_api import sync_playwright

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

PRESET = sys.argv[1] if len(sys.argv) > 1 else 'lime'
ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / 'extension'
OUT = pathlib.Path(os.environ.get('TEMP', '/tmp')) / 'xhs_themes'
OUT.mkdir(parents=True, exist_ok=True)

SEED = r'''async () => {
    await Storage.initializeDefaults(DEFAULT_PROMPTS);
    await ensureTenantInit();
    const config = await Storage.getConfig();
    config.ai.apiKey = 'test-local-only';
    await Storage.setConfig(config);
    await chrome.storage.local.set({ ui_theme: { preset: '__P__', custom: '' } });
    return true;
}'''.replace('__P__', PRESET)

TABS = ['diagnosis', 'drain', 'prospect', 'notePublish', 'noteArchive', 'settings']

with tempfile.TemporaryDirectory(prefix='xhs-theme-page-') as profile, sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        profile, headless=False, channel='msedge', viewport={'width': 1500, 'height': 950},
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    try:
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
        assert sw.evaluate('chrome.runtime.onMessage.hasListeners()'), '后台路由没注册上'
        page = ctx.new_page()
        page.goto(sw.url.replace('background.js', 'popup.html?mode=big&tabId=0'))
        page.wait_for_function('typeof switchMainTab === "function"')
        sw.evaluate(SEED)
        page.reload()
        page.wait_for_function('typeof switchMainTab === "function"')
        page.wait_for_timeout(500)
        print('主色 =', page.evaluate(
            '() => getComputedStyle(document.documentElement).getPropertyValue("--c-brand").trim()'), flush=True)
        avail = page.evaluate('() => Array.from(document.querySelectorAll("#mainTabs [data-tab]")).map(b => b.dataset.tab)')
        print('页签:', avail, flush=True)
        for t in TABS:
            if avail and t not in avail:
                continue
            page.evaluate('(x) => switchMainTab(x)', t)
            page.wait_for_timeout(600)
            page.screenshot(path=str(OUT / ('page-%s-%s.png' % (PRESET, t))))
            print('  截 %s' % t, flush=True)
    finally:
        ctx.close()
print('出图:', OUT)
