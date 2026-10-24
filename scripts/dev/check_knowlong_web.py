# 公网那份（web/）知识线「🧠 思维导图 / 📜 长图」二选一点检 —— 2026-10-22。
# 走真链路：档案那篇 → 导图工作区 → 点「📜 长图」→ 预览换文章式排版 → 「✓ 完成，回档案」
#          → imgDocs 里 kind='mind' 那一行 layout='long'、宽 1080；再切回思维导图重出＝同一条行换图。
# 只用临时账本（tmp/knowlong-check/），不调 AI。
# 用法：python3 -X utf8 scripts/dev/check_knowlong_web.py
import os
import sys
import time
import shutil
import socket
import base64
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
from _guide_gate import goto_big

sys.stdout.reconfigure(encoding='utf-8')
REPO = Path(__file__).resolve().parents[2]
PORT = 8899
BASE = 'http://127.0.0.1:%d' % PORT
DATA = REPO / 'tmp' / 'knowlong-check' / 'data'
OUT = REPO / 'tmp' / 'knowlong-check'
fails = 0
COPY = '装修报价单怎么看？先看有没有漏项，再看总量。单价低不代表总价低。最后看付款节点，首付别超过一半。'
MD = ('# 装修报价单怎么看\n'
      '## 先看漏项\n'
      '- 报价单上没有的那一行，才是要花钱的\n'
      '  - 水电按实收最容易漏\n'
      '  - 收口和找平常被拆开写\n'
      '- 单价低不等于总价低\n'
      '## 再看总量\n'
      '- 面积按套内还是建筑面积\n'
      '  - 问清这一条再签字\n'
      '- 损耗谁承担\n'
      '## 最后看付款\n'
      '- 首付别超过一半\n'
      '- 每个节点验收完再付\n')


def ok(msg):
    print('  PASS ' + msg, flush=True)


def bad(msg):
    global fails
    fails += 1
    print('  FAIL ' + msg, flush=True)


SEED = r'''async (opt) => {
  const note = {
    id: opt.id, title: opt.title, form: '图文', dir: 'k', kOut: 'img', status: '草稿',
    draft: opt.copy, platform: 'xhs',
    mind: { md: opt.md, ver: 1, src: 'human', sig: npMindSig(opt.copy), out: 'mind' },
    imgDocs: [], createdAt: Date.now(), updatedAt: Date.now(),
  };
  await chrome.storage.local.set({ np_notes: [note] });
  return (await npNotesAll()).length;
}'''

OPEN = r'''async (opt) => {
  let host = document.getElementById('npMindCheckHost');
  if (!host) {
    host = document.createElement('div'); host.id = 'npMindCheckHost';
    host.style.cssText = 'position:fixed;left:0;top:0;width:1000px;background:#fff;z-index:99999;padding:0;overflow:auto;max-height:100vh;';
    document.body.appendChild(host);
  }
  const n = (await npNotesAll()).find(x => x.id === opt.id);
  if (!n) return { err: 'note not found' };
  ensureNpDelegation();
  npMindRender = function () {
    if (!_npMind) return;
    host.innerHTML = npMindHtml();
    const cv0 = host.querySelector('#npMindCv');
    if (cv0) npMindPaint(cv0, 1);
  };
  await npOpenMind(host, n);
  const cv = document.getElementById('npMindCv');
  return { out: _npMind && _npMind.out, w: cv && cv.width, h: cv && cv.height,
    text: host.innerText, mindBtn: !!host.querySelector('.np-mind-out[data-out="mind"]'),
    longBtn: !!host.querySelector('.np-mind-out[data-out="long"]'),
    activeLong: !!host.querySelector('.np-mind-out[data-out="long"][style*="background:#1f2937"]'),
    activeMind: !!host.querySelector('.np-mind-out[data-out="mind"][style*="background:#1f2937"]') };
}'''

STATE = r'''async (opt) => {
  const n = (await npNotesAll()).find(x => x.id === opt.id) || null;
  const cv = document.getElementById('npMindCv');
  const rows = (n && Array.isArray(n.imgDocs)) ? n.imgDocs.filter(x => x && x.kind === 'mind') : [];
  let dim = null, data = '';
  if (rows.length && rows[0].img) {
    data = rows[0].img;
    dim = await new Promise(r => { const im = new Image(); im.onload = () => r({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => r({ err: 1 }); im.src = rows[0].img; });
  }
  return { status: n && n.status, mind: n && n.mind, rows: rows.map(x => ({ id: x.id, layout: x.layout, len: String(x.img || '').length })),
    dim, data: data.indexOf(',') >= 0 ? data.slice(data.indexOf(',') + 1) : '',
    out: _npMind && _npMind.out, cvW: cv && cv.width, cvH: cv && cv.height };
}'''


def main():
    print('── 公网知识线🧠/📜二选一：默认导图 → 切长图 → 出 1080 文章式 → 切回重出同一条行 ──', flush=True)
    if DATA.exists():
        shutil.rmtree(DATA)
    DATA.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env['DEMO_DATA_DIR'] = str(DATA)
    env['PORT'] = str(PORT)
    env['DEMO_AI_KEY'] = 'check-only'
    env['DEMO_AI_BASE'] = 'http://127.0.0.1:9/v1'
    env['DEMO_SIGNUP_MAX'] = '60'
    logf = open(OUT / 'server.log', 'w', encoding='utf-8')
    srv = subprocess.Popen(['node', str(REPO / 'server' / 'dev-server.mjs')], env=env, stdout=logf, stderr=subprocess.STDOUT)
    for _ in range(80):
        try:
            socket.create_connection(('127.0.0.1', PORT), 1).close()
            break
        except OSError:
            time.sleep(0.5)
    else:
        bad('服务器没起来（看 tmp/knowlong-check/server.log）')
        return
    time.sleep(2)
    try:
        with sync_playwright() as p:
            br = p.chromium.launch(channel='msedge', headless=True)
            page = br.new_context(viewport={'width': 1500, 'height': 1100}).new_page()
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
            page.wait_for_timeout(4000)
            seed = page.evaluate(SEED, {'id': 'mindchk1', 'title': '装修报价单怎么看', 'copy': COPY, 'md': MD})
            if seed != 1:
                bad('种子档案没落上：%r' % (seed,))
            page.evaluate(OPEN, {'id': 'mindchk1'})
            page.wait_for_timeout(1200)
            st1 = page.evaluate(STATE, {'id': 'mindchk1'})
            ui1 = page.evaluate('''() => { const h = document.getElementById('npMindCheckHost');
              return { mindBtn: !!h.querySelector('.np-mind-out[data-out="mind"]'), longBtn: !!h.querySelector('.np-mind-out[data-out="long"]'),
                mindOn: !!h.querySelector('.np-mind-out[data-out="mind"][style*="background:#1f2937"]'),
                longOn: !!h.querySelector('.np-mind-out[data-out="long"][style*="background:#1f2937"]'),
                text: h.innerText }; }''')
            if ui1.get('mindBtn') and ui1.get('longBtn') and ui1.get('mindOn') and not ui1.get('longOn'):
                ok('老档（没记号）进站默认「🧠 思维导图」——二选一就在标题旁')
            else:
                bad('默认没落在思维导图：%r' % (ui1,))
            if st1.get('cvW') == 540 and (st1.get('cvH') or 0) > 0:
                ok('预览画布 540 宽、按内容定高（%s）' % (st1.get('cvH'),))
            else:
                bad('导图预览画布不对：%r' % (st1.get('cvW'), st1.get('cvH')))
            page.locator('#npMindCheckHost').screenshot(path=str(OUT / '1-mind.png'))
            ai_before = len(ai_reqs)
            page.click('#npMindCheckHost .np-mind-out[data-out="long"]')
            page.wait_for_timeout(900)
            st2 = page.evaluate(STATE, {'id': 'mindchk1'})
            ui2 = page.evaluate('''() => { const h = document.getElementById('npMindCheckHost');
              return { longOn: !!h.querySelector('.np-mind-out[data-out="long"][style*="background:#1f2937"]'),
                mindOn: !!h.querySelector('.np-mind-out[data-out="mind"][style*="background:#1f2937"]'),
                text: h.innerText }; }''')
            if st2.get('out') == 'long' and ui2.get('longOn') and not ui2.get('mindOn') and '出文章式长图' in (ui2.get('text') or ''):
                ok('点「📜 长图」＝当场换文章式排版（同一份 MD，不重出结构、不烧 AI）')
            else:
                bad('切长图没切成：%r / %r' % (st2.get('out'), ui2))
            if st2.get('cvW') == 540 and (st2.get('cvH') or 0) != (st1.get('cvH') or 0):
                ok('文章式预览另算高（%s → %s）' % (st1.get('cvH'), st2.get('cvH')))
            else:
                bad('切了排版画布没变：%r' % (st2.get('cvH'),))
            if (st2.get('mind') or {}).get('out') == 'long':
                ok('二选一的选择回写档案（mind.out=long）')
            else:
                bad('选择没回写档案：%r' % (st2.get('mind'),))
            page.locator('#npMindCheckHost').screenshot(path=str(OUT / '2-long-preview.png'))
            if len(ai_reqs) == ai_before:
                ok('切排版没打 AI（只换画法）')
            else:
                bad('切排版期间打了 AI：%r' % (ai_reqs[ai_before:][:3],))
            page.click('#npMindCheckHost .np-mind-export')
            page.wait_for_timeout(1500)
            st3 = page.evaluate(STATE, {'id': 'mindchk1'})
            rows = st3.get('rows') or []
            dim = st3.get('dim') or {}
            if rows and rows[0].get('layout') == 'long' and dim.get('w') == 1080 and (dim.get('h') or 0) > 0:
                ok('「✓ 完成，回档案」出的是 1080 宽文章式长图（%s×%s），imgDocs 记 layout=long' % (dim.get('w'), dim.get('h')))
            else:
                bad('出图不对：rows=%r dim=%r' % (rows, dim))
            if st3.get('status') == '代发':
                ok('出完这篇标到「代发」')
            else:
                bad('状态没推进：%r' % (st3.get('status'),))
            with page.expect_download() as dl:
                saved = page.evaluate('''async () => {
                  const n = (await npNotesAll()).find(x => x.id === 'mindchk1');
                  const row = ((n && n.imgDocs) || []).find(x => x && x.kind === 'mind');
                  if (!row || !row.img) return { ok: false };
                  const a = document.createElement('a'); a.href = row.img; a.download = 'knowledge-long.png';
                  document.body.appendChild(a); a.click(); a.remove();
                  return { ok: true, len: String(row.img).length };
                }''')
            if saved.get('ok'):
                dl.value.save_as(str(OUT / 'knowledge-long.png'))
                ok('档案里那张长图能直接下载（%dKB）' % (os.path.getsize(OUT / 'knowledge-long.png') // 1024))
            else:
                bad('档案里找不到可下载的长图')
            # 再开门切回导图、重出：同一条 imgDocs 行换图，不叠第二条
            page.evaluate(OPEN, {'id': 'mindchk1'})
            page.wait_for_timeout(900)
            page.click('#npMindCheckHost .np-mind-out[data-out="mind"]')
            page.wait_for_timeout(700)
            page.click('#npMindCheckHost .np-mind-export')
            page.wait_for_timeout(1500)
            st4 = page.evaluate(STATE, {'id': 'mindchk1'})
            rows4 = st4.get('rows') or []
            if len(rows4) == 1 and rows4[0].get('layout') == 'mind' and rows4[0].get('id') == rows[0].get('id'):
                ok('切回导图重出：档案里还是同一条行、同 id 换图（只留当前这种）')
            else:
                bad('切回重出叠行 / 没换对：%r' % (rows4,))
            if (st4.get('mind') or {}).get('out') == 'mind':
                ok('档案那边的选择也回到思维导图')
            else:
                bad('切回后档案没记回 mind：%r' % (st4.get('mind'),))
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
    print('\n结果：%s（图在 tmp/knowlong-check/）' % ('全过' if fails == 0 else '%d 项没过' % fails), flush=True)
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
