'use strict';
/* AI 空内容诊断自检：非流式路径也要能打 reasoningOvershoot 标记（否则上层不会加码重试）
   node scripts/dev/_smoke_ai_empty.js */
const assert = require('node:assert/strict');
const path = require('node:path');
const AiClient = require(path.resolve(__dirname, '../../extension/lib/ai-client.js'));

let n = 0;
const ok = (name) => { n++; console.log('  PASS ' + name); };
const CFG = { apiKey: 'k', apiBaseUrl: 'https://example.test/v1', model: 'deepseek-v4-flash', maxTokens: 4096 };
function mockOnce(payload) {
  global.fetch = async () => ({
    ok: true, status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
    body: null,
  });
}

(async () => {
  // 1) 非流式 + 只回思考、finish_reason=length → 必须带 overshoot 标记，上层才会加码重试
  mockOnce({ choices: [{ index: 0, finish_reason: 'length', message: { role: 'assistant', content: '', reasoning_content: 'x'.repeat(900) } }], usage: {} });
  let err = null;
  try { await AiClient.chatCompletion(CFG, 's', 'u'); } catch (e) { err = e; }
  assert.ok(err, '空内容要抛错');
  assert.equal(err.reasoningOvershoot, true, '非流式也要打 reasoningOvershoot 标记');
  assert.match(err.message, /思考了 900 字/, err.message);
  assert.match(err.message, /16384/, '要提示调到 16384');
  assert.ok(String(err.aiRaw || '').includes('reasoning_content'), '原文要挂在 aiRaw 上');
  ok('非流式「只回思考」→ 带 overshoot 标记 + 可行动提示');

  // 2) 非流式 + 真空响应（无思考也没正文）→ 不打 overshoot（加码没意义），但要说清 finish_reason
  mockOnce({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '' } }], usage: {} });
  err = null;
  try { await AiClient.chatCompletion(CFG, 's', 'u'); } catch (e) { err = e; }
  assert.ok(err && !err.reasoningOvershoot, '普通空返回不该打 overshoot');
  assert.match(err.message, /正文为空/, err.message);
  ok('非流式「真空响应」→ 不加码，但报出 finish_reason');

  // 3) 正常返回不受影响
  mockOnce({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"ok":1}' } }], usage: {} });
  const r = await AiClient.chatCompletion(CFG, 's', 'u');
  assert.equal(r.content, '{"ok":1}');
  ok('正常返回不受影响');

  console.log(`\n✅ _smoke_ai_empty.js 全绿：${n} 组断言`);
})().catch(e => { console.error('❌ ' + ((e && e.message) || e)); process.exit(1); });
