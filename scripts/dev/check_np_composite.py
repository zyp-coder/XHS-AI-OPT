# -*- coding: utf-8 -*-
"""造图片「字后压」自检（老板 2026-10-04 口径：「AI 生成 2 个东西，分别是背景图和一段配文的参数……然后我们程序拿着配文参数来重做配文，这样就可以规避 AI 画错字的问题」）。

这一支只管本波那两层，别处不重复：
  · ④ 那一行的配文控件 ＝ 重点三格（变色／加粗／加标识）＋ 字位九宫格（批1b 新加的旋钮）
  · ④ 每行提示词        ＝ 只有「这一块留给字」的留白话，绝不含要压上屏的那几句话（字图分离的硬证）
  · ⑤ 预览              ＝ 合成视图（干净底图＋本地压字）——只有这一个视图：底图本来就摊在卡上，旧的「只看底图」那颗已撤
  · ⑤ 卡上的印记层（#23） ＝ dir k/c 盖「知识/案例」小标、引流不盖；印记三选（文字/传图/不盖）与字位左边还是右边
                           都按 npMarkLayerHtml 画，跟设置页那张 172 宽小样卡（_ntLayoutMarkHtml）同一份几何
  · ② 封面              ＝ 那一句文案 + 一颗字位；提示词里不含那几个字

跑法：python3 -X utf8 scripts/dev/check_np_composite.py
临时 profile 加载真扩展（msedge），全程 AI 走桩；顺带把 ⑤ 那一块截一张图给老板眼看排版：
  tmp/np_composite_preview.png
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
OUT = ROOT / 'tmp'
SHOT = OUT / 'np_composite_preview.png'
ERRORS = []

SENTS = [
    '很多人一上来就对着表格一条条手改，改到半夜还漏了好几处没有对上。',
    '第一步先把要改的东西按类别拆开，桌面上能够一眼看清哪一类最费时间。',
    '第二步拿固定的模板去套，重复出现的那几段直接复用，不用每次重新敲。',
    '第三步让工具自己跑一遍校验，跑完只留给你一小段要人工确认的清单。',
]
BODY = '\n\n'.join(SENTS)
MOTIF = '方案页'
NOTE_ID = 'cp-1'
ACCENT = '#F5A623'

NOTES = "async () => (await chrome.storage.local.get('np_notes')).np_notes || []"

SEED = r'''async (payload) => {
    await Storage.initializeDefaults(DEFAULT_PROMPTS);
    await ensureTenantInit();
    const cfg = await Storage.getConfig();
    cfg.product.name = '字后压测试产品';
    cfg.product.sellPoints = [{title: '省时间', content: '把重复步骤压掉'}];
    cfg.ai.apiKey = 'test-local-only';
    cfg.imgLook = null;
    cfg.imgMotifs = [];
    await Storage.setConfig(cfg);
    await chrome.storage.local.set({
        np_notes: [{id: 'cp-1', title: '省时间三步', status: '待发', platform: 'xhs', form: '图文',
                    draft: payload.body, createdAt: Date.now()}],
        np_assets: [],
    });
    self.ai = {other: []};
    AiClient.chatCompletion = async (cfg2, system, user) => {
        self.ai.other.push(String(system || '').slice(0, 24));
        return {content: '{"__stub":"这一页不该烧的这一发"}'};
    };
    return true;
}'''


def png(path, w=240, h=320):
    """一张斜色块 PNG，当「干净背景图」用（合成视图把它摆满卡，字压在上面看得出对不对）"""
    rows = []
    for y in range(h):
        r = 30 + (y * 200 // max(1, h))
        rows.append(b'\x00' + bytes([r, 24, 90]) * w)
    raw = b''.join(rows)

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    path.write_bytes(b'\x89PNG\r\n\x1a\n'
                     + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
                     + chunk(b'IDAT', zlib.compress(raw, 6))
                     + chunk(b'IEND', b''))
    return path


def boot(p):
    for i in range(5):
        prof = OUT / ('npprobe-profile%d' % i)
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
    OUT.mkdir(exist_ok=True)
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
    page.set_viewport_size({'width': 1320, 'height': 1020})
    page.goto(sw.url.replace('background.js', 'popup.html?mode=big'))
    page.wait_for_function('typeof npPreviewHtml === "function" && typeof npCapPlan === "function" '
                           '&& typeof npFilmPicks === "function"')
    page.set_default_timeout(25000)

    def st(expr):
        return page.evaluate('() => (%s)' % expr)

    def burned():
        return sw.evaluate('() => (self.ai || {}).other || []')

    def goto_tab(t):
        page.locator('#npImgTabs .np-imgtab[data-t="%s"]' % t).click()
        page.wait_for_timeout(280)

    def box_text(sel):
        return page.locator(sel).inner_text().replace(' ', '')

    def poke(i):
        el = page.locator('#npCutWrap .np-cutline').nth(i).locator('.np-cut-gut')
        el.scroll_into_view_if_needed()
        b = el.bounding_box()
        page.mouse.click(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2)
        page.wait_for_timeout(320)

    def poll(fn, msg, timeout=20.0):
        t0 = time.time()
        while time.time() - t0 < timeout:
            if fn():
                return
            page.wait_for_timeout(250)
        raise AssertionError('等不到：%s' % msg)

    # ── 进门：直开这一篇的「🖼 出图」（档案那一行的「下一步」走的同一条路；七十改起界面不再有任务表）→ ④ 空态起一套图 → 挑流派 ──
    page.evaluate('async () => { const l = await npNotesAll(); switchMainTab("noteOut", l.find(x => x && x.id === "%s")); }' % NOTE_ID)
    page.wait_for_function('() => _npMode === "out" && !!document.querySelector("#npImgTabs .np-imgtab") && !!npS() && String(npS().arId) === "%s"' % NOTE_ID)
    goto_tab('desc')
    page.wait_for_function('() => !!document.querySelector("#npShotTable .np-img-add")')
    page.locator('#npShotTable .np-img-add').click()
    page.wait_for_function('() => (npS().imgDocs || []).length === 1 && !!npS().imgOpen')
    goto_tab('look')
    page.locator('#npLookBox .np-motif[data-k="%s"]' % MOTIF).click()
    page.wait_for_function('(m) => String(((npS().shots || {}).look || {}).motif || "") === m', arg=MOTIF)
    page.evaluate('async () => { const l = await npNotesAll(); switchMainTab("noteOut", l.find(x => x && x.id === "%s")); }' % NOTE_ID)
    page.wait_for_function('() => _npMode === "out" && !!document.querySelector("#npImgTabs .np-imgtab")')
    labels = [x.strip() for x in page.locator('#npImgTabs .np-imgtab span:first-child')
              .evaluate_all('els => els.map(x => x.innerText)')]
    assert labels[4] == '⑤ 👀 预览 · 合成视图', labels
    assert burned() == [], '打开这一页不该自己烧 AI'
    print('PASS: 档位条第 ⑤ 档改名「预览 · 合成视图」（%s）' % ' · '.join(labels), flush=True)

    # ── ② 封面：那一句文案 ＋ 一颗字位（这张只有这两样，格子不多铺） ──
    assert st('npTabOf(npS())') == 'cover', '封面那份还没写＝落在 ②'
    page.locator('#npCoverBox .np-cover-copy').fill('手改到半夜，漏的还是那几处')
    page.wait_for_timeout(250)
    assert st('npS().shots.cv.copy') == '手改到半夜，漏的还是那几处'
    assert page.locator('#npCoverBox .np-cap-zone[data-id="cv"]').count() == 9, '② 该有一颗九宫格字位'
    page.locator('#npCoverBox .np-cap-zone[data-id="cv"][data-v="tc"]').click()
    page.wait_for_function('() => npS().shots.cv.cap.zone === "tc"')
    assert page.locator('#npCoverBox .np-cap-in').count() == 0, '封面这张不该展开承接／标注那些格'
    print('PASS: ② 封面＝那一句文案＋字位九宫格（拨到上中，零 AI，别的配文格子这张用不上）', flush=True)

    # ── ③ 立两屏 ──
    goto_tab('cut')
    poke(0)
    poke(1)
    poll(lambda: st('(npS().shots.items || []).length') == 2, '两屏没立起来')
    assert st('npShotsOn(npS()).length') == 2 and burned() == []
    print('PASS: ③ 点两行行号＝两行各占一屏（一屏＝一段＝一张图，零 AI）', flush=True)

    # ── ④ 第一屏：说一次（承接＋重点＋小注＋字位右上）＋传那张干净底图 ──
    goto_tab('desc')
    row1 = page.locator('.np-shot').first
    row1.locator('.np-cap[data-k="say"]').click()
    page.wait_for_function('() => npS().shots.items[0].cap.mode === "say"')
    r1id = st('npS().shots.items[0].id')
    s1 = st('npS().shots.items[0].sids[0]')
    page.locator('.np-key-pick[data-sid="%s"]' % s1).click()
    page.wait_for_function('() => npS().shots.items[0].keySid === "%s"' % s1)
    page.locator('.np-cap-in[data-f="lines"][data-id="%s"]' % r1id).fill('先按类别拆开\n重复的那几段直接复用')
    page.locator('.np-cap-in[data-f="em:hot"][data-id="%s"]' % r1id).fill('漏了好几处')
    page.locator('.np-cap-in[data-f="em:bold"][data-id="%s"]' % r1id).fill('直接复用')
    page.locator('.np-cap-in[data-f="note"][data-id="%s"]' % r1id).fill('效果因人而异')
    page.wait_for_timeout(400)
    page.locator('.np-cap-zone[data-id="%s"][data-v="tr"]' % r1id).click()
    page.wait_for_function('() => npS().shots.items[0].cap.zone === "tr"')
    cap0 = st('JSON.stringify(npS().shots.items[0].cap)')
    assert '"zone":"tr"' in cap0 and '漏了好几处' in cap0 and '直接复用' in cap0, cap0
    f1 = png(OUT / 'npprobe-bg.png')
    with page.expect_file_chooser() as fc:
        row1.locator('.np-shot-up').click()
    fc.value.set_files(str(f1))
    poll(lambda: page.locator('.np-shot-unlink').count() == 1, '这张底图挂不上')

    # ── ④ 第二屏：整段上屏（不填大字，原文整段照排）＋字位左中，不传图 ──
    row2 = page.locator('.np-shot').nth(1)
    row2.locator('.np-cap[data-k="whole"]').click()
    page.wait_for_function('() => npS().shots.items[1].cap.mode === "whole"')
    r2id = st('npS().shots.items[1].id')
    page.locator('.np-cap-zone[data-id="%s"][data-v="ml"]' % r2id).click()
    page.wait_for_timeout(300)
    assert st('npS().shots.items[1].cap.zone') == 'ml'
    print('PASS: ④ 两行配文旋钮拨好（说一次＝承接/重点/小注/字位右上；整段上屏＝只拨字位），底图传回一张', flush=True)

    # ── 字图分离的硬证：提示词里有留白那句、没有要压的那几句话 ──
    prompts = st('npS().shots.items.map((x,i) => npShotPromptText(npS(), x, i, 2))')
    p0, p1 = prompts
    assert '这一屏的字是后压的，你不许画进去' in p0, p0[:200]
    assert '字位＝右上' in p0 and '那一格留干净的底' in p0, p0[:400]
    assert '手改到半夜' not in p0 and '改到半夜' not in p0, '④ 选来压上屏那句（★ 那句）不该进生图提示词'
    assert '很多人一上来就对着表格' not in p0, '选定的那句一个字都不进提示词'
    assert '直接复用' not in p0 and '效果因人而异' not in p0, '承接／小注那几个字也不进提示词'
    assert '干净的背景图' in p1 and '字位＝左中' in p1, p1[:300]
    assert SENTS[1] not in p1, '「整段上屏」那一档的原文也不进提示词'
    print('PASS: 每张提示词只交代「哪一格留干净底」，要压的那几句话一个字都没进（零 AI）', flush=True)

    # ── npCapPlan 的读数：大字顶 ★ 那句、重点认字、整段按语意分行 ──
    plan = st('JSON.stringify(npFilmPicks(npS()))')
    assert '封面' in plan and '"zone":"tc"' in plan and '"zone":"tr"' in plan and '"zone":"ml"' in plan, plan[:300]
    p0plan = st('JSON.stringify(npCapPlan(npS(), npS().shots.items[0]))')
    assert '"t":"big","s":"' + SENTS[0][:8] in p0plan, p0plan[:260]        # 大字＝④ 那屏点中的那句，一字不改
    assert '"t":"line","s":"重复的那几段直接复用"' in p0plan, p0plan[:260]
    assert '"em":[{"w":"漏了好几处","k":"hot"}]' in p0plan, p0plan[:260]      # 大字＝人写那句，重点连字带那一类交出去
    assert '"em":[{"w":"直接复用","k":"bold"}]' in p0plan, p0plan[:260]
    assert '"zone":"tr"' in p0plan and '"note":"效果因人而异"' in p0plan, p0plan[:260]
    whole_rows = st('npCapPlan(npS(), npS().shots.items[1]).rows.map(r => r.s)')
    assert whole_rows == ['第一步先把要改的东西按类别拆开，', '桌面上能够一眼看清哪一类最费时间。'], \
        '整段那一档：长句断在逗号后，别掉出一个只含标点的行 → %s' % whole_rows
    print('PASS: npCapPlan ＝ 这一套要压字的唯一真源（封面 tc／第一屏 tr＋小注／第二屏整段分行）', flush=True)

    # ── ⑤ 合成视图：三张卡（封面 1 ＋ 配图 2），底图＋字层现场拼 ──
    goto_tab('preview')
    page.wait_for_function('() => document.querySelector("#npPreviewBox") && /\\u5408\\u6210\\u9884\\u89c8/.test(document.querySelector("#npPreviewBox").innerText)')
    txt = box_text('#npPreviewBox')
    assert '🖼合成预览（底图＋压字）' in txt, txt[:200]
    n = st('npFilmPicks(npS()).length')
    assert n == 3 and page.locator('#npPreviewBox img').count() == 1, '%s 张卡该只有一张有底图' % n
    html = page.locator('#npPreviewBox').evaluate('e => e.innerHTML')
    assert 'linear-gradient(to bottom left' in html, '右上那一格该压出对应暗角'
    assert 'linear-gradient(to right' in html, '左中那一格该往右让开'
    assert '<span style="color:' + ACCENT + ';font-weight:800;">漏了好几处</span>' in html, '重点那几个字要真被压上强调色（不是一条色条就算）'
    assert '<span style="font-weight:900;">直接复用</span>' in html, '加粗那一类要落在那几个字身上'
    assert '底图没传' in txt and '还没传图' not in txt, '缺图提醒写在卡下面那一行，不压在画面上（卡就是导出的样子）'
    assert '配图1' in txt and '配图2' in txt, '编号写在卡下面'
    assert '整段上屏' in txt and '说一次' in txt and '字位上中' in txt, txt[-320:]
    page.locator('#npPreviewBox').screenshot(path=str(SHOT))
    print('PASS: ⑤ 合成视图＝底图＋本地压字（三张卡、暗角跟着字位、重点上色、缺底图标红）→ 截图 %s' % SHOT, flush=True)

    # ── 印记那层（#23）盖在 ⑤ 卡上：dir k/c 带分类小标、引流不盖；小样卡（172 宽）与这里同一份几何 ──
    pre = st('JSON.stringify({look: ((npS().shots || {}).look || null), dir: String(npS().dir || "")})')
    mark = page.evaluate('''() => {
        const mk = (look, dir) => {
            const cp = JSON.parse(JSON.stringify(npS()));     // 纸上推演：别弄脏台上那份
            cp.dir = dir;
            cp.shots.look = Object.assign({}, (cp.shots || {}).look, look);
            return npCompositeHtml(cp, npFilmPicks(cp)[0], 268, 358);
        };
        const same = (() => {
            const look = {mark: 'text', markText: '试验印记', markPos: 'bl', classify: true};
            const prev = _diagState.imgLook;
            _diagState.imgLook = Object.assign({}, look);
            const small = _ntLayoutMarkHtml();
            _diagState.imgLook = prev;
            return {small: small, big: npMarkLayerHtml(look, 172, 'k')};
        })();
        return {
            k: mk({mark: 'text', markText: '试验印记', classify: true}, 'k'),
            c: mk({mark: 'text', markText: '试验印记', classify: true}, 'c'),
            d: mk({mark: 'text', markText: '试验印记', classify: true}, 'd'),
            none: mk({mark: 'none', classify: false}, 'k'),
            up: mk({mark: 'upload', markImg: 'data:image/png;base64,iVBORw0KGgo='}, 'k'),
            same: same,
        };
    }''')
    assert '试验印记' in mark['k'] and '>知识<' in mark['k'], 'dir＝知识＋分类开：印记条和「知识」小标都该盖上'
    assert '试验印记' in mark['c'] and '>案例<' in mark['c'] and '知识' not in mark['c'], 'dir＝案例：小标换成「案例」：%s' % mark['c'][:200]
    assert '试验印记' in mark['d'] and '知识' not in mark['d'] and '案例' not in mark['d'], '引流（d）：印记照盖、分类小标一个都不盖'
    assert '试验印记' not in mark['none'] and '>知识<' not in mark['none'], '不印记＋不开分类：卡上一个印记层都没有'
    assert 'data:image/png;base64,iVBORw0KGgo=' in mark['up'] and 'width:47px;height:47px' in mark['up'], \
        '传图印记：那张图按 172→268 等比放大贴在卡上：%s' % mark['up'][:300]
    big_n = mark['same']['big'].replace('font-size:9px', 'font-size:8.5px')   # 172 档 px(8.5) 取整成 9：只有字号这一处半像素差
    assert mark['same']['small'] == big_n and mark['same']['big'].count('bottom:44px') == 1, \
        '小样卡（172 宽）与 ⑤ 是同一份几何（印记左下、分类小标摞它上头 44px）：\n%s\n%s' % (mark['same']['small'][:220], mark['same']['big'][:220])
    page.evaluate('''() => { const w = npS();
        w.dir = 'k';
        w.shots.look = Object.assign({}, w.shots.look, {mark: 'text', markText: '试验印记', markPos: 'bl', classify: true});
        npRenderOutput(npActiveC()); return true; }''')
    page.wait_for_function('() => document.getElementById("npPreviewBox").innerHTML.indexOf("试验印记") >= 0')
    live = page.locator('#npPreviewBox').evaluate('e => e.innerHTML')
    assert '>知识<' in live, '⑤ 页面上真的盖出印记＋「知识」小标（不是只算得出来）'
    page.evaluate('''(pre) => { const o = JSON.parse(pre); const w = npS();
        if (o.look === null) { delete w.shots.look; } else { w.shots.look = o.look; }
        w.dir = o.dir;
        npRenderOutput(npActiveC()); return true; }''', pre)
    page.wait_for_function('() => document.getElementById("npPreviewBox").innerHTML.indexOf("试验印记") < 0')
    assert burned() == [], '印记这一整节全是本地画：零 AI'
    print('PASS: 印记那层（#23）盖在 ⑤ 卡上——知识/案例带小标、引流不盖、不印记＝没有这层；小样卡与 ⑤ 同一份几何（零 AI）', flush=True)

    # ── 视图只此一个：旧的「只看底图」那颗已撤（底图本来就摊在卡上）；切档零 AI ──
    assert page.locator('#npPreviewBox .np-imgwall').count() == 0, '⑤ 只剩合成视图一个视图，那颗翻面旋钮该撤了'
    assert burned() == [], '这一整条路一次 AI 都不该烧'
    print('PASS: ⑤ 只有合成视图一个视图（图墙那颗旋钮已撤），切来切去零 AI', flush=True)

    # ── 落档：刷新重开（内存全丢，读数该从档案那一行读回来） ──
    shot = st('JSON.parse(JSON.stringify(npS().shots))')
    page.evaluate('() => npArchiveFlushTouch()')       # 打字后 0.8 秒才回写：刷新前先把这一笔落实
    page.wait_for_timeout(300)
    page.reload()
    page.wait_for_function('typeof switchMainTab === "function" && typeof npNotesAll === "function"')
    if page.locator('#firstSetupPanel').count():      # 保险：首次设置面板要是还铺着，点掉它
        page.locator('#fsClose').click()
    page.evaluate('async () => { const l = await npNotesAll(); switchMainTab("noteOut", l.find(x => x && x.id === "%s")); }' % NOTE_ID)
    page.wait_for_function('() => _npMode === "out" && !!document.querySelector("#npImgTabs .np-imgtab")')
    goto_tab('preview')
    page.wait_for_function('() => document.querySelector("#npPreviewBox") && /\\u5408\\u6210\\u9884\\u89c8/.test(document.querySelector("#npPreviewBox").innerText)')
    again = st('JSON.parse(JSON.stringify(npS().shots))')
    assert again['items'][0]['cap']['zone'] == 'tr' and again['items'][1]['cap']['mode'] == 'whole', again['items'][0]['cap']
    assert again['cv']['cap']['zone'] == 'tc' and again['cv']['copy'] == shot['cv']['copy']
    assert burned() == [], '重开这一行不该重烧'
    print('PASS: 字位／重点／小注落进档案那一行，重开读得回（零重烧）', flush=True)

    if ERRORS:
        raise AssertionError('页面报错：\n' + '\n'.join(ERRORS[:6]))


if __name__ == '__main__':
    main()
