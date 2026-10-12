# -*- coding: utf-8 -*-
"""出片台「卡片轮播」自检：底图跟着画面表自动铺 → 画面真的是卡片 → 出一条带配音的 MP4。

七十改：⑤「卡片底图」那一栏整块已撤——底图不再一张张手配，全部跟着「🖼 出图」那张画面表走：
一行＝一段底图，行里的话自动切成几幕（做字幕特效），同段的几幕打同一个 cardKey → 段内不翻卡只换字。

跑法：python3 scripts/dev/check_film_cards.py
  1) ⑤ 栏已不在（右侧只剩两栏；音色 / 风格旋钮收进「⚙ 音色与风格」弹层）；画面旋钮切「卡片轮播」：卡片真的画在画布上（逐像素验，与大字版明显不同）
  2) 画面表通路（Film.buildFromRows + Film.paveRows）：一行＝一段底图、行里的话自动切成几幕；
     off 段 / 还没传回图的段＝纯色卡；段内第二幕开头卡不重翻（逐像素验）
  3) Film.loadScript 带画面表进来（「出图 → 拿去出片」那条真入口）：自动排幕 + 自动铺底图
  4) 真出片：配音桩掉（不联网），H.264 + AAC 走真编码器，落一条 MP4 到 %TEMP%
  5) 大字画面不受影响（两版共用同一份分幕数据，来回切都能出）
  6) 没画面表回退按字数分幕（重分时上一版段底图按序留；刚打开的台子不带段标记）
"""
import base64
import io
import os
import pathlib
import shutil
import sys
import time

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / 'extension'
OUT = pathlib.Path(os.environ.get('TEMP', '/tmp')) / 'xhs_film_cards'
OUT.mkdir(parents=True, exist_ok=True)

SCRIPT = ('一个人做小红书，凌晨还在发笔记。\n'
          '真正管用的就三步：找对人，说对话，在他已经在的地方接住他。\n'
          '私信我，免费给你做一次测评。')


def png_data_url(color, size=(160, 120), band=None):
    """一张一眼能认出来的小图：整块 color，可选中间一条 band（用来验「铺满 + 居中裁」）"""
    im = Image.new('RGB', size, color)
    if band:
        ImageDraw.Draw(im).rectangle([0, size[1] // 2 - 12, size[0], size[1] // 2 + 12], fill=band)
    buf = io.BytesIO()
    im.save(buf, 'PNG')
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


with sync_playwright() as p:
    prof = OUT / 'profile'
    shutil.rmtree(prof, ignore_errors=True)
    ctx = p.chromium.launch_persistent_context(
        str(prof), headless=False, channel='msedge', accept_downloads=True,
        ignore_default_args=['--disable-extensions'],
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    t0 = time.time()
    while time.time() - t0 < 25 and not ctx.service_workers:
        time.sleep(0.3)
    assert ctx.service_workers, '扩展没装起来'
    eid = ctx.service_workers[0].url.split('/')[2]

    page = ctx.new_page()
    page.set_default_timeout(25000)
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    def _con(m):
        if m.type != 'error':
            return
        loc = (m.location or {}).get('url') or ''
        errs.append('[console] ' + m.text + (' @ ' + loc if loc else ''))
    page.on('console', _con)
    page.goto(f'chrome-extension://{eid}/video.html')
    page.wait_for_function('() => window.Film && window.Renderer')

    # 右侧两栏是横置 tab（① 口播稿 / ② 分幕）——⑤ 卡片底图已撤（底图全自动铺）；③ 音色 / ④ 风格
    # 收进「⚙ 音色与风格」弹层（#cfgMask）：要动弹层里的控件（画面旋钮等），先把弹层点开
    def cfg():
        page.click('#cfgBtn')
        page.wait_for_function('() => { const m = document.getElementById("cfgMask"); return !!m && !m.hidden; }')

    assert page.locator('#filmTabs .ftab[data-sec="card"]').count() == 0, '⑤ 卡片底图那一栏该撤了（底图跟着画面表全自动铺）'
    assert page.locator('#cardBody').count() == 0, '⑤ 栏的身子（#cardBody）该整块撤干净'
    assert page.locator('#filmTabs .ftab').count() == 2, '右侧只剩两条横置 tab（口播稿 / 分幕）'
    print('PASS: ⑤ 卡片底图栏整块已不在（右侧只剩两栏），底图全自动铺', flush=True)

    # 素材库先放两条本机图：a1 蓝底黄带、a3 绿底——画面表按 assetIds 认它们（paveRows 读的就是 np_assets）
    page.evaluate('''async (payload) => {
        await chrome.storage.local.set({ np_assets: [
          { id: 'a1', kind: 'local', ref: '门店实拍.png', name: '门店实拍.png',
            thumb: payload.a1, w: 900, h: 1600, needId: 'n1', addedAt: Date.now() },
          { id: 'a3', kind: 'local', ref: '流程图.png', name: '流程图.png',
            thumb: payload.a3, w: 800, h: 1200, needId: 'n1', addedAt: Date.now() },
        ]});
    }''', {'a1': png_data_url((30, 120, 220), band=(255, 220, 0)), 'a3': png_data_url((20, 160, 90))})

    # ① 粘稿 → 分幕（老路子，先拿这份验「卡片 vs 大字」两种画面）
    page.fill('#script', SCRIPT)
    page.click('#gen')
    page.wait_for_function('() => Film.scenes.length >= 3')
    n = page.evaluate('() => Film.scenes.length')
    print('分幕 =', n, flush=True)

    # 采样帮手：把某一幕中间那一帧画到画布上，读几个像素
    SAMPLER = '''(args) => {
        const [i, pts] = args;
        const T = Film.timeline();
        const S = Renderer.buildStyle(Film.cfg);
        const cv = document.getElementById('cv');
        const ctx = cv.getContext('2d', { alpha: false });
        const sc = T.scenes[i];
        const at = sc.start + (sc.end - sc.start) * 0.55;
        Renderer.renderFrame(ctx, at, T, S);
        return pts.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3));
    }'''

    # ② 切成卡片轮播（「⚙ 音色与风格」弹层里的「画面」旋钮）：卡片真的画在画布上（与大字版同一时刻的像素明显不同）
    cfg()
    page.locator('#knobs .chip:has-text("卡片轮播")').first.click()
    page.wait_for_function('() => Film.cfg.frame === "card"')
    page.click('#cfgOk')   # 弹层盖着会挡住后面的「开始出片」——选完收起来
    CARD = page.evaluate('() => Renderer.CARD')
    pts = [[CARD['x'] + 40, CARD['y'] + 60], [540, CARD['y'] + CARD['h'] - 200], [540, 1880]]
    card_px = page.evaluate(SAMPLER, [0, pts])
    page.evaluate('() => { Film.cfg.frame = "text"; }')
    text_px = page.evaluate(SAMPLER, [0, pts])
    page.evaluate('() => { Film.cfg.frame = "card"; }')
    diff = sum(abs(a - b) for pa, pb in zip(card_px, text_px) for a, b in zip(pa, pb))
    assert diff > 60, ('卡片版与大字版该是两种画面', card_px, text_px)
    assert card_px[0][0] > text_px[0][0] + 8, ('纯色卡左上该有块面（主色渐变）', card_px, text_px)
    print('PASS: 切「卡片轮播」后卡片真的画在画布上（与大字版同一时刻的像素明显不同）', flush=True)

    # ③ 画面表通路：一行＝一段底图，行里的话自动切成几幕（做字幕特效）；同段几幕共享 cardKey
    ROWS = [
        {'rowId': 'r1', 'no': 1, 'off': False, 'assetIds': ['a1'],
         'text': '真正管用的就三步：找对人，说对话，在他已经在的地方接住他，别在没人看的地方瞎使劲。'},
        {'rowId': 'r2', 'no': 0, 'off': True, 'assetIds': [],
         'text': '这一段是过场话，占一幕、念出来配纯色卡。'},
        {'rowId': 'r3', 'no': 2, 'off': False, 'assetIds': ['a3'],
         'text': '私信我，免费给你做一次测评。'},
    ]
    page.evaluate('rows => Film.buildFromRows(rows)', ROWS)
    nsc = page.evaluate('() => Film.scenes.length')
    assert nsc > len(ROWS), ('一行里的话要能自动切成多幕（做文字特效）', nsc, len(ROWS))
    keys = page.evaluate('() => Film.scenes.map(s => s.cardKey)')
    assert keys[0] == keys[1] == 'shot:r1', ('第一行＝同一段底图：切出来的两幕共享 cardKey', keys)
    assert 'shot:r2' in keys and 'shot:r3' in keys, ('每一行各成一段', keys)
    runs = page.evaluate('() => Film.cardRuns().map(r => [r.from, r.to])')
    assert len(runs) == 3, ('三行＝三段', runs)
    print('PASS: 画面表 %d 行 → %d 幕（第一行自动切成两幕），三个段 cardKey' % (len(ROWS), nsc), flush=True)

    # 按行铺底图（出图「拿去出片」进来时自动跑的就是这一条）：每段传回来的图安到该段所有幕上
    paved = page.evaluate('async rows => await Film.paveRows(rows)', ROWS)
    assert paved == 3, ('第一行两幕 + 第三行一幕该铺上图（过场句那段不铺）', paved)
    page.wait_for_function('() => Film.scenes.every(s => !s.card || !!s.cardImg || s.cardErr)')
    assert page.evaluate('() => Film.scenes[0].card.id') == 'a1'
    assert page.evaluate('() => Film.scenes[1].card.id') == 'a1', '第一行切出的两幕共用同一张底图'
    assert page.evaluate('() => !Film.scenes[2].card'), '过场句这段走纯色卡（off 不铺图）'
    assert page.evaluate('() => Film.scenes[3].card.id') == 'a3'
    print('PASS: 按画面表铺底图：一行铺一段（第一行两幕同一张 a1），off 段纯色卡', flush=True)

    # 铺在卡上的图：卡上半部分该偏蓝（那张图的主色），下半部分被压暗（白字才压得住）
    px = page.evaluate(SAMPLER, [0, [[540, CARD['y'] + 90], [540, CARD['y'] + CARD['h'] - 150]]])
    top, bot = px
    assert top[2] > top[0] + 20, ('卡上半该是那张蓝图', top)
    assert sum(bot) < sum(top) * 0.75, ('卡下半该被压暗（暗部才压得住白字）', top, bot)
    print('PASS: 底图铺满卡片（上半是图的主色 %s），下半压暗 %s —— 卡上白字有底' % (top, bot), flush=True)

    # 段内第二幕开头：卡不该重新翻进来（还是那张蓝底图铺满——段内不翻卡只换字）
    px = page.evaluate("""
        () => {
            const T = Film.timeline(), S = Renderer.buildStyle(Film.cfg);
            const cv = document.getElementById('cv');
            const ctx = cv.getContext('2d', { alpha: false });
            const sc = T.scenes[1], C = Renderer.CARD;
            Renderer.renderFrame(ctx, sc.start + 0.05, T, S);
            return Array.from(ctx.getImageData(C.x + 60, C.y + 8, 1, 1).data).slice(0, 3);
        }
    """)
    assert px[2] > px[0] + 20, ('一段里的第二幕开头，卡该一直铺着那张图（段内不翻卡）', px)
    print('PASS: 段内第二幕开头卡还铺着那张蓝底图 %s —— 一张图连着几幕，卡不翻只换字' % (px,), flush=True)

    # 整条段走一遍真出片（段内不翻卡走 drawCardScene 的 run 分支，一幕一段那种没覆盖到）
    page.evaluate('''() => {
        Voice.speak = async (scenes, o) => {
            const sr = o.sampleRate || 24000;
            const secs = 1.8;
            const parts = scenes.map(() => new AudioBuffer({ length: Math.round(sr * secs), sampleRate: sr, numberOfChannels: 1 }));
            return { parts, secs: scenes.map(() => secs) };
        };
    }''')
    page.click('#go')
    st = ''
    for _ in range(150):
        page.wait_for_timeout(1000)
        st = page.evaluate('() => document.getElementById("st").textContent')
        if '完成' in st or '失败' in st:
            break
    warn = page.evaluate('() => { const w = document.getElementById("warn"); return w.hidden ? "" : w.textContent; }')
    assert '完成' in st, ('出片该跑通', st, warn)
    info = page.evaluate('''() => Film.lastBlob ? { size: Film.lastBlob.size, name: Film.lastName,
        dur: Film.tl.dur, scenes: Film.tl.scenes.length, runs: Film.cardRuns().length } : null''')
    assert info and info['size'] > 20000 and info['runs'] == 3, info
    b64 = page.evaluate('''async () => {
        const buf = new Uint8Array(await Film.lastBlob.arrayBuffer());
        let s = ''; const CH = 0x8000;
        for (let i = 0; i < buf.length; i += CH) s += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
        return btoa(s);
    }''')
    out = OUT / '卡片轮播出片.mp4'
    out.write_bytes(base64.b64decode(b64))
    head = out.read_bytes()[:12]
    assert b'ftyp' in head, head
    print('PASS: 卡片轮播真出片 = %s（%.1fMB · %.1fs · %d 幕 / %d 段）'
          % (out, info['size'] / 1048576, info['dur'], info['scenes'], info['runs']), flush=True)

    # ④ 大字画面不受影响：切回去还是那条片子能出（同一份分幕数据）
    page.evaluate('() => { Film.cfg.frame = "text"; }')
    page.click('#go')
    st2 = ''
    for _ in range(150):
        page.wait_for_timeout(1000)
        st2 = page.evaluate('() => document.getElementById("st").textContent')
        if '完成' in st2 or '失败' in st2:
            break
    assert '完成' in st2, ('大字版该照样能出', st2, page.evaluate('() => document.getElementById("warn").textContent'))
    assert page.evaluate('() => Film.lastBlob.size') > 20000
    print('PASS: 切回「大字」照样出片（两版共用同一份分幕，来回切都能出）', flush=True)

    # ⑤ 「出图 → 拿去出片」那条真入口：Film.loadScript(稿子, {frame:'card', shots:rows}) 进来就地排幕 + 自动铺底图。
    #    先把台子上现挂的卡清了，逼它走「第一次拿这篇出片」的真铺图路（不是同一篇重进那条认领路）
    page.evaluate('() => { Film.cfg.frame = "card"; Film.scenes.forEach(s => { delete s.card; }); }')
    r = page.evaluate('''(payload) => Film.loadScript(payload.s, { frame: 'card', shots: payload.rows })''',
                      {'s': SCRIPT, 'rows': ROWS})
    assert r == 'ok', r
    page.wait_for_function('''() => { const s = Film.scenes;
        return s.length > 3 && s[0].card && s[0].card.id === "a1" && s[3].card && s[3].card.id === "a3"; }''')
    nk = page.evaluate('() => Film.scenes.map(s => s.cardKey)')
    assert nk[0] == nk[1] == 'shot:r1' and nk[3] == 'shot:r3', nk
    assert page.evaluate('() => !Film.scenes[2].card'), 'off 段仍走纯色卡'
    print('PASS: loadScript 带画面表进来（出图→拿去出片 真入口）＝就地排幕 + 自动铺底图（off 段纯色卡）', flush=True)

    # ⑥ 没带画面表（单开一页粘稿口径）：按字数整体分幕（Scenes.fromScript）。台子上正挂着上一版的，
    #    铺过的段底图＋段标记按序留（和「AI 二发」applyScenes 同一口径；换篇时 dropOtherNoteCards 负责清）
    page.evaluate('''() => Film.loadScript(
        "一个人做小红书，凌晨还在发笔记，三个月过去一个咨询都没有，"
        + "真正管用的就三步：找对人，说对话，在他已经在的地方接住他。", {})''')
    page.wait_for_function('() => Film.scenes.length >= 2')
    assert page.evaluate('() => { const s = Film.scenes[0]; return !!(s.cardKey === "shot:r1" && s.card && s.card.src); }'), \
        '同一台子重分：上一版这一段铺过的底图（和段标记）按序留着'
    # 清台再来＝真正刚打开一页：没有上一版可留，就是普通分幕、一个段标记都不给
    page.evaluate('() => { Film.scenes = []; }')
    page.evaluate('''() => Film.loadScript(
        "一个人做小红书，凌晨还在发笔记，三个月过去一个咨询都没有，"
        + "真正管用的就三步：找对人，说对话，在他已经在的地方接住他。", {})''')
    page.wait_for_function('() => Film.scenes.length >= 2')
    assert page.evaluate('() => Film.scenes.every(s => !s.cardKey)'), '刚打开的台子：没有画面表就是普通分幕（不给段 cardKey）'
    print('PASS: 没带画面表 → 按字数分幕；重分时上一版段底图按序留，刚打开的台子不给段标记', flush=True)

    warn_after = page.evaluate('() => { const w = document.getElementById("warn"); return w.hidden ? "" : w.textContent; }')
    assert not warn_after, ('出片完不该留着红字', warn_after)
    real = [e for e in errs if 'only-title' not in e]
    assert not real, real
    print('PASS: 无 pageerror', flush=True)
    ctx.close()
