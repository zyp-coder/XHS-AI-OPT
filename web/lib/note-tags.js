/**
 * note-tags.js — 话题采集池（#话题 → 搜索关键词）
 *
 * 两处来源：① 打开过的笔记详情（标题 + og:description 里的 #话题）；② 搜索结果卡片文本里能读到的 #话题。
 * 按出现次数累计，供关键词列表「🏷 采集话题」一键取用；池子随租户切换（见 lib/tenant.js TENANT_SCOPED_KEYS）。
 */
(function () {
  const KEY = 'topic_pool'; // { [tag]: { n: 次数, t: 最近一次时间戳 } }
  const MAX_TAGS = 160;     // 池子上限：超出按「次数低的先淘汰」

  /** 抽 #话题：中英文/数字/下划线/Emoji，长度 2~24；排除纯数字；最多 12 个（去重保序） */
  function extract(text) {
    const out = [];
    const s = String(text || '');
    if (!s || s.indexOf('#') === -1) return out;
    // 先整段取到分隔符为止，再用长度过滤：超长串（>24）整条丢弃，不截断成假话题
    const re = /[#＃]([^\s#＃,，。；;!！?？、:："'“”（）()【】\[\]\/\\|<>@$%^&*+=~`]+)/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      const t = String(m[1]).replace(/[.。，,、;；:：]+$/, '').trim();
      if (!t || t.length < 2 || t.length > 24) continue;
      if (/^\d+$/.test(t)) continue;
      if (out.indexOf(t) === -1) out.push(t);
      if (out.length >= 12) break;
    }
    return out;
  }

  async function load() {
    try {
      const r = await chrome.storage.local.get(KEY);
      const d = r[KEY];
      return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
    } catch (_) { return {}; }
  }

  function prune(pool) {
    const keys = Object.keys(pool);
    if (keys.length <= MAX_TAGS) return pool;
    keys.sort((a, b) => ((pool[b] && pool[b].n) || 0) - ((pool[a] && pool[a].n) || 0));
    const keep = {};
    keys.slice(0, MAX_TAGS).forEach(k => { keep[k] = pool[k]; });
    return keep;
  }

  /** 批量累计（每个词 +1）；返回新词个数 */
  async function merge(tags) {
    const list = (tags || []).map(x => String(x || '').trim()).filter(Boolean);
    if (!list.length) return 0;
    const pool = await load();
    const now = Date.now();
    let added = 0;
    list.forEach(t => {
      const cur = pool[t];
      if (cur) { cur.n = (cur.n || 0) + 1; cur.t = now; }
      else { pool[t] = { n: 1, t: now }; added++; }
    });
    try { await chrome.storage.local.set({ [KEY]: prune(pool) }); } catch (_) {}
    return added;
  }

  /** 笔记详情抓完（pageData 里有 title/description）→ 收录话题 */
  async function recordFromPage(pageData) {
    if (!pageData) return 0;
    return await merge(extract(String(pageData.title || '') + ' ' + String(pageData.description || '')));
  }

  /** 搜索结果列表渲染时（笔记对象带 tags 字段）→ 收录话题 */
  async function recordFromNotes(notes) {
    const all = [];
    (notes || []).forEach(n => { ((n && n.tags) || []).forEach(t => all.push(t)); });
    return await merge(all);
  }

  /** 取池子：按次数降序（同次数按最近出现时间）→ [{ tag, n, t }] */
  async function list() {
    const pool = await load();
    return Object.keys(pool)
      .map(tag => ({ tag, n: (pool[tag] && pool[tag].n) || 0, t: (pool[tag] && pool[tag].t) || 0 }))
      .sort((a, b) => (b.n - a.n) || (b.t - a.t));
  }

  window.NoteTags = { KEY, MAX_TAGS, extract, merge, recordFromPage, recordFromNotes, list };
})();
