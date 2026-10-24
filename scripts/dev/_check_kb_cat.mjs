// KB_CAT 升级自检：mock chrome.storage.local + 假知识库
// 验：老档补默认 / 批量归类批量 / KB_CATEGORIES 8 类齐 / B12 默认类提示

const KB_CATEGORIES = ['产品介绍', '玩法与机制', '数据·成本', '顾客痛点', '避坑经验', '个人经历', '使用技巧', '笔记架构'];

// mock KB 存储 + handlers
const store = {};
const chrome = {
  storage: { local: {
    get: async (k) => {
      if (Array.isArray(k)) { const o = {}; k.forEach(x => o[x] = store[x]); return o; }
      if (typeof k === 'string') return { [k]: store[k] };
      if (k && typeof k === 'object') { const o = {}; Object.keys(k).forEach(x => o[x] = store[x]); return o; }
      return {};
    },
  } },
};

// 模拟 _diagSay 协议：getKnowledgeBase / updateKnowledgeEntry / aiCategorizeKb
async function _diagSay(action, data) {
  if (action === 'getKnowledgeBase') {
    return { ok: true, entries: store.kb || [] };
  }
  if (action === 'updateKnowledgeEntry') {
    const arr = store.kb || [];
    const idx = arr.findIndex(e => e.id === data.id);
    if (idx < 0) return { ok: false, error: 'not found' };
    arr[idx] = Object.assign({}, arr[idx], data.updates);
    store.kb = arr;
    return { ok: true, entry: arr[idx] };
  }
  if (action === 'aiCategorizeKb') {
    // mock AI 归类：根据 title 第一个字匹配
    const validCats = KB_CATEGORIES;
    const assignments = (data.items || []).map(e => {
      let cat = validCats[0];
      if (e.title.includes('价格') || e.title.includes('钱')) cat = '数据·成本';
      else if (e.title.includes('坑') || e.title.includes('错')) cat = '避坑经验';
      else if (e.title.includes('客户') || e.title.includes('痛')) cat = '顾客痛点';
      else if (e.title.includes('玩法') || e.title.includes('功能')) cat = '玩法与机制';
      else if (e.title.includes('介绍') || e.title.includes('产品')) cat = '产品介绍';
      else if (e.title.includes('故事') || e.title.includes('经历')) cat = '个人经历';
      else if (e.title.includes('技巧') || e.title.includes('操作')) cat = '使用技巧';
      else if (e.title.includes('架构') || e.title.includes('结构')) cat = '笔记架构';
      return { id: e.id, category: cat, reason: 'mock' };
    });
    return { assignments };
  }
  return { ok: false, error: 'unknown' };
}

// 复制 diagKbMigrateCategory 主体
async function diagKbMigrateCategory() {
  let touched = 0;
  try {
    const r = await _diagSay('getKnowledgeBase');
    const list = (r && r.entries) || [];
    for (const e of list) {
      if (!e || !e.id) continue;
      const cur = String(e.category || '').trim();
      if (!cur) {
        await _diagSay('updateKnowledgeEntry', { id: e.id, updates: { category: '默认' } });
        touched++;
      }
    }
  } catch (_) {}
  return touched;
}

// 复制 diagKbBatchCategorize 主体
async function diagKbBatchCategorize() {
  const r = await _diagSay('getKnowledgeBase');
  const list = ((r && r.entries) || []).filter(e => e && e.id);
  const pending = list.filter(e => {
    const c = String(e.category || '').trim();
    if (!c) return true;
    if (c === '默认' || c === '未分类' || c === '通用') return true;
    return KB_CATEGORIES.indexOf(c) < 0;
  });
  let assigned = 0, skipped = 0;
  for (let i = 0; i < pending.length; i += 30) {
    const batch = pending.slice(i, i + 30).map(e => ({ id: e.id, title: e.title || '', content: (e.content || '').slice(0, 300) }));
    const result = await _diagSay('aiCategorizeKb', { items: batch });
    const arr = (result && Array.isArray(result.assignments)) ? result.assignments : [];
    const byId = new Map(arr.map(a => [a.id, a.category]));
    for (const e of batch) {
      const cat = byId.get(e.id);
      if (!cat || KB_CATEGORIES.indexOf(cat) < 0) { skipped++; continue; }
      await _diagSay('updateKnowledgeEntry', { id: e.id, updates: { category: cat } });
      assigned++;
    }
  }
  return { assigned, skipped, total: pending.length };
}

let total = 0, fail = 0;
const pass = (n, c, det) => { total++; if (!c) fail++; console.log((c ? '✅' : '❌') + ' ' + n + (det ? ' — ' + det : '')); };

// ---- KB_CATEGORIES 8 类齐 ----
pass('KB_CATEGORIES 长度 8', KB_CATEGORIES.length === 8);
pass('产品介绍 在', KB_CATEGORIES.indexOf('产品介绍') >= 0);
pass('笔记架构 在', KB_CATEGORIES.indexOf('笔记架构') >= 0);
pass('默认 不在 KB_CATEGORIES', KB_CATEGORIES.indexOf('默认') < 0);

// ---- 老档迁移 ----
store.kb = [
  { id: 'k1', title: '老档 A', content: '内容 A' },                      // 无 category
  { id: 'k2', title: '老档 B', content: '内容 B', category: '产品介绍' },  // 已有
  { id: 'k3', title: '老档 C', content: '内容 C' },                      // 无 category
  { id: 'k4', title: '老档 D', content: '内容 D', category: '  ' },         // 空白
];
const t1 = await diagKbMigrateCategory();
pass('老档迁移 3 条（k1, k3, k4）', t1 === 3);
const k1 = store.kb.find(e => e.id === 'k1');
const k2 = store.kb.find(e => e.id === 'k2');
const k3 = store.kb.find(e => e.id === 'k3');
pass('k1 补 默认', k1.category === '默认');
pass('k2 保留 产品介绍', k2.category === '产品介绍');
pass('k3 补 默认', k3.category === '默认');

// ---- 二次跑幂等 ----
const t2 = await diagKbMigrateCategory();
pass('二次迁移 0 条（幂等）', t2 === 0);

// ---- 批量归类 ----
store.kb = [
  { id: 'a1', title: '产品介绍 入门', content: '...', category: '产品介绍' },  // 已有，不参与
  { id: 'a2', title: '价格表 多少钱', content: '...' },                    // ＝默认
  { id: 'a3', title: '避坑经验 客户', content: '...' },                    // ＝默认
  { id: 'a4', title: '顾客痛点 故事', content: '...' },                    // ＝默认
  { id: 'a5', title: '产品介绍 二', content: '...' },                    // ＝默认
  { id: 'a6', title: '随机 老档', content: '...' },                       // ＝默认
  { id: 'a7', title: '产品介绍 三', content: '...' },                    // ＝默认
];
store.kb.forEach(e => { if (!e.category) e.category = '默认'; });
const r1 = await diagKbBatchCategorize();
pass('批量归类 total=6（a1 已分类跳过）', r1.total === 6);
pass('assigned=6', r1.assigned === 6);
const after = store.kb;
pass('a2 归 数据·成本', after.find(e => e.id === 'a2').category === '数据·成本');
pass('a3 归 避坑经验', after.find(e => e.id === 'a3').category === '避坑经验');
pass('a4 归 顾客痛点', after.find(e => e.id === 'a4').category === '顾客痛点');
pass('a5 归 产品介绍', after.find(e => e.id === 'a5').category === '产品介绍');
pass('a6 归 产品介绍（默认兜底到 validCats[0]）', after.find(e => e.id === 'a6').category === '产品介绍');
pass('a1 保留 原分类（未参与归类）', after.find(e => e.id === 'a1').category === '产品介绍');

// ---- 全空不调 AI ----
store.kb = [{ id: 'b1', title: 'B', content: '...', category: '产品介绍' }];
const r2 = await diagKbBatchCategorize();
pass('全空时 total=0', r2.total === 0);
pass('全空时 assigned=0', r2.assigned === 0);

// ---- 切片：超过 30 条也跑通 ----
const big = [];
for (let i = 0; i < 75; i++) big.push({ id: 'big' + i, title: '价格 ' + i, content: '...', category: '默认' });
store.kb = big;
const r3 = await diagKbBatchCategorize();
pass('75 条切片 total=75', r3.total === 75);
pass('75 条切片 assigned=75', r3.assigned === 75);

console.log('\n📋 KB_CAT 升级 自检完成: ' + (total - fail) + '/' + total + ' 通过');
if (fail > 0) process.exit(1);
