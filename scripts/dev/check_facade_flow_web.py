# 🪟 门面笔记批 2 点检 —— 门面这条流（公网那份 web/）。
# 2026-10-20 老板两笔：出稿与改稿拆两站；改稿站五种预置版式（A 对比型＝老板精调样板、默认），底料加第七问（同行做法）。
# 2026-10-20 第二笔：改稿站照知识线那套补齐——蓝框（常用改法＋说一句改整篇＋↩ 改回上一版）、标题一条、逐句「比一比再定」、✍️ 全文手改；承接篇也加改稿站。
# 2026-10-20 第三笔（老板：「版式都差不多」＋「别再分段1段2」）：介绍篇改成「版式主导整篇」——提纲六件事只当「要讲全」的清单，段序跟着版式走。
# 2026-10-20 第四笔（老板：「出这一版的作用是挑稿」「配图那站不要了，换封面&字幕」）——需求档案 资料/发笔记-门面挑稿封面字幕设计.md：
#                    站② 「挑稿」＝挑版式：五张卡摆这一站，点一张出一版，出过的几版并排比一比，点中一版才进③；
#                    站③ 「改稿」不再摆版式卡，只抠句子；介绍篇「段」这个概念撤干净（一句一条、提词卡一句一屏）；
#                    站⑤ 「配图」换成「封面&字幕」：拖进度条取帧／🎲 随机 5 帧 → 选一帧 → 三套版式＋标题一行 → 定这张当封面
#                         （本体进 cover:<篇id>，档案只留名字＋缩略图）；字幕系统不猜，两颗钮自己定（➕ 加＝排云端那一道／不用加＝不拦路）；
#                    工单出口默认跳过这一站。承接篇：挑稿（📄 照提纲出稿／↻ 再出一版）→ 改稿（无版式栏）→ 👀 预览 → 收口置顶。
# 需求档案：第四轮 资料/发笔记-门面挑稿封面字幕设计.md（这一支对着它验收）｜上一轮 资料/发笔记-门面笔记设计.md
# 这一支只看批 2：站序、挑稿几版并排、改稿摊平、出口三档、封面取帧、字幕四态、收口与存回档案。
# 出稿与改那一句走的两个后台动作（genFacadeNote / genFacadeSentence）在批 3，这里把出口拨到桩上只看前端这条流；
# 字幕走云端那一道（/api/lip/sub、/api/lip/status、/api/lip/sub_revert）也全拨在桩上，不起云端 ffmpeg。
# 本机：node 起一台只用临时账本的服务器（DEMO_DATA_DIR 指 tmp/，绝不碰 server/data/）。取帧用的三条秒小片由 ffmpeg 现造，造不出就报错退出。
# 用法：python3 -X utf8 scripts/dev/check_facade_flow_web.py
import os
import sys
import time
import base64
import socket
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
from _guide_gate import goto_big

sys.stdout.reconfigure(encoding='utf-8')
REPO = Path(__file__).resolve().parents[2]
PORT = 8903
BASE = 'http://127.0.0.1:%d' % PORT
DATA = REPO / 'tmp' / 'facade-flow-check' / 'data'
SHOT = REPO / 'tmp' / 'facade-flow-check'
FILM = SHOT / 'film3s.webm'
fails = 0


def ok(msg):
    print('  PASS ' + msg, flush=True)


def bad(msg):
    global fails
    fails += 1
    print('  FAIL ' + msg, flush=True)


# 桩给介绍篇回的第一版（对比型那版）＝版式自己分的自然段拆到界面上就是一句一条（8 句）
INTRO_D = [
    '很多店你一进门他先问你预算，我不这么干。',
    '我在这个城市守店，一天到晚跟料打交道。',
    '早上八点进场，量、放线、贴完一样一样验收。',
    '空鼓起翘我能说清是料的事还是手艺的事。',
    '量太小、离太远的活，我当面说接不了。',
    '这个城市做过几百户，验收单都留着。',
    '要问自家怎么办，主页简介里有介绍，直接私信我。',
    '各家情况不一样，我先听你说完。',
]
# 第二版（换一种版式那一版，句子更少）——只用来断言「几版并排、点中一版」
INTRO_B = [
    '老有人问我那几件事，一次说清。',
    '按平方还是按项算，出了图再分开报，口头价我不报。',
    '出了问题找我，到店当面说，该换该补讲清楚。',
    '小店接不接，能弄好就接。',
    '还想问什么，私信先说说你家情况。',
]
# 第三版（同一张卡再点一次＝同版式换一版）：第一句换了话，剩下一句不动
REDO = ['整篇重出的第一句——桩师傅在这个城市守店。'] + INTRO_D[1:]
# 改稿站蓝框那句评价回来的那一版（只换台上这一稿，不进挑稿那一摞）
ASKED = ['按你说的那句重排了——先看活再谈价。'] + INTRO_D[1:]
# 承接篇：钉死的五段，一段一串（段序与段数由提纲定）
DEAL_SEGS = [
    ['来问价之前先看这篇，你关心的事都在这儿。'],
    ['问：一平方多少钱？答：我先问清多少平、用什么料再报数。', '问：要不要定金？答：定下来交三成料钱，验收完收尾款。',
     '问：料谁买？答：都能。', '问：多久干完？答：一处正常两天。'],
    ['价钱按面积算，拆旧、找平这几样分开报。'],
    ['两种活我不接：房没交就把我叫去的，别人做了一半让我收尾的。'],
    ['要问自家的事，走主页简介，私信我。各家情况不一样，这里说的只作参考。'],
]
DEAL_REDO = [row[:] for row in DEAL_SEGS]
DEAL_REDO[0] = ['承接篇重出的第一段——你关心的事都在这儿。']

STUB_JS = r'''(cfg) => {
  const R = { sent: [], film: [], out: [], lip: [] };
  window.__fac = R;
  window.__facCfg = cfg;
  cfg.introN = 0; cfg.dealN = 0;
  const old = chrome.runtime.sendMessage;
  window.__facOld = old;
  chrome.runtime.sendMessage = function (msg, cb) {
    const a = (msg && msg.action) || '';
    if (a !== 'genFacadeNote' && a !== 'genFacadeSentence') return old.call(chrome.runtime, msg, cb);
    R.sent.push(JSON.parse(JSON.stringify(msg)));
    const p = Promise.resolve((async () => {
      if (cfg.fail) return { ok: false, error: cfg.failErr || '' };
      if (a === 'genFacadeSentence') return { ok: true, text: '（改过的那一句）' + String(msg.sentence || '').slice(0, 12) };
      if (msg.need === 'title') return { ok: true, titleOnly: true, title: '换一条的标题桩' };
      if (msg.kind === 'deal') {
        if (msg.ask) return { ok: true, title: msg.title, segs: cfg.dealRedo };
        const s = cfg.dealN ? cfg.dealRedo : cfg.deal; cfg.dealN++;
        return { ok: true, title: '来问价之前先看这篇', segs: s };
      }
      if (msg.ask) return { ok: true, title: msg.title, segs: cfg.asked };
      const q = [cfg.introD, cfg.introB, cfg.redo];
      const segs = q[Math.min(cfg.introN, q.length - 1)]; cfg.introN++;
      return { ok: true, title: '在这个城市干了这些年，我把自己说明白', segs: segs };
    })());
    return cb ? (p.then(cb), undefined) : p;
  };
  if (typeof window.npOpenFilm === 'function') window.npOpenFilm = function (script, opts) {
    R.film.push({ text: String(script || ''), noteId: (opts && opts.noteId) || '' });
  };
  const sw = window.switchMainTab;
  if (typeof sw === 'function') window.switchMainTab = function (name, arg) { R.out.push(name); return sw.call(this, name, arg); };
  // 字幕那一道的三个云端接口＋取片：全拨在桩上（服务端那一道由 tmp/lip_sub_harness.mjs 真跑验过）
  window.__lipCalls = []; window.__takeCalls = 0; window.__subSt = ''; window.__subSendFail = false;
  const mkJob = (st) => ({ id: 'lip_check0', state: 'delivered', route: 'self', token: 'tkcheck',
    takeUrl: '/api/lip/out/lip_check0?t=tkcheck', segCount: 8, segGot: 8, segLack: 0, hasOut: true,
    outSize: 26848, dueAt: Date.now(), lack: '', subState: st,
    subMsg: st === 'fail' ? '这台机器当时挤不开——料还在、原片一个字没动' : '' });
  window.__lipSeed = mkJob('');
  window.lipApi = function (path, body) {
    window.__lipCalls.push({ path: path, body: JSON.parse(JSON.stringify(body || {})) });
    if (path === '/api/lip/submit' && body && body.route === 'selfup') {
      return Promise.resolve({ ok: true, job: { id: 'lip_up0', state: 'await_mat', route: 'selfup', token: 'tkup' } });
    }
    if (path === '/api/lip/sub') {
      if (window.__subSendFail) return Promise.resolve({ ok: false, error: '云端这一条没接上' });
      return Promise.resolve({ ok: true, job: mkJob('queue') });
    }
    if (path === '/api/lip/sub_revert') return Promise.resolve({ ok: true, job: mkJob('') });
    return Promise.resolve({ ok: true, job: mkJob(window.__subSt) });
  };
  window.lipPatch = function () { return Promise.resolve(); };
  window.lipAsk = function () { return Promise.resolve(window.__lipSeed); };
  window.__takeArgs = [];
  window.npLipTake = function (arId, job, opts) {
    window.__takeCalls++;
    window.__takeArgs.push({ arId: String(arId || ''), keep: !!(opts && opts.keep) });
    return Promise.resolve();
  };
  // 整条片上传那一发：真 XHR 在别的自检里验过，这里只看「传的是哪张单、几个字节」
  window.__putWhole = [];
  window.npGatePutWhole = function (job, blob, onPct) {
    window.__putWhole.push({ id: String((job || {}).id || ''), size: Number((blob || {}).size) || 0 });
    if (typeof onPct === 'function') onPct(100);
    return Promise.resolve({ ok: true });
  };
  return true;
}'''

FLOW = r'''async (A) => {
  const STEPNAMES = A.steps, FILM_B64 = A.film;
  const miss = [];
  ['npOpenFacadeFlow', 'npFacadePaint', 'npFacadeGen', 'npFacadeRevise', 'npFacadeSave', 'npFacadeLand',
   'npFacadeScreens', 'npFacadeText', 'npFacadeMarkPinned', 'npFacadeReuse', 'npFacadeFormOf', 'npFacadeBar',
   'npDirNewNote', 'npNotesAll', 'npArFindById', 'switchMainTab', 'npOpenFilm', 'npArNext', 'npGateNext',
   'npFacSegsToText', 'npFacSegsFromText', 'npFacadeTitleNext', 'npFacadeUndoAll', 'npFacTextApply',
   'npFacadeSentUse', 'npFacadeUseVer', 'npFacadeNext', 'npFacVerSents', 'npFacadeHasCover',
   'npFacCoverLoad', 'npFacCoverFromImage', 'npFacRoll', 'npFacTakeFrame', 'npFacFixCover', 'npFacCv',
   'npFacCvDrop', 'npFacSubAdd', 'npFacSubAsk', 'npFacSubSkip', 'npFacSubUndo', 'npFacSubRevert',
   'npCasePut', 'npCaseGet', 'npCaseDel', 'npCaseProbe'].forEach(k => {
    if (typeof window[k] !== 'function') miss.push(k);
  });
  if (typeof FACADE_RV_CHIPS === 'undefined' || FACADE_RV_CHIPS.length !== 5) miss.push('FACADE_RV_CHIPS');
  if (typeof FACADE_GATES === 'undefined') miss.push('FACADE_GATES');
  if (typeof FACADE_STYLES === 'undefined' || FACADE_STYLES.length !== 5) miss.push('FACADE_STYLES');
  if (typeof COVER_LAYOUTS === 'undefined' || COVER_LAYOUTS.length !== 3) miss.push('COVER_LAYOUTS');
  if (typeof NP_FAC_VERS_MAX === 'undefined') miss.push('NP_FAC_VERS_MAX');
  if (typeof npS !== 'function') miss.push('npS');
  if (miss.length) return { err: '页面里没有 ' + miss.join(' / ') };
  const r = {};
  const nc = document.getElementById('notePublishContent');
  const txt = (sel) => { const e = document.querySelector(sel); return e ? String(e.textContent || '').trim() : ''; };
  const body = () => txt('#npFacBody');
  const barAll = () => [...document.querySelectorAll('#npFacSteps span')]
    .map(x => String(x.textContent || '').trim()).filter(t => t && !/^\d+$/.test(t));
  const barSteps = barAll;
  const seed = (i, v) => { const e = document.querySelectorAll('.npf-seed')[i]; if (!e) return false;
    e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); return true; };
  const sleep = (ms) => new Promise(s => setTimeout(s, ms));
  const one = (sel) => document.querySelector(sel);
  const n = (sel) => document.querySelectorAll(sel).length;
  const navBtn = () => { const b = [...document.querySelectorAll('#npFacNav button')]; return b.length ? b[b.length - 1] : null; };
  const navLabel = () => { const b = navBtn(); return b ? String(b.textContent || '').trim() : ''; };
  const navOff = () => { const b = navBtn(); return !b || !!b.disabled; };
  const ready = async (sel, ms) => { const t0 = Date.now(); while (!one(sel) && Date.now() - t0 < (ms || 9000)) await sleep(120); return !!one(sel); };
  const settle = async () => { const t0 = Date.now(); while (_npFac && _npFac.busy && Date.now() - t0 < 9000) await sleep(120); await sleep(150); };
  const click = async (sel) => { if (!await ready(sel)) return false; one(sel).click(); await sleep(350); await settle(); return true; };
  const lastReq = () => window.__fac.sent[window.__fac.sent.length - 1] || {};
  const sentRows = () => [...document.querySelectorAll('#npFacBody .npf-sent')].map(x => String(x.textContent || '').trim());
  // 取帧那几颗是异步的（一次抓 5 帧要挨个 seek），settle() 只管 _npFac.busy，这里等台上那件片闲下来
  const cvIdle = async (ms) => { const t0 = Date.now();
    while (Date.now() - t0 < (ms || 20000)) { const c = npFacCv(_npFac); if (c && !c.busy) break; await sleep(150); }
    await sleep(200); };
  const vidReady = async (ms) => { const t0 = Date.now();
    while (Date.now() - t0 < (ms || 8000)) { const v = one('#npfFilm'); if (v && v.readyState >= 1) return true; await sleep(120); }
    return false; };
  const versSents = (i) => npFacVerSents(((_npFac.vers || [])[i]) || {}).length;
  const waitUntil = async (fn, ms) => { const t0 = Date.now();
    while (Date.now() - t0 < (ms || 12000)) { let v = false; try { v = !!(fn && fn()); } catch (_) { v = false; }
      if (v) { await sleep(180); return true; } await sleep(150); }
    return false; };
  const filmFile = () => { const b = atob(FILM_B64); const u = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return new File([u], 'film3s.webm', { type: 'video/webm' }); };
  const pickFilm = async (el) => { if (!el) return false;
    const dt = new DataTransfer(); dt.items.add(filmFile());
    el.files = dt.files; el.dispatchEvent(new Event('change', { bubbles: true })); return true; };

  // ── ① 新建弹层那颗卡落进来：走的是门面这条流，不是写稿向导 ──
  const ni = await npDirNewNote('f', '口播稿', 'intro');
  window.switchMainTab('noteFacade', ni);
  await sleep(400);
  r.landIntro = { shell: !!document.getElementById('npFacBody'), mode: _npMode, wizNull: npS() === null,
                  steps: barSteps(), head: txt('#npFacHead'), dots: document.querySelectorAll('#npFacSteps [data-fgo]').length,
                  headNoDesc: !/交付：/.test(txt('#npFacHead')),
                  headTip: (() => { const q = document.querySelector('#npFacHead .qhelp');
                    return q ? String(q.getAttribute('data-tip') || '') : ''; })() };
  r.step1 = { rows: n('.npf-seed'), brought: (body().match(/已带到：/g) || []).length,
              empty: (body().match(/这条空着/g) || []).length, noInvent: /不会替你编数字、编客户/.test(body()),
              nextLabel: navLabel(), noGen: !one('.npf-gen'), styleCards: n('.npf-style'), noCover: !one('.npf-fixcover') };

  // 底料填三格（自动带的那两格不动），前进到 ② 挑稿
  seed(2, '一天到晚在工地上：量、放线、贴完验收');
  seed(5, '这个城市做过几百户，验收单都留着');
  seed(6, '别家爱先报高价再砍，我不这么干');
  await click('.npf-next');
  r.pick0 = { step: _npFac.step, cards: n('.npf-style'),
              defCards: [...document.querySelectorAll('.npf-style')].filter(x => /默认/.test(String(x.textContent || ''))).length,
              onlyLook: /这一站只挑分法、不改句子/.test(body()), hint: /点了立刻出一版，不用另按钮/.test(body()),
              none: /还没出过版/.test(body()), versPill: /0 版/.test(body()), verCur: _npFac.verCur,
              navOff: navOff(), navLabel: navLabel(), noOutBtn: !one('.npf-out'), sents: n('.npf-sent'),
              secs: n('.npf-sec'), secDefault: _npFac.sec, secTarget: /按 207 字左右出稿/.test(body()),
              brief: /先摆同行的做法，再说我不这么干/.test(txt('.npf-style[data-s="duibi"]')),
              noStruct: !/分四到五段/.test(body()),
              maxH: Math.max(...[...document.querySelectorAll('.npf-style')].map(x => x.getBoundingClientRect().height)),
              notPicked: /还没挑/.test(body()) };
  await click('.npf-sec[data-s="60"]');
  r.pickSec60 = { sec: _npFac.sec, target: /按 276 字左右出稿/.test(body()), warn: /上限 250 字/.test(body()) };
  await click('.npf-sec[data-s="45"]');
  r.pickSec60.back = _npFac.sec;

  // 「一单真事」那版要的凭据格（第 6 格）掏空：点卡该拦、指回①，且一发请求都不发
  const keep5 = _npFac.seeds[5]; _npFac.seeds[5] = ''; npFacadePaint(nc); await sleep(150);
  const beforeGuard = window.__fac.sent.length;
  await click('.npf-style[data-s="zhenshi"]');
  r.guard = { blocked: /要用底料第 6 格，那格还空着/.test(body()), back: /点步进条回①/.test(body()),
              asked: window.__fac.sent.length - beforeGuard, vers: (_npFac.vers || []).length, step: _npFac.step };
  _npFac.seeds[5] = keep5; _npFac.err = ''; npFacadePaint(nc); await sleep(150);

  // 点第一张卡（对比型）＝立刻按那一分法出一版：带的是那六件事＋七格底料＋版式那份分法
  const beforeV1 = window.__fac.sent.length;
  await click('.npf-style[data-s="duibi"]');
  const q1 = window.__fac.sent[beforeV1] || {};
  r.v1 = { action: q1.action, kind: q1.kind, outline: (q1.segs || []).length, first: (q1.segs || [])[0] && q1.segs[0].k,
           qCount: (q1.seeds || []).length, seed3: (q1.seeds || [])[2] && (q1.seeds || [])[2].a,
           seed6: (q1.seeds || [])[5] && (q1.seeds || [])[5].a, seed7: (q1.seeds || [])[6] && (q1.seeds || [])[6].a,
           styKey: q1.style && q1.style.key, styDemo: q1.style && String(q1.style.demo || '').slice(0, 6),
           styStruct: q1.style && String(q1.style.struct || '').slice(0, 8),
           styLeadLen: q1.style && String(q1.style.lead || '').length, noPrev: !q1.prev, noTitle: !q1.title,
           fresh: q1.fresh === true, noAsk: !q1.ask,
           sec: q1.sec, chars: q1.chars,
           vers: (_npFac.vers || []).length, verCur: _npFac.verCur, sents: n('.npf-sent'),
           cards: n('.npf-ver'), noBtn: !one('.npf-usever'),
           bodyRows: document.querySelectorAll('.npf-ver[data-i="0"] .npf-vbody > div').length,
           bodyAll: (() => { const t = txt('.npf-ver[data-i="0"]');
             return (window.__facCfg.introD || []).every(x => t.indexOf(x) >= 0); })(),
           v0Sents: versSents(0),
           onCard: /✓ 在用这版——再点一次换一版/.test(body()), usingPill: /在用：🔤/.test(body()),
           toast: /出了一版/.test(String((window.__toast || ''))), pill: /\d+ 版/.test(body()),
           oneLine: (_npFac.segs || []).every(x => Array.isArray(x) && x.length === 1) };

  // 再点另一张卡＝第 2 版；同一张卡再点一次＝同版式另开一版（上一版正文与旧标题都不喂）
  await click('.npf-style[data-s="wenda"]');
  const q2 = lastReq();
  r.v2 = { vers: (_npFac.vers || []).length, verCur: _npFac.verCur, sents: n('.npf-sent'),
           v1Sents: versSents(1), styKey: _npFac.style,
           fresh: q2.fresh === true, noPrev: !q2.prev, noTitle: !q2.title,
           useOn: /就用这版/.test(txt('.npf-ver[data-i="1"]')),
           useOther: /点这张选它/.test(txt('.npf-ver[data-i="0"]')),
           cards: n('.npf-ver'), pill: /2 版/.test(body()) };
  const beforeV3 = window.__fac.sent.length;
  await click('.npf-style[data-s="wenda"]');
  const q3 = lastReq();
  const sw3 = _npFac.simWarn || {};
  r.v3 = { vers: (_npFac.vers || []).length, verCur: _npFac.verCur, sents: n('.npf-sent'),
           v2Sents: versSents(2), styKey: q3.style && q3.style.key,
           fresh: q3.fresh === true, noPrev: !q3.prev, noTitle: !q3.title,
           noAsk: !q3.ask, asked: window.__fac.sent.length - beforeV3, styles: (_npFac.vers || []).map(v => v.style),
           simVer: sw3.ver, simExact: sw3.exact, simPct: sw3.pct,
           hint: /这版跟第 1 版有点像/.test(body()) && /只提示，不拦你用/.test(body()),
           reroll: !!one('.npf-reroll'), simok: !!one('.npf-simok'),
           toast: /跟第 1 版有点像/.test(String(window.__toast || '')) };
  await click('.npf-simok', 250);
  r.simOk = { warnGone: !_npFac.simWarn, hintGone: !/这版跟第 1 版有点像/.test(body()) };

  // 这一站没点中一版时：那颗前进钮灰着，硬走 npFacadeNext 只给一句人话、不跳站
  const keepCur = _npFac.verCur; _npFac.verCur = -1; npFacadePaint(nc); await sleep(150);
  r.noVer = { navOff: navOff(), navLabel: navLabel(), none: /先在上面点一版|先在下面点中一版/.test(navLabel()) };
  npFacadeNext(nc); await sleep(200);
  r.noVer.step = _npFac.step; r.noVer.err = /还没点中一版/.test(body());
  _npFac.verCur = keepCur; npFacadePaint(nc); await sleep(150);

  // 点卡片＝只选中（停在这一站），再点底下那颗钮才进 ③ 改稿
  await click('.npf-ver[data-i="0"]');
  r.pickSel = { step: _npFac.step, verCur: _npFac.verCur, style: _npFac.style, on: /就用这版/.test(txt('.npf-ver[data-i="0"]')) };
  await click('.npf-next');
  r.usever = { step: _npFac.step, style: _npFac.style, rows: sentRows().length, first: sentRows()[0],
               flat: (_npFac.segs || []).every(x => Array.isArray(x) && x.length === 1), rvPrevNull: !_npFac.rvPrev };

  // ── ③ 改稿：这一站不再摆版式卡，正文摊成一句一行 ──
  r.revise = { step: _npFac.step, cards: n('.npf-style'), noStyleBar: !/挑一种版式/.test(body()),
               rows: sentRows().length, oneLine: /一行一句、不分段/.test(body()), noParaWord: !/自然段/.test(txt('#npFacBody .note-xs')),
               noLock: !(body().indexOf('🔒 提纲钉死') >= 0),
               segHead: [...document.querySelectorAll('#npFacBody b')].filter(b => /^段\d/.test(String(b.textContent || ''))).length,
               wantStyle: /想换分法/.test(body()) && /版式卡在/.test(body()) && /② 挑稿/.test(body()),
               cntPill: /8 句/.test(body()), navLabel: navLabel() };

  // 蓝框：空着拦 / 常用改法一点就进框 / 说一句改整篇（只换台上这一稿，不进那一摞版）/ ↩ 改回上一版
  const beforeAsk = window.__fac.sent.length;
  await click('.npf-rvgo', 250);
  r.askEmpty = { blocked: /先说一句想怎么改/.test(txt('#npFacRvMsg')), asked: window.__fac.sent.length - beforeAsk };
  const chip0 = one('.npf-rchip'); if (chip0) { chip0.click(); await sleep(200); }
  r.chipFilled = (one('.npf-rvask') || {}).value || '';
  const ra = one('.npf-rvask'); if (ra) { ra.value = '第三句太绕，短一半'; ra.dispatchEvent(new Event('input', { bubbles: true })); }
  const beforeAsk2 = window.__fac.sent.length;
  await click('.npf-rvgo', 750);
  const aq = lastReq();
  r.askGo = { action: aq.action, ask: aq.ask, kind: aq.kind, styKey: aq.style && aq.style.key,
              prevHasD0: String(aq.prev || '').indexOf(INTROD0()) >= 0, asked: window.__fac.sent.length - beforeAsk2,
              step: _npFac.step, first: sentRows()[0], vers: (_npFac.vers || []).length,
              undoShown: !!one('.npf-rvundo:not([hidden])'), toast: /按你说的那句重排好了/.test(String(window.__toast || '')) };
  await click('.npf-rvundo', 250);
  r.undo = { first: sentRows()[0], hidden: !one('.npf-rvundo:not([hidden])'), msg: /已改回上一版/.test(txt('#npFacRvMsg')),
             step: _npFac.step, rows: sentRows().length };

  // 标题一条：🔁 换一个（正文一个字不带）／✏️ 编辑→✅ 就用这条
  const beforeT = window.__fac.sent.length;
  await click('.npf-tnext', 750);
  const tq = lastReq();
  r.titleNext = { need: tq.need, bodySent: tq.prev, segsKept: tq.segs && tq.segs.length, asked: window.__fac.sent.length - beforeT,
                  title: _npFac.title, rows: sentRows().length };
  await click('.npf-tedit', 250);
  const tin = one('.npf-tin');
  if (tin) { tin.value = '桩师傅在这个城市'; tin.dispatchEvent(new Event('input', { bubbles: true })); }
  await click('.npf-tsave', 300);
  r.titleEdit = { shown: /桩师傅在这个城市/.test(body()), editing: !!one('.npf-tin'), title: _npFac.title };

  // 逐句改（批准制）：点第一句 → 说一句 → 🤖 改这句 → 「比一比」→ 不要 / ✓ 用这版
  await click('.npf-sent', 250);
  r.opened = { ask: !!one('.npf-ask'), sgo: !!one('.npf-sgo'), own: !!one('.npf-fix'), tmode: !!one('.npf-tmode'),
               ph: (one('.npf-ask') || {}).placeholder || '' };
  const askBox = one('.npf-ask');
  if (askBox) { askBox.value = '短一半'; askBox.dispatchEvent(new Event('input', { bubbles: true })); }
  const origSent = String(_npFac.segs[0][0] || '');
  const sentBefore = sentRows()[0];
  await click('.npf-sgo', 750);
  const sq = lastReq();
  r.pend = { action: sq.action, ask: sq.ask, seg: sq.seg, askSeg: sq.askSeg, sentence: sq.sentence,
             noSeg: !sq.seg && !sq.askSeg, panel: !!one('.npf-pend'),
             origKept: sq.sentence === origSent && _npFac.segs[0][0] === origSent && !!(_npFac.pend && _npFac.pend.old === origSent && _npFac.pend.s),
             why: [sq.sentence === origSent, _npFac.segs[0][0] === origSent, sq.ask, sentBefore],
             cmp: /原句/.test(body()) && /改后/.test(body()) && /比一比再定/.test(body()),
             useBtn: !!one('.npf-suse'), dropBtn: !!one('.npf-sdrop') };
  await click('.npf-sdrop', 250);
  r.dropped = { panel: !!one('.npf-pend'), kept: sentRows()[0] === sentBefore };
  const askBox2 = one('.npf-ask');
  if (askBox2) { askBox2.value = '短一半'; askBox2.dispatchEvent(new Event('input', { bubbles: true })); }
  await click('.npf-sgo', 750);
  await click('.npf-suse', 400);
  await sleep(600);
  const MOD0 = sentRows()[0];
  // 档案那一格：介绍篇存一句一条（写入是扁平句清单，读回来 normalizer 会把每句裹成一条），这里一律摊回句子清单再比
  const flat = (arr) => (Array.isArray(arr) ? arr : []).map(x => (Array.isArray(x) ? String(x[0] || '') : String(x || '')));
  r.revised = { first: MOD0, saved: flat((await npArFindById(ni.id)).fSegs)[0], panelGone: !one('.npf-pend'),
                rows: sentRows().length, othersUntouched: sentRows().length === 8 && sentRows()[1] === INTROD1() };

  // ✍️ 全文手改（介绍篇＝一句一行摊开，没有【段名】、空行也不算分段）
  await click('.npf-tmode', 250);
  const ta = one('.npf-ta');
  const taTxt = String((ta && ta.value) || '');
  r.textOpen = { ta: !!ta, heads: (taTxt.match(/【.+?】/g) || []).length,
                 lines: taTxt.split('\n').filter(x => x.trim()).length,
                 blanks: taTxt.split('\n\n').length, help: /一句占一行/.test(body()) && /空行不算分段/.test(body()),
                 keepsSent: taTxt.indexOf(MOD0) >= 0 };
  if (ta) { ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true })); }
  await click('.npf-tapply', 250);
  const ta2 = one('.npf-ta');
  r.textErr = { blocked: /正文空了/.test(body()), stillTextMode: !!ta2 };
  if (ta2) { ta2.value = '全文手改的第一句。\n全文手改的第二句。\n\n空一行也算另一句。'; ta2.dispatchEvent(new Event('input', { bubbles: true })); }
  await click('.npf-tapply', 400);
  await sleep(600);
  r.textApplied = { backToSent: !one('.npf-ta') && !!one('.npf-sent'), rows: sentRows().length,
                    first: sentRows()[0], segsLen: (_npFac.segs || []).length,
                    everyOne: (_npFac.segs || []).every(x => Array.isArray(x) && x.length === 1),
                    saved: flat((await npArFindById(ni.id)).fSegs) };
  await click('.npf-rvundo', 250);
  r.textUndo = { first: sentRows()[0], step: _npFac.step };

  // ── ④ 选出口：三档 ──
  await click('.npf-next');
  r.gate = { step: _npFac.step, cards: [...document.querySelectorAll('.npf-gate b')].map(b => String(b.textContent || '').trim()),
             rec: (body().match(/推荐/g) || []).length, reuse: (body().match(/接现有通路，不重做/g) || []).length,
             tp: /提词卡长这样（一句一屏）/.test(body()), screens: (body().match(/屏\d/g) || []).length,
             talkShots: /拍：/.test(body()), copyTp: !!one('.npf-copytp'), gate0: _npFac.gate,
             formTalk: npFacadeFormOf(_npFac), noOldGates: !/只拍手|图文卡/.test(body()), noLipBtn: !one('.npf-lip'),
             selfBtn: !!one('[data-gate=selfopen]'), selfNoQuota: /不进工单台、也不占老板每天接单额度/.test(body()),
             navLabel: navLabel() };
  const order = [...document.querySelectorAll('.npf-gate')].find(x => /发工单/.test(x.textContent || ''));
  if (order) { order.click(); await sleep(300); }
  r.gate.formOrder = npFacadeFormOf(_npFac);
  r.gate.orderBtn = !!one('[data-gate=orderopen]');
  r.gate.orderThree = /一张正脸照 ＋ 这篇稿子 ＋ 一句想要的音色/.test(body());
  r.gate.orderNoVoice = !/自己声音|一段段念/.test(body());
  r.gate.noSelfBtnOnOrder = !one('[data-gate=selfopen]');
  r.gate.navOrder = navLabel();
  r.gate.navOrderSkip = /工单默认跳过封面/.test(String((document.getElementById('npFacNav') || {}).textContent || ''));
  const talk = [...document.querySelectorAll('.npf-gate')].find(x => /对着镜头念/.test(x.textContent || ''));
  if (talk) { talk.click(); await sleep(250); }
  r.gate.formTalkBack = npFacadeFormOf(_npFac);
  window.__fac.film.length = 0;
  const film = [...document.querySelectorAll('.npf-gate')].find(x => /字效片/.test(x.textContent || ''));
  r.gate.hasFilmCard = !!film;
  if (film) { film.click(); await sleep(250); }
  r.gate.filmSaysNotInKindRow = /不再出现在「这一档要做成什么片」那一排/.test(body());
  r.reuseFilmLabel = txt('.npf-reuse');
  await click('.npf-reuse', 500);
  r.film = { called: window.__fac.film.length, hasNote: !!(window.__fac.film[0] || {}).noteId,
             textHead: String((window.__fac.film[0] || {}).text || '').slice(0, 18),
             lines: String((window.__fac.film[0] || {}).text || '').split('\n').filter(x => x.trim()).length };
  // 回到这一篇：出口定回「自己对着镜头念」，站上 ⑤ 封面&字幕
  window.switchMainTab('noteFacade', await npArFindById(ni.id));
  await sleep(400);
  _npFac.gate = 'talk'; _npFac.step = 4; npFacadePaint(nc); await sleep(400);

  // ── ⑤ 封面&字幕：本机没这条片时让进、不拦路，但那颗「下一步」拦封面 ──
  r.noFilm = { step: _npFac.step, head: /封面 & 字幕——这条片还没到本机/.test(body()),
               letIn: /让进、不拦路/.test(body()), noTake: /还没拿「自己念」那条链接/.test(body()),
               navOff: navOff(), navLabel: navLabel(), subHead: /字幕——这条片要不要加/.test(body()),
               subOff: !!one('.npf-subadd') && one('.npf-subadd').disabled,
               subWhy: /先有这条片/.test(body()), upcover: !!one('.npf-upcover'), skip: !!one('.npf-coverskip'),
               noImgSlot: !one('.npf-up'), noAnti: !/实拍比精修有用/.test(body()) };

  // 本机放上那条三条秒小片 + 一张逐句录的单（桩）→ 进站自动读本机片、能播能取帧
  const bin = atob(FILM_B64); const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  await npCasePut('film:' + ni.id, new Blob([u8], { type: 'video/webm' }));
  _npFac.lip = window.__lipSeed;
  npFacCvDrop(ni.id);
  npFacadePaint(nc);
  await sleep(1800);
  const c0 = npFacCv(_npFac);
  r.filmLoad = { video: !!one('#npfFilm'), seek: !!one('#npfSeek'), durLab: txt('#npfDur'),
                 dur: Number(c0.dur) || 0, url: !!c0.url, err: c0.err || '',
                 lays: n('.npf-lay'), ct: !!one('.npf-ct'), ctBack: !!one('.npf-ctback'),
                 roll: !!one('.npf-roll'), take: !!one('.npf-take'),
                 fixOff: !!one('.npf-fixcover') && one('.npf-fixcover').disabled,
                 subOn: !!one('.npf-subadd') && !one('.npf-subadd').disabled,
                 noFrame: /还没候选帧/.test(body()), prevHint: /没选帧前这里是空的/.test(body()) };

  // 🎲 随机给 5 帧：每帧真取到画面（canvas 750×1000），彼此隔得开，第一帧自动选中
  // （取帧要拖进度条，播放器先把这条片读起来才拖得动——刚建好就拖会没响应）
  await vidReady();
  await sleep(400);
  await click('.npf-roll');
  await waitUntil(() => { const c = npFacCv(_npFac); return (c.frames || []).length > 0 || c.err; }, 40000);
  await cvIdle();
  const cs = npFacCv(_npFac);
  const ts = (cs.frames || []).map(x => x.t).sort((a, b) => a - b);
  let minGap = 9; for (let i = 1; i < ts.length; i++) minGap = Math.min(minGap, ts[i] - ts[i - 1]);
  r.roll = { count: (cs.frames || []).length, thumbs: n('.npf-fr img'), cards: n('.npf-fr'),
             w: cs.frames && cs.frames[0] && cs.frames[0].cv.width, h: cs.frames && cs.frames[0] && cs.frames[0].cv.height,
             picked: !!cs.frame && cs.frame === (cs.frames || [])[0], gap: minGap, span: cs.dur,
             err: cs.err || '', busy: !!cs.busy,
             chosen: /已选一帧/.test(body()), clr: !!one('.npf-frclr'), fixOn: !one('.npf-fixcover').disabled,
             toast: /随机给了/.test(String(window.__toast || '')) };

  // 拖进度条到 1.4 秒 → 取现在这一帧（取帧要先等播放器把这条片重新准备好）
  await vidReady();
  const seek = one('#npfSeek'); if (seek) { seek.value = '1.4'; seek.dispatchEvent(new Event('input', { bubbles: true })); }
  await sleep(200);
  await click('.npf-take');
  await waitUntil(() => { const c = npFacCv(_npFac); return (c.frame && c.frame.t >= 1.3) || c.err; }, 12000);
  await cvIdle();
  const c1 = npFacCv(_npFac);
  r.take = { t: c1.t, frameT: c1.frame && c1.frame.t, pill: /已选一帧 · 1.4s/.test(body()),
             err: c1.err || '', seekVal: (one('#npfSeek') || {}).value || '',
             now: txt('#npfTNow'), coverYet: npFacadeHasCover(_npFac) };

  // 挑版式（左上竖排）+ 封面标题那一行（只动封面、不带走本篇标题）→ ✓ 定这张当封面
  await click('.npf-lay[data-l="side"]');
  r.lay = { lay: npFacCv(_npFac).lay, onCard: !!one('.npf-lay[data-l="side"]') };
  const ct = one('.npf-ct'); if (ct) { ct.value = '先看活再谈价'; ct.dispatchEvent(new Event('input', { bubbles: true })); }
  await sleep(200);
  r.cTitle = npFacCv(_npFac).cTitle;
  await click('.npf-fixcover');
  await waitUntil(() => !!(_npFac.cover && _npFac.cover.name), 12000);
  const noteIdb = await npArFindById(ni.id);
  const storedCover = await npCaseGet('cover:' + ni.id);
  r.fixed = { name: (_npFac.cover || {}).name || '', url: (_npFac.cover || {}).url || '',
              lay: (_npFac.cover || {}).lay || '', cTitle: (_npFac.cover || {}).cTitle || '',
              at: (_npFac.cover || {}).at, thumb: !!(_npFac.cover || {}).thumb,
              storeSize: (storedCover && storedCover.size) || 0,
              noteCover: (noteIdb.fCover || {}).name || '',
              navLabel: navLabel(), navOff: navOff(),
              nowLine: /现在这张：封面·左上竖排·1.4s/.test(body()), has: npFacadeHasCover(_npFac),
              cvErr: npFacCv(_npFac).err || '' };

  // 撤掉这张：档案与本机那份图一起清掉，那颗「下一步」回到拦封面
  await click('.npf-covclr');
  await waitUntil(() => !_npFac.cover, 12000);
  const gone = await npCaseGet('cover:' + ni.id);
  r.cleared = { gone: !_npFac.cover, storeGone: !gone, navOff: navOff(), navLabel: navLabel(),
                noteCover: (await npArFindById(ni.id)).fCover };

  // 浏览器解不开片子的兜底：传一张自己的图当封面来源（照样挑版式加标题）
  const pngBin = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
  const png = new Uint8Array(pngBin.length); for (let i = 0; i < pngBin.length; i++) png[i] = pngBin.charCodeAt(i);
  await npFacCoverFromImage(nc, new File([png], '我自己的.png', { type: 'image/png' }));
  await sleep(300);
  const c2 = npFacCv(_npFac);
  r.ownImg = { frames: (c2.frames || []).length, lab: c2.frames && c2.frames[0] && c2.frames[0].lab,
               frameT: c2.frame && c2.frame.t, thumb: !!(c2.frame && c2.frame.thumb) };
  await click('.npf-lay[data-l="big"]');
  await click('.npf-fixcover', 900);
  r.ownCover = { name: (_npFac.cover || {}).name || '', at: (_npFac.cover || {}).at,
                 lay: (_npFac.cover || {}).lay || '', store: !!((await npCaseGet('cover:' + ni.id)) || {}).size };

  // 字幕四态：送不出去 → fail；送出 → queue（开着这站每 8 秒自动问）；问到 done → 新片顶掉旧片并自动取回；revert → 回上一版
  window.__subSendFail = true;
  _npFac.sub = ''; npFacadePaint(nc); await sleep(200);
  const callsBefore = window.__lipCalls.length;
  await click('.npf-subadd', 700);
  await sleep(400);
  const subSend = (window.__lipCalls[callsBefore] || {});
  r.subFailSend = { state: _npFac.sub, msg: /加字幕没送出去/.test(body()), retry: !!one('.npf-subadd'),
                    path: subSend.path || '', calls: window.__lipCalls.length - callsBefore,
                    lipId: String((_npFac.lip || {}).id || ''), screens: npFacadeScreens(_npFac).length,
                    btn: !!one('.npf-subadd'), disabled: !!one('.npf-subadd') && one('.npf-subadd').disabled,
                    toast: String(window.__toast || ''), note: (await npArFindById(ni.id)).fSub };
  window.__subSendFail = false; window.__subSt = 'queue';
  _npFac.sub = ''; npFacadePaint(nc); await sleep(200);
  window.__lipCalls.length = 0;
  await click('.npf-subadd', 700);
  const sendCall = window.__lipCalls.find(x => x.path === '/api/lip/sub') || {};
  r.subQueue = { state: _npFac.sub, path: sendCall.path || '', sents: ((sendCall.body || {}).sents || []).length,
                 first: ((sendCall.body || {}).sents || [])[0] || '', id: (sendCall.body || {}).id || '',
                 tok: (sendCall.body || {}).t || '', jobAt: !!_npFac.subJob, timerOn: !!_npCvTimer,
                 zone: /云端在排这一条/.test(body()), askBtn: !!one('.npf-subask'),
                 note: (await npArFindById(ni.id)).fSub };
  await click('.npf-subask', 500);
  r.subStillQueue = { state: _npFac.sub, asked: window.__lipCalls.filter(x => x.path === '/api/lip/status').length };
  window.__subSt = 'done';
  const takeBefore = window.__takeCalls;
  await click('.npf-subask');
  await waitUntil(() => _npFac.sub === 'done', 8000);
  await sleep(1500);
  r.subDone = { state: _npFac.sub, head: /顶掉了原来那条/.test(body()) && /还留 7 天/.test(body()),
                takes: window.__takeCalls - takeBefore, timerOff: !_npCvTimer,
                framesGone: n('.npf-fr'), reload: !!npFacCv(_npFac).url,
                revertBtn: !!one('.npf-subrevert'), noAdd: !one('.npf-subadd'),
                note: (await npArFindById(ni.id)).fSub };
  const takeB2 = window.__takeCalls;
  await click('.npf-subrevert');
  await waitUntil(() => !!window.__lipCalls.find(x => x.path === '/api/lip/sub_revert'), 8000);
  await sleep(1200);
  const rvCall = (window.__lipCalls.find(x => x.path === '/api/lip/sub_revert') || {}).path || '';
  r.subRevert = { path: rvCall, state: _npFac.sub, takes: window.__takeCalls - takeB2,
                  addBack: !!one('.npf-subadd'), skipBack: !!one('.npf-subskip'),
                  note: (await npArFindById(ni.id)).fSub };
  window.__subSt = 'fail';
  _npFac.sub = 'queue'; npFacadePaint(nc); await sleep(200);
  const asksBefore = window.__lipCalls.length;
  await click('.npf-subask');
  await waitUntil(() => _npFac.sub === 'fail', 8000);
  await sleep(300);
  r.subCloudFail = { state: _npFac.sub, msg: /挤不开/.test(body()) && /原片一个字没动/.test(body()),
                     asked: window.__lipCalls.length - asksBefore,
                     retry: [...document.querySelectorAll('.npf-subadd')].map(x => String(x.textContent || '').trim()).join(' | '),
                     note: (await npArFindById(ni.id)).fSub };
  await click('.npf-subskip', 500);
  r.subSkip = { state: _npFac.sub, line: /不加字幕——不拦路/.test(body()), undoBtn: !!one('.npf-subundo'),
                navOff: navOff() };
  await click('.npf-subundo', 400);
  r.subUndo = { state: _npFac.sub, addBack: !!one('.npf-subadd'), skipBack: !!one('.npf-subskip') };
  await click('.npf-subskip', 400);

  // ── ⑥ 收口：只摆一篇正文＋复制／挑位子；置顶只留一句提示（确认钮在档案横幅那一层） ──
  await click('.npf-next', 400);
  r.done = { step: _npFac.step, title: txt('#npFacBody').indexOf(String(_npFac.title || '')) >= 0,
             textHas: body().indexOf(npFacadeText(_npFac).slice(0, 20)) >= 0,
             copyAll: !!one('.npf-copyall'), copyTp: !!one('.npf-copytp'), todate: !!one('.npf-todate'),
             noBio: !one('.npf-bio'), noPinSteps: !one('#npFacBody ol li'),
             noOldLines: !/封面：/.test(body()) && !/字幕：/.test(body()) && !/正文 \d+ 句/.test(body()),
             pinHint: /发完去小红书主页把这篇置顶/.test(body()), noBarNav: !one('.npf-next'),
             screens: npFacadeScreens(_npFac).length };
  await npFacadeMarkPinned(ni.id);
  const after = await npArFindById(ni.id);
  r.saved = { pinned: after.pinned, form: after.form, gate: after.fGate, dir: after.dir, fkind: after.fkind,
              style: after.fStyle, title: after.title, seedLen: (after.fSeed || []).length,
              segs: flat(after.fSegs), segsOneRow: (after.fSegs || []).every(x => Array.isArray(x) && x.length === 1),
              vers: (after.fVers || []).length, versStyles: (after.fVers || []).map(v => v.style),
              versSents: (after.fVers || []).map(v => (v.segs || []).reduce((a, x) => a + (Array.isArray(x) ? x.length : 1), 0)),
              cover: (after.fCover || {}).name || '', sub: after.fSub, imgs: (after.fImgs || []).length,
              fstep: (after.wip || {}).fstep, draftHas: /私信/.test(String(after.draft || '')),
              bar: /✓ 已置顶/.test(npFacadeBar(await npNotesAll())) };

  // ── ⑦ 承接篇：挑稿（照提纲出一版／↻ 再出一版，没有版式卡）→ 改稿（段名钉死）→ 👀 预览 → 收口置顶 ──
  const nd = await npDirNewNote('f', '长文', 'deal');
  window.switchMainTab('noteFacade', nd);
  await sleep(400);
  r.deal = { rows: n('.npf-seed'), gate: _npFac.gate, noGateCards: !one('.npf-gate'),
             form: npFacadeFormOf(_npFac), brought: (body().match(/已带到：/g) || []).length,
             step0Label: navLabel() };
  seed(0, '多少钱一平方、要不要定金、料谁买、多久干完、做坏了咋办');
  npFacadeNext(nc); await sleep(300);
  r.deal.steps = barAll();
  r.deal.styleCards = n('.npf-style');
  r.deal.outLabel = txt('.npf-out');
  r.deal.none = /还没出稿/.test(body());
  r.deal.navOff = navOff();
  r.deal.navLabel = navLabel();
  npFacadeNext(nc); await sleep(300);
  r.deal.noVerErr = /还没出稿——点上面那颗/.test(body()) && _npFac.step === 1;
  await click('.npf-out', 750);
  r.deal.v1 = { vers: (_npFac.vers || []).length, verCur: _npFac.verCur, outLabel: txt('.npf-out'),
               heads: n('.npf-ver'), pill: /1 版/.test(body()),
               v0Sents: npFacVerSents((_npFac.vers || [])[0] || {}).length,
               bodyRows: document.querySelectorAll('.npf-ver[data-i="0"] .npf-vbody > div').length,
               bodyAll: (() => { const t = txt('.npf-ver[data-i="0"]');
                 return (window.__facCfg.deal || []).every(row => row.every(x => t.indexOf(x) >= 0)); })(),
               segShape: (_npFac.vers || []).map(v => (v.segs || []).length) };
  await click('.npf-out', 750);
  r.deal.v2 = { vers: (_npFac.vers || []).length, verCur: _npFac.verCur, styles: (_npFac.vers || []).map(v => v.style),
               labels: (_npFac.vers || []).map(v => String(v.t || '')), cards: n('.npf-ver'),
               lock: /🔒 段名一字不许改/.test(body()) };
  await click('.npf-ver[data-i="0"]');
  r.deal.pickStep = _npFac.step;
  await click('.npf-next');
  r.deal.revise = { step: _npFac.step, cards: n('.npf-style'), noStyleBar: !/挑一种版式/.test(body()),
                    chips: n('.npf-rchip'), rvgo: !!one('.npf-rvgo'), tnext: !!one('.npf-tnext'),
                    rows: sentRows().length, segHeads: [...document.querySelectorAll('#npFacBody b')]
                      .filter(b => /^段\d/.test(String(b.textContent || ''))).length,
                    keepsLock: (body().match(/🔒 提纲钉死/g) || []).length,
                    pinnedBar: /🔒 段名钉死，AI 不挪段/.test(body()), navLabel: navLabel() };
  const ra0 = one('.npf-rvask');
  if (ra0) { ra0.value = '说得更白一点'; ra0.dispatchEvent(new Event('input', { bubbles: true })); }
  const beforeDA = window.__fac.sent.length;
  await click('.npf-rvgo', 750);
  const daq = lastReq();
  r.deal.ask = { action: daq.action, kind: daq.kind, ask: daq.ask, noStyle: !daq.style,
                 asked: window.__fac.sent.length - beforeDA, step: _npFac.step };
  await click('.npf-rvundo', 250);
  r.deal.afterUndo = { first: sentRows()[0] };
  await click('.npf-tmode', 250);
  const dta = one('.npf-ta');
  const dTxt = String((dta && dta.value) || '');
  const dname = FACADE_OUTLINE.deal.segs[0].k;
  r.deal.textOpen = { ta: !!dta, heads: (dTxt.match(/【.+?】/g) || []).length,
                      first: dTxt.indexOf('【' + dname + '】') === 0, help: /每段头上带一行【段名】/.test(body()) };
  if (dta) { dta.value = dTxt.replace('【' + dname + '】\n', ''); dta.dispatchEvent(new Event('input', { bubbles: true })); }
  await click('.npf-tapply', 250);
  const dta2 = one('.npf-ta');
  r.deal.textErr = { blocked: /落在所有段外面/.test(body()), stillTextMode: !!dta2 };
  await click('.npf-tdrop', 250);
  r.deal.textDropped = { back: !one('.npf-ta') && !!one('.npf-sent'), first: sentRows()[0] };
  await click('.npf-next', 400);
  r.deal.prev = { step: _npFac.step, head: /👀 预览/.test(body()), longPub: /长文模式/.test(body()),
                  copyAll: !!one('.npf-copyall'), back: !!one('.npf-prevback'), navLabel: navLabel() };
  await click('.npf-next', 400);
  r.deal.done = { step: _npFac.step,
                  title: body().indexOf(String(_npFac.title || '')) >= 0,
                  textHas: body().indexOf(npFacadeText(_npFac).slice(0, 20)) >= 0,
                  sentLine: /正文 \d+ 句/.test(body()), noCoverLine: !/封面：/.test(body()),
                  noSubLine: !/字幕：/.test(body()), uploads: n('.npf-up'), noGateCards: !one('.npf-gate'),
                  noImgLine: !/配图 \d+ 张/.test(body()), copyAll: !!one('.npf-copyall'),
                  copyTp: !!one('.npf-copytp'), todate: !!one('.npf-todate') };
  const dealAfter = await npArFindById(nd.id);
  r.deal.saved = { form: dealAfter.form, gate: dealAfter.fGate, segsLen: (dealAfter.fSegs || []).length,
                   nested: Array.isArray((dealAfter.fSegs || [])[0]), longLen: String(dealAfter.longform || '').length,
                   imgs: (dealAfter.fImgs || []).length, cover: dealAfter.fCover, sub: dealAfter.fSub,
                   vers: (dealAfter.fVers || []).length,
                   next: (npArNext(dealAfter, null) || {}).lab };

  // ── ⑧ 出稿失败：给一句人话、留在 ② 挑稿、卡还在、底料留着 ──
  const ni3 = await npDirNewNote('f', '口播稿', 'intro');
  window.switchMainTab('noteFacade', ni3);
  await sleep(400);
  seed(2, '一天到晚在工地上：量、放线、贴完验收');
  seed(5, '这个城市做过几百户，验收单都留着');
  seed(6, '别家爱先报高价再砍，我不这么干');
  await click('.npf-next');
  window.__facCfg.fail = true;
  window.__facCfg.failErr = '桩：后台那支还没接上';
  const before = window.__fac.sent.length;
  await click('.npf-style[data-s="duibi"]', 700);
  r.fail = { msg: /桩：后台那支还没接上/.test(body()), vers0: (_npFac.vers || []).length,
             stillPick: _npFac.step === 1 };
  window.__facCfg.failErr = '';
  await click('.npf-style[data-s="duibi"]', 700);
  r.fail.again = /稿子没出来——再点一次上面那张版式卡/.test(body());
  r.fail = Object.assign(r.fail, { stillPick2: _npFac.step === 1, vers: (_npFac.vers || []).length,
             verCur: _npFac.verCur, cards: n('.npf-style'), noSent: n('.npf-sent'),
             asked: window.__fac.sent.length - before, seedsKept: String(_npFac.seeds[2] || '') });
  window.__facCfg.fail = false;

  // ── ⑨ 整条视频上传（问题 6）：出口卡传片 → 本机落档、直进⑤ 封面&字幕 → 加字幕现建 selfup 单 ──
  const nu = await npDirNewNote('f', '口播稿', 'intro');
  window.switchMainTab('noteFacade', nu);
  await sleep(400);
  seed(2, '一天到晚在工地上：量、放线、贴完验收');
  seed(5, '这个城市做过几百户，验收单都留着');
  seed(6, '别家爱先报高价再砍，我不这么干');
  await click('.npf-next');
  await click('.npf-style[data-s="duibi"]');
  _npFac.step = 3; _npFac.gate = 'talk'; npFacadePaint(nc); await sleep(300);
  r.up6 = { gate: { step: _npFac.step, btn: !!one('.npf-upfilm'),
                    mode: (one('.npf-upfilm') || {}).getAttribute ? String(one('.npf-upfilm').getAttribute('data-mode') || '') : '',
                    say: /最长 3 分钟、最大 200MB/.test(body()) && /先存在你这台电脑上/.test(body()) } };
  await pickFilm(one('.npf-upfilm'));
  await waitUntil(() => _npFac.film && Number(_npFac.film.at) && _npFac.step === 4, 20000);
  await waitUntil(() => { const c = npFacCv(_npFac); return !!(c && c.url); }, 20000);
  await sleep(500);
  const nUp = await npArFindById(nu.id);
  const filmDb = await npCaseGet('film:' + nu.id);
  const cU = npFacCv(_npFac);
  r.up6.load = { step: _npFac.step, name: String((_npFac.film || {}).name || ''),
                 dur: Number((_npFac.film || {}).dur) || 0, size: Number((_npFac.film || {}).size) || 0,
                 src: String((_npFac.film || {}).src || ''), dbSize: (filmDb && filmDb.size) || 0,
                 noteFilm: String((nUp.fFilm || {}).name || ''), noteAt: !!((nUp.fFilm || {}).at),
                 filmCard: /你自己录好传上来的那条/.test(body()), video: !!one('#npfFilm'),
                 url: !!(cU && cU.url), cvDur: Number(cU && cU.dur) || 0,
                 toast: String(window.__toast || '') };
  r.up6.sub = { say: /这条是你传的整条片/.test(body()) && /云端收一份副本（≤100MB）/.test(body()),
                warn: /两边差得多/.test(body()),
                addOn: !!one('.npf-subadd') && !one('.npf-subadd').disabled,
                credUp: !!((npFacSubCred(_npFac) || {}).up) };
  // 两道线：片 >100MB、稿 >900 字——加字幕那颗灰着并说明白
  const keepFilm6 = _npFac.film, keepSegs6 = _npFac.segs;
  _npFac.film = Object.assign({}, keepFilm6, { size: 101 * 1024 * 1024 });
  npFacadePaint(nc); await sleep(200);
  r.up6.big = { off: !!one('.npf-subadd') && one('.npf-subadd').disabled, why: /云端只收 100MB 以内/.test(body()) };
  _npFac.film = keepFilm6;
  _npFac.segs = [['这一句正好十个字呀啊'.repeat(100)]];
  npFacadePaint(nc); await sleep(200);
  r.up6.long = { off: !!one('.npf-subadd') && one('.npf-subadd').disabled, why: /超过 900 字/.test(body()) };
  _npFac.segs = keepSegs6; npFacadePaint(nc); await sleep(200);
  // ➕ 加字幕：现建 selfup 单、整条片原样上传（桩记大小），再送这篇那几句
  const putB = window.__putWhole.length, lipB = window.__lipCalls.length;
  await click('.npf-subadd', 800);
  await waitUntil(() => _npFac.sub === 'queue' || _npFac.sub === 'fail', 20000);
  await sleep(300);
  const uCalls = window.__lipCalls.slice(lipB);
  const uSubmit = uCalls.find(x => x.path === '/api/lip/submit') || {};
  const uSub = uCalls.find(x => x.path === '/api/lip/sub') || {};
  const uPut = window.__putWhole[putB] || {};
  r.up6.queue = { state: _npFac.sub, submitRoute: String((uSubmit.body || {}).route || ''),
                  submitNote: String((uSubmit.body || {}).noteId || ''),
                  putId: String(uPut.id || ''), putSize: Number(uPut.size) || 0,
                  subId: String((uSub.body || {}).id || ''), subT: String((uSub.body || {}).t || ''),
                  sents: ((uSub.body || {}).sents || []).length,
                  jobRoute: String(((_npFac.subJob || {}).route) || ''), upDone: !!((_npFac.subJob || {}).upDone),
                  zone: /云端在排这一条/.test(body()), noteSub: String((await npArFindById(nu.id)).fSub || ''),
                  toast: String(window.__toast || '') };
  // 云端烧好 → 自动取回新片；再回上一版；之后再加一次不该重传整条片
  window.__subSt = 'done';
  const takeUp1 = window.__takeCalls;
  await click('.npf-subask');
  await waitUntil(() => _npFac.sub === 'done', 8000);
  await sleep(1200);
  r.up6.done = { state: _npFac.sub, takes: window.__takeCalls - takeUp1,
                 head: /顶掉了原来那条/.test(body()), revert: !!one('.npf-subrevert'),
                 noteSub: String((await npArFindById(nu.id)).fSub || '') };
  const takeUp2 = window.__takeCalls;
  await click('.npf-subrevert');
  await waitUntil(() => !!window.__lipCalls.find(x => x.path === '/api/lip/sub_revert'), 8000);
  await sleep(1000);
  r.up6.revert = { state: _npFac.sub, takes: window.__takeCalls - takeUp2,
                   route: String(((_npFac.subJob || {}).route) || ''), upDone: !!((_npFac.subJob || {}).upDone),
                   addBack: !!one('.npf-subadd'),
                   noteSub: String((await npArFindById(nu.id)).fSub || '') };
  const putB2 = window.__putWhole.length;
  await click('.npf-subadd', 800);
  await waitUntil(() => _npFac.sub === 'queue', 10000);
  r.up6.reuse = { state: _npFac.sub, put: window.__putWhole.length - putB2 };

  // ── ⑩ 知识线口播：同一张出口卡也有「传整条视频」；传完回档案，下一步「🎬 成片预览」 ──
  const nk = await npDirNewNote('k', '口播稿');
  await npNotesSync(async () => {
    const list = await npNotesAll();
    const n = list.find(x => x && x.id === nk.id);
    n.draft = '知识线这篇的稿子第一句。知识线这篇的稿子第二句。';
    n.titles = ['知识线整条片那篇'];
    n.wip = { step: 4, path: '', noteStyle: {}, write: null, planItem: null };
    n.updatedAt = Date.now();
    await chrome.storage.local.set({ [NP_NOTES_KEY]: list });
  });
  window.switchMainTab('notePublish', await npArFindById(nk.id));
  await waitUntil(() => _npWiz && String(_npWiz.arId || '') === String(nk.id) && one('#npWizBody .npf-gate[data-g="talk"]'), 15000);
  await sleep(400);
  const talkK = one('#npWizBody .npf-gate[data-g="talk"]');
  if (talkK) { talkK.click(); await sleep(400); }
  const upK = one('#npWizBody .npf-upfilm');
  r.up6.know = { card: !!upK, mode: upK ? String(upK.getAttribute('data-mode') || '') : '',
                 say: /已经录好了整条视频/.test(txt('#npWizBody')),
                 selfBox: /一句一句念（系统给你链接）/.test(txt('#npWizBody')) };
  await pickFilm(upK);
  await waitUntil(() => { const w = _npWiz; return !!(w && w.fFilm && Number(w.fFilm.at)); }, 20000);
  await waitUntil(() => String((window.__fac.out || []).slice(-1)[0] || '') === 'noteArchive', 8000);
  await sleep(700);
  const nkAfter = await npArFindById(nk.id);
  const nkNext = npArNext(nkAfter, null) || {};
  const kDb = await npCaseGet('film:' + nk.id);
  r.up6.know.landed = { film: String((nkAfter.fFilm || {}).name || ''), db: (kDb && kDb.size) || 0,
                        gate: String(nkAfter.fGate || ''), form: String(nkAfter.form || ''),
                        voice: String(nkAfter.voice || '').slice(0, 10),
                        next: String(nkNext.lab || ''), to: String(nkNext.to || ''),
                        tab: String((window.__fac.out || []).slice(-1)[0] || '') };

  // 那几条本机小片不清掉的话，下一次跑这几篇会读到旧片
  try { await npCaseDel('film:' + ni.id); await npCaseDel('cover:' + ni.id); } catch (_) {}
  try { await npCaseDel('film:' + nu.id); await npCaseDel('cover:' + nu.id); } catch (_) {}
  try { await npCaseDel('film:' + nk.id); await npCaseDel('cover:' + nk.id); } catch (_) {}
  r.ids = { intro: ni.id, deal: nd.id, plain: ni3.id, up: nu.id, know: nk.id };
  return r;

  function INTROD0() { return window.__facCfg.introD[0]; }
  function INTROD1() { return window.__facCfg.introD[1]; }
}'''

GATENEXT = r'''async () => {
  const n0 = await npArFindById(window.__ids.intro);
  window.switchMainTab('noteFacade', n0);
  await new Promise(s => setTimeout(s, 500));
  const out = {};
  const nc = document.getElementById('notePublishContent');
  const look = (raw, over) => {
    const n = Object.assign({}, raw, over || {}, { status: '代发' });
    return npArNext(n, null) || {};
  };
  for (const g of ['talk', 'order', 'film']) {
    _npFac.gate = g;
    await npFacadeSave();
    await new Promise(s => setTimeout(s, 300));
    const raw = await npArFindById(window.__ids.intro);
    out[g] = { form: raw.form, stored: raw.fGate, next: look(raw).lab, to: look(raw).to,
               noCover: look(raw, { fCover: null }).lab, noCoverTo: look(raw, { fCover: null }).to,
               noCoverTip: look(raw, { fCover: null }).tip || '',
               noGate: look(raw, { fGate: '' }).lab, noGateTip: look(raw, { fGate: '' }).tip || '',
               legacy: look(raw, { fGate: 'hand', fCover: null }),
               legacyNoCov: look(raw, { fGate: 'hand' }) };
  }
  _npFac.gate = 'talk'; await npFacadeSave();
  return out;
}'''


def make_film():
    """三条秒、360x640、libvpx 的小 webm：够小能 base64 送进页面，又真能被浏览器解码取帧"""
    if FILM.exists() and FILM.stat().st_size > 1000:
        return base64.b64encode(FILM.read_bytes()).decode('ascii')
    SHOT.mkdir(parents=True, exist_ok=True)
    for probe in ('ffmpeg', 'ffmpeg.exe'):
        try:
            subprocess.run([probe, '-version'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            break
        except Exception:
            probe = None
    if not probe:
        bad('造不出那条测试用的短片（本机没有 ffmpeg）')
        return None
    cmd = [probe, '-y', '-f', 'lavfi', '-i', 'testsrc=size=360x640:rate=15:duration=3',
           '-c:v', 'libvpx', '-b:v', '180k', '-auto-alt-ref', '0', '-pix_fmt', 'yuv420p', str(FILM)]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    if not FILM.exists() or FILM.stat().st_size < 1000:
        bad('ffmpeg 造出来的短片不对（%s）' % FILM)
        return None
    return base64.b64encode(FILM.read_bytes()).decode('ascii')


def snap(page, name):
    try:
        page.screenshot(path=str(SHOT / name))
    except Exception as e:
        print('  （照片没拍成 %s：%s）' % (name, e), flush=True)


def main():
    print('── 🪟 门面笔记批 2：门面这条流（挑稿／改稿／出口／封面&字幕／收口）──', flush=True)
    import shutil
    if DATA.exists():
        shutil.rmtree(DATA)
    DATA.mkdir(parents=True, exist_ok=True)
    SHOT.mkdir(parents=True, exist_ok=True)
    film_b64 = make_film()
    if film_b64 is None:
        return
    print('  （取帧用的短片：%d 字节）' % FILM.stat().st_size, flush=True)
    env = dict(os.environ)
    env['DEMO_DATA_DIR'] = str(DATA)
    env['PORT'] = str(PORT)
    env['DEMO_AI_KEY'] = 'check-only'
    env['DEMO_AI_BASE'] = 'http://127.0.0.1:1/v1'
    env['DEMO_SIGNUP_MAX'] = '60'
    logf = open(REPO / 'tmp' / 'facade-flow-check.server.log', 'w', encoding='utf-8')
    srv = subprocess.Popen(['node', str(REPO / 'server' / 'dev-server.mjs')], env=env, stdout=logf, stderr=subprocess.STDOUT)
    for _ in range(80):
        try:
            socket.create_connection(('127.0.0.1', PORT), 1).close()
            break
        except OSError:
            time.sleep(0.5)
    else:
        bad('服务器没起来（看 tmp/facade-flow-check.server.log）')
        return
    time.sleep(2)
    try:
        with sync_playwright() as p:
            br = p.chromium.launch(channel='msedge', headless=True, args=['--autoplay-policy=no-user-gesture-required'])
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
            page.evaluate('''() => { const t0 = toast; window.__toast = '';
                window.toast = function (m, k) { window.__toast = String(m || ''); return t0.apply(null, arguments); }; }''')
            page.evaluate(STUB_JS, {'introD': INTRO_D, 'introB': INTRO_B, 'redo': REDO, 'asked': ASKED,
                                    'deal': DEAL_SEGS, 'dealRedo': DEAL_REDO, 'fail': False})
            r = page.evaluate(FLOW, {'steps': ['补底料', '挑稿', '改稿', '选出口', '封面&字幕', '收口置顶'],
                                     'film': film_b64})
            if isinstance(r, dict) and r.get('err'):
                bad(r['err'])
                br.close()
                return
            # 照片：介绍篇六站逐站摊开给人眼看（数据全在桩那一篇上）
            page.evaluate('''async (a) => { window.__ids = a.ids;
                window.switchMainTab('noteFacade', await npArFindById(a.ids.intro)); }''', {'ids': r['ids']})
            page.wait_for_timeout(600)
            for i, name in enumerate(['1-补底料', '2-挑稿', '3-改稿', '4-选出口', '5-封面字幕', '6-收口置顶']):
                page.evaluate('''(i) => { _npFac.step = i; _npFac.gate = 'talk';
                    npFacadePaint(document.getElementById('notePublishContent')); }''', i)
                page.wait_for_timeout(400)
                snap(page, 'intro-' + name + '.png')
            page.evaluate('''async (id) => { window.switchMainTab('noteFacade', await npArFindById(id)); }''', r['ids']['deal'])
            page.wait_for_timeout(500)
            for i, name in enumerate(['1-补底料', '2-挑稿', '3-改稿', '4-预览', '5-收口置顶']):
                page.evaluate('''(i) => { _npFac.step = i; npFacadePaint(document.getElementById('notePublishContent')); }''', i)
                page.wait_for_timeout(300)
                snap(page, 'deal-' + name + '.png')
            gnext = page.evaluate(GATENEXT)
            snap(page, 'archive.png')
            br.close()
        if errs:
            bad('页面报错 %d 条：%s' % (len(errs), errs[0][:200]))

        li = r['landIntro']
        if li['shell'] and li['mode'] == 'facade' and li['wizNull']:
            ok('门面那两颗卡落进的是门面这条流（台上模式＝facade，写稿向导那份状态 npS() 在这页认不到——不借它一站）')
        else:
            bad('门面页没起来或串到向导上：%s' % li)
        want_i = ['补底料', '挑稿', '改稿', '选出口', '封面&字幕', '收口置顶']
        if li['steps'] == want_i and li['dots'] == 1:
            ok('介绍篇步进条六站：补底料 → 挑稿 → 改稿 → 选出口 → 封面&字幕 → 收口置顶（「配图」那站没了）')
        else:
            bad('六站条不对：%s' % li['steps'])
        if '🪟 门面笔记 · 个人介绍' in li['head'] and '② 挑稿' in li['headTip'] and '⑤ 封面&字幕' in li['headTip'] \
                and '提纲钉死' not in li['headTip'].split('承接')[0] and li['headNoDesc']:
            ok('页头：问号气泡六件事一件不落、分段跟着挑的版式走；标题底下的用途／交付那行说明已撤掉')
        else:
            bad('页头不对：%r / %r' % (li['head'], li['headTip'][:70]))

        s1 = r['step1']
        if s1['rows'] == 7 and s1['brought'] == 2 and s1['empty'] == 5 and s1['noInvent'] and s1['noGen'] \
                and s1['styleCards'] == 0 and '去挑稿' in s1['nextLabel']:
            ok('站① 补底料：七问摊开（2 问「已带到」、5 问「这条空着」），这一站不出稿——那颗钮是「✓ 底料够了 → 去挑稿」，版式卡一张都没摆')
        else:
            bad('站① 不对：%s' % s1)

        p0 = r['pick0']
        if p0['step'] == 1 and p0['cards'] == 5 and p0['defCards'] == 1 and p0['onlyLook'] and p0['hint'] and p0['none'] \
                and p0['versPill'] and p0['verCur'] == -1 and p0['navOff'] and '先在下面点中一版' in p0['navLabel'] \
                and p0['noOutBtn'] and p0['sents'] == 0 and p0['notPicked'] \
                and p0['brief'] and p0['noStruct'] and p0['maxH'] <= 110 \
                and p0['secs'] == 4 and p0['secDefault'] == 45 and p0['secTarget']:
            ok('站② 挑稿（介绍篇）：五张版式卡一行摆开、每张只留「一句短说明」（给 AI 的分段长指令不再摊在卡上，卡最高 %.0fpx）；'
               '写明「点了立刻出一版」「这一站只挑分法、不改句子」；顶上那栏「这条片讲多久」（30/45/60/90 秒，默认 45 秒＝按 207 字左右出稿）；'
               '没出过版时那一摞写着「0 版」、前进钮灰着' % p0['maxH'])
        else:
            bad('挑稿站空态不对：%s' % p0)
        ps = r['pickSec60']
        if ps['sec'] == 60 and ps['target'] and ps['warn'] and ps['back'] == 45:
            ok('秒数换成 60：字数目标跟着变 276 字，并提示「自己念这一档上限 250 字，到时候得砍」；切回 45 秒复原')
        else:
            bad('秒数选择不对：%s' % ps)
        gd = r['guard']
        if gd['blocked'] and gd['back'] and gd['asked'] == 0 and gd['vers'] == 0 and gd['step'] == 1:
            ok('「一单真事」在凭据格空着时：点卡只在卡上标「要用底料第 6 格，那格还空着」、给一句「点步进条回① 补一句再出一版」，一发请求都不发')
        else:
            bad('凭据守卫不对：%s' % gd)

        v1 = r['v1']
        if v1['action'] == 'genFacadeNote' and v1['kind'] == 'intro' and v1['outline'] == 6 and v1['first'] == '我是谁' \
                and v1['qCount'] == 7 and v1['seed3'] and v1['seed6'] and v1['seed7'] and v1['styKey'] == 'duibi' \
                and '很多建材店' in str(v1['styDemo']) and (v1['styLeadLen'] or 0) > 20 and '分四到五段' in str(v1['styStruct']) \
                and v1['noPrev'] and v1['noTitle'] and v1['fresh'] and v1['noAsk'] and v1['vers'] == 1 and v1['verCur'] == 0 \
                and v1['sents'] == 0 and v1['cards'] == 1 and v1['v0Sents'] == 8 \
                and v1['onCard'] and v1['usingPill'] and v1['oneLine'] \
                and v1['sec'] == 45 and v1['chars'] == 207 and v1['noBtn'] \
                and v1['bodyRows'] == 8 and v1['bodyAll']:
            ok('点一张卡＝按那一版出一版：送出去的是六件事＋七格底料＋版式＋「45 秒／207 字」，上一版什么都不带（fresh）；'
               '回来的 8 句收进「出过的版」那一摞——每张卡把这一版正文整篇摊开（8 段一句不删），标题、句数／字数／秒数照留，卡内没有按钮')
        else:
            bad('点卡出一版不对：%s' % v1)
        v2, v3 = r['v2'], r['v3']
        if v2['vers'] == 2 and v2['verCur'] == 1 and v2['sents'] == 0 and v2['v1Sents'] == 5 and v2['cards'] == 2 \
                and v2['styKey'] == 'wenda' and v2['fresh'] and v2['noPrev'] and v2['noTitle'] \
                and v2['useOn'] and v2['useOther'] and v2['pill']:
            ok('换一张卡再出＝第 2 版从素材另起（不带上一版正文、不带旧标题），新出这版标「就用这版」，旧那版写「点这张选它」，整张卡都能点')
        else:
            bad('第二版不对：%s' % v2)
        if v3['vers'] == 3 and v3['verCur'] == 2 and v3['sents'] == 0 and v3['v2Sents'] == 8 \
                and v3['styKey'] == 'wenda' and v3['fresh'] and v3['noPrev'] and v3['noTitle'] and v3['noAsk'] \
                and v3['asked'] == 1 and v3['styles'] == ['duibi', 'wenda', 'wenda']:
            ok('同一张卡再点一次＝同版式另开一版：上一版的句子与标题一个字都没喂，回来的第 3 版并排在底下——出过的三版分法记着 对比型／问答型／问答型')
        else:
            bad('同卡另开一版不对：%s' % v3)
        if v3['simVer'] == 1 and v3['simExact'] == 7 and (v3['simPct'] or 0) >= 80 and v3['hint'] \
                and v3['reroll'] and v3['simok'] and v3['toast']:
            ok('两版撞句只提示、不自动重出：第 3 版跟第 1 版有 7 句一字不差（占 %s%%），摊一句「只提示，不拦你用」＋「↻ 再出一版」「知道，就用这版」' % v3['simPct'])
        else:
            bad('撞句提示不对：%s' % v3)
        if r['simOk']['warnGone'] and r['simOk']['hintGone']:
            ok('点「知道，就用这版」：提示就地收起，这一版照用，不重出、不丢版')
        else:
            bad('收起撞句提示不对：%s' % r['simOk'])
        nv = r['noVer']
        if nv['navOff'] and nv['step'] == 1 and nv['err']:
            ok('没点中一版时：那颗钮灰着（%r），硬走前进只给一句「还没点中一版——上面点一张版式卡就出一版」，不跳站' % nv['navLabel'])
        else:
            bad('挑稿站的守卫不对：%s' % nv)
        sel = r['pickSel']
        if sel['step'] == 1 and sel['verCur'] == 0 and sel['style'] == 'duibi' and sel['on']:
            ok('点整张版卡＝只选中并标「就用这版」，人还停在②挑稿；要往下走仍点底下那颗钮')
        else:
            bad('点卡选中不对：%s' % sel)
        uv = r['usever']
        if uv['step'] == 2 and uv['style'] == 'duibi' and uv['rows'] == 8 and uv['flat'] and uv['rvPrevNull']:
            ok('再点「就用这一版 → 去改稿」才进③：那一段摊回台上（8 句、一句一条），版式跟着那一版走')
        else:
            bad('就用这一版不对：%s' % uv)

        rv = r['revise']
        if rv['step'] == 2 and rv['cards'] == 0 and rv['noStyleBar'] and rv['rows'] == 8 and rv['oneLine'] \
                and rv['noLock'] and rv['segHead'] == 0 and rv['wantStyle'] and rv['cntPill'] and '选出口' in rv['navLabel']:
            ok('站③ 改稿不再摆版式卡：正文就是一句一行 8 行（无「段N」方框、无 🔒），旁边写明「想换分法回 ② 挑稿」，那颗钮「改好了 → 选出口」')
        else:
            bad('改稿站不对：%s' % rv)
        ae = r['askEmpty']
        if ae['blocked'] and ae['asked'] == 0:
            ok('蓝框空着一句都不写：点「🖊 AI 改整篇」被拦、提示「先说一句想怎么改」，不发请求')
        else:
            bad('空评价拦截不对：%s' % ae)
        if r['chipFilled'] and '再短一点' in r['chipFilled']:
            ok('常用改法那颗一点就进输入框（还能自己改字）')
        else:
            bad('常用改法那颗不对：%s' % r['chipFilled'])
        ag = r['askGo']
        if ag['action'] == 'genFacadeNote' and ag['ask'] == '第三句太绕，短一半' and ag['styKey'] == 'duibi' \
                and ag['prevHasD0'] and ag['asked'] == 1 and ag['step'] == 2 and ag['vers'] == 3 \
                and '按你说的那句重排了' in str(ag['first']):
            ok('说一句改整篇那发：评价＋当前整篇（prev）＋版式一起送出去，改完还站③——且不占挑稿那一摞（仍是 3 版）')
        else:
            bad('改整篇那发不对：%s' % ag)
        ud = r['undo']
        if ud['first'] == INTRO_D[0] and ud['hidden'] and ud['msg'] and ud['rows'] == 8 and ud['step'] == 2:
            ok('↩ 改回上一版：退回改整篇之前的那一版（8 句、第一句回到原句），钮收回、给一句「已改回上一版」')
        else:
            bad('改回上一版不对：%s' % ud)
        tn = r['titleNext']
        if tn['need'] == 'title' and tn['asked'] == 1 and tn['title'] == '换一条的标题桩' and tn.get('bodySent') is None \
                and tn['rows'] == 8:
            ok('🔁 换一个标题：只送「换标题」那一发（正文一个字不带，8 句没动），回来的新标题就地换上')
        else:
            bad('换标题那发不对：%s' % tn)
        te = r['titleEdit']
        if te['shown'] and not te['editing'] and te['title'] == '桩师傅在这个城市':
            ok('✏️ 编辑：摊开输入框，点「✅ 就用这条」才落进去、那一栏收回去')
        else:
            bad('标题编辑不对：%s' % te)
        if r['opened']['ask'] and r['opened']['sgo'] and r['opened']['own'] and r['opened']['tmode']:
            ok('点某一句只改那一句：摊出「这句要怎么改」＋🤖 改这句＋✍️ 自己改，右上角还有「✍️ 全文手改」')
        else:
            bad('逐句改没摊开：%s' % r['opened'])
        pd = r['pend']
        if pd['action'] == 'genFacadeSentence' and pd['ask'] == '短一半' and pd['noSeg'] and pd['panel'] \
                and pd['origKept'] and pd['cmp'] and pd['useBtn'] and pd['dropBtn']:
            ok('逐句改走批准制：AI 回来的先摆「原句 → 改后」比一比，没点之前正文一个字不动；介绍篇不再带「这一段叫什么」（段序由版式定）')
        else:
            bad('比一比面板不对：%s' % pd)
        if (not r['dropped']['panel']) and r['dropped']['kept']:
            ok('「不要」：对照收回，正文保持原句')
        else:
            bad('「不要」不对：%s' % r['dropped'])
        rv2 = r['revised']
        if '（改过的那一句）' in rv2['first'] and rv2['saved'] == rv2['first'] and rv2['panelGone'] and rv2['othersUntouched']:
            ok('「✓ 用这版」：才把这一句真换进正文（其余 7 句一字不动），当场存回档案那一格 fSegs（介绍篇存的就是扁平的句清单）')
        else:
            bad('用这版的落点不对：%s' % rv2)
        to, tx, ta_, tu = r['textOpen'], r['textErr'], r['textApplied'], r['textUndo']
        if to['ta'] and to['heads'] == 0 and to['lines'] == 8 and to['blanks'] == 1 and to['keepsSent'] and to['help']:
            ok('✍️ 全文手改（介绍篇）：摊出来 8 行、一行一句，一个【段名】都没有、段间也不空行，旁边写明「一句占一行、空行不算分段」')
        else:
            bad('全文手改没摊成一句一行：%s' % to)
        if tx['blocked'] and tx['stillTextMode']:
            ok('手改栏清空了才拦：「✅ 存好，回逐句」不给过、给一句「正文空了」，人还留在手改栏')
        else:
            bad('全文手改的守卫不对：%s' % tx)
        if ta_['backToSent'] and ta_['first'] == '全文手改的第一句。' and ta_['rows'] == 3 and ta_['segsLen'] == 3 \
                and ta_['everyOne'] and ta_['saved'] == ['全文手改的第一句。', '全文手改的第二句。', '空一行也算另一句。']:
            ok('手改拆回去：空行只是分行、不再当分段——存回台上与档案都是 3 条句子（不再往段里硬塞）')
        else:
            bad('全文手改存回的落点不对：%s' % ta_)
        if tu['first'] == rv2['first'] and tu['step'] == 2:
            ok('全文手改也能「↩ 改回上一版」退回改动前那一版')
        else:
            bad('手改退回不对：%s' % tu)

        g = r['gate']
        if g['cards'] == ['🎙 自己对着镜头念', '📤 发工单（我们照着做片）', '✨ 字效片（接你现有的通路）'] \
                and g['rec'] == 1 and g['reuse'] == 1 and g['noOldGates'] and g['noLipBtn']:
            ok('站④ 选出口：三档齐、只有第一档挂「推荐」、只有字效片那档标「接现有通路，不重做」；「只拍手／图文卡」和多余的交单钮撤干净了')
        else:
            bad('三出口不对：%s' % g)
        if g['tp'] and g['screens'] == 8 and g['copyTp'] and g['selfBtn'] and g['selfNoQuota'] and '下一步：封面' in g['navLabel']:
            ok('出口 ①：提词卡一句一屏（8 句 8 屏）＋「🎥 拿逐句录的链接」，写明不进工单台也不占接单额度；那颗前进钮改成「用这档 → 下一步：封面&字幕」')
        else:
            bad('出口 ① 不对：%s' % g)
        if g['formTalk'] == '真人口播' and g['formOrder'] == '真人口播（我们做片）' and g['formTalkBack'] == '真人口播':
            ok('出口 ①／② 落的形式：真人口播 ／ 真人口播（我们做片），来回改选不落错')
        else:
            bad('出口落的形式不对：%s / %s / %s' % (g['formTalk'], g['formOrder'], g['formTalkBack']))
        if g['orderBtn'] and g['orderThree'] and g['orderNoVoice'] and g['noSelfBtnOnOrder'] \
                and g['navOrderSkip'] and '收口置顶' in g['navOrder']:
            ok('出口 ② 只剩照片这一种料（交三样：正脸照＋稿＋一句想要的音色），并且写明「工单默认跳过封面&字幕」，那颗钮直接「用这档（工单）→ 收口置顶」')
        else:
            bad('出口 ② 不对：%s' % g)
        if g['hasFilmCard'] and g['filmSaysNotInKindRow'] and r['reuseFilmLabel'] == '用这档 → 进字效线' \
                and r['film']['called'] == 1 and r['film']['hasNote'] and r['film']['lines'] == 8:
            ok('出口 ③ 直接跳现有字效线（带整篇稿子＋档号，8 句各一屏），并写明口播的篇不再进「成片形式」那一排：%r' % r['film']['textHead'])
        else:
            bad('出口 ③ 没跳字效线：%s / %s / %s' % (r['reuseFilmLabel'], g.get('filmSaysNotInKindRow'), r['film']))

        nf = r['noFilm']
        if nf['step'] == 4 and nf['head'] and nf['letIn'] and nf['noTake'] and nf['subHead'] and nf['subOff'] \
                and nf['subWhy'] and nf['upcover'] and nf['skip'] and nf['noImgSlot'] and nf['noAnti'] \
                and nf['navOff'] and nf['navLabel'] == '这篇还差封面':
            ok('站⑤（换掉配图的封面&字幕）：本机没这条片时给一句「这条片还没到本机」＋「让进、不拦路」，能传自己的图、能先跳过；'
               '字幕那颗「➕ 加」灰着写明要先有片；配图那三格和「实拍比精修有用」那句撤干净了——但档案那颗钮仍写「这篇还差封面」')
        else:
            bad('没片态不对：%s' % nf)
        fl = r['filmLoad']
        if fl['video'] and fl['seek'] and '片长 3' in fl['durLab'] and 2.5 < fl['dur'] < 3.6 and fl['url'] and not fl['err'] \
                and fl['lays'] == 3 and fl['ct'] and fl['ctBack'] and fl['roll'] and fl['take'] and fl['fixOff'] \
                and fl['subOn'] and fl['noFrame'] and fl['prevHint']:
            ok('读本机那条片（桩放进 IndexedDB 的 3 秒小片）：能播、进度条跟手、片长 3.0 秒；三套版式小样齐、标题那一行带「↩ 用这篇的标题」，'
               '没选帧前「✓ 定这张当封面」灰着，字幕那颗反倒能点（有单有片了）')
        else:
            bad('片子读不进来：%s' % fl)
        ro = r['roll']
        if ro['count'] >= 4 and ro['cards'] == ro['count'] and ro['thumbs'] == ro['count'] and ro['w'] == 750 and ro['h'] == 1000 \
                and ro['picked'] and ro['gap'] >= 0.5 and ro['chosen'] and ro['clr'] and ro['fixOn']:
            ok('🎲 随机给 5 帧：一次抓到 %d 帧（每帧都有缩略图、真画布 750×1000），彼此至少隔 %s 秒、第一帧自动选中，那颗「✓ 定这张当封面」活了'
               % (ro['count'], round(ro['gap'], 2)))
        else:
            bad('随机取帧不对：%s' % ro)
        tk = r['take']
        if abs((tk['t'] or 0) - 1.4) < 0.15 and tk['frameT'] == tk['t'] and tk['pill'] and tk['now'] == '1.4s' \
                and not tk['coverYet']:
            ok('拖进度条到 1.4 秒 →「取现在这一帧」：那一帧进候选并选中（还没定封面）')
        else:
            bad('取现在这一帧不对：%s' % tk)
        if r['lay']['lay'] == 'side' and r['cTitle'] == '先看活再谈价':
            ok('挑版式（左上竖排）＋就地写封面标题：只写进封面那一格，本篇标题不动')
        else:
            bad('版式/封面标题不对：%s / %s' % (r['lay'], r['cTitle']))
        fx = r['fixed']
        if str(fx['name']).startswith('封面·左上竖排·1.4s') and fx['url'] == 'idb:cover:' + r['ids']['intro'] \
                and fx['lay'] == 'side' and fx['cTitle'] == '先看活再谈价' and fx['at'] == 1.4 and fx['thumb'] \
                and fx['storeSize'] > 1000 and fx['noteCover'] == fx['name'] and fx['has'] \
                and '✓ 封面定了' in fx['navLabel'] and not fx['navOff'] and fx['nowLine']:
            ok('✓ 定这张当封面：按版式合成整张（750×1000 那格）存进本机 cover:<篇id>（%d 字节），档案那一格只留名字＋缩略图引用；'
               '那颗钮当场变「✓ 封面定了 → 收口置顶」' % fx['storeSize'])
        else:
            bad('定封面不对：%s' % fx)
        cl = r['cleared']
        if cl['gone'] and cl['storeGone'] and cl['noteCover'] in (None, '') and cl['navOff'] and cl['navLabel'] == '这篇还差封面':
            ok('撤掉这张：本机那份封面图跟着删、档案那格清空，那颗钮又回去拦「这篇还差封面」')
        else:
            bad('撤封面不对：%s' % cl)
        oi, oc = r['ownImg'], r['ownCover']
        if oi['frames'] == 1 and oi['lab'] == '自己的图' and oi['frameT'] == 0 and oi['thumb'] \
                and oc['name'] == '封面·大字压中·自己的图' and oc['at'] == 0 and oc['lay'] == 'big' and oc['store']:
            ok('传一张自己的图当封面来源：只出一帧标「自己的图」（秒数记 0），照样挑版式加标题——定下来叫「封面·大字压中·自己的图」')
        else:
            bad('自己的图那条不对：%s / %s' % (oi, oc))
        sf = r['subFailSend']
        if sf['state'] == 'fail' and sf['msg'] and sf['retry'] and sf.get('path') == '/api/lip/sub' and sf['note'] == 'fail':
            ok('字幕送不出去时不装成在排队：这一站给一句「加字幕没送出去：云端这一条没接上」＋🔁 再试一次，档案记 fail')
        else:
            bad('送出失败那支不对：%s' % sf)
        sq = r['subQueue']
        if sq['state'] == 'queue' and sq['path'] == '/api/lip/sub' and sq['sents'] == 8 and sq['id'] == 'lip_check0' \
                and sq['tok'] and sq['jobAt'] and sq['timerOn'] and sq['zone'] and sq['askBtn'] and sq['note'] == 'queue':
            ok('➕ 给这条片加字幕：送的是「这张单的号＋凭据＋这一篇 8 句」，档案记 queue，站上写着「云端在排这一条（一次只烧一条）」，开着这站自动每 8 秒问进度')
        else:
            bad('排队那发不对：%s' % sq)
        if sq['first'] == '（改过的那一句）' or '（改过的那一句）' in str(sq['first']):
            ok('烧进去的字就是这篇稿子里那几句（含刚在③ 改过的那一句），不是另写一套')
        else:
            bad('字幕句子来源不对：%s' % sq['first'])
        if r['subStillQueue']['state'] == 'queue' and r['subStillQueue']['asked'] >= 1:
            ok('「↻ 现在就问一次」：云端还回排队，就还站在这条话上，不假装烧好了')
        else:
            bad('手动问一次不对：%s' % r['subStillQueue'])
        sd = r['subDone']
        if sd['state'] == 'done' and sd['head'] and sd['takes'] == 1 and sd['timerOff'] and sd['revertBtn'] \
                and sd['noAdd'] and sd['note'] == 'done':
            ok('云端回「烧好了」：给一句「加了字幕的那条片顶掉了原来那条（旧的在云端还留 7 天）」、自动去取那条新片（npLipTake 走了一次）、轮询停下来、'
               '取帧那几格清掉等新的片回来，并且摆上「↩ 不要了，回上一版」')
        else:
            bad('烧好那态不对：%s' % sd)
        sr = r['subRevert']
        if sr['path'] == '/api/lip/sub_revert' and sr['state'] == '' and sr['takes'] == 1 and sr['addBack'] and sr['skipBack'] \
                and sr['note'] == '':
            ok('↩ 不要了，回上一版：叫云端换回没烧字幕的那条、再取一次回本机，两颗钮回到原位')
        else:
            bad('回上一版不对：%s' % sr)
        sc = r['subCloudFail']
        if sc['state'] == 'fail' and sc['msg'] and '🔁' in str(sc['retry']) and sc['note'] == 'fail':
            ok('云端回「没烧成」：把那句人话原样摊出来（料还在、原片一个字没动）＋🔁 再试一次')
        else:
            bad('云端失败那态不对：%s' % sc)
        sk, su = r['subSkip'], r['subUndo']
        if sk['state'] == 'skip' and sk['line'] and sk['undoBtn'] and not sk['navOff']:
            ok('「不用加」＝不拦路：写明「已定：不加字幕——不拦路，直接收口」，那颗前进钮照样能点（字幕从来不看画面猜）')
        else:
            bad('不用加不对：%s' % sk)
        if su['state'] == '' and su['addBack'] and su['skipBack']:
            ok('「改主意：要加」把两颗钮摆回来，档案那一格跟着清空')
        else:
            bad('字幕改主意不对：%s' % su)

        d = r['done']
        if d['step'] == 5 and d['title'] and d['textHas'] and d['copyAll'] and d['copyTp'] and d['todate'] \
                and d['noBio'] and d['noPinSteps'] and d['noOldLines'] and d['pinHint'] and d['noBarNav'] and d['screens'] == 8:
            ok('站⑥ 收口只摆这一篇（标题＋正文）和复制／挑位子两颗钮；出口／封面／字幕／简介几行／置顶三步都撤了，只留一句「发完去主页置顶」')
        else:
            bad('收口不对：%s' % d)

        sv = r['saved']
        if sv['pinned'] and sv['gate'] == 'talk' and sv['form'] == '真人口播' and sv['dir'] == 'f' and sv['fkind'] == 'intro' \
                and sv['seedLen'] == 7 and sv['segsOneRow'] and len(sv['segs']) == 8 and sv['style'] == 'duibi' \
                and sv['title'] == '桩师傅在这个城市' and sv['vers'] == 3 and sv['versStyles'] == ['duibi', 'wenda', 'wenda'] \
                and sv['cover'].startswith('封面·大字压中·自己的图') and sv['sub'] == 'skip' and sv['imgs'] == 0 \
                and sv['fstep'] == 5 and sv['draftHas'] and sv['bar']:
            ok('这一趟存的落点：底料 7 格／正文按句存成扁平 8 条／挑稿那 3 版全留着（各版自己的句数与版式）／封面只存名字＋缩略图引用／字幕记 skip／形式「真人口播」／wip 停在收口，横幅立刻标「✓ 已置顶」')
        else:
            bad('门面这条流的存档不对：%s' % sv)

        de = r['deal']
        if de['steps'] == ['补底料', '挑稿', '改稿', '👀 预览', '收口置顶'] and de['rows'] == 5 and de['noGateCards'] \
                and de['form'] == '长文' and de['brought'] == 1 and de['styleCards'] == 0 and '照提纲出稿' in de['outLabel'] \
                and de['none'] and de['navOff'] and de['navLabel'] == '先在下面点中一版 →':
            ok('承接篇站序：补底料 → 挑稿 → 改稿 → 👀 预览 → 收口置顶。挑稿这一站没有版式卡（那五种是介绍篇的），摆的是「📄 照提纲出稿」；'
               '没出稿前那颗钮也灰着叫「先在下面点中一版 →」')
        else:
            bad('承接篇站序不对：%s' % de)
        if de['noVerErr'] and de['v1']['vers'] == 1 and de['v1']['heads'] == 1 and de['v1']['segShape'] == [5] \
                and de['v1']['v0Sents'] == 8 and '再出一版' in de['v1']['outLabel'] and de['v2']['vers'] == 2 \
                and de['v2']['cards'] == 2 and de['v2']['verCur'] == 1 and de['v2']['styles'] == ['', ''] \
                and de['v2']['labels'] == ['第 1 版', '第 2 版'] and de['v2']['lock'] and de['pickStep'] == 1 \
                and de['v1']['bodyRows'] == 5 and de['v1']['bodyAll']:
            ok('承接篇挑稿：出两版并排比一比（一张提纲填五段＝8 句），每张卡把五段正文带段名整篇摊开（一句不删），第二张卡写着「第 2 版 · 提纲钉死」，'
               '出完那颗钮自动改口「↻ 再出一版」，底下写明「🔒 段名一字不许改」；点卡只选中、不跳站')
        else:
            bad('承接篇挑稿不对：%s' % de)
        dv = de['revise']
        if dv['step'] == 2 and dv['cards'] == 0 and dv['noStyleBar'] and dv['chips'] == 5 and dv['rvgo'] and dv['tnext'] \
                and dv['rows'] == 8 and dv['segHeads'] == 5 and dv['keepsLock'] == 5 and dv['pinnedBar'] and '预览' in dv['navLabel']:
            ok('承接篇改稿站仍是钉死那五段：五个「段N · 段名」方框＋5 个「🔒 提纲钉死」、正文那栏写「🔒 段名钉死，AI 不挪段」，就是没有版式那栏；那颗钮「改好了 → 看一眼预览」')
        else:
            bad('承接篇改稿站不对：%s' % dv)
        da = de['ask']
        if da['action'] == 'genFacadeNote' and da['kind'] == 'deal' and da['ask'] == '说得更白一点' \
                and da['noStyle'] and da['asked'] == 1 and da['step'] == 2:
            ok('承接篇「AI 改整篇」照送：kind=deal、一句评价带上、不带版式，改完还站③')
        else:
            bad('承接篇改整篇那发不对：%s' % da)
        if de['afterUndo']['first'] == DEAL_SEGS[0][0]:
            ok('承接篇也能「↩ 改回上一版」：退回改整篇之前的那一版')
        else:
            bad('承接篇退回不对：%s' % de['afterUndo'])
        dt = de['textOpen']
        if dt['ta'] and dt['heads'] == 5 and dt['first'] and dt['help']:
            ok('承接篇的全文手改仍是老规矩：五个【段名】头行都在，旁边写明「按段名拆回去」')
        else:
            bad('承接篇手改栏不对：%s' % dt)
        dte = de['textErr']
        if dte['blocked'] and dte['stillTextMode']:
            ok('承接篇手改少了一个【段名】：「✅ 存好，回逐句」被拦、给一句「有一句落在所有段外面」，人留在手改栏（介绍篇那种按空行放开的写法不管这一篇）')
        else:
            bad('承接篇手改守卫不对：%s' % dte)
        if de['textDropped']['back'] and de['textDropped']['first'] == DEAL_SEGS[0][0]:
            ok('「不要这版手改，原样回逐句」：回逐句视图、正文一个字没动')
        else:
            bad('承接篇手改放弃不对：%s' % de['textDropped'])
        dp = de['prev']
        if dp['step'] == 3 and dp['head'] and dp['longPub'] and dp['copyAll'] and dp['back'] and '收口置顶' in dp['navLabel']:
            ok('承接篇多出来的「👀 预览」那一站：宽屏看稿＋复制整篇＋「← 回改」，那颗钮「看完了 → 收口置顶」')
        else:
            bad('承接篇预览站不对：%s' % dp)
        dn = de['done']
        if dn['step'] == 4 and dn['title'] and dn['textHas'] and not dn['sentLine'] and dn['noCoverLine'] and dn['noSubLine'] \
                and dn['uploads'] == 0 and dn['noGateCards'] and dn['noImgLine'] and dn['copyAll'] and dn['todate'] \
                and not dn['copyTp']:
            ok('承接篇收口站：只摆这一篇（标题＋正文）＋复制／挑位子；正文句数、封面&字幕、提词卡都不再出现')
        else:
            bad('承接篇收口站不对：%s' % dn)
        svd = de['saved']
        if svd['form'] == '长文' and svd['segsLen'] == 5 and svd['nested'] and svd['longLen'] > 20 \
                and svd['cover'] in (None, '') and svd['sub'] == '' and svd['vers'] == 2 and svd['next'] == '👀 预览':
            ok('承接篇存回档案：形式「长文」＋五段照段序存（段里套句）＋整篇落进长文稿；封面／字幕两格留空，档案那颗钮认它齐了')
        else:
            bad('承接篇存档不对：%s' % svd)

        if all(gnext[k]['stored'] == k for k in ['talk', 'order', 'film']) \
                and gnext['talk']['next'] == '🎥 拿逐句录的链接' and gnext['talk']['form'] == '真人口播' \
                and gnext['order']['next'] == '📤 交这张单' \
                and gnext['film']['next'] == '✨ 进字效出片' and gnext['film']['form'] == '视频':
            ok('三档出口存的都是档案那一格 fGate，档案那颗「下一步」各自指对：拿逐句录的链接 / 交这张单 / 进字效出片')
        else:
            bad('档案下一步与出口没对上：%s' % gnext)
        if '这篇还差封面' in str(gnext['talk']['noCoverTip']) and gnext['talk']['noCover'] == '✏️ 编辑' \
                and gnext['talk']['noCoverTo'] == 'facade' and gnext['order']['noCover'] == '📤 交这张单':
            ok('封面这一格没定：介绍篇那颗钮先拦「这篇还差封面」（指回门面这条流），但工单出口那条默认跳过、照旧直接给「📤 交这张单」')
        else:
            bad('没封面的拦法不对：%s / %s' % (gnext['talk'], gnext['order']))
        if gnext['talk']['noGate'] == '✏️ 编辑' and '还差选出口' in str(gnext['talk']['noGateTip']):
            ok('还没选出口时那句排在封面之前（先选出口再谈封面）')
        else:
            bad('没选出口那支不对：%s' % gnext['talk'])
        lg, lg2 = gnext['talk']['legacy'], gnext['talk']['legacyNoCov']
        if lg.get('lab') == '✏️ 编辑' and '这篇还差封面' in str(lg.get('tip') or '') \
                and lg2.get('lab') == '✏️ 编辑' and '还差选出口' in str(lg2.get('tip') or ''):
            ok('老篇存过「只拍手／图文卡」这种旧出口值：不清洗数据、不报错——没封面先指回 ⑤，有封面就退回「这篇还差选出口」回去重选')
        else:
            bad('旧出口值没兜住：%s / %s' % (lg, lg2))

        f5 = r['fail']
        if f5['msg'] and f5['vers0'] == 0 and f5['stillPick'] and f5['again'] and f5['stillPick2'] \
                and f5['vers'] == 0 and f5['verCur'] == -1 \
                and f5['cards'] == 5 and f5['noSent'] == 0 and f5['asked'] == 2 and f5['seedsKept']:
            ok('AI 那支没接上时：挑稿这一站先把后台那句人话原样摊出来、留在 ② 不崩；再点一次给「稿子没出来——再点一次上面那张版式卡；还不行就回① 补两句底料」，'
               '五张卡与底料都留着、那一摞版还是空的')
        else:
            bad('出稿失败的落点不对：%s' % f5)

        u6 = r['up6']
        ug = u6['gate']
        if ug['step'] == 3 and ug['btn'] and ug['mode'] == 'f' and ug['say']:
            ok('出口① 那张卡上多一颗「⬆ 传整条视频」：收 mp4 / mov / webm / mkv，最长 3 分钟、最大 200MB，先存本机、点加字幕才上云')
        else:
            bad('出口卡的传片入口不对：%s' % ug)
        ul = u6['load']
        if ul['step'] == 4 and ul['name'] == 'film3s.webm' and 2.5 < ul['dur'] < 3.6 and ul['size'] > 1000 \
                and ul['src'] == 'upload' and ul['dbSize'] == ul['size'] and ul['noteFilm'] == ul['name'] and ul['noteAt'] \
                and ul['filmCard'] and ul['video'] and ul['url'] and 2.5 < ul['cvDur'] < 3.6 and '整条片收好了' in ul['toast']:
            ok('传一条真片：只落本机（film:<篇id> 与档案 fFilm 同名同字节，%d 字节 / 3.0 秒），人自动进⑤ 封面&字幕；'
               '这一站就地能播、标明「你自己录好传上来的那条」' % ul['size'])
        else:
            bad('传整条片的落点不对：%s' % ul)
        us = u6['sub']
        if us['say'] and us['warn'] and us['addOn'] and not us['credUp']:
            ok('字幕按「传上来的那条」走：写明云端收一份副本（≤100MB）、字按这篇稿子一句一行平均分；'
               '片 3 秒而稿子念下来差太多时给「两边差得多」的提醒；这张单还没建，加字幕那颗照样能点')
        else:
            bad('上传片的字幕说明不对：%s' % us)
        ub, uL = u6['big'], u6['long']
        if ub['off'] and ub['why'] and uL['off'] and uL['why']:
            ok('两道硬线都在：片超过 100MB（云端收不下）、稿子超过 900 字——「➕ 给这条片加字幕」灰着，并各给一句人话')
        else:
            bad('上传片的字幕门槛不对：%s / %s' % (ub, uL))
        uq = u6['queue']
        if uq['state'] == 'queue' and uq['submitRoute'] == 'selfup' and uq['submitNote'] == r['ids']['up'] \
                and uq['putId'] == 'lip_up0' and uq['putSize'] == ul['size'] \
                and uq['subId'] == 'lip_up0' and uq['subT'] == 'tkup' and uq['sents'] == 8 \
                and uq['jobRoute'] == 'selfup' and uq['upDone'] and uq['zone'] and uq['noteSub'] == 'queue' \
                and '整条片送完了' in uq['toast']:
            ok('➕ 加字幕：先现建一张 selfup 单（route=selfup、挂这篇号），整条片原样上传（%d 字节），再送这篇 8 句——'
               '站上转「云端在排这一条」，档案记 queue；这张单不进工单台、不占额度' % uq['putSize'])
        else:
            bad('上传片加字幕那一发不对：%s' % uq)
        ud = u6['done']
        if ud['state'] == 'done' and ud['takes'] == 1 and ud['head'] and ud['revert'] and ud['noteSub'] == 'done':
            ok('烧好了：新的那条自动取回本机（npLipTake 走了一次），摊「顶掉了原来那条（旧的在云端还留 7 天）」＋「↩ 不要了，回上一版」')
        else:
            bad('上传片烧好那态不对：%s' % ud)
        ur = u6['revert']
        if ur['state'] == '' and ur['takes'] == 1 and ur['route'] == 'selfup' and ur['upDone'] and ur['addBack'] and ur['noteSub'] == '':
            ok('↩ 回上一版：叫云端换回没烧字幕的那条、再取回本机；那张 selfup 单留着并记「片子已传过」，档案回空')
        else:
            bad('上传片回上一版不对：%s' % ur)
        if u6['reuse']['state'] == 'queue' and u6['reuse']['put'] == 0:
            ok('回上一版后再点「加字幕」：不再重传整条片（那次上传记着），只把 8 句送云端重新烧')
        else:
            bad('第二次加字幕又重传了片：%s' % u6['reuse'])
        uk = u6['know']
        if uk['card'] and uk['mode'] == 'k' and uk['say'] and uk['selfBox']:
            ok('口播稿线那张出口卡是同一张：也有「② 已经录好了整条视频（直接传）」，逐句录那条路照样并在上面')
        else:
            bad('口播稿线的传片入口不对：%s' % uk)
        ukl = uk['landed']
        if ukl['film'] == 'film3s.webm' and ukl['db'] > 1000 and ukl['gate'] == 'talk' and ukl['form'] == '口播稿' \
                and ukl['voice'].startswith('知识线这篇') and ukl['next'] == '🎬 成片预览' and ukl['to'] == 'preview' \
                and ukl['tab'] == 'noteArchive':
            ok('口播稿线传完整条片：当场落档标「代发」、记下出口是「自己念」，回档案——那颗下一步直接变「🎬 成片预览」')
        else:
            bad('口播稿线传片后的档案不对：%s' % ukl)
    finally:
        srv.terminate()
        logf.close()
    print('── 结果：%s ──' % ('全过' if not fails else '%d 条没过' % fails), flush=True)
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
