# -*- coding: utf-8 -*-
"""🌿 日常浏览配置（2026-10-28 v2 起搬进队列页「🌿 日常浏览」右下角小三角 ▾ 的弹窗）跑一遍真扩展看一眼。
用法：python3 scripts/dev/check_daily_cfg_ui.py
出图：%TEMP%/xhs_daily_cfg_ui/{modal,dir-edit,after-save}.png
"""
import os
import pathlib
import sys
import time

from playwright.sync_api import sync_playwright
from _guide_gate import goto_big

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / 'extension'
OUT = pathlib.Path(os.environ.get('TEMP', '/tmp')) / 'xhs_daily_cfg_ui'
OUT.mkdir(parents=True, exist_ok=True)

SEED = r"""
() => new Promise(res => chrome.storage.local.set({
  daily_browse_config: { v: 1, enabled: true, perRound: 6, dwellMin: 8, dwellMax: 25,
    openRate: 60, likeRate: 25, collectRate: 12,
    directions: [
      { id: 'd1', name: '刷同行评论区', keywords: [], windows: [], dailyQuota: 10, weight: 2, enabled: true },
      { id: 'd2', name: '看本地笔记', keywords: ['深圳'], windows: [], dailyQuota: 6, weight: 1, enabled: true }
    ],
    autorun: { enabled: true, from: '09:00', to: '21:00' } }
}, () => res('ok')))
"""

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        str(OUT / 'profile'), headless=False, channel='msedge',
        viewport={'width': 1160, 'height': 900},
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    t0 = time.time()
    while time.time() - t0 < 20 and not ctx.service_workers:
        time.sleep(0.3)
    eid = ctx.service_workers[0].url.split('/')[2]
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    goto_big(pg, f'chrome-extension://{eid}/popup.html?mode=big&tabId=0')
    pg.wait_for_timeout(1500)
    # 新 profile 没配 AI 时会盖一层首启面板（挡住点击）→ 先关掉
    try:
        pg.wait_for_selector('#fsClose', timeout=3000)
        pg.click('#fsClose')
        pg.wait_for_timeout(200)
    except Exception:
        pass
    print('seed:', pg.evaluate(SEED))
    pg.click('#tabHuoke')
    pg.wait_for_timeout(300)
    pg.click('#tabQueue')
    pg.wait_for_timeout(700)

    # ① 小三角 ▾ 打开弹窗（不是按钮本体——本体是往队列里塞 3 趟）
    pg.click('#qDailyCfgTri')
    pg.wait_for_selector('#qBrowseModal.open #qDbOn', timeout=8000)
    pg.wait_for_timeout(400)
    for sel in ['#qDbOn', '#qDbStop', '#qDbAddDir', '#qDbAutoSave']:
        assert pg.locator(sel).count() == 1, '弹窗缺 ' + sel
    assert pg.locator('#qBrowseBody .dbr').count() == 2, '方向应有 2 行'
    assert pg.locator('#qBrowseBody [data-dbn="perRound"]').count() == 1, '缺「一轮几篇」旋钮'
    assert pg.locator('#qBrowseBody [data-dbn="comment.rate"]').count() == 1, '缺「顺手互动」旋钮'
    print('方向 =', pg.eval_on_selector_all('#qBrowseBody .dbr-name', 'e => e.map(x => x.innerText.trim())'))
    pg.screenshot(path=str(OUT / 'modal.png'))

    # ② ✎ 改方向：表单里五个口 + 合法校验；改日配额 6→9 保存后本地存到 9
    pg.locator('#qBrowseBody [data-db-edit="d2"]').click()
    pg.wait_for_selector('#qBrowseBody .dbed', timeout=5000)
    for f in ['name', 'kw', 'win', 'quota', 'weight']:
        assert pg.locator(f'#qBrowseBody [data-dbf="{f}"]').count() == 1, '编辑表单缺 ' + f
    pg.fill('#qBrowseBody [data-dbf="quota"]', '0')
    pg.click('#qBrowseBody [data-db-save="d2"]')
    pg.wait_for_timeout(300)
    assert '1 篇以上' in pg.inner_text('#qBrowseBody .dberr'), '日配额 0 该被拦下: ' + pg.inner_text('#qBrowseBody .dberr')
    pg.fill('#qBrowseBody [data-dbf="quota"]', '9')
    pg.screenshot(path=str(OUT / 'dir-edit.png'))
    pg.click('#qBrowseBody [data-db-save="d2"]')
    pg.wait_for_timeout(600)
    q = pg.evaluate("""() => new Promise(r => chrome.storage.local.get('daily_browse_config', d => r(
      ((d.daily_browse_config||{}).directions||[]).map(x => [x.name, x.dailyQuota]))))""")
    print('存下的方向 =', q)
    assert ['看本地笔记', 9] in q, '日配额没存进去: %s' % (q,)

    # ③ 旋钮改了就存（不刷新页面）
    pg.fill('#qBrowseBody [data-dbn="perRound"]', '4')
    pg.dispatch_event('#qBrowseBody [data-dbn="perRound"]', 'change')
    pg.wait_for_timeout(500)
    pr = pg.evaluate("() => new Promise(r => chrome.storage.local.get('daily_browse_config', d => r((d.daily_browse_config||{}).perRound)))")
    print('perRound =', pr)
    assert pr == 4, '旋钮没写回: %r' % (pr,)

    # ④ 每天自动开跑：改时段后保存，回读
    pg.fill('#qmFrom', '10:30')
    pg.fill('#qmTo', '20:00')
    pg.click('#qDbAutoSave')
    pg.wait_for_timeout(500)
    au = pg.evaluate("() => new Promise(r => chrome.storage.local.get('daily_browse_config', d => r((d.daily_browse_config||{}).autorun)))")
    print('autorun =', au)
    assert au.get('from') == '10:30' and au.get('to') == '20:00', '自动开跑时段没存: %s' % (au,)
    pg.screenshot(path=str(OUT / 'after-save.png'))

    # ⑤ 关掉弹窗回队列，页面上不该有报错
    pg.click('#qBrowseClose')
    pg.wait_for_timeout(300)
    assert pg.locator('#qBrowseModal.open').count() == 0, '弹窗没关掉'
    assert pg.locator('#queueBody').is_visible(), '关掉弹窗后没回到队列'
    assert not errs, '页面报错: ' + ' | '.join(errs)
    print('出图:', OUT)
    print('OK 日常浏览配置弹窗：开关 / 方向编辑（含拦截）/ 旋钮即改即存 / 每天自动开跑 全通过')
    ctx.close()
