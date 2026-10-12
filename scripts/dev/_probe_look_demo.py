# -*- coding: utf-8 -*-
"""④ 卡头就地那一层探针（六十五改③：老板「断句和分镜合并——分了段立刻配画面和配文」）。

这一支只管这一层，别处不重复：
  · ④ 卡头那颗「第 m–n 行 ▾」＝就地摊出这一屏那几行 ＋ ③ 屏头同一套旋钮（npSegKnobsHtml），点了当场改结构、零 AI；
  · 屏的边界（sids）与流派落进档案那一行，刷新重开读得回（零重烧）。
注：原「① 小样」那半（出身/流派/主题在卡上的形状层、卡片字号）已随六十六改收口撤下——
    退市契约由 check_note_look.py / check_note_look_gallery.py 守着，这一支不再重复。

跑法：python3 -X utf8 scripts/dev/_probe_look_demo.py
临时 profile 加载真扩展（msedge，headful），全程 AI 走桩；截图：tmp/probe_look_demo.png
"""
import pathlib
import shutil
import sys
import time

from playwright.sync_api import sync_playwright

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / 'extension'
OUT = ROOT / 'tmp'
SHOT = OUT / 'probe_look_demo.png'
ERRORS = []

SENTS = [
    '很多人一上来就对着表格一条条手改，改到半夜还漏了好几处没有对上。',
    '第一步先把要改的东西按类别拆开，桌面上能够一眼看清哪一类最费时间。',
    '第二步拿固定的模板去套，重复出现的那几段直接复用，不用每次重新敲。',
    '第三步让工具自己跑一遍校验，跑完只留给你一小段要人工确认的清单。',
]
BODY = '\n\n'.join(SENTS)
MOTIF = '方案页'
NOTE_ID = 'pd-1'

SEED = r'''async (payload) => {
    await Storage.initializeDefaults(DEFAULT_PROMPTS);
    await ensureTenantInit();
    const cfg = await Storage.getConfig();
    cfg.product.name = '小样探针产品';
    cfg.product.sellPoints = [{title: '省时间', content: '把重复步骤压掉'}];
    cfg.ai.apiKey = 'test-local-only';
    cfg.imgLook = null;
    cfg.imgMotifs = [];
    await Storage.setConfig(cfg);
    await chrome.storage.local.set({
        np_notes: [{id: 'pd-1', title: '省时间三步', status: '待发', platform: 'xhs', form: '图文',
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


def boot(p):
    for i in range(5):
        prof = OUT / ('pdemo-profile%d' % i)
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
    page.set_viewport_size({'width': 1320, 'height': 1080})
    page.goto(sw.url.replace('background.js', 'popup.html?mode=big'))
    page.wait_for_function('() => typeof npSegKnobsHtml === "function" && typeof npShotCardHtml === "function" '
                           '&& typeof npCutLineHtml === "function"')
    page.set_default_timeout(25000)

    def st(expr):
        return page.evaluate('() => (%s)' % expr)

    def burned():
        return sw.evaluate('() => (self.ai || {}).other || []')

    def goto_tab(t):
        page.locator('#npImgTabs .np-imgtab[data-t="%s"]' % t).click()
        page.wait_for_timeout(280)

    def gut_box(n):
        el = page.locator('#npCutWrap .np-cutline').nth(n).locator('.np-cut-gut')
        el.scroll_into_view_if_needed()
        return el.bounding_box()

    def pull(a, b):
        """按住第 a 行行号拖到第 b 行＝这几句圈成一屏（两端坐标分开量：拖的过程中页面自己会滚）"""
        pa = gut_box(a)
        page.mouse.move(pa['x'] + pa['width'] / 2, pa['y'] + pa['height'] / 2)
        page.mouse.down()
        pb = gut_box(b)
        page.mouse.move(pb['x'] + pb['width'] / 2, pb['y'] + pb['height'] / 2, steps=8)
        page.mouse.up()
        page.wait_for_timeout(340)

    def unfold(det):
        """折叠块收着时里面的按钮点不到（Playwright 看不见的元素）：先摊开"""
        if not det.evaluate('e => e.open'):
            det.locator('summary').click()
            page.wait_for_timeout(180)

    # ── 进门：直开这一篇的「🖼 出图」（档案「下一步」to:'img' 走的同一条路；七十改起界面不再有任务表）→
    #          ④ 空态起一套图 → ① 挑「方案页」──
    def enter_out():
        page.evaluate('''async () => {
            const list = await npNotesAll();
            const n = list.find(x => x && x.id === '%s') || null;
            switchMainTab('noteOut', n);
        }''' % NOTE_ID)
        page.wait_for_function('() => _npMode === "out" && !!document.querySelector("#npImgTabs .np-imgtab")')

    enter_out()
    goto_tab('desc')
    page.wait_for_function('() => !!document.querySelector("#npShotTable .np-img-add")')
    page.locator('#npShotTable .np-img-add').click()
    page.wait_for_function('() => (npS().imgDocs || []).length === 1 && !!npS().imgOpen')
    goto_tab('look')
    page.locator('#npLookBox .np-motif[data-k="%s"]' % MOTIF).click()
    page.wait_for_function('(k) => npLookOf(npS()).motif === k', arg=MOTIF)
    enter_out()
    assert burned() == [], '打开这一页不该烧 AI'
    print('PASS: 进门零 AI（④ 空态起一套图 → ① 挑「%s」）' % MOTIF, flush=True)

    # ── ① 小样那半（出身/流派/主题在卡上的形状层、卡片字号）已随六十六改收口整批撤下——
    #     退市契约由 check_note_look.py / check_note_look_gallery.py 守着；这里直接往 ③ 走。 ──

    # ── ③ 立两屏（各两行）：⇩ 才有的可挪 ──
    goto_tab('cut')
    pull(0, 1)
    pull(2, 3)
    page.wait_for_function('() => (npS().shots.items || []).length === 2', timeout=20000)
    assert st('npShotsOn(npS()).length') == 2 and burned() == []
    assert st('npS().shots.items[0].sids.length') == 2 and st('npS().shots.items[1].sids.length') == 2
    print('PASS: ③ 拖行号＝两屏、每屏两行（零 AI）', flush=True)

    # ── ④ 卡头那颗「第 m–n 行 ▾」：摊开＝这一屏那几行 ＋ 同一套屏头旋钮 ──
    goto_tab('desc')
    row1 = page.locator('.np-shot').first
    assert row1.locator('details.np-shot-runs').count() == 1, '卡头该有一颗就地调边界的旋钮'
    row1.locator('details.np-shot-runs summary').click()
    page.wait_for_timeout(220)
    assert row1.locator('details.np-shot-runs').evaluate('e => e.open') is True
    strip = row1.locator('details.np-shot-runs').inner_text()
    for cls, cnt, nm in (('np-shot-key', 1, '🖼／⬜ 占不占图'), ('np-seg-edge[data-d="1"]', 1, '⇩'),
                         ('np-seg-edge[data-d="-1"]', 0, '⇧（第一屏上面没有屏）'),
                         ('np-shot-merge', 0, '⤒ 并上（同上）'), ('np-seg-del', 1, '✕')):
        got = row1.locator('details.np-shot-runs button.' + cls).count()
        assert got == cnt, '就地那排该有 %d 颗 %s，实际 %d：%s' % (cnt, nm, got, strip[:180])
    assert row1.locator('details.np-shot-runs .np-cutline').count() == 2, '这一屏两行就该摆两行'
    assert '整篇哪儿起哪儿止' in strip, strip[:260]
    print('PASS: ④ 卡头就地摊出这一屏那几行（旋钮与 ③ 同一份：🖼 ⇩ ✕，零 AI）', flush=True)

    # ── 就地 ⇩＝把下一屏头一句拉进来：结构当场改，两边同步，正看着那格不塌 ──
    sids_before = st('JSON.stringify(npS().shots.items.map(x => x.sids))')
    row1.locator('details.np-shot-runs .np-seg-edge[data-d="1"]').click()
    page.wait_for_function('() => npS().shots.items[0].sids.length === 3')
    assert st('npS().shots.items[1].sids.length') == 1, '⇩ 该把下一屏头一句拉进这一屏'
    assert st('JSON.stringify(npS().shots.items.map(x => x.sids))') != sids_before
    assert row1.locator('details.np-shot-runs').evaluate('e => e.open') is True, \
        '就地改边界是同一次重画（npCutPaint），正看着那格不该塌回去'
    assert row1.locator('details.np-shot-runs .np-cutline').count() == 3, '摊开那几行跟着变成三行'
    goto_tab('cut')
    head1 = page.locator('#npCutWrap .np-cutseg').first.inner_text().replace(' ', '')
    assert '第1–3行' in head1, '③ 那档的屏头要跟着变（同一份结构，两处一起重画）：%s' % head1
    goto_tab('desc')
    sum1 = page.locator('.np-shot').first.locator('details.np-shot-runs summary').inner_text().replace(' ', '')
    assert '第1–3行▾' in sum1, '④ 卡头那颗跟着报新边界：%s' % sum1
    assert st('npShotsOn(npS()).length') == 2 and burned() == []
    print('PASS: 就地 ⇩ 改边界＝③④ 一起重画（当场不塌、卡头那颗跟着变、零 AI）', flush=True)

    # ── 就地 ⬜＝这一屏不占图：卡上那句指路的话也跟着改 ──
    row2 = page.locator('.np-shot').nth(1)
    unfold(row2.locator('details.np-shot-runs'))
    row2.locator('details.np-shot-runs .np-shot-key').click()
    page.wait_for_function('() => npS().shots.items[1].off === true')
    txt2 = page.locator('.np-shot').nth(1).inner_text().replace(' ', '')
    assert '这一屏不占图（过场话）：不拼提示词、也不压字' in txt2, txt2[:240]
    assert '行▾' in txt2, '不占图那张也该就地能拧回来：%s' % txt2[:220]
    row2 = page.locator('.np-shot').nth(1)
    unfold(row2.locator('details.np-shot-runs'))
    assert row2.locator('details.np-shot-runs .np-shot-key').inner_text() == '⬜', '不占图那张屏头该亮着 ⬜'
    row2.locator('details.np-shot-runs .np-shot-key').click()
    page.wait_for_function('() => npS().shots.items[1].off === false')
    assert st('npShotsOn(npS()).length') == 2 and burned() == [], '就地占不占图来回一次，零 AI'
    print('PASS: 就地 ⬜／🖼＝这一屏占不占图当场改（不占图那张也能就地拧回来，零 AI）', flush=True)

    # ── 落档往返：屏的边界与流派读得回（刷新重开，内存全丢，读数从档案那一行读回） ──
    sids_now = st('JSON.stringify(npS().shots.items.map(x => x.sids))')
    page.evaluate('() => npArchiveFlushTouch()')       # 改边界走防抖回写：刷新前先把这一笔落实
    page.wait_for_timeout(300)
    page.reload()
    page.wait_for_function('() => typeof switchMainTab === "function" && typeof npNotesAll === "function"')
    if page.locator('#firstSetupPanel').count():      # 保险：首次设置面板要是还铺着，点掉它
        page.locator('#fsClose').click()
    enter_out()
    assert st('npLookOf(npS()).motif') == MOTIF, st('npLookOf(npS()).motif')
    assert st('JSON.stringify(npS().shots.items.map(x => x.sids))') == sids_now, '重开这一行屏边界该原样读回'
    assert burned() == [], '重开这一行不该重烧'
    print('PASS: 屏的边界与流派（%s）落进档案，重开读得回（零重烧）' % MOTIF, flush=True)

    goto_tab('desc')
    page.locator('.np-shot').first.screenshot(path=str(SHOT))
    print('PASS: 截图 → %s' % SHOT, flush=True)

    if ERRORS:
        raise AssertionError('页面报错：\n' + '\n'.join(ERRORS[:6]))


if __name__ == '__main__':
    main()
