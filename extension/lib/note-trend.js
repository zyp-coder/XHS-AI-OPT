/**
 * note-trend.js — 笔记点赞趋势引擎（循环计划专用）
 * 职责：
 *   1. 每次搜索把每篇笔记的点赞数采样入库（note_trends）
 *   2. 用最近两次采样计算点赞增速并打标：🔥快速增长 / 📈增长中 / ⚪平稳 / 📉下滑 / 🆕观察中
 *   3. 循环计划挑笔记：只挑"增长中/快速增长"的，且受度控制约束（每轮上限/每篇总次数/同篇冷却）
 * 运行在 popup 上下文（搜索渲染 + 自动机器人），不依赖 background。
 */
'use strict';

const NoteTrend = (function () {
  const TRENDS_KEY = 'note_trends';
  const CONFIG_KEY = 'note_trend_config';

  // 度控制默认值（可在设置页「💧 一键灌水 → 循环计划设置」调整）
  const DEFAULT_CONFIG = {
    maxPerRound: 3,      // 每轮最多评论几篇
    maxPerNote: 2,       // 每篇笔记最多总评论次数
    cooldownHours: 24,   // 真正灌水过的同一篇笔记冷却时间（小时）
    checkedHours: 2,     // 只"扫过、没东西可发"的笔记冷却时间（小时）——更短，给它更多被再次评估的机会
    scanIntervalMin: 2,  // 循环计划扫描间隔（分钟，调试用，生产建议 20）
  };

  function get(key, def) {
    return new Promise(function (resolve) {
      chrome.storage.local.get(key, function (d) {
        resolve(d[key] !== undefined ? d[key] : def);
      });
    });
  }
  function set(key, val) {
    return new Promise(function (resolve) {
      chrome.storage.local.set({ [key]: val }, resolve);
    });
  }

  /* "1.2万" → 12000；"1,234" → 1234；"3" → 3；其它 → 0 */
  function parseLikesNum(s) {
    if (!s) return 0;
    var t = String(s).trim().replace(/,/g, '');
    var m = t.match(/^([\d.]+)万$/);
    if (m) return Math.round(parseFloat(m[1]) * 10000);
    var n = parseFloat(t);
    return isNaN(n) ? 0 : n;
  }

  /* 累计点赞增长（首样本→末样本，跨整段历史）：用于排序与打标。
     ★ 用“历史累计”而非“仅相邻两次”：每轮只增一点、但跨轮稳步上涨的笔记，
       相邻对比看不出价值，累计对比能识别其真实增长，避免被忽略 */
  function cumulativeGrowth(t) {
    if (!t || !t.samples || t.samples.length < 2) return { delta: 0, spanH: 1, rate: 0, first: 0, last: 0 };
    var s = t.samples;
    var a = s[0], b = s[s.length - 1];
    var spanMs = b.ts - a.ts;
    var spanH = spanMs / 3600000 || 1;
    var delta = (b.likes || 0) - (a.likes || 0);
    return { delta: delta, spanH: spanH, rate: delta / spanH, first: a.likes || 0, last: b.likes || 0 };
  }

  /* 最近两次采样的每小时点赞增量（用于排序挑选） */
  function growthRate(t) {
    return cumulativeGrowth(t).rate;
  }

  /* 打标：需 ≥2 次采样；整段历史跨度 < minGapMs（默认9分钟）数据不可靠返回 null（保持原打标）。
     ★ 用首→末累计增量判断：Δ赞<0 下滑 / =0 平稳 / 每小时≥10 快速增长 / 其余增长中。
     改自“仅相邻两次”——每轮微涨的笔记靠累计对比也能识别为增长中，不再被忽略。
     minGapMs 由 recordSamples 按扫描间隔自适应传入 */
  function computeNoteTag(samples, minGapMs) {
    if (!samples || samples.length < 2) return 'new';
    var spanMs = samples[samples.length - 1].ts - samples[0].ts;
    if (spanMs < (minGapMs || 9 * 60 * 1000)) return null;
    var cg = cumulativeGrowth({ samples: samples });
    var delta = cg.delta;
    if (delta < 0) return 'down';
    if (delta === 0) return 'flat';
    return (cg.rate >= 10) ? 'hot' : 'growing';
  }

  const TAG_META = {
    hot: { label: '🔥 快速增长', color: '#c62828', desc: '每小时点赞增量 ≥10' },
    growing: { label: '📈 增长中', color: '#2e7d32', desc: '点赞持续增加' },
    flat: { label: '⚪ 平稳', color: '#757575', desc: '点赞无明显变化' },
    down: { label: '📉 下滑', color: '#1565c0', desc: '点赞减少（可能被限流）' },
    new: { label: '🆕 观察中', color: '#9e9e9e', desc: '采样不足，需再扫一轮' },
  };

  async function getConfig() {
    var saved = await get(CONFIG_KEY, {});
    return Object.assign({}, DEFAULT_CONFIG, saved || {});
  }
  async function setConfig(cfg) {
    var clean = {};
    ['maxPerRound', 'maxPerNote', 'cooldownHours', 'checkedHours', 'scanIntervalMin'].forEach(function (k) {
      var v = parseInt(cfg && cfg[k], 10);
      if (!isNaN(v) && v > 0) clean[k] = v;
    });
    await set(CONFIG_KEY, clean);
    return clean;
  }
  async function getTrends() {
    var v = (await get(TRENDS_KEY, {})) || {};
    // ★ 防脏数据：若被存成数组/字符串/非对象，一律按空表处理，避免 for-in 遍历到垃圾键、写坏整个趋势库
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return v;
  }
  async function clearTrends() {
    await set(TRENDS_KEY, {});
  }

  /* 记录一次点赞采样（minGapMs 内不重复采样，默认5分钟；短间隔调试时由 recordSamples 传小值）；返回该笔记的趋势对象 */
  async function recordNoteSample(note, minGapMs) {
    if (!note || !note.noteId) return null;
    var trends = await getTrends();
    var now = Date.now();
    var t = trends[note.noteId] || { samples: [], wateredCount: 0, lastWateredAt: 0, lastCheckedAt: 0, tag: 'new', tagAt: 0 };
    if (!t || typeof t !== 'object') t = { samples: [], wateredCount: 0, lastWateredAt: 0, lastCheckedAt: 0, tag: 'new', tagAt: 0 };
    if (!Array.isArray(t.samples)) t.samples = [];   // ★ 防历史脏结构
    if (note.title) t.title = note.title;
    t.url = note.url || t.url || '';
    if (note.author) t.author = note.author;
    var last = t.samples[t.samples.length - 1];
    if (last && now - last.ts < (minGapMs || 5 * 60 * 1000)) return t; // 防同一轮搜索内重复采样
    t.samples.push({ ts: now, likes: parseLikesNum(note.likes) });
    if (t.samples.length > 30) t.samples = t.samples.slice(-30);
    var tag = computeNoteTag(t.samples, minGapMs);
    if (tag) { t.tag = tag; t.tagAt = now; }
    trends[note.noteId] = t;
    await set(TRENDS_KEY, trends);
    return t;
  }

  /* 批量采样（搜索结果渲染时调用）；★必须逐个串行：recordNoteSample 内部是“读全量→改→写全量”，
   * 并发执行会互相覆盖（后写的把先写的整个对象冲掉），导致只留下最后 1 篇 → 挑笔记全部因采样不足被过滤。
   * ★采样/打标最小间隔随扫描间隔自适应：取“扫描间隔”与“60秒”的较小者，保证短间隔调试（2分钟）也能每轮采到样并打标 */
  var _sampleChain = Promise.resolve();
  function recordSamples(notes) {
    _sampleChain = _sampleChain.then(async function () {
      var cfg = await getConfig();
      var minGapMs = Math.min(60 * 1000, (cfg.scanIntervalMin || 20) * 60 * 1000);
      var arr = notes || [];
      for (var i = 0; i < arr.length; i++) {
        await recordNoteSample(arr[i], minGapMs);
      }
    }).catch(function () {});
    return _sampleChain;
  }
  async function flushSamples() {
    try { await _sampleChain; } catch (_) {}
  }

  /* 灌水成功后登记（循环计划度控制用） */
  async function markWatered(noteId) {
    if (!noteId) return;
    var trends = await getTrends();
    var t = trends[noteId];
    if (!t) return;
    t.wateredCount = (t.wateredCount || 0) + 1;
    t.lastWateredAt = Date.now();
    await set(TRENDS_KEY, trends);
  }

  /* 记住"这篇已经扫过、但没东西可发"：只记一个较短的"复核"冷却（checkedHours），不占浇水次数，也不占真正灌水的冷却(24h)。
     作用：循环计划隔一小会儿不会把刚扫过却空手的笔记又当"增长中"重新打开→反复刷同一页；
     同时因为窗口更短，等它真涨出新商机后仍会很快被再次评估。 */
  async function noteChecked(noteId) {
    if (!noteId) return;
    var trends = await getTrends();
    var t = trends[noteId];
    if (!t) {
      t = { samples: [], wateredCount: 0, lastWateredAt: 0, lastCheckedAt: 0, tag: 'new', tagAt: 0 };
      trends[noteId] = t;
    }
    t.lastCheckedAt = Date.now();
    await set(TRENDS_KEY, trends);
  }

  /* 循环计划挑笔记：只看增长中/快速增长的，且满足度控制（总次数上限 / 同篇冷却），按增速降序取前 maxPerRound 篇
     ★ allowedIds 可选：传入"当前这轮搜索结果"的 noteId 集合后，只从这些候选里挑——
       否则会从历史累积趋势库挑出不在当前页面的笔记，导致打开时 CTRL+F 找不到、全部失败 */
  function pickCycleNotes(trends, config, now, allowedIds) {
    now = now || Date.now();
    var out = [];
    for (var id in (trends || {})) {
      if (allowedIds && !allowedIds[id]) continue;
      var t = trends[id];
      if (!t || !t.samples || t.samples.length < 2) continue;
      if (t.tag !== 'growing' && t.tag !== 'hot') continue;
      if ((t.wateredCount || 0) >= (config.maxPerNote || 2)) continue;
      if (t.lastWateredAt && now - t.lastWateredAt < (config.cooldownHours || 24) * 3600000) continue;
      // ★ 只"扫过空手"的：用更短的 checkedHours 复核窗口，避免反复刷同一页，也不至于一整天不再看它
      if (t.lastCheckedAt && now - t.lastCheckedAt < (config.checkedHours || 2) * 3600000) continue;
      // ★ 把 noteId 挂到对象上：trends 以 noteId 为键，但 trend 对象本身不含 noteId，
      //   不挂上的话 _openNoteForce 传 note.noteId 为 undefined → openNote 报“笔记信息不完整”导致整篇被跳过
      t.noteId = id;
      out.push(t);
    }
    out.sort(function (a, b) { return growthRate(b) - growthRate(a); });
    return out.slice(0, (config.maxPerRound || 3));
  }

  return {
    DEFAULT_CONFIG,
    TAG_META,
    parseLikesNum,
    growthRate,
    computeNoteTag,
    getConfig,
    setConfig,
    getTrends,
    clearTrends,
    recordNoteSample,
    recordSamples,
    flushSamples,
    markWatered,
    noteChecked,
    pickCycleNotes,
  };
})();

// ★ 暴露到 window：popup 侧（auto-water-app.js / auto-bot.js）通过 window.NoteTrend 访问；
//   顶层的 const 不会自动挂到 window，不显式赋值会导致 window.NoteTrend 恒为 undefined、趋势采样与打标全部失效
if (typeof window !== 'undefined') {
  window.NoteTrend = NoteTrend;
}
if (typeof module !== 'undefined') {
  module.exports = NoteTrend;
}
