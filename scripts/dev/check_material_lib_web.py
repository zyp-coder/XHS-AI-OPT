# -*- coding: utf-8 -*-
"""素材库拆段改版 · 真实 web 自检（2026-10-22）

验的是公网那份 web/ 的素材库新流程，不是 demo：
  ① 新建集合（业主同意勾上）→ 导入一条原视频 → 本机分镜出镜头 → 自动挑 3 段；
  ② 点未选镜头＝按该镜头边界建一段；再点一次只提示、不重复建；
  ③ 改段：名字/标签/说明缺一项拦下；手动边界兜底可微调、太短拦下；
  ④ 删段只删记录，原视频和镜头还在；
  ⑤ 发案例：挑段建笔记 → 段被锁 → 段序进大组装；被用的段不能重分镜、不能删、边界锁住；
  ⑥ 标记已发＝放开；撤回草稿＝重新锁上；
  ⑦ 反向入口：案例没料 → 素材库挑段（占位标题能命名）→ 回大组装；
  ⑧ 旧数据入口只读展示老集合，能回新素材库。

跑法：python3 -X utf8 scripts/dev/check_material_lib_web.py
本机起 dev-server（临时账本），Edge 真开页；不碰 server/data/，不推公网。
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
PORT = 8915
BASE = 'http://127.0.0.1:%d' % PORT
WORK = REPO / 'tmp' / 'material-lib-web-check'
DATA = WORK / 'data'
VIDEO = WORK / 'test-5shots.mp4'
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


def make_video():
    """5 个静态镜头（15 秒）——切成 5 段，自动挑 3 段后还留 2 个没选，验点镜头。"""
    if VIDEO.exists():
        return
    colors = ['0x101010', '0x606060', '0xb0b0b0', '0xf0f0f0', '0x404040']
    args = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y']
    for c in colors:
        args += ['-f', 'lavfi', '-i', 'color=c=%s:s=640x360:d=3' % c]
    parts = []
    for i in range(5):
        parts.append('[%d:v]drawtext=fontfile=\'C\\:/Windows/Fonts/arial.ttf\':text=\'SHOT %d\':fontsize=72:fontcolor=%s:x=(w-text_w)/2:y=(h-text_h)/2[v%d]'
                     % (i, i + 1, 'white' if i in (0, 1, 4) else 'black', i))
    fc = ';'.join(parts) + ';' + ''.join('[v%d]' % i for i in range(5)) + 'concat=n=5:v=1:a=0[v]'
    args += ['-filter_complex', fc, '-map', '[v]', '-r', '10', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(VIDEO)]
    subprocess.run(args, check=True)


def main():
    print('── 素材库拆段改版 · 真实 web 自检 ──', flush=True)
    if WORK.exists():
        shutil.rmtree(WORK)
    WORK.mkdir(parents=True, exist_ok=True)
    make_video()
    DATA.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env['DEMO_DATA_DIR'] = str(DATA)
    env['PORT'] = str(PORT)
    env['DEMO_AI_KEY'] = 'check-only'
    env['DEMO_AI_BASE'] = 'http://127.0.0.1:1/v1'
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
        bad('服务器没起来（看 tmp/material-lib-web-check/server.log）')
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

            # 种一条老数据，供 ⑧ 旧数据入口验只读展示
            page.evaluate('''async () => {
                const cols = (await chrome.storage.local.get('np_collections')).np_collections || [];
                if (!cols.some(c => c && c.id === 'old-col-1')) {
                    cols.push({ id: 'old-col-1', name: '旧工地·屋面防水', desc: '老数据', source: '自己加的', manual: true, link: null, at: 1, use: 'on' });
                    await chrome.storage.local.set({ np_collections: cols });
                }
                const clips = (await chrome.storage.local.get('np_clips')).np_clips || [];
                if (!clips.some(c => c && c.id === 'old-clip-1')) {
                    clips.push({ id: 'old-clip-1', col: 'old-col-1', src: '现场01.mp4', a: 0, b: 8, dur: 8, stage: '施工', kb: null, vo: '', tags: [], fo: [], thumb: '', ref: '' });
                    await chrome.storage.local.set({ np_clips: clips });
                }
            }''')

            page.evaluate('() => switchMainTab("noteAssets")')
            if not wait_js(page, '() => !!document.querySelector(".npl-wrap")', 20000):
                bad('素材库页没画出来')
                br.close()
                return
            ok('素材库新页画出来了')

            # ① 新建集合
            page.click('[data-npl="newcol"]')
            page.wait_for_selector('#nplColName', timeout=8000)
            page.fill('#nplColName', '自检工地·五镜头')
            page.fill('#nplColBrief', '老房翻新，业主最在意防水和收纳。')
            page.check('#nplColConsent')
            page.click('#nplColSave')
            if not wait_js(page, '''async () => {
                const cols = await npCollectionsRead();
                return cols.some(c => c && c.lib && c.name === '自检工地·五镜头' && c.consent);
            }''', 10000):
                bad('集合没建成（lib/consent 不对）')
            else:
                ok('新建集合成功，业主同意已勾')

            col_id = j(page, '''async () => {
                const cols = await npCollectionsRead();
                const c = cols.find(x => x && x.lib && x.name === '自检工地·五镜头');
                return c ? String(c.id) : '';
            }''')

            # ① 导入原视频 → 自动分镜 → 自动挑 3 段
            page.click('[data-npl="import"]')
            page.wait_for_selector('#nplImpFile', timeout=8000)
            page.set_input_files('#nplImpFile', str(VIDEO))
            if not wait_js(page, '() => /已选/.test((document.getElementById("nplImpMeta")||{}).textContent || "")', 20000):
                bad('导入弹窗没读出视频时长')
            else:
                tags_on = j(page, '() => document.querySelectorAll(".npl-tagpick .npl-tag.pick.on").length')
                if tags_on >= 1:
                    ok('视频读到了，自动带出了标签')
                else:
                    bad('导入时没自动带标签（18 类池）')
            page.fill('#nplImpName', '自检视频·五镜头')
            page.click('#nplImpSave')

            scanned = wait_js(page, '''async () => {
                const vs = await npVideosRead();
                const v = vs.find(x => x && x.name === '自检视频·五镜头');
                if (!v) return false;
                if (typeof _npLibScanning !== 'undefined' && _npLibScanning[v.id]) return false;
                return Array.isArray(v.shots) && v.shots.length >= 5;
            }''', 90000, 500)
            if not scanned:
                bad('本机分镜没跑完或镜头数 < 5')
                br.close()
                return
            ok('原视频导入后本机分镜出 5 个镜头')
            if not wait_js(page, '() => document.querySelectorAll(".npl-zone").length >= 5 && document.querySelectorAll(".npl-segcard").length >= 3', 20000, 300):
                bad('分镜完成后时间轴没重新画出来')
                dbg = j(page, '''() => {
                    const c = document.getElementById('noteAssetsContent');
                    return {
                        view: (typeof npLibS === 'function') ? npLibS() : null,
                        scanning: (typeof _npLibScanning !== 'undefined') ? Object.keys(_npLibScanning) : 'n/a',
                        hasWrap: !!document.querySelector('.npl-wrap'),
                        hasFilm: !!document.querySelector('.npl-film'),
                        hasScan: !!document.querySelector('.npl-scan'),
                        hasVid: !!document.querySelector('.npl-vidcard'),
                        hasCol: !!document.querySelector('.npl-col'),
                        text: c ? String(c.textContent || '').replace(/\\s+/g, ' ').slice(0, 200) : '',
                    };
                }''')
                print('  · 调试：%r' % (dbg,), flush=True)
                print('  · 页内异常：%r' % (errs[:3],), flush=True)

            vstate = j(page, '''async () => {
                const vs = await npVideosRead();
                const v = vs.find(x => x && x.name === '自检视频·五镜头');
                const cs = (await npClipsRead()).filter(c => c && String(c.videoId) === String(v.id));
                return { vid: String(v.id), shots: v.shots.length, cols: cs.map(c => ({ id: String(c.id), shot: Number(c.shot), a: c.a, b: c.b, ready: npLibReady(c, v), name: c.name, tags: npLibTagsAll(c, v), desc: c.desc, usedBy: c.usedBy || '' })) };
            }''')
            ready0 = [c for c in vstate['cols'] if c['ready']]
            if len(vstate['cols']) == 3 and len(ready0) == 3:
                ok('自动挑了 3 段，且 3 段都 ✓备好（名字/标签/说明齐）')
            else:
                bad('自动挑段不对：%d 段，%d 段备好' % (len(vstate['cols']), len(ready0)))

            dom0 = j(page, '''() => ({
                zones: document.querySelectorAll(".npl-zone").length,
                cuts: document.querySelectorAll(".npl-cut").length,
                segzones: document.querySelectorAll(".npl-segzone").length,
                okbadge: document.querySelectorAll(".npl-ok").length,
                cards: document.querySelectorAll(".npl-segcard").length,
            })''')
            if dom0['zones'] == 5 and dom0['cuts'] >= 4 and dom0['segzones'] == 3 and dom0['okbadge'] == 3 and dom0['cards'] == 3:
                ok('时间轴画出 5 个镜头 / 4 个切点 / 3 段橙色选中；段卡 3 张都 ✓备好')
            else:
                bad('时间轴/段卡画得不对：%r' % (dom0,))

            # ② 点未选镜头建段；再点一次不重复
            before = len(vstate['cols'])
            j(page, '''() => {
                const z = Array.from(document.querySelectorAll(".npl-zone")).find(e => !e.classList.contains("has"));
                if (z) z.click();
                return true;
            }''')
            grew = wait_js(page, '(async () => (await npClipsRead()).filter(c => c.videoId).length > %d)()' % before, 8000)
            after_click = j(page, 'async () => (await npClipsRead()).filter(c => c.videoId).length')
            if grew and after_click == before + 1:
                ok('点一个没选的镜头：按该镜头边界建了 1 段（%d → %d）' % (before, after_click))
            else:
                bad('点镜头建段不对：%d → %d' % (before, after_click))
            j(page, '''() => {
                const z = Array.from(document.querySelectorAll(".npl-zone.has"))[0];
                if (z) z.click();
                return true;
            }''')
            page.wait_for_timeout(1200)
            after_again = j(page, 'async () => (await npClipsRead()).filter(c => c.videoId).length')
            if after_again == after_click:
                ok('再点已选镜头：只提示，没有重复建段')
            else:
                bad('再点一次又建了一段：%d → %d' % (after_click, after_again))

            # ③ 改段：缺名字拦下、太短拦下、改好仍备好
            target = j(page, '''async () => {
                const vs = await npVideosRead();
                const v = vs.find(x => x && x.name === '自检视频·五镜头');
                const cs = (await npClipsRead()).filter(c => c && c.videoId === v.id && !c.usedBy).sort((a,b) => Number(a.a)-Number(b.a));
                const c = cs[0];
                return { id: String(c.id), a: Number(c.a), b: Number(c.b) };
            }''')
            page.click('[data-npl="seg-edit"][data-id="%s"]' % target['id'])
            page.wait_for_selector('#nplSegName', timeout=8000)
            page.fill('#nplSegName', '')
            page.click('#nplSegSave')
            if wait_js(page, '() => /起个名字/.test((document.getElementById("nplSegErr")||{}).textContent || "")', 5000):
                ok('改段：名字空着被拦下')
            else:
                bad('改段：名字空着没拦住')
            page.fill('#nplSegName', '防水-01-清理基层')
            page.fill('#nplSegDesc', '先把基层浮灰清干净，墙角找平。')
            page.click('.npl-sheet details summary')  # 展开「边界不对？手动微调」
            page.wait_for_selector('#nplSegB', state='visible', timeout=5000)
            page.fill('#nplSegB', '%.1f' % (target['a'] + 0.4))
            page.click('#nplSegSave')
            if wait_js(page, '() => /至少 1.2 秒/.test((document.getElementById("nplSegErr")||{}).textContent || "")', 5000):
                ok('改段：边界太短被拦下')
            else:
                bad('改段：边界太短没拦住')
            page.fill('#nplSegB', '%.1f' % target['b'])
            page.click('[data-nudge="a"][data-d="0.5"]')
            nudged = float(page.input_value('#nplSegA'))
            page.click('#nplSegSave')
            if wait_js(page, '() => !document.querySelector("#nplSegSave")', 8000):
                st = j(page, '''async (cid) => {
                    const cs = await npClipsRead();
                    const c = cs.find(x => x && String(x.id) === cid);
                    const vs = await npVideosRead();
                    const v = vs.find(x => x && String(x.id) === String(c.videoId));
                    return { a: Number(c.a), name: c.name, desc: c.desc, ready: npLibReady(c, v) };
                }''', target['id'])
                if abs(st['a'] - (target['a'] + 0.5)) < 0.06 and st['ready'] and st['name'].startswith('防水-01'):
                    ok('改段：手动边界 +0.5 秒生效，三样齐了仍是 ✓备好')
                else:
                    bad('改段：边界/备好状态不对 %r（nudge 输入=%s）' % (st, nudged))
            else:
                bad('改段：保存后弹窗没关')

            # ④ 删一段（未用）→ 原视频和镜头还在
            del_target = j(page, '''async () => {
                const vs = await npVideosRead();
                const v = vs.find(x => x && x.name === '自检视频·五镜头');
                const cs = (await npClipsRead()).filter(c => c && c.videoId === v.id && !c.usedBy);
                const c = cs.find(x => String(x.id) !== '%s') || cs[0];
                return String(c.id);
            }''' % target['id'])
            shots_before = j(page, '''async () => { const v = (await npVideosRead()).find(x => x && x.name === '自检视频·五镜头'); return v.shots.length; }''')
            n_before = j(page, 'async () => (await npClipsRead()).filter(c => c.videoId).length')
            page.click('[data-npl="seg-del"][data-id="%s"]' % del_target)
            gone = wait_js(page, '(async () => (await npClipsRead()).filter(c => c.videoId).length === %d)()' % (n_before - 1), 8000)
            still = j(page, '''async () => {
                const vs = await npVideosRead();
                const v = vs.find(x => x && x.name === '自检视频·五镜头');
                return { video: !!v, shots: v ? v.shots.length : 0 };
            }''')
            if gone and still['video'] and still['shots'] == shots_before:
                ok('删段只删记录：原视频还在，%d 个镜头没动' % still['shots'])
            else:
                bad('删段把原视频/镜头也动了：%r' % (still,))

            # ⑤ 发案例：挑 2 段 → 锁给笔记 → 进大组装
            j(page, '() => { const st = npLibS(); st.view = "col"; st.colId = "%s"; st.videoId = ""; return npLibRender(npLibCurrentContainer()); }' % col_id)
            page.wait_for_selector('[data-npl="new-case"]', timeout=10000)
            page.click('[data-npl="new-case"]')
            page.wait_for_selector('#nplPickTitle', timeout=8000)
            if page.evaluate('() => (document.getElementById("nplPickTitle")||{}).value === ""') and page.evaluate('() => !!document.getElementById("nplPickTitle")'):
                ok('新案例挑段弹窗：要标题（占位标题有输入框）')
            else:
                bad('新案例挑段弹窗没有标题输入框')
            page.fill('#nplPickTitle', '自检案例·五镜头防水')
            page.fill('#nplPickBrief', '老房翻新，先把基层清理干净再刷防水。')
            page.click('#nplPickSave')
            if wait_js(page, '() => /至少勾 1 段/.test((document.getElementById("nplPickErr")||{}).textContent || "")', 5000):
                ok('挑段弹窗：一段没勾时拦下')
            else:
                bad('挑段弹窗：一段没勾也放过了')
            boxes = page.query_selector_all('#nplPickList input[data-clip]')
            if len(boxes) < 3:
                bad('挑段列表备好的段不足 3（%d）' % len(boxes))
            pick_ids = []
            for b in boxes[:2]:
                b.check()
                pick_ids.append(b.get_attribute('data-clip'))
            page.click('#nplPickSave')
            if not wait_js(page, '() => !!document.querySelector("#noteCaseContent .npc-qmini, #noteCaseContent [data-npc=\\"libpick\\"]")', 20000):
                bad('挑段后没进到大组装页')
            else:
                ok('挑 2 段后回到「大组装」（步骤条：素材库挑段 / 大组装）')
            case_state = j(page, '''async () => {
                const ns = await npNotesAll();
                const n = ns.find(x => x && x.title === '自检案例·五镜头防水');
                if (!n) return null;
                const cs = await npClipsRead();
                return {
                    id: String(n.id), status: n.status, dir: n.dir,
                    refs: (n.asm && n.asm.libClips || []).map(r => String(r.clipId)),
                    brief: n.asm && n.asm.libBrief || '',
                    locks: cs.filter(c => String(c.usedBy || '') === String(n.id)).map(c => String(c.id)),
                    usedNames: cs.filter(c => String(c.usedBy || '') === String(n.id)).map(c => c.usedByName),
                };
            }''')
            if case_state and len(case_state['refs']) == 2 and set(case_state['refs']) == set(case_state['locks']) and set(pick_ids) == set(case_state['refs']):
                ok('笔记存下 2 段，这 2 段已锁给本篇（其余段没锁）')
            else:
                bad('挑段落库/锁定不对：%r（点了 %r）' % (case_state, pick_ids))
            if case_state and case_state['brief'].startswith('老房翻新'):
                ok('案例背景存下了（大组装拿它组织正文）')
            else:
                bad('案例背景没存下：%r' % (case_state and case_state['brief']))

            note_id = case_state['id']
            locked_clip = case_state['locks'][0]

            # ⑤b 被用的段：不能重分镜、不能删、边界锁住
            shots_now = j(page, '''async () => { const v = (await npVideosRead()).find(x => x && x.name === '自检视频·五镜头'); return v.shots.length; }''')
            j(page, 'async () => { await npLibRescan("%s"); }' % vstate['vid'])
            page.wait_for_timeout(1500)
            shots_after = j(page, '''async () => { const v = (await npVideosRead()).find(x => x && x.name === '自检视频·五镜头'); return v.shots.length; }''')
            if shots_after == shots_now:
                ok('有段被笔记用着时，重新分镜被拦下（镜头没变）')
            else:
                bad('有段被用着还重分了镜：%d → %d' % (shots_now, shots_after))
            n_now = j(page, 'async () => (await npClipsRead()).filter(c => c.videoId).length')
            j(page, 'async () => { await npLibDeleteClip("%s"); }' % locked_clip)
            page.wait_for_timeout(800)
            n_after = j(page, 'async () => (await npClipsRead()).filter(c => c.videoId).length')
            if n_after == n_now:
                ok('被笔记用着的段删不掉')
            else:
                bad('被笔记用着的段被删了：%d → %d' % (n_now, n_after))
            j(page, 'async (vid) => { await npLibDeleteVideo(vid); }', vstate['vid'])
            page.wait_for_timeout(600)
            if j(page, 'async (vid) => (await npVideosRead()).some(v => v && String(v.id) === String(vid))', vstate['vid']):
                ok('有段被用着时，整条原视频也删不掉')
            else:
                bad('有段被用着时，整条原视频被删了')
            j(page, 'async () => { await npLibOpenSegEditor("%s"); }' % locked_clip)
            page.wait_for_selector('#nplSegA', state='attached', timeout=8000)
            if page.evaluate('() => document.getElementById("nplSegA").disabled && document.getElementById("nplSegB").disabled'):
                ok('被用着的段：边界输入锁住')
            else:
                bad('被用着的段边界还能改')
            page.fill('#nplSegName', '防水-02-第一遍')
            page.click('#nplSegSave')
            if wait_js(page, '() => !document.querySelector("#nplSegSave")', 8000):
                ok('被用着的段：名字/标签/说明仍可改')
            else:
                bad('被用着的段连名字都改不了')

            # ⑥ 已发＝放开；撤回草稿＝重新锁上
            j(page, 'async (id) => { await npNoteSetStatus(id, "已发"); }', note_id)
            if wait_js(page, '''async (cid) => {
                const c = (await npClipsRead()).find(x => x && String(x.id) === cid);
                return !!c && !c.usedBy;
            }''', 8000, 300, locked_clip):
                ok('标记「已发」：用过的段自动放开')
            else:
                bad('标记「已发」后段还锁着')
            j(page, 'async (id) => { await npNoteSetStatus(id, "草稿"); }', note_id)
            if wait_js(page, '''async (cid) => {
                const c = (await npClipsRead()).find(x => x && String(x.id) === cid);
                return !!c && String(c.usedBy || '') !== '';
            }''', 8000, 300, locked_clip):
                ok('撤回到「草稿」：之前挑的段重新锁上')
            else:
                bad('撤回草稿后段没重新锁上')

            # ⑦ 反向入口：没料的案例 → 素材库 → 命名占位标题 → 回大组装
            page.evaluate('''async () => {
                const cols = await npCollectionsRead();
                const c = cols.find(x => x && x.id === '%s');
                if (c) { c.consent = false; await npCollectionsWrite(cols); }
                return true;
            }''' % col_id)
            nid = page.evaluate('''async () => {
                const n = await npDirNewNote('c', '案例成片');
                return String(n.id);
            }''')
            page.evaluate('''async (id) => {
                const ns = await npNotesAll();
                const n = ns.find(x => x && String(x.id) === id);
                npDirGo(n);
                return true;
            }''', nid)
            if not wait_js(page, '() => !!document.querySelector(".npl-pinbar") && !!document.querySelector("#nplPickTitle")', 20000):
                bad('反向入口：没进素材库/没弹挑段')
            else:
                ok('反向入口：案例没料 → 素材库并记下返回点')
            if page.evaluate('() => (document.getElementById("nplPickConsent")||{}).textContent.indexOf("业主同意") >= 0'):
                ok('业主同意没勾：挑段时提醒一句（不硬拦）')
            else:
                bad('业主同意没勾却没提醒')
            if page.evaluate('() => { const t = document.getElementById("nplPickTitle"); return !!t && t.value === ""; }'):
                ok('占位标题（还没定名）的案例：挑段时能命名')
            else:
                bad('占位标题的案例不能命名')
            page.fill('#nplPickTitle', '反向自检案例·挑一段')
            page.fill('#nplPickBrief', '从档案点进来的案例，缺素材回库挑一段。')
            picked_free = j(page, '''() => {
                const b = Array.from(document.querySelectorAll('#nplPickList input[data-clip]')).find(x => !x.disabled);
                if (!b) return '';
                b.click();
                return String(b.getAttribute('data-clip') || '');
            }''')
            if not picked_free:
                bad('反向入口没有可挑的空闲段')
            page.click('#nplPickSave')
            if not wait_js(page, '''(title) => {
                const c = document.getElementById('noteCaseContent');
                return !!c && c.getClientRects().length > 0 && String(c.textContent || '').indexOf(title) >= 0;
            }''', 20000, 300, '反向自检案例·挑一段'):
                bad('反向入口挑段后没回大组装')
            else:
                ok('挑好段自动回这篇的「大组装」')
            rev = j(page, '''async (id) => {
                const n = (await npNotesAll()).find(x => x && String(x.id) === id);
                return { title: n && n.title, refs: (n && n.asm && n.asm.libClips || []).length };
            }''', nid)
            if rev['title'] == '反向自检案例·挑一段' and rev['refs'] == 1:
                ok('反向入口：占位标题改成真标题，存下 1 段')
            else:
                bad('反向入口落库不对：%r' % (rev,))
            # 恢复同意勾（不影响结论，留给后续手看）
            page.evaluate('''async () => {
                const cols = await npCollectionsRead();
                const c = cols.find(x => x && x.id === '%s');
                if (c) { c.consent = true; await npCollectionsWrite(cols); }
                return true;
            }''' % col_id)

            # ⑦b 「备好了，回下一步」从素材库回案例
            page.evaluate('''async (id) => {
                const n = (await npNotesAll()).find(x => x && String(x.id) === id);
                await npLibEnterCtx(n);
                return true;
            }''', nid)
            if wait_js(page, '() => !!document.querySelector(".npl-pinbar")', 20000):
                if wait_js(page, '() => !!document.querySelector("#nplPickCancel")', 4000):
                    page.click('#nplPickCancel')
                    page.wait_for_timeout(300)
                page.click('.npl-pinbar [data-npl="ctx-back"]')
                if wait_js(page, '''() => {
                    const c = document.getElementById('noteCaseContent');
                    return !!c && c.getClientRects().length > 0 && !document.querySelector('.npl-modal');
                }''', 15000):
                    ok('素材库底下「✓ 备好了，回下一步」：回到这篇大组装')
                else:
                    bad('「备好了，回下一步」没回案例页')
            else:
                bad('没进到这篇的素材库上下文')

            # ⑧ 旧数据入口
            page.evaluate('() => { _npLibPick = null; try { npLibModalClose(); } catch (_) {} switchMainTab("noteAssets"); }')
            page.wait_for_selector('.npl-wrap', timeout=15000)
            page.click('[data-npl="legacy"]')
            if wait_js(page, '() => !!document.querySelector(".npl-legacy-bar")', 15000):
                txt = page.evaluate('() => document.querySelector("#noteAssetsContent").textContent')
                if '旧工地·屋面防水' in txt and '旧数据只读' in txt:
                    ok('旧数据入口：老集合原样能看，标注只读')
                else:
                    bad('旧数据入口没画老集合')
                page.click('[data-npl="backnew"]')
                if wait_js(page, '() => !!document.querySelector(".npl-wrap")', 10000):
                    ok('旧数据能一键回新素材库')
                else:
                    bad('回不到新素材库')
            else:
                bad('旧数据入口没打开')
            old = j(page, '''async () => {
                const cols = await npCollectionsRead();
                const clips = await npClipsRead();
                const c = cols.find(x => x && x.id === 'old-col-1') || null;
                const cl = clips.find(x => x && x.id === 'old-clip-1') || null;
                return { c: c ? { name: c.name, lib: !!c.lib } : null, cl: cl ? { videoId: cl.videoId || '', b: cl.b } : null };
            }''')
            if old['c'] and old['c']['name'] == '旧工地·屋面防水' and not old['c']['lib'] and old['cl'] and old['cl']['b'] == 8 and not old['cl']['videoId']:
                ok('老数据没被迁移/改写（老集合、老片段原样）')
            else:
                bad('老数据被动了：%r' % (old,))

            br.close()
    finally:
        try:
            srv.terminate()
        except Exception:
            pass
        try:
            logf.close()
        except Exception:
            pass

    if errs:
        bad('页内异常 %d 条：%s' % (len(errs), ' | '.join(errs[:3])))
    else:
        ok('全程没有页内异常')
    print('')
    if fails:
        print('结果：%d 项没过' % fails, flush=True)
        sys.exit(1)
    print('结果：全过', flush=True)


if __name__ == '__main__':
    main()
