/* 字效编辑器（扩展里）：一屏一站「🎬 分幕」——左边口播稿、右边分幕，进站 AI 一路直出
 * （按正文调口播稿 → 提重点 → 按重点改出「出片稿」→ 切幕）→ 配音 → 逐帧画面 → 一条带配音的 MP4。
 *
 * 跟开发侧的 调风格.html / render_style_film.py 是同一套引擎（lib/video 里就是那几个文件），
 * 差别只在配音：这边用 EdgeTTS 直连免费通道，逐幕念、量出真实秒数后现排时间轴——
 * 所以换音色 / 改文案都不用回来重出，点一下重算就行。
 *
 * 2026-10-16 七十一改（老板三条）：
 * - 口播稿与分幕并成一屏（原来两站跳着走），顶上那条工作流条跟着只剩「🎬 分幕」一站；
 * - 进站自动一路直出：提重点＋按重点出分幕都自动跑，重点只读留在稿子上方（要换个切法点「↻ 重新出一版」）；
 * - 底栏撤掉「上一步／下一步」，只留「🎬 出片（配音 + 画面）」——稿子齐了直接出片。
 * - 没配 AI / 失败 / 不合法 → 回退本机规则（Scenes.fromScript）＋面板标一句「这次按本机规则分的幕」。
 * - 口播稿栈：进站带正文；没口播稿就自动按正文调一版（genNoteVoiceScript 通路）；有稿不覆盖；
 *   调好的稿写回这一篇（np_notes[n.id].voice，正文不动）。调稿失败 → 正文直接当稿用＋标注。
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  /* ══ 第 3 批「拆墙」：这一台的零件不再锁在另一页里，现搭到 #filmPane 上 ══
     两个宿主共用这同一份零件（video.html 里那个空的 #filmPane，跟「发笔记」那一页里的那个）：
     · 带 data-inline＝落在发笔记那页里：顶栏／工作流条／底栏交回外层那页画，这里那三件只当状态存身；
     · 不带＝「↗ 在新标签页打开」那一页：自己画一整套。
     样式全挂在 #filmPane 底下（lib/video/video.css），所以零件的名字不用改、也不会漏到外面那页去。 */
  const PANE_HTML = `
<header>
  <span class="mark">🎬</span>
  <b id="headKind">出片</b>
  <span class="tiny" id="noteTitle"></span>
  <span class="outflag" id="outFlag" hidden>🎬 已出过片</span>
  <span class="qhelp" tabindex="0" data-tip="配音与画面都在本机算出来；按正文调口播稿、提重点那两步走你自己配的 AI。全程不上传别的东西">?</span>
  <span class="hgroup">
    <button id="cfgBtn">⚙ 音色与风格</button>
  </span>
</header>

<!-- 顶上这条＝这一篇在工作流里的位置（单开一页才自己画；在工作流里由外层那页画同一条圆点条） -->
<div class="fsteps" id="flowBar" hidden></div>

<!-- 窄屏那两签（📝 口播稿 / 🎬 分幕）：一次只看一栏；宽了这条自己收起，两栏并排照旧 -->
<div class="ftabs" id="filmTabs">
  <button type="button" class="ghost" data-ftab="script">📝 口播稿</button>
  <button type="button" class="ghost" data-ftab="scenes">🎬 分幕</button>
</div>

<main>
  <section class="col script">
    <div class="fsec" id="secScript"></div>
  </section>

  <section class="col scenes">
    <div class="fsec">
      <div class="colh">🎬 分幕 <span class="tiny" id="est"></span>
        <span class="sctabs" id="scTabs">
          <button type="button" class="ghost" data-sctab="lines">分幕</button>
          <button type="button" class="ghost" data-sctab="pic">画面<span class="dot" id="picDot"></span></button>
        </span>
      </div>
      <div id="scLines" class="scbody">
        <div id="scenes" class="scenes"><div class="empty">还没分幕——AI 正在按口播稿出片稿切幕。</div></div>
      </div>
      <!-- 画面这一签：不加＝纯大字；加了才是「垫一层底」，实拍／照片垫满屏或图垫进卡 -->
      <div id="scPic" class="scbody" hidden>
        <div class="pichead">
          <span class="swbox" id="picSw">
            <button type="button" data-pic="off">不加</button>
            <button type="button" data-pic="on">加画面</button>
          </span>
          <span class="chips" id="picKind" hidden>
            <span class="chip" data-pickind="mix">🎞 垫满屏</span>
            <span class="chip" data-pickind="card">🃏 垫进卡</span>
          </span>
        </div>
        <div class="empty" id="picOffHint">不加画面＝纯大字：字效照旧，不用挑料。</div>
        <div class="mixbar" id="mixBar" hidden></div>
        <div class="cardBar" id="cardBar" hidden></div>
        <div class="matlist" id="matList" hidden></div>
      </div>
    </div>
  </section>

  <section class="left">
    <canvas id="cv" width="1080" height="1920"></canvas>
    <div id="done" hidden>
      <video id="doneV" controls playsinline></video>
      <div class="donebar">
        <span id="doneInfo" class="tiny"></span>
        <button id="doneAgain" class="ghost">💾 再下一遍</button>
        <button id="doneBack" class="primary" hidden>✓ 完成，回档案</button>
        <button id="doneX" class="ghost" title="收起这一层，接着编">✕</button>
      </div>
    </div>
    <div class="hint" id="warn" hidden></div>
  </section>
</main>

<!-- 底栏：一站一屏，没有步进——只留「🎬 出片」主钮＋进度/状态（在工作流里时这颗由外层那页画） -->
<div class="np-pinbar">
  <button id="go" class="primary">🎬 出片（配音 + 画面）</button>
  <button id="stop" class="ghost" hidden>⏹ 停</button>
  <div class="prog"><div id="bar"></div></div>
  <div id="st" class="st">就绪</div>
  <div id="footHint" class="tiny"></div>
</div>

<!-- ⚙ 音色与风格：🔊 音色（嗓子 / 语速 / 试听）＋ 🎨 风格（预设 / 旋钮 / 存默认），改完直接按新的出片 -->
<div id="cfgMask" hidden>
  <div id="cfgBox">
    <h3>⚙ 音色与风格</h3>
    <p class="fhint">拨一下画布就变——出片按这里的走；关掉弹窗接着编。</p>
    <div class="cfgh">🔊 音色</div>
    <table class="vtab" id="voices"></table>
    <div class="row">
      <span class="lab">语速</span>
      <div id="rates" class="chips"></div>
    </div>
    <div class="row">
      <button id="audition" class="ghost">🔊 试听这条</button>
      <span class="tiny" id="audinfo"></span>
    </div>
    <hr class="cfgsep">
    <div class="cfgh">🎨 风格</div>
    <div id="presets" class="chips"></div>
    <div id="knobs" class="knobs"></div>
    <div class="row">
      <button id="save" class="ghost">💾 存为默认风格</button>
      <button id="copy" class="ghost">📋 复制配置行</button>
      <span class="tiny" id="saved"></span>
    </div>
    <div class="cfgfoot"><button id="cfgOk" class="primary">好，接着编</button></div>
  </div>
</div>

<!-- 挑画面这一层：左边一栏＝文件夹＋搜索，右边＝段／照片的格子；点一格就配到刚才那一屏 -->
<div id="matMask" hidden>
  <div id="matBox">
    <h3>🎞 挑画面 <span class="tiny" id="matFor"></span></h3>
    <div class="mattools">
      <select id="matFolder" class="matsel"></select>
      <input id="matQuery" class="matq" placeholder="按名字 / 标签 / 说明找">
      <button id="matClose" class="ghost" type="button">✕ 关掉</button>
    </div>
    <div class="matgrid" id="matGrid"></div>
    <p class="fhint" id="matEmpty" hidden></p>
    <p class="fhint">段放的是原视频里的那一刀（本机播放，不上传）；照片库里只存了张小图，要清楚先在分幕那栏上面点「补照片原图」。</p>
  </div>
</div>

<!-- 出片中这一层：整页封住，只留「⏹ 停」；左边那块小画面＝正在录／正在编的东西，右边是流程节点
     （老板 10-18：光在底栏弹一行字，客户看着像系统卡死了） -->
<div id="filmRun" hidden>
  <div id="filmRunBox">
    <h3>🎬 正在出片 <span class="tiny" id="frCount"></span><span class="tiny" id="frElapsed"></span></h3>
    <div class="frbody">
      <div class="frviewwrap">
        <canvas id="frView" width="288" height="512"></canvas>
        <div class="frviewcap">正在出片的画面</div>
      </div>
      <ol class="frnodes" id="frNodes"></ol>
    </div>
    <div class="frline" id="frLine">准备中…</div>
    <div class="frfoot">
      <span class="tiny" id="frEta"></span>
      <button id="frStop" class="ghost" type="button">⏹ 停</button>
    </div>
    <p class="frhint" id="frHint"></p>
  </div>
</div>

<div id="toast" hidden></div>
`;

  const pane = document.getElementById('filmPane');
  if (!pane) return;                    // 这一档没开本机出片（台子整块被摘掉）：这台引擎不启动
  pane.innerHTML = PANE_HTML;
  const KEY_STYLE = 'xhsFilmStyle', KEY_VOICE = 'xhsFilmVoice', KEY_SCRIPT = 'xhsFilmScript';
  const KEY_FONTPACK = 'xhsFilmFontPack';  // 字体来源：'sys'＝系统自带（不等下载）／'bundled'＝内置思源；这台浏览器记一次就够用
  const KEY_DOCS = 'xhsFilmDocs';      // 按篇存的草稿：{ [笔记档案 id]: {body, script, scenes, cfg, voice, rate, outAt, fv*} }
  // INLINE＝内容落在「发笔记」那一页里（同一个页面、同一套外壳，跳过去不再是换了个软件）；
  // 单开一页（video.html，不带 data-inline）还是自己画头顶尾。
  const INLINE = pane.getAttribute('data-inline') === '1';
  if (INLINE) pane.classList.add('inline');
  const cv = $('cv');
  const ctx = cv.getContext('2d', { alpha: false });

  const S = {
    script: '',        // 左边框里现在的稿子：口播稿；按重点出过分幕后＝那版「出片稿」
    body: '',          // 这一篇的正文（进站带来；只给 AI 调稿用，框里不动它）
    fvFrom: '',        // 'body'＝这版口播稿是 AI 按正文调的；''＝手整的
    fvPrev: '',        // 上一版稿（按重点改之前），「↩ 看上一版」用
    fvPN: 0,           // 「分幕按 N 个重点又改过（框里这版＝出片稿）」
    fvPicks: null,     // 重点（只读留档）：[{s, why}]——AI 自动提完摆在稿子上方，想换个切法点「↻ 重新出一版」
    fvFail: false,     // 这次没调口播稿——正文直接当稿用（B5 兜底）
    fvStage: '',       // 一路直出跑到哪一步了：调口播稿 / 提重点 / 出片稿切幕（转圈卡上那句话）
    fvEdited: false,   // 稿子在这版分幕之后被手改过字（提示：改幕点「↻ 重新出一版」）
    peeking: false,    // 摊着看原正文
    prevPeek: false,   // 摊着看上一版
    genBusy: false,    // 一路直出正在跑（调稿→提重点→出片稿切幕）
    scRule: false,     // 这批分幕是按本机规则切的（AI 没成，B1 兜底）
    kind: '',          // 这一篇的成片形式（PPT字体动效 / 卡片画面叙事）
    meta: { style: '', sellPoint: '', people: [], platform: '' },   // 调稿给 AI 的料（进站递）
    scenes: [],
    cfg: Object.assign({}, Renderer.DEFAULT_CFG),
    fontPack: 'sys',     // 内置字体这件事：'sys'＝用电脑自带字体先顶着（默认，不占网），'bundled'＝内置思源（第一次要下几兆）
    voice: 'zh-CN-XiaoxiaoNeural',
    rate: '+20%',
    tl: null,          // 有真配音秒数后才有：{scenes:[{start,end}], dur}
    sr: 0,             // 这台机器编得动的 AAC 采样率（pickRate 挑出来的）；边播边录时＝AudioContext 的采样率
    busy: false,
    cancelFilm: null,  // 边播边录时「⏹ 停」拉到的那只取消钩子
    lastBlob: null,
    lastName: '',
    noteId: '',        // 从「笔记档案」里点进来那一篇：草稿跟它绑着（空＝单开一页的老口径）
    noteTitle: '',
    flow: [],          // 顶上那条工作流条的前几站名（外层递 [{t:'挑知识'},…]；单开一页从 ?flow= 接）
    outAt: 0,          // 这一篇最近出成片的时间（0＝还没出过）
    doneUrl: '',       // 成片预览那层正在放的那条（objectURL，收起时撤销）
    ftab: 'script',    // 窄屏那两签看哪一栏（'script'／'scenes'）；宽了＝两栏并排，这个不管用
    sctab: 'lines',    // 分幕那栏里看哪一签：'lines'＝改字，'pic'＝配画面
    picKind: 'mix',    // 上次挑的垫法：'mix' 垫满屏（实拍／照片）／'card' 垫进卡；关掉「加画面」也记着
    shots: [],         // 「🖼 出图」那张画面表（进站递来）：切「垫进卡」时按它铺底图，不用重进这一篇
    state: null,       // 递给外层那份小抄的备份（外层随时来问，不用等下一次动）
    onState: null,     // 外层那页挂上来的两只钮：小抄怎么收、出完片怎么回档案（单开一页不挂）
    onDone: null,
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

  /* 外层那页（「发笔记」这一页）挂上来的带路钮：出完片那一下「✓ 完成，回档案」交给它带路。
     单开一页没挂这个（那页自己画头顶尾，也没有工作流可回）。 */
  function askHost(hook, arg) {
    const h = S[hook];
    if (typeof h !== 'function') return;
    try { h(arg); } catch (_) {}
  }
  /* 顶上那条工作流条：本台只剩一站（七十一改·老板「口播稿和分幕都能 AI 一步直达，那就并成一屏：
     左边口播稿、右边分幕就搞掂了」）——两站并成一站，条上写「🎬 分幕」，底栏没步进，只留「🎬 出片」。
     单开一页才在这里画；落在「发笔记」那一页里时这条由外层画（paintFlowBar 直接回）。 */
  const FILM_STATIONS = [{ t: '🎬 分幕', s: '左稿右幕' }, { t: '发布', s: '去发布台', pub: true }];
  const FLOW_SUB = { '挑知识': '讲哪条', '改稿': '改到满意', '挑组合': '挑一组', '挑稿': '挑一篇' };
  const FILM_TIPS = {
    '🎬 分幕': '进来一路跑完：按正文调口播稿 → AI 提重点 → 按重点改出「出片稿」→ 切幕，中途不用点。左边那框＝现在用来出片的稿，想换个切法点「↻ 重新出一版」；右边一幕一句：念的就是框里的字，要分屏上行就在断开的地方打个 /（念的时候不念它），重点词是给屏幕上标红的。分幕文字不必跟正文逐字一样。',
  };
  /* 这条＝圆点款，跟写稿向导那一条同一个画法。只有「单开一页」那一页自己画（前几站摆灰：
     那边没有写稿向导可回，在工作流里点这一篇才回得去）；落在发笔记那页里时这条由外层画，这里不画。 */
  function paintFlowBar() {
    const el = $('flowBar');
    if (!el || INLINE) return;
    const sts = (Array.isArray(S.flow) ? S.flow : [])
      .map(s => ({ t: String(s && s.t || ''), s: FLOW_SUB[String((s && s.t) || '')] || '' }))
      .filter(s => s.t).concat(FILM_STATIONS);
    const cur = sts.length - FILM_STATIONS.length;    // 本台这一站（🎬 分幕）就是当前站
    el.hidden = false;
    el.innerHTML = '<div class="wdots">' + sts.map((s, i) => {
      const done = i < cur, at = i === cur;
      const tip = s.pub ? '先出片才到发布——这一页是单开的，回档案那一行点「下一步」才排得到发布台'
        : at ? '正在这一站：左边口播稿、右边分幕'
          : done ? '这一站已经走过了；单开一页没有工作流可回——在工作流里点这一篇才回得去' : '本台这一站';
      return '<span class="wst"><span class="wdot' + (at ? ' lit cur' : '') + '" title="' + esc(tip) + '">' + (i + 1) + '</span>' +
        '<span class="wlbl' + (at ? ' cur' : (done ? ' past' : '')) + '">' + esc(s.t) +
        (FILM_TIPS[s.t] ? '<span class="qhelp" tabindex="0" data-tip="' + esc(FILM_TIPS[s.t]) + '">?</span>' : '') +
        '<i>' + esc(s.s || '') + '</i></span></span>' +
        (i < sts.length - 1 ? '<span class="wlink' + (i <= cur ? ' lit' : '') + '"></span>' : '');
    }).join('') + '</div>';
  }

  /* ---------- 小工具 ---------- */
  let _prog = 0;
  /* 外壳（顶栏／工作流条／底栏）画在外层那页，这里每动一下状态就递一份小抄过去：
     那边照着画「跑到哪一步／几幕／出没出过片／进度条」。单开一页自己画一套，不用递。 */
  function emitState() {
    if (!INLINE) return;
    const p = { noteId: S.noteId, kind: S.kind, title: S.noteTitle, outAt: S.outAt,
      frame: S.cfg.frame, busy: S.busy, genBusy: S.genBusy, stage: S.fvStage, scenes: S.scenes.length,
      st: $('st') ? $('st').textContent : '', foot: $('footHint') ? $('footHint').textContent : '',
      warn: ($('warn') && !$('warn').hidden) ? $('warn').textContent : '', prog: _prog,
      flow: S.flow };
    S.state = p;                         // 自己留一份：外层随时来问（不用等下一次动）
    askHost('onState', p);
  }
  const say = s => { $('st').textContent = s; emitState(); };
  const bar = p => { _prog = Math.max(0, Math.min(1, p)); $('bar').style.width = (_prog * 100).toFixed(1) + '%'; emitState(); };
  const warn = (s) => { const w = $('warn'); w.hidden = !s; w.textContent = s || ''; emitState(); };
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

  /* ---------- 顶栏（标题 / 这一片是哪一篇 / 已出过片）——落在发笔记那页里时这几格只当状态存身，画在外层 ---------- */
  function paintHead() {
    $('headKind').textContent = S.kind ? ('出片 · ' + S.kind) : '出片';
    $('noteTitle').textContent = S.noteTitle ? ('《' + S.noteTitle + '》') : '';
    $('outFlag').hidden = !(S.noteId && S.outAt);
    paintFlowBar();                        // 出过片＝「发布」站放开，换篇＝能回的工作流变了，都跟着顶栏重画
    emitState();
  }
  /* 底栏那句说明（一站一屏，没有步进按钮；顺带重画顶上那条工作流条） */
  function paintFoot() {
    const vo = (typeof VOICES !== 'undefined' && VOICES.short) ? VOICES.short(S.voice) : S.voice;
    $('footHint').textContent = S.scenes.length
      ? '分幕 ' + S.scenes.length + ' 幕 · ' + (S.fvEdited ? '稿子改过字——点「↻ 重新出一版」才按新稿切' : '配' + vo + '念左边这版稿')
      : S.genBusy ? 'AI 正在' + (S.fvStage || '出片稿') + '…'
        : '还没分幕——点稿子上方「✨ 出片稿 + 分幕」';
    paintFlowBar();
    emitState();
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
      cardKey: sc.cardKey || '', tone: sc.tone || '',
      card: (sc.card && sc.card.src && sc.card.kind !== 'file')
        ? { src: sc.card.src, name: sc.card.name || '', kind: sc.card.kind, id: sc.card.id || '' } : null,
      // 混剪的料只留引用（一屏一单，库里那条 id＋仓 key；照片那张小图回库按 clipId 取，不往草稿里抄）
      // 每一节播几秒／回环几秒是照这一屏的秒数现算的，不存——配音真秒数一变就得重排
      mats: (sc.mats || []).map(m => ({
        clipId: m.clipId || '', kind: m.kind, name: m.name || '', tags: (m.tags || []).slice(),
        a: m.a || 0, b: m.b || 0, dur: m.dur || 0,
        ref: m.kind === 'clip' ? (m.ref || '') : '',
        src: /^data:/.test(String(m.src || '')) ? m.src : '',
      })),
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
        fvEdited: !!S.fvEdited,
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
      tc.mats = sc.mats; tc.tone = sc.tone;                         // 混剪的料与每一屏的调同理：以台子上这几幕为准
      tc.matPlan = matPlan(sc, +(tc.end - tc.start).toFixed(2));    // 这一屏怎么排：按真秒数现算
    });
    return T;
  };
  S.timeline = tl;                // 自检脚本要按当前时间轴逐帧验画面（没有真配音时给的是估算那条）
  S.matPlanAt = (i, sec) => matPlan(S.scenes[i] || {}, sec === undefined ? sceneSec(i) : sec);   // 这一屏的料怎么排：自检按它验碎尾/回环
  S.paintAt = (t) => draw(t);                     // 走真那一路（先对料、再画这一帧）
  const style = () => Renderer.buildStyle(S.cfg);

  function draw(t) {
    const T = tl();
    matSync(t, T);
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
      b.onclick = () => {
        // 预设只管「长什么样」：画面垫法、背景音乐、音效不属于风格，换预设时原样留着
        const keep = { frame: S.cfg.frame, bgm: S.cfg.bgm, sfx: S.cfg.sfx };
        S.cfg = Object.assign({}, Renderer.DEFAULT_CFG, Renderer.PRESETS[k].cfg, keep);
        buildStyleUI(); afterStyle();
      };
      pv.appendChild(b);
    });

    const kn = $('knobs');
    kn.innerHTML = '';
    // 「画面」这一层搬到了分幕那栏的「画面」页签里（加不加／垫满屏／垫进卡），面板上不再重复摆；
    // 背景音乐／音效跟着「有没有底」走：不加画面就只有配音，加了（实拍或卡）才摆
    Renderer.FIELDS.filter(f => f.k !== 'frame' && (!f.mixOnly || S.cfg.frame !== 'text')).forEach(f => {
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
    if (!Fonts.EAGER) fontPackRow(kn);   // 公网那台才摆这颗：你电脑那份字体随包带着，没得选
  }
  /** 拨了旋钮：预览重画（并按篇记下来）；加了实拍底还要把这一栏的画面料对一遍 */
  function afterStyle() {
    paintPicPane();
    if (S.cfg.frame === 'mix' && S.scenes.some(sc => matsOf(sc).some(m => m.kind === 'photo' && !m.img))) {
      prepMats().then(() => drawScene(curScene)).catch(() => {});
    }
    drawScene(curScene); persist(); emitState();
  }

  /* ---------- 字体来源（公网那台）：默认「系统自带」＝进页面一兆都不下、随时点出片；
     切「内置思源」才下这一档用得上的那款（黑体 4 兆，选宋体再多 6 兆），下完这台浏览器存着，以后不再下。 ---------- */
  let fpTip = null;
  const bundledFams = () => {
    const fams = ['Noto Sans SC'];                       // 编号、合规小字这些一直用它
    const f = S.cfg.font;
    if (f === 'serif' || (f === 'kai' && !document.fonts.check('16px KaiTi'))) fams.push('Noto Serif SC');
    return fams;
  };
  function fpText() {
    if (S.fontPack !== 'bundled') return '出片直接用你电脑自带的字体，不等下载；比内置的糙一点，快。';
    const down = [], err = [];
    bundledFams().forEach(f => {
      const s = Fonts.state[f] || '';
      if (s === 'down') down.push(f); else if (s === 'err') err.push(f);
    });
    if (down.length) return '正在下 ' + down.reduce((a, f) => a + (Fonts.MB[f] || 0), 0) + ' 兆…（下好这台浏览器就存着，以后不用再下）';
    if (err.length) return '有几款没下成（网不好）——再点一次「内置思源」重试；出片先用自带字体顶着。';
    return '已下好 · 以后都用它';
  }
  function paintFpTip() { if (fpTip) fpTip.textContent = fpText(); }
  function fontPackRow(kn) {
    const lab = document.createElement('div');
    lab.className = 'k'; lab.textContent = '字体来源';
    const box = document.createElement('div');
    box.className = 'chips';
    [['sys', '系统自带（不等）'], ['bundled', '内置思源（更像样片）']].forEach(pair => {
      const c = document.createElement('div');
      c.className = 'chip' + (S.fontPack === pair[0] ? ' on' : '');
      c.textContent = pair[1];
      c.onclick = () => { S.fontPack = pair[0]; store.set(KEY_FONTPACK, pair[0]); buildStyleUI(); afterStyle(); };
      box.appendChild(c);
    });
    fpTip = document.createElement('div'); fpTip.className = 'fptip';
    kn.appendChild(lab); kn.appendChild(box); kn.appendChild(fpTip);
    if (S.fontPack !== 'bundled') { paintFpTip(); return; }
    const job = Fonts.need(bundledFams());   // 先开下（状态立刻变「正在下」），再写那行字，别先报「没下成」
    paintFpTip();
    job.then(() => { paintFpTip(); drawScene(curScene); });
  }

  /* 出片前这一关：你电脑那份照旧等随包字体；公网那台默认不等（自带字体先顶着），
     只有拨到「内置思源」又还没下完才在这儿等，并且把「在下几兆」说清楚。 */
  async function fontGate() {
    if (Fonts.EAGER) { FR.line('等字体…'); say('等字体…'); await Fonts.ready; return; }
    if (S.fontPack !== 'bundled') {
      const t = '用你电脑自带的字体画（不等下载）'; say(t); FR.line(t); return;
    }
    const fams = bundledFams(), missing = fams.filter(f => Fonts.state[f] !== 'ok');
    if (!missing.length) { const t = '内置字体已就位'; say(t); FR.line(t); return; }
    const t = '字体还在下（第一次约 ' + missing.reduce((a, f) => a + (Fonts.MB[f] || 0), 0) + ' 兆，下好这台浏览器就存着了）';
    say(t); FR.line(t); FR.wait = t;
    try { await Fonts.need(fams); } finally { FR.wait = ''; }
    paintFpTip();
  }

  /* ---------- ⚙ 音色与风格 弹窗 ---------- */
  const cfgMask = $('cfgMask');
  function cfgOpen() { cfgMask.hidden = false; }
  function cfgClose() { cfgMask.hidden = true; }
  $('cfgBtn').onclick = cfgOpen;
  $('cfgOk').onclick = cfgClose;
  cfgMask.addEventListener('click', (ev) => { if (ev.target === cfgMask) cfgClose(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !cfgMask.hidden) cfgClose(); });

  /* ---------- 🎬 分幕这一站 ---------- */
  let curScene = 0;

  function renderScenes() {
    const box = $('scenes');
    if (!S.scenes.length) {
      box.innerHTML = '<div class="empty">' + (S.genBusy
        ? 'AI 正在按口播稿出片稿、切幕（' + esc(S.fvStage || '出片稿') + '）…'
        : '还没分幕——点左边稿子上方那颗「✨ 出片稿 + 分幕」') + '</div>';
      $('est').textContent = '';
      paintPicPane();
      paintFoot();
      return;
    }
    box.innerHTML = '';
    if (S.scRule) {
      const n = document.createElement('div');
      n.className = 'fvnote';
      n.textContent = '这次按本机规则分的幕——没配 AI 或这次没跑成；改完稿点「↻ 重新出一版」走一遍 AI。';
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
    paintPicPane();
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
    out.forEach((sc, k) => { sc.label = String(k + 1).padStart(2, '0'); });   // 每行都从 01 起编：整条连起来重编
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
    paintPicPane();                       // 底图是异步铺的：那一签底下的名与「几幕有图」跟着重画，别停在旧话
    drawScene(curScene); persist();
    return k;
  }

  /* ══════════ 混剪那一路的画面料（画面＝混剪实拍时用） ══════════
     料只有两个来源：切片台切好的段（np_clips：ref='src:<原视频id>' 或 'mat:<篇id>:<素材id>'，a/b＝起止秒），
     和素材库里的纯图（imgOnly，库里只留 ≤160px 小图）。原视频本体在 xhsCase 仓，只在这台电脑上放、不上传。
     一屏可以拼好几节（一句话十几秒、一段素材只有几秒时靠拼）；照片屏不拼，一屏就一张。
     每节播多久不存，照这一屏的秒数现算（见 matPlan）；没配料的屏留深色纯大字，出片前会报缺几屏。 */
  const MAT_DB = 'xhsCase', MAT_STORE = 'case';
  let _matDb = null;
  const matDb = () => _matDb || (_matDb = new Promise((res, rej) => {
    let rq;
    try { rq = indexedDB.open(MAT_DB, 1); } catch (e) { rej(e); return; }
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains(MAT_STORE)) db.createObjectStore(MAT_STORE, { keyPath: 'key' });
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error || new Error('素材仓打不开'));
  }));
  async function matBlob(key) {
    if (!key) return null;
    const db = await matDb();
    return await new Promise((res, rej) => {
      const tx = db.transaction(MAT_STORE, 'readonly');
      const rq = tx.objectStore(MAT_STORE).get(key);
      rq.onsuccess = () => res((rq.result && rq.result.blob) || null);
      rq.onerror = () => rej(rq.error);
    });
  }
  async function libRead(key) {
    try {
      const d = await chrome.storage.local.get(key);
      const a = d && d[key];
      return Array.isArray(a) ? a : [];
    } catch (_) { return []; }
  }
  let _matLib = null;
  /** 素材库那一摊读一次：文件夹（np_collections 里 folder:true）＋段／照片（np_clips）＋原视频表（np_videos） */
  async function matLib(fresh) {
    if (_matLib && !fresh) return _matLib;
    const [cols, clips, vids] = await Promise.all([
      libRead('np_collections'), libRead('np_clips'), libRead('np_videos')]);
    const videos = {};
    vids.forEach(v => { if (v && v.id) videos[String(v.id)] = v; });
    _matLib = {
      folders: cols.filter(c => c && c.folder),
      segs: clips.filter(c => c && (c.imgOnly || c.videoId || /^(src|mat):/.test(String(c.ref || '')))),
      videos,
    };
    return _matLib;
  }
  const matRefOf = c => {
    const r = String(c.ref || '');
    if (/^(src|mat):/.test(r)) return r;
    return c.videoId ? ('src:' + c.videoId) : '';
  };
  /** 库里那条 → 挂到这一幕上的料（只留引用与库里那张小图，原图不进草稿） */
  function matOf(c) {
    const photo = !!c.imgOnly;
    const a = photo ? 0 : Math.max(0, Number(c.a) || 0);
    const b = photo ? 0 : Math.max(a + 1, Number(c.b) || (a + (Number(c.dur) || 3)));
    return {
      clipId: String(c.id || ''), kind: photo ? 'photo' : 'clip',
      name: String(c.name || c.src || '素材').slice(0, 24),
      tags: (Array.isArray(c.tags) ? c.tags : []).slice(0, 4),
      a, b, dur: photo ? 0 : Math.max(1, +(b - a).toFixed(2)),
      ref: photo ? String(c.thumb || '') : matRefOf(c),
      src: '',
    };
  }
  const matLabel = m => (m.kind === 'photo' ? '🖼 ' : '🎞 ') + (m.name || '素材') +
    (m.kind === 'clip' ? ('（' + m.dur + 's）') : '');
  const matsOf = sc => (Array.isArray(sc.mats) ? sc.mats : []).filter(Boolean);
  const matFailOf = sc => !matsOf(sc).length && !!sc.matFail;   // 真配不到：没料，且 AI 那趟也没找到能垫的
  const TONE_NAME = { low: '咚', high: '啵', flat: '轻一下' };   // 字弹出来那一下响什么：坑→咚／好处→啵／平常→轻一下
  const MIN_TAIL = 2;    // 最后一节短过这个数就是碎尾——画面闪一秒就走，宁可摊掉
  const MAX_LOOP = 3;    // 一节从头再播最多补这么多秒，缺口更大就报「还差几秒」让人补段或把这句改短

  /** 这一屏的料单排成怎么播：按原片里的先后 → 超出这一屏秒数的截掉 → 碎尾摊掉 → 还差就让最后一节从头再播。
      回 { list:[{m,from,to,play,loop}], short, cut, dropped, photo }，from/to 是这一屏里的第几秒起、第几秒止。
      全是现算的（不入库）：配音真秒数一变就得重排。 */
  function matPlan(sc, sec) {
    const mats = matsOf(sc);
    if (!mats.length || !(sec > 0)) return { list: [], short: 0, cut: 0, dropped: 0 };
    const ph = mats.find(m => m.kind === 'photo');
    if (ph) {
      const s = +sec.toFixed(2);
      return { list: [{ m: ph, from: 0, to: s, play: s, loop: 0 }], short: 0, cut: 0, dropped: 0, photo: true };
    }
    const sorted = mats.slice().sort((x, y) => (x.a || 0) - (y.a || 0));
    const list = []; let acc = 0, cut = 0;
    for (const m of sorted) {
      const left = +(sec - acc).toFixed(2);
      if (left <= 0.01) { cut = +(cut + (m.dur || 0)).toFixed(2); continue; }
      const play = +Math.min(m.dur || left, left).toFixed(2);
      if (play < (m.dur || 0) - 0.01) cut = +(cut + ((m.dur || 0) - play)).toFixed(2);
      list.push({ m, from: +acc.toFixed(2), to: +(acc + play).toFixed(2), play, loop: 0 });
      acc = +(acc + play).toFixed(2);
    }
    let dropped = 0;
    while (list.length > 1 && list[list.length - 1].play < MIN_TAIL) {
      dropped = +(dropped + list.pop().play).toFixed(2);
      acc = +list[list.length - 1].to.toFixed(2);
    }
    const gap = +(sec - acc).toFixed(2);
    let short = 0;
    if (gap > 0.5 && list.length) {
      const last = list[list.length - 1];
      const loop = +Math.min(gap, last.m.generic ? gap : MAX_LOOP).toFixed(2);   // 通用垫的那节不限 3 秒：垫满这一屏
      last.loop = loop;
      last.to = +(last.from + last.play + loop).toFixed(2);
      short = +(gap - loop).toFixed(2);
    } else if (gap > 0.5) short = gap;
    return { list, short, cut, dropped };
  }
  /** 这一屏这一节眼下多少秒（有真配音用真的，没有按字数估） */
  function sceneSec(i) {
    const T = S.tl && S.tl.scenes && S.tl.scenes[i];
    if (T) return +(T.end - T.start).toFixed(2);
    const sc = S.scenes[i] || {};
    return sc.estSec || Math.max(1.2, +(cn(String(sc.text || '')) / 4.5).toFixed(2));
  }

  /* 段要真播起来：一个原视频一只 <video>，几节用同一条共用一只。
     同时只留两只（眼下这一屏＋下一屏），播过去就放掉——原片大，播放器开多了这台电脑吃不消。 */
  const _matVids = new Map();          // ref → { el, url }
  let _matCur = -1;                    // 眼下播到第几屏（决定哪几只播放器还要留着）
  function matKeep(i) {
    const s = new Set();
    [i, i + 1].forEach(k => matsOf(S.scenes[k] || {}).forEach(m => { if (m.kind === 'clip' && m.ref) s.add(m.ref); }));
    return s;
  }
  /** 只查原片在不在这台电脑上，不建播放器（备料这一趟先不占内存） */
  async function matHas(ref) {
    if (!ref) return false;
    try { return !!(await matBlob(ref)); } catch (_) { return false; }
  }
  async function matVideo(ref) {
    if (!ref) return null;
    const hit = _matVids.get(ref);
    if (hit) return hit.el;
    let blob = null;
    try { blob = await matBlob(ref); } catch (_) { blob = null; }
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    const el = document.createElement('video');
    el.muted = true; el.playsInline = true; el.preload = 'auto';
    _matVids.set(ref, { el, url });
    const keep = matKeep(_matCur);
    if (_matVids.size > 2) {
      const oldest = [..._matVids.keys()].find(k => k !== ref && !keep.has(k));
      if (oldest) {
        const v = _matVids.get(oldest);
        _matVids.delete(oldest);
        try { v.el.pause(); v.el.removeAttribute('src'); v.el.load(); } catch (_) {}
        try { URL.revokeObjectURL(v.url); } catch (_) {}
        S.scenes.forEach(sc => matsOf(sc).forEach(m => { if (m.vid === v.el) m.vid = null; }));
      }
    }
    await new Promise(res => {
      let done = false;
      const fin = () => { if (!done) { done = true; res(); } };
      const tk = setTimeout(fin, 8000);
      el.onloadeddata = () => { clearTimeout(tk); fin(); };
      el.onerror = () => { clearTimeout(tk); _matVids.delete(ref); el.src = ''; fin(); };
      el.src = url;
      try { el.load(); } catch (_) {}
    });
    return _matVids.get(ref) ? el : null;
  }
  function matVidsRelease() {
    _matVids.forEach(v => {
      try { v.el.pause(); } catch (_) {}
      try { v.el.removeAttribute('src'); v.el.load(); } catch (_) {}
      try { URL.revokeObjectURL(v.url); } catch (_) {}
    });
    _matVids.clear();
    _matCur = -1;
  }

  /** 出片前把每一节料备好：照片解成位图，段拿到播放器。回「哪几屏的料拿不到」 */
  async function prepMats() {
    const bad = [];
    const lib = await matLib(true);
    for (let i = 0; i < S.scenes.length; i++) {
      const sc = S.scenes[i], mats = matsOf(sc);
      if (!mats.length) continue;
      sc.matErr = '';
      for (const m of mats) {
        if (m.kind === 'photo') {
          if (!m.ref) {                                   // 草稿里只留了 clipId，那张小图回库里取
            const c = lib.segs.find(x => String(x.id) === String(m.clipId));
            if (c) m.ref = String(c.thumb || '');
          }
          const want = String(m.src || m.ref || '');
          if (!want) { m.img = null; bad.push({ i, msg: m.name + '：这张照片库里没留图' }); continue; }
          if (m.img && m.imgOf === want) continue;
          try { m.img = await toBitmap(want); m.imgOf = want; }
          catch (_) { m.img = null; bad.push({ i, msg: m.name + '：照片读不进来' }); }
          continue;
        }
        if (m.kind === 'clip') {                          // 段这一趟只查在不在，播放器等播到了再开
          if (m.ok === undefined) m.ok = await matHas(m.ref);
          if (!m.ok) bad.push({ i, msg: m.name + '：原视频不在这台电脑上' });
          continue;
        }
      }
      if (mats.some(m => m.ok === false)) sc.matErr = '有几节的料拿不到';
    }
    return bad;
  }
  /** 录制开跑前先把头两屏的播放器备好，别开局那几帧是空的 */
  async function matPreload() {
    _matCur = 0;
    for (let i = 0; i < 2; i++) {
      for (const m of matsOf(S.scenes[i] || {})) {
        if (m.kind !== 'clip' || m.vid) continue;
        m.vid = await matVideo(m.ref);
      }
    }
  }
  /** 边播边录：这一屏此刻播到哪一节，那一节的画面贴上去、段播到该播的那一刀。
      节放完还有话没念完＝最后一节从头再播（正着，不倒放），最多补 3 秒。 */
  function matSync(t, T) {
    if (S.cfg.frame !== 'mix') return;
    const list = (T && T.scenes) || [];
    let cur = null, seg = null, ci = -1;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!(t >= s.start && t < s.end)) continue;
      const plan = s.matPlan;
      if (!plan || !plan.list || !plan.list.length) break;
      cur = s; ci = i;
      const off = t - s.start;
      seg = plan.list.find(x => off >= x.from && off < x.to) || plan.list[plan.list.length - 1];
      break;
    }
    if (ci !== _matCur) _matCur = ci;                     // 换屏了：新播放器开起来时按这个放掉播过去的
    _matVids.forEach(v => { try { v.el.pause(); } catch (_) {} });
    if (!cur || !seg) { list.forEach(s => { s.matImg = null; s.matRun = null; }); return; }
    const m = seg.m;
    cur.matRun = { start: cur.start + seg.from, end: cur.start + seg.to };
    if (m.kind === 'photo') {
      cur.matImg = m.img || null;
      const want = String(m.src || m.ref || '');
      if (!m.img && want && !m.imgLoading) {
        m.imgLoading = toBitmap(want).then(b => { m.img = b; m.imgOf = want; }, () => {}).then(() => { m.imgLoading = null; });
      }
      return;
    }
    const v = m.vid;
    if (!v) {
      cur.matImg = null;
      if (m.ok !== false && !m.loading) m.loading = matVideo(m.ref).then(el => { m.vid = el || null; m.ok = !!el; m.loading = null; });
      return;
    }
    cur.matImg = v;
    const a = Number(m.a) || 0, b = Number(m.b) || (a + (Number(m.dur) || 3));
    const span = Math.max(.2, b - a);
    let off2 = (t - cur.start) - seg.from;
    if (off2 > seg.play) off2 = seg.play + ((off2 - seg.play) % span);   // 回环这一段：从头再播
    const want = Math.min(b, a + Math.max(0, off2));
    if (v.paused) { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
    if (Math.abs((v.currentTime || 0) - want) > 0.32) { try { v.currentTime = want; } catch (_) {} }
  }
  function paintFilmFrame(c, t, T, st) {
    matSync(t, T);
    Renderer.renderFrame(c, t, T, st);
  }

  /* ---------- 画面这一签：加不加底、垫满屏还是垫进卡 ----------
     不加＝原来那套纯大字（frame='text'）；加了才拨引擎那两颗：
     mix＝一屏垫一段实拍／一张照片（料从素材库挑），card＝每屏一张卡、字排进卡里（底图从「🖼 出图」那张画面表来）。
     换片种不再在门口选，都在这一签里拨；出片走哪条路由系统自己判（有实拍就边播边录，不占界面）。 */
  function picKindNow() {
    if (S.cfg.frame === 'mix' || S.cfg.frame === 'card') return S.cfg.frame;
    return S.picKind === 'card' ? 'card' : 'mix';       // 关着时记着上次挑的垫法，再打开照它
  }
  function paintPicPane() {
    const tabs = $('scTabs');
    if (!tabs) return;
    tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.sctab === S.sctab));
    $('scLines').hidden = S.sctab !== 'lines';
    $('scPic').hidden = S.sctab !== 'pic';
    const on = S.cfg.frame !== 'text';
    const kind = picKindNow();
    $('picDot').classList.toggle('on', on);
    $('picSw').querySelectorAll('button').forEach(b => b.classList.toggle('on', (b.dataset.pic === 'on') === on));
    $('picKind').hidden = !on;
    $('picKind').querySelectorAll('[data-pickind]').forEach(c => c.classList.toggle('on', c.dataset.pickind === kind));
    $('picOffHint').hidden = on;
    paintMixBar(); paintCardBar(); renderMatList();
  }
  /** 拨「加画面」：关着＝纯大字（料与卡都留着不删，再打开还在）；开着＝按上次挑的垫法 */
  function setPic(on) {
    if (on) S.cfg.frame = picKindNow();
    else { S.picKind = picKindNow(); S.cfg.frame = 'text'; }
    if (S.cfg.frame === 'card') ensureCards();
    buildStyleUI(); renderScenes(); afterStyle();
  }
  function setPicKind(k) {
    S.picKind = k === 'card' ? 'card' : 'mix';
    S.cfg.frame = S.picKind;
    if (S.picKind === 'card') ensureCards();
    buildStyleUI(); renderScenes(); afterStyle();
  }
  /** 手上有出图那张画面表、这一篇又一张底都没铺过：切到「垫进卡」时顺手铺一遍 */
  function ensureCards() {
    if (!Array.isArray(S.shots) || !S.shots.length) return;
    if (S.scenes.some(sc => sc.card && sc.card.src)) return;
    paveRows(S.shots);
  }
  function paintCardBar() {
    const bar = $('cardBar');
    if (!bar) return;
    if (S.cfg.frame !== 'card') { bar.hidden = true; bar.innerHTML = ''; return; }
    bar.hidden = false;
    const total = S.scenes.length;
    const has = S.scenes.filter(sc => sc.card && sc.card.src).length;
    const bad = S.scenes.filter(sc => sc.cardErr).length;
    bar.innerHTML = '<div class="row"><span class="tiny">底图：' + has + '／' + total + ' 幕有图' +
      (has ? '' : '（这篇没有画面表——先回「🖼 出图」出一版，或者全走纯色卡）') +
      (bad ? '；' + bad + ' 张读不进来（出片时按纯色卡）' : '') + '</span></div>';
  }
  /** 画面这一签底下的逐屏一单：加了实拍就一屏一条料，加了卡就一屏一张底 */
  let _matOnlyFail = false;                              // 「3A」只盯配不到的那几屏，别在长单子里翻
  function renderMatList() {
    const box = $('matList');
    if (!box) return;
    const kind = S.cfg.frame === 'mix' ? 'mix' : (S.cfg.frame === 'card' ? 'card' : '');
    box.hidden = !kind;
    if (!kind) { box.innerHTML = ''; return; }
    if (!S.scenes.length) { box.innerHTML = '<div class="empty">还没有分幕——先回「分幕」那一栏出一版，再回来配画面。</div>'; return; }
    const idxs = S.scenes.map((_, i) => i).filter(i => !_matOnlyFail || matFailOf(S.scenes[i]));
    if (!idxs.length) { box.innerHTML = '<div class="empty">没有配不到画面的屏了——点上面的「看全部」回到整单。</div>'; return; }
    box.innerHTML = idxs.map(i => {
      const sc = S.scenes[i];
      return '<div class="matline' + (i === curScene ? ' on' : '') + '" data-msc="' + i + '">' +
        '<div class="mh"><span class="no">' + esc(sc.label || (i + 1)) + '</span>' +
        '<span class="mtxt">' + esc(String(sc.text || '').slice(0, 22)) + '</span></div>' +
        (kind === 'mix' ? matRowHtml(sc, i) : cardRowHtml(sc)) +
      '</div>';
    }).join('');
    const at = el => Number(el.closest('[data-msc]').getAttribute('data-msc'));
    box.querySelectorAll('[data-msc]').forEach(el => {
      el.onclick = ev => {
        if (ev.target.closest && (ev.target.closest('button') || ev.target.closest('input'))) return;
        curScene = Number(el.getAttribute('data-msc')); drawScene(curScene); renderMatList();
      };
    });
    box.querySelectorAll('[data-mat]').forEach(b => b.onclick = ev => { ev.stopPropagation(); matOpenPick(at(b)); });
    box.querySelectorAll('[data-seg]').forEach(b => b.onclick = ev => {
      ev.stopPropagation();
      const i = at(b), s = S.scenes[i];
      const seg = (matPlan(s, sceneSec(i)).list[Number(b.dataset.seg)] || {}).m;
      if (seg) s.mats = matsOf(s).filter(m => m !== seg);
      renderScenes(); drawScene(i); persist();
    });
    box.querySelectorAll('[data-tone]').forEach(b => b.onclick = ev => {
      ev.stopPropagation();
      const i = at(b), s = S.scenes[i];
      s.tone = s.tone === 'low' ? 'high' : s.tone === 'high' ? 'flat' : 'low';
      renderMatList(); drawScene(i); persist();
    });
  }
  /** 垫进卡那一行：这张底叫什么（没图就写纯色卡）＋字响那一下 */
  function cardRowHtml(sc) {
    const tone = TONE_NAME[sc.tone] || TONE_NAME.flat;
    const name = (sc.card && sc.card.src)
      ? ('🖼 ' + esc(sc.card.name || '素材') + (sc.cardErr ? '（读不进来）' : ''))
      : '纯色卡（没有底图）';
    return '<div class="matrow"><span class="tiny">底图</span><span class="segs"><span class="mseg">' + name + '</span></span>' +
      '<span class="tiny">字响</span><button type="button" class="ghost tone" data-tone title="这一屏重点字弹出来那一下响什么音，点一下换一档">' + esc(tone) + '</button></div>';
  }

  /* ---------- 混剪那一栏：缺料点名 ＋ 料不够长点名 ＋ AI 先配一版 ＋ 补照片原图 ---------- */
  const mixOn = () => S.cfg.frame === 'mix';
  function matCount() {
    const total = S.scenes.length;
    let has = 0, thumb = 0, short = 0, gen = 0, fail = 0;
    S.scenes.forEach((sc, i) => {
      const mats = matsOf(sc);
      if (!mats.length) { if (matFailOf(sc)) fail++; return; }
      has++;
      if (mats.some(m => m.generic)) gen++;
      if (mats.some(m => m.kind === 'photo' && m.ref && !m.src)) thumb++;
      if (matPlan(sc, sceneSec(i)).short > 0.5) short++;
    });
    return { total, has, miss: total - has, thumb, short, gen, fail };
  }
  function paintMixBar() {
    const bar = $('mixBar');
    if (!bar) return;
    if (!mixOn()) { bar.hidden = true; bar.innerHTML = ''; return; }
    bar.hidden = false;
    const c = matCount();
    if (!c.fail) _matOnlyFail = false;
    bar.innerHTML =
      `<div class="row"><span class="tiny">画面：${c.has}／${c.total} 屏有料` +
      (c.gen ? `（其中 ${c.gen} 屏是拿现成的段／照片垫的）` : '') +
      (c.fail ? '' : (c.miss ? `，还差 ${c.miss} 屏（那几屏只有大字）` : '')) +
      (c.short ? `；${c.short} 屏料不够长（再补一段，或把那句改短）` : '') +
      (c.thumb ? `；${c.thumb} 张还是库里的小图` : '') + '</span>' +
      (c.fail ? `<span class="tiny miss">${c.fail} 屏真配不到（红字那几屏，得你挑）</span>` : '') + '</div>' +
      '<div class="row">' +
        '<button id="matAuto" class="ghost" type="button">✨ AI 先配一版</button>' +
        '<button id="matOrigin" class="ghost" type="button">🖼 补照片原图</button>' +
        (c.fail ? `<button id="matOnlyFail" class="ghost${_matOnlyFail ? ' on' : ''}" type="button">` +
          (_matOnlyFail ? `看全部 ${c.total} 屏` : `只看配不到的 ${c.fail} 屏`) + '</button>' : '') +
        '<span class="tiny" id="matTip"></span>' +
      '</div>';
    $('matAuto').onclick = matAutoPick;
    $('matOrigin').onclick = matAskOriginals;
    if (c.fail) $('matOnlyFail').onclick = () => { _matOnlyFail = !_matOnlyFail; paintMixBar(); renderMatList(); };
  }
  /** 那一栏的话写在重画之后：paintMixBar 会把这一格换新的，先写就被抹掉（老板点了没反应） */
  function setMatTip(msg) {
    const t = $('matTip');
    if (t) t.textContent = msg;
  }
  /** AI 先配一版：拿这句稿子的字去撞段的名字／标签／说明（本机对文字，不发图去问 AI）。
      四档往下退：①字对得上的（至少 2 个字）一段不重复用 → ②只对上一个字的 → ③拿这一版里
      已经用过的段／照片垫上（能垫满这一屏，不图对得准） → ④实在没有才标红留给人工。 */
  async function matAutoPick() {
    if (!S.scenes.length) return;
    setMatTip('在对素材库…');
    const lib = await matLib(true);
    if (!lib.segs.length) { setMatTip('素材库里还没有切好的段或照片——先去「✂ 切片台」切几段'); return; }
    const used = {};
    S.scenes.forEach(sc => matsOf(sc).forEach(m => { if (m.clipId) used[String(m.clipId)] = true; }));
    const score = (c, txt) => {
      const hay = String(c.name || '') + (c.tags || []).join('') + String(c.desc || '');
      let s = 0;
      for (const ch of new Set(String(txt || '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, ''))) if (hay.indexOf(ch) >= 0) s++;
      if (_matFolder && String(c.col || '') === _matFolder) s += 1;
      return s;
    };
    /** 通用垫：先拿这一版里已经上屏的段（长的排前面），没有段就照片，再没有才从库里拿最长的 */
    const genericPick = () => {
      const seen = new Set(), pool = [];
      S.scenes.forEach(sc => matsOf(sc).forEach(m => {
        const id = String(m.clipId || '');
        if (!id || !m.ref || seen.has(id)) return;
        seen.add(id); pool.push(m);
      }));
      const clip = pool.filter(m => m.kind === 'clip').sort((a, b) => (b.dur || 0) - (a.dur || 0))[0];
      if (clip) return Object.assign({}, clip, { generic: true, vid: null, img: null, imgOf: '', imgLoading: null, ok: undefined, src: '' });
      const ph = pool.find(m => m.kind === 'photo');
      if (ph) return Object.assign({}, ph, { generic: true, vid: null, img: null, imgOf: '', imgLoading: null, ok: undefined, src: '' });
      const libClip = lib.segs.filter(c => c.id && !c.imgOnly).sort((a, b) => (Number(b.dur) || 0) - (Number(a.dur) || 0))[0];
      if (libClip) { used[String(libClip.id)] = true; return Object.assign(matOf(libClip), { generic: true }); }
      const libPh = lib.segs.find(c => c.id && c.imgOnly);
      if (libPh) { used[String(libPh.id)] = true; return Object.assign(matOf(libPh), { generic: true }); }
      return null;
    };
    let n = 0, genN = 0, shortN = 0, failN = 0;
    S.scenes.forEach((sc, i) => {
      if (matsOf(sc).length) { sc.matFail = false; return; }
      const sec = sceneSec(i);
      const txt = String(sc.text || '') + String(sc.name || '');
      const pick = min => {
        const cands = lib.segs
          .filter(c => c.id && !used[String(c.id)])
          .map(c => ({ c, s: score(c, txt) }))
          .filter(x => x.s >= min)
          .sort((a, b) => b.s - a.s);
        if (!cands.length) return null;
        if (cands[0].c.imgOnly) {                     // 照片屏不拼：一屏就一张
          used[String(cands[0].c.id)] = true;
          return [matOf(cands[0].c)];
        }
        const list = []; let acc = 0;
        for (const x of cands) {
          if (x.c.imgOnly) continue;
          const m = matOf(x.c);
          list.push(m); used[String(x.c.id)] = true; acc += m.dur;
          if (acc >= sec - 0.3) break;
        }
        return list.length ? list : null;
      };
      let list = pick(2), generic = false;
      if (!list) list = pick(1);
      if (!list) { const g = genericPick(); if (g) { list = [g]; generic = true; } }
      if (!list) { sc.matFail = true; failN++; return; }
      sc.matFail = false;
      sc.mats = list;
      n++;
      if (generic) genN++;
      else if (matPlan(sc, sec).short > 0.5) shortN++;
    });
    renderScenes(); drawScene(curScene); persist();
    const bits = [];
    if (n) bits.push('配上 ' + n + ' 屏' + (genN ? '（其中 ' + genN + ' 屏是拿现成的段／照片垫的，对得没那么准）' : ''));
    if (shortN) bits.push('另有 ' + shortN + ' 屏料不够长——点那一屏「＋加一节」补');
    if (failN) bits.push(failN + ' 屏实在配不到，已红字标出，点「只看配不到的」自己挑');
    setMatTip(bits.length ? bits.join('；')
      : (S.scenes.some(x => matsOf(x).length) ? '该配的都配上了' : '没配上——素材库里还没有能垫的画面'));
  }
  /** 补照片原图：一次多选，按文件名对上库里那条（只在这台电脑上用这一次，不进素材库） */
  function matAskOriginals() {
    const need = [];
    S.scenes.forEach(sc => matsOf(sc).forEach(m => { if (m.kind === 'photo') need.push(m); }));
    if (!need.length) { setMatTip('这一版没有照片屏，不用补'); return; }
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true; inp.accept = 'image/*';
    inp.onchange = async () => {
      const files = Array.from(inp.files || []);
      if (!files.length) return;
      let hit = 0;
      for (const m of need) {
        const nm = String(m.name || '').replace(/\.[a-z0-9]{2,5}$/i, '').toLowerCase();
        const f = files.find(x => {
          const base = String(x.name || '').replace(/\.[a-z0-9]{2,5}$/i, '').toLowerCase();
          return !!nm && (base === nm || base.indexOf(nm) >= 0 || nm.indexOf(base) >= 0);
        }) || (need.length === 1 && files.length === 1 ? files[0] : null);
        if (!f) continue;
        if (m.src) { try { URL.revokeObjectURL(m.src); } catch (_) {} }
        m.src = URL.createObjectURL(f);
        m.img = null; m.imgOf = '';
        hit++;
      }
      renderScenes(); drawScene(curScene); persist();
      setMatTip(hit ? ('补上 ' + hit + ' 张，出片就用这些原图')
        : '没对上名字——段的名字改成和文件名一样再补，或一屏一屏点「挑画面」旁边那张');
    };
    inp.click();
  }

  /** 这一屏此刻还缺什么：没料／料不够长／照片还是小图——「＋加一节」旁边那行字就说这个 */
  function matNote(sc, sec) {
    const mats = matsOf(sc);
    if (!mats.length) return matFailOf(sc) ? '' : '这一屏只有大字';
    const p = matPlan(sc, sec);
    if (p.photo) return mats.some(m => m.ref && !m.src) ? '照片屏不拼（这张还是库里的小图，出片前补原图）' : '照片屏不拼：一屏就一张';
    if (p.short > 0.5) return '还差 ' + p.short + 's——再补一段，或把这句改短';
    let t = '够 ' + sec.toFixed(1) + 's ✓';
    if (p.list.length && p.list[p.list.length - 1].loop) t += '（末节从头再播 ' + p.list[p.list.length - 1].loop + 's）';
    if (p.cut) t += '（有段被话截短 ' + p.cut + 's）';
    return t;
  }
  /** 分幕栏那一行：这一屏拼的几节，加一节，够不够长，字弹出来响什么音 */
  function matRowHtml(sc, i) {
    const sec = sceneSec(i);
    const mats = matsOf(sc);
    const p = matPlan(sc, sec);
    const chips = p.list.map((x, k) =>
      `<span class="mseg">${esc(matLabel(x.m))}<b>${x.play.toFixed(1)}s</b>` +
      (x.m.generic ? '<i class="gen">通用</i>' : '') +
      (x.loop ? `<i class="loop">↻${x.loop}s</i>` : '') +
      `<button type="button" class="x" data-seg="${k}" title="把这一节挪出去">✕</button></span>`).join('<span class="arrow">→</span>') ||
      (matFailOf(sc)
        ? '<span class="tiny miss">配不到画面 · 需人工挑一节</span>'
        : '<span class="tiny none">还没配画面</span>');
    const tone = TONE_NAME[sc.tone] || TONE_NAME.flat;
    return `<div class="matrow"><span class="tiny">画面</span><span class="segs">${chips}</span>` +
      (p.photo ? '' : '<button type="button" class="ghost addseg" data-mat>＋加一节</button>') +
      `<span class="tiny fit${(!p.photo && p.short > 0.5) ? ' warn' : ''}">${esc(matNote(sc, sec))}</span>` +
      `<span class="tiny">字响</span><button type="button" class="ghost tone" data-tone title="这一屏重点字弹出来那一下响什么音，点一下换一档">${esc(tone)}</button></div>`;
  }
  /* ---------- 挑画面那一层 ---------- */
  let _matFor = 0, _matFolder = '';
  async function matOpenPick(i) {
    _matFor = i;
    const sc = S.scenes[i];
    $('matFor').textContent = '第 ' + (sc.label || (i + 1)) + ' 屏：' + String(sc.text || '').slice(0, 18) +
      '（' + sceneSec(i).toFixed(1) + 's，点一格加进来）';
    const lib = await matLib(true);
    const sel = $('matFolder');
    sel.innerHTML = '<option value="">全部文件夹</option>' +
      lib.folders.map(f => `<option value="${esc(String(f.id))}"${String(f.id) === _matFolder ? ' selected' : ''}>${esc(String(f.name || '未命名'))}</option>`).join('') +
      '<option value="__none__"' + (_matFolder === '__none__' ? ' selected' : '') + '>未分文件夹</option>';
    sel.onchange = () => { _matFolder = sel.value; matGridPaint(); };
    $('matQuery').oninput = () => matGridPaint();
    $('matMask').hidden = false;
    matGridPaint();
  }
  let _matList = [];
  async function matGridPaint() {
    const grid = $('matGrid'), empty = $('matEmpty');
    if (!grid) return;
    grid.innerHTML = '<div class="tiny">在读素材库…</div>';
    const lib = await matLib();
    const kw = String(($('matQuery') || {}).value || '').trim().toLowerCase();
    const list = lib.segs.filter(c => {
      if (_matFolder === '__none__') { if (c.col && lib.folders.some(f => String(f.id) === String(c.col))) return false; }
      else if (_matFolder && String(c.col || '') !== _matFolder) return false;
      if (!kw) return true;
      return (String(c.name || '') + (c.tags || []).join(' ') + String(c.desc || '')).toLowerCase().indexOf(kw) >= 0;
    }).slice(0, 120);
    _matList = list;
    if (!list.length) {
      empty.hidden = false;
      empty.textContent = lib.segs.length ? '这一栏里没有对得上的——换个文件夹或把关键字清了。'
        : '素材库还是空的：先去「✂ 切片台」导入原视频、切几段入库，再回来挑。';
      grid.innerHTML = '';
      return;
    }
    empty.hidden = true;
    const on = new Set(matsOf(S.scenes[_matFor] || {}).map(m => String(m.clipId)));
    grid.innerHTML = list.map((c, ix) => {
      const m = matOf(c);
      const vids = lib.videos[String(c.videoId)];
      const pic = m.kind === 'clip' ? ((vids && vids.poster) || '') : (m.ref || '');
      return `<button type="button" class="matcell${on.has(String(m.clipId)) ? ' on' : ''}" data-i="${ix}">
        <span class="matth">${pic ? `<img src="${esc(pic)}" alt="">` : (m.kind === 'clip' ? '🎞' : '🖼')}</span>
        <b>${esc(m.name)}</b>
        <span class="tiny">${m.kind === 'clip' ? esc(m.dur + 's') : '照片'}${(c.tags || []).length ? ' · ' + esc((c.tags || []).slice(0, 2).join(' ')) : ''}</span>
      </button>`;
    }).join('');
    grid.querySelectorAll('.matcell').forEach(b => {
      b.onclick = () => {
        const c = _matList[Number(b.dataset.i)];
        const sc = S.scenes[_matFor];
        if (!sc || !c) return;
        const id = String(c.id || '');
        sc.mats = matsOf(sc);
        if (sc.mats.some(m => String(m.clipId) === id)) { $('matMask').hidden = true; renderScenes(); return; }   // 这一节已经在屏上了
        const m = matOf(c);
        const onlyOne = m.kind === 'photo' || sc.mats.some(x => x.kind === 'photo');   // 照片屏不拼：换成这一张，别的挪出去
        sc.mats.forEach(x => { if (onlyOne && x.src) { try { URL.revokeObjectURL(x.src); } catch (_) {} } });
        sc.mats = onlyOne ? [m] : sc.mats.concat([m]);
        sc.matFail = false;
        $('matMask').hidden = true;
        renderScenes(); drawScene(_matFor); persist();
        prepMats().then(() => drawScene(_matFor)).catch(() => {});
      };
    });
  }
  $('matClose').onclick = () => { $('matMask').hidden = true; };
  $('matMask').addEventListener('click', ev => { if (ev.target === $('matMask')) $('matMask').hidden = true; });

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

  /* 边播边录没有 AAC 编码器可挑，用 AudioContext 自己的采样率；同一个缓存键要把采样率也算进去，
     不然上一次按 24k 念的缓存会被拿去按 48k 拼，声音会快一倍。 */
  function liveRate() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ac = new AC();
      const sr = ac.sampleRate || 48000;
      try { ac.close(); } catch (_) {}
      return sr;
    } catch (_) { return 48000; }
  }

  async function speakAll(onProgress, opts) {
    const want = Number((opts && opts.sampleRate) || 0) || 0;
    const sr = want || await Voice.pickRate();          // 有 WebCodecs 就挑 AAC 编得动的；边播边录用现成的
    S.sr = sr;
    const k = voiceKey() + '||' + sr;
    if (cache.key === k) return { parts: cache.parts, secs: cache.secs, hit: true };
    const out = await Voice.speak(S.scenes, { voice: S.voice, rate: S.rate, sampleRate: sr, onProgress });
    cache.key = k; cache.parts = out.parts; cache.secs = out.secs;
    S.tl = Voice.timeline(S.scenes, out.secs);
    showEst();
    return { parts: out.parts, secs: out.secs, hit: false };
  }

  let playing = null;
  async function audition() {
    if (S.busy) return;
    if (!S.scenes.length) return warn('还没分幕——点左边稿子上方那颗「✨ 出片稿 + 分幕」');
    warn('');
    $('audition').disabled = true;
    try {
      say('配音中…'); bar(0);
      const { parts } = await speakAll((i, n) => { say(`配音 ${i}/${n}`); bar(i / n * 0.3); },
        window.AudioEncoder ? undefined : { sampleRate: liveRate() });
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

  /* ═══════════ 🎬 分幕这一站（一屏：左稿右幕）═══════════
     七十一改：进站一路跑完——按正文调口播稿 → AI 提重点 → 按重点改出「出片稿」→ 切幕，中途不用点；
     重点只读留在稿子上方，想换个切法点「↻ 重新出一版」。左边改字不自动重跑 AI（省调用），
     右边那批幕跟着最后一版走。 */

  function renderScriptSec() {
    const sec = $('secScript'); if (!sec) return;
    const src = String(S.body || '').trim();
    const hasScript = String(S.script || '').trim().length > 0;
    const picks = Array.isArray(S.fvPicks) ? S.fvPicks : [];
    const hasSc = !!S.scenes.length;
    const busyCard = (txt, hint) =>
      '<div class="fvcard"><b>' + txt + '</b><span class="tiny">' + hint + '</span></div>';
    const runBtn = (label, tip) =>
      '<button type="button" class="primary" id="gen" data-act="run"' + (tip ? ' title="' + esc(tip) + '"' : '') + '>' + label + '</button>';

    if (S.genBusy) {
      sec.innerHTML = '<p class="fhint">片子的词走左边这框，右边＝幕：进站一路跑完（调口播稿 → 提重点 → 按重点改出出片稿 → 切幕），中途不用点。</p>' +
        busyCard('AI 正在' + esc(S.fvStage || '出片稿') + '…', '全程不用点——跑完左边是出片稿、右边是切好的幕');
      return;
    }
    if (!hasScript && S.noteId && !src) {
      sec.innerHTML = '<p class="fhint">片子的词走左边这框，右边＝幕。</p>' +
        '<div class="fvcard soft">这一篇还没有正文——口播稿按正文调出来。先回写稿那一篇把正文整出来，再来这一站。</div>';
      return;
    }
    if (!hasScript && !S.noteId) {
      /* 单开一页（没有这一篇的正文）：先在框里立稿，再一发跑完 */
      sec.innerHTML = '<p class="fhint">单开一页：先在框里立稿（一行一句，标点照常写），点了下面那颗一路跑完——提重点 → 改出出片稿 → 切幕。</p>' +
        '<textarea id="script" data-in="script" rows="10" placeholder="一行一句，标点照常写。比如：&#10;一个人做小红书，凌晨还在发笔记。&#10;三个月过去，一个咨询都没有。"></textarea>' +
        '<div class="fvrow">' + runBtn('✨ 出片稿 + 分幕') + '<span class="tiny">' + cn(S.script) + ' 字</span></div>';
      return;
    }

    const tag = S.fvFail
      ? '这次没调出口播稿——正文直接当稿用（点「↻ 按正文重调」再试）'
      : (S.fvFrom === 'body' ? 'AI 按正文调出来的口播稿' : '这一版是你手整的');
    const pn = S.fvPN ? ' · 按 ' + S.fvPN + ' 个重点改出（这版＝出片稿）' : '';
    let box = '<p class="fhint">片子的词走左边这框，右边＝幕。想换个切法只点一颗「' + (picks.length ? '↻ 重新出一版' : '✨ 出片稿 + 分幕') +
      '」：提重点 → 改出出片稿 → 切幕一路跑完，中途不用点；在框里改过字不会自己重切，按新稿走再点一次这一颗（要整篇按正文重来，回上一站「改稿」改完再进来）。</p>';
    box += '<div class="fvrow">' +
      '<span class="fvtip' + (S.fvFrom === 'body' ? ' ok' : '') + (S.fvFail ? ' warn' : '') + '">' + tag + pn + '</span>' +
      runBtn(picks.length || hasSc ? '↻ 重新出一版' : '✨ 出片稿 + 分幕',
        '按' + (src ? '正文重新调稿、' : '') + '提重点、改出出片稿、切幕一路跑完') +
      '<span class="tiny" id="cnt">' + cn(S.script) + ' 字</span></div>';
    if (picks.length) {
      box += '<div class="pkrow"><span class="pkh">AI 抓的重点</span>' +
        picks.map(p => '<span class="pkchip" title="' + esc(p.why || '') + '">' + esc(p.s || '') + '</span>').join('') +
        '<span class="tiny">只读·留档；要换个切法点「↻ 重新出一版」</span></div>';
    }
    box += '<textarea id="script" data-in="script" rows="10" placeholder="一行一句，标点照常写。">' + esc(S.script || '') + '</textarea>';
    if (hasSc) {
      box += '<div class="fvrow">' + (S.fvEdited
        ? '<span class="fvtip warn">框里改过字——右边幕还没跟上，点「↻ 重新出一版」才按新稿切</span>'
        : '<span class="ok">右边 ' + S.scenes.length + ' 幕＝按这版稿切的，逐幕能改</span>') + '</div>';
    }
    sec.innerHTML = box;
  }
  S.renderScriptSec = renderScriptSec;

  /* 这一站的按钮 / 输入都靠委托（内容整块重画，逐个挂监听会漏） */
  $('secScript').addEventListener('click', (ev) => {
    const b = ev.target.closest && ev.target.closest('[data-act]');
    if (!b) return;
    const act = b.getAttribute('data-act');
    if (act === 'run') fvRun(true);
  });
  $('secScript').addEventListener('input', (ev) => {
    const el = ev.target;
    if (!el || el.id !== 'script') return;
    S.script = el.value;
    if (S.scenes.length) S.fvEdited = true;
    const c = $('cnt'); if (c) c.textContent = cn(el.value) + ' 字';
    renderScriptSec(); renderScenes(); paintFoot();
    persist();
  });

  /* 一路直出：（没稿先按正文调）→ 提重点 → 按重点改出「出片稿」＋切幕。
     manual＝手点那颗钮；fromBody＝连口播稿也按正文重调一版；auto＝进站自己跑（幕已经排好的不动它——画面表那份底图编排别让 AI 盖掉）。 */
  let _fvSeq = 0;        // 每发一个序号：再点过，迟到的结果不落
  let _fvKeep = '';      // 重调前那版：失败或停掉时还回去

  /** ① 那一发：按正文调一版口播稿（正文不动）；不成抛错，由 caller 兜底 */
  async function fvAskScript(src, my) {
    const r = await S.askBg({ action: 'genNoteVoiceScript', data: {
      title: S.noteTitle, content: src, style: S.meta.style,
      sellPoint: S.meta.sellPoint, people: S.meta.people, platform: S.meta.platform,
    } });
    if (my !== _fvSeq) return null;                            // 停过了／又点过一版：迟到的不落
    const out = String((r && r.script) || '').trim();
    if (!r || r.ok === false || !out) throw new Error(String((r && r.error) || '这次没调出口播稿'));
    return out;
  }

  /** 进站那一趟碰到幕已经排好的（画面表／草稿捡回来）：幕一段都不动，只把还空着的那格口播稿补上
      （调不出来就正文当稿——左边不能摆个空框，老板投诉的「一进去口播稿是空的」就是这里）。 */
  async function fvFillOnly(src) {
    if (S.busy || S.genBusy) return;
    const my = ++_fvSeq;
    S.genBusy = true; S.fvStage = '按正文调口播稿'; S.fvFail = false;
    renderScriptSec(); paintFoot();
    let note = '';
    try {
      const out = await fvAskScript(src, my);
      if (my !== _fvSeq) return;
      S.script = out; S.fvFrom = 'body';
      note = '口播稿补好了——幕还是「🖼 出图」那张画面表排的那几段，没动';
    } catch (e) {
      if (my !== _fvSeq) return;
      S.script = src; S.fvFrom = ''; S.fvFail = true;
      note = '这次没调出口播稿——正文直接当稿用（' + String((e && e.message) || e) + '）';
    } finally {
      if (my === _fvSeq && S.genBusy) {                        // 被新一轮顶掉的：收尾交给那一轮
        S.genBusy = false; S.fvStage = '';
        persist(); renderScriptSec(); paintFoot();
      }
    }
    if (my !== _fvSeq) return;
    toast(note);
  }

  async function fvRun(manual, fromBody, auto) {
    if (S.busy || S.genBusy) return;
    const src = String(S.body || '').trim();
    if (auto && S.scenes.length) {                             // 幕已排好（画面表／草稿捡回来的）：不自动重切
      if (!String(S.script || '').trim() && src) fvFillOnly(src);
      return;
    }
    if (!src && !String(S.script || '').trim()) { if (manual) toast('先有稿或先有正文——这一版没得跑'); renderScriptSec(); return; }
    const my = ++_fvSeq;
    if (fromBody) {
      _fvKeep = String(S.script || '');
      S.script = ''; S.fvFrom = ''; S.fvPrev = ''; S.fvPN = 0; S.fvPicks = null; S.fvFail = false;
      S.peeking = false; S.prevPeek = false;
    }
    S.genBusy = true; S.fvFail = false; S.scRule = false; S.fvPicks = null;
    S.fvStage = '按正文调口播稿';
    renderScriptSec(); renderScenes(); paintFoot();
    let note = '';
    try {
      /* ① 口播稿：没有就先按正文调一版（正文不动） */
      let script = String(S.script || '').trim();
      if (!script && src) {
        const out = await fvAskScript(src, my);
        if (my !== _fvSeq) return;
        script = out; S.script = out; S.fvFrom = 'body';
      } else if (!script) {
        script = src; S.script = src; S.fvFrom = '';
      }
      /* ② 提重点（≤5 个）：只读留档，不再停下来等过目 */
      S.fvStage = '提重点';
      const rp = await S.askBg({ action: 'genNoteFilmPicks', data: { title: S.noteTitle, script: script } });
      if (my !== _fvSeq) return;
      const pts = ((rp && rp.points) || [])
        .map(p => ({ s: String((p && (p.t || p.s)) || '').trim(), why: String((p && p.why) || '').trim() }))
        .filter(p => p.s).slice(0, 5);
      if (!rp || rp.ok === false || !pts.length) throw new Error(String((rp && rp.error) || 'AI 这次没提出重点'));
      S.fvPicks = pts;
      /* ③ 按重点改出「出片稿」＋分幕 */
      S.fvStage = '按重点出片稿、切幕';
      const rg = await S.askBg({ action: 'genNoteFilmScript', data: {
        title: S.noteTitle, script: script, picks: pts.map(p => String(p.s || '').trim()),
      } });
      if (my !== _fvSeq) return;
      const list = Scenes.normalize({ scenes: (rg && rg.scenes) || [] });
      if (!rg || rg.ok === false || !list.length) throw new Error(String((rg && rg.error) || 'AI 这次没分好幕'));
      const draft = String((rg && rg.outline) || '').trim();
      if (draft && draft !== script) { S.fvPrev = script; S.script = draft; }   // 出片稿回填左边（原版留「↩ 看上一版」）
      S.fvPN = pts.length; S.scRule = false; S.fvEdited = false; S.fvFail = false;
      _fvKeep = '';
      S.genBusy = false; S.fvStage = '';
      applyScenes(list);
      note = '口播稿 → ' + pts.length + ' 个重点 → ' + list.length + ' 幕都出好了：左边＝出片稿，右边逐幕能改';
    } catch (e) {
      if (my !== _fvSeq) return;
      const msg = String((e && e.message) || e);
      const cur = String(S.script || '').trim();
      if (fromBody && _fvKeep) {
        S.script = _fvKeep; _fvKeep = '';
        note = '没跑成：' + msg + '——先还你原来那版稿';
      } else if (!cur && src) {
        S.script = src; S.fvFrom = ''; S.fvFail = true;
        note = '这次没调出口播稿——正文直接当稿用（' + msg + '）';
      } else {
        note = '没跑成：' + msg;
      }
      S.genBusy = false; S.fvStage = '';
      if (String(S.script || '').trim()) { S.fvPicks = null; ruleScenes(true); }   // B1：AI 不可用 → 本机规则切幕＋标注
      persist();
      renderScriptSec(); renderScenes(); paintFoot();
    } finally {
      if (my === _fvSeq && S.genBusy) {          // 中途被新一轮顶掉／提前 return 的：这一发不收尾就别收（新一轮自己会收）
        S.genBusy = false; S.fvStage = '';
        renderScriptSec(); renderScenes(); paintFoot();
      }
    }
    if (my !== _fvSeq) return;
    drawScene(0);
    toast(note);
  }
  S.fvRun = fvRun;

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
    S.scRule = !!mark; S.fvEdited = false;
    renderScenes(); renderScriptSec(); drawScene(0); paintFoot();
    persist();
    return S.scenes.length;
  }
  S.ruleScenes = ruleScenes;

  /** AI 切好的幕落到台子上：已配的底图按序保留 */
  function applyScenes(list) {
    const wasCard = S.scenes.map(s => ({ card: s.card, key: s.cardKey || '' }));
    S.scenes = list.map((s, i) => {
      const sc = Object.assign({}, s);
      if (wasCard[i] && wasCard[i].card) sc.card = wasCard[i].card;
      if (wasCard[i] && wasCard[i].key) sc.cardKey = wasCard[i].key;
      return sc;
    });
    S.tl = null; cache.key = ''; curScene = 0; S.outAt = 0; S.fvEdited = false;
    renderScenes(); renderScriptSec(); drawScene(0); paintFoot();
    persist();
  }

  /* ---------- 出片 ---------- */
  /* 出片中那一层：整页封住 + 流程节点 + 中间那块现场画面（老板 10-18：只弹一行提示像卡住了）。
     三种走法各一套节点：派给执行器 / 本机逐帧编 / 本页边播边录。
     现场画面是把出片那块画布照抄一份过来（只读，不碰录制那条路）。 */
  const FR_STEPS = {
    check: ['先看一眼走哪条路', '开始出片'],
    exec: ['存好这一篇的草稿', '交给你的执行器', '它在那台机器上编'],
    encode: ['一句句配音', '排时间轴', '逐帧画画面', '混配音 · 打包成 MP4'],
    record: ['一句句配音', '排时间轴', '边播边录（整片播一遍）', '收尾出片'],
  };
  const FR_HINT = {
    check: '这一步只是看一眼你电脑上那个小帮手在不在家：在就派给它编，不在就在这页自己出。',
    exec: '这一条交给你电脑上那个小帮手编，编完存在你那台机器上、顺手下载。',
    encode: '这一条在本机逐帧编，画面不用一遍遍播，通常比实时录快。',
    record: '这一条要把整片按正常速度播一遍录下来——中间那块小画面就是正在录的东西。' +
      '只录片子里的合成配音，不开麦克风；中途别切走这个标签页、别锁屏，切走了这一条会作废。',
  };
  const FR = {
    on: false, list: [], cur: -1, t0: 0, est: 0, raf: 0, kind: '', wait: '',   // wait＝字体还在下（这时候不许说「就快了…」）
    open(kind, est) {
      this.kind = kind;
      this.list = FR_STEPS[kind] || FR_STEPS.record;
      this.cur = -1; this.t0 = Date.now(); this.est = Math.max(4, Number(est) || 0);
      $('frHint').textContent = FR_HINT[kind] || '';
      $('filmRun').hidden = false;
      /* 底栏那颗「🎬 出片／⏹ 停」先压暗：单开一页它在 #filmPane 里，落在发笔记那页时它是外层那一条，
         所以这个记号打在 body 上（只有出片这几秒挂着，收蒙层就摘）。 */
      document.body.classList.add('film-running');
      this.on = true;
      this.paint();
      if (!this.raf) this.raf = requestAnimationFrame(frTick);
    },
    step(i, line) { if (line !== undefined) this.line(line); if (i === this.cur) return; this.cur = i; this.paint(); },
    line(s) { const el = $('frLine'); if (el) el.textContent = s; },
    /* 蒙层把底下那行提示盖住了：要紧的话（不是 Edge / 别关弹窗 / 底图读不进来）抄一份进来 */
    notes(s) {
      const el = $('frHint');
      if (!el || !s) return;
      el.textContent = String(s) + (el.textContent ? ' ' + el.textContent : '');
    },
    total(sec) { this.est = Math.max(4, Math.round(sec)); },
    finish(s) { this.cur = this.list.length; this.paint(); this.line(s || '出好了'); },
    close() {
      this.on = false; this.wait = '';
      if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
      $('filmRun').hidden = true;
      document.body.classList.remove('film-running');
    },
    paint() {
      const n = this.list.length, at = Math.min(n - 1, Math.max(0, this.cur));
      $('frCount').textContent = '第 ' + (at + 1) + '/' + n + ' 步';
      $('frNodes').innerHTML = this.list.map((t, i) => {
        const cls = i < this.cur ? 'done' : i === this.cur ? 'cur' : 'todo';
        return '<li class="' + cls + '"><span class="fdot">' + (cls === 'done' ? '✓' : i + 1) + '</span>' +
          '<span class="flbl">' + esc(t) + '</span></li>';
      }).join('');
    },
  };
  const frSec = s => s < 60 ? Math.max(1, Math.round(s)) + ' 秒'
    : Math.floor(s / 60) + ' 分 ' + Math.round(s % 60) + ' 秒';
  function frTick() {
    if (!FR.on) { FR.raf = 0; return; }
    const box = $('frView');
    if (box) { try { box.getContext('2d').drawImage(cv, 0, 0, box.width, box.height); } catch (_) {} }
    const el = (Date.now() - FR.t0) / 1000;
    $('frElapsed').textContent = '已用 ' + frSec(el);
    $('frEta').textContent = FR.est > el ? '大约还要 ' + frSec(FR.est - el) + '（估）'
      : (FR.wait ? '字体下完就开始画' : '就快了…');
    FR.raf = requestAnimationFrame(frTick);
  }
  $('frStop').onclick = stopFilm;
  $('filmRun').addEventListener('click', e => {
    if (e.target.closest && e.target.closest('#filmRunBox')) return;
    FR.line('出片进行中——要中断点右下角那颗「⏹ 停」');
  });
  /* 整片大概要多少秒（给「大约还要 N 秒」打底）：配音按每幕一句句念，画面按时间轴长度走 */
  function frEstimate(mode) {
    const n = S.scenes.length;
    const speech = S.scenes.reduce((a, s) => a + (s.estSec || Math.max(1.2, cn(s.text || '') / 4.5)), 0);
    const tlSec = speech + Math.max(0, n - 1) * Voice.GAP + Voice.HEAD + Voice.TAIL;
    const voiceSec = n * 1.8 + 2;
    return mode === 'record' ? voiceSec + tlSec + 5 : voiceSec + Math.max(6, tlSec * 1.2) + 6;
  }

  let _making = false;
  function make() {
    if (S.busy || _making) return;
    _making = true;
    return makeGo().finally(() => { _making = false; });
  }

  async function makeGo() {
    if (!S.scenes.length) { warn(S.genBusy ? 'AI 还在切幕——等这一版跑完（' + (S.fvStage || '出片稿') + '）' : '还没分幕——点左边稿子上方那颗「✨ 出片稿 + 分幕」'); return; }
    /* 一点出片就整页封住：连「看执行器在不在家」那一小段也盖进来，别让人对着不动的页面猜。 */
    FR.open('check', 8); FR.step(0, '先看一眼走哪条路…');
    try {
      await makeGoInner();
    } finally {
      FR.close();
    }
  }

  async function makeGoInner() {
    /* 公网版：执行器在线还是派给它（在它那台机器上离线编，比本页实时录快）。
       不在线／没装执行器 → 本页自己出，不再排一条单等它上线。 */
    const demo = !!(window.chrome && chrome.runtime.id === 'demo-page');
    let executorOnline = false;
    // 混剪的实拍段存在这台电脑的素材仓里（整条原片不上传），执行器那台读不到 → 这一路固定在本页边播边录
    if (demo && S.cfg.frame !== 'mix' && typeof window.__xhsExecFilm === 'function') {
      try {
        const h = typeof window.__xhsExecOnline === 'function' ? await window.__xhsExecOnline() : null;
        executorOnline = !!(h && h.ok && h.online);
      } catch (_) {}
      if (executorOnline) {
        const nid = String(S.noteId || '');
        if (!nid) { warn('公网版出片：请从「笔记档案」点进这一篇再点出片（要带上是哪一篇，执行器才知道编什么）'); return; }
        S.busy = true; warn(''); stopPlay();
        $('go').disabled = true; $('stop').hidden = true;
        FR.open('exec', 18);
        try {
          FR.step(0, '存好这一篇的草稿…');
          say('把这一篇交给执行器出片…'); bar(0);
          await persistNow();
          const docs = await docsGet();
          const doc = docs[nid] || null;
          if (!doc) { warn('这一篇的草稿没存上——再点一次'); return; }
          FR.step(1, '交给你的执行器…');
          const r = await window.__xhsExecFilm(nid, doc);
          if (!r || !r.ok) { say('出片失败'); warn('出片没派成：' + ((r && r.error) || '未知')); return; }
          FR.step(2, r.delivered ? '它正在那台机器上编…' : '单子排着了，等它上线就编');
          say(r.delivered ? '已交给执行器：它正在那台机器上编，编完存它本机并下载' : '执行器不在线——单排着了，等它上线就编');
          warn('成片会留在执行器那台（下载 + 档案里能回放）。');
          bar(1);
        } finally {
          S.busy = false; $('go').disabled = false; $('stop').hidden = true;
        }
        return;
      }
    }

    /* 本页出片：有 WebCodecs 走原来的离线编码；没有（公网是 http）就按同一时间轴边播边录。
       混剪那一路一律边播边录——实拍段得真播起来才有画面，逐帧编码那条追不上播放头。 */
    const canCodec = !!(window.VideoEncoder && window.AudioEncoder) && S.cfg.frame !== 'mix';
    const mode = canCodec ? 'encode' : 'record';
    if (mode === 'record' && !(window.MediaRecorder && typeof cv.captureStream === 'function')) {
      warn('这个浏览器既没有 WebCodecs，也没有录像功能——换 Edge / Chrome 最新版，或装执行器。');
      return;
    }
    if (demo) {                                          // 本页出片也要过档位闸，不能绕开收费
      try {
        const ed = await chrome.runtime.sendMessage({ action: 'getEdition' });
        const f = ed && ed.features;
        if (f && f.videoFilm === false) { warn('这一档没开字效编辑器——升级后再用。'); return; }
      } catch (_) {}
    }

    S.busy = true; warn(''); stopPlay();
    $('go').disabled = true; $('stop').hidden = false;
    FR.open(mode, frEstimate(mode)); FR.step(0, '先备好字体…');
    let liveAC = null;
    try {
      const notes = [];
      if (!EdgeTTS.isEdge()) notes.push('这台浏览器不是 Edge，配音念不出来（微软这条免费口子认 Edge）。画面照样能出，配音得换 Edge 打开本页。');
      // 在弹窗里出片：切走这一页没事（实测照编），但关掉弹窗这条就断了——长片建议单开一页
      if (INLINE) notes.push('出片中别关掉这个弹窗——关了就断（在左栏切去写笔记没事，它照编）。片子长的话，点右上「在新标签页打开」单开一页慢慢编。');
      if (demo && !executorOnline) notes.push(mode === 'record'
        ? '执行器不在线——这一条在本页边播边录（不占执行器）。'
        : '执行器不在线——这一条在本页现编（不占执行器）。');
      // 「边播边录不开麦克风／别切走标签页」那句由出片蒙层那块讲，这里不再重复铺一遍
      if (notes.length) { warn(notes.join(' ')); FR.notes(notes.join(' ')); }
      bar(0);
      await fontGate();                                   // 默认档拿系统字体直接开画；只有开了内置思源又没下完才等

      if (mode === 'encode') {
        await Voice.pickRate();                           // 编不了 AAC 的话，这里就会带原因报出来
      } else {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) throw new Error('这个浏览器没有声音处理功能');
        liveAC = new AC();
        try { if (liveAC.state === 'suspended') await liveAC.resume(); } catch (_) {}
        if (liveAC.state !== 'running') throw new Error('浏览器把声音拦住了——先点一下页面空白处，再点出片');
        S.sr = liveAC.sampleRate || 48000;
      }

      if (S.cfg.frame === 'card') {                       // 卡片轮播：先把每张卡底图解好，读不进来的按纯色卡出
        say('准备卡片底图…'); FR.step(0, '准备卡片底图…'); bar(0.04);
        const bad = await prepCards();
        if (bad.length) {
          notes.push('第 ' + bad.map(b => b.i + 1).join('、') + ' 幕的底图读不进来（' + bad[0].msg + '），这几张按纯色卡出。');
          warn(notes.join(' ')); FR.notes('第 ' + bad.map(b => b.i + 1).join('、') + ' 幕的底图读不进来，这几张按纯色卡出。');
        }
      }

      if (S.cfg.frame === 'mix') {                         // 混剪：先把每一屏的料备齐（照片解图、段拿播放器），缺的点名
        say('备这一屏屏的画面…'); FR.step(0, '备这一屏屏的画面…'); bar(0.04);
        const bad = await prepMats();
        const miss = S.scenes.filter(sc => !matsOf(sc).length).length;
        const short = S.scenes.filter((sc, i) => matsOf(sc).length && matPlan(sc, sceneSec(i)).short > 0.5).length;
        if (bad.length) {
          notes.push('第 ' + bad.map(b => b.i + 1).join('、') + ' 屏的画面拿不到（' + bad[0].msg + '），这几屏只有大字。');
          warn(notes.join(' ')); FR.notes('第 ' + bad.map(b => b.i + 1).join('、') + ' 屏的画面拿不到，这几屏只有大字。');
        }
        if (miss) {
          notes.push('还有 ' + miss + ' 屏没配画面，那几屏是深色纯大字。');
          warn(notes.join(' ')); FR.notes('还有 ' + miss + ' 屏没配画面（深色纯大字）。');
        }
        if (short) FR.notes('有 ' + short + ' 屏料不够长，末节从头再播补上（最多 3 秒）。');
        await matPreload();
      }

      const { parts } = await speakAll((i, n) => { say(`配音 ${i}/${n}`); FR.step(0, `一句句配音 ${i}/${n}…`); bar(i / n * 0.22); },
        mode === 'record' ? { sampleRate: S.sr } : undefined);
      const T = tl();
      let pcm = Voice.pcm(parts, { gap: T.gap, head: T.head, dur: T.dur, sampleRate: S.sr });
      if (S.cfg.frame !== 'text' && (S.cfg.bgm || S.cfg.sfx)) {          // 垫了底（实拍或卡）：配音之外再垫背景音乐与跟字响的音效，三条轨先混成一条
        say('垫背景音乐与音效…'); FR.step(1, '垫背景音乐与字响…');
        const extra = [];
        try { const b = await Voice.bgm(S.cfg.bgm, T.dur, S.sr); if (b) extra.push({ pcm: b, gain: 0.13 }); } catch (_) {}
        try { const s = await Voice.sfx(S.cfg.sfx, T, S.sr); if (s) extra.push({ pcm: s, gain: 0.9 }); } catch (_) {}
        if (extra.length) pcm = Voice.mix([{ pcm, gain: 1 }].concat(extra));
      }
      S.tl = T;
      const st = style();                                // 这一条的时间轴和风格先冻住：录制中改字/拨旋钮只影响下一条
      FR.step(1, '排时间轴 · 整片 ' + T.dur.toFixed(1) + ' 秒');
      FR.total((Date.now() - FR.t0) / 1000 + (mode === 'record' ? T.dur + 5 : Math.max(6, T.dur * 1.2) + 6));

      let blob = null, ext = 'mp4';
      if (mode === 'record') {
        say('边播边录…'); FR.step(2, '边播边录：整片按正常速度播一遍…'); bar(0.22);
        const rec = Recorder.start({
          canvas: cv, dur: T.dur, draw: (c, t) => paintFilmFrame(c, t, T, st),
          pcm, sampleRate: S.sr, audioContext: liveAC, monitor: true,
          onProgress: (t, d) => {
            const left = Math.max(0, d - Math.min(d, t));
            say('边播边录 ' + Math.min(d, t).toFixed(1) + 's / ' + d.toFixed(1) + 's');
            FR.step(2, '边播边录 ' + Math.min(d, t).toFixed(1) + ' 秒 / ' + d.toFixed(1) + ' 秒（' +
              Math.round(Math.min(1, t / d) * 100) + '%）');
            FR.total((Date.now() - FR.t0) / 1000 + left + 4);
            bar(0.22 + Math.min(1, t / d) * 0.7);
          },
        });
        S.cancelFilm = rec.cancel;
        try {
          const out = await rec.promise;
          blob = out.blob; ext = out.ext;
        } finally {
          S.cancelFilm = null;
        }
        FR.step(3, '收尾出片…');
      } else {
        FR.step(2, '逐帧画画面…');
        blob = await Encoder.encode({
          canvas: cv, dur: T.dur, codec: await Encoder.pickCodec(false),
          draw: (c, t) => Renderer.renderFrame(c, t, T, st),
          audio: { pcm, sampleRate: S.sr },
          onPhase: ph => { if (ph === 'audio') { say('混配音…'); FR.step(3, '混配音 · 打包成 MP4…'); bar(0.95); } },
          onProgress: (i, n) => {
            if (!S.busy) throw new Error('已停下');     // 停按钮：把 S.busy 清掉，这里就抛出去打断编码
            if (i % 30 === 0) {
              say(`画面 ${i}/${n} 帧`);
              FR.step(2, `逐帧画画面 ${i}/${n} 帧（${Math.round(i / n * 100)}%）`);
              FR.total((Date.now() - FR.t0) / 1000 + Math.max(1, (n - i) * 0.04) + 4);
              bar(0.22 + i / n * 0.7);
            }
          },
        });
      }
      if (!blob || !blob.size) throw new Error('没拿到成片');
      S.lastBlob = blob;
      S.lastName = `成片-${stamp()}.${ext}`;
      Encoder.dl(blob, S.lastName);
      S.outAt = Date.now();                     // 这篇出过片了：档案那行会标「🎬 已出片」
      await persistNow();
      paintHead();
      if (S.noteId) { try { await filmPut(S.noteId, blob); } catch (_) {} }   // 档案里能回放这条片子
      say(`完成 ${(blob.size / 1048576).toFixed(1)}MB · ${T.dur.toFixed(1)}s · 已下载` +
        (ext === 'webm' ? '（这台浏览器只能录 WebM，发小红书前可能要转 MP4）' : ''));
      bar(1);
      FR.finish('出好了 · ' + (blob.size / 1048576).toFixed(1) + 'MB · ' + T.dur.toFixed(1) + ' 秒 · 已下载');
      doneOpen(blob);
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (/已停下|切走了/.test(msg)) { say('停了'); warn(msg); }
      else { say('出片失败'); warn(msg); console.error(e); }
    } finally {
      if (liveAC) { try { await liveAC.close(); } catch (_) {} }
      S.cancelFilm = null;
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
    $('doneBack').hidden = !(INLINE && S.noteId);
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
      askHost('onDone', { noteId, outAt: S.outAt || 0 });
      doneClose();
      say('已存好——回档案了');
    });
  };

  /* ---------- 启动 ---------- */
  async function init() {
    /* 单开一页时 ?flow= 带过来的前几站（外层那颗 ↗ 塞的）：站名摆出来、点不动——
       让新页和弹窗里认得出是同一条工作流，不是另开了个软件 */
    if (!INLINE) {
      try {
        const got = JSON.parse(decodeURIComponent(new URLSearchParams(location.search).get('flow') || 'null'));
        if (Array.isArray(got)) S.flow = got.filter(x => x && String((x && x.t) || '').trim());
      } catch (_) {}
    }
    paintHead();
    const [cfgLine, voiceCfg, script, fontPack] = await Promise.all([
      store.get(KEY_STYLE), store.get(KEY_VOICE), store.get(KEY_SCRIPT), store.get(KEY_FONTPACK)]);
    if (cfgLine) S.cfg = Renderer.parseCfg(cfgLine);
    if (voiceCfg) { S.voice = voiceCfg.voice || S.voice; S.rate = voiceCfg.rate || S.rate; }
    if (script) S.script = String(script);
    if (!Fonts.EAGER) S.fontPack = fontPack === 'bundled' ? 'bundled' : 'sys';   // 你这台浏览器上次选过谁
    buildStyleUI(); buildVoiceUI(); renderScriptSec(); renderScenes(); paintFoot();
    draw(0.45);                                   // 先画片头那一帧，页面不空着
    if (!EdgeTTS.isEdge()) {
      warn('建议用 Edge 打开本页：配音走微软给 Edge 的免费通道，换别的浏览器念不出声（画面不受影响）。');
    }
    say('就绪');
  }

  /* 弹窗「拿去出片」就地递稿子进来用（等价于「粘稿 + 生成分幕」，单开一页口径）；
     正在出片就不动它。opts.frame＝外层那一篇选定的成片形式（'card' 卡片轮播／'mix' 混剪实拍），
     顺手把画面旋钮拨过去；带 opts.shots（出图那张画面表）就按第 N 张画面安第 N 幕的底图，
     没带／张数对不上才退回素材库顺序铺。混剪不吃画面表——它的料从素材库一屏一屏挑。 */
  function applyFrame(o) {
    const f = o && o.frame;
    if ((f === 'card' || f === 'mix') && S.cfg.frame !== f) { S.cfg.frame = f; buildStyleUI(); }
  }
  const shotRows = o => (S.cfg.frame === 'mix' ? [] : (Array.isArray(o && o.shots) ? o.shots : []));
  S.loadScript = (t, opts) => {
    if (S.busy) return 'busy';
    const s = String(t || '').trim();
    if (!s) return 'empty';
    const o = opts || {};
    S.shots = Array.isArray(o.shots) ? o.shots : [];
    applyFrame(o);
    S.script = s;
    S.fvFrom = ''; S.fvPN = 0; S.fvPrev = ''; S.fvPicks = null; S.fvFail = false; S.scRule = false;
    const rows = shotRows(o);
    if (rows.length) {
      const wasCard = {};                                 // 同一篇重进：铺过的段底图留着（按 cardKey）
      S.scenes.forEach(sc => { if (sc.cardKey && sc.card && sc.card.src) wasCard[sc.cardKey] = sc.card; });
      S.scenes = scenesFromShotRows(rows);
      S.scenes.forEach(sc => { if (sc.cardKey && wasCard[sc.cardKey] && !(sc.card && sc.card.src)) sc.card = wasCard[sc.cardKey]; });
      S.tl = null; cache.key = ''; curScene = 0; S.outAt = 0;
      renderScenes(); renderScriptSec(); drawScene(0); paintFoot();
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
    S.shots = Array.isArray(o.shots) ? o.shots : [];   // 画面表跟着这一篇走：垫进卡时按它铺底图
    applyFrame(o);                                  // 卡片／混剪这一路：画面旋钮跟着这一档的成片形式走
    S.flow = (Array.isArray(o.flow) ? o.flow : []).filter(x => x && String((x && x.t) || '').trim());   // 顶上那条工作流条：这一篇从哪几站走过来
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
    /* 五十四改：递进来的稿为空＝这一篇还没调过口播稿（出口落档那份跟正文同文的不算稿），
       光比稿认不出「正文换过」这回事——旧分幕是按老正文切的，正文一改就得作废，所以这里再比一道正文。 */
    const bodyNow = String(S.body || '').trim();
    const docBody = String((doc && doc.body) || '').trim();
    if (doc && Array.isArray(doc.scenes) && doc.scenes.length && (!s || String(doc.script || '') === s)
        && (!bodyNow || !docBody || docBody === bodyNow)) {
      restoreDoc(doc, o);
      applyFrame(o);                                 // 草稿里存过别的画面：这一档选的是什么片就以它为准
      if (S.cfg.frame === 'mix') renderScenes();      // 混剪：那一栏「几屏有料／还差几屏」跟着露出来
      // 这篇草稿早分好幕：画面表来了、且草稿里一段底图都没有时，按画面表补铺一次（已经铺过的不动）
      if (o.frame === 'card' && Array.isArray(o.shots) && o.shots.length && !S.scenes.some(sc => sc.card && sc.card.src)) paveRows(o.shots);
      return 'ok';
    }
    if (doc) {
      // 稿子换了（在写稿里重出过一版 / 手改过）：旧分幕对不上新稿，稿与幕重来；画面与配音参数还是这篇的
      if (doc.cfg) S.cfg = Renderer.parseCfg(doc.cfg);
      if (doc.voice) { S.voice = doc.voice; S.rate = doc.rate || S.rate; }
      applyFrame(o);
      buildStyleUI(); buildVoiceUI();
    }
    dropOtherNoteCards(prevId, id);
    S.script = s;
    S.fvFrom = ''; S.fvPN = 0; S.fvPrev = ''; S.fvPicks = null; S.fvFail = false; S.scRule = false;
    S.peeking = false; S.prevPeek = false;
    const rows = shotRows(o);
    if (rows.length) {
      /* 出图那张画面表：先按段把可编辑的幕铺出来（底图编排延续），「生成分幕」再走 AI 换新稿 */
      const wasCard = {};
      S.scenes.forEach(sc => { if (sc.cardKey && sc.card && sc.card.src) wasCard[sc.cardKey] = sc.card; });
      S.scenes = scenesFromShotRows(rows);
      S.scenes.forEach(sc => { if (sc.cardKey && wasCard[sc.cardKey] && !(sc.card && sc.card.src)) sc.card = wasCard[sc.cardKey]; });
      S.tl = null; cache.key = ''; curScene = 0; S.outAt = 0;
      renderScenes(); renderScriptSec(); drawScene(0); paintFoot();
      say('按「🖼 出图」那张画面表排好 ' + S.scenes.length + ' 幕（' + rows.length + ' 段）');
      persist();
      if (o.frame === 'card') paveRows(rows);
    } else {
      /* 没画面表：稿进左边框，幕空着——下面这一发一路跑完（调稿→提重点→出片稿→切幕） */
      S.scenes = []; S.tl = null; cache.key = ''; curScene = 0; S.outAt = 0;
      renderScriptSec(); renderScenes(); drawScene(0); paintFoot();
      persist();
    }
    fvRun(false, false, true);   // 进站自动直出（幕已排好的不动；没稿先按正文调，B5）
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
    S.fvEdited = !!doc.fvEdited;
    S.scenes = (doc.scenes || []).map(sc => ({
      label: sc.label, name: sc.name || '', text: String(sc.text || ''),
      lines: (sc.lines || []).slice(), em: (sc.em || []).map(e => ({ l: e.l, t: e.t })),
      layout: sc.layout || 'center', cardKey: sc.cardKey || '',
      card: (sc.card && sc.card.src) ? Object.assign({}, sc.card) : null,
      tone: sc.tone || '',                                          // 这一屏的调（字响三档）；旧草稿没标就空着，出片时按词表补
      mats: (Array.isArray(sc.mats) ? sc.mats : (sc.mat ? [sc.mat] : []))   // 一屏一单（旧草稿只有一段＝迁移成一条）
        .map(m => Object.assign({}, m, { src: '' })),                     // 补选过的原图不入库，回来要重补一次
      estSec: Math.max(1.2, +(cn(sc.text) / 4.5).toFixed(2)),
    }));
    S.tl = null; cache.key = ''; curScene = 0;
    S.outAt = Number(doc.outAt || 0) || 0;
    if (o && (o.frame === 'card' || o.frame === 'mix')) S.cfg.frame = o.frame;
    buildStyleUI(); buildVoiceUI(); renderScriptSec(); renderScenes(); drawScene(0); paintFoot(); paintHead();
    if (S.cfg.frame === 'mix' && S.scenes.some(sc => matsOf(sc).length)) prepMats().then(() => drawScene(curScene)).catch(() => {});
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
  /* 七十二改：外壳（顶栏／工作流条／底栏）画在外层那页，那几颗按钮点进来走这里 */
  S.shell = { start: make, stop: () => stopFilm(), cfg: cfgOpen, popOut: () => popOut() };

  /* 在工作流里时的出口：单开一页慢慢编（先把手上这份稿子存好，别让新页拿到旧稿）。
     把工作流条上前几站的站名原样带过去——新页那条也摆得出「挑知识／改稿」，
     只是那边没有向导可回（那一条整条摆灰），鼠标停上会说清为什么。 */
  function popOut() {
    const t = String(S.script || '').trim();
    const q = (Array.isArray(S.flow) && S.flow.length)
      ? '?flow=' + encodeURIComponent(JSON.stringify(S.flow.map(s => ({ t: s.t })))) : '';
    const open = () => chrome.tabs.create({ url: chrome.runtime.getURL('video.html' + q), active: true });
    const go = () => { if (t) store.set(KEY_SCRIPT, t).then(open, open); else open(); };
    if (S.noteId) persistNow().then(go, go); else go();
  }
  function stopFilm() {
    S.busy = false;
    if (typeof S.cancelFilm === 'function') { try { S.cancelFilm('已停下'); } catch (_) {} }
    say('停了'); warn('已停下（这一条没出片，重出一次就好）');
  }
  $('audition').onclick = audition;
  $('go').onclick = make;
  $('stop').onclick = stopFilm;

  /* ── 窄屏收成两签（老板定的 B 案）：弹窗那 640 宽塞不下「稿｜幕｜预览」三块，
     顶上两签一次看一栏；宽了（大窗／单开一页）这条自己收起，两栏并排照旧。 */
  function paintTabs() {
    const strip = $('filmTabs');
    if (!strip) return;
    strip.querySelectorAll('button').forEach(b =>
      b.classList.toggle('on', b.getAttribute('data-ftab') === S.ftab));
  }
  function fitTabs() {
    pane.classList.toggle('narrow', pane.clientWidth < 860);
    paintTabs();
  }
  S.setFTab = (which) => { S.ftab = which === 'scenes' ? 'scenes' : 'script'; pane.classList.toggle('tab-scenes', S.ftab === 'scenes'); paintTabs(); return S.ftab; };
  $('filmTabs').addEventListener('click', (ev) => {
    const b = ev.target.closest && ev.target.closest('button');
    if (b) S.setFTab(b.getAttribute('data-ftab'));
  });

  /* ── 分幕那栏里那两签（分幕｜画面）：一次看一签；「画面」那签上一颗小点＝这一篇垫着底 */
  $('scTabs').addEventListener('click', (ev) => {
    const b = ev.target.closest && ev.target.closest('button');
    if (!b) return;
    S.sctab = b.getAttribute('data-sctab') === 'pic' ? 'pic' : 'lines';
    paintPicPane();
  });
  $('picSw').addEventListener('click', (ev) => {
    const b = ev.target.closest && ev.target.closest('button');
    if (b) setPic(b.getAttribute('data-pic') === 'on');
  });
  $('picKind').addEventListener('click', (ev) => {
    const c = ev.target.closest && ev.target.closest('[data-pickind]');
    if (c) setPicKind(c.getAttribute('data-pickind'));
  });
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => fitTabs()).observe(pane);
  else window.addEventListener('resize', fitTabs);
  fitTabs();

  // 关页/关弹窗那一下把攒着的改动落盘（弹窗一关这里就没了，定时器不会再响）
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

  S.ready = init().catch(() => {});     // 外层等这一发齐了再递稿子（别让它从存档读回来的那份盖掉刚递的）

})();
