/**
 * pack.js — 一键打包程序（可交互 / 也可命令行直传）
 *
 * 用法 A（交互式，推荐）：直接运行，按提示输入即可
 *   node pack.js
 *
 * 用法 B（命令行直传）：
 *   node pack.js --type test --xhs-id "123456789" --xhs-name "张三" --licensee "某公司" --days 7 --out dist
 *
 * 说明：
 *   --type      版本档位：trial / trial-pro / test / ent / ent-tenant / pro（默认 test·体验版全功能）
 *   --xhs-id    绑定的小红书号（必填才会绑定；留空 = 不绑定账号）
 *   --xhs-name  绑定对象的主页昵称（选填，仅用于展示）
 *   --licensee  授权对象/客户名（选填）
 *   --days      有效天数（默认 7）
 *   --out       输出目录（默认 dist）
 *
 * 依赖：Node ≥ 16.7；打 zip 用 Windows PowerShell（build.js 内部处理）。
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

const ROOT = __dirname;
const TYPES = ['full', 'comment', 'comment-multi', 'pro'];
const DEFAULT_DAYS = 7;
const LOG_FILE = path.join(ROOT, '打包日志.txt');

const pad = (n) => String(n).padStart(2, '0');
function ts() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
/** 追加一行到打包日志（同时打印到控制台，便于查问题） */
function log(l) {
  const line = `[${ts()}] ${l}`;
  try { fs.appendFileSync(LOG_FILE, line + '\r\n', 'utf8'); } catch (_) {}
  console.log(line);
}

function ask(rl, q, def) {
  return new Promise((resolve) => {
    rl.question((def != null && def !== '' ? `${q}（默认 ${def}）` : q) + '> ', (ans) => {
      const v = (ans || '').trim();
      resolve(v === '' ? def : v);
    });
  });
}

function parseArgv(argv) {
  const o = { type: 'full', xhsId: '', xhsName: '', licensee: '', days: DEFAULT_DAYS, out: 'dist', interactive: false };
  const a = argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--type') o.type = a[++i] || 'test';
    else if (k === '--xhs-id') o.xhsId = (a[++i] || '').trim();
    else if (k === '--xhs-name') o.xhsName = (a[++i] || '').trim();
    else if (k === '--licensee') o.licensee = (a[++i] || '').trim();
    else if (k === '--days') o.days = parseInt(a[++i], 10) || DEFAULT_DAYS;
    else if (k === '--out') o.out = a[++i] || 'dist';
  }
  o.interactive = !!(process.stdin.isTTY && a.indexOf('--xhs-id') === -1); // 仅终端且未直传账号才交互
  return o;
}

async function main() {
  const o = parseArgv(process.argv);

  if (o.interactive) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log('══════════════════════════════════════════');
    console.log('      小红书评论助手 · 一键打包程序');
    console.log('══════════════════════════════════════════');
    console.log('');
    const type = await ask(rl, '版本档位', o.type);
    const xhsId = (await ask(rl, '① 绑定的小红书号（留空=不绑定）')).trim();
    const licensee = (await ask(rl, '② 客户名/授权对象（选填）')).trim();
    const daysRaw = (await ask(rl, '③ 有效天数', String(o.days))).trim();
    const days = parseInt(daysRaw, 10) >= 0 ? parseInt(daysRaw, 10) : o.days;
    const out = (await ask(rl, '④ 输出目录', o.out)).trim();
    rl.close();

    o.type = type;
    o.xhsId = xhsId;
    o.xhsName = '';
    o.licensee = licensee;
    o.days = days;
    o.out = out;
    if (!TYPES.includes(o.type)) {
      console.log(`\n❌ 未知版本档位：${o.type}（可用：${TYPES.join(' / ')}）`);
      process.exit(1);
    }
    if (!xhsId) {
      console.log('\n⚠️  未填写小红书号，将打包为「不绑定账号」的版本。');
    }
  }

  const args = [
    o.type,
    '--days', String(o.days),
  ];
  if (o.xhsId) args.push('--xhs-id', o.xhsId);
  if (o.xhsName) args.push('--xhs-name', o.xhsName);
  if (o.licensee) args.push('--licensee', o.licensee);
  if (o.out && o.out !== 'dist') args.push('--out', o.out);

  console.log('\n▶ 开始打包…');
  log(`开始打包：${JSON.stringify({ type: o.type, xhsId: o.xhsId || '(不绑定)', licensee: o.licensee || '(无)', days: o.days, out: o.out || 'dist' })}`);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'build.js'), ...args], { stdio: 'inherit', cwd: ROOT });
  if (r.status === 0) { log('打包完成（OK）'); console.log('\n🎉 打包完成！可在输出目录找到 zip 压缩包。'); }
  else { log('打包失败 exit=' + r.status); console.log('\n❌ 打包失败，请看上方报错。'); }
  log('全部日志已写入：' + LOG_FILE);
  console.log('（本次运行日志已记录在：' + LOG_FILE + '）');
  process.exit(r.status || 0);
}

main();