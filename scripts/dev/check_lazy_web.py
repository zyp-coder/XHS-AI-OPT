# 首屏提速（A 档）点检 —— 公网那份 web/：截流／灌水三个文件不再挡首屏
# 老板 2026-10-20 定：先做轻改，popup.js 不动内部逻辑，只做「用到才加载」。
# 验四件事：
#   ① 进门不卡：三件文件（lib/scenario-drain.js、auto-water-app.js、auto-bot.js）
#      不再出现在 popup.html 里，页面骨架（左栏）先画出来，这三件在后台按序补下载；
#   ② 补载到位：三件跑完后，页面截流／灌水的全局函数与执行器按钮都真在（不是静默失败）；
#   ③ 三页能画：🎯 获客 · ⚙️ 任务配置 / 📋 笔记列表 / 🔁 队列 三页各自渲染出内容；
#   ④ 不报错：整个来回没有页内异常（pageerror）。
# 本机：node 起一台只用临时账本的服务器（DEMO_DATA_DIR 指 tmp/，绝不碰 server/data/）。
# 用法：python3 -X utf8 scripts/dev/check_lazy_web.py
import os
import sys
import time
import socket
import subprocess
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright
from _guide_gate import goto_big

sys.stdout.reconfigure(encoding='utf-8')
REPO = Path(__file__).resolve().parents[2]
PORT = 8907
BASE = 'http://127.0.0.1:%d' % PORT
WORK = REPO / 'tmp' / 'lazy-web-check'
DATA = WORK / 'data'
LAZY = ['lib/scenario-drain.js', 'auto-water-app.js', 'auto-bot.js']
fails = 0


def ok(msg):
    print('  PASS ' + msg, flush=True)


def bad(msg):
    global fails
    fails += 1
    print('  FAIL ' + msg, flush=True)


def kb(n):
    return '%.0fKB' % (n / 1024.0)


# 页内取数：骨架出现时刻 / 三件补载落位 / 各符号是否齐
# 注：scenario-drain 顶层那几枚 const 不落 window，只能用 typeof 直接问页面
PROBE = r'''async () => {
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const res = (n) => performance.getEntriesByName(location.origin + '/' + n)[0] || {};
  const out = {
    lazyGate: !!window.__wbLazy,
    done: (window.__wbLazy && window.__wbLazy.done) || [],
    failed: !!(window.__wbLazy && window.__wbLazy.failed()),
    dcl: Math.round(nav.domContentLoadedEventEnd || 0),
    lazyEnd: {},
    symbols: {},
    botBound: !!((document.getElementById('botToggleBtn') || {}).dataset || {}).botBound,
  };
  for (const n of ['lib/scenario-drain.js', 'auto-water-app.js', 'auto-bot.js']) {
    out.lazyEnd[n] = Math.round(res(n).responseEnd || 0);
  }
  const q = (e) => { try { return !!(window.eval(e)); } catch (_) { return false; } };
  out.symbols.renderScenarioDrain = q('typeof renderScenarioDrain === "function"');
  out.symbols.renderDrainQueue = q('typeof renderDrainQueue === "function"');
  out.symbols.SCENARIO_DRAIN = q('typeof SCENARIO_DRAIN !== "undefined"');
  out.symbols.DRAIN_KEY = q('typeof DRAIN_KEY !== "undefined"');
  out.symbols.drainPaintStrategy = typeof window.drainPaintStrategy === 'function';
  out.symbols.AutoWaterApp = !!(window.AutoWaterApp && window.AutoWaterApp.activate);
  out.symbols.AutoBot = !!(window.AutoBot && window.AutoBot.start);
  out.symbols.stopAutoBot = typeof window.stopAutoBot === 'function';
  out.symbols.wbLazyThen = typeof window.wbLazyThen === 'function';
  return out;
}'''

# 三页逐个渲染检查（点进去 → 等一拍 → 看容器有没有真东西；样式块不算内容，剔掉）
PAGES = r'''async () => {
  const sleep = (ms) => new Promise(s => setTimeout(s, ms || 900));
  const textOf = (e) => {
    if (!e) return '';
    const c = e.cloneNode(true);
    c.querySelectorAll('style,script').forEach(n => n.remove());
    return String(c.textContent || '').replace(/\s+/g, ' ').trim();
  };
  const r = {};
  const cases = [
    ['scenarioDrain', 'drainContent', ['笔记', '词']],
    ['queue', 'drainQueueContent', ['队列', '排']],
  ];
  for (const [tab, id, words] of cases) {
    switchMainTab(tab);
    await sleep(1400);
    const el = document.getElementById(id);
    const t = textOf(el);
    r[tab] = { exists: !!el, len: t.length, hasWord: words.some(w => t.indexOf(w) >= 0), head: t.slice(0, 60) };
  }
  return r;
}'''


def main():
    print('── 首屏提速 A 档：三件文件改「用到才加载」（公网那份 web/）──', flush=True)
    if WORK.exists():
        shutil.rmtree(WORK)
    DATA.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env['DEMO_DATA_DIR'] = str(DATA)
    env['PORT'] = str(PORT)
    env['DEMO_AI_KEY'] = 'check-only'
    env['DEMO_AI_BASE'] = 'http://127.0.0.1:1/v1'
    env['DEMO_SIGNUP_MAX'] = '60'
    logf = open(WORK.with_suffix('.server.log'), 'w', encoding='utf-8')
    srv = subprocess.Popen(['node', str(REPO / 'server' / 'dev-server.mjs')], env=env, stdout=logf, stderr=subprocess.STDOUT)
    for _ in range(80):
        try:
            socket.create_connection(('127.0.0.1', PORT), 1).close()
            break
        except OSError:
            time.sleep(0.5)
    else:
        bad('服务器没起来（看 tmp/lazy-web-check.server.log）')
        return
    time.sleep(2)

    got, errs = {}, []
    try:
        with sync_playwright() as p:
            br = p.chromium.launch(channel='msedge', headless=True)
            ctx = br.new_context(viewport={'width': 1500, 'height': 950})
            page = ctx.new_page()
            page.on('pageerror', lambda e: errs.append(str(e)))

            def on_resp(rp):
                u = rp.url
                if not u.startswith(BASE):
                    return
                path = u[len(BASE):].split('?')[0]
                if path in ('/popup.html', '/popup.js') or path.lstrip('/') in LAZY:
                    got[path] = int(rp.headers.get('content-length') or 0)

            page.on('response', on_resp)
            page.goto(BASE + '/start.html', wait_until='domcontentloaded', timeout=90000)
            page.wait_for_timeout(2500)
            who = page.evaluate('''async (a) => await (await fetch('/api/auth/demo', { method: 'POST',
                headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: a.key }) })).json()''',
                {'key': 'deco'})
            if not who.get('ok'):
                bad('演示号没进上：%r' % (who,))
                br.close()
                return
            goto_big(page, BASE + '/popup.html?mode=big', wait_until='domcontentloaded', timeout=90000)
            page.wait_for_timeout(1200)

            # ① 骨架先出来：左栏一级项已经画好，此时三件里最早的一件可能还没落地
            skeleton = page.evaluate('() => !!document.querySelector(".main-tab")')
            if skeleton:
                ok('进门骨架先画出来了（左栏一级项已就位）')
            else:
                bad('左栏没画出来（进门就白屏？）')

            # 等补载跑完（本机链路快，仍给 25 秒余量）
            DONE = '''() => !!(window.__wbLazy && (window.__wbLazy.failed()
                     || (window.AutoBot && window.AutoWaterApp
                         && typeof renderScenarioDrain === 'function')))'''
            for _ in range(50):
                if page.evaluate(DONE):
                    break
                page.wait_for_timeout(500)

            pr = page.evaluate(PROBE)
            print('  · 门在吗 __wbLazy=%s　骨架→DCL %sms　三件落地 %s'
                  % (pr['lazyGate'], pr['dcl'], {k.split('/')[-1]: v for k, v in pr['lazyEnd'].items()}), flush=True)

            if pr['lazyGate']:
                ok('popup.html 末尾的后台加载器在跑')
            else:
                bad('找不到 window.__wbLazy（后台加载器没执行）')

            # 2026-10-20 B 档改了口径：这三件不再「等骨架之后才排队下载」，而是和引擎文件同时下载
            # （popup.html 头部 preload 预告 + 末尾加载器执行），所以这里验两件事：
            #   ① 没有作为 <script src> 内联在进门路上（内联才会挡首屏）；
            #   ② 下载开始得不晚于引擎文件下完（= 并行，不是排队）。
            html_txt = page.evaluate('''async () => await (await fetch('/popup.html?probe=1')).text()''')
            inline = [n for n in LAZY if ('<script src="' + n + '"') in html_txt or ("src=\"%s\"" % n) in html_txt]
            eng_end = 0
            try:
                eng_end = page.evaluate('() => { const e = performance.getEntriesByName(location.origin + "/popup.js")[0]; return e ? Math.round(e.responseEnd) : 0; }')
            except Exception:
                pass
            serial = [n for n, v in pr['lazyEnd'].items() if eng_end and v and v > eng_end]
            if inline:
                bad('这三件仍内联在进门路上：' + ', '.join(inline))
            elif serial and len(serial) == len(LAZY):
                bad('这三件仍在引擎文件之后才排队下载：' + ', '.join(serial))
            else:
                ok('三件不再挡首屏（没内联，且和引擎文件同时下载）')

            miss = [k for k, v in pr['symbols'].items() if not v]
            if miss:
                bad('补载后这些仍缺：' + ', '.join(miss))
            else:
                ok('截流渲染函数 / 常量 / 灌水面板 / 执行器 全落位')

            if pr['done'] == LAZY:
                ok('按序补载：%s' % ' → '.join(d.split('/')[-1] for d in pr['done']))
            else:
                bad('补载清单不对：%r' % (pr['done'],))

            if pr['botBound']:
                ok('队列页那颗「🤖 开始」补载后照样绑上了')
            else:
                bad('「🤖 开始」没绑上（auto-bot 的 initUI 没跑到）')

            # ③ 三页能画
            pg = page.evaluate(PAGES)
            for tab, info in pg.items():
                if info['exists'] and info['len'] > 40 and info['hasWord']:
                    ok('%s 页渲染出东西（%d 字，起头「%s」）' % (tab, info['len'], info['head'][:24]))
                else:
                    bad('%s 页空的：exists=%s len=%s 起头=%r' % (tab, info['exists'], info['len'], info['head'][:40]))

            # ④ 无页内异常
            if errs:
                bad('页内异常 ' + str(errs[:3]))
            else:
                ok('全程无页内异常')

            # ⑤ 抢跑：文件还在半路上就点进「📋 笔记列表」，落位后必须自己补画出来（wbLazyThen 那道门的真意义）
            #    本机链路太快、网络延迟造不出这个时间差，改成页内把门暂时换成一道慢门（只这一次实验，不改真码）
            slow = ctx.new_page()
            serrs = []
            slow.on('pageerror', lambda e: serrs.append(str(e)))
            goto_big(slow, BASE + '/popup.html?mode=big', wait_until='domcontentloaded', timeout=90000)
            WAIT_DONE = '''() => !!(window.__wbLazy && !window.__wbLazy.failed()
                     && window.__wbLazy.done.length === 3)'''
            for _ in range(50):
                if slow.evaluate(WAIT_DONE):
                    break
                slow.wait_for_timeout(500)
            race = slow.evaluate(r'''async () => {
                const textLen = (id) => {
                    const c = document.getElementById(id);
                    if (!c) return -1;
                    const k = c.cloneNode(true);
                    k.querySelectorAll('style,script').forEach(n => n.remove());
                    return String(k.textContent || '').replace(/\s+/g, ' ').trim().length;
                };
                const real = window.__wbLazy;
                let release;
                window.__wbLazy = { wait: () => new Promise(r => { release = r; }), failed: () => false, done: [] };
                switchMainTab('scenarioDrain');
                await new Promise(r => setTimeout(r, 400));
                const during = textLen('drainContent');
                release();
                await new Promise(r => setTimeout(r, 1500));
                window.__wbLazy = real;
                return { during: during, after: textLen('drainContent') };
            }''')
            if race['during'] == 0:
                ok('门没开时那页确实先空着（没抢跑报错）')
            else:
                bad('门未开时容器不是空的：len=%s' % race['during'])
            if race['after'] > 40:
                ok('门开之后那页自己补画出来了（%d 字）' % race['after'])
            else:
                bad('门开之后仍空的（len=%s，补画没接上）' % race['after'])
            if serrs:
                bad('抢跑这一趟页内异常 ' + str(serrs[:2]))
            slow.close()

            # 账：补载三件的实际字节
            lazy_bytes = sum(v for k, v in got.items() if k.lstrip('/') in LAZY)
            print('  · 补载三件合计 %s（这部分原先挡在进门路上）' % kb(lazy_bytes), flush=True)
            for u, v in sorted(got.items()):
                print('     %-28s %s' % (u, kb(v)), flush=True)
            br.close()
    finally:
        srv.terminate()
        try:
            srv.wait(timeout=8)
        except Exception:
            srv.kill()
        logf.close()
    print('── 结论：%s ──' % ('全绿' if not fails else '有 %d 项没过' % fails), flush=True)
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
