/* 手机桥：固定扩展 ID 的生成/写入（可反复跑，幂等）

   为什么要有固定 ID：主包的 manifest 里要写 externally_connectable.ids = [手机桥的 ID] 做白名单，
   而 Chrome 对「加载已解压」的扩展是按目录路径算 ID 的——路径一变 ID 就变，主包的白名单就失效。
   给桥的 manifest 写上固定的 key（RSA 公钥），它的 ID 就恒定了。

   私钥落在 bridge/dev/bridge.key（.gitignore 里 *.key 已忽略，不入库），只有将来要签 CRX 才用得上；
   主包不需要 key —— 千万别给主包加 key，换了 ID 等于客户机的存储和授权全丢。

   用法：node scripts/dev/_gen_bridge_key.js
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const KEY_FILE = path.join(ROOT, 'bridge/dev/bridge.key');
const BRIDGE_MANIFEST = path.join(ROOT, 'bridge/manifest.json');
const MAIN_MANIFEST = path.join(ROOT, 'extension/manifest.json');

function ensureKey() {
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  if (fs.existsSync(KEY_FILE)) return;
  execFileSync('openssl', ['genrsa', '-out', KEY_FILE, '2048'], { stdio: 'ignore' });
  console.log('生成私钥:', path.relative(ROOT, KEY_FILE));
}

function pubKeyB64() {
  const der = execFileSync('openssl', ['rsa', '-in', KEY_FILE, '-pubout', '-outform', 'DER']);
  return { der, b64: der.toString('base64') };
}

/* Chrome 的扩展 ID 算法：SHA-256(SPKI DER) 前 16 字节，每个 nibble 映射到 a~p */
function extIdOf(der) {
  const mp = 'abcdefghijklmnop';
  return Array.from(crypto.createHash('sha256').update(der).digest().subarray(0, 16))
    .map(b => mp[(b >> 4) & 0xf] + mp[b & 0xf]).join('');
}

function patchJson(file, patch, label) {
  const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  const before = JSON.stringify(obj);
  const next = patch(obj);
  if (JSON.stringify(next) === before) { console.log(label + ': 已是最新，未改动'); return; }
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n', 'utf8');
  console.log(label + ': 已更新');
}

ensureKey();
const { der, b64 } = pubKeyB64();
const id = extIdOf(der);

patchJson(BRIDGE_MANIFEST, (m) => ({ ...m, key: b64 }), 'bridge/manifest.json (key)');
patchJson(MAIN_MANIFEST, (m) => ({
  ...m,
  externally_connectable: { ids: [id] },
}), 'extension/manifest.json (externally_connectable)');

const idsPath = path.join(ROOT, 'bridge/lib/ids.js');
fs.mkdirSync(path.dirname(idsPath), { recursive: true });
fs.writeFileSync(idsPath,
  '/* 由 scripts/dev/_gen_bridge_key.js 写入，别手改：手机桥的固定扩展 ID */\n' +
  '(function (root) { root.BRIDGE_ID = ' + JSON.stringify(id) + '; })(typeof self !== \'undefined\' ? self : this);\n',
  'utf8');

console.log('');
console.log('手机桥 ID :', id);
console.log('主包白名单已写入 externally_connectable.ids');
