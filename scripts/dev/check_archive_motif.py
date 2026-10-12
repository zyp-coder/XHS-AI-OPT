# -*- coding: utf-8 -*-
"""档案「最终形式」列 ＋ 素材库（集合）来源两池 ＋ 档案缺口反查 的自检（对着现行 popup.js 真源）。

口径：
  1) 档案「最终形式」这一列：粗体＝六卡那套叫法（🖼 图文笔记 / ✨ 成片…），后头跟这一篇自己的画面流派——
     图文侧：行自己定的算（两派就「A / B」并列），没定的跟账号默认；只有旧形式名的老档摆「旧：清单卡片式」，
     不回填；视频侧摆成片形式。整页零 AI。
  2) 素材库＝集合：🤖 AI 整理按「卖点 × 知识库」两池列要备料（空集合＝🖼 待补充）——画面流派不再当来源摆；
     AI 里那几条硬要求照旧（只列真的要动手准备的图 / 别硬凑）。集合带来源 chip（卖点「X」/ 知识库「X」/ 自己加的）。
  3) 档案「还缺 N 项」＝按这一篇挂的卖点 / 知识库反查空集合（零 AI）；点它跳素材库、把缺的那几集红框高亮。
  4) 档案那颗「下一步」（中间态＝「✏️ 编辑」，去向写在 title）→ 造图片（摊开第一条行）；七十改撤了「← 渲染任务」那张表
     与行选择器，换行走 npImgUseRow（旧表点行、档案指行都走它）；造图片顶上那格只读流派，旧形式名不再出现。

跑法：python3 -X utf8 scripts/dev/check_archive_motif.py
临时 profile 加载真扩展（msedge），全程 AI 走桩、不烧真接口。
"""
import pathlib
import shutil
import sys
import tempfile
import time

from playwright.sync_api import sync_playwright

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / 'extension'
OUT = pathlib.Path(tempfile.gettempdir())
ERRORS = []

MOTIF_A = '真人工作场景'          # 第一条行自己定的那一派
MOTIF_B = '界面·软件拼贴'          # 第二条行自己定的那一派
MOTIF_DEF = '方案页'              # 账号默认那一派（没定流派的行按它算）
SELL = '省时间'                   # 卖点标题（来源池那一池）
BOGUS_SRC = '门店实拍氛围'         # AI 硬填一个对不上两池的来源名 → 集合建得出、但不挂来源、不当缺口
NEED_SELL = '省时间那张对比图'     # source＝卖点 → 挂上「卖点」来源，能跟档案缺口对上
NEED_PLAIN = '工位实拍 ×1'         # source 对不上两池

NEEDS = ('{"needs":[{"title":"%s","spec":"把省掉的步骤摆成前后两张对照。","source":"%s"},'
         '{"title":"%s","spec":"拍自己干活那张桌面，圈出省下来的那一步。","source":"%s"}]}'
         % (NEED_SELL, SELL, NEED_PLAIN, BOGUS_SRC))

SEED = r'''async (payload) => {
    await Storage.initializeDefaults(DEFAULT_PROMPTS);
    await ensureTenantInit();
    const cfg = await Storage.getConfig();
    cfg.product.name = '档案缺口测试产品';
    cfg.product.sellPoints = [{ title: '省时间', content: '把重复步骤压掉' }];
    cfg.ai.apiKey = 'test-local-only';
    cfg.imgLook = { motif: payload.defMotif };
    await Storage.setConfig(cfg);
    const row = (motif, txt) => ({
        id: 'g' + Math.random().toString(36).slice(2, 8), pid: 'xhs', style: '',
        shots: { look: motif ? { motif: motif } : {}, cover: '', items: [
            { id: 's1', text: txt, desc: '中心思想：' + txt }] },
        visual: { cover: '', images: '那一份拼出来的提示词' }, updatedAt: Date.now(),
    });
    await chrome.storage.local.set({
        np_notes: [
            { id: 'ar-two-motifs', title: '用了两派的图', status: '待发', platform: 'xhs', form: '图文',
              draft: '用了两派的图正文。', voice: '用了两派的图的朗读稿。',
              sellPoints: [{ point: '省时间', why: '', hasImage: false }],
              imgDocs: [row(payload.motifA, '第一段。'), row(payload.motifB, '第二段。')],
              createdAt: Date.now(), updatedAt: Date.now() },
            { id: 'ar-default-motif', title: '跟账号默认那篇', status: '待发', platform: 'xhs', form: '图文',
              draft: '跟账号默认那篇正文。', imgDocs: [row('', '第一段。')], createdAt: Date.now(), updatedAt: Date.now() },
            { id: 'ar-legacy', title: '旧形式那篇', status: '待发', platform: 'xhs', form: '图文', style: '清单卡片式',
              draft: '旧形式那篇正文。', shots: { cover: '', items: [{ id: 'o1', text: '老档的一段。', desc: '老档的描述' }] },
              visual: { cover: '', images: '老档那份提示词' }, createdAt: Date.now(), updatedAt: Date.now() },
            { id: 'ar-video', title: '视频那篇', status: '待发', platform: 'xhs', form: '视频', filmKind: 'PPT字体动效',
              draft: '视频那篇正文。', voice: '一屏一句话的口播稿。', createdAt: Date.now(), updatedAt: Date.now() },
        ],
        np_assets: [],
    });
    self.aiCalls = 0;
    self.aiOther = 0;
    self.others = [];
    self.asSystems = [];
    self.asUsers = [];
    AiClient.chatCompletion = async (cfg2, system, user) => {
        const sys = String(system || '');
        if (sys.indexOf('用户要提前把图备好') >= 0) {
            self.asSystems.push(sys);
            self.asUsers.push(String(user || ''));
            self.aiCalls++;
            return { content: payload.needs };
        }
        self.aiOther++;
        self.others.push(sys.slice(0, 80));
        return { content: '{}' };
    };
    return true;
}'''

ROWS = '''() => Array.from(document.querySelectorAll('#noteArchiveContent .npar-row'))
  .filter(r => !r.classList.contains('npar-head'))
  .map(r => ({
    ttl: (r.querySelector('.npar-col-ttl .npar-tx') || {}).getAttribute('title') || '',
    form: ((r.querySelector('.npar-col-form') || {}).innerText || '').trim(),
    peek: (r.querySelector('.npar-col-peek') || {}).innerText || '',
  }))'''


def boot(p):
    for i in range(5):
        prof = OUT / ('arxmotif-profile%d' % i)
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


def wait(page, fn_expr, secs=20):
    t0 = time.time()
    while time.time() - t0 < secs:
        if page.evaluate(fn_expr):
            return True
        page.wait_for_timeout(300)
    return False


with sync_playwright() as p:
    ctx = boot(p)
    try:
        sw = ctx.service_workers[0]
        assert sw.evaluate('chrome.runtime.onMessage.hasListeners()'), '后台路由没注册上'
        sw.evaluate(SEED, {'motifA': MOTIF_A, 'motifB': MOTIF_B, 'defMotif': MOTIF_DEF, 'needs': NEEDS})

        page = ctx.new_page()
        page.on('pageerror', lambda e: ERRORS.append(str(e)[:200]))
        page.set_viewport_size({'width': 1280, 'height': 980})
        page.goto(sw.url.replace('background.js', 'popup.html?mode=big'))
        page.wait_for_function('typeof switchMainTab === "function" && typeof npNoteMotifs === "function"')
        page.set_default_timeout(25000)

        # ── 1) 档案「最终形式」列＝六卡叫法＋画面流派（行定的 / 跟账号默认 / 老档只当「旧：」）；视频侧读成片形式 ──
        page.evaluate('() => switchMainTab("noteArchive")')
        page.wait_for_function('() => document.querySelectorAll("#noteArchiveContent .npar-row:not(.npar-head)").length === 4')
        assert '最终形式' in page.locator('#noteArchiveContent .npar-head').inner_text()
        by = {r['ttl']: r for r in page.evaluate(ROWS)}
        assert set(by) == {'用了两派的图', '跟账号默认那篇', '旧形式那篇', '视频那篇'}, list(by)
        assert by['用了两派的图']['form'] == '🖼 图文笔记 · %s / %s' % (MOTIF_A, MOTIF_B), by['用了两派的图']['form']
        assert by['跟账号默认那篇']['form'] == '🖼 图文笔记 · ' + MOTIF_DEF, \
            '那一行没自己定流派＝跟账号默认那一派算：%s' % by['跟账号默认那篇']['form']
        assert by['旧形式那篇']['form'] == '🖼 图文笔记 · 旧：清单卡片式', \
            '老档只记过旧「出图形式」：摆成「旧：」，不回填成新轴：%s' % by['旧形式那篇']['form']
        assert by['视频那篇']['form'] == '✨ 成片 · PPT字体动效', by['视频那篇']['form']
        assert '清单卡片式' not in by['用了两派的图']['form'] + by['跟账号默认那篇']['form'], '定了流派的行不该再带旧形式名'
        assert sw.evaluate('self.aiCalls') == 0, '打开档案不该烧 AI'
        print('PASS: 档案「最终形式」列读画面流派（两派并列 / 跟账号默认 / 老档只当「旧：」摆），视频那侧摆成片形式、零 AI', flush=True)

        # ── 2) 素材库：🤖 AI 整理按「卖点 × 知识库」两池列要备料（画面流派不再当来源；空集合＝🖼 待补充）──
        page.evaluate('() => switchMainTab("noteAssets")')
        page.wait_for_function('() => !!document.querySelector("#noteAssetsContent .npas-gen")')
        page.locator('#noteAssetsContent .npas-gen').click()
        assert wait(page, '() => document.querySelectorAll("#noteAssetsContent .npas-col-open").length === 2', secs=25), \
            'AI 回来后该摆出两个集合'
        assert sw.evaluate('self.aiCalls') == 1, '整素材清单＝一发 AI：%s' % sw.evaluate('self.aiCalls')
        sys_a = sw.evaluate('self.asSystems[0]')
        user_a = sw.evaluate('self.asUsers[0]')
        assert '【卖点（来源名＝这里的标题）】' in user_a, '来源池＝卖点这一池：%s' % user_a[:220]
        assert SELL + '：把重复步骤压掉' in user_a, user_a[:220]
        assert '只列真的要动手准备的图' in sys_a and '不配图也能排出来的画面' in sys_a, '那条硬要求要说「别硬凑条目」'
        assert 'source 必须原样抄下面【可选来源】里的一个名字' in sys_a
        assert MOTIF_A not in user_a and MOTIF_B not in user_a, '画面流派名不再进来源池'
        assert '画面流派' not in user_a and '画面流派' not in sys_a and '清单卡片式' not in user_a + sys_a, \
            '旧那层概念不再当来源摆'
        cards = [page.locator('#noteAssetsContent .npas-col-open').nth(i).inner_text() for i in range(2)]
        sell_card = [c for c in cards if NEED_SELL in c][0]
        assert '卖点「%s」' % SELL in sell_card and '🖼 待补充 · 还没料' in sell_card, sell_card.replace('\n', ' ')
        plain_card = [c for c in cards if NEED_PLAIN in c][0]
        assert '🖼 待补充 · 还没料' in plain_card and '卖点「' not in plain_card and '知识库「' not in plain_card, \
            '对不上两池的来源名不硬挂成来源：%s' % plain_card.replace('\n', ' ')
        print('PASS: 素材来源池＝卖点 × 知识库两池（画面流派不再当来源；对不上两池的不硬挂；空集合摆「🖼 待补充」）', flush=True)

        # ── 3) 档案「还缺 N 项」＝按这一篇挂的卖点对空集合反查（零 AI）；点它跳素材库、红框高亮那一集 ──
        page.evaluate('() => switchMainTab("noteArchive")')
        t0 = time.time()
        gap = ''
        while time.time() - t0 < 20:
            if page.locator('#noteArchiveContent .npar-gap').count() == 1:
                gap = page.locator('#noteArchiveContent .npar-gap').inner_text()
                if '还缺' in gap:
                    break
            page.wait_for_timeout(300)
        assert '还缺 1 项（%s）' % NEED_SELL in gap, gap
        rows = {r['ttl']: r for r in page.evaluate(ROWS)}
        assert '还缺' in rows['用了两派的图']['peek']
        assert ('还缺' not in rows['跟账号默认那篇']['peek'] and '还缺' not in rows['旧形式那篇']['peek']
                and '还缺' not in rows['视频那篇']['peek']), '没挂那条卖点的篇不该催缺口'
        assert page.locator('#noteArchiveContent .npar-gap').count() == 1, '只有挂上卖点、集合还空的那一篇摆「还缺」那颗'
        page.locator('#noteArchiveContent .npar-gap').click()
        assert wait(page, '() => document.querySelectorAll("#noteAssetsContent .npas-focus").length === 1', secs=15), \
            '点「还缺」该跳素材库、缺的那一集红框'
        focus_txt = page.locator('#noteAssetsContent .npas-focus').inner_text()
        assert NEED_SELL in focus_txt, focus_txt.replace('\n', ' ')
        assert sw.evaluate('self.aiCalls') == 1, '缺口反查 / 跳转全程零 AI'
        print('PASS: 档案「还缺 N 项」按挂的卖点对空集合反查（零 AI），点它跳素材库、缺的那一集红框高亮', flush=True)

        # ── 4) 档案「下一步」✏️ 编辑（title 指去出图）→ 造图片（顶上那格读流派）；两行两派各管各（换行走 npImgUseRow，旧表已撤） ──
        page.evaluate('() => switchMainTab("noteArchive")')
        assert wait(page, '() => !!document.querySelector(\'#noteArchiveContent .npar-next[data-id="ar-two-motifs"]\')'), \
            '稿子定了、图没齐的图文篇，操作列该摆那颗「下一步」'
        nb = page.locator('#noteArchiveContent .npar-next[data-id="ar-two-motifs"]')
        assert nb.inner_text().strip() == '✏️ 编辑', nb.inner_text()
        assert '还缺 2 张' in (nb.get_attribute('title') or ''), nb.get_attribute('title')
        nb.click()
        page.wait_for_function('() => _npMode === "out" && !!document.querySelector("#npImgTabs")')
        cur = page.evaluate('() => npLookOf(npS()).motif')
        assert cur == MOTIF_A, '档案「下一步」进造图片，摊开的是第一条行（A 派）：%s' % cur
        head = page.locator('#npImgTabs').inner_text().replace(' ', '').replace('\n', '')
        assert MOTIF_A in head, '造图片顶上那格要摆流派：%s' % head[:150]
        assert '清单卡片式' not in head and '旧：' not in head, head[:150]
        # 七十改：任务表（含一行一派的挑行口）整页撤了——两行各自的流派照旧各管各。
        # 「摊开某一行」现在只剩 npImgUseRow 这一个行动点（旧表点行、档案「下一步」指行都走它），直接调它验 B 派那行。
        rows2 = page.evaluate('() => (npS().imgDocs || []).filter(x => x && String(x.kind || "") !== "mind").map(x => npRowMotif(x, npS()))')
        assert MOTIF_A in rows2 and MOTIF_B in rows2, '两派各占一行：%s' % rows2
        page.evaluate('''() => {
            const w = npS();
            const r = (w.imgDocs || []).filter(x => x && String(x.kind || '') !== 'mind')
                .find(x => npRowMotif(x, w) === '%s');
            npImgUseRow(w, r);
            npRenderOutput(document.getElementById('noteOutputContent'));
        }''' % MOTIF_B)
        cur2 = page.evaluate('() => npLookOf(npS()).motif')
        assert cur2 == MOTIF_B, '换到哪一行就摊开哪一行：%s' % cur2
        head2 = page.locator('#npImgTabs').inner_text().replace(' ', '').replace('\n', '')
        assert MOTIF_B in head2 and '旧：' not in head2, head2[:150]
        page.screenshot(path=str(OUT / 'xhs-archive-motif.png'))
        print('PASS: 「下一步」→ 造图片顶上那格读流派（%s）；两行两派各管各，换到 B 派那行就摊开 B 派（%s，旧表已撤、走 npImgUseRow），旧形式名不再出现' % (cur, cur2), flush=True)

        print('SHOT: %s' % (OUT / 'xhs-archive-motif.png'), flush=True)
        assert not ERRORS, '有 pageerror：%s' % ERRORS[:2]
        assert sw.evaluate('self.aiCalls') == 1 and sw.evaluate('self.aiOther') == 0, \
            '全程只该有「算素材清单」那一发：stub=%s other=%s %s' % (
                sw.evaluate('self.aiCalls'), sw.evaluate('self.aiOther'), sw.evaluate('self.others'))
        print('PASS: 无 pageerror；全程 AI 只走桩（除算素材那一发外零调用）', flush=True)
    finally:
        ctx.close()


print('\n全绿：档案「最终形式」列 → 素材两池来源 → 「还缺 N 项」反查 → 下一步出图读流派（七十改后现行口径：任务表已撤）', flush=True)
