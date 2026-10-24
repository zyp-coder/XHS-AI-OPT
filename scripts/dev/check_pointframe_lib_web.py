# -*- coding: utf-8 -*-
"""切片台「点帧就认」·真实 web 自检（2026-10-22）

对着 资料/素材库切片台-点帧就认-确认单.md 第五节逐项验：
  ① 点小旗/点时间轴 → 认这一帧 + 边界落在切镜点 + 行上标「✨ 认过（点的那一帧）」；
  ② 花钱计数随点帧涨，连点 5 下只涨 1 张（前面那次作废、不重复扣钱）；
  ③ 入库时认过的段不再发图，只对没认过的段补认（请求张数能对上）；
  ④ 手改过名字的段再点一帧 → 问「还是按画面改」，选「不改」保留我写的、选「还是按画面改」才覆盖；
  ⑤ 「不传图片」的批次：点帧只定边界、一张图都不发、AI 按钮按着不动；
  ⑥ AI 回「看不清」→ 名字按位置填，界面不出现「AI 看懂了」；
  ⑦ 一段里走了两个地方 → 问「要不要分一刀」，点了出两段各认各的、这刀不多花一张；
  ⑧ 「✨ AI 看一遍」开跑前先报「这条要看 N 张、大约 ¥X」，点「先不跑」一张都不发；
  ⑨ 全程没有页内 JS 异常。

跑法：python3 -X utf8 scripts/dev/check_pointframe_lib_web.py
本机起 dev-server（临时账本）+ 本机假方舟（127.0.0.1:8927，只认自检要的三种回话）；
Edge 真开页、真截帧、真走 chrome-shim → dev-server → 假方舟；绝不打火山真接口、不推公网。
"""
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

from _guide_gate import goto_big

sys.stdout.reconfigure(encoding='utf-8')
REPO = Path(__file__).resolve().parents[2]
PORT = 8926
FAKE_PORT = 8927
BASE = 'http://127.0.0.1:%d' % PORT
WORK = REPO / 'tmp' / 'pointframe-lib-web-check'
DATA = WORK / 'data'
VIDEO1 = WORK / 'pf-4shots.mp4'
VIDEO2 = WORK / 'pf-2shots.mp4'
fails = 0

LOCK = threading.Lock()
STATS = {'probe': 0, 'seg_req': 0, 'seg_imgs': 0, 'label_req': 0, 'label_imgs': 0, 'label_ids': [], 'other': 0}


def ok(msg):
    print('  PASS ' + msg, flush=True)


def bad(msg):
    global fails
    fails += 1
    print('  FAIL ' + msg, flush=True)


def snap():
    with LOCK:
        return dict(STATS, label_ids=list(STATS['label_ids']))


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


def cb(page, sel):
    page.click('#noteBenchContent ' + sel)


# ── 本机假方舟：只回自检要的形状 ──
def scene_for(t):
    if t < 1.5:
        return '客厅'
    if t < 2.6:
        return '卫生间'
    if t < 5.0:
        return '卧室'
    if t < 8.0:
        return '厨房'
    return '阳台'


def msg_text(msgs):
    out = []
    for m in msgs:
        c = m.get('content')
        if isinstance(c, str):
            out.append(c)
        elif isinstance(c, list):
            for p in c:
                if isinstance(p, dict) and p.get('type') == 'text':
                    out.append(str(p.get('text') or ''))
    return '\n'.join(out)


def count_imgs(msgs):
    n = 0
    for m in msgs:
        c = m.get('content')
        if isinstance(c, list):
            for p in c:
                if isinstance(p, dict) and p.get('type') == 'image_url':
                    n += 1
    return n


def pool_of(txt):
    mt = re.search(r'标签只能从这些里挑：([^\n]*)', txt)
    if not mt:
        return []
    raw = mt.group(1).strip().rstrip('。')
    return [x for x in raw.split('、') if x and '不给标签' not in x]


def fake_reply(body):
    msgs = body.get('messages') or []
    txt = msg_text(msgs)
    imgs = count_imgs(msgs)
    if '只回 OK' in txt or '测试小图' in txt:
        with LOCK:
            STATS['probe'] += 1
        return 'OK'
    if '段素材的关键帧' in txt:
        ids = re.findall(r'id=(\S+?)（([0-9.]+)–([0-9.]+)秒）', txt)
        pool = pool_of(txt)
        items = []
        for sid, a, b in ids:
            t = float(sid.split(':')[1]) if sid.startswith('point:') else float(a)
            if sid.startswith('point:') and t >= 11.0:
                items.append({'id': sid, 'scene': '', 'name': '', 'tag': '', 'desc': ''})
                continue
            sc = scene_for(t)
            items.append({'id': sid, 'scene': sc, 'name': sc + '·干活',
                          'tag': (pool[0] if pool else ''), 'desc': sc + '里有人在搬东西（自检画面）'})
        with LOCK:
            STATS['label_req'] += 1
            STATS['label_imgs'] += imgs
            STATS['label_ids'] += [x[0] for x in ids]
        return json.dumps({'items': items}, ensure_ascii=False)
    if '按顺序看这' in txt:
        ts = [float(x) for x in re.findall(r't=([0-9.]+)秒', txt)]
        pool = pool_of(txt)
        frames = [{'i': i, 'scene': scene_for(t), 'action': '搬东西', 'stage': '',
                   'tag': (pool[0] if pool else '')} for i, t in enumerate(ts)]
        changes = [i for i in range(1, len(ts)) if scene_for(ts[i]) != scene_for(ts[i - 1])]
        with LOCK:
            STATS['seg_req'] += 1
            STATS['seg_imgs'] += imgs
        return json.dumps({'frames': frames, 'changes': changes}, ensure_ascii=False)
    with LOCK:
        STATS['other'] += 1
    return '{}'


class FakeArk(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *_args):
        pass

    def do_POST(self):  # noqa: N802
        try:
            n = int(self.headers.get('Content-Length') or 0)
            body = json.loads(self.rfile.read(n).decode('utf-8') or '{}')
            content = fake_reply(body)
        except Exception as e:  # 假方舟自己出错也要回个能看懂的
            content = ''
            print('  !! 假方舟出错：%s' % e, flush=True)
        payload = json.dumps({'choices': [{'message': {'role': 'assistant', 'content': content}}],
                              'usage': {'total_tokens': 1}}).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def make_video(path, shots):
    if path.exists():
        return
    args = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y']
    for color, _label, secs in shots:
        args += ['-f', 'lavfi', '-i', 'color=c=%s:s=640x360:d=%s' % (color, secs)]
    parts = []
    for i, (color, label, _secs) in enumerate(shots):
        fg = 'black' if color in ('0xb0b0b0', '0xf0f0f0') else 'white'
        parts.append("[%d:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='%s':fontsize=64:fontcolor=%s:x=(w-text_w)/2:y=(h-text_h)/2[v%d]"
                     % (i, label, fg, i))
    fc = ';'.join(parts) + ';' + ''.join('[v%d]' % i for i in range(len(shots))) + 'concat=n=%d:v=1:a=0[v]' % len(shots)
    args += ['-filter_complex', fc, '-map', '[v]', '-r', '10', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(path)]
    subprocess.run(args, check=True)


def wait_labels(page, vid, timeout=120000):
    return wait_js(page, '''(id) => {
        if (typeof _npLibLabeling !== 'undefined' && _npLibLabeling[id]) return false;
        return !document.querySelector('#noteBenchContent #nplTl');
    }''', timeout, 300, vid)


def main():
    print('── 切片台「点帧就认」·真实 web 自检 ──', flush=True)
    if WORK.exists():
        shutil.rmtree(WORK)
    WORK.mkdir(parents=True, exist_ok=True)
    make_video(VIDEO1, [('0x101010', 'SHOT 1', 3), ('0x606060', 'SHOT 2', 3), ('0xb0b0b0', 'SHOT 3', 3), ('0xf0f0f0', 'SHOT 4', 3)])
    make_video(VIDEO2, [('0x303030', 'SHOT A', 3), ('0xd0d0d0', 'SHOT B', 3)])
    DATA.mkdir(parents=True, exist_ok=True)

    srv_http = ThreadingHTTPServer(('127.0.0.1', FAKE_PORT), FakeArk)
    threading.Thread(target=srv_http.serve_forever, daemon=True).start()
    print('  本机假方舟已起（127.0.0.1:%d）' % FAKE_PORT, flush=True)

    env = dict(os.environ)
    env['DEMO_DATA_DIR'] = str(DATA)
    env['PORT'] = str(PORT)
    env['DEMO_AI_KEY'] = 'check-only'
    env['DEMO_AI_BASE'] = 'http://127.0.0.1:1/v1'
    # 看图接口指到本机假方舟：真走抽帧 → 上传 → 服务器转发 → 回认名字，但不碰火山
    env['VISION_API_KEY'] = 'fake-local-only'
    env['VISION_API_BASE'] = 'http://127.0.0.1:%d/v1' % FAKE_PORT
    env['VISION_PRICE_FRAME'] = '0.012'
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
        bad('服务器没起来（看 tmp/pointframe-lib-web-check/server.log）')
        return
    time.sleep(2)

    errs = []
    try:
        with sync_playwright() as p:
            br = p.chromium.launch(channel='msedge', headless=True)
            ctx = br.new_context(viewport={'width': 1500, 'height': 950})
            page = ctx.new_page()
            page.on('pageerror', lambda e: errs.append(str(e)))
            page.on('dialog', lambda d: d.accept())

            page.goto(BASE + '/start.html', wait_until='domcontentloaded', timeout=90000)
            page.wait_for_timeout(2000)
            who = page.evaluate('''async () => await (await fetch('/api/auth/demo', { method: 'POST',
                headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'deco' }) })).json()''')
            if not who.get('ok'):
                bad('演示号没进上：%r' % (who,))
                br.close()
                return

            goto_big(page, BASE + '/popup.html?mode=big', wait_until='domcontentloaded', timeout=90000)
            page.wait_for_timeout(1500)
            # 把 toast 抄一份到 window.__toasts，别靠 DOM 存活时间抢读
            page.evaluate('''() => {
                window.__toasts = [];
                const old = window.toast;
                window.toast = function (m, k) { window.__toasts.push(String(m || '')); try { return old(m, k); } catch (_) {} };
                return true;
            }''')

            def toasts_matching(pat):
                return j(page, '''(p) => (window.__toasts || []).filter(t => new RegExp(p).test(t))''', pat)

            def clear_toasts():
                page.evaluate('() => { window.__toasts = []; return true; }')

            # ── 准备：导入一批两条，把建议切点钉成 3/6/9（边界要算得准；分镜本身另有脚本验） ──
            page.evaluate('() => switchMainTab("noteBench")')
            page.wait_for_timeout(500)
            cb(page, '[data-npl="import-batch"]')
            page.wait_for_selector('#nplBatName', timeout=8000)
            page.fill('#nplBatName', '自检点帧·阳光小区')
            page.set_input_files('#nplBatFile', [str(VIDEO1), str(VIDEO2)])
            if not wait_js(page, '() => /选了 2 条，读得出 2 条/.test((document.getElementById("nplBatMeta")||{}).textContent || "")', 40000):
                bad('多选导入没读出时长')
                br.close()
                return
            clear_toasts()
            page.click('#nplBatSave')
            if not wait_js(page, '''async () => {
                const bs = await npBatchesRead();
                const vs = await npVideosRead();
                return bs.length === 1 && vs.filter(v => v && v.batchId === bs[0].id).length === 2;
            }''', 30000):
                bad('导入没落批：%r' % (j(page, '''async () => ({ bs: (await npBatchesRead()).length, vs: (await npVideosRead()).length })'''),))
                br.close()
                return
            vids = j(page, '''async () => {
                const b = (await npBatchesRead())[0];
                return (await npVideosRead()).filter(v => v && v.batchId === b.id)
                    .map(v => ({ id: String(v.id), name: v.name, dur: v.dur }));
            }''')
            vid1 = [v for v in vids if v['dur'] > 10][0]['id']
            vid2 = [v for v in vids if v['dur'] <= 10][0]['id']
            if not wait_js(page, '''async (ids) => {
                if (typeof _npLibScanning !== 'undefined' && ids.some(id => _npLibScanning[id])) return false;
                const vs = await npVideosRead();
                return ids.every(id => { const v = vs.find(x => x && String(x.id) === id); return v && Array.isArray(v.marks); });
            }''', 150000, 500, [vid1, vid2]):
                bad('本机建议切点没扫完')
                br.close()
                return
            scanned = j(page, '''async (id) => { const v = (await npVideosRead()).find(x => String(x.id) === id); return v.marks; }''', vid1)
            page.evaluate('''async (ids) => {
                const vs = await npVideosRead();
                ids.forEach(o => { const v = vs.find(x => String(x.id) === o.id); if (v) v.marks = o.marks; });
                await npVideosWrite(vs);
                _npLibCache.videos = vs;
                return true;
            }''', [{'id': vid1, 'marks': [3, 6, 9]}, {'id': vid2, 'marks': [3]}])
            ok('两条原片已导入（本机扫到 %d 个建议切点，边界已钉成整秒好对账）' % len(scanned))

            # ── ① 点小旗：认这一帧 + 边界 + 行上徽标 + 花钱计数 ──
            page.evaluate('async (id) => { await npLibOpenEditor(id); }', vid1)
            if not wait_js(page, '() => !!document.querySelector("#noteBenchContent #nplTl") && !!document.querySelector("#noteBenchContent .npl-ed-grid")', 25000):
                bad('剪辑视图没画出来')
                br.close()
                return
            st0 = j(page, '() => ({ keys: (_npLibEditor.keys || []).length, keyN: Number(_npLibEditor.keyN) || 0, cuts: (_npLibEditor.cuts || []).length, cost: !!document.querySelector("#noteBenchContent .npl-cost") })')
            if st0['keys'] == 0 and st0['keyN'] == 0 and st0['cuts'] == 0 and not st0['cost']:
                ok('进剪辑视图：0 段 0 张图，没点不花钱（连计数条都不出）')
            else:
                bad('进剪辑视图初始状态不对：%r' % (st0,))
            probe0 = snap()
            cb(page, '.npl-tl-cand[data-t="3"]')
            if not wait_js(page, '() => (_npLibEditor.keys || []).length === 1 && !_npLibEditor.keyBusy && !_npLibEditor.pending', 60000):
                bad('点小旗没认出这一段：%r' % (j(page, '() => ({ keys: _npLibEditor.keys, busy: _npLibEditor.keyBusy, pending: _npLibEditor.pending })'),))
                br.close()
                return
            s1 = snap()
            wait_js(page, '''() => !!Array.from(document.querySelectorAll("#noteBenchContent .npl-edrow")).find(x => x.getAttribute("data-a") === "3")''', 20000)
            row1 = j(page, '''() => { const r = Array.from(document.querySelectorAll("#noteBenchContent .npl-edrow")).find(x => x.getAttribute("data-a") === "3"); return r ? r.textContent : ""; }''')
            cost1 = j(page, '() => String((document.querySelector("#noteBenchContent .npl-cost")||{}).textContent || "")')
            if s1['label_req'] - probe0['label_req'] == 1 and s1['label_imgs'] - probe0['label_imgs'] == 1:
                ok('点小旗＝发 1 张小图、要 1 次认（本机真截帧 → 服务器 → 看图接口）')
            else:
                bad('小旗那一下的图数/请求数不对：请求 %d、图 %d' % (s1['label_req'] - probe0['label_req'], s1['label_imgs'] - probe0['label_imgs']))
            if '✨ 认过（点的那一帧' in row1 and '0:03' in row1:
                ok('段行写明「✨ 认过（点的那一帧 0:03）」，认的是点的那一帧')
            else:
                bad('段行徽标不对：%r' % (row1[:220],))
            if '看了 1 张小图' in cost1 and '¥0.012' in cost1 and '不点不花钱' in cost1:
                ok('花钱计数：看了 1 张小图 · 约 ¥0.012（每张 0.012 由服务器给的价）')
            else:
                bad('花钱计数文案不对：%r' % (cost1,))
            if '客厅' not in row1 and '·干活' in row1:
                ok('段名用的是看图回的话（卧室·干活：0:03 那一帧落在第 2 格）')
            else:
                bad('段名不对：%r' % (row1[:220],))
            bnd1 = j(page, '''() => { const k = (_npLibEditor.keys || [])[0]; return k ? { keyT: Number(k.keyT), a: Number(k.a), b: Number(k.b) } : null; }''')
            if bnd1 and bnd1['a'] == 3.0 and bnd1['b'] == 6.0:
                ok('点在小旗（3 秒）上：这一段从 3 秒起、到下一个切镜点 6 秒止')
            else:
                bad('点在小旗上时边界没吸附到那一格：%r' % (bnd1,))

            # ── ⑦ 一段里走了两个地方 → 问要不要分一刀 ──
            clear_toasts()
            page.evaluate('() => { npLibEditorPointAt(5.0); return true; }')
            if not wait_js(page, "() => _npLibEditor.ask && _npLibEditor.ask.kind === 'split'", 60000):
                bad('第二个房间没弹「要不要分一刀」：%r' % (j(page, '() => ({ ask: _npLibEditor.ask, keys: _npLibEditor.keys })'),))
            else:
                wait_js(page, '() => !!document.querySelector("#noteBenchContent .npl-ask")', 15000)
                ask_txt = j(page, '() => String((document.querySelector("#noteBenchContent .npl-ask")||{}).textContent || "")')
                if '一段里走了两个地方' in ask_txt and '分一刀' in ask_txt:
                    ok('界面如实问「一段里走了两个地方，要不要在这里分一刀」')
                else:
                    bad('分一刀问话文案不对：%r' % (ask_txt[:200],))
                keys_before = snap()
                cb(page, '[data-npl="ed-ask"][data-kind="split"]')
                if not wait_js(page, '() => (_npLibEditor.keys || []).length === 2 && !_npLibEditor.ask', 15000):
                    bad('点分一刀后没出两段：%r' % (j(page, '() => ({ keys: _npLibEditor.keys, ask: _npLibEditor.ask })'),))
                else:
                    s2 = snap()
                    cut2 = j(page, '() => (_npLibEditor.cuts || []).map(c => Number(c.t))')
                    names = j(page, '''() => Array.from(document.querySelectorAll("#noteBenchContent .npl-edrow-name")).map(x => x.textContent)''')
                    if s2['label_req'] == keys_before['label_req'] and 5.0 in cut2 and '卧室·干活' in ''.join(names) and '厨房·干活' in ''.join(names):
                        ok('分一刀：5.0 秒落刀、两段各带自己的名字（卧室 / 厨房），这一刀没多花一张图')
                    else:
                        bad('分一刀结果不对：多发的请求 %d、切点 %r、名字 %r' % (s2['label_req'] - keys_before['label_req'], cut2, names))

            # ── ② 连点 5 下只认最后一次、只涨 1 张 ──
            clear_toasts()
            before5 = snap()
            keyn_before = j(page, '() => Number(_npLibEditor.keyN) || 0')
            page.evaluate('() => { [4.0, 4.1, 4.2, 4.3, 4.4].forEach(t => npLibEditorPointAt(t)); return true; }')
            if not wait_js(page, '() => !_npLibEditor.keyBusy && !_npLibEditor.pending && !_npLibEditor.clickTimer', 60000):
                bad('连点后没停下：%r' % (j(page, '() => ({ busy: _npLibEditor.keyBusy, pending: _npLibEditor.pending, timer: !!_npLibEditor.clickTimer })'),))
            else:
                s3 = snap()
                keyn_after = j(page, '() => Number(_npLibEditor.keyN) || 0')
                kt = j(page, '''() => { const k = (_npLibEditor.keys || []).find(x => Number(x.keyT) >= 3); return k ? { keyT: k.keyT, a: k.a, b: k.b } : null; }''')
                if s3['label_req'] - before5['label_req'] == 1 and keyn_after - keyn_before == 1 and kt and abs(kt['keyT'] - 4.4) < 0.05:
                    ok('连点 5 下（4.0~4.4）只发 1 张、只涨 1 张，认的是最后那一下 4.4 秒')
                else:
                    bad('连点结果不对：请求 %d、计数 %d→%d、认的帧 %r' % (s3['label_req'] - before5['label_req'], keyn_before, keyn_after, kt))

            # ── ⑥ AI 说「看不清」→ 名字按位置填，不谎称看懂 ──
            clear_toasts()
            page.evaluate('() => { npLibEditorPointAt(11.5); return true; }')
            got_blur = wait_js(page, '() => !!(window.__toasts || []).some(t => /看不清/.test(t))', 60000, 250)
            page.wait_for_timeout(1200)
            st_blur = j(page, '''() => ({
                rows: Array.from(document.querySelectorAll("#noteBenchContent .npl-edrow")).map(r => r.textContent),
                keys: (_npLibEditor.keys || []).length
            })''')
            blur_row = [r for r in st_blur['rows'] if '0:09' in r and '0:12' in r]
            if got_blur and '按位置填' in ''.join(blur_row) and '认过' not in ''.join(blur_row):
                ok('AI 说看不清 → 回话照实说、这一段标「按位置填」，不写「AI 看懂了」')
            else:
                bad('看不清那段没兜住：toast %r 行 %r' % (toasts_matching('看不清')[:1], blur_row[:1]))

            # ── ④ 手改过名字的段：再点一帧先问，不直接覆盖 ──
            cb(page, '[data-npl="ed-seg-edit"][data-a="3"]')
            page.wait_for_selector('#nplEdSegName', timeout=8000)
            page.fill('#nplEdSegName', '自检·我自己写的')
            page.fill('#nplEdSegDesc', '这段是我自己标的，AI 不该动。')
            page.evaluate('''() => { const b = document.querySelector('.npl-sheet .npl-tagpick [data-tag]:not(.on)'); if (b) b.click(); return !!b; }''')
            page.click('#nplEdSegSave')
            if not wait_js(page, '() => !document.getElementById("nplEdSegName")', 12000):
                bad('改段弹窗没关')
            clear_toasts()
            page.evaluate('() => { npLibEditorPointAt(4.5); return true; }')
            if not wait_js(page, "() => _npLibEditor.ask && _npLibEditor.ask.kind === 'overwrite'", 60000):
                bad('手改过的段再点帧没问覆盖：%r' % (j(page, '() => _npLibEditor.ask'),))
            else:
                ov_txt = j(page, '() => String((document.querySelector("#noteBenchContent .npl-ask")||{}).textContent || "")')
                cb(page, '[data-npl="ed-ask"][data-kind="cancel"]')
                kept = wait_js(page, '''() => { const r = Array.from(document.querySelectorAll("#noteBenchContent .npl-edrow")).find(x => x.getAttribute("data-a") === "3"); return !!r && /我自己写的/.test(r.textContent) && !/还是按画面改/.test((document.querySelector("#noteBenchContent .npl-ask")||{}).textContent || ""); }''', 15000)
                if 'AI 不会覆盖' in ov_txt and kept:
                    ok('手改过的段：先问「要按这一帧改吗」，点「不改，保留我写的」名字原样在')
                else:
                    bad('覆盖问话或保留不对：%r / kept=%s' % (ov_txt[:180], kept))
                page.evaluate('() => { npLibEditorPointAt(4.5); return true; }')
                if not wait_js(page, "() => _npLibEditor.ask && _npLibEditor.ask.kind === 'overwrite'", 60000):
                    bad('第二次点帧没再问覆盖')
                else:
                    cb(page, '[data-npl="ed-ask"][data-kind="force"]')
                    forced = wait_js(page, '''() => { const r = Array.from(document.querySelectorAll("#noteBenchContent .npl-edrow")).find(x => x.getAttribute("data-a") === "3"); return !!r && /卧室·干活/.test(r.textContent) && !/你改过/.test(r.textContent); }''', 15000)
                    if forced:
                        ok('点「还是按画面改」才换成画面认的名字，手工标记同时撤掉')
                    else:
                        row3 = j(page, '''() => { const r = Array.from(document.querySelectorAll("#noteBenchContent .npl-edrow")).find(x => x.getAttribute("data-a") === "3"); return r ? r.textContent : ''; }''')
                        bad('强制覆盖没生效：%r' % (row3[:200],))

            # ── ⑧ 「✨ AI 看一遍」开跑前先报价，点「先不跑」一张都不发 ──
            clear_toasts()
            before_ai = snap()
            keyn_ai = j(page, '() => Number(_npLibEditor.keyN) || 0')
            exp_n = j(page, '(id) => { const v = (_npLibCache.videos || []).find(x => String(x.id) === id) || {}; return npLibFrameTimesForAI(Number(v.dur) || 0).length; }', vid1)
            exp_batch = (exp_n + 7) // 8
            # 每批 8 张、批间留 1 张接上一批，所以总图数 = 张数 + (批数 - 1)
            exp_imgs = exp_n + max(0, exp_batch - 1)
            exp_yuan = j(page, '(n) => { const p = Number(_npLibVision && _npLibVision.priceFrame) || 0.001; return "\\u00a5" + (n * p).toFixed(3); }', exp_n)
            cb(page, '[data-npl="ed-ai"]')
            if not wait_js(page, '() => !!document.getElementById("nplAiGo")', 20000):
                bad('AI 看一遍没弹报价框')
                br.close()
                return
            quote = j(page, '() => String((document.querySelector(".npl-sheet")||{}).textContent || "")')
            page.click('#nplAiNo')
            wait_js(page, '() => !document.getElementById("nplAiGo")', 10000)
            after_no = snap()
            if ('每隔 1 秒' in quote and '这条要看 %d 张画面' % exp_n in quote and exp_yuan in quote
                    and after_no['seg_req'] == before_ai['seg_req']):
                ok('开跑前先报「每隔 1 秒 · 这条要看 %d 张 · 约 %s」；点「先不跑」一张都没发' % (exp_n, exp_yuan))
            else:
                bad('报价或「先不跑」不对：%r 段请求 %d→%d（期望 %d 张 %s）' % (quote[:200], before_ai['seg_req'], after_no['seg_req'], exp_n, exp_yuan))
            cb(page, '[data-npl="ed-ai"]')
            if not wait_js(page, '() => !!document.getElementById("nplAiGo")', 20000):
                bad('第二次没弹报价框')
            else:
                page.click('#nplAiGo')
                if not wait_js(page, '() => !_npLibEditor.aiBusy', 180000, 500):
                    bad('AI 看一遍没跑完：%r' % (j(page, '() => ({ busy: _npLibEditor.aiBusy })'),))
                else:
                    after_go = snap()
                    ai_state = j(page, '''async (id) => {
                        const v = (await npVideosRead()).find(x => String(x.id) === id);
                        return { aiSegs: (v.aiSegs || []).length, cuts: (_npLibEditor.cuts || []).map(c => Number(c.t)), keyN: Number(_npLibEditor.keyN) || 0 };
                    }''', vid1)
                    if (after_go['seg_req'] - before_ai['seg_req'] == exp_batch and after_go['seg_imgs'] - before_ai['seg_imgs'] == exp_imgs
                            and ai_state['aiSegs'] >= 2 and ai_state['keyN'] - keyn_ai == exp_n):
                        ok('点「开始看」：发 %d 张（%d 批、1 秒一张，批间接 1 张共 %d 图）→ AI 分出 %d 段、计数条按 %d 张记账' % (exp_n, exp_batch, exp_imgs, ai_state['aiSegs'], exp_n))
                    else:
                        bad('AI 看一遍用量对不上：请求 %d 图 %d（期望 %d 批 %d 图）aiSegs %r keyN %d→%d' % (after_go['seg_req'] - before_ai['seg_req'], after_go['seg_imgs'] - before_ai['seg_imgs'], exp_batch, exp_imgs, ai_state['aiSegs'], keyn_ai, ai_state['keyN']))

            # ── ③ 入库：认过的段不再发图，只补认没认过的 ──
            page.evaluate('() => { npLibSeekPlayer(7.5); return true; }')
            cb(page, '[data-npl="ed-addcut"]')
            wait_js(page, '() => (_npLibEditor.cuts || []).some(c => Math.abs(Number(c.t) - 7.5) < 0.05)', 10000)
            seg_rows = j(page, '() => Array.from(document.querySelectorAll("#noteBenchContent .npl-edrow")).map(r => r.getAttribute("data-a"))')
            clear_toasts()
            before_confirm = snap()
            cb(page, '[data-npl="ed-confirm"]')
            if wait_js(page, '() => !!document.getElementById("nplFoldAskName")', 15000):
                page.click('#nplFoldAskSave')
            if not wait_js(page, '() => !document.querySelector("#noteBenchContent #nplTl")', 30000):
                bad('入库没退出剪辑视图')
                br.close()
                return
            # 入库的回话和补认都在「页面重渲染完之后」才发：先等回话冒出来，再对账
            if not wait_js(page, "() => (window.__toasts || []).some(t => t.indexOf('入库了') === 0)", 90000, 300):
                bad('入库回话 90 秒没出（那次重渲染没走完）：%r' % (toasts_matching('.'),))
            if not wait_labels(page, vid1):
                bad('入库后的补认没结束')
            after_confirm = snap()
            clips1 = j(page, '''async (id) => {
                const cs = await npClipsRead();
                return cs.filter(c => c && String(c.videoId) === id)
                    .map(c => ({ a: c.a, b: c.b, name: c.name, aiSrc: c.aiSrc || '', keyT: Number(c.keyT) || 0, editedAt: Number(c.editedAt) || 0 }))
                    .sort((x, y) => x.a - y.a);
            }''', vid1)
            new_ids = [x for x in after_confirm['label_ids'] if x not in before_confirm['label_ids']]
            confirm_toast = toasts_matching('入库了')
            tpl_before = [c for c in clips1 if c['aiSrc'] == '' or c['aiSrc'] == 'vision']
            if len(clips1) >= 6 and sum(1 for c in clips1 if c['aiSrc'] == 'key' and c['keyT'] > 0) == 2:
                ok('入库 %d 段（1 秒一张分得更细）：其中 2 段带着「点的那一秒」（keyT 存住了，段卡缩略图用它）' % len(clips1))
            else:
                bad('入库段的 keyT/aiSrc 不对：%r' % (clips1,))
            if after_confirm['label_req'] - before_confirm['label_req'] == 1 and after_confirm['label_imgs'] - before_confirm['label_imgs'] == 2 and len(new_ids) == 2:
                ok('入库只补认没认过的 2 段（发 2 张），点过 / AI 认过的 4 段一张都没再发')
            else:
                bad('入库补认对不上：请求 %d 图 %d ids %r' % (after_confirm['label_req'] - before_confirm['label_req'], after_confirm['label_imgs'] - before_confirm['label_imgs'], new_ids))
            if '补认 2 段' in ''.join(confirm_toast) and '没再花钱' in ''.join(confirm_toast):
                ok('入库回话报了「认过的没再花钱；补认 2 段」：%r' % (confirm_toast[-1][:110],))
            else:
                bad('入库回话不对：%r（这一段的全部提示：%r）' % (confirm_toast, toasts_matching('.')))
            keyclips = [c for c in clips1 if c['aiSrc'] == 'key']
            if keyclips and all('·干活' in c['name'] for c in keyclips):
                ok('点帧认过的段入库后名字还是画面认的：%r' % [c['name'] for c in keyclips])
            else:
                bad('点帧认的段名被改了：%r' % (keyclips,))
            if tpl_before and all(c['aiSrc'] == 'vision' for c in clips1 if c['aiSrc'] not in ('key', 'seg') and not c['editedAt']):
                ok('补认回来的段标成「AI 认的」（aiSrc=vision）')
            else:
                bad('补认段的标记不对：%r' % (clips1,))

            # ── ⑤ 「不传图片」的批次：点帧只定边界、一张图都不发 ──
            page.evaluate('''async () => {
                npLibS().surface = 'bench'; npLibS().view = 'bench'; npLibS().batchId = '';
                await switchMainTab('noteBench');
                return true;
            }''')
            page.wait_for_timeout(600)
            cb(page, '[data-npl="import-batch"]')
            page.wait_for_selector('#nplBatName', timeout=8000)
            page.fill('#nplBatName', '自检点帧·不传图片')
            page.check('#nplBatNoVision')
            page.set_input_files('#nplBatFile', [str(VIDEO2)])
            if not wait_js(page, '() => /选了 1 条，读得出 1 条/.test((document.getElementById("nplBatMeta")||{}).textContent || "")', 40000):
                bad('第二条没读出来')
                br.close()
                return
            clear_toasts()
            page.click('#nplBatSave')
            if not wait_js(page, '''async (nm) => {
                const bs = await npBatchesRead();
                const b = (bs || []).find(x => x && x.name === nm);
                if (!b) return false;
                const vs = await npVideosRead();
                return vs.some(v => v && String(v.batchId) === String(b.id));
            }''', 60000, 400, '自检点帧·不传图片'):
                bad('不传图片那批没建起来（等 60 秒账本里批和原片没凑齐）')
                br.close()
                return
            vid3 = j(page, '''async () => {
                const bs = (await npBatchesRead()).filter(b => b && b.name === '自检点帧·不传图片');
                const vs = await npVideosRead();
                return bs.length ? String((vs.find(v => v && v.batchId === bs[0].id) || {}).id || '') : '';
            }''')
            if not vid3:
                diag = j(page, '''async () => ({
                    bs: (await npBatchesRead()).map(b => ({ name: b.name, id: String(b.id), noVision: !!b.noVision })),
                    vs: (await npVideosRead()).map(v => ({ name: v.name, batchId: String(v.batchId || '') })),
                    toasts: (window.__toasts || []).slice(-4),
                })''')
                bad('不传图片那批没建起来（批建了但原片没进来）：%r' % (diag,))
                br.close()
                return
            wait_js(page, '''async (id) => {
                if (typeof _npLibScanning !== 'undefined' && _npLibScanning[id]) return false;
                const v = (await npVideosRead()).find(x => String(x.id) === id);
                return v && Array.isArray(v.marks);
            }''', 120000, 500, vid3)
            mk = j(page, '''async (id) => {
                const vs = await npVideosRead();
                const v = vs.find(x => String(x.id) === id);
                if (!v) return 0;
                const ms = (v.marks || []).map(Number).filter(x => x > 0.5);
                if (ms.length) return ms[0];
                v.marks = [3]; await npVideosWrite(vs); _npLibCache.videos = vs;
                return 3;
            }''', vid3)
            page.evaluate('async (id) => { await npLibOpenEditor(id); }', vid3)
            if not wait_js(page, '() => !!document.querySelector("#noteBenchContent #nplTl")', 25000):
                bad('不传图片那批的剪辑视图没开起来')
                br.close()
                return
            before_off = snap()
            clear_toasts()
            dis_ai = j(page, "() => !!document.querySelector('#noteBenchContent [data-npl=ed-ai]').disabled")
            page.evaluate('(t) => { npLibEditorPointAt(t); return true; }', max(0.2, mk - 1.0))
            wait_js(page, '() => !_npLibEditor.pending && !_npLibEditor.keyBusy && !_npLibEditor.clickTimer', 30000)
            after_off = snap()
            st_off = j(page, '''() => ({
                keys: (_npLibEditor.keys || []).length,
                cuts: (_npLibEditor.cuts || []).map(c => Number(c.t)),
                cost: !!document.querySelector("#noteBenchContent .npl-cost"),
                rows: Array.from(document.querySelectorAll("#noteBenchContent .npl-edrow")).map(r => r.textContent),
                bar: String((document.querySelector("#noteBenchContent .npl-vision-bar")||{}).textContent || "")
            })''')
            off_toast = toasts_matching('不传图片')
            if (after_off['label_req'] == before_off['label_req'] and st_off['keys'] == 0 and mk in st_off['cuts']
                    and not st_off['cost'] and '不传图片' in ''.join(off_toast) and dis_ai):
                ok('不传图片的批次：点帧只把边界定好（%s 秒落刀）、0 张图没发、计数条不出、AI 看一遍按着不动' % mk)
            else:
                bad('不传图片路径不对：请求 %d keys %r cuts %r（想落在 %s）计数条 %r toast %r AI 按钮 disabled=%s' % (
                    after_off['label_req'] - before_off['label_req'], st_off['keys'], st_off['cuts'], mk, st_off['cost'], off_toast[:1], dis_ai))
            if '按位置填' in ''.join(st_off['rows']) and '认过' not in ''.join(st_off['rows']):
                ok('这一批的段标「按位置填」，界面没冒「AI 认过」')
            else:
                bad('不传图片那批的段行不对：%r' % (st_off['rows'][:2],))

            # ── ⑨ 老链路没塌：素材库能搜到刚入库的段 ──
            page.evaluate('() => switchMainTab("noteAssets")')
            page.wait_for_timeout(1200)
            page.evaluate('''() => { const el = document.getElementById('nplLibQ'); if (el) { el.value = '干活'; el.dispatchEvent(new Event('input', { bubbles: true })); } return true; }''')
            found = wait_js(page, '() => document.querySelectorAll("#noteAssetsContent .npl-segcard").length > 0', 20000)
            card = j(page, '() => String((document.querySelector("#noteAssetsContent .npl-segcard")||{}).textContent || "")')
            if found and ('认过' in card or 'AI 认的' in card):
                ok('素材库搜得到点帧认过的段，段卡上带着认过的标：%r' % (card[:120],))
            else:
                bad('素材库搜段没结果：found=%s card=%r' % (found, card[:160]))

            if errs:
                bad('页内 JS 异常 %d 条：%r' % (len(errs), errs[:3]))
            else:
                ok('全程没有页内 JS 异常')
            br.close()
    finally:
        try:
            srv.terminate()
        except Exception:
            pass
        srv_http.shutdown()

    print('── 结果：%s（失败 %d）──' % ('全过' if not fails else '有没过的', fails), flush=True)
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
