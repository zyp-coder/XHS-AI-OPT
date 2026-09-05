/**
 * prompt-renderer.js — Prompt 渲染引擎
 * 移植自 ai_engine.py 的 _render_prompt()
 * 整合：知识库注入 + 话术库注入 + 变量替换
 */

/**
 * 渲染完整的 System Prompt 和 User Prompt
 *
 * @param {object} promptTemplate - { system_prompt, user_prompt_template }
 * @param {object} context - 渲染变量（note_title, comment_content, 等）
 * @param {string} kbContext - 知识库注入文本（来自 knowledge-search.js）
 * @returns {{ systemPrompt: string, userPrompt: string }}
 */
function renderPrompt(promptTemplate, context, kbContext) {
  if (!promptTemplate) {
    throw new Error('未找到提示词模板');
  }

  let system = promptTemplate.system_prompt || '';
  let user = promptTemplate.user_prompt_template || '';

  // 1. 知识库注入（前置到 System Prompt 头部）
  if (kbContext && kbContext.trim()) {
    system = kbContext +
      '\n\n【重要——你必须引用上面的知识库】以上知识库有大量真实专业数据和个人经历故事。' +
      '你的回复必须从中提取具体的数字、事实、案例来支撑你的观点。' +
      '专业数据用于分析型回复，个人经历用于情感型回复。不要只说笼统的话，要用知识库里的具体内容。\n\n' +
      system;
  }

  // 2. 替换变量占位符（{key} → context[key]）
  const allVars = { ...context };

  // 同时替换 system 和 user 中的占位符
  system = replacePlaceholders(system, allVars);
  user = replacePlaceholders(user, allVars);

  return { systemPrompt: system, userPrompt: user };
}

/**
 * 替换模板中的 {key} 占位符
 */
function replacePlaceholders(template, vars) {
  if (!template) return '';
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(vars, key)
      ? String(vars[key] ?? '')
      : match;
  });
}

const PromptRenderer = { renderPrompt, replacePlaceholders };

if (typeof module !== 'undefined') {
  module.exports = PromptRenderer;
}
