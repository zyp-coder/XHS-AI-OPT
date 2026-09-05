/**
 * utils.js — 公共工具函数
 */

/** HTML 转义，防止 XSS */
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 从 AI 回复文本中提取 JSON
 * 兼容：纯 JSON、```json ... ``` 代码块、混有说明文字的情况
 * 支持修复被截断的 JSON（自动补全缺失的括号）
 */
function extractJson(text) {
  if (!text) return null;

  // 尝试直接解析
  try {
    return JSON.parse(text.trim());
  } catch (_) {}

  // 提取 ```json ... ``` 代码块
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch (_) {}
  }

  // 提取第一个 { ... } 块（贪婪匹配最外层）
  const braceStart = text.indexOf('{');
  const braceEnd = text.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    try {
      return JSON.parse(text.slice(braceStart, braceEnd + 1));
    } catch (_) {}
  }

  // 尝试修复被截断的 JSON（AI 回复过长时被 max_tokens 截断）
  const repaired = tryRepairTruncatedJson(text);
  if (repaired) return repaired;

  return null;
}

/**
 * 尝试修复被截断的 JSON
 * 策略：找到最后一个完整的对象/数组项，补全缺失的括号
 */
function tryRepairTruncatedJson(text) {
  if (!text) return null;

  // 找到 JSON 块的起始位置
  const braceStart = text.indexOf('{');
  if (braceStart === -1) return null;

  let jsonStr = text.slice(braceStart).trim();

  // 策略 1：尝试找末尾完整的 key-value 对
  const endPatterns = [
    /"\s*:\s*"[^"]*"\s*$/m,  // "key": "value"
    /"\s*:\s*\d+\.?\d*\s*$/m,  // "key": 123
    /"\s*:\s*(?:true|false|null)\s*$/m,  // "key": true/false/null
  ];

  let lastCompletePos = -1;
  for (const pattern of endPatterns) {
    const match = jsonStr.match(pattern);
    if (match) {
      const pos = match.index + match[0].length;
      if (pos > lastCompletePos) lastCompletePos = pos;
    }
  }

  // 策略 2：如果末尾没有完整值（截断在字符串中间），找最后一个完整的 "key": "value"
  if (lastCompletePos === -1) {
    const anyValuePattern = /"\s*:\s*"[^"]*"/g;
    let match;
    while ((match = anyValuePattern.exec(jsonStr)) !== null) {
      const pos = match.index + match[0].length;
      if (pos > lastCompletePos) lastCompletePos = pos;
    }
  }

  // 策略 3：如果还是没有，找最后一个数字/布尔值
  if (lastCompletePos === -1) {
    const anyNumPattern = /"\s*:\s*(?:\d+\.?\d*|true|false|null)/g;
    let match;
    while ((match = anyNumPattern.exec(jsonStr)) !== null) {
      const pos = match.index + match[0].length;
      if (pos > lastCompletePos) lastCompletePos = pos;
    }
  }

  if (lastCompletePos > 0) {
    jsonStr = jsonStr.slice(0, lastCompletePos);
  } else {
    // 完全无法修复
    return null;
  }

  // 统计未闭合的括号（用栈跟踪嵌套顺序）
  const stack = [];
  let inString = false, escape = false;
  for (const ch of jsonStr) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') {
      if (stack.length > 0 && stack[stack.length - 1] === ch) stack.pop();
    }
  }

  // 按嵌套逆序补全缺失的括号
  let suffix = '';
  while (stack.length > 0) {
    suffix += stack.pop();
  }

  if (suffix) {
    try {
      return JSON.parse(jsonStr + suffix);
    } catch (_) {}
  }

  return null;
}

/**
 * 将评论列表格式化为 AI 可读的文本（0-based 编号）
 * 支持两种格式：
 *   comments = [{author, content, ...}]  简单列表
 *   threads  = [{author, content, replies:[...]}]  带回复的线程结构
 */
function buildCommentsText(comments) {
  if (!comments || comments.length === 0) return '（无评论）';
  return comments.map((c, i) => {
    const author = c.author || '匿名';
    const content = c.content || '';
    return `${i}. @${author}: ${content}`;
  }).join('\n');
}

/**
 * 延迟等待
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const Utils = { esc, extractJson, buildCommentsText, sleep };

if (typeof module !== 'undefined') {
  module.exports = Utils;
}
