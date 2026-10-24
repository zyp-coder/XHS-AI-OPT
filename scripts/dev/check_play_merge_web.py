# 🔥 引流两种出口点检 —— 「🎭 玩法」降级为写稿那一栏（公网那份 web/）。
# 老板定稿（2026-10-19 二次收口）：
#   ① 新建笔记「🔥 引流」那一格摆两张形态卡 🖼 AI 图文／📝 长文，点卡直接建篇进正规工作流（弹层里那两步撤了）；
#   ② 玩法不是进门第一道闸：写稿第一屏顶上那一栏「这一篇用哪一招」，点一下才钉上，不挑也行；
#     挑到讲故事那几招才先让 AI 编 3 段你挑一段（🔒 骨架段照旧 AI 不碰）；
#   ③ 原「挑稿」那站改叫「📄 出几版（换写法挑）」，跟「玩法」彻底两个叫法；
#   ④ 顶上导航条一条贯穿，建篇后不换长相；玩法池弹窗只管这本账（钉招／停用／候补／让 AI 补），不再定出口。
# 桩：aiGenerateDrainVariants / genIpStories / genIpDraft / reviseNote / genNoteLongform 五支在页内接住，不烧服务器 Key。
# 本机：node 起一台只用临时账本的服务器（DEMO_DATA_DIR 指 tmp/，绝不碰 server/data/）。
# 用法：python3 -X utf8 scripts/dev/check_play_merge_web.py
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
PORT = 8904
BASE = 'http://127.0.0.1:%d' % PORT
DATA = REPO / 'tmp' / 'play-merge-check' / 'data'
SHOT = REPO / 'tmp' / 'play-merge-check'
fails = 0


def ok(msg):
    print('  PASS ' + msg, flush=True)


def bad(msg):
    global fails
    fails += 1
    print('  FAIL ' + msg, flush=True)


# 料池那几版（桩回 2 版，够点「就用这篇」）
DRAIN_VARIANTS = [
    {'cat': '热点', 'title': '今天业主问的第一句', 'line': '转折落到我这行', 'body': '前三句讲料，最后一句落到我这行。', 'tags': ['装修']},
    {'cat': '热梗', 'title': '全网都在说的那句', 'line': '换个角度写', 'body': '这一版角度不一样。', 'tags': ['贴砖']},
]
STORY_ITEMS = [
    {'t': '第一段：赶工期的那晚', 'first': '那天晚上十点还在贴砖，业主递过来一瓶水。', 'title': '晚上十点那瓶水', 'alts': ['备选一', '备选二']},
    {'t': '第二段：验收挑出空鼓', 'first': '验收那天他挑出三块空鼓，我第二天回来敲了重贴。', 'title': '三块空鼓', 'alts': []},
    {'t': '第三段：料到了人没到', 'first': '料早上七点到，工人八点才到，我在门口等着。', 'title': '等料的那八分钟', 'alts': []},
]
DRAFT_TEXT = '这单一平方报 88。\n砖是我自己挑的三种，你摸得到差别。\n做完当天能走，胶水选的是低味的。'
REVISED_TEXT = '这单的价钱我先按最贵的算给你听。\n砖我挑了三种摆在一起，差别一眼看得出来。'

STUB_JS = r'''(cfg) => {
  const R = { story: [], draft: [], revise: [], drain: [], longform: [] };
  window.__pm = R;
  const old = chrome.runtime.sendMessage;
  chrome.runtime.sendMessage = function (msg, cb) {
    const a = (msg && msg.action) || '';
    if (a !== 'genIpStories' && a !== 'genIpDraft' && a !== 'reviseNote' && a !== 'aiGenerateDrainVariants' && a !== 'genNoteLongform')
      return old.call(chrome.runtime, msg, cb);
    if (a === 'genIpStories') R.story.push(JSON.parse(JSON.stringify(msg.data || {})));
    if (a === 'genIpDraft') R.draft.push(JSON.parse(JSON.stringify(msg.data || {})));
    if (a === 'reviseNote') R.revise.push(JSON.parse(JSON.stringify(msg.data || {})));
    if (a === 'aiGenerateDrainVariants') R.drain.push(JSON.parse(JSON.stringify(msg || {})));
    if (a === 'genNoteLongform') R.longform.push(JSON.parse(JSON.stringify(msg.data || {})));
    const p = Promise.resolve((async () => {
      if (a === 'genIpStories') return { ok: true, items: cfg.items.map(x => Object.assign({}, x)) };
      if (a === 'genIpDraft') return { ok: true, content: cfg.draft, titles: ['这一单一平方报 88'], tags: ['装修', '贴砖'] };
      if (a === 'aiGenerateDrainVariants') return { ok: true, variants: cfg.variants.map(x => Object.assign({}, x)) };
      if (a === 'genNoteLongform') return { ok: true, script: '（桩回的长文稿）\n第一段。\n\n第二段。' };
      return { ok: true, content: cfg.revised, titles: [], tags: [] };   // reviseNote：把骨架句改没了，看守卫
    })());
    return cb ? (p.then(cb), undefined) : p;
  };
  return true;
}'''

FLOW = r'''async (cfg) => {
  const miss = [];
  ['npDirOpen', 'npDirPageHtml', 'npDirPick', 'npDirNewNote', 'npDStations', 'npIStations',
   'npIsDStory', 'npIsD', 'npIsI', 'npPlaySkeleton', 'npPlayRows', 'npPlayStateRead',
   'npIpStoryHtml', 'npIpStoriesLoad', 'npIpBuildDraft', 'npIpLockSetOf', 'npIpKeepGuard',
   'npPlayPickHtml', 'npPlayPickLoad', 'npPkPick', 'npPkClear', 'npPwOpen', 'npPwPickPlay', 'npPwCreate',
   'npArDirCell', 'npArFindById', 'npArchiveSave', 'npNotesAll', 'switchMainTab', 'npWizRender', 'npGo']
    .forEach(k => { if (typeof window[k] !== 'function') miss.push(k); });
  if (typeof NP_PLAY_TALE_SRC === 'undefined') miss.push('NP_PLAY_TALE_SRC');
  ['npPwStepsHtml', 'npPwPane2Html', 'NP_PLAY_OUT_CARD'].forEach(k => {
    if (typeof window[k] !== 'undefined') miss.push('还留着 ' + k); });
  if (miss.length) return { err: '页面上 ' + miss.join(' / ') };
  const r = {};
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const txt = (e) => String((e && (e.textContent || e.value)) || '').trim();
  const sleep = (ms) => new Promise(s => setTimeout(s, ms || 300));
  const box = () => document.getElementById('dirBox');
  const nc = () => document.getElementById('notePublishContent');
  const busy = async () => { const t0 = Date.now();
    while ((typeof _npIpStoryBusy !== 'undefined' && _npIpStoryBusy) || (typeof _npIpDraftBusy !== 'undefined' && _npIpDraftBusy)
           || (typeof _npReviseBusy !== 'undefined' && _npReviseBusy) || (typeof _npDrainBusy !== 'undefined' && _npDrainBusy))
      { if (Date.now() - t0 > 20000) return 'timeout'; await sleep(150); }
    await sleep(150); return ''; };
  const waitWiz = async () => { const t0 = Date.now(); while (!npS() && Date.now() - t0 < 12000) await sleep(150); await sleep(400); await busy(); };
  const click = async (e, ms) => { if (!e) return false; e.click(); await sleep(ms || 400); await busy(); return true; };
  const stepNames = () => { const w = _npWiz; const sts = (w && npIsI(w)) ? npIStations(w) : (npIsD(w) ? npDStations(w) : []); return sts.map(s => s.t); };
  const direff = (v) => qa('#dirBox [data-direff]').find(e => e.getAttribute('data-direff') === v);
  const pkChip = (nm) => qa('[data-pkplay]').find(e => e.getAttribute('data-pkplay') === nm);
  const srcOf = (nm) => ((npPlaySkeleton(nm) || {}).src) || '';
  const round = async () => { const st = await npPlayStateRead(); return (st && st.cur && st.cur.name) || ''; };

  // ── A. 新建弹层：引流那一格只剩两张形态卡，弹层里没有玩法池、没有第 1／2 步 ──
  switchMainTab('noteArchive'); await sleep(700);
  npDirOpen(); await sleep(500);
  r.modal = {
    rows: qa('#dirBox .np-dir-row').length,
    sides: qa('#dirBox .np-dir-side b').map(txt),
    dCards: qa('#dirBox [data-direff^="d|"]').map(e => e.getAttribute('data-direff')),
    dTitles: qa('#dirBox [data-direff^="d|"] b').map(txt),
    pwCards: qa('#dirBox [data-pwplay]').length,
    steps: qa('#dirBox .np-pw-steps').length,
    footer: /玩法不再单独一档——它并进了「🔥 引流」：点引流那一格的卡建好篇/.test(txt(box())),
    grid: (qa('#dirBox .np-dir-row')[2] || {}).style ? /grid/.test(qa('#dirBox .np-dir-row')[2].children[1].getAttribute('style') || '') : false,
  };

  // ── B. 点「🖼 AI 图文」＝当场建篇进正规工作流：第一屏顶上那栏是「这一篇用哪一招」 ──
  await click(direff('d|图文'), 900);
  await waitWiz();
  const nImg0 = await npArFindById(_npWiz.arId);
  r.img = { dir: _npWiz.dir, dOut: _npWiz.dOut, form: (nImg0 || {}).form, play: _npWiz.ipPlay, step: _npWiz.step,
            stations: stepNames(), id: _npWiz.arId,
            boxHtml: !!q('#npPkBox'), chips: qa('[data-pkplay]').map(txt), allBtn: txt(q('.np-pk-all')),
            pickLine: /🎭 这一篇用哪一招/.test(txt(nc())),
            noGate: /不挑也行/.test(txt(nc())),
            versions: qa('.np-drain-pick').length, asked: (window.__pm.drain || []).length,
            stationName: stepNames()[0] };
  await sleep(700);
  r.img.chipsAfter = qa('[data-pkplay]').map(txt);

  // ── C. 干货型招式（点一下才钉）：留在「📄 出几版」这站，本轮账跟着改钉 ──
  const howtoName = r.img.chipsAfter.find(nm => srcOf(nm) === 'howto') || r.img.chipsAfter[0];
  await click(pkChip(howtoName), 700);
  r.howto = { picked: howtoName, src: srcOf(howtoName), play: _npWiz.ipPlay, step: _npWiz.step,
              isStory: npIsDStory(_npWiz), stations: stepNames(), round: await round(),
              pinned: /🎭 这一篇用哪一招/.test(txt(nc())) && txt(nc()).indexOf(howtoName) >= 0,
              dryHint: /这一招是干货型/.test(txt(nc())),
              clearBtn: !!q('.np-pk-clear'), swapBtn: !!q('.np-pw-replay') ? 'old-replay-still-there' : !!q('.np-pk-swap'),
              versions: qa('.np-drain-pick').length };

  // ── D. 「✕ 不指定」：回「不挑也行」那一栏，本轮钉的招不动 ──
  await click(q('.np-pk-clear'), 700);
  r.cleared = { play: _npWiz.ipPlay, step: _npWiz.step, boxBack: !!q('#npPkBox'), round: await round() };

  // ── E. 「▾ 全部玩法池」→ 弹窗只管这本账（没有第 2 步、点一招就钉） ──
  await click(q('.np-pk-all'), 900);
  r.pool = { open: !!q('#dirModal.open'), h3: txt(q('#dirBox h3')),
             steps: qa('#dirBox .np-pw-steps').length, outs: qa('#dirBox [data-pwout]').length,
             cards: qa('#dirBox [data-pwplay]').length, tabs: qa('#dirBox [data-pwtab]').length,
             ai: txt(q('#dirBox .np-pw-ai')), close: txt(q('#dirBox .np-dir-close')) };
  // 弹窗里点讲故事那招（工地连续剧）：钉上→弹窗关→这一篇跳去「AI 编故事」
  await click(q('#dirBox .np-pw-all'), 500);
  r.pool.all = qa('#dirBox [data-pwplay]').length;
  await click(q('#dirBox [data-pwplay="工地连续剧"]'), 1200);
  await busy();
  r.story = { modalClosed: !q('#dirModal.open'), play: _npWiz.ipPlay, step: _npWiz.step,
              isStory: npIsDStory(_npWiz), stations: stepNames(), round: await round(),
              cards: qa('.np-ip-pick').length, asked: (window.__pm.story || []).length,
              method: ((window.__pm.story || [])[0] || {}).method,
              pickRowOnStory: /🎭 这一篇用哪一招/.test(txt(nc())),
              storyHint: /这一招要讲故事/.test(txt(nc())),
              id: _npWiz.arId };
  // ── F. 故事篇的稿子＋🔒 骨架段：挑第二段出整篇，AI 改整篇不碰骨架句 ──
  const p2 = qa('.np-ip-pick')[1];
  await click(p2, 1400); await busy();
  r.storyDraft = { step: _npWiz.step, idx: _npWiz.ipStoryIdx, draft: String((_npWiz.draft || {}).content || '').slice(0, 16),
                   asked: (window.__pm.draft || []).length,
                   second: cfg.storySecond === (((window.__pm.draft || [])[0] || {}).story || {}).first,
                   exitLong: /出口 📝 长文|出口 🖼 图文/.test(txt(nc())),
                   stations: stepNames() };
  await npArchiveSave(_npWiz); await sleep(600);

  // ── G. 📝 长文那张卡建篇：站点是 出几版 → 改稿 → 收长文发布 ──
  switchMainTab('noteArchive'); await sleep(600);
  npDirOpen(); await sleep(500);
  await click(direff('d|长文'), 900);
  await waitWiz();
  const nLong0 = await npArFindById(_npWiz.arId);
  r.long = { dir: _npWiz.dir, dOut: _npWiz.dOut, form: (nLong0 || {}).form, play: _npWiz.ipPlay, step: _npWiz.step,
             stations: stepNames(), box: !!q('#npPkBox'), id: _npWiz.arId };

  // ── H. 带骨架段的招式（猜价猜量）＋AI 改整篇的骨架守卫 ──
  const lkName = '猜价猜量';
  await npPkPick(lkName, nc()); await sleep(900); await busy();
  r.lock = { isStory: npIsDStory(_npWiz), step: _npWiz.step, stations: stepNames(),
             cards: qa('.np-ip-pick').length, id: _npWiz.arId };
  await click(q('.np-ip-pick'), 1400); await busy();
  const lockSet = npIpLockSetOf(_npWiz);
  r.lock.afterDraft = { step: _npWiz.step, lock: lockSet ? [...lockSet] : null,
                        lockRows: qa('.np-ip-lock').map(txt), sentRows: qa('.np-sent-row').length };
  const rv = document.querySelector('.np-rv-ask') || document.getElementById('npReviseAsk');
  if (rv) { rv.value = '说得再直白一点'; rv.dispatchEvent(new Event('input', { bubbles: true })); }
  await click(q('.np-rv-go'), 1600); await busy();
  r.lock.revised = { asked: (window.__pm.revise || []).length, keep: ((window.__pm.revise || [])[0] || {}).keepSents,
                     play: ((window.__pm.revise || [])[0] || {}).ipPlay,
                     firstBack: String((_npWiz.draft || {}).content || '').indexOf('88') >= 0,
                     lockRows: qa('.np-ip-lock').length };

  // ── I. 档案横幅那两颗：🔁 换个玩法（弹窗钉招，不建篇）· 📤 照这招再发一篇（按默认出口建篇） ──
  const beforeN = (await npNotesAll()).length;
  switchMainTab('noteArchive'); await sleep(700);
  npPwOpen('swap'); await sleep(900);
  r.swap = { h3: txt(q('#dirBox h3')), cards: qa('#dirBox [data-pwplay]').length, outs: qa('#dirBox [data-pwout]').length };
  await click(q('#dirBox [data-pwplay="清单拆给人看"]') || qa('#dirBox [data-pwplay]')[0], 900);
  const swapName = _npPw ? _npPw.play : '';
  r.swap.after = { closed: !q('#dirModal.open'), round: await round(), notes: (await npNotesAll()).length, before: beforeN };

  // ── J. 老 IP 篇（dir='i'）不迁数据：档案行认得、点「下一步」还是那五站 ──
  const oldI = await npDirNewNote('i', '', '', { play: '出题纠错' });
  const oi = await npArFindById(oldI.id);
  r.oldI = { cell: npArDirCell(oi).replace(/<[^>]+>/g, '') };
  switchMainTab('notePublish', oi); await sleep(900); await busy();
  r.oldI2 = { isI: npIsI(_npWiz), isD: npIsD(_npWiz), step: _npWiz.step, stations: stepNames(),
              cards: qa('.np-ip-use').length, pickRow: /🎭 这一篇用哪一招/.test(txt(nc())) };

  // ── K. 📝 长文两条线的调性分开：面板顶上那行各说各的，送后台那一发带上是哪条线 ──
  r.head = { d: _npLongHeadHtml({ dOut: 'long' }).replace(/<[^>]+>/g, ''),
             k: _npLongHeadHtml({ kOut: 'text' }).replace(/<[^>]+>/g, '') };
  const lgNote = await npArFindById(r.long.id);            // 「📝 长文」那张卡建的篇：补一份成稿才铺得出长文面板
  switchMainTab('notePublish', lgNote); await sleep(1000); await busy();
  _npWiz.draft = { content: '这单一平方报 88。\n砖是我自己挑的三种，你摸得到差别。', titles: [], tags: [] };
  _npWiz.step = 5;                                     // 📝 10-21 改版：长文不再是改稿页底下的面板，自成一屏（⑤ 出长文）
  npWizRender(nc()); await sleep(700);
  r.longSend = { onDraft: _npWiz.step === 5 && _npWiz.dOut === 'long',
                 head: txt(q('#npWizBody')).slice(0, 120), genBtn: qa('.np-long-gen').length,
                 dbg: { play: _npWiz.ipPlay, story: npIsDStory(_npWiz) } };
  await click(q('.np-long-gen'), 1600); await busy();
  const ls = (window.__pm.longform || [])[0] || {};
  r.longSend.asked = (window.__pm.longform || []).length;
  r.longSend.line = ls.line; r.longSend.hasContent = String(ls.content || '').length > 4;
  r.longSend.got = String(_npWiz.longform || '').slice(0, 8);
  await npArchiveSave(_npWiz);

  // ── K2. 钉了讲故事那招的引流·长文篇：⑤ 出长文那一屏照样铺得出（补漏） ──
  const stLong = await npDirNewNote('d', '长文', '', { play: '工地连续剧' });
  switchMainTab('notePublish', await npArFindById(stLong.id)); await sleep(1000); await busy();
  _npWiz.draft = { content: '那天晚上十点还在贴砖，业主递过来一瓶水。\n砖是我自己挑的三种。', titles: [], tags: [] };
  _npWiz.step = 5;                                     // 📝 同上：长文自成一屏
  npWizRender(nc()); await sleep(700);
  r.storyLong = { story: npIsDStory(_npWiz), dOut: _npWiz.dOut, hasBox: !!q('#npWizBody'),
                  head: txt(q('#npWizBody')).slice(0, 120), genBtn: qa('.np-long-gen').length };
  await click(q('.np-long-gen'), 1600); await busy();
  r.storyLong.line = ((window.__pm.longform || [])[1] || {}).line;

  r.ids = { img: r.img.id, story: r.story.id, long: r.long.id, lock: r.lock.id, oldI: oldI.id };
  r.names = { howto: r.howto.picked };
  return r;
}'''


def snap(page, name):
    try:
        page.screenshot(path=str(SHOT / name))
    except Exception as e:
        print('  （照片没拍成 %s：%s）' % (name, e), flush=True)


def main():
    print('── 🔥 引流两种出口＋玩法降级为写稿一栏（公网那份）──', flush=True)
    import shutil
    if DATA.exists():
        shutil.rmtree(DATA)
    DATA.mkdir(parents=True, exist_ok=True)
    SHOT.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env['DEMO_DATA_DIR'] = str(DATA)
    env['PORT'] = str(PORT)
    env['DEMO_AI_KEY'] = 'check-only'
    env['DEMO_AI_BASE'] = 'http://127.0.0.1:1/v1'
    env['DEMO_SIGNUP_MAX'] = '60'
    logf = open(REPO / 'tmp' / 'play-merge-check.server.log', 'w', encoding='utf-8')
    srv = subprocess.Popen(['node', str(REPO / 'server' / 'dev-server.mjs')], env=env, stdout=logf, stderr=subprocess.STDOUT)
    for _ in range(80):
        try:
            socket.create_connection(('127.0.0.1', PORT), 1).close()
            break
        except OSError:
            time.sleep(0.5)
    else:
        bad('服务器没起来（看 tmp/play-merge-check.server.log）')
        return
    time.sleep(2)
    try:
        with sync_playwright() as p:
            br = p.chromium.launch(channel='msedge', headless=True)
            page = br.new_context(viewport={'width': 1500, 'height': 950}).new_page()
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            page.goto(BASE + '/start.html', wait_until='domcontentloaded', timeout=90000)
            page.wait_for_timeout(2500)
            who = page.evaluate('''async (a) => await (await fetch('/api/auth/demo', { method: 'POST',
                headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: a.key }) })).json()''',
                {'key': 'deco'})
            if not who.get('ok'):
                bad('演示号没进上：%r' % (who,))
                br.close()
                return
            goto_big(page, BASE + '/popup.html?mode=big', wait_until='domcontentloaded', timeout=90000)
            page.wait_for_timeout(5000)
            page.evaluate(STUB_JS, {'items': STORY_ITEMS, 'draft': DRAFT_TEXT, 'revised': REVISED_TEXT,
                                    'variants': DRAIN_VARIANTS})
            r = page.evaluate(FLOW, {'storySecond': STORY_ITEMS[1]['first']})
            if isinstance(r, dict) and r.get('err'):
                bad(r['err'])
                br.close()
                return
            snap(page, '01-故事篇-AI编故事带那一栏.png')
            page.evaluate('''() => { switchMainTab('noteArchive'); }''')
            page.wait_for_timeout(900)
            page.evaluate('''() => { npDirOpen(); }''')
            page.wait_for_timeout(600)
            snap(page, '02-新建弹层引流两张卡.png')
            page.evaluate('''() => { npPwOpen('inpage'); }''')
            page.wait_for_timeout(1000)
            snap(page, '03-玩法池这本账.png')
            page.evaluate('''async (id) => { switchMainTab('notePublish', await npArFindById(id)); }''', r['ids']['img'])
            page.wait_for_timeout(1400)
            snap(page, '04-图文篇-出几版顶上那一栏.png')
            page.evaluate('''async (id) => { switchMainTab('notePublish', await npArFindById(id)); }''', r['ids']['long'])
            page.wait_for_timeout(1400)
            snap(page, '05-长文篇-三站一条贯穿.png')
            br.close()
        if errs:
            bad('页面报错 %d 条：%s' % (len(errs), errs[0][:200]))

        m = r['modal']
        if m['rows'] == 4 and m['sides'] == ['🪟 门面', '📚 知识', '🔥 引流', '🎬 案例'] \
                and m['dCards'] == ['d|图文', 'd|长文'] and m['pwCards'] == 0 and m['steps'] == 0:
            ok('新建弹层：引流那一格只剩两张形态卡 🖼 AI 图文／📝 长文——弹层里那两步（挑招式／定出口）撤了 %r' % (m['dTitles'],))
        else:
            bad('弹层引流那一格不对：%s' % m)
        if m['footer'] and m['grid']:
            ok('弹层底下一句改口成「点引流那一格的卡建好篇，写稿那一屏顶上挑招式」；那一行是等宽网格，卡片不会掉成整条孤儿')
        else:
            bad('弹层文案或网格没改口：%s' % m)

        im = r['img']
        if im['dir'] == 'd' and im['dOut'] == 'img' and im['form'] == '图文' and not im['play'] and im['stations'][0] == '📄 出几版':
            ok('点「🖼 AI 图文」当场建篇进正规工作流：dir=d／出口 img／没钉招式，第一站叫「📄 出几版」（不再是「挑稿」）：%r' % (im['stations'],))
        else:
            bad('图文卡建篇不对：%s' % im)
        if im['pickLine'] and im['noGate'] and im['boxHtml'] and len(im['chipsAfter']) > 0 and im['allBtn'].startswith('▾ 全部玩法池'):
            ok('写稿第一屏顶上那一栏「🎭 这一篇用哪一招」摊了 %d 招，写明「不挑也行」，右边「▾ 全部玩法池」进这本账' % len(im['chipsAfter']))
        else:
            bad('那一栏没摆出来：%s' % im)
        if im['versions'] >= 1 and im['asked'] >= 1:
            ok('同一屏底下就是料池那几版（点了才进改稿）——出几版与挑招式在同一页，不换长相')
        else:
            bad('料池那几版没出来：%s' % im)

        h = r['howto']
        if h['play'] == h['picked'] and h['step'] == 3 and not h['isStory'] and h['stations'][0] == '📄 出几版' \
                and h['round'] == h['picked']:
            ok('干货型招式（%s）点一下就钉：留在「出几版」这站、没绕编故事，本轮这本账也跟着改钉它' % h['picked'])
        else:
            bad('干货招式钉上后不对：%s' % h)
        if h['pinned'] and h['dryHint'] and h['clearBtn'] and h['swapBtn'] and h['versions'] >= 1:
            ok('钉上之后那一栏换成「🎭 招式名 ＋ 🔁 换一招 ＋ ✕ 不指定」，底下说明写清这招是干货型，几版稿没被打掉')
        else:
            bad('钉上后那一栏不对：%s' % h)

        c = r['cleared']
        if c['play'] == '' and c['step'] == 3 and c['boxBack']:
            ok('「✕ 不指定」把这一篇退回不钉招式（回「不挑也行」那一栏，本轮钉的招不动，账还在）')
        else:
            bad('不指定没退干净：%s' % c)

        pl = r['pool']
        if pl['open'] and pl['steps'] == 0 and pl['outs'] == 0 and pl['cards'] > 0 and pl['tabs'] == 3 \
                and '✕ 回去，这一篇不指定' in pl['close']:
            ok('「▾ 全部玩法池」弹窗只管这本账：没有第 1／2 步那条、没有出口卡，只有 在池／候补／停用 三签（在池摊开 %d 招）' % pl['all'])
        else:
            bad('玩法池弹窗不对：%s' % pl)

        s = r['story']
        if s['modalClosed'] and s['play'] == '工地连续剧' and s['step'] == 1 and s['isStory'] \
                and s['stations'][0] == 'AI 编故事' and '🖋 分镜确认' in s['stations'] and s['round'] == '工地连续剧':
            ok('弹窗里点讲故事那招＝钉上就关：这一篇跳去「AI 编故事」，导航条跟着换成这一条（「出几版」那站撤了）：%r' % (s['stations'],))
        else:
            bad('故事招式没接上：%s' % s)
        if s['cards'] == 3 and s['asked'] == 1 and s['method'] == '工地连续剧' and s['pickRowOnStory'] and s['storyHint']:
            ok('编故事这一屏顶上仍挂着那一栏（换招不跑路），自动发一「编 3 段」回来 3 段卡')
        else:
            bad('编故事那屏不对：%s' % s)

        sd = r['storyDraft']
        if sd['step'] == 4 and sd['idx'] == 1 and sd['draft'] and sd['asked'] == 1 and sd['second']:
            ok('挑中第二段＝当场出整篇、落「改稿」这一站；送出去的是那一段的开头第一句')
        else:
            bad('挑段落稿不对：%s' % sd)

        lg = r['long']
        if lg['dir'] == 'd' and lg['dOut'] == 'long' and lg['form'] == '长文' \
                and lg['stations'] == ['📄 出几版', '改稿', '📝 出长文', '👀 预览', '✓ 存好回档案'] and lg['box']:
            ok('点「📝 长文」建的那篇走引流那条：出几版 → 改稿 → 出长文 → 预览 → 存好回档案（10-21 长文自成一屏），顶上同样是那一栏：%r' % (lg['stations'],))
        else:
            bad('长文卡建篇不对：%s' % lg)

        lk = r['lock']
        if lk['isStory'] and lk['step'] == 1 and lk['cards'] == 3:
            ok('带骨架段的招式（猜价猜量：题目／数字是骨架）照样先 AI 编 3 段你挑一段')
        else:
            bad('带骨架段招式没接上故事路：%s' % lk)
        if lk['afterDraft']['lock'] == [0] and len(lk['afterDraft']['lockRows']) == 1 and lk['afterDraft']['sentRows'] >= 1:
            ok('🔒 骨架句保留：AI 出的稿第一句标成骨架段，其余句子照常可点（%d 句可点）' % lk['afterDraft']['sentRows'])
        else:
            bad('骨架段标记不对：%s' % lk['afterDraft'])
        rv = lk['revised']
        if rv['asked'] == 1 and rv['keep'] and '88' in rv['keep'][0] and rv['play'] == '猜价猜量' and rv['firstBack']:
            ok('AI 改整篇：骨架原句当 keepSents 送过去，桩故意改没了→守卫按原句原位补回（那句「报 88」还在）')
        else:
            bad('改整篇的骨架守卫不对：%s' % rv)

        sw = r['swap']
        if '换个玩法接上' in sw['h3'] and sw['outs'] == 0 and sw['after']['closed'] and sw['after']['notes'] == sw['after']['before']:
            ok('档案横幅「🔁 换个玩法」＝只钉本轮这一招（%s），关窗回档案、没多建篇：%s' % (sw['after']['round'], sw['after']))
        else:
            bad('横幅换玩法不对：%s' % sw)

        oc = r['oldI']
        if '🎭 出题纠错' in oc['cell']:
            ok('老 IP 篇（dir=i）档案行照旧认：带招式的显示「🎭 招式名」，一点数据没迁')
        else:
            bad('老 IP 篇档案行不对：%s' % oc)
        oi = r['oldI2']
        if oi['isI'] and not oi['isD'] and '挑组合' in oi['stations'] and oi['cards'] and not oi['pickRow']:
            ok('老 IP 篇点的还是它自己那五站（挑组合→AI 编故事→改稿→出料→发布），没被挪走，也不摆引流那一栏：%r' % (oi['stations'],))
        else:
            bad('老 IP 篇五站不对：%s' % oi)

        hd = r['head']
        if '拿你这行的身份说' in hd['d'] and '科普口吻' not in hd['d'] and '科普口吻' in hd['k']:
            ok('📝 出长文那一屏顶上那行两条线分开：引流＝「拿你这行的身份说、开头先把人钉住」，知识＝照旧「科普口吻、分小标题段」')
        else:
            bad('长文那一行没分开：%s' % hd)
        ls = r['longSend']
        if ls['onDraft'] and ls['genBtn'] and '拿你这行的身份说' in ls['head']:
            ok('引流·长文这篇进的就是「⑤ 出长文」那一屏（改稿之后自成一屏，10-21 改版），那颗大钮真的在台上）：%r' % ls['head'])
        else:
            bad('引流长文那一屏不对：%s' % ls)
        if ls['asked'] == 1 and ls['line'] == 'd' and ls['hasContent'] and ls['got']:
            ok('点「✨ 出长文」送后台那一发带了 line=d（后台照这条换引流的腔与条数）；稿子回写到这一篇')
        else:
            bad('出长文那一发不对：%s' % ls)
        sl = r['storyLong']
        if sl['story'] and sl['dOut'] == 'long' and sl['hasBox'] and '拿你这行的身份说' in sl['head'] and sl['genBtn'] == 1:
            ok('补漏生效：钉了讲故事那招的引流·长文篇，「⑤ 出长文」那一屏照样铺得出来（那颗「✨ 出长文」只一颗）')
        else:
            bad('故事型招式的长文篇没铺出那一屏：%s' % sl)
        if sl['line'] == 'd':
            ok('这一篇点「✨ 出长文」送后台也是 line=d（两条腔不会因为走了故事版式而串回科普）')
        else:
            bad('故事型长文篇送出去的线不对：%s' % sl)
    finally:
        srv.terminate()
        logf.close()
    print('── 结果：%s ──' % ('全过' if not fails else '%d 条没过' % fails), flush=True)
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
