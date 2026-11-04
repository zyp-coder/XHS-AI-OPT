"""获客·队列 v2 自检：一屏队列 + 右上三按钮 + 两个弹窗 + 词卡 ⚙️ 就地改 + 批量页七天条。
用法：python3 scripts/dev/check_queue_v2_ui.py [输出目录]
输出：<目录>/v2-*.png
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

SEED = r"""
() => new Promise(res => {
  const now = Date.now(), H = 3600000;
  const scan = {
    v: 5, city: '深圳',
    typeRun: { latest: { mode: 'each' }, top: { mode: 'interval', hours: 6 },
      local: { mode: 'interval', hours: 6 }, pain: { mode: 'interval', hours: 6 }, rival: { mode: 'off' } },
    acctRun: { highv: { mode: 'interval', hours: 12 }, rival: { mode: 'interval', hours: 12 } },
    kwRuns: { '房贷计算': { top: now - 8 * H, local: now - 3 * H, pain: now - 30 * 60000 } },
    keywords: [
      { k: '房贷计算', on: true, src: 'manual', batch: '默认', types: { latest: true, top: true, local: true, pain: true, rival: false } },
      { k: '提前还款划算吗', on: true, src: 'ai', batch: '默认', types: { latest: true, top: true, pain: true } }
    ],
    accounts: [
      { k: 'https://www.xiaohongshu.com/user/profile/5f1a2b3c0000000001007a1b?xsec_token=ABtok1', name: '房奴自救指南', on: true, scenario: 'highv' },
      { k: 'https://www.xiaohongshu.com/user/profile/6a2b3c4d0000000002008b2c?xsec_token=ABtok2', name: '深圳楼市观察', on: true, scenario: 'rival', hours: 8 }
    ]
  };
  const q = { v: 1, running: null, carry: [], manual: [], dailyPlan: [], done: [] };
  const db = { v: 1, cfg: { enabled: true, enabled2: true, directions: [
      { id: 'd1', name: '刷同行评论区', enabled: true, weight: 2, dailyQuota: 10, windows: [] },
      { id: 'd2', name: '看本地笔记', enabled: true, weight: 1, dailyQuota: 6, windows: [] }
    ], perRound: 6, autorun: { enabled: true, from: '09:00', to: '22:00' } }, daily: { count: 1, byDirection: {} } };
  chrome.storage.local.set({
    drain_scan_cfg: scan, drain_queue: q, daily_browse_config: db.cfg, daily_browse_daily: db.daily,
    auto_water_config: { schedule: { dailyMax: 30, perRound: 10 } },
    auto_water_daily: (() => { const d = {}; d[new Date().toISOString().slice(0, 10)] = 3; return d; })()
  }, () => res('ok'));
})
"""


def dismiss(page):
    try:
        page.evaluate('() => { const b = document.getElementById("fsClose"); if (b) b.click(); }')
    except Exception:
        pass


with tempfile.TemporaryDirectory(prefix='xhs-qv2-') as profile, sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        profile, headless=False, channel='msedge',
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    errs = []
    try:
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
        page = ctx.new_page()
        page.on('pageerror', lambda e: errs.append(str(e)[:300]))
        page.goto(sw.url.replace('background.js', 'popup.html?mode=big'))
        page.set_viewport_size({'width': 1160, 'height': 900})
        page.wait_for_function('typeof switchMainTab === "function"')
        print('seed:', page.evaluate(SEED))
        dismiss(page)
        page.evaluate('switchMainTab("queue")')
        page.wait_for_timeout(1200)
        dismiss(page)

        # ① 一屏队列：三段（待跑 / 计划 / 已完成）+ 右上三按钮
        for sel in ['#qAcctBtn', '#qDailyBtn', '#qDailyCfgTri', '#qBulkBtn', '#queueBody', '#botRunQuota']:
            assert page.locator(sel).count() == 1, '缺 ' + sel
        assert page.locator('#queueTabs').count() == 0, '横签没撤干净'
        print('head acts =', page.evaluate('''() => ['qAcctBtn','qDailyBtn','qDailyCfgTri','qBulkBtn']
          .map(id => (document.getElementById(id).innerText || '').replace(/\\s+/g,' ').trim())'''))
        page.screenshot(path=str(OUT / 'v2-queue.png'))

        # ② 👤 盯的账号：弹窗里能看到两个号（含单独节奏 8 小时）
        page.click('#qAcctBtn')
        page.wait_for_timeout(600)
        assert page.locator('#qAcctModal.open').count() == 1, '盯的账号弹窗没打开'
        rows = page.locator('#qAcctBody .acc-row').count()
        print('acct rows =', rows, '| text =', page.locator('#qAcctBody').inner_text().replace('\n', ' / ')[:160])
        assert rows == 2, '盯的账号应有 2 行'
        page.screenshot(path=str(OUT / 'v2-acct.png'))
        page.click('#qAcctClose')
        page.wait_for_timeout(300)

        # ③ ▾ 日常浏览配置：方向两行 + 右下角小三角打开
        page.click('#qDailyCfgTri')
        page.wait_for_timeout(600)
        assert page.locator('#qBrowseModal.open').count() == 1, '日常浏览弹窗没打开'
        drows = page.locator('#qBrowseBody .dbr').count()
        print('daily dirs =', drows)
        assert drows == 2, '日常浏览应有 2 个方向'
        page.screenshot(path=str(OUT / 'v2-daily.png'))
        page.click('#qBrowseClose')
        page.wait_for_timeout(300)

        # ④ 🌿 本体：塞 1 待跑 + 2 计划
        before = page.evaluate('() => new Promise(r => chrome.storage.local.get("drain_queue", d => r((d.drain_queue||{}).dailyPlan || [])))')
        print('dailyPlan before =', len(before))
        page.click('#qDailyBtn')
        page.wait_for_timeout(900)
        after = page.evaluate('() => new Promise(r => chrome.storage.local.get("drain_queue", d => r((d.drain_queue||{}).dailyPlan || [])))')
        print('dailyPlan after  =', [(x["label"], round((x["at"] - 0) / 60000)) for x in after])
        assert len(after) == 3, '点一下应塞 3 条（1 待跑 + 2 计划）'
        dcards = page.locator('#queueBody .q-item-daily').count()
        head0 = page.locator('#queueBody .q-sec').nth(0).inner_text().split('\n')[0]
        print('queue daily cards =', dcards, '| 第一段 =', head0)
        assert dcards == 3, '队列里应看到 3 张日常卡（1 待跑 + 2 计划）'
        page.screenshot(path=str(OUT / 'v2-after-insert.png'))

        # ⑤ 词卡 ⚙️ 就地改：勾掉/勾上一个类型
        page.locator('#queueBody .q-item:not(.q-item-daily) button.q-gear').first.click()
        page.wait_for_timeout(500)
        assert page.locator('#queueBody .inline-ed').count() >= 1, '就地编辑器没出来'
        page.screenshot(path=str(OUT / 'v2-inline-ed.png'))
        t0 = page.evaluate('''() => new Promise(r => chrome.storage.local.get("drain_scan_cfg", d => r(
          ((d.drain_scan_cfg||{}).keywords||[]).map(x => [x.k, Object.keys(x.types||{}).filter(t => x.types[t]).join(',')]))))''')
        page.locator('#queueBody .inline-ed .ty').first.click()
        page.wait_for_timeout(600)
        t1 = page.evaluate('''() => new Promise(r => chrome.storage.local.get("drain_scan_cfg", d => r(
          ((d.drain_scan_cfg||{}).keywords||[]).map(x => [x.k, Object.keys(x.types||{}).filter(t => x.types[t]).join(',')]))))''')
        print('types before =', t0)
        print('types after  =', t1)
        assert t0 != t1, '⚙️ 里点类型没有写回配置'

        # ⑥ ⚙️ 批量：七天条 + ← 回队列
        page.click('#qBulkBtn')
        page.wait_for_timeout(1200)
        assert page.locator('#drainCfgContent .week').count() == 1, '批量页没有七天条'
        caps = page.evaluate('''() => [...document.querySelectorAll('#drainCfgContent .wk-cell')]
          .map(c => c.innerText.replace(/\\s+/g, ' ').trim())''')
        print('week =', caps)
        assert len(caps) == 7, '七天条应有 7 格'
        assert page.locator('#drainCfgContent [data-cfgsec="daily"]').count() == 0, '批量页不该再有日常浏览卡'
        assert page.locator('#drainCfgContent [data-poolbatch]').count() == 0, '行末批次下拉没撤干净'
        page.screenshot(path=str(OUT / 'v2-bulk.png'))
        page.click('#cfgToQueue')
        page.wait_for_timeout(600)
        assert page.locator('#queueBody').is_visible(), '「← 回队列」没回到队列'
        page.screenshot(path=str(OUT / 'v2-back.png'))
    finally:
        print('pageerror =', errs or 'none')
        ctx.close()
print('输出目录：', OUT)
