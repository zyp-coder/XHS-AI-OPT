# -*- coding: utf-8 -*-
"""画面流派链路自检（老板 2026-10-02 五十五改立轴；本轮对齐六十四改五档（③ 断句 / ④ 一屏一张卡）＋六十五改字后压＋六十六改 ① 收口）。

口径：
  1) 一行身份＝「平台 × 画面流派」：进出图走档案那行「下一步」，加行＝④ 分镜 空态那颗「＋ 起一套图」、流派在 ① 风格 那排挑
     （七十改：旧的「🎬 出片台」/ 渲染任务表整页已撤），流派记进 shots.look.motif；
     老档没记过 imgDocs＝从档案直接合成一行，旧「出图形式」只留档、不再铺角标，流派不回填、跟着打底那一派算（六十二改：真人工作场景 · 实拍那一挂）；
  2) 两条通道分开走：流派只进 AI 那几发（🔮 提名每屏那句 / 🔁 重出分镜），不进提示词尾巴
     （六十五改字后压：尾巴的令牌只出画面出身与主题两轴，字那一层只写「字位」——字是扩展本地后压的）
     → 换流派不重排提示词、换轴不烧 AI；
  3) 换流派（① 风格 那档的 chip；六十六改：这一排只摆三颗短名单＋「跟账号默认」，自加那派选中时补位一颗亮着）不作废画面表：
     段文本 / 顺序 / ⬜ 不占图 / 传回来的图一律不动，只 toast 提示「分镜还是旧派写的」；
  4) 「🔁 照这一派重出分镜」只重写分镜那几格：手改过的那一格自动带 🔒 并跳过，点掉锁才跟着重出；
     一批 3 段分开烧（6 段没锁 → 两发，5 段没锁 → 3＋2 两发），段文本一个字不许动；每段回的几条收成「候选」挂在那一格里（先用第一条）；
  5) 一行没自己挑过流派＝跟打底那一派走（六十一改：内置统一小红书那一挂），🔁 照样能点、照那一派出分镜，不再摆成灰的；
  6) 造图片这一页只剩五档（① 风格 / ② 封面 / ③ 断句 / ④ 分镜 / ⑤ 预览）。

跑法：python3 -X utf8 scripts/dev/check_note_motif.py
临时 profile 加载真扩展（msedge），全程 AI 走桩、不烧真接口。
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

BODY = ('开场钩子一句。\n\n这句讲第一个卖点。\n\n它后面紧跟一句补充。\n'
        '第二个卖点这一句。\n\n再补一句实证。\n\n收尾这一句。')
SENTS = ['开场钩子一句。', '这句讲第一个卖点。', '它后面紧跟一句补充。',
         '第二个卖点这一句。', '再补一句实证。', '收尾这一句。']

MOTIF_A = '方案页'
MOTIF_B = '手写笔记·纸感'   # 六十六改：① 那排只摆三颗短名单（真人工作场景 / 方案页 / 手写笔记·纸感）＋跟账号默认，换派就从这三颗里点
TOKEN = '扁平矢量插画；浅底＋单色点缀'   # 尾巴令牌（六十五改：只出画面出身＋主题两轴；字那一层只写「字位」）
MOTIF_DEF = '真人工作场景'   # 内置打底那一派（六十二改＝实拍）：账号默认没配流派时，没定过的那一行跟着它
BLOCKS = {'look': '#npLookBox', 'cover': '#npCoverBox', 'cut': '#npCutWrap',
          'desc': '#npShotTable', 'preview': '#npPreviewBox'}

# 老档那一份：只有 items、没句子层，还带着旧的「出图形式」名
LEGACY = [
    {'id': 'old1', 'text': '开场钩子一句。这句讲第一个卖点。', 'desc': '旧派·第一段'},
    {'id': 'old2', 'text': '收尾这一句。', 'desc': '旧派·第二段'},
]

NOTES = "async () => (await chrome.storage.local.get('np_notes')).np_notes || []"

# 桩：🔮 建议断点（系统提示词以「你在帮一条」开头）与 🔁 重出分镜（以「你在改一条」开头）分别接住；
#      重出那一发按用户清单里的段原文回号、描述一律标「新派第几发·第几条」，好让界面侧断言「只有分镜换了」。
SEED = r'''async (payload) => {
    await Storage.initializeDefaults(DEFAULT_PROMPTS);
    await ensureTenantInit();
    const cfg = await Storage.getConfig();
    cfg.product.name = '流派链路测试产品';
    cfg.product.sellPoints = [{title: '省时间', content: '把重复步骤压掉'}];
    cfg.ai.apiKey = 'test-local-only';
    // 账号默认只定两轴与配文方式（辅助标注），故意不配默认流派：没自己挑过的那一行落回内置打底那一派（真人工作场景 · 实拍）
    cfg.imgLook = { born: '扁平矢量插画', theme: '浅底＋单色点缀', cap: 'label' };
    await Storage.setConfig(cfg);
    await chrome.storage.local.set({
        np_notes: [
            {id: 'motif-old', title: '老档那篇', status: '待发', platform: 'xhs', form: '图文',
             style: '清单卡片式', draft: payload.body, createdAt: Date.now() - 1000,
             shots: {style: '', cover: '老档封面', items: payload.legacy},
             visual: {cover: '老档封面', images: '老档那一份拼出来的提示词'}},
            {id: 'motif-new', title: '省时间三步', status: '待发', platform: 'xhs', form: '图文',
             draft: payload.body, createdAt: Date.now()},
        ],
        np_assets: [],
    });
    self.ai = {cut: 0, desc: 0, other: []};
    self.cutSystems = [];
    self.descSystems = [];
    self.descUsers = [];
    const mark = '本段（要写的就是它）：';
    AiClient.chatCompletion = async (cfg2, system, user) => {
        const sys = String(system || ''), usr = String(user || '');
        if (sys.indexOf('你在帮一条') >= 0) {
            self.ai.cut++;
            self.cutSystems.push(sys);
            return {content: '{"断点":[]}'};
        }
        if (sys.indexOf('你在改一条') >= 0) {
            const segs = (usr.match(/^本段（要写的就是它）：(.+)$/gm) || []).map(s => s.slice(mark.length).trim());
            self.ai.desc++;
            self.descSystems.push(sys);
            self.descUsers.push(usr);
            return {content: JSON.stringify({风格: '', 画面: segs.map((t, i) => ({句: t, 分镜: '新派' + self.ai.desc + '-' + (i + 1) + '·' + t}))})};
        }
        self.ai.other.push(sys.slice(0, 24));
        return {content: '{"__stub":"不该烧的这一发"}'};
    };
    return true;
}'''


def boot(p):
    for i in range(5):
        prof = OUT / ('motif-profile%d' % i)
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
    sw.evaluate(SEED, {'body': BODY, 'legacy': LEGACY})

    page = ctx.new_page()
    page.on('pageerror', lambda e: ERRORS.append(str(e)[:220]))
    page.set_viewport_size({'width': 1280, 'height': 980})
    page.goto(sw.url.replace('background.js', 'popup.html?mode=big'))
    page.wait_for_function('typeof switchMainTab === "function" && typeof npDescsRegen === "function" '
                           '&& typeof npLookOf === "function"')
    page.set_default_timeout(25000)

    def ai(k):
        return sw.evaluate('() => self.ai.%s' % k)

    def other():
        return sw.evaluate('() => self.ai.other')

    def st(expr):
        return page.evaluate('() => (%s)' % expr)

    def note(nid):
        return next((x for x in page.evaluate(NOTES) if x and x.get('id') == nid), None)

    def tab(t):
        page.locator('#npImgTabs .np-imgtab[data-t="%s"]' % t).click()
        page.wait_for_function('(b) => !!document.querySelector(b)', arg=BLOCKS[t])

    def to_out(nid, add=False, motif=''):
        """直开这一篇的「🖼 出图」（档案那一行「下一步」走的同一条路；七十改：渲染任务表已撤）。
        跨篇切换时先看到的还是上一篇那份：得等这一篇真上台（_npOut.arId 换成它）再往下走，不然断言读的是上一篇的。
        加行＝④ 分镜 空态那颗「＋ 起一套图」＋ ① 挑流派，加完再进一次这一页（npImgLand 照旧算落档）。"""
        def enter():
            page.evaluate('''async (id) => {
                const list = await npNotesAll();
                const n = list.find(x => x && x.id === id) || null;
                switchMainTab('noteOut', n);
            }''', nid)
            page.wait_for_function('''() => _npMode === "out" && !!document.querySelector("#npImgTabs .np-imgtab")
                && !!npS() && String(npS().arId) === "%s"''' % nid)
        enter()
        keys = page.locator('#npImgTabs .np-imgtab').evaluate_all('els => els.map(x => x.getAttribute("data-t"))')
        assert keys == ['look', 'cover', 'cut', 'desc', 'preview'], '造图片只剩五档：%s' % keys
        if add:
            tab('desc')
            page.wait_for_function('() => !!document.querySelector("#npShotTable .np-img-add")')
            page.locator('#npShotTable .np-img-add').click()
            page.wait_for_function('() => (npS().imgDocs || []).length === 1 && !!npS().imgOpen')
            assert page.evaluate('() => _npMode') == 'out', '加行＝就地多一行图，不跳页'
            if motif:
                tab('look')
                page.locator('#npLookBox .np-motif[data-k="%s"]' % motif).click()
                page.wait_for_function('(m) => String(((npS().shots || {}).look || {}).motif || "") === m', arg=motif)
            enter()

    def gut_box(n):
        return page.locator('#npCutWrap .np-cutline').nth(n).locator('.np-cut-gut').bounding_box()

    def pout(i=0):
        """④ 那一格提示词的真读口：它在 <details> 里（默认收起），textContent 不受收起影响"""
        return page.locator('.np-shot-pout').nth(i).evaluate('(el) => el.textContent')

    def one_seg_per_line():
        """按住行号、就地在每一行上松手＝一行一段"""
        n = page.locator('#npCutWrap .np-cutline').count()
        for k in range(n):
            b = gut_box(k)
            page.mouse.move(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2)
            page.mouse.down()
            page.mouse.move(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2 + 3, steps=2)
            page.mouse.up()
            page.wait_for_function('(n) => (npS().shots.items || []).length === n', arg=k + 1)
        return n

    def texts():
        return page.evaluate('() => npS().shots.items.map(x => x.text)')

    def descs():
        return page.evaluate('() => npS().shots.items.map(x => x.desc)')

    def regen():
        return page.locator('#npShotTable .np-desc-regen')

    # 桩的计数在后台 service worker 里、界面状态在页面上：两边一起轮询到落定
    def until(key, least, expr=None, secs=25):
        t0 = time.time()
        while time.time() - t0 < secs:
            if key is None or sw.evaluate('() => self.ai.%s >= %s' % (key, least)):
                if expr is None or page.evaluate('() => (%s)' % expr):
                    return
            page.wait_for_timeout(250)
        raise AssertionError('等不到 %s>=%s / %s' % (key, least, expr))

    # ══ A) 老档：从档案那行进这一页（旧形式只留档、流派跟着打底那一派），🔁 照着打底那派就能点 ══
    to_out('motif-old')
    assert ai('cut') == 0 and ai('desc') == 0, '进这一页不该自己烧 AI'
    assert st('npLookOf(npS()).motif') == MOTIF_DEF, '老行没自己挑过流派＝跟着打底那一派：%s' % st('npLookOf(npS()).motif')
    assert st('npLookOwn(npS(), "motif")') is False, '这一行没自定过流派（旧「出图形式」不回填成新轴）'
    assert st('npS().uiTab') == 'cover', '这一行有段、分镜也不空，可封面那一张还没定画面＝落在 ②：%s' % st('npS().uiTab')
    page.locator('#npCoverBox .np-cover-on[data-v="0"]').click()
    page.wait_for_function('() => npS().shots.cv.on === false')
    assert st('npImgLand(npS())') == 'preview', '点了「不出封面」才往 ⑤ 预览 走：%s' % st('npImgLand(npS())')
    assert MOTIF_DEF in page.locator('#npImgTabs .np-imgtab[data-t="look"]').inner_text(), '档名上说清这一套跟着打底那一派：%s' % \
        page.locator('#npImgTabs .np-imgtab[data-t="look"]').inner_text()
    tab('desc')
    assert page.locator('.np-shot').count() == 2, '老档那两段照原样摆出来（不替人重切）'
    assert regen().count() == 1 and not regen().first.is_disabled(), '没自己挑过流派也有打底那一派可照，🔁 不该摆成灰的骗人'
    assert MOTIF_DEF in page.locator('#npRegenBar').inner_text(), '表头那句要说清照的是哪一派'
    print('PASS: 老档从档案那行进这一页（旧形式不再铺角标、流派跟着打底那派）；🔁 照打底那派直接能点，零 AI', flush=True)

    # ── A2) 在 ① 风格 那一档给这一行挑一派：只记下新派，那两段的字与分镜一个没动 ──
    tab('look')
    page.locator('#npLookBox .np-motif[data-k="%s"]' % MOTIF_A).click()
    page.wait_for_function('() => npLookOf(npS()).motif === "%s"' % MOTIF_A)
    assert ai('cut') == 0 and ai('desc') == 0, '挑流派只是记下这一行的身份：%s' % other()
    tab('desc')
    assert texts() == [x['text'] for x in LEGACY], '换派不许重排画面表'
    assert descs() == [x['desc'] for x in LEGACY], '换派不重写分镜（那是 🔁 的活）'
    p0 = pout(0)
    assert MOTIF_A not in p0, '流派不进提示词尾巴（尾巴令牌只出画面出身与主题两轴）'
    assert '每一张都带的固定元素：' + TOKEN in p0, p0[-240:]
    to_out('motif-old')
    assert st('npLookOf(npS()).motif') == MOTIF_A, '挑的新派跟着这一行（再进来还是它）'
    assert st('npLookOwn(npS(), "motif")') is True, '这一行从「跟打底」变成「自己定过」'
    print('PASS: ① 风格 挑一派＝只记下新派（零 AI、段与分镜不动、尾巴不带流派名、再进来还是它）', flush=True)

    # ── A3) 🔁 照这一派重写这一行：2 段＝一批一发，只有分镜换，段文本不动、关掉的封面也不起画面 ──
    tab('desc')
    regen().first.click()
    until('desc', 1, 'npS().shots.items[0].desc.indexOf("新派") === 0')
    d = descs()
    assert all(x.startswith('新派1-') for x in d), d
    assert texts() == [x['text'] for x in LEGACY], '🔁 只换分镜，段原文一个字不动'
    assert ai('desc') == 1, '2 段一批一发：%s' % ai('desc')
    assert 'cover' not in st('Object.keys(npS().shots)'), \
        '老档那个 shots.cover 字符串字段已作废：② 封面读的是 shots.cv 那一份形的画面（%s）' % st('Object.keys(npS().shots)')
    assert st('npS().shots.cv.on') is False and st('npS().visual.cover') == '', \
        '这一支在 A) 关过封面＝🔁 不替人重开、也不给它现拼提示词（封面那份归 ② 自己管）'
    sys_a = sw.evaluate('() => self.descSystems[0]')
    assert '【本次画面流派】' + MOTIF_A in sys_a, '那一发要带这一派的名字'
    assert '【这一套图的取材路子】' in sys_a and '· 长什么样' in sys_a and '这样算不合格' in sys_a, '取材规则三句一起喂'
    assert '你在改一条' in sys_a and '一个字都别改' in sys_a and '段已经切好了' in sys_a
    usr_a = sw.evaluate('() => self.descUsers[0]')
    assert '【整篇原文' in usr_a and '前一段：（这就是第一张）' in usr_a and '【画面尺寸】' in usr_a, usr_a[:200]
    print('PASS: 🔁 只重写分镜那一列（段文本一字不动、老档那个 shots.cover 字符串字段作废、关掉的封面不重开），那一发带着流派名与三句取材规则', flush=True)

    # ══ B) 新档：④ 空态那颗「＋ 起一套图」→ ① 挑一派 → 行号一行一段 → 🔮 按这一派发 → 🔁 一批 3 段 ══
    to_out('motif-new')
    assert st('(npS().imgDocs || []).length') == 0 and not st('npS().imgOpen'), '新档还没有一行图'
    tab('desc')
    assert '还没有一行图' in page.locator('#npShotTable').inner_text(), \
        '④ 空态先说清，再给那颗加行按钮：%s' % page.locator('#npShotTable').inner_text()[:120]
    to_out('motif-new', add=True, motif=MOTIF_A)
    assert ai('cut') == 0 and ai('desc') == 1, '加一行一次 AI 都不烧'
    assert MOTIF_A in page.locator('#npImgTabs .np-imgtab[data-t="look"]').inner_text(), '① 档名＝刚挑的这一派'
    assert st('npS().uiTab') == 'cover', '刚加的一行：封面那一份还没写＝先落在 ②：%s' % st('npS().uiTab')
    page.locator('#npCoverBox .np-cover-on[data-v="0"]').click()
    page.wait_for_function('() => npS().shots.cv.on === false')
    assert st('npImgLand(npS())') == 'cut', '点了「不出封面」才往 ③ 划重点 走：%s' % st('npImgLand(npS())')
    assert st('npLookOf(npS()).motif') == MOTIF_A, '这一行的身份落在 shots.look.motif 上'
    assert st('(npS().shots.items || []).length') == 0
    tab('cut')
    assert page.locator('#npCutWrap .np-cutline').count() == 6, '零 AI 把文案列成一行一句'
    assert one_seg_per_line() == 6
    assert ai('cut') == 0 and ai('desc') == 1, '拖行号成段不烧 AI：%s / %s' % (ai('cut'), ai('desc'))
    assert texts() == SENTS
    tab('desc')
    assert MOTIF_A not in pout(0), '流派不进尾巴（令牌只出画面出身与主题两轴）'
    print('PASS: ④ 空态那颗「＋ 起一套图」零 AI 加一行 → ① 挑流派 → 行号上就地拖出 6 屏，尾巴令牌仍只有两轴', flush=True)

    # ── B2) 🔮 那一发按这一派取材（流派走的就是这一发；六十五改：那颗挂在 ④ 的表头）──
    tab('desc')
    page.locator('.np-cut-suggest').click()
    until('cut', 1)
    sys_c = sw.evaluate('() => self.cutSystems[0]')
    assert '【本次画面流派】' + MOTIF_A in sys_c, '挑句那一发要带这一派的名字'
    assert '【这一套图的取材路子】' in sys_c and '客户没定' not in sys_c, '定了流派就不该走「客户没定」那条兜底'
    assert '这段文案要变成这一派的什么料' in sys_c, '转译配方也在这一发里'
    assert '配文方式' in sys_c and '这一档的字位很紧' in sys_c, '账号默认那一档「辅助标注」要当容量喂进去'
    assert TOKEN in sys_c, '两轴令牌只当「长这样」附带一句，别让它发明风格'
    assert '别自己发明风格' in sys_c
    print('PASS: 🔮 那一发带着流派名 + 取材三句 + 配文方式那一档的容量（流派走 AI 通道，两轴令牌与配文档只当背景）', flush=True)

    # ── B3) 先照这一派出一次分镜：6 段没锁＝一批 3 段、两发 ──
    tab('desc')
    regen().first.click()
    until('desc', 3, 'npS().shots.items[5].desc.indexOf("新派3-") === 0')
    assert ai('desc') == 3, '6 段＝一批 3 段、两发：%s' % ai('desc')
    assert descs()[:3] and all(x.startswith('新派2-') for x in descs()[:3]), descs()
    assert all(x.startswith('新派3-') for x in descs()[3:]), descs()
    base_texts = texts()
    assert base_texts == SENTS, '🔁 只换分镜，段原文一个字不动'
    print('PASS: 🔁 一批 3 段：6 段没锁拆成两发（新派2- 三段 / 新派3- 三段）', flush=True)

    # ── B4) 换这一套的流派：不作废表，只提示分镜还是旧派写的 ──
    desc_before, text_before = descs(), texts()
    # ── B4) 换这一套的流派：不作废表，只提示分镜还是旧派写的 ──
    desc_before, text_before = descs(), texts()
    pout_before = pout(0)                       # 换派前的提示词（尾巴里本就不带流派名）
    tab('look')
    page.locator('#npLookBox .np-motif[data-k="%s"]' % MOTIF_B).click()
    page.wait_for_function('() => npLookOf(npS()).motif === "%s"' % MOTIF_B)
    # toast 只活 2.2 秒：趁热立刻读（读 textContent，不受透明度过渡影响）
    page.wait_for_function('() => { const b = document.getElementById("popToastBox"); return !!b && b.textContent.indexOf("分镜还是旧派写的") >= 0; }', timeout=5000)
    assert ai('cut') == 1 and ai('desc') == 3, '换流派不该烧 AI：%s / %s' % (ai('cut'), ai('desc'))
    tab('desc')
    assert descs() == desc_before and texts() == text_before, '换派只记下新派，旧分镜留着等人重出'
    assert pout(0) == pout_before, '换派不重排提示词'
    print('PASS: 换流派＝只记下新派（零 AI、段与分镜不动、提示词不重排），并当场提示要点 🔁', flush=True)

    # ── B5) 手改过的那一格自动带 🔒；🔁 只重出没锁的（5 段＝3＋2 两发）──
    page.locator('.np-shot').first.locator('.np-shot-desc').fill('这一张要证明：这一格我自己写过')
    page.wait_for_function('() => npS().shots.items[0].dlock === true')
    assert page.locator('.np-shot').first.locator('.np-shot-lock').count() == 1, '锁要当场挂上，别等整页重画'
    assert '1 屏带 🔒 手改' in page.locator('#npRegenBar').inner_text()
    regen().first.click()
    until('desc', 5, 'npS().shots.items[5].desc.indexOf("新派5-") === 0')
    d = descs()
    assert d[0] == '这一张要证明：这一格我自己写过', '带 🔒 的那一格不许被 🔁 覆盖'
    assert all(x.startswith('新派4-') for x in d[1:4]), d
    assert all(x.startswith('新派5-') for x in d[4:]), d
    assert ai('desc') == 5, '没锁的 5 段＝一批 3 段、两发（3＋2）：%s' % ai('desc')
    assert texts() == text_before, '🔁 只换分镜，段原文一个字不动'
    assert st('npS().shots.items[0].dlock') is True, '跳过的那一格还带着锁'
    print('PASS: 🔁 只重出没锁的 5 屏（3＋2 两发、带 🔒 那一格跳过、段原文一字没动）', flush=True)

    # ── B6) 点掉锁 → 那一格也归 🔁 管；6 段没锁 → 再拆两批（3＋3），一次不多烧 ──
    page.locator('.np-shot').first.locator('.np-shot-lock').click()
    page.wait_for_function('() => npS().shots.items[0].dlock === false')
    assert page.locator('.np-shot').first.locator('.np-shot-lock').count() == 0
    regen().first.click()
    until('desc', 7, 'npS().shots.items[5].desc.indexOf("新派7-") === 0')
    assert ai('desc') == 7, '6 屏没锁＝一批 3 屏、两发：%s' % ai('desc')
    assert all(x.startswith('新派6-') for x in descs()[:3]), descs()
    assert all(x.startswith('新派7-') for x in descs()[3:]), descs()
    assert texts() == text_before
    assert other() == [], '断句 / 分镜之外那一发压根不该响：%s' % other()
    print('PASS: 点掉锁那一格就跟着重出；6 段没锁拆成两批（3＋3），一次不多烧', flush=True)

    # ══ C) 落档：流派随这一行走，从档案再进来读得回、零 AI ══
    page.wait_for_timeout(700)
    got = None
    t0 = time.time()
    while time.time() - t0 < 15:
        got = (note('motif-new') or {}).get('imgDocs')
        if got:
            break
        page.wait_for_timeout(300)
    assert got and len(got) == 1, got
    assert got[0]['shots']['look']['motif'] == MOTIF_B, '流派随这一行落档'
    assert got[0].get('style') == '', '新行不写旧的「出图形式」'
    assert len(got[0]['shots']['items']) == 6 and (got[0]['shots']['items'][0].get('sids') or []), '拖好的分组一起进档'
    assert '第 1 张' in got[0]['visual']['images'], '条目级 visual 还是打开那一行的镜像'
    old = (note('motif-old') or {}).get('imgDocs') or []
    assert len(old) == 1 and old[0]['shots']['look']['motif'] == MOTIF_A, '老行挑上的那一派记在老行自己身上'
    assert old[0].get('style') == '清单卡片式', '老档那格旧形式原样留着（不回填、也不被新行盖掉）'

    before = (ai('cut'), ai('desc'))
    to_out('motif-old')          # 先换一篇＝逼 _npOut 撒手这次缓存
    to_out('motif-new')          # 再进来＝这一篇整份从档案重载（npOutReuse 只认同一篇）
    tab('desc')
    page.wait_for_function('() => document.querySelectorAll(".np-shot").length === 6')
    assert (ai('cut'), ai('desc')) == before, '从档案重载再进来不该重烧 AI：%s' % (ai('cut'), ai('desc'))
    assert st('npLookOf(npS()).motif') == MOTIF_B, '回来还是那一派'
    tab('look')
    style_b = page.locator('#npLookBox .np-motif[data-k="%s"]' % MOTIF_B).first.get_attribute('style') or ''
    assert 'var(--c-brand-soft)' in style_b, '这一套自己定的那一派在 ① 那排亮着（六十六改：选中＝底色亮，不再带「·这一套」字样）'
    assert st('npLookOwn(npS(), "motif")') is True, '这一套自己定过这一派（不是跟账号默认）'
    assert descs() == [x['desc'] for x in got[0]['shots']['items']], '分镜从档案读得回'
    assert texts() == SENTS
    print('PASS: 流派与分组随这一行落档，换一篇再回来（整份重载）读得回（6 段 + 新派 + 零 AI）', flush=True)

    page.screenshot(path=str(OUT / 'xhs-note-motif.png'))
    assert not ERRORS, '有 pageerror：%s' % ERRORS[:2]
    print('PASS: 无 pageerror', flush=True)
    print('SHOT: %s' % (OUT / 'xhs-note-motif.png'), flush=True)


if __name__ == '__main__':
    main()

print('\n全绿：画面流派链路（④ 空态加行＝行身份 → ① 风格 换派只记新派 → 🔁 一批 3 屏只重出分镜回候选 · 字后压令牌两轴 · 五档口径）', flush=True)
