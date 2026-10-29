/**
 * build.js — 执行器发行包打包脚本
 *
 * 作用：按允许清单把 executor/（执行器）铺到 dist，再打成「加载解压缩的扩展」zip。
 *       客户包里不带提示词/写稿/排产/本地档位；真内容与档位都在服务器侧。
 *
 * ★ 2026-10-16 形态收口：发货包＝执行器（只有手、没有开始按钮）。
 *   客户拿到的就是这一份；干活从网页上下单，档位在服务器侧判定。
 *
 * 用法（在项目根目录执行）：
 *   node build.js fullplat --licensee "张三公司"  # 包进门默认＝全平台（真表在服务器侧）
 *   node build.js full --licensee "李四"          # 包进门默认＝全功能（只做小红书）
 *   node build.js comment --licensee "李四"       # 包进门默认＝基础
 *   node build.js comment-multi --licensee "王五" # 包进门默认＝升级
 *   node build.js pro                            # 自用版（全功能、零等待，自用）
 *
 * 可选参数：
 *   --licensee "客户名"   写入授权对象（建议填）
 *   --days N             覆盖包里默认有效天数（如 --days 30；0 = 不过期）
 *   --xhs-id "小红书号"     旧档兼容：包级绑定（新形态一般不用，走服务器配对号认号）
 *   --xhs-name "昵称"      绑定对象的主页昵称（仅用于展示）
 *   --out 目录           输出目录（默认 dist）
 *
 * 依赖：Node ≥ 16.7（用到 fs.cpSync）；打 zip 用 Windows PowerShell 的 Compress-Archive。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'executor');
const handGate = require('./scripts/hand-package-gate.js');

// ── 版本预设 ───────────────────────────────────────────────
// ★ 2026-10-16 档位归公网那台：下面这张 features 只是包里的「进门默认」——
//   客户机挂上线后每 15 秒从服务器领那张真表（server/tier.mjs），领到过就以服务器为准。
//   这里照旧按档打，为的是「从没领到过表」（断网 / 还没配对号）时界面上不该点的别露出来；
//   要跟三档边界保持一致，改档请到公网那台的「发放管理 → 档位表」改（改完全体跟着变，不用重打包）。
// 三档边界（2026-10-09 老板定：一个模块一条线，累进开通，共有部分不动）
//   ① 基础版 = 共有 + 发笔记    ② 升级版 = ① + 获客    ③ 全功能版 = ② + 线索
//   共有（三档都有）：账号诊断&配置 / 产品库·知识库 / 多产品切换 / 整页发送
//   关键词上限：三档一律不限（keywordMax: 0 → 运行时折算成 Infinity）
const KEYWORD_MAX_UNLIMITED = 0; // 0 = 不限
const PRESETS = {
  // 自用版（内部）：永不过期、所有功能全开、零等待（noDelay）
  pro: {
    label: '自用版',
    validDays: 0,
    features: { batchSend: true, tenant: true, knowledge: true, autoWater: true, prospectList: true, notePublish: true, dailyBrowse: true, videoFilm: true, multiPlatform: true },
    keywordMax: KEYWORD_MAX_UNLIMITED, price: 0, noDelay: true,
  },

  // ── 对外销售的四档（按月收费：默认有效期 30 天，打包时可用 --days 覆盖）──
  // ④ 全平台版：③ + 抖音 / 视频号（发笔记能发这两家 + 抖音获客）；定价 699/月
  fullplat: {
    label: '全平台版',
    validDays: 30,
    price: 699,
    keywordMax: KEYWORD_MAX_UNLIMITED,
    features: { batchSend: true, tenant: true, knowledge: true, autoWater: true, prospectList: true, notePublish: true, dailyBrowse: true, videoFilm: true, multiPlatform: true },
  },
  // ③ 全功能版：② + 线索（通知 / 私信 + 获客清单 + 客服话术）；定价 539/月（只做小红书）
  full: {
    label: '全功能版',
    validDays: 30,
    price: 539,
    keywordMax: KEYWORD_MAX_UNLIMITED,
    features: { batchSend: true, tenant: true, knowledge: true, autoWater: true, prospectList: true, notePublish: true, dailyBrowse: true, videoFilm: true, multiPlatform: false },
  },
  // ① 基础版：共有 + 发笔记（AI 写笔记稿 / 素材库 / 笔记档案 / 字效编辑器）；无获客、无线索；定价 239/月
  comment: {
    label: '基础版',
    validDays: 30,
    price: 239,
    keywordMax: KEYWORD_MAX_UNLIMITED,
    features: { batchSend: true, tenant: true, knowledge: true, autoWater: false, prospectList: false, notePublish: true, dailyBrowse: false, videoFilm: true, multiPlatform: false },
  },
  // ② 升级版：① + 获客（一键灌水/笔记列表/关键词维护）；无线索；定价 399/月
  // 日常浏览随获客走（② 起开）；照旧不列入对外功能清单：物料与说明书都不写这条
  'comment-multi': {
    label: '升级版',
    validDays: 30,
    price: 399,
    keywordMax: KEYWORD_MAX_UNLIMITED,
    features: { batchSend: true, tenant: true, knowledge: true, autoWater: true, prospectList: false, notePublish: true, dailyBrowse: true, videoFilm: true, multiPlatform: false },
  },
};

// ── 解析命令行参数 ─────────────────────────────────────────
function parseArgs(argv) {
  const args = argv.slice(2);
  const type = args[0];
  const opts = { licensee: '', days: null, xhsId: '', xhsName: '', out: 'dist' };
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === '--licensee') opts.licensee = args[++i] || '';
    else if (a === '--days') opts.days = parseInt(args[++i], 10) || null;
    else if (a === '--xhs-id') opts.xhsId = (args[++i] || '').trim();
    else if (a === '--xhs-name') opts.xhsName = (args[++i] || '').trim();
    else if (a === '--out') opts.out = args[++i] || 'dist';
  }
  return { type, opts };
}

function usageAndExit(msg) {
  if (msg) console.error('\n❌ ' + msg);
  console.error('\n用法: node build.js <fullplat|full|comment|comment-multi|pro> [--licensee "客户名"] [--days N] [--xhs-id "小红书号"] [--xhs-name "昵称"] [--out 目录]\n');
  process.exit(1);
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── 打包记录（dist/打包记录.json 可编辑 + 自动生成可读表格 html） ──
function appendBuildRecord(outDir, cfg, stageName, zipPath, stageDir) {
  const recPath = path.join(outDir, '打包记录.json');
  let list = [];
  if (fs.existsSync(recPath)) {
    try { list = JSON.parse(fs.readFileSync(recPath, 'utf8')) || []; } catch (_) { list = []; }
    if (!Array.isArray(list)) list = [];
  }
  const now = new Date();
  list.push({
    at: now.toISOString(),
    time: now.toLocaleString('zh-CN'),
    xhsId: cfg.boundAccount.xhsId || '',
    xhsName: cfg.boundAccount.name || '',
    licensee: cfg.licensee || '',
    type: cfg.type,
    label: cfg.label,
    validDays: cfg.validDays,
    expireAt: cfg.expireAt ? new Date(cfg.expireAt).toLocaleString('zh-CN') : '永不过期',
    zip: zipPath,
    dir: stageDir,
  });
  fs.writeFileSync(recPath, JSON.stringify(list, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, '打包记录.html'), buildRecordHtml(list), 'utf8');
}

function buildRecordHtml(list) {
  const rows = list.slice().reverse().map((r, i) => `<tr>
    <td>${list.length - i}</td>
    <td>${escHtml(r.time)}</td>
    <td>${escHtml(r.xhsId || '-')}</td>
    <td>${escHtml(r.xhsName || '-')}</td>
    <td>${escHtml(r.licensee || '-')}</td>
    <td>${escHtml(r.label)}</td>
    <td>${escHtml(String(r.validDays > 0 ? r.validDays + ' 天' : '永久'))}</td>
    <td>${escHtml(r.expireAt)}</td>
    <td style="font-size:11px;word-break:break-all">${escHtml(r.zip)}</td>
  </tr>`).join('\n');
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>打包记录</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font:14px/1.7 "Microsoft YaHei",sans-serif;background:#f5f6f8;padding:20px}
  .page{max-width:1000px;margin:0 auto;background:#fff;border-radius:12px;padding:24px 28px;box-shadow:0 2px 10px rgba(0,0,0,.06)}
  h1{font-size:20px;margin-bottom:4px}
  .tip{color:#999;font-size:12.5px;margin-bottom:16px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{border:1px solid #e7e7e7;padding:8px 10px;text-align:left}
  th{background:#f6f7f9}
  tr:nth-child(even){background:#fafbfc}
</style></head><body><div class="page">
  <h1>📦 打包记录</h1>
  <div class="tip">如需修改，请直接编辑同目录下的 <b>打包记录.json</b>（最新一行 = 最近一次打包）。</div>
  <table>
    <tr><th>#</th><th>打包时间</th><th>小红书号</th><th>昵称</th><th>授权对象</th><th>版本</th><th>有效期</th><th>到期</th><th>ZIP 路径</th></tr>
    ${rows}
  </table>
</div></body></html>`;
}

// ── 执行器装机说明（生成 txt + html 双份） ─────────────────
// 2026-10-16 收口：发货包＝执行器——三步＝解压 → 浏览器加载 → 填配对号挂线；
// 不再提 DeepSeek Key / 首次设置向导（那些在网页上，干活由服务器派单）。
// 本版本功能清单：按 preset 开关生成（对外用词避开禁用词表；表述从简，一行一项）
// 三档边界（2026-10-09 老板定）：① 基础版＝共有+发笔记 ② 升级版＝①+获客 ③ 全功能版＝②+线索
function featureLines(cfg) {
  const f = cfg.features || {};
  const out = [];
  out.push('账号诊断（整改建议 + 选题规划）');
  out.push('评论助手（AI 帮你写评论、回评论）');
  if (f.batchSend) out.push('整页发送（多条评论一次发完）');
  const basics = ['产品库'];
  if (f.knowledge) basics.push('知识库');
  if (f.tenant) basics.push('多产品切换');
  out.push(basics.join(' · '));
  if (f.autoWater) out.push('获客（一键灌水 + 笔记列表；关键词维护：自动找词、搜笔记 · 关键词不限量）');
  if (f.prospectList) out.push('线索（通知 / 私信 + 获客清单）');
  if (f.notePublish) out.push('发笔记（AI 写笔记稿 + 素材库 / 笔记档案' + (f.videoFilm ? '；字效编辑器：口播稿配成竖版视频，带配音' : '') + '）');
  if (f.multiPlatform) out.push('抖音 / 视频号（发笔记能发这两家 + 抖音获客）');
  // 日常浏览：随获客 ② 起开通，但按老板口径不列入对外功能清单（物料/说明书都不写），故这里有意不生成条目
  return out;
}

function writeStepsManual(stageDir, cfg) {
  const lc = cfg.licensee || '通用';
  const feats = featureLines(cfg);
  const featsTxt = feats.map((x, i) => '  ' + (i + 1) + ') ' + x).join('\n');
  const featsHtml = feats.map((x) => '<li>' + escHtml(x) + '</li>').join('');
  // 带出片的档位：配音走微软给 Edge 的免费通道——整份说明都指到 Edge（Chrome 一样能装，只是配音不出声）
  const useEdge = !!(cfg.features && cfg.features.videoFilm);
  const brName = useEdge ? 'Edge' : 'Chrome';
  const brUrl = useEdge ? 'edge://extensions' : 'chrome://extensions';
  const edgeTip = useEdge
    ? '  ※ 建议用 Edge：里面的配音走微软给 Edge 的免费通道，换别的浏览器念不出声（Chrome 一样能装）。\n'
    : '';
  const edgeTipHtml = useEdge
    ? '<li style="color:#888">※ 建议用 Edge：里面的配音走微软给 Edge 的免费通道，换别的浏览器念不出声（Chrome 一样能装）。</li>'
    : '';

  const txt = `================================================
   小红书助手 · 执行器  使用说明
================================================
授权：${lc}
它是一只装在你浏览器里的「手」：网页上点的活，在你这台电脑上真跑。
※ 干活都在网页上点——它自己不带开始按钮。
※ 功能与有效期以网页上你账号的显示为准。

────────────────────────────────────────
按你买的档位，能用这些：
${featsTxt}

装它只要 3 步：

【第①步】解压到一个固定文件夹
  1) 把「小红书助手-执行器.zip」解压到比如 D:\\小红书助手-执行器\\
  2) 解压完应能看到 manifest.json、panel.html、「装机-看这里.txt」
  ※ 以后别挪这个文件夹——挪了浏览器就找不到，要重新加载一次

【第②步】在浏览器里加载（一次性）
  1) 打开 ${brName}，地址栏输入 ${brUrl} 回车
  2) 打开右上角「开发者模式」
  3) 点「加载解压缩的扩展」→ 选中第①步那个文件夹
  4) 工具栏出现「小红书助手 · 执行器」图标即可（建议点 📌 固定）
${edgeTip}
【第③步】填配对号，挂上
  1) 点插件图标 → 服务器地址已经填好，不用动
  2) 填你的配对号（在网页右上角、你账号那一行，点一下能复制，XHD- 开头）
  3) 点「🔗 挂上」→ 变成 🟢 在线待命＝挂上了
  4) 之后在网页上点「发 / 开始」，这只手就去干活；网页右下角能看到它的状态
  不用填任何 AI Key：写稿、出图、出片都在网页上，这边只是手。
  别关浏览器——关了不干活（服务器上的单会排队，回来接着干）。
  重启电脑不用管：装的时候已经设好「开机自启」，重启后它会自己把浏览器打开、自己挂上。
  扩展显示「已停用」或变灰：双击包里的「一键修复.bat」，把浏览器关掉再双击一次就好。

（提示：请按真人节奏使用，因操作过猛导致的账号风险需自行承担）
================================================
技术支持 / 续期：____________________
`;

  const h = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>小红书助手 · 执行器 · 使用说明</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font:14px/1.9 "Microsoft YaHei","PingFang SC",sans-serif;background:#f5f6f8;padding:20px;color:#222}
  .page{max-width:760px;margin:0 auto;background:#fff;border-radius:12px;padding:30px 36px;box-shadow:0 2px 10px rgba(0,0,0,.06)}
  h1{font-size:22px;text-align:center;margin-bottom:6px}
  .sub{text-align:center;color:#7a7a7a;font-size:12.5px;margin-bottom:8px}
  .auth{text-align:center;font-size:13px;color:#555;background:#f6f7f9;border-radius:8px;padding:8px 12px;margin-bottom:22px}
  .step{background:#fafbfc;border:1px solid #eaecef;border-radius:12px;padding:16px 18px;margin-bottom:16px}
  .step h2{font-size:17px;margin-bottom:8px;padding-left:10px;border-left:4px solid #ff274b}
  .step ol{margin:0;padding-left:22px}
  .step li{font-size:13.5px;margin:6px 0}
  code{background:#eef1f5;border-radius:4px;padding:1px 5px;font-size:12.5px;color:#c00036}
  .tip{background:#fff4e8;border:1px solid #ffd9b3;border-radius:8px;padding:9px 12px;font-size:12.5px;color:#7a4a1f;margin-top:18px}
  .foot{text-align:center;color:#999;font-size:12px;margin-top:20px;border-top:1px dashed #ddd;padding-top:12px}
</style></head><body><div class="page">
  <h1>小红书助手 · 执行器</h1>
  <div class="sub">使用说明 · 只要 3 步就会用</div>
  <div class="auth">授权：${escHtml(lc)}　｜　干活都在网页上点，它自己不带开始按钮</div>

  <div class="step">
    <h2>按你买的档位，能用这些</h2>
    <ol>${featsHtml}</ol>
    <div style="color:#888;font-size:12.5px;margin-top:6px">※ 功能与有效期以网页上你账号的显示为准。</div>
  </div>

  <div class="step">
    <h2>① 解压到一个固定文件夹</h2>
    <ol>
      <li>把「小红书助手-执行器.zip」解压到比如 <code>D:\\小红书助手-执行器\\</code>。</li>
      <li>解压完应能看到 <code>manifest.json</code>、<code>panel.html</code>、「装机-看这里.txt」。</li>
      <li style="color:#888">※ 以后别挪这个文件夹——挪了浏览器就找不到，要重新加载一次。</li>
    </ol>
  </div>

  <div class="step">
    <h2>② 在浏览器里加载（一次性）</h2>
    <ol>
      <li>打开 ${brName}，地址栏输入 <code>${brUrl}</code> 回车。</li>
      <li>打开右上角「开发者模式」。</li>
      <li>点「加载解压缩的扩展」→ 选中第①步那个文件夹（Chrome 叫「加载已解压的扩展程序」）。</li>
      <li>工具栏出现「小红书助手 · 执行器」图标即可（建议点 📌 固定）。</li>
      ${edgeTipHtml}
    </ol>
  </div>

  <div class="step">
    <h2>③ 填配对号，挂上</h2>
    <ol>
      <li>点插件图标 → 服务器地址已经填好，不用动。</li>
      <li>填你的配对号（在网页右上角、你账号那一行，点一下能复制，XHD- 开头）。</li>
      <li>点「🔗 挂上」→ 变成 🟢 在线待命＝挂上了。</li>
      <li>之后在网页上点「发 / 开始」，这只手就去干活；网页右下角能看到它的状态。</li>
      <li style="color:#888">※ 不用填任何 AI Key：写稿、出图、出片都在网页上，这边只是手。</li>
      <li style="color:#888">※ 别关浏览器——关了不干活（服务器上的单会排队，回来接着干）。</li>
      <li style="color:#888">※ 重启电脑不用管：装的时候已经设好「开机自启」，重启后它会自己打开浏览器、自己挂上。</li>
    </ol>
  </div>

  <div class="tip">🔧 扩展显示「已停用」或变灰？把浏览器完全关掉，双击包里的「一键修复.bat」——不用重装、不用重新登录，配对号也不会掉。</div>
  <div class="tip">⚠️ 请按真人节奏使用；因操作过猛导致的账号风险需自行承担。</div>
  <div class="foot">技术支持 / 续期：＿＿＿＿＿＿＿＿</div>
</div></body></html>
`;

  fs.writeFileSync(path.join(stageDir, '使用说明.txt'), txt, 'utf8');
  fs.writeFileSync(path.join(stageDir, '使用说明.html'), h, 'utf8');
}

// ── 打 zip（Windows PowerShell Compress-Archive） ─────────
function zipDir(srcDir, zipPath) {
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath);
  const psSrc = path.join(srcDir, '*').replace(/'/g, "''");
  const psDst = zipPath.replace(/'/g, "''");
  const cmd = `powershell -NoProfile -Command "Compress-Archive -Path '${psSrc}' -DestinationPath '${psDst}' -Force"`;
  execSync(cmd, { stdio: 'inherit' });
}

/* 包里的 .bat 必须 GBK+CRLF（cmd 的解析要求）——转的是暂存副本，源文件保持 UTF-8。
   PS5.1 里 [char]13+[char]10 是加法（不是字符串拼接）——必须先 [string] 转型。 */
function fixBatsToGbk(dir) {
  const ps = '$d=$env:BUILD_BAT_DIR; Get-ChildItem -Path $d -File | Where-Object { $_.Extension -eq \'.bat\' -or $_.Extension -eq \'.vbs\' } | ForEach-Object { '
    + '$c=[IO.File]::ReadAllText($_.FullName,[Text.Encoding]::UTF8); '
    + '$c=$c.Replace([string][char]13+[string][char]10,[string][char]10).Replace([string][char]10,[string][char]13+[string][char]10); '
    + '[IO.File]::WriteAllText($_.FullName,$c,[Text.Encoding]::GetEncoding(936)) }';
  execSync(`powershell -NoProfile -Command "${ps}"`, { env: Object.assign({}, process.env, { BUILD_BAT_DIR: dir }), stdio: 'inherit' });
}

// ── 主流程 ─────────────────────────────────────────────────
/* 共用文件核对：这几份是三处界面/后台逐字节共用的，谁漂了就中止打包
   （漂了会出现「网页上锁了、执行器没锁」这类对不上的怪事，比打包失败更难查） */
function assertSharedFiles() {
  const crypto = require('crypto');
  const md5 = (p) => (fs.existsSync(p) ? crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex') : '(不在)');
  const groups = [
    ['lib/edition-source.js（按表锁格那半）', 'lib/edition-source.js', ['extension', 'web']],
    ['lib/edition.js（档位表进门默认）', 'lib/edition.js', ['extension', 'web', 'server/bg']],
  ];
  const bad = [];
  for (const [title, file, dirs] of groups) {
    const seen = {};
    dirs.forEach((d) => { const h = md5(path.join(ROOT, d, file)); (seen[h] = seen[h] || []).push(d); });
    const hs = Object.keys(seen);
    if (hs.includes('(不在)')) bad.push(title + '：这几处缺文件 → ' + seen['(不在)'].join('、'));
    else if (hs.length > 1) bad.push(title + '：' + hs.map((h) => seen[h].join('/') + '＝' + h.slice(0, 8)).join('、'));
  }
  if (bad.length) {
    console.error('\n❌ 共用文件对不上，先对齐再打包（不然三处界面读的是不同版本）：');
    bad.forEach((b) => console.error('   · ' + b));
    console.error('   对齐办法：拿 extension 那份盖过去，例如 cp extension/lib/edition.js web/lib/（executor 是空壳，不参与）\n');
    process.exit(1);
  }
}

/* 发货包底线（换手第 6 条）：允许清单 + 脏文件 + 提示词特征，三关一起过。
   闸门本体在 scripts/hand-package-gate.js，pack.js 走同一份，避免两边口径漂。 */
function assertHandGate(stageDir) {
  const gate = require('./scripts/hand-package-gate.js');
  const r = gate.check(stageDir);
  gate.printReport(r, stageDir);
  if (!r.ok) {
    console.error('\n❌ 发货包没过闸门，已中止。先在 executor/ 里把多出来的件清掉：node sync-executor.js\n');
    process.exit(1);
  }
}

function main() {
  const { type, opts } = parseArgs(process.argv);
  if (!type || !PRESETS[type]) {
    usageAndExit(type ? `未知版本类型: ${type}` : '缺少版本类型');
  }
  if (!fs.existsSync(SRC)) usageAndExit(`找不到源目录: ${SRC}`);
  assertSharedFiles();

  const preset = PRESETS[type];
  const validDays = opts.days != null ? opts.days : preset.validDays;
  const builtAt = Date.now();
  const expireAt = validDays > 0 ? builtAt + validDays * 86400000 : 0;

  const cfg = {
    type,
    label: preset.label,
    licensee: opts.licensee,
    builtAt,
    expireAt,
    validDays,
    keywordMax: Number(preset.keywordMax) || 0, // 0＝不限量（别用 || 兜 8，0 是有效值）
    price: preset.price || 0,
    noDelay: !!preset.noDelay,
    boundAccount: { xhsId: (opts.xhsId || '').trim(), name: (opts.xhsName || '').trim() },
    features: preset.features,
  };
  if (cfg.boundAccount.xhsId) {
    cfg.boundAccount.xhsId = String(cfg.boundAccount.xhsId);
  }

  const outDir = path.isAbsolute(opts.out) ? opts.out : path.join(ROOT, opts.out);
  fs.mkdirSync(outDir, { recursive: true });

  const safeLicensee = (opts.licensee || '').replace(/[\\/:*?"<>|\s]+/g, '_');
  // 发货包＝执行器：名字随包走、不带档位（档位在服务器侧，写进名字会过期误导）
  const pkgName = safeLicensee ? `小红书助手-执行器·${safeLicensee}` : '小红书助手-执行器';

  // ★ 按「打包日期_发放对象」分目录：dist/日期_发放_张三/ 里放 zip、执行器文件夹、使用说明
  const pad2 = (n) => String(n).padStart(2, '0');
  const _d = new Date();
  const dateStr = `${_d.getFullYear()}-${pad2(_d.getMonth() + 1)}-${pad2(_d.getDate())}`;
  const dirUser = cfg.boundAccount.name || opts.licensee || '未知名';
  const safeUser = dirUser.replace(/[\\/:*?"<>|\s]+/g, '_');
  const dirToken = cfg.boundAccount.xhsId
    ? `${dateStr}_${safeUser}_${cfg.boundAccount.xhsId}`
    : (opts.licensee ? `${dateStr}_发放_${safeUser}` : `${dateStr}_无绑定`);
  const pkgDir = path.join(outDir, dirToken);
  fs.mkdirSync(pkgDir, { recursive: true });
  const stageDir = path.join(pkgDir, pkgName);
  if (fs.existsSync(stageDir)) fs.rmSync(stageDir, { recursive: true, force: true });

  // 1) 按允许清单铺包（产品页 / 字体 / 备份件 / 开发件从源头就不进暂存区）
  const staged = handGate.copyAllowed(SRC, stageDir);
  if (staged.skipped.length) console.log('  闸门外没进包：' + staged.skipped.join('、'));
  const patched = handGate.patchHandPages(stageDir);
  if (patched.length) console.log('  点开就是「找不到文件」的入口已摘掉：' + patched.join('、'));
  fixBatsToGbk(stageDir);

  // 2) 档位不再写进包：executor/lib/edition.js 是空壳，真表在服务器派单时拦

  // 3) 读 manifest（名字随包走，不改——档位在服务器侧，写进名字会过期误导）
  const manifest = JSON.parse(fs.readFileSync(path.join(stageDir, 'manifest.json'), 'utf8'));

  // 3.5) 写入执行器装机说明（txt + html 双份）
  writeStepsManual(stageDir, cfg);

  // 3.6) 打包闸门：允许清单 + 脏文件 + 提示词特征（说明文件写完再查，免得漏扫）
  assertHandGate(stageDir);

  // 4) 打 zip
  const zipPath = path.join(pkgDir, pkgName + '.zip');
  zipDir(stageDir, zipPath);

  // 4.5) 使用说明也放一份到 <发放目录> 根，方便先看再装
  ['使用说明.txt', '使用说明.html'].forEach(f => {
    const s = path.join(stageDir, f);
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(pkgDir, f));
  });

  // 4.6) 追加打包记录（dist/打包记录.json 可编辑；自动生成可读表格 html）
  appendBuildRecord(outDir, cfg, pkgName, zipPath, stageDir);

  console.log('\n✅ 打包完成（发货包＝执行器：只有手；干活从网页下单）');
  console.log('   版本类型 :', type, '(' + preset.label + '·进门默认；真表在公网那台)');
  console.log('   授权对象 :', opts.licensee || '(无)');
  if (cfg.boundAccount.xhsId) console.log('   绑定账号 :', `${cfg.boundAccount.xhsId}${cfg.boundAccount.name ? '（' + cfg.boundAccount.name + '）' : ''}`);
  console.log('   定价     :', cfg.price > 0 ? ('¥' + cfg.price + ' / 月') : '(自用/试用不标价)');
  console.log('   灌水关键词上限 :', cfg.keywordMax >= 1 ? (cfg.keywordMax + ' 个') : '不限量');
  console.log('   有效天数 :', (validDays > 0 ? validDays + ' 天' : '永久'), '（进门默认；客户挂上线后到期由服务器判）');
  console.log('   到期时间 :', expireAt ? new Date(expireAt).toLocaleString('zh-CN') : '永不过期');
  console.log('   功能开关 :', JSON.stringify(preset.features), '（包里这张＝进门默认；真表在公网那台）');
  console.log('   扩展名称 :', manifest.name);
  console.log('   解压目录 :', stageDir);
  console.log('   使用说明 :', path.join(stageDir, '使用说明.txt'));
  console.log('   ZIP 包   :', zipPath);
  console.log('   打包记录 :', path.join(outDir, '打包记录.json'));
}

main();
