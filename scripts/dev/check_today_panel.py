"""顶栏「今天」弹窗（真浏览器离线自检）
   从 web/popup.html 抠出弹窗结构、从 web/popup.js 抠出「今天」那一段，拼成最小壳页真跑：
     1) 笔记那句说真话：今天 2 篇、已发 1 篇
     2) 获客那句说真话：在跑 / 已跑几项还剩几项 / 还没跑 / 今天没排
     3) 点「获客」那一行＝当场开跑（切到工作台 + 调起 AutoBot）
     4) 今天没排时点它＝去队列页配词，不开跑
     5) 获客跑动时段能在弹窗里改（星期 + 起止），保存落进 drain_scan_cfg.queueAuto
     6) 只剩一颗总开关，三个小项（开机/重开/录片）的勾已经不在了
   跑法：py -3 scripts/dev/check_today_panel.py
"""
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
HTML = ROOT / 'web' / 'popup.html'
JS = ROOT / 'web' / 'popup.js'
TMP = ROOT / 'tmp' / '_today_panel_shell.html'

STUBS = r"""
  window.__store = {
    np_notes: [], np_pub_files: {}, np_pub_ran: {},
    drain_scan_cfg: { queueAuto: { enabled: true, days: [1,2,3,4,5], from: '09:00', to: '18:00' } },
    drain_queue: {}, today_cfg: { on: true },
  };
  window.__plan = { todo: [], waiting: [], blocked: [], running: null };
  window.__toasts = [];
  window.chrome = window.chrome || {};
  window.chrome.runtime = { id: 'demo-page', getURL: (p) => p, sendMessage: () => {} };
  window.chrome.storage = { local: {
    get: async (keys) => {
      const ks = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
      const out = {};
      ks.forEach(k => { if (k in window.__store) out[k] = window.__store[k]; });
      return out;
    },
    set: async (o) => { Object.assign(window.__store, o || {}); },
  }, onChanged: { addListener() {} } };
  window.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.toast = (t, k) => { window.__toasts.push([String(t), String(k || '')]); };
  window.npPlanDateStr = (t) => {
    const d = new Date(t);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  window.NP_PUB_DEF_TIME = '12:00';
  window.NP_PLAN_PREP_TIME = '02:00';
  window.npNoteTitleOf = (n) => String((n && (n.title || n.t)) || '');
  window.switchMainTab = (n) => { window.__tab = n; };
  window.AutoBot = null;
  window.startAutoBot = () => { window.__started = true; window.AutoBot = window.AutoBot || {}; window.AutoBot.running = true; };
  window.drainQueuePlan = () => window.__plan;
  window.drainGetScanCfg = async () => window.__store.drain_scan_cfg || {};
  window.drainSaveScanCfg = async (c) => { window.__store.drain_scan_cfg = c; window.__savedCfg = c; return c; };
"""


def extract():
    html = HTML.read_text(encoding='utf-8')
    m = re.search(r'(<span class="hdr-today-wrap" id="hdrTodayWrap">.*?)<span class="hdr-acct-wrap"', html, re.S)
    if not m:
        sys.exit('抠不到「今天」弹窗结构')
    menu = m.group(1)
    js = JS.read_text(encoding='utf-8')
    a = js.index("const TODAY_CFG_KEY = 'today_cfg';")
    b = js.index('/* ═════════ ☀️ 「今天」页面这一侧')
    block = js[a:b]
    return menu, block


def main():
    menu, block = extract()
    TMP.parent.mkdir(parents=True, exist_ok=True)
    TMP.write_text(
        '<!doctype html><html><head><meta charset="utf-8"><title>today panel</title></head><body>\n'
        + menu + '\n<script>' + STUBS + '</script>\n<script>\n' + block + '\n</script>\n</body></html>',
        encoding='utf-8')
    failed = 0

    def ok(name, cond, extra=''):
        nonlocal failed
        if cond:
            print('PASS ' + name + (('（%s）' % extra) if extra else ''))
        else:
            failed += 1
            print('FAIL ' + name + ((' → %s' % extra) if extra else ''))

    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page()
        page.on('pageerror', lambda e: print('[pageerror] ' + str(e)))
        page.goto(TMP.as_uri())
        page.wait_for_function('() => typeof window.todayRefresh === "function"', timeout=9000)

        def refresh():
            page.evaluate('() => window.todayRefresh()')
            page.wait_for_timeout(120)

        # ── 1) 有笔记、发了一篇；获客今天跑过 3 次（一次搜索＝一行）、还剩 2 次 ──
        page.evaluate("""() => {
          const d = new Date();
          const day = window.npPlanDateStr(d.getTime());
          window.__store.np_notes = [
            { id: 1, title: '第一篇', planDate: day, planTime: '12:00', status: '已发', form: '图文' },
            { id: 2, title: '第二篇', planDate: day, planTime: '18:30', status: '待发', form: '图文' },
          ];
          window.__store.np_pub_files = { '2': { n: 3 } };
          const t0 = Date.now();
          window.__store.drain_queue = { done: [
            { k: 'a', scenario: 'latest', at: t0 - 3600e3, foundN: 2, commentN: 3 },
            { k: 'b', scenario: 'latest', at: t0 - 1800e3, foundN: 1, commentN: 2 },
            { k: 'c', scenario: 'latest', at: t0 - 600e3, foundN: 4, commentN: 5 },
          ] };
          window.__plan = { todo: [{ k: 'd' }], waiting: [{ k: 'e' }], blocked: [], running: null };
        }""")
        refresh()
        t1 = page.inner_text('#todayTxt')
        t2 = page.inner_text('#todaySub')
        ok('笔记说真话：2 篇已发 1 篇', '2 篇' in t1 and '已发 1 篇' in t1, t1)
        ok('获客说真话：已跑 3 次还剩 2 次', '3 次' in t2 and '2 次' in t2, t2)
        row_txt = page.inner_text('.today-row.qrow .st')
        ok('获客那一行是同一句话', '已跑 3 次' in row_txt and '还剩 2 次' in row_txt, row_txt)
        ok('点得动（标了开跑）', page.get_attribute('.today-row.qrow', 'data-qact') == 'start')

        # ── 2) 队列真在跑 ──
        page.evaluate("() => { window.AutoBot = { running: true }; }")
        refresh()
        ok('在跑时说在跑', '在跑' in page.inner_text('#todaySub'), page.inner_text('#todaySub'))
        ok('在跑时那行是蓝字', 'doing' in (page.get_attribute('.today-row.qrow .st', 'class') or ''))

        # ── 3) 点这一行＝当场开跑 ──
        page.evaluate("""() => {
          window.AutoBot = null; window.__started = false; window.__tab = '';
          window.__toasts = [];
        }""")
        refresh()
        page.evaluate("() => document.querySelector('.today-row.qrow').click()")
        page.wait_for_timeout(1900)
        ok('点了切到工作台', page.evaluate('() => window.__tab') == 'queue')
        ok('点了真调起队列', page.evaluate('() => window.__started') is True)
        ok('点了给一句「现在就跑」', any('现在就跑' in t for t, _ in page.evaluate('() => window.__toasts')),
           str(page.evaluate('() => window.__toasts')))
        ok('弹窗点完收起', page.evaluate("() => document.getElementById('hdrTodayMenu').style.display") == 'none')

        # ── 4) 今天没排：点它去配词，不开跑 ──
        page.evaluate("""() => {
          window.__store.drain_queue = { done: [] };
          window.__plan = { todo: [], waiting: [], blocked: [], running: null };
          window.__started = false; window.__tab = ''; window.__toasts = [];
          window.AutoBot = null;
        }""")
        refresh()
        ok('没排就说没排', page.inner_text('.today-row.qrow .st') == '今天没排')
        ok('没排时点它＝去配词', page.get_attribute('.today-row.qrow', 'data-qact') == 'cfg')
        page.evaluate("() => document.querySelector('.today-row.qrow').click()")
        page.wait_for_timeout(200)
        ok('没排时不开跑', page.evaluate('() => !!window.__started') is False)
        ok('没排时切到队列页', page.evaluate('() => window.__tab') == 'queue')

        # ── 5) 跑动时段在弹窗里改得动 ──
        page.evaluate("() => { document.getElementById('hdrTodayMenu').style.display = ''; }")
        chips = page.locator('#todayQaDays button')
        ok('星期七颗都在', chips.count() == 7, str(chips.count()))
        ok('周一到周五是亮的', page.evaluate(
            "() => [...document.querySelectorAll('#todayQaDays button.on')].map(b => b.textContent).join('')") == '一二三四五',
           page.evaluate("() => [...document.querySelectorAll('#todayQaDays button.on')].map(b => b.textContent).join('')"))
        page.evaluate("() => document.querySelector('#todayQaDays button[data-tq=\"6\"]').click()")
        page.fill('#todayQaFrom', '10:00')
        page.fill('#todayQaTo', '17:00')
        page.click('#todayQaSave')
        page.wait_for_timeout(300)
        qa = page.evaluate('() => (window.__savedCfg || {}).queueAuto || {}')
        ok('保存后星期带上了周六', qa.get('days') == [1, 2, 3, 4, 5, 6], str(qa.get('days')))
        ok('保存后时段也对', qa.get('from') == '10:00' and qa.get('to') == '17:00', str(qa))
        ok('保存后仍是开着', qa.get('enabled') is True)

        # ── 6) 只剩一颗总开关；界面没说敏感字眼 ──
        ok('三个小项已经撤掉', page.evaluate(
            "() => ['todayBoot','todayReopen','todayFilm','todaySubs'].every(id => !document.getElementById(id))"))
        body = page.inner_text('#hdrTodayMenu')
        ok('没有敏感字眼', all(w not in body for w in ('自动开工', '无人值守', '全自动', '机器人')), body.replace('\n', ' ')[:90])
        page.evaluate("() => { window.__store.today_cfg = { on: false }; }")
        refresh()
        ok('关掉总开关就说今天不跑', '没开着' in page.inner_text('#todayTxt'), page.inner_text('#todayTxt'))

        b.close()
    TMP.unlink(missing_ok=True)
    if failed:
        print('\n%d 项没过' % failed)
        sys.exit(1)
    print('\n全部通过（19 项）')


if __name__ == '__main__':
    main()
