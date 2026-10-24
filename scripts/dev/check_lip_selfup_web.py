# 🎬 整条片加字幕端到端点检（公网那份 web/ + server/）
# 需求档案：资料/门面挑稿-问题5-6需求确认单.md §二 问题 6 §五 验收
# 盯这几件事：
#   ① selfup 建单不占老板每天接单额度、不进工单台，和同一篇的逐句录单互不打架；
#   ② part=whole 原始字节直传：绕开 64MB 的整体请求上限、边收边落盘，100MB 上限拦得住；
#   ③ 加字幕排队 → 云端烧好 → 取回；↩ 回上一版拿回没烧字幕的原片，原片一个字没动；
#   ④ 烧不成时原片仍在、状态说人话；
#   ⑤ 稿子超过 900 字不让烧；口令不对、格式不对、空文件都顶回来；
#   ⑥ 65MB（超过 64MB 那道口）能传上来，证明不是整份憋在内存里。
# 本机：node 起一台只用临时账本的服务器（DEMO_DATA_DIR 指 tmp/，绝不碰 server/data/）。
# 用法：python3 -X utf8 scripts/dev/check_lip_selfup_web.py
import os
import sys
import time
import json
import hashlib
import socket
import shutil
import subprocess
import http.client
import urllib.request
import urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
REPO = Path(__file__).resolve().parents[2]
PORT = 8906
BASE = 'http://127.0.0.1:%d' % PORT
TAG = 'lip-selfup-check'
DATA = REPO / 'tmp' / TAG / 'data'
SHOT = REPO / 'tmp' / TAG
CLIP = SHOT / 'whole.mp4'
fails = 0

SCRIPT = '早上八点进场，一天到晚跟料打交道。客户爱问的那几句，我闭眼都知道下一句。各家情况不一样，我得先听你说完。'
SENTS = ['早上八点进场，一天到晚跟料打交道。', '客户爱问的那几句，我闭眼都知道下一句。', '各家情况不一样，我得先听你说完。']
MAX_WHOLE = 100 * 1024 * 1024
BIG = 65 * 1024 * 1024
OVER = MAX_WHOLE + 1024 * 1024


def ok(msg):
    print('  PASS ' + msg, flush=True)


def bad(msg):
    global fails
    fails += 1
    print('  FAIL ' + msg, flush=True)


def make_clip(path):
    subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
                    '-f', 'lavfi', '-i', 'testsrc=duration=2:size=160x120:rate=10',
                    '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast',
                    '-crf', '28', '-r', '10', str(path)], check=True)


def sha(b):
    return hashlib.sha256(b).hexdigest()


def http_get(path, timeout=180):
    with urllib.request.urlopen(BASE + path, timeout=timeout) as r:
        return r.status, dict(r.headers), r.read()


def raw_put(job, token, body=None, mime='video/mp4', length=None, extra=''):
    """原始字节交整条片：body=None 时只发头（用来验「看长度就顶回来」）。"""
    qs = urllib.parse.urlencode({'job': job, 'part': 'whole', 't': token, 'mime': mime, 'name': '整条.' + extra or 'mp4'})
    conn = http.client.HTTPConnection('127.0.0.1', PORT, timeout=180)
    n = len(body) if body is not None else (length or 0)
    conn.putrequest('POST', '/api/lip/put?' + qs)
    conn.putheader('Content-Type', mime)
    conn.putheader('Content-Length', str(n))
    conn.putheader('Connection', 'close')
    conn.endheaders()
    if body is not None:
        conn.send(body)
    r = conn.getresponse()
    raw = r.read()
    conn.close()
    try:
        j = json.loads(raw.decode('utf-8') or '{}')
    except Exception:
        j = {'raw': raw[:200].decode('utf-8', 'replace')}
    return r.status, j


API_FLOW = r'''async (cfg) => {
  const J = async (p, b) => (await fetch(p, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) })).json();
  const R = {};
  R.quotaBefore = (await J('/api/lip/mine', {})).quota;
  const a = await J('/api/lip/submit', { route: 'selfup', script: cfg.script, title: '整条片那一篇', noteId: 'ar_up_1' });
  R.upA = { ok: !!a.ok, error: a.error || '', id: a.job && a.job.id, tk: a.job && a.job.token,
            route: a.job && a.job.route, routeLabel: a.job && a.job.routeLabel,
            state: a.job && a.job.state, segCount: a.job && a.job.segCount,
            lack: a.job && a.job.lack, hasOut: !!(a.job && a.job.hasOut),
            used: a.quota && a.quota.used, left: a.quota && a.quota.left, daily: a.quota && a.quota.daily,
            url: a.recordUrl || '' };
  const s = await J('/api/lip/submit', { route: 'self', script: cfg.script, title: '同篇逐句录', noteId: 'ar_up_1' });
  R.selfSame = { ok: !!s.ok, error: s.error || '', id: s.job && s.job.id, route: s.job && s.job.route,
                 used: s.quota && s.quota.used };
  const si = await J('/api/lip/submit', { route: 'self', script: cfg.script, title: '逐句录另一篇', noteId: 'ar_self_2' });
  R.selfOther = { ok: !!si.ok, error: si.error || '', id: si.job && si.job.id };
  const b = await J('/api/lip/submit', { route: 'selfup', script: cfg.script, title: '大文件那一篇', noteId: 'ar_up_big' });
  R.upBig = { ok: !!b.ok, error: b.error || '', id: b.job && b.job.id, tk: b.job && b.job.token };
  const c = await J('/api/lip/submit', { route: 'selfup', script: cfg.script, title: '超限那一篇', noteId: 'ar_up_over' });
  R.upOver = { ok: !!c.ok, error: c.error || '', id: c.job && c.job.id, tk: c.job && c.job.token };
  const av = await J('/api/lip/submit', { route: 'avatar', script: cfg.script, title: '工单那张', noteId: 'ar_av_1', agreePhoto: true });
  R.avatar = { ok: !!av.ok, error: av.error || '', id: av.job && av.job.id, used: av.quota && av.quota.used,
               daily: av.quota && av.quota.daily };
  const mine = await J('/api/lip/mine', {});
  R.mine = { ids: (mine.jobs || []).map(x => x.id), quota: mine.quota };
  const jobs = await J('/api/lip/jobs', {});
  R.boss = { ok: !!jobs.ok, error: jobs.error || '', ids: (jobs.jobs || []).map(x => x.id),
             stats: jobs.stats || {} };
  R.noToken = { status: (await fetch('/api/lip/out/' + (R.upA.id || 'x'))).status };
  R.badFeed = await J('/api/lip/feed', { id: R.upA.id, t: 'nope' });
  R.badWholeToken = null;
  return R;
}'''


def status_of(page, job):
    return page.evaluate('''async (a) => await (await fetch('/api/lip/status', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: a.id }) })).json()''',
        {'id': job})


def wait_sub(page, job, want, secs=90):
    t0 = time.time()
    last = {}
    while time.time() - t0 < secs:
        r = status_of(page, job)
        last = (r or {}).get('job') or {}
        st = str(last.get('subState') or '')
        if st == want:
            return last
        if st == 'fail' and want != 'fail':
            return last
        time.sleep(0.4)
    return last


def api(page, path, body):
    return page.evaluate('''async (a) => await (await fetch(a.p, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(a.b || {}) })).json()''',
        {'p': path, 'b': body or {}})


def main():
    print('── 🎬 整条片加字幕端到端（公网那份）──', flush=True)
    if DATA.exists():
        shutil.rmtree(DATA)
    SHOT.mkdir(parents=True, exist_ok=True)
    try:
        make_clip(CLIP)
    except Exception as e:
        bad('小视频没做出来（ffmpeg 不通？）：%s' % e)
        return
    clip = CLIP.read_bytes()
    clip_sha = sha(clip)
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
            page.wait_for_timeout(1200)
            who = page.evaluate('''async (a) => await (await fetch('/api/auth/demo', { method: 'POST',
                headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: a.key }) })).json()''',
                {'key': 'deco'})
            if not who.get('ok'):
                bad('演示号没进上：%r' % (who,))
                br.close()
                return
            r['api'] = page.evaluate(API_FLOW, {'script': SCRIPT})
            a = r['api']
            ja, jb, jc = a.get('upA') or {}, a.get('upBig') or {}, a.get('upOver') or {}
            if not (ja.get('ok') and ja.get('id') and ja.get('tk') and jb.get('id') and jc.get('id')):
                bad('selfup 单没建出来：%r / %r / %r' % (ja, jb, jc))
                br.close()
                return

            # 只交音频 / 空文件：都在碰原片之前先顶回来
            st, j2 = raw_put(ja['id'], ja['tk'], b'abc', 'audio/webm', extra='webm')
            r['audio'] = {'status': st, 'json': j2}
            st, j3 = raw_put(ja['id'], ja['tk'], b'', 'video/mp4', extra='mp4')
            r['empty'] = {'status': st, 'json': j3}

            # 101MB：看长度就顶回来（不发正文）
            t0 = time.time()
            st, j4 = raw_put(jc['id'], jc['tk'], None, 'video/mp4', length=OVER, extra='mp4')
            r['over'] = {'status': st, 'json': j4, 'secs': round(time.time() - t0, 2)}
            after_over = status_of(page, jc['id']).get('job') or {}
            r['overJob'] = {'state': after_over.get('state'), 'hasOut': bool(after_over.get('hasOut')), 'lack': after_over.get('lack')}

            # 65MB：超过 64MB 的整体请求上限——能收，证明 part=whole 走的是边收边写盘
            t0 = time.time()
            chunk = b'\0' * (1024 * 1024)
            conn = http.client.HTTPConnection('127.0.0.1', PORT, timeout=300)
            qs = urllib.parse.urlencode({'job': jb['id'], 'part': 'whole', 't': jb['tk'], 'mime': 'video/mp4', 'name': '大文件.mp4'})
            conn.putrequest('POST', '/api/lip/put?' + qs)
            conn.putheader('Content-Type', 'video/mp4')
            conn.putheader('Content-Length', str(BIG))
            conn.putheader('Connection', 'close')
            conn.endheaders()
            for _ in range(65):
                conn.send(chunk)
            resp = conn.getresponse()
            raw = resp.read()
            conn.close()
            try:
                jb_r = json.loads(raw.decode('utf-8') or '{}')
            except Exception:
                jb_r = {}
            r['big'] = {'status': resp.status, 'ok': bool(jb_r.get('ok')), 'error': jb_r.get('error') or '',
                        'secs': round(time.time() - t0, 2)}
            big_st = status_of(page, jb['id']).get('job') or {}
            r['bigJob'] = {'state': big_st.get('state'), 'hasOut': bool(big_st.get('hasOut')),
                           'outSize': big_st.get('outSize') or 0, 'lack': big_st.get('lack')}
            if big_st.get('outSize'):
                st, _, big_bytes = http_get('/api/lip/file/%s?p=out&t=%s' % (jb['id'], jb['tk']))
                r['bigFetch'] = {'status': st, 'bytes': len(big_bytes)}

            # 真视频传上去 → 烧字幕 → done → 取回 → 回上一版
            st, j5 = raw_put(ja['id'], ja['tk'], clip, 'video/mp4', extra='mp4')
            r['clipPut'] = {'status': st, 'ok': bool(j5.get('ok')), 'error': j5.get('error') or '',
                            'state': (j5.get('job') or {}).get('state'),
                            'outSize': (j5.get('job') or {}).get('outSize') or 0}
            clip_st = status_of(page, ja['id']).get('job') or {}
            r['clipJob'] = {'state': clip_st.get('state'), 'hasOut': bool(clip_st.get('hasOut')),
                            'outSize': clip_st.get('outSize') or 0, 'lack': clip_st.get('lack'),
                            'canTake': bool(clip_st.get('canTake'))}
            st, _, posted = http_get('/api/lip/file/%s?p=out&t=%s' % (ja['id'], ja['tk']))
            r['clipSame'] = {'status': st, 'same': sha(posted) == clip_sha}

            r['sub'] = api(page, '/api/lip/sub', {'id': ja['id'], 't': ja['tk'], 'sents': SENTS})
            r['subDup'] = page.evaluate('''async (a) => await (await fetch('/api/lip/submit', { method: 'POST',
                headers: { 'content-type': 'application/json' }, body: JSON.stringify({ route: 'selfup',
                  script: a.script, noteId: 'ar_up_1' }) })).json()''', {'script': SCRIPT})
            done = wait_sub(page, ja['id'], 'done', 90)
            r['done'] = {'subState': done.get('subState'), 'subMsg': done.get('subMsg') or '',
                         'state': done.get('state'), 'hasOut': bool(done.get('hasOut')),
                         'outSize': done.get('outSize') or 0, 'canSubRevert': bool(done.get('canSubRevert')),
                         'subCount': done.get('subCount') or 0}
            out_url = ((done.get('fileUrls') or {}).get('out') or '')
            if out_url:
                st, hdr, burned = http_get(out_url)
                r['burned'] = {'status': st, 'bytes': len(burned), 'type': hdr.get('Content-Type') or '',
                               'mp4': burned[4:8] == b'ftyp', 'same': sha(burned) == clip_sha}
                r['burnedBytes'] = sha(burned)
            r['revert'] = api(page, '/api/lip/sub_revert', {'id': ja['id'], 't': ja['tk']})
            rv = (r['revert'] or {}).get('job') or {}
            r['revertJob'] = {'subState': rv.get('subState'), 'hasOut': bool(rv.get('hasOut')),
                              'outSize': rv.get('outSize') or 0, 'state': rv.get('state')}
            if rv:
                st, _, back = http_get('/api/lip/file/%s?p=out&t=%s' % (ja['id'], ja['tk']))
                r['back'] = {'status': st, 'same': sha(back) == clip_sha, 'bytes': len(back)}
            r['revertAgain'] = api(page, '/api/lip/sub_revert', {'id': ja['id'], 't': ja['tk']})
            r['subLong'] = api(page, '/api/lip/sub', {'id': ja['id'], 't': ja['tk'],
                                                      'sents': ['这一句正好十个字呀啊'] * 100})

            # 65MB 那条是假视频：烧不成也要留着原片、说人话
            r['subBad'] = api(page, '/api/lip/sub', {'id': jb['id'], 't': jb['tk'], 'sents': SENTS[:2]})
            badst = wait_sub(page, jb['id'], 'fail', 60)
            r['badDone'] = {'subState': badst.get('subState'), 'subMsg': badst.get('subMsg') or '',
                            'hasOut': bool(badst.get('hasOut')), 'outSize': badst.get('outSize') or 0}
            if badst.get('hasOut'):
                st, _, still = http_get('/api/lip/file/%s?p=out&t=%s' % (jb['id'], jb['tk']))
                r['badStill'] = {'status': st, 'bytes': len(still)}

            # 900 字上限在排队之外单独验一次（job A 已回上一版，不排队了）
            r['mineEnd'] = page.evaluate('''async () => await (await fetch('/api/lip/mine', { method: 'POST',
                headers: { 'content-type': 'application/json' }, body: '{}' })).json()''')
            r['jobsEnd'] = page.evaluate('''async () => await (await fetch('/api/lip/jobs', { method: 'POST',
                headers: { 'content-type': 'application/json' }, body: '{}' })).json()''')
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
    ja = a.get('upA') or {}
    qb = (a.get('quotaBefore') or {}).get('used')
    if ja.get('ok') and ja.get('route') == 'selfup' and ja.get('state') == 'await_mat' and ja.get('segCount') == 0 \
            and ja.get('lack') == '还没传整条片':
        ok('selfup 建单：route=selfup、一建就是「还没传整条片」、不切句（%s）' % ja.get('routeLabel'))
    else:
        bad('selfup 建单不对：%s' % ja)
    if ja.get('used') == qb and ja.get('left') == ja.get('daily'):
        ok('整条片加字幕不占老板每天接单额度（建单前今日 %s 单 → 建完还是 %s 单，还剩 %s/%s）'
           % (qb, ja.get('used'), ja.get('left'), ja.get('daily')))
    else:
        bad('占了接单额度：建前 %s → 建后 %s/%s' % (qb, ja.get('used'), ja.get('daily')))
    if '/lip-record.html?job=' in str(ja.get('url')) and '&t=' in str(ja.get('url')):
        ok('交回来的链接带单号＋口令')
    else:
        bad('链接不对：%s' % ja.get('url'))
    ss = a.get('selfSame') or {}
    if ss.get('ok') and ss.get('route') == 'self':
        ok('同一篇一边排整条片字幕、一边拿逐句录链接不打架（两张单各自在）')
    else:
        bad('同一篇的两条出口打架了：%s' % ss)
    av = a.get('avatar') or {}
    if av.get('ok') and av.get('used') == (qb or 0) + 1:
        ok('只有工单那张占额度：今日 %s/%s（selfup 和逐句录都不算）' % (av.get('used'), av.get('daily')))
    else:
        bad('额度账不对：%s' % av)
    boss = a.get('boss') or {}
    want_ids = [x.get('id') for x in (ja, a.get('selfSame'), a.get('selfOther'), a.get('upBig'), a.get('upOver')) if x and x.get('id')]
    if boss.get('ok') and av.get('id') in (boss.get('ids') or []) and not (set(want_ids) & set(boss.get('ids') or [])):
        ok('工单台只列要动手的那一张；整条片加字幕和逐句录的单一张都不在')
    else:
        bad('工单台列表不对：%s（该只有 %s）' % (boss.get('ids'), av.get('id')))
    mine = (a.get('mine') or {}).get('ids') or []
    if all(x.get('id') in mine for x in (ja, a.get('selfSame'), a.get('selfOther'), a.get('upBig'), a.get('upOver')) if x):
        ok('客户机「我的单」看得见这些单（云端烧好靠它取回）')
    else:
        bad('客户机列表少了单：%s' % mine)
    nt = a.get('noToken') or {}
    bf = a.get('badFeed') or {}
    if nt.get('status') == 403 and bf.get('ok') is False:
        ok('口令不对：取片、看单都拿不到（403 / %s）' % bf.get('error'))
    else:
        bad('错口令没挡住：%s / %s' % (nt, bf))
    au = r.get('audio') or {}
    if au.get('status') == 400 and '整条片只收 mp4 / mov / mkv / webm' in str((au.get('json') or {}).get('error')):
        ok('交音频顶回来：%s' % (au.get('json') or {}).get('error'))
    else:
        bad('音频没顶回来：%s' % au)
    em = r.get('empty') or {}
    if em.get('status') == 400 and '空的' in str((em.get('json') or {}).get('error')):
        ok('空文件顶回来：%s' % (em.get('json') or {}).get('error'))
    else:
        bad('空文件没顶回来：%s' % em)
    ov = r.get('over') or {}
    oj = r.get('overJob') or {}
    if ov.get('status') == 413 and '100MB' in str((ov.get('json') or {}).get('error')) and oj.get('state') == 'await_mat' and not oj.get('hasOut'):
        ok('超过 100MB 看长度就顶回来（%.2f 秒）：%s；那张单没动' % (ov.get('secs') or 0, (ov.get('json') or {}).get('error')))
    else:
        bad('100MB 上限没挡住：%s / %s' % (ov, oj))
    big = r.get('big') or {}
    bj = r.get('bigJob') or {}
    bf = r.get('bigFetch') or {}
    if big.get('status') == 200 and big.get('ok') and bj.get('state') == 'delivered' and bj.get('hasOut') \
            and (bj.get('outSize') or 0) == BIG and bf.get('bytes') == BIG:
        ok('65MB（超过 64MB 那道整体上限）能传、边收边落盘：%.1f 秒；取回来也是 %s 字节'
           % (big.get('secs') or 0, bf.get('bytes')))
    else:
        bad('65MB 直传不对：%s / %s / %s' % (big, bj, bf))
    cp = r.get('clipPut') or {}
    cj = r.get('clipJob') or {}
    cs = r.get('clipSame') or {}
    if cp.get('status') == 200 and cp.get('ok') and cj.get('state') == 'delivered' and cj.get('hasOut') \
            and (cj.get('outSize') or 0) == len(CLIP.read_bytes()) and cs.get('same'):
        ok('真视频整条传上去，云端存的就是原样这一份（%s 字节，一字节没改）' % cj.get('outSize'))
    else:
        bad('真视频上传不对：%s / %s / %s' % (cp, cj, cs))
    sub = r.get('sub') or {}
    dup = r.get('subDup') or {}
    if sub.get('ok') and (sub.get('job') or {}).get('subState') == 'queue' and (sub.get('job') or {}).get('subCount') == 3:
        ok('点「加字幕」：三句进云端排队（subState=queue、subCount=3）')
    else:
        bad('加字幕没排上：%s' % sub)
    if dup.get('ok') is False and '正在云端排字幕' in str(dup.get('error')):
        ok('排队时同一篇连点第二次顶回来：%s' % dup.get('error'))
    else:
        bad('排队连点没拦住：%s' % dup)
    dn = r.get('done') or {}
    bd = r.get('burned') or {}
    if dn.get('subState') == 'done' and dn.get('subMsg') == '' and dn.get('hasOut') and dn.get('canSubRevert') \
            and bd.get('status') == 200 and bd.get('mp4') and bd.get('bytes', 0) > 1000 and not bd.get('same'):
        ok('烧好了：新的那条顶掉原片（%s 字节、真 mp4），旧片还能回（canSubRevert）' % bd.get('bytes'))
    else:
        bad('烧字幕没成：%s / %s' % (dn, bd))
    rv = r.get('revert') or {}
    rj = r.get('revertJob') or {}
    bk = r.get('back') or {}
    if rv.get('ok') and rj.get('subState') == '' and rj.get('hasOut') and bk.get('same') and bk.get('status') == 200:
        ok('↩ 回上一版：拿回的正是原来那条整条片（%s 字节，一字节没动）' % bk.get('bytes'))
    else:
        bad('回上一版不对：%s / %s / %s' % (rv, rj, bk))
    ra = r.get('revertAgain') or {}
    if ra.get('ok') is False and '不在云端了' in str(ra.get('error')):
        ok('再点一次回上一版：说明那条旧片已经不在了')
    else:
        bad('第二次回上一版没拦住：%s' % ra)
    sl = r.get('subLong') or {}
    if sl.get('ok') is False and '900' in str(sl.get('error')):
        ok('稿子超过 900 字不让烧：%s' % sl.get('error'))
    else:
        bad('900 字上限没拦住：%s' % sl)
    sb = r.get('subBad') or {}
    bdn = r.get('badDone') or {}
    bs = r.get('badStill') or {}
    if sb.get('ok') and bdn.get('subState') == 'fail' and '原来那条片没动' in str(bdn.get('subMsg')) \
            and bdn.get('hasOut') and bs.get('status') == 200 and bs.get('bytes') == BIG:
        ok('烧不成时原片一个字没动、状态说人话：%s' % bdn.get('subMsg'))
    else:
        bad('烧不成的失败态不对：%s / %s / %s' % (sb, bdn, bs))
    me = (r.get('mineEnd') or {}).get('quota') or {}
    if me and me.get('used') == (qb or 0) + 1:
        ok('收尾额度还是只算工单那张：今日 %s/%s' % (me.get('used'), me.get('daily')))
    else:
        bad('收尾额度歪了：%s' % me)


if __name__ == '__main__':
    main()
