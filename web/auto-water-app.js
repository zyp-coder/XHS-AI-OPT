/**
 * auto-water-app.js — 笔记搜索 UI（左侧面板版）
 * 工作流：搜索 → 查看结果 → 点击"打开"触发右侧评论助手刷新
 */
'use strict';

window.AutoWaterApp = (function () {
  var pollTimer = null;
  var foundNotes = [];
  var resultsRendered = false;
  var eventsBound = false;
  var noteOpened = false;
  // ★ 执行器运行中：锁住单篇「🔗 打开」（人工与自动会抢同一个页面，必须显式互斥）
  var botLocked = false;

  function $(sel) { return document.querySelector(sel); }

  function showPanel(name) {
    document.querySelectorAll('#leftContent .panel').forEach(function(p) { p.classList.remove('active'); });
    var id = 'panel' + name.charAt(0).toUpperCase() + name.slice(1);
    var el = document.getElementById(id);
    if (el) el.classList.add('active');
  }

  function sendMsg(action, data, timeoutMs) {
    return new Promise(function(resolve, reject) {
      // ★ 超时兜底：background 不响应（SW 被挂起/异常/卡住）时绝不能无限等下去，否则整条自动灌水永久卡死。
      //   全流程所有 await 都走这里（且调用方都已 try/catch），超时只会让该步判失败、流程继续/收尾，而不是挂住。
      var settled = false;
      var t = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error('消息超时(' + (timeoutMs || 15000) + 'ms)无响应: ' + action));
      }, timeoutMs || 15000);
      try {
        chrome.runtime.sendMessage({ action: action, data: data }, function(resp) {
          if (settled) return;
          settled = true;
          clearTimeout(t);
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else if (!resp) reject(new Error('无响应'));
          else resolve(resp);
        });
      } catch (e) {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        reject(e);
      }
    });
  }

  function esc(str) {
    if (!str) return '';
    var d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }

  /* ─── 返回笔记列表 ─── */
  async function goBack() {
    try {
      var tabs = await chrome.tabs.query({ url: '*://www.xiaohongshu.com/*' });
      if (tabs && tabs.length > 0) {
        // ★ 传本次搜索关键词（取列表首词）：content 据此确定性导航回“搜索结果页”
        var kw = '';
        try { var _r = await chrome.storage.local.get('auto_water_config'); kw = (((_r['auto_water_config'] || {}).keywords) || [])[0] || ''; } catch (_) {}
        await chrome.tabs.sendMessage(tabs[0].id, { action: 'goBack', keyword: kw });
      }
    } catch (e) {
      console.error('[返回列表] 发送消息失败:', e);
    }
    noteOpened = false;
    document.querySelectorAll('.note-item.opening').forEach(function (el) { el.classList.remove('opening'); });
    enableOpenButtons();
  }

  function disableOpenButtons() {
    document.querySelectorAll('.btn-open-note').forEach(function(btn) {
      btn.disabled = true;
    });
  }

  function enableOpenButtons() {
    if (botLocked) return;   // ★ 执行器运行中：保持禁用，等它停机再放开
    document.querySelectorAll('.btn-open-note').forEach(function(btn) {
      if (btn.dataset.watered === 'true') return;
      btn.disabled = false;
    });
  }

  /* ─── 手动/自动互斥锁：执行器启动/停止时由 auto-bot.js 调用 ─── */
  function setBotLock(locked) {
    botLocked = !!locked;
    if (botLocked) disableOpenButtons();
    else enableOpenButtons();
  }

  /* ─── 全局通知：笔记被打开 (req 6) ─── */
  window._notifyNoteOpened = function (noteId) {
    if (!noteId) return;
    // 清除所有高亮
    document.querySelectorAll('.note-item.opening').forEach(function (el) { el.classList.remove('opening'); });
    // 高亮当前笔记
    var target = document.querySelector('.note-item[data-note-id="' + noteId.replace(/'/g, "\\'") + '"]');
    if (target) {
      target.classList.add('opening');
      target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    noteOpened = true;
    disableOpenButtons();
  };

  /* ─── 全局通知：笔记被灌水 (req 2) ─── */
  window._notifyNoteWatered = function (noteUrl) {
    if (!noteUrl) return;
    // 从 URL 中提取 noteId
    var m = noteUrl.match(/\/explore\/([a-f0-9]+)/) || noteUrl.match(/\/note\/([a-f0-9]+)/);
    if (!m) return;
    var noteId = m[1];
    var item = document.querySelector('.note-item[data-note-id="' + noteId.replace(/'/g, "\\'") + '"]');
    if (!item) return;

    // 添加 watered 类
    item.classList.add('watered');

    // 更新按钮（按钮本身就是「开过没有」的状态显示）
    var btn = item.querySelector('.btn-open-note');
    if (btn) {
      btn.textContent = '✅ 已灌水';
      btn.disabled = true;
      btn.className = 'btn btn-sm btn-gray btn-open-note';
      btn.dataset.watered = 'true';
      btn.title = '该笔记已灌水';
    }

    // 更新 foundNotes 中的数据
    for (var i = 0; i < foundNotes.length; i++) {
      if (foundNotes[i].noteId === noteId) {
        foundNotes[i].watered = true;
        break;
      }
    }
    // 重新应用筛选
    applyFilter();
  };

  /* ─── 关键词列表：本版本允许的最大关键词数（0＝不限 → Infinity，三档都不限量） ─── */
  var __kwMax = Infinity;
  async function ensureKwMax() {
    try {
      var r = await sendMsg('getEdition');
      var ed = r && r.edition;
      var v = Number(ed && ed.keywordMax);
      __kwMax = (isFinite(v) && v >= 1) ? v : Infinity;
    } catch (_) { __kwMax = Infinity; }
    return __kwMax;
  }

  var _kwIdx = 0; // 当前要搜索的关键词下标（逐词推进）
  var _kwBarBusy = false; // 同步词池会回调刷新标签，加锁防自激
  var _kwType = 'latest'; // 当前选的搜索类型：词标签只列这一类勾了词的词，点词就搜这一类
  // svg 是给界面用的线性图标名（lib/icons.js）；icon 只在 tooltip / 纯文本提示里当字形用
  var KW_TYPES = [
    { id: 'latest', icon: '🆕', svg: 'spark', name: '最新', tip: '关键词按「最新」搜，盯新帖抢前排' },
    { id: 'top', icon: '🔥', svg: 'pulse', name: 'TOP', tip: '关键词按点赞/评论/收藏最多搜，走活水维护' },
    { id: 'local', icon: '📍', svg: 'building', name: '本地', tip: '关键词+属地搜，本地刚需直接评（属地跟「诊断&配置 → 基础配置」）' },
    { id: 'pain', icon: '🎯', svg: 'target', name: '求助', tip: '关键词+求助词搜（求推荐/听劝）' },
    { id: 'rival', icon: '🕵️', svg: 'eye', name: '竞对', tip: '词填竞品名：只进笔记蹲人拉清单，一个字都不评论' }
  ];
  function curKwType() {
    for (var i = 0; i < KW_TYPES.length; i++) { if (KW_TYPES[i].id === _kwType) return KW_TYPES[i]; }
    return KW_TYPES[0];
  }
  /* 切换类型：只影响下面列哪些词、点词搜哪一类（词池本身不动） */
  async function pickKwType(id) {
    _kwType = id;
    try {
      var raw = await chrome.storage.local.get('auto_water_config');
      var cfg = raw['auto_water_config'] || {};
      cfg.schedule = cfg.schedule || {};
      cfg.schedule.kwType = id;
      await chrome.storage.local.set({ auto_water_config: cfg });
    } catch (_) {}
    await loadKwList();
  }

  /* 保存关键词列表：写进 📋 笔记列表 的「关键词池」（单份真源），池子再镜像到 auto_water_config.keywords
     列表里去掉的词 = 池里停用（不删，可在配置面板重新启用） */
  async function saveKwList(list) {
    var out = [], seen = {};
    (list || []).forEach(function (x) {
      x = String(x || '').trim();
      if (x && !seen[x]) { seen[x] = 1; out.push(x); }
    });
    var max = await ensureKwMax();
    if (typeof window.drainPoolApplyList === 'function') {
      try { return await window.drainPoolApplyList(out, max); } catch (_) {}
    }
    try {
      var raw = await chrome.storage.local.get('auto_water_config');
      var cfg = raw['auto_water_config'] || {};
      cfg.keywords = out;
      await chrome.storage.local.set({ auto_water_config: cfg });
      if (out[0]) await chrome.storage.local.set({ _aw_last_keyword: out[0] });
    } catch (_) {}
    return out;
  }

  /* 读词池（= 启用中的词）并渲染标签；返回列表 */
  async function loadKwList() {
    if (_kwBarBusy) return [];
    _kwBarBusy = true;
    try {
      var max = await ensureKwMax();
      var list = [], kwIdx = NaN;
      try {
        if (typeof window.drainSyncEnabledKeywords === 'function') {
          // 词池是源头：顺手把启用中的词镜像给获客侧（池空而获客侧有词时反向播种）
          list = await window.drainSyncEnabledKeywords();
        } else {
          var raw = await chrome.storage.local.get('auto_water_config');
          var cfg = raw['auto_water_config'] || {};
          list = (cfg.keywords || []).slice();
        }
        var raw2 = await chrome.storage.local.get('auto_water_config');
        var sch = ((raw2['auto_water_config'] || {}).schedule) || {};
        kwIdx = parseInt(sch.kwIdx, 10);
        for (var ti = 0; ti < KW_TYPES.length; ti++) { if (KW_TYPES[ti].id === sch.kwType) { _kwType = sch.kwType; break; } }
      } catch (_) {}
      if (!isNaN(kwIdx) && kwIdx >= 0 && kwIdx < list.length) _kwIdx = kwIdx;
      // 当前这一类在词池里勾了哪些词（没勾的不列出来，避免点了提示"没勾这一类"）
      var onInType = null;
      try { if (typeof window.drainPoolWordsFor === 'function') onInType = await window.drainPoolWordsFor(_kwType); } catch (_) {}
      renderKwList(list, max, onInType);
      return list;
    } finally { _kwBarBusy = false; }
  }
  window._kwBarReload = function () { return loadKwList(); };

  /* 收起那一行：眼下按什么口径跑（类型 · 当前词 · 这一类几个词）——点开才是控制面板 */
  function renderKwSummary(list, max, onInType) {
    var sum = document.getElementById('kwSummary');
    if (!sum) return;
    var t = curKwType();
    var all = (list || []).length;
    var n = onInType ? onInType.length : all;
    var cur = all ? String(list[Math.min(Math.max(_kwIdx, 0), all - 1)] || '') : '';
    sum.innerHTML = '';
    var a = document.createElement('span');
    a.textContent = t.icon + ' ' + t.name + (cur ? ' · ' + cur : ' · 还没启用词');
    sum.appendChild(a);
    var b = document.createElement('span');
    b.className = 'kw-fold-n';
    b.textContent = n ? ('· 这一类 ' + n + ' 个词') : '· 这一类还没勾词';
    sum.appendChild(b);
    sum.title = '当前搜「' + t.name + '」这一类 · 共启用 ' + all + (isFinite(max) ? '/' + max : '（本版本不限量）') + ' 个词 · 点开：换类型 / 点词立刻搜 / 加词';
  }

  /* 点了词＝开始搜这一类，把这一行收回去（要看再点开） */
  function kwFoldShut() {
    var b = document.getElementById('kwBar');
    if (b && b.tagName === 'DETAILS') b.open = false;
  }

  /* 渲染类型按钮 + 关键词标签（点词=立刻搜这一类；×=停用） + 提示 */
  function renderKwList(list, max, onInType) {
    var bar = document.getElementById('kwBar');
    var tags = document.getElementById('kwTags');
    var hint = document.getElementById('kwHint');
    if (bar) bar.style.display = 'block';
    var t = curKwType();
    renderKwSummary(list, max, onInType);
    /* 顶上那排类型：选哪一类，下面就只列这一类勾了词的词 */
    var tw = document.getElementById('kwTypes');
    if (tw) {
      tw.innerHTML = '';
      KW_TYPES.forEach(function (kt) {
        var on = (kt.id === _kwType);
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip-btn' + (on ? ' on' : '');
        b.innerHTML = (window.Ic ? window.Ic(kt.svg, 'ic-sm') : kt.icon) + kt.name;
        b.title = kt.tip + '（选它＝下面只列这一类勾了词的词，点词立刻搜这一类）';
        b.onclick = function () { pickKwType(kt.id); };
        tw.appendChild(b);
      });
    }
    var shown = 0;
    if (tags) {
      tags.innerHTML = '';
      list.forEach(function (k, i) {
        if (onInType && onInType.indexOf(k) < 0) return; // 这个词没勾当前类型
        shown++;
        var isCur = (i === _kwIdx);
        var c = document.createElement('span');
        c.className = 'kw-chip' + (isCur ? ' on' : '');
        c.title = '点这个词 = 立刻搜「' + t.icon + t.name + '」这一类（不用等间隔到点）';
        c.appendChild(document.createTextNode(k));
        var x = document.createElement('button');
        x.type = 'button';
        x.textContent = '×';
        x.title = '停用这个词（还留在词池里，可在「获客 → 任务配置」重新启用）';
        x.className = 'kw-chip-x';
        x.onclick = (function (idx) {
          return async function (ev) {
            if (ev) ev.stopPropagation();
            var l = await loadKwList();
            l.splice(idx, 1);
            await saveKwList(l);
            if (_kwIdx >= l.length) _kwIdx = 0;
            await loadKwList(); // 重新取「这一类勾了哪些词」再渲染
          };
        })(i);
        c.appendChild(x);
        c.onclick = (function (idx) {
          return function () { kwFoldShut(); useKeyword(idx); };
        })(i);
        tags.appendChild(c);
      });
      if (!shown) {
        var e = document.createElement('span');
        e.style.cssText = 'font-size:11px;color:#9ca3af;line-height:20px;';
        e.textContent = '这一类还没有词：到「获客 → 任务配置」把「' + t.name + '」这列勾上要跑的词。';
        tags.appendChild(e);
      }
    }
    if (hint) {
      hint.textContent = '';
      var q = document.createElement('span');
      q.className = 'qhelp';
      q.tabIndex = 0;
      q.setAttribute('data-tip', '按顺序逐个搜：第一个词跑完才轮到第二个。点词＝立刻只搜这一类（不用等间隔到点）；×＝停用（词池里还留着）；「搜索」＝按节奏跑当前词到点的几类；哪些词跑哪几类在「获客 → 任务配置」。');
      q.textContent = '?';
      hint.appendChild(q);
      /* 可见的只有跟着状态走的部分：当前搜哪一类 / 启用了几个词 */
      hint.appendChild(document.createTextNode(' ' + ((max === 1)
        ? '本版本关键词上限 1 个，只能启用 1 个（更多词先放进「获客 → 任务配置」的候选区）。'
        : ('当前搜「' + t.name + '」这一类 · 启用 ' + (list.length || 0) + (isFinite(max) ? '/' + max : '（不限量）') + ' 个词'))));
    }
  }

  /* 选定某个关键词为“当前要搜的词”并立刻搜「当前类型」这一类（一次只搜这一个动作）
     队列执行器会传 (idx, 类型)：只搜「这个词 × 这一类」，返回 {ok} 供它判定下一步 */
  async function useKeyword(idx, scenario) {
    var list = await loadKwList();
    if (idx < 0 || idx >= list.length) idx = 0;
    var only = scenario ? String(scenario) : '';
    _kwIdx = idx;
    try {
      var raw = await chrome.storage.local.get('auto_water_config');
      var cfg = raw['auto_water_config'] || {};
      cfg.schedule = cfg.schedule || {};
      cfg.schedule.kwIdx = idx;
      await chrome.storage.local.set({ auto_water_config: cfg });
    } catch (_) {}
    await loadKwList();
    try {
      var opt = { scenario: only || _kwType, force: true };
      if (only) opt.kw = list[idx];  // ★ 队列点单：词要精确命中（后台不顺延到别的词）
      var r = await sendMsg('searchNotes', opt);
      if (!r.ok) { showError(r.error || '搜索启动失败'); return { ok: false, error: r.error || '搜索启动失败' }; }
      await loadKwList();
      showPanel('searching');
      return { ok: true, keyword: r.keyword || list[idx], kwIdx: (typeof r.kwIdx === 'number' ? r.kwIdx : idx) };
    } catch (e) {
      showError('搜索请求失败: ' + e.message);
      return { ok: false, error: '搜索请求失败: ' + e.message };
    }
  }
  window._useKw = useKeyword;

  /* 盯的账号（👤 高V/竞对）：进他的个人主页扒最近的笔记（不搜词、不动词池指针）
     队列执行器会传 (主页链接, 类型, 昵称)：跑「这个人 × 这一类」，返回 {ok} 供它判定下一步 */
  async function useAccount(url, scenario, label) {
    var only = scenario ? String(scenario) : 'highv';
    var nm = label || url;
    try {
      var r = await sendMsg('searchNotes', { profile: String(url || ''), label: nm, scenario: only, force: true });
      if (!r.ok) { showError(r.error || '主页扫描启动失败'); return { ok: false, error: r.error || '主页扫描启动失败' }; }
      showPanel('searching');
      return { ok: true, keyword: r.keyword || nm };
    } catch (e) {
      showError('主页扫描请求失败: ' + e.message);
      return { ok: false, error: '主页扫描请求失败: ' + e.message };
    }
  }
  window._useAcct = useAccount;

  /* 从输入框添加关键词（支持一次输入多个，按 空格/逗号/顿号/换行 拆分） */
  async function addKwFromInput() {
    var max = await ensureKwMax();
    var input = document.getElementById('awKeywordPopup');
    var raw = input ? String(input.value || '') : '';
    var parts = raw.split(/[,，、\s\n]+/).filter(Boolean);
    if (parts.length === 0) { if (input) input.focus(); return; }
    var list = await loadKwList();
    for (var i = 0; i < parts.length; i++) {
      if (list.indexOf(parts[i]) === -1) {
        if (list.length >= max) { showError('最多只能启用 ' + max + ' 个关键词（当前版本上限）；更多词先放「获客 → 任务配置」的候选区，之后再挑。'); break; }
        list.push(parts[i]);
      }
    }
    list = await saveKwList(list);
    if (input) input.value = '';
    await loadKwList();
  }
  window._addKwKeyword = addKwFromInput;

  /* ✨ 找词 / 🏷 话题：跳到「获客 → 任务配置 · 关键词池」的候选区勾选入池
     （不再直接塞进启用列表——候选区不限量，勾选才占本版本的关键词名额） */
  async function openKwCandidates(kind) {
    if (typeof window.drainOpenCandidates !== 'function') { showError('词池未就绪，请重开弹窗再试'); return; }
    if (typeof addLog === 'function') addLog(kind === 'topic' ? '🏷 打开话题候选（勾选入池）…' : '✨ 打开 AI 找词候选（勾选入池）…', 'info');
    try { await window.drainOpenCandidates(kind); }
    catch (e) { showError('打开词池候选区失败：' + ((e && e.message) || e)); }
  }
  window._openKwCandidates = openKwCandidates;

  /* ─── 搜索（按关键词列表：逐个顺序搜索，第一个完成才开始第二个） ─── */
  async function doSearch() {
    var max = await ensureKwMax();
    var input = document.getElementById('awKeywordPopup');
    var typed = input ? String(input.value || '').trim() : '';
    var list = await loadKwList();
    // 输入框里还有没加进列表的词 → 自动先加入再搜（同样支持一次输入多个，按空格/逗号/顿号拆分）
    if (typed) {
      var extra = typed.split(/[,，、\s\n]+/).filter(Boolean);
      var dirty = false;
      for (var ei = 0; ei < extra.length; ei++) {
        if (list.indexOf(extra[ei]) === -1) {
          if (list.length >= max) { showError('关键词数量已达上限（' + max + ' 个），请先移除再添加。'); break; }
          list.push(extra[ei]);
          dirty = true;
        }
      }
      if (dirty) { list = await saveKwList(list); if (input) input.value = ''; await loadKwList(); }
    }
    if (list.length === 0) { showError('请先在左上方输入框添加一个搜索关键词（回车或点＋），再点搜索'); if (input) input.focus(); return; }
    foundNotes = [];
    resultsRendered = false;
    noteOpened = false;
    try {
      // 「搜索」= 按节奏跑当前词的这一轮（哪几类到点就搜哪几类）；
      // 想立刻只搜某一类，点上面那排类型按钮 + 词标签
      var resp = await sendMsg('searchNotes');
      if (!resp.ok) { showError(resp.error || '搜索启动失败'); return; }
      await loadKwList();   // 后台可能顺延到下一个到点的词，同步标签
      showPanel('searching');
    } catch (e) {
      showError('搜索请求失败: ' + e.message);
    }
  }

  /* ─── 回填/恢复关键词列表 ─── */
  async function restoreKeyword() {
    await loadKwList();
  }

  function showError(msg) {
    var el = document.getElementById('errorMessage');
    if (el) el.textContent = msg;
    showPanel('error');
  }

  /* "1.2万" → 12000；纯数字 → Number；其他 → 0 */
  function parseStatNum(s) {
    if (!s) return 0;
    var t = String(s).trim();
    var m = t.match(/^([\d.]+)万$/);
    if (m) return Math.round(parseFloat(m[1]) * 10000);
    var n = parseFloat(t);
    return isNaN(n) ? 0 : n;
  }

  /* 评论数推定：stats 按 DOM 顺序=赞/藏/评（平台不拆分语义），3 个取第 3、2 个取第 2；只有 1 个无法区分返回 0 */
  function getNoteCommentStat(note) {
    var st = note && note.stats;
    if (!st || st.length === 0) return 0;
    return parseStatNum(st[Math.min(st.length - 1, 2)]);
  }

  /* ─── 渲染搜索结果 ─── */
  function renderResults(notes) {
    // ★ 点赞趋势：本次搜索到的笔记采样入库（串行队列）；趋势只给执行器挑篇用，列表里不再展示
    if (window.NoteTrend) {
      try { window.NoteTrend.recordSamples(notes || []).catch(function () {}); } catch (_) {}
    }

    // ★ 按评论数降序展示（仅展示顺序；每篇定位索引 rawLinkIndex/searchIndex 是搜到时定死的，排序不影响定位）
    //   手动点开/自动灌水都按此顺序从上往下，评论多的笔记优先处理
    var sorted = (notes || []).slice().sort(function (a, b) {
      return getNoteCommentStat(b) - getNoteCommentStat(a);
    });

    // 🏷 话题采集：搜索结果卡片的 #话题 入池（供「关键词维护 · 话题」一键转搜索词）
    try { if (window.NoteTags) window.NoteTags.recordFromNotes(sorted); } catch (_) {}
    document.getElementById('resultsCount').textContent = '共 ' + sorted.length + ' 篇笔记' + (sorted.length > 1 ? '（按评论数降序）' : '');
    var list = document.getElementById('noteList');
    list.innerHTML = '';
    for (var i = 0; i < sorted.length; i++) {
      var note = sorted[i];
      var li = document.createElement('li');
      li.className = 'note-item' + (note.watered ? ' watered' : '');
      li.dataset.noteId = note.noteId;
      // 一行看完：标题 +（@作者 · 点赞 · 队列跑过没）+ 右侧 打开/删掉。类型标/趋势徽标/采样明细都撤了——
      // 那些是执行器的活儿，工作台只管「这篇是谁写的、多少人赞、队列里跑完没有」
      var likeVal = note.likes || (note.stats && note.stats.length ? note.stats[0] : '');
      li.innerHTML =
        '<div class="note-top">' +
          '<div class="note-body">' +
            '<div class="note-title"><a href="' + esc(note.url) + '" target="_blank">' + esc(note.title) + '</a></div>' +
            '<div class="note-meta">' +
              '<span class="note-author">@' + esc(note.author || '未知') + '</span>' +
              (likeVal ? '<span class="note-likes">👍 ' + esc(likeVal) + '</span>' : '') +
            '</div>' +
            // 队列执行结果（2026-09-25 三十一改）：原来这里标「👀 已打开」，换成「获客队列里这一篇跑过没」（跑过才显示）。
            // 单占一行——左栏窄，挤在作者/点赞那一行里会把「发 N 条」折断
            '<div class="note-q" style="display:none;"></div>' +
          '</div>' +
          '<button class="btn btn-sm ' + (note.watered ? 'btn-gray' : 'btn-primary') + ' btn-open-note"' +
            (note.watered ? ' disabled' : '') +
            ' data-watered="' + (note.watered ? 'true' : 'false') + '"' +
            ' title="' + (note.watered ? '该笔记已灌水' : '打开笔记并在右侧加载评论') + '">' +
            (note.watered ? '✅ 已灌水' : '🔗 打开') +
          '</button>' +
          '<button class="btn btn-sm btn-del-note" title="从这份搜索结果里删掉这一篇（只动列表：笔记池、灌水记录都不动）">🗑</button>' +
        '</div>';

      // 🔗 打开笔记按钮
      var openBtn = li.querySelector('.btn-open-note');
      if (openBtn && !note.watered) {
        openBtn.addEventListener('click', function(n) {
          return async function() {
            if (this.disabled || noteOpened) return;
            noteOpened = true;
            disableOpenButtons();
            this.textContent = '⏳ 打开中...';
            // ★ 把阶段①（打开+等就绪）也打进评论助手日志，与阶段②的抓取/重试串成一条轨迹
            if (typeof addLog === 'function') {
              addLog('🔗 正在打开笔记：' + String(n.title || n.noteId || '').slice(0, 30) + ' …', 'info');
            }
            try {
              var resp = await sendMsg('openNote', { note: n });
              if (resp && resp.ok) {
                this.textContent = '✅ 已打开';
                // 阶段①结果：就绪 / 超时
                if (typeof addLog === 'function') {
                  if (resp.ready) {
                    addLog('✅ 笔记页已就绪（等待约 ' + (Math.round((resp.waitedMs || 0) / 100) / 10) + ' 秒），开始扫描评论…', 'success');
                  } else {
                    addLog('⚠️ 等笔记就绪超时（约 8 秒），仍尝试扫描评论（若抓到卡片会自动重开）…', 'warn');
                  }
                }
                // 保存已打开的笔记 URL
                if (n.url && window.saveOpenedNoteUrl) {
                  window.saveOpenedNoteUrl(n.url);
                }
                // 自动刷新评论助手
                if (window.refreshCommentAssistant) {
                  window.refreshCommentAssistant();
                }
                // 重新应用筛选（隐藏已打开的笔记）
                applyFilter();
                // 保持禁用，等用户点“返回列表”
              } else {
                // ★ 定位失败（CTRL+F 3 次未命中 / 脚本不可用）：不降级导航，直接跳过本篇，区分于真报错
                var skipped = resp && resp.skipped;
                this.textContent = skipped ? '⏭ 已跳过' : ('❌ ' + ((resp && resp.error) || '失败'));
                if (typeof addLog === 'function') {
                  addLog((skipped ? '⏭ ' : '❌ ') + ((resp && resp.error) || '打开失败'), skipped ? 'warn' : 'error');
                }
                noteOpened = false;
                enableOpenButtons();
                var btn = this;
                setTimeout(function() {
                  if (!noteOpened) btn.textContent = '🔗 打开';
                }, 3000);
              }
            } catch (e) {
              this.textContent = '❌ ' + e.message.slice(0, 20);
              noteOpened = false;
              enableOpenButtons();
              var btn = this;
              setTimeout(function() {
                if (!noteOpened) btn.textContent = '🔗 打开';
              }, 3000);
            }
          };
        }(note));
      }
      // 🗑 删掉这一篇：只从这份搜索结果里删（列表快照），笔记池/灌水记录都不动。
      //    执行器跑着时不许删——列表正被「翻下一屏」整体替换、按索引定位，删了会跟页面脱节
      var delBtn = li.querySelector('.btn-del-note');
      if (delBtn) {
        delBtn.addEventListener('click', function(n, liEl) {
          return async function() {
            if (botLocked) { alert('执行器正在跑，先停下再删（列表这会儿跟着页面在同步）'); return; }
            if (this.disabled) return;
            this.disabled = true;
            var title = String(n.title || n.noteId || '').slice(0, 24);
            try {
              var r = await sendMsg('removeSearchResult', { noteId: n.noteId, url: n.url });
              if (!r || !r.ok) throw new Error((r && r.error) || '删除失败');
              // 按身份剔（noteId 优先、退到 url）：轮询会把 foundNotes 换成后台回的新对象，
              // 按对象引用剔会剔不掉，执行器随后拿到的还是带这一篇的旧清单
              var delKey = noteKeyOf(n);
              foundNotes = foundNotes.filter(function(x) { return noteKeyOf(x) !== delKey; });
              if (liEl.parentNode) liEl.parentNode.removeChild(liEl);
              var left = document.querySelectorAll('#noteList .note-item').length;
              var rc = document.getElementById('resultsCount');
              if (rc) rc.textContent = '共 ' + left + ' 篇笔记' + (left > 1 ? '（按评论数降序）' : '');
              applyFilter();
              if (typeof addLog === 'function') addLog('🗑 已从列表删掉：' + title, 'info');
            } catch (e) {
              this.disabled = false;
              alert('删不掉：' + (e && e.message ? e.message : e));
            }
          };
        }(note, li));
      }
      list.appendChild(li);
    }
    // ★ 执行器运行中重渲染（逐屏推进会整列重建）：新按钮默认可用，这里补回锁
    if (botLocked) disableOpenButtons();
  }

  /* 笔记身份键（删一篇 / 队列标认领都用它）：有 noteId 用 noteId，没有退到去参 url */
  function noteKeyOf(n) {
    if (!n) return '';
    var id = String(n.noteId || '');
    if (id) return 'id:' + id;
    var url = String(n.url || '').split('?')[0];
    return url ? 'url:' + url : '';
  }

  /* 时间小戳（队列标用）：今天只给 HH:MM，跨天带日期 */
  function awStamp(ts) {
    var t = Number(ts) || 0;
    if (!t) return '';
    var d = new Date(t), now = new Date();
    var hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return (d.toDateString() === now.toDateString() ? '' : (d.getMonth() + 1) + '-' + d.getDate() + ' ') + hm;
  }

  /* ─── 从持久化存储加载「已灌水 / 队列跑过没」并应用到列表 ───
     已灌水＝watered_notes + replied_comments（真正的"灌过了"，按钮转灰）；
     队列跑过没＝drain_queue.done[].notes[]（获客队列里这一篇执行完成没，标在标题下）——
     2026-09-25 三十一改：原来这里标「👀 已打开」（opened_notes），那是"点开过"的弱状态、
     跟干没干活没关系，老板要的是"队列里这篇跑完没"，所以换掉。
     bot 记的 t 是标题截断（增长支路截 30 字），所以两边都取前 20 字对。 */
  async function applyWateredState() {
    try {
      // 1. 加载 watered_notes（灌水记录）
      var wateredUrlSet = new Set();
      if (window.getWateredNoteUrls) {
        var wateredUrls = await window.getWateredNoteUrls();
        if (wateredUrls) wateredUrls.forEach(function(u) { wateredUrlSet.add(u); });
      }

      // 2. 加载 replied_comments（评论助手的回复记录），提取有回复的笔记 URL
      var repliedCountMap = {}; // noteUrl -> count
      try {
        var rmap = (typeof readPlain === 'function' ? await readPlain('replied_comments') : (await chrome.storage.local.get('replied_comments'))['replied_comments']) || {};
        Object.keys(rmap).forEach(function(noteUrl) {
          if (rmap[noteUrl] && rmap[noteUrl].length > 0) {
            wateredUrlSet.add(noteUrl);
            repliedCountMap[noteUrl] = rmap[noteUrl].length;
          }
        });
      } catch (e) {
        console.error('[笔记列表] 加载 replied_comments 出错:', e);
      }

      // 3. 队列执行记录：done[].notes[] → noteId（准）+ 标题前 20 字（老记录兜底）→ 最近一次 { at, s }
      var qDoneMap = {};
      try {
        var raw = await chrome.storage.local.get('drain_queue');
        (((raw || {})['drain_queue'] || {}).done || []).forEach(function(it) {
          var at = Number(it.at) || 0;
          (it.notes || []).forEach(function(n) {
            var t = String((n && n.t) || '').trim();
            var id = String((n && n.id) || '');
            var rec = { at: at, s: Number(n && n.s) || 0 };
            var keys = [];
            if (id) keys.push('id:' + id);
            if (t) keys.push('t:' + t.slice(0, 20));
            keys.forEach(function(k) {
              if (!qDoneMap[k] || at > qDoneMap[k].at) qDoneMap[k] = rec;
            });
          });
        });
      } catch (e) {
        console.error('[笔记列表] 读队列执行记录出错:', e);
      }

      if (wateredUrlSet.size === 0 && !Object.keys(qDoneMap).length) return;

      // 4. 应用到笔记列表
      var items = document.querySelectorAll('#noteList .note-item');
      items.forEach(function(li) {
        var link = li.querySelector('.note-title a');
        if (!link) return;
        var href = link.getAttribute('href') || '';

        // 已灌水（watered_notes / 有回复的 replied_comments）
        var isWatered = false;
        var replyCount = 0;
        wateredUrlSet.forEach(function(url) {
          if (href.indexOf(url) !== -1 || url.indexOf(href) !== -1) {
            isWatered = true;
            if (repliedCountMap[url]) replyCount = repliedCountMap[url];
          }
        });
        if (isWatered && !li.classList.contains('watered')) {
          li.classList.add('watered');
          var btn = li.querySelector('.btn-open-note');
          if (btn) {
            btn.textContent = '✅ 已灌水';
            btn.disabled = true;
            btn.className = 'btn btn-sm btn-gray btn-open-note';
            btn.dataset.watered = 'true';
            btn.title = replyCount > 0 ? ('该笔记已灌水（回复 ' + replyCount + ' 条）') : '该笔记已灌水';
          }
          var noteId = li.dataset.noteId;
          for (var i = 0; i < foundNotes.length; i++) {
            if (foundNotes[i].noteId === noteId) { foundNotes[i].watered = true; break; }
          }
        }

        // 队列跑过没（标在标题下；跟"已灌水"是两回事：队列评论不写 watered_notes）
        var qEl = li.querySelector('.note-q');
        if (!qEl) return;
        var nid = String(li.dataset.noteId || '');
        var rec = (nid && qDoneMap['id:' + nid]) || qDoneMap['t:' + String(link.textContent || '').trim().slice(0, 20)];
        if (!rec) { qEl.style.display = 'none'; qEl.dataset.qdone = 'false'; return; }
        qEl.textContent = '✅ 队列已跑过' + (rec.s ? ' · 发 ' + rec.s + ' 条' : '');
        qEl.title = '获客队列里这一篇已经执行完成：' + (awStamp(rec.at) || '时间不详') +
          (rec.s ? ' · 发了 ' + rec.s + ' 条评论' : '');
        qEl.style.display = '';
        qEl.dataset.qdone = 'true';
      });
    } catch (e) {
      console.error('[笔记列表] applyWateredState 出错:', e);
    }
  }

  /* ─── 轮询 ─── */
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(refreshStatus, 2000);
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  /* ─── 搜索动作清单（一个关键词 = N 搜：最新 / TOP各排序 / 本地 / 求助）─── */
  function passLabelOf(pass) {
    if (typeof window.drainPassLabel === 'function') return window.drainPassLabel(pass);
    return pass ? ((pass.scenario || '') + (pass.sort && pass.sort !== 'latest' ? '·' + pass.sort : '')) : '';
  }
  function renderSearchPlan(plan, planIdx, passStats) {
    var box = document.getElementById('searchPlan');
    if (!box) return;
    if (!plan || !plan.length) { box.innerHTML = ''; return; }
    box.innerHTML = plan.map(function (p, i) {
      var color, mark;
      if (i < planIdx) { color = '#0a8f4c'; mark = '✅ ' + (((passStats || [])[i]) || 0) + '篇'; }
      else if (i === planIdx) { color = '#d64052'; mark = '⏳ 搜中…'; }
      else { color = '#98a2b3'; mark = '⬜ 待搜'; }
      return '<span style="color:' + color + ';border:1px solid #eef0f3;border-radius:12px;padding:1px 8px;background:#fff;">' +
        esc(passLabelOf(p)) + ' ' + mark + '</span>';
    }).join('');
  }

  async function refreshStatus() {
    try {
      var s = await sendMsg('getAutoWaterStatus');
      var ss = s.searchState;

      // 搜索中
      if (ss && ss.searching) {
        showPanel('searching');
        var plan = ss.plan || [];
        var planTotal = ss.planTotal || plan.length || 1;
        var planIdx = Math.min(Number(ss.planIdx) || 0, planTotal);
        var passNow = plan[planIdx] || null;
        var pct = Math.round((planIdx / planTotal) * 100);
        document.getElementById('searchText').textContent = ss.acct
          ? ('正在盯: 👤 ' + (ss.currentKeyword || '') + '（进他主页扒最近的笔记）')
          : ('正在搜索: ' + (ss.currentKeyword || ''));
        document.getElementById('searchDetail').textContent =
          ((ss.kwIdx != null && ss.kwTotal != null) ? ('关键词 第 ' + (ss.kwIdx + 1) + '/' + ss.kwTotal + ' 个 · ') : '') +
          (ss.acct ? '本趟 ' : '本词 ') + (planIdx + 1) + '/' + planTotal + (ss.acct ? ' 个动作' : ' 搜') +
          (passNow ? '（' + passLabelOf(passNow) + '）' : '') +
          ' | 已找到 ' + ((ss.foundNotes || []).length) + ' 篇笔记';
        renderSearchPlan(plan, planIdx, ss.passStats || []);
        document.getElementById('searchBar').style.width = pct + '%';
        document.getElementById('searchBarLabel').textContent = planIdx + '/' + planTotal + ' (' + pct + '%)';
        // 搜索中显示「取消搜索」按钮（顶部默认隐藏）
        var csBtn = document.getElementById('btnCancelSearch');
        if (csBtn) csBtn.style.display = '';
        // ★ 超时兜底：一个词要按搜索动作清单搜好几遍，按搜次数/关键词数延长上限（首搜 180s，每多一搜 +30s，每多一个词 +60s）
        var kwN = ((ss.keywords) || []).length || ss.kwTotal || 1;
        var limitMs = 180000 + 30000 * (planTotal - 1) + 60000 * (kwN - 1);
        if (Date.now() - (ss.searchStartedAt || 0) > limitMs) {
          if (csBtn) csBtn.style.display = 'none';
          try {
            await chrome.runtime.sendMessage({ action: 'cancelSearch' });
            showError('⏱ 搜索超过 ' + Math.round(limitMs / 60000) + ' 分钟未完成，已自动取消（页面可能加载异常）。请重试');
          } catch (_) {}
        }
        return;
      }
      // 非搜索中：隐藏取消按钮
      var csBtn2 = document.getElementById('btnCancelSearch');
      if (csBtn2) csBtn2.style.display = 'none';

      // 搜索完成有结果
      if (s.searchResults && s.searchResults.length > 0) {
        foundNotes = s.searchResults;
        if (!resultsRendered) { renderResults(foundNotes); resultsRendered = true; }
        showPanel('results');
        // 显示返回列表按钮
        var backBtn = document.getElementById('btnBackToList');
        if (backBtn) backBtn.style.display = '';
        // 从持久化存储恢复已灌水状态
        await applyWateredState();
        // 应用筛选
        applyFilter();
        return;
      }

      // 搜索完成无结果
      if (s.searchResults && s.searchResults.length === 0) {
        showPanel('noResults');
        return;
      }

      // 错误状态
      if (s.error && !s.searchState?.searching) {
        showError(s.error);
        return;
      }
    } catch (e) {
      console.error('[AutoWater] 轮询失败:', e);
    }
  }

  /* ─── 绑定事件 ─── */
  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;
    $('#btnSearch')?.addEventListener('click', doSearch);
    $('#btnRetrySearch')?.addEventListener('click', doSearch);
    // ＋ 添加关键词
    $('#btnAddKw')?.addEventListener('click', addKwFromInput);
    // 🏷 话题 / ✨ 找词：跳到 📋 笔记列表 的词池候选区勾选入池
    $('#btnKwFromTopics')?.addEventListener('click', function () { openKwCandidates('topic'); });
    $('#btnKwFromAi')?.addEventListener('click', function () { openKwCandidates('ai'); });
    // 关键词输入框：回车 = 添加到列表（不直接搜索）
    $('#awKeywordPopup')?.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        addKwFromInput();
      }
    });
    $('#btnCancelSearch')?.addEventListener('click', async function() {
      try {
        await chrome.runtime.sendMessage({ action: 'cancelSearch' });
        this.style.display = 'none';
        showPanel('idle');
      } catch (e) {
        console.error('取消搜索失败:', e);
      }
    });
    $('#btnBackToList')?.addEventListener('click', goBack);
  }

  /* ─── 显示已灌水笔记清单 ─── */
  async function showWateredList() {
    try {
      // 1. 直接读取原始 storage（不经过 window.getWateredNoteUrls，避免静默异常）
      var raw = await chrome.storage.local.get(['watered_notes', 'opened_notes']);
      var wateredUrls = Array.isArray(raw['watered_notes']) ? raw['watered_notes'] : [];
      var repliedComments = (typeof readPlain === 'function' ? await readPlain('replied_comments') : {}) || {};
      var openedUrls = Array.isArray(raw['opened_notes']) ? raw['opened_notes'] : [];
      var repliedKeys = Object.keys(repliedComments).filter(function(k) {
        return repliedComments[k] && repliedComments[k].length > 0;
      });

      // 控制台打印原始数据，便于诊断
      console.log('[已灌水清单] watered_notes:', wateredUrls);
      console.log('[已灌水清单] replied_comments keys:', repliedKeys);
      console.log('[已灌水清单] opened_notes:', openedUrls);

      // 2. 合并所有已灌水URL（watered_notes + 有回复的 replied_comments）
      var allUrls = new Set(wateredUrls);
      repliedKeys.forEach(function(url) { allUrls.add(url); });
      var urlList = [...allUrls];

      // 3. 构建纯文本清单（供复制）
      var content = '=== 已灌水笔记清单 ===\n\n';
      content += '总计: ' + urlList.length + ' 篇\n';
      content += 'watered_notes: ' + wateredUrls.length + ' 篇\n';
      content += 'replied_comments: ' + repliedKeys.length + ' 篇\n';
      content += 'opened_notes: ' + openedUrls.length + ' 篇\n\n';
      content += '--- 详细列表 ---\n';
      urlList.forEach(function(url, i) {
        var replyCount = repliedComments[url] ? repliedComments[url].length : 0;
        var source = [];
        if (wateredUrls.includes(url)) source.push('watered_notes');
        if (replyCount > 0) source.push('replied_comments(' + replyCount + '条)');
        content += (i + 1) + '. [' + source.join(', ') + ']\n   ' + url + '\n\n';
      });

      // 4. 构建列表 HTML（空也显示，带诊断信息）
      var listHtml;
      if (urlList.length === 0) {
        listHtml = '<div style="padding:20px;text-align:center;color:#999;">' +
          '❗ 当前 storage 里没有已灌水记录<br><br>' +
          '<span style="font-size:10px;color:#bbb;">watered_notes: ' + wateredUrls.length + ' 条 | replied_comments: ' + repliedKeys.length + ' 条 | opened_notes: ' + openedUrls.length + ' 条</span><br>' +
          '<span style="font-size:10px;color:#bbb;">请先用评论助手发送一条回复，再回来查看</span>' +
          '</div>';
      } else {
        listHtml = urlList.map(function(url, i) {
          var replyCount = repliedComments[url] ? repliedComments[url].length : 0;
          var source = [];
          if (wateredUrls.includes(url)) source.push('<span style="color:#166534;background:#dcfce7;padding:1px 4px;border-radius:2px;">watered</span>');
          if (replyCount > 0) source.push('<span style="color:#1e40af;background:#eff6ff;padding:1px 4px;border-radius:2px;">' + replyCount + '条回复</span>');
          return '<div style="margin-bottom:8px;padding:6px;background:#f9f9f9;border-radius:4px;">' +
            '<div style="color:#333;font-weight:500;">' + (i + 1) + '. ' + source.join(' ') + '</div>' +
            '<div style="color:#666;word-break:break-all;font-size:10px;margin-top:2px;">' + url + '</div>' +
            '</div>';
        }).join('');
      }

      // 5. 显示模态框
      var modal = document.createElement('div');
      modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
      modal.innerHTML = '<div style="background:#fff;border-radius:8px;padding:20px;max-width:600px;max-height:80vh;overflow:auto;box-shadow:0 4px 20px rgba(0,0,0,0.3);">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">' +
        '<h3 style="margin:0;font-size:16px;">📋 已灌水笔记清单</h3>' +
        '<button id="closeWateredListModal" style="background:none;border:none;font-size:20px;cursor:pointer;">&times;</button>' +
        '</div>' +
        '<div style="font-size:12px;color:#666;margin-bottom:10px;">总计 ' + urlList.length + ' 篇 | watered_notes: ' + wateredUrls.length + ' | replied_comments: ' + repliedKeys.length + ' | opened_notes: ' + openedUrls.length + '</div>' +
        '<div style="font-size:11px;line-height:1.6;">' + listHtml + '</div>' +
        '<div style="margin-top:15px;text-align:right;">' +
        '<button id="copyWateredList" style="margin-right:8px;padding:4px 12px;font-size:11px;cursor:pointer;background:#f0f0f0;border:1px solid #ddd;border-radius:3px;">复制清单</button>' +
        '<button id="closeWateredListBtn" style="padding:4px 12px;font-size:11px;cursor:pointer;background:#3b82f6;color:#fff;border:none;border-radius:3px;">关闭</button>' +
        '</div>' +
        '</div>';
      document.body.appendChild(modal);

      // 绑定关闭事件
      document.getElementById('closeWateredListBtn').onclick = function() { modal.remove(); };
      document.getElementById('closeWateredListModal').onclick = function() { modal.remove(); };
      modal.onclick = function(e) { if (e.target === modal) modal.remove(); };

      // 绑定复制事件
      document.getElementById('copyWateredList').onclick = function() {
        navigator.clipboard.writeText(content).then(function() {
          alert('清单已复制到剪贴板');
        }).catch(function() {
          var textarea = document.createElement('textarea');
          textarea.value = content;
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
          alert('清单已复制到剪贴板');
        });
      };

    } catch (e) {
      console.error('[笔记列表] 显示已灌水清单出错:', e);
      alert('显示清单失败: ' + e.message);
    }
  }

 /* ─── 筛选已处理笔记（已取消"隐藏已处理"开关 → 始终显示全部） ─── */
  function applyFilter() {
    var items = document.querySelectorAll('#noteList .note-item');
    var countWatered = 0, countQueued = 0, countTodo = 0;
    items.forEach(function(li) {
      var btn = li.querySelector('.btn-open-note');
      var qEl = li.querySelector('.note-q');
      var isWatered = btn && btn.dataset.watered === 'true';
      var isQueued = qEl && qEl.dataset.qdone === 'true';
      if (isWatered) countWatered++;
      else if (isQueued) countQueued++;
      else countTodo++;
      li.style.display = '';
      li.style.opacity = '';
    });
    // 显示分类统计（三十一改：中段从「👀 已打开」换成「✅ 队列已跑过」）
    var statsEl = document.getElementById('filterStats');
    if (statsEl) {
      statsEl.textContent = '✅已灌水 ' + countWatered + ' | ✅队列已跑过 ' + countQueued + ' | 📝待处理 ' + countTodo;
    }
  }

  /* ─── 公共 API ─── */
  return {
    activate: function () {
      bindEvents();
      restoreKeyword();
      startPolling();
      refreshStatus();
    },
    deactivate: function () {
      stopPolling();
    },
    /* 强制重渲染笔记列表：逐屏推进（方案A）里 background 用 advanceResults 替换了 searchResults，
     * 这里复位渲染标记后再走一遍 refreshStatus，让 #noteList 跟随"当前可见快照"刷新。 */
    forceRerender: async function () {
      resultsRendered = false;
      try { await refreshStatus(); } catch (_) {}
    },
    /* 按 noteId 取当前搜索结果的原始对象（执行器统一打开时用它取带 rawLinkIndex 的实时定位信息） */
    getNoteById: function (noteId) {
      if (!noteId) return null;
      for (var i = 0; i < foundNotes.length; i++) {
        if (foundNotes[i] && foundNotes[i].noteId === noteId) return foundNotes[i];
      }
      return null;
    },
    /* 执行器运行中的手动/自动互斥锁（auto-bot.js 启停时调用） */
    setBotLock: setBotLock,
  };
})();
