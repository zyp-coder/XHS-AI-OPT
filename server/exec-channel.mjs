/* 服务器 → 执行器 · 通道 v1（2026-10-14 · 服务器正式版 A 期；v10 起接排期自动下单）
 *
 * 一句话：这是"服务器当大脑、扩展当手"里那根**神经线**。服务器只干三件——下单、记账、看结果；
 * 碰平台的动作永远在客户自己的浏览器里（执行器）跑，服务器一个指头都不碰平台。
 *
 * 挂的口（全 POST JSON，都在 /api/exec/ 下）：
 *   执行器侧（认的是"这只手" handId+token，不是网页 cookie）：
 *     /api/exec/pair       凭配对号上岗 {code,label} → {handId,token,account,tier,tierRank}
 *                          （配对号＝开档位那一刻生成、长期不变；网页侧登录仍是手机号+密码）
 *     /api/exec/heartbeat  心跳对账 {handId,token}         → {valid,killed,tier,tierRank,pending}
 *     /api/exec/poll       拉命令（长轮询挂住 25 秒）{handId,token} → {cmd} | {cmd:null}
 *     /api/exec/ack        干完回执 {handId,token,cmdId,ok,note,detail}
 *     /api/exec/report     报句话（进度/异常）{handId,token,text}
 *     /api/exec/ai         AI 出门口 {handId,token,system,user,maxTokens} → {content,usage}
 *                          （执行器自己不落 AI Key；要 AI 说话的动作都发到这儿，服务器拿真 Key 出网）
 *     /api/exec/blob       素材取回 {handId,token,blobId} → {name,mime,b64}
 *                          （排期自动下单的单子只带素材 id——网页交的料由服务器代管，执行器来这儿取）
 *     /api/exec/prompts    提示词下发 {handId,token} → {version,prompts}
 *                          （客户包里不带提示词；执行器挂上线领一份，版本变了心跳会提醒再领）
 *   网页侧（认的是登录会话 cookie）：
 *     /api/exec/order      下单 {kind,params} → {cmdId}（按档位拦）
 *     /api/exec/orders     看这只手的订单/在线状态/进度播报 → {hand,orders,reports,reports}
 *     /api/exec/stop       「⏹ 停这一趟」→ {delivered}（只停当前这一趟，不熔断不摘线）
 *   老板侧（本机直连或带 x-admin-pass）：
 *     /api/exec/order-all  全站的单（名单页用）
 *     /api/exec/admin-stop 老板在发放页点「停这一趟」（认账号，不认网页会话）
 *     /api/exec/kill       一键熔断 / /api/exec/unkill 解除
 *     /api/exec/sched-tick 排期立刻看一次表（验收/运维用；正常每 60 秒自己看）
 *
 * 档位（与 §8.4 对齐）：免费0 / 基础1(239) / 升级2(399) / 全功能3(539)；
 *   能装的活：发笔记≥1、获客≥2、日常浏览≥2、AI客服≥3；自检0（A 期验线用，不碰平台）。
 * 一个账号挂一台（§8.2 #7）：再 pair 一次＝解绑重挂（旧 token 作废）。
 * 熔断（§8.2 #3）：全局一键 → 毫秒级送达所有在线的执行器；重启也逃不掉（问服务器说了算）。
 * 排期到点自动下单（§8.2 #6 收尾 · v10）：服务器自己看表（发布队列到点 / 队列整条每周自动跑 /
 *   日常浏览每天自动跑）→ 到点由 exec-sched.mjs 调这里的 placeOrder 派单，与网页手点同一条链。
 *
 * D 期（2026-10-14）：换机 / 解绑重挂——网页侧新口 /api/exec/unpair（自己摘线）；重挂或解绑时把
 *   旧机器「在飞」的单标作废（旧机器不会再回执了）；派出去 3 小时没回执的单由 sweepStale 自动作废
 *   （网页上不留"永远在跑"的死单；作废的单不自动重发，防重复发到平台）。
 *   限流：下单防连点（同类活不重复排、手上最多排 PENDING_CAP 条没跑完的）；挂线口过配对号试错闸
 *   （authGate，与网页登录共用同一本 IP 账——试错太多次歇一会）。
 *
 * 2026-10-15（发放页 · 配对号）：执行器上岗凭据从「手机号+密码」换成「配对号」——/api/exec/pair
 *   认 code（网页侧登录仍是手机号+密码，认人分账本）；码在开档位那一刻由 genCode 生成、长期不变，
 *   免费档不生成；老板换码＝作废重发＋把已挂机器踢下线（kick）。 */

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFileSync, statSync } from 'node:fs';
import { ensureTierStore, editionOf, canKind } from './tier.mjs';

/* 客户包里不带提示词：这只手挂上线后凭挂线凭据来领。版本＝整份内容的哈希，
   变了就在心跳/派单回包里带上新版本号，执行器自己比对后重领。 */
const _require = createRequire(import.meta.url);
let _rulesPack = null;
function rulesPack() {
  if (_rulesPack) return _rulesPack;
  let prompts = {};
  try {
    const p = _require('./bg/lib/default-prompts.js');
    if (p && typeof p === 'object') prompts = p;
  } catch (e) {
    console.error('[exec] 读服务器提示词库失败：' + ((e && e.message) || e));
  }
  const version = createHash('sha256').update(JSON.stringify(prompts)).digest('hex').slice(0, 16);
  _rulesPack = { version, prompts };
  return _rulesPack;
}

/* 公网「装执行器」页发出去的那个包是哪个版本——pack.js 出包时跟 zip 一起写这个文件。
   版本闸：执行器报上来的版本和它不一样就不给派活（服务器上了新要求，客户机不能还拿老包跑）。
   文件没有＝这道闸不生效：老部署、或者读取失败，不至于把所有机器挡在门外。 */
const HAND_VER_FILE = fileURLToPath(new URL('../web/download/executor.version', import.meta.url));
let _handVer = { mtime: -1, v: '' };
function expectedHandVersion() {
  try {
    const m = statSync(HAND_VER_FILE).mtimeMs;
    if (m !== _handVer.mtime) {
      _handVer = { mtime: m, v: readFileSync(HAND_VER_FILE, 'utf8').trim().slice(0, 32) };
    }
    return _handVer.v;
  } catch (_) { return ''; }
}

const HOLD_MS = 25000;          // 长轮询挂住的秒数
const ONLINE_MS = 35000;        // 多久没心跳算离线
const CMD_KEEP = 200;           // 订单流水保留条数
const LOG_KEEP = 500;           // 事件流水保留条数
const REPORT_KEEP = 80;         // 每只手的进度播报保留条数（网页实时进度条）
const PENDING_CAP = 3;          // 下单防连点：一个账号手上最多压几条没跑完的（D 期）
const PENDING_STALE_MS = 6 * 3600000;   // 超过这么久还在飞＝当没派成，不占防连点的名额
const DEMO_NO_EXEC_MSG = '演示号只逛不真发——这类活得注册自己的号、挂上执行器';
const SWEEP_MS = 3 * 3600000;   // 派出去 3 小时没回执＝自动作废（机器关了/换了；D 期）
const SEARCH_SWEEP_MS = 20 * 60 * 1000;   // 搜索单 20 分钟没回执＝作废（执行器自己 15 分钟必收场，留 5 分钟余量）
/* 搜索链：一类跑完歇约 10 分钟再派下一类（不给旋钮，确认单 2026-10-23） */
const CHAIN_GAP_MS = 10 * 60 * 1000;
const CHAIN_KEEP_MS = 3 * 86400000;   // 跑完/停手的链留 3 天给网页看结果，之后清掉

export const TIER_RANK = { '免费': 0, '基础': 1, '升级': 2, '全功能': 3 };
export const KIND_NEED = { self_test: 0, note_publish: 1, batch_send: 0, film: 1, acquire: 2, daily_browse: 2, leads: 3 };
export const KIND_LABEL = { self_test: '自检', note_publish: '发笔记', batch_send: '整页发送', film: '本机出片', acquire: '获客', daily_browse: '日常浏览', leads: 'AI客服' };

/* 同一种活里的细分动作（搜索 / 评论刷新 / 截流扫一轮 …）：防连点按「活＋动作」算一条，
   不然搜一下就把整页发送也堵住了。没分的活就按 kind 本身算。 */
function orderKey(kind, params) {
  const p = params || {};
  if (kind === 'acquire') return kind + ':' + String(p.op || 'round');
  if (kind === 'leads') return kind + ':' + String(p.op || 'watch');
  return kind;
}

/* 执行器报上来的"会哪些活"：只留短字符串、去重、限量（挂线/心跳都过这一道） */
function normalizeCaps(v) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const x of v) {
    const s = String(x || '').trim().slice(0, 40);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 80) break;
  }
  return out;
}

/* 这只手会不会这一单：老包不报 caps（null）就不拦，让它自己拒；
   报了 caps 的，按"活 + 细分动作"核（换手 12A：服务器遇到不会的活直接提示升级，不硬派）。 */
function handSupports(h, kind, params) {
  const caps = h && Array.isArray(h.caps) ? h.caps : null;
  if (!caps || !caps.length) return true;
  const has = (k) => caps.includes(k);
  if (!has(kind)) return false;
  const p = params || {};
  if (kind === 'acquire') {
    const op = String(p.op || 'round');
    if (op !== 'round' && !has('acquire:' + op)) return false;
  }
  if (kind === 'leads') {
    const dm = p.op === 'dm' || !!p.person || (Array.isArray(p.people) && p.people.length > 0);
    if (!has(dm ? 'leads:dm' : 'leads:watch')) return false;
  }
  return true;
}

const stamp = () => new Date().toISOString().replace('T', ' ').slice(11, 23);

export function createExecChannel(ctx) {
  const { store, persist, json, resolveAccount, readEnv, bookBagFor } = ctx;

  /* 账本形状（懒建；都挂在根上＝名册层） */
  function ensure() {
    store.exec_hands = store.exec_hands || {};
    store.exec_cmds = store.exec_cmds || {};
    store.exec_log = store.exec_log || [];
    store.exec_reports = store.exec_reports || {};   // 每一只手的进度播报（网页上那根"实时进度"读它）
    store.exec_chains = store.exec_chains || {};     // 搜索链：这个词后面还没跑的几类（一类一轮，约 10 分钟派下一类）
    store.exec_last_search = store.exec_last_search || {};   // 每个号最新那一单搜索（旧单晚到的回执不立新链）
    if (typeof store.exec_killed !== 'boolean') store.exec_killed = false;
    ensureTierStore(store);   // 档位表（唯一真源）：缺就按初始矩阵补，已有值不动
  }
  ensure();

  const waiters = [];   // 正挂着等命令的执行器 {res,timer,handId}

  /* 写完应答＝已处理（主程序按 handle() 的真值决定要不要让别人再处理——
     别直接 `return json(...)`：json 返回 undefined，会被当成"没处理"、主程序再写一次 → 头已发出去报错） */
  const done = (r, code, obj) => { json(r, code, obj); return true; };

  function log(kind, text) {
    store.exec_log.push({ t: stamp(), kind, text });
    if (store.exec_log.length > LOG_KEEP) store.exec_log.splice(0, store.exec_log.length - LOG_KEEP);
    console.log(`[exec] ${kind.padEnd(4)} ${text}`);
  }

  /* 往某只手的「实时进度」圈里塞一行（网页上那根进度条读的就是这个账）——排期模块的口 */
  function reportBy(accId, text) {
    log('SRV', text);
    const ring = (store.exec_reports[accId] = store.exec_reports[accId] || []);
    ring.push({ t: stamp(), text });
    if (ring.length > REPORT_KEEP) ring.splice(0, ring.length - REPORT_KEEP);
  }

  const rankOf = (tier) => TIER_RANK[tier] || 0;
  const accTier = (acc) => (acc && acc.tier) || '免费';
  const online = (h) => !!h && Date.now() - (h.lastSeen || 0) < ONLINE_MS;
  const findHandByAccount = (accountId) => Object.values(store.exec_hands).find((h) => h.accountId === accountId) || null;

  /* ── 平台认号（2026-10-23）──
     一个网页账号在每个平台锁一个号：xhs＝小红书号（＋主页内部 id），douyin＝抖音号（＋uid/secUid）。
     给人看的是号（可能改名），机器校验用内部 id。没绑＝这个平台不能用；撞号＝拒绝并让找我们。 */
  const BIND_LABEL = { xhs: '小红书', douyin: '抖音' };

  function cleanBinding(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    for (const k of ['displayId', 'uid', 'secUid', 'name']) {
      const v = String(raw[k] == null ? '' : raw[k]).replace(/\s+/g, ' ').trim().slice(0, 120);
      if (v) out[k] = v;
    }
    if (!out.displayId && !out.uid) return null;
    return out;
  }

  function sameBinding(a, b) {
    if (!a || !b) return false;
    if (a.uid && b.uid) return a.uid === b.uid;
    return !!a.displayId && a.displayId === b.displayId;
  }

  /* 有没有别的网页账号已经绑了同一个号（撞号）：uid 或 号的显示值撞上都算 */
  function bindingOwner(platform, b, exceptAccId) {
    const list = Object.entries(store.accounts || {});
    for (const [id, a] of list) {
      if (id === exceptAccId || (a && a.kind === 'demo')) continue;
      const cur = a && a.bindings && a.bindings[platform];
      if (!cur) continue;
      if ((cur.uid && b.uid && cur.uid === b.uid) || (cur.displayId && b.displayId && cur.displayId === b.displayId)) return a;
    }
    return null;
  }

  function bindingsOf(acc) {
    const raw = (acc && acc.bindings) || {};
    const out = {};
    for (const p of Object.keys(BIND_LABEL)) out[p] = cleanBinding(raw[p]);
    return out;
  }

  function bindStateOf(acc) {
    const raw = (acc && acc.bind_state) || {};
    const out = {};
    for (const p of Object.keys(BIND_LABEL)) {
      const s = raw[p];
      out[p] = s && typeof s === 'object'
        ? { status: String(s.status || ''), saw: cleanBinding(s.saw) || null, at: Number(s.at) || 0 }
        : null;
    }
    return out;
  }

  /* 认一个平台的号：空着＝绑上；同一个＝刷新显示；不同＝拒绝（换绑只能老板做）。
     返回 { ok, error?, binding?, same?, mismatch? } */
  function bindPlatform(acc, platform, raw) {
    const p = String(platform || '');
    if (!BIND_LABEL[p]) return { ok: false, error: '不认识的平台：' + (p || '(空)') };
    const b = cleanBinding(raw);
    if (!b) return { ok: false, error: '没读到' + BIND_LABEL[p] + '号——先登录，再打开本人主页重试' };
    const dup = bindingOwner(p, b, acc.id);
    if (dup) {
      return { ok: false, error: '这个' + BIND_LABEL[p] + '号已经绑在另一个网页账号（' + (dup.name || dup.id) + '）上了——找给你网址的人处理' };
    }
    acc.bindings = bindingsOf(acc);
    const cur = acc.bindings[p];
    if (cur) {
      if (!sameBinding(cur, b)) {
        return {
          ok: false, mismatch: true,
          error: '这台浏览器登录的' + BIND_LABEL[p] + '号是 ' + (b.displayId || b.uid) + (b.name ? '（' + b.name + '）' : '')
            + '，不是这个账号绑的 ' + (cur.displayId || cur.uid) + (cur.name ? '（' + cur.name + '）' : '')
            + '——换回原来的号，或找给你网址的人换绑',
        };
      }
      acc.bindings[p] = Object.assign({}, cur, b, { boundAt: cur.boundAt || Date.now() });
      return { ok: true, binding: acc.bindings[p], same: true };
    }
    acc.bindings[p] = Object.assign({}, b, { boundAt: Date.now() });
    return { ok: true, binding: acc.bindings[p], bound: true };
  }

  /* 老板换绑：只清这个平台、只踢这台机器（客户下次挂线只补这一格） */
  async function clearBinding(acc, platform) {
    const p = String(platform || '');
    if (!BIND_LABEL[p]) return { ok: false, error: '不认识的平台：' + (p || '(空)') };
    acc.bindings = bindingsOf(acc);
    if (!acc.bindings[p]) return { ok: true, already: true };
    delete acc.bindings[p];
    if (acc.bind_state) delete acc.bind_state[p];
    const kicked = await kick(acc.id, `作废：老板换绑了${BIND_LABEL[p]}号，这台机器要用新号重挂`);
    log('WEB', `🔁 老板换绑${BIND_LABEL[p]}：${acc.name}（只动这一头${kicked ? '，在飞 ' + kicked + ' 单标作废' : ''}）`);
    return { ok: true, kicked };
  }

  /* 这一单要用哪个平台：发布按 params.platform，其余小红书活按 xhs */
  function platformOf(kind, params) {
    if (kind === 'note_publish') return String((params && params.platform) || 'xhs');
    if (kind === 'acquire' || kind === 'daily_browse' || kind === 'leads' || kind === 'batch_send') return 'xhs';
    return '';
  }
  /* 发布单可能要同时发几家：带 platforms 数组的按数组；老单只有 platform */
  function platformsOf(kind, params) {
    if (kind === 'note_publish') {
      const arr = Array.isArray(params && params.platforms)
        ? params.platforms.map((x) => String((x && x.platform) || x || '')).filter(Boolean)
        : [];
      return arr.length ? arr : [String((params && params.platform) || 'xhs')];
    }
    return [platformOf(kind, params)].filter(Boolean);
  }

  /* 下单闸：这一单要用哪个平台的号、那个号绑没绑。发布单按 params.platform，其余小红书活按 xhs。
     只硬拦「没绑」；错号/没登录由执行器每次开窗现场复核并中止那一单——
     服务器若按上次的错号记账拦单，客户换回正确号后单就永远派不下去，也就没机会重新认号。 */
  function bindingBlock(acc, kind, params) {
    const p = platformOf(kind, params);
    if (!p || !BIND_LABEL[p]) return '';
    const b = bindingsOf(acc)[p];
    if (!b || !(b.uid || b.displayId)) {
      return `这个号还没认${BIND_LABEL[p]}号——打开执行器面板，点「认一下${BIND_LABEL[p]}」再试`;
    }
    return '';
  }

  /* 执行器开窗认完号报上来：只记账 + 记一条日志（错号时后台/网页据此提醒） */
  function reportBindCheck(acc, results) {
    if (!results || typeof results !== 'object') return;
    acc.bind_state = acc.bind_state || {};
    for (const p of Object.keys(BIND_LABEL)) {
      const r = results[p];
      if (!r || typeof r !== 'object') continue;
      const status = ['ok', 'mismatch', 'loggedout', 'unknown'].includes(String(r.status)) ? String(r.status) : 'unknown';
      const saw = cleanBinding(r.saw);
      acc.bind_state[p] = { status, saw: saw || null, at: Number(r.at) || Date.now() };
      if (status === 'mismatch' && saw) {
        const b = bindingsOf(acc)[p];
        log('EXT', `⛔ ${(acc && acc.name) || ''}${BIND_LABEL[p]}号对不上：绑的是 ${b ? (b.displayId || b.uid) : '—'}，现在登的是 ${saw.displayId || saw.uid}`);
      }
    }
  }

  /* 配对号：XHD- 开头 + 4 位（易混的 0/O/1/I/L 不进池）——开档位那一刻生成，长期不变。
     全站不重码（生成时拿在册账号碰一遍）。 */
  const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  function genCode() {
    for (;;) {
      let s = '';
      for (let i = 0; i < 4; i++) s += CODE_ABC[Math.floor(Math.random() * CODE_ABC.length)];
      const code = 'XHD-' + s;
      if (!Object.values(store.accounts || {}).some((a) => a.pairCode === code)) return code;
    }
  }

  /* 把某账号的执行器踢下线（换码 / 发放页操作）：旧机器下一次心跳就知道失效、当场收队；
     在飞的单标作废（它不会再回执了）。返回作废的单数。 */
  async function kick(accId, why) {
    const h = findHandByAccount(accId);
    if (!h) return 0;
    delete store.exec_hands[h.handId];
    dropChain(accId, '执行器被踢下线');
    const n = failInFlight(accId, why);
    log('SRV', `🖐 执行器踢下线：${(store.accounts[accId] || {}).name || accId}（${why}）`);
    await persist();
    return n;
  }

  function publicHand(h) {
    if (!h) return { paired: false, online: false };
    const acc = store.accounts[h.accountId] || {};
    return {
      paired: true, handId: h.handId, name: acc.name || '', phoneTail: (acc.phone || '').slice(-4),
      label: h.label || '', online: online(h), lastSeen: h.lastSeen || 0, createdAt: h.createdAt,
      version: h.version || '', caps: Array.isArray(h.caps) ? h.caps : null,
      tier: accTier(acc), tierRank: rankOf(accTier(acc)),
    };
  }

  function publicCmd(c) {
    return {
      id: c.id, kind: c.kind, kindLabel: KIND_LABEL[c.kind] || c.kind, state: c.state,
      params: c.params || {}, createdAt: c.createdAt, sentAt: c.sentAt || 0, doneAt: c.doneAt || 0,
      ok: c.ok, note: c.note || '', detail: c.detail || '',
      needLogin: !!c.needLogin,
    };
  }

  const cmdsOf = (accountId) => Object.values(store.exec_cmds)
    .filter((c) => c.accountId === accountId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50).map(publicCmd);

  /* ── 手上还压着几条活（D 期·下单防连点用）──
     排队中 + 已送达没回执；超 PENDING_STALE_MS 还在飞的当"没派成"，不占名额。 */
  function pendingOf(accountId, now) {
    const t = now || Date.now();
    return Object.values(store.exec_cmds || {}).filter((c) =>
      c.accountId === accountId && (c.state === 'queued' || c.state === 'sent')
      && (t - (c.sentAt || c.createdAt || 0)) < PENDING_STALE_MS);
  }

  /* ── 把某账号"在飞"（已送达没回执）的单标作废（换机 / 解绑时用）──
     旧机器不会再回执了，单留着只会挂在"进行中"。注：作废的单不自动重发
     （exec-sched 的对账把带「作废」的记成 done——防重复发到平台）。 */
  function failInFlight(accountId, why) {
    let n = 0;
    for (const c of Object.values(store.exec_cmds || {})) {
      if (c.accountId === accountId && c.state === 'sent') {
        c.state = 'failed'; c.ok = false; c.note = why; c.doneAt = Date.now();
        n++;
      }
    }
    return n;
  }

  /* ── 房务定时（exec-sched 每 60 秒叫一次）：派出去很久没回执的单自动作废 ──
     （机器关了/崩了/换了——这单永远不会来回执；标作废，网页上不留"永远在跑"的死单。）
     搜索单单独短时限：执行器那边 15 分钟必收场，再留 5 分钟余量；到点就作废，
     好让用户马上能重新点搜索，不用被「还排着一条没跑完」挡到 6 小时后。 */
  function sweepStale(now) {
    const t = now || Date.now();
    let dirty = false;
    for (const c of Object.values(store.exec_cmds || {})) {
      if (c.state !== 'sent') continue;
      const isSearch = c.kind === 'acquire' && String((c.params && c.params.op) || '') === 'search';
      const limit = isSearch ? SEARCH_SWEEP_MS : SWEEP_MS;
      if ((t - (c.sentAt || c.createdAt || 0)) < limit) continue;
      c.state = 'failed'; c.ok = false;
      c.note = isSearch
        ? '作废：搜索单 20 分钟没回执（执行器卡住或断线了）——可以重新点搜索'
        : '作废：派出去 3 小时没回执（机器关了 / 断线了）';
      c.doneAt = t;
      log('SRV', `🧹 超时没回执的单自动作废（${KIND_LABEL[c.kind] || c.kind}）`);
      dirty = true;
    }
    return dirty;
  }

  /* ── 搜索链（2026-10-23 确认单）──
     点一次搜索＝只跑「最新」这一类；回执里带着「后面还有哪几类」，服务器记成一串活，
     由 exec-sched 每 60 秒看一次表，约 10 分钟派下一类。一个号同时只有一条链。 */
  function publicChain(accountId) {
    const c = store.exec_chains && store.exec_chains[accountId];
    if (!c) return null;
    return {
      id: c.id, kw: c.kw || '', status: c.status,
      round: c.round || '', roundName: c.roundName || '',
      remain: Array.isArray(c.remain) ? c.remain : [],
      remainNames: Array.isArray(c.remainNames) ? c.remainNames : [],
      nextAt: Number(c.nextAt) || 0, found: Number(c.found) || 0,
      roundFound: Number(c.roundFound) || 0, dayTotal: Number(c.dayTotal) || 0,
      lastNotes: Array.isArray(c.lastNotes) ? c.lastNotes : [],
      stopKind: c.stopKind || '', stopReason: c.stopReason || '',
      startedAt: c.startedAt || 0, updatedAt: c.updatedAt || 0,
    };
  }

  /* 这串活没了：新的搜索/队列开始、停这一趟、解绑、踢下线、熔断——直接撤掉，不弹横幅 */
  function dropChain(accountId, why) {
    const c = store.exec_chains && store.exec_chains[accountId];
    if (!c) return false;
    delete store.exec_chains[accountId];
    if (why) log('SRV', `🧵 撤掉搜索链（${c.kw || ''}）：${why}`);
    return true;
  }

  /* 自动停手：留着这条链和原因，网页顶上据此弹红条/橙条 */
  function stopChain(accountId, kind, reason) {
    const c = store.exec_chains && store.exec_chains[accountId];
    if (!c) return false;
    if (c.status === 'stopped') return false;
    c.status = 'stopped';
    c.stopKind = kind || 'fail';
    c.stopReason = String(reason || '').slice(0, 300);
    c.nextAt = 0;
    c.updatedAt = Date.now();
    log('SRV', `⏹ 搜索链停手（${c.kw || ''}）：${c.stopReason || kind}`);
    return true;
  }

  const guardStopRe = /🛡|账号安全|顺延|静默期|单休|起床/;

  /* 回执落到链上：首轮回执立链；后续每轮把跑完的那一类从队首去掉、约 10 分钟后再派 */
  function applyChainAck(acc, cmd, body) {
    const p = cmd.params || {};
    if (cmd.kind !== 'acquire' || String(p.op || '') !== 'search') return false;
    let d = null;
    try { d = JSON.parse(String(body.detail || '{}')); } catch (_) { d = null; }
    const cur = store.exec_chains && store.exec_chains[acc.id];
    const chained = !!(p.chainId && cur && cur.id === p.chainId);

    if (body.ok) {
      if (!d || typeof d !== 'object') return false;
      if (p.chainId) {
        if (!chained || cur.status === 'stopped') return false;   // 旧链 / 已撤 / 已停：不接
        cur.round = String(d.round || p.scenario || cur.round || '');
        cur.roundName = String(d.roundName || cur.roundName || '');
        /* 后面的类在「派下一类」那一刻就从 remain 里取走了，回执这里不再删 */
        cur.roundFound = Number(d.found) || 0;
        cur.found = (Number(cur.found) || 0) + (Number(d.found) || 0);
        cur.dayTotal = d.dayTotal != null ? (Number(d.dayTotal) || 0) : cur.dayTotal;
        cur.lastNotes = Array.isArray(d.notes) ? d.notes.slice(0, 10) : [];
        cur.updatedAt = Date.now();
        if (cur.remain.length) {
          cur.status = 'waiting';
          cur.nextAt = Date.now() + CHAIN_GAP_MS;
        } else {
          cur.status = 'done'; cur.nextAt = 0;
          log('SRV', `🏁 搜索链跑完：${cur.kw || ''} 共 ${cur.found} 篇（今天共 ${cur.dayTotal} 篇）`);
        }
        return true;
      }
      /* 首轮：只有它是这个号最新那一单搜索才立链（旧单晚到的回执不立） */
      if (store.exec_last_search[acc.id] && store.exec_last_search[acc.id] !== cmd.id) return false;
      const remain = Array.isArray(d.remain) ? d.remain.map(String) : [];
      if (!remain.length) return false;
      const remainNames = Array.isArray(d.remainNames) ? d.remainNames.map(String) : remain.slice();
      store.exec_chains[acc.id] = {
        id: 'chain_' + Math.random().toString(16).slice(2, 10),
        kw: String(d.kw || p.kw || ''), profile: String(p.profile || ''), label: String(p.label || ''),
        snapshot: p.snapshot || null,
        status: 'waiting', round: String(d.round || ''), roundName: String(d.roundName || ''),
        roundFound: Number(d.found) || 0,
        remain, remainNames,
        found: Number(d.found) || 0,
        dayTotal: Number(d.dayTotal) || 0,
        lastNotes: Array.isArray(d.notes) ? d.notes.slice(0, 10) : [],
        nextAt: Date.now() + CHAIN_GAP_MS,
        startedAt: Date.now(), updatedAt: Date.now(),
        cmdId: cmd.id, stopKind: '', stopReason: '',
      };
      log('SRV', `🧵 搜索链记下了：${d.kw || p.kw || ''} → 后面还有 ${remainNames.join(' / ')}（约 10 分钟一类）`);
      return true;
    }

    if (!chained || cur.status === 'stopped') return false;
    const note = String(body.note || '搜索没跑起来');
    const kind = body.needLogin ? 'login' : (guardStopRe.test(note) ? 'guard' : 'fail');
    return stopChain(acc.id, kind, note);
  }

  /* 旧链清账：跑完/停手留 3 天给网页看，之后删 */
  function pruneChains(now) {
    const t = now || Date.now();
    let dirty = false;
    for (const accId of Object.keys(store.exec_chains || {})) {
      const c = store.exec_chains[accId];
      if (!c) continue;
      const done = c.status === 'done' || c.status === 'stopped';
      if (done && t - (c.updatedAt || 0) > CHAIN_KEEP_MS) { delete store.exec_chains[accId]; dirty = true; }
    }
    return dirty;
  }


  /* 把一条命令递给"正挂着等"的执行器（可按 handId 定向）。
     真递出去就得记成「已送达」：原先进长轮询这条通路不改状态，单子一直挂在 queued，
     既躲过 sweepStale（只看 sent），又按 6 小时占着防连点名额——搜索卡住时后面点重试一直被挡。 */
  function deliver(cmd, onlyHandId) {
    let n = 0;
    for (let i = waiters.length - 1; i >= 0; i--) {
      const w = waiters[i];
      if (onlyHandId && w.handId !== onlyHandId) continue;
      waiters.splice(i, 1);
      clearTimeout(w.timer);
      json(w.res, 200, { ok: true, valid: true, cmd });
      n++;
    }
    const rec = cmd && cmd.id ? store.exec_cmds[cmd.id] : null;
    if (n > 0 && rec && rec.state === 'queued') {
      rec.state = 'sent'; rec.sentAt = Date.now();
      persist().catch(() => {});
    }
    return n;
  }

  function checkCred(body) {
    const handId = String(body.handId || '');
    const token = String(body.token || '');
    const h = store.exec_hands[handId];
    if (!h) return { ok: false, reason: '这只手没挂过线（先登录挂线）' };
    if (!h.token || h.token !== token) return { ok: false, reason: '挂线凭据不对（可能已在别处重挂）' };
    const acc = store.accounts[h.accountId];
    if (!acc) return { ok: false, reason: '账号不在了' };
    return { ok: true, h, acc };
  }

  /* 下单（网页手点与服务器排期共用这一条）：
     认活 → 过档位闸 → 找手 → 记一笔 → 在线就当场递（不在线就排着，等它来拉）。
     by：'web'＝网页上点的；'sched'＝排期到点服务器自己下的（流水与实时进度都标 ⏰）。 */
  async function placeOrder(acc, kind, params, by) {
    const tag = by === 'sched' ? 'sched' : 'web';
    if (!(kind in KIND_NEED)) return { ok: false, error: '不认识的活：' + kind };
    const rank = rankOf(accTier(acc));
    /* 档位闸（2026-10-16 起看的是公网那台那张表，含小灶与试用期，不再只比档位数） */
    const gate = canKind(acc, store, kind);
    if (!gate.ok) return { ok: false, error: gate.error };
    /* 平台认号闸：这一单要用哪个平台的号，那个号必须绑在这个网页账号上（没绑/错号不派） */
    if (kind === 'note_publish' && Array.isArray(params && params.platforms)) {
      const ps = platformsOf(kind, params);
      const unbound = ps.filter((p) => {
        if (!BIND_LABEL[p]) return true;
        const b = bindingsOf(acc)[p];
        return !(b && (b.uid || b.displayId));
      });
      if (unbound.length) {
        const names = unbound.map((p) => BIND_LABEL[p] || p).join('、');
        return { ok: false, error: `这单要发${ps.map((p) => BIND_LABEL[p] || p).join('＋')}，但${names}还没认号——打开执行器面板点「认一下${names}」再试` };
      }
    }
    const bindErr = bindingBlock(acc, kind, params);
    if (bindErr) return { ok: false, error: bindErr };
    const h = findHandByAccount(acc.id);
    if (!h) return { ok: false, error: '还没挂执行器——先下载装上、登录挂线' };
    /* 版本闸：这台电脑上的执行器必须和公网发出去的那个包同版本，不同就不派 */
    const needVer = expectedHandVersion();
    if (needVer && String(h.version || '') !== needVer) {
      log('SRV', `⛔ 拒派（执行器 ${h.version || '旧版'} ≠ 要求 ${needVer}）：${KIND_LABEL[kind] || kind} → ${acc.name}`);
      return { ok: false, error: `这台电脑上的执行器是 ${h.version ? 'v' + h.version : '旧版'}，公网现在要 v${needVer}——打开扩展页点「重新加载」；还不行就重装最新执行器再派` };
    }
    if (!handSupports(h, kind, params)) {
      log('SRV', `⛔ 拒派（执行器 ${h.version || '旧版'} 不会）：${KIND_LABEL[kind] || kind} → ${acc.name}`);
      return { ok: false, error: `这只执行器的版本太旧，不会「${KIND_LABEL[kind] || kind}」这个动作——在客户机上重新装最新执行器再派` };
    }
    /* 下单防连点（D 期）：同类活还排着一条就不重复排；手上压着的活最多 PENDING_CAP 条。
       （排期自动下单不会撞这道闸——exec-sched 只在账号"没有在飞的单"时才派。） */
    const pending = pendingOf(acc.id);
    const key = orderKey(kind, params);
    if (pending.some((c) => orderKey(c.kind, c.params) === key)) {
      const label = KIND_LABEL[kind] || kind;
      return { ok: false, error: `「${label}」还排着一条没跑完——等它跑完再点（不重复下单）` };
    }
    if (pending.length >= PENDING_CAP) {
      return { ok: false, error: `手上排的活太多了（最多 ${PENDING_CAP} 条没跑完）——等跑完再点` };
    }
    const id = 'cmd_' + Math.random().toString(16).slice(2, 10) + Date.now().toString(16).slice(-6);
    /* 新的搜索 / 队列开始 → 先把旧的那串活撤掉，不叠两条；记下这是这个号最新一单，旧单晚到的回执不立新链 */
    const op = String((params && params.op) || 'round');
    if (kind === 'acquire' && !(params && params.chainId) && (op === 'search' || op === 'round')) {
      store.exec_last_search[acc.id] = id;
      dropChain(acc.id, '新的搜索/队列开始了');
    }
    const cmd = { id, accountId: acc.id, handId: h.handId, kind, params: params || {}, state: 'queued', createdAt: Date.now(), by: tag };
    store.exec_cmds[id] = cmd;
    trimCmds();
    if (tag === 'sched') reportBy(acc.id, `⏰ 排期到点自动下单：${KIND_LABEL[kind] || kind}`);
    else log('WEB', `🖱 下单：${acc.name} → ${KIND_LABEL[kind] || kind}`);
    await persist();
    deliver({ id, type: 'run', kind, params: cmd.params, tier: accTier(acc), tierRank: rank, edition: editionOf(acc, store) }, h.handId);   // 在线就当场送达
    return { ok: true, cmdId: id, delivered: online(h) };
  }

  /* 发布回执落账（2026-10-24 并行批）：执行器在 detail 里带的是每家各自的结果
     [{platform, ok, url, pending, needLogin, needPerm, needVerify, msg}]——
     ① 记「最近发过」流水（每家一格）；② 发成的家记进 np_pub_sent（部分成功只补没成的）；
     ③ 只在「这单要发的每家都发成」时才把篇标「已发」；④ 卡住的家进「等您接手」，发成的家收掉旧卡点。 */
  async function recordPublishAck(acc, cmd) {
    if (!cmd || cmd.kind !== 'note_publish') return false;
    let d = null;
    try { d = JSON.parse(String(cmd.detail || '')); } catch (_) { return false; }
    const list = d && Array.isArray(d.platforms) ? d.platforms : null;
    if (!list || !list.length) return false;
    const id = String((cmd.params && cmd.params.note && cmd.params.note.id) || '');
    if (!id) return false;
    const bag = bookBagFor(acc.id);
    const now = Date.now();
    const key = String(((cmd.params || {}).sched || {}).lineKey || '');
    const entry = { at: now, id, key };
    list.forEach((r) => {
      const p = String((r && r.platform) || '');
      if (!p) return;
      if (r.stopped) return;   // 被「⏹ 停这一趟」叫停的不算没上成（不记流水、不留卡点）
      if (r.ok) entry[p] = { ok: true, url: r.url || '' };
      else if (r.pending) entry[p] = { pending: true };
      else if (r.needLogin) entry[p] = { needLogin: true };
      else if (r.needPerm) entry[p] = { needPerm: true };
      else if (r.needVerify) entry[p] = { ok: false, needVerify: true, msg: r.msg || '' };
      else if (r.prep) entry[p] = { prep: true };
      else entry[p] = { ok: false, msg: r.msg || '', audit: r.audit || null, scan: r.scan || null };
    });
    if (Object.keys(entry).length > 3) bag.np_pub_log = [entry].concat(Array.isArray(bag.np_pub_log) ? bag.np_pub_log : []).slice(0, 50);

    const sent = Object.assign({}, (bag.np_pub_sent && typeof bag.np_pub_sent === 'object') ? bag.np_pub_sent : {});
    const one = Object.assign({}, (sent[id] && typeof sent[id] === 'object') ? sent[id] : {});
    list.forEach((r) => { if (r && r.ok) one[String(r.platform)] = { ok: true, url: r.url || '', at: now }; });
    if (Object.keys(one).length) sent[id] = one; else delete sent[id];
    bag.np_pub_sent = sent;

    /* 卡点：发成的家收掉；没发成的家按四态钉上（执行器进度接口先到的话这里是补齐） */
    let stuck = Array.isArray(bag.np_pub_stuck) ? bag.np_pub_stuck.slice() : [];
    const drop = (p) => { stuck = stuck.filter((x) => !(x && String(x.id) === id && String(x.p) === p)); };
    list.forEach((r) => {
      const p = String((r && r.platform) || '');
      if (!p) return;
      drop(p);
      if (r.stopped) return;
      let k = '';
      if (r.ok || r.prep) k = '';
      else if (r.pending) k = 'pending';
      else if (r.needVerify) k = 'verify';
      else if (r.needLogin) k = 'login';
      else if (r.needPerm) k = 'perm';
      else k = 'fail';
      if (k) stuck.push({ k: k, id: id, p: p, why: r.msg || '', at: now, tabId: r.tabId, windowId: r.windowId });
    });
    bag.np_pub_stuck = stuck;

    const targets = platformsOf('note_publish', cmd.params);
    const allOk = targets.length > 0 && targets.every((p) => list.some((r) => String(r.platform) === p && r.ok));
    const notes = Array.isArray(bag.np_notes) ? bag.np_notes : [];
    const note = notes.find((n) => n && String(n.id) === id);
    if (note && allOk) {
      note.status = '已发';
      note.statusAt = Object.assign({}, note.statusAt || {}, { '已发': now });
      note.pub = Object.assign({}, note.pub || {});
      /* 一家是上一趟补成的、一家是这一趟：链接都得回档案（one 是合并后的已发账） */
      Object.keys(one).forEach((p) => {
        const rec = one[p] || {};
        note.pub[p] = { url: rec.url || '', at: Number(rec.at) || now };
      });
      delete bag.np_pub_sent[id];
    }
    return true;
  }

  /* 排期模块（exec-sched.mjs）的挂载点：主程序建好它之后挂进来——
     ① 老板侧的「排期立刻看一次表」有地方调；② 模块反过来用上面的 placeOrder/reportBy 下单报信。 */
  let schedRef = null;
  function attachSched(s) { schedRef = s; }

  function isAdmin(req) {
    const pass = readEnv().adminPass;
    if (pass) return String(req.headers['x-admin-pass'] || '') === pass;
    const ip = ctx.clientIp(req);
    return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);
  }

  /* 返回 true＝已处理；false＝不归我管（交回主程序） */
  async function handle(path, body, req, res) {
    ensure();

    /* ── 执行器侧 ─────────────────────────────────────────────── */
    if (path === '/api/exec/pair') {
      const ip = ctx.clientIp(req);
      /* 配对号试错闸（D 期·限流）：与网页登录共用同一本 IP 账——试错太多次先歇一会 */
      if (ctx.authGate && ctx.authGate.blocked(ip)) {
        return done(res, 200, { ok: false, error: '配对号试错太多次了——歇 15 分钟再试' });
      }
      const code = String(body.code || '').trim().toUpperCase();
      const acc = code ? Object.values(store.accounts).find((a) => (a.pairCode || '') === code) : null;
      if (!acc) {
        if (ctx.authGate) ctx.authGate.fail(ip);
        return done(res, 200, { ok: false, error: '配对号不对——照抄网页上你账号那行里的那串；还没开通档位就没有码，找给你网址的人' });
      }
      if (ctx.authGate) ctx.authGate.ok(ip);
      /* 演示号只逛不真跑：不给挂线——公用的号挂上真电脑就变成替来人发平台动作了 */
      if (acc.kind === 'demo') {
        return done(res, 200, { ok: false, error: '演示号不能挂执行器（只用来逛）——注册自己的号、开通档位后才有配对号' });
      }
      const tier = accTier(acc);
      if (rankOf(tier) < 1) {
        return done(res, 200, { ok: false, error: '这个号还没到能装执行器的档位（239 起）——打开网页的「装执行器」页看看怎么开通（网址后加 /setup）' });
      }
      const old = findHandByAccount(acc.id);
      if (old) {
        delete store.exec_hands[old.handId];
        log('SRV', `这把号重挂：${acc.name} 旧手（${old.handId.slice(0, 8)}）作废`);
        const killed = failInFlight(acc.id, '作废：这台已换机重挂，这单交给新机器了');
        if (killed) log('SRV', `🧹 换机重挂：${acc.name} 旧机器在飞的 ${killed} 单标作废`);
      }
      const handId = 'hand_' + Math.random().toString(16).slice(2, 10) + Date.now().toString(16).slice(-6);
      const token = Math.random().toString(16).slice(2, 18) + Math.random().toString(16).slice(2, 10);
      const h = {
        handId, accountId: acc.id, token, createdAt: Date.now(), lastSeen: Date.now(),
        label: String(body.label || '').slice(0, 40), ua: String(body.ua || '').slice(0, 120),
        version: String(body.version || '').slice(0, 32), caps: normalizeCaps(body.caps) || [],
      };
      store.exec_hands[handId] = h;
      log('EXT', `🔗 执行器挂线：${acc.name}（${tier}档 · ${h.version ? 'v' + h.version : '旧版未报版本'} · ${h.caps.length} 项能力）`);
      await persist();
      return done(res, 200, { ok: true, handId, token, account: { name: acc.name }, bindings: bindingsOf(acc), serverName: 'AI雕兄 · 服务器', tier, tierRank: rankOf(tier), edition: editionOf(acc, store), rulesVersion: rulesPack().version, expectVersion: expectedHandVersion() });
    }

    /* 认号（执行器侧）：挂线后各平台各认一次；空着＝绑上，同一个＝刷新，不同＝拒绝（换绑只能老板做） */
    if (path === '/api/exec/bind') {
      const c = checkCred(body);
      if (!c.ok) return done(res, 200, { ok: false, error: c.reason });
      const r = bindPlatform(c.acc, body.platform, body.binding);
      /* 读到的号和绑的不一样：记下来，网页/后台据此提醒（不自动换绑） */
      if (r.mismatch) {
        c.acc.bind_state = c.acc.bind_state || {};
        c.acc.bind_state[String(body.platform)] = { status: 'mismatch', saw: cleanBinding(body.binding), at: Date.now() };
      }
      await persist();
      return done(res, 200, Object.assign({ bindings: bindingsOf(c.acc) }, r));
    }

    /* 认号结果（执行器开窗认完报上来）：只记账，不拦单；错号在网页顶上提醒 */
    if (path === '/api/exec/bind-report') {
      const c = checkCred(body);
      if (!c.ok) return done(res, 200, { ok: false, error: c.reason });
      reportBindCheck(c.acc, body.results);
      await persist();
      return done(res, 200, { ok: true, bindState: bindStateOf(c.acc) });
    }

    if (path === '/api/exec/prompts') {
      const c = checkCred(body);
      if (!c.ok) return done(res, 200, { ok: false, valid: false, error: c.reason });
      const pack = rulesPack();
      if (!Object.keys(pack.prompts).length) return done(res, 200, { ok: false, error: '服务器还没装提示词库' });
      return done(res, 200, { ok: true, version: pack.version, prompts: pack.prompts });
    }

    if (path === '/api/exec/heartbeat') {
      const c = checkCred(body);
      if (!c.ok) return done(res, 200, { ok: true, valid: false, reason: c.reason, killed: !!store.exec_killed });
      c.h.lastSeen = Date.now();
      /* 版本/能力随心跳续报（升级后不用重挂也能让服务器认出新手） */
      if (body.version) c.h.version = String(body.version).slice(0, 32);
      const caps = normalizeCaps(body.caps);
      if (caps) c.h.caps = caps;
      const pending = Object.values(store.exec_cmds).filter((x) => x.accountId === c.acc.id && x.state === 'queued').length;
      /* stopAt 带上：执行器正忙着跑活时没挂长轮询，"停这一趟"推不进去——靠心跳补，
         执行器按时间戳去重（比自己记住的那个新才动手），不会重复触发。 */
      return done(res, 200, { ok: true, valid: true, killed: !!store.exec_killed, tier: accTier(c.acc), tierRank: rankOf(accTier(c.acc)), pending, stopAt: c.h.stopAt || 0, edition: editionOf(c.acc, store), rulesVersion: rulesPack().version, expectVersion: expectedHandVersion() });
    }

    if (path === '/api/exec/poll') {
      const c = checkCred(body);
      if (!c.ok) return done(res, 200, { ok: true, valid: false, reason: c.reason, cmd: null });
      c.h.lastSeen = Date.now();
      /* 版本对不上：一条都不派（已经排着的老单也先压着，等客户换回正确版本再来拉）。
         长轮询照常挂住 25 秒，执行器不会在这儿空转。 */
      const needVer = expectedHandVersion();
      const verMismatch = !!needVer && String(c.h.version || '') !== needVer;
      /* 有排队中的活就先发（拉取即发）。
         排队期间这只手换了旧版/能力对不上：不会的活当场作废，不硬派（换手 12A）。 */
      const queued = Object.values(store.exec_cmds)
        .filter((x) => !verMismatch && x.accountId === c.acc.id && x.state === 'queued')
        .sort((a, b) => a.createdAt - b.createdAt);
      let next = null;
      let dropped = false;
      for (const q of queued) {
        if (handSupports(c.h, q.kind, q.params)) { next = q; break; }
        q.state = 'failed'; q.ok = false;
        q.note = '这只执行器的版本太旧，不会这个动作（服务器没派）'; q.doneAt = Date.now();
        log('SRV', `⛔ 排队里的活作废（执行器 ${c.h.version || '旧版'} 不会）：${KIND_LABEL[q.kind] || q.kind} → ${c.acc.name}`);
        dropped = true;
      }
      if (dropped) persist();
      if (next) {
        next.state = 'sent'; next.sentAt = Date.now();
        log('SRV', `📤 下单送达（${KIND_LABEL[next.kind] || next.kind}）→ ${c.acc.name}`);
        persist();
        return done(res, 200, { ok: true, valid: true, edition: editionOf(c.acc, store), rulesVersion: rulesPack().version, expectVersion: needVer, cmd: { id: next.id, type: 'run', kind: next.kind, params: next.params || {}, tier: accTier(c.acc), tierRank: rankOf(accTier(c.acc)), edition: editionOf(c.acc, store) } });
      }
      const w = { res, timer: null, handId: c.h.handId };
      w.timer = setTimeout(() => {
        const i = waiters.indexOf(w);
        if (i >= 0) waiters.splice(i, 1);
        json(res, 200, { ok: true, valid: true, cmd: null, edition: editionOf(c.acc, store), rulesVersion: rulesPack().version, expectVersion: needVer, versionMismatch: verMismatch });
      }, HOLD_MS);
      waiters.push(w);
      req.on('close', () => {
        const i = waiters.indexOf(w);
        if (i >= 0) { waiters.splice(i, 1); clearTimeout(w.timer); }
      });
      return true;
    }

    if (path === '/api/exec/ack') {
      const c = checkCred(body);
      if (!c.ok) return done(res, 200, { ok: false, error: c.reason });
      const cmd = store.exec_cmds[String(body.cmdId || '')];
      if (!cmd || cmd.accountId !== c.acc.id) return done(res, 200, { ok: false, error: '没这个单' });
      cmd.state = body.ok ? 'done' : 'failed';
      cmd.ok = !!body.ok;
      cmd.note = String(body.note || '').slice(0, 300);
      cmd.detail = String(body.detail || '').slice(0, 2000);
      /* 登录过期：这一单失败，但要让网页醒目提醒「去扫码」——执行器那边已经停手了 */
      cmd.needLogin = !body.ok && !!body.needLogin;
      cmd.doneAt = Date.now();
      /* 发布单：按 detail 里每家各自的结果落账（流水 / 已发 / 补发账 / 等您接手） */
      try { await recordPublishAck(c.acc, cmd); } catch (e) { log('SRV', '发布回执落账失败：' + ((e && e.message) || e)); }
      /* 搜索链：首轮立链 / 后续轮推进 / 失败停手（网页从 /api/exec/orders 的 chain 读） */
      applyChainAck(c.acc, cmd, body);
      log('EXT', `${body.ok ? '✅' : '⚠️'} 回执（${KIND_LABEL[cmd.kind] || cmd.kind}）：${c.acc.name}${cmd.note ? ' — ' + cmd.note : ''}${cmd.needLogin ? '（要扫码登录）' : ''}`);
      await persist();
      return done(res, 200, { ok: true });
    }

    if (path === '/api/exec/report') {
      const c = checkCred(body);
      if (!c.ok) return done(res, 200, { ok: false, error: c.reason });
      const text = String(body.text || '').slice(0, 300);
      log('EXT', `${c.acc.name}：${text}`);
      /* 网页上那根"实时进度"从这个按账号的环形账读（不用去翻全站事件流水） */
      const ring = (store.exec_reports[c.acc.id] = store.exec_reports[c.acc.id] || []);
      ring.push({ t: stamp(), text });
      if (ring.length > REPORT_KEEP) ring.splice(0, ring.length - REPORT_KEEP);
      await persist();
      return done(res, 200, { ok: true });
    }

    /* 发布进度（2026-10-24 并行批）：执行器每走一步 POST 一次，服务器直接写进这只账号的小账本——
     * 网页工作台读的是同一本（np_pub_live / np_pub_runs / np_pub_stuck），不用另开一套通道。
     * body：{ live?:{...}|null, run?:{...}, stuckOps?:[{op:'add'|'clear', id, p, it?}] } */
    if (path === '/api/exec/progress') {
      const c = checkCred(body);
      if (!c.ok) return done(res, 200, { ok: false, error: c.reason });
      const bag = bookBagFor(c.acc.id);
      if ('live' in body) bag.np_pub_live = (body.live && typeof body.live === 'object') ? body.live : null;
      if (body.run && typeof body.run === 'object') {
        const runs = Array.isArray(bag.np_pub_runs) ? bag.np_pub_runs : [];
        runs.unshift(body.run);
        bag.np_pub_runs = runs.slice(0, 3);
      }
      if (Array.isArray(body.stuckOps)) {
        let stuck = Array.isArray(bag.np_pub_stuck) ? bag.np_pub_stuck.slice() : [];
        for (const op of body.stuckOps.slice(0, 20)) {
          if (!op || typeof op !== 'object') continue;
          const id = String(op.id || ''); const p = String(op.p || '');
          if (!id) continue;
          stuck = stuck.filter((x) => !(x && String(x.id) === id && String(x.p) === p));
          if (op.op === 'add' && op.it && op.it.k) stuck.push(Object.assign({}, op.it, { id: id, p: p, at: Number(op.it.at) || Date.now() }));
        }
        bag.np_pub_stuck = stuck;
      }
      await persist();
      return done(res, 200, { ok: true });
    }

    /* AI 出门口：执行器自己不落 AI Key——获客/客服那些"要 AI 说话"的动作
     * 一律把 system/user 发到这儿，由服务器拿 .env 里的真 Key 出网、把内容回给执行器。
     * 客户浏览器永远见不到真 Key（与网页侧"标记 Key 出门换真身"是同一条规矩）。 */
    if (path === '/api/exec/ai') {
      const c = checkCred(body);
      if (!c.ok) return done(res, 200, { ok: false, error: c.reason });
      if (typeof ctx.aiChat !== 'function') return done(res, 200, { ok: false, error: '服务器还没配 AI 出网（server/.env 里填 AI_API_KEY）' });
      const system = String(body.system || '');
      const user = String(body.user || '');
      if (!system && !user) return done(res, 200, { ok: false, error: '空的 AI 请求' });
      try {
        const r = await ctx.aiChat({ system, user, maxTokens: Number(body.maxTokens) || 0, accountName: c.acc.name });
        log('EXT', `🤖 代出网 AI（${c.acc.name}）：${String(user).replace(/\s+/g, ' ').slice(0, 40)}…`);
        return done(res, 200, { ok: true, content: String((r && r.content) || ''), usage: (r && r.usage) || {} });
      } catch (e) {
        return done(res, 200, { ok: false, error: '服务器 AI 出网失败：' + ((e && e.message) || e) });
      }
    }

    /* 素材取回（执行器侧）：排期自动下单那类单子只带 blobId——网页交的料由服务器代管
     * （data/blobs/），执行器揣着挂线凭据来这儿把原图/原片取回去（只能拿自己账号的）。 */
    if (path === '/api/exec/blob') {
      const c = checkCred(body);
      if (!c.ok) return done(res, 200, { ok: false, error: c.reason });
      if (typeof ctx.getBlob !== 'function') return done(res, 200, { ok: false, error: '服务器没配素材仓' });
      const b = await ctx.getBlob(String(body.blobId || ''));
      if (!b) return done(res, 200, { ok: false, error: '素材不在服务器上了（可能清过）' });
      if (b.acc && b.acc !== c.acc.id) return done(res, 200, { ok: false, error: '这个素材不是这只账号的' });
      return done(res, 200, { ok: true, name: b.name || '', mime: b.m || 'application/octet-stream', b64: b.buf.toString('base64') });
    }

    /* ── 网页侧（登录会话）────────────────────────────────────── */
    if (path === '/api/exec/order') {
      const acc = resolveAccount(req);
      if (!acc) return done(res, 200, { ok: false, error: '先登录', demo: 'need-account' });
      /* 演示号不派活：网页这侧先把口子堵上（挂线口也拦了演示号） */
      if (acc.kind === 'demo') return done(res, 200, { ok: false, error: DEMO_NO_EXEC_MSG, demo: 'readonly-foundation' });
      const r = await placeOrder(acc, String(body.kind || ''), body.params || {}, 'web');
      return done(res, 200, r);
    }

    if (path === '/api/exec/orders') {
      const acc = resolveAccount(req);
      if (!acc) return done(res, 200, { ok: false, error: '先登录', demo: 'need-account' });
      const h = findHandByAccount(acc.id);
      return done(res, 200, {
        ok: true, killed: !!store.exec_killed,
        expectVersion: expectedHandVersion(),   /* 公网发出去的包是什么版本（网页可拿来提醒升级） */
        hand: publicHand(h),
        bindings: bindingsOf(acc),   // 两个平台各绑的哪个号（没绑的＝null）
        bindState: bindStateOf(acc), // 最近一次开窗认号的结果：ok / mismatch / loggedout / unknown
        orders: cmdsOf(acc.id),
        chain: publicChain(acc.id),   // 搜索链：这一轮 / 后面还有哪几类 / 下一类几点 / 停手原因
        reports: (store.exec_reports[acc.id] || []).slice(-REPORT_KEEP),   // 网页上那根实时进度
      });
    }

    /* 「解绑这台电脑」（D 期·网页点）：把这只手摘掉——旧电脑丢了 / 换机前先摘线。
       旧机器下一次心跳对账就知道自己失效了、当场收队（exec-shell 在凭据失效时会 workStop）；
       在飞的单标作废（它不会再回执了）。之后随时可以在新机器上重新挂线。 */
    if (path === '/api/exec/unpair') {
      const acc = resolveAccount(req);
      if (!acc) return done(res, 200, { ok: false, error: '先登录', demo: 'need-account' });
      const h = findHandByAccount(acc.id);
      if (!h) return done(res, 200, { ok: true, already: true });
      delete store.exec_hands[h.handId];
      dropChain(acc.id, '网页解绑了这台电脑');
      const killed = failInFlight(acc.id, '作废：网页解绑了这台电脑，这单不跑了');
      log('WEB', `🖐 网页解绑了「${acc.name}」的执行器（旧手作废${killed ? '，在飞 ' + killed + ' 单标作废' : ''}）`);
      await persist();
      return done(res, 200, { ok: true, killed });
    }

    /* 「⏹ 停这一趟」（网页上点）——只停当前这一趟活，不熔断、不摘线。
     * 长轮询正挂着就当场送达；执行器忙着跑活（没挂着）就等它下一次心跳对账时补——所以心跳回包也带 stop 标记。 */
    if (path === '/api/exec/stop') {
      const acc = resolveAccount(req);
      if (!acc) return done(res, 200, { ok: false, error: '先登录', demo: 'need-account' });
      const h = findHandByAccount(acc.id);
      if (!h) return done(res, 200, { ok: false, error: '还没挂执行器' });
      h.stopAt = Date.now();
      dropChain(acc.id, '手动「停这一趟」（不弹横幅）');
      const n = deliver({ type: 'stop', reason: '网页点了「停这一趟」', at: h.stopAt }, h.handId);
      log('WEB', `⏹ 网页让「${acc.name}」停这一趟（${n ? '当场送达' : '等心跳补'}）`);
      await persist();
      return done(res, 200, { ok: true, delivered: n });
    }

    /* ── 老板侧 ──────────────────────────────────────────────── */
    if (path === '/api/exec/order-all') {
      if (!isAdmin(req)) return done(res, 403, { ok: false, error: '要管理员口令' });
      const cmds = Object.values(store.exec_cmds || {})
        .sort((a, b) => b.createdAt - a.createdAt).slice(0, 40)
        .map((c) => Object.assign(publicCmd(c), { by: c.by || 'web', accountName: (store.accounts[c.accountId] || {}).name || '' }));
      return done(res, 200, {
        ok: true, killed: !!store.exec_killed,
        hands: Object.values(store.exec_hands || {}).map(publicHand),
        cmds,
        log: store.exec_log.slice(-120),
      });
    }
    /* 发放页的「停这一趟」：认账号（老板侧口令口），与网页侧同一个停令通道 */
    if (path === '/api/exec/admin-stop') {
      if (!isAdmin(req)) return done(res, 403, { ok: false, error: '要管理员口令' });
      const acc = Object.values(store.accounts).find((a) => a.id === String(body.accountId || ''));
      if (!acc) return done(res, 200, { ok: false, error: '没这个号' });
      const h = findHandByAccount(acc.id);
      if (!h) return done(res, 200, { ok: false, error: '这个号还没挂执行器' });
      h.stopAt = Date.now();
      dropChain(acc.id, '老板在发放页点了「停这一趟」（不弹横幅）');
      const n = deliver({ type: 'stop', reason: '老板在发放页点了「停这一趟」', at: h.stopAt }, h.handId);
      log('WEB', `⏹ 老板让「${acc.name}」停这一趟（${n ? '当场送达' : '等心跳补'}）`);
      await persist();
      return done(res, 200, { ok: true, delivered: n });
    }
    if (path === '/api/exec/kill' || path === '/api/exec/unkill') {
      if (!isAdmin(req)) return done(res, 403, { ok: false, error: '要管理员口令' });
      const on = path.endsWith('/kill');
      store.exec_killed = on;
      if (on) for (const accId of Object.keys(store.exec_chains || {})) dropChain(accId, '一键熔断');
      log('WEB', on ? '🖱 一键熔断' : '🖱 解除熔断');
      const n = deliver({ type: on ? 'lock' : 'unlock', reason: on ? '服务器一键熔断' : '服务器解除熔断' });
      log('SRV', `📢 ${on ? '熔断' : '解冻'}指令已送达 ${n} 个在线的执行器`);
      await persist();
      return done(res, 200, { ok: true, delivered: n, killed: on });
    }

    /* 排期到点：立刻看一次表（不等下一个 60 秒节拍；验收/运维用） */
    if (path === '/api/exec/sched-tick') {
      if (!isAdmin(req)) return done(res, 403, { ok: false, error: '要管理员口令' });
      if (!schedRef || typeof schedRef.tickNow !== 'function') return done(res, 200, { ok: false, error: '排期模块没挂上' });
      const r = await schedRef.tickNow();
      return done(res, 200, Object.assign({ ok: true }, r || {}));
    }

    return false;
  }

  function trimCmds() {
    const all = Object.values(store.exec_cmds);
    if (all.length <= CMD_KEEP) return;
    all.sort((a, b) => a.createdAt - b.createdAt);
    for (const c of all.slice(0, all.length - CMD_KEEP)) delete store.exec_cmds[c.id];
  }

  return {
    handle,
    api: {
      placeOrder,                 // 排期模块下单走这条（与网页手点同一链）
      report: reportBy,           // 排期模块往实时进度圈塞行
      attachSched,                // 主程序把排期模块挂上来（sched-tick 口要用）
      sweepStale,                 // D 期房务：超时没回执的单自动作废（exec-sched 每钩叫一次）
      findHandByAccount,
      online,
      accTier,
      rankOf,
      genCode,                    // 开档位那一刻发一个没人用的新码（主程序 set-tier 用）
      kick,                       // 把某账号的执行器踢下线（换码用）
      /* 平台认号（2026-10-23）：名单页/网页读绑定，老板换绑走 clearBinding */
      bindingsOf,
      bindStateOf,
      bindPlatform,
      clearBinding,
      bindLabel: BIND_LABEL,
      checkCred,                  // 云端出片口认扩展发来的挂线凭据（handId+token）走这一份
      /* 搜索链：排期模块推进/清账用（失败停在链上，网页从 chain 读原因） */
      chainOf: publicChain,
      stopChain,
      dropChain,
      pruneChains,
      chainGapMs: CHAIN_GAP_MS,
    },
  };
}
