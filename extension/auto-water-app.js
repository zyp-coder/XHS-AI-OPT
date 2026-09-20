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

    // 更新状态标签
    var statusEl = item.querySelector('.note-status');
    if (statusEl) {
      statusEl.textContent = '✅ 已灌水';
      statusEl.classList.add('watered');
    }

    // 更新按钮
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

  /* ─── 关键词列表：相当于本版本允许的最大关键词数（1=单关键词；8=多关键词） ─── */
  var __kwMax = 8;
  async function ensureKwMax() {
    try {
      var r = await sendMsg('getEdition');
      var ed = r && r.edition;
      var v = ed && Number(ed.keywordMax);
      if (v >= 1) __kwMax = v; else __kwMax = 8;
    } catch (_) { __kwMax = 8; }
    return __kwMax;
  }

  var _kwIdx = 0; // 当前要搜索的关键词下标（逐词推进）

  /* 保存关键词列表到 auto_water_config.keywords（去重、保序、首词记为上次词） */
  async function saveKwList(list) {
    var out = [], seen = {};
    (list || []).forEach(function (x) {
      x = String(x || '').trim();
      if (x && !seen[x]) { seen[x] = 1; out.push(x); }
    });
    try {
      var raw = await chrome.storage.local.get('auto_water_config');
      var cfg = raw['auto_water_config'] || {};
      cfg.keywords = out;
      await chrome.storage.local.set({ auto_water_config: cfg });
      if (out[0]) await chrome.storage.local.set({ _aw_last_keyword: out[0] });
    } catch (_) {}
    return out;
  }

  /* 从存储读列表并渲染标签；返回列表 */
  async function loadKwList() {
    var max = await ensureKwMax();
    var list = [];
    try {
      var raw = await chrome.storage.local.get('auto_water_config');
      var cfg = raw['auto_water_config'] || {};
      list = (cfg.keywords || []).slice();
      var ki = parseInt((cfg.schedule && cfg.schedule.kwIdx), 10);
      if (!isNaN(ki) && ki >= 0 && ki < list.length) _kwIdx = ki;
    } catch (_) {}
    renderKwList(list, max);
    return list;
  }

  /* 渲染关键词标签（点击=选定并只搜这个词；★号删除可移除） + 提示 */
  function renderKwList(list, max) {
    var bar = document.getElementById('kwBar');
    var tags = document.getElementById('kwTags');
    var hint = document.getElementById('kwHint');
    if (bar) bar.style.display = 'flex';
    if (tags) {
      tags.innerHTML = '';
      list.forEach(function (k, i) {
        var isCur = (i === _kwIdx);
        var base = 'display:inline-flex;align-items:center;gap:4px;border-radius:10px;padding:1px 8px;font-size:11px;max-width:220px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;cursor:pointer;';
        var c = document.createElement('span');
        c.style.cssText = base + (isCur
          ? 'background:#ff5c7a;color:#fff;border:1px solid #ff5c7a;'
          : 'background:#fff;color:#c02;border:1px solid #ffd0d8;');
        c.title = '点这个词 = 只搜它（逐词推进，不批量刷新）；灌完当前词，点下一个词继续';
        c.appendChild(document.createTextNode(k));
        var x = document.createElement('button');
        x.type = 'button';
        x.textContent = '×';
        x.title = '移除这个词';
        x.style.cssText = 'border:none;background:none;' + (isCur ? 'color:#fff;' : 'color:#c02;') + 'cursor:pointer;font-size:13px;line-height:14px;padding:0 1px;';
        x.onclick = (function (idx) {
          return async function (ev) {
            if (ev) ev.stopPropagation();
            var l = await loadKwList();
            l.splice(idx, 1);
            l = await saveKwList(l);
            if (_kwIdx >= l.length) _kwIdx = 0;
            renderKwList(l, max);
          };
        })(i);
        c.appendChild(x);
        c.onclick = (function (idx) {
          return function () { useKeyword(idx); };
        })(i);
        tags.appendChild(c);
      });
    }
    if (hint) {
      var lim = (max >= 8 ? 8 : max);
      var txt = (max === 1)
        ? '❗ 本版本为「单关键词版」，只能添加 1 个关键词。'
        : ('共 ' + list.length + ' 个关键词 · 当前搜第 ' + (_kwIdx + 1) + ' 个 · 灌完当前词，点下一个词继续（不批量刷新）');
      hint.textContent = txt;
    }
  }

  /* 选定某个关键词为“当前要搜的词”并立即搜索它（一次只搜这一个） */
  async function useKeyword(idx) {
    var list = await loadKwList();
    if (idx < 0 || idx >= list.length) idx = 0;
    _kwIdx = idx;
    try {
      var raw = await chrome.storage.local.get('auto_water_config');
      var cfg = raw['auto_water_config'] || {};
      cfg.schedule = cfg.schedule || {};
      cfg.schedule.kwIdx = idx;
      await chrome.storage.local.set({ auto_water_config: cfg });
    } catch (_) {}
    renderKwList(list, await ensureKwMax());
    try {
      var r = await sendMsg('searchNotes');
      if (!r.ok) showError(r.error || '搜索启动失败'); else showPanel('searching');
    } catch (e) { showError('搜索请求失败: ' + e.message); }
  }
  window._useKw = useKeyword;

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
        if (list.length >= max) { showError('最多只能添加 ' + max + ' 个关键词（当前版本上限）。'); break; }
        list.push(parts[i]);
      }
    }
    list = await saveKwList(list);
    if (input) input.value = '';
    renderKwList(list, max);
  }
  window._addKwKeyword = addKwFromInput;

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
      if (dirty) { list = await saveKwList(list); if (input) input.value = ''; renderKwList(list, max); }
    }
    if (list.length === 0) { showError('请先在左上方输入框添加一个搜索关键词（回车或点＋），再点搜索'); if (input) input.focus(); return; }
    foundNotes = [];
    resultsRendered = false;
    noteOpened = false;
    try {
      var resp = await sendMsg('searchNotes');
      if (!resp.ok) { showError(resp.error || '搜索启动失败'); return; }
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

  /* 渲染卡片统计：搜索结果页仅能可靠采集点赞数；收藏/评论在搜索页无法区分（抓到的多为误匹配），按用户要求不再展示。
     趋势打标（第几次刷到/点赞变化/上次时间）由标题旁的 trend-badge 与下方 trend-detail 呈现 */
  function renderNoteStats(stats, likes) {
    var likeVal = likes || (stats && stats.length ? stats[0] : '');
    return likeVal ? '👍 ' + esc(likeVal) : '';
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
    // ★ 点赞趋势：先把本次搜索到的笔记采样入库（串行队列），落库完成后立即刷新徽标/详情（保证显示本轮最新数据）
    if (window.NoteTrend) {
      try {
        window.NoteTrend.recordSamples(notes || []).then(function () {
          return window.NoteTrend.getTrends();
        }).then(function (t) {
          refreshTrendBadges(t);
        }).catch(function () {});
      } catch (_) {}
    }

    // ★ 按评论数降序展示（仅展示顺序；每篇定位索引 rawLinkIndex/searchIndex 是搜到时定死的，排序不影响定位）
    //   手动点开/自动灌水都按此顺序从上往下，评论多的笔记优先处理
    var sorted = (notes || []).slice().sort(function (a, b) {
      return getNoteCommentStat(b) - getNoteCommentStat(a);
    });
    document.getElementById('resultsCount').textContent = '共 ' + sorted.length + ' 篇笔记' + (sorted.length > 1 ? '（按评论数降序）' : '');
    var list = document.getElementById('noteList');
    list.innerHTML = '';
    for (var i = 0; i < sorted.length; i++) {
      var note = sorted[i];
      var li = document.createElement('li');
      li.className = 'note-item' + (note.watered ? ' watered' : '');
      li.dataset.noteId = note.noteId;
      li.innerHTML =
        '<div class="note-top">' +
          '<div class="note-body">' +
            '<div class="note-title"><a href="' + esc(note.url) + '" target="_blank">' + esc(note.title) + '</a>' +
              '<span class="trend-badge" data-note-id="' + esc(note.noteId) + '" style="display:none;"></span>' +
            '</div>' +
            '<div class="note-meta">' +
              '<span>@' + esc(note.author || '未知') + '</span>' +
              ((note.stats && note.stats.length) || note.likes ? '<span>' + renderNoteStats(note.stats, note.likes) + '</span>' : '') +
            '</div>' +
            '<div class="trend-detail" data-note-id="' + esc(note.noteId) + '" style="font-size:10px;line-height:15px;margin-top:3px;word-break:break-all;"></div>' +
          '</div>' +
        '</div>' +
        '<div class="note-actions">' +
          '<span class="note-status' + (note.watered ? ' watered' : '') + '">' + (note.watered ? '✅ 已灌水' : '') + '</span>' +
          '<button class="btn btn-sm ' + (note.watered ? 'btn-gray' : 'btn-primary') + ' btn-open-note"' +
            (note.watered ? ' disabled' : '') +
            ' data-watered="' + (note.watered ? 'true' : 'false') + '"' +
            ' title="' + (note.watered ? '该笔记已灌水' : '打开笔记并在右侧加载评论') + '">' +
            (note.watered ? '✅ 已灌水' : '🔗 打开') +
          '</button>' +
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
      list.appendChild(li);
    }
    // ★ 执行器运行中重渲染（逐屏推进会整列重建）：新按钮默认可用，这里补回锁
    if (botLocked) disableOpenButtons();
  }

  /* 点赞趋势徽标 + 采样详情：每篇渲染打标徽标，并显示 ①第几次刷到 ②对比上次点赞变化 ③上次刷到时间 ④新刷到标记
     ★「灌水:选中」不再本地复刻判定：追涨口径一律取 NoteTrend.explainPick（与引擎挑篇同源）；
       全部口径（看到就灌）读列表自身的已灌/已打开状态——与执行器读的是同一处 dataset */
  function refreshTrendBadges(trendsArg) {
    if (!window.NoteTrend) return;
    var p = trendsArg ? Promise.resolve(trendsArg) : window.NoteTrend.getTrends();
    p.then(async function (trends) {
      // ① 打标徽标（hot🔥/growing📈/flat⚪/down📉/new🆕）
      document.querySelectorAll('#noteList .trend-badge').forEach(function (el) {
        var t = trends && trends[el.dataset.noteId];
        var tag = (t && t.tag) || 'new';
        var meta = window.NoteTrend.TAG_META[tag] || window.NoteTrend.TAG_META.new;
        el.style.cssText = 'display:inline-block;font-size:10px;color:' + meta.color + ';border:1px solid ' + meta.color + ';border-radius:8px;padding:0 5px;margin-left:4px;line-height:14px;opacity:.85;vertical-align:1px;';
        el.textContent = meta.label;
        el.title = '点赞趋势：' + meta.desc + (t && t.samples && t.samples.length > 1 ? '（最近两次采样：' + t.samples[t.samples.length - 2].likes + ' → ' + t.samples[t.samples.length - 1].likes + '）' : '');
      });

      // 加载度控制配置，用于判定"是否会被灌水"
      var cfg = window.NoteTrend.DEFAULT_CONFIG;
      try { cfg = await window.NoteTrend.getConfig(); } catch (_) {}
      var now = Date.now();
      // 当前口径：列表头 #botScopeSel —— 全部未灌过=看到就灌；只追涨势=只挑涨势
      var scopeSel = document.getElementById('botScopeSel');
      var allMode = scopeSel ? scopeSel.value !== 'growing' : true;
      var allowedIds = {};
      document.querySelectorAll('#noteList .note-item').forEach(function (li) {
        if (li.dataset.noteId) allowedIds[li.dataset.noteId] = true;
      });

      // ② 详情行：被采集次数 / 上次采集点赞数 / 本次点赞数 / 是否会被灌水
      document.querySelectorAll('#noteList .trend-detail').forEach(function (el) {
        var t = trends && trends[el.dataset.noteId];
        if (!t || !t.samples || t.samples.length === 0) { el.textContent = ''; return; }
        var samples = t.samples;
        var cur = samples[samples.length - 1];
        var prev = samples.length >= 2 ? samples[samples.length - 2] : null;
        var prevLikes = prev ? (prev.likes || 0) : '—';

        var pickHtml;
        if (allMode) {
          var li = el.closest('.note-item');
          var ob = li ? li.querySelector('.btn-open-note') : null;
          var watered = !!(ob && ob.dataset.watered === 'true');
          var opened = !!(ob && ob.dataset.opened === 'true');
          pickHtml = (!watered && !opened)
            ? '<span style="color:#b45309;font-weight:600;"> · 灌水:✅待灌</span>'
            : '<span style="color:#bbb;"> · 灌水:✖' + (watered ? '（已灌过）' : '（已打开）') + '</span>';
        } else {
          var r = window.NoteTrend.explainPick(el.dataset.noteId, t, cfg, now, allowedIds);
          pickHtml = r.picked
            ? '<span style="color:#b45309;font-weight:600;"> · 灌水:✅选中</span>'
            : '<span style="color:#bbb;"> · 灌水:✖未选中（' + (r.reason || '') + '）</span>';
        }

        el.innerHTML =
          '<span style="color:#555;">采集 ' + samples.length + ' 次</span>' +
          '<span style="color:#888;"> · 上次点赞 ' + esc(prevLikes) + '</span>' +
          '<span style="color:#333;"> · 本次点赞 ' + esc(cur.likes || 0) + '</span>' +
          pickHtml;
      });
    }).catch(function () {});
  }
  /* 相对时间：距上次刷到（xx分钟前 / xx小时前 / x天前） */
  function fmtAgo(ms) {
    if (ms < 60000) return '刚刚';
    var m = Math.floor(ms / 60000);
    if (m < 60) return m + ' 分钟前';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    return Math.floor(h / 24) + ' 天前';
  }
  window._refreshTrendBadges = refreshTrendBadges;

  /* ─── 从持久化存储加载已灌水/已打开状态并应用到列表 ─── */
  async function applyWateredState() {
    console.log('[笔记列表] applyWateredState 开始执行...');
    try {
      // 1. 加载 watered_notes（灌水记录）
      var wateredUrlSet = new Set();
      if (window.getWateredNoteUrls) {
        var wateredUrls = await window.getWateredNoteUrls();
        if (wateredUrls) wateredUrls.forEach(function(u) { wateredUrlSet.add(u); });
      }
      console.log('[笔记列表] 已灌水 URL 数量:', wateredUrlSet.size, [...wateredUrlSet]);

      // 2. 加载 replied_comments（评论助手的回复记录），提取有回复的笔记 URL
      var repliedCountMap = {}; // noteUrl -> count
      try {
        var rmap = (typeof readPlain === 'function' ? await readPlain('replied_comments') : (await chrome.storage.local.get('replied_comments'))['replied_comments']) || {};
        console.log('[笔记列表] replied_comments 原始数据:', rmap);
        Object.keys(rmap).forEach(function(noteUrl) {
          if (rmap[noteUrl] && rmap[noteUrl].length > 0) {
            wateredUrlSet.add(noteUrl);
            repliedCountMap[noteUrl] = rmap[noteUrl].length;
          }
        });
        console.log('[笔记列表] replied_comments 提取的 URL:', Object.keys(rmap));
      } catch (e) {
        console.error('[笔记列表] 加载 replied_comments 出错:', e);
      }
      console.log('[笔记列表] 合并后已灌水 URL 数量:', wateredUrlSet.size, [...wateredUrlSet]);

      // 3. 加载 opened_notes（已打开记录）
      var openedUrlSet = new Set();
      if (window.getOpenedNoteUrls) {
        var openedUrls = await window.getOpenedNoteUrls();
        if (openedUrls) openedUrls.forEach(function(u) { openedUrlSet.add(u); });
      }
      console.log('[笔记列表] 已打开 URL 数量:', openedUrlSet.size, [...openedUrlSet]);

      if (wateredUrlSet.size === 0 && openedUrlSet.size === 0) {
        console.log('[笔记列表] 没有已灌水或已打开的笔记');
        return;
      }

      // 4. 应用到笔记列表
      var items = document.querySelectorAll('#noteList .note-item');
      console.log('[笔记列表] 共', items.length, '条笔记，开始匹配状态...');
      items.forEach(function(li) {
        var link = li.querySelector('.note-title a');
        if (!link) return;
        var href = link.getAttribute('href') || '';
        
        // 检查是否已灌水
        var isWatered = false;
        var replyCount = 0;
        wateredUrlSet.forEach(function(url) {
          if (href.indexOf(url) !== -1 || url.indexOf(href) !== -1) {
            isWatered = true;
            if (repliedCountMap[url]) replyCount = repliedCountMap[url];
          }
        });
        
        // 检查是否已打开
        var isOpened = false;
        openedUrlSet.forEach(function(url) {
          if (href.indexOf(url) !== -1 || url.indexOf(href) !== -1) {
            isOpened = true;
          }
        });
        
        console.log('[笔记列表] 笔记:', href.slice(0, 50), '已灌水:', isWatered, '已打开:', isOpened);
        
        // 应用已灌水状态
        if (isWatered && !li.classList.contains('watered')) {
          li.classList.add('watered');
          var statusEl = li.querySelector('.note-status');
          if (statusEl) {
            var label = '✅ 已灌水';
            if (replyCount > 0) label += ' (' + replyCount + '条)';
            statusEl.textContent = label;
            statusEl.classList.add('watered');
          }
          var btn = li.querySelector('.btn-open-note');
          if (btn) {
            btn.textContent = '✅ 已灌水';
            btn.disabled = true;
            btn.className = 'btn btn-sm btn-gray btn-open-note';
            btn.dataset.watered = 'true';
            btn.title = '该笔记已灌水';
          }
          // 更新 foundNotes 数据
          var noteId = li.dataset.noteId;
          for (var i = 0; i < foundNotes.length; i++) {
            if (foundNotes[i].noteId === noteId) { foundNotes[i].watered = true; break; }
          }
        }
        // 应用已打开状态（未灌水但已打开）
        else if (isOpened && !isWatered && !li.classList.contains('opened')) {
          li.classList.add('opened');
          var statusEl = li.querySelector('.note-status');
          if (statusEl) {
            statusEl.textContent = '👀 已打开(未灌水)';
            statusEl.classList.add('opened');
          }
          var btn = li.querySelector('.btn-open-note');
          if (btn) {
            btn.textContent = '👀 已打开';
            btn.disabled = true;
            btn.className = 'btn btn-sm btn-gray btn-open-note';
            btn.dataset.opened = 'true';
            btn.title = '该笔记已打开过（未成功灌水）';
          }
          // 更新 foundNotes 数据
          var noteId = li.dataset.noteId;
          for (var i = 0; i < foundNotes.length; i++) {
            if (foundNotes[i].noteId === noteId) { foundNotes[i].opened = true; break; }
          }
        }
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

  async function refreshStatus() {
    try {
      var s = await sendMsg('getAutoWaterStatus');
      var ss = s.searchState;

      // 搜索中
      if (ss && ss.searching) {
        showPanel('searching');
        var total = ss.totalKeywords || 1;
        var done = ss.completedKeywords || 0;
        var pct = Math.round((done / total) * 100);
        document.getElementById('searchText').textContent = '正在搜索: ' + (ss.currentKeyword || '');
        document.getElementById('searchDetail').textContent = '关键词 ' + (ss.kwIdx != null && ss.kwTotal != null ? ('第 ' + (ss.kwIdx + 1) + '/' + ss.kwTotal + ' 个') : ((done + 1) + '/' + total)) + ' | 已找到 ' + ((ss.foundNotes || []).length) + ' 篇笔记';
        document.getElementById('searchBar').style.width = pct + '%';
        document.getElementById('searchBarLabel').textContent = done + '/' + total + ' (' + pct + '%)';
        // 搜索中显示「取消搜索」按钮（顶部默认隐藏）
        var csBtn = document.getElementById('btnCancelSearch');
        if (csBtn) csBtn.style.display = '';
        // ★ 超时兜底：多关键词会逐个搜索，按关键词数量延长上限（首词 180s，之后每词 +60s），避免多关键词时被误取消
        var kwN = ((ss.searchState && ss.searchState.keywords) || []).length || 1;
        if (Date.now() - (ss.searchStartedAt || 0) > 180000 + 60000 * (kwN - 1)) {
          if (csBtn) csBtn.style.display = 'none';
          try {
            await chrome.runtime.sendMessage({ action: 'cancelSearch' });
            showError('⏱ 搜索超过 3 分钟未完成，已自动取消（页面可能加载异常）。请重试');
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
    var hideDone = false;
    var items = document.querySelectorAll('#noteList .note-item');
    var countWatered = 0, countOpened = 0, countTodo = 0;
    items.forEach(function(li) {
      var btn = li.querySelector('.btn-open-note');
      var isWatered = btn && btn.dataset.watered === 'true';
      var isOpened = btn && (btn.dataset.opened === 'true' || btn.textContent.indexOf('👀') !== -1);
      if (isWatered) countWatered++;
      else if (isOpened) countOpened++;
      else countTodo++;
      li.style.display = '';
      li.style.opacity = '';
    });
    // 显示分类统计
    var statsEl = document.getElementById('filterStats');
    if (statsEl) {
      statsEl.textContent = '✅已灌水 ' + countWatered + ' | 👀已打开 ' + countOpened + ' | 📝待处理 ' + countTodo;
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
