/** voice-quota.mjs — 配音字数账本（2026-11-03）
 *
 * 口径（资料/画面分组-硬切-音色-确认单-20261103.md 第七节）：
 *   付费三档（含试用期）每月 2 万字；免费号每月 2000 字；演示号不限（跟文本额度同口径）。
 *   一条 420 字的片约用 420 字，2 万字 ≈ 47 条。
 *   跨月清零；累计数留着（total），后台能看一共念了多少。
 *
 * 账本：store.voice_quota = { by: { <账号id>: { month, used, total, lastAt } } }
 * 扣法：先扣再念——念不出来（网络/服务报错）由调用方 giveBack，字数退回去。
 */
import { effectiveAiTier } from './ai-quota.mjs';

export const VOICE_CHARS = { '免费': 2000, '基础': 20000, '升级': 20000, '全功能': 20000, '全平台': 20000 };

const monthOf = (ts) => {
  const d = new Date(ts || Date.now());
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
};

export function ensureVoiceStore(store) {
  if (!store.voice_quota || typeof store.voice_quota !== 'object') store.voice_quota = { by: {} };
  if (!store.voice_quota.by || typeof store.voice_quota.by !== 'object') store.voice_quota.by = {};
  return store;
}

export function voiceRec(store, accId, now) {
  ensureVoiceStore(store);
  const ts = now || Date.now();
  const month = monthOf(ts);
  let rec = store.voice_quota.by[accId];
  if (!rec) rec = store.voice_quota.by[accId] = { month, used: 0, total: 0, lastAt: 0 };
  if (rec.month !== month) { rec.month = month; rec.used = 0; }
  return rec;
}

export function voiceInfo(store, acc, now) {
  if (!acc) return { month: monthOf(now), used: 0, max: 0, left: 0, total: 0, unlimited: false };
  const ts = now || Date.now();
  const rec = voiceRec(store, acc.id, ts);
  if (acc.kind === 'demo') {
    return { month: rec.month, used: rec.used, max: 0, left: 0, total: rec.total, unlimited: true };
  }
  const max = VOICE_CHARS[effectiveAiTier(acc, ts)] || VOICE_CHARS['免费'];
  return { month: rec.month, used: rec.used, max, left: Math.max(0, max - rec.used), total: rec.total, unlimited: false };
}

export function voiceTake(store, acc, chars, now) {
  const n = Math.max(0, Math.floor(Number(chars) || 0));
  const info = voiceInfo(store, acc, now);
  if (!acc || info.unlimited) {
    if (acc) { const rec = voiceRec(store, acc.id, now); rec.used += n; rec.total += n; rec.lastAt = now || Date.now(); }
    return { ok: true, info: voiceInfo(store, acc, now) };
  }
  if (info.left < n) {
    return {
      ok: false, code: 'quota',
      error: '本月配音额度用完了（' + info.max + ' 字，已用 ' + info.used + ' 字）——可以换回免费声音继续出片，或找客服加量',
      info,
    };
  }
  const rec = voiceRec(store, acc.id, now);
  rec.used += n; rec.total += n; rec.lastAt = now || Date.now();
  return { ok: true, info: voiceInfo(store, acc, now) };
}

export function voiceGiveBack(store, acc, chars, now) {
  if (!acc) return;
  const rec = voiceRec(store, acc.id, now);
  const n = Math.max(0, Math.floor(Number(chars) || 0));
  rec.used = Math.max(0, rec.used - n);
  rec.total = Math.max(0, rec.total - n);
}
