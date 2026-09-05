/**
 * note-architecture.js — 不同品类 → 不同「笔记结构」（页数 + 每页功能 + 选图构图）
 *
 * 依据「小红书品类与笔记结构匹配矩阵表」：发图文笔记前先判断内容属于哪个品类，
 * 就按该品类的【页数】和【每页功能 P1..Pn】来排版，每一页做什么图、用什么构图都由它决定。
 *
 * 用法：
 *   1. detectCategory(文本) → 猜这内容最像哪个品类（可空，交给 AI 判断更稳）
 *   2. getNoteArchitecture(产品名, 卖点, 知识库) → { category, guidance }
 *      guidance 优先用知识库「笔记架构」条目（品类矩阵表）原文，否则用内置矩阵兜底。
 *      并在指引里要求：确定品类 → 按该品类页数 & 每页功能产出，imagePlans 逐个给 P1..Pn 的构图/选图。
 */

// 内置品类矩阵（与知识库「笔记架构」条目同一张表；知识库已导入时以知识库原文为准）
const CATEGORY_MATRIX = [
  {
    key: 'virtual', name: '虚拟资料/知识付费',
    pain: '决策成本低，看重“直观价值感”和“真实感”',
    pages: '极简 1-3 页（大字报/目录展示）',
    desc: ['P1 封面：痛点+结果（如：提分逆袭）+ 真实笔记实拍图', 'P2 价值：目录展示/内页拼图（证明干货满满）', 'P3 引导：简单粗暴的购买/获取指令'],
    cases: '家教提分笔记、自媒体排版模板',
    keywords: ['资料', '模板', '课程', '付费', '电子书', '文档', '教程包', '资料包', '知识付费'],
  },
  {
    key: 'review', name: '实物测评/红黑榜',
    pain: '选择困难，看重“真实对比”和“客观中立”',
    pages: '4-5 页（测评对比型）',
    desc: ['P1 封面：多款产品对比图/红黑榜大字报', 'P2 痛点：选购避坑指南或常见误区', 'P3 实测：核心维度横评（质地、性能等）+ 真实数据', 'P4 结论：明确给出购买建议（谁适合买哪款）'],
    cases: '3款网红速食面实测、平价粉底液实测',
    keywords: ['测评', '实测', '红黑榜', '横评', '避坑指南', '开箱', '对比'],
  },
  {
    key: 'scenario', name: '场景种草/生活方式',
    pain: '需要代入感，看重“情绪价值”和“氛围感”',
    pages: '4-6 页（场景种草型）',
    desc: ['P1 封面：高颜值场景图/痛点发问（如：带娃出门太狼狈？）', 'P2 场景：还原真实生活痛点场景', 'P3 方案：产品融入场景，展示使用过程', 'P4 感受：真实体验分享（优缺点坦诚）+ 推荐理由'],
    cases: '租房改造好物、解放双手的带娃神器',
    keywords: ['种草', '好物', '家居', '改造', '氛围', '生活', '带娃', '穿搭', '空间'],
  },
  {
    key: 'tutorial', name: '干货教程/技能教学',
    pain: '需要实操性，看重“步骤清晰”和“易学”',
    pages: '5-7 页（教程步骤型）',
    desc: ['P1 封面：目标+效果（如：3步画出野生眉）+ 效果对比', 'P2 准备：所需工具/前置条件清单', 'P3 步骤：分步拆解（一步一图，小白也能看懂）', 'P4 避坑：新手常见错误预警', 'P5 总结：核心要点回顾 + 引导收藏'],
    cases: '微胖女生显瘦穿搭、新手养猫避坑指南',
    keywords: ['教程', '步骤', '教学', '实操', '技巧', '操作', '方法', '上手'],
  },
  {
    key: 'collection', name: '合集盘点/资源整理',
    pain: '怕麻烦，看重“信息密度”和“收藏价值”',
    pages: '4-6 页（合集清单型）',
    desc: ['P1 封面：数字+人群（如：租房党必看10件好物）', 'P2 清单：核心清单概览（一图列出要点）', 'P3 详述：逐一介绍优缺点（可多图拼接）', 'P4 排序：给出明确的推荐优先级', 'P5 结尾：引导收藏（“赶紧码住试试”）'],
    cases: '提升幸福感的家居好物、冷门副业网站盘点',
    keywords: ['合集', '盘点', '清单', '整理', '汇总', '书单', '10件', '平价好物'],
  },
  {
    key: 'emotion', name: '个人经历/情感共鸣',
    pain: '寻求认同，看重“真实人设”和“情绪共鸣”',
    pages: '4-6 页（经验复盘型）',
    desc: ['P1 封面：反差/情绪标签（如：裸辞3个月，我悟了）', 'P2 经历：真实故事开端与冲突升级', 'P3 观点：提炼核心感悟（金句输出）', 'P4 价值：升华到普遍价值，给他人启发', 'P5 互动：抛出问题，引导评论区分享经历'],
    cases: '从月薪3k到3w的职场真相、反向消费感悟',
    keywords: ['经历', '裸辞', '复盘', '感悟', '故事', '真实', '分享经历', '职场'],
  },
];

// 内置矩阵全文（注入 prompt 用；与知识库「笔记架构」条目一致）
const BUILTIN_MATRIX_TEXT = [
  '【小红书品类与笔记结构匹配矩阵表】发图文笔记前，先判断这条内容属于哪个品类，就按该品类的「页数」和「每页功能(P1..Pn)」来排版，每页的构图/选图也按该页功能来定。',
  '',
  CATEGORY_MATRIX.map((c, i) => [
    '第' + '一二三四五六' [i] + '、' + c.name + '（如：' + c.cases + '）',
    '用户决策痛点：' + c.pain,
    '推荐结构：' + c.pages,
    c.desc.map(d => '  ' + d).join('\n'),
  ].join('\n')).join('\n\n'),
].join('\n');

// 关键词兜底：文本最像哪个品类（返回 key；拿不准返回空，交给 AI 判断）
function detectCategory(text) {
  const str = String(text || '').trim();
  if (!str) return '';
  let best = { key: '', count: 0 };
  for (const c of CATEGORY_MATRIX) {
    let n = 0;
    for (const kw of c.keywords) if (str.includes(kw)) n++;
    if (n > best.count) best = { key: c.key, count: n };
  }
  return best.key;
}

// 查找知识库里用户录的「笔记架构」（品类矩阵）条目原文
function _findKbArchitecture(kb) {
  const list = Array.isArray(kb) ? kb : [];
  const pick = (e) =>
    String(e.category || '').includes('笔记架构') ||
    String(e.title || '').includes('笔记架构') ||
    String(e.category || '').includes('矩阵') ||
    String(e.title || '').includes('矩阵') ||
    ((Array.isArray(e.tags) && e.tags.some(t => String(t).includes('笔记架构') || String(t).includes('矩阵')))) ||
    ((String(e.title || '').includes('账号类型') && String(e.title || '').includes('笔记结构')) ||
     (String(e.category || '').includes('账号类型') && String(e.category || '').includes('笔记结构')));
  const arch = list.find(e => e.isActive !== false && pick(e));
  if (arch && (arch.title || arch.content)) {
    return '【笔记架构（来自你的知识库：品类与笔记结构匹配矩阵表）】\n' +
      String(arch.content || arch.title || '').trim();
  }
  return BUILTIN_MATRIX_TEXT;
}

/**
 * 取当前产品应遵循的「笔记结构」指引。
 * 优先用知识库矩阵表，否则内置表；并给出匹配到的品类。
 * @param {string} productName
 * @param {string} productDescription
 * @param {Array} kb
 * @returns {{category:string, guidance:string}}
 */
function getNoteArchitecture(productName, productDescription, kb) {
  const describe = String(productName || '') + ' ' + String(productDescription || '');
  const category = detectCategory(describe);
  const matrix = _findKbArchitecture(kb);
  const guidance = [
    matrix,
    '',
    '【发笔记遵循规则】先判断这条内容最接近上面矩阵里的哪个【品类】（可作为参考的品类：' + category + '），然后严格按该品类的「页数」和「每页功能(P1..Pn)」来排版这篇图文笔记：',
    '1. 数清楚到底要多少页（按该品类的推荐页数，不要随手起 2 张或 5 张）。',
    '2. 每一页 P1/P2/P3... 的功能照该品类的描述来定（封面放什么大字钩子、中间几页各讲什么、末尾页做什么引导）。',
    '3. 给 imagePlans 时，按页数逐个输出每个 P 位（如封面/图2/图3/...），每张的 text/layout/style/shoot/desc 都要贴合"该页功能"：封面多放大字钩子，数据页做表格/信息图，结果/截图页说清如何拍摄与打码。',
    '4. imagePlans 的条数 = 推荐页数（要在该品类页数范围内）。',
  ].join('\n');
  return { category, guidance };
}

// 便捷：把笔记结构指引追加进发笔记 system prompt（按行），返回追加后的数组
function applyNoteArchitecture(systemLines, cfg, kb) {
  const name = String((cfg && cfg.product && cfg.product.name) || '').trim();
  const desc = String((cfg && cfg.product && cfg.product.description) || '').trim();
  const arch = getNoteArchitecture(name, desc, kb);
  systemLines.push('');
  systemLines.push(arch.guidance);
  return systemLines;
}

const NoteArchitecture = {
  CATEGORY_MATRIX,
  BUILTIN_MATRIX_TEXT,
  detectCategory,
  getNoteArchitecture,
  applyNoteArchitecture,
};

if (typeof module !== 'undefined') {
  module.exports = NoteArchitecture;
}