# -*- coding: utf-8 -*-
"""拆墙 + 挂进流程（第 3、4 批）：出片那一屏跟「挑知识／改稿」在同一个页面、同一条工作流里 —— 自检。

老板投诉：从向导的「改稿」跳到分幕那一屏，顶栏换了、条子没了、也回不去上一步，像换了个软件。
第 2 批改的是「外壳由外层统一画」；第 3 批把墙拆了——里头那一页不再隔一层网页（iframe 已撤），
零件由 video.js 现搭到 #filmPane 上，跟向导那几屏同一个页面、同一套样式（lib/video/video.css 全挂在 #filmPane 底下）；
第 4 批把这一站挂进流程：站名全场统一「🎬 分幕」，向导顶上那条也认得它——
正文有了这一站就放开（跟底那颗「下一步 →」同一条路），出过片「发布」才放开（点了回档案那一行）。

本脚本按这个口径验收（直开档案里种好的一篇，走 npGoFilm 那条真通路进站，AiClient 全程走桩）：
  1) 外壳三件都在、盖板不铺；#filmPane 带 data-inline 且类名是 inline，
     它自己那三件（header / .fsteps / .np-pinbar）计算样式都是 none（节点留着当状态容器）
  2) 顶栏那句标题跟向导一致（✍️ 写稿 · 卖点到发稿），带这一篇 / 这一片的形式，四颗工具钮齐
  3) 底栏＝「← 上一步」＋「🎬 出片（配音 + 画面）」：进站一路自动跑（调稿 → 提重点 → 本机兜底切幕），
     跑完主钮亮、状态跟上来；里面那颗 #go 还在（只是看不见），外层点它是走 shell 那条缝
  4) 圆点条＝挑知识 → 改稿 → 🎬 分幕 → 发布；当前站「🎬 分幕」，「发布」灰着点不动，
     小抄里 outAt 一有值才放开（放开＝浅底深字那颗，不是灰的）；圆点尺寸／圆角跟向导那条量出来一致
  5) 窄屏那两签（老板选的 B）：把这一屏挤窄到 860 以下 → .narrow 上身、#filmTabs 露出、
     一次只看一栏，点「🎬 分幕」换成看幕、点「📝 口播稿」换回看稿；宽回去两栏并排、这条自己收起
  6) ⚙ 音色与风格（现在是同一页的弹窗）、↗ 在新标签页打开都还能用：
     新页 URL 带 flow，那条圆点里四站全是 span（点不动）＋「单开一页没有工作流可回」，且新页自己画顶栏（不带 inline）
  7) 底栏「← 上一步」回向导改稿站、正文一个字没丢；从档案再点进来续上那份稿与幕、不补打 AI
  8) 底栏那颗主钮是真缝：点「🎬 出片」＝台子开跑、底栏换成「⏹ 停」＋进度，点「⏹ 停」＝回到主钮
     （只验走缝——跑一下就停，不真出一整支片）
  9) 向导那条走真通路：条上四站同名同序，「🎬 分幕」放开（点了＝npKFinishFilm 那条路，
     就地进这一屏、续上那份幕，不补打 AI）；条上点「改稿」再回来
 10) 这篇出过片（往 xhsFilmDocs 种一个 outAt）之后，向导条上「发布」才放开——点了落回笔记档案那一行

跑法：python3 -X utf8 scripts/dev/check_film_shell.py
"""
import os
import pathlib
import shutil
import sys
import time

from playwright.sync_api import expect, sync_playwright

from _guide_gate import goto_big

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / 'extension'
OUT = pathlib.Path(os.environ.get('TEMP', '/tmp')) / 'xhs_film_shell'
OUT.mkdir(parents=True, exist_ok=True)

NOTE_ID = 'shell_k1'
TITLE = '外壳点检·知识篇'
BODY = '开场先戳一句。\n\n干货在这里。\n\n结尾引导，私信我。'
VOICE = '口播稿这一版：开场先戳一句。\n第二句讲干货。\n第三句收口，私信我。'

FLOW = [{'t': '挑知识', 'to': 'pick'}, {'t': '改稿', 'to': 'rewrite'}]


def boot(p):
    """起浏览器 + 装真扩展（playwright 默认那个 --disable-extensions 会跟 --load-extension 撞，先摘掉）。"""
    for i in range(5):
        prof = OUT / ('profile%d' % i)
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
    sw = ctx.service_workers[0]
    sw.evaluate('''async (payload) => {
        await Storage.initializeDefaults(DEFAULT_PROMPTS);
        await ensureTenantInit();
        const config = await Storage.getConfig();
        config.product.name = '外壳点检产品';
        config.product.sellPoints = [{title: '省时间', content: '简化重复步骤'}];
        config.ai.apiKey = 'test-local-only';
        await Storage.setConfig(config);
        self.testVoiceCalls = 0; self.testFilmCalls = 0;
        AiClient.chatCompletion = async (cfg, system, user) => {
            const sys = String(system || '');
            const call = async (t) => { await new Promise(r => setTimeout(r, 200)); return {content: t}; };
            if (sys.includes('通读这篇口播稿，标出')) { self.testFilmCalls++; return call('{}'); }   // 提重点回不出 → 本机规则兜底切幕
            if (sys.includes('把下面这篇已经定稿的图文笔记') || sys.includes('卡片轮播口播')) {
                self.testVoiceCalls++; return call(payload.voice);                                    // 进站自动按正文调口播稿
            }
            return call('{}');
        };
        await chrome.storage.local.set({ np_notes: [{
            id: payload.id, title: payload.title, dir: 'k', status: '代发',
            kOut: 'film', path: 'video', form: '视频', style: '口播讲解', filmKind: 'PPT字体动效',
            voice: payload.body, draft: payload.body,
            filmDocs: [{id: 'srow1', kind: 'PPT字体动效', key: payload.id, updatedAt: 0}],
            updatedAt: Date.now(), createdAt: Date.now(),
        }] });
    }''', {'voice': VOICE, 'body': BODY, 'id': NOTE_ID, 'title': TITLE})
    eid = sw.url.split('/')[2]

    errs = []
    page = ctx.new_page()
    page.set_default_timeout(20000)
    page.on('pageerror', lambda e: errs.append(str(e)))
    goto_big(page, eid)
    page.wait_for_function('() => typeof _npWiz !== "undefined"')
    if page.locator('#fsClose').is_visible():
        page.locator('#fsClose').click()

    # ── 进站：走档案那篇的通路 npGoFilm（带着工作流前几站） ────────────────────────────────
    pages_before = len(ctx.pages)
    page.evaluate('''(a) => npGoFilm({
        noteId: a.id, title: a.title, kind: 'PPT字体动效', script: '', body: a.body,
        style: '口播讲解', flow: a.flow, rows: [{id: 'srow1', kind: 'PPT字体动效', key: a.id, updatedAt: 0}],
        pid: 'xhs'
    })''', {'id': NOTE_ID, 'title': TITLE, 'body': BODY, 'flow': FLOW})

    # 1) 外壳三件 + 盖板收；墙拆了——零件就搭在本页的 #filmPane 上，它自己那三件藏掉（节点留着当状态容器）
    page.wait_for_function('''() => {
        const h = document.getElementById('filmHead'), s = document.getElementById('filmSteps'),
              f = document.getElementById('filmFoot'), g = document.getElementById('filmGate'),
              pane = document.getElementById('filmPane');
        return h && s && f && g && pane && pane.querySelector('#secScript')
            && getComputedStyle(h).display === 'flex' && getComputedStyle(s).display !== 'none'
            && getComputedStyle(f).display === 'flex' && g.style.display === 'none';
    }''', timeout=40000)
    assert len(ctx.pages) == pages_before, '出片那一屏该就地打开，不另开窗口'
    assert page.locator('#filmFrame').count() == 0, '那层网页（iframe）已经拆掉了，本页不该再有 #filmFrame'
    pane = page.evaluate('''() => {
        const el = document.getElementById('filmPane');
        const d = (sel) => { const e = el.querySelector(sel); return e ? getComputedStyle(e).display : 'missing'; };
        return { attr: el.getAttribute('data-inline'), cls: el.className, width: el.clientWidth,
                 head: d(':scope > header'), steps: d(':scope > .fsteps'), foot: d(':scope > .np-pinbar'),
                 htmlCls: document.documentElement.className };
    }''')
    assert pane['attr'] == '1' and 'inline' in pane['cls'], '这块板子该是「落在发笔记那页里」的：%s' % pane
    assert pane['head'] == 'none' and pane['steps'] == 'none' and pane['foot'] == 'none', \
        ('顶栏 / 条子 / 底栏都该由外层画，里头那三件只当状态存身：%s' % pane)
    print('PASS: 外壳三件都在、盖板不铺、#filmPane 就地搭好（没有 iframe）；它自己的头顶尾已藏（%s）' % pane, flush=True)

    # 2) 顶栏那句标题跟向导一致，工具钮只两颗（「← 返回档案」「↗ 新标签页」已撤，回退靠底栏「← 上一步」）
    head = page.locator('#filmHead').inner_text().replace('\n', ' ')
    assert '✍️ 写稿 · 卖点到发稿' in head, '顶栏该用跟写稿那几页同一句标题：%s' % head
    assert TITLE in head and 'PPT字体动效' in head and '大字动效' in head, '顶栏该报这一篇与这一片的形式：%s' % head
    for cls, lab in (('np-kind-change', '换一种'), ('np-film-cfg', '音色与风格')):
        b = page.locator('#filmHead .' + cls)
        assert b.count() == 1, '顶栏缺那颗「%s」' % lab
        assert lab in b.inner_text(), '顶栏「%s」那颗字样不对：%s' % (lab, b.inner_text())
    for gone in ('np-film-archive', 'np-film-popout'):
        assert page.locator('#filmHead .' + gone).count() == 0, '顶栏这颗该撤还没撤：%s' % gone
    print('PASS: 顶栏＝同一句标题 + 这一篇/这一片 + 两颗工具钮（%s）' % head.strip(), flush=True)

    # 3) 底栏：进站一路自动跑（调稿 → 提重点 → 本机兜底切幕），跑完主钮亮、状态跟上来
    page.wait_for_function('''() => { const s = _filmState; return !!(s && s.scenes > 0 && !s.genBusy && !s.busy); }''', timeout=40000)
    assert sw.evaluate('self.testVoiceCalls') == 1, '进站自动调一版口播稿＝正好一发（走桩）：%s' % sw.evaluate('self.testVoiceCalls')
    assert sw.evaluate('self.testFilmCalls') == 1, '同一路里那一发提重点（走桩）：%s' % sw.evaluate('self.testFilmCalls')
    foot = page.locator('#filmFoot').inner_text().replace('\n', ' ')
    assert '上一步' in foot, '底栏该有「← 上一步」（老板投诉的回不去）：%s' % foot
    assert '出片（配音 + 画面）' in foot, '底栏主钮该是「🎬 出片（配音 + 画面）」：%s' % foot
    assert page.locator('#filmFoot .np-film-start').is_enabled(), '分幕好了，主钮该能点'
    assert '分幕' in foot and '幕' in foot, '底栏状态该报几幕了：%s' % foot
    assert page.locator('#filmPane #go').count() == 1, '台子那颗主钮还在（只是看不见），外层点它走 shell 那条缝'
    print('PASS: 进站一路自动到分幕，底栏＝「← 上一步」+ 主钮亮 + 状态（%s）' % foot.strip(), flush=True)

    # 4) 圆点条：四站 + 当前站 + 发布灰；跟向导那条同一个画法
    def bar_info():
        return page.evaluate('''() => {
            const el = document.getElementById('filmSteps');
            const st = [...el.querySelectorAll(':scope > div > div')];
            const b0 = st[0].querySelector('button,span'), b3 = st[3].querySelector('button,span');
            const cs = (e) => ({ w: getComputedStyle(e).width, r: getComputedStyle(e).borderRadius,
                                 f: getComputedStyle(e).fontWeight, ink: getComputedStyle(e).color });
            const lab = (x) => { const e = x.querySelector('span[style*="text-align:center"]'); return e ? e.innerText.split('\\n')[0].trim() : ''; };
            return { labels: st.map(lab).slice(0, 4),
                     curText: (el.querySelector('[style*="0 0 0 3px"]') || {}).title || '',
                     to: [...el.querySelectorAll('[data-filmto]')].map(b => b.getAttribute('data-filmto')),
                     pub: !!el.querySelector('[data-filmpub]'),
                     pubTip: b3 ? (b3.getAttribute('title') || '') : '',
                     badge: cs(b0), tag0: b0.tagName, tag3: b3.tagName, n: st.length };
        }''')
    bi = bar_info()
    assert bi['n'] == 4, '条上该四站（挑知识 / 改稿 / 🎬 分幕 / 发布）：%s' % bi['labels']
    assert bi['labels'][:2] == ['挑知识', '改稿'], '前几站由写稿那头递过来：%s' % bi['labels']
    assert bi['labels'][2] == '🎬 分幕' and bi['labels'][3] == '发布', bi['labels']
    assert bi['to'] == ['pick', 'rewrite'], '前两站点得回去（data-filmto）：%s' % bi['to']
    assert '正在这一站' in bi['curText'], '当前站该是「🎬 分幕」（圆点带外圈）：%s' % bi['curText']
    assert bi['pub'] is False and '先出片才到发布' in bi['pubTip'], '没出片「发布」该灰着点不动：%s' % bi
    assert bi['tag0'] == 'BUTTON' and bi['tag3'] == 'SPAN', '能点的站是按钮、不能点的是span：%s' % bi
    # outAt 一有值（外层那份小抄）「发布」才放开——验的是画法，不真出一支片
    page.evaluate('''() => { _filmState = Object.assign({}, _filmState, { outAt: Date.now() }); npFilmShellRefresh(); }''')
    opened = page.evaluate('''() => {
        const el = document.getElementById('filmSteps');
        const b = el.querySelector('[data-filmpub]');
        const cs = b ? getComputedStyle(b) : null;
        return { tag: b ? b.tagName : 'none', tip: b ? (b.getAttribute('title') || '') : '',
                 bg: cs ? cs.backgroundColor : '', ink: cs ? cs.color : '' };
    }''')
    assert opened['tag'] == 'BUTTON' and '去发布台' in opened['tip'], '出过片之后「发布」该放开（回档案那一行下一步）：%s' % opened
    assert opened['bg'] != 'rgb(238, 240, 244)', '放开的站该换成浅底深字（不是灰着那颗）：%s' % opened
    head_txt = page.locator('#filmHead').inner_text()
    assert '已出过片' in head_txt, '顶栏该跟着报「🎬 已出过片」：%s' % head_txt.replace('\n', ' ')

    # 同一画法：跟向导 #npSteps 上那颗圆量出来一样
    page.evaluate('() => { _filmState = null; npFilmShellRefresh(); }')
    same = page.evaluate('''() => {
        const one = document.querySelector('#filmSteps button, #filmSteps span');
        const a = getComputedStyle(one);
        return { film: [a.width, a.height, a.borderRadius, a.fontWeight], want: '22px' };
    }''')
    assert same['film'][0] == same['want'] and same['film'][2] == '50%', \
        '片台那颗圆该跟向导那条同尺寸同圆角：%s' % same
    print('PASS: 圆点条＝%s（当前停在「🎬 分幕」，发布先灰、出过片才放开成浅底深字），圆点尺寸/圆角与向导那条一致'
          % ' → '.join(bi['labels']), flush=True)

    # 5) ⚙ 与 ↗ 还能用（⚙ 现在就是本页里那个弹窗，不再隔一层）
    page.locator('#filmHead .np-film-cfg').click()
    expect(page.locator('#filmPane #cfgMask')).to_be_visible()
    assert page.locator('#filmPane #voices').is_visible(), '⚙ 弹窗里那张音色表该在'
    page.locator('#filmPane #cfgOk').click()
    expect(page.locator('#filmPane #cfgMask')).to_be_hidden()
    print('PASS: 顶栏「⚙ 音色与风格」打开／关掉本页那个弹窗（拆墙后不用再穿一层网页）', flush=True)

    gone = page.evaluate('''() => { const F = window.Film;
        return { btn: !!document.querySelector('#filmHead .np-film-popout'),
                 arch: !!document.querySelector('#filmHead .np-film-archive'),
                 hasPopOut: !!(F && F.shell && typeof F.shell.popOut === 'function') }; }''')
    assert not gone['btn'] and not gone['arch'], '顶栏这两颗该撤掉还没撤：%s' % gone
    assert gone['hasPopOut'], '台子里那条 popOut 的缝该留着（只是顶栏不再挂这颗钮）：%s' % gone
    print('PASS: 顶栏「← 返回档案」「↗ 新标签页」已撤（回退只剩底栏「← 上一步」），台子里单开一页那条缝还在', flush=True)

    # 6) 窄屏那两签（老板选的 B）：挤窄 → .narrow + #filmTabs 露出、一次一栏；宽回去两栏并排
    wide = page.evaluate('''() => {
        const pane = document.getElementById('filmPane');
        const d = (sel) => { const e = pane.querySelector(sel); return e ? getComputedStyle(e).display : 'missing'; };
        return { narrow: pane.classList.contains('narrow'), w: pane.clientWidth,
                 tabs: d(':scope > .ftabs'), colS: d(':scope > main > .col.script'), colM: d(':scope > main > .col.scenes') };
    }''')
    assert not wide['narrow'] and wide['tabs'] == 'none', '宽屏（%dpx）该两栏并排、这条收起：%s' % (wide['w'], wide)
    assert wide['colS'] != 'none' and wide['colM'] != 'none', '宽屏该稿与幕两栏都在：%s' % wide
    page.set_viewport_size({'width': 720, 'height': 900})
    page.wait_for_function('() => document.getElementById("filmPane").classList.contains("narrow")', timeout=15000)
    narrow = page.evaluate('''() => {
        const pane = document.getElementById('filmPane');
        const vis = (sel) => { const e = pane.querySelector(sel); return e ? getComputedStyle(e).display : 'missing'; };
        return { w: pane.clientWidth, tabs: vis(':scope > .ftabs'),
                 colS: vis(':scope > main > .col.script'), colM: vis(':scope > main > .col.scenes'),
                 on: [...pane.querySelectorAll('#filmTabs button')].map(b => b.className) };
    }''')
    assert narrow['tabs'] == 'flex', '窄了（%dpx）顶上该露出那两签：%s' % (narrow['w'], narrow)
    assert narrow['colS'] != 'none' and narrow['colM'] == 'none', '窄屏默认只看稿那一栏：%s' % narrow
    assert 'on' in narrow['on'][0], '「📝 口播稿」该是选中态：%s' % narrow['on']
    page.locator('#filmPane #filmTabs button[data-ftab="scenes"]').click()
    page.wait_for_function('''() => {
        const pane = document.getElementById('filmPane');
        const c = [...pane.querySelectorAll(':scope > main > .col')];
        return pane.classList.contains('tab-scenes')
            && getComputedStyle(c.find(x => x.classList.contains("scenes"))).display !== 'none'
            && getComputedStyle(c.find(x => x.classList.contains("script"))).display === 'none';
    }''')
    mids = page.evaluate('''() => [...document.querySelectorAll('#filmTabs button')]
        .map(b => ({ k: b.getAttribute('data-ftab'), on: b.classList.contains('on') }))''')
    assert mids == [{'k': 'script', 'on': False}, {'k': 'scenes', 'on': True}], '选中态该跟着换：%s' % mids
    page.locator('#filmPane #filmTabs button[data-ftab="script"]').click()
    page.wait_for_function('() => !document.getElementById("filmPane").classList.contains("tab-scenes")')
    page.set_viewport_size({'width': 1500, 'height': 900})
    page.wait_for_function('''() => {
        const pane = document.getElementById('filmPane');
        if (pane.classList.contains("narrow")) return false;
        const c = [...pane.querySelectorAll(':scope > main > .col')];
        return c.every(x => getComputedStyle(x).display !== 'none')
            && getComputedStyle(pane.querySelector(':scope > .ftabs')).display === 'none';
    }''')
    print('PASS: 窄屏那两签能用（挤窄→#filmTabs 露出、一次一栏，点「🎬 分幕」看幕、点「📝 口播稿」看稿；宽回去两栏并排、这条自己收起）', flush=True)

    # 7) 底栏「← 上一步」回向导改稿站，正文一个字没丢；从档案再点进来续上那份稿与幕
    page.locator('#filmFoot .np-film-prev').click()
    page.wait_for_function('() => !!document.getElementById("npWizBody") && document.getElementById("npWizBody").offsetParent !== null && _npWiz.step === 4', timeout=25000)
    assert page.evaluate('() => document.getElementById("filmContent").offsetParent === null'), '回向导后出片那一屏该收起'
    wiz_body = page.evaluate('() => String(_npWiz.draft && _npWiz.draft.content || "")')
    assert wiz_body == BODY, '上一步不该改正文：%r' % wiz_body
    steps_bar = page.locator('#npSteps').inner_text().replace('\n', ' ')
    for lab in ('挑知识', '改稿', '🎬 分幕', '发布'):
        assert lab in steps_bar, '向导顶上那条也是这四站，缺「%s」：%s' % (lab, steps_bar)
    print('PASS: 底栏「← 上一步」＝回向导「改稿」站（正文没动），向导顶上那条同样四站：%s' % steps_bar.strip(), flush=True)

    page.evaluate('() => switchMainTab("noteArchive")')
    page.wait_for_function('(id) => !!document.querySelector(".npar-next[data-id=\\"" + id + "\\"]")', arg=NOTE_ID)
    page.locator('.npar-next[data-id="%s"]' % NOTE_ID).click()
    page.wait_for_function('''(a) => {
        const s = _filmState; return !!(s && s.noteId === a[0] && s.scenes >= 2 && !s.genBusy && !s.busy);
    }''', arg=[NOTE_ID], timeout=30000)
    again = page.locator('#filmPane #script').input_value()
    assert again == VOICE, '再进来该续上那份调好的口播稿：%r' % again
    assert sw.evaluate('self.testVoiceCalls') == 1, '续稿不补打 AI（调稿还是只一发）：%s' % sw.evaluate('self.testVoiceCalls')
    print('PASS: 从档案再点「下一步」进这一屏：续上那份稿与 %d 幕、没补打一发 AI'
          % page.evaluate('() => _filmState.scenes'), flush=True)

    # 8) 底栏那颗主钮真能指挥台子：点「🎬 出片」→ 开跑、底栏换成「⏹ 停」+ 进度；点「⏹ 停」→ 回到主钮
    #    （只验走缝，跑一下就停，不真出一整支片）
    page.evaluate('''() => {
        const F = window.Film;
        F.__calls = { start: 0, stop: 0 };
        const os = F.shell.start, of = F.shell.stop;
        F.shell.start = () => { F.__calls.start++; return os(); };
        F.shell.stop = () => { F.__calls.stop++; return of(); };
    }''')
    page.locator('#filmFoot .np-film-start').click()
    page.wait_for_function('() => { const s = _filmState; return !!(s && s.busy); }', timeout=20000)
    running = page.locator('#filmFoot').inner_text().replace('\n', ' ')
    assert '停' in running, '出片中底栏该换成「⏹ 停」：%s' % running
    assert page.locator('#filmFoot .np-film-stop').count() == 1, '底栏该有那颗「⏹ 停」'
    page.locator('#filmFoot .np-film-stop').click()
    page.wait_for_function('() => { const s = _filmState; return !!(s && !s.busy); }', timeout=20000)
    calls = page.evaluate('() => window.Film.__calls')
    assert calls == {'start': 1, 'stop': 1}, '底栏两颗钮该各叫一次台子的动作：%s' % calls
    assert page.locator('#filmFoot .np-film-start').count() == 1, '停下后底栏该回到「🎬 出片」'
    print('PASS: 底栏主钮＝真出片那条缝（%s），跑起来换成「⏹ 停」＋进度，停下回到主钮' % calls, flush=True)

    # 9) 向导那条走真通路：条上点「🎬 分幕」＝就地进这一屏（跟底那颗「下一步 →」同一条路）
    def wiz_bar():
        return page.evaluate('''() => {
            const el = document.getElementById('npSteps');
            const st = [...el.querySelectorAll(':scope > div > div')];
            const lab = (x) => { const e = x.querySelector('span[style*="text-align:center"]'); return e ? e.innerText.split('\\n')[0].trim() : ''; };
            const dot = (x) => { const b = x.querySelector('button,span'), cs = getComputedStyle(b);
                return { tag: b.tagName, tip: b.getAttribute('title') || '', bg: cs.backgroundColor,
                         go: b.getAttribute('data-ngo') || '' }; };
            return { labels: st.map(lab), dots: st.map(dot), n: st.length };
        }''')

    def back_to_wiz():
        page.locator('#filmSteps [data-filmto="rewrite"]').click()
        page.wait_for_function('''() => {
            const b = document.getElementById('npWizBody');
            return !!b && b.offsetParent !== null && _npWiz && _npWiz.step === 4
                && document.getElementById('filmContent').offsetParent === null;
        }''', timeout=25000)

    back_to_wiz()
    vb = wiz_bar()
    assert vb['n'] == 4 and vb['labels'] == ['挑知识', '改稿', '🎬 分幕', '发布'], \
        '向导顶上那条也是这四站、站名跟片台那条一字不差：%s' % vb['labels']
    assert vb['dots'][2]['tag'] == 'BUTTON' and vb['dots'][2]['go'] == 'film', \
        '正文有了——这一站该放开（点了＝npKFinishFilm 那条路）：%s' % vb['dots'][2]
    assert '下一步' in vb['dots'][2]['tip'] and vb['dots'][2]['bg'] != 'rgb(238, 240, 244)', \
        '放开的站＝浅底深字、还要会说跟底那颗「下一步 →」同一条路：%s' % vb['dots'][2]
    assert vb['dots'][3]['tag'] == 'SPAN' and '先出片才到发布' in vb['dots'][3]['tip'], \
        '这篇还没出片：「发布」该灰着点不动：%s' % vb['dots'][3]
    vcalls = sw.evaluate('self.testVoiceCalls')
    page.locator('#npSteps [data-ngo="film"]').click()
    page.wait_for_function('(id) => { const s = _filmState; return !!(s && s.noteId === id && s.scenes >= 2 && !s.genBusy && !s.busy); }',
                           arg=NOTE_ID, timeout=40000)
    assert page.evaluate('() => document.getElementById("filmContent").offsetParent !== null'), '点这一站该就地打开出片那一屏（不另开窗口）'
    assert page.locator('#filmPane #script').input_value() == VOICE, '条上进来也该续上那份调好的口播稿'
    assert sw.evaluate('self.testVoiceCalls') == vcalls, '条上进来不补打 AI（用的就是这一篇存着的那份草稿）'
    print('PASS: 向导条上点「🎬 分幕」＝就地进这一屏、续上那份稿与 %d 幕、没补打 AI'
          % page.evaluate('() => _filmState.scenes'), flush=True)

    # 10) 这篇出过片（往 xhsFilmDocs 种一份 outAt）→ 回向导，条上「发布」才放开；点了落回档案那一行
    page.evaluate('''(a) => chrome.storage.local.get('xhsFilmDocs').then(d => {
        const m = (d && d.xhsFilmDocs) || {};
        m[a.id] = Object.assign({}, m[a.id], { outAt: Date.now() });
        return chrome.storage.local.set({ xhsFilmDocs: m });
    })''', {'id': NOTE_ID})
    back_to_wiz()
    page.wait_for_selector('#npSteps [data-ngo="pub"]', timeout=20000)
    pb = wiz_bar()['dots'][3]
    assert pb['tag'] == 'BUTTON' and '去发布台' in pb['tip'] and pb['bg'] != 'rgb(238, 240, 244)', \
        '出过片了——「发布」该放开（浅底深字，点了回档案那一行）：%s' % pb
    page.locator('#npSteps [data-ngo="pub"]').click()
    page.wait_for_function('''(id) => {
        const p = document.getElementById('noteArchiveContent');
        return !!p && p.offsetParent !== null && !!document.querySelector('.npar-next[data-id="' + id + '"]');
    }''', arg=NOTE_ID, timeout=25000)
    print('PASS: 出过片后向导条上「发布」放开（点了落回笔记档案那一行，下一步就去发布台）', flush=True)

    assert not errs, 'pageerror：%s' % errs[:3]
    page.screenshot(path=str(OUT / 'shell.png'))
    print('PASS: 全程零 pageerror', flush=True)
    print('\n全绿：墙拆了且挂进流程了——口播稿／分幕就搭在发笔记那一页的 #filmPane 上（外壳三件由外层画、里头那三件只当状态容器），'
          '状态同页直接递、⚙ 是本页弹窗、底栏两颗钮走 window.Film 那条缝；窄了切两签、宽了并排；单开一页仍画自己那套、四站摆灰；'
          '两条工作流条站名一字不差（🎬 分幕），正文有了条上这一站放开、出过片「发布」才放开', flush=True)
    ctx.close()
