# -*- coding: utf-8 -*-
"""「加画面」缺料补图 · web 自检（2026-10-31）

验的是 web/video.js 这条新通路：素材库空着的时候，垫满屏那几屏不再停在「素材库里还没有」，
而是给一颗「🖼 还缺 N 屏 · AI 出一版」，点了按屏出一张静图垫上：
  ① 素材库空 → 点「✨ AI 先配一版」只报缺料，不出图、不扣额度；
  ② 点「🖼 还缺 N 屏 · AI 出一版」：一屏一张、按屏顺序出，几屏就几次请求；
  ③ 出的图落三处：本机仓（xhsCase 的 genfig:<篇id>:<屏序>）、素材库「AI 补的画面」文件夹
     （条目带 genKey）、这一屏的料单（ref='gen:'+key、gen:true、thumb 是小图）；
  ④ 一屏没出成：那屏不垫、行尾红字写清原因，别的屏照出；
  ⑤ 逐屏「↻ 重出一张」：只再请求一次、只换那一屏、素材库里那条换掉不越攒越多；
  ⑥ 逐屏「⬆ 传一张」：本机选图立刻盖掉那屏，不请求、不入库；
  ⑦ 重开这一篇：AI 补的那几张还在，原图从本机仓读得出来（不重扣）；
  ⑧ 全屏都是 AI 图时，顶上一颗「↻ 一起重出画面」：点一次全重出，素材库不越攒越多。
全程本机 dev-server ＋ 本机出图桩，绝不打真出图接口。

跑法：python3 -X utf8 scripts/dev/check_aipic_mix_web.py
"""
import base64
import json
import os
import shutil
import socket
import struct
import subprocess
import sys
import threading
import time
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

from _guide_gate import goto_big

sys.stdout.reconfigure(encoding='utf-8')
REPO = Path(__file__).resolve().parents[2]
PORT = 8928
STUB_PORT = 8929
BASE = 'http://127.0.0.1:%d' % PORT
WORK = REPO / 'tmp' / 'aipic-mix-check'
DATA = WORK / 'data'
PROFILE = WORK / 'profile'
PHOTO_PNG = WORK / '我自己传的一张.png'
fails = 0

SENTS = ['瓷砖要挑对，先看客厅地面贴得平不平。',
         '花洒装得好，洗澡才不积水。',
         '门头旧旧的，客人路过也不停。']
SCRIPT = '\n'.join(SENTS)


def ok(msg):
    print('  PASS ' + msg, flush=True)


def bad(msg):
    global fails
    fails += 1
    print('  FAIL ' + msg, flush=True)


def wait_js(page, expr, timeout=30000, interval=250, arg=None):
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


def png_solid(w=96, h=128, rgb=(208, 82, 92)):
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))

    def chunk(t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    return (b'\x89PNG\r\n\x1a\n' +
            chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress(raw)) +
            chunk(b'IEND', b''))


PNG_B64 = base64.b64encode(png_solid()).decode()


class ImgStub(BaseHTTPRequestHandler):
    """本机出图桩：照方舟 /images/generations 的形状回一张 PNG；出错由 fail_word 控制（跨线程读写）"""
    requests = []
    fail_word = ''

    def do_POST(self):
        n = int(self.headers.get('content-length') or 0)
        try:
            body = json.loads(self.rfile.read(n) or b'{}')
        except Exception:
            body = {}
        prompt = str(body.get('prompt') or '')
        ImgStub.requests.append({'prompt': prompt, 'size': String_(body.get('size')),
                                 'at': time.time()})
        time.sleep(0.5)                       # 给页面留出「AI 出图中…」那一帧
        fw = ImgStub.fail_word
        if fw and fw in prompt:
            out = json.dumps({'error': {'message': '桩：这一屏故意没出成'}}).encode()
            self.send_response(500)
        else:
            out = json.dumps({'data': [{'b64_json': PNG_B64}]}).encode()
            self.send_response(200)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *a):
        pass


def String_(v):
    return '' if v is None else str(v)


def start_stub():
    srv = ThreadingHTTPServer(('127.0.0.1', STUB_PORT), ImgStub)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main():
    print('── 加画面缺料补图（AI 出静图）· web 自检 ──', flush=True)
    if WORK.exists():
        shutil.rmtree(WORK, ignore_errors=True)
    WORK.mkdir(parents=True, exist_ok=True)
    DATA.mkdir(parents=True, exist_ok=True)
    PHOTO_PNG.write_bytes(png_solid(120, 90, (47, 111, 79)))

    stub = start_stub()
    env = dict(os.environ)
    env['DEMO_DATA_DIR'] = str(DATA)
    env['PORT'] = str(PORT)
    env['DEMO_AI_KEY'] = 'check-only'
    env['DEMO_AI_BASE'] = 'http://127.0.0.1:1/v1'          # 不可达：AI 切幕退回本机规则
    env['IMAGE_API_KEY'] = 'selfcheck-img'
    env['IMAGE_API_BASE'] = 'http://127.0.0.1:%d/v1' % STUB_PORT
    env['VISION_API_KEY'] = 'selfcheck-dummy'
    env['VISION_API_BASE'] = 'http://127.0.0.1:1/v1'
    env['DEMO_SIGNUP_MAX'] = '60'
    logf = open(WORK / 'server.log', 'w', encoding='utf-8')
    srv = subprocess.Popen(['node', str(REPO / 'server' / 'dev-server.mjs')], env=env,
                           stdout=logf, stderr=subprocess.STDOUT)
    for _ in range(80):
        try:
            socket.create_connection(('127.0.0.1', PORT), 1).close()
            break
        except OSError:
            time.sleep(0.5)
    else:
        bad('服务器没起来（看 tmp/aipic-mix-check/server.log）')
        stub.shutdown()
        return 1
    time.sleep(2)

    errs = []
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
            page.wait_for_timeout(1500)
            who = j(page, '''async () => await (await fetch('/api/auth/demo', { method: 'POST',
                headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'deco' }) })).json()''')
            if not who.get('ok'):
                bad('演示号没进上：%r' % (who,))
                ctx.close()
                return 1
            goto_big(page, BASE + '/popup.html?mode=big', wait_until='domcontentloaded', timeout=90000)
            page.wait_for_timeout(1500)

            # ── 建一篇视频篇（形式＝混剪视频），素材库故意空着 ──
            note = j(page, '''async () => {
                try { await chrome.storage.local.set({ np_collections: [], np_videos: [], np_clips: [], np_assets: [] }); } catch (_) {}
                const n = await npDirNewNote('k', '视频', '', { filmKind: '混剪视频' });
                return { id: String(n.id) };
            }''')
            if not note.get('id'):
                bad('建篇没成：%r' % (note,))
                ctx.close()
                return 1
            j(page, '''(a) => npGoFilm({ noteId: a.id, kind: '混剪视频', script: a.script,
                                        title: '自检·缺料补图', body: '', shots: null, style: '' })''',
              {'id': note['id'], 'script': SCRIPT})
            if not wait_js(page, '() => !!(window.Film && Film.scenes && Film.scenes.length)', 60000, 500):
                bad('片台没分幕：%r' % (j(page, '() => ({ ready: !!window.Film })'),))
                ctx.close()
                return 1
            ns = j(page, '() => Film.scenes.length')
            ok('进片台分好 %d 幕（素材库空着）' % ns)
            j(page, '() => document.querySelector(\'#scTabs [data-sctab="pic"]\').click()')
            page.wait_for_timeout(400)

            # ── ① 空库点「AI 先配一版」：只报缺料，不发一次请求 ──
            pre = len(ImgStub.requests)
            j(page, '() => document.getElementById("matAuto").click()')
            page.wait_for_timeout(600)
            tip = j(page, '() => (document.getElementById("matTip") || {}).textContent || ""')
            has_btn = j(page, '() => !!document.getElementById("matAiPic")')
            btn_txt = j(page, '() => (document.getElementById("matAiPic") || {}).textContent || ""')
            btn_pri = j(page, '() => { const b = document.getElementById("matAiPic"); return !!b && b.classList.contains("primary"); }')
            if len(ImgStub.requests) == pre and has_btn and '一起补画面' in btn_txt and btn_pri:
                ok('素材库空：先配一版只报缺料（%s），顶上给的是实心主按钮「%s」' % (' '.join(tip.split())[:50], btn_txt.strip()))
            else:
                bad('空库那一步不对：请求 %d→%d，按钮 %r（实心 %r），提示 %r' % (pre, len(ImgStub.requests), btn_txt, btn_pri, tip))
            if '素材库' in tip or '切几段' in tip:
                ok('提示话说清了「素材库没有」这件事')
            else:
                bad('提示话没提素材库：%r' % (tip,))

            # ── ② 点批量补图：留最后一屏故意没出成 ──
            last_text = j(page, '(i) => String(Film.scenes[i].text || "")', ns - 1)
            ImgStub.fail_word = '门头' if '门头' in last_text else last_text[:6]
            base_req = len(ImgStub.requests)
            j(page, '() => document.getElementById("matAiPic").click()')
            done = wait_js(page, '''(n) => Film.scenes.every(s => (s.mats || []).length || s.aiErr)''', 60000, 400, ns)
            if not done:
                bad('补图没跑完：%r' % (j(page, '''() => Film.scenes.map(s => ({ n: (s.mats || []).length, err: s.aiErr || '' }))'''),))
            reqs = ImgStub.requests[base_req:]
            if len(reqs) == ns:
                ok('一屏一次请求：%d 屏＝%d 次（没多跑）' % (ns, len(reqs)))
            else:
                bad('请求次数不对：%d 屏发了 %d 次' % (ns, len(reqs)))
            p0 = reqs[0]['prompt'] if reqs else ''
            if '9:16' in p0 and '不要出现任何文字' in p0:
                ok('提示词按这一屏的字写，钉了竖屏与「不要字」')
            else:
                bad('提示词不对：%r' % (p0[:120],))

            st = j(page, '''() => Film.scenes.map(s => ({ n: (s.mats || []).length,
                k: ((s.mats || [])[0] || {}).kind || '', ref: String(((s.mats || [])[0] || {}).ref || ''),
                gen: !!((s.mats || [])[0] || {}).gen, th: String(((s.mats || [])[0] || {}).thumb || '').slice(0, 22),
                err: String(s.aiErr || '') }))''')
            good = [x for x in st if x['n'] == 1 and x['k'] == 'photo' and x['gen'] and x['ref'].startswith('gen:')]
            failed = [x for x in st if x['n'] == 0 and x['err']]
            if len(good) == ns - 1 and len(failed) == 1:
                ok('出好的那 %d 屏都变成照片屏（ref=gen:，带小图 %s）；没出成的那屏留红字「%s」'
                   % (len(good), good[0]['th'], failed[0]['err'][:30]))
            else:
                bad('补完的状态不对：%r' % (st,))
            rowtxt = j(page, '''() => [...document.querySelectorAll('#matList .matline')].map(x => x.textContent).join(' ')''')
            if 'AI 没出成' in rowtxt:
                ok('没出成那屏的行尾写明「AI 没出成：…」')
            else:
                bad('没出成那屏没红字：%r' % (rowtxt[:160],))

            # ── ③ 落三处：本机仓 / 素材库「AI 补的画面」/ 料单 ──
            lib = j(page, '''async () => {
                const d = await chrome.storage.local.get(['np_clips', 'np_collections']);
                const clips = Array.isArray(d.np_clips) ? d.np_clips : [];
                const cols = Array.isArray(d.np_collections) ? d.np_collections : [];
                const folder = cols.find(c => c && c.folder && c.name === 'AI 补的画面');
                const mine = clips.filter(c => c && c.genKey);
                return { folder: folder ? folder.id : '', gen: mine.length,
                         cols: mine.every(c => String(c.col) === String(folder && folder.id)),
                         thumbs: mine.every(c => /^data:image\\/jpeg/.test(String(c.thumb || ''))) };
            }''')
            if lib['folder'] and lib['gen'] == ns - 1 and lib['cols'] and lib['thumbs']:
                ok('素材库落了「AI 补的画面」文件夹，%d 条都带小图（出片按本机仓取原图）' % lib['gen'])
            else:
                bad('素材库那边不对：%r' % (lib,))
            db = j(page, '''async (nid) => {
                const db = await new Promise((res, rej) => {
                    const rq = indexedDB.open('xhsCase', 1);
                    rq.onupgradeneeded = () => { if (!rq.result.objectStoreNames.contains('case'))
                        rq.result.createObjectStore('case', { keyPath: 'key' }); };
                    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
                });
                const one = (k) => new Promise((res) => {
                    const rq = db.transaction('case', 'readonly').objectStore('case').get(k);
                    rq.onsuccess = () => res(rq.result || null); rq.onerror = () => res(null);
                });
                let n = 0, bytes = 0;
                for (let i = 0; i < 12; i++) {
                    const r = await one('genfig:' + nid + ':' + i);
                    if (r && r.blob) { n++; bytes = Math.max(bytes, r.blob.size); }
                }
                return { n: n, bytes: bytes };
            }''', note['id'])
            if db['n'] == ns - 1 and db['bytes'] > 100:
                ok('本机仓存下 %d 张原图（最大 %dKB），服务器清了也不影响出片' % (db['n'], round(db['bytes'] / 1024)))
            else:
                bad('本机仓没存上：%r' % (db,))

            # ── ④ 失败那屏单独点「✨ 出一张」：补上 ──
            ImgStub.fail_word = ''
            failed_i = [i for i, x in enumerate(st) if x['n'] == 0][0] if st else -1
            if failed_i >= 0:
                before = len(ImgStub.requests)
                j(page, '''(i) => document.querySelector('#matList .matline[data-msc="' + i + '"] [data-aigen]').click()''', failed_i)
                wait_js(page, '''(i) => (Film.scenes[i].mats || []).length > 0''', 30000, 300, failed_i)
                if len(ImgStub.requests) == before + 1:
                    ok('那一屏自己再点「✨ 出一张」：只补它一张，补上了')
                else:
                    bad('单屏补图请求次数不对：+%d' % (len(ImgStub.requests) - before))

            # ── ⑧ 全屏都是 AI 图时：顶上一颗「↻ 一起重出画面」，一次全重出 ──
            if wait_js(page, '''() => { const b = document.getElementById('matAiPic');
                return !!b && /一起重出/.test(b.textContent) && !b.disabled; }''', 15000, 300):
                before_req = len(ImgStub.requests)
                j(page, '() => document.getElementById("matAiPic").click()')
                end = time.time() + 60
                while time.time() < end and len(ImgStub.requests) < before_req + ns:
                    page.wait_for_timeout(200)
                page.wait_for_timeout(1500)          # 等这一趟写完（换库那几条、重画料单）
                lib_now = j(page, '''async () => { const d = await chrome.storage.local.get(['np_clips']);
                    return (Array.isArray(d.np_clips) ? d.np_clips : []).filter(c => c && c.genKey).length; }''')
                got = len(ImgStub.requests) - before_req
                if got == ns and lib_now == ns:
                    ok('顶上「↻ 一起重出画面」：一次把 %d 屏全重出，素材库还是 %d 条（换掉不叠加）' % (got, lib_now))
                else:
                    bad('一起重出不对：请求 +%d（该 %d），库 %d 条' % (got, ns, lib_now))
            else:
                bad('全屏都是 AI 图时没给「↻ 一起重出画面」那颗按钮：%r'
                    % (j(page, '() => (document.getElementById("matAiPic") || {}).textContent || ""'),))

            # ── ⑤ 「↻ 重出一张」：只换那一屏，素材库那条不越攒越多 ──
            target = 0
            wait_js(page, '''() => { const b = document.getElementById('matAiPic'); return !b || !b.disabled; }''', 15000, 200)
            page.wait_for_timeout(300)
            before_req = len(ImgStub.requests)
            before_lib = j(page, '''async () => { const d = await chrome.storage.local.get(['np_clips']);
                return (Array.isArray(d.np_clips) ? d.np_clips : []).filter(c => c && c.genKey).length; }''')
            old_ref = j(page, '''(i) => String(((Film.scenes[i].mats || [])[0] || {}).ref || '')''', target)
            j(page, '''(i) => document.querySelector('#matList .matline[data-msc="' + i + '"] [data-aigen]').click()''', target)
            end = time.time() + 30
            while time.time() < end and len(ImgStub.requests) == before_req:
                page.wait_for_timeout(200)
            page.wait_for_timeout(1500)          # 等这一趟写完（换库那条、重画料单）
            after_req = len(ImgStub.requests)
            after_lib = j(page, '''async () => { const d = await chrome.storage.local.get(['np_clips']);
                return (Array.isArray(d.np_clips) ? d.np_clips : []).filter(c => c && c.genKey).length; }''')
            new_ref = j(page, '''(i) => String(((Film.scenes[i].mats || [])[0] || {}).ref || '')''', target)
            if after_req == before_req + 1 and before_lib == after_lib and old_ref == new_ref:
                ok('「↻ 重出一张」：只发一次、素材库还是 %d 条（换掉不叠加）、料单还指着同一张' % after_lib)
            else:
                bad('重出一张不对：请求 +%d，库 %d→%d，ref %r→%r' % (after_req - before_req, before_lib, after_lib, old_ref, new_ref))

            # ── ⑥ 「⬆ 传一张」：不请求、不入库、立刻盖掉那屏 ──
            pick_i = 1 if ns > 1 else 0
            before_req = len(ImgStub.requests)
            with page.expect_file_chooser() as fc:
                page.click('#matList .matline[data-msc="%d"] [data-aipick]' % pick_i)
            fc.value.set_files(str(PHOTO_PNG))
            if wait_js(page, '''(i) => { const m = (Film.scenes[i].mats || [])[0] || {};
                return !!m.src && !m.gen; }''', 20000, 300, pick_i):
                after_lib = j(page, '''async () => { const d = await chrome.storage.local.get(['np_clips']);
                    return (Array.isArray(d.np_clips) ? d.np_clips : []).filter(c => c && c.genKey).length; }''')
                if len(ImgStub.requests) == before_req and after_lib == before_lib:
                    ok('「⬆ 传一张」：本机这张立刻垫上，没请求、没入库（库还 %d 条）' % after_lib)
                else:
                    bad('传一张偷偷发了请求或入了库：请求 +%d，库 %d' % (len(ImgStub.requests) - before_req, after_lib))
            else:
                bad('传一张没盖到那屏')

            # ── ⑦ 重开这一篇：AI 补的那几张还在，原图读得出来 ──
            j(page, '() => Film.flush()')
            page.wait_for_timeout(800)
            page.reload(wait_until='domcontentloaded')
            page.wait_for_timeout(2500)
            j(page, '''(a) => npGoFilm({ noteId: a.id, kind: '混剪视频', script: a.script,
                                        title: '自检·缺料补图', body: '', shots: null, style: '' })''',
              {'id': note['id'], 'script': SCRIPT})
            if not wait_js(page, '() => !!(window.Film && Film.scenes && Film.scenes.length)', 60000, 500):
                bad('重开没进片台')
            else:
                back = j(page, '''() => Film.scenes.map(s => { const m = (s.mats || [])[0] || {};
                    return { n: (s.mats || []).length, gen: !!m.gen, ref: String(m.ref || '').slice(0, 12) } })''')
                genback = [x for x in back if x['gen'] and x['ref'].startswith('gen:')]
                if len(genback) == ns - 1:
                    ok('重开这一篇：AI 补的 %d 屏都还在（ref=gen:，不重扣）' % len(genback))
                else:
                    bad('重开丢了 AI 图：%r' % (back,))
                j(page, '() => document.querySelector(\'#scTabs [data-sctab="pic"]\').click()')
                page.wait_for_timeout(500)
                # 找片台自己预铺的结果：gen 那几屏的 m.img 该有尺寸
                if wait_js(page, '''() => Film.scenes.every(s => { const m = (s.mats || [])[0] || {};
                    return !m.gen || !!(m.img && (m.img.width || m.img.videoWidth)); })''', 30000):
                    ok('重开后 AI 那张原图从本机仓读得出来（能画上画布）')
                else:
                    bad('重开后原图没读出来：%r' % (j(page, '''() => Film.scenes.map(s => { const m = (s.mats || [])[0] || {};
                        return { gen: !!m.gen, w: (m.img && (m.img.width || m.img.videoWidth)) || 0 } })'''),))

            if errs:
                bad('页内有报错：%r' % (errs[:3],))
            else:
                ok('全程无页内报错')

            ctx.close()
    finally:
        try:
            srv.terminate()
        except Exception:
            pass
        try:
            stub.shutdown()
        except Exception:
            pass

    print(('\n结果：%d 条没过' % fails) if fails else '\n全部通过')
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
