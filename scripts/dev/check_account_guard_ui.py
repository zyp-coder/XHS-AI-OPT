"""🛡 账号安全页回归（真浏览器 + 临时 profile + 未打包 extension/）。

盯的是（2026-10-11 四十二改，确认单：资料/账号行为层加固设计.md）：
  · 设置页有「账号安全」Tab，弹窗左栏二级有入口；点开能画全 5 块（挡位卡 / 额度墙 / 静默期 / 单休 / 体检卡）
  · 点挡位卡 → account_guard.level 落盘、弹窗顶栏小标跟着换
  · 点休息日 → account_guard.restDay 落盘（restWeek 带周锚）
  · 体检卡「＋ 记一笔」：三选种类 + 备注 → AccountGuard.record 落盘；
    处罚 → 挡位直落「保守」；历史行渲染降挡说明
  · 全程无 pageerror；后台路由照常注册（lib 顶层抛错会把 SW 整体带崩）
"""
import pathlib
import sys
import tempfile
import time

from playwright.sync_api import sync_playwright
from _guide_gate import goto_big

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / 'extension'
ERRORS = []


def wait_get(page, expr, timeout=10000):
    """轮询一个返回 JS 值的表达式直到为真，返回最后一次的值"""
    end = time.time() + timeout / 1000
    v = None
    while time.time() < end:
        v = page.evaluate(expr)
        if v:
            return v
        page.wait_for_timeout(200)
    return v


with tempfile.TemporaryDirectory(prefix='xhs-guard-') as profile, sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        profile, headless=False, channel='msedge',
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    try:
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
        assert sw.evaluate('chrome.runtime.onMessage.hasListeners()'), '后台路由没注册上（lib 顶层抛错？）'
        print('PASS 后台路由已注册')

        page = ctx.new_page()
        page.on('pageerror', lambda e: ERRORS.append('popup: ' + str(e)[:200]))
        goto_big(page, sw.url.replace('background.js', 'popup.html?mode=big'))
        page.wait_for_function('typeof switchMainTab === "function"')

        # 新 profile 没有 AI Key，弹窗会盖「首次设置」——先关掉再查小标
        if page.locator('#firstSetupPanel').count():
            page.click('#firstSetupPanel #fsClose')
            page.wait_for_selector('#firstSetupPanel', state='detached')

        # 弹窗顶栏 🛡 小标：首帧就该画出当前挡位（新 profile 默认「保守」）
        badge = wait_get(page, '() => { const el = document.getElementById("guardBadge"); return el && el.offsetParent !== null ? el.textContent : ""; }')
        assert badge.startswith('🛡'), '顶栏 🛡 小标没画出来: %r' % badge
        assert '保守' in badge, '新 profile 挡位应为「保守」，实际 %r' % badge
        print('PASS 弹窗顶栏小标：%s' % badge)

        # 进设置 → 左栏二级点「账号安全」
        assert page.locator('#setTabs [data-stab="guard"]').count() == 1, '弹窗设置左栏少了「账号安全」入口'
        page.click('#tabSettings')
        page.wait_for_selector('#settingsFrame', state='attached')
        page.click('#setTabs [data-stab="guard"]')
        fr = page.frame_locator('#settingsFrame')
        fr.locator('#tab-guard.active').wait_for(timeout=15000)

        # 五块都在：3 张挡位卡 / 7 行额度墙 / 7 个日签 / ＋记一笔 / 静默时间轴
        n_cards = fr.locator('.gd-card').count()
        n_wall = fr.locator('.gd-wallrow').count()
        n_days = fr.locator('.gd-day').count()
        assert (n_cards, n_wall, n_days) == (3, 7, 7), '块数不对: cards=%s wall=%s days=%s' % (n_cards, n_wall, n_days)
        assert fr.locator('#gdRecOpen').count() == 1 and fr.locator('.gd-tl').count() == 1, '体检卡按钮 / 静默时间轴缺失'
        print('PASS 账号安全页 5 块齐：挡位卡 %d / 额度墙 %d / 日签 %d' % (n_cards, n_wall, n_days))

        # 点「谨慎」卡 → 落盘 + 回执
        fr.locator('.gd-card[data-level="谨慎"]').click()
        lv = wait_get(page, '() => chrome.storage.local.get("account_guard").then(d => (d.account_guard || {}).level || "")')
        assert lv == '谨慎', '点卡后 account_guard.level 应为「谨慎」，实际 %r' % lv
        print('PASS 挡位卡：点「谨慎」→ account_guard.level=谨慎')

        # 弹窗顶栏小标应跟着换（storage.onChanged 订阅）
        badge2 = wait_get(page, '() => { const el = document.getElementById("guardBadge"); return el ? el.textContent : ""; }')
        assert '谨慎' in badge2, '顶栏小标没跟到「谨慎」: %r' % badge2
        print('PASS 顶栏小标跟随：%s' % badge2)

        # 点「周六」日签 → restDay=6
        fr.locator('.gd-day[data-dow="6"]').click()
        rd = wait_get(page, '() => chrome.storage.local.get("account_guard").then(d => String((d.account_guard || {}).restDay))')
        assert rd == '6', '点周六后 account_guard.restDay 应为 6，实际 %r' % rd
        rw = page.evaluate('() => chrome.storage.local.get("account_guard").then(d => (d.account_guard || {}).restWeek || "")')
        assert len(rw) == 10, 'restWeek 应是周一锚定日期，实际 %r' % rw
        print('PASS 单休日签：点「周六」→ restDay=6（周锚 %s）' % rw)

        # 体检卡记一笔「处罚」：弹层开 → 选处罚 → 保存 → 直落保守 + 历史 1 笔
        fr.locator('#gdRecOpen').click()
        page.wait_for_timeout(300)
        assert fr.locator('#gdRecModal').count() == 1, '记一笔弹层没出来'
        fr.locator('#gdKinds .gd-radio[data-k="处罚"]').click()
        fr.locator('#gdNote').fill('回归检查：模拟平台处罚（别当真）')
        fr.locator('#gdRecSave').click()
        hp = wait_get(page, '() => chrome.storage.local.get("account_health").then(d => (d.account_health || []).length)')
        assert hp == 1, '体检卡应落 1 笔，实际 %s' % hp
        lv2 = page.evaluate('() => chrome.storage.local.get("account_guard").then(d => (d.account_guard || {}).level || "")')
        assert lv2 == '保守', '处罚后挡位应直落「保守」，实际 %r' % lv2
        rec = page.evaluate('() => chrome.storage.local.get("account_health").then(d => d.account_health[0])')
        assert rec['kind'] == '处罚' and rec['before'] == '谨慎' and rec['after'] == '保守' and rec['floor'] is False, '体检记录字段不对: %s' % rec
        fr.locator('.gd-rec').first.wait_for(timeout=5000)
        ra = fr.locator('.gd-rec').first.locator('.ra').inner_text()
        assert '落到「保守」（原「谨慎」）' in ra, '历史行降挡说明不对: %r' % ra
        assert fr.locator('#gdRecModal').evaluate('el => getComputedStyle(el).display') == 'none', '保存后弹层没关'
        print('PASS 体检卡：记「处罚」→ 直落保守、历史 1 笔、弹层关闭')

        assert not ERRORS, 'pageerror: %s' % ERRORS
        print('\nALL PASS')
    finally:
        ctx.close()
