# -*- coding: utf-8 -*-
"""出图页 ①「🎨 风格」自检（按 2026-10-25 现界面重写）

现口径：① 就三行——📷 画面形式（八颗＋跟账号默认）／🎨 画面风格（三颗短名单＋条件补位＋跟账号默认）／↺ 全回账号默认；
引流笔记（dir='d'）顶上多一条紫色提示「画面不限风格」。旧的十派画廊、轴 chips、出图张数、纯 CSS 小样、
「这四档各是什么」折叠块、✍️ 配文方式四档，全部不在了。本脚本验这些：

  1) 加行入口只剩 ④ 分镜 空态那颗「＋ 起一套图（跟账号默认）」；自加派当这一行的身份走 npMotifPick 同一条处理器；
  2) ① 三行都在：画面形式 8+1 颗、画面风格 3＋补位＋跟账号默认、全回账号默认；这一套自己没拨的轴亮「跟账号默认」；
     补位那颗带它自己那派的三句配方；落回短名单即消失；同一颗再点一下＝这一轴退回跟着走；全回＝覆盖整份清掉；
  3) 引流笔记多一行紫色提示；别的方向没有；
  4) 退市契约：旧画廊／轴 chips／张数／小样／说明折叠块／配文方式都不再摆；NP_LOOK_AXES 现役三轴；
     旧 8 套版式值落档即丢、15 种配文版式仍由 NP_CAP_LAYOUTS 接任；令牌只出画面形式＋主题（流派与印记都不进）；
  5) 全程零 AI。

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
BORN_N = 8   # NP_LOOK_AXES 里 born 那轴的八个值

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

        def chip(sel, key):
            return page.locator('#npLookBox %s[data-%s="%s"]' % (sel, 'k' if sel == '.np-motif' else 'v', key))

        def on(sel, key):
            return 'var(--c-brand-soft)' in (chip(sel, key).get_attribute('style') or '')

        def tab_badge(t):
            return page.locator('#npImgTabs .np-imgtab[data-t="%s"]' % t).inner_text().replace(' ', '')

        def look_panel():
            return page.locator('#npLookBox').inner_text()

        def chip_keys():
            return page.locator('#npLookBox .np-motif').evaluate_all('els => els.map(x => x.getAttribute("data-k"))')

        def redraw():
            page.evaluate('() => { const b = document.querySelector("#npLookBox"); if (b) b.innerHTML = npLookPanelHtml(npS()); }')
            page.wait_for_timeout(160)

        def toast_box():
            return page.locator('#popToastBox')

        def clear_toasts():
            page.evaluate('() => { const b = document.getElementById("popToastBox"); if (b) b.innerHTML = ""; }')

        # ── 1) 加行入口只剩 ④ 空态那颗「＋ 起一套图（跟账号默认）」；自家派身份走 npMotifPick 同一条处理器 ──
        page.evaluate('async () => { const l = await npNotesAll(); switchMainTab("noteOut", l.find(x => x && x.id === "%s")); }' % NOTE)
        page.wait_for_function('() => _npMode === "out" && !!document.querySelector("#npImgTabs .np-imgtab")')
        n_all = page.evaluate('() => npMotifAll().length')
        assert n_all == 11, '名单本身＝内置十条＋账号自加一条（数据层，不铺在界面上）：%s' % n_all
        assert calls() == 0, '进这一页不烧 AI：%s' % calls()
        goto_tab('desc')
        page.wait_for_function('() => !!document.querySelector("#npShotTable .np-img-add")')
        assert page.locator('#npShotTable .np-img-add').count() == 1, '加行入口只剩空态这一颗'
        assert '＋ 起一套图（跟账号默认）' in page.locator('#npShotTable .np-img-add').inner_text()
        page.locator('#npShotTable .np-img-add').click()
        page.wait_for_function('() => (npS().imgDocs || []).length === 1 && !!npS().imgOpen')
        assert page.evaluate('() => npS().uiTab') == 'cut', '起完一套直接落 ③ 断句'
        assert not page.evaluate('() => npS().shots.look.motif'), '空态那颗加的行＝跟账号默认（没自定流派）'
        page.evaluate('() => npMotifPick(npActiveC(), "自家三格")')   # 自加派不在短名单：直接派发这一条处理器，界面补位那颗 chip 就是它
        page.wait_for_function('() => npS().shots.look.motif === "自家三格"')
        assert page.evaluate('() => npS().imgDocs[0].shots.look.motif') == '自家三格', '挑的那条＝这一行自己的身份'
        assert calls() == 0, '加行、记身份都不烧 AI：%s' % calls()
        print('PASS 1: 加行入口＝④ 空态那颗「＋ 起一套图（跟账号默认）」；自家派身份走同一条处理器（零 AI）', flush=True)

        # ── 2) ① 三行结构：画面形式 8+1 颗 / 画面风格 3＋补位＋跟账号默认 / 全回账号默认 ──
        goto_tab('look')
        panel = look_panel()
        for g in ('📷 画面形式', '🎨 画面风格', '↺ 全回账号默认'):
            assert g in panel, '三行之一缺了：%s' % g
        assert '配文方式' not in panel, '✍️ 配文方式那一排已经撤了：%s' % panel[:260]
        assert '画面不限风格' not in panel, '不是引流笔记＝没有那行紫色提示'
        assert page.locator('#npLookBox .np-born').count() == BORN_N + 1, \
            '画面形式＝八颗＋跟账号默认：%s' % page.locator('#npLookBox .np-born').count()
        assert chip_keys() == ['真人工作场景', '方案页', '手写笔记·纸感', '自家三格', ''], \
            '三颗短名单＋自加那颗补位＋跟账号默认：%s' % chip_keys()
        assert on('.np-motif', '自家三格'), '这一套自己定的那颗亮着'
        assert '自家三格' in tab_badge('look'), '① 档名＝这一行的流派：%s' % tab_badge('look')
        # 这一套没拨过画面形式 → 亮的是「跟账号默认」，账号默认里那颗（扁平矢量插画）不算自己定的
        assert on('.np-born', ''), '画面形式这一套没拨＝「跟账号默认」亮着'
        assert chip('.np-born', '扁平矢量插画').count() == 1 and not on('.np-born', '扁平矢量插画'), \
            '账号默认里的值不当成这一套自己定的'
        tip_def = chip('.np-motif', '真人工作场景').get_attribute('title') or ''
        assert '怎么把这段文案变成画面' in tip_def and '这样算不合格' in tip_def, '内置那颗的悬浮＝三句配方：%s' % tip_def[:120]
        tipc = chip('.np-motif', '自家三格').get_attribute('title') or ''
        assert CUSTOM['cast'] in tipc and CUSTOM['forbid'] in tipc, '自加那颗补位的悬浮＝它自己那派的三句配方：%s' % tipc[:120]
        assert '数据·截图实证' not in panel, '完整名单不铺在 ①（只补了自加那一颗）：%s' % panel[:260]
        assert page.locator('#npLookBox .np-capd').count() == 0, '配文方式四档不在这了'
        # 落回短名单 → 补位那颗消失、短名单那颗亮
        chip('.np-motif', '方案页').click()
        page.wait_for_function('() => npS().shots.look.motif === "方案页"')
        assert chip_keys() == ['真人工作场景', '方案页', '手写笔记·纸感', ''], '落回短名单后那颗补位消失：%s' % chip_keys()
        assert on('.np-motif', '方案页'), '短名单那颗亮着'
        # 画面形式这颗：点一下记在这一套，再点一下＝这一轴退回跟着账号默认走
        chip('.np-born', '动漫插画').click()
        page.wait_for_function('() => npS().shots.look.born === "动漫插画"')
        assert on('.np-born', '动漫插画') and not on('.np-born', ''), '拨了画面形式＝那颗亮、跟账号默认不亮'
        assert not on('.np-born', '扁平矢量插画'), '账号默认那颗仍不算自己定的'
        chip('.np-born', '动漫插画').click()
        page.wait_for_function('() => !npS().shots.look.born')
        assert on('.np-born', ''), '再点一下＝这一轴退回跟账号默认'
        # 画面风格退回跟账号默认
        chip('.np-motif', '').click()
        page.wait_for_function('() => !npS().shots.look.motif')
        assert on('.np-motif', ''), '「跟账号默认」亮着'
        assert page.evaluate('() => npLookOf(npS()).motif') == '真人工作场景', '生效流派落回打底'
        assert '真人工作场景' in tab_badge('look'), tab_badge('look')
        # ↺ 全回账号默认：这一套的覆盖整份清掉
        chip('.np-born', '手绘线稿').click()
        page.wait_for_function('() => npS().shots.look.born === "手绘线稿"')
        clear_toasts()
        page.locator('#npLookBox .np-look-back').click()
        page.wait_for_function('() => Object.keys(npS().shots.look || {}).length === 0')
        assert toast_box().inner_text().find('这一套回账号默认了') >= 0, toast_box().inner_text()
        assert on('.np-born', '') and on('.np-motif', ''), '全回之后两排都亮「跟账号默认」'
        assert page.evaluate('() => npLookOf(npS()).born') == '扁平矢量插画', '生效画面形式落回账号默认'
        assert calls() == 0, '点派 / 退回 / 全回全是本地，零 AI：%s' % calls()
        print('PASS 2: ① 三行——画面形式 8+1 / 画面风格 3＋条件补位＋跟账号默认 / 全回账号默认；再点一下退回、全回＝清整份（零 AI）', flush=True)

        # ── 3) 引流笔记（dir='d'）多一行紫色提示：画面不限风格；别的方向没有 ──
        page.evaluate('() => { npS().dir = "d"; }')
        redraw()
        assert '画面不限风格' in look_panel() and '图跟着素材和热点走' in look_panel(), look_panel()[:220]
        page.evaluate('() => { npS().dir = ""; }')
        redraw()
        assert '画面不限风格' not in look_panel(), '别的方向没有这一行'
        assert calls() == 0, '这一行只是本地重画：%s' % calls()
        print('PASS 3: 引流笔记多一行「画面不限风格」；别的方向没有（本地重画，零 AI）', flush=True)

        # ── 4) 退市契约：旧画廊 / 轴 chips / 张数 / 小样 / 说明折叠块 / 配文方式都不再摆；版式旧值落档即丢 ──
        assert page.locator('#npLookBox .np-look').count() == 0, '① 不再画轴 chips'
        assert page.locator('#npLookBox .np-total').count() == 0, '张数 chips 已撤'
        assert page.locator('#npLookBox .np-gal, #npLookBox .np-gal-item').count() == 0, '流派画廊随收口撤下'
        assert page.locator('#npLookBox .np-lookdemo, #npLookBox .np-sketch').count() == 0, '纯 CSS 小样撤下'
        assert page.locator('#npLookBox details').count() == 0, '说明折叠块撤下'
        assert page.locator('#npLookBox img').count() == 0 and page.locator('#npLookBox canvas').count() == 0, \
            '① 面板不摆图、不生成图'
        assert page.evaluate('() => NP_LOOK_AXES.map(a => a.k).join(",")') == 'born,theme,mark', \
            '轴表现役三轴＝画面形式 / 主题 / 印记（版式轴已退市）'
        assert page.evaluate('''() => {
            const old = npLookShape({layout: '一行大字居中'});        // 六十四改那 8 套里的一个值
            const now = npLookShape({layout: 'big'});                 // 二十二改 15 种里的一个键
            return old.layout === undefined && now.layout === 'big'; }'''), \
            '旧 8 套版式的值落档即丢；新 15 种（big 等键）才留得住（真源 NP_CAP_LAYOUTS）'
        assert page.evaluate('''() => NP_CAP_LAYOUTS.length === 15
            && NP_CAP_LAYOUTS.every(x => x.k && x.t && x.cap && x.d && npLayoutDef(x.k).k === x.k)'''), \
            '配文版式 15 种每项带 k/t/cap/d，npLayoutDef 按 key 认得回'
        tok = page.evaluate('() => npLookToken(npLookOf(npS()))')
        assert tok == '扁平矢量插画；浅底＋单色点缀', \
            '令牌只出画面形式＋主题（流派与印记都不进）：%s' % tok
        assert calls() == 0, '退市契约检查一次 AI 都没烧：%s' % calls()
        print('PASS 4: 退市契约——画廊／轴 chips／张数／小样／说明折叠块／配文方式都不在；旧 8 套版式落档即丢、15 种版式仍由 NP_CAP_LAYOUTS 接任；令牌只出画面形式＋主题', flush=True)

        assert not ERRORS, '有 pageerror：%s' % ERRORS[:2]
        print('PASS 5: 无 pageerror；全程零 AI（%s 次）' % calls(), flush=True)
        page.screenshot(path=str(OUT / 'xhs-note-look-panel.png'))
        print('SHOT: %s' % (OUT / 'xhs-note-look-panel.png'), flush=True)
    finally:
        ctx.close()

print('\n全绿：① 三行（画面形式 8+1 / 画面风格 3＋补位 / 全回账号默认）＋ 引流提示 ＋ 退市契约 · 全程零 AI', flush=True)
