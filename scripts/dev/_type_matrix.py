"""五条线对照跑（真扩展 + 桩 AI）：同一个选题、同一个调子，只换「这一篇写哪条线 × 哪种写法」。

跑法：python3 scripts/dev/_type_matrix.py
产物：tmp/type-matrix/<序号>-<type>.txt（这一发真实的 system + user 全文）
      tmp/type-matrix/prompts.json（结构化：每类的 prompt + 类型行 / 类型块 / 目标行 / 凭据行）

做什么：在临时 profile 里加载真扩展（msedge），预置一份「六条同题、线×写法各不相同」的排产表，
        在 ③ 选话题那一步点「按这条写」接上规划里的下一篇，走到 ⑤ 触发成稿那一发；
        桩只**记录**不生成——拿到的是真机上 AI 收到的逐字提示词。

为什么这么跑：调子（8 条）已经验过一轮（见 _style_matrix.py）；老板拿"是什么"重排了口径——
        五条线（故事/共鸣/热梗/热点/干货）× 各 4-5 种写法，写法是**用户手里能挑的**。
        这里把调子焊死，唯一变量＝线 × 写法。

验的四件事：
  1) 五条线的提示词**确实各不相同**（类型行 / 目标行 / 类型块各自 5 种）
  2) 同一条线换写法，类型块跟着换（写法也在决定形态，不只是个标签）
  3) 线 × 写法是配对的（写法名要出现在类型行里）
  4) 除了类型那几行，其余上下文逐字一致（选题 / 调子 / 卖点 / 人群 / 知识库 / 话术比例都没动）
"""
import json
import os
import pathlib
import re
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
KB_FILE = ROOT / '资料' / '小红书AI引流工具知识库.json'
# 换个选题对照用：TM_TOPIC='...' TM_OUT=tmp/type-matrix-b python3 scripts/dev/_type_matrix.py
OUT = ROOT / (os.environ.get('TM_OUT') or 'tmp/type-matrix')

# 调子焊死（账号默认），唯一变量＝类型。story＝老板说「没很多问题」的自我陈述那条，当已知良好基线
ROUTE = os.environ.get('TM_ROUTE') or 'story'
TOPIC = os.environ.get('TM_TOPIC') or '我妈以为我在刷手机，其实我在店里捞客户'
SELL = '不用天天守着手机，一个人也能把客户接住'
CRED = '做小红书运营 3 年，带过 40 多个小生意账号'

# 五条线 × 一条代表性写法 × 这一线这一轮要干嘛（goal）：前五条＝五条线各一，
# 第六条＝同一条线（故事线）换一种写法——用来证明"写法"也在决定形态，不只是个标签
TYPES = [
    {'type': 'tale',  'kind': 'scene',   'goal': '添人味', 'scope': 'related'},
    {'type': 'echo',  'kind': 'mirror',  'goal': '换认同', 'scope': 'related'},
    {'type': 'meme',  'kind': 'docform', 'goal': '破圈',   'scope': 'breakout'},
    {'type': 'hot',   'kind': 'hotFit',  'goal': '破圈',   'scope': 'breakout'},
    {'type': 'howto', 'kind': 'steps',   'goal': '换收藏', 'scope': 'related'},
    {'type': 'tale',  'kind': 'history', 'goal': '提调性', 'scope': 'related'},
]
LINES = 5   # 前 5 条＝五条线各一；第 6 条是故事线的第二种写法

PEOPLE = [{'name': '一个人看店的小老板', 'pain': '顾着生意就没空发内容', 'scene': '店里没客人的空档', 'timing': '随时'}]
SELL_POINTS = [
    {'title': '不用天天守着手机', 'content': '评论区、私信、回访这些活排好队自己跑'},
    {'title': '一个人也顶一个运营', 'content': '诊断、选题、写稿、回评论，一条链都在一个插件里'},
]
PERSONA = '我是做小红书运营的杨小过，一个人做工具、也带小生意跑号，擅长把获客这些活做成能自动跑的样子'

CONCEPT = {
    'people_options': PEOPLE,
    'topics': [{'topic': TOPIC, 'angle': '从身边人的误解切入', 'target': '一个人看店的小老板', 'rationale': '有画面、能带出真实做法'}],
}
NOTE = {
    'titles': ['桩稿标题A', '桩稿标题B', '桩稿标题C'],
    'content': '桩稿正文。\n\n桩稿第二段。',
    'tags': ['桩稿标签'],
    'timeTip': '12:00-13:00',
}
# 排产表：六条同题、线与写法各不相同。成稿时 title 会盖过 ③ 的话题，所以六篇的【话题】逐字相同
PLAN = {
    'v': 3, 'stage': 'cold', 'stageName': '冷启动期', 'stageNote': '还没立起信任', 'accountType': '',
    'perWeek': 3, 'timing': '12:00-13:00',
    'items': [{
        'no': i + 1, 'title': TOPIC, 'angle': '从身边人的误解切入', 'type': t['type'], 'kind': t['kind'],
        'goal': t['goal'], 'scope': t['scope'], 'credential': CRED, 'kb': '',
    } for i, t in enumerate(TYPES)],
}

kb_seed = []
if KB_FILE.exists():
    raw = json.loads(KB_FILE.read_text(encoding='utf-8'))
    kb_seed = raw if isinstance(raw, list) else (raw.get('entries') or raw.get('knowledge_base') or [])


def pick(block, needle, default=''):
    for line in block.split('\n'):
        if needle in line:
            return line.strip()
    return default


TYPE_LINE = '★ 本篇是账号内容规划里的第'
GOAL_LINE = '★ 这一类在这一轮是要干嘛：'
CRED_LINE = '★ 本篇凭据：'
# 类型块（三十九改）：从「★ 这一篇是"…"」到类样本，整块都是变量，剥掉后其余应当逐字一致
TYPEBLOCK_PREFIX = ['★ 这一篇是「', '· 分工', '· 这一类必须走过的节拍',
                    '· 这一类要写出来的东西', '· 这一类的戒条', '★ 类样本']
BEAT_RE = re.compile(r'^\s+\d+\.\s')


def strip_type(txt):
    """剥掉类型块（那三行 + 三十九改的节拍/必须/戒条/类样本）——剩下应当八篇逐字一致"""
    keep = []
    for l in txt.split('\n'):
        if l.startswith(TYPE_LINE) or l.startswith(GOAL_LINE) or l.startswith(CRED_LINE):
            continue
        if any(l.startswith(p) for p in TYPEBLOCK_PREFIX) or BEAT_RE.match(l):
            continue
        keep.append(l)
    return '\n'.join(keep)


def grab_typeblock(txt):
    """把类型块整块捞出来（断言与对照报告都用它）"""
    return '\n'.join(l for l in txt.split('\n')
                     if any(l.startswith(p) for p in TYPEBLOCK_PREFIX) or BEAT_RE.match(l))


with tempfile.TemporaryDirectory(prefix='xhs-type-matrix-') as profile, sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        profile, headless=False, channel='msedge',
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    try:
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
        sw.evaluate('''async (payload) => {
            await Storage.initializeDefaults(DEFAULT_PROMPTS);
            await ensureTenantInit();
            const config = await Storage.getConfig();
            config.product.name = '小红书AI引流工具';
            config.product.description = '装在电脑浏览器里的运营助手：账号诊断、内容规划、评论区动作、客户维护';
            config.product.sellPoints = payload.sellPoints;
            config.persona = { text: payload.persona };
            config.ai.apiKey = 'test-local-only';
            config.noteStyle = { route: payload.route };
            await Storage.setConfig(config);
            await Storage.importKnowledgeBase(payload.kb);
            await chrome.storage.local.set({ note_plan: payload.plan });   // ③ 那一步的「按规划发」
            self.testDraftPrompts = [];
            self.testDraftMaxTokens = [];
            self.testNoteRaw = payload.note;
            self.testConceptRaw = payload.concept;
            const _orig = AiClient.chatCompletion;
            AiClient.chatCompletion = async (cfg, system, user) => {
                const sys = String(system || '');
                const call = async (text) => { await new Promise(r => setTimeout(r, 0)); return {content: text}; };
                if (sys.includes('爆款图文笔记写手')) {
                    self.testDraftPrompts.push({system: sys, user: String(user || '')});
                    self.testDraftMaxTokens.push(cfg && cfg.maxTokens);
                    return call(self.testNoteRaw);
                }
                // ④ 挑稿那一发（同题写一批）不是这轮要的东西：挡掉，不烧真 AI
                if (sys.includes('同题写一批')) return call('{"variants":[]}');
                const concept = JSON.parse(self.testConceptRaw);
                if (sys.includes('候选话题')) return call(JSON.stringify({topics: concept.topics}));
                return call(JSON.stringify({people_options: concept.people_options}));
            };
        }''', {'sellPoints': SELL_POINTS, 'persona': PERSONA, 'route': ROUTE,
               'note': json.dumps(NOTE, ensure_ascii=False),
               'concept': json.dumps(CONCEPT, ensure_ascii=False),
               'plan': PLAN,
               'kb': kb_seed})

        page = ctx.new_page()
        page.set_default_timeout(25000)
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        popup_url = sw.url.replace('background.js', 'popup.html?mode=big')

        def sw_wait(expr, timeout=25.0):
            t0 = time.monotonic()
            while time.monotonic() - t0 < timeout:
                if sw.evaluate(expr):
                    return True
                time.sleep(0.15)
            raise AssertionError('等超时：%s' % expr)

        def run_one(no, n):
            page.goto(popup_url)
            page.wait_for_function('typeof _npWiz !== "undefined" && typeof switchMainTab === "function"')
            if page.locator('#fsClose').is_visible():
                page.locator('#fsClose').click()
            page.locator('#tabNotePublish').click()
            expect(page.locator('.np-spk').first).to_be_visible()
            page.locator('.np-spk').first.check()
            page.locator('.np-wiz-next').click()
            page.wait_for_function('() => !!document.querySelector(".np-ppc")')
            page.locator('.np-ppc').first.check()
            page.locator('.np-wiz-next').click()
            # ③：接规划里的「下一篇」（第一条未成稿的）
            page.wait_for_function('() => !!document.querySelector("#npPlanUse") || !!document.querySelector(".np-tpc")')
            expect(page.locator('#npPlanUse')).to_be_visible()
            page.locator('#npPlanUse').click()
            page.wait_for_function('() => !!(_npWiz && _npWiz.planItem)')
            got_no = page.evaluate('_npWiz.planItem.no')
            assert got_no == no, '该接上第 %d 篇，实际第 %s 篇' % (no, got_no)
            page.locator('.np-wiz-next').click()
            assert page.evaluate('_npWiz.step') == 3, '该停在 ④ 挑稿'
            assert page.evaluate('(_npWiz.noteStyle || {}).route') == ROUTE, '调子没焊住'
            page.locator('.npStyleToggle').first.click()    # 旋钮折在「就改这一条」里，先展开
            page.locator('.npStyleWords[data-words="long"]').first.click()
            assert page.evaluate('(_npWiz.noteStyle || {}).words') == 'long', '字数没点上「长」'
            page.locator('.np-wiz-next').click()
            sw_wait('() => self.testDraftPrompts.length >= %d' % n)
            return page.evaluate('_npWiz.step')

        recs = []
        for i, t in enumerate(TYPES, 1):
            step = run_one(i, i)
            prompt = sw.evaluate('(n) => self.testDraftPrompts[n - 1]', i)
            toks = sw.evaluate('(n) => self.testDraftMaxTokens[n - 1]', i)
            sysblk, userblk = prompt['system'], prompt['user']
            rec = {
                'n': i, 'type': t['type'], 'kind': t['kind'], 'goal': t['goal'], 'step': step, 'maxTokens': toks,
                'typeLine': pick(sysblk, TYPE_LINE),
                'typeBlock': grab_typeblock(sysblk),
                'goalLine': pick(sysblk, GOAL_LINE),
                'credLine': pick(sysblk, CRED_LINE),
                'style': pick(sysblk, '★ 这篇的调子＝'),
                'user': userblk, 'system': sysblk,
            }
            recs.append(rec)
            OUT.mkdir(parents=True, exist_ok=True)
            (OUT / ('%d-%s-%s.txt' % (i, t['type'], t['kind']))).write_text(
                'type=%s  kind=%s  goal=%s  maxTokens=%s  step=%d\n\n=== SYSTEM ===\n%s\n\n=== USER ===\n%s\n'
                % (t['type'], t['kind'], t['goal'], toks, step, sysblk, userblk), encoding='utf-8')
            print('%d/%d %-8s %-9s 停在 ⑤=%s  maxTokens=%s' % (i, len(TYPES), t['type'], t['kind'], step == 4, toks))
            print('    类型行: %s' % rec['typeLine'][:120])

        lines5, extra = recs[:LINES], recs[LINES:]
        # ── 断言 1：五条线的类型行 / 目标行 / 类型块各自 5 种 ──────────────────────
        for key in ('typeLine', 'goalLine', 'typeBlock'):
            vals = [r[key] for r in lines5]
            assert len(set(vals)) == LINES, '%s 只有 %d 种，五条线没区分开' % (key, len(set(vals)))
        leak = [k for t in TYPES for k in (t['type'], t['kind']) if any(k in r['typeLine'] for r in lines5)]
        assert not leak, '类型行里漏出了键名（该给中文名）：%s' % leak
        print('PASS: 五条线的类型行 / 目标行 / 类型块各 %d 种' % LINES)

        # ── 断言 1b：类型块整块都在，且五块两两不同 ────────────────────────────────
        for r in lines5:
            tb = r['typeBlock']
            assert '· 这一类必须走过的节拍（顺序别颠倒）：' in tb, r['type'] + ' 的类型块没有节拍'
            assert '· 这一类要写出来的东西' in tb, r['type'] + ' 的类型块没有"要写出来的东西"'
            assert '· 这一类的戒条' in tb, r['type'] + ' 的类型块没有戒条'
            assert '★ 类样本' in tb, r['type'] + ' 的类型块没有类样本'
            assert len(tb) >= 400, r['type'] + ' 的类型块太薄（%d 字）' % len(tb)
        beats = [tuple(l.strip() for l in r['typeBlock'].split('\n') if BEAT_RE.match(l)) for r in lines5]
        assert len(set(beats)) == LINES, '五条线的节拍有重复——线又变回标签了'
        print('PASS: 类型块整块喂进去了（节拍/要写出来的东西/戒条/类样本），五块两两不同，最短 %d 字'
              % min(len(r['typeBlock']) for r in lines5))

        # ── 断言 1c：同一条线换写法，类型块跟着换（写法也管形态）──────────────────
        if extra:
            a, b = lines5[0], extra[0]     # tale·现场故事 vs tale·历史文化
            assert '故事线' in a['typeLine'] and '故事线' in b['typeLine'], '这两条该是同一条线'
            assert a['kind'] != b['kind']
            assert a['typeBlock'] != b['typeBlock'], '同一条线换写法、类型块却一模一样——写法只是标签'
            assert a['typeLine'] != b['typeLine'], '写法名该出现在类型行里'
            print('PASS: 同一条线（故事线）换写法 → 类型行与类型块跟着换')

        # ── 断言 2：线与写法配对（每行只挂自己那一种写法）─────────────────────────
        KINDNAME = {'scene': '现场故事', 'mirror': '处境对号入座', 'docform': '文体切换',
                    'hotFit': '热点理解→产品感悟', 'steps': '教程步骤', 'history': '历史文化'}
        for r in recs:
            assert KINDNAME[r['kind']] in r['typeLine'], '%s·%s 的写法名没跟上：%s' % (r['type'], r['kind'], r['typeLine'])
        print('PASS: 线 × 写法各自配对正确（写法名都在类型行里）')

        # ── 断言 3：除类型那几行外，上下文逐字一致 ──────────────────────────────
        base = strip_type(recs[0]['system'])
        for r in recs[1:]:
            assert strip_type(r['system']) == base, r['type'] + '：除类型块外还有别的地方被改动了'
            assert r['user'] == recs[0]['user'], r['type'] + '：user 那一半不一样了'
        print('PASS: 除类型块外，system 其余各行与 user 全文 %d 条逐字一致' % len(recs))
        print('      调子：%s' % recs[0]['style'][:90])
        print('      选题：%s' % TOPIC)

        assert not errors, '页面报错：%s' % errors[:3]
        OUT.joinpath('prompts.json').write_text(
            json.dumps(recs, ensure_ascii=False, indent=2), encoding='utf-8')
        print('\n已写盘：', OUT)
    finally:
        ctx.close()
