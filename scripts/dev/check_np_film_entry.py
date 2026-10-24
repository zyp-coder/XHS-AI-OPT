# -*- coding: utf-8 -*-
"""「那一篇正文 → 出片那一屏」这条入口＋这一屏本身 自检（🎬 渲染任务表撤后按档案「下一步」改口；
   「🎙 口播稿／🎬 分幕」两站并成一屏一站「🎬 分幕」（左＝稿、右＝幕），
   进站一路自动跑完（按正文调稿 → 提重点 → 改出出片稿 → 切幕），底栏撤了步进只留「🎬 出片」，
   回写稿的「改稿」站走顶上那条工作流条；
   拆墙之后这一屏就搭在「发笔记」那一页里（#filmPane，不再隔一层网页）：顶栏／工作流条／底栏由外层那页画，
   所以这里的读法全是本页直读（window.Film、#filmPane …、#filmHead、#filmSteps、#filmFoot）。

七十改：前端那张「🎬 渲染任务」表整页撤了——活就是这一篇自己的：出片从档案那一行点「下一步」直接进字效编辑器
（npArNext → to='film' → npArOpenFilm → npGoFilm；条目级那两份 imgDocs / filmDocs 的数据层没动，老档照样读得回）。
本脚本跟家族口径一样直开档案页，点那一行真钮走同一条通路；「出图」那一页的五档仍是原样（闸门只锁出片）。
按画面表铺底图（一行一段）那条口径在 check_film_kinds.py 里验，这里验入口本身。

跑法：python3 -X utf8 scripts/dev/check_np_film_entry.py
临时 profile 加载真扩展（msedge），AiClient 全程走桩、不烧真接口（进站那一路的两发都走桩：按正文调口播稿一发、
提重点一发；提重点回不出重点 → B1 本机规则兜底切幕＋幕栏标注，脚本按这个形验收）：
  1) 写文案 ①→⑤（④ 唯一前进路＝点中样稿；⑤ 默认逐句列表，点一句只改那一句）→ 这一篇入档
  2) 把这一篇置成「视频 · PPT字体动效」档（照 npKFinishFilm 那条真出口落档的形状：kOut='film' / voice＝正文那份、
     form=视频 / style=口播讲解 / filmKind=PPT字体动效 / filmDocs 一行）：档案那一行「下一步」＝✏️ 编辑、
     tip 说「进字效」
  3) 点那一行「下一步」：就地进出片台（不另开窗口、左栏二级仍停在「笔记档案」）；成片形式跟着这一篇走，
     不再铺五选一盖板；顶上那条工作流条＝挑知识 → 改稿 → 🎬 分幕 → 发布（七十一改：稿与幕并成一屏、
     本台只占一站）；出口落档那份 voice 与正文同文＝还没调口播稿，别当稿递进去——进站一路自动跑完
     （按正文调一版稿 → 提重点 → 切幕；老板投诉的「一进去口播稿是空的／就是正文」正是这一条），
     草稿按篇存进 xhsFilmDocs[这一档]，全局那份 xhsFilmScript 一个字都不写；提重点走桩回不出 → 本机规则
     兜底切幕＋幕栏标注，一屏里左边是稿、右边是幕，还有预览画布和「↗ 在新标签页打开」
  3b) 底栏没有步进（一站一屏）：主钮就是「🎬 出片（配音 + 画面）」；稿栏与幕栏同屏可见
  3c) 回来路走顶上那条条：点「改稿」那站＝跳出片台、回向导的改稿站（老板投诉的「到了出片就不能上一步了／
      顶部展示条也没了」）——回去后向导 ⑤ 改稿、顶上那条也是这四站；
      从档案再点「下一步」进台子：这次带的是调好的那份稿与切好的幕，不再补打一发 AI（B5 有稿不覆盖）
  4) 出片台皮肤跟全站一套（浅底 + 白卡片 + 跟弹窗同一个 --c-brand / --c-brand-on）——ui.css 的 <link> 掉了这条就红
  5) 在台子「✏️ 换一种」→「卡片画面叙事」：只换画面、这一篇正文不许被改写；画面切成卡片轮播；
     换完形式这个档的 filmKind 跟着改（落进这一档的条目级）；点编辑器顶栏「← 返回档案」回来，那一行「形式」列跟着改
  6) 正文改过再点「下一步」进台子（这份 fixture 把 voice／draft 一起换成同一份新正文＝还是没调过口播稿）：
     旧分幕对不上新稿、稿与幕作废，进站自动按新正文一路重跑（这一趟第二发调稿 + 第二发提重点 → 本机兜底重切）
  7) 档位闸门只锁出片：关掉 videoFilm 时，在台子选本机那两档弹一句「当前版本未开通本机出片」提醒；
     「🖼 出图」照常进得去（五档工作流不动，出图列表不再回来）。
     （init 期把 filmContent 整块摘掉那条只有自定义包会走到，要重载页面才有观察点，这里不验。）
"""
import json
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
OUT = pathlib.Path(os.environ.get('TEMP', '/tmp')) / 'xhs_film_entry'
OUT.mkdir(parents=True, exist_ok=True)

NEW_VOICE = '改过的第二版正文。\n第二行也换了。'
# 走桩回的口播稿：桩按「这一篇的正文是哪一版」回对应的稿，脚本据此验「进站自动调的那一版」确实是照着正文来的
VOICE1 = '口播稿第一版：开场先戳一句。\n第二句讲干货。\n第三句收口，私信我。'
VOICE2 = '口播稿第二版：正文换过之后重调。\n第二句也跟着换。\n第三句收口，私信我。'

PEOPLE = {'people_options': [{'name': f'测试人群{i}', 'pain': '选择困难', 'scene': '准备购买', 'timing': '购买前'} for i in (1, 2, 3)]}
# ③ 的候选话题要带「线」：④ 靠它自动按这条线的几种写法出一批样稿
TOPICS = {'topics': [{'topic': '测试话题', 'angle': '角度', 'target': '人群', 'rationale': '理由',
                      'fact': '一件真事：凌晨还在翻评论', 'type': 'howto', 'kind': 'steps'}]}
NOTE = {'titles': ['标题A', '标题B', '标题C'], 'content': '开场钩子。\n\n干货。\n\n结尾引导。', 'tags': ['效率', '省时间'], 'timeTip': '12:00'}
VARIANTS = json.dumps({'variants': [{'kind': '清单列举', 'title': '样稿标题', 'content': NOTE['content'], 'tags': NOTE['tags']}]}, ensure_ascii=False)
SENT_REVISED = '改过的开场钩子。'


def boot(p):
    """起浏览器 + 装真扩展。

    playwright 默认往命令行里塞 --disable-extensions，跟 --load-extension 撞一起会时灵时不灵（扩展装不上、
    service_workers 一直空），所以摘掉那个默认开关；每趟用全新档，免得读到上版 background.js 的缓存。
    """
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
        config.product.name = '流程测试产品';
        config.product.sellPoints = [{title: '省时间', content: '简化重复步骤'}];
        config.ai.apiKey = 'test-local-only';
        await Storage.setConfig(config);
        self.testVoiceCalls = 0; self.testVisualCalls = 0; self.testFilmCalls = 0; self.testScriptCalls = 0;
        AiClient.chatCompletion = async (cfg, system, user) => {
            const sys = String(system || '');
            const usr = String(user || '');
            const call = async (text) => { await new Promise(r => setTimeout(r, 200)); return {content: text}; };
            if (usr.includes('【要点的那一句】')) return call(payload.sentence);   // ⑤ 逐句改：只回那一句
            if (sys.includes('同题写一批')) return call(payload.variants);        // ④ 那批样稿（必须在成稿那条之前）
            if (sys.includes('通读这篇口播稿，标出')) { self.testFilmCalls++; return call('{}'); }   // 一路直出的「提重点」：回不出重点 → B1 本机规则兜底切幕
            if (sys.includes('按给定的重点，把这篇口播稿改成')) { self.testScriptCalls++; return call('{}'); }  // 按重点改出片稿＋切幕（提重点先失败就不该走到）
            if (sys.includes('把下面这篇已经定稿的图文笔记') || sys.includes('卡片轮播口播')) {
                self.testVoiceCalls++;                                          // 一路直出的第一发：按正文调口播稿（走桩）
                return call(usr.includes(payload.body2) ? payload.voice2 : payload.voice1);
            }
            if (sys.includes('你在帮一条') || sys.includes('你在改一条')) { self.testVisualCalls++; return call('{"提名句":[]}'); }
            if (sys.includes('爆款图文笔记写手')) return call(payload.note);
            if (sys.includes('候选话题')) return call(payload.concept_topics);
            return call(payload.concept_people);
        };
    }''', {'voice1': VOICE1, 'voice2': VOICE2, 'body2': NEW_VOICE,
           'note': json.dumps(NOTE, ensure_ascii=False),
           'variants': VARIANTS,
           'sentence': json.dumps({'sentence': SENT_REVISED}, ensure_ascii=False),
           'concept_people': json.dumps(PEOPLE, ensure_ascii=False),
           'concept_topics': json.dumps(TOPICS, ensure_ascii=False)})
    eid = sw.url.split('/')[2]

    errs = []
    page = ctx.new_page()
    page.set_default_timeout(20000)
    page.on('pageerror', lambda e: errs.append(str(e)))
    goto_big(page, eid)
    page.wait_for_function('() => typeof _npWiz !== "undefined"')
    if page.locator('#fsClose').is_visible():
        page.locator('#fsClose').click()

    # ── 1) 写文案 ①→⑤：④ 只有「点中样稿」一条前进路，⑤ 默认逐句改 ────────────────
    page.evaluate('() => switchMainTab("notePublish", "new")')
    page.wait_for_function('() => document.getElementById("notePublishContent").offsetWidth > 0 && !!document.querySelector(".np-spk")')
    page.locator('.np-spk').first.check()
    page.locator('.np-wiz-next').click()
    page.locator('.np-ppc').first.check()
    page.locator('.np-wiz-next').click()
    page.wait_for_function('() => !!document.querySelector(".np-tpc:checked")')
    page.locator('.np-wiz-next').click()
    page.wait_for_function('() => _npWiz.step === 3')
    assert page.locator('#npWizBody').inner_text().find('④ 挑稿') >= 0, '话题与成稿之间该是 ④ 挑稿（这条线底下的几种写法各出一篇给你挑）'
    page.wait_for_function('() => !!document.querySelector(".npVarPick")', timeout=60000)
    page.locator('.npVarPick').first.click()
    page.wait_for_function('() => !!(_npWiz.draft && String(_npWiz.draft.content || "").trim())')
    page.wait_for_function('() => _npWiz.step === 4 && !!document.querySelector(".np-sent-row")')
    page.locator('.np-sent-row').first.click()
    page.wait_for_selector('#npSentAsk')
    page.fill('#npSentAsk', '开头那句换掉')
    page.locator('.np-sent-go').click()
    page.wait_for_function('(t) => (_npWiz.draft.content || "").indexOf(t) === 0', arg=SENT_REVISED, timeout=25000)
    assert page.evaluate('_npWiz.draft.content') == SENT_REVISED + '\n\n干货。\n\n结尾引导。', \
        '逐句改只许换那一句，其余一字不动：%s' % page.evaluate('_npWiz.draft.content')
    expect(page.locator('#npSentMsg')).to_contain_text('这句换好了')
    page.wait_for_function('() => !!_npWiz.arId', timeout=15000)
    ar_id = page.evaluate('_npWiz.arId')
    body_now = page.evaluate('_npWiz.draft.content')
    print('这一篇的档案档 =', ar_id, flush=True)

    def read_note():
        return page.evaluate('''async (id) => {
            const d = await chrome.storage.local.get('np_notes');
            return ((d.np_notes || []).find(x => x.id === id)) || null;
        }''', ar_id)

    def wait_note(pred_js, what, timeout=15.0):
        """等这一篇在 np_notes 里满足某个条件（防抖落档是异步的）；pred_js 里用 n 指这一条"""
        fn = '(a) => { const n = a.n; return n ? (%s) : false; }' % pred_js
        t0 = time.time()
        while time.time() - t0 < timeout:
            n = read_note()
            if n and page.evaluate(fn, {'n': n}):
                return n
            page.wait_for_timeout(300)
        raise AssertionError('%s（15 秒没等到）最后读到：%r' % (what, (read_note() or {}).get('draft')))

    def fix_note(fields, why):
        """照 npKFinishFilm 那条真出口落档的形状改这一篇（直写 np_notes，字段口径与 npArchiveData 对齐）"""
        page.evaluate('''async (a) => {
            const d = await chrome.storage.local.get('np_notes');
            const list = d.np_notes || [];
            const n = list.find(x => x.id === a.id);
            if (!n) return false;
            Object.assign(n, a.fields);
            await chrome.storage.local.set({ np_notes: list });
            return true;
        }''', {'id': ar_id, 'fields': fields})
        print('  fixture（%s）→ %s' % (why, json.dumps(fields, ensure_ascii=False)), flush=True)

    # 先等这一篇的正文落档（向导那笔防抖保存），再动 fixture——免得被没落完的旧快照盖回去
    wait_note('String(n.draft || "").trim() === %s' % json.dumps(body_now), '这一篇的正文该已落进档案')

    # ── 2) 置成「视频 · PPT字体动效」档（＝npKFinishFilm 真出口的形状）：档案那行「下一步」＝✏️ 编辑、指「进字效」 ──
    fix_note({
        'kOut': 'film', 'path': 'video', 'dir': 'k',
        'voice': body_now, 'form': '视频', 'style': '口播讲解', 'filmKind': 'PPT字体动效',
        'status': '代发',
        'filmDocs': [{'id': 'vfix1', 'kind': 'PPT字体动效', 'key': ar_id, 'updatedAt': 0}],
    }, '视频档 ＝ npKFinishFilm 落档形状（kOut=film / voice＝正文 / form=视频 / filmKind=PPT字体动效 / filmDocs 一行）')
    page.evaluate('() => switchMainTab("noteArchive")')
    page.wait_for_function('(id) => !!document.querySelector(".npar-next[data-id=\\"" + id + "\\"]")', arg=ar_id)
    nx = page.locator('.npar-next[data-id="%s"]' % ar_id)
    assert nx.inner_text().strip() == '✏️ 编辑', '视频档那行的「下一步」该是「✏️ 编辑」：%r' % nx.inner_text()
    tip = nx.get_attribute('title') or ''
    assert '进字效' in tip, ('出口那份 voice＝正文同文：tip 该指「进字效」（进去自动调稿），不是报缺稿：%r' % tip)
    row = nx.locator('xpath=ancestor::div[contains(@class,"npar-row")]').inner_text().replace(' ', '')
    assert '成片' in row and 'PPT字体动效' in row, '档案那一行该标着「✨ 成片 · PPT字体动效」：%s' % row
    print('PASS: 档案那行「下一步」＝✏️ 编辑、tip 指「进字效」（出口那份 voice＝正文同文＝还没调口播稿，不是缺稿），形式列＝✨ 成片 · PPT字体动效', flush=True)

    # ── 3) 点那一行「下一步」：就地进出片台（不另开窗口、二级栏停在「笔记档案」、盖板不铺五选一） ──
    pages_before = len(ctx.pages)
    nx.click()
    page.wait_for_function('() => document.getElementById("filmContent") && document.getElementById("filmContent").offsetParent !== null', timeout=20000)
    assert len(ctx.pages) == pages_before, '出片台该就地打开，不该另开窗口（现有 %d 个页面）' % len(ctx.pages)
    assert page.locator('#tabNoteFilm').count() == 0, '出片台不再是二级 tab（它是档案衍生的站内页）'
    assert 'active' in (page.locator('#tabNoteArchive').get_attribute('class') or ''), \
        '出片台是档案衍生的站内页：左栏二级该停在「笔记档案」上'
    assert page.evaluate('() => document.getElementById("filmGate").style.display === "none"'), \
        '成片形式跟着档案那一行定好了，进台子不该再铺一层五选一'
    bar = page.locator('#filmHead').inner_text()
    assert 'PPT字体动效' in bar and '大字动效' in bar, '顶栏那句该报这一片的成片形式：%s' % bar
    print('PASS: 从档案行「下一步」就地进出片台（没另开窗口、二级栏停在「笔记档案」），形式跟着这一篇走 → 盖板不铺五选一', flush=True)

    # ── 3b) 出口那份 voice＝正文同文＝还没调过口播稿：顶上四站条带着前两站进来、进站一路自动跑完（调稿 → 提重点 → 切幕） ──
    page.set_viewport_size({'width': 1500, 'height': 900})      # 宽一些才两栏并排（窄了会切成顶上那两签）
    page.wait_for_function('''(a) => {
        const F = window.Film;
        return !!(F && F.noteId === a[0] && String(F.script || '') === a[1] && F.scenes.length && !F.genBusy && !F.busy);
    }''', arg=[ar_id, VOICE1], timeout=30000)
    pane = page.locator('#filmPane')
    assert pane.locator('#script').input_value() == VOICE1, '片台里该是进站按正文自动调出来的那版口播稿，不是正文本身'
    assert page.evaluate('() => Film.fvFrom') == 'body', '这一版标着「按正文调出来的」（fvFrom=body）'
    assert sw.evaluate('self.testVoiceCalls') == 1, '进站自动调一版口播稿＝正好一发（走桩）：%s' % sw.evaluate('self.testVoiceCalls')
    assert sw.evaluate('self.testFilmCalls') == 1, '同一路里紧跟的那一发提重点（走桩）＝正好一发：%s' % sw.evaluate('self.testFilmCalls')
    scenes = page.evaluate('() => Film.scenes.length')
    assert scenes >= 2, ('三句稿子进站该自动切得出幕', scenes)
    assert page.evaluate('() => Film.scRule') is True, 'AI 回不出重点＝本机规则兜底，该打上「本机规则」标注'
    assert sw.evaluate('self.testScriptCalls') == 0, '提重点没回出重点，就不该再打「按重点改出片稿」那一发：%s' % sw.evaluate('self.testScriptCalls')
    # 顶上那条工作流条（这一屏的外壳由外层那页画）：挑知识 → 改稿 → 🎬 分幕 → 发布
    bar = page.evaluate('''() => {
        const el = document.getElementById('filmSteps');
        const st = [...el.querySelectorAll(':scope > div > div')];
        const lab = (x) => { const e = x.querySelector('span[style*="text-align:center"]'); return e ? e.innerText.split('\\n')[0].trim() : ''; };
        const cur = el.querySelector('[style*="0 0 0 3px"]');
        const last = st.length ? st[st.length - 1].querySelector('button,span') : null;
        return { labels: st.map(lab), cur: cur ? (cur.getAttribute('title') || '') : '',
                 flow: (Film.flow || []).map(x => x.t),
                 pub: !!el.querySelector('[data-filmpub]'),
                 pubTip: last ? (last.getAttribute('title') || '') : '',
                 steps: ['prevStep', 'nextStep'].filter(id => !!document.getElementById(id)) };
    }''')
    assert bar['labels'] == ['挑知识', '改稿', '🎬 分幕', '发布'], bar
    assert bar['flow'] == ['挑知识', '改稿'], '前两站由写稿那头递过来（npFilmFlowOf）：%s' % bar['flow']
    assert '正在这一站' in bar['cur'], ('进站停在稿·幕这一站（圆点带外圈）', bar)
    assert bar['pub'] is False and '先出片才到发布' in bar['pubTip'], '还没出片，「发布」那站该是灰的：%s' % bar
    assert not bar['steps'], '底栏不该再有步进按钮（一站一屏）：%s' % bar['steps']
    print('PASS: 顶上工作流条＝%s，进站停在「🎬 分幕」一站；正文同文不当稿递进去 → 一路自动跑到 %d 幕（调稿＋提重点各一发走桩）'
          % (' → '.join(bar['labels']), scenes), flush=True)
    page.wait_for_function('''async (a) => {
        const d = await chrome.storage.local.get('xhsFilmDocs');
        return ((d.xhsFilmDocs || {})[a[0]] || {}).script === a[1];
    }''', arg=[ar_id, VOICE1], timeout=20000)
    assert not page.evaluate('async () => (await chrome.storage.local.get("xhsFilmScript")).xhsFilmScript'), \
        '按篇走的这一趟不该往全局那份里写'
    # 一屏两栏都在：左边稿、右边幕（幕栏带「本机规则」标注 + 逐幕卡）；出片那颗在主钮位上
    expect(page.locator('#filmPane #scenes .fvnote')).to_contain_text('本机规则')
    assert pane.locator('.scene').count() == scenes, '分幕卡该跟着长出来'
    assert pane.locator('.col.script').is_visible() and pane.locator('.col.scenes').is_visible(), '稿栏与幕栏该同屏摆着'
    assert '出片' in page.evaluate('() => document.querySelector("#filmPane #go").textContent'), '底栏那颗主钮该是「🎬 出片」'
    assert pane.locator('#cv').is_visible(), '预览画布该在这一屏里'
    assert page.locator('#filmHead .np-film-popout').count() == 1, '顶栏该有那颗「↗ 在新标签页打开」'
    print('PASS: 一屏一站——左边稿 / 右边幕同屏，AI 回不出重点时本机规则兜底 %d 幕并标注；草稿按篇存进 xhsFilmDocs[这一档]，全局那份不动' % scenes, flush=True)

    # ── 3c) 顶上那条条点「改稿」＝跳出片台、回向导的改稿站；从档案再进台子＝续上那份稿与幕（不再补打 AI） ──
    page.locator('#filmSteps [data-filmto="rewrite"]').click()
    page.wait_for_function('() => !!document.getElementById("npWizBody") && document.getElementById("npWizBody").offsetParent !== null && _npWiz.step === 4', timeout=25000)
    assert page.evaluate('() => !document.getElementById("filmContent") || document.getElementById("filmContent").offsetParent === null'), \
        '回向导改稿站后，出片台那一页该收起来'
    steps_bar = page.locator('#npSteps').inner_text().replace('\n', ' ')
    for lab in ('挑知识', '改稿', '🎬 分幕', '发布'):
        assert lab in steps_bar, ('向导顶上那条也该是这四站，缺「%s」：%s' % (lab, steps_bar))
    print('PASS: 顶上「改稿」那站点一下回到来路——出片台收起、向导落在「改稿」站（第 ⑤ 步），向导顶部条同样是这四站：%s' % steps_bar.replace('  ', ' '), flush=True)
    page.evaluate('() => switchMainTab("noteArchive")')
    page.wait_for_function('(id) => !!document.querySelector(".npar-next[data-id=\\"" + id + "\\"]")', arg=ar_id)
    page.locator('.npar-next[data-id="%s"]' % ar_id).click()
    page.wait_for_function('''(a) => {
        const F = window.Film;
        return !!(F && F.noteId === a[0] && String(F.script || '') === a[1] && F.scenes.length >= 2);
    }''', arg=[ar_id, VOICE1], timeout=30000)
    assert sw.evaluate('self.testVoiceCalls') == 1, '再进台子带的是调好的那份稿＝不补打 AI（B5 有稿不覆盖）：%s' % sw.evaluate('self.testVoiceCalls')
    assert sw.evaluate('self.testFilmCalls') == 1, '幕已排好＝进站那一路不自动重切（AI 通路不动）：%s' % sw.evaluate('self.testFilmCalls')
    print('PASS: 从档案再点「下一步」进台子：续上那份调好的口播稿与已分好的 %d 幕，没再补打一发 AI' % scenes, flush=True)

    # ── 4) 皮肤跟全站一套（浅底 + 白卡片 + 跟弹窗同一个主色）：ui.css 那个 <link> 掉了这条就红 ──
    popup_brand = page.evaluate('() => getComputedStyle(document.documentElement).getPropertyValue("--c-brand").trim()')
    assert len(popup_brand) == 7 and popup_brand.startswith('#'), '弹窗该有一套 --c-brand：' + popup_brand
    _br, _bg, _bb = (int(popup_brand[i:i + 2], 16) for i in (1, 3, 5))
    brand_rgb = 'rgb(%d, %d, %d)' % (_br, _bg, _bb)
    page.mouse.move(2, 2)                     # 鼠标停在按钮上有 hover 过渡色，量之前先挪开
    theme, prev = None, None
    for _ in range(15):
        theme = page.evaluate('''() => {
            const css = (sel) => getComputedStyle(document.querySelector('#filmPane ' + sel));
            return { bodyBg: getComputedStyle(document.body).backgroundColor,
                     cardBg: css('#secScript').backgroundColor,
                     goBg: css('#go').backgroundColor, goInk: css('#go').color,
                     markBg: css('header .mark').backgroundColor };
        }''')
        if prev == theme:
            break
        prev = theme
        page.wait_for_timeout(120)
    popup_on = page.evaluate('() => getComputedStyle(document.documentElement).getPropertyValue("--c-brand-on").trim()')
    assert len(popup_on) == 7 and popup_on.startswith('#'), '弹窗该有一套 --c-brand-on：' + popup_on
    _or, _og, _ob = (int(popup_on[i:i + 2], 16) for i in (1, 3, 5))
    on_rgb = 'rgb(%d, %d, %d)' % (_or, _og, _ob)
    assert theme['bodyBg'] == 'rgb(246, 247, 249)', ('这一页的底该用全站浅色（--c-bg）——台子就搭在这页里', theme)
    assert theme['cardBg'] == 'rgb(255, 255, 255)', ('控制区该是白卡片（--c-surface）', theme)
    assert theme['markBg'] == brand_rgb, ('台子那套零件的图标底该跟弹窗同一个主色（%s）' % brand_rgb, theme, popup_brand)
    assert theme['goBg'] == brand_rgb and theme['goInk'] == on_rgb, \
        ('主按钮该是主色底 + 主题算出的对比字色（%s on %s）' % (on_rgb, brand_rgb), theme, popup_brand)
    print('PASS: 台子跟全站同一套皮（浅底 %s / 白卡片 / 主按钮 %s＋对比字色，跟弹窗同一个 --c-brand）'
          % (theme['bodyBg'], theme['goBg']), flush=True)
    page.screenshot(path=str(OUT / 'film-embed.png'))

    # ── 5) 在片台「✏️ 换一种」→「卡片画面叙事」：只换画面，这一篇正文不许被改写；画面切成卡片轮播 ──
    page.locator('#filmHead .np-kind-change').click()
    page.wait_for_function('() => document.querySelectorAll("#filmGate .np-kind-pick").length === 6')
    page.locator('#filmGate .np-kind-pick[data-k="卡片画面叙事"]').click()
    page.wait_for_function('''(id) => {
        const F = window.Film;
        return !!(F && F.noteId === id && F.cfg.frame === 'card' && String(F.script) === %s && F.scenes.length);
    }''' % json.dumps(VOICE1), arg=ar_id, timeout=30000)
    assert pane.locator('#knobs .chip.on:has-text("卡片轮播")').count() == 1, '④「画面」那颗该亮在卡片轮播上'
    scenes2 = page.evaluate('() => Film.scenes.length')
    assert scenes2 >= 2, ('换形式该接回这一篇草稿里已有那几幕', scenes2)
    cards = page.evaluate('() => Film.scenes.map(s => (s.card && s.card.src) ? 1 : 0)')
    assert sum(cards) == 0, ('这一篇画面表每一段都没传回图 → 各段走纯色卡，不从素材库瞎抓', cards)
    assert sw.evaluate('self.testVoiceCalls') == 1, '换形式不许顺手重调口播稿、更不许改写这一篇正文：%s' % sw.evaluate('self.testVoiceCalls')
    bar = page.locator('#filmHead').inner_text()
    assert '卡片画面叙事' in bar, bar
    n2 = wait_note('n.filmKind === "卡片画面叙事"', '换形式该落进这一档的条目级（filmKind）')
    assert (n2.get('voice') or '') == VOICE1, '调好的口播稿该写回这一档（下次进站直接续上）：%r' % (n2.get('voice') or '')
    assert (n2.get('draft') or '') == body_now, '换形式只动成片形式：这一篇的正文一个字不许改'
    # 顶栏那颗「← 返回档案」回来：那一行「形式」列跟着改成卡片画面叙事（档案异步重渲，等行里真换过来）
    page.locator('#filmHead .np-film-archive').click()
    page.wait_for_function('(a) => { const el = document.querySelector(".npar-next[data-id=\\"" + a[0] + "\\"]"); if (!el) return false; '
                           'const row = el.closest(".npar-row"); return !!row && row.innerText.indexOf(a[1]) >= 0; }',
                           arg=[ar_id, '卡片画面叙事'], timeout=20000)
    back = page.locator('.npar-next[data-id="%s"]' % ar_id).locator('xpath=ancestor::div[contains(@class,"npar-row")]').inner_text().replace(' ', '')
    assert '卡片画面叙事' in back, '回档案这一行形式列跟着变成卡片画面叙事：%s' % back
    print('PASS: 片台「✏️ 换一种」→ 卡片画面叙事：画面切卡片轮播、没传回图的段走纯色卡，这一篇正文一个字没改；回档案那一行跟着落档', flush=True)

    # ── 6) 正文重出一版（voice／draft 一起换成同一份新正文＝还是没调过口播稿）：旧分幕作废、进站自动按新正文再调一版 ──
    fix_note({'voice': NEW_VOICE, 'draft': NEW_VOICE}, '这一篇重出了一版正文（voice / draft 一起换）')
    page.locator('.npar-next[data-id="%s"]' % ar_id).click()
    page.wait_for_function('''(a) => {
        const F = window.Film;
        return !!(F && F.noteId === a[0] && String(F.script) === a[1] && F.scenes.length >= 2 && !F.genBusy);
    }''', arg=[ar_id, VOICE2], timeout=30000)
    assert sw.evaluate('self.testVoiceCalls') == 2, '正文换过＝那份稿对不上，进站该按新正文再自动调一版（累计两发）：%s' % sw.evaluate('self.testVoiceCalls')
    assert page.evaluate('() => Film.body') == NEW_VOICE, '台子里那份正文该跟着换成新稿'
    assert sw.evaluate('self.testFilmCalls') == 2, '同一路里紧跟的提重点也跟着重跑一发（累计两发）：%s' % sw.evaluate('self.testFilmCalls')
    assert page.evaluate('() => Film.scenes.length') >= 2, '提重点还是回不出 → 本机规则按新稿重切'
    page.wait_for_function('''(a) => {
        return chrome.storage.local.get('xhsFilmDocs').then(d => ((d.xhsFilmDocs || {})[a[0]] || {}).script === a[1]);
    }''', arg=[ar_id, VOICE2], timeout=20000)
    print('PASS: 正文改过后再点「下一步」：旧分幕作废、台子进站一路自动重跑（按新正文调稿 → 提重点 → 本机兜底重切），草稿那份跟着换成新稿', flush=True)

    # ── 7) 档位闸门只锁出片：关掉 videoFilm 时，在台子选本机那两档弹提醒；「🖼 出图」照常进得去 ──
    page.evaluate('() => { _editionCache = { edition: { features: { videoFilm: false } } }; return 1; }')
    page.evaluate('''() => {
        window.__toasts = [];
        const orig = toast;
        window.toast = (m, k) => { __toasts.push(String(m)); return orig(m, k); };
    }''')
    page.locator('#filmHead .np-kind-change').click()
    page.wait_for_function('() => document.querySelectorAll("#filmGate .np-kind-pick").length === 6')
    page.locator('#filmGate .np-kind-pick[data-k="PPT字体动效"]').click()
    page.wait_for_function('() => (window.__toasts || []).some(m => m.indexOf("当前版本未开通本机出片") >= 0)')
    print('PASS: 关掉 videoFilm：在台子选本机档弹「当前版本未开通本机出片」提醒', flush=True)
    page.evaluate('''async (id) => {
        const list = await npNotesAll();
        const n = list.find(x => x && x.id === id) || null;
        switchMainTab('noteOut', n);
    }''', ar_id)
    page.wait_for_function('() => _npMode === "out" && !!document.querySelector("#npImgTabs .np-imgtab")')
    keys = page.locator('#npImgTabs .np-imgtab').evaluate_all('els => els.map(x => x.getAttribute("data-t"))')
    assert keys == ['look', 'cover', 'cut', 'desc', 'preview'], ('造图片该是五档工作流：%s' % keys)
    assert page.locator('#npImgList').count() == 0, '出图列表那一档整块下线'
    assert page.locator('.np-path-image, .np-path-video, .np-style').count() == 0, \
        '旧的「做图片 / 做视频」那条路已整块下线，闸门关着时也不该又长出来'
    print('PASS: 闸门只锁出片——关掉 videoFilm 出图照样进得去（五档工作流不动，出图列表不再回来）', flush=True)

    assert [sw.evaluate('self.testVoiceCalls'), sw.evaluate('self.testVisualCalls'), sw.evaluate('self.testScriptCalls')] == [2, 0, 0], \
        '这条链只该打「进站一路直出」的两轮（每轮＝按正文调口播稿一发＋提重点一发，正文换过一次＝再走一轮），' \
        '提重点回不出就不该走到「按重点改出片稿」，画面/其余 AI 一发都不该打：' \
        'voice=%s visual=%s filmScript=%s' % (
            sw.evaluate('self.testVoiceCalls'), sw.evaluate('self.testVisualCalls'), sw.evaluate('self.testScriptCalls'))
    assert not errs, '页面报错：%s' % errs[:3]
    page.screenshot(path=str(OUT / 'film-entry.png'))
    print('PASS: 无 pageerror', flush=True)
    print('SCREENSHOT:', OUT / 'film-entry.png', flush=True)
    print('\n全绿：档案那一行「下一步」→ 出片台这条入口（就地进台 / 顶上四站工作流条 / 进站一路自动到幕 / 兜底标注 / '
          '一屏两栏无步进 / 顶上条回改稿 / 按篇草稿 / 皮肤 / 换形式 / 改稿重调重切 / 闸门）', flush=True)
    ctx.close()
