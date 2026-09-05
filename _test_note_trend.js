/**
 * _test_note_trend.js — 循环计划核心逻辑单测（lib/note-trend.js）
 * 覆盖：点赞解析 / 打标算法 / 增速排序 / 挑选与度控制
 * 运行：node _test_note_trend.js
 */
'use strict';

/* ─── 0. 注入 chrome.storage mock（供 recordSamples 批量采样测试） ─── */
const _mem = {};
global.chrome = {
  storage: { local: {
    get: function (key, cb) {
      var d = {};
      if (typeof key === 'string') { if (_mem[key] !== undefined) d[key] = _mem[key]; }
      else if (Array.isArray(key)) { key.forEach(function (k) { if (_mem[k] !== undefined) d[k] = _mem[k]; }); }
      else { Object.assign(d, _mem); }
      cb(d);
    },
    set: function (obj, cb) { Object.assign(_mem, obj); if (cb) cb(); },
  } },
};

const NoteTrend = require('./extension/lib/note-trend.js');
let ok = true;
const H = 3600000; // 1 小时毫秒

/* ─── 1. 点赞数解析 ─── */
console.log('=== parseLikesNum ===');
const likeCases = [
  ['1.2万', 12000], ['3', 3], ['1,234', 1234], ['0', 0], ['', 0], ['abc', 0], ['999', 999], ['12.5万', 125000],
];
let likeOk = true;
for (const [s, want] of likeCases) {
  const got = NoteTrend.parseLikesNum(s);
  if (got !== want) { likeOk = false; console.log(`  ✗ "${s}" → ${got}（应 ${want}）`); }
}
console.log(`点赞解析：${likeCases.length} 组 ${likeOk ? '全部通过 ✓' : '存在失败 ✗'}`);
if (!likeOk) ok = false;

/* ─── 2. 打标算法 ─── */
console.log('\n=== computeNoteTag ===');
const now = Date.now();
const tagCases = [
  [null, 'new'],
  [[], 'new'],
  [[{ ts: now, likes: 100 }], 'new'],
  // 间隔太短（<9 分钟）→ null（保持原打标）
  [[{ ts: now - 5 * 60000, likes: 100 }, { ts: now, likes: 101 }], null],
  // Δ<0 → down
  [[{ ts: now - H, likes: 100 }, { ts: now, likes: 90 }], 'down'],
  // Δ=0 → flat
  [[{ ts: now - H, likes: 100 }, { ts: now, likes: 100 }], 'flat'],
  // Δ>0 但每小时 <10 → growing
  [[{ ts: now - 2 * H, likes: 100 }, { ts: now, likes: 110 }], 'growing'],   // 5/小时
  // Δ>0 且每小时 ≥10 → hot
  [[{ ts: now - H, likes: 100 }, { ts: now, likes: 120 }], 'hot'],           // 20/小时
];
let tagOk = true;
for (const [samples, want] of tagCases) {
  const got = NoteTrend.computeNoteTag(samples);
  if (got !== want) { tagOk = false; console.log(`  ✗ ${JSON.stringify(samples)} → ${got}（应 ${want}）`); }
}
console.log(`打标算法：${tagCases.length} 组 ${tagOk ? '全部通过 ✓' : '存在失败 ✗'}`);
if (!tagOk) ok = false;

/* ─── 3. 增速排序 + 挑选与度控制 ─── */
console.log('\n=== pickCycleNotes（挑选 + 度控制） ===');
const cfg = { maxPerRound: 2, maxPerNote: 2, cooldownHours: 24 };
function mkTrend(id, tag, samples, wateredCount, lastWateredAt) {
  return { noteId: id, title: '笔记' + id, samples, tag, wateredCount: wateredCount || 0, lastWateredAt: lastWateredAt || 0 };
}
const trends = {
  // 增长快（hot，20/小时）→ 应挑
  a: mkTrend('a', 'hot', [{ ts: now - H, likes: 100 }, { ts: now, likes: 120 }], 0, 0),
  // 增长慢（growing，5/小时）→ 应挑
  b: mkTrend('b', 'growing', [{ ts: now - 2 * H, likes: 100 }, { ts: now, likes: 110 }], 0, 0),
  // 平稳 → 不挑
  c: mkTrend('c', 'flat', [{ ts: now - H, likes: 100 }, { ts: now, likes: 100 }], 0, 0),
  // 下滑 → 不挑
  d: mkTrend('d', 'down', [{ ts: now - H, likes: 100 }, { ts: now, likes: 80 }], 0, 0),
  // 采样不足 → 不挑
  e: mkTrend('e', 'new', [{ ts: now, likes: 100 }], 0, 0),
  // 增长但已达总次数上限 → 不挑
  f: mkTrend('f', 'growing', [{ ts: now - H, likes: 100 }, { ts: now, likes: 110 }], 2, 0),
  // 增长但在冷却期（1 小时前刚灌过）→ 不挑
  g: mkTrend('g', 'growing', [{ ts: now - H, likes: 100 }, { ts: now, likes: 110 }], 1, now - H),
  // 增长、灌过 1 次但冷却已过（26 小时前）→ 应挑
  h: mkTrend('h', 'growing', [{ ts: now - H, likes: 100 }, { ts: now, likes: 110 }], 1, now - 26 * H),
};
const picked = NoteTrend.pickCycleNotes(trends, cfg, now);
const pickedIds = picked.map(p => p.noteId).join(',');
const wantIds = 'a,h,b'; // 按增速降序：a(20/h) → h(5/h 且可再灌) → b(5/h)；limit=2 → 但先排序再截取！
// 注意：h 和 b 增速相同(5/小时)，排序顺序取决于 sort 稳定性；maxPerRound=2 → 应取 a + (h 或 b)
const wantFirst = 'a';
const pickOk = pickedIds.split(',')[0] === wantFirst && picked.length === 2
  && picked.every(p => ['a', 'h', 'b'].includes(p.noteId));
console.log(`挑选结果：[${pickedIds}]（应 2 篇，第一是增速最快的 a${pickOk ? ' ✓' : ' ✗'}）`);
if (!pickOk) { ok = false; console.log('  期望：a 优先 + h/b 中一篇（总次数与冷却均通过）'); }

/* ─── 4. 增长排序验证（growthRate）─── */
console.log('\n=== growthRate ===');
const grA = NoteTrend.growthRate(trends.a); // 20
const grB = NoteTrend.growthRate(trends.b); // 5
const grOk = grA === 20 && grB === 5;
console.log(`增速：a=${grA}/小时（应20） b=${grB}/小时（应5）${grOk ? ' ✓' : ' ✗'}`);
if (!grOk) ok = false;

console.log('\n' + (ok ? '🎉 循环计划核心逻辑全部通过' : '❌ 存在失败用例，请检查'));
(async function () {
  /* ─── 5. 批量采样串行化：一轮 20 篇并发采样不能丢数据（回归：Promise.all 并发写 storage 互相覆盖） ─── */
  console.log('\n=== recordSamples（批量采样不丢数据） ===');
  const mkNote = (id, likes) => ({ noteId: id, title: '笔记' + id, likes });
  const notes1 = [];
  for (let i = 1; i <= 20; i++) notes1.push(mkNote('n' + i, 100 + i));
  await NoteTrend.clearTrends();
  await NoteTrend.recordSamples(notes1);
  const t1 = await NoteTrend.getTrends();
  const batchOk1 = Object.keys(t1).length === 20 && Object.values(t1).every(x => x.samples.length === 1);
  console.log(`第1轮：20 篇采样后趋势库 ${Object.keys(t1).length} 篇（应 20，全部 1 次采样${batchOk1 ? ' ✓' : ' ✗'}）`);
  if (!batchOk1) ok = false;

  // 模拟 20 分钟后第 2 轮：把已有样本时间戳回拨 20 分钟，点赞 +2（约 6/小时 → growing）
  const now2 = Date.now();
  const shifted = {};
  for (const k in t1) {
    shifted[k] = Object.assign({}, t1[k], {
      samples: t1[k].samples.map(s => Object.assign({}, s, { ts: now2 - 20 * 60000 })),
    });
  }
  await new Promise(r => chrome.storage.local.set({ note_trends: shifted }, r));
  await NoteTrend.recordSamples(notes1.map(n => ({ noteId: n.noteId, title: n.title, likes: n.likes + 2 })));
  const t2 = await NoteTrend.getTrends();
  const batchOk2 = Object.keys(t2).length === 20 && Object.values(t2).every(x => x.samples.length === 2);
  const tagOk2 = Object.values(t2).every(x => x.tag === 'growing');
  console.log(`第2轮：趋势库 ${Object.keys(t2).length} 篇、全部 2 次采样${batchOk2 ? ' ✓' : ' ✗'}，全部打标 growing${tagOk2 ? ' ✓' : ' ✗'}`);
  if (!batchOk2) ok = false;
  if (!tagOk2) ok = false;

  const picked2 = NoteTrend.pickCycleNotes(t2, { maxPerRound: 3, maxPerNote: 2, cooldownHours: 24 });
  console.log(`挑笔记：挑出 ${picked2.length} 篇（应 3${picked2.length === 3 ? ' ✓' : ' ✗'}）`);
  if (picked2.length !== 3) ok = false;

  console.log('\n' + (ok ? '🎉 循环计划核心逻辑全部通过' : '❌ 存在失败用例，请检查'));
  process.exit(ok ? 0 : 1);
})();
