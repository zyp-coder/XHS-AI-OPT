# -*- coding: utf-8 -*-
"""混剪／卡片并进片台以后 · 真实 web 自检（10-23 改：页签化以后这一条跑垫满屏，末尾再跑一遍垫进卡）

验的是 web/ 这条路：「字体动效」和「混剪」并成一条，画面层降成片台「分幕｜画面」里的一签：
  ① 成片形式表 3 格（大字片／文案直出／动态视频）；老叫法「混剪视频」「卡片画面叙事」仍认得，
     分别落到「垫满屏」「垫进卡」，都算本机出片；
  ② 「📚 知识」那行 4 张卡，视频只剩「字体动效视频」一张（自带形式，点进去直接是片台）；
  ③ 片台分幕区两个页签：「分幕」改字、「画面」配画面；画面签里「不加／加画面」开关，
     加画面再二选一「垫满屏／垫进卡」；「背景音乐」「音效」只在有底时摆出来；
  ④ 顶上那栏报「几屏有料／还差几屏／几屏料不够长」；「✨ AI 先配一版」拿稿子的字撞素材库（不发图问 AI），
     一屏不够长就多撞几段拼上；对不上就往下退：先退到只撞上一个字，再退到拿这一版里现成的段／照片垫上
     （标「通用」，垫满这一屏、不受 3 秒封顶），实在没辙才红字标「配不到」，并给「只看配不到的」滤一遍；
  ⑤ 一屏的料是一单不是一段：几节按原片里的先后排；末节短成一秒的碎尾摊掉；
     还差就让最后一节从头再播（最多补 3 秒），再差就在屏上点名「还差几秒」；
  ⑥ 照片屏不拼（一屏就一张）；点「＋加一节」能按文件夹、按名字/标签搜，点一格追加进来；
  ⑦ 照片库里只有小图 →「🖼 补照片原图」一次多选，按文件名对上，只这一趟用、不入库；
  ⑧ 画面真垫进去了：照片那屏比没料时亮；段那屏拿到会播的原视频；换到下一节那一节自己重新淡入；
  ⑨ 音效不跟换屏响，跟「字弹出来那一下」响＝这一幕起 + 0.42 秒；讲坑的响闷「咚」、讲好处的响轻亮「啵」、
     平常一句极轻带一下（每屏的调在画面那一签点着换）；
  ⑩ 出片：垫满屏不走逐帧编码、不派执行器，改边播边录；配音＋背景音乐＋跟字音效三条轨混成一条，
     时长对得上、带声音；
  ⑪ 草稿按篇存住：一屏一单（只留引用，照片不把小图抄进草稿），旧草稿只有一段也接得上；
  ⑫ 垫进卡这一路：带画面表进来先排幕不铺图；拨「垫进卡」才按段铺底图（没图那段写纯色卡）；
     关掉再打开记着这一种垫法，按篇草稿也记着；
  ⑬ 全程无页内报错。

跑法：python3 -X utf8 scripts/dev/check_mix_film_web.py
只跑装配、不真出片：MIX_NOFILM=1 python3 -X utf8 scripts/dev/check_mix_film_web.py
本机起 dev-server（临时账本；AI 接口指到不可达的本机端口，绝不打真接口）；
Edge 真开页（配音认这个）；出片这一段会真录一遍片子，别在此期间关窗口。
"""
import base64
import os
import sys
import time
import socket
import shutil
import subprocess
from pathlib import Path

from playwright.sync_api import sync_playwright

from _guide_gate import goto_big

sys.stdout.reconfigure(encoding='utf-8')
REPO = Path(__file__).resolve().parents[2]
PORT = 8927
BASE = 'http://127.0.0.1:%d' % PORT
WORK = REPO / 'tmp' / 'mix-film-web-check'
DATA = WORK / 'data'
PROFILE = WORK / 'profile'
SRC_MP4 = WORK / 'mix-src.mp4'           # 原视频：切段的料（两条实拍拼一条）
PHOTO_BIG = WORK / '五金门头.jpg'         # 「补照片原图」要选的那张原图
PHOTO_THUMB = WORK / 'thumb-door.png'     # 库里那张小图（≤160px）
STASH = REPO / 'tmp' / 'mix-demo-assets'  # 预放的「像真拍的」料：有就拿它当种子（工作目录每趟会重建）
fails = 0
FILM = os.environ.get('MIX_NOFILM') != '1'

# 口播稿：三句，每句的字跟素材的名字/标签对得上（AI 先配一版靠本机对文字）
# 第一句特意写长（5 秒多），一段素材只有 2.4 秒，逼它一屏拼两节
SENTS = ['瓷砖要挑对，先看客厅地面贴得平不平，缝宽窄匀不匀。',
         '花洒装得好，洗澡才不积水，用着舒心不费事。',
         '门头旧旧的，客人路过也不停。']
SCRIPT = '\n'.join(SENTS)


def ok(msg):
    print('  PASS ' + msg, flush=True)


def bad(msg):
    global fails
    fails += 1
    print('  FAIL ' + msg, flush=True)


def wait_js(page, expr, timeout=30000, interval=300, arg=None):
    end = time.time() + timeout / 1000.0
    while time.time() < end:
        try:
            if (page.evaluate(expr) if arg is None else page.evaluate(expr, arg)):
                return True
        except Exception:
            pass
        page.wait_for_timeout(interval)
    return False


def j(page, expr, arg=None):
    return page.evaluate(expr) if arg is None else page.evaluate(expr, arg)


def run(cmd):
    subprocess.run(cmd, check=True)


def stage_assets():
    """演示料从旁边那份挪进工作目录（工作目录每趟清空重建）；没预放就退回下面的合成色片"""
    for name, dst in (('mix-src.mp4', SRC_MP4), ('door-big.jpg', PHOTO_BIG), ('door-thumb.png', PHOTO_THUMB)):
        src = STASH / name
        if src.exists():
            shutil.copyfile(src, dst)


def make_video():
    """三段实拍拼一条 8.3 秒小片（10fps，够当原视频用）；要是工作目录里已经放了好看的真料就不重生成"""
    if SRC_MP4.exists():
        return
    ft = "fontfile='C\\:/Windows/Fonts/arial.ttf'"
    one = ("[v%d]drawtext=%s:text=%s:fontsize=64:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2[q%d];"
           "[q%d]setpts=PTS-STARTPTS,fps=10[o%d]")
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
         '-f', 'lavfi', '-i', 'color=c=0x30506f:s=640x360:d=2.7',
         '-f', 'lavfi', '-i', 'color=c=0x60687a:s=640x360:d=2.7',
         '-f', 'lavfi', '-i', 'color=c=0x7f5030:s=640x360:d=2.9',
         '-filter_complex',
         (one % (0, ft, 'ROOM', 0, 0, 0)) + ';' + (one % (1, ft, 'WALL', 1, 1, 1)) + ';' +
         (one % (2, ft, 'BATH', 2, 2, 2)) + ';[o0][o1][o2]concat=n=3:v=1:a=0[v]',
         '-map', '[v]', '-r', '10', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(SRC_MP4)])


def make_photo():
    if PHOTO_BIG.exists():
        return
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
         '-f', 'lavfi', '-i', 'color=c=0x2f6f4f:s=800x600:d=1', '-frames:v', '1', str(PHOTO_BIG)])
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
         '-f', 'lavfi', '-i', 'color=c=0x2f6f4f:s=160x120:d=1', '-frames:v', '1', str(PHOTO_THUMB)])


def b64(p):
    return base64.b64encode(p.read_bytes()).decode()


def seed(page):
    """往素材库种一摊料：一个文件夹、一条原视频、三段切好的段、一张照片；原视频本体进本机那个仓"""
    return j(page, '''async (a) => {
        const cols = [{ id: 'col_mix', name: '自检·阳光小区', brief: '', consent: false, status: '在用',
                        folder: true, noVision: false, at: Date.now() }];
        const vids = [{ id: 'vid_mix', name: 'mix-src.mp4', col: 'col_mix', batchId: '', dur: 8.3, poster: '' }];
        const clips = [
          { id: 'clip_room', col: 'col_mix', videoId: 'vid_mix', shot: -1, a: 0.0, b: 2.4, dur: 2.4,
            name: '客厅瓷砖', tags: ['瓷砖', '客厅'], desc: '贴好的客厅地面', ref: 'src:vid_mix', at: Date.now() },
          { id: 'clip_wall', col: 'col_mix', videoId: 'vid_mix', shot: -1, a: 2.7, b: 5.1, dur: 2.4,
            name: '瓷砖墙面', tags: ['瓷砖', '墙面'], desc: '墙面贴完的样子', ref: 'src:vid_mix', at: Date.now() },
          { id: 'clip_bath', col: 'col_mix', videoId: 'vid_mix', shot: -1, a: 5.4, b: 8.1, dur: 2.7,
            name: '卫浴花洒', tags: ['花洒', '卫浴'], desc: '装好的花洒', ref: 'src:vid_mix', at: Date.now() },
          { id: 'pic_door', col: 'col_mix', imgOnly: true, src: '五金门头.jpg', name: '五金门头',
            tags: ['门头', '五金'], desc: '店门口', stage: '', kb: null, vo: '', fo: [],
            thumb: a.thumb, w: 800, h: 600, ref: '', at: Date.now() },
        ];
        await chrome.storage.local.set({ np_collections: cols, np_videos: vids, np_clips: clips });
        const db = await new Promise((res, rej) => {
          const rq = indexedDB.open('xhsCase', 1);
          rq.onupgradeneeded = () => { if (!rq.result.objectStoreNames.contains('case'))
              rq.result.createObjectStore('case', { keyPath: 'key' }); };
          rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
        });
        const bin = atob(a.mp4), buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        await new Promise((res, rej) => {
          const tx = db.transaction('case', 'readwrite');
          tx.objectStore('case').put({ key: 'src:vid_mix', blob: new Blob([buf], { type: 'video/mp4' }) });
          tx.oncomplete = res; tx.onerror = () => rej(tx.error);
        });
        const got = await new Promise((res) => {
            const rq = db.transaction('case', 'readonly').objectStore('case').get('src:vid_mix');
            rq.onsuccess = () => res(!!(rq.result && rq.result.blob));
        });
        return { stored: got, clips: clips.length, kb: Math.round(buf.length / 1024) };
    }''', {'mp4': b64(SRC_MP4), 'thumb': 'data:image/png;base64,' + b64(PHOTO_THUMB)})


def main():
    print('── 混剪视频（知识线）· 真实 web 自检 ──', flush=True)
    if WORK.exists():
        shutil.rmtree(WORK, ignore_errors=True)
    WORK.mkdir(parents=True, exist_ok=True)
    stage_assets()
    make_video()
    make_photo()
    DATA.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env['DEMO_DATA_DIR'] = str(DATA)
    env['PORT'] = str(PORT)
    env['DEMO_AI_KEY'] = 'check-only'
    env['DEMO_AI_BASE'] = 'http://127.0.0.1:1/v1'      # 不可达：验「AI 没跑成也不挡路」
    env['VISION_API_KEY'] = 'selfcheck-dummy'
    env['VISION_API_BASE'] = 'http://127.0.0.1:1/v1'
    env['DEMO_SIGNUP_MAX'] = '60'
    logf = open(WORK / 'server.log', 'w', encoding='utf-8')
    srv = subprocess.Popen(['node', str(REPO / 'server' / 'dev-server.mjs')], env=env, stdout=logf, stderr=subprocess.STDOUT)
    for _ in range(80):
        try:
            socket.create_connection(('127.0.0.1', PORT), 1).close()
            break
        except OSError:
            time.sleep(0.5)
    else:
        bad('服务器没起来（看 tmp/mix-film-web-check/server.log）')
        return 1
    time.sleep(2)

    errs = []
    statuses = []
    try:
        with sync_playwright() as p:
            ctx = p.chromium.launch_persistent_context(
                str(PROFILE), channel='msedge', headless=False, accept_downloads=True,
                viewport={'width': 1500, 'height': 950},
                args=['--autoplay-policy=no-user-gesture-required'])
            page = ctx.new_page()
            page.on('pageerror', lambda e: errs.append(str(e)))
            page.on('dialog', lambda d: d.accept())

            page.goto(BASE + '/start.html', wait_until='domcontentloaded', timeout=90000)
            page.wait_for_timeout(2000)
            who = page.evaluate('''async () => await (await fetch('/api/auth/demo', { method: 'POST',
                headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'deco' }) })).json()''')
            if not who.get('ok'):
                bad('演示号没进上：%r' % (who,))
                ctx.close()
                return 1
            goto_big(page, BASE + '/popup.html?mode=big', wait_until='domcontentloaded', timeout=90000)
            page.wait_for_timeout(1500)
            print('  浏览器 = Edge（配音认这个）：%s' % j(page, '() => /Edg\\//.test(navigator.userAgent)'), flush=True)

            # ── ① 成片形式表：门口三格（混剪并进片台了）＋老叫法还认得 ──
            kinds = j(page, '''() => NP_FILM_KINDS.map(x => ({ k: x.k, icon: x.icon, frame: x.frame || '', shot: !!x.shot }))''')
            case_card = j(page, '''() => NP_DIR_EFFECTS.c.map(e => e.t)''')
            if len(kinds) == 3 and kinds[0]['k'] == 'PPT字体动效' and kinds[0]['frame'] == 'text' and not kinds[0]['shot'] \
                    and kinds[2]['shot'] and case_card == ['案例成片']:
                ok('成片形式 %d 格（大字片／文案直出／动态视频，混剪不再单列）；案例那条还叫「%s」，没改名' % (len(kinds), case_card[0]))
            else:
                bad('成片形式表不对：%r｜案例卡：%r' % (kinds, case_card))
            gate = j(page, '''() => ({ mix: npKindFrame('混剪视频'), card: npKindFrame('卡片画面叙事'),
                mixLocal: npKindLocal('混剪视频'), cardLocal: npKindLocal('卡片画面叙事'),
                mixShot: npKindNeedsShot('混剪视频'), cardShot: npKindNeedsShot('卡片画面叙事'),
                style: NP_KIND_VIDEO_STYLE['混剪视频'] })''')
            if gate['mix'] == 'mix' and gate['card'] == 'card' and gate['mixLocal'] and gate['cardLocal'] \
                    and not gate['mixShot'] and gate['cardShot'] and gate['style'] == '口播讲解':
                ok('老篇的两个叫法都还认得：混剪视频→垫满屏、卡片画面叙事→垫进卡；都算本机出片，风格派生成「口播讲解」')
            else:
                bad('老篇的形式口径不对：%r' % (gate,))

            # ── ② 知识线那一行少一张卡（混剪并了）；字体动效卡自带形式，点进去直接是片台 ──
            cards = j(page, '''() => NP_DIR_EFFECTS.k.map(e => ({ f: e.f, id: e.id || '', kind: e.kind || '', t: e.t }))''')
            vid = [c for c in cards if c['f'] == '视频']
            if len(cards) == 4 and len(vid) == 1 and vid[0]['kind'] == 'PPT字体动效':
                ok('「📚 知识」那行 %d 张卡：视频只剩「%s」一张（混剪已并进片台，形式自带＝%s）' % (
                    len(cards), vid[0]['t'], vid[0]['kind']))
            else:
                bad('知识行的卡不对：%r' % (cards,))
            built = j(page, '''async () => {
                const n = await npDirNewNote('k', '视频', '', { filmKind: '混剪视频' });
                const all = await npNotesAll();
                const back = all.find(x => x && x.id === n.id);
                return { id: String(n.id), form: n.form, filmKind: String(n.filmKind || ''),
                         kOut: String(n.kOut || ''), fromLegacy: String(npKindFromLegacy(back || n) || ''), saved: !!back };
            }''')
            if built['filmKind'] == '混剪视频' and built['fromLegacy'] == '混剪视频' and built['saved']:
                ok('老篇带「混剪视频」进来还接得上：档案存原名、片台按垫满屏开（出口=%s）' % built['kOut'])
            else:
                bad('老篇建篇不对：%r' % (built,))
            plain = j(page, '''async () => {
                const n = await npDirNewNote('k', '视频', '', { filmKind: 'PPT字体动效' });
                const out = { filmKind: String(n.filmKind || ''), frame: String(npKindFrame('PPT字体动效') || ''),
                              local: npKindLocal('PPT字体动效'), shot: npKindNeedsShot('PPT字体动效') };
                await npNotesSync(async () => {
                    const list = await npNotesAll();
                    try { await chrome.storage.local.set({ [NP_NOTES_KEY]: list.filter(x => x && x.id !== n.id) }); } catch (_) {}
                });
                return out;
            }''')
            if plain['filmKind'] == 'PPT字体动效' and plain['frame'] == 'text' and plain['local'] and not plain['shot']:
                ok('点「字体动效视频」卡建的篇自带形式（大字片、不用先出画面表），进片台就能拨「画面」页签')
            else:
                bad('字体动效那张卡的形式不对：%r' % (plain,))

            # ── 种素材 ──
            sd = seed(page)
            if sd.get('stored') and sd.get('clips') == 4:
                ok('素材库种好：1 个文件夹 · 1 条原视频（%dKB 进了本机的仓）· 3 段 · 1 张照片' % sd['kb'])
            else:
                bad('素材没种上：%r' % (sd,))
                ctx.close()
                return 1

            # ── 进片台（知识线：这篇的形式已定＝混剪视频，带口播稿）──
            j(page, '''(a) => npGoFilm({ noteId: a.id, kind: '混剪视频', script: a.script,
                                        title: '自检·混剪这一条', body: '', shots: null, style: '' })''',
              {'id': built['id'], 'script': SCRIPT})
            if not wait_js(page, '() => !!(window.Film && Film.scenes && Film.scenes.length)', 60000, 500):
                bad('片台没分幕（AI 不可达时该按本机规则切幕）：%r' % (
                    j(page, '() => ({ ready: !!(window.Film), scenes: (window.Film && Film.scenes.length) || 0, '
                            'stage: (window.Film && Film.fvStage) || "", fail: !!(window.Film && Film.fvFail) })'),))
                ctx.close()
                return 1
            sc_n = j(page, '() => Film.scenes.length')
            ok('进片台就分好 %d 幕（AI 没跑成 → 本机规则切幕、标了一句，稿子还在左边）' % sc_n)

            # ── 片台顶栏：这一片垫了什么要说得出（老叫法「混剪视频」不再挂顶栏，改说当下的垫法）──
            head = ' '.join(j(page, '() => (document.getElementById("filmHead") || {}).textContent || ""').split())
            if '这一片：混剪实拍' in head:
                ok('片台顶栏那格写明「这一片：混剪实拍」：%r' % head[:80])
            else:
                bad('顶栏没跟画面垫法对上：%r' % (head,))

            # ── ③ 「画面」页签：加画面开关与两种垫法都在这一签里 ──
            tabs0 = j(page, '''() => ({ tabs: [...document.querySelectorAll('#scTabs button')].map(b => b.textContent.trim()),
                dot: document.getElementById('picDot').classList.contains('on'),
                picHidden: document.getElementById('scPic').hidden,
                sw: [...document.querySelectorAll('#picSw button')].map(b => b.textContent.trim() + (b.classList.contains('on') ? '*' : '')),
                kinds: [...document.querySelectorAll('#picKind [data-pickind]')].map(b => b.textContent.trim() + (b.classList.contains('on') ? '*' : '')),
                frame: Film.cfg.frame, bar: !document.getElementById('mixBar').hidden,
                labels: [...document.querySelectorAll('#knobs .k')].map(x => x.textContent) })''')
            if [t[:2] for t in tabs0['tabs']] == ['分幕', '画面'] and tabs0['picHidden'] and tabs0['dot'] \
                    and any(x.startswith('加画面') and x.endswith('*') for x in tabs0['sw']) \
                    and any('垫满屏' in x and x.endswith('*') for x in tabs0['kinds']) \
                    and tabs0['frame'] == 'mix' and tabs0['bar'] \
                    and '背景音乐' in tabs0['labels'] and '音效' in tabs0['labels']:
                ok('「画面」页签：加画面开着（点的是「垫满屏」）＋这时旋钮才摆出「背景音乐」「音效」两排')
            else:
                bad('画面页签没跟上混剪：%r' % (tabs0,))
            j(page, '() => document.querySelector(\'#scTabs [data-sctab="pic"]\').click()')
            if wait_js(page, '() => !document.getElementById("scPic").hidden && document.getElementById("scLines").hidden'):
                ok('点「画面」那一签：分幕那栏收起、逐屏的料摊开（点「分幕」再换回来）')
            else:
                bad('页签切不过去：%r' % j(page, '''() => ({ lines: document.getElementById('scLines').hidden,
                    pic: document.getElementById('scPic').hidden })'''))
                ctx.close()
                return 1

            sw_click = '''(on) => { const b = document.querySelector('#picSw [data-pic="' + on + '"]');
                if (!b) return false; b.click(); return true; }'''
            if j(page, sw_click, 'off') and wait_js(page, '() => Film.cfg.frame === "text"'):
                labels_text = j(page, '() => [...document.querySelectorAll("#knobs .k")].map(x => x.textContent)')
                if '背景音乐' not in labels_text and '音效' not in labels_text and \
                        j(page, '''() => document.getElementById("mixBar").hidden && !document.getElementById("picOffHint").hidden'''):
                    ok('拨「不加」：纯大字，混剪那两排跟料一起收起来（只留一句「不用挑料」的说明）')
                else:
                    bad('不加画面还露着音乐/音效或料栏：%r' % (labels_text,))
            else:
                bad('「不加」点不动')
            if not (j(page, sw_click, 'on') and wait_js(page, '() => Film.cfg.frame === "mix"')):
                bad('再点「加画面」没回到垫满屏')
                ctx.close()
                return 1
            ok('再点「加画面」记着上次挑的垫法（回到垫满屏），料单还在')

            # ── ④ 缺料点名 ＋ AI 先配一版（一屏不够长就多撞几段拼上）──
            bar0 = j(page, '() => document.getElementById("mixBar").textContent')
            if '0／' in bar0 and '还差' in bar0:
                ok('混剪那一栏报缺料：%s' % ' '.join(bar0.split())[:60])
            else:
                bad('混剪那一栏没报缺料：%r' % (bar0,))
            j(page, '() => document.getElementById("matAuto").click()')
            if not wait_js(page, '() => Film.scenes.some(s => s.mats && s.mats.length)', 20000):
                bad('「✨ AI 先配一版」一屏都没配上')
                ctx.close()
                return 1
            page.wait_for_timeout(600)
            picked = j(page, '''() => Film.scenes.map(s => (s.mats || []).map(m => m.name + '(' + m.kind + ')').join('+'))
                .filter(x => x)''')
            tips = j(page, '() => document.getElementById("matTip").textContent')
            if len(picked) == sc_n and all(any(s[:2] in nm for nm in picked) for s in SENTS):
                ok('AI 先配一版把 %d 屏都配上（拿稿子的字撞素材库的名字/标签，不发图问 AI）：%s ｜ %s'
                   % (sc_n, '、'.join(picked), tips))
            else:
                bad('自动配对不上号：%r（%s）' % (picked, tips))
            bar1 = ' '.join(j(page, '() => document.getElementById("mixBar").textContent').split())
            if ('%d／%d' % (sc_n, sc_n)) in bar1:
                ok('配完那一栏跟着变：%s' % bar1[:72])
            else:
                bad('配完还报缺：%r' % (bar1,))

            # ── ④.5 对不上也不空屏：拿这一版里现成的段／照片垫上（标「通用」）──
            gen = j(page, '''async () => {
                const s = Film.scenes[0], keep = { mats: s.mats, text: s.text, fail: s.matFail };
                s.mats = []; s.text = '嗯嗯嗯嗯嗯'; s.matFail = false;
                document.getElementById('matAuto').click();
                for (let k = 0; k < 75; k++) {
                    await new Promise(r => setTimeout(r, 200));
                    if ((s.mats || []).length) break;
                }
                const out = { n: (s.mats || []).length, gen: (s.mats || []).every(m => !!m.generic),
                    names: (s.mats || []).map(m => m.name), fail: !!s.matFail,
                    row: ((document.querySelectorAll('#matList .matrow')[0] || {}).textContent || '').replace(/\\s+/g, ' ').trim(),
                    tip: document.getElementById('matTip').textContent };
                s.text = keep.text; s.mats = keep.mats; s.matFail = keep.fail;
                document.querySelector('#scTabs [data-sctab="pic"]').click();
                await Film.flush();
                return out; }''')
            if gen['n'] and gen['gen'] and not gen['fail'] and '通用' in gen['row']:
                ok('稿子跟素材一个字都对不上也不空屏：拿这一版里现成的段垫上（%s），那节标「通用」' % '、'.join(gen['names']))
            else:
                bad('通用垫没生效：%r' % (gen,))
            # 只对上一个字的那档：先按这一个字配，不急着拿通用垫
            one = j(page, '''async () => {
                const s = Film.scenes[0], keep = { mats: s.mats, text: s.text, fail: s.matFail };
                s.mats = []; s.text = '墙'; s.matFail = false;
                document.getElementById('matAuto').click();
                for (let k = 0; k < 75; k++) {
                    await new Promise(r => setTimeout(r, 200));
                    if ((s.mats || []).length) break;
                }
                const out = { names: (s.mats || []).map(m => m.name), gen: (s.mats || []).some(m => !!m.generic),
                    fail: !!s.matFail };
                s.text = keep.text; s.mats = keep.mats; s.matFail = keep.fail;
                document.querySelector('#scTabs [data-sctab="pic"]').click();
                await Film.flush();
                return out; }''')
            if one['names'] and not one['gen'] and not one['fail']:
                ok('只对上一个字也先按字配（不急着拿通用垫）：撞出一个「墙」→ %s' % '、'.join(one['names']))
            else:
                bad('第二档（只对一个字）没生效：%r' % (one,))
            # 通用的那节不再封顶 3 秒：垫满整屏
            g2 = j(page, '''() => { const s = Film.scenes[1], keep = s.mats;
                s.mats = [{ kind: 'clip', name: '通用段', a: 0, b: 1.2, dur: 1.2, ref: 'src:vid_mix', generic: true }];
                const p = Film.matPlanAt(1, 9.2); s.mats = keep;
                return { loop: p.list[p.list.length - 1].loop, short: p.short }; }''')
            if abs(g2['loop'] - 8.0) < 0.01 and g2['short'] == 0:
                ok('通用垫的那节不受 3 秒封顶：1.2 秒的段先播 1.2s、再从头播 %ss，合计垫满 9.2 秒这一屏' % g2['loop'])
            else:
                bad('通用垫没垫满：%r' % (g2,))
            # 真没辙的那一屏标红；「只看配不到的」把整单收成那几屏，再点回整单
            red = j(page, '''async () => {
                const s0 = Film.scenes[0], keep = { mats: s0.mats, fail: s0.matFail };
                s0.mats = []; s0.matFail = true;
                document.querySelector('#scTabs [data-sctab="pic"]').click();
                const rows0 = [...document.querySelectorAll('#matList .matline')];
                const redRow = (rows0[0].textContent || '').replace(/\\s+/g, ' ').trim();
                const btn = document.getElementById('matOnlyFail');
                const btnTxt = btn ? btn.textContent.trim() : '';
                if (btn) btn.click();
                const only = [...document.querySelectorAll('#matList .matline')].map(x => Number(x.getAttribute('data-msc')));
                const btn2 = document.getElementById('matOnlyFail');
                const backTxt = btn2 ? btn2.textContent.trim() : '';
                if (btn2) btn2.click();
                const allN = document.querySelectorAll('#matList .matline').length;
                s0.mats = keep.mats; s0.matFail = keep.fail;
                document.querySelector('#scTabs [data-sctab="pic"]').click();
                await Film.flush();
                return { n0: rows0.length, redRow, btnTxt, only, backTxt, allN,
                         bar: (document.getElementById('mixBar').textContent || '').replace(/\\s+/g, ' ').trim() }; }''')
            if red['n0'] == sc_n and '配不到' in red['redRow'] and '只看配不到的 1 屏' in red['btnTxt'] \
                    and red['only'] == [0] and '看全部' in red['backTxt'] and red['allN'] == sc_n:
                ok('实在没辙的那屏：%s｜点「%s」整单只剩第 %d 屏，再点「%s」回整单'
                   % (red['redRow'][:32], red['btnTxt'], red['only'][0] + 1, red['backTxt']))
            else:
                bad('红字与「只看配不到的」不对：%r' % (red,))

            # ── ⑤ 一屏的料是一单：那句 5 秒多的话该拼两节，差的一点用「从头再播」补 ──
            p0 = j(page, '() => Film.matPlanAt(0)')
            if p0.get('photo'):
                bad('第 1 屏成了照片屏：%r' % (p0,))
            else:
                names = [x['m']['name'] for x in p0['list']]
                seq = j(page, '() => (Film.scenes[0].mats || []).map(m => m.a)')
                if len(p0['list']) >= 2 and names == ['客厅瓷砖', '瓷砖墙面'] and p0['short'] <= 0.5 \
                        and p0['list'][-1]['loop'] > 0:
                    ok('第 1 屏拼了 %d 节（%s）按原片里的先后排：%s；话比料长，末节从头再播 %ss 补上，不用定格'
                       % (len(p0['list']), '→'.join(names), seq, str(p0['list'][-1]['loop'])))
                else:
                    bad('第 1 屏的料单不对：%r' % (p0,))
            row0 = ' '.join(j(page, '() => (document.querySelectorAll("#matList .matrow")[0] || {}).textContent || ""').split())
            if '＋加一节' in row0 and '↻' in row0 and ('够' in row0 or '还差' in row0):
                ok('分幕栏那一行摆成节：%s' % row0[:96])
            else:
                bad('那一行没拼成节：%r' % (row0,))
            # 碎尾摊掉：三节里末节只剩 0.9 秒，该并掉而不是让画面闪一秒
            chop = j(page, '''() => { const s = Film.scenes[1], keep = s.mats;
                s.mats = [{ kind: 'clip', name: '甲', a: 0, b: 3.2, dur: 3.2, ref: 'src:vid_mix' },
                          { kind: 'clip', name: '乙', a: 3.2, b: 6.4, dur: 3.2, ref: 'src:vid_mix' },
                          { kind: 'clip', name: '尾', a: 6.4, b: 7.3, dur: 0.9, ref: 'src:vid_mix' }];
                const p = Film.matPlanAt(1, 7.3);
                const back = p.list.map(x => x.m.name); s.mats = keep;
                return { back, last: p.list[p.list.length - 1].play, dropped: p.dropped, short: p.short }; }''')
            if chop['back'] == ['甲', '乙'] and chop['dropped'] and chop['last'] >= 2:
                ok('末节只剩 0.9 秒＝碎尾：自己摊掉（挪出去 %ss），这一屏排成 %s'
                   % (chop['dropped'], '→'.join(chop['back'])))
            else:
                bad('碎尾没摊掉：%r' % (chop,))
            # 缺口比 3 秒大：封顶 3 秒，剩下的点名让人补段
            big = j(page, '''() => { const s = Film.scenes[1], keep = s.mats;
                s.mats = [{ kind: 'clip', name: '甲', a: 0, b: 2.6, dur: 2.6, ref: 'src:vid_mix' }];
                const p = Film.matPlanAt(1, 9.2); s.mats = keep;
                return { loop: p.list[p.list.length - 1].loop, short: p.short }; }''')
            if abs(big['loop'] - 3) < 0.01 and big['short'] > 3:
                ok('一节从头再播封顶 3 秒，还差 %ss 就在屏上报出来让人补段' % big['short'])
            else:
                bad('回环封顶没生效：%r' % (big,))

            # ── ⑥ 某一屏点「＋加一节」：点一格是追加，不是把前面的换掉 ──
            j(page, '() => document.querySelectorAll("#matList [data-mat]")[1].click()')
            if not wait_js(page, '() => !document.getElementById("matMask").hidden'):
                bad('挑画面那一层没打开')
                ctx.close()
                return 1
            grid = j(page, '''() => ({ forr: document.getElementById('matFor').textContent,
                folders: [...document.querySelectorAll('#matFolder option')].map(o => o.textContent),
                cells: [...document.querySelectorAll('#matGrid .matcell')].map(b => b.textContent.trim().replace(/\\s+/g, ' ')),
                on: [...document.querySelectorAll('#matGrid .matcell.on')].length })''')
            if len(grid['cells']) == 4 and any('自检·阳光小区' in f for f in grid['folders']) and grid['on'] >= 1:
                ok('挑画面一层：%s｜文件夹 %d 个｜格子 %d 张（这一屏在用的标了 %d 张）' % (
                    grid['forr'], len(grid['folders']), len(grid['cells']), grid['on']))
            else:
                bad('挑画面一层不对：%r' % (grid,))
            j(page, '''() => { const el = document.getElementById('matQuery'); el.value = '花洒';
                el.dispatchEvent(new Event('input', { bubbles: true })); }''')
            page.wait_for_timeout(700)
            if j(page, '() => document.querySelectorAll("#matGrid .matcell").length') == 1:
                ok('按标签搜「花洒」只剩 1 张')
            else:
                bad('搜「花洒」没过滤：%r' % j(page, '() => [...document.querySelectorAll("#matGrid .matcell")].map(b => b.textContent)'))
            j(page, '''() => { const el = document.getElementById('matQuery'); el.value = '';
                el.dispatchEvent(new Event('input', { bubbles: true })); }''')
            page.wait_for_timeout(500)
            before2 = j(page, '() => (Film.scenes[1].mats || []).length')
            j(page, '''() => { const cell = [...document.querySelectorAll('#matGrid .matcell')].find(c => /客厅瓷砖/.test(c.textContent));
                if (cell) cell.click(); }''')
            page.wait_for_timeout(800)
            after2 = j(page, '''() => ({ closed: document.getElementById('matMask').hidden,
                names: (Film.scenes[1].mats || []).map(m => m.name),
                order: (Film.matPlanAt(1).list || []).map(x => x.m.name) })''')
            if after2['closed'] and len(after2['names']) == before2 + 1 and '客厅瓷砖' in after2['names']:
                ok('点「客厅瓷砖」是追加进来（这一屏现在 %d 节）；不按挑的顺序排、按原片里的先后：%s'
                   % (len(after2['names']), '→'.join(after2['order'])))
            else:
                bad('加一节没追加：%r' % (after2,))
            # 照片屏不拼：照片那一屏只列照片、也不给「＋加一节」
            ph = j(page, '''() => { const i = Film.scenes.findIndex(s => (s.mats || []).some(m => m.kind === 'photo'));
                if (i < 0) return null;
                const row = document.querySelectorAll('#matList .matrow')[i];
                return { i, add: !!row.querySelector('[data-mat]'),
                         txt: (row.textContent || '').replace(/\\s+/g, ' ').trim() }; }''')
            if ph and not ph['add'] and '照片屏不拼' in ph['txt']:
                ok('照片那一屏（第 %d 屏）不拼：没有「＋加一节」，那一行写着「照片屏不拼」' % (ph['i'] + 1))
            else:
                bad('照片屏的口径不对：%r' % (ph,))

            # ── ⑦ 补照片原图（一次多选，按文件名对上，不入库）──
            need = j(page, '() => Film.scenes.reduce((k, s) => k + (s.mats || []).filter(m => m.kind === "photo").length, 0)')
            with page.expect_file_chooser() as fc:
                j(page, '() => document.getElementById("matOrigin").click()')
            fc.value.set_files([str(PHOTO_BIG)])
            if not wait_js(page, '() => Film.scenes.some(s => (s.mats || []).some(m => m.src))', 20000):
                bad('补原图没对上名字（照片 %d 张）' % need)
            else:
                info = j(page, '''() => { const s = Film.scenes.find(x => (x.mats || []).some(m => m.src));
                    const m = (s.mats || []).find(x => x.src);
                    return { name: m.name, head: String(m.src).slice(0, 5),
                             n: Film.scenes.reduce((k, x) => k + (x.mats || []).filter(y => y.src).length, 0),
                             tip: document.getElementById('matTip').textContent }; }''')
                if info['head'] == 'blob:':
                    ok('补原图对上「%s」（%d 张都用上了）：%s｜只这一趟用，不进素材库' % (info['name'], info['n'], info['tip']))
                else:
                    bad('补原图不对：%r' % (info,))
            # 库里那张小图没被抄进草稿（只留 clipId）；小图超 8KB 时账本自己把它搬进本机仓、只留一条链接
            saved_ref = j(page, '''() => { const s = Film.scenes.find(x => (x.mats || []).some(m => m.kind === 'photo'));
                if (!s) return null; const m = (s.mats || []).find(x => x.kind === 'photo');
                return { clipId: m.clipId, refHead: String(m.ref || '').slice(0, 10), refLen: String(m.ref || '').length }; }''')
            if saved_ref and saved_ref['clipId'] == 'pic_door' \
                    and (saved_ref['refHead'].startswith('data:image') or saved_ref['refHead'].startswith('/api/blob')):
                ok('照片挂着库里小图的引用（%s…%d 字符）＋条目号 %s，出片这一趟改用你选的原图'
                   % (saved_ref['refHead'], saved_ref['refLen'], saved_ref['clipId']))
            else:
                bad('照片那条的引用不对：%r' % (saved_ref,))

            # ── ⑧ 画面真垫进去了（「不加」再「加画面」＝走真那条备料路）──
            j(page, sw_click, 'off')
            wait_js(page, '() => Film.cfg.frame === "text"')
            j(page, sw_click, 'on')
            if not wait_js(page, '''() => Film.scenes.every(s => (s.mats || []).every(m => m.kind === 'photo' ? m.img : m.ok))''', 30000):
                bad('有节的料解不开：%r' % j(page, '''() => Film.scenes.map(s => (s.mats || []).map(m => ({ n: m.name, k: m.kind,
                    img: !!m.img, ok: m.ok }))).flat().filter(x => (x.k === 'photo' ? !x.img : !x.ok))'''))
            else:
                prepped = j(page, '''() => Film.scenes.map(s => (s.mats || []).map(m => ({ n: m.name, k: m.kind,
                    w: (m.img && (m.img.width || m.img.videoWidth)) || 0 }))).flat()''')
                if all(p['w'] > 0 or p['k'] == 'clip' for p in prepped):
                    ok('每一节的料都解得开：%s（段走的是本机播放器，不上传）' % ' · '.join(
                        '%s%s' % (p['n'], '段' if p['k'] == 'clip' else '照片') for p in prepped))
                else:
                    bad('有节解出 0 宽度：%r' % (prepped,))
            px = j(page, '''() => {
                const idx = Film.scenes.findIndex(s => (s.mats || []).some(m => m.kind === 'photo'));
                if (idx < 0) return null;
                const cv = document.getElementById('cv'), c = cv.getContext('2d');
                const avg = () => { const d = c.getImageData(60, 200, 960, 700).data; let s = 0;
                    for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
                    return +(s / (d.length / 4)).toFixed(1); };
                const T = Film.timeline(), sc = T.scenes[idx];
                const t = sc.start + (sc.end - sc.start) * 0.55;
                Film.paintAt(t); const withMat = avg();
                const s = Film.scenes[idx], keep = s.mats; s.mats = [];
                Film.paintAt(t); const noMat = avg();
                s.mats = keep; Film.paintAt(t);
                return { withMat, noMat, idx };
            }''')
            if px and px['withMat'] > px['noMat'] + 4:
                ok('照片那一屏画出来确实垫了实拍：亮暗 %s → 没料时 %s（差 %.1f）' % (px['withMat'], px['noMat'], px['withMat'] - px['noMat']))
            elif px:
                bad('画面没垫进 canvas：有料 %s vs 没料 %s' % (px['withMat'], px['noMat']))
            else:
                bad('没有照片屏可比对')
            # 换到下一节那一节自己重新淡入：两节交界处那一截比节中间暗（先把播放器开起来，懒加载）
            multi = j(page, '() => Film.scenes.findIndex((x, k) => Film.matPlanAt(k).list.length > 1)')
            if multi < 0:
                bad('没有两节的屏可验淡入')
            else:
                for frac in (0.3, 0.8):                 # 两节各画一帧，把各自的播放器懒加载起来（同一原视频共用一只）
                    j(page, '''(a) => { const T = Film.timeline(), sc = T.scenes[a.i];
                        Film.paintAt(sc.start + (sc.end - sc.start) * a.f); }''', {'i': multi, 'f': frac})
                    page.wait_for_timeout(1600)
                if not wait_js(page, '(i) => (Film.scenes[i].mats || []).filter(m => m.kind === "clip").every(m => m.vid)',
                              20000, 400, multi):
                    bad('第 %d 屏的段播放器开不起来（淡入这一项验不了）' % (multi + 1))
                else:
                    page.wait_for_timeout(1200)
                    fade = j(page, '''(idx) => {
                        const T = Film.timeline(), sc = T.scenes[idx];
                        const p = Film.matPlanAt(idx); if (p.list.length < 2) return null;
                        const cv = document.getElementById('cv'), c = cv.getContext('2d');
                        const avg = () => { const d = c.getImageData(60, 200, 960, 700).data; let s = 0;
                            for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
                            return +(s / (d.length / 4)).toFixed(1); };
                        const cut = sc.start + p.list[1].from;
                        Film.paintAt(cut + 0.06); const atCut = avg();
                        Film.paintAt(cut + 0.60); const mid = avg();
                        return { atCut, mid, idx: idx + 1 };
                    }''', multi)
                    if fade and fade['mid'] > fade['atCut'] + 1:
                        ok('第 %s 屏换到第二节：那一节自己从头淡入推近（刚切 %.1f → 半秒后 %.1f）' % (
                            fade['idx'], fade['atCut'], fade['mid']))
                    elif fade:
                        bad('换节没重新淡入：%r' % (fade,))

            # ── ⑨ 音效跟「字弹出来那一下」响，不跟换屏响；调三档由每屏的 tone 定 ──
            tones = j(page, '''() => { const T = Film.timeline();
                return { mark: T.scenes.map(s => ({ tone: String(s.tone || ''), at: +(s.start).toFixed(2) })),
                         row: ((document.querySelectorAll('#matList .matrow')[0] || {}).textContent || '').replace(/\\s+/g, ' ').trim() }; }''')
            tl_names = [x['tone'] for x in tones['mark']]
            if all(tl_names) and len(set(tl_names)) >= 2:
                ok('每一屏的调由分幕标好（本机词表兜底，不用配 AI）：%s｜那一行有「字响 %s」这颗'
                   % ('、'.join(tl_names), tones['row'].split('字响')[-1][:6]))
            else:
                bad('每屏的调没标上：%r' % (tones,))
            # 三档凑齐：把这三屏的调钉成 坑／好处／平常，再量响的轻重
            pin = j(page, '''() => { const want = ['low', 'high', 'flat'];
                Film.scenes.forEach((s, i) => { if (want[i]) s.tone = want[i]; });
                return Film.scenes.map(s => s.tone); }''')
            sfx = j(page, '''async () => { const T = Film.timeline(), sr = 24000;
                const a = await Voice.sfx('word', T, sr); if (!a) return null;
                const win = (t0, t1) => { let m = 0; const i0 = Math.max(0, Math.floor(t0 * sr)), i1 = Math.min(a.length, Math.ceil(t1 * sr));
                    for (let i = i0; i < i1; i++) { const v = Math.abs(a[i]); if (v > m) m = v; } return +m.toFixed(4); };
                return T.scenes.map(s => ({ tone: String(s.tone || ''),
                    atCut: win(s.start - 0.05, s.start + 0.10), atWord: win(s.start + 0.34, s.start + 0.62) })); }''')
            if not sfx:
                bad('音效那条轨是空的')
            else:
                loud = [x for x in sfx if x['atWord'] > 0]
                quiet = [x for x in sfx if x['atCut'] < x['atWord']]
                if loud and len(loud) == len(sfx) and len(quiet) == len(sfx):
                    ok('每屏只在「字弹出来那一下」（这一幕起 +0.42s）响，换屏那一下不响：%s' % ' · '.join(
                        '%s 弹字%.3f/换屏%.3f' % (x['tone'], x['atWord'], x['atCut']) for x in sfx))
                else:
                    bad('音效响错了地方：%r' % (sfx,))
                peak = {x['tone']: x['atWord'] for x in sfx}
                if peak.get('low', 0) > peak.get('high', 0) > peak.get('flat', 0) > 0:
                    ok('三档轻重排得出来（%s）：讲坑闷咚 %.3f ＞ 讲好处轻亮啵 %.3f ＞ 平常一句极轻带一下 %.3f' % (
                        '、'.join(pin), peak['low'], peak['high'], peak['flat']))
                else:
                    bad('三档轻重不对（钉的是 %s）：%r' % (pin, sfx))
            cyc = j(page, '''() => { const b = document.querySelector('#matList .matrow [data-tone]');
                if (!b) return null; const before = Film.scenes[0].tone; b.click();
                const nb = document.querySelector('#matList .matrow [data-tone]');
                return { before, after: Film.scenes[0].tone, btn: nb ? nb.textContent : '' }; }''')
            if cyc and cyc['after'] != cyc['before']:
                ok('那一屏的调点一下就换档：%s → %s（按钮上写着「%s」）' % (cyc['before'], cyc['after'], cyc['btn']))
            else:
                bad('字响档位点不动：%r' % (cyc,))
            j(page, '() => { Film.scenes[0].tone = %r; }' % (cyc['before'] if cyc else 'flat',))

            # ── ⑩ 出片：混剪强制边播边录、不派执行器，三条轨混一条 ──
            if not FILM:
                ok('（MIX_NOFILM=1）跳过真出片这一段')
            else:
                t0 = time.time()
                j(page, '''() => { const b = document.querySelector('#filmFoot .np-film-start') || document.getElementById('go');
                    b.click(); }''')
                done = ''
                for _ in range(200):
                    page.wait_for_timeout(2000)
                    st = j(page, '''() => { const el = document.getElementById('st');
                        return String((el && el.textContent) || '').trim(); }''')
                    if st and (not statuses or statuses[-1] != st[:70]):
                        statuses.append(st[:70])
                    if '完成' in st or '失败' in st or '停了' in st:
                        done = st
                        break
                if not done:
                    bad('出片没在 6 分半内收口（最后几条状态：%s）' % ' | '.join(statuses[-3:]))
                else:
                    print('    状态串：' + ' → '.join(statuses[-8:]), flush=True)
                    if '失败' in done:
                        bad('出片失败：%s ｜ 提示：%s' % (done, j(page, '() => document.getElementById("warn").textContent')))
                    elif not any('边播边录' in s for s in statuses):
                        bad('没走「边播边录」那一路：%s' % ' | '.join(statuses[-8:]))
                    else:
                        ok('混剪这条走的是边播边录（逐帧编码驱动不了真播的段，也不派执行器）')
                    res = j(page, '''async () => {
                        if (!Film.lastBlob) return null;
                        const buf = new Uint8Array(await Film.lastBlob.arrayBuffer());
                        let s = ''; const CH = 0x8000;
                        for (let i = 0; i < buf.length; i += CH) s += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
                        return { size: Film.lastBlob.size, name: Film.lastName, type: Film.lastBlob.type,
                                 dur: Film.tl ? +Film.tl.dur.toFixed(1) : 0, b64: btoa(s) };
                    }''')
                    if not res:
                        bad('没拿到成片（状态：%s）' % done)
                    else:
                        ext = 'mp4' if 'mp4' in str(res['name']) else 'webm'
                        out = WORK / ('混剪自检.%s' % ext)
                        out.write_bytes(base64.b64decode(res['b64']))
                        ok('出成真片：%s · %.1fMB · 时间轴 %.1f 秒（整趟 %ds）' % (
                            out.name, out.stat().st_size / 1048576, res['dur'], time.time() - t0))
                        try:
                            ff = subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', str(out)],
                                                capture_output=True, text=True)
                            txt = ff.stdout
                            has_v, has_a = 'codec_type=video' in txt, 'codec_type=audio' in txt
                            size = 'width=1080' in txt and 'height=1920' in txt
                            dur = 0.0
                            for line in txt.splitlines():
                                if line.startswith('duration='):
                                    dur = float(line.split('=')[1])
                                    break
                            if has_v and has_a and size and dur >= max(3.0, res['dur'] * 0.7):
                                ok('片子验过：竖屏 1080×1920 的画面＋一条声音轨（配音、背景音乐、跟字响的音效混成的那条）· 实长 %.1f 秒' % dur)
                            else:
                                bad('片子不对：画面=%s 声音=%s 竖屏=%s 实长=%.1f（时间轴 %.1f）' % (
                                    has_v, has_a, size, dur, res['dur']))
                            print('    ' + ' '.join(l for l in txt.splitlines()
                                                    if l.startswith(('codec_name=', 'codec_type=', 'duration=', 'sample_rate=')))[:220], flush=True)
                        except Exception as e:
                            bad('ffprobe 读不了：%s' % e)
                        tracks = j(page, '''async () => {
                            const sr = 24000, T = Film.tl;
                            const b = await Voice.bgm(Film.cfg.bgm, T.dur, sr);
                            const s = await Voice.sfx(Film.cfg.sfx, T, sr);
                            const peak = (a) => { let m = 0; if (!a) return 0;
                                for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > m) m = v; } return +m.toFixed(3); };
                            return { bgm: String(Film.cfg.bgm), sfx: String(Film.cfg.sfx),
                                     bgmPeak: peak(b), sfxPeak: peak(s), sfxLen: s ? +(s.length / sr).toFixed(1) : 0 };
                        }''')
                        if tracks['bgmPeak'] > 0 and tracks['sfxPeak'] > 0:
                            ok('两条垫轨都出得来声：背景音乐=%s（峰值 %.2f）· 音效=%s（峰值 %.2f，铺满 %.1f 秒）' % (
                                tracks['bgm'], tracks['bgmPeak'], tracks['sfx'], tracks['sfxPeak'], tracks['sfxLen']))
                        else:
                            bad('音乐或音效空的：%r' % (tracks,))

            # ── ⑪ 按篇存的草稿：一屏一单，只留引用；旧草稿只挂一段也接得上 ──
            doc = j(page, '''async (id) => {
                const all = await chrome.storage.local.get('xhsFilmDocs');
                const one = ((all && all.xhsFilmDocs) || {})[id];
                if (!one) return null;
                return { cfg: String(one.cfg || ''), outAt: !!one.outAt,
                    scenes: (one.scenes || []).map(s => ({ tone: String(s.tone || ''),
                        mats: (s.mats || []).map(m => ({ n: m.name, k: m.kind,
                            refLen: String(m.ref || '').length, clipId: String(m.clipId || ''),
                            src: /blob:/.test(String(m.src || '')) })) })) };
            }''', built['id'])
            if doc and doc.get('cfg'):
                if 'frame=mix' in doc['cfg'] and 'bgm=' in doc['cfg'] and 'sfx=word' in doc['cfg']:
                    ok('这一篇的草稿按篇存住（配置行：画面=混剪＋背景音乐＋音效=跟字响；%s）' % ('已标出过片' if doc['outAt'] else '还没出过片'))
                else:
                    bad('草稿配置行缺混剪的旋钮：%r' % (doc['cfg'],))
                flat = [m for s in doc['scenes'] for m in s['mats']]
                if len(doc['scenes']) == sc_n and all(s['mats'] for s in doc['scenes']) \
                        and all(m['n'] for m in flat) and any(len(s['mats']) > 1 for s in doc['scenes']):
                    photo = [m for m in flat if m['k'] == 'photo']
                    slim = all(p['refLen'] == 0 and not p['src'] and p['clipId'] for p in photo) if photo else False
                    ok('%d 屏的料按篇存回（一屏一单：%s）｜照片只留条目号、小图和你补的原图都没抄进草稿（%s）' % (
                        len(doc['scenes']),
                        ' / '.join('+'.join(m['n'] for m in s['mats']) for s in doc['scenes']),
                        '是' if slim else '否：%r' % (photo,)))
                else:
                    bad('草稿里的画面跟台子对不上：%r' % (doc['scenes'],))
                if all(s['tone'] for s in doc['scenes']):
                    ok('每一屏的调也存住了：%s' % '、'.join(s['tone'] for s in doc['scenes']))
                else:
                    bad('草稿里缺每屏的调：%r' % [s['tone'] for s in doc['scenes']])
            else:
                bad('没读到这一篇的草稿（key=%s）：%r' % (built['id'], doc))

            # 旧草稿（一屏只挂一段）接得上：先把这一篇从台子上摘下来（noteId 清空——
            # 前面点旋钮攒下的那颗 600ms 定时存就存不进来，会把旧写法盖回新写法），等它跑空再改草稿
            j(page, '() => { Film.noteId = ""; }')
            page.wait_for_timeout(900)
            old0 = j(page, '''async (id) => {
                const all = await chrome.storage.local.get('xhsFilmDocs');
                const one = ((all && all.xhsFilmDocs) || {})[id];
                if (!one) return null;
                const o = JSON.parse(JSON.stringify(one));
                o.scenes.forEach(s => { const first = (s.mats || [])[0] || null;
                    delete s.mats; if (first) { delete first.src; delete first.img; s.mat = first; } });
                await chrome.storage.local.set({ xhsFilmDocs: Object.assign({}, all.xhsFilmDocs, { [id]: o }) });
                const bk = await chrome.storage.local.get('xhsFilmDocs');
                const chk = ((bk && bk.xhsFilmDocs) || {})[id] || {};
                return { names: (chk.scenes || []).map(s => (s.mat || {}).name || ''),
                         legacy: (chk.scenes || []).every(s => !!s.mat && !(s.mats || []).length) };
            }''', built['id'])
            if not old0 or not old0['legacy']:
                bad('改旧写法没成（改完读回来不是旧写法）：%r' % (old0,))
            else:
                lr = j(page, '(a) => Film.loadNote({ id: a.id, script: a.script })',
                       {'id': built['id'], 'script': SCRIPT})
                if not wait_js(page, '() => Film.scenes.length === %d && Film.scenes.every(s => (s.mats || []).length === 1)'
                               % sc_n, 30000, 400):
                    bad('旧草稿点进来没并成一单（ret=%s busy=%s，现在每屏 %s 节，草稿里 %s）' % (
                        lr, j(page, '() => !!Film.busy'),
                        j(page, '() => Film.scenes.map(s => (s.mats || []).length)'),
                        j(page, '''async (id) => { const all = await chrome.storage.local.get('xhsFilmDocs');
                            const one = ((all && all.xhsFilmDocs) || {})[id] || {};
                            return { mats: (one.scenes || []).map(s => (s.mats || []).length),
                                     legacy: (one.scenes || []).map(s => !!s.mat) }; }''', built['id'])))
                else:
                    mig = j(page, '''() => Film.scenes.map(s => ({ n: (s.mats || []).length,
                        name: ((s.mats || [])[0] || {}).name || '', src: String(((s.mats || [])[0] || {}).src || '') }))''')
                    if [x['name'] for x in mig] == old0['names'] and all(x['n'] == 1 and not x['src'] for x in mig):
                        ok('旧草稿那一屏只挂一段 → 自己并成一单（%s），补过的原图不入库、回来要重补' %
                           ' / '.join(x['name'] for x in mig))
                    else:
                        bad('旧草稿迁移不对：台子上 %r，草稿里那一段是 %s' % (mig, old0['names']))
                    j(page, '() => Film.flush()')
                    page.wait_for_timeout(400)
                    back = j(page, '''async (id) => {
                        const all = await chrome.storage.local.get('xhsFilmDocs');
                        const one = ((all && all.xhsFilmDocs) || {})[id] || {};
                        return { mats: (one.scenes || []).map(s => (s.mats || []).length),
                                 legacy: (one.scenes || []).some(s => !!s.mat) };
                    }''', built['id'])
                    if back['mats'] and not back['legacy'] and all(n >= 1 for n in back['mats']):
                        ok('存回去就是新写法（每屏 %s 节，没有单段残留）' % back['mats'])
                    else:
                        bad('迁移后存回不对：%r' % (back,))

            # ── ⑫ 垫进卡这一路：从「加画面」拨成「垫进卡」，按画面表铺底图；没图那段走纯色卡 ──
            j(page, '() => { Film.noteId = ""; }')
            page.wait_for_timeout(900)
            card0 = j(page, '''async (a) => {
                const d = await chrome.storage.local.get(['np_assets']);
                const list = (d && d.np_assets) || [];
                if (!list.some(x => x && x.id === 'as_door')) {
                    list.push({ id: 'as_door', kind: 'local', name: '五金门头', thumb: a.thumb, at: Date.now() });
                    await chrome.storage.local.set({ np_assets: list });
                }
                const rows = [
                    { rowId: 'r1', no: 1, text: a.s1, assetIds: ['as_door'] },
                    { rowId: 'r2', no: 2, text: a.s3, assetIds: [] },
                ];
                Film.noteId = 'check_card';                 // 现编一篇：草稿也一起验
                Film.cfg.frame = 'text';                    // 上台子前台面还挂着上一片的垫法：这一篇是「不加」
                const ret = Film.loadScript(a.script, { frame: 'text', shots: rows });
                return { ret, frame: Film.cfg.frame, n: Film.scenes.length,
                         keys: Film.scenes.map(s => s.cardKey || ''),
                         cards: Film.scenes.filter(s => s.card && s.card.src).length };
            }''', {'thumb': 'data:image/png;base64,' + b64(PHOTO_THUMB), 'script': SCRIPT,
                   's1': SENTS[0], 's3': SENTS[2]})
            if card0['ret'] == 'ok' and card0['n'] >= 2 and all(card0['keys']) and card0['cards'] == 0:
                ok('带画面表进来先排 %d 幕（每幕记着属哪一段底）；「不加」时一张底都没铺' % card0['n'])
            else:
                bad('带画面表排幕不对：%r' % (card0,))
            j(page, '() => document.querySelector(\'#scTabs [data-sctab="pic"]\').click()')
            j(page, sw_click, 'on')
            wait_js(page, '() => Film.cfg.frame === "mix"')
            j(page, '() => document.querySelector(\'#picKind [data-pickind="card"]\').click()')
            if not wait_js(page, '() => Film.cfg.frame === "card" && Film.scenes.some(s => s.card && s.card.src)', 20000):
                bad('点「垫进卡」没把画面表的图画到幕上：%r' % j(page, '''() => Film.scenes.map(s => ({ key: s.cardKey || '',
                    src: !!(s.card && s.card.src) }))'''))
            else:
                page.wait_for_timeout(600)
                cst = j(page, '''() => ({
                    chip: [...document.querySelectorAll('#picKind [data-pickind]')].filter(b => b.classList.contains('on')).map(b => b.textContent.trim()),
                    bar: (document.getElementById('cardBar').textContent || '').replace(/\\s+/g, ' ').trim(),
                    mixHidden: document.getElementById('mixBar').hidden,
                    rows: [...document.querySelectorAll('#matList .matrow')].map(r => (r.textContent || '').replace(/\\s+/g, ' ').trim()),
                    dec: Film.scenes.map(s => ({ key: s.cardKey || '', img: !!(s.cardImg && (s.cardImg.width || s.cardImg.videoWidth)) })),
                    on: Film.scenes.map(s => !!(s.card && s.card.src)) })''')
                dec_ok = all(x['img'] for x in cst['dec'] if x['key'] == 'shot:r1')
                if cst['chip'] == ['🃏 垫进卡'] and '底图：' in cst['bar'] and cst['mixHidden'] and dec_ok \
                        and any('🖼 五金门头' in r for r in cst['rows']) and any('纯色卡' in r for r in cst['rows']):
                    ok('拨到「垫进卡」：画面表那段的底图铺上并解得开（%s）；这段走了 %d 幕，没图那段写「纯色卡」' % (
                        cst['bar'], sum(1 for x in cst['on'] if x)))
                else:
                    bad('垫进卡的路不对：%r' % (cst,))
                # 关掉再打开：记着「垫进卡」这一种垫法
                j(page, sw_click, 'off')
                wait_js(page, '() => Film.cfg.frame === "text"')
                j(page, sw_click, 'on')
                if wait_js(page, '() => Film.cfg.frame === "card" && Film.scenes.some(s => s.card && s.card.src)'):
                    ok('关掉「加画面」再打开：记着上次挑的是「垫进卡」，底图还在')
                else:
                    bad('再打开没回到垫进卡：%r' % j(page, '''() => ({ frame: Film.cfg.frame,
                        chip: [...document.querySelectorAll('#picKind [data-pickind]')].map(b => b.textContent.trim() + (b.classList.contains('on') ? '*' : '')) })'''))
            # 按篇草稿里也记着这一种垫法（这一篇是现编的 key）
            page.wait_for_timeout(900)
            cdoc = j(page, '''async () => { const all = await chrome.storage.local.get('xhsFilmDocs');
                const one = ((all && all.xhsFilmDocs) || {})['check_card'] || null;
                return one ? { cfg: String(one.cfg || ''), scenes: (one.scenes || []).length } : null; }''')
            if cdoc and 'frame=card' in cdoc['cfg']:
                ok('这一篇的草稿也记着「垫进卡」（配置行：%s）' % cdoc['cfg'])
            else:
                bad('草稿没记垫进卡：%r' % (cdoc,))
            j(page, '() => { Film.noteId = ""; }')

            # ── ⑬ 页内报错 ──
            if errs:
                bad('页内报错 %d 条' % len(errs))
                for e in errs[:8]:
                    print('    ' + e[:200], flush=True)
            else:
                ok('全程无页内报错')
            ctx.close()
    finally:
        srv.terminate()
        try:
            srv.wait(timeout=5)
        except Exception:
            srv.kill()
        logf.close()

    print('── 结论：%s ──' % ('全绿' if not fails else '有 %d 处不对' % fails), flush=True)
    print('   片子与日志在 tmp/mix-film-web-check/', flush=True)
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
