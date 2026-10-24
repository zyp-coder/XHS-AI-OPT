# -*- coding: utf-8 -*-
"""切片台「这一批」底下这批切好的散片 · 真实 web 自检（2026-10-23）

对着 资料/切片台-抽帧加密与本批切片总览-确认单.md 第六节（demo 定稿）验：
  ① 批次页底下出现「这批切好的散片」那一行，段数与齐了数对得上；
  ② 默认摊开：所有散片平铺在同一个列表里，没有按原片分的小标题；
  ③ 每张卡标「出自 🎞 哪条原片（这条原片的第 i / n 段）」，序号按该原片的段数走；
  ④ 只列本批：别的批次/历史文件夹的段一条都不出现；
  ⑤ 点那一行收起 → 卡片全没了；再点展开 → 回来了；
  ⑥ ✎ 改一下补齐名字/说明 → 那一行的「M 段齐了」跟着涨，卡上标记变「✓ 备好」；
  ⑦ 🗑 删一段 → 段数、齐了数、该原片的「第 i / n 段」序号三处一起重排；
  ⑧ 两处同一份数据：素材库搜这段名搜得到同一条（同一 id）；
  ⑨ 被笔记占用的段：卡照列、挂 🔒 写出哪条笔记；「🗑 删」点了不删（弹红字）、✎ 改能开且写明「边界先锁住」（跟素材库一个规矩）；
  ⑩ 全程没有页内 JS 异常。

跑法：python3 -X utf8 scripts/dev/check_batch_pile_web.py
本机起 dev-server（临时账本，不碰真数据）；不接火山、不推公网。
"""
import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

from _guide_gate import goto_big

sys.stdout.reconfigure(encoding='utf-8')
REPO = Path(__file__).resolve().parents[2]
PORT = 8933
BASE = 'http://127.0.0.1:%d' % PORT
WORK = REPO / 'tmp' / 'batch-pile-web-check'
DATA = WORK / 'data'
VIDEOS = [
    (WORK / 'pile-a.mp4', [('0x101010', 'A1', 3), ('0x606060', 'A2', 3), ('0xb0b0b0', 'A3', 3)]),
    (WORK / 'pile-b.mp4', [('0x303030', 'B1', 3), ('0xd0d0d0', 'B2', 3)]),
    (WORK / 'pile-c.mp4', [('0x202040', 'C1', 3), ('0xa0a060', 'C2', 3)]),
]
fails = 0


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


def cb(page, sel):
    page.click('#noteBenchContent ' + sel)


def make_video(path, shots):
    if path.exists():
        return
    args = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y']
    for color, _label, secs in shots:
        args += ['-f', 'lavfi', '-i', 'color=c=%s:s=640x360:d=%s' % (color, secs)]
    parts = []
    for i, (color, label, _secs) in enumerate(shots):
        fg = 'black' if color in ('0xb0b0b0', '0xd0d0d0', '0xa0a060') else 'white'
        parts.append("[%d:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='%s':fontsize=64:fontcolor=%s:x=(w-text_w)/2:y=(h-text_h)/2[v%d]"
                     % (i, label, fg, i))
    fc = ';'.join(parts) + ';' + ''.join('[v%d]' % i for i in range(len(shots))) + 'concat=n=%d:v=1:a=0[v]' % len(shots)
    args += ['-filter_complex', fc, '-map', '[v]', '-r', '10', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(path)]
    subprocess.run(args, check=True)


def main():
    print('── 切片台「这批切好的散片」·真实 web 自检 ──', flush=True)
    if WORK.exists():
        shutil.rmtree(WORK)
    WORK.mkdir(parents=True, exist_ok=True)
    for p, shots in VIDEOS:
        make_video(p, shots)
    DATA.mkdir(parents=True, exist_ok=True)

    env = dict(os.environ)
    env['DEMO_DATA_DIR'] = str(DATA)
    env['PORT'] = str(PORT)
    env['DEMO_AI_KEY'] = 'check-only'
    env['DEMO_AI_BASE'] = 'http://127.0.0.1:1/v1'
    logf = open(WORK / 'server.log', 'w', encoding='utf-8')
    srv = subprocess.Popen(['node', str(REPO / 'server' / 'dev-server.mjs')], env=env, stdout=logf, stderr=subprocess.STDOUT)
    for _ in range(80):
        try:
            socket.create_connection(('127.0.0.1', PORT), 1).close()
            break
        except OSError:
            time.sleep(0.5)
    else:
        bad('服务器没起来（看 tmp/batch-pile-web-check/server.log）')
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
            page.evaluate('''() => {
                window.__toasts = [];
                const old = window.toast;
                window.toast = function (m, k) { window.__toasts.push(String(m || '')); try { return old(m, k); } catch (_) {} };
                return true;
            }''')

            # ── 准备：这批导 3 条；另造一条「别批」的段，用来验这块只列本批 ──
            page.evaluate('() => switchMainTab("noteBench")')
            page.wait_for_timeout(600)
            cb(page, '[data-npl="import-batch"]')
            page.wait_for_selector('#nplBatName', timeout=8000)
            page.fill('#nplBatName', '自检散片·老李家卫生间')
            page.set_input_files('#nplBatFile', [str(v[0]) for v in VIDEOS])
            if not wait_js(page, '() => /选了 3 条，读得出 3 条/.test((document.getElementById("nplBatMeta")||{}).textContent || "")', 40000):
                bad('多选导入没读出时长')
                br.close()
                return
            page.click('#nplBatSave')
            if not wait_js(page, '''async () => {
                const bs = await npBatchesRead();
                const vs = await npVideosRead();
                return bs.length === 1 && vs.filter(v => v && v.batchId === bs[0].id).length === 3;
            }''', 30000):
                bad('导入没落批：%r' % (j(page, '''async () => ({ bs: (await npBatchesRead()).length, vs: (await npVideosRead()).length })'''),))
                br.close()
                return

            # 段直接按数据写进去（切段那条链另有脚本验）：a 3 段、b 2 段、c 1 段 = 6 段
            seeded = j(page, '''async () => {
                const b = (await npBatchesRead())[0];
                const vs = (await npVideosRead()).filter(v => v && String(v.batchId) === String(b.id));
                vs.sort((x, y) => String(x.name) < String(y.name) ? -1 : 1);
                const FID = 'pile-check-folder';
                const cols = await npCollectionsRead();
                if (!cols.find(c => c && String(c.id) === FID)) cols.unshift({ id: FID, name: '自检散片文件夹', folder: true, at: Date.now() });
                await npCollectionsWrite(cols);
                const clips = await npClipsRead();
                const mk = (v, i, a, bnd, name, desc, extra) => Object.assign({
                    id: 'pile-' + v.id + '-' + i, col: FID, videoId: v.id, shot: -1,
                    a: a, b: bnd, dur: Math.round(bnd - a), name: name, tags: ['生产/制作过程'], desc: desc,
                    noInherit: [], aiAt: Date.now(), aiSrc: 'vision', at: Date.now()
                }, extra || {});
                const A = vs[0], B = vs[1], C = vs[2];
                const mine = [
                    mk(A, 1, 0.2, 3.0, '拆旧-砸墙地砖', '旧瓷砖先砸干净，垃圾当天清走。'),
                    mk(A, 2, 3.2, 6.0, '下水管位置确认', '', { tags: ['场景空镜'] }),
                    mk(A, 3, 6.2, 9.0, '闭水试验 48 小时', '防水做完闭水 48 小时，楼下看一遍。', { usedBy: 'note-x', usedByName: '老李家改造第 2 天' }),
                    mk(B, 1, 0.2, 3.0, '', '墙面拉毛一遍，砖才咬得住。'),
                    mk(B, 2, 3.2, 6.0, '墙砖对缝铺贴', '从门口往里铺，缝对得齐。'),
                    mk(C, 1, 0.2, 3.0, '美缝收口', '干透再打美缝，边角用刮板压平。')
                ];
                // 别批的一条：挂在一个没有 batchId 的老视频上
                const legacy = { id: 'pile-legacy-video', name: '别批-旧片子.mp4', dur: 8, col: FID, at: Date.now(), marks: [] };
                const videosAll = await npVideosRead();
                videosAll.push(legacy);
                await npVideosWrite(videosAll);
                const others = [Object.assign({}, mk(legacy, 1, 0.2, 4.0, '别批的段别露脸', '这条不属于本批。'))];
                await npClipsWrite(clips.concat(mine, others));
                _npLibCache.videos = videosAll;
                _npLibCache.clips = clips.concat(mine, others);
                return { batchId: String(b.id), vids: vs.map(v => ({ id: String(v.id), name: v.name })), mine: mine.map(c => String(c.id)) };
            }''')
            if not seeded or len(seeded['mine']) != 6:
                bad('段没种进去：%r' % (seeded,))
                br.close()
                return
            page.evaluate('() => switchMainTab("noteBench")')
            page.wait_for_timeout(400)
            # 进这一批的详情页
            j(page, '''async (id) => { await npLibAction(document.getElementById("noteBenchContent"), "openbatch", { id: id }); return true; }''', seeded['batchId'])
            if not wait_js(page, '() => !!document.querySelector("#noteBenchContent .npl-pilehead")', 20000):
                bad('批次页底下没出现「这批切好的散片」那一行')
                br.close()
                return
            page.wait_for_timeout(1200)

            head = str(j(page, '() => (document.querySelector("#noteBenchContent .npl-pilehead")||{}).textContent || ""')).replace('\n', ' ')
            cards = j(page, '''() => ({
                n: document.querySelectorAll("#noteBenchContent .npl-pilehead ~ .npl-cards .npl-segcard").length,
                all: document.querySelectorAll("#noteBenchContent .npl-segcard").length,
                groupHeads: document.querySelectorAll("#noteBenchContent .npl-grouphead, #noteBenchContent .npl-sect").length,
                srcs: Array.from(document.querySelectorAll("#noteBenchContent .npl-segcard .npl-segmeta")).map(e => e.textContent.replace(/\\s+/g,' ').trim()).filter(t => t.indexOf('出自') >= 0),
                names: Array.from(document.querySelectorAll("#noteBenchContent .npl-segcard .npl-segname")).map(e => e.textContent.trim())
            })''')
            if '6 段全铺在这儿' in head and '4 段名字' in head:
                ok('那一行报对了：6 段、4 段齐了（缺说明 1 段、缺名字 1 段、别批的没算进来）')
            else:
                bad('那一行文案不对：[%s]' % head[:160])
            if cards['n'] == 6 and cards['all'] == 6:
                ok('默认摊开：6 张卡平铺在同一个列表里')
            else:
                bad('卡片数不对：pile %r / 页内全部 %r' % (cards['n'], cards['all']))
            if cards['groupHeads'] == 0:
                ok('没有按原片分的小标题（不分摞）')
            else:
                bad('冒出分组标题：%r' % (cards['groupHeads'],))
            if len(cards['srcs']) == 6 and '第 1 / 3 段' in ''.join(cards['srcs']) and '第 2 / 2 段' in ''.join(cards['srcs']) and '第 1 / 1 段' in ''.join(cards['srcs']):
                ok('每张卡标了出自哪条原片＋第几段：%r' % (cards['srcs'][:3],))
            else:
                bad('来源标注不对：%r' % (cards['srcs'],))
            if '别批的段别露脸' not in ''.join(cards['names']):
                ok('只列本批：别批那条段没出现在这块里')
            else:
                bad('别批的段混进来了：%r' % (cards['names'],))

            # ── ⑤ 收起 / 展开 ──
            cb(page, '[data-npl="pile-fold"]')
            page.wait_for_timeout(900)
            closed = j(page, '() => document.querySelectorAll("#noteBenchContent .npl-segcard").length')
            ar = str(j(page, '() => (document.querySelector("#noteBenchContent .npl-pilehead .ar")||{}).textContent || ""')).strip()
            if closed == 0 and '展开' in ar:
                ok('点那一行收起：卡片全没了，那行还剩段数')
            else:
                bad('收起没生效：卡片 %r 个，箭头文案 [%s]' % (closed, ar))
            cb(page, '[data-npl="pile-fold"]')
            page.wait_for_timeout(900)
            if j(page, '() => document.querySelectorAll("#noteBenchContent .npl-segcard").length') == 6:
                ok('再点展开：6 张回来了')
            else:
                bad('再点展开没回来')

            # ── ⑥ ✎ 改一下补齐说明：齐了数 4→5、标记翻 ✓ 备好 ──
            target = [cid for cid in seeded['mine'] if cid.endswith('-2')][0]
            j(page, '''async (id) => { await npLibAction(document.getElementById("noteBenchContent"), "seg-edit", { id: id }); return true; }''', target)
            if not wait_js(page, '() => !!document.getElementById("nplSegDesc")', 12000):
                bad('✎ 改一下弹窗没开起来')
            else:
                page.fill('#nplSegDesc', '改下水之前先跟业主指一遍位置。')
                page.click('#nplSegSave')
                if not wait_js(page, '''() => {
                    const h = (document.querySelector("#noteBenchContent .npl-pilehead")||{}).textContent || "";
                    return h.indexOf('5 段名字') >= 0;
                }''', 15000):
                    bad('补齐说明后「齐了」没涨到 5：[%s]' % str(j(page, '() => (document.querySelector("#noteBenchContent .npl-pilehead")||{}).textContent || ""'))[:160])
                else:
                    ok('✎ 补齐说明：那一行跟着涨到 5 段齐了')
                card = j(page, '''(id) => {
                    const el = Array.from(document.querySelectorAll("#noteBenchContent .npl-segcard")).find(c => String(c.getAttribute("data-id")) === id);
                    return el ? el.textContent.replace(/\\s+/g,' ').trim().slice(0, 90) : '';
                }''', target)
                if '✓ 备好' in card and '还差' not in card:
                    ok('那张卡的标记翻成「✓ 备好」：%s' % card[:60])
                else:
                    bad('那张卡标记没翻：%r' % (card[:90],))

            # ── ⑦ 🗑 删一段：段数、齐了数、同原片序号一起重排 ──
            victim = [cid for cid in seeded['mine'] if cid.endswith('-1') and cid.startswith('pile-' + seeded['vids'][0]['id'])][0]
            j(page, '''async (id) => { await npLibAction(document.getElementById("noteBenchContent"), "seg-del", { id: id }); return true; }''', victim)
            if not wait_js(page, '''() => {
                const h = (document.querySelector("#noteBenchContent .npl-pilehead")||{}).textContent || "";
                return h.indexOf('5 段全铺在这儿') >= 0 && h.indexOf('4 段名字') >= 0;
            }''', 15000):
                bad('删一段后段数/齐了数没跟着掉：[%s]' % str(j(page, '() => (document.querySelector("#noteBenchContent .npl-pilehead")||{}).textContent || ""'))[:160])
            else:
                ok('🗑 删一段：那一行的段数与齐了数一起重算（5 段、4 段齐）')
            a_name = seeded['vids'][0]['name']
            src_a = j(page, '''(name) => Array.from(document.querySelectorAll("#noteBenchContent .npl-segcard"))
                .filter(c => { const card = c.querySelector('.npl-segname'); return card && card.textContent.trim() === '下水管位置确认'; })
                .map(c => Array.from(c.querySelectorAll('.npl-segmeta')).map(e => e.textContent.replace(/\\s+/g,' ').trim()).filter(t => t.indexOf(name) >= 0).join('')) ''', a_name)
            if src_a and '第 1 / 2 段' in src_a[0]:
                ok('同一条原片剩下的段序号自动重排（下水管位置确认现在是第 1 / 2 段）')
            else:
                bad('删完序号没重排：%r' % (src_a,))

            # ── ⑨ 被占用的段：🔒 在；删点了不删（弹红字），改能开且写明边界锁住——跟素材库一个规矩 ──
            locked = [cid for cid in seeded['mine'] if cid.endswith('-3')][0]
            lk = j(page, '''(id) => {
                const el = Array.from(document.querySelectorAll("#noteBenchContent .npl-segcard")).find(c => String(c.getAttribute("data-id")) === id);
                if (!el) return null;
                return { txt: el.textContent.replace(/\\s+/g,' ').trim().slice(0, 80),
                         delBtn: !!el.querySelector('[data-npl="seg-del"]'), editBtn: !!el.querySelector('[data-npl="seg-edit"]') };
            }''', locked)
            if lk and '🔒' in lk['txt'] and '老李家改造第 2 天' in lk['txt']:
                ok('被笔记占用的段：照列、挂 🔒 写出哪条笔记')
            else:
                bad('占用段那张卡不对：%r' % (lk,))
            j(page, '''async (id) => { (window.__toasts = []); await npLibAction(document.getElementById("noteBenchContent"), "seg-del", { id: id }); return true; }''', locked)
            page.wait_for_timeout(1200)
            still = j(page, '''async (id) => {
                const clips = await npClipsRead();
                return { gone: !clips.find(c => c && String(c.id) === id), cards: document.querySelectorAll("#noteBenchContent .npl-segcard").length };
            }''', locked)
            warns = j(page, '''() => (window.__toasts || []).filter(t => /用着|撤下来/.test(t))''')
            if not still['gone'] and still['cards'] == 5 and warns:
                ok('占用段的「🗑 删」点了没删（段还在、卡片还是 5 张），弹的是：%s' % warns[0][:52])
            else:
                bad('占用段删除拦不住：%r toast=%r' % (still, warns[:1]))
            j(page, '''async (id) => { await npLibAction(document.getElementById("noteBenchContent"), "seg-edit", { id: id }); return true; }''', locked)
            if not wait_js(page, '() => !!document.getElementById("nplSegDesc")', 12000):
                bad('占用段的 ✎ 改一下没开起来')
            else:
                note = str(j(page, '() => (document.querySelector(".npl-modal .npl-note")||{}).textContent || ""'))
                a_disabled = j(page, '''() => { const el = document.getElementById('nplSegA'); return !!(el && el.disabled); }''')
                if '🔒' in note and '边界先锁住' in note:
                    ok('占用段的改弹窗写明「🔒 边界先锁住；名字/标签/说明还能改」%s' % ('（入点框按着不动）' if a_disabled else ''))
                else:
                    bad('占用段改弹窗的锁话术不对：[%s]' % note[:100])
                j(page, '''() => { const b = document.getElementById('nplSegCancel'); if (b) b.click(); else npLibModalClose(); return true; }''')
                page.wait_for_timeout(400)

            # ── ⑧ 两处同一份：素材库搜这段名搜得到同一条 id ──
            page.evaluate('() => switchMainTab("noteAssets")')
            page.wait_for_timeout(1200)
            page.fill('#nplLibQ', '墙砖对缝铺贴')
            page.wait_for_timeout(1500)
            found = j(page, '''async (name) => {
                const clips = await npClipsRead();
                const hit = clips.find(c => c && String(c.name) === name);
                return { id: hit ? String(hit.id) : '', inDom: String(document.querySelector('#noteAssetsContent').textContent || '').indexOf(name) >= 0 };
            }''', '墙砖对缝铺贴')
            if found['id'] and found['inDom']:
                ok('素材库那边搜得到同一段（id=%s）——两处是同一份数据' % found['id'])
            else:
                bad('素材库那边没搜到：%r' % (found,))

            if errs:
                bad('页内 JS 异常 %d 条：%s' % (len(errs), ' | '.join(errs[:2])[:200]))
            else:
                ok('全程没有页内 JS 异常')

            br.close()
    finally:
        try:
            srv.terminate()
        except Exception:
            pass

    print('\n── 结论：%s（失败 %d 项）──' % ('全过' if not fails else '有 %d 项没过' % fails, fails), flush=True)
    sys.exit(0 if not fails else 1)


if __name__ == '__main__':
    main()
