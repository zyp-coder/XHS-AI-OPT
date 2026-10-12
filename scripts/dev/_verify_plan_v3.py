"""v3 笔记规划 · 真机眼看（Edge + 真扩展 + 假 AI，全程截图取证）

跑法：python3 scripts/dev/_verify_plan_v3.py
产物：tmp/plan-v3-shots/*.png ＋ 终端里 note_plan / note_plan_mix 的读数

验的四件事：
  1. ⑨ 点「重新生成规划与评估」出的排产表：按配比排 12 篇、每篇带「线 · 写法」、破圈/系列/凭据都在
  2. ⚖️ 配比条：± 就地折算下一批篇数 → 保存落 note_plan_mix → 刷新还在 → 恢复默认清掉
  3. 发笔记「📚 按规划发」：③ 里摆出规划里那篇 → 按这条写 → 成稿按它的类型/写法/目标写
  4. 全链路不再出现「档位」口径（都卖）
"""
import json
import pathlib
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright, expect

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = pathlib.Path(__file__).resolve().parents[2]
SHOTS = ROOT / 'tmp' / 'plan-v3-shots'
STATE = {'requests': [], 'problems': []}

# 假 AI：排产按冷启动默认配比（干货线4 故事线3 共鸣线2 热梗线2 热点线1）出 12 篇
PLAN = {
    'contentFocus': '小工具怎么用、怎么挑',
    'targetPeople': '初次使用的客户',
    'accountType': '教程/步骤型',
    'stageNote': '粉丝还少，先攒同类再谈转化',
    'rhythm': '每周两篇，晚上发',
    'perWeek': 2,
    'timing': '晚上',
    'pinned': {'title': '我是谁 + 我能给你什么 + 去哪找我', 'outline': '人设一句话｜价值清单｜私信我'},
    'items': [
        {'no': 1, 'title': '第一次用按这 3 步走', 'angle': '分步教程', 'type': 'howto', 'kind': 'steps', 'scope': 'related', 'credential': '做这行 5 年', 'arc': {'name': '新手避坑三讲', 'part': 1, 'total': 3, 'closing': False}},
        {'no': 2, 'title': '上手前先看这 4 个数', 'angle': '清单', 'type': 'howto', 'kind': 'list', 'scope': 'related', 'credential': '做这行 5 年', 'arc': {'name': '新手避坑三讲', 'part': 2, 'total': 3, 'closing': False}},
        {'no': 3, 'title': '这类情况别硬上', 'angle': '鉴别避坑', 'type': 'howto', 'kind': 'pitfall', 'scope': 'related', 'credential': '做这行 5 年', 'arc': {'name': '新手避坑三讲', 'part': 3, 'total': 3, 'closing': True}},
        {'no': 4, 'title': '这笔账到底怎么算', 'angle': '算账对比', 'type': 'howto', 'kind': 'calc', 'scope': 'related', 'credential': '做这行 5 年'},
        {'no': 5, 'title': '备货那天从早忙到晚', 'angle': '经营现场', 'type': 'tale', 'kind': 'scene', 'scope': 'samePeople', 'credential': '亲身经历'},
        {'no': 6, 'title': '我自己也翻过车', 'angle': '自曝踩坑', 'type': 'tale', 'kind': 'myway', 'scope': 'related', 'credential': '亲身经历'},
        {'no': 7, 'title': '这个叫法是怎么来的', 'angle': '历史文化', 'type': 'tale', 'kind': 'history', 'scope': 'related', 'credential': '做这行 5 年'},
        {'no': 8, 'title': '那几年我也这么想过', 'angle': '处境对照', 'type': 'echo', 'kind': 'mirror', 'scope': 'samePeople', 'credential': '做这行 5 年'},
        {'no': 9, 'title': '有句话我替你说了吧', 'angle': '替你说出口', 'type': 'echo', 'kind': 'rant', 'scope': 'related', 'credential': '做这行 5 年'},
        {'no': 10, 'title': '如果把这件事写成一份判决书', 'angle': '文体切换', 'type': 'meme', 'kind': 'docform', 'scope': 'related', 'credential': '做这行 5 年'},
        {'no': 11, 'title': '把挑工具当成一场球赛', 'angle': '场景切换', 'type': 'meme', 'kind': 'sceneswap', 'scope': 'samePeople', 'credential': '做这行 5 年'},
        {'no': 12, 'title': '留在大城市还是回老家', 'angle': '泛话题', 'type': 'hot', 'kind': 'hotFit', 'scope': 'breakout', 'credential': '做这行 5 年'},
    ],
}
REPORT = {
    'overall': '定位清楚，简介还差一句给谁看',
    'summary': '账号处于起步阶段，内容方向已经聚焦。',
    'positioning': {'issue': '简介没讲清为谁服务', 'suggestion': '补一句服务对象'},
    'personaReview': {'issue': '人设偏泛', 'suggestion': '加一条真实经历'},
    'kbReview': {'issue': '知识条目偏少', 'suggestion': '把常用问答补进来'},
    'sections': [{'name': '简介', 'issue': '缺钩子', 'suggestion': '加一句引导'}],
    'structure': '问题-方法-总结',
    'frequency': '每周两篇，晚上发',
    'priorities': ['补齐简介钩子', '固定更新节奏'],
    'risks': ['起步期别频繁改定位'],
}


# ④ 挑稿：这条线（干货线）底下的几种写法各出一篇，一种写法一台「手机」
# （正文写长一点：挑稿页要的就是「并排摆着读全文好比稿」，太短看不出字够不够认）
VARIANTS = {'variants': [
    {'kind': 'steps', 'title': '第一次用按这 3 步走',
     'content': '第一次上手别急着按开机键。\n\n'
                '第 1 步先看尺寸对不对：把要放的位置量一遍，差两厘米就换小一号，这一步省掉后面很多麻烦。\n\n'
                '第 2 步再试手感：把常做的那个动作连做十遍，手掌发不发酸当场就知道。\n\n'
                '第 3 步照着清单核一遍数：频次、单价、售后，三个数对上了再下单。',
     'tags': ['挑选经验', '新手必看']},
    {'kind': 'list', 'title': '上手前先看这 4 个数',
     'content': '挑之前把这四个数抄下来，比听十句推荐都管用。\n\n'
                '一、频次：一周用不到一次的东西，别按每天用的标准挑。\n\n'
                '二、单价：算到「每次用花多少」，贵的不一定亏。\n\n'
                '三、售后：问清楚保修多久、坏了寄哪儿，别等坏了才知道。\n\n'
                '四、顺不顺手：这个数别人替不了你，只有你自己知道。',
     'tags': ['挑选经验']},
    {'kind': 'qna', 'title': '被问最多的那句：到底怎么选',
     'content': '有人问我同价位怎么选，我的答案一直是一句话：先按用途排，再按预算砍。\n\n'
                '用途这件事分三档——天天用、偶尔用、只为了备用。天天用的，手感优先；偶尔用的，便宜优先；'
                '备用的，能收起来不占地方优先。\n\n'
                '预算那一刀砍在哪里，其实看你能接受多久换一次。',
     'tags': ['答疑']},
    {'kind': 'pitfall', 'title': '这类情况别硬上',
     'content': '三种人我不推荐现在入手。\n\n'
                '第一种，没量过尺寸的。买回来放不下，退货路上耽误的时间比挑东西还久。\n\n'
                '第二种，这周就要用的。急着用的人没空比价，容易被最显眼那个价格带走。\n\n'
                '第三种，指望它替代人工的。工具是省事，不是替你干活，这个预期一开始就得摆正。',
     'tags': ['避坑']},
    {'kind': 'calc', 'title': '这笔账到底怎么算',
     'content': '同样花 300 块，一个用 3 个月，一个用 12 个月，摊到每天差 0.8 元。\n\n'
                '很多人只看总价，其实该看的是「用一次花多少」。把总价除以你能用多少次，'
                '两个数字一摆出来，答案通常和第一眼相反。\n\n'
                '所以我不劝人买贵的，只劝人把这道除法算完再决定。',
     'tags': ['算账对比']},
]}


class Provider(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _headers(self):
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self._headers()

    def do_GET(self):
        self.send_response(200)
        self._headers()
        self.wfile.write(b'{"ok":true}')

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        system = body['messages'][0]['content']
        user = body['messages'][1]['content']
        STATE['requests'].append(body)
        if '内容规划师' in system:
            content = json.dumps(PLAN, ensure_ascii=False)
        elif '同题写一批' in system:
            content = json.dumps(VARIANTS, ensure_ascii=False)
        elif '资深的小红书账号运营顾问' in system:
            content = json.dumps(REPORT, ensure_ascii=False)
        elif '"timeTip"' in system:
            content = json.dumps({
                'titles': ['同价位三款摆一起看，结论可能和你想的不一样', '挑之前先看这 3 点'],
                'content': '同价位的三款我全摆出来看了一遍，结论和很多人想的不一样。\n\n'
                           '先说第一个数：使用频次。……\n\n我实际用下来，第一次挑的人最容易忽略的是第 3 点。',
                'tags': ['挑选经验', '自己试过', '新手必看'],
                'timeTip': '晚上 19:00-21:00',
            }, ensure_ascii=False)
        elif '【已选定的人群】' in user:
            content = json.dumps({'topics': [
                {'topic': '同价位三款摆一起看', 'angle': '实测对比', 'target': '初次使用的客户', 'rationale': '产品×人群匹配；平台爆点；与已发不重复'},
                {'topic': '第一次用最容易忽略的第 3 点', 'angle': '避坑', 'target': '初次使用的客户', 'rationale': '痛点直接'},
            ]}, ensure_ascii=False)
        elif '【选定卖点】' in user:
            content = json.dumps({'people_options': [
                {'name': '初次使用的客户', 'pain': '怕挑错', 'scene': '第一次买', 'timing': '下单前'},
                {'name': '帮别人挑的老用户', 'pain': '怕推荐错', 'scene': '帮朋友选', 'timing': '被问到的时候'},
            ]}, ensure_ascii=False)
        else:
            content = '{}'
        payload = json.dumps({'choices': [{'message': {'content': content}, 'finish_reason': 'stop'}], 'usage': {}}, ensure_ascii=False).encode()
        self.send_response(200)
        self._headers()
        self.wfile.write(payload)


def shot(page, name, selector=None, expand=True):
    SHOTS.mkdir(parents=True, exist_ok=True)
    path = SHOTS / (name + '.png')
    if selector:
        if expand:
            page.evaluate('''(sel) => {
                let el = document.querySelector(sel);
                while (el) { el.style.overflow = 'visible'; el.style.maxHeight = 'none'; el.style.height = 'auto'; el = el.parentElement; }
                document.querySelectorAll('#mainTabs,#diagSubTabs').forEach(e => { e.style.position = 'static'; });
            }''', selector)
        page.locator(selector).screenshot(path=str(path))
    else:
        page.screenshot(path=str(path), full_page=True)
    print('  📸', path.relative_to(ROOT), flush=True)
    return path


def say(text):
    print('·', text, flush=True)


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    out = pathlib.Path(tempfile.mkdtemp(prefix='xhs-planv3-'))
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            str(out / 'profile'), channel='msedge', headless=False,
            viewport={'width': 1180, 'height': 1000},
            args=[f'--disable-extensions-except={ROOT / "extension"}', f'--load-extension={ROOT / "extension"}'])
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            eid = worker.url.split('/')[2]
            worker.evaluate('''async (base) => {
                await ensureTenantInit();
                const cfg = await Storage.getConfig();
                cfg.ai = { apiBaseUrl: base, apiKey: 'isolated-test-only', model: 'fixture', _modelLocked: true };
                cfg.product = Object.assign({}, cfg.product, {
                    name: '体验工具', description: '先试后买的小工具',
                    sellPoints: [{ title: '先试再选', content: '可以先试用，再决定要不要买。' }],
                });
                cfg.persona = { text: '我是一名产品设计师，耐心分享真实体验与使用方法。', card: { identity: '产品设计师', proof: '做这行 5 年' } };
                cfg.noteStyle = { sellTalk: 'light', lines: { howto: { shape: { build: 12, core: 68, sell: 20 }, words: 'mid' } } };
                cfg.diagnosis = {
                    accountType: '教程/步骤型',
                    profile: { name: '测试账号', xhsId: 'fixture', desc: '工具使用经验', fans: '1200', notes: [] },
                    answers: [
                        { q: '你做这行多久了？', answer: '5 年，服务过 200+ 客户，手上有几张实拍照片和视频' },
                        { q: '你希望怎么更新？', answer: '每周两篇，晚上发' },
                        { q: '用一句话介绍你自己：你是谁、在干嘛、擅长什么、能帮客户什么？', answer: '我是做体验工具的产品设计师，做了 5 年，擅长把功能讲成大白话，能帮你选对工具' },
                    ],
                };
                await Storage.setConfig(cfg);
                const kb = await Storage.getKnowledgeBase();
                for (const e of kb) await Storage.deleteKnowledgeEntry(e.id);
                await Storage.addKnowledgeEntry({ title: '挑选方法', category: '方法', content: '先看使用频次，再看维护成本；步骤是 1 看参数 2 比价格 3 试手感。', tags: ['方法'], isActive: true });
                await Storage.addKnowledgeEntry({ title: '价格对比', category: '数据', content: '同价位三款的参数与费用对比表，差价主要在配件与保修。', tags: ['数据'], isActive: true });
                handleExtractOwnProfile = async () => ({ profile: { name: '测试账号', xhsId: 'fixture', desc: '工具使用经验', fans: '1200', notes: [] } });
            }''', f'http://127.0.0.1:{server.server_port}/v1')

            page = context.new_page()
            page.on('pageerror', lambda e: STATE['problems'].append('pageerror: ' + str(e)))
            page.goto(f'chrome-extension://{eid}/popup.html?mode=big')
            page.wait_for_load_state('domcontentloaded')
            if page.locator('#fsClose').is_visible():
                page.locator('#fsClose').click()
            page.locator('#tabDiagnose').click()
            expect(page.locator('#diagSubTabs')).to_be_visible(timeout=10000)

            # ── ① 看已抓到的主页：粉丝 1200 → 冷启动期（阶段口径要靠它） ──
            page.locator('[data-go="1"]').click()
            page.wait_for_selector('text=粉丝', timeout=10000)
            expect(page.locator('#diagBody')).to_contain_text('测试账号', timeout=10000)
            say('① 主页卡：粉丝 ' + str(page.evaluate('() => _diagState.profile && _diagState.profile.fans')) + '（排产按它定阶段）')

            # ── 发笔记 → 任务配置（内容基调新家）： 阶段×人设三行表（第三列跟着五条线）＋ 五条线 × 写法的 篇幅配比/字数 账号默认 ＋ 话术比例 ──
            page.evaluate('() => switchMainTab("noteTaskCfg")')
            page.wait_for_timeout(900)
            page.locator('#noteToneTabs .nt-tab[data-sec="stage"]').click()   # 停在哪一节是模块级状态，显式点回第一节的表
            page.wait_for_timeout(700)
            expect(page.locator('#diagStyleResult')).to_contain_text('账号阶段 × 个人人设', timeout=10000)
            expect(page.locator('#diagStyleResult')).to_contain_text('你的一句话人设：')
            expect(page.locator('#diagStyleResult')).to_contain_text('我是做体验工具的产品设计师')
            expect(page.locator('#diagStyleResult')).to_contain_text('问卷里你自己写的')
            expect(page.locator('#diagStyleResult')).to_contain_text('这一阶段主用哪几条线（各几篇）')
            for st in ('冷启动期', '成长期', '成熟期'):
                expect(page.locator('#diagStyleResult')).to_contain_text(st)
            assert page.locator('#diagStyleResult tbody tr').count() == 4, '表头 + 三个阶段各一行'
            assert page.locator('#diagStyleResult td:has-text("你在这")').count() == 1, '按现在所处阶段点亮「你在这」'
            assert '调子' not in page.locator('#diagStyleResult').inner_text(), '这一页不再有「调子」'
            shot(page, '01a-style-table', '#diagStyleResult')
            say('第一节的三行表＝三个阶段各给「这句话在这个阶段怎么说」+「这一阶段主用哪几条线、各几篇」（粉丝 1200＝冷启动点亮「你在这」）')

            # 第二个横 tab：五条线 × 写法的 篇幅配比/字数 账号默认（干货线那格被种子里的覆盖改过）
            page.locator('#noteToneTabs .nt-tab[data-sec="lines"]').click()
            page.wait_for_timeout(700)
            expect(page.locator('#diagStyleResult')).to_contain_text('五条线 × 写法', timeout=10000)
            expect(page.locator('#diagStyleResult')).to_contain_text('账号改过')
            shot(page, '01b-lines-table', '#diagStyleResult')

            # 第三个横 tab：话术比例的账号默认
            page.locator('#noteToneTabs .nt-tab[data-sec="talk"]').click()
            page.wait_for_timeout(700)
            expect(page.locator('#diagStyleResult')).to_contain_text('话术比例', timeout=10000)
            say('话术比例默认「' + page.evaluate("() => NotePlan.sellTalkOf((_diagState.noteStyle || {}).sellTalk).name") + '」')

            # ── 诊断&配置「规划」：生成规划（刚从发笔记·任务配置过来，先回一级项）──
            page.locator('#tabDiagnose').click()
            expect(page.locator('#diagSubTabs')).to_be_visible(timeout=10000)
            page.locator('#diagSubTabs [data-go="6"]').first.click()
            page.wait_for_selector('#diagPlanBuild', timeout=10000)
            expect(page.locator('#diagPlanResult')).to_contain_text('还没有已保存的规划', timeout=10000)
            page.locator('#diagPlanBuild').click()
            page.wait_for_selector('text=内容排产表', timeout=60000)
            page.wait_for_function("() => document.querySelector('#diagPlanMsg') && document.querySelector('#diagPlanMsg').textContent.indexOf('已重新生成') >= 0", timeout=60000)
            shot(page, '01-plan-default', '#diagBody')

            plan = worker.evaluate("async () => (await chrome.storage.local.get('note_plan')).note_plan")
            counts = {r['type']: r['count'] for r in plan['mix']}
            say('落盘 note_plan：v=%s stage=%s 篇数=%s' % (plan.get('v'), plan.get('stage'), json.dumps(counts, ensure_ascii=False)))
            say('mixWeights=%s short=%s' % (json.dumps(plan.get('mixWeights'), ensure_ascii=False), json.dumps(plan.get('short'), ensure_ascii=False)))
            assert plan['v'] == 3 and plan['stage'] == 'cold', plan.get('stage')
            assert sum(counts.values()) == 12 and counts.get('howto') == 4 and counts.get('hot') == 1, counts
            types_set = {it['type'] for it in plan['items']}
            assert not page.locator('#diagPlanResult').inner_text().count('档位'), '⑨ 规划页不该再出现档位'
            assert 'breakout' in {it.get('scope') for it in plan['items']}, '破圈内容要进得来'
            say('排产表：%d 篇 / %d 类 / 破圈 %d 篇 / 系列 %d 篇' % (
                len(plan['items']), len(types_set),
                sum(1 for it in plan['items'] if it.get('scope') == 'breakout'),
                sum(1 for it in plan['items'] if it.get('arc'))))

            # ── ⚖️ 配比条：± / 保存 / 刷新还在 / 恢复默认 ──
            expect(page.locator('#diagPlanResult')).to_contain_text('配比')
            expect(page.locator('#diagPlanResult')).to_contain_text('保存配比')
            assert page.locator('#diagPlanResult button[data-mix]').count() == 10, '五条线 × 加减两个按钮'
            expect(page.locator('#diagPlanResult')).to_contain_text('本批篇数跟这个配比一致')
            mix_before = worker.evaluate("async () => (await chrome.storage.local.get('note_plan_mix')).note_plan_mix || null")
            assert mix_before is None, mix_before

            say('把「干货线」往下按 5 次（30→5）、「热点线」往上按 3 次（10→25），看它就地折算')
            for _ in range(5):
                page.locator('#diagPlanResult button[data-mix="howto"][data-d="-5"]').click()
            for _ in range(3):
                page.locator('#diagPlanResult button[data-mix="hot"][data-d="5"]').click()
            expect(page.locator('#diagPlanResult')).to_contain_text('有改动还没保存', timeout=5000)
            expect(page.locator('#diagPlanResult')).to_contain_text('本批和这个配比有出入', timeout=5000)
            assert worker.evaluate("async () => (await chrome.storage.local.get('note_plan_mix')).note_plan_mix || null") is None, '没点保存不该落盘'
            shot(page, '02-mix-dirty', '#diagPlanResult')
            say('改动态：' + page.locator('#diagPlanResult').inner_text().split('⚖️ 配比')[1][:120].replace('\n', ' ｜ '))

            page.locator('#diagMixSave').click()
            expect(page.locator('#diagMixMsg')).to_contain_text('已保存', timeout=5000)
            saved = worker.evaluate("async () => (await chrome.storage.local.get(['note_plan_mix','note_plan']))")
            stage = plan['stage']
            assert saved['note_plan_mix'][stage]['howto'] == 5 and saved['note_plan_mix'][stage]['hot'] == 25, saved['note_plan_mix']
            assert saved['note_plan']['mixWeights']['hot'] == 25, saved['note_plan']['mixWeights']
            shot(page, '03-mix-saved', '#diagPlanResult')
            say('落盘 note_plan_mix.%s=%s；本批 mixWeights.hot=%s' % (stage, json.dumps(saved['note_plan_mix'][stage], ensure_ascii=False), saved['note_plan']['mixWeights']['hot']))

            page.reload()
            page.wait_for_load_state('domcontentloaded')
            if page.locator('#fsClose').is_visible():
                page.locator('#fsClose').click()
            page.locator('#tabDiagnose').click()
            expect(page.locator('#diagSubTabs')).to_be_visible(timeout=10000)
            page.locator('#diagSubTabs [data-go="6"]').first.click()
            page.wait_for_selector('#diagMixSave', timeout=10000)
            expect(page.locator('#diagPlanResult')).to_contain_text('干货线')
            chip = page.evaluate('''() => {
                const b = document.querySelector('#diagPlanResult button[data-mix="howto"]');
                return b ? b.parentElement.innerText.replace(/\\s+/g, ' ') : '';
            }''')
            say('刷新后配比条上的「干货线」：' + chip)
            assert '1篇' in chip.replace(' ', ''), chip
            shot(page, '04-mix-after-reload', '#diagPlanResult')

            page.locator('#diagMixReset').click()
            expect(page.locator('#diagMixMsg')).to_contain_text('已恢复默认配比', timeout=5000)
            assert worker.evaluate("async () => (await chrome.storage.local.get('note_plan_mix')).note_plan_mix || null") in (None, {}), '恢复默认要把覆盖清掉'
            shot(page, '05-mix-reset', '#diagPlanResult')
            say('已恢复默认：note_plan_mix 覆盖清空')

            # ── 发笔记「📚 按规划发」：rail 落在档案中枢，新的一篇从「✍️ 写文案」进 ──
            page.locator('#tabNotePublish').click()
            page.wait_for_timeout(300)
            if not page.locator('.np-spk').count():
                npar = page.locator('.npar-new')
                if npar.count():
                    npar.first.click()
            expect(page.locator('#npWizBody')).to_be_visible(timeout=15000)
            expect(page.locator('.np-spk').first).to_be_visible(timeout=20000)
            page.locator('.np-spk').first.click()
            page.locator('.np-wiz-next').click()
            expect(page.locator('.np-ppc').first).to_be_visible(timeout=30000)
            page.locator('.np-ppc').first.click()
            page.locator('.np-wiz-next').click()
            expect(page.locator('#npWizBody')).to_contain_text('按规划发', timeout=30000)
            expect(page.locator('#npWizBody')).to_contain_text('下一篇该发')
            card = page.evaluate("() => document.querySelector('#npWizBody').innerText.split('③')[0].replace(/\\s+/g, ' ').trim()")
            say('③ 里的「按规划发」卡：' + card[:160])
            assert '干货线' in card and '教程步骤' in card, card[:200]
            shot(page, '06-wizard-plan-card', '#npWizBody')

            page.locator('#npPlanUse').click()
            expect(page.locator('#npWizBody')).to_contain_text('已选：第 1 篇', timeout=5000)
            expect(page.locator('#npWizBody')).to_contain_text('干货线 · 教程步骤')
            shot(page, '07-wizard-plan-picked', '#npWizBody')
            page.locator('.np-wiz-next').click()            # ③ → ④ 挑稿
            page.wait_for_function("() => _npWiz && _npWiz.step === 3", timeout=30000)
            expect(page.locator('#npWizBody')).to_contain_text('④ 挑稿')
            expect(page.locator('#npWizBody .npVarPick')).to_have_count(5, timeout=30000)   # 干货线 5 种写法，一种一篇
            shot(page, '07b-wizard-pick-step', '#npWizBody')

            # 窗口自适应：同一批样稿在宽窗（大窗铺满屏）与窄窗（640 弹窗）各拍一张、量一量格子尺寸
            def phone_box():
                return page.evaluate('''() => {
                    const a = [...document.querySelectorAll('#npWizBody .npPhone')];
                    if (!a.length) return null;
                    const r = a[0].getBoundingClientRect();
                    const top = Math.round(r.top);
                    return { w: Math.round(r.width), h: Math.round(r.height),
                             row1: a.filter(e => Math.round(e.getBoundingClientRect().top) === top).length,
                             font: getComputedStyle(a[0].querySelector('.npPhoneBody')).fontSize };
                }''')
            page.set_viewport_size({'width': 1600, 'height': 1000})
            page.wait_for_timeout(300)
            wide = phone_box()
            shot(page, '07b-wizard-pick-step-wide', '#npWizBody')
            say('宽窗 1600：每台 %d×%d px · 一行 %d 台 · 正文 %s' % (wide['w'], wide['h'], wide['row1'], wide['font']))
            assert wide['row1'] == 5 and wide['w'] >= 260 and wide['h'] >= 400, wide
            page.set_viewport_size({'width': 660, 'height': 1000})
            page.wait_for_timeout(300)
            narrow = phone_box()
            shot(page, '07b-wizard-pick-step-narrow', '#npWizBody')
            chain = page.evaluate('''() => {
                const w = (sel) => { const e = document.querySelector(sel); return e ? e.clientWidth : -1; };
                return { vp: window.innerWidth, body: w('body'), split: w('.split-layout'), right: w('.panel-right'),
                         content: w('#notePublishContent'), inner: w('#npWizBody'), row: w('.npPhoneRow') };
            }''')
            say('窄窗 660 宽度链：' + json.dumps(chain, ensure_ascii=False))
            say('窄窗 660：每台 %d×%d px · 一行 %d 台（自动折行）· 正文 %s' % (narrow['w'], narrow['h'], narrow['row1'], narrow['font']))
            assert narrow['row1'] == 2 and narrow['w'] >= 250 and narrow['h'] >= 280, narrow
            page.set_viewport_size({'width': 1180, 'height': 1000})
            page.wait_for_timeout(200)
            # 五十三改：④ 没有「下一步」了（前进＝点中某台样稿）；这一屏要验成稿提示词，
            # 所以直接落 ⑤ 且不带成稿，让「没成稿就自己补写」那一发写出来
            page.evaluate('() => { _npWiz.step = 4; _npWiz.draft = null; return npWizRender(npActiveC()); }')
            page.wait_for_function("() => _npWiz && _npWiz.step === 4 && _npWiz.draft", timeout=60000)
            page.wait_for_function("() => (_npWiz.draft.content || '').length > 40", timeout=30000)
            expect(page.locator('#npWizBody')).to_contain_text('⑤ 改稿')
            shot(page, '08-wizard-draft', '#notePublishContent')
            draft_system = [r for r in STATE['requests'] if '"timeTip"' in r['messages'][0]['content']][-1]['messages'][0]['content']
            for must in ['属于「干货线」', '具体写法用「教程步骤」', '这一篇是「干货线 · 教程步骤」', '本篇凭据：做这行 5 年',
                         '本篇是账号内容规划里的第 1 篇', '篇幅配比（按整篇正文字数算，这是这条线的魂）',
                         '这一类的戒条（违反＝写错了这一类）', '字数：这篇写']:
                assert must in draft_system, '成稿提示词缺：' + must
            assert '档位' not in draft_system, '成稿提示词不该再有档位'
            assert '调子' not in draft_system, '成稿提示词不该再按调子写（调子已退市）'
            say('成稿提示词：带线/写法/凭据 + 这一类自己的节拍·形态·戒条与 📐 篇幅配比、🖋 字数，且没有「档位」「调子」——成稿 %d 字' % len(page.evaluate('_npWiz.draft.content')))

            print('\n产物目录：', SHOTS, flush=True)
            print('note_plan 与 note_plan_mix 的读数见上。', flush=True)
        finally:
            if STATE['problems']:
                print('\n⚠️  页面报错：', flush=True)
                for x in STATE['problems']:
                    print('   ', x, flush=True)
            else:
                print('\n✅ 无页面报错，全流程走通。', flush=True)
            context.close()
            server.shutdown()


if __name__ == '__main__':
    main()
