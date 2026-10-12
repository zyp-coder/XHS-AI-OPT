# -*- coding: utf-8 -*-
"""xhs 重试真链路（v4）：本地假 AI 服务器顶上适配调用 → fire npPubRetry → 蹲回执。
   临时把 config.ai 指到本机 mock（跑完自动还原）；适配稿内容=现有 adapted.xhs 原样返回。"""
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

EXT_ID = 'eihbinbapmhgbohapphjmabbkgiflljd'
CONSOLE_URL = 'chrome-extension://' + EXT_ID + '/popup.html'
NID = 'e2e20261009a'
PORT = 8977
TIMEOUT_MIN = 15

REPLY = {'title': '', 'body': '', 'tags': [], 'marks': []}


class MockAI(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    hits = 0

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'authorization, content-type')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_POST(self):
        ln = int(self.headers.get('Content-Length') or 0)
        self.rfile.read(ln)
        MockAI.hits += 1
        print('  [mock] hit#%d %s' % (MockAI.hits, self.path), flush=True)
        inner = json.dumps(REPLY, ensure_ascii=False)
        payload = json.dumps({'choices': [{'message': {'content': inner}, 'finish_reason': 'stop'}],
                              'usage': {'total_tokens': 10}}, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self._cors()
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *a):
        pass


JS_READ = r'''(async () => {
  const d = await chrome.storage.local.get(['config', 'np_notes', 'np_pub_log', 'np_pub_files']);
  const note = (d.np_notes || []).find(n => n && n.id === '%s') || {};
  const ai = (d.config && d.config.ai) || {};
  return {
    adapted: (note.pub && note.pub.adapted && note.pub.adapted.xhs) || null,
    aiBase: ai.apiBaseUrl || '', aiKey: ai.apiKey || '',
    status: note.status || 'GONE',
    logN: (d.np_pub_log || []).length,
    xhs: ((d.np_pub_log || [])[0] || {}).xhs || null,
    files: Object.keys(d.np_pub_files || {}),
  };
})()''' % NID

JS_FIRE = r'''(() => {
  window.__retryResp = { pending: true };
  chrome.runtime.sendMessage({ action: 'npPubRetry', id: '%s', platform: 'xhs' })
    .then(r => { window.__retryResp = r; })
    .catch(e => { window.__retryResp = { portErr: String((e && e.message) || e) }; });
  return 'fired';
})()''' % NID

JS_TAIL = r'''(async () => {
  const d = await chrome.storage.local.get(['np_pub_log']);
  return { xhs: ((d.np_pub_log || [])[0] || {}).xhs || null, resp: window.__retryResp || null };
})()'''


def main():
    srv = ThreadingHTTPServer(('127.0.0.1', PORT), MockAI)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    print('mock AI on 127.0.0.1:%d' % PORT, flush=True)

    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        page = None
        for p in ctx.pages:
            if p.url.startswith(CONSOLE_URL):
                try:
                    p.evaluate('1+1')
                    page = p
                    break
                except Exception:
                    continue
        if not page:
            page = ctx.new_page()
            page.goto(CONSOLE_URL)
            time.sleep(2)
        page.bring_to_front()

        st0 = page.evaluate(JS_READ)
        print('== 起跑 == adapted.xhs=%s aiBase=%s aiKey=%s' % (
            '有' if st0['adapted'] else '无', st0['aiBase'], ('有' if st0['aiKey'] else '空')), flush=True)
        if not st0['adapted']:
            print('!! adapted.xhs 缺失，停', flush=True)
            return
        REPLY['title'] = st0['adapted'].get('title') or ''
        REPLY['body'] = st0['adapted'].get('body') or ''
        REPLY['tags'] = st0['adapted'].get('tags') or []
        print('   mock 将原样返回: title=%r tags=%s body[:40]=%r' % (REPLY['title'], REPLY['tags'], REPLY['body'][:40]), flush=True)

        old_base, old_key = st0['aiBase'], st0['aiKey']
        # 指向 mock（跑完还原）
        page.evaluate("(async () => { const d = await chrome.storage.local.get(['config']); const c = d.config || {}; c.ai = c.ai || {}; c.ai.apiBaseUrl = 'http://127.0.0.1:%d/v1'; c.ai.apiKey = 'sk-pubtest'; await chrome.storage.local.set({ config: c }); })()" % PORT)
        print('  config.ai → mock（原值已记，收尾还原）', flush=True)

        print('== fire npPubRetry xhs ==', flush=True)
        print(' ', page.evaluate(JS_FIRE), flush=True)

        print('== 蹲（每 8s，最长 %d 分钟） ==' % TIMEOUT_MIN, flush=True)
        t0 = time.time()
        last = None
        result = None
        try:
            while time.time() - t0 < TIMEOUT_MIN * 60:
                time.sleep(8)
                try:
                    st = page.evaluate(JS_TAIL)
                    tabs = len([p for p in ctx.pages if 'creator.xiaohongshu.com' in p.url])
                except Exception:
                    continue
                xt = json.dumps({'xhs': st['xhs'], 'resp': st['resp'], 'tabs': tabs, 'mock': MockAI.hits}, ensure_ascii=False)
                if xt != last:
                    print('  t+%4.0fs %s' % (time.time() - t0, xt), flush=True)
                    last = xt
                x = st['xhs'] or {}
                resp = st['resp'] or {}
                if (resp and not resp.get('pending')) or x.get('ok') or (x.get('msg') and '原地' in str(x.get('msg'))):
                    result = (x, resp)
                    break
            if result:
                print('  ★ 落袋: xhs=%s' % json.dumps(result[0], ensure_ascii=False), flush=True)
                print('    resp=%s' % json.dumps(result[1], ensure_ascii=False)[:400], flush=True)
            else:
                print('  时间到——末次:', last, flush=True)
                print('    resp=%s' % json.dumps((page.evaluate(JS_TAIL).get('resp') or {}), ensure_ascii=False)[:400], flush=True)
        finally:
            page.evaluate("(async () => { const d = await chrome.storage.local.get(['config']); const c = d.config || {}; c.ai = c.ai || {}; c.ai.apiBaseUrl = %s; c.ai.apiKey = %s; await chrome.storage.local.set({ config: c }); })()" % (json.dumps(old_base), json.dumps(old_key)))
            print('  配置已还原 aiBase=%r aiKey=%s mockHits=%d' % (old_base, '有' if old_key else '空', MockAI.hits), flush=True)


if __name__ == '__main__':
    main()
