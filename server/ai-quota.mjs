/** ai-quota.mjs — 每月 AI 额度 ＋ 30 元算力包账本（2026-10-21）
 *
 * 真源：资料/AI额度与算力包-确认单.md
 *
 * 档位每月自带（免费号是一次性，不按月恢复）：
 *   免费     文本 50 · 图 10 · 数字人 0
 *   239/399/539 文本 150 · 图 150 · 数字人 2
 * 算力包 30 元：文本 +150 · 图 +30 · 数字人 +2；购买起 30 天；同一自然月最多 2 份。
 * 扣减顺序：付费档先档位、再算力包；免费号先算力包、再那 50 次。
 * 自己填了 AI Key 的不走这里（调用方先判 Key；这里只管服务器 Key 的账）。
 *
 * 账本（都在主 store 里，持久化由调用方 persist）：
 *   ai_quota = { by: { <账号id>: { month, text, dh, textTotal, dhTotal, boot, firstAt, lastAt } } }
 *   ai_packs = { by: { <账号id>: [ { id, at, exp, used:{text,image,dh} } ] } }
 *
 * 文本按「次」记（一次动作＝1 次，和原来免费额度同口径）；图片账仍在 image_quota（按张），
 * 这里只提供算力包那 30 张的扣/退；数字人在口播工单「交片」那一刻扣 1 条。
 */

export const TIER_AI_QUOTA = {
  '免费':   { text: 50,  image: 10,  dh: 0 },
  '基础':   { text: 150, image: 150, dh: 2 },
  '升级':   { text: 150, image: 150, dh: 2 },
  '全功能': { text: 150, image: 150, dh: 2 },
};
export const PACK = { price: 30, text: 150, image: 30, dh: 2, maxPerMonth: 2, days: 30 };
export const AI_KINDS = ['text', 'image', 'dh'];
export const KIND_LABEL = { text: '文本', image: '图片', dh: '数字人' };

const DAY_MS = 86400000;
const clone = (v) => JSON.parse(JSON.stringify(v));

export function aiMonth(now) {
  const d = new Date(now || Date.now());
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

export function ensureAiStore(store) {
  if (!store.ai_quota || typeof store.ai_quota !== 'object') store.ai_quota = { by: {} };
  if (!store.ai_quota.by || typeof store.ai_quota.by !== 'object') store.ai_quota.by = {};
  if (!store.ai_packs || typeof store.ai_packs !== 'object') store.ai_packs = { by: {} };
  if (!store.ai_packs.by || typeof store.ai_packs.by !== 'object') store.ai_packs.by = {};
  return store;
}

/** 这位现在按哪一档算额度：试用期内按 trialTier（与界面显示的档位一致），否则按基础档 */
export function effectiveAiTier(acc, now) {
  if (!acc || acc.kind === 'demo') return '免费';
  const base = TIER_AI_QUOTA[acc.tier] ? acc.tier : '免费';
  const ts = now || Date.now();
  const trial = Number(acc.trialUntil) > ts && TIER_AI_QUOTA[acc.trialTier] ? acc.trialTier : '';
  return trial || base;
}

export function isPaid(acc, now) {
  return effectiveAiTier(acc, now) !== '免费';
}

export function tierAiQuota(acc, now) {
  return clone(TIER_AI_QUOTA[effectiveAiTier(acc, now)]);
}

/** 这一位这个自然月的文本/数字人账；跨月就把本月计数清零（累计数不清） */
export function aiRec(store, accId, now) {
  ensureAiStore(store);
  const ts = now || Date.now();
  const month = aiMonth(ts);
  let rec = store.ai_quota.by[accId];
  if (!rec) {
    rec = store.ai_quota.by[accId] = {
      month, text: 0, dh: 0, textTotal: 0, dhTotal: 0,
      boot: false, firstAt: ts, lastAt: 0,
    };
  }
  if (rec.month !== month) { rec.month = month; rec.text = 0; rec.dh = 0; }
  return rec;
}

function packBag(store, accId) {
  ensureAiStore(store);
  if (!Array.isArray(store.ai_packs.by[accId])) store.ai_packs.by[accId] = [];
  return store.ai_packs.by[accId];
}
function packList(store, accId) {
  return (accId && store.ai_packs && store.ai_packs.by && store.ai_packs.by[accId]) || [];
}

export function activePacks(store, accId, now) {
  if (!accId) return [];
  const ts = now || Date.now();
  return packList(store, accId).filter((p) => Number(p.exp) > ts);
}

export function packsThisMonth(store, accId, now) {
  if (!accId) return 0;
  const m = aiMonth(now);
  return packList(store, accId).filter((p) => aiMonth(p.at) === m).length;
}

/** 算力包总览：剩多少、几张、最近哪天到期（界面直接吃这一份） */
export function packSummary(store, accId, now) {
  const ts = now || Date.now();
  const list = activePacks(store, accId, ts);
  const used = { text: 0, image: 0, dh: 0 };
  for (const p of list) for (const k of AI_KINDS) used[k] += Math.max(0, Number(p.used && p.used[k]) || 0);
  const total = { text: PACK.text * list.length, image: PACK.image * list.length, dh: PACK.dh * list.length };
  const left = { text: Math.max(0, total.text - used.text), image: Math.max(0, total.image - used.image), dh: Math.max(0, total.dh - used.dh) };
  const exp = list.length ? Math.min.apply(null, list.map((p) => Number(p.exp) || 0)) : 0;
  return {
    count: list.length,
    monthCount: packsThisMonth(store, accId, ts),
    maxPerMonth: PACK.maxPerMonth,
    price: PACK.price,
    days: PACK.days,
    used, total, left,
    exp,
    daysLeft: exp ? Math.max(0, Math.ceil((exp - ts) / DAY_MS)) : 0,
  };
}

function newPackId() {
  return 'pack_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

/** 老板加一份算力包；同一自然月最多 PACK.maxPerMonth 份 */
export function grantPack(store, accId, now) {
  const ts = now || Date.now();
  const n = packsThisMonth(store, accId, ts);
  if (n >= PACK.maxPerMonth) {
    return { ok: false, error: `这个月最多加 ${PACK.maxPerMonth} 份算力包（已经 ${n} 份了）——下个月再加` };
  }
  const p = { id: newPackId(), at: ts, exp: ts + PACK.days * DAY_MS, used: { text: 0, image: 0, dh: 0 } };
  packBag(store, accId).push(p);
  return { ok: true, pack: p, summary: packSummary(store, accId, ts) };
}

/** 撤掉最新一份还没过期的算力包（加错了用；已经用掉的数不往回补） */
export function removePack(store, accId, now) {
  const ts = now || Date.now();
  const list = activePacks(store, accId, ts);
  if (!list.length) return { ok: false, error: '这位现在没有还没过期的算力包' };
  const newest = list.reduce((a, b) => (Number(b.at) || 0) > (Number(a.at) || 0) ? b : a, list[0]);
  const bag = packBag(store, accId);
  const i = bag.findIndex((p) => p.id === newest.id);
  if (i >= 0) bag.splice(i, 1);
  return { ok: true, removed: newest, summary: packSummary(store, accId, ts) };
}

/** 从最早到期的那份里扣一样；没有就回 null */
export function packTake(store, accId, kind, now) {
  if (!AI_KINDS.includes(kind)) return null;
  const ts = now || Date.now();
  const list = activePacks(store, accId, ts).sort((a, b) => (a.exp || 0) - (b.exp || 0));
  for (const p of list) {
    const used = Math.max(0, Number(p.used && p.used[kind]) || 0);
    if (used < PACK[kind]) {
      p.used = p.used || {};
      p.used[kind] = used + 1;
      return p;
    }
  }
  return null;
}

export function packGiveBack(store, accId, packId, kind) {
  const p = packList(store, accId).find((x) => x.id === packId);
  if (!p || !p.used || !AI_KINDS.includes(kind)) return;
  p.used[kind] = Math.max(0, (Number(p.used[kind]) || 0) - 1);
}

/** 老账本里已经用掉的次数，第一次见新账本时并进本月（不白送、也不倒扣）；只并这一次，跨月不再并 */
function bootText(rec, legacyUsed, max) {
  if (rec.boot) return;
  rec.text = Math.min(Math.max(0, Number(legacyUsed) || 0), max);
  rec.textTotal = Math.max(Number(rec.textTotal) || 0, rec.text);
  rec.boot = true;
}

/** 本月文本额度：used/max 只算档位那部分，算力包单独给出 left，界面好分开显示 */
export function textQuotaInfo(store, acc, legacyUsed, now) {
  const ts = now || Date.now();
  if (!acc) return { mode: 'none', monthly: false, used: 0, max: 0, tierLeft: 0, packLeft: 0, left: 0, pack: packSummary(store, '', ts) };
  const pk = packSummary(store, acc.id, ts);
  if (acc.kind === 'demo') {
    return { mode: 'demo', unlimited: true, monthly: false, month: aiMonth(ts), used: 0, max: 0, tierLeft: 0, packLeft: pk.left.text, left: 9999, pack: pk };
  }
  const paid = isPaid(acc, ts);
  const q = tierAiQuota(acc, ts);
  const max = q.text;
  let used;
  if (paid) {
    const rec = aiRec(store, acc.id, ts);
    bootText(rec, legacyUsed, max);
    used = Math.max(0, Number(rec.text) || 0);
  } else {
    used = Math.max(0, Number(legacyUsed) || 0);
  }
  const tierLeft = Math.max(0, max - used);
  return {
    mode: paid ? 'paid' : 'free', monthly: paid, month: aiMonth(ts),
    used, max, tierLeft, packLeft: pk.left.text, left: tierLeft + pk.left.text, pack: pk,
  };
}

export function textQuotaBlockedText(acc, info) {
  const i = info || {};
  if (i.mode === 'paid') {
    return `这个月的 ${i.max} 次 AI 文本额度用完了——下月 1 日恢复，或加一份 ${PACK.price} 元算力包（+${PACK.text} 次）；也可以到「设置 → AI 模型配置」填自己的 AI Key`;
  }
  return `赠送的 ${i.max || TIER_AI_QUOTA['免费'].text} 次 AI 文本用完了——可以加一份 ${PACK.price} 元算力包（+${PACK.text} 次），或到「设置 → AI 模型配置」填自己的 AI Key`;
}

/** 扣 1 次文本。返回 {ok, tok}；tok.kind='legacy' 由调用方去加那 50 次的老账 */
export function textQuotaTake(store, acc, legacyUsed, now) {
  const ts = now || Date.now();
  if (!acc) return { ok: false, error: '先登录才能用服务器 AI' };
  if (acc.kind === 'demo') return { ok: true, tok: null };
  const paid = isPaid(acc, ts);
  const q = tierAiQuota(acc, ts);
  if (paid) {
    const rec = aiRec(store, acc.id, ts);
    bootText(rec, legacyUsed, q.text);
    if (rec.text < q.text) {
      rec.text = (Number(rec.text) || 0) + 1;
      rec.textTotal = (Number(rec.textTotal) || 0) + 1;
      rec.lastAt = ts;
      return { ok: true, tok: { accId: acc.id, kind: 'tier', month: rec.month } };
    }
    const p = packTake(store, acc.id, 'text', ts);
    if (p) return { ok: true, tok: { accId: acc.id, kind: 'pack', packId: p.id } };
  } else {
    const p = packTake(store, acc.id, 'text', ts);
    if (p) return { ok: true, tok: { accId: acc.id, kind: 'pack', packId: p.id } };
    if ((Number(legacyUsed) || 0) < q.text) return { ok: true, tok: { accId: acc.id, kind: 'legacy' } };
  }
  return { ok: false, error: textQuotaBlockedText(acc, textQuotaInfo(store, acc, legacyUsed, ts)) };
}

/** 口播工单里还没交片的数字人单（占着额度，界面按「可用」扣掉）。
 *  delivered 不算在途：交片那一刻已经扣过额度了，再算一次会把剩余扣两遍。 */
export function dhInflight(store, accId) {
  return Object.values(store.lip_jobs || {}).filter((j) =>
    j && j.acc === accId && j.route === 'avatar' && !['delivered', 'taken', 'canceled'].includes(j.state)).length;
}

export function dhQuotaInfo(store, acc, now) {
  const ts = now || Date.now();
  const pk = packSummary(store, acc && acc.id, ts);
  if (!acc) return { mode: 'none', monthly: false, used: 0, max: 0, tierLeft: 0, packLeft: pk.left.dh, inflight: 0, left: pk.left.dh, pack: pk };
  if (acc.kind === 'demo') {
    return { mode: 'demo', unlimited: true, monthly: false, used: 0, max: 0, tierLeft: 0, packLeft: pk.left.dh, inflight: 0, left: 9999, pack: pk };
  }
  const paid = isPaid(acc, ts);
  const rec = aiRec(store, acc.id, ts);
  const max = paid ? tierAiQuota(acc, ts).dh : 0;
  const used = paid ? Math.max(0, Number(rec.dh) || 0) : 0;
  const tierLeft = Math.max(0, max - used);
  const inflight = dhInflight(store, acc.id);
  const left = Math.max(0, tierLeft + pk.left.dh - inflight);
  return {
    mode: paid ? 'paid' : 'free', monthly: paid, month: aiMonth(ts),
    used, max, tierLeft, packLeft: pk.left.dh, inflight, left, pack: pk,
  };
}

/** 交片那一刻扣 1 条：先档位、再算力包；两边都没了就记成超支（不拦交片，后续下单会被挡住） */
export function dhQuotaTake(store, acc, now) {
  const ts = now || Date.now();
  if (!acc) return { ok: false };
  if (acc.kind === 'demo') return { ok: true, over: false, tok: null };
  const rec = aiRec(store, acc.id, ts);
  const paid = isPaid(acc, ts);
  const max = paid ? tierAiQuota(acc, ts).dh : 0;
  if (paid && rec.dh < max) {
    rec.dh = (Number(rec.dh) || 0) + 1;
    rec.dhTotal = (Number(rec.dhTotal) || 0) + 1;
    rec.lastAt = ts;
    return { ok: true, over: false, tok: { kind: 'tier' } };
  }
  const p = packTake(store, acc.id, 'dh', ts);
  if (p) {
    rec.dhTotal = (Number(rec.dhTotal) || 0) + 1;
    rec.lastAt = ts;
    return { ok: true, over: false, tok: { kind: 'pack', packId: p.id } };
  }
  rec.dh = (Number(rec.dh) || 0) + 1;
  rec.dhTotal = (Number(rec.dhTotal) || 0) + 1;
  rec.lastAt = ts;
  return { ok: true, over: true, tok: { kind: 'over' } };
}

/** 出图扣算力包那 30 张里的 1 张（档位那 150 张仍走 imageQuota 自己的账） */
export function imagePackTake(store, acc, now) {
  if (!acc) return null;
  return packTake(store, acc.id, 'image', now);
}

export function imagePackGiveBack(store, accId, packId) {
  packGiveBack(store, accId, packId, 'image');
}
