# 公网那份（web/）的「📋 整组提示词」点检 —— 2026-10-21 二次改口。
# 老板原话：「我营销大图，然后我的正文是什么？我要描述的配图是什么？背景是什么？……正文要用到的，不要全部放进去；
#          配图的文案是什么，描述清楚；配文不需要短字。」
# 2026-10-21 三次改口：选了手机随拍就照随拍给拍法（手持/现场光/不修图），选广告片就照影棚那一套给；
# 所以这一份点检只看：整套一条（第 1 张到第 N 张）／组头说清画面形式与文案口吻／每张按块
#                   （这段正文 / 这张要说明 / 配图画面 / 背景 / 机位 / 图上文案）／正文只取这一张那一两句／
#                   不再出现「图上就写这几个字」「短大字」「字摆哪」这类排版指令／档案那条跟整组同文。
# 本机：node 起一台只用临时账本的服务器（DEMO_DATA_DIR 指 tmp/，绝不碰 server/data/），AI 出口拨到小桩。
# 用法：python3 -X utf8 scripts/dev/check_group_prompt_web.py
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
PORT = 8899
BASE = 'http://127.0.0.1:%d' % PORT
DATA = REPO / 'tmp' / 'group-prompt-check' / 'data'
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


JS = r'''() => {
  if (typeof npDshGroupOf !== 'function') return { err: '这份页面里没有 npDshGroupOf',
    url: location.href, hasNp: typeof npShotsCompose, hasTab: typeof switchMainTab,
    srcs: [...document.querySelectorAll('script[src]')].map(s => s.src).filter(s => /popup\.js|chrome-shim/.test(s)) };
  const shot = (n, topic, desc, cap) => ({ id: 's' + n, topic: topic, desc: desc, point: '重点句' + n,
    text: cap, role: '', keySid: '', keyText: cap, form: '', sids: [], cands: [], pick: -1, imgs: [],
    cap: { mode: '', zone: '', lines: [], labels: [], note: '' }, off: false });
  const wiz = (items, look, casting) => ({
    platform: 'xhs', dir: '', step: 4, arId: '', voice: '正文一句。',
    styleLook: casting ? { casting: casting } : {},
    draft: { content: '正文一句。', titles: ['题一句'] },
    shots: { style: '', seed: '', groupPrompt: '', look: look || {}, sents: [], suggest: [], editing: '',
      items: items, shotN: 0, cv: null }
  });
  const A = '【这一张要证明】三个人三个说法\n【画面里必须出现的元素】1. 一手夹着笔记；2. 捏着报价单\n【背景】建材城大门口，头顶一盏碘钨灯';
  const B = '报价单摊在膝盖上，笔尖停在空白的备注栏。';
  const w = wiz([shot(1, '建材城门口', A, '跑了两周，腰围先骗了我一次'),
                 shot(2, '空白报价单', B, '坑在没写进单子里的那一行'),
                 shot(3, '两块砖对比', '两块砖并排立着，指节敲釉面。', '')], { born: '手机随拍' });
  const g = npDshGroupOf(w);
  const per = [0, 1, 2].map(i => npShotPromptText(w, w.shots.items[i], i, 3, true));
  const cnt = (s, t) => s.split(t).length - 1;
  const line = t => g.split('\n').filter(l => l.indexOf(t) === 0).length;
  const out = {
    len: g.length,
    bornOpts: NP_LOOK_AXES.filter(a => a.k === 'born')[0].opts,
    groups: cnt(g, '营销配图'),
    seq: ['第 1 张', '第 2 张', '第 3 张'].every(t => g.indexOf(t) >= 0),
    phoneHead: cnt(g, '画面形式＝手机随拍'),
    phoneRules: cnt(g, '手机原相机直出'),
    copyRule: cnt(g, '像作者拍完随手打在手机上的一句话'),
    theme: cnt(g, '暗调实拍·单一暖光源'),
    camera: line('【机位】'),
    body: line('【这段正文】'),
    brief: line('【这张要说明】'),
    visual: line('【配图画面】'),
    bg: line('【背景】'),
    copy: line('【图上文案】'),
    copyFollow: g.split('\n').filter(l => l.indexOf('【图上文案】') === 0 && l.indexOf('写法照组头') >= 0).length,
    evid: cnt(g, '画面里要有：1. 一手夹着笔记；2. 捏着报价单'),
    longCopy: cnt(g, '跑了两周，腰围先骗了我一次'),
    bodies: g.split('\n').filter(l => l.indexOf('【这段正文】') === 0).map(l => l.length - '【这段正文】'.length),
    words: cnt(g, '图上就写这几个字'),
    noword: cnt(g, '这一张画面上不写字') + cnt(g, '图上要写一句大字'),
    oldDesc: cnt(g, '【这一张要证明】') + cnt(g, '画面里必须出现的元素') + cnt(g, '这一张画面上是'),
    oldHint: cnt(g, '那几个字') + cnt(g, '短大字') + cnt(g, '字要少') + cnt(g, '底色压暗') + cnt(g, '字摆'),
    same: per.every(p => g.indexOf(p) >= 0),
    noSnap: g.indexOf('手机随拍必须照做') >= 0,
    noGuard: g.indexOf('一次只出这一张完整画面') >= 0,
    noBanWords: g.indexOf('不要出现任何文字') >= 0,
    noBlank: g.indexOf('这一屏的字是后压的') >= 0,
    noLayer: (typeof npCapPlan === 'undefined') && (typeof npInkLayerHtml === 'undefined') && (typeof npBlankBlock === 'undefined'),
    empty: npDshGroupOf(wiz([], {})),
  };
  const cw = wiz([shot(1, '门口', A, '字一句')], { born: '手机随拍' }, '40 岁男瓦工，短寸头，深蓝工装外套袖口磨白');
  const cg = npDshGroupOf(cw);
  out.cast = cnt(cg, '每一张的主角都是同一个人');
  out.castOnce = cnt(cg, '40 岁男瓦工');
  const aw = wiz([shot(1, '门口', A, '字一句')], { born: '广告片' });
  const ag = npDshGroupOf(aw);
  out.adv = cnt(ag, '画面形式＝广告片') === 1 && cnt(ag, '色调：暗调、单一暖光') === 1;
  out.advNoSnap = ag.indexOf('手机随拍') < 0;
  out.aliasBorn = npLookShape({ born: '广告片精修' }).born;
  out.aliasSame = ag === npDshGroupOf(wiz([shot(1, '门口', A, '字一句')], { born: '广告片精修' }));
  const iw = wiz([shot(1, '门口', A, '字一句')], { born: '动漫插画' });
  const ig = npDshGroupOf(iw);
  out.illustPlain = ig.indexOf('手机随拍') < 0 && ig.indexOf('别拍成广告片') < 0;
  w.shots.groupPrompt = g;
  npShotsCompose(w);
  out.imagesSame = String(w.visual.images) === String(g);
  const cvw = wiz([shot(1, '门口', A, '字一句')], { born: '手机随拍' });
  cvw.shots.cv = { on: true, copy: '封面那一句', prompt: '', imgs: [], cap: {} };
  out.cover = npCoverPromptCompose(cvw, '画面：建材城门口那盏灯下面。');

  // 撤掉那一堆旋钮之后，把界面那几个渲染函数挨个跑一遍：漏删的引用会当场抛
  const w2 = wiz([shot(1, '建材城门口', A, '跑了两周，腰围先骗了我一次'), shot(2, '空白报价单', B, '坑在没写进单子里的那一行')],
                 { born: '手机随拍', casting: '40 岁男瓦工' });
  w2.shots.cv = { on: true, copy: '封面那一句', prompt: '封面画面一句。', imgs: [], cap: {}, text: '' };
  const calls = { npDshStepHtml: 1, npCoverPaneHtml: 1, npShotCardHtml: 2, npLookPanelHtml: 1, npPreviewHtml: 0, npShotsTableHtml: 1 };
  const render = {};
  Object.keys(calls).forEach((fn) => {
    if (typeof window[fn] !== 'function') { render[fn] = 'MISSING'; return; }
    try {
      const s = calls[fn] === 2 ? window[fn](w2, w2.shots.items[0], 1) : window[fn](w2);
      render[fn] = String(s || '').length;
    } catch (e) { render[fn] = 'THROW ' + e.message; }
  });
  try { npShotsCompose(w2); render.composeLen = String(w2.visual.images || '').length; }
  catch (e) { render.composeLen = 'THROW ' + e.message; }
  out.render = render;
  // 把 ⑤ 那一屏画到屏幕上留一张照（撤旋钮之后排版有没有塌）
  const host = document.createElement('div');
  host.id = 'npCheckShot';
  host.style.cssText = 'position:fixed;left:0;top:0;width:760px;background:#fff;z-index:99999;padding:14px;';
  host.innerHTML = npDshStepHtml(w2) + npCoverPaneHtml(w2) + npLookPanelHtml(w2) +
    '<div style="border:1px solid #ddd;padding:10px;">' + npShotCardHtml(w2, w2.shots.items[0], 1) + '</div>';
  document.body.appendChild(host);
  return out;
}'''


def main():
    print('── 公网那份（web/）整组提示词：一条管整套、画面形式带整套拍法（正文/说明/配图/背景/机位/文案）──', flush=True)
    DATA.mkdir(parents=True, exist_ok=True)
    stub = ThreadingHTTPServer(('127.0.0.1', 0), Stub)
    threading.Thread(target=stub.serve_forever, daemon=True).start()
    env = dict(os.environ)
    env['DEMO_DATA_DIR'] = str(DATA)
    env['PORT'] = str(PORT)
    env['DEMO_AI_KEY'] = 'check-only'
    env['DEMO_AI_BASE'] = 'http://127.0.0.1:%d/v1' % stub.server_port
    env['DEMO_SIGNUP_MAX'] = '60'
    logf = open(REPO / 'tmp' / 'group-prompt-check.server.log', 'w', encoding='utf-8')
    srv = subprocess.Popen(['node', str(REPO / 'server' / 'dev-server.mjs')], env=env, stdout=logf, stderr=subprocess.STDOUT)
    for _ in range(80):
        try:
            socket.create_connection(('127.0.0.1', PORT), 1).close()
            break
        except OSError:
            time.sleep(0.5)
    else:
        bad('服务器没起来（看 tmp/group-prompt-check.server.log）')
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
                bad('演示号没进上（新领的号会被账号门弹回问卷页）：%r' % (who,))
                br.close()
                return
            goto_big(page, BASE + '/popup.html?mode=big', wait_until='domcontentloaded', timeout=90000)
            page.wait_for_timeout(5000)
            r = page.evaluate(JS)
            page.set_viewport_size({'width': 1500, 'height': 2800})
            page.wait_for_timeout(600)
            shot = REPO / 'tmp' / 'group-prompt-check' / 'shot.png'
            try:
                page.locator('#npCheckShot').screenshot(path=str(shot))
            except Exception as e:
                bad('排版照片没拍成：%s' % e)
            br.close()
        if r.get('err'):
            bad(r['err'])
            return
        if r['groups'] == 1 and r['seq'] and r['len'] < 1600:
            ok('整套就一条：第 1 张到第 3 张按顺序在这一条里，收在 %d 字（< 1600）' % r['len'])
        else:
            bad('不是一条或太长：组头 %d 个、连号 %s、整条 %d 字' % (r['groups'], r['seq'], r['len']))
        if r['bornOpts'][:2] == ['手机随拍', '广告片'] and '实拍照片' not in r['bornOpts'] and '广告片精修' not in r['bornOpts']:
            ok('画面形式选项：手机随拍 / 广告片（旧「实拍照片」「广告片精修」已收）')
        else:
            bad('画面形式选项不对：%r' % (r['bornOpts'],))
        if r['phoneHead'] == 1 and r['phoneRules'] == 1 and r['copyRule'] == 1 and r['theme'] == 0:
            ok('界面上选「手机随拍」→ 组头一次说清随拍拍法与文案口吻，不再带影棚色调')
        else:
            bad('随拍组头不对：画面形式 %d 次、随拍规则 %d 次、文案口吻 %d 次、影棚色调 %d 次（前三该 1、末位该 0）' % (
                r['phoneHead'], r['phoneRules'], r['copyRule'], r['theme']))
        if r['body'] == 3 and r['brief'] == 3 and r['visual'] == 3 and r['bg'] == 3 and r['camera'] == 3 and r['copy'] == 3:
            ok('三张都按块给：这段正文 / 这张要说明 / 配图画面 / 背景 / 机位 / 图上文案')
        else:
            bad('块不齐：正文 %d、说明 %d、配图 %d、背景 %d、机位 %d、文案 %d（都该 3）' % (
                r['body'], r['brief'], r['visual'], r['bg'], r['camera'], r['copy']))
        if r['evid'] == 1 and r['longCopy'] == 2 and r['bodies'] and max(r['bodies']) <= 120:
            ok('正文只带这一张的一两句（最长 %d 字）；元素清单与图上原句都落进提示词' % max(r['bodies']))
        else:
            bad('正文/元素/文案没落对：元素 %d、原句 %d 次、各段正文 %r' % (
                r['evid'], r['longCopy'], r['bodies']))
        if r['words'] == 0 and r['noword'] == 0 and r['oldDesc'] == 0 and r['oldHint'] == 0 and r['copyFollow'] == 3:
            ok('不再出现「图上就写这几个字」「短大字」「字摆哪」这些旧排版指令；三张文案都照组头的口吻写')
        else:
            bad('旧排版指令残留：写句 %d、不写字/兜底 %d、分镜标题 %d、短字/字位 %d、照组头 %d' % (
                r['words'], r['noword'], r['oldDesc'], r['oldHint'], r['copyFollow']))
        if r['same']:
            ok('整组里那几段就是逐张（组内版）那份原文（真源同一份）')
        else:
            bad('整组与逐张对不上')
        if not (r['noSnap'] or r['noGuard'] or r['noBanWords'] or r['noBlank']) and r['noLayer']:
            ok('随拍七条／一次一张护栏／「不要出现任何文字」／本地留白块与压字层都不在了')
        else:
            bad('旧口径没清干净：七条 %s 护栏 %s 禁字句 %s 留白块 %s 压字层 %s' % (
                r['noSnap'], r['noGuard'], r['noBanWords'], r['noBlank'], r['noLayer']))
        if r['cast'] == 1 and r['castOnce'] == 1:
            ok('填了「主角那一格」→ 组头说一次同一个人（不逐张重复）')
        else:
            bad('主角句：组头 %d 次、全文 %d 次（都该 1 次）' % (r['cast'], r['castOnce']))
        if r['adv'] and r['advNoSnap']:
            ok('选「广告片」→ 组头带影棚布光与色调，不带手机随拍拍法')
        else:
            bad('广告片档不对：%r / %r' % (r['adv'], r['advNoSnap']))
        if r['aliasBorn'] == '广告片' and r['aliasSame']:
            ok('旧档「广告片精修」归一成「广告片」，与本档同文')
        else:
            bad('旧值归一不对：%r / 同文 %r' % (r['aliasBorn'], r['aliasSame']))
        if r['illustPlain']:
            ok('选「动漫插画」→ 只给画法，不套手机随拍那套拍法')
        else:
            bad('插画档仍被套了手机随拍拍法')
        if r['empty'] == '' and r['imagesSame']:
            ok('没切出画面＝空串；档案那条 visual.images 与整组同文（不再两份真源）')
        else:
            bad('空表返回 %r / visual.images 与整组%s' % (r['empty'][:20], '一致' if r['imagesSame'] else '不一致'))
        cov = str(r['cover'])
        need = ['【这段正文】', '【这张要说明】', '【配图画面】', '【背景】', '【机位】', '【图上文案】',
                '封面那一句', '手机随拍', '像作者拍完随手打在手机上的一句话']
        if all(t in cov for t in need) and ('图上就写这几个字' not in cov) and ('不要出现任何文字' not in cov):
            ok('封面那一份也按块补齐（正文/说明/配图/背景/机位/文案，%d 字）' % len(cov))
        else:
            bad('封面那份不对：%s' % cov[:200])
        rd = r['render']
        broken = {k: v for k, v in rd.items() if not isinstance(v, int) or v <= 0}
        if not broken:
            ok('撤掉旋钮后界面还在：' + ' / '.join('%s %d 字' % (k, rd[k]) for k in sorted(rd) if k != 'composeLen'))
        else:
            bad('界面渲染出事：%r' % (broken,))
        if errs:
            bad('页面报错：%s' % ' | '.join(errs[:3]))
        else:
            ok('整页跑完没报错')
    finally:
        srv.terminate()
        try:
            srv.wait(timeout=8)
        except Exception:
            srv.kill()
        logf.close()
    print('\n%s  整组提示词点检：%d 处失手' % ('—' * 30, fails), flush=True)
    sys.exit(1 if fails else 0)


main()
