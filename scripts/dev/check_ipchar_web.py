# 🎭 IP 角色页面自检（2026-10-30 晚改版后）：账号规划 → 🎭 IP 角色（左栏二级，不再是「人设」里的第三个横签）。
# 走真链路（AI / 出图都拨到本机小桩）：
#   ① 点「🎲 AI 帮我编一个」→ 不弹表单，直接出第一张定妆照（默认真实照片）
#   ② 卡上只有一段话＋风格下拉；出图按钮在图外面；风格换完再出，提示词跟着换
#   ③ 点图选中 → 复制图片按 Ctrl+V 就换（http 页面读不了剪贴板，只能靠粘贴事件）；也能上传自己的照片
#   ④ 编辑弹窗只有 1 个文本框＋1 个「按我说的改」；存完后台拆字段
#   ⑤ 回写稿 ⑤：下拉里选人、整组提示词带上外形与视觉锤；多角色一篇一个
#   ⑥ 定妆照不扣出图额度（客户试用额度还是 0/10）
# 只用临时账本（tmp/ipchar-web/data），不出真 Key。
# 用法：python3 scripts/dev/check_ipchar_web.py
import os
import sys
import json
import time
import random
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

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
REPO = Path(__file__).resolve().parents[2]
PORT = 8895
BASE = 'http://127.0.0.1:%d' % PORT
OUT = REPO / 'tmp' / 'ipchar-web'
DATA = OUT / 'data'
fails = 0

CHAR = {
    'name': '小过', 'kind': '真人', 'role': '做了十年的装修师傅', 'age': '35 岁上下',
    'hair': '短发，鬓角有点白', 'body': '中等偏壮', 'cloth': '深蓝色短袖工装',
    'hammers': ['红色安全帽', '腰上挂卷尺'],
    'voice': '说话慢，爱用「我跟你说」开头', 'desc': '工地上一眼能认出来的那种师傅。',
}
REVISED = '小过，28 岁的装修师傅，留着清爽短发，穿深蓝工装，腰上挂卷尺，戴一顶红色安全帽。'
ORDER = []          # 按到达顺序记：ai:build / ai:parse / ai:revise / img


def ok(msg):
    print('  PASS ' + msg, flush=True)


def bad(msg):
    global fails
    fails += 1
    print('  FAIL ' + msg, flush=True)


def png_solid(w=96, h=128, rgb=(30, 90, 160)):
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))

    def chunk(t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    return (b'\x89PNG\r\n\x1a\n' +
            chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress(raw)) +
            chunk(b'IEND', b''))


PNG_B64 = base64.b64encode(png_solid()).decode()
SEEN = {'img': [], 'ai': []}


def ai_text(body):
    return json.dumps(body.get('messages') or body, ensure_ascii=False)


class ImgStub(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('content-length') or 0)
        SEEN['img'].append(json.loads(self.rfile.read(n) or b'{}'))
        ORDER.append('img')
        time.sleep(1.8)   # 留出窗口看「⏳ 出图中」这一下，别让桩快得像没反应
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
        n = int(self.headers.get('content-length') or 0)
        body = json.loads(self.rfile.read(n) or b'{}')
        SEEN['ai'].append(body)
        txt = ai_text(body)
        if '改稿助手' in txt:            # 「按我说的改」：只回一段话
            ORDER.append('ai:revise')
            content = REVISED
        elif '结构化字段' in txt:         # 存完拆字段
            ORDER.append('ai:parse')
            content = json.dumps(CHAR, ensure_ascii=False)
        else:                            # AI 编一个角色
            ORDER.append('ai:build')
            content = json.dumps(CHAR, ensure_ascii=False)
        out = json.dumps({'choices': [{'message': {'content': content}}]}, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *a):
        pass


def main():
    print('── 🎭 IP 角色：AI 编一个直接出图 / 风格可换 / 点图粘图 / 不扣额度 ──', flush=True)
    shutil.rmtree(OUT, ignore_errors=True)
    DATA.mkdir(parents=True, exist_ok=True)
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
    srv = subprocess.Popen(['node', str(REPO / 'server' / 'dev-server.mjs')], env=env,
                           stdout=logf, stderr=subprocess.STDOUT)
    for _ in range(80):
        try:
            socket.create_connection(('127.0.0.1', PORT), 1).close()
            break
        except OSError:
            time.sleep(0.5)
    else:
        bad('服务器没起来（看 tmp/ipchar-web/server.log）')
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
            page.wait_for_timeout(1500)
            # 演示号的底子只读（账号规划那几页按钮会被 demo-ui 拦下），这里开一个真号来验可编辑
            phone = '139' + str(random.randint(10000000, 99999999))
            who = page.evaluate('''async (ph) => await (await fetch('/api/auth/signup', { method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name: 'IP角色页自检号', phone: ph, password: 'check123' }) })).json()''', phone)
            if not who.get('ok'):
                bad('真号没开成：%r' % (who,))
                br.close()
                return
            # 新号还没填问卷，popupGate 会把人送去引导页；这里按「看过引导」记一下，直接落到工作台
            acc_id = (who.get('account') or {}).get('id') or ''
            page.evaluate('''(id) => { localStorage.setItem('xhs_guide_seen:' + id, '1');
                sessionStorage.removeItem('xhs_gate_c'); }''', acc_id)
            goto_big(page, BASE + '/popup.html?mode=big', wait_until='domcontentloaded', timeout=90000)
            page.wait_for_function('() => window.__wbBooted === true', timeout=90000)   # 首屏装载罩期间点击会被吞
            page.wait_for_timeout(1500)

            # ① 左栏二级里有「🎭 IP 角色」，点进去就是角色页（不用再进人设找横签）
            got = page.evaluate('''async () => {
              switchMainTab('diagnose');
              await new Promise(r => setTimeout(r, 600));
              diagGo(3);
              await new Promise(r => setTimeout(r, 400));
              const personaTabs = document.querySelectorAll('#diagPersonaTabs .dg-tab').length;
              const sub = document.querySelector('#diagSubTabs [data-go="7"]');
              const navText = sub ? sub.innerText : '';
              diagGo(7);
              await new Promise(r => setTimeout(r, 500));
              return { personaTabs: personaTabs, navText: navText,
                text: (document.getElementById('diagStepBody') || {}).innerText || '',
                active: !!document.querySelector('#diagSubTabs [data-go="7"].active') };
            }''')
            if got.get('personaTabs') == 2:
                ok('人设页回到两个横签（人设 / 说话风格），IP 角色不再藏在里面')
            else:
                bad('人设页还挂着第三个横签：%r' % (got.get('personaTabs'),))
            if 'IP 角色' in got.get('navText', '') and got.get('active'):
                ok('左栏二级多出一项「🎭 IP 角色」，点进去就是这一页（自己亮着）')
            else:
                bad('左栏没这一项或点了没亮：%r' % (got.get('navText'),))
            if '还没有角色' in got.get('text', '') and 'AI 帮我编一个' in got.get('text', ''):
                ok('空状态说清了下一步：点「🎲 AI 帮我编一个」先建一个')
            else:
                bad('空状态没提示：%r' % (got.get('text', '')[:300],))
            if '白送' not in got.get('text', ''):
                ok('这一页不再写「前 3 次白送」之类的额度话')
            else:
                bad('页面上还留着「白送」：%r' % (got.get('text', '')[:300],))
            page.locator('#diagStepBody').screenshot(path=str(OUT / '1-empty.png'))

            nstyle = page.evaluate('NP_CHAR_STYLES.length')
            nlabels = page.evaluate('NP_CHAR_STYLES.map(s => s.t).join("、")')
            if nstyle == 11 and '2D Q版漫画' in nlabels:
                ok('风格表 11 种（全卡通，含 2D Q版漫画）：%s' % nlabels)
            else:
                bad('风格表不对：%r / %r' % (nstyle, nlabels))

            # ② 点「🎲 AI 帮我编一个」→ 不弹表单，直接出第一张（默认日系二次元）
            page.click('#ipcAi')
            page.wait_for_selector('#ipcList img', timeout=40000)
            page.wait_for_function("() => String(_ipcBusy) === ''", timeout=40000)
            page.wait_for_timeout(500)
            if page.query_selector('#ipcMask') is None:
                ok('「AI 帮我编一个」不再弹表单：编完直接出第一张定妆照')
            else:
                bad('还弹了编辑表单')
            if ORDER[:2] == ['ai:build', 'img']:
                ok('先编角色、再照那段描述出图（不用人点第二下）')
            else:
                bad('调用顺序不对：%r' % (ORDER[:4],))
            first_prompt = str((SEEN['img'][0] or {}).get('prompt') or '')
            if '【画风】日系二次元' in first_prompt and '红色安全帽' in first_prompt:
                ok('首张按默认画风「日系二次元」出，提示词带着角色的外形与视觉锤')
            else:
                bad('首张提示词不对：%r' % (first_prompt[:300],))
            card = page.evaluate("() => (document.getElementById('ipcList') || {}).innerText || ''")
            if '小过' in card and '红色安全帽' in card:
                ok('卡上有名字和视觉锤')
            else:
                bad('卡上没画出来：%r' % (card[:200],))
            outside = page.evaluate('''() => {
              const b = document.querySelector('[data-ipc-shot]');
              return b ? !b.closest('.ipc-shot') : false; }''')
            if outside:
                ok('出图按钮在图外面（点图是换图，不是出图）')
            else:
                bad('出图按钮还嵌在图片里')
            if page.evaluate('document.querySelectorAll("#ipcList select option").length') == 11:
                ok('卡上风格下拉 11 项，随手能换')
            else:
                bad('风格下拉项数不对：%r' % (page.evaluate('document.querySelectorAll("#ipcList select option").length'),))
            shot_flag = page.evaluate('() => { const s = _npChars.list[0]; return { v: s && s.styleV, k: s && s.kind }; }')
            if shot_flag.get('v') == 2 and shot_flag.get('k') == '卡通':
                ok('出过定妆照就记账：styleV=2、kind=卡通（下次打开不会被一次性升级顶掉）')
            else:
                bad('出完定妆照没记账：%r' % (shot_flag,))
            if page.evaluate('document.querySelectorAll("#ipcList input").length') == 0:
                ok('卡上不再铺字段表单（名字 / 发型 / 体型那些默认藏在后台）')
            else:
                bad('卡上还铺着输入框：%r' % (page.evaluate('document.querySelectorAll("#ipcList input").length'),))
            page.locator('#diagStepBody').screenshot(path=str(OUT / '2-ai-first.png'))

            char_id = page.evaluate('document.querySelector("[data-ipc-style]").getAttribute("data-ipc-style")')

            # ③ 换风格：先落库、给提示；再出图，提示词跟着换成素描风格
            page.select_option('#ipcStyle_' + char_id, 'sketch')
            page.wait_for_timeout(700)
            saved = page.evaluate('(id) => { const s = _npChars.list.find(c => c.id === id); return s && s.style; }', char_id)
            msg = page.evaluate("() => (document.getElementById('ipcMsg') || {}).textContent || ''")
            if saved == 'sketch' and '素描风格' in msg:
                ok('风格换成「素描风格」：当场落库并给了提示')
            else:
                bad('换风格没落库或没提示：style=%r msg=%r' % (saved, msg[:120]))
            page.click('[data-ipc-shot]')
            page.wait_for_function("() => String(_ipcBusy) !== ''", timeout=10000)
            page.wait_for_function("() => String(_ipcBusy) === ''", timeout=60000)
            page.wait_for_timeout(400)
            sketch_prompt = str((SEEN['img'][-1] or {}).get('prompt') or '')
            if '【画风】铅笔素描风格' in sketch_prompt:
                ok('按新风格出图：提示词里就是素描风格那段画法')
            else:
                bad('出图没用新风格：%r' % (sketch_prompt[:300],))
            page.locator('#diagStepBody').screenshot(path=str(OUT / '3-style.png'))

            # ③b 点图选中 → Ctrl+V 粘图换掉（http 页面读不了剪贴板，只能收粘贴事件）
            before = page.evaluate('(id) => { const s = _npChars.list.find(c => c.id === id); return (s.portraits || [])[0] && s.portraits[0].id; }', char_id)
            page.click('.ipc-shot')
            page.wait_for_timeout(400)
            picked = page.evaluate('_ipcPasteId')
            hint = page.evaluate("() => (document.getElementById('ipcMsg') || {}).textContent || ''")
            if picked == char_id and 'Ctrl+V' in hint:
                ok('点一下照片就选中这张卡，并提示「复制图片后按 Ctrl+V 就换上」')
            else:
                bad('点图没选中或没提示：%r / %r' % (picked, hint[:120]))
            page.evaluate('''(b64) => {
                const bin = atob(b64);
                const u8 = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
                const f = new File([u8], 'paste.png', { type: 'image/png' });
                const dt = new DataTransfer();
                dt.items.add(f);
                document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
            }''', PNG_B64)
            try:
                page.wait_for_function('''(old) => {
                  const s = _npChars.list.find(c => c.id === %s);
                  const p = s && (s.portraits || [])[0];
                  return !!(p && p.id && p.id !== old);
                }''' % json.dumps(char_id), arg=before, timeout=30000)
            except Exception:
                pass
            page.wait_for_timeout(1200)
            pasted = page.evaluate('''(id) => {
              const s = _npChars.list.find(c => c.id === id);
              const p = (s && s.portraits || [])[0] || {};
              return { n: (s && s.portraits || []).length, id: p.id || '', url: p.url || '', thumb: p.thumb || '',
                imgs: document.querySelectorAll('#ipcList img').length,
                label: Array.from(document.querySelectorAll('#ipcList [data-ipc-upload]')).map(b => b.innerText.trim()) };
            }''', char_id)
            if pasted.get('n') == 1 and pasted.get('id') and pasted.get('id') != before and str(pasted.get('url', '')).startswith('/api/blob/'):
                ok('粘贴进来的图直接换成了这张定妆照（就一张，原图存服务器）')
            else:
                bad('粘贴换图没成：%r' % (pasted,))
            if pasted.get('imgs') == 1 and pasted.get('label') == ['⬆ 换成自己的照片']:
                ok('卡上图换过来了，按钮还是「⬆ 换成自己的照片」')
            else:
                bad('卡上没跟着换：%r / %r' % (pasted.get('imgs'), pasted.get('label')))
            page.locator('#diagStepBody').screenshot(path=str(OUT / '3b-paste.png'))

            # ④ 编辑弹窗：只有一个文本框＋一句「按我说的改」，存完后台拆字段
            page.click('[data-ipc-edit]')
            page.wait_for_selector('#ipcMask', timeout=10000)
            page.wait_for_timeout(300)
            form = page.evaluate('''() => ({
              ta: document.querySelectorAll('#ipcMask textarea').length,
              inp: document.querySelectorAll('#ipcMask input').length,
              name: (document.getElementById('ipcF_name') || {}).value || '',
              text: (document.getElementById('ipcF_text') || {}).value || '' })''')
            if form.get('ta') == 1 and form.get('inp') == 2:
                ok('编辑弹窗：一个名字框＋一个文本框＋一个「想让 AI 怎么改」的输入框（其余字段不铺）')
            else:
                bad('弹窗里控件数量不对：%r' % (form,))
            if form.get('name') == '小过':
                ok('名字框带出当前名字，可以直接改名')
            else:
                bad('名字框没带出当前名字：%r' % (form.get('name'),))
            if '装修师傅' in form.get('text', '') and '红色安全帽' in form.get('text', ''):
                ok('文本框带出一整段（名字 / 穿着 / 视觉锤都在），改的是同一段话')
            else:
                bad('文本框没带出完整那段：%r' % (form.get('text', '')[:120],))
            page.fill('#ipcF_ask', '再年轻一点，头发短一点')
            page.click('#ipcRevise')
            try:
                page.wait_for_function('document.querySelector("#ipcF_text").value.indexOf("28 岁") >= 0', timeout=20000)
                ok('点「✨ 按我说的改」：AI 把那段话改好换回文本框，先给人看再存')
            except Exception:
                bad('AI 改稿没换回文本框：%r' % (page.evaluate("() => (document.getElementById('ipcF_text') || {}).value || ''")[:120],))
            page.screenshot(path=str(OUT / '4-modal.png'))
            page.click('#ipcSave')
            page.wait_for_function("() => /存好了/.test((document.getElementById('ipcMsg') || {}).textContent || '')", timeout=30000)
            page.wait_for_timeout(600)
            after = page.evaluate('''(id) => {
              const s = _npChars.list.find(c => c.id === id) || {};
              return { desc: s.desc || '', name: s.name || '', kind: s.kind || '', hammers: s.hammers || [], style: s.style || '' };
            }''', char_id)
            if '28 岁' in after.get('desc', ''):
                ok('保存后角色卡存的就是改好那段话（desc）')
            else:
                bad('保存后 desc 不对：%r' % (after.get('desc', '')[:80],))
            if 'ai:parse' in ORDER:
                ok('存完后台自动把那段话拆成名字 / 发型 / 视觉锤（页面上不用填）')
            else:
                bad('没调拆字段：%r' % (ORDER,))
            if after.get('name') == '小过' and len(after.get('hammers') or []) == 2 and after.get('style') == 'sketch':
                ok('拆完字段回来了：名字「小过」、2 个视觉锤；风格没被冲掉（还是素描风格）')
            else:
                bad('拆完字段不对：%r' % (after,))

            # ④b 「➕ 自己填一个」：只写一段话（AI 拆不出名字也行）也能存住（11-02 修）
            page.click('#ipcNew')
            page.wait_for_selector('#ipcMask', timeout=10000)
            page.fill('#ipcF_name', '阿哲')
            page.fill('#ipcF_text', '阿哲，28 岁的体适能教练，寸头，结实，穿黑色运动短袖，脖子上挂哨子。')
            page.click('#ipcSave')
            page.wait_for_function('() => _npChars && _npChars.list.length === 2', timeout=30000)
            page.wait_for_timeout(1200)
            manual = page.evaluate('''() => {
              const c = _npChars.list.find(x => x.name === '阿哲') || {};
              const btn = document.querySelector('[data-ipc-edit="' + c.id + '"]');
              const box = btn ? btn.closest('div[style*="border:1px solid #e7eaf0"]') : null;
              return { id: c.id || '', name: c.name || '', desc: c.desc || '',
                cards: document.querySelectorAll('#ipcList [data-ipc-edit]').length,
                text: box ? box.innerText : '' };
            }''')
            if manual.get('name') == '阿哲' and '体适能教练' in manual.get('desc', '') and manual.get('cards') == 2:
                ok('「➕ 自己填一个」只写一段话也能存住：名字直接生效、卡片多出一张')
            else:
                bad('自己填的角色没存住：%r' % (manual,))
            if '体适能教练' in manual.get('text', ''):
                ok('新卡片上直接显示刚写的那段描述')
            else:
                bad('卡片没显示刚写的描述：%r' % (manual.get('text', '')[:200],))
            page.click('[data-ipc-del="' + manual['id'] + '"]')
            page.wait_for_function('() => _npChars && _npChars.list.length === 1', timeout=20000)
            page.wait_for_timeout(400)

            # ⑤ 回写稿 ⑤：「这篇用谁」下拉里有这个角色，整组提示词带上他
            w5 = page.evaluate('''async () => {
              const shot = (n) => ({ id: 's' + n, text: '第' + n + '屏一句。', role: '', topic: '工地门口',
                desc: '', keySid: '', keyText: '', form: '', cap: { mode: '', zone: '', lines: [], labels: [], note: '' },
                clock: false, off: false, dlock: false, sids: [], cands: [], pick: -1, imgs: [] });
              const w = {
                platform: 'xhs', platforms: ['xhs'], dir: 'd', path: 'image', step: 5, arId: 'ipchk' + Date.now(),
                draft: { content: '正文一句。', titles: ['标题'], tags: [] }, topics: [], chosenTopicIdx: -1,
                chosen: [], chosenPeople: [], chosenKb: [], styleLook: null,
                shots: { style: '', seed: '', groupPrompt: '', groupPromptOwn: false, total: 2, shotN: 2, charId: '',
                  look: { motif: '', born: '', casting: '' }, sents: [], editing: '', suggest: [],
                  items: [shot(1), shot(2)],
                  cv: { on: false, copy: '', prompt: '', imgs: [], cap: {} } },
                imgDocs: [], imgOpen: '', imgSibs: [], uiTab: '', visual: null, filmDocs: [], voice: '',
                longform: '', longSrc: '', lTone: '', lTopic: '', lSeed: '', lStep: 0, kOut: '', dOut: '',
                filmKind: '', noteStyle: {}, write: null, planItem: null,
              };
              _npWiz = w; _npMode = 'wizard';
              let host = document.getElementById('ipcWizHost');
              if (!host) { host = document.createElement('div'); host.id = 'ipcWizHost';
                host.style.cssText = 'position:fixed;left:0;top:0;width:820px;background:#fff;z-index:99999;padding:14px;overflow:auto;';
                document.body.appendChild(host); }
              npWizRender = async function () { const h = document.getElementById('ipcWizHost'); if (h) h.innerHTML = npDshStepHtml(_npWiz); };
              npDshOnStage = function () { return true; };
              ensureNpDelegation();
              await npWizRender(document.body);
              await new Promise(r => setTimeout(r, 500));
              const sel = document.getElementById('npDshCharSel');
              const grp = (document.getElementById('npDshGroup') || {}).value || '';
              return { hasSel: !!sel, opts: sel ? Array.from(sel.options).map(o => o.textContent) : [],
                grp: grp, text: (document.getElementById('ipcWizHost') || {}).innerText || '' };
            }''')
            page.locator('#ipcWizHost').screenshot(path=str(OUT / '5-step5.png'))
            if w5.get('hasSel') and any('小过' in o for o in w5.get('opts') or []):
                ok('⑤ 顶上多一条「🎭 这篇用」，下拉里就有刚建的角色（小过）')
            else:
                bad('⑤ 没挂上角色下拉：%r' % (w5.get('opts'),))
            if '红色安全帽' in w5.get('grp', '') and '固定不变' in w5.get('grp', ''):
                ok('整组提示词按角色重写：写着「同一个人…固定不变：红色安全帽、腰上挂卷尺」')
            else:
                bad('整组提示词没带角色：%r' % (w5.get('grp', '')[:400],))
            if '定妆照会当参考图一起递' in w5.get('text', ''):
                ok('⑤ 那一条写明「✓ 定妆照会当参考图一起递」，出图前就知道脸会一致')
            else:
                bad('⑤ 没写参考图那行：%r' % (w5.get('text', '')[:300],))

            # ⑤c 外形以「那段话」为准：拆出来的旧衣服字段不能再压回提示词（11-02 报的橙衣 bug）
            w5c = page.evaluate('''() => npCharLine({ name: '冠冠老师', role: '体适能教练',
              cloth: '亮橙色速干训练 T 恤，黑色运动短裤', hammers: ['脖子上挂着银色口哨'],
              desc: '冠冠老师，二十出头的体适能教练，穿一件宽松的灰色短袖。' })''')
            if '灰色' in w5c and '橙色' not in w5c and '口哨' in w5c:
                ok('外形听「那段话」：字段里留着的旧衣服不再进提示词（视觉锤照带）')
            else:
                bad('外形没听那段话：%r' % (w5c,))

            # ⑤b 换人：这篇单独挑一个（再造一个角色，验证「一篇一个、多角色并存」）
            two = page.evaluate('''async () => {
              const st = await npCharsLoad(true);
              const list = st.list.slice();
              list.push({ id: 'c_second', name: '阿珍', kind: '真人', style: 'real', role: '小区团购团长', age: '40 岁',
                hair: '扎低马尾', body: '偏瘦', cloth: '米色针织衫', hammers: ['手腕一串红绳'], voice: '', desc: '',
                portraits: [], at: Date.now() });
              await npCharsSave({ mainId: st.mainId, list: list });
              _npWiz.shots.charId = 'c_second';
              npDshGroupRefresh(_npWiz);
              npWizRender(npActiveC());
              await new Promise(r => setTimeout(r, 400));
              const sel = document.getElementById('npDshCharSel');
              const grp = (document.getElementById('npDshGroup') || {}).value || '';
              return { opts: sel ? Array.from(sel.options).length : 0,
                picked: sel ? sel.value : '', grp: grp,
                main: (await npCharsLoad(true)).mainId };
            }''')
            if two.get('opts') == 2 and two.get('picked') == 'c_second' and '阿珍' in two.get('grp', '') and '小过' not in two.get('grp', ''):
                ok('多角色并存：这篇换成「阿珍」，整组提示词立刻跟着换人，主角还留在小过')
            else:
                bad('换人不对：%r' % (two,))

            # ⑥ 定妆照不扣额度：出了好几张、粘了一张，客户额度一格没动（只算全站当日总量）
            q = page.evaluate('''async () => await (await fetch('/api/action', { method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ action: 'getImageQuota', data: {} }) })).json()''')
            qr = q.get('result') or {}
            cap = qr.get('max') or 0
            if qr.get('used') == 0 and cap > 0 and qr.get('left') == cap:
                ok('出定妆照 / 粘图都不扣客户额度：已用 0、还剩 %d/%d（只算全站当日总量）' % (cap, cap))
            else:
                bad('定妆照扣了额度：%r' % (qr,))

            # ⑦ 演示号：这一页能看，但不摆「建角色」的钮（摆了也点不动，那是一颗点不掉的假待办）
            page.evaluate('''async () => await (await fetch('/api/auth/demo', { method: 'POST',
                headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'deco' }) })).json()''')
            goto_big(page, BASE + '/popup.html?mode=big', wait_until='domcontentloaded', timeout=90000)
            page.wait_for_function('() => window.__wbBooted === true', timeout=90000)
            page.wait_for_timeout(1800)
            dg = page.evaluate('''async () => {
              switchMainTab('diagnose');
              await new Promise(r => setTimeout(r, 900));
              diagGo(7);
              await new Promise(r => setTimeout(r, 700));
              return { demo: !!window.__xhsDemoAccount, ai: !!document.getElementById('ipcAi'),
                text: (document.getElementById('diagStepBody') || {}).innerText || '' };
            }''')
            page.screenshot(path=str(OUT / '6-demo.png'))
            if dg.get('demo') and not dg.get('ai') and '演示号里不能建角色' in dg.get('text', ''):
                ok('演示号：这一页能看，建角色的钮藏掉、写明只读（不挂点不动的假待办）')
            else:
                bad('演示号那页不对：%r' % (dg,))

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
    print('\n结果：%s（图在 tmp/ipchar-web/）' % ('全过' if fails == 0 else '%d 项没过' % fails), flush=True)
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
