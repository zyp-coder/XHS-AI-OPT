'use strict';
/* 笔记规划 v3 数据层自检：node scripts/dev/_smoke_note_plan.js
   v3 口径（2026-09-29 四十二改）：成长三阶段（1 万粉门槛）→ **五条线**（配比单位）→ 每条线下的写法（KINDS，**用户可挑**）
   四十五改口径（老板：「调子不要了，但铺垫/展开/产品的篇幅配比和字数设定可以给 5 条线和写法来用」）：
   **调子（八条路线）整体退市**——📐 篇幅配比与 🖋 字数挂在每条线与每种写法上，阶段诊断也跟着五条线走 */
const assert = require('node:assert/strict');
const path = require('node:path');
const NotePlan = require(path.resolve(__dirname, '../../extension/lib/note-plan.js'));

let n = 0;
const ok = (name) => { n++; console.log('  PASS ' + name); };

/* ── 阶段：三档，门槛 3000 / 1万 ── */
assert.equal(NotePlan.STAGES.length, 3, '成长三阶段');
assert.deepEqual(NotePlan.STAGES.map(s => s.key), ['cold', 'grow', 'mature']);
assert.equal(NotePlan.STAGES[2].fans, '1万+', '成熟期门槛按 1 万粉');
NotePlan.STAGES.forEach(s => {
  ['key', 'name', 'fans', 'will', 'why', 'never'].forEach(f => assert.ok(String(s[f] || '').trim(), `阶段 ${s.key} 缺字段 ${f}`));
});
ok('三阶段齐备（冷启动 / 成长 / 成熟，1 万粉门槛）');

/* ── 阶段判定 ── */
assert.equal(NotePlan.detectStage({ fans: '0' }), 'cold');
assert.equal(NotePlan.detectStage({ fans: '2999' }), 'cold');
assert.equal(NotePlan.detectStage({ fans: 3000 }), 'grow');
assert.equal(NotePlan.detectStage({ fans: '9999' }), 'grow');
assert.equal(NotePlan.detectStage({ fans: 10000 }), 'mature');
assert.equal(NotePlan.detectStage({ fans: '1.2万' }), 'mature');
assert.equal(NotePlan.detectStage({}), 'cold', '读不到粉丝给最保守的冷启动');
assert.equal(NotePlan.detectStage({ fans: '1,234' }), 'cold', '千分位要能解析');
ok('粉丝数/万位解析 → 三阶段');

/* ── 类型库：五条线 ── */
const keys = NotePlan.TYPES.map(t => t.key);
assert.equal(keys.length, 5, '五条线');
assert.equal(new Set(keys).size, keys.length, '类型 key 不许重复');
assert.deepEqual([...keys].sort(), ['echo', 'hot', 'howto', 'meme', 'tale']);
assert.deepEqual(NotePlan.TYPES.map(t => t.name), ['故事线', '共鸣线', '热梗线', '热点线', '干货线'], '五条线的名字与顺序');
NotePlan.TYPES.forEach(t => {
  assert.ok(['image', 'video', 'both'].includes(t.carrier), `${t.key} 载体非法`);
  assert.ok(String(t.what || '').length >= 8, `${t.key} 缺形态描述`);
  assert.ok(String(t.role || '').trim(), `${t.key} 缺作用标记`);
  (t.needs || []).forEach(x => assert.ok(['kb', 'kbMany', 'photo', 'chat'].includes(x), `${t.key} 依赖项非法：${x}`));
  assert.equal(typeof t.arc, 'boolean', `${t.key} 缺系列标记`);
});
ok('类型库 5 条线，载体/作用/依赖合法');

/* ── 线补「魂」：节拍 / 必须写出来的东西 / 戒条 / 类样本（2026-09-28 三十九改立的，四十二改挂到线上） ──
   同题同类型实测（scripts/dev/_type_matrix.py）量出：提示词只差 3 行（类名+写法名+目标）时，
   成稿会变成同一个模子。这批给每条线补四样，让"类型"真的决定形态。 */
NotePlan.TYPES.forEach(t => {
  assert.ok(Array.isArray(t.beats) && t.beats.length >= 3, `${t.key} 缺节拍（至少 3 条）`);
  t.beats.forEach((b, i) => assert.ok(String(b).length >= 12, `${t.key} 第 ${i + 1} 条节拍太短：${b}`));
  assert.ok(String(t.must || '').length >= 30 && /自检/.test(String(t.must)), `${t.key} 缺"要写出来的东西 + 自检"`);
  assert.ok(String(t.taboo || '').length >= 15, `${t.key} 缺这条线的戒条`);
  assert.ok(Array.isArray((t.samples || {}).openers) && t.samples.openers.length >= 1, `${t.key} 缺开篇类样本`);
  assert.ok(Array.isArray((t.samples || {}).titles) && t.samples.titles.length >= 1, `${t.key} 缺标题类样本`);
  const tShape = t.shape || {};
  assert.equal(tShape.build + tShape.core + tShape.sell, 100, `${t.key} 的 📐 篇幅配比要凑够 100%：${JSON.stringify(tShape)}`);
  assert.ok(tShape.build >= 0 && tShape.core >= 0 && tShape.sell >= 0, `${t.key} 配比不许为负`);
  assert.ok(NotePlan.wordsOf(t.words), `${t.key} 的 🖋 默认字数档认不出：${t.words}`);
});
['beats', 'must', 'taboo'].forEach(f => {
  const vals = NotePlan.TYPES.map(t => JSON.stringify(t[f]));
  assert.equal(new Set(vals).size, 5, `五条线的 ${f} 有重复——类型又变回标签了`);
});
// 老板点名的三种写法要有专属套路（历史文化 / 抽象荒诞 / 热点理解）
['history', 'absurd', 'hotFit'].forEach(k => {
  const kk = NotePlan.kindOf(k);
  assert.ok(Array.isArray(kk.beats) && kk.beats.length >= 4, `写法 ${k} 缺专属节拍`);
  assert.ok(String(kk.must || '').length >= 30, `写法 ${k} 缺"要写出来的东西"`);
  assert.ok(String(kk.taboo || '').length >= 15, `写法 ${k} 缺戒条`);
});
ok('五条线补魂：节拍/必须/戒条/类样本齐备且两两不同；历史文化/抽象荒诞/热点理解三种写法有专属套路');

/* ── 类型块文本：四十五改起它是"这篇怎么讲"的**唯一**主约束（节拍＋形态＋配比＋字数＋样本） ── */
const tsHowto = NotePlan.describeTypeScript('howto', 'steps');
assert.match(tsHowto, /这一篇是「干货线 · 教程步骤」/, tsHowto);
assert.match(tsHowto, /第一优先级/, '要标成第一优先级（和通用写法模板冲突时以它为准）');
assert.match(tsHowto, /必须走过的节拍（顺序别颠倒）/, tsHowto);
assert.match(tsHowto, /1\. 先说清动手之前/, '节拍要编号列出');
assert.match(tsHowto, /这一类要写出来的东西/, tsHowto);
assert.match(tsHowto, /这一类的戒条/, tsHowto);
assert.match(tsHowto, /类样本/, tsHowto);
assert.match(tsHowto, /\*\*要分点 \/ 编号\*\*/, '要分点的这一类把形态写进自己的块（形态归线／写法）');
assert.match(tsHowto, /篇幅配比（按整篇正文字数算/, '📐 配比跟着这条线／这种写法进提示词');
assert.match(tsHowto, /· 字数：这篇写 \d+-\d+ 字（/, '🖋 字数档跟着这条线／这种写法进提示词');
assert.ok(!/调子/.test(tsHowto), '调子已退市：类型块里不许再出现调子口径');
const tsHist = NotePlan.describeTypeScript('tale', 'history');
assert.match(tsHist, /从一个具体的来路切进来/, '写法有节拍时要用写法的');
assert.ok(!/先挑一个场景把故事讲起来/.test(tsHist), '写法有节拍时不该再叠线自己的');
assert.match(NotePlan.describeTypeScript('tale', 'steps'), /先挑一个场景把故事讲起来/, '写法挂错线时退回线自己的节拍');
assert.equal(NotePlan.describeTypeScript('nope', 'steps'), '', '不认识的类型给空');
assert.equal(NotePlan.describeTypeScript(null, null), '', '没类型给空');
assert.equal(NotePlan.describeTypeScript('vlog', null).split('\n').length >= 6, true, '不给写法时也要出整块（旧键也认）');
ok('describeTypeScript：线名+写法 → 分工/节拍/必须/戒条/类样本；写法节拍盖线；挂错线退回线');

/* ── 具体写法：每条都挂在五条线底下，且每条线都有写法（写法是给用户挑的） ── */
const kindKeys = NotePlan.KINDS.map(k => k.key);
assert.equal(new Set(kindKeys).size, kindKeys.length, '具体写法 key 不许重复');
assert.equal(NotePlan.KINDS.length, 23, '五条线共 23 种写法');
NotePlan.KINDS.forEach(k => {
  assert.ok(NotePlan.typeOf(k.type), `${k.key} 挂在不认识的类型上：${k.type}`);
  assert.ok(String(k.name || '').trim() && String(k.form || '').length >= 6, `${k.key} 缺名字/形态`);
  assert.ok(String(k.ex || '').length >= 4, `${k.key} 缺示例`);
  assert.ok(Array.isArray(k.beats) && k.beats.length >= 3, `${k.key} 缺专属节拍（写法是给用户挑的，挑中就有自己的套路）`);
});
keys.forEach(tk => {
  const list = NotePlan.kindsOfType(tk);
  assert.ok(list.length >= 4 && list.length <= 5, `线 ${tk} 底下的写法该有 4-5 种，实际 ${list.length}`);
  list.forEach(k => assert.equal(k.type, tk));
});
// 每条线 4-5 种（老板口径「每种类型写4-5个，然后让用户来选」）
assert.deepEqual(keys.map(tk => NotePlan.kindsOfType(tk).length), [5, 5, 4, 4, 5], '五条线各自的写法数');
// 形态标记只在"形态就是魂"的那几处（给 A/B 分层用）
NotePlan.kindsOfType('howto').filter(k => k.needsForm).forEach(k => assert.deepEqual(k.needsForm, ['list']));
assert.equal(NotePlan.kindsOfType('howto').filter(k => k.needsForm).length, 3, '干货线里"分步/编号/一条条答"的三种写法带 list');
assert.deepEqual(NotePlan.kindOf('slice').formBan, ['oneLine'], '生活切片不许一句一段');
assert.equal(NotePlan.kindsOfType('hot').filter(k => k.needsHot).length, 4, '热点线的写法都要先有那条公开由头（④ 点到热点线时 AI 去找）');
assert.ok(NotePlan.kindOf('compare') && NotePlan.kindOf('compare').type === 'howto', 'kindOf 能反查所属线，旧键 compare 也认');
assert.equal(NotePlan.kindOf('nope'), null, '不认识的写法给 null');
assert.equal(NotePlan.kindsOfType('review').length, 5, '旧键 review 折到干货线，砍到 5 种写法');
ok(`具体写法 ${NotePlan.KINDS.length} 种，五条线各 4-5 种且能反查（含形态/热点标记）`);

/* ── 配比表：三阶段 × 五条线 ── */
Object.keys(NotePlan.STAGE_MIX).forEach(st => {
  const rows = NotePlan.STAGE_MIX[st];
  assert.equal(rows.length, 5, `阶段 ${st} 配比表应覆盖五条线`);
  assert.deepEqual(rows.map(r => r.type).sort(), [...keys].sort(), `阶段 ${st} 配比表类型不全`);
  rows.forEach(r => {
    assert.ok(Number(r.share) > 0, `${st}.${r.type} 权重应为正`);
    assert.ok(String(r.goal || '').trim() && String(r.ex || '').trim(), `${st}.${r.type} 缺目标/例子`);
  });
});
// 各阶段的主打不一样：冷启动主打干货，成熟期主打故事线
const top = (st) => NotePlan.mixOf(st, null).slice().sort((a, b) => b.share - a.share)[0].type;
assert.equal(top('cold'), 'howto');
assert.equal(top('grow'), 'howto');
assert.equal(top('mature'), 'tale');
ok('配比表：三阶段 × 五条线，各阶段主打不同且都带目标/例子');

/* ── 例子不绑定某个品类：这套口径要对任意客户的产品都成立 ── */
// 配比表/写法的 ex 会进 AI 排产提示词、也会出现在 ⑧ 配比条的 tooltip 上，
// 参考表里的榴莲口径若留在里面，卖别的东西的客户会看到别人家的例子。
const FOREIGN = /榴莲|金枕|猫山王|水果之王|批发市场/;
const blobs = [];
NotePlan.TYPES.forEach(t => blobs.push(['TYPES.' + t.key, t]));
NotePlan.KINDS.forEach(k => blobs.push(['KINDS.' + k.key, k]));
Object.keys(NotePlan.STAGE_MIX).forEach(st => NotePlan.STAGE_MIX[st].forEach(r => blobs.push([`MIX.${st}.${r.type}`, r])));
NotePlan.TOPIC_SCOPES.forEach(s => blobs.push(['SCOPES.' + s.key, s]));
Object.keys(NotePlan.STAGE_PLAY).forEach(sk => blobs.push([`STAGE_PLAY.${sk}`, NotePlan.STAGE_PLAY[sk]]));
blobs.forEach(([where, obj]) => {
  const text = [obj.what, obj.ex, obj.goal, obj.note, obj.form, obj.role, obj.why].filter(Boolean).join(' ');
  assert.ok(!FOREIGN.test(text), `${where} 里还留着参考表的品类例子：${text}`);
});
ok('例子不绑定某个品类：配比/写法/话题域/阶段打法里没有参考表的榴莲口径');

/* ── 权重：用户可覆盖、越界收敛 ── */
const _c = NotePlan.mixOf('cold', { cold: { howto: 999, echo: -5, nope: 50 } });
const _row = (rows, k) => rows.filter(r => r.type === k)[0];
assert.equal(_row(_c, 'howto').share, 100, '权重上限 100');
assert.equal(_row(_c, 'echo').share, 0, '权重下限 0');
assert.equal(_c.length, 5, '不认识的类型不进门');
assert.equal(_row(NotePlan.mixOf('cold', { grow: { howto: 1 } }), 'howto').share, 30, '覆盖只认当前阶段');
assert.equal(_row(NotePlan.mixOf('nope', null), 'howto').share, 30, '未知阶段退到冷启动配比');
ok('mixOf：权重可被用户覆盖，clamp 到 0-100，按阶段生效');

/* ── 权重 → 篇数：最大余数法，永远等于总篇数 ── */
const _sum = (alloc) => alloc.reduce((a, r) => a + r.count, 0);
const coldAlloc = NotePlan.allocate(NotePlan.mixOf('cold', null), 12);
assert.equal(_sum(coldAlloc), 12, '折算后必须正好 12 篇');
const coldCount = {};
coldAlloc.forEach(r => { coldCount[r.type] = r.count; });
assert.deepEqual(coldCount, { howto: 4, tale: 3, echo: 2, meme: 2, hot: 1 }, '冷启动默认折算：' + JSON.stringify(coldCount));
const noHot = NotePlan.allocate(NotePlan.mixOf('cold', { cold: { hot: 0 } }), 12);
assert.ok(!noHot.filter(r => r.type === 'hot').length, '权重 0 的线不该出现在排产清单里');
['cold', 'grow', 'mature'].forEach(st => {
  [6, 12, 24].forEach(total => {
    assert.equal(_sum(NotePlan.allocate(NotePlan.mixOf(st, null), total)), total, `${st}×${total} 篇折算不齐`);
  });
});
assert.deepEqual(NotePlan.allocate(NotePlan.mixOf('cold', { cold: { howto: 0, tale: 0, echo: 0, meme: 0, hot: 0 } }), 12), [], '权重全 0 时不排任何线');
assert.deepEqual(NotePlan.allocate([], 12), [], '空配比给空');
// 加权重看得见效果：把热点线抬起来，它会拿到篇数
const hotUp = {};
NotePlan.allocate(NotePlan.mixOf('cold', { cold: { hot: 20 } }), 12).forEach(r => { hotUp[r.type] = r.count; });
assert.ok(hotUp.hot >= 2, '抬权重后热点线应拿到更多篇，实际 ' + hotUp.hot);
// share 是"该权重占全部权重的比例"（0 篇的线也进分母）——和 ⑧ 配比条显示的百分比同一口径
const allRows = NotePlan.mixOf('cold', null);
const totalW = allRows.reduce((a, r) => a + r.share, 0);
coldAlloc.forEach(r => {
  const w = allRows.filter(x => x.type === r.type)[0].share;
  assert.equal(r.share, Math.round(w / totalW * 100), r.type + ' 的占比应是归一化值');
});
assert.ok(coldAlloc[0].share > coldAlloc[2].share, '权重大的线占比应当更大');
ok('allocate：最大余数法折算，总和恒等于总篇数，抬权重有效');

/* ── typesForStage 由配比表推导 ── */
['cold', 'grow', 'mature'].forEach(st => {
  const list = NotePlan.typesForStage(st);
  assert.ok(list.length >= 5, `阶段 ${st} 的类型应够排（实际 ${list.length}）`);
  list.forEach(t => assert.ok(keys.includes(t.key), `阶段 ${st} 出现表外类型 ${t.key}`));
});
ok('typesForStage：配比表说了算（权重非 0 的线才是这个阶段的候选）');

/* ── 描述文本（喂 AI / UI 共用） ── */
const descMix = NotePlan.describeMix({ mix: [{ type: 'howto', count: 4 }, { type: 'tale', count: 3 }] });
assert.equal(descMix, '干货线 4 篇 · 故事线 3 篇', descMix);
const descFromItems = NotePlan.describeMix({ items: [{ type: 'hot' }, { type: 'hot' }, { type: 'echo' }] });
assert.equal(descFromItems, '热点线 2 篇 · 共鸣线 1 篇', descFromItems);
assert.equal(NotePlan.describeMix({ items: [{ type: 'review' }, { type: 'vlog' }] }), '干货线 1 篇 · 故事线 1 篇', '旧键也要折成新线名');
const descTypes = NotePlan.describeTypes(['howto', 'tale']);
assert.match(descTypes, /干货线/);
assert.match(descTypes, /作用：换收藏/, '类型描述要带"这条线是干嘛"');
assert.match(descTypes, /写法（用户会挑其中一种）：教程步骤、清单要点、答疑、避坑鉴别、算账对比/, '类型描述要带写法清单');
assert.match(descTypes, /适合做系列/, '适合系列的线要标出来');
assert.equal(NotePlan.describeTypes(['review']), NotePlan.describeTypes(['howto']), '旧键进描述文本也折成新线');
const descStage = NotePlan.describeStage('cold');
assert.match(descStage, /冷启动期/);
assert.ok(!/档位/.test(descStage), '阶段说明里不该再出现档位口径');
ok('describeMix / describeTypes / describeStage 文案与 v3 口径一致');

/* ── 料与解锁地图 ── */
const bare = NotePlan.materialsOf({ persona: { text: '我是做茶的' }, kb: [] });
assert.equal(bare.persona, true);
assert.equal(bare.kbCount, 0);
const bareMap = NotePlan.unlockMap(bare);
['tale', 'echo', 'hot'].forEach(k => assert.ok(bareMap.unlocked.includes(k), `只有人设时 ${k} 应解锁（不吃料）`));
['meme', 'howto'].forEach(k => assert.ok(!bareMap.unlocked.includes(k), `只有人设时 ${k} 应锁住（要吃料）`));
assert.equal(bareMap.unlocked.length + bareMap.locked.length, NotePlan.TYPES.length, '解锁地图不漏类型');
assert.equal(bareMap.groups.length, 1, '两条线缺的都是知识料 → 并成一组（补一样解锁两条）');
assert.deepEqual(bareMap.groups[0].types.slice().sort(), ['干货线', '热梗线']);
assert.ok(bareMap.groups.every(g => g.needText && g.types.length), '归并组要有补料提示与受益类型');
// 什么料都没有时：五条线全锁，且按"缺什么"分成两组（缺人设的一组、人设+知识料的一组）
const noneMap = NotePlan.unlockMap(NotePlan.materialsOf({}));
assert.equal(noneMap.unlocked.length, 0, '什么都没有时五条线一条都开不了');
assert.equal(noneMap.groups.length, 2, '待解锁要按"补什么"归并：只缺人设的一组、人设+知识料的一组');
assert.deepEqual(noneMap.groups.map(g => g.missing.length).sort(), [1, 2]);
ok('只有人设也能开跑：不吃料的线解锁，吃料的锁住并给出补料提示');

const full = NotePlan.materialsOf({
  persona: { text: '我是做茶的', materials: { photoCount: 20, hasChat: true, hasVideo: true } },
  kb: [
    { title: '白茶怎么存', content: '步骤一 密封 步骤二 避光', isActive: true },
    { title: '各年份价格表', content: '价格 300 元起', isActive: true },
    { title: '叶底怎么看', content: '怎么看叶底 操作方法', isActive: true },
    { title: '工序流程', content: '流程 萎凋 干燥', isActive: true },
  ],
});
assert.equal(full.kbCount, 4);
assert.equal(full.kbHasMethod, true);
assert.equal(full.kbHasData, true);
assert.equal(full.photoCount, 20);
assert.deepEqual(NotePlan.unlockMap(full).unlocked.slice().sort(), [...keys].sort(), '料齐时五条线全解锁');
ok('知识料+素材料齐备时五条线全部解锁');

const off = NotePlan.materialsOf({ persona: { text: 'x' }, kb: [{ title: 'a', content: 'b', isActive: false }] });
assert.equal(off.kbCount, 0, '停用条目不算知识料');
ok('停用知识条目不参与解锁判断');

const fromAns = NotePlan.materialsFromAnswers([
  { q: '你手上有什么能用的真实素材？', answer: '真实照片（几十张以上）；顾客反馈截图·聊天记录' },
  { q: '你是这行里的什么人？', answer: '源头（工厂·产地·农户）' },
], [{ title: 't', content: 'c', isActive: true }], '我是做茶的');
assert.equal(fromAns.photoCount, 50, '“几十张以上”应读到 50');
assert.equal(fromAns.hasChat, true, '“顾客反馈截图”应读到有反馈');
assert.equal(fromAns.hasVideo, false, '没提视频就该是 false');
assert.equal(fromAns.persona, true);
assert.equal(fromAns.kbCount, 1);
const few = NotePlan.materialsFromAnswers([{ answer: '真实照片（只有几张）' }], [], 'x');
assert.equal(few.photoCount, 5, '“只有几张”应读到 5');
const none = NotePlan.materialsFromAnswers([{ answer: '几乎没有' }], [], 'x');
assert.equal(none.photoCount, 0, '“几乎没有”应是 0');
ok('materialsFromAnswers 从问卷文本读出照片/视频/反馈');

/* ── candidatesFor：只给当前阶段 + 料够的 ── */
const candBare = NotePlan.candidatesFor('cold', bare).map(t => t.key).sort();
assert.deepEqual(candBare, ['echo', 'hot', 'tale'], '冷启动 + 只有人设：只留不吃料的三条线，实际 ' + candBare);
NotePlan.candidatesFor('grow', full).forEach(t => assert.ok(keys.includes(t.key), '候选不得出现表外类型'));
assert.equal(NotePlan.candidatesFor('grow', full).length, 5, '料齐时五条线都能做');
ok('candidatesFor 按阶段配比筛，且只留料够的');

/* ── 排产表体检 ── */
const good = {
  stage: 'mature',
  mix: [{ type: 'tale', count: 2 }, { type: 'howto', count: 1 }],
  items: [
    { title: 'a', type: 'tale', credential: '做茶 8 年', scope: 'related' },
    { title: 'b', type: 'howto', credential: '自己踩过', scope: 'samePeople' },
    { title: 'c', type: 'hot', credential: '同行聊过', scope: 'breakout' },
  ],
};
assert.equal(NotePlan.validatePlan(good).ok, true, '合规排产表应通过：' + NotePlan.validatePlan(good).problems.join(' / '));
ok('合规排产表通过体检（含破圈内容）');

const bad = {
  stage: 'cold',
  mix: [{ type: 'howto', count: 4 }],
  items: [
    { title: 'c', type: 'howto', credential: '', scope: 'related' },
    { title: 'd', type: 'nope', credential: 'x', scope: 'breakout' },
    { title: 'e', type: 'echo', credential: 'x', scope: 'related', arc: { part: 3, total: 2 } },
    { title: 'f', type: 'echo', credential: 'x', scope: '随便' },
  ],
};
const badRes = NotePlan.validatePlan(bad);
assert.equal(badRes.ok, false);
const joined = badRes.problems.join('\n');
assert.match(joined, /没挂凭据/, '缺凭据要拦');
assert.match(joined, /类型缺失或不认识/, '未知类型要拦');
assert.match(joined, /系列篇序越界/, '系列篇序越界要拦');
assert.match(joined, /话题域不认识/, '不认识的话题域要拦');
assert.match(joined, /配比偏离：干货线 目标 4 篇，排了 1 篇/, '偏离配比 2 篇以上要提示');
assert.ok(!/档位/.test(joined), '体检里不该再出现档位口径');
assert.ok(!/破圈内容不进排产/.test(joined), '破圈不再被拦');
ok('体检能抓出：缺凭据/未知类型/系列篇序/话题域/配比偏离，且不再拦破圈');

/* ── 系列 vs 单篇 ── */
assert.equal(NotePlan.arcAdvice({ perWeek: 3, photoCount: 20 }).use, 'arc');
assert.equal(NotePlan.arcAdvice({ perWeek: 1, photoCount: 20 }).use, 'single');
assert.equal(NotePlan.arcAdvice({ perWeek: 4, photoCount: 2 }).use, 'arc', '频率够、素材少 → 提示先压单篇但不算错');
assert.match(NotePlan.arcAdvice({ perWeek: 4, photoCount: 2 }).note, /3 张真实照片/);
ok('系列建议按更新频率 + 素材量给');

/* ── 话题域 ── */
assert.deepEqual(NotePlan.TOPIC_SCOPES.map(s => s.key), ['related', 'samePeople', 'breakout']);
assert.ok(NotePlan.TOPIC_SCOPES.every(s => String(s.note || '').length >= 8));
assert.match(NotePlan.TOPIC_SCOPES.filter(s => s.key === 'breakout')[0].note, /配比/, '破圈口径＝按配比控量');
ok('话题域三条，破圈口径＝可以排但要按配比控量');

/* ── 🎚 卖货话术的比例（这篇里"卖"占多少；默认＝轻带一句，与老口径一致） ── */
assert.deepEqual(NotePlan.SELL_TALK.map(t => t.key), ['none', 'light', 'mid', 'strong'], '四档：不提产品 / 轻带一句 / 自然安利 / 主打推荐');
NotePlan.SELL_TALK.forEach(t => {
  assert.ok(t.name && t.share && t.line, `话术档 ${t.key} 缺字段`);
  assert.ok(t.line.includes('{p}'), `话术档 ${t.key} 的 line 要用 {p} 占位（后台替换成产品名）`);
  assert.ok(t.line.replace(/\{p\}/g, '产品').length >= 20, `话术档 ${t.key} 的写法太短`);
});
assert.equal(NotePlan.SELL_TALK_DEFAULT, 'light', '默认档＝轻带一句（没设过的账号行为不变）');
assert.equal(NotePlan.sellTalkOf('light').line.replace(/\{p\}/g, '产品名[XX]'),
  '产品名[XX]在正文里自然出现一次即可，不做推荐语气、不要硬广。', '默认档的写法＝老规则 7 原话');
assert.equal(NotePlan.sellTalkOf('none').share, '0', '不提产品：占 0');
assert.equal(NotePlan.sellTalkOf('').key, 'light', '没设过给默认');
assert.equal(NotePlan.sellTalkOf('nope').key, 'light', '不认识的档也给默认');
const shares = NotePlan.SELL_TALK.map(t => t.share);
assert.deepEqual(shares, ['0', '1 成', '2~3 成', '5 成'], '四档比例递进');
assert.deepEqual(NotePlan.SELL_TALK.map(t => t.pct), [0, 10, 25, 50], '四档要带配比用的百分比（配比条与提示词按它算）');
ok('卖货话术比例：四档齐备（默认＝轻带一句，写法沿用老规则 7）、{p} 占位、认不出给默认');

/* ── 🖋 字数档：这一篇写多长（默认跟这条线／这种写法建议的那档；平台另有总长则以平台为准） ── */
assert.deepEqual(NotePlan.WORDS.map(w => w.key), ['short', 'mid', 'long'], '三档：短 / 中 / 长');
NotePlan.WORDS.forEach(w => {
  assert.ok(w.name && w.range && Number(w.mid) > 0, `字数档 ${w.key} 缺字段`);
});
assert.deepEqual(NotePlan.WORDS.map(w => w.range), ['300-500 字', '500-800 字', '800-1500 字'], '三档区间递进');
assert.equal(NotePlan.WORDS_DEFAULT, 'mid', '没设过给中档');
assert.equal(NotePlan.wordsOf('long').name, '长');
assert.equal(NotePlan.wordsOf('nope'), null, '不认识的档给 null（好让调用方往下退到线／写法建议的那档）');
assert.equal(NotePlan.wordsOf(''), null);
ok('字数档：短/中/长三档 + mid 默认，认不出给 null 以便退到线／写法建议的那档');

/* ── 📐 篇幅配比的归属链：账号默认·写法 → 账号默认·线 → 出厂写法 → 出厂线（🎚 只盖产品段） ── */
const _ns45 = {
  lines: { howto: { shape: { build: 40, core: 40, sell: 20 }, words: 'long' } },
  kinds: { steps: { shape: { build: 10, core: 80, sell: 10 } } },
};
assert.deepEqual(NotePlan.shapeBaseOf('howto', '', null), { build: 10, core: 75, sell: 15 }, '没账号默认＝出厂那条线（干货线别铺垫）');
assert.deepEqual(NotePlan.shapeBaseOf('tale', 'history', null), { build: 40, core: 50, sell: 10 }, '出厂写法盖过出厂那条线（历史文化：典故要讲完整）');
assert.deepEqual(NotePlan.shapeBaseOf('howto', 'steps', null), { build: 10, core: 75, sell: 15 }, '写法自己没配配比＝退回出厂那条线（教程步骤跟干货线）');
assert.deepEqual(NotePlan.shapeBaseOf('howto', 'slice', null), { build: 10, core: 75, sell: 15 }, '写法挂错线＝退回线（slice 是共鸣线的）');
assert.deepEqual(NotePlan.shapeBaseOf('howto', 'steps', _ns45), { build: 10, core: 80, sell: 10 }, '账号默认·写法最优先');
assert.deepEqual(NotePlan.shapeBaseOf('howto', 'pitfall', _ns45), { build: 40, core: 40, sell: 20 }, '写法没被账号改过 → 账号默认·线');
assert.deepEqual(NotePlan.shapeBaseOf('echo', 'slice', _ns45), { build: 20, core: 75, sell: 5 }, '别的线不受这条账号默认影响（生活切片用自己的那份）');
assert.equal(NotePlan.wordsBaseOf('howto', '', _ns45), 'long', '字数同一条链：账号默认·线');
assert.equal(NotePlan.wordsBaseOf('howto', 'steps', _ns45), 'long', '写法只改了配比 → 字数跟着账号那条线');
assert.equal(NotePlan.wordsBaseOf('howto', '', null), 'mid', '没账号默认＝出厂那条线的字数档');
assert.equal(NotePlan.wordsBaseOf('nope', 'nope', null), 'mid', '认不出退到 WORDS_DEFAULT');
// 归一与兜底
assert.deepEqual(NotePlan.normShape({ build: 2, core: 1, sell: 1 }), { build: 50, core: 25, sell: 25 }, '三段按和归一到 100');
assert.equal(NotePlan.normShape({ build: 0, core: 0, sell: 0 }), null, '全 0 当作没配（让调用方退回上一档）');
assert.equal(NotePlan.normShape('nope'), null, '不是对象当作没配');
// 🎚 卖货话术比例盖产品段，剩下的按这条线／写法的 铺垫:展开 重切
const _howtoBase = NotePlan.shapeBaseOf('howto', '', null);
assert.deepEqual(NotePlan.shapeOf(_howtoBase, ''), _howtoBase, '没设话术比例＝用这条线／写法自己的');
const _strong45 = NotePlan.shapeOf(_howtoBase, 'strong');
assert.equal(_strong45.sell, 50, '产品段＝话术比例的百分比');
assert.equal(_strong45.build + _strong45.core + _strong45.sell, 100, '三段永远凑够 100%');
const _none45 = NotePlan.shapeOf(_howtoBase, 'none');
assert.equal(_none45.sell, 0, '不提产品：产品段归 0');
assert.equal(_none45.build + _none45.core, 100, '不提产品：铺垫与展开把整篇分完');
assert.equal(NotePlan.shapeOf('nope', null), null, '认不出的配比给 null');
assert.equal(NotePlan.shapeOf(null, null), null);
// 类型块里的配比与字数按 opts（账号默认 + 这一篇的字数／比例）算
const tsCustom = NotePlan.describeTypeScript('howto', '', { custom: _ns45, words: 'short', talk: 'strong' });
assert.match(tsCustom, /铺垫 ≈ 25%（约 100 字）／ 展开 ≈ 25%（约 100 字）／ 产品 ≈ 50%（约 200 字）/, '配比按账号那条线 × 话术比例算，字数按这一篇的档换算');
assert.match(tsCustom, /本条产品占比已按「主打推荐」调到 50%（这条线默认 20%）/, '比例盖过这条线默认时要明说');
const tsNone45 = NotePlan.describeTypeScript('howto', '', { custom: _ns45, talk: 'none' });
assert.match(tsNone45, /产品 ≈ 0%（不出现）/, '不提产品：配比条上写明不出现');
assert.match(tsNone45, /本条已按「不提产品」设为不出现产品/, '不提产品时要说清节拍里提产品的动作全跳过');
assert.match(NotePlan.shapeTail(0), /不出现产品/);
assert.match(NotePlan.shapeTail(10), /收尾一小段/);
assert.match(NotePlan.shapeTail(25), /中后段/);
assert.match(NotePlan.shapeTail(50), /主角/);
ok('篇幅配比：挂在线与写法上（账号默认可覆盖、四级归属链），🎚 只盖产品段、三段恒等于 100%');

/* ── 阶段诊断跟着五条线：三阶段各一条打法 + 这一阶段主用哪几条线（各几篇，由配比算） ── */
assert.deepEqual(Object.keys(NotePlan.STAGE_PLAY), ['cold', 'grow', 'mature'], '三个阶段各有一条默认打法');
NotePlan.STAGES.forEach(s => {
  const cell = NotePlan.stagePlayOf(s.key);
  assert.ok(cell && String(cell.line || '').length >= 20, `${s.name} 的「这句话怎么说」太短`);
  assert.ok(!('route' in cell) && !('name' in cell), `${s.name} 的打法只剩一句话，不再挂调子`);
});
assert.equal(NotePlan.stagePlayOf('nope'), null, '不认识的阶段给 null');
const coldTop = NotePlan.stageTopLines('cold', null, 12);
assert.equal(coldTop[0].name, '干货线', '冷启动主用干货线（配比表说了算）');
assert.ok(coldTop[0].count >= coldTop[coldTop.length - 1].count, '主用哪几条线要按篇数从多到少排');
assert.equal(coldTop.reduce((a, r) => a + r.count, 0), 12, '这几条线的篇数加起来＝这一阶段排几篇');
assert.equal(NotePlan.stageTopLines('cold', { cold: { howto: 0, tale: 0, echo: 0, meme: 0, hot: 0 } }, 12).length, 0, '权重全 0 就一条线也不排');
const spText = NotePlan.describeStagePlay();
assert.ok(spText.includes('冷启动期') && spText.includes('粉'), '喂 AI 的文本要带阶段名与粉丝门槛');
assert.ok(spText.includes('主用：'), '喂 AI 的阶段文本要带"这一阶段主用哪几条线（各几篇）"');
assert.ok(!/调子/.test(spText), '阶段文本不再提调子');
assert.ok(NotePlan.describeStagePlay({ cold: { hot: 100 } }).split('\n')[0].includes('热点线'), '账号改过的配比要反映到喂 AI 的阶段文本上');
ok('阶段诊断跟着五条线：三阶段各一条打法 + stageTopLines/describeStagePlay 按配比报"主用哪几条线、各几篇"');

/* ── 形态归这一类自己管（四十改 A；四十五改起没有第二方来挡，B 那套判定随调子一起删除） ── */
assert.match(tsHowto, /\*\*怎么讲\*\*/, '第一优先级只覆盖"这篇怎么讲"');
assert.match(NotePlan.describeTypeScript('echo', 'slice'), /\*\*不许一句一段\*\*/, '写法自己的禁形态也写在类型块上（formBan）');
['STYLE_ROUTES', 'routeOf', 'styleCardOf', 'describeNarrative', 'describeRoutes',
 'preferredTypesOf', 'normStyleDetails', 'describeStyle', 'formClashOf', 'suggestRouteFor'].forEach(fn => {
  assert.equal(NotePlan[fn], undefined, `${fn} 已随调子退市，不该还留在导出面上`);
});
// 体检不再带调子参数（形态没有第二方来挡）
const planOneAB = { items: [{ type: 'howto', kind: 'steps', title: 'T', credential: 'c', scope: 'related' }] };
assert.equal(NotePlan.validatePlan(planOneAB).ok, true, '合规排产表通过体检');
assert.ok(NotePlan.validatePlan.length <= 1, 'validatePlan 不再收第二参数（账号调子那一项已删）');
ok('形态只有类型／写法这一处说话的人；调子那套 API 与「调子×类型打架」体检整体退市');

/* ── 📅 栏目表（长期设定：一个栏目＝每周固定一天发的那一类笔记；具体发布＝每周照排一篇） ── */
assert.equal(NotePlan.COLUMN_DAYS.length, 7, '一周七天');
assert.deepEqual(NotePlan.COLUMN_DAYS.map(d => d.name), ['周一', '周二', '周三', '周四', '周五', '周六', '周日']);
assert.equal(NotePlan.columnDayName(3), '周三');
assert.equal(NotePlan.columnDayName('7'), '周日', '字符串也要认');
assert.equal(NotePlan.columnDayName(0), '', '没定日子给空');
assert.equal(NotePlan.columnDayName(8), '', '越界给空');

const colsRaw = [
  { name: '老友测评', day: '4', type: 'review', note: '  每周一款  ', id: 'c1' },
  { day: 1, type: 'nope', name: '不认识的类' },          // 类型认不出＝没配，丢
  { day: 99, type: 'vlog' },                              // 日子越界 → 0；名字缺省用线名
  null, 'x', { type: 'howto', route: '不认识的调子' },      // 脏数据不炸（调子那一栏随四十五改整个不再落）
];
const colsN = NotePlan.normalizeColumns(colsRaw);
assert.equal(colsN.length, 3, '脏数据被清掉，实际 ' + JSON.stringify(colsN));
assert.deepEqual(colsN[0], { id: 'c1', name: '老友测评', day: 4, type: 'howto', note: '每周一款' }, '旧键 review 折成干货线；栏目不再带调子');
assert.equal(colsN[1].day, 0, '日子越界当"日子自定"');
assert.equal(colsN[1].name, '故事线', '名字缺省＝线名（旧键 vlog 折成故事线）');
assert.ok(!('route' in colsN[2]), 'normalizeColumns 不再写 route（调子已退市）');
assert.ok(colsN[2].id && colsN[2].id !== colsN[0].id && colsN[0].id === 'c1', '缺 id 要自动补');
assert.deepEqual(NotePlan.normalizeColumns(null), [], '没配过给空数组');
ok('栏目：normalizeColumns 清脏（类型认不出就丢、日子越界当自定、名字/id 都能补，旧键折新线）');

const colOk = NotePlan.normalizeColumns([{ id: 'a', name: '老友测评', day: 4, type: 'review' }, { id: 'b', name: '随手记', day: 1, type: 'vlog' }]);
assert.deepEqual(NotePlan.columnsProblems(colOk, null), [], '两个栏目不撞车：没问题');
const colClash = NotePlan.normalizeColumns([
  { id: 'a', name: '老友测评', day: 4, type: 'review' },
  { id: 'b', name: '随手记', day: 4, type: 'vlog' },
]);
const clashMsgs = NotePlan.columnsProblems(colClash, null);
assert.equal(clashMsgs.length, 1, clashMsgs.join(' / '));
assert.match(clashMsgs[0], /「老友测评」和「随手记」都排在周四/, clashMsgs[0]);
const colMany = NotePlan.normalizeColumns(NotePlan.COLUMN_DAYS.map((d, i) => ({ id: 'c' + i, name: 'N' + i, day: d.key, type: 'hot' })));
assert.deepEqual(colMany.length, 7, '七个栏目先排满');
colMany.push({ id: 'c8', name: '第八栏', day: 0, type: 'hot' });
assert.ok(NotePlan.columnsProblems(colMany, null).some(m => /一周只有 7 天，栏目却有 8 个/.test(m)), '超过 7 个要提示');
const colShort = NotePlan.columnsProblems(NotePlan.normalizeColumns([{ id: 'a', name: '老友测评', day: 4, type: 'review' }]), bare);
assert.equal(colShort.length, 1, colShort.join(' / '));
assert.match(colShort[0], /栏目「老友测评」是做干货线的/, colShort[0]);
assert.match(colShort[0], /补齐才会排进这一栏/, colShort[0]);
assert.deepEqual(NotePlan.columnsProblems([], bare), [], '没栏目没问题');
ok('栏目：columnsProblems 报撞车 / 超过 7 个 / 栏目那条线缺料，且只提示不拦人');

const colsForText = NotePlan.normalizeColumns([
  { id: 'a', name: '老友测评', day: 4, type: 'review' },
  { id: 'b', name: '随手记', day: 1, type: 'hot' },
]);
const colText = NotePlan.describeColumns(colsForText, null);
assert.match(colText, /【栏目表（长期设定，用户定死的，一个栏目每周正好一篇）】/, colText);
assert.match(colText, /· 周四｜干货线｜栏目名「老友测评」/, colText);
assert.ok(!/调子/.test(colText), '栏目文案不再提调子');
assert.match(colText, /· 周一｜热点线｜栏目名「随手记」/, colText);
assert.equal(NotePlan.describeColumns([], null), '', '没栏目给空（提示词里不带这一段）');
assert.match(NotePlan.describeColumns(colsForText.slice(0, 1), bare), /（⚠ 这一类现在缺料，这次先排不了，别硬排）/, '缺料的栏目要当场标出来');
assert.equal(NotePlan.describeWeek(colsForText), '周一 随手记（热点线） · 周四 老友测评（干货线）', NotePlan.describeWeek(colsForText));
assert.equal(NotePlan.describeWeek(NotePlan.normalizeColumns([{ id: 'a', name: '不定日', day: 0, type: 'vlog' }])), '日子自定 不定日（故事线）');
ok('栏目：describeColumns / describeWeek 文案（给 AI 用 + ⑧ 与发笔记显示同一份口径）');

// 每个栏目每周正好一篇：AI 排漏了就按栏目补——先找"同类型且没认领"的，没有就把没认领的一篇改成这一栏
const planItems = [
  { title: 'A 测评', type: 'review', kind: 'compare', credential: '做这行 8 年' },   // 旧键：该折成干货线
  { title: 'B 教程', type: 'howto', kind: 'steps', credential: '自己踩过坑' },
  { title: 'C 日常', type: 'vlog', kind: '', credential: '随手拍' },                  // 旧键：故事线
];
const placed = NotePlan.applyColumns(planItems, colsForText);
assert.equal(placed.length, 3, '不许凭空多出/少掉篇数');
const byCol = {};
placed.forEach(it => { if (it.col) byCol[it.col] = it; });
assert.equal(Object.keys(byCol).length, 2, '两个栏目各认领一篇：' + JSON.stringify(placed.map(x => x.col)));
assert.equal(byCol['老友测评'].type, 'howto', '同类优先：旧键 review 折成干货线后要对得上栏目');
assert.equal(byCol['老友测评'].title, 'A 测评', '认领的是那篇同类稿，标题不动');
assert.equal(byCol['老友测评'].day, 4);
assert.equal(byCol['老友测评'].colId, 'a');
assert.equal(byCol['老友测评'].kind, 'compare', '没换类：写法留着（compare 折成算账对比）');
assert.equal(byCol['随手记'].type, 'hot', '没有同类型的，就把还没认领的一篇改成栏目那条线');
assert.equal(byCol['随手记'].title, 'B 教程', '改类不改标题（凭据也留着，不许凭空造一篇没凭据的）');
assert.equal(byCol['随手记'].credential, '自己踩过坑');
assert.equal(byCol['随手记'].kind, '', '改类后写法要清掉（它已经换了一条线）');
assert.equal(byCol['随手记'].day, 1);
assert.deepEqual(placed.map(x => x.no), [1, 2, 3], '排完要重编号');
assert.equal(placed[0].col, '随手记', '栏目篇按星期几排在最前面');
assert.equal(placed[1].col, '老友测评');
assert.equal(placed[2].col || '', '', '没进栏目的篇 col 留空');
assert.equal(placed[2].day || 0, 0, '没进栏目的篇 day 留 0');
assert.equal(planItems[0].col, undefined, 'applyColumns 不许改原数组（排产表要能重排）');
assert.equal(planItems[1].type, 'howto', '原数组的 type 也不许被动过');
assert.deepEqual(NotePlan.applyColumns(planItems, []), planItems.map((x, i) => Object.assign({}, x, { type: NotePlan.typeOf(x.type).key, no: i + 1 })), '没栏目＝只重编号（旧键照折新线）');
// 栏目比篇数还多：能认领多少认多少，不凭空补篇
const twoItems = [{ title: 'x', type: 'howto' }, { title: 'y', type: 'tale' }];
const threeCols = NotePlan.normalizeColumns([
  { id: 'a', name: 'A', day: 1, type: 'howto' }, { id: 'b', name: 'B', day: 2, type: 'tale' }, { id: 'c', name: 'C', day: 3, type: 'meme' },
]);
const placed2 = NotePlan.applyColumns(twoItems, threeCols);
assert.equal(placed2.length, 2, '不凭空造篇');
assert.equal(placed2.filter(x => x.col).length, 2, '两个篇位都归栏目');
assert.equal(placed2.filter(x => x.title === 'x')[0].col, 'A');
assert.equal(placed2.filter(x => x.title === 'y')[0].col, 'B');
ok('栏目：applyColumns 保证每个栏目每周 1 篇（同类优先、否则改类留标题凭据），不改原数组');

/* ── 置顶/门面 ── */
assert.equal(NotePlan.PINNED.key, 'pinned');
assert.match(NotePlan.PINNED.note, /不进排产/);
ok('置顶/门面仍在，且明确不进排产');

console.log(`\n✅ _smoke_note_plan.js 全绿：${n} 组断言`);
