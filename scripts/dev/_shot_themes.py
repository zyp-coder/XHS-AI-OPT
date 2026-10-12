# -*- coding: utf-8 -*-
"""出图：13 个主题预设逐个套用，截「设置 → 界面主题」整块，肉眼核对艳色好不好看。

跑法：python3 scripts/dev/_shot_themes.py
出图：%TEMP%/xhs_themes/<preset>.png（含「效果」预览条：主按钮 / 次按钮 / 选中项 / 数字 / 输入框）
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
    return (await chrome.storage.local.get('ui_theme')).ui_theme || null;
}'''

with tempfile.TemporaryDirectory(prefix='xhs-themes-') as profile, sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        profile, headless=False, channel='msedge', viewport={'width': 1500, 'height': 950},
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    try:
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
        page = ctx.new_page()
        page.goto(sw.url.replace('background.js', 'popup.html?mode=big&tabId=0'))
        page.wait_for_function('typeof switchMainTab === "function"')
        print('SEED preset =', sw.evaluate(SEED), flush=True)
        page.reload()
        page.wait_for_function('typeof switchMainTab === "function"')
        page.wait_for_timeout(400)

        presets = page.evaluate('() => Theme.PRESETS.map(x => x.id)')
        print('预设', len(presets), '个:', ' '.join(presets), flush=True)

        for pid in presets:
            sw.evaluate('''async (pid) => { await chrome.storage.local.set({ ui_theme: { preset: pid, custom: '' } }); }''', pid)
            page.wait_for_timeout(250)
            page.evaluate('() => switchMainTab("settings", "theme")')
            fr = None
            for _ in range(30):
                for f in page.frames:
                    if 'settings.html' in (f.url or '') and (f.url or '').endswith('#theme'):
                        fr = f
                        break
                if fr:
                    break
                page.wait_for_timeout(200)
            assert fr, '没找到 #theme 内嵌实例'
            fr.wait_for_selector('.theme-card', timeout=10000)
            page.wait_for_timeout(250)
            fr.locator('#tab-theme').screenshot(path=str(OUT / (pid + '.png')))
            brand = page.evaluate('() => getComputedStyle(document.documentElement).getPropertyValue("--c-brand").trim()')
            on = page.evaluate('() => getComputedStyle(document.querySelector(".btn-primary")).color')
            txt = page.evaluate('() => getComputedStyle(document.documentElement).getPropertyValue("--c-brand-text").trim()')
            print('%-9s 主色=%s 按钮字色=%s 主色文字=%s' % (pid, brand, on, txt), flush=True)
    finally:
        ctx.close()

print('出图:', OUT)
