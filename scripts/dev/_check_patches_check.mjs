// _npPatchesCheck 自检：mock chrome.storage.local，验各 key 条数 + 档案 _sv 分布
const NP_NOTES_KEY = 'np_notes';
const NP_STATS_KEY = 'note_stats';
const NP_NOTE_QUEUE_KEY = 'note_queue';
const NP_COLLECTIONS_KEY = 'np_collections';
const NP_CLIPS_KEY = 'np_clips';
const NP_MINDS_KEY = 'note_minds';
const NP_DGENS_KEY = 'note_dgens';
const NP_ASMS_KEY = 'note_asms';

const store = {};
const chrome = {
  storage: { local: {
    get: async (k) => {
      if (Array.isArray(k)) {
        const out = {};
        k.forEach(x => out[x] = store[x]);
        return out;
      }
      if (typeof k === 'string') return { [k]: store[k] };
      if (k && typeof k === 'object') {
        const out = {};
        Object.keys(k).forEach(x => out[x] = store[x]);
        return out;
      }
      return {};
    },
  } },
};

function npArchiveCoerce(old) {
  if (!old || typeof old !== 'object') return null;
  return Object.assign({}, old, { _sv: 2, url: String(old.url || '') });
}
async function npNotesAll() {
  const a = store[NP_NOTES_KEY];
  if (!Array.isArray(a)) return [];
  return a.map(npArchiveCoerce).filter(Boolean);
}
async function npNoteQueueRead() { const d = await chrome.storage.local.get(NP_NOTE_QUEUE_KEY); return Array.isArray(d[NP_NOTE_QUEUE_KEY]) ? d[NP_NOTE_QUEUE_KEY] : []; }
async function npCollectionsRead() { const d = await chrome.storage.local.get(NP_COLLECTIONS_KEY); return Array.isArray(d[NP_COLLECTIONS_KEY]) ? d[NP_COLLECTIONS_KEY] : []; }
async function npClipsRead() { const d = await chrome.storage.local.get(NP_CLIPS_KEY); return Array.isArray(d[NP_CLIPS_KEY]) ? d[NP_CLIPS_KEY] : []; }
async function npMindsRead() { const d = await chrome.storage.local.get(NP_MINDS_KEY); return (d && d[NP_MINDS_KEY]) || {}; }
async function npDgensRead() { const d = await chrome.storage.local.get(NP_DGENS_KEY); return (d && d[NP_DGENS_KEY]) || {}; }
async function npAsmsRead()  { const d = await chrome.storage.local.get(NP_ASMS_KEY);  return (d && d[NP_ASMS_KEY])  || {}; }

// 复制 _npPatchesCheck 主体
async function npPatchesCheck() {
  const out = {};
  try { out.queue = (await npNoteQueueRead()).length; } catch (_) { out.queue = -1; }
  try { out.collections = (await npCollectionsRead()).length; } catch (_) { out.collections = -1; }
  try { out.clips = (await npClipsRead()).length; } catch (_) { out.clips = -1; }
  try { const d = await chrome.storage.local.get(NP_STATS_KEY); out.stats = Object.keys(d[NP_STATS_KEY] || {}).length; } catch (_) { out.stats = -1; }
  try { out.minds = Object.keys(await npMindsRead()).length; } catch (_) { out.minds = -1; }
  try { out.dgens = Object.keys(await npDgensRead()).length; } catch (_) { out.dgens = -1; }
  try { out.asms = Object.keys(await npAsmsRead()).length; } catch (_) { out.asms = -1; }
  try {
    const list = await npNotesAll();
    const svMap = {};
    list.forEach(n => { const k = '_sv:' + (n && n._sv != null ? n._sv : 'undef'); svMap[k] = (svMap[k] || 0) + 1; });
    out.notesTotal = list.length;
    out.notesSv = svMap;
  } catch (_) { out.notesTotal = -1; out.notesSv = {}; }
  return out;
}

let total = 0, fail = 0;
const pass = (n, c, det) => { total++; if (!c) fail++; console.log((c ? '✅' : '❌') + ' ' + n + (det ? ' — ' + det : '')); };

// ---- 空库 ----
const r1 = await npPatchesCheck();
pass('空库 queue=0', r1.queue === 0);
pass('空库 collections=0', r1.collections === 0);
pass('空库 clips=0', r1.clips === 0);
pass('空库 stats=0', r1.stats === 0);
pass('空库 minds=0', r1.minds === 0);
pass('空库 dgens=0', r1.dgens === 0);
pass('空库 asms=0', r1.asms === 0);
pass('空库 notesTotal=0', r1.notesTotal === 0);
pass('空库 notesSv 空', Object.keys(r1.notesSv).length === 0);

// ---- 假数据 ----
store[NP_NOTES_KEY] = [
  { id: 'n1', _sv: 2 }, { id: 'n2', _sv: 2 }, { id: 'n3' }, { id: 'n4', _sv: 1 },
];
store[NP_NOTE_QUEUE_KEY] = [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }];
store[NP_COLLECTIONS_KEY] = [{ id: 'c1' }, { id: 'c2' }];
store[NP_CLIPS_KEY] = [{ id: 'clip1' }, { id: 'clip2' }, { id: 'clip3' }, { id: 'clip4' }];
store[NP_STATS_KEY] = { abc: { likes: 1 }, xyz: { likes: 2 }, mno: { likes: 3 } };
store[NP_MINDS_KEY] = { n1: { flat: '...' }, n2: { flat: '...' } };
store[NP_DGENS_KEY] = { n1: { flat: '...' } };
store[NP_ASMS_KEY] = { n1: { flat: '...' }, n2: { flat: '...' }, n3: { flat: '...' } };

const r2 = await npPatchesCheck();
pass('queue=3', r2.queue === 3);
pass('collections=2', r2.collections === 2);
pass('clips=4', r2.clips === 4);
pass('stats=3', r2.stats === 3);
pass('minds=2', r2.minds === 2);
pass('dgens=1', r2.dgens === 1);
pass('asms=3', r2.asms === 3);
pass('notesTotal=4', r2.notesTotal === 4);
// 注：npArchiveCoerce 把 _sv 规整成 2（_sv:undef/_sv:1 都升 _sv:2），所以分布只看到 _sv:2 这一档
pass('notesSv 全部 _sv:2', r2.notesSv['_sv:2'] === 4);
pass('notesSv 没 _sv:undef', !r2.notesSv['_sv:undef']);

// ---- 单 key 出错仍返回 -1 ----
delete store[NP_NOTE_QUEUE_KEY];
const r3 = await npPatchesCheck();
pass('queue key 删了仍跑通', r3.queue === 0);   // Array.isArray(undefined) === false → []

console.log('\n📋 _npPatchesCheck 自检完成: ' + (total - fail) + '/' + total + ' 通过');
if (fail > 0) process.exit(1);
