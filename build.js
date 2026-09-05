/**
 * build.js — 发行版打包脚本
 *
 * 作用：按版本类型生成写死的 lib/edition.js，复制整个 extension 目录到 dist，
 *       再打成可直接「加载已解压的扩展 / 上传」的 zip 包。
 *
 * 用法（在项目根目录执行）：
 *   node build.js trial                          # 试用版（15天，无批量/产品库/租户）
 *   node build.js trial-pro                      # 试用版Pro（15天，在试用版基础上开放产品库）
 *   node build.js ent --licensee "张三公司"       # 企业版（1年，有产品库，无租户）
 *   node build.js ent-tenant --licensee "李四"    # 企业版+租户（1年，全功能）
 *   node build.js test                           # 体验版（1天，全功能，给朋友试效果）
 *   node build.js pro                            # 全功能版（永不过期，全功能，自用）
 *
 * 可选参数：
 *   --licensee "客户名"   写入授权对象（企业版建议填）
 *   --days N             覆盖默认有效天数（如 --days 30）
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
const PRESETS = {
  // 自用版（内部）：永不过期、所有功能全开、零等待（noDelay）
  pro: {
    label: '自用版',
    validDays: 0,
    features: { batchSend: true, productLib: true, tenant: true, knowledge: true, autoWater: true, prospectList: true },
    keywordMax: 8, price: 0, noDelay: true,
  },

  // ── 对外销售的三档 ──
  // ① 全功能版：所有功能；定价 539
  full: {
    label: '全功能版',
    validDays: 0,
    price: 539,
    keywordMax: 8,
    features: { batchSend: true, productLib: true, tenant: true, knowledge: true, autoWater: true, prospectList: true },
  },
  // ② 评论助手·单关键词：单租户、单关键词评论助手 + 产品库/知识库/运营总结；定价 239
  comment: {
    label: '评论助手·单关键词',
    validDays: 0,
    price: 239,
    keywordMax: 1,
    features: { batchSend: true, productLib: true, tenant: false, knowledge: true, autoWater: true, prospectList: false },
  },
  // ③ 评论助手·多关键词：单租户、多关键词评论助手 + 获客清单 + 产品库/知识库/运营总结；定价 399
  'comment-multi': {
    label: '评论助手·多关键词',
    validDays: 0,
    price: 399,
    keywordMax: 8,
    features: { batchSend: true, productLib: true, tenant: false, knowledge: true, autoWater: true, prospectList: true },
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
  const featuresStr = `{\n    batchSend: ${cfg.features.batchSend},\n    productLib: ${cfg.features.productLib},\n    tenant: ${cfg.features.tenant},\n    knowledge: ${cfg.features.knowledge},\n    autoWater: ${cfg.features.autoWater},\n    prospectList: ${cfg.features.prospectList},\n  }`;
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
EDITION.keywordMax = (_edData && _edData.keywordMax) || 8;
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

/** 一键灌水允许的最大关键词数量（1=单关键词；8=多关键词） */
function editionKeywordMax() {
  const v = parseInt(EDITION.keywordMax, 10);
  return (isFinite(v) && v >= 1) ? v : 8;
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
  const suffix = cfg.licensee ? `${cfg.label}·${cfg.licensee}` : cfg.label;
  manifest.name = `${manifest.name} · ${suffix}`;
  fs.writeFileSync(mp, JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

// ── 生成「使用说明.txt」（按版本功能动态裁剪） ──────────────
function genManual(cfg) {
  const f = cfg.features || {};
  const expireStr = cfg.expireAt ? new Date(cfg.expireAt).toLocaleDateString('zh-CN') : '永不过期';
  const validStr = cfg.validDays > 0 ? (cfg.validDays + ' 天') : '永久';
  const L = [];
  const push = (s) => L.push(s);
  const HR = '────────────────────────────────────────────────';
  let n = 0;
  const sec = (title) => { n++; push(''); push(HR); push('  ' + n + '、' + title); push(HR); };

  push('================================================');
  push('   小红书评论助手 · ' + cfg.label + '  使用说明');
  push('================================================');
  push('');
  push('【授权信息】');
  push('  版本类型：' + cfg.label);
  push('  授权对象：' + (cfg.licensee || '通用'));
  push('  有效期  ：' + validStr + (cfg.expireAt ? ('，截止 ' + expireStr) : ''));
  if (cfg.price > 0) push('  定价    ：¥' + cfg.price + ' 元/套');
  push('  灌水关键词上限：' + (cfg.keywordMax == null ? 8 : cfg.keywordMax) + ' 个');
  const bound = cfg.boundAccount || {};
  if (bound.xhsId) {
    push('  绑定小红书号：' + bound.xhsId + (bound.name ? ('（' + bound.name + '）') : ''));
  }
  push('');
  push('【重要提示】');
  if (cfg.expireAt) {
    push('  · 本工具需全程联网：AI 生成话术、授权时间校准都要网络。');
    push('  · 到期后功能会自动锁定，请在到期前联系服务商续期或换新包。');
  } else {
    push('  · 本版本永不过期、功能全开，无需授权时间校准。');
    push('  · AI 生成话术仍需联网（调用大模型接口）。');
  }
  if (bound.xhsId) {
    push('  ●【绑定账号】本工具已绑定小红书号「' + bound.xhsId + '」。');
    push('  · 使用前请先在小红书网页版登录该账号；只有该账号才可正常使用。');
    push('  · 若检测到当前登录账号不是绑定账号，工具会自动锁定，无法回复/私信/点赞等。');
  }

  push('')
  push('  ⚠️【使用机制与风控提醒（务必先看）】小红书对「批量、高频、异常」行为有风控，请按真人节奏使用：');
  push('  · 把频率调低、间隔拉长并随机化；别同一篇笔记反复刷、别新号一上来就大批量操作。');
  push('  · 每条话术先人工看一遍再点发送，别一字不改全量灌水，避免话术雷同被识别。');
  push('  · 保持内容多元：不要长时间只发相同文案、或只跟同类型账号互动。');
  push('  · 本工具只是辅助，发送/点赞/关注等操作都由你自己确认并触发；请在你可接受风险的账号上使用。');
  push('  ·【免责声明】因使用本工具、操作过于频繁或任何平台原因导致的账号异常、限流或封禁，责任由使用者自担，作者与工具方概不负责。');

  sec('安装 / 加载插件');
  push('  1) 打开 Chrome 浏览器，地址栏输入并回车：chrome://extensions');
  push('  2) 打开右上角「开发者模式」开关。');
  push('  3) 把本压缩包解压到一个固定文件夹（不要放临时目录，删了插件会失效）。');
  push('  4) 点「加载已解压的扩展程序」，选择解压后的文件夹。');
  push('  5) 安装成功后，浏览器右上角会出现插件图标（建议点 📌 固定住）。');

  sec('打开插件 / 打开后台设置');
  push('  · 打开插件：先在浏览器打开小红书网页，再点右上角的插件图标，');
  push('    会在屏幕左侧弹出「评论助手」操作窗口。');
  push('  · 打开后台设置：点插件窗口右上角的「⚙️ 设置」按钮；');
  push('    或在 chrome://extensions 里点本插件的「扩展选项」。');

  sec('配置 AI（必做，否则无法生成话术）');
  push('  ① AI-Key  → 【必配】不配无法调用 AI。');
  push('  ② 产品名称 → 【必配】AI 靠它知道你在推广什么。');
  push('  ③ 知识库  → 【强烈建议必配】让话术更专业真人。');
  push('  其余（引导方式/话术风格/昵称/关键词过滤/停留时间）为【选配】，可不设置。');
  push('');
  push('  进入「设置」→ 左侧「🤖 AI 配置」：');
  push('  1) API Key：填你的大模型密钥（形如 sk-xxxxxxxx）。');
  push('  2) API 提供商：DeepSeek / OpenAI / 通义千问 / 硅基流动 / 自定义。');
  push('     选好后 Base URL 与模型会自动匹配；选「自定义」需手填 Base URL。');
  push('  3) 模型：按提供商自动列出，选一个即可。');
  push('  4) Temperature 建议 0.8；Max Tokens 建议 2000。');
  push('  5) 点「保存 AI 配置」→ 再点「🔌 测试连接」，显示成功即 OK。');
  push('');
  push('  【去哪拿 API Key？】');
  push('   · DeepSeek（性价比高，推荐）：https://platform.deepseek.com');
  push('   · 通义千问：阿里云百炼控制台');
  push('   · OpenAI：https://platform.openai.com');

  sec('基本配置');
  push('  「设置」→「📦 基本配置」：');
  push('  · 产品名称【必配】：你要推广的产品 / 服务名。');
  push('  · 引导方式【选配】：如 微信小程序 / 公众号 / App。');
  if (f.productLib) {
    push('  · 产品简述【选配】：一两句话描述产品，AI 会据此理解场景（本版本可用）。');
  }
  push('  · 我的小红书昵称【选配】：填你自己的账号昵称（可多个，每行一个），');
  push('    用于防止重复给同一篇笔记灌水。');
  push('  · 商机关键词过滤【选配】：只回复命中关键词的评论。');

  sec('话术风格【选配】');
  push('  「设置」→「✍️ 话术风格」：可自定义 A / B / C 三种话术风格，');
  push('  留空则用系统默认风格；字数范围可在同页「字数控制」单独设置。');

  if (f.knowledge) {
    sec('知识库【强烈建议必配】');
    push('  「设置」→「📚 知识库」：录入你的专业知识、个人经历、话术模板，');
    push('  AI 生成回复时会自动引用，回复更专业、更像真人。');
    push('  不配也能用，但话术会比较泛、不够有干货。');
  }

  if (f.prospectList) {
    sec('获客清单（本版本可用）');
    push('  插件窗口左上角切到「🎯 获客清单」：');
    push('  · 收录：评论助手里点商机卡片的「➕ 入清单」，或用收录关键词自动入库。');
    push('  · 筛选：按标签 / 意向等级 / 私信状态 / 昵称过滤候选人群。');
    push('  · 画像：勾选未画像的人点「⚡ 批量画像」，AI 自动打人群标签。');
    push('  · 私信：点「✉️ 私信」→「🤖 AI 生成话术」→ 人工确认后发送。');
    push('    ※ 私信需登录小红书网页版并打开过对方主页；发送前请人工核对话术，避免被风控。');
  }

  if (f.autoWater) {
    sec('一键灌水（本版本可用）');
    push('  「设置」→「💧 一键灌水」：配置搜索关键词与调度参数，');
    push('  配合插件窗口左侧的「🔎 搜索」批量找笔记。');
  }

  if (f.tenant) {
    sec('多产品 / 多租户切换（本版本专属）');
    push('  · 一个「租户」= 一个产品，各自独立的配置 / 知识库 / 话术 / 灌水记录。');
    push('  · 新建与管理：「设置」→「🏢 租户/产品」。');
    push('  · 快速切换：插件窗口顶部的下拉框，切换后整套数据随之切换。');
  }

  sec('日常使用流程');
  push('  1) 在浏览器打开一篇小红书笔记；');
  if (f.autoWater) {
    push('     或用插件窗口左侧的「🔎 搜索」按关键词批量找笔记，再点列表打开。');
  }
  push('  2) 点插件窗口的「🔄 刷新」→ 自动提取评论、AI 挖掘潜在客户并生成话术。');
  push('  3) 逐条查看 AI 生成的话术，满意就点该条的「一键发送」。');
  push('     （每条都需要你人工点击确认后才会发送。）');
  if (f.batchSend) {
    push('  4) 想省事：点「📤 评论刷新」，会自动对当前整页所有商机评论逐个发送。');
  } else {
    push('');
    push('  ※ 本（试用）版本仅支持逐条「一键发送」（需人工逐条确认），');
    push('    不含整页批量自动发送功能。升级企业版可解锁。');
  }

  sec('常见问题');
  push('  · 点了没反应？确认当前浏览器标签页是小红书页面。');
  push('  · 生成话术失败？回「🤖 AI 配置」点「测试连接」，检查 Key / 额度 / 网络。');
  if (cfg.expireAt) {
    push('  · 提示「授权已到期」？请联系服务商续期或获取新包。');
    push('  · 全程无网络会导致授权无法校准、AI 无法调用，请保持联网。');
  } else {
    push('  · 无网络时 AI 无法调用（本版本不做授权校时，不会因断网锁定）。');
  }

  push('');
  push('================================================');
  push('  技术支持 / 续期咨询：____________________');
  push('================================================');

  return L.join('\r\n') + '\r\n';
}

// ── 生成「使用说明.html」（分节：授权/提示/安装/AI/价格/配置/FAQ；按版本动态裁剪，可打印） ──
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function genManualHtml(cfg) {
  const f = cfg.features || {};
  const bound = cfg.boundAccount || {};
  const expireStr = cfg.expireAt ? new Date(cfg.expireAt).toLocaleDateString('zh-CN') : '永不过期';
  const validStr = cfg.validDays > 0 ? (cfg.validDays + ' 天') : '永久';
  const priceStr = cfg.price > 0 ? ('¥' + cfg.price + ' / 买断') : (cfg.type === 'pro' ? '（自用版，未标价）' : (cfg.type === 'full' ? '（官方定价 ¥539）' : '（试用，未标价）'));
  const kwMax = (cfg.keywordMax == null ? 8 : cfg.keywordMax);
  const feat = (b) => (b ? '<td class="yes">✔</td>' : '<td class="no">—</td>');
  const boundLine = bound.xhsId ? `<div class="warn">本工具已绑定小红书号「<b>${escHtml(bound.xhsId)}</b>」${bound.name ? '（' + escHtml(bound.name) + '）' : ''}，仅该账号在本人在主页验证通过后才能使用。</div>` : '';
  const t = (b) => (b ? '<span class="ok">开通</span>' : '<span class="off">未含</span>');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escHtml(cfg.label)} · 使用说明</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font:14px/1.8 "Microsoft YaHei","PingFang SC",sans-serif;color:#222;background:#f5f6f8;padding:18px}
  .page{max-width:860px;margin:0 auto;background:#fff;border-radius:12px;padding:34px 40px;box-shadow:0 2px 10px rgba(0,0,0,.06)}
  h1{font-size:23px;text-align:center;margin-bottom:4px}
  .edition{text-align:center;color:#7a7a7a;font-size:13px;margin-bottom:24px}
  h2{font-size:18px;margin:26px 0 12px;padding-left:10px;border-left:4px solid #ff274b;color:#1f1f1f}
  h3{font-size:15px;margin:16px 0 6px}
  p,li{font-size:13.5px;color:#333}
  ul{padding-left:22px}
  table{width:100%;border-collapse:collapse;font-size:13px;margin:8px 0}
  th,td{border:1px solid #e7e7e7;padding:9px 11px;text-align:center;vertical-align:middle}
  th{background:#f6f7f9;color:#333}
  td.lab{text-align:left;color:#555}
  .price{color:#ff274b;font-weight:700}
  .yes{color:#2e9e4f;font-weight:600}
  .no{color:#c2c6cc}
  .ok{color:#2e9e4f}
  .off{color:#c2c6cc}
  .warn{background:#fff4e8;border:1px solid #ffd9b3;border-radius:8px;padding:10px 12px;margin:12px 0;color:#7a4a1f}
  .must{background:#ffeef2;border:1px solid #ffc4d1;border-radius:8px;padding:10px 14px;margin:12px 0;color:#8a0f2e}
  .must b{color:#c00036}
  .badge-req{display:inline-block;background:#ff274b;color:#fff;border-radius:4px;font-size:11px;padding:0 6px;margin-left:6px;vertical-align:1px}
  .badge-opt{display:inline-block;background:#e5e7eb;color:#6b7280;border-radius:4px;font-size:11px;padding:0 6px;margin-left:6px;vertical-align:1px}
  .tip{background:#eef5ff;border-radius:8px;padding:10px 12px;margin:12px 0;color:#28406e;font-size:13px}
  .cur{background:#ffeef2}
  .foot{text-align:center;color:#999;font-size:12px;margin-top:28px;padding-top:14px;border-top:1px dashed #ddd}
  @media print{body{background:#fff;padding:0}.page{box-shadow:none}}
</style>
</head>
<body>
<div class="page">

  <h1>小红书评论助手 · ${escHtml(cfg.label)}</h1>
  <div class="edition">使用说明 · 自动生成 ${new Date(cfg.builtAt).toLocaleString('zh-CN')}</div>

  <div class="must">🗝️ <b>配置必读（先配这三样，才可正常使用）：</b><br>
    ① <b>AI-Key</b>（AI 配置）—— 必配，不配无法调用 AI 生成话术。<br>
    ② <b>产品名称</b>（基本配置）—— 必配，AI 靠它知道你在推广什么。<br>
    ③ <b>知识库</b>（知识库页）—— 强烈建议必配，AI 引用它让话术更专业真人。<br>
    其余（引导方式、话术风格、我的昵称、关键词过滤、停留时间等）均为 <b>选配</b>，可不设置。</div>

  <div class="tip">⚠️ <b>使用机制与风控提醒（务必先看）：</b>小红书对「批量、高频、异常」行为有风控，请按真人节奏使用：<br>
    · 把频率调低、间隔拉长并随机化；别同一篇笔记反复刷、别新号一上来就大批量操作。<br>
    · 每条话术先人工看一遍再点发送，别一字不改全量灌水，避免话术雷同被识别。<br>
    · 保持内容多元：不要长时间只发相同文案、或只跟同类型账号互动。<br>
    · 本工具只是辅助，发送/点赞/关注等操作都由你自己确认并触发；请在你可接受风险的账号上使用。</div>
  <div class="warn">📵 <b>免责声明：</b>因使用本工具、操作过于频繁或任何平台原因导致的账号异常、限流或封禁，责任由使用者自担，作者与工具方概不负责。</div>

  <h2>一、授权信息</h2>
  <table>
    <tr><th style="text-align:left">项目</th><th style="text-align:left">内容</th></tr>
    <tr><td class="lab">版本类型</td><td style="text-align:left">${escHtml(cfg.label)}</td></tr>
    <tr><td class="lab">授权对象</td><td style="text-align:left">${escHtml(cfg.licensee || '通用')}</td></tr>
    <tr><td class="lab">有效期</td><td style="text-align:left">${validStr}${cfg.expireAt ? ('（截止 ' + expireStr + '）') : ''}</td></tr>
    <tr><td class="lab">定价</td><td style="text-align:left"><span class="price">${priceStr}</span></td></tr>
    <tr><td class="lab">灌水关键词上限</td><td style="text-align:left">${kwMax} 个${kwMax === 1 ? '（单关键词版）' : ''}</td></tr>
    <tr><td class="lab">功能范围</td><td style="text-align:left">${f.batchSend ? '批量/整页发送 ' : ''}${f.productLib ? '产品库 ' : ''}${f.tenant ? '多租户 ' : ''}${f.knowledge ? '知识库 ' : ''}${f.autoWater ? '一键灌水 ' : ''}${f.prospectList ? '获客清单 ' : ''}${!f.batchSend && !f.productLib && !f.tenant && !f.knowledge && !f.autoWater && !f.prospectList ? '评论助手核心' : ''}</td></tr>
    ${bound.xhsId ? '<tr><td class="lab">绑定小红书号</td><td style="text-align:left">' + escHtml(bound.xhsId) + (bound.name ? '（' + escHtml(bound.name) + '）' : '') + '</td></tr>' : ''}
  </table>
  ${boundLine}

  <h2>二、重要提示</h2>
  <ul>
    <li>本工具需<b>全程联网</b>：AI 生成话术、授权时间校准都要网络。</li>
    ${cfg.expireAt ? '<li>到期后功能会自动锁定，请在到期前联系服务商续期或换新包。</li>' : '<li>本版本永不过期、功能全开，无需授权时间校准。</li>'}
    ${bound.xhsId ? '<li><b>绑定账号</b>：只有绑定号能在本人「我的」主页验证通过后正常使用；检测到登录账号非法时工具自动锁定。</li>' : ''}
    ${cfg.expireAt ? '<li>全程无网络会导致授权无法校准、AI 无法调用，请保持联网。</li>' : ''}
    <li>灌水按<b>顺序逐个关键词</b>执行：第一个关键词完成才开始第二个，不并发。</li>
  </ul>

  <h2>三、插件安装和使用</h2>
  <h3>安装 / 加载插件</h3>
  <ol>
    <li>打开 Chrome 浏览器，地址栏输入并回车：<code>chrome://extensions</code></li>
    <li>打开右上角「开发者模式」开关。</li>
    <li>把本压缩包解压到一个固定文件夹（不要放临时目录，删了插件会失效）。</li>
    <li>点「加载已解压的扩展程序」，选择解压后的文件夹。</li>
    <li>安装成功后浏览器右上角出现插件图标（建议固定住）。</li>
  </ol>
  <h3>打开插件 / 后台设置</h3>
  <ul>
    <li>先在浏览器打开小红书网页，再点右上角插件图标，左侧弹出操作窗口。</li>
    <li>后台设置：点插件窗口右上角「⚙️ 设置」，或在 chrome://extensions 点本插件的「扩展选项」。</li>
  </ul>
  <h3>日常使用流程</h3>
  <ol>
    <li>在浏览器打开一篇小红书笔记，或到插件左侧<b>添加灌水关键词列表</b>后按「🔎 搜索」批量找笔记。</li>
    <li>点「🔄 刷新」提取评论、AI 生成话术。</li>
    <li>满意后点该条「一键发送」（每条需人工点击确认）。</li>
    ${f.batchSend ? '<li>想省事：点「📤 自动评论」整页批量逐个发送。</li>' : '<li>本版本支持逐条一键发送（人工确认），不含整页批量，升级更高版本可解锁。</li>'}
  </ol>

  <h2>四、AI 配置说明</h2>
  <div class="tip">进入「设置」→「🤖 AI 配置」。<b class="badge-req">必配</b>：不填 API-Key，AI 无法生成话术，评论助手基本不能用。</div>
  <ol>
    <li><b>API Key</b><span class="badge-req">必配</span>：填你的大模型密钥（形如 sk-xxxxxxxx）。</li>
    <li><b>API 提供商</b>：DeepSeek / OpenAI / 通义千问 / 硅基流动 / 自定义；选好自动匹配 Base URL 与模型。</li>
    <li><b>模型</b>：按提供商自动列出，选一个即可。</li>
    <li><b>Temperature</b> 建议 0.8；<b>Max Tokens</b> 建议 2000。</li>
    <li>点「保存 AI 配置」→「🔌 测试连接」，成功即 OK。</li>
  </ol>
  <p style="font-size:12.5px;color:#888">去哪拿 Key：DeepSeek platform.deepseek.com（性价比高，推荐）；通义千问阿里云百炼；OpenAI platform.openai.com。</p>

  <h2>五、价格和功能定位</h2>
  ${priceTierTable(cfg)}
  <div class="tip">当前这个安装包为「<b>${escHtml(cfg.label)}</b>」，你正在使用的正是它对应的档位（价格见上方授权信息）。</div>
  <ul>
    <li><b>全功能版（¥539 · 买断）</b>：全部功能（产品库/知识库/多租户/获客清单/多关键词），适合品牌自营、多产品同时运营。</li>
    <li><b>评论助手·多关键词（¥399 · 买断）</b>：单租户 + 多关键词 + 获客清单 + 产品库 + 知识库 + 运营总结，适合单产品、多词引流获客。</li>
    <li><b>评论助手·单关键词（¥239 · 买断）</b>：单租户 + 单关键词 + 产品库 + 知识库 + 评论助手 + 运营总结，最经济，适合单一主词起步。</li>
  </ul>

  <h2>六、配置说明</h2>
  <h3>基本配置</h3>
  <ul>
    <li><b>产品名称</b><span class="badge-req">必配</span>：要推广的产品/服务名，AI 靠它判断并写话术。</li>
    <li><b>引导方式</b><span class="badge-opt">选配</span>：如微信小程序 / 公众号 / App；留空 = 不引流。</li>
    ${f.productLib ? '<li><b>产品简述</b><span class="badge-opt">选配</span>：一两句描述产品，AI 据此理解场景。</li>' : ''}
    <li><b>我的小红书昵称</b><span class="badge-opt">选配</span>：填自己的账号昵称（可多个），防重复给同一篇灌水。</li>
    <li><b>商机关键词过滤</b><span class="badge-opt">选配</span>：只回复命中关键词的评论。</li>
  </ul>
  <h3>话术风格</h3>
  <p>「设置」→「✍️ 话术风格」<span class="badge-opt">选配</span>：自定义 A / B / C 三种风格，留空用默认；字数控制同页设置。</p>
  ${f.knowledge ? '<h3>知识库（强烈建议必配）</h3><div class="must">📚<b>知识库</b><span class="badge-req">强烈建议必配</span>：「设置」→「📚 知识库」录入你的专业知识/经历/话术模板，AI 生成时自动引用，回复更专业、更像真人；不配也能用，但话术会泛、不够有干货。</div>' : ''}
  ${f.prospectList ? '<h3>获客清单</h3><p>插件左上切换到「🎯 获客清单」：收录（＋入清单 / 关键词收录）、筛选、⚡ 批量画像、✉️ 定向私信。私信需人工核对话术再发。</p>' : ''}
  ${f.autoWater ? '<h3>一键灌水（关键词列表）</h3><ul><li>插件左下「关键词列表」添加，最多 ' + kwMax + ' 个。</li><li>点「搜索」按顺序逐个关键词搜笔记；第一个完成才开始第二个。</li><li>「🧊 冷启动 / 🔄 循环」自动灌水同样按列表顺序执行。</li></ul>' : ''}
  ${f.tenant ? '<h3>多产品 / 多租户切换</h3><p>「设置」→「🏢 租户/产品」新建与管理，一个租户一个产品，各自独立配置/知识库/话术/灌水记录。</p>' : ''}

  <h2>七、常见问题</h2>
  <ul>
    <li><b>点了没反应？</b>确认当前浏览器标签页是小红书页面。</li>
    <li><b>生成话术失败？</b>回「🤖 AI 配置」点「测试连接」，查 Key/额度/网络。</li>
    ${cfg.expireAt ? '<li><b>提示「授权已到期」？</b>联系服务商续期或获取新包。</li>' : ''}
    <li><b>提示「账号校验未通过」？</b>打开小红书网页版，点右上角头像进入<b>本人「我的」主页</b>（页面有“编辑资料”），系统会自动读取小红书号完成验证；非绑定账号会锁定。</li>
    <li><b>关键词没有全部搜？</b>灌水是按列表顺序逐个执行的，请查看当前进度是否第一个还没完成。</li>
    ${bound.xhsId ? '<li><b>「授权文件校验失败」？</b>安装包可能被改动，请向服务商重新索取安装包。</li>' : ''}
  </ul>

  <div class="foot">技术支持 / 续期咨询：＿＿＿＿＿＿＿＿</div>
</div>
</body>
</html>
`;
}

// 三档售价表（随每个版本显示全三档，并标出当前档）
function priceTierTable(cfg) {
  const cur = cfg.type === 'full' ? 'class="cur"' : (cfg.type === 'comment' || cfg.type === 'comment-multi' ? 'class="cur"' : '');
  return `<table>
    <tr>
      <th style="width:16%">功能项</th>
      <th>全功能版</th>
      <th>评论助手·多关键词</th>
      <th>评论助手·单关键词</th>
    </tr>
    <tr>
      <td class="lab">定价（买断）</td>
      <td class="price">¥539</td>
      <td class="price">¥399</td>
      <td class="price">¥239</td>
    </tr>
    <tr><td class="lab">核心评论助手 / 运营总结</td><td>✔</td><td>✔</td><td>✔</td></tr>
    <tr><td class="lab">灌水关键词数量</td><td>8</td><td>8</td><td>1</td></tr>
    <tr><td class="lab">获取清单</td><td class="yes">✔</td><td class="yes">✔</td><td class="no">—</td></tr>
    <tr><td class="lab">产品库 / 知识库</td><td class="yes">✔</td><td class="yes">✔</td><td class="yes">✔</td></tr>
    <tr><td class="lab">多租户切换</td><td class="yes">✔</td><td class="no">—</td><td class="no">—</td></tr>
  </table>`;
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
function writeStepsManual(stageDir, cfg) {
  const bound = cfg.boundAccount || {};
  const validStr = cfg.validDays > 0 ? (cfg.validDays + ' 天') : '永久';
  const lc = cfg.licensee || '通用';
  const boundLine = bound.xhsId ? ('绑定小红书号：' + bound.xhsId + (bound.name ? '（' + bound.name + '）' : '')) : '';

  const txt = `================================================
   小红书评论助手 · ${cfg.label}  使用说明
================================================
版本：${cfg.label}　｜　授权：${lc}　｜　有效期：${validStr}
${boundLine ? boundLine + '\n' : ''}────────────────────────────────────────
本工具只要 3 步就会用：

【第①步】拿 DeepSeek 的 API Key
  1) 打开 https://platform.deepseek.com 注册并登录
  2) 左侧「API Keys」→ 点「创建新密钥」
  3) 复制那串 sk-xxx（只显示一次，请先拷贝保存）
  ※ API 按用量计费，用之前可根据需求充值一点

【第②步】加载浏览器扩展
  1) 打开 Chrome，地址栏输入 chrome://extensions 回车
  2) 打开右上角「开发者模式」
  3) 点「加载已解压的扩展程序」→ 选本压缩包解压后的这个文件夹
  4) 右上角出现插件图标即可（建议点 📌 固定）

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
      <li>打开 Chrome，地址栏输入 <code>chrome://extensions</code> 回车。</li>
      <li>打开右上角「开发者模式」。</li>
      <li>点「加载已解压的扩展程序」→ 选本压缩包解压后的这个文件夹。</li>
      <li>右上角出现插件图标即可（建议点 📌 固定）。</li>
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
    keywordMax: preset.keywordMax || 8,
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
  console.log('   定价     :', cfg.price > 0 ? ('¥' + cfg.price) : '(自用/试用不标价)');
  console.log('   灌水关键词上限 :', cfg.keywordMax, '个');
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
