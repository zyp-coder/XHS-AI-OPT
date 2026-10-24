/* 服务器 · 排期到点自动下单（v10 · 2026-10-14 · §8.2 #6 收尾）
 *
 * 一句话：以前是「网页手点才下单」；这个模块让服务器自己看表——发布队列到点 / 队列整条
 * 每周自动跑 / 日常浏览每天自动跑——到点把单派给在线执行器，走的是与手点同一条
 * placeOrder / 回执 / 流水链（碰平台的活依旧只在客户浏览器里跑，服务器只递纸条）。
 *
 * 口径与执行器内核**同源镜像**（不是新发明的规矩）：
 *   发布队列到点 ── 镜像 extension/background.js 的 _npPubBgRows/_npPubBgSlotDay/_npPubBgDueAt
 *                   （队列表位子 × 时间表；没定时间＝12:00；过去的日子不滚出来）
 *   每周自动跑  ── 镜像 background.js 的 _queueAutoOn（enabled + 星期 + 时段；起==止＝全天）
 *   每天自动跑  ── 镜像 extension/lib/daily-browse.js 的 autorunOn（开关 + 时段；起==止＝全天）
 *
 * 硬规矩（与产品口径一致，别在这放松）：
 *   · 静默期（21:00–09:00，服务器本地钟）不派任何单——到点撞静默的发布行顺延，第二天再看；
 *   · 熔断中不派（对账照做——早派出去的单回执得收）；
 *   · 档位不足 / 没挂线由 placeOrder 拦（这里只管"到没到点、该不该派"）；
 *   · 同一只账号同一时刻只推进一条单（有在飞的就先排队，回执到了再派下一条）；
 *   · 🛡 行为层的闸在执行器那侧照常生效——排期单撞上执行器本地墙（静默/单休/起床）
 *     会回执「顺延」，这里老老实实记「今天不再试」，不绕着墙硬发。
 *
 * 账（挂账本根上，META 层）：store.exec_sched
 *   np[accId][`${lineKey}|${dateStr}`] = { state:'sent'|'retry'|'done'|'nofile'|'prep', attempts, at, cmdId, why }
 *   auto[accId] = { d:'YYYY-MM-DD', rounds:n, lastAt, cmdId }
 *   发布行试够了（3 次）或已成定论＝done（当天不再动）；retry＝等 5 分钟再来；nofile＝缺料（补齐即接着发）。
 */
const TICK_MS = 60000;            // 每 60 秒看一次表
const QUIET_FROM = 21, QUIET_TO = 9;   // 静默期（服务器本地钟）：21:00–09:00 不派单
const NP_TRIES = 3;               // 发布行一天最多自动试几回（镜像内核 NP_PUB_BG_MAX_TRIES）
const NP_RETRY_MIN = 5;           // 试败了隔几分钟再来（镜像 NP_PUB_BG_RETRY_MIN）
const AUTO_GAP_MIN = 120;         // 队列自动跑：两趟之间至少隔 2 小时（逼近内核"驻留到下一项到点"）
const AUTO_CAP = 6;               // 队列自动跑：一天最多几趟（帽）
const STALE_MS = 6 * 3600000;     // 派出去 6 小时没回执 ＝ 当没派成（机器关了/崩了）
const PRUNE_DAYS = 14;            // 排期账保留天数（镜像 np_pub_ran 的 14 天）

const stamp = () => new Date().toISOString().replace('T', ' ').slice(11, 19);
const pad2 = (n) => String(n).padStart(2, '0');
const dateStr = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const clone = (v) => JSON.parse(JSON.stringify(v));

/* ── 时段口径（镜像 extension/lib/daily-browse.js 的 inWindow/_hm）── */
function toMin(s) {
  const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return (parseInt(m[1], 10) % 24) * 60 + Math.min(59, parseInt(m[2], 10));
}
/* 现在在不在 [from,to) 里；支持跨零点（20:00–01:00）；非法/起止相同 → 不在 */
function inClock(from, to, nowMs) {
  const x = toMin(from), y = toMin(to);
  if (x == null || y == null || x === y) return false;
  const d = new Date(nowMs || Date.now());
  const cur = d.getHours() * 60 + d.getMinutes();
  if (x < y) return cur >= x && cur < y;
  return cur >= x || cur < y;   // 跨零点
}
/* 队列整条「每周自动跑」（镜像 background.js _queueAutoOn：enabled + 星期 + 时段；起==止＝全天） */
function qWinOn(qAuto, nowMs) {
  const a = (qAuto && typeof qAuto === 'object') ? qAuto : {};
  if (!a.enabled) return false;
  const d = new Date(nowMs || Date.now());
  const days = Array.isArray(a.days) ? a.days.map(Number) : [];
  if (days.length && days.indexOf(d.getDay()) < 0) return false;
  const from = String(a.from || '').trim(), to = String(a.to || '').trim();
  if (!/^\d{1,2}:\d{2}$/.test(from) || !/^\d{1,2}:\d{2}$/.test(to)) return false;
  if (from === to) return true;
  return inClock(from, to, nowMs);
}
/* 日常浏览「每天自动跑」（镜像 lib/daily-browse.js autorunOn：开关 + 时段；起==止＝全天） */
function dbWinOn(cfgIn, nowMs) {
  const cfg = (cfgIn && typeof cfgIn === 'object') ? cfgIn : {};
  const a = (cfg.autorun && typeof cfg.autorun === 'object') ? cfg.autorun : {};
  if (!cfg.enabled || !a.enabled) return false;
  const from = String(a.from || ''), to = String(a.to || '');
  if (from && from === to) return true;
  return inClock(from, to, nowMs);
}
/* 静默期（服务器本地钟 21:00–09:00）——产品硬规矩，排期不绕 */
function inQuiet(nowMs) {
  const h = new Date(nowMs || Date.now()).getHours();
  return h >= QUIET_FROM || h < QUIET_TO;
}

/* ── 发布队列口径（镜像 background.js _npPubBgSlotParse/_npPubBgSlotDay/_npPubBgDueAt/_npPubBgRows）── */
const DAY_IDX = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 };
function slotParse(slotKey) {
  const m = String(slotKey || '').match(/^w(\d+):(\w+):(.+)$/);
  return m ? { w: Number(m[1]), day: m[2], kind: m[3] } : null;
}
function slotDay(w, day, now) {
  if (!(day in DAY_IDX)) return null;
  const tIdx = now.getDay();
  const nextMon = (((1 - tIdx + 7) % 7) || 7);
  let off;
  if (w === 1) { off = DAY_IDX[day] - tIdx; if (off < 0) return null; }   // 过去了的日子不滚出来
  else off = nextMon + ((DAY_IDX[day] + 6) % 7) + (w - 2) * 7;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + off);
  d.setHours(0, 0, 0, 0);
  return d;
}
function dueAt(day, hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  const hh = m ? Math.min(23, Number(m[1])) : 12;   // 没定＝12:00（与 popup 展示同口径）
  const mm = m ? Math.min(59, Number(m[2])) : 0;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm, 0, 0).getTime();
}
function npRows(bag, now) {
  const q = (bag.note_queue && typeof bag.note_queue === 'object') ? bag.note_queue : {};
  const times = (bag.np_queue_times && typeof bag.np_queue_times === 'object') ? bag.np_queue_times : {};
  const rows = [];
  for (const slotKey of Object.keys(q)) {
    const ids = Array.isArray(q[slotKey]) ? q[slotKey] : [];
    if (!ids.length) continue;
    const p = slotParse(slotKey);
    if (!p) continue;
    const day = slotDay(p.w, p.day, now);
    if (!day) continue;
    for (const id of ids) {
      const lineKey = slotKey + '|' + String(id);
      rows.push({ slotKey, id: String(id), lineKey, dueAt: dueAt(day, times[lineKey]), dateStr: dateStr(day) });
    }
  }
  return rows;
}
/* 篇的状态（镜像背景 _npPubBgStatus）：认不得的按「草稿」——只推进「代发/待发」 */
function npStatus(note) {
  const s = String((note && note.status) || '');
  return ['草稿', '代发', '待发', '已发', '已归档'].indexOf(s) >= 0 ? s : '草稿';
}
/* 这轮接进开关/并行的两家（视频号先不接，原来的发法照旧）；按篇的形式再筛一遍 */
const PUB_ROUND = ['xhs', 'douyin'];
function npPubIsVideoForm(form) {
  const f = String(form || '');
  return f === '视频' || f === '案例成片' || f.indexOf('口播') >= 0 || f === '数字人';
}
function npPubPlatsFor(form) {
  const all = npPubIsVideoForm(form) ? ['xhs', 'douyin', 'channels'] : ['xhs', 'douyin'];
  return all.filter((p) => PUB_ROUND.indexOf(p) >= 0);
}

export function createExecSched(ctx) {
  const { store, persist, bookBagFor, placeOrder, report, online, sweepStale, platformPauseOf } = ctx;

  function ensure() {
    store.exec_sched = store.exec_sched || {};
    store.exec_sched.np = store.exec_sched.np || {};
    store.exec_sched.auto = store.exec_sched.auto || {};
  }

  /* 这只账号有没有"在飞"的单（排队中/已送达没回执；超 6 小时当没派成，不算数） */
  function activeCmdOf(accountId, now) {
    return Object.values(store.exec_cmds || {}).find((c) =>
      c.accountId === accountId && (c.state === 'queued' || c.state === 'sent')
      && (now - (c.sentAt || c.createdAt || 0)) < STALE_MS) || null;
  }

  /* ── 回执对账（熔断/静默期也照做——早派出去的单回执得收）：把 sent 落成 done/retry ──
     attempts＝真派出去几次；试败只标 retry（等 5 分钟再来），到帽才 done。 */
  function reconcile(acc, now, did) {
    const led = (store.exec_sched.np[acc.id] = store.exec_sched.np[acc.id] || {});
    let dirty = false;
    for (const k of Object.keys(led)) {
      const e = led[k];
      if (!e || e.state !== 'sent' || !e.cmdId) continue;
      const cmd = store.exec_cmds[e.cmdId];
      if (!cmd) { led[k] = { state: (e.attempts || 1) >= NP_TRIES ? 'done' : 'retry', attempts: e.attempts || 1, at: now, why: '单子找不到了' }; dirty = true; continue; }
      if (cmd.state === 'queued' || cmd.state === 'sent') {
        if ((now - (cmd.sentAt || cmd.createdAt || 0)) >= STALE_MS) {
          led[k] = { state: (e.attempts || 1) >= NP_TRIES ? 'done' : 'retry', attempts: e.attempts || 1, at: now, why: '派出去 6 小时没回执' };
          dirty = true;
        }
        continue;   // 还在飞：等它
      }
      const note = String(cmd.note || '');
      let next;
      if (cmd.state === 'done') {
        next = { state: 'done', attempts: e.attempts, at: now, why: note || '已回执' };
      } else if (/备好停在发布按钮前/.test(note)) {
        next = { state: 'done', attempts: e.attempts, at: now, why: '备好停在发布按钮前（等人点）' };   // hold 档：交到手了，当天不再动
      } else if (/顺延|静默|单休|起床|账号安全|🛡/.test(note)) {
        next = { state: 'done', attempts: e.attempts, at: now, why: '被账号安全的闸挡住（顺延）' };      // 🛡 不绕墙，今天不再试
      } else if (/作废/.test(note)) {
        /* 换机 / 解绑 / 超时（exec-channel 的 failInFlight / sweepStale 标的）——旧机器可能已经
           把这一步发出去了，只是回执没回来。**不自动重发**（防重复发到平台）：当天记 done，
           要发请手动再点一次。 */
        next = { state: 'done', attempts: e.attempts, at: now, why: '这单作废了（换机/解绑/超时）——不自动重发' };
      } else if (cmd.state === 'failed') {
        next = ((e.attempts || 1) >= NP_TRIES)
          ? { state: 'done', attempts: e.attempts, at: now, why: '试够了：' + note }
          : { state: 'retry', attempts: e.attempts, at: now, why: note };
      }
      if (next) { led[k] = next; dirty = true; did.push(`[${acc.name}] 发布回执：${next.state}${next.why ? '（' + next.why + '）' : ''}`); }
    }
    return dirty;
  }

  /* ── 发布队列到点：挨行看，到点且没结账的就派（一条账一天一套账）
     返回 {placed, dirty}：placed＝这钩真派了单（后面就别再派别的），dirty＝账动过 ── */
  async function jobNp(acc, bag, now, did) {
    const notesArr = Array.isArray(bag.np_notes) ? bag.np_notes : [];
    const notesById = {};
    for (const n of notesArr) if (n && n.id != null) notesById[String(n.id)] = n;
    const modes = (bag.np_pub_modes && typeof bag.np_pub_modes === 'object') ? bag.np_pub_modes : {};
    const srvFiles = (bag.np_srv_files && typeof bag.np_srv_files === 'object') ? bag.np_srv_files : {};
    const platsAll = (bag.np_pub_plats && typeof bag.np_pub_plats === 'object') ? bag.np_pub_plats : {};
    const switches = (bag.np_pub_switch && typeof bag.np_pub_switch === 'object') ? bag.np_pub_switch : {};
    const sentAll = (bag.np_pub_sent && typeof bag.np_pub_sent === 'object') ? bag.np_pub_sent : {};
    const led = (store.exec_sched.np[acc.id] = store.exec_sched.np[acc.id] || {});
    const pause = platformPauseOf ? platformPauseOf(acc) : {};
    let dirty = false;

    for (const r of npRows(bag, new Date(now))) {
      if (r.dueAt > now) continue;                                     // 还没到点
      const note = notesById[r.id];
      if (!note) continue;
      const st = npStatus(note);
      if (st !== '代发' && st !== '待发') continue;                     // 草稿/已发：不动
      const key = r.lineKey + '|' + r.dateStr;
      const e = led[key];
      if (e && (e.state === 'done' || e.state === 'sent')) continue;   // 今天已成定论 / 还在飞
      if (e && e.state === 'retry' && (now - (e.at || 0)) < NP_RETRY_MIN * 60000) continue;   // 试败了：歇 5 分钟

      const mode = (modes[r.lineKey] === 'auto' || modes[r.lineKey] === 'prep') ? modes[r.lineKey] : 'hold';
      if (mode === 'prep') {
        led[key] = { state: 'done', attempts: 0, at: now, why: 'prep（只备稿）档' };
        dirty = true;
        report(acc.id, `⏰ 「${note.title || r.id}」到点了，但它是「只备稿」档（prep）——备稿在网页侧走，发布台里可以改发布方式`);
        continue;
      }
      const files = Array.isArray(srvFiles[r.id]) ? srvFiles[r.id].filter((f) => f && f.id) : [];
      if (!files.length) {
        if (!(e && e.state === 'nofile')) {
          report(acc.id, `⏰ 「${note.title || r.id}」到点了，但素材还没交到服务器——打开网页把这篇的图/片重新交一次，补齐后到点自动接着发`);
          did.push(`[${acc.name}] 到点缺料：${note.title || r.id}`);
        }
        led[key] = { state: 'nofile', attempts: 0, at: now, why: '素材还没交到服务器' };
        dirty = true;
        continue;
      }

      const adapted = { title: note.title || '', body: note.draft || '', tags: [] };
      /* 这次发哪几家：每篇选好的（没记过＝按形式全发）∩ 本轮两家 ∩ 总开关，再刨掉已经发成的家
         （部分成功＝只补没成的那家，不重复打扰已发出去的那家） */
      const can = npPubPlatsFor(note.form || '图文');
      const recSel = Array.isArray(platsAll[r.lineKey]) ? platsAll[r.lineKey].filter((p) => can.indexOf(p) >= 0) : [];
      const baseSel = recSel.length ? recSel : can.slice();
      const sentRec = (sentAll[r.id] && typeof sentAll[r.id] === 'object') ? sentAll[r.id] : {};
      const platforms = baseSel
        .filter((p) => switches[p] !== false)
        .filter((p) => !(p === 'douyin' && pause[p]))   // 抖音格暂停发笔记：这一行原样等着，恢复后下一分钟接着发
        .filter((p) => !(sentRec[p] && sentRec[p].ok))
        .map((p) => ({
          platform: p,
          adapted: (note.pub && note.pub.adapted && note.pub.adapted[p]) || adapted,
        }));
      if (!platforms.length) continue;   // 两家都关了 / 都已经发成：这一行今天不派，开关一开下分钟就接上
      const params = {
        note: { id: r.id, form: note.form || '图文', title: note.title || '' },
        platform: platforms[0].platform,
        platforms,
        files: files.map((f) => ({ blobId: f.id, name: f.name || '', mime: f.mime || '' })),
        hold: mode === 'hold',
        sched: { lineKey: r.lineKey, dateStr: r.dateStr },
      };
      const res = await placeOrder(acc, 'note_publish', params, 'sched');
      if (res && res.ok) {
        led[key] = { state: 'sent', attempts: (e && e.attempts || 0) + 1, at: now, cmdId: res.cmdId };
        did.push(`[${acc.name}] ⏰ 发布到点派单：${note.title || r.id}（${platforms.map((x) => x.platform).join('+')}）`);
        return { placed: true, dirty: true };   // 一趟最多派一条：这条跑完（回执到）下一钩再派下一条
      }
      if (res && res.paused) continue;   // 刚按下的暂停：这一行不记 done，恢复后照常到点发
      led[key] = { state: 'done', attempts: 0, at: now, why: (res && res.error) || '没派出去' };
      report(acc.id, `⏰ 排期没派出去（「${note.title || r.id}」）：${(res && res.error) || '未知原因'}`);
      did.push(`[${acc.name}] 发布派单失败：${(res && res.error) || ''}`);
      dirty = true;
      return { placed: false, dirty };
    }
    return { placed: false, dirty };
  }

  /* ── 搜索链：一类跑完歇约 10 分钟，到点派下一类（2026-10-23 确认单）──
     链在 exec-channel 收到首轮回执时立下；这里只负责「到点派下一类」和几道停手闸。 */
  function chainStop(accId, kind, reason) {
    if (typeof ctx.stopChain === 'function') return ctx.stopChain(accId, kind, reason);
    const c = (store.exec_chains || {})[accId];
    if (!c || c.status === 'stopped') return false;
    c.status = 'stopped'; c.stopKind = kind || 'fail'; c.stopReason = String(reason || '');
    c.nextAt = 0; c.updatedAt = Date.now();
    return true;
  }

  async function jobChain(acc, hand, now, did) {
    const ch = (store.exec_chains || {})[acc.id];
    if (!ch) return false;

    /* 派出去的那一单回执没落到链上（单被房务作废/找不到）：兜底停手或接着往下走 */
    if (ch.status === 'running') {
      const cmd = ch.cmdId ? (store.exec_cmds || {})[ch.cmdId] : null;
      if (cmd && (cmd.state === 'queued' || cmd.state === 'sent')
        && (now - (cmd.sentAt || cmd.createdAt || 0)) < STALE_MS) return false;
      if (cmd && cmd.state === 'failed') {
        const note = String(cmd.note || '这一类没跑成');
        const kind = cmd.needLogin ? 'login' : (/🛡|账号安全|顺延|静默期|单休|起床/.test(note) ? 'guard' : 'fail');
        chainStop(acc.id, kind, note);
        did.push(`[${acc.name}] ⏹ 搜索链停手：${note}`);
        return true;
      }
      ch.status = 'waiting'; ch.nextAt = now; ch.updatedAt = now;
      return true;
    }

    if (ch.status !== 'waiting') return false;
    if (store.exec_killed) return false;   // 熔断时通道已撤链；这里兜底不派
    /* 老板暂停了小红书这头：链停在原地，不判失败、不刷日志；恢复后下一钩接着派 */
    if (platformPauseOf && platformPauseOf(acc).xhs) return false;
    if (inQuiet(now)) {
      chainStop(acc.id, 'quiet', '到了静默期（21:00–09:00），这一串活先停；明早回工作台再点「搜索」接着跑');
      did.push(`[${acc.name}] ⏹ 搜索链停在静默期（${ch.kw || ''}）`);
      return true;
    }
    if (!online(hand)) {
      if (now - ((hand && hand.lastSeen) || 0) > 24 * 3600000) {
        chainStop(acc.id, 'offline', '电脑超过 24 小时没上线，这一串活作废了；回来重新点「搜索」');
        did.push(`[${acc.name}] ⏹ 搜索链作废（断线超 24 小时）`);
        return true;
      }
      return false;   // 等它上线
    }
    if (activeCmdOf(acc.id, now)) return false;   // 手上还有活：等着
    if (!ch.nextAt || now < ch.nextAt) return false;

    const next = (ch.remain || [])[0];
    if (!next) {
      ch.status = 'done'; ch.nextAt = 0; ch.updatedAt = now;
      return true;
    }
    const nextName = (ch.remainNames || [])[0] || next;
    const res = await placeOrder(acc, 'acquire', {
      op: 'search', kw: ch.kw || undefined, profile: ch.profile || undefined, label: ch.label || undefined,
      scenario: next, force: true, snapshot: ch.snapshot || undefined,
      chainId: ch.id, seq: 'chain-' + now.toString(36),
    }, 'sched');
    if (res && res.ok) {
      ch.status = 'running';
      ch.round = next; ch.roundName = nextName;
      ch.remain = (ch.remain || []).slice(1);
      ch.remainNames = (ch.remainNames || []).slice(1);
      ch.cmdId = res.cmdId; ch.nextAt = 0; ch.updatedAt = now;
      report(acc.id, `⏰ 搜索链接着跑：下一类「${nextName}」已派给执行器（后面还有 ${ch.remain.length} 类）`);
      did.push(`[${acc.name}] ⏰ 搜索链派下一类：${nextName}`);
      return true;
    }
    const why = (res && res.error) || '没派出去';
    if (/太多|排着一条|还没挂执行器/.test(why)) return false;   // 有别的活在干：下一钩再试
    chainStop(acc.id, 'fail', '下一类没派出去：' + why);
    did.push(`[${acc.name}] ⏹ 搜索链停手：${why}`);
    return true;
  }

  /* ── 队列自动跑（获客/日常浏览同一条路）：时段开着就按时派"起机器人跑一轮" ── */
  async function jobAuto(acc, hand, bag, now, did) {
    const qWin = qWinOn(bag.drain_scan_cfg && bag.drain_scan_cfg.queueAuto, now);
    const dbWin = dbWinOn(bag.daily_browse_config, now);
    if (!qWin && !dbWin) return false;
    /* 老板暂停了小红书这头：自动跑这趟直接跳过，不动冷却/趟数，恢复后下一钩接上 */
    if (platformPauseOf && platformPauseOf(acc).xhs) return false;
    /* 搜索链还没跑完：让它先走完这几类，别让后台队列把它撤掉 */
    const ch = (store.exec_chains || {})[acc.id];
    if (ch && (ch.status === 'waiting' || ch.status === 'running')) return false;
    const rec = (store.exec_sched.auto[acc.id] = store.exec_sched.auto[acc.id] || {});
    const today = dateStr(new Date(now));
    if (rec.d !== today) { rec.d = today; rec.rounds = 0; rec.lastAt = 0; }
    if ((rec.rounds || 0) >= AUTO_CAP) return false;                     // 帽到了
    if (rec.lastAt && (now - rec.lastAt) < AUTO_GAP_MIN * 60000) return false;   // 两趟之间歇够
    if (!online(hand)) return false;                                     // 机器没在线：下一钩再看
    if (activeCmdOf(acc.id, now)) return false;                          // 有单在飞：等它跑完

    const snap = {};
    for (const k of ['drain_scan_cfg', 'auto_water_config', 'daily_browse_config', 'config']) {
      if (bag[k] !== undefined) snap[k] = clone(bag[k]);
    }
    const res = await placeOrder(acc, 'acquire', {
      snapshot: snap, scope: 'all', pace: 'interval',
      seq: 'sched-' + now.toString(36),
    }, 'sched');
    let dirty = true;
    if (res && res.ok) {
      rec.rounds = (rec.rounds || 0) + 1;
      rec.lastAt = now;
      rec.cmdId = res.cmdId;
      report(acc.id, `⏰ 排期到点自动下单：获客队列自动跑一轮（${qWin ? '每周自动跑时段' : '日常浏览时段'}）已交给执行器`);
      did.push(`[${acc.name}] ⏰ 队列自动跑派单（今天第 ${rec.rounds} 趟）`);
    } else {
      rec.lastAt = now;   // 派失败了也歇一歇，别每 60 秒撞一次
      did.push(`[${acc.name}] 队列自动跑没派出去：${(res && res.error) || ''}`);
    }
    return dirty;
  }

  /* ── 看一次表 ── */
  async function tick() {
    if (busy) return { busy: true };
    busy = true;
    ensure();
    const did = [];
    let dirty = false;
    try {
      const now = Date.now();
      /* 房务（D 期）：超时没回执的死单自动作废（换机/关机留下的）——与对账同理，熔断/静默也照做 */
      if (typeof sweepStale === 'function') { try { if (await sweepStale(now)) dirty = true; } catch (_) {} }
      for (const h of Object.values(store.exec_hands || {})) {
        const acc = store.accounts[h.accountId];
        if (!acc) continue;
        const bag = bookBagFor(acc.id);
        if (!bag || typeof bag !== 'object') continue;
        try {
          if (reconcile(acc, now, did)) dirty = true;                    // 回执对账：熔断/静默也照做
          if (store.exec_killed) continue;                               // ⛔ 熔断中：不派新单
          if (inQuiet(now)) {
            /* 静默期不派新单；但搜索链要留下「停在静默期」这条原因给网页弹橙条 */
            if (await jobChain(acc, h, now, did)) dirty = true;
            continue;
          }
          if (activeCmdOf(acc.id, now)) continue;                        // 有单在飞：这钩先让路
          const npRes = await jobNp(acc, bag, now, did);                 // 发布优先；一趟一条
          if (npRes.dirty) dirty = true;
          if (npRes.placed) continue;
          if (await jobChain(acc, h, now, did)) dirty = true;            // 搜索链：到点派下一类
          if (await jobAuto(acc, h, bag, now, did)) dirty = true;
        } catch (e) {
          did.push(`[${acc.name}] 排期看表出错：${(e && e.message) || e}`);
        }
      }
      /* 账清旧：发布账留 14 天；队列账留 3 天 */
      const t14 = now - PRUNE_DAYS * 864e5;
      const t3 = now - 3 * 864e5;
      for (const accId of Object.keys(store.exec_sched.np)) {
        const led = store.exec_sched.np[accId];
        for (const k of Object.keys(led)) {
          const d = String(k.split('|').pop() || '');
          const dt = new Date(d + 'T00:00:00').getTime();
          if (!d || isNaN(dt) || dt < t14) { delete led[k]; dirty = true; }
        }
        if (!Object.keys(led).length) { delete store.exec_sched.np[accId]; dirty = true; }
      }
      for (const accId of Object.keys(store.exec_sched.auto)) {
        const rec = store.exec_sched.auto[accId];
        const dt = rec && rec.d ? new Date(rec.d + 'T00:00:00').getTime() : 0;
        if (!dt || isNaN(dt) || dt < t3) { delete store.exec_sched.auto[accId]; dirty = true; }
      }
      /* 跑完/停手的搜索链留 3 天给网页看结果，之后清掉 */
      if (typeof ctx.pruneChains === 'function' && ctx.pruneChains(now)) dirty = true;
    } finally { busy = false; }
    if (dirty) { try { await persist(); } catch (_) {} }
    return { did: did.slice(0, 40), at: stamp() };
  }

  let busy = false;
  let timer = null;
  /* 上岗：开机 5 秒先看一次（错开启动洪峰），之后每 60 秒一钩 */
  function start() {
    if (timer) return;
    setTimeout(() => { tick().catch((e) => console.error('[sched] 看表出错：', e && e.message)); }, 5000);
    timer = setInterval(() => { tick().catch((e) => console.error('[sched] 看表出错：', e && e.message)); }, TICK_MS);
    if (timer.unref) timer.unref();
    console.log('[sched] 排期到点自动下单已上岗：每 60 秒看一次表（发布队列到点 / 队列每周自动跑 / 日常浏览每天自动跑）');
  }

  return {
    start,
    tick,
    tickNow: () => tick(),
  };
}
