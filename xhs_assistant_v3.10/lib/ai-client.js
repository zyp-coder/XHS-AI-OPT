/**
 * ai-client.js — DeepSeek / OpenAI 兼容 API 调用封装
 */

/**
 * 发送 Chat Completion 请求
 * @param {object} aiConfig - { apiKey, apiBaseUrl, model, temperature, maxTokens }
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<{content: string, usage: object}>}
 */
async function chatCompletion(aiConfig, systemPrompt, userPrompt) {
  const { apiKey, apiBaseUrl, model, temperature, maxTokens } = aiConfig;

  if (!apiKey) {
    throw new Error('未配置 API Key，请在设置页面填写');
  }

  const baseUrl = (apiBaseUrl || 'https://api.deepseek.com/v1').replace(/\/$/, '');
  const url = `${baseUrl}/chat/completions`;

  const body = {
    model: model || 'deepseek-v4-flash',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: temperature ?? 0.8,
    max_tokens: maxTokens ?? 2000,
  };

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      throw new Error('AI 请求超时（90秒），请检查网络或稍后重试');
    }
    throw new Error(`网络错误：${err.message}`);
  }

  if (!resp.ok) {
    let errMsg = `HTTP ${resp.status}`;
    try {
      const errData = await resp.json();
      errMsg = errData?.error?.message || errData?.message || errMsg;
    } catch (_) {}
    throw new Error(`AI API 错误：${errMsg}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || '';
  const usage = data?.usage || {};

  return { content, usage };
}

/**
 * 测试 API 连接（发送一条简单消息）
 * @param {object} aiConfig
 * @returns {Promise<{ok: boolean, message: string, model: string}>}
 */
async function testConnection(aiConfig) {
  try {
    const { content, usage } = await chatCompletion(
      { ...aiConfig, maxTokens: 50, temperature: 0 },
      '你是助手',
      '请回复"连接成功"这四个字，不要添加其他内容。'
    );
    return {
      ok: true,
      message: `连接成功！模型：${aiConfig.model || 'deepseek-v4-flash'}，回复：${content.trim()}`,
      model: aiConfig.model,
      usage,
    };
  } catch (err) {
    return {
      ok: false,
      message: err.message,
    };
  }
}

const AiClient = { chatCompletion, testConnection };

if (typeof module !== 'undefined') {
  module.exports = AiClient;
}
