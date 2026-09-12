/**
 * 调试 JSON 修复逻辑
 */

const Utils = require('./extension/lib/utils.js');

// 测试用例 1: 截断在对象中间
const truncated1 = '{"prospects": [{"id": 1, "name": "test", "comment": "这是一个很长的评论...';
console.log('测试 1:', truncated1);
console.log('结果:', Utils.extractJson(truncated1));
console.log();

// 测试用例 2: 截断在数组中间
const truncated2 = '{"prospects": [{"id": 1}, {"id": 2, "name": "test';
console.log('测试 2:', truncated2);
console.log('结果:', Utils.extractJson(truncated2));
console.log();

// 测试用例 3: 截断在字符串值中间（真实场景）
const truncated3 = '{"prospects": [{"id": 1, "comment": "等额本金好，我为了少还利息，一开始就等额本金，然后不断提前还款，目前商贷每月利息缩减到1000了，本金还4700", "c';
console.log('测试 3:', truncated3);
console.log('结果:', Utils.extractJson(truncated3));
