/** tier.mjs — 档位表：全系统「哪一档开哪几格」的唯一真源
 *
 * 2026-10-16 形态收口：三档不再打在客户端包里（包里的 edition.js 降为「进门默认」），
 *   改由这台服务器按账号下发。这里就是那张表 + 合并算法 + 派活闸的判据。
 *
 * 三档边界（2026-10-09 五十四改定，这轮一字未改）：
 *   ① 基础版 ¥239 ＝ 共用三格 + 发笔记（含字效编辑器）
 *   ② 升级版 ¥399 ＝ ① + 获客（日常浏览随获客走，不对外列）
 *   ③ 全功能版 ¥539 ＝ ② + 线索
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
];
export const KIND_KEYS = KINDS.map((x) => x.k);
export const SHARED_KEYS = KINDS.filter((x) => x.shared).map((x) => x.k);
export const TIERS = ['免费', '基础', '升级', '全功能'];
export const TIER_PRICE = { 免费: 0, 基础: 239, 升级: 399, 全功能: 539 };

/** 初始档位表：逐字搬自 build.js PRESETS（搬完打包侧那份只当进门默认，不再当判据） */
export const DEFAULT_TABLE = {
  '免费':   { batchSend: true, tenant: true, knowledge: true, notePublish: 'part', videoFilm: false, autoWater: false, dailyBrowse: false, prospectList: false },
  '基础':   { batchSend: true, tenant: true, knowledge: true, notePublish: true,  videoFilm: true,  autoWater: false, dailyBrowse: false, prospectList: false },
  '升级':   { batchSend: true, tenant: true, knowledge: true, notePublish: true,  videoFilm: true,  autoWater: true,  dailyBrowse: true,  prospectList: false },
  '全功能': { batchSend: true, tenant: true, knowledge: true, notePublish: true,  videoFilm: true,  autoWater: true,  dailyBrowse: true,  prospectList: true },
};

/** 派活的活 → 看哪一格（原来按档位数比大小，现在按格子；self_test 谁都能跑） */
export const KIND_GATE = { self_test: '', note_publish: 'notePublish', batch_send: 'batchSend', film: 'videoFilm', acquire: 'autoWater', daily_browse: 'dailyBrowse', leads: 'prospectList' };

const clone = (t) => JSON.parse(JSON.stringify(t));

/** 账本懒建：全局档位表 + 每账号的小灶/试用字段（缺啥补啥，不动已有值） */
export function ensureTierStore(store) {
  if (!store.tier_table || typeof store.tier_table !== 'object') store.tier_table = clone(DEFAULT_TABLE);
  for (const t of TIERS) if (!store.tier_table[t]) store.tier_table[t] = clone(DEFAULT_TABLE[t]);
  for (const acc of Object.values(store.accounts || {})) normalizeAcc(acc);
  return store.tier_table;
}

export function normalizeAcc(acc) {
  if (!TIERS.includes(acc.tier)) acc.tier = '免费';
  acc.perk = { on: cleanKeys(acc.perk && acc.perk.on), off: cleanKeys(acc.perk && acc.perk.off) };
  acc.trialUntil = Number(acc.trialUntil) || 0;
  if (!TIERS.includes(acc.trialTier)) acc.trialTier = '全功能';
  return acc;
}

function cleanKeys(list) {
  return Array.isArray(list) ? list.map((x) => String(x)).filter((x) => KIND_KEYS.includes(x)) : [];
}

/** 这位现在落在哪一档：试用没过期就按试用档取 */
export function tierNow(acc, table, now) {
  const t = table || DEFAULT_TABLE;
  const base = TIERS.includes(acc && acc.tier) ? acc.tier : '免费';
  const onTrial = !!(acc && acc.trialUntil && acc.trialUntil > (now || Date.now()) && TIERS.includes(acc.trialTier) && acc.trialTier !== base);
  return { tier: base, onTrial, trialTier: onTrial ? acc.trialTier : base, label: onTrial ? acc.trialTier : base };
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
  return {
    tier: f.tier,
    label: f.label,
    tierLabel: f.label + '版',
    price: TIER_PRICE[f.label] || 0,
    onTrial: f.onTrial,
    trialTier: f.trialTier,
    trialUntil: (acc && acc.trialUntil) || 0,
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
  if (!f.features[gateKey]) {
    const need = KINDS.find((x) => x.k === gateKey);
    return { ok: false, error: `「${(need && need.n) || gateKey}」这一档没开（现在是「${f.label}」档）——找给你网址的人在那台机器上点一下就开，不用重装` };
  }
  /* 「只到写稿」：稿能写、稿能存，但不给真发出去（小灶把「发笔记」整格加开就照发） */
  if (kind === 'note_publish' && f.draftOnly) {
    return { ok: false, error: '免费档只到写稿——稿子存着能看，要真发出去先开档位（239 起）' };
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
