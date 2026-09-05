/**
 * edition.js — 版本定义与功能开关（发行版核心）
 *
 * ⚠️ 本文件内容在正式打包时会被 build.js 自动覆盖写死。
 *    默认这里是「开发版 dev」：所有功能全开、永不过期，方便本地开发调试。
 *
 * 版本类型：
 *   dev          开发版（全开、不过期，仅本地用）
 *   trial        试用版（15天；无批量发送；无产品库；无租户）
 *   ent          企业版（1年；有批量发送；有产品库；禁用租户）
 *   ent-tenant   企业版+租户（1年；有批量发送；有产品库；有租户）
 *
 * 功能开关（features）：
 *   batchSend    批量整页发送（自动评论按钮）
 *   productLib   产品库（产品描述参与 AI 生成）
 *   tenant       多租户模式
 *   knowledge    知识库（录入/导入专业知识，AI 生成时引用）
 *   autoWater    一键灌水（关键词搜笔记 + 调度配置）
 *   prospectList 获客清单（人群筛选 + 定向私信）
 */

const EDITION = {
  // 版本类型
  type: 'dev',
  // 展示名（顶栏/设置页显示）
  label: '开发版',
  // 授权给谁（企业版可写客户名，试用版留空）
  licensee: '',
  // 打包时间戳（毫秒）；dev 版为 0
  builtAt: 0,
  // 到期时间戳（毫秒）；0 表示永不过期
  expireAt: 0,
  // 有效天数（仅用于展示，如 15 / 365）；0 表示不限
  validDays: 0,
  // ---- 账号绑定（发行版·正式打包时由 build.js 写入） ----
  // 绑定到某个指定的「小红书号」：本工具只在检测到当前登录账号就是该号时才允许使用。
  // xhsId 为公开小红书号（个人主页“小红书号：xxx”）；name 为可选的主页昵称（仅用于展示）。
  // 留空（xhsId 为空）表示不绑定账号，任何已登录账号均可用（dev / 全功能自用版默认如此）。
  boundAccount: { xhsId: '', name: '' },
  // 一键灌水最大关键词数（1=单关键词；8=多关键词）；price 定价（0=不标价）
  keywordMax: 8,
  price: 0,
  // noDelay=true（自用版 pro）：所有拟人延时归零（零等待），仍全功能
  noDelay: false,
  // 功能开关
  features: {
    batchSend: true,
    productLib: true,
    tenant: true,
    knowledge: true,
    autoWater: true,
    prospectList: true,
  },
};

/** 是否某功能可用 */
function editionHasFeature(name) {
  return !!(EDITION.features && EDITION.features[name]);
}

/** 是否永不过期 */
function editionNeverExpires() {
  return !EDITION.expireAt || EDITION.expireAt <= 0;
}

/** 是否绑定了指定小红书号（无绑定 = 不限制账号） */
function editionHasBinding() {
  return !!String((EDITION.boundAccount && EDITION.boundAccount.xhsId) || '').trim();
}

/** 当前绑定的小红书号（未绑定返回空串） */
function editionBoundXhsId() {
  return editionHasBinding() ? String(EDITION.boundAccount.xhsId).trim() : '';
}

/** 一键灌水允许的最大关键词数量（1=单关键词；8=多关键词） */
function editionKeywordMax() {
  const v = parseInt(EDITION.keywordMax, 10);
  return (isFinite(v) && v >= 1) ? v : 8;
}

/** 授权文件完整性校验（dev/模板恒为 true；发行版判载荷未被篡改） */
function editionIntegrityOk() {
  if (!EDITION._payload || !EDITION._salt || !EDITION._sig) return true; // 无混淆载荷 = 模板/自用 → 视为通过
  try {
    const b64 = (s) => {
      if (typeof atob !== 'undefined') { const bin = atob(s); try { return decodeURIComponent(escape(bin)); } catch (_) { return bin; } }
      return Buffer.from(s, 'base64').toString('utf8');
    };
    const reversed = b64(EDITION._payload);
    const inner = reversed.split('').reverse().join('');
    const raw = b64(inner);
    if (!raw) return false;
    let h = 0x811c9dc5;
    for (let i = 0; i < (EDITION._salt + '::' + raw).length; i++) { h ^= (EDITION._salt + '::' + raw).charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16) === EDITION._sig;
  } catch (_) { return false; }
}

/**
 * 用给定的"当前时间戳"判断是否已过期。
 * @param {number} nowMs 当前时间（毫秒），应传入网络校准后的时间
 * @returns {boolean}
 */
function editionIsExpired(nowMs) {
  if (editionNeverExpires()) return false;
  const t = Number(nowMs) || 0;
  return t > EDITION.expireAt;
}

/** 剩余天数（按日历日算，过零点即减一；到期当天返回 0）；永不过期返回 Infinity */
function editionRemainingDays(nowMs) {
  if (editionNeverExpires()) return Infinity;
  const t = Number(nowMs) || 0;
  if (t > EDITION.expireAt) return 0;
  const dayStart = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  return Math.round((dayStart(EDITION.expireAt) - dayStart(t)) / 86400000);
}

/** 供 UI 使用的摘要对象 */
function editionSummary(nowMs) {
  return {
    type: EDITION.type,
    label: EDITION.label,
    licensee: EDITION.licensee || '',
    builtAt: EDITION.builtAt || 0,
    expireAt: EDITION.expireAt || 0,
    validDays: EDITION.validDays || 0,
    neverExpires: editionNeverExpires(),
    hasBinding: editionHasBinding(),
    tampered: !editionIntegrityOk(),
    keywordMax: editionKeywordMax(),
    price: parseInt(EDITION.price, 10) || 0,
    noDelay: !!EDITION.noDelay,
    boundAccount: {
      xhsId: editionBoundXhsId(),
      name: (EDITION.boundAccount && EDITION.boundAccount.name) ? String(EDITION.boundAccount.name) : '',
    },
    features: { ...EDITION.features },
    expired: nowMs !== undefined ? editionIsExpired(nowMs) : false,
    remainingDays: nowMs !== undefined ? editionRemainingDays(nowMs) : null,
  };
}

const Edition = {
  EDITION,
  hasFeature: editionHasFeature,
  neverExpires: editionNeverExpires,
  hasBinding: editionHasBinding,
  boundXhsId: editionBoundXhsId,
  keywordMax: editionKeywordMax,
  integrityOk: editionIntegrityOk,
  isExpired: editionIsExpired,
  remainingDays: editionRemainingDays,
  summary: editionSummary,
};

// Service Worker（importScripts）用 self；Node（build/测试）用 module
if (typeof self !== 'undefined') { self.Edition = Edition; }
if (typeof module !== 'undefined') { module.exports = Edition; }
