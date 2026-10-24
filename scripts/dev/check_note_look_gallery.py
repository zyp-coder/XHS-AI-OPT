# -*- coding: utf-8 -*-
"""造图片「① 风格」收口自检（六十六改按 demo）：四行面板 ＋ 完整流派名单的两条通路 ＋ 版式轴退市契约。

来历：六十四改① 曾挂「流派画廊 + 8 套版式真排」两排；六十六改按 demo 收口，画廊随轴 chips・张数・纯 CSS 小样・
「这四档各是什么」说明折叠块一起撤下。现在 ① 就四行：引流提示（只引流笔记出）/ 🎨 画面风格（三颗短名单＋条件补位＋
「跟账号默认」）/ ✍️ 配文方式（四档竖列）/ ↺ 全回账号默认。本脚本按现在这一版收口，验这些：

  1) 加行入口只剩 ④ 分镜 空态那颗「＋ 起一套图（跟账号默认）」（七十改：旧「＋ 一套图（先挑流派）」整排已撤）；
     自加派要当行身份就走 npMotifPick 同一条处理器，界面补位那颗 chip 就是它；
  2) ① 面板块只出三颗短名单；这一套的流派不在这三颗里（自加 / 挑过的别派）＝补一颗出来并亮着（挂它自己那派的悬浮），
     落回短名单那颗补位即消失；「跟账号默认」＝退回打底（真人工作场景）；悬浮＝三句配方；
  3) 引流笔记（dir='d'）多一行紫色提示「画面不限风格」；别的方向没有这一行；
  4) 退市契约：NP_LOOK_AXES 现役三轴、旧 8 套版式值落档即丢、15 种配文版式由 NP_CAP_LAYOUTS 接任；① 不再画轴 chips / 张数 / 画廊 / 小样 / 说明折叠块；
  5) 全程零 AI，面板里 img／canvas 计数＝0。

跑法：python3 -X utf8 scripts/dev/check_note_look_gallery.py
临时 profile 加载真扩展（headful msedge），AiClient 全程走桩、不烧真接口。
"""
import pathlib
import shutil
import sys
import tempfile
import time

from playwright.sync_api import sync_playwright
from _guide_gate import goto_big

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / 'extension'
OUT = pathlib.Path(tempfile.gettempdir())
ERRORS = []

BODY = '开场钩子。\n\n第一段干货。\n\n结尾引导。'
NOTE = 'lookg-1'
TITLE = '省时间三步'
CUSTOM = {
    'k': '自家三格',
    'take': '只摆三样东西，一样占一块，别多',
    'cast': '把这段挑出三样最实在的东西，一样一块，按这段说的先后排',
    'forbid': '偷懒：还是把这段的字抄满三块',
    'need': '要三样实物',
}

SEED = r'''async (payload) => {
    await Storage.initializeDefaults(DEFAULT_PROMPTS);
    await ensureTenantInit();
    const cfg = await Storage.getConfig();
    cfg.product.name = '风格收口测试产品';
    cfg.product.sellPoints = [{title: '省时间', content: '把重复步骤压掉'}];
    cfg.ai.apiKey = 'test-local-only';
    cfg.imgMotifs = [payload.custom];
    cfg.imgLook = { born: '扁平矢量插画', theme: '浅底＋单色点缀', layout: '一行大字居中' };   // layout 是旧 8 套那批的值：进 §4 退市契约
    await Storage.setConfig(cfg);
    await chrome.storage.local.set({
        np_notes: [{id: payload.id, title: payload.title, status: '待发', platform: 'xhs',
                    form: '图文', draft: payload.body, createdAt: Date.now()}],
        np_assets: [],
    });
    self.aiCalls = 0;
    AiClient.chatCompletion = async () => { self.aiCalls++; return {content: '{}'}; };
    return true;
}'''


def boot(p):
    for i in range(5):
        prof = OUT / ('lookg-profile%d' % i)
        shutil.rmtree(prof, ignore_errors=True)
        ctx = p.chromium.launch_persistent_context(
            str(prof), headless=False, channel='msedge',
            ignore_default_args=['--disable-extensions'],
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
        t0 = time.time()
        while time.time() - t0 < 25 and not ctx.service_workers:
            time.sleep(0.3)
        if ctx.service_workers:
            return ctx
        print('  扩展没装起来（第 %d 趟），重来' % (i + 1), flush=True)
        ctx.close()
    raise RuntimeError('扩展装不上：连试 5 趟都没有 service worker')


with sync_playwright() as p:
    ctx = boot(p)
    try:
        sw = ctx.service_workers[0]
        assert sw.evaluate('chrome.runtime.onMessage.hasListeners()'), '后台路由没注册上'
        sw.evaluate(SEED, {'body': BODY, 'id': NOTE, 'title': TITLE, 'custom': CUSTOM})

        page = ctx.new_page()
        page.on('pageerror', lambda e: ERRORS.append(str(e)[:200]))
        page.set_viewport_size({'width': 1180, 'height': 900})
        goto_big(page, sw.url.replace('background.js', 'popup.html?mode=big'))
        page.wait_for_function('typeof switchMainTab === "function" && typeof npLookPanelHtml === "function"')
        page.set_default_timeout(25000)

        def calls():
            return sw.evaluate('self.aiCalls')

        def goto_tab(t):
            page.locator('#npImgTabs .np-imgtab[data-t="%s"]' % t).click()
            page.wait_for_timeout(260)

        def motif_chip(k):
            return page.locator('#npLookBox .np-motif[data-k="%s"]' % k)

        def chip_on(k):
            return 'var(--c-brand-soft)' in (motif_chip(k).get_attribute('style') or '')

        def tab_badge(t):
            return page.locator('#npImgTabs .np-imgtab[data-t="%s"]' % t).inner_text().replace(' ', '')

        def look_panel():
            return page.locator('#npLookBox').inner_text()

        def chip_keys():
            return page.locator('#npLookBox .np-motif').evaluate_all('els => els.map(x => x.getAttribute("data-k"))')

        def redraw():
            page.evaluate('() => { const b = document.querySelector("#npLookBox"); if (b) b.innerHTML = npLookPanelHtml(npS()); }')
            page.wait_for_timeout(160)

        # ── 1) 加行入口只剩 ④ 空态那颗「＋ 起一套图」（七十改：旧「＋ 一套图（先挑流派）」整排已撤）；自家派身份走 npMotifPick 同一条处理器 ──
        page.evaluate('async () => { const l = await npNotesAll(); switchMainTab("noteOut", l.find(x => x && x.id === "%s")); }' % NOTE)
        page.wait_for_function('() => _npMode === "out" && !!document.querySelector("#npImgTabs .np-imgtab")')
        n_all = page.evaluate('() => npMotifAll().length')
        assert n_all == 11, '名单本身＝内置十条＋账号自加一条（数据层，不再铺在界面上）：%s' % n_all
        assert calls() == 0, '进这一页不烧 AI：%s' % calls()
        goto_tab('desc')
        page.wait_for_function('() => !!document.querySelector("#npShotTable .np-img-add")')
        assert page.locator('#npShotTable .np-img-add').count() == 1, '加行入口只剩空态这一颗'
        assert '跟账号默认' in page.locator('#npShotTable .np-img-add').inner_text()
        page.locator('#npShotTable .np-img-add').click()
        page.wait_for_function('() => (npS().imgDocs || []).length === 1 && !!npS().imgOpen')
        assert not page.evaluate('() => npS().shots.look.motif'), '空态那颗加的行＝跟账号默认（没自定流派）'
        page.evaluate('() => npMotifPick(npActiveC(), "自家三格")')   # 自加派不在短名单：直接派发这一条处理器，界面补位那颗 chip 就是它
        page.wait_for_function('() => npS().shots.look.motif === "自家三格"')
        assert page.evaluate('() => npS().imgDocs[0].shots.look.motif') == '自家三格', '挑的那条＝这一行自己的身份'
        assert calls() == 0, '加行、记身份都不烧 AI：%s' % calls()
        print('PASS: 加行入口＝④ 空态那颗「＋ 起一套图」（跟账号默认）；自家派身份走同一条处理器（零 AI）', flush=True)

        # ── 2) ① 摊开：四行结构＋这一套的流派不在短名单＝补一颗（亮着）；落回短名单那颗消失 ──
        goto_tab('look')
        panel = look_panel()
        for g in ('🎨 画面风格', '✍️ 配文方式', '↺ 全回账号默认'):
            assert g in panel, '四行之一缺了：%s' % g
        assert '画面不限风格' not in panel, '不是引流笔记＝没有那行紫色提示'
        assert chip_keys() == ['真人工作场景', '方案页', '手写笔记·纸感', '自家三格', ''], \
            '三颗短名单＋自加那颗补位＋跟账号默认：%s' % chip_keys()
        assert chip_on('自家三格'), '这一套自己定的那颗亮着'
        assert '自家三格' in tab_badge('look'), '① 档名＝这一行的流派：%s' % tab_badge('look')
        tip_def = motif_chip('真人工作场景').get_attribute('title') or ''
        assert '怎么把这段文案变成画面' in tip_def and '这样算不合格' in tip_def, '内置那颗的悬浮＝三句配方：%s' % tip_def[:120]
        tipc = motif_chip('自家三格').get_attribute('title') or ''
        assert CUSTOM['cast'] in tipc and CUSTOM['forbid'] in tipc, '自加那颗补位的悬浮＝它自己那派的三句配方：%s' % tipc[:120]
        assert '数据·截图实证' not in panel, '完整名单不铺在 ①（只补了自加那一颗）：%s' % panel[:260]
        assert page.locator('#npLookBox .np-capd').count() == 4, '配文方式四档都摆在这一档'
        motif_chip('方案页').click()
        page.wait_for_function('() => npS().shots.look.motif === "方案页"')
        assert chip_keys() == ['真人工作场景', '方案页', '手写笔记·纸感', ''], '落回短名单后那颗补位消失：%s' % chip_keys()
        assert chip_on('方案页'), '短名单那颗亮着'
        motif_chip('').click()
        page.wait_for_function('() => !npS().shots.look.motif')
        assert chip_on(''), '「跟账号默认」亮着'
        assert page.evaluate('() => npLookOf(npS()).motif') == '真人工作场景', '生效流派落回打底'
        assert '真人工作场景' in tab_badge('look'), tab_badge('look')
        assert calls() == 0, '点派 / 退回全零 AI：%s' % calls()
        print('PASS: ① 面板块只有三颗短名单＋条件补位＋「跟账号默认」；自加那颗补位亮着（带它自己那派的悬浮）、落回短名单即消失（零 AI）', flush=True)

        # ── 3) 引流笔记（dir='d'）多一行紫色提示：画面不限风格；别的方向没有 ──
        page.evaluate('() => { npS().dir = "d"; }')
        redraw()
        assert '画面不限风格' in look_panel() and '图跟着素材和热点走' in look_panel(), look_panel()[:220]
        page.evaluate('() => { npS().dir = ""; }')
        redraw()
        assert '画面不限风格' not in look_panel(), '别的方向没有这一行'
        assert calls() == 0, '这一行只是本地重画：%s' % calls()
        print('PASS: 引流笔记多一行「画面不限风格」；别的方向没有（本地重画，零 AI）', flush=True)

        # ── 4) 退市契约：轴 chips / 张数 / 画廊 / 小样 / 说明折叠块都不再摆；版式轴旧值落档即丢、15 种配文版式接任 ──
        assert page.locator('#npLookBox .np-look').count() == 0, '① 不再画轴 chips'
        assert page.locator('#npLookBox .np-total').count() == 0, '张数 chips 已撤'
        assert page.locator('#npLookBox .np-gal, #npLookBox .np-gal-item').count() == 0, '流派画廊随收口撤下'
        assert page.locator('#npLookBox .np-lookdemo, #npLookBox .np-sketch').count() == 0, '纯 CSS 小样撤下'
        assert page.locator('#npLookBox details').count() == 0, '说明折叠块撤下'
        assert page.locator('#npLookBox img').count() == 0 and page.locator('#npLookBox canvas').count() == 0, \
            '① 面板不摆图、不生成图'
        assert page.evaluate('() => NP_LOOK_AXES.map(a => a.k).join(",")') == 'born,theme,mark', \
            '轴表现役三轴＝出身 / 主题 / 印记（版式轴已退市）'
        assert page.evaluate('''() => {
            const old = npLookShape({layout: '一行大字居中'});        // 六十四改那 8 套里的一个值
            const now = npLookShape({layout: 'big'});                 // 二十二改 15 种里的一个键
            return old.layout === undefined && now.layout === 'big'; }'''), \
            '旧 8 套版式的值落档即丢；新 15 种（big 等键）才留得住（真源 NP_CAP_LAYOUTS）'
        assert page.evaluate('''() => NP_CAP_LAYOUTS.length === 15
            && NP_CAP_LAYOUTS.every(x => x.k && x.t && x.cap && x.d && npLayoutDef(x.k).k === x.k)'''), \
            '配文版式 15 种每项带 k/t/cap/d，npLayoutDef 按 key 认得回'
        tok = page.evaluate('() => npLookToken(npLookOf(npS()))')
        assert '一行大字居中' not in tok and '扁平矢量插画' in tok and '浅底＋单色点缀' in tok, \
            'seed 里那个旧版式值不进令牌，出身/主题照常：%s' % tok
        assert calls() == 0, '退市契约检查一次 AI 都没烧：%s' % calls()
        print('PASS: 退市契约——① 不再有轴 chips／张数／画廊／小样／说明折叠块；旧 8 套版式落档即丢，15 种配文版式由 NP_CAP_LAYOUTS 接任', flush=True)

        assert not ERRORS, '有 pageerror：%s' % ERRORS[:2]
        print('PASS: 无 pageerror', flush=True)
        page.screenshot(path=str(OUT / 'xhs-note-look-gallery.png'))
        print('SHOT: %s' % (OUT / 'xhs-note-look-gallery.png'), flush=True)
    finally:
        ctx.close()

print('\n全绿：① 收口（四行 / 短名单＋条件补位 / 加行入口＝④ 空态那颗）＋ 版式轴退市契约 · 全程零 AI', flush=True)
