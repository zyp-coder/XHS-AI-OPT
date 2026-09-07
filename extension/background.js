/**
 * background.js — Service Worker
 * 职责：消息路由 + AI 调用编排 + 首次安装初始化
 */

importScripts(
  'lib/storage.js',
  'lib/edition.js',
  'lib/license-guard.js',
  'lib/tenant.js',
  'lib/utils.js',
  'lib/ai-client.js',
  'lib/default-prompts.js',
  'lib/knowledge-search.js',
  'lib/prompt-renderer.js',
  'lib/note-architecture.js',
  'lib/auto-water.js'
);

/* ─── 安装包预填：读取装包时写入的 install-config.json，首次运行时把非私密字段并入配置 ─── */
chrome.runtime.onStartup?.addListener(applyInstallConfigOnce);
applyInstallConfigOnce();
async function applyInstallConfigOnce() {
  try {
    if (await chrome.storage.local.get('install_config_applied').then(d => d.install_config_applied)) return;
    const res = await fetch(chrome.runtime.getURL('install-config.json'));   // 仅对已解压/本地安装包有效；有此文件才有预填
    if (!res.ok) return;
    const ic = await res.json();
    const cur = await Storage.getConfig();
    let changed = false;
    const prod = {
      name: (ic && ic.product && ic.product.name) ? String(ic.product.name) : cur.product.name,
      description: ((ic && ic.product && ic.product.description) != null) ? String(ic.product.description) : cur.product.description,
      guideText: ((ic && ic.product && ic.product.guideText) != null) ? String(ic.product.guideText) : cur.product.guideText,
      promoGoal: (ic && ic.product && ic.product.promoGoal) ? String(ic.product.promoGoal) : cur.product.promoGoal,
    };
    if (JSON.stringify(prod) !== JSON.stringify(cur.product)) changed = true;
    if (changed) {
      cur.product = prod;
      await Storage.setConfig(cur);
      await ensureTenantInit();
    }
    await chrome.storage.local.set({ install_config_applied: 1 });
    console.log('[小红书助手] install-config.json 预填' + (changed ? '已应用' : '（无改动）'));
  } catch (e) { /* 无此文件/离线环境：正常忽略 */ }
}

/* ─── 租户初始化（幂等）：确保至少一个租户，把现有数据收进「默认租户」 ─── */
async function ensureTenantInit() {
  try { await TenantManager.init(DEFAULT_PROMPTS); } catch (e) { console.warn('[租户] init 失败:', e); }
}

/* ─── 首次安装初始化 ─── */
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await Storage.initializeDefaults(DEFAULT_PROMPTS);
    // 知识库不预置任何数据，由用户在设置页自行添加/导入自己行业的内容
    console.log('[小红书助手] 首次安装，已初始化默认配置');
  } else if (details.reason === 'update') {
    // 升级时始终用最新的默认提示词覆盖（用户自定义通过 {version_x_style} 占位符实现，不受影响）
    const existing = await Storage.getPrompts();
    const merged = { ...existing };
    let hasUpdate = false;
    for (const [scene, prompt] of Object.entries(DEFAULT_PROMPTS)) {
      const oldScene = merged[scene];
      if (!oldScene || oldScene.system_prompt !== prompt.system_prompt || oldScene.user_prompt_template !== prompt.user_prompt_template) {
        merged[scene] = prompt;
        hasUpdate = true;
        console.log(`[小红书助手] 升级，更新提示词场景: ${scene}`);
      }
    }
    if (hasUpdate) {
      await chrome.storage.local.set({ [Storage.KEYS.PROMPTS]: merged });
    }
    // 迁移旧版话术库数据到知识库（兼容 v3.8 及之前版本）
    try {
      const { script_library } = await chrome.storage.local.get('script_library');
      if (script_library && Array.isArray(script_library) && script_library.length > 0) {
        const migrated = script_library.map(s => ({
          id: Date.now().toString() + Math.random(),
          title: s.title || '',
          content: s.content || '',
          category: '话术模板',
          role: s.role || '',
          tags: Array.isArray(s.tags) ? s.tags : [],
          isActive: s.isActive !== false,
          createdAt: Date.now(),
        }));
        const kb = await Storage.getKnowledgeBase();
        kb.push(...migrated);
        await chrome.storage.local.set({ [Storage.KEYS.KNOWLEDGE_BASE]: kb });
        await chrome.storage.local.remove('script_library');
        console.log('[小红书助手] 已迁移话术库:', migrated.length, '条到知识库');
      }
    } catch (_) { /* 无旧数据可忽略 */ }
  }
  // 无论安装还是升级，都确保租户已初始化（把现有数据收进默认租户）
  await ensureTenantInit();
});

// 每次启动时同步提示词（确保最新默认提示词生效）
(async function syncPromptsOnStartup() {
  // ★ 拟人挡位：不再强制清零延时（旧版自用版 noDelay 会把 delay_config 全清成 0 = 裸跑）。
  //   改为：若从未配置过、或仍是旧的“清零残留”，则写入默认挡位2（标准拟人），由设置页挡位接管。
  try {
    const cur = (await chrome.storage.local.get(['delay_config'])) || {};
    const cfg = cur.delay_config || {};
    const isZeroedLegacy = (cfg._noDelayApplied === true);
    const hasAny = Object.keys(cfg).some(k => k !== '_noDelayApplied');
    if (!hasAny || isZeroedLegacy) {
      const PRESET2 = {
        browseDwell:{min:1200,max:2000}, typingCharDelay:{min:15,max:30}, likeGap:{min:300,max:600},
        lazyLoadWait:{min:700,max:1100}, retryBackWait:{min:500,max:900}, retryOpenWait:{min:1100,max:2200},
        noteOpenBuffer:{min:500,max:900}, preSendGap:{min:400,max:700}, batchItemGap:{min:4000,max:8000},
        _noDelayApplied: false,
      };
      await chrome.storage.local.set({ delay_config: PRESET2 });
      console.log('[拟人挡位] 检测到裸跑/未配置 → 已写入默认挡位2（标准拟人）');
    }
  } catch (_) {}
  await ensureTenantInit(); // 老用户（无 onInstalled 触发）也在 SW 唤醒时得到默认租户
  try {
    // ★ 触发一次配置读取：自动把推理模型迁移为非推理模型（deepseek-chat），迁移后立即持久化
    await Storage.getConfig();
  } catch (_) {}
  try {
    const existing = await Storage.getPrompts();
    let needUpdate = false;
    for (const [scene, prompt] of Object.entries(DEFAULT_PROMPTS)) {
      const old = existing[scene];
      if (!old || old.system_prompt !== prompt.system_prompt || old.user_prompt_template !== prompt.user_prompt_template) {
        existing[scene] = prompt;
        needUpdate = true;
      }
    }
    if (needUpdate) {
      await chrome.storage.local.set({ [Storage.KEYS.PROMPTS]: existing });
      console.log('[小红书助手] 启动时同步提示词完成');
    }
  } catch (_) {}
})();

/* ─── 消息路由 ─── */
// autoWater 版本闸门：当前版本无一键灌水功能时直接抦截，不执行真正逻辑
async function requireAutoWater(fn) {
  if (typeof Edition !== 'undefined' && !Edition.hasFeature('autoWater')) {
    throw new Error('当前版本未开通「一键灌水」功能');
  }
  return await fn();
}
// prospectList 版本闸门：当前版本无获客清单功能时直接拦截，不执行真正逻辑
async function requireProspectList(fn) {
  if (typeof Edition !== 'undefined' && !Edition.hasFeature('prospectList')) {
    throw new Error('当前版本未开通「获客清单」功能');
  }
  return await fn();
}

/* ═══════════════ 账号绑定（绑定版：只能在指定“小红书号”的本主人主页验证） ═══════════════
 * 小红书上拿不到登录账号的小红书号，只有本人在「我的」主页才读得到。
 * 所以取消每次操作的闸门：改由内容脚本在本人的“我的”主页读取并比对，
 * 把结果 { xhsId, matched, at } 写入 chrome.storage（键 _acct_guard），
 * background <-> content 用同一个键：这里只读缓存判断，绝不自动开/关标签页打扰用户。
 * 校验入口分两层：
 *   - 用户在本人主页 → content 自动/手动调用 verifyOwnProfile 写入结果；
 *   - UI（设置页/弹窗）根据这里的 verified 判定是否锁定。
 */
const ACCOUNT_GUARD_KEY = '_acct_guard';
const ACCOUNT_GUARD_TTL = 6 * 60 * 60 * 1000;   // 校验有效 6 小时（每次本人主页都会刷新）

function _normXhsId(s) { return String(s || '').replace(/\s+/g, '').trim(); }

// 从 /chat/{convId} 或任意聊天 URL 里提取会话 id（消息台按它直接跳转会话）
function _convIdFromUrl(u) {
  const m = String(u || '').match(/\/chat\/([a-zA-Z0-9]{8,})/);
  return m ? m[1] : '';
}

async function _readAccountGuard() {
  try { const d = await chrome.storage.local.get(ACCOUNT_GUARD_KEY); return d[ACCOUNT_GUARD_KEY] || null; } catch (_) { return null; }
}

function _boundInfo() {
  // Edition 可能未加载（异常时）；视为不绑定
  if (typeof Edition === 'undefined') return { bound: false, xhsId: '', name: '', tampered: false };
  // 授权文件完整性校验：被篡改（改绑定号/有效期等）→ 视为已绑定并强制锁定
  let okInt = true;
  try { okInt = Edition.integrityOk ? Edition.integrityOk() : true; } catch (_) { okInt = false; }
  if (!okInt) return { bound: true, tampered: true, xhsId: '', name: '' };
  const has = typeof Edition.hasBinding === 'function' ? Edition.hasBinding() : false;
  return { bound: !!has, xhsId: Edition.boundXhsId ? Edition.boundXhsId() : '', name: (Edition.EDITION && Edition.EDITION.boundAccount && Edition.EDITION.boundAccount.name) || '', tampered: false };
}

/**
 * 读取“是否已通过验证”的状态（只读缓存，不做任何导航）。
 * verified=true 表示用户在本人主页读取的小红书号与绑定号一致且未过期。
 */
async function accountBindStatus() {
  const bi = _boundInfo();
  if (bi.tampered) return { bound: true, tampered: true, xhsId: '', name: '', verified: false, cacheOk: false };
  if (!bi.bound) return { bound: false, xhsId: '', name: '', verified: true, cacheOk: true };
  const cached = await _readAccountGuard();
  const verified = !!(cached && cached.matched && cached.xhsId && _normXhsId(cached.xhsId) === _normXhsId(bi.xhsId) && (Date.now() - (cached.at || 0) < ACCOUNT_GUARD_TTL));
  const reason = verified ? '' : '本工具已绑定小红书号「' + bi.xhsId + '」，请在本人主页验证后使用。';
  return { bound: true, xhsId: bi.xhsId, name: bi.name || (cached && cached.name) || '', verified, cacheOk: verified, reason };
}

/**
 * 主动探测：向当前打开的小红书 Tab 发送 verifyOwnProfile，让 content 在（本）人主页实时读取小红书号。
 * 任一 Tab 返回 matched 即视为通过，并把结果写回缓存（供 accountBindStatus 读取）。
 * 不主动开关标签页，避免打扰用户。返回 { verified, onOwnProfile, xhsId, checkedXhsId, matched, name, reason }。
 */
async function _probeVerifyInTabs() {
  const sleep = (ms) => new Promise(res => setTimeout(res, ms));
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: ['*://www.xiaohongshu.com/*', '*://xiaohongshu.com/*'] }); } catch (_) { return { status: 'noTab', titles: [] }; }
  if (!tabs.length) return { status: 'noTab', titles: [] };
  const titles = tabs.slice(0, 6).map(t => t.title || t.url || '').filter(Boolean);

  // ★ 关键修复：content 脚本可能刚注入/在 document_idle 还没就绪，导致第一次发消息无人接收。
  //   这里自动重试几轮（每轮稍等），等页面就绪，避免“点多几次才成功”。
  const ATTEMPTS = 4;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    let responded = false;
    for (const t of tabs) {
      if (typeof t.id !== 'number') continue;
      let r = null;
      try { r = await chrome.tabs.sendMessage(t.id, { action: 'verifyOwnProfile' }); } catch (_) { r = null; }
      if (!r) continue;
      responded = true;
      if (r.matched) {
        // 已写入缓存（content 内 _verifyOwnProfile 成功时自动写 _acct_guard）
        return { status: 'ok', titles, verified: true, matched: true, checkedXhsId: r.checkedXhsId, name: r.name || '', reason: r.reason || '' };
      }
      // 脚本能回、但确实没匹配 = 结果已确定，无需干等重试
      return { status: 'notOwn', titles, verified: false, matched: false, checkedXhsId: r.checkedXhsId, name: r.name || '', reason: r.reason || '' };
    }
    if (!responded && attempt < ATTEMPTS - 1) await sleep(350); // 页面还没就绪，稍等再试
  }
  // 几轮都没响应 → 还是旧页面/未注入
  return { status: 'stale', titles, verified: false, matched: false };
}

/**
 * 供 UI（设置页/弹窗“验证”按钮）触发的校验。不做自动导航/开关标签页。
 * 先返回已验证缓存；若未验证，则主动探测当前打开的小红书 Tab（实时读取本人主页），
 * 任一 Tab 校验通过 → 直接放行并返回通过；否则提示打开本人主页并给出具体原因。
 */
async function guaranteeBoundAccount(forceNow) {
  const st = await accountBindStatus();
  if (st.tampered) return { ok: false, bound: true, verified: false, xhsId: '', name: '', code: 'tampered', reason: '授权文件校验失败，本工具已锁定（可能被篡改）。请联系服务商重新获取安装包。' };
  if (!st.bound) return { ok: true, bound: false, verified: true, xhsId: '', name: '' };
  if (!forceNow && st.verified) return { ok: true, bound: true, verified: true, xhsId: st.xhsId, name: st.name };

  // 未验证 → 主动探测当前打开的小红书页面
  const res = await _probeVerifyInTabs();
  const tabTxt = (res && res.titles && res.titles.length)
    ? '（当前打开的小红书页面：' + res.titles.join('｜') + '）'
    : '';
  if (res.status === 'ok') {
    // content 里写缓存时键相同，这里直接读最新以拿到一致状态
    const fresh = await accountBindStatus();
    return { ok: true, bound: true, verified: true, xhsId: fresh.xhsId, name: fresh.name };
  }
  if (res.status === 'noTab') {
    return { ok: false, bound: true, verified: false, xhsId: st.xhsId, name: st.name, code: 'needOwnProfile', reason: '没找到任何打开的小红书页面' + tabTxt + '。请先打开一个小红书网页标签，登录该号并进入自己的「我的」主页（保持网页打开），再回来点「验证」。' };
  }
  if (res.status === 'stale') {
    return { ok: false, bound: true, verified: false, xhsId: st.xhsId, name: st.name, code: 'needOwnProfile', reason: '检测到你打开了小红书页面' + tabTxt + '，但它还是旧页面，无法识别。请在那个小红书网页里按一次 F5 刷新，再回来点「验证」。' };
  }
  // notOwn：有页面、脚本也能回，但不是本人的「我的」主页
  return { ok: false, bound: true, verified: false, xhsId: st.xhsId, name: res.name || st.name, code: 'needOwnProfile', reason: (res.reason || '当前打开的不是本人「我的」主页') + tabTxt + '。请把浏览器切到你自己的小红书「我的」主页（不是首页、不是别人的主页），并保持这个页面打开再重新验证。' };
}

/** 写操作前置校验（绑定版）：不过返回锁定错误（仅在确有已验证缓存时才放行，不做导航） */
async function ensureBoundForWrite() {
  const r = await guaranteeBoundAccount();
  if (!r.ok) {
    const e = new Error(r.reason || '当前登录账号未在本主人主页通过验证，工具已锁定。请打开你的「我的」主页完成验证。');
    e.accountLocked = true;
    e.code = r.code || 'accountLocked';
    throw e;
  }
  return r;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action } = message;

  const handlers = {
    findProspects: handleFindProspects,
    checkConfig: handleCheckConfig,
    testAiConnection: handleTestAiConnection,
    getConfig: handleGetConfig,
    updateConfig: handleUpdateConfig,
    // ── 评论跟进（通知页“回复了你的评论”对话回复）──
    chatFollowSync: handleChatFollowSync,
    chatFollowReply: handleChatFollowReply,
    chatFollowMarkSent: handleChatFollowMarkSent,
    chatFollowGetReplyHistory: handleChatFollowGetReplyHistory,
    // ── 账号人设（AI 建人设：读简介 + 5 题回答 → 整合保存）──
    getPersona: async () => { const st = await Storage.getConfig(); return { persona: (st && st.persona) || null }; },
    setPersona: (data) => handleSetPersona(data || {}),
    clearPersona: () => handleClearPersona(),
    aiPersonaBuild: (data) => handleAiPersonaBuild(data || {}),
    aiKbBuild: (data) => handleAiKbBuild(data || {}),
    aiKbSave: (data) => handleAiKbSave(data || {}),
    aiKbImport: (data) => handleAiKbImport(data || {}),
    // 笔记搜索 + 状态检查（自动灌水已移除）——受 autoWater 版本开关闸门控制
    getAutoWaterStatus: () => requireAutoWater(() => AutoWater.getStatus()),
    searchNotes: () => requireAutoWater(() => AutoWater.searchNotes()),
    cancelSearch: () => requireAutoWater(() => AutoWater.cancelSearch()),
    advanceResults: () => requireAutoWater(() => AutoWater.advanceResults()),
    openNote: (data) => requireAutoWater(() => AutoWater.openNote(data.note)),
    // ── 版本/授权 ──
    getEdition: async () => { return await LicenseGuard.checkLicenseStatus(); },
    // ── 账号绑定 ──
    accountGuarantee: async (data) => { return await guaranteeBoundAccount(!!(data && data.forceNow)); },
    accountStatus: async () => { return await accountBindStatus(); },
    // ── 账号诊断 ──
    extractOwnProfile: async () => { await ensureTenantInit(); return await handleExtractOwnProfile(); },
    accountDiagnose: (data) => handleAccountDiagnose(data || {}),
    diagnoseRefine: (data) => handleDiagnoseRefine(data || {}),
    notePlan: (data) => handleNotePlan(data || {}),
    aiNotePlan: (data) => handleAiNotePlan(data || {}),
    aiDeepReport: (data) => handleAiDeepReport(data || {}),
    aiSellPointBuild: (data) => handleAiSellPointBuild(data || {}),
    aiBgPrompt: (data) => handleAiBgPrompt(data || {}),
    aiCanvasLayout: (data) => handleAiCanvasLayout(data || {}),
    // ── 多租户（多产品）——
    listTenants: async () => { await ensureTenantInit(); return await TenantManager.status(); },
    switchTenant: async (data) => { await ensureTenantInit(); const tenant = await TenantManager.switchTo(data.id); return { tenant }; },
    createTenant: async (data) => { await ensureTenantInit(); const tenant = await TenantManager.create(data.name, DEFAULT_PROMPTS); return { tenant }; },
    renameTenant: async (data) => { await ensureTenantInit(); const tenant = await TenantManager.rename(data.id, data.name); return { tenant }; },
    deleteTenant: async (data) => { await ensureTenantInit(); return await TenantManager.remove(data.id); },
    // ── 获客清单 ──
    addProspect: (data) => requireProspectList(() => handleAddProspect(data)),
    getProspectList: (data) => requireProspectList(() => handleGetProspectList(data)),
    updateProspect: (data) => requireProspectList(() => handleUpdateProspect(data)),
    deleteProspect: (data) => requireProspectList(() => handleDeleteProspect(data)),
    getChatConversations: (data) => requireProspectList(() => handleGetChatConversations(data)),
    openChat: (data) => requireProspectList(() => handleOpenChat(data)),
    chatSend: (data) => requireProspectList(() => handleChatSend(data)),
    // ── AI客服：场景+问答话术体系 ──
    getAiCsConfig: () => handleGetAiCsConfig(),
    saveAiCsConfig: (data) => handleSaveAiCsConfig(data || {}),
    importAiCsConfig: (data) => handleImportAiCsConfig(data || {}),
    aiCsRespond: (data) => handleAiCsRespond(data || {}),
    aiCsTouch: (data) => handleAiCsTouch(data || {}),
    getPendingNotifs: (data) => requireProspectList(() => handleGetPendingNotifs(data)),
    sendNotifReply: (data) => requireProspectList(() => handleSendNotifReply(data)),
    qaToKb: (data) => handleQaToKb(data || {}),
    profileProspects: (data) => requireProspectList(() => handleProfileProspects(data)),
    classifyCustomers: (data) => requireProspectList(() => handleClassifyCustomers(data)),
    collectLikers: (data) => requireProspectList(() => handleCollectLikers(data)),
    collectLikersFromNotif: (data) => requireProspectList(() => handleCollectLikersFromNotif(data)),
    aiScreenCapture: (data) => requireProspectList(() => handleAiScreenCapture(data)),
    generateDm: (data) => requireProspectList(() => handleGenerateDm(data)),
    judgeSaleTiming: (data) => requireProspectList(() => handleJudgeSaleTiming(data)),
    markContacted: (data) => requireProspectList(() => handleMarkContacted(data)),
    judgeLeadPromotion: (data) => requireProspectList(() => handleJudgeLeadPromotion(data)),
    sendDm: (data) => requireProspectList(() => handleSendDm(data)),
    enrichProspectByProfile: (data) => requireProspectList(() => handleEnrichByProfile(data)),
    openDmChat: (data) => requireProspectList(() => handleOpenDmChat(data)),
    locateDmButton: (data) => requireProspectList(() => handleLocateDmButton(data)),
    // ── 窗口形态：小窗(浮动) → 大窗(总览) 切换 ──
    openBigWindow: (data) => openBigWindow(data.senderTab),
    // ── ✍️ 发笔记（受 knowledge 版本闸门控制）──
    aiRewriteNote: (data) => requireKnowledge(() => aiRewriteNoteBg(data)),
    aiGenerateSellPoints: (data) => requireKnowledge(() => aiGenerateSellPointsBg(data)),
    aiGenerateConcept: (data) => requireKnowledge(() => aiGenerateConceptBg(data)),
    aiGenerateSelfComment: (data) => requireKnowledge(() => aiGenerateSelfCommentBg(data)),
    generateNoteImage: (data) => requireKnowledge(() => generateNoteImageBg(data)),
    genCoverTemplate: (data) => requireKnowledge(() => genCoverTemplateBg(data)),
  };

  const handler = handlers[action];
  if (!handler) {
    sendResponse({ error: `未知 action: ${action}` });
    return false;
  }

  // 异步处理
  handler(message.data || message)
    .then(result => sendResponse({ ok: true, ...result }))
    .catch(err => {
      console.error(`[小红书助手] ${action} 失败:`, err);
      // 携带 err.aiRaw（AI 完整原始回复）：解析失败时透传给 popup 展示，方便排查/手动使用
      sendResponse({ ok: false, error: err.message || String(err), ...(err.aiRaw ? { aiRaw: err.aiRaw } : {}) });
    });

  return true; // 保持消息通道开放（异步）
});

/* ─── 推广目标口径（基本配置→推广目标）─── */
// 目标不同，“什么算机会”的判定口径完全不同：
//   tool  精准获客：口径放宽，沾边/可能感兴趣的评论都算机会，宁多勿漏；C = 产品介绍四段式（教操作）
//   brand 品牌推广：一切可种草互动的评论都算；C = 品牌口碑型（不引流、不教操作）
//   profile 主页引流：能给干货就算机会；C = 人设介绍型
// 注：返回文本里不得含 {xxx} 占位符——渲染只扫一遍，注入后的占位符不会再被替换
function buildGoalRules(config) {
  const p = config.product || {};
  const goal = p.promoGoal || 'tool'; // 空值按精准获客，保持老用户行为不变
  const pname = p.name || '本产品';

  if (goal === 'brand') {
    return {
      goalName: '品牌推广（种草曝光，不引流）',
      rules: `【推广目标：品牌推广（种草曝光，不引流）】
本次目标不是找“想买的人”，而是找一切适合品牌互动/种草的评论：
- 与品牌/产品领域相关的讨论、体验分享、提问、吐槽、纠结、夸赞、情绪表达，都算有价值的互动机会
- 判定标准：回复它能不能自然带出品牌价值/口碑、增加品牌好感。能，就算机会；不必等对方表现出购买需求或痛点
- 拿不准的一律算机会；只排除与品牌领域完全无关的闲聊
- 前置分析（opportunity 字段）要写：这条评论与品牌领域的关联点、用户情绪、可切入的品牌价值点（不要写“为什么能用产品解决”）`,
      versionC: `品牌口碑型：讲一次与品牌的具体接触经历（用过/买过/被服务过），用真实细节加上知识库里的具体数字/卖点，把品牌的差异点讲清楚，像口碑安利不像广告；
全程不引流：不得出现去哪买、去搜、去主页、去小程序等任何引导，也不要教产品操作路径，把品牌信任感立住就收`,
    };
  }

  if (goal === 'profile') {
    return {
      goalName: '个人主页引流（涨粉）',
      rules: `【推广目标：个人主页引流（涨粉）】
本次目标是靠“真正有用”把人吸到自己主页，不是直接卖货：
- 只要你能给出真正有用的建议、经验或数据（对方问了、纠结了、踩坑了、想了解某件事），就算有价值的机会
- 判定标准：回复它能不能体现你的专业度、让对方想点头像看你主页。能，就算机会；不必要求“这个需求正好能用产品解决”
- 拿不准的一律算机会；只排除纯客套、与你专业领域完全无关、根本给不出干货的闲聊
- 前置分析（opportunity 字段）要写：对方在纠结/想了解什么、你可以给出的干货点、用户情绪`,
      versionC: `人设介绍型：用“过来人”身份讲自己踩过的坑和搞明白的经验（必须引用知识库里的具体数字/结论），把专业可信的人设立住；
结尾自然带出“我平时就在主页持续分享这类内容”，欢迎对方来主页交流；重点是干货与人设，不是推销产品，不要写成产品操作步骤清单`,
    };
  }

  return {
    goalName: '精准获客（引导对方去用产品）',
    rules: `【推广目标：精准获客】
本次目标是找可能对「${pname}」感兴趣/有需求的评论，口径放宽、宁多勿漏：
- 判定方法：这条评论能不能自然接上产品的价值点？能，就算机会；需求强度不限——问过、纠结过、踩过坑、好奇想了解都算
- 拿不准的一律算机会，宁可多选也不要漏掉，最后由【回复方法】按价值排序
- 只有完全无关的纯闲聊（纯表情、纯客套、与产品领域毫无关联的话题）才排除
- 前置分析（opportunity 字段）要写：这条评论为什么能用本产品解决（相关度）、用户情绪、核心关键词`,
    versionC: `产品介绍型四段式（“钩子→人设→讲公式→教操作”，充分利用知识库的结构化字段：公式 / 输入 / 输出 / 数据从哪查 / 位置·跳转）：
第一段·钩子：用一句戳中痛点的大白话接住用户话题，让他觉得“这说的就是我”，1-2句即可，别用通用套话
第二段·人设：用“过来人”身份建立信任，优先化用知识库“数据从哪查”里的信息（比如“我当时特意打电话问过官方客服”），让人觉得你是真经历过、真查证过的人，而不是打广告的
第三段·讲公式：把知识库里跟用户问题最相关的那条“公式/结论/方法”用大白话讲透，必须直接引用具体数字或对比，而不是空喊“好用”“能省钱”
第四段·教操作：严格照着知识库“位置/跳转”字段的路径，一步步告诉用户在产品里怎么操作（比如“打开${pname}→进对应功能页→把你的数据填进去，结果当场就出来了”），路径必须和知识库写的一致`,
  };
}

/* ─── 评论目的 → 打法体系（取代旧 A/B/C 三版硬编码） ───
 * 目的(scriptPurpose)= 这一批评论的整体倾向（6 选 1，含「综合自动」）；
 * 每一条商机再由 AI 根据评论本身，从【打法库】里自适应挑最适合的打法（默认 1 条，确有第二种好角度才 2 条）。
 * 推广目标(promoGoal)仍只负责判定口径 + 引流承接边界（见 buildGoalRules）。
 */
const TACTICS = [
  { id: 'tutorial', name: '实用教程流', strength: '强', len: '70~200字', inst: '对着对方的具体问题直接开讲“别急，就按我说的做”，用产品简述里的功能/操作路径，用口语分步教操作（用“先…再…”衔接，不许写序号/步骤词），过程中点明“这一步正好能解决你担心的 X”，结尾自然点出产品名。' },
  { id: 'bikeng', name: '避雷防坑流', strength: '中', len: '60~180字', inst: '以“过来人”身份讲这个事里最容易踩的坑（结合知识库里的具体案例/数据），先帮对方避坑省心、建立信任，再在这个点上自然提一句自己的产品正好能绕开这个坑。' },
  { id: 'contrast', name: '对比测评流', strength: '中', len: '60~180字', inst: '把两个方案/两种做法/两款选择放一起客观对比，列出各自取舍（结合知识库数据，别拉踩），显得专业公道，结尾轻轻带一句自己的产品在权衡里处在哪个位置，不硬推。' },
  { id: 'data', name: '数据科普流', strength: '中', len: '70~220字', inst: '用硬数据、政策对比、省钱/踩坑案例把话题讲透（优先引用知识库里的具体数字），客观中立、以数据服人，立“懂行”人设；结尾不硬推，观点讲透自然收，只有很自然时才提产品名。' },
  { id: 'debate', name: '钩子反驳流', strength: '中', len: '50~160字', inst: '从评论区捞出某条“容易误导人/站不太住”的观点，用大白话点破（如“这个说法挺容易让人误会的”），先简明反驳一句，再用自己的亲身经历佐证，最后自然把产品带出来，像熟人较真不是抬杠。' },
  { id: 'addon', name: '评价补充流', strength: '中', len: '50~160字', inst: '先就评论区某条观点给一句评价（认同或存疑都行），再补上一个对方没说到的数据/细节让观点更完整（优先用知识库具体数字），接着点出自己产品在这个点上与大家不同的地方做佐证，像给话题添砖加瓦。' },
  { id: 'reverse', name: '反向共情流', strength: '中', len: '50~160字', inst: '先接住对方此刻的怀疑/纠结（如“我之前也这么想，怕被坑”），说明自己理解这种顾虑，再讲后来是怎么一步步弄明白/绕开的，自然转到产品和靠谱做法，语气像自己人也踩过坑。' },
  { id: 'empathy', name: '共情共鸣流', strength: '弱', len: '40~140字', inst: '先用自己或身边人的经历接住对方的情绪（“给你说个我同事的例子”“我当时也纠结了半天”），把那种感受/纠结讲透让对方觉得你懂，再顺带说一句自己当时是怎么做的；可带产品就轻带一句，可用可不用的就放掉。' },
  { id: 'hot', name: '借势热点流', strength: '中', len: '40~140字', inst: '顺着笔记/评论区正在火的话题或某个反转点往外延伸，站在普通人视角说自己的观察或立场，借话题热度拉曝光；可以带一句自己的产品或经验，但重点是“聊到点子上”，不硬广也不跑题。' },
  { id: 'zandian', name: '情绪带赞流', strength: '无', len: '10~40字', inst: '输出一句话或两三句短金句，刺中大家的共同情绪（共鸣/好笑/解气），允许抽象玩梗、自嘲，主打“被说到心坎里”；完全不提产品、不导流，纯为点赞互动，要求短、准、有记忆点，不要正经长文。' },
  { id: 'wenfa', name: '提问互动流', strength: '无', len: '15~60字', inst: '主动抛出一个有讨论度、对方或评论区能接得上的问题（“你们呢？是不是也这样？”“我好奇大家都是怎么处理的？”），轻巧撬动回复，不涉及产品，用来养号/涨互动。' },
  { id: 'qiuzhu', name: '求教自嘲流', strength: '无', len: '30~120字', inst: '以“我好像也踩进去了/蹲一个懂的人”的自嘲姿态发问，戳中共同困惑引共鸣，让大家愿意在评论区展开（有风险，别在自己产品相关话题上装作没经验被识破，仅用于纯闲聊/搭话场景）。' },
];
const TACTIC_MAP = Object.fromEntries(TACTICS.map((t, i) => [t.id, { ...t, idx: i }]));

// 每个目的：Name + 更优先的打法（倾向顺序）+ 一句倾斜说明；auto=综合自动（不倾斜，AI 看菜下饭）
const PURPOSE_META = {
  sell: {
    name: '卖产品（获客转化）',
    bias: ['tutorial', 'bikeng', 'contrast', 'data', 'reverse', 'debate', 'addon'],
    note: '整体更偏“能自然带产品就带”，优先把对方的疑问/纠结用教程、避坑、对比的方式接住，再落到自己的产品上；但遇到纯玩梗/纯闲聊的评论，仍可用共情或带赞流，不必每条都卖。',
  },
  brand: {
    name: '品牌种草（信任/口碑）',
    bias: ['contrast', 'addon', 'data', 'reverse', 'debate', 'empathy'],
    note: '目标是让人记住并信任你的品牌、建立好感，不是急着成交；多用对比、补充、数据、反向共情这些“摆事实讲道理”的打法，少生硬推销。',
  },
  profile: {
    name: '主页涨粉（引流到主页）',
    bias: ['tutorial', 'bikeng', 'data', 'empathy', 'addon', 'wenfa'],
    note: '目标是把关注/信任沉淀到你主页：先把对这条评论真正有用的干货给足，让人觉得“这人有东西”，再自然提一句主页或点头像；少纯营销。',
  },
  likes: {
    name: '互动涨赞（养号/做数据）',
    bias: ['zandian', 'wenfa', 'qiuzhu', 'empathy', 'hot'],
    note: '目标是这条自身能涨赞、撬动互动，基本不谈产品；多用金句带赞、提问互动、求教自嘲、共情这类轻量打法。',
  },
  trend: {
    name: '蹭热点（借话题/大V）',
    bias: ['hot', 'debate', 'addon', 'data', 'zandian'],
    note: '目标是借笔记/评论区正在火的话题与流量拉曝光；先选有话题、有争议、容易被刷到的评论，用借势、反驳、补充等角度切入，能带产品就轻带，别生硬。',
  },
  auto: {
    name: '综合自动（每条看菜下饭）',
    bias: [],
    note: '不做整体偏向，你完全按每条评论本身适合什么就来什么——该卖就卖、该共情就共情、该带赞就带赞，让整批最像一个真人随手刷评论区、见什么接什么。',
  },
};

function buildPurposeRules(scriptStyle) {
  const key = scriptStyle?.scriptPurpose || 'sell';
  const meta = PURPOSE_META[key] || PURPOSE_META.auto;
  let biasTxt = '';
  if (meta.bias.length) {
    const names = meta.bias.map(id => TACTIC_MAP[id].name).join('、');
    biasTxt = '整体上，以下打法可以更优先、更占比例：' + names + '。';
  }
  const guidance = meta.note + (biasTxt ? '\n' + biasTxt : '');
  return { name: meta.name, guidance };
}

// 生成打法库目录文本（注入提示词，供 AI 每条自适应选用）；每条自带"字数范围"，让话术长度随打法走
function buildTacticCatalog() {
  return TACTICS.map(t => `· ${t.name}（${t.strength === '无' ? '不谈产品' : strengthWord(t.strength)}·${t.len || '15~40字'}）：${t.inst}`).join('\n');
  function strengthWord(s) { return s === '强' ? '重点带产品' : s === '中' ? '可带可不带' : '不谈产品'; }
}

/* ═══════════════ 账号人设：AI 建人设（读简介 + 5 题回答 → 整合保存，注入评论/文案生成） ═══════════════ */
const PERSONA_QUESTIONS = [
  '你是谁？介绍一下你的身份、职业，或现在正在做的事。',
  '在这个领域/产品上你有过哪些真实的经历？做了多久、帮过多少人、或亲自踩过哪些坑。',
  '你最拿手、最想让别人知道的干货或专业积累是什么？',
  '你的小红书账号定位是什么？主要分享什么、写给谁看？',
  '你希望评论区互动时的“人设感”是哪种（专业靠谱 / 接地气过来人 / 随性朋友…）？有没有特别的口吻或语气？',
];

async function handleSetPersona(data) {
  const cfg = await Storage.getConfig();
  if (data && data.persona) cfg.persona = data.persona;
  await Storage.setConfig(cfg);
  return { ok: true, persona: cfg.persona || null };
}
async function handleClearPersona() {
  const cfg = await Storage.getConfig();
  cfg.persona = null;   // 重置人设
  await Storage.setConfig(cfg);
  return { ok: true };
}

async function handleAiPersonaBuild(data) {
  const cfg = await Storage.getConfig();
  if (!cfg.ai.apiKey && !cfg.ai.fallbackApiKey) throw new Error('未配置 API Key，请先在设置页填写');
  const answers = (data && Array.isArray(data.answers)) ? data.answers : [];
  const bio = (data && data.bio) ? String(data.bio).trim() : '';
  const qaText = PERSONA_QUESTIONS.map((q, i) => {
    const a = (answers[i] && String(answers[i].answer ?? answers[i])) || '（未回答）';
    return `Q${i + 1}. ${q}\nA${i + 1}. ${a.trim()}`;
  }).join('\n\n');

  const system = `你是小红书账号人设梳理师。根据用户的账号简介和对几个问题的回答，整理出一份详实、可直接使用的"账号人设"。
要求：
1. 第一人称"我"书写，既像自我介绍，又像一份能直接指导 AI 写评论/文案的"人设说明书"。
2. 尽量详尽：把身份、经历（做了多久/帮过多少人/踩过的坑）、擅长干货、账号定位、目标人群、人设调性、习惯口吻语气都整合进去，能具体就具体，别空话套话。
3. 分 2~3 段、信息密度高、语言自然。
4. 只输出人设正文，不加任何前缀/标题/解释。`;
  const user = `【我的账号简介】
${bio || '（未提供）'}

【我回答的几个问题】
${qaText}

请据此整理成我的账号人设。

整理完人设正文后，再单独给一句"封面人设短语"(coverHook)：≤20字，用于小红书封面「上板块」署名后的小标签，表现我是谁/什么身份调性（如"大厂码农""帮300+家庭买房的中介"）。紧跟在人设正文之后空一行，以一行"coverHook:"开头输出。`;
  const r = await AiClient.chatCompletion({ ...cfg.ai, maxTokens: 2048 }, system, user);
  let text = String(r.content || '').trim();
  if (!text) throw new Error('AI 未返回人设内容，请重试');
  // 解析 coverHook（紧跟人设正文的一行，格式 coverHook：xxx）
  let coverHook = '';
  const m = text.match(/coverHook\s*[:：]\s*([^\n]+)/i);
  if (m && m[1]) {
    coverHook = m[1].trim().slice(0, 20);
    text = text.replace(new RegExp('\\s*coverHook\\s*[:：]\\s*[^\\n]*', 'i'), '').trim();
  }
  const qa = {};
  PERSONA_QUESTIONS.forEach((q, i) => { qa['q' + (i + 1)] = String(answers[i] && (answers[i].answer ?? answers[i]) || '').trim(); });
  return { ok: true, persona: { text, bio, qa, updatedAt: Date.now(), ...(coverHook ? { coverHook } : {}) } };
}

/* ═══════════════ 知识库：AI 生成（答几个问题 → 整理成知识库条目） ═══════════════ */
const KB_QUESTIONS = [
  '你的产品/服务是什么？主要帮人解决什么问题、满足什么需求？',
  '你的目标客户是谁？他们购买前最常问、最担心、最容易踩坑的点是什么？',
  '你有哪些亲身经验或案例（做过的事、帮过谁、踩过的坑），能用来建立信任和给建议？',
  '有没有具体的数字、价格、政策或行业数据，客户需要知道的？',
  '你最想让大家记住你的 2-3 个专业观点或干货结论是什么？',
];
const KB_CATEGORIES = ['产品介绍', '客户痛点', '避坑经验', '数据·价格', '使用技巧', '行业干货'];

async function handleAiKbBuild(data) {
  const cfg = await Storage.getConfig();
  if (!cfg.ai.apiKey && !cfg.ai.fallbackApiKey) throw new Error('未配置 API Key，请先到设置页填写');
  const answers = (data && Array.isArray(data.answers)) ? data.answers : [];
  const ansText = answers.map(function (a, i) {
    const q = (a && a.q) ? String(a.q) : (KB_QUESTIONS[i] || ('Q' + (i + 1)));
    const ans = String((a && a.answer) || '').trim() || '（未回答）';
    return `Q${i + 1}. ${q}\nA${i + 1}. ${ans}`;
  }).join('\n\n');
  const system = `你是小红书账号的专业知识库整理师。根据用户对几个问题的回答，整理出一份可直接用于写评论/文案的知识库条目。
要求：
1. 每条包含三个字段：标题(30字内)、分类(仅从：${KB_CATEGORIES.join('/')} 中选)、内容(1-4句，具体、带数字/结论/可引用，别空话)。
2. 一共生成 3~8 条；优先把用户明确给的经验、数字、案例、结论拆成独立条目，不要重复。
3. 内容用第二人称中立专业、可直接引用，不要带"我"的语气（人设才需要"我"）。
4. 只输出一个 JSON 数组，形如 [{"title":"提前还房贷怎么选","category":"避坑经验","content":"…"}]，不要任何其他文字或代码块标记。`;
  const user = `【我回答的几个问题】\n${ansText}\n\n请据此整理成我的知识库。`;
  const r = await AiClient.chatCompletion({ ...cfg.ai, maxTokens: 2048 }, system, user);
  let txt = String(r.content || '').trim();
  if (!txt) throw new Error('AI 未返回知识库，请重试');
  let entries = Utils.extractJson(txt);
  if (!Array.isArray(entries)) throw new Error('AI 返回格式不对，请重试');
  entries = entries.map(e => ({
    title: String((e && e.title) || '').trim().slice(0, 40),
    category: KB_CATEGORIES.includes((e && e.category)) ? e.category : (KB_CATEGORIES.find(c => String((e && e.category) || '').includes(c)) || '通用'),
    content: String((e && e.content) || '').trim(),
  })).filter(e => e.title && e.content).slice(0, 8);
  if (!entries.length) throw new Error('AI 未生成有效条目，请把回答写具体些再试');
  return { ok: true, entries };
}

// 把 AI 生成的知识库条目并入当前知识库（按标题去重，追加）
async function handleAiKbSave(data) {
  const incoming = (data && Array.isArray(data.entries)) ? data.entries : [];
  if (!incoming.length) return { ok: true, added: 0 };
  const kc = (await Storage.getKnowledgeBase()) || [];
  const titles = new Set(kc.map(e => String(e.title || '').trim()));
  const ts = Date.now();
  let added = 0;
  for (const e of incoming) {
    const title = String((e && e.title) || '').trim();
    const content = String((e && e.content) || '').trim();
    if (!title || !content || titles.has(title)) continue;
    titles.add(title);
    kc.push({
      id: 'kb' + (++added) + '_' + ts + Math.random().toString(36).slice(2, 6),
      title,
      category: String((e && e.category) || '通用').trim() || '通用',
      content,
      tags: Array.isArray(e.tags) ? e.tags : [],
      role: '',
      isActive: true,
      image: null,
      createdAt: ts,
    });
  }
  if (added) await chrome.storage.local.set({ knowledge_base: kc });
  return { ok: true, added };
}

// 知识库导入：接收粘贴文本（逐行"标题：内容"或 JSON 数组），去重入库
async function handleAiKbImport(data) {
  const text = String((data && data.text) || '').trim();
  if (!text) return { ok: true, added: 0, entries: [] };
  const kc = (await Storage.getKnowledgeBase()) || [];
  const titles = new Set(kc.map(e => String(e.title || '').trim()));
  const ts = Date.now();
  let added = 0;
  const push = (title, category, content) => {
    title = String(title || '').trim(); content = String(content || '').trim();
    if (!title || !content || titles.has(title)) return;
    titles.add(title);
    kc.push({ id: 'kb' + (++added) + '_' + ts + Math.random().toString(36).slice(2, 6), title, category: String(category || '通用').trim() || '通用', content, tags: [], role: '', isActive: true, image: null, createdAt: ts });
  };
  // 尝试解析为 JSON 数组
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) { parsed.forEach(function (e) { push((e && e.title) || '', (e && e.category) || '通用', (e && e.content) || (e && e.desc) || ''); }); }
  } catch (_) {
    // 非 JSON：逐行 "标题：内容"
    text.split(/\n+/).forEach(function (line) {
      const s = String(line).trim(); if (!s) return;
      const c = s.indexOf('：');
      if (c > -1) push(s.slice(0, c), '通用', s.slice(c + 1));
      else push(s.slice(0, 12), '通用', s);
    });
  }
  if (added) await chrome.storage.local.set({ knowledge_base: kc });
  return { ok: true, added, entries: kc.slice(-added) };
}

/* ═══════════ 账号诊断工作流③：产品卖点提炼（答几问 → AI 生成卖点） ═══════════ */
const DIAG_SELL_QUESTIONS = [
  '你的产品/服务是什么？主要帮人解决什么问题、给谁用？',
  '相比竞品或以前的用法，它最大的 2-3 个优势或差异点是什么？',
  '有没有具体数字、效果、案例能证明它的价值？',
  '用户最可能在什么场景/需求下想起它、怎么找到你？',
];

async function handleAiSellPointBuild(data) {
  const config = await Storage.getConfig();
  if (!config.ai.apiKey && !config.ai.fallbackApiKey) throw new Error('未配置 API Key，请先到设置页填写');
  const answers = Array.isArray(data.answers) ? data.answers.filter(a => String(a && a.answer || '').trim()) : [];
  const ansText = DIAG_SELL_QUESTIONS.map(function (q, i) {
    const a = (answers[i] && String(answers[i].answer ?? answers[i])) || '（未回答）';
    return 'Q' + (i + 1) + '. ' + q + '\nA' + (i + 1) + '. ' + a.trim();
  }).join('\n\n');
  const known = Array.isArray(data.existing) ? data.existing.filter(s => s && (s.title || s.content)).slice(0, 10) : [];
  const system = '你是产品卖点提炼师。根据用户对几个问题的回答，提炼出可直接用于小红书评论/文案的【产品卖点】。' +
    '要求：每条卖点包含 标题(≤14字) 和 内容(1-2句，自然带具体数字/场景/结果，别空话套话)。' +
    '一共生成 3~8 条；把用户明确提到的优势、数字、案例、适用场景拆成独立卖点，不要重复。' +
    '只输出严格 JSON 数组，形如 [{"title":"几秒出对比结果","content":"输入首付和月供，立马算出等额本息的省钱差异"}], 不要任何其他文字或代码块标记。';
  const user = '【我回答的几个问题】\n' + ansText +
    (known.length ? '\n\n【已有卖点（去重参考）】\n' + known.map(s => (s.title || '') + '：' + (s.content || '')).join('\n') : '') +
    '\n\n请据此提炼成我的产品卖点。';
  const rawText = await _chatAi(config, system, user, 2000);
  const txt = String(rawText || '').trim();
  if (!txt) throw new Error('AI 未返回卖点，请重试');
  let list = Utils.extractJson(txt);
  if (list && !Array.isArray(list)) { list = list.sellPoints || list.sell_point || list.points || list.data || null; }
  if (!Array.isArray(list)) throw new Error('AI 返回格式不对，请重试');
  list = list.map(function (e) { return { title: String((e && e.title) || '').trim().slice(0, 14), content: String((e && e.content) || '').trim() }; }).filter(e => e.title && e.content).slice(0, 8);
  if (!list.length) throw new Error('AI 未生成有效卖点，请把回答写具体些再试');
  return { ok: true, sellPoints: list };
}

/* ═══════════ 发笔记配图①：背景建议提示词（仅“案例实拍/截图”等确需真实素材的页） ═══════════ */
async function handleAiBgPrompt(data) {
  const config = await Storage.getConfig();
  if (!config.ai.apiKey && !config.ai.fallbackApiKey) throw new Error('未配置 API Key，请先到设置页填写');
  const page = String((data && data.page) || '').trim() || '这一页';
  const purpose = String((data && data.purpose) || '').trim();
  const bgKind = String((data && data.bgKind) || '').trim();
  const sellPoint = String((data && data.sellPoint) || '').trim();
  const system = '你帮我把小红书“知识科普图文”某一页的背景做出来。这里只要【背景画面】，不要出现任何文字/数字（文字后续前端叠加）。' +
    '返回一段能直接扔给文生图(千问/通义万相等)执行的纯背景提示词，中文，包含：色调、质感、留白程度、与知识主题/卖点相衬的视觉元素，并显式写"画面纯净留白、不要任何文字"。' +
    '只输出一句完整的提示词正文，不要任何解释、不要 JSON、不要代码块。';
  const user = ['【这一页】' + page, purpose ? '【这一页要传达】' + purpose : '', bgKind ? '【背景类型】' + bgKind : '', sellPoint ? '【相关卖点】' + sellPoint : ''].filter(Boolean).join('\n');
  const prompt = await _chatAi(config, system, user, 600);
  const txt = String(prompt || '').trim();
  if (!txt) throw new Error('AI 未返回背景提示词，请重试');
  return { ok: true, prompt: txt };
}

/* ═══════════ 发笔记配图②：知识卡元素布局（AI 给出 Canvas 元素布局 JSON，前端渲染） ═══════════ */
async function handleAiCanvasLayout(data) {
  const config = await Storage.getConfig();
  if (!config.ai.apiKey && !config.ai.fallbackApiKey) throw new Error('未配置 API Key，请先到设置页填写');
  const sellPoint = String((data && data.sellPoint) || '').trim();
  const title = String((data && data.title) || '').trim();
  const points = Array.isArray(data.points) ? data.points.filter(p => String(p || '').trim()) : [];
  const purpose = String((data && data.purpose) || '').trim();
  const bgKind = String((data && data.bgKind) || '').trim();
  const system = [
    '你是小红书“知识科普图文”封面/知识卡排版师。根据下面信息，产出一份【Canvas 元素布局 JSON】，前端会把它画到背景图上，生成知识卡片。',
    '规则：',
    '1) 画布为 3:4，宽 1000、高 1333。所有坐标用宽高的【百分比小数】(0~1)，如 标题 x=0.5(水平居中)、y=0.16(距顶16%)。',
    '2) elements 里的每个元素类型及字段：',
    '   {type, text, x, y, w(宽度占比), fontSize, weight:"bold|normal", color, bg(底色，可空), textAlign:"left|center", radius, stroke(描边色，可空), alignV:"top|center"}',
    '   type 可选：title 主标题 / subtitle 副标题 / point 要点分点 / data 数据高亮 / compare 对比双栏 / steps 流程步骤 / chip 关键词胶囊 / quote 引用金句 / label 小标签。',
    '3) 排版要求“爆款知识卡”：主标题短而抓人(≤12字，大字号≥80、粗体)；要点分点清晰(每条前面带序号或圆点，可用多条 point 元素)；数据高亮用超大数字配单位(如 “1000+”，color 用撞色)；对比双栏用两个区块(左新/右旧 或 A/B，含小标题+一句)；流程步骤用多个 chip/step 横向排(带箭头用 text “→”)；关键词胶囊用圆角底色 chip；引用金句带大引号。',
    '4) 整卡要留白透气、层次分明，避免糊在一团；配色给出具体色值(如主色 #ff274b、强调 #ffd54f、正文 #1f1f1f)。',
    '5) 只输出严格 JSON 数组（不要包对象），形如 [{"type":"title","text":"…","x":0.5,"y":0.16,"w":0.8,"fontSize":96,"weight":"bold","color":"#1f1f1f","textAlign":"center"},…]，不要任何解释或代码块。',
  ].join('\n');
  const user = [
    '【这张卡片的核心卖点/内容】' + sellPoint,
    title ? '【主标题】' + title : '',
    points.length ? '【正文要点】\n' + points.map((p, i) => (i + 1) + '. ' + p).join('\n') : '',
    purpose ? '【这一页要传达】' + purpose : '',
    bgKind ? '【背景类型】' + bgKind + '（元素配色要与它协调、对比清晰）' : '',
  ].filter(Boolean).join('\n\n');
  const raw = await _chatAi(config, system, user, 2200);
  let el = Utils.extractJson(raw);
  if (el && !Array.isArray(el)) { el = el.elements || el.layout || null; }
  if (!Array.isArray(el)) throw new Error('AI 返回格式不对，请重试');
  el = el.filter(function (e) { return e && e.type; }).slice(0, 20);
  if (!el.length) throw new Error('AI 未生成有效布局，请重试');
  return { ok: true, elements: el };
}

/* ═══════════ 账号诊断工作流④：内容规划（账号类型 + 规划问答 → AI 出笔记规划） ═══════════ */
const DIAG_ACCOUNT_TYPES = ['干货分享型', '测评型', '生活方式种草型', '教程/步骤型', '经验情感型', '资料整理型', '个人IP/创始人型'];

async function handleAiNotePlan(data) {
  const config = await Storage.getConfig();
  if (!config.ai.apiKey && !config.ai.fallbackApiKey) throw new Error('未配置 API Key，请先到设置页填写');
  const profile = data.profile || {};
  const accountType = String(data.accountType || '').trim();
  const persona = String(data.persona || '').trim();
  const answers = Array.isArray(data.answers) ? data.answers.filter(a => String(a && a.answer || '').trim()) : [];
  const ansText = answers.map(a => '问：' + String(a.q || '') + '\n答：' + String(a.answer || '')).join('\n\n');
  const { name: prodName, desc: prodDesc } = await _npProductContext(config);
  const kbArr = (await Storage.getKnowledgeBase()) || [];
  const kbText = kbArr.filter(e => e.isActive !== false && (e.title || e.content)).slice(0, 14).map(e => (e.title || '') + '：' + String(e.content || '').slice(0, 200)).join('\n');

  const ctx = [
    '【账号信息】' + ('昵称:' + (profile.name || '未命名') + '；小红书号:' + (profile.xhsId || '') + '；简介:' + (profile.desc || '（暂无') + '）'),
    '【账号类型】' + (accountType || '（未选，由你判断）'),
    '【我的账号人设】\n' + (persona || '（尚未建立）'),
    '【我的产品】' + (prodName || '（未填）'),
    prodDesc ? '【产品卖点】' + prodDesc : '',
    kbText ? '【我的知识库】\n' + kbText : '',
    ansText ? '【我对规划问题的回答】\n' + ansText : '',
  ].filter(Boolean).join('\n\n');

  const system = [
    '你是小红书账号的内容规划师。根据账号信息、已立的人设、知识库和用户对规划问题的回答，产出一份可立即执行的【笔记内容规划】。',
    '要明确给出：主要讲什么内容；主要人群是谁；笔记架构（图文一套建议发几页、每一页 P1..Pn 的作用与构图要点）；发布频率（一周几篇、什么时段发、节奏理由）。',
    '要求具体落地、能直接照着做；结合账号类型和卖点，不空话套话。',
    '【配图背景规划】这是一个“知识科普图文”账号，每页配图都是信息型知识卡片（封面 + P2..Pn），背景=画面，文字/数据等元素后续由前端 Canvas 叠加。请为每一页给出 photoPlans：',
    '· bgKind 只允许四种：留白信息卡 / 数据卡 / 流程步骤卡 / 对比卡（这类背景由前端自绘，几乎不需要真实照片）；只有个别页确需“实拍/截图”时才用 案例实拍。',
    '· purpose：这一页要传达的核心点；suggest：这页背景怎么搭/画什么（给用户/前端）；importHint：确需真实素材时建议导入什么（不需要就写"无"）。',
    '只输出严格 JSON，不要用代码块，结构必须是：{"accountType":"账号类型","contentFocus":"主要讲什么内容","targetPeople":"主要人群及需求","structure":"笔记架构：建议几页+逐页P1..Pn作用与构图","pageCount":数字,"perPage":["P1作用","P2作用",...],"photoPlans":[{"page":"封面/P2/P3..","purpose":"这页核心点","bgKind":"留白信息卡|数据卡|流程步骤卡|对比卡|案例实拍","suggest":"背景怎么搭/画什么","importHint":"确需实拍时建议导入什么(否则无)"}],"frequency":"发布频率与理由","timing":"发布时间建议","topics":[{"title":"选题标题方向","angle":"切入角度"}(5-8个)]}',
  ].join('\n');

  const raw = await _chatAi(config, system, ctx, 3000);
  let d = parseJsonObject(raw);
  if (!d) throw new Error('AI 返回无法解析：' + String(raw).slice(0, 160));
  // ★ 持久化内容规划（含 photoPlans），供发笔记时逐张配图取建议；租户作用域
  try { await chrome.storage.local.set({ note_plan: d }); } catch (_) {}
  return { plan: d, raw };
}

/* ═══════════ 账号诊断工作流⑤：深度评估报告（综合所有信息 → 完整整改方案） ═══════════ */
async function handleAiDeepReport(data) {
  const config = await Storage.getConfig();
  if (!config.ai.apiKey && !config.ai.fallbackApiKey) throw new Error('未配置 API Key，请先到设置页填写');
  const profile = data.profile || {};
  const persona = String(data.persona || '').trim();
  const accountType = String(data.accountType || '').trim();
  const planText = String(data.planText || '').trim();
  const kbArr = (await Storage.getKnowledgeBase()) || [];
  const kbText = kbArr.filter(e => e.isActive !== false && (e.title || e.content)).slice(0, 14).map(e => (e.title || '') + '：' + String(e.content || '').slice(0, 200)).join('\n');
  const _notesText = (profile.notes || []).map((n, i) => (i + 1) + '. ' + (n.title || '（未命名）')).join('\n');
  const _p = config.product || {};
  const _s = config.scriptStyle || {};
  const sell = Array.isArray(_p.sellPoints) ? _p.sellPoints.filter(s => s && (s.title || s.content)).slice(0, 10).map(s => (s.title || '') + (s.content ? '：' + s.content : '')) : [];
  const ctx = [
    '【账号信息】' + ('昵称:' + (profile.name || '未命名') + '；小红书号:' + (profile.xhsId || '') + '；简介:' + (profile.desc || '（暂无）') + '；粉丝:' + (profile.fans || '-') + '/关注:' + (profile.follows || '-') + '/获赞:' + (profile.likes || '-') + ''),
    '【发过的笔记】\n' + (_notesText || '（未读到）'),
    '【账号类型】' + (accountType || '（未选）'),
    '【我的账号人设】\n' + (persona || '（尚未建立）'),
    kbText ? '【我的知识库】\n' + kbText : '',
    planText ? '【内容规划】\n' + planText : '',
    '【我的产品】' + (_p.name || '（未填）') + (sell.length ? '\n卖点：' + sell.join('\n') : ''),
    (_p.guideText ? '【引导方式】' + _p.guideText : ''),
    (_p.username || _p.cta || _p.coverHook) ? '【封面设置】' + [(_p.username ? '署名昵称:' + _p.username : ''), (_p.cta ? '引流文案:' + _p.cta : ''), (_p.coverHook ? '封面一句话:' + _p.coverHook : '')].filter(Boolean).join('；') : '',
    (_s.scriptPurpose ? '【评论目的】' + _s.scriptPurpose + (sell.length ? '' : '') + (_s.purposeMinChars ? ('（字数 ' + _s.purposeMinChars + '-' + _s.purposeMaxChars + '）') : '') : ''),
    (_s.toneMannerisms ? '【口癖池】' + _s.toneMannerisms : ''),
  ].filter(Boolean).join('\n\n');

  const system = [
    '你是资深的小红书账号运营顾问，基于一份账号的完整资料（主页/人设/知识库/内容规划）产出一份【深度评估报告】，指出问题并给可直接落地的整改清单。',
    '逐项评估：1)定位/人设是否清晰有差异；2)简介是否讲清"我是谁、为谁、提供什么价值"+钩子；3)笔记是否聚焦、与定位/产品一致、结构是否符合推荐架构；4)内容规划与知识库是否支撑人设与账号定位。',
    '给出这份账号的核心问题、整改优先级、以及最有利于涨粉/转化的动作清单。',
    '只输出严格 JSON，不要用代码块，结构必须是：{"overall":"总体诊断一句话","summary":"现状概述(120字内)","positioning":{"issue":"..","suggestion":".."},"personaReview":{"issue":"..","suggestion":".."},"kbReview":{"issue":"..","suggestion":".."},"sections":[{"name":"头像/简介/笔记/内容/人设中的一项","issue":"..","suggestion":".."}],"structure":"笔记架构建议","frequency":"发布频率与时间建议","priorities":["整改动作1","动作2","动作3"],"risks":["风险/提醒（如账号阶段、平台规则）"]}',
  ].join('\n');

  const raw = await _chatAi(config, system, ctx, 3200);
  let d = parseJsonObject(raw);
  if (!d) throw new Error('AI 返回无法解析：' + String(raw).slice(0, 160));
  return { report: d, raw };
}

// 取当前生效的人设正文（用于注入评论/文案生成）；无完整人设时回退到口吻/简介文本
function getPersonaText(config) {
  const p = config && config.persona;
  if (p && p.text) return p.text.trim();
  return ((config && config.scriptStyle && config.scriptStyle.personaIntro) || '').trim();
}

// 口癖池 → 抽取 1-2 个自然口癖，注入话术；没配置用内置池
const BUILTIN_TONES = [
  '说实话', '我记得', '当时也是', '其实', '可能吧', '反正', '真的', '就是',
  '我也是这么觉得', '你还别说', '正好', '我刚开始也', '身边朋友', '后来才明白', '慢慢才发现', '结果发现',
];
function pickToneWords(scriptStyle) {
  const custom = (scriptStyle?.toneMannerisms || '').split(/[,，、;\n\r]+/).map(s => s.trim()).filter(Boolean);
  const pool = custom.length > 0 ? custom : BUILTIN_TONES;
  const n = Math.min(pool.length, 1 + Math.floor(Math.random() * 2)); // 1 或 2 个
  const picked = [];
  const bag = pool.slice();
  for (let i = 0; i < n; i++) { const j = Math.floor(Math.random() * bag.length); picked.push(bag.splice(j, 1)[0]); }
  return picked.join('、');
}

/* ─── 商机挖掘 ─── */
async function handleFindProspects(data) {
  const config = await Storage.getConfig();

  if (!config.ai.apiKey && !config.ai.fallbackApiKey) {
    throw new Error('未配置 API Key，请先在设置页面填写');
  }

  const { comments = [], title = '', description = '', author = '' } = data;
  if (comments.length === 0) {
    return { prospects: [], summary: '暂无评论' };
  }

  // 全部评论直接送入后续环节（关键词过滤已移除：规则容易误伤真需求，商机判断交给 AI 更准）
  let visible = comments.map((c, i) => ({ ...c, _idx: i }));

  // 构建评论文本（编号用原始 0-based 索引）
  const commentsText = visible.map(c => `${c._idx}. @${c.author || '匿名'}: ${c.content || ''}`).join('\n');

  // ★ 商机数量按评论总数动态决定（看菜下饭），而非写死 3 条
  //   大致每 8 条评论允许 1 条商机，下限 3 、上限 12；评论多就尽量挖满
  const cc = visible.length;
  let maxOpp = Math.max(3, Math.min(12, Math.ceil(cc / 8)));

  // 构建渲染上下文
  const goalRules = buildGoalRules(config); // 推广目标决定判定口径（打法由评论目的决定）
  const purposeRules = buildPurposeRules(config.scriptStyle); // 评论目的：整体倾向 + 倾斜说明
  const context = {
    note_title: title || '（无标题）',
    note_content: description || '',
    note_author: author || '作者',
    comment_count: String(visible.length),
    comments_text: commentsText,
    // 商机数量上限（按评论总数动态计算）
    max_opportunities: String(maxOpp),
    // 产品相关占位符（引导方式留空 = 不引流，纯品牌/价值分享，指令直接注入提示词）
    product_name: config.product.name || '我的产品',
    product_guide: (config.product.guideText || '').trim()
      || '无（不引流：禁止引导对方去任何小程序/App/公众号/个人主页等平台，也不要出现“点我头像”“去搜”这类话；只自然分享产品/品牌本身的价值与口碑，讲完就收）',
    product_description: (typeof Edition !== 'undefined' && !Edition.hasFeature('productLib')) ? '' : (config.product.description || ''),
    // ★ 推广目标注入：快筛判定、版本判定口径都跟着推广目标切（引流承接边界仍由 buildGoalRules 负责）
    promo_goal_name: goalRules.goalName,
    promo_goal_rules: goalRules.rules,
    // ★ 评论目的注入：整体倾向 + 倾斜说明 + 完整打法库（每条评论 AI 自适应选用）
    purpose_name: purposeRules.name,
    purpose_guidance: purposeRules.guidance,
    purpose_catalog: buildTacticCatalog(),
    tone_words: pickToneWords(config.scriptStyle),
    persona_sample: (config.scriptStyle?.personaSample || '').trim(),
    persona_intro: getPersonaText(config),
    account_nickname: (Array.isArray(config.myAccountNames) && config.myAccountNames.length && String(config.myAccountNames[0] || '').trim()) ? String(config.myAccountNames[0]).trim() : '',
    // 字数控制（评论目的版：单范围；兼容旧统一 minChars/maxChars）
    purpose_min_chars: String(config.scriptStyle?.purposeMinChars ?? config.scriptStyle?.minChars ?? 20),
    purpose_max_chars: String(config.scriptStyle?.purposeMaxChars ?? config.scriptStyle?.maxChars ?? 260),
    // 话术版本风格（从配置中读取）
    version_a_style: config.scriptStyle?.versionAStyle || '',
    version_b_style: config.scriptStyle?.versionBStyle || '',
    version_c_style: config.scriptStyle?.versionCStyle || '',
    // 字数控制（每个版本独立配置；兼容旧版统一字数 minChars/maxChars）。总闸敞开到 60，
    //   具体每条话术长短以「打法」为准（教程/数据类可到 55，带赞/提问类 8~25，见打法库每项标注）
    a_min_chars: String(config.scriptStyle?.aMinChars ?? config.scriptStyle?.minChars ?? 20),
    a_max_chars: String(config.scriptStyle?.aMaxChars ?? config.scriptStyle?.maxChars ?? 260),
    b_min_chars: String(config.scriptStyle?.bMinChars ?? config.scriptStyle?.minChars ?? 20),
    b_max_chars: String(config.scriptStyle?.bMaxChars ?? config.scriptStyle?.maxChars ?? 260),
    c_min_chars: String(config.scriptStyle?.cMinChars ?? config.scriptStyle?.minChars ?? 20),
    c_max_chars: String(config.scriptStyle?.cMaxChars ?? config.scriptStyle?.maxChars ?? 260),
    // 兼容旧占位符 {min_chars}/{max_chars}：取三个版本的整体范围
    min_chars: String(Math.min(config.scriptStyle?.aMinChars ?? 20, config.scriptStyle?.bMinChars ?? 20, config.scriptStyle?.cMinChars ?? 20, config.scriptStyle?.minChars ?? 20)),
    max_chars: String(Math.max(config.scriptStyle?.aMaxChars ?? 260, config.scriptStyle?.bMaxChars ?? 260, config.scriptStyle?.cMaxChars ?? 260, config.scriptStyle?.maxChars ?? 260)),
  };

  // ★ 知识库准备（受 knowledge 版本开关闸门控制）：
  //   快筛阶段把条目预览给 AI 预选 → 大分析只注入 AI 选中的条目详情（更有针对性）
  const kbEnabled = typeof Edition === 'undefined' || Edition.hasFeature('knowledge');
  let knowledgeBase = [];
  let kbPreview = '';
  let kbSelectedByAi = [];   // 快筛选中的知识库条目（大分析只注入这些）
  let kbPickedByAi = false;  // 快筛是否成功给出了知识库选择（true 时不再走本地匹配兜底）
  if (kbEnabled) {
    knowledgeBase = (await Storage.getKnowledgeBase()) || [];
    const activeKb = knowledgeBase.filter(e => e.isActive !== false);
    if (activeKb.length > 0) {
      kbPreview = activeKb.map((e, i) => {
        const tags = Array.isArray(e.tags) && e.tags.length > 0 ? `（标签：${e.tags.join('/')}）` : '';
        const preview = (e.content || '').slice(0, 120);
        return `${i + 1}. ${e.title || '（无标题）'}${tags} — ${preview}${preview.length >= 120 ? '…' : ''}`;
      }).join('\n');
    }
  }

  // 获取提示词模板（优先用户自定义，其次默认）
  let promptTemplate = await Storage.getPrompt('prospect_finder');
  if (!promptTemplate) {
    promptTemplate = DEFAULT_PROMPTS.prospect_finder;
  }

  // ★★ 阶段1：AI 快筛（轻量、只输出几十 token、几秒出结果）——先干两件事：
  //   1. 抓取自检：拓到的到底是不是真实评论（而非点赞数/昵称/界面文字），抓错了直接打断，不白跑大分析
  //   2. 价值筛选：挑出值得大分析的评论编号；一条都没有 → 直接结束，省下整趟 15~30 秒的大请求
  //   快筛任何失败（网络/解析）→ 自动降级为全量分析，绝不让快筛变成新故障点；评论≤3条不值得多一次往返，跳过
  if (!data.skipAiScreen && visible.length > 3) {
    try {
      try { chrome.runtime.sendMessage({ action: 'aiPhase', phase: 'screening', count: visible.length }); } catch (_) {}
      let screenTpl = await Storage.getPrompt('prospect_screener');
      if (!screenTpl) screenTpl = DEFAULT_PROMPTS.prospect_screener;
      const sRendered = PromptRenderer.renderPrompt(screenTpl, { ...context, kb_preview: kbPreview }, '');
      // 复用同一模型；输出极小，maxTokens 压到 2048 防跑飞（推理模型思考会占 token，留足思考预算避免快筛总被思考占满而降级）
      const screenCfg = { ...config.ai, maxTokens: 2048 };
      const sT0 = Date.now();
      const { content: sContent, usage: sUsage } = await AiClient.chatCompletion(screenCfg, sRendered.systemPrompt, sRendered.userPrompt);
      const sParsed = Utils.extractJson(sContent);
      if (!sParsed) throw new Error('快筛返回无法解析为 JSON');
      const sMs = Date.now() - sT0;
      await Storage.addAiLog({
        scene: 'prospect_screener',
        tokensIn: sUsage.prompt_tokens || 0,
        tokensOut: sUsage.completion_tokens || 0,
        success: true,
      });
      console.log('[小红书助手] 快筛结果(' + sMs + 'ms):', JSON.stringify(sParsed));

      // 抓取异常 → 打断，不做大分析（popup 据 captureError 字段展示错误空态）
      if (sParsed.capture_ok === false) {
        return {
          prospects: [],
          has_opportunity: false,
          captureError: sParsed.capture_problem || '抓到的内容不像真实评论',
          summary: 'AI 判定抓取内容异常：' + (sParsed.capture_problem || '未说明'),
        };
      }

      const idxs = Array.isArray(sParsed.valuable_indexes)
        ? sParsed.valuable_indexes.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < comments.length)
        : [];

      // ★ 知识库预选：AI 根据评论 + 条目预览，告诉后面组织话术要用哪些条目
      //   （字段缺失时保持 false，让大分析走本地匹配兜底，绝不让知识库因格式问题丢失）
      if (Array.isArray(sParsed.selected_kb_ids)) {
        kbPickedByAi = true;
        if (kbEnabled && sParsed.selected_kb_ids.length > 0) {
          const activeKb = knowledgeBase.filter(e => e.isActive !== false);
          kbSelectedByAi = sParsed.selected_kb_ids
            .map(Number)
            .filter(n => Number.isInteger(n) && n >= 1 && n <= activeKb.length)
            .map(n => activeKb[n - 1]);
          console.log('[小红书助手] 快筛预选知识库:', kbSelectedByAi.map(e => e.title).join(', ') || '（无）');
        }
      }
      // 一条有价值的都没有：
      //   ★ 快筛只是"轻量预筛"，它的"空结论"不可全信——评论区稍微有点讨论量（≥8 条）时它极易把真商机误判成没有。
      //     这里只信任它对"没人气小帖"（评论很少）的判 空；评论一多却判 空 → 多半是快筛漏了，
      //     直接降级交给完整分析（prospect_finder）重新判断，宁可多跑一次、绝不漏掉真商机。
      if (idxs.length === 0) {
        if (visible.length < 8) {
          return {
            prospects: [],
            has_opportunity: false,
            screenedByAi: true,
            screenMs: sMs,
            summary: sParsed.summary || 'AI 快筛：本篇评论无与产品相关的商机',
          };
        }
        console.warn('[小红书助手] 快筛把这 ' + visible.length + ' 条评论的商机全判空了，识别为可疑误判，降级走完整分析（宁可多跑一次，不漏真商机）');
      }
      // 只把选中的评论送入阶段2（_idx 是原始索引，comment_index 映射天然不破坏）
      const idxSet = new Set(idxs);
      const kept = visible.filter(c => idxSet.has(c._idx));
      if (kept.length > 0 && kept.length < visible.length) {
        console.log(`[小红书助手] 快筛选中 ${kept.length}/${visible.length} 条，只把选中的送入大分析`);
        visible = kept;
        // 同步刷新依赖 visible 的上下文字段（后续知识库路由/大 prompt 都用它）
        context.comments_text = visible.map(c => `${c._idx}. @${c.author || '匿名'}: ${c.content || ''}`).join('\n');
        context.comment_count = String(visible.length);
        maxOpp = Math.max(3, Math.min(12, Math.ceil(visible.length / 8)));
        context.max_opportunities = String(maxOpp);
      }
    } catch (e) {
      // 降级：快筛挂了就当没这回事，照旧全量分析
      console.warn('[小红书助手] AI 快筛失败，降级为全量分析:', e.message);
    }
    try { chrome.runtime.sendMessage({ action: 'aiPhase', phase: 'generating' }); } catch (_) {}
  }

  // ★ 知识库注入（受 knowledge 版本开关闸门控制）：
  //   快筛成功预选 → 只注入 AI 选中的条目详情；快筛跳过/失败/未给出选择 → 本地关键词匹配兜底
  let kbContext = '';   // 文本注入
  let kbImages = [];    // 匹配条目的图片
  let kbMatchedEntries = []; // 匹配的条目详情
  if (kbEnabled) {
    let kbResult = null;
    if (kbPickedByAi) {
      if (kbSelectedByAi.length > 0) {
        kbResult = KnowledgeSearch.buildKbContext(kbSelectedByAi);
        console.log('[小红书助手] 快筛预选知识库 → 注入:', kbSelectedByAi.map(e => e.title).join(', '));
      } else {
        console.log('[小红书助手] 快筛判定无需知识库，本次不注入');
      }
    } else {
      const roleKeywords = config.roleKeywords || {};
      kbResult = KnowledgeSearch.searchKnowledgeBase(knowledgeBase, context, roleKeywords);
    }
    if (kbResult) {
      kbContext = kbResult.text;
      kbImages = kbResult.images;
      kbMatchedEntries = kbResult.matchedEntries || [];
    }
  }

  // 单次渲染：模板含 {purpose_*} 占位符，把目的倾向 + 打法库注入，让 AI 每条自适应选用
  const aiConfigForScan = { ...config.ai, maxTokens: Math.max(config.ai.maxTokens || 4096, 4096) };
  // ★ 流式输出：AI 边生成边把“已生成字数”推给 popup，用户不再对着静止的转圈干等；节流每 300ms 播一次
  let _lastProgressTs = 0;
  const onProgress = (charsSoFar) => {
    const now = Date.now();
    if (now - _lastProgressTs < 300) return;
    _lastProgressTs = now;
    try { chrome.runtime.sendMessage({ action: 'aiStreamProgress', chars: charsSoFar }); } catch (_) {}
  };
  // ★ AI 调用异常 → 自动重试：AI 服务不稳定是偶发的；重试时逐级放宽输出上限（8192→16384），第3次只服务“思考占满”场景
  const runStyleAnalysis = async (systemP, userP) => {
    let content = '', usage = {}, parsed = null, aiError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        let cfgForAttempt = aiConfigForScan;
        if (attempt === 2) cfgForAttempt = { ...aiConfigForScan, maxTokens: Math.max(aiConfigForScan.maxTokens || 0, 8192) };
        if (attempt === 3) cfgForAttempt = { ...aiConfigForScan, maxTokens: Math.max(aiConfigForScan.maxTokens || 0, 16384) };
        const r = await AiClient.chatCompletion(cfgForAttempt, systemP, userP, onProgress);
        content = r.content; usage = r.usage || {};
        parsed = Utils.extractJson(content);
        if (parsed) break;
      } catch (err) { aiError = err; content = err.aiRaw || content; if (attempt >= 2 && !err.reasoningOvershoot) break; }
    }
    if (!parsed) {
      const e = new Error(aiError ? `AI 调用异常：${aiError.message}` : `AI 返回格式错误，无法解析 JSON。原始回复：${String(content || '').slice(0, 200)}`);
      e.aiRaw = aiError?.aiRaw || String(content || '');
      throw e;
    }
    return { parsed, usage };
  };

  // ★★ 单次调用：让 AI 扫完整批评论，对每条商机自适应选打法出 1-2 条（带 copy_labels）
  let systemPrompt, userPrompt;
  try { const r = PromptRenderer.renderPrompt(promptTemplate, { ...context }, kbContext); systemPrompt = r.systemPrompt; userPrompt = r.userPrompt; }
  catch (e) { throw e; }
  // ★ 兼容旧版/用户自定义模板：若仍写死“Top 3”且未用 {max_opportunities} 占位符，改为动态数量
  const topNRe = /Top\s*3|最多\s*3\s*条|前\s*3\s*条/gi;
  systemPrompt = systemPrompt.replace(topNRe, `最多 ${maxOpp} 条`);
  userPrompt = userPrompt.replace(topNRe, `最多 ${maxOpp} 条`);
  console.log('[小红书助手] 商机·目的可用打法 System Prompt:', systemPrompt);
  const { parsed: parsedAll, usage: usageRes } = await runStyleAnalysis(systemPrompt, userPrompt);
  const usageTotals = [usageRes];
  if (!parsedAll || !Array.isArray(parsedAll.prospects) || parsedAll.prospects.length === 0) {
    throw new Error('AI 未生成有效话术，请重试');
  }

  const prospects = [];
  const idxSeen = new Set();
  for (const p of parsedAll.prospects) {
    const k = (p.comment_index !== undefined ? p.comment_index : p.index);
    if (k === undefined || k === null || idxSeen.has(k)) continue;
    idxSeen.add(k);
    const rawCopies = (Array.isArray(p.suggested_copies) ? p.suggested_copies : [])
      .map(c => String((c && c.trim) ? c.trim() : c || '').trim())
      .filter(Boolean);
    if (rawCopies.length === 0) {
      const alt = String(p.suggested_reply || p.suggested_copy || '').trim();
      if (alt) rawCopies.push(alt);
    }
    if (rawCopies.length === 0) continue;
    // copy_labels：与建议话术一一对应，缺省时按“目的·话术”占位
    const rawLabels = (Array.isArray(p.copy_labels) ? p.copy_labels : []).map(String).filter(Boolean);
    const copy_labels = rawCopies.map((c, i) => ((rawLabels[i] && rawLabels[i].trim()) ? rawLabels[i].trim() : ''));
    prospects.push({
      index: k,
      comment_index: k,
      author: p.author || '未知',
      original_comment: String((p.original_comment && String(p.original_comment).slice(0, 30)) || p.original_comment || '').slice(0, 30),
      interest_reason: p.opportunity || p.interest_reason || '',
      suggested_copies: rawCopies,
      copy_labels,
      best_index: 0,
    });
  }
  if (prospects.length === 0) {
    throw new Error('AI 未生成有效话术，请重试');
  }

  // ★★ 一次“选最佳”轻量调用：为给出 ≥2 条的商机挑最适合发的一版（best_index = 版本编号）
  try {
    let bestTpl = await Storage.getPrompt('best_picker');
    if (!bestTpl) bestTpl = DEFAULT_PROMPTS.best_picker;
    const multi = prospects.filter(p => Array.isArray(p.suggested_copies) && p.suggested_copies.length >= 2);
    if (multi.length > 0) {
      const candidates_text = multi.map((p, i) =>
        `#${i} [评论 ${p.comment_index}]\n原评论：${p.original_comment || ''}\n` +
        p.suggested_copies.map((c, j) => `版本${j}${p.copy_labels && p.copy_labels[j] ? '（' + p.copy_labels[j] + '）' : ''}：${c}`).join('\n')
      ).join('\n\n');
      const r2 = PromptRenderer.renderPrompt(bestTpl, { product_guide: context.product_guide || '', candidates_text }, '');
      const cfg2 = { ...config.ai, maxTokens: Math.max(config.ai.maxTokens || 2048, 2048) };
      const { content: bContent } = await AiClient.chatCompletion(cfg2, r2.systemPrompt, r2.userPrompt);
      const bParsed = Utils.extractJson(bContent);
      if (Array.isArray(bParsed)) {
        const m = {};
        for (const it of bParsed) { const qk = it && it.comment_index; const bv = Number(it && it.best); if (qk !== undefined && qk !== null && Number.isInteger(bv) && bv >= 0) m[String(qk)] = bv; }
        for (const p of prospects) { const val = m[String(p.comment_index)]; if (val !== undefined) p.best_index = val; }
      }
    }
  } catch (e) { console.warn('[小红书助手] 选最佳版本失败（使用默认第一版）:', e.message); }

  // 记录日志
  const totalIn = usageTotals.reduce((a, u) => a + (u && u.prompt_tokens ? u.prompt_tokens : 0), 0);
  const totalOut = usageTotals.reduce((a, u) => a + (u && u.completion_tokens ? u.completion_tokens : 0), 0);
  await Storage.addAiLog({
    scene: 'prospect_finder',
    tokensIn: totalIn,
    tokensOut: totalOut,
    success: true,
    noteTitle: title,
    commentCount: comments.length,
    prospectsFound: prospects.length,
  });

  return {
    prospects,
    summary: '',
    has_opportunity: prospects.length > 0,
    images: kbImages, // 匹配知识库条目的图片
    matchedEntries: kbMatchedEntries, // 匹配的知识库条目详情（用于日志）
    prompts: {}, // 三版提示词较大，调试时可在日志查看
  };
}

/* ─── 评论跟进：组装会话上下文（时间戳流 → 按用户分组对话） ───
 * items 来自 content.js 的通知页提取，DOM 顺序 = 时间倒序（最新在前，勘探验证过）。
 * 每条：{ idx, userId, userName, time, incoming, myComment, hasReplyBtn }
 *
 * ★ 真实语义（MHTML 勘探确认，勿再搞错）：
 *   - 每条通知 = 「对方回复了我的评论」：incoming（interaction-content）＝对方的消息；
 *     myComment（quote-info）＝我的原评论（被对方回复的那条），不是我的回复！
 *   - 通知页不显示「我是否回复过对方」→ 是否已回复只能靠本地记录（lastRepliedIncoming）判断
 *
 * ★ 用户核心要求1（消息整理）：把时间戳平铺的通知流组装成对话上下文再给 AI：
 *   1. 按 userId 分组（保序）
 *   2. 组内按 idx 反转为时间正序（旧→新）
 *   3. 展开对话：每条 = 我的原评论（role:'context'，作为对话背景）→ 对方消息（role:'user'）；
 *      我发出的回复由 MarkSent 追加（role:'assistant'）
 *   4. 组装后的 history 是干净的多轮对话（旧→新），直接渲染进 chat_follow 提示词
 *
 * ★ 用户核心要求2（定位保存）：每组会话保存“需要最新回复的那条评论”的定位：
 *   - pendingIdx = 该通知项在 DOM 中的序号（idx 锚点，发送时精确指向）
 *   - pendingIncoming = 该条消息原文（发送前交叉校验，防止错位）
 *   规则：组内时间最新的一条（可回复的）就是待回复定位；是否真的需要回复由合并阶段用本地记录判断
 */
function buildChatFollowConversations(items) {
  const conversations = {};
  const groups = new Map();
  for (const it of items || []) {
    if (!it || !it.userId) continue;
    if (!it.incoming || !it.incoming.trim()) continue;
    // 占位/异常消息（“原评论已删除”等）或不可回复（回复框展开中）→ 跳过
    if (/已删除|已移除|已被删除/.test(it.incoming)) continue;
    if (!it.hasReplyBtn) continue;
    if (!groups.has(it.userId)) groups.set(it.userId, []);
    groups.get(it.userId).push(it);
  }
  for (const [userId, list] of groups) {
    // DOM 顺序 = 时间倒序（idx 0 最新）→ 按 idx 降序 = 时间正序（旧→新）
    const ordered = [...list].sort((a, b) => b.idx - a.idx);
    // 去重：对方同一句话重复回复（手滑/重复提交）只保留最新一条，
    // 避免 AI 误以为对方真的说了两遍、或把“重复回复”当成多轮对话
    const deduped = [];
    for (const it of ordered) {
      const prev = deduped[deduped.length - 1];
      if (prev && prev.incoming === it.incoming) {
        deduped.pop(); // 丢弃旧的那条，保留最新（更新）的一条
        if (!it.myComment && prev.myComment) it.myComment = prev.myComment; // 补上原评论背景
      }
      deduped.push(it);
    }
    // 展开对话轮次：我的发言（评论/回复）作背景 → 对方消息；我的回复由发送成功后追加
    // 对方连续回复同一条我的评论（quote 相同）时背景只放一次，避免重复
    const history = [];
    let lastContext = '';
    for (const it of deduped) {
      if (it.myComment && it.myComment.trim() && it.myComment !== lastContext) {
        history.push({ role: 'context', content: it.myComment });
        lastContext = it.myComment;
      }
      history.push({ role: 'user', content: it.incoming });
    }
    // 最新一条（deduped 末尾）＝待回复定位候选
    const last = deduped[deduped.length - 1];
    conversations[userId] = {
      userName: last ? last.userName : (list[0] && list[0].userName) || '',
      history,
      turnCount: history.filter(m => m.role === 'user').length,
      // 通知页看不到“我是否回复过” → 默认待回复，合并阶段用本地 lastRepliedIncoming 修正
      needReply: true,
      pendingIdx: last ? last.idx : -1,        // ★ 待回复那条通知的 DOM 定位
      pendingIncoming: last ? last.incoming : '', // ★ 待回复原文（发送前校验用）
      // 上次回复的是哪条消息（合并阶段判断“这条是否已回过”）
      lastRepliedIncoming: '',
    };
  }
  return conversations;
}

/* ─── 评论跟进：同步通知页 → 重建会话并落库 ─── */
async function handleChatFollowSync(data) {
  const rebuilt = buildChatFollowConversations((data && data.items) || []);
  // 页面是真相，重建 history；sold / lastReplyAt / lastRepliedIncoming 页面看不到，必须保留旧值
  const state = await Storage.getChatFollowState();
  const old = (state && state.conversations) || {};
  const conversations = {};
  for (const [userId, conv] of Object.entries(rebuilt)) {
    const prev = old[userId];
    let needReply = conv.needReply;
    // ★ 防重复（关键）：通知页不显示“我是否已回复”，只能靠本地记录判断。
    //   若上次回复的正好就是当前最新的这条消息 → 已回复过，不重复回
    if (prev && prev.lastRepliedIncoming && prev.lastRepliedIncoming === conv.pendingIncoming) {
      needReply = false;
      conv.pendingIdx = -1;
      conv.pendingIncoming = '';
      // 把本地已发送的回复补进重建的 history（保证对话上下文完整）
      const lastLocal = prev.history[prev.history.length - 1];
      if (lastLocal && lastLocal.role === 'assistant') {
        conv.history.push({ role: 'assistant', content: lastLocal.content });
      }
    }
    conversations[userId] = {
      ...conv,
      needReply,
      lastRepliedIncoming: prev ? (prev.lastRepliedIncoming || '') : '',
      sold: !!(prev && prev.sold),
      lastReplyAt: prev ? (prev.lastReplyAt || 0) : 0,
      stale: false,
    };
  }
  // 旧用户已不在页面（通知被系统折叠/清空）→ 保留记录但标记 stale，避免误丢已售标记
  for (const [userId, prev] of Object.entries(old)) {
    if (!conversations[userId]) {
      conversations[userId] = { ...prev, stale: true, needReply: false };
    }
  }
  state.conversations = conversations;
  state.lastSyncAt = Date.now();
  await Storage.setChatFollowState(state);

  // （AI客服并入消息台后，不再自动把通知对话塞进展获客清单——通知只喂线索池，由 collectLikers 统一采集）

  // 返回会话列表（待回复优先，其次最近回复过的）
  const list = Object.entries(conversations)
    .map(([userId, c]) => ({ userId, ...c }))
    .sort((a, b) => {
      if (a.needReply !== b.needReply) return a.needReply ? -1 : 1;
      return (b.lastReplyAt || 0) - (a.lastReplyAt || 0);
    });
  return { conversations: list, syncedAt: state.lastSyncAt };
}

/* ─── 评论跟进：AI 生成回复（渲染提示词 + 知识库注入 + 解析 JSON） ─── */
// ★ 礼貌性结束语识别：对方最新消息只是“谢谢/感谢/好的/收到”这类收尾话术 → 无需回复
//   纯收尾话术都很短（去标点后 ≤6 字），“好的，那我也去买来试试”“谢谢。我贷款68万30年”这类带实质内容的不受影响
const CHAT_FOLLOW_ENDING_WORDS = ['谢谢', '感谢', '多谢', '感恩', '辛苦', '好的', '好哒', '好嘞', '好滴', '收到', '嗯嗯', '嗯呐', '嗯', '好', 'okk', 'ok', 'thank', '感谢感谢', '谢谢谢谢', '感恩感恩'];
function isChatFollowEnding(text) {
  if (!text || !text.trim()) return false;
  const t = text.trim()
    .replace(/[\s~～!！?？。.、，,；;：:'"“”‘’]+/g, '')
    .replace(/[\p{Extended_Pictographic}]/gu, '')
    .toLowerCase();
  if (!t || t.length > 6) return false;
  // 去掉语气/人称后缀（谢谢啊/辛苦你了）与程度前缀（非常感谢/真的谢谢）后再查词表
  const core = t.replace(/(你|您|啊|呀|啦|了|哦|呢|哟|吧|嘛|哈|呐)+$/g, '').replace(/^(非常|真的|真|太|特别|挺|超级|万分)/, '');
  if (CHAT_FOLLOW_ENDING_WORDS.includes(core)) return true;
  // 确认类组合：好的收到 / 嗯嗯 / 好的好的
  if (/^(好的|好哒|好嘞|好滴|好|嗯嗯|嗯呐|嗯|收到)(好的|好哒|好嘞|好滴|好|嗯嗯|嗯呐|嗯|收到)*$/.test(t)) return true;
  // 感谢类带宾语：谢谢你的回答 / 感谢您的帮助
  if (/^(谢谢|感谢|多谢|感恩|辛苦)(你|您)?的?(回答|解答|帮助|回复|建议|推荐)?$/.test(t)) return true;
  return false;
}

async function handleChatFollowReply(data) {
  const config = await Storage.getConfig();
  if (!config.ai.apiKey && !config.ai.fallbackApiKey) {
    throw new Error('未配置 API Key，请先在设置页面填写');
  }
  const userId = data.userId;
  const state = await Storage.getChatFollowState();
  const conv = (state.conversations || {})[userId];
  if (!conv) throw new Error('未找到该用户的会话，请先同步通知页');
  if (!conv.needReply || conv.pendingIdx < 0) {
    return { action: 'noop', reply: '', reason: '该会话最新一条已回复过，无需回复' };
  }

  // ★ 礼貌性结束语拦截：对方最新消息只是“谢谢/好的/收到”这类收尾话术 → 直接判定不回复，不消耗 AI 调用
  if (isChatFollowEnding(conv.pendingIncoming)) {
    return { ok: true, action: 'noop', reply: '', ending: true, reason: '礼貌性结束语（谢谢/收到类），无需回复' };
  }

  // ★ 组装对话上下文（旧→新），这是“消息整理”的最终产物，直接喂给 AI
  //   三种角色：user＝对方消息；assistant＝我发出的回复；context＝对方回复的对象（我的评论或我此前的回复）
  const historyLines = conv.history.map((m, i) => {
    const who = m.role === 'user' ? (conv.userName || '对方')
      : (m.role === 'context' ? '我（博主此前的评论/回复）' : '我（博主的回复）');
    return `${i + 1}. ${who}：${m.content}`;
  });
  const goalRules = buildGoalRules(config);
  const context = {
    user_name: conv.userName || '对方',
    conversation_history: historyLines.join('\n'),
    latest_message: conv.pendingIncoming,
    // 知识库检索用（当前要回复的评论为最高权重）
    comment_content: conv.pendingIncoming,
    note_title: '通知页评论跟进',
    // 产品相关
    product_name: config.product.name || '我的产品',
    product_guide: (config.product.guideText || '').trim()
      || '无（不引流：禁止引导对方去任何小程序/App/公众号/个人主页等平台，也不要出现“点我头像”“去搜”这类话；只自然分享价值，讲完就收）',
    product_description: (typeof Edition !== 'undefined' && !Edition.hasFeature('productLib')) ? '' : (config.product.description || ''),
    promo_goal_name: goalRules.goalName,
    warmup_turns: '2', // 前 2 轮只闲聊，第 3 轮起才允许判断销售时机
    sold_flag: conv.sold
      ? '⚠️ 该用户此前已销售成功（sold=true），本轮及以后永远禁止再推销，只正常闲聊维护关系（action 只能是 chat 或 noop）'
      : '当前尚未向该用户推销过；若轮次足够且对方出现明确销售信号，可以 sell',
  };

  let promptTemplate = await Storage.getPrompt('chat_follow');
  if (!promptTemplate) promptTemplate = DEFAULT_PROMPTS.chat_follow;

  // 知识库注入（受 knowledge 版本开关闸门控制）
  let kbContext = '';
  const kbEnabled = typeof Edition === 'undefined' || Edition.hasFeature('knowledge');
  if (kbEnabled) {
    const knowledgeBase = (await Storage.getKnowledgeBase()) || [];
    const roleKeywords = config.roleKeywords || {};
    const kbResult = KnowledgeSearch.searchKnowledgeBase(knowledgeBase, context, roleKeywords);
    if (kbResult) kbContext = kbResult.text;
  }

  const { systemPrompt, userPrompt } = PromptRenderer.renderPrompt(promptTemplate, context, kbContext);
  console.log('[小红书助手] chatFollowReply — 用户:', conv.userName, '| 待回复:', conv.pendingIncoming);

  // 调用 AI（对话回复输出短，重试一次兜底网络抖动）
  const aiCfg = { ...config.ai, maxTokens: Math.max(config.ai.maxTokens || 4096, 2048) };
  let content = '';
  let usage = {};
  let parsed = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await AiClient.chatCompletion(aiCfg, systemPrompt, userPrompt);
      content = r.content;
      usage = r.usage || {};
      parsed = Utils.extractJson(content);
      if (parsed) break;
      console.warn(`[小红书助手] chatFollowReply 返回无法解析（第 ${attempt} 次）。原始回复: ${String(content || '').slice(0, 200)}`);
    } catch (err) {
      console.warn(`[小红书助手] chatFollowReply AI 调用异常（第 ${attempt} 次）：${err.message}`);
      if (attempt >= 2) throw err;
    }
  }
  if (!parsed) {
    const parseErr = new Error(`AI 返回格式错误，无法解析 JSON。原始回复：${String(content || '').slice(0, 200)}`);
    parseErr.aiRaw = String(content || '');
    throw parseErr;
  }

  const reply = String(parsed.reply || '').trim();
  if (!reply) throw new Error('AI 未生成回复内容');

  // 小红书评论 300 字硬截断（与 content.js sendReplyToComment 同口径）
  const XHS_MAX_LEN = 300;
  let finalReply = reply;
  if (finalReply.length > XHS_MAX_LEN) {
    let cut = finalReply.slice(0, XHS_MAX_LEN);
    const lastPunc = Math.max(
      cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('~'),
      cut.lastIndexOf('～'), cut.lastIndexOf('!'), cut.lastIndexOf('？'), cut.lastIndexOf('?')
    );
    if (lastPunc >= XHS_MAX_LEN - 60) cut = cut.slice(0, lastPunc + 1);
    finalReply = cut;
  }

  await Storage.addAiLog({
    scene: 'chat_follow',
    tokensIn: usage.prompt_tokens || 0,
    tokensOut: usage.completion_tokens || 0,
    success: true,
    action: parsed.action || 'chat',
    userName: conv.userName,
  });

  return {
    action: parsed.action || 'chat',
    reason: parsed.reason || '',
    reply: finalReply,
    pendingIdx: conv.pendingIdx,
    prompts: { system: systemPrompt, user: userPrompt }, // 给AI的完整提示词（调试日志用）
  };
}

/* ─── 评论跟进：发送成功回执 → 更新会话落库 ───
 * 发送成功后立即把回复追加进 history、清空待回复定位，
 * 保证即使页面还没刷新出 quote-info，下次同步也不会重复回复同一条
 */
async function handleChatFollowMarkSent(data) {
  const userId = data.userId;
  const replyText = data.replyText;
  const state = await Storage.getChatFollowState();
  const conv = (state.conversations || {})[userId];
  if (!conv) return { ok: true };
  const repliedIncoming = conv.pendingIncoming; // 先保存再清空，防重复判断要用
  if (replyText && replyText.trim()) {
    conv.history.push({ role: 'assistant', content: replyText });
    conv.turnCount = conv.history.filter(m => m.role === 'user').length;
    // 追加回复历史（独立日志，跨同步保留；手动跳过/AI 判定不回复时不记录）
    try {
      await Storage.addChatFollowReplyHistory({
        userId,
        userName: conv.userName || '',
        repliedIncoming: repliedIncoming || data.lastRepliedIncoming || '',
        replyText,
        at: Date.now(),
      });
    } catch (_) {}
  }
  conv.needReply = false;
  conv.pendingIdx = -1;
  conv.pendingIncoming = '';
  conv.lastRepliedIncoming = data.lastRepliedIncoming || repliedIncoming || ''; // 记住回复的是哪条，防重复
  conv.lastReplyAt = Date.now();
  conv.stale = false;
  await Storage.setChatFollowState(state);
  return { ok: true };
}

/* ─── 评论跟进：回复历史（供 popup 查看）─── */
async function handleChatFollowGetReplyHistory() {
  const list = await Storage.getChatFollowReplyHistory();
  return { ok: true, list };
}

/* ─── 获客清单：添加候选人（判重 userId） ─── */
async function handleAddProspect(data) {
  const person = {
    userId: data.userId || '',
    nickname: data.nickname || '',
    source: data.source || {},
    keywordHit: data.keywordHit || null,
    dmStatus: data.dmStatus || 'pending',
    dmCount: data.dmCount || 0,
    lastDmAt: data.lastDmAt || null,
    isLiker: !!data.isLiker,
    likedComment: data.likedComment || '',
    origin: data.origin || '',
  };
  if (!person.userId && !person.nickname) throw new Error('缺少候选人信息');
  const result = await Storage.addProspect(person);
  return { ok: true, added: result.added, person: result.person };
}

/* ─── 获客清单：获取列表（支持筛选） ─── */
async function handleGetProspectList(data) {
  let list = await Storage.getProspectList();
  const f = (data && data.filter) || {};
  if (f.keyword) {
    const kw = String(f.keyword).toLowerCase();
    list = list.filter(p => (p.nickname || '').toLowerCase().includes(kw));
  }
  if (f.tag) {
    const tag = String(f.tag);
    list = list.filter(p => (p.profile && p.profile.tags || []).includes(tag));
  }
  if (f.intent) {
    list = list.filter(p => p.profile && p.profile.intentLevel === f.intent);
  }
  if (f.dmStatus) {
    list = list.filter(p => p.dmStatus === f.dmStatus);
  }
  // 聚合所有标签（供下拉筛选）
  const allTags = [];
  const tagSet = new Set();
  for (const p of await Storage.getProspectList()) {
    for (const t of ((p.profile && p.profile.tags) || [])) {
      if (!tagSet.has(t)) { tagSet.add(t); allTags.push(t); }
    }
  }
  return { ok: true, list, allTags, total: (await Storage.getProspectList()).length };
}

/* ─── 获客清单：更新候选人 ─── */
async function handleUpdateProspect(data) {
  if (!data.id) throw new Error('缺少候选人 id');
  const person = await Storage.updateProspect(data.id, data.updates || {});
  if (!person) throw new Error('候选人不存在');
  return { ok: true, person };
}

/* ─── 获客清单：删除候选人 ─── */
async function handleDeleteProspect(data) {
  return await Storage.deleteProspect(data.id);
}

/* ─── 获客清单：批量画像（prospect_profiler） ─── */
async function handleProfileProspects(data) {
  const config = await Storage.getConfig();
  if (!config.ai.apiKey && !config.ai.fallbackApiKey) throw new Error('未配置 API Key，请先在设置页面填写');
  const candidates = (data.candidates || []).filter(c => c && c.userId && c.nickname);
  if (candidates.length === 0) throw new Error('没有待画像的候选人');

  let promptTemplate = await Storage.getPrompt('prospect_profiler');
  if (!promptTemplate) promptTemplate = DEFAULT_PROMPTS.prospect_profiler;

  const commentsText = candidates.map(c => `${c.userId}｜昵称：${c.nickname}｜评论：${(c.source && c.source.comment) || ''}`).join('\n');
  const context = {
    note_title: (candidates[0].source && candidates[0].source.noteTitle) || '来源笔记',
    comments_text: commentsText,
    comment_count: String(candidates.length),
  };
  const { systemPrompt, userPrompt } = PromptRenderer.renderPrompt(promptTemplate, context, '');

  const aiCfg = { ...config.ai, maxTokens: Math.max(config.ai.maxTokens || 4096, 4096) };
  let content = '';
  let usage = {};
  let parsed = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await AiClient.chatCompletion(aiCfg, systemPrompt, userPrompt);
      content = r.content;
      usage = r.usage || {};
      parsed = Utils.extractJson(content);
      if (parsed) break;
    } catch (err) {
      if (attempt >= 3) throw err;
    }
  }
  if (!parsed) throw new Error('AI 画像返回无法解析为 JSON');

  const profiles = Array.isArray(parsed) ? parsed : (parsed.profiles || []);
  const applied = [];
  for (const c of candidates) {
    const prof = profiles.find(p => p && (String(p.userId) === String(c.userId) || String(p.userId) === String(c.id)));
    if (!prof) continue;
    await Storage.updateProspect(c.id, {
      profile: {
        tags: Array.isArray(prof.tags) ? prof.tags : [],
        identity: prof.identity || '',
        needs: prof.needs || '',
        painPoints: prof.painPoints || '',
        intentLevel: ['high', 'medium', 'low'].includes(prof.intentLevel) ? prof.intentLevel : 'medium',
        dmAngle: prof.dmAngle || '',
      },
    });
    applied.push({ id: c.id, nickname: c.nickname, profile: prof });
  }
  await Storage.addAiLog({
    scene: 'prospect_profiler',
    tokensIn: usage.prompt_tokens || 0,
    tokensOut: usage.completion_tokens || 0,
    success: true,
    candidateCount: candidates.length,
    appliedCount: applied.length,
  });
  return { ok: true, applied, total: candidates.length, prompts: { system: systemPrompt, user: userPrompt } };
}

/* ─── 获客清单：客户状态分类（chat/可发资料/售后/沉睡）+ 对"继续聊"生成跟进用语 ─── */
async function handleClassifyCustomers(data) {
  const config = await Storage.getConfig();
  if (!config.ai.apiKey && !config.ai.fallbackApiKey) throw new Error('未配置 API Key，请先在设置页面填写');
  const blockedDay = (config.customer && config.customer.dormantDays) || 14;
  const candidates = (data.candidates || []).filter(c => c && c.id && c.nickname);
  if (candidates.length === 0) throw new Error('没有待分析的候选人');
  const now = Date.now();

  // ★ 先按"用户自定义沉睡标准"预判：发过但超过 dormantDays 天无回复 → 直接标沉睡，不再问 AI
  const preDormant = new Set();
  for (const c of candidates) {
    const last = c.lastDmAt || 0;
    if (c.dmStatus === 'sent' || c.dmStatus === 'replied') {
      if (last && (now - last) > blockedDay * 86400000) preDormant.add(c.id);
    }
  }

  // 送入 AI 分类的候选（把预判沉睡的也带上 context；预判沉睡的强制 dormant）
  const candidatesText = candidates.map(function (c) {
    const p = c.profile || {};
    return [c.id, c.nickname,
      '意向=' + (p.intentLevel || ''), '需求=' + (p.needs || ''), '痛点=' + (p.painPoints || ''),
      '标签=' + (Array.isArray(p.tags) ? p.tags.join('、') : ''),
      '评论=' + ((c.source && c.source.comment) || '').slice(0, 120),
      '笔记=' + ((c.source && c.source.noteTitle) || ''),
      '状态=' + (c.dmStatus || ''), '最近联系=' + (c.lastDmAt ? new Date(c.lastDmAt).toISOString().slice(0, 10) : '无')
    ].join(' | ');
  }).join('\n');

  let promptTemplate = await Storage.getPrompt('customer_status');
  if (!promptTemplate) promptTemplate = DEFAULT_PROMPTS.customer_status;
  const context = { candidates_text: candidatesText, dormant_days: String(blockedDay) };
  const { systemPrompt, userPrompt } = PromptRenderer.renderPrompt(promptTemplate, context, '');

  const aiCfg = { ...config.ai, maxTokens: Math.max(config.ai.maxTokens || 4096, 4096) };
  let content = '', usage = {}, parsed = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await AiClient.chatCompletion(aiCfg, systemPrompt, userPrompt);
      content = r.content; usage = r.usage || {}; parsed = Utils.extractJson(content);
      if (parsed) break;
    } catch (err) { if (attempt >= 2) throw err; }
  }
  if (!parsed) throw new Error('AI 状态分类返回无法解析为 JSON');
  const arr = Array.isArray(parsed) ? parsed : (parsed.results || []);

  const applied = [];
  for (const c of candidates) {
    let status = 'chat', intent = '', reason = '', chatLine = '';
    if (preDormant.has(c.id)) {
      status = 'dormant'; reason = '超过沉睡天数(' + blockedDay + '天)未联系/无回复（用户自定义标准）';
    } else {
      const r = arr.find(x => String(x.userId) === String(c.id) || (x.userId && String(x.userId) === String(c.userId)));
      if (r) { status = r.status || 'chat'; intent = r.intent || ''; reason = r.reason || ''; chatLine = r.chat_line || ''; }
    }
    await Storage.updateProspect(c.id, {
      customerStatus: status,
      customerIntent: intent || undefined,
      customerReason: reason || undefined,
      customerChatLine: chatLine || undefined,
      customerClassifiedAt: now,
    });
    applied.push({ id: c.id, nickname: c.nickname, status, intent, reason, chatLine });
  }
  await Storage.addAiLog({
    scene: 'customer_status', tokensIn: usage.prompt_tokens || 0, tokensOut: usage.completion_tokens || 0,
    success: true, candidateCount: candidates.length, appliedCount: applied.length,
  });
  return { ok: true, applied, dormantDays: blockedDay, prompts: { system: systemPrompt, user: userPrompt } };
}

/* ─── 获客清单：批量收集通知页互动人群（点赞/收藏/回复/关注），按信号类型打标入库 ─── */
async function handleCollectLikers(data) {
  const items = (data && data.items) || [];
  if (!items.length) return { ok: true, added: 0, already: 0, total: 0 };
  const now = Date.now();
  let added = 0, already = 0;
  for (const it of items) {
    if (!it.userId && !it.userName) continue;
    // ★ 信号类型：点赞/收藏 → 线索；回复我们的评论 → 积极互动→商机；关注 → 线索
    const type = it.signalType || '点赞';
    const isReply = type === '回复';
    const stageEntry = isReply ? '回复' : (type === '关注' ? '关注' : '点赞');
    const r = await Storage.addProspect({
      userId: it.userId || '',
      nickname: it.userName || '未知用户',
      source: { noteTitle: it.likedNote || '', noteUrl: it.userLink || '', comment: it.likedComment || '', userUrl: it.userLink || '', stageEntry, signalType: type, signalText: it.likedComment || '' },
      dmStatus: 'pending',
      isLiker: !isReply,            // 回复算积极互动（非"点赞户"）；其余互动仍标线索户
      likedComment: it.likedComment || '',
      origin: '互动',
      keywordHit: '__' + type + '__',
    });
    if (r.added) added++; else already++;
  }
  return { ok: true, added, already, total: items.length, ts: now };
}

/* ─── 获客·消息台：驱动 /chat 页读取会话列表 / 跳到指定会话 ─── */
async function _chatTab() {
  let tab = null;
  try { const tabs = await chrome.tabs.query({ url: ['*://*.xiaohongshu.com/*', '*://www.xiaohongshu.com/*'] }); tab = tabs[0]; } catch (_) {}
  if (!tab) throw new Error('未找到小红书标签页，请先打开小红书网页版');
  return { tab };
}
function _chatUrlFor(convId) { return 'https://www.xiaohongshu.com/chat/' + String(convId || ''); }

/* 读消息中心会话列表（导航到 /chat 再采集；返回与获客清单按昵称预匹配的结果） */
async function handleGetChatConversations(data) {
  const { tab } = await _chatTab();
  try { await chrome.tabs.update(tab.id, { url: 'https://www.xiaohongshu.com/chat', active: true }); await waitTabLoadBg(tab.id, 15000); } catch (_) {}
  try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }); } catch (_) {}
  await _sleepBg(700);
  let res = null;
  try { res = await sendTabMsg(tab.id, { action: 'collectChatConversations' }, 15000); } catch (e) { res = { success: false, error: e.message }; }
  if (!res || !res.success) throw new Error((res && res.error) || '读取消息中心失败');
  // 按昵称与获客清单预匹配（精确优先）
  const list = await Storage.getProspectList();
  const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
  const items = (res.items || []).map((c) => {
    const byConv = list.find(p => p.convId && p.convId === c.convId);
    const byName = byConv ? null : list.find(p => norm(p.nickname) === norm(c.partnerName));
    const hit = byConv || byName;
    return { ...c, matched: !!hit, personId: hit ? hit.id : '', stage: hit ? (hit.stage || 'lead') : '', status: hit ? (hit.status || '') : '' };
  });
  return { ok: true, items, total: items.length };
}

/* 跳到指定会话 (/chat/{convId}) */
async function handleOpenChat(data) {
  const convId = data && data.convId;
  if (!convId) throw new Error('缺少会话 id');
  const { tab } = await _chatTab();
  try { await chrome.tabs.update(tab.id, { url: _chatUrlFor(convId), active: true }); await waitTabLoadBg(tab.id, 15000); } catch (err) { throw new Error('打开会话失败：' + (err && err.message ? err.message : err)); }
  // 若带商机 → 记录 convId + 视为已联系(升商机)
  if (data && data.personId) {
    await Storage.updateProspect(data.personId, { convId }).catch(() => {});
    await handleMarkContacted({ id: data.personId }).catch(() => {});
  }
  return { ok: true, opened: true, chatUrl: _chatUrlFor(convId) };
}

/* 在 /chat 会话页发送消息（导航→注入→发送），命中商机联系即升格；未收录的按昵称收录为商机 */
async function handleChatSend(data) {
  const convId = data && data.convId;
  const text = data && data.text;
  if (!convId) throw new Error('缺少会话 id');
  if (!text) throw new Error('缺少消息内容');
  const { tab } = await _chatTab();
  try { await chrome.tabs.update(tab.id, { url: _chatUrlFor(convId), active: true }); await waitTabLoadBg(tab.id, 15000); } catch (err) { throw new Error('打开会话失败：' + (err && err.message ? err.message : err)); }
  try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }); } catch (_) {}
  await _sleepBg(1200);
  let res = null;
  try { res = await sendTabMsg(tab.id, { action: 'chatSendMessage', text }, 30000); } catch (e) { res = { success: false, error: e.message }; }
  if (!res || !res.success) return { ok: false, error: (res && res.error) || '发送失败', limited: !!(res && res.limited) };

  // 发送成功：命中商机 → 记录 convId + 联系即升格；未收录 → 按昵称收录为商机
  const personId = data && data.personId;
  if (personId) {
    await Storage.updateProspect(personId, { convId }).catch(() => {});
    await handleMarkContacted({ id: personId }).catch(() => {});
  } else if (data && data.partnerName) {
    await Storage.addProspect({ userId: '', nickname: data.partnerName, source: { noteUrl: _chatUrlFor(convId), noteTitle: '消息中心', comment: '', stageEntry: '消息' }, stage: 'prospect', convId }).catch(() => {});
  }
  return { ok: true, via: res.via, sent: true };
}

/* ─── 获客清单：驱动通知页收集"赞了我们内容/评论"的人，并全部写入清单 ─── */
async function handleCollectLikersFromNotif(data) {
  let tab = null;
  try {
    const tabs = await chrome.tabs.query({ url: ['*://*.xiaohongshu.com/*', '*://www.xiaohongshu.com/*'] });
    tab = tabs[0];
  } catch (_) {}
  if (!tab) throw new Error('未找到小红书标签页，请先打开小红书网页版');
  // 若非通知页，先导航到通知页
  try {
    const cur = (await chrome.tabs.get(tab.id)).url || '';
    if (!/\/notification/.test(cur)) {
      await chrome.tabs.update(tab.id, { url: 'https://www.xiaohongshu.com/notification', active: true });
      await waitTabLoadBg(tab.id, 15000);
    } else {
      await chrome.tabs.update(tab.id, { active: true });
    }
  } catch (_) {}
  try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }); } catch (_) {}
  await _sleepBg(800);

  let res = null;
  try { res = await sendTabMsg(tab.id, { action: 'collectLikers' }, 20000); } catch (e) { res = { success: false, error: e.message }; }
  if (!res || !res.success) {
    throw new Error((res && res.error) || '通知页未返回点赞数据');
  }
  // 复用 handleCollectLikers 把点赞户写入清单
  return await handleCollectLikers({ items: res.items || [] });
}

/* ─── 获客清单：AI 筛选入库（不靠关键词，从评论区筛出值得跟进的人） ─── */
async function handleAiScreenCapture(data) {
  const config = await Storage.getConfig();
  if (!config.ai.apiKey && !config.ai.fallbackApiKey) throw new Error('未配置 API Key，请先在设置页面填写');
  const comments = (data && data.comments) || [];
  if (!comments.length) throw new Error('没有可用评论');
  const productHint = (data && data.productHint) || (config.product && config.product.name) || '我们的产品领域';

  let promptTemplate = await Storage.getPrompt('prospect_capture');
  if (!promptTemplate) promptTemplate = DEFAULT_PROMPTS.prospect_capture;
  const commentsText = comments.map(c => `${c.idx}｜${c.author || '?'}：${String(c.content || '').slice(0, 80)}`).join('\n');
  const context = { comments_text: commentsText, product_hint: String(productHint).slice(0, 60) };
  const { systemPrompt, userPrompt } = PromptRenderer.renderPrompt(promptTemplate, context, '');

  const aiCfg = { ...config.ai, maxTokens: Math.max(config.ai.maxTokens || 4096, 1500) };
  let parsed = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { const r = await AiClient.chatCompletion(aiCfg, systemPrompt, userPrompt); parsed = Utils.extractJson(r.content); if (parsed) break; }
    catch (err) { if (attempt >= 2) throw err; }
  }
  if (!parsed) throw new Error('AI 筛选返回无法解析');
  const arr = Array.isArray(parsed) ? parsed : (parsed.results || []);
  const idxSet = {};
  arr.forEach(x => { const v = parseInt(x && (x.index !== undefined ? x.index : x.idx), 10); if (!isNaN(v)) { idxSet[v] = { index: v, why: (x && x.why) || '' }; } });
  const picked = comments.filter(c => idxSet[c.idx]).map(c => ({ ...c, why: (idxSet[c.idx] && idxSet[c.idx].why) || '' }));
  return { ok: true, picked, total: picked.length, prompts: { system: systemPrompt, user: userPrompt } };
}

/* ─── 获客清单：生成私信话术（prospect_dm） ─── */
async function handleGenerateDm(data) {
  const config = await Storage.getConfig();
  if (!config.ai.apiKey && !config.ai.fallbackApiKey) throw new Error('未配置 API Key，请先在设置页面填写');
  const person = data.person;
  if (!person) throw new Error('缺少候选人信息');
  const profile = person.profile || {};

  let promptTemplate = await Storage.getPrompt('prospect_dm');
  if (!promptTemplate) promptTemplate = DEFAULT_PROMPTS.prospect_dm;

  // 知识库注入
  let kbContext = '';
  const kbEnabled = typeof Edition === 'undefined' || Edition.hasFeature('knowledge');
  if (kbEnabled) {
    const knowledgeBase = (await Storage.getKnowledgeBase()) || [];
    const context = {
      comment_content: (person.source && person.source.comment) || '',
      note_title: (person.source && person.source.noteTitle) || '',
      comment_author: person.nickname || '',
    };
    const kbResult = KnowledgeSearch.searchKnowledgeBase(knowledgeBase, context, config.roleKeywords || {});
    if (kbResult) kbContext = kbResult.text;
  }

  const context = {
    nickname: person.nickname || '对方',
    tags: Array.isArray(profile.tags) ? profile.tags.join('、') : '',
    needs: profile.needs || '',
    painPoints: profile.painPoints || '',
    dmAngle: profile.dmAngle || '',
    comment_text: (person.source && person.source.comment) || '',
    note_title: (person.source && person.source.noteTitle) || '',
    kb_context: kbContext || '（无）',
  };
  const { systemPrompt, userPrompt } = PromptRenderer.renderPrompt(promptTemplate, context, kbContext);

  const aiCfg = { ...config.ai, maxTokens: Math.max(config.ai.maxTokens || 4096, 1024) };
  let content = '';
  let usage = {};
  let parsed = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await AiClient.chatCompletion(aiCfg, systemPrompt, userPrompt);
      content = r.content;
      usage = r.usage || {};
      parsed = Utils.extractJson(content);
      if (parsed) break;
    } catch (err) {
      if (attempt >= 2) throw err;
    }
  }
  if (!parsed) throw new Error('AI 话术返回无法解析为 JSON');
  const dmText = String(parsed.dm_text || parsed.text || '').trim();
  if (!dmText) throw new Error('AI 未生成话术内容');

  await Storage.addAiLog({
    scene: 'prospect_dm',
    tokensIn: usage.prompt_tokens || 0,
    tokensOut: usage.completion_tokens || 0,
    success: true,
    nickname: person.nickname,
  });
  return { ok: true, dmText, prompts: { system: systemPrompt, user: userPrompt } };
}

/* ─── 获客清单：AI 判断销售时机（决定是否现在发统一话术联系对方） ─── */
async function handleJudgeSaleTiming(data) {
  const config = await Storage.getConfig();
  if (!config.ai.apiKey && !config.ai.fallbackApiKey) throw new Error('未配置 API Key，请先在设置页面填写');
  const person = data.person;
  if (!person) throw new Error('缺少候选人信息');
  const profile = person.profile || {};

  let promptTemplate = await Storage.getPrompt('sale_timing');
  if (!promptTemplate) promptTemplate = DEFAULT_PROMPTS.sale_timing;

  const context = {
    nickname: person.nickname || '对方',
    tags: Array.isArray(profile.tags) ? profile.tags.join('、') : '',
    needs: profile.needs || '',
    painPoints: profile.painPoints || '',
    dmAngle: profile.dmAngle || '',
    comment_text: (person.source && person.source.comment) || '',
    note_title: (person.source && person.source.noteTitle) || '',
  };
  const { systemPrompt, userPrompt } = PromptRenderer.renderPrompt(promptTemplate, context, '');

  const aiCfg = { ...config.ai, maxTokens: Math.max(config.ai.maxTokens || 4096, 600) };
  let content = '';
  let usage = {};
  let parsed = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await AiClient.chatCompletion(aiCfg, systemPrompt, userPrompt);
      content = r.content;
      usage = r.usage || {};
      parsed = Utils.extractJson(content);
      if (parsed) break;
    } catch (err) {
      if (attempt >= 2) throw err;
    }
  }
  if (!parsed) throw new Error('AI 时机判断返回无法解析为 JSON');

  await Storage.addAiLog({
    scene: 'sale_timing',
    tokensIn: usage.prompt_tokens || 0,
    tokensOut: usage.completion_tokens || 0,
    success: true,
    nickname: person.nickname,
  });
  return {
    ok: true,
    timing: parsed.timing || 'wait',
    intent: parsed.intent || (profile.intentLevel || 'medium'),
    reason: parsed.reason || '',
    suggestedAction: parsed.suggested_action || '',
    hook: parsed.hook || '',
    prompts: { system: systemPrompt, user: userPrompt },
  };
}

/* ─── 获客清单：AI 判断线索是否适合升格为商机（lead_judge） ─── */
async function handleJudgeLeadPromotion(data) {
  const config = await Storage.getConfig();
  if (!config.ai.apiKey && !config.ai.fallbackApiKey) throw new Error('未配置 API Key，请先在设置页面填写');
  const id = data && data.id;
  if (!id) throw new Error('缺少候选人 id');
  const list = await Storage.getProspectList();
  const p = list.find(x => x.id === id);
  if (!p) throw new Error('候选人不存在');

  let promptTemplate = await Storage.getPrompt('lead_judge');
  if (!promptTemplate) promptTemplate = DEFAULT_PROMPTS.lead_judge;
  const profile = p.profile || {};
  const productHint = (config.product && config.product.name) || '我们的产品领域';
  const context = {
    product_hint: String(productHint).slice(0, 40),
    nickname: p.nickname || '未知',
    entry: (p.source && p.source.stageEntry) || '',
    comment: String(((p.source && p.source.comment) || '')).slice(0, 200),
    profile_hint: (profile.needs || profile.painPoints || (profile.tags || []).join('、') || '').slice(0, 120) || '（未画像）',
  };
  const { systemPrompt, userPrompt } = PromptRenderer.renderPrompt(promptTemplate, context, '');

  const aiCfg = { ...config.ai, maxTokens: Math.max(config.ai.maxTokens || 4096, 600) };
  let content = '', usage = {}, parsed = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await AiClient.chatCompletion(aiCfg, systemPrompt, userPrompt);
      content = r.content; usage = r.usage || {}; parsed = Utils.extractJson(content);
      if (parsed) break;
    } catch (err) { if (attempt >= 2) throw err; }
  }
  if (!parsed) throw new Error('AI 判断返回无法解析为 JSON');
  const promote = parsed.promote !== false;
  // 把 AI 判断写回线索（供 UI 展示 / 下次复用）
  await Storage.updateProspect(id, { promoJudge: { ok: promote, intent: parsed.intent || '', reason: parsed.reason || '', dmAngle: parsed.dmAngle || '', at: Date.now() } }).catch(() => {});
  await Storage.addAiLog({ scene: 'lead_judge', tokensIn: usage.prompt_tokens || 0, tokensOut: usage.completion_tokens || 0, success: true, nickname: p.nickname });
  return { ok: true, promote, intent: parsed.intent || 'medium', reason: parsed.reason || '', dmAngle: parsed.dmAngle || '' };
}

/* ─── 获客清单：标记"已联系" → 线索自动升商机（只要联系了就升格；幂等） ─── */
async function handleMarkContacted(data) {
  const id = data && data.id;
  if (!id) throw new Error('缺少候选人 id');
  const list = await Storage.getProspectList();
  const p = list.find(x => x.id === id);
  if (!p) throw new Error('候选人不存在');
  if ((p.stage || 'lead') === 'prospect') return { ok: true, promoted: false };
  await Storage.updateProspect(id, { stage: 'prospect' });
  return { ok: true, promoted: true, personId: id };
}

/* ═══════════ AI客服：触达场景(A) + 客户问答话术库(B) 配置 + 应答 ═══════════ */

// 用产品配置填充话术模板里的 {变量}
function _fillCsVars(text, config, incoming) {
  const p = config.product || {};
  const sp = (Array.isArray(p.sellPoints) ? p.sellPoints.filter(s => s && (s.title || s.content)) : []).slice(0, 3);
  const spText = (s) => (s ? ((s.title || '') + (s.content ? '：' + s.content : '')) : '');
  const desc = String(p.description || '').trim();
  const v = {
    '产品': p.name || '我的产品',
    '价格': '',
    '购买入口': p.guideText || '主页/私信',
    '适用人群': '',
    '卖点1': spText(sp[0]),
    '卖点2': spText(sp[1]),
    '卖点3': spText(sp[2]),
    '一句话定位': desc ? desc.split('\n')[0].slice(0, 40) : '',
    '试用方式': '',
    '活动': '活动',
    '优惠': '优惠',
    '用户原话': String(incoming || '').slice(0, 60),
  };
  let out = String(text || '');
  for (const k in v) out = out.split('{' + k + '}').join(String(v[k] || ''));
  return out.trim();
}

async function handleGetAiCsConfig() {
  return { ok: true, config: await Storage.getAiCsConfig() };
}

async function handleSaveAiCsConfig(data) {
  const cfg = await Storage.saveAiCsConfig((data && data.partial) || {});
  return { ok: true, config: cfg };
}

async function handleImportAiCsConfig(data) {
  let parsed = data && data.json;
  if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch (_) { throw new Error('导入内容不是合法 JSON'); } }
  if (!parsed || typeof parsed !== 'object') throw new Error('导入内容格式不对');
  const partial = {};
  if (parsed.scenes && typeof parsed.scenes === 'object') partial.scenes = parsed.scenes;
  if (Array.isArray(parsed.qa)) partial.qa = parsed.qa;
  const cfg = await Storage.saveAiCsConfig(partial);
  return { ok: true, config: cfg, imported: Object.keys(partial).join(',') || '(空，无有效字段)' };
}

// 客户问答应答：①本地关键词路由 ②AI路由兜底 ③模板填变量 或 AI应答
async function handleAiCsRespond(data) {
  const config = await Storage.getConfig();
  const incoming = String((data && data.incoming) || '').trim();
  if (!incoming) throw new Error('请输入客户说的话');
  const aiCs = await Storage.getAiCsConfig();
  const qa = (aiCs.qa || []).filter(e => e && e.enabled !== false);
  if (!qa.length) throw new Error('话术库为空，请先在「AI客服」里配置问答话术');

  const body = incoming.toLowerCase();
  const catNames = qa.map(e => e.category).filter(Boolean);
  let entry = null;
  // 1) 本地关键词路由（优先非兜底分类）
  for (const e of qa) {
    if (e.category === '通用兜底') continue;
    if ((e.keywords || []).some(k => body.includes(String(k).toLowerCase()))) { entry = e; break; }
  }
  // 2) AI 路由兜底
  let category = entry ? entry.category : '';
  if (!entry && (config.ai.apiKey || config.ai.fallbackApiKey)) {
    try {
      let tpl = await Storage.getPrompt('qa_router');
      if (!tpl) tpl = DEFAULT_PROMPTS.qa_router;
      const ctx = { categories: catNames.join('、'), incoming };
      const { systemPrompt, userPrompt } = PromptRenderer.renderPrompt(tpl, ctx, '');
      const raw = await _chatAi(config, systemPrompt, userPrompt, 600);
      const parsed = Utils.extractJson(raw);
      if (parsed && parsed.category) category = String(parsed.category).trim();
      entry = qa.find(e => e.category === category);
    } catch (_) {}
  }
  if (!entry) entry = qa.find(e => e.category === '通用兜底') || qa.find(e => e.mode === 'template');
  if (!entry) throw new Error('未能归入任何分类，且没有「通用兜底」，请先在话术库配置兜底');

  let reply = '';
  if (entry.mode === 'template') reply = _fillCsVars(entry.answer, config, incoming);
  else reply = await (async () => {
    // AI 应答 + 分类知识库（只读「客服·{分类}」这一类，不混其它）
    let tpl = await Storage.getPrompt('qa_ai_responder');
    if (!tpl) tpl = DEFAULT_PROMPTS.qa_ai_responder;
    let kb = '';
    try {
      const kbBase = (await Storage.getKnowledgeBase()) || [];
      const wantCat = '客服·' + (entry.kbCategory || entry.category || '');
      const scoped = kbBase.filter(el => el.isActive !== false && el.category === wantCat);
      if (scoped.length) kb = scoped.slice(0, 12).map(el => ((el.title || '') + '：' + String(el.content || '').slice(0, 200))).join('\n');
    } catch (_) {}
    const ctx = { category: entry.category || '', incoming, kb_context: kb || '（该分类暂无知识库，只可依据你已有信息/如实说明）' };
    const { systemPrompt, userPrompt } = PromptRenderer.renderPrompt(tpl, ctx, kb);
    return await _chatAi(config, systemPrompt, userPrompt, 900);
  })();
  if (!reply) throw new Error('应答生成为空，请重试');
  return {
    ok: true, reply, category: entry.category || '',
    mode: entry.mode || 'template',
    auto: entry.auto === 'auto' ? 'auto' : (entry.auto === 'confirm' ? 'confirm' : (entry.auto === 'off' ? 'off' : 'draft')),
  };
}

// 把 AI客服 问答话术库按「客服·{分类}」同步进知识库（去重；AI 应答只读对应分类）
async function handleQaToKb(data) {
  const aiCs = await Storage.getAiCsConfig();
  const kb = await Storage.getKnowledgeBase();
  const qa = (aiCs.qa || []).filter(e => String(e.answer || '').trim());
  let added = 0;
  for (const e of qa) {
    const cat = '客服·' + (e.category || '通用');
    const title = cat + '·' + (e.category || '') + '话术';
    const dup = kb.some(k => k.category === cat && String(k.title || '') === title);
    if (dup) continue;
    await Storage.addKnowledgeEntry({ title, category: cat, content: String(e.answer || '').trim(), role: '', tags: [], isActive: true });
    added++;
  }
  return { ok: true, added, total: qa.length };
}

const AI_CS_PURPOSE_TEXT = { sell: '卖货转化', brand: '品牌信任', profile: '主页涨粉', likes: '互动养数据', trend: '蹭热点', auto: '综合自动' };

// 触达场景 A 话术生成（模板优先，否则 AI 按场景配置生成）
async function handleAiCsTouch(data) {
  const config = await Storage.getConfig();
  const aiCs = await Storage.getAiCsConfig();
  const key = String((data && data.key) || '');
  if (!key || !aiCs.scenes[key]) throw new Error('未知触达场景：' + key);
  const s = aiCs.scenes[key];
  if (s.enabled === false) throw new Error('场景「' + s.name + '」未启用，请先在 AI客服 打开');
  const ctx = (data && data.context) || '';
  const nickname = String(((data && data.person) || {}).nickname || '').trim();
  const incoming = String(((data && data.person) || {}).source && ((data && data.person).source.comment) || ctx || '').trim();

  // 固定模板优先（模板模式直接填变量）
  if (s.template) {
    const tpl = await Storage.getPrompt('scen_touch'); // 仅占位，模板不走 AI
    return { ok: true, draft: _fillCsVars(s.template, config, incoming), scene: s.name, mode: 'template' };
  }

  // AI 生成
  let tpl = await Storage.getPrompt(s.promptScene) || await Storage.getPrompt('scen_touch');
  if (!tpl) tpl = DEFAULT_PROMPTS.scen_touch;
  let kb = '';
  if (s.useKb !== false) {
    try {
      const kbBase = (await Storage.getKnowledgeBase()) || [];
      const kbR = KnowledgeSearch.searchKnowledgeBase(kbBase, { comment_content: incoming, note_title: '', comment_author: nickname }, config.roleKeywords || {});
      if (kbR) kb = kbR.text || '';
    } catch (_) {}
  }
  const c2 = await Storage.getConfig();
  const purp = c2.product && c2.product.promoGoal ? '' : ''; // 保留空，用场景 purpose
  const ctxt = {
    scene_name: s.name,
    purpose_text: AI_CS_PURPOSE_TEXT[s.purpose] || s.purpose || '综合自动',
    min_chars: String(s.minChars || 20),
    max_chars: String(s.maxChars || 120),
    tone: s.toneMannerisms || ((c2.scriptStyle && c2.scriptStyle.toneMannerisms) || '自然口语化'),
    guidance: s.guidance || (c2.product && c2.product.guideText) || '',
    nickname: nickname || '对方',
    comment: incoming.slice(0, 200) || '（空）',
    kb_context: kb || '（无）',
  };
  const { systemPrompt, userPrompt } = PromptRenderer.renderPrompt(tpl, ctxt, kb);
  const reply = await _chatAi(config, systemPrompt, userPrompt, (s.maxChars || 120) + 200);
  await Storage.addAiLog({ scene: 'scen_' + key, tokensIn: 0, tokensOut: 0, success: true });
  return { ok: true, draft: reply, scene: s.name, mode: 'ai', auto: s.mode === 'auto' ? 'auto' : 'draft' };
}

// ★ 自动量控：返回 { ok, left }，超限返回 ok=false（用于 auto 模式触达/回访前拦截）
async function aiCsDailyAllowed(sceneKey, dailyMax) {
  const key = 'ai_cs_daily';
  const today = new Date().toISOString().slice(0, 10);
  let data = {};
  try { data = (await chrome.storage.local.get(key))[key] || {}; } catch (_) {}
  const cur = (data[today] || {}) || {};
  const used = cur[sceneKey] || 0;
  const max = Number(dailyMax) || 0;
  if (max > 0 && used >= max) return { ok: false, used, max };
  return { ok: true, left: max > 0 ? max - used : Infinity, used, max };
}
async function aiCsBump(sceneKey) {
  const key = 'ai_cs_daily'; const today = new Date().toISOString().slice(0, 10);
  let data = {};
  try { data = (await chrome.storage.local.get(key))[key] || {}; } catch (_) {}
  data[today] = data[today] || {}; data[today][sceneKey] = (data[today][sceneKey] || 0) + 1;
  try { await chrome.storage.local.set({ [key]: data }); } catch (_) {}
}

// ★ 通知回访：枚举通知页待回复（有人回了你评论/笔记），供「通知回访」场景草拟/发送
async function _notifTab() {
  let tab = null;
  try { const tabs = await chrome.tabs.query({ url: ['*://*.xiaohongshu.com/*', '*://www.xiaohongshu.com/*'] }); tab = tabs[0]; } catch (_) {}
  if (!tab) throw new Error('未找到小红书标签页，请先打开小红书网页版');
  return tab;
}
async function handleGetPendingNotifs(data) {
  const tab = await _notifTab();
  try { await chrome.tabs.update(tab.id, { url: 'https://www.xiaohongshu.com/notification', active: true }); /* 若已在此页不必强刷 */ } catch (_) {}
  try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }); } catch (_) {}
  await _sleepBg(900);
  let res = null;
  try { res = await sendTabMsg(tab.id, { action: 'extractNotifications' }, 15000); } catch (e) { res = { success: false, error: e.message }; }
  if (!res || !res.success) throw new Error((res && res.error) || '读取通知失败');
  const items = (res.items || []).filter(it => it && String(it.incoming || '').trim());
  return { ok: true, items, total: items.length };
}
// 通知回访发送：按 idx 精确定位通知楼回复（三重定位防回错，见 content.replyNotification）
async function handleSendNotifReply(data) {
  const tab = await _notifTab();
  const { idx, replyText, userId, userName, latestText } = data || {};
  if (idx == null || !replyText) throw new Error('参数不完整');
  // 量控：按 notif_reply 场景每日上限，超限拦截
  try {
    const aiCs = await Storage.getAiCsConfig();
    const sc = (aiCs.scenes && aiCs.scenes.notif_reply) || { schedule: { dailyMax: 0 } };
    const chk = await aiCsDailyAllowed('notif_reply', (sc.schedule && sc.schedule.dailyMax) || 0);
    if (!chk.ok) return { ok: false, error: '「通知回访」当日已达上限（' + chk.max + '），已拦截。请到 AI客服 调上限或明天再自动回访。' };
  } catch (_) {}
  try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }); } catch (_) {}
  await _sleepBg(400);
  let res = null;
  try { res = await sendTabMsg(tab.id, { action: 'replyNotification', data: { idx, replyText, userId, userName: userName || '', latestText: latestText || '' } }, 30000); }
  catch (e) { res = { success: false, error: e.message }; }
  if (!res || !res.success) return { ok: false, error: (res && res.error) || '发送失败' };
  await aiCsBump('notif_reply').catch(() => {});
  return { ok: true, sent: true };
}

/* ─── 获客清单：发送私信（驱动 content.js 打开主页→点私信→发送） ─── */
async function handleSendDm(data) {
  const person = data.person;
  const text = data.text;
  if (!person || !text) throw new Error('缺少发送参数');
  const userLink = absUserUrlBg((person.source && person.source.userUrl) || (person.userLink || ''));
  if (!userLink) throw new Error('缺少用户主页链接，无法发送私信');

  // 找到目标 tab（小红书页面）
  let tab = null;
  try {
    const tabs = await chrome.tabs.query({ url: ['*://*.xiaohongshu.com/*', '*://www.xiaohongshu.com/*'] });
    tab = tabs[0];
  } catch (_) {}
  if (!tab) {
    // 尝试打开用户主页（主动创建 tab）
    try {
      tab = await chrome.tabs.create({ url: userLink, active: true });
    } catch (err) {
      throw new Error('无法打开小红书页面，请先打开小红书网页版并登录');
    }
  }

  // 激活标签页
  try { await chrome.tabs.update(tab.id, { active: true }); } catch (_) {}

  // ★ 确保已停在目标用户主页（不在则导航 + 等加载），并保证 content.js 已注入——与定位走同一套可靠流程
  const onProfile = await _tabIsOnProfile(tab.id, userLink);
  if (!onProfile) {
    try {
      await chrome.tabs.update(tab.id, { url: userLink });
      await waitTabLoadBg(tab.id, 20000);
    } catch (err2) {
      throw new Error('导航到用户主页失败：' + (err2 && err2.message ? err2.message : err2));
    }
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch (_) {}
  await _sleepBg(600);

  // ★ 工作流拆分：先试 Step2「发私信」（要求已在主页）；若不在主页 → 先做 Step1「打开主页」再提示重新发送
  let result = null;
  let dmThrew = null;
  try {
    result = await sendTabMsg(tab.id, { action: 'sendDmOnProfile', userLink, text }, 45000);
  } catch (e) {
    // ★ 关键诊断：sendMessage 抛错（脚本未注入/导航中/通道断开）要保留真实原因，不再吞成"私信发送失败"
    dmThrew = e;
    const t1 = (() => { try { return tab.url || ''; } catch (_) { return ''; } })();
    console.log('[私信后台] sendMessage 抛错:', e && e.message ? e.message : String(e), '| tabUrl:', t1);
  }
  if (result && result.needLocate) {
    try { await chrome.tabs.sendMessage(tab.id, { action: 'openUserProfile', userLink }); } catch (_) {}
    return { ok: true, navigating: true, notice: '已为你打开用户主页（工作流第1步）。请在页面加载完成后再次点「发送」完成第2步' };
  }
  if (result && result.navigating) {
    return { ok: true, navigating: true, notice: '已开始导航到用户主页，请在页面加载完成后再次点击「发送」' };
  }
  // ★ 点击私信按钮打开了独立聊天窗口：在当前受控标签页导航到该聊天 URL，再注入并发送
  if (result && (result.needNavigate || result.chatUrl)) {
    const chatUrl = result.chatUrl;
    const consult = /\/chat|\/im\/|message|conversation/.test(chatUrl || '');
    if (!consult && chatUrl) {
      // 更稳妥：先记录诊断，尽量导航
      console.log('[私信后台] 捕获聊天URL:', chatUrl);
    }
    // ★ 记录会话 id，供消息台按 convId 直接跳转
    if (chatUrl) await Storage.updateProspect(person.id, { convId: _convIdFromUrl(chatUrl) }).catch(() => {});
    try {
      await chrome.tabs.update(tab.id, { url: chatUrl, active: true });
      await waitTabLoadBg(tab.id, 20000);
    } catch (ne) {
      throw new Error('导航到聊天窗口失败：' + (ne && ne.message ? ne.message : ne));
    }
    try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }); } catch (_) {}
    await _sleepBg(1500);
    let d2 = null;
    try { d2 = await sendTabMsg(tab.id, { action: 'sendDmToOpenChat', userLink, text }, 45000); } catch (e2) { d2 = null; }
    if (d2 && d2.success) {
      // 落库
      const p2 = (await Storage.getProspectList()).find(x => x.id === person.id);
      if (p2) {
        await Storage.updateProspect(person.id, { dmStatus: 'sent', dmCount: (p2.dmCount || 0) + 1, lastDmAt: Date.now() });
        await Storage.addDmRecord({ personId: person.id, nickname: person.nickname || '', text, aiGenerated: !!data.aiGenerated, status: 'sent', repliedText: '' });
      }
      return { ok: true, result: d2 };
    }
    throw new Error((d2 && d2.error) || '已在聊天窗口导航，但发送未完成，请手动在该窗口发送');
  }
  if (!result || !result.success) {
    // 若 sendMessage 抛错，优先透出真实原因；否则用 content 返回的 error
    let reason = (result && result.error) || '私信发送失败';
    if (result == null && dmThrew) {
      reason = '页面脚本不可用/' + (dmThrew && dmThrew.message ? dmThrew.message : String(dmThrew)) + '（可能主页还在加载或内容脚本未注入）';
    }
    const err = new Error(reason);
    err.limited = !!(result && result.limited);
    throw err;
  }

  // 落库：更新候选人状态 + 记私信历史
  const personData = await Storage.getProspectList();
  const p = personData.find(x => x.id === person.id);
  if (p) {
    const newCount = (p.dmCount || 0) + 1;
    const updates = {
      dmStatus: 'sent',
      dmCount: newCount,
      lastDmAt: Date.now(),
    };
    // ★ 对线索池做了动作（发出私信）→ 即视为接触 → 自动升为商机
    if ((p.stage || 'lead') === 'lead') updates.stage = 'prospect';
    await Storage.updateProspect(person.id, updates);
  }
  await Storage.addDmRecord({
    personId: person.id,
    nickname: person.nickname || '',
    text,
    aiGenerated: !!data.aiGenerated,
    status: 'sent',
    repliedText: '',
  });
  return { ok: true, result };
}

/* ─── 获客清单：只打开私信聊天窗（不发送）。配合「💬 开私信」按钮验证"点私信"一步 ─── */
async function handleOpenDmChat(data) {
  const person = (data && data.person) || {};
  const rawUserLink = (person.source && person.source.userUrl) || person.userLink || '';
  const userLink = absUserUrlBg(rawUserLink);
  if (!userLink) throw new Error('缺少用户主页链接');

  let tab = null;
  try {
    const tabs = await chrome.tabs.query({ url: ['*://*.xiaohongshu.com/*', '*://www.xiaohongshu.com/*'] });
    tab = tabs[0];
  } catch (_) {}
  if (!tab) {
    try { tab = await chrome.tabs.create({ url: userLink, active: true }); await waitTabLoadBg(tab.id, 20000); }
    catch (err) { throw new Error('无法打开小红书页面，请先打开小红书网页版并登录'); }
  }
  try { await chrome.tabs.update(tab.id, { active: true }); } catch (_) {}

  const onProfile = await _tabIsOnProfile(tab.id, userLink);
  if (!onProfile) {
    try { await chrome.tabs.update(tab.id, { url: userLink }); await waitTabLoadBg(tab.id, 20000); }
    catch (err2) { throw new Error('导航到用户主页失败：' + (err2 && err2.message ? err2.message : err2)); }
  }
  try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }); } catch (_) {}
  await _sleepBg(600);

  let res = null;
  try {
    res = await sendTabMsg(tab.id, { action: 'openDmChat', userLink }, 20000);
  } catch (e) {
    throw new Error('打开私信窗脚本异常：' + (e && e.message ? e.message : String(e)));
  }
  if (res && res.needLocate) { throw new Error('还未在目标用户主页，请先「📎 定位」'); }
  // ★ 点私信按钮打开了独立聊天窗口：在该受控标签页导航到聊天URL，让聊天窗真正打开
  if (res && res.chatUrl) {
    try {
      await chrome.tabs.update(tab.id, { url: res.chatUrl, active: true });
      await waitTabLoadBg(tab.id, 20000);
    } catch (chatE) {
      throw new Error('导航到聊天窗口失败：' + (chatE && chatE.message ? chatE.message : chatE));
    }
    // ★ 记录会话 id（/chat/{convId}）→ 存到商机，供消息台按 convId 直接跳转对应会话
    await Storage.updateProspect(person.id, { convId: _convIdFromUrl(res.chatUrl) }).catch(() => {});
    return { ok: true, chatReady: true, chatUrl: res.chatUrl, notice: '已打开私信聊天窗' };
  }
  if (res && res.error) {
    const err = new Error(res.error); err.limited = !!res.limited; throw err;
  }
  return { ok: true, chatReady: !!(res && res.chatReady) };
}

/* ─── 获客清单：现场定位并高亮私信按钮（给用户直观确认脚本找到了哪个按钮） ─── */
async function handleLocateDmButton(data) {
  const person = (data && data.person) || {};
  const rawUserLink = (person.source && person.source.userUrl) || person.userLink || '';
  const userLink = absUserUrlBg(rawUserLink);

  let tab = null;
  try {
    const tabs = await chrome.tabs.query({ url: ['*://*.xiaohongshu.com/*', '*://www.xiaohongshu.com/*'] });
    tab = tabs[0];
  } catch (_) {}
  if (!tab) {
    throw new Error('未找到小红书标签页，请先打开小红书网页版');
  }
  try { await chrome.tabs.update(tab.id, { active: true }); } catch (_) {}
  try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }); } catch (_) {}
  await _sleepBg(500);

  let res = null;
  try { res = await sendTabMsg(tab.id, { action: 'locateDmButton' }, 15000); } catch (e) { res = { found: false, error: e.message }; }
  if (!res) res = { found: false, error: '无响应' };
  return { ok: true, ...res, note: userLink ? '定位私信按钮' : '（该候选人无主页链接）' };
}

/* ─── 获客清单：定位用户 + 抓公开小红书号/主页昵称（A方案：已登录小红书 tab 内直达用户主页） ───
 * 以 person.source.userUrl 为准；在已登录 tab 内同域改址导航（不开新 tab，降低反爬触发率）。
 * 导航会卸载内容脚本 → 返回 navigating:true，由前端再点一次完成抓取；或等加载后自动重试。 */
async function handleEnrichByProfile(data) {
  const person = (data && data.person) || {};
  const rawUserLink = (person.source && person.source.userUrl) || person.userLink || '';
  // ★ 归一化：可能是相对路径 /user/x（相对 origin 解析成绝对）；保证导航与"是否已在主页"判断一致
  const userLink = absUserUrlBg(rawUserLink);
  if (!userLink) throw new Error('缺少用户主页链接，无法定位用户');

  // 找到小红书标签页（已登录状态下的窗口）
  let tab = null;
  try {
    const tabs = await chrome.tabs.query({ url: ['*://*.xiaohongshu.com/*', '*://www.xiaohongshu.com/*'] });
    tab = tabs[0];
  } catch (_) {}
  if (!tab) {
    try {
      tab = await chrome.tabs.create({ url: userLink, active: true });
      await waitTabLoadBg(tab.id, 15000);
    } catch (err) {
      throw new Error('无法打开小红书页面，请先打开小红书网页版并登录');
    }
  }

  // 激活标签页
  try { await chrome.tabs.update(tab.id, { active: true }); } catch (_) {}

  // ★ 用 background 发起导航（比 content 脚本 location.href 更可靠），并等加载完成、注入 content.js 后再抓
  const onTarget = await _tabIsOnProfile(tab.id, userLink);
  if (!onTarget) {
    try {
      await chrome.tabs.update(tab.id, { url: userLink });
      await waitTabLoadBg(tab.id, 15000);
    } catch (err) {
      return { ok: false, error: '导航到用户主页失败：' + (err && err.message ? err.message : err) };
    }
  }

  // 确保 content.js 已注入（导航后需要重注入）
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch (_) {}
  await _sleepBg(600);

  // 抓取公开小红书号 + 主页昵称
  let result = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      result = await sendTabMsg(tab.id, { action: 'extractUserProfile' }, 4000);
      if (result && result.xhsId) break;
    } catch (_) {}
    await _sleepBg(1200);
  }

  // 判断当前 URL 是否已是目标主页（供诊断用）
  const curUrl = (() => { try { return tab.url || ''; } catch (_) { return ''; } })();
  if (result && result.xhsId) {
    await saveProfileToProspect(person, result.xhsId, result.name);
    return { ok: true, xhsId: result.xhsId, name: result.name, url: curUrl };
  }

  const nowOn = await _tabIsOnProfile(tab.id, userLink);
  return {
    ok: nowOn, xhsId: '', name: '',
    url: curUrl,
    error: nowOn ? '已打开用户主页，但未抓到公开小红书号（可能页面结构不同/需登录）。已定位到主页，可在该页手动查看。' : '未能定位到用户主页（可能已登录失效或页面被拦）。',
  };
}

// 判断标签页当前 URL 是否已是目标主页
async function _tabIsOnProfile(tabId, userLink) {
  try {
    const t = await chrome.tabs.get(tabId);
    const cur = (t && t.url) || '';
    const want = userLink.split('?')[0];
    return !!(cur && cur.startsWith(want));
  } catch (_) { return false; }
}

// 等待标签页加载完成
async function waitTabLoadBg(tabId, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 15000);
  while (Date.now() < deadline) {
    try {
      const t = await chrome.tabs.get(tabId);
      if (t && (t.status === 'complete')) return true;
    } catch (_) {}
    await _sleepBg(400);
  }
  return false;
}

/* 把抓到的公开小红书号/主页名写回 prospect */
async function saveProfileToProspect(person, xhsId, name) {
  const list = await Storage.getProspectList();
  const p = list.find(x => x.id === person.id);
  if (!p) return;
  const updates = {};
  if (xhsId) updates.xhsId = String(xhsId);
  if (name) {
    updates.nickname = name;
    updates.profile = { ...(p.profile || {}), name };
  }
  if (Object.keys(updates).length > 0) {
    await Storage.updateProspect(person.id, updates);
  }
}

function _sleepBg(ms) { return new Promise(r => setTimeout(r, ms)); }

// ★ chrome.tabs.sendMessage 不支持 {timeout} 选项（传了会直接报错）。用 Promise.race 实现真实超时。
function sendTabMsg(tabId, msg, timeoutMs) {
  return Promise.race([
    chrome.tabs.sendMessage(tabId, msg),
    new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error('tabs.sendMessage 超时(' + (timeoutMs || 10000) + 'ms): ' + (msg && msg.action))); }, timeoutMs || 10000);
    }),
  ]);
}

// 归一化用户主页 URL（相对路径 → https://www.xiaohongshu.com/...），供导航与"是否已在主页"比对
function absUserUrlBg(u) {
  if (!u) return '';
  u = String(u).trim().split('?')[0];
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  return 'https://www.xiaohongshu.com' + u;
}

/* ─── 检查配置状态 ─── */
async function handleCheckConfig() {
  const config = await Storage.getConfig();
  const hasApiKey = !!((config.ai && config.ai.apiKey) || (config.ai && config.ai.fallbackApiKey));
  const productName = config.product?.name || '';
  return { hasApiKey, productName, configured: hasApiKey };
}

/* ─── 测试 AI 连接 ─── */
async function handleTestAiConnection(data) {
  const config = await Storage.getConfig();
  const aiConfig = data?.aiConfig || config.ai;
  const result = await AiClient.testConnection(aiConfig);
  return result;
}

/* ─── 获取配置（供 popup 读取产品名等） ─── */
async function handleGetConfig() {
  const config = await Storage.getConfig();
  // 不返回 apiKey 到前端
  const safe = { ...config, ai: { ...config.ai, apiKey: config.ai?.apiKey ? '***' : '' } };
  return { config: safe };
}

/* ─── 更新配置（部分字段深合并） ─── */
async function handleUpdateConfig(data) {
  if (!data || typeof data !== 'object') throw new Error('参数错误');
  const current = await Storage.getConfig();
  const updated = mergeConfig(current, data);
  await Storage.setConfig(updated);
  return { ok: true, config: { ...updated, ai: { ...updated.ai, apiKey: updated.ai?.apiKey ? '***' : '' } } };
}

// 深合并（对象递归合并，数组/标量直接覆盖）
function mergeConfig(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (
      override[key] !== null && typeof override[key] === 'object' && !Array.isArray(override[key]) &&
      typeof result[key] === 'object' && !Array.isArray(result[key])
    ) {
      result[key] = mergeConfig(result[key] || {}, override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

/* ─── 大窗管理 ───
   默认 default_popup = 小窗（浮动无框，评论助手分步 + 评论跟进）
   openBigWindow = popup 顶部「↗大窗」按钮触发，开一个大的独立窗口（总览/获客清单/灌水总结） */
async function openBigWindow(senderTab) {
  // 复用当前活动的小红书标签页作为操作目标
  let tab = null;
  if (senderTab && senderTab.id) {
    try {
      const t = await chrome.tabs.get(senderTab.id);
      if (t && t.url && t.url.includes('xiaohongshu.com')) tab = t;
    } catch (_) {}
  }
  if (!tab) {
    const q = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    tab = q && q[0] ? q[0] : null;
  }

  // 检查已有大窗，存在则聚焦
  const { bigWindowId } = await chrome.storage.local.get('bigWindowId');
  if (bigWindowId) {
    try {
      await chrome.windows.update(bigWindowId, { focused: true });
      return { ok: true, reused: true };
    } catch (_) {
      await chrome.storage.local.remove('bigWindowId');
    }
  }

  const tabId = (tab && tab.id) ? tab.id : 0;
  const url = chrome.runtime.getURL('popup.html?mode=big&tabId=' + tabId);
  const win = await chrome.windows.create({
    url: url,
    type: 'popup',
    width: 1160,
    height: 900,
    left: 120,
    top: 60,
  });
  await chrome.storage.local.set({ bigWindowId: win.id });
  return { ok: true, windowId: win.id };
}

/* 点击扩展图标：直接打开/聚焦大窗（无 default_popup，onClicked 触发） */
chrome.action.onClicked.addListener(async (tab) => {
  await openBigWindow(tab);
});

// 大窗关闭时清理记录
chrome.windows.onRemoved.addListener((windowId) => {
  chrome.storage.local.get('bigWindowId', (data) => {
    if (data.bigWindowId === windowId) {
      chrome.storage.local.remove('bigWindowId');
    }
  });
});

/* ─── 一键灌水：闹钟调度（受 autoWater 版本开关闸门控制） ─── */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (typeof Edition !== 'undefined' && !Edition.hasFeature('autoWater')) return;
  if (alarm.name && alarm.name.startsWith('auto-water-')) {
    AutoWater.handleAlarm(alarm.name);
  }
});

/* ═══════════ ✍️ 发笔记 · AI 生成文案（知识库参考 + 可选话题 → 小红书文案） ═══════════ */
async function requireKnowledge(fn) {
  if (typeof Edition !== 'undefined' && !Edition.hasFeature('knowledge')) {
    throw new Error('当前版本未开通「发笔记/知识库」功能');
  }
  return await fn();
}

// ✍️ AI 生成笔记文案：按【引导话题（可选）】写一篇小红书笔记，并引用选中的知识库条目作素材
async function aiRewriteNoteBg(data) {
  const config = await Storage.getConfig();
  if (!config.ai.apiKey && !config.ai.fallbackApiKey) throw new Error('未配置 API Key，请先在设置页面填写');
  const kb = (data && data.kb) || {};
  const topic = String((data && data.topic) || '').trim();
  const kTitle = String(kb.title || '').trim();
  const kContent = String(kb.content || '').trim();
  const kTags = Array.isArray(kb.tags) ? kb.tags.map(t => String(t).trim()).filter(Boolean) : [];
  const prodName = String((data && data.productName) || '').trim();
  const sellPoint = String((data && data.sellPoint) || '').trim(); // 本次主打卖点
  const peopleRaw = (data && data.people) || {};                       // 所选人群：单对象 或 数组
  const people = Array.isArray(peopleRaw) ? peopleRaw : (peopleRaw ? [peopleRaw] : []);
  const persona = getPersonaText(config);
  const system = [
    '你是小红书爆款图文笔记写手，帮博主生成一篇可直接发布的图文笔记素材（要能直接发，不是草稿）。',
    '规则：',
    '1) 围绕“引导话题”组织；若没有，基于“知识库参考”或自拟一个贴近产品的好主题。',
    (sellPoint ? '1b) 全篇以卖点【' + sellPoint + '】为价值核心去展开，这是这篇主打的卖点。' : ''),
    (people.length ? '1c) 读者画像（这篇主要针对以下人群来写，正文每段都对着这群人）：' + people.map(p => (p.name || p.who || '') + (p.pain ? '｜痛点：' + p.pain : '')).join('；') : ''),
    (persona ? '1d) ★ 人设一致：这是「账号人设」——' + persona + '。标题钩子、正文的口吻/人称/经历、话题、CTA都要贴合这个人设来写，读起来是"这个账号的我"发的，而不是泛泛的营销号。' : ''),
    '2) 知识库参考：提取其中具体数据/要点/方法真实自然地引用进正文，不要照抄原文，要专业、有干货、像真人分享；无关则以主题/通用经验为主，不要编造具体数字。',
    '3) 标题给 3 个候选：A=强钩子型、B=悬念型、C=干货型，都要吸引点击。',
    '4) 正文按“钩子开场→共情/转折→干货分点→价值/产品软广→CTA”组织，口语化、分段清晰；语气要完全贴合所选人群的口吻和痛点，让这群人有共鸣。',
    '5) 话题标签给 5~8 个精准词（流量词+产品词+场景词），不带#号。',
    '6) 配图占位给 2~3 张（含一张封面）。每张都要给足"能直接扔给多模态生图/千问照做的设计提示词"，含这些字段：name(图位，如"封面/图2/图3")、text(封面大字主文案，只留最抓人的几个字，如"评论区才是金矿")、layout(版式/文字摆放的详细设计：哪几个字放什么位置、哪个字最大做视觉焦点、字号对比、主色撞色、留白、画面上下左右方位，越具体越能让AI照着画)、style(配色/风格/质感，如"红黑撞色、大字居中、极简留白、数据质感")、shoot(这份素材怎么准备——是截哪里/拍什么、放画面哪个位置、要不要打码，手把手教用户搞到这张素材图)、desc(把整张画面最终效果浓缩成一句，可当整图生成描述)。',
    '7) 给建议发布时间段 timeTip（如 12:00-13:00）。',
    '8) 给一句“置顶自评”selfComment（发完1小时内贴的引导互动话术）。',
    (prodName ? '9) 产品名[' + prodName + ']要在标题或正文中自然出现一次，但不要硬广。' : ''),
    '10) 额外输出 cover（封面三段式文案，用于 Canvas 把字画到底图模板上，务必严格执行长度上限，超长会被答辩截断）：',
    '   - cover.title：封面大字，≤12 汉字，抓眼球、越短越好（常用这3个标题中最抓人的一个的口语浓缩）；',
    '   - cover.subtitle：副标题一句话，≤16 汉字；',
    '   - cover.points：把本次正文最核心的干货/卖点结构式提炼，最多 3 条，每条 ≤14 汉字；',
    '   - cover.baseSize / cover.lineHeight / cover.fontWeight：文字排版建议（baseSize 为 3:4 基准宽 1000 下的首字号，如 88）；cover.grad.type="top-bottom" alpha 建议 0.38-0.45。',
    '只输出一个严格 JSON（不要任何解释/代码块/前后缀）：',
    '{"titles":["标题A","标题B","标题C"],"content":"正文，可用\\n分段","tags":["标签1","标签2",...],"imagePlans":[{"name":"封面","text":"大字主文案","layout":"版式/文字摆放设计","style":"配色/风格","shoot":"建议用户准备的素材(拍/截图怎么弄)","desc":"整张画面最终效果一句"}],"timeTip":"建议时段","selfComment":"置顶自评","cover":{"title":"封面大字≤12字","subtitle":"副标题≤16字","points":["卖点1≤14字","卖点2≤14字"],"baseSize":88,"lineHeight":1.12,"fontWeight":900,"grad":{"type":"top-bottom","alpha":0.4}}}'
  ];
  // ★ 注入当前产品对应的「笔记结构」（品类矩阵：页数 + 每页功能 + 选图构图）
  try {
    const _kb = await Storage.getKnowledgeBase();
    const _name = String((data && data.productName) || config.product.name || '').trim();
    const _desc = String(config.product.description || '').trim();
    const _arch = NoteArchitecture.getNoteArchitecture(_name, _desc, _kb);
    system.push('');
    system.push(_arch.guidance);
    if (_arch.category) {
      system.push('【本次参考品类】' + _arch.category + '——按该品类的页数(P1..Pn)和每页功能来排版，imagePlans 条数要落在该品类推荐页数内、逐个给每个 P 位的构图题选图。');
    }
  } catch (_) {}
  const systemStr = system.filter(Boolean).join('\n');
  const user = [
    topic ? '【引导话题】' + topic : '【引导话题】（未填写，请自拟一个合适主题）',
    sellPoint ? '【主打卖点】' + sellPoint : '',
    (people.length ? '【目标人群】' + people.map(p => (p.name || p.who || '') + (p.pain ? '｜痛点：' + p.pain : '')).join('；') : ''),
    '【知识库参考】' + (kTitle ? '\n标题：' + kTitle : '') + '\n' + (kContent || '（无正文）') + (kTags.length ? '\n参考标签：' + kTags.join('、') : '')
  ].filter(Boolean).join('\n\n---\n\n');
  const aiCfg = { ...config.ai, maxTokens: Math.max(config.ai.maxTokens || 4096, 2048) };
  const r = await AiClient.chatCompletion(aiCfg, systemStr, user);
  const raw = String(r.content || '').trim();
  const result = parseNoteJson(raw);
  if (result) {
    const title = result.titles && result.titles[0] || '';
    const tagLine = (result.tags || []).map(t => '#' + String(t).replace(/^#/, '').trim()).join(' ');
    return {
      copy: [title, result.content || ''].filter(Boolean).join('\n') + (tagLine ? '\n' + tagLine : ''),
      data: result,
    };
  }
  return { copy: raw, data: null };
}

function parseNoteJson(text) {
  if (!text) return null;
  const m = String(text).match(/\{[\s\S]*\}/);
  const s = m ? m[0] : text;
  try {
    const d = JSON.parse(s);
    if (!d || typeof d !== 'object' || !d.content) return null;
    if (Array.isArray(d.titles)) d.titles = d.titles.map(t => String(t).replace(/^[A-C][.、:：\s]*/, '').trim()).filter(Boolean);
    else if (d.titles) d.titles = [String(d.titles)];
    else d.titles = [];
    if (Array.isArray(d.tags)) d.tags = d.tags.map(t => String(t).trim()).filter(Boolean);
    else d.tags = [];
    if (!Array.isArray(d.imagePlans)) d.imagePlans = [];
    // 封面三段式：长度兜底截断（title≤12、副标题≤16、卖点≤3条每条≤14）
    if (d.cover && typeof d.cover === 'object') {
      const cv = d.cover;
      const clip = (s, n) => { const t = String(s || '').trim(); return (t.length > n ? t.slice(0, n) : t); };
      cv.title = clip(cv.title, 12);
      cv.subtitle = clip(cv.subtitle, 16);
      cv.points = Array.isArray(cv.points) ? cv.points.slice(0, 3).map(p => clip(p, 14)).filter(Boolean) : [];
      if (!cv.title && cv.subtitle) { cv.title = cv.subtitle; cv.subtitle = ''; }
      d.cover = cv;
    } else {
      d.cover = null;
    }
    return d;
  } catch (_) { return null; }
}

function parseJsonObject(text) {
  if (!text) return null;
  const m = String(text).match(/\{[\s\S]*\}/);
  const s = m ? m[0] : String(text);
  try { const d = JSON.parse(s); return (d && typeof d === 'object') ? d : null; } catch (_) { return null; }
}

async function _chatAi(config, system, user, maxTok) {
  const aiCfg = { ...config.ai, maxTokens: Math.max(config.ai.maxTokens || 4096, maxTok || 2048) };
  const r = await AiClient.chatCompletion(aiCfg, system, user);
  return String(r.content || '').trim();
}

async function _npProductContext(config) {
  const name = String(config.product.name || '').trim();
  // 结构化卖点：标题：内容……（有配图则标注），优先据此喂提示词；无则由 description 兜底
  const sp = Array.isArray(config.product.sellPoints) ? config.product.sellPoints.filter(s => s && (String(s.title || '').trim() || String(s.content || '').trim())) : [];
  let desc = '';
  if (sp.length) {
    desc = sp.map((s, i) => {
      const t = String(s.title || '').trim(), c = String(s.content || '').trim();
      return (t && c ? t + '：' + c : (t || c)) + (s.image ? '（附配图）' : '');
    }).join('\n');
  } else {
    desc = String(config.product.description || '').trim(); // 语义=产品卖点
  }
  let kbText = '';
  try { kbText = (await Storage.getKnowledgeBase()).filter(e => e.isActive !== false && (e.title || e.content)).slice(0, 12).map(e => (e.title || '') + '：' + String(e.content || '').slice(0, 280)).join('\n'); } catch (_) {}
  return { name, desc, kbText, sellPoints: sp };
}

async function aiGenerateSellPointsBg() {
  const config = await Storage.getConfig();
  if (!config.ai.apiKey && !config.ai.fallbackApiKey) throw new Error('未配置 API Key，请先到设置页填写');
  const { name, desc, kbText } = await _npProductContext(config);
  const persona = getPersonaText(config);
  const system = [
    '你是小红书产品运营。帮博主把"这次要卖什么"提炼成可单独推广的【卖点候选】（是价值主张，不是产品名）。',
    '第一步：判断这个产品是哪类打法 —— 工具型(解决具体问题/效率/省钱省事/可量化结果) 或 情绪型(情感/陪伴/身份认同/趣味/社交传播/安全感) 或 混合型。',
    '按类型差异化提炼 4~8 个候选卖点：',
    '- 工具型卖点要"硬价值"：量化结果、省时省钱省力、具体用法/数字、易上手。',
    '- 情绪型卖点要"软价值"：情感共鸣、身份认同、趣味分享、安全感、社交传播。',
    '每个卖点附：解决谁的什么问题(why)、是否适合作一篇主打(priority 高/中/低)、属于哪个 type(工具/情绪/混合)、以及适合的 play(这篇的内容打法：工具型=教程/避坑/测评/对比 之一；情绪型=测试/共鸣/种草/剧情 之一)。',
    persona ? '★ 必须结合【账号人设】：卖点面向的人群、解决的痛点、适合的打法，都要贴合这个人设的身份/定位/目标人群/语气来选，别跟账号人设打架。' : '',
    '只输出严格 JSON：{"strategy":"这个产品的整体内容打法一句话","sell_points":[{"point":"卖点一句话","why":"解决谁的什么问题","priority":"高/中/低","type":"工具/情绪/混合","play":"适合的内容打法"}]}'
  ].filter(Boolean).join('\n');
  const user = [
    '【产品名称】' + (name || '（未填）'),
    '【产品卖点描述】' + (desc || '（未填）'),
    persona ? '【账号人设】' + persona : '',
    kbText ? '【知识库资料】' + kbText : '',
  ].filter(Boolean).join('\n\n---\n\n');
  const raw = await _chatAi(config, system, user, 2048);
  const d = parseJsonObject(raw);
  if (d && Array.isArray(d.sell_points)) {
    return { sell_points: d.sell_points.slice(0, 8), strategy: (d.strategy && String(d.strategy)) || '' };
  }
  return { sell_points: name ? [{ point: name, why: desc || '核心卖点', priority: '中', type: '', play: '' }] : [], raw };
}

async function generateNoteImageBg(data) {
  const config = await Storage.getConfig();
  const ai = config.ai || {};
  // 优先用多模态/图像专用配置，其次主配置：这样在「发笔记/向导」里配的多模态(千问 Qwen3.7 Plus)也能直接用来出图
  const key = ai.imageApiKey || ai.fallbackApiKey || ai.apiKey;
  if (!key) throw new Error('未配置多模态(图像)API Key，请到「设置→AI 配置→多模态命名」或发笔记向导里填');
  const base = String(ai.imageBaseUrl || ai.fallbackApiBaseUrl || ai.apiBaseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('未配置 API Base');
  const model = String(ai.imageModel || ai.fallbackModel || ai.model || '').trim() || 'wanx2.1-t2i-turbo';
  const prompt = String((data && data.prompt) || '').trim();
  if (!prompt) throw new Error('缺少配图描述');
  const endpoint = base + '/images/generations';
  const body = { model, prompt, size: data.size || '1024*1024', n: 1 };
  let resp;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error('请求生图接口失败（检查网络或 API 地址）：' + ((e && e.message) || e));
  }
  if (!resp.ok) {
    let t = ''; try { t = await resp.text(); } catch (_) {}
    throw new Error('生图失败 ' + resp.status + ' ' + String(t).slice(0, 200) + '（模型 ' + model + '，若非图片模型请改用 Qwen-Image/wanx 等比图模型）');
  }
  const j = await resp.json();
  const item = (j && j.data && j.data[0]) || {};
  if (item.b64_json) return { image: 'data:image/png;base64,' + item.b64_json };
  if (item.url) return { image: item.url, url: item.url };
  throw new Error('接口未返回图片');
}

// 封面底图模板：按 用户名+产品名+人设 生成 3 个候选风格，每个含可执行生图提示词
async function genCoverTemplateBg(data) {
  const config = await Storage.getConfig();
  if (!config.ai.apiKey && !config.ai.fallbackApiKey) throw new Error('未配置 API Key，请先到设置页填写');
  const username = String((data && data.username) || '').trim() || config.product.username || '小红书博主';
  const productName = String((data && data.productName) || '').trim() || config.product.name || '我的产品';
  const persona = String((data && data.persona) || '').trim() || getPersonaText(config);
  const coverHook = String((data && data.coverHook) || '').trim();

  const system = [
    '你是小红书封面底图模板设计师。要为一款小红书产品的【封面底图模板】产出 3 个风格候选，每个给一段能直接扔给文生图模型执行的提示词。',
    '封面统一为【上/中/下三板块固定式】版式，全程都必须遵循：',
    '· 上板块（约顶部 14%）：放品牌/署名装饰元素（用户名/产品名/人设标签），视觉上和中部有明显分隔留白；',
    '· 中板块（中部约 14%~82%）：必须【大面积留白/纯净空间】，这块之后要压上封面大字标题+副标题+卖点，所以不能有文字、不能有复杂图案抢焦点；',
    '· 下板块（约底部 18%）：放一条引流装饰条/图案元素或留白，供后续加引流文案。',
    '要求：3 个候选风格差异化明显（如 高级简约风/撞色大牌风/温暖手作风），且整体与【用户名/产品名/人设】的调性契合；画面干净、有质感、适合 3:4 竖版。',
    '只输出严格 JSON：{"candidates":[{"name":"风格名","prompt":"给文生图模型的完整提示词，中文，包含版式要求与留白要求"}]}'
  ].filter(Boolean).join('\n');
  const user = [
    '【用户名】' + username,
    '【产品名】' + productName,
    persona ? '【人设】' + persona : '',
    coverHook ? '【封面人设短语】' + coverHook : '',
  ].filter(Boolean).join('\n\n');
  const raw = await _chatAi(config, system, user, 1024);
  const d = parseJsonObject(raw);
  const cands = (d && Array.isArray(d.candidates)) ? d.candidates.map(c => ({ name: String(c.name || '风格'), prompt: String(c.prompt || '') })).filter(c => c.prompt).slice(0, 3) : [];
  if (!cands.length) throw new Error('AI 未返回候选提示词');
  return { candidates: cands };
}

async function aiGenerateConceptBg(data) {
  const config = await Storage.getConfig();
  if (!config.ai.apiKey && !config.ai.fallbackApiKey) throw new Error('未配置 API Key，请先到设置页填写');
  const { name, desc, kbText } = await _npProductContext(config);
  const persona = getPersonaText(config);
  const sellPoints = Array.isArray(data.sellPoints) ? data.sellPoints.map(s => String(s.point || s).trim()).filter(Boolean) : [];
  const usedPool = Array.isArray(data.usedPool) ? data.usedPool.map(s => String(s).trim()).filter(Boolean) : [];
  const system = [
    '你是小红书选题策划。给定选定的【卖点】，先推导这个卖点能覆盖的【目标人群清单】，再为"这些人群 × 这个卖点"产出可发的小红书【候选话题】。',
    '人群清单 people_options：给出 3~5 个不同但相关的可投放人群，每个含 name(人群一句话，如"准备提前还房贷的上班族")、pain(痛点/不安)、scene(什么场景会点进来)、timing(发布时机)。第 0 个为主打人群。',
    '候选话题：基于这些人群的真实痛点 + 小红书生态（身份认同/情绪共鸣/干货避坑/反常识观点）给出 6 个能直接当发帖方向的话题。',
    '每个话题附 angle(切入点)、target(瞄哪类人/场景)、rationale(2~3条"为什么选它"的推演：产品×人群匹配、平台爆点、差异化、且不与已发重复)。',
    '必须避开【已发过的】内容，不要重复其意思。',
    persona ? '★ 必须结合【账号人设】：主打人群、话题切入角度、语气，都要贴合这个账号人设的身份/定位/目标人群/人设调性，发出来像是这个账号自己的选题。' : '',
    '只输出严格 JSON：{"people":{"who":"","pain":"","scene":"","timing":""},"people_options":[{"name":"","pain":"","scene":"","timing":""}],"topics":[{"topic":"","angle":"","target":"","rationale":""}]}'
  ].filter(Boolean).join('\n');
  const user = [
    '【产品】' + ((name || '') + (desc ? '｜' + desc : '')),
    '【选定卖点】' + (sellPoints.length ? sellPoints.join('；') : '（未提供，请从产品出发）'),
    persona ? '【账号人设】' + persona : '',
    kbText ? '【知识库资料】' + kbText : '',
    usedPool.length ? '【已发过的，不要重复】' + usedPool.join('；') : '',
  ].filter(Boolean).join('\n\n---\n\n');
  const raw = await _chatAi(config, system, user, 2048);
  const d = parseJsonObject(raw);
  if (d && d.people && Array.isArray(d.topics)) {
    return {
      people: d.people,
      people_options: (Array.isArray(d.people_options) && d.people_options.length ? d.people_options : [d.people]).map(p => ({ name: String(p.name || p.who || ''), pain: String(p.pain || ''), scene: String(p.scene || ''), timing: String(p.timing || '') })).slice(0, 5),
      topics: d.topics.slice(0, 6).map(t => ({ topic: String(t.topic || ''), angle: String(t.angle || ''), target: String(t.target || ''), rationale: String(t.rationale || '') })),
    };
  }
  if (d && Array.isArray(d.topics)) return { topics: d.topics.slice(0, 6), raw };
  return { topics: [], raw };
}

/* ═══════════ 📌 置顶自评：专门生成"发完笔记1小时内贴一句引导互动评论"的 AI 工作流 ═══════════ */
async function aiGenerateSelfCommentBg(data) {
  const config = await Storage.getConfig();
  if (!config.ai.apiKey && !config.ai.fallbackApiKey) throw new Error('未配置 API Key，请先到设置页填写');
  const topic = String((data && data.topic) || '').trim();
  const sellPoint = String((data && data.sellPoint) || '').trim();
  const people = Array.isArray(data.people) ? data.people : (data.people ? [data.people] : []);
  const productName = String((data && data.productName) || '').trim();
  const kbText = (data && data.kbText) ? String(data.kbText).trim() : '';
  const system = [
    '你是小红书私域引流高手。为博主写一条【置顶自评】：博主发完这篇笔记后，在 1 小时内自己抢一楼贴的一句"引导互动"评论。',
    '要求必须全中：',
    '1) 像真人沙发，第一句先共鸣/抛观点，绝不上来卖货；',
    '2) 留一个"半开放问题"，让人好接话（别问好不好/是不是这种一封口就结束的）；',
    '3) 产品/工具只顺嘴轻带一句，不硬广、不刷屏、不提站外链接；',
    '4) 语气贴合所选人群的痛点和口吻；',
    '5) 结尾自然引向"评论区聊聊 / 点头像看主页"；',
    '6) 控制在 1~2 句，口语化、不写成长文；',
    '7) 不得含"求私信/加V/扫码"等营销违禁词。',
    '给 3 个不同角度的候选（一个共鸣型、一个抛坑引讨论型、一个干货引流型），直接可复制就用。',
    '只输出严格 JSON：{"candidates":["自评A","自评B","自评C"]}'
  ].join('\n');
  const user = [
    topic ? '【本笔记主题】' + topic : '',
    sellPoint ? '【主打卖点】' + sellPoint : '',
    people.length ? '【目标人群】' + people.map(p => (p.name || p.who || '') + (p.pain ? '｜痛点：' + p.pain : '')).join('；') : '',
    productName ? '【产品】' + productName : '',
    kbText ? '【知识库参考】' + kbText : '',
  ].filter(Boolean).join('\n\n---\n\n');
  const raw = await _chatAi(config, system, user, 1600);
  const d = parseJsonObject(raw);
  const candidates = (d && Array.isArray(d.candidates) ? d.candidates : []).map(s => String(s).trim()).filter(Boolean).slice(0, 3);
  if (candidates.length) return { candidates };
  return { candidates: [], raw };
}

/* ═══════════ 账号诊断：抓本人主页 → 头像/简介/笔记诊断 → 追问深化 → 内容规划 ═══════════ */

// 抓本人「我的」主页完整资料：优先用已开的本人主页 tab，否则自动打开本人主页再取（只读）
async function handleExtractOwnProfile() {
  const xhsTabs = ((await chrome.tabs.query({}).catch(() => [])) || [])
    .filter(t => t && t.url && /xiaohongshu\.com/.test(t.url));

  // 1) 已有本人主页 tab → 直接抽取
  for (const tab of xhsTabs) {
    try {
      const r = await sendTabMsg(tab.id, { action: 'extractOwnProfile' }, 8000);
      if (r && r.ok && r.profile && r.profile.xhsId) return { profile: r.profile };
    } catch (_) {}
  }

  // 2) 拿一个可访问的本人主页 URL（优先从现存 xhs tab 顶部取）
  let targetUrl = '';
  for (const tab of xhsTabs) {
    try {
      const r = await sendTabMsg(tab.id, { action: 'getOwnProfileUrl' }, 6000);
      if (r && r.ok && r.url) { targetUrl = r.url.split('?')[0]; break; }
    } catch (_) {}
  }

  // 3) 没有 xhs tab / 拿不到 → 先开 explore 再取
  if (!targetUrl) {
    const tab = await chrome.tabs.create({ url: 'https://www.xiaohongshu.com/explore', active: true });
    await waitTabLoadBg(tab.id, 20000);
    await _sleepBg(1500);
    try {
      const r = await sendTabMsg(tab.id, { action: 'getOwnProfileUrl' }, 6000);
      if (r && r.ok && r.url) targetUrl = r.url.split('?')[0];
    } catch (_) {}
  }

  if (!targetUrl) throw new Error('未能定位本人主页，请先在小红书网页版登录后再试。');

  // 4) 打开本人主页 → 抽取
  const tab = await chrome.tabs.create({ url: targetUrl, active: true });
  await waitTabLoadBg(tab.id, 25000);
  await _sleepBg(1800);
  let r = null;
  try { r = await sendTabMsg(tab.id, { action: 'extractOwnProfile' }, 10000); } catch (_) {}
  if (r && r.needsScroll !== undefined) {
    // 若页面提示需要滚动加载，简单滚动一次再读
    try { await sendTabMsg(tab.id, { action: 'nudgeScroll' }, 3000); } catch (_) {}
    await _sleepBg(1200);
    try { r = await sendTabMsg(tab.id, { action: 'extractOwnProfile' }, 10000); } catch (_) {}
  }
  if (r && r.ok && r.profile && r.profile.xhsId) return { profile: r.profile, openedTab: true };
  throw new Error((r && (r.reason || r.error)) || '未能读取主页数据，请确认本人「我的」主页已打开');
}

// 把 profile 转成 AI 可读的笔记/账号文本
function _diagNotesText(profile) {
  const notes = (profile && profile.notes) || [];
  if (!notes.length) return '（未读到笔记列表）';
  return notes.map((n, i) => (i + 1) + '. ' + (n.title || '（未命名）')).join('\n');
}

// 头像：若配置了多模态模型则真正"看图"，否则返回 null（走文字建议）
async function _diagAvatarVision(config, profile) {
  const ai = config.ai || {};
  const key = ai.fallbackApiKey;
  const base = String(ai.fallbackApiBaseUrl || ai.apiBaseUrl || '').replace(/\/+$/, '');
  const model = ai.fallbackModel;
  const avatar = (profile && profile.avatar) || '';
  if (!(key && base && model && avatar)) return null;
  // 公开图 URL 直接交给多模态模型读取
  const url = base + '/chat/completions';
  const body = {
    model, temperature: 0.3, max_tokens: 800,
    messages: [
      { role: 'user', content: [
        { type: 'text', text: '请从视觉角度评价这张小红书头像：清晰度/辨识度、是否利于个人IP、是否与账号定位匹配。给出 JSON：{"score":数字,"strength":"优点","issue":"问题","suggestion":"落地的整改建议"}。只返回JSON。' },
        { type: 'image_url', image_url: { url: avatar } },
      ] },
    ],
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  if (!resp.ok) return null;
  const j = await resp.json().catch(() => null);
  const txt = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  const d = parseJsonObject(String(txt || ''));
  return d || null;
}

async function handleAccountDiagnose(data) {
  const config = await Storage.getConfig();
  if (!config.ai.apiKey && !config.ai.fallbackApiKey) throw new Error('未配置 API Key，请先到设置页填写');
  const profile = data.profile || null;
  if (!profile || !profile.xhsId) throw new Error('缺少账号资料，请先执行「开始诊断」抓取本人主页');

  const { name: prodName, desc: prodDesc, kbText } = await _npProductContext(config);
  // ── 账号类型 + 笔记结构矩阵（优先知识库「笔记架构」原文，否则内置品类矩阵兜底） ──
  let archCat = '', archGuidance = '';
  try {
    const kbArr = await Storage.getKnowledgeBase();
    const arch = NoteArchitecture.getNoteArchitecture(prodName, prodDesc, kbArr);
    archCat = arch.category || '';
    archGuidance = arch.guidance || '';
  } catch (_) {}
  const answers = Array.isArray(data.answers) ? data.answers.filter(a => String(a && a.answer || '').trim()) : [];
  const answersText = answers.length
    ? '\n【用户对追问的回答】' + answers.map(a => String(a.q || '') + '：' + String(a.answer)).join('\n')
    : '';

  const profileBlock = [
    '【昵称】' + (profile.name || '未命名'),
    '【小红书号】' + (profile.xhsId || ''),
    '【简介】' + (profile.desc || '（暂无）'),
    '【粉丝/关注/获赞】' + ((profile.fans || '-') + ' / ' + (profile.follows || '-') + ' / ' + (profile.likes || '-')),
    '【发过的笔记】\n' + _diagNotesText(profile),
  ].join('\n');
  const prodBlock = [
    '【我的产品】' + (prodName || '（未填）'),
    prodDesc ? '【产品卖点】' + prodDesc : '',
    kbText ? '【我的知识库（作内容素材参考）】\n' + kbText : '',
    (archGuidance ? '【品类与笔记结构匹配矩阵（参照它识别账号类型 + 给笔记结构建议）】\n' + archGuidance : ''),
  ].filter(Boolean).join('\n');

  const system = [
    '你是资深的小红书账号运营顾问。你正为一个小红书账号做主页诊断，目的是帮博主改好主页、定好定位、更贴合自身产品与知识库地做内容。',
    '分析：1)定位/人设是否清晰有差异；2)简介是否讲清"我是谁、为谁、提供什么价值"+钩子；3)头像是否利于个人IP；4)笔记标题与话题是否聚焦、与定位/产品是否一致、互动偏好反映的问题；5)现状是否支撑产品(变现)目标。',
    '★ 先识别这个账号的【账号类型】（博主垂类/内容打法，如 干货分享型/测评型/生活方式种草型/教程型/资料整理型/经验情感型…），并结合发给你的「品类与笔记结构匹配矩阵」，给出这个账号应该长期按哪个【品类】来做笔记、每篇图文多少页、每一页(P1..Pn)的功能与选图构图——给出明确的笔记结构建议。',
    '要求：批评具体可操作，每条建议都能直接动手改；同时围绕账号定位、目标人群、变现目标、内容阶段给出追问问题，用于把诊断做深。',
    '只输出严格 JSON，不要用代码块，字段及结构必须是：{"overall":"相对的话","summary":"现状概述(120字内)","positioning":{"issue":"..","suggestion":".."},"sections":[{"name":"头像","issue":"..","suggestion":".."},{"name":"简介","issue":"..","suggestion":".."},{"name":"笔记","issue":"..","suggestion":".."}],"priorities":["动作1","动作2","动作3"],"questions":[{"q":"追问问题","why":"为什么问"}],"notePlan":{"direction":"内容方向","pillars":["栏目/角度"],"first5":["最先做的5个选题"]},"noteType":"识别到的账号类型","noteStructure":"笔记结构建议：最匹配品类、每篇页数、逐页P1..Pn功能与选图构图"}'
  ].join('\n');

  const user = [profileBlock, prodBlock, answersText].filter(Boolean).join('\n\n---\n\n');
  const raw = await _chatAi(config, system, user, 3000);
  let d = parseJsonObject(raw);
  if (!d) throw new Error('AI 返回无法解析：' + String(raw).slice(0, 200));

  // 头像：有可用的多模态则真实看图并覆盖该分块
  let avatarVision = null;
  try { avatarVision = await _diagAvatarVision(config, profile); } catch (_) { avatarVision = null; }
  const sections = Array.isArray(d.sections) ? d.sections : [];
  if (avatarVision && avatarVision.issue !== undefined) {
    const av = sections.find(s => s.name === '头像');
    if (av) { av.issue = String(avatarVision.issue || av.issue); av.suggestion = String(avatarVision.suggestion || av.suggestion); av.score = avatarVision.score; }
    else sections.unshift({ name: '头像', issue: String(avatarVision.issue || ''), suggestion: String(avatarVision.suggestion || ''), score: avatarVision.score });
    d.sections = sections;
  }

  return { report: d, avatarVisionUsed: !!avatarVision };
}

// 后续单轮追问（在已有报告基础上）
async function handleDiagnoseRefine(data) {
  const config = await Storage.getConfig();
  if (!config.ai.apiKey && !config.ai.fallbackApiKey) throw new Error('未配置 API Key');
  const qa = Array.isArray(data.qa) ? data.qa.filter(x => String(x && x.answer || '').trim()) : [];
  const profile = data.profile || null;
  const prevSummary = String(data.prevSummary || '');
  if (!qa.length) throw new Error('请先回答追问问题');
  const qaText = qa.map(x => '问：' + (x.q || '') + '\n答：' + (x.answer || '')).join('\n');
  const ctx = [
    '【账号资料】' + (profile ? ('昵称:' + (profile.name || '') + '；简介:' + (profile.desc || '')) : ''),
    '【上次诊断概览】' + prevSummary,
    '【你的回答】\n' + qaText,
  ].join('\n\n---\n\n');
  const system = [
    '你是小红书账号运营顾问，正在对一份账号诊断做「深化落地方案」。',
    '基于博主对追问的新回答，输出更聚焦、可立即执行的深化建议。',
    '分类表达：定位修正 / 简介改写要点 / 头像调整 / 选题与内容策略 / 下一步行动清单。',
    '用简洁自然的中文，逐条输出，不要用代码块，不要 JSON。',
  ].join('\n');
  const reply = await _chatAi(config, system, ctx, 2000);
  return { reply };
}

// 笔记内容规划：结合产品/卖点/知识库 + 账号现状
async function handleNotePlan(data) {
  const config = await Storage.getConfig();
  if (!config.ai.apiKey && !config.ai.fallbackApiKey) throw new Error('未配置 API Key');
  const profile = data.profile || null;
  const { name: prodName, desc: prodDesc, kbText } = await _npProductContext(config);
  const system = [
    '你是小红书账号的内容规划师。为这个账号做一份【笔记内容规划】，让它围绕产品定位（不是自嗨）可持续地产出。',
    '结合：账号现状（简介/粉丝/发过的笔记）+ 产品/卖点 + 知识库素材。',
    '输出：定位与内容策略、内容栏目(3-5个，每个配主打角度与知识库素材示例)、选题池(12个可直接写的话题)、月度节奏与首月选题安排。',
'要求落地：每个选题给出标题方向、内容角度、主打卖点、适合的知识库素材。',
    '只输出严格 JSON，不要用代码块，结构必须是：{"strategy":"内容策略一句话","positioning":"建议的账号定位","pillars":[{"name":"栏目名","angle":"主打角度","skill":["知识点/素材"]}],"topics":[{"title":"选题标题方向","angle":"切入点","selling":"主打卖点","kb":"引用的知识库素材"}],"rhythm":"发布节奏建议"}'
  ].join('\n');

  const user = [
    '【账号现状】' + ('昵称:' + (profile && profile.name || '') + '；粉丝:' + (profile && profile.fans || '-') + '；简介:' + (profile && profile.desc || '') + '；发过的笔记:' + (profile ? _diagNotesText(profile) : '')),
    '【产品名称】' + (prodName || '（未填）'),
    prodDesc ? '【产品卖点】' + prodDesc : '',
    kbText ? '【知识库素材】\n' + kbText : '',
  ].filter(Boolean).join('\n\n---\n\n');
  const raw = await _chatAi(config, system, user, 3000);
  let d = parseJsonObject(raw);
  if (!d) throw new Error('AI 返回无法解析：' + String(raw).slice(0, 200));
  return { plan: d, raw };
}
