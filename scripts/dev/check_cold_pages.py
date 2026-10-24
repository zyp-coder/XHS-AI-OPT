"""#12 冷载点检（2026-10-09）：免打包加载 extension/ 的冷环境，把「发笔记」这几处逐页过一遍——
都能渲染、页头是新叫法、可见文本里没有旧叫法（写文案 / 造图片 / 出片台 / 划重点）。

覆盖（#12 清单）：笔记档案 +「下一步」、🖼 出图（画面页）、字效编辑器、发布教程下线核查、资料/名词解析.html。
（旧的「🎬 渲染任务」表七十改起整页撤下：这里改成核它连容器带入口都不再存在。）
（📖 发布教程三十七改整页下线（发布台已替代）：改成核容器 / 渲染函数 / 数据层都不再存在。）
用法：python3 scripts/dev/check_cold_pages.py（弹一个独立 Edge 窗口，跑完自关；截图落 tmp/cold12_*.png）
"""
import pathlib
import sys
import tempfile

from playwright.sync_api import expect, sync_playwright
from _guide_gate import goto_big

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / 'extension'
OLD_WORDS = ['写文案', '造图片', '出片台', '划重点']

with tempfile.TemporaryDirectory(prefix='xhs-cold-') as profile, sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        profile, headless=False, channel='msedge',
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    try:
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')

        # 种好配置再开页：有假 AI key 才不铺全屏首次设置面板（会把所有点击挡住）
        sw.evaluate('''async () => {
            await Storage.initializeDefaults(DEFAULT_PROMPTS);
            await ensureTenantInit();
            const cfg = await Storage.getConfig();
            cfg.ai.apiKey = 'test-local-only';
            cfg.product.name = '冷载点检产品';
            cfg.product.sellPoints = [{ title: '省时间', content: '把重复步骤压掉' }];
            await Storage.setConfig(cfg);
            await chrome.storage.local.set({ np_notes: [{
                id: 'cold_k1', title: '冷载点检·知识篇', dir: 'k', status: '草稿',
                voice: '', form: '图文', kb: [], updatedAt: Date.now(), createdAt: Date.now(),
            }] });
        }''')

        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.set_default_timeout(15000)
        goto_big(page, sw.url.replace('background.js', 'popup.html?mode=big'))
        page.wait_for_function('typeof switchMainTab === "function"')
        if page.locator('#firstSetupPanel').count():      # 保险：首次设置面板要是还铺着，点掉它
            page.locator('#fsClose').click()
            page.wait_for_function('() => !document.getElementById("firstSetupPanel")')

        def no_old(label, txt):
            hit = [w for w in OLD_WORDS if w in txt]
            assert not hit, f'{label}: 可见文本还有旧叫法 {hit}'
            print(f'PASS: {label}：可见文本无旧叫法')

        def shot(name):
            page.screenshot(path=str(ROOT / 'tmp' / f'cold12_{name}.png'))

        # ① 笔记档案：行 +「下一步」都在，点它进写稿
        page.locator('#tabNotePublish').click()
        page.wait_for_function('() => !!document.querySelector("#noteArchiveContent .npar-next")')
        no_old('笔记档案', page.evaluate('document.body.innerText'))
        nx = page.locator('#noteArchiveContent .npar-next')
        lab = nx.inner_text().strip()
        tip = nx.get_attribute('title') or ''
        assert lab == '✏️ 编辑' and '还没正文' in tip, f'知识篇没正文：按钮该是「✏️ 编辑」、title 说还没正文，实际「{lab}」/「{tip}」'
        shot('1_archive')
        nx.click()
        page.wait_for_function('() => { const nc = document.getElementById("notePublishContent"); return nc && nc.style.display !== "none" && nc.innerText.trim().length > 50; }')
        no_old('档案→下一步（编辑）', page.evaluate('document.body.innerText'))
        print('PASS: 档案「下一步」（%s）点了已进写稿并渲染' % lab)
        shot('2_write')

        # ② 旧的「🎬 渲染任务」表整页已撤（七十改）：容器与左栏入口都不再有——回档案页顺手核一遍可见文本
        assert page.locator('#noteTaskContent').count() == 0 and page.locator('#tabNoteTask').count() == 0, \
            '旧的渲染任务表该连容器带左栏入口一起撤下'
        page.locator('#tabNoteArchive').click()
        page.wait_for_function('() => !!document.querySelector("#noteArchiveContent .npar-next")')
        assert '渲染任务' not in page.evaluate('document.body.innerText'), '前端可见文本不该再出现「渲染任务」这个名字'
        no_old('笔记档案（渲染任务表撤下后）', page.locator('#noteArchiveContent').inner_text())
        print('PASS: 旧的「🎬 渲染任务」表已整页撤下（容器 / 入口都不在，页面文本也没有这个名字）')
        shot('3_task')

        # ③ 🖼 出图（画面页，按这篇）
        page.evaluate('async () => { const l = await npNotesAll(); switchMainTab("noteOut", l[0]); }')
        expect(page.locator('#noteOutputContent')).to_contain_text('🖼 出图')
        no_old('🖼 出图（画面页）', page.locator('#noteOutputContent').inner_text())
        shot('4_out')

        # ④ 字效编辑器（拆墙后不再隔一层网页：台子零件就挂在本页 #filmPane 里，
        #   外壳三件＝外层画的 #filmHead／#filmSteps／#filmFoot，盖板 #filmGate 让开才算露出台子）
        #   三十七改后页头口径＝「出片 · {成片形式}」：这句现在挂在台子里那根 #headKind 上
        page.evaluate('() => npGoFilm({ noteId: "cold_k1", title: "冷载点检·知识篇", kind: "PPT字体动效" })')
        page.wait_for_function('() => { const F = window.Film; return !!(F && F.noteId === "cold_k1"); }', timeout=30000)
        assert '出片 · PPT字体动效' in (page.locator('#filmPane #headKind').text_content() or ''), \
            page.locator('#filmPane #headKind').text_content()
        page.wait_for_function('() => { const g = document.getElementById("filmGate"); return g && g.style.display === "none"; }')
        no_old('字效编辑器', page.locator('#filmContent').inner_text())
        shot('5_film')

        # ⑤ 📖 发布教程已整页下线（三十七改：发布台已替代）——容器 / 渲染函数 / 数据层都不该再存在
        gone = page.evaluate('''() => ({
            box: !!document.getElementById('noteGuideContent'),
            fn: (typeof npGuideHtml !== 'undefined') || (typeof npGuideC !== 'undefined') || (typeof npGuidePick !== 'undefined'),
            lib: typeof Guides !== 'undefined',
        })''')
        assert not gone['box'] and not gone['fn'] and not gone['lib'], f'教程页该整页清干净，还有残留：{gone}'
        page.evaluate('() => switchMainTab("noteArchive")')   # 去档案兜一眼：行上不再有「教程」那颗入口
        page.wait_for_function('() => !!document.querySelector("#noteArchiveContent .npar-next")')
        assert '教程' not in page.locator('#noteArchiveContent').inner_text(), '档案行里不该再提教程'
        print('PASS: 发布教程整页已下线（容器 / npGuide* / Guides 数据层全无，档案行不再提教程）')

        # ⑥ 名词解析页（资料/名词解析.html，独立页）
        doc = ctx.new_page()
        doc.on('pageerror', lambda e: errors.append('名词解析: ' + str(e)))
        doc.goto((ROOT / '资料' / '名词解析.html').as_uri())
        doc.wait_for_timeout(800)
        gtxt = doc.evaluate('document.body.innerText')
        no_old('名词解析页', gtxt)
        assert '名词' in gtxt, '名词解析页没渲染出内容'
        doc.screenshot(path=str(ROOT / 'tmp' / 'cold12_7_glossary.png'))
        print('PASS: 名词解析页已渲染且无旧叫法')

        assert not errors, 'pageerror：' + ' | '.join(errors[:5])
        print('PASS: 全程零 pageerror')
        print('ALL PASS')
    finally:
        ctx.close()
