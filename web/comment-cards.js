/* 🧩 评论场景表页面（2026-11-11）
   看 / 改 / 加卡，拿真评论重放，收 AI 起草的卡，看决策日志。
   数据层在 lib/comment-cards.js；生成在服务器后台，这里只发动作、不发评论。 */
(function () {
  'use strict';

  var $ = function (s, root) { return (root || document).querySelector(s); };
  var $$ = function (s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); };
  var Esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var ANGLES = (window.DrainCards && DrainCards.ANGLES) || ['共情接住', '案例带人', '方法拆解', '数据实证', '专业判断', '避坑提醒', '对比取舍', '随口搭话'];
  var NT = (window.DrainCards && DrainCards.NOTE_TYPES) || [];
  var NT_NAME = {};
  NT.forEach(function (t) { NT_NAME[t.id] = t.name; });

  var state = { cards: [], q: '', draft: null, tab: 'cards', folded: {} };
  var toastT = null;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.classList.remove('show'); }, 2400);
  }
  function sendBg(action, data) {
    return new Promise(function (resolve) {
      try {
        var done = false;
        var ret = chrome.runtime.sendMessage({ action: action, data: data || {} }, function (r) {
          if (done) return;
          done = true;
          resolve(r || { ok: false, error: '服务器没回话' });
        });
        if (ret && typeof ret.then === 'function' && !done) {
          ret.then(function (r) { if (!done) { done = true; resolve(r || {}); } })
            .catch(function (e) { if (!done) { done = true; resolve({ ok: false, error: e.message }); } });
        }
      } catch (e) { resolve({ ok: false, error: e.message }); }
    });
  }
  function angleChip(a) {
    if (!a) return '';
    return '<span class="chip angle angle-' + Esc(a) + '">' + Esc(a) + '</span>';
  }
  function cardById(id) {
    return state.cards.filter(function (c) { return c.id === id; })[0] || null;
  }
  function branchLabel(card, n) {
    var b = card && card.branches && card.branches[Number(n) - 1];
    return b ? ('情况' + Number(n) + ' · ' + (b.cond || '')) : '';
  }
  function fmtTime(ts) {
    var n = Number(ts || 0);
    if (!n) return '';
    var d = new Date(n);
    var p = function (x) { return x < 10 ? '0' + x : '' + x; };
    return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ── 读表 ── */
  async function load() {
    try {
      state.cards = await DrainCards.getCards();
    } catch (e) {
      toast('读场景表失败：' + e.message);
      state.cards = [];
    }
    await refreshStats();
    renderList();
  }
  async function refreshStats() {
    var n = { cards: state.cards.length, branches: 0, says: 0 };
    state.cards.forEach(function (c) {
      n.branches += (c.branches || []).length;
      (c.branches || []).forEach(function (b) { n.says += (b.say || []).length; });
    });
    $('#statPill').textContent = n.cards + ' 张场景卡 · ' + n.branches + ' 种情况 · ' + n.says + ' 句现成说法';
    $('#cnt').textContent = '共 ' + n.cards + ' 张';
  }

  /* ── 场景卡列表：一张卡一块，内容直接摊在列表里（2026-11-11 老板定）── */
  function matchCard(c, q) {
    if (!q) return true;
    var hay = [c.name, c.when, c.mat, c.forbid, (c.src || []).join(' ')].join(' ');
    (c.ex || []).forEach(function (x) { hay += ' ' + x; });
    (c.branches || []).forEach(function (b) {
      hay += ' ' + (b.who || '') + ' ' + b.cond + ' ' + b.goal;
      (b.say || []).forEach(function (s) { hay += ' ' + s.angle + ' ' + s.text; });
    });
    return hay.toLowerCase().indexOf(q.toLowerCase()) >= 0;
  }
  function whoChip(who) {
    return (who && who !== '不限')
      ? '<span class="chip who">对方：' + Esc(who) + '</span>'
      : '';
  }
  function cardHtml(c, idx) {
    var folded = !!state.folded[c.id];
    var branches = (c.branches || []).length;
    var says = 0;
    (c.branches || []).forEach(function (b) { says += (b.say || []).length; });
    var tchip = (c.types || []).map(function (id) {
      return '<span class="chip">' + Esc(NT_NAME[id] || id) + '</span>';
    }).join('');
    var head = '<div class="scard-h">'
      + '<span class="sno">' + (idx + 1 < 10 ? '0' : '') + (idx + 1) + '</span>'
      + '<div class="srow-main"><div class="srow-t">' + Esc(c.name) + '</div>'
      + '<div class="srow-w">' + (tchip ? tchip + ' ' : '') + '什么时候用：' + Esc(c.when || '（还没写）') + '</div></div>'
      + '<span class="srow-n">' + branches + ' 种情况 · ' + says + ' 句</span>'
      + '<button class="btn sm" type="button" data-edit>编辑</button>'
      + '<button class="btn sm" type="button" data-copy>复制</button>'
      + '<button class="btn sm" type="button" data-del style="color:#a52a2a;border-color:#f2c7c7;">删</button>'
      + '<button class="btn sm" type="button" data-fold>' + (folded ? '展开 ▾' : '收起 ▴') + '</button>'
      + '</div>';
    if (folded) return '<div class="scard" data-id="' + Esc(c.id) + '">' + head + '</div>';
    var exs = (c.ex || []).length
      ? '<div class="sline"><b>真实评论例子</b>' + c.ex.map(function (x) { return '<span class="chip">' + Esc(x) + '</span>'; }).join('') + '</div>'
      : '';
    var brs = (c.branches || []).map(function (b, i) {
      var say = (b.say || []).map(function (s, j) {
        return '<div class="sone"><span class="sn">' + (j + 1) + '</span><span>' + Esc(s.text) + '</span>' + angleChip(s.angle) + '</div>';
      }).join('');
      return '<div class="sbr">'
        + '<div class="sbr-h"><b>情况 ' + (i + 1) + '</b>' + whoChip(b.who)
        + '<span class="cond">' + Esc(b.cond || '（没写条件）') + '</span>'
        + (b.goal ? '<span class="goal">→ ' + Esc(b.goal) + '</span>' : '') + '</div>'
        + '<div class="ssay">' + (say || '<div class="muted">还没写现成说法</div>') + '</div>'
        + '</div>';
    }).join('');
    var tail = (c.mat || c.forbid || (c.src || []).length)
      ? '<div class="sline">'
        + '<b>必须用</b>' + Esc(c.mat || '（不需要 / 还没填）')
        + '<b>不能说</b>' + Esc(c.forbid || '（还没写）')
        + ((c.src || []).length ? c.src.map(function (x) { return '<span class="chip">' + Esc(x) + '</span>'; }).join('') : '')
        + '</div>'
      : '';
    return '<div class="scard" data-id="' + Esc(c.id) + '">'
      + head + '<div class="scard-b">' + exs + (brs || '<div class="muted">还没分情况</div>') + tail + '</div></div>';
  }
  function renderList() {
    var q = state.q.trim();
    var list = state.cards.filter(function (c) { return matchCard(c, q); });
    var el = $('#cardList');
    if (!list.length) {
      el.innerHTML = '<div class="empty">' + (q ? '没搜到匹配的场景' : '表里还没有卡') + '</div>';
      $('#cnt').textContent = q ? ('搜到 0 张 / 共 ' + state.cards.length + ' 张') : '共 0 张';
      return;
    }
    el.innerHTML = list.map(cardHtml).join('');
    $('#cnt').textContent = q ? ('搜到 ' + list.length + ' 张 / 共 ' + state.cards.length + ' 张') : ('共 ' + state.cards.length + ' 张');
    $$('.scard', el).forEach(function (box) {
      var id = box.getAttribute('data-id');
      var c = cardById(id);
      if (!c) return;
      var foldBtn = $('[data-fold]', box);
      if (foldBtn) foldBtn.onclick = function () {
        if (state.folded[id]) delete state.folded[id]; else state.folded[id] = 1;
        renderList();
      };
      var editBtn = $('[data-edit]', box);
      if (editBtn) editBtn.onclick = function () { openEditor(c); };
      var copyBtn = $('[data-copy]', box);
      if (copyBtn) copyBtn.onclick = function () {
        var copy = JSON.parse(JSON.stringify(c));
        copy.id = uniqueId(c.id);
        copy.name = c.name + '（副本）';
        DrainCards.saveCards(state.cards.concat([copy])).then(function (saved) {
          state.cards = saved; refreshStats(); renderList();
          toast('已复制一张，改完记得点「编辑」保存');
        });
      };
      var delBtn = $('[data-del]', box);
      if (delBtn) delBtn.onclick = async function () {
        if (!confirm('删掉「' + c.name + '」？删了就少一张卡，可以点「恢复默认」找回来。')) return;
        var next = state.cards.filter(function (x) { return x.id !== c.id; });
        state.cards = await DrainCards.saveCards(next);
        refreshStats(); renderList();
        toast('已删掉一张');
      };
    });
  }

  function uniqueId(base) {
    var id = String(base || 'card').replace(/[^a-zA-Z0-9_\-]/g, '') || 'card';
    if (!cardById(id)) return id;
    var i = 2;
    while (cardById(id + '_' + i)) i++;
    return id + '_' + i;
  }

  /* ── 编辑弹窗 ── */
  var editingId = '';
  function sayRowHtml(angle, text) {
    return '<div class="sayrow">'
      + '<select data-s="angle">' + ANGLES.map(function (a) {
        return '<option value="' + Esc(a) + '"' + (a === angle ? ' selected' : '') + '>' + Esc(a) + '</option>';
      }).join('') + '</select>'
      + '<input data-s="text" value="' + Esc(text || '') + '" placeholder="现成说法；AI 会参考改写，不照抄">'
      + '<button class="btn xs" type="button" data-del-say>✕</button>'
      + '</div>';
  }
  function branchHtml(b) {
    b = b || {};
    var whos = (window.DrainCards && DrainCards.WHO_OPTS) || ['不限', '家长本人', '同行', '老师', '路人'];
    var who = whos.indexOf(b.who) >= 0 ? b.who : '不限';
    return '<div class="br">'
      + '<div class="brh"><b>情况</b><div class="sp"></div><button class="btn xs" type="button" data-del-branch>删这种情况</button></div>'
      + '<div class="whorow"><label class="fld"><span>对方是谁</span>'
      + '<select data-b="who">' + whos.map(function (w) {
        return '<option value="' + Esc(w) + '"' + (w === who ? ' selected' : '') + '>' + Esc(w) + '</option>';
      }).join('') + '</select></label>'
      + '<span class="tip">先认人：家长本人 / 同行 / 老师 / 路人；拿不准就「不限」，不提身份。</span></div>'
      + '<label class="fld"><span>什么条件</span><input data-b="cond" value="' + Esc(b.cond || '') + '" placeholder="例：只是抱怨一句，没问具体问题"></label>'
      + '<label class="fld"><span>怎么回</span><input data-b="goal" value="' + Esc(b.goal || '') + '" placeholder="例：先接住，再问几岁"></label>'
      + '<div class="says">' + ((b.say || []).map(function (s) { return sayRowHtml(s.angle, s.text); }).join('') || sayRowHtml('共情接住', '')) + '</div>'
      + '<button class="btn xs" type="button" data-add-say>＋ 加一句</button>'
      + '</div>';
  }
  function renumberBranches() {
    $$('#edBranches .br').forEach(function (el, i) {
      var b = $('.brh b', el);
      if (b) b.textContent = '情况' + (i + 1);
    });
  }
  function openEditor(card) {
    editingId = card ? card.id : '';
    $('#editTitle').textContent = card ? '改这张卡' : '新建场景卡';
    $('#edName').value = card ? card.name : '';
    var cur = (card && Array.isArray(card.types)) ? card.types : [];
    $('#edTypes').innerHTML = NT.map(function (t) {
      var on = cur.indexOf(t.id) >= 0;
      return '<label style="display:inline-flex;align-items:center;gap:4px;margin:0 14px 6px 0;font-size:13px;color:#333;">'
        + '<input type="checkbox" data-nt="' + Esc(t.id) + '"' + (on ? ' checked' : '') + '>' + Esc(t.name) + '</label>';
    }).join('') || '<span class="muted">场景表组件没加载</span>';
    $('#edWhen').value = card ? (card.when || '') : '';
    $('#edEx').value = card ? (card.ex || []).join('\n') : '';
    $('#edMat').value = card ? (card.mat || '') : '';
    $('#edForbid').value = card ? (card.forbid || '') : '';
    $('#edSrc').value = card ? (card.src || []).join(', ') : '';
    $('#edBranches').innerHTML = ((card && card.branches && card.branches.length) ? card.branches : [{}]).map(branchHtml).join('');
    renumberBranches();
    $('#editMask').hidden = false;
    setTimeout(function () { $('#edName').focus(); }, 30);
  }
  function collectEditor() {
    var branches = $$('#edBranches .br').map(function (el) {
      var b = {
        who: ($('[data-b="who"]', el) || {}).value || '不限',
        cond: ($('[data-b="cond"]', el) || {}).value || '',
        goal: ($('[data-b="goal"]', el) || {}).value || '',
        say: $$('.sayrow', el).map(function (row) {
          return {
            angle: ($('[data-s="angle"]', row) || {}).value || '',
            text: ($('[data-s="text"]', row) || {}).value || '',
          };
        }).filter(function (s) { return s.text.trim(); }),
      };
      return b;
    }).filter(function (b) { return b.cond.trim() || b.say.length; });
    return {
      id: editingId || uniqueId('c'),
      name: $('#edName').value.trim(),
      types: $$('#edTypes input[data-nt]').filter(function (el) { return el.checked; })
        .map(function (el) { return el.getAttribute('data-nt'); }),
      when: $('#edWhen').value.trim(),
      ex: $('#edEx').value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean),
      branches: branches,
      mat: $('#edMat').value.trim(),
      forbid: $('#edForbid').value.trim(),
      src: $('#edSrc').value.split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean),
    };
  }
  async function saveEditor() {
    var card = collectEditor();
    if (!card.name) { toast('先写场景名'); $('#edName').focus(); return; }
    if (!card.branches.length) { toast('至少写一种情况'); return; }
    var next = state.cards.slice();
    var i = next.findIndex(function (x) { return x.id === card.id; });
    if (i >= 0) next[i] = card; else next.push(card);
    state.cards = await DrainCards.saveCards(next);
    $('#editMask').hidden = true;
    refreshStats(); renderList();
    toast(i >= 0 ? '已存进表' : '已新建一张');
  }

  /* ── 重放 ── */
  async function runReplay() {
    var comments = $('#rpComments').value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
    if (!comments.length) { toast('先贴几条真实评论，一行一条'); return; }
    var btn = $('#btnReplay');
    btn.disabled = true;
    $('#rpState').textContent = 'AI 在认场景、写候选…（' + comments.length + ' 条，约 20～60 秒）';
    var r = await sendBg('commentCardsReplay', { post: $('#rpPost').value.trim(), comments: comments });
    btn.disabled = false;
    if (!r || r.ok === false) {
      $('#rpState').textContent = '没跑成：' + ((r && r.error) || '服务器没回话');
      return;
    }
    $('#rpState').textContent = '跑完了 · 最近 7 天账本 ' + (r.recentCount || 0) + ' 条 · 用时 ' + Math.round((r.ms || 0) / 1000) + ' 秒';
    renderReplay(r.rows || []);
  }
  function statusPill(row) {
    if (row.status === 'ok') return '<span class="st ok">会发</span>';
    if (row.status === 'blocked') return '<span class="st blocked">全被拦</span>';
    if (row.status === 'skip') return '<span class="st skip">跳过</span>';
    if (row.status === 'unmatched') return '<span class="st unmatched">未收录</span>';
    if (row.status === 'missing') return '<span class="st missing">AI 没给</span>';
    return '';
  }
  function renderReplay(rows) {
    var box = $('#rpResult');
    box.hidden = false;
    if (!rows.length) { box.innerHTML = '<div class="empty">这次没跑出结果</div>'; return; }
    box.innerHTML = '<h3 style="margin:0 0 4px;font-size:var(--fs-lg)">跑完的结果</h3>'
      + '<p class="cap" style="margin:0 0 10px;color:var(--c-ink-2);font-size:var(--fs-sm)">绿色＝程序抽中这句；划掉的是被 7 天账本 / 角度名额 / 红线拦下的候选。</p>'
      + '<table class="rtable"><thead><tr><th style="width:24%">评论</th><th style="width:20%">认到的场景 / 情况</th><th>候选与抽中</th><th style="width:13%">结果</th></tr></thead><tbody>'
      + rows.map(function (row) {
        var blockedMap = {};
        (row.blocked || []).forEach(function (b) { blockedMap[b.text] = b.why; });
        var cands = (row.candidates || []).map(function (c) {
          var why = blockedMap[c.text];
          var isPick = c.text === row.picked;
          return '<div class="cand' + (isPick ? ' pick' : '') + '">' + angleChip(c.angle)
            + '<span class="' + (why && !isPick ? 'strike' : '') + '">' + Esc(c.text) + '</span>'
            + (why ? '<span class="why">' + Esc(why) + '</span>' : '')
            + (isPick ? ' <b style="color:var(--c-ok)">← 这句</b>' : '')
            + '</div>';
        }).join('');
        var sceneTxt = row.scene === 'skip' ? '<span class="chip">不回（同行/广告/悲伤）</span>'
          : row.scene === 'none' ? '<span class="chip" style="background:#fdf3e2;color:#8a5a00;border-color:#f0d8a8;">未收录 · 安全兜底</span>'
            : (row.sceneName ? '<span class="chip">' + Esc(row.sceneName) + '</span>' : '');
        var branchTxt = row.branchLabel ? '<div class="muted" style="margin-top:3px;">' + Esc(row.branchLabel) + '</div>' : '';
        return '<tr><td>' + Esc(row.peer) + '</td><td>' + sceneTxt + branchTxt + '</td>'
          + '<td><div class="candlist">' + (cands || '<span class="muted">没有候选</span>') + '</div>'
          + (row.reason ? '<div class="muted" style="margin-top:4px;">' + Esc(row.reason) + '</div>' : '') + '</td>'
          + '<td>' + statusPill(row) + (row.angle ? '<div class="muted" style="margin-top:3px;">' + Esc(row.angle) + '</div>' : '') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  /* ── AI 起草 ── */
  function openDraft() {
    state.draft = null;
    $('#drIdea').value = '';
    $('#drComments').value = '';
    $('#drState').textContent = '';
    $('#drPreview').innerHTML = '';
    $('#drAccept').disabled = true;
    $('#draftMask').hidden = false;
  }
  async function runDraft() {
    var idea = $('#drIdea').value.trim();
    var comments = $('#drComments').value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
    if (!idea && !comments.length) { toast('先写一句想补什么场景，或贴几条真评论'); return; }
    var btn = $('#drGo');
    btn.disabled = true;
    $('#drState').textContent = 'AI 在起草…（约 20～40 秒）';
    var r = await sendBg('commentCardsDraft', { idea: idea, comments: comments });
    btn.disabled = false;
    if (!r || r.ok === false) { $('#drState').textContent = '没起草出来：' + ((r && r.error) || '服务器没回话'); return; }
    state.draft = r.card;
    $('#drState').textContent = '起草好了；点「收下」才进表。';
    $('#drAccept').disabled = false;
    var c = r.card;
    $('#drPreview').innerHTML = '<div class="draftcard"><h3 style="margin:0 0 6px;">' + Esc(c.name) + '</h3>'
      + '<div class="muted" style="margin-bottom:8px;">' + Esc(c.when) + '</div>'
      + (c.ex || []).map(function (x) { return '<span class="chip">' + Esc(x) + '</span> '; }).join('')
      + (c.branches || []).map(function (b, i) {
        return '<div class="brblock" style="margin-top:9px;background:#fff;"><div class="cond">情况' + (i + 1) + ' · ' + Esc(b.cond) + '</div>'
          + '<div class="goal">' + Esc(b.goal) + '</div>'
          + (b.say || []).map(function (s) { return '<div class="sayline">' + angleChip(s.angle) + '<div class="txt">' + Esc(s.text) + '</div></div>'; }).join('')
          + '</div>';
      }).join('')
      + (c.mat ? '<div class="muted" style="margin-top:8px;">素材：' + Esc(c.mat) + '</div>' : '')
      + (c.forbid ? '<div class="warnbox" style="margin-top:6px;">🚫 ' + Esc(c.forbid) + '</div>' : '')
      + '</div>';
  }
  async function acceptDraft() {
    if (!state.draft) return;
    var card = JSON.parse(JSON.stringify(state.draft));
    card.id = uniqueId(card.id || 'ai');
    card.src = ['AI 起草·你收下'];
    state.cards = await DrainCards.saveCards(state.cards.concat([card]));
    $('#draftMask').hidden = true;
    refreshStats(); renderList();
    toast('已收下，进表了；先拿 5～10 条真评论重放看效果');
  }

  /* ── 决策日志 ── */
  async function loadLog() {
    var el = $('#logList');
    el.innerHTML = '<div class="loading">正在读日志…</div>';
    var list = [];
    try { list = await DrainCards.getDecisions(100); } catch (_) {}
    if (!list.length) { el.innerHTML = '<div class="empty">还没有记录。真跑过一篇笔记（笔记下评或回评论）之后，这里会出现。</div>'; return; }
    el.innerHTML = list.map(function (it) {
      var card = cardById(it.scene);
      var scene = it.scene === 'skip' ? '跳过（同行/广告/悲伤）'
        : it.scene ? ((card && card.name) || it.scene) : '未收录';
      var branch = card ? branchLabel(card, it.branch) : '';
      return '<div class="logitem">'
        + '<div class="l1"><span>' + fmtTime(it.at) + '</span><span class="chip">' + (it.kind === 'note' ? '笔记下评' : '回评论') + '</span>'
        + '<span>' + Esc(it.noteTitle || '（没记标题）') + '</span></div>'
        + '<div class="l2"><b>' + Esc(scene) + '</b>' + (branch ? ' · ' + Esc(branch) : '') + (it.angle ? ' ' + angleChip(it.angle) : '') + '</div>'
        + (it.peer ? '<div class="muted">对方：' + Esc(String(it.peer).slice(0, 60)) + '</div>' : '')
        + '<div class="l2">' + (it.picked ? ('发了：' + Esc(it.picked)) : ('没发：' + Esc(it.reason || '没有可发的话'))) + '</div>'
        + ((it.candidates || []).length ? '<div class="muted">候选 ' + it.candidates.length + ' 句' + ((it.blocked || []).length ? '，拦了 ' + it.blocked.length + ' 句' : '') + '</div>' : '')
        + '</div>';
    }).join('');
  }

  /* ── 事件 ── */
  function bind() {
    $$('.tab').forEach(function (t) {
      t.onclick = function () {
        state.tab = t.getAttribute('data-tab');
        $$('.tab').forEach(function (x) { x.classList.toggle('on', x === t); });
        $$('.pane').forEach(function (p) { p.classList.toggle('on', p.id === 'pane-' + state.tab); });
        if (state.tab === 'log') loadLog();
      };
    });
    $('#q').oninput = function (e) { state.q = e.target.value; renderList(); };
    $('#btnNew').onclick = function () { openEditor(null); };
    $('#btnDraft').onclick = openDraft;
    $('#btnReset').onclick = async function () {
      if (!confirm('恢复默认 14 张？你自己改过、加过的卡会被清掉。')) return;
      await DrainCards.resetCards();
      state.cards = await DrainCards.getCards();
      refreshStats(); renderList();
      toast('已恢复默认 14 张');
    };
    $('#btnBack').onclick = function () {
      if (window.opener && !window.opener.closed) { window.close(); return; }
      if (history.length > 1) { history.back(); return; }
      location.href = 'settings.html';
    };

    $('#edAddBranch').onclick = function () {
      $('#edBranches').insertAdjacentHTML('beforeend', branchHtml({}));
      renumberBranches();
      var all = $$('#edBranches .br');
      var last = all[all.length - 1];
      if (last) { var inp = $('[data-b="cond"]', last); if (inp) inp.focus(); }
    };
    $('#edBranches').addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('[data-del-branch]')) {
        var br = t.closest('.br');
        if (br) br.remove();
        renumberBranches();
        return;
      }
      if (t.closest('[data-add-say]')) {
        var box = $('.says', t.closest('.br'));
        if (box) box.insertAdjacentHTML('beforeend', sayRowHtml('方法拆解', ''));
        return;
      }
      if (t.closest('[data-del-say]')) {
        var row = t.closest('.sayrow');
        var wrap = row && row.parentNode;
        if (row) row.remove();
        if (wrap && !$$('.sayrow', wrap).length) wrap.insertAdjacentHTML('beforeend', sayRowHtml('共情接住', ''));
      }
    });
    $('#edSave').onclick = saveEditor;

    $('#btnReplay').onclick = runReplay;
    $('#drGo').onclick = runDraft;
    $('#drAccept').onclick = acceptDraft;

    $$('[data-close]').forEach(function (b) {
      b.onclick = function () { var el = $(b.getAttribute('data-close')); if (el) el.hidden = true; };
    });
    $$('.mask').forEach(function (m) {
      m.addEventListener('mousedown', function (e) { if (e.target === m) m.hidden = true; });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') $$('.mask').forEach(function (m) { m.hidden = true; });
    });
  }

  bind();
  load();
})();
