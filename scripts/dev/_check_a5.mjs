// A5 自检：content.js parseNoteStats + background.js statsWrite + popup.js npStatsWriteByTitle/Adopt
// 不依赖扩展运行时；mock chrome.runtime / chrome.storage

// ============ content.js 的 parseNoteStats 抠出来 ============
function parseNoteStats(panel) {
  if (!panel) return null;
  const out = { likes: 0, collects: 0, comments: 0, raw: '' };
  const txt = (el) => (el ? String(el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim() : '');
  const num = (s) => {
    if (s == null) return 0;
    const str = String(s).replace(/[^\d.万]/g, '');
    const m = str.match(/(\d+(?:\.\d+)?)(万)?/);
    if (!m) return 0;
    let n = parseFloat(m[1]);
    if (m[2] === '万') n *= 10000;
    return Math.round(n);
  };
  const elFromAria = (key) => panel.querySelector('[aria-label*="' + key + '"], [aria-label*="' + key.toUpperCase() + '"]');
  let cnt = 0;
  for (const k of ['点赞', '赞']) {
    const el = elFromAria(k);
    const v = num(txt(el));
    if (v > 0) { out.likes = v; cnt++; break; }
  }
  for (const k of ['收藏']) {
    const el = elFromAria(k);
    const v = num(txt(el));
    if (v > 0) { out.collects = v; cnt++; break; }
  }
  for (const k of ['评论', '回复']) {
    const el = elFromAria(k);
    const v = num(txt(el));
    if (v > 0) { out.comments = v; cnt++; break; }
  }
  if (cnt < 3) {
    const cells = Array.from(panel.querySelectorAll('[class*="count"], [class*="stat"], [class*="num"]'))
      .map(el => num(txt(el))).filter(n => n > 0);
    if (cells.length >= 1 && !out.likes) out.likes = cells[0];
    if (cells.length >= 2 && !out.collects) out.collects = cells[1];
    if (cells.length >= 3 && !out.comments) out.comments = cells[2];
  }
  if (!out.likes && !out.collects && !out.comments) {
    return { error: '没抓到任何数字（DOM 没出 .count，或者三连 aria-label 全空）' };
  }
  out.raw = JSON.stringify({ likes: out.likes, collects: out.collects, comments: out.comments });
  return out;
}

// ============ Mock DOM ============
class FakeEl {
  constructor(opts = {}) {
    this.children = [];
    this.attrs = {};
    this.classes = opts.classes || '';
    this.ariaLabel = opts.ariaLabel || '';
    this.text = opts.text || '';
    this.tagName = (opts.tagName || 'div').toUpperCase();
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return k === 'aria-label' ? this.ariaLabel : (k === 'class' ? this.classes : this.attrs[k]); }
  get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
  querySelector(sel) {
    const m = sel.match(/\[(?:aria-label\*[=]?"([^"]+)"|class\*[=]?"([^"]+)")\]/);
    if (!m) return null;
    const ariaMatch = m[1];
    const classMatch = m[2];
    const find = (el) => {
      if (ariaMatch && el.ariaLabel && el.ariaLabel.indexOf(ariaMatch) >= 0) return el;
      if (classMatch && el.classes && el.classes.indexOf(classMatch) >= 0) return el;
      for (const c of el.children) { const r = find(c); if (r) return r; }
      return null;
    };
    return find(this);
  }
  querySelectorAll(sel) {
    const m = sel.match(/\[class\*[=]?"([^"]+)"\]/);
    const cls = m ? m[1] : '';
    const out = [];
    const recur = (el) => {
      if (cls && el.classes && el.classes.indexOf(cls) >= 0) out.push(el);
      for (const c of el.children) recur(c);
    };
    recur(this);
    return out;
  }
}

// ============ popup.js 的几个函数抠出来 ============
function npExploreIdByUrl(u) {
  if (!u) return '';
  const m = String(u).match(/\/explore\/([^?#]+)/);
  return m ? m[1].split('?')[0] : '';
}
async function npStatsWriteByTitle(list, noteStatsAll) {
  const hit = [];
  const miss = [];
  if (!Array.isArray(list)) list = [];
  if (!noteStatsAll || typeof noteStatsAll !== 'object') noteStatsAll = {};
  for (const n of list) {
    if (!n || n.status !== '已发') continue;
    const expId = npExploreIdByUrl(n.url);
    if (!expId) { miss.push({ id: n.id, reason: '档案没记 url' }); continue; }
    const s = noteStatsAll[expId];
    if (!s) { miss.push({ id: n.id, reason: '还没抓主页', expId }); continue; }
    n.stats = s;
    n.statsAt = s.fetchedAt;
    hit.push(n.id);
  }
  return { hit, miss };
}
function npArchiveCoerce(old) {
  if (!old || typeof old !== 'object') return null;
  return Object.assign({}, old, {
    _sv: 1, dir: old.dir || 'old',
    kOut: old.kOut || '', dOut: old.dOut || '',
    mind: old.mind || null, voiceUrl: old.voiceUrl || '',
    voiceError: old.voiceError || null,
    dgenDocs: Array.isArray(old.dgenDocs) ? old.dgenDocs : [],
    asm: old.asm || null,
    collectionIds: Array.isArray(old.collectionIds) ? old.collectionIds.filter(x => typeof x === 'string') : [],
    stats: (old.stats && typeof old.stats === 'object') ? old.stats : null,
    statsAt: Number(old.statsAt) || 0,
    url: String(old.url || ''),
  });
}

// ============ background.js 的 statsWrite ============
const NOTE_STATS_KEY = 'note_stats';
async function statsWrite(payload, store) {
  const id = String((payload && payload.id) || '').split('?')[0];
  const stats = payload && payload.stats;
  if (!id) return { ok: false, error: 'id 为空' };
  if (!stats || typeof stats !== 'object') return { ok: false, error: 'stats 为空' };
  try {
    const m = (store && store[NOTE_STATS_KEY]) || {};
    m[id] = {
      likes: Number(stats.likes || 0) || 0,
      collects: Number(stats.collects || 0) || 0,
      comments: Number(stats.comments || 0) || 0,
      raw: String(stats.raw || ''),
      fetchedAt: Date.now(),
    };
    if (store) store[NOTE_STATS_KEY] = m;
    return { ok: true, id };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

// ============ 测试 ============
let total = 0, fail = 0;
const pass = (n, c, det) => { total++; if (!c) fail++; console.log((c ? '✅' : '❌') + ' ' + n + (det ? ' — ' + det : '')); };

// ---- parseNoteStats: aria-label 走通 ----
const panel1 = new FakeEl();
panel1.children.push(new FakeEl({ ariaLabel: '点赞 1234', text: '1234' }));
panel1.children.push(new FakeEl({ ariaLabel: '收藏 567', text: '567' }));
panel1.children.push(new FakeEl({ ariaLabel: '评论 89', text: '89' }));
const r1 = parseNoteStats(panel1);
pass('aria 三连 likes', r1.likes === 1234, JSON.stringify(r1));
pass('aria 三连 collects', r1.collects === 567);
pass('aria 三连 comments', r1.comments === 89);
pass('aria 三连 raw 含三键', /likes.*collects.*comments/.test(r1.raw));

// ---- parseNoteStats: 万字解析 ----
const panel2 = new FakeEl();
panel2.children.push(new FakeEl({ ariaLabel: '点赞 1.2万', text: '1.2万' }));
panel2.children.push(new FakeEl({ ariaLabel: '收藏 8888', text: '8888' }));
panel2.children.push(new FakeEl({ ariaLabel: '评论 350', text: '350' }));
const r2 = parseNoteStats(panel2);
pass('万字 likes=12000', r2.likes === 12000, JSON.stringify(r2));
pass('万字 collects=8888', r2.collects === 8888);

// ---- parseNoteStats: 兜底 .count ----
const panel3 = new FakeEl();
panel3.children.push(new FakeEl({ classes: 'count', text: '42' }));
panel3.children.push(new FakeEl({ classes: 'count', text: '7' }));
panel3.children.push(new FakeEl({ classes: 'count', text: '3' }));
const r3 = parseNoteStats(panel3);
pass('兜底 .count likes', r3.likes === 42);
pass('兜底 .count collects', r3.collects === 7);
pass('兜底 .count comments', r3.comments === 3);

// ---- parseNoteStats: aria 优先级 > 兜底 ----
const panel4 = new FakeEl();
panel4.children.push(new FakeEl({ ariaLabel: '点赞 999', text: '999' }));
panel4.children.push(new FakeEl({ classes: 'count', text: '11' }));
panel4.children.push(new FakeEl({ classes: 'count', text: '22' }));
panel4.children.push(new FakeEl({ classes: 'count', text: '33' }));
const r4 = parseNoteStats(panel4);
pass('aria 优先 likes=999', r4.likes === 999, JSON.stringify(r4));

// ---- parseNoteStats: 全空 ----
const panel5 = new FakeEl();
panel5.children.push(new FakeEl({ text: '随便' }));
const r5 = parseNoteStats(panel5);
pass('全空返 error', r5 && r5.error && r5.error.length > 0);

// ---- npExploreIdByUrl ----
pass('explore id 抽取', npExploreIdByUrl('https://www.xiaohongshu.com/explore/abc123?x=1') === 'abc123');
pass('空 url 返空', npExploreIdByUrl('') === '');
pass('无 /explore/ 返空', npExploreIdByUrl('https://xhs.com/other') === '');

// ---- statsWrite (background) ----
const store = {};
const w1 = await statsWrite({ id: 'abc123', stats: { likes: 100, collects: 50, comments: 20, raw: '{}' } }, store);
pass('write 返 ok', w1.ok === true);
pass('write 落 store', store[NOTE_STATS_KEY] && store[NOTE_STATS_KEY].abc123);
pass('write 落 likes', store[NOTE_STATS_KEY].abc123.likes === 100);
pass('write 落 collects', store[NOTE_STATS_KEY].abc123.collects === 50);
pass('write 落 comments', store[NOTE_STATS_KEY].abc123.comments === 20);
pass('write 落 fetchedAt > 0', store[NOTE_STATS_KEY].abc123.fetchedAt > 0);

// 缺字段
const w2 = await statsWrite({ id: '', stats: { likes: 1 } }, store);
pass('缺 id 返错', w2.ok === false && w2.error);
const w3 = await statsWrite({ id: 'x', stats: null }, store);
pass('缺 stats 返错', w3.ok === false && w3.error);

// ---- npStatsWriteByTitle ----
const list1 = [
  { id: 'n1', status: '已发', url: 'https://www.xiaohongshu.com/explore/abc123' },
  { id: 'n2', status: '已发', url: 'https://www.xiaohongshu.com/explore/xyz789' },
  { id: 'n3', status: '草稿' },                                            // 不在列
  { id: 'n4', status: '已发' },                                            // 没 url
];
const statsAll = {
  abc123: { likes: 100, collects: 50, comments: 20, fetchedAt: 12345 },
  xyz789: { likes: 200, collects: 80, comments: 40, fetchedAt: 67890 },
  orphan: { likes: 1, collects: 1, comments: 1, fetchedAt: 99999 },        // 没对应档案
};
const adopt = await npStatsWriteByTitle(list1, statsAll);
pass('命中 n1', adopt.hit.indexOf('n1') >= 0);
pass('命中 n2', adopt.hit.indexOf('n2') >= 0);
pass('命中数 = 2', adopt.hit.length === 2);
pass('miss 含 n3 因 status', adopt.miss.find(m => m.id === 'n3') == null);
pass('miss 含 n4 因 url 空', adopt.miss.find(m => m.id === 'n4' && m.reason === '档案没记 url') != null);
pass('n1.stats 被注入', list1[0].stats && list1[0].stats.likes === 100);
pass('n1.statsAt 被注入', list1[0].statsAt === 12345);

// ---- npArchiveCoerce 补 A5 字段 ----
const old1 = npArchiveCoerce({ id: 'a1' });
pass('coerce stats=null 默认', old1.stats === null);
pass('coerce statsAt=0', old1.statsAt === 0);
pass('coerce url=""', old1.url === '');
const old2 = npArchiveCoerce({ id: 'a2', url: 'https://xhs/explore/xx', stats: { likes: 1 }, statsAt: 99 });
pass('coerce url 保留', old2.url === 'https://xhs/explore/xx');
pass('coerce stats 保留', old2.stats.likes === 1);
pass('coerce statsAt=99', old2.statsAt === 99);
const old3 = npArchiveCoerce(null);
pass('coerce(null)=null', old3 === null);

// ---- 启动期统计（模拟） ----
const fakeList = [
  { id: 'p1', status: '已发', url: 'https://xhs/explore/h1' },
  { id: 'p2', status: '已发', url: 'https://xhs/explore/h2' },
  { id: 'p3', status: '已发' },
];
const fakeStats = {
  h1: { likes: 10, collects: 5, comments: 2, fetchedAt: Date.now() - 8 * 86400 * 1000 },   // 过期
  h2: { likes: 20, collects: 10, comments: 4, fetchedAt: Date.now() },                      // 新鲜
};
const r = await npStatsWriteByTitle(fakeList, fakeStats);
pass('启动期 2 命中', r.hit.length === 2);
pass('启动期 1 miss（没 url）', r.miss.length === 1);

console.log('\n📋 A5 自检完成: ' + (total - fail) + '/' + total + ' 通过');
if (fail > 0) process.exit(1);