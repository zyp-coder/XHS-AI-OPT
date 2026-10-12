/**
 * build.js — 发行版打包脚本
 *
 * 作用：按版本类型生成写死的 lib/edition.js，复制整个 extension 目录到 dist，
 *       再打成可直接「加载已解压的扩展 / 上传」的 zip 包。
 *
 * 用法（在项目根目录执行）：
 *   node build.js full --licensee "张三公司"      # 全功能版（¥539/月；② + 线索）
 *   node build.js comment --licensee "李四"       # 基础版（¥239/月；共有 + 发笔记）
 *   node build.js comment-multi --licensee "王五" # 升级版（¥399/月；① + 获客）
 *   node build.js pro                            # 自用版（全功能、零等待，自用）
 *
 * 可选参数：
 *   --licensee "客户名"   写入授权对象（建议填）
 *   --days N             覆盖默认有效天数（如 --days 30；0 = 不过期）
 *   --xhs-id "小红心书号"   绑定到指定「小红书号」：插件只在当前登录为该书号时才可用
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
const SRC = path.join(ROOT, 'extension');

// ── 版本预设 ───────────────────────────────────────────────
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
    features: { batchSend: true, tenant: true, knowledge: true, autoWater: true, prospectList: true, notePublish: true, dailyBrowse: true, videoFilm: true },
    keywordMax: KEYWORD_MAX_UNLIMITED, price: 0, noDelay: true,
  },

  // ── 对外销售的三档（按月收费：默认有效期 30 天，打包时可用 --days 覆盖）──
  // ③ 全功能版：② + 线索（通知 / 私信 + 获客清单 + 客服话术）；定价 539/月
  full: {
    label: '全功能版',
    validDays: 30,
    price: 539,
    keywordMax: KEYWORD_MAX_UNLIMITED,
    features: { batchSend: true, tenant: true, knowledge: true, autoWater: true, prospectList: true, notePublish: true, dailyBrowse: true, videoFilm: true },
  },
  // ① 基础版：共有 + 发笔记（AI 写笔记稿 / 素材库 / 笔记档案 / 字效编辑器）；无获客、无线索；定价 239/月
  comment: {
    label: '基础版',
    validDays: 30,
    price: 239,
    keywordMax: KEYWORD_MAX_UNLIMITED,
    features: { batchSend: true, tenant: true, knowledge: true, autoWater: false, prospectList: false, notePublish: true, dailyBrowse: false, videoFilm: true },
  },
  // ② 升级版：① + 获客（一键灌水/笔记列表/关键词维护）；无线索；定价 399/月
  // 日常浏览随获客走（② 起开）；照旧不列入对外功能清单：物料与说明书都不写这条
  'comment-multi': {
    label: '升级版',
    validDays: 30,
    price: 399,
    keywordMax: KEYWORD_MAX_UNLIMITED,
    features: { batchSend: true, tenant: true, knowledge: true, autoWater: true, prospectList: false, notePublish: true, dailyBrowse: true, videoFilm: true },
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
  console.error('\n用法: node build.js <full|comment|comment-multi|pro> [--licensee "客户名"] [--days N] [--xhs-id "小红书号"] [--xhs-name "昵称"] [--out 目录]\n');
  process.exit(1);
}

// ── 混淆编码 / 校验（发行版防护：隐藏绑定号、有效期，并自检防篡改） ──
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}
function b64(str) { return Buffer.from(str, 'utf8').toString('base64'); }

// 对「敏感载荷」做不可读化编码：base64 → 反转 → 再 base64（运行时需反转+两次解码）
function obfuscatePayload(payloadObj) {
  const json = JSON.stringify(payloadObj);
  const inner = b64(json);
  const rev = inner.split('').reverse().join('');
  return { encoded: b64(rev), json };
}

// ── 生成 edition.js 文件内容（发行版） ─────────────────────
// 说明：敏感项（boundAccount / builtAt / expireAt / validDays）以混淆载荷形式嵌入，
//       不直接明文裸露绑定号；并写入 integrity 校验，运行时校验失败即视为被篡改。
function genEditionJs(cfg) {
  const featuresStr = `{\n    batchSend: ${cfg.features.batchSend},\n    tenant: ${cfg.features.tenant},\n    knowledge: ${cfg.features.knowledge},\n    autoWater: ${cfg.features.autoWater},\n    prospectList: ${cfg.features.prospectList},\n    notePublish: ${cfg.features.notePublish},\n    dailyBrowse: ${cfg.features.dailyBrowse},\n    videoFilm: ${cfg.features.videoFilm},\n  }`;
  const bound = cfg.boundAccount || { xhsId: '', name: '' };

  // 敏感载荷（重要值不落明文）
  const { encoded, json } = obfuscatePayload({
    boundAccount: { xhsId: bound.xhsId || '', name: bound.name || '' },
    builtAt: cfg.builtAt,
    expireAt: cfg.expireAt,
    validDays: cfg.validDays,
    keywordMax: cfg.keywordMax,
    price: cfg.price,
  });
  const salt = 'xk' + Date.now().toString(16) + (Math.random() * 0xffffffff | 0).toString(16);
  const sig = fnv1a(salt + '::' + json);

  return `/**
 * edition.js — 版本定义与功能开关（发行版·自动生成，请勿手改）
 * 由 build.js 自动生成。敏感授权信息已混淆并带防篡改校验。
 */

const EDITION = {
  type: ${JSON.stringify(cfg.type)},
  label: ${JSON.stringify(cfg.label)},
  licensee: ${JSON.stringify(cfg.licensee || '')},
  noDelay: ${!!cfg.noDelay},
  features: ${featuresStr},
  // ⚠️ 以下为混淆载荷：绑定号 / 有效期等重要取值在此，勿直接修改其含义。
  _payload: ${JSON.stringify(encoded)},
  _salt: ${JSON.stringify(salt)},
  _sig: ${JSON.stringify(sig)},
};

// ── 载荷解码（运行时） ──
function _edB64(s) {
  if (typeof atob !== 'undefined') {
    const bin = atob(s);
    try { return decodeURIComponent(escape(bin)); } catch (_) { return bin; }
  }
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'base64').toString('utf8');
  throw new Error('no b64');
}
function _edDecode() {
  const reversed = _edB64(EDITION._payload);
  const inner = reversed.split('').reverse().join('');
  return _edB64(inner);
}
function _edFnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

// 解出敏感数据（若缺失/损坏则空对象）
let _edData = {};
try {
  const raw = _edDecode();
  _edData = JSON.parse(raw);
  _edData._raw = raw;
} catch (_) { _edData = {}; }

// 读取唯一真实来源（优先混淆载荷；未解出则回退默认）
EDITION.boundAccount = (_edData && _edData.boundAccount && Object.assign({ xhsId: '', name: '' }, _edData.boundAccount)) || { xhsId: '', name: '' };
EDITION.builtAt = (_edData && _edData.builtAt) || 0;
EDITION.expireAt = (_edData && _edData.expireAt) || 0;
EDITION.validDays = (_edData && _edData.validDays) || 0;
EDITION.keywordMax = (function () {
  const v = parseInt(_edData && _edData.keywordMax, 10);
  return (isFinite(v) && v >= 0) ? v : 0; // 0 = 不限
})();
EDITION.price = (_edData && _edData.price) || 0;

function editionHasFeature(name) {
  return !!(EDITION.features && EDITION.features[name]);
}

function editionNeverExpires() {
  return !EDITION.expireAt || EDITION.expireAt <= 0;
}

/** 是否绑定了指定小红书号（无绑定 = 不限制账号） */
function editionHasBinding() {
  return !!String((EDITION.boundAccount && EDITION.boundAccount.xhsId) || '').trim();
}

/** 当前绑定的小红书号（未绑定返回空串） */
function editionBoundXhsId() {
  return editionHasBinding() ? String(EDITION.boundAccount.xhsId).trim() : '';
}

/** 一键灌水允许的最大关键词数量（0＝不限；非法值按不限处理） */
function editionKeywordMax() {
  const v = parseInt(EDITION.keywordMax, 10);
  return (isFinite(v) && v >= 0) ? v : 0;
}

/** 授权文件完整性校验：载荷被改动（含绑定号/有效期）则判定为被篡改 */
function editionIntegrityOk() {
  if (!EDITION._payload || !EDITION._salt || !EDITION._sig) return false;
  try {
    const raw = _edDecode();
    if (!raw) return false;
    return _edFnv(EDITION._salt + '::' + raw) === EDITION._sig;
  } catch (_) { return false; }
}

function editionIsExpired(nowMs) {
  if (editionNeverExpires()) return false;
  const t = Number(nowMs) || 0;
  return t > EDITION.expireAt;
}

function editionRemainingDays(nowMs) {
  if (editionNeverExpires()) return Infinity;
  const t = Number(nowMs) || 0;
  if (t > EDITION.expireAt) return 0;
  const dayStart = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  return Math.round((dayStart(EDITION.expireAt) - dayStart(t)) / 86400000);
}

function editionSummary(nowMs) {
  return {
    type: EDITION.type,
    label: EDITION.label,
    licensee: EDITION.licensee || '',
    builtAt: EDITION.builtAt || 0,
    expireAt: EDITION.expireAt || 0,
    validDays: EDITION.validDays || 0,
    neverExpires: editionNeverExpires(),
    hasBinding: editionHasBinding(),
    tampered: !editionIntegrityOk(),
    keywordMax: editionKeywordMax(),
    price: parseInt(EDITION.price, 10) || 0,
    noDelay: !!EDITION.noDelay,
    boundAccount: {
      xhsId: editionBoundXhsId(),
      name: (EDITION.boundAccount && EDITION.boundAccount.name) ? String(EDITION.boundAccount.name) : '',
    },
    features: { ...EDITION.features },
    expired: nowMs !== undefined ? editionIsExpired(nowMs) : false,
    remainingDays: nowMs !== undefined ? editionRemainingDays(nowMs) : null,
  };
}

const Edition = {
  EDITION,
  hasFeature: editionHasFeature,
  neverExpires: editionNeverExpires,
  hasBinding: editionHasBinding,
  boundXhsId: editionBoundXhsId,
  keywordMax: editionKeywordMax,
  integrityOk: editionIntegrityOk,
  isExpired: editionIsExpired,
  remainingDays: editionRemainingDays,
  summary: editionSummary,
};

if (typeof self !== 'undefined') { self.Edition = Edition; }
if (typeof module !== 'undefined') { module.exports = Edition; }
`;
}

// ── 更新 manifest 名称（追加版本标识，便于区分/共存） ──────
function patchManifest(destDir, cfg) {
  const mp = path.join(destDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(mp, 'utf8'));
  // 源 manifest 名称带「· 开发版」后缀（开发环境自用），打包时压回产品名再拼当前档位，避免出现两个档位名
  const baseName = String(manifest.name || '').split('·')[0].trim() || '小红书评论助手';
  const suffix = cfg.licensee ? `${cfg.label}·${cfg.licensee}` : cfg.label;
  manifest.name = `${baseName} · ${suffix}`;
  fs.writeFileSync(mp, JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
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

// ── 极简三步使用说明（生成 txt + html 双份） ───────────────
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
  // 日常浏览：随获客 ② 起开通，但按老板口径不列入对外功能清单（物料/说明书都不写），故这里有意不生成条目
  return out;
}

function writeStepsManual(stageDir, cfg) {
  const bound = cfg.boundAccount || {};
  const validStr = cfg.validDays > 0 ? (cfg.validDays + ' 天') : '永久';
  const lc = cfg.licensee || '通用';
  const boundLine = bound.xhsId ? ('绑定小红书号：' + bound.xhsId + (bound.name ? '（' + bound.name + '）' : '')) : '';
  const feats = featureLines(cfg);
  const featsTxt = feats.map((x, i) => '  ' + (i + 1) + ') ' + x).join('\n');
  const featsHtml = feats.map((x) => '<li>' + escHtml(x) + '</li>').join('');
  // 带出片的档位：整份说明都指到 Edge（配音走微软给 Edge 的免费通道，别的浏览器念不出声）
  const useEdge = !!(cfg.features && cfg.features.videoFilm);
  const brName = useEdge ? 'Edge' : 'Chrome';
  const brUrl = useEdge ? 'edge://extensions' : 'chrome://extensions';
  const edgeTip = useEdge
    ? '  ※ 请务必用 Edge：里面的配音走的是微软给 Edge 的免费通道，换 Chrome 念不出声（苹果电脑下载 Edge 即可）。\n'
    : '';
  const edgeTipHtml = useEdge
    ? '<li style="color:#888">※ 请务必用 Edge：里面的配音走的是微软给 Edge 的免费通道，换 Chrome 念不出声（苹果电脑下载 Edge 即可）。</li>'
    : '';

  const txt = `================================================
   小红书评论助手 · ${cfg.label}  使用说明
================================================
版本：${cfg.label}　｜　授权：${lc}　｜　有效期：${validStr}
${boundLine ? boundLine + '\n' : ''}────────────────────────────────────────
已开通功能：
${featsTxt}

本工具只要 3 步就会用：

【第①步】拿 DeepSeek 的 API Key
  1) 打开 https://platform.deepseek.com 注册并登录
  2) 左侧「API Keys」→ 点「创建新密钥」
  3) 复制那串 sk-xxx（只显示一次，请先拷贝保存）
  ※ API 按用量计费，用之前可根据需求充值一点

【第②步】加载浏览器扩展
  1) 打开 ${brName}，地址栏输入 ${brUrl} 回车
  2) 打开右上角「开发者模式」
  3) 点「加载已解压的扩展程序」→ 选本压缩包解压后的这个文件夹
  4) 右上角出现插件图标即可（建议点 📌 固定）
${edgeTip}
【第③步】激活使用
  1) 打开小红书网页 → 点插件图标 → 进入「首次设置」向导
  2) 向导第①步：选 DeepSeek，粘贴刚复制的 API Key
  3) 向导第②步：填产品名称 / 简介
  4) 向导第③步：选推广目标
  5) 向导第④步：绑定账号验证 → 通过即解锁可用
     ※ 验证前：先在浏览器里打开「你这个小红书号」自己的「我的」主页，
        并保持这个页面是打开的，再回来点「验证」
  以后要改配置，回插件窗口「⚙️ 设置」里改。

（提示：请按真人节奏使用，因操作过猛导致的账号风险需自行承担）
================================================
技术支持 / 续期：____________________
`;

  const h = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${escHtml(cfg.label)} · 使用说明</title>
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
  <h1>小红书评论助手 · ${escHtml(cfg.label)}</h1>
  <div class="sub">使用说明 · 只要 3 步就会用</div>
  <div class="auth">版本：${escHtml(cfg.label)}　｜　授权：${escHtml(lc)}　｜　有效期：${escHtml(validStr)}${bound.xhsId ? '　｜　绑定：' + escHtml(bound.xhsId) : ''}</div>

  <div class="step">
    <h2>已开通功能</h2>
    <ol>${featsHtml}</ol>
  </div>

  <div class="step">
    <h2>① 拿 DeepSeek 的 API Key</h2>
    <ol>
      <li>打开 <b>https://platform.deepseek.com</b> 注册登录。</li>
      <li>左侧「API Keys」→ 点「创建新密钥」。</li>
      <li>复制那串 <code>sk-xxx</code>（只显示一次，先拷贝保存）。</li>
      <li style="color:#888">※ API 按用量计费，用前可根据需求充值一点。</li>
    </ol>
  </div>

  <div class="step">
    <h2>② 加载浏览器扩展</h2>
    <ol>
      <li>打开 ${brName}，地址栏输入 <code>${brUrl}</code> 回车。</li>
      <li>打开右上角「开发者模式」。</li>
      <li>点「加载已解压的扩展程序」→ 选本压缩包解压后的这个文件夹。</li>
      <li>右上角出现插件图标即可（建议点 📌 固定）。</li>
      ${edgeTipHtml}
    </ol>
  </div>

  <div class="step">
    <h2>③ 激活使用</h2>
    <ol>
      <li>打开小红书网页 → 点插件图标 → 进入「首次设置」向导。</li>
      <li>向导①：选 DeepSeek，粘贴刚复制的 API Key。</li>
      <li>向导②：填产品名称 / 简介。</li>
      <li>向导③：选推广目标。</li>
      <li>向导④：绑定账号验证，通过即解锁可用。</li>
      <li style="color:#888">※ 验证前：先在浏览器打开「你这个小红书号」自己的「我的」主页，并保持这个页面打开，再回来点「验证」。</li>
      <li>以后要改配置，回插件窗口「⚙️ 设置」里改。</li>
    </ol>
  </div>

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

// ── 主流程 ─────────────────────────────────────────────────
function main() {
  const { type, opts } = parseArgs(process.argv);
  if (!type || !PRESETS[type]) {
    usageAndExit(type ? `未知版本类型: ${type}` : '缺少版本类型');
  }
  if (!fs.existsSync(SRC)) usageAndExit(`找不到源目录: ${SRC}`);

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
  const stageName = safeLicensee ? `${type}-${safeLicensee}` : type;

  // ★ 按「打包日期_用户名_小红书号」分目录：dist/日期_用户名_号/ 里放 zip、扩展文件夹、使用说明
  const pad2 = (n) => String(n).padStart(2, '0');
  const _d = new Date();
  const dateStr = `${_d.getFullYear()}-${pad2(_d.getMonth() + 1)}-${pad2(_d.getDate())}`;
  let dirUser = '未知名';
  if (cfg.boundAccount.xhsId) dirUser = cfg.boundAccount.name || opts.licensee || dirUser;
  const safeUser = dirUser.replace(/[\\/:*?"<>|\s]+/g, '_');
  const dirToken = cfg.boundAccount.xhsId
    ? `${dateStr}_${safeUser}_${cfg.boundAccount.xhsId}`
    : `${dateStr}_无绑定`;
  const pkgDir = path.join(outDir, dirToken);
  fs.mkdirSync(pkgDir, { recursive: true });
  const stageDir = path.join(pkgDir, `小红书评论助手-${stageName}`);
  if (fs.existsSync(stageDir)) fs.rmSync(stageDir, { recursive: true, force: true });

  // 1) 复制整个 extension 目录（排除 Chrome 保留的 _ 开头的文件/目录，如 _capture；_locales 属 Chrome 官方保留特殊目录，本扩展未使用）
  fs.cpSync(SRC, stageDir, {
    recursive: true,
    filter: (src) => {
      if (src === SRC) return true;
      if (src.includes('node_modules')) return false;
      const name = path.basename(src);
      if (name.endsWith('.backup') || name.includes('.bak')) return false;   // .bak / .backup 备份文件不进包
      return !name.startsWith('_');
    },
  });

  // 2) 写死 edition.js
  fs.writeFileSync(path.join(stageDir, 'lib', 'edition.js'), genEditionJs(cfg), 'utf8');

  // 3) 更新 manifest 名称
  const manifest = patchManifest(stageDir, cfg);

  // 3.5) 写入极简三步使用说明（txt + html 双份）
  writeStepsManual(stageDir, cfg);

  // 4) 打 zip
  const zipPath = path.join(pkgDir, `小红书评论助手-${stageName}.zip`);
  zipDir(stageDir, zipPath);

  // 4.5) 使用说明也放一份到 <小红书号> 目录根，方便先看再装
  ['使用说明.txt', '使用说明.html'].forEach(f => {
    const s = path.join(stageDir, f);
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(pkgDir, f));
  });

  // 4.6) 追加打包记录（dist/打包记录.json 可编辑；自动生成可读表格 html）
  appendBuildRecord(outDir, cfg, stageName, zipPath, stageDir);

  console.log('\n✅ 打包完成');
  console.log('   版本类型 :', type, '(' + preset.label + ')');
  console.log('   授权对象 :', opts.licensee || '(无)');
  console.log('   绑定账号 :', cfg.boundAccount.xhsId ? `${cfg.boundAccount.xhsId}${cfg.boundAccount.name ? '（' + cfg.boundAccount.name + '）' : ''}` : '(未绑定)');
  console.log('   定价     :', cfg.price > 0 ? ('¥' + cfg.price + ' / 月') : '(自用/试用不标价)');
  console.log('   灌水关键词上限 :', cfg.keywordMax >= 1 ? (cfg.keywordMax + ' 个') : '不限量');
  console.log('   有效天数 :', validDays > 0 ? validDays + ' 天' : '永久');
  console.log('   到期时间 :', expireAt ? new Date(expireAt).toLocaleString('zh-CN') : '永不过期');
  console.log('   功能开关 :', JSON.stringify(preset.features));
  console.log('   扩展名称 :', manifest.name);
  console.log('   解压目录 :', stageDir);
  console.log('   使用说明 :', path.join(stageDir, '使用说明.txt'));
  console.log('   ZIP 包   :', zipPath);
  console.log('   打包记录 :', path.join(outDir, '打包记录.json'));
}

main();
