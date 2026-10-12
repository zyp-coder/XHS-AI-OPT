// _np 加 kb 自检：mock chrome.storage.local + npNotesSync 串行链
// 覆盖：注入新条 / 重复注入（去重）/ 不存在档案 / 参数不全

const NP_NOTES_KEY = 'np_notes';

let _chain = Promise.resolve();
function npNotesSync(fn) { const p = _chain.then(fn).catch(() => {}); _chain = p; return p; }

const store = {};
global.chrome = {
  storage: { local: {
    async set(obj) { Object.assign(store, obj); },
    async get(keys) {
      const out = {};
      const ks = Array.isArray(keys) ? keys : [keys];
      ks.forEach(k => out[k] = store[k]);
      return out;
    },
  }},
};

async function npNotesAll() {
  const a = store[NP_NOTES_KEY];
  return Array.isArray(a) ? a.slice() : [];
}

// === 复刻 npNoteAddKb（与 popup.js 等价） ===
async function npNoteAddKb(noteId, kbItem) {
  if (!noteId || !kbItem || !kbItem.id) return { ok: false, why: '参数不全' };
  const kid = String(kbItem.id);
  let result = { ok: false, added: false, noteId };
  await npNotesSync(async () => {
    const list = await npNotesAll();
    const i = list.findIndex(x => x && x.id === noteId);
    if (i < 0) { result = { ok: false, why: '档案不存在' }; return; }
    const prev = list[i];
    const cur = Array.isArray(prev.kb) ? prev.kb : [];
    if (cur.some(k => String((k && k.id) || '') === kid)) { result = { ok: true, added: false, noteId }; return; }
    const next = cur.concat([{ id: kid, title: String(kbItem.title || ''), cat: String(kbItem.cat || '') }]);
    list[i] = Object.assign({}, prev, { kb: next, updatedAt: Date.now() });
    try {
      await chrome.storage.local.set({ [NP_NOTES_KEY]: list });
      result = { ok: true, added: true, noteId };
    } catch (_) { result = { ok: false, why: '写入失败' }; }
  });
  return result;
}

// === 跑 ===
let total = 0, fail = 0;
const pass = (n, c, det) => { total++; if (!c) fail++; console.log((c ? '✅' : '❌') + ' ' + n + (det ? ' — ' + det : '')); };

// ---- 1) 注入新条 ----
store[NP_NOTES_KEY] = [
  { id: 'n1', status: '草稿', title: '闭水试验稿', kb: [{ id: 'k_old', title: '旧条目' }] },
];
const r1 = await npNoteAddKb('n1', { id: 'k_new', title: '闭水试验 48 小时', cat: '避坑经验' });
pass('注入新条 ok', r1.ok === true);
pass('注入新条 added=true', r1.added === true);
const n1 = (await npNotesAll()).find(x => x.id === 'n1');
pass('档案 kb 长度 +1（从 1 到 2）', n1.kb.length === 2);
pass('新条目 id 对', n1.kb[1].id === 'k_new');
pass('新条目 title 对', n1.kb[1].title === '闭水试验 48 小时');
pass('新条目 cat 对', n1.kb[1].cat === '避坑经验');

// ---- 2) 重复注入同 id → 去重 ----
const r2 = await npNoteAddKb('n1', { id: 'k_new', title: '别的标题', cat: '数据·成本' });
pass('重复注入 ok', r2.ok === true);
pass('重复注入 added=false', r2.added === false);
const n1b = (await npNotesAll()).find(x => x.id === 'n1');
pass('重复注入 kb 长度不变', n1b.kb.length === 2);
pass('重复注入 原条目不变', n1b.kb[1].title === '闭水试验 48 小时');

// ---- 3) 档案不存在 ----
const r3 = await npNoteAddKb('n_not_exist', { id: 'k_x', title: 'X' });
pass('档案不存在 → ok=false', r3.ok === false);
pass('档案不存在 → why=档案不存在', r3.why === '档案不存在');

// ---- 4) 参数不全 ----
const r4a = await npNoteAddKb('', { id: 'k', title: 't' });
pass('noteId 空 → ok=false', r4a.ok === false && r4a.why === '参数不全');
const r4b = await npNoteAddKb('n1', null);
pass('kbItem null → ok=false', r4b.ok === false && r4b.why === '参数不全');
const r4c = await npNoteAddKb('n1', { title: 'no id' });
pass('kbItem.id 空 → ok=false', r4c.ok === false && r4c.why === '参数不全');

// ---- 5) 原档案 kb 不存在 → 直接挂 ----
store[NP_NOTES_KEY] = [{ id: 'n2', status: '待发', title: '无 kb 档案' }];
const r5 = await npNoteAddKb('n2', { id: 'k_first', title: '第一条', cat: '产品介绍' });
pass('空 kb 档案 注入 ok', r5.ok === true && r5.added === true);
const n2 = (await npNotesAll()).find(x => x.id === 'n2');
pass('空 kb 档案 kb 长度 =1', n2.kb.length === 1);

// ---- 6) updatedAt 被刷新 ----
const before = n2.updatedAt || 0;
await new Promise(r => setTimeout(r, 5));
const r6 = await npNoteAddKb('n2', { id: 'k_second', title: '第二条' });
pass('updatedAt 被刷新', (await npNotesAll()).find(x => x.id === 'n2').updatedAt > before);

console.log('\n📋 npNoteAddKb 自检完成: ' + (total - fail) + '/' + total + ' 通过');
if (fail > 0) process.exit(1);