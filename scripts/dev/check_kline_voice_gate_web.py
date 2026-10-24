# 知识线「🎙 口播稿」这一篇的选出口那一屏 —— 公网那份 web/ 的浏览器实点。
# 老板定稿（2026-10-19 晚）：所有口播的都走这一张卡，三档＝① 自己对着镜头念 ② 发工单 ③ 字效片；
#                     旧的「只拍手」「图文卡」两档撤掉，口播篇也不再进「这一档要做成什么片」那一排。
# 需求档案：资料/发笔记-口播选出口三档设计.md（门面介绍篇那张卡＝同一张卡、同一个档案格 fGate）
# 这一支只管知识线这一侧：⑤ 改稿那一屏底下长出来的三选一卡（noIntro 版）＋三条出路各走一遍：
#   （2026-10-20 批 D 口径：出口站不直接收口——底右「下一步 → · 去预览」→ 👀 预览站 → 「✓ 存好，回档案」才落档）
#   出口空着：照样进得去预览（那屏不拦），但点「✓ 存好，回档案」顶回一句、这篇不落档；档案那一行指回选出口
#   ① 点卡 → 提词卡（一句一屏）→ 点「🎥 拿逐句录的链接」→ 先落档再在云端挂一张 route=self 的单（不占额度、不进工单台）→ 去预览 → 存好回档案
#   ② 点卡 → 「交三样」那块 → 点「📤 交这张单」→ 先落档，就地开建单那一屏（弹层：只收照片＋一句音色）
#   ③ 点卡 → 「稿子直接进字效编辑器」那块 → 去预览 → 存好 → 落档后排一行片、直接进片台
#   旧档案里存过「只拍手」那两档的 → 认不出来就当没选
# 本机：node 起一台只用临时账本的服务器（DEMO_DATA_DIR 指 tmp/，绝不碰 server/data/）。
# 出稿／改稿那两支 AI 不碰：稿子直接灌进档案再进向导，屏上摆的就是这份现成稿。
# 用法：python3 -X utf8 scripts/dev/check_kline_voice_gate_web.py
import os
import sys
import time
import socket
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
from _guide_gate import goto_big

sys.stdout.reconfigure(encoding='utf-8')
REPO = Path(__file__).resolve().parents[2]
TAG = 'kline-gate-check'
OUT = REPO / 'tmp' / TAG
DATA = OUT / 'data'
fails = 0


def ok(msg):
    print('  PASS ' + msg, flush=True)


def bad(msg):
    global fails
    fails += 1
    print('  FAIL ' + msg, flush=True)


def _free_port():   # 别的会话也在本机起测试服，固定端口会撞车（撞上就点到别人那个站上了）
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


PORT = _free_port()
BASE = 'http://127.0.0.1:%d' % PORT
COPY = ('这句是开场，先把人留住。\n\n这段讲料，说清一处就行。\n\n'
        '这段讲手艺，两句收住。\n\n结尾这句，让人直接私信我。')
TITLE = '口播出口这一篇'
SEGS = 4

# 页内共用的小工具（装在 window.__kg 上，几趟点检都用它）
PRE = r'''() => {
  const H = {};
  H.sleep = (ms) => new Promise(s => setTimeout(s, ms));
  H.one = (s) => document.querySelector(s);
  H.txt = (s) => { const e = H.one(s); return e ? String(e.textContent || '').trim() : ''; };
  H.vis = (sel) => { const e = H.one(sel); return !!e && e.getClientRects().length > 0; };
  H.body = () => String((H.one('#npWizBody') || {}).textContent || '');
  H.toast = () => String((H.one('#popToastBox') || {}).textContent || '');
  H.clearToast = () => { const e = H.one('#popToastBox'); if (e) e.innerHTML = ''; };
  H.ready = async (fn, ms) => { const t0 = Date.now();
    while (Date.now() - t0 < (ms || 12000)) { try { if (fn()) return true; } catch (e) {} await H.sleep(120); } return false; };
  H.card = (g) => H.one('#npWizBody .npf-gate[data-g="' + g + '"]');
  H.cardText = (g) => String((H.card(g) || {}).textContent || '').replace(/\s+/g, '');
  H.keys = () => [...document.querySelectorAll('#npWizBody .npf-gate')].map(e => String(e.getAttribute('data-g') || ''));
  H.titles = () => [...document.querySelectorAll('#npWizBody .npf-gate b')].map(e => String(e.textContent || '').trim());
  H.tpRows = () => [...document.querySelectorAll('#npWizBody span')]
    .map(e => String(e.textContent || '').trim()).filter(t => /^屏\d+$/.test(t)).length;
  H.shotRows = () => [...document.querySelectorAll('#npWizBody span')]
    .map(e => String(e.textContent || '').trim()).filter(t => t.indexOf('拍：') === 0).length;
  H.nextOf = (n) => { const x = npArNext(n) || {}; return { lab: String(x.lab || ''), tip: String(x.tip || ''), to: String(x.to || '') }; };
  H.click = async (sel, ms) => { const e = H.one(sel); if (!e) { (window.__kgMiss || (window.__kgMiss = [])).push(sel); return false; }
    e.click(); await H.sleep(ms || 500); return true; };
  // 起一篇知识线口播篇：六卡建篇 → 现成稿灌进档案 → 从档案那一行进向导（真实通路，步值自己收到 ⑤ 改稿那一屏）
  H.newK = async (cfg, tag) => {
    const ni = await npDirNewNote('k', '口播稿');
    await npNotesSync(async () => {
      const list = await npNotesAll();
      const n = list.filter(x => x && x.id === ni.id)[0];
      n.draft = cfg.copy; n.titles = [cfg.title + '·' + tag]; n.tags = ['#装修干货']; n.topic = '口播出口点检';
      n.wip = { step: 4, path: '', noteStyle: {}, write: null, planItem: null };
      n.updatedAt = Date.now();
      try { await chrome.storage.local.set({ [NP_NOTES_KEY]: list }); } catch (e) {}
    });
    return ni.id;
  };
  H.enter = async (id) => {
    const n = await npArFindById(id);
    if (!n) return '档案里找不到这一篇';
    H.last = { draftLen: String(n.draft || '').length, form: String(n.form || ''), dir: String(n.dir || ''),
               kOut: String(n.kOut || ''), wip: JSON.stringify(n.wip || {}), title: String(n.title || '') };
    switchMainTab('notePublish', n);
    if (!await H.ready(() => _npWiz && String(_npWiz.arId || '') === id && H.vis('#npWizBody'))) {
      return Object.assign({ err: '向导没打开这一篇' }, H.last);
    }
    await H.sleep(700);
    if (!await H.ready(() => H.card('talk'), 9000)) {
      return Object.assign({ err: '三档卡没长出来', step: _npWiz.step, wizDraft: String((_npWiz.draft && _npWiz.draft.content) || '').length,
                             kGate: String(_npWiz.kGate || ''), path: String(_npWiz.path || ''), body: H.body().slice(0, 120) }, H.last);
    }
    return '';
  };
  window.__kg = H;
  // 记下这一趟跳去过哪些页（① 档收口要回档案那一行、③ 档要进片台）
  if (!window.__kgHops) {
    window.__kgHops = [];
    const sw = window.switchMainTab;
    window.__kgSw = sw;
    window.switchMainTab = function (name) { window.__kgHops.push(String(name)); return sw.apply(this, arguments); };
  }
  return true;
}'''

PH_A = r'''async (CFG) => {
  const H = window.__kg, R = {}, hops = window.__kgHops;
  const note = async (id) => await npArFindById(id);

  // ── 一、三档卡本身 ＋ 没选出口就点「完成」 ──
  const idG = await H.newK(CFG, '没选出口');
  let e = await H.enter(idG);
  if (e) return { cards: { err: e } };
  R.cards = { keys: H.keys(), titles: H.titles(),
    hasHand: /只拍手|对着手拍/.test(H.body()), hasImgCard: /图文卡/.test(H.body()),
    hasIntro: /默认推第一档/.test(H.body()),
    head: /这篇最后怎么出去——三选一/.test(H.body()),
    deliver: [...document.querySelectorAll('#npWizBody .npf-gate')].map(el => {
      const t = String(el.textContent || '').replace(/\s+/g, ''), i = t.indexOf('交付：');
      return i < 0 ? '' : t.slice(i + 3, i + 32);
    }) };
  R.goBtn = H.txt('.np-k-prev-go');
  R.goHint = (String((H.one('#npWizNav') || {}).textContent || '').match(/(先在上面选一条出路[^·]{0,12}|出口：[^·]{0,14})/) || [''])[0];
  R.oldFinGone = !H.one('.np-k-fin-voice');
  hops.length = 0;
  await H.click('.np-k-prev-go', 900);
  const flat = H.body().replace(/\s+/g, '');
  const pg = { step: _npWiz.step, head: /👀 预览/.test(H.body()), gateNote: /在那张三选一卡上钉一条/.test(H.body()),
         form: /🎙 口播稿/.test(H.body()), tone: flat.indexOf('第一人称照念') >= 0,
         dlPub: flat.indexOf('发布出口还没选') >= 0, showsCopy: H.body().indexOf(CFG.copy.slice(0, 12)) >= 0,
         tpBtn: !!H.one('.np-k-prev-tp'), backBtn: H.txt('.np-k-prev-back'), doneBtn: H.txt('.np-k-prev-done') };
  H.clearToast();
  await H.click('.np-k-prev-done', 1000);
  const ag = await note(idG);
  R.guard = { prev: pg, toast: H.toast(), status: ag.status, gate: String(ag.fGate || ''), next: H.nextOf(ag), hops: hops.slice() };

  // ── 二、① 自己对着镜头念：点卡 → 提词卡 → 拿链接（先落档、云端挂 route=self 的单）→ 完成回档案 ──
  const idT = await H.newK(CFG, '自己念');
  e = await H.enter(idT);
  if (e) return Object.assign({ talk: { err: e } }, R);
  await H.click('.npf-gate[data-g="talk"]', 600);
  const t = { kGate: String(_npWiz.kGate || ''), cardText: H.cardText('talk') };
  t.teleprompt = /提词卡长这样（一句一屏）/.test(H.body());
  t.rows = H.tpRows(); t.shots = H.shotRows();
  t.noOrderBlock = /不进工单台、也不占老板每天接单额度/.test(H.body());
  t.selfBtn = H.txt('[data-gate="selfopen"]');
  t.secHint = (H.body().match(/念下来约\s*\d+\s*秒/) || [''])[0];
  t.orderBtnGone = !H.one('[data-gate="orderopen"]');
  const mineBefore = await lipApi('/api/lip/mine', {});
  await H.click('[data-gate="selfopen"]', 300);
  t.gotLink = await H.ready(() => _npWiz.lip && _npWiz.lip.id, 15000);
  const tn = await note(idT);
  t.linkToast = H.toast();
  t.lip = _npWiz.lip || null;
  t.linkShown = H.vis('[data-gate="selfview"]') && H.vis('[data-gate="selfcopy"]');
  t.linkUrl = (H.body().match(/lip-record\.html\?job=[^&\s]+&t=[^&\s]+/) || [''])[0];
  t.note = { fGate: String(tn.fGate || ''), status: tn.status, form: tn.form, kOut: String(tn.kOut || ''),
             voiceIsCopy: String(tn.voice || '') === CFG.copy, lipRoute: (tn.lip || {}).route,
             lipIdSame: (tn.lip || {}).id === String((t.lip || {}).id || ''), next: H.nextOf(tn) };
  const jid = String((t.lip || {}).id || '');
  const mineAfter = await lipApi('/api/lip/mine', {});
  const boss = await lipApi('/api/lip/jobs', {});
  t.server = { route: (t.lip || {}).route, state: (t.lip || {}).state, segCount: (t.lip || {}).segCount,
               usedBefore: (mineBefore.quota || {}).used, usedAfter: (mineAfter.quota || {}).used,
               daily: (mineAfter.quota || {}).daily, leftAfter: (mineAfter.quota || {}).left,
               inMine: (mineAfter.jobs || []).filter(j => String(j.id) === jid).length,
               inBoss: (boss.jobs || []).filter(j => String(j.id) === jid).length,
               bossCount: (boss.jobs || []).length };
  hops.length = 0;
  await H.click('.np-k-prev-go', 900);
  const flatT = H.body().replace(/\s+/g, '');
  const pv = { step: _npWiz.step, head: /👀 预览/.test(H.body()),
               showsCopy: H.body().indexOf(CFG.copy.slice(0, 12)) >= 0,
               form: /🎙 口播稿/.test(H.body()), dlPub: flatT.indexOf('发布自己对着镜头念') >= 0,
               noWarn: !/在那张三选一卡上钉一条/.test(H.body()),
               tpBtn: H.txt('.np-k-prev-tp'), backBtn: H.txt('.np-k-prev-back'), doneBtn: H.txt('.np-k-prev-done') };
  H.clearToast();
  await H.click('.np-k-prev-tp', 500);
  pv.tpToast = H.toast();
  H.clearToast();
  await H.click('.np-k-prev-done', 1500);
  const tn2 = await note(idT);
  t.prev = pv;
  t.finish = { hops: hops.slice(), toast: H.toast(), status: tn2.status, fGate: String(tn2.fGate || ''),
               wizVisible: H.vis('#npWizBody'), next: H.nextOf(tn2) };
  R.talk = t;

  // ── 三、② 发工单：点卡 → 交三样那块 → 「📤 交这张单」先落档、就地开建单那一屏 ──
  const idO = await H.newK(CFG, '发工单');
  e = await H.enter(idO);
  if (e) return Object.assign({ order: { err: e } }, R);
  await H.click('.npf-gate[data-g="order"]', 600);
  const o = { kGate: String(_npWiz.kGate || ''), cardText: H.cardText('order') };
  o.block = { three: /这一档交三样/.test(H.body()),
              items: (H.body().match(/一张正脸照\s*＋\s*这篇稿子\s*＋\s*一句想要的音色/) || [''])[0],
              daily: /老板每天集中做/.test(H.body()), noFace: /不用你出镜/.test(o.cardText),
              noTeleprompt: !/提词卡长这样/.test(H.body()), noSelfBtn: !H.one('[data-gate="selfopen"]') };
  o.orderBtn = H.txt('[data-gate="orderopen"]');
  hops.length = 0;
  await H.click('[data-gate="orderopen"]', 300);
  o.modalOpened = await H.ready(() => H.vis('#dirModal'), 15000);
  await H.sleep(1400);
  const mt = String((H.one('#dirBox') || {}).textContent || '').replace(/\s+/g, '');
  const on = await note(idO);
  o.modal = { title: (mt.match(/《[^》]*》/) || [''])[0], three: /这一档交三样/.test(mt),
              photo: /选一张正脸照/.test(mt), photoAccept: String((H.one('.npl-photo') || {}).accept || ''),
              wish: /音色/.test(mt), agree: /本人同意/.test(mt), cap9: (mt.match(/一天接\s*\d+\s*条/) || [''])[0],
              due: (mt.match(/明天\s*\d{1,2}:00\s*前/) || [''])[0], noSelfRoute: !/一段段录|对着镜头念/.test(mt),
              close: H.txt('.np-dir-close') };
  o.note = { fGate: String(on.fGate || ''), status: on.status, form: on.form, hasLip: !!on.lip, next: H.nextOf(on) };
  o.hops = hops.slice();
  if (o.modalOpened) { await H.click('.np-dir-close', 500); }
  R.order = o;

  // ── 四、③ 字效片：点卡 → 一句说明 → 完成 → 落档后进片台 ──
  const idF = await H.newK(CFG, '字效片');
  e = await H.enter(idF);
  if (e) return Object.assign({ film: { err: e } }, R);
  await H.click('.npf-gate[data-g="film"]', 600);
  const f = { kGate: String(_npWiz.kGate || ''), cardText: H.cardText('film') };
  f.block = { toEditor: /稿子直接进字效编辑器/.test(H.body()),
              notInRow: /不再出现在「这一档要做成什么片」那一排里/.test(H.body()),
              noSelfBtn: !H.one('[data-gate="selfopen"]'), noOrderBtn: !H.one('[data-gate="orderopen"]'),
              reuseTag: /接现有通路，不重做/.test(f.cardText) };
  hops.length = 0;
  await H.click('.np-k-prev-go', 900);
  const pvF = { step: _npWiz.step, doneBtn: H.txt('.np-k-prev-done'), tpBtnGone: !H.one('.np-k-prev-tp') };
  await H.click('.np-k-prev-done', 2500);
  const fn = await note(idF);
  f.prev = pvF;
  f.after = { hops: hops.slice(), toast: H.toast(), mode: String(_npMode), status: fn.status,
              fGate: String(fn.fGate || ''), form: fn.form, filmKind: String(fn.filmKind || ''),
              filmDocs: (fn.filmDocs || []).map(x => String(x.kind || '')).join('/'),
              hasVoice: String(fn.voice || '').length > 0, wizVisible: H.vis('#npWizBody'), filmPane: H.vis('#filmPane') };
  f.kinds = (typeof NP_FILM_KINDS !== 'undefined') ? NP_FILM_KINDS.map(k => k.k) : null;
  R.film = f;

  R.ids = { talk: idT, order: idO, film: idF };
  R.miss = window.__kgMiss || [];
  return R;
}'''

# 拍完照片再动这一本账：这两篇的出口那一格改成「没选／已撤的那一档」，看档案那一行怎么指路
PH_C = r'''async (a) => {
  const H = window.__kg;
  await npNotesSync(async () => {
    const list = await npNotesAll();
    list.forEach(x => {
      if (!x || x.dir !== 'k' || x.form !== '口播稿') return;
      if (String(x.fGate || '') === 'talk') x.fGate = 'hand';        // 旧档存过、这一轮撤掉的那一档
      else if (String(x.fGate || '') === 'order') x.fGate = '';      // 稿子落档了、出口那一格空着
    });
    try { await chrome.storage.local.set({ [NP_NOTES_KEY]: list }); } catch (e) {}
  });
  const nlist = await npNotesAll();
  const lg = nlist.filter(x => x && x.dir === 'k' && x.form === '口播稿' && x.fGate === 'hand')[0];
  const ng = nlist.filter(x => x && String(x.id) === String(a.order))[0];
  window.switchMainTab = window.__kgSw;
  return { legacy: lg ? H.nextOf(lg) : { err: '没造出旧档那一篇' },
           noGate: ng ? Object.assign({ voice: String(ng.voice || '').length, status: ng.status }, H.nextOf(ng)) : { err: '没找到发工单那一篇' } };
}'''

# 照片：回开某一篇的 ⑤ 这一屏，点上某一档，摊开给人眼看
PH_SHOT = r'''async (a) => {
  const H = window.__kg;
  const e = await H.enter(a.id);
  if (e) return { err: e };
  await H.click('.npf-gate[data-g="' + a.g + '"]', 600);
  return { gate: String(_npWiz.kGate || ''), body: H.body().slice(0, 60) };
}'''


def snap(page, name):
    try:
        page.screenshot(path=str(OUT / (name + '.png')))
    except Exception as e:
        print('  （照片没拍成 %s：%s）' % (name, e), flush=True)


def main():
    print('── 起一台只用临时账本的服务器（端口 %d）──' % PORT, flush=True)
    DATA.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env['DEMO_DATA_DIR'] = str(DATA)
    env['PORT'] = str(PORT)
    env['DEMO_AI_KEY'] = 'check-only-no-key'
    env['DEMO_AI_BASE'] = 'http://127.0.0.1:1/v1'
    env['DEMO_SIGNUP_MAX'] = '60'
    logf = open(REPO / 'tmp' / (TAG + '.server.log'), 'w', encoding='utf-8')
    srv = subprocess.Popen(['node', str(REPO / 'server' / 'dev-server.mjs')], env=env, stdout=logf, stderr=subprocess.STDOUT)
    for _ in range(80):
        try:
            socket.create_connection(('127.0.0.1', PORT), 1).close()
            break
        except OSError:
            time.sleep(0.5)
    else:
        bad('服务器没起来（看 tmp/%s.server.log）' % TAG)
        return
    time.sleep(2)
    r = {}
    try:
        with sync_playwright() as p:
            br = p.chromium.launch(channel='msedge', headless=True)
            page = br.new_context(viewport={'width': 1100, 'height': 1100}).new_page()
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            page.goto(BASE + '/start.html', wait_until='domcontentloaded', timeout=90000)
            page.wait_for_timeout(1500)
            who = page.evaluate('''async (a) => await (await fetch('/api/auth/demo', { method: 'POST',
                headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: a.key }) })).json()''',
                {'key': 'deco'})
            if not who.get('ok'):
                bad('演示号没进上：%r' % (who,))
                br.close()
                return
            goto_big(page, BASE + '/popup.html?mode=big', wait_until='domcontentloaded', timeout=90000)
            page.wait_for_timeout(5000)
            page.evaluate(PRE)
            r = page.evaluate(PH_A, {'copy': COPY, 'title': TITLE}) or {}
            ids = r.get('ids') or {}
            for g, key, name in (('talk', 'talk', '1-第一档摊开'), ('order', 'order', '2-第二档摊开'), ('film', 'film', '3-第三档摊开')):
                if ids.get(key):
                    page.evaluate(PH_SHOT, {'id': ids[key], 'g': g})
                    page.wait_for_timeout(600)
                    snap(page, name)
            if ids.get('order'):
                r.update(page.evaluate(PH_C, {'order': ids['order']}) or {})
            br.close()
        if errs:
            bad('页面报错 %d 条：%s' % (len(errs), str(errs[0])[:200]))
    finally:
        srv.terminate()
    report(r)
    print('── 照片：%s ──' % OUT, flush=True)
    print('── 结果：%s ──' % ('全过' if not fails else '%d 处没过' % fails), flush=True)
    sys.exit(1 if fails else 0)


def report(r):
    if r.get('miss'):
        bad('有钮没找到：%s' % r['miss'])
    c = r.get('cards') or {}
    if c.get('err'):
        bad('三档卡这一屏没走通：%s' % c)
        return
    if c.get('keys') == ['talk', 'order', 'film']:
        ok('知识线口播篇 ⑤ 这一屏底下只有三档卡：%s' % ' / '.join(c.get('titles') or []))
    else:
        bad('卡不是三档：%s' % c)
    if not c.get('hasHand') and not c.get('hasImgCard'):
        ok('撤掉的两档在这屏找不到了（「只拍手」「图文卡」都没有）')
    else:
        bad('撤掉的档位还在：只拍手=%s 图文卡=%s' % (c.get('hasHand'), c.get('hasImgCard')))
    if c.get('head') and c.get('hasIntro') is False:
        ok('知识线这一侧只留「这篇最后怎么出去——三选一」这一行，不重复门面那段推荐话')
    else:
        bad('知识线这一侧的卡不对：标题=%s 介绍段=%s' % (c.get('head'), c.get('hasIntro')))
    dl = c.get('deliver') or []
    if len(dl) == 3 and all(dl):
        ok('三档各写清交付什么：%s' % ' ｜ '.join(dl))
    else:
        bad('交付那行不对：%s' % dl)
    if r.get('oldFinGone') and r.get('goBtn') == '下一步 →' and r.get('goHint'):
        ok('这一屏不再直接收口：底右改成「%s」，旁边写「%s」' % (r.get('goBtn'), r.get('goHint')))
    else:
        bad('这一屏的钮不对：%s／旧的完成钮还在=%s' % (r.get('goBtn'), not r.get('oldFinGone')))
    g = r.get('guard') or {}
    p0 = g.get('prev') or {}
    if (p0.get('step') == 7 and p0.get('head') and p0.get('showsCopy') and p0.get('gateNote')
            and p0.get('dlPub') and p0.get('form') and p0.get('tone')
            and p0.get('backBtn') == '← 回改' and p0.get('doneBtn') == '✓ 存好，回档案' and not p0.get('tpBtn')):
        ok('没选出口也先去得了预览这一屏：正文摆出来，右边「发布」那格写「出口还没选」并提醒回上一站钉一条，底栏「%s／%s」，提词卡那颗不出现'
           % (p0.get('backBtn'), p0.get('doneBtn')))
    else:
        bad('没选出口的预览这一屏不对：%s' % p0)
    if '先在那张卡上选一条出路' in str(g.get('toast')) and g.get('status') == '草稿' and not g.get('hops'):
        ok('出口空着点「✓ 存好，回档案」：顶回一句（%s），这篇没落档、也没跳页' % str(g.get('toast'))[:40])
    else:
        bad('出口空着的存好没拦住：%s' % g)
    nx = g.get('next') or {}
    if nx.get('lab') == '✏️ 编辑' and nx.get('to') == 'write':
        ok('没选出口的这篇还留在草稿：档案那一行「%s」指回收出口这一屏（%s）' % (nx.get('lab'), str(nx.get('tip'))[:34]))
    else:
        bad('档案指路不对：%s' % nx)

    t = r.get('talk') or {}
    if t.get('err'):
        bad('① 档这一岔没走通：%s' % t)
    else:
        if t.get('teleprompt') and t.get('rows') == SEGS and t.get('shots') >= 3:
            ok('点第一档：提词卡一句一屏摆出来（%s 屏、配 %s 条拍法）' % (t.get('rows'), t.get('shots')))
        else:
            bad('提词卡不对：%s' % {k: t.get(k) for k in ('teleprompt', 'rows', 'shots')})
        if t.get('noOrderBlock') and t.get('selfBtn') == '🎥 拿逐句录的链接' and t.get('orderBtnGone'):
            ok('第一档那块说清「不进工单台、也不占老板每天接单额度」，只挂一颗「%s」' % t.get('selfBtn'))
        else:
            bad('第一档那块不对：%s' % {k: t.get(k) for k in ('noOrderBlock', 'selfBtn', 'orderBtnGone')})
        if t.get('secHint'):
            ok('钮边上一句白话报了时长：%s' % t.get('secHint'))
        else:
            bad('没报念下来约几秒：%s' % t.get('secHint'))
        n = t.get('note') or {}
        if (n.get('fGate') == 'talk' and n.get('status') == '代发' and n.get('form') == '口播稿'
                and n.get('voiceIsCopy') and n.get('lipRoute') == 'self' and n.get('lipIdSame')):
            ok('点「拿逐句录的链接」：这篇先落进档案（出口「talk」·状态「%s」·形式「%s」·稿子＝正文），单挂在云端（route=self）'
               % (n.get('status'), n.get('form')))
        else:
            bad('① 档落档或挂单不对：%s' % n)
        s = t.get('server') or {}
        if s.get('segCount') == SEGS and s.get('usedBefore') == s.get('usedAfter') and s.get('leftAfter') == s.get('daily'):
            ok('① 档一张也不占老板每天接单额度（建单前今日 %s 单 → 建完还是 %s 单，还剩 %s/%s）'
               % (s.get('usedBefore'), s.get('usedAfter'), s.get('leftAfter'), s.get('daily')))
        else:
            bad('额度不对：%s' % s)
        if s.get('inBoss') == 0 and s.get('inMine') == 1:
            ok('这张单不进老板工单台（台子上摆 %s 张），但客户机自己查得到——片子能自动取回这一篇' % s.get('bossCount'))
        else:
            bad('工单台／我的单不对：%s' % s)
        if t.get('linkShown') and '&t=' in str(t.get('linkUrl')):
            ok('链接摆回卡上：「开逐句录那一页」＋「抄这条链接」（%s…）' % str(t.get('linkUrl'))[:62])
        else:
            bad('链接那一块不对：%s' % {k: t.get(k) for k in ('linkShown', 'linkUrl')})
        fi = t.get('finish') or {}
        pvT = t.get('prev') or {}
        if (pvT.get('step') == 7 and pvT.get('head') and pvT.get('showsCopy') and pvT.get('noWarn')
                and pvT.get('dlPub') and pvT.get('tpBtn') == '🎙 复制提词卡' and '复制' in str(pvT.get('tpToast'))):
            ok('选好第一档后进预览：正文摆出来、右边「发布」那格认到「自己对着镜头念」，底下那颗「%s」点得动（%s）'
               % (pvT.get('tpBtn'), str(pvT.get('tpToast'))[:26])
               )
        else:
            bad('第一档的预览这一屏不对：%s' % pvT)
        if 'noteArchive' in (fi.get('hops') or []) and fi.get('fGate') == 'talk' and fi.get('wizVisible') is False:
            ok('预览这一屏点「✓ 存好，回档案」：按选的出口落档后回档案那一行（%s）' % str(fi.get('toast'))[:38])
        else:
            bad('① 档收口不对：%s' % fi)
        if (fi.get('next') or {}).get('lab') in ('🎥 接着念', '🎥 等云端串片', '🎥 拿逐句录的链接'):
            ok('档案那一行接下去指「%s」' % (fi.get('next') or {}).get('lab'))
        else:
            bad('① 档档案指路不对：%s' % fi.get('next'))

    o = r.get('order') or {}
    if o.get('err'):
        bad('② 档这一岔没走通：%s' % o)
    else:
        b = o.get('block') or {}
        if b.get('three') and b.get('items') and b.get('daily') and b.get('noTeleprompt') and b.get('noSelfBtn'):
            ok('点第二档：摊开「交三样」那块（%s），不提词卡、不挂逐句录那颗钮' % b.get('items'))
        else:
            bad('第二档那块不对：%s' % b)
        if o.get('orderBtn') in ('📤 交这张单', '🎙 看这张单'):
            ok('第二档那颗钮：「%s」' % o.get('orderBtn'))
        else:
            bad('第二档的钮不对：%s' % o.get('orderBtn'))
        md = o.get('modal') or {}
        if o.get('modalOpened') and md.get('photo') and md.get('photoAccept') == 'image/*' and md.get('wish') and md.get('cap9'):
            ok('点「交这张单」：这篇先落档，就地开建单那一屏——只收正脸照（%s）＋一句音色，顶上写着%s'
               % (md.get('photoAccept'), md.get('cap9')))
        else:
            bad('建单那一屏不对：%s / 开了吗=%s' % (md, o.get('modalOpened')))
        if md.get('noSelfRoute') is False:
            bad('建单那一屏混进了「对着镜头念」那套话术：%s' % md)
        elif not md.get('due'):
            bad('建单那一屏没写片什么时候回来：%s' % md)
        else:
            ok('建单那一屏只交照片这一样料（没混逐句录），写明「%s」片回来；退出口是「%s」' % (md.get('due'), md.get('close')))
        n = o.get('note') or {}
        if n.get('fGate') == 'order' and n.get('status') == '代发' and n.get('hasLip') is False \
                and (n.get('next') or {}).get('lab') == '📤 交这张单':
            ok('这篇已落档、单还没交出去 → 档案那一行还指「%s」（弹层点了「先不交」也不算交完）' % (n.get('next') or {}).get('lab'))
        else:
            bad('第二档落档／指路不对：%s' % n)

    f = r.get('film') or {}
    if f.get('err'):
        bad('③ 档这一岔没走通：%s' % f)
    else:
        b = f.get('block') or {}
        if b.get('toEditor') and b.get('notInRow') and b.get('noSelfBtn') and b.get('noOrderBtn'):
            ok('点第三档：一句话说明「稿子直接进字效编辑器」，并写明口播篇不再进「这一档要做成什么片」那一排')
        else:
            bad('第三档那块不对：%s' % b)
        a = f.get('after') or {}
        pvF = f.get('prev') or {}
        if pvF.get('step') == 7 and pvF.get('doneBtn') == '✓ 存好，回档案' and pvF.get('tpBtnGone'):
            ok('第三档也走同一张预览屏：底栏只有「← 回改／✓ 存好，回档案」，不挂提词卡那颗')
        else:
            bad('第三档的预览这一屏不对：%s' % pvF)
        if a.get('fGate') == 'film' and a.get('status') == '代发' and a.get('filmKind') == 'PPT字体动效' \
                and a.get('hasVoice') and a.get('wizVisible') is False:
            ok('预览里点「✓ 存好，回档案」：落档（出口「film」）→ 排一行「%s」的片 → 直接进字效那条路（跳页：%s）'
               % (a.get('filmKind'), '/'.join(a.get('hops') or []) or a.get('mode')))
        else:
            bad('第三档收口不对：%s' % a)
        if f.get('kinds') and '实拍' not in f['kinds'] and '数字人' not in f['kinds']:
            ok('「这一档要做成什么片」那一排里没有口播那两档了：%s' % ' / '.join(f['kinds']))
        else:
            bad('成片形式那一排还留着口播的档：%s' % f.get('kinds'))

    lg = r.get('legacy') or {}
    if lg.get('err'):
        bad('旧档那一篇没造出来：%s' % lg)
    elif '还差选出口' in str(lg.get('tip')) and lg.get('to') == 'write':
        ok('旧档案里存过撤掉那两档的：认不出来就当没选，指回选出口（「%s」）' % lg.get('lab'))
    else:
        bad('旧档兼容不对：%s' % lg)
    nogo = r.get('noGate') or {}
    if nogo.get('err'):
        bad('出口空着那一篇没造出来：%s' % nogo)
    elif nogo.get('voice') and '还差选出口' in str(nogo.get('tip')) and nogo.get('to') == 'write':
        ok('稿子落了档、出口那一格空着：档案那一行「%s」—— %s' % (nogo.get('lab'), str(nogo.get('tip'))[:34]))
    else:
        bad('出口空着的指路不对：%s' % nogo)


if __name__ == '__main__':
    main()
