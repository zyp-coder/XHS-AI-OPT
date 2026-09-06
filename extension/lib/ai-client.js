/**
 * ai-client.js — DeepSeek / OpenAI 兼容 API 调用封装
 */

/**
 * 发送 Chat Completion 请求
 * @param {object} aiConfig - { apiKey, apiBaseUrl, model, temperature, maxTokens }
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {(charsSoFar:number)=>void} [onProgress] - 传了就走流式，边生成边回调已生成字数
 * @returns {Promise<{content: string, usage: object}>}
 */
/**
 * 主备自动切换：优先主模型，失败时若配置了备用模型且错误属于可切换类型（鉴权/额度/限流/网络/服务端错误）则自动重试备用。
 * @param {object} aiConfig - { apiKey, apiBaseUrl, model, temperature, maxTokens, fallbackApiKey, fallbackApiBaseUrl, fallbackModel }
 */
async function chatCompletion(aiConfig, systemPrompt, userPrompt, onProgress) {
  try {
    return await _chatOnce(aiConfig, systemPrompt, userPrompt, onProgress);
  } catch (primaryErr) {
    const fb = _fallbackOf(aiConfig);
    if (fb && _shouldFailover(primaryErr)) {
      console.warn(`[AI] Chat模型(${aiConfig.model})失败，切换多模态: ${primaryErr.message}`);
      try {
        return await _chatOnce(fb, systemPrompt, userPrompt, onProgress);
      } catch (fbErr) {
        fbErr.message = `Chat模型失败(${primaryErr.message})；多模态模型(${fb.model})也失败(${fbErr.message})`;
        throw fbErr;
      }
    }
    throw primaryErr;
  }
}

/** 若配置了备用模型，构造备用配置（沿用主模型的温度/输出上限） */
function _fallbackOf(aiConfig) {
  const fbKey = aiConfig.fallbackApiKey;
  const fbBase = aiConfig.fallbackApiBaseUrl;
  const fbModel = aiConfig.fallbackModel;
  if (!fbKey || !fbBase || !fbModel) return null;
  return {
    apiKey: fbKey,
    apiBaseUrl: fbBase,
    model: fbModel,
    temperature: aiConfig.temperature ?? 0.8,
    maxTokens: aiConfig.maxTokens ?? 4096,
  };
}

/** 判断错误是否应切换到备用模型（鉴权/额度/限流/网络/超时/服务端错误；不含内容为空等业务问题） */
function _shouldFailover(err) {
  const msg = String((err && err.message) || '').toLowerCase();
  const status = err && err.status;
  const badStatus = status && [401, 402, 403, 404, 429, 500, 502, 503, 504].includes(Number(status));
  if (badStatus) return true;
  const kws = [
    'unauthorized', 'invalid api key', 'api key', 'insufficient_quota', 'quota', 'balance',
    'rate limit', 'rate_limit', 'too many', 'permission denied', 'connection', 'connect',
    'timeout', 'timed out', 'network', 'fetch failed', '502', '503', '504', '500', 'overloaded',
  ];
  return kws.some((k) => msg.includes(k));
}

async function _chatOnce(aiConfig, systemPrompt, userPrompt, onProgress) {
  const { apiKey, apiBaseUrl, model, temperature, maxTokens } = aiConfig;

  if (!apiKey) {
    throw new Error('未配置 API Key，请在设置页面填写');
  }
  // ★ 修复：API Key 里若混入非 ASCII 字符（中文/Emoji 等，常见于误粘贴），浏览器 fetch 的
  //   Authorization 头会直接抛 "String contains non ISO-8859-1 code point"。
  //   这里做防御：清掉空白/控制符，并显著提示用户重填，不再给一个看不懂的崩溃。
  const cleanKey = String(apiKey).replace(/[\s\r\n\t]/g, '').trim();
  if (/[^\x00-\xff]/.test(cleanKey)) {
    throw new Error('API Key 含有非英文/数字字符（可能粘贴进了中文或多余内容）。请到「设置→AI 配置」重新复制填写正确的 API Key。');
  }
  const key = cleanKey;

  const baseUrl = (apiBaseUrl || 'https://api.deepseek.com/v1').replace(/\/$/, '');
  const url = `${baseUrl}/chat/completions`;

  const useStream = typeof onProgress === 'function';
  const body = {
    model: model || 'deepseek-chat',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: temperature ?? 0.8,
    max_tokens: maxTokens ?? 4096,
  };
  if (useStream) {
    body.stream = true;
    // 让服务端在最后一个 chunk 里带上 usage（DeepSeek/OpenAI 兼容）
    body.stream_options = { include_usage: true };
  }

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      throw new Error('AI 请求超时（60秒），请检查网络或稍后重试');
    }
    // 把“headers 含非法字符”这类底层错也转成清晰提示
    if (/non ISO-8859-1|headers' property/i.test(String(err.message || ''))) {
      throw new Error('AI 请求配置异常：API Key 或地址包含非法字符（多半是粘贴进了中文）。请在设置→AI 配置重新填写正确的 API Key。');
    }
    throw new Error(`网络错误：${err.message}`);
  }

  if (!resp.ok) {
    let errMsg = `HTTP ${resp.status}`;
    try {
      const errData = await resp.json();
      errMsg = errData?.error?.message || errData?.message || errMsg;
    } catch (_) {}
    const httpErr = new Error(`AI API 错误：${errMsg}`);
    httpErr.status = resp.status;
    // ★ 模型不存在自动回退：默认模型已迁移为非推理模型（如 deepseek-chat），
    //   若中转站不提供该模型名（返回 400/404 + model 相关错误），自动回退到迁移前的旧模型，避免功能全挂
    if (resp.status === 400 || resp.status === 404) {
      const msg = String(errMsg);
      if (/model/i.test(msg) && /(not found|not exist|no such|invalid|does not exist|不存在|无法识别|未知模型|未提供|不可用|no permission)/i.test(msg)) {
        try {
          const stored = await chrome.storage.local.get('config');
          const cfg = stored.config || {};
          const prev = cfg.ai && cfg.ai._prevModel;
          if (prev && cfg.ai.model !== prev) {
            cfg.ai.model = prev;
            delete cfg.ai._prevModel;
            await chrome.storage.local.set({ config: cfg });
            console.warn(`[小红书助手] 中转站不认模型 ${model}，已自动回退到 ${prev}`);
            throw new Error(`模型「${model}」中转站不支持，已自动回退到原模型「${prev}」。如想彻底换用非推理模型，请到设置页选择服务商支持的模型名`);
          }
        } catch (e) {
          if (e && e.message && e.message.includes('已自动回退')) throw e;
        }
      }
    }
    throw httpErr;
  }

  // ★ 流式：逐块读 SSE，拼接 content 并回调进度
  if (useStream && resp.body && typeof resp.body.getReader === 'function') {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let content = '';
    let usage = {};
    let reasoningLen = 0; // 模型思考过程总字数（DeepSeek 推理字段 delta.reasoning_content）
    let finishReason = ''; // 最后 chunk 的结束原因：length=被 max_tokens 截断；content_filter=被内容过滤
    let chunkCount = 0;
    const rawChunks = []; // 保留原始字节：部分中转/网关忽略 stream=true 直接返回完整 JSON，需要整体解析兜底
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        rawChunks.push(value);
        buffer += decoder.decode(value, { stream: true });
        // SSE 以 \n\n 分隔事件，逐行取 data:
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            chunkCount++;
            const delta = json?.choices?.[0]?.delta || {};
            const d = delta.content || '';
            if (d) {
              content += d;
              try { onProgress(content.length); } catch (_) {}
            }
            // ★ 推理模型：思考过程在 delta.reasoning_content，不计入正文但必须统计——
            //   思考可能占满 max_tokens 导致正文为空（只发思考、不发回答）
            const r = delta.reasoning_content || '';
            if (r) reasoningLen += r.length;
            const fr = json?.choices?.[0]?.finish_reason;
            if (fr) finishReason = fr;
            if (json?.usage) usage = json.usage;
          } catch (_) { /* 不完整的 chunk 忽略 */ }
        }
      }
    } catch (err) {
      throw new Error(`AI 流式读取中断：${err.message}`);
    }
    // ★ 容错：整个响应没有 data: 行 → 中转站把 stream 忽略、直接回了完整 JSON，整体解析兜底
    let fullRawText = ''; // 原始响应全文（空内容诊断用：展示服务端到底回了什么）
    if (!content.trim() && rawChunks.length > 0) {
      try {
        const total = rawChunks.reduce((acc, c) => acc + c.length, 0);
        const bytes = new Uint8Array(total);
        let off = 0;
        for (const c of rawChunks) { bytes.set(c, off); off += c.length; }
        fullRawText = new TextDecoder('utf-8').decode(bytes).trim();
        // 只有确实不是 SSE 流（没有 data: 行）时才整体解析——否则保留原文用于诊断
        if (!fullRawText.includes('data:')) {
          try {
            const full = JSON.parse(fullRawText);
            const direct = full?.choices?.[0]?.message?.content || '';
            if (direct.trim()) {
              content = direct;
              try { onProgress(content.length); } catch (_) {}
            }
          } catch (_) { /* 不是 JSON 就交给下面的空内容守卫报错 */ }
        }
      } catch (_) {}
    }
    return {
      content: _ensureNonEmpty(content, { fullRaw: fullRawText, chunkCount, reasoningLen, finishReason }),
      usage,
    };
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || '';
  const usage = data?.usage || {};

  return { content: _ensureNonEmpty(content, JSON.stringify(data)), usage };
}

/** 内容为空时给出明确错误（而不是让上层误报“JSON 格式错误”），并把服务端原始响应附在 err.aiRaw 上
 *  常见原因：服务端限流/内容过滤/中转站异常；提示用户重试而非排查格式
 *  diag 支持两种形态：
 *    - 字符串：非流式路径直接传 JSON.stringify(data)
 *    - 对象 { fullRaw, chunkCount, reasoningLen, finishReason }：流式路径的统计诊断
 */
function _ensureNonEmpty(content, diag) {
  if (!content || !String(content).trim()) {
    let hint = '';
    let aiRaw = '';
    if (diag && typeof diag === 'object') {
      const { fullRaw, chunkCount, reasoningLen, finishReason } = diag;
      if (reasoningLen > 0) {
        // 推理模型只发了思考过程、没发正文：最常见是思考占满 max_tokens 被截断
        hint = `模型思考了 ${reasoningLen} 字但未输出正文${finishReason ? `（finish_reason=${finishReason}` : ''}${finishReason === 'length' ? '——思考过程占满了输出上限，请到设置页把「AI 最大输出 tokens」调大（建议 16384），或改用非推理模型（如 deepseek-chat）' : ''}）`;
      } else {
        hint = `服务端返回 ${chunkCount || 0} 个数据块但正文为空${finishReason ? `（finish_reason=${finishReason}）` : ''}`;
      }
      if (fullRaw) {
        hint += `。原始响应：${String(fullRaw).slice(0, 150)}`;
        aiRaw = String(fullRaw);
      }
    } else {
      hint = `服务端响应：${String(diag || '').slice(0, 150)}`;
      aiRaw = String(diag || '');
    }
    const err = new Error(`AI 返回内容为空（${hint}）请稍后重试`);
    // ★ 思考占满 max_tokens：挂标记供上层精准识别（自动放宽输出上限重试，而不是盲目重试）
    if (diag && typeof diag === 'object' && diag.reasoningLen > 0 && diag.finishReason === 'length') {
      err.reasoningOvershoot = true;
    }
    if (aiRaw) err.aiRaw = aiRaw; // popup 的「AI 原始回复」展开块会展示完整内容
    throw err;
  }
  return content;
}

/**
 * 测试 API 连接（发送一条简单消息）
 * @param {object} aiConfig
 * @returns {Promise<{ok: boolean, message: string, model: string}>}
 */
async function testConnection(aiConfig) {
  try {
    const { content, usage } = await chatCompletion(
      { ...aiConfig, maxTokens: 512, temperature: 0 }, // 512 给推理模型留思考预算，避免思考就占满 50 导致误报连接失败
      '你是助手',
      '请回复"连接成功"这四个字，不要添加其他内容。'
    );
    return {
      ok: true,
      message: `连接成功！模型：${aiConfig.model || 'deepseek-chat'}，回复：${content.trim()}`,
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
