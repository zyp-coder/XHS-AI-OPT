# -*- coding: utf-8 -*-
"""造图片「① 这一套图的风格」那一档自检（六十六改按 demo 收口：只剩四行——引流提示 / 🎨 画面风格 / ✍️ 配文方式 / ↺ 全回账号默认；轴 chips・张数・大样・说明块・画廊都撤下）。

老板口径：风格要当工作流里单独一格来设计——不只字体颜色大小，而是成图风格 / 主题 / 博主特色；
「怎么画」那两类轴（画面出身 · 主题）在账号级定一次，某一套要不一样就在那一套上改，只记那一套。
（二十二改收口：旧「博主印记」轴退市——印记三选 / 笔记分类小标 / 配文版式都搬去 发笔记 · 任务配置 → 🎨 出图风格 那一签，这一档不再画它们）
配文方式（说一次 / 辅助标注 / 整段上屏 / 只一句大字）也是这一格的事（六十二改，替掉旧的字量档），提示词里不再写死「不超过 14 字」。
六十三改对齐：造图片做成五档横置 tab（① 风格 → ② 封面 → ③ 断句 → ④ 分镜 → ⑤ 预览），这一档就是第一档——
  🔁 那颗跟着它管的事挪到 ④ 的表头（这一档不摆）；两轴＋配文方式只进本地拼的提示词尾巴（改一次都不烧 AI），流派名才进 AI 那一发。
六十一改（老板：「风格都改成统一的小红书风格」）：这一档从「关卡」变「旋钮」——
  层级三份：内置统一小红书打底（NP_LOOK_XHS：真人工作场景 ＋ 实拍照片 ＋ 暗调实拍·单一暖光源，配文说一次）
  → 账号默认（任务配置 · 🎨 出图风格）→ 这一套自己改的那几轴；没挑流派不会再落在 ①，直接落到该干活的那一档。
六十五改（2026-10-04 字后压）：④ 的提示词里不再出现要压的那几句话——只说「字位＝X 那一格留干净的底」（npBlankBlock），
  图上那套字由 ⑤ 合成视图与 ⬇ 导出在本地压；所以本支 ④ 那一格的断言读「字位」「后压」那两块，不读大字／承接。
六十六改（2026-10-09 按 demo 收口）：① 从「一整套旋钮」收成四行——引流提示（只引流笔记出）／🎨 画面风格（三颗短名单＋条件补位＋「跟账号默认」）／
  ✍️ 配文方式（四档竖列）／↺ 全回账号默认；三类轴旋钮・出图张数那排 chips・纯 CSS 小样・「这四档各是什么」说明块・十派画廊整批撤下。
  完整流派名单（内置十条＋账号自加）还在工作台「＋ 一套图（先挑流派）」那一排；已存旧档的轴值与张数依旧往返、只当读数报。

口径（这一支只管 ① 那一档，段怎么拖归 check_note_cut.py；收口与退市契约的细账在 check_note_look_gallery.py）：
  1) 加一行零 AI：② 那两栏还没写 → 打开先停在 ②（六十四改收轻：它就剩文案＋提示词两栏），点「不出封面」放行才落 ③ 断句（风格有打底，① 不挡在前面）；切到 ① 才摊开风格面板；
  2) ① 摊开就四行：短名单三颗＋「跟账号默认」＝四颗 chip（这一套没定过＝「跟账号默认」亮着）；生效流派仍从打底读（真人工作场景），
     令牌与提示词尾巴在函数层读得出，默认不许抄进这一套的存档；
  3) 点一颗短名单＝只记这一套（那颗 chip 亮起、① 档名跟着换）；再点同一颗 / 点「跟账号默认」＝退回；↺ 全回账号默认＝这一套那份覆盖整份清掉（配文档也跟着退）——全程零 AI；
  4) 令牌＝旧两轴按顺序拼出来（永远不为空：打底兜着）；④ 那张表每一行的提示词当场带上「每一张都带的固定元素」；
  4b) 出图张数旋钮已撤（面板不再摆），但旧档的 shots.total 依旧被读：③ 顶上报「还差几段」、🔮 那一发照它挑句、⑤ 那条检查也照它报；
  4c) 退市契约：轴 chips / 张数 chips / 纯 CSS 小样 / 说明折叠块 / 画廊都不再出现；说明收进 chip 悬浮（title）——都不烧 AI；
  5) 配文方式四档（六十五改起图上那句大字＝④ 选定的那一句，AI 不另写字）：四档都只把「字位」写进提示词，段的原文一个字不上屏（字是后压的）；
  6) 这一套的 look 落进档案，从档案再进来读得回（零 AI）；落点跟着 npImgLand 走：段有了、封面还没定画面＝落在 ②。
  7) 发笔记 · 任务配置 → 🎨 出图风格：画面风格小样 ＋ 印记三选 ＋ 笔记分类开关 ＋ 配文版式 15 种按「打底 ＋ 已存默认」回显；按「💾 保存出图风格」落 config.imgLook，切走再回来还在。

跑法：python3 -X utf8 scripts/dev/check_note_look.py
临时 profile 加载真扩展（msedge），AiClient 全程走桩、不烧真接口。
"""
import pathlib
import shutil
import sys
import tempfile
import time

from playwright.sync_api import sync_playwright

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
SENTS = ['开场钩子。', '第一段干货。', '结尾引导。']
# 账号默认只设了两轴（旧博主印记轴已退市）：配文落回打底那一档（说一次），令牌＝这两轴按顺序拼出来
TOKEN = '扁平矢量插画；浅底＋单色点缀'

SEED = r'''async (payload) => {
    await Storage.initializeDefaults(DEFAULT_PROMPTS);
    await ensureTenantInit();
    const cfg = await Storage.getConfig();
    cfg.product.name = '风格节点测试产品';
    cfg.product.sellPoints = [{title: '省时间', content: '把重复步骤压掉'}];
    cfg.ai.apiKey = 'test-local-only';
    cfg.imgLook = { born: '扁平矢量插画', theme: '浅底＋单色点缀' };
    await Storage.setConfig(cfg);
    await chrome.storage.local.set({
        np_notes: [{id: 'look-1', title: '省时间三步', status: '待发', platform: 'xhs',
                    form: '图文', draft: payload.body, createdAt: Date.now()}],
        np_assets: [],
    });
    // 这一支只有 4b) 那两发 🔮 挑每屏那句是真的点（要读它喂给 AI 的那份料），其余全程零 AI；🔁 一次都不点
    self.aiCalls = 0;
    self.cuts = [];
    AiClient.chatCompletion = async (cfg2, system, user) => {
        self.aiCalls++;
        const sys = String(system || '');
        if (sys.indexOf('你在帮一条') >= 0) {
            self.cuts.push({sys: sys, us: String(user || '')});
            return {content: '{"提名句":[]}'};
        }
        return {content: '{}'};
    };
    return true;
}'''


def boot(p):
    for i in range(5):
        prof = OUT / ('look-profile%d' % i)
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
        sw.evaluate(SEED, {'body': BODY})

        page = ctx.new_page()
        page.on('pageerror', lambda e: ERRORS.append(str(e)[:200]))
        page.set_viewport_size({'width': 1180, 'height': 900})
        page.goto(sw.url.replace('background.js', 'popup.html?mode=big'))
        page.wait_for_function('typeof switchMainTab === "function" && typeof npLookPanelHtml === "function"')
        page.set_default_timeout(25000)

        def calls():
            return sw.evaluate('self.aiCalls')

        def tab_on(t):
            return page.locator('#npImgTabs .np-imgtab[data-t="%s"]' % t)

        def goto_tab(t):
            tab_on(t).click()
            page.wait_for_timeout(260)

        def cur_tab():
            return page.evaluate('() => npTabOf(npS())')

        def tab_badge(t):
            return tab_on(t).inner_text().replace(' ', '')

        def motif_chip(k):
            return page.locator('#npLookBox .np-motif[data-k="%s"]' % k)

        def chip_on(k):
            return 'var(--c-brand-soft)' in (motif_chip(k).get_attribute('style') or '')

        def gut_box(i):
            el = page.locator('#npCutWrap .np-cutline').nth(i).locator('.np-cut-gut')
            el.scroll_into_view_if_needed()
            return el.bounding_box()

        def poke(i):
            """点一行没归段的行号＝这一句自己成一段（③ 那边验过拖，这里只要「一句一段」这份料）"""
            box = gut_box(i)
            page.mouse.click(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
            page.wait_for_timeout(300)

        def goto_out(note_id, add_row=False, tab=None):
            """直开这一篇的「🖼 出图」（档案那一行「下一步」走的同一条路，别再过旧的行选择器；七十改：渲染任务表已撤）；
            加一行＝④ 分镜 空态那颗「＋ 起一套图」，加完再进一次这一页（npImgLand 照旧算落档，保住下面 cur_tab() 那批断言）"""
            def enter():
                page.evaluate('''async (id) => {
                    const list = await npNotesAll();
                    const n = list.find(x => x && x.id === id) || null;
                    switchMainTab('noteOut', n);
                }''', note_id)
                page.wait_for_function('() => _npMode === "out" && !!document.querySelector("#npImgTabs .np-imgtab")')
            enter()
            if add_row:
                goto_tab('desc')
                page.wait_for_function('() => !!document.querySelector("#npShotTable .np-img-add")')
                page.locator('#npShotTable .np-img-add').click()
                page.wait_for_function('() => (npS().imgDocs || []).length === 1 && !!npS().imgOpen')
                enter()
            if tab:
                goto_tab(tab)

        def pout(i=0):
            """④ 那一格提示词的真读口：它在 <details> 里（默认收起），textContent 不受收起影响"""
            return page.locator('.np-shot-pout').nth(i).evaluate('(el) => el.textContent')

        def prompts():
            """这一套拼好的整份提示词（④ 那一格显示的就是它）：站在 ① 这一档也能读，不用切来切去"""
            return page.evaluate('() => String(((npS() || {}).visual || {}).images || "")')

        def cuts():
            return sw.evaluate('() => self.cuts')

        def wait_cut(n, timeout=20.0):
            """🔮 那一发异步回写：桩记录在后台，Python 这边轮询到第 n 发落定"""
            t0 = time.time()
            while time.time() - t0 < timeout:
                if len(cuts()) >= n:
                    return cuts()[n - 1]
                page.wait_for_timeout(250)
            raise AssertionError('等不到第 %s 发 🔮（目前 %s 发）' % (n, len(cuts())))

        def cut_text():
            return page.locator('#npCutWrap').inner_text().replace(' ', '')

        def check_line():
            """⑤ 顶上那条检查（零 AI 扫全篇缺口）：读它要切到 ⑤，读完自己切回来"""
            goto_tab('preview')
            return page.locator('#npPreviewBox').inner_text().replace(' ', '')

        def look_panel():
            return page.locator('#npLookBox').inner_text()

        # ── 1) 加一行＝零 AI：② 那两栏还没写＝打开先落在 ②（六十四改收轻）；点「不出封面」放行才落 ③ ──
        goto_out('look-1', add_row=True)
        assert cur_tab() == 'cover', '这一行封面那一份还没写＝打开先落在 ②：%s' % cur_tab()
        assert calls() == 0, '加一行带打开都不该烧 AI：%s' % calls()
        page.locator('#npCoverBox .np-cover-on[data-v="0"]').click()
        page.wait_for_function('() => npS().shots.cv.on === false')
        assert page.evaluate('() => npImgLand(npS())') == 'cut',             '一段都还没圈＝不硬定封面后该落在 ③ 断句（风格有打底，① 不挡在前面）'
        goto_tab('cut')
        assert page.locator('#npCutWrap').count() == 1, '③ 那一档摊开的就是断句台'
        assert page.locator('#npImgTabs .np-imgtab').count() == 5
        assert '真人工作场景' in tab_badge('look'), '① 那一档的标签＝打底那一派（不挑也是它）：%s' % tab_badge('look')
        assert page.evaluate('() => (npS().shots.items || []).length') == 0, '刚加的一行一段都还没圈'
        goto_tab('look')
        assert page.locator('#npLookBox').count() == 1, '切到 ① 才摊开风格面板'
        panel = page.locator('#npLookBox').inner_text()
        assert '🎨 画面风格' in panel and '✍️ 配文方式' in panel, '① 摊开就这两行主旋钮：%s' % panel[:200]
        assert '↺ 全回账号默认' in panel, panel[:200]
        ks = page.locator('#npLookBox .np-motif').evaluate_all('els => els.map(x => x.getAttribute("data-k"))')
        assert ks == ['真人工作场景', '方案页', '手写笔记·纸感', ''], '画面风格＝三颗短名单＋「跟账号默认」：%s' % ks
        assert chip_on(''), '这一套没定过流派＝「跟账号默认」那颗亮着'
        assert page.evaluate('() => npLookToken(npLookOf(npS()))') == TOKEN, '令牌还在（函数层读得出账号默认那两轴）：%s' % TOKEN
        assert page.evaluate('() => VisualMotif.all([]).length') >= 10, '内置十条完整名单还在数据层（只是 ① 不铺）'
        assert page.locator('#npLookBox .np-capd').count() == 4, '配文方式四档都摆在这一档'
        assert page.evaluate('() => npCapOf(npLookOf(npS()))') == 'say', '账号默认没配配文＝落回打底那一档（说一次）'
        assert page.locator('#npLookBox .np-desc-regen').count() == 0, '🔁 跟着它管的事挪去 ④ 的表头了，这一档不摆'
        print('PASS: ① 是旋钮不是关卡：不出封面就直接落 ③；① 摊开就四行（三颗短名单＋跟账号默认 / 配文四档 / ↺ 全清），零 AI', flush=True)

        # ── 2) 圈出三段之后：每条提示词都带上账号默认那行令牌，默认没被抄进存档，🔁 只在 ④ ──
        goto_tab('cut')
        assert '一行都还没圈' in tab_badge('cut') and '在等③' in tab_badge('desc'), tab_badge('desc')
        for k in range(3):
            poke(k)
        page.wait_for_function('() => (npS().shots.items || []).length === 3')
        assert calls() == 0, '点 ★ 立屏是本地的事，一次 AI 都不该烧：%s' % calls()
        goto_tab('desc')
        p0 = pout(0)
        assert '固定元素：' + TOKEN in p0, p0[-260:]
        assert '第 1 张（共 3 张' in p0, p0[:150]
        assert not page.evaluate('() => !!npS().shots.look.born'), '只是跟着默认走，不许把默认抄进这一套存档'
        assert page.locator('#npRegenBar .np-desc-regen').count() == 1, '有段了才摆 🔁，而且摆在这一档的表头（这一支不点它）'
        goto_tab('look')
        assert page.locator('#npLookBox').count() == 1 and page.locator('.np-shot').count() == 0, '一档一块：站在 ① 就不该同时摊出 ④ 那张表'
        print('PASS: 每条提示词自动带上「每一张都带的固定元素」（账号默认那行令牌），存档里没抄默认；🔁 挂在 ④ 表头', flush=True)

        # ── 3) 点一颗短名单＝只记这一套（那颗亮、档名跟着换）；再点同一颗 / 点「跟账号默认」＝退回；↺ 一次全清 ──
        motif_chip('方案页').click()
        page.wait_for_function('() => npS().shots.look.motif === "方案页"')
        assert page.evaluate('() => npLookOwn(npS(), "motif")') is True, '点一颗＝这一套自己定了'
        assert chip_on('方案页'), '那颗自己亮的要挑出来'
        assert '方案页' in tab_badge('look'), '① 那一档的档名跟着换：%s' % tab_badge('look')
        assert '方案页' not in prompts(), '流派不进提示词尾巴（它只走 AI 那一发）'
        motif_chip('方案页').click()                            # 再点同一颗＝退回账号默认
        page.wait_for_function('() => !npS().shots.look.motif')
        assert page.evaluate('() => npLookOf(npS()).motif') == '真人工作场景', '退回后生效流派落回打底'
        assert chip_on(''), '「跟账号默认」那颗又亮回来'
        motif_chip('手写笔记·纸感').click()
        page.wait_for_function('() => npS().shots.look.motif === "手写笔记·纸感"')
        motif_chip('').click()                                  # 点「跟账号默认」＝同一条退回
        page.wait_for_function('() => !npS().shots.look.motif')
        motif_chip('手写笔记·纸感').click()
        page.wait_for_function('() => npS().shots.look.motif === "手写笔记·纸感"')
        assert page.locator('#npLookBox .np-look-back').count() == 1, '↺ 那一颗一直在这一档'
        page.locator('#npLookBox .np-look-back').click()
        page.wait_for_function('() => !npS().shots.look.motif && npLookOf(npS()).motif === "真人工作场景"')
        assert page.evaluate('() => npLookToken(npLookOf(npS()))') == TOKEN, '↺ 之后令牌退回账号默认那两轴'
        assert '手写笔记·纸感' not in prompts(), '提示词跟着一起退'
        assert calls() == 0, '点派 / 退回都只是本地重排：%s' % calls()
        goto_tab('desc')
        p0 = pout(0)
        assert '固定元素：' + TOKEN in p0 and p0.count('手写笔记·纸感') == 0, '站在 ④ 看那一格：退回之后不带这一套那点改动'
        goto_tab('look')
        print('PASS: 点一颗短名单＝只记这一套（那颗亮、档名换）；再点同一颗 / 「跟账号默认」＝退回；↺ 全清（零 AI）', flush=True)

        # ── 4) 配文方式四档（字后压）：提示词只报「这一屏的字是后压的 ＋ 字位＝哪一格」，段原文一个字都不上屏 ──
        say = prompts()
        assert '【这一屏的字是后压的，你不许画进去】' in say, say[:300]
        assert '字位＝左下' in say, '说一次＝字压左下（打底那一档的默认格）：%s' % say[:300]
        assert '开场钩子' not in say, '字是后压的：要压的那句话一个字都不该进提示词'
        page.locator('#npLookBox .np-capd[data-k="whole"]').click()
        page.wait_for_function('() => npCapOf(npLookOf(npS())) === "whole"')
        whole = prompts()
        assert '字位＝正中' in whole, '整段上屏＝字压正中：%s' % whole[:300]
        page.locator('#npLookBox .np-capd[data-k="only"]').click()
        page.wait_for_function('() => npCapOf(npLookOf(npS())) === "only"')
        only = prompts()
        assert '字位＝正中' in only, '只一句大字＝字压正中：%s' % only[:300]
        page.locator('#npLookBox .np-capd[data-k="label"]').click()
        page.wait_for_function('() => npCapOf(npLookOf(npS())) === "label"')
        lab = prompts()
        assert '字位＝上中' in lab, '辅助标注＝字压上中：%s' % lab[:300]
        for name, v in (('说一次', say), ('整段上屏', whole), ('只一句大字', only), ('辅助标注', lab)):
            assert '【底图，这一套每张共用，必须照做】' in v, name + ' 这一档也该带底图那一块（压暗＋字位留干净底）'
            assert '【通则】' in v, name + ' 这一档也该带通则那几条'
            assert '14 字' not in v, name + ' 这一档不许再写死字数上限'
            assert '开场钩子' not in v, name + ' 这一档段原文都不上屏（字是后压的）'
        assert calls() == 0, '换配文档只是本地重拼：%s' % calls()
        page.locator('#npLookBox .np-capd[data-k="only"]').click()
        page.wait_for_function('() => npCapOf(npLookOf(npS())) === "only"')
        goto_tab('desc')
        p0 = pout(0)
        assert '字位＝正中' in p0, '④ 那一格跟着这一档：%s' % p0[-260:]
        assert page.locator('.np-cap').count() == 4 * 3, '④ 每一行都摆四档 chips（某一张要单独换就在行里拨）'
        goto_tab('look')
        print('PASS: 配文方式四档（说一次 / 整段上屏 / 只一句大字 / 辅助标注）四档都只把「字位」写进提示词——字是后压的、段原文一个字不上屏（零 AI、无写死字数）', flush=True)

        # ── 4b) 出图张数那排旋钮已随六十六改撤下（收口）；旧档的 shots.total 依旧被读：③ 报还差几屏、⑤ 挑对不上、🔮 照它挑句 ──
        assert page.locator('#npLookBox .np-total').count() == 0, '张数 chips 已撤（面板就四行）'
        goto_tab('desc')      # 🔮 那颗挂在 ④ 的表头（六十五改从 ③ 挪过来）
        base = calls()
        page.locator('.np-cut-suggest').click()
        c0 = wait_cut(1)
        page.wait_for_function('() => npS().shots.cutBusy === false')
        assert '【这一套要出的配图张数】' not in c0['us'], '没定过就别给 AI 报一个不存在的目标数'
        assert '整篇 4~8 屏为宜' in c0['sys'], c0['sys'][:200]
        page.evaluate('() => { npS().shots.total = 5; }')        # 模拟旧档里存着的目标数（旋钮撤了，读数照旧）
        goto_tab('cut')
        assert '目标5张（还差2）' in cut_text(), '③ 顶上照旧档的总数报还差几屏：%s' % cut_text()[:400]
        chk = check_line()
        assert '这一套早先定过5张配图' in chk, '⑤ 那条检查也照旧档总数报（旧档口径，不指 ① 撤掉的旋钮）：%s' % chk[:340]
        goto_tab('desc')
        page.locator('.np-cut-suggest').click()
        c1 = wait_cut(2)
        page.wait_for_function('() => npS().shots.cutBusy === false')
        assert '【这一套要出的配图张数】5 张' in c1['us'], c1['us'][:300]
        assert '客户已经定了这一套要出 5 张配图，所以整篇就挑 5 句，一屏一句' in c1['sys'], c1['sys'][:300]
        assert '整篇 4~8 屏为宜' not in c1['sys'], '旧档有目标数就不该再说 4~8 那句'
        page.evaluate('() => { delete npS().shots.total; }')
        goto_tab('cut')
        assert '目标' not in cut_text(), '清掉后 ③ 不再报目标数'
        chk = check_line()
        assert '这一套早先定过' not in chk, chk[:340]
        goto_tab('look')
        assert calls() == base + 2, '这一排（撤下）以外只有 🔮 那两发：%s' % calls()
        print('PASS: 出图张数旋钮已撤（面板四行不摆）；旧档 shots.total 照旧被读——③ 报还差、⑤ 报对不上、🔮 照它挑句（定了就不说 4~8）', flush=True)

        # ── 4c) 退市契约（六十六改按 demo 收口）：轴 chips / 张数 / 纯 CSS 小样 / 说明折叠块 / 十派画廊都不再摆；
        #        流派说明收进 chip 悬浮（title）；面板不摆图、不烧 AI ──
        assert page.locator('#npLookBox .np-look').count() == 0, '轴旋钮整批撤下'
        assert page.locator('#npLookBox .np-total').count() == 0, '张数 chips 撤下'
        assert page.locator('#npLookBox .np-lookdemo, #npLookBox .np-sketch, #npLookBox .np-swatch').count() == 0, '纯 CSS 小样撤下'
        assert page.locator('#npLookBox details').count() == 0, '「这四档各是什么」说明折叠块撤下（档说明就在按钮旁边那行小字）'
        assert page.locator('#npLookBox .np-gal, #npLookBox .np-motifcard').count() == 0, '十派画廊撤下'
        for g in ('这一排旋钮现在摆出来的样子', '现在 3 屏', '现在整份跟默认走', '·这一套', '打底＝统一小红书那一挂'):
            assert g not in look_panel(), '这句随收口撤下：%s' % g
        for name in ('说一次', '辅助标注', '整段上屏', '只一句大字'):
            assert name in look_panel(), name + ' 那一档还在这一档'
        assert '这一派怎么用' not in look_panel(), '流派说明不再铺长句（收进 chip 悬浮）'
        tip = motif_chip('真人工作场景').get_attribute('title') or ''
        assert tip == page.evaluate('() => npMotifTip(npMotifOf("真人工作场景"))'), 'chip 悬浮＝那一派的完整说明：%s' % tip[:120]
        assert '怎么把这段文案变成画面' in tip and '这样算不合格' in tip, '三句配方收进悬浮里：%s' % tip[:160]
        assert page.locator('#npLookBox img').count() == 0 and page.locator('#npLookBox canvas').count() == 0, \
            '① 面板不摆图、不生成图'
        assert calls() == base + 2, '收口之后这一档依旧零 AI：%s' % calls()
        print('PASS: ① 收口退市契约——轴 chips／张数／CSS 小样／说明折叠块／画廊都不再摆（流派说明收进 chip 悬浮），面板不摆图、不烧 AI', flush=True)

        # ── 5) 落档：这一套的 look 与圈好的段一起进档，从档案再进来读得回（零 AI） ──
        page.wait_for_timeout(700)
        got = None
        t0 = time.time()
        while time.time() - t0 < 15:
            arr = page.evaluate('async () => (await chrome.storage.local.get("np_notes")).np_notes || []')
            row = ((arr[0] or {}).get('imgDocs') or [{}])[0]
            sh = row.get('shots') or {}
            if sh.get('look', {}).get('cap') == 'only' and len(sh.get('sents') or []) == 3:
                got = sh
                break
            page.wait_for_timeout(300)
        assert got, '这一套的 look / 句子层没落进档案：%s' % got
        before = calls()
        goto_out('look-1')
        assert cur_tab() == 'desc', '这一套早先点过「不出封面」＝回来不再停在 ②，直接落该干活的 ④：%s' % cur_tab()
        goto_tab('cover')
        cvt = page.locator('#npCoverBox').inner_text()
        assert '这一版不要封面' in cvt and '点「要这一张」就回来了' in cvt, '② 关着也要说清这一版不排首图、那两句没丢：%s' % cvt[:200]
        assert '整篇一共' not in cvt, '关着不报张数：这一套就从第 1 屏那张排'
        page.locator('#npCoverBox .np-cover-on[data-v="1"]').click()
        page.wait_for_function('() => npS().shots.cv.on === true')
        assert page.evaluate('() => npImgLand(npS())') == 'cover', '重新要它、那两栏还空着＝落点又回到 ②（它是关卡）'
        page.locator('#npCoverBox .np-cover-on[data-v="0"]').click()
        page.wait_for_function('() => npS().shots.cv.on === false')
        goto_tab('desc')
        assert calls() == before, '从档案再进来不该重烧 AI：%s' % calls()
        assert page.evaluate('() => npCapOf(npLookOf(npS()))') == 'only'
        goto_tab('look')
        assert page.evaluate('() => npLookOwn(npS(), "motif")') is False, '↺ 之后这一套没自定的流派'
        assert chip_on(''), '「跟账号默认」那颗亮着（回来还是它）'
        assert '真人工作场景' in tab_badge('look'), '① 那一档的标签跟着说打底那一派：%s' % tab_badge('look')
        goto_tab('desc')
        page.wait_for_function('() => document.querySelectorAll(".np-shot").length === 3')
        assert page.evaluate('() => (npS().shots.items || []).map(x => x.text)') == SENTS, '圈出来的三段读得回（这一档不动它的分组）'
        assert calls() == before, '切到 ④ 也不重烧 AI：%s' % calls()
        print('PASS: 这一套的风格与配文档连同分组落进这一档，从档案再进来直接读回、零 AI（② 那颗「不出封面」也一起读回）', flush=True)

        # ── 6) 任务配置 → 🎨 出图风格：画面风格 ＋ 印记三选 ＋ 笔记分类 ＋ 配文版式 → 保存落库 ──
        page.evaluate('() => switchMainTab("noteTaskCfg")')
        page.wait_for_function('() => !!document.querySelector("#ntCfgTabs .nt-tab[data-sec=look]")')
        page.locator('#ntCfgTabs .nt-tab[data-sec="look"]').click()
        page.wait_for_function('() => !!document.querySelector(".ntMotifChip")')
        assert '✓ 在用' in page.locator('.ntMotifChip[data-k="真人工作场景"]').inner_text(), '没存过＝亮着打底那一派'
        assert page.locator('.ntMarkPick.on[data-mode="none"]').count() == 1, '印记没存过＝不印记'
        assert page.locator('.ntClassifyPick.on[data-v="0"]').count() == 1, '笔记分类没存过＝关着'
        assert '打底＝统一小红书那一挂' in page.locator('#diagStyleResult').inner_text(), '这一页要说清最低一层是打底'
        page.locator('.ntMotifChip[data-k="手写笔记·纸感"]').click()
        page.wait_for_function('() => (_diagState.imgLook || {}).motif === "手写笔记·纸感"')
        page.locator('.ntMarkPick[data-mode="text"]').click()
        page.wait_for_function('() => (_diagState.imgLook || {}).mark === "text"')
        page.locator('.ntMarkText').fill('张师傅 · 防水 10 年')
        page.wait_for_function('() => (_diagState.imgLook || {}).markText === "张师傅 · 防水 10 年"')
        page.locator('.ntClassifyPick[data-v="1"]').click()
        page.wait_for_function('() => (_diagState.imgLook || {}).classify === true')
        page.locator('.ntLayoutTile[data-k="only"]').click()
        page.wait_for_function('() => (_diagState.imgLook || {}).layout === "only" && (_diagState.imgLook || {}).cap === "only"')
        assert '版式定了配文引擎（只一句大字）' in page.locator('#diagStyleResult').inner_text(), '版式定了配文引擎：只留一句那一版＝配文只一句大字'
        page.locator('.ntLookSave').click()
        page.wait_for_function('''async () => {
            const d = await chrome.storage.local.get('config');
            const c = d.config || {};
            return !!(c.imgLook && c.imgLook.motif === '手写笔记·纸感' && c.imgLook.mark === 'text'
                && c.imgLook.markText === '张师傅 · 防水 10 年' && c.imgLook.classify === true
                && c.imgLook.layout === 'only' && c.imgLook.cap === 'only');
        }''')
        assert '已保存' in page.locator('#ntLookMsg').inner_text()
        # 切走再回来：这一页按库里的值回显（不是按刚才点过的内存态）
        page.evaluate('() => switchMainTab("noteArchive")')
        page.evaluate('() => switchMainTab("noteTaskCfg")')
        page.wait_for_function('() => !!document.querySelector("#ntCfgTabs .nt-tab[data-sec=look]")')
        page.wait_for_function('() => !!document.querySelector(".ntMotifChip")')
        assert '✓ 在用' in page.locator('.ntMotifChip[data-k="手写笔记·纸感"]').inner_text(), '保存过的画面风格切走再回来要还在'
        assert page.locator('.ntMarkPick.on[data-mode="text"]').count() == 1, '印记三选也要回显'
        assert page.locator('.ntMarkText').input_value() == '张师傅 · 防水 10 年'
        assert page.locator('.ntClassifyPick.on[data-v="1"]').count() == 1, '笔记分类开关也要回显'
        assert '✓' in page.locator('.ntLayoutTile[data-k="only"]').inner_text(), '配文版式也要回显'
        assert '版式定了配文引擎（只一句大字）' in page.locator('#diagStyleResult').inner_text()
        print('PASS: 发笔记 · 任务配置 → 🎨 出图风格：画面风格 ＋ 印记三选 ＋ 笔记分类 ＋ 配文版式 → 保存落进 config.imgLook，切走再回来还在', flush=True)

        assert calls() == before, '① 这一整条路（含任务配置保存）一次 AI 都没烧：%s' % calls()
        assert not ERRORS, '有 pageerror：%s' % ERRORS[:2]
        print('PASS: 无 pageerror', flush=True)
        page.screenshot(path=str(OUT / 'xhs-note-look.png'))
        print('SHOT: %s' % (OUT / 'xhs-note-look.png'), flush=True)
    finally:
        ctx.close()

print('\n全绿：造图片 ① 这一档（四行收口：短名单三颗＋跟账号默认 / 配文方式四档 / ↺ 全清；轴与张数遗留读数照旧；除 🔮 那两发外零 AI）', flush=True)
