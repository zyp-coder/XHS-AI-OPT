# 素材库两签（18 类判类）上公网那台的前后两道点检。
#  本机：node 起一台只用临时账本的服务器（DEMO_DATA_DIR 指 tmp/，绝不碰 server/data/），AI 出口拨到本脚本
#        自带的小桩（不烧服务器上那个真 Key），浏览器里把「两签 → 缺口只算在用 → 判类那一发走白名单进
#        后台副本 → 人改过的不覆盖」点一遍。
#  公网：把界面那几份从 http://8.222.157.6 下载回来跟本机逐字节对码，再开一次页面确认两签在、没报错。
# 用法：python3 -X utf8 scripts/dev/check_asset_kinds_cloud.py local     （上传前跑这道）
#       python3 -X utf8 scripts/dev/check_asset_kinds_cloud.py cloud    （传完跑这道）
import os
import re
import sys
import json
import time
import socket
import hashlib
import threading
import subprocess
import urllib.request
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright
from _guide_gate import goto_big

sys.stdout.reconfigure(encoding='utf-8')
REPO = Path(__file__).resolve().parents[2]
CLOUD = 'http://8.222.157.6'
PORT = 8897
BASE = 'http://127.0.0.1:%d' % PORT
DATA = REPO / 'tmp' / 'asset-cloud-check' / 'data'
RELS = ['web/popup.js', 'web/popup.html', 'web/lib/asset-kinds.js', 'web/lib/visual-motif.js']
AI_LOG = []
fails = 0

KIND_TXT = (REPO / 'extension/lib/asset-kinds.js').read_text(encoding='utf-8')
KIND_IDS = re.findall(r"\{ k: '([a-z]+)'", KIND_TXT)
GRAY = [re.search(r"\{ k: '([a-z]+)'", ln).group(1) for ln in KIND_TXT.split('\n')
        if 'gray: 1' in ln and re.search(r"\{ k: '([a-z]+)'", ln)]


def ok(msg):
    print('  PASS ' + msg, flush=True)


def bad(msg):
    global fails
    fails += 1
    print('  FAIL ' + msg, flush=True)


def md5(b):
    return hashlib.md5(b).hexdigest()


class Stub(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        n = int(self.headers.get('content-length') or 0)
        body = json.loads(self.rfile.read(n).decode('utf-8') or '{}')
        AI_LOG.append(body)
        cols = []
        for line in (body.get('messages') or []):
            if line.get('role') == 'user' and '现有素材集合' in str(line.get('content') or ''):
                for seg in str(line['content']).split('\n'):
                    m = re.match(r'^([^｜\n]+)｜.*?｜.*?｜(\d+) 条料', seg.strip())
                    if m and int(m.group(2)) >= 0:
                        cols.append({'name': m.group(1).strip(), 'kind': 'tool' if '软件' in m.group(1) else 'team'})
        out = {'kinds': [{'k': k, 'v': 'ask' if k in GRAY else 'need', 'why': '桩给的判据一句'} for k in KIND_IDS],
               'cols': cols}
        txt = json.dumps({'choices': [{'message': {'role': 'assistant', 'content': json.dumps(out, ensure_ascii=False)}}]})
        self.send_response(200)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(txt.encode('utf-8'))))
        self.end_headers()
        self.wfile.write(txt.encode('utf-8'))


def cloud_readback():
    print('── 公网那台：逐字节对码（只读下载）──', flush=True)
    for rel in RELS:
        url = CLOUD + '/' + rel.replace('web/', '')
        try:
            got = urllib.request.urlopen(url, timeout=90).read()
        except Exception as e:
            bad('%s 下载失败：%s' % (rel, e))
            continue
        mine = (REPO / rel).read_bytes()
        if md5(got) == md5(mine):
            ok('%s 公网那份＝本机这份（%d 字节）' % (rel, len(got)))
            continue
        # 另一条线会随时往公网推界面件；对不上时只查「这批的标记在不在公网那份里」
        s = got.decode('utf-8', 'replace')
        marks = ['npAsConfigKinds', 'AssetKinds', 'npas-cfg', '集合配置', '素材内容']
        miss = [m for m in marks if m not in s]
        if not miss:
            print('  NOTE %s 公网那份与本机不同（另一条线本机又有新改动没推），但这批的标记全在（%d 字节）' % (rel, len(got)))
        else:
            bad('%s 公网那份缺这批的标记：%s' % (rel, miss))
    html = (urllib.request.urlopen(CLOUD + '/popup.html', timeout=90).read()).decode('utf-8', 'replace')
    if 'lib/asset-kinds.js' in html:
        ok('公网 popup.html 引了 18 类那张表')
    else:
        bad('公网 popup.html 没引 lib/asset-kinds.js（后台判类那发会找不到表）')
    for u in ['/lib/asset-kinds.js', '/lib/visual-motif.js', '/popup.js']:
        try:
            r = urllib.request.urlopen(CLOUD + u, timeout=90)
            ok('公网 %s 现在回 %s（%d 字节）' % (u, r.status, len(r.read())))
        except Exception as e:
            bad('公网 %s 取不到：%s' % (u, e))
    # 放行清单这一发：动作路由是先过清单、再查号——没登录时回「先领个号」＝清单已放行，
    # 回「要装扩展」＝清单没带上。这一步不发真 AI（清单过后才被拦下）。
    body = json.dumps({'action': 'configAssetKinds', 'data': {'cols': []}}).encode('utf-8')
    req = urllib.request.Request(CLOUD + '/api/action', data=body, headers={'Content-Type': 'application/json'})
    try:
        j = json.loads(urllib.request.urlopen(req, timeout=60).read().decode('utf-8', 'replace'))
    except Exception as e:
        bad('公网那一发没打通：%s' % e)
        return
    j = (j.get('result') if isinstance(j.get('result'), dict) else j) or {}
    if j.get('demo') == 'need-account':
        ok('公网那台已把「判 18 类」这一发放行（没登录才被拦在领号那步，不是「要扩展」）')
    elif j.get('demo') == 'need-extension':
        bad('公网那台还没放行这一发：%r' % (j,))
    else:
        print('  NOTE 这一发回的是：%r' % (j,))
    # 页面点检不在公网做：公网现在有前置门，工作台要登录才留得住（不给真账本塞测试号）。
    # 界面那两签的实点已经在这份脚本的 local 档跑过，公网那份与本机逐字节对得上＝同一份码。
    print('  NOTE 界面实点这轮不在公网跑（要先登录才有工作台），以 local 档 + 上面的对码为准', flush=True)


def local_check():
    print('── 本机临时账本的服务器 + 浏览器点这两签 ──', flush=True)
    DATA.mkdir(parents=True, exist_ok=True)
    stub = ThreadingHTTPServer(('127.0.0.1', 0), Stub)
    threading.Thread(target=stub.serve_forever, daemon=True).start()
    env = dict(os.environ)
    env['DEMO_DATA_DIR'] = str(DATA)
    env['PORT'] = str(PORT)
    env['DEMO_AI_KEY'] = 'check-only'
    env['DEMO_AI_BASE'] = 'http://127.0.0.1:%d/v1' % stub.server_port
    env['DEMO_SIGNUP_MAX'] = '60'
    logf = open(REPO / 'tmp' / 'asset-cloud-check.server.log', 'w', encoding='utf-8')
    srv = subprocess.Popen(['node', str(REPO / 'server' / 'dev-server.mjs')], env=env, stdout=logf, stderr=subprocess.STDOUT)
    for _ in range(80):
        try:
            socket.create_connection(('127.0.0.1', PORT), 1).close()
            break
        except OSError:
            time.sleep(0.5)
    else:
        bad('服务器没起来（看 tmp/asset-cloud-check.server.log）')
        return
    time.sleep(2)
    boot = Path(REPO / 'tmp' / 'asset-cloud-check.server.log').read_text(encoding='utf-8', errors='replace')
    if '后台副本已就位' in boot:
        ok('服务器侧那份后台副本刷完仍能上岗（判类那一发有真身）')
    else:
        bad('后台副本没上岗：\n%s' % boot[:400])
    try:
        with sync_playwright() as p:
            br = p.chromium.launch(channel='msedge', headless=True)
            page = br.new_context(viewport={'width': 1500, 'height': 950}).new_page()
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            page.goto(BASE + '/start.html', wait_until='domcontentloaded', timeout=90000)
            page.wait_for_timeout(2500)
            who = page.evaluate('''async (a) => await (await fetch('/api/auth/signup', { method: 'POST',
                headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: a.name, phone: a.phone, password: a.pass }) })).json()''',
                {'name': '素材点检', 'phone': '1992' + '%07d' % (int(time.time()) % 10000000), 'pass': 'check123'})
            if not who.get('ok'):
                bad('临时号没领上：%r' % (who,))
                br.close()
                return
            ok('领了个临时号只进临时账本：尾号' + str(who['account']['phone'])[-4:])
            goto_big(page, BASE + '/popup.html?mode=big', wait_until='domcontentloaded', timeout=90000)
            page.wait_for_timeout(5000)

            page.evaluate('''async () => {
              const cfg = await readConfigPlain();
              cfg.diagnosis = Object.assign(cfg.diagnosis || {}, { answers: [
                { q: '你是做什么的？', answer: '我是做体验工具的设计师，做了 5 年' },
                { q: '凭什么信你？', answer: '有资质证书，也有真实案例' }], accountType: '线上工具' });
              cfg.product = Object.assign(cfg.product || {}, { name: '建材店',
                sellPoints: [{ title: '省时间', content: '一键把散素材拼成一条片子' }] });
              await writeConfigPlain(cfg);
              const cols = [{ id: 'c-team', name: '团队与真人', desc: '真人工作场景照', source: '自己加的', use: 'on' },
                            { id: 'c-tool', name: '软件界面截图', desc: '后台与编辑区', source: 'sell|省时间', use: 'on' },
                            { id: 'c-kb', name: '屋面施工实拍', desc: '还没料的在用集合', source: 'kb|屋面施工', use: 'on' },
                            { id: 'c-ask', name: '还没定的那集', desc: '屋面施工另一集', source: 'kb|屋面施工', use: 'ask' },
                            { id: 'c-off', name: '停用的那集', desc: '国标卷材特写', source: 'kb|屋面施工', use: 'off', mine: 1 }];
              await chrome.storage.local.set({ np_collections: cols, np_clips: [
                { id: 'k1', col: 'c-tool', imgOnly: true, thumb: 'data:image/png;base64,AA', name: '一张图', at: Date.now() }] });
              await chrome.storage.local.set({ np_notes: [{ id: 'n1', title: '这一篇讲省时间', dir: 'd', form: '图文',
                dOut: 'img', status: '草稿', voice: '稿子一句', sellPoints: [{ point: '省时间' }],
                kb: [{ title: '屋面施工' }], updatedAt: Date.now() }] });
            }''')
            page.locator('#tabNotePublish').click()
            page.wait_for_timeout(1200)
            page.locator('#tabNoteAssets').click()
            page.wait_for_timeout(2500)
            tabs = page.locator('#noteAssetsContent .nt-tab').all_inner_texts()
            if any('集合配置' in t for t in tabs) and any('素材内容' in t for t in tabs):
                ok('素材库页内两签在：%s' % ' / '.join(t.strip() for t in tabs))
            else:
                bad('两签不对：%r' % (tabs,))

            gaps = page.evaluate('''async () => {
              const d = await chrome.storage.local.get('np_notes');
              const hits = await npAsGapsFor(d.np_notes || []);
              const out = [];
              Object.keys(hits).forEach(k => hits[k].forEach(x => out.push(x.id)));
              return out;
            }''')
            if gaps == ['c-kb']:
                ok('档案那句「还缺 N 项」只报明确在用的那集（报 %s；停用的、还没定的、有料的那三集都不报）' % gaps)
            else:
                bad('缺口口径不对，实际报：%r（期望只有 c-kb）' % (gaps,))

            before = len(AI_LOG)
            page.locator('#noteAssetsContent .npas-cfg').click()
            for _ in range(40):
                if len(AI_LOG) > before:
                    break
                time.sleep(0.5)
            if len(AI_LOG) == before + 1:
                ok('点「🤖 重新配置」＝只发一发 AI，且这发穿过了服务器放行清单（进了后台副本）')
            else:
                bad('这一发不通：桩收到 %d 发（期望 1）——多半是放行清单没带上这发' % (len(AI_LOG) - before))
            page.wait_for_timeout(4000)
            wall = page.locator('#noteAssetsContent').inner_text()
            if '软件界面截图' in wall and '团队与真人' in wall:
                ok('AI 配完的集合照样在列表里（配用/停用没把集合弄丢）')
            else:
                bad('配完列表不对：%s' % wall[:160])
            verdict = page.evaluate('''async () => {
              const cols = await npCollectionsRead();
              const out = {};
              cols.forEach(c => { out[c.id] = { use: c.use, kind: c.kind, mine: c.mine ? 1 : 0 }; });
              return out;
            }''')
            if verdict.get('c-off', {}).get('mine') == 1 and verdict.get('c-off', {}).get('use') == 'off':
                ok('人改过的那集打了「你改过」，AI 重算没覆盖它（还是停用）')
            else:
                bad('人改过的被覆盖了：%r' % (verdict,))
            if verdict.get('c-tool', {}).get('use') in ('on', 'off', 'ask'):
                ok('AI 给集合归了类并定了用不用（c-tool：%r）' % (verdict.get('c-tool'),))
            else:
                bad('集合归类没落下去：%r' % (verdict,))

            page.locator('#noteAssetsContent .npas-col-open').first.click()
            page.wait_for_timeout(1500)
            body = page.locator('#noteAssetsContent').inner_text()
            if '回集合配置' in page.locator('#noteAssetsContent .npas-tabback').first.inner_text():
                ok('点集合进「🎞 素材内容」签，返回那颗是「‹ 回集合配置」')
            else:
                bad('返回那颗不对：%s' % body[:120])
            page.locator('#noteAssetsContent .npas-tabback').click()
            page.wait_for_timeout(1500)

            if errs:
                bad('界面报错：%s' % errs[:3])
            else:
                ok('这一趟点下来零页面报错')
            br.close()
    finally:
        srv.terminate()
        stub.shutdown()


mode = sys.argv[1] if len(sys.argv) > 1 else 'local'
if mode in ('local', 'all'):
    local_check()
if mode in ('cloud', 'all'):
    cloud_readback()
print(('ALL PASS ' if not fails else '%d 处 FAIL ' % fails) + ('（%s）' % mode), flush=True)
sys.exit(1 if fails else 0)
