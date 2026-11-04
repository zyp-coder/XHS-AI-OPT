/**
 * pack.js — 执行器发行包打包脚本
 *
 * 作用：把 executor/ 目录铺成一份「专属包母版」放到 web/download/_proto/——
 *       公网服务器拿它按账号现打专属包（server/seat-pack.mjs），一账号一包。
 *       母版里的三件双击脚本留 __SLUG__ 占位、装机说明留 {{NAME}}/{{CODE}} 占位，
 *       服务器替成账号 id / 名字 / 配对号即可，不必在服务器上重做编码。
 *
 * 用法（在项目任意目录执行）：
 *   node executor/pack.js                                  只铺母版（发版必跑）
 *   node executor/pack.js --slug=acc_xxx --code=XHD-ABCD   顺手出一份专属包 zip（离线发人用）
 *
 * 注意：
 *   - 包里的 .bat/.vbs 必须 GBK+CRLF（cmd 的解析要求）——母版里就转好，源文件保持 UTF-8；
 *   - 不打包 pack.js 自己和临时目录；
 *   - per-customer 的 zip 用 Windows PowerShell 的 Compress-Archive（公网那条路走纯 JS，不靠它）。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

/* PACK_SRC / PACK_ROOT：并行会话改源目录时，用一份冻结的暂存目录出包，别跟它抢文件 */
const SRC = path.resolve(process.env.PACK_SRC || __dirname);
const ROOT = path.resolve(process.env.PACK_ROOT || path.join(__dirname, '..'));
const OUT_DIR = path.join(ROOT, 'web', 'download');
const PROTO_DIR = path.join(OUT_DIR, '_proto');
const PROTO_META = path.join(OUT_DIR, '_proto.json');
const CUSTOM_DIR = path.join(OUT_DIR, 'customers');
const INSTALLER_SRC = path.join(ROOT, 'scripts', 'installer');
const PKG_NAME = '小红书助手-执行器';
const gate = require(path.join(ROOT, 'scripts', 'hand-package-gate.js'));

/* 离线出包用：--slug=客户代号 --code=配对号 [--name=称呼] [--server=地址]
   扩展身份＝装在 %LOCALAPPDATA%\XhsHand\<代号>\ 下的那个路径决定 → 一个客户一个身份。 */
function parseArgs() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function safeName(s) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, '').trim();
}

/* 传 o.name/o.slug/o.code 就是正文；传 {{NAME}} 这类占位就是模板（母版用） */
function guideText(o, version) {
  return [
    '小红书助手 · 执行器  ' + (o.name ? '（' + o.name + '）' : ''),
    '================================',
    '',
    '四步装完。配对号已经填好了，不用抄。',
    '（第 1 步下载你已经做完了，从这里接着来。）',
    '',
    '第 2 步：先解锁，再解压，然后双击「装我.bat」',
    '   右键这个 zip →「属性」→ 最下面勾上「解除锁定」→「确定」，然后再解压。',
    '   不勾这一步，里面的「装我.bat」会被 Windows 拦一下。',
    '   解压出来的文件夹里双击「装我.bat」：它会把文件放到固定位置、把文件夹路径复制好、打开扩展页。',
    '   弹「Windows 已保护你的电脑」就点「更多信息」→「仍要运行」。',
    '   那个小黑窗先别关，下一步要粘路径。',
    '',
    '第 3 步：在扩展页里做两下',
    '   1. 打开右上角「开发者模式」',
    '   2. 点「加载解压缩的扩展程序」→ 在选文件夹的窗口按 Ctrl+V → 点「选择文件夹」',
    '   列表里出现「小红书助手 · 执行器」那张卡片，就是装好了。',
    '',
    '第 4 步：点浏览器工具栏上的执行器图标',
    '   配对号已经填好，点「挂上」→ 变成 🟢 在线待命 就是连上了。',
    '',
    '装完这个浏览器别关：关了就不干活；登录过期会停下来等你扫码。',
    '重启电脑也不用管：装的时候已经把「开机自启」设好了，重启后它会自己把浏览器打开、自己挂上线。',
    '',
    '万一双击「装我.bat」被拦了（弹「智能应用控制已阻止」这类，点掉也装不上）：',
    '   别硬试。这条路不用双击，照样能装：',
    '   1. 把 zip 解压到桌面；把解压出来的那个文件夹改名成：' + o.slug,
    '   2. 地址栏粘 ' + ' %LOCALAPPDATA%\\XhsHand\\ ' + '回车（没有 XhsHand 就新建一个），把刚才改好名的文件夹拖进去',
    '   3. 打开扩展页（Edge 是 edge://extensions，Chrome 是 chrome://extensions）→ 右上角「开发者模式」打开',
    '      →「加载解压缩的扩展程序」→ 粘这个路径：%LOCALAPPDATA%\\XhsHand\\' + o.slug + ' →「选择文件夹」',
    '   4. 点执行器图标 →「挂上」，变绿就是连上了',
    '   这么装的没设「开机自启」：双击同一个文件夹里的「设置开机自启.bat」，一下就补上。',
    '   以后更新：新包解压后把里面的文件全选、复制，粘进这个文件夹覆盖，再到扩展页点「重新加载」。',
    '   不用了：删掉 %LOCALAPPDATA%\\XhsHand\\' + o.slug + ' 这个文件夹，扩展页里点「移除」。',
    '',
    '万一浏览器把扩展偷偷禁掉（扩展页里显示「已停用」或变灰）：',
    '   双击同一个文件夹里的「一键修复.bat」，关掉浏览器再双击，一下就修好——不用重装、不用重新登录、配对号也不会掉。',
    '',
    '这个号：' + (o.name || o.slug) + '   配对号：' + o.code,
    '版本：' + version,
    '',
    '卡住了：双击同一个文件夹里的「装机教程.html」，七种常见卡点一条条写着（带示意图）。',
    '以后怎么更新：我们发来新包，双击里面的「更新.bat」，再到扩展页点一下「重新加载」。',
    '要不用了：双击「卸载.bat」，按它说的两步做。',
    '',
    '注意：只能用 Chrome 或 Edge；360、QQ、搜狗这些浏览器装不了。',
    '别挪装好的那个文件夹——挪了扩展会失效。',
    ''
  ].join('\r\n');
}

function zipDir(srcDir, zipPath) {
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath);
  const psSrc = srcDir.replace(/'/g, "''");
  const psDst = zipPath.replace(/'/g, "''");
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${psSrc}' -DestinationPath '${psDst}' -Force"`, { stdio: 'inherit' });
}

/* 把暂存目录里的 .bat/.vbs 转成 GBK+CRLF（源文件不动；转的是打包副本）。
   PS5.1 里 [char]13+[char]10 是加法（不是字符串拼接）——必须先 [string] 转型。 */
function fixBatsToGbk(dir) {
  const ps = '$d=$env:EXEC_BAT_DIR; Get-ChildItem -Path $d -File | Where-Object { $_.Extension -eq \'.bat\' -or $_.Extension -eq \'.vbs\' } | ForEach-Object { '
    + '$c=[IO.File]::ReadAllText($_.FullName,[Text.Encoding]::UTF8); '
    + '$c=$c.Replace([string][char]13+[string][char]10,[string][char]10).Replace([string][char]10,[string][char]13+[string][char]10); '
    + '[IO.File]::WriteAllText($_.FullName,$c,[Text.Encoding]::GetEncoding(936)) }';
  execSync(`powershell -NoProfile -Command "${ps}"`, { env: Object.assign({}, process.env, { EXEC_BAT_DIR: dir }), stdio: 'inherit' });
}

/* 字节级替占位：GBK 文件按 utf8 读会坏；latin1 一字节一字符，来回转不丢字节。
   占位 __SLUG__ 是纯 ASCII，替完仍是合法 GBK。 */
function replaceBytesInFile(file, from, to) {
  const buf = fs.readFileSync(file);
  fs.writeFileSync(file, Buffer.from(buf.toString('latin1').split(from).join(to), 'latin1'));
}

/* 发版前留一份能装回去的旧母版 + 一份源码，保留最近 3 份（确认单「风险与回滚」） */
function snapshotOld() {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (fs.existsSync(PROTO_DIR)) {
    const rb = path.join(OUT_DIR, '_rollback');
    fs.mkdirSync(rb, { recursive: true });
    const dst = path.join(rb, 'proto-' + stamp);
    if (!fs.existsSync(dst)) fs.cpSync(PROTO_DIR, dst, { recursive: true });
    const dirs = fs.readdirSync(rb).filter((x) => /^proto-/.test(x)).sort();
    for (const x of dirs.slice(0, Math.max(0, dirs.length - 3))) fs.rmSync(path.join(rb, x), { recursive: true, force: true });
  }
  const snaps = path.join(ROOT, 'tmp', 'snapshots');
  const srcSnap = path.join(snaps, 'executor-src-' + stamp);
  if (!fs.existsSync(srcSnap)) {
    fs.mkdirSync(snaps, { recursive: true });
    fs.cpSync(SRC, srcSnap, { recursive: true });
    const dirs = fs.readdirSync(snaps).filter((x) => /^executor-src-/.test(x)).sort();
    for (const x of dirs.slice(0, Math.max(0, dirs.length - 3))) fs.rmSync(path.join(snaps, x), { recursive: true, force: true });
  }
  return { stamp, srcSnap };
}

/* 母版：按允许清单铺一遍 → 三件脚本＋说明＋教程 → 转 GBK → 过闸门 */
function buildProto(ver) {
  fs.rmSync(PROTO_DIR, { recursive: true, force: true });
  fs.mkdirSync(PROTO_DIR, { recursive: true });

  /* 产品页、字体、备份件从源头就不进来 */
  const copied = gate.copyAllowed(SRC, PROTO_DIR);
  if (copied.skipped.length) console.log('  闸门外没进包：' + copied.skipped.join('、'));
  const patched = gate.patchHandPages(PROTO_DIR);
  if (patched.length) console.log('  点开就是「找不到文件」的入口已摘掉：' + patched.join('、'));

  for (const f of ['装我.bat', '更新.bat', '卸载.bat']) {
    fs.copyFileSync(path.join(INSTALLER_SRC, f), path.join(PROTO_DIR, f));
  }
  /* 说明带 BOM 的 UTF-8：Windows 记事本靠 BOM 才认中文；名字/配对号/版本留占位 */
  fs.writeFileSync(
    path.join(PROTO_DIR, '装机-看这里.txt'),
    '\uFEFF' + guideText({ name: '{{NAME}}', slug: '{{SLUG}}', code: '{{CODE}}' }, '{{VERSION}}'),
    'utf8'
  );
  const tut = path.join(ROOT, 'web', 'tutorial.html');
  if (fs.existsSync(tut)) fs.copyFileSync(tut, path.join(PROTO_DIR, '装机教程.html'));

  fixBatsToGbk(PROTO_DIR);

  const r = gate.check(PROTO_DIR);
  gate.printReport(r, PROTO_DIR);
  if (!r.ok) {
    console.error('\n❌ 母版没通过闸门，停在这里。');
    process.exit(1);
  }
  fs.writeFileSync(PROTO_META, JSON.stringify({
    version: ver, folder: PKG_NAME, files: copied.copied.length, builtAt: new Date().toISOString()
  }, null, 2));
  return copied.copied.length;
}

/* 离线发人用：拿母版复制一份 → 替占位 → 压成 zip */
function buildCustomerZip(slug, code, name, server, ver) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'executor-pack-'));
  const pkgName = PKG_NAME + '-' + slug;
  const pkg = path.join(stage, pkgName);
  fs.cpSync(PROTO_DIR, pkg, { recursive: true });

  for (const f of ['装我.bat', '更新.bat', '卸载.bat']) replaceBytesInFile(path.join(pkg, f), '__SLUG__', slug);

  const guide = path.join(pkg, '装机-看这里.txt');
  const g = fs.readFileSync(guide, 'utf8');
  fs.writeFileSync(guide, g
    .split('{{NAME}}').join(name || slug)
    .split('{{SLUG}}').join(slug)
    .split('{{CODE}}').join(code)
    .split('{{VERSION}}').join(ver), 'utf8');

  fs.writeFileSync(path.join(pkg, 'prefill.json'), JSON.stringify({
    server: String(server || 'http://8.222.157.6/').replace(/\/+$/, '') + '/',
    code, slug, name: String(name || '')
  }, null, 2));

  fs.mkdirSync(CUSTOM_DIR, { recursive: true });
  const out = path.join(CUSTOM_DIR, slug + '.zip');
  zipDir(pkg, out);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.writeFileSync(path.join(CUSTOM_DIR, slug + '.json'), JSON.stringify({
    slug, name: String(name || ''), code, version: ver,
    zip: slug + '.zip', builtAt: new Date().toISOString()
  }, null, 2));
  return out;
}

function main() {
  if (!fs.existsSync(SRC)) { console.error('找不到源目录:', SRC); process.exit(1); }

  const args = parseArgs();
  const slug = safeName(args.slug);
  const code = String(args.code || '').trim();
  const perCustomer = !!(slug && code);
  if (args.slug && !perCustomer) {
    console.error('按客户出包要同时给 --slug=客户代号 和 --code=配对号');
    process.exit(1);
  }
  const ver = String(JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8')).version || '');

  const old = snapshotOld();
  const n = buildProto(ver);

  /* 版本号跟包同时发：公网服务器读这个文件当「现在该是哪个版本」，
     执行器报上来的版本不一样就不派活（服务器上了新要求，客户机不能还拿老包跑）。 */
  fs.writeFileSync(path.join(OUT_DIR, 'executor.version'), ver + '\n');

  console.log('专属包母版已铺好：', PROTO_DIR);
  console.log('  版本号文件：web/download/executor.version ＝ ' + ver);
  console.log('  母版条目：' + n + ' 个（含 lib/ icons/ 两个目录）');
  console.log('  母版占位：三件脚本 __SLUG__、装机说明 {{NAME}}/{{SLUG}}/{{CODE}}/{{VERSION}}');
  console.log('  回滚母版：web/download/_rollback/（留最近 3 份）');
  console.log('  源码快照：' + old.srcSnap);

  if (perCustomer) {
    const out = buildCustomerZip(slug, code, String(args.name || ''), args.server, ver);
    const size = fs.statSync(out).size;
    console.log('  专属包 zip：', out);
    console.log('  客户：' + (args.name || '-') + '　代号：' + slug + '　配对号：' + code);
    console.log('  zip 里外层文件夹：' + PKG_NAME + '-' + slug + '/');
    console.log('  zip 大小：' + (size / 1024 / 1024).toFixed(2) + ' MB');
  }
}

main();
