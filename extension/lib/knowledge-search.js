/**
 * knowledge-search.js — 知识库搜索
 * 两阶段检索：先匹配标题/标签粗筛，再精选最相关的条目
 */

/**
 * 搜索知识库，返回注入 System Prompt 的字符串和匹配条目的图片
 * 
 * 检索流程：
 *   1. 从评论/笔记文本中提取有意义的关键词
 *   2. 用关键词匹配条目的 标题+标签（粗筛），快速圈出候选
 *   3. 按匹配度排序，只选最相关的 TOP_N 条（精选）
 *   4. 只把这几条的完整内容注入 prompt
 * 
 * @param {Array} knowledgeBase - 知识库条目列表
 * @param {object} context - 上下文（note_title, comment_content, comments_text 等）
 * @param {object} roleKeywords - 角色关键词映射 { 角色名: [关键词...] }
 * @returns {object} { text: 知识库注入文本, images: 匹配条目的图片数组 }
 */
function searchKnowledgeBase(knowledgeBase, context, roleKeywords = {}) {
  const emptyResult = { text: '', images: [] };
  if (!knowledgeBase || knowledgeBase.length === 0) return emptyResult;
  
  const activeEntries = knowledgeBase.filter(e => e.isActive !== false);
  if (activeEntries.length === 0) return emptyResult;

  // ── 0. 构建搜索文本 ──
  const searchText = [
    context.comment_content || '',  // 当前要回复的评论（最高权重）
    context.note_title || '',
    context.note_content || '',
    context.comments_text || '',    // 评论区所有文本（最低权重）
  ].join(' ');

  if (!searchText.trim()) return emptyResult;

  // ── 1. 提取关键词 ──
  const keywords = extractKeywords(searchText);
  if (keywords.length === 0) return emptyResult;

  // ── 2. 检测角色 ──
  const detectedRoles = detectRoles(searchText, roleKeywords);

  // ── 3. 两阶段评分 ──
  const scored = [];
  
  for (const entry of activeEntries) {
    let score = 0;

    // ★ 阶段一：标题+标签匹配（粗筛，高权重）
    const titleTagScore = matchTitleTags(entry, keywords);
    if (titleTagScore > 0) {
      score += titleTagScore * 10;  // 标题/标签匹配权重 x10
    }

    // ★ 角色匹配加分
    if (detectedRoles.length > 0 && entry.role && detectedRoles.includes(entry.role)) {
      score += 50;
    }

    // ★ 阶段二：内容匹配（精选，低权重，用于排序）
    const contentScore = matchContent(entry, keywords);
    if (contentScore > 0) {
      score += contentScore * 2;  // 内容匹配权重 x2
    }

    if (score > 0) {
      scored.push({ entry, score, titleTagScore, contentScore });
    }
  }

  // ── 4. 排序，只取 TOP 5 ──
  scored.sort((a, b) => b.score - a.score);
  const TOP_N = 5;
  const selectedEntries = scored.slice(0, TOP_N).map(s => s.entry);

  if (selectedEntries.length === 0) return emptyResult;

  console.log('[知识库检索] 匹配条目:', selectedEntries.map(e => e.title).join(', '));
  console.log('[知识库检索] 评分详情:', JSON.stringify(
    scored.slice(0, TOP_N).map(s => ({ title: s.entry.title, score: s.score, titleMatch: s.titleTagScore, contentMatch: s.contentScore }))
  ));

  // ── 5. 构建注入文本 + 图片 + 匹配详情（与 AI 快筛预选共用同一构建器）──
  return buildKbContext(selectedEntries);
}

/**
 * 从选中的知识库条目构建注入文本（本地匹配与 AI 快筛预选共用）
 * @param {Array} selectedEntries - 选中的知识库条目（含完整 content）
 * @returns {object} { text: 注入文本, images: 待发送图片, matchedEntries: 条目详情（日志用） }
 */
function buildKbContext(selectedEntries) {
  const emptyResult = { text: '', images: [], matchedEntries: [] };
  if (!selectedEntries || selectedEntries.length === 0) return emptyResult;

  // ── 构建注入文本（只包含精选条目的完整内容）──
  const lines = [];
  const roleTags = [...new Set(selectedEntries.map(e => e.role).filter(Boolean))];
  if (roleTags.length > 0) {
    lines.push(`【检测到角色: ${roleTags.join('、')}】\n`);
  }
  lines.push(`【知识库——已为你精选 ${selectedEntries.length} 条最相关的内容，必须引用其中的具体数据】`);

  for (const e of selectedEntries) {
    const roleTag = e.role ? `[${e.role}] ` : '';
    const content = e.content || '';  // 完整内容，不截断
    lines.push(`\n━━━ ${roleTag}${e.title || '（无标题）'} ━━━`);
    lines.push(content);
  }

  const text = lines.join('\n') + `

【强制要求】以上知识库包含完整的专业数据和操作指引。你的回复必须：
1. 直接引用知识库中的具体数字（利率、额度、公式等），不要泛泛而谈
2. 如果知识库有产品操作指引，必须告诉用户具体怎么操作
3. 如果知识库有计算公式，必须把公式写出来
4. 用知识库的数据做对比分析，而不是说空话`;

  // ── 收集图片（图片发送规则：只有带“产品操作”相关标签的条目才发图片）──
  const IMAGE_TAGS = ['产品操作', '产品', '操作指引', '操作指南', '教程'];
  const images = selectedEntries
    .filter(e => {
      if (!e.image) return false;
      const tags = Array.isArray(e.tags) ? e.tags : [];
      return tags.some(t => IMAGE_TAGS.some(it => t.includes(it) || it.includes(t)));
    })
    .map(e => ({ id: e.id, title: e.title, image: e.image }));

  // 匹配的条目详情（用于日志）
  const matchedEntries = selectedEntries.map(e => ({
    id: e.id,
    title: e.title || '（无标题）',
    category: e.category || '',
    role: e.role || '',
    contentPreview: (e.content || '').slice(0, 100) + '...',  // 前100字预览
    hasImage: !!e.image
  }));

  return { text, images, matchedEntries };
}

/**
 * 提取关键词：有意义的短语（3-8字），而非所有2-4字子串
 * 优先提取长词，避免过于宽泛的短词
 */
function extractKeywords(text) {
  if (!text) return [];
  const keywords = new Set();
  const cleaned = text.replace(/\s+/g, '');
  
  // 优先提取 3-8 字的关键词（更有意义）
  for (let len = 3; len <= 8; len++) {
    for (let i = 0; i <= cleaned.length - len; i++) {
      const kw = cleaned.slice(i, i + len);
      // 过滤掉纯数字、纯标点
      if (/[\u4e00-\u9fa5a-zA-Z]/.test(kw)) {
        keywords.add(kw);
      }
    }
  }
  
  // 也加入 2 字词，但只在文本中确实出现时（用于匹配标题中的短词）
  for (let i = 0; i <= cleaned.length - 2; i++) {
    const kw = cleaned.slice(i, i + 2);
    if (/[\u4e00-\u9fa5]/.test(kw)) {
      keywords.add(kw);
    }
  }
  
  return [...keywords];
}

/**
 * 阶段一：标题+标签匹配（粗筛）
 * 返回匹配的关键词数量（只算标题/标签中出现的）
 */
function matchTitleTags(entry, keywords) {
  if (!keywords || keywords.length === 0) return 0;
  const haystack = [
    entry.title || '',
    ...(Array.isArray(entry.tags) ? entry.tags : []),
  ].join(' ');
  
  if (!haystack.trim()) return 0;

  let matchCount = 0;
  for (const kw of keywords) {
    if (haystack.includes(kw)) matchCount++;
  }
  return matchCount;
}

/**
 * 阶段二：内容匹配（精选，用于排序）
 * 返回匹配的关键词数量（只算内容中出现的）
 */
function matchContent(entry, keywords) {
  if (!keywords || keywords.length === 0) return 0;
  const content = entry.content || '';
  if (!content) return 0;

  let matchCount = 0;
  for (const kw of keywords) {
    if (content.includes(kw)) matchCount++;
  }
  return matchCount;
}

/**
 * 从文本中检测角色（关键词匹配）
 */
function detectRoles(text, roleKeywords) {
  const detected = [];
  for (const [role, keywords] of Object.entries(roleKeywords)) {
    if (Array.isArray(keywords) && keywords.some(kw => text.includes(kw))) {
      detected.push(role);
    }
  }
  return detected;
}

const KnowledgeSearch = { searchKnowledgeBase, buildKbContext, extractKeywords, matchTitleTags, matchContent, detectRoles };

if (typeof module !== 'undefined') {
  module.exports = KnowledgeSearch;
}
