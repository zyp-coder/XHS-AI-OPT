/**
 * hand-package-gate.js — 执行器发货包闸门（换手第 6 条）
 *
 * 一道门管三件事：
 *   ① 允许清单：包里只许有「手」要用的文件；多一个不认识的顶层文件就中止。
 *   ② 脏文件扫描：备份件 / 日志 / 密钥 / 开发机绝对路径 / zip 之类一律不许进包。
 *   ③ 提示词特征扫描：从主本默认提示词里取特征句，出现在不该出现的文件里就中止。
 *
 * 用法：
 *   node scripts/hand-package-gate.js executor          # 查源目录
 *   node scripts/hand-package-gate.js dist/xxx/包名    # 查打好的暂存目录
 *   const gate = require('./scripts/hand-package-gate.js'); gate.check(dir)
 *
 * 说明：提示词/写稿/排产/档位这五份在客户包里只许是空壳（带 [[EXECUTOR-STUB]] 标记），
 * 真内容由服务器随单下发；本地档位表 edition-source.js 整份不许进包。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

/* ── ① 允许清单（顶层）── */
const ALLOW_FILES = new Set([
  'manifest.json',
  'exec-boot.js', 'exec-core.js', 'exec-shell.js', 'exec-workwin.js', 'exec-acct-check.js',
  'exec-douyin.js',          // 抖音获客（搜词/捞作品/读评论）：只看看记记，不评论不私信
  'work-boot.js', 'work-idle.html',
  'hand-mode.js', 'hand-cover.js',
  'boot-pack.js',            // 首屏分包装载器（扩展页禁内联脚本，从 popup.html 里拎出来的）
  'popup.html', 'popup.js',
  'video.html', 'video.js',
  'content.js', 'auto-bot.js', 'auto-water-app.js', 'dropdown-ui.js',
  'ui.css', 'theme.js',
  'panel.html', 'panel.js',
  'Edge-防禁用.bat', '装机-看这里.txt',
  'repair.ps1', 'repair.bat', '一键修复.bat', 'boot-start.vbs',   // 自检修复＋开机自启（2026-10-29）
  '装机教程.html',                     // 与网页同一份图文教程（离线也能看）
  '装我.bat', '更新.bat', '卸载.bat',   // 按客户出包时带的三个双击脚本（通用包里没有）
  'prefill.json',                      // 按客户出包时带的预填（服务器地址＋配对号）
  '使用说明.txt', '使用说明.html',   // build.js 打给客户的那两份
]);
const ALLOW_DIRS = new Set(['icons', 'lib']);

/* 包里绝不能出现的顶层件（就算以后有人手滑加进允许清单，也先在这里拦） */
const FORBID_TOP = [
  [/^settings\.(html|js|css)$/i, '设置页（产品界面）'],
  [/^wizard\./i, '首次向导页'],
  [/^guide\./i, '新手引导页'],
  [/^fonts$/i, '字体目录（改成第一次出片按需下载）'],
  [/\.bak|\.backup$|\.old$/i, '备份件'],
  [/\.(log|tmp|crx|zip|pem|key|p12|pfx)$/i, '日志/临时/证书/压缩件'],
  [/^\./i, '隐藏文件'],
  [/^(node_modules|__pycache__)$/i, '依赖/缓存目录'],
  [/^install-config\.json$/i, '旧装机预填（含客户信息）'],
];

/* 这五份在客户包里必须是「空壳」：只留同名 API，不带提示词/写稿/排产/档位内容。
   真内容由服务器随单下发（提示词走 /api/exec/prompts，其余随命令带）。 */
const STUB_LIBS = new Map([
  ['lib/default-prompts.js', '提示词库'],
  ['lib/note-plan.js', '写稿/排产规则'],
  ['lib/note-architecture.js', '写稿结构'],
  ['lib/edition.js', '本地档位表'],
  ['lib/license-guard.js', '本地授权守卫'],
]);

/* 允许出现的 lib（明确列名；新加文件必须来这里登记） */
const ALLOW_LIB = new Set([
  'account-guard.js', 'ai-client.js', 'ai-providers.js', 'asset-kinds.js',
  'auto-water.js', 'crypto-box.js', 'daily-browse.js', 'data-privacy.js',
  'default-prompts.js', 'delay-presets.js', 'edition.js',
  'icons.js', 'knowledge-search.js', 'license-guard.js', 'note-architecture.js',
  'note-plan.js', 'note-tags.js', 'note-trend.js', 'kb-file.js', 'platforms.js', 'prompt-renderer.js',
  /* 首屏分包装载器按需补下载的两页（boot-pack.js 的 diag / state 两包）：
     漏进白名单＝客户包里没有这两份，点开诊断/线索页会 404 */
  'pg-diag.js', 'pg-state.js',
  'pub-adapt.js', 'pub-shadow-hook.js', 'scenario-drain.js', 'storage.js',
  'tenant.js', 'utils.js', 'visual-motif.js',
]);

/* ── ② 脏文件内容特征 ── */
const DIRTY_CONTENT = [
  [/sk-[A-Za-z0-9]{20,}/, '疑似模型 API Key（sk-…）'],
  [/(api[_-]?key|secret|password)\s*[:=]\s*['"](?!executor-via-server)[^'"\s]{24,}['"]/i, '疑似写死的密钥/口令'],
  [/[A-Z]:[\\/](?:Users|AIproject)[\\/][^\s'"<>]+/i, '开发机绝对路径'],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, '私钥'],
];

/* ── ③ 提示词特征：从主本提示词库里抽 30 字以上的中文/英文字句 ── */
function promptSignatures() {
  const p = path.join(ROOT, 'extension', 'lib', 'default-prompts.js');
  if (!fs.existsSync(p)) return [];
  const src = fs.readFileSync(p, 'utf8');
  const out = new Set();
  for (const m of src.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.){36,140})\1/g)) {
    const s = m[2].replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
    if (s.length < 36) continue;
    if (!/[\u4e00-\u9fa5]{8,}/.test(s)) continue;      // 只取有中文的整句，避免把代码/路径当特征
    out.add(s.slice(0, 60));
    if (out.size >= 240) break;
  }
  return [...out];
}

const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.html', '.htm', '.css', '.json', '.txt', '.md', '.bat', '.sh', '.yml', '.yaml']);

function walk(dir, rel, bag) {
  for (const ent of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = path.join(rel, ent.name);
    if (ent.isDirectory()) { bag.dirs.push(r); walk(dir, r, bag); }
    else bag.files.push(r);
  }
}

function check(dir) {
  const errors = [];
  const warnings = [];
  const defers = [];
  const stats = { files: 0, bytes: 0, largest: [] };

  if (!fs.existsSync(dir)) return { ok: false, errors: ['目录不存在：' + dir], warnings, defers, stats };

  /* 顶层允许清单 + 禁用件 */
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = ent.name;
    for (const [re, why] of FORBID_TOP) {
      if (re.test(name)) errors.push(`包里不许有「${name}」：${why}`);
    }
    if (ent.isDirectory()) {
      if (!ALLOW_DIRS.has(name)) errors.push(`多了一个目录「${name}/」——不在允许清单里`);
    } else if (!ALLOW_FILES.has(name)) {
      errors.push(`多了一个文件「${name}」——不在允许清单里`);
    }
  }

  /* lib 允许清单 */
  const libDir = path.join(dir, 'lib');
  if (fs.existsSync(libDir)) {
    for (const ent of fs.readdirSync(libDir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (ent.name !== 'video') errors.push(`lib/ 下多了目录「${ent.name}/」——不在允许清单里`);
        continue;
      }
      if (!ALLOW_LIB.has(ent.name)) errors.push(`lib/${ent.name} 不在允许清单里`);
    }
  }

  /* 必需件 + 挡页补丁 */
  const NEED = [
    'manifest.json', 'exec-boot.js', 'exec-core.js', 'exec-shell.js', 'exec-workwin.js',
    'exec-douyin.js',
    'work-idle.html', 'hand-mode.js', 'hand-cover.js', 'popup.html', 'video.html',
    'panel.html', 'icons', 'lib',
    'repair.ps1', 'repair.bat', '一键修复.bat', 'boot-start.vbs',
  ];
  for (const n of NEED) if (!fs.existsSync(path.join(dir, n))) errors.push(`缺必需件：${n}`);

  /* 内容文件必须是空壳；本地档位表（edition-source.js）整份不许进包 */
  for (const [key, what] of STUB_LIBS) {
    const p = path.join(dir, key);
    if (!fs.existsSync(p)) { errors.push(`缺必需件：${key}（${what}空壳）`); continue; }
    if (!fs.readFileSync(p, 'utf8').includes('[[EXECUTOR-STUB]]')) {
      errors.push(`${key} 不是执行器空壳（${what}内容被带进包了）`);
    }
  }
  if (fs.existsSync(path.join(dir, 'lib', 'edition-source.js'))) {
    errors.push('lib/edition-source.js 不在允许清单里（本地档位表整份不许进包）');
  }

  for (const page of ['popup.html', 'video.html']) {
    const p = path.join(dir, page);
    if (!fs.existsSync(p)) continue;
    const h = fs.readFileSync(p, 'utf8');
    if (!h.includes('hand-mode.js')) errors.push(page + ' 没挂 hand-mode.js（手工打开会直接进产品界面）');
    if (page === 'popup.html' && !h.includes('work-boot.js')) errors.push('popup.html 没挂 work-boot.js（执行器起不来机器人）');
  }

  /* 页面里指向本地文件的引用必须真的在包里——否则客户一点就是「找不到文件」 */
  for (const page of ['popup.html', 'video.html', 'panel.html', 'work-idle.html']) {
    const p = path.join(dir, page);
    if (!fs.existsSync(p)) continue;
    for (const m of fs.readFileSync(p, 'utf8').matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
      const ref = m[1].trim();
      if (!ref || ref.startsWith('#') || /^(https?:|data:|mailto:|javascript:|\/\/)/i.test(ref)) continue;
      const rel = ref.split(/[?#]/)[0].replace(/^\.\//, '');
      if (!rel) continue;
      if (!fs.existsSync(path.join(dir, rel))) errors.push(`${page} 指向包外的「${ref}」——客户点了就是「找不到文件」`);
    }
  }

  /* 内核必须是主本的逐字节副本 */
  try {
    const a = fs.readFileSync(path.join(ROOT, 'extension', 'background.js'));
    const b = fs.readFileSync(path.join(dir, 'exec-core.js'));
    if (crypto.createHash('sha256').update(a).digest('hex') !== crypto.createHash('sha256').update(b).digest('hex')) {
      errors.push('exec-core.js 和主本 extension/background.js 对不上（内核被单独改过？）');
    }
  } catch (e) {
    errors.push('核对内核失败：' + (e && e.message || e));
  }

  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch (e) {
    errors.push('manifest.json 读不出来：' + (e && e.message || e));
  }
  if (manifest && manifest.background && manifest.background.service_worker !== 'exec-boot.js') {
    errors.push('manifest 的后台入口不是 exec-boot.js（打错源了？）');
  }

  /* 全树扫描 */
  const bag = { files: [], dirs: [] };
  walk(dir, '', bag);
  const sigs = promptSignatures();

  for (const rel of bag.files) {
    const p = path.join(dir, rel);
    const st = fs.statSync(p);
    stats.files++;
    stats.bytes += st.size;
    stats.largest.push({ rel, size: st.size });

    const base = path.basename(rel);
    for (const [re, why] of FORBID_TOP) if (re.test(base)) errors.push(`${rel}：${why}`);

    const ext = path.extname(rel).toLowerCase();
    if (!TEXT_EXT.has(ext)) {
      if (ext === '.woff2' || ext === '.woff' || ext === '.ttf') errors.push(`${rel}：字体不该随包发（第一次出片按需下载）`);
      continue;
    }
    if (st.size > 4 * 1024 * 1024) {
      warnings.push(`${rel} 超过 4MB（${(st.size / 1048576).toFixed(1)}MB），确认它真是手要用的`);
    }
    let txt = '';
    try { txt = fs.readFileSync(p, 'utf8'); } catch (_) { continue; }

    for (const [re, why] of DIRTY_CONTENT) {
      if (re.test(txt)) errors.push(`${rel}：${why}`);
    }
    if (/[\u0000-\u0008\u000e-\u001f]/.test(txt.slice(0, 20000))) errors.push(`${rel}：像二进制/乱码，不该进包`);

    for (const s of sigs) {
      if (txt.includes(s)) {
        errors.push(`${rel}：出现默认提示词特征句「${s.slice(0, 24)}…」——提示词不许带进手包`);
        break;
      }
    }
  }

  /* 去重 + 体积 */
  const uniqErrs = [...new Set(errors)];
  const uniqWarn = [...new Set(warnings)];
  stats.largest.sort((a, b) => b.size - a.size);
  stats.largest = stats.largest.slice(0, 8);
  stats.bytesHuman = (stats.bytes / 1048576).toFixed(2) + ' MB';

  return { ok: uniqErrs.length === 0, errors: uniqErrs, warnings: uniqWarn, defers, stats };
}

/* 按允许清单铺一份暂存目录（pack.js / build.js 共用）：不是先全拷再删，
   而是从头就只放行清单里的件——产品页、字体、备份件根本没机会进暂存区。 */
function copyAllowed(src, dest) {
  const copied = [];
  const skipped = [];
  const copyFile = (rel) => {
    const s = path.join(src, rel);
    const d = path.join(dest, rel);
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.copyFileSync(s, d);
    copied.push(rel);
  };
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const name = ent.name;
    if (ent.isDirectory()) {
      if (!ALLOW_DIRS.has(name)) { skipped.push(name + '/'); continue; }
      if (name === 'icons') {
        for (const sub of fs.readdirSync(path.join(src, name), { withFileTypes: true })) {
          if (sub.isDirectory()) skipped.push(name + '/' + sub.name + '/');
          else copyFile(path.join(name, sub.name));
        }
        continue;
      }
      if (name === 'lib') {
        for (const sub of fs.readdirSync(path.join(src, name), { withFileTypes: true })) {
          const rel = path.join(name, sub.name);
          if (sub.isDirectory()) {
            if (sub.name !== 'video') { skipped.push(rel + '/'); continue; }
            const walkDir = (r2) => {
              for (const x of fs.readdirSync(path.join(src, r2), { withFileTypes: true })) {
                const r3 = path.join(r2, x.name);
                if (x.isDirectory()) walkDir(r3);
                else { const s = path.join(src, r3); const d = path.join(dest, r3); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, d); copied.push(r3); }
              }
            };
            walkDir(rel);
          } else if (ALLOW_LIB.has(sub.name)) copyFile(rel);
          else skipped.push(rel);
        }
      }
      continue;
    }
    if (ALLOW_FILES.has(name)) copyFile(name);
    else skipped.push(name);
  }
  return { copied, skipped };
}

/* 出包后收拾页面：产品界面里指向「不随包发」的入口、以及包里没有的脚本，
   留在包里客户一点就是「找不到文件」——出包时从包里那份摘掉（源目录不动）。 */
function patchHandPages(dir) {
  const removed = [];
  const popup = path.join(dir, 'popup.html');
  if (!fs.existsSync(popup)) return removed;
  let h = fs.readFileSync(popup, 'utf8');
  const before = h;

  /* ❓ 新手引导：guide.html 是产品页（闸门不随包发），入口一并摘掉 */
  h = h.replace(/[ \t]*<a\b[^>]*\bid=["']hdrGuideLink["'][^>]*>[\s\S]*?<\/a>[ \t]*(\r?\n)?/gi, () => {
    if (!removed.includes('❓ 新手引导→guide.html')) removed.push('❓ 新手引导→guide.html');
    return '\n';
  });

  /* 包里没有的本地脚本，脚本标签一并摘掉（留空行，不改行号） */
  h = h.replace(/[ \t]*<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>[ \t]*(\r?\n)?/gi, (m, src) => {
    if (/^([a-z]+:)?\/\//i.test(src)) return m;
    const rel = src.split(/[?#]/)[0].replace(/^\.\//, '');
    if (!rel || fs.existsSync(path.join(dir, rel))) return m;
    removed.push('脚本 ' + rel);
    return '\n';
  });

  if (h !== before) fs.writeFileSync(popup, h);
  return removed;
}

function printReport(r, dir) {
  console.log(`\n📦 执行器包闸门：${dir}`);
  console.log(`   文件 ${r.stats.files} 个 · ${r.stats.bytesHuman || '0 MB'}`);
  if (r.stats.largest && r.stats.largest.length) {
    console.log('   最大几件：' + r.stats.largest.map((x) => `${x.rel} ${(x.size / 1048576).toFixed(1)}MB`).join(' / '));
  }
  if (r.defers.length) {
    console.log('\n   ⏳ 临时豁免（第 3–4 段再拆，不是最终形态）：');
    r.defers.forEach((x) => console.log('     · ' + x));
  }
  if (r.warnings.length) {
    console.log('\n   ⚠️ 提醒：');
    r.warnings.forEach((x) => console.log('     · ' + x));
  }
  if (r.errors.length) {
    console.log('\n❌ 闸门没放行：');
    r.errors.forEach((x) => console.log('   · ' + x));
  } else {
    console.log('\n✅ 闸门放行');
  }
}

module.exports = { check, printReport, copyAllowed, patchHandPages, ALLOW_FILES, ALLOW_DIRS, ALLOW_LIB, STUB_LIBS };

if (require.main === module) {
  const dir = path.resolve(process.argv[2] || path.join(ROOT, 'executor'));
  const r = check(dir);
  printReport(r, dir);
  process.exit(r.ok ? 0 : 1);
}
