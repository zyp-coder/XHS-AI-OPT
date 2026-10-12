const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Utils = require('../../extension/lib/utils.js');
const source = fs.readFileSync(path.join(__dirname, '../../extension/background.js'), 'utf8');
const clone = value => structuredClone(value);
const entry = { title: '试用说明', content: '支持先试用，再决定是否购买。', category: '产品介绍', tags: ['试用'] };
let store, responses, calls;
const context = vm.createContext({
  console, crypto: require('node:crypto').webcrypto, Utils,
  Storage: {
    KEYS: { KNOWLEDGE_BASE: 'knowledge_base' },
    getConfig: async () => clone(store.config),
    setConfig: async cfg => { store.config = clone(cfg); },
    getKnowledgeBase: async () => clone(store.knowledge_base || []),
    set: async (key, value) => { store[key] = clone(value); },
    updateKnowledgeEntry: async (id, updates) => {
      const old = store.knowledge_base.find(e => e.id === id);
      Object.assign(old, clone(updates));
      return clone(old);
    },
  },
  chrome: { storage: { local: {
    get: async key => ({ [key]: clone(store[key]) }),
    set: async values => { Object.assign(store, clone(values)); },
  } } },
  ensureTenantInit: async () => {},
  _npProductContext: async cfg => ({ name: cfg.product.name, desc: cfg.product.description }),
  AiClient: { chatCompletion: async (cfg, system, user) => {
    calls.push({ cfg, system, user });
    if (!responses.length) throw new Error('Unexpected AI request');
    const result = responses.shift();
    if (result instanceof Error) throw result;
    return { content: typeof result === 'function' ? await result() : result };
  } },
});
vm.runInContext(source.slice(source.indexOf('const PERSONA_QUESTIONS ='), source.indexOf('/* ═══════════ 关键词维护：')), context);
vm.runInContext('async function _chatAi(config, system, user, maxTokens) { return (await AiClient.chatCompletion({ ...config.ai, maxTokens }, system, user)).content; }', context);
function reset() {
  store = { config: { ai: { apiKey: 'test-only' }, product: { name: '旧产品', cta: '保留封面', sellPoints: [] }, scriptStyle: { toneMannerisms: '别覆盖' } }, knowledge_base: [], current_tenant_id: 'test' };
  responses = []; calls = [];
}
function json(value) { return JSON.stringify(value); }
const plan = { accountType: '教程型', contentFocus: '使用方法', topics: [{ title: '如何试用' }] };
const quiz = { profile: { name: '测试', xhsId: 'test' }, bio: '专业分享', answers: [
  { q: '身份', answer: '我是产品设计师' }, { q: '产品', answer: '试用工具' },
  { q: '优势', answer: '' }, { q: '经历', answer: '亲自体验' },
  { q: '客户', answer: '初学者' }, { q: '知识', answer: '操作步骤' },
  { q: '定位', answer: '教程' }, { q: '口吻', answer: '耐心朋友' },
  { q: '承接', answer: '私信我' }, { q: '规划', answer: '每周两次' },
] };
async function run() {
  for (const text of [json([entry]), '整理如下：\n' + json([entry, entry]) + '\n完成', '```json\n' + json([entry]) + '\n```']) {
    assert.ok(Array.isArray(Utils.extractJson(text)));
  }
  assert.equal(Utils.extractJson('知识：[{"title":"完整","content":"内容"},{"title":"截断'), null);
  assert.equal(Utils.extractJson('{"entries":[{"title":"完整","content":"内容"}', false), null);
  const quoted = { text: '括号 ] } 和 " 引号', items: [1] };
  assert.deepEqual(Utils.extractJson('说明：' + json(quoted) + ' 完成'), quoted);
  assert.deepEqual(Utils.extractJson('```json\n{"ok":true}\n```'), { ok: true });
  reset();
  for (const value of [[entry], { entries: [entry] }, { knowledge_base: [entry] }, { entries: [{ 标题: '标题', 内容: '内容', 分类: '使用技巧', 标签: ['词'] }] }]) {
    responses.push('整理结果：' + json(value) + '\n已完成');
    assert.equal((await context.handleAiKbBuild({ text: '散乱的聊天和经验' })).entries.length, 1);
  }
  const before = calls.length;
  await assert.rejects(context.handleAiKbBuild({ answers: [] }), /填写问卷/);
  await assert.rejects(context.handleAiKbBuild({ text: 'a'.repeat(24001) }), /24000/);
  assert.equal(calls.length, before);
  responses.push('[{"title":"截断', json({ entries: [entry] }));
  assert.equal((await context.handleAiKbImport({ text: '随口说一些东西' })).added, 1);
  assert.equal(calls.at(-1).cfg.maxTokens, 8192);
  const snapshot = json(store.knowledge_base);
  responses.push('not json', '{"entries":[');
  await assert.rejects(context.handleAiKbImport({ text: '有错误的返回' }), /尚未入库/);
  assert.equal(json(store.knowledge_base), snapshot);
  responses.push('{"entries":[]}');
  await assert.rejects(context.handleAiKbImport({ text: '你好' }), /没有提炼/);
  assert.equal(json(store.knowledge_base), snapshot);
  const imported = { ...entry, content: '新的内容', tags: ['保留标签'], role: '顾问', isActive: false };
  const saved = await context.handleAiKbImport({ text: '\uFEFF' + json([imported]), format: 'file', filename: '知识.json' });
  assert.equal(saved.updated, 1);
  assert.equal(store.knowledge_base[0].isActive, false);
  assert.deepEqual(store.knowledge_base[0].tags, ['保留标签']);
  assert.equal((await context.handleAiKbImport({ text: json([imported]), format: 'file', filename: '知识.json' })).skipped, 1);
  await context.handleAiKbSave({ entries: [{ title: entry.title, content: '更新事实' }] });
  assert.equal(store.knowledge_base[0].isActive, false);
  assert.equal(store.knowledge_base[0].role, '顾问');
  for (const text of ['{坏文件', '[]', '[{"title":"缺内容"}]', json([entry, { title: '坏条目' }])]) {
    const old = json(store.knowledge_base);
    await assert.rejects(context.handleAiKbImport({ text, format: 'file', filename: 'bad.json' }));
    assert.equal(json(store.knowledge_base), old);
  }
  responses.push(json({ entries: [{ ...entry, title: 'Markdown知识' }] }));
  await context.handleAiKbImport({ text: '[笔记] 是普通Markdown内容', format: 'file', filename: 'notes.md' });
  await Promise.all([context.handleAiKbSave({ entries: [{ title: '并发A', content: 'a' }] }), context.handleAiKbSave({ entries: [{ title: '并发B', content: 'b' }] })]);
  assert.ok(store.knowledge_base.some(e => e.title === '并发A'));
  assert.ok(store.knowledge_base.some(e => e.title === '并发B'));
  const id = store.knowledge_base[0].id;
  await context.handleUpdateKnowledgeEntry({ id, updates: { isActive: true } });
  assert.equal(store.knowledge_base[0].isActive, true);
  await assert.rejects(context.handleUpdateKnowledgeEntry({ id, updates: { title: '并发A' } }), /同标题/);
  responses.push(() => { store.current_tenant_id = 'other'; return json({ entries: [{ ...entry, title: '跨产品', content: '不得写入' }] }); });
  await assert.rejects(context.handleAiKbImport({ text: '处理中切换产品' }), /产品已切换/);
  assert.ok(!store.knowledge_base.some(e => e.title === '跨产品'));
  reset();
  responses.push('我是产品设计师。\ncoverHook:耐心朋友', json({ productName: '试用工具', guideText: '私信我', sellPoints: [{ title: '方便试用', content: '先体验再决定' }] }), json({ entries: [entry] }), json(plan));
  const synced = await context.handleAiDiagnosisSync(quiz);
  assert.equal(synced.complete, true);
  assert.equal(calls.length, 4);
  assert.ok(calls[0].user.includes('问') && calls[0].user.includes('耐心朋友') && calls[0].user.includes('每周两次'));
  assert.ok(calls[1].user.includes('Q4. 经历\nA4. 亲自体验'));
  assert.equal(store.config.product.name, '试用工具');
  assert.equal(store.config.product.coverHook, '耐心朋友');
  assert.equal(store.config.product.cta, '保留封面');
  assert.equal(store.config.scriptStyle.toneMannerisms, '别覆盖');
  assert.equal(store.config.diagnosis.answers.length, 10);
  assert.equal(store.note_plan.contentFocus, plan.contentFocus);
  await context.handleAiDiagnosisSync({ ...quiz, accountType: plan.accountType });
  assert.equal(calls.length, 4);
  reset();
  responses.push('我是产品设计师', json({ sellPoints: [{ title: '试用', content: '可体验' }] }), new Error('网络超时'));
  const failed = await context.handleAiDiagnosisSync(quiz);
  assert.equal(failed.complete, false);
  assert.equal(failed.diagnosis.results.persona.status, 'done');
  assert.equal(failed.diagnosis.results.knowledge.status, 'error');
  assert.equal(failed.diagnosis.results.plan.status, 'error');
  responses.push(json({ entries: [entry] }), json(plan));
  assert.equal((await context.handleAiDiagnosisSync(quiz)).complete, true);
  assert.equal(calls.length, 5);
  responses.push('更新人设', json({ sellPoints: [{ title: '试用', content: '最新体验' }] }), json({ entries: [{ ...entry, content: '更新事实' }] }), json(plan));
  const changed = clone(quiz); changed.answers[1].answer = '新的产品信息';
  assert.equal((await context.handleAiDiagnosisSync(changed)).complete, true);
  assert.equal(calls.length, 9);
  assert.equal(store.knowledge_base.length, 1);
  assert.equal(store.knowledge_base[0].content, '更新事实');
  await assert.rejects(context.handleAiDiagnosisSync({ answers: [] }), /至少回答/);
  reset();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  responses.push(async () => { await pending; return '测试人设'; }, json({ sellPoints: [{ title: '试用', content: '可体验' }] }), json({ entries: [entry] }), json(plan));
  const syncing = context.handleAiDiagnosisSync(quiz);
  await assert.rejects(context.handleAiDiagnosisSync(quiz), /正在同步/);
  release();
  assert.equal((await syncing).complete, true);
  const originalSet = context.Storage.set;
  context.Storage.set = async () => { throw new Error('磁盘写入失败'); };
  await assert.rejects(context.handleAiKbSave({ entries: [{ title: '保存失败', content: '不能报成功' }] }), /写入失败/);
  context.Storage.set = originalSet;
  assert.equal((await context.handleAiKbSave({ entries: [{ title: '重试保存', content: '恢复后可保存' }] })).added, 1);
  assert.ok(!store.knowledge_base.some(e => e.title === '保存失败'));
  console.log('PASS: JSON extraction, AI normalization/retry, file merge, metadata, concurrent writes, tenant isolation, quiz sync/resume/changed answers, duplicate submission and storage failures');
}
run().catch(e => { console.error(e); process.exitCode = 1; });
