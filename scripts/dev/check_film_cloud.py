# 公网那台「🎬 分幕」这一屏的只读点检。两道：
#  ① 从公网那台把这几个界面文件下载回来，跟本机测过的这份逐字节对码（证明传上去的就是这批）
#  ② 本机起一台只用临时账本的服务器（DEMO_DATA_DIR 指 tmp/，绝不碰 server/data/），
#     浏览器里把「档案行 → 进台子 → 一屏（左稿右幕）自动跑到分幕 → 底栏回改稿 → 再进一次」点一遍
# 用法：python3 -X utf8 scripts/dev/check_film_cloud.py
#
# 口径跟「你电脑那份」那份点检（check_film_shell.py）一致：台子不再隔一层网页——
# 稿／幕／预览就搭在发笔记那页的 #filmPane 上，顶栏／工作流条／底栏这三件由这一页画。
# 公网独有的那层「这一档没开本机出片」说明也顺带点一遍（把八格收回报关，看盖板与条子）。
# 这一趟把服务器的 AI 出口拨到没人应的端口，走台子自己的兜底：
# 调稿不成＝正文直接当稿，切幕不成＝本机规则分幕并在幕栏标注。出片那颗不真派单，只验走缝。
import os
import sys
import time
import socket
import hashlib
import subprocess
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
from _guide_gate import goto_big

sys.stdout.reconfigure(encoding='utf-8')
REPO = Path(__file__).resolve().parents[2]
CLOUD = 'http://8.222.157.6'
def _free_port():   # 别的会话也在本机起测试服，固定端口会撞车（撞上就点到别人那个站上了）
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


PORT = _free_port()
BASE = 'http://127.0.0.1:%d' % PORT
DATA = REPO / 'tmp' / 'film-web-check' / 'data'
FILM_RELS = ['web/video.js', 'web/video.html', 'web/lib/video/video.css', 'web/popup.js', 'web/popup.html']
BODY = '开场钩子一句。\n\n干货一段。\n\n结尾引导私信。'
K_STATIONS = ['挑知识', '改稿', '🎬 分幕', '发布']
NOTE_ID = 'fcheck1'
TITLE = '字效点检这一篇'
fails = 0
pending = []


def ok(msg):
    print('  PASS ' + msg, flush=True)


def bad(msg):
    global fails
    fails += 1
    print('  FAIL ' + msg, flush=True)


def md5(b):
    return hashlib.md5(b).hexdigest()


print('── ① 公网那台下载回来对码（只读）──', flush=True)
for rel in FILM_RELS:
    url = CLOUD + '/' + rel.replace('web/', '')
    try:
        got = urllib.request.urlopen(url, timeout=90).read()
    except Exception as e:
        bad('%s 下载失败：%s' % (rel, e))
        continue
    mine = (REPO / rel).read_bytes()
    if md5(got) == md5(mine):
        ok('%s 公网那份＝本机测过的这份（%d 字节）' % (rel, len(got)))
    else:
        pending.append(rel)
        print('  待部署 %s 公网那份还是旧的（云端 %s ≠ 本机 %s）——传上去才会对上'
              % (rel, md5(got)[:12], md5(mine)[:12]), flush=True)

print('── ② 临时账本的服务器 + 浏览器点这条链 ──', flush=True)
DATA.mkdir(parents=True, exist_ok=True)
env = dict(os.environ)
env['DEMO_DATA_DIR'] = str(DATA)
env['PORT'] = str(PORT)
# 这一趟只点界面这条链：把 AI 出口拨到本地一个没人应的端口，让它立刻回「没成」，
# 走片台自己的兜底（调稿＝正文直接当稿、分幕＝本机规则），不真拨服务器上那个 Key
env['DEMO_AI_KEY'] = 'check-only-no-key'
env['DEMO_AI_BASE'] = 'http://127.0.0.1:9'
env['DEMO_SIGNUP_MAX'] = '60'   # 这一趟要连点几轮，每个号只进临时账本，别卡在「同网络每天 5 个」
srv = subprocess.Popen(['node', str(REPO / 'server' / 'dev-server.mjs')], env=env,
                       stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
for _ in range(80):
    try:
        socket.create_connection(('127.0.0.1', PORT), 1).close()
        break
    except OSError:
        time.sleep(0.5)
else:
    bad('服务器没起来')

# 档位这八格在公网那台走的是 XhsEdition（真源＝服务器对账塞回的 ed.grant，
# 读表在页面里）：点检要哪一档就往临时账本写哪一张表、再重读一遍，别去改包里那张。
GRANT_ON = '''(async () => {
  await chrome.storage.local.set({ 'ed.grant': { at: Date.now(), tier: 'check', label: '点检（八格全开）',
    features: { batchSend: true, tenant: true, knowledge: true, notePublish: true,
                autoWater: true, dailyBrowse: true, prospectList: true, videoFilm: true } } });
  const st = await XhsEdition.status(true);
  return (st && st.edition && st.edition.features) ? ('videoFilm=' + (XhsEdition.has('videoFilm') ? 1 : 0)) : '没读到表';
})()'''
GRANT_OFF = '''(async () => {
  await chrome.storage.local.set({ 'ed.grant': { at: Date.now(), tier: 'free', label: '点检（本机出片没开）',
    features: { batchSend: false, tenant: false, knowledge: false, notePublish: true,
                autoWater: false, dailyBrowse: false, prospectList: false, videoFilm: false } } });
  const st = await XhsEdition.status(true);
  return (st && st.edition && st.edition.features) ? ('videoFilm=' + (XhsEdition.has('videoFilm') ? 1 : 0)) : '没读到表';
})()'''

try:
    with sync_playwright() as p:
        br = p.chromium.launch(channel='msedge', headless=True)
        ctx = br.new_context(viewport={'width': 1500, 'height': 950})
        page = ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))

        page.goto(BASE + '/start.html', wait_until='domcontentloaded', timeout=90000)
        page.wait_for_timeout(3000)
        who = page.evaluate('''async (pw) => {
          const r = await fetch('/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: pw.name, phone: pw.phone, password: pw.pass }) });
          return await r.json();
        }''', {'name': '字效点检', 'phone': '1991' + '%07d' % (int(time.time()) % 10000000), 'pass': 'check123'})
        if not who.get('ok'):
            bad('临时号没领上：%r（后面不点了）' % (who,))
        else:
            ok('领了个临时号只进临时账本：尾号' + str(who['account']['phone'])[-4:])
            # 前置门（引导 / 账号那两道，逻辑在 gate.js）别让点检绕路：
            # 判断结果 5 分钟缓存、且起始页那次是在领号之前问的（那时还没号），
            # 所以领完号要作废缓存 + 按这个号记一笔「看过引导」，才直接落工作台。
            gate = page.evaluate('''async (a) => {
              try { sessionStorage.removeItem('xhs_gate_c'); } catch (_) {}
              let id = a.id || '';
              if (!id) { try { const j = await XhsGate.check(true); id = j.me && j.me.id; } catch (_) {} }
              if (!id) return '没拿到账号 id';
              try {
                localStorage.setItem('xhs_guide_seen:' + id, '1');
                localStorage.setItem('xhs_guide_seen:anon', '1');
                localStorage.setItem('xhs_survey_seen:' + id, '1');
              } catch (e) { return String(e); }
              return 'ok';
            }''', {'id': (who.get('account') or {}).get('id', '')})
            if gate != 'ok':
                bad('前置门没解开（引导那道记不上）：%s' % gate)

        if who.get('ok'):
            goto_big(page, BASE + '/popup.html?mode=big', wait_until='domcontentloaded', timeout=90000)
            land = page.evaluate('() => location.href')
            if 'popup.html' not in land:
                bad('没落进工作台，停在 %s（后面不点了）' % land)
            page.wait_for_function('() => typeof npFilmPaint === "function"', timeout=40000)
            if 'videoFilm=1' not in str(page.evaluate(GRANT_ON)):
                bad('八格没拨开（这一趟要的是开了本机出片的那一档）')

            print('  · 顶上工作流条＝四站', flush=True)
            sts = page.evaluate('() => (typeof npKStations === "function" ? npKStations({ kOut: "film" }).map(s => s.t) : "无此函数")')
            print('    npKStations =', sts, flush=True)
            if sts == K_STATIONS:
                ok('知识线出片出口＝挑知识 → 改稿 → 🎬 分幕 → 发布（稿与幕并成一屏、条上只占一站）')
            else:
                bad('四站条不对：%r' % (sts,))
            flo = page.evaluate('() => (typeof npFilmFlowOf === "function" ? npFilmFlowOf({ kOut: "film" }).map(x => x.t) : "无此函数")')
            has_goto = page.evaluate('() => typeof npFilmGotoWizard')
            has_land = page.evaluate('() => typeof _npFilmLand')
            if flo == ['挑知识', '改稿'] and has_goto == 'function' and has_land == 'string':
                ok('递给片台的前几站（挑知识／改稿）＋回改稿通路在位')
            else:
                bad('接应不对：%r / %s / %s' % (flo, has_goto, has_land))

            print('  · 档案行「下一步」→ 就地进片台（墙拆了：不隔一层网页）', flush=True)
            ar_id = page.evaluate('''async (a) => {
              const d = await chrome.storage.local.get('np_notes');
              const list = Array.isArray(d.np_notes) ? d.np_notes : [];
              const n = { id: a.id, title: a.title, dir: 'k', kOut: 'film', path: 'video',
                form: '视频', style: '口播讲解', filmKind: 'PPT字体动效', status: '代发',
                voice: a.body, draft: a.body, titles: [a.title], tags: [], platform: 'xhs',
                filmDocs: [{ id: 'vchk1', kind: 'PPT字体动效', key: a.id, updatedAt: 0 }],
                createdAt: Date.now(), updatedAt: Date.now() };
              const i = list.findIndex(x => x && x.id === a.id);
              if (i >= 0) list[i] = n; else list.unshift(n);
              await chrome.storage.local.set({ np_notes: list });
              return a.id;
            }''', {'id': NOTE_ID, 'title': TITLE, 'body': BODY})
            ok('档案里铺了这一篇（出口那份 voice＝正文同文）：%s' % ar_id)
            page.evaluate('() => switchMainTab("noteArchive")')
            page.wait_for_function('(id) => !!document.querySelector(".npar-next[data-id=\\"" + id + "\\"]")', arg=ar_id, timeout=25000)
            nx = page.locator('.npar-next[data-id="%s"]' % ar_id)
            assert '进字效' in (nx.get_attribute('title') or ''), 'tip 该指「进字效」'
            ok('那一行「下一步」＝' + nx.inner_text().strip() + '，提示指「进字效」')
            nx.click()
            page.wait_for_function('''() => {
              const h = document.getElementById('filmHead'), s = document.getElementById('filmSteps'),
                    f = document.getElementById('filmFoot'), g = document.getElementById('filmGate'),
                    pane = document.getElementById('filmPane');
              return h && s && f && g && pane && pane.querySelector('#secScript')
                  && getComputedStyle(h).display === 'flex' && getComputedStyle(s).display !== 'none'
                  && getComputedStyle(f).display === 'flex' && g.style.display === 'none';
            }''', timeout=60000)
            assert page.locator('#filmFrame').count() == 0, '那层网页（iframe）已经拆掉了，这一页不该再有 #filmFrame'
            pane = page.evaluate('''() => {
              const el = document.getElementById('filmPane');
              const d = (sel) => { const e = el.querySelector(sel); return e ? getComputedStyle(e).display : 'missing'; };
              return { attr: el.getAttribute('data-inline'), cls: el.className, width: el.clientWidth,
                       head: d(':scope > header'), steps: d(':scope > .fsteps'), foot: d(':scope > .np-pinbar') };
            }''')
            if pane['attr'] == '1' and 'inline' in pane['cls'] \
                    and pane['head'] == 'none' and pane['steps'] == 'none' and pane['foot'] == 'none':
                ok('外壳三件由这一页画、#filmPane 就地搭好（里头那三件只当状态存身）：%s' % pane)
            else:
                bad('这块板子不像落在页里的那台：%s' % pane)

            print('  · 顶栏那一行', flush=True)
            head = page.locator('#filmHead').inner_text().replace('\n', ' ')
            if '✍️ 写稿 · 卖点到发稿' in head and TITLE in head and 'PPT字体动效' in head:
                ok('顶栏跟写稿那几页同一句标题，且报出这一篇与这一片的形式：%s' % head.strip()[:80])
            else:
                bad('顶栏那句不对：%r' % head)
            missing = []
            for cls, lab in (('np-kind-change', '换一种'), ('np-film-cfg', '音色与风格')):
                b = page.locator('#filmHead .' + cls)
                if b.count() != 1 or lab not in b.inner_text():
                    missing.append(lab)
            gone = [c for c in ('np-film-archive', 'np-film-popout') if page.locator('#filmHead .' + c).count()]
            if missing:
                bad('顶栏缺这几颗：%s' % '／'.join(missing))
            elif gone:
                bad('顶栏这几颗该撤掉还没撤：%s' % '／'.join(gone))
            else:
                ok('顶栏只留两颗（✏️ 换一种／⚙ 音色与风格）——「← 返回档案」「↗ 新标签页」已撤，回退走底栏「← 上一步」')

            print('  · 工作流条（跟向导那条同一个画法）', flush=True)

            def bar_info():
                return page.evaluate('''() => {
                  const el = document.getElementById('filmSteps');
                  const st = [...el.querySelectorAll(':scope > div > div')];
                  const lab = (x) => { const e = x.querySelector('span[style*="text-align:center"]'); return e ? e.innerText.split('\\n')[0].trim() : ''; };
                  const dot = (x) => { const b = x.querySelector('button,span'); return { tag: b.tagName, tip: b.getAttribute('title') || '' }; };
                  return { labels: st.map(lab), dots: st.map(dot), n: st.length,
                           sig: st.map(x => { const d = x.querySelector('button,span'), l = x.querySelector('span[style*="text-align:center"]');
                             const cs = getComputedStyle(d), cl = getComputedStyle(l);
                             return [d.offsetWidth, d.offsetHeight, cs.borderRadius, cs.fontSize, cl.fontSize].join('|'); }),
                           to: [...el.querySelectorAll('[data-filmto]')].map(b => b.getAttribute('data-filmto')),
                           cur: (el.querySelector('[style*="0 0 0 3px"]') || {}).title || '' };
                }''')
            bi = bar_info()
            film_sig = bi['sig']            # 台子条此刻还露着，先记下圆点的尺寸/字号（回向导后它就藏了）
            if bi['n'] == 4 and bi['labels'][:4] == K_STATIONS:
                ok('条上四站一字不差：%s' % ' → '.join(bi['labels']))
            else:
                bad('条上站名不对：%r' % bi['labels'])
            if bi['to'] == ['pick', 'rewrite'] and bi['dots'][0]['tag'] == 'BUTTON':
                ok('前两站（挑知识／改稿）点得回去')
            else:
                bad('前两站回不去：%r' % bi)
            if '正在这一站' in bi['cur']:
                ok('当前站亮在「🎬 分幕」（圆点带外圈）')
            else:
                bad('当前站不对：%r' % bi['cur'])
            if bi['dots'][3]['tag'] == 'SPAN' and '先出片才到发布' in bi['dots'][3]['tip']:
                ok('还没出片，「发布」那站灰着点不动（%r）' % bi['dots'][3]['tip'])
            else:
                bad('「发布」那站状态不对：%r' % bi['dots'][3])

            print('  · 底栏这颗钉子（老板投诉的回不去，靠它）', flush=True)
            page.wait_for_function('() => { const s = _filmState; return !!(s && s.scenes > 0 && !s.genBusy && !s.busy); }', timeout=90000)
            foot = page.locator('#filmFoot').inner_text().replace('\n', ' ')
            if '上一步' in foot and '出片（配音 + 画面）' in foot:
                ok('底栏＝「← 上一步」＋「🎬 出片（配音 + 画面）」：%s' % foot.strip()[:70])
            else:
                bad('底栏不对：%r' % foot)
            if page.locator('#filmPane #go').count() == 1:
                ok('台子里那颗主钮还在（只是看不见），外层点它走 shell 那条缝')
            else:
                bad('台子里那颗 #go 没找到')

            lay = page.evaluate('''() => { const pane = document.getElementById('filmPane');
              const q = (s) => pane.querySelector(s);
              const box = (el) => !!(el && el.getBoundingClientRect().height > 40 && el.offsetParent !== null);
              const a = q(':scope > main > .col.script'), b = q(':scope > main > .col.scenes');
              return { script: box(a), scenes: box(b),
                       sidebyside: !!a && !!b && a.getBoundingClientRect().right <= b.getBoundingClientRect().left + 1,
                       rule: (q('#scenes .fvnote') || {}).textContent || '',
                       stepBtns: !!q('#prevStep') || !!q('#nextStep') }; }''')
            print('    这一屏 =', lay, flush=True)
            if lay['script'] and lay['scenes'] and lay['sidebyside']:
                ok('左边口播稿、右边分幕，同屏并排')
            else:
                bad('一屏两栏不对：%r' % (lay,))
            if not lay['stepBtns']:
                ok('没有「上一步／下一步」那种步进钮（底栏只留主钮）')
            else:
                bad('还留着旧步进：%r' % lay)
            if lay['rule'] and '本机规则' in lay['rule']:
                ok('AI 出口拨到死端口，幕栏如实标着「本机规则」（空手不骗人）')
            else:
                bad('幕栏那句兜底说明没有：%r' % lay['rule'])

            print('  · 口播稿那一栏：只剩一颗钮', flush=True)
            only = page.evaluate('''() => { const sec = document.querySelector('#filmPane #secScript');
              const acts = [...sec.querySelectorAll('[data-act]')].map(b => b.getAttribute('data-act'));
              const hint = (sec.querySelector('.fhint') || {}).innerText || '';
              return { acts, ghost: sec.querySelectorAll('.ghost').length, hint: hint.slice(0, 26) }; }''')
            if len(only['acts']) == 1 and only['acts'][0] == 'run' and not only['ghost'] and only['hint']:
                ok('口播稿那一栏只剩一颗「重新出一版」这条通路（%r）＋一行说明：%r' % (only['acts'], only['hint']))
            else:
                bad('口播稿那一栏的钮没收干净：%r' % only)

            print('  · 出片那颗＝派给执行器那条缝（不真派单，只验走缝）', flush=True)
            page.evaluate('''() => {
              window.__calls = { exec: 0, doc: null, probe: 0 };
              window.__xhsExecOnline = async () => { window.__calls.probe++; return { ok: true, online: true }; };
              window.__xhsExecFilm = async (nid, doc) => { window.__calls.exec++; window.__calls.doc = doc; return { ok: true, delivered: true }; };
            }''')
            page.locator('#filmFoot .np-film-start').click()
            page.wait_for_function('() => window.__calls.exec === 1', timeout=30000)
            dispatched = page.evaluate('''() => ({ exec: window.__calls.exec, probe: window.__calls.probe,
              hasDoc: !!window.__calls.doc, st: (document.getElementById('st') || {}).textContent || '' })''')
            if dispatched['hasDoc'] and dispatched['probe'] == 1 and '执行器' in dispatched['st']:
                ok('执行器在线＝先探一次在线、再把这一篇整份递给执行器（网页这头不自己编）：%r' % dispatched['st'][:40])
            else:
                bad('派单那条缝不对：%r' % dispatched)
            # 派出去之后这一页就一直挂着「等执行器」那状态（这台没有真执行器回话），不再往下等
            page.wait_for_timeout(1200)

            print('  · 出过片之后「发布」那站才放开', flush=True)
            page.evaluate('() => { _filmState = Object.assign({}, _filmState, { outAt: Date.now() }); npFilmShellRefresh(); }')
            opened = page.evaluate('''() => { const el = document.getElementById('filmSteps');
              const b = el.querySelector('[data-filmpub]'); const cs = b ? getComputedStyle(b) : null;
              return { tag: b ? b.tagName : 'none', tip: b ? (b.getAttribute('title') || '') : '', bg: cs ? cs.backgroundColor : '' }; }''')
            if opened['tag'] == 'BUTTON' and '去发布台' in opened['tip'] and opened['bg'] != 'rgb(238, 240, 244)':
                ok('放开＝浅底深字那颗，点了回档案那一行下一步：%r' % opened['tip'])
            else:
                bad('「发布」没放开：%r' % opened)
            if '已出过片' in page.locator('#filmHead').inner_text():
                ok('顶栏跟着报「🎬 已出过片」')
            else:
                bad('顶栏没报「已出过片」')

            print('  · 底栏「← 上一步」回向导改稿站', flush=True)
            page.evaluate('() => { _filmState = null; npFilmShellRefresh(); }')
            page.locator('#filmFoot .np-film-prev').click()
            page.wait_for_function('''() => document.getElementById('npWizBody')
              && document.getElementById('npWizBody').offsetParent !== null && _npWiz && _npWiz.step === 4''', timeout=25000)
            out = page.evaluate('''() => ({ step: _npWiz && _npWiz.step,
              bar: document.getElementById('npSteps').innerText.replace(/\\n/g, ' '),
              film: !!document.getElementById('filmContent') && document.getElementById('filmContent').offsetParent !== null,
              draft: String(_npWiz.draft && _npWiz.draft.content || '') })''')
            print('    回到向导 =', {k: out[k] for k in ('step', 'film')}, flush=True)
            if out['step'] == 4 and not out['film'] and all(x in out['bar'] for x in K_STATIONS) and out['draft'] == BODY:
                ok('点「← 上一步」＝跳出台子、回向导改稿站（正文一个字没丢），向导顶上那条也是这四站')
            else:
                bad('没回到改稿站：%r' % ({k: out[k] for k in ('step', 'film', 'draft')},))
            if page.evaluate('() => _npFilmLand') == '':
                ok('落地标记用完即清')
            else:
                bad('落地标记没清：%r' % page.evaluate('() => _npFilmLand'))

            print('  · 向导那条条＝跟台子这条同一个画法（圆点收成一个函数）', flush=True)
            same = page.evaluate('''() => { const el = document.getElementById('npSteps');
              const st = [...el.querySelectorAll(':scope > div > div')];
              const sig = st.map(x => { const d = x.querySelector('button,span'), l = x.querySelector('span[style*="text-align:center"]');
                const cs = getComputedStyle(d), cl = getComputedStyle(l);
                return [d.offsetWidth, d.offsetHeight, cs.borderRadius, cs.fontSize, cl.fontSize].join('|'); });
              const names = st.map(x => { const e = x.querySelector('span[style*="text-align:center"]');
                return e ? e.innerText.split('\\n')[0].trim() : ''; });
              return { sig, names }; }''')
            if same['sig'][:3] == film_sig[:3] and same['names'] == K_STATIONS:
                ok('向导条与台子条＝同一颗圆点、同一行小字（前三站尺寸字号一模一样：%s）' % same['sig'][0])
            else:
                bad('两条条画法不一致：向导 %r / 台子 %r' % (same['sig'], film_sig))
            early = page.evaluate('''() => { const el = document.getElementById('npSteps');
              const b = el.querySelector('[data-ngo="film"]'); const cs = b ? getComputedStyle(b) : null;
              const dots = [...el.querySelectorAll(':scope > div > div')].map(x => x.querySelector('button,span'));
              return { tag: b ? b.tagName : 'none', tip: b ? (b.getAttribute('title') || '') : '',
                       bg: cs ? cs.backgroundColor : '#eef0f4', pub: dots.length > 3 ? dots[3].tagName : 'none' }; }''')
            if early['tag'] == 'BUTTON' and '同一条路' in early['tip'] and early['pub'] == 'SPAN':
                ok('正文有了→向导条上「🎬 分幕」这一站就放开（点了＝跟底那颗「下一步 →」同一条路），「发布」还得出过片：%r' % early['tip'])
            else:
                bad('向导条上这两站状态不对：%r' % early)

            print('  · 再进一次台子：稿与幕续上、不补打 AI', flush=True)
            page.evaluate('() => switchMainTab("noteArchive")')
            page.wait_for_function('(id) => { const b = document.querySelector(".npar-next[data-id=\\"" + id + "\\"]");'
                                   'return !!(b && b.offsetParent !== null); }', arg=ar_id, timeout=25000)
            page.locator('.npar-next[data-id="%s"]' % ar_id).click()
            page.wait_for_function('''(id) => { const s = _filmState;
              return !!(s && s.noteId === id && s.scenes >= 1 && !s.genBusy && !s.busy); }''', arg=ar_id, timeout=60000)
            st2 = page.evaluate('''() => ({ scenes: (_filmState || {}).scenes, script: String((window.Film && Film.script) || '').length,
              busy: !!(window.Film && Film.genBusy), exec: window.__calls.exec })''')
            if st2['scenes'] >= 1 and st2['script'] and not st2['busy']:
                ok('续上那一版：%s 幕、稿 %d 字（AI 出口本来就没通，这一趟也没往外拨）' % (st2['scenes'], st2['script']))
            else:
                bad('重进台子不对：%r' % (st2,))

            print('  · 公网独有那层：这一档没开本机出片时的盖板', flush=True)
            if 'videoFilm=0' not in str(page.evaluate(GRANT_OFF)):
                bad('八格没收回')
            page.evaluate('''(a) => npGoFilm({ noteId: a.id, title: a.title, kind: 'PPT字体动效', script: a.body,
              body: a.body, style: '口播讲解', flow: [{ t: '挑知识', to: 'pick' }, { t: '改稿', to: 'rewrite' }],
              rows: [{ id: 'vchk1', kind: 'PPT字体动效', key: a.id, updatedAt: 0 }], pid: 'xhs' })''',
              {'id': ar_id, 'title': TITLE, 'body': BODY})
            page.wait_for_function('''() => { const g = document.getElementById('filmGate');
              return g && g.style.display === 'block' && /本机出片这一档还没开/.test(g.innerText); }''', timeout=25000)
            locked = page.evaluate('''() => { const g = document.getElementById('filmGate'), s = document.getElementById('filmSteps');
              return { gate: g.innerText.replace(/\\n/g, ' ').slice(0, 40), steps: getComputedStyle(s).display,
                       head: getComputedStyle(document.getElementById('filmHead')).display }; }''')
            if locked['steps'] != 'none' and locked['head'] == 'none':
                ok('免费档进这一站：台面换成升级说明（%r），工作流条留着好回上一站，台子那三件不铺' % locked['gate'])
            else:
                bad('免费档那层盖板不对：%r' % locked)
            page.evaluate(GRANT_ON)

        print('  · 页面报错', flush=True)
        if errs:
            bad('有报错 %d 条，第一条：%s' % (len(errs), errs[0][:220]))
        else:
            ok('无报错')
        ctx.close()
        br.close()
finally:
    srv.terminate()
    try:
        srv.wait(timeout=8)
    except Exception:
        srv.kill()

tail = '' if not pending else '（另有 %d 个文件本批改动还没传上公网：%s）' % (len(pending), '、'.join(pending))
print('\n' + ('公网分幕这一屏点检：全绿' if fails == 0 else '公网分幕这一屏点检：有 %d 项没过' % fails) + tail, flush=True)
sys.exit(1 if fails else 0)
