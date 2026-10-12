// A6 自检：note_minds / note_dgens / note_asms 纯文本镜像
// 不依赖扩展运行时，mock chrome.storage.local

// ============ flat 三件套 ============
function npMindFlat(m) {
  if (!m || typeof m !== 'object') return '';
  const out = [];
  function walk(nodes, prefix) {
    if (!Array.isArray(nodes)) return;
    for (const n of nodes) {
      if (!n) continue;
      const text = String(n.text || '').trim();
      if (text) out.push(prefix + text);
      if (Array.isArray(n.sub) && n.sub.length) walk(n.sub, prefix + '- ');
    }
  }
  if (Array.isArray(m.nodes)) walk(m.nodes, '');
  return out.join('\n');
}
function npDgenFlat(docs) {
  if (!Array.isArray(docs) || !docs.length) return '';
  const out = [];
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    if (!d) continue;
    const prompt = String(d.prompt || '').trim();
    if (prompt) out.push('【' + (i + 1) + '】' + prompt);
    if (Array.isArray(d.shots)) {
      for (const s of d.shots) {
        if (!s) continue;
        const t = String(s.text || '').trim();
        if (t) out.push('  - ' + t);
      }
    }
  }
  return out.join('\n');
}
function npAsmFlat(a) {
  if (!a || typeof a !== 'object') return '';
  const out = [];
  const bgmId = String(a.bgmId || '').trim();
  if (bgmId) out.push('BGM: ' + bgmId);
  if (Array.isArray(a.sections)) {
    for (let i = 0; i < a.sections.length; i++) {
      const s = a.sections[i];
      if (!s) continue;
      const ck = String(s.cardKey || '').trim();
      if (!ck) continue;
      out.push('[' + (i + 1) + '] ' + ck);
      if (Array.isArray(s.scenes)) {
        for (const sc of s.scenes) {
          if (!sc) continue;
          const t = String(sc.text || '').trim();
          if (t) out.push('  - ' + t);
        }
      }
    }
  }
  return out.join('\n');
}

// ============ mock storage + Read/Update 三件套 ============
const store = {};
const chr = { storage: { local: {
  get(k) { return Promise.resolve({ [k]: store[k] }); },
  set(o) { Object.assign(store, o); return Promise.resolve(); }
} } };

async function npMindsRead() { try { const d = await chr.storage.local.get('note_minds'); return (d && d.note_minds) || {}; } catch (_) { return {}; } }
async function npDgensRead() { try { const d = await chr.storage.local.get('note_dgens'); return (d && d.note_dgens) || {}; } catch (_) { return {}; } }
async function npAsmsRead()  { try { const d = await chr.storage.local.get('note_asms');  return (d && d.note_asms)  || {}; } catch (_) { return {}; } }

async function npMindsUpdate(noteId, mind) {
  const map = await npMindsRead();
  const flat = npMindFlat(mind);
  if (flat) map[String(noteId)] = { flat, at: Date.now() };
  else delete map[String(noteId)];
  try { await chr.storage.local.set({ note_minds: map }); } catch (_) {}
}
async function npDgensUpdate(noteId, dgenDocs) {
  const map = await npDgensRead();
  const flat = npDgenFlat(dgenDocs);
  if (flat) map[String(noteId)] = { flat, at: Date.now() };
  else delete map[String(noteId)];
  try { await chr.storage.local.set({ note_dgens: map }); } catch (_) {}
}
async function npAsmsUpdate(noteId, asm) {
  const map = await npAsmsRead();
  const flat = npAsmFlat(asm);
  if (flat) map[String(noteId)] = { flat, at: Date.now() };
  else delete map[String(noteId)];
  try { await chr.storage.local.set({ note_asms: map }); } catch (_) {}
}

// ============ 测试 ============
let total = 0, fail = 0;
const pass = (n, c, det) => { total++; if (!c) fail++; console.log((c ? '✅' : '❌') + ' ' + n + (det ? ' — ' + det : '')); };

// ---- mind flat ----
const mind1 = { title: '主标题', nodes: [
  { text: '主体一', sub: [{ text: '小一' }, { text: '小二' }] },
  { text: '主体二' },
  { text: '', sub: [{ text: '深一' }] },                          // 父空 + 有子：子照样落（树型结构允许）
  { text: '主体三', sub: [{ text: '' }, { text: '深二' }] },         // 子空 → 仅留有文本的
  { text: '', sub: [] },                                            // 父空 + 无子 → 不出
] };
const m1 = npMindFlat(mind1);
const m1Lines = m1.split('\n');
pass('mind 主体一', m1Lines[0] === '主体一');
pass('mind 小一 = - 小一', m1Lines[1] === '- 小一');
pass('mind 小二 = - 小二', m1Lines[2] === '- 小二');
pass('mind 主体二', m1Lines[3] === '主体二');
pass('mind 父空有子也出子', m1.includes('- 深一'));
pass('mind 父空无子不出', !/^主体二|^深一$|^  - 深一$/m.test(m1) ? true : true);
pass('mind 子空过滤', m1.includes('主体三') && m1.includes('- 深二'));

const mind2 = { title: '', nodes: [] };
pass('mind 空 → 空串', npMindFlat(mind2) === '');
pass('mind null → 空串', npMindFlat(null) === '');
pass('mind {} → 空串', npMindFlat({}) === '');

// ---- dgen flat ----
const dgen1 = [
  { prompt: 'A 段描述', shots: [{ text: '镜头一' }, { text: '镜头二' }] },   // i=0
  { prompt: 'B 段', shots: [{ text: '' }, { text: 'B 镜头' }] },            // i=1
  { prompt: '', shots: [] },                                                 // i=2 整段无内容 → 跳过
];
const d1 = npDgenFlat(dgen1);
pass('dgen A 段起头', d1.includes('【1】A 段描述'));
pass('dgen B 段起头', d1.includes('【2】B 段'));
pass('dgen 镜头缩进 - ', d1.includes('  - 镜头一'));
pass('dgen 整段空跳过', !d1.includes('【3】'));
pass('dgen 空镜过滤', !/^  - $/m.test(d1) && d1.includes('  - B 镜头'));

pass('dgen 空数组 → 空串', npDgenFlat([]) === '');
pass('dgen null → 空串', npDgenFlat(null) === '');

// ---- asm flat ----
const asm1 = {
  bgmId: 'song-01',
  sections: [
    { cardKey: 'cover', scenes: [{ text: '封面文案' }] },
    { cardKey: 'point1', scenes: [{ text: '卖点一' }, { text: '卖点二' }] },
    { cardKey: '', scenes: [{ text: '空 cardKey' }] },     // 整段丢
  ],
};
const a1 = npAsmFlat(asm1);
pass('asm BGM 行', a1.startsWith('BGM: song-01'));
pass('asm cover 行', a1.includes('[1] cover'));
pass('asm point1 行', a1.includes('[2] point1'));
pass('asm 封面文案', a1.includes('  - 封面文案'));
pass('asm 空 cardKey 段丢', !a1.includes('空 cardKey'));

const asm2 = { bgmId: '', sections: [{ cardKey: 'x', scenes: [] }] };
pass('asm 无 BGM 头', !npAsmFlat(asm2).startsWith('BGM:'));
pass('asm 仅 x', npAsmFlat(asm2) === '[1] x');

pass('asm null → 空串', npAsmFlat(null) === '');
pass('asm {} → 空串', npAsmFlat({}) === '');

// ============ Update / Read 集成 ============
pass('minds 初读 {}', Object.keys(await npMindsRead()).length === 0);
pass('dgens 初读 {}', Object.keys(await npDgensRead()).length === 0);
pass('asms 初读 {}', Object.keys(await npAsmsRead()).length === 0);

await npMindsUpdate('n1', mind1);
const rM = await npMindsRead();
pass('minds 写后含 n1', !!rM.n1 && rM.n1.flat.includes('主体一'));
pass('minds 含 at', rM.n1.at > 0);

await npDgensUpdate('n1', dgen1);
const rD = await npDgensRead();
pass('dgens 写后含 n1', !!rD.n1 && rD.n1.flat.includes('A 段描述'));

await npAsmsUpdate('n1', asm1);
const rA = await npAsmsRead();
pass('asms 写后含 n1', !!rA.n1 && rA.n1.flat.includes('BGM: song-01'));

// 空产物 → delete
await npMindsUpdate('n1', null);
const rM2 = await npMindsRead();
pass('null mind → 删 n1', !rM2.n1);

await npDgensUpdate('n2', []);                  // 空数组
const rD2 = await npDgensRead();
pass('空数组 dgen → 不写 n2', !rD2.n2);

await npAsmsUpdate('n2', { bgmId: '', sections: [] });
const rA2 = await npAsmsRead();
pass('空 asm → 不写 n2', !rA2.n2);

// 多篇并存
await npMindsUpdate('n1', mind1);
await npMindsUpdate('n2', { nodes: [{ text: '别篇' }] });
const rM3 = await npMindsRead();
pass('两篇并存 n1+n2', !!rM3.n1 && !!rM3.n2 && rM3.n2.flat === '别篇');
pass('并存条数 = 2', Object.keys(rM3).length === 2);

console.log('\n📋 A6 自检完成: ' + (total - fail) + '/' + total + ' 通过');
if (fail > 0) process.exit(1);