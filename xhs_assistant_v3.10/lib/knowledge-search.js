/**
 * knowledge-search.js — 知识库搜索
 * 移植自 ai_engine.py 的 _search_knowledge_base()
 */

/**
 * 搜索知识库，返回注入 System Prompt 的字符串
 * @param {Array} knowledgeBase - 知识库条目列表
 * @param {object} context - 上下文（note_title, comment_content, comments_text 等）
 * @param {object} roleKeywords - 角色关键词映射 { 角色名: [关键词...] }
 * @returns {string} 知识库注入文本，若无相关条目则返回空字符串
 */
function searchKnowledgeBase(knowledgeBase, context, roleKeywords = {}) {
  if (!knowledgeBase || knowledgeBase.length === 0) return '';
  
  const activeEntries = knowledgeBase.filter(e => e.isActive !== false);
  if (activeEntries.length === 0) return '';

  // 1. Build search text from context
  const searchText = [
    context.comments_text || '',
    context.comment_content || '',
    context.note_title || '',
    context.note_content || '',
  ].join(' ');

  // 2. Detect roles from comment text
  const detectedRoles = detectRoles(searchText, roleKeywords);

  // 3. Always load "用户经验" entries (up to 10)
  const personalEntries = activeEntries
    .filter(e => e.category === '用户经验')
    .slice(0, 10);

  // 4. Keyword-based relevance search
  const keywords = extractKeywords(searchText);
  
  // 5. Score and sort entries: role-matched first, then keyword-matched
  const scored = [];
  const personalIds = new Set(personalEntries.map(e => e.id));
  
  for (const entry of activeEntries) {
    if (personalIds.has(entry.id)) continue;
    
    let score = 0;
    // Role match bonus (highest priority)
    if (detectedRoles.length > 0 && entry.role && detectedRoles.includes(entry.role)) {
      score += 100;
    }
    // Keyword match
    if (matchEntry(entry, keywords)) {
      score += 10;
    }
    if (score > 0) {
      scored.push({ entry, score });
    }
  }
  
  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);
  const relevantEntries = scored.slice(0, 8).map(s => s.entry);

  // 6. Merge: personal + role-matched + keyword-matched
  const allEntries = [...personalEntries, ...relevantEntries];
  if (allEntries.length === 0) return '';

  // 7. Build unified injection text with role context
  const lines = [];
  if (detectedRoles.length > 0) {
    lines.push(`【检测到角色: ${detectedRoles.join('、')}】\n`);
  }
  lines.push('【知识库参考信息】');
  for (const e of allEntries) {
    const roleTag = e.role ? `[${e.role}] ` : '';
    const content = e.content ? e.content.slice(0, 200) : '';
    lines.push(`- ${roleTag}${e.title || '（无标题）'}: ${content}`);
  }
  
  return lines.join('\n') + `

注意：角色标记的条目是针对特定角色的参考话术，用户经验类条目是真实用户的亲身经历故事。你在写回复时应结合具体角色和场景自然发挥。`;
}

/**
 * 提取关键词：滑动窗口分词（2-4 字子串），去重
 */
function extractKeywords(text) {
  if (!text) return [];
  const keywords = new Set();
  const cleaned = text.replace(/\s+/g, '');
  for (let len = 2; len <= 4; len++) {
    for (let i = 0; i <= cleaned.length - len; i++) {
      keywords.add(cleaned.slice(i, i + len));
    }
  }
  return [...keywords];
}

/**
 * 判断条目是否与关键词相关
 */
function matchEntry(entry, keywords) {
  if (!keywords || keywords.length === 0) return false;
  const haystack = [
    entry.title || '',
    entry.content || '',
    ...(Array.isArray(entry.tags) ? entry.tags : []),
  ].join(' ');

  return keywords.some(kw => haystack.includes(kw));
}

/**
 * 从文本中检测角色（关键词匹配）
 * @param {string} text
 * @param {object} roleKeywords - { 角色名: [关键词...] }
 * @returns {string[]} 检测到的角色名列表
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

const KnowledgeSearch = { searchKnowledgeBase, extractKeywords, matchEntry, detectRoles };

if (typeof module !== 'undefined') {
  module.exports = KnowledgeSearch;
}
