/* 自测：插件端落盘加密 / 口令导出 / 过期清除（含租户快照）
   运行：node scripts/dev/test-ext-privacy.js */
const assert = require('assert');

// ── 伪造 chrome.storage.local ──
const store = {};
global.chrome = {
  storage: {
    local: {
      async get(keys) {
        if (keys === null || keys === undefined) return { ...store };
        if (typeof keys === 'string') return keys in store ? { [keys]: store[keys] } : {};
        if (Array.isArray(keys)) {
          const out = {};
          for (const k of keys) if (k in store) out[k] = store[k];
          return out;
        }
        return {};
      },
      async set(obj) { Object.assign(store, obj); },
      async remove(keys) { (Array.isArray(keys) ? keys : [keys]).forEach(k => delete store[k]); },
    },
  },
};

global.self = global;
const CryptoBox = require('../../extension/lib/crypto-box.js');
const DataPrivacy = require('../../extension/lib/data-privacy.js');
assert.ok(CryptoBox && DataPrivacy, '两个模块都要挂到全局');

const DAY = 86400000;
const NOW = Date.now();
const OLD = NOW - 100 * DAY;    // 超过客户数据 90 天
const OLD_RUN = NOW - 40 * DAY; // 超过运行数据 30 天
const FRESH = NOW - 5 * DAY;

(async () => {
  // ── 1. 字段级加解密 ──
  const ct = await CryptoBox.lockText('13800000000');
  assert.ok(CryptoBox.isLocked(ct) && ct.indexOf('enc:v1:') === 0, '手机号应加密带前缀');
  assert.strictEqual(await CryptoBox.unlockText(ct), '13800000000');
  assert.strictEqual(await CryptoBox.unlockText('明文原样'), '明文原样', '存量明文应原样返回');
  const ct2 = await CryptoBox.lockText('13800000000');
  assert.notStrictEqual(ct, ct2, '同明文两次加密应因随机 IV 不同');
  assert.strictEqual(await CryptoBox.unlockText(ct2), '13800000000');
  const obj = { 名单: [{ 昵称: '张三', 邮箱: 'a@x.com' }], n: 3, ok: true };
  const lockedObj = await CryptoBox.lockJSON(obj);
  assert.ok(CryptoBox.isLocked(lockedObj));
  assert.deepStrictEqual(await CryptoBox.unlockJSON(lockedObj), obj);
  assert.strictEqual((await CryptoBox.unlockJSON('{"a":1}')).a, 1, '明文 JSON 原样解析');
  assert.deepStrictEqual(await CryptoBox.unlockJSON(lockedObj, 'FALLBACK'), obj, '正常密文不该走兜底');
  assert.strictEqual(await CryptoBox.unlockJSON('enc:v1:坏密文', 'FALLBACK'), 'FALLBACK', '坏密文走兜底');
  console.log('1 字段级加解密 OK');

  // ── 2. 口令加密文件 ──
  const plainFile = JSON.stringify({ tenants: [{ id: 't1' }], data: { t1: { config: { ai: { apiKey: 'sk-1' } } } } });
  const env = await CryptoBox.encryptFile(plainFile, 'pw-123456');
  assert.ok(CryptoBox.isFileEnvelope(env), '导出应是加密信封');
  assert.ok(env.indexOf('sk-1') < 0 && env.indexOf('apiKey') < 0, '信封里不应出现明文');
  assert.strictEqual(await CryptoBox.decryptFile(env, 'pw-123456'), plainFile);
  let threw = false;
  try { await CryptoBox.decryptFile(env, 'pw-wrong'); } catch (e) { threw = true; }
  assert.ok(threw, '错口令必须抛错');
  assert.strictEqual(CryptoBox.isFileEnvelope('{"tenants":[],"data":{}}'), false, '旧明文备份要能被识别为非信封');
  console.log('2 口令加密文件 OK');

  // ── 3. 敏感 key 整块加密 + config 字段加密 ──
  const prospect = [{ id: 1, nickname: '王五', email: 'w@x.com', lastDmAt: FRESH }];
  await chrome.storage.local.set({ prospect_list: await DataPrivacy.lock('prospect_list', prospect) });
  assert.ok(CryptoBox.isLocked(store.prospect_list), '落盘应是密文');
  assert.deepStrictEqual(await DataPrivacy.unlock('prospect_list', store.prospect_list), prospect);
  assert.strictEqual(await DataPrivacy.lock('script_library', 'enc:v1:x'), 'enc:v1:x', '已密文不二次加密');
  const cfg = { ai: { apiKey: 'sk-abc', fallbackApiKey: 'sk-def' }, product: { name: '产品A' } };
  const lockedCfg = await DataPrivacy.lockConfig(cfg);
  assert.ok(CryptoBox.isLocked(lockedCfg.ai.apiKey) && CryptoBox.isLocked(lockedCfg.ai.fallbackApiKey));
  assert.strictEqual(lockedCfg.product.name, '产品A', '非敏感字段保持明文可读');
  assert.notStrictEqual(lockedCfg.ai.apiKey, 'sk-abc', 'AI Key 不应明文落盘');
  const back = await DataPrivacy.unlockConfig(JSON.parse(JSON.stringify(lockedCfg)));
  assert.deepStrictEqual(back, cfg, '解开后应与原文一致');
  console.log('3 落盘加密 OK');

  // ── 4. 存量迁移（明文 → 密文，幂等） ──
  Object.keys(store).forEach(k => delete store[k]);
  await chrome.storage.local.set({
    knowledge_base: [{ title: '知识', content: '正文' }],
    prospect_list: [{ id: 9, nickname: '老客户' }],
    config: { ai: { apiKey: 'sk-old' }, product: { name: 'P' } },
    tenant_data__t1: { prospect_list: [{ id: 7 }], config: { ai: { apiKey: 'sk-t1' } }, script_library: ['a'] },
    wizard_done: 123,
  });
  const m1 = await DataPrivacy.migrateStorage();
  assert.ok(m1.migrated >= 4, '活动 key + 快照都应被加密：' + JSON.stringify(m1));
  assert.ok(CryptoBox.isLocked(store.knowledge_base) && CryptoBox.isLocked(store.prospect_list));
  assert.ok(CryptoBox.isLocked(store.config.ai.apiKey));
  assert.ok(CryptoBox.isLocked(store.tenant_data__t1.prospect_list));
  assert.ok(CryptoBox.isLocked(store.tenant_data__t1.config.ai.apiKey));
  assert.strictEqual(store.wizard_done, 123, '非敏感 key 不动');
  assert.deepStrictEqual(await CryptoBox.unlockJSON(store.knowledge_base), [{ title: '知识', content: '正文' }]);
  const m2 = await DataPrivacy.migrateStorage();
  assert.strictEqual(m2.migrated, 0, '第二次迁移不应再改（幂等）');
  assert.deepStrictEqual(await CryptoBox.unlockJSON(store.tenant_data__t1.script_library), ['a']);
  console.log('4 存量迁移幂等 OK');

  // ── 5. 过期清除（含租户快照，与真实口径 90/30 天一致） ──
  Object.keys(store).forEach(k => delete store[k]);
  const seed = {
    prospect_list: [
      { id: 1, nickname: '旧客户', lastDmAt: OLD },
      { id: 2, nickname: '新客户', themRepliedAt: FRESH },
      { id: 3, nickname: '无时间戳客户' },
    ],
    prospect_dm_history: [{ id: 1, sentAt: OLD }, { id: 2, sentAt: FRESH }],
    chat_follow_reply_history: [{ id: 1, at: OLD }, { id: 2, ts: FRESH }],
    replied_comments: { u1: [{ repliedAt: OLD }], u2: [{ repliedAt: FRESH }] },
    chat_follow_state: { conversations: { c1: { lastReplyAt: OLD }, c2: { lastReplyAt: FRESH }, c3: {} } },
    watering_logs: [{ ts: OLD_RUN }, { ts: FRESH }],
    ai_logs: [{ timestamp: OLD_RUN }, { timestamp: FRESH }],
    auto_water_history: { k1: { wateredAt: OLD_RUN }, k2: { ts: FRESH } },
    auto_water_daily: { [new Date(NOW - 40 * DAY).toISOString().slice(0, 10)]: 3, [new Date(NOW).toISOString().slice(0, 10)]: 5 },
    tenant_data__t1: { prospect_list: [{ id: 1, lastDmAt: OLD }, { id: 2, lastDmAt: FRESH }], config: { ai: { apiKey: 'sk-t' } } },
  };
  for (const k of Object.keys(seed)) {
    await chrome.storage.local.set({ [k]: DataPrivacy.isEncKey(k) ? await CryptoBox.lockJSON(seed[k]) : seed[k] });
  }
  const r = await DataPrivacy.sweepExpired(NOW);
  assert.strictEqual(r.failed, 0, '不应有解不开的密文');
  const want = {
    prospect_list: 2,          // 活动数据 1 条 + 租户快照内 1 条
    prospect_dm_history: 1, chat_follow_reply_history: 1, replied_comments: 1,
    chat_follow_state: 1, watering_logs: 1, ai_logs: 1, auto_water_history: 1, auto_water_daily: 1,
  };
  assert.deepStrictEqual(r.removed, want, '清除条数不符：' + JSON.stringify(r.removed));

  const pl = await CryptoBox.unlockJSON(store.prospect_list);
  assert.deepStrictEqual(pl.map(p => p.id), [2, 3], '静默客户清除，新客户与无时间戳客户保留');
  const cf = await CryptoBox.unlockJSON(store.chat_follow_state);
  assert.deepStrictEqual(Object.keys(cf.conversations), ['c2', 'c3'], '待回复清单（无回复时间戳）必须保留');
  const rc = await CryptoBox.unlockJSON(store.replied_comments);
  assert.deepStrictEqual(Object.keys(rc), ['u2']);
  assert.ok(CryptoBox.isLocked(store.prospect_list) && CryptoBox.isLocked(store.chat_follow_state), '清除后仍是密文');
  assert.ok(CryptoBox.isLocked(store.auto_water_history), '灌水历史应加密落盘');
  assert.deepStrictEqual(Object.keys(await CryptoBox.unlockJSON(store.auto_water_history)), ['k2']);
  assert.strictEqual(typeof store.auto_water_daily, 'object', '每日计数不加密（纯计数）');
  assert.deepStrictEqual(Object.keys(store.auto_water_daily), [new Date(NOW).toISOString().slice(0, 10)]);
  assert.ok(CryptoBox.isLocked(store.tenant_data__t1.prospect_list), '快照里的数据也要保持密文');
  const snap = await CryptoBox.unlockJSON(store.tenant_data__t1.prospect_list);
  assert.deepStrictEqual(snap.map(p => p.id), [2], '租户快照内的过期客户同样清除');
  assert.strictEqual(store.tenant_data__t1.config.ai.apiKey, 'sk-t', '快照里未涉及的字段不动');

  const r2 = await DataPrivacy.sweepExpired(NOW);
  assert.strictEqual(Object.keys(r2.removed).length, 0, '再扫一轮不应再清（幂等）');
  console.log('5 过期清除（活动 key + 租户快照）OK');

  console.log('ALL EXTENSION PRIVACY TESTS PASSED');
})().catch(e => { console.error('FAILED:', e && e.message); process.exit(1); });
