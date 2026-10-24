# 首屏提速 B 档·按需加载点检 —— 公网那份 web/
# 验七件事：
#   ① 进门时拆出去的包（诊断&配置 / 线索列表）都没被下载（没点开就不该花流量）；
#   ② 点进「诊断&配置」才补下载，六个节点逐个能画；
#   ③ 「发笔记 → 任务配置（内容模板）」这一页照样能画（它也住在拆出去的那包里）；
#   ④ 「发布台 → 🧬 笔记规划」签照样能画（走门补画）；
#   ⑤ 获客三页（任务配置 / 笔记列表 / 队列）仍正常，且那三件和引擎文件并行下、没排队；
#   ⑥ 点「AI客服（线索列表）」才补下载那一包，清单能画；
#   ⑦ 全程无页内异常。
# 本机：node 起一台只用临时账本的服务器（DEMO_DATA_DIR 指 tmp/，绝不碰 server/data/）。
# 用法：python3 -X utf8 scripts/dev/check_split_b1_web.py
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
PORT = 8908
BASE = 'http://127.0.0.1:%d' % PORT
WORK = REPO / 'tmp' / 'split-b1-check'
DATA = WORK / 'data'
PACK = 'lib/pg-diag.js'
PACK2 = 'lib/pg-state.js'
PACKS = [PACK, PACK2]
HUOKE = ['lib/scenario-drain.js', 'auto-water-app.js', 'auto-bot.js']
fails = 0
finished = False


def ok(msg):
    print('  PASS ' + msg, flush=True)


def bad(msg):
    global fails
    fails += 1
    print('  FAIL ' + msg, flush=True)


# 页内取数：包清单 / 各文件落地时刻 / 引擎文件与那包的字节
PROBE = r'''async () => {
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const at = (n) => {
    const e = performance.getEntriesByName(location.origin + '/' + n)[0];
    return e ? { end: Math.round(e.responseEnd), bytes: (e.transferSize || e.encodedBodySize || 0) } : null;
  };
  const out = {
    packs: Object.keys(window.__wbPacks || {}),
    started: {},
    gate: typeof window.wbGate === 'function',
    lazyGate: !!window.__wbLazy,
    dcl: Math.round(nav.domContentLoadedEventEnd || 0),
    files: {},
    preloads: Array.from(document.querySelectorAll('link[rel=preload]')).map(l => l.getAttribute('href')),
  };
  for (const k in (window.__wbPacks || {})) out.started[k] = !!window.__wbPacks[k].started;
  for (const n of ['popup.js', 'lib/pg-diag.js', 'lib/pg-state.js'].concat(['lib/scenario-drain.js', 'auto-water-app.js', 'auto-bot.js'])) {
    const e = performance.getEntriesByName(location.origin + '/' + n)[0];
    out.files[n] = e ? { start: Math.round(e.fetchStart), begin: Math.round(e.startTime), end: Math.round(e.responseEnd), bytes: (e.transferSize || e.encodedBodySize || 0) } : null;
  }
  return out;
}'''

# 点左栏进某一页 → 等一拍 → 看容器有没有真东西（样式块不算内容，剔掉）
CLICK_PAGES = r'''async () => {
  const sleep = (ms) => new Promise(s => setTimeout(s, ms || 1200));
  const textOf = (id) => {
    const e = document.getElementById(id);
    if (!e) return '';
    const c = e.cloneNode(true);
    c.querySelectorAll('style,script').forEach(n => n.remove());
    return String(c.textContent || '').replace(/\s+/g, ' ').trim();
  };
  const click = (sel) => { const e = document.querySelector(sel); if (e) e.click(); return !!e; };
  const r = { steps: [] };

  // ② 诊断&配置：一级 + 六个二级节点
  r.diagTabClicked = click('#tabDiagnose');
  await sleep(1600);
  r.diagLen = textOf('diagnoseContent').length;
  r.diagHead = textOf('diagnoseContent').slice(0, 50);
  const gos = Array.from(document.querySelectorAll('#diagSubTabs [data-go]'));
  r.nodeCount = gos.length;
  for (let i = 0; i < gos.length; i++) {
    gos[i].click();
    await sleep(900);
    const t = textOf('diagStepBody');
    r.steps.push({ go: gos[i].getAttribute('data-go'), len: t.length, head: t.slice(0, 26) });
  }

  // ③ 发笔记 → 任务配置（内容模板）
  click('#tabNotePublish'); await sleep(500);
  r.taskCfgClicked = click('#tabNoteTaskCfg');
  await sleep(1500);
  r.noteTaskCfgLen = textOf('noteTaskCfgContent').length;
  r.noteTaskCfgHead = textOf('noteTaskCfgContent').slice(0, 50);

  // ④ 发布台 → 🧬 笔记规划 签
  r.queueClicked = click('#tabNoteQueue');
  await sleep(1500);
  r.planTabClicked = click('[data-np="nq-sec"][data-sec="plan"]');
  await sleep(1600);
  r.planLen = textOf('nqPanePlan').length;
  r.planHead = textOf('nqPanePlan').slice(0, 50);

  // ⑥ 线索列表（AI客服那一栏，实现拆在 lib/pg-state.js）
  r.stateClicked = click('#tabProspect');
  await sleep(2600);
  r.stateLen = textOf('prospectContent').length;
  r.stateHead = textOf('prospectContent').slice(0, 50);
  r.stateFn = (typeof loadProspectList === 'function') && (typeof renderProspectList === 'function');

  // ⑤ 获客三页
  r.huoke = {};
  // 原「任务配置」二级页已并进「队列 → ⚙️ 配置」（2026-10-24）：taskCfg 是兼容别名，落在配置那一签；
  // 测「队列」那一签时先把内存里的当前签拨回 mgmt，否则会跟着停在配置、量到的还是配置页
  for (const [tab, id] of [['taskCfg', 'drainCfgContent'], ['scenarioDrain', 'drainContent'], ['queue', 'drainQueueContent']]) {
    try {
      if (tab === 'queue') { const qb = document.getElementById('drainQueueContent'); if (qb) qb._qTab = 'mgmt'; }
      switchMainTab(tab);
    } catch (_) {}
    await sleep(tab === 'taskCfg' ? 2200 : 1300);
    const t = textOf(id);
    r.huoke[tab] = { len: t.length, head: t.slice(0, 30) };
  }
  return r;
}'''


def main():
    print('── 首屏提速 B 档·按页拆包点检（诊断&配置 + 线索列表，公网那份 web/）──', flush=True)
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
        bad('服务器没起来（看 tmp/split-b1-check.server.log）')
        sys.exit(1)
    time.sleep(2)

    requested = []
    try:
        with sync_playwright() as p:
            br = p.chromium.launch(channel='msedge', headless=True)
            ctx = br.new_context(viewport={'width': 1500, 'height': 950})
            page = ctx.new_page()
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            page.on('request', lambda rq: requested.append(rq.url[len(BASE):].split('?')[0]) if rq.url.startswith(BASE) else None)

            page.goto(BASE + '/start.html', wait_until='domcontentloaded', timeout=90000)
            page.wait_for_timeout(2000)
            who = page.evaluate('''async (a) => await (await fetch('/api/auth/demo', { method: 'POST',
                headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: a.key }) })).json()''',
                {'key': 'deco'})
            if not who.get('ok'):
                bad('演示号没进上：%r' % (who,))
                br.close()
                return
            requested.clear()
            goto_big(page, BASE + '/popup.html?mode=big', wait_until='domcontentloaded', timeout=90000)
            page.wait_for_timeout(1000)

            if page.evaluate('() => !!document.querySelector(".main-tab")'):
                ok('进门骨架先画出来了（左栏一级项已就位）')
            else:
                bad('左栏没画出来（进门就白屏？）')

            # ① 进门阶段：拆出去的包都还没下载
            early = [u for u in requested if any(p in u for p in PACKS)]
            if early:
                bad('进门就下载了 %s（这些页没点开，不该花流量）' % ', '.join(sorted(set(early))))
            else:
                ok('进门没下载 %s' % '、'.join(PACKS))

            # 等获客三件落地（并行下载，本机很快；给 25 秒余量）
            DONE = '''() => !!(window.__wbLazy && (window.__wbLazy.failed()
                     || (window.AutoBot && window.AutoWaterApp
                         && typeof renderScenarioDrain === 'function')))'''
            for _ in range(50):
                if page.evaluate(DONE):
                    break
                page.wait_for_timeout(500)

            pr = page.evaluate(PROBE)
            eng = pr['files'].get('popup.js') or {}
            print('  · 引擎文件 popup.js %sKB（拆前 1832KB 原文／压缩约 547KB）　骨架→DCL %sms'
                  % (round((eng.get('bytes') or 0) / 1024), pr['dcl']), flush=True)
            print('  · 后台的包：%s' % ', '.join(pr['packs']), flush=True)

            if not pr['gate']:
                bad('找不到 wbGate（popup.js 里那道门没定义）')
            else:
                ok('按页分包的门在（wbGate）')
            if not pr['lazyGate']:
                bad('找不到 __wbLazy（获客那三件的后台加载器没执行）')
            else:
                ok('获客三件的后台加载器在跑')
            for name, label in [('diag', '诊断&配置'), ('state', '线索列表')]:
                if pr['started'].get(name):
                    bad('%s 包在点开之前就开始了（started=true）' % label)
                else:
                    ok('%s 包还没开始下载（等到点开那一页）' % label)
            hk_bad = [n for n in HUOKE if not (pr['files'].get(n) or {}).get('end')]
            eng_end = (pr['files'].get('popup.js') or {}).get('end') or 0
            serial = [n for n in HUOKE if (pr['files'].get(n) or {}).get('start', 1e12) >= eng_end]
            if hk_bad:
                bad('获客三件没下载：%s' % ', '.join(hk_bad))
            elif serial:
                bad('获客三件仍在引擎文件之后才排队开始：%s' % ', '.join(serial))
            else:
                ok('获客三件和引擎文件同时下载（不是等引擎下完才开始排队）')

            # ②③④⑤ 逐页点检
            r = page.evaluate(CLICK_PAGES)
            POST = '''(pk) => { const e = performance.getEntriesByName(location.origin + "/" + pk)[0];
              const n = pk.split("/")[1].replace(".js","");
              return e ? { end: Math.round(e.responseEnd), bytes: (e.transferSize || e.encodedBodySize || 0),
                           started: !!(window.__wbPacks[n] && window.__wbPacks[n].started),
                           failed: !!(window.__wbPacks[n] && window.__wbPacks[n].failed) } : null; }'''
            for pk, label in [(PACK, '诊断&配置'), (PACK2, '线索列表')]:
                got = page.evaluate(POST, pk) or {}
                if got.get('end'):
                    ok('点开「%s」后才补下载 %s（%sKB，落地于 %sms）' % (label, pk, round((got.get('bytes') or 0) / 1024), got['end']))
                else:
                    bad('点了「%s」却没下载 %s' % (label, pk))
                if got.get('failed'):
                    bad('%s 那包下载失败' % label)

            if r['diagTabClicked'] and r['diagLen'] > 60:
                ok('诊断&配置首页渲染（%d 字，起头「%s」）' % (r['diagLen'], r['diagHead'][:22]))
            else:
                bad('诊断&配置首页空的：clicked=%s len=%s' % (r['diagTabClicked'], r['diagLen']))
            empty = [s for s in r['steps'] if s['len'] < 40]
            if r['nodeCount'] >= 6 and not empty:
                ok('六个节点逐个能画：%s' % ' / '.join('%s:%d字' % (s['go'], s['len']) for s in r['steps']))
            else:
                bad('有节点画空：%s（节点数 %s）' % (empty, r['nodeCount']))

            if r['taskCfgClicked'] and r['noteTaskCfgLen'] > 60:
                ok('发笔记→任务配置（内容模板）渲染（%d 字）' % r['noteTaskCfgLen'])
            else:
                bad('任务配置（内容模板）空的：clicked=%s len=%s' % (r['taskCfgClicked'], r['noteTaskCfgLen']))

            if r['planTabClicked'] and r['planLen'] > 40:
                ok('发布台→🧬 笔记规划签渲染（走门补画，%d 字）' % r['planLen'])
            else:
                bad('笔记规划签空的：clicked=%s len=%s 起头=%r' % (r['planTabClicked'], r['planLen'], r['planHead'][:30]))

            # 线索列表：本机演示服务器按规矩拦住了清单数据（要装了扩展才有），
            # 所以这里只验「那包到了、页面由它画出来了」，不验清单条数。
            if r['stateClicked'] and r['stateLen'] > 8 and r['stateFn']:
                ok('AI客服（线索列表）走门补下载后由那一页自己画的（%d 字，起头「%s」；本机演示服务器不给清单数据＝正常）' % (r['stateLen'], r['stateHead'][:26]))
            else:
                bad('线索列表没画：clicked=%s len=%s 函数在=%s 起头=%r' % (r['stateClicked'], r['stateLen'], r['stateFn'], r['stateHead'][:30]))

            for tab, info in r['huoke'].items():
                if info['len'] > 40:
                    ok('获客 %s 页渲染（%d 字，起头「%s」）' % (tab, info['len'], info['head'][:18]))
                else:
                    bad('获客 %s 页空的：len=%s' % (tab, info['len']))

            if errs:
                bad('页内异常 ' + str(errs[:3]))
            else:
                ok('全程无页内异常')

            br.close()
            finished = True
    finally:
        srv.terminate()
        try:
            srv.wait(timeout=8)
        except Exception:
            srv.kill()
        logf.close()
        if WORK.exists():
            shutil.rmtree(WORK, ignore_errors=True)
        if not finished:
            print(chr(10) + '✗ 脚本中途崩了，上面的点检没跑完', flush=True)
            sys.exit(1)
        if fails:
            print('\n✗ 没过 %d 项' % fails, flush=True)
            sys.exit(1)
        print('\n✓ 全绿', flush=True)


if __name__ == '__main__':
    main()
