/* 📄 发笔记 ④「挑稿页」离线冒烟：node scripts/dev/_smoke_note_write_ui.js
   四十三改后 ④ 不再"挑写法再让 AI 从零写"，而是：挑一条线 → 这条线底下的写法各出一篇 → 点中哪篇带进 ⑤。
   四十五改口径（老板：「怎么只有蹭热点的内容类型可以选了？在这里让我可以切换内容来挑稿啊，
   加一个切换内容类型的按钮，再加一个重新 AI 生成的按钮」）：④ 顶部是显式的
   「🔀 内容类型（五条线）」切换；五十三改后 ④ 顶上那颗「🔁 重新 AI 生成这批」已撤（与底部导航条的
   「🔀 重写这批」重复），切线块也精简成一句白话（不再解析每条线底下的各种写法），🎨 调子退市后
   ④ 只剩 🎚 话术比例与 🖋 字数两个逐条旋钮（📐 配比的家在「发笔记 → 任务配置」那张表）。
   为什么这么测：popup.js 是 classic script，整篇得有 DOM/chrome 才加载得起来；这里把 ④ 那几段纯逻辑
   （底子 → 覆盖 → 这批的条件指纹 → 样稿手机渲染 → 点中一篇）抠出来丢进 vm 跑一遍。
   node --check 只查语法，运行期的事（"换了线但样稿还是别条线的""点中手机却没把正文带进 ⑤"）它查不到。
   ⚠️ grab() 的锚点＝popup.js 里的注释原文（如「/** 一台「手机」样稿」），改那些注释行就要同步改这里。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const NotePlan = require(path.resolve(__dirname, '../../extension/lib/note-plan.js'));
const src = fs.readFileSync(path.resolve(__dirname, '../../extension/popup.js'), 'utf8');
const grab = (from, to) => {
  const i = src.indexOf(from); assert.ok(i >= 0, 'popup.js 里找不到起点：' + from);
  const j = src.indexOf(to, i + from.length); assert.ok(j > i, 'popup.js 里找不到终点：' + to);
  return src.slice(i, j);
};
// 抓的是 ④ 用到的那几段（⑧/后台/其它步骤的依赖用桩代替）
const code = [
  grab('/** 这篇的底子是哪条线', '// 正在写稿时别再点'),                      // npBasePlanItem / npEffPlanItem / npPlanItemPayload / npHotOf / npTopicFactOf
  grab('/* ═══ 📐 内容基调（四十五改', '/** ④ 底部那一行摘要'),              // npTalk/npWords/线×写法 + npLinePickHtml + 三个旋钮的本体
  grab('/** ④ 底部那一行摘要', '/** 这批样稿的条件指纹'),                    // npStyleSummaryHtml / npStyleKnobsHtml
  grab('/** 这批样稿的条件指纹', '/** 一台「手机」样稿'),                     // npVarKeyOf / npVarSigOf / _npVariantsInvalidate / npVariantsLoad
  grab('/** 一台「手机」样稿', '/** 点中一篇样稿'),                           // npPhoneBarHtml / npVarCardHtml / npPickStepHtml
  grab('/** 点中一篇样稿', '/** 重写这批'),                                  // npVarPick
  grab('/** 重写这批', '// 成稿页顶部那一行'),                                // npVarAgain
].join('\n');

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ctx = {
  NotePlan, console, esc, escAttr: esc,
  _npWiz: null, _npNote: null, _npActiveContainer: null,
  // 🔥 找由头那条路要真打 AI（④ 点热点线时才走），这支冒烟里的用例都点不到它——摆个空档，别让它炸在没测到的分支上
  npHotFind: async () => {},
  npPid: (w) => String((w && w.platform) || 'xhs'),
  npSellPointStr: () => String((ctx._npWiz && ctx._npWiz.spStr) || ''),
  npKbKeyOf: (l) => (l || []).map(x => (x && (x.id || x.__i)) || '').join(','),
  Platforms: { baseOf: () => 'note' },
  npWizRender: () => {}, npArchiveSave: () => {}, npPlanMarkDone: () => {},
  npWaitInto: () => () => {}, _npEl: () => null,
  readConfigPlain: async () => ({ noteStyle: null }),
  chrome: { runtime: { sendMessage: async () => { throw new Error('不该在这支冒烟里真打 AI'); } }, storage: { local: { get: async () => ({}), set: async () => {} } } },
};
vm.createContext(ctx);
vm.runInContext(code, ctx, { filename: 'popup-pick-ui.js' });

// 顶层 let 声明不挂在沙箱对象上（那是 vm 的全局词法作用域），要读数只能在同一上下文里求值
const peek = (expr) => vm.runInContext(expr, ctx);

let n = 0;
const ok = (name) => { n++; console.log('  PASS ' + name); };
const set = (over) => {
  ctx._npWiz = Object.assign({ topics: [], chosenTopicIdx: -1, chosenKb: [], chosenPeople: [] }, over || {});
  return ctx._npWiz;
};
// vm 里造出来的对象是另一个 realm 的，deepStrictEqual 会嫌原型不同——比 JSON 就够了
const eq = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);
const HOWTO_K = NotePlan.kindsOfType('howto').length;

/* 1) 底子：③ 里 AI 按题判的线 × 写法 */
set({ topics: [{ topic: 'T', type: 'howto', kind: 'steps' }], chosenTopicIdx: 0 });
eq(ctx.npWritePickNow(ctx._npWiz), { type: 'howto', kind: 'steps' });
let eff = ctx.npEffPlanItem(ctx._npWiz);
assert.strictEqual(eff.type, 'howto');
assert.strictEqual(eff.kind, 'steps');
assert.strictEqual(eff.fromTopic, true);
assert.strictEqual(ctx.npWritePick(ctx._npWiz), null, '没改过就没有覆盖');
ok('底子取 ③ 里 AI 判的线 × 写法');

/* 2) 老板要的那个「切换内容类型」：五条线全部是显式可点的按钮，写法只读列出 */
let h = ctx.npLinePickHtml();
assert.ok(/🔀 内容类型（五条线）/.test(h), '④ 顶部要有明写的「切换内容类型」标题：' + h.slice(0, 200));
assert.strictEqual((h.match(/data-type="/g) || []).length, NotePlan.TYPES.length, '五条线各一个按钮（不是只有某一条能选）');
NotePlan.TYPES.forEach(t => assert.ok(new RegExp('data-type="' + t.key + '"').test(h), '线 ' + t.key + ' 的切换按钮不见了'));
assert.ok(/class="npWriteType"/.test(h) && (h.match(/class="npWriteType"/g) || []).length === 5, '五个都是 npWriteType 按钮');
assert.ok(!/data-kind="/.test(h), '④ 不再手挑写法（写法由样稿手机来定）');
assert.ok(/点一条就换/.test(h), '切换块只留一句白话：' + h.slice(-260));
assert.ok(!/种写法（/.test(h) && !/当前：/.test(h), '五十三改：这块不再解析每条线底下的各种写法、也不报「当前出几篇」');
assert.ok(!/📐/.test(h) && !/🖋/.test(h), '配比与字数收在「🎚 这一条」那一行，不在切线块里重复一遍');
assert.match(ctx.npStyleSummaryHtml(), /配比 \d+\/\d+\/\d+/, '这一条按哪份配比写还是要看得见（在摘要行里）');
assert.ok(!/这条换过/.test(h) && !/本篇借的由头/.test(h), '没改过 / 不是热点线时那两句不该出现');
assert.ok(!/调子/.test(h) && !/route/.test(h), '调子已退市：④ 的切线块里不该再有调子口径');
ok('④ 控件：五条线都能一键切（写法由样稿手机来定），块里不铺写法说明与配比字数');

/* 3) 换线＝这批样稿作废（在途那一发也按代次丢掉），控件标「这条换过」+ 回默认 */
set({ topics: [{ topic: 'T', type: 'howto', kind: 'steps' }], chosenTopicIdx: 0,
  variants: [{ kind: 'steps', title: 'A', content: 'x' }], picked: 0, variantsKey: 'old' });
const _gen0 = peek('_npVariantsGen');
ctx.npWriteApply('tale', 'history');
eq(ctx._npWiz.write, { type: 'tale', kind: 'history' });
assert.strictEqual(ctx._npWiz.variants, null, '换线＝上一批是别条线的写法，当场作废');
assert.strictEqual(ctx._npWiz.picked, null, '挑中的那篇也跟着清');
assert.strictEqual(ctx._npWiz.variantsKey, 'old', '指纹留着：重出时才刷新');
assert.strictEqual(peek('_npVariantsGen'), _gen0 + 1, '代次加一：换线时还在路上的那一发回来也不许落稿');
eff = ctx.npEffPlanItem(ctx._npWiz);
assert.strictEqual(eff.type, 'tale');
assert.strictEqual(eff.kind, 'history');
assert.strictEqual(eff.fromTopic, true, '换线不改变"这题是 AI 判的"这个来路');
h = ctx.npLinePickHtml();
assert.ok(/这条换过/.test(h) && /回默认「干货线 · 教程步骤」/.test(h), h);
assert.ok(/● 故事线/.test(h), '换过之后当前那条线要标成选中态（● 故事线）');
ok('换线 → 覆盖生效 + 上一批作废 + 在途请求按代次作废；控件标「这条换过」并给回默认');

/* 4) 拨回与底子一致＝不算换过；回默认也清批次 */
ctx.npWriteApply('howto', 'steps');
assert.strictEqual(ctx._npWiz.write, null, '与底子一致时覆盖清空，回到跟排产/话题走');
ctx._npWiz.write = { type: 'tale', kind: 'history' };
ctx._npWiz.variants = [{ kind: 'history', content: 'x' }];
ctx.npWriteRestore();
assert.strictEqual(ctx._npWiz.write, null);
assert.strictEqual(ctx._npWiz.variants, null, '回默认＝这批也作废');
ok('拨回默认组合 → 覆盖清空；回默认连带清掉这批');

/* 5) 空态：没定线 → 先挑线；定了线 → 页上写明「点下面『🔀 重写这批』各出一篇」（出稿入口在底部导航条，body 里不再自带那颗） */
set({});
h = ctx.npPickStepHtml();
assert.ok(/先在上面的「🔀 内容类型」里挑一条线/.test(h), h);
assert.ok(!/id="npVarStatus"/.test(h), '没定线时不摆出稿状态位');
set({ topics: [{ topic: 'T', type: 'howto', kind: 'steps' }], chosenTopicIdx: 0 });
h = ctx.npPickStepHtml();
assert.ok(/id="npVarStatus"/.test(h), h);
assert.ok(new RegExp('「干货线」底下 ' + HOWTO_K + ' 种写法，点下面「🔀 重写这批」就各出一篇给你挑').test(h), '空态要指明重烧入口在哪：' + h);
assert.ok(!/npVarGen/.test(h) && !/重新 AI 生成这批/.test(h), '五十三改：④ 顶上那颗「🔁 重新 AI 生成这批」与底部「🔀 重写这批」重复，已撤上面那颗');
ok('④ 空态：没定线先挑线；定了线指着底部那颗「🔀 重写这批」出稿（body 里不再自带出稿按钮）');

/* 6) 出稿后一台手机一种写法（并排摆着挑，重烧只在底部导航条那颗）；点中就把那篇带进 ⑤ 当底稿 */
const w = set({ topics: [{ topic: 'T', type: 'howto', kind: 'steps' }], chosenTopicIdx: 0 });
w.variants = NotePlan.kindsOfType('howto').map((k, i) => ({
  kind: k.key, kindName: k.name, title: '标题' + i, content: '正文' + i + '\n第二段', tags: ['t' + i],
}));
w.variantsKey = ctx.npVarKeyOf(w);
h = ctx.npPickStepHtml();
assert.strictEqual((h.match(/npVarPick/g) || []).length, HOWTO_K, '每种写法一台手机');
assert.ok(/<div class="npPhoneRow">/.test(h), '这批样稿要并排摆成一行（手机排）');
assert.strictEqual((h.match(/class="npPhone"/g) || []).length, HOWTO_K, '一种写法一台手机');
assert.ok(/正文0/.test(h) && /第二段/.test(h), '手机屏里能读正文（不是只给标题）');
assert.ok(/<span>9:41<\/span>/.test(h), '手机顶上要有那条细状态栏');
assert.ok(!/🔁 重新 AI 生成这批/.test(h) && !/npVarGen/.test(h), '已有这批时也不回来那颗（与底部「🔀 重写这批」重复）');
ctx.npVarPick(1, null);
assert.strictEqual(w.picked, 1);
eq(w.write, { type: 'howto', kind: NotePlan.kindsOfType('howto')[1].key }, '点中第 2 篇＝这条定成那一种写法');
assert.strictEqual(w.draft.content, '正文1\n第二段');
eq(w.draft.titles, ['标题1']);
eq(w.draft.tags, ['t1']);
assert.strictEqual(w.draft.fromVar, true, '标出来：这篇是挑的，不是现写的');
assert.strictEqual(w.step, 4, '挑中直接进 ⑤');
assert.strictEqual(ctx._npNote.draft, w.draft, '⑤ 那页读的就是这篇');
assert.strictEqual(peek('_npStyleState.dirty'), false, '这篇就是按当前这套写出来的，不该催着重生成');
ok('点中一篇 → 定「线 × 写法」+ 正文当 ⑤ 底稿 + 跳 ⑤');

/* 6b) 🕳 缺料的那种（四十六改）：AI 回 skipped 时手机上标出来、不给「就用这篇」；点了也带不进 ⑤ */
const w6b = set({ topics: [{ topic: 'T', type: 'tale', kind: 'history' }], chosenTopicIdx: 0 });
w6b.variants = [
  { kind: 'history', kindName: '历史文化', title: '', content: '', skipped: '老手艺的来路', tags: [] },
  { kind: 'scene', kindName: '经营现场', title: '标题', content: '正文', tags: [] },
];
h = ctx.npPickStepHtml();
assert.ok(/🕳 缺料 · 补一条素材再来/.test(h), h);
assert.ok(/老手艺的来路/.test(h), '缺料的手机要说清缺什么：' + h);
assert.strictEqual((h.match(/class="npPhone"/g) || []).length, 2, '缺料那格也占一台手机（虚线空屏），不补空位也不让位');
assert.strictEqual((h.match(/npVarPick/g) || []).length, 1, '缺料的那种不给「就用这篇」');
assert.ok(!/这批里有/.test(h), '缺料不算"没写出来"，不该报成批次失败');
ctx.npVarPick(0, null);
assert.ok(!w6b.picked && !w6b.draft, '缺料那张点了也不该带进 ⑤（没有正文）');
ok('🕳 缺料降级：手机上标出来、不给「就用这篇」，点了也带不进 ⑤');

/* 7) 挑的就是底子那一种写法时，不算"改过"（回默认按钮别乱出现） */
const w2 = set({ planItem: { no: 1, title: '试营业那周', type: 'howto', kind: 'steps', credential: '做茶 8 年' } });
w2.variants = [{ kind: 'steps', kindName: '教程步骤', title: 'T', content: 'C', tags: [] }];
ctx.npVarPick(0, null);
assert.strictEqual(w2.write, null, '底子本来就是这篇 → 不记成覆盖');
assert.strictEqual(w2.draft.content, 'C');
ok('挑中"规划里那篇自带那种写法"→ 不算改过');

/* 8) 这批的条件指纹（换线/换题/换人群/换素材/换平台/换热点＝得重出）与写法无关 */
const base = set({ topics: [{ topic: 'T', type: 'howto', kind: 'steps' }], chosenTopicIdx: 0, spStr: '卖点A', platform: 'xhs' });
const k0 = ctx.npVarKeyOf(base);
assert.ok(/howto/.test(k0) && /T/.test(k0) && /卖点A/.test(k0), k0);
base.spStr = '卖点B';
assert.notStrictEqual(ctx.npVarKeyOf(base), k0, '换卖点要重出');
base.spStr = '卖点A';
base.platform = 'douyin';
assert.notStrictEqual(ctx.npVarKeyOf(base), k0, '换平台要重出（各平台成稿规则不同）');
base.platform = 'xhs';
base.chosenPeople = [{ name: '人群甲' }];
assert.notStrictEqual(ctx.npVarKeyOf(base), k0, '换人群要重出');
base.chosenPeople = [];
base.chosenKb = [{ id: 'kb1' }];
assert.notStrictEqual(ctx.npVarKeyOf(base), k0, '换素材要重出');
base.chosenKb = [];
// 🔥 由头只在「这一篇走的线是热点线」时进指纹（话题是话题、由头是由头——2026-09-30 改口径）
base.hotHook = { name: '由头A', angle: 'a' };
assert.strictEqual(ctx.npVarKeyOf(base), k0, '不是热点线：手上那条由头不该进指纹');
base.topics[0].type = 'hot';
assert.notStrictEqual(ctx.npVarKeyOf(base), k0, '这一篇走热点线了 → 指纹要带上那条由头');
const kHotA = ctx.npVarKeyOf(base);
base.hotHook = { name: '由头B', angle: 'b' };
assert.notStrictEqual(ctx.npVarKeyOf(base), kHotA, '换一条由头要重出（这批稿子的引子换了）');
base.hotHook = null;
base.topics[0].type = 'tale';
assert.ok(ctx.npVarKeyOf(base).indexOf('howto') < 0 && /tale/.test(ctx.npVarKeyOf(base)), '换线当然要重出');
base.topics[0].type = 'howto';
base.topics[0].fact = '一句真事';
assert.notStrictEqual(ctx.npVarKeyOf(base), k0, '四十六改：③ 那句真事换了也要重出');
base.topics[0].fact = '';
assert.strictEqual(ctx.npVarKeyOf(base), k0, '真事拨回去＝指纹回原样');
// 排产表那篇自带题面（"按这条写"），③ 那句真事跟它没关系，不进指纹
base.planItem = { no: 1, title: '排产那篇', type: 'howto', kind: 'steps' };
const kPlan = ctx.npVarKeyOf(base);
base.topics[0].fact = '一句真事';
assert.strictEqual(ctx.npVarKeyOf(base), kPlan, '排产表那篇不用③ 那句真事');
base.planItem = null; base.topics[0].fact = '';
ok('npVarKeyOf：线/选题/真事/卖点/人群/素材/平台/热点线那条由头 任一变了都要重出');

/* 9) 📐 配比·🎚 比例·🖋 字数不进条件指纹——变了只在页上提示重出，不自动再烧一发 */
const w3 = set({ topics: [{ topic: 'T', type: 'howto', kind: 'steps' }], chosenTopicIdx: 0,
  noteStyle: { sellTalk: 'light', words: 'mid' }, styleDefault: {} });
const sig0 = ctx.npVarSigOf(w3);
assert.ok(/配比 \d+\/\d+\/\d+/.test(sig0) && /话术 轻带一句/.test(sig0) && /字数 mid/.test(sig0), sig0);
assert.ok(ctx.npVarKeyOf(w3).indexOf('mid') < 0, '字数不该混进条件指纹');
w3.variants = [{ kind: 'steps', kindName: '教程步骤', title: 'T', content: 'C', tags: [] }];
w3.variantsKey = ctx.npVarKeyOf(w3);
w3.variantsSig = sig0;
assert.ok(!/这批还是按「/.test(ctx.npPickStepHtml()), '刚出的一批不该提示');
w3.noteStyle = { sellTalk: 'strong', words: 'long' };
assert.notStrictEqual(ctx.npVarSigOf(w3), sig0, '这条的话术比例/字数变了 → 指纹变');
h = ctx.npPickStepHtml();
assert.ok(/这批还是按「/.test(h), h);
assert.ok(/点下面的「🔀 重写这批」/.test(h), '过期提示要指着底部那颗「🔀 重写这批」说');
// ⑧ 改了这条线的账号默认配比（这一条自己没动）也算过期
const w3b = set({ topics: [{ topic: 'T', type: 'howto', kind: 'steps' }], chosenTopicIdx: 0, noteStyle: {},
  styleDefault: { lines: { howto: { shape: { build: 40, core: 40, sell: 20 } } } } });
assert.notStrictEqual(ctx.npVarSigOf(w3b), sig0, '⑧ 里改了这条线的配比 → 这批也标过期');
ok('npVarSigOf：配比/比例/字数只提示"重出这批"，不自动再烧一发');

/* 10) 失败态把错误显示出来（重出入口常驻）；热点线那张「本篇借的由头」卡（找/找到/失败三态）；旧键与排产项底子照样认 */
const w4 = set({ topics: [{ topic: 'T', type: 'howto', kind: 'steps' }], chosenTopicIdx: 0, variantsError: 'AI 没按这条线的写法出稿' });
h = ctx.npPickStepHtml();
assert.ok(/AI 没按这条线的写法出稿/.test(h), h);
assert.ok(/❌/.test(h) && !/重新 AI 生成这批/.test(h), '失败只把原因摆出来；重出入口＝底部导航条那颗「🔀 重写这批」，body 里不回来那颗已撤的按钮');
set({ topics: [{ topic: '热点A', type: 'hot', kind: 'hotFit' }], chosenTopicIdx: 0 });
assert.ok(/🔥 热点线要借一条这周的公开由头/.test(ctx.npLinePickHtml()), '热点线还没由头：要说清它去找的是什么');
ctx._npWiz.hotHook = { name: '换季忙', line: '这几天大家都在说换季', why: '人群正处在这个处境', angle: '从时间怎么分配切进来，落到产品上' };
h = ctx.npLinePickHtml();
assert.ok(/本篇借的由头：换季忙/.test(h) && /这篇的基调：<\/b>从时间怎么分配切进来/.test(h), h);
assert.ok(/不是实时热搜/.test(h), '要写明这条由头来自 AI 的知识、不是实时热搜');
assert.ok(/npHotSwap/.test(h) && /npHotSelfAdd/.test(h), '给「换一条」与「自己贴一条」两个出口');
ctx._npWiz.hotBusy = true;
assert.ok(/正在去找这周能借的由头/.test(ctx.npLinePickHtml()), '找的期间要摆进度');
ctx._npWiz.hotBusy = false;
ctx._npWiz.hotErr = '后台未返回结果，请重试';
assert.ok(/后台未返回结果/.test(ctx.npLinePickHtml()) && /npHotAgain/.test(ctx.npLinePickHtml()), '失败要把原因摆出来 + 给重试入口');
set({ topics: [{ topic: 'T', type: 'review', kind: 'compare' }], chosenTopicIdx: 0 });
eq(ctx.npWritePickNow(ctx._npWiz), { type: 'howto', kind: 'calc' }, 'review/compare 老键 → 干货线 · 算账对比');
set({ planItem: { no: 3, title: '试营业那周', type: 'culture', kind: 'history', credential: '做茶 8 年' } });
assert.strictEqual(ctx.npEffPlanItem(ctx._npWiz).type, 'tale', '老排产表里的 culture 键要认得（翻成故事线）');
assert.ok(/● 故事线/.test(ctx.npLinePickHtml()), '老 culture 键翻成故事线后，切换块把故事线画成当前那颗');
ok('失败态：错误显示（重烧走底部「🔀 重写这批」）；热点线的由头卡（找/找到/失败三态 + 换一条 + 自己贴）；旧键（review/culture）照样认');

/* 11) 「就改这一条」＝🎚 比例 + 🖋 字数 两个旋钮（📐 配比只读预览，家在「发笔记 → 任务配置」那张表） */
const w5 = set({ topics: [{ topic: 'T', type: 'howto', kind: 'steps' }], chosenTopicIdx: 0,
  noteStyle: {}, styleDefault: { sellTalk: 'light' } });
h = ctx.npStyleSummaryHtml();
assert.ok(/🎚 这一条/.test(h) && /配比 \d+\/\d+\/\d+ · 卖货话术 轻带一句 · 字数 \d+-\d+ 字/.test(h), h);
assert.ok(/发笔记 → 任务配置/.test(h), '摘要要指回那张五条线表（发笔记 → 任务配置）');
assert.ok(!/npStyleTalk/.test(h) && !/npStyleWords/.test(h), '折起时不铺旋钮');
assert.ok(!/回到跟账号默认/.test(h), '没改过就不给"回默认"');
assert.ok(/就改这一条 ▾/.test(h), '折起时那个按钮就是"就改这一条"的入口');
w5.styleOpen = true;
h = ctx.npStyleSummaryHtml();
assert.ok(/📐 篇幅配比/.test(h) && /🎚 卖货话术的比例/.test(h) && /🖋 字数/.test(h), '展开＝配比预览 + 两个旋钮');
assert.ok(/收起/.test(h) && /账号默认/.test(h), h);
w5.noteStyle = { sellTalk: 'strong' };
h = ctx.npStyleSummaryHtml();
assert.ok(/这条改过/.test(h), '这条改过要标出来');
assert.ok(/↺ 这两个回到跟账号默认/.test(h), '改过就给一键回默认');
assert.ok(!/🎨/.test(ctx.npStyleSummaryHtml()) && !/调子/.test(ctx.npStyleSummaryHtml()), '调子已退市：④ 摘要里不该再有');
ok('④ 摘要：一行 + 按需展开两个旋钮（🎚/🖋），📐 配比只读并指回「发笔记 → 任务配置」');

/* 12) 旋钮只动这一条，不写账号默认；改过就标"这条改过了" */
const w6 = set({ topics: [{ topic: 'T', type: 'howto', kind: 'steps' }], chosenTopicIdx: 0, draft: { content: 'x' },
  noteStyle: {}, styleDefault: { sellTalk: 'light' } });
ctx.npStyleSetTalk('strong');
eq(w6.noteStyle, { sellTalk: 'strong' }, '只记这一条的话术比例');
assert.strictEqual(w6.styleDefault.sellTalk, 'light', '账号默认不被这一条带跑');
assert.strictEqual(peek('_npStyleState.dirty'), true, '已有成稿时改口径 → 提示要重新生成');
ctx.npStyleSetWords('short');
eq(w6.noteStyle, { sellTalk: 'strong', words: 'short' });
ctx.npStyleClearLocal();
eq(w6.noteStyle, {}, '一键回默认＝这条的两个旋钮清空');
assert.strictEqual(w6.styleTouched, false);
ok('④ 的旋钮只改这一条（🎚/🖋），账号默认不动；清空即回跟账号默认');

/* 13) 改线/回默认会把"这条改过了"标上（有成稿时）；点「重新生成」先作废再重出 */
set({ topics: [{ topic: 'T', type: 'howto', kind: 'steps' }], chosenTopicIdx: 0, draft: { content: 'x' } });
ctx.npWriteApply('tale', 'history');
assert.strictEqual(peek('_npStyleState.dirty'), true, '已有成稿时改线 → 提示要重新生成');
ctx.npWriteRestore();
assert.strictEqual(ctx._npWiz.write, null);
assert.strictEqual(peek('_npStyleState.dirty'), true);
ctx.npWriteRestore();
assert.strictEqual(ctx._npWiz.write, null, '没得回默认时也不炸');
const w7 = set({ step: 4, variants: [{ kind: 'steps', content: 'x' }], variantsError: 'e', picked: 2 });
const _gen1 = peek('_npVariantsGen');
ctx.npVarAgain(null);
assert.strictEqual(w7.variants, null, '点「重新生成」先把上一批清掉');
assert.strictEqual(w7.variantsError, '', '错误也一起清');
assert.strictEqual(peek('_npVariantsGen'), _gen1 + 1, '代次加一：在途的那一发回来也不作数');
assert.strictEqual(peek('_npVariantsBusy'), false, '重出前把闸门放回（不点这一批不该还占着）');
ok('改线 / 回默认都标"这条改过了"；npVarAgain 作废在途与旧批次后重出');

console.log('\n✅ _smoke_note_write_ui.js 全绿：' + n + ' 组');
