# -*- coding: utf-8 -*-
"""写文案页「← 笔记档案」回退 + 有改动才询问保存 自检（老板 2026-10-01 五十二改第 1 批）。

口径：
  1) 写文案页顶有「← 笔记档案」，随时回得去；
  2) 点「← 笔记档案」回退时先看有没有没落档的改动——没有就直接走，不拦人；
  3) 有改动才问：存进这一档 / 不存直接回 / 留下继续改；问的时候人还留在写文案页；
     走左栏别的页不拦（这半篇留在台上，写文案页不重渲染，没丢）；
  4) 判「有没有改动」按落档内容比（走到第几步不算），存过之后重新取基线，所以同一笔不重复问；
  5) 从档案灌回来的那一篇，进页即算干净（不改就直接回，不该弹问）；
  6) 已有正文的那一篇，手改后立刻切页仍要回写到同一档（延时回写没被新加的挡问打断）。

跑法：python3 scripts/dev/check_wiz_back.py
临时 profile 里加载真扩展（msedge），全程不烧 AI（只走 ① 选卖点这一段）。
"""
import pathlib
import shutil
import sys
import time

from playwright.sync_api import expect, sync_playwright
from _guide_gate import goto_big

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / 'extension'
OUT = pathlib.Path(str(pathlib.Path.home() / 'AppData' / 'Local' / 'Temp'))
OUT.mkdir(parents=True, exist_ok=True)
ERRORS = []

EDITED = '手改过的正文：这一句要落到档案。'

SEED = r'''async () => {
    await Storage.initializeDefaults(DEFAULT_PROMPTS);
    await ensureTenantInit();
    const cfg = await Storage.getConfig();
    cfg.product.name = '回退测试产品';
    cfg.product.sellPoints = [
        { title: '省时间', content: '把重复步骤压掉' },
        { title: '不用想选题', content: '每天给一条现成话题' }];
    cfg.ai.apiKey = 'test-local-only';
    await Storage.setConfig(cfg);
    await chrome.storage.local.set({ np_notes: [] });
    return true;
}'''

NOTES = '() => chrome.storage.local.get("np_notes").then(d => (d.np_notes || []).map(n => ({id:n.id,status:n.status,title:n.title,hasWip:!!n.wip,draft:String(n.draft||"").slice(0,8)})))'


def boot(p):
    for i in range(5):
        prof = OUT / ('wizback-profile%d' % i)
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


def on_wizard(page):
    return page.evaluate('() => (document.getElementById("notePublishContent") || {}).offsetWidth > 0')


def on_archive(page):
    return page.evaluate('() => (document.getElementById("noteArchiveContent") || {}).offsetWidth > 0')


def asked(page):
    return page.evaluate('() => { const m = document.getElementById("npAskSave"); return !!m && m.style.display !== "none"; }')


def ask_text(page):
    return page.evaluate('() => (document.getElementById("npAskSaveTx") || {}).textContent || ""')


with sync_playwright() as p:
    ctx = boot(p)
    try:
        sw = ctx.service_workers[0]
        assert sw.evaluate('chrome.runtime.onMessage.hasListeners()'), '后台路由没注册上'
        sw.evaluate(SEED)

        page = ctx.new_page()
        page.on('pageerror', lambda e: ERRORS.append(str(e)[:200]))
        page.set_viewport_size({'width': 1160, 'height': 900})
        goto_big(page, sw.url.replace('background.js', 'popup.html?mode=big'))
        page.wait_for_function('typeof switchMainTab === "function" && typeof npWizSig === "function"')
        page.wait_for_timeout(500)

        # ── 1) 进写文案：页顶该有「← 笔记档案」 ──
        page.evaluate('() => switchMainTab("notePublish", "new")')
        page.wait_for_function('() => !!document.querySelector(".np-spk")', timeout=20000)
        expect(page.locator('.np-wiz-back')).to_be_visible()
        print('PASS: 写文案页顶有「← 笔记档案」（%s）' % page.locator('.np-wiz-back').inner_text(), flush=True)

        # ── 2) 什么都没改：回退直接走，不问也不存档 ──
        page.locator('.np-wiz-back').click()
        page.wait_for_timeout(400)
        assert not asked(page), '没改动不该弹询问'
        assert on_archive(page), '没改动点回退该落在笔记档案'
        assert page.evaluate(NOTES) == [], '没改动不该凭空存出一档'
        print('PASS: 没改动 → 点「← 笔记档案」直接回，不问也不存档', flush=True)

        # ── 3) 选了卖点（半篇、从没落过档）：回退先问一句，页面不跳 ──
        page.evaluate('() => switchMainTab("notePublish", "new")')
        page.wait_for_function('() => !!document.querySelector(".np-spk")', timeout=20000)
        page.locator('.np-spk').first.check()
        assert page.evaluate('() => npWizDirty()') is True, '选了卖点该算有改动'
        page.locator('.np-wiz-back').click()
        page.wait_for_timeout(400)
        assert asked(page), '有改动点回退该问一句'
        assert on_wizard(page), '问的时候不该先把人甩出写文案页'
        assert '这半篇还没存' in ask_text(page), ask_text(page)
        print('PASS: 半篇没落过档 → 回退挡下并问：「%s」' % ask_text(page)[:22], flush=True)

        # 3b) 留下继续改：关问、还在这一页、不写档
        page.locator('.np-ask-stay').click()
        page.wait_for_timeout(300)
        assert not asked(page) and on_wizard(page), '「留下继续改」该关问并把人留在这一页'
        assert page.evaluate(NOTES) == [], '留下继续改不该顺手存档'
        print('PASS: 「留下继续改」＝关问、留在这一页、不写档', flush=True)

        # ── 4) 不存直接回：回档案不写档，同一笔不再问第二遍 ──
        page.locator('.np-wiz-back').click()
        page.wait_for_timeout(300)
        assert asked(page), '第二次回退还该问（上一笔只是留下）'
        page.locator('.np-ask-discard').click()
        page.wait_for_timeout(400)
        assert not asked(page) and on_archive(page), '「不存」该回档案'
        assert page.evaluate(NOTES) == [], '选了「不存」就不该写档'
        page.evaluate('() => switchMainTab("notePublish")')
        page.wait_for_timeout(300)
        assert on_wizard(page) and page.evaluate('() => !!document.querySelector(".np-spk:checked")'), \
            '不存＝不写档，这半篇还在台上（没让人白改）'
        page.locator('.np-wiz-back').click()
        page.wait_for_timeout(400)
        assert not asked(page) and on_archive(page), '同一笔已答过「不存」，不该再问一遍'
        print('PASS: 「不存，直接回档案」＝回档案不写档；这笔不再问第二遍（台上那半篇还留着）', flush=True)

        # ── 5) 存进这一档：档案里真多一条草稿，带续写用的 wip ──
        page.evaluate('() => switchMainTab("notePublish")')
        page.wait_for_timeout(300)
        page.locator('.np-spk').nth(1).check()          # 又改一笔 → 该重新问
        page.locator('.np-wiz-back').click()
        page.wait_for_timeout(300)
        assert asked(page), '又改了卖点，回退还该问'
        page.locator('.np-ask-save').click()
        page.wait_for_timeout(800)
        assert not asked(page) and on_archive(page), '「存进这一档」该回档案'
        notes = page.evaluate(NOTES)
        assert len(notes) == 1 and notes[0]['status'] == '草稿' and notes[0]['hasWip'], notes
        assert notes[0]['title'] == '省时间', '没成稿时标题退到选中的卖点：%s' % notes[0]
        ar_id = notes[0]['id']
        # 刚存这一笔该在档案里看得见（存完再跳，不能让列表渲染抢在写入前面）
        page.wait_for_timeout(400)
        expect(page.locator('.npar-next[data-id="%s"]' % ar_id)).to_be_visible(timeout=8000)
        print('PASS: 「存进这一档，再回档案」＝档案多一条草稿（%s / %s / 带 wip），回档案立刻看得见'
              % (ar_id, notes[0]['title']), flush=True)

        # ── 6) 从档案灌回来＝进页即干净：不改就直接回，不该弹问 ──
        page.locator('.npar-next[data-id="%s"]' % ar_id).click()
        page.wait_for_function('(id) => _npWiz && _npWiz.arId === id && _npWizSnap === npWizSig(_npWiz)',
                               arg=ar_id, timeout=20000)
        assert on_wizard(page), '档案那一行该把这一篇灌回写文案'
        assert page.evaluate('() => npWizDirty()') is False, '刚灌回来不该算有改动'
        page.locator('.np-wiz-back').click()
        page.wait_for_timeout(400)
        assert not asked(page) and on_archive(page), '没改就直接回，不该问'
        assert len(page.evaluate(NOTES)) == 1, '直接回不该另起一档'
        print('PASS: 从档案进写文案、没改就回退 → 不问、不多档（arId=%s）' % ar_id, flush=True)

        # ── 7) 已有正文的那一篇：手改后立刻切页，这一笔仍要回写同一档 ──
        page.evaluate('''async (arg) => {
            const d = await chrome.storage.local.get('np_notes');
            const list = d.np_notes || [];
            const i = list.findIndex(x => x.id === arg.id);
            if (i >= 0) { list[i].draft = arg.text; await chrome.storage.local.set({ np_notes: list }); }
        }''', {'id': ar_id, 'text': EDITED})
        page.locator('.npar-next[data-id="%s"]' % ar_id).click()
        page.wait_for_function('(id) => _npWiz && _npWiz.arId === id && _npWizSnap === npWizSig(_npWiz)',
                               arg=ar_id, timeout=20000)
        # ⑤ 默认摆「逐句」：全文框要先点一下「✍️ 全文手改」才出来
        page.wait_for_selector('#npWizBody .np-draft-mode', timeout=20000)
        page.locator('#npWizBody .np-draft-mode').click()
        page.wait_for_selector('#npResult', timeout=20000)
        page.locator('#npResult').fill(EDITED + '改过的。')
        page.evaluate('() => switchMainTab("noteArchive")')     # 打字后立刻切页：延时这一笔不能被吃掉
        page.wait_for_timeout(900)
        got = page.evaluate(NOTES)
        assert not asked(page), '手改的正文切页前该已回写，不该挡问'
        assert got[0]['draft'] == (EDITED + '改过的。')[:8], got
        print('PASS: 已有正文的手改 → 切页当场回写同一档（%s）' % got[0]['draft'], flush=True)

        # ── 8) 询问只管「← 笔记档案」这一颗：走别的页不拦 ──
        page.evaluate('() => switchMainTab("notePublish", "new")')
        page.wait_for_function('() => !!document.querySelector(".np-spk")', timeout=20000)
        page.locator('.np-spk').first.check()
        assert page.evaluate('() => npWizDirty()') is True, '选了卖点该算有改动'
        page.locator('#tabNoteAssets').click()
        page.wait_for_timeout(400)
        assert not asked(page), '走左栏别的页不该拦问（只有「← 笔记档案」那颗才问）'
        assert page.evaluate('() => (document.getElementById("noteAssetsContent") || {}).offsetWidth > 0'), \
            '没被挡下就该落在素材库'
        page.evaluate('() => switchMainTab("notePublish")')
        page.wait_for_timeout(300)
        assert on_wizard(page) and page.evaluate('() => !!document.querySelector(".np-spk:checked")'), \
            '绕出去再回来，这半篇该还在台上'
        print('PASS: 有改动时走别的页不拦（挡在 switchMainTab 会把左栏整条拦死），这半篇也没丢', flush=True)

        page.screenshot(path=str(OUT / 'xhs-wiz-back.png'))
        print('SHOT: %s' % (OUT / 'xhs-wiz-back.png'), flush=True)
        assert not ERRORS, '有 pageerror：%s' % ERRORS[:2]
        print('PASS: 无 pageerror', flush=True)
    finally:
        ctx.close()

print('\n全绿：写文案回退 + 有改动才询问保存', flush=True)
