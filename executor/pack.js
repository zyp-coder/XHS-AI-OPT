/**
 * pack.js — 执行器发行包打包脚本
 *
 * 作用：把 executor/ 目录打成「小红书助手-执行器.zip」，输出到 web/download/executor.zip——
 *       网页的「装执行器」页（/setup）直接从那里下载。
 *
 * 用法（在项目任意目录执行）：
 *   node executor/pack.js
 *
 * 注意：
 *   - 包里的 .bat 必须 GBK+CRLF（cmd 的解析要求）——打包时自动转换，源文件保持 UTF-8；
 *   - 不打包 pack.js 自己和临时目录；zip 里外层套一个「小红书助手-执行器」文件夹，
 *     客户解压出来就是一个整文件夹；
 *   - zip 用 Windows PowerShell 的 Compress-Archive（与 build.js 同一条路）。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const SRC = __dirname;
const ROOT = path.resolve(SRC, '..');
const OUT_DIR = path.join(ROOT, 'web', 'download');
const OUT = path.join(OUT_DIR, 'executor.zip');
const CUSTOM_DIR = path.join(OUT_DIR, 'customers');
const INSTALLER_SRC = path.join(ROOT, 'scripts', 'installer');
const PKG_NAME = '小红书助手-执行器';
const gate = require(path.join(ROOT, 'scripts', 'hand-package-gate.js'));

/* 按客户出包：--slug=客户代号 --code=配对号 [--name=称呼] [--server=地址]
   包内多三样：prefill.json（打开面板就填好）、三个双击脚本、这份客户专属说明。
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

function guideText(o, version) {
  return [
    '小红书助手 · 执行器  ' + (o.name ? '（' + o.name + '）' : ''),
    '================================',
    '',
    '四步装完。配对号已经填好了，不用抄。',
    '（第 1 步下载你已经做完了，从这里接着来。）',
    '',
    '第 2 步：解压这个包 → 双击「装我.bat」',
    '   它会自己把文件放到固定位置，并把文件夹路径复制好、打开扩展页。',
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
    '万一浏览器把扩展偷偷禁掉（扩展页里显示「已停用」或变灰）：',
    '   双击同一个文件夹里的「一键修复.bat」，关掉浏览器再双击，一下就修好——不用重装、不用重新登录、配对号也不会掉。',
    '',
    '这个号：' + (o.name || o.slug) + '   配对号：' + o.code,
    '版本：' + version,
    '',
    '卡住了：双击同一个文件夹里的「装机教程.html」，六种常见卡点一条条写着（带示意图）。',
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

/* 把暂存目录里的 .bat 全部转成 GBK+CRLF（源文件不动；转的是打包副本）。
   PS5.1 里 [char]13+[char]10 是加法（不是字符串拼接）——必须先 [string] 转型。 */
function fixBatsToGbk(dir) {
  const ps = '$d=$env:EXEC_BAT_DIR; Get-ChildItem -Path $d -File | Where-Object { $_.Extension -eq \'.bat\' -or $_.Extension -eq \'.vbs\' } | ForEach-Object { '
    + '$c=[IO.File]::ReadAllText($_.FullName,[Text.Encoding]::UTF8); '
    + '$c=$c.Replace([string][char]13+[string][char]10,[string][char]10).Replace([string][char]10,[string][char]13+[string][char]10); '
    + '[IO.File]::WriteAllText($_.FullName,$c,[Text.Encoding]::GetEncoding(936)) }';
  execSync(`powershell -NoProfile -Command "${ps}"`, { env: Object.assign({}, process.env, { EXEC_BAT_DIR: dir }), stdio: 'inherit' });
}

/* 通用包（网页「装执行器」那个下载）也带一个「更新.bat」：
   解压到哪都行，双击它自己找 %LOCALAPPDATA%\XhsHand\ 下已装的那一份覆盖进去，
   不靠"解压出来的文件夹名字"跟安装目录对上。 */
function genericUpdateBat() {
  return [
    '@echo off',
    'chcp 936 >nul',
    'setlocal',
    'title 小红书助手 · 执行器 更新',
    'set \"SRC=%~dp0\"',
    'if \"%SRC:~-1%\"==\"\\\" set \"SRC=%SRC:~0,-1%\"',
    'set \"BASE=%LOCALAPPDATA%\\XhsHand\"',
    '',
    'if not exist \"%BASE%\" goto notinstalled',
    '',
    'set \"N=0\"',
    'set \"DST=\"',
    'for /d %%D in (\"%BASE%\\*\") do (',
    '  if exist \"%%~fD\\manifest.json\" (',
    '    set \"N=1\"',
    '    set \"DST=%%~fD\"',
    '  )',
    ')',
    'if not defined DST goto notinstalled',
    '',
    'echo.',
    'echo   找到已装的执行器：%DST%',
    'echo   正在把这一份的文件覆盖进去...',
    'robocopy \"%SRC%\" \"%DST%\" /E /XF \"装我.bat\" \"更新.bat\" \"卸载.bat\" /NFL /NDL /NJH /NJS /NP >nul',
    'if not exist \"%DST%\\manifest.json\" goto copyfail',
    'echo.',
    'echo   文件已经换成新版了。',
    'echo.',
    'echo   最后一步：打开扩展页（edge://extensions 或 chrome://extensions），',
    'echo   找到「小红书助手 · 执行器」，点卡片上的「重新加载」。',
    'echo   绑过号的不用重扫。',
    'echo.',
    'pause',
    'exit /b 0',
    '',
    ':notinstalled',
    'echo   没找到已安装的执行器（%BASE% 下面没有）。',
    'echo   第一次装请用带「装我.bat」的那个包；装过的请先确认没换过电脑。',
    'pause',
    'exit /b 1',
    '',
    ':copyfail',
    'echo   [失败] 没覆盖成功。先把浏览器里那个执行器停掉，再双击一次。',
    'pause',
    'exit /b 1',
    '',
  ].join('\r\n');
}

/* 发版前留一份能装回去的旧包 + 一份源码，保留最近 3 份（确认单「风险与回滚」） */
function snapshotOld() {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (fs.existsSync(OUT)) {
    const rb = path.join(OUT_DIR, '_rollback');
    fs.mkdirSync(rb, { recursive: true });
    fs.copyFileSync(OUT, path.join(rb, `executor-${stamp}.zip`));
    const zips = fs.readdirSync(rb).filter((x) => /^executor-.*\.zip$/.test(x)).sort();
    for (const x of zips.slice(0, Math.max(0, zips.length - 3))) fs.rmSync(path.join(rb, x), { force: true });
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

  const pkgName = perCustomer ? PKG_NAME + '-' + safeName(slug) : PKG_NAME;
  const out = perCustomer ? path.join(CUSTOM_DIR, slug + '.zip') : OUT;
  const ver = String(JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8')).version || '');

  const old = snapshotOld();
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'executor-pack-'));
  const pkg = path.join(stage, pkgName);
  fs.mkdirSync(pkg, { recursive: true });

  /* 按允许清单铺包：产品页、字体、备份件从源头就不进来 */
  const copied = gate.copyAllowed(SRC, pkg);
  const n = copied.copied.length;
  if (copied.skipped.length) {
    console.log('  闸门外没进包：' + copied.skipped.join('、'));
  }
  const patched = gate.patchHandPages(pkg);
  if (patched.length) console.log('  点开就是「找不到文件」的入口已摘掉：' + patched.join('、'));

  if (perCustomer) {
    fs.writeFileSync(path.join(pkg, 'prefill.json'), JSON.stringify({
      server: String(args.server || 'http://8.222.157.6/').replace(/\/+$/, '') + '/',
      code,
      slug,
      name: String(args.name || '')
    }, null, 2));
    for (const f of ['装我.bat', '更新.bat', '卸载.bat']) {
      const t = fs.readFileSync(path.join(INSTALLER_SRC, f), 'utf8').replace(/__SLUG__/g, slug);
      fs.writeFileSync(path.join(pkg, f), t);
    }
    fs.writeFileSync(path.join(pkg, '装机-看这里.txt'), guideText({ slug, code, name: String(args.name || '') }, ver));
    /* 网页那份图文教程整份带进来（离线也能看；页内跳回网页的链接会自己藏掉） */
    const tut = path.join(ROOT, 'web', 'tutorial.html');
    if (fs.existsSync(tut)) fs.copyFileSync(tut, path.join(pkg, '装机教程.html'));
  } else {
    /* 通用包：三件 bat 里只带「更新.bat」——它自己找安装目录，跟解压出来的文件夹叫什么无关 */
    fs.writeFileSync(path.join(pkg, '更新.bat'), genericUpdateBat());
  }

  fixBatsToGbk(pkg);

  const r = gate.check(pkg);
  gate.printReport(r, pkg);
  if (!r.ok) {
    fs.rmSync(stage, { recursive: true, force: true });
    console.error('\n❌ 闸门没放行，没有出 zip。');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (perCustomer) fs.mkdirSync(CUSTOM_DIR, { recursive: true });
  zipDir(pkg, out);   // 传整目录（不带 *）→ zip 里天然带一层文件夹
  /* 版本号跟包同时发：公网服务器读这个文件当「现在该是哪个版本」，
     执行器报上来的版本不一样就不派活（服务器上了新要求，客户机不能还拿老包跑）。 */
  fs.writeFileSync(path.join(OUT_DIR, 'executor.version'), ver + '\n');
  fs.rmSync(stage, { recursive: true, force: true });

  if (perCustomer) {
    fs.writeFileSync(path.join(CUSTOM_DIR, slug + '.json'), JSON.stringify({
      slug, name: String(args.name || ''), code, version: ver,
      zip: slug + '.zip', builtAt: new Date().toISOString()
    }, null, 2));
  }

  const size = fs.statSync(out).size;
  console.log('执行器包已打出：', out);
  console.log('  版本号文件：web/download/executor.version ＝ ' + ver);
  console.log('  源目录条目：' + n + ' 个（含 lib/ icons/ 两个目录）');
  console.log('  zip 大小：' + (size / 1024 / 1024).toFixed(2) + ' MB');
  console.log('  zip 里外层文件夹：' + pkgName + '/');
  if (perCustomer) {
    console.log('  客户：' + (args.name || '-') + '　代号：' + slug + '　配对号：' + code);
    console.log('  装到：%LOCALAPPDATA%\\XhsHand\\' + slug + '\\（扩展身份跟这个路径走）');
  }
  console.log('  回滚包：web/download/_rollback/（旧 zip，留最近 3 份）');
  console.log('  源码快照：' + old.srcSnap);
}

main();
