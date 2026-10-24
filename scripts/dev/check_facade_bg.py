# 🪟 门面笔记那两支后台出稿的自检（批3 · 2026-10-19；2026-10-20 老板改口径：介绍篇版式主导整篇）
# 本机起一台只用临时账本的服务器（DEMO_DATA_DIR 指 tmp/，绝不碰 server/data/），AI 出口拨到本脚本自带的小桩
# （不烧真 Key），然后直接 POST /api/action 走真后台副本——
# 断言四件事：① 回话形状＝界面吃的那份：介绍篇按 AI 自己分的自然段收（几段就是几段，不再硬凑六段），
#              承接篇仍按提纲段数逐段对齐；
# ② 硬钉在出门的提示词里（介绍篇＝那几件事一件不许漏＋分段跟着版式走；承接篇＝段名不许动／不许合并／不许新增；
#    两篇都带：空底料不许编、承接只走主页简介·私信、效果带「各家情况不一样」）；
# ③ 底料空着、回话夹解释或代码块、整段没回、自然段里混进空段——这些走形都兜得住；
# ④ 真没料时报的是人话，不是崩栈。
# 用法：python3 -X utf8 scripts/dev/check_facade_bg.py
import os
import re
import sys
import json
import time
import socket
import shutil
import threading
import subprocess
import urllib.request
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.stdout.reconfigure(encoding='utf-8')
REPO = Path(__file__).resolve().parents[2]
PORT = 8904
BASE = 'http://127.0.0.1:%d' % PORT
DATA = REPO / 'tmp' / 'facade-bg-check' / 'data'
LOGF = REPO / 'tmp' / 'facade-bg-check.server.log'
AI_LOG = []          # 每一发 AI 的原始 messages（{role, content}）
MODE = ['normal']    # 桩的答题套路，测试逐段换
fails = 0


def ok(msg):
    print('  PASS ' + msg, flush=True)


def bad(msg):
    global fails
    fails += 1
    print('  FAIL ' + msg, flush=True)


# ── 提纲与底料：直接从界面那份死表里读，别在自检里再抄一份（表一改这里跟着走）──
SRC = (REPO / 'web' / 'popup.js').read_text(encoding='utf-8')


def outline_of(kind):
    seg = re.search(r'const FACADE_OUTLINE = \{.*?\n\};', SRC, re.S).group(0)
    blk = re.search(kind + r':\s*\{.*?segs:\s*\[(.*?)\n    \],', seg, re.S)
    if not blk:
        raise SystemExit('读不到提纲表 ' + kind)
    return [{'k': m.group(1), 'ask': m.group(2), 'n': int(m.group(3))}
            for m in re.finditer(r"\{ k: '([^']+)', ask: '([^']+)', n: (\d+) \}", blk.group(1))]


def questions_of(kind):
    seg = re.search(r'const FACADE_QUESTIONS = \{.*?\n\};', SRC, re.S).group(0)
    blk = re.search(kind + r':\s*\[(.*?)\n  \],', seg, re.S)
    if not blk:
        raise SystemExit('读不到底料问句 ' + kind)
    return re.findall(r"\{ q: '([^']+)'", blk.group(1))


INTRO_SEGS = outline_of('intro')
DEAL_SEGS = outline_of('deal')
INTRO_QS = questions_of('intro')
DEAL_QS = questions_of('deal')
NO_FILL = '来了我先听你说'


INTRO_FILLED = ['做旧房翻新 8 年，一直在成都', '天天在跑材料市场，一家一家比价格',
                '帮你把旧厨房拆改到能用', '报价先上门量，量完给准数',
                '做过多少单可以翻主页看', '成都本地，跑得了和尚跑不了庙',
                '别家爱先报个高价再让人砍，我不这么干']
DEAL_FILLED = ['最常问的是先量房还是先报价', '按实际面积算，人工和材料分开报',
               '老房承重墙那类活我不接', '定金开工前交，尾款验收完结',
               '看完觉得对得上就私信我']


def seeds_of(kind, blank_idx=()):
    qs = INTRO_QS if kind == 'intro' else DEAL_QS
    filled = INTRO_FILLED if kind == 'intro' else DEAL_FILLED
    return [{'q': q, 'a': ('' if i in blank_idx else (filled[i] if i < len(filled) else ''))}
            for i, q in enumerate(qs)]


def segs_reply(segs, mode):
    """桩按提纲回一版（承接篇）：normal 每段回 n 句；sparse 留两段空；bare 每段只回 1 句"""
    out = []
    for i, s in enumerate(segs):
        if mode == 'sparse' and i in (1, len(segs) - 2):
            out.append([])
            continue
        n = 1 if mode == 'bare' else s['n']
        out.append(['%s第%d句：桩照底料填的这句能念' % (s['k'], j + 1) for j in range(n)])
    return out


def free_reply(items, mode):
    """桩给介绍篇回一版「版式自己分的自然段」：六件事织成三段（几件并一段），不按提纲一段一项。
    sparse 那档多塞一个空段，看后台收不收得干净。"""
    if not items:
        return []
    groups = [items[0:2], items[2:5], items[5:]] if len(items) >= 6 else [items]
    out = []
    for gi, grp in enumerate(groups):
        n = 1 if mode == 'bare' else len(grp)
        sents = []
        for k in grp:
            sents.append('%s：桩织进第%d段的这句能念' % (k, gi + 1))
        out.append(sents[:n] or [grp[0] + '：桩织的这句'])
    if mode == 'sparse':
        out.insert(1, [])   # 故意塞一个空段进去，看后台收不收得干净
    return out


def free_expect(items, mode):
    """期望界面拿到的自然段：桩那份原样，只把空段丢掉"""
    return [r for r in free_reply(items, 'bare' if mode == 'bare' else mode) if r]


class Stub(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        n = int(self.headers.get('content-length') or 0)
        body = json.loads(self.rfile.read(n).decode('utf-8') or '{}')
        AI_LOG.append(body.get('messages') or [])
        sys_txt = ''
        usr_txt = ''
        for m in (body.get('messages') or []):
            if m.get('role') == 'system':
                sys_txt = str(m.get('content') or '')
            elif m.get('role') == 'user':
                usr_txt = str(m.get('content') or '')
        mode = MODE[0]
        if '门面笔记改句人' in sys_txt:
            if mode == 'sent_garbage':
                content = ''
            elif mode == 'sent_prose':
                content = '改好了：\n「我干这行 8 年，一直在成都做旧房翻新」'
            else:
                content = '我干这行 8 年，一直在成都做旧房翻新'
        elif '【原稿正文】' in usr_txt:
            content = '长文桩正文：先把这篇讲什么说清\n长文桩正文：结尾按主页简介收口'
        else:
            mc = re.search(r'要讲的事（一件都不许漏[^）]*）】\n(.*?)\n\n---', usr_txt, re.S)
            if mc:      # 介绍篇：提纲摊成「要讲的事」，桩回的是版式自己分的自然段
                items = []
                for ln in mc.group(1).split('\n'):
                    mm = re.match(r"^\d+\.\s*(.+?)——", ln.strip())
                    if mm:
                        items.append(mm.group(1))
                obj = {'title': '成都做旧房翻新的老张', 'segs': free_reply(items, mode)}
            else:
                m = re.search(r'钉死的提纲（照这个填，一段都不许动）】\n(.*?)\n\n---', usr_txt, re.S)
                segs = []
                if m:
                    for ln in m.group(1).split('\n'):
                        mm = re.match(r"^\d+\.\s*(.+?)（这一段写 (\d+) 句）", ln.strip())
                        if mm:
                            segs.append({'k': mm.group(1), 'n': int(mm.group(2))})
                obj = {'title': '成都做旧房翻新的老张', 'segs': segs_reply(segs, mode) if segs else []}
            txt = json.dumps(obj, ensure_ascii=False)
            content = ('好的，稿子给你写好了：\n```json\n' + txt + '\n```\n不满意随时叫我改'
                       if mode == 'wrapped' else ('我直接写成一段话了，第一段我是谁……' if mode == 'garbage' else txt))
        out = json.dumps({'choices': [{'message': {'role': 'assistant', 'content': content}}]}, ensure_ascii=False)
        buf = out.encode('utf-8')
        self.send_response(200)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(buf)))
        self.end_headers()
        self.wfile.write(buf)


COOKIE = ['']


def post(path, payload):
    req = urllib.request.Request(BASE + path, data=json.dumps(payload).encode('utf-8'),
                                 headers={'Content-Type': 'application/json'})
    if COOKIE[0]:
        req.add_header('Cookie', COOKIE[0])
    r = urllib.request.urlopen(req, timeout=120)
    raw = r.read().decode('utf-8', 'replace')
    sc = r.headers.get('Set-Cookie') or ''
    if sc:
        COOKIE[0] = sc.split(';')[0]
    return json.loads(raw or '{}')


def action(name, payload):
    body = {'action': name}
    body.update(payload)
    j = post('/api/action', body)
    res = j.get('result') if isinstance(j.get('result'), dict) else j
    return res or {}


def hasnail(txt, *keys):
    miss = [k for k in keys if k not in txt]
    return miss


def last_msg(role):
    if not AI_LOG:
        return ''
    return next((str(m.get('content') or '') for m in AI_LOG[-1] if m.get('role') == role), '')


def check_note(res, segs, tag):
    if res.get('demo') == 'need-extension':
        bad('%s：放行清单没带上这一发（回「要装了扩展才能用」）' % tag)
        return ''
    if res.get('ok') is False:
        bad('%s：这发回错了：%r' % (tag, res))
        return ''
    got = res.get('segs')
    if not isinstance(got, list) or len(got) != len(segs):
        bad('%s：段数对不上提纲（回 %s 段，提纲 %s 段）' % (tag, len(got or []), len(segs)))
        return ''
    if not all(isinstance(r, list) and r for r in got):
        bad('%s：有的段不是数组或整段空的：%r' % (tag, got))
        return ''
    over = [(segs[i]['k'], len(got[i]), segs[i]['n']) for i in range(len(segs)) if len(got[i]) > segs[i]['n'] + 1]
    if over:
        bad('%s：有的段句子超出提纲给的句数：%r' % (tag, over))
    txt = '\n'.join(' '.join(r) for r in got)
    if any(c in txt for c in ('```', '#', '」')):
        bad('%s：回稿没擦干净（markdown / 引号还在）：%s' % (tag, txt[:120]))
    print('  PASS %s：回话形状对得上界面吃的字段（%s 段，标题「%s」）' % (tag, len(got), res.get('title', '')))
    return txt


def check_free_note(res, items, tag, mode='normal'):
    """介绍篇（版式主导整篇）：段数跟着 AI 分的自然段走，不再硬凑提纲那六段"""
    if res.get('demo') == 'need-extension':
        bad('%s：放行清单没带上这一发' % tag)
        return ''
    if res.get('ok') is False:
        bad('%s：这发回错了：%r' % (tag, res))
        return ''
    got = res.get('segs')
    want = free_expect(items, mode)
    if not isinstance(got, list) or not got:
        bad('%s：自然段没收回来：%r' % (tag, res))
        return ''
    if not all(isinstance(r, list) and r for r in got):
        bad('%s：有空段或不是数组（空段该丢掉）：%r' % (tag, got))
        return ''
    if len(got) == len(items):
        bad('%s：还按「一件事配一段」凑成 %s 段——版式主导没生效' % (tag, len(got)))
        return ''
    if got != want:
        bad('%s：收的自然段与桩给的不一致：回 %r，期望 %r' % (tag, got, want))
        return ''
    txt = '\n'.join(' '.join(r) for r in got)
    if any(c in txt for c in ('```', '#', '」')):
        bad('%s：回稿没擦干净：%s' % (tag, txt[:120]))
    print('  PASS %s：AI 分几段就收几段（%s 段织 %s 件事，空段丢掉，标题「%s」）'
          % (tag, len(got), len(items), res.get('title', '')))
    return txt


def run():
    if DATA.exists():
        shutil.rmtree(DATA, ignore_errors=True)
    DATA.mkdir(parents=True, exist_ok=True)
    stub = ThreadingHTTPServer(('127.0.0.1', 0), Stub)
    threading.Thread(target=stub.serve_forever, daemon=True).start()
    env = dict(os.environ)
    env['DEMO_DATA_DIR'] = str(DATA)
    env['PORT'] = str(PORT)
    env['DEMO_AI_KEY'] = 'check-only'
    env['DEMO_AI_BASE'] = 'http://127.0.0.1:%d/v1' % stub.server_port
    env['DEMO_SIGNUP_MAX'] = '60'
    with open(LOGF, 'w', encoding='utf-8') as logf:
        srv = subprocess.Popen(['node', str(REPO / 'server' / 'dev-server.mjs')],
                               env=env, stdout=logf, stderr=subprocess.STDOUT)
    for _ in range(80):
        try:
            socket.create_connection(('127.0.0.1', PORT), 1).close()
            break
        except OSError:
            time.sleep(0.5)
    else:
        bad('服务器没起来（看 %s）' % LOGF)
        return
    time.sleep(2)
    boot = LOGF.read_text(encoding='utf-8', errors='replace')
    if '后台副本已就位' in boot:
        ok('后台副本刷完这两支仍能上岗（提纲那两发有真身）')
    else:
        bad('后台副本没上岗：\n%s' % boot[:600])
        srv.terminate()
        return
    try:
        who = post('/api/auth/demo', {'key': 'deco'})
        if not who.get('ok'):
            bad('演示号没进得去：%r' % (who,))
            return
        ok('进了公用演示号（临时账本，只读底子）：%s' % (who.get('account') or {}).get('name'))

        # ── 1 个人介绍：那六件事织成整篇（分几段跟版式走）──
        MODE[0] = 'normal'
        ITEMS = [s['k'] for s in INTRO_SEGS]
        n0 = len(AI_LOG)
        res = action('genFacadeNote', {
            'kind': 'intro', 'lab': '个人介绍',
            'segs': INTRO_SEGS, 'seeds': seeds_of('intro'), 'prev': '', 'title': '',
            'sec': 45, 'chars': 207,
            'style': {'key': 'duibi', 't': '对比型「我不这么干」',
                      'struct': '分四到五段：第1段摆这行一个常见做法，第2段一句「我不这么干」独立成段。',
                      'lead': '开头先摆这行一个常见做法，紧跟一句「我不这么干」。',
                      'hook': '收口给一个低门槛入口的具体动作。',
                      'demo': '很多建材店，你一问，他先问“要什么价位的”。'},
        })
        if len(AI_LOG) != n0 + 1:
            bad('个人介绍这一发没走 AI（桩收到 %d 发）' % (len(AI_LOG) - n0))
        check_free_note(res, ITEMS, '个人介绍整篇')
        sysp = last_msg('system')
        usrp = last_msg('user')
        miss = hasnail(sysp, '把那几件事织成一篇', '全跟着版式走',
                       '一件都不许漏', '绝不要机械地「一件事配一段」',
                       '绝不许编数字', NO_FILL,
                       '主页简介 / 私信我', '绝不写微信',
                       '各家情况不一样', 'segs 就是你按版式分出来的自然段',
                       '只输出一个严格 JSON', '平台红线')
        if miss:
            bad('个人介绍那条提示词缺钉：%s' % miss)
        else:
            ok('介绍篇的钉全在：六件织成整篇 / 不许填表腔 / 空底料不许编 / 承接只走主页简介·私信 / 效果带「各家情况不一样」/ 回话按自然段')
        if '段名一字不改' in sysp or '不许合并' in sysp or '（这一段写' in usrp:
            bad('介绍篇还挂着承接篇那套钉死段序的规矩（该撤）')
        else:
            ok('介绍篇不再喂「段名不许改／每段几句」那套（段序交给版式）')
        if all(s['k'] in usrp and s['ask'] in usrp for s in INTRO_SEGS) and '【要讲的事（一件都不许漏' in usrp:
            ok('要讲的六件事原样喂给 AI（段名 + 这件要写清什么，一件不漏；不管分几段）')
        else:
            bad('要讲的事没完整喂进去：%s' % [s['k'] for s in INTRO_SEGS if s['k'] not in usrp])
        if '分段与节奏：分四到五段' in sysp and '别的版式一律不模仿' in sysp and '版式样板（只学它的调子' in usrp:
            ok('版式那条（分段与节奏＋开头＋收口）进 system，样板进 user 且写明事实不许搬')
        else:
            bad('版式主导的那条指令不全：%s' % sysp[:220])
        miss_sec = hasnail(sysp, '这条片按 45 秒口播控制', '整篇约 207 字', '最多不超过 228 字') \
            + hasnail(usrp, '【时长】按 45 秒口播', '207 字')
        if not miss_sec:
            ok('秒数／字数进了提示词：system 钉「45 秒、约 207 字、最多 228 字」，user 再带一条时长要求')
        else:
            bad('秒数／字数没钉进提示词（缺 %r）：system 含「秒口播」=%r；user 含「【时长】」=%r'
                % (miss_sec, '秒口播' in sysp, '【时长】' in usrp))

        # ── 2 成交承接：仍按钉死的五段逐段填 ──
        MODE[0] = 'bare'
        res = action('genFacadeNote', {
            'kind': 'deal', 'lab': '成交承接',
            'segs': DEAL_SEGS, 'seeds': seeds_of('deal'), 'prev': '', 'title': '已经有的标题',
        })
        check_note(res, DEAL_SEGS, '成交承接整篇')
        ds = last_msg('system')
        du = last_msg('user')
        if hasnail(ds, '段名一字不改', '不许合并', '不许新增', 'segs 的长度必须等于提纲的段数'):
            bad('承接篇的钉死段序规矩丢了：%s' % ds[:200])
        else:
            ok('承接篇仍按提纲钉死（段名不许改／不许合并／不许新增／段数必须对上）')
        if '【钉死的提纲' in du and du.count('（这一段写') == len(DEAL_SEGS):
            ok('承接篇的提纲原样喂进去（%s 段，每段几句都标着）' % len(DEAL_SEGS))
        else:
            bad('承接篇提纲没完整喂进去：%s' % du[:160])
        if '一次讲明白' in ds:
            ok('成交承接那条的说话口径跟着换（不是介绍篇那一套）')
        else:
            bad('成交承接的提示词没换成自己那套')
        if '【这篇现在用的标题（没让你改就别改）】已经有的标题' in du:
            ok('已有标题带过去并叮嘱别改')
        else:
            bad('已有标题没带上')
        if '秒口播' not in ds and '秒口播' not in du:
            ok('承接篇是长文，不带口播时长那条')
        else:
            bad('承接篇混进了口播时长要求')

        # ── 3 底料有空着：明写「没填」，不许编 ──
        MODE[0] = 'normal'
        action('genFacadeNote', {
            'kind': 'intro', 'lab': '个人介绍',
            'segs': INTRO_SEGS, 'seeds': seeds_of('intro', blank_idx=(2, 3, 4, 5)), 'prev': '', 'title': '',
        })
        u = last_msg('user')
        if u.count('（没填——这一块按硬要求 2 处理，不许编）') == 4:
            ok('空着的底料明写成「没填、不许编」（4 问空 → 桩里 4 处）')
        else:
            bad('空底料没标出来：%s' % u[:200])

        # ── 4 重出一版：上一版带过去，措辞沿用 ──
        MODE[0] = 'normal'
        action('genFacadeNote', {
            'kind': 'intro', 'lab': '个人介绍',
            'segs': INTRO_SEGS, 'seeds': seeds_of('intro'),
            'prev': '我是谁第1句：人改过的那句留着', 'title': '成都做旧房翻新的老张',
        })
        s = last_msg('system')
        uu = last_msg('user')
        if '旁边已经有一版' in s and '【已有一版（沿用它的措辞）】' in uu:
            ok('整篇重出：上一版带过去，叮嘱别把人改过的又改回去')
        else:
            bad('重出那一发没带上上一版')

        # ── 4b 顺版式那一发（2026-10-20 改稿站）：版式指令进 system、样板进 user，重出规则跟着挪号 ──
        MODE[0] = 'normal'
        action('genFacadeNote', {
            'kind': 'intro', 'lab': '个人介绍',
            'segs': INTRO_SEGS, 'seeds': seeds_of('intro'),
            'prev': '整篇现在这版的第一段……', 'title': '成都做旧房翻新的老张',
            'style': {'key': 'duibi', 't': '对比型「我不这么干」',
                      'focus': '同行那个先报高价再砍的做法 vs 我的做法',
                      'struct': '分四到五段：第1段摆常见做法，第2段一句「我不这么干」独立成段。',
                      'lead': '开头先摆这行一个常见做法，紧跟一句「我不这么干」。',
                      'hook': '收口给一个低门槛入口的具体动作。',
                      'demo': '很多建材店，你一问，他先问“要什么价位的”。'},
        })
        s = last_msg('system')
        uu = last_msg('user')
        if '6) 这一版只让读者记住一件事——【主线】同行那个先报高价再砍的做法 vs 我的做法' in s \
                and '7) 这一版用【版式 · 对比型' in s and '分段与节奏：分四到五段' in s \
                and '开头先摆这行一个常见做法' in s and '收口给一个低门槛入口' in s \
                and '8) 【版式样板】' in s and '9) 旁边已经有一版' in s:
            ok('顺版式那一发：主线(6)＋分法(7)＋样板(8)＋上一版(9) 规矩都在，编号没挤乱')
        else:
            bad('版式没进 system 或重出规矩号乱了：%s' % s[:260])
        if '版式样板（只学它的调子' in uu and '很多建材店' in uu and '【这一版的主线】同行那个先报高价再砍的做法 vs 我的做法' in uu:
            ok('主线与样板都进 user；样板写明「只学调子、事实一个不许搬」')
        else:
            bad('主线或样板没带上：%s' % uu[:260])
        # 点版式卡＝另起一版：上一版正文与标题一个字都不喂（2026-10-21 问题 5）
        action('genFacadeNote', {
            'kind': 'intro', 'lab': '个人介绍',
            'segs': INTRO_SEGS, 'seeds': seeds_of('intro'),
            'prev': '这是上一版的正文ABC', 'title': '这是上一版的标题XYZ', 'fresh': True,
            'style': {'key': 'wenda', 't': '问答型「老有人问我…」',
                      'focus': '客户最常问的那几个问题',
                      'struct': '分四到五段：一问一答往下排。',
                      'lead': '开头先抛一个客户常问的问题。',
                      'hook': '收口指到主页简介。',
                      'demo': '老有人问我，一平方到底多少钱。'},
        })
        s = last_msg('system')
        uu = last_msg('user')
        if '这是另起一版' in s and '旁边已经有一版' not in s \
                and '这是上一版的正文ABC' not in uu and '这是上一版的标题XYZ' not in uu \
                and '【这一版的主线】客户最常问的那几个问题' in uu:
            ok('另起一版：上一版正文与旧标题都没喂，主线另给；system 写明「不沿用上一版」')
        else:
            bad('另起一版还带着上一版：system=%s / user=%s' % (s[:180], uu[:180]))
        # 不传 style（承接篇那条路）：system 里不该冒出版式话
        action('genFacadeNote', {
            'kind': 'deal', 'lab': '成交承接',
            'segs': DEAL_SEGS, 'seeds': seeds_of('deal'), 'prev': '', 'title': '',
        })
        if '版式' not in last_msg('system') and '版式' not in last_msg('user'):
            ok('没传版式的一发（承接篇）：提示词里不冒版式话，老行为原样')
        else:
            bad('没传 style 却混进了版式话')

        # ── 4c 说一句改整篇（2026-10-20 改稿站蓝框）：ask 带 prev 才进「优先满足它」，规则号排版式/带上一版之后 ──
        MODE[0] = 'normal'
        n4c = len(AI_LOG)
        action('genFacadeNote', {
            'kind': 'intro', 'lab': '个人介绍',
            'segs': INTRO_SEGS, 'seeds': seeds_of('intro'),
            'prev': '整篇现在这版的第一段……', 'title': '成都做旧房翻新的老张',
            'style': {'key': 'duibi', 't': '对比型「我不这么干」',
                      'struct': '分四到五段：第1段摆常见做法，第2段独立成段。',
                      'lead': '开头先摆这行一个常见做法，紧跟一句「我不这么干」。',
                      'hook': '收口给一个低门槛入口的具体动作。',
                      'demo': '很多建材店，你一问，他先问“要什么价位的”。'},
            'ask': '第三段那两句合成一句',
        })
        if len(AI_LOG) != n4c + 1:
            bad('说一句改整篇这一发没走 AI（桩收到 %d 发）' % (len(AI_LOG) - n4c))
        s = last_msg('system')
        uu = last_msg('user')
        if '9) 用户对上一版提了一句' in s and '这一趟优先满足它' in s \
                and '8) 旁边已经有一版' in s and '6) 这一版用【版式 ·' in s:
            ok('说一句改整篇：优先满足用户那句的规矩进了 system，编号排在版式(6)、带上一版(8)之后没挤乱')
        else:
            bad('ask 那发 system 规矩不全或编号乱：%s' % s[-500:])
        if '【你这版哪里不对（先按这句改）】\n第三段那两句合成一句' in uu:
            ok('用户那句评价原样进 user（照这句改，别自作主张动别的）')
        else:
            bad('user 里没带上那句评价：%s' % uu[-200:])
        # 只带 ask 不带 prev（第一次出稿就写评价）：不该冒「优先满足它」
        action('genFacadeNote', {
            'kind': 'intro', 'lab': '个人介绍',
            'segs': INTRO_SEGS, 'seeds': seeds_of('intro'),
            'prev': '', 'title': '', 'ask': '短一点',
        })
        if '优先满足它' not in last_msg('system') and '你这版哪里不对' not in last_msg('user'):
            ok('没有上一版时光有评价：不冒「优先满足它」，按首次出稿走')
        else:
            bad('ask 没配 prev 却混进了重出的规矩')

        # ── 4d 只换标题（need:'title'）：正文一个字不动，回 titleOnly ──
        MODE[0] = 'normal'
        n4d = len(AI_LOG)
        res = action('genFacadeNote', {
            'kind': 'intro', 'lab': '个人介绍',
            'segs': INTRO_SEGS, 'seeds': seeds_of('intro'),
            'prev': '', 'title': '现在这个标题', 'need': 'title',
        })
        if len(AI_LOG) != n4d + 1:
            bad('换标题这一发走了 %d 趟 AI（该只 1 趟）' % (len(AI_LOG) - n4d))
        tt = str(res.get('title') or '')
        if res.get('titleOnly') is True and tt and len(tt) <= 20:
            ok('换标题回的是 titleOnly＋一条 ≤20 字标题（「%s」），界面只顶标题不顶正文' % tt)
        else:
            bad('换标题回话形状不对：%r' % (res,))
        s = last_msg('system')
        uu = last_msg('user')
        if '只给它另想一个标题' in s and '别只改一两个字糊弄' in s and '现在这个标题' in s:
            ok('换标题的提示词钉死「只换标题」并带上现标题叮嘱换个说法')
        else:
            bad('换标题 system 缺钉：%s' % s[:200])
        if '【这篇要讲的几件事（正文一个字不动，只给配个标题）】' in uu and '我是谁' in uu \
                and '【底料（唯一事实来源）】' in uu \
                and '【已有一版' not in uu and '【钉死的提纲（照这个填' not in uu:
            ok('换标题（介绍篇）的 user 只喂「要讲的几件事」＋底料，不带正文提纲也不带上一版')
        else:
            bad('换标题（介绍篇）user 块不对：%s' % uu[:200])
        # 承接篇换标题：仍按提纲那份说法喂
        action('genFacadeNote', {
            'kind': 'deal', 'lab': '成交承接',
            'segs': DEAL_SEGS, 'seeds': seeds_of('deal'),
            'prev': '', 'title': '现在这个标题', 'need': 'title',
        })
        uu = last_msg('user')
        if '【这篇分几段讲什么（钉死的提纲，别动正文只给配个标题）】' in uu and '【底料（唯一事实来源）】' in uu \
                and '【已有一版' not in uu:
            ok('换标题（承接篇）仍按提纲那几件事喂、不带正文（老行为原样）')
        else:
            bad('换标题（承接篇）user 块不对：%s' % uu[:200])

        # ── 5 回话夹解释 + 代码块：照样拆开 ──
        MODE[0] = 'wrapped'
        res = action('genFacadeNote', {
            'kind': 'deal', 'lab': '成交承接',
            'segs': DEAL_SEGS, 'seeds': seeds_of('deal'), 'prev': '', 'title': '',
        })
        check_note(res, DEAL_SEGS, '回话夹解释与代码块')

        # ── 6a 介绍篇自然段里混进空段：直接丢掉，界面不出现空段 ──
        MODE[0] = 'sparse'
        res = action('genFacadeNote', {
            'kind': 'intro', 'lab': '个人介绍',
            'segs': INTRO_SEGS, 'seeds': seeds_of('intro'), 'prev': '', 'title': '',
        })
        check_free_note(res, ITEMS, '介绍篇空段丢掉', 'sparse')

        # ── 6b 承接篇有两段整段没回：兜成不倒话，不让那一段空着 ──
        res = action('genFacadeNote', {
            'kind': 'deal', 'lab': '成交承接',
            'segs': DEAL_SEGS, 'seeds': seeds_of('deal'), 'prev': '', 'title': '',
        })
        rows = res.get('segs') or []
        if len(rows) == len(DEAL_SEGS) and rows and all(r for r in rows):
            padded = [i for i, r in enumerate(rows) if r == [NO_FILL]]
            if padded:
                ok('承接篇整段没回的两段兜成「%s」（第 %s 段），界面不会出现空段' % (NO_FILL, '、'.join(str(i + 1) for i in padded)))
            else:
                bad('空段没兜住：%r' % rows)
        else:
            bad('空段兜底后形状不对：%r' % rows)

        # ── 7 回话没成 JSON：报人话，不报崩栈 ──
        MODE[0] = 'garbage'
        res = action('genFacadeNote', {
            'kind': 'intro', 'lab': '个人介绍',
            'segs': INTRO_SEGS, 'seeds': seeds_of('intro'), 'prev': '', 'title': '',
        })
        err = str(res.get('error') or '')
        if res.get('ok') is False and err and 'Traceback' not in err and '再试一次' in err:
            ok('AI 回话没成格式时报的是人话：%s' % err[:40])
        else:
            bad('这一发没兜成人话：%r' % (res,))

        # ── 8 认不出的篇名 / 提纲空 ──
        res = action('genFacadeNote', {'kind': 'case', 'segs': INTRO_SEGS, 'seeds': []})
        if res.get('ok') is False and '个人介绍' in str(res.get('error') or ''):
            ok('不是这两篇的活儿直接拦下（案例不做门面条目）：%s' % str(res.get('error'))[:34])
        else:
            bad('篇名拦不住：%r' % (res,))
        res = action('genFacadeNote', {'kind': 'intro', 'segs': [], 'seeds': []})
        if res.get('ok') is False and '提纲' in str(res.get('error') or ''):
            ok('提纲没带过来也报人话（回① 补底料那站重进）')
        else:
            bad('空提纲没拦下：%r' % (res,))

        # ── 9 只改那一句（介绍篇：没有段名了，只喂原句＋上下文）──
        MODE[0] = 'normal'
        res = action('genFacadeSentence', {
            'kind': 'intro', 'seg': '', 'askSeg': '',
            'sentence': '我是老张', 'ask': '把城市和年限带上，短一点',
            'seeds': seeds_of('intro'), 'context': '我是老张\n天天在跑材料市场，一家一家比价格',
        })
        txt = str(res.get('text') or '')
        if res.get('ok') is not False and txt and '\n' not in txt and '"' not in txt and '：' not in txt[:6]:
            ok('只改那一句：回的是这句本身（界面直接塞回原位置）——「%s」' % txt[:34])
        else:
            bad('改句回话不对：%r' % (res,))
        s = last_msg('system')
        u = last_msg('user')
        miss = hasnail(s, '只输出改好的那一句', '绝不许编数字', '主页简介 / 私信我', '各家情况不一样', '只改用户点到的这一句')
        if miss:
            bad('改句那条提示词缺钉：%s' % miss)
        else:
            ok('改句也带四条硬钉，且叮嘱只动这一句')
        if '【这一句所在的段】' not in u and '【现在的这一句】' in u and '【这次要怎么改】把城市和年限带上' in u and '整篇现在长这样' in u:
            ok('介绍篇改句不带「所在的段」（段序已由版式定），只喂原句 / 怎么改 / 整篇上下文')
        else:
            bad('介绍篇改句的 user 块不对：%s' % u[:160])
        # 承接篇改句：仍带「这一段要写清什么」
        action('genFacadeSentence', {
            'kind': 'deal', 'seg': DEAL_SEGS[0]['k'], 'askSeg': DEAL_SEGS[0]['ask'],
            'sentence': '最常问的是先量房还是先报价', 'ask': '顺一点',
            'seeds': seeds_of('deal'), 'context': '这一段的第一句',
        })
        u = last_msg('user')
        if ('【这一句所在的段】' + DEAL_SEGS[0]['k']) in u and ('这一段要写清：' + DEAL_SEGS[0]['ask']) in u:
            ok('承接篇改句仍喂齐四块：哪一段 / 这段要写清什么 / 原句 / 怎么改')
        else:
            bad('承接篇改句的 user 块不全：%s' % u[:160])

        # ── 10 改句走形与没料 ──
        MODE[0] = 'sent_prose'
        res = action('genFacadeSentence', {'kind': 'intro', 'sentence': '我是老张', 'ask': '顺一点', 'seeds': seeds_of('intro')})
        txt = str(res.get('text') or '')
        if txt and not txt.startswith('改好了') and '「' not in txt:
            ok('改句回话带解释与书名号也擦干净：「%s」' % txt[:30])
        else:
            bad('改句没擦干净：%r' % (res,))
        MODE[0] = 'sent_garbage'
        res = action('genFacadeSentence', {'kind': 'intro', 'sentence': '我是老张', 'ask': '顺一点', 'seeds': []})
        if res.get('ok') is False and '这句没改出来' in str(res.get('error') or ''):
            ok('这句没改出来时报人话（界面会退回原句、按钮恢复）')
        else:
            bad('改句空回没兜住：%r' % (res,))
        res = action('genFacadeSentence', {'kind': 'intro', 'sentence': '', 'ask': '顺一点', 'seeds': []})
        if res.get('ok') is False and '先打一句' in str(res.get('error') or ''):
            ok('空句子不发给 AI（界面点「✍️ 自己改」）')
        else:
            bad('空句子没拦住：%r' % (res,))
        res = action('genFacadeSentence', {'kind': 'intro', 'sentence': '我是老张', 'ask': '', 'seeds': []})
        if res.get('ok') is False and '想怎么改' in str(res.get('error') or ''):
            ok('没提要求也不发 AI')
        else:
            bad('没提要求没拦住：%r' % (res,))

        # ── 11 顺手确认：「✨ 出长文」那一发也进了放行清单（2026-10-19 老板点头补的）──
        MODE[0] = 'longform'
        res = action('genNoteLongform', {'title': '这一篇讲省时间',
                                         'content': '正文一句：一键把散素材拼成一条片子'})
        if res.get('demo') == 'need-extension':
            bad('「✨ 出长文」还是没进放行清单（公网点它会回「要装了扩展才能用」）')
        elif res.get('ok') is False:
            bad('长文这一发回错了：%r' % (res,))
        elif '长文桩正文' in str(res.get('script') or ''):
            ok('「✨ 出长文」补进放行清单了（现在穿得过服务器、进后台副本、拿到稿）')
        else:
            bad('长文回话不对：%r' % (res,))

        # ── 12 放行清单：这两发都不该回「要扩展」 ──
        blocked = []
        for nm, pl in (('genFacadeNote', {'kind': 'deal', 'segs': DEAL_SEGS, 'seeds': seeds_of('deal')}),
                       ('genFacadeSentence', {'kind': 'deal', 'sentence': '这句', 'ask': '短点', 'seeds': []})):
            r = action(nm, pl)
            if r.get('demo') == 'need-extension':
                blocked.append(nm)
        if blocked:
            bad('这两发没进服务器放行清单：%s' % blocked)
        else:
            ok('两发都过了服务器放行清单（公网那台点得动）')
        print('  NOTE 桩共收到 %d 发 AI（全部走本机小桩，没烧真 Key）' % len(AI_LOG), flush=True)
    finally:
        srv.terminate()
        stub.shutdown()


run()
print(('ALL PASS' if not fails else '%d 处 FAIL' % fails), flush=True)
sys.exit(1 if fails else 0)
