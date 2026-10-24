# -*- coding: utf-8 -*-
"""切片台 + 素材库 · 真实 web 自检（2026-10-24 平铺改版）

验的是 web/ 的「✂ 切片台 / 📚 素材库」两块新流程：
  ① 左栏两个平级入口，各自打开自己的页面；
  ② 导入一批不问文件夹、不自动建段；批次卡能看出条数 / 已切 / 段数 / 去哪个文件夹；
  ③ 第一次入库弹文件夹选择：默认这批同名；新建后这批后续整条入库自动沿用；
  ④ 归档文件夹不能作为入库目标（在文件夹设置里改回「在用」）；
  ⑤ 这批切好的散片摊在批次页底下（每张标出自哪条原片）；原片留在批次里，段删光回到「待切」；
  ⑥ 素材库是一整页平铺：8 颗标签当筛子、文件夹只在下拉里当筛子，不摞文件夹卡；
     段卡没有文件夹字、有勾选框；勾几段就能一起发案例；
  ⑦ 新建空文件夹可以空着；同名文件夹不建两个；文件夹设置里能删；
  ⑧ 发案例按勾中的段预选、挑段、锁段；锁住的段不能重切 / 删除；
  ⑨ 旧数据入口和「以前的（没分批次）」都在；老原片切段后原集合不变；全程无页内报错；
  ⑩ 老素材集合能删：空的可删、段被笔记占着的拦下。

跑法：python3 -X utf8 scripts/dev/check_material_bench_lib_web.py
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
PORT = 8924
BASE = 'http://127.0.0.1:%d' % PORT
WORK = REPO / 'tmp' / 'material-bench-lib-web-check'
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


def ca(page, sel):
    """点素材库那页里的按钮（两个入口的 DOM 都在，必须按容器限定）"""
    page.click('#noteAssetsContent ' + sel)


def cb(page, sel):
    """点切片台那页里的按钮"""
    page.click('#noteBenchContent ' + sel)


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


def search(page, text):
    page.evaluate('''(v) => {
        const el = document.getElementById('nplLibQ');
        if (!el) return;
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }''', text)


def main():
    print('── 切片台 + 素材库 · 真实 web 自检 ──', flush=True)
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
        bad('服务器没起来（看 tmp/material-bench-lib-web-check/server.log）')
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

            # ① 左栏一个「素材」入口，页内两签（切片台 / 素材库）
            if j(page, '() => !!document.getElementById("tabNoteBench") && !document.getElementById("tabNoteAssets")'):
                ok('左栏只有一个「素材」入口（素材库并进页内）')
            else:
                bad('左栏入口不对：素材库应并进「素材」，不再单列')
            page.evaluate('() => switchMainTab("noteBench")')
            if not wait_js(page, '() => /切片台/.test((document.querySelector("#noteBenchContent .npl-title")||{}).textContent || "")', 20000):
                bad('切片台页没画出来')
                br.close()
                return
            if j(page, '() => Array.from(document.querySelectorAll("#noteBenchContent .npl-tab")).map(x => x.textContent.trim()).join("|")') == '✂ 切片台|📚 素材库':
                ok('切片台页内两签：✂ 切片台 / 📚 素材库')
            else:
                bad('页内两签没画出来：%r' % (j(page, '() => Array.from(document.querySelectorAll("#noteBenchContent .npl-tab")).map(x => x.textContent.trim())'),))
            ok('切片台页画出来了')
            page.evaluate('() => switchMainTab("noteAssets")')
            if not wait_js(page, '() => /素材库/.test((document.querySelector("#noteAssetsContent .npl-title")||{}).textContent || "")', 20000):
                bad('素材库页没画出来')
                br.close()
                return
            ok('素材库页画出来了')

            # ② 导入一批：不问文件夹、不自动建段
            page.evaluate('() => switchMainTab("noteBench")')
            page.wait_for_timeout(500)
            cb(page, '[data-npl="import-batch"]')
            page.wait_for_selector('#nplBatName', timeout=8000)
            today = j(page, '() => npLibToday()')
            defname = j(page, '() => String((document.getElementById("nplBatName")||{}).value || "")')
            if defname == today:
                ok('导入框：批次名默认今天（%s），不用先选文件夹' % today)
            else:
                bad('批次名默认不是今天：%r' % (defname,))
            page.fill('#nplBatName', '自检工地·阳光小区')
            page.set_input_files('#nplBatFile', [str(VIDEO1), str(VIDEO2)])
            if not wait_js(page, '() => /选了 2 条，读得出 2 条/.test((document.getElementById("nplBatMeta")||{}).textContent || "")', 40000):
                bad('多选导入没把两条时长都读出来')
                br.close()
                return
            ok('多选导入：两条视频都读出了时长')
            page.click('#nplBatSave')
            if not wait_js(page, '''async () => {
                const bs = await npBatchesRead();
                const vs = await npVideosRead();
                return bs.length === 1 && vs.filter(v => v && v.batchId === bs[0].id).length === 2 && npLibS().view === 'batch';
            }''', 30000, 300):
                bad('导入后没落到这一批：%r' % (j(page, '''async () => ({ bs: await npBatchesRead(), vs: (await npVideosRead()).length, view: npLibS().view })'''),))
                br.close()
                return
            batch = j(page, '''async () => {
                const b = (await npBatchesRead())[0];
                const vs = (await npVideosRead()).filter(v => v && v.batchId === b.id).sort((a,c) => String(a.name).localeCompare(String(c.name)));
                const cs = await npClipsRead();
                const ids = new Set(vs.map(v => String(v.id)));
                return { id: String(b.id), name: b.name, status: b.status, folderId: b.folderId || '',
                         videos: vs.map(v => ({ id: String(v.id), name: v.name, col: v.col || '', dur: v.dur })),
                         clips: cs.filter(c => c && ids.has(String(c.videoId))).length, view: npLibS().view };
            }''')
            if batch['videos'] and len(batch['videos']) == 2 and batch['clips'] == 0 and batch['folderId'] == '' and batch['status'] == 'active':
                ok('导入后：2 条原片、0 段、批次还没定文件夹（不自动建段）')
            else:
                bad('导入后状态不对：%r' % (batch,))
            vid1 = batch['videos'][0]['id']
            vid2 = batch['videos'][1]['id']
            if batch['videos'][0]['col'] == '' and batch['videos'][1]['col'] == '':
                ok('原片先只属于批次，没被塞进任何文件夹')
            else:
                bad('原片被提前塞进文件夹：%r' % (batch['videos'],))
            if j(page, '() => document.querySelectorAll(".npl-vidcard").length') == 2 and j(page, '() => document.querySelectorAll(".npl-segcard").length') == 0:
                ok('批次页画出 2 张原片卡、0 张段卡')
            else:
                bad('批次页卡片数量不对')

            # ①b 切片台首页＝表格：一行一批、整行可点、左上角返回；没定文件夹的照常列「还没定」
            cb(page, '[data-npl="backbench"]')
            if wait_js(page, '() => !!document.querySelector("#noteBenchContent .npl-brow[data-npl=\\"openbatch\\"]")', 10000):
                home = j(page, '''() => {
                    const t = document.getElementById('noteBenchContent');
                    const rows = t.querySelectorAll('.npl-brow:not(.head)').length;
                    const head = Array.from(t.querySelectorAll('.npl-brow.head .npl-cell')).map(x => x.innerText.trim());
                    return { rows, head, txt: t.innerText };
                }''')
                if home['rows'] == 1 and '批次' in home['head'] and '切完没' in home['head']:
                    ok('切片台首页是一张表：一行一批（1 行），表头有批次 / 切完没')
                    if '开始切' in home['txt'] and '还差 2 条' in home['txt']:
                        ok('没切的一批：按钮是「开始切」、切完没那格写「还差 2 条」')
                    else:
                        bad('没切的一批文案不对：%r' % (home['txt'][:400],))
                else:
                    bad('切片台首页表格不对：%r' % (home,))
                if '还没定' in home['txt']:
                    ok('没定文件夹的批次照常列，文件夹那格写「还没定」')
                else:
                    bad('没定文件夹的批次没写「还没定」：%r' % (home['txt'][:300],))
                # 列表滚下去再点行：新页必须回到顶部，返回按钮不能停在屏幕外
                j(page, '''() => { const t = document.getElementById('noteBenchContent'); t.style.paddingTop = '900px'; t.scrollTop = 600; return t.scrollTop; }''')
                j(page, '''() => document.querySelector('.npl-brow[data-npl="openbatch"]').click()''')
                if wait_js(page, '() => npLibS().view === "batch" && !!document.querySelector("#noteBenchContent [data-npl=\\"backbench\\"]") && document.getElementById("noteBenchContent").scrollTop === 0', 15000):
                    ok('点那一行进这一批，左上角有「← 返回切片台」')
                    glued = j(page, '''() => {
                        const t = document.getElementById('noteBenchContent');
                        const b = t.querySelector('[data-npl="backbench"]');
                        t.style.paddingTop = '';
                        const r = b.getBoundingClientRect();
                        return { st: t.scrollTop, vis: r.top >= 0 && r.bottom <= innerHeight };
                    }''')
                    if glued['st'] == 0 and glued['vis']:
                        ok('列表滚下去点行，进来先回到顶部、返回按钮在屏幕里')
                    else:
                        bad('进来停在半截、返回按钮不在屏幕里：%r' % (glued,))
                else:
                    bad('点行没进批次页 / 没有返回按钮 / 没回到顶部：%r' % (j(page, '() => ({v: npLibS().view, st: document.getElementById("noteBenchContent").scrollTop, back: !!document.querySelector("#noteBenchContent [data-npl=\\"backbench\\"]")})'),))
            else:
                bad('切片台首页没画出批次行')

            # 本机建议切点（只铺旗，不建段）
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

            # ③ 切第一段：手动加一刀，改名字 / 标签 / 说明
            page.evaluate('async (id) => { await npLibOpenEditor(id); }', vid1)
            if not wait_js(page, '() => !!document.querySelector("#nplTl") && !!document.querySelector(".npl-ed-grid")', 20000):
                bad('剪辑视图没画出来')
                br.close()
                return
            ok('剪辑视图画出来了（时间轴 + 段面板）')
            page.evaluate('() => { npLibSeekPlayer(9); return true; }')
            cb(page, '[data-npl="ed-addcut"]')
            if not wait_js(page, '() => _npLibEditor.cuts.length === 1 && document.querySelectorAll(".npl-edrow").length === 2', 8000, 300):
                bad('手动加刀不对：%r' % (j(page, '() => ({c: _npLibEditor.cuts.length, r: document.querySelectorAll(".npl-edrow").length})'),))
            else:
                ok('播放头在 9 秒加一刀：1 切点 / 2 段')

            # ③-0 两签来回：切到素材库再切回来，还是这条的剪辑视图，刀口 / 播放头都在
            page.evaluate('() => { npLibSeekPlayer(9); return true; }')
            cb(page, '[data-npl="page-tab"][data-tab="lib"]')
            if not wait_js(page, '() => npLibS().surface === "assets" && npLibS().view === "lib" && !!document.querySelector("#noteAssetsContent .npl-title") && !(document.getElementById("noteBenchContent")||{getClientRects:()=>[]}).getClientRects().length', 20000):
                bad('点「📚 素材库」签没切过去')
            else:
                ok('点「📚 素材库」签切到素材库，切片台那页收起来')
            ca(page, '[data-npl="page-tab"][data-tab="bench"]')
            if not wait_js(page, '''() => npLibS().surface === "bench" && npLibS().view === "editor"
                && !!document.querySelector("#noteBenchContent #nplTl")
                && !!_npLibEditor && _npLibEditor.cuts.length === 1 && Math.abs((Number(_npLibEditor.t) || 0) - 9) < 0.6''', 20000):
                bad('切回切片台没回到刚才那条剪辑视图：%r' % (j(page, '() => ({ s: npLibS().surface, v: npLibS().view, cuts: _npLibEditor && _npLibEditor.cuts.length, t: _npLibEditor && _npLibEditor.t })'),))
            else:
                ok('切回切片台：还在刚才那条的剪辑视图，刀口和播放头都没丢')
            cb(page, '[data-npl="ed-seg-edit"][data-a="0"]')
            page.wait_for_selector('#nplEdSegName', timeout=8000)
            page.fill('#nplEdSegName', '自检·门口')
            page.fill('#nplEdSegDesc', '进门先看玄关和地面，第一段自检用。')
            tag = j(page, '''() => { const b = document.querySelector('.npl-sheet .npl-tagpick [data-tag]'); if (!b) return ''; b.click(); return String(b.getAttribute('data-tag') || ''); }''')
            page.click('#nplEdSegSave')
            if wait_js(page, '() => !document.querySelector("#nplEdSegName")', 8000) and wait_js(page, '() => { const r = Array.from(document.querySelectorAll(".npl-edrow")).find(x => x.getAttribute("data-a") === "0"); return !!r && /自检·门口/.test(r.textContent) && /你改过/.test(r.textContent); }', 8000):
                ok('入库前改段：名字/说明/标签存住，行上标「✎ 你改过」')
            else:
                bad('入库前改段没生效/没标手工改过')

            # ③ 第一次入库 → 弹文件夹选择，默认这批同名
            cb(page, '[data-npl="ed-confirm"]')
            if not wait_js(page, '() => !!document.getElementById("nplFoldAskName")', 15000):
                bad('第一次入库没弹文件夹选择')
                br.close()
                return
            ok('第一次入库弹出「放哪个素材文件夹」')
            fold_default = j(page, '() => String((document.getElementById("nplFoldAskName")||{}).value || "")')
            fold_notice = j(page, '() => String((document.getElementById("nplFoldAskNotice")||{}).textContent || "")')
            if fold_default == '自检工地·阳光小区' and '会新建文件夹' in fold_notice:
                ok('文件夹默认这批同名，写明会新建')
            else:
                bad('文件夹默认/提示不对：%r / %r' % (fold_default, fold_notice))
            page.click('#nplFoldAskSave')
            if not wait_js(page, '''async (bid) => {
                const b = (await npBatchesRead()).find(x => x && String(x.id) === bid);
                const vs = await npVideosRead();
                const cs = await npClipsRead();
                const ids = new Set(vs.filter(v => v && String(v.batchId) === bid).map(v => String(v.id)));
                return !!b && b.folderId && cs.filter(c => c && ids.has(String(c.videoId))).length === 2 && npLibS().view === 'batch';
            }''', 30000, 300, batch['id']):
                bad('入库后批次/段不对：%r' % (j(page, '''async (bid) => {
                    const b = (await npBatchesRead()).find(x => x && String(x.id) === bid);
                    return { b: b && { folderId: b.folderId }, cs: (await npClipsRead()).length, view: npLibS().view };
                }''', batch['id']),))
                br.close()
                return
            ok('入库 2 段，回到这一批')
            after = j(page, '''async (bid) => {
                const b = (await npBatchesRead()).find(x => x && String(x.id) === bid);
                const f = (await npCollectionsRead()).find(c => c && c.folder && String(c.id) === String(b.folderId));
                const vs = (await npVideosRead()).filter(v => v && String(v.batchId) === bid);
                const cs = await npClipsRead();
                const ids = new Set(vs.map(v => String(v.id)));
                return {
                    folder: f ? { id: String(f.id), name: f.name, folder: !!f.folder, status: f.status } : null,
                    vcols: vs.map(v => String(v.col || '')),
                    clips: cs.filter(c => c && ids.has(String(c.videoId))).map(c => ({ id: String(c.id), name: c.name, tags: c.tags, desc: c.desc, col: String(c.col || ''), ready: npLibReady(c, vs.find(v => String(v.id) === String(c.videoId))) })),
                    view: npLibS().view,
                };
            }''', batch['id'])
            folder_id = after['folder']['id'] if after['folder'] else ''
            if after['folder'] and after['folder']['name'] == '自检工地·阳光小区' and after['folder']['folder'] and after['folder']['status'] == '在用':
                ok('同名新文件夹建好了（folder 标记、在用）')
            else:
                bad('文件夹记录不对：%r' % (after['folder'],))
            if folder_id and all(c == folder_id for c in after['vcols']):
                ok('这批两条原片都记到了这个文件夹（后续切段自动沿用）')
            else:
                bad('原片文件夹归属不对：%r' % (after['vcols'],))
            if len(after['clips']) == 2 and after['clips'][0]['name'] == '自检·门口' and after['clips'][0]['col'] == folder_id and after['clips'][0]['ready'] and after['clips'][0]['tags'] and '玄关' in after['clips'][0]['desc']:
                ok('手工改的段：名字/标签/说明保住，进了文件夹、✓备好')
            else:
                bad('手工段入库后不对：%r' % (after['clips'],))
            batch_txt = j(page, '() => String((document.querySelector("#noteBenchContent")||{}).textContent || "")')
            if '自检工地·阳光小区' in batch_txt and '已切 1/2 条' in batch_txt and '切出 2 段' in batch_txt and '文件夹设置' in batch_txt:
                ok('批次页看得出：已切 1/2 条、切出 2 段、去哪个文件夹')
            else:
                bad('批次页统计/文件夹展示不对：%r' % (batch_txt[:300],))
            # 10-23 改版：这一批切好的散片就摊在批次页底下（原先写的是「切片台不列段」）
            pile = j(page, '''() => ({
                head: String((document.querySelector("#noteBenchContent .npl-pilehead")||{}).textContent || ""),
                cards: document.querySelectorAll("#noteBenchContent .npl-segcard").length,
                marked: Array.from(document.querySelectorAll("#noteBenchContent .npl-segcard")).every(x => /出自/.test(x.textContent || ""))
            })''')
            if pile['cards'] == 2 and '2 段' in pile['head'] and pile['marked']:
                ok('批次页底下摊开这批的散片：2 张段卡、每张标了出自哪条原片')
            else:
                bad('批次页的散片块不对：%r' % (pile,))

            # ④ 素材库：一整页平铺（没有文件夹卡 / 文件夹页）
            page.evaluate('() => switchMainTab("noteAssets")')
            if not wait_js(page, '() => document.querySelectorAll("#noteAssetsContent .npl-libgrid .npl-segcard").length === 2', 20000):
                bad('素材库没平铺出 2 张段卡：%r' % (j(page, '() => ({g: document.querySelectorAll("#noteAssetsContent .npl-libgrid .npl-segcard").length, t: String((document.querySelector("#noteAssetsContent")||{}).textContent||"").slice(0,300)})'),))
                br.close()
                return
            ok('素材库平铺出 2 段（一大页，不按文件夹摞）')
            if j(page, '() => document.querySelectorAll("#noteAssetsContent .npl-foldercard").length') == 0:
                ok('素材库不再画文件夹卡')
            else:
                bad('素材库还有文件夹卡')
            chips = j(page, '() => Array.from(document.querySelectorAll("#noteAssetsContent .npl-tchip")).map(x => ({ t: String(x.getAttribute("data-tag") || ""), n: String((x.querySelector("b")||{}).textContent || "") }))')
            if len(chips) == 8:
                ok('标签筛只剩 8 颗')
            else:
                bad('标签筛不是 8 颗：%r' % (chips,))
            if tag and any(c['t'] == tag and c['n'] == '1' for c in chips):
                ok('标签「%s」计数 1' % tag)
            else:
                bad('标签计数不对：%r' % (chips,))
            fsel = j(page, '() => Array.from((document.getElementById("nplLibFolder")||{}).options || []).map(x => String(x.value))')
            if folder_id in fsel and '' in fsel:
                ok('文件夹退到下拉里当筛子（全部 + 这个文件夹）')
            else:
                bad('文件夹下拉不对：%r' % (fsel,))
            stxt = j(page, '() => String((document.querySelector("#noteAssetsContent .npl-libgrid .npl-segcard")||{}).textContent || "")')
            if stxt.strip() and '自检工地·阳光小区' not in stxt:
                ok('段卡不再写文件夹名（文件夹只当筛子）')
            else:
                bad('段卡还在写文件夹名 / 空白：%r' % (stxt,))
            if j(page, '() => document.querySelectorAll("#noteAssetsContent .npl-libgrid .npl-libpick").length') == 2:
                ok('每张段卡都有勾选框（勾几段一起发案例）')
            else:
                bad('段卡勾选框数量不对')
            # 批次卡上的「📚 看这批的段」→ 平铺页按这个文件夹筛
            page.evaluate('() => switchMainTab("noteBench")')
            page.wait_for_timeout(400)
            cb(page, '[data-npl="backbench"]')
            if wait_js(page, '() => !!document.querySelector(\'#noteBenchContent [data-npl="lib-goto"][data-id="%s"]\')' % folder_id, 10000):
                cb(page, '[data-npl="lib-goto"][data-id="%s"]' % folder_id)
                if wait_js(page, '() => npLibS().surface === "assets" && npLibS().view === "lib" && String(npLibS().libFolder) === "%s" && String((document.getElementById("nplLibFolder")||{}).value) === "%s"' % (folder_id, folder_id), 15000):
                    ok('批次卡「📚 看这批的段」→ 素材库按这个文件夹筛')
                else:
                    bad('批次卡去素材库没按文件夹筛：%r' % (j(page, '() => ({s: npLibS().surface, v: npLibS().view, f: npLibS().libFolder, sel: (document.getElementById("nplLibFolder")||{}).value})'),))
            else:
                bad('批次卡上没有「看这批的段」')

            # ⑤ 素材库搜索 / 标签筛 / 勾选
            page.evaluate('() => switchMainTab("noteAssets")')
            page.wait_for_timeout(500)
            ca(page, '[data-npl="lib-clear"]')
            page.wait_for_timeout(400)
            search(page, '自检·门口')
            if wait_js(page, '() => document.querySelectorAll("#noteAssetsContent .npl-libgrid .npl-segcard").length === 1', 10000):
                stxt = j(page, '() => String((document.querySelector("#noteAssetsContent .npl-libgrid .npl-segcard")||{}).textContent || "")')
                if '自检·门口' in stxt:
                    ok('按名字搜到 1 段')
                else:
                    bad('搜到的段卡不对：%r' % (stxt,))
            else:
                bad('按名字搜结果不对：%r' % (j(page, '() => document.querySelectorAll("#noteAssetsContent .npl-libgrid .npl-segcard").length'),))
            search(page, '玄关')
            if wait_js(page, '() => document.querySelectorAll("#noteAssetsContent .npl-libgrid .npl-segcard").length === 1', 10000):
                ok('按说明里的词（玄关）也能搜到')
            else:
                bad('按说明搜不到')
            ca(page, '[data-npl="lib-clear"]')
            page.wait_for_timeout(500)
            if tag:
                ca(page, '[data-npl="lib-tag"][data-tag="%s"]' % tag.replace('"', '\\"'))
                if wait_js(page, '() => document.querySelectorAll("#noteAssetsContent .npl-libgrid .npl-segcard").length === 1', 10000):
                    ok('按标签「%s」筛到 1 段' % tag)
                else:
                    bad('按标签筛不到')
                ca(page, '[data-npl="lib-clear"]')
                page.wait_for_timeout(400)
            else:
                bad('段编辑时没拿到标签，标签搜索没验到')
            # 文件夹下拉：选这个文件夹 2 段；全都在文件夹里，就没有「没归文件夹」这一项
            page.select_option('#nplLibFolder', folder_id)
            page.wait_for_timeout(500)
            if j(page, '() => document.querySelectorAll("#noteAssetsContent .npl-libgrid .npl-segcard").length') == 2:
                ok('文件夹下拉选这个文件夹：2 段')
            else:
                bad('文件夹下拉筛这个文件夹不对')
            if j(page, '() => Array.from((document.getElementById("nplLibFolder")||{}).options || []).some(x => String(x.value) === "__none")') is False:
                ok('全在文件夹里时，下拉不出现「没归文件夹」')
            else:
                bad('不该出现「没归文件夹」')
            page.select_option('#nplLibFolder', '')
            page.wait_for_timeout(500)
            if j(page, '() => document.querySelectorAll("#noteAssetsContent .npl-libgrid .npl-segcard").length') == 2:
                ok('文件夹下拉切回全部：2 段')
            else:
                bad('文件夹下拉切回全部不对')
            # 勾一段：底下的选择条出来
            page.check('#noteAssetsContent .npl-libgrid .npl-libpick[data-npl-pick="%s"]' % after['clips'][0]['id'])
            if wait_js(page, '() => { const b = document.querySelector("#noteAssetsContent .npl-selbar"); return !!b && /已选 1 段/.test(b.textContent || "") && /用选中的 1 段发案例/.test(b.textContent || ""); }', 8000):
                ok('勾一段 → 底部选择条：已选 1 段（1 段备好）')
            else:
                bad('勾选后选择条不对：%r' % (j(page, '() => String((document.querySelector("#noteAssetsContent .npl-selbar")||{}).textContent || "")'),))
            ca(page, '[data-npl="lib-sel-clear"]')
            if wait_js(page, '() => !document.querySelector("#noteAssetsContent .npl-selbar")', 8000):
                ok('清空选择后选择条收起')
            else:
                bad('清空选择没收起')
            # 照片也平铺进来（带「照片」标、不参与勾选发案例）
            j(page, '''async () => {
                const cs = await npClipsRead();
                cs.push({ id: 'clipPhotoCheck', name: '自检·照片', imgOnly: true, thumb: '', src: 'selfcheck.jpg', col: '', tags: ['现场/场景'], desc: '自检照片', at: Date.now() });
                await npClipsWrite(cs);
                await npLibRender(document.getElementById('noteAssetsContent'));
                return true;
            }''')
            if wait_js(page, '''() => {
                const c = document.querySelector('#noteAssetsContent .npl-photocard');
                return !!c && /照片/.test(c.textContent || "") && !c.querySelector('.npl-libpick');
            }''', 10000):
                ok('照片也在同一页平铺：标「照片」、没有勾选框')
            else:
                bad('照片卡不对：%r' % (j(page, '() => ({ n: document.querySelectorAll("#noteAssetsContent .npl-photocard").length, t: String((document.querySelector("#noteAssetsContent .npl-photocard")||{}).textContent||"") })'),))
            ca(page, '[data-npl="seg-del"][data-id="clipPhotoCheck"]')
            if wait_js(page, '() => !document.querySelector("#noteAssetsContent .npl-photocard")', 10000):
                ok('照片能删（只删库里的小图记录）')
            else:
                bad('照片没删掉')

            # ⑥ 新建空文件夹：可以空着；同名不建两个
            ca(page, '[data-npl="lib-new-folder"]')
            page.wait_for_selector('#nplFoldName', timeout=8000)
            page.fill('#nplFoldName', '自检·空文件夹')
            page.click('#nplFoldSave')
            if not wait_js(page, '''async () => {
                const cs = await npCollectionsRead();
                const f = cs.find(c => c && c.folder && c.name === '自检·空文件夹');
                const vs = await npVideosRead();
                const st = npLibS();
                return !!f && vs.length === 2 && st.view === 'lib' && String(st.libFolder) === String(f.id)
                    && document.querySelectorAll("#noteAssetsContent .npl-libgrid .npl-segcard").length === 0;
            }''', 15000, 300):
                bad('新建空文件夹不对：%r' % (j(page, '''async () => ({ cs: (await npCollectionsRead()).filter(c => c && c.folder).map(c => ({name:c.name,folder:c.folder})), vs: (await npVideosRead()).length, view: npLibS().view, f: npLibS().libFolder })'''),))
            else:
                ok('新建空文件夹：空着，没有塞原片，落回平铺页并按它筛（0 段）')
            ca(page, '[data-npl="lib-clear"]')
            page.wait_for_timeout(500)
            if wait_js(page, '() => document.querySelectorAll("#noteAssetsContent .npl-libgrid .npl-segcard").length === 2', 10000):
                ok('清空筛选：2 段还在（空文件夹不影响段）')
            else:
                bad('清空筛选后段数不对')
            if wait_js(page, '() => Array.from((document.getElementById("nplLibFolder")||{}).options || []).some(x => /自检·空文件夹/.test(x.textContent || ""))', 8000):
                ok('空文件夹出现在文件夹下拉里')
            else:
                bad('空文件夹没进下拉')
            ca(page, '[data-npl="lib-new-folder"]')
            page.wait_for_selector('#nplFoldName', timeout=8000)
            page.fill('#nplFoldName', '自检·空文件夹')
            page.click('#nplFoldSave')
            if wait_js(page, '() => /同名文件夹/.test((document.getElementById("nplFoldErr")||{}).textContent || "")', 8000):
                ok('同名文件夹：提示换名，不建两个')
            else:
                bad('同名文件夹没拦住')
            page.click('#nplFoldCancel')
            page.wait_for_timeout(300)

            # ⑦ 归档文件夹不能作为入库目标（文件夹设置里改状态）
            page.evaluate('(fid) => { npLibOpenFolderEditor(fid); }', folder_id)
            page.wait_for_selector('#nplFoldStatus', timeout=8000)
            page.select_option('#nplFoldStatus', '归档')
            page.click('#nplFoldSave')
            if wait_js(page, '''async (fid) => {
                const f = (await npCollectionsRead()).find(c => c && String(c.id) === fid);
                return !!f && f.status === '归档';
            }''', 10000, 300, folder_id):
                ok('文件夹归档存住了')
            else:
                bad('文件夹归档没存住')
            page.evaluate('async (vid) => { await npLibOpenEditor(vid); }', vid2)
            if wait_js(page, '() => !!document.querySelector("#nplTl")', 15000):
                n0 = j(page, 'async () => (await npClipsRead()).length')
                ca(page, '[data-npl="ed-confirm"]')
                page.wait_for_timeout(1200)
                n1 = j(page, 'async () => (await npClipsRead()).length')
                if n1 == n0:
                    ok('归档文件夹：入库被拦下，段数没变')
                else:
                    bad('归档文件夹还能入库：%d → %d' % (n0, n1))
                ca(page, '[data-npl="ed-cancel"]')
                page.wait_for_timeout(500)
            else:
                bad('归档路径没进剪辑视图')
            page.evaluate('(fid) => { npLibOpenFolderEditor(fid); }', folder_id)
            page.wait_for_selector('#nplFoldStatus', timeout=8000)
            page.select_option('#nplFoldStatus', '在用')
            page.click('#nplFoldSave')
            if wait_js(page, '''async (fid) => {
                const f = (await npCollectionsRead()).find(c => c && String(c.id) === fid);
                return !!f && f.status === '在用';
            }''', 10000, 300, folder_id):
                ok('文件夹恢复了')
            else:
                bad('文件夹没恢复')

            # 整条入库（不再问文件夹）
            page.evaluate('async (bid) => { npLibS().surface = "bench"; npLibS().view = "batch"; npLibS().batchId = bid; await switchMainTab("noteBench"); }', batch['id'])
            page.wait_for_timeout(800)
            if not wait_js(page, '''(vid) => !!document.querySelector('[data-npl="whole"][data-id="' + vid + '"]')''', 10000, 300, vid2):
                bad('整条入库按钮不在')
            else:
                cb(page, '[data-npl="whole"][data-id="%s"]' % vid2)
                if not wait_js(page, '''async (vid) => {
                    const cs = (await npClipsRead()).filter(c => c && String(c.videoId) === vid);
                    const vs = await npVideosRead();
                    const v = vs.find(x => x && String(x.id) === vid);
                    return cs.length === 1 && cs[0].a === 0 && Math.abs(Number(cs[0].b) - Number(v.dur)) < 0.2 && npLibReady(cs[0], v) && !document.getElementById('nplFoldAskName');
                }''', 20000, 300, vid2):
                    bad('整条入库不对/又弹了文件夹选择：%r' % (j(page, '''async (vid) => {
                        const cs = (await npClipsRead()).filter(c => c && String(c.videoId) === vid);
                        return { cs: cs.map(c => ({a:c.a,b:c.b,col:c.col})), modal: !!document.getElementById('nplFoldAskName') };
                    }''', vid2),))
                else:
                    ok('整条当 1 段入库：没再问文件夹（这批自动沿用）')
            clip2 = j(page, '''async (vid) => {
                const c = (await npClipsRead()).find(x => x && String(x.videoId) === vid);
                return c ? String(c.id) : '';
            }''', vid2)
            # 整条入库的段也进了同一个文件夹
            in_same = j(page, '''async (fid) => {
                const c = (await npClipsRead()).find(x => x && String(x.videoId) === "%s");
                return !!c && String(c.col) === String(fid);
            }''' % vid2, folder_id)
            if in_same:
                ok('整条入库的段进了这个批次已定的文件夹')
            else:
                bad('整条入库的段没进文件夹')

            # ⑧ 段全删 → 原片回「待切」
            page.evaluate('''async () => { const st = npLibS(); st.surface = 'assets'; st.view = 'lib'; st.libFolder = ''; st.q = ''; st.tags = []; st.noTag = false; await switchMainTab("noteAssets"); }''')
            page.wait_for_timeout(500)
            # 限定到素材库容器：批次页底下的散片卡也有同名按钮（那份是隐藏的那页）
            page.wait_for_selector('#noteAssetsContent [data-npl="seg-del"][data-id="%s"]' % clip2, timeout=8000)
            ca(page, '[data-npl="seg-del"][data-id="%s"]' % clip2)
            page.wait_for_timeout(1200)
            left = j(page, '''async (vid) => (await npClipsRead()).filter(c => c && String(c.videoId) === vid).length''', vid2)
            if left == 0:
                ok('段删光：这条视频的段为 0')
            else:
                bad('删段没删干净：%d' % left)
            page.evaluate('async (bid) => { npLibS().surface = "bench"; npLibS().view = "batch"; npLibS().batchId = bid; await switchMainTab("noteBench"); }', batch['id'])
            page.wait_for_timeout(800)
            v2txt = j(page, '''() => { const cards = Array.from(document.querySelectorAll("#noteBenchContent .npl-vidcard")); const c = cards.find(x => (x.textContent||"").indexOf("check-short-2shots") >= 0); return c ? String(c.textContent||"") : ""; }''')
            if '待切段' in v2txt and '✂ 切段' in v2txt:
                ok('段删光后：原片回到「待切段」，按钮是「✂ 切段」')
            else:
                bad('段删光后原片没回待切：%r' % (v2txt,))
            # 再整条入库回来，给后面挑段用
            cb(page, '[data-npl="whole"][data-id="%s"]' % vid2)
            if not wait_js(page, '''async (vid) => (await npClipsRead()).filter(c => c && String(c.videoId) === vid).length === 1''', 20000, 300, vid2):
                bad('重新整条入库失败')
                br.close()
                return
            clip2 = j(page, '''async (vid) => { const c = (await npClipsRead()).find(x => x && String(x.videoId) === vid); return c ? String(c.id) : ''; }''', vid2)
            ok('重新整条入库成功（仍自动进同一个文件夹）')

            # ⑨ 这批整理完
            cb(page, '[data-npl="finish-batch"][data-id="%s"]' % batch['id'])
            if wait_js(page, '''async (bid) => {
                const b = (await npBatchesRead()).find(x => x && String(x.id) === bid);
                return !!b && b.status === 'done';
            }''', 10000, 300, batch['id']):
                ok('「这批整理完了」：批次移到已整理')
            else:
                bad('批次没标已整理')
            if wait_js(page, '() => /已整理/.test((document.querySelector("#noteBenchContent")||{}).textContent || "")', 10000, 300):
                pass
            else:
                bad('批次页没标「已整理」')
            cb(page, '[data-npl="backbench"]')
            if wait_js(page, '() => { const t = String((document.querySelector("#noteBenchContent")||{}).textContent || ""); return /已整理/.test(t) && /自检工地·阳光小区/.test(t); }', 10000, 300):
                ok('切片台出现「已整理」分组，批次卡还在')
            else:
                bad('切片台没显示已整理分组')

            # ⑩ 发案例：库里勾段 → 弹窗预选 → 挑段、锁段
            page.evaluate('() => switchMainTab("noteAssets")')
            page.wait_for_timeout(500)
            want_ids = [after['clips'][0]['id'], after['clips'][1]['id'], clip2]
            for cid in want_ids:
                page.wait_for_selector('#noteAssetsContent .npl-libpick[data-npl-pick="%s"]' % cid, timeout=8000)
                page.check('#noteAssetsContent .npl-libpick[data-npl-pick="%s"]' % cid)
            if wait_js(page, '() => { const b = document.querySelector("#noteAssetsContent .npl-selbar"); return !!b && /已选 3 段/.test(b.textContent || "") && /用选中的 3 段发案例/.test(b.textContent || ""); }', 10000):
                ok('勾 3 段 → 选择条：用选中的 3 段发案例')
            else:
                bad('勾 3 段后选择条不对：%r' % (j(page, '() => String((document.querySelector("#noteAssetsContent .npl-selbar")||{}).textContent || "")'),))
            ca(page, '[data-npl="lib-case"]')
            if not wait_js(page, '() => !!document.getElementById("nplPickTitle") && document.querySelectorAll("[data-pick-col]").length >= 1', 15000):
                bad('发案例弹窗没出来')
                br.close()
                return
            groups_txt = j(page, '() => Array.from(document.querySelectorAll("[data-pick-col]")).map(x => String(x.textContent || ""))')
            if any('勾中的 3 段' in t for t in groups_txt):
                ok('挑段弹窗先列「勾中的 3 段」')
            else:
                bad('挑段分组不对：%r' % (groups_txt,))
            checked_n = j(page, '() => document.querySelectorAll("#nplPickList input[data-clip]:checked").length')
            if checked_n == 3:
                ok('弹窗里 3 段已经预选好了')
            else:
                bad('弹窗预选不对：%d 段勾着' % checked_n)
            page.fill('#nplPickTitle', '自检案例·切片台')
            page.fill('#nplPickBrief', '自检：三段落库，验挑段和锁段。')
            page.click('#nplPickSave')
            if not wait_js(page, '''async () => {
                const ns = await npNotesAll();
                const n = ns.find(x => x && x.title === '自检案例·切片台');
                if (!n) return false;
                return ((n.asm && n.asm.libClips) || []).length === 3;
            }''', 30000, 300):
                bad('挑段后笔记没存下 3 段')
                note_id = ''
            else:
                note_id = j(page, '''async () => {
                    const n = (await npNotesAll()).find(x => x && x.title === '自检案例·切片台');
                    return n ? String(n.id) : '';
                }''')
                locked = j(page, '''async (nid) => {
                    const cs = await npClipsRead();
                    return cs.filter(c => String(c.usedBy || '') === nid).map(c => String(c.id));
                }''', note_id)
                want = {after['clips'][0]['id'], after['clips'][1]['id'], clip2}
                if len(locked) == 3 and set(locked) == want:
                    ok('挑的 3 段已锁给这篇笔记')
                else:
                    bad('段锁定不对：%r' % (locked,))
            if note_id:
                page.wait_for_timeout(1500)
                draft0 = j(page, '''async (id) => { const n = (await npNotesAll()).find(x => x && String(x.id) === id); return n ? String(n.draft || '') : ''; }''', note_id)
                if draft0 == '' and not j(page, '() => !!document.getElementById("nplArtText")'):
                    ok('写稿不可达时不弹假正文、不挡挑段')
                else:
                    bad('写稿失败路径不对：draft=%r' % (draft0,))

                # 锁住的段：不能重切、不能删
                page.evaluate('async (vid) => { await npLibOpenEditor(vid); }', vid1)
                if wait_js(page, '() => !!document.querySelector("#nplTl")', 15000):
                    n_before = j(page, 'async () => (await npClipsRead()).length')
                    ca(page, '[data-npl="ed-confirm"]')
                    page.wait_for_timeout(1200)
                    n_after = j(page, 'async () => (await npClipsRead()).length')
                    if n_after == n_before:
                        ok('有段被笔记用着时，入库被拦下')
                    else:
                        bad('被用着还能重切：%d → %d' % (n_before, n_after))
                    ca(page, '[data-npl="ed-cancel"]')
                    page.wait_for_timeout(500)
                else:
                    bad('锁段路径没进剪辑视图')
                page.wait_for_timeout(500)
                page.wait_for_selector('#noteAssetsContent [data-npl="seg-del"][data-id="%s"]' % after['clips'][0]['id'], timeout=8000)
                n_before2 = j(page, 'async () => (await npClipsRead()).length')
                ca(page, '[data-npl="seg-del"][data-id="%s"]' % after['clips'][0]['id'])
                page.wait_for_timeout(1200)
                n_after2 = j(page, 'async () => (await npClipsRead()).length')
                if n_after2 == n_before2:
                    ok('被笔记用着的段删不掉')
                else:
                    bad('被用着的段被删了')

            # ⑪ 旧数据：老原片在「以前的（没分批次）」；切段后原集合不变
            legacy = j(page, '''async (vid) => {
                const src = (await npVideosRead()).find(v => v && String(v.id) === vid);
                const blob = await npCaseGet('src:' + vid);
                if (!blob) return { ok: false, why: '拿不到原视频 blob' };
                const lv = 'vidlegacy' + Date.now().toString(36);
                await npCasePut('src:' + lv, blob);
                const cols = await npCollectionsRead();
                const oldId = 'colLegacySelfCheck';
                if (!cols.some(c => c && String(c.id) === oldId)) {
                    cols.unshift({ id: oldId, name: '自检·老集合', brief: '', consent: false, status: '在用', lib: true, at: Date.now() - 100000 });
                    await npCollectionsWrite(cols);
                }
                const vs = await npVideosRead();
                vs.unshift({ id: lv, col: oldId, name: '老片·没分批次.mp4', dur: Number(src.dur) || 6, tags: [], at: Date.now() - 50000, shots: [], poster: '', marks: undefined, marksError: '', aiSegs: [] });
                await npVideosWrite(vs);
                return { ok: true, id: lv, oldId: oldId, dur: Number(src.dur) || 6 };
            }''', vid2)
            if not legacy.get('ok'):
                bad('老原片没种上：%r' % (legacy,))
            else:
                page.evaluate('async () => { await switchMainTab("noteBench"); }')
                if wait_js(page, '() => /以前的（没分批次）/.test((document.querySelector("#noteBenchContent")||{}).textContent || "")', 15000):
                    ltxt = j(page, '() => String((document.querySelector("#noteBenchContent")||{}).textContent || "")')
                    if '老片·没分批次' in ltxt and '原属集合「自检·老集合」' in ltxt and '待切' in ltxt:
                        ok('旧原片在切片台底部「以前的（没分批次）」，标着原属集合')
                    else:
                        bad('旧原片分组内容不对：%r' % (ltxt[:400],))
                else:
                    bad('切片台没有「以前的（没分批次）」分组')
                cb(page, '[data-npl="openvid"][data-id="%s"]' % legacy['id'])
                if wait_js(page, '() => !!document.querySelector("#nplTl")', 15000):
                    page.evaluate('() => { npLibSeekPlayer(3); return true; }')
                    cb(page, '[data-npl="ed-addcut"]')
                    page.wait_for_timeout(400)
                    cb(page, '[data-npl="ed-confirm"]')
                    if wait_js(page, '() => !!document.getElementById("nplFoldAskName")', 15000):
                        old_default = j(page, '() => String((document.getElementById("nplFoldAskName")||{}).value || "")')
                        if old_default == today:
                            ok('老原片切段：同样弹文件夹选择，默认今天')
                        else:
                            bad('老原片文件夹默认不对：%r' % (old_default,))
                        page.select_option('#nplFoldAskSel', '__auto')
                        page.fill('#nplFoldAskName', '自检·老片文件夹')
                        page.click('#nplFoldAskSave')
                        if wait_js(page, '''async (lv) => {
                            const v = (await npVideosRead()).find(x => x && String(x.id) === lv);
                            const cs = (await npClipsRead()).filter(c => c && String(c.videoId) === lv);
                            const f = (await npCollectionsRead()).find(c => c && c.folder && c.name === '自检·老片文件夹');
                            return !!v && v.col === 'colLegacySelfCheck' && cs.length >= 1 && !!f && String(cs[0].col) === String(f.id);
                        }''', 30000, 300, legacy['id']):
                            ok('老原片切出的段进新文件夹，原片和原属集合都没动')
                        else:
                            bad('老原片切段后的归属不对：%r' % (j(page, '''async (lv) => {
                                const v = (await npVideosRead()).find(x => x && String(x.id) === lv);
                                const cs = (await npClipsRead()).filter(c => c && String(c.videoId) === lv);
                                const f = (await npCollectionsRead()).find(c => c && c.folder && c.name === '自检·老片文件夹');
                                return { vcol: v && v.col, cs: cs.map(c => c.col), f: f && f.id };
                            }''', legacy['id']),))
                    else:
                        bad('老原片切段没弹文件夹选择')
                else:
                    bad('老原片没进剪辑视图')

                # 旧数据页入口（两签各自记落点：先回素材库首页，再点旧数据）
                page.evaluate('''async () => { const st = npLibS(); st.surface = 'assets'; st.view = 'lib'; st.folderId = ''; st.videoId = ''; st.segId = ''; await switchMainTab("noteAssets"); }''')
                page.wait_for_timeout(500)
                ca(page, '[data-npl="legacy"]')
                if wait_js(page, '() => !!document.querySelector("#noteAssetsContent .npl-legacy-bar")', 15000):
                    ok('「🗄 旧数据」入口打开老数据页')
                    folders_now = j(page, 'async () => (await npCollectionsRead()).filter(c => c && c.folder).map(c => String(c.name || ""))')
                    legacy_txt = j(page, '() => String((document.querySelector("#noteAssetsContent")||{}).textContent || "")')
                    leaked = [n for n in folders_now if n and n in legacy_txt]
                    if folders_now and not leaked:
                        ok('新素材库的 %d 个文件夹都没混进改版前的旧数据页' % len(folders_now))
                    elif not folders_now:
                        bad('查不到新素材库文件夹，旧数据隔离无从验')
                    else:
                        bad('新文件夹混进了旧数据页：%r' % (leaked,))
                else:
                    bad('旧数据页没打开')
                j(page, '() => { switchMainTab("noteAssets", "legacy"); return true; }')
                if wait_js(page, '() => !!document.querySelector("#noteAssetsContent .npl-legacy-bar")', 15000):
                    ok('程序跳转带 legacy 参数也落到旧数据页')
                else:
                    bad('程序跳转带 legacy 参数没落到旧数据页')
                ca(page, '[data-npl="oldv3"]')
                if wait_js(page, '() => /老素材集合/.test((document.querySelector("#noteAssetsContent .npl-title")||{}).textContent || "")', 15000):
                    ok('老素材集合页打开（改版前的集合原样在）')
                    wall_txt = j(page, '() => String((document.querySelector("#noteAssetsContent")||{}).textContent || "")')
                    wall_folders = j(page, 'async () => (await npCollectionsRead()).filter(c => c && c.folder).map(c => String(c.name || ""))')
                    wall_leaked = [n for n in wall_folders if n and n in wall_txt]
                    if '自检·老集合' in wall_txt and not wall_leaked:
                        ok('老素材集合墙上：老集合原样在、新文件夹不出现')
                    else:
                        bad('老素材集合墙内容不对：老集合=%r 混入=%r' % ('自检·老集合' in wall_txt, wall_leaked))
                else:
                    bad('老素材集合页没打开')
                ca(page, '[data-npl="backnew"]')
                if wait_js(page, '() => /素材库/.test((document.querySelector("#noteAssetsContent .npl-title")||{}).textContent || "")', 15000):
                    ok('能从旧数据回新素材库')
                else:
                    bad('回新素材库失败')

            # ⑫ 同名在用文件夹：第二批直接沿用，不建第二个
            page.evaluate('() => switchMainTab("noteBench")')
            page.wait_for_timeout(500)
            cb(page, '[data-npl="import-batch"]')
            page.wait_for_selector('#nplBatName', timeout=8000)
            page.fill('#nplBatName', '自检工地·阳光小区')
            page.set_input_files('#nplBatFile', str(VIDEO2))
            if not wait_js(page, '() => /选了 1 条，读得出 1 条/.test((document.getElementById("nplBatMeta")||{}).textContent || "")', 30000):
                bad('同名批次：单条导入没读出时长')
            else:
                page.click('#nplBatSave')
                if not wait_js(page, '''async () => {
                    const bs = await npBatchesRead();
                    return bs.length === 2 && npLibS().view === 'editor';
                }''', 20000, 300):
                    bad('同名批次：导入后没进剪辑视图')
                else:
                    page.evaluate('() => { npLibSeekPlayer(3); return true; }')
                    cb(page, '[data-npl="ed-addcut"]')
                    page.wait_for_timeout(400)
                    cb(page, '[data-npl="ed-confirm"]')
                    if not wait_js(page, '() => !!document.getElementById("nplFoldAskName")', 15000):
                        bad('同名批次：第一次入库没弹文件夹选择')
                    else:
                        sel_v = j(page, '() => String((document.getElementById("nplFoldAskSel")||{}).value || "")')
                        notice = j(page, '() => String((document.getElementById("nplFoldAskNotice")||{}).textContent || "")')
                        if sel_v == folder_id and '直接放进' in notice:
                            ok('上次用过的文件夹：默认就选它，写明直接放进去')
                        else:
                            bad('文件夹默认没记住上次用的：%r / %r' % (sel_v, notice))
                        page.click('#nplFoldAskSave')
                        if wait_js(page, '''async (fid) => {
                            const cols = await npCollectionsRead();
                            const same = cols.filter(c => c && c.folder && c.name === '自检工地·阳光小区');
                            const bs = await npBatchesRead();
                            const b2 = bs.filter(x => x && x.name === '自检工地·阳光小区').sort((a,c) => (Number(c.at)||0)-(Number(a.at)||0))[0];
                            if (same.length !== 1 || !b2 || String(b2.folderId) !== String(fid)) return false;
                            const vs = (await npVideosRead()).filter(v => v && String(v.batchId) === String(b2.id));
                            const ids = new Set(vs.map(v => String(v.id)));
                            const cs = (await npClipsRead()).filter(c => c && ids.has(String(c.videoId)));
                            return cs.length === 2 && cs.every(c => String(c.col) === String(fid));
                        }''', 30000, 300, folder_id):
                            ok('同名文件夹只一个：这批判的段也进了它')
                        else:
                            bad('同名文件夹沿用不对：%r' % (j(page, '''async () => {
                                const cols = (await npCollectionsRead()).filter(c => c && c.folder && c.name === '自检工地·阳光小区');
                                const bs = await npBatchesRead();
                                return { same: cols.map(c => String(c.id)), bs: bs.map(b => ({ id: b.id, folderId: b.folderId, status: b.status })) };
                            }'''),))

            # ⑬ 集合 / 文件夹能删：空文件夹删掉；段被笔记占着的拦下；老集合也能删
            j(page, '''async () => {
                const cols = await npCollectionsRead();
                cols.push({ id: 'colDelFolderCheck', name: '自检·待删空文件夹', folder: true, status: '在用', at: Date.now() });
                cols.push({ id: 'colDelBusyCheck', name: '自检·占用文件夹', folder: true, status: '在用', at: Date.now() });
                await npCollectionsWrite(cols);
                const clips = await npClipsRead();
                clips.push({ id: 'clipDelBusyCheck', col: 'colDelBusyCheck', name: '占着的段', usedBy: 'note-selfcheck', usedByName: '自检那篇', at: Date.now() });
                await npClipsWrite(clips);
                _npLibLegacyOpen = false;
                npLibS().surface = 'assets'; npLibS().view = 'lib'; npLibS().folderId = ''; npLibS().colId = '';
                switchMainTab('noteAssets');
                return true;
            }''')
            page.wait_for_timeout(600)
            page.evaluate('(fid) => { npLibOpenFolderEditor(fid); }', 'colDelFolderCheck')
            if not wait_js(page, '() => !!document.getElementById("nplFoldDel")', 10000):
                bad('文件夹设置里没有删除按钮')
            else:
                ok('文件夹设置里有「删文件夹」')
                page.click('#nplFoldDel')
                if wait_js(page, '''async () => !(await npCollectionsRead()).some(c => c && String(c.id) === 'colDelFolderCheck')''', 15000, 300):
                    ok('空文件夹删掉了')
                else:
                    bad('空文件夹没删掉')
                page.evaluate('(fid) => { npLibOpenFolderEditor(fid); }', 'colDelBusyCheck')
                page.wait_for_selector('#nplFoldDel', timeout=8000)
                page.click('#nplFoldDel')
                page.wait_for_timeout(900)
                busy_still = j(page, '''async () => {
                    const cols = await npCollectionsRead();
                    const cs = await npClipsRead();
                    return {
                        col: cols.some(c => c && String(c.id) === 'colDelBusyCheck'),
                        clip: cs.some(c => c && String(c.id) === 'clipDelBusyCheck'),
                        toast: String((document.querySelector('#nplToast') || {}).textContent || ''),
                    };
                }''')
                if busy_still['col'] and busy_still['clip']:
                    ok('有段被笔记占着：文件夹不删，段也还在')
                else:
                    bad('被占用的文件夹不该删掉：%r' % (busy_still,))
                j(page, '''async () => {
                    const cs = await npClipsRead();
                    await npClipsWrite(cs.filter(c => !(c && String(c.id) === 'clipDelBusyCheck')));
                    const cols = await npCollectionsRead();
                    await npCollectionsWrite(cols.filter(c => !(c && String(c.id) === 'colDelBusyCheck')));
                    return true;
                }''')
            # 老素材集合墙：卡片上也带删除
            j(page, '''async () => {
                const cols = await npCollectionsRead();
                cols.push({ id: 'colDelOldCheck', name: '自检·待删老集合', lib: true, status: '在用', at: Date.now() });
                await npCollectionsWrite(cols);
                _npLibLegacyOpen = false;
                const st = npLibS(); st.surface = 'assets'; st.view = 'wall'; st.colId = ''; st.folderId = '';
                await npLibRender(document.getElementById('noteAssetsContent'));
                return true;
            }''')
            if not wait_js(page, '() => !!document.querySelector(\'#noteAssetsContent [data-npl="delcol"][data-id="colDelOldCheck"]\')', 15000):
                bad('老素材集合卡上没有删除按钮')
            else:
                ok('老素材集合卡上有删除按钮')
                ca(page, '[data-npl="delcol"][data-id="colDelOldCheck"]')
                if wait_js(page, '''async () => !(await npCollectionsRead()).some(c => c && String(c.id) === 'colDelOldCheck')''', 15000, 300):
                    ok('老集合删掉了')
                else:
                    bad('老集合没删掉')

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
