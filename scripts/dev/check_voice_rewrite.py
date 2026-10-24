# -*- coding: utf-8 -*-
"""发笔记「真接口那一跳」自检：本地起一个假的 AI HTTP 接口，把 popup → 背景 → fetch → 回填整条真的跑一遍。

桩测（在 service worker 里替掉 AI 返回的那批 check_*.py）验的是界面状态机；这一支验的是它够不着的那半条链：
提示词到底组装成什么样（规矩 / 画面流派 / 配文方式那一档 / 合规句带没带上）、返回的 JSON 清洗对不对、
接口挂掉时错误落到哪一格。覆盖 ④ 成稿、⑤ 整篇改稿 + 回退、⑤b 逐句改、
造图片 ③ 拉行号圈屏 → ④ 🔮 挑每屏那句、④ 🔁 照这一派重出分镜（六十四改②起封面不归这一发），以及这一篇的正文 → 出片台。
六十五改：③ 那格文案＝这一篇的正文（没单独写过口播稿就照正文），**只读**；改字只有一个编辑口（回「写稿」改正文，改完回这儿 ⟳ 重列）——
这一支按家族口径（同 check_note_imgwork）把「正文改过」用台上源＋落档一起摆出来，不发明路径。
做料的入口＝档案那一行「下一步」→「🎬 渲染任务」那张表（复刻收口后档案行上只剩它；本脚本跟 check_task_list / check_film_list 一样直开这张表）：
在表上「＋ 一套图」加一行 →「🖼 出图」才进造图片那五档（① 风格／② 封面／③ 断句／④ 分镜／⑤ 预览）。
五十四改后「AI 出口播稿 / 口播稿 AI 改一版 / 拿去出片」整块下线（出片台念的就是这一篇的正文），这一支不再打那条死路。
假接口只对「临时副本」生效（往副本 manifest 里加 127.0.0.1 权限），不动 extension/ 本体。
用法：python3 -X utf8 scripts/dev/check_voice_rewrite.py
"""
import http.server
import json
import os
import pathlib
import re
import shutil
import sys
import tempfile
import threading
import time

from playwright.sync_api import expect, sync_playwright

from _guide_gate import goto_big

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / 'extension'
OUT = pathlib.Path(os.environ.get('TEMP', '/tmp')) / 'xhs_voice_rewrite'
OUT.mkdir(parents=True, exist_ok=True)
PROFILE = OUT / 'profile'
EXT2 = pathlib.Path(tempfile.gettempdir()) / 'xhs_ext_voice_rewrite'

BODY_IN = '开场钩子。\n\n第一段干货。\n\n结尾引导。'
ASK = '再短一点'
# 改稿那两发是 JSON：整篇那一发故意套 ```json 围栏，验 parseJsonObject 照样取得出来
REVISE_IN = '```json\n{"content":"改好的正文第一段。\\n改好的正文第二段。"}\n```'
REVISE_WANT = '改好的正文第一段。\n改好的正文第二段。'
SENT_REVISED = '改短了的那一句。'
# 造图片 ③ 顶上那格文案＝这一篇的正文（没单独写过口播稿就照正文）：断句收的是它、出片台念的还是它
VOICE_EDIT = '钩子重写了。\n\n中间这段换了说法。\n\n结尾指到主页简介。'
MOTIF = '手写笔记·纸感'          # 这一套自己挑的一派（六十六改：① 那排只摆三颗短名单，挑的就是其中之一；跟内置打底那一派不同，点了才算「这一套定的」）
MOTIF_DEF = '真人工作场景'     # 内置统一小红书打底那一派（六十二改＝实拍）：没自己挑过时照它
CUT_WHY = '这句说完了，下一句另起一张'
DESC_TAG = '照这一派摆的一张'

DRAFT = json.dumps({'titles': ['标题A', '标题B', '标题C'], 'content': BODY_IN,
                    'tags': ['效率', '省时间'], 'timeTip': '12:00-13:00'}, ensure_ascii=False)
PEOPLE = json.dumps({'people_options': [{'name': f'测试人群{i}', 'pain': '选择困难', 'scene': '准备购买', 'timing': '购买前'} for i in (1, 2, 3)]}, ensure_ascii=False)
TOPICS = json.dumps({'topics': [{'topic': '测试话题', 'angle': '角度', 'target': '人群', 'rationale': '理由'}]}, ensure_ascii=False)

LAST = {}
COUNT = {}


class MockAi(http.server.BaseHTTPRequestHandler):
    def _json(self, obj, code=200):
        data = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.end_headers()

    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        try:
            body = json.loads(self.rfile.read(n).decode('utf-8'))
        except Exception:
            body = {}
        msgs = body.get('messages') or []
        LAST['path'] = self.path
        LAST['system'] = msgs[0].get('content', '') if msgs else ''
        LAST['user'] = msgs[1].get('content', '') if len(msgs) > 1 else ''
        sysmsg, user = LAST['system'], LAST['user']
        # 逐句改的 system 里也带「【现有正文】」那句角色话，必须先按「要点的那一句」分出去
        if '要点的那一句' in sysmsg:
            leg, content = 'revise-sent', json.dumps({'sentence': SENT_REVISED}, ensure_ascii=False)
        elif '【现有正文】' in sysmsg:
            leg, content = 'revise', REVISE_IN
        elif '你在帮一条' in sysmsg:            # 🔮 挑每屏那句：「句」＝清单里方括号那个编号，照抄回来
            ids = re.findall(r'^\s*\d+\.\s*\[([^\]]+)\]', user, re.M)
            leg, content = 'cuts', json.dumps(
                {'提名句': [{'句': sid, '理由': CUT_WHY} for sid in ids[:2]]}, ensure_ascii=False)
        elif '你在改一条' in sysmsg:            # 🔁 重出分镜：「句」＝那段原文，一字不差照抄回来对号
            segs = re.findall(r'^本段（要写的就是它）：(.+)$', user, re.M)
            leg, content = 'descs', json.dumps(
                {'风格': '', '画面': [{'句': t, '分镜': DESC_TAG + '：' + t} for t in segs]},
                ensure_ascii=False)
        elif '爆款图文笔记写手' in sysmsg:
            leg, content = 'draft', DRAFT
        elif '候选话题' in sysmsg:
            leg, content = 'topics', TOPICS
        else:
            leg, content = 'people', PEOPLE
        LAST['leg'] = leg
        COUNT[leg] = COUNT.get(leg, 0) + 1
        self._json({'choices': [{'message': {'role': 'assistant', 'content': content}}],
                    'usage': {'prompt_tokens': 11, 'completion_tokens': 22}})

    def log_message(self, *a):
        pass


# ── 临时副本：加一条 127.0.0.1 的域名权限，别动交付目录 ──
if EXT2.exists():
    shutil.rmtree(EXT2, ignore_errors=True)
shutil.copytree(EXT, EXT2, ignore=shutil.ignore_patterns('.DS_Store'))
mf = EXT2 / 'manifest.json'
m = json.loads(mf.read_text(encoding='utf-8'))
hosts = list(m.get('host_permissions') or [])
if 'http://127.0.0.1/*' not in hosts:
    hosts.append('http://127.0.0.1/*')
m['host_permissions'] = hosts
mf.write_text(json.dumps(m, ensure_ascii=False, indent=2), encoding='utf-8')

srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), MockAi)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
print(f'假 AI 接口 = http://127.0.0.1:{PORT}/v1', flush=True)

if PROFILE.exists():
    shutil.rmtree(PROFILE, ignore_errors=True)


def boot(p, ext):
    """起浏览器 + 装真扩展（临时副本）。

    playwright 默认要往命令行里塞 --disable-extensions（它自己起持久化档时也会摘掉这个），
    跟 --load-extension 撞在一起会时灵时不灵——扩展会装不上（service_workers 一直空），
    所以摘掉那个默认开关，起不来就整个重来一趟（每趟全新档，免得读到上版 background.js 的缓存）。
    """
    for i in range(5):
        prof = PROFILE if i == 0 else PROFILE.with_name('profile%d' % i)
        shutil.rmtree(prof, ignore_errors=True)
        ctx = p.chromium.launch_persistent_context(
            str(prof), headless=False, channel='msedge',
            ignore_default_args=['--disable-extensions'],
            args=[f'--disable-extensions-except={ext}', f'--load-extension={ext}'])
        t0 = time.time()
        while time.time() - t0 < 25 and not ctx.service_workers:
            time.sleep(0.3)
        if ctx.service_workers:
            return ctx
        print('  扩展没装起来（第 %d 趟），重来' % (i + 1), flush=True)
        ctx.close()
    raise RuntimeError('扩展装不上：连试 5 趟都没有 service worker')


def state(pg):
    """台面上这一行图的状态：句子 / 段（含段文本与分镜）/ 建议断点"""
    return json.loads(pg.evaluate('''() => {
        const w = npS() || {}, s = w.shots || {};
        return JSON.stringify({
            voice: String(w.voice || ''), motif: String(((s.look || {}).motif) || ''),
            sents: (s.sents || []).map(x => x.text),
            items: (s.items || []).map(it => ({ sids: (it.sids || []).slice(),
                                                text: String(it.text || ''), desc: String(it.desc || '') })),
            suggest: (s.suggest || []).length,
        });
    }'''))


def archive(pg, ar_id):
    return json.loads(pg.evaluate('''(id) => chrome.storage.local.get('np_notes').then(d => {
        const n = (d.np_notes || []).find(x => x.id === id) || {};
        return JSON.stringify({ voice: String(n.voice || ''),
            imgDocs: (n.imgDocs || []).map(r => ({ motif: String((((r.shots || {}).look) || {}).motif) || '',
                descs: (r.shots.items || []).map(it => String(it.desc || '')) })) });
    })''', ar_id))


def poll(expr, arg=None, timeout=20):
    """涉及 chrome.storage 的回写是延时的：Python 侧轮询，别用 wait_for_function 猜"""
    t0 = time.time()
    while time.time() - t0 < timeout:
        got = pg.evaluate(expr, arg) if arg is not None else pg.evaluate(expr)
        if got:
            return got
        time.sleep(0.25)
    raise AssertionError('等不到：%s' % expr[:80])


with sync_playwright() as p:
    ctx = boot(p, EXT2)
    sw = ctx.service_workers[0]
    eid = sw.url.split('/')[2]
    sw.evaluate('''async (base) => {
        await Storage.initializeDefaults(DEFAULT_PROMPTS);
        await ensureTenantInit();
        const c = await Storage.getConfig();
        c.product.name = '流程测试产品';
        c.product.sellPoints = [{title: '省时间', content: '简化重复步骤'}];
        c.ai = Object.assign({}, c.ai, {apiKey: 'sk-mock-local', apiBaseUrl: base, model: 'mock-model', _modelLocked: true});
        await Storage.setConfig(c);
    }''', f'http://127.0.0.1:{PORT}/v1')
    pg = ctx.new_page()
    pg.set_default_timeout(20000)
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    goto_big(pg, eid)
    pg.wait_for_function('() => typeof _npWiz !== "undefined"')
    if pg.locator('#fsClose').is_visible():
        pg.locator('#fsClose').click()

    # ── 1) 写文案 ④→⑤：成稿那一发走真 HTTP ─────────────────────────────────
    pg.evaluate('() => switchMainTab("notePublish", "new")')   # 发笔记二级只剩 档案+素材库：写文案从这儿进
    pg.wait_for_function('() => document.getElementById("notePublishContent").offsetWidth > 0 && !!document.querySelector(".np-spk")')
    pg.locator('.np-spk').first.check()
    pg.locator('.np-wiz-next').click()
    pg.locator('.np-ppc').first.check()
    pg.locator('.np-wiz-next').click()
    pg.wait_for_function('() => !!document.querySelector(".np-tpc:checked")')
    pg.locator('.np-wiz-next').click()            # ③ → ④ 挑稿
    pg.wait_for_function('() => _npWiz.step === 3')
    # ④ 的前进路只剩「点中某台样稿」（这台假接口不会回那批发稿）→ 直接落到 ⑤，让「没成稿就自己补写」打这一发
    pg.evaluate('() => { _npWiz.step = 4; _npWiz.draft = null; return npWizRender(npActiveC()); }')
    pg.wait_for_function('() => !!(_npWiz.draft || {}).content', timeout=30000)
    assert LAST['leg'] == 'draft', LAST
    assert pg.evaluate('_npWiz.draft.content') == BODY_IN, pg.evaluate('_npWiz.draft.content')
    print('PASS: 成稿那发走的是真接口（假接口收到 leg=%s）' % LAST['leg'], flush=True)

    # ── 2) ⑤ 整篇改稿：真按钮 → 背景 → 假接口 → 原位回填 + 回退 ───────────────
    pg.fill('#npReviseAsk', ASK)
    pg.locator('.np-rv-go').click()
    pg.wait_for_function('(w) => _npWiz.draft.content === w', arg=REVISE_WANT, timeout=25000)
    assert LAST['leg'] == 'revise', LAST
    assert '只输出改好的正文' in LAST['system'] and '主页简介' in LAST['system'] and '不承诺效果' in LAST['system'], LAST['system'][:120]
    assert '【现有正文】' in LAST['user'] and ASK in LAST['user'] and '开场钩子' in LAST['user'], LAST['user'][:160]
    print('PASS: 改稿带回规矩（只输出正文/承接只走主页简介/不承诺效果）与原文+要求，```json 围栏也照样解析', flush=True)
    pg.locator('.np-rv-undo').click()
    assert pg.evaluate('_npWiz.draft.content') == BODY_IN, '「改回上一版」要还原原文'
    print('PASS: 改回上一版正常', flush=True)

    # ── 3) ⑤b 逐句改：点正文里某一句 → 只改那一句，其余一字不动 ────────────────
    first_sent = pg.evaluate('npSplitSents(_npWiz.draft.content)[0].t')
    pg.locator('#npWizBody .np-sent-row').first.click()
    pg.wait_for_selector('#npSentAsk')
    pg.fill('#npSentAsk', ASK)
    pg.locator('.np-sent-go').click()
    pg.wait_for_function('() => _npWiz.draft.content.indexOf("改短了的那一句。") === 0', timeout=25000)
    assert LAST['leg'] == 'revise-sent', LAST
    assert '【要点的那一句】' + first_sent in LAST['user'] and '【整篇正文（只当上下文，别重写）】' in LAST['user'], LAST['user'][:220]
    assert pg.evaluate('_npWiz.draft.content') == BODY_IN.replace(first_sent, SENT_REVISED, 1), \
        '逐句改只许换那一句：%s' % pg.evaluate('_npWiz.draft.content')
    print('PASS: 逐句改走真接口（leg=%s），只换点的那一句、其余一字不动' % LAST['leg'], flush=True)
    pg.evaluate('(b) => { _npWiz.draft.content = b; npSentPaint(npActiveC()); npArchiveTouch(_npWiz); npArchiveFlushTouch(); }', BODY_IN)
    assert pg.evaluate('_npWiz.draft.content') == BODY_IN
    pg.wait_for_function('() => !!_npWiz.arId', timeout=15000)
    ar_id = pg.evaluate('_npWiz.arId')

    # ── 4) 档案那行「下一步」→ 出图，④ 空态起一套图（旧的「🎬 渲染任务」表已撤）：一次 AI 都不烧 ──
    # 回退那笔走的是 npArchiveTouch（0.8 秒防抖才落档）：先等档案里这一篇的正文真回到 BODY_IN，直开读到的才是它
    poll('''(a) => chrome.storage.local.get('np_notes').then(d => {
        const n = (d.np_notes || []).find(x => x && x.id === a.id) || {}; return n.draft === a.v; })''',
        {'id': ar_id, 'v': BODY_IN}, timeout=15000)
    BLOCKS = {'look': '#npLookBox', 'cut': '#npCutWrap', 'desc': '#npShotTable', 'preview': '#npPreviewBox'}

    def enter_out():
        """直开这一篇的「🖼 出图」（档案那一行「下一步」走的同一条路；七十改起界面不再有任务表与行选择器）"""
        got = pg.evaluate('''async (id) => {
            const list = await npNotesAll();
            const n = list.find(x => x && x.id === id) || null;
            if (n) switchMainTab('noteOut', n);
            return n ? 'ok' : 'MISSING:' + ((list || []).map(x => x && x.id).join(',') || '(空)');
        }''', ar_id)
        assert got == 'ok', '档案里还没有这一篇（防抖落档没等够？）：%s' % got
        pg.wait_for_function('id => _npMode === "out" && !!document.querySelector("#npImgTabs .np-imgtab") '
                             '&& String(((typeof npS === "function" ? npS() : null) || {}).arId || "") === id', arg=ar_id, timeout=15000)

    def to_tab(t):
        """造图片那五档（① 风格／② 封面／③ 断句／④ 分镜／⑤ 预览）：一次只摊一档，切档要跟着切"""
        pg.locator('#npImgTabs .np-imgtab[data-t="%s"]' % t).click()
        pg.wait_for_function('(b) => !!document.querySelector(b)', arg=BLOCKS[t])

    def gut_drag_range(a, b):
        """按住第 a 行（0 起）的行号拉到第 b 行松手＝这几句圈成一屏（a＝b＝只点这一行，它自己一屏）。
        ③ 的行号列与 ④ 卡头摊开的那几行是同一种行（npCutLineHtml），拖的是同一份 items[].sids；
        拖的落点按行框中心算（popup 自己按指针 y 认行，不猜位移）。"""
        ba = pg.locator('#npCutWrap .np-cut-gut[data-i="%d"]' % a).bounding_box()
        bb = pg.locator('#npCutWrap .np-cutline[data-i="%d"]' % b).bounding_box()
        assert ba and bb, '行号/行没画出来：%s' % state(pg)
        pg.mouse.move(ba['x'] + ba['width'] / 2, ba['y'] + ba['height'] / 2)
        pg.mouse.down()
        pg.mouse.move(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2, steps=4)
        pg.mouse.up()

    enter_out()
    b_cut, b_desc = COUNT.get('cuts', 0), COUNT.get('descs', 0)
    to_tab('desc')
    pg.wait_for_function('() => !!document.querySelector("#npShotTable .np-img-add")')
    assert '还没有一行图' in pg.locator('#npShotTable').inner_text(), '④ 空态先说清第一步：这一篇还没有一行图'
    pg.locator('#npShotTable .np-img-add').click()     # 「＋ 起一套图（跟账号默认）」＝这一行还没定流派
    pg.wait_for_function('() => (npS().imgDocs || []).length === 1 && !!npS().imgOpen')
    assert [COUNT.get('cuts', 0), COUNT.get('descs', 0)] == [b_cut, b_desc], '起一套图不该烧 AI'
    enter_out()
    assert pg.evaluate('() => npS().uiTab') == 'cover', '刚加的一行：封面那一份还没写＝先落在 ②（它是独立一档）'
    pg.locator('#npCoverBox .np-cover-on[data-v="0"]').click()
    pg.wait_for_function('() => npS().shots.cv.on === false')
    assert pg.evaluate('() => npImgLand(npS())') == 'cut', '点了「不出封面」才往 ③ 划重点 走（① 有打底，不作关卡）'
    assert pg.evaluate('() => npLookOf(npS()).motif') == MOTIF_DEF, '没自己挑过流派＝生效那派落回内置统一小红书打底'
    to_tab('look')
    pg.locator('#npLookBox .np-motif[data-k="%s"]' % MOTIF).click()
    pg.wait_for_function('(k) => npLookOf(npS()).motif === k', arg=MOTIF)
    assert state(pg)['motif'] == MOTIF, state(pg)
    assert [COUNT.get('cuts', 0), COUNT.get('descs', 0)] == [b_cut, b_desc], '挑一派也不该烧 AI'
    print('PASS: ④ 空态起一套图（零 AI）→ 重进出图先落 ②、关掉封面落 ③，挑「%s」也零 AI' % MOTIF, flush=True)

    # ── 5) ③ 那格文案只读（改字只有一个编辑口）→ 正文改过 → ⟳ 重列句子（零 AI） ────────
    to_tab('cut')
    pg.evaluate('() => { const d = document.querySelector("#npCutWrap details.np-cutsrc"); if (d) d.open = true; }')
    assert pg.locator('#npVoiceTa').input_value() == BODY_IN, pg.locator('#npVoiceTa').input_value()
    assert pg.locator('#npVoiceTa').evaluate('(el) => el.readOnly === true'), '③ 这一格只读：正文的编辑口收在「笔记档案」那一行'
    assert '回「笔记档案」那一行点「下一步」' in pg.locator('#npCutWrap details.np-cutsrc').inner_text(), '只读提示要指回写稿'
    # 正文改过——同 check_note_imgwork 口径：相当于在档案那一行把正文改了（台上源与档案一起变）
    pg.evaluate('(t) => { npS().draft.content = t; npArchiveTouch(npS()); return true; }', VOICE_EDIT)
    poll('''(a) => chrome.storage.local.get('np_notes').then(d => {
        const n = (d.np_notes || []).find(x => x.id === a.id) || {}; return n.draft === a.v; })''',
        {'id': ar_id, 'v': VOICE_EDIT})
    to_tab('look')
    to_tab('cut')                                  # 切档重渲染：改过正文＝旧行对不上，陈旧横幅自己亮着
    assert pg.locator('#npVoiceTa').input_value() == VOICE_EDIT, pg.locator('#npVoiceTa').input_value()
    assert pg.evaluate('() => !document.getElementById("npSrcStale").hasAttribute("hidden")'), '改过正文要亮提醒'
    pg.locator('#npCutWrap .np-cut-relest').click()
    pg.wait_for_function('() => document.querySelectorAll("#npCutWrap .np-cutline").length === 3')
    assert pg.evaluate('() => document.getElementById("npSrcStale").hasAttribute("hidden")'), '重列完文案跟行又对上了'
    st5 = state(pg)
    assert st5['sents'] == ['钩子重写了。', '中间这段换了说法。', '结尾指到主页简介。'], st5['sents']
    assert st5['items'] == [], '重列句子只管把句子摆出来，不许替人把段绑上：%s' % st5
    assert [COUNT.get('cuts', 0), COUNT.get('descs', 0)] == [b_cut, b_desc], '改正文＋⟳ 重列＝零 AI'
    print('PASS: ③ 那格只读（正文只有一个编辑口，指回「笔记档案」行「下一步」）→ 正文改过＝旧行亮「对不上」→ ⟳ 重列出 3 行、不替人绑段（零 AI）', flush=True)

    # ── 6) ③ 拉行号圈两屏（零 AI）→ ④ 🔮 挑每屏那句（真接口）：只提名，点一下才算数 ──
    to_tab('cut')
    assert state(pg)['items'] == [], '⟳ 重列后还没圈过任何一屏'
    gut_drag_range(0, 1)                           # 第 1–2 行圈成一屏（第一屏那句自动＝本屏头一句）
    gut_drag_range(2, 2)                           # 第 3 行自己一屏（只点行号、没跨行）
    st6 = state(pg)
    assert [len(x['sids']) for x in st6['items']] == [2, 1], st6
    assert [x['text'] for x in st6['items']] == [st6['sents'][0] + st6['sents'][1], st6['sents'][2]], \
        '这段原文＝圈进来那几行拼的：%s' % st6
    keys0 = pg.evaluate('() => (npS().shots.items || []).map(it => String(it.keySid || ""))')
    assert keys0 == [st6['items'][0]['sids'][0], st6['items'][1]['sids'][0]], '立屏时那句自动＝本屏头一句：%s' % keys0
    assert [COUNT.get('cuts', 0), COUNT.get('descs', 0)] == [b_cut, b_desc], '拖行号圈屏＝零 AI'
    print('PASS: ③ 拉行号圈两屏（第 1–2 行一屏 / 第 3 行自己一屏）＝零 AI，段文本＝圈进来那几行拼的', flush=True)

    to_tab('desc')
    pg.locator('#npShotTable .np-cut-suggest').click()
    pg.wait_for_function('() => document.querySelectorAll(".np-key-adopt").length === 1', timeout=30000)
    assert LAST['leg'] == 'cuts', LAST
    sysmsg, user = LAST['system'], LAST['user']
    assert '你在帮一条' in sysmsg and '不许改写句子、不许合并、不许删句' in sysmsg, sysmsg[:160]
    assert '【本次画面流派】' + MOTIF in sysmsg and '【这一套图的取材路子】' in sysmsg, sysmsg[-400:]
    assert '4) 配文方式（这一段话，图替你说多少）' in sysmsg, sysmsg[:400]
    assert '只输出一个 JSON 对象' in sysmsg, sysmsg[:220]
    assert '主页简介' in sysmsg and '不许出现二维码' in sysmsg, '切点建议也吃合规口径'
    assert '【句子清单（按文案先后）】' in user and '【台面上已经切好的屏' in user, user[:220]
    assert '钩子重写了。' in user and '结尾指到主页简介。' in user, user
    st6b = state(pg)
    assert [x['sids'] for x in st6b['items']] == [x['sids'] for x in st6['items']], 'AI 只提名：边界一个字不动'
    assert st6b['suggest'] == 1, '已经当了大字的那一行要被挑掉，剩 1 条提名：%s' % st6b
    print('PASS: ④ 🔮 这发带齐（流派取材 + 配文方式那一档 + 合规句 + 逐行清单 + 已切好的屏与★那句），回来 1 条提名、边界没动', flush=True)

    sid_adopt = pg.evaluate('() => document.querySelector(".np-key-adopt").getAttribute("data-sid")')
    assert sid_adopt == st6['items'][0]['sids'][1], '提的该是第 1 屏里还没当大字的那一行：%s' % sid_adopt
    pg.locator('.np-key-adopt').first.click()
    pg.wait_for_function('() => document.querySelectorAll(".np-key-adopt").length === 0')
    keys1 = pg.evaluate('() => (npS().shots.items || []).map(it => [String(it.keySid || ""), String(it.keyText || "")])')
    assert keys1 == [[st6['items'][0]['sids'][1], st6['sents'][1]], [st6['items'][1]['sids'][0], st6['sents'][2]]], \
        '点一下「用这句」＝那一屏那句换成第 2 行（只换那句，边界不动）：%s' % keys1
    assert [COUNT.get('cuts', 0), COUNT.get('descs', 0)] == [b_cut + 1, b_desc], '采纳＋换那句＝零 AI，不再补发'
    print('PASS: 点一下「🔮 用这句」＝那一屏那句换成第 2 行（keySid/keyText 落定、提名自己收掉；全程只有那一发）', flush=True)

    # ── 7) ④ 🔁 照这一派重出分镜：段文本 / 顺序不动，只换分镜那一格 ──────────
    st7a = state(pg)
    pg.locator('#npShotTable .np-desc-regen').click()
    pg.wait_for_function('(t) => Array.from(document.querySelectorAll(".np-shot-desc"))'
                         '.every(x => x.value.indexOf(t) === 0)', arg=DESC_TAG, timeout=30000)
    assert LAST['leg'] == 'descs', LAST
    sysmsg, user = LAST['system'], LAST['user']
    assert '你在改一条' in sysmsg and '一个字都别改' in sysmsg, sysmsg[:160]
    assert '【这一套图的取材路子】' in sysmsg and '【本次画面流派】' + MOTIF in sysmsg, sysmsg[-400:]
    assert '条数＝2 条' in sysmsg and '【画面尺寸】' in user, '一批 2 屏：条数与尺寸都要带给 AI'
    assert '【整篇原文（只重写下面列出的那几段' in user and '钩子重写了。' in user, user[:260]
    assert '—— 第 1 张 / 共 2 张 ——' in user and '前一段：（这就是第一张）' in user, user[:300]
    assert '—— 第 2 张 / 共 2 张 ——' in user and '后一段：（这就是最后一张）' in user, user[-400:]
    assert '这一屏那句话（客户选定的' in user and '中间这段换了说法。' in user, '④ 点定的那句要带进去当上下文'
    st7 = state(pg)
    assert [x['text'] for x in st7['items']] == [x['text'] for x in st7a['items']], '段文本一个字不许被重出带跑：%s' % st7
    nz = lambda s: ' '.join(str(s).split())
    assert [x['desc'] for x in st7['items']] == [DESC_TAG + '：' + nz(x['text']) for x in st7['items']], st7
    pouts = pg.evaluate('''() => Array.from(document.querySelectorAll('.np-shot-pout')).map(x => x.textContent)''')
    assert len(pouts) == 2 and all(DESC_TAG in x for x in pouts), '④ 那一列的提示词要跟着重排：%s' % pouts
    poll('''(a) => chrome.storage.local.get('np_notes').then(d => {
        const n = (d.np_notes || []).find(x => x.id === a.id) || {};
        const ds = ((((n.imgDocs || [])[0] || {}).shots) || {}).items || [];
        return ds.length === a.n && ds.every(it => String(it.desc || '').indexOf(a.t) === 0); })''',
        {'id': ar_id, 'n': 2, 't': DESC_TAG}, timeout=15000)
    rec = archive(pg, ar_id)
    assert rec['imgDocs'] and rec['imgDocs'][0]['motif'] == MOTIF, rec
    assert rec['imgDocs'][0]['descs'] == [x['desc'] for x in st7['items']], '重出的分镜要落进这一档那一行：%s' % rec
    assert COUNT.get('descs', 0) == b_desc + 1, '2 屏＝一批一发，不该分屏各烧一次：%s' % COUNT
    print('PASS: 🔁 这发把流派取材 + 整篇原文 + 第几张/前后段带齐，只换 2 格分镜、段文本与顺序不动、提示词当场重排并落档', flush=True)

    # ── 8) 接口挂掉：错误要落到 ④ 那一块上，不能只转圈 ────────────────────────
    srv.shutdown()
    srv.server_close()
    to_tab('desc')
    pg.locator('#npShotTable .np-cut-suggest').click()
    expect(pg.locator('#npShotTable')).to_contain_text('提名句没回来', timeout=30000)
    pg.wait_for_function('() => !document.querySelector(".np-cut-suggest[disabled]")')
    print('PASS: 接口挂掉时 ④ 挑这句台报「提名句没回来」，那颗按钮还能再点：%s' %
          pg.evaluate('() => npS().shots.cutErr')[:40], flush=True)

    # ── 9) 档案那行「下一步」→ 进字效编辑器（旧的「🎬 渲染任务」表已撤）：挑一种成片形式，念的就是这一篇的正文 ──
    # 七十改口径：一篇一个活，出片从档案那行直接进——它是视频篇的站（照真出口的形状把这一篇置成视频档：voice＝正文）
    pg.evaluate('''async (a) => {
        const d = await chrome.storage.local.get('np_notes');
        const list = d.np_notes || [];
        const n = list.find(x => x && x.id === a.id);
        if (!n) return false;
        n.voice = a.voice; n.form = '视频';
        await chrome.storage.local.set({ np_notes: list });
        return true;
    }''', {'id': ar_id, 'voice': VOICE_EDIT})
    pg.evaluate('() => switchMainTab("noteArchive")')
    pg.wait_for_function('(id) => !!document.querySelector(".npar-next[data-id=\\"" + id + "\\"]")', arg=ar_id)
    pg.locator('.npar-next[data-id="%s"]' % ar_id).click()
    pg.wait_for_function('() => document.querySelectorAll("#filmGate .np-kind-pick").length === 6')
    pg.locator('#filmGate .np-kind-pick[data-k="PPT字体动效"]').click()
    pg.wait_for_function('''(a) => { const F = window.Film;
        return !!(F && F.noteId === a[0] && F.scenes.length && String(F.script) === a[1])
            && getComputedStyle(document.getElementById('filmGate')).display === 'none'; }''',
        arg=[ar_id, VOICE_EDIT], timeout=30000)
    poll('''(a) => chrome.storage.local.get('np_notes').then(d => {
        const n = (d.np_notes || []).find(x => x.id === a.id) || {};
        const rows = n.filmDocs || [];
        return rows.length === 1 && rows[0].kind === 'PPT字体动效' && rows[0].key === a.id; })''',
        {'id': ar_id}, timeout=15000)
    # 递稿是异步的（npFilmHand → Film.loadNote 里先 await docsGet）：台子「在跑」≠稿子已经放进去，
    # 得等那一格真填上了再判（等不到就让下面那句断言把实际值报出来）
    try:
        pg.wait_for_function('(t) => { const el = document.querySelector("#filmPane #script"); return !!el && el.value === t; }',
                             arg=VOICE_EDIT, timeout=15000)
    except Exception:
        pass
    assert pg.locator('#filmPane #script').input_value() == VOICE_EDIT, pg.locator('#filmPane #script').input_value()[:80]
    # 片台念的是这一篇正文；幕按「🖼 出图」那张画面表排（一行＝一段底图，同一段按字数再切）——2 屏＝2 幕，别拿整篇自己乱切
    assert pg.evaluate('() => window.Film.scenes.length') == len(st7['items']), \
        '片台该按这一篇的画面表排幕（%d 屏）：%s' % (len(st7['items']), pg.evaluate('() => window.Film.scenes.length'))
    assert [COUNT.get('cuts', 0), COUNT.get('descs', 0)] == [b_cut + 1, b_desc + 1], '进台子／挑形式都不该再补打 AI'
    print('PASS: 档案那行「下一步」→ 进字效编辑器挑形式（「PPT字体动效」落 filmDocs），念的就是这一篇的正文、幕按这一篇画面表排（%d 屏＝%d 幕）'
          % (len(st7['items']), pg.evaluate('() => window.Film.scenes.length')), flush=True)

    assert not errs, errs
    print('PASS: 无 pageerror', flush=True)
    print('\n全绿：真接口那一跳（成稿 / 整篇改 / 逐句改 / ③ 拉行号圈屏 / 🔮 挑每屏那句 / 🔁 重出分镜 / ③ 只读重列 / 正文进片台 / 挂了报错）', flush=True)
    ctx.close()
