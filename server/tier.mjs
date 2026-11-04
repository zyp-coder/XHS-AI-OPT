/** tier.mjs — 档位表：全系统「哪一档开哪几格」的唯一真源
 *
 * 2026-10-16 形态收口：三档不再打在客户端包里（包里的 edition.js 降为「进门默认」），
 *   改由这台服务器按账号下发。这里就是那张表 + 合并算法 + 派活闸的判据。
 *
 * 四档边界（2026-10-29 加「全平台」档，前三档一字未动）：
 *   ① 基础版 ¥239 ＝ 共用三格 + 发笔记（含字效编辑器）
 *   ② 升级版 ¥399 ＝ ① + 获客（日常浏览随获客走，不对外列）
 *   ③ 全功能版 ¥539 ＝ ② + 线索
 *   ④ 全平台版 ¥699 ＝ ③ + 抖音 / 视频号（发笔记能发这两家，抖音获客也能跑）
 *      前三档只做小红书——发笔记只发小红书、获客只跑小红书（写稿仍可选抖音/快手/闲鱼，那只是出文案）
 *   免费档        ＝ 共用三格 + 发笔记「只到写稿」（不出片、不发出去）
 *
 * 每格三种值：true＝开 / false＝关 / 'part'＝只写稿（只有「发笔记」这格用）
 * 合并：落在的档 ∪ 小灶加 − 小灶撤；试用期内整张表按「试用档」取，小灶照加照撤。
 */

export const KINDS = [
  { k: 'batchSend',   n: '整页发送',   shared: true },
  { k: 'tenant',      n: '多产品切换', shared: true },
  { k: 'knowledge',   n: '知识库',     shared: true },
  { k: 'notePublish', n: '发笔记' },
  { k: 'videoFilm',   n: '字效编辑器' },
  { k: 'autoWater',   n: '获客' },
  { k: 'dailyBrowse', n: '日常浏览', quiet: true },
  { k: 'prospectList', n: '线索' },
  { k: 'multiPlatform', n: '抖音 / 视频号' },
];
export const KIND_KEYS = KINDS.map((x) => x.k);
export const SHARED_KEYS = KINDS.filter((x) => x.shared).map((x) => x.k);
export const TIERS = ['免费', '基础', '升级', '全功能', '全平台'];
export const TIER_PRICE = { 免费: 0, 基础: 239, 升级: 399, 全功能: 539, 全平台: 699 };

/** 新号自动试用：30 天，期内按「全功能」开；到期落回本来的档（一般是免费），不锁号。
 *  天数只改这一处；老板要改口径就改这个数。 */
export const TRIAL_DAYS = 30;
export const TRIAL_TIER = '全功能';

/** 付费档一轮 30 天（2026-11-02 定）：开档/续费都写 paidUntil；到期落回免费、不锁号。
 *  天数只改这一处。 */
export const PAID_DAYS = 30;

/** 给这个号开一轮试用（从 now 起算）；trialTier 没设过就按全功能 */
export function startTrial(acc, days, now) {
  const n = Math.max(1, Math.min(365, Number(days) || TRIAL_DAYS));
  if (!TIERS.includes(acc.trialTier) || acc.trialTier === '免费') acc.trialTier = TRIAL_TIER;
  acc.trialUntil = (Number(now) || Date.now()) + n * 86400000;
  return acc.trialUntil;
}

/** 开付费档：从 now 起算 30 天（试用转付费＝从开档这天算，试用剩的作废） */
export function startPlan(acc, days, now) {
  const n = Math.max(1, Math.min(365, Number(days) || PAID_DAYS));
  acc.paidUntil = (Number(now) || Date.now()) + n * 86400000;
  return acc.paidUntil;
}

/** 续费：在现有到期日上顺延（还没到期＝往后加；已过期＝从今天起算） */
export function renewPlan(acc, days, now) {
  const n = Math.max(1, Math.min(365, Number(days) || PAID_DAYS));
  const nowMs = Number(now) || Date.now();
  const base = Math.max(nowMs, Number(acc.paidUntil) || 0);
  acc.paidUntil = base + n * 86400000;
  return acc.paidUntil;
}

/** 付费期是不是「开过、已经到期了」：到期按免费档算，号还能登、数据都在 */
export function planExpiredAt(acc, now) {
  const until = Number(acc && acc.paidUntil) || 0;
  return !!(until && until <= (Number(now) || Date.now()) && TIERS.includes(acc && acc.tier) && acc.tier !== '免费');
}

/** 初始档位表：逐字搬自 build.js PRESETS（搬完打包侧那份只当进门默认，不再当判据） */
export const DEFAULT_TABLE = {
  '免费':   { batchSend: true, tenant: true, knowledge: true, notePublish: 'part', videoFilm: false, autoWater: false, dailyBrowse: false, prospectList: false, multiPlatform: false },
  '基础':   { batchSend: true, tenant: true, knowledge: true, notePublish: true,  videoFilm: true,  autoWater: false, dailyBrowse: false, prospectList: false, multiPlatform: false },
  '升级':   { batchSend: true, tenant: true, knowledge: true, notePublish: true,  videoFilm: true,  autoWater: true,  dailyBrowse: true,  prospectList: false, multiPlatform: false },
  '全功能': { batchSend: true, tenant: true, knowledge: true, notePublish: true,  videoFilm: true,  autoWater: true,  dailyBrowse: true,  prospectList: true,  multiPlatform: false },
  '全平台': { batchSend: true, tenant: true, knowledge: true, notePublish: true,  videoFilm: true,  autoWater: true,  dailyBrowse: true,  prospectList: true,  multiPlatform: true },
};

/** 派活的活 → 看哪一格（原来按档位数比大小，现在按格子；self_test 谁都能跑；relogin 只是让那台电脑打开登录页，不算档位） */
export const KIND_GATE = { self_test: '', note_publish: 'notePublish', batch_send: 'batchSend', film: 'videoFilm', acquire: 'autoWater', daily_browse: 'dailyBrowse', leads: 'prospectList', relogin: '' };

const clone = (t) => JSON.parse(JSON.stringify(t));

/** 账本懒建：全局档位表 + 每账号的小灶/试用字段（缺啥补啥，不动已有值） */
export function ensureTierStore(store) {
  if (!store.tier_table || typeof store.tier_table !== 'object') store.tier_table = clone(DEFAULT_TABLE);
  for (const t of TIERS) {
    if (!store.tier_table[t]) { store.tier_table[t] = clone(DEFAULT_TABLE[t]); continue; }
    /* 老账本缺格（比如 2026-10-29 新加的「抖音 / 视频号」）：按初始表补齐，已改过的值不动 */
    for (const k of KIND_KEYS) {
      if (!(k in store.tier_table[t])) store.tier_table[t][k] = DEFAULT_TABLE[t][k];
    }
  }
  for (const acc of Object.values(store.accounts || {})) normalizeAcc(acc);
  return store.tier_table;
}

export function normalizeAcc(acc) {
  if (!TIERS.includes(acc.tier)) acc.tier = '免费';
  acc.perk = { on: cleanKeys(acc.perk && acc.perk.on), off: cleanKeys(acc.perk && acc.perk.off) };
  acc.trialUntil = Number(acc.trialUntil) || 0;
  acc.paidUntil = Number(acc.paidUntil) || 0;
  if (!TIERS.includes(acc.trialTier)) acc.trialTier = '全功能';
  return acc;
}

function cleanKeys(list) {
  return Array.isArray(list) ? list.map((x) => String(x)).filter((x) => KIND_KEYS.includes(x)) : [];
}

/** 这位现在落在哪一档：付费到期按免费取；试用没过期就按试用档取 */
export function tierNow(acc, table, now) {
  const nowMs = Number(now) || Date.now();
  const raw = TIERS.includes(acc && acc.tier) ? acc.tier : '免费';
  const paidExpired = planExpiredAt(acc, nowMs);
  const base = paidExpired ? '免费' : raw;
  const onTrial = !!(acc && acc.trialUntil && acc.trialUntil > nowMs && TIERS.includes(acc.trialTier) && acc.trialTier !== base && !paidExpired);
  return { tier: base, planTier: raw, paidExpired, onTrial, trialTier: onTrial ? acc.trialTier : base, label: onTrial ? acc.trialTier : base };
}

/** 试用是不是「开过、已经到期了」：试用到期落回本档，本档还是免费 → 该在界面上说一句 */
export function trialExpiredAt(acc, now) {
  const until = Number(acc && acc.trialUntil) || 0;
  return !!(until && until <= (Number(now) || Date.now()) && acc.tier === '免费' && acc.trialTier !== '免费');
}

/** 合并出「能点哪几格」；'part' 在这一层解成开，另外单独给一个 draftOnly 标记 */
export function featuresFor(acc, table, now) {
  const t = table || DEFAULT_TABLE;
  const tn = tierNow(acc, t, now);
  const base = t[tn.trialTier] || {};
  const perk = (acc && acc.perk) || {};
  const on = Array.isArray(perk.on) ? perk.on : [];
  const off = Array.isArray(perk.off) ? perk.off : [];
  const features = {};
  let draftOnly = false;
  for (const k of KIND_KEYS) {
    let v = base[k];
    if (on.includes(k)) v = true;
    if (off.includes(k)) v = false;
    if (v === 'part') { draftOnly = true; v = true; }
    features[k] = !!v;
  }
  return { features, draftOnly, ...tn };
}

/** 发给客户端的整包（登录、心跳、派活回话共用这一份形状） */
export function editionOf(acc, store, now) {
  const t = (store && store.tier_table) || DEFAULT_TABLE;
  const f = featuresFor(acc, t, now);
  const nowMs = Number(now) || Date.now();
  const trialUntil = Number(acc && acc.trialUntil) || 0;
  const trialDays = f.onTrial ? Math.max(0, Math.ceil((trialUntil - nowMs) / 86400000)) : 0;
  const paidUntil = Number(acc && acc.paidUntil) || 0;
  const planExpired = planExpiredAt(acc, nowMs);
  const planDays = (!planExpired && paidUntil > nowMs) ? Math.max(0, Math.ceil((paidUntil - nowMs) / 86400000)) : 0;
  return {
    tier: f.tier,
    planTier: f.planTier,
    planPrice: TIER_PRICE[f.planTier] || 0,
    label: f.label,
    tierLabel: f.label + '版',
    price: TIER_PRICE[f.label] || 0,
    onTrial: f.onTrial,
    trialTier: TIERS.includes(acc && acc.trialTier) ? acc.trialTier : TRIAL_TIER,
    trialUntil,
    trialDays,
    trialExpired: trialExpiredAt(acc, nowMs),
    paidUntil,
    planDays,
    planExpired,
    draftOnly: f.draftOnly,
    perk: { on: Array.isArray(acc && acc.perk && acc.perk.on) ? acc.perk.on : [], off: Array.isArray(acc && acc.perk && acc.perk.off) ? acc.perk.off : [] },
    features: f.features,
    sharedOnly: f.label === '免费' && !f.onTrial,
  };
}

/** 派活闸：这一档（含小灶、含试用）开不开这门活。返回 {ok, error} */
export function canKind(acc, store, kind, now) {
  const gateKey = KIND_GATE[kind];
  if (gateKey === undefined) return { ok: false, error: '不认识的活：' + kind };
  if (!gateKey) return { ok: true };
  const f = featuresFor(acc, (store && store.tier_table) || DEFAULT_TABLE, now);
  const lead = planExpiredAt(acc, now) ? '本期到期了，已落回免费档：'
    : (trialExpiredAt(acc, now) ? '试用到期了，已落回免费档：' : '');
  if (!f.features[gateKey]) {
    const need = KINDS.find((x) => x.k === gateKey);
    return { ok: false, error: lead + `「${(need && need.n) || gateKey}」这一档没开（现在是「${f.label}」档）——找给你网址的人在那台机器上点一下就开，不用重装` };
  }
  /* 「只到写稿」：稿能写、稿能存，但不给真发出去（小灶把「发笔记」整格加开就照发） */
  if (kind === 'note_publish' && f.draftOnly) {
    return { ok: false, error: lead + '免费档只到写稿——稿子存着能看，要真发出去先开档位（239 起）' };
  }
  return { ok: true };
}

/** 校验并写回全局档位表；只认已知档 × 已知格，值只认 true/false/'part'（'part' 只给发笔记） */
export function setTierTable(store, patch) {
  const t = store.tier_table || clone(DEFAULT_TABLE);
  const errors = [];
  for (const [tier, row] of Object.entries(patch || {})) {
    if (!TIERS.includes(tier)) { errors.push('档位不认识：' + tier); continue; }
    for (const [k, v] of Object.entries(row || {})) {
      if (!KIND_KEYS.includes(k)) { errors.push('功能格不认识：' + k); continue; }
      if (v === 'part') { if (k !== 'notePublish') { errors.push('只有「发笔记」能设成只写稿：' + k); continue; } t[tier][k] = 'part'; }
      else t[tier][k] = !!v;
    }
  }
  store.tier_table = t;
  return { table: t, errors };
}
