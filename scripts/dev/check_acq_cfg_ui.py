"""获客·队列配置台自检（2026-11-04 那张测试问题报告改完后的界面）：
   1) 玩法排班＝五列（玩法 / 周几 / 评论策略 / 出词策略 / 今天），「每天挑几个」和「词」两列搬走了
   2) 关键词表四列（玩法 / 关键词 / 找词 / 每天挑几个），「多久跑一次」「从词池挑」已撤
   3) 顶上两行灰字（正在跑指路 + 今天/明天排几次）没了，底下那块改叫「📖 评论节奏」
   4) 出词策略点「改」就地写、存进 pbPlan[玩法].wordRule；词前勾框 →「🗑 批量移出」；全部词表 →「🗑 批量删除」
用法：python3 scripts/dev/check_acq_cfg_ui.py [输出目录]
输出：<目录>/acq-*.png
"""
import os
import pathlib
import sys
import tempfile

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = pathlib.Path(os.environ.get('XHS_ROOT') or '.').resolve()
EXT = ROOT / 'extension'
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'tmp' / 'ui-shots')
OUT.mkdir(parents=True, exist_ok=True)

fails = []
passed = [0]


def ok(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + ('' if cond else ' → ' + str(extra)[:260]))
    if cond:
        passed[0] += 1
    else:
        fails.append(name)


SEED = r"""
() => new Promise(res => {
  const t = (s) => ({ k: s, on: true, src: 'manual', types: { latest: true, pain: true } });
  const scan = {
    v: 9, city: '深圳',
    keywords: [t('深圳 周末带娃'), t('深圳 美术班'), { k: '求推荐 美术班', on: true, src: 'ai', types: { pain: true } }],
    pbPlan: {
      latest: { days: [1, 2, 3, 4, 5], perDay: 2 },
      pain: { days: [2, 4], perDay: 2 },
      local: { days: [], perDay: 3 },
      highv: { days: [3], perDay: 1 },
    },
    accounts: [],
  };
  chrome.storage.local.set({ drain_scan_cfg: scan, drain_queue: { v: 1, running: null, carry: [], manual: [], dailyPlan: [], done: [] } }, () => res('ok'));
})
"""

GET_CFG = '() => new Promise(r => chrome.storage.local.get("drain_scan_cfg", d => r(d.drain_scan_cfg || {})))'
PB_NAMES = "['highv','top','pain','latest','local','cross']"


def dismiss(page):
    try:
        page.evaluate('() => { const b = document.getElementById("fsClose"); if (b) b.click(); }')
    except Exception:
        pass


with tempfile.TemporaryDirectory(prefix='xhs-acqcfg-') as profile, sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        profile, headless=False, channel='msedge',
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    errs = []
    try:
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
        page = ctx.new_page()
        page.on('pageerror', lambda e: errs.append(str(e)[:300]))
        page.goto(sw.url.replace('background.js', 'popup.html?mode=big'))
        page.wait_for_function('typeof switchMainTab === "function"')
        page.set_viewport_size({'width': 1180, 'height': 940})
        print('seed:', page.evaluate(SEED))
        dismiss(page)
        page.evaluate('switchMainTab("queue")')
        page.wait_for_function('() => document.querySelectorAll("#drainCfgContent .pbp-table tbody tr.pbp-tr").length === 6')
        dismiss(page)

        # ── 1) 排班表：五列、六行、没有「每天挑几个 / 词 / 多久跑一次」这三样 ──
        pb_head = [c.strip() for c in page.evaluate(
            '''() => [...document.querySelectorAll('#drainCfgContent .pbp-table thead th')].map(t => t.innerText.trim())''')]
        ok('排班表是五列：玩法/周几/评论策略/出词策略/今天',
           pb_head == ['玩法', '周几跑（点一下切换）', '评论策略（怎么说话）', '出词策略（找词按这句）', '今天'], pb_head)
        ok('排班表六行（六个玩法）', page.locator('#drainCfgContent .pbp-table tbody tr.pbp-tr').count() == 6)
        ok('排班表里不再摆「每天挑几个」那个框', page.locator('#drainCfgContent .pbp-table [data-pbper]').count() == 0)
        ok('排班表里不再摊词', page.locator('#drainCfgContent .pbp-table .kwp-chip').count() == 0)
        ok('大V 那格写「不出词」', '不出词' in page.locator('#drainCfgContent .pbp-table tbody tr').first.inner_text())

        # ── 2) 关键词表：四列、找词在末列、每行带「每天 N 个」 ──
        kw_head = [c.strip() for c in page.evaluate(
            '''() => [...document.querySelectorAll('#drainCfgContent .kwp-table thead th')].map(t => t.innerText.trim())''')]
        ok('关键词表是四列：玩法/关键词/找词/每天挑几个',
           kw_head == ['玩法', '关键词', '找词', '每天挑几个'], kw_head)
        ok('每个玩法一行找词按钮', page.locator('#drainCfgContent [data-kwai]').count() == 5,
           page.locator('#drainCfgContent [data-kwai]').count())
        ok('每行一个「每天 N 个」输入框', page.locator('#drainCfgContent [data-pbper]').count() == 5)
        ok('「多久跑一次」整列撤了', page.locator('#drainCfgContent select').count() == 0)
        ok('「从词池挑」按钮撤了', page.evaluate("() => !/从词池挑/.test(document.querySelector('#drainCfgContent').innerText)"))
        page.locator('#drainCfgContent .kwp-table').first.screenshot(path=str(OUT / 'acq-keywords.png'))

        # ── 3) 顶上两行灰字撤了，底下那块改叫「📖 评论节奏」 ──
        ok('没有「正在跑」指路行', page.locator('#drainCfgContent [data-pbjump], #sxRunPtr').count() == 0)
        ok('没有今天/明天排几次的后果预览行', page.locator('#sxFcLine').count() == 0)
        ok('底下那块是「📖 评论节奏」', '评论节奏' in page.locator('#qStratWrap > summary').inner_text())

        # ── 4) 出词策略：点「改」就地写一句，存进 pbPlan.local.wordRule ──
        page.click('[data-wredit="local"]')
        page.wait_for_selector('#talkedit-local.open [data-writext="local"]')
        page.fill('[data-writext="local"]', '只出「深圳 + 画室 / 美术班」两段词，一个都不带机构名')
        page.click('[data-wrsave="local"]')
        page.wait_for_timeout(900)
        cfg = page.evaluate(GET_CFG)
        ok('出词策略存进了这个玩法',
           cfg.get('pbPlan', {}).get('local', {}).get('wordRule') == '只出「深圳 + 画室 / 美术班」两段词，一个都不带机构名',
           cfg.get('pbPlan', {}).get('local', {}))
        ok('格子里挂了「自己写的」牌子',
           page.locator('[data-wrbox="local"] .pbp-wrsrc.own').count() == 1)
        page.screenshot(path=str(OUT / 'acq-wordrule.png'))

        # 内置那句还看得见（没写自己的玩法显示内置口径）
        ok('没写的玩法显示内置那句', '内置' in page.locator('[data-wrbox="latest"]').inner_text(),
           page.locator('[data-wrbox="latest"]').inner_text()[:80])

        # ── 5) 批量移出：勾「本地泛搜」那两个词 → 一次移出，词还在池、咨询帖那行不动 ──
        was_latest = [e['k'] for e in page.evaluate(GET_CFG)['keywords'] if e['types'].get('latest')]
        ok('移出前挂在「本地泛搜」的是两个词', len(was_latest) == 2, was_latest)
        page.locator('#row-latest [data-kwsel]').first.click()
        page.locator('#row-latest [data-kwsel]').nth(1).click()
        page.wait_for_timeout(250)
        btn = page.locator('[data-kwbatchdel="latest"]')
        ok('勾两个词后按钮上写了（2）', '（2）' in btn.inner_text(), btn.inner_text())
        btn.click()
        page.wait_for_timeout(1200)
        cfg = page.evaluate(GET_CFG)
        # 只看原来挂在那一行的词：都该被摘掉 latest
        moved = [e for e in cfg['keywords'] if e['k'] in was_latest]
        ok('两个词从「本地泛搜」移出',
           len(moved) == 2 and all(not e['types'].get('latest') for e in moved),
           [e['types'] for e in moved])
        ok('移出的词还在池里、别的玩法没动',
           all(e['types'].get('pain') for e in moved) and len(cfg['keywords']) == 3,
           [e['types'] for e in moved])
        page.screenshot(path=str(OUT / 'acq-after-batchout.png'))

        # ── 6) 批量删除：全部词表里勾两个 → 真删，池子剩一个 ──
        page.evaluate('() => { document.querySelector("#drainCfgContent details.kwp-all").open = true; }')
        page.wait_for_timeout(300)
        page.locator('[data-poolsel]').first.click()
        page.locator('[data-poolsel]').nth(1).click()
        page.wait_for_timeout(250)
        delbtn = page.locator('#sxPoolBatchDel')
        ok('批量删除按钮上写了（2）', '（2）' in delbtn.inner_text(), delbtn.inner_text())
        delbtn.click()
        page.wait_for_timeout(1400)
        cfg = page.evaluate(GET_CFG)
        ok('词池真少了两个', len(cfg['keywords']) == 1, [e['k'] for e in cfg['keywords']])

        # ── 7) 一个玩法都没挂的词，单独列一行出来 ──
        page.evaluate("""() => new Promise(r => {
          const c = { v: 9, city: '深圳', keywords: [{ k: '孤立词', on: true, src: 'manual', types: { latest: false, top: false, pain: false, local: false, cross: false } }],
            pbPlan: { latest: { days: [1, 2, 3, 4, 5], perDay: 2 } }, accounts: [] };
          chrome.storage.local.set({ drain_scan_cfg: c }, r);
        })""")
        page.evaluate('switchMainTab("huoke")')
        page.wait_for_timeout(300)
        page.evaluate('switchMainTab("queue")')
        page.wait_for_timeout(1500)
        ok('一个玩法都没挂的词单独列一行', page.locator('#row-orphan').count() == 1,
           page.evaluate("() => document.querySelector('#drainCfgContent') ? document.querySelector('#drainCfgContent').innerText.slice(0,120) : '配置页没画出来'"))
        page.screenshot(path=str(OUT / 'acq-config.png'))

        # ── 8) 周几那颗照旧能点（点今天 → 从排班去掉、今天那格改口） ──
        wd = page.evaluate('() => new Date().getDay() || 7')
        page.evaluate("""() => new Promise(r => {
          const c = { v: 9, city: '深圳', keywords: [{ k: '深圳 周末带娃', on: true, src: 'manual', types: { latest: true } }],
            pbPlan: { latest: { days: [1, 2, 3, 4, 5], perDay: 2 } }, accounts: [] };
          chrome.storage.local.set({ drain_scan_cfg: c }, r);
        })""")
        page.evaluate('switchMainTab("huoke")')
        page.wait_for_timeout(300)
        page.evaluate('switchMainTab("queue")')
        page.wait_for_timeout(1200)
        before = page.evaluate(GET_CFG)
        row = '[data-pbday="latest|%d"] >> xpath=ancestor::tr[1]' % wd
        ok('今天原本排在排班里', wd in before['pbPlan']['latest']['days'], before['pbPlan']['latest'])
        ok('今天那格先写「今天跑」', '今天跑' in page.locator(row).inner_text(), page.locator(row).inner_text()[:80])
        page.click('[data-pbday="latest|%d"]' % wd)
        page.wait_for_timeout(1000)
        after = page.evaluate(GET_CFG)
        ok('点今天那个周几就把它从排班里去掉', wd not in (after['pbPlan']['latest'].get('days') or []),
           after['pbPlan']['latest'])
        ok('「今天」那格跟着改成今天不跑', '今天不跑' in page.locator(row).inner_text(), page.locator(row).inner_text()[:80])
        page.screenshot(path=str(OUT / 'acq-days-off.png'))
    finally:
        print('pageerror =', errs or 'none')
        ctx.close()

print('')
if errs:
    print('有脚本报错：', errs)
if fails:
    print('有 ' + str(len(fails)) + ' 项没过：' + '、'.join(fails))
else:
    print('全部通过（%d 项）' % passed[0])
print('输出目录：', OUT)
sys.exit(1 if (fails or errs) else 0)
