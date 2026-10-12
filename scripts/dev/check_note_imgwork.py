# -*- coding: utf-8 -*-
"""造图片「页壳五档 + ③ 顶上那格文案 + ⑤ 只有合成视图」自检（老板 2026-10-02 五十七改口径；六十四改② 把 ② 收轻；六十五改把 ★ 选句挪进 ④、③ 退回断句）。

分工（四条自检各管一层，别重叠）：
  · check_note_look.py        ＝ ① 那一档（三类轴 + 配文方式四档 + 账号默认／这一套两层）
  · check_note_cover.py       ＝ ② 封面那一档（两栏／✨ 一发／开关／传图／复制含封面）
  · check_note_cut.py         ＝ ③ 断句台本身（带行号的正文框、按住行号圈屏、✂ 拆 / ✎ 改字）
  · check_note_shots.py       ＝ ④ 那一行两栏卡（左 🖼 造图：分镜＋传图｜右 ✍️ 配文：选句＋档＋字位）
  · 本文件                    ＝ 页壳五档（① / ② / ③ / ④ / ⑤ 一档一块）+ ③ 顶上那格文案（断句的原料）+ ⑤ 只有合成视图

口径（五档：① 🎨 风格 → ② 🖼 封面 → ③ 🎯 断句 → ④ 🖋 分镜 → ⑤ 👀 预览 · 合成视图）：
  1) 进这一页落在工作流当前那一步（npImgLand）：封面那份还没写→②，一屏都还没立→③，缺分镜→④，齐了→⑤
     （① 是旋钮、不作关卡：风格有内置统一小红书打底，没挑过流派也不会被拦在 ①）；旧界面
     （出图列表那一档 / 五档节点条 / 两颗路卡 / 成片形式那排 / 🎙 口播稿那块 / 编号提示词档 / 传图档）一处不留；
  2) 一档只挂一块：站在 ③ 读不到 ④ 的那张表，也不用切来切去把两块都摊开；
  3) ⑤ 顶上那条「✅ 检查这一套」＝零 AI 扫，缺什么一行一条，点那颗跳去对应那一档（不作废料闸门）；
  4) 断句的原料＝③ 顶上那一格（只读）：这一档没单独写过口播稿就先照正文列；正文只有一个编辑口——回「笔记档案」那一行点「继续编辑」，出片台念的还是它；
  5) 正文改过只提醒不拦人：摆「上面那格文案跟下面这些行对不上了」，行不自动重列（一次 AI 都不烧）；
  6) ⟳ 按这份文案重列句子＝句子编号按原文复用：没改过字的那几行还在原来那一屏里，圈好的分组不散；
     改过字那一行换了新号，那屏变成「旧档那份字」摆在底下，点 ⟳ 绑行号对不上就明说、✕ 散掉再重圈；
  7) ⑤ 只有合成视图一个视图：每张卡＝那一屏传回来的干净底图＋npCapPlan 那几行压在你点的『字位』那一格（不占图那屏不进这一套，缺底图写在卡下面那一行）；
     切来切去、回 ④ 都不重烧（旧「只看底图」那颗已撤）；
  8) 一切落进档案那一行的 imgDocs（一行一份），条目级 shots/visual ＝打开那一行；再进来照工作流落在 ④，零重烧。

跑法：python3 -X utf8 scripts/dev/check_note_imgwork.py
临时 profile 加载真扩展（msedge），全程 AI 走桩；这一页这条路一次都不该烧。
"""
import pathlib
import shutil
import struct
import sys
import tempfile
import time
import zlib

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

# 断句的原料：4 句，每句都以句号收（⟳ 重列时本地按标点切，一次 AI 都不烧）
SENTS = [
    '很多人一上来就对着表格一条条手改，改到半夜还漏了好几处没有对上。',
    '第一步先把要改的东西按类别拆开，桌面上能够一眼看清哪一类最费时间。',
    '第二步拿固定的模板去套，重复出现的那几段直接复用，不用每次重新敲。',
    '第三步让工具自己跑一遍校验，跑完只留给你一小段要人工确认的清单。',
]
BODY = '\n\n'.join(SENTS)

# 改过字的那一句（只动两个字）＋ 新写上去的一句：顶上那格改成这份，才验得出「分组散不散」
SENT_2CHANGED = '第一步先把要改的东西按类别拆开，桌面上能一眼看清哪一类最费时间。'
SENT_EXTRA = '跑完当天把那张清单发到群里，第二天早上接着上面继续做。'
NEWTXT = '\n\n'.join([SENTS[0], SENT_2CHANGED, SENTS[2], SENTS[3], SENT_EXTRA])

MOTIF = '方案页'
NOTE_ID = 'iw-1'
NOTES = "async () => (await chrome.storage.local.get('np_notes')).np_notes || []"

SEED = r'''async (payload) => {
    await Storage.initializeDefaults(DEFAULT_PROMPTS);
    await ensureTenantInit();
    const cfg = await Storage.getConfig();
    cfg.product.name = '页壳文案预览测试产品';
    cfg.product.sellPoints = [{title: '省时间', content: '把重复步骤压掉'}];
    cfg.ai.apiKey = 'test-local-only';
    cfg.imgLook = null;
    cfg.imgMotifs = [];
    await Storage.setConfig(cfg);
    await chrome.storage.local.set({
        np_notes: [{id: 'iw-1', title: '省时间三步', status: '待发', platform: 'xhs', form: '图文',
                    draft: payload.body, createdAt: Date.now()}],
        np_assets: [],
    });
    self.ai = {cut: 0, desc: 0};
    self.other = [];
    AiClient.chatCompletion = async (cfg2, system, user) => {
        const sys = String(system || '');
        if (sys.indexOf('你在帮一条') >= 0) { self.ai.cut++; return {content: '{"提名句":[]}'}; }
        if (sys.indexOf('你在改一条') >= 0) { self.ai.desc++; return {content: '{"画面":[]}'}; }
        self.other.push(sys.slice(0, 24));
        return {content: '{"__stub":"这一页不该烧的这一发"}'};
    };
    return true;
}'''


def png(path, w=200, h=260, rgb=(120, 200, 140)):
    """写一张纯色 PNG（只用来验预览那一格读得回素材库的缩略图）"""
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    path.write_bytes(b'\x89PNG\r\n\x1a\n'
                     + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
                     + chunk(b'IDAT', zlib.compress(raw, 6))
                     + chunk(b'IEND', b''))
    return path


def boot(p):
    for i in range(5):
        prof = OUT / ('imgwork-profile%d' % i)
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


def main():
    with sync_playwright() as p:
        ctx = boot(p)
        try:
            run(ctx)
        finally:
            ctx.close()


def run(ctx):
    sw = ctx.service_workers[0]
    assert sw.evaluate('chrome.runtime.onMessage.hasListeners()'), '后台路由没注册上'
    sw.evaluate(SEED, {'body': BODY})

    page = ctx.new_page()
    page.on('pageerror', lambda e: ERRORS.append(str(e)[:220]))
    page.set_viewport_size({'width': 1280, 'height': 980})
    page.goto(sw.url.replace('background.js', 'popup.html?mode=big'))
    page.wait_for_function('typeof switchMainTab === "function" && typeof npImgTabsHtml === "function" '
                           '&& typeof npPreviewHtml === "function" && typeof npCheckHtml === "function"')
    page.set_default_timeout(25000)

    def ai(k):
        return sw.evaluate('() => self.ai.%s' % k)

    def burned():
        return (ai('cut'), ai('desc'))

    def other():
        return sw.evaluate('() => self.other')

    def note(ar_id=NOTE_ID):
        return next((x for x in page.evaluate(NOTES) if x and x.get('id') == ar_id), None)

    def poll(fn, msg, timeout=20.0):
        """涉及 storage 的回写不走页面侧事件：Python 这边轮询"""
        t0 = time.time()
        while time.time() - t0 < timeout:
            v = fn()
            if v:
                return v
            page.wait_for_timeout(250)
        raise AssertionError('等不到：%s' % msg)

    def st(expr):
        return page.evaluate('() => (%s)' % expr)

    def tab_on(t):
        return page.locator('#npImgTabs .np-imgtab[data-t="%s"]' % t)

    def goto_tab(t):
        tab_on(t).click()
        page.wait_for_timeout(260)

    def cur_tab():
        return st('npTabOf(npS())')

    def tab_badge(t):
        return tab_on(t).inner_text().replace(' ', '').replace('\n', '')

    def tabs():
        return page.locator('#npImgTabs .np-imgtab').evaluate_all('els => els.map(x => x.getAttribute("data-t"))')

    def head_text():
        return page.locator('#npImgTabs').inner_text().replace(' ', '')

    def box_text(sel):
        return page.locator(sel).inner_text().replace(' ', '')

    def no_cover():
        """② 那一档点「不出封面」：这一支只管 ③④⑤ 那条路，别拿封面当路障"""
        page.locator('#npCoverBox .np-cover-on[data-v="0"]').click()
        page.wait_for_function('() => npS().shots.cv.on === false')
        page.wait_for_timeout(200)

    def gut_box(i):
        el = page.locator('#npCutWrap .np-cutline').nth(i).locator('.np-cut-gut')
        el.scroll_into_view_if_needed()
        return el.bounding_box()

    def poke(i):
        """点一行没归屏的行号＝这一句自己成一屏（拖行号那条路由 check_note_cut.py 验）"""
        box = gut_box(i)
        page.mouse.click(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
        page.wait_for_timeout(300)

    def leg_fold_open():
        """旧档那份字那一格收在折叠块里（六十五改清理）：要点 ⟳ 绑行号 / ✕ 散掉 得先摊开"""
        d = page.locator('#npCutWrap details').last
        if not d.evaluate('e => e.open'):
            d.locator('summary').click()
            page.wait_for_timeout(200)

    def src_fold_open():
        d = page.locator('#npCutWrap details.np-cutsrc')
        if not d.evaluate('e => e.open'):
            d.locator('summary').click()
            page.wait_for_timeout(200)

    def enter_note_out():
        """直开这一篇的「🖼 出图」（档案那一行「下一步」走的同一条路；七十改：渲染任务表已撤）"""
        page.evaluate('''async () => {
            const list = await npNotesAll();
            const n = list.find(x => x && x.id === '%s') || null;
            switchMainTab('noteOut', n);
        }''' % NOTE_ID)
        page.wait_for_function('() => _npMode === "out" && !!document.querySelector("#npImgTabs .np-imgtab")')

    def open_task():
        enter_note_out()

    def add_row_and_enter():
        """加一行＝④ 分镜 空态那颗「＋ 起一套图」＋ ① 风格 挑流派；加完再进一次这一页（npImgLand 照旧算落档，保住 §1 的 cur_tab()=='cover'）"""
        goto_tab('desc')
        page.wait_for_function('() => !!document.querySelector("#npShotTable .np-img-add")')
        page.locator('#npShotTable .np-img-add').click()
        page.wait_for_function('() => (npS().imgDocs || []).length === 1 && !!npS().imgOpen')
        goto_tab('look')
        page.locator('#npLookBox .np-motif[data-k="%s"]' % MOTIF).click()
        page.wait_for_function('(m) => String(((npS().shots || {}).look || {}).motif || "") === m', arg=MOTIF)
        enter_note_out()

    def enter_row():
        enter_note_out()

    def seg_texts():
        return st('npS().shots.items.map(x => x.text)')

    def pool_n():
        return st('npS().shots.sents.filter(x => !npSentOwner(npS(), x.id)).length')

    # ── 1) 页壳五档：这一行封面那份还没写＝落在 ②；旧界面（出图列表档 / 节点条 / 编号提示词档 / 传图档）一处不留 ──
    open_task()
    add_row_and_enter()
    assert tabs() == ['look', 'cover', 'cut', 'desc', 'preview'], tabs()
    labels = [x.strip() for x in page.locator('#npImgTabs .np-imgtab span:first-child')
              .evaluate_all('els => els.map(x => x.innerText)')]
    assert labels == ['① 🎨 风格', '② 🖼 封面', '③ 🎯 断句', '④ 🖋 分镜', '⑤ 👀 预览 · 合成视图'], labels
    assert cur_tab() == 'cover', '封面那一份提示词还没写＝六十四改② 把 ② 提到 ③ 前面：%s' % cur_tab()
    no_cover()
    goto_tab('cut')
    assert cur_tab() == 'cut'
    assert '现在做的是：' + MOTIF + '（还没断句）' in head_text(), head_text()[:200]
    assert '一行都还没圈' in tab_badge('cut'), tab_badge('cut')
    for t in ('list', 'story', 'prompt', 'upload', 'shots'):
        assert page.locator('#npImgTabs .np-imgtab[data-t="%s"]' % t).count() == 0, '旧的那一档 %s 还在' % t
    for gone in ['#npImgList', '#npNodes', '.np-node', '.np-cutnew', '.np-cutpool', '.np-sent',
                 '.np-shot-move', '.np-seg-take', '.np-seg-only', '.np-path-image', '.np-path-video',
                 '#npVoiceBox', '#npStyleRow', '#npPathCards', '#npResult', '.npStepH', '#npShotStyle',
                 '.np-vis-gen', '.np-shot-split', '.np-shot-text', '.np-shot-form']:
        assert page.locator(gone).count() == 0, '旧界面的 %s 还留在造图片页上' % gone
    assert burned() == (0, 0), '打开这一页不该自己烧 AI'
    print('PASS: 页壳＝五档横置 tab（%s）；出图列表档 / 节点条 / 编号提示词档 / 传图档全撤了' % ' · '.join(labels), flush=True)

    # ── 2) 一档只挂一块：站在 ③ 读不到 ④ 那张表；⑤ 顶上那条检查只指路、点了真跳回 ③ ──
    assert page.locator('#npShotTable').count() == 0 and page.locator('#npLookBox').count() == 0
    assert page.locator('#npCoverBox').count() == 0, '③ 这一档把别的块也摊出来了'
    assert page.locator('.np-shot').count() == 0, '还没立屏就在 ③ 摆出了画面表'
    goto_tab('preview')
    assert cur_tab() == 'preview' and page.locator('#npPreviewBox').count() == 1
    assert page.locator('#npCutWrap').count() == 0, '⑤ 这一档还挂着 ③ 那块'
    chk = box_text('#npPreviewBox')
    assert '✅检查这一套' in chk and '一屏都还没立' in chk, chk[:200]
    assert '去③断句' in chk and '按住第m行行号拖到第n行' in chk, '没屏时检查条给一句指路的话：%s' % chk[:240]
    assert '还没有一屏' in chk, '预览本体在没屏时只摆一句指路的话，不摊一格：%s' % chk[:240]
    assert page.locator('#npPreviewBox .np-imgwall').count() == 0, '⑤ 只有合成视图一个视图（图墙那颗旋钮已撤）'
    assert burned() == (0, 0), '空档切档一次 AI 都不该烧'
    page.locator('#npPreviewBox .np-check-go[data-t="cut"]').click()
    page.wait_for_function('() => npTabOf(npS()) === "cut"')
    assert page.locator('#npCutWrap').count() == 1, '那颗「去 ③ 断句」要真把那块摊出来'
    print('PASS: 一档一块（③ 读不到画面表、⑤ 读不到断句台）；⑤ 顶上那条检查摆「一屏都还没立」，点那颗跳回 ③', flush=True)

    # ── 3) 断句的原料＝③ 顶上那格文案：没写过口播稿先照正文列，冷启动本地列成 4 行、零 AI ──
    assert not st('npS().voice'), '这一档没单独写过口播稿'
    assert st('npImgSourceText(npS())') == BODY, '原料＝正文'
    assert page.locator('#npCutWrap .np-cutline').count() == 4, '进 ③ 已经本地列出 4 行'
    assert '还有4行还没归屏' in box_text('#npCutFrame'), '一屏都还没立＝这四行都摆着「没归屏」'
    src_fold_open()
    cut_src = box_text('#npCutWrap details.np-cutsrc')
    assert page.locator('#npVoiceTa').count() == 1 and page.locator('#npVoiceTa').input_value() == BODY, \
        '那格（折叠块里）摆的就是这一档的正文'
    assert page.locator('#npVoiceTa').evaluate('e => e.hasAttribute("readonly")'), '③ 这一格只读：正文的编辑口收在「笔记档案」那一行'
    assert '回「笔记档案」那一行点「下一步」' in cut_src and '字效编辑器要念的还是它' in cut_src, cut_src[:220]
    assert st('document.getElementById("npSrcStale").hasAttribute("hidden")'), '刚列完行，文案跟行对得上'
    assert burned() == (0, 0), '列句子零 AI'
    print('PASS: ③ 顶上那格＝这一档的正文（没写过口播稿照正文列，本地 4 行、零 AI），③ 这一格只读、写明编辑口在档案那一行', flush=True)

    # ── 4) 屏是一行一句点出来的（这一层的料：一屏一句，后面才看得出重列散不散） ──
    for i in range(4):
        poke(i)
    page.wait_for_function('() => (npS().shots.items || []).length === 4')
    assert seg_texts() == SENTS, '屏文本＝收进来那一句'
    assert st('npS().shots.items.map(x => (x.sids || []).length)') == [1, 1, 1, 1]
    assert st('npS().shots.items.map(x => x.keySid)') == st('npS().shots.items.map(x => x.sids[0])'), \
        '点行号立的屏没在 ④ 另挑过那句，npSegSync 顶的是这一屏头一句'
    assert pool_n() == 0
    assert '4屏都圈好了' in tab_badge('cut'), tab_badge('cut')
    assert '行号都圈好了' in box_text('#npCutBox')
    assert burned() == (0, 0), '立屏不烧 AI'
    print('PASS: 4 行各点成一屏（屏文本由那几句派生、头一句自己顶上、零 AI），档名上写「4 屏都圈好了」', flush=True)

    # ── 5) 正文只有一个编辑口：③ 那格只读；正文改了只亮提醒，不推翻屏、也不自动重列 ──
    assert page.locator('#npCutWrap .np-voice-rv').count() == 0 and page.locator('#npVoiceAsk').count() == 0, \
        '③ 里不再摆「AI 改这一格」那一套（改稿口在「✏️ 写文案」）'
    page.evaluate('(t) => { npS().draft.content = t; return true; }', NEWTXT)   # 相当于在档案那一行把正文改了
    goto_tab('look')
    goto_tab('cut')
    assert st('npImgSourceText(npS())') == NEWTXT, '原料跟着正文走（③ 那格只读，不在这儿改）'
    assert st('!document.getElementById("npSrcStale").hasAttribute("hidden")'), '改过正文要亮提醒'
    stale = page.locator('#npSrcStale').inner_text()
    assert '上面那格文案跟下面这些行对不上了' in stale and '⟳ 按这份文案重列句子' in stale, stale
    assert st('(npS().shots.items || []).length') == 4, '只提醒：已经立好的 4 屏一个字没被推翻'
    assert st('(npS().shots.sents || []).length') == 4, '不跟着正文自动重列（那会把人立好的组打散）'
    assert burned() == (0, 0), '改正文不烧 AI'
    print('PASS: ③ 那格只读（正文编辑口在档案那一行）；正文改了只亮「跟下面这些行对不上了」，屏不推翻、行不重列、零 AI', flush=True)

    # ── 6) ⟳ 按这份文案重列句子：没改过字的还留在原来那一屏，改过字那一行自己掉出来 ──
    before = st('npS().shots.items.map(x => (x.sids || []).slice())')
    page.locator('#npCutWrap .np-cut-relest').click()
    page.wait_for_function('() => (npS().shots.sents || []).length === 5')
    assert st('(npS().shots.items || []).length') == 4, '重列不新增也不吞屏'
    after = st('npS().shots.items.map(x => (x.sids || []).slice())')
    assert [after[0], after[2], after[3]] == [before[0], before[2], before[3]], '没改过字那三屏还是原来那一行'
    assert after[1] == [], '改过字那一行换了新号，那一屏的绑没了'
    assert st('npS().shots.items[1].text') == SENTS[1], '屏里那份旧字留着给人处理，不抹成空'
    leg_fold_open()
    leg = box_text('#npCutBox')
    assert '有1屏还是旧档／手打的那份字' in leg, leg[-400:]
    assert page.locator('#npCutWrap .np-seg-bind').count() == 1 and '⟳绑行号' in leg
    assert pool_n() == 2 and '还有2句还没归屏' in leg, pool_n()
    assert '4屏·2行没归' in tab_badge('cut'), tab_badge('cut')
    assert st('document.getElementById("npSrcStale").hasAttribute("hidden")'), '重列完提醒收掉'
    assert burned() == (0, 0), '⟳ 重列句子是本地按标点切的，一次 AI 都不烧'
    print('PASS: ⟳ 重列＝5 行、立好的三屏没散（掉出来那屏摆在底下「还是旧档那份字」＋ ⟳ 绑行号），提醒收掉、零 AI', flush=True)

    # ── 7) 对不上就明说、散掉再重圈（屏的先后跟着行号排，没有挪位那颗） ──
    leg_id = st('npS().shots.items[1].id')
    leg_fold_open()
    page.locator('#npCutWrap .np-seg-bind[data-id="%s"]' % leg_id).click()
    page.wait_for_timeout(300)
    assert '对不上现在句子里的连着几句' in box_text('#popToastBox'), box_text('#popToastBox')[:160]
    assert st('npS().shots.items[1].sids.length') == 0 and burned() == (0, 0), '对不上不硬绑'

    leg_fold_open()
    page.locator('#npCutWrap .np-seg-del[data-id="%s"]' % leg_id).click()
    page.wait_for_function('() => (npS().shots.items || []).length === 3')
    assert pool_n() == 2, '散掉那一屏不吞行（那两行本来就归在池子里）'
    poke(1)
    poke(4)
    page.wait_for_function('() => (npS().shots.items || []).length === 5')
    assert seg_texts() == [SENTS[0], SENT_2CHANGED, SENTS[2], SENTS[3], SENT_EXTRA], seg_texts()
    assert pool_n() == 0 and '5屏都圈好了' in tab_badge('cut'), tab_badge('cut')
    assert burned() == (0, 0), '散屏 / 重圈全在本地'
    print('PASS: ⟳ 绑行号对不上明说不硬绑 ⟶ ✕ 散掉那一屏 ⟶ 行号重点成屏（5 屏按行号排好），全程零 AI', flush=True)

    # ── 8) ⬜ 最后一屏当过场 + 传回一张图（预览要摆得出的三种格） ──
    last_id = st('npS().shots.items[4].id')
    page.locator('#npCutWrap .np-cutseg[data-id="%s"] .np-shot-key' % last_id).click()
    page.wait_for_function('() => npS().shots.items[4].off === true')
    assert '第5屏·过场' in page.locator('#npCutWrap .np-cutseg').nth(4).inner_text().replace(' ', '')
    cut_foot = box_text('#npCutBox')
    assert '5句·5屏·占图4张' in cut_foot, cut_foot[-260:]
    assert st('npShotsOn(npS()).length') == 4 and burned() == (0, 0)
    print('PASS: ⬜ 那屏标成过场（第 5 屏 · 过场；断句台底下那行跟着报 5 句 · 5 屏 · 占图 4 张）', flush=True)

    f1 = png(OUT / 'imgwork-1.png')
    goto_tab('desc')
    assert page.locator('.np-shot').count() == 5, '④ 那张表一屏一行（含不占图那屏）'
    with page.expect_file_chooser() as fc:
        page.locator('.np-shot').first.locator('.np-shot-up').click()
    fc.value.set_files(str(f1))
    poll(lambda: page.locator('.np-shot-unlink').count() == 1, '这张图挂不上')
    assert burned() == (0, 0)
    print('PASS: 图就在 ④ 那一行最后一格传回来（给预览摆出「有图／缺图／不占图」三种格）', flush=True)

    # ── 9) ⑤ 只有合成视图：每张卡＝那一屏传回来的干净底图＋本地压上去的那一叠字（没有第二个视图）──
    goto_tab('preview')
    page.wait_for_function('() => document.querySelector("#npPreviewBox") && /合成预览/.test(document.querySelector("#npPreviewBox").innerText)')
    head = box_text('#npPreviewBox')
    assert '合成预览（底图＋压字）' in head and '5屏·占图4张·已传回1张' in head, head[:220]
    assert page.locator('#npPreviewBox .np-imgwall').count() == 0, '⑤ 只剩一个视图，那颗「只看底图」的旋钮已撤'
    assert st('npFilmPicks(npS()).length') == 4, '不占图那屏不进这一套（封面这一版关了＝4 张卡）'
    for t in seg_texts()[:4]:
        assert t.replace(' ', '') in head, '每张卡压的就是这一屏定下来的那句：%s' % t
    assert SENT_2CHANGED.replace(' ', '') in head and SENTS[1].replace(' ', '') not in head, \
        '顶上那格改过、重列过之后，卡上压的是改后那一份'
    assert seg_texts()[4].replace(' ', '') not in head, '⬜ 过场那一屏不压字、不摆卡'
    assert page.locator('#npPreviewBox img').count() == 1, '挂上的那张当底图摊在卡上，字压在上面'
    assert '底图没传' in head and '还没传图' not in head, '缺底图的提醒写在卡下面那一行，不压在画面上'
    assert '配图1' in head and '配图4' in head and '配图5' not in head, '编号写在卡下面，过场不编号'
    assert '缺4屏分镜' in head and '跳到第一个缺分镜的屏' in head, '检查条跟预览摆在同一档顶上'

    goto_tab('desc')
    page.wait_for_function('() => npTabOf(npS()) === "desc" && document.querySelectorAll(".np-shot").length === 5')
    goto_tab('preview')
    page.wait_for_function('() => document.querySelector("#npPreviewBox") && /合成预览/.test(document.querySelector("#npPreviewBox").innerText)')
    assert burned() == (0, 0), '预览切来切去一次 AI 都不烧'
    print('PASS: ⑤ 合成视图＝底图＋本地压字（4 张卡、过场不进、缺底图标红），切档零 AI', flush=True)

    # ── 10) 落档：一行一份 imgDocs；再进来照工作流落在 ④，点 ⑤ 读得回，零重烧 ──
    live = st('JSON.parse(JSON.stringify(npS().shots))')   # 切走之后 npS() 就空了，先抄下台上这一份
    open_id = st('npS().imgOpen')
    page.evaluate('() => npArchiveFlushTouch()')
    page.evaluate('() => switchMainTab("noteArchive")')
    row = poll(lambda: (lambda e: e if e and ((e.get('imgDocs') or [{}])[0].get('shots') or {}).get('items') else None)(note()),
               '画面表没落进档案')['imgDocs'][0]
    saved = row['shots']
    assert row.get('id') == open_id, '台上打开的那一行就是落档这一行'
    assert len(saved['sents']) == 5 and len(saved['items']) == 5
    assert [i['text'] for i in saved['items']] == [x['text'] for x in live['items']], '屏文本按台上那份落档'
    assert [i['sids'] for i in saved['items']] == [x['sids'] for x in live['items']], '屏收哪几行要一起落'
    assert [i['keySid'] for i in saved['items']] == [x['keySid'] for x in live['items']], '选定那句（keySid）进档'
    assert all('keyText' not in i for i in saved['items']), 'keyText 是派生物，不进档案'
    assert saved['items'][4]['off'] is True and len(saved['items'][0]['imgs']) == 1
    assert saved['look']['motif'] == MOTIF, '这一行的流派落在自己那一行上'
    assert not saved.get('suggest') and 'cutBusy' not in saved, '台上那份临时状态（提名句／忙旗）不许落档'
    assert note().get('draft') == NEWTXT, '正文那份落的还是这一行的 draft（③ 那格只读，它只在档案里改）'
    assert not note().get('voice'), '③ 不往档案另写一份 voice（正文的编辑口只有档案那一处）'
    assert row['visual'] and '第 1 张' in row['visual']['images'], '那一行的提示词那份是本地拼出来的'
    ent = note()
    assert len((ent.get('shots') or {}).get('items') or []) == 5, '档案条目级那一份＝打开那一行（缺口列与教程读它）'
    assert str((ent.get('visual') or {}).get('images', ''))[:40] == str(row['visual']['images'])[:40]
    base = burned()
    open_task()
    enter_row()
    assert cur_tab() == 'desc', '② 这一版关了、屏也立齐了＝落点往 ④ 分镜 走：%s' % cur_tab()
    assert st('npImgLand(npS())') == 'desc'
    assert st('npS().imgOpen') == open_id, '重进还是打开的那一行'
    assert '现在做的是：' + MOTIF + '（5屏·1/4有图）' in head_text(), head_text()[:220]
    assert '缺4屏分镜' in tab_badge('desc') and '1/4有图' in tab_badge('preview'), (tab_badge('desc'), tab_badge('preview'))
    assert page.locator('#npVoiceTa').count() == 0, '重进不该把 ③ 那块摊出来'
    goto_tab('preview')
    page.wait_for_function('() => document.querySelector("#npPreviewBox") && /合成预览/.test(document.querySelector("#npPreviewBox").innerText)')
    again = box_text('#npPreviewBox')
    assert '5屏·占图4张·已传回1张' in again and SENT_EXTRA.replace(' ', '') not in again, '重进读的还是台上那一份（过场那屏不进合成视图）'
    assert page.locator('#npPreviewBox img').count() == 1, '挂着的图从素材库引用读得回'
    assert burned() == base, '再进来 / 再预览都不重烧'

    assert other() == [], '烧到了不该烧的那一发：%s' % other()[:2]
    assert burned() == (0, 0), '这一页这条路应该一次 AI 都不烧：%s' % (burned(),)
    assert not ERRORS, '有 pageerror：%s' % ERRORS[:2]
    page.screenshot(path=str(OUT / 'imgwork-preview.png'), full_page=True)
    print('PASS: 一行一份落进档案（5 屏收行号 + 选定那句 + 过场 + 挂着的图 + 改过的正文 + 这一行的流派），'
          '再进来落在 ④、点 ⑤ 读得回、全程零 AI', flush=True)
    print('SHOT: %s' % (OUT / 'imgwork-preview.png'), flush=True)


if __name__ == '__main__':
    main()

print('\n全绿：页壳五档（一档一块）+ ③ 顶上那格文案（⟳ 重列不散组）+ ⑤ 只有合成视图（六十五改口径：③ 只管断句、④ 管选句与配文、⑤ 一个视图）', flush=True)
