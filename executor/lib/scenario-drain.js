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
 *   3. 同城本业(local)：城市＋本行关键词，筛选「最新」。家长笔记下留判断型短评；同行/机构的
 *      招生帖只收人、不留言（原「竞对」2026-11-02 并进这一路）。
 *   4. 求助笔记(pain)：特殊关键词（求推荐/听劝…）。走活水机制。
 *   5. 同城异业(cross)：城市＋别家行业关键词，从别家评论区找本地家长。
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
    tag: '最新 · 找还没想过报班的本地家长',
    desc: '城市＋场景宽词，按「最新」搜。找的是还在带娃过日子、还没想过报班的本地家长。',
    dmOpen: '刷到你带娃那条，我也是本地带娃的，说个实在的……',
    system: `你是小红书上一个账号的主人——这个号就是你在打理，本地人，就在{city}做这一行。刷到同城一篇还在带娃过日子的笔记，想留一句只有本地人才说得出的提醒。
【这个账号是谁】
{persona_block}
这次不推销、不发广告、不留任何引导：只写一句让人看完觉得「这人真懂本地」的短评。
要求：
1. 20-60 字，一到两句，口语，像本人随手敲的；最多带 1 个表情
2. 先用「我」说一句本地人普遍知道的实情（哪个时段人多、哪个场地适合几岁、下雨该去哪），再补一句带娃/本地生活的小提醒
3. 只讲真懂的：不许编「我常去某地」这类亲历；人设里没写的「我家娃／我孩子／我学员／我客户」一律不许出现；不玩梗、不讲段子
4. 不提产品名、品牌、机构、课程、价格、链接、主页、私信，不导流
5. 不要 AI 味：不用「首先/总之/建议收藏」，不堆四字词
6. 丧事、疾病、纠纷、投诉这类内容，或博主明显不想被搭话 → 只回复两个字：跳过
{store_rule}`,
    user: `【城市】{city}
【笔记标题】{title}
【笔记正文】{content}
【博主】{author}

这是同城一篇家长带娃的笔记，我要以本地人的身份留一句短评。请写一句 20-60 字的短评（最多 1 个表情）；如果这篇不适合评论，只回复：跳过。直接返回评论文本。`,
  },
  {
    scenario: 'top',
    label: 'TOP搜索',
    icon: '🔥',
    tag: '点赞/评论/收藏最多 · 长期占位',
    desc: '不带城市的全国流量词，按点赞/评论/收藏最多搜。写一句专业热评长期占位。',
    dmOpen: '看到你在那篇讲 XX 的帖子下留言，说到点上了……',
    system: `你是小红书上一个账号的主人——这个号就是你在打理，正好是做这一行的。刷到一篇搜索排名靠前的笔记，想留一句同行看了点头、普通读者也看得懂的热评，长期挂在前排。
【这个账号是谁】
{persona_block}
不推销、不写长文：一句懂行的话，或一个别人没提到的具体点就够。
要求：
1. 20-70 字，一到两句；最多带 1 个表情
2. 以「我」说话，先接住笔记讲的那件事，再补一个别人没提到的具体点：先做哪一步、哪种情况别做、最容易忽略什么
3. 不复读评论区已有的话，不写「赞同楼上」
4. 只讲真懂的：不许编造亲历（人设里没写的「我家娃／我孩子／我学员／我客户」不许出现），不许整活玩梗
5. 不提店名、机构名、课程名、价格、链接、主页、私信
6. 不要 AI 味：不用「首先/总之/建议收藏」，不堆四字词
7. 丧事、疾病、纠纷、投诉这类内容 → 只回复两个字：跳过
{store_rule}`,
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
    tag: '城市＋本行 · 已经在挑机构',
    desc: '城市＋核心品类，按「最新」搜。找的是已经在挑机构、准备报班的本地家长；同行/机构的招生帖只收人不留言。',
    dmOpen: '同在{city}，看到你在纠结给孩子找班……',
    system: `你是小红书上一个账号的主人——这个号就是你在打理，本地人，就在{city}做这一行。刷到同城家长在聊本行相关的事，想留一句短、准、能帮他做判断的评论。
【这个账号是谁】
{persona_block}
不推销、不拉客。先判帖：如果这是同行/机构在招生、卖课、推体验课（出现「招生、名额、报名、优惠、扫码、试听」这类词，或口吻明显在卖课）→ 只回复两个字：跳过；评论区的本地家长仍会被收进清单。
要求：
1. 20-50 字，只写一句话；最多带 1 个表情
2. 用「我」说话，给一条判断：先试什么、该看什么、哪种情况先别报
3. 不提店名、不提机构、不报价、不留联系方式、不说「来找我」
4. 不贬低同行；不许编造亲历（人设里没写的「我家娃／我学员／我客户」不许出现），不玩梗
5. 不用「首先/总之/建议收藏」，不空夸
6. 丧事、疾病、纠纷、投诉这类内容 → 只回复两个字：跳过
{store_rule}`,
    user: `【城市】{city}
【笔记标题】{title}
【笔记正文】{content}
【博主】{author}

这是同城家长在聊本行相关的事，我要以本地做这行的人的身份留一句判断。请写一句 20-50 字的短评（最多 1 个表情）；如果这篇不适合评论，只回复：跳过。直接返回评论文本。`,
  },
  {
    scenario: 'pain',
    label: '咨询帖',
    icon: '🎯',
    tag: '求助/避雷 · 楼主和回复区都收',
    desc: '城市＋求助词/避雷词，按「关键词」搜。楼主和回复区里同问的人都要收。',
    dmOpen: '看到你在问 XX 那件事，我正好做这行……',
    system: `你是小红书上一个账号的主人——这个号就是你在打理，本地人，正好是做这一行的。刷到一条家长在求助或避雷的笔记，想留一句真帮到他、又让人记住你的评论。
【这个账号是谁】
{persona_block}
先判帖，再写：
· 求助帖（哪家好／求推荐／值不值／怎么办）→ 按 A 写
· 避雷帖（后悔／避雷／踩坑／没用）→ 按 B 写

A 求助帖
1. 20-70 字，一到两句；最多带 1 个表情
2. 先正面回答他问的那件事，给一条马上能用的判断或做法：先做什么、该看什么、哪种情况先别急着报
3. 不推销、不报店、不承诺效果

B 避雷帖
1. 20-70 字，一到两句；最多带 1 个表情
2. 先接住他的情绪（一句就够），再给一条下次怎么避开的判断；不替同行辩解、不说「是你没找对」
3. 不趁机推销、不报店

两版都遵守：
4. 只讲真懂的：不许编造亲历（人设里没写的「我家娃／我学员／我客户」不许出现），不玩梗
5. 不提产品名、品牌、链接、主页、私信
6. 不用「首先/总之/建议收藏」，不堆四字词
7. 丧事、重病、纠纷、投诉这类内容 → 只回复两个字：跳过
{store_rule}`,
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
    tag: '城市＋异业 · 评论区里的本地家长',
    desc: '城市＋异业品类（也可 #话题），按「最新」搜。从别家行业的笔记评论区里找本地家长。',
    dmOpen: '刷到你在 XX 那条下面留言，说到孩子……',
    system: `你是小红书上一个账号的主人——这个号就是你在打理，本地人，就在{city}做这一行。刷到同城异业（不是本行）的笔记，想借评论区里本地家长的讨论，留一句自然、不露痕迹的评论。
【这个账号是谁】
{persona_block}
先判帖：
· 这是不是招生/卖课/报名帖？看到「招生、名额、报名、体验课、优惠、元、扫码、私信」这类词，或口吻明显在卖课 → 只回复两个字：跳过
· 普通分享帖 → 按下面写

普通分享帖：
1. 40-100 字，一到三句；最多带 1 个表情
2. 用跨行业关联切入：从对方笔记里的具体困扰（坐不住、动作软、坐姿塌、专注差）接到本行的判断，别硬拐
3. 用「我」说话，像本地家长/本地人闲聊，不自我介绍、不暴露职业
4. 不贬低对方行业；不许编造亲历（人设里没写的「我家娃／我学员／我客户」不许出现），不玩梗
5. 不提店名、机构、课程、价格、联系方式
6. 不用「首先/总之/建议收藏」
7. 丧事、疾病、纠纷、投诉这类内容 → 只回复两个字：跳过
{store_rule}`,
    user: `【城市】{city}
【笔记标题】{title}
【笔记正文】{content}
【博主】{author}

这是同城异业的笔记，我要从跨行业角度留一句自然评论。请写一句 40-100 字的短评（最多 1 个表情）；如果是招生/卖课帖或内容不适合，只回复：跳过。直接返回评论文本。`,
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
    system: `你是小红书上一个账号的主人——这个号就是你在打理，做的是这一行。刷到一位头部博主（大V）的笔记，想在他评论区留一句能被更多人看到的专业补充。
【这个账号是谁】
{persona_block}
方式是「先真心赞同 + 再补一句本行才看得出的角度」。不推销、不提产品、不写长文。
要求：
1. 20-70 字，一到两句；最多带 1 个表情
2. 先接住博主最亮的那句观点表示赞同，再用本行的视角补一句别人没注意到的角度或一个具体做法
3. 不能像拍马屁；不许编造亲历（人设里没写的「我家娃／我学员／我客户」不许出现），不许整活玩梗
4. 不提产品名、品牌、链接、主页、私信
5. 不用「首先/总之/建议收藏」
6. 丧事、疾病、纠纷这类内容，或博主口吻明显不适合搭话 → 只回复两个字：跳过
{store_rule}`,
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
  { scenario: 'cross', tip: '关键词（词里自带城市）+ 最新（同城异业：从别家行业评论区找本地家长）', needCity: true },
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
    tip: 'TOP搜索：全国流量词搜点赞/评论/收藏最多，发一条专业热评长期占位，同时回评论区里问方法的人' },
  local: { name: '同城本业', icon: '📍', send: 'both', find: 'commenters', keep: '地域信任',
    tip: '同城本业：城市＋本行词搜最新，在家长笔记下留一条判断型短评，同时回评论区里比较机构的人；同行/机构的招生帖只收人、不留言' },
  pain: { name: '咨询帖', icon: '🎯', send: 'both', find: 'commenters', keep: '活水维护',
    tip: '咨询帖：求助帖/避雷帖里，对笔记发一条评论，同时回复评论区里同问的人' },
  cross: { name: '同城异业', icon: '🧩', send: 'both', find: 'commenters', keep: '跨行业关联',
    tip: '同城异业：城市＋异业词搜最新，普通分享帖可以评论（招生帖跳过），同时回评论区里说孩子情况的人' },
  rival: { name: '同行／竞对', icon: '🕵️', send: 'none', find: 'commenters', keep: '私信跟进',
    tip: '同行／竞对：只在评论区找人拉进获客清单去私信，绝不评论、不惊动对方' },
  highv: { name: '大V', icon: '👑', send: 'both', find: 'commenters', keep: '借头部流量',
    tip: '大V：在头部博主笔记下发一条「赞同＋本行补充」，同时回评论区里接话的本地家长' },
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
const DRAIN_PB_DEFAULT = {
  latest: { days: [1, 3, 5], perDay: 3, store: 'none' },
  top: { days: [1, 2, 3, 4, 5, 6, 0], perDay: 3, store: 'identity' },
  local: { days: [1, 3, 5], perDay: 3, store: 'identity' },
  pain: { days: [2, 4, 6], perDay: 3, store: 'identity' },
  cross: { days: [2, 5], perDay: 2, store: 'identity' },
  rival: { days: [6], perDay: 2, store: 'none' },
  highv: { days: [2, 4], perDay: 1, store: 'none' },
};
const DRAIN_PB_STORE = { none: '不提', identity: '只提身份', store: '可报店名' };
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
  return {
    days,
    perDay: (Number.isFinite(per) && per >= 1) ? Math.min(20, per) : d.perDay,
    store: DRAIN_PB_STORE[o.store] ? o.store : d.store,
    wordRule: drainPbWordRuleNorm(o.wordRule),
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
/* 今天这个玩法该挑哪几个词：按词池顺序轮着来，一天换一批，几天转完一圈。
   occ＝今天是本周第几次跑这个玩法（周一到周日数），start=occ*perDay —— 跟 demo 同一套。 */
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
  const start = (Math.max(0, occ - 1) * p.perDay) % words.length;
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
/* 6 个玩法的默认短话（2026-11-03）：2~3 句讲清「什么算商机 / 怎么评论 / 提不提店名」。
   只在第一次读到配置时铺一遍；之后老板手改的那份不再被默认盖回去。 */
const DRAIN_TALK_DEFAULT = {
  latest: '本地家长问周末带娃去哪、孩子精力没处使，就是商机。笔记下面留一句本地经验抢前排；评论区里回你的、跟着问的，顺着他的原话各回一句，不推销。不提店名，最多说自己是做这行的。',
  top: '评论区里家长问方法、问有没有用，就是商机。笔记下面只给一句内行判断，不长篇、不导流；谁在你那条底下追问，就回一句他马上能试的。不提店名，也不说自己是谁。',
  local: '家长在问哪家好、在比较机构，就是商机。家长帖笔记下面接一句判断型短评，回复区里同问的人逐个回；同行或机构的招生帖只收人、不留言。可以说自己干这行，店名等对方问起再报。',
  pain: '楼主在求助、避雷、问哪家靠谱，就是商机；回复区里同问的人也算。笔记下面先正面回答他问的那件事，再给一条能马上试的；评论区里谁追问就回谁。可以报店名，价格等私信里再说。',
  cross: '别家评论区里有人说孩子坐不住、画画跳舞坐不下来、注意力差，就当放电不够、可以聊体智能，这就是商机。笔记下面从跨行业的角度搭一句，回复区里说孩子情况的逐个接一句本地经验。不提店名，最多说自己是做这行的。',
  highv: '大V评论区里接话、问方法的本地家长，就是商机。在大V笔记下面留一句「赞同＋本行视角补充」借势露脸；谁在那条底下回你、接着问，就回一句，只说自己是干这行的。不主动报店名，往下走私信。',
};
/* 默认话术对应的提店硬控档位（跟那段话说的保持一致） */
const DRAIN_TALK_DEFAULT_STORE = {
  latest: 'identity', top: 'none', local: 'store', pain: 'store', cross: 'identity', highv: 'identity',
};
/* 哪一行的话术编辑块是展开的（整页重绘后还留着，比如点了周几） */
let _drainTalkOpen = null;
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
  return '【这个玩法的话术（当参考，按对方的原话自然说，别逐字照抄）】\n' + String(t.text).trim().slice(0, 1200);
}

/* 同一篇笔记两步共用一段评论策略（2026-11-04）：「在笔记下面评一句」走 drainComment、本来就带这个玩法的
   提店口径和话术；「回评论区那句」走商机挖掘那条提示词，它不知道自己是哪个玩法捞出来的，
   这里按这一趟的玩法把同一段补进去。手动扫描（没有玩法）返回空串＝维持原样。 */
async function drainReplyStrategyBlock(scenario) {
  const id = String(scenario || '');
  if (!id || id === 'daily' || typeof drainGetScanCfg !== 'function') return '';
  let cfg = null;
  try { cfg = await drainGetScanCfg(); } catch (_) { return ''; }
  const talk = drainTalkBlock(drainPbTalkOf(cfg, id));
  return '\n\n【这一趟的评论策略（跟「在笔记下面评一句」用的是同一段）】\n'
    + drainStoreRule(drainPbPlan(cfg, id).store) + '\n'
    + (talk || '（这个玩法还没写话术：按人设自然接话，公开评论不主动报店名、不报价、不留联系方式）');
}

/* 给 AI 写这份话术的一句话玩法说明（2026-11-02）：按玩法换角度，六套共用 */
function drainPbTalkHint(id) {
  return {
    latest: '本地泛搜索：找还没想过报班的本地家长。第一句说本地带娃的实情，不提课程和价格。',
    top: 'TOP搜索：写全国热评长期占位。只给内行判断，不导流。',
    local: '同城本业：对方已经在挑机构。给一条判断，不贬低同行、不报价；同行/机构的招生帖不留言，只收人去私信。',
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
/* 配置指纹（2026-10-29）：锁定今天这份清单时一起记下，之后配置一改就能提示
   「今天这趟照原样跑，明天按新的排」。只进指纹的东西＝会影响跑哪些格：平台、城市、词/勾/周几、盯的账号、整列节奏 */
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
      for (const s of topSorts) add({ k: keyword, scenario: 'top', term: keyword, sort: s });
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
  if (Number(raw.talkSeed || 0) < DRAIN_TALK_V) {
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
  cfg.pbPlan = nextPb;
  /* 每个玩法一份话术（v7 → v8）；2026-11-03 起 6 个玩法各预置一段默认短话：
     第一次读到（talkSeed 还没记到当前版本）就铺满，提店硬控跟着对齐；
     铺过之后只归一化读写，老板手改的话一直保留。 */
  const prevTalk = (cfg.pbTalk && typeof cfg.pbTalk === 'object' && !Array.isArray(cfg.pbTalk)) ? cfg.pbTalk : {};
  const nextTalk = {};
  if (Number(cfg.talkSeed || 0) < DRAIN_TALK_V) {
    const at = Date.now();
    DRAIN_PB_ORDER.forEach(s => {
      if (!DRAIN_TALK_DEFAULT[s]) return;
      nextPb[s].store = DRAIN_TALK_DEFAULT_STORE[s] || nextPb[s].store;
      nextTalk[s] = { text: DRAIN_TALK_DEFAULT[s], persona: '', at, v: DRAIN_TALK_V };
    });
    cfg.talkSeed = DRAIN_TALK_V;
  } else {
    DRAIN_PB_ORDER.forEach(s => { const t = drainPbTalkNorm(prevTalk[s]); if (t) nextTalk[s] = t; });
  }
  cfg.pbTalk = nextTalk;
  cfg.v = 9;
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
/* ✕ 今天撤掉的项：只认今天的名单，跨天一律当空（配置不动，明天照常排） */
function drainQDropSet(q, now) {
  const dr = (q && q.drop) || {};
  if (String(dr.day || '') !== _drainDayKey(now)) return new Set();
  return new Set((dr.keys || []).map(String));
}
/* 队列页看到的全部：待跑（到点了）/ 还没到点 / 欠账 / 正在跑。
   排序＝手插最前 → 欠账（越早欠越前）→ 自动插的日常流程 → 最久没跑的先跑
   dbIn = { cfg, daily }（见 drainDailyCtx），缺省＝没有日常浏览这一层 */
function drainQueuePlan(cfgIn, qIn, now, dbIn) {
  now = now || Date.now();
  const q = _drainQNorm(qIn);
  /* 今天这份清单锁定时连配置一起锁住（2026-10-29 确认单 9）：配置中途改了，今天照旧跑，明天按新的排 */
  const lockedCfg = (q.todayPlan && q.todayPlan.day === _drainDayKey(now) && q.todayPlan.cfg) ? q.todayPlan.cfg : null;
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
          const isCarry = !!cRec, isManual = !!mRec;
          /* 玩法今天没排 / 今天没轮到这个词 → 不跑；只有欠账和手插能插进来 */
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
    const isCarry = carryAt[key] != null, isManual = manualAt[key] != null;
    // 盯的号也按玩法排班：大V 看 highv 那一行，蹲人（原同行）跟同城本业那一行；欠账/手插照样能插
    const apb = (ac.scenario === 'rival') ? 'local' : 'highv';
    const picked = drainPbOnDay(cfg, apb, now);
    if (!picked && !isCarry && !isManual) continue;
    const item = {
      k: ac.k, label: drainAccountLabel(ac), acct: true, scenario: ac.scenario, plat: 'xhs',
      lastAt: st.lastAt, hours: st.hours || 0, nextAt: st.nextAt || 0, carry: isCarry, manual: isManual,
      carryNote: isCarry ? (q.carry.find(x => _drainQKey(x.k, x.scenario, x.plat) === key) || {}).note || '' : '',
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
  const inPool = new Set((cfg.keywords || []).filter(e => e.on !== false).map(e => e.k));
  const acctKeys = new Set((cfg.accounts || []).filter(a => a.on !== false).map(a => a.k));
  // 词被停用/删掉、账号被取消盯 → 它的欠账和手插自动作废；日常浏览只有一档，条目始终有效
  const live = (x) => (x.scenario === 'daily') ? true : (inPool.has(x.k) || acctKeys.has(x.k));
  const bkToday = (q.blocked && q.blocked.day === _drainDayKey(now)) ? (q.blocked.rows || []) : [];
  const lastStop = (q.lastStop && _drainDayKey(q.lastStop.at) === _drainDayKey(now)) ? q.lastStop : null;
  return {
    cfg, q, todo, waiting, noCity, db, dbOn,
    carry: q.carry.filter(live), manual: q.manual.filter(live), running: q.running,
    blocked: bkToday, lastStop,
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
  /* 今天这份清单：当天第一趟开跑时把顺序整份记下；之后照它跑（配置中途改了，新项排到后面，明天才按新配置算） */
  const d0 = new Date();
  const dayKey = d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') + '-' + String(d0.getDate()).padStart(2, '0');
  let tp = (q.todayPlan && q.todayPlan.day === dayKey && q.todayPlan.keys.length) ? q.todayPlan : null;
  if (!tp) tp = { day: dayKey, at: Date.now(), keys: p.todo.map(it => _drainQKey(it.k, it.scenario, it.plat, it.passId)), sig: drainCfgSig(p.cfg), cfg: p.cfg };
  // 老数据锁定时还没记指纹/快照：补一次，别让「配置改过了」误报
  else if (!tp.sig || !tp.cfg) tp = Object.assign({}, tp, { sig: tp.sig || drainCfgSig(p.cfg), cfg: tp.cfg || p.cfg });
  const rank = (it) => { const i = tp.keys.indexOf(_drainQKey(it.k, it.scenario, it.plat, it.passId)); return i < 0 ? 1e9 : i; };
  const ordered = p.todo.slice().sort((a, b) => (rank(a) - rank(b)) || ((a.sort || 0) - (b.sort || 0)));
  const item = ordered.find(it => !sk[_drainQKey(it.k, it.scenario, it.plat, it.passId)]);
  /* 取走的是手塞的那一趟 → 把它从 dailyPlan 里删掉（按 planId 精确删，别的趟不受影响） */
  const keep = {
    carry: p.carry, manual: p.manual,
    dailyPlan: (q.dailyPlan || []).filter(x => !(item && item.planId && x.id === item.planId)),
    todayPlan: tp,
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
  }));
}
/* 这一项没跑完（撞上限/出错/被停）→ 进欠账，下次第一个跑 */
async function drainQueueHold(item, note) {
  const q = await drainGetQueue();
  const carry = [{
    k: item.k, label: item.label || '', scenario: item.scenario, plat: item.plat || 'xhs',
    passId: item.passId || '', passLabel: item.passLabel || '', at: Date.now(), note: String(note || ''),
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
  const bk = (q.blocked && q.blocked.day === dayKey) ? q.blocked : { day: dayKey, rows: [] };
  const prev = (bk.rows || []).find(x => _drainQHit(x, item.k, item.scenario, item.plat, item.passId));
  const n = (prev ? Number(prev.n) || 0 : 0) + 1;
  const row = {
    k: item.k, label: item.label || '', scenario: item.scenario, plat: item.plat || 'xhs',
    passId: item.passId || '', passLabel: item.passLabel || '',
    why: String(why || '跑不起来'), at: Date.now(), n,
  };
  const rows = [row].concat((bk.rows || []).filter(x => !_drainQHit(x, item.k, item.scenario, item.plat, item.passId)));
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
/* 今天标红的那些（派生队列时跳过，别反复撞同一堵墙） */
function drainQBlockSet(q, now) {
  const bk = (q && q.blocked) || {};
  if (String(bk.day || '') !== _drainDayKey(now)) return new Set();
  return new Set((bk.rows || []).map(x => _drainQKey(x.k, x.scenario, x.plat, x.passId)));
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
      // 同城异业：在别家行业评论区找本地家长；招生的帖子在评论前就跳过了，这里只看自己评论还在不在
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
let _cfgSec = 'run';  // 配置页三张卡哪张展开：run 跑什么（词池＋盯的账号）/ daily 日常浏览 / goal 推广目标
const _dbDetOpen = { round: false, social: false };  // 🌿 日常浏览里两个折叠块（一轮怎么刷 / 顺手互动）的展开状态，切 tab 重渲染后照旧
let _lastScanInfo = null;   // 本轮扫描结果 { text, warn }：配置页顶栏下方那行 / 笔记池的提示行
/* 表格里类型下拉的短标签（列窄，完整名放进 title） */
const DRAIN_TYPE_SHORT = { latest: '本地泛搜', top: 'TOP', local: '同城本业', pain: '咨询帖', cross: '同城异业', rival: '同行', highv: '大V' };

/* ── 🎯 推广目标（配置页最下面那张卡，2026-09-25 从「账号规划 → 基础配置」搬来）──
   guide=null 表示要用户自己填去向；存 product.promoGoal / product.guideText，
   后台的引导规则与截流评论承接读的就是这两个字段，这里只换了个改的地方 */
const SX_GOAL_DEFS = [
  { k: 'tool', name: '🛠️ 工具/应用引流（引导对方去用你的产品，如小程序 / App / 网站）', guide: null },
  { k: 'brand', name: '🏷️ 品牌推广（只卖品牌价值，不引流）', guide: '' },
  { k: 'profile', name: '👤 个人主页引流（涨粉 / 把人沉淀到自己主页）', guide: '个人主页（点头像进入）' },
];
/* 推广目标简化后（2026-10-01）的两个输入框：label + 输入框，读 product 对应字段 */
const SX_GOAL_FIELD = (prod, label, id, field, placeholder, maxlen) =>
  '<div style="display:flex;align-items:center;gap:8px;margin-top:8px;">' +
  '<label for="' + id + '" style="font-size:12px;color:#374151;flex:none;width:88px;">' + label + '</label>' +
  '<input class="sx-in" id="' + id + '" maxlength="' + maxlen + '" placeholder="' + escAttr(placeholder) + '" ' +
  'value="' + escAttr((prod && prod[field]) || '') + '" style="flex:1;min-width:0;margin:0;box-sizing:border-box;">' +
  '</div>';
/* 读写 product：本文件也被 background.js importScripts（SW 里没有 window），一律走 typeof 守卫 */
async function _sxReadProduct() {
  try {
    const cfg = (typeof readConfigPlain === 'function')
      ? await readConfigPlain()
      : (((await chrome.storage.local.get('config')).config) || {});
    return cfg.product || {};
  } catch (_) { return {}; }
}
async function _sxSaveProduct(patch) {
  const cfg = (typeof readConfigPlain === 'function')
    ? await readConfigPlain()
    : (((await chrome.storage.local.get('config')).config) || {});
  cfg.product = Object.assign({}, cfg.product || {}, patch);
  const locked = (typeof DataPrivacy !== 'undefined' && DataPrivacy.lockConfig) ? await DataPrivacy.lockConfig(cfg) : cfg;
  await chrome.storage.local.set({ config: locked });
}

/* ⚙️ 配置：队列页的一个横签（三张卡：跑什么 / 日常浏览 / 推广目标·承接）。
   统一走 renderScenarioDrain(container,'cfg')，任务配置那个独立二级页 2026-10-24 已并进队列页 */

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
function _stratActTxt(s, pb, growth) {
  if (pb.send === 'none') return '只在评论区找有商机的人收进获客清单、去私信跟进——绝不评论、不惊动对方';
  const head = (s === 'highv') ? '在头部博主的笔记下' : '对笔记';
  let t;
  if (s === 'latest') t = '点赞一轮涨够 ' + growth + ' 就' + head + '发一条露脸评论抢前排';
  else if (s === 'local') t = '以本地人身份' + head + '评一条；同行/机构的招生帖不留言、只收人';
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
      '<td class="s-t">' + _drainQTxt(_stratActTxt(s, pb, growth)) + '</td></tr>';
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
      : (perRound > 0 ? '每次搜索最多 <b class="strat-n">' + perRound + '</b> 篇' : '每次搜索默认最多 <b class="strat-n">3</b> 篇');
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
      presetTxt + '每次搜索最多打开 <b>' + (perRound > 0 ? perRound + ' 篇' : '3 篇（默认）') + '</b>' +
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
async function renderBenchQueueBar() {
  const host = document.getElementById('benchQueueBar');
  const sumEl = document.getElementById('bqSummary');
  const bodyEl = document.getElementById('queueBody');
  const capsEl = document.getElementById('queueCaps');
  if (!host || !sumEl || !bodyEl) return;
  const now = Date.now();
  const cfg = await drainGetScanCfg();
  const q = await drainGetQueue();
  const p = drainQueuePlan(cfg, q, now, await drainDailyCtx());
  const d0 = new Date(now);
  const dayKey = d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') + '-' + String(d0.getDate()).padStart(2, '0');
  const tpKeys = (q.todayPlan && q.todayPlan.day === dayKey && q.todayPlan.keys.length) ? q.todayPlan.keys : [];
  const rank = (it) => { const i = tpKeys.indexOf(_drainQKey(it.k, it.scenario, it.plat, it.passId)); return i < 0 ? 1e9 : i; };
  const keyOf = (it) => _drainQKey(it.k, it.scenario, it.plat, it.passId);
  const runKey = p.running ? keyOf(p.running) : '';
  const today0 = d0.toDateString();
  const doneToday = (q.done || []).filter(x => new Date(x.at).toDateString() === today0);
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
  const badN = (p.blocked || []).length + (p.noCity || []).length;
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
  }
  /* 配置中途改过：今天这份清单已经锁住了，照原样跑；只提示一句，不重排 */
  const cfgChanged = !!(q.todayPlan && q.todayPlan.day === dayKey && q.todayPlan.sig && q.todayPlan.sig !== drainCfgSig(cfg));
  if (cfgChanged) {
    sum += '<span style="display:block;font-size:11.5px;color:#b45309;font-weight:600;margin-top:2px;">⚠️ 配置改过了：今天这趟照原样跑，明天按新的排</span>';
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
  const _redRows = (p.blocked || []);
  const _cityRows = (p.noCity || []);
  const _redHtml = (_redRows.length || _cityRows.length)
    ? '<div style="margin-top:10px;border-top:1px dashed #fca5a5;padding-top:8px;">'
      + '<div style="font-size:11.5px;font-weight:700;color:#b91c1c;margin-bottom:4px;">🔴 这些次搜索今天跑不了，等你处理（' + (_redRows.length + _cityRows.length) + ' 次）</div>'
      + _redRows.map(x => '<div style="display:flex;align-items:center;gap:8px;font-size:11.5px;padding:3px 0;flex-wrap:wrap;">'
          + '<span style="color:#dc2626;font-weight:600;">' + escHtml(_bkName(x)) + '</span>'
          + '<span style="color:#9ca3af;">· ' + escHtml(_bkType(x)) + (x.plat === 'dy' ? '（抖音）' : '') + '</span>'
          + '<span style="color:#dc2626;flex:1;min-width:120px;">' + escHtml(x.why || '跑不起来') + (Number(x.n) > 1 ? '（今天第 ' + Number(x.n) + ' 次）' : '') + '</span>'
          + '<button type="button" class="btn btn-sm" data-bq-retry="' + escAttr(x.k) + '" data-bq-sc="' + escAttr(String(x.scenario || '')) + '" data-bq-plat="' + escAttr(x.plat || 'xhs') + '" data-bq-pass="' + escAttr(x.passId || '') + '" data-bq-plabel="' + escAttr(x.passLabel || '') + '" title="撤掉标红，让它重新排队">再试一次</button>'
        + '</div>').join('')
      + _cityRows.map(x => '<div style="display:flex;align-items:center;gap:8px;font-size:11.5px;padding:3px 0;flex-wrap:wrap;">'
          + '<span style="color:#dc2626;font-weight:600;">' + escHtml(x.k) + '</span>'
          + '<span style="color:#9ca3af;">· ' + escHtml(_bkType(x)) + '</span>'
          + '<span style="color:#dc2626;flex:1;min-width:120px;">这一类的搜法要带属地，可城市还没填</span>'
          + '<span style="color:#9a3412;">到「📊 诊断」页的「同城挡位 &amp; 城市」填一下就好</span>'
        + '</div>').join('')
      + '</div>'
    : '';
  bodyEl.innerHTML = _stopTxt + (items.length
    ? bodyHtml
    : '<div class="bq-empty">' + (wordsOn.length || (cfg.accounts || []).length
      ? '今天没有排到点的搜索' + (p.waiting.length ? ' · 计划里还有 ' + p.waiting.length + ' 次搜索' : '')
      : '还没配关键词<br><a href="#" id="bqToCfg2">去队列页加词</a>') + '</div>') + _redHtml;

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
  const st = { scenario: 'all', showDead: true, busyGrab: false, growthDelta: 50 };
  const scanLabel = isCfg ? '🔍 按这套扫一轮' : '🔍 扫描一轮';

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
      /* 数据列：点赞 / 评论 / 二级评论 各占一列（三列一共 158px，与原来一行写完一样宽，不动笔记列）；
         没采集过每格一个「—」，鼠标停上去看表头说明 */
      .sx-table .sx-t-num{width:48px;text-align:right;font-size:11.5px;color:#374151;font-variant-numeric:tabular-nums;}
      .sx-table .sx-t-num.sx-t-sub{width:62px;}
      .sx-nums-empty{color:#c7ccd4;font-size:11px;}
      .sx-table .sx-t-judge{width:106px;}
      .sx-table .sx-t-ops{width:62px;text-align:center;}
      .sx-col-note a{display:block;color:#1f2937;text-decoration:none;font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .sx-col-note a:hover{color:var(--c-brand-text);}
      .sx-sub{font-size:10px;color:#8a8f99;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      /* 笔记列元信息行：作者/时间 + 行末的 ✕（操作列只留「打开」，移除收进这一行） */
      .sx-sub-row{display:flex;align-items:center;gap:6px;}
      .sx-sub-tx{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .sx-row-del{flex:0 0 auto;border:0;background:none;padding:0 2px;font-size:11px;line-height:1;color:#c7ccd4;cursor:pointer;}
      .sx-row-del:hover{color:#d32f2f;}
      /* 打开：跳到工作台打开这篇（每行唯一的动作） */
      .sx-open{font-size:11px;font-weight:600;padding:3px 9px;border:1px solid var(--c-brand-line);background:var(--c-brand-soft);color:var(--c-brand-ink);border-radius:6px;cursor:pointer;}
      .sx-open:hover{background:var(--c-brand-soft2);border-color:var(--c-brand-line);}
      .sx-ico{border:1px solid #e5e7eb;background:#fff;border-radius:6px;width:22px;height:22px;font-size:11px;line-height:1;padding:0;cursor:pointer;color:#4b5563;}
      .sx-ico+.sx-ico{margin-left:3px;}
      .sx-ico:hover{border-color:var(--c-brand);color:var(--c-brand-text);}
      .sx-ico-del:hover{border-color:#d32f2f;color:#d32f2f;}
      /* 🎯 玩法排班（2026-11-04）：一张五列表——玩法 / 周几跑 / 评论策略 / 出词策略 / 今天 */
      .pbp-table{width:100%;min-width:860px;border-collapse:collapse;table-layout:fixed;}
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
      .pbp-todaycell .pbp-tag{border-radius:20px;padding:0 8px;border:1px solid #eceef0;background:#f6f8fa;color:#6b7280;display:inline-block;line-height:1.8;}
      .pbp-todaycell .pbp-tag.on{background:#ecfdf5;border-color:#a7f3d0;color:#047857;}
      .pbp-todaycell .pbp-tag.off{background:#fff7ed;border-color:#fed7aa;color:#9a3412;}
      .pbp-weekcard-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;}
      .pbp-weekcard-h .t{font-size:12.5px;font-weight:700;color:#1f2937;white-space:nowrap;}
      .pbp-weekcard-h .x{font-size:11px;color:#9ca3af;}
      .pbp-weekwrap{overflow-x:auto;}
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
        <span style="flex:1;"></span>
        <span style="position:relative;display:inline-flex;align-items:center;">
          <button type="button" class="btn btn-sm" id="replRun" title="把本轮没打开的池内笔记回看一遍、刷新指标">🔁 补开未打开</button>
          <button type="button" class="btn btn-sm" id="replCfgBtn" title="补开设置：自动补开开关、点赞增量阈值" style="padding:4px 7px;margin-left:-1px;">⚙︎</button>
          <div id="replPop" style="display:none;position:absolute;right:0;top:32px;z-index:40;width:280px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 10px 26px rgba(16,24,40,.14);padding:10px 12px;text-align:left;">
            <div style="font-weight:700;font-size:12px;color:#1f2937;margin-bottom:6px;">🔁 补开设置</div>
            <div id="replPopBody"></div>
          </div>
        </span>
        <button type="button" class="btn btn-sm" id="sxAdd">＋ 加笔记</button>
        <button type="button" class="btn btn-sm btn-primary" id="sxScan">${scanLabel}</button>
      </div>
      <div class="sx-hint" id="sxSrcLine" style="margin:0 0 8px;"></div>
      <div class="sx-hint" id="sxScanNote" style="display:none;margin:-4px 0 8px;white-space:pre-line;color:#d97706;"></div>
      <div id="sxAddRow" style="display:none;border:1px solid #eef0f3;border-radius:10px;padding:8px 10px;margin-bottom:8px;">
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
          <button type="button" class="btn btn-sm" id="sxGrab">📥 抓当前笔记入列</button>
          <button type="button" class="btn btn-sm" id="sxRefreshAll">🔄 刷新当前页判断</button>
        </div>
        <input class="sx-in" id="sxUrl" placeholder="粘贴笔记链接后回车加入（当前类型）" style="width:100%;box-sizing:border-box;margin:0;">
      </div>
      `}
      <div id="sxList"></div>
      ${isCfg ? '' : `
      <details class="sx-logs" id="sxWaterFold" style="display:none;">
        <summary>💬 评论记录 <span class="sx-logs-n" id="sxWaterN"></span></summary>
        <div id="sxWaterBody"></div>
      </details>
      <details class="sx-logs" id="sxAwHistFold" style="display:none;">
        <summary>💧 灌水历史 <span class="sx-logs-n" id="sxAwHistN"></span></summary>
        <div id="sxAwHistBody"></div>
      </details>`}
    </div>
  `;

  /* ---- 批量页：两张卡（🔎 跑什么 / 🎯 推广目标·承接）＋顶部这一周怎么跑 ---- */
  const renderScanCfg = async () => {
    const r = await chrome.runtime.sendMessage({ action: 'drainGetScanCfg' });
    /* 网页版的 drainGetScanCfg 是转发给服务器的，回来的可能还是没归一的老配置（v6 的词没有 types）；
       不先归一，底下的「未挂玩法」会拿原始词去算，把明明挂着玩法的词也列出来 */
    const cfg = _drainNormalizeScanCfg((r && r.ok && r.cfg) || {});
    const panel = _sel('sxScanCfgPanel');
    if (!panel) return;
    // 这一页现在只剩「跑什么 / 推广目标」两张卡（日常浏览搬去队列页那个 ▾ 弹窗了）
    if (_cfgSec !== 'run' && _cfgSec !== 'goal') _cfgSec = 'run';
    const sec = _cfgSec;
    const max = await drainPoolMax();
    /* 话术的「让 AI 改」要按这个账号的人设写：人设存在 config 里（账号设置），不另存一份 */
    let personaText = '';
    try {
      const st = await chrome.storage.local.get('config');
      const c0 = (st && st.config) || {};
      personaText = String((c0.persona && c0.persona.text) || '').trim();
    } catch (_) {}
    const run = cfg.typeRun || DRAIN_TYPE_RUN_DEFAULT;
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
            <div class="kwp-tag">${escHtml(def.tag || '')}</div>
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
          <button type="button" class="btn btn-sm" data-kwai="${s}" title="${escAttr('按「' + def.label + '」的出词策略找一批词（上面排班表第四列那句），勾完只进这个玩法')}">✨ 找词</button>
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
    /* ── 🎯 玩法排班卡（2026-11-02）：一个玩法一行，周一到周日七个开关＋每天挑几个词＋评论里怎么提店 ── */
    const WK_SHORT = ['日', '一', '二', '三', '四', '五', '六'];
    const pbAcctN = (s) => (cfg.accounts || []).filter(a => a && a.on !== false && drainScenarioId(a.scenario) === s).length;
    const pbStoreTip = '评论 / 私信里怎么提店：不提＝只聊事；只提身份＝说自己是做这行的；可报店名＝对方问起可以报名字。公开评论区一律不许主动报店名，这条写死在评论策略里。';
    /* 出词策略那一格显示的那句：自己写的优先，没写就是内置那句（后面挂个「内置」小标） */
    const wrTxHtml = (s, custom) => {
      const full = String(custom || '').trim() || drainAiKeywordRule(s, cfg.city);
      return `<span class="tx" title="${escAttr(full)}"><span>${escHtml(full)}</span>${custom ? '<span class="pbp-wrsrc own">自己写的</span>' : '<span class="pbp-wrsrc">内置</span>'}</span>`;
    };
    const pbRow = (s) => {
      const def = drainScenarioDef(s);
      const p = drainPbPlan(cfg, s);
      const runs = p.days.length > 0;
      const acctN = pbAcctN(s);
      const rivalAcctN = (s === 'local') ? (cfg.accounts || []).filter(a => a && a.on !== false && drainScenarioId(a.scenario) === 'rival').length : 0;
      const t = drainPbTalkOf(cfg, s);
      const talkText = (t && String(t.text || '').trim()) || DRAIN_TALK_DEFAULT[s] || '';
      const tOpen = _drainTalkOpen === s;
      const aiOff = personaText ? '' : ' disabled title="先到「账号规划 → 基础配置」填一句介绍，才能按人设写这句"';
      /* 出词策略：自己写过就用那句，没写显示内置那句（灰、标「内置口径」），点「改」就地写 */
      const noWord = s === 'highv';
      const wrBuiltin = noWord ? '' : drainAiKeywordRule(s, cfg.city);
      const wrOwn = p.wordRule;
      const cadOff = !!(run[s] && run[s].mode === 'off');
      return `<tr class="pbp-tr">
        <td class="pbp-name" title="${escAttr((def.desc || def.label) + (rivalAcctN ? '（含盯的 ' + rivalAcctN + ' 个竞对号）' : ''))}">${def.icon} ${escHtml(def.label)}${s === 'highv' ? `<span class="pbp-sub">不出词${acctN ? ' · 盯 ' + acctN + ' 个号' : ''}</span>` : ''}</td>
        <td><span class="pbp-days">${DRAIN_WEEK_ORDER.map(d => {
          const on = p.days.indexOf(d) >= 0;
          return `<button type="button" class="pbp-day${on ? ' on' : ''}${d === todayWd ? ' today' : ''}" data-pbday="${s}|${d}" title="${escAttr(WK_LABELS[d] + (d === todayWd ? '（今天）' : '') + '：' + (on ? '跑' : '不跑') + '，点一下切换')}">${WK_SHORT[d]}</button>`;
        }).join('')}</span></td>
        <td class="pbp-talkcell">
          <div class="pbp-talkline">
            <span>💬</span>
            <span class="tx"><span data-talkline="${s}">${escHtml(talkText)}</span></span>
            <button type="button" class="pbp-talkedit" data-talkedit="${s}">${tOpen ? '收起' : '改'}</button>
          </div>
        </td>
        <td class="pbp-wrcell">${noWord
          ? '<span class="pbp-dash">不出词</span>'
          : `<div class="pbp-wrline">
              <span data-wrbox="${s}">${wrTxHtml(s, wrOwn)}</span>
              <button type="button" class="pbp-talkedit" data-wredit="${s}">${tOpen ? '收起' : '改'}</button>
            </div>`}</td>
        <td class="pbp-todaycell">${cadOff
          ? `<button type="button" class="pbp-tag off" data-pbcadoff="${s}" title="老设置里这个玩法被定成「不跑」（那一列已经撤了，点这颗恢复）">已停用 · 点这恢复</button>`
          : `<span class="pbp-tag ${runs ? (drainPbOnDay(cfg, s, now) ? 'on' : '') : 'off'}">${runs ? (drainPbOnDay(cfg, s, now) ? '今天跑' : '今天不跑') : '这周不跑'}</span>`}</td>
      </tr>
      <tr class="pbp-tedit${tOpen ? ' open' : ''}" id="talkedit-${s}"><td colspan="5"><div class="pbp-teditbox">
        <div class="hint">评论策略三句话：什么算商机 / 怎么评论 / 提不提店名。直接改，也可以说一句让 AI 改。</div>
        <textarea data-talktext="${s}" rows="4">${escHtml(talkText)}</textarea>
        <div class="storerow">
          <span>评论里提店：</span>
          <span class="pbp-storepills">${Object.keys(DRAIN_PB_STORE).map(k => `<button type="button" data-pbstore="${s}|${k}" class="${p.store === k ? 'on' : ''}" title="${escAttr(pbStoreTip)}">${DRAIN_PB_STORE[k]}</button>`).join('')}</span>
          <span class="pbp-storenote">（公开评论一律不主动报店名）</span>
        </div>
        <div class="airow">
          <span class="k">让 AI 改</span>
          <input data-talkask="${s}" placeholder="不填＝按账号人设整段重写；填了＝按这句话改"${personaText ? '' : ' disabled'}>
          <button type="button" class="btn btn-sm btn-primary" data-talkai="${s}"${aiOff}>✨ 改</button>
        </div>
        <div class="talkmsg" data-talkmsg="${s}"></div>
        <div class="talkacts">
          <button type="button" class="btn btn-sm" data-talkreset="${s}">恢复默认</button>
          <span style="flex:1;"></span>
          <button type="button" class="btn btn-sm btn-primary" data-talksave="${s}">保存</button>
          <button type="button" class="btn btn-sm" data-talkclose="${s}">收起</button>
        </div>
        ${noWord ? '' : `<div class="pbp-wrbox">
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
    const pbWeekHtml = () => {
      const wk = drainPbWeek(cfg, now);
      return `<div style="${cardBox}margin-top:10px;">
        <div class="pbp-weekcard-h">
          <span class="t">📅 周日历</span>
          <span class="sx-count">这一周每个玩法跑哪些词</span>
          <span style="flex:1;"></span>
          <span class="x">按上面的排班轮出来的，停用的词不进来</span>
        </div>
        <div class="sx-hint" style="margin:0 0 8px;line-height:1.7;">按上面排班和「每天挑几个词」轮着算出来的；停用的词不进来。手插和欠账不受排班限制。</div>
        <div class="pbp-weekwrap">
          <table class="pbp-week">
            <thead><tr><th style="width:150px;">玩法</th>${DRAIN_WEEK_ORDER.map(d => `<th${d === todayWd ? ' class="today"' : ''}>${WK_LABELS[d]}</th>`).join('')}</tr></thead>
            <tbody>${DRAIN_PB_ORDER.map(s => {
              const def = drainScenarioDef(s);
              const acctN = pbAcctN(s);
              return `<tr><td class="pbp-wk-name">${def.icon} ${escHtml(def.label)}</td>${wk[s].map(cell => {
                const words = cell.words || [];
                if (words.length) return `<td${new Date(cell.at).getDay() === todayWd ? ' class="today"' : ''}>${words.map(w => `<span class="pbp-wchip" title="${escAttr(w)}">${escHtml(w)}</span>`).join('')}</td>`;
                if (s === 'highv' && acctN && drainPbOnDay(cfg, s, cell.at)) return `<td${new Date(cell.at).getDay() === todayWd ? ' class="today"' : ''}>👤 ${acctN} 个号</td>`;
                return `<td${new Date(cell.at).getDay() === todayWd ? ' class="today"' : ''}><span class="pbp-wempty">—</span></td>`;
              }).join('')}</tr>`;
            }).join('')}</tbody>
          </table>
        </div>
      </div>`;
    };
    const pbHtml = `
      <details class="cfgcard" open style="margin-bottom:10px;">
        <summary class="cfgcard-h">
          <span class="cfgcard-t">🎯 玩法排班</span>
          <span class="cfgcard-s">${pbToday.length ? '今天跑 ' + pbToday.length + ' 个玩法' : '今天不跑'}</span>
          <span class="cfgcard-x">${pbToday.length
            ? pbToday.map(s => drainScenarioDef(s).icon + drainScenarioDef(s).label).join(' · ')
            : (pbOff.length ? pbOff.length + ' 个玩法这周没排日子' : '')}</span>
          <span class="cfgcard-chev">▾</span>
        </summary>
        <div class="cfgcard-b">
          <div class="sx-hint" style="margin:2px 0 6px;">周几排在第二列：点哪天就跑哪天。评论策略在第三列，出词策略在第四列，都点「改」就地改。「每天挑几个词」搬到下面「📚 关键词」那张表里。
            <span class="qhelp" tabindex="0" data-tip="一个词可以同时挂几个玩法（在下面词池里勾）。同一玩法里，词按词池顺序轮着来：今天挑前 N 个，下次排上就接着往下挑，几天转完一圈。手插和欠账不受排班限制。">?</span>
          </div>
          <div class="pbp-scroll">
            <table class="pbp-table">
              <colgroup><col style="width:116px;"><col style="width:214px;"><col><col style="width:230px;"><col style="width:98px;"></colgroup>
              <thead><tr><th>玩法</th><th>周几跑（点一下切换）</th><th>评论策略（怎么说话）</th><th>出词策略（找词按这句）</th><th>今天</th></tr></thead>
              <tbody>${DRAIN_PB_ORDER.map(pbRow).join('')}</tbody>
            </table>
          </div>
        </div>
      </details>`;
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
      <div class="sx-hint" style="margin:7px 0 0;">跑哪天、评论怎么说、找词按哪句，在上面「🎯 玩法排班」里按玩法排；这里只管「这个玩法底下有哪些词」和「每天挑几个」。玩法排上、今天又轮到 → 才进工作台那条队列；想整个停掉一个玩法，回上面把周几全部取消勾选。</div>
    `;
    /* 队列页＝配置台：顶上那两行灰字（正在跑指路 + 今天/明天排几次）2026-11-04 老板撤了；
       改完的回音还在——每存一次，右上角报一句「今天 N 次搜索（N 个词）」（save 里那段）。 */
    panel.innerHTML = `
      ${pbHtml}
      <div style="${cardBox}">${kwHtml}</div>
      ${pbWeekHtml()}
    `;

    /* 🎯 玩法排班：周几开关 / 每天几个词 / 提店口径，改哪一条就存哪一条 */
    const pbSave = async (s, patch, msg) => {
      const nextPb = Object.assign({}, cfg.pbPlan || {});
      nextPb[s] = drainPbPlanNorm(Object.assign({}, drainPbPlan(cfg, s), patch), s);
      const r = await save({ pbPlan: nextPb }, true);
      if (!r || r.ok === false) {
        drainToast('没存上：' + ((r && r.error) || '服务器没回话'), 'warn');
        return false;
      }
      if (msg) drainToast(msg);
      return true;
    };
    panel.querySelectorAll('[data-pbday]').forEach(b => b.onclick = () => {
      const p = b.getAttribute('data-pbday').split('|');
      const s = p[0], d = Number(p[1]);
      const cur = drainPbPlan(cfg, s);
      const days = cur.days.slice();
      const i = days.indexOf(d);
      if (i >= 0) days.splice(i, 1); else days.push(d);
      days.sort((a, b) => a - b);
      const def = drainScenarioDef(s);
      pbSave(s, { days }, `${def.icon}${def.label}：` + (days.length ? days.map(x => WK_LABELS[x]).join('、') : '这周不跑'));
    });
    panel.querySelectorAll('[data-pbper]').forEach(inp => inp.onchange = () => {
      const s = inp.getAttribute('data-pbper');
      const n = Math.max(1, Math.min(20, parseInt(inp.value, 10) || 1));
      inp.value = n;
      const def = drainScenarioDef(s);
      pbSave(s, { perDay: n }, `${def.icon}${def.label}：每个排上的日子挑 ${n} 个词`);
    });
    /* 提店口径（2026-11-03）：并进「改」展开块里，点一下存一下；不整页重绘，免得正在改的话术被刷掉 */
    panel.querySelectorAll('[data-pbstore]').forEach(btn => btn.onclick = async () => {
      const kv = btn.getAttribute('data-pbstore').split('|');
      const s = kv[0], k = kv[1];
      const def = drainScenarioDef(s);
      const nextPb = Object.assign({}, cfg.pbPlan || {});
      nextPb[s] = drainPbPlanNorm(Object.assign({}, drainPbPlan(cfg, s), { store: k }), s);
      const r = await chrome.runtime.sendMessage({ action: 'drainSaveScanCfg', cfg: Object.assign({}, cfg, { pbPlan: nextPb }) });
      if (!r || r.ok === false) { drainToast('没存上：' + ((r && r.error) || '服务器没回话'), 'warn'); return; }
      cfg.pbPlan = nextPb;
      panel.querySelectorAll(`[data-pbstore^="${s}|"]`).forEach(b => b.classList.toggle('on', b.getAttribute('data-pbstore') === s + '|' + k));
      drainToast(`${def.icon}${def.label}：评论里「${DRAIN_PB_STORE[k]}」`);
    });
    /* 排班行「今天」列的老停用标记：点一下把这个玩法的节奏恢复成默认（那一列的入口 2026-11-04 撤了） */
    panel.querySelectorAll('[data-pbcadoff]').forEach(b => b.onclick = () => {
      const s = b.getAttribute('data-pbcadoff');
      const nextRun = Object.assign({}, cfg.typeRun || DRAIN_TYPE_RUN_DEFAULT);
      nextRun[s] = _drainRunNorm(DRAIN_TYPE_RUN_DEFAULT[s] || { mode: 'each' });
      save({ typeRun: nextRun });
    });

    /* 出词策略（2026-11-04 老板加）：写在排班行右边那一格，存进 pbPlan[玩法].wordRule；
       找词时后端优先用这句，空着才用内置那句。存完不整页重绘——展开块还开着，接着改。 */
    const wrMsg = (s, txt, cls) => {
      const el = panel.querySelector('[data-wrmsg="' + s + '"]');
      if (el) { el.className = 'wrmsg' + (cls ? ' ' + cls : ''); el.textContent = txt || ''; }
    };
    panel.querySelectorAll('[data-wredit]').forEach(b => b.onclick = () => talkToggle(b.getAttribute('data-wredit'), 'wr'));
    panel.querySelectorAll('[data-wrreset]').forEach(b => b.onclick = () => {
      const ta = panel.querySelector('[data-writext="' + b.getAttribute('data-wrreset') + '"]');
      if (ta) ta.value = '';
      wrMsg(b.getAttribute('data-wrreset'), '框里空着＝用下面那句内置口径，点「保存出词策略」才生效。');
    });
    panel.querySelectorAll('[data-wrsave]').forEach(b => b.onclick = async () => {
      const s = b.getAttribute('data-wrsave');
      const ta = panel.querySelector('[data-writext="' + s + '"]');
      const txt = drainPbWordRuleNorm(ta ? ta.value : '');
      if (txt.length < 6) { wrMsg(s, '太短了 AI 抓不住：至少写一句怎么说词（如「都要带杭州、别出机构名」）。', 'err'); return; }
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
      panel.querySelectorAll('[data-talkedit],[data-wredit]').forEach(b => { b.textContent = '改'; });
      if (open) {
        box.classList.add('open');
        panel.querySelectorAll(`[data-talkedit="${s}"],[data-wredit="${s}"]`).forEach(b => { b.textContent = '收起'; });
        _drainTalkOpen = s;
        const ta = _talkEl(s, from === 'wr' ? 'data-writext' : 'data-talktext');
        if (ta) ta.focus();
      } else {
        _drainTalkOpen = null;
      }
    };
    panel.querySelectorAll('[data-talkedit],[data-talkclose]').forEach(b => b.onclick = () => {
      talkToggle(b.getAttribute('data-talkedit') || b.getAttribute('data-talkclose'));
    });
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
      if (ta) ta.value = DRAIN_TALK_DEFAULT[s] || '';
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

    // 补开弹窗内容 / 上次扫描那行：每重渲染一次就得重挂一次
    await renderReplCfg();
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

  /* ---- 扫描一轮 ---- */
  async function runScan() {
    const btn = _sel('sxScan');
    btn.disabled = true; btn.textContent = '⏳ 扫描中(后台开小红书页)...';
    try {
      const r = await chrome.runtime.sendMessage({ action: 'drainScan' });
      if (r && r.ok && r.ordered) {
        // 公网版：扫描这活派给执行器，它在那台机器上开小红书页逐词扫；结果不回网页这头
        drainToast('📤 已派给执行器扫一轮——进度点右上角执行器按钮看 / 工作台日志', 'ok');
      } else if (r && r.ok) {
        const s = r.summary || {};
        drainToast(`扫描完成：新${s.foundNew} 并入获客${s.imported || 0} 补开${s.backfilled}（共${s.total}）`);
        notes.length = 0; notes.push(...await drainLoad());
        // 扫描结果留一份：没扫到新笔记时把来源明细写出来（笔记池/任务配置各有落点），方便定位
        const warn = !s.foundNew;
        _lastScanInfo = {
          text: warn
            ? '⚠️ 本次未发现新笔记。来源明细：\n' + ((s.detail || []).map(d => `${d.term}: ${d.got}篇${d.err ? ' [' + d.err + ']' : ''}`).join('\n') || '(无来源)') + (s.note ? '\n' + s.note : '')
            : `本次扫描：新${s.foundNew} 刷${s.refreshed} 补${s.backfilled} 共${s.total}`,
          warn,
        };
        const sv = _sel('sxScanNote');
        if (sv) {
          sv.textContent = _lastScanInfo.text;
          sv.style.whiteSpace = 'pre-line';
          sv.style.color = warn ? '#d97706' : '';
          sv.style.display = '';
        }
        await renderScanCfg();
      } else {
        drainToast('扫描失败：' + ((r && r.error) || '未知'), 'error');
      }
    } catch (e) { drainToast('扫描失败：' + (e.message || e), 'error'); }
    btn.disabled = false; btn.textContent = scanLabel;
    render(); await refreshSrcLine();
  }

  // 🔍 扫描一轮只在笔记池的顶栏上有；配置页（三张卡）没有这颗按钮
  const scanBtn = _sel('sxScan');
  if (scanBtn) scanBtn.onclick = runScan;
  // ＋ 加笔记：抓当前页 / 粘贴链接（按需展开）
  const addBtn = _sel('sxAdd');
  if (addBtn) addBtn.onclick = () => {
    const row = _sel('sxAddRow');
    row.style.display = row.style.display === 'none' ? 'block' : 'none';
  };

  /* ---- 补开的两个旋钮（开关 + 点赞阈值）收在顶栏「⚙︎」小弹窗里：主页面不再铺这一块 ----
     节奏不单独配（2026-09-25）：跟「关键词池」表头那列是同一套——表头设「不跑」＝这一类不补，
     其余按内置默认走（最新/本地 24 小时内回看、TOP 8 小时、求助 6 小时、竞对 12 小时） */
  const renderReplCfg = async () => {
    const r = await chrome.runtime.sendMessage({ action: 'drainGetReplenishCfg' });
    const repl = (r && r.ok && r.repl) || {};
    const body = _sel('replPopBody');
    if (!body) return;
    st.growthDelta = Number(repl.growthDelta) > 0 ? Number(repl.growthDelta) : 50;
    body.innerHTML = `
      <label style="display:flex;align-items:flex-start;gap:6px;font-size:12px;color:#374151;line-height:1.6;cursor:pointer;">
        <input type="checkbox" id="replEnabled" ${repl.enabled !== false ? 'checked' : ''} style="margin:3px 0 0;">
        <span>启用自动补开<span class="qhelp r" tabindex="0" data-tip="每轮跑完，自动回看本轮没打开的池内笔记：涨势够的标成「去评论」，到点还没打开的淘汰。">?</span></span>
      </label>
      <div style="font-size:12px;color:#374151;margin-top:8px;">🆕 点赞增量阈值<span class="qhelp r" tabindex="0" data-tip="一轮涨够这么多赞，就把它标成「去评论」。回看节奏跟「关键词池」表头那列同一套：表头设「不跑」＝这类整类不补，其余按内置默认（最新 / 本地 24 小时内，TOP 8 小时，求助 6 小时，竞对 12 小时）。">?</span>
        <input id="replGrowth" type="number" min="1" value="${st.growthDelta}" style="width:56px;margin:0 0 0 2px;padding:3px 6px;border:1px solid #e5e7eb;border-radius:6px;"> 赞
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:10px;">
        <button type="button" class="btn btn-sm btn-primary" id="replSave">保存</button>
        <span class="sx-count" id="replLast"></span>
      </div>`;
    _sel('replSave').onclick = async () => {
      await chrome.runtime.sendMessage({ action: 'drainSaveReplenishCfg', repl: {
        enabled: _sel('replEnabled').checked,
        growthDelta: parseInt(_sel('replGrowth').value, 10) || 50,
        lastReplenishAt: repl.lastReplenishAt, lastReplenishSummary: repl.lastReplenishSummary,
      } });
      drainToast('已保存');
      const pop = _sel('replPop'); if (pop) pop.style.display = 'none';
    };
    const sm = repl.lastReplenishSummary;
    if (sm) _sel('replLast').textContent = `上次：开${sm.opened} 淘汰${sm.expired} 失败${sm.failed}`;
  };

  /* ---- 补开本轮未打开 ---- */
  const runReplenish = async (fromAuto) => {
    const btn = _sel('replRun');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 补开中...'; }
    try {
      const r = await chrome.runtime.sendMessage({ action: 'drainReplenish', round: true, force: true });
      if (r && r.ok && r.ordered) {
        drainToast('📤 已派给执行器补开未打开——进度点右上角执行器按钮看 / 工作台日志', 'ok');
      } else if (r && r.ok && r.busy) {
        drainToast('补开正在进行中，稍等…', 'info');
      } else if (r && r.ok) {
        const s = r.summary || {};
        drainToast(`补开完成：开${s.opened} 跳${s.skipped} 淘汰${s.expired} 失败${s.failed}`);
        notes.length = 0; notes.push(...await drainLoad());
      } else {
        drainToast('补开失败：' + ((r && r.error) || '未知'), 'error');
      }
    } catch (e) { drainToast('补开失败：' + (e.message || e), 'error'); }
    if (btn) { btn.disabled = false; btn.textContent = '🔁 补开未打开'; }
    render(); await renderReplCfg();
  };
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
    if (!cfg) { box.innerHTML = ''; return; }
    const pool = (cfg.keywords || []);
    const onN = pool.filter(e => e.on !== false).length;
    let due = 0;
    try { due = drainBuildSources(cfg).length; } catch (_) {}
    box.innerHTML = `📚 词池 ${onN}/${pool.length} 个启用 · 本轮到点 <b style="color:var(--c-brand-text);">${due}</b> 个来源
      ${due ? '' : '<span style="color:#d97706;margin-left:6px;">（还没到点：可在「队列 → ⚙️ 配置」把要跑的类型改成「每轮跑」）</span>'}`;
  }

  /* 顶栏「🔁 补开未打开」+ 它右边的「⚙︎」小弹窗（自动补开开关 / 点赞增量阈值）
     这两颗在笔记池的顶栏上（2026-10-24 从任务配置顶栏搬来），配置页和列表页都要挂 */
  const replRunBtn = _sel('replRun');
  if (replRunBtn) replRunBtn.onclick = () => runReplenish();
  const replCfgBtn = _sel('replCfgBtn');
  if (replCfgBtn) replCfgBtn.onclick = () => { const p = _sel('replPop'); if (p) p.style.display = p.style.display === 'none' ? '' : 'none'; };

  if (isCfg) {
    await renderScanCfg();   // 里面顺带重挂补开弹窗内容 / 上次扫描那行
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
  /* 💧 灌水历史（原「灌水规则」页尾的表，那页 2026-09-25 并进拟人化与触达）：同一套折叠块，点开才拉明细 */
  const awFold = _sel('sxAwHistFold');
  if (awFold && typeof renderWaterHistory === 'function') {
    awFold.style.display = '';
    const hBody = _sel('sxAwHistBody');
    const hNum = _sel('sxAwHistN');
    const paintHistN = async () => {
      if (!hNum || typeof waterHistoryCountLabel !== 'function') return;
      try { hNum.textContent = await waterHistoryCountLabel(); } catch (_) {}
    };
    await paintHistN();
    awFold.addEventListener('toggle', () => {
      if (!awFold.open) return;
      if (hBody) renderWaterHistory(hBody);
      paintHistN();
    });
  }
  // 补开弹窗内容（「🔁 补开未打开」和它右边的 ⚙︎ 现在挂在笔记池顶栏上，进页就得先画好）
  await renderReplCfg();

  function render() {
    if (isCfg) return;   // 配置页没有列表 DOM：扫描/补开回调里调 render 时直接跳过
    const lst = notes.filter(n => (st.scenario === 'all' || n.scenario === st.scenario));
    const byType = SCENARIO_DRAIN.map(s => ({ s, n: notes.filter(x => drainScenarioId(x.scenario) === s.scenario).length })).filter(x => x.n > 0);
    const deadN = notes.filter(x => x.dead).length;
    _sel('sxCount').textContent = `共 ${notes.length} 篇` + (byType.length > 1 ? '（' + byType.map(x => x.s.icon + x.n).join(' ') + '）' : '') + ` · 当前 ${lst.length} 篇` + (deadN ? ` · ⛔作废 ${deadN} 篇` : '');
    if (!lst.length) { _sel('sxList').innerHTML = '<div class="sx-empty">列表为空<br/>在「🎯 获客」里打开/分析笔记会自动入列，也可以点上方「🔍 扫描一轮」按关键词×类型扫一批，或「＋ 加笔记」手动加。</div>'; return; }
    const rowOf = (n) => {
      const s = drainScenarioDef(n.scenario);
      const pb = drainPlaybookOf(n.scenario);
      const dead = !!n.dead;
      // 作废（搜过一轮标题+作者都定位不到）：直接盖住判定标签，别再显示「去评论」误导
      const j = dead ? { verdict: '⛔ 已作废', tone: 'purple' } : drainJudge(n.scenario, n.signals || {}, { growthDelta: st.growthDelta });
      const sg = n.signals || {};
      const mc = sg.myComment;
      // 列窄：过万的数字压成「1.2万」，别把表格撑开
      const num = (v) => (v == null ? '—' : (Number(v) >= 10000 ? (Number(v) / 10000).toFixed(1).replace(/\.0$/, '') + '万' : v));
      const mcTxt = (mc && mc.found)
        ? `<span style="color:#0a8f4c;font-weight:600;">第${mc.rank || '?'}位</span>${mc.likes != null ? `<span style="color:#8a8f99;"> 👍${num(mc.likes)}</span>` : ''}`
        : (mc && mc.checked ? '<span style="color:#dc2626;">没找到</span>' : '<span style="color:#c7ccd4;">—</span>');
      const sub = [n.author ? escHtml(n.author) : '', '入列 ' + fmtTime(n.addedAt), n.lastJudgedAt ? '判于 ' + fmtTime(n.lastJudgedAt) : ''].filter(Boolean).join(' · ');
      return `
        <tr${dead ? ' style="opacity:.55;"' : ''}>
          <td class="sx-t-type">
            <select class="sx-chip-sel" data-scenario="${n.id}" style="max-width:62px;" title="笔记类型（决定评论/维护方式）：${escAttr(s.label)}">
              ${SCENARIO_DRAIN.map(d => `<option value="${d.scenario}" ${d.scenario === drainScenarioId(n.scenario) ? 'selected' : ''}>${d.icon} ${DRAIN_TYPE_SHORT[d.scenario] || d.label}</option>`).join('')}
            </select>
            <div class="sx-sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="跑法：${escAttr(pb.tip)}">${escHtml(drainPlaybookLabel(n.scenario))}</div>
          </td>
          <td class="sx-col-note">
            <a data-act="open" data-id="${n.id}" href="${escAttr(n.url || ('https://www.xiaohongshu.com/explore/' + (n.noteId || '')))}" title="在工作台打开这篇（搜标题末尾减3字 → 按作者名定位 → 点开）：${escAttr(n.title || '(无标题)')}">${escHtml(n.title || '(无标题)')}</a>
            <div class="sx-sub sx-sub-row">
              <span class="sx-sub-tx" title="${escAttr(sub)}">${sub}</span>
              <button class="sx-row-del" data-act="drop" data-id="${n.id}" title="从笔记池移除（只把这条从监控列表拿掉，不删笔记）">✕</button>
            </div>
          </td>
          <td class="sx-t-num" title="打开这篇时从评论区数到的点赞数">
            ${sg.likes == null ? '<span class="sx-nums-empty">—</span>' : num(sg.likes)}
          </td>
          <td class="sx-t-num" title="打开这篇时从评论区数到的一级评论数">
            ${sg.comments == null ? '<span class="sx-nums-empty">—</span>' : num(sg.comments)}
          </td>
          <td class="sx-t-num sx-t-sub" title="打开这篇时从评论区数到的二级评论（回复）数">
            ${sg.subComments == null ? '<span class="sx-nums-empty">—</span>' : num(sg.subComments)}
          </td>
          <td class="sx-t-judge">
            <span class="sx-judge ${j.tone}" title="${escAttr(dead ? ('已作废：' + (n.deadReason || '标题+作者都搜不到') + ' · ' + fmtTime(n.deadAt) + '（点标题可再试一次打开，成功就复活）') : j.verdict)}">${j.verdict}</span>
            <div class="sx-sub" title="我的评论（活水：还在不在前排）">我的评论 ${mcTxt}</div>
          </td>
          <td class="sx-t-ops">
            <button class="sx-open" data-act="open" data-id="${n.id}" title="在工作台打开这篇：跳到「🎯 获客 · 工作台」并加载它的评论（工作台正忙时会拦下不让开）">打开</button>
          </td>
        </tr>`;
    };
    _sel('sxList').innerHTML = `
      <table class="pl-table sx-table">
        <thead>
          <tr>
            <th class="sx-t-type">类型</th>
            <th>笔记</th>
            <th class="sx-t-num" title="打开这篇时从评论区数到的点赞数">点赞</th>
            <th class="sx-t-num" title="打开这篇时从评论区数到的一级评论数">评论</th>
            <th class="sx-t-num sx-t-sub" title="打开这篇时从评论区数到的二级评论（回复）数">二级评论</th>
            <th class="sx-t-judge">判定 · 我的评论</th>
            <th class="sx-t-ops">操作</th>
          </tr>
        </thead>
        <tbody>${lst.map(rowOf).join('')}</tbody>
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
        if (act === 'open') { ev.preventDefault(); drainOpenInWorkbench(note); return; }
        if (act === 'drop') { ev.preventDefault(); notes = notes.filter(n => n.id !== id); drainSave(notes); render(); }
      };
    });
  };

  // 抓当前页笔记（脚本读 current tab 的标题/指标）
  _sel('sxGrab').onclick = async () => {
    if (st.busyGrab) return;
    st.busyGrab = true; _sel('sxGrab').textContent = '抓取中…';
    try {
      const data = await drainGrabActiveNote();
      if (!data) { drainToast('当前不是小红书笔记页（需打开一篇 /explore/ 的笔记）', 'warn'); }
      else {
        const exists = notes.find(n => n.url === data.url);
        if (exists) { drainToast('该笔记已在监控列表'); }
        else {
          const sc = st.scenario === 'all' ? 'latest' : st.scenario;
          const sig = { likes: data.likes != null ? data.likes : null, comments: data.comments, collects: data.collects, rank: 0, delta: 0, title: data.title };
          notes.unshift({ id: _uid(), scenario: sc, url: data.url, title: data.title, author: data.author, signals: sig, addedAt: Date.now(), lastJudgedAt: Date.now() });
          await drainSave(notes);
          drainToast(`已加入 → ${drainScenarioDef(sc).label}`);
        }
      }
    } catch (e) { drainToast('抓取失败：' + (e.message || e), 'warn'); }
    st.busyGrab = false; _sel('sxGrab').textContent = '📥 抓当前笔记入列';
    render();
  };

  // 粘贴链接加入
  _sel('sxUrl').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const url = _sel('sxUrl').value.trim();
    if (!/xhs|xiaohongshu/.test(url)) { drainToast('不是小红书链接', 'warn'); return; }
    _sel('sxUrl').value = '';
    if (notes.find(n => n.url === url)) { drainToast('已在列表'); return; }
    const sc = st.scenario === 'all' ? 'latest' : st.scenario;
    notes.unshift({ id: _uid(), scenario: sc, url, title: '（待抓取标题）', signals: {}, addedAt: Date.now() });
    drainSave(notes); drainToast('已按链接加入，点「打开」在工作台里加载这篇的评论/指标'); render();
  });

  /* 工作台是不是正忙（队列在跑 / 正在扫一篇 / 有别的操作占着页面）——忙的时候别去抢页面 */
  function drainWorkbenchBusy() {
    try {
      if (window.AutoBot && window.AutoBot.running) return window.AutoBot.paused ? '队列已暂停但还占着工作台' : '队列正在跑';
      if (window.__botEngineBusy) return '自动化正在跑';
      if (window.__scanRunning) return '正在扫一篇笔记';
      const ov = document.getElementById('lockOverlay');
      if (ov && ov.style.display && ov.style.display !== 'none') {
        const t = document.getElementById('lockOverlayText');
        return (t && t.textContent) ? t.textContent.replace(/^[^\u4e00-\u9fa5]+/, '') : '有操作正在进行';
      }
    } catch (_) {}
    return '';
  }

  /* 📋 笔记列表「打开」：跳到「🎯 获客 · 工作台」并在那边打开这篇（评论也在工作台里加载，
     指标/二级评论数随这次打开回写列表）。
     工作台正忙时不抢页面：队列跑着的笔记正开着，再开一篇会把它的进度打断。 */
  async function drainOpenInWorkbench(note) {
    if (!note) return;
    if (!note.noteId && !note.title) { drainToast('这篇既没有 ID 也没有标题，打不开', 'warn'); return; }
    const busy = drainWorkbenchBusy();
    if (busy) { drainToast('工作台有任务在忙（' + busy + '），等它跑完再打开', 'warn'); return; }
    if (typeof window.switchMainTab === 'function') window.switchMainTab('comment');
    drainToast('正在工作台打开：' + String(note.title || note.noteId).slice(0, 14) + '…');
    try {
      const r = await chrome.runtime.sendMessage({
        action: 'openNote',
        note: { noteId: note.noteId || '', title: note.title || '', author: note.author || '', url: note.url || '' },
      });
      if (r && r.ok && r.ordered) {
        drainToast('📤 已派给执行器打开这篇——评论/指标在它那台加载，网页这头不碰平台', 'ok');
        return;
      }
      if (!r || !r.ok) {
        const skipped = !!(r && r.skipped);
        drainToast((skipped ? '⏭ ' : '打开失败：') + ((r && r.error) || '未知原因'), 'warn');
        return;
      }
      drainToast('已打开 → 工作台正在加载评论', 'ok');
      if (typeof window.refreshCommentAssistant === 'function') window.refreshCommentAssistant();
    } catch (e) { drainToast('打开失败：' + (e.message || e), 'error'); }
  }

  _sel('sxRefreshAll').onclick = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) { drainToast('请先把要刷新的笔记页打开为当前页', 'warn'); return; }
    const names = (typeof loadMyAccountNames === 'function') ? await loadMyAccountNames() : [];
    let hit = 0;
    for (const n of notes) {
      if (n.url.split('?')[0] === tab.url.split('?')[0]) {
        try {
          const m = await drainReadTabMetrics(tab.id);
          const prev = (n.signals && n.signals.likes) || 0;
          n.signals = Object.assign({}, n.signals, m, { delta: m.likes != null && prev != null ? (m.likes - prev) : 0 });
          if (names.length) { const mc = await drainReadMyCommentFromTab(tab.id, names); if (mc) n.signals.myComment = drainMergeMyComment(n.signals.myComment, mc); }
          n.lastJudgedAt = Date.now(); hit++;
        } catch (e) {}
      }
    }
    await drainSave(notes); render();
    drainToast(hit ? `已刷新 ${hit} 篇（当前页）` : '当前页不在列表，或读指标失败', hit ? 'ok' : 'warn');
  };

  _sel('sxFilter').onchange = (e) => { st.scenario = e.target.value; render(); };
  _drainNotesChanged = (changes, area) => {
    if (area !== 'local' || !changes[DRAIN_KEY] || !container.isConnected) return;
    notes = Array.isArray(changes[DRAIN_KEY].newValue) ? changes[DRAIN_KEY].newValue : [];
    render();
  };
  chrome.storage.onChanged.addListener(_drainNotesChanged);
  notes = await drainLoad();
  render();
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
  // 🛡 账号安全：静默期 / 单休 / 起床前 / 发布占线 → 这轮扫描不跑（自动与手动同一口径）
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
  cfg.lastScanSummary = { foundNew, refreshed, backfilled, missDiscarded, total: notes.length, at: Date.now(), detail, note, imported: importedWater };
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
  // 🛡 账号安全：静默期 / 单休 / 起床前 / 发布占线 → 这轮不补开（手动按钮也一样，会提示原因）
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
/* AI 找词按玩法出（2026-11-02）：每个玩法一套口径，别拿一套词喂所有玩法 */
function drainAiKeywordRule(scenario, city, customRule) {
  /* 老板在「玩法排班 → 出词策略」里自己写过一句就用人家那句（2026-11-04）；没写才走下面这套内置口径 */
  const own = String(customRule || '').trim();
  if (own) return own;
  const c = String(city || '').trim() || '（城市没填：先用「本地城市」占位）';
  switch (drainScenarioId(scenario)) {
    case 'latest':
      return '玩法＝本地泛搜索：出「' + c + ' + 带娃场景」的宽词（如「' + c + ' 周末带娃」「' + c + ' 幼儿园放学」），每个词都要带「' + c + '」，别带本行品类词。';
    case 'top':
      return '玩法＝TOP搜索：出全国流量的行业词、痛点词、人群词，不用带城市（如「孩子坐不住怎么办」），要能搜到高赞笔记。';
    case 'local':
      return '玩法＝同城本业：出「' + c + ' + 本行核心品类」的挑机构词（如「' + c + ' 少儿美术」「' + c + ' 美术班哪家好」），每个词都要带「' + c + '」；也可以出本地同品类的通用叫法（如「' + c + ' 儿童体能馆」），用来找到同行笔记下的人；绝不要编具体品牌名。';
    case 'pain':
      return '玩法＝咨询帖：出求助、避雷口吻的词（求推荐 / 听劝 / 哪家好 / 避雷 / 踩坑），可以不带城市；别出品牌名。';
    case 'cross':
      return '玩法＝同城异业：只出「' + c + ' + 别的行业品类」的词（如艺体之外的舞蹈、美术、口才、书法、托管），每个词都要带「' + c + '」；绝不出本行品类词。';
    case 'rival':
      return '玩法＝同行/竞对：只出「' + c + ' + 同品类机构/门店的通用叫法」5~8 个（如「' + c + ' 儿童体能馆」「' + c + ' 体适能机构」），纯名字、不带广告词；绝不要编具体品牌名——真正的同行品牌由用户自己往词池里填。';
  }
  return '';
}

/* 提店口径（2026-11-02）：每个玩法在排班卡里选「不提 / 只提身份 / 可报店名」。
   公开评论区永远不许主动报店名——「可报店名」也只到「对方问起才报」为止。 */
function drainStoreRule(store) {
  if (store === 'identity') return '【提店口径】可以在句尾自然带一句「我是做这行的 / 我就是教这个的」，让本地人知道你的身份；但绝不报店名、机构名、地址、价格、联系方式。';
  if (store === 'store') return '【提店口径】对方明确问起「哪家 / 在哪 / 多少钱」时才可以报店名；不主动报，不写价格、不写联系方式、不发链接。';
  return '【提店口径】一个字都不提自己做什么、在哪、什么店：只像一个懂行的本地人说话。';
}

/* 私信按玩法开口（2026-11-02）：同一句私信模板，来源玩法不同，开口角度也不同 */
function drainPlaybookDmRule(id) {
  const key = drainScenarioId(id);
  return {
    latest: '来源＝本地泛搜索：对方是在同城带娃笔记下留言的本地家长。开场聊本地带娃的实情，别报价、别发链接。',
    top: '来源＝TOP搜索：对方是在全国热帖下留言的人，可能不在本地。先接住他评论里的具体问题，别一上来问城市。',
    local: '来源＝同城本业：对方已经在挑机构，也可能是在同行/机构笔记评论区看到的。先给一条判断，产品只轻带一句；别主动报店名，绝不提在谁的评论区看到他。',
    pain: '来源＝咨询帖：对方在求助或避雷。先正面回答他问的那件事，再给价值；不推销、不趁机贬低同行。',
    cross: '来源＝同城异业：对方是在别家行业笔记下留言的本地家长。从孩子那个具体困扰切进来，别暴露职业。',
    rival: '来源＝同行/竞对：对方是在竞品评论区看到的精准顾客。绝不提「在某某笔记看到你」，用自己踩过的坑破冰。',
    highv: '来源＝大V：对方是在头部博主评论区留言的人。用「赞同＋本行视角」承接，别像截流。',
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

/* 同城本业合并同行后（2026-11-02）：同行/机构在招生卖课的帖子不留言，只收评论区里的人。
   固定词先挡一道、省一次 AI；没挡住的交给提示词里的 AI 再判——两边都判「能评」才评。 */
const DRAIN_SOLICIT_WORDS = ['招生', '开班', '名额有限', '课程顾问', '体验课', '预约试听', '报名咨询', '扫码加', '私信咨询'];
function drainLooksSolicit(data) {
  const blob = [data && data.noteTitle, data && data.noteContent, data && data.noteAuthor].join(' ');
  return DRAIN_SOLICIT_WORDS.some(w => blob.indexOf(w) >= 0);
}

async function handleDrainComment(data) {
  const sc = (SCENARIO_DRAIN || []).find(s => s.scenario === (data && data.scenario));
  if (!sc) throw new Error('未知截流场景: ' + (data && data.scenario));
  if (drainScenarioId(data && data.scenario) === 'local' && drainLooksSolicit(data)) {
    return { ok: true, skip: true, comment: '', scenario: data.scenario, reason: '同行/机构招生帖：只收人、不留言' };
  }
  const config = await Storage.getConfig();
  const aiCfg = Object.assign({}, config.ai || {}, { maxTokens: 900 });
  if (!aiCfg.apiKey && !aiCfg.fallbackApiKey) throw new Error('尚未配置 AI（请在设置里填 API Key）');
  const product = (config.product && config.product.name) || '本产品';
  const guide = drainResolveGuide(config);
  let store = (data && data.store) || '';
  let talkBlock = '';
  try {
    const scanCfg = await drainGetScanCfg();
    if (!store) store = drainPbPlan(scanCfg, data.scenario).store;
    // 这个玩法配好的那段话：当参考带进评论，不逐字照抄
    talkBlock = drainTalkBlock(drainPbTalkOf(scanCfg, data.scenario), data.scenario);
  } catch (_) {}
  const payload = Object.assign({}, data, {
    product, guide,
    storeRule: drainStoreRule(store),
    personaBlock: drainPersonaBlock(config),
  });
  let sysPrompt = _fillSentiment(sc.system, payload);
  if (talkBlock) sysPrompt += '\n\n' + talkBlock;
  const r = await AiClient.chatCompletion(aiCfg, sysPrompt, _fillSentiment(sc.user, payload));
  let text = String((r && r.content) || '').trim();
  text = text.replace(/^(```(?:json|text)?|"""|''')/, '').replace(/(```|"""|''')$/, '').trim();
  text = text.replace(/^["']|["']$/g, '').trim();
  // ★ 「不适合就不评」闸门：评论笔记本身的场景，AI 判断这篇/这个口吻不适合时只回「跳过」
  //   （竞对=send:'none' 生成的是私信开场白，不适用这道闸门）
  const isNoteComment = drainPlaybookOf(data.scenario).send !== 'none';
  if (isNoteComment && (!text || /^(跳过|skip|不适合评论|不评论)[。.!！?？]?$/i.test(text))) {
    return { ok: true, skip: true, comment: '', scenario: data.scenario, reason: 'AI 判断这篇笔记（或博主口吻）不适合评论' };
  }
  return { comment: text, scenario: data.scenario };
}