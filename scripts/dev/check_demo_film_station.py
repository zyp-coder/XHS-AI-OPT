# -*- coding: utf-8 -*-
"""demo ?v=77（五十六改）点检：「🎬 分幕」这一屏＝写稿工作流里的一站，同一套外壳。

老板 2026-10-16 两轮口径：
  ① 七十一改（?v=76）：口播稿＋分幕并成一屏一站（左稿右幕、进站一路自动跑）。
  ② 2026-10-16 看后再提（?v=77）：「一跳去口播稿，整个界面就换成另外一个东西了，元素都跟那页不一致，
     没有工作流那条条子，又不能回退上一步——把那两个页面设计到工作流里面去」，选定「直接搬进去」。
     这一批先在 demo 里出外壳：顶上那条全场统一成写稿那套圆点款；顶栏同一句标题、「这一片做成什么片」
     并进顶栏一行不再单独压窄条；底栏补回「← 上一步」（回改稿站）；加「📏 就弹窗这么宽」模拟 640。

跑法：python3 -X utf8 scripts/dev/check_demo_film_station.py
直开 tmp/三方向demo.html（msedge，有头），走知识线：挑知识 → 改稿 → 进片台认这一屏 → 底栏上一步回改稿 → 再进站 → 窄屏模拟 → 点发布回档案。
"""
import os
import pathlib
import sys

from playwright.sync_api import sync_playwright

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parents[2]
DEMO = (ROOT / 'tmp' / '三方向demo.html').as_uri()
OUT = pathlib.Path(os.environ.get('TEMP', '/tmp')) / 'xhs_demo_film_station'
OUT.mkdir(parents=True, exist_ok=True)

K_FILM_STEPS = ['挑知识', '改稿', '🎬 分幕', '发布']
K_IMG_STEPS = ['挑知识', '改稿', '🧠 出导图', '发布']
CUR_TIP = '正在这一站：左边口播稿、右边分幕'

# 读圆点条：站名＝.wlbl 的第一个文本节点（<i> 那行是副标，不算站名）
JS_STATIONS = '''(sel) => [...document.querySelectorAll(sel + ' .wsteps .wst')].map(x => {
  const lab = x.querySelector('.wlbl'), dot = x.querySelector('.wdot');
  return { t: lab ? lab.firstChild.textContent.trim() : '',
           sub: lab && lab.querySelector('i') ? lab.querySelector('i').textContent.trim() : '',
           tag: dot ? dot.tagName : '', cls: dot ? dot.className : '',
           tip: dot ? (dot.getAttribute('title') || '') : '' }; })'''


def stations(page, sel='#v-fedit'):
    return page.evaluate(JS_STATIONS, sel)


def names(page, sel='#v-fedit'):
    return [s['t'] for s in stations(page, sel)]


def cur_station(page, sel='#v-fedit'):
    got = [s for s in stations(page, sel) if 'cur' in s['cls']]
    return got[0] if got else None


def click_station(page, name, sel='#v-fedit'):
    page.evaluate('''(args) => { const [nm, box] = args;
      const st = [...document.querySelectorAll(box + ' .wsteps .wst')]
        .find(x => x.querySelector('.wlbl').firstChild.textContent.trim() === nm);
      const dot = st && st.querySelector('.wdot');
      if (!dot) throw new Error('条上找不到这一站：' + nm);
      if (dot.tagName !== 'BUTTON') throw new Error('这一站点不动（' + nm + '）：' + (dot.getAttribute('title') || ''));
      dot.click(); }''', [name, sel])


def chain_done(page, ms=30000):
    """等进站那一路自动跑完（调稿 → 提重点 → 改出出片稿 → 切幕）"""
    page.wait_for_function('''() => { const w = feData().row.w;
      return !fe.fvBusy && !fe.chainBusy && String(w.filmVoice || "").trim()
        && (w.filmDocs[0].scenes || []).length; }''', timeout=ms)


def one_screen(page):
    """这一屏：口播稿框＋分幕卡（宽屏并排），加底栏与顶栏的样子"""
    return page.evaluate('''() => {
      const cols = [...document.querySelectorAll('#v-fedit div[style*="padding:12px 14px"]')];
      const r0 = cols[0] && cols[0].getBoundingClientRect();
      const r1 = cols[1] && cols[1].getBoundingClientRect();
      const hb = [...document.querySelectorAll('#v-fedit b')].find(x => x.innerText.trim() === 'AI 抓的重点');
      const w = feData().row.w;
      return { cols: cols.length,
               leftIsScript: !!(cols[0] && cols[0].querySelector('textarea') && !cols[0].querySelector('input[oninput*="feSceneTx"]')),
               rightIsScenes: !!(cols[1] && cols[1].querySelector('input[oninput*="feSceneTx"]') && !cols[1].querySelector('textarea')),
               sidebyside: !!(r0 && r1 && r1.left >= r0.right - 1 && Math.abs(r0.top - r1.top) < 40),
               stacked: !!(r0 && r1 && r1.top > r0.top + 20),
               canvas: !!document.querySelector('#v-fedit #feCv'),
               narrowBox: !!document.querySelector('#v-fedit .fe-narrow'),
               title: (document.querySelector('#v-fedit .wb-top .wb-title') || {}).innerText || '',
               tools: [...document.querySelectorAll('#v-fedit .wb-tools button')].map(b => b.innerText.trim()),
               sceneInputs: document.querySelectorAll('#v-fedit input[oninput*="feSceneTx"]').length,
               pickChips: hb ? [...hb.parentElement.querySelectorAll('span[title]')].length : 0,
               footBtns: [...document.querySelectorAll('#v-fedit .wb-foot button')].map(x => x.innerText.trim()),
               foot: (document.querySelector('#v-fedit .wb-foot .note-xs') || {}).innerText || '',
               reRun: [...document.querySelectorAll('#v-fedit button')].map(b => b.innerText.trim())
                        .filter(t => /↻|✨/.test(t)),
               segBar: document.querySelectorAll('#v-fedit .seg.stepbar').length,
               scenes: (w.filmDocs[0].scenes || []).length,
               picks: Array.isArray(w.fvPicks) ? w.fvPicks.length : 0,
               pn: w.fvPN || 0,
               script: String(w.filmVoice || ''),
               body: String(w.voice || '') }; }''')


with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(str(OUT / 'profile'), headless=False, channel='msedge')
    page = ctx.new_page()
    page.set_default_timeout(15000)
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(DEMO)
    page.wait_for_function('() => typeof kFinishFilm === "function" && typeof feGotoRewrite === "function"')

    # ── 1) 知识线走通：挑知识 → 改稿（这条线上的条＝圆点款）──────────────
    page.evaluate('() => navK()')
    page.wait_for_function('() => $("#v-k").classList.contains("on")')
    page.evaluate('() => kToggle("闭水试验要做多久才合格")')
    assert names(page, '#v-k') == K_IMG_STEPS, '写稿那几站的条该是四站圆点款：%s' % (names(page, '#v-k'),)
    assert page.evaluate('() => document.querySelectorAll("#v-k .seg.stepbar").length') == 0, '旧的按钮款条该退场（全场只剩圆点款）'
    subs = [s['sub'] for s in stations(page, '#v-k')]
    assert subs[:2] == ['讲哪条', '改到满意'], '站名下面那行小字该跟着扩展的站点表：%s' % (subs,)
    page.locator('#v-k .np-pinbar .btn-primary').click()
    page.wait_for_function('() => kStep === 2')
    page.wait_for_function('() => (kRow.w.copyEd || []).length > 0')
    body_now = page.evaluate('() => kCopyOf(kRow)')
    assert body_now.strip(), '改稿站该有成稿正文'
    print('PASS: ① 知识线 挑知识 → 改稿；那条条＝圆点款、站名下一行小字（%s）' % '、'.join(subs[:2]), flush=True)

    # ── 2) 进片台：同一条圆点条（四站），当前站亮在「🎬 分幕」──
    page.evaluate('() => { kRow.w.kOut = "film"; render(); }')
    page.locator('#v-k .np-pinbar .btn-primary').click()
    page.wait_for_function('() => $("#v-fedit").classList.contains("on")')
    assert page.locator('#v-fedit .stepbar').count() == 1, '片台顶栏下面该只有一条工作流步骤条'
    assert names(page) == K_FILM_STEPS, '步骤条该是四站（稿与幕并成一站）：%s' % (names(page),)
    cur = cur_station(page)
    assert cur and cur['t'] == '🎬 分幕' and cur['tip'] == CUR_TIP, '当前站不对：%s' % (cur,)
    assert page.evaluate('() => document.querySelectorAll("#v-fedit .seg.stepbar").length') == 0, \
        '出片这一屏不再自己画一条按钮款——跟写稿同一条画法'
    print('PASS: ② 这一屏挂进同一条圆点条（%s），当前站提示＝「%s」' % (' | '.join(names(page)), cur['tip']), flush=True)

    # 顶栏＝跟写稿同一套：同一句标题、「这一片」并进顶栏、工具钮在右边
    sc0 = one_screen(page)
    assert sc0['title'] == '📚 知识起笔', '顶栏标题该跟写稿那几站同一句，不是「🎬 出片 · …」：%s' % sc0['title']
    tagtxt = page.evaluate('() => ((document.querySelector("#v-fedit .wb-top .wb-tag") || {}).innerText || "")')
    assert '这一片：' in tagtxt, '「这一片做成什么片」该并进顶栏那一行，不再单独压一条窄横条：%s' % tagtxt
    assert len(sc0['tools']) == 3 and all(x in ' '.join(sc0['tools']) for x in ['⚙', '↗', '📏']), \
        '顶栏右边该是 ⚙／↗／📏 三颗工具钮：%s' % (sc0['tools'],)
    print('PASS: ③ 顶栏同一套（标题「%s」＋右边 %s）' % (sc0['title'], ' '.join(sc0['tools'])), flush=True)

    # 内部那排签该撤净；「上一步」这批改回来（底栏），「下一步」仍不该有
    dup = page.evaluate('''() => [...document.querySelectorAll("#v-fedit button")]
        .map(b => b.innerText.trim())
        .filter(t => t === '① 口播稿' || t === '② 分幕' || t === '③ 音色' || t === '④ 风格'
                  || t === '下一步' || t === '🎬 下一步').length''')
    assert dup == 0, '内部那排签与「下一步」该撤净（还剩 %d 个）' % dup
    assert page.evaluate('() => !("tab" in fe)'), 'fe.tab 这个状态已废（一屏不需要切屏）'
    assert any('🎬 出片' in t for t in sc0['footBtns']), '底栏该留「🎬 出片」那颗'
    assert any('上一步' in t for t in sc0['footBtns']), '底栏该补回「← 上一步」（老板：这里不能回退上一步）'
    print('PASS: ④ 底栏「← 上一步」补回来了（%s）' % ' / '.join(sc0['footBtns']), flush=True)

    # ── 5) 进站一路自动跑完，落在这同一屏（稿＋幕）────────────────────
    chain_done(page)
    sc = one_screen(page)
    print('    这一屏 = cols=%s sidebyside=%s picks=%s scenes=%s 幕框=%s'
          % (sc['cols'], sc['sidebyside'], sc['picks'], sc['scenes'], sc['sceneInputs']), flush=True)
    assert (sc['cols'] == 2 and sc['leftIsScript'] and sc['rightIsScenes'] and sc['sidebyside']), \
        '一屏两栏（左稿右幕）不对：%s' % (sc,)
    assert sc['picks'] >= 2 and sc['scenes'] >= 2 and sc['pn'] == sc['picks'], \
        '自动链该跑完（重点 → 出片稿 → 幕）：%s' % ({k: sc[k] for k in ('picks', 'scenes', 'pn')},)
    assert sc['script'] and sc['script'] != sc['body'], '左边该是改出来的出片稿，不是原正文'
    assert sc['pickChips'] == sc['picks'], '重点只读小标该跟重点条数对上：%s' % (sc['pickChips'],)
    assert any('重新出一版' in t for t in sc['reRun']), '换个切法该走「↻ 重新出一版」：%s' % (sc['reRun'],)
    assert sc['foot'].startswith('分幕 ') and '配' in sc['foot'], '底栏那句没跟上：%s' % sc['foot']
    print('PASS: ⑤ 进站一路自动跑完（%d 个重点 → %d 幕），左边＝出片稿 %d 字、右边逐幕'
          % (sc['picks'], sc['scenes'], len(sc['script'])), flush=True)
    page.screenshot(path=str(OUT / '01-one-screen.png'))

    # ── 6) 框里改过字＝只提示一句，幕不乱动（要重切自己点「↻ 重新出一版」）──
    page.evaluate('''() => { const t = document.querySelector('#v-fedit textarea');
      t.value = t.value + '（这一句是手加的）';
      t.dispatchEvent(new Event('input', { bubbles: true }));
      t.dispatchEvent(new Event('blur', { bubbles: true })); }''')
    page.wait_for_timeout(700)
    ed = page.evaluate('''() => ({ flag: !!feData().row.w.fvEdited, scenes: (feData().row.w.filmDocs[0].scenes || []).length,
      warn: [...document.querySelectorAll('#v-fedit span')].some(s => /框里改过字/.test(s.innerText)),
      foot: (document.querySelector('#v-fedit .wb-foot .note-xs') || {}).innerText || '' })''')
    assert ed['flag'] and ed['warn'] and '稿子改过字' in ed['foot'], '改字后该只提示、不自动重切：%s' % (ed,)
    assert ed['scenes'] == sc['scenes'], '改字不该动幕（还该是 %d 幕，现在 %d）' % (sc['scenes'], ed['scenes'])
    print('PASS: ⑥ 框里改过字＝只提示一句（幕还留着 %d 幕），底栏同步报「稿子改过字」' % ed['scenes'], flush=True)

    # ── 7) 「发布」站闸门：没出片灰着带原因，出过片才放开 ───────────────
    pub = [s for s in stations(page) if s['t'] == '发布'][0]
    assert pub['tag'] != 'BUTTON' and '先出片' in pub['tip'], '没出片前「发布」该灰着带原因：%s' % (pub,)
    page.evaluate('() => { fe.outDone = true; renderFedit(); }')
    pub = [s for s in stations(page) if s['t'] == '发布'][0]
    assert pub['tag'] == 'BUTTON' and '回档案' in pub['tip'], '出过片「发布」该放开（点了回档案去发布台）：%s' % (pub,)
    page.evaluate('() => { fe.outDone = false; renderFedit(); }')
    print('PASS: ⑦ 「发布」站＝出过片才放开（没出片灰着写「先出片才到发布」）', flush=True)

    # ── 8) 底栏「← 上一步」＝回改稿站，稿与幕先存好、正文不丢 ────────────
    page.locator('#v-fedit .wb-foot button', has_text='上一步').click()
    page.wait_for_function('() => $("#v-k").classList.contains("on") && kStep === 2')
    assert not page.evaluate('() => $("#v-fedit").classList.contains("on")'), '上一步该回工作流那一站，不是还挂在台子上'
    assert page.evaluate('() => kRow && kRow.id === fe.rowId'), '回的该是这一篇'
    assert page.evaluate('() => kCopyOf(kRow)') == body_now, '回改稿正文不许丢/变（这一版没手改过正文）'
    assert names(page, '#v-k') == K_FILM_STEPS, '回写稿那侧，条上四站该还在（同一篇同一条链）：%s' % (names(page, '#v-k'),)
    print('PASS: ⑧ 底栏「← 上一步」＝回这一篇的改稿站、正文原样还在、条仍是那四站', flush=True)

    # ── 9) 条上点「改稿」也一样回（两条回程都给）＋ 再走出口续着不重烧 ────
    page.locator('#v-k .np-pinbar .btn-primary').click()
    page.wait_for_function('() => $("#v-fedit").classList.contains("on")')
    page.wait_for_timeout(800)
    click_station(page, '挑知识')
    page.wait_for_function('() => $("#v-k").classList.contains("on") && kStep === 1')
    print('PASS: ⑨ 顶条点「挑知识」也回得去（条与上一步两条回程都通）', flush=True)

    script_before = page.evaluate('() => feData().row.w.filmVoice')
    scenes_before = page.evaluate('() => (feData().row.w.filmDocs[0].scenes || []).length')
    page.evaluate('() => { kStep = 2; render(); }')
    page.locator('#v-k .np-pinbar .btn-primary').click()
    page.wait_for_function('() => $("#v-fedit").classList.contains("on")')
    page.wait_for_timeout(1500)
    keep = page.evaluate('''() => ({ busy: !!(fe.fvBusy || fe.chainBusy),
      script: String(feData().row.w.filmVoice || ''), scenes: (feData().row.w.filmDocs[0].scenes || []).length,
      cur: (() => { const d = document.querySelector('#v-fedit .wdot.cur');
        const st = d && d.closest('.wst'); return st ? st.querySelector('.wlbl').firstChild.textContent.trim() : ''; })() })''')
    assert keep['cur'] == '🎬 分幕', '再进台子该重新站在这一站：%s' % keep['cur']
    assert not keep['busy'] and keep['script'] == script_before and keep['scenes'] == scenes_before, \
        '已有稿与幕再进站不许重烧/覆盖（续上）'
    print('PASS: ⑩ 再进站＝续着那一版（%d 字 / %d 幕，没重跑），仍站在这一站'
          % (len(keep['script']), keep['scenes']), flush=True)

    # ── 11) 📏 弹窗宽度模拟：收成 640＝画布收掉＋稿／幕两签换着摊（老板拍板 B）──
    page.locator('#v-fedit .wb-tools button', has_text='📏').click()
    page.wait_for_function('() => !!fe.narrow')
    page.wait_for_timeout(600)
    nar = one_screen(page)
    assert nar['narrowBox'], '该把这一屏收进 640 的框里'
    assert page.evaluate('() => document.querySelector("#v-fedit .fe-narrow").getBoundingClientRect().width') <= 664, \
        '框该是弹窗那么宽（640 上下）'
    assert not nar['canvas'], '窄屏里画布与右侧小栏该收掉（镜真机内嵌版把预览收起）'
    tabs = page.evaluate("() => [...document.querySelectorAll('#v-fedit .seg button')].map(b => b.innerText.trim())")
    assert len(tabs) == 2 and '口播稿' in tabs[0] and '分幕' in tabs[1], '窄屏该有「📝 口播稿／🎬 分幕」两签：%s' % (tabs,)
    assert nar['cols'] == 1 and nar['leftIsScript'] and nar['sceneInputs'] == 0, \
        '窄屏默认只摊稿那一栏（不是上下叠、也不是并排）：%s' % ({k: nar[k] for k in ('cols', 'leftIsScript', 'sceneInputs')},)
    assert page.evaluate("() => (document.querySelector('#v-fedit .seg button.active')||{}).innerText") .startswith('📝'), '当前签该亮在稿这栏'
    page.evaluate("() => feNTab('scenes')")
    page.wait_for_timeout(500)
    n2 = one_screen(page)
    assert n2['cols'] == 1 and n2['sceneInputs'] >= 2 and not n2['leftIsScript'], \
        '点「🎬 分幕」该换成只摊幕那一栏（幕框 %s 个）：%s' % (n2['sceneInputs'], {k: n2[k] for k in ('cols', 'leftIsScript')},)
    assert len(names(page)) == 4, '窄屏里那条工作流条还在（四站）：%s' % (names(page),)
    page.screenshot(path=str(OUT / '03-narrow-640.png'))
    page.evaluate("() => feNTab('script')")
    page.locator('#v-fedit .wb-tools button', has_text='📏').click()
    page.wait_for_timeout(600)
    wide = one_screen(page)
    assert wide['sidebyside'] and wide['canvas'], '放开后该回两栏并排＋画布'
    print('PASS: ⑪ 📏 弹窗那么宽（640）＝画布收掉、稿／幕两签换着摊（各自占满）；放开回两栏并排', flush=True)

    # ── 12) 从档案行单独进片台：四站齐、点「改稿」先把这一篇载回工作流 ────
    rid = page.evaluate('() => { feBack(); kRow = null; render(); return fe.rowId; }')
    page.wait_for_function('() => $("#v-archive").classList.contains("on")')
    page.evaluate('(id) => feOpenRow(id)', rid)
    page.wait_for_function('() => $("#v-fedit").classList.contains("on")')
    assert names(page) == K_FILM_STEPS, '从档案行进片台，条也该摆这四站：%s' % (names(page),)
    assert page.evaluate('''() => [...document.querySelectorAll('#v-fedit .wb-foot button')]
        .some(b => /上一步/.test(b.innerText))'''), '这一篇是知识线的篇，从档案直接进也该摆「← 上一步」（回得去改稿）'
    click_station(page, '改稿')
    page.wait_for_function('() => $("#v-k").classList.contains("on") && kStep === 2')
    assert page.evaluate('() => kRow && kRow.id === %d' % rid), '该先把这一篇载回工作流再回改稿'
    page.evaluate('(id) => feOpenRow(id)', rid)
    page.wait_for_function('() => $("#v-fedit").classList.contains("on")')
    page.locator('#v-fedit .wb-foot button', has_text='上一步').click()
    page.wait_for_function('() => $("#v-k").classList.contains("on") && kStep === 2')
    assert page.evaluate('() => kRow && kRow.id === %d' % rid), '底栏那颗「← 上一步」也该把这一篇载回工作流'
    print('PASS: ⑫ 从档案行单独进片台四站齐；条上「改稿」与底栏「上一步」都先把这篇载回工作流', flush=True)

    # ── 13) 出过片点条上「发布」＝回档案（那一行下一步去发布台）───────────
    page.evaluate('(id) => feOpenRow(id)', rid)
    page.wait_for_function('() => $("#v-fedit").classList.contains("on")')
    page.evaluate('() => { fe.outDone = true; renderFedit(); }')
    click_station(page, '发布')
    page.wait_for_function('() => $("#v-archive").classList.contains("on")')
    print('PASS: ⑬ 出过片点条上「发布」＝回档案（那一行下一步去发布台）', flush=True)

    assert not errs, '页面报错：%s' % errs[:3]
    print('PASS: 五十六改（demo ?v=77）点检全绿——同一条圆点条·同一顶栏·底栏上一步·640 模拟·发布闸门·续上不重烧·档案直进', flush=True)
    ctx.close()
