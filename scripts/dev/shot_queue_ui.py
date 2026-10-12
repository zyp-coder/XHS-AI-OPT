"""队列页看样：造一批假队列数据（词池 + 盯的账号 + 已完成记录），
截图看卡片样式与高度（三十一改起一项一张卡；老版的 5 列表格 + 来源组折叠已撤）。

用法：python3 scripts/dev/shot_queue_ui.py [输出目录]
输出：<目录>/queue-collapsed.png / queue-expanded.png / queue-narrow.png
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
    v: 4, city: '深圳', painWords: ['求推荐', '听劝'],
    typeRun: { latest: { mode: 'each' }, top: { mode: 'interval', hours: 6 },
      local: { mode: 'interval', hours: 6 }, pain: { mode: 'interval', hours: 6 }, rival: { mode: 'off' } },
    acctRun: { highv: { mode: 'interval', hours: 12 }, rival: { mode: 'interval', hours: 12 } },
    kwRuns: {
      '房贷计算': { top: now - 8 * H, local: now - 3 * H, pain: now - 30 * 60000 },
      '提前还款划算吗': { latest: now - 22 * 60000, top: now - 2 * H, pain: now - 26 * H }
    },
    keywords: [
      { k: '房贷计算', on: true, src: 'manual', types: { latest: true, top: true, local: true, pain: true, rival: false } },
      { k: '提前还款划算吗', on: true, src: 'ai', types: { latest: true, top: true, local: true, pain: true, rival: false } },
      { k: '公积金贷款额度', on: true, src: 'topic', types: { latest: true, top: true, local: false, pain: true, rival: false } },
      { k: '装修报价', on: true, src: 'topic', types: { latest: true, top: true, local: true, pain: false, rival: false } }
    ],
    accounts: [
      { k: 'https://www.xiaohongshu.com/user/profile/5f1a2b3c0000000001007a1b?xsec_token=ABtok1', name: '房奴自救指南', on: true, scenario: 'highv' },
      { k: 'https://www.xiaohongshu.com/user/profile/6a2b3c4d0000000002008b2c?xsec_token=ABtok2', name: '深圳楼市观察', on: true, scenario: 'rival' }
    ]
  };
  const q = { v: 1, running: null, carry: [
      { k: '装修报价', scenario: 'top', at: now - 2 * H, note: '上一轮还剩 2 篇没跑' }
    ], manual: [
      { k: '提前还款划算吗', scenario: 'pain', at: now - 60000 }
    ], done: [
      { k: '房贷计算', scenario: 'latest', at: now - 25 * 60000, foundN: 12, commentN: 4, note: '跑完 8 篇',
        notes: [{ t: '月供 8000 怎么提前还款最省', s: 2 }, { t: '30 年 vs 20 年，差的不是利息', s: 1 }, { t: '提前还款手续费怎么算', s: 1 }] },
      { k: '房贷计算', scenario: 'top', at: now - 3 * H, foundN: 9, commentN: 3, notes: [{ t: '等额本息和等额本金到底选哪个', s: 2 }, { t: '贷款 100 万 30 年真实月供', s: 1 }] },
      { k: '房贷计算', scenario: 'local', at: now - 5 * H, foundN: 6, commentN: 2, notes: [{ t: '深圳买房组合贷怎么走流程', s: 2 }] },
      { k: '公积金贷款额度', scenario: 'latest', at: now - 40 * 60000, foundN: 7, commentN: 3, notes: [{ t: '公积金能贷多少？一算就清楚', s: 2 }, { t: '深圳公积金基数上调了', s: 1 }] }
    ] };
  chrome.storage.local.set({
    drain_scan_cfg: scan,
    drain_queue: q,
    auto_water_config: { schedule: { dailyMax: 30, perRound: 10 } },
    auto_water_daily: (() => { const d = {}; d[new Date().toISOString().slice(0, 10)] = 7; return d; })()
  }, () => res('ok'));
})
"""

with tempfile.TemporaryDirectory(prefix='xhs-queue-') as profile, sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        profile, headless=False, channel='msedge',
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    try:
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
        page = ctx.new_page()
        page.on('pageerror', lambda e: print('[pageerror]', str(e)[:200]))
        page.goto(sw.url.replace('background.js', 'popup.html?mode=big'))
        page.wait_for_function('typeof switchMainTab === "function"')
        page.set_viewport_size({'width': 1160, 'height': 900})
        print('seed:', page.evaluate(SEED))

        def dismiss():
            try:
                page.evaluate('() => { const b = document.getElementById("fsClose"); if (b) b.click(); }')
            except Exception:
                pass

        dismiss()
        page.evaluate('switchMainTab("queue")')
        page.wait_for_timeout(1500)
        dismiss()
        page.screenshot(path=str(OUT / 'queue-collapsed.png'))
        print('shot queue-collapsed.png')

        # 卡片高度诊断：一项一卡，主行 + 副行（三十一改起不再有表头/组头/折叠行）
        print('cards =', page.locator('#queueBody .q-item').count())
        print(page.evaluate('''() => {
          const rows = [...document.querySelectorAll('#queueBody .q-item')].slice(0, 24);
          return rows.map(el => {
            const r = el.getBoundingClientRect();
            const t = (el.innerText || '').replace(/\\s+/g, ' ').slice(0, 46);
            return Math.round(r.height) + 'px  ' + (el.className || '-') + '  ' + t;
          }).join('\\n');
        }'''))
        # 两段折叠（🕓 还没到点 / ✅ 已完成）全打开再截一张
        for i in range(page.locator('#queueBody details.q-sec').count()):
            page.locator('#queueBody details.q-sec').nth(i).evaluate('d => d.open = true')
        page.wait_for_timeout(500)
        dismiss()
        page.screenshot(path=str(OUT / 'queue-expanded.png'))
        print('shot queue-expanded.png')
        # 滚到底看 🕓 还没到点 / ✅ 已完成 两段（含卡片里的「📄 发过的笔记」折叠）
        page.evaluate('() => { const b = document.getElementById("queueBody"); b.scrollTop = b.scrollHeight; }')
        page.wait_for_timeout(400)
        print('subs =', page.locator('#queueBody details.q-sub').count())
        dismiss()
        page.screenshot(path=str(OUT / 'queue-bottom.png'))
        print('shot queue-bottom.png')

        page.set_viewport_size({'width': 640, 'height': 700})
        page.wait_for_timeout(400)
        page.screenshot(path=str(OUT / 'queue-narrow.png'))
        print('shot queue-narrow.png')

        # 暂停/继续三态：把执行器标成「运行中」再看顶栏按钮（不动真的机器人，只看 UI）
        page.set_viewport_size({'width': 1160, 'height': 900})
        page.evaluate('() => { window.AutoBot.running = true; window.AutoBot._updateUI(true); }')
        page.wait_for_timeout(300)
        print('bar running:', page.evaluate('() => { const b = document.getElementById("botPauseBtn");'
                                           ' const t = document.getElementById("botToggleBtn");'
                                           ' return [b && b.style.display !== "none", b && b.innerText, t && t.innerText]; }'))
        page.screenshot(path=str(OUT / 'queue-pause-idle.png'))
        page.evaluate('() => window.AutoBot.togglePause()')
        page.wait_for_timeout(300)
        print('bar paused :', page.evaluate('() => { const b = document.getElementById("botPauseBtn");'
                                           ' return [window.AutoBot.paused, b && b.innerText, b && b.className]; }'))
        page.screenshot(path=str(OUT / 'queue-pause-on.png'))
        page.evaluate('() => window.AutoBot.togglePause()')
        page.wait_for_timeout(300)
        print('bar resumed:', page.evaluate('() => [window.AutoBot.paused, document.getElementById("botPauseBtn").innerText]'))
        page.evaluate('() => { window.AutoBot.running = false; window.AutoBot._updateUI(false); }')
    finally:
        ctx.close()
print('输出目录：', OUT)
