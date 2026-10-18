# -*- coding: utf-8 -*-
"""造图片 ④ 那一档（一屏一张卡：左 🖼 造图 → 每行提示词 → 每行传图；右 ✍️ 配文）的自检（老板 2026-10-02 五十七改：断句单独成了一档；五十八改④：编号提示词与传图撤成一档、并进分镜的每一行；六十改：「图描述」改名「分镜」，并且只写画面；六十三改：② 新加「🖼 封面」那一档，下面这些编号顺次后移；六十四改：② 收轻（那一档只剩两栏＋一颗 ✨，归 check_note_cover.py 管）、③ 改名「🎯 断句」（段＝屏）；六十五改：★ 从 ③ 挪进 ④ 的配文栏、四列表改成一屏一张卡、「字后压」——AI 只交干净底图，字由扩展本地压）。

分工（三条自检各管一层，别重叠）：
  · check_note_look.py        ＝ ① 那一档（流派 + 两轴 + 出图张数 + 配文方式四档 + 打底／账号默认／这一套三层 + 所见即所得小样）
  · check_note_cover.py       ＝ ② 那一档（两栏：封面那一句文案＋那一张的提示词、✨ 一发、开关与传图）
  · check_note_cut.py         ＝ 那一档本身（带行号的正文框、拖行号成屏、🔮 挑每屏那句）
  · check_desc_candidates.py  ＝ 🔁 一屏三条候选、挑一条、老写法只回一条
  · 本文件                    ＝ ④ 那张卡本身：这一屏那句（选句器 ★）／分镜三块 → 配文方式那几格（承接／标注／小注／重点／字位）→ 每行提示词 → 每行 ⬆ 传图 → ⑤ 预览顶上那条检查 → 落档往返（② 只当关卡关掉）

口径（五档：① 🎨 风格 → ② 🖼 封面 → ③ 🎯 断句 → ④ 🖋 分镜 → ⑤ 👀 预览 · 图文对照）：
  1) 屏是 ③ 在行号上圈出来的（点一行＝那一行自己占一屏；那一路不烧 AI，一屏＝一段＝一张图）：到了 ④ 这张卡，
     「这段原文」只读（要改字回 ③），「这一屏那句」由右栏选句器从本屏那几行里点（★ 从 ③ 挪到这儿来了，真源 items[].keySid），
     没屏时这一档明说「这一档在等 ③」，🔁 那颗连摆都不摆（摆了也是骗人）；
  2) ④ 分镜空着就标红催，🔁 照这一派重出才写它（它在 ④ 的表头，不在 ①）；六十改起这一格只写画面，六十二改收成三块
     （这一张要证明／画面里必须出现的元素（逐条编号、至少一条自带「这就是……的凭据」）／背景，歧义词另加一行先说清楚），
     图上放哪句文案不归它写——桩故意把那一发写成抄文案 → 界面零 AI 判出「⚠️ 还是在抄文案」，那颗钮点一下＝只重出被点的那一屏（一发，别的屏一个字不动）；
  3) 手改过分镜那一格就挂 🔒：🔁 跳过它，点一下锁放开；改字只重拼提示词，不许整页甩（光标会丢）；
  4) 图上那套字＝「配文方式」四档（说一次／辅助标注／整段上屏／只一句大字），整套默认档在 ① 与「🎨 出图默认」拨，
     某一张要换就在 ④ 那一行的配文栏换；定了档才展开要填的那几格（承接／标注／小注／重点那几个字／字位），换档不留残字；人写过就挂 🔒 字，🔁 只换画面不顶它；
     字后压（六十五改）：提示词里没有那几句字本身——只有「这一屏的字是后压的，你不许画进去」＋『字位』那一格留干净的底（九宫格枚举：
     说一次＝左下、辅助标注＝上中、整段上屏／只一句大字＝正中），字由扩展本地压上屏；
     提示词就在 ④ 每一行里（编号／分镜三块、并标明「这几行是定画面的说明、别写上屏」／字后压留白（字位）／两轴令牌（画面形式＋主题）／底图＋通则／合规尾巴），改上面当场重排，一次 AI 都不烧；
     两条通道分开走：流派只进 AI 那一发，不进提示词尾巴；两轴有内置统一小红书打底（实拍那一挂）兜着，尾巴永不为空；
  5) ② 那一档六十四改收轻：只剩两栏（那一句文案＋那一张的提示词）＋一颗 ✨，归 check_note_cover.py 验；
     本文件只把它当关卡关掉（「不出封面」零 AI），所以一次复制全部那一份也不带封面；表头那颗 🔁 从不占它一发；
  6) 图按画面号传回来就在每一行最后一格：进素材库（只存引用＋缩略图，原图不搬）挂在段上，
     缺几张挂在 ⑤ 顶上那条检查里（零 AI 扫），点一条跳到 ④ 的那一行；
  7) 这张表跟这一行走：落档后从档案再进来读得回（段／分镜／锁／挂着的图／封面／字位都在），一次 AI 都不重烧。

跑法：python3 -X utf8 scripts/dev/check_note_shots.py
临时 profile 加载真扩展（msedge），全程 AI 走桩、不烧真接口。
"""
import json
import pathlib
import shutil
import struct
import sys
import tempfile
import time
import zlib

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

# 3 段（一段一句）：每句都够长（去掉标点后 ≥24 字），桩把「分镜」原样抄回来时那套零 AI 判法一定判红
# 取 3 段是为了让 🔁 一次一批（NP_DESC_BATCH＝3）：分批与候选那条路归 check_desc_candidates.py
SENTS = [
    '很多人一上来就对着表格一条条手改，改到半夜还漏了好几处没有对上。',
    '第二步拿固定的模板去套，重复出现的那几段直接复用，不用每次重新敲。',
    '第三步让工具自己跑一遍校验，跑完只留给你一小段要人工确认的清单。',
]
BODY = '\n\n'.join(SENTS)

MOTIF = '方案页'
# 内置统一小红书打底那一派 + 那两轴（账号默认没设时尾巴带的就是它；七十一改：打底换成手机随拍那一挂）
XHS_MOTIF = '真人工作场景'
XHS_TOKEN = '手机随拍；暗调实拍·单一暖光源'

# 桩「照这一派重出」那一份：六十二改的三块（这一张要证明／画面里必须出现的元素／背景，外加一行先说清楚），
# 画面名词多、不是这段字里那几个词，零 AI 的抄文案判法不该亮
GOOD_DESC = ('这一张要证明：把拆开、套模板、跑校验变成看得见的动作；先说清楚：桌上不许出现电脑屏幕特写；'
             '画面里必须出现的元素：1. 桌面俯拍，左手按住一叠打印纸，最上面那张边角写着日期（这就是改到半夜的凭据）；'
             '2. 右手把三张便签推成三列，列头各贴一小条胶带；3. 桌角一杯放凉的茶，杯壁上一圈茶渍；'
             '背景：晚上家里书桌，台灯从左上单光源，浅景深随手抓拍，不要棚拍不要广告片。')

# 手改那一格（同样不是抄文案，也不写图上放哪几个字；「字排哪儿」挪进配文那一档了）
HAND = ('手改的这一格：这一张要证明＝把套模板那一步站稳；'
        '画面里必须出现的元素＝1. 一叠打印纸摊在桌上，一支红笔圈出两处；'
        '2. 旁边一把尺子压着三张空白模板（这就是不用重新敲的凭据）；背景：白天办公室，窗光从右边来。')

NOTES = "async () => (await chrome.storage.local.get('np_notes')).np_notes || []"

SEED = r'''async (payload) => {
    await Storage.initializeDefaults(DEFAULT_PROMPTS);
    await ensureTenantInit();
    const cfg = await Storage.getConfig();
    cfg.product.name = '分镜表测试产品';
    cfg.product.sellPoints = [{title: '省时间', content: '把重复步骤压掉'}];
    cfg.ai.apiKey = 'test-local-only';
    // 账号默认什么都不设：两轴与配文方式整层落回内置统一小红书打底（手机随拍那一挂），尾巴照样带固定元素
    cfg.imgLook = {};
    cfg.imgMotifs = [];
    await Storage.setConfig(cfg);
    await chrome.storage.local.set({
        np_notes: [{id: 'shot-1', title: '省时间三步', status: '待发', platform: 'xhs', form: '图文',
                    draft: payload.body, createdAt: Date.now()}],
        np_assets: [],
    });
    self.ai = {cut: 0, desc: 0};
    self.other = [];
    self.descSystems = [];
    self.descUsers = [];
    self.descMode = 'shallow';   // shallow＝把段原文原样抄回（验零 AI 的抄文案判法）；good＝照这一派重出
    self.goodDesc = payload.good;
    const TAG = '本段（要写的就是它）：';
    AiClient.chatCompletion = async (cfg2, system, user) => {
        const sys = String(system || ''), us = String(user || '');
        if (sys.indexOf('你在改一条') >= 0) {
            self.ai.desc++;
            self.descSystems.push(sys);
            self.descUsers.push(us);
            const texts = (us.match(/^本段（要写的就是它）：(.+)$/gm) || []).map(s => s.slice(TAG.length));
            const pre = 'R' + self.ai.desc + '｜';
            return {content: JSON.stringify({'风格': '', '画面': texts.map(t => ({
                '句': t, '分镜': self.descMode === 'shallow' ? t : (pre + self.goodDesc)}))})};
        }
        if (sys.indexOf('你在帮一条') >= 0) { self.ai.cut++; return {content: '{"提名句":[]}'}; }
        self.other.push(sys.slice(0, 24));
        return {content: '{"__stub":"不该烧的这一发"}'};
    };
    return true;
}'''


def png(path, w=200, h=260, rgb=(90, 140, 220)):
    """写一张纯色 PNG（只用来验「传回来的图进素材库、只存引用＋缩略图」）"""
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    path.write_bytes(b'\x89PNG\r\n\x1a\n'
                     + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
                     + chunk(b'IDAT', zlib.compress(raw, 6))
                     + chunk(b'IEND', b''))
    return path


def boot(p):
    for i in range(5):
        prof = OUT / ('shots-profile%d' % i)
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
    sw.evaluate(SEED, {'body': BODY, 'good': GOOD_DESC})

    page = ctx.new_page()
    page.on('pageerror', lambda e: ERRORS.append(str(e)[:220]))
    page.set_viewport_size({'width': 1280, 'height': 980})
    goto_big(page, sw.url.replace('background.js', 'popup.html?mode=big'))
    page.wait_for_function('typeof switchMainTab === "function" && typeof npShotsTableHtml === "function"')
    page.evaluate('''() => {
        window.__clip = '';
        try { navigator.clipboard.writeText = async (t) => { window.__clip = String(t); }; } catch (_) {}
        return true;
    }''')
    page.set_default_timeout(25000)

    def ai(k):
        return sw.evaluate('() => self.ai.%s' % k)

    def other():
        return sw.evaluate('() => self.other')

    def note(ar_id='shot-1'):
        return next((x for x in page.evaluate(NOTES) if x and x.get('id') == ar_id), None)

    def st(expr):
        return page.evaluate('() => (%s)' % expr)

    def poll(fn, msg, timeout=20.0):
        """涉及 storage 的回写不走页面侧事件：Python 这边轮询"""
        t0 = time.time()
        while time.time() - t0 < timeout:
            v = fn()
            if v:
                return v
            page.wait_for_timeout(250)
        raise AssertionError('等不到：%s' % msg)

    def until(key, least, expr=None, secs=20):
        """AI 那一发是异步回写的：桩计数在后台、界面状态在页面，两边分开轮询到都落定"""
        t0 = time.time()
        while time.time() - t0 < secs:
            try:
                if key is None or sw.evaluate('() => self.ai.%s >= %s' % (key, least)):
                    if expr is None or page.evaluate('() => (%s)' % expr):
                        return
            except Exception:
                pass
            page.wait_for_timeout(250)
        raise AssertionError('等不到 %s>=%s / %s（桩计数 cut=%s desc=%s）'
                             % (key, least, expr, ai('cut'), ai('desc')))

    def tab_on(t):
        return page.locator('#npImgTabs .np-imgtab[data-t="%s"]' % t)

    def goto_tab(t):
        tab_on(t).click()
        page.wait_for_timeout(260)

    def cur_tab():
        return st('npTabOf(npS())')

    def tab_badge(t):
        return tab_on(t).inner_text().replace(' ', '')

    def gut_box(i):
        el = page.locator('#npCutWrap .np-cutline').nth(i).locator('.np-cut-gut')
        el.scroll_into_view_if_needed()
        return el.bounding_box()

    def poke(i):
        """点一行没归段的行号＝这一句自己成一段（③ 那边验过拖，这里只要「一句一段」这份料）"""
        box = gut_box(i)
        page.mouse.click(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
        page.wait_for_timeout(300)

    def goto_out(add_row=False, tab=None):
        """直开这一篇的「🖼 出图」（档案那一行「下一步」走的同一条路；七十改起界面不再有任务表与行选择器）"""
        def enter():
            page.evaluate('''async () => {
                const list = await npNotesAll();
                const n = list.find(x => x && x.id === 'shot-1') || null;
                switchMainTab('noteOut', n);
            }''')
            page.wait_for_function('() => _npMode === "out" && !!document.querySelector("#npImgTabs .np-imgtab")')
        enter()
        if add_row:
            goto_tab('desc')
            page.wait_for_function('() => !!document.querySelector("#npShotTable .np-img-add")')
            page.locator('#npShotTable .np-img-add').click()
            page.wait_for_function('() => (npS().imgDocs || []).length === 1 && !!npS().imgOpen')
            enter()
        if tab:
            goto_tab(tab)

    def pout(i):
        """④ 那一格提示词的真读口：它在 <details> 里（默认收起），textContent 不受收起影响"""
        return page.locator('.np-shot-pout').nth(i).evaluate('(el) => el.textContent')

    def table():
        return page.locator('#npShotTable').inner_text()

    def check_line():
        """⑤ 顶上那条检查（零 AI 扫全篇缺口）：要读缺口就切到 ⑤"""
        goto_tab('preview')
        return page.locator('#npPreviewBox').inner_text()

    def no_cover():
        """② 那一档点「不出封面」：这一支只管 ④⑤ 那条路，② 归 check_note_cover.py，别拿它当路障"""
        goto_tab('cover')
        page.locator('#npCoverBox .np-cover-on[data-v="0"]').click()
        page.wait_for_function('() => npS().shots.cv.on === false')
        page.wait_for_timeout(220)

    # ── 1) 加一行零 AI：先停在 ②（封面那份还没写），关掉它才往 ③ 走；④ 空着并明说在等 ③，🔁 一颗都不摆 ──
    goto_out(add_row=True)
    assert cur_tab() == 'cover', '这一行封面那一份还没写＝打开先落在 ②：%s' % cur_tab()
    assert (ai('cut'), ai('desc')) == (0, 0), '加一行一次 AI 都不该烧'
    assert page.locator('#npNodes').count() == 0, '那条旧的节点条随横置 tab 下线了'
    no_cover()
    goto_tab('cut')
    assert page.locator('#npCutWrap .np-cutline').count() == 3, '顶上那份文案本地列成 3 行'
    goto_tab('desc')
    assert page.locator('.np-shot').count() == 0 and '这一档在等 ③' in table(), '没屏＝表上明说在等谁'
    assert page.locator('#npRegenBar').count() == 0, '一屏都还没有，🔁 那颗先不摆（摆了也是灰的骗人）'
    assert '在等③' in tab_badge('desc') and '在等③' in tab_badge('preview')
    print('PASS: 屏还没有之前 ④ 是空的（明说「这一档在等 ③」、🔁 不摆、零 AI；② 关掉才放行）', flush=True)

    # ── 2) 屏是 ③ 点 ★ 立起来的：到了这张表两栏只读，一行＝一屏＝一张图 ──
    goto_tab('cut')
    for k in range(3):
        poke(k)
    page.wait_for_function('() => (npS().shots.items || []).length === 3')
    assert (ai('cut'), ai('desc')) == (0, 0), '点 ★ 立屏不烧 AI'
    goto_tab('desc')
    assert page.locator('.np-shot').count() == 3
    assert page.locator('.np-shot-text').count() == 0, '段文本不再是表上的输入框（要改字回 ③ 改那一句）'
    assert page.locator('.np-shot-txt').first.evaluate('el => el.tagName') == 'DIV'
    assert page.locator('.np-shot-txt').first.evaluate('(el) => el.textContent').startswith('很多人一上来')
    kp = page.locator('.np-shot').first.locator('.np-key-pick')
    assert kp.count() == 1, '右边配文栏摆着选句器（★ 那颗从 ③ 挪到这儿来了）：%s' % kp.count()
    kp_txt = kp.first.inner_text()
    assert kp_txt.startswith('★') and '很多人一上来' in kp_txt, '这一屏那句＝★ 选定的那句：%s' % kp_txt
    assert st('npS().shots.items.every(x => (x.sids || []).length === 1 && x.keySid && !x.desc && !x.dlock)')
    assert '还没写分镜' in page.locator('.np-shot').first.inner_text()
    assert '⏳ 还没传图' in page.locator('.np-shot').first.inner_text()
    assert '共 3 屏 · 占图 3 张' in table() and '还有 3 张没图' in table()
    assert '3 屏没写分镜' in table()
    assert '分镜 · 只写画面' in table(), '那一列的表头：改名「分镜」，并且只写画面'
    assert '缺3屏分镜' in tab_badge('desc') and '0/3有图' in tab_badge('preview'), tab_badge('desc')
    print('PASS: 表上一行＝一屏＝一张图（这一屏那句话／这段原文两栏只读、分镜空着标红、每行最后一格一颗传图口）', flush=True)

    # ── 3) 提示词就在这一行：本地拼（编号／字后压留白／两轴／底图与通则／合规尾巴），要压的字一个都不进提示词 ──
    p0 = pout(0)
    assert '配图 第 1 张（共 3 张，竖版 3:4' in p0, p0[:150]
    assert '这一张画面上是：' not in p0, '还没写分镜，提示词不该凭空来一句'
    assert '【这一屏的字是后压的，你不许画进去】' in p0, '字后压：图是干净的底图，字全由扩展本地压：%s' % p0[:400]
    assert '共 1 行' in p0, '这一档要压的是一句大字（说一次·没填承接＝共 1 行）：%s' % p0[:400]
    assert '大字「' not in p0 and SENTS[0] not in p0, '要压的那几句话不进提示词（人没写的除外，连自动摘的第一句也不进）'
    assert '字位＝左下' in p0, '一颗旋钮都没拨＝跟内置打底那一档「说一次」的默认字位（左下）：%s' % p0[:400]
    assert '每一张都带的固定元素：' + XHS_TOKEN in p0, '两轴没设过＝尾巴带内置统一小红书打底那一行（不再空着）：%s' % p0[-260:]
    assert '【底图，这一套每张共用，必须照做】' in p0, p0[-320:]
    assert '【通则】' in p0 and '不出现二维码 / 联系方式' in p0, p0[-200:]
    assert '14 字' not in p0
    print('PASS: 每一行那份提示词全在本地拼（编号 + 字后压留白 + 两轴 + 底图与通则 + 合规尾巴），要压的字一个都不进提示词', flush=True)

    # ── 3c) 七十一改：手机随拍那七条硬约束 / 一次只出一张的护栏 / 主角那一句 ──
    assert '一次只出这一张完整画面：不要拼图' in p0, '编号行下面第一句就是护栏（别拼四宫格、别做成带字的卡片）：%s' % p0[:260]
    assert '【手机随拍必须照做' in p0, '打底＝手机随拍：每一张都带那七条真实感硬约束：%s' % p0[-700:]
    assert '全图只有上面点名的那一处光源' in p0 and '画面里的人一律不看镜头' in p0, '随拍那七条要点名到「只有一处光源」「不看镜头」'
    assert '【这一套每一张的主角' not in p0, '主角那一格空着＝不凭空多一句'
    two = st(r"""(() => {
        const cp = JSON.parse(JSON.stringify(npS()));                 // 纸上推演：不弄脏台上那份
        const it = cp.shots.items.filter(x => !x.off)[0];
        const look = (born, casting) => {
            cp.shots.look = Object.assign({}, npLookShape((npS().shots || {}).look),
                casting ? {casting: casting} : {}, born ? {born: born} : {});
            return npShotPromptText(cp, it, 0, 1);
        };
        return {
            cast: look('', '40 岁男瓦工，短寸头，深蓝工装外套袖口磨白，腰间一把铲刀'),
            il: look('扁平矢量插画', ''),
            old: look('实拍照片', ''),
        };
    })()""")
    assert '【这一套每一张的主角，必须同一个人、同一身】' in two['cast'] and '腰间一把铲刀' in two['cast'], \
        '填了主角＝逐张带上那一句（六张换六个人是 AI 味第一大来源）：%s' % two['cast'][-500:]
    assert '【这一套每一张的主角' not in two['il'], '没填就不出现，也不留一个空标题'
    assert '【手机随拍必须照做' not in two['il'], '换到插画那一挂＝随拍那七条整块撤掉（不然引擎被要求拍出噪点）：%s' % two['il'][-500:]
    assert '【手机随拍必须照做' not in two['old'], '老档那一挂（实拍照片）不套随拍块，提示词不凭空撑长'
    assert two['il'].count('一次只出这一张完整画面') == 1 and two['cast'].count('一次只出这一张完整画面') == 1, '护栏一句一张，不重复堆'
    assert '不许有亮边和细碎纹理' in p0, '字位那一格补一句：花纹会把白字吃掉'
    assert (ai('cut'), ai('desc')) == (0, 0), '这一节全是本地读／本地拼：零 AI'
    print('PASS: 七十一改（手机随拍七条硬约束＋一次只出一张护栏＋主角一句；换插画／老档实拍那一挂不带；字位补「不许有亮边」）', flush=True)

    # ── 3b) 配文那几格就在这一行：填与不填都本地重拼，一次 AI 都不烧，人写过就挂 🔒 字 ──
    assert page.locator('.np-cap').count() == 12, '要出图的每一行摆四档 chips：%s' % page.locator('.np-cap').count()
    f0 = page.locator('.np-shot').first.locator('.np-cap-in').evaluate_all('els => els.map(x => x.getAttribute("data-f"))')
    assert f0 == ['lines', 'note', 'em:hot', 'em:bold', 'em:tag'], '「说一次」这一档展开这五格：%s' % f0
    z0 = page.locator('.np-shot').first.locator('.np-cap-zone')
    assert z0.count() == 9, '字位九宫格就摆在这一行的配文栏里（它是旋钮、不算写过字）：%s' % z0.count()
    ph = page.locator('.np-cap-in[data-f="lines"]').first.get_attribute('placeholder') or ''
    assert '一行一行填' in ph, '承接那一格空着时的提示：%s' % ph
    page.locator('.np-cap-in[data-f="lines"]').first.fill('手改的承接句')
    page.wait_for_function('() => (npS().shots.items[0].cap.lines || [])[0] === "手改的承接句" && npS().shots.items[0].clock === true')
    assert '共 2 行' in pout(0), '要压的行数当场从 1 变 2（字后压：只报行数、字不进提示词）：%s' % pout(0)[:400]
    assert '手改的承接句' not in pout(0), '人写的字也不进提示词（字全是本地压的）'
    assert '共 2 行' not in pout(1), '只改这一行，别的那两张不许跟着变'
    page.locator('.np-shot').first.locator('.np-cap-zone[data-v="tr"]').click()
    page.wait_for_function('() => npS().shots.items[0].cap.zone === "tr"')
    assert '字位＝右上' in pout(0) and '字位＝左下' not in pout(0), '拨字位＝这一张的留白那格当场换：%s' % pout(0)[:400]
    assert page.locator('.np-shot-clock').count() == 1, '人写过字的那一格当场挂 🔒 字（字位那颗是旋钮，拨它不挂）'
    assert (ai('cut'), ai('desc')) == (0, 0), '改配文那几格只是本地重拼'
    print('PASS: 配文那几格在每一行里（填一句承接＝行数当场 1→2；字位九宫格拨到右上＝留白那格当场换），零 AI·挂上 🔒 字', flush=True)

    # ── 4) 配文方式换档：整套默认档在 ① 拨，某一张要换在这一行拨，每一份当场重排（换档不留残字）──
    goto_tab('look')
    page.locator('#npLookBox .np-capd[data-k="whole"]').click()
    page.wait_for_function('() => npCapOf(npLookOf(npS())) === "whole"')
    assert (st('(npS().visual || {}).images') or '').count('字位＝正中') == 2, '整套跟着这一档重排（人拨过字位的那一张不动）'
    goto_tab('desc')
    fw = page.locator('.np-shot').first.locator('.np-cap-in').evaluate_all('els => els.map(x => x.getAttribute("data-f"))')
    assert fw == ['em:hot', 'em:bold', 'em:tag'], '「整段上屏」只展开重点那三格（承接／小注用不上就不摆）：%s' % fw
    assert '字位＝右上' in pout(0), '人拨过的字位不跟着整套档走：%s' % pout(0)[:400]
    assert '字位＝正中' in pout(1) and '字位＝正中' in pout(2), '没动过的那两张跟整套默认档：%s' % pout(1)[:400]
    assert '【底图，这一套每张共用，必须照做】' in pout(2), '换档只换字那块的留白，底图那条不动'
    assert '手改的承接句' not in pout(0), '整段上屏这一档不摆承接（换档不留残字）'
    goto_tab('look')
    page.locator('#npLookBox .np-capd[data-k="say"]').click()
    page.wait_for_function('() => npCapOf(npLookOf(npS())) === "say"')
    goto_tab('desc')
    assert page.locator('.np-cap-in[data-f="lines"]').first.input_value() == '手改的承接句', '换回来不许把人填过的那格抹掉'
    assert '共 2 行' in pout(0) and '字位＝右上' in pout(0), pout(0)[:400]
    assert '字位＝左下' in pout(1), '没动过的那张回到这一档的默认字位（左下）'
    assert SENTS[0] not in pout(0), '说一次没把段原文塞进提示词（字全是本地压的）'
    # 某一张单独换档：在这一行上拨，只动这一行
    page.locator('.np-shot').nth(2).locator('.np-cap[data-k="only"]').click()
    page.wait_for_function('() => npS().shots.items[2].cap.mode === "only"')
    fo = page.locator('.np-shot').nth(2).locator('.np-cap-in').evaluate_all('els => els.map(x => x.getAttribute("data-f"))')
    assert fo == ['em:hot', 'em:bold', 'em:tag'], '「只一句大字」只展开重点那三格：%s' % fo
    assert '共 1 行' in pout(2) and '字位＝正中' in pout(2), '这一档只压那一句大字、字位正中：%s' % pout(2)[:400]
    assert '字位＝正中' not in pout(0) and '字位＝正中' not in pout(1), '一张换档别把整套带走'
    assert page.locator('.np-shot-clock').count() == 1, '换档不挂 🔒 字（档是人拨的旋钮，锁只管手写的字）'
    assert (ai('cut'), ai('desc')) == (0, 0), '换配文方式只是本地重排'
    print('PASS: 「配文方式」那一档一改，三条提示词当场重排（整套在 ① 拨·单张在行里拨·字位跟着档走，零 AI）', flush=True)

    # ── 5) 🔁 不再有「先挑一派」这道门：没自己挑过时照打底那一派；挑完这一行的流派，尾巴仍不带它 ──
    regen = page.locator('#npRegenBar .np-desc-regen')
    assert regen.count() == 1 and not regen.first.is_disabled(), '没自己挑过流派＝照打底那一派，🔁 该能点（不摆成灰的骗人）'
    assert XHS_MOTIF in page.locator('#npRegenBar').inner_text(), '表头那句要说清照的是打底那一派'
    assert XHS_MOTIF in tab_badge('look'), '① 那一档的标签＝打底那一派：%s' % tab_badge('look')
    goto_tab('look')
    page.locator('#npLookBox .np-motif[data-k="%s"]' % MOTIF).click()
    page.wait_for_function('() => npLookOf(npS()).motif === "%s"' % MOTIF)
    assert (ai('cut'), ai('desc')) == (0, 0), '挑流派本身不烧 AI'
    assert '方案页' in tab_badge('look'), '① 那一档的标签就是这一行的流派：%s' % tab_badge('look')
    goto_tab('desc')
    regen = page.locator('#npRegenBar .np-desc-regen')
    assert not regen.first.is_disabled()
    assert '· 3 屏' in regen.first.inner_text(), regen.first.inner_text()
    assert MOTIF not in pout(0), '流派只进 AI 那一发，不进提示词尾巴'
    print('PASS: 没挑过流派也照打底那一派出分镜（🔁 不摆灰的）；挑完尾巴里仍查不到流派名', flush=True)

    # ── 6) 🔁 一批 3 段（一发）；桩把这一发写成抄文案 → 界面零 AI 判红 ──
    regen.click()
    until('desc', 1, 'npS().shots.items.every(x => x.desc && !x.dlock)')
    assert ai('cut') == 0, '🔁 只重出分镜，不该再断一次句'
    sys0 = sw.evaluate('() => self.descSystems[0]')
    assert '你在改一条' in sys0 and '一个字都别改' in sys0 and '段已经切好了' in sys0
    assert '【本次画面流派】' + MOTIF in sys0, sys0[:400]
    assert '· 这段文案要变成这一派的什么料：' in sys0, '转译配方要喂给这一发'
    # 六十二改：那一发只写画面三块，图上那套字另按「配文方式」那一档给
    assert '『这一张要证明』' in sys0 and '『画面里必须出现的元素』' in sys0 and '『背景』' in sys0, sys0[:600]
    assert '『先说清楚' in sys0 and '字块留在哪儿不归你写' in sys0, '歧义那行可选·「版式」挪进配文档了'
    assert '按 1. 2. 3. 逐条列、至少三条' in sys0 and '这就是……的凭据' in sys0, '元素清单要逐条编号、至少一条自带凭据'
    assert '先想这段的结论靠什么一眼看得见' in sys0, '那一发开头要立住「图是来给这段的结论举证的」'
    assert '图上放哪句文案也不归你写' in sys0, '要说清文案不进分镜那一格（图上那套字归配文那一档）'
    assert '每段回 3 条候选' in sys0, '一条＝一种摆法，三段候选都在这发里'
    assert '每段还要按它那一份「配文方式」给一份「配文」' in sys0, '图上那套字回到这一发手里（按客户那一档）'
    assert '这一档＝「说一次」' in sys0, '整套默认那一档的写法要喂进去'
    assert '"配文":{"档"' in sys0, 'JSON 契约里带着配文那一份'
    assert '多给的凭据' not in sys0 and '『版式』' not in sys0 and '字量' not in sys0, '旧四小段与字量档该整块撤掉：%s' % sys0[:600]
    assert '这一张装得下多少字' not in sys0 and '图上文字' not in sys0
    usr0 = sw.evaluate('() => self.descUsers[0]')
    assert usr0.count('本段（要写的就是它）：') == 3
    assert usr0.count('配文方式：说一次（客户拨的档，不许改') == 2, '前两段跟整套默认那一档：%s' % usr0[:400]
    assert '配文方式：只一句大字（客户拨的档，不许改' in usr0, '第三段在 ④ 那一行单独换过档，就带它自己那一档'
    assert '别抄进分镜' in usr0, '整篇原文那一份要标成参考，不是让抄'
    assert '【整篇原文' in usr0 and '【画面尺寸】竖版 3:4' in usr0
    assert page.locator('.np-shot-shallow').count() == 3, '照抄段文本的分镜要当场判红'
    assert '3 屏还在抄文案' in table()
    assert SENTS[0] in pout(0), '分镜一写就进那条提示词'
    assert page.locator('.np-cap-in[data-f="lines"]').first.input_value() == '手改的承接句', '这一发没回配文＝不顶人写过字的那几格'
    assert page.locator('.np-shot-clock').count() == 1
    print('PASS: 🔁 一批 3 段只烧一发（三块写法＋配文档都带着）；那一发回来要是还在抄文案，零 AI 当场判出来（3 行都亮 ⚠️）', flush=True)

    # ── 7) 单段那颗 ⚠️：点一下＝只重出被点的那一段 ──
    sw.evaluate('self.descMode = "good"')
    others = [pout(i) for i in (0, 2)]
    page.locator('.np-shot').nth(1).locator('.np-shot-shallow').click()
    until('desc', 2, 'npS().shots.items[1].desc.indexOf("R2") === 0')
    assert (ai('cut'), ai('desc')) == (0, 2)
    usr1 = sw.evaluate('() => self.descUsers[1]')
    assert usr1.count('本段（要写的就是它）：') == 1, '单段那一发只带那一段'
    assert '前一段：' in usr1 and '后一段：' in usr1 and '这就是第一张' not in usr1
    assert st('npS().shots.items[0].desc === npS().shots.items[0].text'), '别的段一个字不许被顶掉'
    assert page.locator('.np-shot-shallow').count() == 2, '被点的那一行不再亮，其余两行还亮着'
    assert '2 屏还在抄文案' in table()
    assert [pout(0), pout(2)] == others
    print('PASS: ⚠️ 那颗点一下＝只照这一派重出这一段（一发，别的段没动，这一行不再亮）', flush=True)

    # ── 8) 手改分镜＝挂 🔒：只重拼提示词，不整页甩 ──
    ta = page.locator('.np-shot-desc').nth(2)
    ta.fill(HAND)
    page.wait_for_function('() => npS().shots.items[2].dlock === true')
    assert ta.input_value() == HAND, '改完字那一格还该是人打的那份（整页甩会把光标顶掉）'
    assert page.locator('.np-shot-desc').count() == 3
    assert page.locator('.np-shot-lock').count() == 1
    bar = page.locator('#npRegenBar').inner_text()
    assert '1 屏带 🔒 手改，这一发不碰' in bar, bar
    assert '· 2 屏' in page.locator('#npRegenBar .np-desc-regen').inner_text()
    assert '手改的这一格' in pout(2)
    assert (ai('cut'), ai('desc')) == (0, 2), '手改只是本地重拼'
    print('PASS: 分镜手改＝当场挂 🔒（提示词跟着重排、表头那颗改成「2 段」，表格没重画、AI 一枚没烧）', flush=True)

    # ── 9) 🔁 跳过带锁那一格；点掉锁后重新归它管 ──
    page.locator('#npRegenBar .np-desc-regen').click()
    until('desc', 3, 'npS().shots.items[0].desc.indexOf("R3") === 0')
    assert sw.evaluate('() => self.descUsers[2].split("本段（要写的就是它）：").length - 1') == 2
    assert st('npS().shots.items[2].desc === %s && npS().shots.items[2].dlock === true'
              % json.dumps(HAND, ensure_ascii=False)), '带锁那一格这一发不许碰'
    assert page.locator('.np-shot-shallow').count() == 0, '重出过的那几格不再算抄文案'
    assert '段还在抄文案' not in table()
    page.locator('.np-shot-lock').click()
    page.wait_for_function('() => npS().shots.items[2].dlock === false')
    assert page.locator('.np-shot-lock').count() == 0
    assert st('npS().shots.items[2].desc.indexOf("手改的这一格") === 0'), '放开锁不抹掉人写的那份字'
    assert ai('desc') == 3
    print('PASS: 🔁 带 🔒 的那格跳过（这一发只 2 段）；点掉锁＝重新交给它管、那份字还留着', flush=True)

    # ── 10) 图就在这一行最后一格传回来：素材库只存引用＋缩略图，⑤ 那条检查跟着重算缺 ──
    f1 = png(OUT / 'shot-1.png')
    with page.expect_file_chooser() as fc:
        page.locator('.np-shot').first.locator('.np-shot-up').click()
    fc.value.set_files(str(f1))
    poll(lambda: page.locator('.np-shot-unlink').count() == 1, '这张图挂不上')
    assert '⏳ 还没传图' not in page.locator('.np-shot').first.inner_text()
    assert page.locator('.np-shot img').count() == 1
    chk = check_line()
    assert '缺2张图（画面2、画面3）' in chk.replace(' ', ''), '⑤ 顶上那条检查要说清缺哪几张'
    assert '已传回 1 张' in chk
    assert '缺2张图' in tab_badge('desc') and '1/3有图' in tab_badge('preview'), tab_badge('preview')
    goto_tab('desc')
    assert st('npS().shots.items[0].imgs.length') == 1
    assets = poll(lambda: (lambda a: a if len(a) == 1 else None)(
        page.evaluate('async () => (await chrome.storage.local.get("np_assets")).np_assets || []')),
        '素材库没落进去')
    a0 = assets[0]
    assert a0['kind'] == 'local' and a0['name'] == 'shot-1.png', a0
    assert str(a0['shotOf']).startswith('shot-1#'), '挂在「这一档 + 那一段」上：%s' % a0['shotOf']
    assert str(a0['thumb']).startswith('data:image') and len(a0['thumb']) < 60000, \
        '只留缩略图（≤160px），原图不许搬进库里：%d 字' % len(a0['thumb'])
    assert a0['w'] == 200 and a0['h'] == 260, '原图尺寸记着，原图本身留在人自己手里'
    print('PASS: 图在这一行最后一格 ⬆ 传回来（素材库一条引用＋缩略图 %d 字；⑤ 那条检查从 3 张缺变「缺 2 张」）'
          % len(a0['thumb']), flush=True)

    # ── 11) ② 收轻后不再跟 ④ 同款（那一条路归 check_note_cover.py）；这一支只验关掉封面时复制那份也不带它 ──
    goto_tab('cover')
    cv_box = page.locator('#npCoverBox').inner_text()
    assert page.locator('#npCoverBox .np-shot').count() == 0, '② 不再摊一行五列（那套重装置随六十四改整台撤了）'
    assert page.locator('#npCoverBox .np-shot-desc, #npCoverBox .np-cap, #npCoverBox .np-cover-seed').count() == 0
    assert page.locator('#npCoverBox .np-cover-gen').count() == 1, '这一档只剩两栏 + 一颗 ✨ 让 AI 写这两样'
    assert '这一版不要封面' in cv_box, cv_box[:200]
    assert '这一版不出' in tab_badge('cover'), tab_badge('cover')
    assert st('npS().shots.cv.on') is False, '② 那份开关落在 cv.on'
    assert st('JSON.stringify(Object.keys(npS().shots.cv).sort())') == json.dumps(['cap', 'copy', 'cv', 'id', 'imgs', 'on', 'prompt', 'text'], separators=(',', ':'))
    assert (ai('cut'), ai('desc')) == (0, 3), '② 那一档摊开＋关掉＝零 AI'
    goto_tab('desc')
    assert '一次复制全部提示词（3 张）' in page.locator('.np-shots-copy-all').inner_text(), '不出封面＝那颗复制也不带封面'
    card3 = page.locator('.np-shot').nth(2)
    card3.locator('details:has(.np-shot-copy) > summary').click()   # 单张复制住在收起的「提示词」里，先摊开
    card3.locator('.np-shot-copy').click()
    one = poll(lambda: (lambda c: c if '第 3 张' in c else None)(page.evaluate('window.__clip')), '单张没复制上')
    assert one.startswith('配图 第 3 张（共 3 张，竖版 3:4') and '手改的这一格' in one, one[:160]
    page.evaluate('() => { window.__clip = ""; return true; }')
    page.locator('.np-shots-copy-all').click()
    allx = poll(lambda: (lambda c: c if c.count('张（共 3 张') == 3 else None)(page.evaluate('window.__clip')),
                '一次复制全部没给够 3 份')
    assert '封面提示词' not in allx and MOTIF not in allx, allx[:200]
    assert (ai('cut'), ai('desc')) == (0, 3), '复制全在本地'
    print('PASS: ② 收轻后与 ④ 再无瓜葛（不摊五列、🔁 从不占它一发）；不出封面时一次复制全部就 3 份，只给提示词不代出图', flush=True)

    # ── 12) ⬜ 让一屏不占图：编号与缺口当场重排（那颗旋钮在 ③ 的屏头上） ──
    goto_tab('cut')
    page.locator('#npCutWrap .np-cutseg').first.locator('.np-shot-key').click()
    page.wait_for_function('() => npS().shots.items[0].off === true')
    goto_tab('desc')
    assert page.locator('.np-shot-pout').count() == 2
    assert '第 1 张（共 2 张' in pout(0), '撤掉一段，后面那段要顶上 1 号'
    assert '这一屏不占图（过场话）' in page.locator('.np-shot').first.inner_text()
    assert '（2 张）' in page.locator('.np-shots-copy-all').inner_text()
    assert '缺2张图（画面1、画面2）' in check_line().replace(' ', ''), '撤掉那张有图的段：缺口要跟着重排'
    goto_tab('cut')
    page.locator('#npCutWrap .np-cutseg').first.locator('.np-shot-key').click()
    page.wait_for_function('() => npS().shots.items[0].off === false')
    goto_tab('desc')
    assert page.locator('.np-shot-pout').count() == 3 and '共 3 张' in pout(0)
    assert (ai('cut'), ai('desc')) == (0, 3)
    print('PASS: ⬜ 不占图只是把那一段撤出名单（编号／复制份数／⑤ 那条检查全跟着重排，零 AI）', flush=True)

    # ── 13) 这张表跟这一行走：落档 → 从档案再进来读得回，一次 AI 都不重烧 ──
    live = st('JSON.parse(JSON.stringify(npS().shots))')   # 切走之后 npS() 就空了，先抄下台上这一份
    page.evaluate('() => switchMainTab("noteArchive")')
    row = poll(lambda: (lambda e: e if e and ((e.get('imgDocs') or [{}])[0].get('shots') or {}).get('items') else None)(note()),
               '画面表没落进档案')['imgDocs'][0]
    saved = row['shots']
    assert saved['look']['motif'] == MOTIF and saved['look'].get('cap') == 'say', saved['look']
    assert saved['style'] == XHS_TOKEN, '那一行令牌是两轴派生物（两轴没自己拨过＝打底那行），不是 AI 编的：%s' % saved['style']
    assert len(saved['sents']) == 3 and len(saved['items']) == 3
    assert all((i.get('sids') or []) for i in saved['items']), '段绑着句子，回来才拼得出段文本'
    assert [i['desc'] for i in saved['items']] == [x['desc'] for x in live['items']], '分镜一字不差落档'
    assert saved['items'][0]['cap'].get('lines') == ['手改的承接句'] and saved['items'][0]['cap'].get('zone') == 'tr', \
        '人填的承接句与人拨的字位都跟着落档：%s' % saved['items'][0]['cap']
    assert saved['items'][2]['cap'].get('mode') == 'only', '那一张单独换过的档跟着这一行落档'
    assert len(saved['items'][0]['imgs']) == 1, '传回来的那张挂在段上一起落档'
    assert saved['items'][2]['dlock'] is False, '点掉锁这件事也跟着落档'
    assert saved['cv']['on'] is False, '② 那颗开关跟着这一行落档：%s' % saved['cv']
    assert sorted(saved['cv'].keys()) == ['cap', 'copy', 'imgs', 'on', 'prompt'], '落档的封面就这五样（重装置那份已整块撤掉）：%s' % saved['cv']
    assert not row['visual'].get('cover') and '第 1 张' in row['visual']['images'], '不出封面＝visual.cover 空着，配图照拼'
    assert (note().get('shots') or {}).get('items'), '档案条目级那一份也在（缺口列与教程读它）'
    base = (ai('cut'), ai('desc'))
    goto_out()
    assert cur_tab() == 'preview', '分镜与封面都定了画面、图还缺＝落在 ⑤ 预览（走到哪儿停在哪儿）：%s' % cur_tab()
    chk = page.locator('#npPreviewBox').inner_text()
    assert '检查这一套' in chk and '缺 2 张图' in chk and '封面那一份还没写' not in chk, chk[:180]
    page.locator('#npPreviewBox .np-check-go[data-t="desc"]').first.click()
    page.wait_for_timeout(400)
    assert cur_tab() == 'desc', '点「跳到第一个缺图的段」＝切到 ④ 那一档：%s' % cur_tab()
    page.wait_for_function('() => document.querySelectorAll(".np-shot").length === 3')
    assert (ai('cut'), ai('desc')) == base, '从档案再进来不重烧断句／重出那一发'
    assert st('npS().shots.items.map(x => x.desc)') == [x['desc'] for x in live['items']], '分镜读得回'
    assert '共 2 行' in pout(0) and '字位＝右上' in pout(0), '人填的承接句与人拨的字位回来还接着拼进提示词'
    assert page.locator('.np-shot-unlink').count() == 1 and page.locator('.np-shot img').count() == 1
    assert page.locator('.np-shot-lock').count() == 0
    print('PASS: 整张表落进这一行（3 段 + 流派 + 封面 + 挂着的图 + 锁已放开），再进来零 AI 读得回', flush=True)

    # ── 14) ✕ 摘掉这张图：重新催这一张，素材库那条不该跟着没 ──
    page.locator('.np-shot-unlink').first.click()
    page.wait_for_function('() => document.querySelectorAll(".np-shot .np-shot-unlink").length === 0')
    assert '⏳ 还没传图' in page.locator('.np-shot').first.inner_text()
    assert '缺3张图（画面1、画面2、画面3）' in check_line().replace(' ', '')
    assert '0/3有图' in tab_badge('preview'), tab_badge('preview')
    assert len(page.evaluate('async () => (await chrome.storage.local.get("np_assets")).np_assets || []')) == 1, \
        '从这一段摘掉≠从素材库删掉'
    assert (ai('cut'), ai('desc')) == base

    assert other() == [], '烧到了不该烧的那一发：%s' % other()[:2]
    assert not ERRORS, '有 pageerror：%s' % ERRORS[:2]
    page.screenshot(path=str(OUT / 'xhs-note-shots.png'))
    print('PASS: 无 pageerror · 全程只烧了该烧的三发（断句 0 / 重出分镜 3）', flush=True)
    print('SHOT: %s' % (OUT / 'xhs-note-shots.png'), flush=True)


if __name__ == '__main__':
    main()

print('\n全绿：造图片 ④ 那一档（分镜 → 每行提示词 → 每行传图 → ⑤ 检查 · 五档口径）', flush=True)
