/* 全场景截流 · 扩展自带「队列配置 + 笔记监控列表」工具
 *
 * 同时被 background 与 popup 使用：
 *  - background.js importScripts：提供 SCENARIO_DRAIN 话术库 + handleDrainComment（调 AI）
 *  - popup <script>：获客分组下渲染——
 *      · renderDrainQueue(container)          「🗂 队列」：📜 队列 / ⚙️ 配置 两个横排三级 tab（配置＝三张卡：跑什么 / 日常浏览 / 推广目标·承接）
 *      · renderScenarioDrain(container)       「📋 笔记列表」：笔记监控列表（顶栏带 🔁 补开未打开）
 *
 * 任务配置原来是个独立二级页，2026-10-24 并进「队列 → ⚙️ 配置」：一个入口，不再有第四级横签。
 *
 * 模型：一个关键词 × 不同搜索筛选条件 → 不同类型的笔记 → 各自不同的评论/维护方式
 *   1. 最新笔记(latest)：筛选「最新」。定时看点赞涨没涨，涨了就赶去评论（抢前排）。
 *   2. 搜索TOP笔记(top)：筛选「点赞最多/评论最多/收藏最多」。走活水机制——
 *      看自己的评论还在不在前排、有多少赞，定期维护。
 *   3. 同城本业(local)：城市＋本行关键词，筛选「最新」。同城人的笔记下留判断型短评；同行/卖课的
 *      帖子只收人、不留言（原「竞对」2026-11-02 并进这一路）。
 *   4. 求助笔记(pain)：特殊关键词（求推荐/听劝…）。走活水机制。
 *   5. 同城异业(cross)：城市＋别家行业关键词，从别家评论区找本地人。
 *   （高V狙击 highv 不走词：它盯着**人**——在「👤 盯的账号」里挂头部博主主页，跑的是他自己的笔记）
 *
 * 笔记进本地监控列表(drain_notes 存在 chrome.storage.local)，
 * 每行按类型判据打状态标签（数据列＝点赞/评论/二级评论）；行上只有一个动作「打开」——
 * 点了就跳「🎯 获客 · 工作台」在那边打开，评论、生成、发送、转获客都在工作台里做。
 */

const SCENARIO_DRAIN = [
  {
    scenario: 'latest',
    label: '本地泛搜索',
    icon: '🧭',
    tag: '最新 · 找还没想过去比较的本地人',
    desc: '城市＋场景宽词，按「最新」搜。找的是本地日常笔记下、还没想过去比较的本地人。',
    dmOpen: '刷到你那条，我也在{city}，说个实在的……',
    system: `刷到同城一篇日常笔记，想留一句只有本地人才说得出的提醒。
要求：
1. 20-60 字，一到两句，口语，像本人随手敲的；最多带 1 个表情
2. 先用「我」说一句本地人普遍知道的实情（哪个时段人多、哪条路好走、下雨天该去哪），再补一句本地生活的小提醒
3. 不玩梗、不讲段子
4. 丧事、疾病、纠纷、投诉这类内容，或博主明显不想被搭话 → 只回复两个字：跳过`,
    user: `【城市】{city}
【笔记标题】{title}
【笔记正文】{content}
【博主】{author}

这是同城一篇日常笔记，我要以本地人的身份留一句短评。请写一句 20-60 字的短评（最多 1 个表情）；如果这篇不适合评论，只回复：跳过。直接返回评论文本。`,
  },
  {
    scenario: 'top',
    label: 'TOP搜索',
    icon: '🔥',
    tag: '点赞/评论/收藏最多 · 长期占位',
    desc: '按点赞/评论/收藏最多搜；玩法「同城」列选优先/全收时先按「词＋城市」搜，本地没料再补搜全国。写一句专业热评长期占位。',
    dmOpen: '看到你在那篇讲 XX 的帖子下留言，说到点上了……',
    system: `刷到一篇搜索排名靠前的笔记，想留一句同行看了点头、普通读者也看得懂的热评，长期挂在前排。
要求：
1. 20-70 字，一到两句；最多带 1 个表情
2. 以「我」说话，先接住笔记讲的那件事，再补一个别人没提到的具体点：先做哪一步、哪种情况别做、最容易忽略什么
3. 不复读评论区已有的话，不写「赞同楼上」
4. 不许整活玩梗
5. 丧事、疾病、纠纷、投诉这类内容 → 只回复两个字：跳过`,
    user: `【搜索关键词】{keyword}
【笔记标题】{title}
【笔记正文】{content}
【博主】{author}

这是搜索「{keyword}」排名靠前的笔记，我要以前排热评的身份留一句内行话。请写一句 20-70 字的短评（最多 1 个表情）；如果这篇不适合评论，只回复：跳过。直接返回评论文本。`,
  },
  {
    scenario: 'local',
    label: '同城本业',
    icon: '📍',
    tag: '城市＋本行 · 已经在挑、在比',
    desc: '城市＋核心品类，按「最新」搜。找的是已经在挑、在比较的本地人；同行/揽客的帖子只收人不留言。',
    dmOpen: '同在{city}，看到你在纠结选哪家……',
    system: `刷到同城人在聊本行相关的事，想留一句短、准、能帮他做判断的评论。
先判帖：同行在招揽生意、打广告（出现「报名、名额、优惠、扫码、加微信、私信咨询」这类词，或口吻明显在推销自己的服务）→ 只回复两个字：跳过；评论区的本地人仍会被收进清单。
要求：
1. 20-50 字，只写一句话；最多带 1 个表情
2. 用「我」说话，给一条判断：先试什么、该看什么、哪种情况先别急着定
3. 不玩梗、不空夸
4. 丧事、疾病、纠纷、投诉这类内容 → 只回复两个字：跳过`,
    user: `【城市】{city}
【笔记标题】{title}
【笔记正文】{content}
【博主】{author}

这是同城人在聊本行相关的事，我要以本地做这行的人的身份留一句判断。请写一句 20-50 字的短评（最多 1 个表情）；如果这篇不适合评论，只回复：跳过。直接返回评论文本。`,
  },
  {
    scenario: 'pain',
    label: '咨询帖',
    icon: '🎯',
    tag: '求助/避雷 · 楼主和回复区都收',
    desc: '城市＋求助词/避雷词，按「关键词」搜。楼主和回复区里同问的人都要收。',
    dmOpen: '看到你在问 XX 那件事，我正好做这行……',
    system: `刷到一条在求助或避雷的笔记，想留一句真帮到他、又让人记住你的评论。
先判帖，再写：
· 求助帖（哪家好／求推荐／值不值／怎么办）→ 按 A 写
· 避雷帖（后悔／避雷／踩坑／没用）→ 按 B 写

A 求助帖
1. 20-70 字，一到两句；最多带 1 个表情
2. 先正面回答他问的那件事，给一条马上能用的判断或做法：先做什么、该看什么、哪种情况先别急着定
3. 不推销

B 避雷帖
1. 20-70 字，一到两句；最多带 1 个表情
2. 先接住他的情绪（一句就够），再给一条下次怎么避开的判断；不替同行辩解、不说「是你没找对」
3. 不趁机推销

两版都遵守：
4. 不玩梗`,
    user: `【楼主求助/避雷原话】{pain}
【笔记标题】{title}
【笔记正文】{content}
【博主】{author}
【城市】{city}

楼主在求助或避雷，我要以做这行的本人身份留一句对症的评论。请写一句 20-70 字的短评（最多 1 个表情）；如果不适合评论，只回复：跳过。直接返回评论文本。`,
  },
  {
    scenario: 'cross',
    label: '同城异业',
    icon: '🧩',
    tag: '城市＋异业 · 评论区里的本地人',
    desc: '城市＋异业品类（也可 #话题），按「最新」搜。从别家行业的笔记评论区里找本地人。',
    dmOpen: '刷到你在 XX 那条下面留言，说到那个难处……',
    system: `刷到同城异业（不是本行）的笔记，想借评论区里本地人的讨论，留一句自然、不露痕迹的评论。
先判帖：
· 同行在招揽生意、打广告？看到「报名、名额、优惠、扫码、加微信、私信咨询」这类词，或口吻明显在推销 → 只回复两个字：跳过
· 普通分享帖 → 按下面写

普通分享帖：
1. 40-100 字，一到三句；最多带 1 个表情
2. 用跨行业关联切入：从对方笔记里提到的具体困扰接到本行的判断，别硬拐
3. 用「我」说话，像本地人闲聊；不说自己卖什么，可以从自己开店的经历、做过的案例切入
4. 不贬低对方行业，不玩梗
5. 丧事、疾病、纠纷、投诉这类内容 → 只回复两个字：跳过`,
    user: `【城市】{city}
【笔记标题】{title}
【笔记正文】{content}
【博主】{author}

这是同城异业的笔记，我要从跨行业角度留一句自然评论。请写一句 40-100 字的短评（最多 1 个表情）；如果是同行打广告或内容不适合，只回复：跳过。直接返回评论文本。`,
  },
  {
    scenario: 'rival',
    label: '同行／竞对',
    icon: '🕵️',
    tag: '只蹲人不评论 · 私信跟进',
    manual: false,
    noComment: true,
    desc: '竞品名搜最新（或直接盯竞对主页）。评论区里全是精准顾客：只收人私信，绝不留评论。',
    dmOpen: '刷到你那条评论，说的正好是我之前踩过的坑……',
    system: `你是小红书真人号主，正在给一位刚从同行笔记评论区看到的潜在顾客发第一条私信。我的产品={product}。
【这个账号是谁】
{persona_block}
策略（埋伏式首触）：
1. 绝不提“我在某某笔记评论区看到你”（会让人觉得被盯着、像截流）
2. 用「刷到你那条评论，说的正好是我之前踩过的坑」这类自然由头破冰（只能借人设里真有的经历，没写过的别编）
3. 先给价值：一句话给出对方向题的判断/提醒，再自然带出「{product}」能帮他解决什么
4. 先给价值、不硬推销、绝不放链接/微信/二维码，承接一律用「{guide}」
5. 60-90 字，口语化真人，像随手发来的私信
{store_rule}`,
    user: `【对方留言】{pain}
【来自笔记】{title}
【笔记内容】{content}
【搜索关键词】{keyword}

我要给这个在同行评论区看到的潜在顾客发第一条私信（同行/竞对笔记不评论，只私信）。请生成一条埋伏式私信开场白（60-90 字），自然带出「{product}」，承接用「{guide}」，不放链接。直接返回私信文本。`,
  },
  {
    scenario: 'highv',
    label: '大V',
    icon: '👑',
    tag: '借主页流量 · 评论区补充',
    manual: true,
    desc: '头部博主的最新笔记，在评论区留一句「赞同＋本行视角补充」，借头部 IP 溢出流量。',
    dmOpen: '在你关注的 XX 那位博主下面看到你……',
    system: `刷到一位头部博主（大V）的笔记，想在他评论区留一句能被更多人看到的专业补充。
方式是「先真心赞同 + 再补一句本行才看得出的角度」。不推销、不写长文。
要求：
1. 20-70 字，一到两句；最多带 1 个表情
2. 先接住博主最亮的那句观点表示赞同，再用本行的视角补一句别人没注意到的角度或一个具体做法
3. 不能像拍马屁；不许整活玩梗
4. 丧事、疾病、纠纷这类内容，或博主口吻明显不适合搭话 → 只回复两个字：跳过`,
    user: `【高V笔记标题】{title}
【高V笔记正文】{content}
【高V作者】{author}

我要在头部博主评论区留一句「赞同 + 本行视角补充」的热评。请写一句 20-70 字的短评（最多 1 个表情）；如果这篇不适合评论，只回复：跳过。直接返回评论文本。`,
  },
];


const DRAIN_KEY = 'drain_notes';
const DRAIN_SCAN_KEY = 'drain_scan_cfg';
/* 🎯求助笔记的搜法＝「关键词 + 下面这个词」，一个词一搜。
   这套词内置、不给用户配（2026-09-25）：自己配也配不出更好的，少一个要维护的输入框。 */
const DRAIN_PAIN_WORDS = ['求推荐', '听劝', '怎么办', '求建议'];
// 旧 6 类型 → 新 4 类型的迁移映射（topic 并进 top：都是搜索流高热笔记，并入后由活水维护）
const DRAIN_LEGACY = { burst: 'latest', evergreen: 'top', city: 'local', topic: 'top' };
// 关键词 × 筛选 派生表：一个关键词能派生出哪些类型的来源
const DRAIN_TYPE_META = [
  { scenario: 'top', tip: '关键词 + 点赞/评论/收藏最多（TOP搜索）' },
  { scenario: 'pain', tip: '关键词 + 求助词/避雷词（咨询帖）', painWords: true },
  { scenario: 'latest', tip: '关键词 + 最新（本地泛搜索）' },
  { scenario: 'local', tip: '关键词（词里自带城市）+ 最新（同城本业）', needCity: true },
  { scenario: 'cross', tip: '关键词（词里自带城市）+ 最新（同城异业：从别家行业评论区找本地人）', needCity: true },
];
/* ── 各类型的「跑法」总表（商机发现 + 评论生成 的唯一真源，机器人/列表/生成按钮都读它）──
 * send: 'note'  = 只对笔记本身发一条一级评论
 *       'both'  = 既对笔记发一级评论，也回复评论区里搭话/求助的人（2026-11-04 老板定：六个玩法全走这条）
 *       'none'  = 一个字都不评论（埋伏：只把人拉进获客清单去私信）—— 现在只有同行/竞对走这条
 * find: 'commenters' = 扫评论区找商机人（拉进获客清单）；'none' = 不扫，只发自己那条评论
 * keep: '活水' 口径——发完之后靠回看（我的评论还在不在前排/多少赞）来维护，掉榜就补
 */
const DRAIN_PLAYBOOK = {
  latest: { name: '本地泛搜索', icon: '🧭', send: 'both', find: 'commenters', keep: '抢前排',
    tip: '本地泛搜索：城市＋场景宽词搜最新，对笔记发一条本地人短评，同时回评论区里搭话的人，顺手把有商机的收进获客清单' },
  top: { name: 'TOP搜索', icon: '🔥', send: 'both', find: 'commenters', keep: '活水维护',
    tip: 'TOP搜索：按点赞/评论/收藏最多搜；玩法同城列选优先/全收时先按「词＋城市」搜，本地没料再补搜全国，发一条专业热评长期占位，同时回评论区里问方法的人' },
  local: { name: '同城本业', icon: '📍', send: 'both', find: 'commenters', keep: '地域信任',
    tip: '同城本业：城市＋本行词搜最新，在同城人的笔记下留一条判断型短评，同时回评论区里在比较的人；同行/揽客的帖子只收人、不留言' },
  pain: { name: '咨询帖', icon: '🎯', send: 'both', find: 'commenters', keep: '活水维护',
    tip: '咨询帖：求助帖/避雷帖里，对笔记发一条评论，同时回复评论区里同问的人' },
  cross: { name: '同城异业', icon: '🧩', send: 'both', find: 'commenters', keep: '跨行业关联',
    tip: '同城异业：城市＋异业词搜最新，普通分享帖可以评论（同行揽客帖跳过），同时回评论区里说同一件难事的人' },
  rival: { name: '同行／竞对', icon: '🕵️', send: 'none', find: 'commenters', keep: '私信跟进',
    tip: '同行／竞对：只在评论区找人拉进获客清单去私信，绝不评论、不惊动对方' },
  highv: { name: '大V', icon: '👑', send: 'both', find: 'commenters', keep: '借头部流量',
    tip: '大V：在头部博主笔记下发一条「赞同＋本行补充」，同时回评论区里接话的人' },
};
function drainPlaybookOf(id) {
  return DRAIN_PLAYBOOK[drainScenarioId(id)] || DRAIN_PLAYBOOK.latest;
}
/* 跑法的一句话展示（列表里那行小字） */
function drainPlaybookLabel(id) {
  const pb = drainPlaybookOf(id);
  const sendTxt = { note: '评笔记', both: '评笔记+回评论者', none: '只蹲人不评论' }[pb.send] || pb.send;
  return pb.icon + pb.name + ' · ' + sendTxt + (pb.find === 'commenters' && pb.send !== 'both' ? '+扫商机' : '');
}
const DRAIN_SORT_LABEL = { latest: '最新', likes: '点赞最多', comments: '评论最多', collects: '收藏最多' };
const DRAIN_DEFAULT_TYPES = { latest: true, top: true, local: true, pain: true, cross: true };
// TOP 那列固定跑这三种排序（2026-09-25 起不给用户勾，默认就是全要）
const DRAIN_DEFAULT_TOP_SORTS = ['likes', 'comments', 'collects'];
const DRAIN_MODE_HOURS_DEFAULT = 6;
/* 每类的「节奏」：整列设一次，不挂在单个词上（配置页表头那行）
   最新盯新帖要每轮跑；TOP/本地/求助是活水维护，隔几小时够用 */
const DRAIN_TYPE_RUN_DEFAULT = {
  latest: { mode: 'each' },
  top: { mode: 'interval', hours: DRAIN_MODE_HOURS_DEFAULT },
  local: { mode: 'interval', hours: DRAIN_MODE_HOURS_DEFAULT },
  pain: { mode: 'interval', hours: DRAIN_MODE_HOURS_DEFAULT },
  cross: { mode: 'interval', hours: DRAIN_MODE_HOURS_DEFAULT },
  // 同行：列节奏默认隔 12 小时（词默认不勾这一列——要蹲同行，单独给竞品词勾上）
  rival: { mode: 'interval', hours: 12 },
};
/* 「👤 盯的账号」的节奏：和词池那几列各管各的——「拿竞品名去搜最新」与「进竞对主页扒」
   是两件事，间隔可以不一样。默认都隔 12 小时。 */
const DRAIN_ACCT_RUN_DEFAULT = {
  highv: { mode: 'interval', hours: 12 },
  rival: { mode: 'interval', hours: 12 },
};
const DRAIN_RUN_PRESETS = [1, 3, 6, 12, 24];
/* 词池容量不设默认上限了：三档一律不限量（版本上限 0＝不限；要收紧时在 build.js 的 PRESETS 里给数字） */
/* 截流评论的引导承接：扫描配置里没设、产品配置也没填时用它（站内承接，评论直导站外易触发审核） */
const DRAIN_GUIDE_DEFAULT = '我主页/私信';
const DRAIN_SEARCH_URL = (term) => 'https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(term) + '&source=web_search_result_note';

/* 🌿 日常流程：队列里的一种流程项（一轮刷首页），不是「词 × 筛选」里的一格，
   所以不进 SCENARIO_DRAIN（那份表还驱动着词池表头与笔记池的筛选下拉）。
   但队列卡片 / 执行器 / 日志都要用同一个名字，所以让 drainScenarioDef 单独认它。 */
const DRAIN_DAILY_DEF = { scenario: 'daily', label: '日常流程', icon: '🌿', tag: '泛刷一轮 · 只记自己的账' };

/* 类型定义：新 id 直取，旧 id 走迁移映射，未知 id 兜底最新笔记 */
function drainScenarioDef(id) {
  const key = DRAIN_LEGACY[id] || id;
  if (key === 'daily') return DRAIN_DAILY_DEF;
  return SCENARIO_DRAIN.find(s => s.scenario === key) || SCENARIO_DRAIN[0];
}
function drainScenarioId(id) { return drainScenarioDef(id).scenario; }

/* 单个搜索动作的展示名：🆕 最新笔记 / 🔥 搜索TOP·点赞最多 / 📍 本地笔记 / 🎯 求助笔记 */
function drainPassLabel(pass) {
  if (!pass) return '';
  const sc = drainScenarioDef(pass.scenario);
  return sc.icon + ' ' + sc.label + (pass.sort && pass.sort !== 'latest' && DRAIN_SORT_LABEL[pass.sort] ? '·' + DRAIN_SORT_LABEL[pass.sort] : '');
}
/* 一个搜索动作的身份（同一个词里唯一）：TOP 按排序分，咨询帖按求助词分，其余一类只有一搜 */
function drainPassId(pass) {
  const sc = drainScenarioId((pass && pass.scenario) || '');
  if (sc === 'top') return 'top:' + String((pass && pass.sort) || 'likes');
  if (sc === 'pain') return 'pain:' + String((pass && pass.pw) || '');
  return sc;
}
/* 这一行的筛选条件（写在队列行上）：TOP＝点赞/评论/收藏最多，咨询帖＝求助词；没有就不写 */
function drainPassFilter(pass) {
  const sc = drainScenarioId((pass && pass.scenario) || '');
  if (sc === 'top') {
    const s = String((pass && pass.sort) || 'likes');
    return DRAIN_SORT_LABEL[s] || '点赞最多';
  }
  if (sc === 'pain') return String((pass && pass.pw) || '');
  if (sc === 'highv' || sc === 'rival') return '主页最新';
  return '';
}

/* ── 词池条目：{ k:词, on:启用, src:来源(manual/ai/topic), types:{[类型]:{mode,hours}} } ──
   字符串形式（旧数据 / 顺手传词）也统一收成条目；types 留空 = 跟随全局派生开关 */
/* ── 投放平台（2026-10-25）：队列配置只有一份，这一份派给哪几个平台就勾哪几个 ──
   cfg.plats = {xhs:true, dy:false}；老数据没写 ＝ 只投小红书，跑法跟升级前一模一样。
   平台的先后就是派单先后（这个词的小红书那趟跑完，再跑它的抖音那趟）。 */
const DRAIN_PLATS = ['xhs', 'dy'];
const DRAIN_PLAT_LABEL = { xhs: '小红书', dy: '抖音' };
/* 抖音获客（2026-10-29 老板定）：只有「全平台版（699）」开；前三档只跑小红书。
   界面只是灰着不给勾，真闸在服务器派活那边（没开就跳过抖音这一头） */
function drainMultiPlatOn() {
  try {
    if (typeof editionFeatureOn === 'function') return !!editionFeatureOn('multiPlatform');
    if (typeof Edition !== 'undefined' && Edition.hasFeature) return !!Edition.hasFeature('multiPlatform');
  } catch (_) {}
  return true;
}
function drainPlatsNorm(p) {
  const o = (p && typeof p === 'object') ? p : {};
  return { xhs: o.xhs !== false, dy: o.dy === true };
}
function drainCfgPlats(cfg) {
  const p = drainPlatsNorm((cfg || {}).plats);
  return DRAIN_PLATS.filter(id => p[id] && (id !== 'dy' || drainMultiPlatOn()));
}

function _drainPoolEntry(k, extra) {
  if (k && typeof k === 'object') {
    const key = String(k.k || '').trim();
    if (!key) return null;
    return Object.assign({
      k: key,
      on: k.on !== false,
      src: k.src || 'manual',
      batch: drainBatchName(k),
      // 词挂在哪几个玩法上（v7 起）：没写过的新词先挂「本地泛搜索」，其余玩法在词池里自己勾
      types: (k.types && typeof k.types === 'object') ? k.types : { latest: true },
      // 老口径的「这个词哪几天跑」留着不删，只作迁移来源；现在跑哪天由玩法排班决定
      days: Array.isArray(k.days) ? k.days.map(Number).filter(d => Number.isFinite(d) && d >= 0 && d <= 6) : null,
    }, extra || {});
  }
  const key = String(k || '').trim();
  if (!key) return null;
  return Object.assign({ k: key, on: true, src: 'manual', batch: drainBatchName(null), types: { latest: true }, days: null }, extra || {});
}

/* ── 关键词批次：词打批次标签，队列管理配「周几跑哪批」── */
const DRAIN_DEFAULT_BATCH = '默认';
const WK_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
/* 词条目 / 批次名 → 批次名：传字符串也认（以前只认条目，导致查排期时批次名被当成「默认」） */
function drainBatchName(e) {
  const n = (typeof e === 'string') ? e : (e && e.batch);
  return String(n || DRAIN_DEFAULT_BATCH).trim() || DRAIN_DEFAULT_BATCH;
}
/* 某批今天该不该跑：cfg.batchPlan[批次名] = [星期index(0=周日…6=周六)]；没排期＝每天跑 */
function drainBatchOnToday(batchName, cfg, now) {
  const days = (((cfg || {}).batchPlan) || {})[drainBatchName(batchName)];
  if (!Array.isArray(days) || !days.length) return true;
  return days.indexOf(new Date(now || Date.now()).getDay()) >= 0;
}
/* ── 玩法排班（2026-11-02 老板定）：排班从「每个词勾周几」搬到「每个玩法勾周几＋每天挑几个词」──
   pbPlan[玩法] = { days:[0..6], perDay:N, store:'none'|'identity'|'store' }
   days=[] ＝这个玩法不跑；没写过＝用默认（见 DRAIN_PB_DEFAULT）。
   一个词属于多个玩法时，各玩法的排班各算各的；同词同玩法同平台只跑一次。
   当日二改：老板发现「同城本业」和「同行/竞对」搜的是同一件事（城市＋本行），合成 6 个玩法。
   系统内部仍认 'rival'：已装客户机和没跑完的旧任务照跑，不再出现在排班/词池里。
   2026-11-03 老板定展示顺序：大V 打头，其次 TOP → 咨询帖 → 本地泛搜 → 同城本业 → 同城异业。 */
const DRAIN_PB_ORDER = ['highv', 'top', 'pain', 'latest', 'local', 'cross'];
/* 走词的玩法（大V 只盯人、不出词） */
const DRAIN_PB_WORD = ['top', 'pain', 'latest', 'local', 'cross'];
/* 玩法图标的底色（关键词表左边那颗小方块） */
const DRAIN_PB_ICON_STYLE = {
  latest: 'background:#e6f5f3;color:#0a7067;',
  top: 'background:#fdeef4;color:#be185d;',
  local: 'background:#eaf1fd;color:#2563eb;',
  pain: 'background:#fdf3e3;color:#b45309;',
  cross: 'background:#f1ecfd;color:#6d28d9;',
  rival: 'background:#eef2f6;color:#475569;',
  highv: 'background:#e6f6fa;color:#0e7490;',
};
/* 一个玩法一行 = 这一趟评论策略的唯一定义（2026-11-09）：周几 / 每天几个词 / 评论动作 / 引导 / 提店 / 开口 /
   同城。别处（账号资料、推广目标、全局同城、行业包）一律不再给这几件事说话。
   store 四档（2026-11-09 老板定）：不提 / 只提身份 / 讲案例 / 可报店名。
   报价、联系方式、站外链接四档都不许写；「可报店名」只给咨询帖这种放心写的玩法。 */
const DRAIN_PB_DEFAULT = {
  latest: { days: [1, 3, 5], perDay: 3, store: 'identity', city: 'priority' },
  top: { days: [1, 2, 3, 4, 5, 6, 0], perDay: 3, store: 'case', city: 'priority' },
  local: { days: [1, 3, 5], perDay: 3, store: 'identity', city: 'priority' },
  pain: { days: [2, 4, 6], perDay: 3, store: 'store', city: 'priority' },
  cross: { days: [2, 5], perDay: 2, store: 'case', city: 'priority' },
  rival: { days: [6], perDay: 2, store: 'none', city: 'priority' },
  highv: { days: [2, 4], perDay: 1, store: 'case', city: 'priority' },
};
const DRAIN_PB_STORE = { none: '不提', identity: '只提身份', case: '讲案例', store: '可报店名' };
/* 上一版（v9）的默认值：迁移到 v10 时只动「还是这几个默认值」的号，自己调过的不动 */
const DRAIN_PB_STORE_V9 = { latest: 'identity', top: 'none', local: 'store', pain: 'store', cross: 'identity', highv: 'identity' };
/* 同城一列三档：不筛 / 优先 / 全收（只在这一列说，账号页只记城市事实） */
const DRAIN_PB_CITY = { off: '不筛', priority: '优先', force: '全收' };
/* 评论策略：mode=这篇笔记做几件事 / guide=想让对方下一步做什么 / entry=怎么开口 / collect=收不收人。
   条数限制已全部撤掉（2026-11-09 老板定：找到就回）。 */
const DRAIN_PB_MODE = { note: '只评笔记', both: '评笔记＋回评论区', reply: '只回评论区', people: '只收人' };
const DRAIN_PB_GUIDE = { none: '不引导', dm: '私信我', home: '看主页', visit: '到店' };
const DRAIN_PB_ENTRY = { follow: '顺着他说', judge: '给一条判断', ask: '反问一句', story: '补一条经验', light: '轻接一句' };
/* 六个玩法＋老 rival 的默认值：没配过的号读出来跟现在一样（rival 本来就是只收人） */
const DRAIN_PB_MODE_DEFAULT = { rival: 'people' };
/* TOP 只给两种评论动作：老板定 TOP 无论如何都要先在主笔记下评一条（丧事/纠纷仍由 AI 跳过）。
   旧配置里的「只回评论区 / 只收人」在归一化时按「评笔记＋回评论区」跑。 */
function drainPbModeOptions(scenario) {
  return drainScenarioId(scenario) === 'top'
    ? { note: DRAIN_PB_MODE.note, both: DRAIN_PB_MODE.both }
    : DRAIN_PB_MODE;
}
const DRAIN_PB_ENTRY_DEFAULT = { top: 'light', pain: 'judge', local: 'judge' };
/* ── 笔记类型表（2026-11-12）──────────────────────────────────────
   打开帖子先判类型（可多个，标一个主类型），再按类型决定「评不评 / 评论动作 / 提店到哪一步 / 收不收人」。
   一项配置只留一个家：这四件事只在类型表里说，渠道（玩法）那边不再各存一份。
   mode 三档：rate＝评（动作按 act 走）；silent＝不评·只收人；block＝完全不碰（不评也不收）。 */
const DRAIN_NOTE_TYPE_ORDER = ['bigv', 'help', 'localbiz', 'localcross', 'normal', 'ad', 'sad'];
const DRAIN_NOTE_TYPE_DEF = {
  bigv:       { icon: '👑', name: '大V帖',       mode: 'rate',   act: 'both', store: 'case',     collect: true,
                judge: '盯的账号名单里的头部博主；笔记本身有热度和评论量', why: '可说自己干这行、讲做过的案例；不报店名、不提产品' },
  help:       { icon: '🎯', name: '求助咨询帖',   mode: 'rate',   act: 'both', store: 'store',    collect: true,
                judge: '楼主在求助、避雷、问哪家靠谱；回复区里同问的也算', why: '可以先正面回答，再留下自己是谁；价格不提' },
  localbiz:   { icon: '📍', name: '同城本业',     mode: 'rate',   act: 'both', store: 'identity', collect: true,
                judge: '同城、本行的笔记，人在挑在比、问哪家好', why: '最多说自己是做这行的；不报店名、不提产品' },
  localcross: { icon: '🧩', name: '同城异业',     mode: 'rate',   act: 'both', store: 'case',     collect: true,
                judge: '同城、别家行业（舞蹈 / 游泳 / 轮滑 / 画画…）的笔记', why: '讲开店的经历和真案例；不报店名、不提自己卖什么' },
  normal:     { icon: '🔥', name: '普通帖',       mode: 'rate',   act: 'note', store: 'identity', collect: true,
                judge: '热帖 / 日常 / 闲聊，没有明确求助，也没在挑', why: '只给一句内行判断；不报店名、不提产品' },
  ad:         { icon: '🚫', name: '广告招生帖',   mode: 'silent', act: 'people', store: 'none',   collect: true, veto: true,
                judge: '同行招生、卖课、招生简章、优惠团购；纯广告带货也算', why: '一条评论都不发；评论区里露出真实需求的人还是收进清单' },
  sad:        { icon: '🕯', name: '悲伤纠纷帖',   mode: 'block',  act: '',       store: 'none',   collect: false, veto: true,
                judge: '生病、事故、纠纷、投诉、维权、招聘求助', why: '一条都不碰' },
};
const DRAIN_NOTE_MODE = { rate: '评', silent: '不评·只收人', block: '完全不碰' };
/* 评论动作四档＝运行时真正会做的四件事（跟老 DRAIN_PB_MODE 同一套，别另造词） */
const DRAIN_NOTE_ACT = { note: '只评笔记', both: '评笔记＋回评论区', reply: '只回评论区', people: '只收人' };
const DRAIN_NOTE_STORE = DRAIN_PB_STORE;                 // 不提 / 只提身份 / 讲案例 / 可报店名
const DRAIN_NOTE_STORE_CAP = { none: 0, identity: 1, case: 2, store: 3 };
/* 老判帖字段（ask / solicit / opinion / daily / ad / sad）→ 新类型：老号里存着的口径还能认，不用重跑 */
const DRAIN_NOTE_TYPE_ALIAS = { ask: 'help', solicit: 'ad', opinion: 'bigv', daily: 'normal' };
function drainNoteTypeId(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  if (DRAIN_NOTE_TYPE_DEF[s]) return s;
  return DRAIN_NOTE_TYPE_ALIAS[s] || '';
}
/* 规整：默认值打底＋只认表里那几档；广告 / 悲伤是安全兜底，锁死不给改 */
function drainNoteTypesNorm(raw) {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const out = {};
  DRAIN_NOTE_TYPE_ORDER.forEach(id => {
    const d = DRAIN_NOTE_TYPE_DEF[id];
    const r = (o[id] && typeof o[id] === 'object') ? o[id] : {};
    if (d.veto) {
      out[id] = { mode: d.mode, act: d.act, store: d.store, collect: d.collect };
      return;
    }
    const mode = DRAIN_NOTE_MODE[r.mode] ? r.mode : d.mode;
    const act = mode !== 'rate' ? (mode === 'silent' ? 'people' : '')
      : (DRAIN_NOTE_ACT[r.act] && r.act !== 'people' ? r.act : d.act);
    out[id] = {
      mode,
      act,
      store: (mode === 'rate' && DRAIN_NOTE_STORE[r.store]) ? r.store : d.store,
      collect: mode === 'block' ? false : (r.collect !== false),
    };
  });
  return out;
}
function drainNoteTypesFor(cfg) { return drainNoteTypesNorm((cfg || {}).noteTypes); }
/* 一张帖判出来的类型 → 这篇实际怎么跑：多类型取最严提店，动作 / 收人跟主类型；
   广告（静默）只收人，悲伤（完全不碰）不评也不收。类型为空＝按渠道老口径跑（返回 null）。 */
function drainNoteTypePlan(cfg, ids) {
  const types = drainNoteTypesFor(cfg);
  const list = (Array.isArray(ids) ? ids : [ids]).map(drainNoteTypeId)
    .filter((id, i, a) => id && a.indexOf(id) === i);
  if (!list.length) return null;
  const evals = list.map(id => Object.assign({ id: id }, types[id] || {}));
  const rateTypes = evals.filter(t => t.mode === 'rate');
  const blocked = evals.some(t => t.mode === 'block');
  const silent = !blocked && evals.some(t => t.mode === 'silent');
  const primary = rateTypes[0] || evals[0] || null;
  const store = rateTypes.length ? rateTypes.reduce((best, t) =>
    DRAIN_NOTE_STORE_CAP[t.store] < DRAIN_NOTE_STORE_CAP[best] ? t.store : best, 'store') : 'none';
  if (blocked) {
    const bt = evals.find(t => t.mode === 'block');
    return { ids: list, mode: 'block', act: '', store: 'none', collect: false, mainType: bt ? bt.id : '' };
  }
  if (silent) {
    const st = evals.find(t => t.mode === 'silent');
    return { ids: list, mode: 'silent', act: 'people', store: 'none', collect: st ? st.collect !== false : true, mainType: st ? st.id : '' };
  }
  return { ids: list, mode: 'rate', act: (primary && primary.act) || 'note', store: store, collect: primary ? primary.collect !== false : true, mainType: primary ? primary.id : '' };
}
/* 判帖提示词里的类型菜单：怎么认＋这张表怎么跑（动作 / 提店 / 收人）都摊给 AI，
   它判完类型就按同一张表写，不用再回来问一次 */
function drainNoteTypeMenuText(cfg) {
  const types = drainNoteTypesFor(cfg);
  return DRAIN_NOTE_TYPE_ORDER.map(id => {
    const d = DRAIN_NOTE_TYPE_DEF[id];
    const t = types[id];
    const run = t.mode === 'rate'
      ? ('评 · ' + DRAIN_NOTE_ACT[t.act] + ' · 提店到「' + DRAIN_PB_STORE[t.store] + '」 · ' + (t.collect ? '收人' : '不收人'))
      : (t.mode === 'silent' ? ('不评·只收人 · 不留言 · ' + (t.collect ? '收人' : '不收人')) : '完全不碰（不评也不收）');
    return '- ' + id + '（' + d.name + '）：' + d.judge + '｜' + run;
  }).join('\n');
}
const DRAIN_WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];   // 周一到周日（显示顺序）
/* 出词策略最长 160 字：这段要整句塞进 AI 找词的提示词，太长的提示词会被 AI 自己砍掉 */
function drainPbWordRuleNorm(raw) {
  return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 160);
}
function drainPbPlanNorm(raw, scenario) {
  const d = DRAIN_PB_DEFAULT[scenario] || { days: [], perDay: 3, store: 'none' };
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const days = Array.isArray(o.days)
    ? Array.from(new Set(o.days.map(Number).filter(x => Number.isFinite(x) && x >= 0 && x <= 6))).sort((a, b) => a - b)
    : d.days.slice();
  const per = parseInt(o.perDay, 10);
  const modeOpts = drainPbModeOptions(scenario);
  const mode = modeOpts[o.mode] ? o.mode : (DRAIN_PB_MODE_DEFAULT[scenario] || 'both');
  return {
    days,
    perDay: (Number.isFinite(per) && per >= 1) ? Math.min(20, per) : d.perDay,
    store: DRAIN_PB_STORE[o.store] ? o.store : d.store,
    city: DRAIN_PB_CITY[o.city] ? o.city : d.city,
    who: String(o.who || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    wordRule: drainPbWordRuleNorm(o.wordRule),
    mode,
    /* 老配置里的「跟账号资料」一律落到「不引导」：账号页那句承接不再参与评论策略 */
    guide: DRAIN_PB_GUIDE[o.guide] ? o.guide : 'none',
    entry: DRAIN_PB_ENTRY[o.entry] ? o.entry : (DRAIN_PB_ENTRY_DEFAULT[scenario] || 'follow'),
    /* 只收人＝清单是唯一产出，强制开 */
    collect: mode === 'people' ? true : (o.collect === false ? false : true),
  };
}
function drainPbPlan(cfg, scenario) {
  const p = ((cfg || {}).pbPlan || {})[scenario];
  return drainPbPlanNorm(p, scenario);
}
function drainPbOnDay(cfg, scenario, now) {
  const p = drainPbPlan(cfg, scenario);
  if (!p.days.length) return false;
  return p.days.indexOf(new Date(now || Date.now()).getDay()) >= 0;
}
function drainPbPerDay(cfg, scenario) { return drainPbPlan(cfg, scenario).perDay; }
/* 今天这个玩法该挑哪几个词：按词池顺序轮着来，一天换一批，几天转完一圈；词比一周的槽多，
   下一周接着上周停下的地方往下（2026-11-11 老板定：跨周接着轮，不再每周从头）。
   一周槽位 slots＝排几天 × 每天几个；start＝本周之前跑过的槽 + 本周第几次 × 每天几个。
   weekIdx 从 2026-01-05（周一）起数，按本地日期算，跨年也不跳回开头。 */
const DRAIN_ROT_ANCHOR = [2026, 0, 5];
function drainWeekIdx(t) {
  const d = new Date(t || Date.now());
  const noon = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  const dow = (noon.getDay() + 6) % 7;   // 0=周一
  const mon = new Date(noon.getFullYear(), noon.getMonth(), noon.getDate() - dow, 12);
  const an = new Date(DRAIN_ROT_ANCHOR[0], DRAIN_ROT_ANCHOR[1], DRAIN_ROT_ANCHOR[2], 12);
  return Math.round((mon - an) / 604800000);
}
/* 这个玩法这一圈轮不轮得完：一周几个槽、几个词、多出来几个排不上 */
function drainPbRotStat(cfg, scenario) {
  const p = drainPbPlan(cfg, scenario);
  if (DRAIN_PB_WORD.indexOf(scenario) < 0) return null;
  const N = ((cfg || {}).keywords || [])
    .filter(e => e && e.on !== false && drainWordTypeOn(e, scenario)).length;
  const slots = p.days.length * p.perDay;
  return {
    N: N,
    slots: slots,
    weeks: slots ? Math.ceil(N / slots) : 0,
    overflow: slots ? Math.max(0, N - slots) : 0,
    off: !p.days.length,
  };
}
function drainPbWordsFor(cfg, scenario, now) {
  const p = drainPbPlan(cfg, scenario);
  const t = now || Date.now();
  if (!p.days.length || p.days.indexOf(new Date(t).getDay()) < 0) return [];
  if (DRAIN_PB_WORD.indexOf(scenario) < 0) return [];
  const words = ((cfg || {}).keywords || [])
    .filter(e => e && e.on !== false && drainWordTypeOn(e, scenario))
    .map(e => e.k);
  if (!words.length) return [];
  const idx = DRAIN_WEEK_ORDER.indexOf(new Date(t).getDay());
  let occ = 0;
  for (let i = 0; i <= idx; i++) if (p.days.indexOf(DRAIN_WEEK_ORDER[i]) >= 0) occ++;
  const slots = p.days.length * p.perDay;
  const base = drainWeekIdx(t) * slots + Math.max(0, occ - 1) * p.perDay;
  const start = ((base % words.length) + words.length) % words.length;
  const n = Math.min(p.perDay, words.length);
  const out = [];
  for (let i = 0; i < n; i++) out.push(words[(start + i) % words.length]);
  return out;
}
/* 一次把 6 个走词的玩法今天挑的词算出来（队列派生用，别每格都重算一遍） */
function drainPbSelMap(cfg, now) {
  const m = {};
  DRAIN_PB_WORD.forEach(s => { m[s] = new Set(drainPbWordsFor(cfg, s, now)); });
  return m;
}
/* 整周预览（队列页周历用）：每个玩法每天跑哪几个词（大V 那一行看「盯的号」） */
function drainPbWeek(cfg, baseNow) {
  const b = new Date(baseNow || Date.now());
  const base0 = new Date(b.getFullYear(), b.getMonth(), b.getDate(), 12, 0, 0, 0);
  const dow = (base0.getDay() + 6) % 7;   // 0=周一
  const mon = new Date(base0.getFullYear(), base0.getMonth(), base0.getDate() - dow, 12, 0, 0, 0);
  const out = {};
  DRAIN_PB_ORDER.forEach(s => {
    out[s] = DRAIN_WEEK_ORDER.map((wd, i) => {
      const day = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i, 12, 0, 0, 0);
      return { wd, at: day.getTime(), words: drainPbWordsFor(cfg, s, day.getTime()) };
    });
  });
  return out;
}
/* ── 🗣 每个玩法一份获客话术（2026-11-02 老板定；当晚改「一段话」）：存在排班配置里，跟 pbPlan 一级 ──
   pbTalk[玩法] = { text, persona, at, v }
   text 就三行：① 评论区怎么搭话 ② 什么话算线索 ③ 他来找你后私信怎么接。
   persona 是生成时的人设快照：后来改了只在弹窗里轻提一句，不自动覆盖、不在行末标红。 */
const DRAIN_TALK_V = 11;
/* 6 个玩法的默认短话（2026-11-09 中性骨架）：只讲「什么算商机 / 怎么评 / 提不提自己」，
   不写任何行业词。行业口径只在铺底子时从行业模板抄进这个号的话术，铺过的不再被默认盖回去。 */
const DRAIN_TALK_DEFAULT = {
  latest: '本地说「哪家好、怎么选、有没有靠谱的」，就是商机。笔记下面留一句本地经验抢前排；评论区里回你的、跟着问的，顺着他的原话各回一句，不推销。不提店名，最多说自己是做这行的。',
  top: '评论区里认真问方法、问有没有用的人，就是商机。笔记下面只给一句内行判断，不长篇、不导流；谁在那条底下追问，就回一句他马上能试的。不报店名、不提产品；自己开店的情形、带过的人、做过的案例可以讲，只说真事。',
  local: '对方在挑、在比较、在问哪家靠谱，就是商机。笔记下面接一句判断型短评，回复区里同问的人逐个回；同行揽客的帖子只收人、不留言。只说自己是干这行的；不报店名、不提产品、不报价。',
  pain: '楼主在求助、避雷、问哪家靠谱，就是商机；回复区里同问的人也算。笔记下面先正面回答他问的那件事，再给一条能马上试的；评论区里谁追问就回谁。可以报自己是谁、开的哪家；价格不提。',
  cross: '别家评论区里有人在吐槽同一件难事（没人教、找不着门路、试了没用），这就是商机。笔记下面从别的角度搭一句，回复区里说同一困扰的逐个接一句本地经验。不报店名、不提自己卖什么；自己开店的经历和做过的案例可以讲，只说真事。',
  highv: '大V评论区里接话、问方法的人，就是商机。在大V笔记下面留一句「赞同＋本行视角补充」借势露脸；谁在那条底下回你、接着问，就回一句。可以说自己干这行，也能讲自己开店的情形或做过的案例；不报店名、不提产品。',
};
/* 上一版（v9）的默认话术：迁移时只换「那段话一字没改过」的号，老板手改过的、行业包带来的都不动 */
const DRAIN_TALK_V9 = {
  top: '评论区里认真问方法、问有没有用的人，就是商机。笔记下面只给一句内行判断，不长篇、不导流；谁在那条底下追问，就回一句他马上能试的。不提店名，也不说自己是谁。',
  local: '对方在挑、在比较、在问哪家靠谱，就是商机。笔记下面接一句判断型短评，回复区里同问的人逐个回；同行揽客的帖子只收人、不留言。可以说自己干这行，店名等对方明确问起再报。',
  pain: '楼主在求助、避雷、问哪家靠谱，就是商机；回复区里同问的人也算。笔记下面先正面回答他问的那件事，再给一条能马上试的；评论区里谁追问就回谁。可以说自己干这行，店名等对方明确问起再报。',
  cross: '别家评论区里有人在吐槽同一件难事（没人教、找不着门路、试了没用），这就是商机。笔记下面从别的角度搭一句，回复区里说同一困扰的逐个接一句本地经验。不提店名，最多说自己是做这行的。',
  highv: '大V评论区里接话、问方法的人，就是商机。在大V笔记下面留一句「赞同＋本行视角补充」借势露脸；谁在那条底下回你、接着问，就回一句，只说自己是干这行的。不主动报店名，往下走私信。',
};
/* 「捞谁·为了什么」的内置口径（2026-11-09）：原「评论目的 6 选 1」并进玩法配置的这一格。
   只写「找什么样的人、为了什么」，不写行业词；这个号自己写了就用自己那段。 */
const DRAIN_PB_WHO_DEFAULT = {
  latest: '在本地泛搜的笔记底下，找随口问「哪家好 / 怎么选」、还没想过去比较的本地人；先占个前排混个脸熟，别急着成交。',
  top: '在全国热帖的笔记和评论区里，找认真问方法、问有没有用的人；借热帖露一次脸，让同话题的人记住有你这么个懂行的。',
  local: '在同城本行的笔记和评论区里，找正在挑、正在比、问哪家靠谱的本地人；先给一条判断，把同城的机会接住。',
  pain: '在求助 / 避雷 / 问哪家靠谱的帖子里，找楼主和评论区里同问的人；先帮他解决问题，再留个印象。',
  cross: '在别家行业的笔记评论区里，找吐槽同一件难事（没人教、找不着门路、试了没用）的本地人；从那个困扰切进来，不暴露自己在卖什么。',
  rival: '在竞对的评论区里，找露出真实需求的精准顾客；一个字都不留言，只收进清单去私信。',
  highv: '在头部博主的笔记和评论区里，找接话、追问方法的人；用「赞同＋本行视角」露脸，接住往下问的人。',
};
/* 这一玩法「捞谁·为了什么」：自己写过优先，没写用内置那句 */
function drainPbWho(cfg, scenario) {
  const id = drainScenarioId(scenario);
  const own = String((drainPbPlan(cfg, id).who) || '').trim();
  return own || DRAIN_PB_WHO_DEFAULT[id] || '';
}
function drainWhoBlock(cfg, scenario) {
  const who = drainPbWho(cfg, scenario);
  return who ? '【这个玩法捞谁·为了什么】\n' + who : '';
}
/* ── 📦 行业口径包（2026-11-04 建，2026-11-09 收口）：只是一个模板。
   铺底子 / 第一次读配置时把里面的文案、提店说法、不留言词表抄进这个号自己的配置（pbSeed / pbPrompt /
   pbDm / pbHint / pbTip / pbStoreRules / pbSolicit / pbLabel），之后跑的时候只读配置，再也不读包。 */
function drainPackOf(cfg) {
  const p = (cfg || {}).pbPack;
  return (p && typeof p === 'object' && !Array.isArray(p)) ? p : null;
}
/* 铺底子时从包抄进配置的那几句（talk / tag / desc / wordRule）；跑时和界面都只读这里 */
function drainPbCopy(cfg, id, field) {
  const one = (((cfg || {}).pbSeed || {})[drainScenarioId(id)] || {});
  return String(one[field] || '').trim();
}
/* 把包抄成配置字段（只抄一次；之后改包不影响这个号）。返回是否抄了 */
function drainSeedFromPack(cfg) {
  const pack = drainPackOf(cfg);
  if (!pack) return false;
  const needSeed = !cfg.pbSeed;
  if (cfg.pbSeedFromPack && !needSeed) return false;
  const pb = (pack.pb && typeof pack.pb === 'object') ? pack.pb : {};
  if (needSeed) {
    const seed = {};
    Object.keys(pb).forEach(id => {
      const one = pb[id] || {};
      const keep = {};
      ['talk', 'tag', 'desc', 'wordRule'].forEach(k => { if (one[k]) keep[k] = String(one[k]); });
      if (Object.keys(keep).length) seed[id] = keep;
    });
    if (Object.keys(seed).length) cfg.pbSeed = seed;
  }
  if (cfg.pbSeedFromPack) return true;
  const prompt = {}, dm = {}, hint = {}, tip = {};
  Object.keys(pb).forEach(id => {
    const one = pb[id] || {};
    if (one.system || one.user) prompt[id] = { system: String(one.system || ''), user: String(one.user || '') };
    if (one.dm) dm[id] = String(one.dm);
    if (one.hint) hint[id] = String(one.hint);
    if (one.pbTip) tip[id] = String(one.pbTip);
  });
  if (Object.keys(prompt).length) cfg.pbPrompt = Object.assign({}, cfg.pbPrompt, prompt);
  if (Object.keys(dm).length) cfg.pbDm = Object.assign({}, cfg.pbDm, dm);
  if (Object.keys(hint).length) cfg.pbHint = Object.assign({}, cfg.pbHint, hint);
  if (Object.keys(tip).length) cfg.pbTip = Object.assign({}, cfg.pbTip, tip);
  const sr = pack.storeRules;
  if (sr && typeof sr === 'object') cfg.pbStoreRules = Object.assign({}, sr);
  if (Array.isArray(pack.solicit)) cfg.pbSolicit = pack.solicit.slice();
  if (pack.label) cfg.pbLabel = String(pack.label);
  cfg.pbSeedFromPack = true;
  return true;
}
/* 这份包是卖什么的（排班卡标题那行）；铺过就存在 pbLabel */
function drainPackLabel(cfg) {
  return String((cfg || {}).pbLabel || '').trim();
}
/* 某一玩法的「跑法」一句话（列表 hover、六类怎么评） */
function drainPbTip(id, cfg) {
  return String(((cfg || {}).pbTip || {})[drainScenarioId(id)] || '').trim()
    || (DRAIN_PLAYBOOK[drainScenarioId(id)] || {}).tip || '';
}
/* 「这种帖子不留言」的词表：内置那套 ＋ 铺底子时抄进来的补充词 */
function drainSolicitWords(cfg) {
  const extra = (cfg || {}).pbSolicit;
  if (!Array.isArray(extra)) return DRAIN_SOLICIT_WORDS;
  return DRAIN_SOLICIT_WORDS.concat(extra.map(x => String(x || '').trim()).filter(Boolean));
}
/* 哪一行的话术编辑块是展开的（整页重绘后还留着，比如点了周几） */
let _drainTalkOpen = null;
/* 周日历看的是本周还是下周（0＝本周，1＝下周）：只影响预览，不影响真跑 */
let _drainWeekOff = 0;
/* 老 v8 的四步＋示范 → 拼成三行；只在读老数据时用 */
function _drainTalkFromSteps(raw) {
  const st = (raw && raw.steps && typeof raw.steps === 'object') ? raw.steps : null;
  if (!st) return '';
  const sm = (raw.sample && typeof raw.sample === 'object') ? raw.sample : {};
  const l1 = [st.who, st.open].map(x => String(x || '').trim()).filter(Boolean).join(' ');
  const l2 = String(st.lead || '').trim();
  const l3 = String(st.deliver || '').trim();
  const demo = String(sm.a || '').trim();
  return [l1, l2, l3 + (demo ? '（示范：' + demo + '）' : '')].filter(Boolean).join('\n');
}
function drainPbTalkNorm(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const text = (String(raw.text || '').trim() || _drainTalkFromSteps(raw)).slice(0, 1600);
  if (!text) return null;
  return {
    text: text,
    persona: String(raw.persona || '').trim().slice(0, 800),
    at: Number(raw.at) || 0,
    v: DRAIN_TALK_V,
  };
}
/* 同行/竞对已并入同城本业（v9）：老 rival 话术一律读本业那份 */
function _drainTalkKey(scenario) {
  return (String(scenario || '') === 'rival') ? 'local' : drainScenarioId(scenario);
}
function drainPbTalkOf(cfg, scenario) {
  const t = (((cfg || {}).pbTalk) || {})[_drainTalkKey(scenario)];
  return (t && typeof t === 'object' && String(t.text || '').trim()) ? t : null;
}
/* 给评论 / 私信提示词当参考的一段；没有话术就返回空串 */
function drainTalkBlock(t) {
  if (!t || !t.text) return '';
  return '【这个玩法的口吻参考（只学怎么说；提不提自己、能不能报店名，一律按这一段之外的「能提自己到哪一步」，这段里相反的话不算；找谁按「捞谁·为了什么」那格，别重复说）】\n' + String(t.text).trim().slice(0, 1200);
}
/* 📈 复盘采纳后补进提示词的那几句（2026-11-08）：存在这个号自己的获客配置里（cfg.pbExtra），
   不动内置提示词、也不动行业包。_all＝整条获客线都加；玩法 id＝只加那一个玩法。 */
function drainPbExtraBlock(cfg, scenario) {
  const ex = cfg && cfg.pbExtra;
  if (!ex || typeof ex !== 'object' || Array.isArray(ex)) return '';
  const all = String(ex._all || '').trim();
  const one = String(ex[drainScenarioId(scenario)] || '').trim();
  return [all, one].filter(Boolean).join('\n');
}

/* ── 👁 看提示词（2026-11-08）──
   每个玩法 × 每个动作只留最近一次：拼给 AI 的 system / user 原文、AI 原话、实际发出去的字、
   跳过原因、耗时 / 字数 / token。放这一层＝网页那台和客户机那只手同一份口径。
   试拼只拼不调模型、不计费，也不覆盖「最近一次」。 */
const DRAIN_PROMPT_KEY = 'drain_prompt_last';
const DRAIN_PROMPT_ACTS = [
  { id: 'note', label: '笔记下评一句' },
  { id: 'finder', label: '回评论区那句' },
  { id: 'dm', label: '私信开头' },
];
function drainPromptAct(id) {
  return DRAIN_PROMPT_ACTS.some(function (a) { return a.id === id; }) ? id : 'note';
}
function drainPromptSlot(scenario, act) {
  return drainScenarioId(scenario) + '.' + drainPromptAct(act);
}
function drainPromptCut(v, n) {
  const s = String(v == null ? '' : v);
  const max = Math.max(1, Math.floor(Number(n) || 0));
  return s.length > max ? s.slice(0, max) + '…' : s;
}
/* 记「这一趟真的发出去的那份」；只有跳过、没有 prompt 的也记一笔（跳过原因要看得见） */
async function drainPromptSave(rec) {
  if (!rec || (!rec.sys && !rec.skip)) return false;
  try {
    const key = DRAIN_PROMPT_KEY;
    const d = await chrome.storage.local.get(key);
    const old = d && d[key];
    const all = (old && typeof old === 'object' && !Array.isArray(old)) ? old : {};
    const used = String(rec.used || '');
    all[drainPromptSlot(rec.scenario, rec.act)] = {
      at: Date.now(),
      scenario: drainScenarioId(rec.scenario),
      act: drainPromptAct(rec.act),
      sys: String(rec.sys || ''),
      user: String(rec.user || ''),
      raw: drainPromptCut(rec.raw, 4000),
      used: drainPromptCut(used, 2000),
      skip: drainPromptCut(rec.skip, 300),
      ms: Math.max(0, Math.floor(Number(rec.ms) || 0)),
      chars: used.length,
      tokensIn: Math.max(0, Math.floor(Number(rec.tokensIn) || 0)),
      tokensOut: Math.max(0, Math.floor(Number(rec.tokensOut) || 0)),
      model: String(rec.model || ''),
      material: (rec.material && typeof rec.material === 'object') ? rec.material : null,
    };
    await chrome.storage.local.set({ [key]: all });
    return true;
  } catch (_) { return false; }
}
/* 料先收小：一篇笔记 + 前 8 条评论、每条 200 字，够复现、不撑爆存储 */
function drainPromptMaterial(act, data) {
  const d = data || {};
  if (act === 'dm') {
    const p = d.person || d || {};
    const src = p.source || {};
    const pf = p.profile || {};
    return {
      person: {
        nickname: drainPromptCut(p.nickname, 40),
        source: {
          comment: drainPromptCut(src.comment, 300),
          noteTitle: drainPromptCut(src.noteTitle, 120),
          scenario: drainPromptCut(src.scenario, 20),
        },
        profile: {
          tags: (Array.isArray(pf.tags) ? pf.tags : []).slice(0, 8).map(function (x) { return drainPromptCut(x, 20); }),
          needs: drainPromptCut(pf.needs, 200),
          painPoints: drainPromptCut(pf.painPoints, 200),
          dmAngle: drainPromptCut(pf.dmAngle, 200),
        },
      },
    };
  }
  return {
    title: drainPromptCut(d.title || d.noteTitle, 120),
    author: drainPromptCut(d.author || d.noteAuthor, 40),
    description: drainPromptCut(d.description || d.noteContent, 800),
    comments: (Array.isArray(d.comments) ? d.comments : []).slice(0, 8).map(function (c) {
      return {
        author: drainPromptCut(c && c.author, 30),
        content: drainPromptCut(c && c.content, 200),
        location: drainPromptCut(c && c.location, 20),
      };
    }),
  };
}
/* 试拼的料：没跑过的号拿这份走一遍，只看拼装对不对 */
function drainPromptSample(act) {
  if (act === 'dm') {
    return drainPromptMaterial('dm', {
      person: {
        nickname: '小城店主',
        source: {
          comment: '店里想在网上露个脸，不知道从哪下手，怕花了钱没效果。',
          noteTitle: '实体店想做线上，先做哪一步',
          scenario: 'pain',
        },
        profile: {
          tags: ['本地店主', '没做过线上'],
          needs: '想知道先从哪里开始、预算不高能做什么',
          painPoints: '怕被外包忽悠，花冤枉钱',
          dmAngle: '先给一条能马上试的，不急着卖方案',
        },
      },
    });
  }
  return drainPromptMaterial(act, {
    title: '实体店想做线上，先做哪一步',
    author: '小城店主',
    description: '店里客流一般，想在网上多露个脸。有人说先做内容，有人说先投流，不知道先做哪一步，预算也不多，怕花了钱没效果。',
    comments: [
      { author: '街角咖啡', content: '我也试过，后来还是先把店里的账号做起来了。', location: '广东' },
      { author: '小城店主', content: '那你们一开始都发了些什么？花了多少钱？', location: '广东' },
      { author: '阿良', content: '同问，本地有没有靠谱的能帮忙看看的？', location: '广东深圳' },
    ],
  });
}
/* 把 system 拆成来源段：只按已知的块开头切；切不出来就整段显示——不猜、不乱标 */
const DRAIN_PROMPT_MARKS = [
  { key: '【你是谁】', label: '你是谁', tone: 'tpl' },
  { key: '【这个账号是谁】', label: '你是谁', tone: 'tpl' },
  { key: '【这一趟要干什么', label: '这一趟要干什么', tone: 'play' },
  { key: '【这一趟怎么做', label: '这一趟怎么做', tone: 'play' },
  { key: '【能提自己到哪一步', label: '能提自己到哪一步', tone: 'rule' },
  { key: '【话术库', label: '话术库', tone: 'rule' },
  { key: '【红线', label: '红线', tone: 'rule' },
  { key: '【这个玩法的口吻参考', label: '口吻参考', tone: 'play' },
  { key: '【这个号复盘后补的规矩', label: '复盘补的规矩', tone: 'extra' },
];
function drainPromptSegments(text) {
  const s = String(text || '');
  if (!s.trim()) return [];
  const hits = [];
  DRAIN_PROMPT_MARKS.forEach(function (m) {
    let i = s.indexOf(m.key);
    while (i >= 0) { hits.push({ i: i, label: m.label, tone: m.tone }); i = s.indexOf(m.key, i + 1); }
  });
  hits.sort(function (a, b) { return a.i - b.i; });
  const out = [];
  let pos = 0, label = '提示词模板', tone = 'tpl';
  hits.forEach(function (h) {
    if (h.i < pos) return;
    if (h.i > pos) {
      const body = s.slice(pos, h.i).replace(/^\n+/, '').trim();
      if (body) out.push({ label: label, tone: tone, text: body });
    }
    pos = h.i; label = h.label; tone = h.tone;
  });
  const tail = s.slice(pos).replace(/^\n+/, '').trim();
  if (tail) out.push({ label: label, tone: tone, text: tail });
  return out;
}

/* ═══ 讲法八式 · 开始（离线自测按这两行标记截取，别改这两行） ═══
   2026-11-07：重复的病根是“只讲专业判断 + 抄同一个检查点”。
   这里只描述“怎么讲”，不写任何行业词：对象称呼、行业词、真案例、真数字，
   一律从人设 / 知识库 / 行业包里取；库里没有就不许编。 */
const TALK_STYLES = [
  { id: 'empathy',  name: '共情接住', w: 25, need: '情绪', fallback: '', inst: '先接住对方的情绪，再轻轻给一句做法。' },
  { id: 'case',     name: '案例带人', w: 25, need: '一个真实的人或事', fallback: '退成泛例', inst: '用一个具体的人或事带出做法，优先人设里写过的真事。' },
  { id: 'method',   name: '方法拆解', w: 15, need: '一条能拆的流程', fallback: '退成判断、只给一个起点', inst: '把怎么做拆成一两步马上能照做的动作，用「先…再…」。' },
  { id: 'data',     name: '数据实证', w: 15, need: '真数字或标准', fallback: '跳过这种讲法', inst: '只用知识库 / 人设里原样写着的数字、标准、政策。' },
  { id: 'judge',    name: '专业判断', w: 10, need: '一条能核对的标准', fallback: '', inst: '给一条内行才说得出的判断或能核对的标准。' },
  { id: 'pitfall',  name: '避坑提醒', w: 5,  need: '一个真坑', fallback: '退成判断', inst: '说一个人设或知识库里真有的坑，讲清怎么绕。' },
  { id: 'contrast', name: '对比取舍', w: 5,  need: '两个方案各适合谁', fallback: '退成判断', inst: '两个做法客观摆开，讲清各自适合谁、代价是什么。' },
  { id: 'chat',     name: '随口搭话', w: 0,  need: '闲聊', fallback: '', inst: '像本地人随口接一句，短、松，只用于闲聊夸奖。' },
];

function talkStyleCatalog() {
  return TALK_STYLES.map(s => '· ' + s.name + '：' + s.inst).join('\n')
    + '\n没有对应真料就退成专业判断。\n同一批里同一种说法最多 2 条。';
}

/* ═══ 讲法八式 · 结束 ═══ */

/* 这一玩法的评论策略正文（2026-11-09）：①②两条评论逐字共用；提店那句由 drainStoreRule 给，这里不重复。
   引导只认玩法配置，老配置里的「跟账号资料」按「不引导」走。 */
function drainStrategyRule(cfg, scenario, act) {
  const p = drainPbPlan(cfg, scenario);
  /* act 传进来＝按「笔记类型表」判出的动作走（2026-11-12）；不传还是按渠道老口径 */
  const mode = (act === 'note' || act === 'both' || act === 'reply' || act === 'people') ? act : p.mode;
  const L = [];
  if (mode === 'note') L.push('这篇笔记只做一件事：在笔记下面评一句，评论区里谁接话都不回。');
  else if (mode === 'reply') L.push('这篇笔记不在下面露面：一条一级评论都不发，只回评论区里已经接话的人。');
  else if (mode === 'people') L.push('这一趟只收人：公开评论区一个字都不发，只把有商机的人收进清单，等对方来私信。');
  else L.push('这篇笔记要做两件事：笔记下面评一句，评论区里谁接话就回谁。');
  if (mode !== 'people') {
    L.push('怎么开口：' + ({
      follow: '先接住对方那句话，表示有同感，再往下说。',
      judge: '直接给一个内行判断，别绕弯。',
      ask: '用一个对方好接的问题开口。',
      story: '用自己碰到过的一个具体例子开口。',
      light: '只回一两个词、一句话，不展开。',
    })[p.entry]);
  }
  L.push('引导：' + ({
    none: '一句引导都不许有，讲完就收：别让人私信、别让人看主页、也别说到店。',
    dm: '最多一句「拿不准就私信我」这种站内话。',
    home: '最多一句「细节在我主页 / 置顶那篇」这种站内话。',
    visit: '评论里一律不写门店名和地址；只有对方私信追问时，才说可以来店里。',
  })[p.guide] || '一句引导都不许有，讲完就收。');
  return L.join('\n');
}
/* 引导那句：只由玩法这一列生成，账号资料里那句承接不再参与评论 */
function drainGuideByPlan(cfg, scenario) {
  const p = drainPbPlan(cfg, scenario);
  return ({
    none: '这次不引导：讲完就收，别让人私信、别让人看主页、也别说到店。',
    dm: '拿不准就私信我（站内私信，不出现站外联系方式）。',
    home: '细节在我主页 / 置顶那篇。',
    visit: '评论里不提门店和地址；只有对方私信追问时，才说可以来店里。',
  })[p.guide] || '这次不引导：讲完就收，别让人私信、别让人看主页、也别说到店。';
}
/* 同一篇笔记两步共用一段评论策略（2026-11-04）：「在笔记下面评一句」走 drainComment、本来就带这个玩法的
   提店口径和话术；「回评论区那句」走商机挖掘那条提示词，它不知道自己是哪个玩法捞出来的，
   这里按这一趟的玩法把同一段补进去。手动扫描（没有玩法）返回空串＝维持原样。 */
async function drainReplyStrategyBlock(scenario, opt) {
  const id = String(scenario || '');
  if (!id || id === 'daily' || typeof drainGetScanCfg !== 'function') return '';
  let cfg = null;
  try { cfg = await drainGetScanCfg(); } catch (_) { return ''; }
  const o = opt || {};
  const _pl = drainPbPlan(cfg, id);
  /* 没设城市＝判断不了同城，只能不提自己（这是事实前提，不是另一个策略来源） */
  const store = o.noCity ? 'none' : _pl.store;
  const talk = drainTalkBlock(drainPbTalkOf(cfg, id));
  let block = '\n\n【这一趟怎么做（跟「在笔记下面评一句」共用）】\n'
    + drainStrategyRule(cfg, id) + '\n'
    + (talk || '（这个玩法还没写话术：按人设自然接话）');
  block += '\n\n' + drainStoreRule(store, cfg, { guide: _pl.guide });
  /* 📈 复盘里采纳过的规矩：只当话术参考，追加在最后 */
  const pbExtra = drainPbExtraBlock(cfg, id);
  if (pbExtra) block += '\n\n【这个号复盘后补的话术参考（策略请去玩法配置改）】\n' + pbExtra;
  return block;
}

/* 给 AI 写这份话术的一句话玩法说明（2026-11-02）：按玩法换角度，六套共用、不写行业词。
   2026-11-09：行业口径只来自铺底子时抄进来的 cfg.pbHint，不再读包。 */
function drainPbTalkHint(id, cfg) {
  const own = String(((cfg || {}).pbHint || {})[drainScenarioId(id)] || '').trim();
  if (own) return own;
  return {
    latest: '本地泛搜索：找还没想过这件事的本地人。第一句说本地的实情，不提产品、不提价格。',
    top: 'TOP搜索：写全国热评长期占位。只给内行判断，不导流。',
    local: '同城本业：对方已经在挑、在比较。给一条判断，不贬低同行、不报价；同行揽客的帖子不留言，只收人去私信。',
    pain: '咨询帖：对方在求助 / 避雷。先正面回答他问的那件事，再给一条能马上试的。',
    cross: '同城异业：从别家行业的评论区切进来。别暴露职业，只给一条本地经验。',
    rival: '同行／竞对：不在评论区留言，第 4 步直接当私信开场；绝不提在哪看到他。',
    highv: '大V：在头部博主笔记下借势。先赞同博主补一句本行视角，评论区里回追问的人，不抢人。',
  }[drainScenarioId(id)] || '';
}

/* 今天跑不跑这个词：所属玩法里，有任意一个今天轮到它 */
function drainWordOnDay(entry, cfg, now) {
  const sel = drainPbSelMap(cfg, now);
  return DRAIN_PB_WORD.some(s => sel[s] && sel[s].has(entry && entry.k));
}
/* 配置指纹（2026-10-29；2026-11-04 改成「对不上就重排今天」）：锁定今天这份清单时一起记下，
   之后配置一改，今天这份当场按新配置重排（跑完的不重跑）。只进指纹的东西＝会影响跑哪些格：平台、城市、词/勾/周几、盯的账号、整列节奏 */
function drainCfgSig(cfgIn) {
  const cfg = _drainNormalizeScanCfg(cfgIn || {});
  const kw = (cfg.keywords || []).map(e => [
    e.k,
    e.on !== false ? '1' : '0',
    DRAIN_TYPE_META.map(m => drainTypeMode(e, m.scenario, cfg).mode).join(','),
  ].join('~')).join('|');
  const ac = (cfg.accounts || []).map(a => [a.k, a.on !== false ? '1' : '0', a.scenario || ''].join('~')).join('|');
  // 玩法排班（周几 / 每天挑几个 / 提店口径）一改，今天这份清单就该提示「明天按新的排」
  const pb = DRAIN_PB_ORDER.map(s => {
    const p = drainPbPlan(cfg, s);
    return s + ':' + (p.days.length ? p.days.join('-') : '不跑') + ':' + p.perDay + ':' + p.store;
  }).join('|');
  return [drainCfgPlats(cfg).join(','), String(cfg.city || '').trim(), kw, ac, pb].join('#');
}
/* 词池里出现过的批次名（含默认），保持录入顺序去重；cfg.batches 是用户显式建过的批次 */
function drainBatchesOf(pool, cfg) {
  const out = [DRAIN_DEFAULT_BATCH];
  ((cfg && cfg.batches) || []).forEach(n => {
    n = String(n || '').trim();
    if (n && out.indexOf(n) < 0 && n !== DRAIN_DEFAULT_BATCH) out.push(n);
  });
  (Array.isArray(pool) ? pool : []).forEach(e => {
    const n = drainBatchName(e);
    if (out.indexOf(n) < 0) out.push(n);
  });
  return out;
}

/* ── 盯的账号（👤）：{ k:主页链接, name:昵称, on:启用, scenario:'highv'|'rival' } ──
   盯人走主页：进他的个人主页扒最近的笔记，不是拿名字去搜（搜名字会漏会串）。 */
function _drainAcctEntry(a) {
  if (!a) return null;
  if (typeof a === 'string') { const k = a.trim(); return k ? { k, name: '', on: true, scenario: 'highv' } : null; }
  const k = String(a.k || a.url || a.term || '').trim();
  if (!k) return null;
  const sc = drainScenarioId(a.scenario || 'highv');
  const e = { k, name: String(a.name || '').trim(), on: a.on !== false, scenario: sc === 'rival' ? 'rival' : 'highv' };
  // 这个号单独设的节奏（小时）：不写＝跟随整列 acctRun
  const h = Number(a.hours) || 0;
  if (h > 0) e.hours = h;
  return e;
}
function drainAccountLabel(ac) {
  if (!ac) return '';
  return ac.name || _drainProfileId(ac.k) || ac.k;
}
/* 主页链接的稳定指纹：/user/profile/<id>。同一博主的 xsec_token 会变，
   身份/去重都认这个 id，别拿整条 URL 当身份（URL 本身要留着，带 token 才打得开） */
function _drainProfileId(u) {
  const m = String(u || '').match(/\/user\/profile\/([^/?#]+)/);
  return m ? m[1] : '';
}
/* 「刚起来」的三条线（2026-11-08）：默认 发布≤6小时 / 赞<200 / 评论<20，可在「🎯 玩法配置」顶部改 */
function drainFreshCfg(cfg) {
  const raw = (cfg && cfg.freshCfg && typeof cfg.freshCfg === 'object') ? cfg.freshCfg : {};
  const num = (v, d) => (v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    hours: Math.min(168, Math.max(1, num(raw.hours, 6))),
    likes: Math.max(0, num(raw.likes, 200)),
    comments: Math.max(0, num(raw.comments, 20)),
  };
}
/* 判断一篇笔记是不是「刚起来」：发布时间、赞、评论三条同时成立才算；
   任何一项读不到就 known=false / fresh=false，绝不猜。 */
function drainJudgeFresh(meta, cfg) {
  const t = drainFreshCfg(cfg);
  const at = Number(meta && meta.publishAt) || 0;
  const likesRaw = meta && meta.likes;
  const commentsRaw = meta && (meta.commentsCount != null ? meta.commentsCount : meta.comments);
  const likesKnown = likesRaw != null && Number.isFinite(Number(likesRaw));
  const commentsKnown = commentsRaw != null && Number.isFinite(Number(commentsRaw));
  const likes = likesKnown ? Number(likesRaw) : null;
  const comments = commentsKnown ? Number(commentsRaw) : null;
  const base = { known: at > 0, fresh: false, hours: null, likes, comments, thresholds: t, why: '' };
  if (!(at > 0)) return Object.assign(base, { why: '发布时间没读到，不判断' });
  const hours = (Date.now() - at) / 3600000;
  base.hours = hours;
  if (hours < 0) return Object.assign(base, { why: '发布时间比现在还晚，不判断' });
  if (!likesKnown || !commentsKnown) return Object.assign(base, { why: '赞/评论数没读全，不判断' });
  if (hours > t.hours) return Object.assign(base, { why: '发布已 ' + hours.toFixed(1) + ' 小时，超过 ' + t.hours + ' 小时' });
  if (likes >= t.likes) return Object.assign(base, { why: '赞 ' + likes + ' 已到 ' + t.likes });
  if (comments >= t.comments) return Object.assign(base, { why: '评论 ' + comments + ' 已到 ' + t.comments });
  return Object.assign(base, { fresh: true, why: '刚起来：' + hours.toFixed(1) + ' 小时 / 赞 ' + likes + ' / 评论 ' + comments });
}
/* 作者是不是「👤 盯的账号」里的号：只认名单；先按主页 ID 对，读不到 ID 才按昵称精确对。
   认不出来就返回 null——不拿「看起来像」的线索自动绑定。 */
function drainMatchWatchAccount(cfg, authorUid, authorName) {
  const uid = String(authorUid || '').trim();
  const norm = (s) => String(s || '').replace(/[\s@·.。，,]/g, '').toLowerCase();
  const name = norm(authorName);
  const list = ((cfg && cfg.accounts) || []).filter(a => a && a.k && a.on !== false);
  if (uid) {
    for (const a of list) {
      const id = _drainProfileId(a.k);
      if (id && id === uid) return { scenario: a.scenario === 'rival' ? 'rival' : 'highv', label: drainAccountLabel(a), account: a, by: 'id' };
    }
    return null;
  }
  if (!name) return null;
  for (const a of list) {
    if (a.name && norm(a.name) === name) return { scenario: a.scenario === 'rival' ? 'rival' : 'highv', label: drainAccountLabel(a), account: a, by: 'name' };
  }
  return null;
}
/* 这一篇最终做什么：评笔记 / 回评论 / 只收人 / 跳过。
   玩法配置的评论动作是上限；笔记结论（AI 判断＋刚起来）只能在上限内收窄，不能越权。
   返回 { action, text, reason }，action ∈ grab|comment|reply|collect|skip */
function drainDecideNote(o) {
  o = o || {};
  if (o.forceAction) return { action: o.forceAction, text: o.forceText || o.forceAction, reason: o.forceReason || '' };
  const matched = o.matched || '';
  const v = o.verdict || '';
  const mode = o.mode || '';
  const hasProsp = !!o.hasProspects;
  const collect = o.collect !== false;
  const allowNote = !mode || mode === 'note' || mode === 'both';
  const allowReply = !mode || mode === 'both' || mode === 'reply';
  // ① 竞对：整篇只蹲人，不评论
  if (matched === 'rival') {
    if (hasProsp && collect) return { action: 'collect', text: '只蹲人：不评论，把评论区的人收进清单', reason: '竞对笔记' };
    return { action: 'skip', text: '只蹲人：这篇没有可收的人', reason: '竞对笔记' };
  }
  // ② AI 硬拦：招聘/纯广告/纠纷/悲伤/纯带货 → 整篇跳过，不露面也不收人
  if (v === 'blocked' || o.typeMode === 'block') return { action: 'skip', text: '跳过：这类帖完全不碰', reason: o.blockReason || '悲伤 / 纠纷：不评也不收' };
  // ②' 笔记类型表判成「不评·只收人」（广告招生）：一条不留言，评论区里的人照收
  if (o.typeMode === 'silent') {
    if (collect && hasProsp) return { action: 'collect', text: '只收人：不留言，把评论区的人收进清单', reason: '广告招生帖 · 只收人' };
    return { action: 'skip', text: '跳过：广告招生帖不留言', reason: '广告招生帖 · 这一篇没有可收的人' };
  }
  // ③ AI 没回来：按玩法原来的跑法（评笔记那条照发，不抢首评）
  if (o.fallback) {
    if (allowNote) return { action: 'comment', text: '按原玩法评一句', reason: 'AI 笔记判断没回来，按玩法原样处理' };
    if (allowReply && hasProsp) return { action: 'reply', text: '只回评论区', reason: 'AI 笔记判断没回来，按玩法原样处理' };
    if (collect && hasProsp) return { action: 'collect', text: '只收人', reason: 'AI 笔记判断没回来，按玩法原样处理' };
    return { action: 'skip', text: '跳过', reason: 'AI 笔记判断没回来，玩法也没安排动作' };
  }
  // ④ 大V：整篇按大V跑法；只回在你那条评论下接话的人（由上层筛人）
  if (matched === 'highv') {
    // 评不评笔记，跟接我话的人回不回是两件事：不评笔记时，有人接着聊照样回
    if (allowNote) {
      if (v === 'grab' && o.fresh) return { action: 'grab', text: '抢首评（大V写法）', reason: '刚起来＋值得首评' };
      if (v === 'grab' || v === 'worth') return { action: 'comment', text: '评一句（大V写法）', reason: '值得补一句' };
    }
    if (allowReply && hasProsp) return { action: 'reply', text: '不评笔记，只回接我话的人', reason: allowNote ? '这篇不值得评，但有人接着聊' : '玩法配的是「不评笔记」' };
    return { action: 'skip', text: '跳过：大V这篇不值得露面', reason: 'AI 判定没讨论空间' };
  }
  // ⑤ 普通笔记：先看笔记结论，再按玩法上限落到动作
  if (v === 'grab' && o.fresh && allowNote) return { action: 'grab', text: '抢首评', reason: '刚起来＋值得首评' };
  if ((v === 'grab' || v === 'worth') && allowNote) return { action: 'comment', text: '在笔记下评一句', reason: '值得补一句' };
  if (allowReply && hasProsp) return { action: 'reply', text: '只回评论区', reason: '笔记不评，评论区有人' };
  if (collect && hasProsp) return { action: 'collect', text: '只收人', reason: '不评论，收进清单' };
  return { action: 'skip', text: '跳过', reason: '这篇没有可做的事' };
}
/* 盯的账号到没到点：只看行级开关 + 这一列自己的节奏（不受词池那套「格」约束，
   也不共用词池的 typeRun——「拿竞品名去搜」和「进他主页扒」是两件事） */
function drainAccountState(ac, cfg, now) {
  now = now || Date.now();
  const off = { mode: 'off', due: false, lastAt: 0, nextAt: 0, hours: 0 };
  if (!ac || !ac.k || ac.on === false) return off;
  const g = (((cfg || {}).acctRun) || {})[ac.scenario] || DRAIN_ACCT_RUN_DEFAULT[ac.scenario];
  let m = _drainRunNorm(g);
  // 这个号自己设了小时数 → 以它为准（弹窗里「跟随整列 / 每 N 小时」那一项）
  if (m.mode !== 'off' && Number(ac.hours) > 0) m = { mode: 'interval', hours: Math.max(1, Number(ac.hours)) };
  if (m.mode === 'off') return off;
  const lastAt = Number(((((cfg || {}).kwRuns) || {})[ac.k] || {})[ac.scenario]) || 0;
  if (m.mode === 'each') return { mode: 'each', due: true, lastAt, nextAt: 0, hours: 0 };
  // 从没盯过 → 现在就该盯（同 drainPassState：nextAt 留 0，别算出 1970 年）
  const nextAt = lastAt ? lastAt + m.hours * 3600e3 : 0;
  return { mode: 'interval', hours: m.hours, due: !lastAt || now >= nextAt, lastAt, nextAt };
}

/* 词 × 玩法这一格跑不跑：没写过＝不跑（v7 起词必须显式挂玩法；老数据在迁移里落成显式勾选）。
   兼容旧数据的对象写法（{mode:'off'} 视为不跑） */
function drainWordTypeOn(entry, scenario) {
  const t = entry && entry.types && entry.types[scenario];
  if (t === true) return true;
  if (t === false) return false;
  if (t && typeof t === 'object') return t.mode !== 'off' && t.on !== false;
  return false;
}

/* 节奏归一化：{mode:'each'|'interval'|'off', hours} */
function _drainRunNorm(one) {
  const m = (one && one.mode) || 'each';
  if (m === 'off') return { mode: 'off' };
  if (m === 'interval') return { mode: 'interval', hours: Math.max(1, parseInt(one && one.hours, 10) || DRAIN_MODE_HOURS_DEFAULT) };
  return { mode: 'each' };
}

/* 词 × 类型的跑法：词上没勾这一格 = 不跑；勾了就按该类整列的节奏（配置页表头设一次） */
function drainTypeMode(entry, scenario, cfg) {
  if (!drainWordTypeOn(entry, scenario)) return { mode: 'off' };
  const g = (((cfg || {}).typeRun) || {})[scenario] || DRAIN_TYPE_RUN_DEFAULT[scenario];
  return _drainRunNorm(g);
}

/* 这个词 × 这个类型：现在该不该搜（each=每轮搜；interval=距上次够小时数才搜；off=不搜）
   带 plat 时按那个平台自己的账算：小红书用老键（scenario），别的平台写成 scenario@平台——
   老数据一个字不用迁，两个平台的「隔几小时」也互不占便宜。 */
function _drainRunKey(scenario, plat, passId) {
  const s = String(scenario || '') + (passId ? ('#' + String(passId)) : '');
  return (plat && plat !== 'xhs') ? (s + '@' + plat) : s;
}
function drainPassState(entry, scenario, cfg, now, plat, passId) {
  now = now || Date.now();
  const m = drainTypeMode(entry, scenario, cfg);
  if (m.mode === 'off') return { mode: 'off', due: false, lastAt: 0, nextAt: 0, hours: 0 };
  let lastAt = Number(((((cfg || {}).kwRuns) || {})[entry.k] || {})[_drainRunKey(scenario, plat, passId)]) || 0;
  // 拆行前只记到"这个类型"：老时间戳兜底，拆行刚上线别把今天已经跑过的又全搜一遍
  if (passId && !lastAt) lastAt = Number(((((cfg || {}).kwRuns) || {})[entry.k] || {})[_drainRunKey(scenario, plat)]) || 0;
  if (m.mode === 'each') return { mode: 'each', due: true, lastAt, nextAt: 0, hours: 0 };
  // 从没跑过 → 现在就该跑，没有"下次到点"可言（nextAt 留在 0，别拿 0+小时数 当成 1970 年）
  const nextAt = lastAt ? lastAt + m.hours * 3600e3 : 0;
  return { mode: 'interval', hours: m.hours, due: !lastAt || now >= nextAt, lastAt, nextAt };
}

/* 一个关键词 → 本轮要跑的几个搜索动作（获客搜索与截流扫描共用同一套派生）
   最新=最新排序；TOP=固定三种排序各一搜；本地=关键词+属地·最新；求助=每个求助词各一搜
   ★ 默认只收"到点该搜"的类型（每轮跑 / 隔N小时 / 不跑）
   opts.only  只派生这一个类型（获客页手点某类时用）
   opts.force 忽略"到点"判断，立刻跑（前台手点的显式操作） */
function drainKeywordPasses(kw, cfg, now, opts) {
  const o = opts || {};
  const c = _drainNormalizeScanCfg(cfg || {});
  const raw = _drainPoolEntry(kw);
  if (!raw) return [];
  // 传词名（获客侧拿到的是词名）时，以词池里这个词的条目为准：每格勾没勾都写在池子里
  const entry = (kw && typeof kw === 'object') ? raw : ((c.keywords || []).find(e => e.k === raw.k) || raw);
  if (entry.on === false) return [];
  const keyword = entry.k;
  // 属地真源＝基础配置里的「同城城市」（drainGetScanCfg 读的时候镜像进 cfg.city，这里照旧直接读）
  const city = String(c.city || '').trim();
  // 同城只看「TOP」这一列自己那一档（2026-11-09：账号页不再有同城挡位）
  const sameCity = drainPbPlan(c, 'top').city;
  const topSorts = DRAIN_DEFAULT_TOP_SORTS;
  const sel = drainPbSelMap(c, now);
  const out = [];
  /* 一个搜索动作＝一行：TOP 三个排序、咨询帖四个求助词各算一个动作，到点/账也各记各的 */
  const add = (pass) => {
    const pid = drainPassId(pass);
    if (o.passId && pid !== String(o.passId)) return;
    if (!o.force && !drainPassState(entry, pass.scenario, c, now, '', pid).due) return;
    pass.passId = pid;
    pass.passLabel = drainPassFilter(pass);
    out.push(pass);
  };
  for (const meta of DRAIN_TYPE_META) {
    if (o.only && meta.scenario !== o.only) continue;
    // 词上没挂这个玩法 / 整列关着 → 不搜（force 只跳过"排班/到点"，不跳过"没挂玩法"）
    if (drainTypeMode(entry, meta.scenario, c).mode === 'off') continue;
    // 这个玩法今天跑不跑、今天轮没轮到这个词（force＝前台手点，跳过排班直接搜）
    if (!o.force && !(sel[meta.scenario] && sel[meta.scenario].has(keyword))) continue;
    if (meta.needCity && !city) continue;
    if (meta.painWords) {
      for (const w of DRAIN_PAIN_WORDS) add({ k: keyword, scenario: 'pain', term: keyword + ' ' + w, sort: 'latest', pw: w });
      continue;
    }
    if (meta.scenario === 'local' || meta.scenario === 'cross') {
      // 同城两个玩法的词里必须自带城市（PC 端定不了位）；老词没带城市的兜底补一次，已带的不重复补
      const term = (city && keyword.indexOf(city) < 0) ? (keyword + ' ' + city) : keyword;
      add({ k: keyword, scenario: meta.scenario, term, sort: 'latest' });
      continue;
    }
    if (meta.scenario === 'top') {
      /* 🏙 同城优先/同城就回：TOP 不再一律按全国热度搜——有城市就先按「词＋城市」搜（与「本地」同一写法）。
         「同城优先」下本地一篇没捞到，由 _doSearchNotes 拿 cityFallbackTo 补搜原词；「同城就回」不补，就按本地说话。 */
      const cityOn = !!city && sameCity !== 'off' && keyword.indexOf(city) < 0;
      const term = cityOn ? (keyword + ' ' + city) : keyword;
      for (const s of topSorts) {
        const p = { k: keyword, scenario: 'top', term, sort: s };
        if (cityOn && sameCity === 'priority') p.cityFallbackTo = keyword;
        add(p);
      }
      continue;
    }
    add({ k: keyword, scenario: meta.scenario, term: keyword, sort: 'latest' });
  }
  return out;
}

/* 该词最近的"下一个到点时间"（UI 提示"还要等多久"用）；都没得等返回 0 */
function drainNextDueAt(entry, cfg, now) {
  now = now || Date.now();
  let next = 0;
  for (const meta of DRAIN_TYPE_META) {
    const st = drainPassState(entry, meta.scenario, cfg, now);
    if (st.mode === 'interval' && st.nextAt > now) next = next ? Math.min(next, st.nextAt) : st.nextAt;
  }
  return next;
}

/* ================= 存储 ================= */
function _uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
/* 读/写都过一遍旧 id 归一化，旧池子无需专门迁移脚本 */
function _drainNormalizeNotes(list) {
  const arr = Array.isArray(list) ? list : [];
  for (const n of arr) if (n && DRAIN_LEGACY[n.scenario]) n.scenario = DRAIN_LEGACY[n.scenario];
  return arr;
}
async function drainLoad() {
  const d = await chrome.storage.local.get(DRAIN_KEY);
  return _drainNormalizeNotes(Array.isArray(d[DRAIN_KEY]) ? d[DRAIN_KEY] : []);
}
async function drainSave(a) { await chrome.storage.local.set({ [DRAIN_KEY]: _drainNormalizeNotes(Array.isArray(a) ? a.slice() : a) }); }
async function drainGetScanCfg() {
  const d = await chrome.storage.local.get(DRAIN_SCAN_KEY);
  const raw = (d && d[DRAIN_SCAN_KEY]) || {};
  const cfg = _drainNormalizeScanCfg(raw);
  /* 默认短话第一回铺底要落盘：不然每次读都当「没铺过」，老板改的那句会被默认盖回去 */
  if (Number(raw.talkSeed || 0) < DRAIN_TALK_V || (raw.pbPack && !raw.pbSeed)) {
    try { await chrome.storage.local.set({ [DRAIN_SCAN_KEY]: cfg }); } catch (_) {}
  }
  // 属地只做镜像：唯一真源＝基础配置里的「同城城市」（config.myCity），用户手填过的以手填为准。
  // 读的时候对齐一次，cfg.city 就不再是配置项，只是下游（搜索派生 / 评论里的 {city}）要用的值。
  try {
    const c = (typeof Storage !== 'undefined' && Storage && Storage.getConfig)
      ? await Storage.getConfig()
      : (typeof readConfigPlain === 'function' ? await readConfigPlain() : null);
    const mc = (c && c.myCity) || {};
    cfg.city = String(mc.city || mc.ipLocation || '').trim();
    const scm = String((c && c.sameCityMode) || '').trim();
    cfg.sameCityMode = ['force', 'priority', 'off'].includes(scm) ? scm : 'priority';
  } catch (_) {}
  return cfg;
}
async function drainSaveScanCfg(c) {
  const cfg = _drainNormalizeScanCfg(c);
  await chrome.storage.local.set({ [DRAIN_SCAN_KEY]: cfg });
  await drainSyncEnabledKeywords(cfg);
  return cfg;
}

/* 6 玩法合并（v8 → v9，2026-11-02 下午）：同行/竞对并进同城本业——
   词上只勾了同行的改勾本业；同行那行的周几并进来（取并集）、每天挑几个取两边多的；
   同行那份话术，本业还没配才搬过来；「盯的账号 → 蹲人」照旧保留，按本业的排班跑。
   跑过一次就升到 v9，不再重复并。 */
function _drainMergeRivalIntoLocal(cfg) {
  if (Number(cfg.v || 1) >= 9) return;
  const prevPb = (cfg.pbPlan && typeof cfg.pbPlan === 'object' && !Array.isArray(cfg.pbPlan)) ? cfg.pbPlan : {};
  if (prevPb.rival && typeof prevPb.rival === 'object') {
    const localRaw = (prevPb.local && typeof prevPb.local === 'object') ? prevPb.local : null;
    const base = drainPbPlanNorm(localRaw, 'local');
    const rv = drainPbPlanNorm(prevPb.rival, 'rival');
    prevPb.local = {
      days: Array.from(new Set([...(base.days || []), ...(rv.days || [])])).sort((a, b) => a - b),
      perDay: Math.max(base.perDay || 3, rv.perDay || 2),
      store: (localRaw && DRAIN_PB_STORE[localRaw.store]) ? localRaw.store : 'identity',
    };
    delete prevPb.rival;
  }
  cfg.pbPlan = prevPb;
  (cfg.keywords || []).forEach(e => {
    if (!e || !e.types || typeof e.types !== 'object') return;
    if (e.types.rival) e.types.local = true;
    delete e.types.rival;
  });
  const prevTalk = (cfg.pbTalk && typeof cfg.pbTalk === 'object' && !Array.isArray(cfg.pbTalk)) ? cfg.pbTalk : {};
  if (prevTalk.rival && !prevTalk.local) {
    prevTalk.local = Object.assign({}, prevTalk.rival);
  }
  delete prevTalk.rival;
  cfg.pbTalk = prevTalk;
  cfg.v = 9;
}

/* 提店口径加「讲案例」一档（v9 → v10，2026-11-09 老板定）：
   TOP / 同城异业 / 大V 可以讲自己开店的情形、带过的人、经手的案例；
   同城本业只说到身份（同行多，不报价、不说产品、不报店名）；咨询帖保持可报店名。
   只动「还是上一版默认值」的玩法——老板自己调过的那格不动。 */
function _drainStoreTierV10(cfg, nextPb) {
  if (Number(cfg.v || 1) >= 10) return;
  Object.keys(DRAIN_PB_STORE_V9).forEach(s => {
    const p = nextPb && nextPb[s];
    if (!p) return;
    const want = (DRAIN_PB_DEFAULT[s] || {}).store;
    if (want && p.store === DRAIN_PB_STORE_V9[s] && want !== p.store) p.store = want;
  });
}

/* 开口话术跟着提店档一起迁（v9 → v10）：老默认那段一字没改过才换，手改过的、行业包带来的都不动 */
function _drainTalkTierV10(nextTalk) {
  Object.keys(DRAIN_TALK_V9).forEach(s => {
    const t = nextTalk && nextTalk[s];
    if (t && String(t.text || '').trim() === DRAIN_TALK_V9[s]) t.text = DRAIN_TALK_DEFAULT[s];
  });
}

/* 扫描配置归一化：旧版「手填来源」一次性拆成 关键词池 / 属地 / 求助词（v1 → v2）；
   关键词从「字符串数组」升级为「词条目」（v2 → v3，加启用/来源/每类型跑法）。
   现存字段只剩：关键词池 / 盯的账号 / 各列节奏 / 引导之外的那点扫描账目——
   属地＝基础配置的镜像、求助词内置、TOP 排序固定、备注式「额外来源」已并进词池（2026-09-25） */
function _drainNormalizeScanCfg(raw) {
  const cfg = Object.assign({
    sources: [], keywords: [], accounts: [], types: Object.assign({}, DRAIN_DEFAULT_TYPES),
    autoScanMin: 0, lastScanAt: 0, lastScanSummary: null, kwRuns: {},
    batches: [], batchPlan: {},
  }, raw || {});
  // 投放平台：这一份队列配置派给哪几个平台（老数据没写＝只投小红书，队列跟升级前一样）
  cfg.plats = drainPlatsNorm(cfg.plats);
  // 注意 cfg.v 可能是 undefined（v1 时代原样存，没写版本号），得按 v1 处理：
  // Number(undefined) 是 NaN，NaN < 2 为 false，会白白跳过整段迁移
  if (Number(cfg.v || 1) < 2) {
    const keywords = [], manual = [];
    for (const s of (cfg.sources || [])) {
      const term = String((s && s.term) || '').trim();
      if (!term) continue;
      if ((s.kind || 'search') === 'profile') { manual.push(s); continue; }  // 高V主页等：留给下面搬进账号名单
      const id = drainScenarioId(s.scenario || 'latest');
      // 属地 / 求助词当年也是「来源」：现在前者跟基础配置、后者内置，都不再当词收
      if (id === 'local' || id === 'pain') continue;
      keywords.push(term);
    }
    cfg.keywords = Array.from(new Set(keywords));
    cfg.sources = manual;
  }
  // 盯的账号（👤 高V/竞对）：旧版把「高V主页链接」塞在「额外来源」里，这里一次性搬进账号名单
  cfg.accounts = (Array.isArray(cfg.accounts) ? cfg.accounts : []).map(a => _drainAcctEntry(a)).filter(Boolean);
  // 「✍️ 额外来源」整体下线（2026-09-25）：搜索词搬进关键词池（手动加的临时词，池里一直都能加），
  // 主页链接搬进「👤 盯的账号」。搬完这个字段恒为空，留着只为老数据有地方可搬。
  const legacyTerms = [];
  cfg.sources = (Array.isArray(cfg.sources) ? cfg.sources : []).filter(s => {
    const term = String((s && s.term) || '').trim();
    if (!term) return false;
    if ((s.kind || 'search') === 'profile') {
      const e = _drainAcctEntry({ k: term, scenario: s.scenario });
      if (e && !cfg.accounts.some(x => x.k === e.k)) cfg.accounts.push(e);
    } else legacyTerms.push(term);
    return false;
  });
  // 关键词统一收成词条目（老数据是字符串，会在这里无痛升级；清掉重复词）
  const seen = new Set();
  cfg.keywords = (Array.isArray(cfg.keywords) ? cfg.keywords : []).map(k => _drainPoolEntry(k))
    .filter(e => { if (!e || seen.has(e.k)) return false; seen.add(e.k); return true; });
  for (const t of legacyTerms) {
    if (seen.has(t)) continue;
    seen.add(t);
    cfg.keywords.push(_drainPoolEntry(t, { src: 'manual' }));
  }
  cfg.kwRuns = (cfg.kwRuns && typeof cfg.kwRuns === 'object' && !Array.isArray(cfg.kwRuns)) ? cfg.kwRuns : {};
  // 批次：词上打的批次名收进显式列表（默认批次不存）；batchPlan 里每批只留合法星期 index(0-6)
  const batchNames = Array.from(new Set((cfg.keywords || []).map(e => drainBatchName(e)))).filter(n => n !== DRAIN_DEFAULT_BATCH);
  cfg.batches = Array.from(new Set([...(Array.isArray(cfg.batches) ? cfg.batches.map(n => String(n || '').trim()).filter(Boolean) : []), ...batchNames]));
  const bp = (cfg.batchPlan && typeof cfg.batchPlan === 'object' && !Array.isArray(cfg.batchPlan)) ? cfg.batchPlan : {};
  cfg.batchPlan = {};
  Object.keys(bp).forEach(n => {
    if (!Array.isArray(bp[n]) || !bp[n].length) { cfg.batchPlan[n] = []; return; }
    const days = Array.from(new Set(bp[n].map(Number).filter(d => Number.isFinite(d) && d >= 0 && d <= 6)));
    cfg.batchPlan[n] = days;
  });
  // 周几从「批次」搬到「词自己身上」（v5 → v6）：批次当时排过哪几天就搬过来。
  // 批次也没排过 / 新加的词一律保持「未排」——不替用户随手安排（老板口径 10-29：
  // 排了哪天就跑哪天，没排的不动；「每天」是用户自己勾出来的 []）
  if (Number(cfg.v || 1) < 6) {
    cfg.keywords.forEach(e => {
      if (Array.isArray(e.days)) return;
      const legacy = (cfg.batchPlan || {})[e.batch];
      if (Array.isArray(legacy) && legacy.length) e.days = legacy.slice();
    });
  }
  // 节奏从「每个词单独配」收成「每类整列设一次」（v3 → v4）：typeRun 是真源，
  // cfg.types 留作派生镜像（旧数据里它记着哪几类开着，用来兜底）
  const prevRun = (cfg.typeRun && typeof cfg.typeRun === 'object') ? cfg.typeRun : {};
  const nextRun = {}, typesMirror = {};
  DRAIN_TYPE_META.forEach(meta => {
    const s = meta.scenario;
    const raw = prevRun[s];
    nextRun[s] = raw ? _drainRunNorm(raw)
      : ((cfg.types && cfg.types[s] === false) ? { mode: 'off' } : _drainRunNorm(DRAIN_TYPE_RUN_DEFAULT[s]));
    typesMirror[s] = nextRun[s].mode !== 'off';
  });
  cfg.typeRun = nextRun;
  cfg.types = typesMirror;
  // 「👤 盯的账号」那两列自己的节奏（acctRun）：与词池的 typeRun 分开存，缺省跟默认
  const prevAcctRun = (cfg.acctRun && typeof cfg.acctRun === 'object') ? cfg.acctRun : {};
  const nextAcctRun = {};
  ['highv', 'rival'].forEach(s => { nextAcctRun[s] = _drainRunNorm(prevAcctRun[s] || DRAIN_ACCT_RUN_DEFAULT[s]); });
  cfg.acctRun = nextAcctRun;
  // 队列整条每周自动跑（2026-10-01）：enabled + 星期清单(getDay 0-6) + 每天时段(from/to，相同＝全天)
  const _qa = (cfg.queueAuto && typeof cfg.queueAuto === 'object' && !Array.isArray(cfg.queueAuto)) ? cfg.queueAuto : {};
  cfg.queueAuto = {
    enabled: !!_qa.enabled,
    days: Array.from(new Set((Array.isArray(_qa.days) ? _qa.days : []).map(Number).filter(d => Number.isFinite(d) && d >= 0 && d <= 6))),
    from: /^\d{1,2}:\d{2}$/.test(String(_qa.from || '').trim()) ? String(_qa.from).trim() : '09:00',
    to: /^\d{1,2}:\d{2}$/.test(String(_qa.to || '').trim()) ? String(_qa.to).trim() : '18:00',
  };
  /* ── 玩法排班（v6 → v7，2026-11-02）──
     排班从「每个词勾周几」搬到「每个玩法勾周几＋每天挑几个词」。
     老词：以前没单独勾过的玩法＝默认跑（同行除外），一次性落成显式勾选，行为不变；
     老词的周几：按玩法归并成「这个玩法哪些天跑」，再按每天挑 N 个轮着跑。 */
  if (Number(cfg.v || 1) < 7) {
    cfg.keywords.forEach(e => {
      if (!e.types || typeof e.types !== 'object') e.types = {};
      DRAIN_TYPE_META.forEach(m => {
        // 老词按原来的习惯挂到「本地泛搜 / TOP / 同城本业 / 咨询帖」；异业是另一套词，不替用户勾
        if (!(m.scenario in e.types)) e.types[m.scenario] = (m.scenario !== 'cross');
      });
    });
  }
  _drainMergeRivalIntoLocal(cfg);
  /* 行业包只在这里抄一次进配置；跑的时候不读包（2026-11-09） */
  drainSeedFromPack(cfg);
  const prevPb = (cfg.pbPlan && typeof cfg.pbPlan === 'object' && !Array.isArray(cfg.pbPlan)) ? cfg.pbPlan : null;
  const nextPb = {};
  DRAIN_PB_ORDER.forEach(s => {
    if (prevPb && prevPb[s] && typeof prevPb[s] === 'object') { nextPb[s] = drainPbPlanNorm(prevPb[s], s); return; }
    const base = drainPbPlanNorm(null, s);
    // 第一版：按老词上排过的周几归并成玩法周几；没有可归并的，用推荐默认
    if (s !== 'highv') {
      const days = new Set();
      (cfg.keywords || []).forEach(e => {
        if (!drainWordTypeOn(e, s)) return;
        if (Array.isArray(e.days)) e.days.forEach(d => { if (d >= 0 && d <= 6) days.add(d); });
      });
      if (days.size) base.days = Array.from(days).sort((a, b) => a - b);
    }
    nextPb[s] = base;
  });
  /* 老账号页的「同城挡位」一次性落到每个玩法那一列上（之后只认玩法列） */
  if (!cfg.pbCitySeed && ['force', 'priority', 'off'].includes(String(cfg.sameCityMode || ''))) {
    DRAIN_PB_ORDER.forEach(s => { if (nextPb[s]) nextPb[s].city = String(cfg.sameCityMode); });
    cfg.pbCitySeed = true;
  }
  cfg.pbPlan = nextPb;
  /* 提店口径 v9 → v10：只把还是旧默认值的玩法换成新默认（老板调过的格不动） */
  _drainStoreTierV10(cfg, nextPb);
  /* 每个玩法一份话术（v7 → v8）；2026-11-03 起 6 个玩法各预置一段默认短话：
     第一次读到（talkSeed 还没记到当前版本）就铺满，提店硬控跟着对齐；
     铺过之后只归一化读写，老板手改的话一直保留。 */
  const prevTalk = (cfg.pbTalk && typeof cfg.pbTalk === 'object' && !Array.isArray(cfg.pbTalk)) ? cfg.pbTalk : {};
  const nextTalk = {};
  if (Number(cfg.talkSeed || 0) < DRAIN_TALK_V) {
    const at = Date.now();
    DRAIN_PB_ORDER.forEach(s => {
      /* 2026-11-04：这个号带行业口径包时，第一次铺的话术用包里那句，不用下面那套中性默认 */
      const text = drainPbCopy(cfg, s, 'talk') || DRAIN_TALK_DEFAULT[s];
      if (!text) return;
      nextPb[s].store = DRAIN_PB_DEFAULT[s].store || nextPb[s].store;
      nextTalk[s] = { text: text, persona: '', at, v: DRAIN_TALK_V };
    });
    cfg.talkSeed = DRAIN_TALK_V;
  } else {
    DRAIN_PB_ORDER.forEach(s => { const t = drainPbTalkNorm(prevTalk[s]); if (t) nextTalk[s] = t; });
  }
  cfg.pbTalk = nextTalk;
  _drainTalkTierV10(nextTalk);
  /* 「刚起来」的三条线（2026-11-08）：默认 6 小时 / 赞 200 / 评论 20；在玩法配置顶部可改 */
  const _fc = (cfg.freshCfg && typeof cfg.freshCfg === 'object' && !Array.isArray(cfg.freshCfg)) ? cfg.freshCfg : {};
  const _fcNum = (v, d) => (v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
  cfg.freshCfg = {
    hours: Math.min(168, Math.max(1, _fcNum(_fc.hours, 6))),
    likes: Math.max(0, _fcNum(_fc.likes, 200)),
    comments: Math.max(0, _fcNum(_fc.comments, 20)),
  };
  /* 笔记类型表（2026-11-12）：评不评 / 动作 / 提店 / 收人只在类型表里存一份；没配过的号落默认值 */
  cfg.noteTypes = drainNoteTypesNorm(cfg.noteTypes);
  cfg.v = 10;
  return cfg;
}

/* 词池 → 获客关键词镜像：启用中的词写进 auto_water_config.keywords（单份真源，左上角那串就是它的视图）
   池子空而获客侧有词 → 反向播种进池（老用户升级 / 先在左上角加词的场景），绝不丢词 */
async function drainSyncEnabledKeywords(cfgIn) {
  let cfg = cfgIn || await drainGetScanCfg();
  let enabled = (cfg.keywords || []).filter(e => e.on !== false).map(e => e.k);
  try {
    const d = await chrome.storage.local.get('auto_water_config');
    const aw = d['auto_water_config'] || {};
    const cur = (Array.isArray(aw.keywords) ? aw.keywords : []).map(x => String(x || '').trim()).filter(Boolean);
    if (!cfg.keywords.length && cur.length) {
      cfg.keywords = cur.map(k => _drainPoolEntry(k));
      enabled = cur.slice();
      await chrome.storage.local.set({ [DRAIN_SCAN_KEY]: _drainNormalizeScanCfg(cfg) });
    } else {
      const same = cur.length === enabled.length && cur.every((x, i) => x === enabled[i]);
      if (!same) {
        aw.keywords = enabled;
        aw.schedule = aw.schedule || {};
        const ki = parseInt(aw.schedule.kwIdx, 10);
        if (!(ki >= 0 && ki < enabled.length)) aw.schedule.kwIdx = 0;
        await chrome.storage.local.set({ auto_water_config: aw });
        if (enabled[0]) await chrome.storage.local.set({ _aw_last_keyword: enabled[0] });
      }
    }
  } catch (e) { console.warn('[词池] 同步获客关键词失败:', (e && e.message) || e); }
  try { if (typeof window !== 'undefined' && typeof window._kwBarReload === 'function') await window._kwBarReload(); } catch (_) {}
  return enabled;
}

/* 获客侧词表 → 词池：新增的词入池并启用；从获客列表去掉的词只停用（留在池里，可在配置面板重新启用）
   max 传 0/未知 = 不限（三档都不限量，上限数值只作将来备用） */
async function drainPoolApplyList(list, max) {
  const cfg = await drainGetScanCfg();
  const m = Number(max);
  const maxN = (isFinite(m) && m >= 1) ? m : Infinity;
  const want = Array.from(new Set((list || []).map(x => String(x || '').trim()).filter(Boolean)));
  const byKey = new Map((cfg.keywords || []).map(e => [e.k, e]));
  const next = [];
  for (const k of want) {
    const e = byKey.get(k);
    if (e) { e.on = true; byKey.delete(k); next.push(e); }
    else if (next.length < maxN) next.push(_drainPoolEntry(k, { src: 'manual' }));
  }
  for (const e of byKey.values()) { e.on = false; next.push(e); }
  cfg.keywords = next.slice(0, maxN);
  await drainSaveScanCfg(cfg);
  return cfg.keywords.filter(e => e.on !== false).map(e => e.k);
}

/* 词池容量 = 本版本的关键词上限（与获客侧同一个数）；0＝不限 → Infinity（当前三档都不限量） */
let _drainPoolMaxCache = 0;
async function drainPoolMax() {
  if (_drainPoolMaxCache) return _drainPoolMaxCache;
  try {
    const r = await chrome.runtime.sendMessage({ action: 'getEdition' });
    const v = Number(r && r.edition && r.edition.keywordMax);
    _drainPoolMaxCache = (isFinite(v) && v >= 1) ? v : Infinity;
  } catch (_) { _drainPoolMaxCache = Infinity; }
  return _drainPoolMaxCache;
}

/* 获客侧按类型取词：这一类勾了哪些启用中的词（词标签按类型过滤用） */
async function drainPoolWordsFor(scenario) {
  const cfg = await drainGetScanCfg();
  return (cfg.keywords || [])
    .filter(e => e.on !== false && drainWordTypeOn(e, scenario))
    .map(e => e.k);
}
if (typeof window !== 'undefined') window.drainPoolWordsFor = drainPoolWordsFor;

/* 某个词 × 某类型刚跑完 → 记时间戳（"隔几小时跑"据此判断到没到点）
   plat：小红书不传（老键），抖音传 'dy'（写进 scenario@dy） */
async function drainMarkPassRan(k, scenario, at, plat, passId) {
  const key = String(k || '').trim();
  if (!key || !scenario) return;
  const cfg = await drainGetScanCfg();
  cfg.kwRuns[key] = Object.assign({}, cfg.kwRuns[key] || {}, { [_drainRunKey(scenario, plat, passId)]: at || Date.now() });
  await drainSaveScanCfg(cfg);
}

/* ================= 队列（🔁 队列页） =================
   队列项 = 词池里"到点该跑"的那一格（词 × 类型）＝配置表里的一个勾 + 一整列的节奏。
   running＝正在跑的那一项；carry＝上次没跑完、下次接着跑的；done＝已跑完的记录（留最近若干条）
   ★ 待跑清单是现场派生的（配置表 + kwRuns），所以「改表＝改队列」，不存在两份要同步的计划 */
const DRAIN_QUEUE_KEY = 'drain_queue';
const DRAIN_QUEUE_DONE_KEEP = 60;

/* 队列项的身份：词|类型[#筛选]（小红书）／词|类型[#筛选]@平台（别的平台另算一趟）
   拆行前的老记录没有 #筛选 那一段，照旧认老键（见 drainQueuePlan 的 legacy 兜底） */
function _drainQKey(k, s, plat, passId) {
  const base = String(k || '').trim() + '|' + String(s || '') + (passId ? ('#' + String(passId)) : '');
  return (plat && plat !== 'xhs') ? (base + '@' + plat) : base;
}
/* 这条队列记录算不算这一项：新记录认带筛选的键；拆行前的老记录（没有 passId）按整词键认，
   这样升级前的欠账/手插/标红不会丢，也不会把同一类别的其它行一起抹掉 */
function _drainQHit(x, k, s, plat, passId) {
  if (!x) return false;
  const key = _drainQKey(k, s, plat, passId);
  if (_drainQKey(x.k, x.scenario, x.plat, x.passId) === key) return true;
  return !x.passId && _drainQKey(x.k, x.scenario, x.plat) === _drainQKey(k, s, plat);
}
/* 拆行前那种「整词」完成记录（没有筛选身份）：只拿来回看，不算进今天的搜索次数。
   盯的账号（主打高V/蹲人）与日常浏览本来就没有筛选身份，不算旧账 */
function drainIsLegacyDone(rec, cfg) {
  if (!rec || rec.passId) return false;
  const s = String(rec.scenario || '');
  if (s === 'daily' || s === 'highv') return false;
  const k = String(rec.k || '').trim();
  if (!k || /^https?:\/\//i.test(k)) return false;
  const accts = (((cfg || {}).accounts) || []).map(a => String((a && a.k) || '').trim());
  return accts.indexOf(k) < 0;
}
/* 队列里这一项「叫什么」：盯的账号显示昵称，词就显示词本身 */
function _drainQName(x) { return (x && (x.label || x.k)) || ''; }function _drainQItem(x) {
  if (!x) return null;
  const k = String(x.k || '').trim();
  if (!k) return null;
  return {
    k,
    label: String(x.label || ''),   // 盯的账号：显示用昵称（k 是主页链接）
    scenario: drainScenarioId(x.scenario),
    /* 一个搜索动作的身份（top:likes / pain:求推荐…）：老记录没有＝拆行前那种「整词」项 */
    passId: String(x.passId || ''),
    passLabel: String(x.passLabel || ''),
    plat: (x.plat === 'dy') ? 'dy' : 'xhs',   // 没写＝小红书（老队列记录照旧）
    /* 这笔账「哪天欠下的」（2026-11-06）：欠账跨天就不再抢今天的队头，
       只进「之前没跑完的」；老记录没写＝按 at 那天算 */
    day: String(x.day || ''),
    at: Number(x.at) || 0,
    foundN: Number(x.foundN) || 0,
    commentN: Number(x.commentN) || 0,
    /* 这一搜搜到的全是评过的 → 队列行写「都评过了」，不冒充「没评论」 */
    allSkipped: !!x.allSkipped,
    note: String(x.note || ''),
    // 笔记级明细（执行器跑这篇时发的条数）→ 「✅ 已完成」里折叠展示
    // id＝笔记的 noteId：工作台笔记列表靠它精确标出「这一篇在队列里跑过没」（老记录可能没有，那边有标题兜底）
    notes: (Array.isArray(x.notes) ? x.notes : [])
      .map(n => ({ id: String((n && n.id) || ''), t: String((n && n.t) || '').slice(0, 60), s: Number(n && n.s) || 0 }))
      .filter(n => n.t && n.s > 0)
      .slice(0, 50),
  };
}
function _drainQNorm(raw) {
  const q = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const arr = (a) => (Array.isArray(a) ? a : []).map(_drainQItem).filter(Boolean);
  const dm = (q.dailyMark && typeof q.dailyMark === 'object') ? q.dailyMark : {};
  /* 🌿 手塞的日常浏览：一条＝一趟（at＝该跑的时刻，到点进待跑）
     点一下「🌿 日常浏览」就是塞 1 趟「刷首页」，现在就能跑 */
  const plan = (Array.isArray(q.dailyPlan) ? q.dailyPlan : []).map(x => {
    const k = String((x && (x.k || x.id)) || '').trim();
    if (!k) return null;
    const at = Number(x && x.at) || 0;
    return { id: String((x && x.id) || ('dp' + at + '_' + k)), k, label: String((x && x.label) || ''), at };
  }).filter(Boolean);
  /* 今天这份清单（2026-10-29）：这一趟开跑时把顺序整份记下，中途改配置只影响明天。
     day 是本地日期串；keys 是队列项自己的身份（词|类型[@平台]）。跨天自动作废。 */
  const tp = (q.todayPlan && typeof q.todayPlan === 'object') ? q.todayPlan : {};
  /* ✕ 今天撤掉的项（2026-10-29）：只按今天算，跨天自动作废；配置里的勾不动 */
  const dr = (q.drop && typeof q.drop === 'object') ? q.drop : {};
  return {
    v: 1,
    running: _drainQItem(q.running) || null,
    carry: arr(q.carry),
    manual: arr(q.manual),
    done: arr(q.done).slice(0, DRAIN_QUEUE_DONE_KEEP),
    dailyPlan: plan,
    // 🌿 日常流程上次跑于何时（队列里只留这一笔，自动插的一轮由执行器每趟开跑时插）
    dailyMark: { lastAt: Number(dm.lastAt) || 0 },
    drop: {
      day: String(dr.day || ''),
      keys: (Array.isArray(dr.keys) ? dr.keys : []).map(x => String(x || '')).filter(Boolean).slice(0, 600),
    },
    /* 🔴 跑不起来、标红等人工的（2026-10-30）：只按今天算，跨天自动作废（配置不动，明天照常排） */
    blocked: (function () {
      const bk = (q.blocked && typeof q.blocked === 'object') ? q.blocked : {};
      const rows = (Array.isArray(bk.rows) ? bk.rows : []).map(x => {
        const k = String((x && x.k) || '').trim();
        if (!k) return null;
        return {
          k, label: String((x && x.label) || ''), scenario: drainScenarioId(x && x.scenario),
          passId: String((x && x.passId) || ''), passLabel: String((x && x.passLabel) || ''),
          plat: (x && x.plat === 'dy') ? 'dy' : 'xhs', why: String((x && x.why) || ''),
          at: Number(x && x.at) || 0, n: Number(x && x.n) || 0,
        };
      }).filter(Boolean).slice(0, 200);
      return { day: String(bk.day || ''), rows };
    })(),
    /* 「为什么停」：队列页顶部那条（当天有效，过了今天就当没这回事） */
    lastStop: (q.lastStop && typeof q.lastStop === 'object' && q.lastStop.why)
      ? {
        k: String(q.lastStop.k || ''), label: String(q.lastStop.label || ''), scenario: String(q.lastStop.scenario || ''),
        passId: String(q.lastStop.passId || ''), passLabel: String(q.lastStop.passLabel || ''),
        plat: String(q.lastStop.plat || 'xhs'), why: String(q.lastStop.why || ''),
        at: Number(q.lastStop.at) || 0, n: Number(q.lastStop.n) || 0, global: !!q.lastStop.global,
      }
      : null,
    todayPlan: {
      day: String(tp.day || ''),
      at: Number(tp.at) || 0,
      keys: (Array.isArray(tp.keys) ? tp.keys : []).map(x => String(x || '')).filter(Boolean).slice(0, 600),
      // 锁定时的配置指纹：跟现在的对不上＝配置动过（见 drainCfgSig）
      sig: String(tp.sig || ''),
      // 锁定时的配置快照：今天这趟照它跑（配置中途改了只影响明天）
      cfg: (tp.cfg && typeof tp.cfg === 'object' && !Array.isArray(tp.cfg)) ? tp.cfg : null,
    },
  };
}
async function drainGetQueue() {
  const d = await chrome.storage.local.get(DRAIN_QUEUE_KEY);
  return _drainQNorm(d && d[DRAIN_QUEUE_KEY]);
}
async function drainSaveQueue(q) {
  const next = _drainQNorm(q);
  await chrome.storage.local.set({ [DRAIN_QUEUE_KEY]: next });
  return next;
}
/* 🌿 日常浏览是否可用（② 起随获客开通）：popup 里问 editionFeatureOn，后台/设置页问 Edition
   判不出来就放行（宁可多显示，也不因版本消息失败把功能藏了） */
function drainDailyOn() {
  try {
    if (typeof editionFeatureOn === 'function') return !!editionFeatureOn('dailyBrowse');
    if (typeof Edition !== 'undefined' && Edition.hasFeature) return !!Edition.hasFeature('dailyBrowse');
  } catch (_) {}
  return true;
}

/* 🌿 日常浏览的队列侧上下文：配置 + 今日计数。派生出"这一趟该不该插一轮日常流程"。
   读不到（老版本 / 存储异常 / 这档没开通）就返回 null —— 队列照跑，只是没有日常项 */
async function drainDailyCtx() {
  try {
    if (typeof DailyBrowse === 'undefined') return null;
    if (!drainDailyOn()) return null;
    return { cfg: await DailyBrowse.getConfig(), daily: await DailyBrowse.getDaily() };
  } catch (_) { return null; }
}

function _drainDayKey(now) {
  const d = new Date(now || Date.now());
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
/* 这一笔账是哪天欠下的 / 哪天标的红：写了 day 就认它，老记录按 at 那天算 */
function drainQRecDay(x) {
  return String((x && x.day) || '') || _drainDayKey((x && x.at) || Date.now());
}
/* ✕ 今天撤掉的项：只认今天的名单，跨天一律当空（配置不动，明天照常排） */
function drainQDropSet(q, now) {
  const dr = (q && q.drop) || {};
  if (String(dr.day || '') !== _drainDayKey(now)) return new Set();
  return new Set((dr.keys || []).map(String));
}
/* 这一条现在还配着吗（2026-11-04）：词还启用、这一列还开着，或盯的账号还在盯；日常浏览一直在。
   配置改了以后，旧词留下的标红 / 停因 / 回执 / 欠账都不再显示——否则页面上还在喊早就删掉的词。 */
function drainQRowLive(rec, cfgIn) {
  if (!rec) return false;
  const c = _drainNormalizeScanCfg(cfgIn || {});
  const sc = drainScenarioId(rec.scenario);
  if (sc === 'daily') return true;
  const plat = String(rec.plat || 'xhs');
  if (DRAIN_PLATS.indexOf(plat) < 0) return false;
  if (sc === 'highv' || sc === 'rival') {
    const a = (c.accounts || []).find(x => x.k === rec.k && drainScenarioId(x.scenario) === sc);
    return !!a && a.on !== false;
  }
  const e = (c.keywords || []).find(x => x.k === rec.k);
  if (!e) return false;
  return e.on !== false && drainTypeMode(e, sc, c).mode !== 'off';
}
/* 队列页看到的全部：待跑（到点了）/ 还没到点 / 欠账 / 正在跑。
   排序＝手插最前 → 当天的欠账（越早欠越前）→ 自动插的日常流程 → 最久没跑的先跑
   之前那些天没跑完的（欠账 / 标红）不进今天的队，单独放 pending，点「接着补」才排回来（2026-11-06）
   dbIn = { cfg, daily }（见 drainDailyCtx），缺省＝没有日常浏览这一层 */
function drainQueuePlan(cfgIn, qIn, now, dbIn) {
  now = now || Date.now();
  const q = _drainQNorm(qIn);
  /* 今天这份清单锁定时连配置一起锁住（2026-10-29 确认单 9）：配置没动就照锁的那份跑；
     配置改过（指纹对不上）＝当场按新配置重排（2026-11-04 老板定：页面和机器始终一致），
     已经跑完的靠「这类刚跑过」跳过，不重跑。老数据没有指纹的按现在这份配置算，下次取活时补指纹。 */
  const cfgNow = _drainNormalizeScanCfg(cfgIn || {});
  const tpLock = (q.todayPlan && q.todayPlan.day === _drainDayKey(now)) ? q.todayPlan : null;
  const lockedCfg = (tpLock && tpLock.cfg && tpLock.sig && tpLock.sig === drainCfgSig(cfgNow)) ? tpLock.cfg : null;
  const cfg = _drainNormalizeScanCfg(lockedCfg || cfgIn || {});
  const db = dbIn || null;
  const dbOn = !!(db && db.cfg && db.cfg.enabled);
  /* 方向那一层已经撤了（2026-10-30）：日常浏览只有「刷首页」这一档，
     老队列项里的 k（d1/d2/d3…）一律落回它——不丢欠账、不丢手塞的那几趟 */
  const dayDir = (typeof DailyBrowse !== 'undefined' && DailyBrowse.dir)
    ? DailyBrowse.dir()
    : { id: 'd1', name: '日常浏览' };
  const carryAt = {}, manualAt = {}, carryRec = {}, manualRec = {};
  q.carry.forEach(c => { const k = _drainQKey(c.k, c.scenario, c.plat, c.passId); carryAt[k] = c.at || 1; carryRec[k] = c; });
  q.manual.forEach(c => { const k = _drainQKey(c.k, c.scenario, c.plat, c.passId); manualAt[k] = c.at || 1; manualRec[k] = c; });
  /* 🔵 「之前没跑完的」（2026-11-06 老板定）：昨天、前天…没跑完的那些，今天不再自己插到队头——
     今天的词照今天的排班跑；它们只进队列页那块名单，点了「接着补」才排回最前。
     老记录没写 day 的按 at（欠下的那天）算。 */
  const dayKey = _drainDayKey(now);
  const recDay = drainQRecDay;
  const pending = [], pendKeys = new Set();
  const addPend = (x) => {
    const pk = _drainQKey(x.k, x.scenario, x.plat, x.passId);
    if (pendKeys.has(pk)) return;
    pendKeys.add(pk);
    pending.push(x);
  };
  const city = String(cfg.city || '').trim();
  /* 这一份配置派给哪几个平台：勾两个平台，同样的词就在两边各跑一趟（一趟跑完接下一趟）。
     抖音这一轮只跑「综合」（latest），其余几类仍只在小红书跑。 */
  const plats = drainCfgPlats(cfg);
  const dropSet = drainQDropSet(q, now);
  const blockSet = drainQBlockSet(q, now);
  const todo = [], waiting = [], noCity = [], dailyItems = [];
  /* 今天每个走词的玩法各挑哪几个词（玩法排班 + 每天 N 个轮着跑） */
  const sel = drainPbSelMap(cfg, now);
  for (const e of (cfg.keywords || [])) {
    if (e.on === false) continue;
    for (const meta of DRAIN_TYPE_META) {
      const picked = !!(sel[meta.scenario] && sel[meta.scenario].has(e.k));
      for (const plat of plats) {
        if (plat !== 'xhs' && meta.scenario !== 'latest') continue;
        if (drainTypeMode(e, meta.scenario, cfg).mode === 'off') continue;
        // 属地没填 → 这一类搜不了（属地真源＝基础配置里的「同城城市」）：不进队列，另计数给上方提示
        if (meta.needCity && !city) { noCity.push({ k: e.k, scenario: meta.scenario, plat }); continue; }
        /* ★ 一个搜索动作一行：TOP 三个排序 / 咨询帖四个求助词各自成行，
           各自算到没到点、各自记欠账（force 只跳过"到点"，排班由 picked 管） */
        const passes = drainKeywordPasses(e, cfg, now, { only: meta.scenario, force: true });
        for (const pass of passes) {
          const key = _drainQKey(e.k, meta.scenario, plat, pass.passId);
          /* 拆行前的老记录只到「整词一项」：按这一类所有行都算它（老账不丢） */
          const lkey = _drainQKey(e.k, meta.scenario, plat);
          if (dropSet.has(key) || dropSet.has(lkey)) continue;
          /* 标红的（连续跑不起来 / 词被停用）今天不再排它，去队列页「等你处理」那块看 */
          if (blockSet.has(key) || blockSet.has(lkey)) continue;
          const st = drainPassState(e, meta.scenario, cfg, now, plat, pass.passId);
          const cRec = carryRec[key] || carryRec[lkey];
          const mRec = manualRec[key] || manualRec[lkey];
          let isCarry = !!cRec;
          const isManual = !!mRec;
          /* 跨天的欠账不再抢队头：进「之前没跑完的」，今天照样按排班跑（同一次搜索今天轮到就正常跑） */
          const carryOld = isCarry && !isManual && recDay(cRec) !== dayKey;
          if (carryOld) {
            isCarry = false;
            addPend({
              k: e.k, label: '', scenario: meta.scenario, plat, passId: pass.passId, passLabel: pass.passLabel,
              kind: 'carry', at: cRec.at || 0, day: recDay(cRec), note: cRec.note || '', why: cRec.note || '',
            });
          }
          /* 玩法今天没排 / 今天没轮到这个词 → 不跑；只有当天欠账和手插能插进来 */
          if (!picked && !isCarry && !isManual) continue;
          const item = {
            k: e.k, scenario: meta.scenario, plat, passId: pass.passId, passLabel: pass.passLabel,
            lastAt: st.lastAt, hours: st.hours || 0, nextAt: st.nextAt || 0,
            carry: isCarry, manual: isManual, carryNote: isCarry ? (cRec.note || '') : '',
            /* 为什么今天跑它（日志和队列行都用这一句）：手插/欠账优先，其次看玩法排班 */
            why: isManual ? '手插最前' : (isCarry ? '欠账没跑完' : (picked ? '玩法排到今天' : '排班外补跑')),
          };
          if (!isCarry && !isManual && !st.due) { waiting.push(item); continue; }
          const cAt = (carryAt[key] != null) ? carryAt[key] : carryAt[lkey];
          const mAt = (manualAt[key] != null) ? manualAt[key] : manualAt[lkey];
          // 手插：后点的排更前（点 ⤴ 就是「下一步跑它」）；欠账：越早欠越靠前
          item.sort = isManual ? (-2e15 - mAt) : (isCarry ? (cAt - 1e15) : (st.lastAt || 0));
          todo.push(item);
        }
      }
    }
  }
  // 👤 盯的账号：和「词 × 玩法」一样是一格（k=主页链接），只是它不走搜索、走主页
  //    这一轮只认小红书主页（抖音那头的账号动作下一轮再开）
  for (const ac of (cfg.accounts || [])) {
    const st = drainAccountState(ac, cfg, now);
    if (st.mode === 'off') continue;
    const key = _drainQKey(ac.k, ac.scenario, 'xhs');
    if (dropSet.has(key)) continue;
    if (blockSet.has(key)) continue;
    const cRec = carryRec[key], mRec = manualRec[key];
    let isCarry = !!cRec;
    const isManual = !!mRec;
    const carryOld = isCarry && !isManual && recDay(cRec) !== dayKey;
    if (carryOld) {
      isCarry = false;
      addPend({
        k: ac.k, label: drainAccountLabel(ac), acct: true, scenario: ac.scenario, plat: 'xhs',
        passId: '', passLabel: '', kind: 'carry', at: cRec.at || 0, day: recDay(cRec),
        note: cRec.note || '', why: cRec.note || '',
      });
    }
    // 盯的号也按玩法排班：大V 看 highv 那一行，蹲人（原同行）跟同城本业那一行；当天欠账/手插照样能插
    const apb = (ac.scenario === 'rival') ? 'local' : 'highv';
    const picked = drainPbOnDay(cfg, apb, now);
    if (!picked && !isCarry && !isManual) continue;
    const item = {
      k: ac.k, label: drainAccountLabel(ac), acct: true, scenario: ac.scenario, plat: 'xhs',
      lastAt: st.lastAt, hours: st.hours || 0, nextAt: st.nextAt || 0, carry: isCarry, manual: isManual,
      carryNote: isCarry ? (cRec.note || '') : '',
      why: isManual ? '手插最前' : (isCarry ? '欠账没跑完' : (picked ? '玩法排到今天' : '排班外补跑')),
    };
    if (!isCarry && !isManual && !st.due) { waiting.push(item); continue; }
    item.sort = isManual ? (-2e15 - manualAt[key]) : (isCarry ? (carryAt[key] - 1e15) : (st.lastAt || 0));
    todo.push(item);
  }
  /* 🌿 日常流程（一项 = 刷首页一轮）：
     队列里只放"显式排着的"（手塞 ▶ / 欠着没跑完）。自动插的那一轮不在这里排：
     执行器每趟开跑时插到队首（见 auto-bot.js _plugDailyRound），
     这样获客格子再少也不会把日常浏览饿死。 */
  const hasManualDaily = q.manual.some(x => x.scenario === 'daily');
  for (const x of q.manual) {
    if (x.scenario !== 'daily') continue;
    dailyItems.push({
      k: x.k, label: dayDir.name, scenario: 'daily', daily: true, manual: true,
      lastAt: (q.dailyMark || {}).lastAt || 0, nextAt: 0, sort: -2e15 - (x.at || 1), why: '你手塞的',
    });
  }
  for (const x of q.carry) {
    if (x.scenario !== 'daily') continue;
    if (hasManualDaily) continue;
    /* 跨天的日常浏览欠账不自动补刷（刷一轮就是刷一轮），进「之前没跑完的」等点才补（2026-11-06） */
    if (recDay(x) !== dayKey) {
      addPend({
        k: x.k, label: dayDir.name, scenario: 'daily', plat: 'xhs', passId: '', passLabel: '',
        kind: 'carry', at: x.at || 0, day: recDay(x), note: x.note || '', why: x.note || '',
      });
      continue;
    }
    dailyItems.push({
      k: x.k, label: dayDir.name, scenario: 'daily', daily: true, carry: true, carryNote: x.note || '',
      lastAt: (q.dailyMark || {}).lastAt || 0, nextAt: 0, sort: (x.at || 1) - 1e15, why: '欠账没跑完',
    });
  }
  /* 🌿 点「日常浏览」手塞的 3 趟：at 到点了进待跑、没到点进计划。
     跑掉一条就在取队首时按 planId 删掉（drainQueueTake），所以不会反复冒出来 */
  for (const x of (q.dailyPlan || [])) {
    const it = {
      k: x.k, label: dayDir.name, scenario: 'daily', daily: true, planned: true,
      planId: x.id, planAt: x.at, nextAt: x.at,
      lastAt: (q.dailyMark || {}).lastAt || 0, manual: false, carry: false, why: '你手塞的',
    };
    if (x.at > now) { waiting.push(it); continue; }
    it.sort = (x.at || now) - 5e14;
    todo.push(it);
  }
  todo.push(...dailyItems);
  todo.sort((a, b) => a.sort - b.sort);
  waiting.sort((a, b) => (a.nextAt || 0) - (b.nextAt || 0));
  /* 词被停用/删掉、这一列关了、账号被取消盯 → 欠账和手插自动作废；日常浏览只有一档，条目始终有效 */
  const live = (x) => drainQRowLive(x, cfg);
  const bkAll = ((q.blocked && Array.isArray(q.blocked.rows)) ? q.blocked.rows : []).filter(live);
  /* 今天的标红照旧（红块 / 黄块）；之前那些天的标红也进「之前没跑完的」——隔天不能悄悄消失（2026-11-06） */
  const bkToday = bkAll.filter(x => _drainDayKey(x.at) === dayKey);
  bkAll.filter(x => _drainDayKey(x.at) !== dayKey).forEach(x => addPend({
    k: x.k, label: x.label || '', scenario: x.scenario, plat: x.plat || 'xhs',
    passId: x.passId || '', passLabel: x.passLabel || '',
    kind: 'red', at: x.at || 0, day: _drainDayKey(x.at), why: x.why || '', n: Number(x.n) || 0,
  }));
  /* 今天这一份里已经排着的（待跑 / 计划）就别在那块再挂一遍：它今天本来就会跑 */
  const liveKeys = new Set(todo.concat(waiting).map(it => _drainQKey(it.k, it.scenario, it.plat, it.passId)));
  const pendingOut = pending
    .filter(x => !liveKeys.has(_drainQKey(x.k, x.scenario, x.plat, x.passId)))
    .sort((a, b) => (b.at || 0) - (a.at || 0));
  const lsToday = (q.lastStop && _drainDayKey(q.lastStop.at) === _drainDayKey(now)) ? q.lastStop : null;
  /* 「为什么停」也分情况：整轮停（掉登录这类）全天有效；只停某一项时，那一项已经不在配置里就不提了 */
  const lastStop = (lsToday && (lsToday.global || drainQRowLive(lsToday, cfg))) ? lsToday : null;
  return {
    cfg, q, todo, waiting, noCity, db, dbOn,
    carry: q.carry.filter(live), manual: q.manual.filter(live), running: q.running,
    blocked: bkToday, pending: pendingOut, lastStop,
  };
}

/* 「为什么一项都排不出来」：配了词却空着，最常见是这一批今天不跑（以前悄悄不留痕，用户只能猜）。
   队列空着时用，配置页那行产出预告也用——两处一句话，别各说各的。没原因就返回 '' */
function drainQueueEmptyWhy(cfgIn, now) {
  const cfg = _drainNormalizeScanCfg(cfgIn || {});
  const now0 = now || Date.now();
  const poolOn = (cfg.keywords || []).filter(e => e.on !== false);
  const accts = (cfg.accounts || []).filter(a => a.on !== false);
  const why = [];
  if (!poolOn.length && !accts.length) why.push('词池里一个词都没有、「盯的账号」也是空的');
  const pbOff = DRAIN_PB_WORD.filter(s => !drainPbPlan(cfg, s).days.length && poolOn.some(e => drainWordTypeOn(e, s)));
  if (pbOff.length) why.push(pbOff.length + ' 个玩法没勾周几（勾了才跑）：' + pbOff.map(s => drainScenarioDef(s).label).join('、'));
  const noType = poolOn.filter(e => DRAIN_TYPE_META.every(m => drainTypeMode(e, m.scenario, cfg).mode === 'off'));
  if (noType.length) why.push(noType.length + ' 个词一个玩法都没挂（在词池那张表里勾上玩法）');
  // 只挂了同城玩法、同城城市又没填 → 这些词压根搜不了（队列里不占位）
  const city = String(cfg.city || '').trim();
  const onlyLocal = poolOn.filter(e => {
    const on = DRAIN_TYPE_META.filter(m => drainTypeMode(e, m.scenario, cfg).mode !== 'off');
    return on.length > 0 && on.every(m => m.needCity);
  });
  if (!city && onlyLocal.length) why.push(onlyLocal.length + ' 个词只挂了同城玩法，但同城城市还没填');
  if (!drainCfgPlats(cfg).length) why.push('「投放平台」一个都没勾');
  const anyToday = DRAIN_PB_ORDER.some(s => drainPbOnDay(cfg, s, now0));
  if (!anyToday) why.push('今天（' + WK_LABELS[new Date(now0).getDay()] + '）一个玩法都没排');
  return why.join('；');
}

/* 配置页那行产出预告：按现在这套设置，今天 / 明天各排得出多少项。
   跟队列页是同一个派生（drainQueuePlan），所以「今天」就是队列顶栏那个待跑数，不是另算一套 */
function drainQueueForecast(cfgIn, now) {
  const now0 = now || Date.now();
  const itemsOn = (t) => drainQueuePlan(cfgIn, {}, t, null).todo.filter(it => !it.daily);
  const todayItems = itemsOn(now0);
  const wordsOn = (arr) => new Set(arr.filter(it => !it.acct).map(it => it.k)).size;
  const today = todayItems.length;
  return {
    today, tomorrow: itemsOn(now0 + 86400000).length,
    words: wordsOn(todayItems),
    why: today ? '' : drainQueueEmptyWhy(cfgIn, now0),
  };
}

/* 取队首跑（顺带清掉失效的欠账/手插）：返回 null＝这一轮到点的都跑完了
   skip＝本次跑已经跑过的 key（"每轮跑"的格子跑完还是到点，靠它避免同一趟里反复跑同一格） */
async function drainQueueTake(skip) {
  const cfg = await drainGetScanCfg();
  const q = await drainGetQueue();
  const p = drainQueuePlan(cfg, q, Date.now(), await drainDailyCtx());
  const sk = skip || {};
  /* 今天这份清单：配置没动就照锁的顺序跑；配置改过（指纹对不上）＝当场按新配置重排、重新锁上
     （2026-11-04 老板定：页面和机器始终一致；已经跑完的靠「这类刚跑过」跳过，不重跑） */
  const d0 = new Date();
  const dayKey = d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') + '-' + String(d0.getDate()).padStart(2, '0');
  const liveSig = drainCfgSig(p.cfg);
  const tpOld = (q.todayPlan && q.todayPlan.day === dayKey && q.todayPlan.keys.length) ? q.todayPlan : null;
  let tp = (tpOld && tpOld.sig && tpOld.sig === liveSig) ? tpOld : null;
  if (!tp) tp = { day: dayKey, at: Date.now(), keys: p.todo.map(it => _drainQKey(it.k, it.scenario, it.plat, it.passId)), sig: liveSig, cfg: p.cfg };
  else if (!tp.cfg) tp = Object.assign({}, tp, { cfg: p.cfg });
  const rank = (it) => { const i = tp.keys.indexOf(_drainQKey(it.k, it.scenario, it.plat, it.passId)); return i < 0 ? 1e9 : i; };
  const ordered = p.todo.slice().sort((a, b) => (rank(a) - rank(b)) || ((a.sort || 0) - (b.sort || 0)));
  const item = ordered.find(it => !sk[_drainQKey(it.k, it.scenario, it.plat, it.passId)]);
  /* 取走的是手塞的那一趟 → 把它从 dailyPlan 里删掉（按 planId 精确删，别的趟不受影响） */
  const keep = {
    carry: p.carry, manual: p.manual,
    dailyPlan: (q.dailyPlan || []).filter(x => !(item && item.planId && x.id === item.planId)),
    todayPlan: tp,
    /* 词 / 这一列已经不在配置里的标红记录，重排时自动清掉（2026-11-04）；
       之前那些天的也留着（进「之前没跑完的」），别换天就丢（2026-11-06） */
    blocked: (q.blocked && Array.isArray(q.blocked.rows))
      ? { day: String(q.blocked.day || ''), rows: (q.blocked.rows || []).filter(x => drainQRowLive(x, p.cfg)).slice(0, 60) }
      : q.blocked,
  };
  if (!item) { await drainSaveQueue(Object.assign({}, q, keep, { running: null })); return null; }
  await drainSaveQueue(Object.assign({}, q, keep, { running: {
    k: item.k, label: item.label || '', scenario: item.scenario, plat: item.plat || 'xhs',
    passId: item.passId || '', passLabel: item.passLabel || '', at: Date.now(), note: '正在跑',
  } }));
  return item;
}
/* 这一项跑完：记「这类刚跑过」时间戳 + 清欠账/手插 + 落一条已完成
   🌿 日常流程那一项跑完 = 记下"上次刷于何时"（下一轮由执行器下次开跑时再插） */
async function drainQueueFinish(item, summary) {
  const s = summary || {};
  await drainMarkPassRan(item.k, item.scenario, Date.now(), item.plat, item.passId);
  const q = await drainGetQueue();
  const dm = q.dailyMark || { lastAt: 0 };
  const nextMark = (item.scenario === 'daily')
    ? { lastAt: Date.now() }
    : { lastAt: dm.lastAt || 0 };
  const done = [{
    k: item.k, label: item.label || '', scenario: item.scenario, plat: item.plat || 'xhs',
    passId: item.passId || '', passLabel: item.passLabel || '', at: Date.now(),
    foundN: Number(s.foundN) || 0, commentN: Number(s.commentN) || 0, allSkipped: !!s.allSkipped,
    note: String(s.note || ''),
    notes: Array.isArray(s.notes) ? s.notes : [],
  }].concat(q.done);
  await drainSaveQueue(Object.assign({}, q, {
    running: null, done, dailyMark: nextMark,
    carry: q.carry.filter(x => !_drainQHit(x, item.k, item.scenario, item.plat, item.passId)),
    manual: q.manual.filter(x => !_drainQHit(x, item.k, item.scenario, item.plat, item.passId)),
    /* 今天跑成了：之前那笔「跑不了」的账（不管哪天的）一起销掉，别在「之前没跑完的」里还挂着 */
    blocked: (q.blocked && Array.isArray(q.blocked.rows))
      ? { day: String(q.blocked.day || ''), rows: q.blocked.rows.filter(x => !_drainQHit(x, item.k, item.scenario, item.plat, item.passId)) }
      : q.blocked,
  }));
}
/* 这一项没跑完（撞上限/出错/被停）→ 进欠账，下次第一个跑 */
async function drainQueueHold(item, note) {
  const q = await drainGetQueue();
  const prev = (q.carry || []).find(x => _drainQHit(x, item.k, item.scenario, item.plat, item.passId));
  const carry = [{
    k: item.k, label: item.label || '', scenario: item.scenario, plat: item.plat || 'xhs',
    passId: item.passId || '', passLabel: item.passLabel || '',
    /* 哪天欠下的：同一笔账在同一天反复没跑完仍算那天；跨天了才进「之前没跑完的」（2026-11-06） */
    day: (prev && drainQRecDay(prev)) || _drainDayKey(),
    at: Date.now(), note: String(note || ''),
  }].concat(q.carry.filter(x => !_drainQHit(x, item.k, item.scenario, item.plat, item.passId)));
  await drainSaveQueue(Object.assign({}, q, { running: null, carry }));
}
/* 整轮卡死、机器人那头来不及收尾时用：按「正在跑」那一项记欠账，
   保证下次开跑从它接着跑，不无限挂着（2026-11-03 卡住自动收尾） */
async function drainQueueHoldRunning(note) {
  const q = await drainGetQueue();
  const it = q.running;
  if (!it) return null;
  await drainQueueHold(it, note || '卡住了，没跑完');
  return it;
}
/* 队列页行内操作：拎到最前 / 取消（撤掉手插或欠账）
   label：🌿 日常流程项的显示名，别的项留空即可；plat 不传＝小红书
   passId/passLabel：拆行后的「这一次搜索」；不传＝拆行前那种整词项 */
async function drainQueuePushFront(k, scenario, label, plat, passId, passLabel) {
  const q = await drainGetQueue();
  const sc = drainScenarioId(scenario);
  const dayKey = _drainDayKey();
  const manual = [{
    k: String(k), label: String(label || ''), scenario: sc, plat: (plat === 'dy' ? 'dy' : 'xhs'),
    passId: String(passId || ''), passLabel: String(passLabel || ''), at: Date.now(),
  }].concat(q.manual.filter(x => !_drainQHit(x, k, sc, plat, passId)));
  await drainSaveQueue(Object.assign({}, q, {
    manual,
    /* 「接着补」/ 拎到最前＝这一项又要跑了：之前那笔没跑完的欠账、标红一起销掉，别在两处各挂一行 */
    carry: (q.carry || []).filter(x => !_drainQHit(x, k, sc, plat, passId)),
    blocked: (q.blocked && Array.isArray(q.blocked.rows))
      ? { day: String(q.blocked.day || ''), rows: q.blocked.rows.filter(x => !_drainQHit(x, k, sc, plat, passId)) }
      : q.blocked,
    // 拎回最前＝今天这一份又要跑它了：把之前 ✕ 的那一笔撤掉
    drop: (q.drop && q.drop.day === dayKey)
      ? { day: dayKey, keys: q.drop.keys.filter(x => x !== _drainQKey(k, sc, plat, passId) && !(passId && x === _drainQKey(k, sc, plat))) }
      : q.drop,
    // 🌿 手拎到最前的这一趟就不必再留计划里的那条（否则同一趟会排两遍）
    dailyPlan: (sc === 'daily') ? (q.dailyPlan || []).filter(x => x.k !== String(k)) : (q.dailyPlan || []),
  }));
}
async function drainQueueDrop(k, scenario, plat, passId) {
  const q = await drainGetQueue();
  const key = _drainQKey(k, scenario, plat, passId);
  const sc = drainScenarioId(scenario);
  const dayKey = _drainDayKey();
  // ✕ 撤掉的是"今天这一份"：记进当天的名单，派生时不排它；配置里的勾不动（见 drainQDropSet）
  const prevDrop = (q.drop && q.drop.day === dayKey) ? q.drop.keys : [];
  const drop = (sc === 'daily')
    ? { day: dayKey, keys: prevDrop }
    : { day: dayKey, keys: prevDrop.filter(x => x !== key).concat([key]) };
  await drainSaveQueue(Object.assign({}, q, {
    drop,
    manual: q.manual.filter(x => !_drainQHit(x, k, sc, plat, passId)),
    carry: q.carry.filter(x => !_drainQHit(x, k, sc, plat, passId)),
    // 🌿 取消一趟日常浏览＝它排着的计划也一起撤（✕ 就是「这一次不刷」）
    dailyPlan: (sc === 'daily') ? (q.dailyPlan || []).filter(x => x.k !== String(k)) : (q.dailyPlan || []),
  }));
}

/* 这一项没跑起来 → 记一笔（同一天同一项合并计数），返回今天记到第几次。
   n < 3：执行器下次开跑还会自己再试；n ≥ 3：不再反复试，队列页标红等人工处理（见队列页红块）。
   词被停用/属地没填这种「改配置才好」的，直接记进来，不走重试。 */
async function drainQueueBlock(item, why) {
  const q = await drainGetQueue();
  const dayKey = _drainDayKey();
  /* 之前那些天的记录留着（换天不丢）：今天这一项从头数 3 次，之前那笔同项的旧记录并进来 */
  const prevRows = (q.blocked && Array.isArray(q.blocked.rows)) ? q.blocked.rows : [];
  const prev = prevRows.find(x => drainQRecDay(x) === dayKey && _drainQHit(x, item.k, item.scenario, item.plat, item.passId));
  const n = (prev ? Number(prev.n) || 0 : 0) + 1;
  const row = {
    k: item.k, label: item.label || '', scenario: item.scenario, plat: item.plat || 'xhs',
    passId: item.passId || '', passLabel: item.passLabel || '',
    why: String(why || '跑不起来'), at: Date.now(), day: dayKey, n,
  };
  const rows = [row].concat(prevRows.filter(x => !_drainQHit(x, item.k, item.scenario, item.plat, item.passId))).slice(0, 60);
  await drainSaveQueue(Object.assign({}, q, {
    running: null, blocked: { day: dayKey, rows },
    /* 标红这一项在配置表里还在：欠账和手插都撤掉，别让它又排回队头 */
    carry: (q.carry || []).filter(x => !_drainQHit(x, item.k, item.scenario, item.plat, item.passId)),
    manual: (q.manual || []).filter(x => !_drainQHit(x, item.k, item.scenario, item.plat, item.passId)),
  }));
  return n;
}
/* 队列页「再试一次」：把标红这一项撤掉，回到正常排队 */
async function drainQueueUnblock(k, scenario, plat, passId) {
  const q = await drainGetQueue();
  const bk = q.blocked || { day: '', rows: [] };
  await drainSaveQueue(Object.assign({}, q, {
    blocked: { day: bk.day, rows: (bk.rows || []).filter(x => !_drainQHit(x, k, scenario, plat, passId)) },
  }));
}
/* 今天标红的那些（派生队列时跳过，别反复撞同一堵墙）
   一天最多试 3 次：前两次失败只是「这一趟先跳过」，下次开跑照常再排上；
   到第 3 次才从队列里摘掉、等人处理（2026-11-05） */
function drainQBlockSet(q, now) {
  const day = _drainDayKey(now);
  const rows = ((q && q.blocked) || {}).rows || [];
  return new Set(rows.filter(x => (Number(x.n) || 0) >= 3 && drainQRecDay(x) === day)
    .map(x => _drainQKey(x.k, x.scenario, x.plat, x.passId)));
}
/* 「为什么停」：执行器停下时记一笔，队列页顶部据此说明（当天有效，第二天自动过期） */
async function drainQueueLastStop(item, why, extra) {
  const q = await drainGetQueue();
  await drainSaveQueue(Object.assign({}, q, {
    lastStop: {
      k: (item && item.k) || '', label: (item && item.label) || '', scenario: (item && item.scenario) || '',
      passId: (item && item.passId) || '', passLabel: (item && item.passLabel) || '',
      plat: (item && (item.plat || 'xhs')) || 'xhs', why: String(why || ''), at: Date.now(),
      n: Number((extra && extra.n) || 0), global: !!(extra && extra.global),
    },
  }));
}

/* 关键词 × 类型 → 本轮实际要扫的来源清单（词池派生 + 盯的账号主页）
   ★ 只收"到点该跑/该搜"的（每轮跑 / 隔N小时 / 不跑） */
function drainBuildSources(cfg, now) {
  const out = [];
  const c = _drainNormalizeScanCfg(cfg || {});
  for (const e of (c.keywords || [])) {
    if (e.on === false) continue;
    for (const p of drainKeywordPasses(e, c, now)) out.push(Object.assign({ kind: 'search', auto: true }, p));
  }
  // 👤 盯的账号：kind=profile → 进他的个人主页扒（不走搜索词），也跟着大V / 同城本业那一行的周几
  for (const ac of (c.accounts || [])) {
    const apb = (drainScenarioId(ac.scenario) === 'rival') ? 'local' : 'highv';
    if (!drainPbOnDay(c, apb, now)) continue;
    const st = drainAccountState(ac, c, now);
    if (st.mode === 'off' || !st.due) continue;
    out.push({ kind: 'profile', auto: true, k: ac.k, term: ac.k, name: drainAccountLabel(ac), scenario: ac.scenario, sort: '' });
  }
  return out;
}

/* ================= 判断：按类型 + 读到的指标打状态 =================
   signals = { likes, comments, collects, delta, rank, title, myComment }
   myComment = { found, checked, rank, likes, excerpt, at }
     found   我在评论区里找到了自己的评论
     checked 本笔记查过活水（没找到 ≠ 没查过）
   判断是可解释启发式，够支撑维护体验。 */
function drainJudge(scenario, signals, opts) {
  const s = signals || {};
  const t = String(s.title || '');
  const likes = Number(s.likes || 0);
  const delta = Number(s.delta || 0);
  const mc = s.myComment || null;
  const growth = Number((opts && opts.growthDelta) != null ? opts.growthDelta : 50);
  const mineAt = mc && mc.found ? `第${mc.rank || '?'}位${mc.likes != null ? '·👍' + mc.likes : ''}` : '';
  switch (drainScenarioId(scenario)) {
    case 'latest':
      // 最新笔记：盯点赞增量，涨了就赶紧去评论；已经评论过的转为维护
      if (delta >= growth) return { verdict: '点赞+' + delta + ' · 去评论', tone: 'green' };
      if (mc && mc.found) return { verdict: '已评论(' + mineAt + ')', tone: 'blue' };
      return likes > 0 ? { verdict: '爬坡观察 Δ' + delta, tone: 'blue' } : { verdict: '待观察', tone: 'gray' };
    case 'top':
      // 搜索TOP：活水机制——只看我的评论还在不在前排
      if (mc && mc.found) {
        if (mc.rank > 0 && mc.rank <= 3) return { verdict: '黄金位·前3', tone: 'green' };
        return { verdict: '在榜·' + mineAt, tone: 'blue' };
      }
      if (mc && mc.checked) {
        return mc.seen
          ? { verdict: '掉榜 · 去补评论', tone: 'red' }
          : { verdict: '未占位 · 去评论', tone: 'blue' };
      }
      return { verdict: '待查活水', tone: 'gray' };
    case 'local':
      // 本地笔记：不看热度，去评论就行
      if (mc && mc.found) return { verdict: '已评论·本地', tone: 'green' };
      return { verdict: '本地刚需 · 去评论', tone: 'blue' };
    case 'pain': {
      const hit = DRAIN_PAIN_WORDS.some(w => t.includes(w));
      if (mc && mc.found) return { verdict: '在榜·求助', tone: 'green' };
      if (mc && mc.checked) {
        return mc.seen
          ? { verdict: '掉榜 · 去补评论', tone: 'red' }
          : { verdict: '未占位 · 去评论', tone: 'blue' };
      }
      return hit ? { verdict: '求助命中 · 去评论', tone: 'green' } : { verdict: '监控·意图待定', tone: 'gray' };
    }
    case 'rival':
      // 竞对笔记：一个字都不评论，只进去蹲人（有商机的收进获客清单待私信）
      return { verdict: '埋伏·只蹲人不评论', tone: 'purple' };
    case 'cross':
      // 同城异业：在别家行业评论区找本地人；招生的帖子在评论前就跳过了，这里只看自己评论还在不在
      if (mc && mc.found) return { verdict: '已评论·异业', tone: 'green' };
      return mc && mc.checked
        ? { verdict: '未占位 · 去评论', tone: 'blue' }
        : { verdict: '跨行业关联 · 去评论', tone: 'blue' };
    case 'highv':
      return { verdict: '借V监控·溢出', tone: 'purple' };
    default:
      return { verdict: '监控', tone: 'gray' };
  }
}

/* ================= 弹窗渲染：队列配置 / 笔记池（获客分组两个二级页） ================= */
let _drainNotesChanged = null;
let _cand = null;    // 配置页候选区：{ kind:'ai'|'topic', playbook, label, loading, items:[{k,n}] }
let _kwSel = new Set();    // 关键词表：勾了「批量移出」的词，键是「玩法|词」
let _poolSel = new Set();  // 全部词表：勾了「批量删除」的词，键是词本身
let _cfgWant = null; // 跳过来时要展开的候选区：'ai' | 'topic'（页面还没渲染完也认）
let _cfgSec = 'run';  // 配置页横签：现在只剩「run 跑什么」一张卡（推广目标 2026-11-09 已撤）
let _cfgPlanTab = 'find';  // 获客规划页内横签：find＝去哪儿找 / rate＝怎么评（2026-11-12）
const _dbDetOpen = { round: false, social: false };  // 🌿 日常浏览里两个折叠块（一轮怎么刷 / 顺手互动）的展开状态，切 tab 重渲染后照旧
let _lastScanInfo = null;   // 本轮扫描结果 { text, warn }：配置页顶栏下方那行 / 笔记池的提示行
/* 表格里类型下拉的短标签（列窄，完整名放进 title） */
const DRAIN_TYPE_SHORT = { latest: '本地泛搜', top: 'TOP', local: '同城本业', pain: '咨询帖', cross: '同城异业', rival: '同行', highv: '大V' };

/* ⚙️ 配置：队列页的一个横签（跑什么）。统一走 renderScenarioDrain(container,'cfg')，
   任务配置那个独立二级页 2026-10-24 已并进队列页 */

/* 「去配置」统一入口：切到队列页的 ⚙️ 配置 横签（配置文件也被 background.js importScripts，SW 里没有 window） */
function _goCfg() {
  if (typeof window === 'undefined') return;
  try {
    const box = document.getElementById('drainQueueContent');
    if (box) box._qTab = 'bulk';
    if (typeof window.switchMainTab === 'function') window.switchMainTab('queue');
  } catch (_) {}
}

/* ================= 🔁 队列页 =================
   队列项 = 词池里「到点该跑」的那一格（词 × 类型）＝配置表的一个勾 + 一整列的节奏。
   待跑清单现场从配置表派生（改表＝改队列，不存第二份计划）；只有
   「正在跑 / 欠账(carry) / 手插(manual) / 已完成(done)」落 drain_queue。
   这一页只负责看和排：⤴ 拎到最前 / ✕ 取消；动手跑是顶栏那个 🤖 开始。 */
let _drainQChanged = null;
function _drainQTxt(s) { return escHtml(String(s == null ? '' : s)); }
/* 行内 tooltip：喂进来的是已经过 HTML 转义的片段，只剥标签、不二次转义（否则 &amp; 会显示成字面量） */
function _drainQTitle(parts) {
  return parts.filter(Boolean).map(p => String(p).replace(/<[^>]*>/g, '')).join(' · ').replace(/"/g, '&quot;');
}
function _drainQAgo(ts, now) {
  if (!ts) return '从未跑过';
  const d = now - ts;
  if (d < 60000) return '刚刚';
  if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前';
  if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前';
  return Math.floor(d / 86400000) + ' 天前';
}
function _drainQIn(ts, now) {
  if (!ts) return '待定';
  const d = ts - now;
  if (d <= 0) return '现在';
  if (d < 3600000) return Math.ceil(d / 60000) + ' 分钟后';
  if (d < 86400000) return Math.ceil(d / 3600000) + ' 小时后';
  return Math.ceil(d / 86400000) + ' 天后';
}
function _drainQType(scenario) {
  const def = drainScenarioDef(scenario) || {};
  return (def.icon || '') + ' ' + (DRAIN_TYPE_SHORT[def.scenario] || def.label || scenario);
}
/* 计划/执行时间的时刻写法：不是今天的带日期前缀（"09-25 14:20"） */
function _drainQStamp(ts, now) {
  const t = Number(ts) || 0;
  if (!t) return '';
  const d = new Date(t), base = new Date(now || Date.now());
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  return (d.toDateString() === base.toDateString() ? '' : (d.getMonth() + 1) + '-' + d.getDate() + ' ') + hm;
}
/* 到点了还没跑：欠了多久 */
function _drainQLate(ts, now) {
  const d = (now || Date.now()) - (Number(ts) || 0);
  if (d < 60000) return '刚到点';
  if (d < 3600000) return '欠 ' + Math.floor(d / 60000) + ' 分钟';
  if (d < 86400000) return '欠 ' + Math.floor(d / 3600000) + ' 小时';
  return '欠 ' + Math.floor(d / 86400000) + ' 天';
}
/* ================= 📖 评论节奏（队列页顶栏 / 工作台左侧共用这一块） =================
   把「现在到底怎么评论」用大白话写出来：跑法表 · 各列节奏 · 频率上限 · 挡位 · 执行器口径。
   全部现场读配置——改跑法 / 节奏 / 上限 / 挡位，这里跟着变，不另存一份说明文案。
   收起＝一行摘要，点开＝四段：① 队列怎么跑 ② 六类怎么评 ③ 评论长什么样 ④ 评多少 */
const STRAT_WATCH_KEYS = ['drain_scan_cfg', 'note_trend_config', 'auto_water_config', 'auto_water_daily', 'delay_config', 'delay_preset'];
const _stratBound = (typeof WeakSet !== 'undefined') ? new WeakSet() : null;

/* 「每轮都跑 / 每 6 小时 / ''（没开）」 */
function _stratRunTxt(run) {
  if (!run || run.mode === 'off') return '';
  return run.mode === 'each' ? '每轮都跑' : '每 ' + (run.hours || DRAIN_MODE_HOURS_DEFAULT) + ' 小时';
}
/* 这一类的动作描述：由跑法表的 send/find 派生（跑法改了这段必须跟着变，别再手写一份） */
function _stratActTxt(s, pb, growth, cfg) {
  if (pb.send === 'none') return '只在评论区找有商机的人收进获客清单、去私信跟进——绝不评论、不惊动对方';
  const head = (s === 'highv') ? '在头部博主的笔记下' : '对笔记';
  let t;
  if (s === 'latest') t = '点赞一轮涨够 ' + growth + ' 就' + head + '发一条露脸评论抢前排';
  else if (s === 'local') t = '以本地人身份' + head + '评一条；' + '同行揽客的帖子不留言、只收人';
  else if (s === 'cross') t = '以跨行业关联的角度' + head + '评一条';
  else t = head + '发一条露脸评论';
  if (pb.send === 'both') t += '，同时回评论区里搭话 / 追问的人';
  else if (pb.find === 'commenters') t += '，顺手扫评论区把有商机的人收进获客清单';
  else t += '，不扫评论区';
  if (s === 'top' || s === 'pain') t += '；之后回看我的评论还在不在前排（活水维护）';
  if (s === 'highv') t += '，借头部博主的溢出流量';
  return t;
}
/* 六类各自的「开没开 + 节奏 + 来源数」与动作；返回 { rows, live } */
function _stratTypeRows(cfg, growth) {
  const on = (e) => e && e.on !== false;
  const wN = (s) => (cfg.keywords || []).filter(e => on(e) && drainWordTypeOn(e, s)).length;
  const aN = (s) => (cfg.accounts || []).filter(a => on(a) && drainScenarioId(a.scenario || 'highv') === s).length;
  let live = 0;
  const rows = DRAIN_PB_ORDER.map(s => {
    const pb = DRAIN_PLAYBOOK[s];
    const run = (cfg.typeRun || {})[s] || DRAIN_TYPE_RUN_DEFAULT[s];
    const arun = (s === 'local')
      ? ((cfg.acctRun || {}).rival || DRAIN_ACCT_RUN_DEFAULT.rival)
      : ((cfg.acctRun || {})[s] || DRAIN_ACCT_RUN_DEFAULT[s]);
    const words = wN(s), accts = aN(s) + (s === 'local' ? aN('rival') : 0);
    let status, isOn;
    if (s === 'highv') {
      isOn = aN(s) > 0 && arun.mode !== 'off';
      status = (_stratRunTxt(arun) || '整列关着') + ' · ' + (aN(s) ? aN(s) + ' 个账号' : '还没加「盯的账号」');
    } else if (s === 'local') {
      // 同城本业＝词搜（本行/同行通用）＋「盯的账号」里蹲人那一路；两路各走各的节奏，开着哪路说哪路
      const wRun = _stratRunTxt(run), aRun = _stratRunTxt(arun);
      const wPart = (words && wRun) ? (wRun + ' · ' + words + ' 个词') : (words ? '词的节奏关着' : '词上没勾这一列');
      const aPart = (accts && aRun) ? (aRun + ' · ' + accts + ' 个竞对号') : (accts ? '账号的节奏关着' : '还没加竞对号');
      isOn = (words > 0 && !!wRun) || (accts > 0 && !!aRun);
      status = wPart + ' + ' + aPart;
      if (words > 0 && !cfg.city) { status += '（没填同城城市，词搜跑不了）'; isOn = (accts > 0 && !!aRun); }
    } else {
      isOn = words > 0 && run.mode !== 'off';
      status = (_stratRunTxt(run) || '整列关着') + ' · ' + (words ? words + ' 个词' : '词上没勾这一列');
      if (s === 'cross' && !cfg.city) { status += '（没填同城城市，跑不了）'; isOn = false; }
    }
    if (isOn) live++;
    const short = DRAIN_TYPE_SHORT[s] || s;
    const name = pb.icon + ' ' + short + (pb.name && pb.name !== short ? ' · ' + pb.name : '');
    return '<tr class="' + (isOn ? '' : 'off') + '">' +
      '<td class="s-h">' + _drainQTxt(name) + '</td>' +
      '<td class="s-n">' + _drainQTxt(status) + '</td>' +
      '<td class="s-t">' + _drainQTxt(_stratActTxt(s, pb, growth, cfg)) + '</td></tr>';
  });
  return { rows: rows.join(''), live };
}
async function drainPaintStrategy(el) {
  if (!el || typeof document === 'undefined') return;
  const sum = el.querySelector('.strat-h'), body = el.querySelector('.strat-b');
  if (!sum || !body) return;
  try {
    const cfg = await drainGetScanCfg();
    const r = await chrome.storage.local.get(STRAT_WATCH_KEYS.slice(1));
    const trend = r['note_trend_config'] || {};
    const sch = (r['auto_water_config'] || {}).schedule || {};
    const day = new Date().toISOString().slice(0, 10);
    const sentToday = Number((r['auto_water_daily'] || {})[day]) || 0;
    let growth = 50;
    try { growth = Number((await drainGetReplenishCfg()).growthDelta) || 50; } catch (_) {}
    const selScope = document.getElementById('botScopeSel'), selPace = document.getElementById('botPaceSel');
    const scope = (selScope && selScope.value) || 'all';
    const pace = (selPace && selPace.value) || 'interval';
    const { rows, live } = _stratTypeRows(cfg, growth);
    const dailyMax = Number(sch.dailyMax) || 0;
    const perRound = Number(trend.maxPerRound) || Number(sch.perRound) || 0;
    // 挡位：正常有 delay_preset；从没拖过挡位器的人（delay_config 已有值但没落 level）按停留时长倒推一档
    let presetTxt = '';
    if (typeof DELAY_PRESETS !== 'undefined') {
      const dc = r['delay_config'] || {};
      const mid = c => ((Number((c || {}).min) || 0) + (Number((c || {}).max) || 0)) / 2;
      let lvl = Number(r['delay_preset']);
      if (!DELAY_PRESETS.some(x => x.level === lvl)) {
        if (Object.keys(dc).some(k => k !== '_noDelayApplied')) {
          let bd = Infinity;
          DELAY_PRESETS.forEach(x => { const d = Math.abs(mid(x.cfg.browseDwell) - mid(dc.browseDwell)); if (d < bd) { bd = d; lvl = x.level; } });
        } else lvl = -1;
      }
      const p = DELAY_PRESETS.find(x => x.level === lvl);
      if (p) presetTxt = '挡位 ' + p.level + '（' + p.short + '） · ';
    }
    // 每日上限这份老配置已经没有入口了（默认 0=不限）：有值才说，没值就报每轮篇数——那才是真正在卡人的旋钮
    const capTxt = dailyMax > 0 ? '每天最多 <b class="strat-n">' + dailyMax + '</b> 条'
      : (perRound > 0 ? '每次搜索最多 <b class="strat-n">' + perRound + '</b> 篇' : '每次搜索不限篇数');
    sum.innerHTML = '📖 评论节奏：AI 造梗露脸短句 · 现在开着 <b class="strat-n">' + live + '</b> 类 · ' + capTxt + ' · 不该评的自动跳过';
    body.innerHTML =
      '<div class="strat-sec"><span class="strat-sec-h">① 队列怎么跑</span><br>' +
      '到点的一行（一次搜索） → 按这一行搜一批笔记 → 一篇一篇打开 → AI 写一条评论 → 发出 → 该扫评论区的顺手把有商机的人收进获客清单 → 记一笔完成 → 下一行。<br>' +
      '口径：<b>' + (scope === 'growing' ? '只追涨势' : '全部未灌过') + '</b>' +
      (scope === 'growing' ? '（只挑点赞在涨的笔记）' : '（已灌过、队列跑过的自动跳过）') +
      ' ｜ 节奏：<b>' + (pace === 'interval' ? '定时轮' : '一遍跑完') + '</b>' +
      (pace === 'interval' ? '（每 ' + (Number(trend.scanIntervalMin) || 10) + ' 分钟跑一项，把额度摊开到一天）' : '（从队首连跑到队尾）') + '</div>' +
      '<div class="strat-sec"><span class="strat-sec-h">② 六类怎么评</span>' +
      '<table class="strat-tab"><thead><tr><th>类型</th><th>开没开 · 节奏 · 来源</th><th>怎么评</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="strat-sec"><span class="strat-sec-h">③ 评论长什么样</span><br>' +
      'AI 按这一类的口吻写 15~30 字短句（接梗 / 抖机灵 / 捧场），像真人随手留的；不提产品、品牌、链接、主页、私信。严肃、悲伤、纠纷这类内容自动「跳过」不评；刚发出去的那条也不会被当成商机回头再回一遍。</div>' +
      '<div class="strat-sec"><span class="strat-sec-h">④ 评多少</span><br>' +
      presetTxt + '每次搜索最多打开 <b>' + (perRound > 0 ? perRound + ' 篇' : '不限篇数') + '</b>' +
      ' · 同一篇 <b>' + (Number(trend.cooldownHours) || 24) + ' 小时</b>内不重评（每篇总次数 ≤ ' + (Number(trend.maxPerNote) || 2) + '）' +
      ' · 今天已发 <b>' + sentToday + ' 条</b>' + (dailyMax > 0 ? '（每天最多 ' + dailyMax + ' 条）' : '（没设每日上限）') +
      '。跑满这个数就换下一行（下一次搜索），不在一行上耗到底。</div>';
    if (_stratBound && !_stratBound.has(el)) {
      _stratBound.add(el);
      chrome.storage.onChanged.addListener((ch, area) => {
        if (area !== 'local' || !el.isConnected) return;
        if (!Object.keys(ch).some(k => STRAT_WATCH_KEYS.indexOf(k) >= 0)) return;
        drainPaintStrategy(el);
      });
    }
  } catch (e) {
    sum.textContent = '📖 评论节奏：暂时读不出来（' + ((e && e.message) || e) + '）';
    body.innerHTML = '';
  }
}
if (typeof window !== 'undefined') window.drainPaintStrategy = drainPaintStrategy;
/* 两处入口都是静态标记 → 本文件加载完先各画一次（队列页渲染 / 切回工作台时还会再刷新） */
if (typeof document !== 'undefined') {
  const _paintAllStrat = () => document.querySelectorAll('details.strat-fold').forEach(el => drainPaintStrategy(el));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _paintAllStrat);
  else setTimeout(_paintAllStrat, 0);
}

/* ================= 工作台队列条（2026-10-29 确认单）=================
   默认收成一行「今天 N 个词 · M 项 · 正在跑第 i 个「词」· 已完成 k 个词」；
   点 ▾ 展开清单①：一行一个关键词，类型小标带状态色（正在跑 / 待跑 / 计划（几点到点）/ 已完成）
   ＋ 进度第 x/y 项 ＋ 战果 ＋ ⤴ 拎到最前 / ✕ 从今天清单撤掉。
   数据与队列页同一个派生（drainQueuePlan）；今天这份顺序有 todayPlan 就照它。 */
let _bqOpen = false;

/* 公网这边读的是云端镜像那本队列账：客户机上真正在跑的那本不在这儿，
   所以「正在跑哪个词 / 今天跑过几项 / 停在哪」一直是空的。执行器现在随播报捎一份摘要上来，
   本地那几格空着就拿它补（只补展示用的几样，todayPlan / drop / dailyMark 仍用本地这份）。 */
function drainQueueWithBench(q, bench) {
  if (!q || !bench || typeof bench !== 'object') return q;
  const pick = (x) => (x && (x.k || x.label)) ? {
    k: String(x.k || ''), label: String(x.label || ''), scenario: String(x.scenario || ''),
    plat: (x.plat === 'dy') ? 'dy' : 'xhs',
    passId: String(x.passId || ''), passLabel: String(x.passLabel || ''), at: Number(x.at) || 0,
    foundN: Number(x.foundN) || 0, commentN: Number(x.commentN) || 0,
    allSkipped: !!x.allSkipped, why: String(x.why || ''), n: Number(x.n) || 0,
    day: String(x.day || ''), note: String(x.note || ''),
  } : null;
  const out = Object.assign({}, q);
  if (!out.running && bench.running) out.running = pick(bench.running);
  if (!(Array.isArray(out.done) && out.done.length) && Array.isArray(bench.done)) {
    out.done = bench.done.map(pick).filter(Boolean);
  }
  if (Array.isArray(bench.carry) && bench.carry.length) {
    const have = new Set((Array.isArray(out.carry) ? out.carry : []).map(x => _drainQKey(x.k, x.scenario, x.plat, x.passId)));
    out.carry = (Array.isArray(out.carry) ? out.carry.slice() : [])
      .concat(bench.carry.map(pick).filter(x => x && !have.has(_drainQKey(x.k, x.scenario, x.plat, x.passId))));
  }
  const bkRows = (out.blocked && Array.isArray(out.blocked.rows)) ? out.blocked.rows : [];
  if (!bkRows.length && Array.isArray(bench.blocked) && bench.blocked.length) {
    out.blocked = { day: String(bench.blocked[0].day || ''), rows: bench.blocked.map(pick).filter(Boolean) };
  }
  if (!out.lastStop && bench.lastStop) out.lastStop = pick(bench.lastStop);
  return out;
}

async function renderBenchQueueBar() {
  const host = document.getElementById('benchQueueBar');
  const sumEl = document.getElementById('bqSummary');
  const bodyEl = document.getElementById('queueBody');
  const capsEl = document.getElementById('queueCaps');
  if (!host || !sumEl || !bodyEl) return;
  const now = Date.now();
  const cfg = await drainGetScanCfg();
  const q = drainQueueWithBench(await drainGetQueue(), window.__xhsExecBench || null);
  const p = drainQueuePlan(cfg, q, now, await drainDailyCtx());
  const d0 = new Date(now);
  const dayKey = d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') + '-' + String(d0.getDate()).padStart(2, '0');
  /* 今天这份顺序只在配置没动时认；配置改过＝按新配置重排，旧的顺序作废（2026-11-04） */
  const tpKeys = (q.todayPlan && q.todayPlan.day === dayKey && q.todayPlan.keys.length
    && (!q.todayPlan.sig || q.todayPlan.sig === drainCfgSig(cfg))) ? q.todayPlan.keys : [];
  const rank = (it) => { const i = tpKeys.indexOf(_drainQKey(it.k, it.scenario, it.plat, it.passId)); return i < 0 ? 1e9 : i; };
  const keyOf = (it) => _drainQKey(it.k, it.scenario, it.plat, it.passId);
  const runKey = p.running ? keyOf(p.running) : '';
  const today0 = d0.toDateString();
  /* 今天的回执只留还配着的那几条：词删了 / 这一列关了的不再占一行（2026-11-04） */
  const doneToday = (q.done || []).filter(x => new Date(x.at).toDateString() === today0 && drainQRowLive(x, cfg));
  /* 今天跑过的回执：一次搜索可能隔几小时再跑一遍，按「这一次搜索」留最新那笔 */
  const doneByKey = new Map();
  doneToday.forEach(it => { const kk = _drainQKey(it.k, it.scenario, it.plat, it.passId); if (!doneByKey.has(kk)) doneByKey.set(kk, it); });

  /* 今天这一份：正在跑 + 待跑 + 计划 + 已完成（同一项只在一边出现） */
  const items = [];
  if (p.running) items.push(Object.assign({}, p.running, { _st: 'run' }));
  p.todo.forEach(it => { if (runKey && keyOf(it) === runKey) return; items.push(Object.assign({}, it, { _st: 'todo' })); });
  p.waiting.forEach(it => { if (runKey && keyOf(it) === runKey) return; items.push(Object.assign({}, it, { _st: 'wait' })); });
  doneToday.forEach(it => {
    if (items.some(x => keyOf(x) === keyOf(it))) return;
    items.push(Object.assign({}, it, { _st: 'done', _old: drainIsLegacyDone(it, cfg) }));
  });
  items.sort((a, b) => {
    const ra = a._st === 'run' ? -1 : rank(a), rb = b._st === 'run' ? -1 : rank(b);
    return (ra - rb) || ((a.sort || 0) - (b.sort || 0)) || ((a.nextAt || 0) - (b.nextAt || 0));
  });
  /* 拆行前的老记录照样显示，但不计入「今天几次搜索」；编号也只数今天的搜索 */
  const total = items.filter(x => !x._old).length;
  const oldN = items.filter(x => x._old).length;
  const posOf = new Map();
  let _pos = 0;
  items.forEach((it) => { if (it._old) return; const kk = keyOf(it); if (!posOf.has(kk)) posOf.set(kk, ++_pos); });

  /* 一行一个关键词：日常那一趟、盯的账号各自成一行 */
  const rows = [];
  const rowByGk = new Map();
  items.forEach(it => {
    const gk = it.daily ? ('daily|' + it.k + '|' + (it.planId || '')) : (it.acct ? 'acct|' + it.k : 'kw|' + it.k);
    let g = rowByGk.get(gk);
    if (!g) {
      g = { gk, k: it.k, name: it.daily ? (it.label || it.k) : (it.acct ? (it.label || it.k) : it.k), items: [], first: posOf.get(keyOf(it)) || 99 };
      rowByGk.set(gk, g); rows.push(g);
    }
    g.items.push(it);
  });

  const wordsOn = (cfg.keywords || []).filter(e => e.on !== false);
  const kwRows = rows.filter(g => !g.gk.startsWith('daily|') && !g.gk.startsWith('acct|'));
  /* 已跑：今天排过的搜索里跑过的次数（拆行前那种整词老账不算） */
  let doneN = 0;
  doneByKey.forEach((rec) => { if (!drainIsLegacyDone(rec, cfg)) doneN++; });
  const badN = (p.blocked || []).filter(x => (Number(x.n) || 0) >= 3).length + (p.noCity || []).length;
  const runItem = (function () {
    for (const g of rows) { const hit = g.items.find(x => x._st === 'run'); if (hit) return hit; }
    return null;
  })();

  /* ── 顶部那一行：几个词、几次搜索、跑到哪（2026-11-03 拆行） ── */
  let sum = '';
  if (!kwRows.length && !wordsOn.length && !(cfg.accounts || []).length) {
    sum = '<span class="bq-sub">还没配关键词：</span><a href="#" id="bqToCfg">去队列页加词</a>';
  } else if (!total) {
    const why = drainQueueEmptyWhy(cfg, now);
    sum = '<span class="bq-sub">今天一项都没排' + (why ? '：' + escHtml(why) : '') + '</span>';
  } else {
    const runNm = runItem
      ? (runItem.daily ? (runItem.label || '日常浏览') : (runItem.acct ? (runItem.label || runItem.k) : runItem.k))
      : '';
    const runTxt = runItem
      ? ' · 正在跑：<b>' + escHtml(runNm) + '</b>' + (runItem.passLabel ? ' · ' + escHtml(runItem.passLabel) : '')
      : '';
    sum = '今天 <b>' + kwRows.length + '</b> 个词 · <b>' + total + '</b> 次搜索 · 已跑 <b>' + doneN + '</b> 次' + runTxt;
    if (oldN) sum += ' · <span class="bq-sub">另旧账 ' + oldN + ' 条（不计入）</span>';
    if (badN) sum += ' · <b style="color:#dc2626;">' + badN + '</b> 次等你处理';
    /* 之前那些天没跑完的：今天不跟着排，展开清单能看到，点「接着补」才补（2026-11-06） */
    if ((p.pending || []).length) sum += ' · <span class="bq-sub" style="color:#1d4ed8;">之前没跑完 <b>' + p.pending.length + '</b> 次（在底下，点才补）</span>';
  }
  /* 配置改过：今天这份已经按新配置重排了（2026-11-04）；已经跑完的不重跑，只提示一句 */
  const cfgChanged = !!(q.todayPlan && q.todayPlan.day === dayKey && q.todayPlan.sig && q.todayPlan.sig !== drainCfgSig(cfg));
  if (cfgChanged) {
    sum += '<span style="display:block;font-size:11.5px;color:#b45309;font-weight:600;margin-top:2px;">⚠️ 配置改过了：今天的清单已经按新配置重排（跑完的不重跑）</span>';
  }
  sumEl.innerHTML = sum;

  /* ── 清单①：一行一次搜索（一个词名下 TOP 三行、咨询帖四行，各写筛选条件） ── */
  const icoOf = (it) => it.daily ? '🌿' : (it.acct ? '👤' : (drainScenarioDef(it.scenario).icon || ''));
  const typeOf = (it) => it.daily ? '日常浏览' : (it.acct ? (it.scenario === 'rival' ? '蹲人' : '借势') : (DRAIN_TYPE_SHORT[it.scenario] || it.scenario));
  const nameOf = (it) => it.daily ? (it.label || '日常浏览') : (it.acct ? (it.label || it.k) : it.k);
  /* 筛选条件：新记录自带；拆行前的老记录（没有 passId）统一写「整词（旧）」；没有筛选的类不写 */
  const filtOf = (it) => {
    if (it.daily) return '';
    if (it.acct) return '主页最新';
    if (it.passLabel) return it.passLabel;
    return (it._st === 'done' || it._st === 'run') ? '整词（旧）' : '';
  };
  const progOf = (it) => {
    if (it._st === 'run') return '<span class="bq-prog">正在跑</span>';
    const drec = doneByKey.get(keyOf(it));
    const resTxt = drec
      ? (drec.allSkipped
        ? ('搜到 ' + (Number(drec.foundN) || 0) + ' 篇 · 都评过了 · 0 条')
        : ('找到 ' + (Number(drec.foundN) || 0) + ' 篇 · 评论 ' + (Number(drec.commentN) || 0) + ' 条'))
      : '';
    /* 已经跑过的：先报上一次的结果；今天还要再跑一遍的，把下次到点接在后面 */
    if (it._st === 'done') return '<span class="bq-prog" style="color:#0a7b5a;font-weight:600;">✅ ' + resTxt + '</span>';
    if (it._st === 'wait') {
      const next = it.nextAt ? (_drainQStamp(it.nextAt, now) + ' 到点') : '计划';
      return drec
        ? '<span class="bq-prog" style="color:#0a7b5a;font-weight:600;">✅ ' + resTxt + '</span><span class="bq-prog">' + next + '</span>'
        : '<span class="bq-prog">' + next + '</span>';
    }
    return drec
      ? '<span class="bq-prog" style="color:#0a7b5a;font-weight:600;">✅ ' + resTxt + '</span><span class="bq-prog">待跑</span>'
      : '<span class="bq-prog">待跑</span>';
  };
  const rowHtml = (it) => {
    const isRun = it._st === 'run';
    const isDone = it._st === 'done';
    const nm = nameOf(it);
    const filt = filtOf(it);
    const why = it.why || '';
    const canOp = it._st === 'todo' || it._st === 'wait';
    const ops = canOp
      ? '<span class="bq-ops">' +
          '<button type="button" data-bq-front="' + escAttr(it.k) + '" data-bq-name="' + escAttr(nm) + '" data-bq-sc="' + escAttr(it.scenario) + '" data-bq-plat="' + escAttr(it.plat || 'xhs') + '" data-bq-pass="' + escAttr(it.passId || '') + '" data-bq-plabel="' + escAttr(it.passLabel || '') + '" title="拎到最前：只动这一次搜索">⤴</button>' +
          '<button type="button" data-bq-drop="' + escAttr(it.k) + '" data-bq-name="' + escAttr(nm) + '" data-bq-sc="' + escAttr(it.scenario) + '" data-bq-plat="' + escAttr(it.plat || 'xhs') + '" data-bq-pass="' + escAttr(it.passId || '') + '" title="从今天这份清单撤掉这一次搜索（配置里的勾不动）">✕</button>' +
        '</span>'
      : '';
    return '<div class="bq-row' + (isRun ? ' is-run' : '') + (isDone ? ' is-done' : '') + '">' +
      '<span class="bq-no">' + (posOf.get(keyOf(it)) || '') + '</span>' +
      '<span class="bq-name" title="' + escAttr(nm) + '">' + escHtml(nm) + '</span>' +
      (why ? '<span class="bq-why">· ' + escHtml(why) + '</span>' : '') +
      '<span class="bq-types"><span class="bq-t ' + it._st + '">' + icoOf(it) + escHtml(typeOf(it)) + '</span></span>' +
      (filt ? '<span class="bq-filt" title="筛选条件">' + escHtml(filt) + '</span>' : '') +
      progOf(it) +
      ops +
      '</div>';
  };
  const bodyHtml = rows.map(g => {
    const nNew = g.items.filter(x => !x._old).length;
    const nOld = g.items.length - nNew;
    const head = g.gk.startsWith('kw|')
      ? '<div class="bq-grp">' + escHtml(g.name)
        + (nNew ? ' · ' + nNew + ' 次搜索' : '')
        + (nOld ? ' · 旧账 ' + nOld + ' 条（不计入）' : '') + '</div>'
      : (g.gk.startsWith('acct|') ? '<div class="bq-grp">👤 ' + escHtml(g.name) + '</div>' : '');
    return head + g.items.map(rowHtml).join('');
  }).join('');
  /* ── 顶部两条提示（老板 2026-10-30 定：为什么停、哪些项在等你处理，都别只写进日志） ──
     ① 告警条：最后一次停在哪一项、什么原因；
     ② 红块：今天跑不了的项（连续跑不起来 / 词被停用 / 属地没填），留着等他处理，不再悄悄丢 */
  const _bkName = (x) => x.label || x.k;
  const _bkType = (x) => {
    const sc = (x && typeof x === 'object') ? x.scenario : x;
    const nm = ((DRAIN_PLAYBOOK[sc] || {}).name || sc);
    const fl = (x && typeof x === 'object' && x.passLabel) ? (' · ' + x.passLabel) : '';
    return nm + fl;
  };
  const _stopTxt = (function () {
    const s = p.lastStop;
    if (!s || !s.why) return '';
    const t = new Date(s.at || Date.now());
    const hh = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    const qa = cfg.queueAuto || {};
    const tail = qa.enabled
      ? '｜⏰ 每周自动跑开着，下一个到点会自己再拉起'
      : '｜点「🤖 开始」就从这一行接着跑';
    return '<div style="background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:8px;padding:6px 10px;font-size:11.5px;line-height:1.6;margin-bottom:8px;">'
      + '⏸ 队列停在「' + escHtml(_bkName(s)) + '」· ' + (_bkType(s)) + ' · ' + hh + '：' + escHtml(s.why) + tail + '</div>';
  })();
  const _redRows = (p.blocked || []).filter(x => (Number(x.n) || 0) >= 3);
  const _amberRows = (p.blocked || []).filter(x => (Number(x.n) || 0) < 3);
  const _cityRows = (p.noCity || []);
  /* 🔵 「之前没跑完的」（2026-11-06）：昨天/前天…欠下的、标红的都不跟着今天排，
     点「接着补」才把它拎回今天队头。展开清单才看得到，收起时只在顶上一句里报个数。 */
  const _pendRows = (p.pending || []);
  const _pendType = (x) => x.acct
    ? (x.scenario === 'rival' ? '🕵️ 蹲人' : '👑 借势')
    : (x.scenario === 'daily' ? '🌿 日常浏览' : _bkType(x));
  const _pendHtml = _pendRows.length
    ? '<div style="margin-top:10px;border-top:1px dashed #93c5fd;padding-top:8px;">'
      + '<div style="font-size:11.5px;font-weight:700;color:#1d4ed8;margin-bottom:4px;">⏸ 之前没跑完（' + _pendRows.length + ' 次）— 不点「接着补」今天不跑它</div>'
      + _pendRows.map(x => {
        const when = _drainQStamp(x.at, now);
        const tail = x.kind === 'red'
          ? ('跑不了 · ' + (x.why || '跑不起来'))
          : ('没跑完' + (x.why ? ' · ' + x.why : ''));
        return '<div style="display:flex;align-items:center;gap:8px;font-size:11.5px;padding:3px 0;flex-wrap:wrap;">'
          + '<span style="color:#1e40af;font-weight:600;">' + escHtml(_bkName(x)) + '</span>'
          + '<span style="color:#9ca3af;">· ' + escHtml(_pendType(x)) + (x.plat === 'dy' ? '（抖音）' : '') + '</span>'
          + '<span style="color:' + (x.kind === 'red' ? '#dc2626' : '#1d4ed8') + ';flex:1;min-width:120px;">' + escHtml(when + ' ' + tail) + '</span>'
          + '<button type="button" class="btn btn-sm" data-bq-pick="' + escAttr(x.k) + '" data-bq-name="' + escAttr(_bkName(x)) + '" data-bq-sc="' + escAttr(String(x.scenario || '')) + '" data-bq-plat="' + escAttr(x.plat || 'xhs') + '" data-bq-pass="' + escAttr(x.passId || '') + '" data-bq-plabel="' + escAttr(x.passLabel || '') + '" title="排到今天队头，下一趟第一个跑它">接着补</button>'
          + '</div>';
      }).join('')
      + '</div>'
    : '';
  const _redHtml = (_redRows.length || _amberRows.length || _cityRows.length)
    ? '<div style="margin-top:10px;border-top:1px dashed #fca5a5;padding-top:8px;">'
      + (_redRows.length || _cityRows.length
        ? '<div style="font-size:11.5px;font-weight:700;color:#b91c1c;margin-bottom:4px;">🔴 这些次搜索今天跑不了，等你处理（' + (_redRows.length + _cityRows.length) + ' 次）</div>'
          + _redRows.map(x => '<div style="display:flex;align-items:center;gap:8px;font-size:11.5px;padding:3px 0;flex-wrap:wrap;">'
            + '<span style="color:#dc2626;font-weight:600;">' + escHtml(_bkName(x)) + '</span>'
            + '<span style="color:#9ca3af;">· ' + escHtml(_bkType(x)) + (x.plat === 'dy' ? '（抖音）' : '') + '</span>'
            + '<span style="color:#dc2626;flex:1;min-width:120px;">' + escHtml(x.why || '跑不起来') + '（今天第 ' + Number(x.n) + ' 次）</span>'
            + '<button type="button" class="btn btn-sm" data-bq-retry="' + escAttr(x.k) + '" data-bq-sc="' + escAttr(String(x.scenario || '')) + '" data-bq-plat="' + escAttr(x.plat || 'xhs') + '" data-bq-pass="' + escAttr(x.passId || '') + '" data-bq-plabel="' + escAttr(x.passLabel || '') + '" title="撤掉标红，让它重新排队">再试一次</button>'
          + '</div>').join('')
          + _cityRows.map(x => '<div style="display:flex;align-items:center;gap:8px;font-size:11.5px;padding:3px 0;flex-wrap:wrap;">'
            + '<span style="color:#dc2626;font-weight:600;">' + escHtml(x.k) + '</span>'
            + '<span style="color:#9ca3af;">· ' + escHtml(_bkType(x)) + '</span>'
            + '<span style="color:#dc2626;flex:1;min-width:120px;">这一类的搜法要带属地，可城市还没填</span>'
            + '<span style="color:#9a3412;">到「📊 诊断」页的「同城挡位 &amp; 城市」填一下就好</span>'
          + '</div>').join('')
        : '')
      + (_amberRows.length
        ? '<div style="font-size:11.5px;font-weight:700;color:#b45309;margin:' + (_redRows.length || _cityRows.length ? '8px 0 4px' : '0 0 4px') + ';">🟡 这些次搜索这一趟没跑成，下次开跑自动再试（今天最多试 3 次，满 3 次才标红）</div>'
          + _amberRows.map(x => '<div style="display:flex;align-items:center;gap:8px;font-size:11.5px;padding:3px 0;flex-wrap:wrap;">'
            + '<span style="color:#b45309;font-weight:600;">' + escHtml(_bkName(x)) + '</span>'
            + '<span style="color:#9ca3af;">· ' + escHtml(_bkType(x)) + (x.plat === 'dy' ? '（抖音）' : '') + '</span>'
            + '<span style="color:#b45309;flex:1;min-width:120px;">今天第 ' + Number(x.n) + ' 次没跑成：' + escHtml(x.why || '跑不起来') + '</span>'
          + '</div>').join('')
        : '')
      + '</div>'
    : '';
  bodyEl.innerHTML = _stopTxt + (items.length
    ? bodyHtml
    : '<div class="bq-empty">' + (wordsOn.length || (cfg.accounts || []).length
      ? '今天没有排到点的搜索' + (p.waiting.length ? ' · 计划里还有 ' + p.waiting.length + ' 次搜索' : '')
      : '还没配关键词<br><a href="#" id="bqToCfg2">去队列页加词</a>') + '</div>') + _pendHtml + _redHtml;

  /* ── 底下那行：今日评论额度 / 待跑数 / ⏰ 每周自动跑 ── */
  if (capsEl) {
    let used = 0, dailyMax = 0;
    try {
      const d = await chrome.storage.local.get(['auto_water_daily', 'auto_water_config']);
      const day = new Date().toISOString().slice(0, 10);
      used = Number((d['auto_water_daily'] || {})[day]) || 0;
      dailyMax = Number((((d['auto_water_config'] || {}).schedule) || {}).dailyMax) || 0;
    } catch (_) {}
    const qa = cfg.queueAuto || { enabled: false, days: [], from: '09:00', to: '18:00' };
    const qaDayList = (qa.days || []).slice().sort((x, y) => x - y);
    const qaTxt = qa.enabled
      ? ((qaDayList.length ? qaDayList.map(d => WK_LABELS[d]).join('、') : '还没选星期') + ' ' + (qa.from === qa.to ? '全天' : qa.from + '–' + qa.to))
      : '关';
    capsEl.innerHTML = '<div style="font-size:11.5px;color:#6b7280;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
      '<span>今日评论 <b>' + used + '</b>' + (dailyMax > 0 ? '/' + dailyMax : '（不限）') +
      ' · 待跑 <b>' + p.todo.length + '</b> 次搜索' + (p.waiting.length ? ' · 计划 ' + p.waiting.length + ' 次' : '') +
      (p.noCity.length ? ' · <span style="color:#d97706;">⚠️ 本地没填属地，' + p.noCity.length + ' 次不参与</span>' : '') + '</span>' +
      /* 2026-10-30：跑动时段搬到顶上「今天」弹窗里配——那儿跟「现在在不在跑」摆在一起 */
      '<span>⏰ 自己跑：' + escHtml(qaTxt) + '（在顶上「今天」里改）</span></div>';
  }

  /* 空态那颗「去队列页加词」/ 点关键词行 → 回队列页 */
  const toCfg = () => { try { if (typeof switchMainTab === 'function') switchMainTab('queue'); } catch (_) {} };
  bodyEl.querySelectorAll('#bqToCfg, #bqToCfg2').forEach(a => a.onclick = (e) => { e.preventDefault(); toCfg(); });
  host.querySelectorAll('#bqToCfg').forEach(a => a.onclick = (e) => { e.preventDefault(); toCfg(); });
  /* ⤴ 拎到最前 / ✕ 从今天这份撤掉（只动今天这一份，不回写配置） */
  bodyEl.querySelectorAll('[data-bq-front]').forEach(btn => btn.onclick = async () => {
    const k = btn.getAttribute('data-bq-front');
    const nm = btn.getAttribute('data-bq-name') || k;
    const sc = btn.getAttribute('data-bq-sc') || 'latest';
    const plat = btn.getAttribute('data-bq-plat') || 'xhs';
    const pid = btn.getAttribute('data-bq-pass') || '';
    const plabel = btn.getAttribute('data-bq-plabel') || '';
    await drainQueuePushFront(k, sc, nm, plat, pid, plabel);
    drainToast('已拎到最前：' + nm + (plabel ? ' · ' + plabel : ''));
    await renderBenchQueueBar();
  });
  /* 🔵 「之前没跑完的」那颗「接着补」：排回今天队头 + 把旧的那笔没跑完/标红销掉 */
  bodyEl.querySelectorAll('[data-bq-pick]').forEach(btn => btn.onclick = async () => {
    const k = btn.getAttribute('data-bq-pick');
    const nm = btn.getAttribute('data-bq-name') || k;
    const sc = btn.getAttribute('data-bq-sc') || 'latest';
    const plat = btn.getAttribute('data-bq-plat') || 'xhs';
    const pid = btn.getAttribute('data-bq-pass') || '';
    const plabel = btn.getAttribute('data-bq-plabel') || '';
    await drainQueuePushFront(k, sc, nm, plat, pid, plabel);
    drainToast('已接着补：' + nm + '（下一趟第一个跑它）');
    await renderBenchQueueBar();
  });
  /* 🔴 标红那块的「再试一次」：撤掉标红 + 顺手把它拎到最前，下一趟第一个试它 */
  bodyEl.querySelectorAll('[data-bq-retry]').forEach(btn => btn.onclick = async () => {
    const k = btn.getAttribute('data-bq-retry');
    const sc = btn.getAttribute('data-bq-sc') || 'latest';
    const plat = btn.getAttribute('data-bq-plat') || 'xhs';
    const pid = btn.getAttribute('data-bq-pass') || '';
    const plabel = btn.getAttribute('data-bq-plabel') || '';
    await drainQueueUnblock(k, sc, plat, pid);
    await drainQueuePushFront(k, sc, '', plat, pid, plabel);
    drainToast('已重新排上：下一趟第一个试它');
    await renderBenchQueueBar();
  });
  bodyEl.querySelectorAll('[data-bq-drop]').forEach(btn => btn.onclick = async () => {
    const k = btn.getAttribute('data-bq-drop');
    const nm = btn.getAttribute('data-bq-name') || k;
    const sc = btn.getAttribute('data-bq-sc') || 'latest';
    const plat = btn.getAttribute('data-bq-plat') || 'xhs';
    await drainQueueDrop(k, sc, plat, btn.getAttribute('data-bq-pass') || '');
    drainToast('已从今天这份撤掉：' + nm + '（配置里的勾还在）');
    await renderBenchQueueBar();
  });

  /* 收/展：默认收成一行，点 ▾ 展开清单① */
  const bqBody = document.getElementById('bqBody');
  const bqTri = document.getElementById('bqTri');
  const paintOpen = () => {
    if (bqBody) bqBody.style.display = _bqOpen ? '' : 'none';
    if (bqTri) bqTri.textContent = _bqOpen ? '▴' : '▾';
  };
  if (bqTri && !bqTri.dataset.bqWired) {
    bqTri.dataset.bqWired = '1';
    bqTri.onclick = () => { _bqOpen = !_bqOpen; paintOpen(); };
  }
  paintOpen();
  const dailyBtn = document.getElementById('bqDailyBtn');
  if (dailyBtn) dailyBtn.onclick = async () => {
    await drainInsertBrowseOnce();
    await renderBenchQueueBar();
  };
  const manualBtn = document.getElementById('bqManualBtn');
  if (manualBtn) manualBtn.onclick = () => { try { if (typeof switchMainTab === 'function') switchMainTab('scenarioDrain'); } catch (_) {} };
}
if (typeof window !== 'undefined') window.renderBenchQueueBar = renderBenchQueueBar;

/* 🌿 塞一趟日常浏览：队列页那颗和工作台那颗共用这一口，不依赖队列页有没有画过。
   返回 'ok' | 'off'（没开通这一档） */
async function drainInsertBrowseOnce() {
  const db = await drainDailyCtx();
  if (!db || !db.cfg) { drainToast('这一档没开通「日常浏览」', 'warn'); return 'off'; }
  if (db.cfg.enabled === false) drainToast('日常浏览总开关是关的：手塞的照跑，队列不会自动排它', 'warn');
  const dir = (typeof DailyBrowse !== 'undefined' && DailyBrowse.dir)
    ? DailyBrowse.dir()
    : { id: 'd1', name: '日常浏览' };
  const now = Date.now();
  const q = await drainGetQueue();
  const plan = (q.dailyPlan || []).slice();
  plan.push({ id: 'dp' + now + Math.random().toString(36).slice(2, 6), k: dir.id, label: dir.name, at: now });
  await drainSaveQueue(Object.assign({}, q, { dailyPlan: plan }));
  drainToast('🌿 已塞 1 趟待跑：刷一轮首页');
  return 'ok';
}

async function renderDrainQueue(container) {
  if (!container) return;
  /* 2026-10-29 确认单：运行清单（正在跑 / 待跑 / 计划 / 已完成）搬到工作台，这页只剩配置。
     运行清单那两个节点已经在工作台里（#benchQueueBar 底下），这里只画配置那一块。 */
  if (!container.querySelector('#drainCfgContent')) return;
  container._qTab = 'bulk';
  /* ⚙️ 批量那一屏：进来才画（配置页自己管卡的展开/收起）。同一次进入只画一次——
     队列 render() 会因 storage 变化反复跑，别把正在填的输入框刷掉 */
  let _bulkMounted = false;
  const mountBulk = () => {
    if (_bulkMounted) return;
    const cfgBox = container.querySelector('#drainCfgContent');
    if (!cfgBox) return;
    _bulkMounted = true;
    renderScenarioDrain(cfgBox, 'cfg');
  };
  const paintView = () => {
    /* 2026-10-29 确认单：队列页只做配置——进来就直接画那张大表；
       正在跑 / 待跑 / 计划 / 已完成 全搬工作台（顶上那两行灰字 2026-11-04 撤了，改完存一次在右上角报一句） */
    const cfgBox = container.querySelector('#drainCfgContent');
    if (cfgBox) cfgBox.style.display = '';
    mountBulk();
  };
  /* 右上是配置表里的两颗入口（盯的账号 / 日常浏览），这里把弹窗口子挂给配置页用 */
  const q1 = (sel) => container.querySelector(sel);
  container._openAcct = openAcctModal;
  container._openBrowse = openBrowseModal;
  container._insertBrowse = insertBrowse;

  if (_drainQChanged) chrome.storage.onChanged.removeListener(_drainQChanged);
  _drainQChanged = (changes, area) => {
    if (area !== 'local' || !container.isConnected) return;
    // auto_water_state.live = 执行器正在发第几篇的第几条（💬 评论条队列的实时进度）
    if (!changes[DRAIN_QUEUE_KEY] && !changes[DRAIN_SCAN_KEY] && !changes['auto_water_state']) return;
    render();
  };
  chrome.storage.onChanged.addListener(_drainQChanged);

  /* ── 两个弹窗：👤 盯的账号 / 🌿 日常浏览 ── */
  const closeModal = (id) => { const m = container.querySelector('#' + id); if (m) m.classList.remove('open'); };
  container.querySelectorAll('#qAcctModal, #qBrowseModal').forEach(m => {
    m.onclick = (ev) => { if (ev.target === m) m.classList.remove('open'); };
  });
  if (q1('#qAcctClose')) q1('#qAcctClose').onclick = () => closeModal('qAcctModal');
  if (q1('#qBrowseClose')) q1('#qBrowseClose').onclick = () => closeModal('qBrowseModal');
  async function openAcctModal() {
    const m = container.querySelector('#qAcctModal');
    if (!m) return;
    m.classList.add('open');
    await renderAcctPanel(container.querySelector('#qAcctBody'));
  }
  async function openBrowseModal() {
    const m = container.querySelector('#qBrowseModal');
    if (!m) return;
    m.classList.add('open');
    try { await chrome.storage.local.set({ drain_q_hint_off: true }); } catch (_) {}
    await renderDailyPanel(container.querySelector('#qBrowseBody'));
  }
  /* 🌿 本体：往队列里塞 1 趟待跑（现在）；点一次只塞一趟，要多刷再点一次。 */
  async function insertBrowse() {
    const r = await drainInsertBrowseOnce();
    if (r === 'nodir') await openBrowseModal();
    else if (r === 'ok') await render();
  }

  async function render() {
    /* 运行清单搬去工作台（2026-10-29 确认单）：这页只画配置那一块 + 评论策略；
       工作台那条队列条自己算自己的（renderBenchQueueBar），两边不互相刷 */
    paintView();
    const sw = container.querySelector('#qStratWrap');
    if (sw) sw.style.display = '';
    await drainPaintStrategy(container.querySelector('#qStrat'));
    try { if (typeof window.renderBenchQueueBar === 'function') await window.renderBenchQueueBar(); } catch (_) {}
  }
  container._qRender = render;   // 让「批量」保存后 / 切回队列时能就地重算（网页版没有存储变更回推）
  await render();
}

/* ================= 👤 盯的账号 / 🌿 日常浏览 两个弹窗（2026-10-28 v2） =================
   队列页右上那两个按钮点开的都是这里。数据还是同一份真源：
   👤 → cfg.accounts + cfg.acctRun；🌿 → DailyBrowse 的配置与今日账本。
   改完就地重画弹窗，同时让队列那一屏重算（save 里调 qb._qRender）。 */

async function renderAcctPanel(root) {
  if (!root) return;
  const cfg = await drainGetScanCfg();
  const accts = cfg.accounts || [];
  const now = Date.now();
  const ago = (ts) => {
    if (!ts) return '还没盯过';
    const m = Math.round((now - ts) / 60000);
    return m < 1 ? '刚盯过' : (m < 60 ? m + ' 分钟前' : Math.round(m / 60) + ' 小时前');
  };
  const save = async (next, msg) => {
    await drainSaveScanCfg(Object.assign({}, cfg, next));
    if (msg) drainToast(msg);
    const qb = document.getElementById('drainQueueContent');
    if (qb && typeof qb._qRender === 'function') await qb._qRender();
    await renderAcctPanel(root);
  };
  /* 这个号单独的节奏：留空＝跟随「整列」（acctRun 那一列）；选了小时数就按这个号自己算 */
  const hoursOpts = (a) => {
    const g = (cfg.acctRun || {})[a.scenario] || {};
    const follow = '跟随整列（' + (g.mode === 'each' ? '每轮跑' : (g.mode === 'off' ? '不跑' : '每' + (g.hours || 12) + '小时')) + '）';
    const cur = Number(a.hours) || 0;
    // 这个号身上带着预设之外的小时数（老配置 / 手改过）→ 补一项，别让它显示成「跟随整列」
    const opts = (cur > 0 && DRAIN_RUN_PRESETS.indexOf(cur) < 0) ? DRAIN_RUN_PRESETS.concat([cur]).sort((x, y) => x - y) : DRAIN_RUN_PRESETS;
    return '<option value="">' + escHtml(follow) + '</option>' +
      opts.map(h => '<option value="' + h + '"' + (cur === h ? ' selected' : '') + '>每' + h + '小时</option>').join('');
  };
  const rows = accts.map((a, i) => {
    const st = drainAccountState(a, cfg, now);
    const pid = _drainProfileId(a.k) || a.k;
    const sub = (a.name ? '主页 ID · ' + pid : String(a.k)) + ' · ' + (st.lastAt ? '上次 ' + ago(st.lastAt) : '还没盯过') +
      (st.mode === 'off' ? ' · 这一列不跑' : '');
    return '<div class="acc-row">' +
      '<input type="checkbox" data-qacc-on="' + i + '"' + (a.on !== false ? ' checked' : '') + ' style="width:14px;height:14px;margin:3px 0 0;accent-color:var(--c-brand);cursor:pointer;" title="' + escAttr(a.on !== false ? '停用：暂时不盯这个号（还留着）' : '启用') + '">' +
      '<div class="acc-main"><div class="acc-name">' + escHtml(drainAccountLabel(a)) + '</div><div class="acc-sub">' + escHtml(sub) + '</div></div>' +
      '<div class="acc-op">' +
        '<select class="ie-sel" data-qacc-sc="' + i + '" title="借势＝在他笔记下发一条露脸热评借流量，顺带扫评论区；蹲人＝只扫评论区把有商机的人收进获客清单去私信">' +
          '<option value="highv"' + (a.scenario !== 'rival' ? ' selected' : '') + '>👑 借势</option>' +
          '<option value="rival"' + (a.scenario === 'rival' ? ' selected' : '') + '>🕵️ 蹲人</option>' +
        '</select>' +
        '<select class="ie-sel" data-qacc-h="' + i + '" title="多久进他主页看一次新笔记（单独设了就以这里为准）">' + hoursOpts(a) + '</select>' +
        '<button type="button" class="del" data-qacc-del="' + i + '" title="取消盯这个账号">✕</button>' +
      '</div></div>';
  }).join('');
  root.innerHTML =
    '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px;">' +
      '<span style="font-size:12px;color:#6b7280;">共 ' + accts.length + ' · 启用 ' + accts.filter(a => a.on !== false).length + '</span>' +
      '<span style="flex:1;"></span>' +
      '<button type="button" class="btn btn-sm" id="qAccGrab" title="你现在停在博主主页上时，点它直接把那个主页加进来">📥 抓当前页主页</button>' +
    '</div>' +
    (rows || '<div style="padding:18px 8px;text-align:center;color:#9ca3af;font-size:12px;line-height:2;">还没盯人<br>打开一个博主的主页点右上「📥 抓当前页主页」，或把主页链接粘到下面回车</div>') +
    '<input id="qAccAdd" placeholder="粘博主主页链接后回车" style="width:100%;box-sizing:border-box;margin-top:8px;padding:6px 8px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;outline:none;">' +
    '<div style="font-size:10.5px;color:#9ca3af;margin-top:5px;line-height:1.7;">盯人走主页：进他的个人主页扒最近笔记（不是拿名字去搜，搜名字会漏会串）。节奏留空＝跟随整列，单独选了就按这个号自己算。</div>';

  root.querySelectorAll('[data-qacc-on]').forEach(c => c.onchange = async () => {
    const i = parseInt(c.getAttribute('data-qacc-on'), 10);
    const next = accts.map(a => Object.assign({}, a));
    next[i].on = c.checked;
    await save({ accounts: next }, c.checked ? '👤 继续盯：' + drainAccountLabel(next[i]) : '👤 暂停盯：' + drainAccountLabel(next[i]));
  });
  root.querySelectorAll('[data-qacc-sc]').forEach(s => s.onchange = async () => {
    const i = parseInt(s.getAttribute('data-qacc-sc'), 10);
    const next = accts.map(a => Object.assign({}, a));
    next[i].scenario = s.value === 'rival' ? 'rival' : 'highv';
    await save({ accounts: next }, '已改成 ' + (next[i].scenario === 'rival' ? '🕵️ 蹲人（只扫商机私信）' : '👑 借势（发露脸热评）'));
  });
  root.querySelectorAll('[data-qacc-h]').forEach(s => s.onchange = async () => {
    const i = parseInt(s.getAttribute('data-qacc-h'), 10);
    const h = Number(s.value) || 0;
    const next = accts.map(a => {
      const o = Object.assign({}, a);
      if (h > 0) o.hours = h; else delete o.hours;
      return o;
    });
    await save({ accounts: next }, h > 0 ? ('这个号：每 ' + h + ' 小时进一次主页') : '这个号：跟随整列节奏');
  });
  root.querySelectorAll('[data-qacc-del]').forEach(b => b.onclick = async () => {
    const i = parseInt(b.getAttribute('data-qacc-del'), 10);
    const a = accts[i];
    if (!a) return;
    if (!window.confirm('取消盯「' + drainAccountLabel(a) + '」？他名下排着的那一项也会一起撤掉。')) return;
    await drainQueueDrop(a.k, a.scenario);
    await save({ accounts: accts.filter((_, j) => j !== i) }, '已取消盯这个账号');
  });
  const addOne = async (url, name) => {
    if (!/^https?:\/\/[^/]*xiaohongshu\.com\/user\/profile\//.test(url)) {
      drainToast('要博主主页链接：打开他的主页→复制网址，或点「📥 抓当前页主页」', 'warn');
      return false;
    }
    const pid = _drainProfileId(url);
    if (accts.some(a => (pid && _drainProfileId(a.k) === pid) || a.k === url)) { drainToast('这个主页已经在盯了', 'warn'); return false; }
    await save({ accounts: accts.concat([{ k: url, name: (name || '').trim(), on: true, scenario: 'highv' }]) },
      '已加入：' + (name || pid || url) + '（默认 👑 借势，右边可改蹲人）');
    return true;
  };
  const add = root.querySelector('#qAccAdd');
  if (add) add.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const v = String(add.value || '').trim();
    if (!v) return;
    if (await addOne(v, '')) add.value = '';
  });
  const grab = root.querySelector('#qAccGrab');
  if (grab) grab.onclick = async () => {
    grab.disabled = true;
    grab.textContent = '抓取中…';
    let d;
    try { d = await drainGrabActiveProfile(); } catch (err) { drainToast('抓取失败：' + ((err && err.message) || err), 'warn'); }
    grab.disabled = false;
    grab.textContent = '📥 抓当前页主页';
    if (d === undefined) return;
    if (!d) { drainToast('当前不在博主主页：要停在 xiaohongshu.com/user/profile/… 那个页面', 'warn'); return; }
    await addOne(d.url, d.name);
  };
}

async function renderDailyPanel(root) {
  if (!root) return;
  if (typeof DailyBrowse === 'undefined') {
    root.innerHTML = '<div style="padding:16px 8px;text-align:center;color:#9ca3af;font-size:12px;">这一档没开通「日常浏览」。</div>';
    return;
  }
  const c = await DailyBrowse.getConfig();
  const dl = await DailyBrowse.getDaily();
  const au = c.autorun || { enabled: false, from: '09:00', to: '21:00' };
  const repaint = () => renderDailyPanel(root);
  const num = (key, label, val, min, max, unit, tip) =>
    '<label class="nbr" title="' + escAttr(tip || '') + '">' + label +
    '<input type="number" data-dbn="' + key + '" value="' + val + '" min="' + min + '" max="' + max + '">' + (unit || '') + '</label>';
  /* 状态区：今天刷了多少、顺手互动、每天自动跑实况 */
  let autoLine;
  if (au.enabled) {
    const nowMs = Date.now();
    let hold = 0, broke = null, rs = {};
    try {
      hold = await DailyBrowse.autoHoldUntil();
      broke = (await chrome.storage.local.get('daily_browse_broken')).daily_browse_broken;
      rs = (await chrome.storage.local.get('daily_browse_run_state')).daily_browse_run_state || {};
    } catch (_) {}
    let s;
    if (rs.running) s = '<b style="color:#0a8f4c;">正在跑</b>';
    else if (hold > nowMs) s = '<span style="color:#d97706;">今天被「停止本轮」按住，不再自动拉起（点「🤖 开始」即刻恢复）</span>';
    else if (broke && (nowMs - (Number(broke.at) || 0)) < 30 * 60000) s = '<span style="color:#dc2626;">连续 3 次没跑起来，歇 30 分钟再看（先确认小红书页面正常）</span>';
    else s = DailyBrowse.autorunOn(c, nowMs) ? '时段内：到点会自己把队列拉起来' : ('还没到时段（' + escHtml(au.from) + ' 开始）');
    autoLine = '⏰ 每天自动开跑 ' + escHtml(au.from) + '–' + escHtml(au.to) + '：' + s;
  } else {
    autoLine = '⏰ 每天自动开跑：<span style="color:#6b7280;">关（打开＝不用守着点开始，时段内整条队列自己跑）</span>';
  }
  const l1 = '🌿 今日刷 <b>' + (dl.count || 0) + '</b> 篇' +
    '　💬 评论 ' + ((dl.comments || 0) + (dl.replies || 0)) + ' · 关注 ' + (dl.follows || 0) +
    '　已跑 ' + (dl.rounds || 0) + ' 轮';
  root.innerHTML =
    /* ① 开关：只管"跑队列时要不要先刷一轮"，名字写清楚、说明贴在旁边 */
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">' +
      '<label style="display:inline-flex;align-items:center;gap:5px;font-size:12.5px;color:#374151;font-weight:700;"><input type="checkbox" id="qDbOn"' + (c.enabled ? ' checked' : '') + ' style="width:14px;height:14px;accent-color:var(--c-brand);cursor:pointer;"> 每趟跑队列，先刷一轮首页</label>' +
      '<span style="flex:1;"></span>' +
      '<button type="button" class="btn btn-sm" id="qDbStop" title="让当前这一轮刷完手上这篇就停；队列里其他项不受影响。点过它，今天不会再自动拉起（明天照常）">⏹ 停止本轮</button>' +
    '</div>' +
    '<div style="font-size:10.5px;color:#9ca3af;line-height:1.6;margin-bottom:8px;">' +
      (c.enabled
        ? '打开着：每次跑队列（手点开始 / 每天自动开跑）会先插一轮刷首页。'
        : '关着：队列不会自动插它；在队列页点「🌿 塞一趟」手塞的照跑一次。') +
    '</div>' +
    '<div style="background:#f8fafc;border:1px solid #eef0f3;border-radius:8px;padding:7px 10px;font-size:12px;color:#374151;line-height:1.75;margin-bottom:10px;">' +
      '<div>' + l1 + '</div><div>' + autoLine + '</div>' +
    '</div>' +
    '<div style="font-size:12px;font-weight:700;color:#1f2937;margin:8px 0 4px;">一轮怎么刷 <span style="font-weight:400;font-size:10.5px;color:#9ca3af;">只在首页推荐里刷，不按关键词搜</span></div>' +
    '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px 10px;">' +
      num('perRoundMin', '每轮', c.perRoundMin, 1, 40, '篇') +
      num('perRoundMax', '~', c.perRoundMax, c.perRoundMin, 40, '篇', '每轮在这两个数之间随机取一个：比如 18~22，就差不多每轮 20 篇') +
      num('openRate', '打开', c.openRate, 0, 100, '%', '刷到的笔记里打开细看的比例') +
    '</div>' +
    '<div style="font-size:12px;font-weight:700;color:#1f2937;margin:10px 0 4px;">打开后怎么看法 <span style="font-weight:400;font-size:10.5px;color:#9ca3af;">按打开的篇数算，余下＝正常看</span></div>' +
    '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px 10px;">' +
      num('bounceRate', '⚡ 秒退', c.bounceRate, 0, 100, '%', '打开后 2~5 秒就退：看一眼不感兴趣就划走') +
      num('fullRate', '👀 看完', c.fullRate, 0, 100, '%', '视频播到结尾 / 图文翻到底，最长 2 分钟') +
      '<label class="nbr" title="秒退和看完之外剩下的比例，自动算">正常看<span style="font-weight:400;color:#6b7280;">（余下）</span><input type="number" id="dbNormPct" value="' + Math.max(0, 100 - c.bounceRate - c.fullRate) + '" readonly style="background:#f3f4f6;width:52px;"></label>' +
    '</div>' +
    '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px 10px;margin-top:4px;">' +
      num('dwellMin', '正常看停留', c.dwellMin, 3, 120, '~') +
      num('dwellMax', '', c.dwellMax, 3, 300, '秒', '正常看那一档停多久：图文翻半段就走，视频从中间起、最多到上限的 1.6 倍（封顶 2 分钟）') +
      num('likeRate', '点赞', c.likeRate, 0, 100, '%') +
      num('collectRate', '收藏', c.collectRate, 0, 100, '%') +
    '</div>' +
    '<div style="font-size:10.5px;color:#9ca3af;margin-top:2px;">秒退那一眼就走，不点赞/收藏/评论/关注；其余按下面的概率来，不是每篇都做</div>' +
    '<div style="font-size:12px;font-weight:700;color:#1f2937;margin:10px 0 4px;">顺手互动 <span style="font-weight:400;font-size:10.5px;color:#9ca3af;">只按概率，不设每天几条；填 0% ＝ 这个动作不做</span></div>' +
    '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px 10px;">' +
      num('comment.rate', '💬 评论：打开的笔记里', c.comment.rate, 0, 100, '%', '发一条新评论，或者回评论区里某个人一句——都算这一项，不另设概率') +
      num('follow.rate', '➕ 关注作者：打开的笔记里', c.follow.rate, 0, 100, '%') +
    '</div>' +
    '<div style="font-size:10.5px;color:#9ca3af;margin-top:2px;">一天的总量由「账号安全」那道挡位兜着（评论——含回别人一句——按挡位合计），这里不再单独卡条数</div>' +
    '<div style="font-size:12px;font-weight:700;color:#1f2937;margin:14px 0 6px;border-top:1px dashed #e5e7eb;padding-top:10px;">整条队列什么时候自己开跑 <span style="font-weight:400;font-size:10.5px;color:#9ca3af;">跟上面那个开关不是一回事</span></div>' +
    '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;">' +
      '<label style="font-size:12px;color:#374151;font-weight:600;"><input type="checkbox" id="qmAutoOn"' + (au.enabled ? ' checked' : '') + ' style="vertical-align:middle;"> 每天自动开跑</label>' +
      '<input id="qmFrom" maxlength="5" value="' + escAttr(String(au.from || '09:00')) + '" style="width:58px;padding:3px 6px;border:1px solid #e5e7eb;border-radius:6px;font-size:12px;text-align:center;">' +
      '<span style="font-size:11px;color:#9ca3af;">→</span>' +
      '<input id="qmTo" maxlength="5" value="' + escAttr(String(au.to || '21:00')) + '" style="width:58px;padding:3px 6px;border:1px solid #e5e7eb;border-radius:6px;font-size:12px;text-align:center;">' +
      '<span style="font-size:10.5px;color:#9ca3af;">（起止一样＝全天）</span>' +
      '<span style="flex:1;"></span>' +
      '<button type="button" class="btn btn-sm btn-primary" id="qDbAutoSave">💾 保存</button>' +
    '</div>' +
    '<div style="font-size:10.5px;color:#9ca3af;margin-top:6px;line-height:1.7;">每趟开跑（手点开始 / 每天自动开跑）时插一轮到队首；在队列页点「🌿 塞一趟」是马上塞一趟待跑。刷了什么、赞藏评了什么不进消息 / 通知 / 线索 / 评论记录。</div>';

  const dbSave = async (patch, msg) => {
    try { await DailyBrowse.saveConfig(patch); }
    catch (e) { drainToast('保存失败：' + ((e && e.message) || e), 'warn'); return; }
    if (msg) drainToast(msg);
    const qb = document.getElementById('drainQueueContent');
    if (qb && typeof qb._qRender === 'function') await qb._qRender();
  };
  const on = root.querySelector('#qDbOn');
  if (on) on.onchange = async () => {
    await dbSave({ enabled: on.checked }, on.checked ? '🌿 日常浏览已开：每趟跑队列会先刷一轮' : '🌿 日常浏览已关：队列不再自动插它（手塞的照跑）');
    await repaint();
  };
  const stop = root.querySelector('#qDbStop');
  if (stop) stop.onclick = async () => {
    await DailyBrowse.stop();
    drainToast('⏹ 已发出停止：这一轮刷完手上这篇就停（今天不再自动拉起）');
    await repaint();
  };
  /* 数字旋钮：改了就存（不重画，输入框不失焦） */
  root.querySelectorAll('[data-dbn]').forEach(el => el.onchange = async () => {
    const key = el.getAttribute('data-dbn');
    const v = parseInt(el.value, 10);
    if (!isFinite(v)) return;
    const patch = {};
    if (key.indexOf('.') > 0) {
      const ps = key.split('.');
      patch[ps[0]] = Object.assign({}, c[ps[0]] || {}, { [ps[1]]: v });
    } else patch[key] = v;
    await dbSave(patch);
    /* 每轮上下限：按输入框当下的值对齐（下限改到上限之上 → 上限跟着抬上来，当场看得见） */
    if (key === 'perRoundMin' || key === 'perRoundMax') {
      const mnEl = root.querySelector('[data-dbn="perRoundMin"]');
      const mxEl = root.querySelector('[data-dbn="perRoundMax"]');
      const mn = parseInt(mnEl && mnEl.value, 10) || 1;
      const mx = parseInt(mxEl && mxEl.value, 10) || mn;
      if (mx < mn) {
        if (mxEl) mxEl.value = mn;
        await dbSave({ perRoundMax: mn }, '每轮上限跟着抬到 ' + mn + ' 篇');
      }
    }
    /* 秒退＋看完合计不能超 100：超了就把另一项压下来，余下那格跟着变 */
    if (key === 'bounceRate' || key === 'fullRate') {
      const bEl = root.querySelector('[data-dbn="bounceRate"]');
      const fEl = root.querySelector('[data-dbn="fullRate"]');
      let b = Math.max(0, parseInt(bEl && bEl.value, 10) || 0);
      let f = Math.max(0, parseInt(fEl && fEl.value, 10) || 0);
      if (b + f > 100) {
        if (key === 'bounceRate') { f = Math.max(0, 100 - b); if (fEl) fEl.value = f; }
        else { b = Math.max(0, 100 - f); if (bEl) bEl.value = b; }
        await dbSave({ bounceRate: b, fullRate: f }, '秒退＋看完不能超过 100%，另一项已压到 ' + (100 - (key === 'bounceRate' ? b : f)) + '%');
      }
      const nEl = root.querySelector('#dbNormPct');
      if (nEl) nEl.value = Math.max(0, 100 - b - f);
    }
  });
  const autoSave = root.querySelector('#qDbAutoSave');
  if (autoSave) autoSave.onclick = async () => {
    const from = String((root.querySelector('#qmFrom') || {}).value || '').trim();
    const to = String((root.querySelector('#qmTo') || {}).value || '').trim();
    if (!/^\d{1,2}:\d{2}$/.test(from) || !/^\d{1,2}:\d{2}$/.test(to)) { drainToast('时段要写成 09:00 这样（起止一样＝全天）', 'warn'); return; }
    const autoOn = !!(root.querySelector('#qmAutoOn') || {}).checked;
    await dbSave({ autorun: { enabled: autoOn, from: from, to: to } }, '🌿 已保存：每天自动开跑 ' + (autoOn ? (from === to ? '全天' : from + '–' + to) : '关'));
    try { chrome.runtime.sendMessage({ action: 'dailyAutoKick' }); } catch (_) {}
    await repaint();
  };
}

/* 从别的页面（灌水页的「✨ 找词 / 🏷 话题」）点过来 → 切到「队列 → ⚙️ 配置」并展开候选区。
   切页会重渲染配置卡，所以意图挂在 _cfgWant 上，渲染尾去取（同页，不走 storage）。
   本文件同时被 background.js 用 importScripts 加载，Service Worker 里没有 window：
   顶层裸写 window.xxx 会直接抛错、打断后台启动（消息路由全部失效），必须挡在 typeof 里 */
if (typeof window !== 'undefined') {
  window.drainOpenCandidates = async (kind) => {
    _cfgSec = 'run';
    _cfgWant = (kind === 'topic') ? 'topic' : 'ai';
    // 落到队列页的「⚙️ 配置」那一签（切页会重渲染，意图在渲染尾取走）
    try { const box = document.getElementById('drainQueueContent'); if (box) box._qTab = 'bulk'; } catch (_) {}
    if (typeof window.switchMainTab === 'function') window.switchMainTab('queue');
  };
}

async function renderScenarioDrain(container, mode) {
  if (!container) return;
  const isCfg = mode === 'cfg';
  if (_drainNotesChanged) chrome.storage.onChanged.removeListener(_drainNotesChanged);
  const _sel = (id) => container.querySelector('#' + id);
  let notes = await drainLoad();
  const st = { scenario: 'all', showDead: true, busyGrab: false, growthDelta: 50, cfg: null };

  container.innerHTML = `
    <style>
      .sx-wrap{padding:14px;font-size:13px;color:var(--ink,#1f2937);}
      .sx-bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px;}
      .sx-bar select,.sx-in{font-size:12px;padding:6px 8px;border:1px solid #e5e7eb;border-radius:8px;color:#1f2937;background:#fff;outline:none;}
      .sx-hint{font-size:11px;color:#8a8f99;line-height:1.7;margin:8px 0;}
      .sx-count{font-size:12px;color:#6b7280;}
      .sx-empty{text-align:center;color:#9ca3af;padding:30px 10px;font-size:12px;line-height:2;}
      /* 笔记列表：表格（沿用获客清单 .pl-table 的表头观感） */
      .sx-table{width:100%;table-layout:fixed;}
      .sx-table tbody td{padding:6px 6px;border-bottom:1px solid var(--line);vertical-align:middle;font-size:12px;}
      .sx-table tbody tr:hover td{background:#fafafa;}
      .sx-table .sx-t-type{width:74px;}
      /* 数据列：点赞 / 评论 / 二级评论 合成一格（2026-11-08 复盘并进来，给评论列腾地方）；
         没采集过整格写「—」，鼠标停上去看表头说明 */
      .sx-table .sx-t-nums{width:88px;text-align:right;font-size:11.5px;color:#374151;font-variant-numeric:tabular-nums;white-space:nowrap;}
      .sx-nums-empty{color:#c7ccd4;font-size:11px;}
      .sx-table .sx-t-judge{width:104px;}
      .sx-table .sx-t-ops{width:62px;text-align:center;}
      /* 我们回的：最近 3 天的评论逐条摊在每一行里（复盘并进笔记池） */
      .sx-table .sx-col-note{width:26%;}
      .sx-table .sx-t-cmt{width:auto;vertical-align:top;}
      .sx-bar .sx-btn{font-size:12px;padding:6px 10px;border:1px solid var(--c-brand-line,#cfe4f5);border-radius:8px;background:var(--c-brand-soft,#f2f8fd);color:var(--c-brand-ink,#0a6b8a);cursor:pointer;font-weight:700;font-family:inherit;}
      .sx-bar .sx-btn:hover{filter:brightness(.98);}
      .sx-bar .sx-btn:disabled{color:#9ca3af;background:#f8fafc;border-color:#eceef0;cursor:default;font-weight:400;}
      /* 📊 这几天：按天算的处理 / 评论账（2026-11-05） */
      .sx-daily{border:1px solid var(--line,#eceef0);border-radius:10px;background:linear-gradient(180deg,#fff 0%,#fdfafb 100%);padding:10px 12px;margin-bottom:10px;}
      .sx-daily-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px;font-weight:800;color:#1f2937;}
      .sx-daily-h .tag{font-size:10.5px;font-weight:600;color:#6b7280;background:#f6f8fa;border:1px solid var(--line,#eceef0);border-radius:20px;padding:1px 8px;}
      .sx-daily-seg{display:inline-flex;border:1px solid #e5e7eb;border-radius:7px;overflow:hidden;background:#fff;}
      .sx-daily-seg button{border:0;background:#fff;font:inherit;font-size:11px;color:#4b5563;padding:3px 9px;cursor:pointer;}
      .sx-daily-seg button+button{border-left:1px solid var(--line,#eceef0);}
      .sx-daily-seg button.on{background:#fdecef;color:#c41d3c;font-weight:700;}
      .sx-daily-num{display:flex;gap:20px;flex-wrap:wrap;margin-top:8px;}
      .sx-daily-num .cell b{font-size:20px;font-variant-numeric:tabular-nums;margin-right:4px;}
      .sx-daily-num .cell span{font-size:11.5px;color:#6b7280;}
      .sx-daily-num .cell.a b{color:#c41d3c;}
      .sx-daily-num .cell.b b{color:#0a6b8a;}
      .sx-daily-why{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;}
      .sx-daily-pill{font-size:10.5px;border-radius:20px;padding:1px 8px;background:#fdf3e3;color:#b45309;}
      .sx-daily-pill.g{background:#eaf7ef;color:#1f7a45;}
      .sx-daily-pill.gray{background:#f3f4f6;color:#6b7280;}
      .sx-daily-tbl{width:100%;border-collapse:collapse;margin-top:6px;}
      .sx-daily-tbl th{font-size:10.5px;color:#6b7280;text-align:left;padding:4px 6px;border-bottom:1px solid var(--line,#eceef0);white-space:nowrap;}
      .sx-daily-tbl td{font-size:12px;padding:5px 6px;border-bottom:1px dashed var(--line,#eceef0);font-variant-numeric:tabular-nums;}
      .sx-daily-tbl tr:last-child td{border-bottom:0;}
      .sx-daily-tbl .d{color:#6b7280;white-space:nowrap;}
      .sx-daily-tbl .num{font-weight:700;}
      .sx-daily-bar{height:7px;border-radius:4px;background:#f1f3f5;overflow:hidden;min-width:80px;}
      .sx-daily-bar i{display:block;height:7px;background:#e3b7c1;border-radius:4px;}
      .sx-daily-bar.b i{background:#9cc8d8;}
      .sx-rec{margin-top:3px;font-size:10.5px;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .sx-rec.ok{color:#0a8f4c;}
      .sx-rec.no{color:#b45309;}
      .sx-col-note a,.sx-note-t{display:block;color:#1f2937;text-decoration:none;font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .sx-col-note a:hover{color:var(--c-brand-text);}
      .sx-sub{font-size:10px;color:#8a8f99;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      /* 笔记列元信息行：作者/时间 + 行末的 ✕（操作列只留「打开」，移除收进这一行） */
      .sx-sub-row{display:flex;align-items:center;gap:6px;}
      .sx-sub-tx{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .sx-row-del{flex:0 0 auto;border:0;background:none;padding:0 2px;font-size:11px;line-height:1;color:#c7ccd4;cursor:pointer;}
      .sx-row-del:hover{color:#d32f2f;}
      .sx-ico{border:1px solid #e5e7eb;background:#fff;border-radius:6px;width:22px;height:22px;font-size:11px;line-height:1;padding:0;cursor:pointer;color:#4b5563;}
      .sx-ico+.sx-ico{margin-left:3px;}
      .sx-ico:hover{border-color:var(--c-brand);color:var(--c-brand-text);}
      .sx-ico-del:hover{border-color:#d32f2f;color:#d32f2f;}
      /* 🧭 渠道排班（2026-11-12）：四列——渠道 / 周几跑 / 同城 / 出词策略 */
      .pbp-table{width:100%;min-width:680px;border-collapse:collapse;table-layout:fixed;}
      .pbp-table th{background:#f8fafc;color:#6b7280;font-size:10.5px;font-weight:700;text-align:left;padding:7px 10px;border-bottom:1px solid #eef0f3;white-space:nowrap;}
      .pbp-table td{padding:7px 10px;border-bottom:1px dashed #eef0f3;vertical-align:top;}
      .pbp-table tbody tr:hover td{background:#fcfdfe;}
      .pbp-name{font-size:12px;font-weight:700;color:#1f2937;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .pbp-name .qhelp{margin-left:2px;}
      .pbp-name .pbp-sub{display:block;font-size:10px;font-weight:500;color:#9ca3af;margin-top:2px;overflow:hidden;text-overflow:ellipsis;}
      .pbp-days{display:flex;gap:3px;flex:0 0 auto;}
      .pbp-day{width:27px;height:23px;font-size:11px;border:1px solid #e5e7eb;background:#fff;border-radius:6px;color:#9ca3af;cursor:pointer;padding:0;}
      .pbp-day:hover{border-color:var(--c-brand-line);}
      .pbp-day.on{border-color:var(--c-brand-line);background:var(--c-brand-soft);color:var(--c-brand-ink);font-weight:700;}
      .pbp-day.today{box-shadow:inset 0 0 0 1px #f59e0b;}
      .pbp-per{width:46px;font-size:11px;padding:3px 4px;border:1px solid #e5e7eb;border-radius:6px;color:#374151;background:#fff;outline:none;text-align:center;}
      .pbp-storepills{display:inline-flex;border:1px solid #e5e7eb;border-radius:7px;overflow:hidden;background:#fff;}
      .pbp-storepills button{border:0;background:#fff;color:#4b5563;font:inherit;font-size:11px;padding:3px 10px;cursor:pointer;}
      .pbp-storepills button+button{border-left:1px solid #eef0f3;}
      .pbp-storepills button.on{background:var(--c-brand-soft2,#e6f3fb);color:var(--c-brand-ink,#0a6b8a);font-weight:700;}
      .pbp-storenote{color:#9ca3af;}
      .pbp-dash{color:#b3b9c2;font-size:11px;}
      .pbp-tag{font-size:10.5px;color:#9ca3af;white-space:nowrap;}
      .pbp-tag.on{color:#0a8f4c;font-weight:600;}
      .pbp-tag.off{color:#b45309;}
      .pbp-cnt{font-size:10.5px;color:var(--c-brand-ink,#0a6b8a);background:var(--c-brand-soft,#f2f8fd);border:1px solid var(--c-brand-line,#cfe4f5);border-radius:20px;padding:1px 8px;text-decoration:none;display:inline-block;line-height:1.7;}
      .pbp-cnt:hover{filter:brightness(.97);}
      .pbp-cnt.plain{color:#9ca3af;background:#f8fafc;border-color:var(--line,#eceef0);}
      .pbp-wordcell .pbp-sub2{display:block;font-size:10px;color:#9ca3af;margin-top:3px;}
      .pbp-percell .pbp-tag{white-space:nowrap;}
      /* 🎛 评论策略十列（2026-11-04 老板定）：一格一项，点开就地选，不再挤在一格里 */
      .pbp-chip{display:inline-flex;align-items:center;gap:4px;max-width:100%;border:1px solid #e5e7eb;background:#fff;border-radius:20px;padding:2px 9px;font:inherit;font-size:11px;line-height:1.7;color:#374151;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .pbp-chip:hover{border-color:var(--c-brand-line);background:var(--c-brand-soft);}
      .pbp-chip .cv{font-weight:700;color:var(--c-brand-ink);}
      .pbp-chip.seloff{color:#9ca3af;background:#f8fafc;border-color:#eceef0;}
      .pbp-chip.seloff .cv{color:#9ca3af;font-weight:500;}
      .pbp-chip.warn{color:#b45309;border-color:#fed7aa;background:#fff7ed;}
      .pbp-pop{position:fixed;z-index:99999;background:#fff;border:1px solid #e5e7eb;border-radius:11px;box-shadow:0 12px 32px rgba(16,24,40,.16);padding:9px 10px;min-width:140px;max-width:300px;}
      .pbp-pop-h{font-size:10.5px;line-height:1.6;color:#8a8f99;margin:0 0 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .pbp-popopts{display:flex;flex-wrap:wrap;gap:5px;}
      .pbp-popopt{border:1px solid #e5e7eb;background:#fff;border-radius:8px;padding:4px 9px;font:inherit;font-size:11.5px;color:#374151;cursor:pointer;}
      .pbp-popopt:hover{border-color:var(--c-brand-line);background:var(--c-brand-soft);}
      .pbp-popopt.on{border-color:var(--c-brand-line);background:var(--c-brand-soft2);color:var(--c-brand-ink);font-weight:700;}
      .pbp-popwho{width:290px;}
      .pbp-popwho textarea{width:100%;box-sizing:border-box;border:1px solid #e3e8ee;border-radius:7px;padding:6px 8px;font:inherit;font-size:11.5px;line-height:1.6;color:#374151;resize:vertical;}
      .pbp-popdays{display:flex;gap:4px;}
      .pbp-popday{width:30px;height:28px;border:1px solid #e5e7eb;background:#fff;border-radius:7px;font:inherit;font-size:12px;color:#6b7280;cursor:pointer;padding:0;}
      .pbp-popday.on{background:var(--c-brand-soft2);border-color:var(--c-brand-line);color:var(--c-brand-ink);font-weight:800;}
      .pbp-popquick{display:flex;gap:4px;margin-top:7px;flex-wrap:wrap;}
      .pbp-popquick button{border:0;background:#f3f4f6;border-radius:6px;font:inherit;font-size:10.5px;color:#4b5563;padding:2px 7px;cursor:pointer;}
      .pbp-popquick button:hover{background:var(--c-brand-soft);}
      .pbp-popfoot{display:flex;gap:6px;align-items:center;margin-top:8px;padding-top:7px;border-top:1px solid #f1f3f6;}
      .pbp-popmsg{flex:1;font-size:10.5px;color:#9ca3af;}
      .pbp-todaycell .pbp-tag{border-radius:20px;padding:0 8px;border:1px solid #eceef0;background:#f6f8fa;color:#6b7280;display:inline-block;line-height:1.8;}
      .pbp-todaycell .pbp-tag.on{background:#ecfdf5;border-color:#a7f3d0;color:#047857;}
      .pbp-todaycell .pbp-tag.off{background:#fff7ed;border-color:#fed7aa;color:#9a3412;}
      .pbp-weekcard-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;}
      .pbp-weekcard-h .t{font-size:12.5px;font-weight:700;color:#1f2937;white-space:nowrap;}
      .pbp-weekcard-h .x{font-size:11px;color:#9ca3af;}
      .pbp-weekwrap{overflow-x:auto;}
      .pbp-wkseg{display:inline-flex;border:1px solid #e5e7eb;border-radius:7px;overflow:hidden;background:#fff;}
      .pbp-wkseg button{border:0;background:#fff;font:inherit;font-size:11px;color:#4b5563;padding:3px 10px;cursor:pointer;}
      .pbp-wkseg button+button{border-left:1px solid #eef0f3;}
      .pbp-wkseg button.on{background:var(--c-brand-soft,#f2f8fd);color:var(--c-brand-ink,#0a6b8a);font-weight:700;}
      .pbp-wkwarn{display:inline-block;margin-left:5px;font-size:10.5px;font-weight:700;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:20px;padding:0 6px;line-height:1.7;vertical-align:1px;}
      .pbp-rotbox{margin-top:9px;padding:8px 10px;background:#fafbfc;border:1px solid #eef0f3;border-radius:8px;}
      .pbp-rot{font-size:11.5px;line-height:1.85;color:#4b5563;}
      .pbp-rot.warn{color:#b45309;}
      .pbp-week{width:100%;min-width:760px;border-collapse:collapse;table-layout:fixed;font-size:12px;}
      .pbp-week th,.pbp-week td{border:1px solid #eef0f3;padding:9px 10px;vertical-align:top;text-align:left;}
      .pbp-week th{background:#f8fafc;color:#6b7280;font-weight:700;text-align:center;font-size:11.5px;padding:9px 8px;}
      .pbp-week th.today{color:#b45309;background:#fffbeb;}
      .pbp-week td.pbp-wk-name{font-weight:700;color:#374151;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .pbp-week td.today{background:#f2fbf9;}
      .pbp-week tbody tr:hover td{background:#fcfdfe;}
      .pbp-week tbody tr:hover td.today{background:#effaf7;}
      .pbp-wchip{display:inline-block;background:#f3f4f6;border-radius:8px;padding:3px 8px;margin:2px 2px 0 0;font-size:11.5px;line-height:1.6;color:#4b5563;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:top;}
      .pbp-wempty{color:#d1d5db;font-size:12px;}
      /* 🗣 获客话术（2026-11-03）：每个玩法的话术直接摆在排班行下面，点「改」就地展开 */
      .pbp-scroll{overflow-x:auto;border:1px solid #eef0f3;border-radius:10px;background:#fff;}
      .pbp-talkline{display:flex;align-items:flex-start;gap:6px;padding:5px 8px;background:#f7fbfe;border:1px solid #e3f0f9;border-left:3px solid #9ccbe8;border-radius:6px;font-size:11.5px;line-height:1.7;color:#40566b;}
      .pbp-talkline b{color:#0a6b8a;font-weight:700;margin-right:5px;}
      .pbp-talkline .tx{flex:1;min-width:0;}
      .pbp-talkedit{flex:none;border:1px solid #d5e6f2;background:#fff;color:#0a6b8a;border-radius:20px;font:inherit;font-size:10.5px;padding:0 9px;cursor:pointer;font-weight:600;line-height:20px;}
      .pbp-talkedit:hover{border-color:#9ccbe8;}
      .pbp-tedit{display:none;}
      .pbp-tedit.open{display:table-row;}
      .pbp-tedit>td{padding:0;border-bottom:1px dashed #eef0f3;background:#fbfdff;}
      .pbp-teditbox{padding:10px 12px 12px;border-left:3px solid var(--c-brand,#2b8cc4);}
      .pbp-tedit .hint{font-size:11px;color:#6b7280;line-height:1.7;margin:0 0 6px;}
      .pbp-tedit .storerow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0 0;font-size:11px;color:#6b7280;}
      .pbp-tedit textarea{width:100%;min-height:84px;font:inherit;font-size:12px;line-height:1.8;border:1px solid #e5e7eb;border-radius:7px;padding:7px 9px;color:#374151;background:#fff;resize:vertical;}
      .pbp-tedit textarea:focus{outline:none;border-color:var(--c-brand,#2b8cc4);box-shadow:0 0 0 2px rgba(43,140,196,.12);}
      .pbp-tedit .airow{display:flex;gap:6px;margin-top:7px;background:#f6fbff;border:1px solid #d9ebf7;border-radius:8px;padding:6px 8px;}
      .pbp-tedit .airow .k{font-size:11px;color:#0a6b8a;font-weight:700;align-self:center;white-space:nowrap;}
      .pbp-tedit .airow input{flex:1;min-width:0;font:inherit;font-size:11.5px;border:1px solid #dbe1e8;border-radius:6px;padding:4px 8px;color:#374151;background:#fff;}
      .pbp-tedit .airow input:focus{outline:none;border-color:var(--c-brand,#2b8cc4);box-shadow:0 0 0 2px rgba(43,140,196,.12);}
      .pbp-tedit .talkmsg{font-size:11px;color:#6b7280;min-height:16px;margin-top:5px;}
      .pbp-tedit .talkmsg.ok{color:#0a8f4c;}
      .pbp-tedit .talkmsg.err{color:#dc2626;}
      .pbp-tedit .talkacts{display:flex;align-items:center;gap:6px;margin-top:6px;}
      /* 🔤 出词策略（2026-11-04）：找词按哪句，摆在排班行第四列，点「改」跟评论策略同一块展开 */
      .pbp-wrcell{vertical-align:top;}
      .pbp-wrline{display:flex;align-items:flex-start;gap:6px;padding:5px 8px;background:#f6f4ff;border:1px solid #e4defb;border-left:3px solid #b6a6f0;border-radius:6px;font-size:11.5px;line-height:1.7;color:#4c3d75;}
      .pbp-wrline .tx{flex:1;min-width:0;}
      .pbp-wrline .tx>span:first-child{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;word-break:break-all;}
      .pbp-wrsrc{font-size:9px;font-weight:700;border-radius:4px;padding:0 4px;margin-left:5px;vertical-align:1px;background:#eeeafd;color:#6d5bb8;white-space:nowrap;}
      .pbp-wrsrc.own{background:#e8f7ef;color:#0a8f4c;}
      .pbp-wrbox{margin-top:10px;padding-top:9px;border-top:1px dashed #e4defb;}
      .pbp-wrbox .h{font-size:11px;color:#6b7280;line-height:1.7;margin:0 0 6px;}
      .pbp-wrbox textarea{width:100%;box-sizing:border-box;min-height:52px;font:inherit;font-size:12px;line-height:1.8;border:1px solid #e5e7eb;border-radius:7px;padding:7px 9px;color:#374151;background:#fff;resize:vertical;}
      .pbp-wrbox textarea:focus{outline:none;border-color:#a78bfa;box-shadow:0 0 0 2px rgba(139,92,246,.12);}
      .pbp-wrbox .wrdefault{font-size:10.5px;color:#8b7cb8;background:#f6f4ff;border-radius:6px;padding:5px 8px;margin-top:6px;line-height:1.7;}
      .pbp-wrbox .wracts{display:flex;align-items:center;gap:6px;margin-top:7px;}
      .pbp-wrbox .wrmsg{font-size:11px;color:#6b7280;min-height:16px;flex:1;}
      .pbp-wrbox .wrmsg.ok{color:#0a8f4c;}
      .pbp-wrbox .wrmsg.err{color:#dc2626;}
      /* 投放平台：队列配置只有一份，这一份派给哪几个平台（2026-10-25） */
      .sx-platsel{display:flex;align-items:center;gap:14px;flex-wrap:wrap;background:var(--c-brand-soft,#f2f8fd);border:1px solid var(--c-brand-line,#cfe4f5);border-radius:10px;padding:8px 12px;margin:0 0 8px;font-size:12px;color:#1f2937;}
      .sx-platsel>b{color:var(--c-brand-ink,#0a6b8a);flex:none;}
      .sx-platsel label{display:inline-flex;align-items:center;gap:4px;font-weight:600;cursor:pointer;margin:0;}
      .sx-platsel label.off{color:#9ca3af;cursor:default;font-weight:400;}
      .sx-platsel input[type=checkbox]{width:14px;height:14px;margin:0;vertical-align:middle;cursor:pointer;accent-color:var(--c-brand);}
      .sx-platsel-note{flex-basis:100%;font-size:11px;color:#6b7280;line-height:1.6;}
      /* 📚 关键词表（2026-11-02）：一行一个玩法，中间摊词，右列节奏；底部折叠「全部词」 */
      .kwp-scroll{overflow-x:auto;border:1px solid var(--line,#eceef0);border-radius:10px;background:#fff;}
      .kwp-table{width:100%;min-width:620px;border-collapse:collapse;table-layout:fixed;}
      .kwp-table th{background:#f8fafc;border-bottom:1px solid var(--line,#eceef0);padding:7px 11px;text-align:left;font-size:10.5px;font-weight:700;color:#6b7280;}
      .kwp-table td{border-bottom:1px solid #eef1f5;padding:9px 11px;vertical-align:top;}
      .kwp-table tbody tr:last-child td{border-bottom:none;}
      .kwp-table tbody tr:hover td{background:#fcfdfe;}
      .kwp-table tr.kwp-orphan td{background:#fffdf7;}
      .kwp-table tr.kwp-flash td{animation:kwpFlash 1s ease;}
      @keyframes kwpFlash{0%{background:#ccfbf1;}100%{background:transparent;}}
      .kwp-table tr.kwp-orphan .kwp-cnt{background:#fdf3e3;color:#b45309;}
      .kwp-table tr.kwp-acct td{background:#fbfcfd;}
      .kwp-acctcell{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11.5px;color:#6b7280;line-height:1.8;}
      .kwp-acctcell b{color:#374151;}
      .kwp-pbcell{display:flex;flex-direction:column;gap:3px;}
      .kwp-pbline{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
      .kwp-meta{font-size:10.5px;color:#9ca3af;line-height:1.7;}
      .kwp-meta b{color:#374151;}
      .kwp-icon{width:24px;height:24px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;font-size:13px;flex:none;}
      .kwp-name{font-size:12.5px;font-weight:800;color:#1f2937;white-space:nowrap;}
      .kwp-tag{font-size:10.5px;color:#9ca3af;line-height:1.55;}
      .kwp-cnt{font-size:10.5px;color:#6b7280;background:#f4f6f9;border-radius:20px;padding:1px 8px;white-space:nowrap;align-self:flex-start;}
      .kwp-cnt b{color:#374151;}
      .kwp-today{font-size:10px;font-weight:800;color:#0a8f4c;background:#e8f7ef;border:1px solid #bfe8d3;border-radius:20px;padding:1px 7px;white-space:nowrap;}
      .kwp-chips{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;}
      .kwp-chip{display:inline-flex;align-items:center;gap:3px;border:1px solid var(--line,#eceef0);background:#f8fafc;border-radius:20px;padding:2px 4px 2px 9px;font-size:11.5px;color:#374151;max-width:100%;}
      .kwp-chip .wt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .kwp-chip.off{opacity:.5;}
      .kwp-chip.off .wt{text-decoration:line-through;}
      .kwp-chip .offtag{font-size:9px;color:#b45309;background:#fdf3e3;border-radius:4px;padding:0 3px;}
      .kwp-empty{font-size:11px;color:#9ca3af;padding:2px 0 8px;}
      .kwp-tools{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding-top:7px;border-top:1px dashed #eef0f3;}
      .kwp-tin{width:190px;font-size:11.5px;padding:4px 8px;border:1px solid #e5e7eb;border-radius:7px;outline:none;font-family:inherit;}
      .kwp-tin:focus{border-color:var(--c-brand-line,#cfe4f5);}
      .kwp-tsel{font-size:11px;padding:4px 6px;border:1px solid #e5e7eb;border-radius:7px;color:#374151;background:#fff;outline:none;cursor:pointer;font-family:inherit;}
      .kwp-tools .note{font-size:10.5px;color:#9ca3af;}
      /* ☑ 勾选框＋🗑 批量（2026-11-04）：词前面的框勾了＝给这一行的「批量移出」；全部词表最右那列＝给「批量删除」 */
      .kwp-chip .kwp-sel{width:13px;height:13px;margin:0;accent-color:var(--c-brand);flex:none;cursor:pointer;}
      .kwp-batchdel{border-color:#f3c6c6;color:#b4342a;background:#fff5f5;}
      .kwp-batchdel:hover:not(:disabled){border-color:#e8a1a1;background:#feecec;}
      .kwp-batchdel:disabled{opacity:.5;cursor:default;}
      .kwp-findcell{display:flex;flex-direction:column;gap:4px;align-items:flex-start;}
      .kwp-percell{vertical-align:middle;}
      .kwp-perlab{display:flex;align-items:center;gap:4px;font-size:11.5px;color:#6b7280;white-space:nowrap;}
      .kwp-allbar{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:8px 0 9px;}
      .kwp-allbar .note{font-size:10.5px;color:#9ca3af;}
      .kwp-alltable .kwp-sel{width:13px;height:13px;margin:0;accent-color:#dc2626;vertical-align:middle;cursor:pointer;}
      .kwp-cand{margin-top:7px;padding:8px 10px;background:#fffdf5;border:1px solid #fde68a;border-radius:8px;}
      .kwp-cand .ch{display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;color:#92400e;flex-wrap:wrap;}
      .kwp-cand .ch .sp{flex:1;}
      .kwp-cand .cb{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}
      .kwp-cand label{display:inline-flex;align-items:center;gap:4px;background:#fff;border:1px solid #fde68a;border-radius:20px;padding:2px 9px;font-size:11px;color:#374151;cursor:pointer;}
      .kwp-cand label.inpb{opacity:.55;cursor:default;text-decoration:line-through;}
      .kwp-cand input{width:13px;height:13px;margin:0;accent-color:var(--c-brand);}
      .kwp-cand .n{color:#9ca3af;}
      .kwp-all{border:1px solid var(--line,#eceef0);border-radius:10px;margin-top:9px;background:#fff;}
      .kwp-all>summary{list-style:none;display:flex;align-items:center;gap:8px;padding:9px 11px;cursor:pointer;font-size:12px;font-weight:800;color:#374151;user-select:none;}
      .kwp-all>summary::-webkit-details-marker{display:none;}
      .kwp-all>summary::before{content:'▸';color:#9ca3af;}
      .kwp-all[open]>summary::before{content:'▾';}
      .kwp-all>summary .s{font-weight:400;font-size:10.5px;color:#9ca3af;}
      .kwp-allbody{padding:0 11px 11px;}
      .kwp-alltable{width:100%;border-collapse:collapse;table-layout:fixed;font-size:11.5px;}
      .kwp-alltable th{background:#f8fafc;color:#6b7280;font-weight:600;font-size:10.5px;text-align:left;padding:5px 6px;border-bottom:1px solid var(--line,#eceef0);}
      .kwp-alltable td{padding:5px 6px;border-bottom:1px solid #eef1f5;vertical-align:middle;}
      .kwp-alltable tr:last-child td{border-bottom:none;}
      .kwp-alltable tr.off td{opacity:.55;}
      .kwp-alltable .c-word{display:flex;align-items:center;gap:6px;overflow:hidden;}
      .kwp-alltable .c-word input{width:14px;height:14px;margin:0;accent-color:var(--c-brand);flex:none;}
      .kwp-alltable .word{font-weight:700;color:#1f2937;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .kwp-alltable .pbtags{display:flex;flex-wrap:wrap;gap:3px;}
      .kwp-alltable .pbtag{font-size:9.5px;background:#f3f4f6;border-radius:4px;padding:0 4px;color:#4b5563;white-space:nowrap;}
      .kwp-alltable .pbtag.none{background:#fdf3e3;color:#b45309;}
      .kwp-alltable .ago{font-size:10.5px;color:#9ca3af;white-space:nowrap;}
      .sx-judge{font-size:10px;padding:2px 8px;border-radius:20px;font-weight:600;white-space:nowrap;}
      .sx-judge.green{background:#e9fcf2;color:#0a8f4c;}
      .sx-judge.blue{background:#eff6ff;color:#2563eb;}
      .sx-judge.gray{background:#f3f4f6;color:#6b7280;}
      .sx-judge.purple{background:#f5f3ff;color:#7c3aed;}
      .sx-judge.red{background:#fef2f2;color:#dc2626;}
      .sx-chip-sel{font-size:11px;padding:2px 4px;border-radius:20px;border:1px solid var(--c-brand-line);background:var(--c-brand-soft);color:var(--c-brand-ink);font-weight:600;outline:none;cursor:pointer;max-width:132px;}
      .sx-input{width:100%;box-sizing:border-box;margin-top:6px;}
      /* 💧 评论记录：原来单占一个二级页，现在收在列表底下的折叠块里 */
      .sx-logs{margin-top:16px;border-top:1px solid var(--line,#eceef0);padding-top:10px;}
      .sx-logs>summary{display:flex;align-items:center;gap:6px;list-style:none;cursor:pointer;user-select:none;padding:2px 0;font-size:12px;font-weight:700;color:#374151;}
      .sx-logs>summary::-webkit-details-marker{display:none;}
      .sx-logs>summary::before{content:'▸';color:#b9bec7;font-size:10px;}
      .sx-logs[open]>summary::before{content:'▾';}
      .sx-logs>summary:hover{color:var(--c-brand-text);}
      .sx-logs-n{font-weight:400;color:#9ca3af;font-size:11px;}
      /* 配置页三张卡（2026-10-24）：🔎 跑什么 / 🌿 日常浏览 / 🎯 推广目标·承接，点卡头展开收起 */
      .cfgcard{margin-bottom:10px;background:#fff;border:1px solid var(--line,#eceef0);border-radius:12px;box-shadow:0 1px 3px rgba(16,24,40,.05);}
      .cfgcard-h{list-style:none;display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:pointer;user-select:none;flex-wrap:wrap;}
      .cfgcard-h::-webkit-details-marker{display:none;}
      .cfgcard-t{font-size:12.5px;font-weight:800;color:#1f2937;white-space:nowrap;}
      .cfgcard-s{font-size:11px;color:#6b7280;background:#f6f8fa;border:1px solid #eceef0;border-radius:20px;padding:1px 8px;white-space:nowrap;}
      .cfgcard-x{font-size:11px;color:#9ca3af;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}
      .cfgcard-chev{margin-left:auto;color:#b9bec7;font-size:10px;transition:transform .15s;flex:none;}
      .cfgcard[open] .cfgcard-chev{transform:rotate(180deg);}
      .cfgcard-b{padding:2px 12px 12px;border-top:1px solid var(--line,#eceef0);}
      .sx-sec-h{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#1f2937;margin:14px 0 6px;padding-top:10px;border-top:1px dashed #e5e7eb;}
      .sx-sec-h.first{margin-top:0;padding-top:0;border-top:0;}
      /* 🧭 获客规划两个横签（2026-11-12）：去哪儿找 / 怎么评 */
      .plan-tabs{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:0 0 10px;padding:4px;background:#f6f8fa;border:1px solid var(--line,#eceef0);border-radius:10px;}
      .plan-tab{border:none;background:transparent;border-radius:8px;padding:7px 14px;font:inherit;font-size:13px;font-weight:700;color:#4b5563;cursor:pointer;display:inline-flex;align-items:center;gap:6px;}
      .plan-tab .s{font-size:10.5px;font-weight:400;color:#9ca3af;}
      .plan-tab:hover{background:#eef2f5;}
      .plan-tab.on{background:#fff;color:#0a6b8a;box-shadow:0 1px 3px rgba(16,24,40,.08);}
      .plan-tab.on .s{color:#5b7f92;}
      .plan-tabs-hint{font-size:11px;color:#9ca3af;padding:0 8px;}
      /* 📝 笔记类型表：一篇怎么跑只看这张表 */
      .nt-scroll{overflow-x:auto;border:1px solid #eef0f3;border-radius:10px;background:#fff;}
      .nt-table{width:100%;min-width:760px;border-collapse:collapse;table-layout:fixed;}
      .nt-table th{background:#f8fafc;color:#6b7280;font-size:10.5px;font-weight:700;text-align:left;padding:7px 11px;border-bottom:1px solid #eef0f3;}
      .nt-table td{padding:9px 11px;border-bottom:1px solid #eef1f5;vertical-align:top;font-size:12px;color:#374151;}
      .nt-table tbody tr:last-child td{border-bottom:none;}
      .nt-table tbody tr:hover td{background:#fcfdfe;}
      .nt-table tr.nt-veto td{background:#fbfbfc;}
      .nt-name{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12.5px;font-weight:800;color:#1f2937;}
      .nt-icon{width:24px;height:24px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;font-size:13px;background:#f4f6f9;flex:none;}
      .nt-lock{font-size:9px;font-weight:700;color:#6b7280;background:#f3f4f6;border-radius:4px;padding:0 4px;}
      .nt-fixed{display:inline-block;font-size:11.5px;font-weight:700;color:#6b7280;background:#f3f4f6;border-radius:6px;padding:3px 8px;}
      .nt-sel{font:inherit;font-size:11.5px;padding:3px 6px;border:1px solid #dfe5ea;border-radius:6px;background:#fff;color:#374151;cursor:pointer;max-width:100%;}
      .nt-sel:disabled{opacity:.45;cursor:default;background:#f8fafc;}
      .nt-act{display:block;margin-top:4px;}
      .nt-collect{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:#374151;cursor:pointer;white-space:nowrap;}
      .nt-collect input{width:14px;height:14px;margin:0;accent-color:var(--c-brand,#0a6b8a);}
      .nt-collect input:disabled{cursor:default;}
      .nt-judge{font-size:11px;color:#6b7280;line-height:1.7;}
      .nt-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 0 0;}
      .nt-tools .note{font-size:11px;color:#9ca3af;}
      /* 问号气泡 .qhelp / 折叠块 .fdet 是全站公用样式，在 ui.css 里 */
    </style>
    <div class="sx-wrap">
      ${isCfg ? `
      <div class="sx-hint" id="sxScanNote" style="display:none;margin:0 0 8px;white-space:pre-line;color:#d97706;"></div>
      <div id="sxScanCfgPanel"></div>
      ` : `
      <div class="sx-bar">
        <span style="font-size:13px;font-weight:700;color:#1f2937;">📋 笔记列表</span>
        <select id="sxFilter" class="sx-in">
          <option value="all">全部类型</option>
          ${SCENARIO_DRAIN.map(s => `<option value="${s.scenario}">${s.icon} ${s.label}</option>`).join('')}
        </select>
        <span class="sx-count" id="sxCount"></span>
        <span style="flex:1"></span>
        <span class="sx-count" id="sxRevHint"></span>
        <button type="button" class="sx-btn" id="sxGrade" style="display:none;">AI 判一遍</button>
      </div>
      <div class="sx-hint" id="sxSrcLine" style="margin:0 0 8px;"></div>
      <div id="sxReviewTop"></div>
      <div id="sxDaily"></div>
      `}
      <div id="sxList"></div>
      ${isCfg ? '' : `
      <div id="sxReviewFoot"></div>
      <details class="sx-logs" id="sxWaterFold" style="display:none;">
        <summary>💬 评论记录 <span class="sx-logs-n" id="sxWaterN"></span></summary>
        <div id="sxWaterBody"></div>
      </details>`}
    </div>
  `;

  /* ---- 批量页：两张卡（🔎 跑什么 / 🎯 推广目标·承接）＋顶部这一周怎么跑 ---- */
  const renderScanCfg = async () => {
    const r = await chrome.runtime.sendMessage({ action: 'drainGetScanCfg' });
    /* 网页版的 drainGetScanCfg 是转发给服务器的，回来的可能还是没归一的老配置（v6 的词没有 types）；
       不先归一，底下的「未挂玩法」会拿原始词去算，把明明挂着玩法的词也列出来 */
    const cfg = _drainNormalizeScanCfg((r && r.ok && r.cfg) || {});
    st.cfg = cfg;
    const panel = _sel('sxScanCfgPanel');
    if (!panel) return;
    /* 重绘时把上一轮没关的格子弹窗收掉（它们是挂在 body 上的，不跟着 panel.innerHTML 走） */
    document.querySelectorAll('.pbp-pop').forEach(el => el.remove());
    // 这一页只剩「跑什么」一张卡（推广目标 2026-11-09 已撤）
    _cfgSec = 'run';
    const max = await drainPoolMax();
    /* 话术的「让 AI 改」要按这个账号的人设写：人设存在 config 里（账号设置），不另存一份 */
    let personaText = '';
    try {
      const st = await chrome.storage.local.get('config');
      const c0 = (st && st.config) || {};
      personaText = String((c0.persona && c0.persona.text) || '').trim();
    } catch (_) {}
    const run = cfg.typeRun || DRAIN_TYPE_RUN_DEFAULT;
    const fcfg = drainFreshCfg(cfg);
    let pool = cfg.keywords || [];
    const enabledN = pool.filter(e => e.on !== false).length;
    const now = Date.now();
    const todayWd = new Date(now).getDay();
    const pbToday = DRAIN_PB_ORDER.filter(s => drainPbOnDay(cfg, s, now));
    const pbOff = DRAIN_PB_ORDER.filter(s => !drainPbPlan(cfg, s).days.length);
    /* 启用了但一个玩法都没挂的词：永远不会进队列，表底单独留一行点出来 */
    const orphanWords = pool.filter(e => e.on !== false && !DRAIN_PB_WORD.some(s => drainWordTypeOn(e, s)));
    const save = async (next, quiet) => {
      const merged = Object.assign({}, cfg, next);
      let r = null;
      try { r = await chrome.runtime.sendMessage({ action: 'drainSaveScanCfg', cfg: merged }); } catch (_) {}
      // 网页版：保存走服务器动作，没有存储变更回推 → 顺手让队列那半边重算，配置一改队列立刻对上
      try { const qb = document.getElementById('drainQueueContent'); if (qb && typeof qb._qRender === 'function') qb._qRender(); } catch (_) {}
      // 词池变了 → 获客那排关键词标签同步刷新（同一份真源）
      try { if (typeof window._kwBarReload === 'function') await window._kwBarReload(); } catch (_) {}
      /* 存完给一句回音：今天排进几项 / 今天不跑是哪道闸（演示号被拦下时不报「已存」）
         没回话 / 回 ok:false 一律报「没存上」，不许把失败说成成功 */
      if (!r || r.ok === false) {
        const err = (r && r.error) || '服务器没回话';
        /* 演示号被拦：那块大提示已经把话说完了，这里不再叠一条 */
        if (!quiet && !(r && r.demo === 'readonly-foundation')) drainToast('没存上：' + err, 'warn');
      } else if (!quiet) {
        const f = drainQueueForecast(merged, Date.now());
        const why = String(f.why || '').split('；')[0];
        const whyShort = why.length > 42 ? why.slice(0, 42) + '…' : why;
        drainToast(f.today
          ? ('✅ 已存：今天 ' + f.today + ' 次搜索（' + f.words + ' 个词） · 明天 ' + f.tomorrow + ' 次')
          : ('✅ 已存：今天不跑' + (whyShort ? ' · ' + whyShort : '') + (f.tomorrow ? ' · 明天 ' + f.tomorrow + ' 次搜索' : '')));
      }
      await renderScanCfg();
      return r;
    };
    const agoTxt = (ts) => {
      if (!ts) return '没跑过';
      const mins = Math.round((now - ts) / 60000);
      return mins < 1 ? '刚跑过' : (mins < 60 ? mins + ' 分钟前' : Math.round(mins / 60) + ' 小时前');
    };
    const srcTag = (s) => ({ ai: '<span style="color:#7c3aed;">AI</span>', topic: '<span style="color:#2563eb;">话题</span>' }[s] || '<span style="color:#9ca3af;">手填</span>');
    /* 一行一个玩法：左边玩法名 / 中间摊这个玩法底下的词 / 右边一列从上到下＝找词、批量移出，再过去是每天挑几个。
       词只有一份，一个词可以同时挂几行；批量移出只退出这一行，词还在池里
       2026-11-04 老板定：「多久跑一次」那一列撤掉——要停一个玩法，周几全部不勾就是；
       同一天撤掉词上的 ✕（单词逐个移出／逐个删），移出与删除一律走批量按钮 */
    const kwpWords = (s) => pool.filter(e => drainWordTypeOn(e, s));
    const kwpSelN = (s) => pool.filter(e => _kwSel.has(s + '|' + e.k)).length;
    const kwpChips = (s) => {
      const def = drainScenarioDef(s);
      const ws = kwpWords(s);
      if (!ws.length) return '<div class="kwp-empty">还没配词：下面直接加一个，或点右边「✨ 找词」按这个玩法的出词策略找一批。</div>';
      return `<div class="kwp-chips">${ws.map(e => {
        const off = e.on === false;
        const selKey = s + '|' + e.k;
        return `<span class="kwp-chip${off ? ' off' : ''}" title="${escAttr(e.k + (off ? '（已停用，所有玩法都不跑它）' : ''))}">
          <input type="checkbox" class="kwp-sel" data-kwsel="${escAttr(selKey)}"${_kwSel.has(selKey) ? ' checked' : ''} title="${escAttr('勾上＝待批量移出「' + def.label + '」（词还在词池）')}">
          <span class="wt">${escHtml(e.k)}</span>${off ? '<span class="offtag">停用</span>' : ''}
        </span>`;
      }).join('')}</div>`;
    };
    const kwpCandHtml = (s) => {
      if (!_cand || (_cand.playbook || 'latest') !== s) return '';
      return `<div class="kwp-cand">
        <div class="ch">
          <span>${_cand.loading ? '正在找…（' + escHtml(_cand.label) + '）' : '候选（' + escHtml(_cand.label) + '）共 ' + _cand.items.length + ' 个'}</span>
          <span class="sp"></span>
          ${_cand.loading ? '' : `<button type="button" class="btn btn-sm" id="sxCandAll">全选</button>
          <button type="button" class="btn btn-sm btn-primary" id="sxCandAdopt">勾选的入池</button>
          <button type="button" class="btn btn-sm" id="sxCandClose">关</button>`}
        </div>
        ${_cand.loading ? '' : `<div class="cb">${_cand.items.map(x => {
          const inPb = pool.some(e => e.k === x.k && drainWordTypeOn(e, s));
          return `<label${inPb ? ' class="inpb"' : ''} title="${escAttr(inPb ? '已经在这个玩法里了' : '')}">
            <input type="checkbox" data-cand="${escAttr(x.k)}"${inPb ? ' disabled' : (x.def === false ? '' : ' checked')}> ${escHtml(x.k)}${inPb ? '<span class="n"> 已在</span>' : (x.n ? '<span class="n">×' + x.n + '</span>' : '')}
          </label>`;
        }).join('')}</div>`}
      </div>`;
    };
    const kwpRow = (s) => {
      const def = drainScenarioDef(s);
      const ws = kwpWords(s);
      const offN = ws.filter(e => e.on === false).length;
      const running = drainPbOnDay(cfg, s, now);
      const selN = kwpSelN(s);
      const rivalN = (s === 'local') ? (cfg.accounts || []).filter(a => a && a.on !== false && drainScenarioId(a.scenario) === 'rival').length : 0;
      const rivalNote = rivalN
        ? `<div class="kwp-meta">👤 还盯着 <b>${rivalN}</b> 个竞对主页：只收人，不评论</div>`
        : '';
      return `<tr id="row-${s}">
        <td>
          <div class="kwp-pbcell">
            <div class="kwp-pbline">
              <span class="kwp-icon" style="${DRAIN_PB_ICON_STYLE[s] || ''}">${def.icon}</span>
              <span class="kwp-name">${escHtml(def.label)}</span>
              ${running ? '<span class="kwp-today">今天跑</span>' : ''}
            </div>
            <div class="kwp-tag">${escHtml(drainPbCopy(cfg, s, 'tag') || def.tag || '')}</div>
            <span class="kwp-cnt"><b>${ws.length}</b> 个词${offN ? ' · ' + offN + ' 停用' : ''}</span>
            ${rivalNote}
          </div>
        </td>
        <td>
          ${kwpChips(s)}
          <div class="kwp-tools">
            <input class="kwp-tin" data-kwaddinput="${s}" placeholder="加一个词到「${escAttr(def.label)}」，回车">
            <button type="button" class="btn btn-sm" data-kwadd="${s}">＋ 添加</button>
          </div>
          ${kwpCandHtml(s)}
        </td>
        <td class="kwp-findcell">
          <button type="button" class="btn btn-sm" data-kwai="${s}" title="${escAttr('按「' + def.label + '」的出词策略找一批词（上面「玩法配置」最后一列那句），勾完只进这个玩法')}">✨ 找词</button>
          ${s === 'cross' ? '<button type="button" class="btn btn-sm" data-kwtopic="cross" title="从话题采集池挑：挑进来只挂「同城异业」">🏷 话题</button>' : ''}
          <button type="button" class="btn btn-sm kwp-batchdel" data-kwbatchdel="${s}"${selN ? '' : ' disabled'} title="${escAttr('把前面勾上的词一起从「' + def.label + '」移出（词还在词池，别的玩法照跑）')}">🗑 批量移出${selN ? '（' + selN + '）' : ''}</button>
        </td>
        <td class="kwp-percell">
          <label class="kwp-perlab" title="这个玩法每个排上的日子从词池里轮着挑几个词">每天 <input class="pbp-per" type="number" min="1" max="20" value="${drainPbPlan(cfg, s).perDay}" data-pbper="${s}"> 个</label>
        </td>
      </tr>`;
    };
    const kwpHighvRow = () => {
      const acctN = pbAcctN('highv');
      return `<tr id="row-highv" class="kwp-acct">
        <td>
          <div class="kwp-pbcell">
            <div class="kwp-pbline">
              <span class="kwp-icon" style="${DRAIN_PB_ICON_STYLE.highv}">👑</span>
              <span class="kwp-name">大V</span>
            </div>
            <div class="kwp-tag">借主页流量 · 评论区补充</div>
            <span class="kwp-cnt">不出词</span>
          </div>
        </td>
        <td colspan="3">
          <div class="kwp-acctcell">
            <span>这个玩法不用词：按排班去 <b>${acctN}</b> 个头部博主的主页看最新笔记，在笔记下面留一句「赞同＋本行视角补充」，评论区里回追问的人。</span>
            <button type="button" class="btn btn-sm" data-kwacct="1" title="看现在盯了哪些账号：启停、借势还是蹲人、多久进一次主页">看盯的账号</button>
          </div>
        </td>
      </tr>`;
    };
    const kwpOrphanRow = (orphan) => `<tr id="row-orphan" class="kwp-orphan">
      <td>
        <div class="kwp-pbcell">
          <div class="kwp-pbline">
            <span class="kwp-icon" style="background:#fdf3e3;color:#b45309;">🧩</span>
            <span class="kwp-name">未挂玩法</span>
          </div>
          <div class="kwp-tag">挂了 0 个玩法，永远不会进队列</div>
          <span class="kwp-cnt"><b>${orphan.length}</b> 个词</span>
        </div>
      </td>
      <td>
        <div class="kwp-chips">${orphan.map(e => `<span class="kwp-chip"><span class="wt">${escHtml(e.k)}</span></span>`).join('')}</div>
        <div class="kwp-tools">
          <button type="button" class="btn btn-sm" id="sxKwOrphan" title="把这些没挂任何玩法的词一起挂到「本地泛搜索」，挂完还能自己调">🧭 都挂到本地泛搜</button>
          <span class="note">也可以到上面任意一行用「＋ 添加」把词重打一遍挂进去。</span>
        </div>
      </td>
      <td colspan="2"><span class="kwp-meta">—</span></td>
    </tr>`;
    const kwpAllWords = () => {
      const selN = pool.filter(e => _poolSel.has(e.k)).length;
      const rows = pool.map(e => {
        const tags = DRAIN_PB_WORD.filter(s => drainWordTypeOn(e, s)).map(s => `<span class="pbtag">${drainScenarioDef(s).icon}${escHtml(drainScenarioDef(s).label)}</span>`);
        const last = Math.max(0, ...DRAIN_TYPE_META.map(m => drainPassState(e, m.scenario, cfg, now).lastAt));
        return `<tr${e.on === false ? ' class="off"' : ''}>
          <td>
            <label class="c-word">
              <input type="checkbox" data-poolon="${escAttr(e.k)}"${e.on !== false ? ' checked' : ''} title="${escAttr(e.on !== false ? '停用：不参与搜索，词还留在池里' : '启用这个词')}">
              <span class="word" title="${escAttr(e.k)}">${escHtml(e.k)}</span>
              ${srcTag(e.src)}
            </label>
          </td>
          <td><span class="pbtags">${tags.length ? tags.join('') : '<span class="pbtag none">未挂玩法</span>'}</span></td>
          <td class="ago">${agoTxt(last)}</td>
          <td style="text-align:center;"><input type="checkbox" class="kwp-sel" data-poolsel="${escAttr(e.k)}"${_poolSel.has(e.k) ? ' checked' : ''} title="勾上＝待批量删除"></td>
        </tr>`;
      }).join('');
      return `<details class="kwp-all"${_poolSel.size ? ' open' : ''}>
        <summary>📋 全部词 <span class="s">${pool.length} 个 · 只管停用 / 删除 / 看上次跑</span></summary>
        <div class="kwp-allbody">
          <div class="kwp-allbar">
            <button type="button" class="btn btn-sm kwp-batchdel" id="sxPoolBatchDel"${selN ? '' : ' disabled'} title="把右边勾上的词从词池彻底删掉（所有玩法里都没了，找不回来）">🗑 批量删除${selN ? '（' + selN + '）' : ''}</button>
            <span class="note">第一个框＝停用／启用（词还在）；最右边那个框＝勾给批量删除（真删）。</span>
            <span style="flex:1;"></span>
            <button type="button" class="btn btn-sm" id="sxPoolSelAll"${pool.length ? '' : ' disabled'} title="一次勾上全部 ${pool.length} 个词">全选</button>
          </div>
          <table class="kwp-alltable">
            <thead><tr><th style="width:45%;">关键词</th><th>挂了哪些玩法</th><th style="width:92px;">上次跑</th><th style="width:40px;">勾删</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="4" class="kwp-empty" style="padding:18px 6px;">词池是空的：上面任意一行加词（回车），或点右边「✨ 找词 / 🏷 话题」从候选里勾。</td></tr>`}</tbody>
          </table>
        </div>
      </details>`;
    };
    const platOn = drainPlatsNorm(cfg.plats);
    const mpOn = drainMultiPlatOn();
    const platBarHtml = `
      <div class="sx-platsel" style="margin:0 0 9px;">
        <b>投放平台</b>
        ${DRAIN_PLATS.map(id => (id === 'dy' && !mpOn)
          ? `<label class="off" title="抖音获客要「全平台版（699）」才开——前三档只跑小红书"><input type="checkbox" disabled>${DRAIN_PLAT_LABEL[id]}</label>`
          : `<label title="${escAttr('这份队列派给' + DRAIN_PLAT_LABEL[id] + (id === 'dy' ? '（这轮只跑「综合」）' : ''))}"><input type="checkbox" data-cfgplat="${id}" ${platOn[id] ? 'checked' : ''}>${DRAIN_PLAT_LABEL[id]}</label>`).join('')}
        <span style="flex:1;"></span>
        <button type="button" class="btn btn-sm" data-kwacct="1" title="看现在盯了哪些大 B 账号：启停、借势还是蹲人、多久进一次主页">👤 盯的账号</button>
        <button type="button" class="btn btn-sm" id="sxKwDaily" title="日常浏览：开关 / 一轮怎么刷 / 顺手互动 / 每天自动开跑">🌿 日常浏览</button>
        ${mpOn ? '' : '<div class="sx-platsel-note">抖音要「全平台版（699）」才开——这一档只跑小红书。</div>'}
      </div>`;
    /* ── 🧭 渠道排班（2026-11-12 剪列）：一个渠道一行，只管周几跑 / 同城 / 出词策略 ── */
    const WK_SHORT = ['日', '一', '二', '三', '四', '五', '六'];
    const pbAcctN = (s) => (cfg.accounts || []).filter(a => a && a.on !== false && drainScenarioId(a.scenario) === s).length;
    /* 出词策略那一格显示的那句：自己写的优先，没写就是内置那句（后面挂个「内置」小标） */
    const wrTxHtml = (s, custom) => {
      const full = String(custom || '').trim() || drainAiKeywordRule(s, cfg.city, '', cfg);
      return `<span class="tx" title="${escAttr(full)}"><span>${escHtml(full)}</span>${custom ? '<span class="pbp-wrsrc own">自己写的</span>' : '<span class="pbp-wrsrc">内置</span>'}</span>`;
    };
    const pbCityShort = { off: '不筛', priority: '优先', force: '全收' };
    /* 周几压成一句：不跑 / 每天 / 工作日 / 周末 / 一、三、五 */
    const pbDayLabel = (days) => {
      const d = (days || []).slice().sort((a, b) => a - b);
      if (!d.length) return '这周不跑';
      if (d.length === 7) return '每天';
      if (d.length === 5 && [1, 2, 3, 4, 5].every(x => d.indexOf(x) >= 0)) return '工作日';
      if (d.length === 2 && d.indexOf(0) >= 0 && d.indexOf(6) >= 0) return '周末';
      return d.map(x => WK_SHORT[x]).join('、');
    };
    const pbChipHtml = (s, kind, label, o) => {
      o = o || {};
      return `<button type="button" class="pbp-chip${o.dim ? ' seloff' : ''}${o.warn ? ' warn' : ''}" data-pbpop="${s}|${kind}" title="${escAttr(o.tip || '')}"><span class="cv">${escHtml(label)}</span></button>`;
    };
    /* 🧭 渠道行（2026-11-12 剪列）：这一签只管「去哪儿找」——渠道 / 周几跑 / 同城 / 出词策略。
       评不评、动作、提店、收人全搬到「💬 怎么评」的笔记类型表，这一行不再重复给。 */
    const pbRow = (s) => {
      const def = drainScenarioDef(s);
      const p = drainPbPlan(cfg, s);
      const acctN = pbAcctN(s);
      const rivalAcctN = (s === 'local') ? (cfg.accounts || []).filter(a => a && a.on !== false && drainScenarioId(a.scenario) === 'rival').length : 0;
      const tOpen = _drainTalkOpen === s;
      /* 出词策略：自己写过就用那句，没写显示内置那句（灰、标「内置口径」），点「改」就地写 */
      const noWord = s === 'highv';
      const wrBuiltin = noWord ? '' : drainAiKeywordRule(s, cfg.city, '', cfg);
      const wrOwn = p.wordRule;
      const cadOff = !!(run[s] && run[s].mode === 'off');
      const cityTip = '同城：这个渠道对同城评论怎么处理——不筛＝不看属地；优先＝同省的排前面；全收＝同城的都算机会';
      return `<tr class="pbp-tr">
        <td class="pbp-name" title="${escAttr((drainPbCopy(cfg, s, 'desc') || def.desc || def.label) + (rivalAcctN ? '（含盯的 ' + rivalAcctN + ' 个竞对号）' : ''))}">${def.icon} ${escHtml(def.label)}${s === 'highv' ? `<span class="pbp-sub">不出词${acctN ? ' · 盯 ' + acctN + ' 个号' : ''}</span>` : ''}</td>
        <td>${pbChipHtml(s, 'days', cadOff ? '已停用 · 点恢复' : pbDayLabel(p.days), {
          warn: cadOff,
          tip: cadOff ? '老设置里这个渠道被定成「不跑」，点一下恢复默认节奏' : '点开选周几跑：一天可多选，也能一次套「每天 / 工作日 / 周末」',
        })}</td>
        <td>${pbChipHtml(s, 'city', pbCityShort[p.city], { tip: cityTip })}</td>
        <td class="pbp-wrcell">${noWord
          ? '<span class="pbp-dash">不出词</span>'
          : `<div class="pbp-wrline">
              <span data-wrbox="${s}">${wrTxHtml(s, wrOwn)}</span>
              <button type="button" class="pbp-talkedit" data-wredit="${s}">${tOpen ? '收起' : '改'}</button>
            </div>`}</td>
      </tr>
      <tr class="pbp-tedit${tOpen ? ' open' : ''}" id="talkedit-${s}"><td colspan="4"><div class="pbp-teditbox">
        ${noWord ? '<div class="hint">这个渠道不出词，没有出词策略。</div>' : `<div class="pbp-wrbox" style="margin-top:0;padding-top:0;border-top:0;">
          <div class="h">出词策略：点「✨ 找词」时 AI 按这一句去找词。留空＝用下面那句内置口径。</div>
          <textarea data-writext="${s}" rows="2" placeholder="${escAttr(wrBuiltin)}">${escHtml(wrOwn)}</textarea>
          <div class="wrdefault">内置口径：${escHtml(wrBuiltin)}</div>
          <div class="wracts">
            <button type="button" class="btn btn-sm" data-wrreset="${s}">清掉自己写的</button>
            <span class="wrmsg" data-wrmsg="${s}"></span>
            <span style="flex:1;"></span>
            <button type="button" class="btn btn-sm btn-primary" data-wrsave="${s}">保存出词策略</button>
          </div>
        </div>`}
      </div></td></tr>`;
    };
    const cardBox = 'background:#fff;border:1px solid var(--line,#eceef0);border-radius:12px;padding:10px 12px;box-shadow:0 1px 3px rgba(16,24,40,.05);';
    /* 轮词的白话说明：一周几个槽、几个词、多出来的怎么办、几周轮完。没排日子/词为空就不说。 */
    const rotNoteHtml = () => {
      const lines = [];
      DRAIN_PB_WORD.forEach(s => {
        const st = drainPbRotStat(cfg, s);
        if (!st || !st.N) return;
        const def = drainScenarioDef(s);
        const head = def.icon + ' ' + escHtml(def.label);
        if (st.off) lines.push({ warn: false, text: head + '：这周没排日子，一个词都不跑' });
        else if (st.overflow > 0) lines.push({ warn: true, text: head + '：一周 ' + st.slots + ' 个槽、有 ' + st.N + ' 个词，这一周跑到第 ' + st.slots + ' 个，还有 ' + st.overflow + ' 个排不上；下周从第 ' + (st.slots + 1) + ' 个接着往下，约 ' + st.weeks + ' 周轮完一圈' });
        else if (st.N < st.slots) lines.push({ warn: false, text: head + '：一周 ' + st.slots + ' 个槽、只有 ' + st.N + ' 个词，跑完会绕回去，把前面的词再跑一遍' });
        else lines.push({ warn: false, text: head + '：一周 ' + st.slots + ' 个槽、' + st.N + ' 个词，刚好一圈跑完' });
      });
      if (!lines.length) return '';
      return '<div class="pbp-rotbox">' + lines.map(x => '<div class="pbp-rot' + (x.warn ? ' warn' : '') + '">' + x.text + '</div>').join('') + '</div>';
    };
    const pbWeekHtml = () => {
      const off = _drainWeekOff || 0;
      const wk = drainPbWeek(cfg, now + off * 7 * 24 * 3600 * 1000);
      const t0 = new Date(now);
      const sameDay = (ts) => {
        const d = new Date(ts);
        return !off && d.getFullYear() === t0.getFullYear() && d.getMonth() === t0.getMonth() && d.getDate() === t0.getDate();
      };
      return `<div style="${cardBox}margin-top:10px;">
        <div class="pbp-weekcard-h">
          <span class="t">📅 周日历</span>
          <span class="sx-count">${off ? '下周' : '这一周'}每个玩法跑哪些词</span>
          <span style="flex:1;"></span>
          <span class="pbp-wkseg">
            <button type="button" class="${off ? '' : 'on'}" data-wkoff="0">本周</button>
            <button type="button" class="${off ? 'on' : ''}" data-wkoff="1">下周（接着轮）</button>
          </span>
          <span class="x">按上面的排班轮出来的，停用的词不进来</span>
        </div>
        <div class="sx-hint" style="margin:0 0 8px;line-height:1.7;">按上面排班和「每天挑几个词」轮着算出来的；停用的词不进来。词比一周的槽多时，下一周从这周停下的地方接着往下，不会每周都从头。手插和欠账不受排班限制。</div>
        <div class="pbp-weekwrap">
          <table class="pbp-week">
            <thead><tr><th style="width:150px;">玩法</th>${DRAIN_WEEK_ORDER.map(d => `<th${!off && d === todayWd ? ' class="today"' : ''}>${WK_LABELS[d]}</th>`).join('')}</tr></thead>
            <tbody>${DRAIN_PB_ORDER.map(s => {
              const def = drainScenarioDef(s);
              const acctN = pbAcctN(s);
              const rs = drainPbRotStat(cfg, s);
              return `<tr><td class="pbp-wk-name">${def.icon} ${escHtml(def.label)}${rs && rs.overflow ? `<span class="pbp-wkwarn" title="${escAttr('一周只有 ' + rs.slots + ' 个槽，排不上 ' + rs.overflow + ' 个词；下周接着往下轮')}">⚠ ${rs.overflow}</span>` : ''}</td>${wk[s].map(cell => {
                const words = cell.words || [];
                if (words.length) return `<td${sameDay(cell.at) ? ' class="today"' : ''}>${words.map(w => `<span class="pbp-wchip" title="${escAttr(w)}">${escHtml(w)}</span>`).join('')}</td>`;
                if (s === 'highv' && acctN && drainPbOnDay(cfg, s, cell.at)) return `<td${sameDay(cell.at) ? ' class="today"' : ''}>👤 ${acctN} 个号</td>`;
                return `<td${sameDay(cell.at) ? ' class="today"' : ''}><span class="pbp-wempty">—</span></td>`;
              }).join('')}</tr>`;
            }).join('')}</tbody>
          </table>
        </div>
        ${rotNoteHtml()}
      </div>`;
    };
    /* ⏱「刚起来」线：判一篇值不值得抢首评用的，跟「怎么评」放一起 */
    const freshBoxHtml = `
      <div id="pbFreshLine" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:0 0 10px;padding:7px 9px;background:#f8fafc;border:1px solid #e8eef3;border-radius:7px;font-size:12px;color:#374151;">
        <b>⏱ 抢首评的「刚起来」线</b>
        <span style="color:#6b7280;">发布时间 ≤</span><input type="number" id="pbFreshHours" min="1" max="168" value="${fcfg.hours}" style="width:54px;padding:3px 5px;font-size:12px;border:1px solid #d8dee5;border-radius:4px;"> 小时
        <span style="color:#6b7280;">· 赞 &lt;</span><input type="number" id="pbFreshLikes" min="0" max="1000000" value="${fcfg.likes}" style="width:66px;padding:3px 5px;font-size:12px;border:1px solid #d8dee5;border-radius:4px;">
        <span style="color:#6b7280;">· 评论 &lt;</span><input type="number" id="pbFreshComments" min="0" max="100000" value="${fcfg.comments}" style="width:58px;padding:3px 5px;font-size:12px;border:1px solid #d8dee5;border-radius:4px;">
        <button type="button" id="pbFreshSave" class="btn btn-sm" style="padding:3px 9px;font-size:12px;">存下</button>
        <span id="pbFreshMsg" style="font-size:11px;color:#059669;"></span>
        <span class="qhelp" tabindex="0" data-tip="三条同时满足才算「刚起来」，才会抢首评：发布时间在上面线内、赞低于这条线、评论低于这条线。发布时间读不到、或赞/评论数读不全时，一律不判「刚起来」，不猜。">?</span>
      </div>`;
    const pbHtml = `
      <details class="cfgcard" open style="margin-bottom:10px;">
        <summary class="cfgcard-h">
          <span class="cfgcard-t">🧭 渠道排班</span>
          <span class="cfgcard-s">${pbToday.length ? '今天跑 ' + pbToday.length + ' 个渠道' : '今天不跑'}</span>
          <span class="cfgcard-x">${pbToday.length
            ? pbToday.map(s => drainScenarioDef(s).icon + drainScenarioDef(s).label).join(' · ')
            : (pbOff.length ? pbOff.length + ' 个渠道这周没排日子' : '')}</span>
          <span class="cfgcard-chev">▾</span>
        </summary>
        <div class="cfgcard-b">
          <div class="sx-hint" style="margin:2px 0 6px;">这一签只管<b>去哪儿找</b>：哪个渠道、周几跑、同城怎么算、找词按哪句。某篇帖子评不评、怎么评、能提到哪一步，去「💬 怎么评」那张笔记类型表看。要停一个渠道，把周几全部取消勾选。
            <span class="qhelp" tabindex="0" data-tip="一个词可以同时挂几个渠道（在下面词池里勾）。同一渠道里，词按词池顺序轮着来：今天挑前 N 个，下次排上就接着往下挑，几天转完一圈。手插和欠账不受排班限制。">?</span>
          </div>
          <div class="pbp-scroll">
            <table class="pbp-table">
              <colgroup><col style="width:150px;"><col style="width:120px;"><col style="width:86px;"><col></colgroup>
              <thead><tr><th>渠道</th><th>周几跑</th><th>同城</th><th>出词策略（找词按这句）</th></tr></thead>
              <tbody>${DRAIN_PB_ORDER.map(pbRow).join('')}</tbody>
            </table>
          </div>
        </div>
      </details>`;
    /* 💬 「怎么评」那一签：笔记类型表（2026-11-12）管评不评 / 评论动作 / 提店 / 收人；
       评论场景表管「遇到这个场景、对方这么问，怎么接」。AI 先判类型，再照这张表跑。 */
    const ntTypes = drainNoteTypesFor(cfg);
    const ntSel = (id, kind, cur, dis) => {
      const map = kind === 'mode' ? DRAIN_NOTE_MODE : (kind === 'act' ? DRAIN_NOTE_ACT : DRAIN_PB_STORE);
      const keys = Object.keys(map).filter(k => kind !== 'act' || k !== 'people');
      return `<select class="nt-sel" data-nt="${id}|${kind}" title="${escAttr(kind === 'mode' ? '这一类的帖评不评：评 / 不评·只收人 / 完全不碰' : (kind === 'act' ? '这一类帖子里做几件事' : '评论里能提自己到哪一步'))}"${dis ? ' disabled' : ''}>`
        + keys.map(k => `<option value="${k}"${k === cur ? ' selected' : ''}>${escHtml(map[k])}</option>`).join('')
        + '</select>';
    };
    const ntRow = (id) => {
      const d = DRAIN_NOTE_TYPE_DEF[id];
      const t0 = ntTypes[id];
      const veto = !!d.veto;
      const rate = t0.mode === 'rate';
      return `<tr${veto ? ' class="nt-veto"' : ''}>
        <td><div class="nt-name"><span class="nt-icon">${d.icon}</span><span>${escHtml(d.name)}</span>${veto ? '<span class="nt-lock">🔒 锁死</span>' : ''}</div></td>
        <td>${veto
          ? '<span class="nt-fixed">' + escHtml(DRAIN_NOTE_MODE[t0.mode]) + '</span>'
          : ntSel(id, 'mode', t0.mode) + '<span class="nt-act">' + ntSel(id, 'act', t0.act, !rate) + '</span>'}</td>
        <td>${ntSel(id, 'store', t0.store, !rate)}</td>
        <td><label class="nt-collect" title="${escAttr(t0.mode === 'block' ? '这一类一条都不碰，也不收人' : '这一类帖子里露出需求的人，进不进获客清单')}"><input type="checkbox" data-ntcollect="${id}"${t0.collect ? ' checked' : ''}${t0.mode === 'block' ? ' disabled' : ''}>${t0.mode === 'block' ? '不收' : '收进清单'}</label></td>
        <td class="nt-judge">${escHtml(d.judge)}</td>
      </tr>`;
    };
    const ntHtml = `
      <div class="cfgcard" style="margin-bottom:10px;">
        <div class="cfgcard-h" style="cursor:default;">
          <span class="cfgcard-t">📝 笔记类型表</span>
          <span class="cfgcard-s">7 类</span>
          <span class="cfgcard-x">一篇怎么跑只看这张表：评不评 / 评论动作 / 提店到哪一步 / 收不收人</span>
        </div>
        <div class="cfgcard-b">
          <div class="sx-hint" style="margin:2px 0 8px;line-height:1.8;">AI 先判这一篇是哪种帖（可以同时中几类），再照这张表跑。同时中几类时：<b>评论动作跟主类型</b>，<b>提店取最严的一档</b>（不提 &lt; 只提身份 &lt; 讲案例 &lt; 可报店名）。广告 / 悲伤两类是安全兜底，锁死不给改。</div>
          ${freshBoxHtml}
          <div class="nt-scroll">
            <table class="nt-table">
              <colgroup><col style="width:132px;"><col style="width:238px;"><col style="width:148px;"><col style="width:104px;"><col></colgroup>
              <thead><tr><th>笔记类型</th><th>评不评 · 怎么评</th><th>提店到哪一步</th><th>收不收人</th><th>怎么认（AI 照这句判）</th></tr></thead>
              <tbody>${DRAIN_NOTE_TYPE_ORDER.map(ntRow).join('')}</tbody>
            </table>
          </div>
          <div class="nt-tools">
            <button type="button" class="btn btn-sm" data-ntprompt="1" title="看判帖这一步现在拼给 AI 的提示词（含这张表）">👁 看提示词</button>
            <button type="button" class="btn btn-sm" disabled title="候选卡由复盘 AI 产出，这块还没接上；这一轮先直接改表">🤖 让 AI 补卡（下一步）</button>
            <span class="note">想加一种新场景的说法，去下面「评论场景表」里加卡。</span>
          </div>
        </div>
      </div>`;
    const cfgTabHtml = `
      <div class="plan-tabs">
        <button type="button" class="plan-tab${_cfgPlanTab === 'find' ? ' on' : ''}" data-cfgplan="find">🧭 去哪儿找<span class="s">词 · 排班 · 盯号</span></button>
        <button type="button" class="plan-tab${_cfgPlanTab === 'rate' ? ' on' : ''}" data-cfgplan="rate">💬 怎么评<span class="s">笔记类型 · 场景卡</span></button>
        <span style="flex:1;"></span>
        <span class="plan-tabs-hint">一篇怎么跑，只看「怎么评」那张表</span>
      </div>`;
    const kwHtml = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 9px;padding-bottom:9px;border-bottom:1px solid var(--line,#eceef0);">
        <span style="font-size:12.5px;font-weight:800;color:#1f2937;">📚 关键词</span>
        <span class="sx-count" style="background:#f6f8fa;border:1px solid #eceef0;border-radius:20px;padding:1px 8px;">${pool.length} 个词 · 启用 ${enabledN}${orphanWords.length ? ' · <b style="color:#b45309;">' + orphanWords.length + ' 个还没挂玩法</b>' : ''}</span>
        <span class="qhelp" tabindex="0" data-tip="一张表：一行一个玩法，中间是这个玩法底下的词。词只有一份，一个词可以同时挂在几行里。要一次清掉几个词：先勾词前面的框，再点右边「🗑 批量移出」（词还在池里，挂着的别的玩法照跑）。停用 / 彻底删除 / 看上次跑，在最底下「📋 全部词」里。">?</span>
        <span style="flex:1;"></span>
      </div>
      ${platBarHtml}
      <div class="kwp-scroll">
        <table class="kwp-table">
          <colgroup><col style="width:212px;"><col><col style="width:116px;"><col style="width:104px;"></colgroup>
          <thead><tr><th>玩法</th><th>关键词</th><th>找词</th><th>每天挑几个</th></tr></thead>
          <tbody>
            ${kwpHighvRow()}
            ${DRAIN_PB_WORD.map(kwpRow).join('')}
            ${orphanWords.length ? kwpOrphanRow(orphanWords) : ''}
          </tbody>
        </table>
      </div>
      ${kwpAllWords()}
      <div class="sx-hint" style="margin:7px 0 0;">跑哪天、评论怎么说、找词按哪句，在上面「🎯 玩法配置」里按玩法排；这里只管「这个玩法底下有哪些词」和「每天挑几个」。玩法排上、今天又轮到 → 才进工作台那条队列；想整个停掉一个玩法，回上面把周几全部取消勾选。</div>
    `;
    /* 🧩 评论场景表入口（2026-11-11）：现场怎么说看这张表；关键词包只管跑词、排班和硬闸。 */
    let _ccCount = null;
    try {
      if (!window.DrainCards) {
        await new Promise((res) => {
          const s = document.createElement('script');
          s.src = 'lib/comment-cards.js';
          s.onload = () => res(true);
          s.onerror = () => res(false);
          document.head.appendChild(s);
        });
      }
      if (window.DrainCards) _ccCount = await DrainCards.countCards();
    } catch (_) {}
    const ccEntryHtml = `
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 12px;padding:12px 14px;background:linear-gradient(120deg,var(--c-brand-soft,#f2f8fd) 0%,#fff 72%);border:1px solid var(--c-brand-line,#cfe4f5);border-left:4px solid var(--c-brand,#0a6b8a);border-radius:10px;box-shadow:0 1px 3px rgba(16,24,40,.05);">
        <span style="font-size:22px;line-height:1;">🧩</span>
        <div style="flex:1;min-width:240px;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-size:14px;font-weight:800;color:#1f2937;">评论场景表</span>
            <span class="sx-count" style="background:#fff;border:1px solid var(--c-brand-line,#cfe4f5);border-radius:20px;padding:1px 8px;">${_ccCount ? (_ccCount.cards + ' 张卡 · ' + _ccCount.branches + ' 种情况 · ' + _ccCount.says + ' 句现成说法') : '点开看表'}</span>
          </div>
          <div class="sx-hint" style="margin:3px 0 0;">遇到什么场景、分几种情况、每种情况怎么说，都在这张表里；改完立刻生效。</div>
        </div>
        <button type="button" id="ccOpen" style="border:1px solid var(--c-brand,#0a6b8a);background:var(--c-brand,#0a6b8a);color:#fff;font-weight:700;font-size:13px;padding:8px 16px;border-radius:8px;cursor:pointer;font-family:inherit;">打开场景表 →</button>
      </div>`;
    /* 队列页＝配置台：顶上那两行灰字（正在跑指路 + 今天/明天排几次）2026-11-04 老板撤了；
       改完的回音还在——每存一次，右上角报一句「今天 N 次搜索（N 个词）」（save 里那段）。 */
    panel.innerHTML = `
      ${cfgTabHtml}
      ${_cfgPlanTab === 'rate'
        ? (ntHtml + ccEntryHtml)
        : (pbHtml + `<div style="${cardBox}">${kwHtml}</div>` + pbWeekHtml())}
    `;
    const ccOpenBtn = panel.querySelector('#ccOpen');
    if (ccOpenBtn) ccOpenBtn.onclick = () => window.open('comment-cards.html', '_blank');

    /* 🎯 玩法配置：周几跑 / 评论动作 / 引导 / 提店 / 开口 / 收进清单，
       改哪一格就存哪一格（存完整页重绘，展开块按 _drainTalkOpen 自己回来） */
    const pbSave = async (s, patch, msg) => {
      const nextPb = Object.assign({}, cfg.pbPlan || {});
      nextPb[s] = drainPbPlanNorm(Object.assign({}, drainPbPlan(cfg, s), patch), s);
      const r = await save({ pbPlan: nextPb }, true);
      if (!r || r.ok === false) {
        drainToast('没存上：' + ((r && r.error) || '服务器没回话'), 'warn');
        return false;
      }
      cfg.pbPlan = nextPb;
      if (msg) drainToast(msg);
      return true;
    };
    /* ── 十列：点格子就地弹一层选项（fixed 定位，不被表格的横向滚动裁掉） ── */
    let _pbPopEl = null;
    const pbClosePop = () => {
      /* 整页重绘时旧闭包里的 _pbPopEl 已经不是这一个了：按名字把它们全收掉，别留在页面外面 */
      document.querySelectorAll('.pbp-pop').forEach(el => el.remove());
      _pbPopEl = null;
      document.removeEventListener('mousedown', pbPopOutside, true);
      document.removeEventListener('keydown', pbPopKey, true);
    };
    function pbPopOutside(ev) {
      if (!_pbPopEl) return;
      if (_pbPopEl.contains(ev.target)) return;
      if (ev.target && ev.target.closest && ev.target.closest('[data-pbpop]')) return;
      pbClosePop();
    }
    function pbPopKey(ev) { if (ev.key === 'Escape') pbClosePop(); }
    const pbPopOpen = (anchor, s, kind) => {
      pbClosePop();
      const def = drainScenarioDef(s);
      const p = drainPbPlan(cfg, s);
      const people = p.mode === 'people';
      const TITLE = {
        days: '周几跑（可多选）',
        mode: drainScenarioId(s) === 'top' ? '评论动作：TOP 一定先评主笔记（不适合的帖仍跳过）' : '评论动作：这篇笔记做几件事',
        who: '捞谁 · 为了什么（这个玩法找什么样的人、为了什么）',
        city: '同城：这个玩法对同城评论怎么处理',
        guide: '引导：想让对方下一步做什么',
        store: '提店：能提自己到哪一步', entry: '进场：这条评论怎么开口',
        collect: '收不收人',
      };
      const OPT = { mode: drainPbModeOptions(s), city: DRAIN_PB_CITY, guide: DRAIN_PB_GUIDE, store: DRAIN_PB_STORE, entry: DRAIN_PB_ENTRY };
      let body = '';
      if (kind === 'days') {
        const cur = p.days.slice();
        body = `<div class="pbp-popdays">${DRAIN_WEEK_ORDER.map(d => `<button type="button" class="pbp-popday${cur.indexOf(d) >= 0 ? ' on' : ''}" data-popday="${d}">${WK_SHORT[d]}</button>`).join('')}</div>
          <div class="pbp-popquick"><button type="button" data-popset="12345">工作日</button><button type="button" data-popset="06">周末</button><button type="button" data-popset="all">每天</button><button type="button" data-popset="none">清空</button></div>
          <div class="pbp-popfoot"><span class="pbp-popmsg">改完点「存下」</span><button type="button" class="btn btn-sm btn-primary" data-popok="1">存下</button></div>`;
      } else if (kind === 'who') {
        body = `<div class="pbp-popwho"><textarea data-popwho rows="5" maxlength="400" placeholder="${escAttr(DRAIN_PB_WHO_DEFAULT[drainScenarioId(s)] || '写：这个玩法在什么样的人 / 评论里找机会，为了什么')}">${escHtml(p.who || '')}</textarea>
          <div class="pbp-popfoot"><span class="pbp-popmsg">留空＝用内置那句</span><button type="button" class="btn btn-sm btn-primary" data-popwhook="1">存下</button></div></div>`;
      } else if (kind === 'collect') {
        body = `<div class="pbp-popopts"><button type="button" class="pbp-popopt${p.collect !== false ? ' on' : ''}" data-popval="1">收进清单</button><button type="button" class="pbp-popopt${p.collect === false ? ' on' : ''}" data-popval="0">不收，只评</button></div>`;
      } else {
        const map = OPT[kind] || {};
        body = `<div class="pbp-popopts">${Object.keys(map).map(k => `<button type="button" class="pbp-popopt${p[kind] === k ? ' on' : ''}" data-popval="${k}" title="${escAttr(map[k])}">${escHtml(map[k])}</button>`).join('')}</div>`;
      }
      const el = document.createElement('div');
      el.className = 'pbp-pop';
      el.innerHTML = `<div class="pbp-pop-h">${escHtml(def.icon + ' ' + def.label + ' · ' + (TITLE[kind] || ''))}</div>${body}`;
      document.body.appendChild(el);
      _pbPopEl = el;
      const r = anchor.getBoundingClientRect();
      const w = el.offsetWidth, h = el.offsetHeight;
      const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
      el.style.left = left + 'px';
      el.style.top = top + 'px';

      if (kind === 'days') {
        let cur = p.days.slice();
        const paint = () => {
          el.querySelectorAll('[data-popday]').forEach(b => b.classList.toggle('on', cur.indexOf(Number(b.getAttribute('data-popday'))) >= 0));
          const msg = el.querySelector('.pbp-popmsg');
          if (msg) msg.textContent = pbDayLabel(cur);
        };
        el.querySelectorAll('[data-popday]').forEach(b => b.onclick = () => {
          const d = Number(b.getAttribute('data-popday'));
          const i = cur.indexOf(d);
          if (i >= 0) cur.splice(i, 1); else cur.push(d);
          cur.sort((a, b2) => a - b2);
          paint();
        });
        el.querySelectorAll('[data-popset]').forEach(b => b.onclick = () => {
          const k = b.getAttribute('data-popset');
          cur = k === 'none' ? [] : k === 'all' ? [0, 1, 2, 3, 4, 5, 6] : k === '06' ? [0, 6] : k.split('').map(Number);
          paint();
        });
        el.querySelector('[data-popok]').onclick = async () => {
          const days = cur.slice();
          pbClosePop();
          await pbSave(s, { days }, `${def.icon}${def.label}：` + (days.length ? days.map(x => WK_LABELS[x]).join('、') : '这周不跑'));
        };
      } else if (kind === 'who') {
        const ta = el.querySelector('[data-popwho]');
        const saveWho = async () => {
          const v = String((ta && ta.value) || '').replace(/\s+/g, ' ').trim().slice(0, 400);
          pbClosePop();
          await pbSave(s, { who: v }, `${def.icon}${def.label}：捞谁·为了什么已存`);
        };
        if (ta) ta.onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveWho(); };
        const ok = el.querySelector('[data-popwhook]');
        if (ok) ok.onclick = saveWho;
      } else {
        const apply = (v) => {
          if (kind === 'collect') return pbSave(s, { collect: v === '1' }, `${def.icon}${def.label}：` + (v === '1' ? '找到的人收进获客清单' : '不收人，只评'));
          const txt = (OPT[kind] || {})[v] || v;
          return pbSave(s, { [kind]: v }, `${def.icon}${def.label}：` + txt);
        };
        el.querySelectorAll('[data-popval]').forEach(b => b.onclick = () => {
          const v = b.getAttribute('data-popval');
          pbClosePop();
          apply(v);
        });
        if (people && ['store', 'guide', 'entry'].indexOf(kind) >= 0) {
          const msg = document.createElement('div');
          msg.className = 'pbp-pop-h';
          msg.style.margin = '6px 0 0';
          msg.textContent = '这个玩法配的是「只收人」，这格改了也不生效';
          el.appendChild(msg);
        }
        if (kind === 'mode' && drainScenarioId(s) === 'top') {
          const msg = document.createElement('div');
          msg.className = 'pbp-pop-h';
          msg.style.margin = '6px 0 0';
          msg.textContent = '回评论区：同城那一列选「优先 / 全收」时，同省的人排前面（按账号规划里的城市）。';
          el.appendChild(msg);
        }
      }
      setTimeout(() => {
        document.addEventListener('mousedown', pbPopOutside, true);
        document.addEventListener('keydown', pbPopKey, true);
      }, 0);
    };
    /* 一处的点击委托：格子弹窗、话术/出词展开都走这里（整页重绘后不用重新绑）
       用 onclick 赋值而不是 addEventListener：panel 一直是同一个元素，
       addEventListener 每次重绘都会叠一层，点一下弹好几个。 */
    /* ── 👁 看提示词（2026-11-08）──
       每个玩法 × 每个动作：最近一次真发的那份 + 按现在配置试拼的一份。
       客户只读；只有存过后台口令的那台电脑（老板自己）多一颗「让 AI 重写」。 */
    const openPromptView = async (s) => {
      const def = drainScenarioDef(s);
      const isOwner = (() => { try { return !!localStorage.getItem('demo_admin_pass'); } catch (_) { return false; } })();
      const ACTS = DRAIN_PROMPT_ACTS;
      const recs = {}, prevs = {};
      let act = 'note';
      let mode = 'last';
      if (!document.getElementById('dqvStyle')) {
        const css = document.createElement('style');
        css.id = 'dqvStyle';
        css.textContent = [
          '.dqv-mask{position:fixed;inset:0;z-index:99990;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:14px;box-sizing:border-box;}',
          '.dqv-sheet{width:min(900px,100%);max-height:92vh;background:#fff;border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.3);display:flex;flex-direction:column;overflow:hidden;font:13px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2937;}',
          '.dqv-h{display:flex;align-items:center;gap:9px;padding:12px 15px;border-bottom:1px solid #eceef0;font-size:14px;}',
          '.dqv-h .dqv-play{font-size:12px;color:#0a6b8a;background:#eef7fb;border:1px solid #d5e6f2;border-radius:20px;padding:1px 9px;}',
          '.dqv-x{border:none;background:transparent;font-size:20px;line-height:1;cursor:pointer;color:#6b7280;padding:0 4px;}',
          '.dqv-tabs{display:flex;gap:6px;padding:9px 15px 0;flex-wrap:wrap;}',
          '.dqv-tab{border:1px solid #e3e8ee;background:#fff;color:#374151;border-radius:20px;padding:4px 13px;font:inherit;font-size:12.5px;cursor:pointer;}',
          '.dqv-tab.on{background:#0a6b8a;border-color:#0a6b8a;color:#fff;font-weight:700;}',
          '.dqv-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 15px;border-bottom:1px solid #f0f2f4;}',
          '.dqv-src{display:inline-flex;border:1px solid #dfe5ea;border-radius:8px;overflow:hidden;}',
          '.dqv-src button{border:none;background:#fff;color:#4b5563;font:inherit;font-size:12px;padding:4px 11px;cursor:pointer;}',
          '.dqv-src button.on{background:#e8f4f8;color:#0a6b8a;font-weight:700;}',
          '.dqv-note{font-size:11.5px;color:#8a939c;}',
          '.dqv-ro{font-size:11.5px;color:#9aa3ab;}',
          '.dqv-body{padding:12px 15px 18px;overflow:auto;flex:1;}',
          '.dqv-src2{font-size:11.5px;color:#6b7280;margin:0 0 8px;}',
          '.dqv-h2{font-size:12px;font-weight:800;color:#111827;margin:12px 0 6px;}',
          '.dqv-seg{border:1px solid #eceef0;border-radius:9px;margin:0 0 7px;overflow:hidden;background:#fcfcfd;}',
          '.dqv-tag{display:inline-block;font-size:10.5px;font-weight:700;padding:3px 9px;letter-spacing:.3px;}',
          '.dqv-tag.tpl{background:#eef2f7;color:#334155;}',
          '.dqv-tag.play{background:#e8f4f8;color:#0a6b8a;}',
          '.dqv-tag.rule{background:#fff4e5;color:#9a5b00;}',
          '.dqv-tag.dedup{background:#f3ecff;color:#5b3fa8;}',
          '.dqv-tag.extra{background:#e9f7ef;color:#0a7b5a;}',
          '.dqv-tag.note{background:#fdecec;color:#a13b3b;}',
          '.dqv-pre{margin:0;padding:7px 10px 9px;white-space:pre-wrap;word-break:break-word;font:12px/1.72 ui-monospace,SFMono-Regular,Consolas,"Microsoft YaHei",monospace;color:#243040;}',
          '.dqv-final{border:1px solid #dfe5ea;border-radius:9px;padding:8px 10px;margin:10px 0 0;background:#f8fafc;}',
          '.dqv-fh{display:flex;align-items:center;gap:8px;margin:0 0 6px;font-size:12px;}',
          '.dqv-fh .btn{font-size:11px;padding:2px 9px;}',
          '.dqv-ta{width:100%;box-sizing:border-box;height:112px;border:1px solid #e3e8ee;border-radius:7px;padding:7px 9px;font:11.5px/1.68 ui-monospace,Consolas,monospace;color:#374151;background:#fff;resize:vertical;}',
          '.dqv-out{border:1px solid #e7ecef;border-radius:9px;margin:12px 0 0;padding:9px 11px;background:#fbfdfe;}',
          '.dqv-oh{font-size:11.5px;font-weight:800;color:#374151;margin:5px 0 3px;}',
          '.dqv-raw{white-space:pre-wrap;word-break:break-word;font:11.5px/1.7 ui-monospace,Consolas,monospace;color:#6b7280;background:#f5f7f9;border-radius:7px;padding:6px 8px;max-height:150px;overflow:auto;}',
          '.dqv-used{white-space:pre-wrap;word-break:break-word;font-size:12.5px;color:#0f3d2e;background:#eefaf3;border:1px solid #cdeedd;border-radius:7px;padding:7px 9px;}',
          '.dqv-skip{font-size:12.5px;color:#9a3412;background:#fff7ed;border:1px solid #fdba74;border-radius:7px;padding:7px 9px;}',
          '.dqv-meta{font-size:11px;color:#8a939c;margin-top:6px;}',
          '.dqv-load{font-size:12.5px;color:#6b7280;padding:12px 2px;}',
          '.dqv-err{font-size:12.5px;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:8px 10px;}',
          '.dqv-previewtip{font-size:11.5px;color:#8a939c;margin-top:9px;}',
          '.dqv-own{border-top:1px solid #eceef0;padding:10px 15px;background:#fcfcfd;}',
          '.dqv-ownh{font-size:11.5px;color:#6b7280;margin:0 0 7px;}',
          '.dqv-ownrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
          '.dqv-genmsg{font-size:11.5px;color:#0a7b5a;}',
          '.dqv-cand{border:1px solid #d5e6f2;border-radius:9px;padding:8px 10px;margin-top:8px;background:#f7fbfd;}',
          '@media (max-width:640px){.dqv-sheet{max-height:96vh;}.dqv-body{padding:10px 11px 14px;}}',
        ].join('');
        document.head.appendChild(css);
      }
      const mask = document.createElement('div');
      mask.className = 'dqv-mask';
      mask.innerHTML = '<div class="dqv-sheet" role="dialog" aria-modal="true">'
        + '<div class="dqv-h"><b>👁 看提示词</b><span class="dqv-play">' + escHtml(def.icon + ' ' + def.label) + '</span>'
        + '<span style="flex:1;"></span><button type="button" class="dqv-x" data-dqvx="1" title="关掉">×</button></div>'
        + '<div class="dqv-tabs">' + ACTS.map(function (a) { return '<button type="button" class="dqv-tab" data-dqvact="' + a.id + '">' + escHtml(a.label) + '</button>'; }).join('') + '</div>'
        + '<div class="dqv-bar"><span class="dqv-src"><button type="button" data-dqvmode="last">最近一次</button><button type="button" data-dqvmode="preview">试拼</button></span>'
        + '<span class="dqv-note" id="dqvNote"></span><span style="flex:1;"></span>'
        + '<span class="dqv-ro">' + (isOwner ? '这台电脑是老板的：下面可让 AI 重写' : '只读：要改就回玩法配置改参数') + '</span></div>'
        + '<div class="dqv-body" id="dqvBody"><div class="dqv-load">读取中…</div></div>'
        + (isOwner ? '<div class="dqv-own"><div class="dqv-ownh">让 AI 按这个玩法现在的料重写它那段话术（只改这个号自己这层，内置提示词和行业包不动）。</div>'
          + '<div class="dqv-ownrow"><button type="button" class="btn btn-sm btn-primary" id="dqvGen">✨ 让 AI 重写这个玩法的提示词</button>'
          + '<span id="dqvGenMsg" class="dqv-genmsg"></span></div><div id="dqvGenOut"></div></div>' : '')
        + '</div>';
      document.body.appendChild(mask);

      const bodyEl = () => mask.querySelector('#dqvBody');
      const fmtAt = (t) => {
        const n = Number(t) || 0;
        if (!n) return '';
        const d = new Date(n);
        const p2 = (x) => (x < 10 ? '0' + x : '' + x);
        return p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
      };
      const loadPreview = async (a) => {
        prevs[a] = { loading: true };
        try {
          const material = (recs[a] && recs[a].material) || drainPromptSample(a);
          const r = await chrome.runtime.sendMessage({ action: 'drainPromptPreview', data: { act: a, scenario: s, material: material } });
          prevs[a] = (r && r.ok !== false) ? (r || {}) : { ok: false, error: (r && r.error) || '服务器没回话' };
        } catch (e) {
          prevs[a] = { ok: false, error: (e && e.message) || String(e) };
        }
      };
      const paintTabs = () => {
        mask.querySelectorAll('[data-dqvact]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-dqvact') === act); });
        mask.querySelectorAll('[data-dqvmode]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-dqvmode') === mode); });
      };
      const outCard = (r) => {
        const used = String(r.used || '');
        const raw = String(r.raw || '');
        const skip = String(r.skip || '');
        const meta = [];
        if (r.chars) meta.push('用出去 ' + r.chars + ' 字');
        if (r.ms) meta.push('用时 ' + (Number(r.ms) / 1000).toFixed(1) + ' 秒');
        if (r.tokensIn || r.tokensOut) meta.push('tokens ' + (r.tokensIn || 0) + ' / ' + (r.tokensOut || 0));
        if (r.model) meta.push(r.model);
        return '<div class="dqv-out">'
          + (skip ? '<div class="dqv-skip">这一趟没生成：' + escHtml(skip) + '</div>' : '')
          + (raw ? '<div class="dqv-oh">AI 原话（回来的原文）</div><div class="dqv-raw">' + escHtml(raw) + '</div>' : '')
          + (used ? '<div class="dqv-oh">实际发出去的字</div><div class="dqv-used">' + escHtml(used) + '</div>' : '')
          + (Number(r.chars) > 2000 ? '<div class="dqv-meta">（这里只留前 2000 字，原长 ' + r.chars + ' 字）</div>' : '')
          + (meta.length ? '<div class="dqv-meta">' + escHtml(meta.join(' · ')) + '</div>' : '')
          + '</div>';
      };
      const paint = () => {
        paintTabs();
        const b = bodyEl();
        if (!b) return;
        if (mode === 'preview' && prevs[act] === undefined) {
          b.innerHTML = '<div class="dqv-load">⏳ 按你现在的配置拼一份（不调模型、不计费）……</div>';
          loadPreview(act).then(paint);
          return;
        }
        if (mode === 'last' && !recs[act]) {
          const n0 = mask.querySelector('#dqvNote');
          if (n0) n0.textContent = '这个号还没真跑过这一步';
          b.innerHTML = '<div class="dqv-load">这一步还没真跑过，没有可看的「最近一次」。点上面的「试拼」，看按现在的配置会拼成什么样。</div>';
          return;
        }
        const r = (mode === 'last') ? recs[act] : prevs[act];
        const noteEl = mask.querySelector('#dqvNote');
        if (noteEl) {
          noteEl.textContent = (mode === 'last'
            ? (r && r.at ? ('这一份是 ' + fmtAt(r.at) + ' 真的发出去的那次') : '')
            : '按现在的配置试拼，不会真的发，也不计费');
        }
        if (!r) { b.innerHTML = '<div class="dqv-load">这一趟还没跑过。</div>'; return; }
        if (r.ok === false || r.error) { b.innerHTML = '<div class="dqv-err">拼不出来：' + escHtml(String(r.error || '未知原因')) + '</div>'; return; }
        const p = r.prompts || { system: r.sys, user: r.user };
        if (!p || (!p.system && !r.skip)) {
          b.innerHTML = '<div class="dqv-err">这一趟没留下提示词' + (r.skip ? '：' + escHtml(String(r.skip)) : '') + '</div>';
          return;
        }
        /* 这一步本来就不做（只回评论区 / 只收人 / 同行帖）：没有提示词，把原因摊开 */
        if (!p.system && !p.user) {
          b.innerHTML = '<div class="dqv-skip">这一步没生成：' + escHtml(String(r.skip || r.reason || '没过闸门')) + '</div>';
          return;
        }
        const segs = drainPromptSegments(p.system);
        const userTxt = String(p.user || '');
        b.innerHTML = '<div class="dqv-src2">' + (mode === 'last' ? '最近一次真发的那一份' : '试拼：按现在的配置 + ' + (recs[act] && recs[act].material ? '上次用的料' : '一份样例料')) + '</div>'
          + '<div class="dqv-h2">System · 给 AI 的规矩（按来源分段）</div>'
          + (segs.length ? segs.map(function (x) {
            return '<div class="dqv-seg"><span class="dqv-tag ' + x.tone + '">' + escHtml(x.label) + '</span><pre class="dqv-pre">' + escHtml(x.text) + '</pre></div>';
          }).join('') : '<div class="dqv-load">（没有 System）</div>')
          + '<div class="dqv-h2">User · 这一单的料</div>'
          + '<div class="dqv-seg"><span class="dqv-tag note">这一单的料</span><pre class="dqv-pre">' + escHtml(userTxt) + '</pre></div>'
          + '<div class="dqv-final"><div class="dqv-fh"><b>两段全文（可直接复制）</b><button type="button" class="btn btn-sm" data-dqvcopy="1">📋 复制</button></div>'
          + '<textarea class="dqv-ta" readonly>' + escHtml('【System】\n' + String(p.system || '') + '\n\n【User】\n' + userTxt) + '</textarea></div>'
          + (mode === 'last' ? outCard(r) : '<div class="dqv-previewtip">试拼不调模型：这里没有 AI 的原话，也没有用出去的字。</div>');
      };
      const genTalk = async () => {
        const msg = mask.querySelector('#dqvGenMsg');
        const out = mask.querySelector('#dqvGenOut');
        const btn = mask.querySelector('#dqvGen');
        if (!msg || !out || !btn) return;
        if (!personaText) { msg.textContent = '先到「账号规划 → 基础配置」写一句自我介绍，才能按人设重写。'; return; }
        btn.disabled = true;
        msg.textContent = 'AI 正在按这个玩法重写…（十来秒）';
        out.innerHTML = '';
        try {
          const r = await chrome.runtime.sendMessage({ action: 'aiGenerateDrainTalk', scenario: s, instruction: '', last: null });
          if (r && r.ok === false) throw new Error(r.error || 'AI 没回话');
          const text = String((r && (r.text || (r.talk && r.talk.text))) || '').trim();
          if (!text) throw new Error('AI 回来的格式不对，再点一次试试');
          out.dataset.text = text;
          out.innerHTML = '<div class="dqv-cand"><div class="dqv-oh">AI 写的这一版（还没存）</div>'
            + '<div class="dqv-used">' + escHtml(text) + '</div>'
            + '<div class="dqv-ownrow" style="margin-top:7px;"><button type="button" class="btn btn-sm btn-primary" data-dqvkeep="1">存下这版</button>'
            + '<button type="button" class="btn btn-sm" data-dqvagain="1">再来一版</button>'
            + '<span class="dqv-genmsg">存下会替换这个玩法现在的话术。</span></div></div>';
          msg.textContent = '写好了，看下面。';
        } catch (e) {
          msg.textContent = '没配上：' + ((e && e.message) || e);
        } finally {
          btn.disabled = false;
        }
      };
      mask.addEventListener('click', async (ev) => {
        if (ev.target === mask) { mask.remove(); return; }
        const t = ev.target;
        if (!t || !t.closest) return;
        if (t.closest('[data-dqvx]')) { mask.remove(); return; }
        const ab = t.closest('[data-dqvact]');
        if (ab) { act = ab.getAttribute('data-dqvact'); paint(); return; }
        const mb = t.closest('[data-dqvmode]');
        if (mb) { mode = mb.getAttribute('data-dqvmode'); paint(); return; }
        if (t.closest('[data-dqvcopy]')) {
          const ta = mask.querySelector('.dqv-ta');
          if (!ta) return;
          try {
            await navigator.clipboard.writeText(ta.value);
            drainToast('📋 两段全文已复制');
          } catch (_) {
            ta.select();
            try { document.execCommand('copy'); drainToast('📋 已复制'); } catch (e2) { drainToast('复制不了：自己框选一下', true); }
          }
          return;
        }
        if (t.closest('#dqvGen')) { genTalk(); return; }
        if (t.closest('[data-dqvagain]')) { genTalk(); return; }
        if (t.closest('[data-dqvkeep]')) {
          const out = mask.querySelector('#dqvGenOut');
          const txt = String((out && out.dataset.text) || '');
          if (!txt) return;
          if (!window.confirm('存下会替换「' + def.label + '」现在的话术，接着存？')) return;
          try {
            await talkSaveOne(s, txt);
            mask.querySelector('#dqvGenMsg').textContent = '✅ 已存下；下一趟就按新的拼。';
            out.innerHTML = '';
          } catch (e) {
            mask.querySelector('#dqvGenMsg').textContent = '没存上：' + ((e && e.message) || e);
          }
          return;
        }
      });
      try {
        const d = await chrome.storage.local.get(DRAIN_PROMPT_KEY);
        const all = (d && d[DRAIN_PROMPT_KEY]) || {};
        ACTS.forEach(function (a) { recs[a.id] = all[drainPromptSlot(s, a.id)] || null; });
      } catch (_) {}
      if (!recs[act]) mode = 'preview';
      paint();
    };

    panel.onclick = (ev) => {
      const t = ev.target;
      if (!t || !t.closest) return;
      const cpt = t.closest('[data-cfgplan]');
      if (cpt) {
        ev.preventDefault();
        const v = cpt.getAttribute('data-cfgplan');
        if (v !== _cfgPlanTab) { _cfgPlanTab = v; renderScanCfg(); }
        return;
      }
      const ntp = t.closest('[data-ntprompt]');
      if (ntp) { ev.preventDefault(); openPromptView('latest'); return; }
      const popBtn = t.closest('[data-pbpop]');
      if (popBtn) {
        ev.preventDefault();
        const kv = String(popBtn.getAttribute('data-pbpop') || '').split('|');
        const s = kv[0], kind = kv[1];
        if (!s || !kind) return;
        /* 「已停用」老状态：点一下先恢复节奏，不再弹选择 */
        if (kind === 'days' && run[s] && run[s].mode === 'off') {
          const nextRun = Object.assign({}, cfg.typeRun || DRAIN_TYPE_RUN_DEFAULT);
          nextRun[s] = _drainRunNorm(DRAIN_TYPE_RUN_DEFAULT[s] || { mode: 'each' });
          save({ typeRun: nextRun });
          drainToast(drainScenarioDef(s).icon + drainScenarioDef(s).label + '：已恢复默认节奏');
          return;
        }
        pbPopOpen(popBtn, s, kind);
        return;
      }
      const pv = t.closest('[data-promptview]');
      if (pv) { ev.preventDefault(); openPromptView(pv.getAttribute('data-promptview')); return; }
      const tk = t.closest('[data-talkedit],[data-talkclose]');
      if (tk) { ev.preventDefault(); talkToggle(tk.getAttribute('data-talkedit') || tk.getAttribute('data-talkclose')); return; }
      const wr = t.closest('[data-wredit]');
      if (wr) { ev.preventDefault(); talkToggle(wr.getAttribute('data-wredit'), 'wr'); }
    };
    panel.querySelectorAll('[data-pbper]').forEach(inp => inp.onchange = () => {
      const s = inp.getAttribute('data-pbper');
      const n = Math.max(1, Math.min(20, parseInt(inp.value, 10) || 1));
      inp.value = n;
      const def = drainScenarioDef(s);
      pbSave(s, { perDay: n }, `${def.icon}${def.label}：每个排上的日子挑 ${n} 个词`);
    });
    /* 📝 笔记类型表：改哪一格就存哪一格（存完整页重绘，表格状态跟着回来）。
       广告 / 悲伤两类没有下拉，锁死不给改。 */
    panel.querySelectorAll('[data-nt]').forEach(sel => sel.onchange = async () => {
      const kv = String(sel.getAttribute('data-nt') || '').split('|');
      const id = kv[0], kind = kv[1];
      const d0 = DRAIN_NOTE_TYPE_DEF[id];
      if (!d0 || !kind) return;
      const types = drainNoteTypesFor(cfg);
      types[id] = Object.assign({}, types[id], { [kind]: sel.value });
      const r = await save({ noteTypes: drainNoteTypesNorm(types) }, true);
      if (!r || r.ok === false) return;
      const label = kind === 'mode' ? DRAIN_NOTE_MODE[sel.value] : (kind === 'act' ? DRAIN_NOTE_ACT[sel.value] : DRAIN_PB_STORE[sel.value]);
      drainToast(d0.icon + d0.name + '：' + label);
    });
    panel.querySelectorAll('[data-ntcollect]').forEach(inp => inp.onchange = async () => {
      const id = inp.getAttribute('data-ntcollect');
      const d0 = DRAIN_NOTE_TYPE_DEF[id];
      if (!d0) return;
      const types = drainNoteTypesFor(cfg);
      types[id] = Object.assign({}, types[id], { collect: !!inp.checked });
      const r = await save({ noteTypes: drainNoteTypesNorm(types) }, true);
      if (r && r.ok !== false) drainToast(d0.icon + d0.name + '：' + (inp.checked ? '有需求的人收进清单' : '不收人'));
    });
    /* 📅 周日历：切本周 / 下周（只换预览，不存配置） */
    panel.querySelectorAll('[data-wkoff]').forEach(btn => btn.onclick = () => {
      _drainWeekOff = Number(btn.getAttribute('data-wkoff')) ? 1 : 0;
      renderScenarioDrain(container, mode);
    });
    /* ⏱ 抢首评的「刚起来」线：三条一起判，存进 freshCfg（整页重绘后输入框回到新值） */
    const freshSave = panel.querySelector('#pbFreshSave');
    if (freshSave) freshSave.onclick = async () => {
      const num = (id, d, min, max) => {
        const v = Number(document.getElementById(id) && document.getElementById(id).value);
        return Math.min(max, Math.max(min, Number.isFinite(v) && String(document.getElementById(id).value).trim() !== '' ? v : d));
      };
      const fc = {
        hours: num('pbFreshHours', 6, 1, 168),
        likes: num('pbFreshLikes', 200, 0, 1000000),
        comments: num('pbFreshComments', 20, 0, 100000),
      };
      const msg = document.getElementById('pbFreshMsg');
      if (msg) msg.textContent = '存着…';
      const r = await save({ freshCfg: fc }, true);
      if (msg) msg.textContent = (!r || r.ok === false) ? ('没存上：' + ((r && r.error) || '服务器没回话')) : '✅ 已存下';
      if (r && r.ok !== false) drainToast(`⏱ 抢首评线：≤${fc.hours} 小时 · 赞<${fc.likes} · 评论<${fc.comments}`);
    };

    /* 出词策略（2026-11-04 老板加）：写在排班行右边那一格，存进 pbPlan[玩法].wordRule；
       找词时后端优先用这句，空着才用内置那句。存完不整页重绘——展开块还开着，接着改。 */
    const wrMsg = (s, txt, cls) => {
      const el = panel.querySelector('[data-wrmsg="' + s + '"]');
      if (el) { el.className = 'wrmsg' + (cls ? ' ' + cls : ''); el.textContent = txt || ''; }
    };
    panel.querySelectorAll('[data-wrreset]').forEach(b => b.onclick = () => {
      const ta = panel.querySelector('[data-writext="' + b.getAttribute('data-wrreset') + '"]');
      if (ta) ta.value = '';
      wrMsg(b.getAttribute('data-wrreset'), '框里空着＝用下面那句内置口径，点「保存出词策略」才生效。');
    });
    panel.querySelectorAll('[data-wrsave]').forEach(b => b.onclick = async () => {
      const s = b.getAttribute('data-wrsave');
      const ta = panel.querySelector('[data-writext="' + s + '"]');
      const txt = drainPbWordRuleNorm(ta ? ta.value : '');
      if (txt.length < 6) { wrMsg(s, '太短了 AI 抓不住：至少写一句怎么说词（如「都要带杭州、别出品牌名」）。', 'err'); return; }
      const nextPb = Object.assign({}, cfg.pbPlan || {});
      nextPb[s] = drainPbPlanNorm(Object.assign({}, drainPbPlan(cfg, s), { wordRule: txt }), s);
      b.disabled = true;
      try {
        const r = await chrome.runtime.sendMessage({ action: 'drainSaveScanCfg', cfg: Object.assign({}, cfg, { pbPlan: nextPb }) });
        if (!r || r.ok === false) throw new Error((r && r.error) || '服务器没回话');
        cfg.pbPlan = nextPb;
        const box = panel.querySelector('[data-wrbox="' + s + '"]');
        if (box) box.innerHTML = wrTxHtml(s, txt);
        wrMsg(s, '✅ 已存（' + txt.length + ' 字），下次点「✨ 找词」就按这句找。', 'ok');
        const def = drainScenarioDef(s);
        drainToast(`${def.icon}${def.label}：出词策略已存`);
      } catch (e) {
        wrMsg(s, '没存上：' + ((e && e.message) || e) + '，原来那句还在。', 'err');
      } finally { b.disabled = false; }
    });
    /* 💬 排班行的「评论策略」（原「话术」）：摆在排班行下面，点「改」就地展开，不再弹窗 */
    const _talkEl = (s, attr) => panel.querySelector('[' + attr + '="' + s + '"]');
    /* 后台回来的一段话；万一还是老的「四步」格式，也拼成一段接住 */
    const _talkPick = (raw) => {
      if (!raw) return '';
      if (String(raw.text || '').trim()) return String(raw.text).trim();
      const old = drainPbTalkNorm(raw);
      return old ? old.text : '';
    };
    const talkMsg = (s, txt, cls) => {
      const el = _talkEl(s, 'data-talkmsg');
      if (el) { el.className = 'talkmsg' + (cls ? ' ' + cls : ''); el.textContent = txt || ''; }
    };
    const talkBusy = (s, on) => {
      const box = panel.querySelector('#talkedit-' + s);
      if (!box) return;
      ['[data-talksave]', '[data-talkreset]', '[data-talktext]'].forEach(sel => {
        const el = box.querySelector(sel);
        if (el) el.disabled = !!on;
      });
      const ai = box.querySelector('[data-talkai]');
      if (ai) ai.disabled = !!on || !personaText;
    };
    /* 只存这一个玩法；不整页重绘，行下面显示的那行字跟着换 */
    const talkSaveOne = async (s, text) => {
      const next = Object.assign({}, cfg.pbTalk || {});
      const norm = drainPbTalkNorm({ text: text, persona: personaText, at: Date.now(), v: DRAIN_TALK_V });
      if (!norm) throw new Error('评论策略还是空的');
      next[s] = norm;
      const r = await chrome.runtime.sendMessage({ action: 'drainSaveScanCfg', cfg: Object.assign({}, cfg, { pbTalk: next }) });
      if (!r || r.ok === false) throw new Error((r && r.error) || '服务器没回话');
      cfg.pbTalk = next;
      const ta = _talkEl(s, 'data-talktext'); if (ta) ta.value = norm.text;
      const line = _talkEl(s, 'data-talkline'); if (line) line.textContent = norm.text;
      return true;
    };
    /* instruction 为空＝按人设整段重写；有值＝按老板这句话改 */
    const talkGen = async (s, instruction) => {
      const ta = _talkEl(s, 'data-talktext');
      if (!ta || ta.disabled) return;
      if (!personaText) {
        talkMsg(s, '还没填人设：先去「账号规划 → 基础配置」写一句「用一句话介绍你自己」，评论策略才写得准。', 'err');
        return;
      }
      const cur = String(ta.value || '').trim();
      const ins = String(instruction || '').trim();
      if (ins && !cur) { talkMsg(s, '先有内容才能改：自己写两句，或点「恢复默认」。', 'err'); return; }
      const askEl = _talkEl(s, 'data-talkask');
      if (ins && askEl) askEl.value = '';
      talkBusy(s, true);
      talkMsg(s, ins ? 'AI 正在按「' + ins + '」改…（十来秒）' : 'AI 正在按账号人设整段重写…（十来秒）');
      try {
        const r = await chrome.runtime.sendMessage({ action: 'aiGenerateDrainTalk', scenario: s, instruction: ins, last: cur || null });
        if (r && r.ok === false) throw new Error(r.error || 'AI 没回话');
        const text = _talkPick((r && (r.talk || r)) || null);
        if (!text) throw new Error('AI 回来的格式不对，再点一次试试');
        ta.value = text;
        await talkSaveOne(s, text);
        talkMsg(s, (ins ? '✅ 改好了，已存下' : '✅ 写好了，已存下') + '：哪句不顺手直接改，或再说一句让它改。', 'ok');
      } catch (e) {
        talkMsg(s, '❌ 没配上：' + ((e && e.message) || e) + '，旧的那份没动；再点一次重试', 'err');
      } finally {
        talkBusy(s, false);
      }
    };
    const talkToggle = (s, from) => {
      const box = panel.querySelector('#talkedit-' + s);
      if (!box) return;
      const open = !box.classList.contains('open');
      panel.querySelectorAll('.pbp-tedit.open').forEach(el => el.classList.remove('open'));
      panel.querySelectorAll('[data-talkedit]').forEach(b => { b.textContent = '📄 改'; });
      panel.querySelectorAll('[data-wredit]').forEach(b => { b.textContent = '改'; });
      if (open) {
        box.classList.add('open');
        panel.querySelectorAll(`[data-talkedit="${s}"]`).forEach(b => { b.textContent = '收起'; });
        panel.querySelectorAll(`[data-wredit="${s}"]`).forEach(b => { b.textContent = '收起'; });
        _drainTalkOpen = s;
        const ta = _talkEl(s, from === 'wr' ? 'data-writext' : 'data-talktext');
        if (ta) ta.focus();
      } else {
        _drainTalkOpen = null;
      }
    };
    panel.querySelectorAll('[data-talksave]').forEach(b => b.onclick = async () => {
      const s = b.getAttribute('data-talksave');
      const ta = _talkEl(s, 'data-talktext');
      const text = ta ? String(ta.value || '').trim() : '';
      if (!text) { talkMsg(s, '评论策略还是空的，先写两句再存。', 'err'); return; }
      b.disabled = true;
      try {
        await talkSaveOne(s, text);
        talkMsg(s, '✅ 已存下。', 'ok');
        drainToast('💬 「' + drainScenarioDef(s).label + '」的评论策略已存');
      } catch (e) {
        talkMsg(s, '没存上：' + ((e && e.message) || e), 'err');
      } finally { b.disabled = false; }
    });
    panel.querySelectorAll('[data-talkreset]').forEach(b => b.onclick = () => {
      const s = b.getAttribute('data-talkreset');
      const ta = _talkEl(s, 'data-talktext');
      if (ta) ta.value = drainPbCopy(st.cfg, s, 'talk') || DRAIN_TALK_DEFAULT[s] || '';
      talkMsg(s, '已恢复成这一段默认，点保存才算存下。');
    });
    panel.querySelectorAll('[data-talkai]').forEach(b => b.onclick = () => {
      const s = b.getAttribute('data-talkai');
      const askEl = _talkEl(s, 'data-talkask');
      talkGen(s, askEl ? String(askEl.value || '').trim() : '');
    });
    panel.querySelectorAll('[data-talkask]').forEach(inp => inp.onkeydown = (ev) => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      const btn = _talkEl(inp.getAttribute('data-talkask'), 'data-talkai');
      if (btn) btn.click();
    });

    /* 词：启用 / 移除（2026-10-01 起用词名做键，列表可按批次筛选，行内不再用下标） */
    panel.querySelectorAll('[data-poolon]').forEach(c => c.onchange = () => {
      const k = c.getAttribute('data-poolon');
      const next = pool.map(e => Object.assign({}, e));
      if (c.checked && enabledN >= max) { c.checked = false; drainToast(`启用中的词已达本版本上限（${max} 个），先停用一个再加`, 'warn'); return; }
      const it = next.find(x => x.k === k);
      if (it) it.on = c.checked;
      save({ keywords: next });
    });
    /* 批量移出（2026-11-04 老板加）：词前的小方框只是记账，点右边「找词」列那颗主按钮才真动；
       过程中在按钮上报「移出中 2/5」，整批一次保存（不是一个词存一次） */
    panel.querySelectorAll('[data-kwsel]').forEach(c => c.onchange = () => {
      const key = c.getAttribute('data-kwsel');
      if (c.checked) _kwSel.add(key); else _kwSel.delete(key);
      const s = key.split('|')[0];
      const btn = panel.querySelector('[data-kwbatchdel="' + s + '"]');
      const n = kwpSelN(s);
      if (btn) { btn.disabled = !n; btn.textContent = '🗑 批量移出' + (n ? '（' + n + '）' : ''); }
    });
    panel.querySelectorAll('[data-kwbatchdel]').forEach(b => b.onclick = async () => {
      const s = b.getAttribute('data-kwbatchdel');
      const def = drainScenarioDef(s);
      const keys = pool.filter(e => _kwSel.has(s + '|' + e.k)).map(e => e.k);
      if (!keys.length) { drainToast('先勾几个词：词名左边那个小方框', 'warn'); return; }
      const next = pool.map(e => Object.assign({}, e, { types: Object.assign({}, e.types) }));
      const old = b.textContent;
      b.disabled = true;
      for (let i = 0; i < keys.length; i++) {
        b.textContent = '移出中 ' + (i + 1) + '/' + keys.length + '…';
        const it = next.find(x => x.k === keys[i]);
        if (it) it.types[s] = false;
        _kwSel.delete(s + '|' + keys[i]);
        await new Promise(r => setTimeout(r, 140));
      }
      b.textContent = old;
      save({ keywords: next });
      drainToast('已从「' + def.label + '」批量移出 ' + keys.length + ' 个词；词还在词池，挂着的别的玩法照跑');
    });
    /* 「📋 全部词」：最右边那一列勾，上面那颗主按钮一次删（彻底从词池删掉） */
    panel.querySelectorAll('[data-poolsel]').forEach(c => c.onchange = () => {
      const k = c.getAttribute('data-poolsel');
      if (c.checked) _poolSel.add(k); else _poolSel.delete(k);
      const btn = _sel('sxPoolBatchDel');
      const n = pool.filter(e => _poolSel.has(e.k)).length;
      if (btn) { btn.disabled = !n; btn.textContent = '🗑 批量删除' + (n ? '（' + n + '）' : ''); }
    });
    const poolSelAll = _sel('sxPoolSelAll');
    if (poolSelAll) poolSelAll.onclick = () => {
      const all = pool.every(e => _poolSel.has(e.k));
      pool.forEach(e => { if (all) _poolSel.delete(e.k); else _poolSel.add(e.k); });
      renderScanCfg();
    };
    const poolBatchDel = _sel('sxPoolBatchDel');
    if (poolBatchDel) poolBatchDel.onclick = async () => {
      const keys = pool.filter(e => _poolSel.has(e.k)).map(e => e.k);
      if (!keys.length) { drainToast('先在右边那一列勾几个词', 'warn'); return; }
      const old = poolBatchDel.textContent;
      poolBatchDel.disabled = true;
      for (let i = 0; i < keys.length; i++) {
        poolBatchDel.textContent = '删除中 ' + (i + 1) + '/' + keys.length + '…';
        _poolSel.delete(keys[i]);
        await new Promise(r => setTimeout(r, 140));
      }
      poolBatchDel.textContent = old;
      save({ keywords: pool.filter(x => keys.indexOf(x.k) < 0) });
      drainToast('已从词池彻底删除 ' + keys.length + ' 个词（每个玩法里都没了）');
    };
    /* 投放平台：这一份配置派给哪几个平台（至少留一个；不想跑某个平台就取消勾它） */
    panel.querySelectorAll('[data-cfgplat]').forEach(c => c.onchange = () => {
      const p = c.getAttribute('data-cfgplat');
      const next = drainPlatsNorm(cfg.plats);
      next[p] = c.checked;
      if (!next.xhs && !next.dy) {
        next[p] = true; c.checked = true;
        drainToast('至少留一个平台；这条队列暂时不想跑，把「⏰ 每周自动跑」关掉', 'warn');
        return;
      }
      save({ plats: next });
    });

    /* ＋ 添加 / 回车加词：加到这一行对应的玩法里；这个词以前没有就新建，已经在池里就直接挂过去 */
    const addWordTo = (s, input) => {
      const v = String((input && input.value) || '').trim();
      if (!v) return;
      if (input) input.value = '';
      const def = drainScenarioDef(s);
      const hit = pool.find(x => x.k === v);
      if (hit) {
        if (drainWordTypeOn(hit, s)) { drainToast('「' + v + '」已经在「' + def.label + '」里了'); return; }
        const wasOff = hit.on === false;
        if (wasOff && enabledN >= max) { drainToast(`启用中的词已达上限（${max} 个）`, 'warn'); return; }
        const next = pool.map(e => Object.assign({}, e, { types: Object.assign({}, e.types) }));
        const it = next.find(x => x.k === v);
        it.types[s] = true;
        if (wasOff) it.on = true;
        save({ keywords: next });
        drainToast('已把「' + v + '」挂到「' + def.label + '」' + (wasOff ? '，并顺手启用了这个词' : ''));
        return;
      }
      if (pool.length >= max) { drainToast(`词池已达本版本上限（${max} 个），先移除一个再加`, 'warn'); return; }
      save({ keywords: pool.map(x => Object.assign({}, x)).concat(_drainPoolEntry(v, { src: 'manual', types: { [s]: true } })) });
      drainToast('已加词「' + v + '」，挂在「' + def.label + '」');
    };
    panel.querySelectorAll('[data-kwaddinput]').forEach(inp => inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addWordTo(inp.getAttribute('data-kwaddinput'), inp);
    }));
    panel.querySelectorAll('[data-kwadd]').forEach(b => b.onclick = () => {
      const s = b.getAttribute('data-kwadd');
      addWordTo(s, panel.querySelector('[data-kwaddinput="' + s + '"]'));
    });
    /* 没挂任何玩法的词（永远不会跑）：一键挂到「本地泛搜索」，之后照常排班 */
    const kwOrphan = _sel('sxKwOrphan');
    if (kwOrphan) kwOrphan.onclick = async () => {
      const next = pool.map(e => Object.assign({}, e, { types: Object.assign({}, e.types) }));
      let n = 0;
      next.forEach(e => {
        if (e.on === false) return;
        if (DRAIN_PB_WORD.some(s => drainWordTypeOn(e, s))) return;
        e.types.latest = true;
        n++;
      });
      if (!n) return;
      const r = await save({ keywords: next }, true);
      if (r && r.ok !== false) drainToast('已把 ' + n + ' 个词挂到「🧭 本地泛搜索」；要跑别的玩法再在表里挑');
    };
    panel.querySelectorAll('[data-kwai]').forEach(b => b.onclick = () => fetchAiCandidates(b.getAttribute('data-kwai')));
    panel.querySelectorAll('[data-kwtopic]').forEach(b => b.onclick = () => fetchTopicCandidates());
    /* 👤 盯的账号 / 🌿 日常浏览：配置入口留在队列页（弹窗在队列页壳上，由 renderDrainQueue 挂） */
    panel.querySelectorAll('[data-kwacct]').forEach(b => b.onclick = () => {
      const box = document.getElementById('drainQueueContent');
      if (box && typeof box._openAcct === 'function') box._openAcct();
    });
    const kwDaily = _sel('sxKwDaily');
    if (kwDaily) kwDaily.onclick = () => {
      const box = document.getElementById('drainQueueContent');
      if (box && typeof box._openBrowse === 'function') box._openBrowse();
    };
    // 候选区只在「关键词池」那一节里挂载；切到别的节时 _cand 还留着，回来再接着勾
    const candAll = _sel('sxCandAll'), candClose = _sel('sxCandClose'), candAdopt = _sel('sxCandAdopt');
    if (_cand && !_cand.loading && candAll && candClose && candAdopt) {
      candAll.onclick = (e) => {
        const boxes = panel.querySelectorAll('input[data-cand]');
        const allOn = Array.from(boxes).every(b => b.checked);
        boxes.forEach(b => { b.checked = !allOn; });
        e.target.textContent = allOn ? '全选' : '全不选';
      };
      candClose.onclick = () => { _cand = null; renderScanCfg(); };
      candAdopt.onclick = async () => {
        const picked = Array.from(panel.querySelectorAll('input[data-cand]:checked')).map(b => b.getAttribute('data-cand'));
        if (!picked.length) { drainToast('先勾几个词', 'warn'); return; }
        // 候选是谁出的，就挂到哪个玩法上：AI 找词＝用户选的玩法，话题采集＝同城异业
        const pb = _cand.playbook || 'latest';
        const pbLabel = drainScenarioDef(pb).icon + ' ' + drainScenarioDef(pb).label;
        const next = pool.map(e => Object.assign({}, e, { types: Object.assign({}, e.types) }));
        const byKey = new Map(next.map(e => [e.k, e]));
        let onN = next.filter(e => e.on !== false).length, added = 0, back = 0, skip = 0, tick = 0;
        for (const k of picked) {
          const hit = byKey.get(k);
          if (hit) {
            if (hit.on === false) {
              if (onN >= max) { skip++; continue; }
              hit.on = true; onN++; back++;
            }
            if (!drainWordTypeOn(hit, pb)) { hit.types = Object.assign({}, hit.types, { [pb]: true }); tick++; }
            continue;
          }
          if (next.length >= max || onN >= max) { skip++; continue; }
          const ne = _drainPoolEntry(k, { src: _cand.kind, types: { [pb]: true } });
          next.push(ne); byKey.set(k, ne); onN++; added++;
        }
        const bits = [];
        if (added) bits.push('新加 ' + added);
        if (back) bits.push('恢复 ' + back);
        if (tick) bits.push('补挂 ' + tick);
        if (skip) bits.push(skip + ' 个因上限/已在池跳过');
        drainToast((bits.length ? '入池：' + bits.join('，') : '没变化') + '（挂到「' + pbLabel + '」）', (added + back + tick) ? 'ok' : 'warn');
        _cand = null;
        save({ keywords: next });
      };
    }

    // 上次扫描那行：每重渲染一次就得重挂一次
    await renderLastScan();
  };

  /* ---- 候选区：AI 找词（按玩法出）/ 话题采集 → 勾选入池（不直接塞进池子） ---- */
  const fetchAiCandidates = async (pbArg) => {
    const cfg = await drainGetScanCfg();
    const max = await drainPoolMax();
    _cfgSec = 'run';   // 候选区在「关键词」这张卡里，别让用户回来找
    const playbook = (pbArg && DRAIN_PB_WORD.indexOf(pbArg) >= 0) ? pbArg : 'latest';
    const pbDef = drainScenarioDef(playbook);
    const pbLabel = pbDef.icon + ' ' + pbDef.label;
    /* 这一行自己写过出词策略就挂个牌子，免得老板以为还在按内置那句找 */
    const ownRule = String(((cfg.pbPlan || {})[playbook] || {}).wordRule || '').trim();
    _cand = { kind: 'ai', playbook, label: 'AI 找词 · ' + pbLabel + (ownRule ? '（按你写的那句）' : '（内置口径）'), loading: true, items: [] };
    await renderScanCfg();
    try {
      const need = Math.min(15, Math.max(8, max));
      const r = await chrome.runtime.sendMessage({ action: 'aiGenKeywords', data: { need, playbook, exclude: (cfg.keywords || []).map(e => e.k) } });
      if (!r || r.ok === false) throw new Error((r && r.error) || 'AI 找词失败');
      _cand = { kind: 'ai', playbook: (r.playbook || playbook), label: 'AI 找词 · ' + pbLabel, items: (r.keywords || []).map(k => ({ k })) };
    } catch (e) {
      _cand = null;
      drainToast('AI 找词失败：' + (e.message || e), 'error');
    }
    await renderScanCfg();
  };
  const fetchTopicCandidates = async () => {
    let list = [];
    try { list = (window.NoteTags && await window.NoteTags.list()) || []; } catch (_) { list = []; }
    _cfgSec = 'run';
    if (!list.length) {
      _cand = null;
      await renderScanCfg();
      drainToast('还没采集到 #话题：先搜索或点开几篇笔记，正文里的话题会自动收录（读得越多越准）', 'warn');
      return;
    }
    // 刷到过 2 次以上的默认勾上（一次性的偶发话题不算）
    _cand = { kind: 'topic', playbook: 'cross', label: '话题采集池（挂同城异业）', items: list.slice(0, 40).map(x => ({ k: x.tag, n: x.n, def: (x.n || 0) >= 2 })) };
    await renderScanCfg();
  };

  /* ---- 📊 这几天：逐篇记录按天归档（处理了多少篇 / 评论了多少条 / 没评的都为什么）----
     数据从「每篇留痕」的同一本账来：公网网页读服务器那本，执行器面板读本机留的那本。 */
  let _snapList = [];
  let _dayRange = 't';
  const _snapTime = (s) => { const n = Number(s && (s.at || s.ts)); return (Number.isFinite(n) && n > 1000000000000) ? n : 0; };
  const _dayKey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  const _mmdd = (t) => { const d = new Date(t); return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  function _dayLabel(key) {
    const now = Date.now();
    if (key === _dayKey(now)) return '今天 ' + _mmdd(now);
    if (key === _dayKey(now - 86400000)) return '昨天 ' + _mmdd(now - 86400000);
    return key.split('-').slice(1).map(x => String(x).padStart(2, '0')).join('-');
  }
  async function loadSnaps() {
    try {
      if (window.chrome && chrome.runtime && chrome.runtime.id === 'demo-page') {
        const r = await fetch('api/exec/notesnap/get', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ all: 1 }),
        });
        const j = await r.json();
        if (j && j.ok && Array.isArray(j.snaps) && j.snaps.length) return j.snaps;
      }
    } catch (_) {}
    try {
      const d = await chrome.storage.local.get('ex_note_snaps');
      return Array.isArray(d && d.ex_note_snaps) ? d.ex_note_snaps : [];
    } catch (_) { return []; }
  }
  /* 同一篇跑过两趟：按笔记算一次（取最新那条），别把「处理篇数」和评论条数翻倍 */
  function _snapKey(s) {
    const nid = String((s && s.noteId) || '').trim();
    if (nid) return 'id:' + nid;
    const t = String((s && s.title) || '').trim();
    if (t) return 't:' + t;
    return 'x:' + ((s && (s.id || s.ts)) || '');
  }
  function _snapStats(list) {
    const latest = {};
    (list || []).forEach(s => {
      const k = _snapKey(s);
      if (!latest[k] || _snapTime(s) >= _snapTime(latest[k])) latest[k] = s;
    });
    const rows = Object.keys(latest).map(k => latest[k]);
    let sent = 0, no = 0;
    const why = {};
    rows.forEach(s => {
      const n = Number(s && s.sent) || 0;
      sent += n;
      if (n <= 0) {
        no++;
        const w = String((s && (s.reason || s.decide)) || '没留原因').trim().replace(/^不评：/, '');
        const k = w.length > 16 ? w.slice(0, 16) + '…' : w;
        why[k] = (why[k] || 0) + 1;
      }
    });
    return { n: rows.length, sent, no, why };
  }
  function _whyPills(why, limit) {
    return Object.keys(why).sort((a, b) => why[b] - why[a]).slice(0, limit || 4)
      .map(k => `<span class="sx-daily-pill">没评 · ${escHtml(k)}${why[k] > 1 ? ' ×' + why[k] : ''}</span>`).join('');
  }
  function _indexSnaps() {
    _snapByNote = {};
    _snapList.slice().sort((a, b) => _snapTime(a) - _snapTime(b)).forEach(s => {
      if (s && s.noteId) _snapByNote['id:' + s.noteId] = s;
      if (s && s.title) _snapByNote['t:' + String(s.title).trim()] = s;
    });
  }
  let _snapByNote = {};
  function _snapForNote(n) {
    if (!n) return null;
    const nid = String(n.noteId || '').trim();
    if (nid && _snapByNote['id:' + nid]) return _snapByNote['id:' + nid];
    const t = String(n.title || '').trim();
    return (t && _snapByNote['t:' + t]) || null;
  }
  /* 这一篇的「笔记层结论」：大V/竞对 · 刚起来 · 本篇怎么做（AI 判的，写进每篇记录里） */
  function _reviewInfo(rev) {
    if (!rev || typeof rev !== 'object') return null;
    const who = rev.matched === 'highv' ? '👑 大V'
      : rev.matched === 'rival' ? '🕵️ 竞对' : '';
    const fresh = rev.fresh ? '⏱ 刚起来' : '';
    const ACT = { grab: '抢首评', comment: '值得评', reply: '只回评论', collect: '只收人', skip: '跳过' };
    const act = rev.fallback ? '没判成·按玩法' : (ACT[rev.action] || (rev.verdict === 'blocked' ? '跳过' : ''));
    const bits = [who, fresh, act].filter(Boolean);
    if (!bits.length) return null;
    const tip = [
      who ? (rev.matched === 'highv'
        ? '作者在你盯的大V名单里：整篇按大V口径——先赞同博主再补本行一句，不报店名，不主动捞评论区'
        : '作者在你盯的竞对名单里：这一篇只蹲人，不评论') : '',
      fresh ? ('判成「刚起来」：' + (rev.freshWhy || '发布没多久、赞和评论都还少')) : '',
      rev.reason ? ('AI 判断：' + rev.reason) : '',
      rev.why ? ('这一篇这么做：' + rev.why) : '',
    ].filter(Boolean).join('\n');
    return { text: bits.join(' · '), tip };
  }
  function _recLine(rec) {
    if (!rec) return '';
    const rv = _reviewInfo(rec.noteReview);
    const badge = rv
      ? `<span class="sx-rv" title="${escAttr(rv.tip)}" style="display:inline-block;margin-right:6px;padding:0 6px;border-radius:6px;background:#eef6fb;color:#0a6b8a;font-size:11px;vertical-align:1px;">${escHtml(rv.text)}</span>`
      : '';
    const n = Number(rec.sent) || 0;
    const reps = Array.isArray(rec.replies) ? rec.replies : [];
    if (n > 0) {
      const txt = String(rec.noteComment || '').trim();
      const first = (reps[0] && String(reps[0].t || '').trim()) || '';
      const said = txt || first;
      const who = (!txt && reps[0] && reps[0].a) ? '@' + reps[0].a + '：' : '';
      const head = txt ? '评了：「'
        : (reps.length > 1 ? '回了 ' + reps.length + ' 条：「' : '回了：「');
      const more = (txt && reps.length) ? ' · 另回 ' + reps.length + ' 人' : '';
      const line = said ? head + escHtml(who + said) + '」' + more : '评了 ' + n + ' 条';
      const tip = [
        rv ? rv.tip : '',
        txt ? '在笔记下评的：' + txt : '',
        reps.length ? '回了评论区：\n' + reps.map(x => '@' + (x.a || '') + '：' + (x.t || '')).join('\n') : '',
      ].filter(Boolean).join('\n') || line;
      return `<div class="sx-rec ok" title="${escAttr(tip)}">${badge}✅ ${line}</div>`;
    }
    const why = String(rec.reason || rec.decide || '没留原因').trim().replace(/^不评：/, '');
    const tipNo = [rv ? rv.tip : '', why].filter(Boolean).join('\n');
    return `<div class="sx-rec no" title="${escAttr(tipNo)}">${badge}没评 · ${escHtml(why)}</div>`;
  }
  async function paintDaily() {
    const box = _sel('sxDaily');
    if (!box) return;
    const had = _snapList.length;
    _snapList = await loadSnaps();
    _indexSnaps();
    if (!had && _snapList.length && !isCfg) { try { render(); } catch (_) {} }   // 记录读回来了，把每篇那行「评了啥」补上
    const now = Date.now();
    const todayKey = _dayKey(now);
    const todayList = _snapList.filter(s => _snapTime(s) && _dayKey(_snapTime(s)) === todayKey);
    const t = _snapStats(todayList);
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const t0 = now - i * 86400000;
      const k = _dayKey(t0);
      days.push(Object.assign({ key: k, label: _dayLabel(k) }, _snapStats(_snapList.filter(s => _snapTime(s) && _dayKey(_snapTime(s)) === k))));
    }
    const maxN = Math.max(1, ...days.map(d => d.n));
    const maxC = Math.max(1, ...days.map(d => d.sent));
    const weekRows = days.map(d => `
      <tr>
        <td class="d">${escHtml(d.label)}</td>
        <td class="num">${d.n}</td>
        <td><div class="sx-daily-bar"><i style="width:${Math.round(d.n / maxN * 100)}%"></i></div></td>
        <td class="num" style="color:#0a6b8a;">${d.sent}</td>
        <td><div class="sx-daily-bar b"><i style="width:${Math.round(d.sent / maxC * 100)}%"></i></div></td>
        <td style="color:#b45309;">${d.no}</td>
      </tr>`).join('');
    const empty = !_snapList.length;
    box.innerHTML = `
      <div class="sx-daily">
        <div class="sx-daily-h">
          <span>📊 这几天</span>
          ${empty ? '<span class="tag">账从今天开始记（跑过一篇就出现）</span>' : ''}
          <span style="flex:1;"></span>
          <span class="sx-daily-seg">
            <button type="button" data-day="t" class="${_dayRange === 't' ? 'on' : ''}">今天</button>
            <button type="button" data-day="w" class="${_dayRange === 'w' ? 'on' : ''}">近 7 天</button>
          </span>
        </div>
        <div id="sxDailyBody">
          ${_dayRange === 't' ? `
          <div class="sx-daily-num">
            <div class="cell a"><b>${t.n}</b><span>篇处理完</span></div>
            <div class="cell b"><b>${t.sent}</b><span>条评论</span></div>
            <div class="cell"><b style="color:#b45309;">${t.no}</b><span>篇没评</span></div>
          </div>
          ${t.no ? '<div class="sx-daily-why">' + _whyPills(t.why, 4) + '</div>' : (t.n ? '<div class="sx-daily-why"><span class="sx-daily-pill g">今天跑过的都评上了</span></div>' : '')}
          ` : `
          <table class="sx-daily-tbl">
            <thead><tr><th>日期</th><th>处理篇数</th><th></th><th>评论条数</th><th></th><th>没评的篇数</th></tr></thead>
            <tbody>${weekRows}</tbody>
          </table>
          <div class="sx-hint" style="margin:4px 0 0;">只记跑过的篇；更早的日子没有逐篇记录，就是空。</div>
          `}
        </div>
      </div>`;
    box.querySelectorAll('[data-day]').forEach(b => {
      b.onclick = () => { _dayRange = b.getAttribute('data-day'); paintDaily(); };
    });
  }

  /* 上次扫描结果一行（任务配置顶栏下方）：本轮跑过的优先，其次读落盘的上次汇总 */
  async function renderLastScan() {
    const sv = _sel('sxScanNote');
    if (!sv) return;
    if (_lastScanInfo) {
      sv.textContent = _lastScanInfo.text;
      sv.style.whiteSpace = 'pre-line';
      sv.style.color = _lastScanInfo.warn ? '#d97706' : '';
      sv.style.display = '';
      return;
    }
    const r = await chrome.runtime.sendMessage({ action: 'drainGetScanCfg' });
    const sm = r && r.ok && r.cfg.lastScanSummary;
    if (!sm) return;
    sv.textContent = `上次扫描：新${sm.foundNew} 并入获客${sm.imported || 0} 补${sm.backfilled} 共${sm.total}`;
    sv.style.display = '';
  }

  /* 词池概览一行（列表页用）：几个词 / 本轮到点几个来源。
     改配置去左栏「获客 · 🗂 队列 → ⚙️ 配置」，这里不再放入口（2026-09-25 老板：两个入口都撤） */
  async function refreshSrcLine() {
    const box = _sel('sxSrcLine');
    if (!box) return;
    let cfg = null;
    try { cfg = await drainGetScanCfg(); } catch (_) {}
    st.cfg = cfg;   // 顺带存一份：列表 hover 那句「跑法」要按这个号的行业口径包出
    if (!cfg) { box.innerHTML = ''; return; }
    const pool = (cfg.keywords || []);
    const onN = pool.filter(e => e.on !== false).length;
    let due = 0;
    try { due = drainBuildSources(cfg).length; } catch (_) {}
    box.innerHTML = `📚 词池 ${onN}/${pool.length} 个启用 · 本轮到点 <b style="color:var(--c-brand-text);">${due}</b> 个来源
      ${due ? '' : '<span style="color:#d97706;margin-left:6px;">（还没到点：可在「队列 → ⚙️ 配置」把要跑的类型改成「每轮跑」）</span>'}`;
  }

  if (isCfg) {
    await renderScanCfg();   // 里面顺带重挂「上次扫描」那行
    // 别的 Tab 点「✨找词 / 🏷话题」跳过来 → 交接意图：渲染完直接把候选区拉出来
    const want = _cfgWant;
    _cfgWant = null;
    if (want) {
      if (want === 'topic') await fetchTopicCandidates(); else await fetchAiCandidates();
    }
    return;
  }

  /* ---- 以下都是 📋 笔记列表 页 ---- */
  await refreshSrcLine();
  /* 💧 评论记录（原「记录」二级页）：默认收起，点开才拉明细——渲染仍由 popup.js 的 renderWaterSummary 出 */
  const waterFold = _sel('sxWaterFold');
  if (waterFold && typeof renderWaterSummary === 'function') {
    waterFold.style.display = '';
    const wBody = _sel('sxWaterBody');
    const wNum = _sel('sxWaterN');
    const paintWaterN = async () => {
      if (!wNum || typeof getWaterLogs !== 'function') return;
      try {
        const logs = await getWaterLogs();
        const t0 = new Date(); t0.setHours(0, 0, 0, 0);
        const n = logs.filter(l => Number(l.ts) >= t0.getTime()).length;
        wNum.textContent = logs.length ? `今天 ${n} 条 · 共 ${logs.length} 条` : '还没有记录';
      } catch (_) {}
    };
    await paintWaterN();
    waterFold.addEventListener('toggle', () => {
      if (!waterFold.open) return;
      if (wBody) renderWaterSummary(wBody);
      paintWaterN();
    });
  }
  /* 📊 这几天（按天的处理/评论账）：进页先画一次；列表本身不用等它 */
  paintDaily();

  /* 📈 拓客复盘并进这张表（2026-11-08）：顶部汇总/建议、表里评论列、池外评论都归它管。
     数据只读账本；采纳才写扫描屏蔽词 / 这个号补的规矩。 */
  let revCtx = null;
  let revBusy = false;
  let revFail = '';
  let revProgress = '';
  let revAutoTried = false;
  const revLoad = async () => {
    if (!window.AcquireReview) { revCtx = null; return; }
    try { window.AcquireReview.injectStyle(); } catch (_) {}
    try { revCtx = await window.AcquireReview.load(); } catch (_) { revCtx = null; }
  };
  const revChanged = async () => {
    await revLoad();
    paintRevTop();
    render();
  };
  const paintRevBar = () => {
    const hint = _sel('sxRevHint');
    const btn = _sel('sxGrade');
    const ready = !!(revCtx && window.AcquireReview);
    const pend = ready ? window.AcquireReview.pending(revCtx) : 0;
    if (hint) hint.textContent = !ready ? '' : (revBusy ? (revProgress ? `AI 正在判 ${revProgress}` : 'AI 正在判…') : (pend ? `${pend} 条待判` : (revCtx.rows3.length ? '都判完了' : '最近 3 天没有记录')));
    if (btn) {
      btn.style.display = ready ? '' : 'none';
      btn.disabled = !ready || revBusy || !pend;
      btn.textContent = revBusy ? 'AI 正在判…' : 'AI 判一遍';
    }
  };
  const paintRevTop = () => {
    if (!revCtx || !window.AcquireReview) return;
    const top = _sel('sxReviewTop');
    if (top) {
      top.innerHTML = window.AcquireReview.topHtml(revCtx, { fail: revFail });
      window.AcquireReview.bindTop(top, revCtx, revChanged);
    }
    const foot = _sel('sxReviewFoot');
    if (foot) foot.innerHTML = window.AcquireReview.versionsHtml(revCtx) || '';
    paintRevBar();
  };
  async function revRunGrade() {
    if (revBusy || !revCtx || !window.AcquireReview) return;
    revBusy = true;
    revFail = '';
    revProgress = '';
    paintRevBar();
    try {
      const res = await window.AcquireReview.grade(revCtx, (done, total) => {
        revProgress = `${done} / ${total}`;
        paintRevBar();
      });
      revFail = res.fail || '';
      if (!res.fail && res.graded) drainToast(`判完了：${res.graded} 条`);
      await revLoad();
    } catch (e) {
      revFail = (e && e.message) || String(e);
    }
    revBusy = false;
    revProgress = '';
    paintRevTop();
    render();
  }
  const revGradeBtn = _sel('sxGrade');
  if (revGradeBtn) revGradeBtn.onclick = revRunGrade;
  await revLoad();

  function render() {
    if (isCfg) return;   // 配置页没有列表 DOM：回调里调 render 时直接跳过
    const lst = notes.filter(n => (st.scenario === 'all' || n.scenario === st.scenario));
    const byType = SCENARIO_DRAIN.map(s => ({ s, n: notes.filter(x => drainScenarioId(x.scenario) === s.scenario).length })).filter(x => x.n > 0);
    const deadN = notes.filter(x => x.dead).length;
    _sel('sxCount').textContent = `共 ${notes.length} 篇` + (byType.length > 1 ? '（' + byType.map(x => x.s.icon + x.n).join(' ') + '）' : '') + ` · 当前 ${lst.length} 篇` + (deadN ? ` · ⛔作废 ${deadN} 篇` : '');
    const rowOf = (n) => {
      const s = drainScenarioDef(n.scenario);
      const dead = !!n.dead;
      // 作废（搜过一轮标题+作者都定位不到）：直接盖住判定标签，别再显示「去评论」误导
      const j = dead ? { verdict: '⛔ 已作废', tone: 'purple' } : drainJudge(n.scenario, n.signals || {}, { growthDelta: st.growthDelta });
      const sg = n.signals || {};
      const mc = sg.myComment;
      // 列窄：过万的数字压成「1.2万」，别把表格撑开
      const num = (v) => (v == null ? '—' : (Number(v) >= 10000 ? (Number(v) / 10000).toFixed(1).replace(/\.0$/, '') + '万' : v));
      const nv = (v) => (v == null ? '<span class="sx-nums-empty">—</span>' : num(v));
      const cmts = (revCtx && window.AcquireReview) ? window.AcquireReview.rowsOfNote(revCtx, n) : [];
      const mcTxt = (mc && mc.found)
        ? `<span style="color:#0a8f4c;font-weight:600;">第${mc.rank || '?'}位</span>${mc.likes != null ? `<span style="color:#8a8f99;"> 👍${num(mc.likes)}</span>` : ''}`
        : (mc && mc.checked ? '<span style="color:#dc2626;">没找到</span>' : '<span style="color:#c7ccd4;">—</span>');
      const sub = [n.author ? escHtml(n.author) : '', '入列 ' + fmtTime(n.addedAt), n.lastJudgedAt ? '判于 ' + fmtTime(n.lastJudgedAt) : ''].filter(Boolean).join(' · ');
      const rec = _snapForNote(n);
      return `
        <tr${dead ? ' style="opacity:.55;"' : ''}>
          <td class="sx-t-type">
            <select class="sx-chip-sel" data-scenario="${n.id}" style="max-width:62px;" title="笔记类型（决定评论/维护方式）：${escAttr(s.label)}">
              ${SCENARIO_DRAIN.map(d => `<option value="${d.scenario}" ${d.scenario === drainScenarioId(n.scenario) ? 'selected' : ''}>${d.icon} ${DRAIN_TYPE_SHORT[d.scenario] || d.label}</option>`).join('')}
            </select>
            <div class="sx-sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="跑法：${escAttr(drainPbTip(n.scenario, st.cfg))}">${escHtml(drainPlaybookLabel(n.scenario))}</div>
          </td>
          <td class="sx-col-note">
            <div class="sx-note-t" title="${escAttr(n.title || '(无标题)')}">${escHtml(n.title || '(无标题)')}</div>
            ${_recLine(rec)}
            <div class="sx-sub sx-sub-row">
              <span class="sx-sub-tx" title="${escAttr(sub)}">${sub}</span>
              <button class="sx-row-del" data-act="drop" data-id="${n.id}" title="从复盘列表移除（只把这条从监控列表拿掉，不删笔记）">✕</button>
            </div>
          </td>
          <td class="sx-t-nums" title="打开这篇时从评论区数到的：点赞 / 一级评论 / 二级评论">
            ${nv(sg.likes)} / ${nv(sg.comments)} / ${nv(sg.subComments)}
          </td>
          <td class="sx-t-judge">
            <span class="sx-judge ${j.tone}" title="${escAttr(dead ? ('已作废：' + (n.deadReason || '标题+作者都搜不到') + ' · ' + fmtTime(n.deadAt)) : j.verdict)}">${j.verdict}</span>
            <div class="sx-sub" title="我的评论（活水：还在不在前排）">我的评论 ${mcTxt}</div>
          </td>
          <td class="sx-t-cmt">${(revCtx && window.AcquireReview) ? window.AcquireReview.cellHtml(revCtx, cmts) : '<div class="sx-cmt-none">—</div>'}</td>
        </tr>`;
    };
    // 池外：最近 3 天评过、但已经不在笔记池里的笔记，摆在表格最后，别让这些评论漏看
    const outHtml = (revCtx && window.AcquireReview && st.scenario === 'all')
      ? window.AcquireReview.outsideGroups(revCtx, notes).map(g => {
          const t = g.title || '（未记标题）';
          return `
          <tr style="opacity:.78;background:#fcfcfd;">
            <td class="sx-t-type"><span class="sx-judge purple">池外</span><div class="sx-sub">已移出池子</div></td>
            <td class="sx-col-note">
              <div class="sx-note-t" title="${escAttr(t)}">${escHtml(t)}</div>
              <div class="sx-sub">不在复盘列表 · 最近 3 天 ${g.rows.length} 条</div>
            </td>
            <td class="sx-t-nums"><span class="sx-nums-empty">—</span></td>
            <td class="sx-t-judge"><span class="sx-judge gray">—</span><div class="sx-sub">池外不判活水</div></td>
            <td class="sx-t-cmt">${window.AcquireReview.cellHtml(revCtx, g.rows)}</td>
          </tr>`;
        }).join('')
      : '';
    // 池子空但池外还有评论：照样把表画出来，别把最近 3 天发出去的评论藏了
    if (!lst.length && !outHtml) { _sel('sxList').innerHTML = '<div class="sx-empty">列表为空<br/>队列按排班扫到笔记后会自动进来。</div>'; paintRevBar(); return; }
    _sel('sxList').innerHTML = `
      <table class="pl-table sx-table">
        <thead>
          <tr>
            <th class="sx-t-type">类型</th>
            <th class="sx-col-note">笔记 · 跑了什么</th>
            <th class="sx-t-nums" title="打开这篇时从评论区数到的：点赞 / 一级评论 / 二级评论">赞/评/回</th>
            <th class="sx-t-judge">判定 · 我的评论</th>
            <th class="sx-t-cmt">我们回的（最近 3 天，摊开）</th>
          </tr>
        </thead>
        <tbody>${lst.map(rowOf).join('')}${outHtml}</tbody>
      </table>`;
    _sel('sxList').querySelectorAll('select[data-scenario]').forEach(sel => {
      sel.onchange = async () => {
        const note = notes.find(n => n.id === sel.getAttribute('data-scenario'));
        if (!note) return;
        note.scenario = drainScenarioId(sel.value);
        await drainSave(notes);
        drainToast('已改为 ' + drainScenarioDef(note.scenario).label);
        render();
      };
    });
    _sel('sxList').querySelectorAll('[data-act]').forEach(btn => {
      btn.onclick = (ev) => {
        const id = btn.getAttribute('data-id');
        const note = notes.find(n => n.id === id);
        if (!note) return;
        const act = btn.getAttribute('data-act');
        if (act === 'drop') { ev.preventDefault(); notes = notes.filter(n => n.id !== id); drainSave(notes); render(); }
      };
    });
    if (revCtx && window.AcquireReview) window.AcquireReview.bindCell(_sel('sxList'), revCtx, revChanged);
    paintRevBar();
  };

  _sel('sxFilter').onchange = (e) => { st.scenario = e.target.value; render(); };
  _drainNotesChanged = (changes, area) => {
    if (area !== 'local' || !changes[DRAIN_KEY] || !container.isConnected) return;
    notes = Array.isArray(changes[DRAIN_KEY].newValue) ? changes[DRAIN_KEY].newValue : [];
    render();
  };
  chrome.storage.onChanged.addListener(_drainNotesChanged);
  notes = await drainLoad();
  paintRevTop();
  render();
  /* 真号第一次进来：有没判的就自动判一遍（同一条判过的不再花钱）。演示号不自动跑。 */
  if (!revAutoTried && revCtx && !revCtx.readOnly && window.AcquireReview && window.AcquireReview.pending(revCtx)) {
    revAutoTried = true;
    revRunGrade();
  }
  try {
    const result = await chrome.runtime.sendMessage({ action: 'drainImportFound' });
    if (!result || !result.ok) throw new Error((result && result.error) || '后台未返回结果');
  } catch (e) { drainToast('同步获客笔记失败：' + (e.message || e), 'error'); }
}

/* ============ 工具 ============ */
function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escAttr(s) { return escHtml(s); }
function fmtTime(ts) { if (!ts) return '—'; const d = new Date(ts); if (isNaN(d)) return '—'; return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function drainToast(msg, type) {
  const el = document.createElement('div');
  const bg = { ok: '#059669', warn: '#d97706', error: '#dc2626' };
  el.textContent = msg;
  Object.assign(el.style, { position: 'fixed', bottom: '16px', left: '50%', transform: 'translateX(-50%)', background: bg[type] || '#059669', color: '#fff', padding: '8px 14px', borderRadius: '8px', fontSize: '12px', zIndex: 99999, boxShadow: '0 4px 12px rgba(0,0,0,.15)' });
  document.body.appendChild(el);
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 2600);
}

/* 抓当前页笔记（active tab：读 og 标题 + 正文 + 计数） */
async function drainGrabActiveNote() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || !tab.id || !String(tab.url || '').includes('xiaohongshu.com')) return null;
  const m = await drainReadTabMetrics(tab.id);
  const url = (tab.url || '').split('#')[0];
  if (!/\/explore\//.test(url)) return null;
  return Object.assign({ url, title: m.title || '', author: m.author || '' }, m);
}

/* 抓当前页博主主页（active tab 是 /user/profile/ 时读链接 + 昵称；og:title 就是昵称） */
async function drainGrabActiveProfile() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || !tab.id || !String(tab.url || '').includes('xiaohongshu.com')) return null;
  // 只去掉 #hash：?xsec_token=… 要留着，主页靠它才打得开（身份另用 _drainProfileId 认）
  const url = String(tab.url || '').split('#')[0];
  if (!/\/user\/profile\//.test(url)) return null;
  let name = '';
  try { const m = await drainReadTabMetrics(tab.id); name = String(m.title || '').trim(); } catch (_) {}
  return { url, name };
}

/* 往目标 tab 注入读 title/计数（笔记页才能拿到赞/评/藏） */
async function drainReadTabMetrics(tabId) {
  const r = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const q = (s) => { const e = document.querySelector(s); return e ? ((e.getAttribute('content')) || (e.textContent || '')).trim() : ''; };
      const ogTitle = q('meta[property="og:title"]').replace(/ - 小红书.*$/, '').trim();
      const ogDesc = q('meta[property="og:description"]');
      const txt = (document.body && document.body.innerText) || '';
      const num = (re) => { const m = txt.match(re); if (!m || !m[1]) return null; let v = m[1].replace(/,,/g, '') ; const w = v.includes('万') ? 10000 : 1; const n = parseFloat(v) * w; return isNaN(n) ? 0 : Math.round(n); };
      const author = (document.querySelector('meta[name="author"]') || {}).content || '';
      return {
        title: ogTitle || document.title.replace(/ - 小红书.*$/, '').trim(),
        content: ogDesc || '',
        author: (author || '').trim(),
        likes: num(/([\d.,万]+)\s*(赞|次赞|喜欢)/),
        comments: num(/([\d.,万]+)\s*(评论)/),
        collects: num(/([\d.,万]+)\s*(收藏)/),
      };
    },
  });
  const res = r && r[0] && r[0].result;
  return res || {};
}

/* 查活水：读当前页评论区里「我的评论」的位置/点赞（内容脚本 extractMyComment）
   返回 { found, checked, rank, likes, excerpt, at }；没配昵称/内容脚本没响应 → null */
async function drainReadMyCommentFromTab(tabId, names) {
  const list = (names || []).map(n => String(n || '').trim()).filter(Boolean);
  if (!tabId || !list.length) return null;
  try {
    const r = await chrome.tabs.sendMessage(tabId, { action: 'extractMyComment', names: list });
    if (r && r.ok) {
      return { found: !!r.found, checked: true, rank: r.rank || 0, likes: r.likes != null ? r.likes : null, excerpt: r.excerpt || '', total: r.total || 0, at: Date.now() };
    }
  } catch (_) {}
  return null;
}
/* 我在设置里维护的小红书昵称（内容脚本 extractMyComment 会再归一化一次） */
async function drainMyAccountNames() {
  try {
    const cfg = await Storage.getConfig();
    return (cfg.myAccountNames || []).map(n => String(n || '').trim()).filter(Boolean);
  } catch (_) { return []; }
}
/* 活水记录合并：一旦查到过我的评论就钉住 seen=true，
 * 供判定区分「曾经在前排、现在掉榜」和「还没去占位」两种情况 */
function drainMergeMyComment(prev, mc) {
  if (!mc) return prev || null;
  if (mc.found || (prev && (prev.seen || prev.found))) mc.seen = true;
  return mc;
}

/* =====================================================================
 * 获客扫描(ScanEngine) —— background 侧
 * 复用 auto-water 的搜索tab + extractSearchResults：
 *  来源 → 开搜索/主页tab → 读列表卡片(noteId/标题/赞/排名) → 入池 drain_notes
 *  扫描完做「存量对账补齐」：本次没被打开的存量笔记按 noteId/标题补开刷新
 * ===================================================================== */
async function _scanExtractList(tab, url, sortKey) {
  if (!tab) return { notes: [], ok: false, err: '未找到小红书标签页' };
  try {
    await chrome.tabs.update(tab.id, { url });
    await AutoWater._waitForTabLoad(tab.id, 15000);
    await AutoWater._sleep(1300);
    // 按来源的筛选条件先应用排序（最新/点赞最多/评论最多/收藏最多），失败只降级不阻塞
    if (sortKey && DRAIN_SORT_LABEL[sortKey]) {
      try {
        await AutoWater._send(tab.id, { action: 'applySearchFilter', sortKey }, 8000);
        await AutoWater._sleep(900);
      } catch (fe) {
        console.warn('[截流扫描] 应用排序失败(忽略): ' + sortKey, fe && fe.message || fe);
      }
    }
    let res, triedInject = false;
    try {
      res = await AutoWater._send(tab.id, { action: 'extractSearchResults' }, 15000);
    } catch (e) {
      triedInject = true;
      try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }); } catch (_) {}
      await AutoWater._sleep(800);
      try { res = await AutoWater._send(tab.id, { action: 'extractSearchResults' }, 15000); } catch (e2) { res = null; }
    }
    const notes = (res && res.notes) || [];
    if (!notes.length) {
      return { notes: [], ok: true, err: (triedInject ? '已重注入内容脚本；' : '') + '未提取到笔记（多半是未登录/风控/页面没加载出来）' };
    }
    return { notes, ok: true, err: '' };
  } catch (e) {
    return { notes: [], ok: false, err: e && e.message || String(e) };
  }
}
async function _mergeAutoWaterFound() {
  const st = await Storage.getAutoWaterState();
  const found = (st && st.searchState && st.searchState.foundNotes) || [];
  const result = await handleDrainTrackNotes({ notes: found, onlyNew: true });
  return result.added;
}

/* 搜不到就作废：标题+作者都定位不上（多半已删/改名/被平台清理），列表里标「⛔ 已作废」，之后不再反复补开 */
function _drainMarkDead(note, why) {
  if (!note) return;
  note.dead = true;
  note.deadAt = Date.now();
  note.deadReason = why || '标题+作者都搜不到';
}
function _drainRevive(note) {
  if (!note || !note.dead) return;
  note.dead = false;
  note.deadAt = 0;
  note.deadReason = '';
}

/* 打开一篇笔记（统一走「标题末尾减3字搜 → 按作者定位 → 点开」通路，不再冷开 /explore/ 防止异常页）。
   返回 { ok, metrics, miss }；搜索通路可能把缺的 noteId 补齐/纠正到 note 上；miss=true = 确实搜不到（该作废）。 */
async function _drainOpenNoteViaSearch(tab, note) {
  try {
    const r = await AutoWater._openBySearch(tab, {
      noteId: note.noteId || '', title: note.title || '', author: note.author || '',
    });
    if (!r || !r.ok) return { ok: false, error: (r && r.error) || '打开失败', miss: !!(r && r.miss) };
    if (r.noteId && r.noteId !== note.noteId) { note.noteId = r.noteId; note.url = note.url || ('https://www.xiaohongshu.com/explore/' + r.noteId); }
    // 等详情页渲染出指标（点赞数），最多 8s
    for (let i = 0; i < 8; i++) {
      await AutoWater._sleep(1000);
      const m = await drainReadTabMetrics(tab.id);
      if (m && m.likes != null) return { ok: true, metrics: m };
    }
    return { ok: false, error: '打开后没读到笔记指标' };
  } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
}

async function _scanBackfill(note, tab) {
  try {
    if (!note.noteId && !note.title) return false;
    // 🛡 账号安全：补开一篇＝总账「打开浏览」一笔；额度用完/时段外 → 返回 'guard'（本轮补开到这，不伤 missRounds）
    if (typeof AccountGuard !== 'undefined') {
      const g = await AccountGuard.decide('open', 1);
      if (!g.ok) return 'guard';
    }
    const open = await _drainOpenNoteViaSearch(tab, note);
    if (!open.ok) { if (open.miss) _drainMarkDead(note, open.error); return false; }
    if (typeof AccountGuard !== 'undefined') { try { await AccountGuard.spend('open', 1); } catch (_) {} }
    const m = open.metrics;
    const prev = (note.signals && note.signals.likes) || 0;
    note.signals = Object.assign({}, note.signals, m, { delta: (m.likes != null && prev != null) ? (m.likes - prev) : 0 });
    if (m.title) note.title = m.title;
    if (m.author && !note.author) note.author = m.author;
    _drainRevive(note);
    note.missRounds = 0;
    note.lastSeenAt = Date.now();
    note.lastJudgedAt = Date.now();
    return true;
  } catch (e) { return false; }
}

/* 在获客里打开/分析一篇笔记 → 登记/更新进截流监控池
   （获客是主要使用路径：打开一篇就该出现在截流列表，增或更新） */
let _drainWriteQueue = Promise.resolve();
function drainUpdateNotes(update) {
  const pending = _drainWriteQueue.then(async () => {
    const notes = await drainLoad();
    const result = update(notes);
    await drainSave(notes);
    return result;
  });
  _drainWriteQueue = pending.catch(() => {});
  return pending;
}
function drainMergeNotes(updates) {
  return drainUpdateNotes(notes => {
    for (const note of updates) {
      const index = notes.findIndex(n => n.id === note.id || (note.noteId && n.noteId === note.noteId));
      if (index < 0) notes.push(note);
      else if ((notes[index].lastSeenAt || 0) <= (note.lastSeenAt || 0)) notes[index] = note;
    }
  });
}
function drainNoteId(url) {
  return (String(url || '').match(/\/(?:explore|note|discovery\/item|search_result)\/([a-f0-9]+)/i) || [])[1] || '';
}
/* 只有搜索筛选（sort）的调用方按这个推类型：
 * 明确选「最新」→ 最新笔记；点赞/评论/收藏最多 或 不筛（综合）→ 搜索TOP */
function drainScenarioOfSort(sortKey) { return sortKey === 'latest' ? 'latest' : 'top'; }
async function handleDrainTrackNote(data) {
  const result = await handleDrainTrackNotes({ notes: [data] });
  return result.tracked ? result : { ok: false, error: '缺笔记信息' };
}
async function handleDrainTrackNotes(data) {
  const found = Array.isArray(data.notes) ? data.notes : [];
  if (!found.length) return { ok: true, added: 0, tracked: 0 };
  return drainUpdateNotes(notes => {
    let added = 0, tracked = 0;
    for (const item of found) {
      if (!item) continue;
      const url = String(item.url || '').split('#')[0];
      const noteId = String(item.noteId || drainNoteId(url));
      if (!noteId) continue;
      let note = notes.find(n => (n.noteId || drainNoteId(n.url)) === noteId);
      if (note && data.onlyNew) continue;
      const now = Date.now();
      if (!note) {
        // 类型：显式给的优先；只带搜索筛选（sort）的按筛选推；都没有（手开笔记等）落最新笔记
        const sc = item.scenario ? drainScenarioId(item.scenario)
          : (item.sort ? drainScenarioOfSort(item.sort) : 'latest');
        note = { id: _uid(), scenario: sc, noteId, url: url || ('https://www.xiaohongshu.com/explore/' + noteId), title: '（待抓取标题）', author: '', signals: { rank: 0, delta: 0 }, state: 'monitoring', addedAt: now };
        notes.unshift(note);
        added++;
      }
      note.noteId = noteId;
      if (url && drainNoteId(url) === noteId) note.url = url;
      if (item.title) note.title = item.title;
      if (item.author) note.author = item.author;
      _drainRevive(note);   // 搜索又搜到了 = 这篇还在，撤销作废
      note.signals = note.signals || {};
      if (item.likes != null && item.likes !== '') {
        const text = String(item.likes).replace(/,/g, '');
        const likes = parseFloat(text) * (/万|w/i.test(text) ? 10000 : /k/i.test(text) ? 1000 : 1);
        if (Number.isFinite(likes)) note.signals.likes = Math.round(likes);
      }
      if (item.commentsCount != null) note.signals.comments = item.commentsCount;
      if (item.subCommentsCount != null) note.signals.subComments = item.subCommentsCount;
      note.signals.title = note.title;
      note.lastSeenAt = now;
      note.lastJudgedAt = now;
      note.missRounds = 0;
      tracked++;
    }
    return { ok: true, total: notes.length, added, tracked };
  });
}

async function handleDrainScan(data) {
  // 🛡 账号安全：静默期 / 起床前 / 发布占线 → 这轮扫描不跑（自动与手动同一口径）
  try {
    if (typeof AccountGuard !== 'undefined') {
      const wall = await AccountGuard.blockAllReason();
      if (wall) return { ok: false, error: '🛡 ' + wall.text };
    }
  } catch (_) {}
  let cfg = await drainGetScanCfg();
  // 首次：关键词池从设置里的关键词种子生成（再由关键词 × 类型派生来源）
  if (!(cfg.keywords || []).length && !(cfg.accounts || []).length) {
    const config = await Storage.getConfig();
    const kws = (config.keywords || []).filter(Boolean).slice(0, 10);
    cfg.keywords = (kws.length ? kws : ['金融理财']).map(k => _drainPoolEntry(k));
  }
  const srcs = drainBuildSources(cfg);

  // ★ 先并入获客/灌水已扫到的笔记（auto-water foundNotes），让"获客扫完→截流可见"成立
  const importedWater = await _mergeAutoWaterFound();

  const notes = await drainLoad();
  const seen = new Set();

  // ★ 扫描只用【专用小红书标签页】并按来源逐词导航搜索 —— 绝不抓用户当前正看的任意页面。
  let tab = await AutoWater._getXhsTab();
  if (!tab) throw new Error('未找到小红书标签页，请先打开一个小红书页面');

  let foundNew = 0, refreshed = 0;
  let allEmpty = 0, anyFail = false;
  let blocked = 0;
  /* 📈 复盘采纳的屏蔽词：搜到标题/作者命中就整篇跳过，不再进池、也不再补开 */
  const blockWords = (Array.isArray(cfg.blockWords) ? cfg.blockWords : [])
    .map(w => String(w || '').trim()).filter(Boolean);
  const blockHit = (n) => {
    if (!blockWords.length) return '';
    const hay = String((n && n.title) || '') + ' ' + String((n && n.author) || '');
    return blockWords.find(w => hay.indexOf(w) >= 0) || '';
  };
  const detail = [];
  for (let i = 0; i < srcs.length; i++) {
    const src = srcs[i];
    // 🛡 账号安全：每导航一个来源页＝总账「打开浏览」一笔；额度用完/时段外 → 余下来源留到下轮再扫
    try {
      if (typeof AccountGuard !== 'undefined') {
        const g = await AccountGuard.spend('open', 1);
        if (!g.ok) {
          detail.push({ term: src.term, kind: src.kind || 'search', scenario: src.scenario || '', sort: src.sort || '', got: 0, ok: false, err: '🛡 ' + g.text });
          break;
        }
      }
    } catch (_) {}
    const url = src.kind === 'profile'
      ? (String(src.term).startsWith('http') ? src.term : 'https://www.xiaohongshu.com' + String(src.term))
      : DRAIN_SEARCH_URL(src.term);
    const r = await _scanExtractList(tab, url, src.sort);
    const list = r.notes || [];
    if (!r.ok) anyFail = true;
    if (!list.length) allEmpty++;
    const scDef = drainScenarioDef(src.scenario);
    detail.push({ term: src.term, kind: src.kind || 'search', scenario: scDef.scenario, sort: src.sort || '', got: list.length, ok: r.ok, err: r.err || '' });
    for (const n of list) {
      const noteId = n.noteId;
      if (!noteId) continue;
      seen.add(noteId);
      if (blockHit(n)) { blocked++; continue; }
      const key = (x) => x.noteId === noteId || (n.noteId && x.url && x.url.includes(noteId));
      const exist = notes.find(key);
      if (exist) {
        exist.signals = Object.assign({}, exist.signals, { likes: n.likes || exist.signals.likes, rank: exist.signals.rank || 0 });
        if (n.title) exist.title = n.title;
        if (n.author) exist.author = n.author;
        _drainRevive(exist);   // 本轮搜索又搜到了 = 撤销作废
        exist.lastSeenAt = Date.now();
        if (exist.missRounds) { exist.missRounds = 0; }
        refreshed++;
      } else {
        notes.push({
          id: _uid(), scenario: drainScenarioId(src.scenario || 'latest'), noteId, url: n.url || 'https://www.xiaohongshu.com/explore/' + noteId,
          title: n.title || '（待抓取标题）', author: n.author || '',
          signals: { likes: n.likes || 0, rank: 0, delta: 0 }, state: 'monitoring',
          addedAt: Date.now(), lastSeenAt: Date.now(), lastJudgedAt: Date.now(), missRounds: 0,
        });
        foundNew++;
      }
    }
    await drainMergeNotes(notes);
    // 记「这个词 × 这个类型」刚跑过：隔几小时跑的模式据此判断下一次到点
    if (src.auto && src.k && src.scenario) {
      cfg.kwRuns[src.k] = Object.assign({}, cfg.kwRuns[src.k] || {}, { [src.scenario]: Date.now() });
    }
  }

  // 增量对账补齐：本次没被打开的存量笔记补开
  let backfilled = 0, missDiscarded = 0;
  const MISS_CAP = 3;
  for (const note of notes) {
    if (note.dead) continue;   // 已作废（搜不到）：不再补开
    if (!note.noteId) continue;
    if (seen.has(note.noteId)) { if (note.missRounds) note.missRounds = 0; continue; }
    const okR = await _scanBackfill(note, tab);
    if (okR === 'guard') break;   // 🛡 总账拦下（额度用完/时段外）：停止本轮补开
    if (okR) { backfilled++; }
    else {
      note.missRounds = (note.missRounds || 0) + 1;
      if (note.missRounds >= MISS_CAP) missDiscarded++;
    }
  }
  await drainMergeNotes(notes);

  cfg.lastScanAt = Date.now();
  let note = '';
  if (foundNew === 0 && !notes.length) {
    note = allEmpty >= srcs.length
      ? '所有来源都未提取到笔记：多半是浏览器未登录小红书，或那个标签页没在有结果的搜索页。请登录后重试。'
      : '没有新笔记（本轮来源已扫描）。详情见下方。';
  }
  cfg.lastScanSummary = { foundNew, refreshed, backfilled, missDiscarded, blocked, total: notes.length, at: Date.now(), detail, note, imported: importedWater };
  if ((data && data.autoScanMin) != null) cfg.autoScanMin = data.autoScanMin;
  await drainSaveScanCfg(cfg);

  return { ok: true, summary: cfg.lastScanSummary };
}

async function handleDrainGetScanCfg() {
  return { ok: true, cfg: await drainGetScanCfg() };
}
async function handleDrainSaveScanCfg(data) {
  const cfg = data && data.cfg;
  if (!cfg || typeof cfg !== 'object') throw new Error('配置格式不对');
  const next = _drainNormalizeScanCfg(cfg);
  next.keywords = (next.keywords || []).filter(e => e && String(e.k || '').trim());
  await drainSaveScanCfg(next);
  return { ok: true, cfg: next };
}

/* =====================================================================
 * 补开对账引擎（每轮获客后：对本轮未打开的池内笔记，按节奏决定开/不开并更新）
 *   节奏＝内置默认（旧「补开决策配置表」已下线，2026-09-25），外加一条：词池表头设「不跑」的类整类不补
 * ===================================================================== */
function _drainReplenishDefaults() {
  return {
    // 🛡 采集收口（2026-10-11）：自动补开默认关——不再为采集反复横跳开笔记；手动「🔁 补开」按钮保留
    enabled: false,
    // 最新/本地：TTL 内反复开（过了就淘汰）；TOP/求助：活水，按间隔定期回看我的评论
    strategy: {
      latest: { mode: 'ttl', ttlHours: 24 },
      local: { mode: 'ttl', ttlHours: 24 },
      top: { mode: 'interval', intervalHours: 8 },
      pain: { mode: 'interval', intervalHours: 6 },
      // 竞对：只埋伏不评论，但要定期回看——对方评论区一直在进新的求助者
      rival: { mode: 'interval', intervalHours: 12 },
      highv: { mode: 'always' },
    },
    growthDelta: 50,   // 最新笔记：一轮涨够多少赞 → 标记「去评论」
    lastReplenishAt: 0,
    lastReplenishSummary: null,
  };
}
async function drainGetReplenishCfg() {
  const cfg = await drainGetScanCfg();
  const stored = Object.assign({}, cfg.replenish || {});
  delete stored.strategy;   // 节奏已归内置默认 + 词池表头，老的自定义值一并作废
  /* 🛡 采集收口（2026-10-11）：升级前存着 enabled:true 的配置一次性强制关（不再每轮反复开笔记）；
     之后用户在 ⚙︎ 里重新打开并保存（reEnabled 标记）才照开 */
  if (stored.enabled === true && !stored.reEnabled) {
    stored.enabled = false;
    try { await drainSaveReplenishCfg(stored); } catch (_) {}
  }
  return Object.assign(_drainReplenishDefaults(), stored);
}
async function drainSaveReplenishCfg(repl) {
  const cfg = await drainGetScanCfg();
  const next = Object.assign(_drainReplenishDefaults(), repl || {});
  next.strategy = Object.assign({}, _drainReplenishDefaults().strategy);
  next.reEnabled = next.enabled === true;   // 🛡 用户在新版里主动打开过 → 不再被采集收口强制关
  cfg.replenish = next;
  await drainSaveScanCfg(cfg);
  return cfg.replenish;
}

/* 决策：按该笔记类型的策略返回 'open' | 'skip' | 'expire' */
function drainDecideOpen(note, now, stratCfg) {
  const last = Number(note.replenishedAt || note.lastSeenAt || 0);
  const mode = (stratCfg && stratCfg.mode) || 'interval';
  const ivMs = ((stratCfg && stratCfg.intervalHours) || 12) * 3600 * 1000;
  const ttlMs = ((stratCfg && stratCfg.ttlHours) || 24) * 3600 * 1000;
  if (mode === 'always') return 'open';
  if (mode === 'ttl') {
    // 只在 TTL 内打开刷新；超期且已被打开过 → 淘汰（不再开）
    if (last > 0 && (now - last) > ttlMs) return 'expire';
    return 'open';
  }
  // interval
  if (last === 0) return 'open';
  return (now - last) >= ivMs ? 'open' : 'skip';
}

/* 打开一篇待补笔记刷新指标；TOP/求助 顺带查活水（我的评论还在不在前排） */
async function _drainReopenNote(note, tab, myNames) {
  try {
    if (!note.noteId && !note.title) return { ok: false };
    // 🛡 账号安全：补开一篇＝总账「打开浏览」一笔；额度用完/时段外 → { guard:true }（本轮补开到此为止）
    if (typeof AccountGuard !== 'undefined') {
      const g = await AccountGuard.decide('open', 1);
      if (!g.ok) return { ok: false, guard: true, error: g.text };
    }
    const open = await _drainOpenNoteViaSearch(tab, note);
    if (!open.ok) { if (open.miss) _drainMarkDead(note, open.error); return { ok: false, error: open.error, miss: !!open.miss }; }
    if (typeof AccountGuard !== 'undefined') { try { await AccountGuard.spend('open', 1); } catch (_) {} }
    const m = open.metrics;
    if (m.author && !note.author) note.author = m.author;
    _drainRevive(note);
    const prev = (note.signals && note.signals.likes) || 0;
    note.signals = Object.assign({}, note.signals, m, { delta: (m.likes != null && prev != null) ? (m.likes - prev) : 0 });
    if (m.title) note.title = m.title;
    // 活水：读我在评论区的评论（位置/点赞）——掉榜后列表上直接能看到「掉榜 · 去补评论」
    if (myNames && myNames.length) {
      const mc = await drainReadMyCommentFromTab(tab.id, myNames);
      if (mc) note.signals.myComment = drainMergeMyComment(note.signals.myComment, mc);
    }
    note.replenishedAt = Date.now();
    note.lastSeenAt = Date.now();
    note.lastJudgedAt = Date.now();
    note.missRounds = 0;
    return { ok: true };
  } catch (e) { return { ok: false }; }
}

let _drainReplenishing = false;
async function handleDrainReplenish(data) {
  if (_drainReplenishing) return { ok: true, busy: true };
  // 🛡 账号安全：静默期 / 起床前 / 发布占线 → 这轮不补开（手动按钮也一样，会提示原因）
  try {
    if (typeof AccountGuard !== 'undefined') {
      const wall = await AccountGuard.blockAllReason();
      if (wall) return { ok: false, error: '🛡 ' + wall.text };
    }
  } catch (_) {}
  _drainReplenishing = true;
  try {
    let repl = await drainGetReplenishCfg();
    // force：手动点「🔁 补开未打开」来的，就算自动补开关着也照跑（用户是明着点的）
    if (repl.enabled === false && !(data && data.force)) return { ok: true, disabled: true };
    const strat = repl.strategy || _drainReplenishDefaults().strategy;
    const typeRun = (await drainGetScanCfg()).typeRun || {};
    const notes = await drainLoad();
    const myNames = await drainMyAccountNames();
    const now = Date.now();
    const tab = await AutoWater._getXhsTab();
    let opened = 0, skipped = 0, expired = 0, failed = 0, candidates = 0;
    const seen = new Set(); // 本轮已补开的 noteId 去重

    for (const note of notes) {
      if (note.state === 'expired' || note.is_active === false) continue;
      if (note.dead) { skipped++; continue; }   // 已作废（搜不到）：不再反复补开
      const sc = drainScenarioId(note.scenario || 'latest');
      // 词池表头把这一类设成「不跑」＝这一类整类不补（highv 之类没有列的不受这条约束）
      if (typeRun[sc] && typeRun[sc].mode === 'off') { skipped++; continue; }
      const scStrat = strat[sc] || { mode: 'interval', intervalHours: 12 };
      const decision = drainDecideOpen(note, now, scStrat);
      if (decision === 'skip') { skipped++; continue; }
      if (decision === 'expire') { note.state = 'expired'; note.exit_reason = 'no_potential'; note.exitedAt = now; expired++; continue; }
      // open
      candidates++;
      // ★ 只有标题没 ID 的旧笔记也照样能补开（搜索通路会顺便把 noteId 补齐）
      const uniqKey = note.noteId || ('t:' + String(note.title || '').replace(/\s+/g, ''));
      if (!uniqKey || uniqKey === 't:' || seen.has(uniqKey)) { skipped++; continue; }
      seen.add(uniqKey);
      const r = await _drainReopenNote(note, tab, myNames);
      if (r && r.ok) opened++;
      else if (r && r.guard) break;   // 🛡 总账拦下（额度用完/时段外）：停止本轮补开（没碰过的笔记不动 missRounds）
      else { note.missRounds = (note.missRounds || 0) + 1; failed++; }
    }
    await drainMergeNotes(notes);

    repl.lastReplenishAt = now;
    repl.lastReplenishSummary = { opened, skipped, expired, failed, candidates, at: now };
    await drainSaveReplenishCfg(repl);

    return { ok: true, summary: repl.lastReplenishSummary };
  } finally {
    _drainReplenishing = false;
  }
}
async function handleDrainGetReplenishCfg() { return { ok: true, repl: await drainGetReplenishCfg() }; }
async function handleDrainSaveReplenishCfg(data) { const repl = await drainSaveReplenishCfg(data && data.repl); return { ok: true, repl }; }

/* =====================================================================
 * background 侧：真正调 AI 生成某场景评论（onMessage 'drainComment'）
 * ===================================================================== */
/* AI 找词按玩法出（2026-11-02）：每个玩法一套口径，别拿一套词喂所有玩法。
   2026-11-04 三层：老板在排班卡里自己写的那句 > 这个号的行业口径包（铺底子时抄进配置）> 下面这套中性内置。 */
function drainAiKeywordRule(scenario, city, customRule, cfg) {
  /* 老板在「玩法排班 → 出词策略」里自己写过一句就用人家那句；没写才看包里有没有本行那句 */
  const own = String(customRule || '').trim();
  if (own) return own;
  const fromPack = drainPbCopy(cfg, scenario, 'wordRule');
  if (fromPack) return fromPack;
  const c = String(city || '').trim() || '（城市没填：先用「本地城市」占位）';
  switch (drainScenarioId(scenario)) {
    case 'latest':
      return '玩法＝本地泛搜索：出「' + c + ' + 本地日常场景」的宽词（如「' + c + ' 周末去哪」「' + c + ' 附近推荐」），每个词都要带「' + c + '」，别带本行品类词。';
    case 'top':
      return '玩法＝TOP搜索：出全国流量的行业词、痛点词、人群词，不用带城市（如「这件事怎么办」），要能搜到高赞笔记。';
    case 'local':
      return '玩法＝同城本业：出「' + c + ' + 本行核心品类」的挑选词（如「' + c + ' 本行品类」「' + c + ' 品类哪家好」），每个词都要带「' + c + '」；也可以出本地同品类的通用叫法，用来找到同行笔记下的人；绝不要编具体品牌名。';
    case 'pain':
      return '玩法＝咨询帖：出求助、避雷口吻的词（求推荐 / 听劝 / 哪家好 / 避雷 / 踩坑），可以不带城市；别出品牌名。';
    case 'cross':
      return '玩法＝同城异业：只出「' + c + ' + 别的行业品类」的词（本地常见的几个异业品类各配一条），每个词都要带「' + c + '」；绝不出本行品类词。';
    case 'rival':
      return '玩法＝同行/竞对：只出「' + c + ' + 同品类门店的通用叫法」5~8 个，纯名字、不带广告词；绝不要编具体品牌名——真正的同行品牌由用户自己往词池里填。';
  }
  return '';
}

/* 提店口径（2026-11-09 并成一份）：每个玩法在玩法配置里选「不提 / 只提身份 / 讲案例 / 可报店名」。
   报价、联系方式、站外链接四档都不许写；「可报店名」只给咨询帖这种放心写的玩法。
   铺底子时从行业模板抄进来的那份说法存在 cfg.pbStoreRules，有就用它。 */
function drainStoreRule(store, cfg, opt) {
  const o = opt || {};
  const priv = !!o.private;
  const guide = String(o.guide || '');
  const key = (store === 'identity' || store === 'case' || store === 'store') ? store : 'none';
  const own = String((((cfg || {}).pbStoreRules) || {})[key] || '').trim();
  const L = ['【能提自己到哪一步】'];
  if (own) L.push(own.replace(/^【提店口径】/, '').trim());
  else if (priv) {
    if (key === 'store') L.push('这个号这一趟：私信里对方问起，就可以报自己开的店、说清你怎么做；不报价、不留站外联系方式、不发链接。');
    else if (key === 'case') L.push('这个号这一趟：私信里可以讲自己开店的实情、带过的人、经手的案例——只用人设里写过的，没写过的不编；不报店名、不报价。');
    else if (key === 'identity') L.push('这个号这一趟：私信里可以自然带一句「我是做这行的」，让本地人知道你的身份；但不主动报店名、不报价。');
    else L.push('这个号这一趟：私信里也不提自己做什么、在哪、什么店：先只当一个懂行的本地人说话。');
  } else {
    if (key === 'store') L.push('这个号这一趟：对方明确问起你开的哪家、怎么做，就直接说清自己的店和做法；不写地址、不主动揽客，报价、联系方式、站外链接都不写。前面若写着「不报店」，指的是不主动揽客，问起可以报。');
    else if (key === 'case') L.push('这个号这一趟：可以讲自己开店的实情、带过的人、经手的案例——只用人设里写过的，没写过的一个字不编；不报店名、不说产品、不报价、不留联系方式。前面若写着「不暴露自己是谁／是做什么的」，按这一条：身份和真事可以讲，店名和产品不提。');
    else if (key === 'identity') L.push('这个号这一趟：可以在句尾带一句「我自己开过店／我是做这行的」，让人知道你是同行；不报店名、不说产品、不报价、不留联系方式。');
    else L.push('这个号这一趟：一个字都不提自己做什么、有什么工具、做过什么案例。');
  }
  /* 同行揽客、避雷吐槽的帖子：只解决问题，不露自己（2026-11-07 定的，四档都保留） */
  if (!priv) L.push('同行在揽客、避雷吐槽的帖子：一句都不提自己，先把他的问题解决。');
  /* 只有配成「私信我」的玩法才提价格往私信走；不引导的玩法说了这句就自相矛盾 */
  if (!priv && guide === 'dm') L.push('对方问价格就说「价格私信说」。');
  return L.join('\n');
}

/* 私信按玩法开口（2026-11-09）：同一份私信模板，来源玩法不同，开口角度也不同。
   铺底子时抄进来的那句话存在 cfg.pbDm，没有就用中性内置。 */
function drainPlaybookDmRule(id, cfg) {
  const own = String(((cfg || {}).pbDm || {})[drainScenarioId(id)] || '').trim();
  if (own) return own;
  const key = drainScenarioId(id);
  return {
    latest: '来源＝本地泛搜索：对方是在同城笔记下留言的本地人。开场聊本地的实情，别报价、别发链接。',
    top: '来源＝TOP搜索：对方是在全国热帖下留言的人，可能不在本地。先接住他评论里的具体问题，别一上来问城市。',
    local: '来源＝同城本业：对方已经在挑、在比较，也可能是在同行笔记评论区看到的。先给一条判断，别主动报店名，绝不提在谁的评论区看到他。',
    pain: '来源＝咨询帖：对方在求助或避雷。先正面回答他问的那件事，再给价值；不推销、不趁机贬低同行。',
    cross: '来源＝同城异业：对方是在别家行业笔记下留言的本地人。从那个具体困扰切进来，别暴露职业。',
    rival: '来源＝同行/竞对：对方是在竞品评论区看到的精准顾客。绝不提「在某某笔记看到你」，用自己踩过的坑破冰。',
    highv: '来源＝大V：对方是在头部博主评论区留言的人。用「赞同＋本行视角」承接，别让人觉得你是在捞人。',
  }[key] || '来源不明的线索：只按对方评论原话自然接话，别猜场景。';
}

function _fillSentiment(pick, data) {
  const product = (data && data.product) || '本产品';
  const cheap = (s) => String(s || '')
    .replace(/\{product\}/g, product)
    .replace(/\{guide\}/g, (data && data.guide) || DRAIN_GUIDE_DEFAULT)
    .replace(/\{title\}/g, (data && data.noteTitle) || '（这篇笔记的主题）')
    .replace(/\{content\}/g, (data && data.noteContent) || '（未提供正文，基于标题发挥）')
    .replace(/\{author\}/g, (data && data.noteAuthor) || '博主')
    .replace(/\{keyword\}/g, (data && data.keyword) || '示例关键词')
    .replace(/\{city\}/g, (data && data.city) || '深圳')
    .replace(/\{region\}/g, (data && data.region) || '')   // 区域没填就留空：「我家就住附近」比「我家就住这边附近」自然
    .replace(/\{pain\}/g, (data && data.painText) || (data && data.noteTitle) || '用户正在求助的原文')
    .replace(/\{store_rule\}/g, (data && data.storeRule) || drainStoreRule('none'))
    .replace(/\{persona_block\}/g, (data && data.personaBlock) || '（这个号还没填人设：就按一个懂行的真人说，别装专家、也别说外行话）');
  return cheap(pick);
}

/* 人设块：关键词任务的热评要「这个号本人在说话」，人设从账号设置里取
   （persona.text 是那段自我介绍；没写就退回名片上的身份/实证/立场） */
function drainPersonaBlock(config) {
  const p = (config && config.persona) || {};
  const text = String(p.text || '').trim();
  const card = p.card || {};
  const parts = [];
  if (text) parts.push(text);
  else {
    if (String(card.identity || '').trim()) parts.push(String(card.identity).trim());
    if (String(card.proof || '').trim()) parts.push('我的底子：' + String(card.proof).trim());
    if (String(card.stance || '').trim()) parts.push('我的态度：' + String(card.stance).trim());
  }
  if (String(card.taboo || '').trim()) parts.push('我不做的事：' + String(card.taboo).trim());
  return parts.join('\n').slice(0, 1500);
}

/* 引导承接：唯一真源＝产品配置（获客 → 任务配置 → 🎯 推广目标的「评论区承接」），没有才用默认站内承接 */
function drainResolveGuide(config) {
  const p = String(((config && config.product) || {}).guideText || '').trim();
  return p || DRAIN_GUIDE_DEFAULT;
}

/* 同城本业合并同行后（2026-11-02）：同行卖课招生的帖子不留言，只收评论区里的人。
   固定词先挡一道、省一次 AI；没挡住的交给提示词里的 AI 再判——两边都判「能评」才评。 */
const DRAIN_SOLICIT_WORDS = ['招生', '开班', '名额有限', '课程顾问', '体验课', '预约试听', '报名咨询', '扫码加', '私信咨询'];
function drainLooksSolicit(data, cfg) {
  const blob = [data && data.noteTitle, data && data.noteContent, data && data.noteAuthor].join(' ');
  return drainSolicitWords(cfg).some(w => blob.indexOf(w) >= 0);
}

/* 2026-11-10：AI 有时把「这篇不值得评／没有评论的必要」这种判断句当成评论吐出来，
   以前只认整句「跳过」，这类解释句就被当评论发了出去。出口统一过这一道：
   读起来像在解释这篇笔记的，一律当成「没写」——宁可这篇不评，也不把解释发到别人的评论区。 */
const DRAIN_META_PHRASE = /(评论(?:的)?必要|值得评论|适合评论|没必要评论|不用评论|无需评论|不需要评论|没有可评论|没什么可评|无可评|不值得评|不适合评|不评了|(这条|这篇|本条|这则)[^。！？!?\n]{0,8}(不评|跳过)|跳过(?:这条|这篇|这则|本条)?)/;
function drainLooksMetaText(raw) {
  const s = String(raw || '').trim()
    .replace(/^(?:```(?:json|text)?|"""|''')/, '').replace(/(?:```|"""|''')$/, '')
    .replace(/^[\s"'“”「」【】]+|[\s"'“”「」【】]+$/g, '').trim();
  if (!s) return true;
  const first = (s.split(/[。！？!?\n]/)[0] || '').trim();
  if (/^(跳过|skip|不评论|不适合评论|不值得评论|没必要评论|无需评论|不用评论)[。.!！?？\s]*$/i.test(first)) return true;
  if (/^(分析|结论|判断|说明|复盘)\s*[:：]/.test(first)) return true;
  if (/^(这篇|本条|这则|这个笔记|本文|该笔记)[^。！？!?\n]{0,12}(笔记|内容|帖子|文章)[^。！？!?\n]{0,24}(没|不|无|评论|必要|值得|适合|跳过)/.test(first)) return true;
  if (DRAIN_META_PHRASE.test(s)) return true;
  if (/^(the note|this note|analysis|conclusion|skip)\b/i.test(first)) return true;
  if (/no need to comment|not (?:worth|suitable for) comment/i.test(s)) return true;
  return false;
}
/* 判/写合一（2026-11-10）：一次 AI 请求同时给出「值不值得评」和「要发的那句」。
   AI 没按 JSON 回时把原文当评论，仍然过上面那道闸，不因为格式不对就乱发。 */
function drainParseJudgeJson(raw) {
  const s = String(raw || '').trim().replace(/^(?:```(?:json)?|""")/, '').replace(/(?:```|""")$/, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { const o = JSON.parse(s.slice(a, b + 1)); return (o && typeof o === 'object') ? o : null; } catch (_) { return null; }
}
/* 按帖挑口径（2026-11-10）已并进「笔记类型表」（2026-11-12）：
   判定与动作都在 handleDrainComment 的判帖段按 DRAIN_NOTE_TYPE_DEF 走，不再让 AI 挑玩法。 */
/* 评论区里这条像不像同行（店、老师、机构、招生号）：通用机构词先挡一道，
   挡不住的交给 AI 判；两边都判不准时，求助帖里按同行处理（宁可漏一个，不误回一个同行）。
   这里只放跟行业无关的词，别把某个行业的名词写死进来。 */
const DRAIN_PEER_NAME_WORDS = ['培训', '教育', '艺术', '工作室', '机构', '学院', '俱乐部', '老师', '教练', '助教', '顾问', '官方', '客服', '招生', '报名', '体验课', '店', '馆'];
const DRAIN_PEER_BODY_WORDS = ['免费试', '欢迎来试', '可以来试', '欢迎咨询', '私信咨询', '扫码加', '加微信', '报名咨询', '预约试听', '我们机构', '我们店', '我们馆', '我们工作室', '我们中心'];
function drainLooksPeerComment(author, text, cfg) {
  const name = String(author || '');
  const body = String(text || '');
  const words = (typeof drainSolicitWords === 'function') ? drainSolicitWords(cfg) : [];
  if (words.some(w => w && (body.indexOf(w) >= 0 || name.indexOf(w) >= 0))) return true;
  if (DRAIN_SOLICIT_WORDS.some(w => body.indexOf(w) >= 0)) return true;
  if (DRAIN_PEER_BODY_WORDS.some(w => body.indexOf(w) >= 0)) return true;
  return DRAIN_PEER_NAME_WORDS.some(w => name.indexOf(w) >= 0);
}
/* 小红书一条评论最多 300 字，超了发不出去：先按句子收，收不住就硬截 */
function drainClipComment(text, max) {
  const s = String(text || '');
  const n = Math.max(1, Math.floor(Number(max) || 300));
  if (s.length <= n) return s;
  const head = s.slice(0, n);
  const cut = Math.max(head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('？'), head.lastIndexOf('…'), head.lastIndexOf('\n'));
  return (cut >= Math.floor(n * 0.6) ? head.slice(0, cut + 1) : head).trim();
}
async function handleDrainComment(data) {
  const sc = (SCENARIO_DRAIN || []).find(s => s.scenario === (data && data.scenario));
  if (!sc) throw new Error('未知截流场景: ' + (data && data.scenario));
  const _pvOnly = !!(data && (data.preview || data.previewOnly));
  const isJudge = !!(data && data.judge);   // 判这篇＋写评论合成一次（2026-11-10）
  const _pvMat = drainPromptMaterial('note', data || {});
  const config = await Storage.getConfig();
  let store = (data && data.store) || '';
  let talkBlock = '';
  let scanCfg = null;
  let stratRule = '';
  let plan = null;
  try {
    scanCfg = await drainGetScanCfg();
    plan = drainPbPlan(scanCfg, data.scenario);
    if (!store) store = plan.store;
    /* 没设城市＝判断不了同城，连“我是做这行的”也不提，避免在外地帖乱认老乡（事实前提） */
    if (!String((scanCfg && scanCfg.city) || '').trim()) store = 'none';
    // 这个玩法配好的那段话：当参考带进评论，不逐字照抄
    talkBlock = drainTalkBlock(drainPbTalkOf(scanCfg, data.scenario));
    /* 判这一篇：动作还没判出来，不能先把渠道那行「只回评论区 / 只收人」塞进去，
       只留「怎么开口 / 引导」那两行；动作等下面类型表一起给 */
    stratRule = drainStrategyRule(scanCfg, data.scenario, (data && data.act) || '');
    if (isJudge) stratRule = stratRule.split('\n').slice(1).join('\n');
  } catch (_) {}
  /* 配成「只回评论区 / 只收人」的渠道不在笔记下面露面（2026-11-04）；
     判这一篇时照样要判——类型表还没出来，不能在这道闸前收队 */
  const _actNow = String((data && data.act) || '') || (plan && plan.mode) || '';
  if (!isJudge && plan && (_actNow === 'reply' || _actNow === 'people')) {
    const reason = '这个渠道配的是「' + DRAIN_PB_MODE[_actNow] + '」：不在笔记下面评';
    if (_pvOnly) return { ok: true, preview: true, skip: reason, prompts: { system: '', user: '' } };
    await drainPromptSave({ act: 'note', scenario: data.scenario, skip: reason, material: _pvMat });
    return { ok: true, skip: true, comment: '', scenario: data.scenario, verdict: isJudge ? 'none' : undefined, reason: reason };
  }
  /* 同行/揽客帖这道闸挪到读完配置之后：判「像不像揽客」的词表要按这个号的行业口径包补（2026-11-04） */
  if (drainScenarioId(data && data.scenario) === 'local' && drainLooksSolicit(data, scanCfg)) {
    const reason = '同行在揽客的帖子：只收人、不留言';
    if (_pvOnly) return { ok: true, preview: true, skip: reason, prompts: { system: '', user: '' } };
    await drainPromptSave({ act: 'note', scenario: data.scenario, skip: reason, material: _pvMat });
    return { ok: true, skip: true, comment: '', scenario: data.scenario, verdict: isJudge ? 'none' : undefined, reason: reason };
  }
  const aiCfg = Object.assign({}, config.ai || {}, { maxTokens: 900 });
  if (!_pvOnly && !aiCfg.apiKey && !aiCfg.fallbackApiKey) throw new Error('尚未配置 AI（请在设置里填 API Key）');
  const product = (config.product && config.product.name) || '本产品';
  /* 引导那句：玩法上配了明确档位就用它，配「跟账号资料」才用账号资料那句 */
  const guide = drainGuideByPlan(scanCfg, data.scenario) || drainResolveGuide(config);
  const payload = Object.assign({}, data, {
    product, guide,
    /* 判这一篇：提店档还没判出来，先不塞渠道那档，等类型表一起给 */
    storeRule: isJudge
      ? '提店到哪一步，按这次判出的笔记类型表里那一档来：不提 / 只提身份 / 讲案例 / 可报店名；报价、联系方式、站外链接一律不写。'
      : drainStoreRule(store, scanCfg, { guide: plan ? plan.guide : '' }),
    personaBlock: drainPersonaBlock(config),
  });
  /* 提示词本体：铺底子时抄进 cfg.pbPrompt 的那份优先，没有才用内置 */
  const ownPrompt = ((scanCfg || {}).pbPrompt || {})[drainScenarioId(data.scenario)] || {};
  const sysBuiltin = String(ownPrompt.system || '').trim() || sc.system;
  const userBuiltin = String(ownPrompt.user || '').trim() || sc.user;
  /* 五块，一句只说一次：你是谁 → 这一趟要干什么 → 能提自己到哪一步 → 话术库 → 红线 */
  const personaHead = '【你是谁】\n这个号就是你在打理。下面这段人设就是你的真实身份、经历和立场，不能改、不能演别人：\n'
    + String(payload.personaBlock || '（这个号还没填人设：就按一个懂行的真人说，别装专家、也别说外行话）')
    + '\n人设里写过的经历、数字可以自然用；没写过的一律不许编，别把自己写成顾客、路人或别的职业。';
  const cityLine = (['latest', 'local', 'cross'].indexOf(drainScenarioId(data.scenario)) >= 0)
    ? '\n你是本地人，就在' + (payload.city || '本地') + '做这一行。' : '';
  /* 铺过底子的号：模板里自己就带人设 / 提店那两段，外面不再叠一遍 */
  const tplHasPersona = /\{persona_block\}|【这个账号是谁】/.test(sysBuiltin);
  const tplHasStore = /\{store_rule\}|【提店口径】|【能提自己到哪一步】/.test(sysBuiltin);
  let sysPrompt = tplHasPersona ? '' : (personaHead + cityLine);
  const stratLines = stratRule ? stratRule.split('\n') : [];
  const modeLine = stratLines.shift() || (isJudge
    ? '先判这一篇是什么帖，再按「笔记类型表」里这一类的动作来：评不评、怎么评、能提到哪一步。'
    : '');
  const whoBlock = drainWhoBlock(scanCfg, data.scenario);
  const whoText = whoBlock ? whoBlock.replace('【这个玩法捞谁·为了什么】\n', '') : '';
  sysPrompt += '\n\n【这一趟要干什么】\n' + modeLine;
  if (whoText) sysPrompt += '\n捞谁：' + whoText.replace(/\n/g, ' ');
  sysPrompt += '\n' + _fillSentiment(sysBuiltin, payload);
  if (stratLines.length) sysPrompt += '\n' + stratLines.join('\n');
  sysPrompt += '\n语感：像本人随手打字，不用「首先 / 总之 / 建议收藏」这种腔，不堆四字词。';
  if (!tplHasStore && !isJudge) sysPrompt += '\n\n' + drainStoreRule(store, scanCfg, { guide: plan ? plan.guide : '' });
  if (talkBlock) sysPrompt += '\n\n' + talkBlock;
  sysPrompt += '\n\n【话术库（每条挑一种说法，整批别一个套路）】\n' + talkStyleCatalog();
  sysPrompt += '\n\n【红线】\n不出现站外平台名、链接、二维码、微信号；不承诺效果（几天见效、涨多少粉）；不贬低同行、不点名别家。';
  if (isJudge) {
    const relText = data.matched === 'highv' ? '大V（「盯的账号」名单里的头部博主）'
      : data.matched === 'rival' ? '竞对／同行' : '普通作者';
    const _hrs = Number(data.publishAt) > 0 ? (Date.now() - Number(data.publishAt)) / 3600000 : null;
    const timeText = (_hrs == null || _hrs < 0) ? '发布时间没读到（不要据此判断新不新）' : ('发布于 ' + _hrs.toFixed(1) + ' 小时前');
    const likes = (data.likes != null && Number.isFinite(Number(data.likes))) ? String(data.likes) : '没读到';
    const cmts = (data.commentsCount != null && Number.isFinite(Number(data.commentsCount))) ? String(data.commentsCount) : '没读到';
    sysPrompt += '\n\n【先判这一篇是什么帖，再按笔记类型决定这篇怎么跑】\n'
      + '类型可以多个（比如既是「求助咨询帖」又是「同城本业」），第一个当主类型；只填这张表里的 id：\n'
      + drainNoteTypeMenuText(scanCfg) + '\n'
      + '多类型同时命中：评论动作跟主类型；提店取最严的一档（不提 < 只提身份 < 讲案例 < 可报店名）；'
      + '只要命中「广告招生帖」就不留言、只收人（comment 留空、verdict="none"）；只要命中「悲伤纠纷帖」就完全不碰（verdict="blocked"）。\n'
      + '写 comment 时，「提店到哪一步」以这里判出的那一档为准；上面若给了更宽的说法（比如可报店名），一律按这张表收窄。\n'
      + '判类型只看这篇本身是什么帖，不要因为「是哪个词搜到的」就将就。\n'
      + '\n【值不值得评】\n'
      + '先看硬条件，命中任意一条 → verdict="blocked"：招聘/招人/招商加盟；纯广告/硬广/带货链接/引流别处；吵架/维权/纠纷/挂人；悲伤/病痛/事故/悼念；纯带货（通篇卖货、没有可聊的内容）。\n'
      + '再看有没有可聊的空间：grab＝有明确观点/槽点/经验/问题，评论区还没形成定论，现在留一条本行视角能被看到、能接话；worth＝有可聊的点但不急，正常评一句；none＝没话说，或话题已经闭环，评了也是废话。\n'
      + '作者是' + relText + '：' + (data.matched === 'highv'
        ? '只借势（赞同＋补一句本行视角），不抢话、不教育博主；内容没得接就 none。'
        : (data.matched === 'rival' ? '一律 none（不评论）。' : '按上面正常判断。')) + '\n'
      + '不要因为「发布得新」就硬评；新只影响优先级，不影响值不值得。\n'
      + 'verdict 是 none / blocked 时，comment 必须是空字符串。\n'
      + 'comment 只能是要发出去的那句话本身：不许写「这篇/本条/分析/结论/跳过/没必要/不值得」这类判断和解释，不许提 AI、不许说明你为什么写或不写。\n'
      + '输出只给一个 JSON（不要 markdown、不要多余文字）：\n'
      + '{"note_types":["bigv|help|localbiz|localcross|normal|ad|sad"],"main_type":"上面第一个","verdict":"grab|worth|none|blocked","reason":"一句话说清为什么","block":"招聘|纯广告|纠纷|悲伤|纯带货|","comment":"要发的评论；none/blocked 留空"}';
    sysPrompt += '\n【笔记信息】\n作者：' + (data.noteAuthor || '未知') + '（' + relText + '）\n' + timeText + '\n赞：' + likes + ' · 评论：' + cmts;
  } else {
    sysPrompt += '\n\n【只输出】\n直接返回评论正文，不要解释、不要标题、不要分点。';
  }
  const userPrompt = _fillSentiment(userBuiltin, payload);
  if (_pvOnly) return { ok: true, preview: true, comment: '', scenario: data.scenario, prompts: { system: sysPrompt, user: userPrompt } };
  const _t0 = Date.now();
  const r = await AiClient.chatCompletion(aiCfg, sysPrompt, userPrompt);
  const _ms = Date.now() - _t0;
  const _usage = (r && r.usage) || {};
  let text = String((r && r.content) || '').trim();
  let verdict = '', block = '', aiReason = '', noteTypes = [], mainType = '', typePlan = null;
  if (isJudge) {
    const o = drainParseJudgeJson(text);
    if (o) {
      const v = String(o.verdict || '').trim();
      verdict = ['grab', 'worth', 'none', 'blocked'].indexOf(v) >= 0 ? v : 'none';
      block = String(o.block || '').trim().slice(0, 20);
      aiReason = String(o.reason || '').trim().slice(0, 200);
      noteTypes = (Array.isArray(o.note_types) ? o.note_types : [o.note_types || o.note_type])
        .map(drainNoteTypeId).filter((id, i, a) => id && a.indexOf(id) === i);
      mainType = drainNoteTypeId(o.main_type) || noteTypes[0] || '';
      /* 名单认到的作者不让 AI 改类型：大V＝只借势，竞对＝同行招生（只收人） */
      if (data.matched === 'highv') { noteTypes = ['bigv']; mainType = 'bigv'; }
      else if (data.matched === 'rival') { noteTypes = ['ad']; mainType = 'ad'; }
      typePlan = drainNoteTypePlan(scanCfg, noteTypes);
      text = String(o.comment || '').trim();
    } else {
      /* AI 没按 JSON 回：把原文当评论，仍然过下面的闸（格式不对不等于可以乱发） */
      verdict = drainLooksMetaText(text) ? 'none' : 'worth';
      aiReason = 'AI 没按格式回，按正文当评论处理';
    }
  }
  text = text.replace(/^(```(?:json|text)?|"""|''')/, '').replace(/(```|"""|''')$/, '').trim();
  text = text.replace(/^["']|["']$/g, '').trim();
  /* 笔记类型表定这篇能做到哪一步（2026-11-12）：悲伤＝完全不碰，广告＝不留言只收人。
     这两档在 AI 写之前就由表定了，写回来的那句话一律不作数。 */
  if (isJudge && typePlan && typePlan.mode === 'block') {
    const tName = (DRAIN_NOTE_TYPE_DEF[typePlan.mainType] || {}).name || '这类帖';
    const reason = tName + '：完全不碰，不评也不收';
    await drainPromptSave({
      act: 'note', scenario: data.scenario, sys: sysPrompt, user: userPrompt,
      raw: text, skip: reason, ms: _ms, tokensIn: _usage.prompt_tokens || 0,
      tokensOut: _usage.completion_tokens || 0, model: aiCfg.model, material: _pvMat,
    });
    return {
      ok: true, skip: true, comment: '', scenario: data.scenario,
      verdict: 'blocked', block: block || '', reason: reason,
      ms: _ms, tokensIn: _usage.prompt_tokens || 0, tokensOut: _usage.completion_tokens || 0,
      prompts: { system: sysPrompt, user: userPrompt },
      noteType: mainType, noteTypes: noteTypes, mainType: mainType,
      typeMode: 'block', typeAct: '', typeStore: 'none', typeCollect: false,
    };
  }
  if (isJudge && typePlan && typePlan.mode === 'silent') {
    const tName = (DRAIN_NOTE_TYPE_DEF[typePlan.mainType] || {}).name || '这类帖';
    const reason = tName + '：不留言，只收人';
    await drainPromptSave({
      act: 'note', scenario: data.scenario, sys: sysPrompt, user: userPrompt,
      raw: text, skip: reason, ms: _ms, tokensIn: _usage.prompt_tokens || 0,
      tokensOut: _usage.completion_tokens || 0, model: aiCfg.model, material: _pvMat,
    });
    return {
      ok: true, skip: true, comment: '', scenario: data.scenario,
      verdict: 'none', block: block || '', reason: reason,
      ms: _ms, tokensIn: _usage.prompt_tokens || 0, tokensOut: _usage.completion_tokens || 0,
      prompts: { system: sysPrompt, user: userPrompt },
      noteType: mainType, noteTypes: noteTypes, mainType: mainType,
      typeMode: 'silent', typeAct: 'people', typeStore: 'none', typeCollect: typePlan.collect,
    };
  }
  // ★ 出口硬闸（2026-11-10）：「不适合就不评」＋「AI 想解释」都按跳过记，绝不把解释当成评论发出去
  //   （竞对=send:'none' 生成的是私信开场白，同样不许发解释句）
  const looksMeta = drainLooksMetaText(text);
  const verdictAllows = !verdict || verdict === 'grab' || verdict === 'worth';
  if (looksMeta || !verdictAllows) {
    const reason = !verdictAllows
      ? (aiReason || 'AI 判断这篇不值得评论')
      : 'AI 想解释，没发（没有可发的评论正文）';
    await drainPromptSave({
      act: 'note', scenario: data.scenario, sys: sysPrompt, user: userPrompt,
      raw: text, skip: reason, ms: _ms, tokensIn: _usage.prompt_tokens || 0,
      tokensOut: _usage.completion_tokens || 0, model: aiCfg.model, material: _pvMat,
    });
    return {
      ok: true, skip: true, comment: '', scenario: data.scenario,
      verdict: isJudge ? (verdict || 'none') : undefined, block: block || '', reason: reason,
      noteType: isJudge ? mainType : undefined, noteTypes: noteTypes, mainType: mainType,
      typeMode: typePlan ? typePlan.mode : '', typeAct: typePlan ? typePlan.act : '',
      typeStore: typePlan ? typePlan.store : '', typeCollect: typePlan ? typePlan.collect : null,
      ms: _ms, tokensIn: _usage.prompt_tokens || 0, tokensOut: _usage.completion_tokens || 0,
      prompts: { system: sysPrompt, user: userPrompt },
    };
  }
  const used = drainClipComment(text, 300);
  await drainPromptSave({
    act: 'note', scenario: data.scenario, sys: sysPrompt, user: userPrompt,
    raw: text, used: used, ms: _ms, tokensIn: _usage.prompt_tokens || 0,
    tokensOut: _usage.completion_tokens || 0, model: aiCfg.model, material: _pvMat,
  });
  return {
    comment: used, scenario: data.scenario,
    verdict: isJudge ? verdict : undefined, block: block || '', reason: aiReason,
    noteType: isJudge ? mainType : undefined, noteTypes: noteTypes, mainType: mainType,
    typeMode: typePlan ? typePlan.mode : '', typeAct: typePlan ? typePlan.act : '',
    typeStore: typePlan ? typePlan.store : '', typeCollect: typePlan ? typePlan.collect : null,
    ms: _ms, tokensIn: _usage.prompt_tokens || 0, tokensOut: _usage.completion_tokens || 0,
    prompts: { system: sysPrompt, user: userPrompt },
  };
}