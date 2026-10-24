# 公网那份（web/）📜 长图出口点检 —— 2026-10-22。
# 走真链路：⑥ 预览点「📜 导出长图」→ 画布排版 → 档案 long: → 代发区 publong: + 元数据 out='long'
#          → 发布台「分图文 / 长图」二选一。
# 三场：① 有图有字（混合比例）、② 纯文字（一张图都没有）、③ 高图超 12000（按段切几张）。
# 只用临时账本（tmp/longimg-check/），不调 AI。
# 用法：python3 -X utf8 scripts/dev/check_longimg_web.py
import os
import sys
import json
import time
import shutil
import base64
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
from _guide_gate import goto_big

sys.stdout.reconfigure(encoding='utf-8')
REPO = Path(__file__).resolve().parents[2]
PORT = 8931
BASE = 'http://127.0.0.1:%d' % PORT
DATA = REPO / 'tmp' / 'longimg-check' / 'data'
OUT = REPO / 'tmp' / 'longimg-check'
fails = 0


def ok(msg):
    print('  PASS ' + msg, flush=True)


def bad(msg):
    global fails
    fails += 1
    print('  FAIL ' + msg, flush=True)


SETUP = r'''async (opt) => {
  const mkShot = (n, desc) => ({ id: 's' + n, text: '第' + n + '屏一句。', role: '', topic: '画面' + n,
    desc: desc, keySid: '', keyText: '', form: '', cap: { mode: '', zone: '', lines: [], labels: [], note: '' },
    clock: false, off: false, dlock: false, sids: [], cands: [], pick: -1, imgs: [] });
  const w = {
    platform: 'xhs', platforms: ['xhs'], dir: opt.dir || 'd', form: '图文', path: 'image', step: 6,
    arId: opt.id,
    draft: { content: '正文第一句。第二句。\n第二段把这件事怎么做的讲清楚。最后一句是收口。', titles: ['这一篇的标题'], tags: [] },
    topics: [], chosenTopicIdx: -1, chosen: [], chosenPeople: [], chosenKb: [],
    styleLook: {}, shots: { style: '', seed: '', groupPrompt: '', groupPromptOwn: false, total: 0, shotN: 0,
      look: {}, sents: [], editing: '', suggest: [], items: [],
      cv: { on: true, copy: '这一句做封面', prompt: '', imgs: [], cap: {} } },
    imgDocs: [], imgOpen: '', imgSibs: [], uiTab: '', visual: null,
    filmDocs: [], voice: '', longform: '', longSrc: '', lTone: '', lTopic: '', lSeed: '', lStep: 0,
    kOut: opt.kOut || '', dOut: ('dOut' in opt) ? opt.dOut : 'img', filmKind: '', noteStyle: {}, write: null, planItem: null,
  };
  if (opt.shots) {
    w.shots.items = opt.shots.map(x => mkShot(x.n, x.desc));
    w.shots.total = w.shots.items.length; w.shots.shotN = w.shots.items.length;
  }
  if (opt.noCover) w.shots.cv.on = false;
  _npWiz = w; _npMode = 'wizard';
  let host = document.getElementById('npLongCheckHost');
  if (!host) {
    host = document.createElement('div'); host.id = 'npLongCheckHost';
    host.style.cssText = 'position:fixed;left:0;top:0;width:920px;background:#fff;z-index:99999;padding:14px;overflow:auto;max-height:100vh;';
    document.body.appendChild(host);
  }
  npWizRender = async function () { const h = document.getElementById('npLongCheckHost'); if (h) h.innerHTML = npDshPreviewHtml(_npWiz); };
  npDshOnStage = function () { return true; };
  ensureNpDelegation();
  await npShotImgIndex();
  npShotsCompose(w);
  await npWizRender();
  return { arId: w.arId };
}'''

MK = r'''async (w, h, c1, c2, label) => new Promise(res => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, c1); g.addColorStop(1, c2);
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  x.fillStyle = 'rgba(255,255,255,.92)';
  x.font = '700 ' + Math.round(Math.min(w, h) / 10) + 'px sans-serif';
  x.fillText(label || (w + '×' + h), w * 0.08, h * 0.5);
  c.toBlob(b => res(new File([b], 't' + Date.now() + '-' + Math.random().toString(36).slice(2, 5) + '.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.9);
})'''

UPLOAD = r'''async (spec) => {
  const mk = eval('(' + spec.mk + ')');
  const w = _npWiz;
  for (const u of spec.list) {
    const f = await mk(u.w, u.h, u.c1, u.c2, u.label);
    await npDshUpload(u.k, [f]);
  }
  return { assets: (await npAsAssetsRead()).length,
    cv: (_npWiz.shots.cv.imgs || []).slice(),
    imgs: (_npWiz.shots.items || []).map(x => (x.imgs || []).slice()),
    picks: npFilmPicks(_npWiz).length };
}'''

DUMP = r'''async () => {
  const id = _npWiz.arId;
  const meta = (await npPubFilesAll())[id] || null;
  const n = Number(_npWiz.longDoc && _npWiz.longDoc.n) || 0;
  const dims = [], datas = [];
  for (let i = 0; i < n; i++) {
    const b = await npCaseGet('long:' + id + ':' + i);
    const pb = await npCaseGet('publong:' + id + ':' + i);
    const dim = await new Promise(r => {
      if (!b) return r({ missing: true, staged: !!pb });
      const u = URL.createObjectURL(b); const im = new Image();
      im.onload = () => { r({ w: im.naturalWidth, h: im.naturalHeight, size: b.size, type: b.type, staged: !!pb }); URL.revokeObjectURL(u); };
      im.onerror = () => r({ err: 1, staged: !!pb }); im.src = u;
    });
    dims.push(dim);
    if (b) {
      const u8 = new Uint8Array(await b.arrayBuffer()); let s = '';
      for (let k = 0; k < u8.length; k += 32768) s += String.fromCharCode.apply(null, u8.subarray(k, k + 32768));
      datas.push(btoa(s));
    } else datas.push('');
  }
  const note = (await npNotesAll()).find(x => x.id === id) || null;
  return { id, meta, n, dims, datas, wDoc: _npWiz.longDoc || null, noteDoc: note && note.longDoc || null,
    body: document.getElementById('npLongCheckHost').innerText };
}'''


def run_export(page, label):
    page.click('#npLongCheckHost .np-long-export')
    for _ in range(240):
        st = page.evaluate('''() => ({ busy: _npLongBusy, n: (_npWiz.longDoc && _npWiz.longDoc.n) || 0 })''')
        if not st.get('busy') and st.get('n'):
            break
        page.wait_for_timeout(500)
    else:
        bad(label + '：导出没跑完')
        return None
    res = page.evaluate(DUMP)
    for i, d in enumerate(res.get('dims') or []):
        if res.get('datas') and res['datas'][i]:
            (OUT / ('%s-%d.png' % (label, i + 1))).write_bytes(base64.b64decode(res['datas'][i]))
    return res


def main():
    print('── 公网📜长图出口：有图 / 纯文字 / 超高分页 ＋ 发布台二选一 ──', flush=True)
    if DATA.exists():
        shutil.rmtree(DATA)
    DATA.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    global PORT, BASE
    import urllib.request
    want = (REPO / 'web' / 'popup.js').stat().st_size
    env = dict(os.environ)
    env['DEMO_DATA_DIR'] = str(DATA)
    env['DEMO_AI_KEY'] = 'check-only'
    env['DEMO_AI_BASE'] = 'http://127.0.0.1:9/v1'
    env['DEMO_SIGNUP_MAX'] = '60'
    # 这台机器上常驻着别的项目的服务，而 Windows 上端口被占照样 bind 得成——探测不可信。
    # 改成起一台验一台：/popup.js 回来的字节数跟本机这份对上，才算这台是我们的。
    # （不对上就会拿到别人那份页面，后面整页 evaluate 报一堆看不懂的「xx is not defined」。）
    logf = srv = None
    for cand in range(PORT, PORT + 24):
        PORT = cand
        BASE = 'http://127.0.0.1:%d' % cand
        env['PORT'] = str(cand)
        logf = open(OUT / 'server.log', 'w', encoding='utf-8')
        srv = subprocess.Popen(['node', str(REPO / 'server' / 'dev-server.mjs')], env=env, stdout=logf, stderr=subprocess.STDOUT)
        got = False
        for _ in range(24):
            try:
                with urllib.request.urlopen(BASE + '/popup.js', timeout=5) as f:
                    if f.status == 200 and len(f.read()) == want:
                        got = True
                        break
            except Exception:
                pass
            time.sleep(0.5)
        if got:
            break
        srv.terminate()
        logf.close()
        srv = None
    else:
        bad('连试 24 个端口都没拿到本机这份 popup.js（这台机器上常驻的服务太多）——看 tmp/longimg-check/server.log')
        return
    time.sleep(2)
    try:
        with sync_playwright() as p:
            br = p.chromium.launch(channel='msedge', headless=True)
            page = br.new_context(viewport={'width': 1500, 'height': 1100}, accept_downloads=True).new_page()
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            page.on('dialog', lambda d: d.accept())
            ai_reqs = []
            page.on('request', lambda r: ai_reqs.append(r.url) if ('/api/ai' in r.url or 'chat/completions' in r.url) else None)
            page.goto(BASE + '/start.html', wait_until='domcontentloaded', timeout=90000)
            page.wait_for_timeout(2000)
            who = page.evaluate('''async () => await (await fetch('/api/auth/demo', { method: 'POST',
                headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'deco' }) })).json()''')
            if not who.get('ok'):
                bad('演示号没进上：%r' % (who,))
                br.close()
                return
            goto_big(page, BASE + '/popup.html?mode=big', wait_until='domcontentloaded', timeout=90000)
            # popup.js 有一万七千行：冷启动要下十几秒，写死等 4 秒会赶在它执行完之前 evaluate（报 ensureNpDelegation 未定义）
            page.wait_for_function('() => typeof window.ensureNpDelegation === "function"', timeout=90000)
            page.wait_for_timeout(1200)

            # ① 有图有字：3 张配图（一张 4:3）＋封面
            shots = [
                {'n': 1, 'desc': '【这一张要证明】门口先立住\n【画面里必须出现的元素】1. 一手拿卷尺；2. 捏着报价单'},
                {'n': 2, 'desc': '【这一张要证明】单子上漏了那一行\n【画面里必须出现的元素】摊开的报价单和笔'},
                {'n': 3, 'desc': '【这一张要证明】最后把话收住\n【画面里必须出现的元素】人站在完工的门口'},
            ]
            page.evaluate(SETUP, {'id': 'longchk1', 'shots': shots})
            page.wait_for_timeout(500)
            idle = page.evaluate('''() => ({ text: document.getElementById('npLongCheckHost').innerText,
                btn: !!document.querySelector('#npLongCheckHost .np-long-export') })''')
            if idle.get('btn') and '📜 导出长图' in idle.get('text', '') and '1080 宽' in idle.get('text', ''):
                ok('⑥ 预览摆出「📜 导出长图」，口径写着 1080 宽 / 超 12000 按段切 / 不扣额度')
            else:
                bad('⑥ 预览没摆对：%r' % (idle,))
            up = page.evaluate(UPLOAD, {'mk': MK, 'list': [
                {'k': 'cv', 'w': 1080, 'h': 1440, 'c1': '#b08a3e', 'c2': '#6b4f1f', 'label': '封面 3:4'},
                {'k': 's1', 'w': 900, 'h': 1200, 'c1': '#c96f4a', 'c2': '#7a3b2a', 'label': '配图 1'},
                {'k': 's2', 'w': 1200, 'h': 900, 'c1': '#4a6fc9', 'c2': '#2a3b7a', 'label': '配图 2 · 4:3'},
                {'k': 's3', 'w': 900, 'h': 1200, 'c1': '#4a8a6a', 'c2': '#2a5a3b', 'label': '配图 3'},
            ]})
            if up.get('assets') == 4 and up.get('picks') == 4 and up.get('cv'):
                ok('四张图都走真上传链路进了素材库（封面 1＋配图 3），⑥ 预览认到 4 段')
            else:
                bad('上传没走通：%r' % (up,))
            page.locator('#npLongCheckHost').screenshot(path=str(OUT / '1-preview.png'))
            ai_before = len(ai_reqs)
            r1 = run_export(page, 'r1')
            if not r1:
                bad('① 有图这单没出结果')
            else:
                dims = r1.get('dims') or []
                m = r1.get('meta') or {}
                wd = r1.get('wDoc') or {}
                if r1.get('n') == 1 and dims and dims[0].get('w') == 1080 and 0 < dims[0].get('h', 0) <= 12000:
                    ok('一张竖图出成：宽 1080、高 %s（≤12000），%s %dKB' % (dims[0].get('h'), (dims[0].get('type') or '').replace('image/', '').upper(), (dims[0].get('size') or 0) // 1024))
                else:
                    bad('长图尺寸不对：%r' % (dims,))
                if m.get('out') == 'long' and m.get('longN') == 1 and m.get('kind') == 'img' and m.get('n') == 0:
                    ok('代发区元数据：out=long、longN=1、kind=img（分图文那套没被污染）')
                else:
                    bad('代发区元数据不对：%r' % (m,))
                if dims and dims[0].get('staged') and r1.get('noteDoc', {}).get('n') == 1:
                    ok('档案留了长期那份（long:）、代发区也放了发的时候那份（publong:），档案 longDoc 记了 1 张')
                else:
                    bad('存档 / 代发区没落全：noteDoc=%r staged=%r' % (r1.get('noteDoc'), dims and dims[0].get('staged')))
                if '✓ 已出 1 张' in (r1.get('body') or '') and '↻ 重排' in (r1.get('body') or '') and '⬇ 下载' in (r1.get('body') or ''):
                    ok('出完预览换成「✓ 已出 1 张 ＋ ↻ 重排 ＋ ⬇ 下载」')
                else:
                    bad('出完的预览条不对：%r' % ((r1.get('body') or '')[:300],))
                page.locator('#npLongCheckHost').screenshot(path=str(OUT / '2-exported.png'))
            if len(ai_reqs) == ai_before:
                ok('整场导出没打一次 AI / 出图接口（只本机排版）')
            else:
                bad('导出期间打了 AI：%r' % (ai_reqs[ai_before:][:3],))

            # ② 纯文字：一张图都没有（封面关掉、没有配图）——长图照样出
            page.evaluate(SETUP, {'id': 'longchk2', 'shots': [], 'noCover': True})
            page.wait_for_timeout(500)
            r2 = run_export(page, 'r2')
            if r2 and r2.get('n') and (r2.get('dims') or [{}])[0].get('w') == 1080:
                ok('一张图都没有：按正文段落排出纯文字长图（宽 1080、高 %s）' % ((r2.get('dims') or [{}])[0].get('h')))
            else:
                bad('纯文字长图没出成：%r' % (r2 and r2.get('dims')))

            # ③ 高图：4 张 1000×3000（每段 3240 高）→ 必然超 12000，按段切成几张
            page.evaluate(SETUP, {'id': 'longchk3', 'shots': [
                {'n': 1, 'desc': '【这一张要证明】第一段'}, {'n': 2, 'desc': '【这一张要证明】第二段'},
                {'n': 3, 'desc': '【这一张要证明】第三段'}, {'n': 4, 'desc': '【这一张要证明】第四段'},
            ], 'noCover': True})
            page.wait_for_timeout(500)
            page.evaluate(UPLOAD, {'mk': MK, 'list': [
                {'k': 's1', 'w': 1000, 'h': 3000, 'c1': '#6b4f8a', 'c2': '#3b2a5a', 'label': '高图 1'},
                {'k': 's2', 'w': 1000, 'h': 3000, 'c1': '#8a6b4f', 'c2': '#5a3b2a', 'label': '高图 2'},
                {'k': 's3', 'w': 1000, 'h': 3000, 'c1': '#4f8a7a', 'c2': '#2a5a4a', 'label': '高图 3'},
                {'k': 's4', 'w': 1000, 'h': 3000, 'c1': '#8a4f6b', 'c2': '#5a2a3b', 'label': '高图 4'},
            ]})
            r3 = run_export(page, 'r3')
            dims3 = (r3 or {}).get('dims') or []
            if r3 and r3.get('n', 0) >= 2 and all(d.get('w') == 1080 and d.get('h', 0) <= 12000 for d in dims3):
                ok('四张高图超 12000：自动切成 %d 张，每张宽 1080、高都不超（%r）' % (r3['n'], [d.get('h') for d in dims3]))
            else:
                bad('超高没按段切好：n=%r dims=%r' % (r3 and r3.get('n'), dims3))
            m3 = (r3 or {}).get('meta') or {}
            if m3.get('longN') == (r3 or {}).get('n'):
                ok('切几张，代发区的 longN 就记几张（%r）' % (m3.get('longN'),))
            else:
                bad('分页后 longN 对不上：%r' % (m3,))

            # ③b 出口只管引流图文：知识线、长文线、视频线都不该冒出「导出长图」
            gate_cases = [
                ('知识线', {'id': 'longchk4', 'shots': [], 'noCover': True, 'dir': 'k', 'dOut': '', 'kOut': 'img'}),
                ('长文线', {'id': 'longchk4', 'shots': [], 'noCover': True, 'dOut': 'long'}),
                ('视频线', {'id': 'longchk4', 'shots': [], 'noCover': True, 'dOut': 'film'}),
            ]
            gate_bad = []
            for lab, cfg in gate_cases:
                page.evaluate(SETUP, cfg)
                page.wait_for_timeout(250)
                g = page.evaluate('''() => ({ btn: !!document.querySelector('#npLongCheckHost .np-long-export'),
                    txt: document.getElementById('npLongCheckHost').innerText })''')
                if g.get('btn') or '导出长图' in (g.get('txt') or ''):
                    gate_bad.append(lab)
            if not gate_bad:
                ok('「导出长图」只在引流图文出现：知识线 / 长文线 / 视频线都没有')
            else:
                bad('这几条线不该有「导出长图」：%r' % (gate_bad,))

            # ④ 发布台二选一：把 w1 这篇推进「代发」＋排进今天，再补一套分图文
            page.evaluate(SETUP, {'id': 'longchk1', 'shots': shots})
            page.wait_for_timeout(300)
            page.evaluate(UPLOAD, {'mk': MK, 'list': [
                {'k': 'cv', 'w': 1080, 'h': 1440, 'c1': '#b08a3e', 'c2': '#6b4f1f', 'label': '封面 3:4'},
                {'k': 's1', 'w': 900, 'h': 1200, 'c1': '#c96f4a', 'c2': '#7a3b2a', 'label': '配图 1'},
                {'k': 's2', 'w': 1200, 'h': 900, 'c1': '#4a6fc9', 'c2': '#2a3b7a', 'label': '配图 2 · 4:3'},
                {'k': 's3', 'w': 900, 'h': 1200, 'c1': '#4a8a6a', 'c2': '#2a5a3b', 'label': '配图 3'},
            ]})
            r1b = run_export(page, 'r1b')
            desk = page.evaluate('''async (mk) => {
              const mkf = eval('(' + mk + ')');
              const w = _npWiz; const id = w.arId;
              await npArchiveSave(w, '代发');
              const files = [];
              for (let i = 0; i < 3; i++) files.push(await mkf(900, 1200, '#777', '#333', '分图 ' + (i + 1)));
              await npPubStageFiles(id, files, false, 4, { sig: 'split-set-1' });
              const meta0 = (await npPubFilesAll())[id] || null;
              const day = ['sun','mon','tue','wed','thu','fri','sat'][new Date().getDay()];
              const wp = npWeekPlanEmpty(); wp[day] = ['引流'];
              await npWeekPlanSave(wp);
              await npQueueTake('w1:' + day + ':引流', id);
              const lh = document.getElementById('npLongCheckHost'); if (lh) lh.style.display = 'none';
              let host = document.getElementById('npDeskCheckHost');
              if (!host) { host = document.createElement('div'); host.id = 'npDeskCheckHost';
                host.style.cssText = 'position:fixed;left:0;top:0;width:1100px;background:#fff;z-index:99998;padding:14px;overflow:auto;max-height:100vh;';
                document.body.appendChild(host); }
              await renderNoteQueue(host);
              return { id, meta0, text: host.innerText,
                splitBtn: !!host.querySelector('[data-np="npq-out"][data-out="split"]'),
                longBtn: !!host.querySelector('[data-np="npq-out"][data-out="long"]'),
                splitActive: (host.querySelector('[data-np="npq-out"][data-out="split"]') || {}).style,
                longActive: (host.querySelector('[data-np="npq-out"][data-out="long"]') || {}).style };
            }''', MK)
            if desk.get('splitBtn') and desk.get('longBtn'):
                ok('发布台行上摆出「分图文 3 / 长图 1」两颗钮')
            else:
                bad('发布台没摆出二选一：%r' % (desk,))
            if (desk.get('meta0') or {}).get('out') == 'split':
                ok('新交一套分图文（指纹变了）＝自动先按分图文发，不拿旧长图顶新图')
            else:
                bad('换分图文后 out 没退回 split：%r' % (desk.get('meta0'),))
            page.locator('#npDeskCheckHost').screenshot(path=str(OUT / '3-desk-split.png'))
            page.click('#npDeskCheckHost [data-np="npq-out"][data-out="long"]')
            page.wait_for_timeout(800)
            after1 = page.evaluate('''async () => ({ meta: (await npPubFilesAll())[_npWiz.arId] || null,
                active: (document.querySelector('#npDeskCheckHost [data-np="npq-out"][data-out="long"]') || {}).style.background })''')
            if (after1.get('meta') or {}).get('out') == 'long':
                ok('点「长图」＝这篇改按长图发（元数据 out=long，长图那份还在）')
            else:
                bad('点长图没切过去：%r' % (after1,))
            page.locator('#npDeskCheckHost').screenshot(path=str(OUT / '4-desk-long.png'))
            page.click('#npDeskCheckHost [data-np="npq-out"][data-out="split"]')
            page.wait_for_timeout(800)
            after2 = page.evaluate('''async () => ({ meta: (await npPubFilesAll())[_npWiz.arId] || null })''')
            if (after2.get('meta') or {}).get('out') == 'split':
                ok('再点「分图文」＝切回来（两套都留着，随时换）')
            else:
                bad('切回分图文失败：%r' % (after2,))
            if errs:
                bad('页面抛错：%r' % (errs[:6],))
            else:
                ok('整场没有页面异常')
            br.close()
    finally:
        try:
            srv.terminate()
        except Exception:
            pass
        logf.close()
    print('\n结果：%s（图在 tmp/longimg-check/）' % ('全过' if fails == 0 else '%d 项没过' % fails), flush=True)
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
