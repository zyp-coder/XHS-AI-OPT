/**
 * edition.js — 版本定义与功能开关（这张表现在只是「进门默认」）
 *
 * ⚠️ 本文件内容在正式打包时会被 build.js 自动覆盖写死。
 *    默认这里是「开发版 dev」：所有功能全开、永不过期，方便本地开发调试。
 *
 * 2026-10-16 档位归服务器控制之后：
 *   - 真正决定「这位客户能点哪几格」的是公网那台上的档位表（server/tier.mjs），
 *     客户机挂上线后每 15 秒对账时领回来，落在 chrome.storage.local['ed.grant']；
 *   - 本文件里这张表降级为「进门默认」：只在从没领到过表时（断网 / 还没配配对号）起作用；
 *   - 领到过就以服务器那张为准（含到期判定），别再拿本文件当权限真源引用。
 *
 * 版本类型（与 build.js PRESETS 对应；三档边界 2026-10-09 老板定：一个模块一条线、累进开通）：
 *   dev            开发版（全开、不过期，仅本地用）
 *   comment        基础版（¥239/月；共有 + 发笔记：整页发送 / 账号诊断&配置 / 产品库·知识库 / 多产品切换 / 笔记生成+素材库+笔记档案+字效编辑器）
 *   comment-multi  升级版（¥399/月；① + 获客：一键灌水/笔记列表/关键词维护）
 *   full           全功能版（¥539/月；② + 线索：通知/私信、获客清单）
 *   pro            自用版（全功能、零等待、不过期，自用）
 *   ※ 关键词上限三档一律不限（keywordMax 0＝不限）
 *
 * 功能开关（features）：
 *   batchSend    整页发送评论（同一篇笔记的多条评论一键发完；手动触发；三档共有）
 *   tenant       多租户模式（多产品/多租户切换，三档共有）
 *   knowledge    知识库（录入/导入专业知识，AI 生成时引用；三档共有）
 *   autoWater    获客（任务配置/队列/工作台/笔记池：关键词搜笔记 + 灌水执行器：口径 × 节奏）→ ② 起
 *   prospectList 线索（通知/私信线索汇总 + 获客清单 + 定向私信）→ ③ 起
 *   notePublish  发笔记（AI 选题 → 生成图文 → 发布 + 素材库/笔记档案）→ ① 起
 *   dailyBrowse  日常浏览（按时段/配额自动浏览，可配点赞收藏；随获客 ② 起开，不列入对外功能清单）
 *   videoFilm    字效编辑器（口播稿 → 分幕 → 配音 → 竖版视频；随发笔记一起给）→ ① 起
 */

const EDITION = {
  // 版本类型
  type: 'dev',
  // 展示名（顶栏/设置页显示）
  label: '开发版',
  // 授权给谁（可写客户名；留空表示通用）
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
  // 一键灌水最大关键词数（0＝不限，三档默认都不限）；price 定价（元/月；0=不标价）
  keywordMax: 0,
  price: 0,
  // noDelay=true（自用版 pro）：所有拟人延时归零（零等待），仍全功能
  noDelay: false,
  // 功能开关
  features: {
    batchSend: true,
    tenant: true,
    knowledge: true,
    autoWater: true,
    prospectList: true,
    notePublish: true,
    dailyBrowse: true,
    videoFilm: true,
  },
};

/** 服务器下发的八格里有的格名（缺格按「关」算，宁少不多） */
const EDITION_CELLS = ['batchSend', 'tenant', 'knowledge', 'notePublish', 'autoWater', 'dailyBrowse', 'prospectList', 'videoFilm'];

/** 领回来的那张表（null = 从没领到过，走包里的进门默认） */
let _edGrant = null;

/** 执行器挂线/对账时把服务器回包里的八格塞进来；传 null 表示收回到进门默认 */
function editionSetGrant(g) {
  const feats = (g && g.features && typeof g.features === 'object') ? g.features : null;
  _edGrant = feats ? {
    at: Number(g.at) || Date.now(),
    tier: String(g.tier || ''),
    label: String(g.label || ''),
    draftOnly: !!g.draftOnly,
    onTrial: !!g.onTrial,
    features: feats,
  } : null;
  return _edGrant;
}

function editionGrant() { return _edGrant; }

/** 当前生效的八格：领到过就整张按服务器的（缺格算关），没领到就按包里这张 */
function editionActiveFeatures() {
  if (!_edGrant) return { ...EDITION.features };
  const out = {};
  for (const k of EDITION_CELLS) out[k] = !!_edGrant.features[k];
  return out;
}

/** 是否某功能可用 */
function editionHasFeature(name) {
  return !!editionActiveFeatures()[name];
}

/** 是否永不过期（领到了服务器的表就不再按包里的日期锁——到期与否由服务器判、落回免费档） */
function editionNeverExpires() {
  if (_edGrant) return true;
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

/** 一键灌水允许的最大关键词数量（0＝不限；非法值按不限处理） */
function editionKeywordMax() {
  const v = parseInt(EDITION.keywordMax, 10);
  return (isFinite(v) && v >= 0) ? v : 0;
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
    label: (_edGrant && _edGrant.label) || EDITION.label,
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
    features: editionActiveFeatures(),
    fromServer: !!_edGrant,
    tier: _edGrant ? _edGrant.tier : '',
    draftOnly: !!(_edGrant && _edGrant.draftOnly),
    onTrial: !!(_edGrant && _edGrant.onTrial),
    grantAt: _edGrant ? _edGrant.at : 0,
    expired: nowMs !== undefined ? editionIsExpired(nowMs) : false,
    remainingDays: nowMs !== undefined ? editionRemainingDays(nowMs) : null,
  };
}

/* ── 开机把上次领到的表捞回来（没配对号 / 没这份存储时静默跳过，照旧走进门默认） ── */
function editionLoadGrant() {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get('ed.grant', (res) => {
      const g = res && res['ed.grant'];
      if (g && g.features) editionSetGrant(g);
    });
    if (chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((ch, area) => {
        if (area !== 'local' || !ch || !ch['ed.grant']) return;
        editionSetGrant(ch['ed.grant'].newValue || null);
      });
    }
  } catch (_) {}
}
editionLoadGrant();

const Edition = {
  EDITION,
  hasFeature: editionHasFeature,
  activeFeatures: editionActiveFeatures,
  setGrant: editionSetGrant,
  grant: editionGrant,
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
