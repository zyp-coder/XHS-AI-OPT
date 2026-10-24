# 🎙 口播①档「自己对着镜头念」端到端点检（公网那份 web/ + server/）
# 需求档案：资料/发笔记-口播选出口三档设计.md §四 §六-8 §七
# 盯六件事：
#   ① 建的是 route:'self' 那张单——一张也不占老板每天接单额度、也不上工单台，但客户机「我的单」看得见（片子靠它自动取回）；
#   ② 这一句交的是画面（交音频顶回来），一句一句存，句数齐了云端直接按顺序串一条、不经过人工；
#   ③ 串成了：片能下载、客户机一取转「已取回」；串不成：状态停在「都录好了」，一句一句照样能下载，页上摆那句人话；
#   ④ 念稿页在① 档＝「对着镜头念」：一句一屏，不点「✓ 这句行」跳不到下一句；
#   ⑤ ② 只交照片那张单点开录页，直说不用这一页；
#   ⑥ 旧走法（一段段录音）没被这次改版带坏。
# 本机：node 起一台只用临时账本的服务器（DEMO_DATA_DIR 指 tmp/，绝不碰 server/data/）。
# 用法：python3 -X utf8 scripts/dev/check_lip_self_web.py
import os
import sys
import time
import base64
import socket
import shutil
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
REPO = Path(__file__).resolve().parents[2]
PORT = 8905
BASE = 'http://127.0.0.1:%d' % PORT
TAG = 'lip-self-check'
DATA = REPO / 'tmp' / TAG / 'data'
SHOT = REPO / 'tmp' / TAG
CLIPS = SHOT / 'clips'
fails = 0

# 三句、每句 ≤40 字：云端切出来正好三句
SCRIPT = '早上八点进场，一天到晚跟料打交道。客户爱问的那几句，我闭眼都知道下一句。各家情况不一样，我得先听你说完。'
SEGS = 3


def ok(msg):
    print('  PASS ' + msg, flush=True)


def bad(msg):
    global fails
    fails += 1
    print('  FAIL ' + msg, flush=True)


def make_clip(path):
    """同样的参数出小片：云端那步是「直接串起来、不重新编码」，编码不一致就串不上。"""
    subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
                    '-f', 'lavfi', '-i', 'testsrc=duration=1.2:size=160x120:rate=10',
                    '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast',
                    '-crf', '30', '-r', '10', str(path)], check=True)


# ── 接口那一趟：建单 → 挡连点 → 顶音频 → 一句一句传 → 串片 → 台上看不到 → 取回 ──
API_FLOW = r'''async (cfg) => {
  const J = async (p, b) => (await fetch(p, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) })).json();
  const put = async (job, tk, i, mime, b64) => {
    const s = atob(b64), u = new Uint8Array(s.length);
    for (let k = 0; k < s.length; k++) u[k] = s.charCodeAt(k);
    const r = await fetch('/api/lip/put?job=' + job + '&part=seg&i=' + i +
      '&mime=' + encodeURIComponent(mime) + '&name=' + encodeURIComponent('第' + (i + 1) + '句') + '&t=' + tk,
      { method: 'POST', headers: { 'Content-Type': mime }, body: u });
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };
  const R = {};
  R.quotaBefore = (await J('/api/lip/mine', {})).quota;
  const s = await J('/api/lip/submit', { route: 'self', script: cfg.script, title: '在这个城市干了这些年', noteId: 'ar_self_1' });
  R.submit = { ok: !!s.ok, error: s.error || '', route: s.job && s.job.route, state: s.job && s.job.state,
               segCount: s.job && s.job.segCount, used: s.quota && s.quota.used,
               left: s.quota && s.quota.left, daily: s.quota && s.quota.daily, url: s.recordUrl || '' };
  if (!s.ok) return R;
  const id = s.job.id, tk = s.job.token;
  R.id = id; R.tk = tk;
  const dup = await J('/api/lip/submit', { route: 'self', script: cfg.script, noteId: 'ar_self_1' });
  R.dup = { ok: !!dup.ok, error: dup.error || '' };
  const audio = await put(id, tk, 0, 'audio/webm', cfg.b64[0]);
  R.mimeGuard = { status: audio.status, ok: !!audio.json.ok, error: audio.json.error || '' };
  R.segs = [];
  for (let i = 0; i < cfg.b64.length; i++) {
    const r = await put(id, tk, i, 'video/mp4', cfg.b64[i]);
    const j = r.json.job || {};
    R.segs.push({ status: r.status, ok: !!r.json.ok, state: j.state, segGot: j.segGot, segLack: j.segLack,
                  hasOut: !!j.hasOut, outSize: j.outSize || 0, secs: j.trackSecs || 0, selfErr: j.selfErr || '',
                  outUrl: (j.fileUrls || {}).out || '', takeUrl: j.takeUrl || '', lack: j.lack || '' });
  }
  const fed = (await J('/api/lip/feed', { id: id, t: tk })).job || {};
  R.afterFeed = { state: fed.state, segGot: fed.segGot, segCount: fed.segCount, hasOut: !!fed.hasOut,
                  secs: fed.trackSecs || 0, selfErr: fed.selfErr || '', canClaim: !!fed.canClaim,
                  canDeliver: !!fed.canDeliver, canTake: !!fed.canTake, lack: fed.lack || '',
                  routeLabel: fed.routeLabel || '', stateLabel: fed.stateLabel || '' };
  const jobs1 = await J('/api/lip/jobs', {});
  R.bossSelf = { ok: !!jobs1.ok, error: jobs1.error || '', ids: (jobs1.jobs || []).map(x => x.id), stats: jobs1.stats || {} };
  const mine1 = await J('/api/lip/mine', {});
  R.mineSelf = { ids: (mine1.jobs || []).map(x => x.id), quota: mine1.quota };
  const av = await J('/api/lip/submit', { route: 'avatar', script: cfg.script, title: '交照片那张',
                                          noteId: 'ar_av_1', agreePhoto: true, voiceWish: '稳一点' });
  R.avatar = { ok: !!av.ok, id: av.job && av.job.id, state: av.job && av.job.state,
               segCount: av.job && av.job.segCount, used: av.quota && av.quota.used, url: av.recordUrl || '' };
  const vc = await J('/api/lip/submit', { route: 'voice', script: cfg.script, title: '旧走法那张', noteId: 'ar_vc_1' });
  R.legacy = { ok: !!vc.ok, id: vc.job && vc.job.id, state: vc.job && vc.job.state,
               segCount: vc.job && vc.job.segCount, url: vc.recordUrl || '' };
  const jobs2 = await J('/api/lip/jobs', {});
  R.bossAll = { ids: (jobs2.jobs || []).map(x => x.id), stats: jobs2.stats || {} };
  R.mineQuota = (await J('/api/lip/mine', {})).quota;
  const last = R.segs[R.segs.length - 1] || {};
  if (last.outUrl) {
    const r = await fetch(last.outUrl);
    R.outFetch = { status: r.status, bytes: (await r.arrayBuffer()).byteLength,
                   type: r.headers.get('content-type') || '', disp: r.headers.get('content-disposition') || '' };
  }
  if (last.takeUrl && R.afterFeed.state === 'delivered') {
    const r = await fetch(last.takeUrl);
    R.taken = { status: r.status, bytes: (await r.arrayBuffer()).byteLength,
               state: ((await J('/api/lip/status', { id: id })).job || {}).state };
  }
  R.badToken = await J('/api/lip/feed', { id: id, t: 'nope' });
  R.noToken = { status: (await fetch('/api/lip/out/' + id)).status };
  return R;
}'''

# ── 念稿页那一屏摊开什么样 ──
PAGE_SELF = r'''async () => {
  const txt = (s) => { const e = document.querySelector(s); return e ? String(e.textContent || '').trim() : ''; };
  const vis = (s) => { const e = document.querySelector(s); if (!e) return false; return getComputedStyle(e).display !== 'none'; };
  const inp = document.querySelector('#fileInput') || {};
  return { title: txt('#title'), doc: document.title, state: txt('#statePill'), line1: txt('#line1'),
           steps: document.querySelectorAll('#steps b').length, cur: txt('#curNo'), tot: txt('#totNo'),
           unit: txt('#unitA'), seg: txt('#segText'), recBtn: txt('#recBtn'), banner: txt('#banner'),
           okShown: vis('#okBtn'), okLabel: txt('#okBtn'), okDisabled: !!(document.querySelector('#okBtn') || {}).disabled,
           flow: [...document.querySelectorAll('#flow i')].map(x => String(x.textContent || '').trim()),
           lack: txt('#lackLine'), accept: inp.accept || '', fileBtn: txt('#fileBtn'), foot: txt('#footTip'),
           partsShown: vis('#partsCard'), parts: [...document.querySelectorAll('#parts a')].map(x => String(x.textContent || '').trim()),
           outShown: vis('#outCard'), take: txt('#takeBtn'), takeHref: (document.querySelector('#takeBtn') || {}).getAttribute('href') || '',
           segs: document.querySelectorAll('#seglist .seg').length };
}'''

# 一句没录：点第 3 句跳不过去；空点「这句行」也顶回来
GATE_TEST = r'''async () => {
  const cur = () => String((document.querySelector('#curNo') || {}).textContent || '').trim();
  const tst = () => String((document.querySelector('#toast') || {}).textContent || '');
  const r = {};
  (document.querySelectorAll('#steps b')[2] || {}).click();
  await new Promise(x => setTimeout(x, 150));
  r.jump = { cur: cur(), toast: tst() };
  (document.querySelectorAll('#seglist button')[2] || {}).click();
  await new Promise(x => setTimeout(x, 150));
  r.fromList = { cur: cur(), toast: tst() };
  const b = document.querySelector('#okBtn'); b.click();
  await new Promise(x => setTimeout(x, 150));
  r.emptyOk = { cur: cur(), toast: tst(), disabled: !!b.disabled };
  return r;
}'''


def snap(page, name):
    try:
        page.screenshot(path=str(SHOT / name), full_page=True)
    except Exception as e:
        print('  （照片没拍成 %s：%s）' % (name, e), flush=True)


def new_self_job(page, note_id, title):
    return page.evaluate('''async (a) => { const s = await (await fetch('/api/lip/submit', { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ route: 'self', script: a.script, title: a.title, noteId: a.note }) })).json();
        return s.ok ? { id: s.job.id, tk: s.job.token, url: s.recordUrl, segs: s.job.segCount } : { err: s.error }; }''',
        {'script': SCRIPT, 'title': title, 'note': note_id})


def put_seg(page, job, tk, i, b64, mime='video/mp4'):
    return page.evaluate('''async (a) => { const s = atob(a.b64), u = new Uint8Array(s.length);
        for (let k = 0; k < s.length; k++) u[k] = s.charCodeAt(k);
        const r = await fetch('/api/lip/put?job=' + a.job + '&part=seg&i=' + a.i + '&mime=' +
            encodeURIComponent(a.mime) + '&name=x&t=' + a.tk,
            { method: 'POST', headers: { 'Content-Type': a.mime }, body: u });
        return { status: r.status, json: await r.json().catch(() => ({})) }; }''',
        {'job': job, 'tk': tk, 'i': i, 'b64': b64, 'mime': mime})


def main():
    print('── 🎙 口播①档「自己对着镜头念」端到端（公网那份）──', flush=True)
    if DATA.exists():
        shutil.rmtree(DATA)
    CLIPS.mkdir(parents=True, exist_ok=True)
    for f in CLIPS.glob('*.mp4'):
        f.unlink()
    try:
        for i in range(SEGS):
            make_clip(CLIPS / ('seg%d.mp4' % (i + 1)))
    except Exception as e:
        bad('三件小视频没做出来（ffmpeg 不通？）：%s' % e)
        return
    b64 = [base64.b64encode((CLIPS / ('seg%d.mp4' % (i + 1))).read_bytes()).decode() for i in range(SEGS)]
    env = dict(os.environ)
    env['DEMO_DATA_DIR'] = str(DATA)
    env['PORT'] = str(PORT)
    env['DEMO_AI_KEY'] = 'check-only'
    env['DEMO_AI_BASE'] = 'http://127.0.0.1:1/v1'
    env['DEMO_SIGNUP_MAX'] = '60'
    logf = open(REPO / 'tmp' / (TAG + '.server.log'), 'w', encoding='utf-8')
    srv = subprocess.Popen(['node', str(REPO / 'server' / 'dev-server.mjs')], env=env, stdout=logf, stderr=subprocess.STDOUT)
    for _ in range(80):
        try:
            socket.create_connection(('127.0.0.1', PORT), 1).close()
            break
        except OSError:
            time.sleep(0.5)
    else:
        bad('服务器没起来（看 tmp/%s.server.log）' % TAG)
        return
    time.sleep(2)
    r = {}
    try:
        with sync_playwright() as p:
            br = p.chromium.launch(channel='msedge', headless=True)
            page = br.new_context(viewport={'width': 1000, 'height': 900}).new_page()
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            page.goto(BASE + '/start.html', wait_until='domcontentloaded', timeout=90000)
            page.wait_for_timeout(1500)
            who = page.evaluate('''async (a) => await (await fetch('/api/auth/demo', { method: 'POST',
                headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: a.key }) })).json()''',
                {'key': 'deco'})
            if not who.get('ok'):
                bad('演示号没进上：%r' % (who,))
                br.close()
                return
            r['api'] = page.evaluate(API_FLOW, {'script': SCRIPT, 'b64': b64})

            # ④ 念稿页：新的一张① 档单，先看门，再从界面那颗「选文件传」走一句
            jb = new_self_job(page, 'ar_self_ui', '界面这一屏')
            if not jb.get('id'):
                bad('界面上这一屏的单没建出来：%r' % jb)
                br.close()
                return
            r['uiUrl'] = BASE + jb['url']
            page.goto(r['uiUrl'], wait_until='domcontentloaded', timeout=60000)
            page.wait_for_timeout(1300)
            r['uiFresh'] = page.evaluate(PAGE_SELF)
            r['uiGate'] = page.evaluate(GATE_TEST)
            snap(page, '1-一句没录.png')
            page.set_input_files('#fileInput', str(CLIPS / 'seg1.mp4'))
            page.wait_for_timeout(2200)
            r['uiAfter1'] = page.evaluate(PAGE_SELF)
            snap(page, '2-传好第1句.png')
            page.evaluate('''() => (document.querySelector('#okBtn') || {}).click()''')
            page.wait_for_timeout(400)
            r['uiCur2'] = page.evaluate(PAGE_SELF)
            page.evaluate('''() => (document.querySelectorAll('#steps b')[2] || {}).click()''')
            page.wait_for_timeout(300)
            r['uiBlocked2'] = page.evaluate('''() => ({ cur: String((document.querySelector('#curNo')||{}).textContent||'').trim(),
                toast: String((document.querySelector('#toast')||{}).textContent||'') })''')
            for i in range(1, SEGS):
                put_seg(page, jb['id'], jb['tk'], i, b64[i])
                page.wait_for_timeout(700)
            page.goto(r['uiUrl'], wait_until='domcontentloaded', timeout=60000)
            page.wait_for_timeout(1600)
            r['uiDone'] = page.evaluate(PAGE_SELF)
            snap(page, '3-录齐串片后.png')

            # ③ 串不成那一岔：三句里混一句别的格式 → 不硬拦，一句一句照样能下载
            jc = new_self_job(page, 'ar_self_mixed', '串不成这一岔')
            for i in range(SEGS):
                put_seg(page, jc['id'], jc['tk'], i, b64[i], 'video/webm' if i == SEGS - 1 else 'video/mp4')
                page.wait_for_timeout(500)
            page.goto(BASE + jc['url'], wait_until='domcontentloaded', timeout=60000)
            page.wait_for_timeout(1500)
            r['mixed'] = page.evaluate(PAGE_SELF)
            snap(page, '4-串不成各句可下.png')

            # ⑤ 只交照片那张单：不该能开录页
            page.goto(BASE + r['api']['avatar']['url'], wait_until='domcontentloaded', timeout=60000)
            page.wait_for_timeout(1300)
            r['uiAvatar'] = page.evaluate('''async () => { const t = (s) => { const e = document.querySelector(s); return e ? String(e.textContent||'').trim() : ''; };
                return { gateShown: getComputedStyle(document.querySelector('#gate')).display !== 'none',
                         main: document.querySelector('#main').style.display, why: t('#gateWhy'),
                         pill: t('#statePill'), routeLabel: '' }; }''')
            snap(page, '5-照片单进录页.png')

            # ⑥ 旧走法（一段段录音）
            page.goto(BASE + r['api']['legacy']['url'], wait_until='domcontentloaded', timeout=60000)
            page.wait_for_timeout(1300)
            r['uiLegacy'] = page.evaluate(PAGE_SELF)
            snap(page, '6-旧走法录页.png')
            br.close()
        if errs:
            bad('页面报错 %d 条：%s' % (len(errs), errs[0][:200]))
    finally:
        srv.terminate()
    report(r)
    print('── 结果：%s ──' % ('全过' if not fails else '%d 处没过' % fails), flush=True)
    sys.exit(1 if fails else 0)


def report(r):
    a = r.get('api') or {}
    sub = a.get('submit') or {}
    if sub.get('ok') and sub.get('route') == 'self' and sub.get('state') == 'await_mat' and sub.get('segCount') == SEGS:
        ok('① 档建出来的是「自己对着镜头念」那张单（route=self，一建就是「还没录完」），稿子切成 %s 句' % sub.get('segCount'))
    else:
        bad('① 档建单不对：%s' % sub)
    qb = (a.get('quotaBefore') or {}).get('used')
    if sub.get('used') == qb and sub.get('left') == sub.get('daily'):
        ok('① 档一张也不占老板每天接单额度（建单前今日 %s 单 → 建完还是 %s 单，还剩 %s/%s）'
           % (qb, sub.get('used'), sub.get('left'), sub.get('daily')))
    else:
        bad('① 档占了接单额度：建前 %s → 建后 %s/%s' % (qb, sub.get('used'), sub.get('daily')))
    if 'lip-record.html?job=' in str(sub.get('url')) and '&t=' in str(sub.get('url')):
        ok('交回来的链接是念稿页那一条（带单号＋口令）')
    else:
        bad('链接不对：%s' % sub.get('url'))
    if a.get('dup', {}).get('ok') is False and '在走了' in str(a.get('dup', {}).get('error')):
        ok('同一篇连点第二次顶回来了：%s' % a['dup']['error'])
    else:
        bad('连点没拦住：%s' % a.get('dup'))
    mg = a.get('mimeGuard') or {}
    if mg.get('ok') is False and '逐句录只收录出来的视频' in str(mg.get('error')):
        ok('这一句交的是音频 → 顶回来要画面：%s' % mg.get('error'))
    else:
        bad('音频没顶回来：%s' % mg)
    segs = a.get('segs') or []
    got = [x.get('segGot') for x in segs]
    if got == [1, 2, 3]:
        ok('一句一句存住：传第1句后 %s/%s、第2句后 %s/%s、第3句才凑齐' % (got[0], SEGS, got[1], SEGS))
    else:
        bad('逐句存料不对：%s' % segs)
    if segs and segs[SEGS - 1].get('lack') == '' and all(x.get('lack') for x in segs[:SEGS - 1]):
        ok('差几句说几句（第一句后「%s」，凑齐了就没这句）' % (segs[0].get('lack') if segs else ''))
    else:
        bad('缺料那句话不对：%s' % [x.get('lack') for x in segs])
    af = a.get('afterFeed') or {}
    last = segs[-1] if segs else {}
    if af.get('state') == 'delivered' and af.get('hasOut') and af.get('secs'):
        ok('三句传齐云端当场串成一条：%s 秒 · %s 字节 · 状态「%s」' % (af.get('secs'), last.get('outSize'), af.get('stateLabel')))
    else:
        bad('三句齐了没串成片（本机有 ffmpeg，应当串成）：%s / %s' % (af, last.get('selfErr')))
    if af.get('canClaim') is False and af.get('canDeliver') is False:
        ok('① 档没有「谁接单 / 谁交片」这两步——不占人工')
    else:
        bad('① 档冒出人工接单口：%s' % af)
    bs = a.get('bossSelf') or {}
    if bs.get('ok') and a.get('id') not in (bs.get('ids') or []):
        ok('老板那张工单台看不见① 档这张单')
    else:
        bad('工单台混进了① 档：%s' % bs)
    ms = a.get('mineSelf') or {}
    if a.get('id') in (ms.get('ids') or []):
        ok('客户机「我的单」看得见它（片回来靠这一条自动取回）')
    else:
        bad('客户机看不见自己录的片：%s' % ms)
    ba = a.get('bossAll') or {}
    mq = a.get('mineQuota') or {}
    want = [x.get('id') for x in (a.get('avatar'), a.get('legacy')) if x and x.get('ok')]
    if a.get('id') not in ba.get('ids') and set(want) <= set(ba.get('ids')):
        ok('工单台只列要动手的那两张（② 照片单＋旧走法），① 档一张不在里面')
    else:
        bad('工单台列表不对：%s（该有 %s）' % (ba.get('ids'), want))
    if mq.get('used') == 2 and mq.get('daily') == sub.get('daily'):
        ok('额度账对：② 照片单＋旧走法各占一单＝今日 %s/%s，① 档那两张一张不算' % (mq.get('used'), mq.get('daily')))
    else:
        bad('额度算歪了：%s' % mq)
    of = a.get('outFetch') or {}
    if of.get('status') == 200 and of.get('bytes', 0) > 1000 and 'video/' in str(of.get('type')):
        ok('串出来的片是条真视频：%s 字节（%s）' % (of.get('bytes'), of.get('type')))
    else:
        bad('片下载口不对：%s' % of)
    tk = a.get('taken') or {}
    if tk.get('status') == 200 and tk.get('bytes', 0) > 1000 and tk.get('state') == 'taken':
        ok('客户机一取就转「已取回」（片子落进这一篇的代发区）')
    else:
        bad('取回这一步不对：%s' % tk)
    if (a.get('badToken') or {}).get('ok') is False and (a.get('noToken') or {}).get('status') in (403, 404):
        ok('口令不对：拿不到这张单、也取不走片（%s）' % (a.get('badToken') or {}).get('error'))
    else:
        bad('口令校验漏了：%s / %s' % (a.get('badToken'), a.get('noToken')))

    uf = r.get('uiFresh') or {}
    if uf.get('title') == '对着镜头念' and uf.get('unit') == '句' and uf.get('steps') == SEGS and uf.get('segs') == SEGS:
        ok('念稿页在① 档＝「对着镜头念」：共 %s 句、一句一屏（%s 个格子＋%s 行清单）' % (uf.get('tot'), uf.get('steps'), uf.get('segs')))
    else:
        bad('念稿页① 档不像：%s' % uf)
    if uf.get('okShown') and uf.get('okDisabled') and '这句行' in str(uf.get('okLabel')):
        ok('「✓ 这句行」摆在这一屏、没录时是灰的：%s' % uf.get('okLabel'))
    else:
        bad('「这句行」那颗钮不对：%s' % uf)
    if 'video' in str(uf.get('accept')) and '选文件传' in str(uf.get('fileBtn')):
        ok('传文件的口只认视频（手机相机拍好了那条）：%s' % uf.get('accept'))
    else:
        bad('文件口不对：%s' % uf)
    if len(uf.get('flow') or []) == 3 and '各句录齐' in uf['flow'][0] and '代发区' in uf['flow'][2]:
        ok('云端那三步摆页顶：%s' % ' → '.join(uf['flow']))
    else:
        bad('三步不对：%s' % uf.get('flow'))
    if '开不了录像' in str(uf.get('foot')) and '发工单' in str(uf.get('foot')):
        ok('页脚给了退路：手机开不了录像就回去改选「发工单」')
    else:
        bad('页脚退路不对：%s' % uf.get('foot'))
    ug = r.get('uiGate') or {}
    if ug.get('jump', {}).get('cur') == '1' and '下一句才解锁' in str(ug.get('jump', {}).get('toast')):
        ok('第 1 句没录：点第 3 句跳不过去（格子与清单两条路都挡）')
    else:
        bad('跳转没挡住：%s' % ug.get('jump'))
    if ug.get('emptyOk', {}).get('disabled') and ug.get('emptyOk', {}).get('cur') == '1':
        ok('没录时「这句行」是灰的：点它没反应，也不跳句')
    else:
        bad('「这句行」空点没拦：%s' % ug.get('emptyOk'))
    ua = r.get('uiAfter1') or {}
    if ua.get('okDisabled') is False and '还差 %d' % (SEGS - 1) in str(ua.get('lack')) and ua.get('state') == '还没录完':
        ok('从界面那颗「选文件传」传上第 1 句：存住了、「✓ 这句行」变绿（%s）' % ua.get('lack'))
    else:
        bad('界面传第一句后不对：%s' % ua)
    uc = r.get('uiCur2') or {}
    if uc.get('cur') == '2' and uc.get('okDisabled') and uc.get('recBtn').startswith('🎥'):
        ok('点了「✓ 这句行」才跳到第 2 句：%s（钮「%s」）' % (str(uc.get('seg'))[:16], uc.get('recBtn')))
    else:
        bad('「这句行」没跳到下一句：%s' % uc)
    ub = r.get('uiBlocked2') or {}
    if ub.get('cur') == '2' and '下一句才解锁' in str(ub.get('toast')):
        ok('第 2 句没录，第 3 句还锁着：%s' % ub.get('toast'))
    else:
        bad('后面的锁没生效：%s' % ub)
    ud = r.get('uiDone') or {}
    if ud.get('outShown') and '存这一条成片' in str(ud.get('take')) and '/api/lip/out/' in str(ud.get('takeHref')):
        ok('三句录齐后这一屏给到成片：「%s」（状态「%s」）' % (ud.get('take'), ud.get('state')))
    else:
        bad('录齐后没给到片：%s' % ud)
    if ud.get('partsShown') is False and '串不成' not in str(ud.get('banner')):
        ok('串成了就不摆「一句一句下载」那张卡')
    else:
        bad('串成了还摆各句下载：%s' % ud.get('parts'))
    if ud.get('flow') and '3/%s' % SEGS in ud['flow'][0] and '代发区' in ud['flow'][2]:
        ok('页顶三步走到最后一站：%s' % ' → '.join(ud['flow']))
    else:
        bad('三步没跟着走：%s' % ud.get('flow'))
    mx = r.get('mixed') or {}
    if mx.get('partsShown') and len(mx.get('parts') or []) == SEGS and mx.get('outShown') is False and '没串成' in str(mx.get('banner')):
        ok('串不成那一岔不硬拦：%s（各句 %s 都能单下载）' % (str(mx.get('banner'))[:34], '、'.join(mx.get('parts'))))
    else:
        bad('串不成的退路不对：%s' % mx)
    va = r.get('uiAvatar') or {}
    if va.get('gateShown') and '正脸照' in str(va.get('why')) and va.get('main') == 'none':
        ok('② 只交照片那张单点开录页：直说「不用这一页」，回笔记里交照片')
    else:
        bad('照片单在录页不对：%s' % va)
    ul = r.get('uiLegacy') or {}
    if ul.get('title') == '一段段念' and ul.get('okShown') is False and ul.get('unit') == '段':
        ok('旧走法（一段段录音）还是老样子：标题「%s」、没有「这句行」那一套' % ul.get('title'))
    else:
        bad('旧走法被改版带坏了：%s' % ul)


if __name__ == '__main__':
    main()
