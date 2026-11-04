// 获客「6 玩法」自检（2026-11-02 二改：同行/竞对并进同城本业）
// 覆盖：玩法顺序与默认排班 / v6→v9、v8→v9 迁移 / 每天轮着挑词 / 同词两玩法各跑一趟 /
//       提店口径三档 / AI 出词按玩法分流 / 评论 {store_rule} 与私信两个占位符能替换 /
//       大V 不出词只盯号 / 执行器与后台都按玩法取口径 / 招生帖只收人不留言 /
//       玩法话术（pbTalk）归一化、过期判定、接进评论与私信 / 四份副本一致、与主本只差已登记的未上线段 /
//       「回评论区那句」跟「笔记下面那句」共用同一段评论策略（提店口径＋排班行话术）。
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = p => fs.readFileSync(ROOT + p, 'utf8');
const md5 = p => crypto.createHash('md5').update(fs.readFileSync(ROOT + p)).digest('hex');

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('✗ ' + msg); } else console.log('✓ ' + msg); };

/* ── 1. 把 web 那份 scenario-drain.js 丢进 vm 里跑（跟真代码同一份） ── */
const src = read('web/lib/scenario-drain.js');
const store = {};
const chrome = {
  storage: {
    local: {
      get: async (k) => {
        if (typeof k === 'string') return { [k]: store[k] };
        return Object.assign({}, store);
      },
      set: async (o) => { Object.assign(store, o); },
    },
    onChanged: { addListener: () => {} },
  },
  runtime: { sendMessage: async () => ({ ok: true }) },
};
const ctx = { chrome, console, Date, Math, JSON, Object, Array, String, Number, Set, Map, Promise, setTimeout, encodeURIComponent };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: 'scenario-drain.js' });
const g = (n) => vm.runInContext(n, ctx);

/* ── 2. 玩法清单与默认排班 ── */
const order = g('DRAIN_PB_ORDER');
ok(order.join(',') === 'highv,top,pain,latest,local,cross', '六个玩法顺序固定：' + order.join(','));
ok(g('DRAIN_PB_WORD').join(',') === 'top,pain,latest,local,cross', '走词的是五个玩法（大V 只盯号）');
ok(g('DRAIN_TYPE_META').every(m => m.scenario !== 'rival'), '词池表头不再有「同行」列');
ok(['latest', 'top', 'local', 'pain', 'cross', 'highv'].every(s => g('DRAIN_PLAYBOOK.' + s + '.send') === 'both' && g('DRAIN_PLAYBOOK.' + s + '.find') === 'commenters'), '六个玩法全部：既评笔记，也回评论区');
ok(g('DRAIN_PLAYBOOK.rival.send') === 'none', '内部旧名 rival 仍保留（老任务只蹲人）');
const def = g('DRAIN_PB_DEFAULT');
ok(def.latest.perDay === 3 && def.latest.store === 'none', '本地泛搜默认每天 3 个词、不提店');
ok(def.cross.perDay === 2, '同城异业默认每天 2 个词');
ok(['top', 'local', 'pain', 'cross'].every(s => def[s].store === 'identity'), 'TOP/同城本业/咨询帖/异业默认只提身份');

/* ── 3. 老数据迁移 v6 → v9 ── */
const old = {
  v: 6,
  city: '杭州',
  keywords: [
    { k: '杭州 周末带娃', on: true, types: { latest: true, top: true }, days: [1, 3] },
    { k: '少儿美术', on: true, types: { top: true }, days: [2] },
  ],
};
ctx.__old = old;
const cfg = g('_drainNormalizeScanCfg(__old)');
ok(cfg.v === 9, 'v 升到 9');
ok(cfg.keywords[0].types.cross === false && !('rival' in cfg.keywords[0].types), '老词不自动挂异业；同行列已并掉');
ok(cfg.pbPlan.latest.days.join(',') === '1,2,3', '本地泛搜周几按老词归并 = 1,2,3');
ok(cfg.pbPlan.top.days.join(',') === '1,2,3', 'TOP 周几按老词归并 = 1,2,3');

/* ── 3.5 v8 → v9：同行并进同城本业，不丢配置 ── */
ctx.__old8 = {
  v: 8, city: '杭州',
  keywords: [
    { k: '杭州 少儿美术', on: true, types: { latest: true, rival: true } },
    { k: '杭州 儿童体能馆', on: true, types: { rival: true } },
  ],
  pbPlan: { local: { days: [1, 3], perDay: 3, store: 'identity' }, rival: { days: [6], perDay: 5, store: 'none' } },
  pbTalk: { rival: { steps: { who: '竞对家长', open: 'o', lead: 'l', deliver: 'd' }, sample: { q: 'q', a: 'a' }, persona: 'p', storeAt: 'none', at: 1 } },
};
const m8 = g('_drainNormalizeScanCfg(__old8)');
ok(m8.v === 9, 'v8 → v9');
ok(m8.pbPlan.local.days.join(',') === '1,3,6', '同行周几并进本业（取并集）');
ok(m8.pbPlan.local.perDay === 5, '每天挑几个取两边多的');
ok(!m8.pbPlan.rival && !m8.pbTalk.rival, '同行那行和话术键已并掉');
ok(m8.keywords.every(e => !e.types.rival), '词上不再挂同行列');
ok(m8.keywords[1].types.local === true, '只勾同行的词改勾同城本业');
ok(!!m8.pbTalk.local && /哪家好/.test(m8.pbTalk.local.text) && !/竞对家长/.test(m8.pbTalk.local.text), '老同行话术不再搬进来（第一次读到就用默认短话铺满）');
ctx.__old8b = {
  v: 8, keywords: [],
  pbPlan: { rival: { days: [6], perDay: 2 } },
  pbTalk: { local: { steps: { who: '本业' } }, rival: { steps: { who: '同行' } } },
};
const m8b = g('_drainNormalizeScanCfg(__old8b)');
ok(/哪家好/.test(m8b.pbTalk.local.text) && !/本业/.test(m8b.pbTalk.local.text), '本业老话术也被默认短话覆盖（没铺过＝用默认）');
ok(m8b.pbPlan.local.days.indexOf(6) >= 0, '没写本业排班时也接住同行那一天');

/* ── 4. 每天轮着挑词 ── */
ctx.__kws = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map(k => ({ k, on: true, types: { latest: true } }));
ctx.__cfg4 = g('_drainNormalizeScanCfg')({ v: 7, keywords: ctx.__kws, pbPlan: { latest: { days: [1, 4], perDay: 2 } } });
const mon = new Date(2026, 10, 2, 10, 0, 0).getTime();   // 2026-11-02 周一
const thu = new Date(2026, 10, 5, 10, 0, 0).getTime();   // 周四
ctx.__mon = mon; ctx.__thu = thu;
const wMon = g('drainPbWordsFor(__cfg4, "latest", __mon)');
const wThu = g('drainPbWordsFor(__cfg4, "latest", __thu)');
ok(wMon.length === 2 && wThu.length === 2, 'perDay=2 每次挑两个');
ok(wMon.join(',') !== wThu.join(','), '第二次跑换一批词：' + wMon + ' → ' + wThu);

/* ── 5. 同词挂两个玩法：各进队列一次 ── */
ctx.__cfg5 = g('_drainNormalizeScanCfg')({
  v: 7, city: '杭州',
  keywords: [{ k: '杭州 少儿美术', on: true, types: { latest: true, local: true } }],
  pbPlan: { latest: { days: [1], perDay: 3 }, local: { days: [1], perDay: 3 } },
});
const plan = g('drainQueuePlan(__cfg5, {}, __mon, null)');
ok(plan.todo.map(x => x.scenario).sort().join(',') === 'latest,local', '同词两玩法各排一项');
ok(plan.todo.every(x => x.scenario !== 'local' || ((x.k.match(/杭州/g) || []).length === 1)), '同城本业的词自带城市、不再补一遍');

/* ── 6. 提店口径三档 ── */
ok(/一个字都不提/.test(g('drainStoreRule("none")')), '不提＝一个字都不提');
ok(/我是做这行的/.test(g('drainStoreRule("identity")')), '只提身份＝说自己是做这行的');
ok(/对方明确问起/.test(g('drainStoreRule("store")')), '可报店名＝对方问起才报');

/* ── 7. AI 找词按玩法分流 ── */
['latest', 'top', 'local', 'pain', 'cross'].forEach(s => {
  ok(String(g(`drainAiKeywordRule(${JSON.stringify(s)}, "杭州")`)).length > 10, 'AI 出词规则存在：' + s);
});
ok(/杭州/.test(g('drainAiKeywordRule("local", "杭州")')), '同城本业的出词规则带城市');
ok(/儿童体能馆/.test(g('drainAiKeywordRule("local", "杭州")')), '本业也能出本地同品类通用叫法（找同行笔记下的人）');
ok(/绝不出本行品类词/.test(g('drainAiKeywordRule("cross", "杭州")')), '异业规则排除本行词');

/* ── 8. 评论与私信提示词占位符 ── */
ctx.__payload = { title: 't', content: 'c', author: 'a', city: '杭州', persona_block: 'p', storeRule: g('drainStoreRule("none")') };
ok(g('SCENARIO_DRAIN').every(s => /\{store_rule\}/.test(s.system)), '每套评论提示词都带 {store_rule}');
const filled = g('_fillSentiment(SCENARIO_DRAIN[0].system, __payload)');
ok(!/\{store_rule\}/.test(filled) && /一个字都不提/.test(filled), '评论 {store_rule} 会被替换成口径句');
ok(/只回复两个字：跳过/.test(g('SCENARIO_DRAIN').find(s => s.scenario === 'local').system), '同城本业的提示词会判同行/机构招生帖');

/* 招生帖：固定词先挡；普通家长帖不误挡 */
ok(g('drainLooksSolicit({ noteTitle: "春季招生开始啦", noteContent: "" })') === true, '招生帖固定词能挡住');
ok(g('drainLooksSolicit({ noteTitle: "周末带娃去哪", noteContent: "求推荐" })') === false, '普通家长帖不误挡');
ok(/drainLooksSolicit\(data\)/.test(src), '评论生成前会先过固定词这道闸');

const dp = read('web/lib/default-prompts.js');
ok(/\{playbook_rule\}/.test(dp) && /\{store_rule\}/.test(dp), '私信提示词带 {playbook_rule} 与 {store_rule}');
['executor/exec-core.js', 'server/bg/background.js'].forEach(f => {
  const s = read(f);
  ok(/drainPlaybookDmRule\s*\(/.test(s) && /drainStoreRule\s*\(/.test(s), f + '：生成私信时按玩法口径');
  ok(/playbook/.test(s) && /drainAiKeywordRule/.test(s), f + '：AI 找词按玩法出词');
});

/* ── 9. 大V：不出词，只按排班盯号 ── */
ctx.__cfg9 = g('_drainNormalizeScanCfg')({
  v: 7, keywords: [], accounts: [{ k: 'https://www.xiaohongshu.com/user/profile/abc', name: '大V', scenario: 'highv' }],
  pbPlan: { highv: { days: [1], perDay: 1 } },
});
ok(g('drainPbWordsFor(__cfg9, "highv", __mon)').length === 0, '大V 不出词');
ok(g('drainQueuePlan(__cfg9, {}, __mon, null)').todo.some(x => x.acct), '大V 周一进队列（主页）');
ok(!g('drainQueuePlan(__cfg9, {}, __thu, null)').todo.some(x => x.acct), '大V 周四不跑（没排）');

/* 蹲人（原同行）：跟同城本业的排班走 */
ctx.__cfg9b = g('_drainNormalizeScanCfg')({
  v: 7, keywords: [], accounts: [{ k: 'https://www.xiaohongshu.com/user/profile/riv', name: '竞对', scenario: 'rival' }],
  pbPlan: { local: { days: [1], perDay: 3 } },
});
ok(g('drainQueuePlan(__cfg9b, {}, __mon, null)').todo.some(x => x.acct), '蹲人号跟同城本业周一进队列');
ok(!g('drainQueuePlan(__cfg9b, {}, __thu, null)').todo.some(x => x.acct), '同城本业周四没排，蹲人号也不跑');
ok(/\? 'local' : 'highv'/.test(src), '盯的账号排班映射到同城本业');

/* ── 9.5 默认短话：第一次读到就铺满 6 个玩法（旧的账号级话术用默认覆盖） ── */
await ctx.chrome.storage.local.set({ drain_scan_cfg: { v: 7, keywords: [], pbPlan: {} } });
ctx.Storage = { getConfig: async () => ({ myCity: { city: '武汉' }, product: { talk: { note: '旧版', steps: { who: '家长', open: '在哪个区', lead: '问价', deliver: '来主页' }, sample: { q: '体能', a: '旧评论' } } } }) };
const migrated = await g('drainGetScanCfg()');
ok(Object.keys(migrated.pbTalk).length === 6, '默认话术铺到 6 个玩法');
ok(migrated.talkSeed === 11, '铺底标记记到当前版本');
ok(/周末带娃去哪/.test(migrated.pbTalk.latest.text), '本地泛搜用默认短话');
ok(!/家长 在哪个区/.test(migrated.pbTalk.latest.text), '旧的账号级话术不再沿用（用默认覆盖）');
const storedCfg = (await ctx.chrome.storage.local.get('drain_scan_cfg')).drain_scan_cfg;
ok(storedCfg.talkSeed === 11 && Object.keys(storedCfg.pbTalk || {}).length === 6, '铺底结果已经落盘');
ok(migrated.pbPlan.latest.store === 'identity' && migrated.pbPlan.top.store === 'none' && migrated.pbPlan.local.store === 'store' && migrated.pbPlan.pain.store === 'store' && migrated.pbPlan.cross.store === 'identity' && migrated.pbPlan.highv.store === 'identity', '提店口径跟默认话术对齐');
ok(migrated.city === '武汉', '属地跟基础配置走');

/* ── 10. 玩法话术：默认短话 / 手改保留 / 一段话接进生成 ── */
ctx.__talkCfg = g('_drainNormalizeScanCfg')({
  v: 9,
  talkSeed: 11,
  keywords: [],
  pbPlan: { latest: { store: 'none' }, top: { store: 'identity' } },
  pbTalk: {
    latest: { text: '本地家长问周末带娃去哪，就是商机。在他评论下接一句，不提店名。', persona: '老张', at: 123 },
  },
});
ctx.__talkLatest = g('drainPbTalkOf(__talkCfg, "latest")');
ok(/周末带娃去哪/.test(ctx.__talkLatest.text), '铺过之后再读，手改的话保留');
ok(g('drainPbTalkOf(__talkCfg, "top")') === null, '没存的那份不凭空造');
ctx.__talkSeed = g('_drainNormalizeScanCfg')({ v: 9, keywords: [], pbTalk: { latest: { text: '我原来的话' } } });
ok(/周末带娃去哪/.test(g('drainPbTalkOf(__talkSeed, "latest").text')), '没铺过＝默认覆盖旧话术');
ok(g('DRAIN_TALK_V') === 11, '话术格式版本记 11');
ok(/体智能/.test(g('DRAIN_TALK_DEFAULT.cross')), '默认话术讲清异业怎么算商机');
ok(['latest', 'top', 'local', 'pain', 'cross', 'highv'].every(s => {
  const t = String(g('DRAIN_TALK_DEFAULT.' + s) || '');
  return /笔记下/.test(t) && /(评论区|回复区)/.test(t) && /回/.test(t);
}), '六段默认话术都写了「笔记下面搭一句 ＋ 评论区里回人」');
ok(!/不在评论区留言/.test(g('DRAIN_TALK_DEFAULT.highv')), '大V 话术不再写「不在评论区留言」');
ok(g('drainTalkBlock(drainPbTalkOf(__talkCfg, "latest"))').indexOf('本地家长问周末带娃去哪') >= 0, '话术块把这段原样带进提示词');
ok(g('drainTalkBlock(drainPbTalkNorm({ steps: { who: "w", open: "o", lead: "l", deliver: "d" } }))').indexOf('w o\nl\nd') >= 0, '老四步话术也能转成一段（rival 读本业那份）');

['web/lib/scenario-drain.js', 'executor/exec-core.js', 'extension/background.js', 'server/bg/background.js', 'web/download/_proto/exec-core.js'].forEach(f => {
  const s = read(f);
  if (f === 'web/lib/scenario-drain.js') {
    ok(/talkBlock\s*=\s*drainTalkBlock\(/.test(s) && /sysPrompt \+= .*talkBlock/.test(s), f + '：评论生成带上玩法话术');
    ok(/data-talkline/.test(s) && /data-talkedit/.test(s) && /data-talksave/.test(s), f + '：话术摆在排班行里、可就地改');
    ok(/class="pbp-table"/.test(s) && /colspan="5"/.test(s) && /data-pbstore="\$\{s\}\|/.test(s), f + '：排班是一张五列表，提店口径收进「改」的展开块');
    ok(/<th>玩法<\/th><th>周几跑（点一下切换）<\/th><th>评论策略（怎么说话）<\/th><th>出词策略（找词按这句）<\/th><th>今天<\/th>/.test(s), f + '：排班五列的表头按老板定的顺序');
    ok(/data-wrbox=/.test(s) && /data-wredit=/.test(s) && /data-writext=/.test(s) && /data-wrsave=/.test(s), f + '：出词策略摆在排班行里、点「改」就地写');
    ok(/<th>玩法<\/th><th>关键词<\/th><th>找词<\/th><th>每天挑几个<\/th>/.test(s), f + '：关键词表把「每天挑几个」从排班挪过来、找词在末列');
    ok(/data-kwsel=/.test(s) && /data-kwbatchdel=/.test(s) && /sxPoolBatchDel/.test(s), f + '：两颗批量钮（这一行移出 / 全部词删除）');
    ok(/class="kwp-findcell"[\s\S]{0,700}?data-kwbatchdel=/.test(s), f + '：「🗑 批量移出」摆在「✨ 找词」那一列');
    ok(!/data-kwx=/.test(s) && !/data-pooldel=/.test(s) && !/class="wx"/.test(s) && !/只移出这一个词/.test(s),
      f + '：两处单词 ✕（逐个移出／逐个真删）与那句灰字说明已撤净');
    ok(/width:92px;">上次跑<\/th><th style="width:40px;">勾删/.test(s), f + '：全部词表「上次跑／勾删」两列按新宽度');
    ok(!/data-kwpick/.test(s) && !/从词池挑/.test(s) && !/sxFcLine/.test(s) && !/data-trun/.test(s), f + '：「从词池挑」、「多久跑一次」和顶上两行灰字已撤');
    ok(!/sxTalkModal/.test(s) && !/sxTalkBatch/.test(s), f + '：话术弹窗和批量按钮已撤');
    ok(/DRAIN_TALK_DEFAULT/.test(s) && /talkSeed/.test(s), f + '：6 段默认话术＋一次性铺底');
  } else {
    ok(/talkBlock\s*=\s*drainTalkBlock\(/.test(s) && /systemPrompt \+= .*talkBlock/.test(s), f + '：私信生成带上玩法话术');
    ok(/_drainTalkTextOf\(/.test(s) && /只写「一小段话」/.test(s) && /什么算商机/.test(s) && /提不提店名/.test(s) && /【这次的要求】/.test(s), f + '：按 2~3 句三件事生成、支持一句话改');
  }
});

/* ── 11. 出词策略：能自己写、后端优先用这一句 ── */
ctx.__wrCfg = g('_drainNormalizeScanCfg')({
  v: 9, keywords: [],
  pbPlan: { local: { days: [1], perDay: 3, wordRule: '  只出「杭州 + 美术班」这种两段词，别出机构名  ' }, latest: { days: [1] } },
});
ok(g('drainPbPlan(__wrCfg, "local").wordRule') === '只出「杭州 + 美术班」这种两段词，别出机构名', '自己写的出词策略会被收干净（去首尾空格、中间并成一行）');
ok(g('drainPbPlan(__wrCfg, "latest").wordRule') === '', '没写的玩法留空，不凭空造');
ok(g('drainAiKeywordRule("local", "杭州", drainPbPlan(__wrCfg, "local").wordRule)') === '只出「杭州 + 美术班」这种两段词，别出机构名', '有自己那句就用自己那句');
ok(/同城本业/.test(g('drainAiKeywordRule("local", "杭州", "")')), '留空就退回内置那句口径');
ok(g('drainPbWordRuleNorm("' + '词'.repeat(200) + '")').length === 160, '出词策略最长 160 字（太长的提示词 AI 自己会砍）');

['executor/exec-core.js', 'extension/background.js', 'server/bg/background.js', 'web/download/_proto/exec-core.js'].forEach(f => {
  ok(/drainPbPlan\(await drainGetScanCfg\(\), playbook\) \|\| \{\}\)\.wordRule/.test(read(f)), f + '：找词先领这个玩法自己写的出词策略');
});

/* ── 11.5 名字对得上：排班行叫「评论策略」，底下那块讲节奏的叫「评论节奏」 ── */
ok(/📖 评论节奏/.test(src) && /📖 评论节奏/.test(read('web/popup.html')), '队列页那块「📖 评论节奏」改了名，不跟排班行撞词');
ok(!/📖 评论策略/.test(src) && !/📖 评论策略/.test(read('web/popup.html')), '旧的「📖 评论策略」标题没有残留');

/* ── 12. 副本一致（2026-11-04 16:4x 定口径）──
   scenario-drain 六份＝两组：
     网页后端组＝web/lib、server/bg/lib（逐字节相同，本机开发/自测读这份）；
     包层组＝executor/lib、extension/lib、web/download/_proto/lib（逐字节相同，出客户包＋执行器自测读这份）。
   两组内容相同，只比「空行放在哪」差几行（另一会话铺母版/删函数留下的排版残留）。
   「整轮卡死替机器人记欠账」＝包里的活代码（`work-boot.js` 的看门狗调它），16:42 已补进公网后台、16:43:50 重启上岗，不再是未上线残留。
   只剩一行注释级差异：公网后台那句还是旧页名「诊断&配置」、包里已是「账号规划」——注释客户看不见，不值一趟重启。 */
const WEB_TIER = ['web/lib/scenario-drain.js', 'server/bg/lib/scenario-drain.js'];
const PACK_TIER = ['executor/lib/scenario-drain.js', 'extension/lib/scenario-drain.js', 'web/download/_proto/lib/scenario-drain.js'];
/* 两组之间只差「空行放在哪」——另一会话铺母版/删函数时留下的排版残留；比对只看非空行序列 */
const contentLines = (s) => s.split('\n').filter(l => l.trim() !== '');
ok(new Set(WEB_TIER.map(md5)).size === 1, '网页后端组两份逐字节一致（web／server-bg）');
ok(new Set(PACK_TIER.map(md5)).size === 1, '包层组三份逐字节一致（executor／extension／_proto）');
ok(contentLines(read(PACK_TIER[0])).join('\n') === contentLines(read(WEB_TIER[0])).join('\n'), '两组内容一致（只差空行排版）');
ok([...WEB_TIER, ...PACK_TIER].every(f => /drainQueueHoldRunning/.test(read(f))), '记欠账函数六份齐全（公网后台 16:43 已上岗）');
ok(/drainQueueHoldRunning/.test(read('executor/work-boot.js')), '看门狗仍调它（卡住自动记欠账在客户机上生效）');
const awMain = md5('web/auto-water-app.js');
['executor/auto-water-app.js', 'extension/auto-water-app.js', 'web/download/_proto/auto-water-app.js']
  .forEach(f => ok(md5(f) === awMain, '副本一致：' + f));
ok(!/id: 'rival'/.test(read('web/auto-water-app.js')), '搜索类型里不再有「竞对」');
const pmain = md5('web/lib/default-prompts.js');
['extension/lib/default-prompts.js', 'server/bg/lib/default-prompts.js']
  .forEach(f => ok(md5(f) === pmain, '网页提示词副本一致：' + f));
ok(md5('executor/lib/default-prompts.js') === md5('web/download/_proto/lib/default-prompts.js'), '执行器两份提示词副本一致');
ok(/EXECUTOR-STUB/.test(read('executor/lib/default-prompts.js')), '执行器用空壳提示词（真提示词由服务器下发）');

/* ── 13. 「回评论区那句」跟「笔记下面那句」同一套评论策略（2026-11-04 老板定：一篇笔记两步，别两套口径）── */
const ACQ_PACK_TIER = ['executor/lib/scenario-drain.js', 'extension/lib/scenario-drain.js', 'web/download/_proto/lib/scenario-drain.js'];
[...WEB_TIER, ...ACQ_PACK_TIER].forEach(f =>
  ok(/async function drainReplyStrategyBlock/.test(read(f)), '五份玩法库都有「这一趟的评论策略」那段：' + f));
['web/auto-bot.js', 'executor/auto-bot.js', 'extension/auto-bot.js', 'web/download/_proto/auto-bot.js'].forEach(f =>
  ok(/window.__acqCurScenario = item\.scenario/.test(read(f)) && /window.__acqCurScenario = '';/.test(read(f)),
    '跑队列会记下这一格是哪个玩法、收工就抹掉：' + f));
['web/popup.js', 'executor/popup.js', 'extension/popup.js', 'web/download/_proto/popup.js'].forEach(f =>
  ok(/scenario: window\.__acqCurScenario/.test(read(f)), '评论区挖掘把「这一格是哪个玩法」一起交给 AI：' + f));
['executor/exec-core.js', 'extension/background.js', 'server/bg/background.js', 'web/download/_proto/exec-core.js'].forEach(f =>
  ok(/await drainReplyStrategyBlock\(data && data\.scenario\)/.test(read(f)), '出评论区话术前会把那段策略接到提示词尾巴上：' + f));

store.drain_scan_cfg = {
  talkSeed: 99,
  pbPlan: { highv: { days: [1], perDay: 3, store: 'identity' }, local: { days: [1], perDay: 3, store: 'store' } },
  pbTalk: { highv: { text: '在大V笔记下面留一句赞同＋本行补充。', v: 11 } },
};
const blkHighv = await g('drainReplyStrategyBlock')('highv');
ok(blkHighv.includes('跟「在笔记下面评一句」用的是同一段'), '大V：评论区那句写明跟笔记下面同源');
ok(blkHighv.includes('【提店口径】可以在句尾自然带一句'), '大V：提店档按这一行的设置走（只说身份）');
ok(blkHighv.includes('赞同＋本行补充'), '大V：把排班行里那段话也带上了');
ok((await g('drainReplyStrategyBlock')('local')).includes('【提店口径】对方明确问起'), '同城本业：换成「问起才报店名」那一档');
const blkNoTalk = await g('drainReplyStrategyBlock')('pain');
ok(blkNoTalk.includes('【提店口径】') && !blkNoTalk.includes('【这个玩法的话术'), '没写话术的玩法：口径照给、话术走兜底句');
ok((await g('drainReplyStrategyBlock')('')) === '', '手动扫描（不属于哪个玩法）＝不给这段，维持原样');
ok((await g('drainReplyStrategyBlock')('daily')) === '', '日常流程不掺玩法口径');
delete store.drain_scan_cfg;

console.log(fails ? '\n有 ' + fails + ' 项没过' : '\n全过');
process.exit(fails ? 1 : 0);
