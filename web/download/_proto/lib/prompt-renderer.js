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
  //    注意最后一条“教操作”是有条件的：品牌推广（不引流）目标下不能教产品操作路径，
  //    否则会与推广目标/引导总闸打架，写出带引导性的话术
  if (kbContext && kbContext.trim()) {
    system = kbContext +
      '\n\n【知识库使用规则——最高优先级】' +
      '你的回复必须直接引用知识库中的具体数据、公式、额度和操作步骤。' +
      '禁止泛泛而谈！禁止只说笼统的话！' +
      '每一条回复都必须包含至少一个来自知识库的具体数字或操作步骤。' +
      '如果知识库有产品操作指引，且本次推广目标允许引导对方去使用产品，才告诉用户具体在哪里、怎么操作；' +
      '若本次推广目标是不引流的品牌推广，则只引用知识库里的数据与口碑细节，不要教产品操作路径。\n\n' +
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
