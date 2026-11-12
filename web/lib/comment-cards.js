/* 🧩 评论场景表（2026-11-11）
   一张卡＝一类评论场景；卡里分「情况」，每种情况带 2～3 句现成说法。
   生成时：AI 只认场景/情况、按参考改写成 2～3 句候选；选哪句由程序随机，不交给 AI。
   发过的句子进 7 天账本：开头 6 个字相同、或连续 8 个字相同，就不再用。
   这张表里没有的评论＝「未收录」，只走共情/一句判断，不硬套、不编案例。
   文件同时被网页和服务器后台加载；两边必须逐字节一致。 */
(function (root) {
  'use strict';

  var KEY = 'drain_comment_cards';
  var LOG_KEY = 'drain_comment_log';
  var VERSION = 1;
  var DAY = 86400000;

  /* ── 默认 14 张卡（体适能/体智能一个号）── */
  var DEFAULT_CARDS = [
    { id: 'sit', name: '孩子上课坐不住，十分钟就要起来走',
      when: '家长说孩子坐不住、老师说不专心、问是不是不适合；也可能只是随口抱怨一句。',
      ex: ['我家也是，一节课坐不住，愁死了', '4岁半，老师说他坐不住，是不是不适合？', '一节课十分钟就要起来走', '老师说再这样跟不上进度'],
      branches: [
        { cond: '只是抱怨一句，没问具体问题', goal: '先接住，再问几岁', say: [
          { angle: '共情接住', text: '太理解了，这个年纪的娃坐不住太常见了。你家几岁啦？' },
          { angle: '随口搭话', text: '我家馆里也一堆这样的，先别急着贴标签。孩子几岁啦？' }
        ] },
        { cond: '说了年龄（3-5 岁）', goal: '先玩够大动作，再要求坐住', say: [
          { angle: '专业判断', text: '3-5岁专注时间本来就短，4岁半坐不住十分钟很正常。先看他是身体没动够，还是对画画没兴趣。' },
          { angle: '方法拆解', text: '上课前半小时让他跑跳、单脚站、爬一圈，把劲使掉；静态课排在后面，坐得住的时间会慢慢变长。' },
          { angle: '案例带人', text: '我这边见过一个跟你家差不多大的孩子，也是画画坐不住；先补平衡和协调，后来老师说能坐的时间长了不少。' }
        ] },
        { cond: '问「是不是不适合 / 要不要停」', goal: '先别停，给两周观察法', say: [
          { angle: '避坑提醒', text: '先别急着停。这个年纪很多不是不适合，是身体没动够；停掉反而少了一个练专注的机会。' },
          { angle: '方法拆解', text: '先试两周：上课前放电、课后别追问画了什么，只问他玩得开不开心；两周后再看老师的反馈。' }
        ] }
      ],
      mat: '分龄表；转班案例（未落成稿，先用泛例）',
      forbid: '不说多动症 / 感统失调，不做医疗判断，不承诺「一定能坐住」',
      src: ['你的例子', '人设'] },

    { id: 'age', name: '孩子几岁开始学画画 / 练体能合适',
      when: '家长直接问几岁开始、我家 3 岁半是不是太早、要不要再等等。',
      ex: ['孩子几岁开始学画画比较好？', '同问，我们3岁半是不是太早', '4岁学画画是不是太早', '几岁开始练体能合适'],
      branches: [
        { cond: '问「几岁开始」', goal: '给年龄判断 + 一条能核对的标准', say: [
          { angle: '专业判断', text: '4岁接触画画不早，但别用「坐满一节课」当标准。先看孩子能不能拿笔涂完一张、听得懂一个小指令；这两件能做到，就可以慢慢来。' },
          { angle: '数据实证', text: '3-5岁先把走跑跳爬玩够，专注时间本来就短；画画课安排20-30分钟、中间能活动一下，比硬坐一节课合适。' }
        ] },
        { cond: '说「我家 3 岁半，是不是太早」', goal: '按孩子表现判断，不按岁数卡', say: [
          { angle: '对比取舍', text: '3岁半早不早，看孩子：能自己拿笔涂、能听指令做完一件小事，就可以玩着上；坐不住就先补大动作，晚半年一点不耽误。' },
          { angle: '专业判断', text: '不用卡岁数。看两件事：能不能离开家长上完一节课、能不能听懂老师的一个指令；能做到就可以试。' }
        ] }
      ],
      mat: '知识库「3-12 岁体能训练对照表：各年龄段先练什么」',
      forbid: '不说越早越好，不承诺「赢在起跑线」',
      src: ['知识库'] },

    { id: 'clumsy', name: '孩子动作笨、老摔跤、跑起来不稳',
      when: '家长说孩子笨手笨脚、老摔跤、跳绳学不会，怀疑天生运动细胞差。',
      ex: ['孩子跑步老摔跤', '动作看着笨笨的', '跳绳怎么都学不会', '是不是天生运动细胞差'],
      branches: [
        { cond: '只是说笨 / 摔跤', goal: '先给三个自查动作，不贴标签', say: [
          { angle: '方法拆解', text: '先别急着说笨。在家看三个动作：单脚站5秒、原地跳落地稳不稳、脚跟顶脚尖走直线；三个都吃力，再考虑补平衡和协调。' },
          { angle: '专业判断', text: '很多不是笨，是平衡和核心还没练起来。先玩单脚站、拍气球、熊爬，每天10分钟，两周就能看出变化。' }
        ] },
        { cond: '问「是不是天生运动细胞差」', goal: '不做判断，讲清能练的', say: [
          { angle: '避坑提醒', text: '别给孩子贴「运动细胞差」的标签。这个年纪大部分是练得少，不是天生不行；先补基础动作，比报专项班有用。' },
          { angle: '方法拆解', text: '先练三样：平衡、落地、爬行。单脚站、原地跳、熊爬走一圈，每天挑一个玩10分钟，不用买器械。' }
        ] }
      ],
      mat: '知识库「孩子动作笨拙、老摔跤？先观察这三个动作」',
      forbid: '不说「天生笨」，不做医疗诊断',
      src: ['知识库'] },

    { id: 'vs', name: '先报体适能，还是直接报篮球 / 轮滑 / 跆拳道',
      when: '家长在体适能和专项班之间犹豫，问会不会耽误学专项、几岁能加专项。',
      ex: ['先报体适能还是篮球班', '练体能会不会耽误学专项', '6岁能加专项了吗', '是不是直接报篮球就行'],
      branches: [
        { cond: '还没报，问先报哪个', goal: '讲地基和专项的先后', say: [
          { angle: '对比取舍', text: '体适能练的是跑跳爬、平衡、协调这些底子，专项练的是技术。底子没打好直接上专项，孩子容易动作变形、也容易受挫。' },
          { angle: '专业判断', text: '先看孩子缺什么：动作控制弱、老摔跤，先补体适能；跑跳稳、能听指令，直接上专项也可以。两个不冲突。' }
        ] },
        { cond: '已经报了专项，问要不要补体能', goal: '不贬低专项，讲补什么', say: [
          { angle: '方法拆解', text: '已经报了专项就继续上，平时每周补一次平衡和协调就行；不用停专项，也别两头加量，孩子会累。' },
          { angle: '避坑提醒', text: '别为了补体能把专项停了。先看专项课上老师有没有说他动作跟不上，有的话再补，不用提前焦虑。' }
        ] }
      ],
      mat: '知识库「体适能和单项运动班差在哪」',
      forbid: '不贬低专项班或别家馆',
      src: ['知识库'] },

    { id: 'home', name: '在家能练吗？要不要买器械？',
      when: '家长没时间送馆、想在家练，问买什么器械、每天练多久。',
      ex: ['在家能练吗？不想那么早报班', '要不要买平衡木 / 蹦床', '没时间去馆里怎么办', '每天在家练多久'],
      branches: [
        { cond: '问「在家能练吗」', goal: '给 1-3 个不用器械的游戏', say: [
          { angle: '方法拆解', text: '在家就能练：单脚站左右各5秒、原地跳落地膝盖别内扣、脚跟顶脚尖走直线；每天挑一个玩10分钟。' },
          { angle: '方法拆解', text: '不用器械。脚印走路、拍气球不落地、熊爬走一圈，三个游戏轮着玩，每天10分钟就够。' }
        ] },
        { cond: '问「要不要买器械」', goal: '先不买，玩顺了再加', say: [
          { angle: '避坑提醒', text: '先别买。这个年纪把平衡和爬行玩顺，比买一堆器械有用；真要用，一个软垫加一条胶带就够了。' },
          { angle: '专业判断', text: '器械不是必需。先看孩子单脚能不能站稳、落地稳不稳；这两件在家就能练，玩顺了再考虑加难度。' }
        ] }
      ],
      mat: '知识库「在家 10 分钟：三个不用器械的亲子体能游戏」',
      forbid: '不推荐具体品牌器械，不承诺效果',
      src: ['知识库'] },

    { id: 'pick', name: '怎么挑体能班？试听的时候看什么？',
      when: '家长准备报班，问怎么判断教练专不专业、试听要看什么、怎么不被销售带着走。',
      ex: ['怎么挑体能班', '试听要看什么', '怎么知道教练专不专业', '怕被销售忽悠'],
      branches: [
        { cond: '还没试听，问看什么', goal: '给四条能当场核对的看课标准', say: [
          { angle: '避坑提醒', text: '试听别只看孩子玩得开不开心。看四件事：有没有按年龄分组、课前有没有热身、动作有没有一个个纠、下课有没有跟你说孩子哪里需要练。' },
          { angle: '专业判断', text: '教练专不专业，看他会不会拆动作。一个动作孩子做不对，他能拆成两步教，而不是只说「再来一次」。' }
        ] },
        { cond: '已经试听，问这家行不行', goal: '不点名对比，给判断标准', say: [
          { angle: '对比取舍', text: '每家侧重点不一样，你先看课上让孩子练什么、教练纠不纠动作；两家都试一节，看孩子上完是累还是怕。' },
          { angle: '避坑提醒', text: '别被「包学会 / 包长高」这类话带走。体能是慢功夫，先看课上有没有按孩子水平分组。' }
        ] }
      ],
      mat: '知识库「报体能班前，家长要看的四件事」',
      forbid: '不点名对比本地同行',
      src: ['知识库'] },

    { id: 'height', name: '练体能能不能长高？多久能长高？',
      when: '家长直接问长高、问多久见效、怀疑是不是智商税。',
      ex: ['练体能能长高吗', '多久能长高', '是不是智商税', '能长几厘米'],
      branches: [
        { cond: '问「能不能长高」', goal: '讲清能练的和不能承诺的', say: [
          { angle: '专业判断', text: '体能练的是动作、平衡、心肺和习惯，这些能练；身高主要看遗传、睡眠、营养，不能拿课程打包票。' },
          { angle: '避坑提醒', text: '谁跟你说「练这个能长高几厘米」，你反而要小心。能承诺的是把动作练好、把运动习惯养起来。' }
        ] },
        { cond: '问「多久能看到变化」', goal: '说清能观察到的变化，不承诺身高', say: [
          { angle: '数据实证', text: '别盯身高，先看这些：单脚站从3秒到5秒、跳下来落地稳了、上楼不喊累；这些一般几周就能看出来。' },
          { angle: '方法拆解', text: '想帮长高，先把睡眠和户外时间补够；体能课负责让他动起来、动作协调，不负责保证长几厘米。' }
        ] }
      ],
      mat: '知识库「做了 8 年，我为什么不承诺长高」',
      forbid: '不承诺具体身高，不拿别家孩子数据',
      src: ['知识库'] },

    { id: 'shy', name: '孩子胆小、不敢跳、一上器械就哭',
      when: '家长说孩子怕生、不敢跳箱子、一到新环境就躲，问要不要逼一逼。',
      ex: ['孩子胆小不敢跳', '一上器械就哭', '特别怕生', '要不要逼他一下'],
      branches: [
        { cond: '说孩子不敢跳 / 怕生', goal: '先接住情绪，把动作拆小', say: [
          { angle: '共情接住', text: '孩子不是胆小，是还没准备好。先别推他，把动作拆小一点，让他自己选从哪开始。' },
          { angle: '方法拆解', text: '先不跳箱子，从跳过低一点的障碍开始；他在旁边看也行，等他主动说想试，再扶一把。' }
        ] },
        { cond: '问「要不要逼一逼」', goal: '不逼，给台阶', say: [
          { angle: '避坑提醒', text: '别硬逼。逼一次可能当下跳了，下一次更不敢来；给他一个能完成的台阶，比推他有用。' },
          { angle: '案例带人', text: '我这边见过一个不敢跳箱子的孩子，前几次只在旁边看；后来自己举手先上，第三个月才敢跳。每个孩子节奏不一样。' }
        ] }
      ],
      mat: '规划案例「一个不敢跳箱子的孩子，第三个月自己举手先上」（未落成稿）',
      forbid: '不贴「胆小」标签，不逼孩子，不说「多见见人就好了」',
      src: ['规划', '人设'] },

    { id: 'price', name: '一节课多少钱？一个月大概多少？',
      when: '家长问价格、问有没有体验价、说别家更便宜。',
      ex: ['一节课多少钱', '一个月大概多少', '有没有体验价', '别家比你们便宜'],
      branches: [
        { cond: '公开评论区问价格', goal: '不报价，讲怎么判断值不值', say: [
          { angle: '专业判断', text: '价格看你买的是什么：一节课几个孩子、教练会不会一个个纠动作、有没有按年龄分组。光比单价容易踩坑。' },
          { angle: '避坑提醒', text: '公开评论里我不报价格，每个城市和班型都不一样；你先看课上怎么上，觉得合适再私信问。' }
        ] },
        { cond: '说「别家更便宜」', goal: '不贬低同行，给比较维度', say: [
          { angle: '对比取舍', text: '便宜有便宜的上法，你先看两件事：一节课几个孩子、教练纠不纠动作；这两件对上，再看价格才准。' },
          { angle: '随口搭话', text: '别只看单价，问清楚一节课多久、几个孩子、能不能试听；算下来每节课真正落到孩子身上的时间，差挺多的。' }
        ] }
      ],
      mat: '知识库「报班四件事」',
      forbid: '不报价、不留联系方式、不说便宜 / 划算',
      src: ['玩法硬闸'] },

    { id: 'score', name: '体育中考怎么练？体测成绩差怎么办？',
      when: '家长问体育中考、体测提分、现在练来不来得及。',
      ex: ['体育中考怎么练', '体测成绩差怎么办', '现在练来得及吗', '跳绳 / 跑步怎么提分'],
      branches: [
        { cond: '问「怎么练 / 来不来得及」', goal: '讲练体和测体两回事，先补短板', say: [
          { angle: '专业判断', text: '体测是测，体能是底子。先看哪一项丢分：跳绳、跑步、坐位体前屈，每项练法不一样，别一上来就全套加量。' },
          { angle: '方法拆解', text: '先测一次，把最差的一项挑出来，每周练3次、每次15分钟；两项轮着来，比一次练一小时有用。' }
        ] },
        { cond: '问「现在练来得及吗」', goal: '不承诺分数，给时间判断', say: [
          { angle: '避坑提醒', text: '来不来得及看离考试多久、现在差多少；先测一次再定计划，别信「一个月提多少分」的保证。' },
          { angle: '方法拆解', text: '时间紧就先抓最容易提的项：跳绳练节奏、跑步练呼吸；每天15分钟，比周末突击一次强。' }
        ] }
      ],
      mat: '知识库「体适能和单项运动班差在哪」＋ 规划热点题',
      forbid: '不承诺分数，不押题',
      src: ['知识库', '规划'] },

    { id: 'freq', name: '一周练几次？多久能看到效果？',
      when: '家长问频率、问多久见效、问每天要不要练。',
      ex: ['一周练几次', '多久能看到效果', '每天都要练吗', '练一个月有用吗'],
      branches: [
        { cond: '问频率', goal: '按年龄给频率', say: [
          { angle: '专业判断', text: '3-6岁一周2次就够，中间在家玩10分钟；7岁以上想练专项，可以加到2-3次，别天天上强度。' },
          { angle: '方法拆解', text: '一周2次课 + 在家2次10分钟游戏，比一周5次课更适合这个年纪；留出恢复时间，孩子才不容易烦。' }
        ] },
        { cond: '问「多久见效」', goal: '说清能观察的变化', say: [
          { angle: '数据实证', text: '别按「几天」算。先看4周：单脚站稳不稳、跳下来落地稳不稳、上课还喊不喊累；这些比体重和身高更早变化。' },
          { angle: '避坑提醒', text: '说「一周见效」的基本是卖课话术。体能是慢功夫，4周看动作，3个月看习惯。' }
        ] }
      ],
      mat: '知识库「3-12 岁体能训练对照表」',
      forbid: '不承诺「几天见效」',
      src: ['知识库'] },

    { id: 'addr', name: '你们馆在哪？怎么报名？',
      when: '家长问地址、问怎么去、问怎么报名。',
      ex: ['你们馆在哪', '佛山哪里', '怎么报名', '离我远不远'],
      branches: [
        { cond: '公开评论区问地址', goal: '不写地址，引导主页 / 私信', say: [
          { angle: '随口搭话', text: '公开评论里不方便写地址，你看我主页简介，或者私信我发你位置。' },
          { angle: '专业判断', text: '先看你在哪个区，离得远不远；远的话没必要折腾，就近找一家能长期上的更重要。' }
        ] },
        { cond: '问「怎么报名 / 有没有体验」', goal: '站内引导，不报价', say: [
          { angle: '随口搭话', text: '想来看的话私信我，先约一节试试；具体安排私信里说，评论里不占大家地方。' },
          { angle: '避坑提醒', text: '别急着报名，先试一节看孩子喜不喜欢、教练合不合适；合适再定，不用当天交钱。' }
        ] }
      ],
      mat: '无（不需要素材）',
      forbid: '不写地址、电话、微信、二维码',
      src: ['红线'] },

    { id: 'first_art', name: '首评：博主在讲孩子坐不住 / 学画画坚持不下去',
      when: '博主正文在讲孩子坐不住、学艺术、要不要坚持；笔记层还没有人给出具体判断。',
      ex: ['（首评没有评论原文，看博主正文）'],
      branches: [
        { cond: '博主在讲「坐不住，是不是不适合」', goal: '接住「不是不专心」+ 一句体适能视角', say: [
          { angle: '专业判断', text: '坐不住这个事，先别急着给孩子下结论。4岁半的娃专注时间本来就短，很多不是不喜欢画画，是身体没放电。' },
          { angle: '方法拆解', text: '可以试试把画画课放在运动后面：课前半小时跑跳、单脚站、爬一圈，把劲使掉再坐下来，先看两周。' }
        ] },
        { cond: '博主在讲「学艺术坚持不下去」', goal: '不劝坚持，给一个观察点', say: [
          { angle: '共情接住', text: '孩子说不想去，先别急着劝。先分清是累、没兴趣、还是课上受挫；三种情况处理不一样。' },
          { angle: '避坑提醒', text: '别用「交了钱不能退」逼他。先陪他去一次，看他是进教室前就怕，还是上到一半才烦。' }
        ] }
      ],
      mat: '分龄知识；口述案例可不用',
      forbid: '不报店名价格，不写「来我馆」',
      src: ['你的例子', '知识库'] },

    { id: 'first_kid', name: '首评：博主在讲孩子动作笨 / 体质弱 / 老生病',
      when: '博主正文在讲孩子动作笨、体质弱、老感冒；笔记层需要一条内行判断。',
      ex: ['（首评没有评论原文，看博主正文）'],
      branches: [
        { cond: '博主在讲「动作笨 / 老摔跤」', goal: '给一条内行判断 + 一个家里能看的点', say: [
          { angle: '专业判断', text: '动作笨不一定是天生，先看平衡和核心。单脚站、原地跳落地稳不稳，这两件就能看出大半。' },
          { angle: '方法拆解', text: '在家先玩三个：单脚站、拍气球、熊爬；每天10分钟，两周再看跑跳有没有稳一点。' }
        ] },
        { cond: '博主在讲「体质弱 / 老生病」', goal: '不诊断，讲运动和作息', say: [
          { angle: '避坑提醒', text: '老生病先看睡眠、饮食和户外时间，别指望一节体能课解决；运动是加分项，不是药。' },
          { angle: '专业判断', text: '体能课能帮的是心肺和运动习惯；频次别一下拉太高，一周2次、慢慢加，比突击练更稳。' }
        ] }
      ],
      mat: '知识库「先观察三个动作」',
      forbid: '不做诊断，不承诺',
      src: ['知识库'] }
  ];

  var ANGLES = ['共情接住', '案例带人', '方法拆解', '数据实证', '专业判断', '避坑提醒', '对比取舍', '随口搭话'];
  /* 每种情况先认「对方是谁」，再决定说什么（2026-11-11 老板定）。不限＝不区分，照旧。 */
  var WHO_OPTS = ['不限', '家长本人', '同行', '老师', '路人'];
  /* 一张卡可以勾多个适用笔记类型（2026-11-12）：跟笔记类型表同一套 id；空＝通用 */
  var NOTE_TYPES = [
    { id: 'bigv', name: '大V帖' }, { id: 'help', name: '求助咨询帖' },
    { id: 'localbiz', name: '同城本业' }, { id: 'localcross', name: '同城异业' },
    { id: 'normal', name: '普通帖' }, { id: 'ad', name: '广告招生帖' }, { id: 'sad', name: '悲伤纠纷帖' },
  ];
  var NT_IDS = NOTE_TYPES.map(function (t) { return t.id; });

  /* ── 小工具 ── */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function str(v) { return String(v == null ? '' : v).trim(); }
  function hasChrome() {
    try { return typeof chrome !== 'undefined' && chrome && chrome.storage && chrome.storage.local; } catch (_) { return false; }
  }
  async function storeGet(keys) {
    if (!hasChrome()) return {};
    try { return (await chrome.storage.local.get(keys)) || {}; } catch (_) { return {}; }
  }
  async function storeSet(obj) {
    if (!hasChrome()) return false;
    try { await chrome.storage.local.set(obj); return true; } catch (_) { return false; }
  }

  function normalizeCands(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (x) {
      if (x == null) return;
      var text = str(typeof x === 'string' ? x : (x.text || x.copy || x.say));
      if (!text) return;
      var angle = str(typeof x === 'object' ? (x.angle || x.style || x.label) : '');
      if (ANGLES.indexOf(angle) < 0) angle = angle || '专业判断';
      out.push({ angle: angle, text: text });
    });
    return out;
  }

  function normalizeCards(arr) {
    var out = [], seen = {};
    (Array.isArray(arr) ? arr : []).forEach(function (c, i) {
      if (!c || typeof c !== 'object') return;
      var id = str(c.id) || ('c' + (i + 1));
      while (seen[id]) id = id + '_' + i;
      seen[id] = 1;
      var branches = (Array.isArray(c.branches) ? c.branches : []).map(function (b) {
        b = b || {};
        var who = str(b.who);
        if (WHO_OPTS.indexOf(who) < 0) who = WHO_OPTS[0];
        return { who: who, cond: str(b.cond), goal: str(b.goal), say: normalizeCands(b.say) };
      }).filter(function (b) { return b.cond || b.say.length; });
      var types = (Array.isArray(c.types) ? c.types : []).map(function (t) {
        return str(t).toLowerCase();
      }).filter(function (t, i, a) { return NT_IDS.indexOf(t) >= 0 && a.indexOf(t) === i; });
      out.push({
        id: id,
        name: str(c.name) || ('场景 ' + (i + 1)),
        when: str(c.when),
        ex: (Array.isArray(c.ex) ? c.ex : []).map(str).filter(Boolean).slice(0, 8),
        branches: branches,
        mat: str(c.mat),
        forbid: str(c.forbid),
        src: (Array.isArray(c.src) ? c.src : []).map(str).filter(Boolean),
        types: types,
        revised: !!c.revised,
      });
    });
    return out;
  }

  async function getCards() {
    var d = await storeGet(KEY);
    var v = d && d[KEY];
    if (Array.isArray(v) && v.length) return normalizeCards(v);
    if (v && typeof v === 'object' && Array.isArray(v.cards) && v.cards.length) return normalizeCards(v.cards);
    return clone(DEFAULT_CARDS);
  }
  async function saveCards(cards) {
    var list = normalizeCards(cards);
    await storeSet({ [KEY]: { v: VERSION, updatedAt: Date.now(), cards: list } });
    return list;
  }
  async function resetCards() {
    if (!hasChrome()) return;
    try { await chrome.storage.local.remove(KEY); } catch (_) {}
  }
  async function countCards(cards) {
    var list = cards || (await getCards());
    var br = 0, say = 0;
    list.forEach(function (c) {
      br += (c.branches || []).length;
      (c.branches || []).forEach(function (b) { say += (b.say || []).length; });
    });
    return { cards: list.length, branches: br, says: say };
  }

  /* ── 给 AI 的场景菜单 ── */
  /* 这张卡适不适用这几类帖：没勾类型＝通用；判不出类型＝不筛 */
  function cardApplies(card, types) {
    var t = (Array.isArray(types) ? types : []).map(function (x) { return str(x).toLowerCase(); }).filter(Boolean);
    if (!t.length) return true;
    var ct = (card && Array.isArray(card.types)) ? card.types : [];
    if (!ct.length) return true;
    return ct.some(function (x) { return t.indexOf(x) >= 0; });
  }
  function sceneMenuText(cards, opt) {
    var o = opt || {};
    var wantTypes = (Array.isArray(o.types) ? o.types : []).filter(Boolean);
    var list = (cards || []).filter(function (c) {
      if (o.kind === 'reply' && String(c.id).indexOf('first_') === 0) return false;
      if (wantTypes.length && !cardApplies(c, wantTypes)) return false;
      return true;
    });
    var L = ['【评论场景表（只从这里认场景）】',
      '只从下面这些场景里认；对不上就 scene="none"，不许硬套、不许自己编场景。',
      '每条先认 scene（# 后面的 id）和 branch（情况序号，从 1 数）。',
      '「对方是谁」是写这句话的人在冲着谁说：家长本人 / 同行 / 老师 / 路人；不认识、对不上就不提身份，按「不限」说。',
      '候选写 2～3 句；每句标一个 angle（' + ANGLES.join(' / ') + '）。',
      '「说法参考」只当参考：必须换成自己的话，不许逐字照抄，也不许只改一两个字。',
      '没有真材料（案例、数字、分龄标准）就只讲判断，不许编故事、编数据、编别家孩子。',
      'scene="none"（未收录）时，最多一句共情或一句专业判断；拿不准就不给候选。',
      '同一类（同一个 angle）整批最多 2 条。',
      ''];
    list.forEach(function (c) {
      L.push('#' + c.id + '｜' + c.name);
      var tn = (c.types || []).map(function (id) {
        var t = null;
        NOTE_TYPES.some(function (x) { if (x.id === id) { t = x; return true; } return false; });
        return t ? t.name : id;
      });
      L.push('  适用类型：' + (tn.length ? tn.join(' / ') : '通用（什么帖都能用）'));
      if (c.when) L.push('  什么时候用：' + c.when);
      if (c.ex && c.ex.length) L.push('  真评论例子：' + c.ex.slice(0, 3).map(function (e) { return '「' + e + '」'; }).join(' '));
      (c.branches || []).forEach(function (b, i) {
        L.push('  情况' + (i + 1) + '：' + (b.who && b.who !== '不限' ? '【对方：' + b.who + '】' : '') + (b.cond || '') + (b.goal ? (' → ' + b.goal) : ''));
        if (b.say && b.say.length) {
          L.push('    说法参考：' + b.say.map(function (s, j) { return '（' + s.angle + '）' + s.text; }).join('；'));
        }
      });
      if (c.forbid) L.push('  这个场景不能说：' + c.forbid);
    });
    return L.join('\n');
  }

  /* ── 本地粗匹配（只用于重放页提示，不代替 AI 认场景）── */
  function matchLocal(text, cards) {
    var t = str(text);
    if (!t) return [];
    var out = [];
    (cards || []).forEach(function (c) {
      var hay = [c.name, c.when].concat(c.ex || []).concat((c.branches || []).map(function (b) { return b.cond + ' ' + (b.say || []).map(function (s) { return s.text; }).join(' '); })).join(' ');
      var hit = 0;
      (c.ex || []).forEach(function (e) {
        var key = str(e).slice(0, 6);
        if (key && key.length >= 4 && t.indexOf(key) >= 0) hit += 3;
      });
      var nameKey = str(c.name).slice(0, 4);
      if (nameKey && nameKey.length >= 2 && t.indexOf(nameKey) >= 0) hit += 2;
      (c.branches || []).forEach(function (b) {
        var k = str(b.cond).slice(0, 4);
        if (k && k.length >= 3 && t.indexOf(k) >= 0) hit += 1;
      });
      if (hit > 0) out.push({ id: c.id, name: c.name, score: hit, hay: hay });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, 3);
  }

  /* ── 查重：开头 6 个字相同，或连续 8 个字相同 ── */
  function normText(s) {
    return str(s).replace(/[\s，。！？、,.!?;；:：""''「」【】（）()~～…—\-]/g, '');
  }
  function sameOpening(a, b) {
    var x = normText(a), y = normText(b);
    if (x.length < 6 || y.length < 6) return x.length >= 4 && x === y;
    return x.slice(0, 6) === y.slice(0, 6);
  }
  function longestCommon(a, b) {
    var x = normText(a).replace(/[^\u4e00-\u9fa5]/g, '');
    var y = normText(b).replace(/[^\u4e00-\u9fa5]/g, '');
    if (!x || !y) return 0;
    var prev = new Array(y.length + 1).fill(0), best = 0;
    for (var i = 1; i <= x.length; i++) {
      var cur = new Array(y.length + 1).fill(0);
      for (var j = 1; j <= y.length; j++) {
        if (x.charAt(i - 1) === y.charAt(j - 1)) {
          cur[j] = prev[j - 1] + 1;
          if (cur[j] > best) best = cur[j];
        }
      }
      prev = cur;
    }
    return best;
  }
  function tooSimilar(a, b) {
    return sameOpening(a, b) || longestCommon(a, b) >= 8;
  }
  function similarToAny(text, list) {
    for (var i = 0; i < (list || []).length; i++) {
      var x = list[i];
      var t = typeof x === 'string' ? x : (x && x.text);
      if (t && tooSimilar(text, t)) return str(t).slice(0, 18) + (str(t).length > 18 ? '…' : '');
    }
    return '';
  }

  /* ── 红线：联系方式 / 站外 / 报价 / 承诺效果 / 贬低同行 ── */
  var REDLINES = [
    { re: /(微信|加\s*[vV]|VX|vx|二维码|扫码|公众号|小程序|https?:|www\.|\.com|手机号|联系电话|电话号码|加我)/, why: '联系方式或站外' },
    { re: /([¥￥]\s*\d|\d+\s*(元|块|万元?))/, why: '报价' },
    { re: /((保证|包).{0,8}(见效|学会|长高|提分|坐住|进步)|一定(能|会).{0,6}(见效|长高|坐住|提分))/, why: '承诺效果' },
    { re: /((别家|同行|那家|隔壁).{0,10}(坑|骗|黑心|差劲|不行))/, why: '贬低同行' },
  ];
  function redlineHit(text) {
    var t = str(text);
    for (var i = 0; i < REDLINES.length; i++) {
      if (REDLINES[i].re.test(t)) return REDLINES[i].why;
    }
    return '';
  }
  var META = /(评论(?:的)?必要|值得评论|不适合评论|不评了|跳过(?:这条|这篇|这则)?|^分析[:：]|^结论[:：]|^判断[:：])/;
  function looksMeta(text) {
    var t = str(text);
    return !t || META.test(t);
  }

  /* ── 程序随机挑一句 ── */
  function pickCandidate(cands, recent, opt) {
    var o = opt || {};
    var list = normalizeCands(cands);
    var blocked = [], ok = [];
    var angleCount = o.angleCount || {};
    var angleMax = Math.max(1, Number(o.angleMax) || 2);
    list.forEach(function (c) {
      var why = '';
      if (looksMeta(c.text)) why = '像解释句，不能发';
      else if (redlineHit(c.text)) why = '踩红线：' + redlineHit(c.text);
      else if ((angleCount[c.angle] || 0) >= angleMax) why = '「' + c.angle + '」这批发够了 ' + angleMax + ' 条';
      else {
        var hit = similarToAny(c.text, recent);
        if (hit) why = '跟最近 7 天太像（' + hit + '）';
        else if (o.batchTexts && o.batchTexts.length) {
          var hit2 = similarToAny(c.text, o.batchTexts);
          if (hit2) why = '跟这一批前面太像（' + hit2 + '）';
        }
      }
      if (why) blocked.push({ angle: c.angle, text: c.text, why: why });
      else ok.push(c);
    });
    if (!ok.length) {
      return {
        picked: '', angle: '', blocked: blocked,
        reason: blocked.length ? ('候选全被拦住：' + blocked.map(function (b) { return b.why; }).join('；')) : '没有候选',
      };
    }
    var pick = ok[Math.floor(Math.random() * ok.length)];
    return {
      picked: pick.text,
      angle: pick.angle,
      blocked: blocked,
      reason: blocked.length ? ('避开 ' + blocked.length + ' 条：' + blocked[0].why) : '没撞最近 7 天',
    };
  }

  /* ── 最近 7 天发过的句子（真账本）── */
  function msOf(v) {
    var n = Number(v || 0);
    if (!n) return 0;
    return n > 1e12 ? n : (n > 1e9 ? n * 1000 : 0);
  }
  async function recentTexts(days) {
    var since = Date.now() - Math.max(1, Number(days) || 7) * DAY;
    var d = await storeGet(['watering_logs', 'auto_water_history', 'ex_note_snaps']);
    var out = [], seen = {};
    function add(text, ts, scene) {
      var t = str(text);
      var at = msOf(ts);
      if (!t || !at || at < since || seen[t]) return;
      seen[t] = 1;
      out.push({ text: t, ts: at, scene: str(scene) });
    }
    (Array.isArray(d.watering_logs) ? d.watering_logs : []).forEach(function (r) {
      if (!r) return;
      add(r.replyText, r.ts, '');
      add(r.noteComment, r.ts, '');
    });
    var hist = d.auto_water_history;
    var hv = Array.isArray(hist) ? hist : (hist && typeof hist === 'object' ? Object.keys(hist).map(function (k) {
      var x = hist[k];
      return (x && typeof x === 'object') ? Object.assign({ __key: k }, x) : null;
    }) : []);
    hv.forEach(function (r) {
      if (!r) return;
      var ts = r.wateredAt || r.ts;
      add(r.replyText, ts, '');
      add(r.noteComment, ts, '');
    });
    (Array.isArray(d.ex_note_snaps) ? d.ex_note_snaps : []).forEach(function (s) {
      if (!s) return;
      var ts = s.at || s.ts;
      add(s.noteComment, ts, s.scenario);
      (Array.isArray(s.replies) ? s.replies : []).forEach(function (x) { add(x && x.t, ts, s.scenario); });
    });
    out.sort(function (a, b) { return b.ts - a.ts; });
    return out;
  }

  /* ── 决策日志：这一条用了哪个场景、哪种情况、哪几句候选、为什么选它 ── */
  async function recordDecision(rec) {
    if (!rec) return false;
    var d = await storeGet(LOG_KEY);
    var list = Array.isArray(d[LOG_KEY]) ? d[LOG_KEY] : [];
    var item = Object.assign({ at: Date.now() }, rec);
    item.candidates = normalizeCands(rec.candidates).slice(0, 6);
    item.blocked = (Array.isArray(rec.blocked) ? rec.blocked : []).slice(0, 6);
    list.unshift(item);
    if (list.length > 300) list.length = 300;
    await storeSet({ [LOG_KEY]: list });
    return true;
  }
  async function getDecisions(limit) {
    var d = await storeGet(LOG_KEY);
    var list = Array.isArray(d[LOG_KEY]) ? d[LOG_KEY] : [];
    return list.slice(0, Math.max(1, Number(limit) || 50));
  }

  function branchLabel(card, branch) {
    if (!card || !Array.isArray(card.branches)) return '';
    var b = card.branches[Number(branch) - 1];
    return b ? ('情况' + Number(branch) + ' · ' + (b.cond || '')) : '';
  }
  function findCard(cards, id) {
    var s = str(id).replace(/^#+/, '');
    if (!s || s === 'none') return null;
    return (cards || []).filter(function (c) { return c.id === s; })[0] || null;
  }

  var api = {
    DEFAULT_CARDS: DEFAULT_CARDS,
    ANGLES: ANGLES,
    WHO_OPTS: WHO_OPTS,
    KEY: KEY,
    LOG_KEY: LOG_KEY,
    getCards: getCards,
    saveCards: saveCards,
    resetCards: resetCards,
    countCards: countCards,
    normalizeCards: normalizeCards,
    normalizeCands: normalizeCands,
    sceneMenuText: sceneMenuText,
    cardApplies: cardApplies,
    NOTE_TYPES: NOTE_TYPES,
    matchLocal: matchLocal,
    pickCandidate: pickCandidate,
    recentTexts: recentTexts,
    recordDecision: recordDecision,
    getDecisions: getDecisions,
    redlineHit: redlineHit,
    looksMeta: looksMeta,
    sameOpening: sameOpening,
    longestCommon: longestCommon,
    tooSimilar: tooSimilar,
    branchLabel: branchLabel,
    findCard: findCard,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  try { root.DrainCards = api; } catch (_) {}
})(typeof self !== 'undefined' ? self : this);
