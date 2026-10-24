# 公网那份（web/）⑤「🖼 一键出图」点检 —— 2026-10-21。
# 走真链路：页面点击 → genNoteImage → 桩接口出一张 PNG → 服务器落 blob → 页面拿回 File →
# 进素材库 / 挂到分镜 / 封面 → 整组铺进代发区（np_pub_files 带 need / src=imgapi）。
# 只用临时账本（tmp/imgapi-check/），AI 与出图都拨到本机小桩，绝不碰真 Key。
# 用法：python3 -X utf8 scripts/dev/check_imgapi_web.py
import os
import sys
import json
import time
import shutil
import socket
import struct
import zlib
import base64
import threading
import subprocess
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright
from _guide_gate import goto_big

sys.stdout.reconfigure(encoding='utf-8')
REPO = Path(__file__).resolve().parents[2]
PORT = 8897
BASE = 'http://127.0.0.1:%d' % PORT
DATA = REPO / 'tmp' / 'imgapi-check' / 'data'
OUT = REPO / 'tmp' / 'imgapi-check'
fails = 0


def ok(msg):
    print('  PASS ' + msg, flush=True)


def bad(msg):
    global fails
    fails += 1
    print('  FAIL ' + msg, flush=True)


def png_solid(w=64, h=64, rgb=(208, 82, 92)):
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
    def do_POST(self):
        self.rfile.read(int(self.headers.get('content-length') or 0))
        time.sleep(1.6)   # 留出看进度条的窗口：确认「已等 N 秒」和进度条在走
        body = json.dumps({'data': [{'b64_json': PNG_B64}]}).encode()
        self.send_response(200)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


class AiStub(BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get('content-length') or 0))
        body = b'{"choices":[{"message":{"content":"{}"}}]}'
        self.send_response(200)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


SETUP = r'''async () => {
  const shot = (n, topic, desc, cap) => ({ id: 's' + n, text: '第' + n + '屏一句。', role: '', topic: topic,
    desc: desc, keySid: '', keyText: cap, form: '', cap: { mode: '', zone: '', lines: [], labels: [], note: '' },
    clock: false, off: false, dlock: false, sids: [], cands: [], pick: -1, imgs: [] });
  const A = '【这一张要证明】门口先立住\n【画面里必须出现的元素】1. 一手拿卷尺；2. 捏着报价单\n【背景】建材城大门口，头顶一盏碘钨灯';
  const B = '报价单摊在膝盖上，笔尖停在空白的备注栏。';
  const w = {
    platform: 'xhs', platforms: ['xhs'], dir: 'd', path: 'image', step: 5,
    arId: 'imgchk' + Date.now(), draft: { content: '正文一句。第二句。', titles: ['这一篇的标题'], tags: [] },
    topics: [], chosenTopicIdx: -1, chosen: [], chosenPeople: [], chosenKb: [],
    styleLook: { casting: '40 岁男瓦工，短寸头，深蓝工装外套' },
    shots: { style: '', seed: '', groupPrompt: '', groupPromptOwn: false, total: 2, shotN: 2,
      look: { motif: '暗调实拍·单一暖光源', born: '手机随拍', casting: '40 岁男瓦工，短寸头，深蓝工装外套' },
      sents: [], editing: '', suggest: [],
      items: [shot(1, '工地门口', A, '跑了两周，腰围先骗了我一次'), shot(2, '空白报价单', B, '坑在没写进单子里的那一行')],
      cv: { on: true, copy: '这一句做封面', prompt: '', imgs: [], cap: {} } },
    imgDocs: [], imgOpen: '', imgSibs: [], uiTab: '', visual: null,
    filmDocs: [], voice: '', longform: '', longSrc: '', lTone: '', lTopic: '', lSeed: '', lStep: 0,
    kOut: '', dOut: '', filmKind: '', noteStyle: {}, write: null, planItem: null,
  };
  _npWiz = w; _npMode = 'wizard';
  const nc = document.getElementById('notePublishContent') || document.body;
  let host = document.getElementById('npImgCheckHost');
  if (!host) {
    host = document.createElement('div'); host.id = 'npImgCheckHost';
    host.style.cssText = 'position:fixed;left:0;top:0;width:760px;background:#fff;z-index:99999;padding:14px;overflow:auto;';
    document.body.appendChild(host);
  }
  npWizRender = async function () { const h = document.getElementById('npImgCheckHost'); if (h) h.innerHTML = npDshStepHtml(_npWiz); };
  npDshOnStage = function () { return true; };   // 真容器藏着，测试台自己当舞台
  ensureNpDelegation();
  await npWizRender(nc);
  return { arId: w.arId };
}'''


def main():
    print('── 公网⑤一键出图：额度条 / 直接出图 / 真出图 / 重出 / 自动铺进代发区 ──', flush=True)
    if DATA.exists():
        shutil.rmtree(DATA)
    DATA.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    imgstub = ThreadingHTTPServer(('127.0.0.1', 0), ImgStub)
    aistub = ThreadingHTTPServer(('127.0.0.1', 0), AiStub)
    threading.Thread(target=imgstub.serve_forever, daemon=True).start()
    threading.Thread(target=aistub.serve_forever, daemon=True).start()
    env = dict(os.environ)
    env['DEMO_DATA_DIR'] = str(DATA)
    env['PORT'] = str(PORT)
    env['DEMO_AI_KEY'] = 'check-only'
    env['DEMO_AI_BASE'] = 'http://127.0.0.1:%d/v1' % aistub.server_port
    env['DEMO_SIGNUP_MAX'] = '60'
    env['IMAGE_API_KEY'] = 'check-only'
    env['IMAGE_API_BASE'] = 'http://127.0.0.1:%d/api/v3' % imgstub.server_port
    env['IMAGE_QUOTA_TRIAL'] = '10'
    env['IMAGE_DAILY_CAP'] = '500'
    logf = open(OUT / 'server.log', 'w', encoding='utf-8')
    srv = subprocess.Popen(['node', str(REPO / 'server' / 'dev-server.mjs')], env=env, stdout=logf, stderr=subprocess.STDOUT)
    for _ in range(80):
        try:
            socket.create_connection(('127.0.0.1', PORT), 1).close()
            break
        except OSError:
            time.sleep(0.5)
    else:
        bad('服务器没起来（看 tmp/imgapi-check/server.log）')
        return
    time.sleep(2)
    try:
        with sync_playwright() as p:
            br = p.chromium.launch(channel='msedge', headless=True)
            page = br.new_context(viewport={'width': 1500, 'height': 1100}).new_page()
            errs = []
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
            page.wait_for_timeout(4000)
            page.evaluate(SETUP)
            page.wait_for_timeout(1800)   # 等 getImageQuota 回来
            idle = page.evaluate('''() => ({
              used: _npImgQuota && _npImgQuota.used, max: _npImgQuota && _npImgQuota.max,
              left: _npImgQuota && _npImgQuota.left, keyReady: _npImgQuota && _npImgQuota.keyReady,
              mode: _npImgQuota && _npImgQuota.mode, unlimited: _npImgQuota && _npImgQuota.unlimited,
              dayUsed: _npImgQuota && _npImgQuota.dayUsed, err: _npImgQuotaErr,
              card: document.getElementById('npImgCheckHost').innerText,
              open: !!document.querySelector('#npImgCheckHost .np-img-open'),
              btnCls: (() => { const b = document.querySelector('#npImgCheckHost .np-img-open'); return b ? b.className : ''; })(),
              sameSize: (() => {
                const b = document.querySelector('#npImgCheckHost .np-img-open');
                const up = b && b.parentElement && b.parentElement.querySelector('.np-dsh-upmany');
                const lb = up && up.closest('label');
                if (!b || !lb) return false;
                return Math.abs(b.getBoundingClientRect().height - lb.getBoundingClientRect().height) <= 2;
              })(),
              group: ((document.querySelector('#npDshGroup') || {}).value || ''),
              row: (() => { const b = document.querySelector('#npImgCheckHost .np-img-open');
                return !!(b && b.parentElement && b.parentElement.querySelector('.np-dsh-upmany')); })(),
              sameCard: (() => { const b = document.querySelector('#npImgCheckHost .np-img-open');
                return !!(b && b.parentElement && b.parentElement.parentElement &&
                  b.parentElement.parentElement.querySelectorAll('.np-dsh-cell').length === 2); })(),
              cells: document.querySelectorAll('#npImgCheckHost .np-dsh-cell').length,
              cover: !!document.querySelector('#npImgCheckHost .np-dsh-cvcell')
            })''')
            page.locator('#npImgCheckHost').screenshot(path=str(OUT / '1-idle.png'))
            if idle.get('mode') == 'demo' and idle.get('unlimited') and idle.get('used') == 0 and idle.get('keyReady'):
                ok('额度条拿到了：演示号不限张数，Key 就绪（页面只拿张数，不拿 Key）')
            else:
                bad('额度条不对：%r' % (idle,))
            if idle.get('open') and '一键出图（3 张）' in idle.get('card', '') and '演示号 · 出图不限张数' in idle.get('card', '') and idle.get('cells') == 2 and idle.get('cover'):
                ok('⑤ 摆出了出图入口：缺 2 张配图＋封面 → 一键出图（3 张），传图区有封面格')
            else:
                bad('出图入口没摆对：%r' % (idle,))
            if idle.get('row') and idle.get('sameCard'):
                ok('「🖼 一键出图」就在「⬆ 传图 / ⬆ 传封面」同一排，额度与进度也在传图同一张卡里')
            else:
                bad('出图按钮没并进传图行：%r' % (idle,))
            if 'btn-primary' in idle.get('btnCls', '') and 'btn-sm' not in idle.get('btnCls', '') and idle.get('sameSize'):
                ok('一键出图按钮和「⬆ 传图」同档大小、同款实心色，不再是角落里的小按钮')
            else:
                bad('出图按钮不够大/不显眼：%r' % (idle,))
            if '兼封面' not in idle.get('group', '') and '字要大' in idle.get('group', '') and '一眼读清' in idle.get('group', ''):
                ok('提示词口径对齐：不再写「第 1 张兼封面」，图上文案要求「字要大、一眼读清」')
            else:
                bad('提示词口径不对：%r' % (idle.get('group', '')[:400],))
            page.click('#npImgCheckHost .np-img-open')
            page.wait_for_timeout(400)
            conf = page.evaluate('''() => ({ text: document.getElementById('npImgCheckHost').innerText,
                go: !!document.querySelector('#npImgCheckHost .np-img-go'),
                running: !!(_npImgGen && _npImgGen.running),
                elapsed: (document.getElementById('npImgElapsed') || {}).textContent || '' })''')
            page.locator('#npImgCheckHost').screenshot(path=str(OUT / '2-run.png'))
            if not conf.get('go') and conf.get('running') and '已等' in conf.get('elapsed', '') and '出这' not in conf.get('text', ''):
                ok('点一下直接开画：不再弹「出这 3 张」确认，立刻进进度')
            else:
                bad('点一下没直接出图：%r' % (conf,))
            page.wait_for_timeout(600)
            pg1 = page.evaluate('''() => ({
              txt: (document.getElementById('npImgElapsed') || {}).textContent || '',
              bar: (document.getElementById('npImgBar') || {}).style ? document.getElementById('npImgBar').style.width : '',
              tick: !!_npImgTick, cur: (_npImgGen || {}).cur || '',
              note: document.getElementById('npImgCheckHost').innerText })''')
            page.wait_for_timeout(900)
            pg2 = page.evaluate('''() => ({
              txt: (document.getElementById('npImgElapsed') || {}).textContent || '',
              bar: (document.getElementById('npImgBar') || {}).style ? document.getElementById('npImgBar').style.width : '',
              tick: !!_npImgTick, cur: (_npImgGen || {}).cur || '' })''')
            if '已等' in pg1.get('txt', '') and 'AI 正在画' in pg1.get('txt', '') and '20~40 秒' in pg1.get('note', ''):
                ok('出图时给出进度：写着「AI 正在画 · 已等 N 秒」＋「一张一般 20~40 秒」的实情')
            else:
                bad('进度文案没出来：%r' % (pg1,))
            try:
                b1 = float(str(pg1.get('bar') or '0').replace('%', ''))
                b2 = float(str(pg2.get('bar') or '0').replace('%', ''))
            except Exception:
                b1 = b2 = -1
            sim = page.evaluate('''() => npImgPct({ running: true, total: 3, done: 0,
              curAt: Date.now() - 20000, phase: 'gen', attempt: 1 })''')
            if pg2.get('tick') and pg2.get('txt') != pg1.get('txt') and 8 <= int(sim) <= 40:
                ok('计时器每秒在走（%r → %r）；照真一张画 20 秒算，进度条该到 %d%%——不会停在 0%%'
                   % (pg1.get('txt'), pg2.get('txt'), int(sim)))
            else:
                bad('进度没在走：%r → %r，20 秒模拟=%r' % (pg1, pg2, sim))
            gave_up = False
            for _ in range(120):
                st = page.evaluate('''() => ({ run: !!(_npImgGen && _npImgGen.running), done: _npImgGen && _npImgGen.done,
                    ok: _npImgGen && _npImgGen.ok, fail: _npImgGen && _npImgGen.fail, err: _npImgGen && _npImgGen.err })''')
                if not st.get('run') and (st.get('done') or 0) >= 3:
                    break
                if not st.get('run') and st.get('err'):
                    gave_up = True
                    break
                page.wait_for_timeout(500)
            page.wait_for_timeout(1200)   # 等收尾那次额度刷新回来（全站当日用量）
            res = page.evaluate('''async () => {
              const assets = await npAsAssetsRead();
              const pub = await npPubFilesAll();
              return { run: _npImgGen, used: _npImgQuota && _npImgQuota.used, left: _npImgQuota && _npImgQuota.left,
                unlimited: _npImgQuota && _npImgQuota.unlimited, dayUsed: _npImgQuota && _npImgQuota.dayUsed,
                shots: (_npWiz.shots.items || []).map(x => (x.imgs || []).length),
                cover: (_npWiz.shots.cv.imgs || []).length,
                genAssets: assets.filter(a => a.genUrl).map(a => a.id),
                pub: pub[_npWiz.arId] || null,
                card: document.getElementById('npImgCheckHost').innerText,
                cardImgs: document.querySelectorAll('#npImgCheckHost .np-dsh-cell img').length,
                cvImg: document.querySelectorAll('#npImgCheckHost .np-dsh-cvcell img').length };
            }''')
            page.locator('#npImgCheckHost').screenshot(path=str(OUT / '3-done.png'))
            g = res.get('run') or {}
            if g.get('ok') == 3 and g.get('fail') == 0 and res.get('shots') == [1, 1] and res.get('cover') == 1:
                ok('三张全出成：2 张配图各挂 1 张、封面 1 张；页面缩略图也回来了')
            else:
                bad('出图结果不对：%r' % (res,))
                if gave_up:
                    print('      运行先停了：%r' % (g,), flush=True)
            if res.get('unlimited') and res.get('dayUsed') == (idle.get('dayUsed') or 0) + 3 and '演示号 · 出图不限张数' in res.get('card', ''):
                ok('演示号不按张限：3 张全出，额度条还写「不限张数」；全站当日用量 %d → %d'
                   % (idle.get('dayUsed') or 0, res.get('dayUsed') or 0))
            else:
                bad('演示号额度口径不对：%r' % (res.get('dayUsed'),))
            if len(res.get('genAssets') or []) == 3:
                ok('3 张原图都进了素材库，带着服务器原图链接（genUrl）')
            else:
                bad('素材库里的 genUrl 张数不对：%r' % (res.get('genAssets'),))
            pm = res.get('pub') or {}
            if pm.get('src') == 'imgapi' and pm.get('n') == 3 and pm.get('need') == 3 and pm.get('sig'):
                ok('整组自动铺进代发区：3 份、need=3、带 imgapi 指纹（发布台直接能发）')
            else:
                bad('代发区没铺对：%r' % (pm,))
            page.click('#npImgCheckHost .np-dsh-cvcell .np-dsh-regen')
            page.wait_for_timeout(600)
            for _ in range(60):
                st = page.evaluate('''() => ({ run: !!(_npImgGen && _npImgGen.running), done: _npImgGen && _npImgGen.done, err: _npImgGen && _npImgGen.err })''')
                if not st.get('run'):
                    break
                page.wait_for_timeout(500)
            page.wait_for_timeout(1200)   # 等收尾额度刷新
            reg = page.evaluate('''async () => {
              const assets = await npAsAssetsRead();
              const pub = await npPubFilesAll();
              return { used: _npImgQuota && _npImgQuota.used, dayUsed: _npImgQuota && _npImgQuota.dayUsed,
                unlimited: _npImgQuota && _npImgQuota.unlimited, cover: (_npWiz.shots.cv.imgs || []).length,
                genIds: assets.filter(a => a.genUrl).map(a => a.id), pub: pub[_npWiz.arId] || null,
                run: _npImgGen, card: document.getElementById('npImgCheckHost').innerText };
            }''')
            page.locator('#npImgCheckHost').screenshot(path=str(OUT / '4-regen.png'))
            if reg.get('unlimited') and reg.get('dayUsed') == (res.get('dayUsed') or 0) + 1 and reg.get('cover') == 1 and (reg.get('run') or {}).get('ok') == 1:
                ok('封面单张重出：演示号不扣张数，全站当日用量只 +1（%d → %d）；封面上还是 1 张（新的换掉旧的）'
                   % (res.get('dayUsed') or 0, reg.get('dayUsed') or 0))
            else:
                bad('重出不对：%r' % (reg,))
            if len(reg.get('genIds') or []) == 4:
                ok('重出另存了一张原图（旧图仍在素材库，不删用户素材）')
            else:
                bad('重出后素材张数不对：%r' % (reg.get('genIds'),))
            led = json.loads((DATA / 'store.json').read_text(encoding='utf-8')).get('image_quota') or {}
            lrec = (led.get('by') or {}).get('demo_deco_full') or {}
            if led.get('used') == 4 and lrec.get('trialUsed') == 0 and lrec.get('total') == 4:
                ok('账本对：演示号没动试用那 10 张（trialUsed=0），全站当日记 4 张、账号累计 4 张')
            else:
                bad('演示号账本不对：%r' % (led,))
            pm2 = reg.get('pub') or {}
            if pm2.get('n') == 3 and pm2.get('sig') and pm2.get('sig') != pm.get('sig'):
                ok('重出后自动重铺：代发区还是 3 份、指纹换成了新封面那一套')
            else:
                bad('重出后没重铺：%r' % (pm2,))
            # ⑤ 点小图 → 看大图：取服务器原图（不是 160px 缩略图），点一下也选中这张
            cell = page.locator('#npImgCheckHost .np-dsh-cell.np-img-view').first
            cidx = int(cell.get_attribute('data-i') or '-1')
            cell.click(position={'x': 26, 'y': 32})
            page.wait_for_timeout(700)
            v5 = page.evaluate('''() => {
              const m = _npImgViewEl;
              const img = m && m.el.querySelector('.np-imgview-stage img');
              return { open: !!m, src: img ? img.src : '', z: m ? getComputedStyle(m.el).zIndex : '',
                title: m ? (m.el.querySelector('.np-imgview-name') || {}).textContent : '',
                sel: _npDshSel, newTab: !!(m && m.el.querySelector('.np-imgview-new')) };
            }''')
            page.screenshot(path=str(OUT / '6-view-5.png'))
            if v5.get('open') and '/api/blob/' in v5.get('src', '') and v5.get('z') == '2147483000':
                ok('⑤ 点小图弹全屏大图：取的是服务器原图（/api/blob/），没拿 160px 缩略图糊弄')
            else:
                bad('⑤ 看大图不对：%r' % (v5,))
            if cidx >= 0 and v5.get('sel') == cidx and v5.get('newTab'):
                ok('点小图顺手把第 %d 张选中了；大图里还有「⤢ 新标签打开」可再放大看字' % (cidx + 1))
            else:
                bad('看大图没选中这张 / 没有新标签按钮：%r' % (v5,))
            page.keyboard.press('Escape')
            page.wait_for_timeout(300)
            if not page.evaluate('() => !!_npImgViewEl'):
                ok('按 Esc 关得掉大图，回到 ⑤')
            else:
                bad('Esc 没关掉大图')
            # ⑥ 预览：卡片点开也是原图；图文不再有「导出长图」这条路
            page.evaluate('''() => {
              let h = document.getElementById('npImgCheckHost6');
              if (!h) { h = document.createElement('div'); h.id = 'npImgCheckHost6';
                h.style.cssText = 'position:fixed;left:780px;top:0;width:700px;max-height:1100px;overflow:auto;background:#fff;z-index:99999;padding:14px;';
                document.body.appendChild(h); }
              h.innerHTML = npDshPreviewHtml(_npWiz);
            }''')
            page.wait_for_timeout(500)
            v6 = page.evaluate('''() => {
              const h = document.getElementById('npImgCheckHost6');
              return { text: h.innerText, views: h.querySelectorAll('.np-img-view').length,
                badge: h.querySelectorAll('.np-img-view span').length };
            }''')
            page.locator('#npImgCheckHost6').screenshot(path=str(OUT / '7-preview6.png'))
            if v6.get('views') == 3 and '导出长图' not in v6.get('text', '') and '分图文' not in v6.get('text', ''):
                ok('⑥ 预览：3 张卡都能点（封面＋2 张配图）；「导出长图 / 分图文」这条出口已经不在了')
            else:
                bad('⑥ 预览不对：%r' % (v6,))
            if '点图可看大图' in v6.get('text', ''):
                ok('⑥ 页面自己写清了「点图可看大图」')
            else:
                bad('⑥ 没提示点图看大图：%r' % (v6.get('text', '')[:200],))
            page.locator('#npImgCheckHost6 .np-img-view').first.click(position={'x': 80, 'y': 100})
            page.wait_for_timeout(700)
            v6o = page.evaluate('''() => {
              const m = _npImgViewEl;
              const img = m && m.el.querySelector('.np-imgview-stage img');
              return { open: !!m, src: img ? img.src : '', z: m ? getComputedStyle(m.el).zIndex : '' };
            }''')
            page.screenshot(path=str(OUT / '8-view-6.png'))
            if v6o.get('open') and '/api/blob/' in v6o.get('src', '') and v6o.get('z') == '2147483000':
                ok('⑥ 点合成卡也是全屏原图——图里的字这回能看清了')
            else:
                bad('⑥ 点卡看大图不对：%r' % (v6o,))
            page.click('.np-imgview-close')
            page.wait_for_timeout(300)
            src_txt = (REPO / 'web' / 'popup.js').read_text(encoding='utf-8')
            if 'npq-out' not in src_txt and 'outTog' not in src_txt and 'const longBox' not in src_txt:
                ok('源码里也没有「分图文/长图」二选一的残口（npq-out / outTog / ⑥ 长图框 全清）')
            else:
                bad('源码里还留着长图出口的残件')
            # 没 Key 的界面态（只拨页面状态，不碰服务器配置）：空出一格 → 按钮该灰、该说清为什么
            nokey = page.evaluate('''() => {
              _npWiz.shots.items[0].imgs = [];
              _npImgQuota = Object.assign({}, _npImgQuota, { keyReady: false });
              npWizRender(npActiveC());
              const b = document.querySelector('#npImgCheckHost .np-img-open');
              return { disabled: !!(b && b.disabled), text: document.getElementById('npImgCheckHost').innerText };
            }''')
            page.wait_for_timeout(300)
            page.locator('#npImgCheckHost').screenshot(path=str(OUT / '5-nokey.png'))
            if nokey.get('disabled') and '一键出图暂时用不了' in nokey.get('text', ''):
                ok('没配 Key：按钮灰掉，页面直接指去「复制整组提示词」自己生成——不会让人点了白等')
            else:
                bad('没 Key 的界面态不对：%r' % (nokey,))
            # 演示号放开不能漏到试用号：现开一个真号，额度应还是试用 0/10
            trial = page.evaluate('''async () => {
              const r = await (await fetch('/api/auth/signup', { method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name: '额度自检号', phone: '13900000001', password: 'check123' }) })).json();
              const q = await (await fetch('/api/action', { method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ action: 'getImageQuota', data: {} }) })).json();
              return { signup: r && r.ok, q: q && q.result };
            }''')
            tq = trial.get('q') or {}
            if trial.get('signup') and tq.get('mode') == 'trial' and not tq.get('unlimited') and tq.get('used') == 0 and tq.get('max') == 10 and tq.get('left') == 10:
                ok('真号（非演示）还是老口径：试用 0/10、unlimited=false——演示号放开没漏到试用号')
            else:
                bad('真号额度口径不对：%r' % (trial,))
            if errs:
                bad('页面抛错：%r' % (errs[:5],))
            else:
                ok('整场没有页面异常')
            br.close()
    finally:
        try:
            srv.terminate()
        except Exception:
            pass
        imgstub.shutdown()
        aistub.shutdown()
        logf.close()
    print('\n结果：%s（图在 tmp/imgapi-check/）' % ('全过' if fails == 0 else '%d 项没过' % fails), flush=True)
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
