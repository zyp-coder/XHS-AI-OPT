# -*- coding: utf-8 -*-
# ⚠ 弃置（2026-10-09）：这份自检停在五十八／五十九改口径（表格版：写文案 / 出片台 / 教程 三颗按钮、闸门挂在出片台上）。
#   档案列表后来整页重做成「方向＋最终形式＋一颗下一步」（六十四改落地，demo 与扩展同口径），
#   本脚本的断言与现行界面已对不上——留档不删、别再拿它对版本；现行档案核对走 check_cold_pages.py（#12 冷载点检）。
"""笔记档案表格版 + 入口闸门自检（老板 2026-10-01 三条，五十八／五十九改后跟着改口）：
   1) 档案做成表格：一行一篇（行高矮）、多列并排、操作列回到右边，按钮是 写文案 / 出片台 / 教程 + 删除
   2) 链路闸门只剩一道，挂在「🎬 出片台」那一颗上：这篇没正文＝灰态＋原因＋点了不跳页；
      有正文点下去进的是那张任务表（一行＝一个活），不再直接跳造图片——
      旧的 🖼 造图片 / 🎥 出片台 两颗入口下线，缺料的提醒改在表上那一行说（归 check_task_list.py 管）
   3) 发布教程单独一页，入口在操作列那颗「📖 教程」；换「发哪一种」只是换着看，不落档案、不烧 AI

跑法：python3 -X utf8 scripts/dev/check_archive_card.py
在临时 profile 里加载真扩展（msedge headful），灌 3 篇不同状态的档案，AI 走桩、全程一发都不该烧。
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
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / 'extension'
OUT = pathlib.Path(os.environ.get('TEMP', '/tmp')) / 'xhs_archive_card'
OUT.mkdir(parents=True, exist_ok=True)

DRAFT = ('第一句是开场钩子，把人的注意力按住。\n\n'
         '第二段讲为什么会卡住：一个人做账号，最费时间的不是写，是想——想选题、想标题、想今天到底发什么，一天就这么没了。\n\n'
         '第三段给三步做法，一步一步来。\n\n结尾引导，私信我聊。')
VOICE = '一个人做小红书。\n真正管用的就三步。\n私信我，免费测评。'
VISUAL = {'cover': '【封面提示词】竖版 3:4 封面，大字标题。', 'images': '第1张：配图说明。第2张：配图说明。'}

NOTES = [
    # A：只写了一半（没有正文）——「🎬 出片台」那颗是灰态，点了只给一句指路的话
    {'id': 'na', 'title': '测试这篇只写了开头', 'platform': 'xhs', 'status': '草稿',
     'topic': '小红书怎么找客户', 'people': ['测试人群1'], 'sellPoints': [{'point': '省时间'}],
     'draft': '', 'voice': '', 'visual': None, 'origin': 'wizard', 'updatedAt': int(time.time() * 1000)},
    # B：有正文 + 出图提示词（老档没记 imgDocs）——那一行活由档案合成，进得造图片
    {'id': 'nb', 'title': '测试这篇有图没口播', 'platform': 'xhs', 'status': '待发',
     'topic': '小红书怎么找客户', 'draft': DRAFT, 'voice': '', 'visual': VISUAL,
     'form': '图文', 'style': '清单卡片式', 'origin': 'wizard', 'updatedAt': int(time.time() * 1000)},
    # C：正文 + 口播都有、成片形式＝PPT字体动效（有稿就能本机出），已发 → 出片那颗进得台子
    {'id': 'nc', 'title': '测试这篇料齐了', 'platform': 'douyin', 'status': '已发',
     'topic': '另一个话题', 'draft': DRAFT, 'voice': VOICE, 'visual': VISUAL,
     'form': '视频', 'filmKind': 'PPT字体动效', 'style': '口播讲解', 'origin': 'wizard',
     'statusAt': {'已发': int(time.time() * 1000)}, 'updatedAt': int(time.time() * 1000)},
]

WANT_ACT = ['✏️ 写文案', '🎬 出片台', '📖 教程', '✕']


def boot(p):
    """起浏览器 + 装真扩展（playwright 默认会塞 --disable-extensions，跟 --load-extension 撞，得摘掉）"""
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


def rows_of(page):
    return page.evaluate('''() => Array.from(document.querySelectorAll('#noteArchiveContent .npar-row:not(.npar-head)')).map(r => {
        const cell = (c) => { const e = r.querySelector(c); return e ? e.getBoundingClientRect() : null; };
        const act = cell('.npar-col-act'), ttl = cell('.npar-col-ttl');
        return {
            id: (r.querySelector('[data-id]') || {}).getAttribute ? r.querySelector('[data-id]').getAttribute('data-id') : '',
            act: Array.from(r.querySelectorAll('.npar-col-act .npar-mini')).map(b => b.innerText.trim()),
            peek: (r.querySelector('.npar-col-peek') || {}).innerText || '',
            h: Math.round(r.getBoundingClientRect().height),
            cells: r.querySelectorAll('.npar-cell').length,
            actRight: act ? Math.round(act.right) : 0,
            rowRight: Math.round(r.getBoundingClientRect().right),
            oneLine: ttl ? (Math.round(ttl.height) <= 24) : false,
            detail: r.querySelectorAll('.npar-detail, .npar-copy, .npar-derive').length,
            dim: Array.from(r.querySelectorAll('.npar-col-act .npar-mini')).filter(b => b.classList.contains('npar-dim')).map(b => b.innerText.trim()),
        };
    })''')


with sync_playwright() as p:
    ctx = boot(p)
    sw = ctx.service_workers[0]
    sw.evaluate('''async (notes) => {
        await Storage.initializeDefaults(DEFAULT_PROMPTS);
        await ensureTenantInit();
        // 没配 AI key 时 ensureFirstSetup 会铺一层全屏面板，把档案那些按钮的点全挡住：这里填一个假 key（AI 全程走桩）
        const cfg = await Storage.getConfig();
        cfg.product.name = '档案闸门测试产品';
        cfg.product.sellPoints = [{title: '省时间', content: '把重复步骤压掉'}];
        cfg.ai.apiKey = 'test-local-only';
        cfg.imgLook = null;
        cfg.imgMotifs = [];
        await Storage.setConfig(cfg);
        await chrome.storage.local.set({ np_notes: notes, np_used_topics: [], note_plan: null, xhsFilmDocs: {} });
        self.testAiCalls = 0;
        const orig = AiClient.chatCompletion;
        AiClient.chatCompletion = function () { self.testAiCalls++; return orig.apply(this, arguments); };
        return 1;
    }''', NOTES)
    eid = sw.url.split('/')[2]

    errs = []
    page = ctx.new_page()
    page.set_default_timeout(20000)
    page.on('pageerror', lambda e: errs.append(str(e)))
    goto_big(page, f'chrome-extension://{eid}/popup.html?mode=big')
    page.wait_for_function('typeof switchMainTab === "function" && typeof renderNoteArchive === "function"')
    if page.locator('#firstSetupPanel').count():      # 保险：首次设置面板要是还铺着，点掉它
        page.locator('#fsClose').click()
        page.wait_for_function('() => !document.getElementById("firstSetupPanel")')

    assert page.evaluate('() => editionFeatureOn("videoFilm")'), 'dev 档该全开，出片那颗才该出现'
    page.locator('#tabNotePublish').click()
    page.wait_for_function('() => document.querySelectorAll("#noteArchiveContent .npar-row:not(.npar-head)").length === 3')

    # ── 1) 表格：有表头行、一行一篇、行矮、动作在右边（四颗：写文案 / 出片台 / 教程 / 删除）──
    expect(page.locator('#noteArchiveContent .npar-head')).to_have_count(1)
    head = page.locator('#noteArchiveContent .npar-head').inner_text().replace('\n', ' ')
    for col in ['篇目', '状态', '形式 · 流派', '内容', '时间', '操作']:
        assert col in head, ('表头该摆出这几列：%s' % head)
    rows = rows_of(page)
    byid = {r['id']: r for r in rows}
    assert len(rows) == 3, rows
    for r in rows:
        assert r['act'] == WANT_ACT, ('操作列该是这三颗 + 删除，实际：%r' % (r['act'],), r)
        assert r['cells'] == 7, ('一行七格（缩略图/篇目/状态/形式/内容/时间/操作）：%r' % r)
        assert r['detail'] == 0, ('表里不再铺正文/复制/派生：%r' % r)
        assert r['oneLine'], ('篇目那一格该是单行：%r' % r)
        assert r['actRight'] > r['rowRight'] - 300, ('操作列贴右：%r' % r)
    hs = [byid[i]['h'] for i in ('na', 'nb', 'nc')]
    assert max(hs) <= 56, ('一行一篇：行高别超过 56px（现在是 %s）' % hs)
    assert min(hs) >= 34, ('行高也别塌成一条线：%s' % hs)
    assert page.locator('#noteArchiveContent .npar-out').count() == 0
    assert page.locator('#noteArchiveContent .npar-film').count() == 0
    print('PASS: 档案是表格（表头 + 一行七格），行高 %s px，操作列在右边＝写文案 / 出片台 / 教程 / ✕（旧的造图片·出片台两颗下线）'
          % ' / '.join(map(str, hs)), flush=True)

    # 内容那一格：正文开头截断 + 已出哪些料的记号（不铺开全文）
    pk = {i: byid[i]['peek'].replace('\n', ' ') for i in byid}
    assert '还没成稿' in pk['na'], ('没正文的那篇给一句指路：%r' % pk['na'])
    assert pk['nb'].startswith('第一句是开场钩子') and '…' in pk['nb'], ('内容格该是正文开头截断：%r' % pk['nb'])
    assert '🎨 出图提示词' in pk['nb'] and '🎙' not in pk['nb'], ('这篇只有出图提示词：%r' % pk['nb'])
    assert '🎨 出图提示词' in pk['nc'] and '🎙 口播稿' in pk['nc'], ('料齐的该两个记号都有：%r' % pk['nc'])
    assert '第三段' not in pk['nc'] and '私信我聊' not in pk['nc'], ('只给开头，后面段落不许铺开：%r' % pk['nc'])
    print('PASS: 内容列只给正文开头 + 料记号（%s）' % pk['nc'][:60], flush=True)

    shot = OUT / 'archive-list.png'
    page.screenshot(path=str(shot))
    print('SCREENSHOT:', shot, flush=True)

    # ── 2) 前置闸门：没正文的那篇进不了出片台，缺料时按钮淡但不消失 ──
    def toast_text():
        return page.evaluate('''() => Array.from(document.querySelectorAll('#popToastBox div')).map(x => x.textContent).join(' | ')''')

    def last_toast():
        return page.evaluate('''() => { const a = document.querySelectorAll('#popToastBox div');
            return a.length ? a[a.length - 1].textContent : ''; }''')

    dims = {r['id']: r['dim'] for r in rows}
    assert dims['na'] == ['🎬 出片台'], ('没正文那篇只压暗这一颗：%r' % dims)
    assert dims['nb'] == [] and dims['nc'] == [], ('有正文的两篇不该压暗：%r' % dims)
    tip = page.locator('#noteArchiveContent .npar-task[data-id="na"]').get_attribute('title') or ''
    assert '还没有正文' in tip and '写文案' in tip, ('灰态的 title 要说清缺哪一步：%r' % tip)
    print('PASS: 缺料只压暗那颗（na 出片台淡、nb / nc 不淡），title 写明「还没有正文 → 去写文案」', flush=True)

    page.locator('#noteArchiveContent .npar-task[data-id="na"]').click()
    page.wait_for_function('() => /还没有正文/.test(Array.from(document.querySelectorAll("#popToastBox div")).map(x=>x.textContent).join(" "))')
    assert page.evaluate('() => _npMode') == 'wizard', '拦下时不该跳页'
    assert page.evaluate('() => document.getElementById("noteTaskContent").offsetWidth') == 0, '任务表不该露出来'
    print('PASS: 没正文的点「🎬 出片台」→ 当场说「先定正文」，页面不跳：%s' % last_toast()[:40], flush=True)

    # ── 3) 有正文的那颗进的是那张任务表（不再直接跳造图片）──
    page.locator('#noteArchiveContent .npar-task[data-id="nb"]').click()
    page.wait_for_function('() => _npMode === "task" && !!document.querySelector("#noteTaskContent table")')
    ttxt = page.locator('#noteTaskContent').inner_text()
    assert '🎬 出片台' in ttxt and '📋 全部笔记' in ttxt, ttxt[:120]
    assert page.evaluate('() => npS() && npS().arId') == 'nb'
    assert page.locator('#noteTaskContent .np-task-img').count() == 1, '老档那份 visual 合成一行图活'
    assert '还没划重点' in page.locator('#noteTaskContent .np-task-img').first.locator('xpath=ancestor::tr').inner_text()
    assert page.locator('#noteTaskContent .np-task-film').count() == 0, '图文这一档不该自己冒出片那一行'
    assert page.evaluate('() => document.getElementById("noteOutputContent").offsetWidth') == 0, '这一层不该把造图片页一起摆出来'
    print('PASS: 有正文的点「🎬 出片台」进的是那张任务表（一行＝一个活：这一篇合成出「🖼 出图」那一行，还没划重点）', flush=True)

    # 表上那一行的「🖼 出图」才进造图片：五档横置 tab，出图列表／旧三步都不在这一页
    page.locator('#noteTaskContent .np-task-img').first.click()
    page.wait_for_function('() => _npMode === "out" && document.querySelectorAll("#noteOutputContent .np-imgtab").length === 5')
    assert page.evaluate('() => npS() && npS().arId') == 'nb'
    tabs = page.locator('#npImgTabs .np-imgtab').evaluate_all('els => els.map(x => x.getAttribute("data-t"))')
    assert tabs == ['look', 'cover', 'cut', 'desc', 'preview'], tabs
    assert page.locator('#noteOutputContent .npStepH').count() == 0, '旧那三步的步标题整块下线了'
    assert not page.evaluate('() => !!document.querySelector("#noteOutputContent #npTutoBox")'), '教程已从造图片页搬走'
    assert page.locator('#noteOutputContent #npImgList').count() == 0, '出图列表那一档搬去了任务表'
    assert '← 出片台' in page.locator('#noteOutputContent').inner_text(), '回程那颗跟着那一页改名'
    page.locator('#noteOutputContent .np-out-back').click()
    page.wait_for_function('() => _npMode === "task" && !!document.querySelector("#noteTaskContent table")')
    print('PASS: 「🖼 出图」进造图片五档 %s，顶上那颗「← 出片台」回这张表（出图列表 / 旧三步 / 教程都不在这一页）' % ' → '.join(tabs), flush=True)

    # ── 4) 料齐的那篇：表上那一行「🎬 出片」进得出片台，稿子就是这一篇的口播稿 ──
    page.locator('#tabNotePublish').click()
    page.wait_for_function('() => document.querySelectorAll("#noteArchiveContent .npar-row:not(.npar-head)").length === 3')
    page.locator('#noteArchiveContent .npar-task[data-id="nc"]').click()
    page.wait_for_function('() => _npMode === "task" && !!document.querySelector("#noteTaskContent .np-task-film")')
    frow = page.locator('#noteTaskContent .np-task-film').first.locator('xpath=ancestor::tr').inner_text().replace(' ', '')
    assert 'PPT字体动效' in frow and '还没分幕' in frow, frow
    assert page.evaluate('''() => getComputedStyle(document.querySelector("#noteTaskContent .np-task-film")).opacity''') == '1', \
        '有稿就能本机出的那档不该压暗'
    page.locator('#noteTaskContent .np-task-film').first.click()
    page.wait_for_function('''() => {
        const f = document.getElementById('filmFrame');
        return !!(f && f.contentWindow && f.contentWindow.Film && f.contentWindow.Film.noteId === 'nc');
    }''')
    vf = [f for f in page.frames if 'video.html' in f.url][0]
    assert vf.locator('#script').input_value() == VOICE, '片台里该是这一篇的口播稿'
    print('PASS: 有稿的那篇从表上「🎬 出片」照常开片台（noteId=nc，稿子是它的口播稿，形式跟着这一行）', flush=True)

    # ── 5) 📖 教程：独立一页，换形式只换着看（不落档案、不烧 AI）──
    page.evaluate('() => switchMainTab("noteArchive")')
    page.wait_for_function('() => document.querySelectorAll("#noteArchiveContent .npar-row:not(.npar-head)").length === 3')
    page.locator('#noteArchiveContent .npar-guide[data-id="nb"]').click()
    page.wait_for_function('() => _npMode === "guide" && document.querySelectorAll("#noteGuideContent .npGuide").length === 1')
    assert page.evaluate('() => npS() && npS().arId') == 'nb', page.evaluate('() => npS() && npS().arId')
    assert page.evaluate('() => document.getElementById("noteOutputContent").offsetWidth') == 0, '教程页不该把造图片页一起摆出来'
    assert page.evaluate('() => document.getElementById("notePublishContent").offsetWidth') == 0, '教程页不该把向导摆出来'
    expect(page.locator('#noteGuideContent')).to_contain_text('发布教程')
    page.screenshot(path=str(OUT / 'guide-page.png'))
    print('PASS: 教程独立成一页（按 nb 这篇的图文形式给）', flush=True)

    calls0 = sw.evaluate('() => self.testAiCalls')
    form0 = page.evaluate('''async () => { const d = await chrome.storage.local.get("np_notes"); return (d.np_notes.find(n => n.id === "nb") || {}).form; }''')
    page.locator('#noteGuideContent .npg-path[data-p="video"]').click()
    page.wait_for_function('() => _npOut.path === "video"')
    # 教程条里的胶囊只是换着看（点了才算换一条）：挑一条不是当前那条点
    page.locator('#noteGuideContent .np-guide-pick:not([data-on])').first.click()
    page.wait_for_function('() => !!document.querySelector("#noteGuideContent .np-guide-pick[data-k=\\"card\\"][data-on=\\"1\\"]")')
    assert sw.evaluate('() => self.testAiCalls') == calls0, '教程页换形式不该烧 AI'
    form1 = page.evaluate('''async () => { const d = await chrome.storage.local.get("np_notes"); const n = d.np_notes.find(n => n.id === "nb") || {}; return n.form + '|' + (n.filmKind || ''); }''')
    assert form1 == form0 + '|' == '图文|', ('看教程不该改到档案里的形式：%r→%r' % (form0, form1))
    print('PASS: 教程页换「发哪一种」只换着看（不烧 AI、档案里形式仍是图文）', flush=True)

    page.locator('#noteGuideContent .np-out-back').click()
    page.wait_for_function('() => _npMode === "wizard" && document.querySelectorAll("#noteArchiveContent .npar-row:not(.npar-head)").length === 3')
    print('PASS: 教程页返得回档案（_npMode 掰回 wizard）', flush=True)

    # ── 6) 「✏️ 写文案」把只写了开头那篇灌回向导 ──
    page.locator('#noteArchiveContent .npar-edit[data-id="na"]').click()
    page.wait_for_function('() => _npWiz && _npWiz.arId === "na"')
    assert page.evaluate('() => _npWiz.topics[_npWiz.chosenTopicIdx].topic') == '小红书怎么找客户'
    print('PASS: 「✏️ 写文案」把只写了开头那篇灌回向导（arId=na，话题还在）', flush=True)

    assert not errs, errs
    assert sw.evaluate('() => self.testAiCalls') == calls0, '整场自检不该有一次 AI 调用'
    print('PASS: 无 pageerror、全程零 AI 调用', flush=True)
    ctx.close()
