// B12 复盘分析页自检：mock chrome.storage.local + 假知识库 + 假档案
// 验：npUsageByKbCat / npAuditTopicsAlgo / npAuditSentAlgo / formatNum / npAuditSentHtml

const NP_NOTES_KEY = 'np_notes';
const NP_STATS_KEY = 'note_stats';
const NP_SCHEMA_VER = 2;

function npArchiveCoerce(old) {
  if (!old || typeof old !== 'object') return null;
  return Object.assign({}, old, {
    _sv: NP_SCHEMA_VER, dir: old.dir || 'old',
    kOut: old.kOut || '', dOut: old.dOut || '',
    mind: old.mind || null, voiceUrl: old.voiceUrl || '',
    dgenDocs: Array.isArray(old.dgenDocs) ? old.dgenDocs : [],
    asm: old.asm || null,
    queueNotes: Array.isArray(old.queueNotes) ? old.queueNotes : [],
    imgMotifs: Array.isArray(old.imgMotifs) ? old.imgMotifs : [],
    stagePlan: (old.stagePlan && typeof old.stagePlan === 'object') ? old.stagePlan : null,
    collectionIds: Array.isArray(old.collectionIds) ? old.collectionIds.filter(x => typeof x === 'string') : [],
    stats: (old.stats && typeof old.stats === 'object') ? old.stats : null,
    statsAt: Number(old.statsAt) || 0,
    url: String(old.url || ''),
  });
}

const store = {};
let _npArChain = Promise.resolve();
function npNotesSync(fn) { const p = _npArChain.then(fn).catch(() => {}); _npArChain = p; return p; }
async function npNotesAll() {
  const a = store[NP_NOTES_KEY];
  if (!Array.isArray(a)) return [];
  return a.map(npArchiveCoerce).filter(Boolean);
}
async function npStatsReadAll() {
  const d = store[NP_STATS_KEY] || {};
  return d;
}
function npExploreIdByUrl(u) {
  if (!u) return '';
  const m = String(u).match(/\/explore\/([^?#]+)/);
  return m ? m[1] : '';
}

// ============ copy of npUsageByKbCat / npAuditTopicsAlgo / npAuditSentAlgo（#10 起：含 pubNoteByKey / avgDay） ============
async function npUsageByKbCat() {
  const map = new Map();
  const uncat = { catTitle: '默认', allItems: [], coveredIds: new Set(), blankIds: new Set(), pubNoteByKey: new Map() };
  map.set('默认', uncat);
  // mock getKnowledgeBase → 直接用 _kbEntries
  for (const e of _kbEntries) {
    if (e.isActive === false) continue;
    const cat = String(e.category || e.cat || '默认').trim() || '默认';
    if (!map.has(cat)) map.set(cat, { catTitle: cat, allItems: [], coveredIds: new Set(), blankIds: new Set(), pubNoteByKey: new Map() });
    const t = String(e.title || '').trim();
    const id = String(e.id || '').trim();
    if (t || id) map.get(cat).allItems.push({ id, title: t });
  }
  const list = await npNotesAll();
  for (const n of list) {
    if (!n || !Array.isArray(n.kb)) continue;
    for (const k of n.kb) {
      const id = String((k && k.id) || '').trim();
      const ttl = String((k && k.title) || '').trim();
      if (!id && !ttl) continue;
      for (const c of map.values()) {
        const hit = c.allItems.find(it => (id && it.id === id) || (ttl && it.title === ttl));
        if (hit) {
          const key = hit.id || hit.title;
          c.coveredIds.add(key);
          if (n.status === '已发' || n.status === '已归档') {
            const landed = c.pubNoteByKey.get(key);
            if (!landed || (landed.status !== '已发' && n.status === '已发')) c.pubNoteByKey.set(key, n);
          }
        }
      }
    }
  }
  return map;
}

async function npAuditTopicsAlgo() {
  const map = await npUsageByKbCat();
  const statsAll = await npStatsReadAll();
  const statsFetched = Object.keys(statsAll).length > 0;
  const now = Date.now();
  const out = [];
  for (const c of map.values()) {
    const blank = c.allItems.filter(it => !c.coveredIds.has(it.id || it.title));
    const covered = c.allItems.filter(it => c.coveredIds.has(it.id || it.title));
    let conclusion;
    if (c.allItems.length === 0) conclusion = '空类';
    else if (covered.length === 0) conclusion = '全空白';
    else if (blank.length === 0) conclusion = '全讲过';
    else conclusion = '有空白 + 有表现';
    const dayLikes = [];
    for (const n of c.pubNoteByKey.values()) {
      const expId = npExploreIdByUrl(n.url || '');
      const stats = expId ? statsAll[expId] : null;
      if (!stats || !(stats.likes || stats.collects || stats.comments)) continue;
      const sentAt = (n.statusAt && n.statusAt['已发']) || n.updatedAt || 0;
      if (!sentAt) continue;
      dayLikes.push((stats.likes || 0) / Math.max(1, Math.floor((now - sentAt) / 86400e3)));
    }
    out.push({ catTitle: c.catTitle, total: c.allItems.length, covered: covered.length, blank: blank.length, conclusion, blankIds: blank, coveredIds: covered,
               pub: c.pubNoteByKey.size,
               avgDay: dayLikes.length ? dayLikes.reduce((a, b) => a + b, 0) / dayLikes.length : null });
  }
  const order = { '全空白': 0, '有空白 + 有表现': 1, '全讲过': 2, '空类': 3 };
  out.sort((a, b) => (order[a.conclusion] - order[b.conclusion]) || a.catTitle.localeCompare(b.catTitle, 'zh-Hans-CN'));
  out.statsFetched = statsFetched;
  return out;
}

async function npAuditSentAlgo() {
  const all = await npNotesAll();
  const statsAll = await npStatsReadAll();
  const sent = all.filter(n => n && n.status === '已发');
  const rows = sent.map(n => {
    const m = (n.url || '').match(/\/explore\/([^?#]+)/);
    const expId = m ? m[1] : '';
    const stats = expId ? statsAll[expId] : null;
    return {
      id: n.id, title: n.title || '', url: n.url || '', expId, stats,
      hasStats: !!(stats && (stats.likes || stats.collects || stats.comments)),
      fetchedAt: n.statsAt || (stats && stats.fetchedAt) || 0,
      sentAt: (n.statusAt && n.statusAt['已发']) || n.updatedAt || 0,
    };
  }).sort((a, b) => b.sentAt - a.sentAt);
  return { total: sent.length, withStats: rows.filter(r => r.hasStats).length, rows };
}

function formatNum(n) {
  n = Number(n || 0);
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1) + 'k';
  return (n / 10000).toFixed(1) + '万';
}

// ============ 测试 ============
let _kbEntries = [];
let total = 0, fail = 0;
const pass = (n, c, det) => { total++; if (!c) fail++; console.log((c ? '✅' : '❌') + ' ' + n + (det ? ' — ' + det : '')); };

// ---- 测 1：formatNum ----
pass('formatNum 0 → 0', formatNum(0) === '0');
pass('formatNum 999 → 999', formatNum(999) === '999');
pass('formatNum 1500 → 1.5k', formatNum(1500) === '1.5k');
pass('formatNum 9999 → 10.0k', formatNum(9999) === '10.0k');   // 9999/1000 = 9.999 → toFixed(1) = '10.0'
pass('formatNum 10000 → 1.0万', formatNum(10000) === '1.0万');
pass('formatNum 120000 → 12.0万', formatNum(120000) === '12.0万');

// ---- 测 2：npUsageByKbCat 分类汇总 + 覆盖 ----
_kbEntries = [
  { id: 'k1', title: '防水知识 A', category: '防水', isActive: true },
  { id: 'k2', title: '防水知识 B', category: '防水', isActive: true },
  { id: 'k3', title: '堵漏知识 A', category: '堵漏', isActive: true },
  { id: 'k4', title: '老档没分类', isActive: true },        // 无 category
  { id: 'k5', title: '已停用', category: '防水', isActive: false },
];
store[NP_NOTES_KEY] = [
  { id: 'n1', title: '篇 1', status: '已发', kb: [{ id: 'k1', title: '防水知识 A' }] },
  { id: 'n2', title: '篇 2', status: '已发', kb: [{ title: '防水知识 A' }, { title: '堵漏知识 A' }] },
  { id: 'n3', title: '篇 3', status: '草稿' },                  // 草稿也算覆盖（不区分状态）
  { id: 'n4', title: '篇 4', kb: [{ id: 'k2', title: '防水知识 B' }] },
];
const m1 = await npUsageByKbCat();
const c防水 = m1.get('防水');
const c堵漏 = m1.get('堵漏');
const c默认 = m1.get('默认');
pass('防水 类 2 条', c防水.allItems.length === 2);
pass('防水 covered=2', c防水.coveredIds.size === 2);
pass('堵漏 类 1 条', c堵漏.allItems.length === 1);
pass('堵漏 covered=1', c堵漏.coveredIds.size === 1);
pass('默认 类 1 条（含 k4）', c默认.allItems.length === 1);
pass('停用条目不进汇总', !Array.from(m1.values()).some(c => c.allItems.some(it => it.title === '已停用')));
pass('防水 cat 正确', c防水.catTitle === '防水');

// ---- 测 3：npAuditTopicsAlgo 三档结论 ----
const t1 = await npAuditTopicsAlgo();
const map1 = new Map(t1.map(c => [c.catTitle, c]));
pass('防水 2/2 → 全讲过', map1.get('防水').conclusion === '全讲过');
pass('堵漏 1/1 → 全讲过', map1.get('堵漏').conclusion === '全讲过');
pass('默认 0/1 → 全空白', map1.get('默认').conclusion === '全空白');

// ---- 测 4：部分覆盖 → 有空白 + 有表现 ----
_kbEntries = [
  { id: 'a', title: 'A', category: '类 X', isActive: true },
  { id: 'b', title: 'B', category: '类 X', isActive: true },
  { id: 'c', title: 'C', category: '类 X', isActive: true },
];
store[NP_NOTES_KEY] = [
  { id: 'n1', kb: [{ id: 'a' }, { id: 'b' }] },                  // 覆盖 2 / 3
];
const t2 = await npAuditTopicsAlgo();
const cX = t2.find(x => x.catTitle === '类 X');
pass('类 X 3 条', cX.total === 3);
pass('类 X 覆盖 2', cX.covered === 2);
pass('类 X 空白 1', cX.blank === 1);
pass('类 X 结论 有空白 + 有表现', cX.conclusion === '有空白 + 有表现');
pass('类 X blankIds 剩 C', cX.blankIds.length === 1 && cX.blankIds[0].id === 'c');

// ---- 测 5：空类（没条目）→ 排序到最后 ----
const t2sorted = t2.map(c => c.catTitle);
pass('默认 空类 排最后', t2sorted[t2sorted.length - 1] === '默认');

// ---- 测 5b（#10）：表现列 pub / avgDay / statsFetched ----
_kbEntries = [
  { id: 'p1', title: '工艺课', category: '工艺', isActive: true },
  { id: 'p2', title: '材料课', category: '工艺', isActive: true },
];
const now5b = Date.now();
store[NP_NOTES_KEY] = [
  { id: 'n1', title: '工艺篇', status: '已发', url: 'https://www.xiaohongshu.com/explore/exp1', statusAt: { '已发': now5b - 2 * 86400e3 }, kb: [{ id: 'p1', title: '工艺课' }] },
  { id: 'n2', title: '草稿篇', status: '草稿', kb: [{ id: 'p1', title: '工艺课' }] },
];
store[NP_STATS_KEY] = { exp1: { likes: 1000, collects: 3, comments: 1, fetchedAt: now5b } };
const t3 = await npAuditTopicsAlgo();
const cG = t3.find(x => x.catTitle === '工艺');
pass('#10 工艺 pub=1（草稿不算已发）', cG.pub === 1);
pass('#10 工艺 avgDay=1000/2=500', Math.abs(cG.avgDay - 500) < 1e-9);
pass('#10 statsFetched=true', t3.statsFetched === true);
// 没抓过主页 → statsFetched=false、pub 仍算、avgDay=null
store[NP_STATS_KEY] = {};
const t4 = await npAuditTopicsAlgo();
pass('#10 没抓过 statsFetched=false', t4.statsFetched === false);
pass('#10 没抓过 pub=1 但 avgDay=null', t4.find(x => x.catTitle === '工艺').pub === 1 && t4.find(x => x.catTitle === '工艺').avgDay === null);
// 已归档 + 已发 同挂一条 → 已发优先
store[NP_NOTES_KEY] = [
  { id: 'nA', title: '归档篇', status: '已归档', url: 'https://www.xiaohongshu.com/explore/expA', statusAt: { '已发': now5b - 4 * 86400e3 }, kb: [{ id: 'p1' }] },
  { id: 'nB', title: '已发篇', status: '已发', url: 'https://www.xiaohongshu.com/explore/expB', statusAt: { '已发': now5b - 2 * 86400e3 }, kb: [{ id: 'p1' }] },
];
store[NP_STATS_KEY] = {
  expA: { likes: 400, collects: 1, comments: 0, fetchedAt: now5b },
  expB: { likes: 1000, collects: 1, comments: 0, fetchedAt: now5b },
};
const t5 = await npAuditTopicsAlgo();
pass('#10 已归档+已发同挂：已发优先（1000/2=500）', Math.abs(t5.find(x => x.catTitle === '工艺').avgDay - 500) < 1e-9);

// ---- 测 6：npAuditSentAlgo 已发 + stats ----
_kbEntries = [];
store[NP_NOTES_KEY] = [
  { id: 'n1', title: '篇 1', status: '已发', url: 'https://www.xiaohongshu.com/explore/abc123', statusAt: { '已发': Date.now() - 5 * 86400e3 } },
  { id: 'n2', title: '篇 2', status: '已发', url: 'https://www.xiaohongshu.com/explore/xyz999', statusAt: { '已发': Date.now() - 1 * 86400e3 } },
  { id: 'n3', title: '草稿' },                                    // 草稿不算
  { id: 'n4', title: '没 URL 篇', status: '已发' },
];
store[NP_STATS_KEY] = {
  abc123: { likes: 1500, collects: 200, comments: 30, fetchedAt: Date.now() - 1 * 86400e3 },
  // xyz999 还没抓
};
const s1 = await npAuditSentAlgo();
pass('已发 3 篇（n1+n2+n4）', s1.total === 3);
pass('抓到 1 篇（n1）', s1.withStats === 1);
pass('草稿不算', !s1.rows.find(r => r.id === 'n3'));
pass('n1 有 stats', s1.rows.find(r => r.id === 'n1').hasStats === true);
pass('n2 没 stats', s1.rows.find(r => r.id === 'n2').hasStats === false);
pass('n4 没 stats（无 url）', s1.rows.find(r => r.id === 'n4').hasStats === false);
pass('按 sentAt 倒序（n2 在前）', s1.rows[0].id === 'n2');

// ---- 测 7：HTML 渲染片段（不跑 DOM，验字符串含关键标记） ----
// 直接拷贝一份最小版 paint → html 的逻辑
function npAuditSentHtmlLite(data) {
  if (!data.total) return 'EMPTY';
  const pct = Math.round((data.withStats / data.total) * 100);
  const parts = [];
  parts.push('已发 ' + data.total + ' 篇 · 抓到 ' + data.withStats + ' 篇（' + pct + '%）');
  for (const r of data.rows) {
    const likes = r.hasStats ? formatNum(r.stats.likes) : '⚪';
    parts.push(r.title + ' likes=' + likes);
  }
  return parts.join(' | ');
}
const h1 = npAuditSentHtmlLite(s1);
pass('html 含抓主页进度 chip', h1.includes('已发 3 篇 · 抓到 1 篇（33%）'));
pass('html 含 n1 数字', h1.includes('篇 1 likes=1.5k'));
pass('html 含 ⚪ 标记', h1.includes('⚪'));
pass('html 含 n2 未抓', h1.includes('篇 2 likes=⚪'));

console.log('\n📋 B12 复盘分析页 自检完成: ' + (total - fail) + '/' + total + ' 通过');
if (fail > 0) process.exit(1);
