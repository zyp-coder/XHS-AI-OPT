# -*- coding: utf-8 -*-
"""一眼验：① 笔记档案改成列表 ② 主题色可换（设置 → 界面主题）。

跑法：python3 scripts/dev/_verify_theme_archive.py
出图：%TEMP%/xhs_verify_theme/*.png
盯的点：
  · 档案 = 一张表：表头一行 + 每篇一行（.npar-list / .npar-head / .npar-row），不再是每篇一张卡
  · 表头与数据行同一批列宽类，横向该对齐（列左边缘差 ≤ 2px）
  · 行内四个动作齐全：查看 / 复制文案 / 推进状态 / 删除；点「查看」在原位展开详情
  · 换预设（石墨黑 → 靛蓝）立刻生效，不需要刷新；档案里「选中态」跟着变
  · 主题存进 ui_theme（租户级），刷新后还在
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
OUT = pathlib.Path(os.environ.get('TEMP', '/tmp')) / 'xhs_verify_theme'
OUT.mkdir(parents=True, exist_ok=True)
ERRORS = []

NOTES = [
    {'id': 'nA', 'title': '每天多出来的 1 小时，我是这么省下来的', 'draft': '第一段正文。\n第二段干货。',
     'status': '待发', 'origin': 'wizard', 'platform': 'xhs', 'form': '视频', 'style': '卡片轮播口播',
     'topic': '小红书怎么找客户', 'people': ['开店的人'], 'sellPoints': [{'point': '省时间', 'hasImage': False}],
     'voice': '一幕一句。\n第二幕。\n第三幕收尾。', 'visual': {'cover': '封面提示词', 'images': '内页提示词'},
     'thumb': {'kind': 'sell', 'ref': '省时间'}, 'updatedAt': __import__('time').time() * 1000 - 3600000},
    {'id': 'nB', 'title': '别再去猜平台喜欢什么了', 'draft': '另一篇的正文。',
     'status': '已发', 'origin': 'claim', 'platform': 'xhs', 'form': '图文', 'style': '清单卡片式',
     'topic': '小红书怎么找客户', 'updatedAt': __import__('time').time() * 1000 - 86400000 * 3,
     'statusAt': {'已发': __import__('time').time() * 1000 - 86400000 * 2}},
    {'id': 'nC', 'title': '闲鱼上架的第一篇怎么写字数刚好', 'draft': '闲鱼那一篇的正文。',
     'status': '草稿', 'origin': 'derive', 'platform': 'xianyu', 'derivedFromTitle': '每天多出来的 1 小时',
     'form': '图文', 'topic': '闲鱼怎么上架', 'updatedAt': __import__('time').time() * 1000 - 600000},
]

SEED = r'''async (notes) => {
    await Storage.initializeDefaults(DEFAULT_PROMPTS);
    await ensureTenantInit();
    const config = await Storage.getConfig();
    config.product.name = '流程测试产品';
    config.product.sellPoints = [{ title: '省时间', content: '简化重复步骤' }];
    config.ai.apiKey = 'test-local-only';
    await Storage.setConfig(config);
    await chrome.storage.local.set({ np_notes: notes });
    return (await chrome.storage.local.get('ui_theme')).ui_theme || null;
}'''

COLS = ['npar-col-thumb', 'npar-col-ttl', 'npar-col-status', 'npar-col-form', 'npar-col-time', 'npar-col-gap', 'npar-col-act']

MEASURE = r'''(classes) => {
    const head = document.querySelector('#noteArchiveContent .npar-head');
    const row = document.querySelector('#noteArchiveContent .npar-row .npar-line');
    const edges = (root) => classes.map(c => {
        const el = root && root.querySelector('.' + c);
        return el ? Math.round(el.getBoundingClientRect().left) : null;
    });
    return { head: edges(head), row: edges(row),
             rows: document.querySelectorAll('#noteArchiveContent .npar-row').length,
             opens: document.querySelectorAll('#noteArchiveContent .npar-open').length,
             listTop: Math.round((document.querySelector('#noteArchiveContent .npar-list') || {}).getBoundingClientRect
                ? document.querySelector('#noteArchiveContent .npar-list').getBoundingClientRect().width : 0),
             rowH: Array.from(document.querySelectorAll('#noteArchiveContent .npar-line')).map(l => Math.round(l.getBoundingClientRect().height)),
             ttlW: Math.round((document.querySelector('#noteArchiveContent .npar-row .npar-col-ttl') || {}).getBoundingClientRect().width),
             gapW: Math.round((document.querySelector('#noteArchiveContent .npar-row .npar-col-gap') || {}).getBoundingClientRect().width) };
}'''

BRAND = '() => getComputedStyle(document.documentElement).getPropertyValue("--c-brand").trim()'
# 主色当文字用时写的是 --c-brand-text：白底上不够 4.5:1 会自动往黑压，所以不一定等于 --c-brand
BRAND_TEXT = '() => getComputedStyle(document.documentElement).getPropertyValue("--c-brand-text").trim()'

with tempfile.TemporaryDirectory(prefix='xhs-verify-') as profile, sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        profile, headless=False, channel='msedge',
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    try:
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
        assert sw.evaluate('chrome.runtime.onMessage.hasListeners()'), '后台路由没注册上'

        page = ctx.new_page()
        page.on('pageerror', lambda e: ERRORS.append('popup: ' + str(e)[:200]))
        page.set_viewport_size({'width': 1500, 'height': 950})
        page.goto(sw.url.replace('background.js', 'popup.html?mode=big&tabId=0'))
        page.wait_for_function('typeof switchMainTab === "function"')
        print('SEED ui_theme =', sw.evaluate(SEED, NOTES), flush=True)
        page.reload()
        page.wait_for_function('typeof switchMainTab === "function"')
        page.wait_for_timeout(400)

        # ⓪ 点图标开的大窗：该是「最大化铺满屏幕」（老板要的全屏口径，保留窗口边框）
        opened = sw.evaluate('() => openBigWindow(null)')
        assert opened and opened.get('ok'), opened
        page.wait_for_timeout(600)
        states = sw.evaluate('''async (id) => {
            const w = await chrome.windows.get(id, { populate: true });
            return { state: w.state, w: w.width, h: w.height, tabs: (w.tabs || []).length };
        }''', opened['windowId'])
        print('大窗:', states, flush=True)
        assert states['state'] == 'maximized', ('大窗默认没铺满屏幕', states)
        assert states['tabs'] >= 1, states
        sw.evaluate('''async (id) => { await chrome.windows.remove(id); await chrome.storage.local.remove('bigWindowId'); }''', opened['windowId'])
        page.wait_for_timeout(300)

        default_brand = page.evaluate(BRAND)
        print('默认主色 =', default_brand, flush=True)
        assert default_brand.lower() == '#1f2329', ('默认该是石墨黑', default_brand)

        # ① 档案列表
        page.evaluate('() => switchMainTab("noteArchive")')
        page.wait_for_selector('#noteArchiveContent .npar-row', timeout=10000)
        page.wait_for_timeout(400)
        m = page.evaluate(MEASURE, COLS)
        print('行 %d / 查看钮 %d / 列表宽 %d / 标题列 %d / 缺口列 %d / 行高 %s'
              % (m['rows'], m['opens'], m['listTop'], m['ttlW'], m['gapW'], m['rowH']), flush=True)
        assert m['rows'] == 3 and m['opens'] == 3, m
        for i, c in enumerate(COLS):
            if m['head'][i] is None or m['row'][i] is None:
                ERRORS.append('列 %s 找不到（表头 %s / 行 %s）' % (c, m['head'][i], m['row'][i]))
            elif abs(m['head'][i] - m['row'][i]) > 2:
                ERRORS.append('列 %s 表头 %d 与数据行 %d 没对齐' % (c, m['head'][i], m['row'][i]))
        txt = page.inner_text('#noteArchiveContent')
        for want in ['每天多出来的 1 小时', '待发', '图文 · 清单卡片式', '发出去 2 天', '改于', '闲鱼']:
            if want not in txt:
                ERRORS.append('行里少了「%s」' % want)
        page.screenshot(path=str(OUT / 'archive-list.png'))

        # 点查看 → 原位展开
        page.locator('#noteArchiveContent .npar-open').first.click()
        page.wait_for_timeout(300)
        det = page.inner_text('#noteArchiveContent .npar-row.on .npar-detail')
        assert '定稿全文' in det and '这篇基于什么' in det, det[:200]
        assert page.locator('#noteArchiveContent .npar-row.on').count() == 1
        assert page.locator('#noteArchiveContent .npar-copy[data-which="draft"]').count() == 1
        page.screenshot(path=str(OUT / 'archive-open.png'))
        wide = page.evaluate('''() => Math.round(document.querySelector('#noteArchiveContent .npar-row .npar-col-ttl').getBoundingClientRect().width)''')
        print('宽窗(1500) 标题列 =', wide, flush=True)
        assert wide >= 260, ('最大化那种宽度下标题列不该这么窄', wide)

        # 窄一点：次要列该收掉，操作与标题不能挤没
        page.set_viewport_size({'width': 900, 'height': 950})
        page.wait_for_timeout(300)
        narrow = page.evaluate('''() => ({
            vis: Array.from(document.querySelectorAll('#noteArchiveContent .npar-col-time')).filter(e => e.offsetParent).length,
            ttlW: Math.round(document.querySelector('#noteArchiveContent .npar-row .npar-col-ttl').getBoundingClientRect().width),
            actW: Math.round(document.querySelector('#noteArchiveContent .npar-row .npar-col-act').getBoundingClientRect().width),
            sb: document.querySelector('#noteArchiveContent .npar-list').scrollWidth <= document.querySelector('#noteArchiveContent').clientWidth
        })''')
        print('窄窗 900:', narrow, flush=True)
        assert narrow['vis'] == 0, '时间列该在窄窗收掉'
        assert narrow['sb'], '列表不该横向溢出'
        assert narrow['ttlW'] >= 150, ('窄窗下标题列被挤没了', narrow)
        page.screenshot(path=str(OUT / 'archive-narrow.png'))
        page.set_viewport_size({'width': 1500, 'height': 950})
        page.wait_for_timeout(300)

        # ② 换主题：设置 → 界面主题（弹窗左栏里的 settings iframe）
        page.evaluate('() => switchMainTab("settings", "theme")')
        fr = None
        for _ in range(40):
            for f in page.frames:
                if 'settings.html' in (f.url or '') and (f.url or '').endswith('#theme'):
                    fr = f
                    break
            if fr:
                break
            page.wait_for_timeout(200)
        assert fr, '没找到停在 #theme 的设置内嵌实例'
        fr.wait_for_selector('.theme-card', timeout=10000)
        cards = fr.locator('.theme-card')
        print('主题卡 %d 张' % cards.count(), flush=True)
        fr.locator('.theme-card[data-t="indigo"]').click()
        page.wait_for_timeout(500)
        new_brand = page.evaluate(BRAND)
        print('换预设后主色 =', new_brand, flush=True)
        assert new_brand.lower() != default_brand.lower(), '弹窗主色没跟着变'
        stored = page.evaluate('async () => (await chrome.storage.local.get("ui_theme")).ui_theme')
        print('落库 ui_theme =', stored, flush=True)
        assert stored and stored.get('preset') == 'indigo', stored
        page.screenshot(path=str(OUT / 'theme-page.png'))

        # 档案的选中态（筛选胶囊 / 展开行）该是同一套主色
        page.evaluate('() => switchMainTab("noteArchive")')
        page.wait_for_timeout(400)
        chip_rgb = page.evaluate('''() => {
            const on = document.querySelector('#noteArchiveContent .npar-filter[style]');
            return getComputedStyle(on).color;
        }''')
        chip_text = page.evaluate(BRAND_TEXT)
        _b, _g, _r = (int(chip_text[i:i + 2], 16) for i in (1, 3, 5))
        print('主色文字 token =', chip_text, '（主色', new_brand, '）', flush=True)
        print('胶囊文字色 =', chip_rgb, '期望 rgb(%d, %d, %d)' % (_b, _g, _r), flush=True)
        assert chip_rgb == 'rgb(%d, %d, %d)' % (_b, _g, _r), (chip_rgb, chip_text)
        page.screenshot(path=str(OUT / 'archive-indigo.png'))

        # 自定义色：#3366ff 那条输入行走一遍
        page.evaluate('() => switchMainTab("settings", "theme")')
        page.wait_for_timeout(300)
        fr = None
        for _ in range(30):
            for f in page.frames:
                if 'settings.html' in (f.url or '') and (f.url or '').endswith('#theme'):
                    fr = f
                    break
            if fr:
                break
            page.wait_for_timeout(200)
        fr.fill('#themeCustomHex', '#3366ff')
        fr.locator('#themeCustomBtn').click()
        page.wait_for_timeout(500)
        custom = page.evaluate(BRAND)
        print('自定义主色 =', custom, flush=True)
        assert custom.lower() == '#3366ff', custom

        # 刷新还在（读的是 storage，不是内存）
        page.reload()
        page.wait_for_function('typeof switchMainTab === "function"')
        after = page.evaluate(BRAND)
        assert after.lower() == '#3366ff', ('刷新后主题丢了', after)

        # 收回默认，别把这台机器的 storage 留在蓝的
        page.evaluate('''async () => { await chrome.storage.local.set({ ui_theme: { preset: 'graphite' } }); }''')

        if ERRORS:
            raise AssertionError(' | '.join(ERRORS))
        print('\nALL PASS  出图:', OUT, flush=True)
    finally:
        ctx.close()
