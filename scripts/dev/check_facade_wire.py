# 🪟 门面笔记批 4 点检 —— 接线与收口（公网那份 web/popup.js）。
# 需求档案：资料/发笔记-门面笔记设计.md（碰撞 #1 / #2 / #3＋批4 清单）
# 这一支只看四件事：
#   ① 档案那行「下一步」状态机认门面篇：没稿→编辑进门面流；有稿没出口→选出口；封面没定→还差封面（⑤ 那一站）；齐了（talk）→还没录给「拿逐句录的链接」、录完给成片预览（2026-10-19 三档改版后的口径）（永不指回写稿/出图/出片那几条线）
#   ② 门面篇标「代发」不会被自动抓进每周格子，toast 是指去「🆕 写好等排期」自己挑位子；引流篇照旧能排上
#   ③ 规划页旧「📌 置顶 / 门面」那块撤了，换成两篇的要求说明（段名摊开＋缺哪篇的指路＋不占格子＋案例那句）
#   ④ 「✏️ 编辑」按下去真落在门面那条流上（台上状态切到 facade、页面容器是写稿那一格）
# 本机：node 起一台只用临时账本的服务器（DEMO_DATA_DIR 指 tmp/，绝不碰 server/data/），AI 出口拨到小桩。
# 用法：python3 -X utf8 scripts/dev/check_facade_wire.py
import os
import sys
import time
import socket
import threading
import subprocess
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright
from _guide_gate import goto_big

sys.stdout.reconfigure(encoding='utf-8')
REPO = Path(__file__).resolve().parents[2]
PORT = 8905
BASE = 'http://127.0.0.1:%d' % PORT
DATA = REPO / 'tmp' / 'facade-wire-check' / 'data'
fails = 0


def ok(msg):
    print('  PASS ' + msg, flush=True)


def bad(msg):
    global fails
    fails += 1
    print('  FAIL ' + msg, flush=True)


class Stub(BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get('content-length') or 0))
        body = b'{"choices":[{"message":{"content":"{}"}}]}'
        self.send_response(200)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


JS = r'''async () => {
  const miss = [];
  ['npArNext', 'npArGoNext', 'npAutoPlaceNote', 'npDirNewNote', 'npNotesAll', 'npArchiveCoerce',
    'npFacadeSave', 'switchMainTab'].forEach(k => { if (typeof window[k] !== 'function') miss.push(k); });
  // 规划页那块的实现被拆到「点开那一页才下载」的小包里（首屏提速），先把它要过来再说
  if (typeof _diagFacadeHtml !== 'function' || typeof diagRenderPlan !== 'function') {
    const P = window.__wbPacks && window.__wbPacks['diag'];
    if (P && typeof P.go === 'function') { await P.go(); }
  }
  if (typeof _diagFacadeHtml !== 'function') miss.push('_diagFacadeHtml(规划页小包没下载上)');
  if (typeof FACADE_OUTLINE === 'undefined') miss.push('FACADE_OUTLINE');
  if (miss.length) return { err: '页面里没有 ' + miss.join(' / '), url: location.href };

  const r = {};
  // ── ① 状态机：拿一篇真建出来的介绍篇当底子，只改档案上那几个字段 ──
  const ni = await npDirNewNote('f', '口播稿', 'intro');
  const nd = await npDirNewNote('f', '长文', 'deal');
  const list = await npNotesAll();
  const base = () => {
    const n = npArchiveCoerce(JSON.parse(JSON.stringify(list.find(x => x.id === ni.id))));
    n.draft = '我是老张，在成都做旧房翻新。';
    return n;
  };
  const COV = { name: '封面·大字压中·1.4s', lay: 'big', cTitle: '', at: 1.4, thumb: 'data:image/jpeg;base64,/9j/4AAQ', url: 'idb:cover:xx' };
  const S = [
    ['没稿', Object.assign(base(), { fSegs: null })],
    ['有稿没出口', Object.assign(base(), { fSegs: [['我是老张'], ['天天在工地']] })],
    ['出口了没封面', Object.assign(base(), { fSegs: [['我是老张']], fGate: 'talk', fCover: null })],
    ['齐了·还没录', Object.assign(base(), { fSegs: [['我是老张']], fGate: 'talk', fCover: COV })],
    ['齐了·录完了', Object.assign(base(), { fSegs: [['我是老张']], fGate: 'talk', fCover: COV, lip: { id: 'l1', route: 'self', state: 'taken' } })],
    ['齐了但归档', Object.assign(base(), { fSegs: [['我是老张']], fGate: 'talk', fCover: COV, status: '已归档' })],
    ['齐了但已发', Object.assign(base(), { fSegs: [['我是老张']], fGate: 'talk', fCover: COV, status: '已发' })],
  ];
  r.nx = S.map(([k, n]) => { const x = npArNext(n, null); return { k, lab: x.lab, to: x.to, dim: !!x.dim, tip: x.tip }; });
  // 承接篇是一篇长文：有稿但还没存成长文＝回那条流走收口；存成长文＝齐了（不逼人选出口、也不问封面）
  const dBase = () => Object.assign(npArchiveCoerce(JSON.parse(JSON.stringify(list.find(x => x.id === nd.id)))),
    { fSegs: [['这篇是干什么的']], fGate: '', fCover: null });
  const dx = npArNext(Object.assign(dBase(), { draft: '来了先看这篇' }), null);
  r.dealNoLong = { to: dx.to, lab: dx.lab, tip: dx.tip };
  const dx2 = npArNext(Object.assign(dBase(), { longform: '来了先看这篇，报价按平方算。' }), null);
  r.dealLong = { to: dx2.to, lab: dx2.lab };
  // 别的方向照旧（没被门面那颗分支带歪）
  const kn = npArchiveCoerce({ id: 'kk', dir: 'k', status: '草稿', form: '图文', voice: '' });
  const cn = npArchiveCoerce({ id: 'cc', dir: 'c', status: '草稿', form: '视频', voice: '' });
  const kx = npArNext(kn, null), cx = npArNext(cn, null);
  r.regress = { k: { lab: kx.lab, to: kx.to }, c: { lab: cx.lab, to: cx.to } };

  // ── ② 不进每周排法：那篇直接标成「代发」（档案行上那颗下拉就是这么改的），再点自动排位子 ──
  const markDai = async (id) => {
    const k = NP_NOTES_KEY;
    const o = await chrome.storage.local.get(k);
    const l = o[k] || [];
    const z = l.find(x => x && String(x.id) === String(id));
    if (z) z.status = '代发';
    await chrome.storage.local.set({ [k]: l });
  };
  const toasts = [];
  const realToast = window.toast;
  window.toast = (m) => { toasts.push(String(m || '')); };
  await markDai(ni.id);
  const rf = await npAutoPlaceNote(ni.id);
  const di = await npDirNewNote('d', '图文', '');
  await markDai(di.id);
  const rd = await npAutoPlaceNote(di.id);
  const wi = await npDirNewNote('i', '图文', '');
  await markDai(wi.id);
  const ri = await npAutoPlaceNote(wi.id);
  window.toast = realToast;
  r.place = {
    f: { placed: rf.placed, why: rf.why, toast: toasts[0] || '' },
    d: { placed: rd.placed, why: rd.why || '', toast: toasts[1] || '' },
    i: { placed: ri.placed, why: ri.why || '', toast: toasts[2] || '' },
    n: toasts.length,
  };

  // ── ③ 规划页那块新说明 ──
  const h = _diagFacadeHtml();
  const plain = h.replace(/<[^>]+>/g, '');
  r.facadeHtml = {
    introSegs: ['我是谁', '我天天在干什么', '我能帮你办什么事', '我做事的规矩', '凭什么信我', '你来找我怎么走'].every(k => plain.includes(k)),
    dealSegs: ['这篇是干什么的', '你最常问我的几件事', '钱怎么算', '什么情况我不接', '怎么找我'].every(k => plain.includes(k)),
    noSlot: plain.includes('不进每周排法') && plain.includes('不占这里的格子'),
    pointer: plain.includes('笔记档案') && plain.includes('去建'),
    caseLine: plain.includes('从已发的案例篇里挑最强'),
    labs: [plain.includes('个人介绍'), plain.includes('成交承接')],
    len: h.length,
  };
  // 旧那块真的不画了：pinned 有内容也不出现「📌 置顶 / 门面」那串
  r.pinnedGone = !(typeof diagRenderPlan === 'function') ? 'no-fn'
    : (() => {
        _diagState.notePlan = { stage: 'a', items: [{ title: '测试一篇', kind: 'k' }],
          pinned: { title: '旧规划给的置顶建议', outline: '旧提纲一句话' } };
        const box = document.createElement('div'); box.id = 'diagPlanResult';
        document.body.appendChild(box);
        diagRenderPlan();
        const out = box.innerHTML; box.remove(); _diagState.notePlan = null;
        return { noOld: !out.includes('📌 置顶 / 门面'), noAiTitle: !out.includes('旧规划给的置顶建议'),
                 hasNew: out.includes('主页门面两篇'), hasTable: out.includes('内容排产表') };
      })();

  // ── ④ 「✏️ 编辑」按下去落在门面那条流上 ──
  await npArGoNext(list.find(x => x.id === ni.id), 'facade');
  await new Promise(res => setTimeout(res, 1200));
  r.landed = {
    mode: typeof _npMode !== 'undefined' ? _npMode : 'no-var',
    idMatch: (typeof _npFac !== 'undefined' && _npFac) ? String(_npFac.arId) === String(ni.id) : false,
    facKind: (typeof _npFac !== 'undefined' && _npFac) ? _npFac.kind : '',
    shown: ['notePublishContent', 'noteArchiveContent'].map(id => { const e = document.getElementById(id); return e ? e.style.display : 'x'; }),
    bodyHasFlow: !!document.getElementById('npFacSteps'),
  };
  switchMainTab('noteArchive');
  return r;
}'''


def main():
    print('── 🪟 门面笔记批 4：下一步状态机 + 不进周排 + 规划页说明 + 落点（公网那份）──', flush=True)
    import shutil
    if DATA.exists():
        shutil.rmtree(DATA)
    DATA.mkdir(parents=True, exist_ok=True)
    stub = ThreadingHTTPServer(('127.0.0.1', 0), Stub)
    threading.Thread(target=stub.serve_forever, daemon=True).start()
    env = dict(os.environ)
    env['DEMO_DATA_DIR'] = str(DATA)
    env['PORT'] = str(PORT)
    env['DEMO_AI_KEY'] = 'check-only'
    env['DEMO_AI_BASE'] = 'http://127.0.0.1:%d/v1' % stub.server_port
    env['DEMO_SIGNUP_MAX'] = '60'
    logf = open(REPO / 'tmp' / 'facade-wire-check.server.log', 'w', encoding='utf-8')
    srv = subprocess.Popen(['node', str(REPO / 'server' / 'dev-server.mjs')], env=env, stdout=logf, stderr=subprocess.STDOUT)
    for _ in range(80):
        try:
            socket.create_connection(('127.0.0.1', PORT), 1).close()
            break
        except OSError:
            time.sleep(0.5)
    else:
        bad('服务器没起来（看 tmp/facade-wire-check.server.log）')
        return
    time.sleep(2)
    try:
        with sync_playwright() as p:
            br = p.chromium.launch(channel='msedge', headless=True)
            page = br.new_context(viewport={'width': 1500, 'height': 950}).new_page()
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
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
            page.wait_for_timeout(5000)
            r = page.evaluate(JS)
            shot = REPO / 'tmp' / 'facade-wire-check'
            shot.mkdir(parents=True, exist_ok=True)
            try:
                page.screenshot(path=str(shot / 'after.png'))
            except Exception as e:
                print('  （照片没拍成：%s）' % e, flush=True)
            br.close()
        if isinstance(r, dict) and r.get('err'):
            bad(r['err'])
            return
        if errs:
            bad('页面报错 %d 条：%s' % (len(errs), errs[0][:160]))

        exp = {
            '没稿': ('✏️ 编辑', 'facade'),
            '有稿没出口': ('✏️ 编辑', 'facade'),
            '出口了没封面': ('✏️ 编辑', 'facade'),
            '齐了·还没录': ('🎥 拿逐句录的链接', 'selfnew'),
            '齐了·录完了': ('🎬 成片预览', 'preview'),
            '齐了但归档': ('已归档', ''),
            '齐了但已发': ('👀 预览', 'preview'),
        }
        for row in r['nx']:
            e = exp.get(row['k'])
            if e and (row['lab'], row['to']) == e:
                ok('门面「%s」→ 按钮「%s」落点「%s」：%s' % (row['k'], row['lab'], row['to'] or '—', row['tip'][:38]))
            else:
                bad('门面「%s」状态机不对：lab=%s to=%s（想要 %s）' % (row['k'], row['lab'], row['to'], e))
        if r['nx'][1]['tip'].find('选出口') >= 0 and r['nx'][2]['tip'].find('还差封面') >= 0:
            ok('悬停那句话分别说清「还差选出口」「还差封面（⑤ 那一站挑一帧或传自己的图；字幕没加不拦）」')
        else:
            bad('悬停话不对：%s / %s' % (r['nx'][1]['tip'], r['nx'][2]['tip']))
        if r['dealNoLong']['to'] == 'facade' and '长文' in r['dealNoLong']['tip'] \
                and r['dealLong']['to'] == 'preview' and r['dealLong']['lab'] == '👀 预览':
            ok('承接篇是一篇长文：有稿还没存成长文＝回那条流收口；存成长文＝算齐了（不逼人选出口、也不问封面）')
        else:
            bad('承接篇那格不对：%s / %s' % (r['dealNoLong'], r['dealLong']))
        if r['regress']['k'] == {'lab': '✏️ 编辑', 'to': 'write'} and r['regress']['c']['to'] == 'case':
            ok('知识 / 案例那两条老路没被门面分支带歪')
        else:
            bad('回归：知识 %s / 案例 %s' % (r['regress']['k'], r['regress']['c']))

        if r['place']['f']['placed'] is False and r['place']['f']['why'] == 'facade' \
                and '不进每周排法' in r['place']['f']['toast'] and '写好等排期' in r['place']['f']['toast']:
            ok('门面篇标「代发」：不占周格子，toast＝「🪟 门面篇不进每周排法，去「🆕 写好等排期」自己选位子」（%s）' % r['place']['f']['toast'][:30])
        else:
            bad('门面篇排位子不对：%s' % r['place']['f'])
        if r['place']['d']['placed'] is True or r['place']['d']['why'] == 'noslot':
            ok('引流篇照旧走自动排位子（这次：%s）' % ('排上了' if r['place']['d']['placed'] else '没空位'))
        else:
            bad('引流篇排位子被带歪：%s' % r['place']['d'])
        if r['place']['i']['why'] == 'nodir' and '玩法篇' in r['place']['i']['toast']:
            ok('IP 玩法篇那句老提示没动')
        else:
            bad('IP 篇提示变了：%s' % r['place']['i'])

        fh = r['facadeHtml']
        if fh['introSegs'] and fh['dealSegs']:
            ok('规划页新说明：两份提纲的段名摊开（介绍 6 段 + 承接 5 段）')
        else:
            bad('段名没摊全：%s' % fh)
        if fh['noSlot'] and fh['pointer'] and fh['caseLine'] and all(fh['labs']):
            ok('新说明带齐三句：不占每周格子 / 缺哪篇去档案横幅「去建」 / 案例从已发的挑最强手动置顶')
        else:
            bad('新说明缺句：%s' % fh)
        pg = r['pinnedGone']
        if pg == 'no-fn':
            bad('规划页渲染函数找不到')
        elif pg['noOld'] and pg['noAiTitle'] and pg['hasNew'] and pg['hasTable']:
            ok('旧「📌 置顶 / 门面」那块撤了：规划再产出 pinned 界面也不画，排产表照旧')
        else:
            bad('旧块没撤干净：%s' % pg)

        ld = r['landed']
        if ld['mode'] == 'facade' and ld['idMatch'] and ld['facKind'] == 'intro' \
                and ld['shown'] == ['', 'none'] and ld['bodyHasFlow']:
            ok('按「✏️ 编辑」真落进门面那条流：台上停在这一篇（%s）、容器是写稿那一格、步进条已搭好' % ld['facKind'])
        else:
            bad('落点不对：%s' % ld)
    finally:
        srv.terminate()
        logf.close()
    print('── 结果：%s ──' % ('全过' if not fails else '%d 条没过' % fails), flush=True)
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
