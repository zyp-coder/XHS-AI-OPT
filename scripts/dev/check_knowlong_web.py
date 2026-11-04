# 公网那份（web/）知识线「图文」点检 —— 2026-11-02 撤导图、改图文。
# 这一轮改的是两件事：① 知识行四张卡（🖼 图文笔记 / 🎬 视频笔记 / 🎙 真人口播 / 📝 长文笔记），导图整条撤掉；
# ② 知识图文接引流线后半段：挑知识 → 改稿 → 🖋 分镜确认（5）→ 👀 预览（6）→ 发布。
# 走真链路（不调 AI）：站点表 / 四站底栏 / 第 5 站渲染出分镜台 / 第 6 站渲染出成品预览
#          → 档案「下一步」缺图指回 5 站、图齐指预览 → 「✓ 完成，回档案」落档标「代发」
#          → 导图入口与工作区确实已撤（函数没了、容器没了）。
# 只用临时账本（tmp/knowlong-check/），不调 AI。
# 用法：python3 -X utf8 scripts/dev/check_knowlong_web.py
import os
import sys
import time
import shutil
import socket
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


def ok(msg):
    print('  PASS ' + msg, flush=True)


def bad(msg):
    global fails
    fails += 1
    print('  FAIL ' + msg, flush=True)


SEED = r'''async (opt) => {
  const shotsOf = (withImgs) => ({
    items: [
      { id: 's1', text: '先看有没有漏项', copyText: '漏项最费钱', imgs: withImgs ? ['a1'] : [] },
      { id: 's2', text: '单价低不等于总价低', copyText: '看总价', imgs: withImgs ? ['a2'] : [] },
      { id: 's3', text: '首付别超过一半', copyText: '付款节点', imgs: withImgs ? ['a3'] : [] },
    ],
    cv: withImgs ? { on: false, imgs: [] } : { on: true, imgs: [] },
  });
  const mk = (id, withImgs, extra) => Object.assign({
    id: id, title: '装修报价单怎么看', form: '图文', dir: 'k', kOut: 'img', status: '草稿',
    draft: opt.copy, platform: 'xhs', voice: opt.copy,
    imgDocs: [{ id: 'g' + id, pid: 'xhs', style: '', kind: '', img: '', shots: shotsOf(withImgs), visual: null, updatedAt: Date.now() }],
    createdAt: Date.now(), updatedAt: Date.now(),
  }, extra || {});
  await chrome.storage.local.set({ np_notes: [mk('kimg1', false), mk('kimg2', true)] });
  /* 真素材：三张 1×1 的图先放进素材库——「✓ 完成，回档案」要把图搬进待发区才算真能发 */
  const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await chrome.storage.local.set({ np_assets: ['a1', 'a2', 'a3'].map((aid, i) => ({
    id: aid, name: '装修图' + (i + 1), kind: '其他', use: true, thumb: px, shotOf: 'kimg2#0',
    createdAt: Date.now(), updatedAt: Date.now(),
  })) });
  return (await npNotesAll()).length;
}'''

WIZ = r'''async (opt) => {
  let host = document.getElementById('npKimgCheckHost');
  if (!host) {
    host = document.createElement('div'); host.id = 'npKimgCheckHost';
    host.style.cssText = 'position:fixed;left:0;top:0;width:1100px;background:#fff;z-index:99999;padding:12px;overflow:auto;max-height:100vh;';
    document.body.appendChild(host);
  }
  host.innerHTML = '<div id="npSteps"></div><div id="npWizBody"></div><div id="npWizNav"></div>';
  const bak = _npWiz;
  const w = { arId: opt.id, kOut: 'img', step: 5, status: '草稿',
    draft: { content: opt.copy, titles: ['装修报价单怎么看'] },
    imgDocs: (await npNotesAll()).find(x => x.id === opt.id).imgDocs };
  _npWiz = w;
  const cards = (NP_DIR_EFFECTS.k || []).map(e => ({ f: e.f, t: e.t }));
  const st = npKStations(w).map(x => ({ k: x.k, t: x.t }));
  w.step = 4; const nav4 = navForStep();
  w.step = 5; const nav5 = navForStep();
  renderStep(host);
  await new Promise(r => setTimeout(r, 900));
  const body5 = (document.getElementById('npWizBody') || {}).innerText || '';
  w.step = 6; const nav6 = navForStep();
  renderStep(host);
  await new Promise(r => setTimeout(r, 200));
  const body6 = (document.getElementById('npWizBody') || {}).innerText || '';
  const res = { cards: cards, stations: st, nav4: nav4, nav5: nav5, nav6: nav6, body5: body5, body6: body6,
    mindFn: typeof npOpenMind, mindBox: !!document.getElementById('noteMindContent') };
  _npWiz = bak;
  host.remove();
  return res;
}'''

NEXT = r'''async (opt) => {
  const list = await npNotesAll();
  const a = list.find(x => x.id === 'kimg1'), b = list.find(x => x.id === 'kimg2');
  return { gap: npArImgGapOf(a), next: npArNext(a).lab + '|' + (npArNext(a).to || ''),
    gap2: npArImgGapOf(b), next2: npArNext(b).lab + '|' + (npArNext(b).to || '') };
}'''

DONE = r'''async (opt) => {
  const bak = _npWiz;
  const n = (await npNotesAll()).find(x => x.id === 'kimg2');
  const w = { arId: n.id, kOut: 'img', path: 'image', step: 6, draft: { content: opt.copy, titles: ['装修报价单怎么看'] },
    imgDocs: n.imgDocs.map(r => Object.assign({}, r)), imgOpen: n.imgDocs[0].id };
  w.shots = npShotsShape(n.imgDocs[0].shots);
  _npWiz = w;
  await npDshDone();
  _npWiz = bak;
  const after = (await npNotesAll()).find(x => x.id === n.id);
  return { status: after.status, steps: w.step,
    rows: (after.imgDocs || []).length, hasPrompt: String(((after.imgDocs || [])[0] || {}).visual || '').length > 0 || !!(after.imgDocs || [])[0].visual };
}'''


def main():
    print('── 知识线图文：四张卡 → 分镜确认 → 预览 → 回档案；导图已撤 ──', flush=True)
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
            seed = page.evaluate(SEED, {'copy': COPY})
            if seed != 2:
                bad('种子档案没落上：%r' % (seed,))
            wiz = page.evaluate(WIZ, {'id': 'kimg1', 'copy': COPY})
            cards = wiz.get('cards') or []
            names = ''.join(c.get('t') or '' for c in cards)
            if [c.get('f') for c in cards] == ['图文', '视频', '口播稿', '长文'] and all(k in names for k in ('图文笔记', '视频笔记', '真人口播', '长文笔记')):
                ok('知识行四张卡：🖼 图文笔记 / 🎬 视频笔记 / 🎙 真人口播 / 📝 长文笔记')
            else:
                bad('四张卡不对：%r' % (cards,))
            ks = [x.get('k') for x in (wiz.get('stations') or [])]
            ts = ''.join(x.get('t') or '' for x in (wiz.get('stations') or []))
            if ks == [0, 4, 5, 6, -1] and '分镜确认' in ts and '预览' in ts:
                ok('站点条：挑知识 → 改稿 → 🖋 分镜确认（5）→ 👀 预览（6）→ 发布')
            else:
                bad('站点条不对：%r' % (wiz.get('stations'),))
            if 'np-d-fin-img' in (wiz.get('nav4') or '') and '拆分镜' in (wiz.get('nav4') or ''):
                ok('第 4 站底栏＝「下一步 → 拆分镜」')
            else:
                bad('第 4 站底栏不对：%r' % (wiz.get('nav4'),))
            if 'np-dsh-next' in (wiz.get('nav5') or '') and '下一步' in (wiz.get('nav5') or ''):
                ok('第 5 站底栏＝分镜确认的「下一步 →」（切出分镜才点得动）')
            else:
                bad('第 5 站底栏不对：%r' % (wiz.get('nav5'),))
            if 'np-dsh-done' in (wiz.get('nav6') or '') and '完成，回档案' in (wiz.get('nav6') or ''):
                ok('第 6 站底栏＝「✓ 完成，回档案」')
            else:
                bad('第 6 站底栏不对：%r' % (wiz.get('nav6'),))
            b5 = wiz.get('body5') or ''
            if '生成前定一次' in b5 and '整组提示词' in b5 and 'AI 读正文自己定' in b5:
                ok('第 5 站画的是分镜确认台（画面风格 / 张数 / 整组提示词）')
            else:
                bad('第 5 站没画分镜台：%r' % (b5[:120],))
            b6 = wiz.get('body6') or ''
            if '封面' in b6 and '正文（' in b6 and '科普腔' in b6:
                ok('第 6 站画的是成品预览：封面＋合成卡图＋正文（科普腔）')
            else:
                bad('第 6 站没画成品预览：%r' % (b6[:160],))
            nx = page.evaluate(NEXT)
            if nx.get('gap') and nx.get('gap') > 0 and nx.get('next') == '✏️ 编辑|img':
                ok('档案「下一步」：缺图那篇指回出图（缺 %s 张）' % (nx.get('gap'),))
            else:
                bad('缺图篇的下一步不对：%r' % (nx,))
            if nx.get('gap2') == 0 and nx.get('next2') == '👀 预览|preview':
                ok('档案「下一步」：图齐那篇直接指预览')
            else:
                bad('图齐篇的下一步不对：%r' % (nx.get('next2'), nx.get('gap2')))
            done = page.evaluate(DONE, {'copy': COPY})
            if done.get('status') == '代发':
                ok('「✓ 完成，回档案」＝落档标「代发」')
            else:
                bad('完成没落成代发：%r' % (done,))
            if done.get('rows') == 1:
                ok('落档后还是同一套图（不叠第二行）')
            else:
                bad('落档后图行数不对：%r' % (done.get('rows'),))
            if wiz.get('mindFn') == 'undefined' and not wiz.get('mindBox'):
                ok('导图入口与容器都已撤（npOpenMind 没了、#noteMindContent 没了）')
            else:
                bad('导图还留着：fn=%r box=%r' % (wiz.get('mindFn'), wiz.get('mindBox')))
            if ai_reqs:
                bad('这轮点检不该打 AI，但打了：%r' % (ai_reqs[:3],))
            else:
                ok('整场没打 AI（只看界面与落档）')
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
