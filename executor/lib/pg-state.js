/* B档·按需加载：统一状态模型（6 档）
   从 popup.js 拆出来，popup.html 末尾的加载器在你点开这一页时才下载。 */
const PL_STATUS_ALL = ['待触达', '已触达', '谈单中', '流失中', '已成交', '已废弃'];
const STATUS_RANK = { '待触达': 1, '已触达': 2, '谈单中': 3, '流失中': 4, '已成交': 5, '已废弃': 6 };
const STATUS_RANK_REV = { 1: '待触达', 2: '已触达', 3: '谈单中', 4: '流失中', 5: '已成交', 6: '已废弃' };
// 旧数据迁移：历史「已回复」按「谈单中」显示（不改底层值）
function _rawStatusOf(p) { const s = (p && p.status) || ''; return (s === '已回复') ? '谈单中' : s; }
const _isMsgRecord = p => _plBucket(p) === 'msg';
// 流失中：该人已达「已触达/谈单中」这一级（已确认联系），且最后一条消息距今 ≥3 天、对方未回（等对方回）
function _isLost(q) {
  if (!(q.awaitingReply) && q.lastFrom !== 'me' && !_isOutbound(q)) return false; // 不在等对方回 → 不算流失
  const raw = (q.lastConvFp && q.lastConvFp.at);
  let t = 0;
  if (typeof raw === 'number') t = raw;
  else if (raw) { t = Date.parse(String(raw)); if (isNaN(t)) t = 0; }
  if (!t) return false;
  return (Date.now() - t) >= 3 * 24 * 3600 * 1000;
}
// ★ 一个人的「有效状态」：取该人所有记录里最高优先（跨渠道跨桶统一；流失中为时间派生）
// 该人是否在消息桶里已有同名/同 id 的记录（→ 视为已被触达，用户清单不再显示为未接触）
function _hasMsgSibling(person) {
  if (!person) return false;
  const full = (_plData && _plData.fullList) || [];
  if (!full.length) return false;
  const _nm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
  const uid = person.userId ? String(person.userId).toLowerCase() : '';
  const nick = _nm(person.nickname);
  return full.some(q => {
    if (!q || q.id === person.id) return false;
    if (!(q.inbound || q.direction === 'inbound' || (q.source && q.source.stageEntry === '消息'))) return false;
    if (uid && q.userId) return String(q.userId).toLowerCase() === uid;
    if (nick && nick !== '未知用户' && _nm(q.nickname)) return _nm(q.nickname) === nick;
    return false;
  });
}
function _personStatus(person) {
  const ids = person ? [person.id, ..._samePersonIds(person)] : [];
  let rank = 0;
  const recs = (_plData.list || []).filter(q => q && q.id && ids.includes(q.id));
  if (!recs.length) return _rawStatusOf(person) || '待触达';
  for (const q of recs) {
    const s = _rawStatusOf(q);
    let r;
    if (s === '已废弃') r = 6;
    else if (s === '已成交') r = 5;
    else if (s === '谈单中') r = 3;
    else if (s === '已触达' || _isMsgRecord(q)) r = 2;
    else r = 1;
    if ((r === 2 || r === 3) && _isLost(q)) r = 4; // 已确认联系且 3 天未回 → 流失中
    if (r > rank) rank = r;
  }
  return STATUS_RANK_REV[rank] || '待触达';
}

// ★ 统一状态机：每桶仅 3 态，单一派生出口（不再多头判断底层字段）
const PL_STATE_META = {
  untouched: { t: '未触达', c: '#2563eb', bg: '#eff6ff' },   // 通知：进池没动手
  touched: { t: '已触达·待回复', c: '#b45309', bg: '#fffbeb' }, // 通知：我发了等对方回
  prospect: { t: '已转商机', c: '#7c3aed', bg: '#f5f3ff' }, // 通知：对方回→已转商机
  open: { t: '未转化', c: '#059669', bg: '#ecfdf5' },       // 消息：在谈没成交
  converted: { t: '已转化', c: '#92400e', bg: '#fef3c7' }, // 消息：已成交
  other: { t: '其他', c: '#6b7280', bg: '#f3f4f6' },       // 消息：未收录/受限/杂项
};
function _plClosed(p) { return p.status === '已成交' || (p.funnel && p.funnel.step === 'closed'); }
function _plStateOf(p, bucket) {
  const st = _plGetStage(p);
  if (bucket === 'msg') {
    if (_plClosed(p)) return 'converted';
    if (st === 'prospect' || (st === 'lead' && p.awaitingReply)) return 'open';
    return 'other';
  }
  if (st === 'prospect') return 'prospect';
  if (p.awaitingReply) return 'touched';
  return 'untouched';
}
function _plSatisfies(p, key, bucket) {
  if (!key) return true;
  return _plStateOf(p, bucket) === key;
}
// 层内子状态定义
const PL_STAGE_META = {
  lead: { t: '🎇 线索', c: '#0f766e', bg: '#ecfdf5' },
  prospect: { t: '🎯 商机', c: '#7c3aed', bg: '#f5f3ff' },
};
const PL_FUNNEL = {
  pending: { t: '待触达', c: '#2563eb', bg: '#eff6ff' },
  touched: { t: '已触达', c: '#b45309', bg: '#fffbeb' },
  replied: { t: '已回复', c: '#059669', bg: '#ecfdf5' },
  talking: { t: '谈单中', c: '#7c3aed', bg: '#f5f3ff' },
  closed: { t: '已成交', c: '#92400e', bg: '#fef3c7' },
};
const PL_DEFAULT_STATUSES = ['待触达', '已触达', '谈单中', '流失中', '已成交', '已废弃'];
const PL_ENTRY_BADGE = {
  '点赞': { t: '💗点赞', c: '#0e7490', bg: '#ecfeff' },
  '收藏': { t: '⭐收藏', c: '#d97706', bg: '#fffbeb' },
  '关注': { t: '👣关注', c: '#475569', bg: '#f1f5f9' },
  '回复': { t: '💬回复', c: '#059669', bg: '#ecfdf5' },
  '评论': { t: '💬评论', c: '#4f46e5', bg: '#eef2ff' },
  '关键词命中': { t: '🔑关键词', c: '#b45309', bg: '#fffbeb' },
  'AI路由': { t: '🧠AI', c: '#7c3aed', bg: '#f5f3ff' },
  '消息': { t: '💬消息', c: '#0e7490', bg: '#ecfeff' },
  '评论跟进': { t: '💬AI客服', c: '#059669', bg: '#ecfdf5' },
  '手动': { t: '✋手动', c: '#475569', bg: '#f1f5f9' },
};

// 层徽章：商机池显示用户维护的状态，线索池显示层级
const _plStatusColor = (s) => ({ '待触达': '#2563eb', '已触达': '#b45309', '谈单中': '#7c3aed', '流失中': '#d97706', '已成交': '#92400e', '已废弃': '#6b7280', '已回复': '#7c3aed' }[s] || '#6b7280');
function _plStageBadge(p) {
  const s = _plGetStage(p);
  if (s === 'prospect') { const st = p.status || '待触达'; return `<span class="pl-badge" style="background:#eef2ff;color:${_plStatusColor(st)};">${esc(st)}</span>`; }
  const m = PL_STAGE_META.lead; return `<span class="pl-badge" style="background:${m.bg};color:${m.c};">${m.t}</span>`;
}
// 来源徽章
function _plEntryBadge(p) {
  const m = PL_ENTRY_BADGE[_plEntry(p)];
  if (!m) return '';
  return `<span class="pl-origin" style="background:${m.bg};color:${m.c};">${m.t}</span>`;
}
// ── 多来源辅助：读记录历次渠道 channels[]（旧数据兜底从 source 推导）──
const _CH_PRIO = { '评论': 0, '点赞&收藏': 1, 'AI': 2, '关注': 3 };
const _CH_ENTRY_TYPE = { '关注': '关注', '点赞': '点赞&收藏', '收藏': '点赞&收藏', '回复': '评论', '评论': '评论', '互动': '评论', 'AI路由': 'AI', '关键词命中': 'AI', '评论跟进': 'AI', '消息': '' };
function _channelsOf(p) {
  if (p && Array.isArray(p.channels) && p.channels.length) return p.channels;
  const e = (p && p.source && p.source.stageEntry) || '';
  if (!e) return [];
  return [{ type: _CH_ENTRY_TYPE[e] || '评论', entry: e, comment: (p.source && p.source.comment) || p.likedComment || '', noteTitle: (p.source && p.source.noteTitle) || '', nTime: p.nTime || null, nTimeStr: p.nTimeStr || '', signalText: (p.source && p.source.signalText) || '' }];
}
function _bestChannel(p) {
  const cs = _channelsOf(p);
  if (!cs.length) return null;
  return cs.slice().sort((a, b) => (_CH_PRIO[a.type] !== undefined ? _CH_PRIO[a.type] : 9) - (_CH_PRIO[b.type] !== undefined ? _CH_PRIO[b.type] : 9))[0];
}
function _channelsBadge(p) {
  const seen = new Set();
  return _channelsOf(p).map(c => {
    const m = PL_ENTRY_BADGE[c.entry] || PL_ENTRY_BADGE[c.type == null ? '' : c.type];
    if (!m) return '';
    if (seen.has(m.t)) return '';
    seen.add(m.t);
    return `<span class="pl-origin" style="background:${m.bg};color:${m.c};">${m.t}</span>`;
  }).filter(Boolean).join(' ');
}
function _notifContent(p) {
  const c = _bestChannel(p);
  if (!c) return '<span style="color:#c0c4cc;">—</span>';
  if (c.type === '评论' && c.comment) return `📝 <span title="${esc(c.comment)}">${esc(String(c.comment).slice(0, 80))}</span>`;
  if (c.noteTitle) return `📕 <span title="${esc(c.noteTitle)}">${esc(String(c.noteTitle).slice(0, 40))}</span>`;
  const t = c.signalText || c.comment || '';
  return t ? esc(String(t).slice(0, 80)) : '<span style="color:#c0c4cc;">—</span>';
}
function _channelTimeVal(p) {
  const c = _bestChannel(p);
  return fmtDateTime((c && c.nTime) || p.nTime || p.updatedAt);
}
// 层内"下一步"建议（体现"接触过没 → 下一步该做啥"）
function _plNextHint(p) {
  const s = _plGetStage(p);
  const tip = (s === 'lead')
    ? '还没接触过：私信触达 → 对方一回复就升成商机；点「🧠 高意向跟进」优先追。'
    : '已在跟进，状态由你维护（可改状态列表）。';
  return (s === 'lead' ? '🎇 线索' : '⏩ 商机') + '<span class="qhelp" tabindex="0" data-tip="' + _dEsc(tip) + '">?</span>';
}

// 收录关键词设置（弹窗编辑 config.product.targetKeywords）
async function editTargetKeywords() {
  const config = await getConfigSafe();
  const kws = (config.product && config.product.targetKeywords) || [];
  const joined = kws.join('，');
  const val = window.prompt('收录关键词（命中评论即自动入清单，多个用逗号分隔）：', joined);
  if (val === null) return;
  const list = val.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean);
  await updateConfig({ product: { targetKeywords: list } });
  addLog(`⚙️ 收录关键词已更新：${list.join('、') || '（空）'}`, 'info');
  const pc = document.getElementById('prospectContent');
  if (pc && pc.style.display !== 'none') loadProspectList(pc);
}

// 商机池状态列表管理（用户手工维护：状态可增删改，每个商机挂一个）
async function editProspectStatus() {
  const config = await getConfigSafe();
  const cur = (config.prospect && config.prospect.statuses) || PL_DEFAULT_STATUSES;
  const val = window.prompt('商机状态列表（每个商机可选一个状态，逗号分隔）：\n例：待触达，已回复，谈单中，已成交', cur.join('，'));
  if (val === null) return;
  const list = val.split(/[,，、\n]+/).map(s => s.trim()).filter(Boolean);
  await updateConfig({ prospect: { statuses: list } });
  addLog(`⚙️ 商机状态已更新：${list.join('、') || '（空）'}`, 'info');
  const pc = document.getElementById('prospectContent');
  if (pc && pc.style.display !== 'none') loadProspectList(pc);
}

async function loadProspectList(container) {
  container.innerHTML = '';
  const loading = document.createElement('div');
  loading.style.cssText = 'padding:30px;text-align:center;color:#666;font-size:13px;';
  loading.textContent = '⏳ 加载用户清单...';
  container.appendChild(loading);

  const resp = await chrome.runtime.sendMessage({ action: 'getProspectList', data: { filter: _plFilter, includeDiscarded: _plShowDiscarded } });
  if (!resp || !resp.ok) {
    loading.textContent = '❌ 加载失败：' + ((resp && resp.error) || '未知错误');
    return;
  }
  // 统计条用全量数据（不带筛选），避免筛选后统计数字跟着变
  let fullList = [];
  try {
    const full = await chrome.runtime.sendMessage({ action: 'getProspectList', data: {} });
    if (full && full.ok) fullList = full.list || [];
  } catch (_) {}
  // 商机状态列表（用户可手工维护）——从配置读取
  let statuses = [];
  try {
    const cfg = await getConfigSafe();
    statuses = (cfg.prospect && cfg.prospect.statuses) || [];
  } catch (_) {}
  _plData = { list: resp.list || [], allTags: resp.allTags || [], fullList, statuses };
  try {
    renderProspectList(container);
  } catch (e) {
    addLog('❌ 渲染用户清单出错：' + (e && e.message) + '　' + ((e && e.stack || '').split('\n')[1] || ''), 'error');
    const er = document.createElement('div');
    er.style.cssText = 'padding:14px;color:#c62828;font-size:12px;line-height:1.6;';
    er.innerHTML = '❌ 渲染清单出错：' + esc((e && e.message) || e) + '<br><span style="color:#888;font-size:11px;">已在实时日志里打印出错位置，把 `❌ 渲染用户清单出错` 那行发我。</span>';
    container.appendChild(er);
  }
}

// 统一时间格式：yyyy-MM-dd HH:mm（支持 ms/秒时间戳、可解析日期串；解析失败回显原文）
function fmtDateTime(t) {
  if (t === undefined || t === null || t === '') return '';
  let d;
  if (typeof t === 'object' && t instanceof Date) { d = t; }
  else {
    const s = String(t);
    if (/^\d+$/.test(s)) { const n = Number(s); d = new Date(n > 1e12 ? n : n * 1000); }
    else d = new Date(s);
  }
  if (!d || isNaN(+d)) return String(t);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// 线索页的「通知来自哪个渠道」胶囊：通知 / 消息已由左栏二级切成两条线，这一排只筛通知的来源
const PL_CH_PILLS = [
  { k: 'all', t: '全部' },
  { sep: true },
  { k: 'comment', t: '评论' }, { k: 'like', t: '赞藏' }, { k: 'follow', t: '关注' }, { k: 'ai', t: 'AI' },
];
function _plStageLabel() {
  if (_plStage === 'msg') return '消息';
  const ch = { comment: '评论', like: '赞藏', follow: '关注', ai: 'AI' }[_plChannelSel];
  return ch ? ('通知 · ' + ch) : '通知';
}
function _plPillBar(container) {
  const bar = document.createElement('div');
  bar.className = 'pl-chans';
  // 已废弃是「状态筛选」进的管理视图，给一条回程
  if (_plShowDiscarded) {
    const back = document.createElement('button');
    back.className = 'pl-chan';
    back.innerHTML = Ic('arrow-left', 'ic-sm') + '返回' + (_plStage === 'msg' ? '消息' : '通知');
    back.addEventListener('click', () => { _plFilter2.touch = []; loadProspectList(container); });
    bar.appendChild(back);
    return bar;
  }
  if (_plStage !== 'notif') return null;   // 消息没有渠道可分，整条不渲染
  const cur = _plChannelSel || 'all';
  const lbl = document.createElement('span');
  lbl.className = 'pl-chans-lbl';
  lbl.textContent = '通知来自';
  bar.appendChild(lbl);
  PL_CH_PILLS.forEach((p) => {
    if (p.sep) { const s = document.createElement('span'); s.className = 'pl-chans-sep'; bar.appendChild(s); return; }
    const b = document.createElement('button');
    b.className = 'pl-chan' + (p.k === cur ? ' active' : '');
    b.textContent = p.t;
    b.addEventListener('click', () => {
      _plChannelSel = (p.k === 'all') ? '' : p.k;
      loadProspectList(container);
    });
    bar.appendChild(b);
  });
  return bar;
}

function renderProspectList(container) {
  container.innerHTML = '';
  const allList = _plData.list;
  // ★ "已废弃"= 一种状态；多选 chips ＝ 并集筛选（选中越多显示越多）
  const _isDisc = (p) => !!(p && (p.status === '已废弃' || p.discarded === true));
  const _touchSel = Array.isArray(_plFilter2.touch) && _plFilter2.touch.length ? _plFilter2.touch.slice() : [];
  // 🗑 已废弃管理视图：仅当【只勾选「已废弃」】进入（可恢复/彻底删）；与其它状态一起多选则按普通状态并集筛选
  const _dedicatedDisc = _touchSel.length === 1 && _touchSel[0] === '已废弃';
  _plShowDiscarded = _dedicatedDisc;
  const _pillBar = _plPillBar(container);   // ★ 通知页的渠道切换（消息页不渲染）
  if (_pillBar) container.appendChild(_pillBar);
  let list;
  // 🗑 已废弃视图：只显示标废的，不做渠道/触达/相关过滤
  if (_dedicatedDisc) {
    list = allList.filter(_isDisc);
  } else {
    // 双桶：通知（平台消息）/ 消息（私信往来）—— 一级导航已分成两页，这里只按当前页的桶取
    list = allList.filter(p => _plBucket(p) === _plStage);
    if (_plHideBlocked) list = list.filter(p => !p.dmBlocked);
    // ★「通知」按渠道 tab 过滤（全部/评论/点赞&收藏/关注/AI）
    if (_plStage === 'notif' && _plChannelSel) {
      const chMap = { comment: '评论', like: '赞藏', follow: '关注', ai: 'AI' };
      const want = chMap[_plChannelSel];
      if (want) list = list.filter(p => _plChannel(p) === want);
    }
    // ★ 状态多选筛选：多选=并集（命中任一选中状态即保留）；未选=默认隐藏已废弃
    if (_touchSel.length) {
      list = list.filter(p => _touchSel.includes(_personStatus(p)));
    } else {
      list = list.filter(p => !_isDisc(p));
    }
  }
  _currentShown = list.slice(); // ★ 记录当前 tab 筛出的这批，供批量触达/生成话术用
  // ★ 一人一行：同 userId/昵称合并（触达状态按"人"算，任一渠道触达过，其余渠道也算已触达；
//  重复时保留触达进度更高/状态更优的那条）
  {
    const best = new Map();
    const prio = (x) => ({ untouched: 0, touched: 1, awaiting: 2, prospect: 3 }[_plTouchState(x)] !== undefined ? { untouched: 0, touched: 1, awaiting: 2, prospect: 3 }[_plTouchState(x)] : 0);
    const unionCh = (a, b) => {
      const out = (Array.isArray(a) ? a : []).slice();
      for (const c of (Array.isArray(b) ? b : [])) {
        if (!c || !c.type) continue;
        const i = out.findIndex(x => x && String(x.type) === String(c.type));
        if (i >= 0) out[i] = { ...out[i], ...c, type: out[i].type };
        else out.push(c);
      }
      return out;
    };
    for (const p of list) {
      const k = p.userId ? 'id:' + String(p.userId).toLowerCase() : ('nick:' + (p.nickname || '').toLowerCase());
      if (!k || k === 'nick:') { best.set('__uniq_' + best.size, p); continue; }
      const cur = best.get(k);
      if (!cur) { best.set(k, p); }
      else {
        const up = prio(p) > prio(cur) ? p : cur;
        best.set(k, { ...up, channels: unionCh(_channelsOf(cur), _channelsOf(p)) });
      }
    }
    list = Array.from(best.values());
  }
  // 消息桶：只把"已来回过的我方触达"折叠进独立分组；待回复(awaitingReply)outbound 进主列表置顶
  let outList = [];
  if (_plStage === 'msg') {
    outList = list.filter(p => _isOutbound(p) && !p.awaitingReply);
    const pendingOut = list.filter(p => _isOutbound(p) && p.awaitingReply); // 我方触达·对方未回 → 置顶
    list = list.filter(p => !_isOutbound(p));
    if (pendingOut.length) list = pendingOut.concat(list);
  }
  const total = list.length;
  const _isDisc2 = (p) => !!(p && (p.status === '已废弃' || p.discarded === true));
  const fullList = (_plData.fullList || allList).filter(p => (_plShowDiscarded || _touchSel.includes('已废弃')) ? true : !_isDisc2(p));
  // ★ 排序：待回复优先；回评(入口'回复')/高意向次之；其余按意向权重再按时间新到旧
  const _plEv = (p) => (p.profile && p.profile.intentLevel) || (p.affinity && p.affinity.intentLevel) || 'medium';
  const _intentRank = (p) => ({ high: 2, medium: 1, low: 0 }[_plEv(p)] !== undefined ? { high: 2, medium: 1, low: 0 }[_plEv(p)] : 1);
  const _replyRank = (p) => (_plEntry(p) === '回复' ? 1 : 0);
  // 最近活跃时间：优先会话最后消息时间，其次本地更新时间，避免用"收录时间"导致新旧倒置
  const _plActivity = (p) => {
    const raw = p.lastConvFp && p.lastConvFp.at;
    if (raw) { const t = (typeof raw === 'number') ? raw : Date.parse(String(raw)); if (!isNaN(t)) return t; }
    return (p.updatedAt || p.createdAt || 0);
  };
  // 消息桶排序键：XHS 会话 DOM 顺序(order, 0=最新在前)；没有则退回活跃时间倒序
  // 最近活跃/通知时间：优先通知真实时间 nTime，其次会话/更新时间
  const _nTimeOf = (p) => {
    if (p.nTime) { const n = +p.nTime; if (n > 0) return n; }
    const raw = p.lastConvFp && p.lastConvFp.at;
    if (raw) { const t = (typeof raw === 'number') ? raw : Date.parse(String(raw)); if (!isNaN(t)) return t; }
    return (p.updatedAt || p.createdAt || 0);
  };
  list = list.slice().sort((a, b) => _plActivity(b) - _plActivity(a)); // 消息/通知按"最后一条消息时间"倒序（最新在前），对齐小红书原序

  // 【诊断】列表空时，把存储与分桶情况写到"实时日志"，便于定位"没入库"还是"没显示"
  if (list.length === 0 && !_plShowDiscarded) {
    try {
      addLog(`线索清单为空：存储 ${allList.length} 条（通知 ${allList.filter(p => _plBucket(p) === 'notif').length} / 消息 ${allList.filter(p => _plBucket(p) === 'msg').length}），当前视图「${_plStageLabel()}」`, 'warn');
      if (allList.length) {
        addLog('[诊断] 示例：' + allList.slice(0, 6).map(p => `${p.nickname || '?'}/${_plBucket(p)}/stage=${p.stage || '?'}/entry=${(p.source && p.source.stageEntry) || '?'}`).join('；'), 'warn');
      }
    } catch (_) {}
  }

  // 批量操作条（按层出ロ）
  const batch = document.createElement('div');
  batch.className = 'pl-batch';
  if (_plStage === 'msg') {
    // ── 消息工具条：[✨生成AI话术▾] [🔄刷新消息▾] ──
    const grp = document.createElement('span');
    grp.style.cssText = 'display:inline-flex;gap:6px;align-items:center;';
    const mkOpt = (html, style) => { const o = document.createElement('div'); o.innerHTML = html; o.style.cssText = style || 'padding:8px 10px;font-size:12px;border-radius:6px;cursor:pointer;color:#1a1a1a;'; o.addEventListener('mouseenter', () => { o.style.background = '#f3f0ff'; }); o.addEventListener('mouseleave', () => { o.style.background = ''; }); return o; };
    // [✨生成AI话术 ▾]（下拉 = 批量联系TA）
    const genWrap = document.createElement('span');
    genWrap.className = 'plNotifGroup';
    genWrap.style.cssText = 'position:relative;display:inline-flex;align-items:stretch;border:1px solid #ef4444;border-radius:8px;';
    const genBtn = document.createElement('button');
    genBtn.id = 'plMsgGenBtn'; genBtn.textContent = '✨ 生成AI话术';
    genBtn.style.cssText = 'padding:5px 12px;border:none;border-radius:8px 0 0 8px;background:#fef2f2;color:#dc2626;font-weight:600;cursor:pointer;font-size:11px;';
    genBtn.title = '为当前消息生成AI回复话术（红色=联系TA同款，点左侧主区批量生成）';
    const genCaret = document.createElement('button');
    genCaret.id = 'plMsgGenCaret'; genCaret.textContent = '▾';
    genCaret.style.cssText = 'padding:5px 9px;border:none;border-left:1px solid #fca5a5;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:11px;';
    const genMenu = document.createElement('div');
    genMenu.className = 'plNotifMenu';
    genMenu.style.cssText = 'display:none;position:absolute;top:calc(100% + 4px);right:0;z-index:61;min-width:150px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 8px 24px rgba(15,23,42,.12);padding:4px;';
    const optContact = mkOpt('💬 批量联系TA', 'padding:8px 10px;font-size:12px;border-radius:6px;cursor:pointer;color:#dc2626;font-weight:600;');
    genMenu.appendChild(optContact);
    genWrap.append(genBtn, genCaret, genMenu);
    genBtn.addEventListener('click', () => { genMsgDrafts(container); });
    genCaret.addEventListener('click', () => { genMenu.style.display = genMenu.style.display === 'block' ? 'none' : 'block'; });
    optContact.addEventListener('click', async () => { genMenu.style.display = 'none'; await batchContactMsg(container); });
    // [🔄刷新消息 ▾]（下拉 = 清空消息）
    const refWrap = document.createElement('span');
    refWrap.className = 'plNotifGroup';
    refWrap.style.cssText = 'position:relative;display:inline-flex;align-items:stretch;border:1px solid #f59e0b;border-radius:8px;';
    const inb = document.createElement('button');
    inb.id = 'plSyncInbound'; inb.textContent = '🔄 刷新消息';
    inb.style.cssText = 'padding:5px 12px;border:none;border-radius:8px 0 0 8px;background:#fffbeb;color:#b45309;font-weight:600;cursor:pointer;font-size:11px;';
    const refCaret = document.createElement('button');
    refCaret.id = 'plMsgRefCaret'; refCaret.textContent = '▾';
    refCaret.style.cssText = 'padding:5px 9px;border:none;border-left:1px solid #fde3a7;background:#fffbeb;color:#b45309;cursor:pointer;font-size:11px;';
    const refMenu = document.createElement('div');
    refMenu.className = 'plNotifMenu';
    refMenu.style.cssText = 'display:none;position:absolute;top:calc(100% + 4px);right:0;z-index:60;min-width:120px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 8px 24px rgba(15,23,42,.12);padding:4px;';
    const optClear = mkOpt('🧹 清空消息');
    refMenu.appendChild(optClear);
    refWrap.append(inb, refCaret, refMenu);
    inb.addEventListener('click', () => syncChatInbound(container));
    refCaret.addEventListener('click', () => { refMenu.style.display = refMenu.style.display === 'block' ? 'none' : 'block'; });
    optClear.addEventListener('click', async () => { refMenu.style.display = 'none'; await clearMsgBucketOnly(container); });
    if (!window.__plMsgOuterBound) {
      window.__plMsgOuterBound = true;
      document.addEventListener('click', (e) => {
        document.querySelectorAll('.plNotifMenu').forEach(m => {
          const g = m.closest('.plNotifGroup');
          if (m.style.display === 'block' && !(g && g.contains(e.target))) m.style.display = 'none';
        });
      });
    }
    grp.append(genWrap, refWrap);
    batch.appendChild(grp);
  }
  // ★ 通知工具条：✨生成AI话术▾ / 🔄刷新通知▾（批量改状态已移到下方筛选行最前）
  let bsOpts = '';
  if (!_plShowDiscarded && _plStage === 'notif') {
    const bsList = (() => { const l = PL_STATUS_ALL.slice(); if (!l.includes('已触达')) l.unshift('已触达'); if (!l.includes('已废弃')) l.push('已废弃'); return l; })();
    bsOpts = `<option value="">批量改状态(${_selectedIds.size})…</option>` + bsList.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    const grp = document.createElement('span');
    grp.style.cssText = 'display:inline-flex;gap:6px;align-items:center;';
    const mkOpt = (html, style) => { const o = document.createElement('div'); o.innerHTML = html; o.style.cssText = style || 'padding:8px 10px;font-size:12px;border-radius:6px;cursor:pointer;color:#1a1a1a;'; o.addEventListener('mouseenter', () => { o.style.background = '#f3f0ff'; }); o.addEventListener('mouseleave', () => { o.style.background = ''; }); return o; };
    // [✨ 生成AI话术 ▾]（下拉 = 自动触达）
    const genWrap = document.createElement('span');
    genWrap.className = 'plNotifGroup';
    genWrap.style.cssText = 'position:relative;display:inline-flex;align-items:stretch;border:1px solid #ef4444;border-radius:8px;';
    const genBtn = document.createElement('button');
    genBtn.id = 'plGenDraftBtn'; genBtn.textContent = '✨ 生成AI话术';
    genBtn.style.cssText = 'padding:5px 12px;border:none;border-radius:8px 0 0 8px;background:#fef2f2;color:#dc2626;font-weight:600;cursor:pointer;font-size:11px;';
    genBtn.title = '为通知里的线索生成AI触达话术（红色=联系TA同款，点左侧主区批量生成）';
    const genCaret = document.createElement('button');
    genCaret.id = 'plGenCaret'; genCaret.textContent = '▾';
    genCaret.style.cssText = 'padding:5px 9px;border:none;border-left:1px solid #fca5a5;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:11px;';
    const genMenu = document.createElement('div');
    genMenu.className = 'plNotifMenu';
    genMenu.style.cssText = 'display:none;position:absolute;top:calc(100% + 4px);right:0;z-index:61;min-width:180px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 8px 24px rgba(15,23,42,.12);padding:4px;';
    const optTouch = mkOpt('⚡ 自动触达', 'padding:8px 10px;font-size:12px;border-radius:6px;cursor:pointer;color:#dc2626;font-weight:600;');
    genMenu.appendChild(optTouch);
    genWrap.append(genBtn, genCaret, genMenu);
    genBtn.addEventListener('click', () => { genMissingDrafts(container, false); });
    genCaret.addEventListener('click', () => { genMenu.style.display = genMenu.style.display === 'block' ? 'none' : 'block'; });
    optTouch.addEventListener('click', async () => { genMenu.style.display = 'none'; await genMissingDrafts(container, false); if (typeof batchTouchAuto === 'function') batchTouchAuto(container); });
    // [🔄 刷新通知 ▾]（下拉只剩 清空列表）
    const group = document.createElement('div');
    group.className = 'plNotifGroup';
    group.style.cssText = 'position:relative;display:inline-flex;align-items:stretch;border:1px solid #0e7490;border-radius:8px;';
    const rf = document.createElement('button'); rf.id = 'plNotifRefresh'; rf.textContent = '🔄 刷新通知'; rf.style.cssText = 'padding:5px 12px;border:none;background:#ecfeff;color:#0e7490;font-weight:600;cursor:pointer;font-size:11px;';
    const caret = document.createElement('button'); caret.id = 'plNotifMore'; caret.textContent = '▾'; caret.style.cssText = 'padding:5px 9px;border:none;border-left:1px solid #bae6fd;background:#ecfeff;color:#0e7490;cursor:pointer;font-size:11px;';
    const menu = document.createElement('div'); menu.id = 'plNotifMenu'; menu.className = 'plNotifMenu'; menu.style.cssText = 'display:none;position:absolute;top:calc(100% + 4px);right:0;z-index:60;min-width:120px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 8px 24px rgba(15,23,42,.12);padding:4px;';
    const optClear = mkOpt('🧹 清空通知');
    const optClearAll = mkOpt('🗑 清空全部（消息+通知）', 'padding:8px 10px;font-size:12px;border-radius:6px;cursor:pointer;color:#b45309;');
    menu.append(optClear, optClearAll);
    group.appendChild(rf); group.appendChild(caret); group.appendChild(menu);
    const closeMenu = () => { menu.style.display = 'none'; };
    rf.addEventListener('click', () => _refreshCurrentTab(container));
    caret.addEventListener('click', () => { menu.style.display = menu.style.display === 'block' ? 'none' : 'block'; });
    optClear.addEventListener('click', async () => { closeMenu(); await clearNotifBucketOnly(container); });
    optClearAll.addEventListener('click', async () => { closeMenu(); await clearAllProspects(container); });
    if (!window.__plNotifOuterBound) {
      window.__plNotifOuterBound = true;
      document.addEventListener('click', (e) => {
        document.querySelectorAll('.plNotifMenu').forEach(m => {
          const g = m.closest('.plNotifGroup');
          if (m.style.display === 'block' && !(g && g.contains(e.target))) m.style.display = 'none';
        });
      });
    }
    grp.append(genWrap, group);
    batch.appendChild(grp);
  }
  // 消息视图：批量改状态下拉（消息桶无「待触达」，状态列表对应过滤）
  if (_plStage === 'msg' && !_plShowDiscarded) {
    const bsList = PL_STATUS_ALL.filter(s => s !== '待触达');
    bsOpts = `<option value="">批量改状态(${_selectedIds.size})…</option>` + bsList.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  }
  if (!_plShowDiscarded && batch.childNodes.length) container.appendChild(batch);

  // ★ 通知视图：顶部挂「通知回访队列」（待回/正在回/今天已回；执行器控件就在这一块里）
  if (_plStage === 'notif') chatqMount(container);

  // 筛选行：左=批量改状态 + 状态(chips) ｜ 右=昵称搜索
  const filter = document.createElement('div');
  filter.className = 'pl-filter';
  filter.innerHTML = `
    ${(!_plShowDiscarded) ? `<select id="plBatchStatus" style="font-size:11px;padding:3px 8px;border:1px solid #c4b5fd;border-radius:6px;color:#6d28d9;background:#faf5ff;">${bsOpts}</select>` : ''}
    <span style="font-size:11px;color:#888;white-space:nowrap;">状态</span>
    <span id="plTouchChips" style="display:inline-flex;gap:4px;flex-wrap:wrap;"></span>
    <span style="margin-left:auto;display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap;">
      <input id="plSearch" placeholder="🔍 搜索昵称" style="width:92px;min-width:0;" value="${esc(_plFilter.keyword)}">
    </span>`;
  container.appendChild(filter);
  // ★ 状态多选 ＝ 点选 chips（唯一的状态筛选项；选"已废弃"即进已废弃视图）
  //   消息桶必然已联系 → 不提供「待触达」筛项
  const _STATUS_OPTS = (_plStage === 'msg') ? PL_STATUS_ALL.filter(s => s !== '待触达') : PL_STATUS_ALL.slice();
  const _touchSet = new Set(Array.isArray(_plFilter2.touch) ? _plFilter2.touch : []);
  const chipsBox = filter.querySelector('#plTouchChips');
  const paintChips = () => {
    chipsBox.innerHTML = _STATUS_OPTS.map((s) => {
      const on = _touchSet.has(s);
      return `<span class="plat-chip" data-s="${s}" style="cursor:pointer;font-size:11px;border:1px solid ${on ? '#7c3aed' : '#d5c8f5'};background:${on ? '#f3f0ff' : '#fff'};color:${on ? '#7c3aed' : '#6d28d9'};border-radius:12px;padding:2px 9px;">${s}</span>`;
    }).join('');
  };
  paintChips();
  chipsBox.querySelectorAll('.plat-chip').forEach((c) => c.addEventListener('click', () => {
    const s = c.dataset.s;
    if (_touchSet.has(s)) _touchSet.delete(s); else _touchSet.add(s);
    _plFilter2.touch = Array.from(_touchSet);
    paintChips();
    applyFilterHelper();
  }));
  // ★ 批量改状态：下拉选即生效（对勾选的人）
  container.querySelector('#plBatchStatus')?.addEventListener('change', async (e) => {
    const status = e.target.value; e.target.value = '';
    const ids = Array.from(_selectedIds);
    if (!ids.length) { addLog('⚠️ 未勾选任何客户', 'warn'); return; }
    if (!status) { addLog('⚠️ 未选择要改成哪个状态', 'warn'); return; }
    if (!window.confirm(`确认将 ${ids.length} 个客户的状态改为「${status}」？`)) return;
    let n = 0; const totalIds = [];
    const _plById = (i) => _plData.list.find(p => p && p.id === i);
    for (const id of ids) {
      const pg = _plById(id);
      const sibs = pg ? [id, ..._samePersonIds(pg)] : [id];
      for (const sid of sibs) { if (!totalIds.includes(sid)) totalIds.push(sid); }
    }
    for (const sid of totalIds) {
      try { await chrome.runtime.sendMessage({ action: 'updateProspect', data: { id: sid, updates: { status } } }); n++; } catch (_) {}
    }
    _selectedIds.clear();
    addLog(`✅ 已批量改状态为「${status}」：${n}/${totalIds.length}` + (totalIds.length > ids.length ? '（含同人他渠道记录）' : ''), 'success');
    loadProspectList(container);
  });
  const applyFilter = () => {
    _plFilter.keyword = filter.querySelector('#plSearch').value.trim();
    applyFilterHelper();
  };
  const applyFilterHelper = () => { _plPage = 0; loadProspectList(container); };
  filter.querySelector('#plSearch').addEventListener('keydown', e => { if (e.key === 'Enter') applyFilter(); });

  

  // 空态
  if (total === 0) {
    const empty = document.createElement('div');
    empty.className = 'pl-empty';
    if (_plStage === 'msg') {
      empty.innerHTML = '📨 消息桶暂无记录。<br>点上方「🔄 刷新消息」，直接从小红书消息中心拉取你与客户的对话。';
      container.appendChild(empty);
      return;
    }
    empty.innerHTML = '🎯 清单为空。<br>在「获客助手」扫描笔记时，点击商机卡片的「➕ 入清单」，或用关键词收录命中评论。';
    container.appendChild(empty);
    return;
  }

  // 分页
  const pageCount = Math.max(1, Math.ceil(total / PL_PAGE_SIZE));
  _plPage = Math.min(_plPage, pageCount - 1);
  const pageList = list.slice(_plPage * PL_PAGE_SIZE, (_plPage + 1) * PL_PAGE_SIZE);

  // 表头 + tbody
  const table = document.createElement('table');
  table.className = 'pl-table';
  const isMsgView = _plStage === 'msg';
  const isNotifView = _plStage === 'notif';
  table.innerHTML = isMsgView
    ? `<thead><tr>
      <th class="pl-col-sel"><input type="checkbox" id="plHeaderSelectAll" class="pl-sel-all" title="全选本页" style="accent-color:#7c3aed;"></th>
      <th class="pl-col-user">用户</th>
      <th class="pl-col-who">收发</th>
      <th class="pl-col-msg">最近消息</th>
      <th class="pl-col-time">时间</th>
      <th class="pl-col-act">操作</th>
      <th class="pl-col-x"></th>
    </tr></thead>`
    : isNotifView
    ? `<thead><tr>
      <th class="pl-col-sel"><input type="checkbox" id="plHeaderSelectAll" class="pl-sel-all" title="全选本页" style="accent-color:#7c3aed;"></th>
      <th class="pl-col-user">用户</th>
      <th class="pl-col-src2">来源</th>
      <th class="pl-col-msg">最近内容</th>
      <th class="pl-col-time">时间</th>
      <th class="pl-col-act">操作</th>
      <th class="pl-col-x"></th>
    </tr></thead>`
    : `<thead><tr>
      <th class="pl-col-sel"><input type="checkbox" id="plHeaderSelectAll" class="pl-sel-all" title="全选本页" style="accent-color:#7c3aed;"></th>
      <th class="pl-col-user">用户</th>
      <th class="pl-col-src">来源</th>
      <th class="pl-col-state">状态</th>
      <th class="pl-col-msg">最近 / 来源内容</th>
      <th class="pl-col-act">操作</th>
      <th class="pl-col-x"></th>
    </tr></thead>`;
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  container.appendChild(table);

  // 行
  pageList.forEach(p => {
    const s = _plGetStage(p);
    const pf = p.profile || {};
    const tagsHtml = (Array.isArray(pf.tags) && pf.tags.length ? pf.tags.map(esc).join(' · ') : '');
    const idHtml = p.userId ? `ID:${esc(p.userId)}` : '';
    const nickMeta = [tagsHtml && ('标签:' + tagsHtml), idHtml, p.keywordHit].filter(Boolean).join(' · ');
    // ★ 私信受限标记（对方隐私设置/未关注，暂时无法私信）
    const blockedHtml = p.dmBlocked
      ? `<div class="pl-id-blocked">⛔ 私信受限：对方隐私设置或未关注，暂无法私信 — 可在评论区破冰，或关注后待通过再试。${esc(p.dmBlockedAt ? new Date(p.dmBlockedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '')}</div>`
      : '';
    const isBlocked = !!p.dmBlocked;
    const srcComment = ((p.source && p.source.comment) || '').slice(0, 80);
    const srcNote = ((p.source && p.source.noteTitle) || '').slice(0, 40);
    // 评论跟进的历史对话（我们自己回复过+对方的发言），供查看"之前跟他说过啥"
    const chatHistory = (Array.isArray(p.chatHistory) && p.chatHistory.length) ? p.chatHistory : null;
    const chatHistoryHtml = chatHistory
      ? `<details class="pl-chat">
          <summary>💬 历史对话（${chatHistory.length} 条）▸</summary>
          <div class="pl-chat-body">${chatHistory.map(function (h) {
            const who = h.role === 'assistant' ? '<b style="color:#059669;">我</b>' : '<b style="color:#2563eb;">对方</b>';
            return `<div class="pl-chat-line">${who}：${esc(String(h.content || '').slice(0, 120))}</div>`;
          }).join('')}</div>
        </details>`
      : '';

    // 层内"状态/下一步"下拉（v2：所有行都显示漏斗状态，方便给手动回应过的人打标；已废弃也是状态之一）
    let statusSel = '';
    // 消息桶记录必然已联系（最低已触达）→ 状态下拉不提供「待触达」
    const stList = (isMsgView ? PL_STATUS_ALL.filter(s => s !== '待触达') : PL_STATUS_ALL.slice());
    let _curStatus = _personStatus(p);
    if (!stList.includes(_curStatus)) _curStatus = '待触达';
    // ★ 有消息往来的人在简介中不应显示为"未接触/待触达"
    if ((_curStatus === '待触达' || _curStatus === '' || _curStatus === '未接触') && _hasMsgSibling(p)) _curStatus = '已触达';
    statusSel = `<select class="pl-status" data-plid="${p.id}" data-kind="status" title="漏斗状态：手动回应对应的人可改成 谈单中/已成交/已废弃 等">${stList.map(st => `<option value="${esc(st)}" ${st === _curStatus ? 'selected' : ''}>${esc(st)}</option>`).join('')}</select>`;
    // 产品相关"只读"徽章（🟢相关/⚪无关；想看判定或手动改 → 打开画像弹窗把"意图"设成 高/中/低）
    // 单条动作：一律「联系TA」＝打开私信弹窗自己写（去卖/触达合并，不再区分）
    let actions = `<button class="act send" data-plid="${p.id}" data-action="dm" title="联系TA：打开私信自己写话术，可用「优化话术」">💬 联系TA</button>`;
    // 底部动作（普通视图：状态/联系TA + 主页；已废弃视图：恢复 + 彻底删）
    let foot;
    if (_plShowDiscarded) {
      foot = `<span style="font-size:11px;color:#888;">已废弃 · 想恢复请在状态下拉自己改</span>` +
             `<button class="act send" data-plid="${p.id}" data-action="purge" title="彻底删除（不可恢复）" style="border:1px solid #dc2626;background:#fee2e2;color:#b91c1c;">🗑 彻底删</button>`;
    } else {
      foot = `${statusSel}${actions}` +
             `<button class="pl-home" data-plid="${p.id}" data-action="locate" title="打开该用户主页">📎</button>`;
    }

    // 最近/来源内容（表格中间列）：消息桶→"最后一句话谁·说了什么·何时"；通知→评论/来源笔记
    const _lastWho = (p.lastFrom === 'them' || p.inbound || p.themReplied || p.direction === 'inbound') ? '对方' : ((p.lastFrom === 'me' || p.direction === 'outbound') ? '我方' : '');
    const _lastTime = (() => {
      const t = (p.lastConvFp && p.lastConvFp.at) || p.lastDmAt || p.updatedAt;
      if (t === undefined || t === null || t === '') return '';
      try {
        const d = new Date(t);
        if (!isNaN(+d)) { const now = new Date(); if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); return (d.getMonth() + 1) + '-' + d.getDate(); }
      } catch (_) {}
      // 拿不到时间戳 → 回显原始时间串（如 08-17）
      return (p.lastConvFp && p.lastConvFp.at) ? String(p.lastConvFp.at) : '';
    })();
    const _lastTxt = String(p.lastMsg || '').slice(0, 40);
    // 收发列：我方(绿)/对方(蓝)
    const whoHtml = _lastWho ? `<span style="font-weight:600;color:${_lastWho === '我方' ? '#059669' : '#2563eb'};">${_lastWho}</span>` : '';
    // 时间列：正规 yyyy-MM-dd HH:mm
    const timeVal = fmtDateTime((p.lastConvFp && p.lastConvFp.at) || p.lastDmAt || p.updatedAt);
    const draftHtml = p.dmDraft ? `<span title="${esc(p.dmDraft)}" style="display:block;color:#7c3aed;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">💬话术：${esc((p.dmDraft || '').slice(0, 40))}${(p.dmDraft || '').length > 40 ? '…' : ''}</span>` : '';
    // 消息视图：最近消息列只放文本（收发/时间已拆到各自列）
    const msgTextCell = `<span title="${esc(p.lastMsg || '')}" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📨 ${esc(_lastTxt || '对方私信了你，尽快回复')}</span>${draftHtml}`;
    // 非消息视图：最近/来源内容列（评论 / 笔记标题 + 话术）
    const msgCell = (srcComment
      ? `<span title="${esc(srcComment)}" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📝 ${esc(srcComment)}</span>`
      : (srcNote
        ? `<span title="${esc(srcNote)}" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📕 ${esc(srcNote)}</span>`
        : '<span style="color:#c0c4cc;">—</span>')) + draftHtml;
    const userCell = `<span class="pl-nick">${esc(p.nickname || '未知用户')}${p.unread ? ' <b style="color:#dc2626;">●</b>' : ''}</span>${isBlocked ? '<span class="pl-badge" style="background:#fef2f2;color:#b91c1c;">⛔受限</span>' : ''}${((p.profileGate && (p.profileGate.verdict === 'low' || p.profileGate.verdict === 'none')) ? `<span class="pl-badge" style="background:#fefce8;color:#a16207;" title="主页甄别：${esc(p.profileGate.reason || (p.profileGate.verdict === 'none' ? '看不出购买意向' : '购买意向偏弱'))}">低意向·暂不触达</span>` : '')}${(p.nTimeStr ? `<span style="font-size:10px;color:#9ca3af;margin-left:2px;">🕐${esc(p.nTimeStr)}</span>` : '')}${nickMeta ? `<div class="pl-nickmeta">${nickMeta}</div>` : ''}`;
    const selCell = `<input type="checkbox" class="pl-sel" data-plid="${p.id}" ${_selectedIds.has(p.id) ? 'checked' : ''} title="勾选后可在列表底部批量删除">`;

    const tr = document.createElement('tr');
    tr.className = 'pl-row';
    tr.dataset.plid = p.id;
    if (isMsgView) {
      tr.innerHTML = `
      <td class="pl-col-sel">${selCell}</td>
      <td class="pl-col-user">${userCell}</td>
      <td class="pl-col-who">${whoHtml}</td>
      <td class="pl-col-msg">${msgTextCell}</td>
      <td class="pl-col-time">${timeVal}</td>
      <td class="pl-col-act"><div class="pl-foot">${foot}</div></td>
      <td class="pl-col-x"><button class="pl-toggle" data-plid="${p.id}" title="展开详情">▸</button></td>`;
    } else if (isNotifView) {
      const nContent = _notifContent(p) + draftHtml;
      tr.innerHTML = `
      <td class="pl-col-sel">${selCell}</td>
      <td class="pl-col-user">${userCell}</td>
      <td class="pl-col-src2">${_channelsBadge(p)}</td>
      <td class="pl-col-msg">${nContent}</td>
      <td class="pl-col-time">${_channelTimeVal(p)}</td>
      <td class="pl-col-act"><div class="pl-foot">${foot}</div></td>
      <td class="pl-col-x"><button class="pl-toggle" data-plid="${p.id}" title="展开详情">▸</button></td>`;
    } else {
      tr.innerHTML = `
      <td class="pl-col-sel">${selCell}</td>
      <td class="pl-col-user">${userCell}</td>
      <td class="pl-col-src">${_plEntryBadge(p)}</td>
      <td class="pl-col-state"><span class="pl-badge" style="background:#eef2ff;color:${_plStatusColor(_curStatus)};">${esc(_curStatus)}</span></td>
      <td class="pl-col-msg">${msgCell}</td>
      <td class="pl-col-act"><div class="pl-foot">${foot}</div></td>
      <td class="pl-col-x"><button class="pl-toggle" data-plid="${p.id}" title="展开详情">▸</button></td>`;
    }
    tbody.appendChild(tr);

    // 详情行（默认收起；包含画像/历史对话/回复建议）
    const detail = document.createElement('tr');
    detail.className = 'pl-detail pl-row-detail';
    detail.dataset.plid = p.id;
    detail.style.display = 'none';
    detail.innerHTML = `<td colspan="7" style="padding:8px 12px;">
      ${blockedHtml}
      <div class="pl-hint">${_plNextHint(p)}</div>
      ${p.dmDraft ? `<div class="pl-source" style="color:#7c3aed;">💬 触达话术：${esc(p.dmDraft)}</div>` : ''}
      ${srcComment ? `<div class="pl-source">📝 评论：${esc(srcComment)}</div>` : ''}
      ${srcNote ? `<div class="pl-source">📕 来源：${esc(srcNote)}</div>` : ''}
      ${chatHistoryHtml}
      ${(s === 'prospect' && pf.intentLevel) ? `<textarea class="pl-reply-text" data-plid="${p.id}" placeholder="回复建议（自动生成，可修改）..." style="width:100%;min-width:560px;">${esc((p.replySuggest || '').trim())}</textarea>` : ''}
    </td>`;
    tbody.appendChild(detail);
  });
  // ★ 自动生成回复（默认给每个未生成过的卡片填充，串行避免并发打爆）
  {
    const needGen = [];
    container.querySelectorAll('.pl-reply-text').forEach(ta => {
      const person = list.find(p => p.id === ta.dataset.plid);
      if (person && person.stage === 'prospect' && person.profile && !(person.replySuggest || '').trim()) needGen.push(ta.dataset.plid);
    });
    if (needGen.length) {
      let chain = Promise.resolve();
      let done = 0;
      needGen.forEach(id => {
        chain = chain.then(async () => {
          const ta = container.querySelector(`.pl-reply-text[data-plid="${id}"]`);
          const person = list.find(p => p.id === id);
          if (!ta || !person || (person.replySuggest || '').trim()) return;
          try {
            const text = await generateDmText(person);
            if (ta) ta.value = text;
            person.replySuggest = text;
            try { await chrome.runtime.sendMessage({ action: 'updateProspect', data: { id, updates: { replySuggest: text } } }); } catch (_) {}
            done++;
            if (done === 1 || done % 10 === 0) addLog(`🤖 已自动生成 ${done}/${needGen.length} 条回复建议`, 'info');
          } catch (_) {}
        });
      });
    }
  }

  // ── 层内"状态/下一步"下拉（写入 v2 子状态；写 closed 自动升客户池）──
  container.querySelectorAll('.pl-status').forEach(sel => {
    sel.addEventListener('change', async () => {
      const id = sel.dataset.plid;
      const v = sel.value || '';
      const kind = sel.dataset.kind || 'status'; // status
      const person = list.find(p => p.id === id);
      if (!person) return;
      try {
        const updates = { status: v };
        const ids = [id, ..._samePersonIds(person)]; // 同人其余渠道/跨桶记录一并同步
        for (const sid of ids) {
          await chrome.runtime.sendMessage({ action: 'updateProspect', data: { id: sid, updates } }).catch(() => {});
        }
        addLog(`✅ ${person.nickname} 商机状态 → ${v}` + (ids.length > 1 ? `（已同步 ${ids.length} 条渠道记录）` : ''), 'success');
        loadProspectList(container);
      } catch (e) {
        addLog(`❌ 更新状态失败：${e.message}`, 'error');
      }
    });
  });
  // ── 层内动作 + 底部动作（主页/移除） ──
  container.querySelectorAll('.pl-foot button').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.plid;
      const action = btn.dataset.action;
      const person = list.find(p => p.id === id);
      if (!person) return;
      if (action === 'locate') {
        btn.disabled = true; const _o = btn.textContent; btn.textContent = '⏳...';
        addLog(`📎 打开主页：${person.nickname}`, 'info');
        try {
          const r = await chrome.runtime.sendMessage({ action: 'enrichProspectByProfile', data: { person } });
          if (r && r.ok && r.xhsId) addLog(`✅ 已打开并抓取 ${r.name || person.nickname} · 小红书号:${r.xhsId}`, 'success');
          else if (r && r.ok) addLog(`✅ 已打开用户主页：${person.nickname}`, 'success');
          else addLog(`⚠️ ${(r && r.error) || '未完成'}`, 'warn');
          loadProspectList(container);
        } catch (e) { addLog(`❌ 打开主页失败：${e.message}`, 'error'); }
        btn.disabled = false; btn.textContent = _o; return;
      }
      else if (action === 'restore') {
        try {
          // 恢复 = 把「已废弃」状态改回「待触达」（废弃已并入状态体系）
          await chrome.runtime.sendMessage({ action: 'updateProspect', data: { id, updates: { status: '待触达', discarded: false } } });
          addLog(`↩️ 已恢复：${person.nickname}`, 'success');
        } catch (e) { addLog(`❌ 恢复失败：${e.message}`, 'error'); }
        loadProspectList(container); return;
      }
      else if (action === 'purge') {
        if (!window.confirm(`⚠️ 确认彻底删除 ${person.nickname}？该记录不可恢复！`)) return;
        await chrome.runtime.sendMessage({ action: 'deleteProspect', data: { id, hard: true } });
        addLog(`🗑️ 已彻底删除：${person.nickname}`, 'info');
        loadProspectList(container); return;
      }
      else if (action === 'remove') {
        if (!window.confirm(`确认将 ${person.nickname} 标废（移出清单，可在「🗑 已废弃」恢复）？`)) return;
        await chrome.runtime.sendMessage({ action: 'deleteProspect', data: { id } });
        addLog(`🗑️ 已标废：${person.nickname}`, 'info');
        loadProspectList(container); return;
      }
      else if (action === 'reply') {
        // 有会话 / 或领一个会话：先"逐条归因"该客户是否回过你 → 是则升商机(已回复)，否则标已触达·待回复；都在 /chat 里打开
        const convId = person.convId || '';
        const btnO = btn.textContent; btn.disabled = true; btn.textContent = '⏳ 判定…';
        if (convId) {
          try {
            const r = await chrome.runtime.sendMessage({ action: 'scanChatReply', data: { convId, personId: person.id, nickname: person.nickname } });
            if (r && r.ok) {
              if (r.promoted) addLog(`🎯 ${person.nickname}：对方回过你 → 已升级为商机（已回复）`, 'success');
              else addLog(r.theirs ? `💬 ${person.nickname}：对方回过你（商机池）` : `💬 ${person.nickname}：暂无对方回复，标「已触达·待回复」`, r.theirs ? 'success' : 'warn');
            } else addLog(`❌ 判定失败：${(r && r.error) || '未知'}`, 'error');
          } catch (e) { addLog('❌ 判定失败：' + e.message, 'error'); }
        } else {
          addLog('⚠️ 暂无会话，改为私信触达', 'warn');
          openDmModal(person);
          touchScenePrefill(person);
        }
        btn.disabled = false; btn.textContent = btnO;
        loadProspectList(container); return;
      }
      else if (action === 'profile') { runProfileOne([person], container); return; }
      else if (action === 'dm') {
        // 联系TA = 打开私信弹窗，直接自己写话术发；打开即自动填入已生成的 AI 话术（无则自动生成）
        //   同时把该人所有渠道记录的"待触达"置为"已触达"（状态跨渠道同步）
        openDmModal(person);
        if (!person.status || person.status === '待触达') {
          const ids = [id, ..._samePersonIds(person)];
          await Promise.all(ids.map(sid => chrome.runtime.sendMessage({ action: 'updateProspect', data: { id: sid, updates: { status: '已触达' } } }).catch(() => {})));
          if (container) loadProspectList(container);
        }
        return;
      }
      else if (action === 'maint') {
        // 成交维护话术：按 after_sale 场景生成 → 开私信弹窗填入
        btn.disabled = true; const _o2 = btn.textContent; btn.textContent = '⏳…';
        try {
          const r = await chrome.runtime.sendMessage({ action: 'aiCsTouch', data: { key: 'after_sale', person } });
          openDmModal(person);
          const dt = document.getElementById('dmText'); if (dt) dt.value = (r && r.ok && r.draft) || '';
          if (r && r.ok) addLog(`📣 已按「成交维护」生成 ${person.nickname} 的话术`, 'success');
        } catch (e) { addLog('❌ 维护话术生成失败：' + e.message, 'error'); }
        btn.disabled = false; btn.textContent = _o2;
        return;
      }
      else if (action === 'close') {
        // 成交在商机状态上作标注（不单独建客户层）
        await chrome.runtime.sendMessage({ action: 'updateProspect', data: { id, updates: { status: '已成交', funnel: Object.assign({}, _plFunnel(person), { step: 'closed' }) } } });
        addLog(`💰 ${person.nickname} 已成交标注（成交一般走线下/微信）`, 'success');
        loadProspectList(container); return;
      }
      else if (action === 'promote') {
        // AI 判断：适合的线索 → 标「高意向·待跟单」置顶（不升商机；商机=对方真回复，见 _isTwoWay）
        const _o = btn.textContent; btn.disabled = true; btn.textContent = '🧠 判断中…';
        try {
          const r = await chrome.runtime.sendMessage({ action: 'judgeLeadPromotion', data: { id } });
          if (r && r.ok) {
            if (r.promote) {
              await chrome.runtime.sendMessage({ action: 'updateProspect', data: { id, updates: { intentLevel: 'high', affinity: Object.assign({}, person.affinity || {}, { intentLevel: 'high' }) } } });
              addLog(`🧠 AI 判断高意向 → 已将 ${person.nickname} 置顶为「高意向·待跟单」（${r.reason || ''}）`, 'success');
            } else {
              addLog(`⏸ AI 判断暂不适合跟进：${r.reason || '需求不强'}（留在线索池，可稍后再判）`, 'warn');
            }
          } else {
            throw new Error((r && r.error) || 'AI 判断失败');
          }
        } catch (e) {
          addLog('❌ 升格判断失败：' + e.message, 'error');
        }
        btn.disabled = false; btn.textContent = _o;
        loadProspectList(container); return;
      }
    });
  });
  // ── 多选：勾选待删除；表头复选框=全选本页 ──
  const _syncHeaderSel = () => {
    const hdr = container.querySelector('#plHeaderSelectAll');
    const cbs = container.querySelectorAll('.pl-sel');
    let on = 0; cbs.forEach(cb => { if (cb.checked) on++; });
    if (hdr) { hdr.checked = cbs.length > 0 && on === cbs.length; hdr.indeterminate = on > 0 && on < cbs.length; }
  };
  const _selCountUI = () => {
    const d = document.getElementById('plBatchStatus');
    if (d && d.options.length) d.options[0].text = '批量改状态(' + _selectedIds.size + ')…';
    _syncHeaderSel();
  };
  const hdrSel = container.querySelector('#plHeaderSelectAll');
  if (hdrSel) hdrSel.addEventListener('change', () => {
    const on = hdrSel.checked;
    container.querySelectorAll('.pl-sel').forEach(cb => { cb.checked = on; });
    _selectedIds.clear();
    if (on) container.querySelectorAll('.pl-sel').forEach(cb => { if (cb.dataset.plid) _selectedIds.add(cb.dataset.plid); });
    _selCountUI();
  });
  container.querySelectorAll('.pl-sel').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.plid;
      if (cb.checked) _selectedIds.add(id); else _selectedIds.delete(id);
      _selCountUI();
    });
  });
  _syncHeaderSel();
  // ── 表格行：展开/收起详情 ──
  const _toggleDetail = (plid) => {
    const d = container.querySelector(`.pl-detail[data-plid="${plid}"]`);
    const t = container.querySelector(`.pl-toggle[data-plid="${plid}"]`);
    if (!d) return;
    const show = d.style.display === 'none';
    d.style.display = show ? '' : 'none';
    if (t) t.textContent = show ? '▾' : '▸';
  };
  container.querySelectorAll('.pl-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); _toggleDetail(btn.dataset.plid); });
  });
  container.querySelectorAll('tr.pl-row').forEach(tr => {
    tr.addEventListener('click', (ev) => {
      if (ev.target.closest('button,select,input')) return;
      _toggleDetail(tr.dataset.plid);
    });
  });

  // ── 复制回复 ──
  container.querySelectorAll('.copy-inline').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.plid;
      const ta = container.querySelector(`.pl-reply-text[data-plid="${id}"]`);
      if (!ta || !ta.value) return;
      try {
        await navigator.clipboard.writeText(ta.value);
        btn.textContent = '✅ 已复制'; setTimeout(() => { btn.textContent = '📋 复制'; }, 1200);
      } catch (_) { ta.select(); document.execCommand('copy'); btn.textContent = '✅ 已复制'; setTimeout(() => { btn.textContent = '📋 复制'; }, 1200); }
    });
  });
  // 分页控制
  const pageNav = document.createElement('div');
  pageNav.className = 'pl-page';
  pageNav.innerHTML = `
    <button id="plPrev" ${_plPage === 0 ? 'disabled' : ''}>‹ 上一页</button>
    <span>第 ${_plPage + 1} / ${pageCount} 页 · 共 ${total} 人</span>
    <button id="plNext" ${_plPage >= pageCount - 1 ? 'disabled' : ''}>下一页 ›</button>`;
  container.appendChild(pageNav);
  pageNav.querySelector('#plPrev').addEventListener('click', () => { _plPage--; renderProspectList(container); });
  pageNav.querySelector('#plNext').addEventListener('click', () => { _plPage++; renderProspectList(container); });

  // ── 消息桶：⚪ 我方触达 折叠分组（默认收起，点开查看/去卖） ──
  if (_plStage === 'msg' && outList.length) {
    const sec = document.createElement('div');
    sec.className = 'pl-batch';
    const h = document.createElement('button');
    h.textContent = (_outboundCollapsed ? '▸' : '▾') + ' 我方触达（' + outList.length + '，默认收起的运营会话）';
    h.style.cssText = 'width:100%;text-align:left;font-size:12px;padding:6px 8px;border:1px solid var(--line);background:#f9fafb;color:#6b7280;border-radius:8px;cursor:pointer;font-weight:600;';
    h.addEventListener('click', () => { _outboundCollapsed = !_outboundCollapsed; renderProspectList(container); });
    sec.appendChild(h);
    if (!_outboundCollapsed) {
      outList.slice(0, 60).forEach(p => {
        const row = document.createElement('div');
        row.className = 'pl-card';
        const _s = _plStateOf(p, 'msg'); const _m = PL_STATE_META[_s] || PL_STATE_META.other;
        row.innerHTML =
          `<div class="pl-card-top"><span class="pl-nick">⚪ ${esc(p.nickname || '未知')}</span><span class="pl-badge" style="background:${_m.bg};color:${_m.c};">${_m.t}</span></div>` +
          `<div class="pl-source">📨 ${esc((p.lastMsg || '').slice(0, 60))}</div>` +
          `<div class="pl-foot"><button class="act send" data-plid="${p.id}" title="打开 /chat 会话开始卖">💬 去卖</button></div>`;
        const btn = row.querySelector('[data-plid]');
        btn.addEventListener('click', () => {
          const cid = p.convId || '';
          if (!cid) { addLog('⚠️ 无会话，请先从通知桶触达', 'warn'); return; }
          addLog(`💬 打开 ${p.nickname || '对方'} 的会话（去卖）`, 'info');
          chrome.runtime.sendMessage({ action: 'openChat', data: { convId: cid, personId: p.id } }).then(r => {
            if (r && r.ok) addLog('✅ 已打开会话', 'success'); else addLog('❌ 打开失败：' + ((r && r.error) || '未知'), 'error');
          }).catch(e => addLog('❌ 打开会话失败：' + e.message, 'error'));
        });
        container.appendChild(row);
      });
    }
    container.appendChild(sec);
  }

  }

// 刷新通知：只刷小红书通知（评论/@）数据，不再顺带刷消息 / 不跳页
async function _refreshCurrentTab(container) {
  const ok = await syncNotifToLeads(container);   // 只刷通知数据（含冷却：太频繁会跳过）
  if (!ok) return;
  await genMissingDrafts(container, false);       // 补生成没话术的
  if (container) loadProspectList(container);
}
async function syncNotifToLeads(container, opts) {
  const b = document.getElementById('plNotifRefresh') || document.getElementById('plSyncNotif');
  const bReset = document.getElementById('plNotifRefresh') ? '🔄 刷新通知' : '🔄 增量刷新通知';
  if (window.__lastNotifSyncAt && (Date.now() - window.__lastNotifSyncAt < 20000)) {
    const sec = Math.ceil((20000 - (Date.now() - window.__lastNotifSyncAt)) / 1000);
    addLog(`⏳ 刷新太频繁，请等 ${sec}s 再试`, 'warn');
    return false;
  }
  window.__lastNotifSyncAt = Date.now();
  if (_syncInFlight) return false;
  _syncInFlight = true;
  if (b) { b.disabled = true; b.textContent = '⏳ 刷新中…'; }
  // AI 打"是否产品相关"标记：配置了 AI 就走标记（不剔除任何人）；未配 AI 则仅全量收录
  const screen = true;
  addLog('🔄 增量刷新通知（前3屏）...', 'info');
  try {
    const r = await chrome.runtime.sendMessage({ action: 'collectLikersFromNotif', data: { screen, cap: NOTIF_SYNC_CAP } });
    if (r && r.ok) {
      const it = r.intents || {};
      const extra = [];
      if (it.high) extra.push('高' + it.high);
      if (it.medium) extra.push('中' + it.medium);
      if (it.low) extra.push('低' + it.low);
      const intendText = (screen && extra.length) ? '　意向：' + extra.join('/') : '';
      const capText = r.capped ? `　（另有 ${r.capped} 条超出上限，下轮再处理）` : '';
      const tabs = r.tabCounts || {};
      const tabText = (Object.keys(tabs).length) ? '　分工：' + ['评论和@', '新增关注', '赞和收藏'].filter(t => tabs[t] !== undefined).map(t => `${t}:${tabs[t]}`).join(' / ') : '';
      const aiTxt = screen
        ? ((r.aiError) ? ` ⚠️AI失败(${r.aiError})` : (r.screened ? ` · AI已标记 ${r.screened}（相关${it.high || 0}/中${it.medium || 0}/无关${it.low || 0}）` : ' · 未配AI或无需标记'))
        : '';
      addLog(`🔔 刷新通知：新增 ${r.added} · 已存在 ${r.already}` + tabText + capText + aiTxt, r.aiError ? 'warn' : 'success');
    } else {
      const err = (r && r.error) || '未知错误';
      addLog('❌ 刷新通知失败：' + err, 'error');
      if (b) window.alert('刷新通知失败：' + err + '\n\n请确保已登录小红书网页版并打开过通知页面。');
    }
    if (container) loadProspectList(container);
  } catch (e) {
    addLog('❌ 刷新通知失败：' + e.message, 'error');
    if (b) window.alert('刷新通知失败：' + e.message + '\n\n请先打开小红书网页版并登录。');
    if (container) loadProspectList(container);
  }
  _syncInFlight = false;
  if (b) { b.disabled = false; b.textContent = bReset; }
  return true;
}

// 刷新消息：拉 /chat 会话，AI 筛掉刷号玩/无关，相关的自动收进消息桶（未读标红）
async function syncChatInbound(container) {
  const b = document.getElementById('plSyncInbound');
  if (b) { b.disabled = true; b.textContent = '⏳ 刷新消息…'; }
  addLog('🔄 刷新消息（全量收录，不筛选）：读取 /chat 会话...', 'info');
  try {
    const r = await chrome.runtime.sendMessage({ action: 'syncChatInbound', data: { screen: false, full: true } });
    if (r && r.ok) {
      const ignTxt = (r.added > 0 || r.updated > 0 ? ' · 全量收录 ' + r.total + ' 条' : ' · 无可新增');
      addLog(`📨 刷新消息：新增 ${r.added} · 更新 ${r.updated} · 未读 ${r.unread}${ignTxt}`, r.unread > 0 ? 'warn' : 'success');
      if (container) {
        await loadProspectList(container); // 刷新桶视图（消息桶已持久化，直接列出）
      }
    } else {
      const err = (r && r.error) || '未知错误';
      addLog('❌ 刷新消息失败：' + err, 'error');
      if (b) window.alert('刷新消息失败：' + err + '\n\n请确认已登录小红书网页版并打开过消息中心。');
      if (container) loadProspectList(container);
    }
  } catch (e) {
    addLog('❌ 刷新消息失败：' + e.message, 'error');
    if (container) loadProspectList(container);
  }
  if (b) { b.disabled = false; b.textContent = '🔄 刷新消息'; }
}

