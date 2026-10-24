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
 *   3. 本地笔记(local)：关键词+属地，筛选「最新」。不看热度，本地刚需一律去评论。
 *   4. 求助笔记(pain)：特殊关键词（求推荐/听劝…）。走活水机制。
 *   5. 竞对(rival)：拿竞品名搜最新，只蹲人不评论；进竞品主页扒那条见「👤 盯的账号」。
 *   （高V狙击 highv 不走词：它盯着**人**——在「👤 盯的账号」里挂头部博主主页，跑的是他自己的笔记）
 *
 * 笔记进本地监控列表(drain_notes 存在 chrome.storage.local)，
 * 每行按类型判据打状态标签（数据列＝点赞/评论/二级评论）；行上只有一个动作「打开」——
 * 点了就跳「🎯 获客 · 工作台」在那边打开，评论、生成、发送、转获客都在工作台里做。
 */

const SCENARIO_DRAIN = [
  {
    scenario: 'latest',
    label: '最新笔记',
    icon: '🆕',
    tag: '最新排序 · 点赞一涨就去评论',
    desc: '关键词按「最新」搜出来的新笔记，盯着点赞增量；一发现爬坡就去评论抢前排。',
    system: `你是小红书上一个真实、有意思的普通用户，刚刷到一篇新发布的笔记，想在评论区抢个前排、露个脸。
这次不推销、不挖商机——只写一句让人会心一笑或「说到点子上」的短评。
要求：
1. 15-30 字，一句话，像随手打的；可以带 1 个表情（如 😂👀🥹🐶），别堆
2. 接住笔记里最具体的那个点：接梗 / 抖机灵 / 共鸣 / 捧场 任选一种，别写「写得真好」「学到了」这类套话
3. 不提任何产品、品牌、链接、主页、私信，也不留任何引导
4. 不要 AI 味：不用「首先/总之/建议收藏」，不堆四字词
写之前先看博主的口吻：活泼/搞笑 → 用同一挂的语气接梗；文艺/走心 → 接一句走心短句；干货/专业 → 抖个懂行的小机灵。
如果这篇是严肃/悲伤/负面/敏感内容（丧事、疾病、纠纷、投诉等），或博主明显不想被玩梗 → 只回复两个字：跳过`,
    user: `【笔记标题】{title}\n【笔记正文】{content}\n【博主】{author}\n\n这是刚发布的新笔记，我要抢前排露个脸。请写一句 15-30 字的短评（可带 1 个表情）；如果这篇不适合评论，只回复：跳过。直接返回评论文本。`,
  },
  {
    scenario: 'top',
    label: '搜索TOP笔记',
    icon: '🔥',
    tag: '点赞/评论/收藏最多 · 活水维护',
    desc: '关键词搜索排名最靠前的笔记，写极度专业的解决方案评论长期占位，定期活水维护。',
    system: `你是小红书上一个真实、懂行的老用户，刷到一篇搜索排名靠前的笔记，想留一句能被更多人看到的热评。
不推销、不写长文——一句机灵或一个别人没提到的小角度就够了。
要求：
1. 15-30 字，一句话；可以带 1 个表情，别堆
2. 抖个懂行的小机灵，或补一个别人没说的具体小点；别复读评论区里已有的话
3. 不提任何产品、品牌、链接、主页、私信
4. 不要 AI 味：不用「首先/总之/建议收藏」，不堆四字词
先看博主的口吻用同一挂的语气接：专业/干货 → 懂行的小机灵；活泼 → 接梗；走心 → 接一句走心的话。
如果这篇是严肃/悲伤/负面/敏感内容（丧事、疾病、纠纷、投诉等）→ 只回复两个字：跳过`,
    user: `【搜索关键词】{keyword}\n【笔记标题】{title}\n【笔记正文】{content}\n【博主】{author}\n\n这是搜索「{keyword}」排名靠前的笔记，我要在前排留一句露脸热评。请写一句 15-30 字的短评（可带 1 个表情）；如果这篇不适合评论，只回复：跳过。直接返回评论文本。`,
  },
  {
    scenario: 'local',
    label: '本地笔记',
    icon: '📍',
    tag: '关键词+属地 · 不看热度也评论',
    desc: '关键词加属地、按「最新」搜出来的本地新帖，注入「同在XX区」地域信任词，不看热度直接评论。',
    system: `你是本地一个真实、爱唠嗑的普通人，刷到同城的一篇笔记，想留一句本地人才会说的话，露个脸。
不推销、不挖商机。
要求：
1. 15-30 字，一句话；可以带 1 个表情，别堆
2. 自然带出本地身份（如「同在{city}」「我家就在附近」），说一句本地人才懂的：接梗 / 提醒 / 共鸣
3. 不提任何产品、品牌、链接、主页、私信
4. 不要 AI 味：不用「首先/总之/建议收藏」
如果这篇是严肃/悲伤/负面/敏感内容（丧事、疾病、纠纷、投诉等）→ 只回复两个字：跳过`,
    user: `【城市】{city}\n【地域/区】{region}\n【笔记标题】{title}\n【笔记正文】{content}\n【博主】{author}\n\n这是同城笔记，我以本地人身份留一句露脸评论（要带本地身份感）。请写一句 15-30 字的短评（可带 1 个表情）；如果这篇不适合评论，只回复：跳过。直接返回评论文本。`,
  },
  {
    scenario: 'pain',
    label: '求助笔记',
    icon: '🎯',
    tag: '求推荐/听劝 · 活水维护',
    desc: '「关键词+求推荐」这类精准求助帖，给对症解决路径，并像活水一样长期维护评论。',
    system: `你是小红书上一个热心、说话轻快的路人，刷到一条求助笔记（楼主在帖子里四处求助），想留一句既帮到楼主、又让人记住你的评论。
不推销、不发长方案——一句过来人的提醒或共鸣就够。
要求：
1. 15-30 字，一句话；可以带 1 个表情，别堆
2. 顺着楼主的具体困扰说，给一句轻松但真管用的小建议/提醒（例如提醒一个容易踩的坑）
3. 不提任何产品、品牌、链接、主页、私信
4. 不要 AI 味：不用「首先/总之/建议收藏」，不堆四字词
如果楼主的遭遇是严肃/悲伤/负面内容（重病、纠纷、投诉等）→ 只回复两个字：跳过`,
    user: `【楼主求助原话】{pain}\n【笔记标题】{title}\n【笔记正文】{content}\n【博主】{author}\n\n楼主在求助，我要留一句热心又轻快的露脸评论。请写一句 15-30 字的短评（可带 1 个表情）；如果不适合评论，只回复：跳过。直接返回评论文本。`,
  },
  {
    scenario: 'rival',
    label: '竞对笔记',
    icon: '🕵️',
    tag: '埋伏 · 只私信不评论',
    manual: false,  // 也能进配置表：把词填成竞品名、把「竞对」这一列打开，就按节奏蹲一轮
    noComment: true, // 跑法：本篇一个字都不评论
    desc: '同行/竞品的爆帖：评论区里全是精准顾客。只在评论区找有商机的人拉进获客清单去私信，绝不留评论惊动对方。',
    system: `你是小红书真人号主，正在给一位刚从同行笔记评论区看到的潜在顾客发第一条私信。我的产品={product}。
策略（埋伏式首触）：
1. 绝不提“我在某某笔记评论区看到你”（会让人觉得被盯着、像截流）
2. 用「刷到你那条评论，说的正好是我之前踩过的坑」这类自然由头破冰
3. 先给价值：一句话给出对方向题的判断/提醒，再自然带出「{product}」能帮他解决什么
4. 先给价值、不硬推销、绝不放链接/微信/二维码，承接一律用「{guide}」
5. 60-90 字，口语化真人，像随手发来的私信`,
    user: `【对方留言】{pain}\n【来自笔记】{title}\n【笔记内容】{content}\n【搜索关键词】{keyword}\n\n我要给这个在同行评论区看到的潜在顾客发第一条私信（竞对笔记不评论，只私信）。请生成一条埋伏式私信开场白（60-90 字），自然带出「{product}」，承接用「{guide}」，不放链接。直接返回私信文本。`,
  },
  {
    scenario: 'highv',
    label: '高V狙击',
    icon: '👑',
    tag: '抓溢出流量 · 借头部IP',
    manual: true, // 另一套逻辑（白名单主页来源），不参与关键词派生，以后单独做
    desc: '头部博主的最新笔记，在评论区留一句「赞同+抖机灵」的露脸热评，借头部 IP 溢出流量。',
    system: `你是小红书上一个真实的老用户，刷到一位头部博主（大V）的笔记，想在评论区借他的流量被更多人看到。
方式是：「极度赞同 + 抖个机灵」的一句热评。不推销、不提产品、不写长文。
要求：
1. 15-30 字，一句话；可以带 1 个表情，别堆
2. 先接住博主最亮的那句观点表示赞同，再补一句机灵或别人没注意到的角度
3. 不能像拍马屁；不提任何产品、品牌、链接、主页、私信
4. 不要 AI 味：不用「首先/总之/建议收藏」
如果这篇是严肃/悲伤/负面/敏感内容（丧事、疾病、纠纷等），或博主口吻明显不适合玩梗 → 只回复两个字：跳过`,
    user: `【高V笔记标题】{title}\n【高V笔记正文】{content}\n【高V作者】{author}\n\n我在头部博主评论区抢溢出流量，要留一句「赞同+抖机灵」的露脸热评。请写一句 15-30 字的短评（可带 1 个表情）；如果这篇不适合评论，只回复：跳过。直接返回评论文本。`,
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
  { scenario: 'latest', tip: '关键词 + 最新' },
  { scenario: 'top', tip: '关键词 + 点赞/评论/收藏最多' },
  { scenario: 'local', tip: '关键词 + 属地 + 最新', needCity: true },
  { scenario: 'pain', tip: '关键词 + 求助词', painWords: true },
  { scenario: 'rival', tip: '关键词（填竞品名）+ 最新：进去只蹲人不评论' },
];
/* ── 各类型的「跑法」总表（商机发现 + 评论生成 的唯一真源，机器人/列表/生成按钮都读它）──
 * send: 'note'  = 对笔记本身发一条一级评论（抢位 / 活水占位 / 本地信任）
 *       'both'  = 既对笔记发一级评论，也回复评论区里求助/同问的人
 *       'none'  = 一个字都不评论（埋伏：只把人拉进获客清单去私信）
 * find: 'commenters' = 扫评论区找商机人（拉进获客清单）；'none' = 不扫，只发自己那条评论
 * keep: '活水' 口径——发完之后靠回看（我的评论还在不在前排/多少赞）来维护，掉榜就补
 */
const DRAIN_PLAYBOOK = {
  latest: { name: '抢位', icon: '⚡', send: 'note', find: 'commenters', keep: '抢前排',
    tip: '抢前排：点赞一涨就对笔记本身发一条露脸评论占位，同时扫评论区把有商机的人收进获客清单' },
  top: { name: '活水', icon: '💧', send: 'note', find: 'commenters', keep: '活水维护',
    tip: '活水占位：对笔记本身发一条露脸评论长期占位，顺带扫评论区收商机；之后回看评论还在不在前排' },
  local: { name: '本地', icon: '📍', send: 'note', find: 'none', keep: '地域信任',
    tip: '本地信任：以本地人身份对笔记本身发一条评论，不看热度也不扫评论区' },
  pain: { name: '求助', icon: '🎯', send: 'both', find: 'commenters', keep: '活水维护',
    tip: '双向出手：对笔记发一条评论，同时回复评论区里求助/同问的人' },
  rival: { name: '埋伏', icon: '🕵️', send: 'none', find: 'commenters', keep: '私信跟进',
    tip: '埋伏：只在评论区找有商机的人拉进获客清单去私信，绝不评论、不惊动对方' },
  highv: { name: '借势', icon: '👑', send: 'note', find: 'commenters', keep: '借头部流量',
    tip: '借势：在头部博主笔记下发一条露脸热评，顺带扫评论区收商机，抢溢出流量' },
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
const DRAIN_DEFAULT_TYPES = { latest: true, top: true, local: true, pain: true };
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
  // 竞对：列节奏默认隔 12 小时（词默认不勾这一列——要蹲同行，单独给竞品词勾上）
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

/* 🌿 日常流程：队列里的一种流程项（方向 × 一轮浏览），不是「词 × 筛选」里的一格，
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

/* ── 词池条目：{ k:词, on:启用, src:来源(manual/ai/topic), types:{[类型]:{mode,hours}} } ──
   字符串形式（旧数据 / 顺手传词）也统一收成条目；types 留空 = 跟随全局派生开关 */
function _drainPoolEntry(k, extra) {
  if (k && typeof k === 'object') {
    const key = String(k.k || '').trim();
    if (!key) return null;
    return Object.assign({
      k: key,
      on: k.on !== false,
      src: k.src || 'manual',
      batch: drainBatchName(k),
      types: (k.types && typeof k.types === 'object') ? k.types : {},
    }, extra || {});
  }
  const key = String(k || '').trim();
  if (!key) return null;
  return Object.assign({ k: key, on: true, src: 'manual', batch: drainBatchName(null), types: {} }, extra || {});
}

/* ── 关键词批次：词打批次标签，队列管理配「周几跑哪批」── */
const DRAIN_DEFAULT_BATCH = '默认';
const WK_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function drainBatchName(e) { return String((e && e.batch) || DRAIN_DEFAULT_BATCH).trim() || DRAIN_DEFAULT_BATCH; }
/* 某批今天该不该跑：cfg.batchPlan[批次名] = [星期index(0=周日…6=周六)]；没排期＝每天跑 */
function drainBatchOnToday(batchName, cfg, now) {
  const days = (((cfg || {}).batchPlan) || {})[drainBatchName(batchName)];
  if (!Array.isArray(days) || !days.length) return true;
  return days.indexOf(new Date(now || Date.now()).getDay()) >= 0;
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
  return { k, name: String(a.name || '').trim(), on: a.on !== false, scenario: sc === 'rival' ? 'rival' : 'highv' };
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
  const m = _drainRunNorm(g);
  if (m.mode === 'off') return off;
  const lastAt = Number(((((cfg || {}).kwRuns) || {})[ac.k] || {})[ac.scenario]) || 0;
  if (m.mode === 'each') return { mode: 'each', due: true, lastAt, nextAt: 0, hours: 0 };
  // 从没盯过 → 现在就该盯（同 drainPassState：nextAt 留 0，别算出 1970 年）
  const nextAt = lastAt ? lastAt + m.hours * 3600e3 : 0;
  return { mode: 'interval', hours: m.hours, due: !lastAt || now >= nextAt, lastAt, nextAt };
}

/* 词 × 类型这一格跑不跑：没写 = 跑；兼容旧数据的对象写法（{mode:'off'} 视为不跑）
   例外：「竞对」这列默认不勾——蹲同行只该拿竞品词去蹲，不该把整个词池都搜一遍 */
const DRAIN_TYPE_DEFAULT_ON = { rival: false };
function drainWordTypeOn(entry, scenario) {
  const t = entry && entry.types && entry.types[scenario];
  if (t === true) return true;
  if (t === false) return false;
  if (t && typeof t === 'object') return t.mode !== 'off' && t.on !== false;
  return DRAIN_TYPE_DEFAULT_ON[scenario] !== false;
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

/* 这个词 × 这个类型：现在该不该搜（each=每轮搜；interval=距上次够小时数才搜；off=不搜） */
function drainPassState(entry, scenario, cfg, now) {
  now = now || Date.now();
  const m = drainTypeMode(entry, scenario, cfg);
  if (m.mode === 'off') return { mode: 'off', due: false, lastAt: 0, nextAt: 0, hours: 0 };
  const lastAt = Number(((((cfg || {}).kwRuns) || {})[entry.k] || {})[scenario]) || 0;
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
  if (!drainBatchOnToday(entry.batch, c, now)) return [];
  const keyword = entry.k;
  // 属地真源＝基础配置里的「同城城市」（drainGetScanCfg 读的时候镜像进 cfg.city，这里照旧直接读）
  const city = String(c.city || '').trim();
  const topSorts = DRAIN_DEFAULT_TOP_SORTS;
  const out = [];
  for (const meta of DRAIN_TYPE_META) {
    if (o.only && meta.scenario !== o.only) continue;
    // 词上没勾这一格 / 整列关着 → 这一类不搜（force 只跳过"到点没到点"，不跳过"不跑"）
    if (drainTypeMode(entry, meta.scenario, c).mode === 'off') continue;
    if (!o.force && !drainPassState(entry, meta.scenario, c, now).due) continue;
    if (meta.needCity && !city) continue;
    if (meta.painWords) {
      for (const w of DRAIN_PAIN_WORDS) out.push({ k: keyword, scenario: 'pain', term: keyword + ' ' + w, sort: 'latest' });
      continue;
    }
    if (meta.scenario === 'local') {
      out.push({ k: keyword, scenario: 'local', term: keyword + ' ' + city, sort: 'latest' });
      continue;
    }
    if (meta.scenario === 'top') {
      for (const s of topSorts) out.push({ k: keyword, scenario: 'top', term: keyword, sort: s });
      continue;
    }
    out.push({ k: keyword, scenario: meta.scenario, term: keyword, sort: 'latest' });
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
  const cfg = _drainNormalizeScanCfg((d && d[DRAIN_SCAN_KEY]) || {});
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
  cfg.v = 5;
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

/* 某个词 × 某类型刚跑完 → 记时间戳（"隔几小时跑"据此判断到没到点） */
async function drainMarkPassRan(k, scenario, at) {
  const key = String(k || '').trim();
  if (!key || !scenario) return;
  const cfg = await drainGetScanCfg();
  cfg.kwRuns[key] = Object.assign({}, cfg.kwRuns[key] || {}, { [scenario]: at || Date.now() });
  await drainSaveScanCfg(cfg);
}

/* ================= 队列（🔁 队列页） =================
   队列项 = 词池里"到点该跑"的那一格（词 × 类型）＝配置表里的一个勾 + 一整列的节奏。
   running＝正在跑的那一项；carry＝上次没跑完、下次接着跑的；done＝已跑完的记录（留最近若干条）
   ★ 待跑清单是现场派生的（配置表 + kwRuns），所以「改表＝改队列」，不存在两份要同步的计划 */
const DRAIN_QUEUE_KEY = 'drain_queue';
const DRAIN_QUEUE_DONE_KEEP = 60;

function _drainQKey(k, s) { return String(k || '').trim() + '|' + String(s || ''); }
/* 队列里这一项「叫什么」：盯的账号显示昵称，词就显示词本身 */
function _drainQName(x) { return (x && (x.label || x.k)) || ''; }
function _drainQItem(x) {
  if (!x) return null;
  const k = String(x.k || '').trim();
  if (!k) return null;
  return {
    k,
    label: String(x.label || ''),   // 盯的账号：显示用昵称（k 是主页链接）
    scenario: drainScenarioId(x.scenario),
    at: Number(x.at) || 0,
    foundN: Number(x.foundN) || 0,
    commentN: Number(x.commentN) || 0,
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
  return {
    v: 1,
    running: _drainQItem(q.running) || null,
    carry: arr(q.carry),
    manual: arr(q.manual),
    done: arr(q.done).slice(0, DRAIN_QUEUE_DONE_KEEP),
    // 🌿 距上次日常流程跑过，队列里跑了多少格获客（"每 N 格插 1 轮"的真正计数；
    //    用位置算会随队首推进而漂移，用计数才稳）
    dailyMark: { sinceN: Math.max(0, Number(dm.sinceN) || 0), lastAt: Number(dm.lastAt) || 0 },
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

/* 队列页看到的全部：待跑（到点了）/ 还没到点 / 欠账 / 正在跑。
   排序＝手插最前 → 欠账（越早欠越前）→ 自动插的日常流程 → 最久没跑的先跑
   dbIn = { cfg, daily }（见 drainDailyCtx），缺省＝没有日常浏览这一层 */
function drainQueuePlan(cfgIn, qIn, now, dbIn) {
  const cfg = _drainNormalizeScanCfg(cfgIn || {});
  const q = _drainQNorm(qIn);
  now = now || Date.now();
  const db = dbIn || null;
  const dirById = {};
  ((db && db.cfg && db.cfg.directions) || []).forEach(d => { dirById[d.id] = d; });
  const dbOn = !!(db && db.cfg && db.cfg.enabled);
  const everyN = dbOn ? (Number(db.cfg.insert.everyN) || 0) : 0;
  const sinceN = (q.dailyMark || {}).sinceN || 0;
  const carryAt = {}, manualAt = {};
  q.carry.forEach(c => { carryAt[_drainQKey(c.k, c.scenario)] = c.at || 1; });
  q.manual.forEach(c => { manualAt[_drainQKey(c.k, c.scenario)] = c.at || 1; });
  const city = String(cfg.city || '').trim();
  const todo = [], waiting = [], noCity = [], dailyItems = [];
  for (const e of (cfg.keywords || [])) {
    if (e.on === false) continue;
    if (!drainBatchOnToday(e.batch, cfg, now)) continue;
    for (const meta of DRAIN_TYPE_META) {

      const st = drainPassState(e, meta.scenario, cfg, now);
      if (st.mode === 'off') continue;
      // 属地没填 → 这一类搜不了（属地真源＝基础配置里的「同城城市」）：不进队列，另计数给上方提示
      if (meta.needCity && !city) { noCity.push({ k: e.k, scenario: meta.scenario }); continue; }
      const key = _drainQKey(e.k, meta.scenario);
      const isCarry = carryAt[key] != null, isManual = manualAt[key] != null;
      const item = {
        k: e.k, scenario: meta.scenario, lastAt: st.lastAt, hours: st.hours || 0, nextAt: st.nextAt || 0,
        carry: isCarry, manual: isManual, carryNote: isCarry ? (q.carry.find(x => _drainQKey(x.k, x.scenario) === key) || {}).note || '' : '',
      };
      if (!isCarry && !isManual && !st.due) { waiting.push(item); continue; }
      // 手插：后点的排更前（点 ⤴ 就是「下一步跑它」）；欠账：越早欠越靠前
      item.sort = isManual ? (-2e15 - manualAt[key]) : (isCarry ? (carryAt[key] - 1e15) : (st.lastAt || 0));
      todo.push(item);
    }
  }
  // 👤 盯的账号：和「词 × 类型」一样是一格（k=主页链接），只是它不走搜索、走主页
  for (const ac of (cfg.accounts || [])) {
    const st = drainAccountState(ac, cfg, now);
    if (st.mode === 'off') continue;
    const key = _drainQKey(ac.k, ac.scenario);
    const isCarry = carryAt[key] != null, isManual = manualAt[key] != null;
    const item = {
      k: ac.k, label: drainAccountLabel(ac), acct: true, scenario: ac.scenario,
      lastAt: st.lastAt, hours: st.hours || 0, nextAt: st.nextAt || 0, carry: isCarry, manual: isManual,
      carryNote: isCarry ? (q.carry.find(x => _drainQKey(x.k, x.scenario) === key) || {}).note || '' : '',
    };
    if (!isCarry && !isManual && !st.due) { waiting.push(item); continue; }
    item.sort = isManual ? (-2e15 - manualAt[key]) : (isCarry ? (carryAt[key] - 1e15) : (st.lastAt || 0));
    todo.push(item);
  }
  /* 🌿 日常流程（一项 = 一个方向刷一轮）：
     ① 队列里显式排着的（手插 / 欠账）——按同样的排序规则进待跑；
     ② 没有显式项时按「每 N 格获客插 1 轮」自动插一项；没轮到就只放一张说明卡在"还没到点"里。 */
  const hasManualDaily = q.manual.some(x => x.scenario === 'daily' && dirById[x.k]);
  for (const x of q.manual) {
    if (x.scenario !== 'daily') continue;
    const d = dirById[x.k];
    if (!d) continue;   // 方向被删了 → 手插自动作废
    dailyItems.push({
      k: d.id, label: d.name, scenario: 'daily', daily: true, manual: true,
      lastAt: (q.dailyMark || {}).lastAt || 0, nextAt: 0, sort: -2e15 - (x.at || 1),
    });
  }
  for (const x of q.carry) {
    if (x.scenario !== 'daily') continue;
    const d = dirById[x.k];
    if (!d || hasManualDaily) continue;
    dailyItems.push({
      k: d.id, label: d.name, scenario: 'daily', daily: true, carry: true, carryNote: x.note || '',
      lastAt: (q.dailyMark || {}).lastAt || 0, nextAt: 0, sort: (x.at || 1) - 1e15,
    });
  }
  if (!dailyItems.length && dbOn && everyN > 0) {
    const picked = (typeof DailyBrowse !== 'undefined') ? DailyBrowse.pickDirection(db.cfg, db.daily, now) : null;
    if (sinceN >= everyN) {
      if (picked) {
        dailyItems.push({
          k: picked.id, label: picked.name, scenario: 'daily', daily: true, auto: true,
          lastAt: (q.dailyMark || {}).lastAt || 0, nextAt: 0, sort: -5e14,
        });
      } else {
        waiting.push({
          k: 'daily', label: '日常流程', scenario: 'daily', daily: true, nextAt: 0, lastAt: (q.dailyMark || {}).lastAt || 0,
          waitNote: '该轮到它了，但此刻没有可用方向（不在时段内 / 今日配额已满）',
        });
      }
    } else if (picked) {
      waiting.push({
        k: picked.id, label: picked.name, scenario: 'daily', daily: true, nextAt: 0, lastAt: (q.dailyMark || {}).lastAt || 0,
        waitNote: '队列里再跑 ' + (everyN - sinceN) + ' 格获客就轮到它（每 ' + everyN + ' 格插 1 轮）',
      });
    } else if (dbOn) {
      waiting.push({
        k: 'daily', label: '日常流程', scenario: 'daily', daily: true, nextAt: 0, lastAt: (q.dailyMark || {}).lastAt || 0,
        waitNote: '现在没有可用方向（不在时段内 / 今日配额已满）',
      });
    }
  }
  todo.push(...dailyItems);
  todo.sort((a, b) => a.sort - b.sort);
  waiting.sort((a, b) => (a.nextAt || 0) - (b.nextAt || 0));
  const inPool = new Set((cfg.keywords || []).filter(e => e.on !== false).map(e => e.k));
  const acctKeys = new Set((cfg.accounts || []).filter(a => a.on !== false).map(a => a.k));
  // 词被停用/删掉、账号被取消盯、方向被删 → 它的欠账和手插自动作废
  const live = (x) => (x.scenario === 'daily') ? !!dirById[x.k] : (inPool.has(x.k) || acctKeys.has(x.k));
  return {
    cfg, q, todo, waiting, noCity, db, dbOn, everyN, sinceN,
    carry: q.carry.filter(live), manual: q.manual.filter(live), running: q.running,
  };
}

/* 取队首跑（顺带清掉失效的欠账/手插）：返回 null＝这一轮到点的都跑完了
   skip＝本次跑已经跑过的 key（"每轮跑"的格子跑完还是到点，靠它避免同一趟里反复跑同一格） */
async function drainQueueTake(skip) {
  const cfg = await drainGetScanCfg();
  const q = await drainGetQueue();
  const p = drainQueuePlan(cfg, q, Date.now(), await drainDailyCtx());
  const sk = skip || {};
  const item = p.todo.find(it => !sk[_drainQKey(it.k, it.scenario)]);
  const keep = { carry: p.carry, manual: p.manual };
  if (!item) { await drainSaveQueue(Object.assign({}, q, keep, { running: null })); return null; }
  await drainSaveQueue(Object.assign({}, q, keep, { running: { k: item.k, label: item.label || '', scenario: item.scenario, at: Date.now(), note: '正在跑' } }));
  return item;
}
/* 这一项跑完：记「这类刚跑过」时间戳 + 清欠账/手插 + 落一条已完成
   🌿 日常流程那一项跑完 = 重置"距上次插过几格"的计数（下次要再攒够 N 格才轮到它） */
async function drainQueueFinish(item, summary) {
  const s = summary || {};
  await drainMarkPassRan(item.k, item.scenario, Date.now());
  const q = await drainGetQueue();
  const key = _drainQKey(item.k, item.scenario);
  const dm = q.dailyMark || { sinceN: 0, lastAt: 0 };
  const nextMark = (item.scenario === 'daily')
    ? { sinceN: 0, lastAt: Date.now() }
    : { sinceN: (Number(dm.sinceN) || 0) + 1, lastAt: dm.lastAt || 0 };
  const done = [{
    k: item.k, label: item.label || '', scenario: item.scenario, at: Date.now(),
    foundN: Number(s.foundN) || 0, commentN: Number(s.commentN) || 0, note: String(s.note || ''),
    notes: Array.isArray(s.notes) ? s.notes : [],
  }].concat(q.done);
  await drainSaveQueue(Object.assign({}, q, {
    running: null, done, dailyMark: nextMark,
    carry: q.carry.filter(x => _drainQKey(x.k, x.scenario) !== key),
    manual: q.manual.filter(x => _drainQKey(x.k, x.scenario) !== key),
  }));
}
/* 这一项没跑完（撞上限/出错/被停）→ 进欠账，下次第一个跑 */
async function drainQueueHold(item, note) {
  const q = await drainGetQueue();
  const key = _drainQKey(item.k, item.scenario);
  const carry = [{ k: item.k, label: item.label || '', scenario: item.scenario, at: Date.now(), note: String(note || '') }]
    .concat(q.carry.filter(x => _drainQKey(x.k, x.scenario) !== key));
  await drainSaveQueue(Object.assign({}, q, { running: null, carry }));
}
/* 队列页行内操作：拎到最前 / 取消（撤掉手插或欠账）
   label：🌿 日常流程项的显示名（方向名），别的项留空即可 */
async function drainQueuePushFront(k, scenario, label) {
  const q = await drainGetQueue();
  const key = _drainQKey(k, scenario);
  const manual = [{ k: String(k), label: String(label || ''), scenario: drainScenarioId(scenario), at: Date.now() }]
    .concat(q.manual.filter(x => _drainQKey(x.k, x.scenario) !== key));
  await drainSaveQueue(Object.assign({}, q, { manual }));
}
async function drainQueueDrop(k, scenario) {
  const q = await drainGetQueue();
  const key = _drainQKey(k, scenario);
  await drainSaveQueue(Object.assign({}, q, {
    manual: q.manual.filter(x => _drainQKey(x.k, x.scenario) !== key),
    carry: q.carry.filter(x => _drainQKey(x.k, x.scenario) !== key),
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
  // 👤 盯的账号：kind=profile → 进他的个人主页扒（不走搜索词）
  for (const ac of (c.accounts || [])) {
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
    case 'highv':
      return { verdict: '借V监控·溢出', tone: 'purple' };
    default:
      return { verdict: '监控', tone: 'gray' };
  }
}

/* ================= 弹窗渲染：队列配置 / 笔记池（获客分组两个二级页） ================= */
let _drainNotesChanged = null;
let _cand = null;    // 配置页候选区：{ kind:'ai'|'topic', label, loading, items:[{k,n}] }
let _cfgWant = null; // 跳过来时要展开的候选区：'ai' | 'topic'（页面还没渲染完也认）
let _cfgSec = 'run';  // 配置页三张卡哪张展开：run 跑什么（词池＋盯的账号）/ daily 日常浏览 / goal 推广目标
let _kwOpen = {};     // 关键词池批次展开状态：{ 批次名: true/false }（2026-10-02 起批次＝列表外层骨架，点批次行展开词）
let _kwCur = '';      // 最近展开/操作过的批次：顶部回车加词、候选入池都落到这一批
let _kwInited = false; // 首次进页面时自动展开规则（只有一个批次就展开，多批次收起按需点开）
const _dbDetOpen = { round: false, social: false };  // 🌿 日常浏览里两个折叠块（一轮怎么刷 / 顺手互动）的展开状态，切 tab 重渲染后照旧
let _lastScanInfo = null;   // 本轮扫描结果 { text, warn }：配置页顶栏下方那行 / 笔记池的提示行
/* 表格里类型下拉的短标签（列窄，完整名放进 title） */
const DRAIN_TYPE_SHORT = { latest: '最新', top: 'TOP', local: '本地', pain: '求助', rival: '竞对', highv: '高V' };

/* ── 🎯 推广目标（配置页最下面那张卡，2026-09-25 从「诊断&配置 → 基础配置」搬来）──
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
    if (box) box._qTab = 'config';
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
/* ================= 📖 评论策略（队列页顶栏 / 工作台左侧共用这一块） =================
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
  else if (s === 'local') t = '以本地人身份' + head + '评一条';
  else t = head + '发一条露脸评论';
  if (pb.send === 'both') t += '，同时回评论区里求助 / 同问的人';
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
  const rows = ['latest', 'top', 'local', 'pain', 'rival', 'highv'].map(s => {
    const pb = DRAIN_PLAYBOOK[s];
    const run = (cfg.typeRun || {})[s] || DRAIN_TYPE_RUN_DEFAULT[s];
    const arun = (cfg.acctRun || {})[s] || DRAIN_ACCT_RUN_DEFAULT[s];
    const words = wN(s), accts = aN(s);
    let status, isOn;
    if (s === 'highv') {
      isOn = accts > 0 && arun.mode !== 'off';
      status = (_stratRunTxt(arun) || '整列关着') + ' · ' + (accts ? accts + ' 个账号' : '还没加「盯的账号」');
    } else if (s === 'rival') {
      // 竞对有两路来源：竞品词拿去搜 + 进竞对主页扒，各走各的节奏——开着哪路说哪路
      const wRun = _stratRunTxt(run), aRun = _stratRunTxt(arun);
      const wPart = (words && wRun) ? (wRun + ' · ' + words + ' 个词') : (words ? '词的节奏关着' : '词上没勾这一列');
      const aPart = (accts && aRun) ? (aRun + ' · ' + accts + ' 个账号') : (accts ? '账号的节奏关着' : '还没加账号');
      isOn = (words > 0 && !!wRun) || (accts > 0 && !!aRun);
      status = wPart + ' + ' + aPart;
    } else {
      isOn = words > 0 && run.mode !== 'off';
      status = (_stratRunTxt(run) || '整列关着') + ' · ' + (words ? words + ' 个词' : '词上没勾这一列');
      if (s === 'local' && !cfg.city) { status += '（没填同城城市，跑不了）'; isOn = false; }
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
      : (perRound > 0 ? '每轮最多 <b class="strat-n">' + perRound + '</b> 篇' : '条数不限');
    sum.innerHTML = '📖 评论策略：AI 造梗露脸短句 · 现在开着 <b class="strat-n">' + live + '</b> 类 · ' + capTxt + ' · 不该评的自动跳过';
    body.innerHTML =
      '<div class="strat-sec"><span class="strat-sec-h">① 队列怎么跑</span><br>' +
      '到点的一项 → 按这一类搜一批笔记 → 一篇一篇打开 → AI 写一条评论 → 发出 → 该扫评论区的顺手把有商机的人收进获客清单 → 记一笔完成 → 下一项。<br>' +
      '口径：<b>' + (scope === 'growing' ? '只追涨势' : '全部未灌过') + '</b>' +
      (scope === 'growing' ? '（只挑点赞在涨的笔记）' : '（已灌过、队列跑过的自动跳过）') +
      ' ｜ 节奏：<b>' + (pace === 'interval' ? '定时轮' : '一遍跑完') + '</b>' +
      (pace === 'interval' ? '（每 ' + (Number(trend.scanIntervalMin) || 10) + ' 分钟跑一项，把额度摊开到一天）' : '（从队首连跑到队尾）') + '</div>' +
      '<div class="strat-sec"><span class="strat-sec-h">② 六类怎么评</span>' +
      '<table class="strat-tab"><thead><tr><th>类型</th><th>开没开 · 节奏 · 来源</th><th>怎么评</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="strat-sec"><span class="strat-sec-h">③ 评论长什么样</span><br>' +
      'AI 按这一类的口吻写 15~30 字短句（接梗 / 抖机灵 / 捧场），像真人随手留的；不提产品、品牌、链接、主页、私信。严肃、悲伤、纠纷这类内容自动「跳过」不评；刚发出去的那条也不会被当成商机回头再回一遍。</div>' +
      '<div class="strat-sec"><span class="strat-sec-h">④ 评多少</span><br>' +
      presetTxt + '每轮最多 <b>' + (perRound > 0 ? perRound + ' 篇' : '不限') + '</b>' +
      ' · 同一篇 <b>' + (Number(trend.cooldownHours) || 24) + ' 小时</b>内不重评（每篇总次数 ≤ ' + (Number(trend.maxPerNote) || 2) + '）' +
      ' · 今天已发 <b>' + sentToday + ' 条</b>' + (dailyMax > 0 ? '（每天最多 ' + dailyMax + ' 条）' : '（没设每日上限）') +
      '。到上限就停在当前一项记欠账，下次点开始接着跑。</div>';
    if (_stratBound && !_stratBound.has(el)) {
      _stratBound.add(el);
      chrome.storage.onChanged.addListener((ch, area) => {
        if (area !== 'local' || !el.isConnected) return;
        if (!Object.keys(ch).some(k => STRAT_WATCH_KEYS.indexOf(k) >= 0)) return;
        drainPaintStrategy(el);
      });
    }
  } catch (e) {
    sum.textContent = '📖 评论策略：暂时读不出来（' + ((e && e.message) || e) + '）';
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

async function renderDrainQueue(container) {
  if (!container) return;
  const body = container.querySelector('#queueBody');
  const caps = container.querySelector('#queueCaps');
  if (!body) return;
  let _qTab = container._qTab || 'mgmt';
  if (_qTab === 'strat') _qTab = 'mgmt';   // 评论策略并成队列页里的折叠块（2026-10-24），老位置不再有横签
  /* ⚙️ 配置那一签：进来才画三张卡（配置页自己管卡的展开/收起）。
     同一次进入只画一次——队列 render() 会因 storage 变化反复跑，别把正在填的输入框刷掉 */
  let _cfgMounted = false;
  const mountCfg = () => {
    if (_cfgMounted) return;
    const cfgBox = container.querySelector('#drainCfgContent');
    if (!cfgBox) return;
    _cfgMounted = true;
    renderScenarioDrain(cfgBox, 'cfg');
  };
  /* 队列页 2 个横置子 tab：📜 队列 / ⚙️ 配置；评论策略是队列页底下的一个折叠块 */
  const paintQueueTab = () => {
    const tabs = container.querySelector('#queueTabs');
    if (!tabs) return;
    tabs.querySelectorAll('.q-tab').forEach(b => b.classList.toggle('active', b.getAttribute('data-qtab') === _qTab));
    const isMgmt = _qTab === 'mgmt';
    const bar = container.querySelector('#queueBar');
    const stratWrap = container.querySelector('#qStratWrap');
    const cfgBox = container.querySelector('#drainCfgContent');
    if (bar) bar.style.display = isMgmt ? '' : 'none';
    if (body) body.style.display = isMgmt ? '' : 'none';
    if (stratWrap) stratWrap.style.display = isMgmt ? '' : 'none';
    if (cfgBox) cfgBox.style.display = isMgmt ? 'none' : '';
    if (!isMgmt) mountCfg();
  };
  const tabsBox = container.querySelector('#queueTabs');
  if (tabsBox && !tabsBox.dataset.qtabBound) {
    tabsBox.dataset.qtabBound = '1';
    tabsBox.querySelectorAll('.q-tab').forEach(b => b.onclick = () => {
      _qTab = b.getAttribute('data-qtab');
      container._qTab = _qTab;
      paintQueueTab();
    });
  }
  if (_drainQChanged) chrome.storage.onChanged.removeListener(_drainQChanged);
  _drainQChanged = (changes, area) => {
    if (area !== 'local' || !container.isConnected) return;
    // auto_water_state.live = 执行器正在发第几篇的第几条（💬 评论条队列的实时进度）
    if (!changes[DRAIN_QUEUE_KEY] && !changes[DRAIN_SCAN_KEY] && !changes['auto_water_state']) return;
    render();
  };
  chrome.storage.onChanged.addListener(_drainQChanged);
  const open = container._qOpen || (container._qOpen = { wait: false, done: false });

  /* 🌿 「塞一轮日常流程」小弹层：点按钮列方向，点一个就把那一轮插到队列最前。
     点空白处收起——容器重新渲染后这个监听器自己摘掉（否则切页几次会攒一堆） */
  const onDocClick = (ev) => {
    if (!container.isConnected) { document.removeEventListener('click', onDocClick); return; }
    /* 两个小弹层：🌿 塞一轮 / ⏰ 每周自动跑——点空白处都收起 */
    const pops = [['#qAddDailyPop', '#qAddDailyBtn'], ['#qAutoPop', '#qAutoBtn']];
    pops.forEach(pair => {
      const pop = container.querySelector(pair[0]);
      const btn = container.querySelector(pair[1]);
      if (!pop || pop.style.display === 'none') return;
      if (pop.contains(ev.target) || (btn && btn.contains(ev.target))) return;
      pop.style.display = 'none';
    });
  };
  document.addEventListener('click', onDocClick);

  function paintAddDaily(p, dbCfg) {
    const btn = container.querySelector('#qAddDailyBtn');
    const pop = container.querySelector('#qAddDailyPop');
    if (!btn || !pop) return;
    const dirs = (dbCfg && dbCfg.directions) || [];
    btn.style.display = dirs.length ? '' : 'none';
    if (!dirs.length) { pop.style.display = 'none'; return; }
    if (!btn.dataset.qdBound) {
      btn.dataset.qdBound = '1';
      btn.onclick = (e) => {
        e.stopPropagation();
        pop.style.display = (pop.style.display === 'none') ? '' : 'none';
      };
    }
    const prog = (typeof DailyBrowse !== 'undefined') ? DailyBrowse.progress(dbCfg, (p.db && p.db.daily) || {}, Date.now()) : [];
    const info = {};
    prog.forEach(x => { info[x.dir.id] = x; });
    pop.innerHTML = '<div style="font-weight:700;font-size:12px;color:#1f2937;margin-bottom:6px;">塞哪个方向一轮？<span class="qhelp r" tabindex="0" data-tip="手动塞的一轮会插在队首，跟着队列一起串行跑；平时它按「每 N 格插 1 轮」自己插。">?</span></div>' +
      dirs.map(d => {
        const x = info[d.id] || { used: 0, dir: d, inWindow: false };
        const bits = [];
        if (d.enabled === false) bits.push('已停用');
        if (!x.inWindow) bits.push('不在时段内');
        bits.push('今日 ' + x.used + '/' + d.dailyQuota);
        return '<button type="button" class="btn btn-sm" data-qdaily="' + escAttr(d.id) + '" data-qdailyn="' + escAttr(d.name) + '"' +
          ' style="display:block;width:100%;text-align:left;margin-bottom:4px;white-space:normal;">🌿 ' + escHtml(d.name) +
          '<span class="sx-count" style="margin-left:6px;">' + bits.join(' · ') + '</span></button>';
      }).join('') +
      (dbCfg && dbCfg.enabled === false
        ? '<div class="sx-count" style="margin-top:2px;color:#d97706;">⚠️ 日常浏览总开关是关的：手插的照跑，队列不会自动排它</div>'
        : '');
    pop.querySelectorAll('[data-qdaily]').forEach(b => {
      b.onclick = async () => {
        const id = b.getAttribute('data-qdaily');
        const nm = b.getAttribute('data-qdailyn') || id;
        pop.style.display = 'none';
        await drainQueuePushFront(id, 'daily', nm);
        if (typeof window.__xhsExecDaily === 'function') {
          const r = await window.__xhsExecDaily(id, nm);
          if (!r || !r.ok) {
            drainToast('🌿 已插到队首，但派给执行器没成：' + ((r && r.error) || '未知'), 'warn');
            await render();
            return;
          }
          drainToast(r.delivered ? '🌿 已插到队首，执行器当场开跑' : '🌿 已插到队首——执行器不在线，等它上线就跑', 'ok');
        } else {
          drainToast('🌿 已把「' + nm + '」这一轮插到队首');
        }
        await render();
      };
    });
  }

  async function render() {
    const now = Date.now();
    const cfg = await drainGetScanCfg();
    const q = await drainGetQueue();
    const db = await drainDailyCtx();
    const p = drainQueuePlan(cfg, q, now, db);

    // 额度：今日已发 / 每日上限（与执行器同一份 auto_water_daily + 灌水频率与去重里的 schedule）
    let used = 0, dailyMax = 0, perRound = 0, live = null, dbLast = null, dbRun = {}, dbHold = 0;
    try {
      const d = await chrome.storage.local.get(['auto_water_daily', 'auto_water_config', 'auto_water_state', 'daily_browse_last', 'daily_browse_run_state']);
      const day = new Date().toISOString().slice(0, 10);
      used = Number((d['auto_water_daily'] || {})[day]) || 0;
      const sch = ((d['auto_water_config'] || {}).schedule) || {};
      dailyMax = Number(sch.dailyMax) || 0;
      perRound = Number(sch.perRound) || 0;
      live = (d['auto_water_state'] || {}).live || null;   // 💬 执行器正在发第几篇的第几条
      dbLast = d['daily_browse_last'] || null;             // 🌿 页面侧每刷一篇就落一次，用来显示"刷到第几篇"
      dbRun = d['daily_browse_run_state'] || {};           // 🌿 保底时钟/执行器状态（这一行只在开了自动跑时显示）
      try { dbHold = await DailyBrowse.autoHoldUntil(); } catch (_) {}
    } catch (_) {}
    const itemsPerDay = (dailyMax > 0 && perRound > 0) ? Math.max(1, Math.floor(dailyMax / perRound)) : 0;
    // 正在跑的那一项只在 ▶ 里出现，不在 ⏳ 里重复；到点清单＝队列真正排着的
    const runKey = p.running ? _drainQKey(p.running.k, p.running.scenario) : '';
    const todo = p.todo.filter(it => !runKey || _drainQKey(it.k, it.scenario) !== runKey);
    const left = todo.length + p.waiting.length;
    /* 🌿 日常流程那一行：今日刷了多少 / 各方向到哪了 / 还差几格轮到下一轮 */
    const dbCfg = (p.db && p.db.cfg) || null;
    const dbToday = ((p.db && p.db.daily) || {}).count || 0;
    const dbProg = (dbCfg && typeof DailyBrowse !== 'undefined') ? DailyBrowse.progress(dbCfg, (p.db && p.db.daily) || {}, now) : [];
    let dbLine = '';
    if (dbCfg && dbCfg.enabled) {
      const parts = dbProg.filter(x => x.dir.enabled).map(x => escHtml(x.dir.name) + ' ' + x.used + '/' + x.dir.dailyQuota);
      dbLine = '🌿 今日刷 <b>' + dbToday + '</b> 篇' + (parts.length ? '（' + parts.join(' · ') + '）' : '') +
        (p.everyN > 0 ? ' · 每 ' + p.everyN + ' 格插 1 轮（还差 ' + Math.max(0, p.everyN - p.sinceN) + ' 格）' : ' · 不自动插，只手动塞');
    }
    /* 保底时钟那一行：开着「每天自动跑」才显示——正在自动跑 / 今天被停过 / 等时段到点 */
    let dbAutoLine = '';
    if (dbCfg && dbCfg.enabled && dbCfg.autorun && dbCfg.autorun.enabled) {
      const st = dbRun.running ? '<b style="color:#0a8f4c;">正在自动跑</b>'
        : (dbHold > now ? '<span style="color:#d97706;">今天被停过，不再自动拉起</span>'
          : (DailyBrowse.autorunOn(dbCfg, now) ? '时段内，到点自己把队列拉起来' : '等 ' + escHtml(dbCfg.autorun.from) + ' 到点'));
      dbAutoLine = '⏰ 自动跑 ' + escHtml(dbCfg.autorun.from) + '–' + escHtml(dbCfg.autorun.to) + '：' + st;
    }
    paintQueueTab();
    if (caps) {
      const capsTip = '队列项＝词 × 类型（词池里勾上、且到了它那一列的节奏就该跑）＋ 👤 盯的账号（到了那两列的节奏就该盯）' +
        '＋ 🌿 日常流程（按「每 N 格插 1 轮」自动插，也可手动塞）。' +
        '「今天跑批次」按批次卡头上点的周几算：只有今天亮的批才进队列。' +
        '工期按「🎯 获客 → ⚙️ 设置 → 🤖 拟人化与频率 → ⚙️ 高级配置」的每日评论上限 ÷ 每轮上限估，跑一项通常吃满一轮的额度。' +
        (p.noCity.length ? ' 「📍本地」要先用「账号规划 → 基础配置」里的同城城市才搜得了。' : '');
      const todayIdx = new Date(now).getDay();
      const planB = cfg.batchPlan || {};
      const runToday = drainBatchesOf(cfg.keywords || [], cfg).filter(b => { const ds = planB[b]; return !Array.isArray(ds) || !ds.length || ds.indexOf(todayIdx) >= 0; });
      caps.innerHTML = '<div style="font-size:12px;color:#374151;">🗂 今天（' + WK_LABELS[todayIdx] + '）跑批次：' +
        (runToday.length ? runToday.map(escHtml).join('、') : '<span style="color:#d97706;">今天没安排跑的批次</span>') +
        ' <span class="qhelp" tabindex="0" data-tip="' + escAttr(capsTip) + '">?</span></div>' +
        '<div style="font-size:11.5px;color:#6b7280;margin-top:2px;">' +
        '待跑 <b>' + todo.length + '</b> 项' +
        (p.waiting.length ? ' · 还没到点 ' + p.waiting.length + ' 项' : '') +
        (p.noCity.length ? ' · <span style="color:#d97706;">⚠️ 本地没填属地，' + p.noCity.length + ' 项不参与</span>' : '') +
        ' · 今日评论 <b>' + used + '</b>' + (dailyMax > 0 ? '/' + dailyMax : '（不限）') +
        (itemsPerDay > 0 && left > 0 ? ' · 按每天约 ' + itemsPerDay + ' 项估，这一圈约 ' + Math.ceil(left / itemsPerDay) + ' 天' : '') +
        '</div>';
      if (dbLine || dbAutoLine) caps.innerHTML += '<div style="font-size:11.5px;color:#6b7280;margin-top:2px;">' + [dbLine, dbAutoLine].filter(Boolean).join(' · ') + '</div>';
      /* ⏰ 整条队列 · 每周自动跑（2026-10-24 从「队列配置」搬成顶栏这一颗） */
      const qa = cfg.queueAuto || { enabled: false, days: [], from: '09:00', to: '18:00' };
      const qaDayList = (qa.days || []).slice().sort((x, y) => x - y);
      const qaTxt = qa.enabled ? ('开 · ' + (qaDayList.length ? qaDayList.map(d => WK_LABELS[d]).join('、') : '还没选星期') + ' ' + (qa.from === qa.to ? '全天' : qa.from + '–' + qa.to)) : '关';
      const qaDayBtns = [1, 2, 3, 4, 5, 6, 0].map(d =>
        '<button type="button" class="qm-wd' + (qaDayList.indexOf(d) >= 0 ? ' on' : '') + '" data-qm-qa="' + d + '">' + WK_LABELS[d] + '</button>').join('');
      caps.innerHTML += '<div style="margin-top:6px;"><span style="position:relative;display:inline-flex;align-items:center;">' +
        '<button type="button" class="btn btn-sm" id="qAutoBtn" title="整条队列每周自动跑：选了星期和时段，到点就自己把整条队列拉起来">⏰ 每周自动跑：' + escHtml(qaTxt) + '</button>' +
        '<div id="qAutoPop" style="display:none;position:absolute;right:0;top:30px;z-index:40;width:264px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 10px 26px rgba(16,24,40,.14);padding:10px 12px;text-align:left;">' +
          '<div style="font-weight:700;font-size:12px;color:#1f2937;margin-bottom:6px;">⏰ 每周自动跑 · 整条队列</div>' +
          '<label style="font-size:12px;color:#374151;display:block;margin-bottom:6px;"><input type="checkbox" id="qmQaOn"' + (qa.enabled ? ' checked' : '') + '> 开启</label>' +
          '<div class="qm-wds" style="margin-bottom:6px;">' + qaDayBtns + '</div>' +
          '<div style="display:flex;align-items:center;gap:6px;">' +
            '<input id="qmQaFrom" maxlength="5" value="' + escAttr(qa.from) + '" style="width:56px;padding:3px 6px;border:1px solid #e5e7eb;border-radius:6px;font-size:12px;text-align:center;">' +
            '<span class="sx-count">→</span>' +
            '<input id="qmQaTo" maxlength="5" value="' + escAttr(qa.to) + '" style="width:56px;padding:3px 6px;border:1px solid #e5e7eb;border-radius:6px;font-size:12px;text-align:center;">' +
          '</div>' +
          '<div class="sx-count" style="margin-top:5px;">起止一样＝全天；不选星期＝点开也不跑</div>' +
          '<div style="display:flex;justify-content:flex-end;margin-top:8px;"><button type="button" class="btn btn-sm btn-primary" id="qmQaSave">保存</button></div>' +
        '</div></span></div>';
      const qaBtn = container.querySelector('#qAutoBtn');
      const qaPop = container.querySelector('#qAutoPop');
      if (qaBtn && qaPop) qaBtn.onclick = (e) => { e.stopPropagation(); qaPop.style.display = (qaPop.style.display === 'none') ? '' : 'none'; };
      let qaDaysCur = qaDayList.slice();
      container.querySelectorAll('#qAutoPop [data-qm-qa]').forEach(b => b.onclick = async () => {
        const d = Number(b.getAttribute('data-qm-qa'));
        const i = qaDaysCur.indexOf(d);
        if (i >= 0) qaDaysCur.splice(i, 1); else qaDaysCur.push(d);
        await drainSaveScanCfg(Object.assign({}, cfg, { queueAuto: Object.assign({}, qa, { days: qaDaysCur.slice().sort((x, y) => x - y) }) }));
        await render();
      });
      const qaSave = container.querySelector('#qmQaSave');
      if (qaSave) qaSave.onclick = async () => {
        const from = String((container.querySelector('#qmQaFrom') || {}).value || '').trim();
        const to = String((container.querySelector('#qmQaTo') || {}).value || '').trim();
        const on = !!(container.querySelector('#qmQaOn') || {}).checked;
        if (!/^\d{1,2}:\d{2}$/.test(from) || !/^\d{1,2}:\d{2}$/.test(to)) { drainToast('时段要写成 09:00 这样（起止一样＝全天）', 'warn'); return; }
        await drainSaveScanCfg(Object.assign({}, cfg, { queueAuto: { enabled: on, days: qaDaysCur.slice().sort((x, y) => x - y), from: from, to: to } }));
        drainToast('⏰ 每周自动跑：' + (on ? ('开（' + (from === to ? '全天' : from + '–' + to) + '）') : '关'));
        try { chrome.runtime.sendMessage({ action: 'dailyAutoKick' }); } catch (_) {}
        await render();
      };
    }
    paintAddDaily(p, dbCfg);
    await drainPaintStrategy(container.querySelector('#qStrat'));

    /* 队列卡片（2026-09-25 三十一改）：一项一张卡，主行＝来源 × 类型 + ⤴/✕，副行灰字＝计划 / 欠多久 / 上次跑。
       老版是 5 列表格 + 按来源折叠（一个来源一行、点开才看到它这一批类型）：看队列得先展开、还得对列名，所以改平铺 */
    const acctSet = new Set((cfg.accounts || []).map(a => a.k));
    const isAcct = (x) => !!x.acct || acctSet.has(x.k);
    /* 副行：按 kind 各说各的——待跑＝计划时刻（欠多久）+ 上次跑于何时；还没到点＝下次到点；已完成＝结果 */
    const subLine = (it, kind, op) => {
      const o = op || {};
      const last = it.lastAt ? _drainQStamp(it.lastAt, now) : '没跑过';
      if (kind === 'run') return '这次 ' + (it.at ? _drainQStamp(it.at, now) + ' 开跑' : '刚开跑') + (o.carry ? ' · 接着上次没跑完' : '');
      if (kind === 'done') return _drainQStamp(it.at, now) + ' · ' + (o.detail || '');
      if (kind === 'wait' && it.waitNote) return it.waitNote;
      if (kind === 'wait') return '计划 ' + _drainQStamp(it.nextAt, now) + '（' + _drainQIn(it.nextAt, now) + '） · 上次 ' + last;
      // 🌿 日常流程：它没有"下次到点"，由「每 N 格获客插 1 轮」的计数决定，所以只说上次刷于何时
      if (it.daily) {
        return (o.manual ? '手插 · ' : (o.carry ? '接着上次没跑完 · ' : '')) +
          (it.lastAt ? '上次刷于 ' + _drainQStamp(it.lastAt, now) : '今天还没刷过') +
          ' · 一轮 ' + ((dbCfg && dbCfg.perRound) || 6) + ' 篇';
      }
      if (o.manual) return '手插 · 下一项就它' + (it.lastAt ? ' · 上次 ' + last : '');
      if (!it.lastAt) return '现在该跑 · 还没跑过';
      // 「每轮跑」这类没有"下次到点"：它跑完还是到点，只记上次跑于何时
      if (!it.nextAt) return '每轮都跑 · 上次 ' + last;
      return '计划 ' + _drainQStamp(it.nextAt, now) + ' · <b class="q-late">' + _drainQLate(it.nextAt, now) + '</b> · 上次 ' + last;
    };
    /* 笔记级明细：这一项发过评论的笔记各发了几条（折叠，默认收起，就长在卡片里） */
    const subRows = (it) => {
      if (!(it.notes || []).length) return '';
      return '<details class="q-sub" data-q-open="sub"' + (open.sub ? ' open' : '') + '><summary>📄 发过的笔记 ' + it.notes.length + ' 篇</summary>' +
        it.notes.map(n => '<div class="q-sub-row"><span>' + _drainQTxt(n.t) + '</span><span class="q-sub-n">发 ' + n.s + ' 条</span></div>').join('') +
        '</details>';
    };
    /* 一张卡：序号（正在跑＝▶）+ 来源名（账号带标记）+ 类型胶囊 + ⤴/✕ + 副行 */
    const card = (it, kind, o) => {
      const op = o || {};
      const frontBtn = op.canFront ? '<button data-q-act="front" data-q-k="' + escAttr(it.k) + '" data-q-n="' + escAttr(it.label || '') + '" data-q-s="' + escAttr(it.scenario) + '" title="拎到最前：这一项下一个跑">⤴</button>' : '';
      const dropBtn = op.canDrop ? '<button data-q-act="drop" data-q-k="' + escAttr(it.k) + '" data-q-n="' + escAttr(it.label || '') + '" data-q-s="' + escAttr(it.scenario) + '" title="取消这一项（撤掉欠账/手插；配置表里的勾还在，下次到点照回）">✕</button>' : '';
      const name = _drainQName(it);
      const tag = isAcct(it) ? '<span class="q-tag">账号</span>'
        : (it.daily ? '<span class="q-tag q-tag-daily">日常</span>' : '');
      const type = _drainQType(it.scenario);
      const sub = subLine(it, kind, op);
      return '<div class="q-item' + (kind === 'run' ? ' q-item-run' : '') + (it.daily ? ' q-item-daily' : '') + '">' +
        '<span class="q-i-no">' + (op.idx || (kind === 'run' ? '▶' : '')) + '</span>' +
        '<div class="q-i-bd">' +
        '<div class="q-i-top" title="' + _drainQTitle([name, type]) + '"><span class="q-i-name">' + _drainQTxt(name) + '</span>' + tag +
        '<span class="q-i-type">' + type + '</span>' +
        '<span class="q-i-ops">' + frontBtn + dropBtn + '</span></div>' +
        '<div class="q-i-sub" title="' + _drainQTitle([sub]) + '">' + sub + '</div>' +
        (op.live ? '<div class="q-live">' + op.live + '</div>' : '') +
        subRows(it) +
        '</div></div>';
    };

    /* 2026-10-01 队列改组：待跑 / 还没到点 都按「关键词」一行归组（同一个词的几个类型并成一卡），
       少拆卡、一眼看全；正在跑 / 已完成仍是逐项（那是真实发生的单笔记录）。 */
    const groupByKeyword = (list) => {
      const map = new Map();
      (list || []).forEach(it => {
        if (!map.has(it.k)) map.set(it.k, []);
        map.get(it.k).push(it);
      });
      return Array.from(map.values());
    };
    const groupCard = (items, kind, o) => {
      const first = items[0];
      const op = o || {};
      const name = _drainQName(first);
      const tag = isAcct(first) ? '<span class="q-tag">账号</span>' : (first.daily ? '<span class="q-tag q-tag-daily">日常</span>' : '');
      const types = items.map(it => '<span class="q-i-type">' + _drainQType(it.scenario) + '</span>').join('');
      const sub = subLine(first, kind, { manual: first.manual, carry: first.carry });
      const ss = items.map(it => it.scenario).join('|');
      const frontBtn = op.canFront ? '<button data-q-gact="front" data-q-k="' + escAttr(first.k) + '" data-q-n="' + escAttr(first.label || '') + '" data-q-ss="' + escAttr(ss) + '" title="拎到最前：这个词名下差的事都往前提">⤴</button>' : '';
      const dropBtn = op.canDrop ? '<button data-q-gact="drop" data-q-k="' + escAttr(first.k) + '" data-q-n="' + escAttr(first.label || '') + '" data-q-ss="' + escAttr(ss) + '" title="取消这个词名下的这些待办（配置表里的勾还在，下次到点照回）">✕</button>' : '';
      return '<div class="q-item q-item-group' + (first.daily ? ' q-item-daily' : '') + '">' +
        '<div class="q-i-bd">' +
        '<div class="q-i-top" title="' + _drainQTitle([name, items.map(it => _drainQType(it.scenario)).join('/')]) + '">' +
        '<span class="q-i-name">' + _drainQTxt(name) + '</span>' + tag +
        '<span class="q-i-types">' + types + '</span>' +
        '<span class="q-i-ops">' + frontBtn + dropBtn + '</span></div>' +
        '<div class="q-i-sub" title="' + _drainQTitle([sub]) + '">' + sub + '</div>' +
        '</div></div>';
    };

    let html = '';
    if (p.running) {
      const isCarry = (q.carry || []).some(c => _drainQKey(c.k, c.scenario) === runKey);
      const lv = (live && _drainQKey(live.kw || '', live.scenario || '') === runKey) ? live : null;
      let liveLine = '';
      if (lv) {
        const parts = [];
        if (lv.title) parts.push('📄 ' + (lv.idx && lv.total ? '第 ' + lv.idx + '/' + lv.total + ' 篇' : '本篇') + '《' + _drainQTxt(lv.title) + '》');
        if (lv.cTotal) parts.push('本条已发 <b>' + lv.sent + '/' + lv.cTotal + '</b>' + (lv.author ? ' · 正在发 @' + _drainQTxt(lv.author) : ''));
        if (parts.length) {
          const age = Math.max(0, Math.round((now - (Number(lv.at) || now)) / 1000));
          liveLine = '💬 ' + parts.join(' · ') +
            (age > 20 ? ' <span class="q-wait">（' + _drainQAgo(Number(lv.at) || now, now) + '还在发，页面可能有点慢）</span>' : '');
        }
      }
      // 🌿 日常项：页面侧每刷一篇就落一次 daily_browse_last，这里直接读它显示进度
      if (p.running.scenario === 'daily' && dbLast && !dbLast.done && dbLast.dirId === p.running.k
        && (now - (Number(dbLast.startedAt) || 0) < 30 * 60 * 1000)) {
        const picked = (dbLast.items || []).length;
        liveLine = '🌿 正在刷第 <b>' + Math.min(picked + 1, dbLast.total || picked + 1) + '/' + (dbLast.total || '?') + '</b> 篇' +
          (picked ? ' · 已刷 ' + picked + ' 篇' : '') +
          (dbLast.comments || dbLast.replies || dbLast.follows
            ? ' · 顺手评论 ' + (dbLast.comments || 0) + ' · 回复 ' + (dbLast.replies || 0) + ' · 关注 ' + (dbLast.follows || 0) : '');
      }
      // 💬 评论条队列的实时进度：正在发第几篇的第几条（执行器写 auto_water_state.live）
      html += '<div class="q-sec"><div class="q-sec-h">▶ 正在跑</div><div class="q-list">' +
        card(p.running, 'run', { carry: isCarry, live: liveLine }) + '</div></div>';
    }
    // ── ⏳ 待跑：按关键词归组，一组一行，组内显示这一批到点的类型 ──
    const todoGroups = groupByKeyword(todo);
    if (todoGroups.length) {
      html += '<div class="q-sec"><div class="q-sec-h">⏳ 待跑 <span class="q-n">' + todo.length + ' 项 · 按关键词一行</span></div><div class="q-list">' +
        todoGroups.map(g => groupCard(g, 'todo', { canFront: true, canDrop: true })).join('') +
        '</div></div>';
    } else if (!p.running) {
      html += p.waiting.length
        ? '<div class="q-hint">到点的都跑完了 👍<br>下一次到点会自动进「待跑」（见下面 🕓 还没到点）</div>'
        : '<div class="q-hint">队列是空的<br>去 <a href="#" id="qToCfg" style="color:var(--c-brand-ink);font-weight:600;">⚙️ 配置</a> 勾上「词 × 类型」或加「👤 盯的账号」，到点就会自动排进来</div>';
    }
    // ── 🕓 还没到点（折叠）：同样按关键词归组 ──
    const waitGroups = groupByKeyword(p.waiting);
    if (p.waiting.length) {
      html += '<details class="q-sec" data-q-open="wait"' + (open.wait ? ' open' : '') + '><summary class="q-sec-h">🕓 还没到点 <span class="q-n">' + p.waiting.length + ' 项 · 到点自动进待跑</span></summary>' +
        '<div class="q-list">' + waitGroups.map(g => groupCard(g, 'wait', { canFront: g[0].k !== 'daily', canDrop: false })).join('') + '</div></details>';
    }
    // ── ✅ 已完成（今天，折叠） ──
    const todayStr = new Date().toDateString();
    const doneToday = (q.done || []).filter(x => new Date(x.at).toDateString() === todayStr);
    if (doneToday.length) {
      html += '<details class="q-sec" data-q-open="done"' + (open.done ? ' open' : '') + '><summary class="q-sec-h">✅ 已完成 <span class="q-n">今天 ' + doneToday.length + ' 项</span></summary>' +
        '<div class="q-list">' + doneToday.map(x => card(x, 'done', {
          // 🌿 日常项没有"搜到几篇"，它的 foundN＝刷了几篇
          detail: (x.scenario === 'daily'
            ? (x.foundN ? '刷了 ' + x.foundN + ' 篇' : '这一轮没刷成')
              + (x.commentN ? ' · 顺手评论 ' + x.commentN + ' 条' : '') + (x.note ? ' · ' + _drainQTxt(x.note) : '')
            : (x.foundN ? '搜到 ' + x.foundN + ' 篇' : '没搜到笔记') + (x.commentN ? ' · 评论 ' + x.commentN + ' 条' : ' · 没发评论') + (x.note ? ' · ' + _drainQTxt(x.note) : '')),
        })).join('') + '</div></details>';
    }
    body.innerHTML = html;

    body.querySelectorAll('button[data-q-act]').forEach(btn => {
      btn.onclick = async () => {
        const k = btn.getAttribute('data-q-k'), sc = btn.getAttribute('data-q-s');
        const nm = btn.getAttribute('data-q-n') || k;
        if (btn.getAttribute('data-q-act') === 'front') {
          await drainQueuePushFront(k, sc, nm);   // 🌿 日常项要靠 label 记住方向名（k 只是方向 id）
          drainToast('已拎到最前：' + nm + ' × ' + _drainQType(sc));
        } else {
          await drainQueueDrop(k, sc);
          drainToast('已取消这一项：' + nm + ' × ' + _drainQType(sc) + '（配置表里的勾还在）');
        }
        await render();
      };
    });
    body.querySelectorAll('button[data-q-gact]').forEach(btn => {
      btn.onclick = async () => {
        const k = btn.getAttribute('data-q-k');
        const nm = btn.getAttribute('data-q-n') || k;
        const ss = String(btn.getAttribute('data-q-ss') || '').split('|').filter(Boolean);
        const act = btn.getAttribute('data-q-gact');
        if (act === 'front') {
          for (const sc of ss) await drainQueuePushFront(k, sc, nm);
          drainToast('已拎到最前：' + nm + '（共 ' + ss.length + ' 项）');
        } else {
          for (const sc of ss) await drainQueueDrop(k, sc);
          drainToast('已取消：' + nm + '（共 ' + ss.length + ' 项，配置表里的勾还在）');
        }
        await render();
      };
    });
    body.querySelectorAll('details[data-q-open]').forEach(d => {
      d.ontoggle = () => { open[d.getAttribute('data-q-open')] = d.open; };
    });
    const toCfg = body.querySelector('#qToCfg');
    if (toCfg) toCfg.onclick = (e) => { e.preventDefault(); _goCfg(); };
  }
  await render();
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
    try { const box = document.getElementById('drainQueueContent'); if (box) box._qTab = 'config'; } catch (_) {}
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
      /* ⚙️ 配置页：词 × 类型 的勾选网格（表头带整列节奏） */
      .sx-table.sx-pool th{white-space:normal;text-align:center;font-size:10px;font-weight:600;color:#374151;padding:4px 3px;line-height:1.4;background:#f8fafc;border-bottom:1px solid var(--line);}
      .sx-table.sx-pool th.sx-t-word{text-align:left;}
      .sx-table.sx-pool .sx-t-word{width:auto;padding:6px 6px;}
      .sx-table.sx-pool .sx-t-cell{width:70px;text-align:center;padding:6px 2px;}
      .sx-table.sx-pool .sx-t-del{width:30px;text-align:center;padding:6px 0;}
      .sx-table.sx-pool input[type=checkbox]{width:14px;height:14px;margin:0;vertical-align:middle;cursor:pointer;accent-color:var(--c-brand);}
      .sx-table.sx-pool select.sx-run{width:100%;margin-top:3px;font-size:10px;padding:2px 0;border:1px solid #e5e7eb;border-radius:6px;background:#fff;color:#374151;cursor:pointer;}
      .sx-table.sx-pool tr.is-off .sx-t-cell,.sx-table.sx-pool tr.is-off .sx-t-del{opacity:.4;}
      /* 关键词池批次分组：一批一张卡，点卡头展开/收起这一批的词（2026-10-02） */
      .sx-kwgrp{border:1px solid var(--line);border-radius:10px;margin:6px 0;overflow:hidden;background:#fff;}
      .sx-kwgrp-head{display:flex;align-items:center;gap:7px;padding:7px 10px;cursor:pointer;font-size:12px;color:#1f2937;background:#f8fafc;}
      .sx-kwgrp-head:hover{background:#f1f5f9;}
      .sx-kwgrp-caret{font-size:10px;color:#6b7280;flex:none;}
      .sx-kwgrp-name{font-weight:700;flex:none;}
      .sx-kwgrp-plan{font-size:11px;color:#6b7280;background:#fff;border:1px solid #e5e7eb;border-radius:20px;padding:1px 8px;flex:none;white-space:nowrap;}
      .sx-kwgrp-body{padding:2px 8px 8px;}
      .sx-kwgrp .sx-table.sx-pool th{background:#fff;}
      /* 词行拖拽换批：按住行首 ⠿ 拖到另一张批次卡上（2026-10-02） */
      .sx-drag{cursor:grab;color:#c7ccd4;font-size:11px;flex:none;padding:0 1px;}
      .sx-drag:active{cursor:grabbing;}
      .sx-kwgrp tr.kw-drag-src td{opacity:.4;}
      .sx-kwgrp.drag-in .sx-kwgrp-head{background:#eef6ff;box-shadow:inset 0 0 0 2px var(--c-brand-line);}
      /* ＋批次弹窗：周几排期片 + 词数计数 */
      .kbm-days{display:flex;gap:4px;flex-wrap:wrap;margin-top:2px;}
      .kbm-day{font-size:11px;border:1px solid #e5e7eb;background:#fff;border-radius:16px;padding:3px 10px;cursor:pointer;color:#4b5563;}
      .kbm-day:hover{border-color:var(--c-brand-line);}
      .kbm-day.on{border-color:var(--c-brand-line);background:var(--c-brand-soft);color:var(--c-brand-ink);font-weight:600;}
      .kbm-count{font-weight:400;color:#6b7280;font-size:11px;margin-left:6px;}
      .kbm-chip{display:inline-flex;align-items:center;gap:4px;font-size:11px;background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:2px 8px;color:#374151;cursor:pointer;}
      .sx-table.sx-pool .sx-t-ops2{width:108px;text-align:center;padding:6px 2px;white-space:nowrap;}
      .sx-table.sx-pool .sx-t-ops2 select.sx-run{width:64px;margin:0;font-size:10px;padding:2px 0;border:1px solid #e5e7eb;border-radius:6px;background:#fff;color:#374151;cursor:pointer;vertical-align:middle;}
      .sx-table.sx-pool .sx-t-ops2 .sx-ico{vertical-align:middle;}
      .sx-word{font-weight:600;color:#1f2937;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
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

  /* ---- 配置页：三张卡（🔎 跑什么 / 🌿 日常浏览 / 🎯 推广目标·承接）---- */
  const renderScanCfg = async () => {
    const r = await chrome.runtime.sendMessage({ action: 'drainGetScanCfg' });
    const cfg = (r && r.ok && r.cfg) || _drainNormalizeScanCfg({});
    const panel = _sel('sxScanCfgPanel');
    if (!panel) return;
    // 日常浏览那张卡要这一档开通了才显示（没开通就退回「跑什么」）
    const dbOn = drainDailyOn();
    if (_cfgSec === 'daily' && !dbOn) _cfgSec = 'run';
    const sec = _cfgSec;
    const max = await drainPoolMax();
    const prod = await _sxReadProduct();
    const run = cfg.typeRun || DRAIN_TYPE_RUN_DEFAULT;
    const acctRun = cfg.acctRun || DRAIN_ACCT_RUN_DEFAULT;
    const pool = cfg.keywords || [];
    const enabledN = pool.filter(e => e.on !== false).length;
    const batches = drainBatchesOf(pool, cfg);
    /* 批次＝列表外层骨架（2026-10-02）：curBatch 是顶部回车加词 / 候选入池的落点批；首次进来只有一个批次就自动展开 */
    const curBatch = () => (_kwCur && batches.indexOf(_kwCur) >= 0) ? _kwCur : DRAIN_DEFAULT_BATCH;
    if (!_kwInited) { _kwInited = true; if (batches.length <= 1) _kwOpen[DRAIN_DEFAULT_BATCH] = true; }
    const now = Date.now();
    const save = async (next) => {
      await chrome.runtime.sendMessage({ action: 'drainSaveScanCfg', cfg: Object.assign({}, cfg, next) });
      // 词池变了 → 获客那排关键词标签同步刷新（同一份真源）
      try { if (typeof window._kwBarReload === 'function') await window._kwBarReload(); } catch (_) {}
      await renderScanCfg();
    };
    const agoTxt = (ts) => {
      if (!ts) return '没跑过';
      const mins = Math.round((now - ts) / 60000);
      return mins < 1 ? '刚跑过' : (mins < 60 ? mins + ' 分钟前' : Math.round(mins / 60) + ' 小时前');
    };
    const srcTag = (s) => ({ ai: '<span style="color:#7c3aed;">AI</span>', topic: '<span style="color:#2563eb;">话题</span>' }[s] || '<span style="color:#9ca3af;">手填</span>');
    const runVal = (m) => (m.mode === 'each' ? 'each' : (m.mode === 'off' ? 'off' : 'interval:' + m.hours));
    const runTxt = (m) => (m.mode === 'each' ? '每轮跑' : (m.mode === 'off' ? '不跑' : '每' + m.hours + '小时'));
    /* 表头那行的节奏下拉：整列通用，设一次全列生效
       kind='acct' → 盯的账号那两列（写 cfg.acctRun，与词池那几列互不影响） */
    const runSelect = (scenario, m, kind) => {
      const acct = kind === 'acct';
      const val = runVal(m);
      const hrs = DRAIN_RUN_PRESETS.slice();
      if (m.mode === 'interval' && hrs.indexOf(m.hours) < 0) hrs.push(m.hours);
      return `<select class="sx-run" data-${acct ? 'arun' : 'trun'}="${scenario}" title="${escAttr(acct ? '盯人节奏：隔多久进他主页看一次新笔记（整列通用，与词池那张表分开）' : '这一类多久跑一次（整列通用，设一次就行）')}">
        <option value="each" ${val === 'each' ? 'selected' : ''}>每轮跑</option>
        ${hrs.map(h => `<option value="interval:${h}" ${val === 'interval:' + h ? 'selected' : ''}>每${h}小时</option>`).join('')}
        <option value="off" ${val === 'off' ? 'selected' : ''}>不跑</option>
      </select>`;
    };
    const cols = DRAIN_TYPE_META;
    /* 展开区里的词 × 类型表：表头带整列节奏；行末小下拉＝划去别的批，✕＝移除 */
    const poolHead = () => `<thead>
          <tr>
            <th class="sx-t-word">关键词</th>
            ${cols.map(m => {
              const sc = drainScenarioDef(m.scenario);
              return `<th class="sx-t-cell" title="${escAttr(m.tip)}">${sc.icon}${DRAIN_TYPE_SHORT[m.scenario] || ''}<br>${runSelect(m.scenario, run[m.scenario] || DRAIN_TYPE_RUN_DEFAULT[m.scenario])}</th>`;
            }).join('')}
            <th class="sx-t-ops2" title="行末小下拉＝把这个词划去别的批次；✕＝从词池移除">批次 / 移除</th>
          </tr>
        </thead>`;
    const poolRows = (list) => list.map((e) => {
      const on = e.on !== false;
      const last = Math.max(0, ...cols.map(m => drainPassState(e, m.scenario, cfg, now).lastAt));
      const kk = escAttr(e.k);
      return `<tr${on ? '' : ' class="is-off"'} draggable="true" data-poolrow="${kk}">
          <td class="sx-t-word">
            <label style="display:flex;align-items:center;gap:5px;overflow:hidden;">
              <span class="sx-drag" title="按住拖到别的批次卡上＝把这个词挪过去">⠿</span>
              <input type="checkbox" data-poolon="${kk}" ${on ? 'checked' : ''} title="${escAttr(on ? '停用：不参与搜索，词还留在池里' : '启用这个词')}">
              <span class="sx-word" title="${escAttr(e.k)}">${escHtml(e.k)}</span>
              ${srcTag(e.src)}
              <span class="sx-count" style="margin-left:auto;flex:none;">${agoTxt(last)}</span>
            </label>
          </td>
          ${cols.map(m => `<td class="sx-t-cell">
            <input type="checkbox" data-cell="${kk}|${m.scenario}" ${drainWordTypeOn(e, m.scenario) ? 'checked' : ''} ${on ? '' : 'disabled'} title="${escAttr(drainScenarioDef(m.scenario).label + '：勾上＝这个词也跑这一类')}">
          </td>`).join('')}
          <td class="sx-t-ops2">
            <select class="sx-run" data-poolbatch="${kk}" title="划去别的批次（同一批共用一个「周几跑」排期）">${batches.map(b => `<option value="${escAttr(b)}" ${drainBatchName(e) === b ? 'selected' : ''}>${escHtml(b)}</option>`).join('')}</select>
            <button type="button" class="sx-ico sx-ico-del" data-pooldel="${kk}" title="从词池移除">✕</button>
          </td>
        </tr>`;
    }).join('');
    /* 一批一张卡：卡头＝摘要（词数/启用数 + 周几跑）+「＋ 关键词」+（非默认批）删批；点卡头展开/收起词表 */
    const groupsHtml = batches.map((b) => {
      const words = pool.filter(e => drainBatchName(e) === b);
      const onWords = words.filter(e => e.on !== false).length;
      const allOn = words.length > 0 && onWords === words.length;
      const open = !!_kwOpen[b];
      const plan = (cfg.batchPlan || {})[b];
      const planDays = Array.isArray(plan) ? plan : [];
      const planTxt = planDays.length ? planDays.map(d => WK_LABELS[d] || d).join('·') : '每天跑';
      /* 周几跑就挂在这张卡的卡头上（2026-10-24 从「队列 → 队列配置」搬来）：不点＝每天跑 */
      const todayWd = new Date(now).getDay();
      const wdChips = [1, 2, 3, 4, 5, 6, 0].map(d =>
        `<button type="button" class="qm-wd${planDays.indexOf(d) >= 0 ? ' on' : ''}${d === todayWd ? ' today' : ''}" data-kwplan="${escAttr(b)}" data-kwd="${d}" title="${escAttr(b + ' · ' + (WK_LABELS[d] || '') + '跑这一批')}">${WK_LABELS[d] || ''}</button>`).join('');
      const isDef = b === DRAIN_DEFAULT_BATCH;
      const body = !open ? '' : `<div class="sx-kwgrp-body">${words.length
        ? `<table class="sx-table sx-pool">${poolHead()}<tbody>${poolRows(words)}</tbody></table>`
        : `<div class="sx-empty" style="padding:12px 10px;line-height:1.8;">${isDef && !pool.length ? '词池是空的：在顶部输入框加词（回车进展开中的批次），或点「✨ 找词 / 🏷 话题」从候选里勾。' : '这批还没有词：点卡头上的「＋ 关键词」往「' + escHtml(b) + '」里加词。'}</div>`}</div>`;
      return `<div class="sx-kwgrp" data-kwgroup="${escAttr(b)}">
        <div class="sx-kwgrp-head" data-kwtoggle="${escAttr(b)}" title="点一下${open ? '收起' : '展开'}这一批的关键词（周几在卡头上点）">
          <input type="checkbox" data-kwgroupsel="${escAttr(b)}" ${allOn ? 'checked' : ''} ${words.length ? '' : 'disabled'} style="width:14px;height:14px;margin:0;flex:none;cursor:pointer;accent-color:var(--c-brand);" title="全选这一批：勾上＝这批词全部启用，取消＝全部停用（词和勾选都留着）">
          <span class="sx-kwgrp-caret">${open ? '▾' : '▸'}</span>
          <span class="sx-kwgrp-name">🗂 ${escHtml(b)}${b === curBatch() ? '<span style="font-weight:400;color:#9ca3af;font-size:11px;"> · 当前</span>' : ''}</span>
          <span class="sx-count">${words.length} 词 · 启用 ${onWords}</span>
          <span class="qm-wds" data-kwplanbox="${escAttr(b)}" title="这一批哪几天跑（不点＝每天跑）；今日 ${escAttr(WK_LABELS[todayWd] || '')}：${escAttr(planTxt)}">${wdChips}</span>
          <span style="flex:1;"></span>
          <button type="button" class="btn btn-sm" data-kwgrpadd="${escAttr(b)}" title="往「${escAttr(b)}」这批加关键词">＋ 关键词</button>
          ${isDef ? '' : `<button type="button" class="sx-ico sx-ico-del" data-kwgrpdel="${escAttr(b)}" title="删掉这个批次：这批的词退回「默认」批（词和勾选都留着）">✕</button>`}
        </div>
        ${body}
      </div>`;
    }).join('');
    const candHtml = !_cand ? '' : `
      <div style="margin:6px 0;padding:8px 10px;background:#fffdf5;border:1px solid #fde68a;border-radius:8px;">
        <div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#92400e;">
          <span>候选（${_cand.label}）${_cand.loading ? '· 正在找…' : '共 ' + _cand.items.length + ' 个'}</span>
          <span style="flex:1;"></span>
          ${_cand.loading ? '' : `<button type="button" class="btn btn-sm" id="sxCandAll">全选</button>
          <button type="button" class="btn btn-sm btn-primary" id="sxCandAdopt">勾选的入池</button>
          <button type="button" class="btn btn-sm" id="sxCandClose">关</button>`}
        </div>
        ${_cand.loading ? '' : `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
          ${_cand.items.map(x => `<label style="display:inline-flex;align-items:center;gap:4px;background:#fff;border:1px solid #fde68a;border-radius:20px;padding:2px 9px;font-size:11px;color:#374151;">
            <input type="checkbox" data-cand="${escHtml(x.k)}" ${x.def === false ? '' : 'checked'}> ${escHtml(x.k)}${x.n ? '<span style="color:#9ca3af;">×' + x.n + '</span>' : ''}</label>`).join('')}
        </div>`}
      </div>`;
    /* ── 👤 盯的账号：一行一个主页（昵称 + 主页链接），勾哪列＝按哪列跑法走 ── */
    const accts = (cfg.accounts || []);
    const acctRows = accts.map((a, i) => {
      const pid = _drainProfileId(a.k);
      const sub = a.name ? ('主页 ID · ' + (pid || a.k)) : String(a.k);
      return `<tr${a.on === false ? ' class="is-off"' : ''}>
        <td class="sx-t-word">
          <label style="display:flex;align-items:center;gap:5px;">
            <input type="checkbox" data-accton="${i}" ${a.on !== false ? 'checked' : ''} title="${escAttr(a.on !== false ? '停用：不跑这个主页' : '启用')}">
            <span class="sx-word" title="${escAttr(a.k)}">${escHtml(drainAccountLabel(a))}</span>
            <span class="sx-count" style="margin-left:auto;flex:none;">${agoTxt(drainAccountState(a, cfg, now).lastAt)}</span>
          </label>
          <div class="sx-count" style="margin-left:19px;word-break:break-all;">${escHtml(sub)}</div>
        </td>
        <td class="sx-t-cell"><input type="radio" name="acct${i}" data-acctsc="${i}|highv" ${a.scenario !== 'rival' ? 'checked' : ''} ${a.on === false ? 'disabled' : ''} title="借头部流量：发一条露脸热评 + 扫评论区收商机"></td>
        <td class="sx-t-cell"><input type="radio" name="acct${i}" data-acctsc="${i}|rival" ${a.scenario === 'rival' ? 'checked' : ''} ${a.on === false ? 'disabled' : ''} title="只蹲人不评论：扫评论区把有商机的人收进获客清单去私信"></td>
        <td class="sx-t-del"><button type="button" class="sx-ico sx-ico-del" data-acctdel="${i}" title="取消盯这个账号">✕</button></td>
      </tr>`;
    }).join('');
    const acctHtml = `
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;">
        <span style="font-size:12px;font-weight:600;color:#1f2937;">👤 盯的账号<span class="qhelp" tabindex="0" data-tip="盯人走主页：进他的个人主页扒最近的笔记（不是拿名字去搜，搜名字会漏会串）。右边两列勾哪列就按哪列的跑法走，节奏在表头设——这一张表的节奏与「关键词池」那张表相互独立（「拿竞品名去搜」和「进他主页扒」可以各设各的间隔）。">?</span></span>
        <span class="sx-count">共 ${accts.length} · 启用 ${accts.filter(a => a.on !== false).length}</span>
        <span style="flex:1;"></span>
        <button type="button" class="btn btn-sm" id="sxAcctGrab">📥 抓当前页主页</button>
        <input class="sx-in" id="sxAcctAdd" placeholder="粘主页链接后回车" style="width:160px;margin:0;">
      </div>
      <table class="sx-table sx-pool">
        <thead>
          <tr>
            <th class="sx-t-word">账号（主页）</th>
            <th class="sx-t-cell" title="${escAttr('借头部流量：发一条露脸热评 + 扫评论区收商机')}">👑高V<br>${runSelect('highv', acctRun.highv, 'acct')}</th>
            <th class="sx-t-cell" title="${escAttr('只蹲人不评论：扫评论区把有商机的人收进获客清单去私信')}">🕵️竞对<br>${runSelect('rival', acctRun.rival, 'acct')}</th>
            <th class="sx-t-del"></th>
          </tr>
        </thead>
        <tbody>${acctRows || `<tr><td colspan="4"><div class="sx-empty" style="padding:12px 10px;line-height:1.8;">还没盯人：打开一个博主的主页，点「📥 抓当前页主页」；或把他的主页链接粘到上面输入框回车。</div></td></tr>`}</tbody>
      </table>
    `;
    /* ── ① 📚 关键词池：批次手风琴分组（点卡头展开词）＋ 批/词管理弹窗（2026-10-02 改版）── */
    /* 新建批次的弹窗：批名 + 这一批的词（实时去重计数、可从「默认」批勾带）+ 周几跑，一次配好 */
    const defKws = pool.filter(e => drainBatchName(e) === DRAIN_DEFAULT_BATCH && e.on !== false);
    const kwBatchModalHtml = `
      <div class="modal-mask" id="kwBatchModal">
        <div class="modal-box" style="max-width:520px;">
          <h3>新建批次 · 名字 + 词 + 周几跑，一次配好</h3>
          <div class="profile-field"><label>批次名（≤10 字，不能叫「默认」）</label>
            <input id="kbmName" class="sx-in" style="margin:0;" maxlength="10" placeholder="例：装修批">
            <div class="sx-hint" id="kbmMsg" style="margin:4px 0 0;min-height:14px;"></div>
          </div>
          <div class="profile-field"><label>这一批的关键词<span class="kbm-count" id="kbmCount">已 0 个</span></label>
            <textarea id="kbmKw" class="sx-in" style="min-height:74px;margin:0;box-sizing:border-box;line-height:1.7;" placeholder="多个词用逗号 / 空格 / 换行分隔&#10;例：装修攻略, 装修避坑, 旧房改造"></textarea>
            ${defKws.length ? `<details class="fdet" style="margin-top:6px;">
              <summary>也可以从「默认」批勾 ${defKws.length} 个词带过来</summary>
              <div id="kbmPick" style="display:flex;flex-wrap:wrap;gap:6px;max-height:120px;overflow:auto;padding:4px 0;">${defKws.map(x => '<label class="kbm-chip"><input type="checkbox" data-kbm-pick="' + escAttr(x.k) + '"> ' + escHtml(x.k) + '</label>').join('')}</div>
            </details>` : ''}
          </div>
          <div class="profile-field"><label>周几跑<span class="kbm-count">不勾＝每天跑；之后在批次卡头上也能改</span></label>
            <div class="kbm-days">${WK_LABELS.map((w, i) => '<button type="button" class="kbm-day" data-kbmd="' + i + '">' + w + '</button>').join('')}</div>
          </div>
          <div class="modal-footer">
            <button type="button" id="kbmCancel">取消</button>
            <button type="button" class="primary" id="kbmSave">建批次</button>
          </div>
        </div>
      </div>`;
    /* 给选定批次加 / 管理关键词的弹窗 */
    const kwAddModalHtml = `
      <div class="modal-mask" id="kwAddModal">
        <div class="modal-box" style="max-width:460px;">
          <h3>＋ 关键词 · 加到哪一批</h3>
          <div class="profile-field"><label>加到哪一批</label><select id="kwamBatch" class="sx-in" style="margin:0;">${batches.map(b => `<option value="${escAttr(b)}" ${curBatch() === b ? 'selected' : ''}>${escHtml(b)}</option>`).join('')}</select></div>
          <div class="profile-field"><label>新增关键词（逗号 / 换行分隔；已存在的词会被划进这一批）</label><textarea id="kwamKw" class="sx-in" style="min-height:66px;margin:0;box-sizing:border-box;line-height:1.7;" placeholder="例：书房改造, 全屋定制"></textarea></div>
          <div class="sx-hint" id="kwamMsg" style="margin:2px 0 0;"></div>
          <div class="modal-footer">
            <button type="button" id="kwamCancel">取消</button>
            <button type="button" class="primary" id="kwamSave">保存</button>
          </div>
        </div>
      </div>`;
    const kwHtml = `
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;">
        <span style="font-size:12px;font-weight:600;color:#1f2937;">📚 关键词池<span class="qhelp" tabindex="0" data-tip="批次是外层分组：一批一张卡，点卡头展开/收起这一批的词；卡头最左「全选」勾＝整批词一键启用/停用（部分启用时是半选）。挪词两种：拖词行首的 ⠿ 到别的批次卡上，或用词行末小下拉划过去。顶部输入框回车＝往带「当前」标记的那批加词；「＋ 关键词」在批次卡头上＝往那一批加；「＋ 批次」一次配好名字、词和周几跑。展开的词表：一行一个词、一列一种搜法，勾上＝这个词跑这一类，表头节奏整列通用；✕＝从池里移除，取消勾＝停用（词和勾选都留着）。同一批的「周几跑」就在这张卡的卡头上点。🕵️竞对那列默认不勾——要蹲同行，把竞品名加成一个词、单独勾它这一格。">?</span></span>
        <button type="button" class="btn btn-sm" id="sxKwBatchAdd" title="新建一个批次，并一次配好这一批的关键词">＋ 批次</button>
        <span style="flex:1;"></span>
        <input class="sx-in" id="sxKwAdd" placeholder="回车加词 → 「${escAttr(curBatch())}」批" style="width:172px;margin:0;" title="输入关键词回车：加进带「当前」标记的那一批（点某批的卡头就换当前批）">
        <button type="button" class="btn btn-sm" id="sxKwAi">✨ 找词</button>
        <button type="button" class="btn btn-sm" id="sxKwTopic">🏷 话题</button>
      </div>
      ${candHtml}
      ${groupsHtml}
    `;
    /* ── ③ 🎯 推广目标 & 评论区承接：评论 / 回复里 AI 怎么接话、引对方去哪 ──
       存 product.promoGoal / product.guideText / product.guidePhrase —— 与后台的引导规则、截流评论的承接是同一份真源，
       所以这里直接在 config 上读写，别另存一份（2026-09-25 从「诊断&配置 → 基础配置」搬过来）。
       目标固定＝「引流到个人主页」（2026-10-01 简：删下拉、只留两个输入框） */
    const goalHtml = `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
        <span style="font-size:12px;font-weight:600;color:#1f2937;">🎯 推广目标</span>
        <span style="font-size:11px;color:#6b7280;">引流到个人主页</span>
        <span style="flex:1;"></span>
        <button type="button" class="btn btn-sm btn-primary" id="sxGoalSave">💾 保存</button>
      </div>
      ${SX_GOAL_FIELD(prod, '评论区承接', 'sxGoalGuide', 'guideText', '例：点头像进我的主页', 30)}
      ${SX_GOAL_FIELD(prod, '引导话术（可选）', 'sxGoalPhrase', 'guidePhrase', '例：更多干货我平时发在主页', 40)}
      <div class="sx-hint" id="sxGoalMsg" style="margin:8px 0 0;color:#6b7280;">评论 / 回复里 AI 会按上面两句引导（承接 + 话术）。</div>
    `;
    /* ── ④ 🌿 日常浏览：开关 + 方向（列表看摘要，编辑进弹窗）+ 塞入规则 + 节奏与概率 + 句池 + 状态区 ──
       它是队列里的一种流程项（泛刷一轮），只记自己的账：不进消息 / 通知 / 线索 / 评论记录 */
    const dbC = (typeof DailyBrowse !== 'undefined') ? await DailyBrowse.getConfig() : null;
    const dbD = (typeof DailyBrowse !== 'undefined') ? await DailyBrowse.getDaily() : null;
    const dbEveryN = dbC ? (Number(dbC.insert && dbC.insert.everyN) || 0) : 0;
    const dbAu = (dbC && dbC.autorun) || { enabled: false, from: '09:00', to: '18:00' };
    const dbProg = (dbC && typeof DailyBrowse !== 'undefined') ? DailyBrowse.progress(dbC, dbD, Date.now()) : [];
    const dbDirs = (dbC && dbC.directions) || [];
    const dbNum = (key, label, val, min, max, unit, tip) =>
      '<label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:#374151;margin-right:10px;" title="' + escAttr(tip || '') + '">' + label +
      '<input type="number" data-dbn="' + key + '" value="' + val + '" min="' + min + '" max="' + max + '"' +
      ' style="width:54px;padding:3px 6px;border:1px solid #e5e7eb;border-radius:6px;font-size:12px;text-align:center;outline:none;">' + (unit || '') + '</label>';
    const dbWinTxt = (d) => (d.windows && d.windows.length) ? d.windows.map(w => w.start + '-' + w.end).join('、') : '全天';
    const dbDirRows = dbDirs.map((d) => {
      const x = dbProg.find(y => y.dir.id === d.id) || { used: 0, inWindow: false };
      const kws = (d.keywords || []).length
        ? '词 ' + d.keywords.length + ' 个：' + d.keywords.slice(0, 4).map(escHtml).join(' / ') + (d.keywords.length > 4 ? ' …' : '')
        : '走首页推荐（不带词）';
      return '<tr' + (d.enabled === false ? ' class="is-off"' : '') + '>' +
        '<td class="sx-t-word">' +
          '<label style="display:flex;align-items:center;gap:5px;overflow:hidden;">' +
            '<input type="checkbox" data-dbdir="' + escAttr(d.id) + '"' + (d.enabled === false ? '' : ' checked') + ' title="' + escAttr(d.enabled === false ? '启用这个方向' : '停用：不参与轮转，方向还留着') + '">' +
            '<span class="sx-word">🌿 ' + escHtml(d.name) + '</span>' +
            (x.inWindow ? '' : '<span class="sx-judge gray" style="padding:1px 6px;">不在时段</span>') +
            '<span class="sx-count" style="margin-left:auto;flex:none;">' + x.used + '/' + d.dailyQuota + ' 篇</span>' +
          '</label>' +
          '<div class="sx-count" style="margin-left:19px;">' + kws + ' · ' + dbWinTxt(d) + ' · 权重 ' + d.weight + '</div>' +
        '</td>' +
        '<td class="sx-t-del" style="width:84px;text-align:center;padding:6px 0;">' +
          '<button type="button" class="sx-ico" data-dbpush="' + escAttr(d.id) + '" title="把这一轮插到队首（跟着队列串行跑）">▶</button>' +
          '<button type="button" class="sx-ico" data-dbedit="' + escAttr(d.id) + '" title="编辑方向：名字 / 关键词 / 时段 / 日配额 / 权重">✎</button>' +
          '<button type="button" class="sx-ico sx-ico-del" data-dbdel="' + escAttr(d.id) + '" title="删掉这个方向">✕</button>' +
        '</td>' +
      '</tr>';
    }).join('');
    /* 折叠块的摘要行：一眼看到当前值（改完旋钮会跟着刷新，见 paintDbSums） */
    const dbSumOf = (c) => ({
      round: c.perRound + ' 篇/轮 · 停留 ' + c.dwellMin + '~' + c.dwellMax + ' 秒 · 打开 ' + c.openRate + '% · 赞 ' + c.likeRate + '% · 藏 ' + c.collectRate + '%',
      social: '💬 评论 ≤' + c.comment.dailyMax + '/天 · ↩️ 回复 ≤' + c.reply.dailyMax + '/天 · ➕ 关注 ≤' + c.follow.dailyMax + '/天',
    });
    const dbS = dbC ? dbSumOf(dbC) : { round: '', social: '' };
    const dailyHtml = !dbC ? '<div class="sx-empty" style="padding:14px 10px;">这一档没开通「日常浏览」。</div>' : `
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;">
        <span style="font-size:12px;font-weight:600;color:#1f2937;">🌿 日常浏览</span>
        <span class="qhelp" tabindex="0" data-tip="队列里的一种流程项：泛刷一轮（可带顺手互动），只记自己的账。它和「词 × 类型」的格子排在同一条时间轴上串行跑：「每 N 格插 1 轮」「每天自动跑」在这张卡底下配，这里定刷什么方向、一轮怎么刷、互动比例。这里刷了什么、赞藏评了什么，不进消息 / 通知 / 线索 / 评论记录，也不会在笔记池上打标。">?</span>
        <label style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#374151;">
          <input type="checkbox" id="dbOn"${dbC.enabled ? ' checked' : ''}> 开启
        </label>
        <span style="flex:1;"></span>
        <button type="button" class="btn btn-sm" id="dbStop" title="让当前这一轮刷完手上这篇就停；队列里其他项不受影响。点过它，今天不会再自动拉起（明天照常）">⏹ 停止本轮</button>
      </div>
      <div id="dbStatus" style="background:#f8fafc;border:1px solid #eef0f3;border-radius:8px;padding:7px 10px;font-size:12px;color:#374151;line-height:1.7;margin-bottom:8px;"></div>
      <div class="sx-sec-h first">方向 <span class="qhelp" tabindex="0" data-tip="一个方向＝一类内容（例：读书 / 家居），各配自己的关键词、时段与日配额；轮转时只在「已启用 + 时段内 + 没满配额」的方向里挑。">?</span><span style="flex:1;"></span><button type="button" class="btn btn-sm" id="dbAddDir">＋ 加方向</button></div>
      <table class="sx-table sx-pool">
        <thead><tr><th class="sx-t-word">方向</th><th class="sx-t-del" style="width:84px;">操作</th></tr></thead>
        <tbody>${dbDirRows || '<tr><td colspan="2"><div class="sx-empty" style="padding:12px 10px;">还没有方向，点右上「＋ 加方向」</div></td></tr>'}</tbody>
      </table>
      <details class="fdet" id="dbDetRound"${_dbDetOpen.round ? ' open' : ''}>
        <summary>一轮怎么刷 <span class="fdet-sum" id="dbSumRound">${dbS.round}</span><span class="fdet-x">改</span></summary>
        <div class="fdet-body">
          <div style="display:flex;align-items:center;flex-wrap:wrap;">
            ${dbNum('perRound', '一轮', dbC.perRound, 1, 8, '篇')}
            ${dbNum('dwellMin', '单篇停留', dbC.dwellMin, 3, 120, '~', '每一篇停留多久（秒），在这个区间里随机')}
            ${dbNum('dwellMax', '', dbC.dwellMax, 3, 300, '秒', '同左')}
            ${dbNum('openRate', '打开', dbC.openRate, 0, 100, '%', '刷到的笔记里打开细看（含点赞收藏评论）的比例')}
            ${dbNum('likeRate', '点赞', dbC.likeRate, 0, 100, '%')}
            ${dbNum('collectRate', '收藏', dbC.collectRate, 0, 100, '%')}
          </div>
          <div class="sx-count" style="margin-top:2px;">按篇的概率，不是每篇都做</div>
        </div>
      </details>
      <details class="fdet" id="dbDetSocial"${_dbDetOpen.social ? ' open' : ''}>
        <summary>顺手互动 <span class="qhelp" tabindex="0" data-tip="评论 / 回复由 AI 说一句自然的话（不推销、不带联系方式）；回复只挑「有回复价值」的（提问 / 有经历 / 有情绪）。">?</span><span class="fdet-sum" id="dbSumSocial">${dbS.social}</span><span class="fdet-x">改</span></summary>
        <div class="fdet-body">
          <div style="display:flex;align-items:center;flex-wrap:wrap;">
            ${dbNum('comment.rate', '💬 评论：打开的笔记里', dbC.comment.rate, 0, 100, '%')}
            ${dbNum('comment.dailyMax', '每天最多', dbC.comment.dailyMax, 0, 100, '条')}
            ${dbNum('reply.dailyMax', '↩️ 回复别人的评论：每天最多', dbC.reply.dailyMax, 0, 100, '条', '挑"有回复价值"的评论回一句（提问 / 有经历 / 有情绪）')}
            ${dbNum('follow.rate', '➕ 关注作者：打开的笔记里', dbC.follow.rate, 0, 100, '%')}
            ${dbNum('follow.dailyMax', '每天最多', dbC.follow.dailyMax, 0, 100, '个')}
          </div>
          <div class="sx-count" style="margin-top:2px;">上限填 0＝这个动作不做</div>
        </div>
      </details>
      <div class="sx-sec-h">什么时候跑 <span class="qhelp" tabindex="0" data-tip="这里是唯一入口（队列页只看状态）：每 N 个获客格插 1 轮日常浏览；「每天自动跑」是指到了时段自己把整条队列拉起来。">?</span><span style="flex:1;"></span><button type="button" class="btn btn-sm btn-primary" id="qmDbSave">💾 保存</button></div>
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;">
        <label style="font-size:12px;color:#374151;">每 <input type="number" id="qmEveryN" min="0" max="20" value="${dbEveryN}" style="width:52px;padding:3px 6px;border:1px solid #e5e7eb;border-radius:6px;font-size:12px;text-align:center;"> 格获客插 1 轮</label>
        <span class="sx-count">（0＝不自动插，只在队列页手动塞一轮）</span>
      </div>
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:6px;">
        <label style="font-size:12px;color:#374151;"><input type="checkbox" id="qmAutoOn"${dbAu.enabled ? ' checked' : ''}> 每天自动跑</label>
        <input id="qmFrom" maxlength="5" value="${escAttr(String(dbAu.from || '09:00'))}" style="width:60px;padding:3px 6px;border:1px solid #e5e7eb;border-radius:6px;font-size:12px;text-align:center;">
        <span class="sx-count">→</span>
        <input id="qmTo" maxlength="5" value="${escAttr(String(dbAu.to || '18:00'))}" style="width:60px;padding:3px 6px;border:1px solid #e5e7eb;border-radius:6px;font-size:12px;text-align:center;">
        <span class="sx-count">（起止一样＝全天）</span>
      </div>
    `;
    /* 方向的编辑弹窗：挂在卡片外面（<details> 收起时里面的内容不渲染，弹窗会跟着点不出来） */
    const dbModalHtml = `
      <div class="modal-mask" id="dbModal"><div class="modal-box" style="max-width:420px;">
        <h3 id="dbModalTitle">编辑方向</h3>
        <div class="profile-field"><label>方向名（≤10 字）</label><input id="dbMName" maxlength="10" placeholder="例：读书"></div>
        <div class="profile-field"><label>关键词（逗号分隔；留空＝走首页推荐泛刷）</label><input id="dbMKw" placeholder="例：读书笔记, 好书推荐"></div>
        <div class="profile-field"><label>时段（留空＝全天；多段用逗号隔开，可跨零点）</label><input id="dbMWin" placeholder="例：09:00-11:30, 20:00-22:30"></div>
        <div style="display:flex;gap:8px;">
          <div class="profile-field" style="flex:1;"><label>每日上限（篇）</label><input id="dbMQuota" type="number" min="1" max="300"></div>
          <div class="profile-field" style="flex:1;"><label>轮转权重（1~5，越大越常被挑中）</label><input id="dbMWeight" type="number" min="1" max="5"></div>
        </div>
        <div class="sx-hint" id="dbMMsg" style="margin:0;"></div>
        <div class="modal-footer">
          <button type="button" id="dbMCancel">取消</button>
          <button type="button" class="primary" id="dbMSave">保存</button>
        </div>
      </div></div>
    `;
    /* 三张卡（2026-10-24 合并）：🔎 跑什么（词池＋盯的账号两张表） / 🌿 日常浏览 / 🎯 推广目标·承接。
       一次全画出来（下面那几百行事件绑定照旧全挂），开合交给原生 details；开一张就收起别的 */
    const runSum = batches.length + ' 批 · ' + pool.length + ' 词 / ' + accts.length + ' 账号 · 启用 ' + enabledN;
    const dailySum = !dbC ? '这一档没开通' : ((dbC.enabled ? '开' : '关') + ' · 今日刷 ' + ((dbD && dbD.count) || 0) + ' 篇');
    const goalSum = '承接：' + ((prod && prod.guideText) || '还没填');
    panel.innerHTML = `
      <details class="cfgcard" data-cfgsec="run"${sec === 'run' ? ' open' : ''}>
        <summary class="cfgcard-h">
          <span class="cfgcard-t">🔎 跑什么</span>
          <span class="cfgcard-s">${escHtml(runSum)}</span>
          <span class="cfgcard-x">一行一种跑法；周几在批次卡头上</span>
          <span class="cfgcard-chev">▾</span>
        </summary>
        <div class="cfgcard-b">${kwHtml}${acctHtml}</div>
      </details>
      <details class="cfgcard" data-cfgsec="daily"${sec === 'daily' ? ' open' : ''}${dbOn ? '' : ' style="display:none;"'}>
        <summary class="cfgcard-h">
          <span class="cfgcard-t">🌿 日常浏览</span>
          <span class="cfgcard-s">${escHtml(dailySum)}</span>
          <span class="cfgcard-x">不占「跑什么」的表，按自己的规则插进队列中间</span>
          <span class="cfgcard-chev">▾</span>
        </summary>
        <div class="cfgcard-b">${dailyHtml}</div>
      </details>
      <details class="cfgcard" data-cfgsec="goal"${sec === 'goal' ? ' open' : ''}>
        <summary class="cfgcard-h">
          <span class="cfgcard-t">🎯 推广目标 · 承接</span>
          <span class="cfgcard-s">${escHtml(goalSum)}</span>
          <span class="cfgcard-x">只管 AI 在评论 / 回复里怎么接话，不占排期</span>
          <span class="cfgcard-chev">▾</span>
        </summary>
        <div class="cfgcard-b">${goalHtml}</div>
      </details>
      ${kwBatchModalHtml}
      ${kwAddModalHtml}
      ${dbModalHtml}
    `;
    panel.querySelectorAll('details[data-cfgsec]').forEach(d => {
      d.ontoggle = () => {
        if (!d.open) return;
        _cfgSec = d.getAttribute('data-cfgsec');
        panel.querySelectorAll('details[data-cfgsec]').forEach(o => { if (o !== d) o.open = false; });
      };
    });

    /* 🎯 推广目标：两张卡都画在页上，所以这里不带「当前是哪张卡」的条件，一进来就挂 */
    {
      const goalMsg = _sel('sxGoalMsg');
      const goalSave = _sel('sxGoalSave');
      if (goalSave) goalSave.onclick = async () => {
        const guide = String((_sel('sxGoalGuide') && _sel('sxGoalGuide').value) || '').trim();
        const phrase = String((_sel('sxGoalPhrase') && _sel('sxGoalPhrase').value) || '').trim();
        goalSave.disabled = true;
        if (goalMsg) { goalMsg.style.color = '#6b7280'; goalMsg.textContent = '正在保存…'; }
        try {
          // 目标固定＝引流到个人主页（2026-10-01 简），承接与话术是评论 / 回复里的引导文案
          await _sxSaveProduct({ promoGoal: 'profile', guideText: guide, guidePhrase: phrase });
          if (goalMsg) { goalMsg.style.color = '#0a8f4c'; goalMsg.textContent = '✅ 已保存：评论 / 回复按这个承接 + 话术走。'; }
          drainToast('🎯 推广目标已保存（引流到个人主页）');
        } catch (e) {
          if (goalMsg) { goalMsg.style.color = '#dc2626'; goalMsg.textContent = '❌ 保存失败：' + ((e && e.message) || e) + '，可重试。'; }
        } finally { goalSave.disabled = false; }
      };
    }

    /* 🌿 日常浏览：开关 / 方向增删改（编辑进弹窗）/ 塞入规则与旋钮 / 句池 / 状态区 / 停止本轮 */
    if (dbC) {
      /* 状态区：今日刷了多少（各方向）、顺手互动、每天自动跑实况 */
      const paintDbStatus = async () => {
        const box = _sel('dbStatus');
        if (!box) return;
        const c = await DailyBrowse.getConfig();
        const dl = await DailyBrowse.getDaily();
        const prog = DailyBrowse.progress(c, dl, Date.now());
        const parts = prog.filter(x => x.dir.enabled).map(x => escHtml(x.dir.name) + ' ' + x.used + '/' + x.dir.dailyQuota);
        const l1 = '🌿 今日刷 <b>' + (dl.count || 0) + '</b> 篇' + (parts.length ? '（' + parts.join(' · ') + '）' : '') +
          '　💬 评论 ' + (dl.comments || 0) + ' · 回复 ' + (dl.replies || 0) + ' · 关注 ' + (dl.follows || 0) + '　已跑 ' + (dl.rounds || 0) + ' 轮';
        /* 保底时钟这一行的实况：在跑 / 被停按住 / 出过状况 / 等下一个时段 */
        let l3 = '';
        if (c.autorun.enabled) {
          const nowMs = Date.now();
          const hold = await DailyBrowse.autoHoldUntil();
          const broke = (await chrome.storage.local.get('daily_browse_broken')).daily_browse_broken;
          const rs = (await chrome.storage.local.get('daily_browse_run_state')).daily_browse_run_state || {};
          let st;
          if (rs.running) st = '<b style="color:#0a8f4c;">正在跑</b>';
          else if (hold > nowMs) st = '<span style="color:#d97706;">今天被「停止本轮」按住，不再自动拉起（点「🤖 开始」即刻恢复）</span>';
          else if (broke && (nowMs - (Number(broke.at) || 0)) < 30 * 60000) st = '<span style="color:#dc2626;">连续 3 次没跑起来，歇 30 分钟再看（先确认小红书页面正常，或点「🤖 开始」手动跑一趟）</span>';
          else st = DailyBrowse.autorunOn(c, nowMs) ? '时段内：到点会自己把队列拉起来' : ('还没到时段（' + escHtml(c.autorun.from) + ' 开始）');
          l3 = '⏰ 每天自动跑 ' + escHtml(c.autorun.from) + '–' + escHtml(c.autorun.to) + '：' + st;
        } else {
          l3 = '⏰ 每天自动跑：<span style="color:#6b7280;">关（打开＝不用守着点开始，时段内整条队列自己跑）</span>';
        }
        box.innerHTML = '<div>' + l1 + '</div><div>' + l3 + '</div>' +
          (c.enabled ? '' : '<div style="color:#d97706;">日常浏览是关的：队列不会自动排它（手插的一轮照跑；随时可以再开）</div>');
      };
      const dbSave = async (patch) => {
        try { await DailyBrowse.saveConfig(patch); }
        catch (e) { drainToast('保存失败：' + ((e && e.message) || e), 'warn'); }
      };
      /* 折叠块的摘要行：旋钮改完就地刷新（整页重渲染会丢输入焦点，所以只刷这一行） */
      const paintDbSums = async () => {
        const s = dbSumOf(await DailyBrowse.getConfig());
        const a = _sel('dbSumRound'), b = _sel('dbSumSocial');
        if (a) a.textContent = s.round;
        if (b) b.textContent = s.social;
      };
      /* 问号只管出说明：点在折叠标题里的问号，别顺手把那个块收起来 */
      panel.querySelectorAll('.qhelp').forEach(h => h.onclick = (e) => { e.preventDefault(); e.stopPropagation(); });
      [['dbDetRound', 'round'], ['dbDetSocial', 'social']].forEach(p => {
        const d = _sel(p[0]);
        if (d) d.ontoggle = () => { _dbDetOpen[p[1]] = d.open; };
      });
      await paintDbStatus();

      const onBox = _sel('dbOn');
      if (onBox) onBox.onchange = async () => {
        await dbSave({ enabled: onBox.checked });
        drainToast(onBox.checked ? '🌿 日常浏览已开启：队列会按塞入规则排它' : '🌿 日常浏览已关：队列不再自动排它（手插的一轮照跑）');
        await paintDbStatus();
      };
      const stopBtn = _sel('dbStop');
      if (stopBtn) stopBtn.onclick = async () => {
        await DailyBrowse.stop();
        drainToast('⏹ 已发出停止：这一轮刷完手上这篇就停（今天不再自动拉起）');
        await paintDbStatus();
      };
      /* 什么时候跑（每 N 格插 1 轮 + 每天自动跑时段）：2026-10-24 从「队列 → 队列配置」搬回这张卡 */
      const dbAutoSave = _sel('qmDbSave');
      if (dbAutoSave) dbAutoSave.onclick = async () => {
        const everyNVal = Math.max(0, parseInt((_sel('qmEveryN') || {}).value || '0', 10) || 0);
        const from = String((_sel('qmFrom') || {}).value || '').trim();
        const to = String((_sel('qmTo') || {}).value || '').trim();
        if (!/^\d{1,2}:\d{2}$/.test(from) || !/^\d{1,2}:\d{2}$/.test(to)) { drainToast('时段要写成 09:00 这样（起止一样＝全天）', 'warn'); return; }
        const autoOn = !!(_sel('qmAutoOn') || {}).checked;
        await DailyBrowse.saveConfig({ insert: Object.assign({}, dbC.insert, { everyN: everyNVal }), autorun: { enabled: autoOn, from: from, to: to } });
        drainToast('🌿 已保存：每 ' + everyNVal + ' 格插 1 轮，每天自动跑 ' + (autoOn ? (from === to ? '全天' : from + '–' + to) : '关'));
        try { chrome.runtime.sendMessage({ action: 'dailyAutoKick' }); } catch (_) {}
        await renderScanCfg();
      };
      // 数字旋钮：改了就存（不整页重渲染，输入框不失焦）
      panel.querySelectorAll('[data-dbn]').forEach(el => el.onchange = async () => {
        const key = el.getAttribute('data-dbn');
        const v = parseInt(el.value, 10);
        if (!isFinite(v)) return;
        const patch = {};
        if (key.indexOf('.') > 0) {
          const parts = key.split('.');
          patch[parts[0]] = Object.assign({}, dbC[parts[0]] || {}, { [parts[1]]: v });
        } else patch[key] = v;
        await dbSave(patch);
        await paintDbSums();
        await paintDbStatus();
      });
      // 方向：启用 / 塞一轮 / 编辑（弹窗）/ 删除
      panel.querySelectorAll('[data-dbdir]').forEach(c => c.onchange = async () => {
        const id = c.getAttribute('data-dbdir');
        const next = dbDirs.map(d => d.id === id ? Object.assign({}, d, { enabled: c.checked }) : d);
        await DailyBrowse.saveConfig({ directions: next });
        drainToast(c.checked ? '🌿 已启用这个方向' : '🌿 已停用（方向还留着，随时能再开）');
        await renderScanCfg();
      });
      panel.querySelectorAll('[data-dbpush]').forEach(b => b.onclick = async () => {
        const id = b.getAttribute('data-dbpush');
        const d = dbDirs.find(x => x.id === id) || {};
        await drainQueuePushFront(id, 'daily', d.name || id);
        if (typeof window.__xhsExecDaily === 'function') {
          const r = await window.__xhsExecDaily(id, d.name || id);
          if (!r || !r.ok) drainToast('🌿 已插到队首，但派给执行器没成：' + ((r && r.error) || '未知'), 'warn');
          else drainToast(r.delivered ? '🌿 已插到队首，执行器当场开跑' : '🌿 已插到队首——执行器不在线，等它上线就跑', 'ok');
        } else {
          drainToast('🌿 已把「' + (d.name || id) + '」这一轮插到队首');
        }
      });
      panel.querySelectorAll('[data-dbdel]').forEach(b => b.onclick = async () => {
        const id = b.getAttribute('data-dbdel');
        if (dbDirs.length <= 1) { drainToast('至少留一个方向（可以只留一个泛刷）', 'warn'); return; }
        const d = dbDirs.find(x => x.id === id) || {};
        if (!window.confirm('删掉方向「' + (d.name || id) + '」？它排着的这一轮也会一起撤掉。')) return;
        await DailyBrowse.saveConfig({ directions: dbDirs.filter(x => x.id !== id) });
        await drainQueueDrop(id, 'daily');
        drainToast('已删掉方向：' + (d.name || id));
        await renderScanCfg();
      });
      /* 编辑弹窗：新建（d=null）与编辑共用；关键词逗号分隔、时段写 09:00-11:30（留空＝全天） */
      const modal = _sel('dbModal');
      let dbEditing = '';
      const msg = (t, bad) => { const el = _sel('dbMMsg'); if (el) { el.style.color = bad ? '#dc2626' : '#6b7280'; el.textContent = t || ''; } };
      const openDirModal = (d) => {
        dbEditing = d ? d.id : '';
        const t = _sel('dbModalTitle'); if (t) t.textContent = d ? ('编辑方向：' + d.name) : '加一个方向';
        _sel('dbMName').value = d ? d.name : '';
        _sel('dbMKw').value = d ? (d.keywords || []).join(', ') : '';
        _sel('dbMWin').value = d ? ((d.windows || []).map(w => w.start + '-' + w.end).join(', ')) : '';
        _sel('dbMQuota').value = d ? d.dailyQuota : 40;
        _sel('dbMWeight').value = d ? d.weight : 1;
        msg('');
        if (modal) modal.classList.add('open');
      };
      const closeDirModal = () => { if (modal) modal.classList.remove('open'); };
      panel.querySelectorAll('[data-dbedit]').forEach(b => b.onclick = () => {
        openDirModal(dbDirs.find(x => x.id === b.getAttribute('data-dbedit')) || null);
      });
      const addBtn = _sel('dbAddDir');
      if (addBtn) addBtn.onclick = () => {
        if (dbDirs.length >= DailyBrowse.DIR_MAX) { drainToast('方向最多 ' + DailyBrowse.DIR_MAX + ' 个', 'warn'); return; }
        openDirModal(null);
      };
      const cancelBtn = _sel('dbMCancel');
      if (cancelBtn) cancelBtn.onclick = closeDirModal;
      const saveBtn = _sel('dbMSave');
      if (saveBtn) saveBtn.onclick = async () => {
        const name = String((_sel('dbMName') || {}).value || '').trim();
        if (!name) { msg('给这个方向起个名字（例：读书）', true); return; }
        const kws = String((_sel('dbMKw') || {}).value || '').split(/[\s,，、;；]+/).map(s => s.trim()).filter(Boolean);
        const wtxt = String((_sel('dbMWin') || {}).value || '');
        const wins = [];
        const re = /(\d{1,2}:\d{2})\s*[-~到至]\s*(\d{1,2}:\d{2})/g;
        let m;
        while ((m = re.exec(wtxt))) wins.push({ start: m[1], end: m[2] });
        if (wtxt.trim() && !wins.length) { msg('时段写法看不懂：照 09:00-11:30 这样写，多段用逗号隔开（留空＝全天）', true); return; }
        const quota = parseInt((_sel('dbMQuota') || {}).value, 10);
        const weight = parseInt((_sel('dbMWeight') || {}).value, 10);
        const cur = await DailyBrowse.getConfig();
        const fields = { name, keywords: kws, windows: wins.slice(0, 3), dailyQuota: quota, weight: weight };
        const next = dbEditing
          ? cur.directions.map(d => d.id === dbEditing ? Object.assign({}, d, fields) : d)
          : cur.directions.concat([Object.assign({}, DailyBrowse.newDirection(cur.directions.length), fields)]);
        await DailyBrowse.saveConfig({ directions: next });
        closeDirModal();
        drainToast('🌿 方向已保存：' + name);
        await renderScanCfg();
      };
    }

    /* 词：启用 / 移除（2026-10-01 起用词名做键，列表可按批次筛选，行内不再用下标） */
    panel.querySelectorAll('[data-poolon]').forEach(c => c.onchange = () => {
      const k = c.getAttribute('data-poolon');
      const next = pool.map(e => Object.assign({}, e));
      if (c.checked && enabledN >= max) { c.checked = false; drainToast(`启用中的词已达本版本上限（${max} 个），先停用一个再加`, 'warn'); return; }
      const it = next.find(x => x.k === k);
      if (it) it.on = c.checked;
      save({ keywords: next });
    });
    /* 格：这个词跑不跑这一类 */
    panel.querySelectorAll('[data-cell]').forEach(c => c.onchange = () => {
      const p = c.getAttribute('data-cell').split('|');
      const next = pool.map(e => Object.assign({}, e, { types: Object.assign({}, e.types) }));
      const it = next.find(x => x.k === p[0]);
      if (it) it.types[p[1]] = c.checked;
      save({ keywords: next });
    });
    /* 节奏：整列设一次，全列生效 */
    panel.querySelectorAll('select[data-trun]').forEach(sel => sel.onchange = () => {
      const scenario = sel.getAttribute('data-trun');
      const v = sel.value;
      const one = v === 'each' ? { mode: 'each' }
        : (v === 'off' ? { mode: 'off' } : { mode: 'interval', hours: Math.max(1, parseInt(v.split(':')[1], 10) || DRAIN_MODE_HOURS_DEFAULT) });
      const nextRun = Object.assign({}, run);
      nextRun[scenario] = one;
      save({ typeRun: nextRun });
      drainToast(`${drainScenarioDef(scenario).icon}${DRAIN_TYPE_SHORT[scenario] || ''} 改成「${runTxt(one)}」`);
    });
    /* 节奏（盯的账号）：整列设一次；与词池那几列分开存，改这里不影响搜索列 */
    panel.querySelectorAll('select[data-arun]').forEach(sel => sel.onchange = () => {
      const scenario = sel.getAttribute('data-arun');
      const v = sel.value;
      const one = v === 'each' ? { mode: 'each' }
        : (v === 'off' ? { mode: 'off' } : { mode: 'interval', hours: Math.max(1, parseInt(v.split(':')[1], 10) || DRAIN_MODE_HOURS_DEFAULT) });
      const nextRun = Object.assign({}, acctRun);
      nextRun[scenario] = one;
      save({ acctRun: nextRun });
      drainToast(`👤 盯人（${scenario === 'rival' ? '🕵️竞对' : '👑高V'}）改成「${runTxt(one)}」`);
    });
    panel.querySelectorAll('[data-pooldel]').forEach(b => b.onclick = () => {
      const k = b.getAttribute('data-pooldel');
      save({ keywords: pool.filter(x => x.k !== k) });
      drainToast('已从词池移除「' + k + '」');
    });
    /* 👤 盯的账号：启用 / 换类型 / 取消盯 */
    panel.querySelectorAll('[data-accton]').forEach(c => c.onchange = () => {
      const i = parseInt(c.getAttribute('data-accton'), 10);
      const next = accts.map(a => Object.assign({}, a));
      next[i].on = c.checked;
      save({ accounts: next });
    });
    panel.querySelectorAll('[data-acctsc]').forEach(r => r.onchange = () => {
      if (!r.checked) return;
      const p = r.getAttribute('data-acctsc').split('|');
      const i = parseInt(p[0], 10);
      const next = accts.map(a => Object.assign({}, a));
      next[i].scenario = p[1] === 'rival' ? 'rival' : 'highv';
      save({ accounts: next });
      drainToast('已改成 ' + (next[i].scenario === 'rival' ? '🕵️竞对（只蹲人不评论）' : '👑高V（发露脸热评借流量）'));
    });
    panel.querySelectorAll('[data-acctdel]').forEach(b => b.onclick = () => {
      const i = parseInt(b.getAttribute('data-acctdel'), 10);
      save({ accounts: accts.filter((_, j) => j !== i) });
      drainToast('已取消盯这个账号');
    });
    const acctAdd = _sel('sxAcctAdd');
    const acctAddOne = (url, name) => {
      if (!/^https?:\/\/[^/]*xiaohongshu\.com\/user\/profile\//.test(url)) {
        drainToast('要博主主页链接：打开他的主页→复制网址，或点「📥 抓当前页主页」', 'warn');
        return false;
      }
      const pid = _drainProfileId(url);
      if (accts.some(a => (pid && _drainProfileId(a.k) === pid) || a.k === url)) { drainToast('这个主页已经在盯了', 'warn'); return false; }
      save({ accounts: accts.concat([{ k: url, name: (name || '').trim(), on: true, scenario: 'highv' }]) });
      drainToast('已加入：' + (name || pid || url) + '（默认 👑高V，右边两列可换）');
      return true;
    };
    if (acctAdd) acctAdd.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const v = String(acctAdd.value || '').trim();
      if (!v) return;
      if (acctAddOne(v, '')) acctAdd.value = '';
    });
    const acctGrab = _sel('sxAcctGrab');
    if (acctGrab) acctGrab.onclick = async () => {
      acctGrab.disabled = true;
      acctGrab.textContent = '抓取中…';
      let d;
      try { d = await drainGrabActiveProfile(); } catch (err) { drainToast('抓取失败：' + ((err && err.message) || err), 'warn'); }
      acctGrab.disabled = false;
      acctGrab.textContent = '📥 抓当前页主页';
      if (d === undefined) return;
      if (!d) { drainToast('当前不在博主主页：要停在 xiaohongshu.com/user/profile/… 那个页面', 'warn'); return; }
      acctAddOne(d.url, d.name);
    };
    const kwAdd = _sel('sxKwAdd');
    if (kwAdd) kwAdd.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const v = kwAdd.value.trim();
      if (!v) return;
      kwAdd.value = '';
      const batch = curBatch();
      _kwOpen[batch] = true;
      const hit = pool.find(x => x.k === v);
      if (hit) {
        if (hit.on === false) {
          if (enabledN >= max) { drainToast(`启用中的词已达上限（${max} 个）`, 'warn'); return; }
          save({ keywords: pool.map(x => Object.assign({}, x, { on: x.k === v, batch: (x.k === v ? batch : x.batch) })) });
          drainToast('已重新启用 ' + v + '（划到批次「' + batch + '」）');
        } else if (drainBatchName(hit) === batch) {
          drainToast('这个词已在池里');
        } else {
          save({ keywords: pool.map(x => Object.assign({}, x, { batch: (x.k === v ? batch : x.batch) })) });
          drainToast('已把 ' + v + ' 划到批次「' + batch + '」');
        }
        return;
      }
      if (pool.length >= max) { drainToast(`词池已达本版本上限（${max} 个），先移除一个再加`, 'warn'); return; }
      save({ keywords: pool.map(x => Object.assign({}, x)).concat(_drainPoolEntry(v, { src: 'manual', batch: batch })) });
      drainToast('已加词「' + v + '」（批次：' + batch + '）');
    });
    const kwAi = _sel('sxKwAi'); if (kwAi) kwAi.onclick = () => fetchAiCandidates();
    const kwTopic = _sel('sxKwTopic'); if (kwTopic) kwTopic.onclick = () => fetchTopicCandidates();
    /* 批次（行末小下拉）：把这个词划去别的批，划完展开目标批让词看得见 */
    panel.querySelectorAll('[data-poolbatch]').forEach(sel => sel.onchange = () => {
      const k = sel.getAttribute('data-poolbatch');
      const next = pool.map(e => Object.assign({}, e, { batch: (e.k === k ? sel.value : e.batch) }));
      _kwOpen[sel.value] = true;
      save({ keywords: next });
      drainToast('「' + k + '」已划到批次「' + sel.value + '」（周几在批次卡头上点）');
    });
    /* 批次卡头上的「周几」：点一下就切换这一天跑不跑（全不点＝每天跑） */
    panel.querySelectorAll('button[data-kwplan]').forEach(btn => btn.onclick = async (ev) => {
      ev.stopPropagation();
      const b = btn.getAttribute('data-kwplan');
      const d = Number(btn.getAttribute('data-kwd'));
      const plan = Object.assign({}, cfg.batchPlan || {});
      const curDays = Array.isArray(plan[b]) ? plan[b].slice() : [];
      const i = curDays.indexOf(d);
      if (i >= 0) curDays.splice(i, 1); else curDays.push(d);
      plan[b] = curDays.slice().sort((x, y) => x - y);
      await save({ batchPlan: plan });
      drainToast('批次「' + b + '」改为：' + (curDays.length ? curDays.map(x => WK_LABELS[x] || x).join('、') : '每天'));
    });
    /* 批次卡头：点一下展开/收起（落在按钮/勾选框上的点击不算），展开的那批＝当前批 */
    panel.querySelectorAll('[data-kwtoggle]').forEach(h => h.onclick = (ev) => {
      if (ev.target.closest('button, input')) return;
      const b = h.getAttribute('data-kwtoggle');
      _kwOpen[b] = !_kwOpen[b];
      if (_kwOpen[b]) _kwCur = b;
      renderScanCfg();
    });
    /* 卡头「全选」：勾/取消＝整批词一键启用/停用；部分启用显示半选 */
    panel.querySelectorAll('[data-kwgroupsel]').forEach(box => {
      const b = box.getAttribute('data-kwgroupsel');
      const ws = pool.filter(e => drainBatchName(e) === b);
      const onN2 = ws.filter(e => e.on !== false).length;
      box.indeterminate = onN2 > 0 && onN2 < ws.length;
      box.onchange = () => {
        if (box.checked) {
          const need = ws.length - onN2;
          if (enabledN + need > max) {
            box.checked = false; box.indeterminate = onN2 > 0 && onN2 < ws.length;
            drainToast(`启用中的词已达本版本上限（${max} 个），先停用一些再全选`, 'warn');
            return;
          }
        }
        const next = pool.map(e => drainBatchName(e) === b ? Object.assign({}, e, { on: box.checked }) : Object.assign({}, e));
        save({ keywords: next });
        drainToast(box.checked ? `已全选「${b}」：${ws.length} 个词都启用` : `已取消「${b}」整批：${ws.length} 个词停用（词和勾选都留着）`);
      };
    });
    /* 卡头「＋ 关键词」：弹窗预挑到这一批 */
    const openKwAddModal = (b) => {
      _kwCur = b; _kwOpen[b] = true;
      _modalMsg('kwamMsg', '');
      const m = _openModal('kwAddModal', true);
      if (m) {
        const s = m.querySelector('#kwamBatch'); if (s) s.value = b;
        const kw = m.querySelector('#kwamKw'); if (kw) { kw.value = ''; setTimeout(() => kw.focus(), 60); }
      }
    };
    panel.querySelectorAll('[data-kwgrpadd]').forEach(btn => btn.onclick = (ev) => {
      ev.stopPropagation();
      openKwAddModal(btn.getAttribute('data-kwgrpadd'));
    });
    /* 卡头 ✕：删批次，这批的词退回「默认」批（词和勾选都留着） */
    panel.querySelectorAll('[data-kwgrpdel]').forEach(btn => btn.onclick = async (ev) => {
      ev.stopPropagation();
      const b = btn.getAttribute('data-kwgrpdel');
      const n = pool.filter(e => drainBatchName(e) === b).length;
      if (!window.confirm('删掉批次「' + b + '」？' + (n ? '这批的 ' + n + ' 个词退回「默认」批（词和勾选都留着）。' : ''))) return;
      delete _kwOpen[b];
      if (_kwCur === b) _kwCur = '';
      await save({
        keywords: pool.map(e => drainBatchName(e) === b ? Object.assign({}, e, { batch: DRAIN_DEFAULT_BATCH }) : Object.assign({}, e)),
        batches: (cfg.batches || []).filter(x => x !== b),
      });
      drainToast('已删批次「' + b + '」' + (n ? '，' + n + ' 个词退回「默认」批' : ''));
    });
    /* 词行 ⇄ 批次卡：拖拽换批（2026-10-02）——按住行首 ⠿ 把词拖到另一张批次卡（含卡头）即划过去 */
    const KW_DRAG_TYPE = 'application/x-xhs-kw';
    panel.querySelectorAll('[data-poolrow]').forEach(tr => {
      tr.ondragstart = (ev) => {
        const k = tr.getAttribute('data-poolrow');
        try { ev.dataTransfer.setData(KW_DRAG_TYPE, k); } catch (_) {}
        ev.dataTransfer.setData('text/plain', k);   // 兜底：部分环境只认标准类型
        ev.dataTransfer.effectAllowed = 'move';
        tr.classList.add('kw-drag-src');
      };
      tr.ondragend = () => tr.classList.remove('kw-drag-src');
    });
    panel.querySelectorAll('.sx-kwgrp').forEach(grp => {
      const b = grp.getAttribute('data-kwgroup');
      grp.ondragover = (ev) => {
        if (Array.from(ev.dataTransfer.types || []).indexOf(KW_DRAG_TYPE) < 0) return;
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'move';
        grp.classList.add('drag-in');
      };
      grp.ondragleave = (ev) => {
        if (!ev.relatedTarget || !grp.contains(ev.relatedTarget)) grp.classList.remove('drag-in');
      };
      grp.ondrop = (ev) => {
        ev.preventDefault();
        grp.classList.remove('drag-in');
        const k = ev.dataTransfer.getData(KW_DRAG_TYPE) || ev.dataTransfer.getData('text/plain');
        const it = k && pool.find(x => x.k === k);
        if (!it || drainBatchName(it) === b) return;
        const next = pool.map(e => Object.assign({}, e, { batch: (e.k === k ? b : e.batch) }));
        _kwOpen[b] = true;
        save({ keywords: next });
        drainToast('已把「' + k + '」拖进批次「' + b + '」');
      };
    });
    const _openModal = (id, open) => { const el = _sel(id); if (el) el.classList.toggle('open', open); return el; };
    /* ＋批次：弹窗新建，一次配好批次名 + 这一批的关键词 */
    const _modalMsg = (elId, txt, bad) => { const m = _sel(elId); if (m) { m.style.color = bad ? '#dc2626' : '#6b7280'; m.textContent = txt || ''; } };
    const kbmSave = async () => {
      const name = String((_sel('kbmName') || {}).value || '').trim();
      if (!name) { _modalMsg('kbmMsg', '给这一批起个名字（不能叫「默认」）', true); return; }
      if (name === DRAIN_DEFAULT_BATCH) { _modalMsg('kbmMsg', '这个批名是保留名，换一个', true); return; }
      const typed = String((_sel('kbmKw') || {}).value || '').split(/[\s,，、;；]+/).map(s => s.trim()).filter(Boolean);
      const picked = Array.from(((_sel('kbmPick') || document.createElement('div')).querySelectorAll('input[data-kbm-pick]:checked') || [])).map(x => x.getAttribute('data-kbm-pick'));
      const words = Array.from(new Set([...typed, ...picked]));
      if (!words.length) { _modalMsg('kbmMsg', '至少给这一批放一个关键词（能直接输，也能从「默认」批勾带）', true); return; }
      const list = (cfg.batches || []).slice();
      if (list.indexOf(name) >= 0) { _modalMsg('kbmMsg', '批次「' + name + '」已存在！', true); return; }
      list.push(name);
      const days = Array.from(panel.querySelectorAll('.kbm-day.on')).map(x => parseInt(x.getAttribute('data-kbmd'), 10));
      const byKey = new Map(pool.map(x => [x.k, x]));
      const next = pool.map(e => Object.assign({}, e, { batch: (words.indexOf(e.k) >= 0 ? name : e.batch) }));
      for (const w of words) {
        if (byKey.has(w)) continue;
        next.push(_drainPoolEntry(w, { src: 'manual', batch: name, on: true }));
      }
      const plan = Object.assign({}, cfg.batchPlan || {});
      plan[name] = days;   // 不勾＝空数组＝每天跑（与「队列 → 队列配置」同一真源）
      await save({ keywords: next, batches: list, batchPlan: plan });
      _kwCur = name; _kwOpen[name] = true;   // 建完直接展开这一批，当场能配词
      drainToast('批次「' + name + '」已建：' + words.length + ' 个词 · ' + (days.length ? days.map(d => WK_LABELS[d]).join('/') : '每天跑'));
      _openModal('kwBatchModal', false);
      await renderScanCfg();
    };
    const kbmAdd = _sel('sxKwBatchAdd');
    if (kbmAdd) kbmAdd.onclick = () => {
      _modalMsg('kbmMsg', '');
      const m = _openModal('kwBatchModal', true);
      if (!m) return;
      const nameIn = m.querySelector('#kbmName'); if (nameIn) nameIn.value = '';
      const ta = m.querySelector('#kbmKw'); if (ta) ta.value = '';
      m.querySelectorAll('input[data-kbm-pick]').forEach(c => { c.checked = false; });
      m.querySelectorAll('.kbm-day').forEach(x => x.classList.remove('on'));
      /* 词数实时计数（输入 + 勾带 去重后）；周几片点击切换 */
      const cnt = m.querySelector('#kbmCount');
      const paintCount = () => {
        const t = String((ta && ta.value) || '').split(/[\s,，、;；]+/).map(s => s.trim()).filter(Boolean);
        const p = Array.from(m.querySelectorAll('input[data-kbm-pick]:checked')).map(c => c.getAttribute('data-kbm-pick'));
        if (cnt) cnt.textContent = '已 ' + new Set([...t, ...p]).size + ' 个';
      };
      if (ta) ta.oninput = paintCount;
      m.querySelectorAll('input[data-kbm-pick]').forEach(c => { c.onchange = paintCount; });
      m.querySelectorAll('.kbm-day').forEach(x => { x.onclick = () => x.classList.toggle('on'); });
      paintCount();
      setTimeout(() => { if (nameIn) nameIn.focus(); }, 60);
    };
    const kbmCancel = _sel('kbmCancel'); if (kbmCancel) kbmCancel.onclick = () => _openModal('kwBatchModal', false);
    const kbmSaveBtn = _sel('kbmSave'); if (kbmSaveBtn) kbmSaveBtn.onclick = kbmSave;
    /* ＋关键词（卡头上）：往选定批次加词 / 划词进来 */
    const kwamSave = async () => {
      const name = _sel('kwamBatch') ? _sel('kwamBatch').value : curBatch();
      const typed = String((_sel('kwamKw') || {}).value || '').split(/[\s,，、;；]+/).map(s => s.trim()).filter(Boolean);
      if (!typed.length) { _modalMsg('kwamMsg', '填几个要加的关键词', true); return; }
      _kwCur = name; _kwOpen[name] = true;
      const byKey = new Map(pool.map(x => [x.k, x]));
      const next = pool.map(e => Object.assign({}, e, { batch: (typed.indexOf(e.k) >= 0 ? name : e.batch) }));
      for (const w of typed) {
        if (byKey.has(w)) continue;
        next.push(_drainPoolEntry(w, { src: 'manual', batch: name, on: true }));
      }
      await save({ keywords: next });
      drainToast('已往批次「' + name + '」加了 ' + typed.length + ' 个词');
      _openModal('kwAddModal', false);
      await renderScanCfg();
    };
    const kwamCancel = _sel('kwamCancel'); if (kwamCancel) kwamCancel.onclick = () => _openModal('kwAddModal', false);
    const kwamSaveBtn = _sel('kwamSave'); if (kwamSaveBtn) kwamSaveBtn.onclick = kwamSave;
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
        const next = pool.map(e => Object.assign({}, e, { types: Object.assign({}, e.types) }));
        const byKey = new Map(next.map(e => [e.k, e]));
        let onN = next.filter(e => e.on !== false).length, added = 0, back = 0, skip = 0;
        for (const k of picked) {
          const hit = byKey.get(k);
          if (hit) {
            if (hit.on === false) { if (onN < max) { hit.on = true; onN++; back++; } else skip++; }
            else skip++;
            continue;
          }
          if (next.length >= max || onN >= max) { skip++; continue; }
          const ne = _drainPoolEntry(k, { src: _cand.kind, batch: curBatch() });   // 候选勾进来的词落到当前批
          next.push(ne); byKey.set(k, ne); onN++; added++;
        }
        drainToast(`入池 ${added + back} 个` + (skip ? `，${skip} 个因上限/已在池跳过` : ''), (added + back) ? 'ok' : 'warn');
        _cand = null;
        _kwOpen[curBatch()] = true;   // 落点批展开，入的词看得见
        save({ keywords: next });
      };
    }

    // 补开弹窗内容 / 上次扫描那行：每重渲染一次就得重挂一次
    await renderReplCfg();
    await renderLastScan();
  };

  /* ---- 候选区：AI 找词 / 话题采集 → 勾选入池（不直接塞进池子） ---- */
  const fetchAiCandidates = async () => {
    const cfg = await drainGetScanCfg();
    const max = await drainPoolMax();
    _cfgSec = 'run';   // 候选区在「跑什么」这张卡里，别让用户回来找
    _cand = { kind: 'ai', label: 'AI 找词', loading: true, items: [] };
    await renderScanCfg();
    try {
      const need = Math.min(15, Math.max(8, max));
      const r = await chrome.runtime.sendMessage({ action: 'aiGenKeywords', data: { need, exclude: (cfg.keywords || []).map(e => e.k) } });
      if (!r || r.ok === false) throw new Error((r && r.error) || 'AI 找词失败');
      _cand = { kind: 'ai', label: 'AI 找词（按人设/卖点/知识库/问卷）', items: (r.keywords || []).map(k => ({ k })) };
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
    _cand = { kind: 'topic', label: '话题采集池', items: list.slice(0, 40).map(x => ({ k: x.tag, n: x.n, def: (x.n || 0) >= 2 })) };
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
    .replace(/\{pain\}/g, (data && data.painText) || (data && data.noteTitle) || '用户正在求助的原文');
  return cheap(pick);
}

/* 引导承接：唯一真源＝产品配置（获客 → 任务配置 → 🎯 推广目标的「评论区承接」），没有才用默认站内承接 */
function drainResolveGuide(config) {
  const p = String(((config && config.product) || {}).guideText || '').trim();
  return p || DRAIN_GUIDE_DEFAULT;
}

async function handleDrainComment(data) {
  const sc = (SCENARIO_DRAIN || []).find(s => s.scenario === (data && data.scenario));
  if (!sc) throw new Error('未知截流场景: ' + (data && data.scenario));
  const config = await Storage.getConfig();
  const aiCfg = Object.assign({}, config.ai || {}, { maxTokens: 900 });
  if (!aiCfg.apiKey && !aiCfg.fallbackApiKey) throw new Error('尚未配置 AI（请在设置里填 API Key）');
  const product = (config.product && config.product.name) || '本产品';
  const guide = drainResolveGuide(config);
  const payload = Object.assign({}, data, { product, guide });
  const r = await AiClient.chatCompletion(aiCfg, _fillSentiment(sc.system, payload), _fillSentiment(sc.user, payload));
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