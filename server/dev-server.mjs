/* 服务器试用 demo · 本机开发服务器
 * v0（第 1 步 · 2026-10-12）：只管把 web/ 端出来。
 * v1（第 2 步 · 2026-10-13）：+ 存储真读真写（data/store.json：内存做真源、改动串行原子落盘）。
 * v2（第 3 步 · 2026-10-13）：+ 后台副本上岗——server/bg/ 里的 background.js 副本在假浏览器
 *     环境（bg-env.mjs）里真跑；/api/action 按白名单放行（诊断&配置 / 发笔记那批纯 AI+存储动作），
 *     白名单以外一律回「要扩展」。AI 走服务器上的 Key（server/.env，账本里只存标记）。
 * v3（第 4 步 · 2026-10-13）：+ "/" 改指 start.html（一屏简版问卷：填完真出人设/卖点/知识库/规划）；
 *     + 空账号自动铺一份建材店演示样例兜底（不填也能先逛）；第一次真实生成前自动清掉样例。
 * v4（2026-10-13 晚）：+ 免费额度与 Key 继承换向——每个 IP 前 N 次生成由服务器 Key 请客
 *     （账本里按 IP 记账；数额在 .env 的 DEMO_FREE_QUOTA，默认 50）；到线后 AI 动作在出门口
 *     被拦下、回"到「设置 → AI 模型配置」填上你自己的 AI Key 就能继续"；填了自己的 Key
 *     就不再走服务器 Key、也不计数（这就是"继承换向"）。看数据/存配置这类动作永远不拦。
 * v6（2026-10-13 傍晚 · 上云）：+ 两道公网防护——①X-Forwarded-For 默认不认（直连公网时它可伪造，
 *     会绕额度/领号上限；挂了真代理再在 .env 配 DEMO_TRUST_PROXY=1 打开）；②每日全站 AI 总预算闸
 *     （跨账号的当日总账，到线全站一起拦；数额在 .env 的 DEMO_DAILY_CAP，默认 500 次/天）。
 * v7（2026-10-13 晚 · 去慢三件）：①存储回包瘦身——set/remove/clear 不再回吐旧值（页面全代码零处
 *     用它；写一次 np_notes 少下几十万字节）；②大图出账本——≥8KB 的 data:image 在入账时搬去
 *     data/blobs/ 存成 /api/blob/<id> 链接（内容哈希去重、开机存量自动迁移；读回照旧当 <img src>
 *     用，同源带 cookie、强缓存）→ 档案键不再被整张 base64 撑大（老板账号 44 万→几千字节）；
 *     ③静态与 API 开 gzip + ETag——工作台反复打开不再整份重下（文本压 6~7 成）。
 *     例外：markImg（印记图）不搬——布局形状里它有 ^data:image 滤网，搬了会被滤掉。
 *     扩展一个字不动，全在服务器这一侧。
 * v5（2026-10-13 中午）：+ 正式版账号体系——一个手机号一个号（称呼＋手机号＋自设密码，无短信）；
 *     进门（点生成那一下）弹领号卡；每个新号自动带一份建材店样例；各账号数据隔开
 *     （一本账分"每人一个小账本"books[账号]，后台副本按请求路由到对应小账本）；
 *     额度挂账号（一号 50 次）；起始页「退出/换账号」；本机 /admin 账号名单页。
 *     存量账本自动升级：旧数据整包搬进「账号模板」，新号都从模板克隆。
 * v8（2026-10-14 · 服务器正式版 A 期）：+ 执行器通道（server/exec-channel.mjs）——服务器当大脑、
 *     扩展当手：执行器登录挂线（/api/exec/pair）→ 心跳/长轮询拉命令 → 干完回执（ack）→ 流水落账本；
 *     网页下单（/api/exec/order，按档位拦）＋ 老板一键熔断（/api/exec/kill）。碰平台的动作永远在
 *     执行器（客户浏览器）里跑，服务器只递纸条＋记账。/api/admin/set-tier 给账号挂档位。
 * v9（2026-10-14 · C 期）：+ 进门与分发——欢迎页撤下（"/" 直落起始页 start.html）；装执行器页
 *     （/setup → web/setup.html）＋下载口（download/executor.zip；MIME 补 .zip/.txt）；网页侧状态带
 *     （web/exec-bridge.js）把"没挂执行器"指向 /setup。
 * v10（2026-10-14 · 排期自动下单 · §8.2 #6 收尾）：+ server/exec-sched.mjs——服务器自己看表：
 *     发布队列到点 / 队列整条每周自动跑 / 日常浏览每天自动跑 → 到点自动下单（与网页手点同一条链）；
 *     网页交的发笔记素材由服务器代管（/api/blob/put 原始上传 → data/blobs/；执行器拿挂线凭据从
 *     /api/exec/blob 取回）；老板侧 /api/exec/sched-tick 可立刻看一次表。静默期/熔断不派单。
 * v11（2026-10-14 · D 期）：+ 多账号 / 换机解绑重挂 / 审计与限流——①网页侧 /api/exec/unpair
 *     （自己解绑这台电脑）＋换机重挂时把旧机器"在飞"的单标作废＋超时没回执的死单由 sweepStale 自动作废
 *     （不自动重发，防重复发到平台）；②下单防连点（同类不重复排、最多排 3 条）；③登录/挂线共用
 *     密码试错闸（同 IP 10 次歇 15 分钟）；④名单页带执行器在线状态，老板侧 /api/exec/order-all 带最近命令。
 *     多账号隔离（一人一本账 / 一只手只递对应账号的单）自 v5/v8 起即成立，D 期补的是"真开两号跑通"与上述收口。
 * 2026-10-15（发放页 · 配对号 · 引导页）：+ 执行器上岗凭据换成「配对号」（exec-channel 认 code）；
 *     开档位那一刻发码（set-tier 里生成，免费档不生成）、老板可换码（/api/admin/new-code，旧码废＋
 *     踢机器）、发放页手工打勾「包发了没」（/api/admin/pack-sent）；名单口带出 pairCode/packSentAt；
 *     + /guide 引导页路由；老板侧新增 /api/exec/admin-stop（发放页「停这一趟」）。
 * 用法：node server/dev-server.mjs  →  http://127.0.0.1:8799/（起始页；popup.html 是完整界面）
 * 规矩：零依赖（只用 node 内置）；碰平台的动作永远不会出现在服务器上——
 *       服务器只管网页、账本、动作表；碰平台全在客户浏览器那一侧（白名单里没有那些名字）。 */
import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { readFileSync, writeFileSync, mkdirSync, createReadStream, existsSync, statSync } from 'node:fs';
import { randomBytes, scryptSync, timingSafeEqual, webcrypto, createHash } from 'node:crypto';
import { gzipSync, brotliCompress, constants as zc } from 'node:zlib';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';
import { bootBackground, DEMO_KEY_MARKER } from './bg-env.mjs';
import { createExecChannel } from './exec-channel.mjs';
import { createExecSched } from './exec-sched.mjs';
import { createFilmJobs } from './film/jobs.mjs';
import { createLipJobs } from './lip/jobs.mjs';
import { ensureTierStore, editionOf, normalizeAcc, setTierTable, tierNow, TIERS, KIND_KEYS } from './tier.mjs';
import {
  ensureAiStore, packSummary, grantPack, removePack, textQuotaInfo, textQuotaBlockedText,
  textQuotaTake, dhQuotaInfo, dhQuotaTake, imagePackTake, imagePackGiveBack,
} from './ai-quota.mjs';
import { DEMO_ACCOUNTS, DEMO_IDS, DEMO_BY_KEY, INDUSTRY_FOUNDATIONS, buildPlan, demoCatalog } from './demo-accounts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = fileURLToPath(new URL('../web/', import.meta.url));
const DATA_DIR = process.env.DEMO_DATA_DIR || fileURLToPath(new URL('./data/', import.meta.url));
const STORE_FILE = join(DATA_DIR, 'store.json');
const BG_DIR = join(HERE, 'bg');
const PORT = Number(process.env.PORT || 8799);
const MAX_BODY = 64 * 1024 * 1024; // 演示够用；知识库带图时值会比较大
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.zip': 'application/zip', '.txt': 'text/plain; charset=utf-8',
};

/* ── 账本：内存做真源（读得快），每次改动串行落盘（防两个请求交叉把文件写坏）。
 *    ★ v2 起账本对象"引用不许换"——后台副本的存储垫片直接抱着这个对象，
 *      重构对象（store = {}）会让两边各说各话，所以 clear 走逐键删除。── */
let store = {};
try {
  const raw = JSON.parse(await readFile(STORE_FILE, 'utf8'));
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) store = raw;
} catch { /* 首次运行：没有账本文件＝空账本 */ }
let writeChain = Promise.resolve();
function persist() {
  const snapshot = JSON.stringify(store);
  writeChain = writeChain.then(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    const tmp = STORE_FILE + '.tmp';
    await writeFile(tmp, snapshot);       // 先写临时文件再改名——中途断电也不会留半截账本
    await rename(tmp, STORE_FILE);
  }).catch((e) => console.error('[demo] 账本落盘失败：', e.message));
  return writeChain;
}

/* ── v5 账号体系（2026-10-13 中午）：一本账分两层——
 *    meta 层（留在根上）：accounts 账号 / sessions 会话 / books 各人的小账本 / signup_ips 领号防刷 / demo_quota 额度；
 *    books 层：每个账号一本小账本（键形状与老账本一模一样），外加一份 books.__template__ 账号模板。
 *    ★ 老账本自动升级：根上除 meta 外的旧键整包搬进模板；每个新号从模板 JSON 深克隆一本
 *      （连 _crypt_salt_v1 盐一起克隆——加密数据才解得开）。
 *    ★ 后台副本按请求路由：bg 每次读写 storage.local 时用 bookBagFor(当前账号) 决定落哪本；
 *      没有请求上下文（启动初始化 / 种子 / 维护）时落模板。
 *    ★ 单个小账本内部仍是老结构（config/tenants/note_plan… 全在里面），扩展代码一个字不用改。 ── */
const META_KEYS = new Set(['accounts', 'sessions', 'books', 'signup_ips', 'demo_quota', 'demo_budget', 'blobs', 'blobs_h',
  /* v8 起：执行器通道的名册层（挂在根上，别被当成"0 号用户旧账"搬进模板） */
  'exec_hands', 'exec_cmds', 'exec_log', 'exec_killed', 'exec_reports',
  /* v10 起：排期到点自动下单的账（exec-sched.mjs 写） */
  'exec_sched',
  /* v11 起：登录/挂线的密码试错账（按 IP 记数——D 期限流） */
  'auth_fails',
  /* 云端出片：排队账本（server/film/jobs.mjs 写；成片落在 data/film-jobs/<任务号>/） */
  'film_jobs',
  /* 2026-10-16 档位收口：全局档位表（四档 × 八格，唯一真源；server/tier.mjs 读写） */
  'tier_table',
  /* 2026-10-21 出图接口：按账号按张的额度账（试用 10 张一次性 / 正式每月 150 张） */
  'image_quota',
  /* 2026-10-21 AI 额度与算力包：文本/数字人的月度账（server/ai-quota.mjs 读写）＋算力包发放记录 */
  'ai_quota', 'ai_packs']);
const BOOK_TEMPLATE = '__template__';
const SESSION_DAYS = 30;
const deepClone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

async function ensureV5Shape() {
  let changed = false;
  for (const k of ['accounts', 'sessions', 'books', 'signup_ips']) {
    if (!store[k] || typeof store[k] !== 'object' || Array.isArray(store[k])) { store[k] = {}; changed = true; }
  }
  /* 存量升级：根上除 meta 外的键全是"0 号用户"的旧账 → 整包搬进模板（就地删，账本引用不换）。 */
  const legacy = Object.keys(store).filter((k) => !META_KEYS.has(k));
  if (legacy.length && !store.books[BOOK_TEMPLATE]) {
    const tpl = {};
    for (const k of legacy) { tpl[k] = store[k]; delete store[k]; }
    store.books[BOOK_TEMPLATE] = tpl;
    console.log(`[demo] v5 升级：旧账本 ${legacy.length} 个键整包搬进账号模板（新号都从模板克隆）`);
    changed = true;
  }
  if (!store.books[BOOK_TEMPLATE]) { store.books[BOOK_TEMPLATE] = {}; changed = true; }
  const now = Date.now();
  for (const [t, s] of Object.entries(store.sessions)) {
    if (!s || !s.expiresAt || s.expiresAt < now) { delete store.sessions[t]; changed = true; }
  }
  if (changed) await persist();
}
await ensureV5Shape();

/* ── 2026-10-16 档位收口：开机把全局档位表 + 每账号的小灶/试用字段补齐（已有值不动）──
 *   这张表是全系统「哪一档开哪几格」的唯一真源；客户端包里那张降为进门默认。 */
ensureTierStore(store);
ensureAiStore(store);
await persist();

/* ── v7 大图外置：账本里只留链接，原图落 data/blobs/ ──
 * 动机：导图长图/配图是整串 data:image/png;base64（一张就 40 万字节级），而档案是
 * 「读整条→改→写整条」——每动一下都把它来回搬。入账时搬出去，读回是一行 URL，
 * 页面照 <img src> 用（同源、自动带 cookie、还能被浏览器强缓存）。
 * 规矩：≥8KB 才搬；markImg 不搬（布局形状里有 ^data:image 滤网，换成链接会被滤没）；
 * 按内容 sha256 去重（同一张反复落账只存一件）。 */
const BLOB_DIR = join(DATA_DIR, 'blobs');
const BLOB_MIN = 8 * 1024;
const BLOB_ID_RE = /^[a-f0-9]{24}$/;
/* 通用落仓（v10）：网页交的发笔记素材（/api/blob/put 原始上传）与账本大图（dataURL）都走这儿。
   按内容 sha256 去重——同一张反复交只存一件；meta.name 给执行器取回时认文件名。 */
function putBlobBuf(buf, mime, name, accId) {
  if (!buf || !buf.length) return null;
  const h = createHash('sha256').update(buf).digest('hex');
  if (!store.blobs) store.blobs = {};
  if (!store.blobs_h) store.blobs_h = {};
  if (store.blobs_h[h] && store.blobs[store.blobs_h[h]]) return store.blobs_h[h];
  const id = randomBytes(12).toString('hex');
  mkdirSync(BLOB_DIR, { recursive: true });
  writeFileSync(join(BLOB_DIR, id), buf);
  store.blobs[id] = { m: mime || 'application/octet-stream', b: buf.length, at: Date.now(), acc: accId || '', name: String(name || '').slice(0, 80) };
  store.blobs_h[h] = id;
  return id;
}
function putBlob(dataUrl, accId) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl);
  if (!m) return null;
  let buf;
  try { buf = Buffer.from(m[2], 'base64'); } catch { return null; }
  const id = putBlobBuf(buf, m[1].toLowerCase(), '', accId);
  return id ? '/api/blob/' + id : null;
}
/* 取回一整件（执行器侧 /api/exec/blob 用）：meta + 原字节 */
async function getBlobFull(id) {
  const meta = (BLOB_ID_RE.test(String(id || '')) && store.blobs) ? store.blobs[id] : null;
  if (!meta) return null;
  try { return { m: meta.m || 'application/octet-stream', name: meta.name || '', acc: meta.acc || '', buf: await readFile(join(BLOB_DIR, id)) }; }
  catch { return null; }
}
/** 递归把大图串换成链接（keyHint＝上一层的键名；同步——blob 落盘是一次性的小事） */
function blobsOut(v, keyHint, accId) {
  if (typeof v === 'string') {
    if (v.length >= BLOB_MIN && keyHint !== 'markImg' && v.startsWith('data:image/')) {
      return putBlob(v, accId) || v;
    }
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => blobsOut(x, keyHint, accId));
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = blobsOut(v[k], k, accId);
    return out;
  }
  return v;
}
/** 开机迁移：存量账本里的大图一次性搬出去（幂等——没有大图就秒过） */
{
  let moved = 0, touched = false;
  for (const [accId, bag] of Object.entries(store.books || {})) {
    if (!bag || typeof bag !== 'object') continue;
    for (const k of Object.keys(bag)) {
      let raw;
      try { raw = JSON.stringify(bag[k]); } catch { continue; }
      if (!raw || raw.indexOf('data:image/') < 0) continue;
      const out = blobsOut(bag[k], k, accId === BOOK_TEMPLATE ? '' : accId);
      if (JSON.stringify(out) !== raw) { bag[k] = out; touched = true; moved++; }
    }
  }
  if (touched) {
    console.log(`[demo] v7 迁移：${moved} 个键里的大图搬出账本 → data/blobs/`);
    await persist();
  }
}

/* 小账本定位：没请求上下文（启动初始化 / 种子 / 维护）→ 模板。 */
function bookBagFor(accountId) {
  if (!accountId) return store.books[BOOK_TEMPLATE];
  if (!store.books[accountId]) store.books[accountId] = deepClone(store.books[BOOK_TEMPLATE] || {});
  return store.books[accountId];
}

/* ── 代加解密（/api/crypt/*）：给「非安全上下文」的页面用 ──
 * 页面从局域网 / 公网地址（非 localhost）打开时，浏览器会禁掉 crypto.subtle——
 * 页面自己锁不了/开不了数据（保存类按钮会当场卡住）。这时页面把这份活交给这里代做：
 * 算法、参数、盐、密文格式与 web/lib/crypto-box.js（及 server/bg 副本）逐项对齐，
 * 产出与本机页面自己算的完全互通。盐就是账号小账本里的 _crypt_salt_v1。 */
const CB_PEPPER = 'xhs-local-vault-2026-09';   // 与 crypto-box.js 的 PEPPER 一致
const CB_ITER = 120000;                        // 与 crypto-box.js 的 STORE_ITER 一致
const CB_PREFIX = 'enc:v1:';
const CB_FMT = 'xhs-enc-v1';
async function cbDeriveKey(saltB64) {
  const base = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(CB_PEPPER), 'PBKDF2', false, ['deriveKey']);
  return webcrypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: Buffer.from(saltB64, 'base64'), iterations: CB_ITER, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
/* 账本里没有盐就生成一把写回（与页面 ensureSalt 同口径：16 字节随机、base64） */
async function cbSaltFor(bag) {
  if (bag._crypt_salt_v1) return bag._crypt_salt_v1;
  const s = Buffer.from(webcrypto.getRandomValues(new Uint8Array(16))).toString('base64');
  bag._crypt_salt_v1 = s;
  await persist();
  return s;
}

/* ── 密码 / 会话 ──
 *    密码：scrypt ＋ 每账号独立随机盐（只存哈希）；会话：cookie demo_session=<token>
 *    （HttpOnly、SameSite=Lax、30 天；上云走 https 时自动带 Secure），token 表在 store.sessions。── */
function hashPass(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, 32);
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}
function verifyPass(password, rec) {
  try {
    const hash = scryptSync(String(password), Buffer.from(rec.salt, 'hex'), 32);
    const want = Buffer.from(rec.hash, 'hex');
    return hash.length === want.length && timingSafeEqual(hash, want);
  } catch { return false; }
}
function normPhone(s) {
  const d = String(s || '').replace(/\D/g, '');
  return (d.length === 11 && d.startsWith('1')) ? d : '';
}
/* 老板侧按「账号id 或 手机号」找号：手机号为空时不能拿空串去匹配——演示号 phone 都是空，
   以前会先命中第一只演示号，开档位/换码/试用全落到它头上。 */
function adminAccountOf(body) {
  const phone = normPhone(body && body.phone);
  const id = String((body && body.accountId) || '');
  return Object.values(store.accounts).find((a) => (id && a.id === id) || (phone && a.phone === phone)) || null;
}
function newToken() { return randomBytes(18).toString('hex'); }

function sessionToken(req) {
  const raw = (req && req.headers && req.headers.cookie) || '';
  const m = /(?:^|;\s*)demo_session=([A-Za-z0-9]+)/.exec(raw);
  return m ? m[1] : '';
}
function resolveAccount(req) {
  const token = sessionToken(req);
  if (!token) return null;
  const s = store.sessions[token];
  if (!s || !s.expiresAt || s.expiresAt < Date.now()) {
    if (s) { delete store.sessions[token]; persist(); }
    return null;
  }
  return store.accounts[s.accountId] || null;
}
function startSession(accountId) {
  const token = newToken();
  store.sessions[token] = { accountId, createdAt: Date.now(), expiresAt: Date.now() + SESSION_DAYS * 86400000 };
  return token;
}
function cookieFor(token, req, maxAgeSec) {
  const secure = /https/.test(String(req.headers['x-forwarded-proto'] || '')) ? '; Secure' : '';
  return `demo_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}
function setSession(res, token, req) { res.setHeader('Set-Cookie', cookieFor(token, req, SESSION_DAYS * 86400)); }
function clearSession(res, req) { res.setHeader('Set-Cookie', cookieFor('', req, 0)); }
/** 网页界面吃的版本摘要：形状与扩展后台那份对齐（顶栏徽标、设置页、锁格都读这些字段），
 *  八格由这台服务器那张档位表算；没登录 / 没配对号 → 只给共用的那三格。 */
function webEdition(acc) {
  const ed = editionOf(acc, store);
  const demo = !!(acc && acc.kind === 'demo');
  return Object.assign({
    type: 'server', licensee: (acc && acc.name) || '', builtAt: 0, expireAt: 0, validDays: 0,
    neverExpires: true, hasBinding: false, tampered: false, keywordMax: 0, noDelay: false,
    boundAccount: { xhsId: '', name: '' },
    demo: demo ? { key: acc.demoKey || '', label: acc.demoLabel || acc.name || '', industry: acc.industry || '' } : null,
    readonlyFoundation: demo,
  }, ed, { label: ed.tierLabel, fromServer: true });
}

/* 工作台首帧按档位预藏：服务器发 popup.html 时就把不属于本档的一级项标出来，
   页面脚本跑起来之前也不会先露一遍（edition-source.js 上锁后会把这三个类摘掉）。 */
function popupBootClasses(ed) {
  const f = (ed && ed.features) || {};
  const cls = [];
  if (!f.autoWater) cls.push('ed-no-huoke');
  if (!f.prospectList) cls.push('ed-no-prospect');
  if (ed && ed.draftOnly) cls.push('ed-draft-only');
  return cls;
}
function popupBootTag(cls) {
  if (!cls.length) return '';
  return '<script>document.documentElement.classList.add(' + cls.map((c) => JSON.stringify(c)).join(',') + ');</script>';
}
function publicAccount(acc) {
  if (!acc) return null;
  const demo = acc.kind === 'demo';
  /* 自己这只手在不在：装机页要看，客户不用再去后台问 */
  const hand = Object.values(store.exec_hands || {}).find((h) => h.accountId === acc.id) || null;
  return {
    id: acc.id, name: acc.name, phone: acc.phone || '', phoneTail: (acc.phone || '').slice(-4),
    createdAt: acc.createdAt, lastAt: acc.lastAt || acc.createdAt,
    pairCode: acc.pairCode || '',   // 自己的码给本人看（起始页账号行）；免费档没有＝空串
    tier: acc.tier || '免费',
    hasExec: !!hand,
    exec: hand ? { online: (Date.now() - (hand.lastSeen || 0)) < 35000, label: hand.label || '', lastSeen: hand.lastSeen || 0 } : null,
    /* 演示号：kind 让前端别把它混进真实客户；底子只读标记随账号走 */
    kind: demo ? 'demo' : 'real',
    demoKey: demo ? (acc.demoKey || '') : '',
    demoLabel: demo ? (acc.demoLabel || acc.name || '') : '',
    industry: demo ? (acc.industry || '') : '',
    readonlyFoundation: demo,
    /* 两个平台各绑的哪个号（2026-10-23）：没绑的＝null；bindState 是最近一次开窗认号的结果 */
    bindings: execCh.api.bindingsOf(acc),
    bindState: execCh.api.bindStateOf(acc),
    /* 这位现在能点哪几格（档 ∪ 小灶加 − 小灶撤；试用期内按试用档）——网页界面吃这个，不再吃包里那张 */
    edition: editionOf(acc, store),
  };
}
/** 这位的 AI 额度一本账（文本 / 出图 / 数字人 / 算力包）；演示号不限本人次数，照旧报「不限」 */
function quotaOf(acc) {
  if (!acc) return null;
  const text = textQuotaInfo(store, acc, quotaUsed(acc.id));
  if (acc.kind === 'demo') {
    return {
      used: 0, max: 0, unlimited: true, monthly: false, mode: 'demo',
      text, image: imageQuotaInfo(acc), dh: dhQuotaInfo(store, acc),
      pack: packSummary(store, acc.id),
    };
  }
  return {
    used: text.used, max: text.max, monthly: text.monthly, mode: text.mode,
    text, image: imageQuotaInfo(acc), dh: dhQuotaInfo(store, acc),
    pack: packSummary(store, acc.id),
  };
}

/* 领号防刷：同一网络（IP）每天最多 signupMax() 个号（默认 5，.env 的 DEMO_SIGNUP_MAX 改）。 */
function dayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function signupRoom(ip) {
  const rec = store.signup_ips[ip];
  if (!rec || rec.day !== dayKey()) return { ok: true, used: 0 };
  const used = Number(rec.count) || 0;
  return { ok: used < signupMax(), used };
}
function bumpSignup(ip) {
  const day = dayKey();
  const rec = store.signup_ips[ip];
  if (!rec || rec.day !== day) store.signup_ips[ip] = { day, count: 1, firstAt: Date.now() };
  else rec.count = (Number(rec.count) || 0) + 1;
}

/* ── server/.env：AI 真 Key 放这（不进 git；账本里只存标记，出门才换真身）── */
function readEnvFile(fp) {
  const out = {};
  try {
    const txt = readFileSync(fp, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      if (line.trim().startsWith('#')) continue;
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[m[1]] = v;
    }
  } catch { /* 没有 .env 就算了 */ }
  return out;
}
function readEnv() {
  const f = readEnvFile(join(HERE, '.env'));
  const q = Number(process.env.DEMO_FREE_QUOTA || f.DEMO_FREE_QUOTA);
  const sm = Number(process.env.DEMO_SIGNUP_MAX || f.DEMO_SIGNUP_MAX);
  const dc = Number(process.env.DEMO_DAILY_CAP || f.DEMO_DAILY_CAP);
  return {
    key: process.env.DEMO_AI_KEY || f.AI_API_KEY || '',
    base: process.env.DEMO_AI_BASE || f.AI_API_BASE || '',
    model: process.env.DEMO_AI_MODEL || f.AI_MODEL || '',
    adminPass: process.env.DEMO_ADMIN_PASS || f.DEMO_ADMIN_PASS || '',
    quota: Number.isFinite(q) && q > 0 ? Math.floor(q) : 50,
    signupMax: Number.isFinite(sm) && sm > 0 ? Math.floor(sm) : 5,
    dailyCap: Number.isFinite(dc) && dc > 0 ? Math.floor(dc) : 500,
    trustProxy: process.env.DEMO_TRUST_PROXY || f.DEMO_TRUST_PROXY || '',
    /* 云端出片四个旋钮（资料/云端出片-确认单.md §5）：一人一天几条 / 一次跑几条 /
       一条最多几幕 / 一条最多几秒 / 素材与成片留几天。.env 里改一行就生效，不用动代码。 */
    filmDaily: Number(process.env.FILM_DAILY || f.FILM_DAILY) || 0,
    filmConc: Number(process.env.FILM_CONC || f.FILM_CONC) || 0,
    filmMaxScenes: Number(process.env.FILM_MAX_SCENES || f.FILM_MAX_SCENES) || 0,
    filmMaxSecs: Number(process.env.FILM_MAX_SECS || f.FILM_MAX_SECS) || 0,
    filmKeepDays: Number(process.env.FILM_KEEP_DAYS || f.FILM_KEEP_DAYS) || 0,
    filmPage: process.env.FILM_PAGE || f.FILM_PAGE || '',
    /* 口播那两档的旋钮（资料/发笔记-口播选出口三档设计.md）：一天接几单 / 一条占用几分钟 /
       次日几点前交片 / 自己念与照片两档的字数上限 / 一段最长几字与最多几段 / 料与成片留几天 /
       照片、单句视频、成片的体积上限。一行一个，不改代码。 */
    lipDailyCap: Number(process.env.LIP_DAILY_CAP || f.LIP_DAILY_CAP) || 0,
    lipPerMins: Number(process.env.LIP_PER_MINS || f.LIP_PER_MINS) || 0,
    lipDueHour: Number(process.env.LIP_DUE_HOUR || f.LIP_DUE_HOUR) || 0,
    lipCapVoice: Number(process.env.LIP_CAP_VOICE || f.LIP_CAP_VOICE) || 0,
    lipCapAvatar: Number(process.env.LIP_CAP_AVATAR || f.LIP_CAP_AVATAR) || 0,
    lipCapSelfup: Number(process.env.LIP_CAP_SELFUP || f.LIP_CAP_SELFUP) || 0,
    lipSegMax: Number(process.env.LIP_SEG_MAX || f.LIP_SEG_MAX) || 0,
    lipSegCount: Number(process.env.LIP_SEG_COUNT || f.LIP_SEG_COUNT) || 0,
    lipKeepDays: Number(process.env.LIP_KEEP_DAYS || f.LIP_KEEP_DAYS) || 0,
    lipMaxPhotoMB: Number(process.env.LIP_MAX_PHOTO_MB || f.LIP_MAX_PHOTO_MB) || 0,
    lipMaxSegMB: Number(process.env.LIP_MAX_SEG_MB || f.LIP_MAX_SEG_MB) || 0,
    lipMaxWholeMB: Number(process.env.LIP_MAX_WHOLE_MB || f.LIP_MAX_WHOLE_MB) || 0,
    lipMaxOutMB: Number(process.env.LIP_MAX_OUT_MB || f.LIP_MAX_OUT_MB) || 0,
    /* 出图接口（资料/发笔记-出图接口-确认单.md）：方舟按量计费的 Key（与文本那把分开）、模型与额度。
       Key 只在这台服务器上，网页和客户浏览器里拿不到；一行一个旋钮，改完重启即生效。 */
    imgKey: process.env.IMAGE_API_KEY || f.IMAGE_API_KEY || process.env.VISION_API_KEY || f.VISION_API_KEY || '',
    imgBase: (process.env.IMAGE_API_BASE || f.IMAGE_API_BASE || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, ''),
    imgModel: process.env.IMAGE_MODEL || f.IMAGE_MODEL || 'doubao-seedream-5-0-flash-260915',
    imgQuotaTrial: posInt(process.env.IMAGE_QUOTA_TRIAL || f.IMAGE_QUOTA_TRIAL, 10),
    imgQuotaMonth: posInt(process.env.IMAGE_QUOTA_MONTH || f.IMAGE_QUOTA_MONTH, 150),
    imgDailyCap: posInt(process.env.IMAGE_DAILY_CAP || f.IMAGE_DAILY_CAP, 500),
    imgPrice: posNum(process.env.IMAGE_PRICE || f.IMAGE_PRICE, 0.12),
    /* 看图（素材库切段认内容）：默认跟出图共用同一把方舟 Key，模型可在 .env 换。
       VISION_PRICE_FRAME 只用来在界面上估个大概（元/帧），不参与计费。 */
    visionKey: process.env.VISION_API_KEY || f.VISION_API_KEY || process.env.IMAGE_API_KEY || f.IMAGE_API_KEY || '',
    visionBase: (process.env.VISION_API_BASE || f.VISION_API_BASE || process.env.IMAGE_API_BASE || f.IMAGE_API_BASE || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, ''),
    visionModel: process.env.VISION_MODEL || f.VISION_MODEL || 'doubao-seed-2-1-lite-260915',
    visionPriceFrame: posNum(process.env.VISION_PRICE_FRAME || f.VISION_PRICE_FRAME, 0.001),
  };
}
function posInt(v, def) { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : def; }
function posNum(v, def) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : def; }

/* ── 云端出片的外部程序路径：.env 里写 FILM_BROWSER / FILM_FFMPEG / FILM_FFPROBE / FILM_PYTHON，
 *    造片工序那份直接看环境变量——开机时把 .env 里这几行补进 process.env（命令行给过的以命令行为准）。 ── */
(() => {
  const f = readEnvFile(join(HERE, '.env'));
  for (const k of ['FILM_BROWSER', 'FILM_FFMPEG', 'FILM_FFPROBE', 'FILM_PYTHON']) {
    if (!process.env[k] && f[k]) process.env[k] = f[k];
  }
})();

/* ── 出图接口（2026-10-21 · 资料/发笔记-出图接口-确认单.md）──
 *    ⑤ 一键出图：网页把这一张的提示词交给服务器，服务器用 .env 里那把方舟按量计费 Key
 *    （IMAGE_API_KEY，与文本那把分开）调 Seedream，图下载回 data/blobs/，只回 /api/blob/<id>。
 *    额度按张记：试用号送 10 张（一次性，不按月恢复）；正式档每月 150 张（1 号自然月滚）；
 *    全站每天再加一道 IMAGE_DAILY_CAP 张的上限（防换号刷）。
 *    先扣后调、失败退回——并发时也不会把额度冲穿；只有服务器半路崩了才可能留下一次已扣。
 *    账本：image_quota={ day:'YYYY-MM-DD', used:<今日全站张数>, by:{ <账号id>:{ month, used, trialUsed, total, ... } } }。 */
function imageMonth() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function imageQuotaRec(accId) {
  const q = (store.image_quota = store.image_quota || { day: '', used: 0, by: {} });
  if (!q.by || typeof q.by !== 'object') q.by = {};
  const month = imageMonth();
  const rec = (q.by[accId] = q.by[accId] || { month, used: 0, trialUsed: 0, total: 0, firstAt: Date.now(), lastAt: 0 });
  if (rec.month !== month) { rec.month = month; rec.used = 0; }   // 正式档按月清零；试用那 10 张永不清
  return rec;
}
function imagePaid(acc) {
  return acc.kind !== 'demo' && tierNow(acc, store.tier_table).label !== '免费';
}
function imageQuotaInfo(acc, env) {
  env = env || readEnv();
  const q = store.image_quota || {};
  const day = budgetDay();
  const month = imageMonth();
  const demo = acc.kind === 'demo';
  const paid = imagePaid(acc);
  const rec = (q.by && q.by[acc.id]) || null;
  const sameMonth = !!(rec && rec.month === month);
  const used = demo ? 0 : (paid ? (sameMonth ? Number(rec.used) || 0 : 0) : ((rec && Number(rec.trialUsed)) || 0));
  const max = demo ? 0 : (paid ? env.imgQuotaMonth : env.imgQuotaTrial);
  const tierLeft = demo ? 0 : Math.max(0, max - used);
  const pk = packSummary(store, acc.id);
  return {
    ok: true, mode: demo ? 'demo' : (paid ? 'paid' : 'trial'), unlimited: demo,
    month, used, max, tierLeft, packLeft: demo ? 0 : pk.left.image, left: tierLeft + (demo ? 0 : pk.left.image),
    keyReady: !!env.imgKey,
    dayUsed: q.day === day ? Number(q.used) || 0 : 0, dayCap: env.imgDailyCap,
    pack: pk,
  };
}
/* 先扣一张：返回 {ok, tok} 才允许去调接口；任何原因没扣成都不发请求。
   付费档先扣当月 150 张、再扣算力包；免费号先扣算力包（会过期）、再扣试用那 10 张；演示号不限张数。 */
function imageQuotaTake(acc) {
  const env = readEnv();
  if (!env.imgKey) return { ok: false, code: 'no-key', error: '出图 Key 还没配，先自己传图（配好后这里就能一键出图）' };
  const q = (store.image_quota = store.image_quota || { day: '', used: 0, by: {} });
  const day = budgetDay();
  if (q.day !== day) { q.day = day; q.used = 0; }
  if ((Number(q.used) || 0) >= env.imgDailyCap) {
    return { ok: false, code: 'day-cap', error: `今天全站出图到上限了（${env.imgDailyCap} 张）——明天再来，或先自己传图` };
  }
  /* 演示号：不按张限，只记全站当日用量与账号总量（演示 / 试用演示不被 10 张卡住） */
  if (acc.kind === 'demo') {
    const rec = imageQuotaRec(acc.id);
    rec.total = (Number(rec.total) || 0) + 1;
    rec.lastAt = Date.now();
    q.used = (Number(q.used) || 0) + 1;
    acc.lastAt = Date.now();
    return { ok: true, tok: { accId: acc.id, paid: false, demo: true, month: rec.month, day } };
  }
  const paid = imagePaid(acc);
  const rec = imageQuotaRec(acc.id);
  const used = paid ? rec.used : rec.trialUsed;
  const max = paid ? env.imgQuotaMonth : env.imgQuotaTrial;
  if (!paid) {
    const p = imagePackTake(store, acc);
    if (p) {
      q.used = (Number(q.used) || 0) + 1;
      if (acc) acc.lastAt = Date.now();
      return { ok: true, tok: { accId: acc.id, paid: false, month: rec.month, day, packId: p.id } };
    }
  }
  if (used < max) {
    if (paid) rec.used += 1; else rec.trialUsed += 1;
    rec.total = (rec.total || 0) + 1;
    rec.lastAt = Date.now();
    q.used = (Number(q.used) || 0) + 1;
    if (acc) acc.lastAt = Date.now();
    return { ok: true, tok: { accId: acc.id, paid, month: rec.month, day } };
  }
  if (paid) {
    const p = imagePackTake(store, acc);
    if (p) {
      q.used = (Number(q.used) || 0) + 1;
      if (acc) acc.lastAt = Date.now();
      return { ok: true, tok: { accId: acc.id, paid: false, month: rec.month, day, packId: p.id } };
    }
  }
  return {
    ok: false, code: 'quota',
    error: paid
      ? `这个月的 ${max} 张出图额度用完了——下月 1 日恢复，或加一份 30 元算力包（+30 张）；也可以先自己传图`
      : `试用送的 ${max} 张出图额度用完了——可以加一份 30 元算力包（+30 张），或先自己传图`,
  };
}
async function imageQuotaGiveBack(tok) {
  if (!tok) return;
  const q = store.image_quota;
  if (!q) return;
  if (tok.demo) {
    if (q.day === tok.day) q.used = Math.max(0, (Number(q.used) || 0) - 1);
    const rec = q.by && q.by[tok.accId];
    if (rec) rec.total = Math.max(0, (Number(rec.total) || 0) - 1);
    await persist();
    return;
  }
  if (tok.packId) {
    imagePackGiveBack(store, tok.accId, tok.packId);
    if (q.day === tok.day) q.used = Math.max(0, (Number(q.used) || 0) - 1);
    await persist();
    return;
  }
  if (q.day === tok.day) q.used = Math.max(0, (Number(q.used) || 0) - 1);
  const rec = q.by && q.by[tok.accId];
  if (rec && rec.month === tok.month) {
    if (tok.paid) rec.used = Math.max(0, (Number(rec.used) || 0) - 1);
    else rec.trialUsed = Math.max(0, (Number(rec.trialUsed) || 0) - 1);
    rec.total = Math.max(0, (Number(rec.total) || 0) - 1);
  }
  await persist();
}
/* 页面递来的尺寸（'竖版 3:4' 之类）→ 方舟 size。只认这三档，别的按 3:4。 */
const IMG_SIZES = { '3:4': '1728x2304', '9:16': '1440x2560', '1:1': '2048x2048' };
function imageSizeOf(v) {
  const m = /(\d+)\s*[:：]\s*(\d+)/.exec(String(v || ''));
  return (m && IMG_SIZES[m[1] + ':' + m[2]]) || IMG_SIZES['3:4'];
}
/* 一次出图：扣额度 → 调方舟 → 下载原图 → 落 data/blobs → 回同源链接；失败退回额度 */
async function genNoteImageOnce(acc, prompt, sizeHint) {
  const take = imageQuotaTake(acc);
  if (!take.ok) return take;
  const env = readEnv();
  const size = imageSizeOf(sizeHint);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 180000);
  try {
    const r = await fetch(env.imgBase + '/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.imgKey },
      body: JSON.stringify({ model: env.imgModel, prompt, size, response_format: 'url', watermark: false }),
      signal: ctl.signal,
    });
    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch { /* 下面按错回 */ }
    if (!r.ok) {
      const msg = (j && j.error && (j.error.message || j.error.code)) || ('HTTP ' + r.status);
      throw new Error(msg);
    }
    if (!j) throw new Error('接口回了看不懂的内容');
    const item = (j.data && j.data[0]) || null;
    let buf = null, mime = 'image/png';
    if (item && item.b64_json) {
      buf = Buffer.from(String(item.b64_json), 'base64');
    } else if (item && item.url) {
      const ir = await fetch(String(item.url), { signal: ctl.signal });
      if (!ir.ok) throw new Error('图下载失败（HTTP ' + ir.status + '）');
      const ct = String(ir.headers.get('content-type') || '').toLowerCase();
      if (ct.indexOf('image/') === 0) mime = ct.split(';')[0];
      buf = Buffer.from(await ir.arrayBuffer());
    }
    if (!buf || !buf.length) throw new Error('接口没回图');
    if (buf.length > 30 * 1024 * 1024) throw new Error('出的图太大（超过 30MB）');
    const id = putBlobBuf(buf, mime, 'gen-' + Date.now() + '.png', acc.id);
    if (!id) throw new Error('图没存下来');
    await persist();
    const q = imageQuotaInfo(acc, env);
    const qTxt = q.mode === 'paid' ? `本月 ${q.used}/${q.max}` : q.unlimited ? '演示号不限' : `试用 ${q.used}/${q.max}`;
    console.log(`[demo] 出图：${acc.name || acc.id} ${size}（${Math.round(buf.length / 1024)}KB）→ ${id}；${qTxt}，今日全站 ${q.dayUsed}/${q.dayCap}`);
    return { ok: true, url: '/api/blob/' + id, blobId: id, size, mode: q.mode, used: q.used, max: q.max, left: q.left, unlimited: !!q.unlimited };
  } catch (e) {
    await imageQuotaGiveBack(take.tok);
    const msg = (e && e.name === 'AbortError') ? '等接口太久（3 分钟）' : String((e && e.message) || e);
    console.log(`[demo] 出图失败（已退回 1 张额度）：${acc.name || acc.id} ${msg}`);
    return { ok: false, code: 'gen-failed', error: '出图失败（没扣张数）：' + msg };
  } finally {
    clearTimeout(timer);
  }
}
async function runImageAction(name, body, req) {
  const acc = resolveAccount(req);
  if (!acc) return { ok: false, error: '先领个号（或登录）就能用了', demo: 'need-account' };
  if (name === 'getImageQuota') return imageQuotaInfo(acc);
  const data = (body && body.data) || {};
  const prompt = String(data.prompt || '').trim();
  if (!prompt) return { ok: false, error: '提示词是空的——先把这一张的画面写出来' };
  if (prompt.length > 4000) return { ok: false, error: '提示词太长了（超过 4000 字）' };
  return genNoteImageOnce(acc, prompt, data.size);
}

/* ── 看图认内容（2026-10-22 · 素材库改版3）──
   客户浏览器只递「压缩后的小图」（data URL），原视频不上传；Key 只在这台服务器上换。
   认完即弃：不落盘、不写日志、不回传图片。方舟账号没开通看图模型时如实回 not-activated，
   界面据此禁用按钮并说明，不假装看懂了。 */
/* 探测图必须 ≥14px：方舟部分看图模型对 1×1 直接回 InvalidParameter，会误判成「未开通」 */
const VISION_TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFElEQVR4nGPYRyJgGNUwqmH4agAABjc6H6TQwGQAAAAASUVORK5CYII=';
let _visionProbe = { at: 0, model: '', keyReady: false, active: false, code: '', error: '', hint: '' };
function visionActivationHint(model) {
  return '去火山方舟控制台 →「开通管理」搜 ' + (model || '看图模型') + ' → 点开通（按量付费）；开通后不用换 Key，回这里点「重新检查」。';
}
/* 判断顺序有讲究：方舟把「图太小」也回成 InvalidParameter，回包里还带着模型名，
   先判「没开通」就会把图的毛病说成没开通——所以先看图、再看网络，最后才说开通。 */
function visionErrInfo(e, model) {
  const raw = String((e && e.message) || e || '看图接口出错');
  const low = raw.toLowerCase();
  if (/too\s*small|too\s*large|dimension|pixel|太小|太大|分辨率/.test(low)) return { code: 'bad-image', error: '发给方舟的小图不合要求（尺寸太小或太大），方舟没收这张图', hint: '这不是没开通——点「重新检查」再试一次；切段、入库都不受影响' };
  if (/401|403|unauthor|invalid.*key|apikey|api key/.test(low)) return { code: 'bad-key', error: '看图 Key 不对或没权限：' + raw, hint: '检查 server/.env 的 IMAGE_API_KEY / VISION_API_KEY' };
  const notOpen = /未开通|not\s*activated|not\s*open|invalid.*(endpoint|model)|model.*not.*found|404/.test(low) || /未开通|不支持.*模型|模型.*不存在/.test(raw);
  if (notOpen) return { code: 'not-activated', error: '这个账号还没开通看图模型「' + (model || '未配置') + '」，认不了画面内容', hint: visionActivationHint(model) };
  if (/timeout|abort|超时/.test(low)) return { code: 'timeout', error: '看图接口等太久了，这次没认成', hint: '网络或方舟繁忙，过会儿再点一次' };
  if (/fetch failed|enotfound|econnrefused|econnreset|econn|certificate|self[- ]signed|unable to verify|socket|dns/.test(low)) return { code: 'network', error: '这台服务器连不上方舟，这次没认成', hint: '这不是没开通——过一会儿点「重新检查」再试；切段、入库都不受影响' };
  return { code: 'vision-failed', error: '看图这次没成：' + raw.slice(0, 160), hint: '点「重新检查」再试一次；切段、入库都不受影响' };
}
function visionJson(text) {
  let s = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try { return JSON.parse(s); } catch (_) { return null; }
}
async function visionChatOnce(env, opts) {
  const o = opts || {};
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Math.max(15000, Number(o.timeout) || 90000));
  try {
    const content = [];
    if (o.text) content.push({ type: 'text', text: String(o.text) });
    (o.images || []).forEach((im) => {
      if (im && /^data:image\//.test(String(im.url || ''))) content.push({ type: 'image_url', image_url: { url: String(im.url) } });
    });
    const r = await fetch(env.visionBase + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.visionKey },
      body: JSON.stringify({
        model: env.visionModel,
        messages: [
          { role: 'system', content: String(o.system || '你只看画面里看得见的东西，不猜人名、身份、品牌，不评价好坏。只按要求的 JSON 回。') },
          { role: 'user', content: content.length > 1 ? content : String(o.text || '') },
        ],
        temperature: Number(o.temperature) >= 0 ? Number(o.temperature) : 0.1,
        max_tokens: Math.max(8, Number(o.maxTokens) || 900),
      }),
      signal: ctl.signal,
    });
    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch (_) {}
    if (!r.ok) {
      const msg = (j && j.error && (j.error.message || j.error.code)) || ('HTTP ' + r.status + (txt ? '：' + txt.slice(0, 180) : ''));
      throw new Error(msg);
    }
    const choice = (j && j.choices && j.choices[0]) || {};
    const out = String(((choice.message && choice.message.content) || choice.text) || '').trim();
    if (!out) throw new Error('看图接口没回内容');
    return { content: out, usage: (j && j.usage) || {} };
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('等看图接口超时');
    throw e;
  } finally { clearTimeout(timer); }
}
async function visionProbe(force) {
  const env = readEnv();
  if (!env.visionKey) {
    _visionProbe = { at: Date.now(), model: env.visionModel, keyReady: false, active: false, code: 'no-key', error: '服务器还没配看图 Key（IMAGE_API_KEY / VISION_API_KEY）', hint: '配好 Key 后回这里点「重新检查」' };
    return _visionProbe;
  }
  if (!force && _visionProbe.at && _visionProbe.model === env.visionModel && Date.now() - _visionProbe.at < (_visionProbe.active ? 10 * 60 * 1000 : 60 * 1000)) return _visionProbe;
  if (budgetUsed() >= dailyCap()) {
    _visionProbe = { at: Date.now(), model: env.visionModel, keyReady: true, active: false, code: 'budget', error: '今天的服务器 AI 总预算用完了', hint: '明天再试，或到「设置 → AI 模型配置」填自己的 Key' };
    return _visionProbe;
  }
  /* 这台机器的出口到北京接口是跨境链路，实测约 20 次有 1 次握手直接超时。
     一次失败就定性「连不上」会把人白拦一场，所以连着试三次；只有网络这一类才重试，
     Key 不对／模型没开通那种再试也是同样报错，当场定性走人。 */
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await visionChatOnce(env, {
        system: '只回 OK 两个字母。',
        text: '这是一张测试小图。如果你能看到图片，只回 OK。',
        images: [{ url: VISION_TINY_PNG }],
        maxTokens: 8, timeout: 30000,
      });
      _visionProbe = { at: Date.now(), model: env.visionModel, keyReady: true, active: true, code: '', error: '', hint: '' };
      return _visionProbe;
    } catch (e) {
      lastErr = e;
      const code = visionErrInfo(e, env.visionModel).code;
      if (code !== 'network' && code !== 'timeout' && code !== 'vision-failed') break;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  const info = visionErrInfo(lastErr, env.visionModel);
  _visionProbe = { at: Date.now(), model: env.visionModel, keyReady: true, active: false, code: info.code, error: info.error, hint: info.hint };
  return _visionProbe;
}
function visionFrameList(frames) {
  const list = Array.isArray(frames) ? frames : [];
  const out = [];
  for (const f of list) {
    if (!f || !/^data:image\//.test(String(f.img || ''))) continue;
    if (String(f.img).length > 900 * 1024) continue;
    const t = Number(f.t);
    if (!isFinite(t) || t < 0) continue;
    out.push({ t: Math.round(t * 100) / 100, img: String(f.img) });
  }
  out.sort((a, b) => a.t - b.t);
  return out.slice(0, 240);
}
function visionTagPool(pool) {
  const arr = Array.isArray(pool) ? pool.map(x => String(x || '').trim()).filter(Boolean) : [];
  return Array.from(new Set(arr)).slice(0, 40);
}
const AI_GRAINS = {
  coarse: { label: '粗', min: 20, target: 25 },
  mid: { label: '中', min: 10, target: 15 },
  fine: { label: '细', min: 5, target: 8 },
};
function aiGrainProfile(grain, dur) {
  const key = AI_GRAINS[grain] ? grain : 'mid';
  const g = AI_GRAINS[key];
  const d = Math.max(0, Number(dur) || 0);
  const minLen = Math.min(g.min, Math.max(2.5, d / 2));
  return {
    key, label: g.label, target: g.target,
    minLen: Math.round(minLen * 10) / 10,
    maxN: Math.max(1, Math.ceil(d / g.target)),
  };
}
function visionPick(items, key) {
  const cnt = new Map();
  items.forEach(x => { const v = String((x && x[key]) || '').trim(); if (v) cnt.set(v, (cnt.get(v) || 0) + 1); });
  let best = '', n = -1;
  cnt.forEach((v, k) => { if (v > n) { n = v; best = k; } });
  return best;
}
function visionSummary(items, pool, seq) {
  const scene = visionPick(items, 'scene');
  const action = visionPick(items, 'action');
  const stage = visionPick(items, 'stage');
  const tags = [];
  if (pool.length) {
    const cnt = new Map();
    items.forEach(x => {
      const t = String((x && x.tag) || '').trim();
      if (t && pool.indexOf(t) >= 0) cnt.set(t, (cnt.get(t) || 0) + 1);
    });
    Array.from(cnt.entries()).sort((a, b) => b[1] - a[1]).forEach(([t]) => { if (tags.length < 2 && tags.indexOf(t) < 0) tags.push(t); });
  }
  const name = (scene && action && scene !== action ? scene + '·' + action : (scene || action || ('第 ' + (Number(seq) + 1) + ' 段'))).slice(0, 24);
  const bits = [];
  if (scene) bits.push('画面是' + scene);
  if (action) bits.push(action);
  if (stage) bits.push(stage);
  return { scene, action, stage, tags, name, desc: (bits.length ? bits.join('，') : '这一段画面里看不到明确内容').slice(0, 80) };
}
function visionStrong(a, b) {
  if (!a || !b) return false;
  if (a.scene && b.scene && a.scene !== b.scene) return true;
  if (a.stage && b.stage && a.stage !== b.stage) return true;
  return false;
}
function visionGroupFromBeats(beats, from, to, pool, base) {
  const items = [];
  for (let i = from; i <= to; i++) items.push(...(beats[i].items || []));
  const sm = visionSummary(items, pool, from);
  const b = base || {};
  const name = String(b.name || '').trim().slice(0, 24) || sm.name;
  const desc = String(b.desc || '').trim().slice(0, 80) || sm.desc;
  const tags = Array.isArray(b.tags) && b.tags.length ? b.tags.slice(0, 2) : sm.tags;
  return { from, to, a: beats[from].a, b: beats[to].b, name, desc, tags };
}
/* 第二遍只发文字：把所有小段描述按时间顺序交给 AI，让它决定哪几段接成一大段。 */
async function visionGroups(env, beats, dur, prof, pool) {
  const lines = beats.map((b, i) => '[' + i + '] ' + b.a.toFixed(1) + '–' + b.b.toFixed(1) + '秒｜房间：' + (b.scene || '不明') +
    '｜动作：' + (b.action || '不明') + '｜阶段：' + (b.stage || '不明') + (b.tags.length ? '｜标签：' + b.tags.join('/') : '')).join('\n');
  const sys = '你在整理一条实拍视频的分段。只按看到的内容整理，不猜人名、身份、品牌，不评价好坏。严格只回 JSON。';
  const text = '你在整理一条实拍视频的分段。下面按时间顺序列出每一小段画面的描述（编号从 0 开始）。\n' +
    '请把讲同一件事、同一工序、同一区域的连续小段接成一大段；不要因为换动作、换工具、换角度、走近走远就断开。\n' +
    '只有换房间 / 区域、施工阶段明显变了、镜头对准完全不同的主体，才断开。宁可少切，不要切碎。\n' +
    '这条视频总长 ' + dur + ' 秒；按「' + prof.label + '」的目标，大约每段 ' + prof.target + ' 秒、最多 ' + prof.maxN + ' 段，每段最短约 ' + prof.minLen + ' 秒。\n' +
    '下面共 ' + beats.length + ' 条，必须每一条都覆盖到、不重不漏、前后相接（第一组从 0 开始，最后一组到 ' + (beats.length - 1) + ' 结束）。\n\n' +
    lines + '\n\n只回 JSON：{"groups":[{"from":0,"to":7,"name":"这一段叫什么（≤24字）","desc":"一句看得见的说明（≤80字）","tag":"从标签池挑0或1个"}]}\n' +
    '标签只能从这些里挑：' + (pool.join('、') || '（不给标签）') + '。';
  const read = (r) => {
    const j = visionJson(r.content);
    const arr = j && Array.isArray(j.groups) ? j.groups : null;
    if (!arr || !arr.length) return null;
    let next = 0;
    for (const raw of arr) {
      const from = Number(raw && raw.from), to = Number(raw && raw.to);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from !== next || to < from || to >= beats.length) return null;
      next = to + 1;
    }
    if (next !== beats.length) return null;
    return arr.map((raw) => {
      const from = Number(raw.from), to = Number(raw.to);
      let tag = String(raw.tag || '').trim();
      if (tag && pool.indexOf(tag) < 0) tag = '';
      return visionGroupFromBeats(beats, from, to, pool, {
        name: String(raw.name || '').trim(),
        desc: String(raw.desc || '').trim(),
        tags: tag ? [tag] : [],
      });
    });
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await visionChatOnce(env, { system: sys, text, maxTokens: 1600, temperature: 0.1, timeout: 90000 });
      const groups = read(r);
      if (groups) return groups;
    } catch (_) {}
  }
  return null;
}
/* 强边界只拆「换房间 / 换阶段」，且两边都够长才拆；不按动作拆。 */
function visionSplitStrong(groups, beats, prof, pool) {
  const out = [];
  groups.forEach((g) => {
    const cuts = [];
    for (let k = g.from; k < g.to; k++) {
      if (!visionStrong(beats[k], beats[k + 1])) continue;
      const left = beats[k].b - beats[g.from].a;
      const right = beats[g.to].b - beats[k + 1].a;
      if (left >= prof.minLen && right >= prof.minLen) cuts.push(k);
    }
    if (!cuts.length) { out.push(g); return; }
    let start = g.from;
    cuts.forEach((k) => { out.push(visionGroupFromBeats(beats, start, k, pool)); start = k + 1; });
    out.push(visionGroupFromBeats(beats, start, g.to, pool));
  });
  return out;
}
/* 档位护栏：短于最少秒数、或多于最多段数时，把最短的往旁边并；只并，不按动作拆。 */
function visionEnforce(groups, beats, prof, pool) {
  const list = groups.map(g => Object.assign({}, g));
  for (let guard = 0; guard < 500; guard++) {
    list.forEach((g) => { g.dur = g.b - g.a; });
    const over = list.length > prof.maxN;
    const hasShort = list.some(g => g.dur < prof.minLen - 0.05);
    if (!over && !hasShort) break;
    let best = null;
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i], b = list[i + 1];
      const strong = visionStrong(beats[a.to], beats[b.from]);
      const touchesShort = a.dur < prof.minLen - 0.05 || b.dur < prof.minLen - 0.05;
      if (strong && !touchesShort) continue;
      const cost = a.dur + b.dur;
      let better = !best;
      if (best && hasShort) {
        if (touchesShort && !best.touchesShort) better = true;
        else if (touchesShort === best.touchesShort && cost < best.cost) better = true;
      } else if (best && cost < best.cost) better = true;
      if (better) best = { i, cost, touchesShort };
    }
    if (!best) break;
    const a = list[best.i], b = list[best.i + 1];
    const merged = visionGroupFromBeats(beats, a.from, b.to, pool);
    merged.grainMerged = true;
    list.splice(best.i, 2, merged);
  }
  return list;
}
/* 分段：第一遍每批 8 帧、1 帧重叠，只记场景/动作/阶段/标签；
   把连续相同的描述攒成候选小段，第二遍整体合并，最后按粗细护栏落段。 */
async function visionSegments(env, data) {
  const frames = visionFrameList(data.frames);
  const dur = Number(data.dur) || 0;
  if (!(dur > 0.5)) throw new Error('这条视频读不出时长');
  if (frames.length < 2) throw new Error('抽到的画面太少，认不了分段');
  const cands = (Array.isArray(data.candidates) ? data.candidates : []).map(Number).filter(t => isFinite(t) && t > 0.4 && t < dur - 0.4).slice(0, 200);
  const pool = visionTagPool(data.tagPool);
  const prof = aiGrainProfile(data.grain, dur);
  const batches = [];
  for (let start = 0; start < frames.length; start += 7) {
    const part = frames.slice(start, start + 8);
    if (part.length >= 2) batches.push({ start, frames: part });
    if (start + 8 >= frames.length) break;
  }
  const labels = new Map();
  const changes = new Set();
  let okN = 0, lastErr = null;
  for (const bt of batches) {
    const lines = bt.frames.map((f, i) => '第' + (i + 1) + '张：t=' + f.t.toFixed(1) + '秒').join('\n');
    const sys = '你在看一条实拍视频的连续画面（家装施工或体能课）。只写画面里看得见的东西：房间/区域、谁在做什么动作、施工到哪一步。你这一步只记录内容，不决定怎么分段。不猜人名、身份、品牌，不评价好坏。严格只回 JSON。';
    const user = '按顺序看这 ' + bt.frames.length + ' 张画面，已知整条视频长 ' + dur + ' 秒。\n' + lines +
      '\n\n请回：{"frames":[{"i":0,"scene":"客厅/卫生间/操场…","action":"画面里谁在做什么","stage":"施工到哪一步，看不见就空","tag":"从给定标签里挑0或1个"}],...每张都要},"changes":[内容明显变化的帧序号（从0开始）...]}\n' +
      '规则：changes 只标这三种——换房间 / 区域、施工阶段明显变了、镜头对准完全不同的主体；同一房间换动作、换工具、换个角度、走近走远都不要标。拿不准就不标。第 1 张只是承接上一批，不要标。标签只能从这些里挑：' + (pool.join('、') || '（不给标签）') + '。';
    try {
      const r = await visionChatOnce(env, { system: sys, text: user, images: bt.frames.map(f => ({ url: f.img })), maxTokens: 1000, temperature: 0.1 });
      const j = visionJson(r.content);
      if (!j) throw new Error('AI 回的格式看不懂');
      okN++;
      (Array.isArray(j.frames) ? j.frames : []).forEach((x) => {
        const li = Number(x && x.i);
        if (!(li >= 0 && li < bt.frames.length)) return;
        labels.set(bt.start + li, {
          scene: String((x && x.scene) || '').trim().slice(0, 20),
          action: String((x && x.action) || '').trim().slice(0, 30),
          stage: String((x && x.stage) || '').trim().slice(0, 30),
          tag: String((x && x.tag) || '').trim().slice(0, 20),
        });
      });
      (Array.isArray(j.changes) ? j.changes : []).forEach((li) => {
        const i = Number(li);
        if (i > 0 && i < bt.frames.length) changes.add(bt.start + i);
      });
    } catch (e) { lastErr = e; }
  }
  if (!okN) throw lastErr || new Error('这次没认出来');
  const runs = [];
  let cur = null;
  frames.forEach((f, i) => {
    const x = labels.get(i) || { scene: '', action: '', stage: '', tag: '' };
    const key = x.scene + '\u0001' + x.action + '\u0001' + x.stage;
    if (!cur || key !== cur.key || changes.has(i)) {
      if (cur) runs.push(cur);
      cur = { i0: i, i1: i, a: i === 0 ? 0 : f.t, b: dur, key, items: [] };
    }
    cur.i1 = i;
    cur.items.push(x);
  });
  if (cur) runs.push(cur);
  const bounds = runs.map(r => Math.round(r.a * 10) / 10).concat(Math.round(dur * 10) / 10);
  /* 刀口落在「最后一张旧场景图」和「第一张新场景图」之间：这一秒里有扫到的真刀口就用它，
     没有就取正中间，不往新场景那边多带画面（最多 0.5 秒，原来最多带 1 秒）。 */
  for (let i = 1; i < runs.length; i++) {
    const oldT = frames[runs[i - 1].i1].t;
    const newT = frames[runs[i].i0].t;
    const mid = (oldT + newT) / 2;
    let at = mid, bestD = Infinity;
    cands.forEach((c) => {
      if (c < oldT - 0.05 || c > newT + 0.05) return;
      const d = Math.abs(c - mid);
      if (d < bestD) { bestD = d; at = c; }
    });
    bounds[i] = Math.round(Math.min(Math.max(at, bounds[i - 1] + 0.3), newT) * 10) / 10;
  }
  runs.forEach((r, i) => { r.a = bounds[i]; r.b = bounds[i + 1]; });
  let beats = runs.map((r, i) => {
    const sm = visionSummary(r.items, pool, i);
    return { a: r.a, b: r.b, items: r.items, scene: sm.scene, action: sm.action, stage: sm.stage, tags: sm.tags, name: sm.name, desc: sm.desc };
  });
  while (beats.length > 120) {
    let pick = -1, pickCost = Infinity;
    for (let i = 0; i < beats.length - 1; i++) {
      if (visionStrong(beats[i], beats[i + 1])) continue;
      const cost = (beats[i].b - beats[i].a) + (beats[i + 1].b - beats[i + 1].a);
      if (cost < pickCost) { pickCost = cost; pick = i; }
    }
    if (pick < 0) {
      for (let i = 0; i < beats.length - 1; i++) {
        const cost = (beats[i].b - beats[i].a) + (beats[i + 1].b - beats[i + 1].a);
        if (cost < pickCost) { pickCost = cost; pick = i; }
      }
    }
    if (pick < 0) break;
    const items = beats[pick].items.concat(beats[pick + 1].items);
    const sm = visionSummary(items, pool, pick);
    beats.splice(pick, 2, { a: beats[pick].a, b: beats[pick + 1].b, items, scene: sm.scene, action: sm.action, stage: sm.stage, tags: sm.tags, name: sm.name, desc: sm.desc });
  }
  const usableChange = Array.from(changes).some((gi) => { const f = frames[gi]; return f && f.t > 0.6 && f.t < dur - 0.6; });
  const whole = beats.length <= 1 && !usableChange;
  let groups, groupCount, secondPass;
  if (beats.length <= 1) {
    groups = [visionGroupFromBeats(beats, 0, beats.length - 1, pool)];
    groupCount = 1;
    secondPass = 'skipped';
  } else {
    const merged = await visionGroups(env, beats, dur, prof, pool);
    if (merged) {
      groups = visionSplitStrong(merged, beats, prof, pool);
      groupCount = merged.length;
      secondPass = 'merged';
    } else {
      groups = beats.map((_, i) => visionGroupFromBeats(beats, i, i, pool));
      groupCount = groups.length;
      secondPass = 'fallback';
    }
  }
  groups = visionEnforce(groups, beats, prof, pool);
  const segs = groups.map((g, i) => ({
    a: Math.round(g.a * 10) / 10,
    b: Math.round(g.b * 10) / 10,
    name: String(g.name || '').trim().slice(0, 24) || ('第 ' + (i + 1) + ' 段'),
    tags: (g.tags || []).slice(0, 2),
    desc: String(g.desc || '').trim().slice(0, 80) || '这一段画面里看不到明确内容',
  })).filter(s => s.b - s.a > 0.05);
  if (!segs.length) throw new Error('AI 没分出可用的段');
  return {
    ok: true, model: env.visionModel, grain: prof.key, segments: segs,
    frames: frames.length, batches: batches.length, partial: okN < batches.length,
    candidates: beats.length, groups: groupCount, whole, secondPass,
  };
}
/* 认段：每批 8 张关键帧，认名字 / 一个标签 / 一句说明；某张失败就回 ok:false，界面保底用模板 */
async function visionLabels(env, data) {
  const segs = (Array.isArray(data.segments) ? data.segments : [])
    .filter(s => s && String(s.id || '') && /^data:image\//.test(String(s.img || '')))
    .slice(0, 24);
  if (!segs.length) throw new Error('没有可认的关键帧');
  const pool = visionTagPool(data.tagPool);
  const items = [];
  for (let start = 0; start < segs.length; start += 8) {
    const part = segs.slice(start, start + 8);
    const text = '这是同一集合里 ' + part.length + ' 段素材的关键帧，顺序如下：\n' +
      part.map((s, i) => '第' + (i + 1) + '张 id=' + s.id + '（' + (Number(s.a) || 0) + '–' + (Number(s.b) || 0) + '秒）').join('\n') +
      '\n\n逐张认，只回 JSON：{"items":[{"id":"原样抄","scene":"这一张在哪个房间 / 区域（≤6字，例：客厅、卫生间、门店门口、操场）","name":"这一段叫什么（房间/区域+动作或施工阶段，≤16字）","tag":"从标签池挑1个","desc":"一句看得见的说明（房间+谁在做什么/施工到哪一步，≤50字）"}]}\n' +
      '标签只能从这些里挑：' + (pool.join('、') || '（不给标签）') + '。不猜人名/身份/品牌，不评价好坏。';
    try {
      const r = await visionChatOnce(env, { text, images: part.map(s => ({ url: String(s.img) })), maxTokens: 900, temperature: 0.1 });
      const j = visionJson(r.content);
      if (!j) throw new Error('AI 回的格式看不懂');
      const got = Array.isArray(j.items) ? j.items : [];
      part.forEach((s) => {
        const hit = got.find(x => x && String(x.id) === String(s.id)) || null;
        if (!hit) { items.push({ id: String(s.id), ok: false, error: '这张没认出来' }); return; }
        let tag = String(hit.tag || '').trim();
        if (tag && pool.indexOf(tag) < 0) tag = '';
        if (!tag && Array.isArray(s.hints)) tag = String(s.hints.find(t => pool.indexOf(String(t)) >= 0) || '');
        items.push({
          id: String(s.id), ok: true,
          scene: String(hit.scene || '').trim().slice(0, 8),
          name: String(hit.name || '').trim().slice(0, 24),
          tags: tag ? [tag] : [],
          desc: String(hit.desc || '').trim().slice(0, 80),
        });
      });
    } catch (e) {
      part.forEach(s => items.push({ id: String(s.id), ok: false, error: String((e && e.message) || e) }));
    }
  }
  const okN = items.filter(x => x.ok).length;
  if (!okN) { const e = items.find(x => x.error); throw new Error((e && e.error) || '这次没认出来'); }
  return { ok: true, model: env.visionModel, items, failed: items.length - okN };
}
async function runVisionAction(name, body, req) {
  const acc = resolveAccount(req);
  if (!acc) return { ok: false, error: '先领个号（或登录）就能用了', demo: 'need-account' };
  const data = (body && body.data) || {};
  if (name === 'npVisionStatus') {
    const p = await visionProbe(!!data.force);
    return {
      ok: true, keyReady: p.keyReady, active: p.active, model: p.model,
      code: p.code, error: p.error, hint: p.hint,
      priceFrame: readEnv().visionPriceFrame,
      budgetLeft: Math.max(0, dailyCap() - budgetUsed()),
    };
  }
  const env = readEnv();
  if (!env.visionKey) return { ok: false, code: 'no-key', error: '服务器还没配看图 Key（IMAGE_API_KEY / VISION_API_KEY）', hint: '配好 Key 后回这里点「重新检查」' };
  if (budgetUsed() >= dailyCap()) return { ok: false, code: 'budget', error: '今天的服务器 AI 总预算用完了（每天上限 ' + dailyCap() + ' 次）——明天再试' };
  try {
    const out = name === 'npVisionSegments' ? await visionSegments(env, data) : await visionLabels(env, data);
    try { await bumpQuota(acc.id, name, true, false); } catch (_) {}
    return out;
  } catch (e) {
    const info = visionErrInfo(e, env.visionModel);
    console.log('[demo] 看图「' + name + '」失败：' + info.error);
    return { ok: false, code: info.code, error: info.error, hint: info.hint };
  }
}
/* 案例正文：只用每段说明里的信息，按挑段顺序写成一篇能直接进草稿的正文 */
async function textChatOnce(opts) {
  const o = opts || {};
  const env = readEnv();
  if (!env.key) throw new Error('服务器还没配写稿 Key（server/.env 的 AI_API_KEY）');
  const base = (env.base || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 120000);
  try {
    const r = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.key },
      body: JSON.stringify({
        model: env.model || 'deepseek-chat',
        messages: [
          { role: 'system', content: String(o.system || '') },
          { role: 'user', content: String(o.user || '') },
        ],
        temperature: Number(o.temperature) >= 0 ? Number(o.temperature) : 0.7,
        max_tokens: Math.max(64, Number(o.maxTokens) || 1200),
      }),
      signal: ctl.signal,
    });
    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch (_) {}
    if (!r.ok) {
      const msg = (j && j.error && (j.error.message || j.error.code)) || ('HTTP ' + r.status);
      throw new Error(msg);
    }
    const choice = (j && j.choices && j.choices[0]) || {};
    const out = String(((choice.message && choice.message.content) || choice.text) || '').trim();
    if (!out) throw new Error('接口没回内容');
    return { content: out, usage: (j && j.usage) || {} };
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('等写稿接口超时');
    throw e;
  } finally { clearTimeout(timer); }
}
async function runCaseArticleAction(body, req) {
  const acc = resolveAccount(req);
  if (!acc) return { ok: false, error: '先领个号（或登录）就能用了', demo: 'need-account' };
  const data = (body && body.data) || {};
  const segs = (Array.isArray(data.segments) ? data.segments : [])
    .map(s => ({
      name: String((s && s.name) || '').trim().slice(0, 30),
      desc: String((s && s.desc) || '').trim().slice(0, 160),
      tags: Array.isArray(s && s.tags) ? s.tags.map(x => String(x || '').trim()).filter(Boolean).slice(0, 3) : [],
    }))
    .filter(s => s.name || s.desc)
    .slice(0, 40);
  if (!segs.length) return { ok: false, error: '还没挑段——先勾几段素材' };
  if (budgetUsed() >= dailyCap()) return { ok: false, code: 'budget', error: '今天的服务器 AI 总预算用完了（每天上限 ' + dailyCap() + ' 次）——明天再试' };
  const info = acc.kind === 'demo' ? null : textQuotaInfo(store, acc, quotaUsed(acc.id));
  if (info && info.left <= 0) return { ok: false, code: 'quota', error: textQuotaBlockedText(acc, info) };
  const colName = String(data.colName || '').trim().slice(0, 40) || '这次做的案例';
  const brief = String(data.brief || '').trim().slice(0, 120);
  const lines = segs.map((s, i) => (i + 1) + '. ' + (s.name || '') + '：' + (s.desc || '') + (s.tags.length ? '（标签：' + s.tags.join('、') + '）' : '')).join('\n');
  try {
    const r = await textChatOnce({
      system: '你是小红书家装/施工案例的写手。只写正文，不写标题，不加话题标签，不用 Markdown，不用编号。只用给出的每段说明里的信息，不编数字、不编人名、不编品牌、不评价好坏。按拍摄顺序写，像带顾客走一遍现场；自然分段，口语一点，不要“首先/其次/最后”这种套话。',
      user: '集合：' + colName + '\n背景：' + (brief || '（没写）') + '\n按这个顺序写一条案例正文：\n' + lines + '\n\n直接给正文，别解释，别加引号。',
      maxTokens: 1200, temperature: 0.65,
    });
    let text = String(r.content || '').trim().replace(/^```[a-z]*\s*/i, '').replace(/```$/, '').trim().replace(/^["“]|["”]$/g, '').trim();
    if (text.length > 1500) text = text.slice(0, 1500);
    if (text.length < 30) throw new Error('写出来的正文太短');
    try { await bumpQuota(acc.id, 'genCaseArticle', true, true); } catch (_) {}
    return { ok: true, text, chars: text.length };
  } catch (e) {
    return { ok: false, code: 'gen-failed', error: '案例正文没写出来：' + String((e && e.message) || e) };
  }
}

/* ── 免费额度（v4 起；v5 起挂账号）：每个账号前 N 次"动服务器 Key 的生成"由我们请客；
 *    到线就拦、要求填自己的 Key（继承换向）。计数口径＝出门口真拨了服务器 Key 的动作——
 *    一次生成算 1 次（一轮问卷算 1 次、以后生成一篇稿算 1 次）；看数据/存配置不花钱，永远不拦。
 *    账本：demo_quota.used[<账号id>].count；N 在 .env 的 DEMO_FREE_QUOTA 一行改。
 *    AsyncLocalStorage：把"这次请求是谁发的（账号/ip）"挂到整个动作执行链上——
 *    后台副本深处的出门口（envFetch）与存储垫片顺着它能认人、记账、找对账本。── */
const quotaCtx = new AsyncLocalStorage();
function quotaMax() { return readEnv().quota; }
function signupMax() { return readEnv().signupMax; }
/* 每日全站总预算闸（v6）：跨账号的当日总账——公网上就算有人换着号领，也烧不穿这个上限。
 * 账本：demo_budget={day:'YYYY-MM-DD',used:N}；N 在 .env 的 DEMO_DAILY_CAP 改（默认 500）。 */
function dailyCap() { return readEnv().dailyCap; }
function budgetDay() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function budgetUsed() {
  const b = store.demo_budget;
  return b && b.day === budgetDay() ? Number(b.used) || 0 : 0;
}
function quotaUsed(accountId) {
  const rec = store.demo_quota && store.demo_quota.used && store.demo_quota.used[accountId];
  return (rec && Number(rec.count)) || 0;
}
async function bumpQuota(accountId, name, personalOk = true, charge = true) {
  const acc = store.accounts[accountId];
  const demo = !!(acc && acc.kind === 'demo');
  /* 演示号：不记本人次数（谁都能接着用），但全站每日总闸照记——防止公用号被刷爆服务器 Key。
     正式号/免费号：只有「扣额度那一类动作」且动作成了才扣（接口失败原样退回）；
     诊断/规划等不扣额度的动作只记全站总闸。全站总闸不管成败都记，因为请求已经发出去、钱已经花了。 */
  let rec = null, tok = null;
  if (!demo && personalOk && charge) {
    const t = textQuotaTake(store, acc, quotaUsed(accountId));
    tok = t && t.ok ? t.tok : null;
    if (!tok) console.log(`[demo] ⚠ 额度没扣成（${name || accountId}）：${(t && t.error) || '未知'}`);
    /* 免费号那 50 次的老账仍记在 demo_quota 里；付费档的月度账与算力包在 ai_quota / ai_packs */
    if (tok && tok.kind === 'legacy') {
      const dq = (store.demo_quota = store.demo_quota || { v: 1, used: {} });
      rec = (dq.used[accountId] = dq.used[accountId] || { count: 0, firstAt: Date.now(), lastAt: 0 });
      rec.count += 1;
      rec.lastAt = Date.now();
    }
  }
  if (acc) acc.lastAt = Date.now();
  const bd = budgetDay();
  const b = (store.demo_budget = store.demo_budget || { day: bd, used: 0 });
  if (b.day !== bd) { b.day = bd; b.used = 0; }
  b.used += 1;
  await persist();
  const q = acc && acc.kind !== 'demo' ? textQuotaInfo(store, acc, quotaUsed(accountId)) : null;
  console.log(demo
    ? `[demo] 演示号出网：${name || accountId}（不限本人次数；今日全站 ${b.used}/${dailyCap()}）`
    : !charge ? `[demo] 不扣本人额度：${name || accountId}（诊断/规划/内部动作；今日全站 ${b.used}/${dailyCap()}）`
    : `[demo] AI 额度：${name || accountId} ${personalOk ? '已扣' : '失败未扣'}${tok && tok.kind === 'pack' ? '（算力包）' : ''}${q ? `；本月文本 ${q.used}/${q.max}${q.packLeft ? '，算力包剩 ' + q.packLeft : ''}` : ''}（今日全站 ${b.used}/${dailyCap()}）`);
}
function clientIp(req) {
  /* 云上直连时，X-Forwarded-For 是访客自己就能伪造的头——默认不认它（认了就能绕额度/领号上限）。
     以后挂了 nginx/CDN 这类真代理，再在 .env 配 DEMO_TRUST_PROXY=1 打开。 */
  if (readEnv().trustProxy === '1') {
    const xf = req && req.headers && req.headers['x-forwarded-for'];
    if (xf) { const first = String(xf).split(',')[0].trim(); if (first) return first; }
  }
  return (req && req.socket && req.socket.remoteAddress) || 'unknown';
}

/* ── 密码试错闸（v11 · D 期限流）：登录与挂线两个口共用一本 IP 账——同一个网络连着试错
 *    AUTH_FAIL_MAX 次，就歇 AUTH_FAIL_WIN_MS 再试（成功一次清零）。挡的是"拿字典硬猜密码"。 ── */
const AUTH_FAIL_MAX = 10;
const AUTH_FAIL_WIN_MS = 15 * 60 * 1000;
function authRec(ip) {
  const f = (store.auth_fails = store.auth_fails || {});
  const r = f[ip];
  if (!r || (Date.now() - (r.firstAt || 0)) > AUTH_FAIL_WIN_MS) return null;
  return r;
}
const authGate = {
  blocked: (ip) => { const r = authRec(ip); return !!r && Number(r.n) >= AUTH_FAIL_MAX; },
  fail: (ip) => {
    const f = (store.auth_fails = store.auth_fails || {});
    const r = authRec(ip);
    if (r) r.n = Number(r.n) + 1;
    else f[ip] = { n: 1, firstAt: Date.now() };
    persist();
  },
  ok: (ip) => { if (store.auth_fails && store.auth_fails[ip]) { delete store.auth_fails[ip]; persist(); } },
};

/* ── AI 出门口（执行器专用 · B 期）：拿 server/.env 里的真 Key 代执行器出网一次。
 *    为什么：执行器（客户浏览器）里绝不落 AI Key——获客评论、AI 客服这些话术生成，
 *    都由执行器把 system/user 发到服务器，服务器出网、把内容回给执行器。
 *    与网页侧"标记 Key 出门换真身"是同一条规矩，只是这条线上压根没有标记、只有服务器自己的 Key。
 *    保护：过每日全站预算闸（防某只执行器空转烧穿）；不占客户的 50 次免费额度（付了费的活）。 ── */
async function aiChatOnce({ system, user, maxTokens, accountName }) {
  const env = readEnv();
  if (!env.key) throw new Error('服务器还没配 AI Key（server/.env 的 AI_API_KEY）');
  if (budgetUsed() >= dailyCap()) throw new Error(`今天的服务器 AI 总预算用完了（每天上限 ${dailyCap()} 次）——明天再跑，或到「设置 → AI 模型配置」填自己的 Key`);
  const base = (env.base || 'https://api.deepseek.com/v1').replace(/\/$/, '');
  const model = env.model || 'deepseek-chat';
  const resp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: String(system || '') },
        { role: 'user', content: String(user || '') },
      ],
      temperature: 0.8,
      max_tokens: Number(maxTokens) > 0 ? Number(maxTokens) : 4096,
    }),
  });
  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    try { const j = await resp.json(); msg = (j && j.error && j.error.message) || (j && j.message) || msg; } catch (_) {}
    throw new Error(msg);
  }
  const j = await resp.json();
  const choice = (j && j.choices && j.choices[0]) || {};
  const content = String(((choice.message && choice.message.content) || choice.text) || '');
  const bd = budgetDay();
  const b = (store.demo_budget = store.demo_budget || { day: bd, used: 0 });
  if (b.day !== bd) { b.day = bd; b.used = 0; }
  b.used += 1;
  await persist();
  console.log(`[demo] 执行器代出网 AI：${accountName || '?'} 已用（今日全站 ${b.used}/${dailyCap()}）`);
  return { content, usage: (j && j.usage) || {} };
}

/* ── 执行器通道（v8 · A 期）：服务器当大脑、扩展当手——下单/命令队列/回执/流水/熔断。
 *    碰平台的动作永远在执行器（客户浏览器）里跑，服务器只递纸条＋记账。接口全在 /api/exec/。 ── */
const execCh = createExecChannel({
  store, persist, json, normPhone, verifyPass, resolveAccount, clientIp, readEnv,
  bookBagFor,             // 进度/回执记到这口账号的账本里（网页读的是同一本）
  aiChat: (p) => aiChatOnce(p),
  getBlob: getBlobFull,   // v10：执行器取回托管素材（/api/exec/blob）
  authGate,               // v11：挂线口过密码试错闸（与网页登录同一本 IP 账）
});

/* ── 排期到点自动下单（v10 · §8.2 #6 收尾）：网页手点单与它共用 placeOrder 一条链。
 *    它只看表、只递纸条（跟网页手点一模一样），碰平台永远在执行器里。 ── */
const execSched = createExecSched({
  store, persist, bookBagFor,
  placeOrder: execCh.api.placeOrder,
  report: execCh.api.report,
  online: execCh.api.online,
  sweepStale: execCh.api.sweepStale,   // v11：每钩顺带扫一遍"超时没回执的死单"
  stopChain: execCh.api.stopChain,     // 搜索链：静默/断线/失败时停手留原因（网页弹红条/橙条）
  pruneChains: execCh.api.pruneChains, // 搜索链：跑完/停手的留 3 天后清掉
});
execCh.api.attachSched(execSched);

/* ── 云端出片（2026-10-16）：服务器自己念配音、自己开没界面的浏览器画画面、自己用剪辑工具压片。
 *    客户机只交这一篇要出的东西（稿子＋分幕＋风格＋底图），片子好了在云端等客户来取；
 *    碰平台的动作一条也不在这里——发还是客户机自己点。排队与配额在 server/film/jobs.mjs。 ── */
const filmJobs = createFilmJobs({
  store, persist, resolveAccount, readEnv, getBlobFull, execCh, clientIp,
  dataDir: DATA_DIR, port: PORT,
});

/* ── 口播工单（2026-10-19）：客户交料（照片/逐段录音）、老板人工做片再传回来，
 *    片子回客户机自己取、位置到了自己发。碰平台的动作一条也不在这里。账本在 server/lip/jobs.mjs。 ── */
const lipJobs = createLipJobs({
  store, persist, resolveAccount, readEnv, getBlobFull, execCh, clientIp, readRawBody,
  dataDir: DATA_DIR,
  aiQuota: {
    info: (acc) => dhQuotaInfo(store, acc),
    take: (acc) => dhQuotaTake(store, acc),
  },
});

/* ── 动作白名单：诊断&配置 + 发笔记里"纯 AI / 纯存储、不碰平台"的那批。
 *    白名单外一律回「这个功能要装了扩展才能用」——不是没做，是规矩：
 *    服务器不碰平台，碰平台的动作只在客户浏览器里跑。 ── */
const WHITELIST = new Set([
  // 配置 / 版本 / 账号状态（纯存储）
  'checkConfig', 'getConfig', 'updateConfig', 'testAiConnection', 'getEdition', 'accountStatus',
  // 人设 / 知识库（诊断&配置）
  'getPersona', 'setPersona', 'clearPersona', 'aiPersonaBuild', 'aiToneProfile',
  'aiKbBuild', 'aiKbSave', 'aiKbImport', 'getKnowledgeBase', 'updateKnowledgeEntry',
  'saveKnowledgeBase', 'clearKnowledgeBase',
  // 问卷同步 / 账号诊断 / 内容规划（AI）
  'aiDiagnosisSync', 'accountDiagnose', 'diagnoseRefine', 'notePlan', 'aiNotePlan',
  'aiNoteStyleAdvice', 'aiWeekPlan', 'aiDeepReport', 'aiSellPointBuild',
  'aiGenerateSellPoints', 'aiGeneratePeople', 'aiGenerateTopics', 'aiGenerateHotspots',
  'aiCategorizeKb', 'aiGenKeywords',
  // 多租户（产品列表）/ 整机备份
  'listTenants', 'switchTenant', 'createTenant', 'renameTenant', 'deleteTenant',
  'exportAllData', 'importAllData',
  // ✍️ 发笔记写稿链（AI）
  'aiRewriteNote', 'aiGenerateWriteVariants', 'aiGenerateDrainVariants', 'aiMindStructure', 'aiMindEdit',
  'aiCaseStages', 'aiCaseVo', 'aiCaseCovers',
  'reviseNote', 'suggestNoteCuts', 'regenNoteDescs', 'genNoteCover', 'genAssetNeeds',
  'genNoteShots', 'genIpStories', 'genIpDraft', 'genNoteLongform',
  // 🖼 出图接口（2026-10-21）：读本月/试用还剩几张 + 真出这一张（服务器持有方舟 Key，不经过后台副本）
  'getImageQuota', 'genNoteImage',
  // 🪟 门面笔记（2026-10-19）：主页置顶那两篇——照钉死提纲逐段填 / 只改那一句（纯 AI，不碰平台）
  'genFacadeNote', 'genFacadeSentence',
  'configAssetKinds',   // 素材库 18 类判类（AI 判「这类该不该有料」，纯 AI＋存储，不碰平台）
  'voiceRewrite', 'genNoteVoiceScript', 'genNoteDvSegs', 'genNoteFilmPicks', 'genNoteFilmScript',
  // 状态 / 配置类（纯存储；执行器动作不放行）
  'getAutoWaterStatus', 'dailyBrowseStatus', 'npPubRearm',
  'interactGuard', 'interactGuardLog',
  // 截流配置与数据融合（纯存储）
  'drainScenarios', 'drainGetScanCfg', 'drainSaveScanCfg', 'drainGetReplenishCfg',
  'drainSaveReplenishCfg', 'drainTrackNote', 'drainImportFound',
  // AI 客服配置 / 通知回访记录（读）
  'getAiCsConfig', 'saveAiCsConfig', 'importAiCsConfig', 'chatFollowGetReplyHistory',
  'setAutoScanChat', 'setMsgWatch',
  // 获客清单读取 + 纯 AI 草拟（不碰平台；演示号也要能真读、真生成，才看得懂页面）
  'getProspectList', 'generateDm', 'optimizeDm', 'chatFollowReply', 'aiCsTouch',
]);

/* ── 扣客户文本额度的动作（写稿 / 改稿 / 出成稿这类"一次生成"）。
 *    账号诊断、内容规划、选题、关键词、素材判类、AI 客服等不扣——跟确认单「其他 AI 动作不扣」一致；
 *    图片走 image_quota，不算文本。没列进来的动作即使拨了服务器 Key，也只记全站总闸。 ── */
const TEXT_CHARGE_ACTIONS = new Set([
  'aiRewriteNote', 'aiGenerateWriteVariants', 'aiGenerateDrainVariants', 'aiMindStructure', 'aiMindEdit',
  'aiCaseStages', 'aiCaseVo', 'aiCaseCovers',
  'reviseNote', 'suggestNoteCuts', 'regenNoteDescs', 'genNoteCover', 'genAssetNeeds',
  'genNoteShots', 'genIpStories', 'genIpDraft', 'genNoteLongform',
  'genFacadeNote', 'genFacadeSentence',
  'voiceRewrite', 'genNoteVoiceScript', 'genNoteDvSegs', 'genNoteFilmPicks', 'genNoteFilmScript',
]);

/* ── 后台副本：启动（失败也不塌——页面照常能翻，动作回"后台没起来"）── */
let bg = null;
let bgBootError = '';
try {
  bg = await bootBackground({
    dir: BG_DIR,
    store,
    persist,
    aiKey: readEnv().key,
    log: (s) => console.log(s),
    bookFor: (accountId) => bookBagFor(accountId),
    requesterCtx: () => quotaCtx.getStore() || null,
    canUseServerKey: (ctx) => {
      if (!(ctx && ctx.accountId)) return false;
      if (budgetUsed() >= dailyCap()) return false;
      const acc = store.accounts[ctx.accountId];
      if (acc && acc.kind === 'demo') return true;   // 演示号不限本人次数（每日全站总闸仍在上面）
      /* 不扣额度的动作（诊断 / 规划 / 内部）不看个人余额——个人余额用完也照样能诊断、排计划 */
      if (!TEXT_CHARGE_ACTIONS.has(String(ctx.action || ''))) return true;
      return textQuotaInfo(store, acc, quotaUsed(ctx.accountId)).left > 0;
    },
    quotaBlockedMessage: () => {
      if (budgetUsed() >= dailyCap()) return `今天的服务器 AI 总预算用完了（每天上限 ${dailyCap()} 次）——明天再来，或到「设置 → AI 模型配置」填上你自己的 AI Key 立刻就能继续`;
      const c = quotaCtx.getStore();
      const acc = c && c.accountId ? store.accounts[c.accountId] : null;
      if (!acc) return 'AI 额度用完了——到「设置 → AI 模型配置」填上你自己的 AI Key 就能继续';
      return textQuotaBlockedText(acc, textQuotaInfo(store, acc, quotaUsed(acc.id)));
    },
  });
} catch (e) {
  bgBootError = e.message;
  console.error('[demo] ⚠ 后台副本没起来（页面/账本不受影响）：', e.message);
}

/* 注入演示 AI 配置：账本里没 Key 且 .env 配了真 Key → 塞标记 Key（出门换真身）。
 * ★ 先等后台自带的启动初始化跑完（租户初始化没有并发守卫——两边同时跑会各建一个租户），
 *   都是本地读写、很快；等不到最多 8 秒，照样往下走。v5 起这些初始化都落在"账号模板"上。 */
async function waitTenantSettled(timeoutMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const tpl = store.books[BOOK_TEMPLATE] || {};
    if (tpl.tenants && tpl.current_tenant_id) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}
/* 演示 AI 输出上限：扩展默认 4096 会被模型"思考"占满（内容规划这类长任务写不出正文），
 * 抬到 16384（扩展报错文案自己的建议值）；用户手动设得更高的不动。 */
const DEMO_MAX_TOKENS = 16384;

async function seedDemoAi() {
  if (!bg) return;
  const env = readEnv();
  try {
    if (!(await waitTenantSettled())) console.log('[demo] ⚠ 等租户初始化超时（继续）');
    const cur = await bg.dispatch({ action: 'getConfig' });
    const curAi = (cur && cur.ok && cur.config && cur.config.ai) || {};
    /* 输出上限校正（2026-10-13 真跑实测：思考 7104 字顶爆 4096、内容规划没出正文）。 */
    if (Number(curAi.maxTokens || 0) < DEMO_MAX_TOKENS) {
      const r = await bg.dispatch({ action: 'updateConfig', data: { ai: { maxTokens: DEMO_MAX_TOKENS } } });
      console.log(r && r.ok
        ? `[demo] AI 最大输出 tokens：${curAi.maxTokens || '(默认)'} → ${DEMO_MAX_TOKENS}（防"思考"占满、长计划写不出来）`
        : '[demo] ⚠ 抬 maxTokens 失败：' + ((r && r.error) || '未知'));
    }
    const hasKey = !!curAi.apiKey;
    if (hasKey) { console.log('[demo] 账本里已有 AI 配置，跳过注入'); return; }
    if (!env.key) {
      console.log('[demo] 还没配 AI Key（server/.env 里填 AI_API_KEY）——AI 类动作会回"还没配"；补上后重启即生效');
      return;
    }
    const ai = { apiKey: DEMO_KEY_MARKER, maxTokens: DEMO_MAX_TOKENS };
    if (env.base) ai.apiBaseUrl = env.base;
    if (env.model) ai.model = env.model;
    const r = await bg.dispatch({ action: 'updateConfig', data: { ai } });
    console.log(r && r.ok
      ? '[demo] 已注入演示 AI 配置（账本里是标记 Key；真 Key 只在服务器出门口用）'
      : '[demo] ⚠ 注入 AI 配置失败：' + ((r && r.error) || '未知'));
  } catch (e) {
    console.log('[demo] ⚠ 注入 AI 配置出错：' + e.message);
  }
}
await seedDemoAi();

/* ── 演示样例兜底：一个建材店的底子（人设 / 6 条卖点 / 知识库 6 条 / 排产 12 篇）。
 *   为什么：试用者不填问卷也要能先把界面逛明白（起始页右上角"不填，先进工作台逛逛"）。
 *   怎么写：配置与知识库一律走后台动作（updateConfig / aiKbSave）——这两块是加密存的，
 *     直接往账本里塞明文，后台读的时候解不开；note_plan 是明文，直接写账本。
 *   何时铺：v5 起铺进「账号模板」——启动时（无请求上下文 → 落模板）先看一眼：
 *     模板里已有真实数据/样例就跳过；没有才铺。之后每个新号从模板克隆，天生自带样例。 ── */
async function seedDemoData() {
  if (!bg) return;
  const tpl = store.books[BOOK_TEMPLATE];
  try {
    if (tpl.demo_preset) { console.log('[demo] 演示样例已在模板里（建材店）'); return; }
    const cfgRes = await bg.dispatch({ action: 'getConfig' });
    const cfg = (cfgRes && cfgRes.config) || {};
    const kbRes = await bg.dispatch({ action: 'getKnowledgeBase' });
    const kbLen = kbRes && Array.isArray(kbRes.entries) ? kbRes.entries.length : 0;
    if ((cfg.persona && cfg.persona.text) || tpl.note_plan || kbLen || (cfg.diagnosis && cfg.diagnosis.signature)) {
      console.log('[demo] 模板里已有真实数据，跳过铺演示样例');
      return;
    }
    const now = Date.now();
    const coverHook = '帮上千户配齐主材的建材店老板';
    const persona = {
      text: [
        '我是在本地建材城开建材店的（示例账号），从送货小工做到自己开店用了 12 年，瓷砖、卫浴、五金辅料都经手过，前后帮上千户业主把装修主材配齐——老房翻新、新房全屋、单独换套卫浴，什么样的预算和坑都见过。',
        '我这人不爱吹参数，店里常年摆着料头让人上手摸：同样叫“全瓷砖”，吸水率、釉面、平整度差一点，上墙下地、厨卫阳台用起来就是两种结果。我不接只图便宜的单，也不承诺“绝对低价”——建材一分钱一分货，我的活是帮你把预算花在刀刃上。',
        '这个号就干一件事：把 12 年卖建材的门道和报价的实话写出来，帮准备装修的业主少花冤枉钱。买建材先来问一句，比完价再来也行。',
      ].join('\n\n'),
      bio: '',
      qa: {},
      updatedAt: now,
      card: {
        identity: '本地建材城建材店老板，从业 12 年',
        proof: '帮上千户配齐主材；瓷砖卫浴五金一手渠道；送货上楼自己带车',
        story: '从建材城送货小工做起，后来自己盘下店面',
        stance: '不接只图便宜的单；不承诺“绝对低价”；不贬低同行',
        catchphrase: '先量尺，再谈价',
        taboo: '不承诺具体价格底线，不贬低同行',
        address: '你',
      },
      coverHook,
    };
    const sellPoints = [
      { title: '十二年只做建材', content: '从送货小工到自己开店，12 年帮上千户业主把主材配齐，什么样的户型预算都见过。' },
      { title: '先量尺再报价', content: '不先谈价格：到现场或以图纸量完尺寸、算完损耗，报价才作数。' },
      { title: '瓷砖卫浴一手拿', content: '瓷砖、卫浴、五金直接对接厂家渠道，同样预算能多配一间，用料说得清来路。' },
      { title: '送货上楼自己带车', content: '送货、上料、多退少补，都是店里自己人，不转手不甩给物流。' },
      { title: '旧房翻新先上门看', content: '翻新怕拆坏、怕尺寸对不上，先上门实测一遍，方案和清单一起给。' },
      { title: '清单写明白', content: '主材、辅料、损耗分开列，哪一项加钱、加多少，白纸黑字。' },
    ];
    const product = {
      name: '瓷砖·卫浴·五金主材',
      description: sellPoints.map((s) => s.title + '：' + s.content).join('\n'),
      sellPoints,
      guideText: '想买建材先私信我，发户型图或尺寸，我先帮你算用量、比价格。',
      coverHook,
    };
    const diagnosis = {
      profile: { name: '我的账号', fans: '0' },
      bio: '',
      answers: [],
      signature: 'demo-preset-v1',
      accountType: '个人IP/创始人型',
      results: {
        persona: { status: 'done', message: '已生成并保存' },
        product: { status: 'done', message: '已保存 6 条卖点及产品信息' },
        knowledge: { status: 'done', message: '新增 6 条，更新 0 条，重复 0 条' },
        plan: { status: 'done', message: '已生成并保存' },
      },
      updatedAt: now,
    };
    const r1 = await bg.dispatch({ action: 'updateConfig', data: { persona, product, diagnosis } });
    if (!r1 || !r1.ok) throw new Error((r1 && r1.error) || 'updateConfig 失败');
    const kbEntries = [
      { title: '全瓷和半瓷，一字之差差在哪', category: '产品介绍', tags: ['瓷砖', '全瓷', '吸水率'], content: '“全瓷”指吸水率 ≤0.5% 的瓷质砖，密度高、硬度大，地上墙上都能用；“半瓷”吸水率高，只适合上墙。判断看包装上吸水率那一栏，或翻背面：全瓷坯体颜色一体、敲声清脆。' },
      { title: '买瓷砖要算多少损耗，一次说清', category: '数据·成本', tags: ['损耗', '预算', '用量'], content: '常规铺法按面积多算 5%~8% 损耗；斜铺、拼花 10%~15% 起。厨房阳台小砖、包立管这些零碎最费料。算完写进单子，多退少补提前说好。' },
      { title: '业主买建材最怕的三件事：价格、色差、找不到人', category: '顾客痛点', tags: ['被坑', '报价', '售后'], content: '业主买建材最怕：①价格说不清，事后一项项加钱；②送来的批次有色差；③出了问题找不到人。这三件事在开单前讲清做法，比报低价管用。' },
      { title: '低价瓷砖都在哪几处省', category: '避坑经验', tags: ['低价', '色差', '平整度'], content: '明显低于行情的瓷砖，多在这几处省：坯体偷薄、釉面薄、平整度差（铺完轻踩就翘边）、色号批次混发。单片看不出，铺完一对比就现形。' },
      { title: '进店三招，自己验瓷砖', category: '使用技巧', tags: ['检测', '平整度', '方法'], content: '进店三招：①两片砖釉面相对立着放，缝隙均匀说明平整度好；②翻背面敲一下，声音清脆发亮的是全瓷；③同色号拿两箱对比，色差一眼看出。不用仪器。' },
      { title: '配货上千户后，我为什么坚持不外包', category: '个人经历', tags: ['配货', '经验', '售后'], content: '配过上千户后发现：建材买得顺不顺，一半看货，一半看人。同样一单，量尺细心、损耗算准、送货上楼、退补痛快，业主记住的是这家店——所以这些环节我全部自己做。' },
    ];
    const r2 = await bg.dispatch({ action: 'aiKbSave', data: { entries: kbEntries } });
    if (!r2 || !r2.ok) throw new Error((r2 && r2.error) || 'aiKbSave 失败');
    const GOAL = {
      howto: '抓一个具体的痛点，把解决方案直接给出来——冷启动期收藏是最快的权重',
      tale: '把知识库抽象成一段故事讲出来，让人第一次刷到就记住你是干什么的、信你不骗人',
      echo: '写一个大家都不敢承认的情绪，换共鸣与评论',
      meme: '用梗点套选题，最容易被转发，把圈外人带进来',
      hot: '借本周热点破圈，扩大曝光面',
    };
    const mix = [
      { type: 'howto', goal: GOAL.howto, ex: '一个能立刻照做的判断标准（3 步 / 一张表）', count: 4, share: 30 },
      { type: 'tale', goal: GOAL.tale, ex: '把一道工艺 / 一段来路，换成古人的同类事讲一遍', count: 3, share: 25 },
      { type: 'echo', goal: GOAL.echo, ex: '一件大家心里都有、嘴上不说的事', count: 2, share: 20 },
      { type: 'meme', goal: GOAL.meme, ex: '把这件事写成一份判决书 / 一套游戏任务', count: 2, share: 15 },
      { type: 'hot', goal: GOAL.hot, ex: '这周大家都在聊的那件事，你怎么看', count: 1, share: 10 },
    ];
    const items = [
      { title: '买瓷砖前先自查这 3 条：色差往往不是砖的问题', angle: '教业主拿两箱对比、看包装色号批次，分清是砖的质量还是批次混发', type: 'howto', kind: 'pitfall', scope: 'related', credential: '12 年配货上千户', kb: '进店三招，自己验瓷砖' },
      { title: '同一档预算，钱怎么花在刀刃上：一张账摆给你看', angle: '把瓷砖、卫浴、五金、辅料四项拆开算，讲清哪项能省哪项不能省', type: 'howto', kind: 'calc', scope: 'related', credential: '瓷砖卫浴一手渠道', kb: '买瓷砖要算多少损耗，一次说清' },
      { title: '被问最多的问题：瓷砖到底多少钱一片', angle: '不给一个死数，先说清决定价格的三个数：规格、吸水率、花色工艺', type: 'howto', kind: 'qna', scope: 'related', credential: '上千户报过价的单', kb: '买瓷砖要算多少损耗，一次说清' },
      { title: '从量尺到送货 7 步：每一步验什么', angle: '按配货顺序列 7 步，每步给一个业主当场能检查的点（对色号、查平整度、点数量）', type: 'howto', kind: 'steps', scope: 'related', credential: '送货上楼自己带车', kb: '配货上千户后，我为什么坚持不外包' },
      { title: '我从送货小工做起，为什么最后自己盘下了建材店', angle: '讲从业 12 年的来路：在建材城扛砖送货、吃过的亏、决定自己开店的那个节点', type: 'tale', kind: 'myway', scope: 'related', credential: '12 年从业 → 自己开店', kb: '' },
      { title: '一个算错损耗的下午，老顾客教我的事', angle: '现场故事：少算两箱砖的代价，以及后来为什么坚持复尺再下单', type: 'tale', kind: 'scene', scope: 'related', credential: '亲身经历', kb: '配货上千户后，我为什么坚持不外包' },
      { title: '“抛釉砖”三个字是怎么来的：一道釉的来路', angle: '讲瓷砖工艺的来路：釉面是怎么抛出来的，为什么耐磨和花色难两全', type: 'tale', kind: 'history', scope: 'related', credential: '一手渠道见过原厂', kb: '全瓷和半瓷，一字之差差在哪' },
      { title: '装修到一半才发现，预算全砸在看不见的地方', angle: '把“预算超支”的处境原样说出来，让正在装修的人对号入座', type: 'echo', kind: 'mirror', scope: 'related', credential: '上千户里一半这么栽', kb: '' },
      { title: '今天劝退了一单，心里反而踏实', angle: '生活切片：一单明显不合适的活，为什么劝别买比做成更对', type: 'echo', kind: 'slice', scope: 'samePeople', credential: '亲身经历', kb: '' },
      { title: '把一片劣质砖写成一份“体检报告”', angle: '用体检报告的文体逐项“体检”低价砖：坯体、釉面、平整度、批次', type: 'meme', kind: 'docform', scope: 'related', credential: '拆包验货见过的坑', kb: '低价瓷砖都在哪几处省' },
      { title: '如果买建材是一场游戏：你到第几关开始崩', angle: '把流程写成游戏关卡：比价、定金、量尺、送货、补货，每关一个坑', type: 'meme', kind: 'sceneswap', scope: 'related', credential: '亲身经历', kb: '' },
      { title: '这周大家都在说“装修降级”，建材这笔钱能不能省', angle: '借“装修降级”的由头，讲哪几项能省、哪几项省了后面更贵', type: 'hot', kind: 'hotIndustry', scope: 'breakout', credential: '12 年行情了解', kb: '买瓷砖要算多少损耗，一次说清' },
    ].map((it, i) => ({ no: i + 1, col: '', day: 0, goal: GOAL[it.type], ...it }));
    const plan = {
      v: 3,
      stage: 'cold',
      stageName: '冷启动期',
      stageNote: '还没信任资产：先让人知道你是干什么的、信你不骗人',
      accountType: '个人IP/创始人型',
      contentFocus: '瓷砖卫浴五金怎么选、怎么买、多少钱——用 12 年配货经验帮装修业主避坑',
      targetPeople: '准备装修、要换窗的业主（正在比价、怕被坑）',
      rhythm: '一周 3 篇，晚上 7-9 点发',
      perWeek: 3,
      timing: '晚上 7-9 点',
      pinned: { title: '12 年建材店老板：买主材的坑，我先替你踩过了', outline: '我是谁（12 年配货上千户）+ 能给你什么（免费帮算用量评估价）+ 去哪找我（看主页简介）' },
      items,
      mix,
      mixWeights: { howto: 30, tale: 25, echo: 20, meme: 15, hot: 10 },
      short: [],
      columns: [],
      weekText: '',
      colProblems: [],
      style: cfg.noteStyle || null,
      materials: { persona: true, kbCount: 6, kbHasMethod: true, kbHasData: true, photoCount: 50, hasChat: true, hasVideo: true },
      map: { unlocked: ['tale', 'echo', 'meme', 'hot', 'howto'], groups: [] },
      generatedAt: now,
      problems: [],
    };
    tpl.note_plan = plan;
    tpl.demo_preset = { v: 1, seededAt: now, note: '建材店样例' };
    await persist();
    console.log('[demo] 已铺演示样例进账号模板：建材店（人设 / 6 条卖点 / 知识库 6 条 / 排产 12 篇）');
  } catch (e) {
    console.log('[demo] ⚠ 铺演示样例出错：' + e.message);
  }
}
await seedDemoData();

/* ── 随便逛逛（2026-10-18）：8 个固定公用演示号 ──
 * 四个行业号（装修建材 / 母婴 / 教培 / 儿童体适能）＋ 四个建材档位体验号（免费/基础/升级/全功能）。
 * 底子：建材直接复用账号模板里那套样例；母婴、教培、儿童体适能在克隆后整份换成人设/卖点/知识库/规划。
 * 规矩：只建一次（bag.demo_seed_v=1），之后访客怎么改都保留——不重置、不自动恢复、不清理。
 * 这些号不带 demo_preset（那是真实新号的「样例」标记，首次真实生成会被清掉）。 */
const DEMO_RO_MSG = '演示号只读，注册自己的号后可改';
const DEMO_CONFIG_KEEP = new Set(['weekPlan']);   // 排期是操作，不算底子

/* 演示号底子只读：动作层先拦一批，存储层再兜一道（规划/知识库是页面直接写 storage 的） */
const DEMO_LOCKED_ACTIONS = new Set([
  // 人设 / 说话风格
  'setPersona', 'clearPersona', 'aiPersonaBuild', 'aiToneProfile',
  // 卖点（注意 aiGenerateSellPoints 是写稿时按已选卖点提炼，纯生成，不在此列）
  'aiSellPointBuild',
  // 知识库
  'aiKbSave', 'aiKbImport', 'aiKbBuild', 'aiCategorizeKb',
  'updateKnowledgeEntry', 'saveKnowledgeBase', 'clearKnowledgeBase',
  // 问卷诊断 / 规划与评估（重新生成一律锁）
  'aiDiagnosisSync', 'accountDiagnose', 'diagnoseRefine', 'notePlan', 'aiNotePlan', 'aiDeepReport',
  // 多产品 / 整机备份
  'switchTenant', 'createTenant', 'renameTenant', 'deleteTenant', 'importAllData',
  // 获客 / AI客服里会真写账本的动作（演示数据只读；纯 AI 草拟不在此列）
  'drainSaveScanCfg', 'drainSaveReplenishCfg', 'drainTrackNote', 'drainImportFound',
  'saveAiCsConfig', 'importAiCsConfig', 'setAutoScanChat', 'setMsgWatch',
]);
const DEMO_LOCKED_STORAGE = new Set([
  'knowledge_base', 'note_plan', 'deep_report', 'note_plan_mix', 'note_columns',
  'tenants', 'current_tenant_id', 'demo_preset', 'demo_seed_v', '_crypt_salt_v1',
  // 获客 / AI客服的业务账本：演示数据只读，访客点真动作也改不动
  'drain_scan_cfg', 'drain_notes', 'drain_queue',
  'auto_water_state', 'auto_water_config', 'auto_water_daily', 'auto_water_history',
  'watering_logs', 'watered_notes', 'replied_comments', 'opened_notes',
  'note_trend_config', 'note_trends', 'topic_pool',
  'prospect_list', 'chat_follow_state', 'chat_follow_queue', 'chat_follow_reply_history',
  'prospect_dm_history', 'ai_cs_daily', 'demo_bench',
  'demo_biz_seed_v', 'demo_biz_seed_day',
]);

function configFoundation(cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  const product = {};
  const p = cfg.product && typeof cfg.product === 'object' ? cfg.product : null;
  if (p) for (const k of Object.keys(p)) if (!DEMO_CONFIG_KEEP.has(k)) product[k] = p[k] === undefined ? null : p[k];
  return { persona: cfg.persona || null, diagnosis: cfg.diagnosis || null, product };
}
function demoConfigTouchesFoundation(partial) {
  if (!partial || typeof partial !== 'object') return false;
  if ('persona' in partial || 'diagnosis' in partial) return true;
  if (partial.product && typeof partial.product === 'object') {
    for (const k of Object.keys(partial.product)) if (!DEMO_CONFIG_KEEP.has(k)) return true;
  }
  return false;
}
function demoStorageBlocked(items, bag) {
  for (const k of Object.keys(items || {})) {
    if (DEMO_LOCKED_STORAGE.has(k) || k.indexOf('tenant_data__') === 0) return k;
    if (k === 'config') {
      const next = items[k];
      const cur = bag && bag.config;
      if (JSON.stringify(configFoundation(next)) !== JSON.stringify(configFoundation(cur))) return k;
    }
  }
  return '';
}
function demoRoResult() {
  return { ok: false, error: DEMO_RO_MSG, demo: 'readonly-foundation' };
}

async function demoSeedCtx(accountId, fn) {
  return quotaCtx.run({ accountId, ip: 'demo-seed', swaps: 0 }, fn);
}

function putDemoBookFields(book, d) {
  book.demo_seed_v = 1;
  book.demo_seed_at = Date.now();
  book.demo_key = d.key;
}

async function seedDemoIndustry(d, foundation) {
  const now = Date.now();
  const f = foundation;
  const persona = {
    text: f.persona.text,
    bio: '',
    qa: {},
    updatedAt: now,
    card: f.persona.card,
    coverHook: f.coverHook,
  };
  const product = {
    name: f.product.name,
    names: [],
    description: f.sellPoints.map((s) => s.title + '：' + s.content).join('\n'),
    sellPoints: f.sellPoints.map((s) => ({ ...s })),
    guideText: f.product.guideText,
    cta: f.product.cta,
    coverHook: f.product.coverHook,
  };
  const diagnosis = {
    profile: { name: '我的账号', fans: '0' },
    bio: '',
    answers: [],
    signature: 'demo-' + d.key + '-v1',
    accountType: f.accountType,
    results: {
      persona: { status: 'done', message: '已生成并保存' },
      product: { status: 'done', message: '已保存 6 条卖点及产品信息' },
      knowledge: { status: 'done', message: '新增 6 条，更新 0 条，重复 0 条' },
      plan: { status: 'done', message: '已生成并保存' },
    },
    updatedAt: now,
  };
  return demoSeedCtx(d.id, async () => {
    /* 克隆来的建材知识库整份换掉；配置走后台动作（加密由后台处理） */
    const rClear = await bg.dispatch({ action: 'clearKnowledgeBase' });
    if (!rClear || !rClear.ok) throw new Error((rClear && rClear.error) || '清空知识库失败');
    const rCfg = await bg.dispatch({ action: 'updateConfig', data: { persona, product, diagnosis } });
    if (!rCfg || !rCfg.ok) throw new Error((rCfg && rCfg.error) || 'updateConfig 失败');
    const rKb = await bg.dispatch({ action: 'aiKbSave', data: { entries: f.kb } });
    if (!rKb || !rKb.ok) throw new Error((rKb && rKb.error) || 'aiKbSave 失败');
    store.books[d.id].note_plan = buildPlan(f, now);
  });
}

async function seedDemoBook(d) {
  const cur = store.books[d.id];
  if (cur && cur.demo_seed_v === 1) return false;
  if (!bg) {
    console.log(`[demo] ⚠ 演示号「${d.name}」：后台副本没起来，底子下次开机再铺`);
    return false;
  }
  const source = d.group === 'tier' ? store.books['demo_deco_full'] : store.books[BOOK_TEMPLATE];
  if (!source || (!source.note_plan && !source.config)) {
    console.log(`[demo] ⚠ 演示号「${d.name}」的底子还没铺好（${d.group === 'tier' ? '建材全功能号' : '账号模板'}是空的），下次开机再试`);
    return false;
  }
  if (!store.books[d.id]) store.books[d.id] = {};
  const bag = store.books[d.id];
  const cloned = deepClone(source);
  for (const k of Object.keys(bag)) delete bag[k];
  Object.assign(bag, cloned);
  delete bag.demo_preset;   // 演示号不挂真实新号的样例标记

  if (d.group === 'tier') {
    /* 四个档位体验号：和建材全功能号同一套底子，只差档位 */
    putDemoBookFields(bag, d);
    await persist();
    console.log(`[demo] 演示号就位：${d.name}（底子＝装修建材全功能号）`);
    return true;
  }
  if (!INDUSTRY_FOUNDATIONS[d.key]) {
    /* 装修建材：模板本身就是这套底子，只补承接话术（模板默认是开发期的占位） */
    const r = await demoSeedCtx(d.id, () => bg.dispatch({
      action: 'updateConfig',
      data: { product: { cta: '想买建材先私信我，发户型图或尺寸，我帮你算用量。', names: [] } },
    }));
    if (!r || !r.ok) throw new Error((r && r.error) || '装修建材承接话术没写进去');
    putDemoBookFields(bag, d);
    await persist();
    console.log(`[demo] 演示号就位：${d.name}（底子＝账号模板里的建材样例）`);
    return true;
  }
  await seedDemoIndustry(d, INDUSTRY_FOUNDATIONS[d.key]);
  putDemoBookFields(bag, d);
  await persist();
  console.log(`[demo] 演示号就位：${d.name}（人设 / 6 条卖点 / 知识库 6 条 / 排产 12 篇）`);
  return true;
}

/* ── 随便逛逛 · 业务演示数据（2026-10-22）──
 * 演示号只铺底子时，获客 / AI客服两页是空的——访客会以为功能坏了。
 * 这里给八个演示号各铺一份「像真跑过一轮」的只读业务数据：搜索列表、笔记池、评论记录、
 * 线索清单、待回通知。四个行业各一套内容，tier 号复用装修建材那套。
 * 规矩：所有人物 / 笔记都以「示例·」开头；这些键在 DEMO_LOCKED_STORAGE 里锁死，访客改不动；
 * 每天首次进号重铺一次，保证「刚刚 / 今天」不过期（访客改不动，所以重铺不会覆盖他的东西）。 */
const DEMO_BIZ_SEED_V = 3;
const DEMO_BIZ = {
  deco: {
    city: '杭州',
    keywords: ['瓷砖怎么选', '卫生间翻新', '半包全包区别', '装修报价明细', '旧房改造', '全屋定制'],
    notes: [
      { sc: 'latest', title: '卫生间翻新踩了3个坑，第2个最费钱', author: '示例·装修日记', likes: 12000, comments: 326, sub: 88, delta: 36, hours: 5, mc: { rank: 2, likes: 36, excerpt: '我们上周刚做完，防水和找坡一样重要，别只盯防水。' } },
      { sc: 'top', title: '瓷砖怎么选？跑完8家店我整理了一张表', author: '示例·建材阿棠', likes: 8567, comments: 412, sub: 96, delta: 12, hours: 9, mc: { rank: 1, likes: 58, excerpt: '先看开间和采光，再看吸水率和防滑，别一上来就问几折。' } },
      { sc: 'local', title: '杭州老房改造｜65㎡半包清单+报价明细', author: '示例·小城装修记', likes: 3421, comments: 188, sub: 42, delta: 8, hours: 8 },
      { sc: 'pain', title: '装修报价看不懂怎么办？求过来人帮我看看', author: '示例·杭漂小两口', likes: 923, comments: 76, sub: 21, delta: 3, hours: 6 },
      { sc: 'top', title: '全屋定制避坑：这5个增项一定要提前问', author: '示例·定制避坑指南', likes: 23000, comments: 508, sub: 132, delta: 21, hours: 12, mc: { rank: 3, likes: 27, excerpt: '见光板、收口条、五金升级，这三个最容易临时加钱。' } },
      { sc: 'latest', title: '旧房改造拆改前，先看这份注意事项', author: '示例·老房改造笔记', likes: 687, comments: 44, sub: 9, delta: 5, hours: 2 },
      { sc: 'rival', title: '装修公司不会告诉你的半包账', author: '示例·整装工作室', likes: 15000, comments: 289, sub: 74, delta: 16, hours: 14, mc: { rank: 4, likes: 19, excerpt: '半包最容易漏的是垃圾清运和成品保护，签合同前问清楚。' } },
    ],
    logs: [
      { n: 0, author: '示例·李女士', comment: '我们家也是卫生间返潮，师傅说防水没做好，你这个后来怎么处理的？', reply: '先别急着砸砖：把地漏周边和阴阳角重新做一遍，闭水 48 小时再看，还返潮就查水管。拿不准可以私信我，帮你看下现场照片。', source: 'batch', hours: 3 },
      { n: 1, author: '示例·王先生', comment: '800×800 和 750×1500 到底怎么选？家里采光一般。', reply: '采光一般先选浅色、哑光，缝少一点更显亮；大板好看但损耗和人工都高，预算紧就 800 的。', source: 'single', hours: 7 },
      { n: 2, author: '示例·陈小姐', comment: '65 平半包大概多少钱？', reply: '杭州这边半包一般按项目算，拆改、水电、泥木、油漆分开列；你把户型图发我，我先帮你估个区间。', source: 'batch', hours: 26 },
    ],
    leads: [
      { nick: '示例·李女士', entry: '评论', n: 0, comment: '我们家也是卫生间返潮，师傅说防水没做好，你这个后来怎么处理的？', signal: '评论里问到卫生间返潮处理', hours: 0.4, intent: 'high', tags: ['卫生间翻新', '近30天'], summary: '家里卫生间返潮，正在找处理办法', keyword: '卫生间翻新', reply: '李女士，返潮先查地漏和阴阳角，闭水 48 小时；还不行就查水管。方便的话拍两张现场照片，我帮你看看该先动哪一步。' },
      { nick: '示例·王先生', entry: '点赞', n: 1, comment: '', signal: '赞了你的评论「瓷砖别只看花色，先看吸水率和防滑」', hours: 1.3, intent: 'medium', tags: ['瓷砖', '预算敏感'], summary: '关注瓷砖选择，已点赞评论', reply: '王先生，选砖先把采光和预算定下来：采光一般选浅色哑光，预算紧就常规尺寸。你大概什么时候开工？我按进度给你列个先后。' },
      { nick: '示例·陈小姐', entry: '关键词命中', n: 2, comment: '65 平半包大概多少钱？', signal: '评论里同时出现「半包」「报价」', hours: 2.6, intent: 'high', tags: ['半包', '杭州'], summary: '65 平老房，正在比半包报价', keyword: '半包全包区别', reply: '陈小姐，65 平半包主要差在拆改量和水电点位。你把户型图发我，我按项目给你列一版，哪项能省、哪项别省都标出来。' },
      { nick: '示例·周先生', entry: '收藏', n: 4, comment: '', signal: '收藏了你的笔记「全屋定制避坑」', hours: 5, intent: 'medium', tags: ['全屋定制'], summary: '准备做全屋定制，先收藏避坑清单', reply: '周先生，定制签合同前把见光板、收口条、五金升级这三项写进报价，后面就不容易被临时加钱。需要的话我发你一份对照清单。' },
      { nick: '示例·赵女士', entry: '关注', n: 5, comment: '', signal: '关注了你', hours: 8, intent: 'low', tags: ['旧房改造'], summary: '关注旧房改造内容，需求还不明确', reply: '赵女士，看到你关注了旧房改造。你家大概哪一年的房子、这次想动哪几个空间？先聊两句，我帮你判断要不要大改。' },
      { nick: '示例·孙先生', entry: '回复', n: 0, comment: '防水刷几遍？', signal: '在你的评论下追问防水遍数', hours: 20, intent: 'high', tags: ['卫生间翻新', '防水'], summary: '正在施工，追问防水做法', reply: '孙先生，墙面一般两遍、地面两到三遍，每遍干透再刷下一遍，阴阳角和管根先做附加层。你家现在做到哪一步了？' },
      { nick: '示例·吴女士', entry: '评论', n: 6, comment: '老房拆墙要注意什么？', signal: '评论里问老房拆墙注意事项', hours: 30, intent: 'medium', tags: ['旧房改造', '拆改'], summary: '老房准备拆改，先问注意事项', await: true, reply: '吴女士，老房先确认哪面是承重墙，再看有没有旧管线；拆之前把水电总阀和相邻墙面拍照留底。你家准备先动哪一面墙？' },
    ],
    msgs: [
      { nick: '示例·郑先生', msg: '那你们半包包含哪些？', ctx: '你在他笔记下评论：半包和全包差在主材谁买，别只看总价。', history: [['assistant', '半包和全包差在主材谁买，别只看总价。'], ['user', '那你们半包包含哪些？']], hours: 0.25, unread: true, status: '谈单中', step: 'talking', intent: 'high', tags: ['半包', '量房'], summary: '正在比半包报价，已问包含项', reply: '包含拆改、水电、泥木、油漆和辅材，主材你自己买；垃圾清运和成品保护我先给你写上，免得后面加钱。' },
      { nick: '示例·何女士', msg: '我先量一下尺寸，晚点发你', ctx: '你私信她：把客厅和卧室的长宽发我，我先帮你估瓷砖用量。', history: [['assistant', '把客厅和卧室的长宽发我，我先帮你估瓷砖用量。'], ['user', '我先量一下尺寸，晚点发你']], hours: 1.2, unread: true, status: '谈单中', step: 'talking', intent: 'medium', tags: ['瓷砖', '用量'], summary: '准备量尺寸，等回传', reply: '好，不着急。量的时候把门窗位置也拍进去，我顺手帮你把损耗算进去。' },
      { nick: '示例·陈先生', msg: '好的，谢谢，我先和家里商量一下', ctx: '你私信他：这是按 65 平做的半包明细，你先对照看看。', history: [['assistant', '这是按 65 平做的半包明细，你先对照看看。'], ['user', '好的，谢谢，我先和家里商量一下']], hours: 26, unread: false, status: '已成交', step: 'closed', intent: 'high', tags: ['半包', '已成交'], summary: '已确认半包方案并成交', sold: true, repliedIncoming: '好的，谢谢，我先和家里商量一下', reply: '好的，商量好跟我说一声，我这边先把开工前的材料清单给你备着。' },
      { nick: '示例·林女士', msg: '你们能上门量房吗？', ctx: '你私信她：先发户型图，我帮你看下大概怎么改。', history: [['assistant', '先发户型图，我帮你看下大概怎么改。'], ['user', '你们能上门量房吗？']], hours: 96, unread: false, status: '已触达', step: 'touched', intent: 'medium', tags: ['量房'], summary: '问上门量房，尚未回复', await: true, reply: '可以的，杭州主城区都能上门。你先说下大概位置和方便的时间，我看看能不能排到这两天。' },
    ],
    bench: {
      n: 0,
      summary: '这条笔记的评论区里，有 3 个人说到了自家的具体情况（返潮怎么处理、防水刷几遍、老房拆墙），可以直接回过去接着聊。',
      hits: [
        { author: '示例·李女士', comment: '我们家也是卫生间返潮，师傅说防水没做好，你这个后来怎么处理的？', why: '评论里问到卫生间返潮怎么处理，家里正为这事发愁', loc: '浙江杭州', same: true, approach: '先给判断',
          copies: [
            '返潮先别急着砸砖：把地漏周边和阴阳角重新看一遍，闭水 48 小时再判断，还返潮就要查水管。拍两张现场照片发过来，我帮你看看该先动哪一步。',
            '返潮大多出在三处：地漏周边、阴阳角、管根。先撬开一小块确认是哪一处，别一上来全屋砸，这两种做法的费用差不少。',
            '我们在杭州做老房翻新，卫生间是先闭水 48 小时验收合格再贴砖。你在哪个区？方便的话去现场看一眼，该动哪儿当面就说清。',
          ],
          labels: ['朋友分享型', '数据分析型', '产品介绍型'] },
        { author: '示例·孙先生', comment: '防水刷几遍？', why: '在你上一条回复底下追问防水遍数，像是要动工了', loc: '浙江', same: true, approach: '直接给做法',
          copies: [
            '墙面一般两遍、地面两到三遍，每遍干透再刷下一遍，阴阳角和管根先做附加层。你家现在做到哪一步了？',
            '遍数其实不是关键，厚度才是：一般刷到 1.5mm 左右，一次刷太厚反而容易开裂。你买的是柔性还是通用型？',
            '我们这边标准做法是墙刚地柔，地面两遍加附加层，做完闭水 48 小时。是自己刷还是师傅做？自己刷我给你排个顺序。',
          ],
          labels: ['朋友分享型', '数据分析型', '产品介绍型'] },
        { author: '示例·吴女士', comment: '老房拆墙要注意什么？', why: '评论里问老房拆墙注意事项，准备动结构', loc: '上海', same: false, approach: '提醒风险',
          copies: [
            '老房先确认哪面是承重墙，再看有没有旧管线；拆之前把水电总阀和相邻墙面拍照留底。你家准备先动哪一面墙？',
            '老房最容易踩两个坑：把轻体墙当成承重墙、拆到旧铸铁管。没有图纸就看墙厚，24 公分以上的那类基本别动。',
            '拆改我们这边是先看房再列清单，主要看墙体和管线走向。你要是在上海，我先发你一份拆改前的自查清单。',
          ],
          labels: ['朋友分享型', '数据分析型', '产品介绍型'] },
      ],
      filler: [
        { author: '示例·周先生', comment: '收藏了，明年装修翻出来对着看', loc: '江苏' },
        { author: '示例·郑女士', comment: '第2个坑我也踩过，看着心疼', loc: '广东' },
        { author: '示例·胡先生', comment: '看哭了，我家墙面也是返潮起皮', loc: '四川' },
        { author: '示例·小陈', comment: '楼主家最后总共花了多少', loc: '北京' },
        { author: '示例·阿蓝', comment: '已转发给老公，让他看着办', loc: '' },
      ],
    },
  },
  baby: {
    city: '苏州',
    keywords: ['待产包清单', '奶粉怎么选', '纸尿裤怎么囤', '宝宝辅食添加', '新生儿护理', '母婴好物'],
    notes: [
      { sc: 'latest', title: '新手爸妈必看｜待产包真正用得上的是这些', author: '示例·新手妈妈小满', likes: 18000, comments: 402, sub: 110, delta: 42, hours: 4, mc: { rank: 2, likes: 41, excerpt: '产褥垫先买一包，不够再补；刀纸看医院要求，别一次囤太多。' } },
      { sc: 'top', title: '奶粉怎么选？对比了6款后我留下这张表', author: '示例·母婴测评阿圆', likes: 6234, comments: 356, sub: 82, delta: 15, hours: 10, mc: { rank: 1, likes: 33, excerpt: '先看段位和配料表，再看预算，别被「越贵越好」带着走。' } },
      { sc: 'local', title: '苏州母婴店探店｜纸尿裤囤货价', author: '示例·苏州宝妈日记', likes: 2876, comments: 143, sub: 31, delta: 6, hours: 7 },
      { sc: 'pain', title: '宝宝辅食添加顺序搞不清怎么办？求有经验的妈妈', author: '示例·六个月宝妈', likes: 745, comments: 68, sub: 19, delta: 2, hours: 5 },
      { sc: 'top', title: '0-1岁育儿好物清单，踩雷的都剔掉了', author: '示例·育儿好物站', likes: 31000, comments: 611, sub: 168, delta: 24, hours: 13, mc: { rank: 3, likes: 52, excerpt: '恒温壶和消毒柜看使用频率，别为了凑单买一堆用不上的。' } },
      { sc: 'latest', title: '夜奶戒不掉，试了这个方法三天见效', author: '示例·睡眠引导师', likes: 5120, comments: 208, sub: 47, delta: 11, hours: 3 },
      { sc: 'rival', title: '母婴店不会主动说的囤货套路', author: '示例·母婴同行', likes: 9800, comments: 177, sub: 52, delta: 9, hours: 15, mc: { rank: 4, likes: 21, excerpt: '临期折扣先看生产日期，纸尿裤别按箱囤，孩子长得快。' } },
    ],
    logs: [
      { n: 0, author: '示例·李女士', comment: '待产包里的产褥垫买多少够用？我预产期下个月', reply: '先买一包十片装，医院一般也会给；不够再让家人补，别一次囤一箱。刀纸先问医院要不要，省得买重。', source: 'batch', hours: 2 },
      { n: 1, author: '示例·张妈妈', comment: '奶粉是不是越贵越好？', reply: '不是，先看段位对不对、配料表前几位是什么，再看孩子喝了胀不胀气。预算内选稳定的，别频繁换。', source: 'single', hours: 6 },
      { n: 2, author: '示例·刘小姐', comment: '苏州这边纸尿裤哪里买便宜？', reply: '我一般对比门店活动和线上大促，先买小包装试，不红屁屁再囤；尺码别跨太多，孩子长得快。', source: 'batch', hours: 27 },
    ],
    leads: [
      { nick: '示例·李女士', entry: '评论', n: 0, comment: '待产包里的产褥垫买多少够用？我预产期下个月', signal: '评论里问待产包用量', hours: 0.5, intent: 'high', tags: ['待产包', '孕晚期'], summary: '预产期下个月，正在备待产包', keyword: '待产包清单', reply: '李女士，产褥垫先买一包十片装就够住院用，不够再补；刀纸先问医院要不要，别买重。你预产期具体哪天？我按时间帮你排个采购顺序。' },
      { nick: '示例·张妈妈', entry: '点赞', n: 1, comment: '', signal: '赞了你的评论「看配料表比看广告靠谱」', hours: 1.5, intent: 'medium', tags: ['奶粉', '成分党'], summary: '选奶粉中，关注配料表', reply: '张妈妈，选奶粉先定段位，再看配料表前几位；孩子喝得稳比买得贵重要。你家宝宝现在几个月？我帮你对一下段位。' },
      { nick: '示例·刘小姐', entry: '关键词命中', n: 2, comment: '苏州这边纸尿裤哪里买便宜？', signal: '评论里同时出现「纸尿裤」「苏州」', hours: 2.8, intent: 'high', tags: ['纸尿裤', '苏州'], summary: '在苏州，想找纸尿裤囤货渠道', keyword: '纸尿裤怎么囤', reply: '刘小姐，纸尿裤先买小包装试，不红屁屁再囤；苏州门店活动我整理过一份，你告诉我宝宝体重，我按尺码给你说怎么买划算。' },
      { nick: '示例·赵妈妈', entry: '收藏', n: 4, comment: '', signal: '收藏了你的笔记「0-1岁育儿好物清单」', hours: 5.5, intent: 'medium', tags: ['育儿好物'], summary: '准备囤育儿好物，先收藏清单', reply: '赵妈妈，清单里恒温壶和消毒柜看使用频率再买，别为凑单囤一堆用不上的。你预产期什么时候？我帮你把必买和可缓的拆开。' },
      { nick: '示例·孙女士', entry: '关注', n: 5, comment: '', signal: '关注了你', hours: 9, intent: 'low', tags: ['夜奶'], summary: '关注夜奶内容，需求还不明确', reply: '孙女士，看到你关注了夜奶这块。宝宝现在几个月、一夜醒几次？先说下情况，我帮你判断是饿还是习惯性醒。' },
      { nick: '示例·周妈妈', entry: '回复', n: 0, comment: '产褥垫和刀纸都要准备吗？', signal: '在你的评论下追问待产包', hours: 21, intent: 'high', tags: ['待产包', '孕晚期'], summary: '追问待产包清单', reply: '周妈妈，产褥垫基本都要，刀纸看医院要求；先问产检医院有没有清单，照着准备最稳。你几周了？' },
      { nick: '示例·吴女士', entry: '评论', n: 6, comment: '夜奶怎么断的？求方法', signal: '评论里问夜奶怎么断', hours: 31, intent: 'medium', tags: ['夜奶', '睡眠'], summary: '想戒夜奶，问方法', await: true, reply: '吴女士，先区分是真饿还是习惯性醒：睡前那顿喂饱，夜里醒了先拍哄不急着喂，每次拉长一点间隔。宝宝现在多大？我按月龄给你说得细一点。' },
    ],
    msgs: [
      { nick: '示例·郑妈妈', msg: '那你们店里奶粉能帮忙留货吗？', ctx: '你私信她：奶粉先按段位选，别频繁换。', history: [['assistant', '奶粉先按段位选，别频繁换。'], ['user', '那你们店里奶粉能帮忙留货吗？']], hours: 0.3, unread: true, status: '谈单中', step: 'talking', intent: 'high', tags: ['奶粉', '苏州'], summary: '想留货，正在确认段位', reply: '可以的，你把宝宝月龄和现在喝的段位发我，我先看店里有没有同段位；留货一般给你留三天，够你过来拿。' },
      { nick: '示例·何女士', msg: '我先按你发的清单整理一下，晚点再问你', ctx: '你私信她：待产包先按医院清单准备，缺的再补。', history: [['assistant', '待产包先按医院清单准备，缺的再补。'], ['user', '我先按你发的清单整理一下，晚点再问你']], hours: 1.1, unread: true, status: '谈单中', step: 'talking', intent: 'medium', tags: ['待产包'], summary: '在整理待产包，等回问', reply: '好，整理的时候把医院要求的那页拍给我，我帮你看看有没有漏的，别到住院前一天才发现缺东西。' },
      { nick: '示例·陈妈妈', msg: '好的，谢谢，我先和家里商量一下', ctx: '你私信她：纸尿裤按体重选尺码，先拿小包装试。', history: [['assistant', '纸尿裤按体重选尺码，先拿小包装试。'], ['user', '好的，谢谢，我先和家里商量一下']], hours: 27, unread: false, status: '已成交', step: 'closed', intent: 'high', tags: ['纸尿裤', '已成交'], summary: '已确认纸尿裤囤货方案', sold: true, repliedIncoming: '好的，谢谢，我先和家里商量一下', reply: '好的，商量好跟我说，我先按宝宝体重把尺码和数量列好。' },
      { nick: '示例·林女士', msg: '周末能来店里看看纸尿裤吗？', ctx: '你私信她：纸尿裤先看尺码和吸水量，别只看价格。', history: [['assistant', '纸尿裤先看尺码和吸水量，别只看价格。'], ['user', '周末能来店里看看纸尿裤吗？']], hours: 96, unread: false, status: '已触达', step: 'touched', intent: 'medium', tags: ['纸尿裤', '到店'], summary: '想周末到店看纸尿裤', await: true, reply: '可以的，周末上午人少一点。你把宝宝体重发我，我提前把合适尺码和两款价位留出来，你到店直接对比就行。' },
    ],
    bench: {
      n: 0,
      summary: '这条笔记底下有 3 条评论带着自家的时间或月龄（预产期下个月、追问待产包、想断夜奶），回过去就能接着往下聊。',
      hits: [
        { author: '示例·李女士', comment: '待产包里的产褥垫买多少够用？我预产期下个月', why: '评论里问待产包用量，预产期就在下个月', loc: '江苏苏州', same: true, approach: '先给数量',
          copies: [
            '产褥垫先拿一包十片装就够住院用，不够再让家人补，别一次囤一箱；刀纸先问产检医院要不要，省得买重。你预产期具体哪天？我按时间帮你排个采购顺序。',
            '按住院三天算：产褥垫一天大概两三片，一包十片刚好，剩下的还能垫在小床边；用不完的那部分基本是囤多了。',
            '我们店里的待产包是按孕周分装的，产褥垫、刀纸、一次性内裤各成一袋。你在苏州哪个区？可以拿医院那份清单来对着补缺口。',
          ],
          labels: ['朋友分享型', '数据分析型', '产品介绍型'] },
        { author: '示例·周妈妈', comment: '产褥垫和刀纸都要准备吗？', why: '在你的评论底下追问待产包两样要不要都买', loc: '江苏', same: true, approach: '说清用途',
          copies: [
            '产褥垫基本都要，刀纸看医院要求；先问产检医院有没有给清单，照着准备最稳。你现在几周了？',
            '两个用途不一样：产褥垫是垫在床上排恶露用，刀纸是生的时候垫身下。先按医院那份清单买，别自己一样囤一堆。',
            '我们一般建议 34 周前把待产包分装好，产褥垫、刀纸、出院穿的一套各一袋。你把医院的清单拍给我，我帮你看还缺什么。',
          ],
          labels: ['朋友分享型', '数据分析型', '产品介绍型'] },
        { author: '示例·吴女士', comment: '夜奶怎么断的？求方法', why: '评论里问断夜奶的具体方法，正在为夜醒发愁', loc: '上海', same: false, approach: '先分情况',
          copies: [
            '先区分是真饿还是习惯性醒：睡前那顿喂饱，夜里醒了先拍哄、不急着喂，每次把间隔拉长一点。宝宝现在多大？我按月龄说得细一些。',
            '断夜奶先看月龄：六个月以上生理上可以断，六个月以下多半是真饿。连着记三天醒的时间点，基本就能看出是哪一种。',
            '我们这边会先按宝宝月龄把白天和睡前的喂养时间排一版，夜醒次数一般跟着往下走。方便说下孩子几个月、一夜醒几次吗？',
          ],
          labels: ['朋友分享型', '数据分析型', '产品介绍型'] },
      ],
      filler: [
        { author: '示例·张奶奶', comment: '我32周开始准备，还来得及吧', loc: '江苏' },
        { author: '示例·林先生', comment: '我家老大当时就是不肯戒奶睡', loc: '广东' },
        { author: '示例·小满', comment: '楼主用的恒温壶是哪个牌子', loc: '浙江' },
        { author: '示例·阿朱', comment: '看完感觉生二胎得先做个攻略', loc: '北京' },
        { author: '示例·董女士', comment: '整理得挺全，已收藏', loc: '' },
      ],
    },
  },
  edu: {
    city: '成都',
    keywords: ['孩子握笔姿势', '幼小衔接', '硬笔书法', '练字方法', '孩子写字慢', '坐姿矫正'],
    notes: [
      { sc: 'latest', title: '孩子握笔姿势不对，练字前先改这个', author: '示例·书法老师林老师', likes: 9420, comments: 287, sub: 76, delta: 28, hours: 4, mc: { rank: 2, likes: 29, excerpt: '先看虎口和笔杆角度，握笔器只是辅助，手部力量才是根。' } },
      { sc: 'top', title: '幼小衔接到底要不要报班？过来人说点实话', author: '示例·一年级妈妈', likes: 14000, comments: 398, sub: 104, delta: 18, hours: 9, mc: { rank: 1, likes: 47, excerpt: '先看孩子坐得住多久、会不会整理书包，比提前学多少字重要。' } },
      { sc: 'local', title: '成都硬笔书法班怎么挑｜试听5家', author: '示例·成都家长圈', likes: 3210, comments: 156, sub: 38, delta: 7, hours: 6 },
      { sc: 'pain', title: '孩子写字慢怎么办？求推荐练字方法', author: '示例·二年级家长', likes: 812, comments: 73, sub: 22, delta: 3, hours: 5 },
      { sc: 'top', title: '一年级练字帖别乱买，这3本够用', author: '示例·练字干货铺', likes: 28000, comments: 487, sub: 119, delta: 20, hours: 12, mc: { rank: 3, likes: 36, excerpt: '先练基本笔画和结构，别一上来就写整篇。' } },
      { sc: 'latest', title: '坐姿矫正三个月，视力保住了', author: '示例·护眼笔记', likes: 5678, comments: 190, sub: 44, delta: 9, hours: 3 },
      { sc: 'rival', title: '写字班招生不会告诉你的排课真相', author: '示例·教培同行', likes: 7600, comments: 166, sub: 41, delta: 8, hours: 14, mc: { rank: 4, likes: 17, excerpt: '试听看老师怎么纠错，不看教室装修和礼品。' } },
    ],
    logs: [
      { n: 0, author: '示例·李妈妈', comment: '我家孩子握笔总是握得很紧，写一会就喊累', reply: '先别急着上练字帖：握笔紧多半是手部力量不够。每天捏橡皮泥、夹豆子五分钟，再调笔杆角度，两周就能看出来。', source: 'batch', hours: 2.5 },
      { n: 1, author: '示例·陈爸爸', comment: '幼小衔接不报班，上一年级会跟不上吗？', reply: '先看孩子能不能坐住二十分钟、会不会自己整理东西；识字和拼音提前碰一点就行，习惯比抢跑重要。', source: 'single', hours: 6.5 },
      { n: 2, author: '示例·刘女士', comment: '成都南门有推荐的硬笔班吗？', reply: '我试听下来主要看老师会不会当场纠错、一个班多少人；南门那几家我可以按你的时间帮你排个试听顺序。', source: 'batch', hours: 28 },
    ],
    leads: [
      { nick: '示例·李妈妈', entry: '评论', n: 0, comment: '我家孩子握笔总是握得很紧，写一会就喊累', signal: '评论里问握笔紧、写字累', hours: 0.4, intent: 'high', tags: ['握笔', '幼小衔接'], summary: '孩子握笔紧，写字容易累', keyword: '孩子握笔姿势', reply: '李妈妈，握笔紧先练手部力量，再调笔杆角度；握笔器只能辅助，别一上来就靠它。孩子几岁、现在写多久会喊累？我按情况给你排个小练习。' },
      { nick: '示例·陈爸爸', entry: '点赞', n: 1, comment: '', signal: '赞了你的评论「先看孩子坐得住多久」', hours: 1.4, intent: 'medium', tags: ['幼小衔接'], summary: '关注幼小衔接，已点赞评论', reply: '陈爸爸，幼小衔接先看习惯：坐得住、会整理、能听指令，比提前学多少字重要。孩子现在大班还是中班？我帮你列个入学前三个月的准备清单。' },
      { nick: '示例·刘女士', entry: '关键词命中', n: 2, comment: '成都南门这边有推荐的硬笔班吗？', signal: '评论里同时出现「硬笔」「成都」', hours: 2.5, intent: 'high', tags: ['硬笔书法', '成都'], summary: '在成都南门找硬笔班', keyword: '硬笔书法', reply: '刘女士，南门这边挑班主要看老师会不会当场纠错、一个班几个孩子。你把周末方便的时间发我，我按试听顺序帮你排一下。' },
      { nick: '示例·张妈妈', entry: '收藏', n: 4, comment: '', signal: '收藏了你的笔记「一年级练字帖别乱买」', hours: 5, intent: 'medium', tags: ['练字帖'], summary: '准备买练字帖，先收藏', reply: '张妈妈，练字帖先练基本笔画和结构，别一上来写整篇；买一本带笔顺的就够，写完再换。孩子现在几年级？我按阶段给你说用哪本。' },
      { nick: '示例·王先生', entry: '关注', n: 5, comment: '', signal: '关注了你', hours: 8, intent: 'low', tags: ['坐姿'], summary: '关注坐姿内容，需求还不明确', reply: '王先生，看到你关注了坐姿这块。孩子平时写作业多久、桌子高度合不合适？先看这两点，再决定要不要矫正器。' },
      { nick: '示例·周妈妈', entry: '回复', n: 0, comment: '握笔器有用吗？', signal: '在你的评论下追问握笔器', hours: 19, intent: 'high', tags: ['握笔', '握笔器'], summary: '问握笔器有没有用', reply: '周妈妈，握笔器能帮孩子找到位置，但不能代替手部力量；每天练五分钟捏夹动作，再配合握笔器，效果更稳。孩子多大了？' },
      { nick: '示例·吴女士', entry: '评论', n: 3, comment: '写字慢是不是因为专注力不够？', signal: '评论里问写字慢的原因', hours: 30, intent: 'medium', tags: ['写字慢', '专注力'], summary: '孩子写字慢，怀疑专注力问题', await: true, reply: '吴女士，写字慢先排三个原因：握笔费力、看一笔写一笔、注意力容易飘。你先观察他是写两分钟就停，还是一直写但很慢？我按表现给你说怎么练。' },
    ],
    msgs: [
      { nick: '示例·郑妈妈', msg: '你们班一周几次课？每次多长时间？', ctx: '你私信她：先带孩子来试听一节，看能不能坐得住。', history: [['assistant', '先带孩子来试听一节，看能不能坐得住。'], ['user', '你们班一周几次课？每次多长时间？']], hours: 0.35, unread: true, status: '谈单中', step: 'talking', intent: 'high', tags: ['硬笔书法', '排课'], summary: '在问排课，准备试听', reply: '一周两次，一次六十分钟，前二十分钟讲结构、后面练。孩子刚上一年级的话，先按一周一次过渡也行，你更方便哪种？' },
      { nick: '示例·何爸爸', msg: '我先带孩子去试听一节可以吗', ctx: '你私信他：先看孩子握笔和坐姿，再决定报不报。', history: [['assistant', '先看孩子握笔和坐姿，再决定报不报。'], ['user', '我先带孩子去试听一节可以吗']], hours: 1.3, unread: true, status: '谈单中', step: 'talking', intent: 'medium', tags: ['试听'], summary: '想先试听一节', reply: '可以，试听不用带东西，提前十分钟到就行。你周末上午还是下午方便？我看看哪个班还有位置。' },
      { nick: '示例·陈妈妈', msg: '好的，谢谢，我先和家里商量一下', ctx: '你私信她：这是按孩子年级排的练字计划，你先看看。', history: [['assistant', '这是按孩子年级排的练字计划，你先看看。'], ['user', '好的，谢谢，我先和家里商量一下']], hours: 25, unread: false, status: '已成交', step: 'closed', intent: 'high', tags: ['硬笔书法', '已成交'], summary: '已确认练字计划并成交', sold: true, repliedIncoming: '好的，谢谢，我先和家里商量一下', reply: '好的，商量好跟我说，我先把试听课要带的东西发你。' },
      { nick: '示例·林女士', msg: '暑假班还有名额吗？', ctx: '你私信她：暑假班按年级分班，先看孩子基础。', history: [['assistant', '暑假班按年级分班，先看孩子基础。'], ['user', '暑假班还有名额吗？']], hours: 96, unread: false, status: '已触达', step: 'touched', intent: 'medium', tags: ['暑假班'], summary: '问暑假班名额，尚未回复', await: true, reply: '还有几个位置，主要看孩子年级和基础分班。你说下孩子几年级、之前练过没有，我帮你看看哪个班合适。' },
    ],
    bench: {
      n: 0,
      summary: '这条笔记底下有 3 条评论说到了孩子写字时的具体表现（握得紧喊累、问握笔器、写字慢），是可以直接回过去的情形。',
      hits: [
        { author: '示例·李妈妈', comment: '我家孩子握笔总是握得很紧，写一会就喊累', why: '评论里说孩子握笔紧、写一会儿就喊累', loc: '四川成都', same: true, approach: '先给原因',
          copies: [
            '握笔紧多半不是态度问题，是手上小肌肉还没劲儿。每天捏橡皮泥、夹豆子五分钟，再调笔杆角度，两周左右能看出变化。孩子几岁、写多久会喊累？',
            '先看两个地方：虎口有没有空、笔杆是不是立得太直。握得紧的孩子一般笔杆贴到食指第二关节，手指就没松快过。',
            '我们班课前会先做两分钟手部小游戏，再看握姿和坐姿，一节课下来孩子不太会喊累。成都这边可以先来听一节，当面看他的握笔。',
          ],
          labels: ['朋友分享型', '数据分析型', '产品介绍型'] },
        { author: '示例·周妈妈', comment: '握笔器有用吗？', why: '在你的评论底下追问握笔器要不要买', loc: '四川', same: true, approach: '说清边界',
          copies: [
            '握笔器能帮孩子找到手指位置，但不能代替手部力量；配合每天五分钟的捏、夹练习会更稳。孩子现在多大？',
            '分两种：孩子不知道手指放哪儿，握笔器有帮助；知道位置但捏得死，套上反而更累，这种情况先练力量。',
            '我们一般是先把握姿和坐姿一节课一节课调，手部力量跟上后再把握笔器撤掉。你家孩子几年级？我按年龄说个大概周期。',
          ],
          labels: ['朋友分享型', '数据分析型', '产品介绍型'] },
        { author: '示例·吴女士', comment: '写字慢是不是因为专注力不够？', why: '评论里问写字慢的原因，担心是专注力问题', loc: '重庆', same: false, approach: '先排查',
          copies: [
            '写字慢先排三个原因：握笔费力、看一笔写一笔、写着写着停下来。你先观察他是写两分钟就停，还是一直在写但很慢，这两种练法不一样。',
            '大半不是专注力问题，是记字形跟不上——看一笔写一笔，眼睛和手来回对。可以先练读帖：看完整一个字再下笔。',
            '我们新生来上课前会先看他写一张字，握笔、笔顺、看字方式各占一块，再定从哪儿练。你在哪个区？离得近可以先来测一次。',
          ],
          labels: ['朋友分享型', '数据分析型', '产品介绍型'] },
      ],
      filler: [
        { author: '示例·郑爸爸', comment: '我们老师也让买握笔器，回头看看', loc: '广东' },
        { author: '示例·方方', comment: '楼主家用的是哪种铅笔', loc: '北京' },
        { author: '示例·小夏', comment: '已转发给孩子他爸', loc: '江苏' },
        { author: '示例·余女士', comment: '看哭了，我家写作业也是磨蹭', loc: '陕西' },
        { author: '示例·阿凯', comment: '马克一下，暑假带娃练起来', loc: '' },
      ],
    },
  },
  kidsport: {
    city: '武汉',
    keywords: ['儿童体适能', '孩子平衡感', '跳绳训练', '感统训练', '儿童运动启蒙', '孩子老摔跤'],
    notes: [
      { sc: 'latest', title: '儿童体适能到底练什么？一节课看明白', author: '示例·体能教练大刘', likes: 8730, comments: 264, sub: 71, delta: 25, hours: 4, mc: { rank: 2, likes: 24, excerpt: '不是提前练力量，先把平衡、协调、灵敏打底，动作模式对了再加量。' } },
      { sc: 'top', title: '孩子老摔跤，是平衡感差吗？', author: '示例·儿童运动笔记', likes: 11000, comments: 322, sub: 86, delta: 17, hours: 8, mc: { rank: 1, likes: 38, excerpt: '先看是单脚站不稳，还是跑起来不会刹车，两种情况练法不一样。' } },
      { sc: 'local', title: '武汉儿童运动馆实测｜3家对比', author: '示例·武汉家长帮', likes: 2650, comments: 132, sub: 29, delta: 5, hours: 6 },
      { sc: 'pain', title: '跳绳总不及格怎么办？求教练支招', author: '示例·三年级家长', likes: 690, comments: 61, sub: 18, delta: 2, hours: 5 },
      { sc: 'top', title: '感统训练是不是智商税', author: '示例·感统老师', likes: 26000, comments: 445, sub: 121, delta: 19, hours: 11, mc: { rank: 3, likes: 31, excerpt: '看孩子是不是真的存在感统失调，别把普通的好动都往感统上套。' } },
      { sc: 'latest', title: '运动启蒙从几岁开始？看完不焦虑', author: '示例·运动育儿说', likes: 4380, comments: 176, sub: 39, delta: 7, hours: 3 },
      { sc: 'rival', title: '运动馆招生话术里的三个坑', author: '示例·体培同行', likes: 7100, comments: 158, sub: 37, delta: 8, hours: 13, mc: { rank: 4, likes: 15, excerpt: '先看教练会不会按孩子状态调难度，不看送多少节课。' } },
    ],
    logs: [
      { n: 0, author: '示例·李妈妈', comment: '四岁半适合上体适能吗？会不会太早', reply: '四岁半正合适，但别按成人那套练力量；先练平衡、跳跃落地和听指令，一次三四十分钟就够。孩子平时爱动还是偏安静？', source: 'batch', hours: 2.2 },
      { n: 1, author: '示例·陈爸爸', comment: '孩子老摔跤，是不是平衡感差？', reply: '先看是单脚站不稳，还是跑起来不会刹车；前者练平衡，后者练控制和落地。你在家让他单脚站十秒试试，两边差得多不多？', source: 'single', hours: 6.2 },
      { n: 2, author: '示例·周女士', comment: '武汉光谷这边有儿童运动馆吗？', reply: '光谷那边有几家，主要看教练配比和场地；试听时看孩子愿不愿意再来，比看装修有用。你住光谷哪一片？我按距离帮你排。', source: 'batch', hours: 27 },
    ],
    leads: [
      { nick: '示例·李妈妈', entry: '评论', n: 0, comment: '四岁半适合上体适能吗？会不会太早', signal: '评论里问四岁半能不能练', hours: 0.45, intent: 'high', tags: ['体适能', '4岁'], summary: '孩子四岁半，想了解体适能', keyword: '儿童体适能', reply: '李妈妈，四岁半可以练，但先练平衡、落地和听指令，不急着上力量。孩子平时爱跑跳吗？我按他的状态给你说先练哪几项。' },
      { nick: '示例·陈爸爸', entry: '点赞', n: 1, comment: '', signal: '赞了你的评论「先练平衡再练力量」', hours: 1.6, intent: 'medium', tags: ['平衡感'], summary: '关注孩子平衡感', reply: '陈爸爸，平衡先看单脚站和走直线，再看跑动中能不能停住。你孩子几岁、平时摔跤多在跑还是跳？我帮你分一下该练哪块。' },
      { nick: '示例·周女士', entry: '关键词命中', n: 2, comment: '武汉光谷这边有儿童运动馆吗？', signal: '评论里同时出现「儿童运动馆」「武汉」', hours: 2.7, intent: 'high', tags: ['儿童运动馆', '武汉'], summary: '在武汉光谷找儿童运动馆', keyword: '儿童体适能', reply: '周女士，光谷这边选馆先看教练带几个孩子、场地够不够跑；试听看孩子愿不愿意再去。你住光谷哪一片？我按距离给你排两家。' },
      { nick: '示例·张爸爸', entry: '收藏', n: 4, comment: '', signal: '收藏了你的笔记「感统训练是不是智商税」', hours: 5.2, intent: 'medium', tags: ['感统'], summary: '在了解感统训练', reply: '张爸爸，感统先看孩子是不是真的存在失调表现，别把普通好动都往上套。你孩子主要是什么情况？我先帮你判断要不要做评估。' },
      { nick: '示例·王妈妈', entry: '关注', n: 5, comment: '', signal: '关注了你', hours: 9, intent: 'low', tags: ['运动启蒙'], summary: '关注运动启蒙，需求还不明确', reply: '王妈妈，看到你关注了运动启蒙。孩子现在几岁、平时最喜欢哪类活动？先说下，我帮你判断现阶段适合玩什么。' },
      { nick: '示例·孙爸爸', entry: '回复', n: 0, comment: '一节课大概几个孩子？', signal: '在你的评论下追问班级人数', hours: 20, intent: 'high', tags: ['体适能', '班级'], summary: '问班级人数，准备试听', reply: '孙爸爸，一个班最多六个孩子，按年龄和基础分；人少一点教练能一个个看动作。你孩子几岁？我看看哪个班还有位置。' },
      { nick: '示例·吴女士', entry: '评论', n: 3, comment: '跳绳用什么绳子好？', signal: '评论里问跳绳选绳', hours: 29, intent: 'medium', tags: ['跳绳'], summary: '孩子跳绳不及格，问选绳', await: true, reply: '吴女士，初学先用轻一点的竹节绳或塑料绳，长度踩住中间、手柄到胸口就差不多；先练节奏，再追求个数。孩子现在一分钟能跳多少？' },
    ],
    msgs: [
      { nick: '示例·郑爸爸', msg: '你们体验课怎么约？周末有空吗', ctx: '你私信他：先带孩子来体验，看动作和听指令。', history: [['assistant', '先带孩子来体验，看动作和听指令。'], ['user', '你们体验课怎么约？周末有空吗']], hours: 0.4, unread: true, status: '谈单中', step: 'talking', intent: 'high', tags: ['体验课', '武汉'], summary: '想约周末体验课', reply: '周末上午十点和下午三点各有一节，你选一个时间，我把地址和要穿的衣服发你；提前十分钟到，先让孩子熟悉场地。' },
      { nick: '示例·何妈妈', msg: '孩子有点内向，能适应吗', ctx: '你私信她：第一次先上一节一对一，熟悉了再进小班。', history: [['assistant', '第一次先上一节一对一，熟悉了再进小班。'], ['user', '孩子有点内向，能适应吗']], hours: 1.5, unread: true, status: '谈单中', step: 'talking', intent: 'medium', tags: ['适应'], summary: '担心孩子内向不适应', reply: '可以先安排一节一对一，让教练带他熟悉场地和动作，第二次再进小班；孩子有安全感了，适应会快很多。他平时愿意跟陌生小朋友玩吗？' },
      { nick: '示例·陈爸爸', msg: '好的，谢谢，我先和家里商量一下', ctx: '你私信他：这是按孩子年龄排的训练计划，你先看看。', history: [['assistant', '这是按孩子年龄排的训练计划，你先看看。'], ['user', '好的，谢谢，我先和家里商量一下']], hours: 28, unread: false, status: '已成交', step: 'closed', intent: 'high', tags: ['体适能', '已成交'], summary: '已确认训练计划并成交', sold: true, repliedIncoming: '好的，谢谢，我先和家里商量一下', reply: '好的，商量好跟我说，我先把第一次来要带的东西发你。' },
      { nick: '示例·林女士', msg: '你们馆在哪个位置？停车方便吗', ctx: '你私信她：先看场地和教练，再决定要不要体验。', history: [['assistant', '先看场地和教练，再决定要不要体验。'], ['user', '你们馆在哪个位置？停车方便吗']], hours: 96, unread: false, status: '已触达', step: 'touched', intent: 'medium', tags: ['到店'], summary: '问到店位置和停车，尚未回复', await: true, reply: '在洪山区这边，楼下有停车场，周末车位会紧一点，建议提前十分钟到。你大概从哪边过来？我发你一条好走的路线。' },
    ],
    bench: {
      n: 0,
      summary: '这条笔记底下有 3 条评论问的是自家孩子能不能上、几个人一班、附近有没有馆，回过去就能约到体验。',
      hits: [
        { author: '示例·李妈妈', comment: '四岁半适合上体适能吗？会不会太早', why: '评论里问四岁半这个年龄能不能开始练', loc: '湖北武汉', same: true, approach: '先给年龄判断',
          copies: [
            '四岁半可以练，但先练平衡、落地和听指令，不急着上力量。孩子平时爱跑跳吗？我按他的状态说先练哪几项。',
            '四到六岁是动作模式打底的阶段，练平衡、协调、灵敏；这个年纪上力量训练反而是负担，很多馆是不做的。',
            '我们班四岁半的孩子先来一节一对一，看落地和听指令，熟了再进小班。你住武汉哪一片？我把最近的馆和周末时间发你。',
          ],
          labels: ['朋友分享型', '数据分析型', '产品介绍型'] },
        { author: '示例·孙爸爸', comment: '一节课大概几个孩子？', why: '在你的评论底下追问班级人数，在比班型', loc: '湖北', same: true, approach: '给班型',
          copies: [
            '一个班最多六个孩子，按年龄和基础分班；人少一点教练能一个个看动作。你孩子几岁？我看看哪个班还有位置。',
            '同样六十分钟，六个孩和十二个孩的运动密度差一倍——差别主要花在排队等器材的时间上。',
            '我们是一个教练带六个，四到六岁单独一个班。孩子多大、之前上过课没有？我按基础给你安排到哪一档。',
          ],
          labels: ['朋友分享型', '数据分析型', '产品介绍型'] },
        { author: '示例·周女士', comment: '武汉光谷这边有儿童运动馆吗？', why: '评论里同时出现「儿童运动馆」和「武汉」，在找附近的馆', loc: '湖北武汉', same: true, approach: '引导体验',
          copies: [
            '光谷这边选馆先看两点：一个教练带几个孩子、场地够不够跑跳；体验课看孩子愿不愿意再去第二次。你住光谷哪一片？我按距离给你排两家。',
            '场馆好不好，看层高够不够跑跳、地面有没有缓冲，比看装修和礼品实在；教练是不是每个动作都纠正更重要。',
            '我们馆就在光谷，走路十分钟能到。你周末上午还是下午方便？给孩子约一节体验，先看看他的动作和听指令的情况。',
          ],
          labels: ['朋友分享型', '数据分析型', '产品介绍型'] },
      ],
      filler: [
        { author: '示例·何先生', comment: '收藏了，周末带娃去试试', loc: '广东' },
        { author: '示例·琴琴', comment: '看着就累，我家娃一分钟都坚持不住', loc: '湖南' },
        { author: '示例·八零爸', comment: '教练都是体育专业出身的吗', loc: '浙江' },
        { author: '示例·小北', comment: '同城的馆看着场地挺大', loc: '江苏' },
        { author: '示例·桃桃妈', comment: '已转发给爸爸看', loc: '' },
      ],
    },
  },
};

function _demoBizDay(now) {
  return new Date(now || Date.now()).toISOString().slice(0, 10);
}
function _demoBizAgo(now, hours) {
  return Math.round(now - (Number(hours) || 0) * 3600e3);
}
function _demoBizStamp(now, hours) {
  const h = Number(hours) || 0;
  if (h < 0.05) return '刚刚';
  if (h < 1) return Math.max(1, Math.round(h * 60)) + '分钟前';
  if (h < 24) return Math.round(h) + '小时前';
  if (h < 48) return '昨天';
  return Math.round(h / 24) + '天前';
}
function _demoBizHex(seed) {
  return Buffer.from(String(seed)).toString('hex').slice(0, 24).padEnd(24, '0');
}

function _demoBizBuild(d) {
  const key = d.key;
  const B = DEMO_BIZ[d.group === 'tier' ? 'deco' : key];
  const now = Date.now();
  const ago = (h) => _demoBizAgo(now, h);
  const stamp = (h) => _demoBizStamp(now, h);
  const kws = B.keywords.slice();
  const likesText = (n) => (Number(n) >= 10000 ? (Number(n) / 10000).toFixed(1).replace(/\.0$/, '') + '万' : String(n));
  const notes = B.notes.map((n, i) => {
    const noteId = _demoBizHex('xhs-demo-' + key + '-note-' + (i + 1));
    return Object.assign({}, n, { noteId, url: 'https://www.xiaohongshu.com/explore/' + noteId, at: ago(n.hours) });
  });
  const noteOf = (i) => notes[Math.max(0, Math.min(notes.length - 1, Number(i) || 0))];
  const chType = (entry) => (entry === '关注' ? '关注'
    : (entry === '点赞' || entry === '收藏') ? '点赞&收藏'
      : (entry === '关键词命中' || entry === 'AI路由') ? 'AI' : '评论');

  const drainNotes = notes.map((n, i) => ({
    id: 'demo_' + key + '_n' + (i + 1),
    noteId: n.noteId,
    scenario: n.sc,
    url: n.url,
    title: n.title,
    author: n.author,
    signals: {
      likes: n.likes, comments: n.comments, subComments: n.sub, delta: n.delta || 0,
      rank: 0, title: n.title,
      myComment: n.mc
        ? { found: true, checked: true, rank: n.mc.rank || 0, likes: n.mc.likes == null ? null : n.mc.likes, seen: true, excerpt: n.mc.excerpt || '', at: n.at }
        : { found: false, checked: true, rank: 0, likes: null, seen: false, excerpt: '', at: n.at },
    },
    state: 'monitoring',
    addedAt: ago(n.hours + 2),
    lastJudgedAt: n.at,
    dead: false,
  }));

  const searchResults = notes.slice(0, 6).map((n, i) => ({
    noteId: n.noteId,
    url: n.url,
    title: n.title,
    author: n.author,
    likes: likesText(n.likes),
    stats: [likesText(n.likes), likesText(Math.round(n.likes * 0.2)), String(n.comments)],
    scenario: n.sc,
    rawLinkIndex: i,
    searchIndex: i,
    commentCount: n.comments,
  }));

  const wateringLogs = B.logs.map((L, i) => {
    const n = noteOf(L.n);
    return {
      ts: ago(L.hours), noteTitle: n.title, author: L.author,
      comment: L.comment, replyText: L.reply, source: L.source || (i % 2 ? 'single' : 'batch'),
    };
  });

  const leads = B.leads.map((L, i) => {
    const n = L.n != null ? noteOf(L.n) : null;
    const at = ago(L.hours);
    return {
      id: 'demo_' + key + '_l' + (i + 1),
      userId: 'demo_' + key + '_u' + (i + 1),
      nickname: L.nick,
      stage: 'lead',
      status: L.await ? '已触达' : '待触达',
      lead: { signalCount: 1, signals: [{ type: L.entry, text: L.signal || L.comment || '', at }], lastSignalAt: at },
      source: {
        stageEntry: L.entry,
        comment: L.comment || '',
        noteTitle: n ? n.title : '',
        noteUrl: n ? n.url : '',
        signalText: L.signal || L.comment || '',
      },
      channels: [{
        type: chType(L.entry), entry: L.entry, comment: L.comment || '',
        noteTitle: n ? n.title : '', userUrl: '',
        nTime: at, nTimeStr: stamp(L.hours), signalText: L.signal || L.comment || '',
      }],
      profile: { intentLevel: L.intent, tags: L.tags || [], summary: L.summary || '', needs: L.summary || '', dmAngle: '' },
      affinity: { intentLevel: L.intent },
      replySuggest: L.reply || '',
      nTime: at, nTimeStr: stamp(L.hours),
      createdAt: at, updatedAt: at,
      ...(L.keyword ? { keywordHit: L.keyword } : {}),
      ...(L.await ? { awaitingReply: true, dmStatus: 'sent', dmDraft: L.reply || '', lastDmAt: ago(L.hours + 1), direction: 'outbound' } : {}),
    };
  });

  const msgs = B.msgs.map((M, i) => {
    const at = ago(M.hours);
    const history = (M.history || []).map((x) => ({ role: x[0], content: x[1], at: ago(M.hours + 0.5) }));
    return {
      id: 'demo_' + key + '_m' + (i + 1),
      userId: 'demo_' + key + '_c' + (i + 1),
      nickname: M.nick,
      stage: 'prospect',
      inbound: true,
      direction: 'inbound',
      convId: 'demo_' + key + '_conv' + (i + 1),
      unread: !!M.unread,
      lastFrom: 'them',
      lastMsg: M.msg,
      lastConvFp: { msg: M.msg, at },
      status: M.status,
      funnel: { step: M.step, dmCount: M.step === 'touched' ? 1 : 2, lastDmAt: ago(M.hours + 1) },
      profile: { intentLevel: M.intent, tags: M.tags || [], summary: M.summary || '', needs: M.summary || '', dmAngle: '' },
      affinity: { intentLevel: M.intent },
      replySuggest: M.reply || '',
      source: { stageEntry: '消息', signalText: '主动私信你' },
      chatHistory: history,
      nTime: at, nTimeStr: stamp(M.hours),
      createdAt: ago(M.hours + 30), updatedAt: at,
      ...(M.await ? { awaitingReply: true } : {}),
    };
  });

  const conversations = {};
  B.msgs.forEach((M, i) => {
    const uid = msgs[i].userId;
    const pending = !M.sold;
    const hist = [{ role: 'context', content: M.ctx || ('你在对方笔记下的评论：' + (M.msg || '')) }];
    (M.history || []).forEach((x) => hist.push({ role: x[0], content: x[1], at: ago(M.hours + 0.5) }));
    if (M.sold) hist.push({ role: 'assistant', content: M.reply || '好的，收到，我这边给你安排。' });
    conversations[uid] = {
      userName: M.nick,
      history: hist,
      turnCount: Math.max(1, (M.history || []).filter((x) => x[0] === 'user').length),
      needReply: pending,
      pendingIdx: pending ? i * 2 : -1,
      pendingIncoming: pending ? M.msg : '',
      lastRepliedIncoming: pending ? '' : (M.repliedIncoming || ''),
      sold: !!M.sold,
      lastReplyAt: M.sold ? ago(2) : 0,
      stale: false,
    };
  });

  const chatDone = [
    { userId: msgs[2].userId, userName: msgs[2].nickname, at: ago(2.5), status: 'ok', reply: B.msgs[2].reply || '好的，收到', reason: '', incoming: B.msgs[2].msg },
    { userId: 'demo_' + key + '_x1', userName: '示例·已回访顾客A', at: ago(3.4), status: 'ok', reply: '按你说的尺寸算了一下，发你参考。', reason: '', incoming: '尺寸我量好了，你帮我看看' },
    { userId: 'demo_' + key + '_x2', userName: '示例·已回访顾客B', at: ago(4.6), status: 'skip', reply: '', reason: '对方只是随口一问，不像要买', incoming: '哈哈好的' },
  ];
  const replyHistory = chatDone.filter((x) => x.status === 'ok').map((x) => ({
    userId: x.userId, userName: x.userName, at: x.at,
    repliedIncoming: x.incoming, replyText: x.reply,
  }));

  const kwRuns = {};
  kws.forEach((k, i) => {
    kwRuns[k] = {
      latest: ago(0.6 + i * 0.35),
      top: ago(2.4 + i * 0.8),
      local: ago(3.2 + i * 0.9),
      pain: ago(5.4 + i * 1.1),
      rival: i === kws.length - 1 ? ago(7.2) : 0,
    };
  });

  const scanCfg = {
    sources: [],
    keywords: kws.map((k, i) => ({ k, on: true, src: 'ai', batch: '主推', types: i === kws.length - 1 ? { rival: true } : {} })),
    accounts: [
      { k: 'https://www.xiaohongshu.com/user/profile/' + _demoBizHex('demo-' + key + '-acct-1'), name: '示例·同城高赞号', on: true, scenario: 'highv' },
      { k: 'https://www.xiaohongshu.com/user/profile/' + _demoBizHex('demo-' + key + '-acct-2'), name: '示例·同行观察', on: true, scenario: 'rival' },
    ],
    types: { latest: true, top: true, local: true, pain: true, rival: true },
    autoScanMin: 0,
    lastScanAt: ago(0.7),
    lastScanSummary: { foundNew: 6, refreshed: 2, backfilled: 1, missDiscarded: 0, total: notes.length, at: ago(0.7), detail: '', note: '', importedWater: 3 },
    kwRuns,
    batches: ['主推'],
    batchPlan: {},
    typeRun: {
      latest: { mode: 'each' },
      top: { mode: 'interval', hours: 6 },
      local: { mode: 'interval', hours: 6 },
      pain: { mode: 'interval', hours: 6 },
      rival: { mode: 'interval', hours: 12 },
    },
    acctRun: { highv: { mode: 'interval', hours: 12 }, rival: { mode: 'interval', hours: 12 } },
    queueAuto: { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], from: '09:00', to: '18:00' },
    v: 5,
  };

  const doneNotes = notes.slice(0, 5).map((n, i) => ({ id: drainNotes[i].id, t: n.title, s: [3, 5, 2, 4, 3][i] }));
  const drainDone = notes.slice(0, 5).map((n, i) => ({
    k: kws[i % kws.length], label: '', scenario: n.sc,
    at: ago([0.7, 2.2, 3.1, 5.2, 6.4][i]),
    foundN: [6, 4, 3, 2, 5][i], commentN: [3, 5, 2, 4, 3][i],
    note: '跑完', notes: [{ id: drainNotes[i].id, t: n.title, s: [3, 5, 2, 4, 3][i] }],
  }));

  const today = _demoBizDay(now);
  const yesterday = _demoBizDay(now - 864e5);
  const waterHistory = {};
  [0, 2, 4].forEach((idx, i) => {
    const n = notes[idx];
    waterHistory[n.noteId] = { title: n.title, url: n.url, status: 'success', keyword: kws[i], wateredAt: ago(5 + i * 2) };
  });
  const repliedComments = {};
  [0, 2].forEach((idx, i) => {
    const n = notes[idx];
    const L = B.logs[i] || B.logs[0];
    repliedComments[n.url] = [{ author: L.author, comment: L.comment, replyText: L.reply, repliedAt: ago(4 + i * 3) }];
  });

  /* 获客工作台那一屏的样本：打开某一篇 → 扫到这些评论 → 挑出这几个人 → 各配三版话术。
     演示号进工作台就照这份画（画师在 web/lib/demo-ui.js），访客改不动，每天重铺一次。 */
  const BQ = B.bench || { n: 0, summary: '', hits: [], filler: [] };
  const bn = noteOf(BQ.n);
  const benchComments = [];
  const benchProspects = [];
  (BQ.hits || []).forEach((h) => {
    const idx = benchComments.length;
    benchComments.push({ author: h.author, content: h.comment, location: h.loc || '', userLink: '' });
    benchProspects.push({
      index: idx, author: h.author, original_comment: h.comment, interest_reason: h.why,
      approach: h.approach || '回复', location: h.loc || '', same_city: h.same === true,
      suggested_copies: h.copies || [], copy_labels: h.labels || [], best_index: 0, _verified: true, userLink: '',
    });
  });
  (BQ.filler || []).forEach((f) => {
    benchComments.push({ author: f.author, content: f.comment, location: f.loc || '', userLink: '' });
  });
  const demoBench = {
    noteId: bn.noteId, url: bn.url, title: bn.title, author: bn.author, likes: bn.likes,
    sourceLabel: '关键词命中', summary: BQ.summary || '',
    comments: benchComments, prospects: benchProspects,
  };

  return {
    __city: B.city,
    drain_scan_cfg: scanCfg,
    drain_notes: drainNotes,
    drain_queue: {
      v: 1, running: null, carry: [], manual: [], done: drainDone,
      dailyMark: { sinceN: 3, lastAt: ago(2) },
    },
    auto_water_state: {
      phase: 'IDLE', searchState: null, logs: [], error: null,
      searchResults,
    },
    auto_water_config: {
      keywords: kws,
      schedule: { minInterval: 180, maxInterval: 600, dailyMax: 40, perRound: 8, kwIdx: 1, activeHoursStart: 9, activeHoursEnd: 22 },
    },
    auto_water_daily: { [today]: 12, [yesterday]: 18 },
    auto_water_history: waterHistory,
    watering_logs: wateringLogs,
    watered_notes: [notes[0].url, notes[2].url],
    replied_comments: repliedComments,
    opened_notes: [notes[0].url, notes[1].url, notes[2].url],
    prospect_list: leads.concat(msgs),
    chat_follow_state: { conversations, lastSyncAt: ago(0.15) },
    chat_follow_queue: { v: 1, running: null, done: chatDone },
    chat_follow_reply_history: replyHistory,
    prospect_dm_history: [
      { id: 'demo_' + key + '_dm1', sentAt: ago(28), userId: msgs[2].userId, nickname: msgs[2].nickname, text: B.msgs[2].ctx || '', scene: 'dm_first' },
      { id: 'demo_' + key + '_dm2', sentAt: ago(5), userId: msgs[0].userId, nickname: msgs[0].nickname, text: msgs[0].replySuggest, scene: 'chat_follow' },
    ],
    ai_cs_daily: { [today]: { notif_reply: 3 }, [yesterday]: { notif_reply: 5 } },
    demo_bench: demoBench,
  };
}

async function seedDemoBusiness(d) {
  const bag = store.books[d.id];
  if (!bag) return false;
  const today = _demoBizDay();
  if (bag.demo_biz_seed_v === DEMO_BIZ_SEED_V && bag.demo_biz_seed_day === today) return false;
  const data = _demoBizBuild(d);
  const city = data.__city;
  delete data.__city;
  for (const k of Object.keys(data)) bag[k] = data[k];
  bag.config = bag.config || {};
  bag.config.myCity = Object.assign({}, bag.config.myCity || {}, { city });
  bag.demo_biz_seed_v = DEMO_BIZ_SEED_V;
  bag.demo_biz_seed_day = today;
  await persist();
  console.log(`[demo] 演示号「${d.name}」业务数据就位：笔记 ${data.drain_notes.length} 篇 / 线索 ${data.prospect_list.length} 个 / 评论记录 ${data.watering_logs.length} 条（${today}）`);
  return true;
}

async function ensureDemoAccounts() {
  const now = Date.now();
  for (const d of DEMO_ACCOUNTS) {
    let acc = store.accounts[d.id];
    if (!acc) {
      store.accounts[d.id] = {
        id: d.id, name: d.name, phone: '',
        kind: 'demo', demoKey: d.key, demoLabel: d.name, industry: d.industry,
        readonlyFoundation: true,
        createdAt: now, lastAt: now, lastIp: '',
        tier: d.tier, perk: { on: [], off: [] }, trialUntil: 0, trialTier: '全功能',
      };
    } else {
      /* 固定演示号的身份字段每次开机校正；档位只在第一次建号时定（之后老板要改也不拦） */
      acc.kind = 'demo';
      acc.demoKey = d.key;
      acc.demoLabel = d.name;
      acc.industry = d.industry;
      acc.readonlyFoundation = true;
      if (!TIERS.includes(acc.tier)) acc.tier = d.tier;
      acc.perk = { on: [], off: [] };
      acc.trialUntil = 0;
    }
  }
  await persist();
  const order = ['demo_deco_full', 'demo_baby_full', 'demo_edu_full', 'demo_kidsport_full',
    'demo_tier_free', 'demo_tier_basic', 'demo_tier_pro', 'demo_tier_full'];
  for (const id of order) {
    const d = DEMO_ACCOUNTS.find((x) => x.id === id);
    if (!d) continue;
    try { await seedDemoBook(d); }
    catch (e) { console.log(`[demo] ⚠ 演示号「${d.name}」铺底子出错：` + e.message); }
    try { await seedDemoBusiness(d); }
    catch (e) { console.log(`[demo] ⚠ 演示号「${d.name}」铺业务数据出错：` + e.message); }
  }
}
await ensureDemoAccounts();

/* ── 第一次真实生成前，把演示样例清干净（免得 AI 出的人和样例混在一起）。
 *    v5 起按账号清：只动当前账号那本小账本，别人和模板的样例不动。
 *    失败也不拦人——aiDiagnosisSync 自己会按 signature 对不上就整链重跑；
 *    这里清干净只是为了让"生成中"的进度从零开始、结果里只有他自己那一份。 ── */
async function clearDemoPreset(accountId) {
  const bag = store.books[accountId];
  if (!bg || !bag || !bag.demo_preset) return;
  console.log(`[demo] 账号「${accountId}」第一次真实生成：先清掉建材店演示样例`);
  try { await bg.dispatch({ action: 'clearKnowledgeBase' }); }
  catch (e) { console.log('[demo] ⚠ 清演示知识库出错：' + e.message); }
  try {
    await bg.dispatch({
      action: 'updateConfig',
      data: { persona: null, product: { name: '', coverHook: '', description: '', sellPoints: [], guideText: '' } },
    });
  } catch (e) { console.log('[demo] ⚠ 清演示配置出错：' + e.message); }
  delete bag.note_plan;
  delete bag.demo_preset;
  await persist();
}

/* ── 动作路由：白名单 → 后台副本；白名单外 → 要扩展；没领号 → 要账号。
 *    v5 起先过账号闸门（cookie 会话 → 账号）；出门口换真 Key 前过额度闸门、
 *    换完按账号记账（一个动作烧多笔也只记这一次动作）；存储与 AI 都落在该账号的小账本上。 ── */
async function runAction(name, body, req) {
  /* 「我是哪档 / 能点哪几格」在这一台算：网页界面吃这张档位表，不再吃包里那张
     （包里那张只是执行器从没领到过表时的进门默认）。没登录 / 还没配对号 → 只给共用的那三格。 */
  if (name === 'getEdition') return { ok: true, expired: false, noNetwork: false, remainingDays: null, edition: webEdition(resolveAccount(req)) };
  /* 出图接口不经过后台副本：Key 只在这台服务器上换，后台副本碰不到；服务器没配出图 Key 也照常回“没配” */
  if (name === 'getImageQuota' || name === 'genNoteImage') {
    try { return await runImageAction(name, body, req); }
    catch (e) { return { ok: false, error: '[demo] 出图接口出错：' + e.message }; }
  }
  /* 看图认内容 / 案例正文也走这台上：小图只过路、不落盘；Key 不进客户浏览器 */
  if (name === 'npVisionStatus' || name === 'npVisionSegments' || name === 'npVisionLabel') {
    try { return await runVisionAction(name, body, req); }
    catch (e) { return { ok: false, error: '[demo] 看图接口出错：' + e.message }; }
  }
  if (name === 'genCaseArticle') {
    try { return await runCaseArticleAction(body, req); }
    catch (e) { return { ok: false, error: '[demo] 案例正文接口出错：' + e.message }; }
  }
  if (!bg) return { ok: false, error: '[demo] 后台副本没起来：' + (bgBootError || '未知原因') };
  if (!WHITELIST.has(name)) {
    console.log(`[demo] 动作「${name}」→ 拦下（这个功能要装了扩展才能用）`);
    return { ok: false, error: '这个功能要装了扩展才能用', demo: 'need-extension' };
  }
  const acc = resolveAccount(req);
  if (!acc) {
    console.log(`[demo] 动作「${name}」→ 拦下（还没领号）`);
    return { ok: false, error: '先领个号（或登录）就能用了', demo: 'need-account' };
  }
  if (acc.kind === 'demo') {
    if (DEMO_LOCKED_ACTIONS.has(name)) {
      console.log(`[demo] 演示号「${acc.name}」动作「${name}」→ 拦下（底子只读）`);
      return demoRoResult();
    }
    if (name === 'updateConfig' && demoConfigTouchesFoundation(body && body.data)) {
      console.log(`[demo] 演示号「${acc.name}」改底子配置 → 拦下（底子只读）`);
      return demoRoResult();
    }
  }
  const ctx = { ip: clientIp(req), accountId: acc.id, action: name, swaps: 0 };
  const t0 = Date.now();
  let result;
  try {
    result = await quotaCtx.run(ctx, async () => {
      /* 真生成要清演示样例（只清这个账号的）；但 .env 没配真 Key、或这个账号的免费额度
         已用完时，这一趟注定失败——样例先留着，别让一次失败的点按把"不填能逛"的底气清没了。 */
      if (name === 'aiDiagnosisSync') {
        if (!readEnv().key) console.log('[demo] 还没配真 AI Key：这次生成会失败，演示样例先留着不动');
        else if (textQuotaInfo(store, acc, quotaUsed(acc.id)).left <= 0 || budgetUsed() >= dailyCap()) console.log('[demo] AI 额度/今日全站总量已到线：这趟不会生成，演示样例先留着不动');
        else await clearDemoPreset(acc.id);
      }
      return bg.dispatch(body);
    });
  } catch (e) { result = { ok: false, error: '[demo] 动作执行出错：' + e.message }; }
  const took = Date.now() - t0;
  if (ctx.swaps > 0) {
    const charge = TEXT_CHARGE_ACTIONS.has(name);
    try { await bumpQuota(acc.id, acc.name, !!(result && result.ok), charge); }
    catch (e) { console.error('[demo] 额度记账失败：', e.message); }
  }
  const mark = result && result.ok ? 'ok' : '失败';
  const charge = TEXT_CHARGE_ACTIONS.has(name);
  const burn = ctx.swaps > 0
    ? (!charge
        ? `（拨了 ${ctx.swaps} 次服务器 Key，这类动作不扣本人额度）`
        : (result && result.ok ? `（拨了 ${ctx.swaps} 次服务器 Key，记 1 次额度）` : `（拨了 ${ctx.swaps} 次服务器 Key，失败没扣本人额度）`))
    : '';
  console.log(`[demo] 动作「${name}」→ ${mark}（${took}ms）${burn}${result && result.error ? '：' + result.error : ''}`);
  return result;
}

/* ── 小工具 ── */
/* v7：静态文本的 gzip 缓存（键＝文件路径|etag；文件没变不重压） */
const gzAssetCache = new Map();
function json(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  /* v7：大回包（存储整份读等）也压——JSON 文本能省 6~7 成下行 */
  const ae = String((res.req && res.req.headers && res.req.headers['accept-encoding']) || '');
  if (body.length > 1024 && ae.includes('gzip')) {
    const gz = gzipSync(body);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip', 'Content-Length': gz.length, 'Cache-Control': 'no-store' });
    res.end(gz);
    return;
  }
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > MAX_BODY) { reject(new Error('请求体太大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(new Error('JSON 解析失败：' + e.message)); }
    });
    req.on('error', reject);
  });
}
/* 原始字节版（v10 素材托管 /api/blob/put 用；不走 JSON） */
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > MAX_BODY) { reject(new Error('请求体太大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* 老板侧口令闸：配了 DEMO_ADMIN_PASS 就验 x-admin-pass 头；没配只放本机（上云必须在 .env 配）。
   过了返回 true；没过已经写回包，调用方直接 return。 */
function adminGate(req, res) {
  const pass = readEnv().adminPass;
  if (pass) {
    if (String(req.headers['x-admin-pass'] || '') !== pass) { json(res, 403, { ok: false, error: '口令不对' }); return false; }
    return true;
  }
  const ip = clientIp(req);
  const loop = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
  if (!loop.includes(ip)) { json(res, 403, { ok: false, error: '只开给本机——上云后要在 .env 配 DEMO_ADMIN_PASS' }); return false; }
  return true;
}

/* ── 接口（全部 POST JSON）──
 * 账号四口：/api/auth/signup 领号 {name,phone,password} → {ok, account, quota, serverHasKey}（下发会话 cookie）
 *           /api/auth/login  登录 {phone,password}          → 同上
 *           /api/auth/logout 退出                            → {ok}
 *           /api/auth/me     我是谁（无会话时 account:null） → {ok, account, quota, serverHasKey}
 * 名单页：  /api/admin/accounts  本机直连或带 x-admin-pass 头 → {ok, accounts:[…]}
 * 存储四口（v5 起按会话路由到账号的小账本；没会话回 need-account）：
 * /api/storage/get    {keys: null|string[]}     → {ok, items}
 * /api/storage/set    {items:{k:v}}             → {ok, changes}   改动格式对齐 chrome.storage.onChanged
 * /api/storage/remove {keys: string|string[]}   → {ok, changes}
 * /api/storage/clear  {}                        → {ok, changes}
 * /api/action         {action, data}            → {ok, result}   result＝后台 sendResponse 原样 */
async function handleApi(path, body, req, res) {
  /* v8 执行器通道先过一手：/api/exec/* 全归它；不是它的一律往下走 */
  if (path.startsWith('/api/exec/')) { if (await execCh.handle(path, body, req, res)) return; }
  /* 云端出片五口（POST JSON）：收单 / 查一条 / 查我的 / 撤单 / 环境体检；取成片走 GET /api/film/out/<id> */
  if (path.startsWith('/api/film/')) {
    if (path === '/api/film/probe') {
      const pass = readEnv().adminPass;
      const ok = pass ? String(req.headers['x-admin-pass'] || '') === pass : ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(clientIp(req));
      return json(res, ok ? 200 : 403, ok ? { ok: true, env: filmJobs.api.envProbe() } : { ok: false, error: '口令不对' });
    }
    const a = { '/api/film/submit': filmJobs.api.submit, '/api/film/status': filmJobs.api.status,
      '/api/film/mine': filmJobs.api.listMine, '/api/film/cancel': filmJobs.api.cancel }[path];
    if (!a) return json(res, 404, { ok: false, error: '没有这个出片接口' });
    try { return await json(res, 200, await a(body, req)); }
    catch (e) { return json(res, 500, { ok: false, error: e.message }); }
  }
  /* 口播工单（POST JSON）：客户四口 建单/查我的/查一条/撤单 ＋ 念稿页取那张条 ＋ 老板侧 列单/接单/交片/退回 ＋ 体检。
     照片、逐段录音、成片是二进制，走 /api/lip/put 那条原始字节口（在下面静态那里拦）。 */
  if (path.startsWith('/api/lip/')) {
    if (path === '/api/lip/probe') {
      if (!adminGate(req, res)) return;
      return json(res, 200, { ok: true, env: lipJobs.api.envProbe() });
    }
    const A = {
      '/api/lip/submit': lipJobs.api.submit, '/api/lip/mine': lipJobs.api.listMine,
      '/api/lip/status': lipJobs.api.status, '/api/lip/cancel': lipJobs.api.cancel,
      '/api/lip/feed': (b, r) => lipJobs.api.feed(b.id, b.t),
      '/api/lip/jobs': lipJobs.api.listJobs, '/api/lip/claim': lipJobs.api.claim,
      '/api/lip/done': lipJobs.api.deliver, '/api/lip/reject': lipJobs.api.reject,
      /* 门面⑤ 那一站的「给这条片加字幕」：排一条云端烧字幕，烧好顶掉旧片；↩ 回上一版走 sub_revert */
      '/api/lip/sub': lipJobs.api.sub, '/api/lip/sub_revert': lipJobs.api.subRevert,
    }[path];
    if (!A) return json(res, 404, { ok: false, error: '没有这个工单接口' });
    try {
      const out = await A(body, req);
      return json(res, out && out.code ? out.code : 200, out);
    }
    catch (e) { return json(res, 500, { ok: false, error: e.message }); }
  }
  /* 随便逛逛：列表与进号（不用密码，固定 8 个公用演示号；不记本人 AI 次数，全站总闸照旧） */
  if (path === '/api/auth/demos') {
    return json(res, 200, { ok: true, demos: demoCatalog() });
  }
  if (path === '/api/auth/demo') {
    const key = String(body.key || '').trim();
    const wantId = String(body.id || '').trim();
    const d = DEMO_BY_KEY[key] || DEMO_ACCOUNTS.find((x) => x.id === wantId);
    if (!d) return json(res, 200, { ok: false, error: '没有这个演示号' });
    let acc = store.accounts[d.id];
    if (!acc || acc.kind !== 'demo') {
      await ensureDemoAccounts();
      acc = store.accounts[d.id];
    }
    if (!acc) return json(res, 200, { ok: false, error: '演示号还没准备好——过一会儿再试' });
    /* 每天第一次进号重铺一次：获客/AI客服的「今天/刚刚」跟着日历走，过期数据看着像坏了 */
    try { await seedDemoBusiness(d); }
    catch (e) { console.log(`[demo] ⚠ 演示号「${d.name}」刷新业务数据出错：` + e.message); }
    acc.lastAt = Date.now();
    acc.lastIp = clientIp(req);
    const token = startSession(acc.id);
    setSession(res, token, req);
    await persist();
    console.log(`[demo] 进演示号：${acc.name}，来自 ${acc.lastIp}`);
    return json(res, 200, { ok: true, account: publicAccount(acc), quota: quotaOf(acc), serverHasKey: !!readEnv().key });
  }
  if (path === '/api/auth/signup') {
    const name = String(body.name || '').trim().slice(0, 24);
    const phone = normPhone(body.phone);
    const password = String(body.password || '');
    if (!name) return json(res, 200, { ok: false, error: '还没填称呼' });
    if (!phone) return json(res, 200, { ok: false, error: '手机号看着不对——填 11 位手机号就行' });
    if (password.length < 6) return json(res, 200, { ok: false, error: '密码至少 6 位' });
    if (Object.values(store.accounts).some((a) => a.phone === phone)) {
      return json(res, 200, { ok: false, error: '这个手机号已经领过号了——直接登录就行' });
    }
    const ip = clientIp(req);
    const room = signupRoom(ip);
    if (!room.ok) {
      console.log(`[demo] 领号拦下：${ip} 今天已领 ${room.used} 个（上限 ${signupMax()}）`);
      return json(res, 200, { ok: false, error: `今天这个网络已经领了 ${room.used} 个号（上限 ${signupMax()} 个）——明天再来，或换台设备/网络` });
    }
    const acc = {
      id: 'acc_' + randomBytes(6).toString('hex'),
      name, phone, pass: hashPass(password),
      createdAt: Date.now(), lastAt: Date.now(), lastIp: ip,
      /* 档位三件套（2026-10-16 收口）：落在哪档 / 小灶加减 / 试用到期（0＝不过试用，要试用由老板在名单页点） */
      tier: '免费', perk: { on: [], off: [] }, trialUntil: 0, trialTier: '全功能',
      /* 平台认号（2026-10-23）：挂线时各认一次；空着＝这个平台还用不了 */
      bindings: { xhs: null, douyin: null },
    };
    store.accounts[acc.id] = acc;
    store.books[acc.id] = deepClone(store.books[BOOK_TEMPLATE] || {}); // 新号自带建材店样例（从模板克隆）
    bumpSignup(ip);
    const token = startSession(acc.id);
    setSession(res, token, req);
    await persist();
    console.log(`[demo] 新号：${name}（尾号${phone.slice(-4)}）来自 ${ip}`);
    return json(res, 200, { ok: true, account: publicAccount(acc), quota: quotaOf(acc), serverHasKey: !!readEnv().key });
  }
  if (path === '/api/auth/login') {
    const ip = clientIp(req);
    if (authGate.blocked(ip)) return json(res, 200, { ok: false, error: '密码试错太多次了——歇 15 分钟再试' });
    const phone = normPhone(body.phone);
    const password = String(body.password || '');
    const acc = Object.values(store.accounts).find((a) => a.phone === phone);
    if (!acc || !verifyPass(password, acc.pass)) {
      authGate.fail(ip);
      return json(res, 200, { ok: false, error: '手机号或密码不对' });
    }
    authGate.ok(ip);
    acc.lastAt = Date.now();
    const token = startSession(acc.id);
    setSession(res, token, req);
    await persist();
    console.log(`[demo] 登录：${acc.name}（尾号${acc.phone.slice(-4)}）`);
    return json(res, 200, { ok: true, account: publicAccount(acc), quota: quotaOf(acc), serverHasKey: !!readEnv().key });
  }
  if (path === '/api/auth/logout') {
    const token = sessionToken(req);
    if (token && store.sessions[token]) { delete store.sessions[token]; await persist(); }
    clearSession(res, req);
    return json(res, 200, { ok: true });
  }
  if (path === '/api/auth/me') {
    const acc = resolveAccount(req);
    return json(res, 200, {
      ok: true,
      account: publicAccount(acc),
      quota: acc ? quotaOf(acc) : null,
      serverHasKey: !!readEnv().key,
    });
  }
  if (path === '/api/admin/accounts') {
    if (!adminGate(req, res)) return;
    /* v11：每行带上"这只账号的执行器"状态（老板名单页一眼看谁在线、最近动没动）
       2026-10-15：带上配对号与「包发了没」（发放页两列） */
    const handsByAcc = {};
    for (const h of Object.values(store.exec_hands || {})) handsByAcc[h.accountId] = h;
    const env = readEnv();
    const all = Object.values(store.accounts).map((a) => {
      const bag = store.books[a.id] || {};
      const h = handsByAcc[a.id] || null;
      const demo = a.kind === 'demo';
      const iq = imageQuotaInfo(a, env);
      const tq = textQuotaInfo(store, a, quotaUsed(a.id));
      const dq = dhQuotaInfo(store, a);
      const pk = packSummary(store, a.id);
      return {
        id: a.id, name: a.name, phone: a.phone || '', phoneTail: (a.phone || '').slice(-4),
        createdAt: a.createdAt, lastAt: a.lastAt || a.createdAt, lastIp: a.lastIp || '',
        used: demo ? 0 : tq.used, max: demo ? 0 : tq.max,
        tier: a.tier || '免费', hasExec: !!h,
        pairCode: a.pairCode || '', packSentAt: a.packSentAt || 0,
        /* 2026-10-23：发号名单分平台看认的号，错号在名单上直接红 */
        bindings: execCh.api.bindingsOf(a),
        bindState: execCh.api.bindStateOf(a),
        kind: demo ? 'demo' : 'real',
        demoKey: demo ? (a.demoKey || '') : '',
        demoLabel: demo ? (a.demoLabel || a.name || '') : '',
        industry: demo ? (a.industry || '') : '',
        /* 2026-10-16 档位收口：名单页要看小灶与试用，顺带回合并后的八格 */
        edition: editionOf(a, store),
        exec: h ? { online: (Date.now() - (h.lastSeen || 0)) < 35000, label: h.label || '', lastSeen: h.lastSeen || 0 } : null,
        hasSample: !!bag.demo_preset, bookKeys: Object.keys(bag).length,
        /* 2026-10-21：出图额度（试用/正式分开看）+ 老板视角的 ¥ 成本 */
        img: {
          mode: iq.mode, used: iq.used, max: iq.max, left: iq.left, packLeft: iq.packLeft, unlimited: !!iq.unlimited,
          cost: Number((iq.used * env.imgPrice).toFixed(2)),
        },
        /* 2026-10-21：AI 文本与数字人的本月用量＋算力包 */
        ai: {
          text: { used: tq.used, max: tq.max, left: tq.left, monthly: !!tq.monthly },
          dh: { used: dq.used, max: dq.max, left: dq.left, inflight: dq.inflight },
          pack: { count: pk.count, monthCount: pk.monthCount, maxPerMonth: pk.maxPerMonth, left: pk.left, daysLeft: pk.daysLeft, price: pk.price },
        },
      };
    });
    const list = all.filter((a) => a.kind !== 'demo').sort((x, y) => (y.lastAt || 0) - (x.lastAt || 0));
    const demoList = all.filter((a) => a.kind === 'demo')
      .sort((x, y) => DEMO_ACCOUNTS.findIndex((d) => d.id === x.id) - DEMO_ACCOUNTS.findIndex((d) => d.id === y.id));
    const tpl = store.books[BOOK_TEMPLATE] || {};
    const imgUsed = all.reduce((s, a) => s + (a.img ? a.img.used : 0), 0);
    return json(res, 200, {
      ok: true,
      accounts: list,
      demoAccounts: demoList,
      budget: { day: budgetDay(), used: budgetUsed(), cap: dailyCap() },
      image: {
        keyReady: !!env.imgKey, model: env.imgModel, price: env.imgPrice,
        monthCap: env.imgQuotaMonth, trialCap: env.imgQuotaTrial,
        used: imgUsed, cost: Number((imgUsed * env.imgPrice).toFixed(2)),
        dayUsed: (store.image_quota && store.image_quota.day === budgetDay()) ? Number(store.image_quota.used) || 0 : 0,
        dayCap: env.imgDailyCap,
      },
      template: { keys: Object.keys(tpl).length, hasSample: !!tpl.demo_preset, hasTenant: !!(tpl.tenants && tpl.current_tenant_id) },
      tier_table: store.tier_table,
    });
  }
  /* 老板改档位（发放页「开档位」／A 期脚本：给账号挂上"基础/升级/全功能"；本机直连或带 x-admin-pass） */
  if (path === '/api/admin/set-tier') {
    if (!adminGate(req, res)) return;
    const tier = String(body.tier || '');
    if (!['免费', '基础', '升级', '全功能'].includes(tier)) return json(res, 200, { ok: false, error: '档位不认识（免费/基础/升级/全功能）' });
    const acc = adminAccountOf(body);
    if (!acc) return json(res, 200, { ok: false, error: '没这个号' });
    acc.tier = tier;
    /* 配对号随档位走：开档（239 起）那一刻发码；缩回免费就把码收掉（旧码作废，执行器重挂不了） */
    if (tier === '免费') {
      if (acc.pairCode) { delete acc.pairCode; console.log(`[demo] 配对号收回：${acc.name}（缩回免费档）`); }
    } else if (!acc.pairCode) {
      acc.pairCode = execCh.api.genCode();
      console.log(`[demo] 配对号生成：${acc.name} → ${acc.pairCode}`);
    }
    await persist();
    console.log(`[demo] 改档位：${acc.name} → ${tier}`);
    return json(res, 200, { ok: true, account: publicAccount(acc), tier, pairCode: acc.pairCode || '' });
  }
  /* 老板换配对号（发放页「换码」）：旧码当场作废＋把已挂的机器踢下线，客户用新码重挂 */
  if (path === '/api/admin/new-code') {
    if (!adminGate(req, res)) return;
    const acc = adminAccountOf(body);
    if (!acc) return json(res, 200, { ok: false, error: '没这个号' });
    if (execCh.api.rankOf(acc.tier || '免费') < 1) return json(res, 200, { ok: false, error: '还是免费档——先开档位再发码' });
    const old = acc.pairCode || '';
    acc.pairCode = execCh.api.genCode();
    const kicked = await execCh.api.kick(acc.id, '作废：老板换了配对号，这台机器要用新码重挂');
    await persist();
    console.log(`[demo] 换配对号：${acc.name} ${old || '(还没码)'} → ${acc.pairCode}${kicked ? `（在飞 ${kicked} 单标作废）` : ''}`);
    return json(res, 200, { ok: true, accountId: acc.id, old, pairCode: acc.pairCode, kicked });
  }
  /* 老板换绑（2026-10-23）：按平台清一格——只清这个平台的号、只踢这台机器；
     另一个平台的号一点不动。客户下次挂线只会把清掉的那一格重新认上。 */
  if (path === '/api/admin/rebind') {
    if (!adminGate(req, res)) return;
    const acc = adminAccountOf(body);
    if (!acc) return json(res, 200, { ok: false, error: '没这个号' });
    const platform = String(body.platform || '');
    if (!execCh.api.bindLabel[platform]) return json(res, 200, { ok: false, error: '只认 xhs / douyin 两个平台' });
    const r = await execCh.api.clearBinding(acc, platform);
    if (!r.ok) return json(res, 200, r);
    await persist();
    const label = execCh.api.bindLabel[platform];
    console.log(`[demo] 换绑${label}：${acc.name} 那一格已清${r.already ? '（本来就没绑）' : ''}${r.kicked ? `，在飞 ${r.kicked} 单标作废` : ''}`);
    return json(res, 200, { ok: true, accountId: acc.id, platform, kicked: r.kicked || 0, bindings: execCh.api.bindingsOf(acc) });
  }
  /* 发放页「包发了没」：手工打勾 / 取消（老板自己的记账，不影响任何功能） */
  if (path === '/api/admin/pack-sent') {
    if (!adminGate(req, res)) return;
    const acc = adminAccountOf(body);
    if (!acc) return json(res, 200, { ok: false, error: '没这个号' });
    /* body 带 sent:true/false 就照它设（复制装机消息＝幂等记「已发」）；不带还是老规矩点一下翻转 */
    acc.packSentAt = typeof body.sent === 'boolean'
      ? (body.sent ? (acc.packSentAt || Date.now()) : 0)
      : (acc.packSentAt ? 0 : Date.now());
    await persist();
    return json(res, 200, { ok: true, packSentAt: acc.packSentAt });
  }
  /* 发放页「算力包」：加一份 / 撤一份（2026-10-21；同一自然月最多 2 份，购买起 30 天） */
  if (path === '/api/admin/pack') {
    if (!adminGate(req, res)) return;
    const acc = adminAccountOf(body);
    if (!acc) return json(res, 200, { ok: false, error: '没这个号' });
    const op = String(body.op || (Number(body.delta) === -1 ? 'remove' : 'add'));
    if (op === 'remove') {
      const r = removePack(store, acc.id);
      if (!r.ok) return json(res, 200, { ok: false, error: r.error });
      await persist();
      console.log(`[demo] 算力包：${acc.name} 撤掉一份（剩 ${r.summary.count} 份）`);
      return json(res, 200, { ok: true, pack: r.summary, ai: dhQuotaInfo(store, acc) });
    }
    const r = grantPack(store, acc.id);
    if (!r.ok) return json(res, 200, { ok: false, error: r.error });
    await persist();
    const tq = textQuotaInfo(store, acc, quotaUsed(acc.id));
    console.log(`[demo] 算力包：${acc.name} +1 份（本月第 ${r.summary.monthCount} 份，${r.summary.days} 天有效）→ 文本剩 ${tq.left} / 图剩 ${imageQuotaInfo(acc).left} / 数字人剩 ${dhQuotaInfo(store, acc).left}`);
    return json(res, 200, { ok: true, pack: r.summary, text: tq, image: imageQuotaInfo(acc), dh: dhQuotaInfo(store, acc) });
  }
  /* ── 2026-10-16 档位收口：三档由这台服务器说了算，改完客户机下一次对账（≤15 秒）跟上 ── */
  /* 小灶：只动这一位——mode 'on' 额外开 / 'off' 额外撤 / 'base' 跟档（不动全局表） */
  if (path === '/api/admin/perk') {
    if (!adminGate(req, res)) return;
    const acc = adminAccountOf(body);
    if (!acc) return json(res, 200, { ok: false, error: '没这个号' });
    const key = String(body.key || '');
    const mode = String(body.mode || 'base');
    if (!KIND_KEYS.includes(key)) return json(res, 200, { ok: false, error: '功能格不认识：' + key });
    normalizeAcc(acc);
    acc.perk.on = acc.perk.on.filter((x) => x !== key);
    acc.perk.off = acc.perk.off.filter((x) => x !== key);
    if (mode === 'on' || mode === 'off') acc.perk[mode].push(key);
    await persist();
    console.log(`[demo] 小灶：${acc.name} ${key} → ${mode}`);
    return json(res, 200, { ok: true, accountId: acc.id, perk: acc.perk, edition: editionOf(acc, store) });
  }
  /* 试用：给这一位开 N 天试用期（期内整张表按「试用档」取），days=0 关掉＝立刻落回他本来的档 */
  if (path === '/api/admin/trial') {
    if (!adminGate(req, res)) return;
    const acc = adminAccountOf(body);
    if (!acc) return json(res, 200, { ok: false, error: '没这个号' });
    normalizeAcc(acc);
    const days = Math.max(0, Math.min(365, Number(body.days) || 0));
    if (TIERS.includes(String(body.trialTier))) acc.trialTier = String(body.trialTier);
    acc.trialUntil = days > 0 ? Date.now() + days * 86400000 : 0;
    await persist();
    console.log(`[demo] 试用：${acc.name} ${days > 0 ? days + ' 天（按「' + acc.trialTier + '」开）' : '关掉（落回「' + acc.tier + '」）'}`);
    return json(res, 200, { ok: true, accountId: acc.id, trialUntil: acc.trialUntil, trialTier: acc.trialTier, edition: editionOf(acc, store) });
  }
  /* 档位表：不带 table＝读一眼；带 table＝改（只认已知档 × 已知格，改完全体跟着变，不用重打包） */
  if (path === '/api/admin/tier-table') {
    if (!adminGate(req, res)) return;
    if (!body || !body.table) return json(res, 200, { ok: true, table: store.tier_table });
    const r = setTierTable(store, body.table);
    await persist();
    console.log(`[demo] 改档位表：${Object.keys(body.table).join('/')}${r.errors.length ? '（跳过 ' + r.errors.length + ' 项不认的）' : ''}`);
    return json(res, 200, { ok: true, table: r.table, errors: r.errors });
  }

  /* ── 存储四口 + 动作口：v5 起按会话路由到账号的小账本（没领号 → need-account，页面据此请人领号）── */
  const acc = resolveAccount(req);
  if (!acc) {
    /* 没登录也得能问「我是哪档」——网页界面照这张表锁格（没号就按免费那行，别整页都开着） */
    if (path === '/api/action' && String(body.action || '') === 'getEdition') {
      return json(res, 200, { ok: true, result: await runAction('getEdition', body, req) });
    }
    const dead = { ok: false, error: '先领个号（或登录）就能用了', demo: 'need-account' };
    /* 动作口与其他动作回包同形（{ok:true,result} 包一层）；存储口按老形状直接回。 */
    if (path === '/api/action') return json(res, 200, { ok: true, result: dead });
    return json(res, 200, dead);
  }
  const bag = bookBagFor(acc.id);
  /* 代加解密口：给非安全上下文的页面用（局域网/公网 http 打开时页面自己算不了）。
     明文原样回、算不动报错——页面侧按「读空 / 保存失败」各自兜底。 */
  if (path === '/api/crypt/encrypt') {
    const plain = String(body.plain == null ? '' : body.plain);
    const key = await cbDeriveKey(await cbSaltFor(bag));
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const ct = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
    const inner = JSON.stringify({ f: CB_FMT, v: 1, i: Buffer.from(iv).toString('base64'), d: Buffer.from(ct).toString('base64') });
    return json(res, 200, { ok: true, result: CB_PREFIX + Buffer.from(inner, 'utf8').toString('base64') });
  }
  if (path === '/api/crypt/decrypt') {
    const blob = String(body.blob == null ? '' : body.blob);
    if (blob.indexOf(CB_PREFIX) !== 0) return json(res, 200, { ok: true, result: blob });   // 存量明文原样回
    try {
      const inner = JSON.parse(Buffer.from(blob.slice(CB_PREFIX.length), 'base64').toString('utf8'));
      if (!inner || inner.f !== CB_FMT || !inner.i || !inner.d) throw new Error('密文格式不认识');
      const key = await cbDeriveKey(await cbSaltFor(bag));
      const pt = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(inner.i, 'base64') }, key, Buffer.from(inner.d, 'base64'));
      return json(res, 200, { ok: true, result: new TextDecoder().decode(pt) });
    } catch (e) {
      return json(res, 200, { ok: false, error: '解不开：' + e.message });   // 与页面口径一致：解不开按空处理
    }
  }
  if (path === '/api/storage/get') {
    const items = {};
    const keys = body.keys;
    if (keys == null) { for (const k of Object.keys(bag)) items[k] = JSON.parse(JSON.stringify(bag[k])); }
    else { for (const k of keys) if (k in bag) items[k] = JSON.parse(JSON.stringify(bag[k])); }
    return json(res, 200, { ok: true, items });
  }
  if (path === '/api/storage/set') {
    const items = body.items || {};
    if (acc.kind === 'demo') {
      const hit = demoStorageBlocked(items, bag);
      if (hit) {
        console.log(`[demo] 演示号「${acc.name}」直接写底子「${hit}」→ 拦下（底子只读）`);
        return json(res, 200, demoRoResult());
      }
    }
    const changes = {};
    for (const k of Object.keys(items)) {
      /* v7：入账前把大图搬去 blobs（账本里只留 /api/blob/<id> 链接）；回包不带旧值——省一趟整份下行 */
      const val = blobsOut(items[k], k, acc.id);
      changes[k] = { newValue: JSON.parse(JSON.stringify(val)) };
      bag[k] = JSON.parse(JSON.stringify(val));
    }
    await persist();
    return json(res, 200, { ok: true, changes });
  }
  if (path === '/api/storage/remove') {
    const keys = typeof body.keys === 'string' ? [body.keys] : (body.keys || []);
    if (acc.kind === 'demo') {
      const hit = keys.find((k) => DEMO_LOCKED_STORAGE.has(k) || k.indexOf('tenant_data__') === 0 || k === 'config');
      if (hit) {
        console.log(`[demo] 演示号「${acc.name}」删底子「${hit}」→ 拦下（底子只读）`);
        return json(res, 200, demoRoResult());
      }
    }
    const changes = {};
    for (const k of keys) if (k in bag) { changes[k] = {}; delete bag[k]; }
    await persist();
    return json(res, 200, { ok: true, changes });
  }
  if (path === '/api/storage/clear') {
    if (acc.kind === 'demo') {
      console.log(`[demo] 演示号「${acc.name}」整本清空 → 拦下（底子只读）`);
      return json(res, 200, demoRoResult());
    }
    const changes = {};
    for (const k of Object.keys(bag)) changes[k] = {};
    for (const k of Object.keys(bag)) delete bag[k];   // 逐键删：账本对象引用不能换（后台垫片抱着它）
    await persist();
    return json(res, 200, { ok: true, changes });
  }
  if (path === '/api/action') {
    const name = String(body.action || '(无 action)');
    const result = await runAction(name, body, req);
    return json(res, 200, { ok: true, result });
  }
  return json(res, 404, { ok: false, error: '没有这个接口：' + path });
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const path = decodeURIComponent(url.pathname);
    /* 云端出片取回口：GET /api/film/out/<任务号>?t=<取回口令>——整条 MP4 原样交出去（附件下载）。
       认的是任务上那枚一次性口令，客户机举着它就能取，不必带会话；文件不在就直接说人话。 */
    if (path.startsWith('/api/film/out/')) return void filmJobs.api.handleOut(req, res, url);
    /* 口播工单三口（2026-10-19）：POST /api/lip/put?job=&part=photo|seg|out&i=&mime=&t= 原始字节交料；
       GET /api/lip/out/<单号>?t= 客户机取成片（一取就转「已送回」）；GET /api/lip/file/<单号>?p=photo|track|seg:i|out 看/下载单上那一样。
       认的是单上那枚口令——手机上开念稿页不必登录也能交录音。 */
    if (path === '/api/lip/put') {
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: '只收 POST' });
      try { const out = await lipJobs.api.putFile({}, req, url); return json(res, out && out.code ? out.code : 200, out); }
      catch (e) { return json(res, 500, { ok: false, error: e.message }); }
    }
    if (path.startsWith('/api/lip/out/')) return void lipJobs.api.handleOut(req, res, url);
    if (path.startsWith('/api/lip/file/')) return void lipJobs.api.handleFile(req, res, url);
    /* v7 大图口：GET /api/blob/<24位id>——账本里的大图原样取回（同源带 cookie，<img src> 直接用）。
       强缓存：同一 id 内容永不变，浏览器一周内不再问。
       注：/api/blob/put 也以 /api/blob/ 开头——必须放行到下面的托管口，别被这条 24 位 id 分支吞掉。 */
    if (path.startsWith('/api/blob/') && path !== '/api/blob/put') {
      const id = path.slice('/api/blob/'.length);
      if (!resolveAccount(req)) { res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('401'); return; }
      const meta = (BLOB_ID_RE.test(id) && store.blobs) ? store.blobs[id] : null;
      if (!meta) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404'); return; }
      try {
        const buf = await readFile(join(BLOB_DIR, id));
        res.writeHead(200, {
          'Content-Type': meta.m || 'application/octet-stream',
          'Content-Length': buf.length,
          'Cache-Control': 'private, max-age=604800, immutable',
        });
        res.end(buf);
      } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404'); }
      return;
    }
    /* v10 素材托管口：POST /api/blob/put?name=&mime=——网页交的发笔记素材原样大件存进 data/blobs/。
       账本里只落 {id,name,mime,size} 索引（np_srv_files）；执行器排期到点靠 id 从 /api/exec/blob 取原件。 */
    if (path === '/api/blob/put') {
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: '只收 POST' });
      const acc0 = resolveAccount(req);
      if (!acc0) return json(res, 401, { ok: false, error: '先登录' });
      const name = String(url.searchParams.get('name') || '').slice(0, 80);
      const mime = String(url.searchParams.get('mime') || '').slice(0, 60);
      let buf;
      try { buf = await readRawBody(req); }
      catch (e) { return json(res, 400, { ok: false, error: e.message }); }
      const id = putBlobBuf(buf, mime, name, acc0.id);
      if (!id) return json(res, 200, { ok: false, error: '空的素材没存' });
      return json(res, 200, { ok: true, id, size: buf.length });
    }
    if (path.startsWith('/api/')) {
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: '动作接口只收 POST' });
      let body = {};
      try { body = await readBody(req); }
      catch (e) { return json(res, 400, { ok: false, error: e.message }); }
      try { return await handleApi(path, body, req, res); }
      catch (e) { return json(res, 500, { ok: false, error: e.message }); }
    }
    /* 静态：web/ 端出来（/ ＝ 起始问卷〔2026-10-14 正式版：欢迎页撤下，进门直落〕；/setup ＝ 装执行器页；popup.html 是完整工作台界面；/admin 是名单页） */
    let p = path;
    if (p === '/') p = '/start.html';
    if (p === '/setup' || p === '/setup/') p = '/setup.html';
    if (p === '/guide' || p === '/guide/') p = '/guide.html';
    if (p === '/admin' || p === '/admin/') p = '/admin.html';
    /* 口播工单两页（2026-10-19）：/lip-read 客户一段段念（手机也开这个）；/lip-jobs 老板工单台 */
    if (p === '/lip-read' || p === '/lip-read/') p = '/lip-record.html';
    if (p === '/lip-jobs' || p === '/lip-jobs/') p = '/lip-admin.html';
    const fp = normalize(join(ROOT, p));
    if (!fp.startsWith(normalize(ROOT))) { res.writeHead(403); res.end('403'); return; }
    const st = await stat(fp);
    const mime = MIME[extname(fp).toLowerCase()] || 'application/octet-stream';
    /* 工作台首帧按档位预藏：同一份 popup.html 因账号档位不同而内容不同 → ETag 带上档位签名，
       换档后浏览器不会拿旧档的 304 空壳（gzip 缓存也按这个 etag 分开存）。 */
    const isPopup = p === '/popup.html';
    const popEd = isPopup ? webEdition(resolveAccount(req)) : null;
    const bootCls = isPopup ? popupBootClasses(popEd) : [];
    const bootSig = bootCls.join('.');
    /* v7：静态开 ETag——工作台反复打开不再整份重下（文件没变就回 304 空壳） */
    const etag = '"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + (bootSig ? '-' + bootSig : '') + '"';
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { 'ETag': etag, 'Cache-Control': 'no-cache' });
      res.end();
      return;
    }
    let buf = await readFile(fp);
    if (isPopup) {
      const tag = popupBootTag(bootCls);
      if (tag) buf = Buffer.from(buf.toString('utf8').replace('<head>', '<head>' + tag), 'utf8');
    }
    const head = { 'Content-Type': mime, 'Cache-Control': 'no-cache', 'ETag': etag, 'Content-Length': buf.length };
    /* v7：文本类开压缩（popup.js 1.5MB → gzip ~473KB／brotli ~372KB）；压过的按 etag 缓存，别每次压。
       浏览器多数都收 brotli（比 gzip 再少 2 成，跨境那趟就是这段路最贵），收不到的仍走 gzip。 */
    const ae = String(req.headers['accept-encoding'] || '');
    const compressible = buf.length > 1024 && /text|javascript|json|svg|xml/i.test(mime);
    if (compressible && ae.includes('br')) {
      const ck = fp + '|br|' + etag;
      let br = gzAssetCache.get(ck);
      if (!br) {
        if (gzAssetCache.size > 80) gzAssetCache.clear();
        br = await new Promise((res2) => brotliCompress(buf, { params: { [zc.BROTLI_PARAM_QUALITY]: 9 } }, (e2, out) => res2(e2 ? null : out)));
        if (br) gzAssetCache.set(ck, br);
      }
      if (br) {
        head['Content-Encoding'] = 'br';
        head['Vary'] = 'Accept-Encoding';
        head['Content-Length'] = br.length;
        res.writeHead(200, head);
        res.end(br);
        return;
      }
    }
    if (compressible && ae.includes('gzip')) {
      const ck = fp + '|gz|' + etag;
      let gz = gzAssetCache.get(ck);
      if (!gz) {
        if (gzAssetCache.size > 80) gzAssetCache.clear();
        gz = gzipSync(buf);
        gzAssetCache.set(ck, gz);
      }
      head['Content-Encoding'] = 'gzip';
      head['Vary'] = 'Accept-Encoding';
      head['Content-Length'] = gz.length;
      res.writeHead(200, head);
      res.end(gz);
      return;
    }
    res.writeHead(200, head);
    res.end(buf);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 ' + req.url);
  }
}).listen(PORT, () => {
  const FK = filmJobs.api.knobs();
  const LK = lipJobs.api.knobs();
  console.log(`[demo] v11 已就位：web/（进门直落起始页 / 装执行器页 /setup / 新手引导页 /guide）＋ 账号体系（一个手机号一个号）＋分账本（新号自带建材店样例）＋后台副本（${bg ? '已上岗' : '没起来'}）＋执行器通道（配对号挂线/下单/回执/熔断/解绑——服务器只递纸条，碰平台的活在客户浏览器里）＋发放页（开档位发码/换码踢机/停这一趟）＋排期到点自动下单（发布队列/队列每周自动跑/日常浏览每天自动跑；静默期与熔断不派单）＋免费额度／AI 额度（付费每月 150 次文本 / 150 张图 / 2 条数字人；免费 ${quotaMax()} 次文本 / 10 张一次性；算力包 30 元 +150/+30/+2）＋每日全站总闸（${dailyCap()} 次）＋大图外置/gzip/ETag ＋ D 期（多账号隔离/换机解绑重挂/试错闸/下单防连点）＋云端出片（先来后到排队·一次跑 ${FK.conc} 条·一人一天 ${FK.daily} 条·一条最多 ${FK.maxSecs} 秒/${FK.maxScenes} 幕·片子留 ${FK.keepDays} 天）＋口播工单（客户交料·老板人工出片·${LK.dailyCap} 单/天·承诺${lipJobs.api.dueLabel()}好·料与片留 ${LK.keepDays} 天） → http://127.0.0.1:${PORT}/`);
  execSched.start();
  filmJobs.start();
  lipJobs.start();
});
