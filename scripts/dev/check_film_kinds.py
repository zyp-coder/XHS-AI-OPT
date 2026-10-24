# -*- coding: utf-8 -*-
"""出片台「一档一个成片形式」自检（七十改：🎬 渲染任务表撤后按档案「下一步」改口）。

七十改：前端那张「🎬 渲染任务」排活表整页撤了——出片这条链只剩档案那一行：点「下一步」直进字效编辑器
（npArNext → to='film' → npArOpenFilm → npGoFilm；成片形式跟着这一篇自己的 filmKind / filmDocs 走，
不再在表上「＋ 一片」加行）。成片形式的「六选一」盖板留在台子里，靠外壳顶栏（#filmHead）那颗「✏️ 换一种」重开。
（按画面表铺底图 / 段模型那条口径在 check_film_cards.py 里也验一份；这里验形式状态机本身。
 拆墙后台子就落在「发笔记」那一页里：外壳三件（#filmHead 顶栏／#filmSteps 工作流条／#filmFoot 底栏）由外层画，
 台子零件挂 #filmPane 底下，window.Film 直接可驱动；盖板 #filmGate 盖住时那三件一起收。）

跑法：python3 -X utf8 scripts/dev/check_film_kinds.py
临时 profile 加载真扩展（msedge），AiClient 走桩——进站那一路的「提重点」一发＋手动「↻ 重新出一版」一发
（桩返回 '{}'＝提不出重点 → B1 兜底本机规则切幕），这一条链别的都不烧 AI。
  0) 这一篇照 npKFinishFilm 那条真出口落档的形状造好（voice＝正文同文 / form=视频 / filmKind=PPT字体动效 /
     filmDocs 一行）；先照真用法去过一趟「🖼 出图」——换形式那句「稿子还是旧口径」的提示要台上还挂着这一篇
     （prev＝_npOut/_npWiz）才说得出口
  1) 档案那行「下一步」（＝✏️ 编辑 · 进字效）进台子：带的是这一篇的稿（口播稿＝正文同文，有稿不重调）、
     Film.noteId＝档案 id；七十一改起进站一路自动跑（提重点走桩 → '{}' 提不出 → B1 兜底本机规则切幕＋幕栏标注），
     大字画面；稿栏上方那颗「↻ 重新出一版」再走一路，同样兜底
  2) 台子里「✏️ 换一种」→ 六选一盖板重开（两种本机出片 + 四种扩展给料），台子盖住不许接稿
  3) 选「实拍」（不在本机出片）→ 那一档一页：整段文案只读 + 复制 + 去发布台 + 换一种；filmKind 落档、
     不派生卡片口径、文案没被改写（三十七改：教程页已下线，「看教程」那颗换成了「🗓 去发布台」＋原位一句）
  4) 再「换一种」→「卡片画面叙事」：台子露出来、画面切卡片、外壳顶栏记着这一档；这一步只换形式，不许偷偷改稿
  5) 外壳顶栏「← 返回档案」回来：档案那一行形式列跟着这一档
  6) 纯编辑器段模型：一行＝一段底图，长行自动切成多幕共用同图；off 过场行 / 没传回图的行 → 纯色卡
"""
import base64
import io
import os
import pathlib
import shutil
import sys
import time

from PIL import Image
from playwright.sync_api import expect, sync_playwright

from _guide_gate import goto_big

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / 'extension'
OUT = pathlib.Path(os.environ.get('TEMP', '/tmp')) / 'xhs_film_kinds'
OUT.mkdir(parents=True, exist_ok=True)

BODY = '开场钩子。\n\n第一段干货。\n\n第二段干货。\n\n结尾引导。'
VOICE = '一个人做小红书。\n真正管用的就三步。\n私信我，免费测评。'
KIND_TEXT = 'PPT字体动效'
KIND_CARD = '卡片画面叙事'
KIND_LIVE = '实拍'

COLORS = {'a1': (220, 40, 40), 'a2': (40, 200, 60), 'a3': (40, 80, 220)}


def _png(color, size=(160, 120)):
    buf = io.BytesIO()
    Image.new('RGB', size, color).save(buf, 'PNG')
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


SEED = r'''async (payload) => {
    await Storage.initializeDefaults(DEFAULT_PROMPTS);
    await ensureTenantInit();
    const cfg = await Storage.getConfig();
    cfg.product.name = '成片形式测试产品';
    cfg.product.sellPoints = [{title: '省时间', content: '把重复步骤压掉'}];
    cfg.ai.apiKey = 'test-local-only';
    await Storage.setConfig(cfg);
    // 这一篇照 npKFinishFilm 那条真出口落档的形状：voice＝正文同文、视频档、PPT字体动效、filmDocs 一行
    await chrome.storage.local.set({
        np_notes: [
            { id: 'film-1', title: '省时间三步', status: '代发', platform: 'xhs', form: '视频',
              style: '口播讲解', filmKind: 'PPT字体动效',
              draft: payload.body, voice: payload.voice,
              filmDocs: [{ id: 'v1', kind: 'PPT字体动效', key: 'film-1', updatedAt: Date.now() }],
              createdAt: Date.now(), updatedAt: Date.now() },
        ],
        np_assets: [],
        xhsFilmDocs: {},
    });
    self.aiCalls = 0;
    AiClient.chatCompletion = async () => { self.aiCalls++; return { content: '{}' }; };
    return true;
}'''


def boot(p):
    """起浏览器 + 装真扩展（playwright 默认的 --disable-extensions 会跟 --load-extension 撞，摘掉；每趟全新档）"""
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


def wait_toast(page, needle, timeout=8.0):
    """等一条含 needle 的提示（toast 会自己消失，只能守着看）"""
    t0 = time.time()
    last = ''
    while time.time() - t0 < timeout:
        last = page.locator('#popToastBox').inner_text()
        if needle in last:
            return last
        page.wait_for_timeout(120)
    return last


with sync_playwright() as p:
    ctx = boot(p)
    sw = ctx.service_workers[0]
    assert sw.evaluate('chrome.runtime.onMessage.hasListeners()'), '后台路由没注册上'
    sw.evaluate(SEED, {'body': BODY, 'voice': VOICE})
    eid = sw.url.split('/')[2]

    errs = []
    page = ctx.new_page()
    page.set_default_timeout(20000)
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('dialog', lambda d: d.accept())
    goto_big(page, eid)
    page.wait_for_function('() => typeof npGoFilm === "function" && typeof npArOpenFilm === "function"')
    if page.locator('#fsClose').is_visible():
        page.locator('#fsClose').click()

    def next_btn():
        """档案里这一篇那一行「下一步」那颗钮（七十改后出片这条链的唯一入口）"""
        return page.locator('.npar-next[data-id="film-1"]')

    def open_archive():
        """回档案页，等这一篇那一行真画出来——每次切入都重渲染（异步），不能只看节点在不在"""
        page.evaluate('() => switchMainTab("noteArchive")')
        page.wait_for_function('(id) => !!document.querySelector(".npar-next[data-id=\\"" + id + "\\"]")', arg='film-1')

    def open_film():
        """点档案那行「下一步」＝这条链的入口：就地进台子（本机档不铺盖板）"""
        next_btn().click()
        page.wait_for_function('() => document.getElementById("filmContent") && document.getElementById("filmContent").offsetParent !== null', timeout=20000)
        page.wait_for_function('() => document.getElementById("filmGate").style.display === "none"')

    def film_state():
        return page.evaluate('''() => {
            const F = window.Film;
            if (!F) return null;
            return { noteId: String(F.noteId || ''), frame: String((F.cfg || {}).frame || ''),
                     scenes: (F.scenes || []).length, script: String(F.script || ''), scRule: !!F.scRule,
                     cards: (F.scenes || []).map(s => String((s.card || {}).id || '')) };
        }''')

    def rec():
        return page.evaluate('''async () => {
            const d = await chrome.storage.local.get('np_notes');
            const n = (d.np_notes || []).find(x => x && x.id === 'film-1') || {};
            return { filmKind: n.filmKind || '', style: n.style || '', form: n.form || '', voice: n.voice || '' };
        }''')

    def wait_rec(cond, timeout=15.0):
        t0 = time.time()
        r = rec()
        while time.time() - t0 < timeout and not cond(r):
            page.wait_for_timeout(300)
            r = rec()
        return r

    # ── 0) 先照真用法去过一趟「🖼 出图」：换形式那句「稿子还是旧口径」的提示要台上还挂着这一篇才说得出口 ──
    page.evaluate('''async () => {
        const list = await npNotesAll();
        const n = list.find(x => x && x.id === 'film-1') || null;
        switchMainTab('noteOut', n);
    }''')
    page.wait_for_function('() => _npMode === "out" && !!document.querySelector("#npImgTabs .np-imgtab")')

    # ── 1) 档案那行「下一步」→ 进台子：带这一篇的稿，进站一路自动跑到幕（提重点走桩回不出 → 本机兜底） ───────────
    open_archive()
    nx = next_btn()
    assert nx.inner_text().strip() == '✏️ 编辑', '视频档那行的「下一步」该是「✏️ 编辑」：%r' % nx.inner_text()
    tip = nx.get_attribute('title') or ''
    assert '进字效' in tip and '先整口播稿' not in tip, ('口播稿＝正文同文：tip 该指「进字效」，不误报缺稿：%r' % tip)
    row = nx.locator('xpath=ancestor::div[contains(@class,"npar-row")]').inner_text().replace(' ', '')
    assert '成片' in row and KIND_TEXT in row, '档案那一行该标着「成片 · PPT字体动效」：%s' % row
    open_film()
    page.set_viewport_size({'width': 1500, 'height': 900})      # 宽一些：稿栏那颗「↻ 重新出一版」才露在并排那一栏里
    page.wait_for_function('''(id) => {
        const F = window.Film;
        return !!(F && F.noteId === id && String(F.script || '') && F.scenes.length && !F.genBusy);
    }''', arg='film-1', timeout=30000)
    st1 = film_state()
    assert st1['noteId'] == 'film-1', '主行 key＝档案 id：%s' % st1
    assert st1['script'] == VOICE, '台子念的是这一篇的口播稿（有稿不覆盖，进站不重调）：%r' % st1['script']
    assert st1['frame'] == 'text' and st1['scenes'] >= 2 and st1['scRule'], \
        '进站一路自动跑（提重点走桩回不出重点 → 本机规则兜底切幕＋标注）：%s' % st1
    expect(page.locator('#filmHead')).to_contain_text(KIND_TEXT)
    assert sw.evaluate('self.aiCalls') == 1, '进台子这一趟只打「提重点」一发（有稿不重调），不成就兜底：%s' % sw.evaluate('self.aiCalls')

    # 稿栏上方那颗「↻ 重新出一版」：再走一路（提重点走桩 → 兜底重切），幕还在同屏右边
    page.locator('#filmPane #gen').click()
    page.wait_for_function('''() => {
        const F = window.Film;
        return !!(F && F.scenes.length && !F.genBusy);
    }''', timeout=30000)
    st1b = film_state()
    assert st1b['scenes'] >= 2 and st1b['scRule'], '桩提不出重点 → 本机规则兜底切幕并标注：%s' % st1b
    expect(page.locator('#filmPane #scenes .fvnote')).to_contain_text('本机规则')
    assert sw.evaluate('self.aiCalls') == 2, '「↻ 重新出一版」再走一发（提重点不成即兜底）：%s' % sw.evaluate('self.aiCalls')
    print('PASS: 档案那行「下一步」（✏️ 编辑 · 进字效）→ 进台子带这一篇的稿、一路自动到幕（不重调稿）'
          '→ 点「↻ 重新出一版」：一发 AI 不成 → 本机兜底重切 %d 幕（幕栏标「本机规则」）' % st1b['scenes'], flush=True)

    # ── 2) 台子里「✏️ 换一种」→ 六选一盖板重开（2 本机 + 4 给料），台子盖住 ─────────
    page.locator('#filmHead .np-kind-change').click()
    page.wait_for_function('() => getComputedStyle(document.getElementById("filmGate")).display === "block"')
    picks = page.locator('#filmGate .np-kind-pick')
    assert picks.count() == 6, '换一种该重摆六种成片形式：%d' % picks.count()
    txt = [picks.nth(i).inner_text() for i in range(6)]
    local = [i for i in range(6) if '在这台电脑上出片' in txt[i]]
    off = [i for i in range(6) if '扩展给料' in txt[i]]
    assert sorted(local) == [0, 1] and len(off) == 4, (local, off)
    assert KIND_TEXT in txt[0] and KIND_CARD in txt[1], txt[:2]
    assert page.locator('#filmHead').evaluate('el => getComputedStyle(el).display') == 'none', '重选时别露台子'
    print('PASS: 「✏️ 换一种」→ 盖板六张卡重开（%d 项本机出片 + %d 项扩展给料）' % (len(local), len(off)), flush=True)

    # ── 3) 选「实拍」（不在本机出片）→ 那一档一页；filmKind 落档、文案不动 ───────────
    page.evaluate('() => { const b = document.getElementById("popToastBox"); if (b) b.innerHTML = ""; }')
    page.locator('#filmGate .np-kind-pick[data-k="%s"]' % KIND_LIVE).click()
    page.wait_for_function('() => !!document.querySelector("#filmGate .np-film-copy")')
    assert page.locator('#filmGate .np-film-queue').count() == 1 and page.locator('#filmGate .np-kind-change').count() == 1
    assert '去发布台' in page.locator('#filmGate .np-film-queue').inner_text()
    assert '发布台自动排' in page.locator('#filmGate').inner_text(), '原位那句要交代：出完标「代发」，发布台自动排'
    assert page.locator('#filmGate textarea').input_value() == VOICE, '只读那格该是这一篇现在那格文案'
    assert page.locator('#filmHead').evaluate('el => getComputedStyle(el).display') == 'none', '不在本机出片就别露台子'
    r3 = wait_rec(lambda r: r['filmKind'] == KIND_LIVE)
    assert r3['filmKind'] == KIND_LIVE, '成片形式要落进这一篇的档案档：%s' % r3
    assert r3['style'] != '卡片轮播口播', '实拍不派生卡片口径：%s' % r3
    assert r3['voice'] == VOICE, '选形式不许改写那格文案：%r' % r3['voice']
    assert sw.evaluate('self.aiCalls') == 2, '换到实拍不烧 AI（还是进站自动那一路＋手动重出那两发）：%s' % sw.evaluate('self.aiCalls')
    print('PASS: 「换一种」→ 实拍（不在本机出片）：那一档一页（文案只读 + 复制 + 去发布台 + 换一种），filmKind 落档、文案没被改写', flush=True)

    # ── 4) 再换一种 → 卡片画面叙事：台子露出、画面切卡片、文案不许偷偷改写 ────────────
    page.locator('#filmGate .np-kind-change').click()
    page.wait_for_function('() => document.querySelectorAll("#filmGate .np-kind-pick").length === 6')
    page.evaluate('() => { const b = document.getElementById("popToastBox"); if (b) b.innerHTML = ""; }')
    page.locator('#filmGate .np-kind-pick[data-k="%s"]' % KIND_CARD).click()
    page.wait_for_function('''() => {
        const g = document.getElementById('filmGate'), h = document.getElementById('filmHead');
        return getComputedStyle(g).display === "none" && getComputedStyle(h).display === "flex";
    }''')
    page.wait_for_function('''() => {
        const F = window.Film;
        return !!(F && F.cfg.frame === 'card' && F.scenes.length);
    }''', timeout=30000)
    st4 = film_state()
    assert st4['frame'] == 'card' and st4['scenes'] >= 2, st4
    assert st4['script'] == VOICE, '换形式不许顺手改写那格文案：%r' % st4['script']
    bar = page.locator('#filmHead').inner_text()
    assert KIND_CARD in bar and '换一种' in bar, bar
    assert '口播稿还是按' in wait_toast(page, '口播稿还是按'), '换形式该提示稿子还是旧口径那份'
    r4 = wait_rec(lambda r: r['filmKind'] == KIND_CARD)
    assert r4['filmKind'] == KIND_CARD, '成片形式要落进这一篇的档案档：%s' % r4
    assert r4['style'] == '卡片轮播口播', '视频档的写法口径跟着成片形式派生：%s' % r4
    assert sw.evaluate('self.aiCalls') == 2, '换到卡片不烧 AI（还是那两发，换形式不补打）：%s' % sw.evaluate('self.aiCalls')
    print('PASS: 「✏️ 换一种」→ 卡片画面叙事：台子露出 + 画面切卡片 + bar 记着这一档，文案没被改写（只提示去哪改）', flush=True)

    # ── 5) 外壳顶栏「← 返回档案」回档案：那一行形式列跟着换成卡片画面叙事 ─────────────
    #（三十七改：返回钮只留顶栏那一颗，窄条上那颗已撤；拆墙后这颗挂在外层 #filmHead 上）
    page.locator('#filmHead .np-film-archive').click()
    page.wait_for_function('(a) => { const el = document.querySelector(".npar-next[data-id=\\"" + a[0] + "\\"]"); if (!el) return false; '
                           'const row = el.closest(".npar-row"); return !!row && row.innerText.indexOf(a[1]) >= 0; }',
                           arg=['film-1', KIND_CARD], timeout=15000)
    back = next_btn().locator('xpath=ancestor::div[contains(@class,"npar-row")]').inner_text().replace(' ', '')
    assert KIND_CARD in back, '回档案这一行成片形式跟着变成卡片画面叙事：%s' % back
    print('PASS: 编辑器顶栏「← 返回档案」回档案，这一行形式列跟着换成卡片画面叙事', flush=True)

    # ── 6) 纯编辑器段模型：一行＝一段底图，长行切成多幕共用同图；off / 没传回图的行 → 纯色卡 ─
    # 从档案再点一次「下一步」，拿一个就绪的台子（拆墙后 window.Film 就是这一页里的台子）
    open_film()
    page.wait_for_function('''() => {
        const F = window.Film;
        return !!(F && F.cfg.frame === 'card' && F.scenes.length);
    }''', timeout=30000)
    # 素材库备好 a1/a2/a3 三张本机图（段模型里 x1 安 a1、x4 安 a3，才量得出 cardImg）
    page.evaluate('''async (rows) => {
        await chrome.storage.local.set({ np_assets: rows.map(r => ({
            id: r[0], kind: 'local', ref: r[0] + '.png', name: r[0] + '.png',
            thumb: r[1], w: 900, h: 1600, needId: 'n1', addedAt: Date.now(),
        }))});
    }''', [['a1', _png(COLORS['a1'])], ['a2', _png(COLORS['a2'])], ['a3', _png(COLORS['a3'])]])
    rows7 = [
        {'rowId': 'x1', 'no': 1, 'off': False, 'assetIds': ['a1'],
         'text': '第一行的话很长很长：先把痛点讲透，再说到做法，一句一句接得住人，别在没人看的地方使劲。'},
        {'rowId': 'x2', 'no': 0, 'off': True, 'assetIds': [],
         'text': '这是一句过场话，占一幕念出来配纯色卡。'},
        {'rowId': 'x3', 'no': 2, 'off': False, 'assetIds': [],
         'text': '第三行还没传回图，先空着走纯色卡。'},
        {'rowId': 'x4', 'no': 3, 'off': False, 'assetIds': ['a3'],
         'text': '收口一句，私信我测评。'},
    ]
    page.evaluate("""(a) => window.Film.loadNote({ id: 'seg-model', title: '段模型', script: '占位稿', frame: 'card', shots: a })""", rows7)
    page.wait_for_function("""() => { const F = window.Film;
        return F.noteId === 'seg-model' && F.scenes.length && F.scenes[0].cardImg; }""", timeout=20000)
    seg = page.evaluate("""() => ({
        scenes: window.Film.scenes.length,
        keys: window.Film.scenes.map(s => s.cardKey),
        ids: window.Film.scenes.map(s => String((s.card || {}).id || '')),
        runs: window.Film.cardRuns().length,
    })""")
    x1 = [i for i, k in enumerate(seg['keys']) if k == 'shot:x1']
    x2 = [i for i, k in enumerate(seg['keys']) if k == 'shot:x2']
    x3 = [i for i, k in enumerate(seg['keys']) if k == 'shot:x3']
    x4 = [i for i, k in enumerate(seg['keys']) if k == 'shot:x4']
    assert len(x1) >= 2, ('第一行的长话自动切成多幕（做字幕特效）', seg)
    assert all(seg['ids'][i] == 'a1' for i in x1), ('一行＝一段底图：切出的多幕共用同一张图', seg)
    assert seg['scenes'] > len(rows7), ('幕数 > 行数：不是老的「一行一幕」', seg['scenes'], len(rows7))
    assert x2 and all(seg['ids'][i] == '' for i in x2), ('off 过场句占一幕、走纯色卡', seg)
    assert x3 and all(seg['ids'][i] == '' for i in x3), ('没传回图的行走纯色卡（不再退回按素材库顺序铺）', seg)
    assert len(x4) == 1 and seg['ids'][x4[0]] == 'a3', ('按行传回的图安到该段', seg)
    assert seg['runs'] == 4, ('四行＝四段', seg)
    print('PASS: 画面表段模型：长行切 %d 幕共用 a1、off/没传图的行纯色卡、收口行按号安 a3（%d 段）' % (len(x1), seg['runs']), flush=True)

    assert sw.evaluate('self.aiCalls') == 2, '整条链就两发「提重点」走桩（进站一路 + 手动「↻ 重新出一版」，不成即兜底），其余零 AI：%s' % sw.evaluate('self.aiCalls')
    assert not errs, '页面报错：%s' % errs[:3]
    shot = OUT / 'film-kinds.png'
    page.screenshot(path=str(shot))
    print('PASS: 无 pageerror', flush=True)
    print('SCREENSHOT:', shot, flush=True)
    print('\n全绿：出片台一档一个成片形式（档案「下一步」进台 → 带稿、一路自动到幕（兜底）→ 换一种 6 选 1 → 实拍不本机单页 → 卡片画面叙事 → 回档案落档 → 段模型）', flush=True)
    ctx.close()
