"""写稿「没按格式交」链路的端到端冒烟（真扩展 + 假 AI 服务器）。

背景：老板报过——发知识笔记时改稿页弹「⚠️ AI 这次没按 JSON 格式回…」的整段兜底。
本发改动＝①解析宽容（字符串里的真换行/尾逗号自动修）②解析不过自动带「只交 JSON」提醒
重来一发（最多 3 发）③提示语去掉「JSON」术语。这个脚本把整条真链路跑四遍：

  ⓪ 干净 JSON         → 1 发请求，成稿无警告（happy path 不许被这次改动碰坏）
  ① 小走形（正文里带真换行）→ 宽容解析直接救回，1 发请求，无警告
  ② 第一发纯文本没交格式 → 自动重来：第 2 发带重交提醒、额度加码；成稿无警告
  ③ 三发全不交格式     → 落整段兜底：正文=最长那发；警告文案 = 白话「没按格式交稿」（不再出现 JSON）

做法：本地假 https 服务器 + --host-resolver-rules 把 api.deepseek.com 指到 127.0.0.1，
扩展真身一字不动（api.deepseek.com 本来就在 host_permissions 里）。

跑法：python3 scripts/dev/_smoke_draft_json.py（需要 msedge；临时 profile，不动真身数据）
"""
import json
import os
import pathlib
import ssl
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

try:  # Windows 控制台默认 GBK，print 里带中文符号会炸；切 UTF-8
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = pathlib.Path(os.environ.get('XHS_ROOT') or '.').resolve()
EXT = ROOT / 'extension'
PORT = int(os.environ.get('XHS_MOCK_PORT') or 8973)
API_KEY = 'sk-smoke-0000'

# ── 四种模型回稿 ─────────────────────────────────────────────
CLEAN = '{"titles":["高效复盘的三个方法"],"content":"第一段开场。\\n第二段干货。","tags":["复盘","效率"],"timeTip":"晚上八点"}'
# 正文里是「真换行」不是 \n 转义 → 严格 JSON.parse 必挂，宽容修复能救
REPAIRABLE = '{"titles":["高效复盘的三个方法"],"content":"第一段开场。\n第二段干货。","tags":["复盘","效率"],"timeTip":"晚上八点"}'
PROSE1 = '好的，这篇我这样写：先讲一件身边事，再落到方法上。'
PROSE2 = '好的，换个说法再来一版：这次从大家的共性困惑切入，最后收在一条可操作的建议上。'
PROSE3 = PROSE2 + '（还是没按格式交稿，干脆把整段话都放这里，用户看见的就是这一整段正文。）'


class MockHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        ln = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(ln).decode('utf-8', 'replace')
        try:
            req = json.loads(body)
        except Exception:
            req = {}
        rec = {'path': self.path, 'auth': self.headers.get('Authorization') or '', 'body': req}
        try:
            text = self.server.queue.pop(0)
        except IndexError:
            text = '（假服务器没有排到回稿）'
        self.server.requests.append(rec)
        payload = json.dumps({
            'id': 'mock', 'object': 'chat.completion',
            'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': text}, 'finish_reason': 'stop'}],
            'usage': {'prompt_tokens': 10, 'completion_tokens': 10, 'total_tokens': 20},
        }).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *a):
        pass


def start_mock():
    httpd = ThreadingHTTPServer(('127.0.0.1', PORT), MockHandler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(str(CERT), str(KEY))
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    httpd.requests = []
    httpd.queue = []
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def gen_cert(dirp):
    cert, key = dirp / 'cert.pem', dirp / 'key.pem'
    cmd = ['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-days', '2', '-nodes',
           '-keyout', str(key), '-out', str(cert),
           '-subj', '/CN=api.deepseek.com', '-addext', 'subjectAltName=DNS:api.deepseek.com']
    subprocess.run(cmd, check=True, capture_output=True)
    return cert, key


# 页面里的一发：最小状态 + 真函数 npBuildDraft（和 ④ 页自动写稿走的是同一支）
DRIVE = '''async () => {
    const mk = (tag, id) => { const el = document.createElement(tag); if (id) el.id = id; return el; };
    let box = document.getElementById('__smokeBox');
    if (!box) {
        box = mk('div'); box.id = '__smokeBox';
        ['npDraftStatus', 'npTitles', 'npDraftBody', 'npTags', 'npWizNav', 'npExtras'].forEach(id => box.appendChild(mk('div', id)));
        box.appendChild(mk('textarea', 'npResult'));
        document.body.appendChild(box);
    }
    _npActiveContainer = null;               // 别让 finally 里的整步重画碰到不存在的舞台
    _npWiz = {
        step: 4, platform: 'xhs', prodName: '冒烟的产品',
        topics: [{ topic: '冒烟的话题', fact: '' }], chosenTopicIdx: 0,
        chosen: [], chosenPeople: [], chosenKb: [], noteStyle: {}, write: null,
        planItem: null, hotHook: null, kOut: 'mind', dOut: '',
    };
    await npBuildDraft(box);
    const d = _npWiz.draft || {};
    return {
        status: document.getElementById('npDraftStatus').innerText.trim(),
        loose: !!d.loose,
        content: String(d.content || ''),
        titles: (d.titles || []).slice(),
        result: document.getElementById('npResult').value,
    };
}'''


def req_text(req):
    try:
        return req['body']['messages'][1]['content']
    except Exception:
        return ''


with tempfile.TemporaryDirectory(prefix='xhs-draftjson-') as tmp, sync_playwright() as p:
    tmpd = pathlib.Path(tmp)
    CERT, KEY = gen_cert(tmpd)
    srv = start_mock()
    print('mock AI @ https://api.deepseek.com → 127.0.0.1:%d' % PORT)

    ctx = p.chromium.launch_persistent_context(
        tmpd / 'profile', headless=False, channel='msedge',
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}',
              f'--host-resolver-rules=MAP api.deepseek.com 127.0.0.1:{PORT}',
              '--ignore-certificate-errors', '--no-proxy-server'])
    try:
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
        sw.on('console', lambda m: print('[SW]', m.type, m.text[:300]))
        page = ctx.new_page()
        page_errors = []
        page.on('pageerror', lambda e: (page_errors.append(str(e)[:300]), print('[popup pageerror]', str(e)[:300])))
        page.goto(sw.url.replace('background.js', 'popup.html?mode=big'))
        page.wait_for_function('typeof npBuildDraft === "function" && typeof npWeekPlanSave === "function"')

        page.evaluate('''async () => {
            await chrome.storage.local.set({ config: { ai: {
                apiKey: '%s', apiBaseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash',
            } } });
        }''' % API_KEY)
        page.evaluate("document.getElementById('firstSetupPanel')?.remove()")

        def run_case(queue):
            srv.queue = list(queue)
            srv.requests.clear()
            out = page.evaluate(DRIVE)
            return out, list(srv.requests)

        # ── ⓪ 干净 JSON：happy path 一发过、无警告 ──
        out, reqs = run_case([CLEAN])
        assert len(reqs) == 1, f'⓪ 请求数 %d ≠ 1' % len(reqs)
        assert reqs[0]['path'] == '/v1/chat/completions', reqs[0]['path']
        assert reqs[0]['auth'] == 'Bearer ' + API_KEY, reqs[0]['auth']
        assert not out['status'], out
        assert not out['loose'], out
        assert out['titles'] == ['高效复盘的三个方法'], out
        assert '第一段开场。\n第二段干货。' in out['result'], out
        print('PASS ⓪ 干净 JSON：1 发过、无警告、正文/标题都对')

        # ── ① 正文里带真换行（小走形）：宽容解析直接救回，不多花一发 ──
        out, reqs = run_case([REPAIRABLE])
        assert len(reqs) == 1, f'① 宽容解析该一发过，实际请求 %d 发' % len(reqs)
        assert not out['status'], out
        assert not out['loose'], out
        assert out['titles'] == ['高效复盘的三个方法'], out
        assert '第一段开场。\n第二段干货。' in out['result'], out
        print('PASS ① 真换行小走形：宽容解析救回（1 发、无警告）')

        # ── ② 第一发没交格式 → 自动带提醒重来，第 2 发成稿 ──
        out, reqs = run_case([PROSE1, CLEAN])
        assert len(reqs) == 2, f'② 应该自动重来一发（共 2 发），实际 %d' % len(reqs)
        assert '上一发没有按要求的格式交稿' in req_text(reqs[1]), req_text(reqs[1])[:120]
        assert '上一发没有按要求的格式交稿' not in req_text(reqs[0]), '第一发不该带重交提醒'
        assert reqs[1]['body'].get('max_tokens') == 8192, reqs[1]['body'].get('max_tokens')
        assert not out['status'], out
        assert not out['loose'], out
        assert out['titles'] == ['高效复盘的三个方法'], out
        print('PASS ② 第一发跑偏 → 第 2 发带「只交 JSON」提醒 + 额度 4096→8192，成稿无警告')

        # ── ③ 三发全不交格式 → 整段兜底：正文＝最长那发；警告＝白话、不再出现 JSON ──
        out, reqs = run_case([PROSE1, PROSE2, PROSE3])
        assert len(reqs) == 3, f'③ 三发全挂该试满 3 发，实际 %d' % len(reqs)
        assert reqs[2]['body'].get('max_tokens') == 16384, reqs[2]['body'].get('max_tokens')
        assert '上一发没有按要求的格式交稿' in req_text(reqs[2]), '第 3 发也该带重交提醒'
        assert out['loose'] is True, out
        assert out['content'] == PROSE3, out['content'][:60] + '…（应＝最长那发 PROSE3）'
        assert out['result'] == PROSE3, out['result'][:60] + '…'
        assert '没按格式交稿' in out['status'], out['status']
        assert 'JSON' not in out['status'], '兜底提示里还有「JSON」术语：' + out['status']
        assert '🤖 AI 改稿' in out['status'], out['status']
        print('PASS ③ 三发全挂：兜底正文＝最长一发；提示白话「没按格式交稿」，无 JSON 术语')

        # ── 全程 popup 无未捕获异常 ──
        assert not page_errors, 'popup 有未捕获异常：%s' % page_errors
        print('PASS ④ popup 全程零未捕获异常')
        print('ALL PASS')
    finally:
        srv.shutdown()
        ctx.close()
