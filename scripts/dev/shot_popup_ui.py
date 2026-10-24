"""逐屏截图插件弹窗（做 UI 评估 / 改版前后对比用）。

用法：python3 scripts/dev/shot_popup_ui.py [输出目录]
输出：<目录>/<tab>.png，宽 640（popup 原始尺寸），整页高度。
"""
import os
import pathlib
import sys
import tempfile

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = pathlib.Path(os.environ.get('XHS_ROOT') or '.').resolve()
EXT = ROOT / 'extension'
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'tmp' / 'ui-shots')
OUT.mkdir(parents=True, exist_ok=True)

# 左栏顺序：诊断&配置（6 个二级：基础配置/问卷/人设含说话风格/产品卖点/知识库/规划）→ 发笔记（档案/素材库/任务配置）
# → 获客（队列：📜 队列 + ⚙️ 配置 / 工作台/笔记池/设置）→ 线索（任务配置/通知/消息/设置）→ 设置
TABS = [
    ('1-huoke-work', 'switchMainTab("comment")'),
    ('2b-huoke-queue-config', 'switchMainTab("taskCfg")'),   # 原「任务配置」并进队列；taskCfg 是兼容别名，落到 ⚙️ 配置
    ('2-huoke-queue', '(function(){const q=document.getElementById("drainQueueContent"); if(q) q._qTab="mgmt"; switchMainTab("queue");})()'),
    ('4-huoke-pool', 'switchMainTab("scenarioDrain")'),   # 笔记池这一页也带着评论记录（原「灌水总结」已收进来）
    ('5-lead-notif', 'switchMainTab("prospect")'),
    ('5b-lead-notif-comment', 'switchMainTab("notifComment")'),
    ('5c-lead-msg', 'switchMainTab("prospectMsg")'),
    ('6-notepublish', 'switchMainTab("notePublish")'),
    ('7-diagnose', 'switchMainTab("diagnose")'),
]

# 设置（左栏「设置」内嵌 iframe）：二级 tab 决定落到哪一页，截两张看内嵌效果
SETTINGS_EMBED = [
    ('10-settings-tenant', 'tenant'),
    ('11-settings-delays', 'delays'),   # 拟人化与频率（挡位滑块 + ⚙️ 高级配置弹窗）
]

# 设置页（唯一配置中心）：默认页 + 深链页（另开页的形态，比对用）
SETTINGS_HASHES = [('settings', ''), ('settings-delays', '#delays'), ('settings-leadtask', '#leadtask')]

with tempfile.TemporaryDirectory(prefix='xhs-shot-') as profile, sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        profile, headless=False, channel='msedge',
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    try:
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
        page = ctx.new_page()
        page.on('pageerror', lambda e: print('[pageerror]', str(e)[:200]))
        page.goto(sw.url.replace('background.js', 'popup.html?mode=big'))
        page.wait_for_function('typeof switchMainTab === "function"')
        page.wait_for_timeout(1200)
        # 大窗的真实开窗尺寸（background.js openBigWindow：1160x900），照它截才有参考价值
        page.set_viewport_size({'width': 1160, 'height': 900})

        def dismiss_setup():
            try:
                page.evaluate('''() => { for (const b of document.querySelectorAll('button')) {
                    if (b.id === 'fsClose') b.click();
                } }''')
            except Exception:
                pass

        dismiss_setup()
        page.wait_for_timeout(300)
        for name, js in TABS:
            try:
                dismiss_setup()
                page.evaluate(js)
                page.wait_for_timeout(600)
                dismiss_setup()
                page.screenshot(path=str(OUT / f'{name}.png'))
                print('shot', name)
            except Exception as e:
                print('FAIL', name, str(e)[:160])
        # 配置页三张卡：2b 拍「🔎 跑什么」卡头；再补一张「👤 盯的账号」表（和词池同在跑什么卡里，往下滚）
        try:
            dismiss_setup()
            page.evaluate('switchMainTab("taskCfg")')
            page.wait_for_timeout(1200)
            page.locator('#drainCfgContent #sxAcctAdd').scroll_into_view_if_needed()
            page.wait_for_timeout(400)
            dismiss_setup()
            page.screenshot(path=str(OUT / '2c-taskcfg-acct.png'))
            print('shot 2c-taskcfg-acct')
        except Exception as e:
            print('FAIL 2c-taskcfg-acct', str(e)[:160])
        # 线索 · 任务配置 / 设置 + 获客 · 设置：都是整页嵌的配置页
        # （线索·任务配置＝🎙 渠道基调 / 💰 成交引导 / 🗨 话术配置 / 🧪 试问答四个横 tab，默认那张＝🎙；获客·设置＝🤖 拟人化与频率；线索·设置只剩 Bot）
        for name, js in (('5d-lead-taskcfg', 'switchMainTab("leadTaskCfg")'), ('5e-lead-cfg', 'switchMainTab("leadCfg")'),
                         ('5f-huoke-cfg', 'switchMainTab("huokeCfg")')):
            try:
                dismiss_setup()
                page.evaluate(js)
                page.wait_for_timeout(1100)   # 内嵌页首次挂载要等它加载完再截
                dismiss_setup()
                page.screenshot(path=str(OUT / f'{name}.png'))
                print('shot', name)
            except Exception as e:
                print('FAIL', name, str(e)[:160])
        # 获客 · 设置里的 ⚙️ 高级配置弹窗（2026-09-25：挡位为主，其余参数收进这个弹窗）
        try:
            dismiss_setup()
            page.evaluate('switchMainTab("huokeCfg")')
            frame = page.frame_locator('#huokeCfgFrame')
            frame.locator('#tab-delays.tab-panel.active').wait_for(state='attached', timeout=15000)
            page.wait_for_timeout(700)
            frame.locator('#delayAdvBtn').click()
            frame.locator('#delayAdvModal').wait_for(state='visible', timeout=8000)
            page.wait_for_timeout(500)
            page.screenshot(path=str(OUT / '5g-huoke-cfg-adv.png'))
            print('shot 5g-huoke-cfg-adv')
        except Exception as e:
            print('FAIL 5g-huoke-cfg-adv', str(e)[:160])
        # 发笔记二级：写文案（上面 6 那张，从档案页里进）/ 素材库 / 笔记档案 / 出片台 + 任务配置默认页（🧬 阶段）
        for name, js in (('6b-note-assets', 'switchMainTab("noteAssets")'),
                         ('6c-note-archive', 'switchMainTab("noteArchive")'),
                         ('6d-note-film', 'switchMainTab("noteFilm")'),
                         ('6e-note-taskcfg-stage', 'switchMainTab("noteTaskCfg")')):
            try:
                dismiss_setup()
                page.evaluate(js)
                page.wait_for_timeout(1100)   # 出片台是内嵌页，给足加载时间
                dismiss_setup()
                page.screenshot(path=str(OUT / f'{name}.png'))
                print('shot', name)
            except Exception as e:
                print('FAIL', name, str(e)[:160])
        # 诊断&配置 6 个二级节点逐个点开：基础配置 / 问卷 / 人设（页内含「说话风格」）/ 产品卖点 / 知识库 / 规划
        # （2026-10-01 导航改版：①~⑨ 序号全废，只剩名字；说话风格并进人设，客服话术搬去线索·任务配置，内容基调搬去发笔记·任务配置）
        for i in range(1, 7):
            name = f'7-diagnose-{i}'
            try:
                dismiss_setup()
                page.evaluate('switchMainTab("diagnose")')
                page.wait_for_timeout(400)
                btn = page.locator(f'#diagSubTabs [data-go="{i}"]').first
                btn.click()
                page.wait_for_timeout(900)
                dismiss_setup()
                page.screenshot(path=str(OUT / f'{name}.png'))
                print('shot', name, '|', btn.inner_text().strip())
            except Exception as e:
                print('FAIL', name, str(e)[:160])
        # 改版后新形态补拍：人设页内「说话风格」横 tab（原 ⑥ 整页搬进来）
        try:
            dismiss_setup()
            page.evaluate('switchMainTab("diagnose")')
            page.wait_for_timeout(400)
            page.locator('#diagSubTabs [data-go="3"]').first.click()
            page.wait_for_timeout(700)
            page.locator('#diagPersonaTabs .dg-tab[data-sec="style"]').click()
            page.wait_for_timeout(700)
            page.screenshot(path=str(OUT / '7-diagnose-3b-persona-style.png'))
            print('shot 7-diagnose-3b-persona-style |', page.locator('#diagPersonaTabs .dg-tab.active').inner_text().strip())
        except Exception as e:
            print('FAIL 7-diagnose-3b-persona-style', str(e)[:160])
        # 知识库：「📦 备份 ▾」下拉菜单摊开（备份/导入拆开后的样子）
        try:
            dismiss_setup()
            page.evaluate('switchMainTab("diagnose")')
            page.wait_for_timeout(400)
            page.locator('#diagSubTabs [data-go="5"]').first.click()
            page.wait_for_timeout(900)
            page.locator('#diagKBkMenuBtn').click()
            page.locator('#diagKBkPop').wait_for(state='visible', timeout=8000)
            page.wait_for_timeout(300)
            page.screenshot(path=str(OUT / '7-diagnose-5b-kb-backup-pop.png'))
            print('shot 7-diagnose-5b-kb-backup-pop |', page.locator('#diagKBkPop').inner_text().replace('\n', ' / ')[:120])
        except Exception as e:
            print('FAIL 7-diagnose-5b-kb-backup-pop', str(e)[:160])
        # 知识库：行内「编辑」＝弹窗（不再原地改列表那一行）——干净 profile 是空库，先种一条才有行可点
        try:
            dismiss_setup()
            page.evaluate('switchMainTab("diagnose")')
            page.wait_for_timeout(400)
            page.locator('#diagSubTabs [data-go="5"]').first.click()
            page.wait_for_timeout(900)
            seeded = page.evaluate('''async () => await chrome.runtime.sendMessage({ action: 'saveKnowledgeBase',
                data: { mode: 'merge', entries: [{ title: '截图用·一条知识的正文长啥样', content: '正文直接在列表那一行里显示（限字数，点开「编辑」才改）。'.repeat(3), category: '使用技巧', tags: ['截图'] }] } })''')
            print('seed kb |', seeded and seeded.get('ok'))
            page.locator('#diagKRefresh').click()
            page.locator('#diagKList .diag-kb-edit-btn').first.wait_for(state='visible', timeout=15000)
            page.wait_for_timeout(400)
            page.screenshot(path=str(OUT / '7-diagnose-5d-kb-list.png'))    # 正文常显的那一行
            page.locator('#diagKList .diag-kb-edit-btn').first.click()
            page.locator('#diagKEditPanel').wait_for(state='visible', timeout=8000)
            page.wait_for_timeout(400)
            page.screenshot(path=str(OUT / '7-diagnose-5c-kb-edit-modal.png'))
            print('shot 7-diagnose-5c-kb-edit-modal')
            page.keyboard.press('Escape')
        except Exception as e:
            print('FAIL 7-diagnose-5c-kb-edit-modal', str(e)[:160])
        # 产品卖点 ·「新增卖点」弹窗：点进哪一种方式就停在那一种（不再有「重新选择方式」那一排），关闭 + 保存同排
        for sel, name in (('', '7-diagnose-4b-sell-methods'), ('[data-sell-method="manual"]', '7-diagnose-4c-sell-manual')):
            try:
                dismiss_setup()
                page.evaluate('switchMainTab("diagnose")')
                page.wait_for_timeout(400)
                page.locator('#diagSubTabs [data-go="4"]').first.click()
                page.wait_for_timeout(900)
                page.locator('#diagSellAdd').click()
                page.locator('#diagSellDialog').wait_for(state='visible', timeout=8000)
                if sel:
                    page.locator(f'#diagSellMethods {sel}').click()
                    page.wait_for_timeout(500)
                page.wait_for_timeout(400)
                page.screenshot(path=str(OUT / f'{name}.png'))
                print('shot', name, '|', page.locator('#diagSellDialogTitle').inner_text().strip())
                page.keyboard.press('Escape')
            except Exception as e:
                print('FAIL', name, str(e)[:160])
        # 知识库 ·「新增知识」弹窗：同样进去就停住（随意输入 → AI 整理那一屏不给回退按钮）
        for sel, name in (('', '7-diagnose-5e-kb-methods'), ('[data-kb-method="text"]', '7-diagnose-5f-kb-text')):
            try:
                dismiss_setup()
                page.evaluate('switchMainTab("diagnose")')
                page.wait_for_timeout(400)
                page.locator('#diagSubTabs [data-go="5"]').first.click()
                page.wait_for_timeout(900)
                page.locator('#diagKAddBtn').click()
                page.locator('#diagKAddPanel').wait_for(state='visible', timeout=8000)
                if sel:
                    page.locator(f'#diagKMethods {sel}').click()
                    page.wait_for_timeout(500)
                page.wait_for_timeout(400)
                page.screenshot(path=str(OUT / f'{name}.png'))
                print('shot', name, '|', page.locator('#diagKAddTitle').inner_text().strip())
                page.keyboard.press('Escape')
            except Exception as e:
                print('FAIL', name, str(e)[:160])
        # 线索 · 任务配置：页内四个横 tab（🎙 渠道基调是上面 5d 那张默认页）
        lf = page.frame_locator('#leadTaskCfgFrame')
        for sec, name in (('guide', '5d2-lead-cfg-guide'), ('qa', '5d3-lead-cfg-qa'), ('test', '5d4-lead-cfg-test')):
            try:
                dismiss_setup()
                page.evaluate('switchMainTab("leadTaskCfg")')
                page.wait_for_timeout(1200)
                lf.locator(f'#ltCfgTabs [data-sec="{sec}"]').click()
                page.wait_for_timeout(900)
                page.screenshot(path=str(OUT / f'{name}.png'))
                print('shot', name, '|', lf.locator('#ltCfgTabs .cfgtab.active').inner_text().strip())
            except Exception as e:
                print('FAIL', name, str(e)[:160])
        # 发笔记 · 任务配置（内容基调新家）：页内三个横 tab（🧬 阶段是默认页）
        for sec, name in (('lines', '6e2-note-cfg-lines'), ('talk', '6e3-note-cfg-talk')):
            try:
                dismiss_setup()
                page.evaluate('switchMainTab("noteTaskCfg")')
                page.wait_for_timeout(900)
                page.locator(f'#noteToneTabs .nt-tab[data-sec="{sec}"]').click()
                page.wait_for_timeout(800)
                dismiss_setup()
                page.screenshot(path=str(OUT / f'{name}.png'))
                print('shot', name, '|', page.locator('#noteToneTabs .nt-tab.active').inner_text().strip())
            except Exception as e:
                print('FAIL', name, str(e)[:160])
        # 设置内嵌在弹窗里：左栏「设置」＋二级 tab 切页，截之前等 iframe 里那一页真的激活
        for name, stab in SETTINGS_EMBED:
            try:
                dismiss_setup()
                page.evaluate(f'switchMainTab("settings", "{stab}")')
                frame = page.frame_locator('#settingsFrame')
                frame.locator(f'#tab-{stab}.tab-panel.active').wait_for(state='attached', timeout=15000)
                page.wait_for_timeout(900)
                dismiss_setup()
                page.screenshot(path=str(OUT / f'{name}.png'))
                print('shot', name)
            except Exception as e:
                print('FAIL', name, str(e)[:160])
        # 窄窗（默认 640 弹窗）再补两张：左栏在窄窗是图标栏，得单独看
        page.set_viewport_size({'width': 640, 'height': 460})
        for name, js in [('8-narrow-huoke', 'switchMainTab("comment")'), ('9-narrow-queue', 'switchMainTab("queue")')]:
            try:
                dismiss_setup()
                page.evaluate(js)
                page.wait_for_timeout(600)
                dismiss_setup()
                page.screenshot(path=str(OUT / f'{name}.png'))
                print('shot', name)
            except Exception as e:
                print('FAIL', name, str(e)[:160])
        # 设置页（唯一配置中心）：默认页 + 深链页
        for name, h in SETTINGS_HASHES:
            st = ctx.new_page()
            st.on('pageerror', lambda e, n=name: print(f'[settings:{n} pageerror]', str(e)[:200]))
            st.goto(sw.url.replace('background.js', 'settings.html') + h)
            st.wait_for_timeout(1400)
            st.set_viewport_size({'width': 1180, 'height': 820})
            st.screenshot(path=str(OUT / f'{name}.png'))
            active = st.evaluate('() => document.querySelector(".tab-item.active")?.dataset.tab')
            print('shot', name, '| active tab =', active)
            st.close()
    finally:
        ctx.close()
print('输出目录：', OUT)
