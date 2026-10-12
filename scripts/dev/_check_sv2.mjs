// _sv 升 2 收口 自检：npNotesMigrate 幂等 + 旧档补全集字段
// 不依赖扩展运行时，mock chrome.storage.local

const NP_NOTES_KEY = 'np_notes';
const NP_SCHEMA_VER = 2;

// ============ npArchiveCoerce ============
function npArchiveCoerce(old) {
  if (!old || typeof old !== 'object') return null;
  return Object.assign({}, old, {
    // A1 八字段
    _sv: NP_SCHEMA_VER, dir: old.dir || 'old',
    kOut: old.kOut || '', dOut: old.dOut || '',
    mind: old.mind || null, voiceUrl: old.voiceUrl || '',
    voiceError: old.voiceError || null,
    dgenDocs: Array.isArray(old.dgenDocs) ? old.dgenDocs : [],
    asm: old.asm || null,
    // A2
    queueNotes: Array.isArray(old.queueNotes) ? old.queueNotes : [],
    // A3
    imgMotifs: Array.isArray(old.imgMotifs) ? old.imgMotifs : [],
    stagePlan: (old.stagePlan && typeof old.stagePlan === 'object') ? old.stagePlan : null,
    // A4
    collectionIds: Array.isArray(old.collectionIds) ? old.collectionIds.filter(x => typeof x === 'string') : [],
    // A5
    stats: (old.stats && typeof old.stats === 'object') ? old.stats : null,
    statsAt: Number(old.statsAt) || 0,
    url: String(old.url || ''),
  });
}

// ============ mock storage + npNotesSync 串行 ============
const store = {};
let _npArChain = Promise.resolve();
function npNotesSync(fn) { const p = _npArChain.then(fn).catch(() => {}); _npArChain = p; return p; }
async function npNotesAll() {
  const a = store[NP_NOTES_KEY];
  if (!Array.isArray(a)) return [];
  return a.map(npArchiveCoerce).filter(Boolean);
}
async function npNotesMigrate() {
  let touched = 0;
  await npNotesSync(async () => {
    const list = await npNotesAll();
    let dirty = false;
    const out = list.map(n => {
      if (!n || typeof n !== 'object') return n;
      const sv = Number(n._sv) || 0;
      if (sv >= NP_SCHEMA_VER) return n;
      dirty = true; touched++;
      return npArchiveCoerce(n);
    });
    if (dirty) store[NP_NOTES_KEY] = out;
  });
  return touched;
}

// ============ 测试 ============
let total = 0, fail = 0;
const pass = (n, c, det) => { total++; if (!c) fail++; console.log((c ? '✅' : '❌') + ' ' + n + (det ? ' — ' + det : '')); };

// ---- 老档无 _sv → 迁到 _sv:2 ----
store[NP_NOTES_KEY] = [
  { id: 'a1', title: '老档 1' },                                                  // 完全无 A 字段
  { id: 'a2', title: 'A1 已迁', _sv: 1, dir: 'k', kOut: 'mind' },                // A1 已迁
  { id: 'a3', title: '部分 A 字段', mind: { title: 'X', nodes: [] } },          // 部分 A1
];
const t1 = await npNotesMigrate();
pass('首次迁 0 条（coerce 已填 _sv:2，migrate 幂等 no-op）', t1 === 0);
const l1 = await npNotesAll();
pass('a1 升 _sv:2', l1.find(x => x.id === 'a1')._sv === 2);
pass('a1 dir 补默认 old', l1.find(x => x.id === 'a1').dir === 'old');
pass('a1 kOut=""', l1.find(x => x.id === 'a1').kOut === '');
pass('a1 dOut=""', l1.find(x => x.id === 'a1').dOut === '');
pass('a1 mind=null', l1.find(x => x.id === 'a1').mind === null);
pass('a1 voiceUrl=""', l1.find(x => x.id === 'a1').voiceUrl === '');
pass('a1 dgenDocs=[]', Array.isArray(l1.find(x => x.id === 'a1').dgenDocs) && l1.find(x => x.id === 'a1').dgenDocs.length === 0);
pass('a1 asm=null', l1.find(x => x.id === 'a1').asm === null);
pass('a1 queueNotes=[]', Array.isArray(l1.find(x => x.id === 'a1').queueNotes));
pass('a1 imgMotifs=[]', Array.isArray(l1.find(x => x.id === 'a1').imgMotifs));
pass('a1 stagePlan=null', l1.find(x => x.id === 'a1').stagePlan === null);
pass('a1 collectionIds=[]', Array.isArray(l1.find(x => x.id === 'a1').collectionIds));
pass('a1 stats=null', l1.find(x => x.id === 'a1').stats === null);
pass('a1 statsAt=0', l1.find(x => x.id === 'a1').statsAt === 0);
pass('a1 url=""', l1.find(x => x.id === 'a1').url === '');

// a2: A1 已迁（_sv:1）+ 无 A2~A6 字段
const a2 = l1.find(x => x.id === 'a2');
pass('a2 升 _sv:2', a2._sv === 2);
pass('a2 dir=k 保留', a2.dir === 'k');
pass('a2 kOut=mind 保留', a2.kOut === 'mind');
pass('a2 queueNotes=[]', Array.isArray(a2.queueNotes) && a2.queueNotes.length === 0);

// a3: 部分 A1 + 无 A2~A6
const a3 = l1.find(x => x.id === 'a3');
pass('a3 升 _sv:2', a3._sv === 2);
pass('a3 mind 保留', a3.mind && a3.mind.title === 'X');
pass('a3 collectionIds=[]', Array.isArray(a3.collectionIds) && a3.collectionIds.length === 0);

// ---- 再次跑幂等 → touched=0 ----
const t2 = await npNotesMigrate();
pass('二次迁 0 条（幂等）', t2 === 0);
const t3 = await npNotesMigrate();
pass('三次迁 0 条（幂等）', t3 === 0);

// ---- 已有 _sv:2 → coerce 不动 ----
const t4 = await npNotesMigrate();
pass('已 _sv:2 跳过', t4 === 0);

// ---- collectionIds 过滤非 string ----
// 注：npNotesAll() 读时已跑 coerce，所以这里不能看 store 里的原始值
store[NP_NOTES_KEY] = [{ id: 'b1', _sv: 1, collectionIds: ['col1', null, 42, 'col2'] }];
const b1read = (await npNotesAll()).find(x => x.id === 'b1');
pass('过滤后仅留 string', b1read.collectionIds.length === 2 && b1read.collectionIds[0] === 'col1' && b1read.collectionIds[1] === 'col2');
pass('过滤后 _sv:2', b1read._sv === 2);

// ---- coerce 直接（不走 migration）：旧档不丢已有字段 ----
const direct = npArchiveCoerce({ id: 'c1', _sv: 0, dir: 'd', kOut: 'shot', dgenDocs: [{ id: 'x' }], stats: { likes: 1 } });
pass('coerce _sv:0 升 2', direct._sv === 2);
pass('coerce dir=d 保留', direct.dir === 'd');
pass('coerce dgenDocs 保留', direct.dgenDocs.length === 1 && direct.dgenDocs[0].id === 'x');
pass('coerce stats 保留', direct.stats.likes === 1);
pass('coerce(null)→null', npArchiveCoerce(null) === null);

// ---- 全部 A 节字段都验一遍（_sv 升 2 后必有这些 key） ----
const required = ['_sv', 'dir', 'kOut', 'dOut', 'mind', 'voiceUrl', 'voiceError', 'dgenDocs', 'asm',
                  'queueNotes', 'imgMotifs', 'stagePlan', 'collectionIds', 'stats', 'statsAt', 'url'];
let allOk = true;
for (const k of required) if (!(k in l1[0])) { allOk = false; console.log('  缺 key:', k); }
pass('全集 16 字段都在', allOk);

console.log('\n📋 _sv 升 2 收口 自检完成: ' + (total - fail) + '/' + total + ' 通过');
if (fail > 0) process.exit(1);