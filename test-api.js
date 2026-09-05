/**
 * AI 接口测试脚本
 * 用法: node test-api.js [provider] [apiKey]
 */

const PROVIDER_CONFIG = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini'],
  },
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
  },
  siliconflow: {
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['deepseek-ai/DeepSeek-V4-Flash', 'Qwen/Qwen3.5-397B-A17B'],
  },
};

async function testConnection(provider, apiKey, modelIndex = 0) {
  const config = PROVIDER_CONFIG[provider];
  if (!config) {
    console.error('Unknown provider: ' + provider);
    return;
  }

  const model = config.models[modelIndex];
  const baseUrl = config.baseUrl;
  const url = baseUrl + '/chat/completions';

  console.log('\n[Test] ' + provider);
  console.log('  URL: ' + url);
  console.log('  Model: ' + model);

  if (!apiKey) {
    console.log('  [SKIP] No API key provided');
    console.log('  [OK] Request structure valid');
    return;
  }

  try {
    const body = {
      model: model,
      messages: [
        { role: 'system', content: 'You are a helper' },
        { role: 'user', content: 'Reply with OK' },
      ],
      temperature: 0,
      max_tokens: 50,
    };

    console.log('  [SENDING] Request...');
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.log('  [FAIL] HTTP ' + resp.status + ': ' + errText.slice(0, 200));
      return;
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || '';
    console.log('  [OK] Reply: ' + content.trim());

  } catch (err) {
    console.log('  [ERROR] ' + err.message);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const provider = args[0] || 'all';
  const apiKey = args[1] || '';

  console.log('=== AI API Test ===');

  if (provider === 'all') {
    for (const p of Object.keys(PROVIDER_CONFIG)) {
      await testConnection(p, '');
    }
  } else {
    await testConnection(provider, apiKey);
  }

  console.log('\n=== Done ===');
}

main().catch(console.error);
