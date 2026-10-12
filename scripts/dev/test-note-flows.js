'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const source = name => fs.readFileSync(path.join(root, 'extension', name), 'utf8');
const background = source('background.js');
const drainSource = source('lib/scenario-drain.js');
const waterSource = source('lib/auto-water.js');
const platformsSource = source('lib/platforms.js');
const clone = value => structuredClone(value);
const tick = () => new Promise(resolve => setImmediate(resolve));
const id = n => n.toString(16).padStart(24, '0');
const url = (n, route = 'explore', token = 'local-mock') =>
  `https://www.xiaohongshu.com/${route}/${id(n)}?xsec_token=${token}&xsec_source=pc_search`;
const card = (n, extra = {}) => ({ noteId: id(n), title: `note-${n}`, url: url(n), ...extra });

// Extract actual top-level declarations, including the real JSON parser and AI adapter.
// Do not execute background startup (listeners, timers, importScripts, etc.).
function backgroundFunction(name) {
  const match = new RegExp(`^(?:async )?function ${name}\\([^]*?^}`, 'm').exec(background);
  assert.ok(match, `Cannot locate background function: ${name}`);
  return match[0];
}
/** 顶层常量表（字量档 / 图描述写法 / 口播风格）：单行先认，跨行取到「某一整行以分号收尾」为止 */
function backgroundConst(name) {
  const single = new RegExp(`^(?:const|let|var) ${name} =[^\\n]*$`, 'm').exec(background);
  if (single && /;$/.test(single[0])) return single[0];
  const match = new RegExp(`^(?:const|let|var) ${name} =[^]*?^.*;$`, 'm').exec(background);
  assert.ok(match, `Cannot locate background const: ${name}`);
  return match[0];
}
const aiSource = ['getPersonaText', 'prodNamesOf', 'prodLabelOf', 'parseJsonObject', '_chatAi', '_chatAiRetry', '_npProductContext', '_npKbByQuery', '_npStreamProgress', '_npPlatformOf', 'parseNoteJson',
  'aiGeneratePeopleBg', 'aiGenerateTopicsBg', 'aiRewriteNoteBg', 'reviseNoteBg', 'suggestNoteCutsBg', 'regenNoteDescsBg', '_npShotMotifRule', 'genNoteVoiceScriptBg', 'voiceRewriteBg']
  .map(backgroundFunction).join('\n\n');
const aiConstSource = ['NP_SHOT_INK_RULES', 'NP_DESC_SHAPE', 'NP_VOICE_STYLES'].map(backgroundConst).join('\n\n');

function createMemoryStorage(seed) {
  const state = clone(seed);
  let failedDrainWrites = 0;
  let readGate = null;
  const stats = { reads: 0, writes: 0, failedWrites: 0 };
  const local = {
    async get(keys) {
      stats.reads++;
      const requested = keys == null ? Object.keys(state)
        : typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const result = {};
      for (const key of requested) {
        if (Object.hasOwn(state, key)) result[key] = clone(state[key]);
        else if (keys && !Array.isArray(keys) && typeof keys === 'object') result[key] = clone(keys[key]);
      }
      // Capture detached data before yielding: concurrent non-queued writers really do race.
      const gate = requested.includes('drain_notes') ? readGate : null;
      if (gate) {
        readGate = null;
        gate.entered();
        await gate.wait;
      }
      await tick();
      return result;
    },
    async set(values) {
      const detached = clone(values);
      await tick();
      stats.writes++;
      if (Object.hasOwn(detached, 'drain_notes') && failedDrainWrites > 0) {
        failedDrainWrites--;
        stats.failedWrites++;
        throw new Error('mock storage write failure');
      }
      Object.assign(state, detached);
    },
    async remove(keys) {
      await tick();
      for (const key of Array.isArray(keys) ? keys : [keys]) delete state[key];
    },
  };
  return {
    local, stats,
    failNextDrainWrite() { failedDrainWrites++; },
    holdNextDrainRead() {
      assert.equal(readGate, null);
      let entered, release;
      const ready = new Promise(resolve => { entered = resolve; });
      const wait = new Promise(resolve => { release = resolve; });
      readGate = { entered, wait };
      return { ready, release };
    },
  };
}

function harness(seed = {}) {
  const memory = createMemoryStorage({
    mock_config: { ai: { apiKey: 'mock-only' }, product: { name: 'mock product', description: 'offline' } },
    mock_knowledge: [], mock_water_config: {}, mock_water_state: { phase: 'IDLE' },
    ...seed,
  });
  const local = memory.local;
  const clock = { now: 1700000000000 };
  class MockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  }
  const ai = { raw: '', calls: [] };
  const browser = { updates: [], messages: [], logs: [] };
  const forbidden = name => () => { throw new Error(`Unexpected external operation: ${name}`); };
  const read = async (key, fallback) => (await local.get(key))[key] ?? fallback;
  const Storage = {
    getConfig: () => read('mock_config', {}),
    getKnowledgeBase: () => read('mock_knowledge', []),
    getAutoWaterState: () => read('mock_water_state', { phase: 'IDLE' }),
    setAutoWaterState: value => local.set({ mock_water_state: value }),
    getAutoWaterConfig: () => read('mock_water_config', {}),
    setAutoWaterConfig: value => local.set({ mock_water_config: value }),
    isNoteWatered: async () => false,
  };
  const context = vm.createContext({
    Date: MockDate, URL,
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => browser.logs.push([level, ...args])])),
    fetch: forbidden('fetch'), XMLHttpRequest: forbidden('XMLHttpRequest'), WebSocket: forbidden('WebSocket'),
    setTimeout: forbidden('timer (mock the waiting boundary)'), setInterval: forbidden('interval'),
    chrome: {
      storage: { local },
      tabs: {
        async update(tabId, data) { browser.updates.push(clone({ tabId, data })); return { id: tabId, ...data }; },
        query: forbidden('tabs.query'), create: forbidden('tabs.create'), sendMessage: forbidden('tabs.sendMessage'),
      },
      windows: {
        async getLastFocused() { return { id: 10, tabs: [{ id: 11, active: true }] }; },
        async update(windowId, data) { return { id: windowId, ...data }; },
      },
      scripting: { executeScript: forbidden('script injection') },
    },
    Storage,
    AiClient: {
      async chatCompletion(config, system, user) {
        assert.equal(config.apiKey, 'mock-only');
        ai.calls.push({ system, user });
        return { content: ai.raw };
      },
    },
  });
  vm.runInContext(drainSource, context, { filename: path.join(root, 'extension/lib/scenario-drain.js'), timeout: 2000 });
  vm.runInContext(waterSource, context, { filename: path.join(root, 'extension/lib/auto-water.js'), timeout: 2000 });
  // 八发提示词现在按平台取规则段：平台基座也得进这个 VM（globalThis.Platforms）
  vm.runInContext(platformsSource, context, { filename: path.join(root, 'extension/lib/platforms.js'), timeout: 2000 });
  // 没点选素材时 _npProductContext 会按「卖点×人群」先把知识库筛一遍，用的是这套本地打分
  vm.runInContext(source('lib/knowledge-search.js'), context, { filename: path.join(root, 'extension/lib/knowledge-search.js'), timeout: 2000 });
  // 发笔记生成要按 ⑧ 的排产表与 🎨 调子写（NotePlan.*）：数据层也得进这个 VM
  vm.runInContext(source('lib/note-plan.js') + '\n;globalThis.NotePlan = NotePlan;', context, { filename: path.join(root, 'extension/lib/note-plan.js'), timeout: 2000 });
  // 画面流派（造图片 ① 那一轴）是断句／图描述那两发的取材真源：数据层也要进这个 VM
  vm.runInContext(source('lib/visual-motif.js') + '\n;globalThis.VisualMotif = VisualMotif;', context, { filename: 'extension/lib/visual-motif.js', timeout: 2000 });
  vm.runInContext(aiConstSource + '\n\n' + aiSource, context, { filename: 'background.js (actual selected declarations)', timeout: 2000 });
  const api = vm.runInContext('({ aiGeneratePeopleBg, aiGenerateTopicsBg, aiRewriteNoteBg, reviseNoteBg, suggestNoteCutsBg, regenNoteDescsBg, genNoteVoiceScriptBg, voiceRewriteBg, drainLoad, drainUpdateNotes, drainMergeNotes, drainGetScanCfg, drainSaveScanCfg, drainBuildSources, drainJudge, drainMergeMyComment, drainScenarioId, drainDecideOpen, drainGetReplenishCfg, drainSaveReplenishCfg, handleDrainTrackNotes, handleDrainTrackNote, _mergeAutoWaterFound, AutoWater })', context);
  return {
    ...api, memory, local, clock, ai, browser, Storage,
    notes: () => api.drainLoad(),
    async people(payload, raw = false) {
      ai.raw = raw ? payload : JSON.stringify(payload);
      return clone(await api.aiGeneratePeopleBg({ sellPoints: ['offline selling point'] }));
    },
    async topics(payload, raw = false) {
      ai.raw = raw ? payload : JSON.stringify(payload);
      return clone(await api.aiGenerateTopicsBg({ sellPoints: ['offline selling point'], people, usedPool: [] }));
    },
  };
}

function mockWaterBrowser(h, respond) {
  h.AutoWater._getXhsTab = async () => ({ id: 7, windowId: 8, url: 'https://www.xiaohongshu.com/search_result?keyword=mock' });
  h.AutoWater._waitForTabLoad = async () => {};
  h.AutoWater._sleep = async () => {};
  h.AutoWater._waitNoteReady = async () => true;
  h.AutoWater._send = async (tabId, message) => {
    assert.equal(tabId, 7);
    h.browser.messages.push(clone(message));
    return clone(await respond(message));
  };
}

const tests = [];
const test = (name, run) => tests.push({ name, run });
const people = [{ name: ' first audience ', pain: 'pain', scene: 'scene', timing: 'timing' }, { name: 'second audience' }];
const topics = [{ topic: ' first topic ', fact: ' 一句真事 ', target: 'target', rationale: 'reason' }];

test('VM/storage isolation and detached get/set snapshots', async () => {
  const a = harness(), b = harness();
  const value = { probe: { nested: [1] } };
  await a.local.set(value);
  value.probe.nested.push(2);
  const snapshot = await a.local.get('probe');
  snapshot.probe.nested.push(3);
  assert.deepEqual(await a.local.get('probe'), { probe: { nested: [1] } });
  assert.deepEqual(await b.local.get('probe'), {});
  await a.handleDrainTrackNote(card(1));
  assert.equal((await a.notes()).length, 1);
  assert.equal((await b.notes()).length, 0);
});

test('人群那一发只认 people_options', async () => {
  const h = harness();
  const result = await h.people({ people_options: people });
  assert.deepEqual(result.people_options.map(p => p.name), ['first audience', 'second audience']);
  assert.equal(result.people.who, 'first audience');
  assert.equal(h.ai.calls.length, 1);
});

test('人群那一发向后兼容旧的 people 单对象', async () => {
  const h = harness();
  const legacy = { who: ' legacy audience ', pain: 'legacy pain', scene: 'legacy scene', timing: 'today' };
  const result = await h.people({ people: legacy });
  assert.equal(result.people_options.length, 1);
  assert.equal(result.people_options[0].name, 'legacy audience');
  assert.equal(result.people_options[0].pain, 'legacy pain');
  assert.deepEqual(result.people, legacy);
});

// 人群不可用时必须报「人群」的错：一次只算一半，报错也得说清是哪一半
for (const [label, payload] of [
  ['missing people arrays', {}],
  ['empty people_options', { people_options: [] }],
  ['null people_options', { people_options: null }],
  ['non-array people_options', { people_options: { name: 'bad shape' } }],
  ['null people_options member', { people_options: [null] }],
  ['invalid people_options members', { people_options: [false, 42, 'bad', {}] }],
  ['blank audience name', { people_options: [{ name: '  ' }] }],
]) {
  test(`AI rejects ${label}`, async () => {
    const h = harness();
    await assert.rejects(() => h.people(payload), /AI 未返回有效人群/);
    assert.equal(h.ai.calls.length, 1, 'Rejection must come after the mocked AI reply');
  });
}
for (const raw of ['{"people_options":[', 'not JSON', 'null']) {
  test(`AI rejects invalid/non-object JSON: ${raw}`, async () => {
    const h = harness();
    await assert.rejects(() => h.people(raw, true), /AI 未返回有效人群/);
    assert.equal(h.ai.calls.length, 1);
  });
}

test('话题那一发认 topics，并把已选人群写进提示词', async () => {
  const h = harness();
  const result = await h.topics({ topics });
  assert.equal(result.topics[0].topic, 'first topic');
  assert.equal(result.topics[0].rationale, 'reason');
  assert.equal(result.topics[0].fact, '一句真事', '四十六改：题底下那句真事要收下来（前后空格去掉）');
  assert.equal(h.ai.calls.length, 1);
  // 话题是按人群写的：人群必须进 user 提示词，否则 AI 又会自己另起一拨人
  assert.match(h.ai.calls[0].user, /first audience/);
});

for (const [label, payload] of [
  ['missing topics', {}],
  ['empty topics', { topics: [] }],
  ['null topics', { topics: null }],
  ['non-array topics', { topics: { topic: 'bad shape' } }],
  ['null topics member', { topics: [null] }],
  ['invalid topics members', { topics: [false, 42, 'bad', {}] }],
  ['blank topic', { topics: [{ topic: '  ' }] }],
]) {
  test(`AI rejects ${label}`, async () => {
    const h = harness();
    await assert.rejects(() => h.topics(payload), /AI 未返回有效话题/);
    assert.equal(h.ai.calls.length, 1, 'Rejection must come after the mocked AI reply');
  });
}
for (const raw of ['{"topics":[', 'not JSON', 'null']) {
  test(`AI rejects invalid/non-object JSON: ${raw}`, async () => {
    const h = harness();
    await assert.rejects(() => h.topics(raw, true), /AI 未返回有效话题/);
    assert.equal(h.ai.calls.length, 1);
  });
}

// ─── ④ 成稿 / 改稿 / ⑤ 图文提示词 / 口播稿：四发 AI 的清洗与兜底 ───
const body = '开场钩子。\n\n第一段干货。\n\n结尾引导。';

test('成稿那一发剥掉 A/B/C 前缀、截断封面三段式，并给出可复制的整段文案', async () => {
  const h = harness();
  h.ai.raw = JSON.stringify({
    titles: ['A. 强钩子标题', 'B、悬念标题', 'C: 干货标题'],
    content: body, tags: [' 效率 ', ''], timeTip: '12:00-13:00', selfComment: '评论区聊聊。',
    cover: { title: '这是一句明显超过十二个字的封面大标题', subtitle: '副标题也超过十六个字了真的', points: ['一', '二', '三', '四'] },
  });
  const r = await h.aiRewriteNoteBg({ topic: '测试话题' });
  assert.deepEqual([...r.data.titles], ['强钩子标题', '悬念标题', '干货标题']);
  assert.equal(r.data.content, body);
  assert.deepEqual([...r.data.tags], ['效率']);
  assert.equal(r.data.cover.title.length, 12, '封面标题按 12 字截断');
  assert.equal(r.data.cover.points.length, 3, '封面卖点最多 3 条');
  assert.equal(r.copy, '强钩子标题\n' + body + '\n#效率');
});

test('成稿那一发没给 JSON 时退回整段文案，别让成稿变成一句"没写出内容"', async () => {
  const h = harness();
  h.ai.raw = '标题\n' + body;
  const r = await h.aiRewriteNoteBg({ topic: '测试话题' });
  assert.equal(r.data, null);
  assert.equal(r.copy, '标题\n' + body);
});

test('改稿那一发认 ```json 围栏，标题只在模型给了才回；标签最多 8 个', async () => {
  const h = harness();
  h.ai.raw = '```json\n{"content":"改好的正文。","tags":[' + Array.from({ length: 10 }, (_, i) => `"t${i}"`).join(',') + ']}\n```';
  const r = await h.reviseNoteBg({ content: body, ask: '再短一点' });
  assert.equal(r.content, '改好的正文。');
  assert.equal(r.tags.length, 8);
  assert.equal(r.titles, undefined, '没让换标题就别往回塞标题');
  assert.match(h.ai.calls[0].user, /【现有正文】/);
  assert.match(h.ai.calls[0].user, /【这次要怎么改】再短一点/);
});

test('改稿那一发：模型给了标题就剥掉 A/B/C 前缀，只留 3 条', async () => {
  const h = harness();
  h.ai.raw = JSON.stringify({ content: '改好的正文。', titles: ['A. 一', 'B. 二', 'C. 三', 'D. 四'] });
  const r = await h.reviseNoteBg({ content: body, ask: '标题换一批' });
  assert.deepEqual([...r.titles], ['一', '二', '三']);
});

for (const [label, payload, ask, pattern] of [
  ['没正文', { content: '  ' }, '再短一点', /还没有正文可改/],
  ['没说怎么改', { content: body }, '   ', /先说一句想怎么改/],
]) {
  test(`改稿那一发拒绝 ${label}`, async () => {
    const h = harness();
    await assert.rejects(() => h.reviseNoteBg({ ...payload, ask }), pattern);
    assert.equal(h.ai.calls.length, 0, '本地就该拦下，别浪费一发 AI');
  });
}

test('改稿那一发：模型空手而归要报错，不能把原稿当改稿糊回去', async () => {
  const h = harness();
  h.ai.raw = '{"content":""}';
  await assert.rejects(() => h.reviseNoteBg({ content: body, ask: '再短一点' }), /AI 没给出改后的正文/);
});

// ─── ② 断句台：段由人拖，AI 只剩 🔮 建议断点；③ 图描述按流派 🔁 重出 ───
const sents = [
  { id: 's01', text: '开场钩子。' },
  { id: 's02', text: '第一段干货。' },
  { id: 's03', text: '它后面紧跟一句补充。' },
  { id: 's04', text: '结尾引导。' },
];

test('🔮 建议断点认 ```json 围栏与中文键：只回「该在哪儿断一刀」，不回段', async () => {
  const h = harness();
  h.ai.raw = '```json\n' + JSON.stringify({
    断点: [
      { 句: 's01', 理由: '下一句换个画面' },
      { 句: 's03', 理由: '这段讲完了，收尾另起一张' },
    ],
  }) + '\n```';
  const r = clone(await h.suggestNoteCutsBg({ title: '标题', sents }));
  assert.deepEqual(r.cuts, [{ after: 's01', why: '下一句换个画面' }, { after: 's03', why: '这段讲完了，收尾另起一张' }]);
  assert.equal(r.n, 4);
  const sys = h.ai.calls[0].system;
  assert.match(sys, /只做一件事：标出「该在哪儿断一刀」/);
  assert.match(sys, /不许改写句子、不许合并、不许删句/);
  assert.match(sys, /你给的每一刀只是建议，他点一下才生效/);
  assert.match(h.ai.calls[0].user, /\[s01\] 开场钩子。（还没归段）/);
  assert.doesNotMatch(h.ai.calls[0].user, /【正文】/, '句子已经在台面上逐句列好了，别再整篇正文喂一遍');
});

test('🔮 英文键 cuts/after/why 也认；对不上号的编号丢掉，最多 10 刀、理由收口', async () => {
  const h = harness();
  h.ai.raw = JSON.stringify({
    cuts: [{ after: 'nope', why: '清单里根本没有这个编号' }]
      .concat(Array.from({ length: 12 }, (_, i) => ({ after: 's0' + ((i % 4) + 1), why: '理由'.repeat(30) }))),
  });
  const r = clone(await h.suggestNoteCutsBg({ sents }));
  assert.equal(r.cuts.length, 10, '刀提得再多，台面上也只摆 10 把');
  assert.ok(r.cuts.every(x => x.after !== 'nope'), '对不上号的编号不能落到界面上等人点');
  assert.equal(r.cuts[0].after, 's01');
  assert.equal(r.cuts[0].why.length, 40, '提示词里要求 ≤24 字，超了本地按 40 字截');
});

test('🔮 哪一句已经在第几段要告诉它：别在两段接缝处再提同一刀', async () => {
  const h = harness();
  h.ai.raw = '{"断点":[]}';
  await h.suggestNoteCutsBg({ sents, segs: [{ sids: ['s01', 's02'] }, { sids: ['s03'] }] });
  const user = h.ai.calls[0].user;
  assert.match(user, /\[s01\] 开场钩子。（已在第 1 段）/);
  assert.match(user, /\[s03\] 它后面紧跟一句补充。（已在第 2 段）/);
  assert.match(user, /\[s04\] 结尾引导。（还没归段）/);
  assert.match(user, /【台面上已经切好的段（每段里是句子编号）】\n第 1 段：s01 \/ s02\n第 2 段：s03/);
  h.ai.raw = '{"断点":[]}';
  await h.suggestNoteCutsBg({ sents });
  assert.match(h.ai.calls[1].user, /台面上还没切出任何一段/);
});

test('🔮 一份文案只列出一句话时本地拦下：不烧那一发 AI', async () => {
  const h = harness();
  await assert.rejects(() => h.suggestNoteCutsBg({ sents: sents.slice(0, 1) }), /只列出一句话，不用建议断点/);
  await assert.rejects(() => h.suggestNoteCutsBg({ sents: [] }), /只列出一句话，不用建议断点/);
  assert.equal(h.ai.calls.length, 0);
});

for (const [label, raw] of [['不是 JSON', '我断好了：第一段、第二段'], ['截断的 JSON', '{"断点":'], ['整段是 null', 'null']]) {
  test(`🔮 ${label}要报错，别在界面上摆一排空刀`, async () => {
    const h = harness();
    h.ai.raw = raw;
    await assert.rejects(() => h.suggestNoteCutsBg({ sents }), /没回能用的断点/);
    assert.equal(h.ai.calls.length, 1);
  });
}

test('🔮 流派只喂取材三句、字量档管一屏装几句，风格那一行只当背景', async () => {
  const h = harness();
  h.ai.raw = '{"断点":[]}';
  await h.suggestNoteCutsBg({ sents, motif: '方案页', ink: 'full', look: '蓝白扁平、字压在下方留白', sellPoint: '把重复步骤压掉' });
  const sys = h.ai.calls[0].system;
  assert.match(sys, /【这一套图的取材路子】· 长什么样：/, '流派三句都要进（长什么样／这段要变成什么料／这样算不合格）');
  assert.match(sys, /· 这样算不合格（这一派最常见的偷懒）：/);
  assert.match(sys, /【本次画面流派】方案页/);
  assert.match(sys, /这张要把整段原文上屏/, '字量档 full 决定一屏装得下多少句');
  assert.match(sys, /这一套图长这样：蓝白扁平[\s\S]*别自己发明风格/);
  assert.match(sys, /【产品】mock product/);
  assert.match(h.ai.calls[0].user, /【主打卖点】把重复步骤压掉/);
  h.ai.raw = '{"断点":[]}';
  await h.suggestNoteCutsBg({ sents });
  assert.match(h.ai.calls[1].system, /客户没定：按每段说的事切/, '没选流派也要说清按什么切，别让模型自己发明一套派');
  assert.match(h.ai.calls[1].system, /≤10 字/, '字量档没给就按最省的少字档走');
});

const segItems = [
  { id: 'g1', text: '开场钩子。第一段干货。', no: 1, total: 2 },
  { id: 'g2', text: '结尾引导。', no: 2, total: 2 },
];

test('🔁 重出图描述：段原文照抄回来对号，切几段／段的字都不归它管', async () => {
  const h = harness();
  h.ai.raw = JSON.stringify({
    风格: '它自己又编了一套长相',
    画面: [
      { 句: '开场钩子。第一段干货。', 图描述: '『中心思想』…『取材』一个人、两沓便签、一台开着后台的电脑…' },
      { 句: '结尾引导。', 图描述: '『中心思想』…『版式』…' },
    ],
  });
  const r = clone(await h.regenNoteDescsBg({ motif: '方案页', items: segItems, content: body }));
  assert.deepEqual(r.descs.map(x => x.id), ['g1', 'g2'], '顺序与条数都得跟那份清单一致');
  assert.equal(r.descs[0].desc, '『中心思想』…『取材』一个人、两沓便签、一台开着后台的电脑…');
  assert.equal(r.motif, '方案页');
  const sys = h.ai.calls[0].system;
  assert.match(sys, /段怎么切、切了几段、段的原文都不归你管/);
  assert.match(sys, /『图上文字＋增量』/, '四小段写法要喂进去，不然又写成这段文字的配图');
  assert.match(sys, /要数得出至少三个画面上的名词/);
  assert.match(sys, /「风格」不用你给（留空字符串）/);
  assert.match(sys, /【这一套图的取材路子】· 长什么样：/);
  assert.match(sys, /条数＝2 条，顺序跟下面那份清单一致/, '不重样与主次要按第几张来说，条数也得钉死');
});

test('🔁 回来条数对不上时按段原文对号，空的图描述过滤掉（别把邻张串过来）', async () => {
  const h = harness();
  h.ai.raw = JSON.stringify({ 画面: [{ 句: '结尾引导。', 图描述: '收口那一张' }] });
  const r = clone(await h.regenNoteDescsBg({ motif: '方案页', items: segItems }));
  assert.deepEqual(r.descs, [{ id: 'g2', desc: '收口那一张' }], '对不上号的那一段留空＝不覆盖人已写的描述');
});

test('🔁 前后各是什么段、整篇原文都要给它，但写明别抄进图描述', async () => {
  const h = harness();
  h.ai.raw = '{"画面":[{"句":"开场钩子。第一段干货。","图描述":"…"}]}';
  await h.regenNoteDescsBg({ motif: '方案页', items: [segItems[0]], content: body, platform: 'douyin' });
  const user = h.ai.calls[0].user;
  assert.match(user, /前一段：（这就是第一张）\n本段（要写的就是它）：开场钩子。第一段干货。/);
  assert.match(user, /【整篇原文（只重写下面列出的那几段；这段全文别抄进图描述）】/);
  assert.match(user, /【画面尺寸】竖版 9:16/, '尺寸按平台取，别沿用小红书的 3:4');
});

test('🔁 这一派没有取材规则可读／一段都还没拖：本地拦下，不烧 AI', async () => {
  const h = harness();
  await assert.rejects(() => h.regenNoteDescsBg({ items: segItems }), /这一派没有取材规则可读/);
  await assert.rejects(() => h.regenNoteDescsBg({ motif: '这一派根本不存在', items: segItems }), /这一派没有取材规则可读/);
  await assert.rejects(() => h.regenNoteDescsBg({ motif: '方案页', items: [] }), /那一行还没断句/);
  assert.equal(h.ai.calls.length, 0, '拦下都在 AI 之前');
});

for (const [label, raw, pattern] of [
  ['没回 JSON', '图描述我写好了：第一张…', /AI 这次没回图描述/],
  ['画面数组是空的', '{"画面":[]}', /AI 这次没回图描述/],
  ['回来的图描述全是空的', '{"画面":[{"句":"开场钩子。第一段干货。","图描述":"  "},{"句":"结尾引导。","图描述":""}]}', /图描述是空的/],
]) {
  test(`🔁 ${label}要报错，不能给用户一张空表`, async () => {
    const h = harness();
    h.ai.raw = raw;
    await assert.rejects(() => h.regenNoteDescsBg({ motif: '方案页', items: segItems }), pattern);
  });
}

test('口播稿那一发洗掉 ``` 和「口播稿：」前缀，带回原笔记与人群', async () => {
  const h = harness();
  h.ai.raw = '```\n口播稿：一个人做小红书，凌晨还在发笔记。\n私信我。\n```';
  const r = await h.genNoteVoiceScriptBg({ title: '标题', content: body, people: [{ name: '老板' }] });
  assert.equal(r.script, '一个人做小红书，凌晨还在发笔记。\n私信我。');
  assert.match(h.ai.calls[0].user, /【原笔记正文】/);
  assert.match(h.ai.calls[0].user, /【面向人群】老板/);
});

test('口播稿改一版洗前缀，并把现有稿子与要求都带上', async () => {
  const h = harness();
  h.ai.raw = '```\n旁白：改好的第一句。\n改好的第二句。\n```';
  const r = await h.voiceRewriteBg({ script: '原稿第一句。', ask: '更口语一点', ctx: '【原笔记正文】\n正文。' });
  assert.equal(r.script, '改好的第一句。\n改好的第二句。');
  assert.match(h.ai.calls[0].user, /【现有口播稿】\s*原稿第一句。/);
  assert.match(h.ai.calls[0].user, /【这次要怎么改】更口语一点/);
  assert.match(h.ai.calls[0].user, /【整合资料（事实来源，别编）】/);
  assert.match(h.ai.calls[0].system, /不承诺效果/);
});

for (const [label, payload, pattern] of [
  ['没稿子', { script: '  ', ask: '更口语一点' }, /还没有口播稿可改/],
  ['没说怎么改', { script: '原稿。', ask: ' ' }, /先说一句想怎么改/],
]) {
  test(`口播稿改一版拒绝 ${label}`, async () => {
    const h = harness();
    await assert.rejects(() => h.voiceRewriteBg(payload), pattern);
    assert.equal(h.ai.calls.length, 0);
  });
}

test('口播稿改一版：模型空手而归要报错', async () => {
  const h = harness();
  h.ai.raw = '```\n```';
  await assert.rejects(() => h.voiceRewriteBg({ script: '原稿。', ask: '更口语一点' }), /AI 没给出内容/);
});

test('Batch deduplicates noteId, not title, and preserves metrics on repeated cards', async () => {
  const h = harness();
  const result = await h.handleDrainTrackNotes({ notes: [
    card(1, { title: 'same title', likes: '1.2万', commentsCount: 12 }),
    card(1, { title: 'same title' }),
    card(2, { title: 'same title', likes: '2.5k' }),
  ] });
  assert.equal(result.ok, true);
  assert.equal(result.added, 2);
  assert.equal(result.total, 2);
  const notes = await h.notes();
  assert.deepEqual(notes.map(n => n.noteId).sort(), [id(1), id(2)]);
  assert.equal(notes.find(n => n.noteId === id(1)).signals.likes, 12000);
  assert.equal(notes.find(n => n.noteId === id(1)).signals.comments, 12);
  assert.equal(notes.find(n => n.noteId === id(2)).signals.likes, 2500);
});

test('Tokenized explore/discovery URLs deduplicate URL-only legacy notes and preserve scenario/signals', async () => {
  const legacy = {
    id: 'legacy-row', url: url(3), title: 'old title', author: 'old author', scenario: 'evergreen',
    state: 'monitoring', addedAt: 123, lastSeenAt: 100, missRounds: 2,
    signals: { likes: 9876, comments: 43, rank: 2, delta: 19, collects: 88 },
  };
  const h = harness({ drain_notes: [legacy] });
  const result = await h.handleDrainTrackNotes({ notes: [
    { url: `${url(3, 'discovery/item', 'different-token')}#detail`, title: 'new title' },
    { url: url(3, 'explore', 'third-token'), author: 'new author' },
  ] });
  assert.equal(result.added, 0);
  const notes = await h.notes();
  assert.equal(notes.length, 1);
  assert.equal(notes[0].id, legacy.id);
  assert.equal(notes[0].noteId, id(3));
  assert.equal(notes[0].url, url(3, 'explore', 'third-token'));
  assert.equal(notes[0].scenario, 'top', 'legacy evergreen migrates to top on read');
  assert.equal(legacy.scenario, 'evergreen', 'the seed snapshot itself is not mutated');
  assert.equal(notes[0].state, legacy.state);
  assert.equal(notes[0].addedAt, 123);
  assert.equal(notes[0].title, 'new title');
  assert.equal(notes[0].author, 'new author');
  assert.deepEqual(notes[0].signals, { ...legacy.signals, title: 'new title' });
  assert.equal(notes[0].lastSeenAt, h.clock.now);
  assert.equal(notes[0].missRounds, 0);
});

test('Likes normalize 万/k/K/w/comma/numeric zero; omitted/invalid metrics do not erase values', async () => {
  const h = harness();
  const values = [['1.2万', 12000], ['2.5k', 2500], ['3K', 3000], ['1.5w', 15000], ['1,234', 1234], [0, 0]];
  for (let i = 0; i < values.length; i++) {
    await h.handleDrainTrackNote(card(10 + i, { likes: values[i][0] }));
    assert.equal((await h.notes()).find(n => n.noteId === id(10 + i)).signals.likes, values[i][1]);
  }
  await h.handleDrainTrackNote(card(20, { likes: 500, commentsCount: 8 }));
  for (const metrics of [{}, { likes: null, commentsCount: null }, { likes: '' }, { likes: 'unknown' }]) {
    await h.handleDrainTrackNote(card(20, metrics));
    const saved = (await h.notes()).find(n => n.noteId === id(20));
    assert.equal(saved.signals.likes, 500);
    assert.equal(saved.signals.comments, 8);
  }
  await h.handleDrainTrackNote(card(20, { likes: 0, commentsCount: 0 }));
  const saved = (await h.notes()).find(n => n.noteId === id(20));
  assert.equal(saved.signals.likes, 0);
  assert.equal(saved.signals.comments, 0);
});

test('Invalid/empty tracking inputs create no notes; single wrapper still accepts URL-only data', async () => {
  const h = harness();
  assert.equal((await h.handleDrainTrackNotes({ notes: [] })).added, 0);
  assert.equal((await h.handleDrainTrackNotes({ notes: [null, {}, { title: 'ID missing' }] })).tracked, 0);
  assert.equal((await h.handleDrainTrackNote(null)).ok, false);
  assert.equal((await h.notes()).length, 0);
  assert.equal((await h.handleDrainTrackNote({ url: url(21, 'discovery/item'), likes: '1k' })).ok, true);
  assert.equal((await h.notes())[0].signals.likes, 1000);
});

test('_mergeAutoWaterFound uses batch ID/URL normalization and repeated imports are idempotent', async () => {
  const h = harness({ mock_water_state: { searchState: { foundNotes: [
    card(30, { title: 'shared title', likes: '2万' }),
    { url: url(30, 'discovery/item', 'other'), title: 'shared title' },
    card(31, { title: 'shared title' }),
  ] } } });
  assert.equal(await h._mergeAutoWaterFound(), 2);
  assert.equal(await h._mergeAutoWaterFound(), 0);
  assert.equal((await h.notes()).length, 2);
  assert.equal((await h.notes()).find(n => n.noteId === id(30)).signals.likes, 20000);
});

test('Concurrent single/batch registrations retain every unique note', async () => {
  const h = harness();
  const promises = Array.from({ length: 36 }, (_, i) => i % 2
    ? h.handleDrainTrackNote(card(100 + i))
    : h.handleDrainTrackNotes({ notes: [card(100 + i), card(999)] }));
  const results = await Promise.all(promises);
  assert.ok(results.every(result => result.ok));
  const notes = await h.notes();
  const expected = [...Array.from({ length: 36 }, (_, i) => id(100 + i)), id(999)].sort();
  assert.deepEqual(notes.map(n => n.noteId).sort(), expected);
  assert.equal(new Set(notes.map(n => n.id)).size, expected.length);
});

test('A rejected write is surfaced, leaves storage intact, and does not poison queued/later writes', async () => {
  const h = harness();
  await h.handleDrainTrackNote(card(200, { likes: 50 }));
  h.memory.failNextDrainWrite();
  const settled = await Promise.allSettled([
    h.handleDrainTrackNotes({ notes: [card(200, { likes: 999 }), card(201)] }),
    h.handleDrainTrackNote(card(202)),
    h.handleDrainTrackNotes({ notes: [card(203), card(204)] }),
  ]);
  assert.equal(settled[0].status, 'rejected');
  assert.match(settled[0].reason.message, /mock storage write failure/);
  assert.equal(settled[1].status, 'fulfilled');
  assert.equal(settled[2].status, 'fulfilled');
  await h.handleDrainTrackNote(card(205));
  const notes = await h.notes();
  assert.deepEqual(notes.map(n => n.noteId).sort(), [200, 202, 203, 204, 205].map(id));
  assert.equal(notes.find(n => n.noteId === id(200)).signals.likes, 50);
  assert.equal(h.memory.stats.failedWrites, 1);
});

test('drainMergeNotes stale snapshot preserves new registrations and newer lastSeenAt', async () => {
  const h = harness();
  await h.handleDrainTrackNote(card(300, { title: 'old', likes: 10 }));
  const stale = await h.notes();
  stale[0].title = 'stale scanner title';
  stale[0].signals.likes = 1;
  h.clock.now += 1000;
  await h.handleDrainTrackNotes({ notes: [card(300, { title: 'fresh', likes: 99 }), card(301)] });
  const fresh = (await h.notes()).find(n => n.noteId === id(300));
  await h.drainMergeNotes(stale);
  const notes = await h.notes();
  assert.deepEqual(notes.map(n => n.noteId).sort(), [id(300), id(301)]);
  assert.deepEqual(notes.find(n => n.noteId === id(300)), fresh);
  assert.ok(fresh.lastSeenAt > stale[0].lastSeenAt);
});

test('drainMergeNotes shares the registration queue under a deliberately blocked read', async () => {
  const h = harness();
  await h.handleDrainTrackNote(card(310, { likes: 1 }));
  const stale = await h.notes();
  h.clock.now += 2000;
  const gate = h.memory.holdNextDrainRead();
  const registering = h.handleDrainTrackNotes({ notes: [card(310, { likes: 50 }), card(311)] });
  await gate.ready;
  const merging = h.drainMergeNotes(stale);
  const later = h.handleDrainTrackNote(card(312));
  gate.release();
  await Promise.all([registering, merging, later]);
  const notes = await h.notes();
  assert.deepEqual(notes.map(n => n.noteId).sort(), [310, 311, 312].map(id));
  assert.equal(notes.find(n => n.noteId === id(310)).signals.likes, 50);
  assert.equal(notes.find(n => n.noteId === id(310)).lastSeenAt, h.clock.now);
});

test('drainMergeNotes applies genuinely newer updates and inserts new scanner rows', async () => {
  const h = harness();
  await h.handleDrainTrackNote(card(320));
  const updates = await h.notes();
  updates[0].lastSeenAt += 1000;
  updates[0].scenario = 'city';
  updates[0].signals.likes = 77;
  const newRow = { ...clone(updates[0]), id: 'scanner-row', noteId: id(321), url: url(321), scenario: 'local' };
  await h.drainMergeNotes([...updates, newRow]);
  const notes = await h.notes();
  assert.equal(notes.length, 2);
  const merged = notes.find(n => n.noteId === id(320));
  assert.equal(merged.scenario, 'local', 'legacy city migrates to local when the row is written back');
  assert.deepEqual(merged, { ...updates[0], scenario: 'local' });
  assert.deepEqual(notes.find(n => n.noteId === id(321)), newRow);
});

test('Legacy scenario ids migrate on read; scan cfg v1 sources split into keywords/city/painWords', async () => {
  const h = harness({
    // 属地真源＝诊断&配置 ①「同城城市」（2026-09-25）：cfg.city 只是它的镜像，不再从旧来源里迁
    mock_config: { ai: { apiKey: 'mock-only' }, product: { name: 'mock product', description: 'offline' }, myCity: { city: '深圳' } },
    drain_notes: [
      { id: 'r1', noteId: id(1), url: url(1), scenario: 'burst', signals: {} },
      { id: 'r2', noteId: id(2), url: url(2), scenario: 'city', signals: {} },
      { id: 'r3', noteId: id(3), url: url(3), scenario: 'topic', signals: {} },
      { id: 'r4', noteId: id(4), url: url(4), scenario: 'highv', signals: {} },
    ],
    drain_scan_cfg: { sources: [
      { scenario: 'burst', term: '金融理财' },
      { scenario: 'evergreen', term: '贷款' },
      { scenario: 'burst', term: '金融理财' },
      { scenario: 'city', term: '深圳' },
      { scenario: 'pain', term: '求推荐' },
      { scenario: 'highv', term: 'https://www.xiaohongshu.com/user/profile/abc', kind: 'profile' },
      { scenario: 'burst', term: '   ' },
    ] },
  });
  const notes = await h.notes();
  assert.deepEqual(notes.map(n => n.scenario), ['latest', 'local', 'top', 'highv']);

  const cfg = await h.drainGetScanCfg();
  // v5 = 队列整条每周自动跑（queueAuto）收成一份，旧数据读进来就盖上这个版本号
  assert.equal(cfg.v, 5);
  // Array.from 而不是 .map：VM 里造出来的数组原型不同，deepStrictEqual 会判不等
  assert.deepEqual(Array.from(cfg.keywords, k => k.k), ['金融理财', '贷款'], 'search sources become the keyword pool, deduped');
  assert.equal(cfg.city, '深圳');
  // 求助词内置（2026-09-25）：不再进配置，派生时按内置那几个词各搜一遍
  assert.equal(cfg.painWords, undefined, '求助词已内置，不再从旧来源迁进配置');
  // 「✍️ 额外来源」整体下线（2026-09-25）：主页链接搬进「👤 盯的账号」，搬完 sources 恒为空
  assert.equal(cfg.sources.length, 0, '「额外来源」字段搬完恒为空');
  assert.deepEqual(Array.from(cfg.accounts, a => a.k), ['https://www.xiaohongshu.com/user/profile/abc'], '主页来源搬进「👤 盯的账号」');
  assert.equal((await h.drainGetScanCfg()).v, 5, 'v5 configs are returned as-is on later reads');

  const terms = h.drainBuildSources(cfg).map(s => `${s.scenario}|${s.term}|${s.sort}`);
  for (const expected of [
    'latest|金融理财|latest', 'top|金融理财|likes', 'top|金融理财|comments', 'top|金融理财|collects',
    'local|金融理财 深圳|latest', 'pain|金融理财 求推荐|latest', 'highv|https://www.xiaohongshu.com/user/profile/abc|',
  ]) assert.ok(terms.includes(expected), `derived source missing: ${expected}`);
  assert.equal(terms.filter(t => t.startsWith('local|金融理财')).length, 1);

  // v4：关一类是改 typeRun（真源），types 只是跟着变的镜像
  const off = { ...clone(cfg), typeRun: { ...cfg.typeRun, top: { mode: 'off' } } };
  const noTop = h.drainBuildSources(off);
  assert.equal(noTop.filter(s => s.scenario === 'top').length, 0, 'unchecked types derive no sources');
  assert.equal(noTop.filter(s => s.scenario === 'highv').length, 1, 'manual sources ignore the type checkboxes');
  const savedOff = await h.drainSaveScanCfg(off);
  assert.equal(savedOff.types.top, false, '关掉的类在镜像里也是 false');
  assert.deepEqual({ ...(await h.drainGetScanCfg()).typeRun.top }, { mode: 'off' }, '关一类靠 typeRun 落库，读回来还是关的');
  const noCity = h.drainBuildSources({ ...clone(cfg), city: '' });
  assert.equal(noCity.filter(s => s.scenario === 'local').length, 0, 'no city configured → no local sources');
});

test('drainJudge derives the verdict from the note type (legacy ids included)', async () => {
  const h = harness();
  const judge = (scenario, signals) => h.drainJudge(scenario, signals, { growthDelta: 50 });
  // 最新笔记：盯点赞增量
  assert.equal(judge('latest', { likes: 100, delta: 50 }).verdict, '点赞+50 · 去评论');
  assert.equal(judge('latest', { likes: 100, delta: 49 }).tone, 'blue');
  assert.equal(judge('latest', { likes: 0, delta: 0 }).verdict, '待观察');
  assert.equal(judge('latest', { likes: 5, myComment: { found: true, rank: 2, likes: 8 } }).verdict, '已评论(第2位·👍8)');
  assert.equal(judge('burst', { likes: 9, delta: 80 }).verdict, '点赞+80 · 去评论', 'legacy burst still judges as 最新笔记');
  // 搜索TOP：活水位置
  assert.equal(judge('top', { myComment: { found: true, rank: 1 } }).verdict, '黄金位·前3');
  assert.equal(judge('top', { myComment: { found: true, rank: 9 } }).verdict, '在榜·第9位');
  assert.equal(judge('top', { myComment: { checked: true, seen: true } }).verdict, '掉榜 · 去补评论');
  assert.equal(judge('top', { myComment: { checked: true } }).verdict, '未占位 · 去评论');
  assert.equal(judge('top', {}).verdict, '待查活水');
  assert.equal(judge('topic', { myComment: { found: true, rank: 5 } }).verdict, '在榜·第5位', 'legacy topic folds into 搜索TOP');
  // 本地笔记：不看热度
  assert.equal(judge('local', { likes: 99999 }).verdict, '本地刚需 · 去评论');
  assert.equal(judge('local', { myComment: { found: true, rank: 5 } }).verdict, '已评论·本地');
  // 求助笔记：标题命中求助词
  assert.equal(judge('pain', { title: '姐妹们求推荐' }).verdict, '求助命中 · 去评论');
  assert.equal(judge('pain', { title: '随手一记' }).verdict, '监控·意图待定');
  assert.equal(judge('highv', {}).verdict, '借V监控·溢出');
});

test('drainMergeMyComment pins seen once my comment was ever found', async () => {
  const h = harness();
  const seen = h.drainMergeMyComment({ found: true, checked: true, rank: 2 }, { found: false, checked: true });
  assert.equal(seen.seen, true);
  assert.equal(h.drainJudge('top', { myComment: seen }).verdict, '掉榜 · 去补评论');
  const never = h.drainMergeMyComment(null, { found: false, checked: true });
  assert.equal(never.seen, undefined);
  assert.equal(h.drainJudge('top', { myComment: never }).verdict, '未占位 · 去评论');
  const kept = { found: false, checked: true, seen: true };
  assert.equal(h.drainMergeMyComment(kept, null), kept, 'a failed read keeps the previous record');
});

test('Replenish strategy migrates to the 4 types and drives open/skip/expire', async () => {
  const h = harness({ drain_scan_cfg: { v: 2, replenish: { strategy: {
    burst: { mode: 'ttl', ttlHours: 48 },
    topic: { mode: 'always' },
  } } } });
  const repl = await h.drainGetReplenishCfg();
  assert.equal(repl.enabled, true);
  assert.equal(repl.growthDelta, 50);
  // 2026-09-25 起节奏不再可配（归内置默认 + 词池表头）：旧数据里那套 strategy 一并作废
  assert.deepEqual({ ...repl.strategy.latest }, { mode: 'ttl', ttlHours: 24 }, '旧的自定义节奏不再沿用，回落内置默认');
  assert.deepEqual({ ...repl.strategy.top }, { mode: 'interval', intervalHours: 8 }, 'TOP 默认按 8 小时间隔回看');
  for (const id of ['local', 'pain', 'rival', 'highv']) assert.ok(repl.strategy[id], `missing default strategy: ${id}`);

  const now = 1700000000000, HOUR = 3600 * 1000;
  const decide = (note, strat) => h.drainDecideOpen(note, now, strat);
  // 最新/本地：TTL 内反复开，超期淘汰（没打开过的一律开）
  assert.equal(decide({ replenishedAt: now - 2 * HOUR }, { mode: 'ttl', ttlHours: 24 }), 'open');
  assert.equal(decide({ replenishedAt: now - 25 * HOUR }, { mode: 'ttl', ttlHours: 24 }), 'expire');
  assert.equal(decide({ lastSeenAt: now - 100 * HOUR }, { mode: 'ttl', ttlHours: 24 }), 'expire', 'no replenishedAt falls back to lastSeenAt');
  assert.equal(decide({}, { mode: 'ttl', ttlHours: 24 }), 'open');
  // TOP/求助：活水，按间隔回看
  assert.equal(decide({ replenishedAt: now - 9 * HOUR }, { mode: 'interval', intervalHours: 8 }), 'open');
  assert.equal(decide({ replenishedAt: now - 7 * HOUR }, { mode: 'interval', intervalHours: 8 }), 'skip');
  assert.equal(decide({ replenishedAt: now - 3 * HOUR }, { mode: 'interval', intervalHours: 6 }), 'skip');
  assert.equal(decide({}, { mode: 'interval', intervalHours: 8 }), 'open');
  // 高V：总开；未知模式回落按间隔
  assert.equal(decide({ replenishedAt: now - 9999 * HOUR }, { mode: 'always' }), 'open');
  assert.equal(decide({ replenishedAt: now - HOUR }, {}), 'skip', 'unknown mode behaves as interval');

  await h.drainSaveReplenishCfg({ enabled: false, strategy: { city: { mode: 'interval', intervalHours: 3 } }, growthDelta: 12 });
  const saved = await h.drainGetReplenishCfg();
  assert.equal(saved.enabled, false);
  assert.equal(saved.growthDelta, 12);
  assert.deepEqual({ ...saved.strategy.local }, { mode: 'ttl', ttlHours: 24 }, '存的时候也按内置节奏，传进来的 strategy 不收');
});

test('AutoWater._doSearchNotes registers raw IDs even when visible titles deduplicate', async () => {
  const h = harness({ mock_water_state: {
    searchState: {
      searching: true, keywords: ['offline'], foundNotes: [], currentKeyword: 'offline',
      // 搜索动作清单（关键词 × 类型）由 startSearch 派生；_doSearchNotes 只认 plan，没有就直接返回
      plan: [{ k: 'offline', scenario: 'top', term: 'offline', sort: '' }],
    },
    searchResults: null,
  } });
  const results = [card(400, { title: 'same title', likes: '3万' }), card(401, { title: 'same title', likes: '4k' })];
  mockWaterBrowser(h, message => {
    assert.equal(message.action, 'extractSearchResults');
    return { notes: results };
  });
  h.AutoWater._searchGen = 1;
  await h.AutoWater._doSearchNotes();
  const notes = await h.notes();
  assert.deepEqual(notes.map(n => n.noteId).sort(), [id(400), id(401)]);
  assert.equal(notes.find(n => n.noteId === id(400)).signals.likes, 30000);
  assert.equal(notes.find(n => n.noteId === id(400)).scenario, 'top', 'plan 里的类型直接落到笔记上');
  const state = await h.Storage.getAutoWaterState();
  assert.equal(state.searchState.searching, false);
  assert.equal(state.searchState.scenario, 'top');
  assert.equal(state.searchResults.length, 1);
  assert.equal(state.searchState.completedKeywords, 1);
  assert.equal(h.browser.messages.length, 1);
});

test('AutoWater._doSearchNotes tags pool entries with the type implied by the search filter', async () => {
  const h = harness({
    mock_water_config: { filter: { enabled: true, sort: 'latest' } },
    mock_water_state: {
      searchState: {
        searching: true, keywords: ['offline'], foundNotes: [], currentKeyword: 'offline',
        plan: [{ k: 'offline', scenario: 'latest', term: 'offline', sort: 'latest' }],
      },
      searchResults: null,
    },
  });
  mockWaterBrowser(h, message => {
    if (message.action === 'applySearchFilter') {
      assert.equal(message.sortKey, 'latest');
      return { ok: true };
    }
    assert.equal(message.action, 'extractSearchResults');
    return { notes: [card(420, { title: 'fresh note', likes: '1万' })] };
  });
  h.AutoWater._searchGen = 1;
  await h.AutoWater._doSearchNotes();
  assert.deepEqual(h.browser.messages.map(m => m.action), ['applySearchFilter', 'extractSearchResults']);
  assert.equal((await h.notes())[0].scenario, 'latest', '最新排序 → 最新笔记');
  assert.equal((await h.Storage.getAutoWaterState()).searchState.scenario, 'latest');
});

test('AutoWater.advanceResults replaces top-level/current results while drain accumulates all screens', async () => {
  const first = [card(410, { likes: 100 })];
  const h = harness({ mock_water_state: { searchState: { foundNotes: first, searching: true, scenario: 'top' }, searchResults: first } });
  await h.handleDrainTrackNotes({ notes: first });
  const screens = [
    { notes: [card(411, { likes: '1.5k', commentsCount: 12 })], hasMore: true },
    { notes: [card(411), card(412)], hasMore: false },
    { notes: [], hasMore: false },
  ];
  let index = 0;
  mockWaterBrowser(h, message => {
    assert.equal(message.action, 'scrollLoadMore');
    return screens[index++];
  });
  for (const screen of screens) {
    const result = await h.AutoWater.advanceResults();
    assert.equal(result.ok, true);
    assert.equal(result.newNotes, screen.notes.length);
    assert.equal(result.hasMore, screen.hasMore);
    const state = await h.Storage.getAutoWaterState();
    assert.deepEqual(state.searchResults, screen.notes.map(n => ({ ...n, scenario: 'top' })));
    assert.deepEqual(state.searchState.foundNotes, state.searchResults);
    assert.equal(state.searchState.searching, false);
  }
  const notes = await h.notes();
  assert.deepEqual(notes.map(n => n.noteId).sort(), [410, 411, 412].map(id));
  assert.equal(notes.find(n => n.noteId === id(411)).signals.likes, 1500);
  assert.equal(notes.find(n => n.noteId === id(411)).signals.comments, 12);
  assert.equal(notes.find(n => n.noteId === id(411)).scenario, 'top', 'later screens inherit the running search type');
  assert.equal(notes.find(n => n.noteId === id(412)).scenario, 'top');
  assert.equal(h.browser.messages.length, 3);
});

test('AutoWater.openNote registers full metrics and later opens do not erase them', async () => {
  const h = harness();
  mockWaterBrowser(h, message => {
    assert.equal(message.action, 'clickNoteLink');
    assert.equal(message.noteId, id(420));
    return { clicked: true, method: 'offline-mock' };
  });
  assert.equal((await h.AutoWater.openNote(card(420, { likes: '2.2万', commentsCount: 88 }))).ok, true);
  h.clock.now += 1000;
  assert.equal((await h.AutoWater.openNote(card(420))).ok, true);
  const notes = await h.notes();
  assert.equal(notes.length, 1);
  assert.equal(notes[0].signals.likes, 22000);
  assert.equal(notes[0].signals.comments, 88);
  assert.equal(notes[0].lastSeenAt, h.clock.now);
  assert.equal(h.browser.messages.length, 2);
});

async function main() {
  let failures = 0;
  for (const { name, run } of tests) {
    let timer;
    try {
      await Promise.race([
        Promise.resolve().then(run),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Test timed out after 5 seconds')), 5000); }),
      ]);
      console.log(`PASS ${name}`);
    } catch (error) {
      failures++;
      console.error(`FAIL ${name}\n${error.stack || error}`);
    } finally {
      clearTimeout(timer);
    }
  }
  console.log(`\n${tests.length - failures}/${tests.length} passed; ${failures} failed. All browser/AI/storage operations were local mocks.`);
  process.exitCode = failures ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
