# -*- coding: utf-8 -*-
"""素材库页内两签自检（老板 2026-10-15 两条改版令：① 这一页拆成「🗂 集合配置 / 🎞 素材内容」两签；
② 集合的用/停用不人肉翻案，改由 AI 按账号诊断配，人改过的那条 AI 重算不覆盖）。

口径：
  1) 类那一层（这类该不该有料）由 AI 按账号诊断判：该备 / 不用备 / 待你定，灰档那三类默认不用备；
     「这一集这次用不用」不再问第二次 AI，扩展本地按 类判定 ＋ 有没有料 ＋ 账号阶段 推出来；
  2) 没答诊断问卷时那一发要顶回来（提示先去答问卷），不许瞎判；
  3) 人手动改过的集合打 mine 标，AI 重算跳过它；类那一层人翻案过记在 own 覆盖里，改回 AI 那档就撤掉覆盖；
  4) 档案那句「还缺 N 项」只算明确「在用」的集合（老板 2026-10-16 定）——停用和「还没定」都不报缺；
  5) 「🎞 素材内容」签只列在用的集合（＋你现在点中的那一集），连播与图墙照旧。

跑法：python3 -X utf8 scripts/dev/check_asset_kinds_page.py
临时 profile 加载真扩展（msedge），全程 AI 走桩、不烧真接口。
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

NEED_KINDS = ['team', 'prod', 'before', 'case', 'scene', 'qual', 'ugc', 'make', 'risk', 'qa']
NO_KINDS = ['tool', 'chart', 'ship', 'store', 'tpl', 'hot', 'brand']
ASK_KINDS = ['price']

COLS = [
    {'id': 'col-team', 'name': '师傅干活的照片', 'desc': '施工队现场照片，横版，用在案例封面', 'source': '自己加的', 'manual': True, 'link': None, 'at': 1},
    {'id': 'col-chat', 'name': '客户聊天截图', 'desc': '顾客返修前后的聊天记录，名字打码', 'source': 'sell|省时间', 'manual': False, 'link': None, 'at': 1},
    {'id': 'col-empty', 'name': '空集合一枚', 'desc': '还没料的这一集', 'source': 'kb|屋面施工', 'manual': False, 'link': None, 'at': 1},
]
CLIPS = [
    {'id': 'clip-1', 'col': 'col-team', 'src': '现场01.mp4', 'a': 0, 'b': 8, 'dur': 8, 'stage': '施工', 'kb': None, 'vo': '这一句讲施工', 'tags': [], 'fo': [], 'thumb': '', 'ref': ''},
    {'id': 'clip-2', 'col': 'col-chat', 'src': '返修聊天.jpg', 'imgOnly': True, 'stage': '', 'kb': None, 'vo': '', 'tags': [], 'fo': [], 'thumb': '', 'ref': ''},
]

SEED = r'''async (payload) => {
    await Storage.initializeDefaults(DEFAULT_PROMPTS);
    await ensureTenantInit();
    const cfg = await Storage.getConfig();
    cfg.product.name = '屋面防水服务';
    cfg.product.sellPoints = [{title: '省时间', content: '当天进场，三天收口'}];
    cfg.ai.apiKey = 'test-local-only';
    cfg.diagnosis = {
        accountType: '同城服务',
        answers: [
            {q: '1. 你是这行里的什么人', answer: '老师傅·带队的'},
            {q: '3. 你凭什么让人信', answer: '服务过 100+ 客户｜有资质证书'},
            {q: '11. 手上有什么真实素材', answer: '真人照片｜顾客反馈截图·聊天记录｜老物件·工具·原料'},
        ],
        updatedAt: Date.now(),
    };
    await Storage.setConfig(cfg);
    await chrome.storage.local.set({
        np_collections: payload.cols,
        np_clips: payload.clips,
        np_notes: [{id: 'note-1', title: '屋面防水三步', status: '待发', platform: 'xhs', form: '图文',
                    sellPoints: [{point: '省时间'}], kb: [{title: '屋面施工'}], draft: '正文一句。', createdAt: Date.now()}],
    });
    self.ak = {hit: 0, reqs: []};
    AiClient.chatCompletion = async (cfg2, system, user) => {
        const sys = String(system || '');
        if (sys.indexOf('你是素材备料的判定助手') < 0) return {content: '{"__stub":"不该烧的这一发"}'};
        self.ak.hit++;
        self.ak.reqs.push(user);
        const kinds = [];
        payload.need.forEach(k => kinds.push({k: k, v: 'need', why: '诊断勾了真实素材：' + k}));
        payload.ask.forEach(k => kinds.push({k: k, v: 'ask', why: '这一类跨形态，判不准'}));
        payload.no.forEach(k => kinds.push({k: k, v: 'no', why: '这一类用不上'}));
        const cols = [];
        if (user.indexOf('师傅干活的照片') >= 0) cols.push({name: '师傅干活的照片', kind: 'team'});
        if (user.indexOf('客户聊天截图') >= 0) cols.push({name: '客户聊天截图', kind: 'ugc'});
        if (user.indexOf('空集合一枚') >= 0) cols.push({name: '空集合一枚', kind: 'qa'});
        return {content: JSON.stringify({kinds: kinds, cols: cols})};
    };
    return true;
}'''


def boot(p):
    for i in range(5):
        prof = OUT / ('akind-profile%d' % i)
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
    assert sw.evaluate('typeof AssetKinds === "object" && AssetKinds.ids().length === 18'), \
        '18 类那张表在后台读不到：lib/asset-kinds.js 没进 background.js 的 importScripts'
    sw.evaluate(SEED, {'cols': COLS, 'clips': CLIPS, 'need': NEED_KINDS, 'no': NO_KINDS, 'ask': ASK_KINDS})

    page = ctx.new_page()
    page.on('pageerror', lambda e: ERRORS.append(str(e)[:220]))
    page.set_viewport_size({'width': 1280, 'height': 980})
    goto_big(page, sw.url.replace('background.js', 'popup.html?mode=big'))
    page.wait_for_function('typeof switchMainTab === "function" && typeof renderNoteAssets === "function" '
                           '&& typeof npAssetKindOf === "function"')
    page.set_default_timeout(25000)
    assert page.evaluate('typeof AssetKinds === "object" && AssetKinds.NP_ASSET_KINDS.length === 18'), \
        '18 类那张表在 popup 读不到：popup.html 少了 lib/asset-kinds.js 那行 script'

    def st(expr):
        return page.evaluate('() => (%s)' % expr)

    def cols():
        return page.evaluate('async () => await npCollectionsRead()')

    def kind_state():
        return page.evaluate("(async () => (await chrome.storage.local.get('np_asset_kinds')).np_asset_kinds)()")

    def as_tab(t):
        page.locator('#noteAssetsContent .nt-tab[data-tab="%s"]' % t).click()
        page.wait_for_function("(b) => !!document.querySelector(b)", arg='#noteAssetsContent .nt-tab.active')
        assert st("document.querySelector('#noteAssetsContent .nt-tab.active').getAttribute('data-tab')") == t

    def col(id):
        return next((c for c in cols() if c and c.get('id') == id), None)

    page.evaluate("() => switchMainTab('noteAssets')")
    page.wait_for_function("() => !!document.querySelector('#noteAssetsContent .nt-tab')")

    print('〔1〕两签都在，打开默认落「🗂 集合配置」')
    tabs = page.locator('#noteAssetsContent .nt-tab').evaluate_all('els => els.map(x => x.getAttribute("data-tab"))')
    assert tabs == ['cfg', 'con'], '页内两签不对：%s' % tabs
    assert st("document.querySelector('#noteAssetsContent .nt-tab.active').getAttribute('data-tab')") == 'cfg', '默认没落在集合配置签'
    assert st("!!document.querySelector('#noteAssetsContent .npas-cfg')"), '没有那颗「🤖 重新配置」'
    assert st("!!document.querySelector('#noteAssetsContent #npasQ')"), '集合配置签上没有搜索框'
    print('  ✓ 两签齐（%s），默认在集合配置' % ','.join(tabs))

    print('〔2〕集合行上有：用/停用开关 ＋ 归类 chip ＋ AI 那一行为什么')
    rows = page.locator('#noteAssetsContent .npas-row').count()
    assert rows == 3, '集合配置签该有 3 行（还没配也照列），实到 %d' % rows
    assert page.locator('#noteAssetsContent .npas-sw').count() == 3, '每行都要有用/停用开关'
    assert page.locator('#noteAssetsContent .npas-kd.npas-kindchip.gray').count() == 3, '还没归类的行要显示「还没归类 ✎」'
    assert st("document.querySelector('#noteAssetsContent .npas-row .npas-why').innerText.indexOf('还没配') >= 0"), \
        '没配过时那行要指着「🤖 重新配置」'
    print('  ✓ 3 行都有开关与类 chip')

    print('〔3〕没答诊断问卷时那一发顶回来（这里已答，改测「答完顺手配」的通路存在）')
    assert st("typeof npAsConfigKinds === 'function'"), '没有配用/停用的那一步'
    assert st("typeof configAssetKindsBg === 'function'") is False, '后台的函数不该出现在 popup 里'
    no_ans = sw.evaluate('''async () => {
        const cfg = await Storage.getConfig();
        cfg.diagnosis = {accountType: '同城服务', answers: [], updatedAt: Date.now()};
        await Storage.setConfig(cfg);
        try { await configAssetKindsBg({cols: []}); return 'NO_THROW'; }
        catch (e) { return String(e && e.message || e); }
    }''')
    assert '还没答账号诊断问卷' in no_ans, '没答问卷时没顶回来：%s' % no_ans
    sw.evaluate('''async () => {
        const cfg = await Storage.getConfig();
        cfg.diagnosis.answers = [
            {q: '1. 你是这行里的什么人', answer: '老师傅·带队的'},
            {q: '3. 你凭什么让人信', answer: '服务过 100+ 客户｜有资质证书'},
            {q: '11. 手上有什么真实素材', answer: '真人照片｜顾客反馈截图·聊天记录｜老物件·工具·原料'}];
        await Storage.setConfig(cfg);
    }''')
    print('  ✓ 没答问卷 → 「%s」' % no_ans[:24])

    print('〔4〕点「🤖 重新配置」：AI 判 18 类 ＋ 归类集合，用/停用本地推')
    page.locator('#noteAssetsContent .npas-cfg').click()
    page.wait_for_function("() => !!document.querySelector('#noteAssetsContent .npas-kindchip.need')", polling=400)
    ks = kind_state()
    assert ks and len(ks.get('kinds', {})) == 18, '18 类没判齐：%s' % (ks and len(ks.get('kinds', {})))
    assert ks['kinds']['team']['v'] == 'need' and ks['kinds']['tpl']['v'] == 'no', '桩的回答没落进外账'
    assert ks.get('at'), '没记上次配置时间'
    hit = sw.evaluate('() => self.ak.hit')
    assert hit == 1, '那一发烧了 %d 次（该只一次，用不用本地推不再问第二遍）' % hit
    req = sw.evaluate('() => self.ak.reqs[0]')
    assert '屋面防水服务' in req and '老师傅·带队的' in req and '顾客反馈截图·聊天记录' in req, '诊断与产品没进提示词'
    assert '【现有素材集合' in req and '师傅干活的照片' in req, '现有集合没进提示词'
    print('  ✓ 只烧一发；外账 18 条；提示词吃了诊断回答与现有集合')

    print('〔5〕归类落了、用/停用按类推出来')
    c_team, c_chat, c_empty = col('col-team'), col('col-chat'), col('col-empty')
    assert c_team['kind'] == 'team' and c_chat['kind'] == 'ugc' and c_empty['kind'] == 'qa', 'AI 归的类没落进集合：%s/%s/%s' % (
        c_team.get('kind'), c_chat.get('kind'), c_empty.get('kind'))
    assert c_team['use'] == 'on', '该备＋有料 → 该在用，实到 %s（%s）' % (c_team.get('use'), c_team.get('why'))
    assert c_chat['use'] == 'on' and '省时间' in str(c_chat.get('why')), '卖点来的那条理由没带卖点：%s' % c_chat.get('why')
    assert c_empty['use'] == 'ask' and '待补充' in str(c_empty.get('why')), '该备但空的集合该是还没定：%s' % c_empty.get('why')
    assert not c_team.get('mine'), 'AI 配的不该标「你改过」'
    assert st("document.querySelector('#noteAssetsContent .npas-row .npas-sw.on')") is not None, '墙上没画出「✓ 用」'
    print('  ✓ 用 %s / 还没定 %s；理由句各带出处' % (c_team['use'], c_empty['use']))

    print('〔6〕灰档那三类默认不用备；判不准那条留在「待你定」')
    assert st("document.querySelector('#noteAssetsContent .npas-chk').innerText.indexOf('待你定 1') >= 0"), \
        '价格/优惠那类桩里判 ask，计数条没体现'
    page.locator('#noteAssetsContent .npas-chk').click()
    page.wait_for_function("() => !!document.querySelector('#noteAssetsContent .npas-kindrow')")
    grows = page.locator('#noteAssetsContent .npas-kindrow').count()
    assert grows == 18, '判类面板该有 18 行，实到 %d' % grows
    gray_txt = page.locator("#noteAssetsContent .npas-kindrow[data-k='tpl']").evaluate('e => e.innerText')
    assert '不用备' in gray_txt and '标题/封面模板' in gray_txt, '灰档那行没跟着判：' + gray_txt[:40]
    assert st("document.querySelector(\"#noteAssetsContent .npas-kindrow .tx\").innerText.indexOf('出图那侧用到它的流派') >= 0"), \
        '判类面板没带出图那侧的引用'
    print('  ✓ 18 行判据都在（含灰档 3 行、被引用那几类的流派行）')

    print('〔7〕人改过的集合：AI 重算不覆盖（lock=keep）')
    page.locator("#noteAssetsContent .npas-sw[data-id='col-team']").click()
    page.wait_for_function("async () => { const c = (await npCollectionsRead()).find(x => x.id === 'col-team'); return c && c.use === 'off' && c.mine === 1; }")
    why_before = col('col-team').get('why')
    hits0 = sw.evaluate('() => self.ak.hit')
    page.locator('#noteAssetsContent .npas-cfg').click()
    for _ in range(60):
        if sw.evaluate('() => self.ak.hit') > hits0:
            break
        time.sleep(0.25)
    time.sleep(0.6)
    c2 = col('col-team')
    assert c2['use'] == 'off' and c2.get('mine') == 1, '人停用过的集合被 AI 翻回去了：%s' % c2.get('use')
    assert sw.evaluate('() => self.ak.hit') == 2, '重算没再烧一发'
    assert st("!!document.querySelector(\"#noteAssetsContent .npas-row.mine .npas-own\")"), '没画出「你改过」'
    print('  ✓ 翻案那条保住（%s → %s），AI 没动它' % (why_before[:12], c2['use']))

    print('〔8〕档案缺口只算明确在用的集合：还没定不报 → 转在用才报 → 停用又不报')
    def gaps_of():
        return page.evaluate("""async () => {
            const n = (await npNotesAll()).find(x => x.id === 'note-1');
            const g = await npAsGapsFor([n]);
            return (g['note-1'] || []).map(x => x.id);
        }""")
    def set_use(use, mine):
        page.evaluate("""async (u) => {
            const cols = await npCollectionsRead();
            const c = cols.find(x => x.id === 'col-empty');
            c.use = u.v; if (u.m) c.mine = 1; else delete c.mine;
            await npCollectionsWrite(cols);
        }""", {'v': use, 'm': mine})
    gap_ids = gaps_of()
    assert 'col-empty' not in gap_ids, '还没定的空集合不该报缺（只认在用）：%s' % gap_ids
    assert 'col-chat' not in gap_ids, '有料的集合不该报缺：%s' % gap_ids
    set_use('on', False)
    gap_ids2 = gaps_of()
    assert 'col-empty' in gap_ids2, '翻成在用的空集合该报缺：%s' % gap_ids2
    set_use('off', True)
    gap_ids3 = gaps_of()
    assert 'col-empty' not in gap_ids3, '停用的集合还在报缺：%s' % gap_ids3
    print('  ✓ 还没定 %s → 在用 %s → 停用 %s' % (gap_ids, gap_ids2, gap_ids3))

    print('〔9〕「🎞 素材内容」签：只列在用的（＋点中的那一集），连播与图墙照旧')
    as_tab('con')
    pk = page.locator('#noteAssetsContent .npas-pk').evaluate_all('els => els.map(x => x.getAttribute("data-id"))')
    assert 'col-team' not in pk, '停用的集合不该在 picker 里：%s' % pk
    assert pk == ['col-chat'], '在用的该只有客户聊天截图那一集：%s' % pk
    assert st("!!document.querySelector('#noteAssetsContent .npas-pk.active')"), '内容签没把当前集合挑上'
    assert st("document.querySelector('#noteAssetsContent .nt-tab[data-tab=\"con\"]').innerText.indexOf('1 个在用') >= 0"), '签头上没报在用几个'
    assert page.locator('#noteAssetsContent .card.npas-imgonly').count() == 1, '纯图那条该在图墙里标「还没剪」'
    as_tab('cfg')
    page.locator("#noteAssetsContent .npas-go[data-id='col-team']").click()
    page.wait_for_function("() => document.querySelector('#noteAssetsContent .nt-tab.active').getAttribute('data-tab') === 'con'")
    pk2 = page.locator('#noteAssetsContent .npas-pk').evaluate_all('els => els.map(x => x.getAttribute("data-id"))')
    assert 'col-team' in pk2, '从配置签点进来的那一集该列出来（哪怕停用）：%s' % pk2
    assert st("!!document.querySelector('#noteAssetsContent .npas-usetoggle')"), '内页没有那颗启用/停用开关'
    page.locator('#noteAssetsContent .npas-tabback').click()
    page.wait_for_function("() => document.querySelector('#noteAssetsContent .nt-tab.active').getAttribute('data-tab') === 'cfg'")
    print('  ✓ 签 B 只列在用 ＋ 当前点中；两签来回切得动')

    print('〔10〕类那一层人翻案：改一下换档、改回 AI 那档就撤掉覆盖')
    before = st("document.querySelector(\"#noteAssetsContent .npas-grp .npas-kv[data-k='team']\").innerText")
    assert before == '该备', '开局该是该备：%s' % before
    page.locator("#noteAssetsContent .npas-grp .npas-kv[data-k='team']").click()
    page.wait_for_function("() => document.querySelector(\"#noteAssetsContent .npas-grp .npas-kv[data-k='team']\").innerText !== '%s'" % before)
    own1 = kind_state().get('own', {})
    assert own1.get('team') in ('no', 'ask'), '点一下没写进人翻案那格：%s' % own1
    assert st("!!document.querySelector(\"#noteAssetsContent .npas-grp .npas-kv[data-k='team'].mine\")"), '翻案过没标「你改过」'
    for _ in range(2):
        page.locator("#noteAssetsContent .npas-grp .npas-kv[data-k='team']").click()
        time.sleep(0.35)
    mid = st("document.querySelector(\"#noteAssetsContent .npas-grp .npas-kv[data-k='team']\").innerText")
    own2 = (kind_state().get('own') or {}).get('team')
    assert own2 is None, '转回 AI 判的那一档没撤掉覆盖：%s' % own2
    assert mid == '该备', '转一圈没回到该备：%s' % mid
    print('  ✓ 该备 → 不用备 → 待你定 → 该备（人翻案记在 own，改回 AI 那档自动撤）')

    print('〔11〕新建集合不给类不让存；建出来的空集合落「待补充」')
    page.locator('#noteAssetsContent .npas-new-open').click()
    page.wait_for_function("() => !!document.querySelector('#npasAddDesc')")
    page.fill('#npasAddDesc', '真实报价口径：几平起、含不含料')
    page.locator('#noteAssetsContent .npas-new-save').click()
    time.sleep(0.3)
    assert st("!!document.querySelector('#npasAddDesc')"), '没归类也能存下了'
    page.locator("#noteAssetsContent .npas-nk[data-k='price']").click()
    page.wait_for_function("() => !!document.querySelector(\"#noteAssetsContent .npas-nk[data-k='price'].on\")")
    page.locator('#noteAssetsContent .npas-new-save').click()
    page.wait_for_function("async () => (await npCollectionsRead()).some(c => c.kind === 'price')")
    fresh = [c for c in cols() if c.get('kind') == 'price']
    assert fresh and fresh[0]['use'] == 'ask', 'AI 判不准那一类新建的空集合该是还没定：%s' % fresh[0].get('use')
    print('  ✓ 不给类拦得住；建出来那条 use=%s' % fresh[0]['use'])

    print('〔12〕✎ 改集合弹窗：改归类跟着这一类重推用不用（没被人锁住时）')
    page.locator("#noteAssetsContent .npas-ed[data-id='col-chat']").click()
    page.wait_for_function("() => !!document.querySelector('#npasEdName')")
    assert st("document.querySelector('#npasEdName').disabled === false"), '整编弹窗里名目该能改'
    page.locator("#noteAssetsContent .npas-mk[data-k='case']").click()
    page.wait_for_function("() => !!document.querySelector(\"#noteAssetsContent .npas-mk[data-k='case'].on\")")
    page.locator('#noteAssetsContent .npas-ed-save').click()
    page.wait_for_function("async () => { const c = (await npCollectionsRead()).find(x => x.id === 'col-chat'); return c && c.kind === 'case'; }")
    assert col('col-chat')['kind'] == 'case', '改的类没落盘：%s' % col('col-chat').get('kind')
    assert col('col-chat')['use'] == 'on', 'case 在桩里判 need、这一集有 1 条料 → 该在用，实到 %s' % col('col-chat')['use']
    assert '省时间' in str(col('col-chat').get('why')), '理由该带这一集的出处：%s' % col('col-chat').get('why')
    print('  ✓ 改类后落盘，用/停用与理由跟着这一类重推（case 桩里判 need → %s）' % col('col-chat')['use'])

    print('〔13〕点空白关弹窗 ＋ 全程无页面报错')
    page.locator("#noteAssetsContent .npas-kd[data-id='col-team']").click()
    page.wait_for_function("() => !!document.querySelector('.npas-modal-edit')")
    assert st("document.querySelector('#npasEdName').disabled === true"), '只改归类的弹窗里名目该灰着'
    page.locator('.npas-modal-edit').click(position={'x': 6, 'y': 6})
    page.wait_for_function("() => !document.querySelector('.npas-modal-edit')")
    assert not ERRORS, '页面报错：\n' + '\n'.join(ERRORS)
    print('  ✓ 空白处一点就关，pageerror 0 条')

    print('〔14〕同一版诊断只自动配一次：没配上也不跟着切页面反复烧')
    page.evaluate("() => { npAsKindStateRead().then(x => { x.tried = '撞不出来的旧指纹'; x.sig = x.tried; return npAsKindStateWrite(x); }); }")
    hits_before = sw.evaluate('() => self.ak.hit')
    page.evaluate("async () => { await npAsConfigKinds(null, {}); await npAsConfigKinds(null, {}); }")
    assert sw.evaluate('() => self.ak.hit') == hits_before + 1, \
        '连着跑两轮「按诊断顺手配」烧了 %d 发（同一版诊断该只 1 发）' % (sw.evaluate('() => self.ak.hit') - hits_before)
    page.locator('#noteAssetsContent .npas-cfg').click()
    for _ in range(60):
        if sw.evaluate('() => self.ak.hit') >= hits_before + 2:
            break
        time.sleep(0.25)
    assert sw.evaluate('() => self.ak.hit') == hits_before + 2, '点「🤖 重新配置」该照烧一发（手动重来不受记账拦）'
    print('  ✓ 自动那一路只 1 发；手动那颗照样能重来')

    print('\nALL PASS 素材库两签 14 节')


if __name__ == '__main__':
    try:
        main()
    except AssertionError as e:
        import traceback
        print('FAIL: %s' % e)
        traceback.print_exc()
        if ERRORS:
            print('页面报错：\n' + '\n'.join(ERRORS))
        sys.exit(1)
