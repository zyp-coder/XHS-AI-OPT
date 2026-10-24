/* ============================================================
 * 前置门（2026-10-17 加「账号」独立页）——起始页 / 新手引导 / 账号 / 工作台共用
 * ------------------------------------------------------------
 * 顺序口径：
 *   新手引导 → 账号（已登录直接跳过；没登录才登录/领号）→ 问卷 / 工作台
 *   旧号（登录了＋问卷四步都生成过＋不是演示号）→ 直接进工作台，不拦
 *   随便逛逛的演示号（账号 kind='demo'）→ 直接进工作台，不拦引导/问卷
 *   样例号（真实新号，号里带建材店样例）→ 每次从入口进都重新弹引导（当新号给人看）
 *   没号 → 没看过引导先弹引导；看过引导就落账号页（没号不能先逛工作台）
 *   有号（新号）→ 没看过引导先弹引导；看过了就落问卷页（问卷没填完就接着填）
 *   问卷四步齐了（isOld）→ 再进起始页就去工作台
 *   从账号页过来带 ?fromAccount=1（刚领号/刚登录）→ 有号就留在问卷页，不再回弹
 *   工作台 popupGate：没号 → 账号页；有号但没看过引导 → 引导；其余放行
 * 「看过引导 / 看过问卷」都按号记：localStorage 'xhs_guide_seen:<账号id>' /
 * 'xhs_survey_seen:<账号id>'（没登录记 :anon），换号重新弹；起始页 boot() 里记「看过问卷」。
 * 判断结果 5 分钟缓存（sessionStorage），同一次浏览里反复开页不重复问服务器。
 * ============================================================ */
window.XhsGate = (() => {
  const STEPS = ['persona', 'product', 'knowledge', 'plan'];
  const CACHE_KEY = 'xhs_gate_c';
  const CACHE_MS = 5 * 60 * 1000;

  async function apiRaw(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  /* 服务器问一轮：我是谁 / 是不是演示号 / 问卷四步齐不齐 */
  async function check(force) {
    if (!force) {
      try {
        const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
        if (c && c.t > Date.now() - CACHE_MS) return c;
      } catch (_) {}
    }
    const out = { t: Date.now(), err: false, me: null, isDemo: false, isDemoAccount: false, isOld: false };
    try {
      const j = await apiRaw('/api/auth/me', {});
      out.me = j.account || null;
      if (out.me) {
        out.isDemoAccount = out.me.kind === 'demo';
        if (out.isDemoAccount) {
          /* 演示号：不查样例标记、不走引导；问卷/规划底子服务器已铺好 */
          out.isOld = true;
        } else {
          let demo = false;
          try {
            const s = await apiRaw('/api/storage/get', { keys: ['demo_preset'] });
            demo = !!(s.ok && s.items && s.items.demo_preset);
          } catch (_) {}
          out.isDemo = demo;
          let results = {};
          try {
            const a = await apiRaw('/api/action', { action: 'getConfig', data: {} });
            const cfg = (a.result && a.result.config) || {};
            results = (cfg.diagnosis && cfg.diagnosis.results) || {};
          } catch (_) {}
          out.isOld = !demo && STEPS.every((k) => results[k] && results[k].status === 'done');
        }
      }
    } catch (_) {
      out.err = true;
    }
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(out)); } catch (_) {}
    return out;
  }

  function keyOf(me) { return 'xhs_guide_seen:' + (me && me.id ? me.id : 'anon'); }
  function isSeen(me) { try { return localStorage.getItem(keyOf(me)) === '1'; } catch (_) { return false; } }
  function markSeen(me) { try { localStorage.setItem(keyOf(me), '1'); } catch (_) {} }
  function surveyKeyOf(me) { return 'xhs_survey_seen:' + (me && me.id ? me.id : 'anon'); }
  function surveyIsSeen(me) { try { return localStorage.getItem(surveyKeyOf(me)) === '1'; } catch (_) { return false; } }
  function surveyMarkSeen(me) { try { localStorage.setItem(surveyKeyOf(me), '1'); } catch (_) {} }
  function invalidate() { try { sessionStorage.removeItem(CACHE_KEY); } catch (_) {} }

  /* 入口（起始页 / 根路径）：true＝留下填问卷，false＝已把人送走 */
  async function entry() {
    const qs = new URLSearchParams(location.search);
    const fromAccount = qs.get('fromAccount') === '1';   // 刚在账号页领号/登录完
    const g = await check(false);
    if (g.err) return true;                              // 连不上服务器：留在本页报错，别把人转晕
    if (fromAccount) {
      if (!g.me) { location.replace('account.html?need=1'); return false; }
      if (g.isOld) { location.replace('popup.html?mode=big'); return false; }
      return true;                                       // 刚领的号：落在问卷页填
    }
    if (g.me && g.isDemoAccount) { location.replace('popup.html?mode=big'); return false; }  // 随便逛逛：直接进工作台
    if (g.me && g.isDemo) { location.replace('guide.html?from=entry'); return false; }  // 真实新号的建材样例：每次进门都重走引导
    if (g.me && g.isOld) { location.replace('popup.html?mode=big'); return false; }
    if (!g.me) {
      /* 没号：没看过引导先走引导，看过就落账号页——没号不能先逛工作台 */
      location.replace(isSeen(null) ? 'account.html?need=1' : 'guide.html?from=entry');
      return false;
    }
    if (!isSeen(g.me)) { location.replace('guide.html?from=entry'); return false; }
    return true;                                         // 有号、看过引导：问卷没填完就接着填
  }

  /* 工作台（popup）：没号去账号页；旧号放行；没看过引导才拦（引导里会记下，不会来回弹） */
  async function popupGate() {
    const g = await check(false);
    if (g.err) return;
    if (!g.me) {
      location.replace(isSeen(null) ? 'account.html?need=1' : 'guide.html?from=entry');
      return;
    }
    if (g.isDemoAccount) return;   // 随便逛逛的演示号：不拦引导
    if (g.isOld) return;
    if (isSeen(g.me)) return;
    location.replace('guide.html?from=entry');
  }

  return { check, entry, popupGate, isSeen, markSeen, keyOf, surveyIsSeen, surveyMarkSeen, surveyKeyOf, invalidate, apiRaw };
})();

/* ============================================================
 * 装机引导条（2026-10-23）——起始页 / 工作台 / 说明书共用
 * ------------------------------------------------------------
 * 要解决的事：在后台给某个号开了档位、发了配对号，网页这边一句话都没提过
 *   「你被开通了、下一步去装」；装好了也没人领他看「哪几格是因为装了才打开的」。
 * 四种态（一个号在同一时刻只会出现其中一条）：
 *   演示号      → 只导流「开自己的号」，全程不出现「去装」，也不出成功条
 *   免费档      → 不给下载入口，只说执行器是 239 起档位带的 → 看档位
 *   开通了没装  → 「这只手还没装」＋去装 · 三步 ＋装好能干什么
 *   刚挂上那一下 → 绿条「现在点发/开始是真发」＋先看说明书
 * 装了但浏览器关着（离线）＝不加第二条，只有顶栏那颗手写「· 离线」。
 * 关掉（×）记在这个号自己的浏览器里，7 天后再浮一次；挂上之后不再浮。
 * 判断只吃 /api/auth/me 那份（tier / kind / exec / edition.features），服务器不加字段。
 * 「哪几格开着」听服务器那张档位表，界面不自己判档。
 * ============================================================ */
window.XhsExecBar = (() => {
  const KEY = 'xhs_execbar_seen:';
  const REFLOAT = 7 * 24 * 3600 * 1000;
  /* 说明书上那四件事：功能格 → 名称（格名与 server/tier.mjs 那张表对齐）＋ 起步档 */
  const FOUR = [
    { k: 'notePublish', t: '真发笔记', from: '基础 239' },
    { k: 'autoWater', t: '评论区获客', from: '升级 399' },
    { k: 'dailyBrowse', t: '日常浏览', from: '升级 399' },
    { k: 'prospectList', t: 'AI客服', from: '全功能 539' },
  ];

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const keyOf = (me) => KEY + ((me && me.id) ? me.id : 'anon');
  function hidden(me) {
    try {
      const t = Number(localStorage.getItem(keyOf(me)) || 0);
      return !!t && Date.now() - t < REFLOAT;
    } catch (_) { return false; }
  }
  function dismiss(me) {
    try { localStorage.setItem(keyOf(me), String(Date.now())); } catch (_) {}
  }
  function reset(me) {
    try { localStorage.removeItem(keyOf(me)); } catch (_) {}
  }

  const isDemo = (me) => !!(me && me.kind === 'demo');
  const isPaid = (me) => {
    if (!me) return false;
    const ed = me.edition || {};
    return !!(me.tier && me.tier !== '免费') || !!(ed.label && ed.label !== '免费');
  };
  /** 档位那一句给人看的写法：「基础 239」；试用中前面多两个字 */
  function tierLabel(me) {
    const ed = (me && me.edition) || {};
    const nm = ed.label || me.tier || '';
    if (!nm) return '';
    const s = ed.price ? nm + ' ' + ed.price : nm + '版';
    return (ed.onTrial ? '试用中 · ' : '') + s;
  }
  /** 装了才真干的那几件（这一档开着的格子；免费档「只到写稿」不算真发） */
  function openJobs(me) {
    const ed = (me && me.edition) || {};
    const f = ed.features || {};
    return FOUR.filter((x) => f[x.k] && !(x.k === 'notePublish' && ed.draftOnly)).map((x) => x.t);
  }

  const BAR = 'display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;box-sizing:border-box;width:100%;'
    + 'border-radius:12px;padding:13px 15px;margin:0 0 14px;border:1px solid;border-left-width:5px;'
    + 'font-size:13px;line-height:1.68;box-shadow:0 2px 10px rgba(22,82,124,.07);';
  const TONE = {
    warn: 'background:#fff7ed;border-color:#fdba74;border-left-color:#ea580c;color:#7c2d12;',
    info: 'background:#eef6fb;border-color:#cfe3f1;border-left-color:#2b7fb8;color:#16527c;',
    ok: 'background:#ecfdf5;border-color:#a7f3d0;border-left-color:#0a7b5a;color:#065f46;',
  };
  const BTN = 'flex:none;display:inline-flex;align-items:center;border:none;border-radius:9px;padding:8px 14px;'
    + 'font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;text-decoration:none;white-space:nowrap;';
  const BTN_SOLID = BTN + 'background:#ea580c;color:#fff;';
  const BTN_GHOST = BTN + 'background:#fff;border:1px solid #fdba74;color:#9a3412;';
  const BTN_BLUE = BTN + 'background:#2b7fb8;color:#fff;';
  const BTN_OK = BTN + 'background:#0a7b5a;color:#fff;';
  const X = 'flex:none;border:none;background:transparent;font:inherit;font-size:17px;line-height:1;'
    + 'cursor:pointer;padding:2px 5px;opacity:.6;';
  const SUB = 'display:block;font-size:12px;opacity:.82;margin-top:5px;';

  /** 横幅这一条画什么：me＝/api/auth/me 那份账号；live＝{paired, online, justPaired}（工作台轮询补的实时态）；
   *  where＝'start' | 'bench'（起始页多一行「开通后回到这一页」） */
  function html(me, live, where) {
    if (!me) return '';
    const paired = live && typeof live.paired === 'boolean' ? live.paired : !!me.hasExec;
    if (isDemo(me)) {
      if (hidden(me)) return '';
      return `<div class="execbar" style="${BAR}${TONE.info}">
        <div style="flex:1 1 320px;min-width:0;">
          <b>演示号里这些都是示例数据，不能真跑。</b><br>
          开一个自己的号、装上执行器，它才会用你自己已登录的账号真干活。
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <a class="execbar-x" href="account.html" style="${BTN_BLUE}">开自己的号 →</a>
          <button type="button" class="execbar-close" data-x="1" style="${X}" title="先关掉：记在你浏览器里，7 天后再浮一次">×</button>
        </div></div>`;
    }
    if (paired) {
      /* 碰撞第 8 条：装了不在线＝不再多一条；只有「刚挂上那一下」出绿条 */
      if (!(live && live.justPaired)) return '';
      const jobs = openJobs(me);
      return `<div class="execbar" style="${BAR}${TONE.ok}">
        <div style="flex:1 1 320px;min-width:0;">
          <b>🎉 挂上了——现在点「发 / 开始」是真发，进度就在这页看。</b><br>
          你这一档真干的有：${esc(jobs.join(' · ')) || '（这一档还没开真干的格子）'}。
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <a class="execbar-x" href="executor.html" target="_blank" rel="noopener" style="${BTN_OK}">先看这页（能干什么）</a>
          <button type="button" class="execbar-ok" style="${BTN_GHOST}">知道了</button>
        </div></div>`;
    }
    if (hidden(me)) return '';
    if (!isPaid(me)) {
      return `<div class="execbar" style="${BAR}${TONE.info}">
        <div style="flex:1 1 320px;min-width:0;">
          <b>你现在的档位还不能装执行器（执行器是 239 起档位带的）。</b><br>
          网页上的写稿、出图、排计划照常用；要让发笔记、获客、AI客服真在你电脑上跑，先开通档位。
          ${where === 'bench' ? '' : `<span style="${SUB}">开通后回到这一页，下载按钮和你的配对号就会出现。</span>`}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <a class="execbar-x" href="guide.html#m4" style="${BTN_BLUE}">看档位 / 找客服开通</a>
          <button type="button" class="execbar-close" data-x="1" style="${X}" title="先关掉：记在你浏览器里，7 天后再浮一次">×</button>
        </div></div>`;
    }
    const jobs = openJobs(me);
    return `<div class="execbar" style="${BAR}${TONE.warn}">
      <div style="flex:1 1 320px;min-width:0;">
        <b>你的号已经开通（${esc(tierLabel(me))}）—— 这只手还没装。</b><br>
        装了才真干的是：${esc(jobs.join(' · ')) || '（这一档还没开真干的格子）'} —— 装上它，网页上点一下，活就在你这台电脑里真干。
        <span style="${SUB}">三步：下载 zip → 解压在浏览器里加载 → 填配对号挂上（约 2 分钟）</span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <a class="execbar-x" href="setup.html" style="${BTN_SOLID}">去装 · 三步</a>
        ${where === 'manual' ? '' : `<a class="execbar-x" href="executor.html" target="_blank" rel="noopener" style="${BTN_GHOST}">装好能干什么</a>`}
        <button type="button" class="execbar-close" data-x="1" style="${X}" title="先关掉：记在你浏览器里，7 天后再浮一次">×</button>
      </div></div>`;
  }

  /** 画进 host 这个盒子；返回 false＝这一态没东西可画 */
  function mount(host, me, live, where) {
    if (!host) return false;
    const h = html(me, live, where);
    if (!h) { host.innerHTML = ''; host.classList && host.classList.remove('on'); return false; }
    host.innerHTML = h;
    const x = host.querySelector('.execbar-close');
    if (x) x.addEventListener('click', () => { dismiss(me); host.innerHTML = ''; });
    const ok = host.querySelector('.execbar-ok');
    if (ok) ok.addEventListener('click', () => { host.innerHTML = ''; host.dataset.acked = '1'; });
    return true;
  }

  /** 说明书那四件按档位裁：给 executor.html 用（开着 / 没开 + 起步档） */
  function jobTags(me) {
    const ed = (me && me.edition) || {};
    const f = ed.features || {};
    const out = {};
    FOUR.forEach((x) => {
      const on = !!f[x.k] && !(x.k === 'notePublish' && ed.draftOnly);
      out[x.k] = { on: on, t: x.t, from: x.from };
    });
    return out;
  }

  return { FOUR, html, mount, dismiss, reset, hidden, openJobs, tierLabel, isPaid, isDemo, jobTags };
})();
