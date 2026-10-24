# -*- coding: utf-8 -*-
"""造图片「② 🖼 封面 · 首图那一张」那一档自检（六十三改立的那一档；六十四改② 收轻——
老板：「封面不要这里就不需要这样搞了。就是用AI来写个文案和图片提示词就好了。」）。

口径（五档：① 🎨 风格 → ② 🖼 封面 → ③ 🎯 断句 → ④ 🖋 分镜 → ⑤ 👀 预览 · 图文对照）：
  1) ② 只剩两栏：封面那一句文案（≤40 字，图上那句大字）＋ 那一张的图片提示词（一份能直接粘去生图的整话），
     外加一颗 ✨「让 AI 写这两样」——一发回 {"文案","重点","提示词"} 三样（重点＝那句话里哪几个字怎么标，六十五改字后压）；
     六十三改那份重装置（分镜三块／三条候选／挑条／🔒 手改锁／配文那几格／本地拼提示词）整台撤掉，不再跟 ④ 每一行同款；
  2) 它是道关卡：封面那一份还没写（prompt 空）→ 打开这一行就停在 ②，⑤ 那条检查也催「封面那一份还没写」；
     写了、或点「不出封面」才放行；开关只收摊子——写过的两句不丢，零 AI；
  3) ✨ 那份画面回来时本地补一次共用尾巴（尺寸口径／令牌固定元素／配色层级／通则／合规），补完落进那一栏；
     之后那一栏里是什么就是什么，没有任何装置再顶它（🔁 重出分镜也不碰它，各写各的）；
  4) 那句文案（copy）是真源：写了就以它为准；没写才顶派生读数 cv.text（跟第 1 屏那句／标题），⬜ 撤屏它跟着挪；
  5) 封面不占屏号，也不占 🔁 那一发；整张表那些屏照旧 3 段就是 3 段；
  6) 生好的那张照 ④ 一样在这一档 ⬆ 传回来（素材库只存引用＋缩略图，挂 id＝cv）；
  7) 落档只留 {on, copy, prompt, cap, imgs}（cap＝字后压那两格：字位 zone ＋ 重点 em）；老档那份重装置的 cv.desc 自动落进提示词这一栏，
     cands／pick／dlock 不再读、进来即消失，零 AI。

跑法：python3 -X utf8 scripts/dev/check_note_cover.py
临时 profile 加载真扩展（msedge headful），全程 AI 走桩、不烧真接口。
"""
import pathlib
import re
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

LINES = ['开场钩子一句。', '这个卖点这一句。', '紧跟它补充一句。', '第二个卖点那句。', '收尾引导一句。']
BODY = '\n\n'.join(LINES)
SEG1 = ''.join(LINES[0:2])      # 第 1 屏那份原文（点 ★ 立屏时收两行）
SEG2 = ''.join(LINES[2:4])
SEG3 = LINES[4]

MOTIF_A = '方案页'              # ① 那一档挑的那一派：只进 AI 那一发，不许漏进提示词尾巴
XHS_TOKEN = '手机随拍；暗调实拍·单一暖光源'   # 七十一改：令牌两轴＝画面形式＋主题（打底换成手机随拍；layout 轴退市、印记不进令牌）
COPY_1 = '省下的时间够跑三个客户'
COPY_2 = '跑了两周，腰围先骗了我一次'
COVER_BODY_1 = '这一张一眼要留住人：左手把一叠打印纸按在桌上，纸角写着日期；桌角只留最上面那张，台灯单光源把字压暗角一侧'
COVER_BODY_2 = '第二版：同一张桌子换成俯拍，三张便签推成一列，最上面那张写着当天日期；台灯单光源，字压在左边暗角'
# 🔁 那一发的分镜（举证三块，不是把段原文美化一遍 → 不该亮「还是在抄文案」）
DESC_OK = ('这一张要证明：把重复步骤压掉这件事一眼看得见；'
           '画面里必须出现的元素：1. 桌面俯拍，一叠打印纸边角写着日期（这就是改到半夜的凭据）；'
           '2. 三张便签推成三列；背景：晚上家里书桌，台灯单光源。')
LEGACY_DESC = ('这一张要证明：老档那份三块画面说明；画面里必须出现的元素：1. 桌角一叠纸只留最上面那张'
               '（这就是当年那份凭据）；背景：白天窗光，浅景深。')

NOTES = "async () => (await chrome.storage.local.get('np_notes')).np_notes || []"

CV = r'''() => {
  const w = npS() || {};
  const cv = (w.shots || {}).cv || {};
  return {
    keys: Object.keys(cv).sort(),
    on: !!cv.on, copy: String(cv.copy || ''), prompt: String(cv.prompt || ''),
    text: String(cv.text || ''), imgs: (cv.imgs || []).slice(),
    cap: JSON.parse(JSON.stringify(cv.cap || {})),
    derived: npCoverText(w),
    visualCover: String((w.visual || {}).cover || ''),
    land: npImgLand(JSON.parse(JSON.stringify(w))),
  };
}'''

SEED = r'''async (payload) => {
    await Storage.initializeDefaults(DEFAULT_PROMPTS);
    await ensureTenantInit();
    const cfg = await Storage.getConfig();
    cfg.product.name = '封面节点测试产品';
    cfg.product.sellPoints = [{title: '省时间', content: '把重复步骤压掉'}];
    cfg.ai.apiKey = 'test-local-only';
    await Storage.setConfig(cfg);
    const legacyShots = {
      style: '', items: [{id: 'o1', text: payload.legacyText, desc: '旧档第一段'}],
      cv: {id: 'cv', cv: true, on: true, text: '', copy: '', desc: payload.legacyDesc,
           cands: ['候选一那份画面', '候选二那份画面'], pick: 1,
           cap: {mode: 'only', big: payload.legacyBig}, dlock: true, clock: true, imgs: []},
    };
    await chrome.storage.local.set({
        np_notes: [
            {id: 'cover-1', title: '省时间三步', status: '待发', platform: 'xhs', form: '图文',
             draft: payload.body, createdAt: Date.now()},
            {id: 'cover-old', title: '老档那篇', status: '待发', platform: 'xhs', form: '图文',
             draft: payload.body, createdAt: Date.now() - 1000,
             imgDocs: [{id: 'g-old', pid: 'xhs', style: '清单卡片式', updatedAt: 1, shots: legacyShots}],
             shots: legacyShots},
        ],
        np_assets: [],
    });
    self.ai = {cover: 0, desc: 0};
    self.coverSystems = [];
    self.coverUsers = [];
    self.other = [];
    // 这一支只管 ② 那一档：✨ 回两样、🔁 只动配图那几屏，别的通路一律不许碰
    AiClient.chatCompletion = async (cfg2, system, user) => {
        const sys = String(system || ''), us = String(user || '');
        if (sys.indexOf('你在给一条') >= 0) {
            self.ai.cover++;
            self.coverSystems.push(sys);
            self.coverUsers.push(us);
            const body = self.ai.cover === 1 ? payload.coverBody1 : payload.coverBody2;
            const copy = self.ai.cover === 1 ? payload.copy1 : payload.copy2;
            const em = self.ai.cover === 1 ? [{'字': '省下的时间', '标': '变色'}] : [{'字': '跑了两周', '标': '加粗'}];
            return {content: JSON.stringify({'文案': copy, '重点': em, '提示词': body})};
        }
        if (sys.indexOf('你在改一条') >= 0) {
            self.ai.desc++;
            const texts = (us.match(/^本段（要写的就是它）：(.+)$/gm) || []).map(s => s.slice('本段（要写的就是它）：'.length));
            return {content: JSON.stringify({'风格': '', '画面': texts.map(t => ({'句': t, '候选': ['R' + self.ai.desc + '｜' + payload.descOk]}))})};
        }
        if (sys.indexOf('你在帮一条') >= 0) { return {content: '{"提名句":[]}'}; }
        self.other.push(sys.slice(0, 24));
        return {content: '{"__stub":"不该烧的这一发"}'};
    };
    return true;
}'''


def png(path, w=200, h=260, rgb=(120, 90, 200)):
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
        prof = OUT / ('cover-profile%d' % i)
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


def nb(s):
    return re.sub(r'\s+', '', str(s or ''))


def run(ctx):
    sw = ctx.service_workers[0]
    assert sw.evaluate('chrome.runtime.onMessage.hasListeners()'), '后台路由没注册上'
    sw.evaluate(SEED, {'body': BODY, 'descOk': DESC_OK, 'copy1': COPY_1, 'copy2': COPY_2,
                       'coverBody1': COVER_BODY_1, 'coverBody2': COVER_BODY_2,
                       'legacyDesc': LEGACY_DESC, 'legacyBig': '旧那句大字', 'legacyText': '第一段那份'})

    page = ctx.new_page()
    page.on('pageerror', lambda e: ERRORS.append(str(e)[:220]))
    page.set_viewport_size({'width': 1280, 'height': 1100})
    goto_big(page, sw.url.replace('background.js', 'popup.html?mode=big'))
    page.wait_for_function('typeof switchMainTab === "function" && typeof npCoverPaneHtml === "function"')
    page.set_default_timeout(25000)

    def cv():
        return page.evaluate(CV)

    def ai(k):
        return sw.evaluate('() => self.ai.%s' % k)

    def other():
        return sw.evaluate('() => self.other')

    def st(expr):
        return page.evaluate('() => (%s)' % expr)

    def poll(fn, msg, timeout=20.0):
        t0 = time.time()
        while time.time() - t0 < timeout:
            v = fn()
            if v:
                return v
            page.wait_for_timeout(250)
        raise AssertionError('等不到：%s' % msg)

    def until(least, expr, msg=''):
        t0 = time.time()
        while time.time() - t0 < 22:
            try:
                if sw.evaluate('() => self.ai.desc >= %s' % least) and page.evaluate('() => (%s)' % expr):
                    return
            except Exception:
                pass
            page.wait_for_timeout(250)
        raise AssertionError('等不到 desc>=%s / %s%s' % (least, expr, msg))

    def tab_on(t):
        return page.locator('#npImgTabs .np-imgtab[data-t="%s"]' % t)

    def goto_tab(t):
        tab_on(t).click()
        page.wait_for_timeout(260)

    def tab_badge(t):
        return nb(tab_on(t).inner_text())

    def cur_tab():
        return st('npTabOf(npS())')

    def box():
        return nb(page.locator('#npCoverBox').inner_text())

    def copy_inp():
        return page.locator('#npCoverBox .np-cover-copy')

    def prompt_ta():
        return page.locator('#npCoverBox .np-cover-prompt')

    def check_line():
        goto_tab('preview')
        return nb(page.locator('#npPreviewBox').inner_text())

    def circle(a, b):
        # ③ 立屏的现行交互（六十五改）：行号列按住第 a 行拖到第 b 行＝这几句是一屏；单击一行＝它自己一屏
        g0 = page.locator('#npCutWrap .np-cutline').nth(a).locator('.np-cut-gut')
        g0.scroll_into_view_if_needed()
        bx = g0.bounding_box()
        x0, y0 = bx['x'] + bx['width'] - 8, bx['y'] + bx['height'] / 2
        page.mouse.move(x0, y0)
        page.mouse.down()
        g1 = page.locator('#npCutWrap .np-cutline').nth(b).locator('.np-cut-gut')
        b1 = g1.bounding_box()
        x1, y1 = b1['x'] + b1['width'] - 8, b1['y'] + b1['height'] / 2
        if (x1, y1) != (x0, y0):
            page.mouse.move(x1, y1, steps=8)
        page.mouse.up()
        page.wait_for_timeout(280)

    def goto_out(note_id, add_row=False, tab=None):
        """直开这一篇的「🖼 出图」（档案那一行「下一步」走的同一条路；七十改：渲染任务表已撤）；
        加行＝④ 分镜 空态那颗「＋ 起一套图」＋ ① 挑流派，加完再进一次这一页（npImgLand 照旧算落档，保住下面 cur_tab() 那批断言）"""
        def enter():
            page.evaluate('async () => { const l = await npNotesAll(); switchMainTab("noteOut", l.find(x => x && x.id === "%s")); }' % note_id)
            page.wait_for_function('() => _npMode === "out" && !!document.querySelector("#npImgTabs .np-imgtab")')
        enter()
        if add_row:
            goto_tab('desc')
            page.wait_for_function('() => !!document.querySelector("#npShotTable .np-img-add")')
            page.locator('#npShotTable .np-img-add').click()
            page.wait_for_function('() => (npS().imgDocs || []).length === 1 && !!npS().imgOpen')
            goto_tab('look')
            page.locator('#npLookBox .np-motif[data-k="%s"]' % MOTIF_A).click()
            page.wait_for_function('(m) => String(((npS().shots || {}).look || {}).motif || "") === m', arg=MOTIF_A)
            enter()
        if tab:
            goto_tab(tab)

    # ── 1) 五档键序：② 紧跟 ①，③ 是「🎯 断句」（★ 挪进 ④ 后退回原名）；冷启动停在 ②（封面还没写就是关卡）──
    goto_out('cover-1', add_row=True)
    keys = page.evaluate('() => Array.from(document.querySelectorAll("#npImgTabs .np-imgtab")).map(b => b.getAttribute("data-t"))')
    assert keys == ['look', 'cover', 'cut', 'desc', 'preview'], '五档按工作流排：%s' % keys
    assert '①' in tab_badge('look') and '风格' in tab_badge('look'), tab_badge('look')
    assert '②' in tab_badge('cover') and '封面' in tab_badge('cover'), tab_badge('cover')
    assert '③' in tab_badge('cut') and '断句' in tab_badge('cut'), '③＝「🎯 断句」（六十五改 ★ 挪进 ④ 后退回）：%s' % tab_badge('cut')
    assert '④' in tab_badge('desc') and '分镜' in tab_badge('desc'), tab_badge('desc')
    assert '⑤' in tab_badge('preview') and '预览' in tab_badge('preview'), tab_badge('preview')
    assert cur_tab() == 'cover', '新加的一行（封面那一份还没写）打开就停在 ②：%s' % cur_tab()
    assert page.locator('#npCoverBox').count() == 1, '② 那一档摊开的是封面那一张'
    assert page.locator('#npShotTable').count() == 0 and page.locator('#npLookBox').count() == 0, \
        '一档一块：站在 ② 不该同时摊出 ① 的面板或 ④ 那张表'
    assert '还没写' in tab_badge('cover'), tab_badge('cover')
    assert ai('cover') == 0 and ai('desc') == 0, '进 ② 一次 AI 都不烧'
    print('PASS: 造图片五档＝① 风格 → ② 封面 → ③ 断句 → ④ 分镜 → ⑤ 预览；封面单独一档、是道关卡（冷启动停它，零 AI）', flush=True)

    # ── 2) ② 摊开就两栏＋一颗 ✨：六十三改那份重装置（分镜三块／候选／锁／配文）整台撤掉 ──
    b = box()
    assert page.locator('#npCoverBox .np-cover-copy').count() == 1, '第一栏＝封面那一句文案'
    assert copy_inp().evaluate('e => e.tagName') == 'INPUT' and copy_inp().get_attribute('maxlength') == '40', '那一句一行、≤40 字'
    assert page.locator('#npCoverBox .np-cover-prompt').count() == 1, '第二栏＝那一张的图片提示词'
    assert prompt_ta().evaluate('e => e.tagName') == 'TEXTAREA', '提示词是一份整话'
    assert page.locator('#npCoverBox .np-cover-gen').count() == 1, '一颗 ✨ 让 AI 一次写这两样'
    assert '让AI写这两样' in nb(page.locator('#npCoverBox .np-cover-gen').inner_text())
    assert page.locator('#npCoverBox .np-cover-copy-prompt').count() == 1, '📋 复制这一份就在提示词那一栏下面'
    assert page.locator('#npCoverBox .np-shot-up[data-id="cv"]').count() == 1, '生好的那张在这一档 ⬆ 传回来（挂 id＝cv）'
    assert '封面·首图那一张' in b, b[:160]
    assert '封面那一句文案' in b and '封面图片提示词' in b, b[:300]
    # 重装置撤干净了
    assert page.locator('#npCoverBox .np-shot').count() == 0, '② 不再跟 ④ 同款摊那一行六列'
    assert page.locator('#npCoverBox .np-shot-desc').count() == 0, '分镜三块那一格没了'
    assert page.locator('#npCoverBox .np-cap').count() == 0 and page.locator('#npCoverBox .np-cap-in').count() == 0, '配文方式那几格没了'
    assert page.locator('#npCoverBox .np-shot-lock').count() == 0 and page.locator('#npCoverBox .np-shot-clock').count() == 0, '🔒 手改／🔒 字两颗锁没了'
    assert page.locator('#npCoverBox .np-cover-seed').count() == 0, '零 AI 起手那颗 🔧 没了（那句／画面各写各的，没得抄）'
    assert page.locator('#npCoverBox .np-desc-cand, #npCoverBox .np-shot-cand').count() == 0, '三条候选没了'
    assert page.locator('#npVisualCover, .np-cover-fill').count() == 0, '旧的封面提示词格／填装按钮随重装置下线'
    assert '还没写：现在先顶一句「省时间三步' in b, 'copy 空着先顶一句派生读数（没屏就顶标题）：%s' % b[:260]
    assert '整篇一共1张（封面1张＋配图0张）' in b, '张数账：封面不占屏号、另算一张：%s' % b[-200:]
    tip = page.locator('#npCoverBox .qhelp').first.get_attribute('data-tip') or ''
    assert '封面不占屏号' in tip and '直接粘去生图' in tip, '问号气泡要说清这两栏与不占屏号：%s' % tip[:160]
    assert cv()['keys'] == ['cap', 'copy', 'cv', 'id', 'imgs', 'on', 'prompt', 'text'], 'cv 只剩这些字段（cap＝字后压那两格 zone/em）：%s' % cv()['keys']
    assert cv()['derived'] == '省时间三步', '没屏时那句顶标题：%s' % cv()['derived']
    print('PASS: ② 摊开就两栏（那一句文案＋那一张的提示词）＋一颗 ✨ ＋ ⬆ 传图；分镜三块／候选／锁／配文那套重装置整台撤掉', flush=True)

    # ── 3) 关卡与「不出封面」往返：落点、badge、⑤ 那两行账全跟着走，零 AI ──
    assert cv()['land'] == 'cover', '没写那份画面之前落点就是 ②'
    chk = check_line()
    assert '封面那一份还没写' in chk, '⑤ 那条检查催的是封面那份：%s' % chk[:260]
    assert '去②点「✨让AI写这两样」' in chk, '缺口那行要指到 ✨：%s' % chk[:300]
    assert '要出1张（封面1＋配图0）' in chk, chk[:300]
    goto_tab('cover')
    page.locator('#npCoverBox .np-cover-on[data-v="0"]').click()
    page.wait_for_function('() => npS().shots.cv.on === false')
    assert cv()['land'] == 'cut', '点了「不出封面」，落点才往 ③ 走（一屏都还没划）：%s' % cv()['land']
    assert '这一版不出' in tab_badge('cover'), tab_badge('cover')
    assert '这一版不要封面' in box(), '关掉后那一档要说清这一套从第 1 屏那张开始排'
    assert '封面那一份还没写' not in check_line(), '不出封面就不该再催它'
    goto_tab('cover')
    assert '要出0张' in check_line(), '不出封面时张数账跟着收成 0：%s' % check_line()[:200]
    goto_tab('cover')
    page.locator('#npCoverBox .np-cover-on[data-v="1"]').click()
    page.wait_for_function('() => npS().shots.cv.on === true')
    assert cv()['land'] == 'cover', '重新要这一张＝又变回关卡'
    assert (ai('cover'), ai('desc')) == (0, 0), '开关往返零 AI'
    print('PASS: 封面是道关卡不是摆设：没写那份画面＝落 ② 且 ⑤ 催它；「不出封面」落点／badge／张数账一起放行（往返零 AI）', flush=True)

    # ── 4) ✨ 一发 AI 回三样：{"文案","重点","提示词"}；本地只补一次共用尾巴 ──
    page.locator('#npCoverBox .np-cover-gen').click()
    poll(lambda: cv()['prompt'], '✨ 没回提示词')
    c = cv()
    assert (ai('cover'), ai('desc')) == (1, 0), '✨＝一发 AI，别的不碰'
    assert other() == [], '烧了不该烧的那一发：%s' % other()[:2]
    sysmsg = sw.evaluate('() => self.coverSystems[0]')
    assert '只出两样东西' in sysmsg and '{"文案":"...","提示词":"..."}' in sysmsg, sysmsg[:300]
    assert '≤14 字' in sysmsg and '纯文字' in sysmsg, '文案那一段硬性要求：%s' % sysmsg[:300]
    assert '要把『文案』那几个字画进图上' in sysmsg and '封面那一张也必须有字' in sysmsg, '封面必须带字（老板 2026-10-20）：%s' % sysmsg[:400]
    assert '【这一套图的取材路子】' in sysmsg and '画面做成一页方案' in sysmsg, '流派喂给这一发（方案页的 take 指纹）：%s' % sysmsg[:400]
    u1 = sw.evaluate('() => self.coverUsers[0]')
    assert '【整篇文案' in u1 and LINES[0] in u1, '那一发读的是整篇文案：%s' % u1[:200]
    assert '第 1 张配图说的那一段' not in u1, '一屏都还没划，就别硬塞第 1 张那段：%s' % u1[:200]
    assert c['copy'] == COPY_1, '文案那栏落的是 AI 那句：%s' % c['copy']
    assert c['cap'] == {'zone': 'bc', 'em': [{'w': '省下的时间', 'k': 'hot'}]}, \
        '重点那几处按 copy 认过子串才落进 cv.cap.em（变色→hot；字位没报就留默认那格）：%s' % c['cap']
    assert copy_inp().input_value() == COPY_1, '那一栏里摆的就是它（可以直接改）'
    assert c['prompt'].startswith('封面／首图那一张（竖版 3:4'), c['prompt'][:80]
    assert COVER_BODY_1 in c['prompt'], 'AI 那份画面原样在栏里：%s' % c['prompt'][:200]
    assert '每一张都带的固定元素：' + XHS_TOKEN in c['prompt'], '尾巴补令牌那行固定元素（七十一改后＝画面形式＋主题两轴）'
    assert '【底图，这一套每张共用，必须照做】' in c['prompt'] and '【通则】' in c['prompt'], '底图与通则共用同一份常量'
    assert '不出现二维码 / 联系方式' in c['prompt'], '合规尾巴'
    assert c['prompt'].count('【底图，这一套每张共用，必须照做】') == 1, '尾巴只补一次（不是每次重拼都加一层）'
    assert MOTIF_A not in c['prompt'] and '真人工作场景' not in c['prompt'], '流派名只进 AI 那一发，不进提示词尾巴'
    assert c['visualCover'] == c['prompt'], 'w.visual.cover ≡ cv.prompt（缺口列／教程／复制读同一份）'
    assert '这一句就是封面上屏的那句话' in box(), '写了 copy 就不再报「先顶一句」'
    assert '缺图' in tab_badge('cover'), tab_badge('cover')
    chk = check_line()
    assert '封面那一份还没写' not in chk and '缺封面那一张图' in chk, '画面有了、图还没传＝改催传图：%s' % chk[:300]
    goto_tab('cover')
    assert '提示词有了，图还没传' in box(), '那一栏下面自己也要催一句'
    print('PASS: ✨ 一发回「文案＋重点＋提示词」三样（重点按子串认进 cv.cap.em；提示词只补一次共用尾巴：尺寸／令牌固定元素／底图／通则／合规，不带流派名）', flush=True)

    # ── 4b) 印记那层（#23 补的）：look 带了印记／分类，提示词尾要把「本地盖什么、你不许画」说清 ──
    md = page.evaluate('''() => {
        const mk = (over) => Object.assign({born: '手机随拍', theme: '暗调实拍·单一暖光源'}, over);
        return {
            text_k: npMarkDesc(mk({mark: 'text', markText: '试验印记'}), 'k'),
            text_d: npMarkDesc(mk({mark: 'text', markText: '试验印记'}), 'd'),
            cls_k: npMarkDesc(mk({mark: 'text', markText: '试验印记', classify: true}), 'k'),
            none_k: npMarkDesc(mk({mark: 'none'}), 'k'),
            upload_d: npMarkDesc(mk({mark: 'upload', markImg: 'data:image/png;base64,xx'}), 'd'),
        };
    }''')
    assert '试验印记' in md['text_k'] and '右下角盖' in md['text_k'], md['text_k']
    assert md['text_d'] == md['text_k'], '印记层跟 dir（知识/案例/引流）无关，只有分类小标看 dir：%s' % md
    assert '知识' in md['cls_k'] and '试验印记' in md['cls_k'], '分类开关开了＝小标也报给 AI：%s' % md['cls_k']
    assert md['none_k'] == '', '印记选 none＝一个都盖不出，这半句整句不出现：%r' % md['none_k']
    assert '自己的印记图' in md['upload_d'] and '右下角' in md['upload_d'], md['upload_d']
    comp = page.evaluate('''() => {
        const cp = JSON.parse(JSON.stringify(npS()));      // 纸上推演：别弄脏台上那份
        cp.dir = 'k';
        cp.shots = Object.assign({}, cp.shots,
            {look: Object.assign({}, (cp.shots || {}).look, {mark: 'text', markText: '试验印记', classify: true})});
        const look = npLookOf(cp);
        return { comp: npCoverPromptCompose(cp, '一份测试画面'),
                 md: npMarkDesc(look, cp.dir), mark: String(look.mark || ''),
                 markText: String(look.markText || ''), classify: !!look.classify, dir: String(cp.dir || '') };
    }''')
    assert comp['md'] and '试验印记' in comp['md'], '合层后的 look 读得出印记：%s' % comp
    assert '印记也由扩展本地盖上去，你不许画：' in comp['comp'] and '试验印记' in comp['comp'] and '知识' in comp['comp'], \
        '封面提示词尾要把本地盖什么、不许画什么说清（#23）：mark=%s／md=%r／头=%s' % (comp['mark'], comp['md'], comp['comp'][:300])
    assert comp['comp'].count('印记也由扩展本地盖上去') == 1 and comp['comp'].count('试验印记') == 1, '这半句只出现一次'
    tok = page.evaluate('''() => {
        const base = {born: '手机随拍', theme: '暗调实拍·单一暖光源'};
        return { clean: npLookToken(base), noneM: npLookToken(Object.assign({}, base, {mark: 'none'})),
                 textM: npLookToken(Object.assign({}, base, {mark: 'text', markText: '试验印记'})) };
    }''')
    assert tok['clean'] == XHS_TOKEN, '没拨印记＝令牌就是出身＋主题：%s' % tok['clean']
    assert tok['noneM'] == XHS_TOKEN and tok['textM'] == XHS_TOKEN, \
        '印记的模式词（none/text/upload）不是画风令牌，不许漏进「固定元素」那行：%s ／ %s' % (tok['noneM'], tok['textM'])
    assert (ai('cover'), ai('desc')) == (1, 0), '这一节全是本地读／本地拼：零 AI'
    print('PASS: 印记那层（#23）：提示词尾多一行「印记也由扩展本地盖上去，你不许画：…」（none 不出现）；模式词不漏进令牌', flush=True)

    # ── 5) 各写各的：🔁 重出分镜不碰封面；再点 ✨ 覆盖两栏；人改的那栏没有装置顶它 ──
    goto_tab('cut')
    circle(0, 1)              # 第 1、2 行圈成一屏
    circle(2, 3)              # 第 3、4 行
    circle(4, 4)              # 第 5 行自己一屏
    page.wait_for_function('() => (npS().shots.items || []).length === 3')
    assert st('JSON.stringify((npS().shots.items||[]).map(it => it.sids.length))') == '[2,2,1]', '行号上拖出三屏：%s' % st('JSON.stringify((npS().shots.items||[]).map(it=>it.sids.length))')
    p1 = cv()['prompt']
    goto_tab('desc')
    regen = page.locator('#npRegenBar .np-desc-regen')
    assert '·3屏' in nb(regen.inner_text()), '🔁 只管那 3 张配图：%s' % nb(regen.inner_text())
    regen.click()
    until(1, 'npS().shots.items[2].desc.indexOf("R1") === 0')
    assert (ai('cover'), ai('desc')) == (1, 1), '3 张配图一批一发，封面不占这一发'
    assert cv()['prompt'] == p1, '🔁 回来一字没动封面那份提示词'
    why = regen.get_attribute('data-title') or regen.get_attribute('title') or ''
    assert '②那张封面不占这一发' in nb(why), '悬浮要把「各写各的」说出口：%s' % nb(why)[:200]
    goto_tab('cover')
    page.locator('#npCoverBox .np-cover-gen').click()
    poll(lambda: COPY_2 in cv()['copy'], '第二发 ✨ 没覆盖文案')
    c = cv()
    assert (ai('cover'), ai('desc')) == (2, 1), '再点一次 ✨＝第二发（重来就重来，不加装置）'
    assert c['copy'] == COPY_2 and COVER_BODY_2 in c['prompt'], '两栏一起覆盖成第二版'
    assert c['cap']['em'] == [{'w': '跑了两周', 'k': 'bold'}], '重点那几处也跟着新 copy 一起顶掉：%s' % c['cap']
    assert '第 1 张配图说的那一段' in sw.evaluate('() => self.coverUsers[1]') and SEG1 in sw.evaluate('() => self.coverUsers[1]'), \
        '有了屏就把第 1 张那段喂给这一发（同一件事、画面不许重样）'
    newp = c['prompt'] + '\n这一句是我自己在栏里补的：纸条要倒扣着放。'
    prompt_ta().fill(newp)
    page.wait_for_function('() => npS().shots.cv.prompt.length > %d' % (len(c['prompt']) - 1))
    c = cv()
    assert c['prompt'] == newp, '那一栏人改成什么就是什么（没有本地拼装再顶它）'
    assert c['visualCover'] == newp, 'visual.cover 跟着这一栏'
    assert c['prompt'].count('【底图，这一套每张共用，必须照做】') == 1, '人补一句不会被再拼一层尾巴'
    assert page.locator('#npCoverBox .np-shot-lock').count() == 0, '人写了也不挂 🔒——这一栏本来就是给人改的'
    assert (ai('cover'), ai('desc')) == (2, 1), '两栏改字零 AI'
    print('PASS: 封面与配图各写各的：🔁 那一发不碰它（3 张一发），✨ 再点一次覆盖两栏，人改那栏没有装置顶它（也不挂 🔒）', flush=True)

    # ── 6) copy 是那句的真源：写了就定住；清空才顶派生读数、跟着第 1 屏（⬜ 撤屏跟着挪）──
    copy_inp().fill('')
    page.wait_for_function('() => npS().shots.cv.copy === ""')
    c = cv()
    assert c['derived'] == SEG1, 'copy 空了才顶派生读数＝第 1 屏那句：%s' % c['derived']
    goto_tab('look')          # 改那两栏只刷 tab 那颗状态、面板不整块重画（免得把光标顶掉）→ 切个档再看读数
    goto_tab('cover')
    assert '还没写：现在先顶一句「' + nb(SEG1) in box(), '那一栏下面要写清顶的是哪句：%s' % box()[:300]
    assert '整篇一共4张（封面1张＋配图3张）' in box(), box()[-200:]
    goto_tab('cut')
    page.locator('#npCutWrap .np-cutseg').first.locator('.np-shot-key').click()
    page.wait_for_function('() => npS().shots.items[0].off === true')
    assert cv()['derived'] == SEG2, '⬜ 把第 1 屏撤出名单＝那句跟着挪到新的第 1 屏：%s' % cv()['derived']
    goto_tab('cover')
    assert '整篇一共3张（封面1张＋配图2张）' in box(), '张数账跟着撤屏收成 3 张：%s' % box()[-200:]
    goto_tab('cut')
    page.locator('#npCutWrap .np-cutseg').first.locator('.np-shot-key').click()
    page.wait_for_function('() => npS().shots.items[0].off === false')
    goto_tab('cover')
    assert cv()['derived'] == SEG1, '屏撤回来那句又跟着挪回第 1 屏'
    copy_inp().fill(COPY_2)
    page.wait_for_function('() => npS().shots.cv.copy === "%s"' % COPY_2)
    assert cv()['derived'] == COPY_2, '写了 copy 就以它为准，不再跟屏走'
    goto_tab('cut')
    page.locator('#npCutWrap .np-cutseg').first.locator('.np-shot-key').click()
    page.wait_for_function('() => npS().shots.items[0].off === true')
    goto_tab('cover')
    assert cv()['derived'] == COPY_2 and cv()['copy'] == COPY_2, 'copy 写了＝撤屏也不动它（派生读数只是兜底）'
    goto_tab('cut')
    page.locator('#npCutWrap .np-cutseg').first.locator('.np-shot-key').click()
    page.wait_for_function('() => npS().shots.items[0].off === false')
    assert (ai('cover'), ai('desc')) == (2, 1), '那句的来回全是本地派生，零 AI'
    goto_tab('cover')
    print('PASS: 那句文案（copy）是真源：写了就定住；清空才顶派生读数（跟第 1 屏走、⬜ 撤屏跟着挪），零 AI', flush=True)

    # ── 7) 图在这一档 ⬆ 传回来：素材库一条引用＋缩略图，挂在 #cv 上；📋 复制这一份 ──
    page.evaluate('''() => { window.__clip = '';
        try { navigator.clipboard.writeText = async (t) => { window.__clip = String(t); }; } catch (_) {}
        return true; }''')
    goto_tab('cover')
    page.locator('#npCoverBox .np-cover-copy-prompt').click()
    clip = poll(lambda: page.evaluate('window.__clip'), '📋 复制这一份没落剪贴板')
    assert clip == cv()['prompt'], '复制的就是那一栏里的整话，一字不重拼'
    f1 = png(OUT / 'cover-1.png')
    with page.expect_file_chooser() as fc:
        page.locator('#npCoverBox .np-shot-up[data-id="cv"]').click()
    fc.value.set_files(str(f1))
    poll(lambda: page.locator('#npCoverBox .np-shot-unlink[data-id="cv"]').count() == 1, '封面这张图挂不上')
    assert '提示词有了，图还没传' not in box(), '传回来那句催的话收掉'
    assert page.locator('#npCoverBox img').count() == 1, '缩略图就在这一档摆着（重装置撤了，图不再挂在 .np-shot 那一行里）'
    assert '有图' in tab_badge('cover'), tab_badge('cover')
    chk = check_line()
    assert '缺封面那一张图' not in chk, chk[:300]
    assert '已传回1张' in chk, '账上算封面这一张（配图那 3 张还缺）：%s' % chk[:300]
    assets = poll(lambda: (lambda a: a if len(a) == 1 else None)(
        page.evaluate('async () => (await chrome.storage.local.get("np_assets")).np_assets || []')),
        '素材库没落进去')
    a0 = assets[0]
    assert str(a0['shotOf']) == 'cover-1#cv', '封面那张挂在「这一篇 + cv」上：%s' % a0['shotOf']
    assert str(a0['thumb']).startswith('data:image') and len(a0['thumb']) < 60000, '只留缩略图：%d 字' % len(a0['thumb'])
    assert cv()['imgs'] == [a0['id']], '画面表里只存 id'
    print('PASS: 生好的那张在 ② ⬆ 传回（素材库一条引用＋缩略图 %d 字，挂 #cv）；📋 复制这一份＝那一栏一字不动' % len(a0['thumb']), flush=True)

    # ── 7b) 封面进片（六十六改）：② 传回来的这张进递片序列最前面，片子第一屏就是它；关掉开关＝那段消失，再开回来又补上 ──
    fbase = (ai('cover'), ai('desc'))
    film = page.evaluate('''() => {
        const rows = npFilmShots(npS().shots);
        return { rows: rows.map(r => ({ rowId: r.rowId, no: r.no, off: r.off, text: r.text, assetIds: r.assetIds })),
                 cvImgs: (npCoverOf(npS()) || {}).imgs.slice(0), cvText: npCoverText(npS()) };
    }''')
    rows = film['rows']
    assert rows[0]['rowId'] == 'cv' and rows[0]['no'] == 0 and rows[0]['off'] is False, \
        '封面那一段排在最前、不占屏号（no=0）：%s' % rows[:1]
    assert rows[0]['assetIds'] == film['cvImgs'] and len(rows[0]['assetIds']) == 1, \
        '封面这一段带的就是 ② 传回来的那张图：%s' % rows[0]
    assert rows[0]['text'] == film['cvText'] == COPY_2, '封面那段的文字＝封面那句（copy 写了就照它，不另拼）'
    assert [r['rowId'] for r in rows].count('cv') == 1, '封面只补一段：%s' % [r['rowId'] for r in rows]
    assert [r['no'] for r in rows[1:]] == list(range(1, len(rows))), \
        '配图那几段照旧从 1 排起（封面不进屏号）：%s' % [r['no'] for r in rows]
    goto_tab('cover')      # 上一段 check_line() 停在 ⑤ 预览：开关长在 ② 面上，先切回去
    page.locator('#npCoverBox .np-cover-on[data-v="0"]').click()
    page.wait_for_function('() => npS().shots.cv.on === false')
    assert page.evaluate('() => npFilmShots(npS().shots).every(r => r.rowId !== "cv")'), '关掉封面＝片子不排它'
    page.locator('#npCoverBox .np-cover-on[data-v="1"]').click()
    page.wait_for_function('() => npS().shots.cv.on === true')
    back = page.evaluate('() => npFilmShots(npS().shots)')
    assert back[0]['rowId'] == 'cv' and back[0]['assetIds'] == film['cvImgs'], '再开回来＝又补上、还带着那张图'
    assert (ai('cover'), ai('desc')) == fbase, '这一段全是本地排的：零 AI'
    print('PASS: 封面进片——递片序列最前补一段「封面」（no=0／带那张图／文字＝封面那句）；关开关消失、再开回来又补上（零 AI）', flush=True)

    # ── 8) ④ 一次复制全部含封面；落档只留 {on,copy,prompt,imgs} 四样；回来零重烧 ──
    goto_tab('desc')
    page.locator('.np-shots-copy-all').click()
    allx = poll(lambda: (lambda c2: c2 if '封面提示词：' in c2 else None)(page.evaluate('window.__clip')), '复制全部没带封面')
    assert allx.count('张（共 3 张') == 3, '三张配图各一份：%s' % allx[:200]
    assert allx.count('封面／首图那一张') == 1 and cv()['prompt'] in allx, '封面那一份原样带上（不重拼）'
    assert allx.index('封面提示词：') < allx.index('配图 第 1 张'), '封面排在最前（它是首图）'
    base = (ai('cover'), ai('desc'))
    live = cv()
    page.evaluate('() => npArchiveFlushTouch()')
    got = None
    t0 = time.time()
    while time.time() - t0 < 15:
        got = next((x for x in page.evaluate(NOTES) if x and x.get('id') == 'cover-1'), {}).get('imgDocs')
        if got and (got[0].get('shots') or {}).get('cv'):
            break
        page.wait_for_timeout(300)
    assert got and len(got) == 1, '这一行要落进档案：%s' % got
    saved = got[0]['shots']['cv']
    assert set(saved.keys()) == {'on', 'copy', 'prompt', 'cap', 'imgs'}, '落档只留这五样（cap＝字后压那两格 zone/em）：%s' % sorted(saved.keys())
    assert saved['prompt'] == live['prompt'] and saved['copy'] == live['copy'] and saved['cap'] == live['cap'], '那两栏＋重点一字不差落档'
    assert saved['on'] is True and len(saved['imgs']) == 1, '开关与挂着的那张图一起落档'
    assert 'desc' not in saved and 'cands' not in saved, '重装置那几样不再进档'
    assert str(got[0].get('visual') or '')[:4] != '', '行上的 visual 也跟着落'
    goto_out('cover-1')
    assert cur_tab() == 'preview', '封面写好了、配图还缺图＝回来停在 ⑤ 那条检查：%s' % cur_tab()
    chk = check_line()
    assert '缺封面那一张图' not in chk and '封面那一份还没写' not in chk, chk[:300]
    c = cv()
    assert c['prompt'] == live['prompt'] and c['copy'] == live['copy'] and c['imgs'] == live['imgs'], '从档案再进来读得回'
    assert (ai('cover'), ai('desc')) == base, '再进来不重烧 ✨／🔁'
    print('PASS: ④ 一次复制全部含封面（3 张配图＋封面那份原样）；② 那份只落 {on,copy,prompt,cap,imgs}，再进来零重烧', flush=True)

    # ── 9) 老档那份重装置怎么收：cv.desc → 提示词那一栏，cands／pick／dlock 进来即消失（cap 只剩字位那一格）──
    goto_out('cover-old')
    assert cv()['land'] != 'cover', '老档那份 desc 已经落进提示词栏＝不再当关卡（%s）' % cv()['land']
    goto_tab('cover')
    c = cv()
    assert c['prompt'] == LEGACY_DESC, '老那份三块画面说明照旧当提示词的主体：%s' % c['prompt'][:120]
    assert prompt_ta().input_value() == LEGACY_DESC, '就在第二栏里，可以接着改'
    assert c['copy'] == '', '旧的 cap.big 不当文案真源（那一格撤了）：%s' % c['copy']
    assert c['derived'] == '第一段那份', 'copy 空着就顶派生读数（第 1 屏那句）：%s' % c['derived']
    for dead in ('cands', 'pick', 'dlock', 'clock'):
        assert dead not in c['keys'], '旧字段 %s 不再读：%s' % (dead, c['keys'])
    assert c['cap'] == {'zone': 'bc'}, '旧 cap{档,大字} 收成只要字位那一格（六十五改字后压）：%s' % c['cap']
    assert '缺图' in tab_badge('cover'), tab_badge('cover')
    assert page.locator('#npCoverBox .np-shot-lock').count() == 0, '旧 🔒 手改锁不重画（这一栏本来就给人改）'
    assert page.locator('#npCoverBox .np-cover-gen').count() == 1, '要重来照样点 ✨ 覆盖两栏'
    assert (ai('cover'), ai('desc')) == base, '老档这一整段路零 AI'
    assert other() == [], '没碰别的 AI 通路：%s' % other()[:2]
    print('PASS: 老档收法：cv.desc 落进提示词那一栏（一字不丢），候选／挑条／旧配文档／锁进来即消失（cap 只剩字位那一格），零 AI', flush=True)

    assert not ERRORS, '有 pageerror：%s' % ERRORS[:2]
    print('\n② 封面档链路全绿：关卡 → 两栏（文案／提示词）→ ✨ 一发 → 🔁 不碰它 → copy 真源 → 传图 → 落档 → 老档收法', flush=True)
    print('（全程 AI：%s 发＝✨ 两发 ＋ 🔁 一发；两栏改字／开关／派生那句／落档往返都在本地）' % (ai('cover') + ai('desc')), flush=True)
    page.screenshot(path=str(OUT / 'xhs-note-cover.png'))
    print('SHOT: %s' % (OUT / 'xhs-note-cover.png'), flush=True)


if __name__ == '__main__':
    main()
