/**
 * sync-executor.js — 把主本那套界面/手，同步进「执行器」（客户浏览器里那只手）
 *
 * 干什么：extension/ 是主本（我本机自测、网页版取源都从这里）；executor/ 是发出去的
 *        那份「只有手」的包——它会漂（改主本忘了搬过去）。跑这一条命令，就把该搬的搬齐：
 *
 *   · 界面与手：popup / video / settings / wizard / guide 几套页面、content / auto-bot /
 *     auto-water-app、ui.css / theme.js，以及 fonts / icons / lib 三个目录（lib 镜像，多的删）
 *   · 内核：extension/background.js → executor/exec-core.js（执行器启动器 importScripts 它）
 *   · 补丁：给搬过去的页面注入 hand-mode.js（客户包里非派单打开一律挡页）；
 *           popup.html 末尾补一个 work-boot.js（执行器自己的机器人引导页）
 *
 * 不动的：执行器自己的外壳文件（manifest.json / exec-boot.js / exec-shell.js / exec-workwin.js /
 *         work-boot.js / work-idle.html / panel.html / panel.js / hand-mode.js / hand-cover.js /
 *         pack.js / 补丁片段 / Edge-防禁用.bat / 装机-看这里.txt）。
 *
 * 注意：executor/ 里还留着的 settings / wizard / guide / fonts 只作本机参考，
 *       打包闸门（scripts/hand-package-gate.js）按允许清单不会把它们放进客户包。
 *
 * 用法（在项目根目录执行）：
 *   node sync-executor.js
 *
 * 每次改完主本（extension/）以后跑这一条，再打包/发版。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'extension');
const DST = path.join(ROOT, 'executor');
const STUB_DIR = path.join(ROOT, 'scripts', 'executor-stubs');

/* 要搬的单文件（extension/ → executor/，同名） */
const FILES = [
  'popup.html', 'popup.js',
  'video.html', 'video.js',
  'settings.html', 'settings.css', 'settings.js',
  'guide.html', 'guide.js',
  'wizard.html', 'wizard.js',
  'content.js', 'auto-bot.js', 'auto-water-app.js',
  'ui.css', 'theme.js', 'dropdown-ui.js',
];
/* 要搬的目录（extension/ → executor/，同名；lib 走镜像＝执行器里多出来的会被删） */
const DIRS = ['fonts', 'icons', 'lib'];
/* 搬完主本后盖成执行器专用空壳：内容（提示词/写稿/排产/品类）与本地档位判定都不进客户包。
   同名 API 留着，免得搬过来的界面/内核在初始化时找不到对象；真内容由服务器随单下发。 */
const STUBS = ['default-prompts.js', 'note-plan.js', 'note-architecture.js', 'edition.js', 'license-guard.js'];
/* 执行器不判本地档位：这份整份不要（popup 里对它的调用有 typeof 兜底） */
const GONE = ['edition-source.js'];
/* 内核改名搬运 */
const KERNEL = ['background.js', 'exec-core.js'];
/* 执行器自己的文件：一个都不许少、也不许被覆盖 */
const OWN = [
  'manifest.json', 'exec-boot.js', 'exec-shell.js', 'exec-workwin.js', 'work-boot.js',
  'work-idle.html', 'panel.html', 'panel.js', 'hand-mode.js', 'hand-cover.js', 'pack.js',
  'hand-popup-gate.snippet.js', 'hand-video-auto.snippet.js',
  'Edge-防禁用.bat', '装机-看这里.txt',
];
/* 需要挡页的页面（注入 hand-mode.js） */
const GATED = ['popup.html', 'video.html', 'settings.html', 'wizard.html', 'guide.html'];
/* 执行器外壳指望内核里还在的钩子（在就按掉"自排期"；改了名执行器会静音失效——这里拦住） */
const NEEDED_HOOKS = ['_dbEnsureTick', '_dbAutoTick', '_dbAutoKick', '_npPubBgRearm', '_npPubBgTick', '_npPubBgDeliver'];

const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
const say = (s) => console.log(s);
function die(msg) { console.error('\n❌ ' + msg + '\n'); process.exit(1); }

/* ── lib 镜像：把 SRC 树复制到 DST，并删掉 DST 里 SRC 没有的（多出来的＝改名遗留/过期件） ── */
function mirrorDir(srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true });
  const walk = (rel) => {
    const s = path.join(srcDir, rel), d = path.join(dstDir, rel);
    for (const name of fs.readdirSync(s, { withFileTypes: true })) {
      const r = path.join(rel, name.name);
      if (name.isDirectory()) { fs.mkdirSync(path.join(dstDir, r), { recursive: true }); walk(r); }
      else fs.copyFileSync(path.join(srcDir, r), path.join(dstDir, r));
    }
  };
  walk('');
  const drop = [];
  const walkDel = (rel) => {
    const d = path.join(dstDir, rel);
    for (const name of fs.readdirSync(d, { withFileTypes: true })) {
      const r = path.join(rel, name.name);
      if (name.isDirectory()) {
        if (!fs.existsSync(path.join(srcDir, r))) { fs.rmSync(path.join(d, name.name), { recursive: true, force: true }); drop.push(r); }
        else walkDel(r);
      } else if (!fs.existsSync(path.join(srcDir, r))) { fs.rmSync(path.join(d, name.name), { force: true }); drop.push(r); }
    }
  };
  walkDel('');
  return drop;
}

/* ── 页面补丁：把 hand-mode.js / hand-cover.js 塞进最前面（放在首个 <script> 前，别抢到 <meta charset> 前面） ── */
function injectGate(html) {
  let out = html;
  if (!out.includes('hand-mode.js')) {
    const m = out.search(/<script\b/i);
    const tag = '<script src="hand-mode.js"></script>\n';
    out = m >= 0 ? (out.slice(0, m) + tag + out.slice(m)) : (tag + out);
  }
  if (!out.includes('hand-cover.js')) {
    out = out.replace('<script src="hand-mode.js"></script>\n',
      '<script src="hand-mode.js"></script>\n<script src="hand-cover.js"></script>\n');
  }
  return out;
}

/* ── 手包专属补丁（主本没有，也不该有）：同步完主本再补上，别让下一次同步冲掉 ── */
function patchPopupHand(js) {
  if (js.includes('window.__XHS_HAND_BLOCKED__')) return js;
  const anchor = 'async function extPreGate() {\n';
  const i = js.indexOf(anchor);
  if (i < 0) die('popup.js 里找不到 extPreGate()，手包的前置门补不上——先对齐主本再同步');
  const snippet = fs.readFileSync(path.join(DST, 'hand-popup-gate.snippet.js'), 'utf8');
  return js.slice(0, i + anchor.length) + snippet + js.slice(i + anchor.length);
}

function patchVideoHand(js) {
  const snippet = fs.readFileSync(path.join(DST, 'hand-video-auto.snippet.js'), 'utf8').trimEnd();
  const START = '/* [[HAND-AUTO-FILM]] */';
  const END = '/* [[/HAND-AUTO-FILM]] */';
  const a = js.indexOf(START), b = js.indexOf(END);
  if (a >= 0 && b > a) return js.slice(0, a) + snippet + js.slice(b + END.length);
  /* 旧版补丁没有标记：从它的注释头切到最外层 IIFE 收尾之前，换成当前片段 */
  const old = js.indexOf('  /* ── 执行器派单出片');
  const outer = js.lastIndexOf('})();');
  if (old >= 0 && outer > old) return js.slice(0, old) + snippet + '\n\n' + js.slice(outer);
  if (js.includes('autoFilm')) return js;
  if (outer < 0) die('video.js 结尾对不上，手包的自动出片补不上——先对齐主本再同步');
  return js.slice(0, outer) + snippet + '\n\n' + js.slice(outer);
}
/* ── 客户包里没有这几份（知识库文件解析/趋势图由服务器侧接管；档位表由服务器派单时拦），
      主本页面还挂着它们的 <script>：同步时摘掉，免得包里 404 ── */
function stripSlimLibs(html) {
  return html.replace(/[ \t]*<script src="lib\/(?:kb-file|note-trend|edition-source)\.js"><\/script>\s*\r?\n?/g, '');
}
/* ── popup.html 末尾补 work-boot.js（执行器自己的：把机器人叫起来的那一页） ── */
function injectWorkBoot(html) {
  html = stripSlimLibs(html);
  if (html.includes('work-boot.js')) return html;
  const i = html.lastIndexOf('</body>');
  const tag = '<script src="work-boot.js"></script>\n';
  return i >= 0 ? (html.slice(0, i) + tag + html.slice(i)) : (html + '\n' + tag);
}

function main() {
  if (!fs.existsSync(SRC)) die('找不到主本目录：' + SRC);
  if (!fs.existsSync(DST)) die('找不到执行器目录：' + DST);

  /* 0) 前置核对：源文件齐不齐、执行器自己的文件在不在 */
  const missingSrc = [...FILES, ...DIRS, KERNEL[0]].filter((f) => !fs.existsSync(path.join(SRC, f)));
  if (missingSrc.length) die('主本里缺这些文件，先补齐再同步：\n   ' + missingSrc.join('、'));
  const missingOwn = OWN.filter((f) => !fs.existsSync(path.join(DST, f)));
  if (missingOwn.length) die('执行器里缺这些"自己的文件"（不能被覆盖的），先找回再同步：\n   ' + missingOwn.join('、'));

  /* 1) 搬单文件 */
  for (const f of FILES) {
    const d = path.join(DST, f);
    if (fs.existsSync(d) && md5(path.join(SRC, f)) === md5(d)) continue;
    fs.copyFileSync(path.join(SRC, f), d);
    say('  ↻ ' + f);
  }

  /* 2) 搬目录（lib 镜像，多出来的删） */
  for (const dir of DIRS) {
    const dropped = mirrorDir(path.join(SRC, dir), path.join(DST, dir));
    say('  ↻ ' + dir + '/（镜像）' + (dropped.length ? '  删掉过期件：' + dropped.join('、') : ''));
  }

  /* 2.5) 内容文件换成执行器空壳；本地档位表整份删掉 */
  const missingStubs = STUBS.filter((f) => !fs.existsSync(path.join(STUB_DIR, f)));
  if (missingStubs.length) die('执行器空壳缺文件：' + missingStubs.join('、') + '（在 scripts/executor-stubs/）');
  for (const f of STUBS) {
    const s = path.join(STUB_DIR, f), d = path.join(DST, 'lib', f);
    if (fs.existsSync(d) && md5(s) === md5(d)) continue;
    fs.copyFileSync(s, d);
    say('  ⤵ lib/' + f + ' → 执行器空壳（不带内容）');
  }
  for (const f of GONE) {
    const p = path.join(DST, 'lib', f);
    if (!fs.existsSync(p)) continue;
    fs.rmSync(p);
    say('  ✂ lib/' + f + '（执行器不判本地档位）');
  }

  /* 3) 内核改名搬 */
  fs.copyFileSync(path.join(SRC, KERNEL[0]), path.join(DST, KERNEL[1]));
  say('  ↻ ' + KERNEL[0] + ' → ' + KERNEL[1] + '（内核）');

  /* 4) 页面补丁 */
  for (const f of GATED) {
    const p = path.join(DST, f);
    if (!fs.existsSync(p)) die('补丁目标不存在：' + p);
    fs.writeFileSync(p, injectGate(fs.readFileSync(p, 'utf8')), 'utf8');
  }
  const popupP = path.join(DST, 'popup.html');
  fs.writeFileSync(popupP, injectWorkBoot(fs.readFileSync(popupP, 'utf8')), 'utf8');

  /* 4.5) 手包专属补丁：主本没有、也不该有；同步完主本再补上，避免下次同步冲掉 */
  const popupJsP = path.join(DST, 'popup.js');
  fs.writeFileSync(popupJsP, patchPopupHand(fs.readFileSync(popupJsP, 'utf8')), 'utf8');
  const videoJsP = path.join(DST, 'video.js');
  fs.writeFileSync(videoJsP, patchVideoHand(fs.readFileSync(videoJsP, 'utf8')), 'utf8');
  say('  ＋ 已给 ' + GATED.join(' / ') + ' 注入 hand-mode.js＋hand-cover.js 挡页；popup.html 补了 work-boot.js；');
  say('    popup.js 补了通行证前置门；video.js 补了自动出片');

  /* 5) 核对：搬过去的与主本逐字节一致（挡页补丁改过的那几页不参与逐字节比，另有"补丁在不在"的检查）；内核钩子没改名；执行器自己的文件还在 */
  const bad = [];
  const PATCHED_JS = ['popup.js', 'video.js'];
  for (const f of FILES) {
    if (GATED.includes(f) || PATCHED_JS.includes(f)) continue;
    if (md5(path.join(SRC, f)) !== md5(path.join(DST, f))) bad.push(f);
  }
  for (const [f, mark] of [['popup.js', 'window.__XHS_HAND_BLOCKED__'], ['video.js', 'autoFilm']]) {
    if (!fs.readFileSync(path.join(DST, f), 'utf8').includes(mark)) bad.push(f + '（手包补丁）');
  }
  if (md5(path.join(SRC, KERNEL[0])) !== md5(path.join(DST, KERNEL[1]))) bad.push(KERNEL[0] + '（内核）');
  if (bad.length) die('同步后对不上（这不该发生）：' + bad.join('、'));
  const core = fs.readFileSync(path.join(DST, KERNEL[1]), 'utf8');
  const lostHooks = NEEDED_HOOKS.filter((n) => !core.includes(n));
  if (lostHooks.length) die('内核里这几个钩子改名/没了，执行器的"按掉自排期"会静音失效——先对齐再同步：\n   ' + lostHooks.join('、'));
  const lostOwn = OWN.filter((f) => !fs.existsSync(path.join(DST, f)));
  if (lostOwn.length) die('执行器自己的文件被弄丢了：' + lostOwn.join('、'));
  for (const f of GATED) {
    if (!fs.readFileSync(path.join(DST, f), 'utf8').includes('hand-mode.js')) bad.push(f + '（挡页补丁）');
    let expect = injectGate(fs.readFileSync(path.join(SRC, f), 'utf8'));
    if (f === 'popup.html') expect = injectWorkBoot(expect);
    if (expect !== fs.readFileSync(path.join(DST, f), 'utf8')) bad.push(f + '（补丁结果与预期不一致）');
  }

  /* 6) 空壳核对：该空的是空壳（有标记），该没的没了，页面也不再挂它的脚本 */
  for (const f of STUBS) {
    const p = path.join(DST, 'lib', f);
    if (!fs.existsSync(p) || !fs.readFileSync(p, 'utf8').includes('[[EXECUTOR-STUB]]')) bad.push('lib/' + f + '（执行器空壳）');
  }
  for (const f of GONE) {
    if (fs.existsSync(path.join(DST, 'lib', f))) bad.push('lib/' + f + '（该删没删）');
  }
  if (fs.readFileSync(path.join(DST, 'popup.html'), 'utf8').includes('edition-source.js')) bad.push('popup.html（还挂着 edition-source.js）');
  if (bad.length) die('同步后对不上：' + bad.join('、'));

  say('\n✅ 同步完成：' + (FILES.length + DIRS.length) + ' 项界面/手 + 内核一份已与主本逐字节一致；'
    + STUBS.length + ' 份内容文件已换成执行器空壳');
  say('   下一步：node build.js <档位> 打客户包，或 node executor/pack.js 刷新网页「装执行器」那个下载包');
}

main();
