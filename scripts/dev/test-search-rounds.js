'use strict';

/* 桩测试：searchNotes 一次只给「一类」，后面的类交给服务器排（2026-10-23 确认单第 1 条）
 * 跑法：node scripts/dev/test-search-rounds.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'extension/lib/auto-water.js'), 'utf8');

const PASSES = {
  latest: [{ k: '测试词', scenario: 'latest', term: '测试词', sort: 'latest' }],
  top: ['likes', 'comments', 'collects'].map((s) => ({ k: '测试词', scenario: 'top', term: '测试词', sort: s })),
  local: [{ k: '测试词', scenario: 'local', term: '测试词 杭州', sort: 'latest' }],
  pain: ['求推荐', '听劝', '怎么办', '求建议'].map((w) => ({ k: '测试词', scenario: 'pain', term: '测试词 ' + w, sort: 'latest' })),
};
const LABEL = { latest: '最新', top: 'TOP', local: '本地', pain: '求助' };

function harness(opts = {}) {
  const keywords = (opts.keywords || ['测试词', '第二个词']).slice();
  const due = (opts.due || ['latest', 'top', 'local', 'pain']).slice();
  const state = { phase: 'IDLE', searchState: null };
  const writes = [];
  let started = 0;

  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    Storage: {
      async getAutoWaterConfig() {
        return { keywords: keywords.slice(), schedule: { kwIdx: opts.kwIdx || 0 } };
      },
      async getAutoWaterState() {
        return JSON.parse(JSON.stringify(state));
      },
      async setAutoWaterState(v) {
        state.phase = v.phase;
        state.searchState = v.searchState ? JSON.parse(JSON.stringify(v.searchState)) : null;
      },
    },
    chrome: {
      storage: {
        local: {
          async get() { return { auto_water_config: { schedule: { kwIdx: opts.kwIdx || 0 } } }; },
          async set(v) { writes.push(JSON.parse(JSON.stringify(v))); },
        },
      },
    },
    drainGetScanCfg: async () => ({ city: '杭州' }),
    drainKeywordPasses: (kw, cfg, now, o) => {
      const only = o && o.only;
      const pick = only ? [only] : due;
      return pick
        .filter((s) => opts.only === undefined || s === opts.only)
        .flatMap((s) => (PASSES[s] || []).map((p) => ({ ...p, k: kw })));
    },
    drainScenarioDef: (id) => ({ scenario: id, label: LABEL[id] || id, icon: '' }),
    drainScenarioId: (id) => id,
    drainPassLabel: (p) => (LABEL[p.scenario] || p.scenario) + (p.sort && p.sort !== 'latest' ? '·' + p.sort : ''),
  });

  vm.runInContext(source + '\n;globalThis.__AutoWater = AutoWater;', context, { filename: 'auto-water.js' });
  const aw = context.__AutoWater;
  aw._doSearchNotes = async () => { started++; };
  aw._syncError = async () => {};
  return { aw, state, writes, started: () => started };
}

(async () => {
  /* 1) 四类都到点：只跑最新，后面 TOP / 本地 / 求助 交给服务器 */
  {
    const h = harness({ due: ['latest', 'top', 'local', 'pain'] });
    const r = await h.aw.searchNotes({ kw: '测试词' });
    assert.equal(r.ok, true);
    assert.equal(r.round, 'latest');
    assert.equal(r.roundName, '最新');
    assert.deepEqual(Array.from(r.remain), ['top', 'local', 'pain']);
    assert.deepEqual(Array.from(r.remainNames), ['TOP', '本地', '求助']);
    assert.equal(r.planTotal, 1, '一次只该有一搜');
    assert.equal(r.plan.length, 1);
    assert.match(r.plan[0], /最新/);
    assert.equal(h.state.searchState.round, 'latest');
    assert.deepEqual(Array.from(h.state.searchState.chainRemain), ['top', 'local', 'pain']);
    assert.equal(h.state.searchState.planTotal, 1);
    assert.equal(h.started(), 1);
    console.log('✅ 1 四类到点 → 只跑最新，后面三类交服务器');
  }

  /* 2) 「最新」关着/没到点：先跑第一个到点的类，并标记 latestNotDue */
  {
    const h = harness({ due: ['top', 'local', 'pain'] });
    const r = await h.aw.searchNotes({ kw: '测试词' });
    assert.equal(r.ok, true);
    assert.equal(r.round, 'top');
    assert.equal(r.roundName, 'TOP');
    assert.equal(r.latestNotDue, true);
    assert.deepEqual(Array.from(r.remain), ['local', 'pain']);
    assert.deepEqual(Array.from(r.remainNames), ['本地', '求助']);
    assert.equal(r.planTotal, 3, 'TOP 的 3 个排序在同一轮里连着跑');
    assert.equal(h.state.searchState.latestNotDue, true);
    console.log('✅ 2 最新没到点 → 先跑 TOP（3 搜同一轮），后面本地/求助');
  }

  /* 3) 词标签手点某类：就这一轮、立刻跑、不排队 */
  {
    const h = harness({ due: ['latest', 'top', 'local', 'pain'], only: 'top' });
    const r = await h.aw.searchNotes({ kw: '测试词', scenario: 'top' });
    assert.equal(r.ok, true);
    assert.equal(r.round, 'top');
    assert.equal(r.planTotal, 3);
    assert.deepEqual(Array.from(r.remain), []);
    assert.equal(r.latestNotDue, false);
    console.log('✅ 3 手点 TOP → 只跑 TOP 这一轮，不排后面的类');
  }

  /* 4) 队列点词：精确命中，不顺延到别的词，也不动列表指针（指针归网页管） */
  {
    const h = harness({ due: ['latest', 'top', 'local', 'pain'], keywords: ['第一个词', '测试词'], kwIdx: 0 });
    const r = await h.aw.searchNotes({ kw: '测试词' });
    assert.equal(r.ok, true);
    assert.equal(r.keyword, '测试词');
    assert.equal(r.kwIdx, 1);
    assert.equal(h.state.searchState.currentKeyword, '测试词');
    assert.equal(h.writes.length, 0, '指定词的单子不改列表指针');
    console.log('✅ 4 指定词精确命中（不顺延），指针留给网页管');
  }

  /* 5) 词不在启用列表：直接报错，不偷换词 */
  {
    const h = harness({ due: ['latest'], keywords: ['别的词'] });
    const r = await h.aw.searchNotes({ kw: '测试词' });
    assert.equal(r.ok, false);
    assert.match(r.error, /不在启用词里/);
    assert.equal(h.started(), 0);
    console.log('✅ 5 词不在启用列表 → 报错，不偷换词、不跑');
  }

  /* 6) 这个词一个类都没到点：报错，不白刷页面、不换词 */
  {
    const h = harness({ due: [] });
    const r = await h.aw.searchNotes({ kw: '测试词' });
    assert.equal(r.ok, false);
    assert.match(r.error, /还没到点/);
    assert.equal(h.started(), 0);
    console.log('✅ 6 一类都没到点 → 报错，不换词、不白刷');
  }

  console.log('\n全部通过：6 组');
})().catch((e) => {
  console.error('❌ 桩测试失败：', e && e.stack || e);
  process.exit(1);
});
