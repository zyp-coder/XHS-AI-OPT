# -*- coding: utf-8 -*-
"""批次4（线索 + 发笔记）问号气泡：铺页面 + 悬停 + 顺带量一下有没有被容器裁掉。
出图：%TEMP%/xhs_b4/*.png
用法：python3 scripts/dev/_shot_b4.py
"""
import os
import pathlib
import sys
import time

from playwright.sync_api import sync_playwright

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / 'extension'
OUT = pathlib.Path(os.environ.get('TEMP', '/tmp')) / 'xhs_b4'
OUT.mkdir(parents=True, exist_ok=True)

# 量气泡有没有把最近的裁切祖先撑出横向滚动（气泡是绝对定位，仍会计入 scrollWidth）
PROBE = """(el) => {
  let n = el.parentElement, clip = null;
  while (n && n !== document.documentElement) {
    const st = getComputedStyle(n);
    if (st.overflowX !== 'visible' || st.overflowY !== 'visible') { clip = n; break; }
    n = n.parentElement;
  }
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.left), y: Math.round(r.top),
    clip: clip ? (clip.id || clip.className || clip.tagName) : null,
    sw: clip ? clip.scrollWidth : null, cw: clip ? clip.clientWidth : null
  };
}"""

bad = []


def hover_probe_shot(pg, sel, label, name, nth=0):
    loc = pg.locator(sel)
    tgt = None
    seen = 0
    for i in range(loc.count()):
        if not loc.nth(i).is_visible():
            continue
        if seen == nth:
            tgt = loc.nth(i)
            break
        seen += 1
    if tgt is None:
        print('  [%s] (%s) 没有第 %d 个可见的问号' % (label, sel, nth))
        bad.append(label + ' 找不到可见 ?')
        return
    tgt.scroll_into_view_if_needed()
    tgt.hover()
    pg.wait_for_timeout(350)
    d = tgt.evaluate(PROBE)
    ok = (d.get('sw') is None) or (d['sw'] <= d['cw'])
    print('  [%s] %s %s' % (label, d, 'OK' if ok else '<<< 裁切'))
    if not ok:
        bad.append(label + ' ' + str(d))
    pg.screenshot(path=str(OUT / (name + '.png')))
    print('  ->', name + '.png')


SEED = r'''async (payload) => {
    await Storage.initializeDefaults(DEFAULT_PROMPTS);
    await ensureTenantInit();
    // 维护过卖点，① 才走「直接列出」那条路（否则会去打 AI 提炼，那气泡也不出现）
    const config = await Storage.getConfig();
    config.product.name = '流程测试产品';
    config.product.sellPoints = [{ title: '省时间', content: '简化重复步骤' }];
    config.ai.apiKey = 'test-local-only';
    await Storage.setConfig(config);
    await Storage.saveProspectList(payload.prospects);
    await chrome.storage.local.set({ chat_follow_state: { conversations: payload.convs, lastSyncAt: Date.now() } });
    return 1;
}'''

PROSPECTS = [
    {   # 通知页：评论来的线索
        'id': 'p1', 'userId': 'u_test_1', 'nickname': '小美同学',
        'stage': 'lead', 'status': '待触达', 'origin': '评论',
        'source': {'stageEntry': '评论', 'channel': '评论', 'noteTitle': '装修避坑指南'},
        'affinity': {'intentLevel': 'high'},
        'lead': {'signalCount': 1, 'signals': [], 'lastSignalAt': 1758000000000},
        'lastSignalAt': 1758000000000, 'lastActiveAt': 1758000000000,
        'channel': '评论', 'message': '我家也遇到这个问题，怎么弄的？',
    },
    {   # 通知页：商机（已接触）
        'id': 'p2', 'userId': 'u_test_2', 'nickname': '老王聊装修',
        'stage': 'prospect', 'status': '谈单中', 'origin': '评论',
        'source': {'stageEntry': '评论', 'channel': '评论', 'noteTitle': '装修避坑指南'},
        'affinity': {'intentLevel': 'high'},
        'funnel': {'step': 'talking', 'dmCount': 3, 'lastDmAt': 1758000000000},
        'direction': 'inbound', 'inbound': True, 'convId': 'c_test_2',
        'lastSignalAt': 1758000000000, 'lastActiveAt': 1758000000000,
        'channel': '评论', 'message': '报价发我看看',
    },
]

CONVS = {
    'u_test_2': {
        'userId': 'u_test_2', 'userName': '老王聊装修', 'needReply': True,
        'pendingIncoming': '报价发我看看', 'pendingIdx': 1, 'turnCount': 3,
        'stale': False, 'sold': False, 'lastIncomingAt': 1758000000000,
    },
}

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        str(OUT / 'profile'), headless=False, channel='msedge',
        viewport={'width': 1160, 'height': 900},
        ignore_default_args=['--disable-extensions'],
        args=['--disable-extensions-except=' + str(EXT), '--load-extension=' + str(EXT)])
    t0 = time.time()
    while time.time() - t0 < 25 and not ctx.service_workers:
        time.sleep(0.3)
    sw = ctx.service_workers[0]
    sw.evaluate(SEED, {'prospects': PROSPECTS, 'convs': CONVS})
    eid = sw.url.split('/')[2]
    print('扩展 ID =', eid)

    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('chrome-extension://%s/popup.html?mode=big&tabId=0' % eid)
    pg.wait_for_timeout(1500)
    try:
        pg.wait_for_selector('#fsClose', timeout=3000)
        pg.click('#fsClose')
        pg.wait_for_timeout(200)
    except Exception:
        pass

    print('== 线索 · 通知 ==')
    pg.click('#tabProspect')
    pg.wait_for_timeout(300)
    pg.click('#tabLeadNotif')
    pg.wait_for_selector('#chatqBlock', timeout=10000)
    pg.wait_for_timeout(600)
    print('  待回区块文案:', pg.inner_text('#chatqBlock').replace('\n', ' | ')[:200])
    hover_probe_shot(pg, '#chatqBlock .qhelp', 'chatq', 'chatq')
    print('  通知页文案:', pg.inner_text('#prospectContent').replace('\n', ' | ')[:220])
    if pg.locator('.pl-toggle').count():
        pg.locator('.pl-toggle').first.click()   # ▸ 展开详情，里面才有「下一步」那行
        pg.wait_for_timeout(300)
    hover_probe_shot(pg, '.pl-hint .qhelp', 'pl-hint', 'pl-hint')

    print('== 线索 · 消息 ==')
    pg.click('#tabLeadMsg')
    pg.wait_for_timeout(600)

    print('== 发笔记 · 写一篇 ① 卖点 ==')
    pg.click('#tabNotePublish')
    pg.wait_for_selector('#notePublishContent .qhelp', timeout=10000)
    pg.wait_for_timeout(500)
    print('  ① 页文案:', pg.inner_text('#notePublishContent').replace('\n', ' | ')[:120])
    hover_probe_shot(pg, '#notePublishContent .qhelp', 'np-sell', 'np-sell', nth=0)
    hover_probe_shot(pg, '#notePublishContent .qhelp', 'np-kb', 'np-kb', nth=1)

    print('== 发笔记 · 素材库 / 笔记档案 ==')
    pg.click('#tabNoteAssets')
    pg.wait_for_selector('#noteAssetsContent .qhelp', timeout=10000)
    pg.wait_for_timeout(500)
    print('  素材库页头:', pg.inner_text('#noteAssetsContent').replace('\n', ' | ')[:120])
    hover_probe_shot(pg, '#noteAssetsContent .qhelp', 'assets-head', 'assets')
    pg.click('#tabNoteArchive')
    pg.wait_for_selector('#noteArchiveContent .qhelp', timeout=10000)
    pg.wait_for_timeout(500)
    print('  档案页头:', pg.inner_text('#noteArchiveContent').replace('\n', ' | ')[:120])
    hover_probe_shot(pg, '#noteArchiveContent .qhelp', 'archive-head', 'archive')

    print('== 出片台整页（video.html 独立开）==')
    vp = ctx.new_page()
    verrs = []
    vp.on('pageerror', lambda e: verrs.append(str(e)))
    vp.goto('chrome-extension://%s/video.html' % eid)
    vp.wait_for_selector('#filmTabs .ftab', timeout=10000)
    vp.wait_for_timeout(1200)
    hover_probe_shot(vp, 'header .qhelp', 'film-head', 'film-head')
    hover_probe_shot(vp, '#filmTabs .ftab[data-sec="script"] .qhelp', 'film-tab1', 'film-tab1')
    hover_probe_shot(vp, '#filmTabs .ftab[data-sec="voice"] .qhelp', 'film-tab3', 'film-tab3')
    hover_probe_shot(vp, '#filmTabs .ftab[data-sec="card"] .qhelp', 'film-tab5', 'film-tab5')
    print('  出片台页脚可见文案:', vp.inner_text('#cardBody').replace('\n', ' | ')[:160] if vp.locator('#cardBody').count() else '(无)')

    print('== 首次设置向导（wizard.html 独立开，自带深色主题的问号样式）==')
    wp = ctx.new_page()
    werrs = []
    wp.on('pageerror', lambda e: werrs.append(str(e)))
    wp.goto('chrome-extension://%s/wizard.html' % eid)
    wp.wait_for_selector('#page1 h2 .qhelp', timeout=10000)
    wp.wait_for_timeout(600)
    hover_probe_shot(wp, '#page1 h2 .qhelp', 'wiz-step1', 'wiz-step1')
    hover_probe_shot(wp, '#page1 .col:nth-child(1) .qhelp', 'wiz-restore', 'wiz-restore')
    hover_probe_shot(wp, '#page1 .col:nth-child(2) .qhelp', 'wiz-ai', 'wiz-ai')
    wp.evaluate('() => document.getElementById("page2").classList.remove("hidden")')
    wp.wait_for_timeout(200)
    hover_probe_shot(wp, '#page2 h2 .qhelp', 'wiz-step2', 'wiz-step2')

    print('页面错误:', errs, verrs, werrs)
    print('裁切/缺失:', bad)
    ctx.close()
