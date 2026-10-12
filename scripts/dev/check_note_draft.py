# -*- coding: utf-8 -*-
"""写文案 ①→⑥ 主链回归自检（2026-10-02 重建版：原 1677 行脚本随文件损毁不可复原，按现界面重写主链）。

口径（五十三改 / 五十四改 / 五十五改之后的真源）：
  1) ① 没勾卖点时「下一步」常亮可点（原因写在 title），点了弹提示、不跳步（守门按钮一律软提示，不再置灰）；
  2) ② 人群那一发不顺手把话题的钱也烧了；③ 话题到手自动勾第一条 →「就用这篇 →」立刻可点；
  3) ④ 进页自动按这条线的几种写法各出一篇（每批 3 篇、分批发）；**唯一前进路＝点中某台手机下面的「就用这篇 →」**，
     页脚不再摆「下一步」；🕳 缺料那种画成虚线空屏、不给「就用这篇」；「🔀 重写这批」force=true 才真的重打；
     换线＝按新线重打、切回老线读这条线的缓存不再烧 AI；
  4) ⑤ 挑中一篇＝那篇正文直接当底稿（不再打「从零成稿」那一发），默认**逐句视图**：点一句只改那一句、其余一字不差；
     整篇改稿原位替换、可「↩ 改回上一版」（退回不打 AI）；明确要求换标题才换标题；改稿失败报后台真原因（且转义）；
  5) ⑥ 定稿：勾几个平台就各写一版（小红书那份用底稿不重烧）、各成一档；版本条点着切（切回一字不差）、
     ↻ 重写同档覆盖不另开一档、↗ 事后补一个平台的版本单独成档；「📋 复制这版发布文案」＝标题 + 正文 + 标签；
  6) 五十四改：⑥ 不再摆「做图文 / 做视频」两路卡、也没有「拿去出片」——要做料只从「笔记档案」那一行「下一步」进，
     落到「🎬 渲染任务」那张表上（本脚本直开这张表），不加行＝表上一个活都没有、一发 AI 都不烧；
     换过一篇稿子，旧分镜表 / 旧图文提示词 / 旧口播稿一并作废。

跑法：python3 -X utf8 scripts/dev/check_note_draft.py
临时 profile 加载真扩展（msedge），全程 AI 走桩、不烧真接口。
"""
import pathlib
import shutil
import sys
import tempfile
import time

from playwright.sync_api import expect, sync_playwright

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / 'extension'
OUT = pathlib.Path(tempfile.gettempdir())
ERRORS = []

PEOPLE = {'people_options': [
    {'name': '开小店的人', 'pain': '每天重复回同样的话', 'scene': '准备找客户', 'timing': '购买前'},
    {'name': '一个人做号的人', 'pain': '不知道明天写什么', 'scene': '内容断更', 'timing': '周内'},
    {'name': '跑业务的人', 'pain': '评论区没人搭腔', 'scene': '找线索', 'timing': '购买后'}]}

TOPICS = {'topics': [
    {'topic': '评论区怎么找回客户', 'fact': '有人在评论区问「怎么找你」，我当场回了一条',
     'target': '开小店的人', 'rationale': '解决实际问题', 'type': 'howto', 'kind': 'steps',
     'alone': '不提产品也照着做'},
    {'topic': '一天省下的两小时', 'fact': '同一句回答我复制了四十遍', 'target': '一个人做号的人',
     'rationale': '省时', 'type': 'howto', 'kind': 'steps', 'alone': '省时这件事谁都懂'}]}

DRAFT_TITLES = ['标题甲：省时间三步', '标题乙：别再复制第四十遍', '标题丙：评论区里捡客户']
DRAFT_CONTENT = ('先说结论：把重复的活收成三步。\n\n第一步：归类，同一种问题只回一次。\n\n'
                 '第二步：模板只做一次，后面照着发。\n\n想看具体怎么排：主页简介里找。')
DOUYIN_CONTENT = ('（抖音版）这条不发图文，念给你听：\n\n重复的问题先归成三类。\n\n'
                  '模板做一次，后面照着来。\n\n想细看主页简介找我。')
REVISED = ('改后的开头：我算过，一天有两小时在复制粘贴。\n\n改后的中段：先归类，同一种问题只回一次。\n\n'
           '改后的收尾：这三步写在主页简介里。')
LOOSE = '这是一整段没有 JSON 的文案。\n\n第二段照样能用。'
SHOTS = ('{"风格":"浅色底 + 大字卡片","封面":"竖版 3:4 封面：点题句",'
         '"画面":[{"句":"先说结论：把重复的活收成三步。","重点":true,"分镜":"中心思想：三步；画面一行大字"}]}')

SEED = r'''async (payload) => {
    await Storage.initializeDefaults(DEFAULT_PROMPTS);
    await ensureTenantInit();
    const cfg = await Storage.getConfig();
    cfg.product.name = '主链测试产品';
    cfg.product.sellPoints = [
        {title: '省时间', content: '把重复步骤压掉'},
        {title: '不用想选题', content: '每天给一条现成话题'}];
    cfg.ai.apiKey = 'test-local-only';
    await Storage.setConfig(cfg);
    await chrome.storage.local.set({np_notes: [], np_assets: []});
    self.aiCalls = {}; self.aiSys = {}; self.aiUser = {}; self.aiSkipDone = 0; self.aiLog = [];
    self.aiStub = payload.stub || {};
    self.aiPeopleRaw = payload.people; self.aiTopicsRaw = payload.topics;
    self.aiDraft = payload.draft; self.aiRevised = payload.revised;
    self.aiDouyin = payload.douyin; self.aiTitles = payload.titles;
    self.aiLoose = payload.loose; self.aiShots = payload.shots;
    // 每一发按后台提示词里的独有说法认路（这几个标记是从 background.js 抄来的，改提示词要一起改）
    const pick = (system) => {
        const s = String(system || '');
        if (s.indexOf('同题写一批') >= 0) return 'variants';
        if (s.indexOf('只改用户【要点的那一句】') >= 0) return 'sentence';
        if (s.indexOf('只输出改好的正文') >= 0) return 'revise';
        if (s.indexOf('"timeTip":"建议时段"') >= 0) return (s.indexOf('这次不是从零写') >= 0 ? 'derive' : 'draft');
        if (s.indexOf('话题域') >= 0) return 'topics';
        if (s.indexOf('视觉指令工程师') >= 0) return 'shots';
        return 'people';
    };
    const reply = (fam) => {
        const st = self.aiStub[fam] || {};
        if (st.error) throw new Error(st.error);
        if (st.raw != null) return String(st.raw);
        if (fam === 'variants') {
            const keys = [];
            String(st.user || self.aiUser.variants || '')
                .replace(/kind=([A-Za-z0-9_]+)/g, (m, k) => { if (keys.indexOf(k) < 0) keys.push(k); return ''; });
            return JSON.stringify({variants: keys.map((k) => {
                // 缺料只演一种：这一批里第一次命中时跳过，后面那几批照常出（否则每批都少一篇）
                if (st.skipFirst && !self.aiSkipDone) { self.aiSkipDone = 1; return {kind: k, skipped: '缺客户现场的原话'}; }
                return {kind: k, title: '样稿标题·' + k,
                        content: '「' + k + '」这篇的开头。\n\n中段：具体动作与例子。\n\n收尾：想看就去我主页简介里找。',
                        tags: ['样稿标签一', '样稿标签二']};
            })});
        }
        if (fam === 'draft') {
            return JSON.stringify({titles: st.titles || self.aiTitles,
                content: st.content || self.aiDraft,
                tags: st.tags || ['标签甲', '标签乙', '标签丙'], timeTip: '晚上 8 点'});
        }
        if (fam === 'derive') {
            return JSON.stringify({titles: st.titles || self.aiTitles, content: st.content || self.aiDouyin,
                tags: st.tags || ['补版标签'], timeTip: '晚上 9 点'});
        }
        if (fam === 'revise') {
            const o = {content: st.content || self.aiRevised};
            if (st.titles) o.titles = st.titles;
            if (st.tags) o.tags = st.tags;
            return JSON.stringify(o);
        }
        if (fam === 'sentence') return JSON.stringify({sentence: st.sentence || '只改这一句的新说法。'});
        if (fam === 'shots') return String(self.aiShots);
        return JSON.stringify(fam === 'topics' ? self.aiTopicsRaw : self.aiPeopleRaw);
    };
    AiClient.chatCompletion = async (cfg2, system, user) => {
        const fam = pick(system);
        self.aiCalls[fam] = (self.aiCalls[fam] || 0) + 1;
        self.aiSys[fam] = String(system || ''); self.aiUser[fam] = String(user || '');
        self.aiLog.push(fam + ' ← ' + String(system || '').slice(0, 56).replace(/\\s+/g, ' '));
        if (self.aiLog.length > 30) self.aiLog.shift();
        return {content: reply(fam)};
    };
    return true;
}'''

NOTES = 'async () => (await chrome.storage.local.get("np_notes")).np_notes || []'


def boot(p):
    for i in range(5):
        prof = OUT / ('draftchain-profile%d' % i)
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


def calls(sw, fam):
    return sw.evaluate('(f) => (self.aiCalls || {})[f] || 0', fam)


def reset_calls(sw):
    sw.evaluate('() => { self.aiCalls = {}; self.aiLog = []; }')


def wait_draft(page, sub, timeout=30000):
    """等 ⑤ 的成稿落地；没等到就把「每一发被认成了哪一类」打出来（认路全靠提示词里的标记）"""
    from playwright._impl._errors import TimeoutError as PWTimeout
    try:
        page.wait_for_function('(s) => npS().draft && String(npS().draft.content || "").indexOf(s) >= 0',
                               arg=sub, timeout=timeout)
    except PWTimeout:
        print('  成稿没等到「%s」：%s' % (sub, page.evaluate(
            '() => { const w = npS(); const d = w.draft || {}; '
            'return "step=" + w.step + " busy=" + (typeof _npDraftBusy !== "undefined" && _npDraftBusy) '
            '+ " draftKeys=" + Object.keys(d).join(",") + " content=" + String(d.content || "").slice(0,80); }')), flush=True)
        print('  #npDraftStatus = %s' % page.evaluate(
            '() => { const e = document.getElementById("npDraftStatus"); return e ? e.textContent.slice(0,200) : "（没有这一块）"; }'), flush=True)
        if sw:
            print('  aiCalls=%s' % sw.evaluate('() => JSON.stringify(self.aiCalls || {})'), flush=True)
            print('  最近几发：\n    %s' % '\n    '.join(sw.evaluate('() => self.aiLog || []')), flush=True)
        raise


def stub(sw, fam, value):
    sw.evaluate('''([f, v]) => {
        const prev = self.aiStub[f] || {};
        if (v.skipFirst !== undefined && v.skipFirst !== prev.skipFirst) self.aiSkipDone = 0;
        self.aiStub[f] = Object.assign({}, prev, v);
    }''', [fam, value])


def wiz(page, expr):
    """对台上那一篇（_npWiz / _npOut）取个值"""
    return page.evaluate('() => { const w = npS(); return (%s); }' % expr)


def wait_step(page, n, timeout=25000):
    page.wait_for_function('(n) => _npWiz && _npWiz.step === n', arg=n, timeout=timeout)


def body_text(page):
    return page.locator('#npWizBody').inner_text()


def nav_text(page):
    return page.locator('#npWizNav').inner_text()


def wait_cards(page, n, timeout=30000):
    from playwright._impl._errors import TimeoutError as PWTimeout
    try:
        page.wait_for_function('(n) => document.querySelectorAll(".npVarPick").length === n', arg=n, timeout=timeout)
    except PWTimeout:
        print('  卡数没到 %d：npVarPick=%d npPhone=%d' % (
            n, page.locator('.npVarPick').count(), page.locator('.npPhone').count()), flush=True)
        for eid in ('npVarStatus', 'npWizBody'):
            print('  #%s = %s' % (eid, page.evaluate(
                '(i) => { const e=document.getElementById(i); return e ? String(e.textContent).slice(0,260) : "（没有这一块）"; }', eid)), flush=True)
        print('  w.variants=%s err=%s picked=%s' % (
            wiz(page, '(w.variants||[]).length'), wiz(page, 'w.variantsError'), wiz(page, 'w.picked')), flush=True)
        if sw:
            print('  aiCalls=%s aiStub=%s' % (
                sw.evaluate('() => JSON.stringify(self.aiCalls || {})'),
                sw.evaluate('() => JSON.stringify(self.aiStub || {})')), flush=True)
        raise


with sync_playwright() as p:
    ctx = boot(p)
    try:
        sw = ctx.service_workers[0]
        assert sw.evaluate('chrome.runtime.onMessage.hasListeners()'), '后台路由没注册上'
        sw.evaluate(SEED, {'people': PEOPLE, 'topics': TOPICS, 'stub': {},
                           'draft': DRAFT_CONTENT, 'revised': REVISED, 'douyin': DOUYIN_CONTENT,
                           'titles': DRAFT_TITLES, 'loose': LOOSE, 'shots': SHOTS})

        page = ctx.new_page()
        page.on('pageerror', lambda e: ERRORS.append(str(e)[:200]))
        page.set_viewport_size({'width': 1180, 'height': 900})
        page.goto(sw.url.replace('background.js', 'popup.html?mode=big'))
        page.wait_for_function('typeof switchMainTab === "function" && typeof npWizSig === "function" '
                               '&& typeof NotePlan !== "undefined" && typeof npVarBatchSize === "function"')
        page.evaluate('''() => { window.__clip = '';
            try { navigator.clipboard.writeText = async (t) => { window.__clip = String(t); }; } catch (_) {} }''')
        page.set_default_timeout(25000)

        TYPES = page.evaluate('() => NotePlan.TYPES.map(t => t.key)')
        line_key = 'howto'
        other_key = next(k for k in TYPES if k not in (line_key, 'hot'))
        n_kinds = page.evaluate('(k) => (NotePlan.kindsOfType(k) || []).length', line_key)
        n_other = page.evaluate('(k) => (NotePlan.kindsOfType(k) || []).length', other_key)
        per = page.evaluate('() => npVarBatchSize(((typeof npWords === "function" && npWords()) || {}).key)')
        calls_line = -(-n_kinds // per)
        calls_other = -(-n_other // per)
        v_calls = 0   # ④ 到现在一共打了几发（每批 3 篇，自己累计，别把批次写死）

        # ── 1) ① 没勾卖点：下一步亮着可点，点了弹提示、原地不跳步 ──
        page.evaluate('() => switchMainTab("notePublish", "new")')
        page.wait_for_function('() => !!document.querySelector(".np-spk")', timeout=20000)
        nxt = page.locator('.np-wiz-next')
        expect(nxt).to_be_enabled()
        assert 'pointer' in (nxt.get_attribute('style') or ''), nxt.get_attribute('style')
        assert '卖点' in (nxt.get_attribute('title') or ''), nxt.get_attribute('title')
        nxt.click()
        expect(page.locator('#popToastBox')).to_contain_text('请先选要推的卖点')
        page.wait_for_timeout(400)
        assert wiz(page, '_npWiz.step') == 0, '没勾卖点就点下一步不该跳步'
        print('PASS: ① 没勾卖点时「下一步」亮着可点，点了弹「请先选要推的卖点」、原地不跳步', flush=True)

        # ── 2) ② 人群：这一发不该顺手把话题的钱烧了 ──
        page.locator('.np-spk').first.check()
        page.locator('.np-wiz-next').click()
        expect(page.locator('.np-ppc')).to_have_count(3)
        assert calls(sw, 'people') >= 1, '人群那一发没打'
        assert calls(sw, 'topics') == 0, '还没挑人群就打了话题那一发'
        print('PASS: ② 人群按自己那一发出 3 张卡，没顺手烧话题那一发（topics=0）', flush=True)

        # ── 3) ③ 话题：到手自动勾第一条 →「就用这篇 →」立刻能点 ──
        page.locator('.np-ppc').first.check()
        page.locator('.np-wiz-next').click()
        expect(page.locator('.np-tpc')).to_have_count(2)
        assert wiz(page, '_npWiz.chosenTopicIdx') == 0, '话题没自动勾第一条（用户点了没反应）'
        expect(page.locator('.np-wiz-next')).to_be_enabled()
        assert '就用这篇' in page.locator('.np-wiz-next').inner_text(), page.locator('.np-wiz-next').inner_text()
        print('PASS: ③ 话题自动勾上第一条，「就用这篇 →」立刻可点（不再是灰态）', flush=True)

        # ── 4) ④ 进页自动按这条线的几种写法各出一篇；唯一前进路＝点中样稿 ──
        page.locator('.np-wiz-next').click()
        wait_step(page, 3)
        wait_cards(page, n_kinds)
        v_calls += calls_line
        assert calls(sw, 'variants') == v_calls, '④ 该按每批 %d 篇打 %d 发，实打 %s' % (per, calls_line, calls(sw, 'variants'))
        assert page.locator('.npPhone').count() == n_kinds, page.locator('.npPhone').count()
        assert page.locator('.np-wiz-next').count() == 0, '④ 不该再摆「下一步」——前进只有点中样稿那条路'
        assert '挑中哪篇就走哪篇' in nav_text(page), nav_text(page)
        sys4 = sw.evaluate('() => self.aiSys.variants')
        assert '同题写一批' in sys4 and '★ 本条线：' in sys4, '④ 那一发要写明是同一条线底下的几种写法'
        assert '每篇挑不同的一件小事' in sys4, '同一题的几篇不许复述同一件事'
        assert '省时间' in sw.evaluate('() => self.aiUser.variants'), '选中的卖点要下到这批发稿的提示词里'
        print('PASS: ④ 进页自动出 %d 篇样稿（每批 %d 篇 = %d 发 AI），页脚只留「🔀 重写这批」＋「挑中哪篇就走哪篇」'
              % (n_kinds, per, calls_line), flush=True)

        # ── 5) 🕳 缺料那种：虚线空屏、不给「就用这篇」，也不硬编 ──
        stub(sw, 'variants', {'skipFirst': True})
        page.locator('.np-wiz-again').click()
        wait_cards(page, n_kinds - 1)
        v_calls += calls_line
        skip_card = page.locator('.npPhone').first.inner_text()
        assert '🕳 缺料' in skip_card and '没硬写' in skip_card, skip_card[:200]
        assert page.locator('.npPhone').count() == n_kinds, '缺料那段要画成空屏占位，不许悄悄少一台'
        assert calls(sw, 'variants') == v_calls, '「🔀 重写这批」force=true 才真的重打这一批'
        print('PASS: 缺料那种摆「🕳 缺料 · 补一条素材再来」的虚线空屏，不给「就用这篇 →」（占位还在）', flush=True)
        # 补了料再点一次「重写这批」：这一批才干净（换线那一步要读这份缓存）
        stub(sw, 'variants', {'skipFirst': False})
        page.locator('.np-wiz-again').click()
        wait_cards(page, n_kinds)
        v_calls += calls_line
        assert page.locator('.npPhone').count() == n_kinds
        print('PASS: 「🔀 重写这批」＝整批按现在的口径重打（5 篇回来了，累计 %d 发）' % v_calls, flush=True)

        # ── 6) 换线＝按新线重打；切回老线读这条线的缓存，不再烧 AI ──
        page.locator('.npWriteType[data-type="%s"]' % other_key).click()
        wait_cards(page, n_other)
        v_calls += calls_other
        assert calls(sw, 'variants') == v_calls, calls(sw, 'variants')
        page.locator('.npWriteType[data-type="%s"]' % line_key).click()
        wait_cards(page, n_kinds)
        page.wait_for_timeout(500)
        assert calls(sw, 'variants') == v_calls, \
            '切回老线读了缓存就不该再烧 AI（现 %s 发）' % calls(sw, 'variants')
        print('PASS: 换线重出新那条线的 %d 篇；切回「%s」读这条线的缓存不重烧 AI（仍是 %d 发）'
              % (n_other, line_key, v_calls), flush=True)

        # ── 7) 点中一篇＝那篇正文直接当 ⑤ 底稿，不再打「从零成稿」那一发 ──
        page.locator('.npVarPick').first.click()
        wait_step(page, 4)
        assert calls(sw, 'draft') == 0, '挑稿进 ⑤ 不该再打成稿那一发'
        assert wiz(page, '!!w.draft.fromVar && w.picked === 0'), '挑中的那篇没当成底稿'
        assert wiz(page, '(npWritePickNow(w) || {}).type') == line_key, '这条落的线没定下来'
        assert wiz(page, '!w.revisePrev && !w.shots && !w.visual && w.voice === ""'), '挑新稿要旧料全作废'
        assert '重新生成' not in body_text(page), '⑤ 不该再摆「🔄 重新生成」（五十三改：重写＝回 ④）'
        print('PASS: ④ 点中一篇 → 线落定 + 那篇正文进 ⑤（成稿那一发 0 次），⑤ 里没有「🔄 重新生成」', flush=True)

        # ── 8) ⑤ 默认逐句视图：点一句只改那一句，其余一字不动 ──
        assert page.locator('#npResult').count() == 0, '⑤ 默认该是逐句视图，不该先铺 textarea'
        sent_count = page.locator('.np-sent-row').count()
        assert sent_count >= 3, sent_count
        before = wiz(page, 'w.draft.content')
        sent0 = page.locator('.np-sent-row').first.inner_text()
        assert sent0 in before
        page.locator('.np-sent-row').first.click()
        page.wait_for_selector('#npSentAsk')
        page.locator('#npSentAsk').fill('短一半，别绕')
        reset_calls(sw)
        page.locator('.np-sent-go').click()
        page.wait_for_function('() => npS().draft.content.indexOf("只改这一句的新说法。") >= 0')
        after = wiz(page, 'w.draft.content')
        assert after != before and sent0 not in after, '逐句改没换掉那一句'
        assert before.replace(sent0, '只改这一句的新说法。', 1) == after, '逐句改动了别的字'
        assert calls(sw, 'sentence') == 1 and calls(sw, 'revise') == 0, '逐句改只打「那一句」那一发'
        assert '短一半，别绕' in sw.evaluate('() => self.aiUser.sentence'), '这句要怎么改要进那一发'
        assert '整篇正文（只当上下文，别重写）' in sw.evaluate('() => self.aiUser.sentence'), '逐句改要带整篇当上下文'
        print('PASS: ⑤ 默认逐句视图——点一句只改那一句（其余一字不差），整篇那一发没被打', flush=True)

        # ── 9) 全文手改 + 整篇改稿原位替换 / 改回上一版（回退不打 AI）──
        hand = after + '\n\n手加的一句。'
        page.locator('.np-draft-mode').click()
        page.wait_for_selector('#npResult')
        assert page.locator('#npResult').input_value() == after
        page.locator('#npResult').fill(hand)
        page.wait_for_function('() => npS().draft.content.indexOf("手加的一句。") >= 0')
        page.locator('.np-draft-mode').click()          # 切回逐句（手改那一笔要跟着落进正文）
        page.wait_for_selector('.np-sent-row')
        reset_calls(sw)
        page.locator('.np-rv-chip').first.click()       # 「更口语一点」＝整篇改
        page.wait_for_function('() => npS().draft.content.indexOf("我算过") >= 0')
        assert calls(sw, 'revise') == 1, calls(sw, 'revise')
        assert not page.locator('.np-rv-undo').get_attribute('hidden'), '改完该给「↩ 改回上一版」'
        page.locator('.np-rv-undo').click()
        page.wait_for_function('() => npS().draft.content.indexOf("我算过") < 0')
        assert wiz(page, 'w.draft.content') == hand, '「改回上一版」要退回手改那一版，一个字都不许多丢'
        assert calls(sw, 'revise') == 1, '改回上一版不该再打 AI'
        print('PASS: ⑤ 全文手改回写正文 + 整篇改稿原位替换；「↩ 改回上一版」退回手改那版且零 AI', flush=True)

        # ── 10) 换标题：AI 给了新标题才换；标签跟着铺回 ──
        page.locator('#npReviseAsk').fill('换个更勾人的标题')
        stub(sw, 'revise', {'titles': ['新标题甲', '新标题乙'], 'tags': ['新标签一', '新标签二']})
        reset_calls(sw)
        page.locator('.np-rv-go').click()
        page.wait_for_function('() => (npS().draft.titles || [])[0] === "新标题甲"')
        assert page.locator('#npTitles input[name="npTitle"]').count() == 2
        assert page.locator('#npTitles input[name="npTitle"]').first.is_checked()
        assert '新标签一' in page.locator('#npTags').inner_text(), page.locator('#npTags').inner_text()
        assert '换个更勾人的标题' in sw.evaluate('() => self.aiUser.revise')
        assert '省时间' in sw.evaluate('() => self.aiUser.revise'), '改稿要把本篇的卖点带上，别写成通用稿'
        assert '★ 本条线' not in sw.evaluate('() => self.aiSys.revise') or '干货线' in sw.evaluate('() => self.aiSys.revise'), \
            '改稿那一发要带着这一条的线（节拍），否则一改就退回通用结构'
        print('PASS: 明确要求换标题才换标题（两选一 + 首条选中），标签一并铺回；那一发带着卖点与本条线', flush=True)

        # ── 11) 改稿失败：报后台真原因，且把 HTML 转义掉，人留着这一版 ──
        keep = wiz(page, 'w.draft.content')
        stub(sw, 'revise', {'error': '测试接口失败 <img src=x onerror=alert(1)>'})
        page.locator('.np-rv-go').click()
        page.wait_for_function('() => document.getElementById("npReviseMsg").textContent.indexOf("测试接口失败") >= 0')
        assert '测试接口失败' in page.locator('#npReviseMsg').inner_text()
        assert page.locator('#npWizBody img').count() == 0, '错误文案里的 HTML 没被转义'
        assert wiz(page, 'w.draft.content') == keep, '改稿失败该保住原来那一版，不许把正文清空'
        expect(page.locator('.np-wiz-next')).to_be_enabled()
        print('PASS: 改稿失败时报出后台真原因（转义摆出）、原版本没被冲掉，人还能接着往下走', flush=True)

        # ── 12) ⑥ 定稿：勾两个平台＝各写一版，小红书那份不重烧 ──
        stub(sw, 'revise', {'error': ''})
        page.locator('.np-wiz-next').click()
        wait_step(page, 5)
        expect(page.locator('.np-pfm')).to_have_count(4)
        assert wiz(page, '(w.platforms || []).join(",")') == 'xhs', '⑥ 默认只勾小红书'
        page.locator('.np-pfm[data-pid="douyin"]').check()
        reset_calls(sw)
        page.locator('.np-ver-go').click()
        page.wait_for_function('() => { const w = npS(); const v = w.verMap && w.verMap.byPid; '
                               'return !!v && v.xhs && v.xhs.ready && v.douyin && v.douyin.ready; }', timeout=30000)
        assert calls(sw, 'derive') == 1, '只该为抖音打一发派生：%s' % calls(sw, 'derive')
        assert calls(sw, 'draft') == 0, '小红书那份用底稿，不该重烧成稿那一发'
        assert calls(sw, 'variants') == 0, '定稿不该回头重写样稿'
        bt = body_text(page)
        assert '做图文' not in bt and '拿去出片' not in bt, '五十四改：⑥ 不再摆「做图文 / 做视频」两路卡，也没有「拿去出片」'
        assert '笔记档案' in bt and '「下一步」' in bt, '⑥ 要指路到档案：要给某一版做料，点那一行的「下一步」'
        print('PASS: ⑥ 定稿＝勾 2 个平台各写一版（抖音 1 发 AI、小红书 0 发），页上只指路到档案', flush=True)

        # ── 13) 各成一档：档案两条，平台 / 正文 / 标题各记各的 ──
        got = page.evaluate(NOTES)
        assert len(got) == 2, got
        byid = {x['platform']: x for x in got}
        assert byid['xhs']['status'] in ('草稿', '待发'), byid['xhs']['status']
        assert byid['douyin']['platform'] == 'douyin' and byid['douyin']['draft'], byid['douyin']
        assert byid['douyin']['title'] != byid['xhs']['title'], '各平台的标题各按各的规矩'
        assert '抖音版' in byid['douyin']['draft'], byid['douyin']['draft'][:80]
        print('PASS: 两版各成一档（%s / %s），档案里各存各的正文与平台'
              % (byid['xhs']['id'], byid['douyin']['id']), flush=True)

        # ── 14) 版本条：点着切（切回一字不差）；↻ 同档覆盖；↗ 事后补一个平台 ──
        assert page.locator('.npVerChip').count() == 2, page.locator('.npVerChip').count()
        assert wiz(page, 'w.platform') == 'xhs', '各版写完不该把人切离小红书那版'
        page.locator('.npVerChip[data-pid="douyin"]').click()
        page.wait_for_function('() => npS().platform === "douyin"')
        dy_text = page.locator('#npResult').input_value()
        assert '抖音版' in dy_text, dy_text[:60]
        page.locator('.npVerChip[data-pid="xhs"]').click()
        page.wait_for_function('() => npS().platform === "xhs"')
        xhs_text = page.locator('#npResult').input_value()
        assert '我算过' in xhs_text, xhs_text[:60]
        page.locator('.npVerChip[data-pid="douyin"]').click()
        page.wait_for_function('() => npS().platform === "douyin"')
        assert page.locator('#npResult').input_value() == dy_text, '切走再切回来正文变了（版本快照没存住）'
        reset_calls(sw)
        page.locator('.npVerRedo[data-pid="douyin"]').click()
        page.wait_for_function('() => !npS().verMap.byPid.douyin.busy', timeout=30000)
        assert calls(sw, 'derive') == 1, calls(sw, 'derive')
        got = page.evaluate(NOTES)
        assert len(got) == 2, '↻ 重写同档覆盖，不许另开一档（现 %d 条）' % len(got)
        assert {x['id'] for x in got} == {byid['xhs']['id'], byid['douyin']['id']}, '重写换了档 id'
        reset_calls(sw)
        page.locator('.np-derive[data-pid="kuaishou"]').click()
        page.wait_for_function('() => { const v = npS().verMap.byPid.kuaishou; return !!v && v.ready; }', timeout=30000)
        assert calls(sw, 'derive') == 1
        assert len(page.evaluate(NOTES)) == 3, '↗ 补的版本要单独成档'
        assert page.locator('.npVerChip').count() == 3
        print('PASS: 版本条点着切（切回一字不差）· ↻ 重写同档覆盖不新开 · ↗ 补一版另成档（3 档 3 chip）', flush=True)

        # ── 15) 📋 复制这版发布文案＝标题 + 正文 + 标签 ──
        cur_title = wiz(page, '(w.draft.titles || [])[0] || ""')
        cur_body = page.locator('#npResult').input_value()
        page.evaluate('() => { window.__clip = ""; }')
        page.locator('.np-copy-all').first.click()
        page.wait_for_function('() => (window.__clip || "").length > 10')
        clip = page.evaluate('window.__clip')
        assert cur_title in clip and cur_body in clip, clip[:160]
        assert '#补版标签' in clip, clip[:200]
        print('PASS: 「📋 复制这版发布文案」带着当前那版的标题 + 正文 + 标签（%d 字）' % len(clip), flush=True)

        # ── 16) 换稿作废：回 ④ 另挑一篇，旧分镜表 / 旧提示词 / 旧口播稿一并清掉 ──
        page.evaluate('''() => { const w = npS();
            w.shots = {items: [{text: '旧段', imgs: []}], cover: '旧封面', style: '旧令牌'};
            w.visual = {images: ['旧的一套提示词']}; w.voice = '旧口播稿'; }''')
        page.locator('.np-wiz-prev').click()
        wait_step(page, 4)
        page.locator('.np-wiz-prev').click()
        wait_step(page, 3)
        wait_cards(page, n_kinds)
        assert calls(sw, 'variants') == 0, '回 ④ 读这条线的缓存，不该重烧 AI'
        page.locator('.npVarPick').nth(1).click()
        wait_step(page, 4)
        cleared = wiz(page, '[w.shots, w.visual, w.voice]')
        assert cleared[0] is None and cleared[1] is None and cleared[2] == '', cleared
        assert wiz(page, '!!w.draft.fromVar && w.picked === 1'), '另挑的那篇没换成底稿'
        print('PASS: 回 ④ 读缓存（零 AI）另挑一篇＝旧分镜表 / 旧图文提示词 / 旧口播稿一并作废', flush=True)

        # ── 17) AI 没按 JSON 回：整段文案也算成稿，不卡「去发稿」──
        stub(sw, 'draft', {'raw': LOOSE})
        reset_calls(sw)
        page.evaluate('() => { const w = npS(); w.platform = "xhs"; w.draft = null; '
                      'w.verMap = null; w.verSeed = null; w.verBaseSnap = null; '
                      'npWizRender(_npActiveContainer); }')   # ⑤ 没有底稿时自己补那一发（真实路径）
        wait_draft(page, '第二段照样能用')
        assert calls(sw, 'draft') >= 1, '⑤ 那一发没打成 draft 家族：%s' % sw.evaluate('() => JSON.stringify(self.aiCalls)')
        assert wiz(page, '!!w.draft.loose'), '非 JSON 的整段文案没兜成 loose 稿'
        assert '没按格式交稿' in page.locator('#npDraftStatus').inner_text(), '兜底要说明白，别让人以为是正常成稿（六十九改白话化后＝「没按格式交稿」）'
        expect(page.locator('.np-wiz-next')).to_be_enabled()
        print('PASS: AI 没按 JSON 回时整段文案也兜成 ⑤ 的成稿（loose）并说明一句，「改好了 · 去发稿」不卡住', flush=True)

        # ── 18) 成稿那一发失败：报真原因、挡在原地，恢复后立刻写成 ──
        stub(sw, 'draft', {'raw': None, 'error': '测试成稿失败'})
        page.evaluate('() => { npS().draft = null; npWizRender(_npActiveContainer); }')
        page.wait_for_function('() => document.getElementById("npDraftStatus").textContent.indexOf("测试成稿失败") >= 0',
                               timeout=30000)
        assert page.locator('#npWizBody img').count() == 0, '失败文案里的 HTML 没被转义'
        page.locator('.np-wiz-next').click()
        expect(page.locator('#popToastBox')).to_contain_text('成稿还没写出来')
        assert wiz(page, '_npWiz.step') == 4, '成稿没出来就点下一步不该走'
        stub(sw, 'draft', {'error': '', 'content': DRAFT_CONTENT})
        page.evaluate('() => { npS().draft = null; npWizRender(_npActiveContainer); }')
        wait_draft(page, '主页简介')
        expect(page.locator('.np-wiz-next')).to_be_enabled()
        print('PASS: 成稿失败时 ⑤ 摆出后台真原因、下一步亮着但点了提示「成稿还没写出来」，恢复后立刻写成', flush=True)

        # ── 19) 七十改：做料从档案那行「下一步」进「🖼 出图」（旧的「🎬 渲染任务」表整页已撤）；不加行＝一发 AI 都不烧 ──
        # 造一篇「一个活都没有」的档摆进档案（不然这一页可能摊着别的篇的料，验不到空态）
        page.evaluate('''async () => { const k = await chrome.storage.local.get("np_notes");
            const list = (k && k.np_notes) || [];
            list.unshift({ id: 'draft-nojob', platform: 'xhs', form: '图文', origin: 'manual',
              title: '空活的一篇', draft: '先说结论：这一篇还没有一个活。\\n\\n想看具体怎么排：主页简介里找。',
              tags: [], status: '待发', updatedAt: Date.now(), derivedFrom: 'draft-nojob',
              imgDocs: [], filmDocs: [], shots: null, visual: null, voice: '' });
            await chrome.storage.local.set({ np_notes: list }); }''')
        reset_calls(sw)
        page.evaluate('''async () => {
            const list = await npNotesAll();
            switchMainTab('noteOut', list.find(x => x && x.id === 'draft-nojob') || null);
        }''')
        page.wait_for_function('() => _npMode === "out" && !!document.querySelector("#npImgTabs .np-imgtab")')
        page.wait_for_timeout(800)
        total = '() => Object.values(self.aiCalls || {}).reduce((a, b) => a + (b || 0), 0)'
        assert sw.evaluate(total) == 0, '进出图这一页不该自动打 AI：%s' % sw.evaluate('() => JSON.stringify(self.aiCalls)')
        assert page.evaluate('() => (npS().imgDocs || []).length') == 0, '没加行＝一行图都没有'
        page.locator('#npImgTabs .np-imgtab[data-t="desc"]').click()
        page.wait_for_function('() => !!document.querySelector("#npShotTable .np-img-add")')
        assert '还没有一行图' in page.locator('#npShotTable').inner_text(), '④ 空态先说清第一步：这一篇还没有一行图'
        page.locator('#npShotTable .np-img-add').click()
        page.wait_for_function('() => (npS().imgDocs || []).length === 1 && !!npS().imgOpen')
        assert sw.evaluate(total) == 0, '「＋ 起一套图（跟账号默认）」一点开工也不该烧 AI'
        print('PASS: 做料走档案那行「下一步」→ 出图（旧的渲染任务表已撤）→ 零 AI：④ 空态先说清第一步，起一套图不烧 AI', flush=True)

        page.screenshot(path=str(OUT / 'xhs-note-draft-chain.png'))
        print('SHOT: %s' % (OUT / 'xhs-note-draft-chain.png'), flush=True)
        assert not ERRORS, '有 pageerror：%s' % ERRORS[:2]
        print('PASS: 无 pageerror', flush=True)
    finally:
        ctx.close()

print('\n全绿：写文案 ①→⑥ 主链（挑稿 / 逐句改 / 各平台定稿 / 版本条 / 复制 / 作废 · 2026-10-02 重建版）', flush=True)
