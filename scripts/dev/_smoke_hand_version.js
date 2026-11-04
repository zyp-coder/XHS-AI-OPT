/* 执行器版本一致性（改版本号 / 重打母版之后跑这个）
   一处写新、三处没跟上，公网就会把活压着不派、客户还看不到原因。
   用法：node scripts/dev/_smoke_hand_version.js */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

const ver = json('executor/manifest.json').version;
assert.ok(/^\d+\.\d+\.\d+$/.test(ver), '执行器版本号格式不对: ' + ver);

assert.strictEqual(read('web/download/executor.version').trim(), ver,
  'web/download/executor.version 跟 executor/manifest.json 不一致（忘了跑 node executor/pack.js？）');
assert.strictEqual(json('web/download/_proto.json').version, ver, '母版元信息版本没跟上');
assert.strictEqual(json('web/download/_proto/manifest.json').version, ver, '母版里的 manifest.json 版本没跟上');
console.log('✅ 四处版本一致：' + ver);

const bridge = read('web/exec-bridge.js');
assert.ok(/version:\s*\{[^}]*href:\s*'setup\.html'/.test(bridge), '网页横幅缺 version 条目 / 没指向装机页');
assert.ok(/j\.expectVersion/.test(bridge) && /h\.version/.test(bridge), '网页没拿服务器要的版本和手上的版本对');
assert.ok(/showExecBanner\('version'/.test(bridge), '版本对不上时没弹横幅');
console.log('✅ 老包提示：服务器要的版本 vs 手报的版本 → 弹「去更新」横幅');

const srv = read('server/exec-channel.mjs');
assert.ok(/executor\.version/.test(srv) && /verMismatch/.test(srv), '服务器版本闸门不在了');
console.log('✅ 服务器闸门：读 executor.version，旧包不派活');

console.log('\n全部通过（版本 ' + ver + '）');
