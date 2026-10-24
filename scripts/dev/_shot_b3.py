# -*- coding: utf-8 -*-
"""批次3（获客其余页）问号气泡：铺页面 + 悬停 + 顺带量一下有没有被容器裁掉。
出图：%TEMP%/xhs_b3/*.png
用法：python3 scripts/dev/_shot_b3.py
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
OUT = pathlib.Path(os.environ.get('TEMP', '/tmp')) / 'xhs_b3'
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


with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        str(OUT / 'profile'), headless=False, channel='msedge',
        viewport={'width': 1160, 'height': 900},
        args=['--disable-extensions-except=' + str(EXT), '--load-extension=' + str(EXT)])
    t0 = time.time()
    while time.time() - t0 < 20 and not ctx.service_workers:
        time.sleep(0.3)
    eid = ctx.service_workers[0].url.split('/')[2]
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

    print('== 左栏关键词折叠块的图例 ==')
    pg.wait_for_selector('#kwBar', timeout=8000)
    pg.click('#kwBar > summary')
    pg.wait_for_selector('#kwHint .qhelp', timeout=8000)
    pg.wait_for_timeout(300)
    print('  可见文案:', pg.inner_text('#kwHint'))
    hover_probe_shot(pg, '#kwHint .qhelp', 'kwHint', 'kw')

    print('== 队列页顶栏额度概览 ==')
    pg.click('#tabHuoke')
    pg.wait_for_timeout(300)
    pg.click('#tabQueue')
    pg.wait_for_selector('#queueCaps .qhelp', timeout=10000)
    pg.wait_for_timeout(400)
    print('  可见文案:', pg.inner_text('#queueCaps').replace('\n', ' | '))
    hover_probe_shot(pg, '#queueCaps .qhelp', 'queueCaps', 'queuecaps')

    print('== 「塞一轮日常流程」弹窗 ==')
    if pg.is_visible('#qAddDailyBtn'):
        pg.click('#qAddDailyBtn')
        pg.wait_for_selector('#qAddDailyPop .qhelp', timeout=5000)
        pg.wait_for_timeout(300)
        print('  弹窗文案:', pg.inner_text('#qAddDailyPop').replace('\n', ' | '))
        hover_probe_shot(pg, '#qAddDailyPop .qhelp', 'addDaily', 'adddaily')
        pg.click('#qAddDailyBtn')
    else:
        print('  ! 按钮不可见，跳过')
        bad.append('qAddDailyBtn 不可见')

    print('== 配置三张卡：卡头与各节说明的问号 ==')
    # 任务配置已并进「队列 → ⚙️ 配置」，三张卡点卡头展开（2026-10-24）
    pg.click('#tabQueue')
    pg.wait_for_timeout(500)
    pg.click('#queueTabs .q-tab[data-qtab="config"]')
    pg.wait_for_selector('#drainCfgContent details.cfgcard', timeout=10000)
    pg.wait_for_timeout(600)
    for sec, label in [('run', '跑什么'), ('daily', '日常浏览'), ('goal', '推广目标')]:
        pg.click('#drainCfgContent details.cfgcard[data-cfgsec="%s"] > summary' % sec)
        pg.wait_for_selector('#sxScanCfgPanel .qhelp', timeout=8000)
        pg.wait_for_timeout(400)
        n = pg.eval_on_selector_all('#sxScanCfgPanel .qhelp', 'els => els.length')
        print('  %s 卡问号数: %d' % (label, n))
        hover_probe_shot(pg, '#sxScanCfgPanel .qhelp', 'cfg-' + label, 'cfg-' + sec)
    kept = pg.eval_on_selector_all('#sxScanCfgPanel .sx-hint',
                                   'els => els.map(e => e.textContent.trim()).filter(Boolean)')
    print('  面板上还常显的说明行:', kept)
    for n in ['盯人走', '一行一个词', '只定']:
        if any(n in k for k in kept):
            bad.append('说明本该收进问号: ' + n)

    print('== 补开设置弹窗（笔记池顶栏）==')
    # 补开的两颗按钮 2026-10-24 从任务配置顶栏搬到了笔记池顶栏
    pg.click('#tabPool')
    pg.wait_for_selector('#drainContent #replCfgBtn', timeout=10000)
    pg.wait_for_timeout(600)
    pg.click('#drainContent #replCfgBtn')
    pg.wait_for_selector('#replPop .qhelp', timeout=5000)
    pg.wait_for_timeout(300)
    print('  弹窗文案:', pg.inner_text('#replPop').replace('\n', ' | '))
    for i, name in [(0, 'repl-check'), (1, 'repl-threshold')]:
        hover_probe_shot(pg, '#replPop .qhelp', name, name, nth=i)

    print('页面错误:', errs)
    print('裁切/缺失:', bad)
    ctx.close()
