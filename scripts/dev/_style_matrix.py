"""八条叙事风格对照跑（真扩展 + 桩 AI）：同一个选题、同一个卖点/人群/话术比例，只换调子。

跑法：python3 scripts/dev/_style_matrix.py
产物：tmp/style-matrix/<序号>-<route>.txt（这一发真实的 system + user 全文）
      tmp/style-matrix/prompts.json（结构化：每条调子的 prompt + 骨架行 / 配比行 / 戒条行 / 字数行）

做什么：在临时 profile 里加载真扩展（msedge），把「账号调子」依次设成 8 条路线，
        字数在 ④ 步点「长」，走到 ⑤ 触发成稿那一发；桩只**记录**不生成——
        所以这里拿到的提示词与真机上 AI 收到的逐字一致（成稿文字留给后面那一步生成）。

验的三件事：
  1) 8 条调子的提示词**确实各不相同**（配比数字 / 戒条 / 骨架至少一处不同）
  2) 字数点「长」后，8 条都进到 800-1500 字档（不是各自建议档）
  3) 除了调子块，其余上下文逐字一致（选题 / 卖点 / 人群 / 知识库 / 卖货话术比例都没被顺手改动）
"""
import json
import os
import pathlib
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
# 换个选题对照用：SM_TOPIC='...' SM_OUT=tmp/style-matrix-b python3 scripts/dev/_style_matrix.py
OUT = ROOT / (os.environ.get('SM_OUT') or 'tmp/style-matrix')

ROUTES = ['literary', 'story', 'absurd', 'punchy', 'sharp', 'slice', 'science', 'qna']

# 本次对照的固定输入：只换调子，别的都不动
TOPIC = os.environ.get('SM_TOPIC') or '我妈以为我在刷手机，其实我在店里捞客户'
SELL = '不用天天守着手机，一个人也能把客户接住'
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

kb_seed = []
if KB_FILE.exists():
    raw = json.loads(KB_FILE.read_text(encoding='utf-8'))
    kb_seed = raw if isinstance(raw, list) else (raw.get('entries') or raw.get('knowledge_base') or [])


def pick(block, needle, default=''):
    for line in block.split('\n'):
        if needle in line:
            return line.strip()
    return default


with tempfile.TemporaryDirectory(prefix='xhs-style-matrix-') as profile, sync_playwright() as p:
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
            config.noteStyle = { route: payload.routes[0] };
            await Storage.setConfig(config);
            await Storage.importKnowledgeBase(payload.kb);
            self.testDraftPrompts = [];
            self.testDraftMaxTokens = [];
            self.testNoteRaw = payload.note;
            self.testConceptRaw = payload.concept;
            // 桩：只记录这一发的 system + user，不生成正文（提示词与真机逐字一致）
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
        }''', {'sellPoints': SELL_POINTS, 'persona': PERSONA, 'routes': ROUTES,
               'note': json.dumps(NOTE, ensure_ascii=False),
               'concept': json.dumps(CONCEPT, ensure_ascii=False),
               'kb': kb_seed})

        page = ctx.new_page()
        page.set_default_timeout(25000)
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        popup_url = sw.url.replace('background.js', 'popup.html?mode=big')

        def sw_wait(expr, timeout=25.0):
            """等 service worker 里的表达式成立（page.wait_for_function 够不到 SW 的全局）"""
            t0 = time.monotonic()
            while time.monotonic() - t0 < timeout:
                if sw.evaluate(expr):
                    return True
                time.sleep(0.15)
            raise AssertionError('等超时：%s' % expr)

        def set_route(rk):
            sw.evaluate('''async (rk) => {
                const cfg = await Storage.getConfig();
                cfg.noteStyle = { route: rk };
                await Storage.setConfig(cfg);
                return cfg.noteStyle;
            }''', rk)

        def run_one(rk, n):
            tmp = '_npWiz'
            set_route(rk)
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
            # ③ 话题自动勾第一个 → ④ 挑稿（线 × 写法 × 调子）
            page.wait_for_function('() => !!document.querySelector(".np-tpc:checked")')
            page.locator('.np-wiz-next').click()
            assert page.evaluate('_npWiz.step') == 3, '该停在 ④ 挑稿'
            expect(page.locator('#npWizBody')).to_contain_text('④ 挑稿')
            assert page.evaluate('(_npWiz.styleDefault || {}).route') == rk, '账号默认调子没跟着切'
            assert page.evaluate('(_npWiz.noteStyle || {}).route') == rk, '这一条没沿用账号默认调子'
            # 🖋 字数点「长」——这一趟就是要看长文的差别（旋钮折在「就改这一条」里，先展开）
            page.locator('.npStyleToggle').first.click()
            page.locator('.npStyleWords[data-words="long"]').first.click()
            assert page.evaluate('(_npWiz.noteStyle || {}).words') == 'long', '字数没点上「长」'
            page.locator('.np-wiz-next').click()
            sw_wait('() => self.testDraftPrompts.length >= %d' % n)
            return page.evaluate('_npWiz.step')

        recs = []
        for i, rk in enumerate(ROUTES, 1):
            step = run_one(rk, i)
            prompt = sw.evaluate('(n) => self.testDraftPrompts[n - 1]', i)
            toks = sw.evaluate('(n) => self.testDraftMaxTokens[n - 1]', i)
            sysblk, userblk = prompt['system'], prompt['user']
            rec = {
                'route': rk, 'step': step, 'maxTokens': toks,
                'style': pick(sysblk, '★ 这篇的调子＝'),
                'shape': pick(sysblk, '· 篇幅配比'),
                'taboo': pick(sysblk, '· 戒条'),
                'words': pick(sysblk, '· 字数：'),
                'user': userblk,
                'system': sysblk,
            }
            recs.append(rec)
            OUT.mkdir(parents=True, exist_ok=True)
            (OUT / ('%d-%s.txt' % (i, rk))).write_text(
                'route=%s  maxTokens=%s  step=%d\n\n=== SYSTEM ===\n%s\n\n=== USER ===\n%s\n'
                % (rk, toks, step, sysblk, userblk), encoding='utf-8')
            print('%d/%d %-8s 停在 ⑤=%s  maxTokens=%s' % (i, len(ROUTES), rk, step == 4, toks))
            print('    调子  : %s' % rec['style'][:96])
            print('    配比  : %s' % rec['shape'][:110])
            print('    戒条  : %s' % rec['taboo'][:96])

        # ── 断言 1：8 条调子块确实不同（骨架 / 戒条各自 8 种；配比允许撞车——punchy/science/qna
        #    都是「不铺垫」那一路，数字本来就该一样，靠骨架与戒条区分）──────────────────
        for key in ('style', 'taboo'):
            vals = [r[key] for r in recs]
            assert len(set(vals)) == len(ROUTES), '%s 只有 %d 种，调子没区分开' % (key, len(set(vals)))
        combo = set((r['style'], r['shape'], r['taboo']) for r in recs)
        assert len(combo) == len(ROUTES), '有两条调子的提示词完全一样'
        print('PASS: 调子块区分得开——骨架 %d 种 / 戒条 %d 种 / 配比 %d 种（配比撞车的靠骨架与戒条区分）'
              % (len(set(r['style'] for r in recs)), len(set(r['taboo'] for r in recs)),
                 len(set(r['shape'] for r in recs))))

        # ── 断言 2：字数都进了「长」档 ──────────────────────────────────
        for r in recs:
            assert '800-1500 字' in r['words'], r['route'] + ' 的字数没进长档：' + r['words']
        print('PASS: 8 条都按「长」（800-1500 字）写')

        # ── 断言 3：除调子块外，上下文逐字一致 ──────────────────────────
        # 调子块＝骨架 / 配比 / 强度 / 戒条 / 字数 + 语气版式 + 样本；剥掉这些，剩下的应当 8 条逐字一致
        def strip_style(txt):
            return '\n'.join(l for l in txt.split('\n')
                             if not (l.startswith('★ 这篇的调子＝') or l.startswith('· 第一优先级：')
                                     or l.startswith('· 篇幅配比') or l.startswith('· 本条')
                                     or l.startswith('· 强度')
                                     or l.startswith('· 语气与版式')
                                     or l.startswith('· 开头：') or l.startswith('· 主体：')
                                     or l.startswith('· 收口时机：') or l.startswith('· 结尾：')
                                     or l.startswith('· 取材：') or l.startswith('· 戒条')
                                     or l.startswith('· 字数：') or l.startswith('★ 调子样本')))
        base = strip_style(recs[0]['system'])
        for r in recs[1:]:
            assert strip_style(r['system']) == base, r['route'] + '：除调子块外还有别的地方被改动了'
            assert r['user'] == recs[0]['user'], r['route'] + '：user 那一半不一样了'
        print('PASS: 除调子块外，system 其余各行与 user 全文 8 条逐字一致（选题/卖点/人群/知识库/话术比例都没动）')

        assert not errors, '页面报错：%s' % errors[:3]
        OUT.joinpath('prompts.json').write_text(
            json.dumps([dict([('topic', TOPIC)] + [(k, r[k]) for k in ('route', 'maxTokens', 'style', 'shape', 'taboo', 'words', 'system', 'user')])
                        for r in recs], ensure_ascii=False, indent=2), encoding='utf-8')
        print('\n选题：', TOPIC)
        print('已写盘：', OUT)
    finally:
        ctx.close()
