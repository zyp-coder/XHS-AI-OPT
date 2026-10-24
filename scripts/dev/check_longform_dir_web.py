# 📝 长文回挂两条线（2026-10-21 老板定稿）—— 公网那份 web/ 的浏览器实点。
# 这单的口径（需求档案：资料/发笔记-长文回挂知识与引流-确认单.md）：
#   知识长文＝挑知识 → 改稿 → 📝 出长文 → 👀 预览 → ✓ 存好；腔由入口定死＝🔬 科普腔、600~1200 字
#   引流长文＝挑稿（📄 出几版 / 讲故事型＝AI 编故事）→ 改稿 → 📝 出长文 → 👀 预览 → ✓ 存好；腔＝🗣 人设腔、800~1500 字
#   不再有底子屏 / 选腔 / 独立 dir='l' 入口；档案「📝 改出长文」与老 dir='l' 四屏一行不改。
# 这一支查这些事：
#   1 新建弹层：知识 4 张（含长文）、引流 2 张（含长文），没有独立「📝 长文」一行；两张卡各带自己的腔与字数
#   2 点卡建篇：知识 → dir=k／kOut=text；引流 → dir=d／dOut=long；都不再写 dir='l'／lTone，落到各自第一站
#   3 知识长文站：停在⑤ 出长文，固定科普腔、无选腔控件、进站不自动写；长文空着不许下一步
#   4 出长文：点了才调 AI（桩），payload 带 line=k、content=短稿、prev=''；出稿铺进可改的框，longSrc=短稿
#   5 同一短稿「再出一版」：先收框里手改，再拿它当 prev；短稿改过 → 旧版提示＋「重新出长文」，prev 空着
#   6 预览：形式 / 腔调 / 字数 / 发布 / 承接 / 状态全套；空长文点存好被拦
#   7 收口：档案标「代发」、稿子＝长文（预览也拿长文，不摆短稿）、下一步＝预览；行上不再摆「改出长文」
#   8 引流长文：同一条路，腔＝人设腔、800~1500；讲故事型第一站是「AI 编故事」
#   9 老 dir='l' 四屏原样能开；档案「📝 改出长文」仍按老桥接进 dir='l'、不另开一篇
# 本机：node 起一台只用临时账本的服务器（DEMO_DATA_DIR 指 tmp/，绝不碰 server/data/）。
# AI 全程走桩：只截 genNoteLongform，别的照原样走本机服务器。
# 用法：python3 -X utf8 scripts/dev/check_longform_dir_web.py
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
TAG = 'longform-dir-check'
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
TOPIC = '猫绝育前要不要空腹'
SEED = ('昨天有猫主人在群里问，绝育前要不要饿肚子。\n\n'
        '医生给的说法是术前八小时禁食，水不用收。\n\n'
        '各家情况不一样，先把体检单带上再确认一遍。')
SEED2 = ('【短稿改过这一版】昨天有猫主人在群里问，绝育前要不要饿肚子。\n\n'
         '医生给的说法是术前八小时禁食，水不用收——这条别再自己加时长。\n\n'
         '各家情况不一样，先把体检单带上再确认一遍。')
S1 = ('【第 1 版】开头一句先把人钉住。\n\n'
      '一、要不要饿肚子\n术前八小时禁食，水不用收——多数医生这么说。\n\n'
      '二、要带什么\n把之前的体检单找出来带上，麻醉那一关它要看。\n\n'
      '三、回来怎么照看\n头圈那几天别心软摘掉，伤口两天看一眼。\n\n'
      '最后：各家情况不一样，先跟你的医生确认一遍。')
S2 = ('【第 2 版】换个说法开头。\n\n'
      '一、术前吃不吃\n八小时禁食这条别再自己加时长。\n\n'
      '二、单据别忘\n体检单、疫苗本一次带齐。\n\n'
      '三、术后三天\n头圈摘了容易舔开口，忍两天。\n\n'
      '各家情况不一样，先跟医生确认。')
S3 = ('【第 3 版】按改过的短稿重排。\n\n'
      '一、术前八小时\n禁食这条别再自己加时长，水不用收。\n\n'
      '二、体检单\n一次带齐，麻醉那一关它要看。\n\n'
      '三、回家以后\n头圈别心软摘，伤口两天看一眼。\n\n'
      '各家情况不一样，先跟你的医生确认。')
EDITED = ('【手改过的一版】开头照钉人。\n\n'
          '第一段手改：八小时禁食这条别再自己加时长。\n\n'
          '第二段手改：体检单带上。\n\n'
          '各家情况不一样，先跟医生确认。')

PRE = r'''() => {
  const H = {};
  H.sleep = (ms) => new Promise(s => setTimeout(s, ms));
  H.one = (s) => document.querySelector(s);
  H.all = (s) => [...document.querySelectorAll(s)];
  H.txt = (s) => { const e = H.one(s); return e ? String(e.textContent || '').trim() : ''; };
  H.vis = (sel) => { const e = H.one(sel); return !!e && e.getClientRects().length > 0; };
  H.body = () => String((H.one('#npWizBody') || {}).textContent || '');
  H.flat = () => H.body().replace(/\s+/g, '');
  H.toast = () => String((H.one('#popToastBox') || {}).textContent || '');
  H.clearToast = () => { const e = H.one('#popToastBox'); if (e) e.innerHTML = ''; };
  H.ready = async (fn, ms) => { const t0 = Date.now();
    while (Date.now() - t0 < (ms || 12000)) { try { if (fn()) return true; } catch (e) {} await H.sleep(120); } return false; };
  H.click = async (sel, ms) => { const e = H.one(sel); if (!e) { (window.__lfMiss || (window.__lfMiss = [])).push(sel); return false; }
    e.click(); await H.sleep(ms || 500); return true; };
  H.val = (sel, v) => { const e = H.one(sel); if (!e) return false; e.value = String(v); return true; };
  H.nextOf = (n) => { const x = npArNext(n) || {}; return { lab: String(x.lab || ''), tip: String(x.tip || ''), to: String(x.to || '') }; };
  H.bar = () => String((H.one('#npSteps') || {}).textContent || '').replace(/\s+/g, ' ').trim();
  H.note = async (id) => await npArFindById(id);
  H.seedNote = async (n) => { await npNotesSync(async () => {
      const list = await npNotesAll();
      const i = list.findIndex(x => x && String(x.id) === String(n.id));
      if (i >= 0) list[i] = Object.assign({}, list[i], n); else list.unshift(n);
      try { await chrome.storage.local.set({ [NP_NOTES_KEY]: list }); } catch (e) {}
    }); return await npArFindById(n.id); };
  H.open = async (n) => { switchMainTab('notePublish', n);
    const ok = await H.ready(() => _npWiz && String(_npWiz.arId || '') === String(n.id), 16000);
    await H.sleep(500); return ok; };
  window.__lf = H;
  // AI 桩：只截 genNoteLongform（把每次的 payload 记下来），其余照走本机服务器
  window.__lfAi = [];
  window.__lfFailOnce = false;
  if (!window.__lfStubbed) {
    window.__lfStubbed = true;
    const sm = chrome.runtime.sendMessage.bind(chrome.runtime);
    window.__lfRealSm = sm;
    chrome.runtime.sendMessage = function (msg) {
      if (String((msg && msg.action) || '') !== 'genNoteLongform') return sm.apply(null, arguments);
      const d = (msg && msg.data) || {};
      const cnt = window.__lfAi.push(JSON.parse(JSON.stringify(d)));
      let res;
      if (window.__lfFailOnce) { window.__lfFailOnce = false; res = { ok: false, error: '桩：这回没写成' }; }
      else {
        const script = cnt <= 2 ? window.__lfCfg.s1 : (cnt === 3 ? window.__lfCfg.s2 : (String(d.line || '') === 'd' ? window.__lfCfg.s2 : window.__lfCfg.s3));
        res = { ok: true, script: script };
      }
      const cb = arguments[1];
      if (typeof cb === 'function') setTimeout(() => cb(res), 120);
      return Promise.resolve(res);
    };
  }
  if (!window.__lfHops) {
    window.__lfHops = [];
    const sw = window.switchMainTab;
    window.__lfSw = sw;
    window.switchMainTab = function (name) { window.__lfHops.push(String(name)); return sw.apply(this, arguments); };
  }
  return true;
}'''

PH = r'''async (CFG) => {
  const H = window.__lf, R = {}, hops = window.__lfHops;
  window.__lfCfg = CFG;
  const activeC = () => _npActiveContainer;

  // ── 1、六卡那一行：两张长文卡都在，各自腔／字数写准；没有独立「📝 长文」一行 ──
  npDirOpen();
  await H.ready(() => H.vis('#dirModal .np-dir-eff'), 6000);
  R.dir = {
    rows: H.all('#dirBox .np-dir-row .np-dir-side b').map(e => String(e.textContent || '').trim()),
    l: H.all('#dirBox [data-direff^="l|"]').map(e => String(e.getAttribute('data-direff') || '')),
    k: H.all('#dirBox [data-direff^="k|"]').map(e => String(e.getAttribute('data-direff') || '')),
    d: H.all('#dirBox [data-direff^="d|"]').map(e => String(e.getAttribute('data-direff') || '')),
    kTitle: H.txt('#dirBox [data-direff="k|长文"] b'),
    kLv: H.txt('#dirBox [data-direff="k|长文"] .np-dir-eff-lv'),
    kDesc: H.txt('#dirBox [data-direff="k|长文"] .np-dir-eff-d'),
    dTitle: H.txt('#dirBox [data-direff="d|长文"] b'),
    dLv: H.txt('#dirBox [data-direff="d|长文"] .np-dir-eff-lv'),
    dDesc: H.txt('#dirBox [data-direff="d|长文"] .np-dir-eff-d'),
  };
  // 2、点「🔥 引流 · 长文」：建篇 dOut=long，落在挑稿那站
  hops.length = 0;
  await H.click('#dirBox [data-direff="d|长文"]', 900);
  const dOpened = await H.ready(() => _npWiz && _npWiz.dir === 'd' && _npWiz.dOut === 'long' && String(_npWiz.arId || ''), 16000);
  await H.sleep(500);
  const dw = _npWiz || {};
  const dn = dw.arId ? await H.note(dw.arId) : null;
  R.dEntry = { opened: dOpened, dir: String(dw.dir || ''), dOut: String(dw.dOut || ''), kOut: String(dw.kOut || ''),
               form: String((dn || {}).form || ''), step: Number(dw.step || 0), lTone: String(dw.lTone || ''),
               bar: H.bar(), modalClosed: !H.vis('#dirModal'), hops: hops.slice() };
  // 3、点「📚 知识 · 长文」：建篇 kOut=text，落在挑知识那站
  npDirOpen();
  await H.ready(() => H.vis('#dirBox [data-direff="k|长文"]'), 6000);
  hops.length = 0;
  await H.click('#dirBox [data-direff="k|长文"]', 900);
  const kOpened = await H.ready(() => _npWiz && _npWiz.dir === 'k' && _npWiz.kOut === 'text' && String(_npWiz.arId || ''), 16000);
  await H.sleep(500);
  const kw = _npWiz || {};
  const kn = kw.arId ? await H.note(kw.arId) : null;
  R.kEntry = { opened: kOpened, dir: String(kw.dir || ''), kOut: String(kw.kOut || ''), dOut: String(kw.dOut || ''),
               form: String((kn || {}).form || ''), step: Number(kw.step || 0), lTone: String(kw.lTone || ''),
               bar: H.bar(), hops: hops.slice() };

  // ── 4、知识长文：打开一篇有短稿、没长文的（停⑤ 出长文）──
  const now = Date.now();
  const K = 'lf-k-' + now, D = 'lf-d-' + now, DS = 'lf-ds-' + now, OLD = 'lf-l-' + now, K2 = 'lf-k2-' + now, MIG = CFG.mig;
  const baseDraft = { content: CFG.seed, titles: [CFG.topic], tags: ['猫'], timeTip: '' };
  const mk = (id, patch) => Object.assign({
    id, createdAt: now, updatedAt: now, platform: 'xhs', title: CFG.topic, topic: CFG.topic, people: [], sellPoints: [], kb: [],
    form: '长文', style: '', filmKind: '', draft: baseDraft.content, titles: [CFG.topic], tags: ['猫'], timeTip: '',
    visual: null, shots: null, imgDocs: null, filmDocs: null, voice: '', longform: '', longSrc: '',
    lTone: '', lTopic: '', lSeed: '', lStep: 0,
    wip: { step: 0, path: 'text', noteStyle: {}, write: null, planItem: null, ipPlay: '' },
    thumb: null, _sv: 3, dir: '', kOut: '', dOut: '', status: '草稿', statusAt: { '草稿': now },
  }, patch);
  await H.seedNote(mk(K, { dir: 'k', kOut: 'text' }));
  await H.seedNote(mk(D, { dir: 'd', dOut: 'long', wip: { step: 0, path: 'text', noteStyle: {}, write: null, planItem: null, ipPlay: '' } }));
  await H.seedNote(mk(DS, { dir: 'd', dOut: 'long', wip: { step: 0, path: 'text', noteStyle: {}, write: null, planItem: null, ipPlay: '工地连续剧' } }));
  await H.seedNote(mk(K2, { dir: 'k', kOut: 'text' }));
  const Lseed = mk(OLD, { dir: 'l', form: '长文', lTone: 'k', lTopic: CFG.topic, lSeed: CFG.seed, lStep: 0, kOut: '', dOut: '' });
  await H.seedNote(Lseed);
  await H.seedNote(mk(MIG, { dir: 'k', kOut: 'text' }));

  const kIn = await H.open(await H.note(K));
  R.k5 = { opened: kIn, step: Number((_npWiz || {}).step || 0), bar: H.bar(),
           toneK: H.body().indexOf('🔬 科普腔') >= 0, chars: H.body().indexOf('600~1200') >= 0,
           tonePickers: H.all('#npWizBody .np-l-tone').length, taBefore: !!H.one('#npLongTa'),
           genLab: H.txt('.np-long-gen'), calls: window.__lfAi.length };
  // 长文空着：点下一步被拦，人留在⑤
  H.clearToast();
  await H.click('.np-wiz-next', 700);
  R.kNoLong = { toast: H.toast(), step: Number((_npWiz || {}).step || 0) };
  // 生成失败：留在原地显示原因，还能再点
  window.__lfFailOnce = true;
  await H.click('.np-long-gen', 1200);
  const failed = await H.ready(() => /这回没写成/.test(H.body()), 12000);
  R.kFail = { shown: failed, step: Number((_npWiz || {}).step || 0), ta: !!H.one('#npLongTa'), toast: H.toast() };
  // 再点一次：出稿、落档、框里能改
  await H.click('.np-long-gen', 400);
  const got1 = await H.ready(() => String((_npWiz || {}).longform || '').trim(), 16000);
  await H.sleep(600);
  const p1 = window.__lfAi[1] || {};
  const n1 = await H.note(K);
  R.kGen1 = { ok: got1, taShown: H.vis('#npLongTa'), taVal: String((H.one('#npLongTa') || {}).value || ''),
              againLab: H.txt('.np-long-gen'), countLine: (H.flat().match(/\d+字·手改自动留着[^\n]{0,16}/) || [''])[0] };
  R.kP1 = { line: String(p1.line || ''), content: String(p1.content || ''), prev: String(p1.prev || ''), platform: String(p1.platform || '') };
  R.kN1 = { dir: String((n1 || {}).dir || ''), form: String((n1 || {}).form || ''), status: String((n1 || {}).status || ''),
            longform: String((n1 || {}).longform || ''), longSrc: String((n1 || {}).longSrc || '') };
  // 同一短稿「再出一版」：先收框里手改，再拿它当 prev
  H.val('#npLongTa', CFG.edited);
  await H.click('.np-long-gen', 400);
  const got2 = await H.ready(() => window.__lfAi.length >= 3 && String((_npWiz || {}).longform || '') === CFG.s2, 16000);
  const p2 = window.__lfAi[2] || {};
  R.kGen2 = { got2: got2, calls: window.__lfAi.length, prevIsEdited: String(p2.prev || '') === CFG.edited,
              content: String(p2.content || ''), now: String((_npWiz || {}).longform || '').slice(0, 9) };
  // 短稿改过 → 旧版提示 ＋ 重新出长文（prev 从头排，不喂旧长文）
  _npWiz.draft.content = CFG.seed2;
  await npWizRender(activeC());
  await H.sleep(400);
  R.kStale = { warn: /正文改过了，这版长文是旧的/.test(H.body()), regen: !!H.one('.np-long-regen'),
               gen: !!H.one('.np-long-gen') };
  await H.click('.np-long-regen', 400);
  const got3 = await H.ready(() => window.__lfAi.length >= 4 && String((_npWiz || {}).longform || '') === CFG.s3, 16000);
  const p3 = window.__lfAi[3] || {};
  R.kGen3 = { got3: got3, prev: String(p3.prev || ''), content: String(p3.content || ''),
              warnGone: !/正文改过了，这版长文是旧的/.test(H.body()),
              againLab: H.txt('.np-long-gen'), longSrcOk: String((_npWiz || {}).longSrc || '') === CFG.seed2 };
  // ⑤ → ⑥ 预览
  await H.click('.np-wiz-next', 900);
  R.kPv = { step: Number((_npWiz || {}).step || 0), head: /👀 预览/.test(H.body()),
            form: /📝 长文/.test(H.body()), tone: /🔬 科普腔/.test(H.body()),
            pub: /小红书 · 长文模式/.test(H.body()), hook: /主页简介 · 私信我/.test(H.body()),
            words: (H.flat().match(/字数(\d+字)/) || ['', ''])[1],
            done: !!H.one('.np-k-long-done'), sidebar: !!H.one('#npWizBody aside') };
  // 空长文在预览里不让收口
  const keepLf = String(_npWiz.longform || '');
  _npWiz.longform = '';
  await npWizRender(activeC());
  await H.sleep(300);
  hops.length = 0; H.clearToast();
  await H.click('.np-k-long-done', 900);
  R.kEmpty = { toast: H.toast(), hops: hops.slice(), noteInArchive: H.vis('#npWizBody') === false };
  _npWiz.longform = keepLf;
  await npWizRender(activeC());
  await H.sleep(300);
  // 收口：标代发、稿子＝长文、回档案、下一步指预览
  hops.length = 0; H.clearToast();
  await H.click('.np-k-long-done', 2000);
  const nK = await H.note(K);
  R.kFinish = { hops: hops.slice(), toast: H.toast(), status: String((nK || {}).status || ''),
                dir: String((nK || {}).dir || ''), form: String((nK || {}).form || ''),
                longformHead: String((nK || {}).longform || '').slice(0, 9), voiceLen: String((nK || {}).voice || '').length,
                path: String(((nK || {}).wip || {}).path || '') };
  R.kNext = nK ? H.nextOf(nK) : { err: '档案里找不到这一篇' };
  await H.ready(() => H.all('.npar-row').length > 0, 9000);
  await H.sleep(400);
  R.kRow = { toLong: !!H.one('.np-ar-tolong[data-id="' + K + '"]') };
  // 档案预览拿的是长文，不摆短稿
  const nK2 = await H.note(K);
  if (nK2) { await npArPreview(nK2); await H.sleep(500); }
  R.kPrevModal = { text: String((H.one('.npar-prev-mask') || {}).textContent || '').replace(/\s+/g, ' ').slice(0, 600) };
  const pm = H.one('.npar-prev-mask'); if (pm) pm.remove();

  // ── 5、改稿空着：出长文屏只有拦，不铺生成钮 ──
  await H.open(await H.note(K2));
  if (_npWiz) { _npWiz.draft = null; await npWizRender(activeC()); }
  await H.sleep(400);
  R.kNoDraft = { empty: /正文还空着/.test(H.body()), gen: !!H.one('.np-long-gen'), step: Number((_npWiz || {}).step || 0) };
  H.clearToast();
  await H.click('.np-wiz-next', 600);
  R.kNoDraft.toast = H.toast();

  // ── 6、引流长文：固定人设腔、800~1500；出稿 → 预览 → 存好 ──
  const dIn = await H.open(await H.note(D));
  R.d5 = { opened: dIn, step: Number((_npWiz || {}).step || 0), bar: H.bar(),
           toneD: H.body().indexOf('🗣 人设腔') >= 0, chars: H.body().indexOf('800~1500') >= 0,
           tonePickers: H.all('#npWizBody .np-l-tone').length, genLab: H.txt('.np-long-gen') };
  const before = window.__lfAi.length;
  await H.click('.np-long-gen', 400);
  const dGot = await H.ready(() => window.__lfAi.length > before && String((_npWiz || {}).longform || '').trim(), 16000);
  const pd = window.__lfAi[window.__lfAi.length - 1] || {};
  R.dGen = { ok: dGot, line: String(pd.line || ''), content: String(pd.content || ''), prev: String(pd.prev || '') };
  await H.click('.np-wiz-next', 900);
  R.dPv = { step: Number((_npWiz || {}).step || 0), tone: /🗣 人设腔/.test(H.body()), done: !!H.one('.np-d-long-done') };
  await H.click('.np-d-long-done', 2000);
  const nD = await H.note(D);
  R.dFinish = { status: String((nD || {}).status || ''), dOut: String((nD || {}).dOut || ''),
                longformHead: String((nD || {}).longform || '').slice(0, 9), voiceLen: String((nD || {}).voice || '').length };
  R.dNext = nD ? H.nextOf(nD) : { err: '档案里找不到这一篇' };

  // ── 7、讲故事型引流：第一站换成「AI 编故事」，不是「出几版」 ──
  const dsIn = await H.open(await H.note(DS));
  R.dStory = { opened: dsIn, step: Number((_npWiz || {}).step || 0), bar: H.bar(),
               hasStory: /AI 编故事/.test(H.bar()), hasPick: /出几版/.test(H.bar()),
               tone: /🗣 人设腔/.test(H.body()) };

  // ── 8、老 dir='l' 四屏原样能开（只验门面与选腔卡还在，不动它的流程）──
  const lIn = await H.open(await H.note(OLD));
  R.oldL = { opened: lIn, isL: !!(_npWiz && npIsL(_npWiz)), topic: H.vis('#npLTopic'),
             tones: H.all('#npWizBody .np-l-tone').length, bar: H.bar() };

  // ── 9、档案「📝 改出长文」不动：仍按老桥进 dir='l'，不另开一篇 ──
  window.switchMainTab('noteArchive');
  const rowOk = await H.ready(() => H.one('.np-ar-tolong[data-id="' + CFG.mig + '"]'), 12000);
  const cntBefore = (await npNotesAll()).length;
  await H.click('.np-ar-tolong[data-id="' + CFG.mig + '"]', 1500);
  const bridged = await H.ready(() => _npWiz && npIsL(_npWiz) && String(_npWiz.arId || '') === CFG.mig, 16000);
  await H.sleep(500);
  const nm = await H.note(CFG.mig);
  R.bridge = { rowOk: rowOk, bridged: bridged, dir: String((_npWiz || {}).dir || ''),
               noteDir: String((nm || {}).dir || ''), form: String((nm || {}).form || ''),
               lTone: String((_npWiz || {}).lTone || ''), lStep: Number((_npWiz || {}).lStep || 0),
               tones: H.all('#npWizBody .np-l-tone').length,
               grew: (await npNotesAll()).length - cntBefore };

  R.ids = { K: K, D: D, DS: DS, OLD: OLD, MIG: MIG };
  R.miss = window.__lfMiss || [];
  R.calls = window.__lfAi.length;
  return R;
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
            page = br.new_context(viewport={'width': 1180, 'height': 1180}).new_page()
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
            r = page.evaluate(PH, {'topic': TOPIC, 'seed': SEED, 'seed2': SEED2, 's1': S1, 's2': S2, 's3': S3,
                                   'edited': EDITED,
                                   'mig': 'lf-mig-' + str(int(time.time() * 1000))}) or {}
            page.wait_for_timeout(400)
            snap(page, '1-两条线长文自检')
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
    d = r.get('dir') or {}
    kCards = d.get('k') or []
    dCards = d.get('d') or []
    if not d.get('l') and 'k|长文' in kCards and 'd|长文' in dCards and len(kCards) == 5 and len(dCards) == 2:
        ok('新建弹层：📚 知识 %d 张（含长文，另有 10-22 加的「视频混剪」）、🔥 引流 %d 张（含长文），没有独立「📝 长文」一行'
           % (len(kCards), len(dCards)))
    else:
        bad('弹层卡片不对：%s' % d)
    if d.get('kDesc') and '科普腔' in d.get('kDesc') and '600~1200' in d.get('kDesc'):
        ok('知识长文卡：%s（🔬 科普腔 · 600~1200 字）' % str(d.get('kLv')))
    else:
        bad('知识长文卡说明不对：%s' % d.get('kDesc'))
    if d.get('dDesc') and '人设腔' in d.get('dDesc') and '800~1500' in d.get('dDesc'):
        ok('引流长文卡：%s（🗣 人设腔 · 800~1500 字）' % str(d.get('dLv')))
    else:
        bad('引流长文卡说明不对：%s' % d.get('dDesc'))

    de = r.get('dEntry') or {}
    if (de.get('opened') and de.get('dir') == 'd' and de.get('dOut') == 'long' and not de.get('kOut')
            and de.get('form') == '长文' and de.get('step') == 3 and de.get('lTone') == ''
            and 'notePublish' in (de.get('hops') or []) and '出几版' in str(de.get('bar'))):
        ok('点「🔥 引流 · 长文」：建篇 dir=d／dOut=long／form=长文、不写 lTone，落在「📄 出几版」那站')
    else:
        bad('引流长文卡建篇不对：%s' % de)
    ke = r.get('kEntry') or {}
    if (ke.get('opened') and ke.get('dir') == 'k' and ke.get('kOut') == 'text' and not ke.get('dOut')
            and ke.get('form') == '长文' and ke.get('step') == 0 and ke.get('lTone') == ''
            and 'notePublish' in (ke.get('hops') or []) and '挑知识' in str(ke.get('bar'))):
        ok('点「📚 知识 · 长文」：建篇 dir=k／kOut=text／form=长文、不写 lTone，落在「挑知识」那站')
    else:
        bad('知识长文卡建篇不对：%s' % ke)

    k5 = r.get('k5') or {}
    if (k5.get('opened') and k5.get('step') == 5 and k5.get('toneK') and k5.get('chars')
            and k5.get('tonePickers') == 0 and not k5.get('taBefore') and k5.get('genLab') == '✨ 出长文'
            and k5.get('calls') == 0 and all(x in str(k5.get('bar')) for x in ('挑知识', '改稿', '📝 出长文', '👀 预览', '✓ 存好回档案'))):
        ok('知识长文篇打开：停在⑤「📝 出长文」，固定 🔬 科普腔 · 600~1200 字，无选腔控件、进站不自动写（AI 0 次）')
    else:
        bad('知识长文站不对：%s' % k5)
    nl = r.get('kNoLong') or {}
    if '长文还没出来' in str(nl.get('toast')) and nl.get('step') == 5:
        ok('长文空着点「下一步」：顶回「%s」，人留在⑤' % str(nl.get('toast'))[:30])
    else:
        bad('长文空着没拦住：%s' % nl)
    kf = r.get('kFail') or {}
    if kf.get('shown') and kf.get('step') == 5 and not kf.get('ta'):
        ok('生成失败：留在⑤ 显示「这回没写成：桩：这回没写成」，还能再点一次')
    else:
        bad('生成失败没留在原地：%s' % kf)
    g1 = r.get('kGen1') or {}
    p1 = r.get('kP1') or {}
    if (g1.get('ok') and g1.get('taShown') and g1.get('taVal') == S1
            and g1.get('againLab') == '🔁 再出一版' and p1.get('line') == 'k'
            and p1.get('content') == SEED and p1.get('prev') == '' and p1.get('platform')):
        ok('点「✨ 出长文」才调 AI：payload line=k／content=短稿／prev 空；稿子铺进可改的框，钮变「%s」' % g1.get('againLab'))
    else:
        bad('知识出长文不对：%s' % {'gen': g1, 'payload': p1})
    n1 = r.get('kN1') or {}
    if n1.get('dir') == 'k' and n1.get('form') == '长文' and n1.get('status') == '草稿' and n1.get('longform') == S1 and n1.get('longSrc') == SEED:
        ok('出稿同时回写档案：dir=k／form=长文／状态「%s」，longform 已存、longSrc 记着这份短稿' % n1.get('status'))
    else:
        bad('出稿没回写档案：%s' % n1)
    g2 = r.get('kGen2') or {}
    if g2.get('got2') and g2.get('prevIsEdited') and g2.get('content') == SEED:
        ok('同一短稿「再出一版」：框里手改先收下（%s 字）再拿它当 prev，短稿事实不变' % len(EDITED))
    else:
        bad('再出一版不对：%s' % g2)
    st = r.get('kStale') or {}
    if st.get('warn') and st.get('regen') and not st.get('gen'):
        ok('短稿改过：⑤ 标「正文改过了，这版长文是旧的」，只摆「🔁 重新出长文」')
    else:
        bad('旧版提示不对：%s' % st)
    g3 = r.get('kGen3') or {}
    if g3.get('got3') and g3.get('prev') == '' and g3.get('content') == SEED2 and g3.get('warnGone') and g3.get('longSrcOk'):
        ok('「🔁 重新出长文」按新短稿重排（prev 空着，不喂旧长文），出完旧版提示消失')
    else:
        bad('重新出长文不对：%s' % g3)
    pv = r.get('kPv') or {}
    if (pv.get('step') == 6 and pv.get('head') and pv.get('form') and pv.get('tone') and pv.get('pub')
            and pv.get('hook') and pv.get('words') and pv.get('done') and pv.get('sidebar')):
        ok('预览：左稿右元数据（形式／腔调／字数 %s／发布／承接／状态），底栏「✓ 存好，回档案」' % str(pv.get('words')))
    else:
        bad('预览屏不对：%s' % pv)
    em = r.get('kEmpty') or {}
    if '长文还是空的' in str(em.get('toast')) and 'noteArchive' not in (em.get('hops') or []):
        ok('预览里长文空着点「✓ 存好」：被拦（%s），人没回档案' % str(em.get('toast'))[:24])
    else:
        bad('空长文没拦住收口：%s' % em)
    fi = r.get('kFinish') or {}
    if (fi.get('status') == '代发' and fi.get('dir') == 'k' and fi.get('form') == '长文'
            and fi.get('longformHead') == S3[:9] and fi.get('voiceLen') and fi.get('path') == 'text'
            and 'noteArchive' in (fi.get('hops') or [])):
        ok('收口：标「%s」、稿子＝长文（%s…）、正文补齐，人回档案页' % (fi.get('status'), fi.get('longformHead')))
    else:
        bad('知识长文收口不对：%s' % fi)
    nx = r.get('kNext') or {}
    if nx.get('lab') == '👀 预览' and nx.get('to') == 'preview':
        ok('档案那一行下一步＝「%s」' % nx.get('lab'))
    else:
        bad('档案下一步不对：%s' % nx)
    row = r.get('kRow') or {}
    if not row.get('toLong'):
        ok('档案那一行不再摆「📝 改出长文」（这篇已经有长文稿）')
    else:
        bad('档案那一行还摆着改出长文：%s' % row)
    pm = r.get('kPrevModal') or {}
    if '【第 3 版】' in str(pm.get('text')) and '【短稿改过这一版】' not in str(pm.get('text')):
        ok('档案预览摆的是长文（第 3 版），没把短稿当长文摆出来')
    else:
        bad('档案预览正文不对：%s' % str(pm.get('text'))[:120])
    nd = r.get('kNoDraft') or {}
    if nd.get('empty') and not nd.get('gen') and '长文还没出来' in str(nd.get('toast')):
        ok('短稿空着：⑤ 只摆「正文还空着…先回改稿」这道拦，没有生成钮，点下一步也被顶回')
    else:
        bad('短稿空着没拦住：%s' % nd)

    d5 = r.get('d5') or {}
    if (d5.get('opened') and d5.get('step') == 5 and d5.get('toneD') and d5.get('chars')
            and d5.get('tonePickers') == 0 and d5.get('genLab') == '✨ 出长文'
            and all(x in str(d5.get('bar')) for x in ('出几版', '改稿', '📝 出长文', '👀 预览', '✓ 存好回档案'))):
        ok('引流长文篇打开：停在⑤，固定 🗣 人设腔 · 800~1500 字，无选腔控件，步骤条是「📄 出几版」那条')
    else:
        bad('引流长文站不对：%s' % d5)
    dg = r.get('dGen') or {}
    if dg.get('ok') and dg.get('line') == 'd' and dg.get('content') == SEED and dg.get('prev') == '':
        ok('引流出长文：payload line=d／content=短稿／prev 空')
    else:
        bad('引流出长文 payload 不对：%s' % dg)
    dp = r.get('dPv') or {}
    if dp.get('step') == 6 and dp.get('tone') and dp.get('done'):
        ok('引流预览：腔调＝🗣 人设腔，底栏是「✓ 存好，回档案」')
    else:
        bad('引流预览不对：%s' % dp)
    df = r.get('dFinish') or {}
    if df.get('status') == '代发' and df.get('dOut') == 'long' and df.get('longformHead') and df.get('voiceLen'):
        ok('引流收口：标「代发」、dOut=long、长文与正文都在档案里')
    else:
        bad('引流收口不对：%s' % df)
    dn = r.get('dNext') or {}
    if dn.get('lab') == '👀 预览' and dn.get('to') == 'preview':
        ok('引流档案下一步＝「👀 预览」')
    else:
        bad('引流档案下一步不对：%s' % dn)
    ds = r.get('dStory') or {}
    if ds.get('opened') and ds.get('step') == 5 and ds.get('hasStory') and not ds.get('hasPick') and ds.get('tone'):
        ok('讲故事型引流长文：第一站换成「AI 编故事」，步骤条上没有「出几版」')
    else:
        bad('讲故事型站表不对：%s' % ds)

    ol = r.get('oldL') or {}
    if ol.get('opened') and ol.get('isL') and ol.get('topic') and ol.get('tones') == 2:
        ok('老 dir=l 四屏原样能开：底子屏（主题输入＋两颗腔卡）都在，条＝%s' % str(ol.get('bar'))[:40])
    else:
        bad('老 dir=l 四屏坏了：%s' % ol)
    bg = r.get('bridge') or {}
    if (bg.get('rowOk') and bg.get('bridged') and bg.get('noteDir') == 'l' and bg.get('form') == '长文'
            and bg.get('lTone') == 'k' and bg.get('lStep') == 0 and bg.get('tones') == 2):
        ok('「📝 改出长文」不动：仍桥进老 dir=l 四屏（腔按旧方向推成 k、落在底子屏）')
    else:
        bad('改出长文老桥不对：%s' % bg)
    if bg.get('grew') == 0:
        ok('桥过去只改档案里那一格，没另开一格（篇数没涨）')
    else:
        bad('桥过去多出一篇重复的：%s' % bg)


if __name__ == '__main__':
    main()
