"""笔记池页看样：造几篇假笔记（含二级评论数 / 作废 / 我的评论三种态），
截图看「数据」「操作」两列，并验一下「打开」在忙 / 不忙两条分支。

用法：python3 scripts/dev/shot_pool_ui.py [输出目录]
输出：<目录>/pool.png / pool-narrow.png
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
  const mk = (i, o) => Object.assign({
    id: 'n' + i, scenario: 'latest', noteId: '65f0' + i + 'aabbccdd',
    url: 'https://www.xiaohongshu.com/explore/65f0' + i + 'aabbccdd',
    title: '月供 8000 怎么提前还款最省——把两个坑先避开',
    author: '房奴自救指南', addedAt: now - i * H, lastJudgedAt: now - i * 60000,
    signals: { rank: 0, delta: 0 },
  }, o);
  const notes = [
    mk(1, { scenario: 'latest', title: '月供 8000 怎么提前还款最省——把两个坑先避开',
      signals: { likes: 12800, comments: 342, subComments: 89, delta: 260, rank: 2 } }),
    mk(2, { scenario: 'top', title: '等额本息和等额本金到底选哪个？我把 30 年账单拉出来算了一遍',
      signals: { likes: 45210, comments: 1204, subComments: 366, delta: -12, rank: 7,
        myComment: { found: true, checked: true, rank: 3, likes: 41, seen: true } } }),
    mk(3, { scenario: 'local', title: '深圳买房组合贷怎么走流程（附我踩过的 3 个点）',
      author: '深圳楼市观察',
      signals: { likes: 862, comments: 47, subComments: null, delta: 15, rank: 5 } }),
    mk(4, { scenario: 'pain', title: '求推荐！提前还款到底划不划算，听劝',
      author: '小柚子妈妈', signals: { likes: 233, comments: 96, subComments: 12, delta: 4, rank: 1,
        myComment: { checked: true, found: false } } }),
    mk(5, { scenario: 'highv', title: '这条标题很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长',
      author: '一个名字很长很长的博主名字', dead: true, deadAt: now - 2 * H, deadReason: '标题+作者都搜不到',
      signals: { likes: 99000, comments: 888, subComments: 210, delta: 0, rank: 0 } }),
  ];
  chrome.storage.local.set({ drain_notes: notes }, () => res('notes seeded: ' + notes.length));
})
"""

with tempfile.TemporaryDirectory(prefix='xhs-pool-') as profile, sync_playwright() as p:
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
        page.evaluate('switchMainTab("scenarioDrain")')
        page.wait_for_timeout(1500)
        dismiss()
        page.screenshot(path=str(OUT / 'pool.png'))
        print('shot pool.png')

        print('--- 表头/行 ---')
        print(page.evaluate('''() => {
          const rows = [...document.querySelectorAll('#sxList tr')].slice(0, 10);
          return rows.map(tr => {
            const h = Math.round(tr.getBoundingClientRect().height);
            return h + 'px  ' + (tr.innerText || '').replace(/\\s+/g, ' ').slice(0, 70);
          }).join('\\n');
        }'''))
        print('--- 操作列按钮 ---')
        print(page.evaluate('''() => [...document.querySelectorAll('#sxList tbody tr')].map(tr => {
          const tds = tr.querySelectorAll('td');
          const num = tds[2] ? tds[2].innerText.replace(/\\s+/g, ' ') : '-';
          const ops = tds[4] ? [...tds[4].querySelectorAll('button')].map(b => b.innerText).join(',') : '-';
          const noteColBtns = [...tds[1].querySelectorAll('button')].map(b => '[' + (b.title || '') + ']').join(',');
          return num + '  |  操作: ' + ops + (noteColBtns ? '  |  笔记列: ✕' : '');
        }).join('\\n')'''))

        # 打开：忙 → 拦下
        page.evaluate('() => { window.AutoBot.running = true; }')
        page.locator('#sxList tbody tr').first.locator('button.sx-open').click()
        page.wait_for_timeout(400)
        print('busy toast:', page.evaluate('''() => {
          const t = [...document.querySelectorAll('div')].filter(d => /工作台有任务在忙/.test(d.innerText || ''));
          return t.length ? t[t.length - 1].innerText : '(没有拦下)';
        }'''))
        page.screenshot(path=str(OUT / 'pool-open-busy.png'))
        page.evaluate('() => { window.AutoBot.running = false; }')

        # 打开：不忙 → 跳工作台（没有小红书标签页时后台会回「未找到小红书标签页」，正好验跳转）
        page.locator('#sxList tbody tr').first.locator('button.sx-open').click()
        page.wait_for_timeout(2500)
        print('跳到工作台:', page.evaluate('() => { const mc = document.getElementById("mainContent");'
                                        ' return mc && mc.style.display !== "none"; }'))
        print('open toast:', page.evaluate('''() => {
          const t = [...document.querySelectorAll('div')].filter(d => /正在工作台打开|打开失败|已打开/.test(d.innerText || ''));
          return t.length ? t[t.length - 1].innerText : '(没有提示)';
        }'''))
        page.screenshot(path=str(OUT / 'pool-open-workbench.png'))

        # 窄窗复查（弹窗 640 宽）
        page.evaluate('switchMainTab("scenarioDrain")')
        page.set_viewport_size({'width': 640, 'height': 760})
        page.wait_for_timeout(600)
        page.screenshot(path=str(OUT / 'pool-narrow.png'))
        print('shot pool-narrow.png')
    finally:
        ctx.close()
print('输出目录：', OUT)
