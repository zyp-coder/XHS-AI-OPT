/** demo-accounts.mjs — 随便逛逛：8 个固定公用演示号 + 母婴/教培/儿童体适能三套底子
 *
 * 装修建材的底子复用账号模板里那套样例（seedDemoData 已经铺好），这里只补母婴、教培、儿童体适能三套。
 * 演示号是 kind='demo' 的正式账号：能生成、能出片、能逛档案；底子（人设/卖点/知识库/规划）只读，
 * 不能真发、不能真跑获客。8 个号固定存在，访客改动保留，不重置、不自动恢复。
 */

export const DEMO_ACCOUNTS = [
  { id: 'demo_deco_full',  key: 'deco',      group: 'industry', industry: '装修建材', name: '装修建材',              tier: '全功能', desc: '瓷砖 · 卫浴 · 五金' },
  { id: 'demo_baby_full',  key: 'baby',      group: 'industry', industry: '母婴',     name: '母婴',                  tier: '全功能', desc: '奶粉 · 纸尿裤 · 辅食' },
  { id: 'demo_edu_full',   key: 'edu',       group: 'industry', industry: '教培',     name: '教培',                  tier: '全功能', desc: '少儿硬笔书法' },
  { id: 'demo_kidsport_full', key: 'kidsport', group: 'industry', industry: '儿童体适能', name: '儿童体适能',        tier: '全功能', desc: '平衡 · 协调 · 力量 · 灵敏' },
  { id: 'demo_tier_free',  key: 'tier_free', group: 'tier', industry: '装修建材', name: '建材档位体验 · 免费',   tier: '免费',   desc: '共用三格 + 发笔记只到写稿' },
  { id: 'demo_tier_basic', key: 'tier_basic', group: 'tier', industry: '装修建材', name: '建材档位体验 · 基础',   tier: '基础',   desc: '共用三格 + 发笔记 + 字效编辑器' },
  { id: 'demo_tier_pro',   key: 'tier_pro',  group: 'tier', industry: '装修建材', name: '建材档位体验 · 升级',   tier: '升级',   desc: '基础版 + 获客 · 日常浏览' },
  { id: 'demo_tier_full',  key: 'tier_full', group: 'tier', industry: '装修建材', name: '建材档位体验 · 全功能', tier: '全功能', desc: '升级版 + 线索' },
];

export const DEMO_IDS = new Set(DEMO_ACCOUNTS.map((d) => d.id));
export const DEMO_BY_KEY = Object.fromEntries(DEMO_ACCOUNTS.map((d) => [d.key, d]));

const GOAL = {
  howto: '抓一个具体的痛点，把解决方案直接给出来——冷启动期收藏是最快的权重',
  tale: '把知识库抽象成一段故事讲出来，让人第一次刷到就记住你是干什么的、信你不骗人',
  echo: '写一个大家都不敢承认的情绪，换共鸣与评论',
  meme: '用梗点套选题，最容易被转发，把圈外人带进来',
  hot: '借本周热点破圈，扩大曝光面',
};

const MIX = [
  { type: 'howto', goal: GOAL.howto, ex: '一个能立刻照做的判断标准（3 步 / 一张表）', count: 4, share: 30 },
  { type: 'tale', goal: GOAL.tale, ex: '把一道工艺 / 一段来路，换成古人的同类事讲一遍', count: 3, share: 25 },
  { type: 'echo', goal: GOAL.echo, ex: '一件大家心里都有、嘴上不说的事', count: 2, share: 20 },
  { type: 'meme', goal: GOAL.meme, ex: '把这件事写成一份判决书 / 一套游戏任务', count: 2, share: 15 },
  { type: 'hot', goal: GOAL.hot, ex: '这周大家都在聊的那件事，你怎么看', count: 1, share: 10 },
];

/** 文生图配文用的通用画面词（不写进卖点，只作为出图时的行业气息） */
export const INDUSTRY_FOUNDATIONS = {
  baby: {
    accountType: '个人IP/创始人型',
    coverHook: '开母婴店 9 年、两个娃的妈',
    contentFocus: '奶粉、纸尿裤、辅食怎么选、怎么买——用 9 年开店经验帮新手爸妈少交智商税',
    targetPeople: '新手爸妈（正在囤待产包、选奶粉、换纸尿裤）',
    persona: {
      text: [
        '我是在本地开母婴店的（示例账号），开店 9 年，自己也是两个孩子的妈妈。奶粉、纸尿裤、辅食、洗护，店里每天都在跟这些东西打交道，见过太多新手爸妈被“网红清单”和“越贵越好”带着走。',
        '我不爱推最贵的，也不制造焦虑：先看配料表、段位和适用月龄，再看预算。红屁屁、湿疹、过敏这些，我不做诊断，只把自己见过的、门店里验证过的做法说清楚，拿不准就让你去医院。',
        '这个号就干一件事：把 9 年开店和带两个娃的经验写出来，帮新手爸妈把该买的买对、不该囤的别囤。拿不准的先来问一句，比完价再来也行。',
      ].join('\n\n'),
      card: {
        identity: '本地母婴店店主，两个孩子的妈妈，开店 9 年',
        proof: '服务过上千个新手家庭；奶粉纸尿裤辅食一手渠道；自己带大两个孩子',
        story: '从给自己娃选口粮开始，后来索性开了一家母婴店',
        stance: '不推最贵的；不制造焦虑；不做医疗诊断；不贬低同行',
        catchphrase: '先看配料表，再谈价格',
        taboo: '不承诺“绝对不过敏”，不做医疗诊断，不贬低同行',
        address: '宝妈宝爸',
      },
    },
    sellPoints: [
      { title: '九年只做母婴', content: '开店 9 年、自己带大两个娃，奶粉纸尿裤辅食都亲手挑过，踩过的坑比清单多。' },
      { title: '先看配料表再谈价', content: '不先推贵的：先看配料、段位、适用月龄，再看预算，合适的才是好的。' },
      { title: '一手渠道日期新鲜', content: '奶粉纸尿裤直接对接渠道，批次和日期当面查，不拿临期货做活动。' },
      { title: '新手清单一次配齐', content: '待产包、0-6 个月、添加辅食，按阶段开清单，买多少写清楚。' },
      { title: '过敏红屁屁先问再换', content: '不盲目换牌子：先问清症状、月龄和已经试过什么，拿不准就建议去医院。' },
      { title: '不合适就退换', content: '没拆封可退换，买多了不劝囤；尺码拿不准先少拿一包。' },
    ],
    product: {
      name: '奶粉·纸尿裤·辅食',
      guideText: '选不准就先私信我：宝宝月龄、喝什么奶粉、预算多少，我帮你列一份清单。',
      cta: '私信我宝宝月龄，领一份新手清单',
      coverHook: '开母婴店 9 年、两个娃的妈',
    },
    kb: [
      { title: '奶粉段位怎么分，1段2段3段差在哪', category: '产品介绍', tags: ['奶粉', '段位', '月龄'], content: '1 段适合 0-6 个月，2 段 6-12 个月，3 段 1 岁以上。段位是按宝宝月龄和营养需求分的，不是越高越好。转段要按罐身说明逐步过渡，别同一天直接全换。' },
      { title: '纸尿裤尺码别只看体重', category: '使用技巧', tags: ['纸尿裤', '尺码', '漏尿'], content: '体重只是参考，还要看腿围和腰围：侧漏多半是尺码偏大或穿法不对，勒痕多半是偏小。换尺码先少拿一包试，别一次囤整箱。' },
      { title: '宝宝红屁屁，先别急着换纸尿裤', category: '顾客痛点', tags: ['红屁屁', '护理', '纸尿裤'], content: '红屁屁先看三件事：是不是长时间没换、是不是擦拭太用力、是不是最近换了新牌子。先勤换、清水洗、晾干再穿；破皮或渗液别自己上药，去医院。' },
      { title: '待产包哪些是智商税', category: '避坑经验', tags: ['待产包', '新手', '清单'], content: '待产包先备：证件、产妇卫生用品、换洗衣物、宝宝纸尿裤和包被、喂养用品。网红清单里很多“必备”其实用不上几次，先买基础款，缺什么再补，别一次囤满。' },
      { title: '辅食第一口，米粉怎么选', category: '使用技巧', tags: ['辅食', '米粉', '月龄'], content: '第一口辅食优先选强化铁的婴儿米粉，按罐身说明冲调，由稀到稠、由少到多。每加一种新食物观察 2-3 天，出现皮疹、呕吐、腹泻就停并咨询医生。' },
      { title: '开店 9 年，我最怕新手爸妈囤这三样', category: '个人经历', tags: ['囤货', '经验', '新手'], content: '开店 9 年，最怕新手爸妈一次囤三样：纸尿裤整箱、奶粉整箱、洗护大瓶。宝宝长得快、口味和肤质也会变，先买小包装试，合适再补，门店一直有货。' },
    ],
    plan: {
      pinned: { title: '开母婴店 9 年、两个娃的妈：新手最该避的坑我先替你踩了', outline: '我是谁（9 年门店 + 两个娃）+ 能给你什么（按宝宝月龄列清单、帮你比价）+ 去哪找我（看主页简介）' },
      rhythm: '一周 3 篇，晚上 8-10 点发（娃睡后）',
      perWeek: 3,
      timing: '晚上 8-10 点',
      items: [
        { title: '奶粉段位不是越高越好：1段2段3段到底怎么接', angle: '按段位适用月龄和配料变化讲清转奶顺序，给一张对照表', type: 'howto', kind: 'pitfall', scope: 'related', credential: '9 年门店见过上千次转奶', kb: '奶粉段位怎么分，1段2段3段差在哪' },
        { title: '待产包别照网红清单买：这 6 样先备齐', angle: '把待产包拆成“必须 / 可后补 / 别囤”三栏，按入院时间排', type: 'howto', kind: 'calc', scope: 'related', credential: '门店帮上千个新手家庭配过', kb: '待产包哪些是智商税' },
        { title: '纸尿裤尺码按体重还是按月份', angle: '不给死尺码，讲清体重、腿围、腰围三个数怎么一起看', type: 'howto', kind: 'qna', scope: 'related', credential: '门店每天处理漏尿和勒痕', kb: '纸尿裤尺码别只看体重' },
        { title: '第一次冲奶粉的 5 个步骤，水温先看罐身', angle: '按冲调顺序列 5 步，每步给一个新手最容易做错的点', type: 'howto', kind: 'steps', scope: 'related', credential: '两个娃都是自己冲大的', kb: '奶粉段位怎么分，1段2段3段差在哪' },
        { title: '从给自己娃选奶粉，到开了一家母婴店', angle: '讲开店来路：给自己娃选口粮时踩过的坑，为什么后来索性开店', type: 'tale', kind: 'myway', scope: 'related', credential: '9 年从业 → 自己开店', kb: '' },
        { title: '半夜跑店给一个新手爸爸拿退烧贴', angle: '现场故事：新手爸爸的慌乱，以及门店为什么坚持留夜班电话', type: 'tale', kind: 'scene', scope: 'related', credential: '亲身经历', kb: '' },
        { title: '一罐奶粉从工厂到货架，中间要看哪几道', angle: '讲奶粉的来路：批次、日期、运输和门店验收，为什么日期比赠品重要', type: 'tale', kind: 'history', scope: 'related', credential: '一手渠道见过整条链路', kb: '奶粉段位怎么分，1段2段3段差在哪' },
        { title: '当妈以后，最怕别人问“你家喝什么奶粉”', angle: '把“被比较”的处境原样说出来，让新手爸妈对号入座', type: 'echo', kind: 'mirror', scope: 'related', credential: '两个娃的妈 + 上千个家庭', kb: '' },
        { title: '今天劝一个宝妈别囤，她反而谢谢我', angle: '生活切片：一单能多卖，为什么还是劝她先拿小包装', type: 'echo', kind: 'slice', scope: 'samePeople', credential: '亲身经历', kb: '开店 9 年，我最怕新手爸妈囤这三样' },
        { title: '给一包纸尿裤写一份“体检报告”', angle: '用体检报告的文体逐项看：吸收、回渗、腰围、透气', type: 'meme', kind: 'docform', scope: 'related', credential: '门店实测过多个牌子', kb: '纸尿裤尺码别只看体重' },
        { title: '如果把带娃当成一场游戏：前三个月是地狱难度', angle: '把喂养、睡眠、换尿布写成游戏关卡，每关一个坑', type: 'meme', kind: 'sceneswap', scope: 'related', credential: '两个娃 + 门店经验', kb: '' },
        { title: '这周大家都在说“育儿降级”，哪些钱能省', angle: '借“育儿降级”的由头，讲哪几项能省、哪几项省了后面更麻烦', type: 'hot', kind: 'hotIndustry', scope: 'breakout', credential: '9 年门店行情', kb: '待产包哪些是智商税' },
      ],
    },
  },

  edu: {
    accountType: '个人IP/创始人型',
    coverHook: '教了 8 年孩子写字的书法老师',
    contentFocus: '孩子握笔、坐姿、练字怎么练——用 8 年一线教学经验帮家长少走弯路',
    targetPeople: '小学生家长（孩子刚上学、写字慢、姿势不对）',
    persona: {
      text: [
        '我是在本地教少儿硬笔书法的（示例账号），教了 8 年，带过上千个孩子。从刚拿笔的一年级，到作业写得飞起的高年级，什么样的握笔、坐姿、字迹问题都见过。',
        '我不承诺“一个月写好”，也不逼家长买贵笔：写字这件事，先改姿势，再练控笔，最后才是结构和速度。一节课只盯一个能检查的点，孩子做得到，家长回家也看得见。',
        '这个号就干一件事：把 8 年课堂里最管用的方法和最常见的坑写出来，帮家长在家里也能带孩子练。想先看看孩子的问题，发一张写字照片来就行。',
      ].join('\n\n'),
      card: {
        identity: '本地少儿硬笔书法老师，教了 8 年',
        proof: '带过上千个孩子；一线教学教案；家长口碑转介绍',
        story: '从给自家孩子纠正握笔开始，后来专职教写字',
        stance: '不承诺速成；不贬低学校老师；不逼孩子买贵笔',
        catchphrase: '先把姿势摆对，再谈写得好不好看',
        taboo: '不承诺比赛名次，不承诺短期速成，不贬低同行',
        address: '家长',
      },
    },
    sellPoints: [
      { title: '八年只教写字', content: '8 年一线少儿硬笔教学，带过上千个孩子，常见问题一眼能看出来。' },
      { title: '先纠正姿势再练字', content: '握笔、坐姿、本子摆放先摆对，不然越练越歪，改起来更费劲。' },
      { title: '一节课一个可检查的点', content: '不贪多：每节课只盯一个点，孩子做得到，家长回家也能检查。' },
      { title: '小班看得过来', content: '小班上课，每个孩子的握笔和坐姿都当场看、当场改。' },
      { title: '作业当场批改', content: '作业不留到下次：当堂批、当堂说清哪里要改，避免重复错。' },
      { title: '不推销贵文具', content: '普通的铅笔和本子就够用，不靠卖文具赚钱，也不劝家长囤课。' },
    ],
    product: {
      name: '少儿硬笔书法课',
      guideText: '想先看看孩子的问题，私信我发一张孩子写字的照片，我先说问题在哪。',
      cta: '私信发一张孩子写字照片，我先帮你看姿势',
      coverHook: '教了 8 年孩子写字的书法老师',
    },
    kb: [
      { title: '孩子握笔姿势不对，先改这三处', category: '使用技巧', tags: ['握笔', '姿势', '入门'], content: '先看三处：①笔杆是否靠在虎口、由食指拇指捏住；②食指是否过度用力、指节发白；③手腕是否内扣。先改这三处，再谈字好不好看；改姿势初期字会变丑，是正常的。' },
      { title: '练字先练控笔，不是先描红', category: '使用技巧', tags: ['控笔', '描红', '顺序'], content: '控笔是手能稳定地画出想要的线：横平、竖直、圈圆。控笔不稳就大量描红，孩子只会照着描，离开字帖还是写不好。先用短线、圆圈、折线练手，再进笔画和结构。' },
      { title: '每天练 10 分钟，比周末写两小时管用', category: '使用技巧', tags: ['练习', '时间', '习惯'], content: '写字是手部肌肉记忆，贵在每天短练。每天 10-15 分钟、专注练一个点，比周末一次性写两小时有效。练之前先活动手指，练完对照一个标准自查，别只求写满页。' },
      { title: '几岁开始学写字合适', category: '顾客痛点', tags: ['年龄', '入学', '启蒙'], content: '一般 5-6 岁、手部力量和专注力能跟上时开始接触握笔和控笔比较合适。没到年龄不必强练，先多做精细动作游戏。已经入学但姿势不对的，越早改越省力。' },
      { title: '孩子写字慢，多半不是不认真', category: '顾客痛点', tags: ['写字慢', '作业', '原因'], content: '写字慢常见三个原因：握笔太紧导致手酸、看一笔写一笔没有整体感、追求完美反复擦。先找原因再练：放松握笔、按词组看、允许少量修改，速度会慢慢上来。' },
      { title: '教了 8 年，我为什么不承诺“一个月写好”', category: '个人经历', tags: ['速成', '教学', '经验'], content: '写字要改的是多年形成的用笔习惯，一个月能改姿势、能看到变化，但谈不上“写好”。承诺速成的，多半只让孩子描成品。我更愿意把每天练什么、怎么检查讲清楚，让家长看得到过程。' },
    ],
    plan: {
      pinned: { title: '教了 8 年孩子写字：握笔和坐姿，我先帮你看出问题', outline: '我是谁（8 年一线教学）+ 能给你什么（发照片帮看姿势、给在家练法）+ 去哪找我（看主页简介）' },
      rhythm: '一周 3 篇，晚上 7-9 点发',
      perWeek: 3,
      timing: '晚上 7-9 点',
      items: [
        { title: '孩子握笔老低头：先改这三处，不用买矫正器', angle: '按握笔三个接触点逐个讲，给家长一个当场能检查的动作', type: 'howto', kind: 'pitfall', scope: 'related', credential: '8 年一线教学', kb: '孩子握笔姿势不对，先改这三处' },
        { title: '每天练 10 分钟，怎么排比周末写两小时管用', angle: '把一周练习拆成 5 个 10 分钟，每天只盯一个点', type: 'howto', kind: 'calc', scope: 'related', credential: '上千个孩子的练习反馈', kb: '每天练 10 分钟，比周末写两小时管用' },
        { title: '几岁开始学写字合适？先看这两个动作', angle: '不报年龄死线，先看孩子能不能稳定握笔、能不能坐住 10 分钟', type: 'howto', kind: 'qna', scope: 'related', credential: '带过刚入学和一至六年级', kb: '几岁开始学写字合适' },
        { title: '孩子写字慢，多半不是不认真：一张自查表', angle: '列出握笔紧、看一笔写一笔、反复擦三个原因，各给一个改法', type: 'howto', kind: 'steps', scope: 'related', credential: '课堂观察上千个孩子', kb: '孩子写字慢，多半不是不认真' },
        { title: '从给自家孩子纠正握笔，到开了一间写字班', angle: '讲入行来路：自家孩子写字歪，找老师无果，自己研究后开始教', type: 'tale', kind: 'myway', scope: 'related', credential: '8 年从业 → 自己开班', kb: '' },
        { title: '一个把“口”写成“囗”的孩子，三个月后', angle: '现场故事：不急着擦掉重写，先让孩子看懂结构再动笔', type: 'tale', kind: 'scene', scope: 'related', credential: '亲身经历', kb: '练字先练控笔，不是先描红' },
        { title: '一支铅笔从木头到笔尖，为什么孩子总爱咬笔杆', angle: '借铅笔的来路讲握笔和用笔习惯，提醒家长先换软硬合适的笔', type: 'tale', kind: 'history', scope: 'related', credential: '一线课堂见过各种文具', kb: '孩子握笔姿势不对，先改这三处' },
        { title: '家长最怕的一句话：我家孩子是不是没天赋', angle: '把“被天赋论吓到”的处境原样说出来，再讲写字到底靠什么', type: 'echo', kind: 'mirror', scope: 'related', credential: '8 年见过各种起点', kb: '教了 8 年，我为什么不承诺“一个月写好”' },
        { title: '今天劝一个家长别报全年班，她反而松了口气', angle: '生活切片：先上几节看孩子适不适应，为什么比一次报全年更负责', type: 'echo', kind: 'slice', scope: 'samePeople', credential: '亲身经历', kb: '教了 8 年，我为什么不承诺“一个月写好”' },
        { title: '给一支铅笔写一份“体检报告”', angle: '用体检报告的文体逐项看：笔杆粗细、软硬、握笔位置、削法', type: 'meme', kind: 'docform', scope: 'related', credential: '课堂实测', kb: '孩子握笔姿势不对，先改这三处' },
        { title: '如果练字是一场闯关游戏：姿势、控笔、结构、速度', angle: '把练字写成游戏关卡，每关给一个通关标准', type: 'meme', kind: 'sceneswap', scope: 'related', credential: '8 年教学节奏', kb: '练字先练控笔，不是先描红' },
        { title: '这周大家都在聊“卷不动了”，孩子的字还要不要练', angle: '借“反内卷”的由头，讲写字是少数能每天看到进步的基础功', type: 'hot', kind: 'hotIndustry', scope: 'breakout', credential: '8 年一线观察', kb: '每天练 10 分钟，比周末写两小时管用' },
      ],
    },
  },

  kidsport: {
    accountType: '个人IP/创始人型',
    coverHook: '带过上千节课的儿童体适能教练',
    contentFocus: '孩子平衡、协调、力量、灵敏怎么练——用 8 年一线体能课经验帮家长把运动底子打对',
    targetPeople: '3-12 岁孩子的家长（孩子动作笨拙、爱摔、体质弱、想报运动班不知道从哪开始）',
    persona: {
      text: [
        '我是在本地开儿童体适能馆的（示例账号），做了 8 年，带过上千节体能课。3 岁刚离地的娃到 12 岁准备进校队的孩子，跑、跳、攀、爬、平衡，什么样的动作问题都见过。',
        '我不承诺“练一个冬天长高十公分”，也不一上来就让孩子练专项：先看动作模式对不对——平衡、协调、力量、灵敏这几样底子打好了，再谈篮球、跳绳、体测都不晚。一节课只盯一个能观察到的点，孩子做得到，家长在窗外也看得见。',
        '这个号就干一件事：把 8 年体能课里最管用的判断标准和在家能玩的游戏写出来，帮家长把孩子的运动底子打对。拿不准孩子该从哪开始的，发一段孩子跑跳的视频来，我先帮你看看动作。',
      ].join('\n\n'),
      card: {
        identity: '本地儿童体适能馆教练，从业 8 年',
        proof: '带过上千节体能课；3-12 岁分龄教案；家长口碑转介绍为主',
        story: '从体育院校毕业带少儿训练队开始，后来专门做儿童体适能',
        stance: '不承诺长高和治病；不鼓吹小小年纪只练一个专项；不贬低同行',
        catchphrase: '先看动作，再上强度',
        taboo: '不承诺具体身高增长，不做医疗诊断，不贬低同行',
        address: '家长',
      },
    },
    sellPoints: [
      { title: '八年只带孩子练体能', content: '8 年一线儿童体适能教学，带过上千节课，3-12 岁各年龄段该练什么心里有数。' },
      { title: '先筛动作再上课', content: '报名前先看一段孩子的跑、跳、单脚站，动作模式对了再排课，不是一进来就上一样的课。' },
      { title: '分龄分组不混带', content: '3-5 岁玩基础动作，6-8 岁练协调灵敏，9-12 岁加力量速度，按年龄段分班，不跟大孩子硬跟练。' },
      { title: '一节课一个可观察的点', content: '不贪多：每节课只盯一个点（单脚站稳、落地不响），孩子有进步，家长在窗外看得见。' },
      { title: '场地器械按儿童标准', content: '软包地面、防滑垫、器械定期检查和消毒，高度和重量都按孩子的身材配，不怕磕碰不怕超重。' },
      { title: '小班带得过来', content: '一个班不超过 8 个孩子，每个人的动作都当场看、当场纠正，不站着排队等老师。' },
    ],
    product: {
      name: '儿童体适能课（3-12 岁分龄）',
      guideText: '拿不准孩子该从哪开始，私信我发一段孩子跑跳或单脚站的视频，我先帮你看看动作，再说该练什么。',
      cta: '私信发一段孩子跑跳视频，领一次动作筛查',
      coverHook: '带过上千节课的儿童体适能教练',
    },
    kb: [
      { title: '3-12 岁体能训练对照表：各年龄段先练什么', category: '产品介绍', tags: ['分龄', '平衡', '敏感期'], content: '3-5 岁：走、跑、跳、爬、滚这些基础动作玩够，重点是敢动、爱动；6-8 岁：协调和灵敏的敏感期，跳格、拍球、障碍跑见效最快；9-12 岁：可以加自重力量（平板支撑、悬垂）和速度训练。每个阶段先把本阶段的地基打稳，跳过地基去追专项成绩，后面更容易卡住。' },
      { title: '孩子动作笨拙、老摔跤？先观察这三个动作', category: '顾客痛点', tags: ['协调', '平衡', '观察'], content: '在家就能看：①单脚站能不能稳 5 秒；②双脚原地跳，落地时膝盖有没有内扣；③沿着直线脚跟顶脚尖走，会不会歪。三个都吃力，多半是基础动作模式没打够，不是“天生笨”。先补平衡和协调，再谈跑步跳绳；如果明显倒退或一侧偏弱，建议先去医院看看。' },
      { title: '体适能和单项运动班差在哪', category: '产品介绍', tags: ['体适能', '专项', '选课'], content: '体适能练的是“身体的通用能力”——跑、跳、平衡、力量、协调；专项班练的是一项运动的技术。低龄先上体适能，等于先打地基；地基没打就进专项，孩子往往动作变形、容易受伤、练两个月就没兴趣。6 岁以后可以体适能和专项搭着上。' },
      { title: '在家 10 分钟：三个不用器械的亲子体能游戏', category: '使用技巧', tags: ['家庭练习', '游戏', '亲子'], content: '①脚印走路：地贴当脚印，脚跟顶脚尖走，练平衡；②气球不落地：拍气球，只能用手背，练协调和反应；③动物爬行：熊爬、蟹行走客厅一圈，练肩带和核心。每天挑一个玩 10 分钟，比一次练一小时管用；场地注意收尖角家具，穿防滑袜。' },
      { title: '报体能班前，家长要看的四件事', category: '避坑经验', tags: ['选课', '安全', '资质'], content: '看四件：①师生比——一个老师带超过 10 个孩子，动作根本看不过来；②地面和器械有没有软包、有没有定期检查；③课程有没有分龄，还是所有孩子一个内容；④教练讲不讲“为什么练这个”，只会带孩子疯玩的练不到东西。试听课就盯这四点，别被“孩子玩得很开心”一句话带过。' },
      { title: '做了 8 年，我为什么不承诺长高', category: '个人经历', tags: ['长高', '承诺', '经验'], content: '运动对骨骼发育有好处，但幅度受遗传、睡眠、营养影响更大，谁也没法承诺“练一冬长几公分”。敢这么承诺的馆，多半把别家孩子的数据拿来当广告。我能保证的是：孩子的单脚站立、跳跃落地、折返跑这些动作，一个学期能看得到变化——这些才是能练出来的东西。' },
    ],
    plan: {
      pinned: { title: '带 8 年儿童体能课：孩子该动什么、怎么动，我先帮你判断', outline: '我是谁（8 年上千节课）+ 能给你什么（发视频帮看动作、给分龄对照表）+ 去哪找我（看主页简介）' },
      rhythm: '一周 3 篇，晚上 8-10 点发（娃睡后）',
      perWeek: 3,
      timing: '晚上 8-10 点',
      items: [
        { title: '3-12 岁该练什么：一张分龄对照表存好', angle: '把三个年龄段先练什么、后练什么列成一张表，家长对着年龄查', type: 'howto', kind: 'pitfall', scope: 'related', credential: '8 年分龄教案', kb: '3-12 岁体能训练对照表：各年龄段先练什么' },
        { title: '孩子老摔跤别急着怪“天生笨”：在家看三个动作', angle: '单脚站、落地、走直线三个自查动作，各给一个练法', type: 'howto', kind: 'qna', scope: 'related', credential: '上千节课见过各种动作问题', kb: '孩子动作笨拙、老摔跤？先观察这三个动作' },
        { title: '先报体适能还是先报专项班？看孩子年龄和这三点', angle: '讲清地基和专项的先后，给“什么时候可以加专项”的判断标准', type: 'howto', kind: 'calc', scope: 'related', credential: '带过转专项前后的孩子', kb: '体适能和单项运动班差在哪' },
        { title: '不买器械：晚上在家 10 分钟的三个亲子游戏', angle: '按游戏列 3 步，每个游戏配一个“玩顺了怎么加难”的升级法', type: 'howto', kind: 'steps', scope: 'related', credential: '课上常用、家长反馈最好', kb: '在家 10 分钟：三个不用器械的亲子体能游戏' },
        { title: '从带训练队到开一家儿童体适能馆', angle: '讲入行来路：体院毕业带少儿队，发现孩子们普遍地基没打好，索性专门做体适能', type: 'tale', kind: 'myway', scope: 'related', credential: '8 年从业 → 自己开馆', kb: '' },
        { title: '一个不敢跳箱子的孩子，第三个月自己举手先上', angle: '现场故事：不催不抱，把箱子拆成三个高度，让孩子自己选起点', type: 'tale', kind: 'scene', scope: 'related', credential: '亲身经历', kb: '' },
        { title: '跑、跳、攀、爬：人类小孩的动作“来路”', angle: '讲基础动作模式的来路——这些动作本来是怎么长在人身上、又是怎么被坐没的', type: 'tale', kind: 'history', scope: 'related', credential: '8 年一线观察', kb: '3-12 岁体能训练对照表：各年龄段先练什么' },
        { title: '家长最怕的一句话：我家孩子是不是动商低', angle: '把“给孩子贴标签”的处境原样说出来，再讲动作能力到底怎么练出来', type: 'echo', kind: 'mirror', scope: 'related', credential: '8 年见过各种起点', kb: '孩子动作笨拙、老摔跤？先观察这三个动作' },
        { title: '今天劝一个家长别续大课包，她反而谢我', angle: '生活切片：孩子明显该换分龄班了，为什么先降包比硬续更负责', type: 'echo', kind: 'slice', scope: 'samePeople', credential: '亲身经历', kb: '做了 8 年，我为什么不承诺长高' },
        { title: '给一节体能课写一份“体检报告”', angle: '用体检报告的文体逐项看一节课：热身、密度、纠正次数、收纳，家长照着就能评任何一家馆', type: 'meme', kind: 'docform', scope: 'related', credential: '按馆内标准实测', kb: '报体能班前，家长要看的四件事' },
        { title: '如果把练体能当成打怪升级：每个年龄段的主线任务', angle: '把分龄训练写成游戏关卡，每关一个通关标准（单脚 10 秒、连续拍球 20 个）', type: 'meme', kind: 'sceneswap', scope: 'related', credential: '8 年教案', kb: '3-12 岁体能训练对照表：各年龄段先练什么' },
        { title: '这周大家都在聊体育进中考，孩子的体能到底怎么补', angle: '借体育成主课的由头，讲练体和测体是两回事——地基没打直接练考试项目容易伤', type: 'hot', kind: 'hotIndustry', scope: 'breakout', credential: '带过体测提分的孩子', kb: '体适能和单项运动班差在哪' },
      ],
    },
  },
};

/** 把行业底子搭成 note_plan（与 seedDemoData 里建材那份同形） */
export function buildPlan(foundation, now) {
  const p = foundation.plan;
  const items = p.items.map((it, i) => ({ no: i + 1, col: '', day: 0, goal: GOAL[it.type], ...it }));
  return {
    v: 3,
    stage: 'cold',
    stageName: '冷启动期',
    stageNote: '还没信任资产：先让人知道你是干什么的、信你不骗人',
    accountType: foundation.accountType,
    contentFocus: foundation.contentFocus,
    targetPeople: foundation.targetPeople,
    rhythm: p.rhythm,
    perWeek: p.perWeek,
    timing: p.timing,
    pinned: p.pinned,
    items,
    mix: MIX,
    mixWeights: { howto: 30, tale: 25, echo: 20, meme: 15, hot: 10 },
    short: [],
    columns: [],
    weekText: '',
    colProblems: [],
    style: null,
    materials: { persona: true, kbCount: foundation.kb.length, kbHasMethod: true, kbHasData: true, photoCount: 50, hasChat: true, hasVideo: true },
    map: { unlocked: ['tale', 'echo', 'meme', 'hot', 'howto'], groups: [] },
    generatedAt: now,
    problems: [],
  };
}

/** 给演示号列表接口用的对外形状（不带底子内容） */
export function demoCatalog() {
  return DEMO_ACCOUNTS.map((d) => ({
    key: d.key, id: d.id, group: d.group, industry: d.industry,
    name: d.name, tier: d.tier, desc: d.desc,
  }));
}
