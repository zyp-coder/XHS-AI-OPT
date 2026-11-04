"""执行器版本横幅（真浏览器离线自检）
   用一份最小壳页把 web/exec-bridge.js 真跑一遍，fetch 打桩喂 /api/exec/orders：
     1) 手上的执行器 1.6.2 ≠ 公网要的 1.6.3 → 顶上弹「要更新」横幅，带「去更新」按钮指向 setup.html
     2) 换成 1.6.3 → 横幅自动收起
     3) 横幅文案里不许出现「自动开工 / 无人值守」
   跑法：py -3 scripts/dev/check_exec_version_banner.py
"""
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
BRIDGE = (ROOT / 'web' / 'exec-bridge.js').as_uri()
TMP = ROOT / 'tmp' / '_exec_ver_banner_shell.html'

SHELL = """<!doctype html><html><head><meta charset="utf-8"><title>ver banner</title></head>
<body><div id="content"></div>
<script>
  window.chrome = window.chrome || {};
  try { window.chrome.runtime = { id: 'demo-page' }; } catch (e) {}
  try {
    if (!window.chrome.runtime) Object.defineProperty(window.chrome, 'runtime', { value: { id: 'demo-page' }, configurable: true });
  } catch (e) {}
  window.chrome.storage = { local: {
    get: async () => ({}), set: async () => {},
    onChanged: { addListener() {} },
  }, onChanged: { addListener() {} } };
  window.__orders = null;
  window.fetch = async (url) => {
    const u = String(url || '');
    if (u.indexOf('api/exec/orders') >= 0) {
      return { ok: true, json: async () => window.__orders || { ok: false } };
    }
    return { ok: true, json: async () => ({ ok: true }) };
  };
</script>
<script src="__BRIDGE__"></script>
</body></html>"""


def orders(hand_ver):
    return {
        'ok': True,
        'hand': {'paired': True, 'name': '测试号', 'online': True, 'version': hand_ver},
        'expectVersion': '1.6.3',
        'orders': [],
        'reports': [],
        'bindings': {},
        'bindState': {},
        'pause': None,
        'chain': None,
    }


def main():
    TMP.write_text(SHELL.replace('__BRIDGE__', BRIDGE), encoding='utf-8')
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
        page.on('console', lambda m: print('[console] ' + m.type + ' ' + m.text) if m.type == 'error' else None)
        page.goto(TMP.as_uri())
        page.evaluate('(o) => { window.__orders = o; }', orders('1.6.2'))
        page.wait_for_function(
            "() => { const el = document.getElementById('execStopBanner'); return el && getComputedStyle(el).display !== 'none'; }",
            timeout=9000)

        box = page.locator('#execStopBanner')
        ok('横幅出现了', box.count() == 1 and box.evaluate('el => getComputedStyle(el).display') != 'none')
        title = box.locator('div').first.inner_text()
        body = box.inner_text()
        ok('标题说「执行器要更新」', '更新' in title and '执行器' in title, title)
        ok('正文点出版本差', '1.6.2' in body and '1.6.3' in body, body.replace('\n', ' ')[:80])
        link = box.locator('a')
        ok('有「去更新」按钮', link.inner_text() == '去更新' and 'setup.html' in (link.get_attribute('href') or ''))
        ok('去更新按钮看得见', link.evaluate('el => getComputedStyle(el).display') != 'none')
        ok('没有敏感字眼', all(w not in body for w in ('自动开工', '无人值守', '全自动')))

        # 换成对上版本 → 横幅自动收
        page.evaluate('(o) => { window.__orders = o; }', orders('1.6.3'))
        page.wait_for_function(
            "() => { const el = document.getElementById('execStopBanner'); return el && getComputedStyle(el).display === 'none'; }",
            timeout=9000)
        ok('版本对上后横幅收起', box.evaluate('el => getComputedStyle(el).display') == 'none')

        # 没挂执行器 → 不弹（免费/演示号不该看见这条）
        page.evaluate('(o) => { o.hand = { paired: false }; window.__orders = o; }', orders('1.6.3'))
        page.wait_for_timeout(5600)
        ok('没挂执行器不弹', box.evaluate('el => getComputedStyle(el).display') == 'none')

        b.close()
    TMP.unlink(missing_ok=True)
    if failed:
        print('\n%d 项没过' % failed)
        sys.exit(1)
    print('\n全部通过（8 项）')


if __name__ == '__main__':
    main()
