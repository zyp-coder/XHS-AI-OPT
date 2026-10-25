# -*- coding: utf-8 -*-
"""分镜（④ 那一档）按流派重组 自检（2026-10-25 按现行提示词重写）。

口径（以现行扩展为准）：
  1) 一条流派三句——take（长什么样）＋ cast（这段文案要变成这一派的什么料）＋ forbid（这样算不合格），
     三句一起进 AI 那一发的「【这一套图的取材路子】」；need 仍旧只在悬浮里给人看；
  2) 🔁 重出那一发拿到：整篇原文 ＋ 这一张是第几张／共几张 ＋ 前后段 ＋ 这一屏选定的那一句 ＋ 这一段那一档配文；
     AI 按段回「三条候选」＋「一份配文」，三条是三种摆法（主推／换视角／极简），配文那一份三条共用；
  3) 分镜按三块写（『这一张要证明』『画面里必须出现的元素』逐条编号、『背景』，有歧义再加一行『先说清楚』）；
     同一发按每段的配文档回一份可机读的配文参数（承接／标注／小注／重点／字位），档以客户拨的为准、AI 不许改档；
  4) 图上那几个字由生图模型直接画（2026-10-20 改口：「所有的配图和封面都要有字」）——
     「字后压」那一套（字位＝留白／共几行／【底图】【通则】【配色与层级】）已经作废；
     分镜那三块在拼提示词时折进【这张要说明】（＝『这一张要证明』）与【配图画面】里的「别拍成：…」（＝『先说清楚』），
     提示词里不再出现【这一张要证明】【先说清楚】这两个旧块名；
  5) 流派照旧不进提示词尾巴（尾巴只说「怎么画」那几轴，不含 motif／cast／forbid）；
     零 AI 的抄文案检查：⚠️ 点一下＝只重出这一屏；候选「→ 用这条」换一条＝零 AI、提示词当场重拼；
  6) 账号自加的流派跟内置同一张表：cast／forbid 填了就一起喂 AI。

跑法：python3 -X utf8 scripts/dev/check_desc_deep.py
临时 profile 加载真扩展（msedge headful），全程 AI 走桩、不烧真接口。改动验收只动 scripts/dev。
"""
import json
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

BODY = ('开场钩子：还在手动对账。\n\n'
        '每天要花两个小时把三张表的数字凑到一起。\n\n'
        '改成自动跑，第二天早上结果就摆在那。\n\n'
        '结尾引导：主页简介里找我。')

MOTIF_A = '真人工作场景'
MOTIF_C = '自家三格'
CUSTOM = {
    'k': MOTIF_C,
    'take': '只摆三样东西，一样占一块，别多',
    'cast': '把这段挑出三样最实在的东西，一样一块，按这段说的先后排',
    'forbid': '偷懒：还是把这段的字抄满三块',
    'need': '要三样实物',
}

S1 = '每天要花两个小时把三张表的数字凑到一起。'
S2 = '改成自动跑，第二天早上结果就摆在那。'
S3 = '结尾引导：主页简介里找我。'
# 抄文案那一格：三块的标题都写了，内容却还是把这行段原文整份搬上去（本地检查要判它不合格）
SHALLOW = ('这一张要证明：' + S1 + '｜画面里必须出现的元素：' + S1 + '｜背景：' + S1)
# 按流派重组过的一格：三块＋一行先说清楚（『版式』不再单列）
DEEP = ('重组后：『这一张要证明』这张站稳不用人守着；『先说清楚』别把「结果」画成奖杯；'
        '『画面里必须出现的元素』1. 一双手离开键盘，屏幕上是跑完的日志（这就是不用人守着的凭据）；'
        '2. 桌上一杯放凉的茶；3. 墙上贴的那张手排班表；『背景』晚上家里书桌，台灯从右上方单光源，'
        '浅景深随手抓拍，不要棚拍不要广告片。')
# 另外两条候选（换视角／极简）：用换行分隔三块，跟 AI 实际会写的样子一致
ALT1 = ('这一张要证明：结果自己跑出来了\n'
        '画面里必须出现的元素：1. 任务列表上三行都是绿的；2. 前一晚的手写记录摊在旁边；3. 手机搁在水杯边上\n'
        '背景：深夜书桌，只有屏幕在亮，台灯关着。')
ALT2 = ('这一张要证明：三张表并成了一份\n'
        '画面里必须出现的元素：1. 屏幕上只剩一个表格窗口（这就是并成一份的凭据）\n'
        '背景：白天窗边书桌，光从左边窗户进来。')

# 后台收口时把候选里的空白（含换行）压成一个空格：比对前也照这个口径归一
def N(t):
    return ' '.join(str(t or '').split())


ITEMS = [{'id': 's1', 'text': S1, 'desc': SHALLOW},
         {'id': 's2', 'text': S2, 'desc': DEEP},
         {'id': 's3', 'text': S3, 'desc': '缺：这张要有真截图'}]

NOTES = "async () => (await chrome.storage.local.get('np_notes')).np_notes || []"

SEED = r'''async (payload) => {
    await Storage.initializeDefaults(DEFAULT_PROMPTS);
    await ensureTenantInit();
    const cfg = await Storage.getConfig();
    cfg.product.name = '深分镜测试产品';
    cfg.ai.apiKey = 'test-local-only';
    cfg.imgMotifs = [payload.custom];
    await Storage.setConfig(cfg);
    // 真落档那一份：行自己带 shots，条目级那两份＝打开那一行的镜像（npArchiveData 里 npImgMirror 写的）
    const row = {id: 'g-deep', pid: 'xhs', style: '', updatedAt: Date.now(),
                 shots: { look: { motif: payload.motifA }, items: payload.items },
                 visual: { cover: '', images: '' }};
    await chrome.storage.local.set({
        np_notes: [{id: 'deep-1', title: '别再手动对账', status: '代发', platform: 'xhs',
                    form: '图文', draft: payload.body, voice: payload.body, createdAt: Date.now(),
                    imgDocs: [row], shots: row.shots, visual: row.visual}],
        np_assets: [],
    });
    self.aiCalls = 0;
    self.otherCalls = 0;
    self.descSystems = [];
    self.descUsers = [];
    // 全程走桩：只有 🔁 重出分镜那一发（系统提示词以「你在改一条…」开头）按段原文回号，
    // 其余任何一发（断句 / 挑句 / 封面 / 没料到的）一律记进 otherCalls 并返回空 JSON——绝不真打接口。
    // 回的那份「配文」档故意写成客户没拨过的「整段上屏」：扩展该只取字与格子、不许 AI 反过来改档；
    // 『大字』这一格已经不给了（图上那句大字＝这一屏选定的那一句，谁都不许另写）。
    // 每段回三条候选（主推／换视角／极简）：扩展只把第 1 条填进格子里，另两条收在「🎯 3 条候选」里等人挑。
    AiClient.chatCompletion = async (cfg2, system, user) => {
        const sys = String(system || '');
        if (sys.indexOf('你在改一条') >= 0) {
            const segs = (String(user || '').match(/^本段（要写的就是它）：(.+)$/gm) || [])
                .map(s => s.replace(/^本段（要写的就是它）：/, '').trim());
            self.descSystems.push(sys);
            self.descUsers.push(String(user || ''));
            self.aiCalls++;
            return {content: JSON.stringify({风格: '', 画面: segs.map(t => ({
                句: t,
                候选: [payload.deep, payload.alt1, payload.alt2],
                配文: {档: 'whole', 承接: ['三张表并成一份', '早上来收结果'], 标注: [], 重点: [{字: '不用守着', 标: '变色'}], 字位: '压在右边暗角'},
            }))})};
        }
        self.otherCalls++;
        return {content: '{}'};
    };
    return true;
}'''


def boot(p):
    for i in range(5):
        prof = OUT / ('descdeep-profile%d' % i)
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
        sw.evaluate(SEED, {'body': BODY, 'items': ITEMS, 'deep': DEEP, 'alt1': ALT1, 'alt2': ALT2,
                           'motifA': MOTIF_A, 'custom': CUSTOM})

        page = ctx.new_page()
        page.on('pageerror', lambda e: ERRORS.append(str(e)[:200]))
        page.set_viewport_size({'width': 1360, 'height': 1200})
        goto_big(page, sw.url.replace('background.js', 'popup.html?mode=big'))
        page.wait_for_function('typeof switchMainTab === "function" && typeof npDescsRegen === "function"')
        page.set_default_timeout(25000)

        def calls():
            return sw.evaluate('self.aiCalls')

        def others():
            return sw.evaluate('self.otherCalls')

        def cur_tab():
            return page.evaluate('() => npTabOf(npS())')

        def goto_tab(t):
            page.locator('#npImgTabs .np-imgtab[data-t="%s"]' % t).click()
            page.wait_for_timeout(260)

        def pout(k=0):
            """提示词在收起的 <details> 里：inner_text 读空串，一律 textContent"""
            return page.locator('.np-shot-pout').nth(k).evaluate('(el) => el.textContent')

        def body_txt():
            return page.evaluate('() => document.getElementById("npTabBody").innerText')

        def clear_toasts():
            """#popToastBox 要第一条 toast 才建出来：没建时按 null 守一下，别让清场自己超时"""
            page.evaluate('() => { const b = document.getElementById("popToastBox"); if (b) b.innerHTML = ""; }')

        def open_note():
            page.evaluate('''async () => {
                const list = await npNotesAll();
                const n = list.find(x => x && x.id === 'deep-1') || null;
                switchMainTab('noteOut', n);
            }''')
            page.wait_for_function('() => _npMode === "out" && !!document.querySelector("#npImgTabs .np-imgtab")')

        def no_cover():
            """② 那一档点「不出封面」：这一支只管 ④ 的分镜，别拿封面当路障"""
            page.locator('#npCoverBox .np-cover-on[data-v="0"]').click()
            page.wait_for_function('() => npS().shots.cv.on === false')

        def wait_regen(n, done_js=None):
            """等这一发落台：AI 又出去过 ＋ 台上不忙；done_js 就位才算完"""
            t0 = time.time()
            while time.time() - t0 < 30:
                if calls() > n and page.evaluate('() => _npDescBusy === false'):
                    break
                page.wait_for_timeout(200)
            else:
                raise AssertionError('这一发没走完（出去 %s 次、台上还忙=%s）' % (calls(), page.evaluate('() => _npDescBusy')))
            if done_js:
                page.wait_for_function(done_js)
            page.wait_for_timeout(450)

        # ── 0) 表本身：内置十条每条都带着转译配方与反例，喂 AI 那一句三行齐全 ──
        lib = page.evaluate('''() => {
            const all = VisualMotif.all([]);
            const one = VisualMotif.of('真人工作场景', []);
            return {n: all.length,
                    noCast: all.filter(x => !x.cast).map(x => x.k),
                    noForbid: all.filter(x => !x.forbid).map(x => x.k),
                    rule: VisualMotif.ruleOf('真人工作场景', []),
                    take: one.take, cast: one.cast, forbid: one.forbid,
                    custom: VisualMotif.all([__CUSTOM__]).length,
                    angles: VisualMotif.DESC_ANGLES.map(a => a.k)};
        }'''.replace('__CUSTOM__', json.dumps(CUSTOM, ensure_ascii=False)))
        assert lib['n'] == 10, '内置十条流派：%s' % lib['n']
        assert not lib['noCast'] and not lib['noForbid'], \
            '缺转译配方／反例的流派：%s %s' % (lib['noCast'], lib['noForbid'])
        assert lib['rule'].startswith('· 长什么样：' + lib['take']), lib['rule'][:80]
        assert '· 这段文案要变成这一派的什么料：' + lib['cast'] in lib['rule'], '喂 AI 那一句少了转译配方'
        assert '· 这样算不合格（这一派最常见的偷懒）：' + lib['forbid'] in lib['rule'], '喂 AI 那一句少了反例'
        assert lib['custom'] == 11, '账号自加的流派跟内置的同一张表：%s' % lib['custom']
        assert lib['angles'] == ['主推', '换视角', '极简'], '一屏三条摆法按这个顺序：%s' % lib['angles']
        print('PASS: 十条内置流派都带 cast＋forbid（长什么样／转译配方／这样算不合格）；三条候选＝主推／换视角／极简', flush=True)

        # ── 1) 档案那一篇 → 出图：流派是这一行的身份；② 封面先关掉（这一支只管 ④），① 是旋钮不是关卡 ──
        open_note()
        assert calls() == 0 and others() == 0, '进这一页不该烧 AI'
        keys = page.locator('#npImgTabs .np-imgtab').evaluate_all('els => els.map(x => x.getAttribute("data-t"))')
        assert keys == ['look', 'cover', 'cut', 'desc', 'preview'], '造图片就是这五档：%s' % keys
        assert page.evaluate('() => npLookOf(npS()).motif') == MOTIF_A, \
            '这一行自己的流派读 shots.look.motif（渲染任务表七十改已撤，不再过那张表）'
        assert cur_tab() == 'cover', '封面那一栏还没写：进来先停在 ②：%s' % cur_tab()
        no_cover()
        assert calls() == 0, '关封面不烧 AI'
        goto_tab('look')
        assert page.locator('#npLookBox .np-born').count() == 9, \
            '① 第一行＝📷 画面形式（八种画法＋跟账号默认）'
        assert page.locator('#npLookBox .np-motif').count() == 4, '① 第二行＝三颗短名单＋跟账号默认'
        assert page.locator('#npLookBox details').count() == 0, '说明收进 chip 悬浮，不铺折叠块'
        tip_l = page.locator('#npLookBox .np-motif[data-k="%s"]' % MOTIF_A).get_attribute('title') or ''
        assert '怎么把这段文案变成画面：' + lib['cast'] in tip_l and '这样算不合格：' + lib['forbid'] in tip_l, \
            '这一派的三句配方在 chip 悬浮里：%s' % tip_l[:120]
        assert '要什么料：' in tip_l, 'need 也还在悬浮里给人看'
        print('PASS: 进这一篇先落 ②；① 是旋钮（画面形式＋三颗短名单，三句配方收在悬浮），关封面不烧 AI', flush=True)

        # ── 2) ④ 分镜：一屏一张卡；抄文案那一格挂 ⚠️，另两格不挂；配文只剩「点一句」这一栏 ──
        goto_tab('desc')
        page.wait_for_function('() => document.querySelectorAll(".np-shot").length === 3')
        bt = body_txt()
        assert '分镜' in page.locator('#npImgTabs').inner_text(), '档位条上这一档的名字'
        assert '这一张要证明／画面里必须出现的元素／背景' in bt, '卡头要写明那三块（举证口径）'
        assert '✍️ 配文' in bt, '右边那一栏是配文（点一句当依据）'
        ph = page.locator('.np-shot-desc').first.get_attribute('placeholder') or ''
        assert '『画面里必须出现的元素』' in ph and '『背景』' in ph, '空着的格子给写法模板'
        assert page.locator('.np-cap').count() == 0, '四档配文 chips 已经撤了（图上字由生图模型画）'
        assert page.locator('.np-key-pick').count() == 0, \
            '这一屏没跟 ③ 的行号绑上：配文栏没有可点的行（不是渲染坏了）'
        assert '这一屏还是旧档那份字' in bt, '没绑行号时配文栏要说清为什么没得点'
        assert page.locator('.np-shot-shallow').count() == 1, '只有抄文案那一格挂 ⚠️'
        assert page.locator('.np-shot-shallow').first.get_attribute('data-id') == 's1'
        assert '1 屏还在抄文案' in bt, '表尾要报到数'
        assert page.locator('#npRegenBar .np-desc-regen').count() == 1, '④ 表头那一颗 🔁'
        assert '· 3 屏' in page.locator('#npRegenBar').inner_text(), page.locator('#npRegenBar').inner_text()
        prompt_before = pout()
        assert '【拍法】' in prompt_before and '【这段正文】' in prompt_before and '【图上文案】' in prompt_before, \
            '提示词现在是简报式几块：%s' % prompt_before[:200]
        assert MOTIF_A not in prompt_before and lib['cast'] not in prompt_before, '流派不进提示词尾巴（两条通道）'
        print('PASS: ④ 一屏一张卡（三块写法模板／✍️ 配文只剩点句）；只有抄文案那格挂 ⚠️，表尾报到数', flush=True)

        # ── 3) 出图页「← 返回档案」回档案、再从这一篇进来：行与分镜原样读得回 ──
        descs_before = page.evaluate('() => npS().shots.items.map(x => x.desc)')
        page.locator('#noteOutputContent .np-out-back').click()
        page.wait_for_function('() => _npMode === "wizard"', timeout=10000)
        assert calls() == 0, '回档案不烧 AI'
        open_note()
        goto_tab('desc')
        page.wait_for_function('() => document.querySelectorAll(".np-shot").length === 3')
        assert page.evaluate('() => npS().shots.items.map(x => x.desc)') == descs_before, '再进来分镜还是台上那份'
        assert calls() == 0, '进出这一趟不烧 AI'
        print('PASS: 出图页「← 返回档案」回档案、再从这一篇进来，行与分镜原样读得回（零 AI）', flush=True)

        # ── 4) 点 ⚠️ 只重出这一屏：一发、一段、别的格子一个字不动；配文参数按客户那一档收（AI 不许改档）──
        descs0 = page.evaluate('() => npS().shots.items.map(x => x.desc)')
        texts0 = page.evaluate('() => npS().shots.items.map(x => x.text)')
        n0 = calls()
        page.locator('.np-shot-shallow').first.click()
        assert n0 == 0
        wait_regen(n0, '() => npS().shots.items[0].desc.indexOf("重组后") === 0')
        assert calls() == 1, '单屏重出＝一发：%s' % calls()
        assert others() == 0, '除这一发之外不许有别的一发：%s' % others()
        one_user = sw.evaluate('self.descUsers[0]')
        assert one_user.count('本段（要写的就是它）：') == 1, '只该列那一段'
        assert one_user.count('—— 第 ') == 1 and '—— 第 1 张 / 共 3 张 ——' in one_user, '这一发只排了那一段的张位'
        assert '前一段：（这就是第一张）' in one_user
        assert '后一段：' + S2 in one_user, '这一段后面接什么，AI 要看得见'
        assert ' '.join(BODY.split()) in one_user, '整篇原文要跟着过去'
        assert ('这一屏那句话（客户选定的，图上那句大字就是它——你不许改写它、不许另报一句，'
                '承接与标注围着它说）：每天要花两个小时把三张表的数字凑到一起') in one_user, \
            '这一屏选定的那一句要原样带给 AI（大字就是它，AI 不许另报一句）'
        assert '配文方式：说一次（客户拨的档，不许改' in one_user, '每一段都带着它那一份配文档过去'
        descs1 = page.evaluate('() => npS().shots.items.map(x => x.desc)')
        assert descs1[0] == DEEP, descs1[0][:60]
        assert descs1[1:] == descs0[1:], '只重出那一段，另两格不动'
        one = page.evaluate('() => npS().shots.items[0]')
        assert one['cands'] == [N(DEEP), N(ALT1), N(ALT2)],             '三条候选都收进那一格（换行收口成一个空格）：%s' % (one.get('cands') or [])
        assert one['pick'] == 0, '先用「主推」那条：%s' % one['pick']
        assert one['dlock'] is False, 'AI 重出过的格子不带 🔒'
        cap0 = one.get('cap') or {}
        assert cap0.get('lines') == ['三张表并成一份', '早上来收结果'], \
            '桩回的档是「整段上屏」、客户拨的是「说一次」——档不许被 AI 顶掉，承接按 say 档收进来：%s' % cap0
        assert cap0.get('em') == [{'w': '不用守着', 'k': 'hot'}], '『重点』那几处：字原样 ＋ 标归一类（变色→hot）：%s' % cap0
        assert cap0.get('zone') == 'mr', '老写法那句「压在右边暗角」映射到九宫格右中：%s' % cap0
        assert 'labels' not in cap0, 'say 档用不上标注，AI 报了的也丢掉：%s' % cap0
        assert 'mode' not in cap0 and \
            page.evaluate('() => npCapModeOfItem(npS(), npS().shots.items[0])') == 'say', \
            '档留客户拨的「说一次」，配文参数里不留 AI 那份档：%s' % cap0
        page.wait_for_function('() => !document.querySelector(".np-shot-shallow")')
        assert '还在抄文案' not in body_txt(), '表尾那句报到数也该跟着撤'
        assert page.evaluate('() => npS().shots.items.map(x => x.text)') == texts0, '段文本一个字没动'
        print('PASS: 点 ⚠️ 只重出这一屏（一发·张位与前后段都带着·另两格不动·配文按客户档收·⚠️ 当场消失）', flush=True)

        # ── 4b) 「🎯 3 条候选」点一下换一条：零 AI，提示词当场跟着那条重拼 ──
        assert page.locator('.np-desccand').count() == 1, '只有刚重出那一格有候选块'
        page.locator('.np-desccand[data-id="s1"] summary').click()
        page.locator('.np-desc-pick[data-id="s1"][data-i="1"]').click()
        assert page.evaluate('() => npS().shots.items[0].desc') == N(ALT1), '上面那格换成「换视角」那条'
        assert page.evaluate('() => npS().shots.items[0].pick') == 1
        assert calls() == 1, '换一条不烧 AI：%s' % calls()
        page.wait_for_function(
            '(t) => { const e = document.querySelectorAll(".np-shot-pout")[0]; return !!e && e.textContent.indexOf(t) >= 0; }',
            arg='【这张要说明】结果自己跑出来了。')
        print('PASS: 「→ 用这条」换候选（零 AI，提示词当场按新那条重拼）', flush=True)

        # ── 5) 整表 🔁：三块写法 + 配文那一格 + 转译配方 + 反例 + 主次，全在那一发里 ──
        n1 = calls()
        page.locator('#npRegenBar .np-desc-regen').click()
        wait_regen(n1, '() => npS().shots.items.every(x => String(x.desc || "").indexOf("重组后") === 0)')
        assert calls() == 2, '3 屏一批一发：%s' % calls()
        assert others() == 0
        sys_d = sw.evaluate('self.descSystems[1]')
        for part in ('『这一张要证明』', '『画面里必须出现的元素』', '『背景』', '『先说清楚'):
            assert part in sys_d, '缺三块之一：%s' % part
        assert '『版式』' not in sys_d and '『多给的凭据』' not in sys_d, \
            '字块与凭据已各自挪走，那一发不该再点名旧的两块'
        assert '这一张图上要写的那几个字' in sys_d, '字排哪儿由 AI 画进画面：位置得在画面这一块交代'
        assert '先想这段的结论靠什么一眼看得见' in sys_d, '那一发开头要先立「图替这段的结论举证」这条规矩'
        assert '别拿装饰凑' in sys_d, '补不出凭据要写「缺：××」，别拿装饰凑'
        assert '按 1. 2. 3. 逐条列、至少三条' in sys_d, '元素清单要逐条编号、数得出看得见的东西'
        assert '这就是……的凭据' in sys_d, '清单里至少一条自己带凭据'
        assert '这段没一字一字写' in sys_d
        assert '每段回 3 条候选' in sys_d, '一屏三条摆法'
        assert '换视角那条要换掉看得见的主体或场景' in sys_d, '三条不是同一份的三种措辞'
        assert '每段还要按它那一份「配文方式」给一份「配文」' in sys_d, '那一发还欠一份图上那套字'
        assert '这一档＝「说一次」' in sys_d, '整套默认那档的写法要展开给 AI 看'
        assert '"配文":{"档"' in sys_d, 'JSON 契约里没有配文那一格'
        assert '· 这段文案要变成这一派的什么料：' + lib['cast'] in sys_d, '转译配方没进那一发'
        assert '· 这样算不合格（这一派最常见的偷懒）：' + lib['forbid'] in sys_d, '反例没进那一发'
        assert '上面那句「这样算不合格」摆着的偷懒写法，一条都不许踩' in sys_d
        assert '第 1 张是这套的脸' in sys_d, '同一派里也要按张位分主次'
        assert '【本次画面流派】' + MOTIF_A in sys_d
        assert '这些是拿来判断这一张该往前推什么、怎么不跟邻张重样的，不是拿来抄进分镜的' in sys_d
        assert '「风格」不用你给（留空字符串）' in sys_d, '一套图长什么样由客户定，AI 不许另立一套'
        assert '不许出现二维码 / 联系方式' in sys_d, '合规那一条还在'
        assert '画面数组的条数＝3 条' in sys_d, '回号条数要跟这一批发出去的对上'
        user_d = sw.evaluate('self.descUsers[1]')
        assert user_d.count('本段（要写的就是它）：') == 3
        assert '—— 第 3 张 / 共 3 张 ——' in user_d and '后一段：（这就是最后一张）' in user_d
        assert '【整篇原文（只重写下面列出的那几段；这段全文别抄进分镜）】' in user_d
        assert page.evaluate('() => npS().shots.items.map(x => x.desc)') == [DEEP, DEEP, DEEP]
        assert page.evaluate('() => npS().shots.items.map(x => x.pick)') == [0, 0, 0]
        page.wait_for_function(
            '() => { const e = document.querySelectorAll(".np-shot-pout"); return e.length === 3 && e[1].textContent.indexOf("第 2 张") >= 0; }')
        prompt_after = pout(1)
        assert prompt_after.startswith('第 2 张（共 3 张，竖版 3:4，手机随拍）：'), prompt_after[:120]
        assert '【拍法】机位：手持' in prompt_after, '手机随拍那一挂的拍法要在单张里再说一次'
        assert '【这段正文】改成自动跑，第二天早上结果就摆在那。' in prompt_after, prompt_after[:400]
        assert '【这张要说明】这张站稳不用人守着。' in prompt_after, '『这一张要证明』折进这一块'
        assert '【配图画面】重组后；画面里要有：1. 一双手离开键盘' in prompt_after, prompt_after[:600]
        assert '别拍成：别把「结果」画成奖杯' in prompt_after, '『先说清楚』折进「别拍成：…」'
        assert '别摆整齐，像干到一半' in prompt_after, '手机随拍那句现场感还挂在画面后面'
        assert '【背景】晚上家里书桌' in prompt_after, '『背景』单独成块：' + prompt_after[prompt_after.index('【背景】'):][:90]
        assert '台灯从右上方单光源' not in prompt_after, '手机随拍要剥掉棚拍／布光那半句'
        assert '【机位】手机在桌边斜上方 45 度' in prompt_after, '第二张跟第一张不能一个角度'
        assert '【图上文案】字要大、笔画粗、对比强' in prompt_after
        assert '画面上只写「改成自动跑，第二天早上结果就摆在那」这一句（可照参考句改写）' in prompt_after
        assert '写法：像作者拍完随手打在手机上的一句大字' in prompt_after, '配文那一档的写法跟着画法走'
        assert '【这一张要证明】' not in prompt_after and '【先说清楚】' not in prompt_after, \
            '旧两个块名已经折走了，不许再出：%s' % prompt_after[prompt_after.index('【这张要说明】'):][:200]
        assert '这一张画面上是：' not in prompt_after, '不再整份塞进那一行'
        # 字后压已作废（2026-10-20 改口：字由生图模型画）：那一套的几块一个都不该再出现
        for dead in ('【这一屏的字是后压的，你不许画进去】', '字位＝', '共 3 行',
                     '【底图，这一套每张共用，必须照做】', '【通则】', '【配色与层级'):
            assert dead not in prompt_after, '字后压那一套早作废了，提示词里还在：%s' % dead
        for leak in (MOTIF_A, lib['cast'], lib['forbid']):
            assert leak not in prompt_after, '流派那两句又漏进提示词尾巴了'
        print('PASS: 🔁 那一发拿到整篇＋张位＋前后段＋配文档，三条候选＋一份配文、带转译配方与反例；提示词折成现行几块', flush=True)

        # ── 6) 换流派：自加那条补位一颗 chip 亮起（零 AI）；提示词一个字不动；它的 cast/forbid 照样进下一发 ──
        pout_before_switch = [pout(i) for i in range(3)]
        goto_tab('look')
        assert page.locator('#npLookBox .np-motif').count() == 4, '换派前 ① 就三颗短名单＋跟账号默认'
        clear_toasts()
        page.evaluate('() => npMotifPick(npActiveC(), "%s")' % MOTIF_C)
        page.wait_for_function('() => npLookOf(npS()).motif === "%s"' % MOTIF_C)
        page.wait_for_function(
            '() => { const b = document.getElementById("popToastBox"); return !!b && b.innerText.indexOf("分镜还是旧派写的") >= 0; }',
            timeout=5000)
        ks = page.locator('#npLookBox .np-motif').evaluate_all('els => els.map(x => x.getAttribute("data-k"))')
        assert ks == ['真人工作场景', '方案页', '手写笔记·纸感', MOTIF_C, ''], '自加那颗补位出来：%s' % ks
        style_c = page.locator('#npLookBox .np-motif[data-k="%s"]' % MOTIF_C).get_attribute('style') or ''
        assert 'var(--c-brand-soft)' in style_c, '补位那颗亮着（这一套定过它）'
        assert MOTIF_C in page.locator('#npImgTabs .np-imgtab[data-t="look"]').inner_text().replace(' ', ''), '档名跟着换派'
        assert calls() == 2, '换流派不该烧 AI：%s' % calls()
        goto_tab('desc')
        page.wait_for_function('() => document.querySelectorAll(".np-shot").length === 3')
        assert [pout(i) for i in range(3)] == pout_before_switch, '换派不重排提示词（流派不进尾巴）'
        n2 = calls()
        page.locator('#npRegenBar .np-desc-regen').click()
        wait_regen(n2)
        assert calls() == 3 and sw.evaluate('self.descSystems.length') == 3, '自加流派的 🔁 又是一发：%s' % calls()
        sys_c = sw.evaluate('self.descSystems[2]')
        assert '【本次画面流派】' + MOTIF_C in sys_c
        assert '· 长什么样：' + CUSTOM['take'] in sys_c
        assert '· 这段文案要变成这一派的什么料：' + CUSTOM['cast'] in sys_c, '自加那条的转译配方没进那一发'
        assert '· 这样算不合格（这一派最常见的偷懒）：' + CUSTOM['forbid'] in sys_c, '自加那条的反例没进那一发'
        goto_tab('look')
        tip_c = page.locator('#npLookBox .np-motif[data-k="%s"]' % MOTIF_C).get_attribute('title') or ''
        assert '怎么把这段文案变成画面：' + CUSTOM['cast'] in tip_c and '这样算不合格：' + CUSTOM['forbid'] in tip_c, \
            '补位那颗的悬浮＝它自己那派的配方：%s' % tip_c[:120]
        assert '要什么料：' + CUSTOM['need'] in tip_c, tip_c[:200]
        print('PASS: 账号自加的流派跟内置同一条通路——① 补位一颗并亮起、三句配方照样喂 AI，提示词尾巴依旧不碰', flush=True)

        # ── 7) 落档：新派、分镜、候选、配文参数跟着这一行写回档案 ──
        page.evaluate('() => npArchiveFlushTouch()')
        got = None
        t0 = time.time()
        while time.time() - t0 < 15:
            got = next((x for x in page.evaluate(NOTES) if x and x.get('id') == 'deep-1'), None)
            if got and ((got.get('imgDocs') or [{}])[0].get('shots') or {}).get('items'):
                break
            page.wait_for_timeout(300)
        assert got, '这一篇没落回档案'
        row = (got.get('imgDocs') or [{}])[0]
        assert row.get('shots', {}).get('look', {}).get('motif') == MOTIF_C, '新派随这一行落档'
        assert row['shots']['items'][0]['desc'] == DEEP, '重组过的分镜要落得回档'
        assert row['shots']['items'][0]['cands'] == [N(DEEP), N(ALT1), N(ALT2)], '三条候选也要留着（下次打开还能换）'
        assert row['shots']['items'][0]['pick'] == 0
        capr = row['shots']['items'][0].get('cap') or {}
        assert capr.get('lines') == ['三张表并成一份', '早上来收结果'] and capr.get('zone') == 'mr', capr
        assert 'mode' not in capr, '落档也不写 AI 那份档：%s' % capr
        assert (got.get('shots') or {}).get('look', {}).get('motif') == MOTIF_C, '条目级那份镜像是同一行'
        print('PASS: 新派／分镜／三条候选／配文参数跟着这一行写回档案（条目级镜像同一份）', flush=True)

        assert calls() == 3 and others() == 0, '整趟只该有 3 发（单屏／整表／换派后整表）：%s / %s' % (calls(), others())
        assert not ERRORS, '页面报错了：%s' % ERRORS
        print('\nALL PASS（7 组）', flush=True)
    finally:
        ctx.close()
