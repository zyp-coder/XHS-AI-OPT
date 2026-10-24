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
const PKG_NAME = '小红书助手-执行器';
const gate = require(path.join(ROOT, 'scripts', 'hand-package-gate.js'));

function zipDir(srcDir, zipPath) {
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath);
  const psSrc = srcDir.replace(/'/g, "''");
  const psDst = zipPath.replace(/'/g, "''");
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${psSrc}' -DestinationPath '${psDst}' -Force"`, { stdio: 'inherit' });
}

/* 把暂存目录里的 .bat 全部转成 GBK+CRLF（源文件不动；转的是打包副本）。
   PS5.1 里 [char]13+[char]10 是加法（不是字符串拼接）——必须先 [string] 转型。 */
function fixBatsToGbk(dir) {
  const ps = '$d=$env:EXEC_BAT_DIR; Get-ChildItem -Path $d -Filter *.bat | ForEach-Object { '
    + '$c=[IO.File]::ReadAllText($_.FullName,[Text.Encoding]::UTF8); '
    + '$c=$c.Replace([string][char]13+[string][char]10,[string][char]10).Replace([string][char]10,[string][char]13+[string][char]10); '
    + '[IO.File]::WriteAllText($_.FullName,$c,[Text.Encoding]::GetEncoding(936)) }';
  execSync(`powershell -NoProfile -Command "${ps}"`, { env: Object.assign({}, process.env, { EXEC_BAT_DIR: dir }), stdio: 'inherit' });
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

  const old = snapshotOld();
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'executor-pack-'));
  const pkg = path.join(stage, PKG_NAME);
  fs.mkdirSync(pkg, { recursive: true });

  /* 按允许清单铺包：产品页、字体、备份件从源头就不进来 */
  const copied = gate.copyAllowed(SRC, pkg);
  const n = copied.copied.length;
  if (copied.skipped.length) {
    console.log('  闸门外没进包：' + copied.skipped.join('、'));
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
  zipDir(pkg, OUT);   // 传整目录（不带 *）→ zip 里天然带一层「小红书助手-执行器/」
  /* 版本号跟包同时发：公网服务器读这个文件当「现在该是哪个版本」，
     执行器报上来的版本不一样就不派活（服务器上了新要求，客户机不能还拿老包跑）。 */
  const ver = String(JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8')).version || '');
  fs.writeFileSync(path.join(OUT_DIR, 'executor.version'), ver + '\n');
  fs.rmSync(stage, { recursive: true, force: true });

  const size = fs.statSync(OUT).size;
  console.log('执行器包已打出：', OUT);
  console.log('  版本号文件：web/download/executor.version ＝ ' + ver);
  console.log('  源目录条目：' + n + ' 个（含 lib/ icons/ 两个目录）');
  console.log('  zip 大小：' + (size / 1024 / 1024).toFixed(2) + ' MB');
  console.log('  zip 里外层文件夹：' + PKG_NAME + '/');
  console.log('  回滚包：web/download/_rollback/（旧 zip，留最近 3 份）');
  console.log('  源码快照：' + old.srcSnap);
}

main();
