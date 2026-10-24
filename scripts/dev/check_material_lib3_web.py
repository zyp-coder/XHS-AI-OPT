# -*- coding: utf-8 -*-
"""素材库改版3 · 真实 web 自检（2026-10-22）

【已被取代】2026-10-22 晚左栏拆成「✂ 切片台 + 📚 素材库」两个平级入口后，
本脚本仍从 noteAssets 直进旧的集合墙流程，入口和页面都对不上了。
现行全链路自检请跑 `scripts/dev/check_material_bench_lib_web.py`；
这份留作老 v3 单集合剪辑逻辑的历史参考，不再作为验收口径。

验的是 web/ 这份素材库新流程，不是 demo：
  ① 一次导入两条原视频 → 只进库、0 段（不再自动建段/自动挑段）；
  ② 本机只找「建议切点」，点小旗才加刀；加刀 / 挪刀 / 删刀都能用；
  ③ 入库前能改一段的名字/标签/说明，入库后标「✎ 改过」，不冒充 AI 认的；
  ④ 看图模型没开通时：状态条如实说、AI 按钮不开假结果、入库照常（按位置填）；
  ⑤ 整条当 1 段入库；
  ⑥ 集合勾「不传图片给 AI」：切段照常、AI 按钮禁用；
  ⑦ 挑段发案例：段锁定、案例正文接口失败不挡流程；成功时能存进 note.draft；
  ⑧ 被笔记用着的段：不能重切、不能删。

跑法：python3 -X utf8 scripts/dev/check_material_lib3_web.py
本机起 dev-server（临时账本、看图/写稿都指到不可达的本机端口，绝不打真接口）；
Edge 真开页；不碰 server/data/，不推公网。
"""
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
PORT = 8923
BASE = 'http://127.0.0.1:%d' % PORT
WORK = REPO / 'tmp' / 'material-lib3-web-check'
DATA = WORK / 'data'
VIDEO1 = WORK / 'check-long-4shots.mp4'
VIDEO2 = WORK / 'check-short-2shots.mp4'
fails = 0


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


def make_video(path, shots):
    """shots = [(color, label, seconds), ...]"""
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


def main():
    print('── 素材库改版3 · 真实 web 自检 ──', flush=True)
    if WORK.exists():
        shutil.rmtree(WORK)
    WORK.mkdir(parents=True, exist_ok=True)
    make_video(VIDEO1, [('0x101010', 'SHOT 1', 3), ('0x606060', 'SHOT 2', 3), ('0xb0b0b0', 'SHOT 3', 3), ('0xf0f0f0', 'SHOT 4', 3)])
    make_video(VIDEO2, [('0x303030', 'SHOT A', 3), ('0xd0d0d0', 'SHOT B', 3)])
    DATA.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env['DEMO_DATA_DIR'] = str(DATA)
    env['PORT'] = str(PORT)
    # 写稿接口：指向不可达的本机端口，验「失败不挡流程」
    env['DEMO_AI_KEY'] = 'check-only'
    env['DEMO_AI_BASE'] = 'http://127.0.0.1:1/v1'
    # 看图接口：谎称有 Key，但地址不可达 → 走「模型用不了」的降级；绝不打真方舟
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
        bad('服务器没起来（看 tmp/material-lib3-web-check/server.log）')
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

            page.evaluate('() => switchMainTab("noteAssets")')
            if not wait_js(page, '() => !!document.querySelector(".npl-wrap")', 20000):
                bad('素材库页没画出来')
                br.close()
                return
            ok('素材库新页画出来了')

            # 服务端两条新接口在：看图状态如实回、案例正文失败不炸
            st = j(page, '''async () => await chrome.runtime.sendMessage({ action: 'npVisionStatus', data: { force: true } })''')
            if st and st.get('ok') and not st.get('active') and st.get('code'):
                ok('看图状态接口：回 ok、未开通/不可用（%s），没假装看懂' % st.get('code'))
            else:
                bad('看图状态接口回得不对：%r' % (st,))
            art = j(page, '''async () => await chrome.runtime.sendMessage({ action: 'genCaseArticle',
                data: { colName: '自检', brief: '自检', segments: [{ name: '一段', desc: '说明', tags: [] }] } })''')
            if art and art.get('ok') is False and art.get('error'):
                ok('案例正文接口：写稿不可达时如实回失败（不挡挑段）')
            else:
                bad('案例正文接口失败回得不对：%r' % (art,))

            # ① 新建集合
            page.click('[data-npl="newcol"]')
            page.wait_for_selector('#nplColName', timeout=8000)
            page.fill('#nplColName', '自检工地·长视频')
            page.fill('#nplColBrief', '自检用：一条长视频切成几段，一条整条入库。')
            page.check('#nplColConsent')
            page.click('#nplColSave')
            if not wait_js(page, '''async () => {
                const cols = await npCollectionsRead();
                return cols.some(c => c && c.lib && c.name === '自检工地·长视频' && c.consent);
            }''', 10000):
                bad('集合没建成（lib/consent 不对）')
                br.close()
                return
            col_id = j(page, '''async () => {
                const cols = await npCollectionsRead();
                const c = cols.find(x => x && x.lib && x.name === '自检工地·长视频');
                return c ? String(c.id) : '';
            }''')
            ok('新建集合成功，业主同意已勾')

            # ① 一次导入两条 → 只进库、0 段
            page.click('[data-npl="import"]')
            page.wait_for_selector('#nplImpFile', timeout=8000)
            page.set_input_files('#nplImpFile', [str(VIDEO1), str(VIDEO2)])
            if not wait_js(page, '() => /选了 2 条，读得出 2 条/.test((document.getElementById("nplImpMeta")||{}).textContent || "")', 40000):
                bad('多选导入没把两条时长都读出来')
            else:
                ok('多选导入：两条视频都读出了时长')
            page.click('#nplImpSave')
            if not wait_js(page, '''async (cid) => {
                const vs = await npVideosRead();
                return vs.filter(v => v && String(v.col) === cid).length === 2;
            }''', 30000, 300, col_id):
                bad('两条原视频没都进库')
                br.close()
                return
            zero = j(page, '''async (cid) => {
                const vs = (await npVideosRead()).filter(v => v && String(v.col) === cid);
                const ids = vs.map(v => String(v.id));
                const cs = (await npClipsRead()).filter(c => c && ids.indexOf(String(c.videoId)) >= 0);
                return { v: vs.length, c: cs.length, view: npLibS().view };
            }''', col_id)
            if zero['v'] == 2 and zero['c'] == 0 and zero['view'] == 'col':
                ok('导入后：2 条原视频、0 段（不再自动建段/挑段），落在集合页')
            else:
                bad('导入后状态不对：%r' % (zero,))

            vids = j(page, '''async (cid) => {
                const vs = (await npVideosRead()).filter(v => v && String(v.col) === cid).sort((a,b) => String(a.name).localeCompare(String(b.name)));
                return vs.map(v => ({ id: String(v.id), name: v.name, dur: v.dur }));
            }''', col_id)
            vid1 = vids[0]['id'] if vids else ''
            vid2 = vids[1]['id'] if vids else ''

            # 本机建议切点（只找候选，不建段）
            scanned = wait_js(page, '''async (ids) => {
                if (typeof _npLibScanning !== 'undefined' && ids.some(id => _npLibScanning[id])) return false;
                const vs = await npVideosRead();
                return ids.every(id => {
                    const v = vs.find(x => x && String(x.id) === id);
                    return v && Array.isArray(v.marks);
                });
            }''', 120000, 500, [vid1, vid2])
            if scanned:
                marks = j(page, '''async (id) => {
                    const v = (await npVideosRead()).find(x => x && String(x.id) === id);
                    return { marks: v.marks, err: v.marksError || '' };
                }''', vid1)
                if len(marks['marks']) >= 2 and not marks['err']:
                    ok('本机找到 %d 个建议切点（只铺小旗，没建段）' % len(marks['marks']))
                else:
                    bad('本机建议切点不对：%r（仍可手动加刀，继续验）' % (marks,))
            else:
                bad('本机建议切点没扫完（继续验手动加刀）')
            if j(page, '() => document.querySelectorAll(".npl-segcard").length') == 0:
                ok('集合页还没有段（没有偷偷建段）')
            else:
                bad('集合页出现了段——导入后不该自动建段')
            if j(page, '() => document.querySelectorAll(".npl-vidcard").length') == 2:
                ok('集合页画出 2 张原视频卡，按钮是「✂ 切段」')
            else:
                bad('集合页原视频卡数量不对')

            # ② 进剪辑视图
            j(page, 'async (id) => { await npLibOpenEditor(id); }', vid1)
            if not wait_js(page, '() => !!document.querySelector("#nplTl") && !!document.querySelector(".npl-ed-grid")', 20000):
                bad('剪辑视图没画出来')
                br.close()
                return
            ok('剪辑视图画出来了（时间轴 + 段面板）')
            if wait_js(page, '() => !!document.querySelector(".npl-player") && (document.querySelector(".npl-player").readyState >= 1)', 20000, 400):
                ok('原视频播放器接上了（本机 blob，不上传）')
            else:
                bad('播放器没接上/读不出元数据')
            if wait_js(page, '() => Array.from(document.querySelectorAll(".npl-tl-thumbs i")).some(el => !!el.style.backgroundImage)', 30000, 400):
                ok('时间轴缩略图抽出来了')
            else:
                bad('时间轴缩略图没抽出来')
            cands = j(page, '() => Array.from(document.querySelectorAll("[data-npl=\\"ed-cand\\"]")).map(el => Number(el.getAttribute("data-t")))')
            if cands:
                cl = j(page, '''() => { const el = document.querySelector('[data-npl="ed-cand"]'); if (!el) return null; el.click(); return { t: Number(el.getAttribute('data-t')), cuts: _npLibEditor.cuts.length, segs: document.querySelectorAll('.npl-edrow').length }; }''')
                page.wait_for_timeout(600)
                cuts_now = j(page, '() => _npLibEditor.cuts.length')
                rows_now = j(page, '() => document.querySelectorAll(".npl-edrow").length')
                if cuts_now == 1 and rows_now == 2:
                    ok('点浅色小旗＝加了一刀（1 切点 / 2 段）')
                else:
                    bad('点小旗加刀不对：cuts=%r rows=%r' % (cuts_now, rows_now))
            else:
                bad('时间轴上没有建议切点小旗可点（仍继续验手动加刀）')
            # 手动在 9 秒加一刀
            j(page, '() => { npLibSeekPlayer(9); return true; }')
            page.click('[data-npl="ed-addcut"]')
            if wait_js(page, '() => _npLibEditor.cuts.length === 2 && document.querySelectorAll(".npl-edrow").length === 3', 8000, 300):
                ok('播放头在 9 秒时「＋在这里切一刀」：2 切点 / 3 段')
            else:
                bad('手动加刀不对：%r' % (j(page, '() => ({c: _npLibEditor.cuts.length, r: document.querySelectorAll(".npl-edrow").length})'),))
            # 选中 9 秒附近那颗刀 → +0.5 → 删
            nine = j(page, '() => { const c = _npLibEditor.cuts.slice().sort((a,b) => Math.abs(a.t-9)-Math.abs(b.t-9))[0]; _npLibEditor.selected = c.t; return c.t; }')
            page.click('[data-npl="ed-nudge"][data-d="0.5"]')
            if wait_js(page, '() => _npLibEditor.cuts.some(c => Math.abs(c.t - 9.5) < 0.06) && _npLibEditor.cuts.length === 2', 8000, 300):
                ok('选中切点后 +0.5 秒：刀从 %s 挪到 9.5' % nine)
            else:
                bad('挪刀不对：%r' % (j(page, '() => _npLibEditor.cuts'),))
            page.click('[data-npl="ed-delcut"]')
            if wait_js(page, '() => _npLibEditor.cuts.length === 1 && document.querySelectorAll(".npl-edrow").length === 2', 8000, 300):
                ok('删这颗刀：回到 1 切点 / 2 段')
            else:
                bad('删刀不对：%r' % (j(page, '() => ({c: _npLibEditor.cuts.length, r: document.querySelectorAll(".npl-edrow").length})'),))

            # ③ 入库前改一段
            page.click('[data-npl="ed-seg-edit"][data-a="0"]')
            page.wait_for_selector('#nplEdSegName', timeout=8000)
            page.fill('#nplEdSegName', '自检·门口')
            page.fill('#nplEdSegDesc', '进门先看玄关和地面，第一段自检用。')
            tag = j(page, '''() => { const b = document.querySelector('.npl-sheet .npl-tagpick [data-tag]'); if (!b) return ''; b.click(); return String(b.getAttribute('data-tag') || ''); }''')
            page.click('#nplEdSegSave')
            if wait_js(page, '() => !document.querySelector("#nplEdSegName")', 8000) and wait_js(page, '() => { const r = Array.from(document.querySelectorAll(".npl-edrow")).find(x => x.getAttribute("data-a") === "0"); return !!r && /自检·门口/.test(r.textContent) && /你改过/.test(r.textContent); }', 8000):
                ok('入库前改段：名字/说明/标签存住，行上标「✎ 你改过」')
            else:
                bad('入库前改段没生效/没标手工改过')

            # ④ 看图模型不可用：状态条如实、AI 不假装看
            bar = j(page, '() => { const b = document.querySelector(".npl-vision-bar"); return b ? String(b.textContent || "") : ""; }')
            if '现在用不了' in bar and '已就绪' not in bar:
                ok('看图模型不可用：状态条如实说，没有假装看懂')
            else:
                bad('看图状态条不对：%r' % (bar,))
            page.click('[data-npl="ed-ai"]')
            if wait_js(page, '() => { const m = document.querySelector(".npl-sheet"); return !!m && /AI 看不了画面/.test(m.textContent || ""); }', 10000):
                ok('点「✨ AI 看一遍」：弹「看不了画面」说明，没有假分段')
                page.click('#nplVOffClose')
            else:
                bad('AI 不可用时没弹说明/或假装出分段')
            cuts_after_ai = j(page, '() => _npLibEditor.cuts.length')
            if cuts_after_ai == 1:
                ok('AI 不可用后刀口没被乱改（还是 1 颗）')
            else:
                bad('AI 不可用却改了刀口：%d' % cuts_after_ai)

            # ⑤ 入库
            page.click('[data-npl="ed-confirm"]')
            if not wait_js(page, '''async (vid) => {
                const cs = (await npClipsRead()).filter(c => c && String(c.videoId) === vid);
                return cs.length === 2 && npLibS().view === 'col';
            }''', 30000, 300, vid1):
                bad('入库没成/没回集合页：%r' % (j(page, '''async (vid) => {
                    const cs = (await npClipsRead()).filter(c => c && String(c.videoId) === vid);
                    return { n: cs.length, view: npLibS().view, errs: [] };
                }''', vid1),))
            else:
                ok('入库了 2 段并回到集合页')
            clips1 = j(page, '''async (vid) => {
                const cs = (await npClipsRead()).filter(c => c && String(c.videoId) === vid).sort((a,b) => Number(a.a)-Number(b.a));
                const vs = await npVideosRead();
                const v = vs.find(x => x && String(x.id) === vid);
                return cs.map(c => ({ id: String(c.id), a: c.a, b: c.b, name: c.name, tags: c.tags, desc: c.desc, ready: npLibReady(c, v), aiSrc: c.aiSrc || '', aiAt: c.aiAt || 0, editedAt: c.editedAt || 0 }));
            }''', vid1)
            if len(clips1) == 2 and clips1[0]['name'] == '自检·门口' and clips1[0]['editedAt'] > 0 and clips1[0]['aiSrc'] == '' and clips1[0]['ready']:
                ok('手工改的那段：名字保住了、标 editedAt、不冒充 AI 认的、✓备好')
            else:
                bad('手工改的段落库不对：%r' % (clips1[:1],))
            if len(clips1) == 2 and clips1[1]['ready'] and clips1[1]['aiSrc'] == '' and '还没认内容' in str(clips1[1]['desc']):
                ok('没被 AI 认的那段：按位置填好三样、✓备好，说明里如实写「还没认内容」')
            else:
                bad('按位置填的段落库不对：%r' % (clips1[1:2],))
            cardtxt = j(page, '() => Array.from(document.querySelectorAll(".npl-segcard")).map(x => String(x.textContent || ""))')
            if any('✎ 改过' in t for t in cardtxt) and any('按位置填的' in t for t in cardtxt):
                ok('段卡徽标分得清：「✎ 改过」和「按位置填的」，没有「✨ AI 认的」')
            else:
                bad('段卡徽标不对：%r' % (cardtxt,))

            # ⑥ 整条当 1 段
            page.click('[data-npl="whole"][data-id="%s"]' % vid2)
            if not wait_js(page, '''async (vid) => {
                const cs = (await npClipsRead()).filter(c => c && String(c.videoId) === vid);
                const vs = await npVideosRead();
                const v = vs.find(x => x && String(x.id) === vid);
                return cs.length === 1 && cs[0].a === 0 && Math.abs(Number(cs[0].b) - Number(v.dur)) < 0.2 && npLibReady(cs[0], v);
            }''', 20000, 300, vid2):
                bad('整条当 1 段入库不对')
            else:
                ok('整条当 1 段：0 – 结尾，三样齐、✓备好')
            clip2 = j(page, '''async (vid) => {
                const c = (await npClipsRead()).find(x => x && String(x.videoId) === vid);
                return c ? String(c.id) : '';
            }''', vid2)

            # ⑦ 集合开关：不传图片给 AI
            page.click('[data-npl="editcol"][data-id="%s"]' % col_id)
            page.wait_for_selector('#nplColNoVision', timeout=8000)
            page.check('#nplColNoVision')
            page.click('#nplColSave')
            if wait_js(page, '''async (cid) => {
                const c = (await npCollectionsRead()).find(x => x && String(x.id) === cid);
                return !!c && !!c.noVision;
            }''', 10000, 300, col_id):
                ok('集合勾上「不传图片给 AI」已存住')
            else:
                bad('「不传图片给 AI」没存住')
            j(page, 'async (id) => { await npLibOpenEditor(id); }', vid2)
            if wait_js(page, '''() => {
                const b = document.querySelector('.npl-vision-bar');
                const ai = document.querySelector('[data-npl="ed-ai"]');
                return !!b && /不传图片/.test(b.textContent || '') && !!ai && ai.disabled;
            }''', 15000):
                ok('不传图片的集合：剪辑视图如实提示，AI 按钮禁用')
            else:
                bad('不传图片的集合：提示或禁用不对')
            page.click('[data-npl="backcol"]')
            page.wait_for_timeout(500)
            page.click('[data-npl="editcol"][data-id="%s"]' % col_id)
            page.wait_for_selector('#nplColNoVision', timeout=8000)
            page.uncheck('#nplColNoVision')
            page.click('#nplColSave')
            if wait_js(page, '''async (cid) => {
                const c = (await npCollectionsRead()).find(x => x && String(x.id) === cid);
                return !!c && !c.noVision;
            }''', 10000, 300, col_id):
                ok('开关关掉也存住了')
            else:
                bad('开关关掉没存住')

            # ⑧ 挑段发案例
            page.click('[data-npl="new-case"]')
            page.wait_for_selector('#nplPickTitle', timeout=8000)
            page.fill('#nplPickTitle', '自检案例·长视频切段')
            page.fill('#nplPickBrief', '自检：两段素材，验挑段、锁段和案例正文。')
            page.check('#nplPickList input[data-clip="%s"]' % clips1[0]['id'])
            page.check('#nplPickList input[data-clip="%s"]' % clip2)
            page.click('#nplPickSave')
            if not wait_js(page, '''async () => {
                const ns = await npNotesAll();
                const n = ns.find(x => x && x.title === '自检案例·长视频切段');
                if (!n) return false;
                const refs = (n.asm && n.asm.libClips) || [];
                return refs.length === 2;
            }''', 30000, 300):
                bad('挑段后笔记没存下 2 段')
                note_id = ''
            else:
                note_id = j(page, '''async () => {
                    const n = (await npNotesAll()).find(x => x && x.title === '自检案例·长视频切段');
                    return n ? String(n.id) : '';
                }''')
                locked = j(page, '''async (nid) => {
                    const cs = await npClipsRead();
                    return cs.filter(c => String(c.usedBy || '') === nid).map(c => String(c.id));
                }''', note_id)
                if len(locked) == 2 and set(locked) == {clips1[0]['id'], clip2}:
                    ok('挑的 2 段已锁给这篇笔记')
                else:
                    bad('段锁定不对：%r' % (locked,))
            if note_id:
                page.wait_for_timeout(1500)
                draft0 = j(page, '''async (id) => { const n = (await npNotesAll()).find(x => x && String(x.id) === id); return n ? String(n.draft || '') : ''; }''', note_id)
                no_art_modal = j(page, '() => !document.getElementById("nplArtText")')
                if draft0 == '' and no_art_modal:
                    ok('案例正文写稿不可达：不弹假正文、不挡挑段（草稿仍空）')
                else:
                    bad('写稿失败路径不对：draft=%r noModal=%r' % (draft0, no_art_modal))

                # 模拟接口成功 → 弹窗 → 改 → 存进草稿
                ok_open = j(page, '''async (id) => {
                    const n = (await npNotesAll()).find(x => x && String(x.id) === id);
                    const refs = (n.asm && n.asm.libClips) || [];
                    const orig = chrome.runtime.sendMessage;
                    chrome.runtime.sendMessage = async (msg) => {
                        if (msg && msg.action === 'genCaseArticle') return { ok: true, text: '自检正文第一段。\\n\\n自检正文第二段。', chars: 20 };
                        return orig.call(chrome.runtime, msg);
                    };
                    try { await npLibCaseArticle(n, refs, '自检背景', '自检工地·长视频'); }
                    finally { chrome.runtime.sendMessage = orig; }
                    return !!document.getElementById('nplArtText');
                }''', note_id)
                if ok_open:
                    ok('案例正文接口成功时：弹出可改的正文弹窗')
                    page.fill('#nplArtText', '自检正文第一段。\n\n自检正文第二段，改过。')
                    page.click('#nplArtSave')
                    if wait_js(page, '''async (id) => {
                        const n = (await npNotesAll()).find(x => x && String(x.id) === id);
                        return !!n && String(n.draft || '').indexOf('改过') >= 0;
                    }''', 10000, 300, note_id):
                        ok('正文存进了这篇的草稿（note.draft）')
                    else:
                        bad('正文没存进草稿')
                else:
                    bad('成功路径没弹出正文弹窗')

                # ⑨ 被用着的段：锁
                j(page, 'async () => { switchMainTab("noteAssets"); return true; }')
                page.wait_for_timeout(800)
                j(page, 'async (vid) => { await npLibOpenEditor(vid); }', vid1)
                if wait_js(page, '() => !!document.querySelector("#nplTl")', 15000):
                    n_before = j(page, 'async () => (await npClipsRead()).length')
                    page.click('[data-npl="ed-confirm"]')
                    page.wait_for_timeout(1200)
                    n_after = j(page, 'async () => (await npClipsRead()).length')
                    if n_after == n_before:
                        ok('有段被笔记用着时，「入库」被拦下（段数没变）')
                    else:
                        bad('被用着还能重切入库：%d → %d' % (n_before, n_after))
                    marks_before = j(page, '''async (vid) => { const v = (await npVideosRead()).find(x => x && String(x.id) === vid); return Number(v.marksAt) || 0; }''', vid1)
                    page.click('[data-npl="ed-recut"]')
                    page.wait_for_timeout(1200)
                    marks_after = j(page, '''async (vid) => { const v = (await npVideosRead()).find(x => x && String(x.id) === vid); return Number(v.marksAt) || 0; }''', vid1)
                    if marks_after == marks_before:
                        ok('有段被用着时，「重新自动分镜」被拦下')
                    else:
                        bad('有段被用着还能重跑分镜')
                    page.click('[data-npl="backcol"]')
                    page.wait_for_timeout(500)
                    n_before2 = j(page, 'async () => (await npClipsRead()).length')
                    j(page, '''(cid) => { const b = document.querySelector('[data-npl="seg-del"][data-id="' + cid + '"]'); if (b) b.click(); return true; }''', clips1[0]['id'])
                    page.wait_for_timeout(1000)
                    n_after2 = j(page, 'async () => (await npClipsRead()).length')
                    if n_after2 == n_before2:
                        ok('被笔记用着的段：删不掉')
                    else:
                        bad('被笔记用着的段被删了')
                else:
                    bad('锁定时没能进剪辑视图')

            # ⑩ 看图模型「已就绪」路径（本地桩，不打真接口）
            page.evaluate('''() => {
                window.__origSend = chrome.runtime.sendMessage;
                chrome.runtime.sendMessage = async (msg) => {
                    const a = msg && msg.action;
                    if (a === 'npVisionStatus') return { ok: true, keyReady: true, active: true, model: 'selfcheck-vision', priceFrame: 0.001 };
                    if (a === 'npVisionSegments') return { ok: true, segments: [
                        { a: 0, b: 4, name: '门口·进门', tags: ['场景空镜'], desc: '进门先看玄关。' },
                        { a: 4, b: 8, name: '客厅·走一圈', tags: ['生产/制作过程'], desc: '客厅走一圈看采光。' },
                        { a: 8, b: 12, name: '地面·收尾', tags: ['完工/成品'], desc: '地面收尾。' }
                    ] };
                    if (a === 'npVisionLabel') return { ok: true, items: (msg.data.segments || []).map(s => ({
                        id: String(s.id), ok: true, name: 'AI认·' + Math.round(Number(s.a) / 2), tags: ['场景空镜'], desc: 'AI 看到的这一段。'
                    })) };
                    return window.__origSend.call(chrome.runtime, msg);
                };
                _npLibVision = null; _npLibVisionQ = null;
                return true;
            }''')
            page.click('[data-npl="import"]')
            page.wait_for_selector('#nplImpFile', timeout=8000)
            page.set_input_files('#nplImpFile', str(VIDEO1))
            if not wait_js(page, '() => /选了 1 条，读得出 1 条/.test((document.getElementById("nplImpMeta")||{}).textContent || "")', 30000):
                bad('AI 路径：单条导入没读出时长')
            page.click('#nplImpSave')
            if wait_js(page, '() => npLibS().view === "editor" && !!document.querySelector("#nplTl")', 20000, 300):
                vid3 = j(page, '() => _npLibEditor ? String(_npLibEditor.videoId) : ""')
                wait_js(page, '() => { const b = document.querySelector(".npl-vision-bar"); return !!b && /已就绪/.test(b.textContent || ""); }', 15000)
                page.click('[data-npl="ed-ai"]')
                if wait_js(page, '() => !!_npLibEditor && _npLibEditor.aiDone && _npLibEditor.cuts.length === 2 && document.querySelectorAll(".npl-edrow").length === 3', 30000, 400):
                    rowtxt = j(page, '() => Array.from(document.querySelectorAll(".npl-edrow")).map(x => String(x.textContent || ""))')
                    if all('认过' in t for t in rowtxt) and any('客厅·走一圈' in t for t in rowtxt):
                        ok('AI 看一遍：分出 2 刀 3 段，段名来自 AI，行上标「✨ 认过」')
                    else:
                        bad('AI 分段的段名/徽标不对：%r' % (rowtxt,))
                else:
                    bad('AI 看一遍没出分段：%r' % (j(page, '() => _npLibEditor ? {ai: _npLibEditor.aiDone, cuts: _npLibEditor.cuts.length} : null'),))
                # 改第一段 → 入库；AI 后续认内容不能覆盖它
                page.click('[data-npl="ed-seg-edit"][data-a="0"]')
                page.wait_for_selector('#nplEdSegName', timeout=8000)
                page.fill('#nplEdSegName', '手工段·别覆盖')
                page.fill('#nplEdSegDesc', '这一段是人工改的，AI 认内容不能覆盖。')
                j(page, '''() => { const b = document.querySelector('.npl-sheet .npl-tagpick [data-tag]'); if (b) b.click(); return true; }''')
                page.click('#nplEdSegSave')
                if wait_js(page, '() => !document.querySelector("#nplEdSegName")', 8000):
                    page.click('[data-npl="ed-confirm"]')
                    if wait_js(page, '''async (vid) => {
                        const cs = (await npClipsRead()).filter(c => c && String(c.videoId) === vid);
                        if (cs.length !== 3) return false;
                        if (typeof _npLibLabeling !== 'undefined' && _npLibLabeling[vid]) return false;
                        return cs.filter(c => c.aiSrc === 'vision').length >= 2;
                    }''', 60000, 500, vid3):
                        cs3 = j(page, '''async (vid) => {
                            const cs = (await npClipsRead()).filter(c => c && String(c.videoId) === vid).sort((a,b) => Number(a.a)-Number(b.a));
                            const vs = await npVideosRead();
                            const v = vs.find(x => x && String(x.id) === vid);
                            return cs.map(c => ({ name: c.name, a: c.a, aiSrc: c.aiSrc || '', aiAt: c.aiAt || 0, editedAt: c.editedAt || 0, ready: npLibReady(c, v) }));
                        }''', vid3)
                        if cs3 and cs3[0]['name'] == '手工段·别覆盖' and cs3[0]['editedAt'] > 0 and cs3[0]['aiSrc'] == '' and all(c['aiSrc'] == 'vision' for c in cs3[1:]) and all(c['ready'] for c in cs3):
                            ok('AI 认段 + 入库：另外 2 段标「✨ AI 认的」，人工改的那段没被 AI 覆盖')
                        else:
                            bad('AI 认段/人工覆盖保护不对：%r' % (cs3,))
                        ctxt = j(page, '() => Array.from(document.querySelectorAll(".npl-segcard")).map(x => String(x.textContent || ""))')
                        if any('手工段·别覆盖' in t and '✎ 改过' in t for t in ctxt) and any('✨ AI 认的' in t for t in ctxt):
                            ok('段卡徽标：人工改的「✎ 改过」、AI 认的「✨ AI 认的」')
                        else:
                            bad('AI 段卡徽标不对：%r' % (ctxt,))
                    else:
                        bad('AI 认内容没跑完/没落到段上')
                else:
                    bad('AI 路径：改段没存住')
            else:
                bad('AI 路径：单条导入后没进剪辑视图')
            page.evaluate('() => { if (window.__origSend) chrome.runtime.sendMessage = window.__origSend; return true; }')

            # 收尾
            if errs:
                bad('页内 JS 异常 %d 条：%r' % (len(errs), errs[:5]))
            else:
                ok('全程没有页内 JS 异常')
            br.close()
    finally:
        try: srv.terminate()
        except Exception: pass
        logf.close()
    print('── 结果：%s（失败 %d）──' % ('全过' if fails == 0 else '有失败', fails), flush=True)
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
