/**
 * 内部流程测试脚本
 * 测试 extractJson、JSON 修复、provider 配置等核心功能
 */

// 加载 utils.js
const Utils = require('./extension/lib/utils.js');

// 加载 settings.js 中的 PROVIDER_CONFIG（手动复制）
const PROVIDER_CONFIG = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    models: [
      { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
      { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
    ],
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { value: 'gpt-4.1', label: 'GPT-4.1' },
      { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
    ],
  },
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      { value: 'qwen-turbo', label: 'Qwen Turbo' },
      { value: 'qwen-plus', label: 'Qwen Plus' },
    ],
  },
  siliconflow: {
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: [
      { value: 'deepseek-ai/DeepSeek-V4-Flash', label: 'DeepSeek V4 Flash' },
    ],
  },
};

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log('  ✅ ' + message);
    passCount++;
  } else {
    console.log('  ❌ ' + message);
    failCount++;
  }
}

function testExtractJson() {
  console.log('\n=== 测试 extractJson ===');

  // 测试 1: 纯 JSON
  const result1 = Utils.extractJson('{"prospects": [{"id": 1}]}');
  assert(result1 && result1.prospects.length === 1, '纯 JSON 解析');

  // 测试 2: 带 ```json 代码块
  const result2 = Utils.extractJson('好的，这是结果：\n```json\n{"prospects": [{"id": 2}]}\n```\n希望对你有帮助！');
  assert(result2 && result2.prospects.length === 1, '```json 代码块解析');

  // 测试 3: 混有说明文字
  const result3 = Utils.extractJson('根据分析，我发现以下商机：{"prospects": [{"id": 3}], "summary": "测试"}');
  assert(result3 && result3.prospects.length === 1, '混有说明文字的 JSON');

  // 测试 4: 空输入
  const result4 = Utils.extractJson('');
  assert(result4 === null, '空输入返回 null');

  // 测试 5: 无 JSON
  const result5 = Utils.extractJson('这是一段纯文本，没有 JSON');
  assert(result5 === null, '无 JSON 返回 null');
}

function testTruncatedJsonRepair() {
  console.log('\n=== 测试 JSON 截断修复 ===');

  // 测试 1: 截断在对象中间
  const truncated1 = '{"prospects": [{"id": 1, "name": "test", "comment": "这是一个很长的评论...';
  const result1 = Utils.extractJson(truncated1);
  assert(result1 !== null, '截断在对象中间 - 应能修复');
  if (result1) {
    assert(result1.prospects && result1.prospects.length > 0, '修复后包含 prospects');
  }

  // 测试 2: 截断在数组中间
  const truncated2 = '{"prospects": [{"id": 1}, {"id": 2, "name": "test';
  const result2 = Utils.extractJson(truncated2);
  assert(result2 !== null, '截断在数组中间 - 应能修复');
  if (result2) {
    assert(Array.isArray(result2.prospects), '修复后 prospects 是数组');
  }

  // 测试 3: 截断在字符串值中间
  const truncated3 = '{"prospects": [{"id": 1, "comment": "等额本金好，我为了少还利息，一开始就等额本金，然后不断提前还款，目前商贷每月利息缩减到1000了，本金还4700", "c';
  const result3 = Utils.extractJson(truncated3);
  assert(result3 !== null, '截断在字符串值中间 - 应能修复');

  // 测试 4: 完整 JSON 不应被破坏
  const complete = '{"prospects": [{"id": 1, "name": "test"}], "summary": "完成"}';
  const result4 = Utils.extractJson(complete);
  assert(result4 && result4.summary === '完成', '完整 JSON 正常解析');
}

function testProviderConfig() {
  console.log('\n=== 测试 PROVIDER_CONFIG ===');

  // 测试 1: 所有提供商都有 baseUrl
  for (const [provider, config] of Object.entries(PROVIDER_CONFIG)) {
    assert(config.baseUrl && config.baseUrl.startsWith('https'), provider + ' 有有效的 baseUrl');
  }

  // 测试 2: 所有提供商都有 models 数组
  for (const [provider, config] of Object.entries(PROVIDER_CONFIG)) {
    assert(Array.isArray(config.models) && config.models.length > 0, provider + ' 有模型列表');
  }

  // 测试 3: 模型都有 value 和 label
  for (const [provider, config] of Object.entries(PROVIDER_CONFIG)) {
    for (const model of config.models) {
      assert(model.value && model.label, provider + ' 模型 ' + model.value + ' 有 value 和 label');
    }
  }

  // 测试 4: DeepSeek 模型名称正确
  const deepseekModels = PROVIDER_CONFIG.deepseek.models.map(m => m.value);
  assert(deepseekModels.includes('deepseek-v4-flash'), 'DeepSeek 包含 v4-flash');
  assert(deepseekModels.includes('deepseek-v4-pro'), 'DeepSeek 包含 v4-pro');
  assert(!deepseekModels.includes('deepseek-chat'), 'DeepSeek 不应包含旧的 deepseek-chat');
}

function testBuildCommentsText() {
  console.log('\n=== 测试 buildCommentsText ===');

  // 测试 1: 正常评论列表
  const comments = [
    { author: '用户A', content: '评论1' },
    { author: '用户B', content: '评论2' },
  ];
  const result1 = Utils.buildCommentsText(comments);
  assert(result1.includes('0. @用户A: 评论1'), '格式化评论 0');
  assert(result1.includes('1. @用户B: 评论2'), '格式化评论 1');

  // 测试 2: 空列表
  const result2 = Utils.buildCommentsText([]);
  assert(result2 === '（无评论）', '空列表返回提示');

  // 测试 3: null 输入
  const result3 = Utils.buildCommentsText(null);
  assert(result3 === '（无评论）', 'null 返回提示');
}

// 运行所有测试
console.log('🧪 开始内部流程测试...');

testExtractJson();
testTruncatedJsonRepair();
testProviderConfig();
testBuildCommentsText();

console.log('\n' + '='.repeat(50));
console.log(`测试结果：${passCount} 通过，${failCount} 失败`);
console.log('='.repeat(50));

if (failCount > 0) {
  process.exit(1);
} else {
  console.log('\n✅ 所有测试通过！');
  process.exit(0);
}
