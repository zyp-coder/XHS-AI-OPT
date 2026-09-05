/**
 * _test_auto_water_send.js — 搜索防卡死回归测试（lib/auto-water.js）
 * 覆盖：_send 超时兜底 / 导航异常时状态收尾（searching 不再永久 true）
 * 运行：node _test_auto_water_send.js
 */
'use strict';

/* ─── mock chrome + Storage（auto-water.js 依赖全局） ─── */
global.chrome = {
  tabs: {
    query: async () => [{ id: 1 }],
    update: async () => { throw new Error('标签页已关闭'); }, // 模拟导航异常
    create: async () => ({ id: 2 }),
    sendMessage: function () { /* 永不回调，模拟 content script 卡死 */ },
  },
  scripting: { executeScript: async () => {} },
  runtime: { lastError: null },
  windows: { getLastFocused: async () => ({ id: 1, tabs: [] }), update: async () => {} },
};

let _state = { phase: 'IDLE', searchState: null, searchResults: null, logs: [], error: null };
global.Storage = {
  getAutoWaterState: async () => JSON.parse(JSON.stringify(_state)),
  setAutoWaterState: async (s) => { _state = JSON.parse(JSON.stringify(s)); },
  getAutoWaterConfig: async () => ({ keywords: ['运营'] }),
  getAutoWaterDailyCount: async () => 0,
  isNoteWatered: async () => false,
};

const AutoWater = require('./extension/lib/auto-water.js');
let ok = true;

/* ─── 1. _send 超时兜底：content script 永不响应 → 必须在超时时间内 reject ─── */
(async function () {
  console.log('=== _send 超时兜底 ===');
  const t0 = Date.now();
  let timedOut = false;
  try {
    await AutoWater._send(1, { action: 'extractSearchResults' }, 300);
  } catch (e) {
    timedOut = /超时/.test(e.message);
  }
  const cost = Date.now() - t0;
  const pass = timedOut && cost >= 250 && cost <= 3000;
  console.log(`永不响应的 sendMessage → ${timedOut ? '✓ 超时 reject' : '✗ 未超时'}（耗时 ${cost}ms，应约 300ms）`);
  if (!pass) ok = false;

  /* ─── 2. 导航异常（tabs.update 抛错）→ 搜索必须收尾，searching 回到 false ─── */
  console.log('\n=== 导航异常时状态收尾 ===');
  await AutoWater.searchNotes(); // fire-and-forget 内部 _doSearchNotes
  await new Promise(r => setTimeout(r, 500));
  const st = _state.searchState || {};
  const pass2 = st.searching === false && _state.searchResults !== undefined && !_state.error;
  console.log(`tabs.update 抛错后：searching=${st.searching}（应 false） searchResults=${JSON.stringify(_state.searchResults)} error=${_state.error || '无'}${pass2 ? ' ✓' : ' ✗'}`);
  if (!pass2) ok = false;

  console.log('\n' + (ok ? '🎉 搜索防卡死逻辑全部通过' : '❌ 存在失败用例，请检查'));
  process.exit(ok ? 0 : 1);
})();
