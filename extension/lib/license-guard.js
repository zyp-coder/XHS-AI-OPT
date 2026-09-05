/**
 * license-guard.js — 授权时间守卫（运行在 background service worker）
 *
 * 核心原则：
 *   ★ 必须拿到网络时间才能运行。取不到网络时间 = 直接锁定，不降级到本地时间。
 *     因为本地 Date.now() 可被用户随意修改，不可信。
 *
 * 职责：
 *   1. 从多个网络源获取可信时间（小红书 → 备用源），任一成功即可。
 *   2. 防回拨锚点：持久化"见过的最大时间戳"。网络时间和本地时间都与之比较，
 *      取 max，确保时间只涨不跌。改系统日期（无论前后）都逃不过。
 *   3. 结合 edition.js 的 expireAt 判断是否过期。
 */

const LICENSE_ANCHOR_KEY = '_license_time_anchor';   // { maxSeen: <ms> }
const NET_TIME_CACHE_MS = 60 * 1000; // 网络时间缓存 1 分钟

// ── 多个网络时间源（按优先级依次尝试）──────────────────────
const TIME_SOURCES = [
  // 主源：小红书官网（扩展已有 host_permissions）
  { url: 'https://www.xiaohongshu.com/', methods: ['HEAD', 'GET'] },
  // 备用源：百度（国内可达，响应头必有 Date）
  { url: 'https://www.baidu.com/', methods: ['HEAD', 'GET'] },
];

// ── 内存状态 ──────────────────────────────────────────────
let _netTimeCache = { netMs: 0, perfNow: 0 };

// ── 网络时间 ──────────────────────────────────────────────
/**
 * 从单个源获取网络时间。
 * @returns {number} 毫秒时间戳，失败返回 0
 */
async function _fetchTimeFromSource(source) {
  for (const method of source.methods) {
    try {
      const resp = await fetch(source.url, {
        method,
        cache: 'no-store',
        redirect: 'follow',
      });
      const dateStr = resp.headers.get('date');
      if (dateStr) {
        const t = Date.parse(dateStr);
        if (!isNaN(t)) return t;
      }
    } catch (_) { /* 继续尝试下一个方法/源 */ }
  }
  return 0;
}

/**
 * 依次尝试多个时间源获取网络时间。
 * @returns {number} 毫秒时间戳，全部失败返回 0
 */
async function _fetchNetworkTime() {
  for (const source of TIME_SOURCES) {
    const t = await _fetchTimeFromSource(source);
    if (t > 0) return t;
  }
  return 0;
}

// ── 防回拨锚点 ────────────────────────────────────────────
/** 读取防回拨锚点（见过的最大时间戳） */
async function _getAnchor() {
  try {
    const d = await chrome.storage.local.get(LICENSE_ANCHOR_KEY);
    const a = d[LICENSE_ANCHOR_KEY];
    return (a && Number(a.maxSeen)) || 0;
  } catch (_) { return 0; }
}

/** 更新锚点为 max(旧锚点, 传入值) */
async function _bumpAnchor(ms) {
  const t = Number(ms) || 0;
  if (t <= 0) return;
  const cur = await _getAnchor();
  if (t > cur) {
    try { await chrome.storage.local.set({ [LICENSE_ANCHOR_KEY]: { maxSeen: t } }); } catch (_) {}
  }
}

// ── 对外接口 ──────────────────────────────────────────────
/**
 * 获取可信的当前时间（毫秒）。
 *
 * 策略：必须拿到网络时间，否则返回 0（表示失败）。
 *   1. 缓存内的网络时间（按 performance.now() 推算，1 分钟有效）
 *   2. 重新获取网络时间，成功则缓存 + 更新锚点
 *   3. 全部失败 → 返回 0，调用方应锁定而非降级到本地时间
 */
async function getTrustedNow() {
  const anchor = await _getAnchor();

  // ── 尝试使用缓存的网络时间 ──
  if (_netTimeCache.netMs > 0) {
    const cacheAge = performance.now() - (_netTimeCache.perfNow || 0);
    if (cacheAge >= 0 && cacheAge < NET_TIME_CACHE_MS) {
      const estimated = _netTimeCache.netMs + cacheAge;
      const trusted = Math.max(estimated, anchor);
      await _bumpAnchor(trusted);
      return trusted;
    }
  }

  // ── 重新获取网络时间 ──
  const netMs = await _fetchNetworkTime();
  if (netMs > 0) {
    _netTimeCache = { netMs, perfNow: performance.now() };
    // ★ 关键：网络时间与锚点取 max，防止系统日期被回拨后网络时间也跟着倒退
    const trusted = Math.max(netMs, anchor);
    await _bumpAnchor(trusted);
    return trusted;
  }

  // ── 全部网络源失败 → 返回 0，不降级 ──
  console.warn('[LicenseGuard] ⚠️ 所有网络时间源均失败，拒绝降级到本地时间');
  return 0;
}

/**
 * 授权状态检查。
 * @returns {Promise<{ok, expired, edition, now, remainingDays, noNetwork}>}
 *   ok=true         可用
 *   expired=true    已过期需锁定
 *   noNetwork=true  无法获取网络时间，按安全策略锁定
 */
async function checkLicenseStatus() {
  // 永不过期的版本（dev / 全功能自用版）无需校时，直接放行，避免断网被误锁
  if (Edition.neverExpires()) {
    return {
      ok: true,
      expired: false,
      noNetwork: false,
      now: Date.now(),
      edition: Edition.summary(Date.now()),
      remainingDays: Infinity,
    };
  }

  const now = await getTrustedNow();

  // 网络时间获取失败 → 直接锁定，不降级
  if (!now) {
    return {
      ok: false,
      expired: false,
      noNetwork: true,
      now: 0,
      edition: Edition.summary(0),
      remainingDays: null,
    };
  }

  const summary = Edition.summary(now);
  return {
    ok: !summary.expired,
    expired: summary.expired,
    noNetwork: false,
    now,
    edition: summary,
    remainingDays: summary.remainingDays,
  };
}

const LicenseGuard = {
  getTrustedNow,
  checkLicenseStatus,
};

if (typeof self !== 'undefined') { self.LicenseGuard = LicenseGuard; }
if (typeof module !== 'undefined') { module.exports = LicenseGuard; }
