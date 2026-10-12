/* 字效编辑器（扩展里）：正文 →（AI 调）口播稿 →（提重点）分幕 → 配音 → 逐帧画面 → 一条带配音的 MP4。
 *
 * 跟开发侧的 调风格.html / render_style_film.py 是同一套引擎（lib/video 里就是那几个文件），
 * 差别只在配音：这边用 EdgeTTS 直连免费通道，逐幕念、量出真实秒数后现排时间轴——
 * 所以换音色 / 改文案都不用回来重出，点一下重算就行。
 *
 * 2026-10-10 三十七改（四条改版 ①）：
 * - 编辑器＝工作流里的一站：顶栏左上「← 返回档案」、右上「⚙ 音色与风格」；页内两站 ① 口播稿 → ② 分幕
 *   （原 ③ 音色 / ④ 风格 两签收进 ⚙ 弹窗）；底栏「上一步｜下一步 →｜出片（配音 + 画面）」。
 * - 「生成分幕」不再本机直切：AI 一发提重点（重点是给你过目的卡片，可改可删）→ 二发按重点改出
 *   「出片稿」＋分幕 JSON；分幕文字不必跟正文逐字一样。没配 AI / 失败 / 不合法 → 回退本机规则
 *   （Scenes.fromScript）＋面板标一句「这次按本机规则分的幕」。
 * - 口播稿栈：进站带正文；没口播稿就自动按正文调一版（genNoteVoiceScript 通路，可停）；有稿不覆盖；
 *   调好的稿写回这一篇（np_notes[n.id].voice，正文不动）。调稿失败 → 正文直接当稿用＋标注。
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const cv = $('cv');
  const ctx = cv.getContext('2d', { alpha: false });
  const KEY_STYLE = 'xhsFilmStyle', KEY_VOICE = 'xhsFilmVoice', KEY_SCRIPT = 'xhsFilmScript';
  const KEY_DOCS = 'xhsFilmDocs';      // 按篇存的草稿：{ [笔记档案 id]: {body, script, scenes, cfg, voice, rate, outAt, fv*} }
  const EMBED = /(?:^|[?&])embed=1(?:&|$)/.test(location.search);   // 弹窗里的 iframe 版（不是独立标签页）
  // 紧凑版样式挂在 html.embed 上；MV3 扩展页禁 inline script（默认 CSP 只认 'self'），所以只能在这儿落类名
  if (EMBED) document.documentElement.className = 'embed';

  const S = {
    script: '',        // ① 框里现在的稿子：口播稿；按重点出过分幕后＝那版「出片稿」
    body: '',          // 这一篇的正文（进站带来；只给 AI 调稿用，框里不动它）
    fvFrom: '',        // 'body'＝这版口播稿是 AI 按正文调的；''＝手整的
    fvPrev: '',        // 上一版稿（按重点改之前），「↩ 看上一版」用
    fvPN: 0,           // 「分幕按 N 个重点又改过（框里这版＝出片稿）」
    fvPicks: null,     // 重点卡：[{s, why}]（提完重点、还没落到分幕时才在）
    fvBusy: false,     // 正在按正文调口播稿
    fvFail: false,     // 这次没调口播稿——正文直接当稿用（B5 兜底）
    peeking: false,    // 摊着看原正文
    prevPeek: false,   // 摊着看上一版
    pickBusy: false,   // 正在提重点（一发）
    genBusy: false,    // 正在按重点出稿并分幕（二发）
    scRule: false,     // 这批分幕是按本机规则切的（AI 没成，B1 兜底）
    kind: '',          // 这一篇的成片形式（PPT字体动效 / 卡片画面叙事）
    meta: { style: '', sellPoint: '', people: [], platform: '' },   // 调稿给 AI 的料（进站递）
    scenes: [],
    cfg: Object.assign({}, Renderer.DEFAULT_CFG),
    voice: 'zh-CN-XiaoxiaoNeural',
    rate: '+20%',
    tl: null,          // 有真配音秒数后才有：{scenes:[{start,end}], dur}
    sr: 0,             // 这台机器编得动的 AAC 采样率（pickRate 挑出来的）
    busy: false,
    lastBlob: null,
    lastName: '',
    noteId: '',        // 从「笔记档案」里点进来那一篇：草稿跟它绑着（空＝单开一页的老口径）
    noteTitle: '',
    outAt: 0,          // 这一篇最近出成片的时间（0＝还没出过）
    doneUrl: '',       // 成片预览那层正在放的那条（objectURL，收起时撤销）
  };
  window.Film = S;     // 自检脚本用它驱动

  /* A1：大组装产物入档（asm）
     noteId = S.noteId；asm = { bgmId, sections:[{ cardKey, scenes:[{text,t}] }] }
     video.js 是独立标签页／iframe，不走 popup 的 npNotesSync 串行；
     但 chrome.storage.local.set 一次写整条，比对 noteId 命中即改 asm。
     与 popup 同时写同一行的极端竞争——落档加 updatedAt 时间戳兜底（用更大的那一条）。 */
  const NP_ASM_KEY = 'np_notes';
  async function npFilmSaveAsm(noteId, asm) {
    noteId = String(noteId || S.noteId || '').trim();
    if (!noteId) return { ok: false, error: 'noteId 为空' };
    const d = await chrome.storage.local.get(NP_ASM_KEY);
    const list = Array.isArray(d[NP_ASM_KEY]) ? d[NP_ASM_KEY] : [];
    const i = list.findIndex(x => x && x.id === noteId);
    if (i < 0) return { ok: false, error: '档案里没这篇 id=' + noteId };
    const prev = list[i];
    // 收口：bgmId + sections + 长度截断
    const packed = (function () {
      if (!asm || typeof asm !== 'object') return null;
      const bgmId = String(asm.bgmId || '');
      const sections = Array.isArray(asm.sections)
        ? asm.sections.filter(s => s && String(s.cardKey || '').trim())
          .slice(0, 80)
          .map(s => ({
            cardKey: String(s.cardKey || ''),
            scenes: Array.isArray(s.scenes) ? s.scenes.slice(0, 12).map(sc => ({
              text: String(sc.text || '').slice(0, 200),
              t: Number(sc.t || 0),
            })) : [],
          }))
        : [];
      if (!sections.length && !bgmId) return null;
      return { bgmId, sections };
    })();
    list[i] = Object.assign({}, prev, {
      asm: packed,
      _sv: 1,
      updatedAt: Date.now(),
    });
    await chrome.storage.local.set({ [NP_ASM_KEY]: list });
    return { ok: true, noteId, sections: packed ? packed.sections.length : 0 };
  }
  S.npFilmSaveAsm = npFilmSaveAsm;        // 自检 / popup 跨页可调

  /* 调好的口播稿写回这一篇（note.voice）——档案侧「🎙 口播稿在」跟着走、下次进站直接续上。
     正文原样不动；兜底那版（正文当稿）先不认定成口播稿，用户改过字才写回。 */
  async function writeBackVoice() {
    const id = String(S.noteId || '');
    const v = String(S.script || '').trim();
    if (!id || !v) return;
    if (S.fvFail && v === String(S.body || '').trim()) return;
    const d = await chrome.storage.local.get(NP_ASM_KEY);
    const list = Array.isArray(d[NP_ASM_KEY]) ? d[NP_ASM_KEY] : [];
    const i = list.findIndex(x => x && x.id === id);
    if (i < 0) return;
    if (String(list[i].voice || '') === v) return;
    list[i] = Object.assign({}, list[i], { voice: v, updatedAt: Date.now() });
    await chrome.storage.local.set({ [NP_ASM_KEY]: list });
  }

  /* 成片存一份到本机（IndexedDB，key = film:<篇id>）：档案里「🎬 成片预览」要放这条片子。
     库跟笔记档案案例流用同一间（xhsCase / case，popup.js 里读）；出完片顺手写，写不进去不挡出片。 */
  function filmDb() {
    return new Promise((res, rej) => {
      const rq = indexedDB.open('xhsCase', 1);
      rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains('case')) db.createObjectStore('case', { keyPath: 'key' }); };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }
  async function filmPut(noteId, blob) {
    const db = await filmDb();
    await new Promise((res, rej) => {
      const tx = db.transaction('case', 'readwrite');
      tx.objectStore('case').put({ key: 'film:' + noteId, blob, at: Date.now() });
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    db.close();
  }

  const RATES = [['-10%', '稳'], ['+0%', '正常'], ['+20%', '快'], ['+35%', '更快']];
  const LAY_NAME = { center: '居中', left: '左对齐', list: '要点', number: '数字' };

  /* ---------- 页内两站：横置 tab（① 口播稿 → ② 分幕）；底栏步进跟着它走 ---------- */
  const SECS = ['script', 'scenes'];
  let curSec = 'script';
  function showSec(name) {
    if (SECS.indexOf(name) < 0) return;
    curSec = name;
    Array.prototype.forEach.call(document.querySelectorAll('#filmTabs .ftab'), b => {
      b.classList.toggle('on', b.getAttribute('data-sec') === name);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.right .fsec'), s => {
      s.classList.toggle('on', s.getAttribute('data-sec') === name);
    });
    paintFoot();
  }
  S.showSec = showSec;                       // 自检脚本用它切站
  $('filmTabs').addEventListener('click', (ev) => {
    const b = ev.target.closest && ev.target.closest('.ftab');
    if (b) showSec(b.getAttribute('data-sec'));
  });
  /* 底栏步进：上一步（站 1 禁用）｜下一步 →（站 2 禁用）｜出片主钮＋进度/停跟随 */
  $('prevStep').onclick = () => showSec('script');
  $('nextStep').onclick = () => showSec('scenes');

  /* ---------- 小工具 ---------- */
  const say = s => { $('st').textContent = s; };
  const bar = p => { $('bar').style.width = Math.max(0, Math.min(100, p * 100)).toFixed(1) + '%'; };
  const warn = (s) => { const w = $('warn'); w.hidden = !s; w.textContent = s || ''; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cn = s => (String(s).match(/[\u4e00-\u9fa5]/g) || []).length;
  const stamp = () => {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  };
  let _toastT = null;
  function toast(s) {
    const t = $('toast'); if (!t) return;
    t.textContent = String(s || '');
    t.hidden = false;
    requestAnimationFrame(() => t.classList.add('on'));
    clearTimeout(_toastT);
    _toastT = setTimeout(() => { t.classList.remove('on'); setTimeout(() => { t.hidden = true; }, 220); }, 3400);
  }
  S.toast = toast;
  const store = {
    get: k => new Promise(r => chrome.storage.local.get(k, o => r(o && o[k]))),
    set: (k, v) => new Promise(r => chrome.storage.local.set({ [k]: v }, r)),
  };

  /* ---------- 顶栏（标题 / 已出过片 / 返回档案） ---------- */
  function paintHead() {
    $('headKind').textContent = S.kind ? ('出片 · ' + S.kind) : '出片';
    $('noteTitle').textContent = S.noteTitle ? ('《' + S.noteTitle + '》') : '';
    $('outFlag').hidden = !(S.noteId && S.outAt);
    $('back').hidden = !EMBED;             // 单开一页没有档案可回
  }
  /* 底栏那颗说明 + 步进按钮的禁用态 */
  function paintFoot() {
    const vo = (typeof VOICES !== 'undefined' && VOICES.short) ? VOICES.short(S.voice) : S.voice;
    $('footHint').textContent = S.scenes.length
      ? '分幕 ' + S.scenes.length + ' 幕 · 配' + vo + '念口播稿'
      : '还没分幕——先在「① 口播稿」生成分幕';
    const pb = $('prevStep');
    pb.disabled = curSec === 'script'; pb.title = curSec === 'script' ? '已经在第一站' : '回「① 口播稿」看稿';
    const nb = $('nextStep');
    nb.disabled = curSec === 'scenes'; nb.title = curSec === 'scenes' ? '这一篇就在这一站编分幕' : '去「② 分幕」改幕';
  }

  /* ---------- 按篇存的草稿 ----------
     从「笔记档案」那一行点进来时带着 noteId，这一篇的正文 / 口播稿 / 分幕 / 底图编排 / 配音参数 / 出片时间
     就存在 KEY_DOCS[noteId] 里，关掉弹窗再进来接得上；没带 id（单开一页）还是用上面那几个全局 key。
     本机选的图不入库——跟素材库同一条规矩：只存引用（素材库那条 / 外链），file 那张刷新要重选。 */
  const DOCS_CAP = 200;
  const docsGet = async () => ((await store.get(KEY_DOCS)) || {});
  /** 这一幕要存什么：文字侧全留；底图只留引用（kind='file' 的本机原图丢掉，跟老口径一致） */
  function scenesLite() {
    return S.scenes.map(sc => ({
      label: sc.label, name: sc.name || '', text: sc.text, lines: (sc.lines || []).slice(),
      em: (sc.em || []).map(e => ({ l: e.l, t: e.t })), layout: sc.layout,
      cardKey: sc.cardKey || '',
      card: (sc.card && sc.card.src && sc.card.kind !== 'file')
        ? { src: sc.card.src, name: sc.card.name || '', kind: sc.card.kind, id: sc.card.id || '' } : null,
    }));
  }
  /** 定时写会丢最后一下（关弹窗那下尤其容易丢）→ 攒 600ms；出片完／点保存／关页走 persistNow 立刻写 */
  let _docTimer = null;
  function persist() {
    if (!S.noteId) return Promise.resolve();
    clearTimeout(_docTimer);
    return new Promise(r => { _docTimer = setTimeout(() => { persistNow().then(r); }, 600); });
  }
  async function persistNow() {
    if (!S.noteId) return;
    clearTimeout(_docTimer);
    try {
      const docs = await docsGet();
      const prev = docs[S.noteId] || {};
      const cfg = Object.assign({}, S.cfg, { voice: S.voice });
      docs[S.noteId] = {
        title: S.noteTitle || '', kind: S.kind || '',
        body: S.body || '', script: S.script, scenes: scenesLite(),
        fvFrom: S.fvFrom || '', fvPN: Number(S.fvPN || 0) || 0,
        fvPrev: String(S.fvPrev || '').slice(0, 4000),
        fvPicks: Array.isArray(S.fvPicks)
          ? S.fvPicks.slice(0, 5).map(p => ({ s: String((p && p.s) || ''), why: String((p && p.why) || '') })) : null,
        meta: {
          style: S.meta.style || '', sellPoint: S.meta.sellPoint || '',
          people: S.meta.people || [], platform: S.meta.platform || '',
        },
        cfg: Renderer.cfgLine(cfg), voice: S.voice, rate: S.rate,
        outAt: Number(S.outAt || prev.outAt || 0) || 0,
        updatedAt: Date.now(),
      };
      const ks = Object.keys(docs);
      if (ks.length > DOCS_CAP) {   // 上限：丢最旧的几篇（笔记档案那边还有 300 条的上限）
        ks.sort((a, b) => (docs[a].updatedAt || 0) - (docs[b].updatedAt || 0));
        while (Object.keys(docs).length > DOCS_CAP) delete docs[ks.shift()];
      }
      await store.set(KEY_DOCS, docs);
    } catch (_) {}
    writeBackVoice().catch(() => {});   // 调好的口播稿落回这一篇
  }

  /* 还没有真配音时，按字数先估一条时间轴，好让预览能画出来 */
  function estTimeline() {
    let at = Voice.HEAD;
    const out = S.scenes.map((s, i) => {
      const sec = s.estSec || Math.max(1.2, cn(s.text) / 4.5);
      const sc = Object.assign({}, s, { start: +at.toFixed(3), end: +(at + sec).toFixed(3) });
      at += sec + (i < S.scenes.length - 1 ? Voice.GAP : 0);
      return sc;
    });
    return { head: Voice.HEAD, tail: Voice.TAIL, gap: Voice.GAP, dur: +(at + Voice.TAIL).toFixed(3),
             scenes: out, est: true };
  }

  /** 当前时间轴：有真配音秒数就用它，没有就按字数估一条。
      有真配音那条里的幕是拷贝（只借它的起止秒数）——图 / 段键永远以 S.scenes 为准，
      不然后面换了图、再出片画的还是上一版（拷贝是更早那次建的）。 */
  const tl = () => {
    const T = S.tl || estTimeline();
    if (Array.isArray(T.scenes)) T.scenes.forEach((tc, i) => {
      const sc = S.scenes[i];
      if (!sc) return;
      tc.card = sc.card; tc.cardImg = sc.cardImg; tc.cardImgOf = sc.cardImgOf;
      tc.cardErr = sc.cardErr; tc.cardKey = sc.cardKey;
    });
    return T;
  };
  S.timeline = tl;              // 自检脚本要按当前时间轴逐帧验画面（没有真配音时给的是估算那条）
  const style = () => Renderer.buildStyle(S.cfg);

  function draw(t) {
    const T = tl();
    Renderer.renderFrame(ctx, Math.max(0, Math.min(T.dur - 0.001, t)), T, style());
  }
  function drawScene(i) {
    const T = tl();
    const sc = T.scenes[i] || T.scenes[0];
    if (sc) draw(sc.start + (sc.end - sc.start) * 0.55);
  }

  /* ---------- 风格旋钮（住在 ⚙ 音色与风格 弹窗里） ---------- */
  function buildStyleUI() {
    const pv = $('presets');
    pv.innerHTML = '';
    Object.keys(Renderer.PRESETS).forEach(k => {
      const b = document.createElement('div');
      b.className = 'chip'; b.textContent = Renderer.PRESETS[k].name; b.dataset.preset = k;
      b.onclick = () => { S.cfg = Object.assign({}, Renderer.DEFAULT_CFG, Renderer.PRESETS[k].cfg); buildStyleUI(); afterStyle(); };
      pv.appendChild(b);
    });

    const kn = $('knobs');
    kn.innerHTML = '';
    Renderer.FIELDS.forEach(f => {
      const lab = document.createElement('div');
      lab.className = 'k'; lab.textContent = f.t;
      const box = document.createElement('div');
      box.className = 'chips';
      if (f.type === 'text') {
        const inp = document.createElement('input');
        inp.type = 'text'; inp.value = S.cfg[f.k] === undefined ? '' : S.cfg[f.k];
        inp.oninput = () => { S.cfg[f.k] = inp.value; afterStyle(); };
        box.appendChild(inp);
      } else {
        f.opts.forEach(o => {
          const c = document.createElement('div');
          c.className = 'chip' + (S.cfg[f.k] === o.v ? ' on' : '');
          c.innerHTML = (o.c ? `<span class="sw${f.shape === 'dot' ? ' dot' : ''}" style="background:${esc(o.c)}"></span>` : '') + esc(o.l);
          c.onclick = () => { S.cfg[f.k] = o.v; buildStyleUI(); afterStyle(); };
          box.appendChild(c);
        });
      }
      kn.appendChild(lab); kn.appendChild(box);
    });
  }
  /** 拨了旋钮：预览重画（并按篇记下来） */
  function afterStyle() { drawScene(curScene); persist(); }

  /* ---------- ⚙ 音色与风格 弹窗 ---------- */
  const cfgMask = $('cfgMask');
  function cfgOpen() { cfgMask.hidden = false; }
  function cfgClose() { cfgMask.hidden = true; }
  $('cfgBtn').onclick = cfgOpen;
  $('cfgOk').onclick = cfgClose;
  cfgMask.addEventListener('click', (ev) => { if (ev.target === cfgMask) cfgClose(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !cfgMask.hidden) cfgClose(); });

  /* ---------- ② 分幕 ---------- */
  let curScene = 0;

  function renderScenes() {
    const box = $('scenes');
    if (!S.scenes.length) {
      box.innerHTML = '<div class="empty">还没分幕——回「① 口播稿」点 🎬 生成分幕（AI 先提重点、你过目后按重点出稿切幕）。</div>';
      $('est').textContent = '';
      paintFoot();
      return;
    }
    box.innerHTML = '';
    if (S.scRule) {
      const n = document.createElement('div');
      n.className = 'fvnote';
      n.textContent = '这次按本机规则分的幕——没配 AI 或这次没调成；改完稿再点「🎬 生成分幕」走一遍 AI。';
      box.appendChild(n);
    }
    S.scenes.forEach((s, i) => {
      const d = document.createElement('div');
      d.className = 'scene';
      const lays = Object.keys(Renderer.LAYOUTS).map(k =>
        `<div class="chip${s.layout === k ? ' on' : ''}" data-lay="${k}">${LAY_NAME[k] || k}</div>`).join('');
      const shown = (s.lines && s.lines.length) ? s.lines.join(' / ') : String(s.text || '');
      d.innerHTML =
        `<div class="head"><span class="no">${esc(s.label)}</span>` +
        `<span class="tiny">${cn(s.text)} 字</span><div class="lay">${lays}</div></div>` +
        `<input class="tx" value="${esc(shown)}" title="念的就是这里的字；要分屏上行，在断开的地方打个 /（念的时候不念它）">` +
        `<div class="emrow"><span class="tiny">重点词</span><input class="em" value="${esc((s.em[0] || {}).t || '')}" placeholder="留空就是没有"></div>`;
      d.querySelectorAll('[data-lay]').forEach(c => c.onclick = () => {
        s.layout = c.dataset.lay; renderScenes(); drawScene(i); persist();
      });
      d.querySelector('.tx').oninput = e => {
        s.lines = e.target.value.split('/').map(x => x.trim()).filter(Boolean);
        s.text = s.lines.join('');
        s.estSec = Math.max(1.2, +(cn(s.text) / 4.5).toFixed(2));
        S.tl = null; syncEm(s);
        d.querySelector('.tiny').textContent = cn(s.text) + ' 字';
        showEst(); drawScene(i); persist();
      };
      d.querySelector('.em').oninput = e => {
        const v = e.target.value.trim();
        s.em = v ? [{ l: Math.max(0, (s.lines || []).findIndex(l => l.indexOf(v) >= 0)), t: v }] : [];
        drawScene(i); persist();
      };
      d.onclick = ev => { if (ev.target === d || ev.target.classList.contains('no')) { curScene = i; drawScene(i); } };
      box.appendChild(d);
    });
    showEst();
    paintFoot();
  }

  function syncEm(s) {   // 改了屏幕文案，原来的重点词可能已经不在上面了
    if (s.em && s.em[0]) {
      const t = s.em[0].t, li = (s.lines || []).findIndex(l => l.indexOf(t) >= 0);
      s.em = li >= 0 ? [{ l: li, t }] : [];
    }
  }

  function showEst() {
    if (!S.scenes.length) { $('est').textContent = ''; return; }
    const T = tl();
    $('est').textContent = `${S.scenes.length} 幕 · 约 ${T.dur.toFixed(1)}s` + (T.est ? '（按字数估的，出片时按真配音重算）' : '（已按真配音算过）');
  }

  /* ---------- 卡片底图（画面＝卡片轮播时用，全自动铺） ----------
     底图只有一个来源：「🖼 出图」那张画面表——一行＝一段底图，一行里的话按字数再切成几幕（做字幕/文字特效），
     同段的几幕打同一个 cardKey，渲染那边就按段翻卡、段里只换字（lib/video/styles.js）。
     拿的是素材库里那条的引用（本机图那条库里只有 ≤160px 预览小图；外链现读），要过同一道解码：
     拿到「原点干净」的位图才敢往画布上画，不然编码那步会被 VideoFrame 挡回来。 */
  let _cardAssets = null;      // 素材库（np_assets，跟着当前产品）读一次

  async function cardAssets() {
    if (_cardAssets) return _cardAssets;
    let list = [];
    try {
      const d = await new Promise(r => chrome.storage.local.get(['np_assets'], r));
      const a = d && d.np_assets;
      if (Array.isArray(a)) list = a.filter(x => x && x.id);
    } catch (_) {}
    _cardAssets = list;
    return list;
  }
  /** 用户点「素材库」/「按顺序铺」时现读一遍：刚在素材库那边传的图得能跟上 */
  const cardAssetsFresh = () => { _cardAssets = null; return cardAssets(); };

  /** 素材库里这条能拿什么图：本机图＝库里存的预览小图；链接＝外链原图（要站点允许跨站读） */
  function assetSrc(a) {
    if (!a) return '';
    if (a.kind === 'local') return String(a.thumb || '');
    if (a.kind === 'link') return String(a.ref || '');
    return String(a.thumb || a.ref || '');
  }
  const assetName = a => String((a && (a.name || a.ref)) || '素材').replace(/^https?:\/\//i, '').slice(0, 18);
  /** 一张图落成「卡」：src 是要画的图，id 是素材库那条的 id（回来续档时按它认图） */
  const cardOf = a => ({ src: assetSrc(a), name: assetName(a), kind: a.kind, id: a.id });

  /** 解码成位图：data:/blob: 直接读；http(s) 先 fetch（能跨站才行），不行再退回 <img crossorigin> */
  async function toBitmap(src) {
    const s = String(src || '').trim();
    if (!s) throw new Error('这条没有可画的图');
    try {
      const r = await fetch(s);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await createImageBitmap(await r.blob());
    } catch (e1) {
      return await new Promise((resolve, reject) => {
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('读不进来（外链图多半不给跨站读取，换「本机选」那张）'));
        im.src = s;
      });
    }
  }
  async function decodeCard(sc) {
    const want = (sc.card && sc.card.src) || '';
    if (!want) { sc.cardImg = null; sc.cardErr = ''; return; }
    if (sc.cardImg && sc.cardImgOf === want) return;
    const share = S.scenes.find(x => x !== sc && x.cardImg && x.cardImgOf === want);   // 一段同图只解一次
    if (share) { sc.cardImg = share.cardImg; sc.cardImgOf = want; sc.cardErr = ''; return; }
    const bmp = await toBitmap(want);         // 失败就让它抛，交给调用处记在 s.cardErr 上
    sc.cardImg = bmp; sc.cardImgOf = want; sc.cardErr = '';
  }

  /** 出片前把每张卡的底图都解码好（预览用的也是这些，出片不会再多读一次） */
  async function prepCards() {
    const bad = [];
    for (let i = 0; i < S.scenes.length; i++) {
      const sc = S.scenes[i];
      if (!sc.card || !sc.card.src) continue;
      try { await decodeCard(sc); }
      catch (e) { sc.cardImg = null; sc.cardErr = String((e && e.message) || e); bad.push({ i, name: (sc.card && sc.card.name) || '', msg: sc.cardErr }); }
    }
    return bad;
  }

  /** 出图那张画面表 → 字效编辑器分幕：一行＝一段底图，段里按字数再切几幕（做字幕特效），
   *  同段的几幕打同一个 cardKey（渲染段内不翻卡只换字）。没画面表不走这儿（回退 whole-script 分幕）。 */
  function scenesFromShotRows(rows) {
    const out = [];
    (Array.isArray(rows) ? rows : []).forEach(r => {
      const key = 'shot:' + String(r.rowId || ('row' + r.no));
      Scenes.fromScript(String(r.text || '')).forEach(sc => {
        sc.cardKey = key;                                // 同一行＝同一段底图
        out.push(sc);
      });
    });
    return out;
  }
  /** 把画面表每段传回来的图安到该段所有幕上当底图（off 段＝纯色卡不铺图）；返回新铺的幕数 */
  async function paveRows(rows) {
    if (S.cfg.frame !== 'card') return 0;
    const list = (await cardAssetsFresh()).filter(a => assetSrc(a));
    const byId = {}; list.forEach(a => { byId[String(a.id)] = a; });
    let k = 0;
    (Array.isArray(rows) ? rows : []).forEach(r => {
      if (r.off) return;                                 // 过场句这段：纯色卡
      let hit = null;
      (r.assetIds || []).some(id => { hit = byId[String(id)] || null; return !!hit; });
      if (!hit) return;                                  // 这张画面还没传回图 → 该段走纯色卡
      const key = 'shot:' + String(r.rowId || ('row' + r.no));
      const card = cardOf(hit);
      S.scenes.forEach(sc => {
        if (sc.cardKey !== key) return;
        if (sc.card && sc.card.src) return;              // 已经铺过的不动
        sc.card = card; sc.cardImg = null; sc.cardImgOf = ''; sc.cardErr = ''; k++;
      });
    });
    if (!k) return 0;
    await prepCards();
    drawScene(curScene); persist();
    return k;
  }

  /* ---------- 音色（住在 ⚙ 弹窗里） ---------- */
  function buildVoiceUI() {
    // 音色铺成一张表（音色 / 听感 / 适合）——标签挤一排看不出区别，点一行换音色
    const v = $('voices'); v.innerHTML = '';
    const head = document.createElement('tr');
    ['音色', '听感', '适合'].forEach(t => { const th = document.createElement('th'); th.textContent = t; head.appendChild(th); });
    v.appendChild(head);
    VOICES.list.forEach(o => {
      const tr = document.createElement('tr');
      tr.className = 'vrow' + (S.voice === o.v ? ' on' : '');
      tr.title = '用「' + o.n + '」念';
      const c1 = document.createElement('td'); c1.className = 'vname';
      const b = document.createElement('b'); b.textContent = o.n; c1.appendChild(b);
      if (o.rec) { const rc = document.createElement('span'); rc.className = 'vrec'; rc.textContent = '推荐'; c1.appendChild(rc); }
      const c2 = document.createElement('td'); c2.textContent = o.d || '';
      const c3 = document.createElement('td'); c3.textContent = o.use || '';
      tr.appendChild(c1); tr.appendChild(c2); tr.appendChild(c3);
      tr.onclick = () => { S.voice = o.v; S.tl = null; cache.key = ''; buildVoiceUI(); showEst(); paintFoot(); persist(); };
      v.appendChild(tr);
    });
    const r = $('rates'); r.innerHTML = '';
    RATES.forEach(([v2, l]) => {
      const c = document.createElement('div');
      c.className = 'chip' + (S.rate === v2 ? ' on' : '');
      c.textContent = l; c.title = '语速 ' + v2;
      c.onclick = () => { S.rate = v2; S.tl = null; cache.key = ''; buildVoiceUI(); showEst(); persist(); };
      r.appendChild(c);
    });
  }

  /* ---------- 配音（试听与出片共用，念过就不再念） ---------- */
  const cache = { key: '', parts: null, secs: null };
  const voiceKey = () => [S.voice, S.rate, S.scenes.map(s => s.text).join('|')].join('||');

  async function speakAll(onProgress) {
    const k = voiceKey();
    if (cache.key === k) return { parts: cache.parts, secs: cache.secs, hit: true };
    S.sr = await Voice.pickRate();                     // 这台机器编得动的 AAC 采样率（24k 在 Windows 上不行）
    const out = await Voice.speak(S.scenes, { voice: S.voice, rate: S.rate, sampleRate: S.sr, onProgress });
    cache.key = k; cache.parts = out.parts; cache.secs = out.secs;
    S.tl = Voice.timeline(S.scenes, out.secs);
    showEst();
    return { parts: out.parts, secs: out.secs, hit: false };
  }

  let playing = null;
  async function audition() {
    if (S.busy) return;
    if (!S.scenes.length) return warn('还没分幕——先在「① 口播稿」生成分幕');
    warn('');
    $('audition').disabled = true;
    try {
      say('配音中…'); bar(0);
      const { parts } = await speakAll((i, n) => { say(`配音 ${i}/${n}`); bar(i / n * 0.3); });
      const T = tl();
      const total = Voice.pcm(parts, { gap: T.gap, head: T.head, dur: T.dur, sampleRate: S.sr });
      const ac = new AudioContext({ sampleRate: S.sr });
      if (ac.state === 'suspended') await ac.resume();
      const buf = ac.createBuffer(1, total.length, S.sr);
      buf.getChannelData(0).set(total);
      const src = ac.createBufferSource();
      src.buffer = buf; src.connect(ac.destination); src.start();
      playing = { src, ac };
      $('audinfo').textContent = `正在放 ${T.dur.toFixed(1)}s（${VOICES.short(S.voice)} ${S.rate}）`;
      src.onended = () => { $('audinfo').textContent = '放完了'; stopPlay(); };
      say('试听中…');
      bar(1);
    } catch (e) {
      warn(String((e && e.message) || e));
      say('试听失败');
    } finally { $('audition').disabled = false; }
  }
  function stopPlay() { try { playing && playing.ac.close(); } catch (e) {} playing = null; }

  /* ═══════════ ① 口播稿：正文 →（AI 调）口播稿 →（提重点）分幕 ═══════════ */

  function renderScriptSec() {
    const sec = $('secScript'); if (!sec) return;
    const src = String(S.body || '').trim();
    const hasFv = String(S.script || '').trim().length > 0;
    const picks = Array.isArray(S.fvPicks) ? S.fvPicks : [];
    const hasSc = !!S.scenes.length;
    const intro = '<p class="fhint">片子的词走这一站：先按正文调出你的口播稿，再「生成分幕」——AI 先提重点给你过目，按重点改出一版「出片稿」再切幕；分幕文字不必跟正文逐字一样。</p>';
    const busyCard = (txt, hint, stopAct) =>
      '<div class="fvcard"><b>' + txt + '</b><span class="tiny">' + hint + '</span>' +
      (stopAct ? '<button type="button" class="ghost" data-act="fvstop">停</button>' : '') + '</div>';

    if (S.fvBusy) {
      sec.innerHTML = intro + busyCard('AI 正在按正文调口播稿…', '调好落到下面的框里，可手改', true);
      return;
    }
    if (!src && !hasFv && S.noteId) {
      sec.innerHTML = intro + '<div class="fvcard soft">这一篇还没有正文——口播稿按正文调出来。先回写稿那一篇把正文整出来，再来这一站。</div>';
      return;
    }

    let box = '';
    if (!hasFv) {
      if (S.noteId) {
        box += '<div class="fvrow"><span class="tiny">这一篇还没有口播稿——点一下，AI 按正文调一版（正文不动）。</span>' +
          '<button type="button" class="primary" data-act="kick">按正文调一版口播稿</button></div>';
      } else {
        /* 单开一页：没有这一篇的正文，直接在框里立稿 */
        box += '<div class="fvrow"><span class="tiny">没有这一篇的正文——直接在框里立稿，「生成分幕」时 AI 会提重点给你过目。</span></div>' +
          '<textarea id="script" data-in="script" rows="8" placeholder="一行一句，标点照常写。比如：&#10;一个人做小红书，凌晨还在发笔记。&#10;三个月过去，一个咨询都没有。"></textarea>' +
          '<div class="fvrow"><button type="button" class="primary" id="gen" data-act="gen">🎬 生成分幕</button>' +
          (hasSc ? '<span class="ok">已切 ' + S.scenes.length + ' 幕——回「② 分幕」可改</span>' : '<span class="tiny">还没分幕——没分幕出不了片</span>') +
          '<span class="tiny" id="cnt">' + cn(S.script) + ' 字</span></div>';
      }
      sec.innerHTML = intro + box;
      return;
    }

    const tag = S.fvFail
      ? '这次没调口播稿——正文直接当稿用（点「↻ 按正文重调一版」再试）'
      : (S.fvFrom === 'body' ? 'AI 按正文调出来的口播稿' : '这一版是你手整的');
    const pn = S.fvPN ? ' · 分幕按 ' + S.fvPN + ' 个重点又改过（框里这版＝出片稿）' : '';
    box += '<div class="fvrow">' +
      '<span class="fvtip' + (S.fvFrom === 'body' ? ' ok' : '') + (S.fvFail ? ' warn' : '') + '">' + tag + pn + '</span>' +
      ((S.noteId && src) ? '<button type="button" class="ghost" data-act="reset" title="丢掉现在这版，AI 按正文再调一版">↻ 按正文重调一版</button>' : '') +
      ((S.noteId && src) ? '<button type="button" class="ghost" data-act="peekbody">' + (S.peeking ? '▾ 收起正文' : '↩ 看原正文') + '</button>' : '') +
      (S.fvPrev ? '<button type="button" class="ghost" data-act="peekprev">' + (S.prevPeek ? '▾ 收起上一版' : '↩ 看上一版') + '</button>' : '') +
      '</div>' +
      (S.peeking ? '<div class="fvpeek">正文（原样，没动过）：' + esc(src || '（没有正文）') + '</div>' : '') +
      (S.prevPeek ? '<div class="fvpeek">上一版稿子（按重点改之前）：' + esc(String(S.fvPrev || '')) + '</div>' : '') +
      '<textarea id="script" data-in="script" rows="8" placeholder="一行一句，标点照常写。">' + esc(S.script || '') + '</textarea>';

    if (S.pickBusy) {
      box += busyCard('AI 正在提重点…', '最多 5 个——提完点字可改、可删', false);
    } else if (S.genBusy) {
      box += busyCard('AI 正在按重点出稿并分幕…', '重点留、水话合并，改出「出片稿」再切幕', false);
    } else if (picks.length) {
      box += '<div class="picks">' +
        '<b>AI 标的重点（' + picks.length + ' 个）</b><span class="tiny">——点字可改、点 ✕ 删；分幕就按这些骨头走</span>' +
        picks.map((p, i) =>
          '<div class="prow">' +
            '<input data-in="pick" data-i="' + i + '" maxlength="40" value="' + esc(p.s || '') + '">' +
            '<span class="tiny">' + esc(p.why || '') + '</span>' +
            '<button type="button" class="ghost" title="这个重点不留" data-act="pickdel" data-i="' + i + '">✕</button>' +
          '</div>').join('') +
        '<div class="pickfoot"><button type="button" class="primary" data-act="gen2">按重点出分幕</button></div></div>';
    } else {
      box += '<div class="fvrow"><button type="button" class="primary" id="gen" data-act="gen">🎬 生成分幕</button>' +
        (hasSc ? '<span class="ok">已切 ' + S.scenes.length + ' 幕——回「② 分幕」可改</span>'
               : '<span class="tiny">还没分幕——没分幕出不了片</span>') +
        '<span class="tiny" id="cnt">' + cn(S.script) + ' 字</span></div>';
    }
    sec.innerHTML = intro + box;
  }
  S.renderScriptSec = renderScriptSec;

  /* ① 栏的按钮 / 输入都靠委托（内容整块重画，逐个挂监听会漏） */
  $('secScript').addEventListener('click', (ev) => {
    const b = ev.target.closest && ev.target.closest('[data-act]');
    if (!b) return;
    const act = b.getAttribute('data-act');
    const i = Number(b.getAttribute('data-i') || -1);
    if (act === 'kick') fvKick(true);
    else if (act === 'fvstop') fvStopNow();
    else if (act === 'reset') fvKick(true);
    else if (act === 'peekbody') { S.peeking = !S.peeking; renderScriptSec(); }
    else if (act === 'peekprev') { S.prevPeek = !S.prevPeek; renderScriptSec(); }
    else if (act === 'gen') genPicks();
    else if (act === 'gen2') genByPicks();
    else if (act === 'pickdel') pickDel(i);
  });
  $('secScript').addEventListener('input', (ev) => {
    const el = ev.target;
    if (!el || !el.getAttribute) return;
    if (el.id === 'script') {
      S.script = el.value;
      const c = $('cnt'); if (c) c.textContent = cn(el.value) + ' 字';
      persist();
      return;
    }
    if (el.getAttribute('data-in') === 'pick') pickEdit(Number(el.getAttribute('data-i')), el.value);
  });

  /* 调口播稿：进站自动一发（没稿才调，B5）；manual=true＝点「↻ 按正文重调一版」 */
  let _fvSeq = 0;        // 每发一个序号：停过 / 再点过，迟到的结果不落
  let _fvKeep = '';      // 重调前那版：失败或停掉时还回去
  async function fvKick(manual) {
    if (S.busy || S.fvBusy) return;
    const src = String(S.body || '').trim();
    const cur = String(S.script || '').trim();
    if (!manual && cur) return;                      // B5：已有稿不覆盖
    if (!src) { if (manual) toast('这一篇还没有正文——没得重调'); else renderScriptSec(); return; }
    const my = ++_fvSeq;
    if (manual) {
      _fvKeep = cur;
      S.script = ''; S.fvFrom = ''; S.fvPrev = ''; S.fvPN = 0; S.fvPicks = null; S.fvFail = false;
      S.peeking = false; S.prevPeek = false;
    }
    S.fvBusy = true; S.fvFail = false;
    renderScriptSec();
    try {
      const r = await S.askBg({ action: 'genNoteVoiceScript', data: {
        title: S.noteTitle, content: src, style: S.meta.style,
        sellPoint: S.meta.sellPoint, people: S.meta.people, platform: S.meta.platform,
      } });
      if (my !== _fvSeq) return;                     // 停过了 / 又点过一版
      const out = String((r && r.script) || '').trim();
      if (!r || r.ok === false || !out) throw new Error(String((r && r.error) || '这次没调出来'));
      S.script = out; S.fvFrom = 'body'; S.fvPN = 0; S.fvPicks = null; S.scRule = false;
      S.tl = null; cache.key = ''; _fvKeep = '';
      persist();
      toast('口播稿调好了——先过目，不顺的地方直接改；再点「🎬 生成分幕」');
    } catch (e) {
      if (my !== _fvSeq) return;
      const msg = String((e && e.message) || e);
      if (manual && _fvKeep) { S.script = _fvKeep; _fvKeep = ''; toast('没调成：' + msg + '——先还你原来那版', 'error'); }
      else if (!String(S.script || '').trim()) { S.script = src; S.fvFrom = ''; S.fvFail = true; persist(); toast('这次没调口播稿——正文直接当稿用（' + msg + '）'); }
      else toast('没调成：' + msg, 'error');
    } finally {
      if (my === _fvSeq) { S.fvBusy = false; renderScriptSec(); }
    }
  }
  function fvStopNow() {
    _fvSeq++;                                        // 迟到的那次结果不再落
    S.fvBusy = false;
    if (!String(S.script || '').trim() && _fvKeep) { S.script = _fvKeep; _fvKeep = ''; }
    renderScriptSec();
    toast('停了——想再调点「↻ 按正文重调一版」');
  }
  function pickEdit(i, v) {
    const p = (S.fvPicks || [])[i]; if (!p) return;
    p.s = String(v || ''); persist();
  }
  function pickDel(i) {
    if (!(S.fvPicks || [])[i]) return;
    S.fvPicks.splice(i, 1); persist(); renderScriptSec();
    toast('去掉一个——留 ' + (S.fvPicks || []).length + ' 个重点');
  }

  /** 本机规则分幕（Scenes.fromScript 直切）；mark=true 时标「这次按本机规则分的幕」（B1 兜底） */
  function ruleScenes(mark) {
    const t = String(S.script || '').trim();
    if (!t) return 0;
    const wasCard = S.scenes.map(s => ({ card: s.card, key: s.cardKey || '' }));
    S.scenes = Scenes.fromScript(t);
    S.scenes.forEach((s, i) => {
      if (wasCard[i] && wasCard[i].card) s.card = wasCard[i].card;
      if (wasCard[i] && wasCard[i].key) s.cardKey = wasCard[i].key;
    });
    S.tl = null; cache.key = ''; curScene = 0; S.outAt = 0;
    S.scRule = !!mark;
    renderScenes(); renderScriptSec(); drawScene(0); paintFoot();
    showSec('scenes');
    persist();
    return S.scenes.length;
  }
  S.ruleScenes = ruleScenes;

  /** AI 二发的幕落到台子上：已配的底图按序保留；落完跳「② 分幕」 */
  function applyScenes(list) {
    const wasCard = S.scenes.map(s => ({ card: s.card, key: s.cardKey || '' }));
    S.scenes = list.map((s, i) => {
      const sc = Object.assign({}, s);
      if (wasCard[i] && wasCard[i].card) sc.card = wasCard[i].card;
      if (wasCard[i] && wasCard[i].key) sc.cardKey = wasCard[i].key;
      return sc;
    });
    S.tl = null; cache.key = ''; curScene = 0; S.outAt = 0;
    renderScenes(); renderScriptSec(); drawScene(0); paintFoot();
    showSec('scenes');
    persist();
  }

  /* 「生成分幕」第一发：AI 提重点（≤5 个）→ 重点卡 */
  async function genPicks() {
    if (S.busy || S.pickBusy || S.genBusy) return;
    const script = String(S.script || '').trim();
    if (!script) { toast('口播稿还是空的——先把稿子整出来'); return; }
    S.pickBusy = true; S.scRule = false;
    renderScriptSec();
    try {
      const r = await S.askBg({ action: 'genNoteFilmPicks', data: { title: S.noteTitle, script: script } });
      const pts = ((r && r.points) || [])
        .map(p => ({ s: String((p && (p.t || p.s)) || '').trim(), why: String((p && p.why) || '').trim() }))
        .filter(p => p.s).slice(0, 5);
      if (!r || r.ok === false || !pts.length) throw new Error(String((r && r.error) || 'AI 这次没提出重点'));
      S.fvPicks = pts;
      persist();
      toast('AI 提了 ' + pts.length + ' 个重点——点字可改、点 ✕ 可删，改完「按重点出分幕」');
    } catch (e) {
      S.fvPicks = null;
      ruleScenes(true);                               // B1：AI 不可用 → 本机规则分幕＋标注
      toast('这次按本机规则分的幕（' + String((e && e.message) || e) + '）');
    } finally {
      S.pickBusy = false; renderScriptSec();
    }
  }
  S.genPicks = genPicks;

  /* 「按重点出分幕」第二发：按改过的重点出「出片稿」＋分幕 JSON → 回填 ① 框、落到 ② */
  async function genByPicks() {
    if (S.busy || S.pickBusy || S.genBusy) return;
    const picks = (S.fvPicks || []).filter(p => String(p.s || '').trim());
    if (!picks.length) { toast('重点一个都没留——留两句再出分幕'); return; }
    const script = String(S.script || '').trim();
    if (!script) { toast('口播稿是空的——先把稿子整出来'); return; }
    S.genBusy = true;
    renderScriptSec();
    try {
      const r = await S.askBg({ action: 'genNoteFilmScript', data: {
        title: S.noteTitle, script: script, picks: picks.map(p => String(p.s || '').trim()),
      } });
      const list = Scenes.normalize({ scenes: (r && r.scenes) || [] });
      if (!r || r.ok === false || !list.length) throw new Error(String((r && r.error) || 'AI 这次没分好幕'));
      const draft = String((r && r.outline) || '').trim();
      if (draft) { S.fvPrev = script; S.script = draft; }     // 出片稿回填 ① 框（原版留「↩ 看上一版」）
      S.fvPN = picks.length; S.fvPicks = null; S.scRule = false;
      applyScenes(list);
      toast('出片稿＋' + list.length + ' 幕好了，落到「② 分幕」——逐幕能改');
    } catch (e) {
      S.scRule = true;
      ruleScenes(true);                               // B1：AI 不可用 → 本机规则分幕＋标注
      toast('这次按本机规则分的幕（' + String((e && e.message) || e) + '）');
    } finally {
      S.genBusy = false; renderScriptSec();
    }
  }
  S.genByPicks = genByPicks;

  /* ---------- 出片 ---------- */
  async function make() {
    if (S.busy) return;
    if (!S.scenes.length) { warn('还没分幕——先在「① 口播稿」生成分幕'); showSec('script'); return; }
    S.busy = true; warn(''); stopPlay();
    $('go').disabled = true; $('stop').hidden = false;
    try {
      const notes = [];
      if (!EdgeTTS.isEdge()) notes.push('这台浏览器不是 Edge，配音念不出来（微软这条免费口子认 Edge）。画面照样能出，配音得换 Edge 打开本页。');
      // 在弹窗里出片：切走这一页没事（实测照编），但关掉弹窗这条就断了——长片建议单开一页
      if (EMBED) notes.push('出片中别关掉这个弹窗——关了就断（在左栏切去写笔记没事，它照编）。片子长的话，点右上「在新标签页打开」单开一页慢慢编。');
      if (notes.length) warn(notes.join(' '));
      say('等字体…'); bar(0);
      await Fonts.ready;                                  // 字体没好就画，整片会用回退字体
      await Voice.pickRate();                             // 编不了 AAC 的话，这里就会带原因报出来
      if (S.cfg.frame === 'card') {                       // 卡片轮播：先把每张卡底图解好，读不进来的按纯色卡出
        say('准备卡片底图…'); bar(0.04);
        const bad = await prepCards();
        if (bad.length) notes.push('第 ' + bad.map(b => b.i + 1).join('、') + ' 幕的底图读不进来（' + bad[0].msg + '），这几张按纯色卡出。');
        warn(notes.join(' '));
      }

      const { parts } = await speakAll((i, n) => { say(`配音 ${i}/${n}`); bar(i / n * 0.22); });
      const T = tl();
      const pcm = Voice.pcm(parts, { gap: T.gap, head: T.head, dur: T.dur, sampleRate: S.sr });
      S.tl = T;

      const frames = Math.round(T.dur * Encoder.FPS);
      const blob = await Encoder.encode({
        canvas: cv, dur: T.dur, codec: await Encoder.pickCodec(false),
        draw: (c, t) => Renderer.renderFrame(c, t, T, style()),
        audio: { pcm, sampleRate: S.sr },
        onPhase: ph => { if (ph === 'audio') { say('混配音…'); bar(0.95); } },
        onProgress: (i, n) => {
          if (!S.busy) throw new Error('已停下');     // 停按钮：把 S.busy 清掉，这里就抛出去打断编码
          if (i % 30 === 0) { say(`画面 ${i}/${n} 帧`); bar(0.22 + i / n * 0.7); }
        },
      });
      S.lastBlob = blob;
      S.lastName = `成片-${stamp()}.mp4`;
      Encoder.dl(blob, S.lastName);
      S.outAt = Date.now();                     // 这篇出过片了：档案那行会标「🎬 已出片」
      await persistNow();
      paintHead();
      if (S.noteId) { try { await filmPut(S.noteId, blob); } catch (_) {} }   // 档案里能回放这条片子
      say(`完成 ${(blob.size / 1048576).toFixed(1)}MB · ${T.dur.toFixed(1)}s · 已下载`);
      bar(1);
      doneOpen(blob);
    } catch (e) {
      say('出片失败');
      warn(String((e && e.message) || e));
      console.error(e);
    } finally {
      S.busy = false; $('go').disabled = false; $('stop').hidden = true;
    }
  }

  /* ---------- 成片预览（出完片就摊开这一层：当场回放，然后回档案） ----------
     视频留在本机（blob），「✓ 完成，回档案」把结果递回 popup：那边回档案、把这一篇那行闪一下。
     单开一页（不是从档案进来的、没有 noteId）就不摆回档案那颗钮。 */
  function doneOpen(blob) {
    const d = $('done');
    if (!d) return;
    doneClose();
    S.doneUrl = URL.createObjectURL(blob);
    const v = $('doneV');
    v.src = S.doneUrl;
    $('doneInfo').textContent = (blob.size / 1048576).toFixed(1) + 'MB · 已下载一件，本机也存了一份';
    $('doneBack').hidden = !(EMBED && S.noteId);
    d.hidden = false;
    try { v.play().catch(() => {}); } catch (_) {}
  }
  function doneClose() {
    const d = $('done');
    if (d) d.hidden = true;
    if (S.doneUrl) { try { URL.revokeObjectURL(S.doneUrl); } catch (_) {} S.doneUrl = ''; }
    const v = $('doneV');
    if (v) { try { v.pause(); } catch (_) {} v.removeAttribute('src'); v.load(); }
  }
  S.doneOpen = doneOpen; S.doneClose = doneClose;   // 自检脚本用它摊开/收起
  $('doneAgain').onclick = () => { if (S.lastBlob) Encoder.dl(S.lastBlob, S.lastName || '成片.mp4'); };
  $('doneX').onclick = () => doneClose();
  $('doneBack').onclick = () => {
    const noteId = S.noteId;
    persistNow().then(() => {
      try { parent.postMessage({ type: 'xhsFilmDone', noteId, outAt: S.outAt || 0 }, location.origin); } catch (_) {}
      doneClose();
      say('已存好——回档案了');
    });
  };
  /* 顶栏「← 返回档案」（弹窗里才显示）：先把这一篇的稿与幕存好，再让 popup 切回档案 */
  $('back').onclick = () => {
    persistNow().then(() => {
      try { parent.postMessage({ type: 'xhsFilmBack', noteId: S.noteId }, location.origin); } catch (_) {}
      say('已存好——回档案了');
    });
  };

  /* ---------- 启动 ---------- */
  async function init() {
    paintHead();
    const [cfgLine, voiceCfg, script] = await Promise.all([
      store.get(KEY_STYLE), store.get(KEY_VOICE), store.get(KEY_SCRIPT)]);
    if (cfgLine) S.cfg = Renderer.parseCfg(cfgLine);
    if (voiceCfg) { S.voice = voiceCfg.voice || S.voice; S.rate = voiceCfg.rate || S.rate; }
    if (script) S.script = String(script);
    buildStyleUI(); buildVoiceUI(); renderScriptSec(); renderScenes(); paintFoot();
    draw(0.45);                                   // 先画片头那一帧，页面不空着
    if (!EdgeTTS.isEdge()) {
      warn('建议用 Edge 打开本页：配音走微软给 Edge 的免费通道，换别的浏览器念不出声（画面不受影响）。');
    }
    say('就绪');
  }

  /* 弹窗「拿去出片」就地递稿子进来用（等价于「粘稿 + 生成分幕」，单开一页口径）；
     正在出片就不动它。opts.frame='card' 时顺手把画面切成卡片轮播；带 opts.shots（出图那张画面表）
     就按第 N 张画面安第 N 幕的底图，没带／张数对不上才退回素材库顺序铺。 */
  S.loadScript = (t, opts) => {
    if (S.busy) return 'busy';
    const s = String(t || '').trim();
    if (!s) return 'empty';
    const o = opts || {};
    if (o.frame === 'card' && S.cfg.frame !== 'card') { S.cfg.frame = 'card'; buildStyleUI(); }
    S.script = s;
    S.fvFrom = ''; S.fvPN = 0; S.fvPrev = ''; S.fvPicks = null; S.fvFail = false; S.scRule = false;
    const rows = Array.isArray(o.shots) ? o.shots : [];
    if (rows.length) {
      const wasCard = {};                                 // 同一篇重进：铺过的段底图留着（按 cardKey）
      S.scenes.forEach(sc => { if (sc.cardKey && sc.card && sc.card.src) wasCard[sc.cardKey] = sc.card; });
      S.scenes = scenesFromShotRows(rows);
      S.scenes.forEach(sc => { if (sc.cardKey && wasCard[sc.cardKey] && !(sc.card && sc.card.src)) sc.card = wasCard[sc.cardKey]; });
      S.tl = null; cache.key = ''; curScene = 0; S.outAt = 0;
      renderScenes(); renderScriptSec(); drawScene(0); paintFoot(); showSec('scenes');
      if (S.noteId) persist(); else store.set(KEY_SCRIPT, s);
      warn(''); say('按「🖼 出图」那张画面表排好 ' + S.scenes.length + ' 幕（' + rows.length + ' 段）');
      if (o.frame === 'card') paveRows(rows);             // 别等：铺好一张就画一张
      return 'ok';
    }
    const n = ruleScenes(false);
    if (!n) return 'empty';
    if (S.noteId) persist(); else store.set(KEY_SCRIPT, s);
    warn('');
    say('分出 ' + n + ' 幕');
    return 'ok';
  };

  /* 从「笔记档案」那一行点进来：带 id ＝打开「这一篇」那份草稿
     （有就捡回来；没有就用递来的正文自动调口播稿；调好的稿与幕都落回这一篇）。
     外壳是同步的（popup 拿返回值判「正在出片」）；实活交给 loadNoteGo。 */
  S.loadNote = (p) => {
    if (S.busy) return 'busy';
    loadNoteGo(p || {}).catch(() => {});
    return 'ok';
  };
  async function loadNoteGo(o) {
    const id = String(o.id || '');
    const prevId = String(S.noteId || '');
    const s = String(o.script || '').trim();        // 这一篇已有的口播稿（没有＝空，等自动调）
    // 换片之前先把「上一行」那份没来得及落盘的改动存回它自己的 key（一行一份片：定时存攒着 600ms，换片会把 S.noteId 改掉）；
    // 同一篇重进（换形式 / 再点进来）也先落盘——三十七改起进站读的就是这份草稿，别让定时存里攒着的新幕被旧稿盖回去
    if (prevId) await persistNow();
    if (!id) {
      if (prevId) { S.noteId = ''; dropOtherNoteCards(prevId, ''); }   // 从某一篇切回单开一页：别带着它那一份
      S.body = ''; S.kind = ''; S.noteTitle = '';
      S.fvFrom = ''; S.fvPN = 0; S.fvPrev = ''; S.fvPicks = null; S.fvFail = false; S.scRule = false;
      S.peeking = false; S.prevPeek = false;
      S.meta = { style: '', sellPoint: '', people: [], platform: '' };
      paintHead();
      return S.loadScript(s, o);
    }
    const docs = await docsGet();
    const doc = docs[id];
    S.noteId = id;
    S.noteTitle = String(o.title || (doc && doc.title) || '');
    S.kind = String(o.kind || (doc && doc.kind) || '');
    S.body = String(o.body || (doc && doc.body) || '').trim();
    S.meta = {
      style: String(o.style || (doc && doc.meta && doc.meta.style) || ''),
      sellPoint: String(o.sellPoint || (doc && doc.meta && doc.meta.sellPoint) || ''),
      people: Array.isArray(o.people) ? o.people : ((doc && doc.meta && doc.meta.people) || []),
      platform: String(o.platform || (doc && doc.meta && doc.meta.platform) || ''),
    };
    paintHead();
    if (doc && Array.isArray(doc.scenes) && doc.scenes.length && (!s || String(doc.script || '') === s)) {
      restoreDoc(doc, o);
      // 这篇草稿早分好幕：画面表来了、且草稿里一段底图都没有时，按画面表补铺一次（已经铺过的不动）
      if (o.frame === 'card' && Array.isArray(o.shots) && o.shots.length && !S.scenes.some(sc => sc.card && sc.card.src)) paveRows(o.shots);
      return 'ok';
    }
    if (doc) {
      // 稿子换了（在写稿里重出过一版 / 手改过）：旧分幕对不上新稿，稿与幕重来；画面与配音参数还是这篇的
      if (doc.cfg) S.cfg = Renderer.parseCfg(doc.cfg);
      if (doc.voice) { S.voice = doc.voice; S.rate = doc.rate || S.rate; }
      buildStyleUI(); buildVoiceUI();
    }
    dropOtherNoteCards(prevId, id);
    S.script = s;
    S.fvFrom = ''; S.fvPN = 0; S.fvPrev = ''; S.fvPicks = null; S.fvFail = false; S.scRule = false;
    S.peeking = false; S.prevPeek = false;
    const rows = Array.isArray(o.shots) ? o.shots : [];
    if (rows.length) {
      /* 出图那张画面表：先按段把可编辑的幕铺出来（底图编排延续），「生成分幕」再走 AI 换新稿 */
      const wasCard = {};
      S.scenes.forEach(sc => { if (sc.cardKey && sc.card && sc.card.src) wasCard[sc.cardKey] = sc.card; });
      S.scenes = scenesFromShotRows(rows);
      S.scenes.forEach(sc => { if (sc.cardKey && wasCard[sc.cardKey] && !(sc.card && sc.card.src)) sc.card = wasCard[sc.cardKey]; });
      S.tl = null; cache.key = ''; curScene = 0; S.outAt = 0;
      if (o.frame === 'card') S.cfg.frame = 'card';
      renderScenes(); renderScriptSec(); drawScene(0); paintFoot(); showSec('scenes');
      say('按「🖼 出图」那张画面表排好 ' + S.scenes.length + ' 幕（' + rows.length + ' 段）');
      persist();
      if (o.frame === 'card') paveRows(rows);
    } else {
      /* 没画面表：稿进 ①，幕空着——分幕这一步走「生成分幕」那两发（AI 先提重点） */
      S.scenes = []; S.tl = null; cache.key = ''; curScene = 0; S.outAt = 0;
      renderScriptSec(); renderScenes(); drawScene(0); paintFoot(); showSec('script');
      persist();
    }
    fvKick(false);   // 没有口播稿＝进站自动按正文调一版（有稿不覆盖；B5）
    return 'ok';
  }
  /** 换了一篇（或从某一篇切回单开一页）：台子上挂着的是上一篇的底图，现分幕会按序留过来——那是串篇了 */
  function dropOtherNoteCards(prevId, id) {
    if (prevId === id) return;
    S.scenes.forEach(sc => { delete sc.card; delete sc.cardKey; });
  }
  /** 把某一篇的草稿捡回来：正文 / 口播稿 / 分幕 / 底图编排 / 配音参数一起；本机选的底图不入库，那一张要重选 */
  function restoreDoc(doc, o) {
    if (doc.cfg) S.cfg = Renderer.parseCfg(doc.cfg);
    if (doc.voice) { S.voice = doc.voice; S.rate = doc.rate || S.rate; }
    if (!S.body) S.body = String(doc.body || '').trim();
    S.script = String(doc.script || '');
    S.fvFrom = doc.fvFrom === 'body' ? 'body' : '';
    S.fvPN = Number(doc.fvPN || 0) || 0;
    S.fvPrev = String(doc.fvPrev || '');
    S.fvPicks = Array.isArray(doc.fvPicks) && doc.fvPicks.length
      ? doc.fvPicks.map(p => ({ s: String((p && p.s) || '').slice(0, 40), why: String((p && p.why) || '').slice(0, 120) }))
        .filter(p => p.s).slice(0, 5)
      : null;
    S.fvFail = false; S.scRule = false; S.peeking = false; S.prevPeek = false;
    S.scenes = (doc.scenes || []).map(sc => ({
      label: sc.label, name: sc.name || '', text: String(sc.text || ''),
      lines: (sc.lines || []).slice(), em: (sc.em || []).map(e => ({ l: e.l, t: e.t })),
      layout: sc.layout || 'center', cardKey: sc.cardKey || '',
      card: (sc.card && sc.card.src) ? Object.assign({}, sc.card) : null,
      estSec: Math.max(1.2, +(cn(sc.text) / 4.5).toFixed(2)),
    }));
    S.tl = null; cache.key = ''; curScene = 0;
    S.outAt = Number(doc.outAt || 0) || 0;
    if (o && o.frame === 'card') S.cfg.frame = 'card';
    buildStyleUI(); buildVoiceUI(); renderScriptSec(); renderScenes(); drawScene(0); paintFoot(); paintHead();
    persist();
    warn('');
    say('接上这一篇的草稿：' + S.scenes.length + ' 幕' + (S.outAt ? ' · 出过片' : ''));
  }

  /* 自检脚本驱动：不点按钮直接按画面表建幕 / 铺底图；段分组（cardRuns）还在 */
  S.buildFromRows = (rows) => {
    S.scenes = scenesFromShotRows(rows);
    S.tl = null; cache.key = ''; curScene = 0;
    renderScenes(); drawScene(0);
    return S.scenes.length;
  };
  S.paveRows = paveRows;
  S.cardRuns = () => Renderer.cardRuns(tl());
  S.askBg = (msg) => chrome.runtime.sendMessage(msg);   // 问后台的那一步留个缝：自检脚本换成桩，不打真 AI
  S.flush = () => persistNow();                          // 立刻把手上这一行的草稿落盘（离开字效编辑器／换片前叫一声，别丢最后 600ms）

  /* 内嵌时的出口：单开一页慢慢编（先把手上这份稿子存好，别让新页拿到旧稿） */
  $('popout').onclick = () => {
    const t = String(S.script || '').trim();
    const open = () => chrome.tabs.create({ url: chrome.runtime.getURL('video.html'), active: true });
    const go = () => { if (t) store.set(KEY_SCRIPT, t).then(open, open); else open(); };
    if (S.noteId) persistNow().then(go, go); else go();
  };
  $('audition').onclick = audition;
  $('go').onclick = make;
  $('stop').onclick = () => { S.busy = false; say('停了'); warn('已停下（画面可能有半截，重出一次就好）'); };

  // 关页/关弹窗那一下把攒着的改动落盘（弹窗一关这个 iframe 就没了，定时器不会再响）
  window.addEventListener('pagehide', () => { if (S.noteId) persistNow(); });
  $('save').onclick = async () => {
    S.cfg.voice = S.voice;
    if (S.noteId) {
      await persistNow();                                   // 跟着某一篇：旋钮存进那一篇的草稿
      $('saved').textContent = '已记住：' + VOICES.short(S.voice) + ' ' + S.rate + '（存这一篇）';
      return;
    }
    await store.set(KEY_STYLE, Renderer.cfgLine(S.cfg));
    await store.set(KEY_VOICE, { voice: S.voice, rate: S.rate });
    $('saved').textContent = '已记住：' + VOICES.short(S.voice) + ' ' + S.rate;
  };
  $('copy').onclick = async () => {
    S.cfg.voice = S.voice;
    const line = Renderer.cfgLine(S.cfg);
    try { await navigator.clipboard.writeText(line); $('saved').textContent = '配置行已复制'; }
    catch (e) { $('saved').textContent = line; }
  };

  init();
})();
