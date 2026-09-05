/**
 * tenant.js — 多租户（多产品）管理器
 *
 * 设计：快照交换（snapshot swap）。
 *   - 现有所有代码继续读写固定 key（config / knowledge_base / watered_notes ...），一行不改。
 *   - 每个租户在 tenant_data__<id> 里保存自己那一整套数据的快照。
 *   - 切换租户时：先把当前活动 key 存回当前租户快照 → 再把目标租户快照写回活动 key → 更新 current_tenant_id。
 *
 * 这样切换租户 = 换一套“活动数据”，各产品的配置/知识库/话术/AI 密钥/已灌水记录彻底隔离。
 */

const TENANT_KEYS = {
  LIST: 'tenants',              // [{ id, name, createdAt }]
  CURRENT: 'current_tenant_id', // string
  DATA_PREFIX: 'tenant_data__', // + id → 该租户的数据快照
};

// 随租户切换的“活动 key”（这些 key 的值属于当前租户，切换时整套换掉）
const TENANT_SCOPED_KEYS = [
  'config',              // 产品信息 + AI 配置 + 我的昵称 + 话术风格 + 关键词过滤 + 角色关键词
  'knowledge_base',      // 知识库
  'prompts',             // 提示词
  'script_library',      // 话术库（兼容旧版）
  'watered_notes',       // 已灌水
  'replied_comments',    // 已回复
  'opened_notes',        // 已打开
  'auto_water_config',   // 灌水搜索配置
  'auto_water_history',  // 灌水历史
  'auto_water_daily',    // 每日计数
  'auto_water_state',    // 搜索状态（含 foundNotes 笔记列表）
  'prospect_list',       // 获客清单
  'prospect_dm_history', // 获客清单私信历史
  'note_plan',           // 内容规划（含每页配图背景建议 photoPlans）
];

/* ─── 底层读写 ─── */
function _get(keys) {
  return chrome.storage.local.get(keys);
}
function _set(obj) {
  return chrome.storage.local.set(obj);
}
function _remove(keys) {
  return chrome.storage.local.remove(keys);
}

async function _list() {
  const data = await _get(TENANT_KEYS.LIST);
  return data[TENANT_KEYS.LIST] || [];
}

async function _getCurrentId() {
  const data = await _get(TENANT_KEYS.CURRENT);
  return data[TENANT_KEYS.CURRENT] || null;
}

function _genId() {
  return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** 把当前活动 key 的值整套存进 tenant_data__<id> */
async function _dumpActiveTo(id) {
  const active = await _get(TENANT_SCOPED_KEYS);
  const snapshot = {};
  for (const k of TENANT_SCOPED_KEYS) {
    if (active[k] !== undefined) snapshot[k] = active[k];
  }
  await _set({ [TENANT_KEYS.DATA_PREFIX + id]: snapshot });
}

/** 把 tenant_data__<id> 的快照写回活动 key（快照里没有的 key → 删除，让默认值生效） */
async function _loadActiveFrom(id) {
  const data = await _get(TENANT_KEYS.DATA_PREFIX + id);
  const snapshot = data[TENANT_KEYS.DATA_PREFIX + id] || {};
  const writes = {};
  const removes = [];
  for (const k of TENANT_SCOPED_KEYS) {
    if (snapshot[k] !== undefined) writes[k] = snapshot[k];
    else removes.push(k);
  }
  if (removes.length) await _remove(removes);
  if (Object.keys(writes).length) await _set(writes);
}

/**
 * 确保至少存在一个租户。首次调用时：把“现有活动数据”打包成「默认租户」。
 * 幂等，可在每次操作前调用。
 */
async function init(defaultPrompts) {
  const list = await _list();
  if (list.length > 0) return;
  const id = _genId();
  const tenant = { id, name: '默认租户', createdAt: Date.now() };
  // 把现有活动数据原样收进默认租户（不丢老用户数据）
  await _dumpActiveTo(id);
  await _set({ [TENANT_KEYS.LIST]: [tenant], [TENANT_KEYS.CURRENT]: id });
  console.log('[租户] 初始化默认租户:', id);
}

/** 新建租户（不切换）。种子：仅提示词用默认，其余留空 → 各自默认（干净的新产品）。 */
async function create(name, defaultPrompts) {
  const list = await _list();
  const id = _genId();
  const tenant = { id, name: (name || '新租户').trim() || '新租户', createdAt: Date.now() };
  const snapshot = {};
  if (defaultPrompts) snapshot.prompts = defaultPrompts; // 新产品也要有可用的提示词
  await _set({ [TENANT_KEYS.DATA_PREFIX + id]: snapshot });
  list.push(tenant);
  await _set({ [TENANT_KEYS.LIST]: list });
  console.log('[租户] 新建:', id, tenant.name);
  return tenant;
}

/** 切换到目标租户：存回当前 → 载入目标 → 更新 current。 */
async function switchTo(id) {
  const list = await _list();
  const target = list.find(t => t.id === id);
  if (!target) throw new Error('租户不存在: ' + id);
  const cur = await _getCurrentId();
  if (cur === id) return target; // 已是当前租户
  if (cur) await _dumpActiveTo(cur);
  await _loadActiveFrom(id);
  await _set({ [TENANT_KEYS.CURRENT]: id });
  console.log('[租户] 切换到:', id, target.name);
  return target;
}

/** 重命名 */
async function rename(id, name) {
  const list = await _list();
  const t = list.find(x => x.id === id);
  if (!t) throw new Error('租户不存在: ' + id);
  t.name = (name || '').trim() || t.name;
  await _set({ [TENANT_KEYS.LIST]: list });
  return t;
}

/** 删除租户。不能删最后一个；删当前时先切到另一个。 */
async function remove(id) {
  let list = await _list();
  if (list.length <= 1) throw new Error('至少保留一个租户');
  const cur = await _getCurrentId();
  if (id === cur) {
    // 先切到另一个租户，保证活动数据是有效的
    const other = list.find(t => t.id !== id);
    await switchTo(other.id);
  }
  list = (await _list()).filter(t => t.id !== id);
  await _remove(TENANT_KEYS.DATA_PREFIX + id);
  await _set({ [TENANT_KEYS.LIST]: list });
  const currentId = await _getCurrentId();
  console.log('[租户] 删除:', id, '当前:', currentId);
  return { currentId };
}

/** 列出租户 + 当前 id */
async function status() {
  return { tenants: await _list(), currentId: await _getCurrentId() };
}

const TenantManager = {
  TENANT_KEYS,
  TENANT_SCOPED_KEYS,
  init,
  create,
  switchTo,
  rename,
  remove,
  status,
  list: _list,
  getCurrentId: _getCurrentId,
};

// 支持 Service Worker importScripts（挂到全局）与 CommonJS
if (typeof self !== 'undefined') {
  self.TenantManager = TenantManager;
}
if (typeof module !== 'undefined') {
  module.exports = TenantManager;
}

