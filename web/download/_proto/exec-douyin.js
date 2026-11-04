/* exec-douyin.js — 抖音获客的三个动作（2026-10-25）
 *
 * 一招：搜词 → 捞 20 条作品 → 逐条开弹层读评论 → 把「问价/求推荐」的人记进线索。
 *
 * 边界（资料/抖音获客-确认单.md §二/§四）：
 *   · 这轮只「看和记」——不发评论、不发私信、不关注；
 *   · 不碰 exec-core.js（内核是逐字节副本）；结果记在 dy_drain_last / dy_leads，
 *     不跟小红书那本账（drain_notes / 灌水台账）混。
 *
 * 页面怎么驱动：干活窗口里开一扇抖音页，用 chrome.scripting.executeScript 在里面跑
 *   下面 page* 那几个自包含小函数。DOM 特征都是 2026-10-25 真机核过的：
 *   作品卡 [id^="waterfall_item_"]、评论条 [data-e2e="comment-item"]、
 *   评论滚动层＝[data-e2e="comment-list"] 往上第一个能滚的父层、弹层字段用 data-e2e。
 *
 * 两个坑（确认单里写过的）：
 *   ① 偶发空壳：等 20 秒 → 还空就重开一次 → 仍空＝「这轮没取到」，不判失败；
 *   ② 不能无头跑：必须带窗口（干活窗口那扇），撞登录墙就停手等扫码，最多等 10 分钟。
 */
(() => {
  'use strict';
  if (window.ExecDouyin) return;

  const DY_HOME = 'https://www.douyin.com/';
  const DY_SEARCH = (kw) => 'https://www.douyin.com/search/' + encodeURIComponent(kw);

  let tabId = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ── 干活窗口 id（exec-workwin 存在 session 里；老浏览器退回 local 前缀键） ── */
  async function workWinId() {
    try {
      const s = await chrome.storage.session.get('ex.workWinId');
      const id = Number(s && s['ex.workWinId']) || 0;
      if (id) { try { await chrome.windows.get(id); return id; } catch (_) {} }
    } catch (_) {}
    try {
      const l = await chrome.storage.local.get('__s_ex.workWinId');
      const id = Number(l && l['__s_ex.workWinId']) || 0;
      if (id) { try { await chrome.windows.get(id); return id; } catch (_) {} }
    } catch (_) {}
    return 0;
  }

  /* ── 拴一扇抖音页：优先用干活窗口里现成的，没有再开（同一扇窗，不另开窗） ── */
  async function ensureTab() {
    if (tabId) { try { await chrome.tabs.get(tabId); return tabId; } catch (_) { tabId = 0; } }
    const winId = await workWinId();
    let tabs = [];
    try { tabs = await chrome.tabs.query({ url: 'https://www.douyin.com/*' }); } catch (_) {}
    let tab = null;
    if (winId) tab = tabs.find((t) => t.windowId === winId) || null;
    if (!tab) tab = tabs[0] || null;
    if (tab) {
      if (winId && tab.windowId !== winId) {
        try { await chrome.tabs.move(tab.id, { windowId: winId, index: -1 }); } catch (_) {}
      }
      tabId = tab.id;
      return tabId;
    }
    const props = { url: DY_HOME, active: true };
    if (winId) props.windowId = winId;
    const t = await chrome.tabs.create(props);
    tabId = t.id;
    return tabId;
  }

  /* ── 在抖音页里跑一个小函数（函数自己带全，别引用外面的变量） ── */
  async function exec(tab, fn, args) {
    let lastErr = null;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await chrome.scripting.executeScript({ target: { tabId: tab }, func: fn, args: args || [] });
        const first = r && r[0];
        return first ? first.result : null;
      } catch (e) {
        lastErr = e;
        await sleep(700);
      }
    }
    throw new Error('抖音页脚本没跑起来：' + ((lastErr && lastErr.message) || lastErr || ''));
  }

  /* ═══════════ 页面里的小函数（自包含） ═══════════ */

  /* 这一页现在是什么状态：有几条作品 / 要登录 / 要验证 */
  function pageProbe() {
    const n = document.querySelectorAll('[id^="waterfall_item_"]').length;
    const txt = (document.body && document.body.innerText ? document.body.innerText : '').replace(/\s+/g, ' ');
    const login = n === 0 && /登录后即可搜索|登录后查看更多|登录后可查看|扫码登录|验证码登录|手机号登录|密码登录/.test(txt);
    const captcha = n === 0 && /安全验证|请完成下列验证|拖动滑块|完成验证/.test(txt);
    return { url: location.href, cards: n, login: login, captcha: captcha, text: txt.slice(0, 200) };
  }

  /* 滚着把作品卡收齐：卡片文字＝「时长 点赞 标题 @作者 · 日期」 */
  function pageCollect(max) {
    return new Promise((resolve) => {
      const parse = (card, id) => {
        const raw = (card.innerText || '').replace(/\s+/g, ' ').trim();
        if (!raw) return null;
        /* 搜索页底部那块「相关搜索」也挂 waterfall_item_ 的 id（10-25 整轮踩到：
           20 条里混进 2 条，作者/日期/时长全空、也打不开）——它不是作品，直接跳过 */
        if (/^相关搜索/.test(raw)) return null;
        const dm = raw.match(/^(\d{1,2}:\d{2})\s+([\d.]+万?)\s+/);
        const duration = dm ? dm[1] : '';
        const likes = dm ? dm[2] : '';
        let rest = dm ? raw.slice(dm[0].length) : raw;
        const am = rest.match(/@([^@]{1,30}?)\s*·\s*([^\s]+)\s*$/);
        const author = am ? am[1].trim() : '';
        const date = am ? am[2] : '';
        if (am) rest = rest.slice(0, am.index).trim();
        if (!rest) return null;
        return {
          id: id, title: rest.slice(0, 120), author: author, date: date,
          likes: likes, duration: duration, url: 'https://www.douyin.com/video/' + id,
        };
      };
      const seen = {};
      const out = [];
      let stale = 0, last = -1, step = 0;
      const tick = () => {
        const cards = document.querySelectorAll('[id^="waterfall_item_"]');
        for (let i = 0; i < cards.length; i++) {
          const id = String(cards[i].id || '').replace(/^waterfall_item_/, '');
          if (!id || seen[id]) continue;
          const info = parse(cards[i], id);
          if (!info) continue;
          seen[id] = 1;
          out.push(info);
        }
        if (out.length >= max || step >= 16) { resolve(out.slice(0, max)); return; }
        const holder = document.querySelector('#waterFallScrollContainer');
        if (holder && holder.scrollHeight > holder.clientHeight + 40) {
          holder.scrollTop = holder.scrollHeight;
          holder.dispatchEvent(new Event('scroll', { bubbles: true }));
        }
        try { window.scrollTo(0, (document.documentElement && document.documentElement.scrollHeight) || 999999); } catch (_) {}
        try { window.dispatchEvent(new Event('scroll')); } catch (_) {}
        step++;
        setTimeout(() => {
          if (out.length === last) stale++; else stale = 0;
          last = out.length;
          if (stale >= 3) { resolve(out.slice(0, max)); return; }
          tick();
        }, 1300);
      };
      tick();
    });
  }

  /* 弹层这几个小函数是各自单独送进页面的（executeScript 只带自己），
     所以状态判断得写在每个函数里头，不能互相调用。 */

  /* 点开一条作品（点封面图）：弹层真起来、而且弹的是这一条，才算成 */
  function pageOpenWork(id) {
    return new Promise((resolve) => {
      /* 弹层是上下滑的，看过的视频节点都留在 DOM 里、被挪到视口外；
         只认「还留在屏幕里」的那一份（10-25 真页踩到：不然永远读到最老那条） */
      const inside = (el) => {
        const r = el.getBoundingClientRect();
        return r.bottom > 0 && r.top < (window.innerHeight || 0) && r.right > 0 && r.left < (window.innerWidth || 0);
      };
      const st = () => {
        const ic = Array.prototype.find.call(
          document.querySelectorAll('[data-e2e="feed-comment-icon"]'), inside) || null;
        let mid = '';
        try { mid = new URL(location.href).searchParams.get('modal_id') || ''; } catch (_) {}
        return { open: !!ic, mid: mid, url: location.href };
      };
      const mine = () => {
        const s = st();
        return s.open && (!s.mid || s.mid === id);
      };
      if (mine()) { resolve({ ok: true, already: true }); return; }
      const card = document.getElementById('waterfall_item_' + id);
      if (!card) { resolve({ ok: false, error: 'card-gone' }); return; }
      try { card.scrollIntoView({ block: 'center' }); } catch (_) {}
      setTimeout(() => {
        const img = card.querySelector('img') || card.querySelector('.videoImage') || card;
        try { img.click(); } catch (_) {}
        let n = 0;
        const t = setInterval(() => {
          if (mine()) { clearInterval(t); resolve({ ok: true, url: location.href }); return; }
          if (++n >= 24) {
            clearInterval(t);
            const s = st();
            resolve({ ok: false, error: s.open ? 'modal-mismatch' : 'modal-timeout', mid: s.mid, url: s.url });
          }
        }, 500);
      }, 400);
    });
  }

  /* 弹层上那排数：作者 / 文案 / 点赞 / 收藏 / 转发 / 评论数 / 日期 */
  function pageReadModal() {
    /* 只取留在屏幕里的那一份（旧的几条被挪到视口外了） */
    const pick = (s) => {
      let best = null, bestA = 0;
      document.querySelectorAll(s).forEach((el) => {
        const r = el.getBoundingClientRect();
        const vw = window.innerWidth || 0, vh = window.innerHeight || 0;
        const w = Math.min(r.right, vw) - Math.max(r.left, 0);
        const h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
        const a = (w > 0 && h > 0) ? w * h : 0;
        if (a > bestA) { bestA = a; best = el; }
      });
      if (!best) return '';
      return String(best.innerText || best.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    };
    let mid = '';
    try { mid = new URL(location.href).searchParams.get('modal_id') || ''; } catch (_) {}
    return {
      ok: Array.prototype.some.call(
        document.querySelectorAll('[data-e2e="feed-comment-icon"]'),
        (el) => el.getBoundingClientRect().bottom > 0 && el.getBoundingClientRect().top < (window.innerHeight || 0)),
      mid: mid,
      nickname: pick('[data-e2e="feed-video-nickname"]'),
      desc: pick('[data-e2e="video-desc"]'),
      digg: pick('[data-e2e="video-player-digg"]'),
      collect: pick('[data-e2e="video-player-collect"]'),
      share: pick('[data-e2e="video-player-share"]'),
      comments: pick('[data-e2e="feed-comment-icon"]'),
      info: pick('[data-e2e="video-info"]'),
      url: location.href,
    };
  }

  /* 评论默认不出：点右侧评论图标 */
  function pageOpenComments() {
    return new Promise((resolve) => {
      /* 评论列表也分属于各条视频，只认屏幕里那一份 */
      const activeList = () => {
        let best = null, bestA = 0;
        document.querySelectorAll('[data-e2e="comment-list"]').forEach((el) => {
          const r = el.getBoundingClientRect();
          const vw = window.innerWidth || 0, vh = window.innerHeight || 0;
          const w = Math.min(r.right, vw) - Math.max(r.left, 0);
          const h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
          const a = (w > 0 && h > 0) ? w * h : 0;
          if (a > bestA) { bestA = a; best = el; }
        });
        return best;
      };
      const shown = () => {
        const l = activeList();
        return !!(l && l.querySelector('[data-e2e="comment-item"]'));
      };
      if (shown()) { resolve({ ok: true }); return; }
      const ic = Array.prototype.find.call(
        document.querySelectorAll('[data-e2e="feed-comment-icon"]'),
        (el) => {
          const r = el.getBoundingClientRect();
          return r.bottom > 0 && r.top < (window.innerHeight || 0) && r.width > 0;
        }) || null;
      if (ic) { try { ic.click(); } catch (_) {} }
      let n = 0;
      const t = setInterval(() => {
        if (shown()) { clearInterval(t); resolve({ ok: true }); return; }
        if (++n >= 20) { clearInterval(t); resolve({ ok: false, hasList: !!activeList() }); }
      }, 500);
    });
  }

  /* 滚评论：每次约多 10 条，滚到 max 或不再长为止 */
  function pageReadComments(max) {
    return new Promise((resolve) => {
      const RE = /([0-9]+秒前|[0-9]+分钟前|[0-9]+小时前|[0-9]+天前|[0-9]+周前|[0-9]+个月前|[0-9]+月前|[0-9]+年前|[0-9]{2}-[0-9]{2}|刚刚)\s*(?:·\s*([^\s]+))?\s*([0-9]+)?\s*分享\s*回复/;
      const parse = (el) => {
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (!t) return null;
        const i = t.indexOf('...');
        const nick = i > 0 ? t.slice(0, i).trim().slice(0, 40) : '';
        const rest = i > 0 ? t.slice(i + 3).trim() : t;
        const m = RE.exec(rest);
        const content = (m ? rest.slice(0, m.index) : rest).trim().slice(0, 300);
        if (!content) return null;
        return {
          nickname: nick, content: content,
          time: m ? m[1] : '', region: m ? (m[2] || '') : '', like: m ? (m[3] || '') : '',
          expand: (t.match(/展开\s*([0-9]+)\s*条回复/) || [])[1] || '',
        };
      };
      /* 评论列表分属于各条视频，只读屏幕里那一份里的评论 */
      const activeList = () => {
        let best = null, bestA = 0;
        document.querySelectorAll('[data-e2e="comment-list"]').forEach((el) => {
          const r = el.getBoundingClientRect();
          const vw = window.innerWidth || 0, vh = window.innerHeight || 0;
          const w = Math.min(r.right, vw) - Math.max(r.left, 0);
          const h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
          const a = (w > 0 && h > 0) ? w * h : 0;
          if (a > bestA) { bestA = a; best = el; }
        });
        return best;
      };
      const scroller = () => {
        let n = activeList();
        for (let k = 0; n && k < 6; n = n.parentElement, k++) {
          if (n.scrollHeight > n.clientHeight + 40) return n;
        }
        return null;
      };
      const itemsNow = () => {
        const l = activeList();
        return l ? l.querySelectorAll('[data-e2e="comment-item"]')
          : document.querySelectorAll('[data-e2e="comment-item"]');
      };
      const seen = {};
      const out = [];
      let stale = 0, last = -1, step = 0;
      const tick = () => {
        const items = itemsNow();
        for (let i = 0; i < items.length; i++) {
          const p = parse(items[i]);
          if (!p) continue;
          const key = p.nickname + '|' + p.content;
          if (seen[key]) continue;
          seen[key] = 1;
          out.push(p);
        }
        if (out.length >= max || step >= 26) { resolve(out.slice(0, max)); return; }
        const sc = scroller();
        if (sc) {
          sc.scrollTop = sc.scrollHeight;
          sc.dispatchEvent(new Event('scroll', { bubbles: true }));
        }
        step++;
        setTimeout(() => {
          if (out.length === last) stale++; else stale = 0;
          last = out.length;
          if (stale >= 3) { resolve(out.slice(0, max)); return; }
          tick();
        }, 1600);
      };
      tick();
    });
  }

  /* 关弹层：先按 Esc，关不掉再退历史（弹层是 ?modal_id= 起来的） */
  function pageClose() {
    return new Promise((resolve) => {
      /* 弹层是上下滑的，关掉后节点还在、只是挪到屏幕外；看屏幕里还有没有 */
      const open = () => Array.prototype.some.call(
        document.querySelectorAll('[data-e2e="feed-comment-icon"]'),
        (el) => {
          const r = el.getBoundingClientRect();
          return r.bottom > 0 && r.top < (window.innerHeight || 0) && r.width > 0;
        });
      if (!open()) { resolve({ ok: true, via: 'none' }); return; }
      try {
        const ev = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true });
        document.dispatchEvent(ev);
        window.dispatchEvent(ev);
      } catch (_) {}
      setTimeout(() => {
        if (!open()) { resolve({ ok: true, via: 'esc' }); return; }
        try { history.back(); } catch (_) {}
        setTimeout(() => { resolve({ ok: !open(), via: 'back', url: location.href }); }, 1500);
      }, 900);
    });
  }

  /* ═══════════ 「问价 / 求推荐」怎么认 ═══════════ */

  /* 直接开口要联系/求推荐的，不用带问号也算 */
  const LEAD_DIRECT = /(怎么联系我?|联系我|私信我|加个?微信|加微信|加vx|微信多少|微信号|vx|求推荐|求介绍|推荐一?下|推荐个|有没有推荐)/i;
  /* 问价/问推荐的说法，得配一个问句词（谁在哪家、多少钱…） */
  const LEAD_ASK = /(多少钱|什么价|怎么收费|收费标准|报价|预算|量房|上门量|免费设计|推荐|介绍|哪家)/i;
  /* 行业词/价格词：光出现不算，得是在问 */
  const LEAD_VALUE = /(价格|收费|费用|贵不贵|便宜点?|能便宜|有优惠|优惠|半包|全包|清包|整装|装修公司|装修队|工长|师傅|设计师|装修)/i;
  const ASK = /(多少|怎么|哪|有没有|求|吗|呢|\?|？)/;
  /* 同行/装修公司自己打广告：除非他同时在问价求推荐，否则不算线索 */
  const SELF_AD = /(我们(公司|团队|厂|店)|本公司|我是(做|干|搞)装修|我们(是)?做装修|专业承接|承接(各类|各种|大小|工程|业务)|专业装修|装修公司直营|欢迎咨询|欢迎来电|欢迎致电)/;
  const BUYER_ASK = /(求推荐|推荐一?下|推荐个|有没有推荐|哪家好|哪家靠谱|求介绍|多少钱|什么价|怎么收费|收费标准|报价|量房|上门量)/;

  function isLead(text) {
    const s = String(text || '').replace(/\s+/g, '');
    if (!s || s.length < 4) return false;
    if (SELF_AD.test(s) && !BUYER_ASK.test(s)) return false;
    if (LEAD_DIRECT.test(s)) return true;
    if (LEAD_ASK.test(s) && ASK.test(s)) return true;
    return LEAD_VALUE.test(s) && ASK.test(s);
  }

  /* ═══════════ 结果记账（抖音一本账，跟小红书分开） ═══════════ */

  async function saveLast(s) {
    try { await chrome.storage.local.set({ dy_drain_last: Object.assign({ plat: 'dy', at: Date.now() }, s || {}) }); } catch (_) {}
  }

  async function mergeLeads(list) {
    if (!list || !list.length) return 0;
    try {
      const d = await chrome.storage.local.get('dy_leads');
      const cur = Array.isArray(d && d.dy_leads) ? d.dy_leads : [];
      const seen = {};
      cur.forEach((x) => { if (x && x.key) seen[x.key] = 1; });
      const add = [];
      list.forEach((x) => { if (x && x.key && !seen[x.key]) { seen[x.key] = 1; add.push(x); } });
      if (add.length) await chrome.storage.local.set({ dy_leads: add.concat(cur).slice(0, 500) });
      return add.length;
    } catch (_) { return 0; }
  }

  /* ═══════════ 搜索：等结果 / 登录墙 / 空壳 ═══════════ */

  async function probe(tab) {
    try { return await exec(tab, pageProbe, []); } catch (_) { return null; }
  }

  async function settled(tab, ms) {
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < ms) {
      const p = await probe(tab);
      if (p) {
        last = p;
        if (p.cards > 0 || p.login || p.captcha) return p;
      }
      await sleep(1000);
    }
    return last || { cards: 0, login: false, captcha: false };
  }

  async function goto(tab, url) {
    try { await chrome.tabs.update(tab, { url: url, active: true }); } catch (_) {}
    await sleep(1200);
  }

  async function openSearch(tab, url, check, log) {
    await goto(tab, url);
    let p = await settled(tab, 25000);
    if (p && p.cards) return p;

    if (p && p.login) {
      log('🔒 抖音要登录：请在这扇窗里扫码，登录好自动接着跑（最多等 10 分钟）', 'warn');
      try { await chrome.tabs.update(tab, { active: true }); } catch (_) {}
      const winId = await workWinId();
      if (winId) { try { await chrome.windows.update(winId, { focused: true }); } catch (_) {} }
      for (let i = 0; i < 120; i++) {
        await sleep(5000);
        await check();
        const q = await probe(tab);
        if (q && q.cards) return q;
        if (q && !q.login && !q.captcha) {
          await goto(tab, url);
          const r = await settled(tab, 25000);
          if (r && r.cards) return r;
          if (r && r.captcha) return { captcha: true };
          if (r && r.login) { p = r; continue; }
          p = r || p;
          break;
        }
      }
      return p && p.cards ? p : { needLogin: true };
    }

    if (p && p.captcha) return { captcha: true };

    /* 偶发空壳：等 20 秒 → 还空就重开一次 → 仍空＝这轮没取到（不判失败） */
    log('⏳ 这轮结果是空的：等 20 秒再看看…', 'warn');
    await sleep(20000);
    p = await probe(tab);
    if (p && p.cards) return p;
    log('🔄 还是空的，重开一次这个搜索…', 'warn');
    await goto(tab, url);
    p = await settled(tab, 25000);
    return p || { cards: 0 };
  }

  /* 打开一条作品：先点封面；点不开就让网址带 ?modal_id= 兜底 */
  async function openWork(tab, work, searchUrl) {
    const r = await exec(tab, pageOpenWork, [work.id]);
    if (r && r.ok) return r;
    let u = searchUrl;
    try {
      const uu = new URL(searchUrl);
      uu.searchParams.set('modal_id', work.id);
      u = uu.toString();
    } catch (_) { u = searchUrl + (searchUrl.includes('?') ? '&' : '?') + 'modal_id=' + work.id; }
    await goto(tab, u);
    for (let i = 0; i < 20; i++) {
      await sleep(700);
      const m = await exec(tab, pageReadModal, []);
      if (m && m.ok) return { ok: true, via: 'url' };
    }
    return { ok: false, error: (r && r.error) || 'modal-timeout' };
  }

  async function closeWork(tab, searchUrl) {
    let r = null;
    try { r = await exec(tab, pageClose, []); } catch (_) {}
    if (r && r.ok) return true;
    await goto(tab, searchUrl);
    return true;
  }

  /* ═══════════ 一项：词 × 抖音（这一轮只跑「综合」） ═══════════ */

  async function runItem(opts) {
    const o = opts || {};
    const kw = String(o.kw || '').trim();
    if (!kw) return { ok: false, reason: 'nokw', msg: '没有关键词' };
    const maxWorks = Math.max(1, Math.min(40, Number(o.maxWorks) || 20));
    const maxComments = Math.max(1, Math.min(200, Number(o.maxComments) || 50));
    const check = (typeof o.check === 'function') ? o.check : async () => {};
    const log = (typeof o.log === 'function') ? o.log : () => {};
    const budgetMs = Math.max(60000, Number(o.budgetMs) || 11 * 60 * 1000);
    const t0 = Date.now();

    let tab = 0;
    try { tab = await ensureTab(); } catch (e) {
      return { ok: false, reason: 'notab', msg: '打不开抖音页：' + ((e && e.message) || e) };
    }
    if (!tab) return { ok: false, reason: 'notab', msg: '打不开抖音页' };

    const searchUrl = DY_SEARCH(kw);
    log('🎵 抖音搜「' + kw + '」…', 'info');
    let st = null;
    try {
      st = await openSearch(tab, searchUrl, check, log);
    } catch (e) {
      if ((e && e.message) === '手动停止') throw e;
      return { ok: false, reason: 'error', msg: (e && e.message) || String(e) };
    }
    if (st && st.needLogin) return { ok: false, reason: 'needLogin', msg: '抖音没登录 / 登录过期了' };
    if (st && st.captcha) return { ok: false, reason: 'captcha', msg: '抖音弹了安全验证，先停下' };
    if (!st || !st.cards) {
      await saveLast({ kw: kw, found: 0, comments: 0, leadN: 0, works: [], leads: [], note: '这轮没取到（搜索空壳）' });
      return { ok: false, reason: 'empty', msg: '这轮没取到（搜索空壳）' };
    }

    await check();
    const works = (await exec(tab, pageCollect, [maxWorks])) || [];
    log('🎬 搜到 ' + works.length + ' 条作品（每篇最多读 ' + maxComments + ' 条评论）', works.length ? 'success' : 'warn');

    const leads = [];
    const allComments = [];
    let commentTotal = 0;

    for (let i = 0; i < works.length; i++) {
      await check();
      if (Date.now() - t0 > budgetMs) {
        log('⏳ 这一趟快到点了：先收手，剩下的下轮再来', 'warn');
        break;
      }
      const w = works[i];
      let opened = false;
      try {
        const r = await openWork(tab, w, searchUrl);
        opened = !!(r && r.ok);
        if (!opened) {
          w.note = '没打开';
          log('  ↷ [' + (i + 1) + '/' + works.length + '] 没打开（' + ((r && r.error) || '超时') + '），跳过', 'warn');
          continue;
        }

        const info = await exec(tab, pageReadModal, []);
        if (info && info.mid) w.mid = info.mid;
        if (info && info.mid && info.mid !== w.id) {
          w.note = '弹层串了';
          log('  ↷ [' + (i + 1) + '/' + works.length + '] 弹层串成别的一条，跳过', 'warn');
          continue;
        }
        if (info && info.ok) {
          w.nickname = info.nickname || '';
          w.desc = info.desc || '';
          w.digg = info.digg || '';
          w.collect = info.collect || '';
          w.share = info.share || '';
          w.commentShown = info.comments || '';
          w.info = info.info || '';
          if (w.nickname) w.author = w.nickname;
        }

        const oc = await exec(tab, pageOpenComments, []);
        if (!oc || !oc.ok) { w.note = '评论没出来'; continue; }

        const rows = (await exec(tab, pageReadComments, [maxComments])) || [];
        w.readN = rows.length;
        commentTotal += rows.length;
        let hit = 0;
        rows.forEach((c) => {
          allComments.push({ workId: w.id, nickname: c.nickname, content: c.content });
          if (!isLead(c.content)) return;
          hit++;
          leads.push({
            key: w.id + '|' + String(c.nickname || '') + '|' + String(c.content || '').slice(0, 40),
            plat: 'dy', kw: kw, at: Date.now(),
            workId: w.id, workTitle: String(w.title || '').slice(0, 80), author: w.author || '',
            url: w.url,
            nickname: c.nickname, content: c.content,
            time: c.time, region: c.region, like: c.like,
          });
        });
        w.leadN = hit;
        log('  → [' + (i + 1) + '/' + works.length + '] ' + String(w.title || w.id).slice(0, 18) +
          ' … 评论 ' + rows.length + ' 条' + (hit ? ' · 问价 ' + hit + ' 个' : ''), 'info');
      } finally {
        await closeWork(tab, searchUrl);
      }
      /* 人味间隔：3~8 秒再看下一条 */
      await sleep(3000 + Math.floor(Math.random() * 5000));
    }

    await saveLast({
      kw: kw, found: works.length, comments: commentTotal, leadN: leads.length,
      works: works, leads: leads.slice(0, 200),
      commentsSample: allComments.slice(0, 50),
      note: '',
    });
    const added = await mergeLeads(leads);

    return {
      ok: true, works: works.length, comments: commentTotal,
      leads: leads.length, addedLeads: added, list: works,
    };
  }

  window.ExecDouyin = {
    runItem: runItem,
    ensureTab: ensureTab,
    isLead: isLead,
    tabId: () => tabId,
  };
})();
