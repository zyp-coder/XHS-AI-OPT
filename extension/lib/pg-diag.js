/* B档·按需加载：🧭 诊断&配置：6 个节点（基础配置[产品名称+账号类型+抓主页+昵称/同城]→问卷→人设[含说话
   从 popup.js 拆出来，popup.html 末尾的加载器在你点开这一页时才下载。 */
var DIAG_UNIFIED_QUESTIONS = DIAG_QUIZ.map(function (x) { return x.q; });
// 把已存答案拆成「命中选项的」与「剩下的原文」——原样往返，用户自己在补充里打了分号也不会丢
function _diagSplitAnswer(answer, opts) {
  const raw = String(answer == null ? '' : answer).trim();
  const list = Array.isArray(opts) ? opts : [];
  if (!raw || !list.length) return { picked: [], rest: raw };
  const picked = [], rest = [];
  raw.split('；').forEach(function (part) {
    const t = part.trim();
    if (!t) return;
    if (list.indexOf(t) >= 0 && picked.indexOf(t) < 0) picked.push(t); else rest.push(t);
  });
  return { picked: picked, rest: rest.join('；') };
}
var DIAG_KB_QUESTIONS = [
  '你的产品/服务是什么？主要帮人解决什么问题、满足什么需求？',
  '你的目标顾客是谁？他们购买前最常问、最担心、最容易踩坑的点是什么？',
  '你有哪些亲身经验或案例（做过的事、帮过谁、踩过的坑），能用来建立信任和给建议？',
  '有没有具体的数字、价格、政策或行业数据，顾客需要知道的？',
  '你最想让大家记住你的 2-3 个专业观点或干货结论是什么？',
];
var DIAG_ACCOUNT_TYPES = ['干货分享型', '测评型', '生活方式种草型', '教程/步骤型', '经验情感型', '资料整理型', '个人IP/创始人型'];
var DIAG_PLAN_QUESTIONS = [
  '你的笔记主要想讲什么内容？（可结合人设/产品卖点/知识库来定）',
  '主要写给谁看（目标人群）？他们最关心、最需要什么？',
  '一套图文你打算发几页？（不确定就写"帮我定"）',
  '你打算多久发一篇、在什么时间段发？',
];
var DIAG_SELL_QUESTIONS = [
  '你的产品/服务是什么？主要帮人解决什么问题、给谁用？',
  '相比竞品或以前的用法，它最大的 2-3 个优势或差异点是什么？',
  '有没有具体数字、效果、案例能证明它的价值？',
  '用户最可能在什么场景/需求下想起它、怎么找到你？',
  ];
function _dBtn(id, label, sub, color) {
  return '<button id="' + id + '" class="btn ' + (color || 'btn-primary') + '" style="margin-right:8px;margin-bottom:8px;">' + label + (sub ? '<span style="font-size:11px;opacity:.8;margin-left:4px;">' + sub + '</span>' : '') + '</button>';
}
async function _diagGetMyCity() {
  try {
    const cfg = await _diagGetCfg();
    const mc = cfg && cfg.myCity;
    return (mc && typeof mc === 'object') ? mc : { city: '', ipLocation: '', source: '', updatedAt: 0 };
  } catch (_) { return { city: '', ipLocation: '', source: '', updatedAt: 0 }; }
}
function _diagCard(innerHtml) { return '<div style="border:1px solid #e7eaf0;border-radius:12px;padding:14px 16px;background:#fff;box-shadow:0 1px 3px rgba(24,24,40,.05);">' + innerHtml + '</div>'; }
function _diagLabel(txt) { return '<div style="font-size:12px;color:#333;margin-bottom:4px;">' + txt + '</div>'; }
/* 节点标题行（五十二改：序号徽标已废，只留名字）：act 是可选的动作区——保存类按钮一律挂这儿（页顶），别放页尾 */
function _diagStepTitle(txt, act) {
  return '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">' +
    '<span style="font-weight:700;font-size:15px;color:#1f1f1f;flex:1;min-width:120px;">' + txt + '</span>' +
    (act ? '<span style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' + act + '</span>' : '') + '</div>';
}
async function renderDiagnosis(container) {
  container.innerHTML = [
    '<style>#diagBody .btn{min-height:34px;padding:7px 12px;font-size:12px;line-height:1.5;white-space:normal}#diagBody .btn-outline{background:#fff;color:var(--primary);border-color:#d8dee9}#diagBody .btn-outline:hover:not(:disabled){background:var(--primary-bg);border-color:var(--primary)}#diagBody button:disabled{opacity:.55;cursor:not-allowed}#diagBody input:not([type=checkbox]):not([type=file]),#diagBody textarea,#diagBody select{padding:8px 10px;border:1px solid #d8dee9;border-radius:8px;font-size:13px;line-height:1.6;background:#fff;color:#333}#diagBody textarea{resize:vertical}#diagBody input:focus-visible,#diagBody textarea:focus-visible,#diagBody button:focus-visible{outline:2px solid var(--primary);outline-offset:2px}#diagBody .diag-sync-line{font-size:12px;line-height:1.7;margin:6px 0;overflow-wrap:anywhere}#diagBody .dg-tabs{display:flex;gap:2px;border-bottom:1px solid var(--line,#eceef0)}#diagBody .dg-tab{border:0;background:none;padding:6px 12px;margin-bottom:-1px;font-size:12px;font-weight:600;color:#6b7280;cursor:pointer;border-bottom:2px solid transparent}#diagBody .dg-tab:hover{color:#374151}#diagBody .dg-tab.active{color:var(--c-brand-text,var(--xhs-red));border-bottom-color:var(--c-brand,var(--xhs-red))}#diagBody .diag-kb-input-bad{border-color:#c62828 !important;background:#fff5f5 !important}#diagBody .diag-kb-input-bad:focus-visible{outline-color:#c62828}#diagBody .diag-kb-input-warn{border-color:#b45309 !important;background:#fff8e6 !important}#diagBody .diag-kb-input-warn:focus-visible{outline-color:#b45309}#diagBody .diag-kb-cnt{font-size:11px;color:#8a929e;margin:2px 2px 0;text-align:right}#diagBody .diag-kb-cnt.warn{color:#b45309}#diagBody .diag-kb-tip{font-size:11px;color:#8a929e;margin:2px 2px 6px;line-height:1.5}#diagBody .diag-kb-tip.warn{color:#b45309}</style>',
    '<div style="padding:14px 16px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,var(--c-surface),var(--c-brand-soft));">',
    '  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">',
    '    <span style="font-weight:700;font-size:15px;color:var(--ink);flex:1;min-width:160px;">账号规划 · 一份问卷同步账号资料<span class="qhelp" tabindex="0" data-tip="左栏是一条链：先在「基础配置」填产品名称、账号类型并保存；再去「问卷」答完提交一次，AI 就把人设、卖点、知识库都生成并保存，这几页随时能查看与修改。排产表在「发笔记 → 笔记规划」页。顾客话术在「AI客服 → 任务配置」，内容基调 / 出图风格在写稿 ③ / ⑤ 就地展开，推广目标与评论区承接在「获客 → 任务配置」。">?</span></span>',
    '    <button type="button" id="diagGoNotePlan" class="btn btn-outline" style="margin:0;flex:none;" title="排产表、这周发什么、什么时候补下一批，都在「发笔记 → 笔记规划」">📒 去笔记规划</button>',
    '  </div>',
    '</div>',
    '<div id="diagBody" style="padding:14px;font-size:13px;color:#333;">正在恢复账号诊断…</div>',
  ].join('');
  const body = container.querySelector('#diagBody');
  const goPlan = container.querySelector('#diagGoNotePlan');
  if (goPlan) goPlan.onclick = function () { if (typeof switchMainTab === 'function') switchMainTab('notePlan'); };
  try {
    if (!_diagState.busy) {
      const [cfg, stored] = await Promise.all([_diagGetCfg(), chrome.storage.local.get(['note_plan', 'deep_report'])]);
      const diagnosis = cfg.diagnosis || null;
      if (!_diagState.loaded) {
        if (diagnosis) {
          _diagState.profile = diagnosis.profile || null;
          _diagState.userBio = diagnosis.bio == null ? null : String(diagnosis.bio);
          _diagState.unifiedAnswers = Array.isArray(diagnosis.answers) ? diagnosis.answers : [];
          _diagState.accountType = diagnosis.accountType || '';
          // 恢复诊断是异步的，期间用户可能已经点了别的节点 —— 点过就别把他拽回原节点（diagGo 里置的 pinned）
          if (!_diagState.stepPinned) _diagStep = _diagState.unifiedAnswers.length ? 3 : 1;
        }
        _diagState.loaded = true;
      }
      _diagState.diagnosis = diagnosis;
      _diagState.baseSavedAt = _diagBaseSavedAtOf(cfg);
      _diagState.scriptStyle = cfg.scriptStyle || {};
      _diagState.persona = (cfg.persona && cfg.persona.text) || _diagState.persona;
      _diagState.notePlan = stored.note_plan || null;
      _diagState.report = stored.deep_report || null;   // 跟着租户走：没有就清空，别留着上一个租户的报告
    }
    if (document.getElementById('diagBody') === body) diagGo(_diagStep, true);
  } catch (e) {
    if (document.getElementById('diagBody') !== body) return;
    body.innerHTML = '<div style="color:#c62828;">恢复诊断失败：' + _dEsc(e.message || e) + '</div>' + _dBtn('diagLoadRetry', '重新读取', '', 'btn-outline');
    body.querySelector('#diagLoadRetry').onclick = function () { renderDiagnosis(container); };
  }
}
/* 6 个节点的顺序与内部 id：按钮本体在 popup.html 的 #diagSubTabs 里（文案在那儿维护，顺序以那边为准）。
   界面上已不再显示 ①~⑨ 序号；说话风格并进了「人设」页的 tab，客服话术搬到「线索 → 任务配置」，内容基调搬到写稿 ③
   第 7 个「IP 角色」2026-10-30 从人设页的第三个横签拎出来单列：老板找不到，二级一眼看见才对；
   原第 6 项「规划」同日撤掉（排产表搬到「发笔记 → 笔记规划」） */
const DIAG_STEPS = [1, 2, 3, 7, 4, 5];
/** 基础配置「保存过」的判据：新数据看 baseSavedAt；老数据没这个字段，填过任一格或以前抓过主页就算保存过 */
function _diagBaseSavedAtOf(cfg) {
  const c = cfg || {};
  const at = Number(c.baseSavedAt || 0);
  if (at) return at;
  if (c.diagnosis && c.diagnosis.profile) return 1;
  const p = c.product || {};
  if ((Array.isArray(p.names) && p.names.length) || (p.name && p.name !== '我的产品')) return 1;
  if ((c.myAccountNames || []).length) return 1;
  if (c.myCity && (c.myCity.city || c.myCity.ipLocation)) return 1;
  if (c.diagnosis && String(c.diagnosis.accountType || '').trim()) return 1;
  return 0;
}
function _diagStepDone(t) {
  const results = (_diagState.diagnosis && _diagState.diagnosis.results) || {};
  const result = results[{ 3: 'persona', 4: 'product', 5: 'knowledge' }[t]];
  // 基础配置只要保存过就算完成；问卷提交过才算完成（还有没提交的改动就不打勾）；
  // 人设/卖点/知识库按问卷同步的结果；IP 角色建过一个就打勾
  // 规划这一项 2026-10-30 从本页撤掉（排产表搬到「发笔记 → 笔记规划」），完成圈不再跟着报告走
  if (t === 1) return !!(_diagState.baseSavedAt || _diagState.profile);
  if (t === 2) return _diagQuizSubmitted() && !_diagState.quizDirty;
  if (t === 7) return !!(typeof _npChars !== 'undefined' && _npChars && _npChars.list && _npChars.list.length);
  if (!result || result.status !== 'done' || _diagState.quizDirty) return false;
  return true;
}
// 说话风格「设置过」的判据：识别过口吻（口吻档案/口癖词/样张，任一有值即算；字数栏有默认值，撑不起这个勾）
function _diagStyleSet() {
  const s = _diagState.scriptStyle || {};
  return !!(String(s.toneProfile || '').trim() || String(s.toneMannerisms || '').trim() || String(s.personaSample || '').trim());
}
// 问卷「提交过」的判据：库里有非空答案（跟当前编辑器内容无关，页面重进也算）
function _diagQuizSubmitted() {
  const answers = (_diagState.diagnosis && _diagState.diagnosis.answers) || [];
  return answers.some(function (a) { return String((a && a.answer) || '').trim(); });
}
/* 6 个节点画在左侧栏「诊断&配置」下方的二级 tab 里（popup.html #diagSubTabs）；页面内不再有导航圈。
   完成状态只靠 .done 变绿——不再往标签里塞「✓」，免得跟行首图标叠成两个图标 */
function _diagPaintNav() {
  const nav = document.getElementById('diagSubTabs'); if (!nav) return;
  DIAG_STEPS.forEach(function (n) {
    const btn = nav.querySelector('[data-go="' + n + '"]'); if (!btn) return;
    const cur = n === _diagStep, done = _diagStepDone(n);
    btn.classList.toggle('active', cur);
    btn.classList.toggle('done', done && !cur);
    btn.disabled = !!_diagState.busy;
  });
}
/* 节点号 → 画法：值即下面那几个 diagStep* 函数（函数声明会提升，写在这儿也能引用到） */
const DIAG_VIEWS = { 1: diagStepBase, 2: diagStepQuiz, 3: diagStepPersona, 4: diagStepSell, 5: diagStepKb, 7: diagStepIpChars };
function diagGo(n, restoreView) {
  if (_diagState.busy && !restoreView) return;
  _diagStep = n;
  if (!restoreView) _diagState.stepPinned = true;   // 用户点的节点，别被恢复流程改掉
  const b = document.getElementById('diagBody'); if (!b) return;
  b.innerHTML = '<div id="diagStepBody"></div>';
  _diagPaintNav();
  const body = document.getElementById('diagStepBody');
  const draw = DIAG_VIEWS[n];
  if (typeof draw === 'function') draw(body);
}

/* ── 基础配置（产品名称 + 账号类型 + 昵称 + 同城 + 抓主页：账号与产品的基本盘）
      推广目标 & 评论区承接 2026-09-25 搬去「获客 → 任务配置 → 🎯 推广目标」（词池 / 盯人之后第三个 tab） ── */
function diagStepBase(body) {
  if (!body) return;
  body.innerHTML = '<style>' +
    '#diagStepBody .diag-s1-msg{font-size:12px;color:#777;line-height:1.7;margin:6px 0;overflow-wrap:anywhere;white-space:pre-wrap}' +
    '#diagStepBody .diag-s1-sec{border-top:1px solid #eef1f6;margin-top:14px;padding-top:12px}' +
    '#diagStepBody .diag-s1-h{font-weight:700;font-size:13px;color:#333;margin-bottom:6px}' +
    '#diagStepBody .diag-s1-sub{display:block;font-weight:400;color:#999;font-size:11px;margin-top:2px;line-height:1.5}' +
    '#diagStepBody .diag-s1-tip{font-size:11px;color:#999;margin-top:4px;line-height:1.6}' +
    '#diagStepBody .diag-s1-lab{font-size:12px;color:#333;margin:8px 0 4px}' +
    '#diagStepBody .diag-acct-chip{font-size:12px;padding:5px 10px;border:1px solid #dfe3ea;border-radius:14px;background:#f6f7f9;color:#555;cursor:pointer}' +
    '</style>' +
    _diagCard(
      _diagStepTitle('基础配置 · 账号与产品的基本盘',
        '<button type="button" id="diagS1Save" class="btn btn-primary" style="margin:0;">💾 保存基础配置</button>') +
      '<div id="diagS1Msg" role="status" class="diag-s1-msg"></div>' +
      // 产品名称 & 小红书昵称并排（2026-09-25 三十一改）：都是「你是谁」这一格里的基本盘，一行两个省半屏
      '<div class="diag-s1-sec" style="border-top:0;margin-top:6px;padding-top:0;"><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:stretch;">' +
      '<div style="flex:1 1 240px;min-width:0;display:flex;flex-direction:column;"><div class="diag-s1-h">产品名称<span class="diag-s1-sub">每行一个：第一行＝主名，后面＝别名·留空＝「我的产品」</span></div>' +
      '<textarea id="diagProdName" rows="3" placeholder="例：贷款计算器小程序／别名再占一行" style="width:100%;box-sizing:border-box;flex:1;min-height:74px;"></textarea></div>' +
      '<div style="flex:1 1 240px;min-width:0;display:flex;flex-direction:column;"><div class="diag-s1-h">我的小红书昵称<span class="diag-s1-sub">认「这条是不是我评过」</span></div>' +
      '<textarea id="diagAccountNames" rows="3" placeholder="每行一个，可填多个（含曾用昵称）" style="width:100%;box-sizing:border-box;flex:1;min-height:74px;"></textarea></div>' +
      '</div></div>' +
      '<div class="diag-s1-sec"><div class="diag-s1-h">账号类型 <span class="qhelp" tabindex="0" data-tip="规划与评估按它写；不选＝AI 判断">?</span></div>' +
      '<div id="diagAcctChips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">' +
      DIAG_ACCOUNT_TYPES.map(function (ty) {
        return '<button type="button" class="diag-acct-chip" data-v="' + _dEsc(ty) + '">' + _dEsc(ty) + '</button>';
      }).join('') + '</div>' +
      '<input id="diagAcctCustom" type="text" placeholder="其他类型可自填，留空由 AI 判断" style="width:100%;box-sizing:border-box;"></div>' +
      '<div class="diag-s1-sec"><div class="diag-s1-h">同城挡位 &amp; 城市 <span class="qhelp" tabindex="0" data-tip="对截流决策的影响：这一挡决定「读到同城的真人评论时，回不回、往不往前排」。同城就回＝不挑商机，同城一律回（含看不出需求的）；同城优先＝同城往前排，话术尽量走同城案例角度，不强制回；关闭＝属地不参与判断，不单独对同城评论。城市是比对基准：抓主页会自动读下来，也可以手填；留空＝不做同城判断。">?</span></div>' +
      '<select id="diagSameCity" style="width:100%;box-sizing:border-box;">' +
      '<option value="force">同城就回</option>' +
      '<option value="priority">同城优先</option>' +
      '<option value="off">关闭</option>' +
      '</select>' +
      '<div class="diag-s1-lab">📍 城市</div>' +
      '<div style="display:flex;gap:6px;align-items:center;">' +
      '<input id="diagCityInp" style="flex:1;box-sizing:border-box;" placeholder="城市或省份，如：深圳"></div>' +
      '<div id="diagCityHint" class="diag-s1-tip"></div></div>' +
      '<div class="diag-s1-sec"><div class="diag-s1-h">抓主页 <span class="qhelp" tabindex="0" data-tip="会把昵称、简介、发过的笔记标题和同城城市一起读下来；需已在小红书网页版登录">?</span></div>' +
      '<div id="diagS1Profile"></div></div>'
    );
  diagRenderProfile(document.getElementById('diagS1Profile'));
  const chips = document.getElementById('diagAcctChips');
  if (chips) chips.querySelectorAll('.diag-acct-chip').forEach(function (b) {
    b.onclick = function () {
      if (_diagState.busy) return;
      _diagState.accountType = b.getAttribute('data-v');
      _diagAcctPaint(_diagState.accountType);
    };
  });
  document.getElementById('diagAcctCustom')?.addEventListener('input', function (e) {
    _diagState.accountType = e.target.value.trim(); e.target.dataset.touched = '1';
    _diagAcctPaint(_diagState.accountType, true);
  });
  document.getElementById('diagS1Save')?.addEventListener('click', diagBaseSave);
  diagBasePrefill();
}
/* 账号类型 chips 上色 + 回填自填框（keepInput：用户正在打字，别抢他的光标内容） */
function _diagAcctPaint(type, keepInput) {
  const input = document.getElementById('diagAcctCustom');
  if (input && !keepInput) input.value = type || '';
  document.querySelectorAll('.diag-acct-chip').forEach(function (el) {
    const selected = el.getAttribute('data-v') === type;
    el.style.background = selected ? 'var(--xhs-red)' : '#f6f7f9';
    el.style.color = selected ? '#fff' : '#555';
    el.style.borderColor = selected ? 'var(--xhs-red)' : '#dfe3ea';
  });
}
/* 预填整页：产品名称 + 账号类型 + 昵称 + 同城挡位与城市（页顶一个 💾 全存） */
async function diagBasePrefill() {
  try {
    const cfg = await _diagGetCfg();
    const setV = function (id, v) { const el = document.getElementById(id); if (el && v != null) el.value = v; };
    setV('diagProdName', _diagProdNamesOf(cfg.product || {}).join('\n'));
    _diagState.accountType = _diagState.accountType || (cfg.diagnosis || {}).accountType || '';
    _diagAcctPaint(_diagState.accountType);
    setV('diagAccountNames', (cfg.myAccountNames || []).join('\n'));
    setV('diagSameCity', ['force', 'priority', 'off'].includes(cfg.sameCityMode) ? cfg.sameCityMode : 'priority');
    await diagCityPaint();
  } catch (_) {}
}
/* 产品名多值（五十二改）：names[] 第一个＝主名、后面＝别名；name 恒＝主名，读旧字段的地方一字不用改。
   两边一起写，免得「改了主名、别名里还留着旧主名」 */
function _diagProdNamesOf(product) {
  const p = product || {};
  const out = [];
  for (const raw of (Array.isArray(p.names) ? p.names : []).concat([p.name])) {
    const v = String(raw || '').trim();
    if (v && v !== '我的产品' && !out.includes(v)) out.push(v);
  }
  return out;
}
function _diagProdSetNames(cfg, text) {
  const arr = String(text || '').split(/[\n,，;；]/).map(function (s) { return s.trim(); }).filter(Boolean)
    .filter(function (v, i, a) { return a.indexOf(v) === i; });
  cfg.product.names = arr;
  cfg.product.name = arr[0] || '我的产品';
  return arr;
}
/* 同城城市：回填已记录的值 + 一行来源说明；抓主页成功后也重画一次（手填过的以手填为准） */
async function diagCityPaint() {
  const inp = document.getElementById('diagCityInp'); if (!inp) return;
  const mc = await _diagGetMyCity();
  const shown = mc.city || mc.ipLocation || '';
  inp.value = shown;
  inp.dataset.init = shown;   // 保存时拿它判「用户动过没」：没动过就保留抓主页记下的 source
  const hint = document.getElementById('diagCityHint'); if (!hint) return;
  const src = mc.source === 'manual' ? '你手填的' : (mc.updatedAt ? '从主页读到的' : '');
  hint.textContent = (src ? '当前：' + (mc.city || '-') + '（' + src + '）' : '还没记录城市——可手填，或点下方「抓取我的主页」读一次') +
    (mc.ipLocation ? ' · 主页 IP 属地：' + mc.ipLocation : '') +
    (!inp.value ? ' · 留空＝不做同城判断' : '');
}
/* 一次保存整页：产品名称 + 账号类型 + 昵称 + 同城挡位与城市（推广目标/承接在 获客 → 任务配置） */
async function diagBaseSave() {
  const btn = document.getElementById('diagS1Save');
  if (!btn || _diagState.busy) return;
  _diagState.busy = 's1-save'; btn.disabled = true;
  _diagMsg('diagS1Msg', '正在保存…');
  try {
    const cfg = await _diagGetCfg();
    cfg.product = cfg.product || {};
    _diagProdSetNames(cfg, ((document.getElementById('diagProdName') || {}).value || ''));
    cfg.myAccountNames = String(((document.getElementById('diagAccountNames') || {}).value || ''))
      .split(/[\n,，;；]/).map(function (s) { return s.trim(); }).filter(Boolean);
    const scm = ((document.getElementById('diagSameCity') || {}).value || '');
    if (['force', 'priority', 'off'].includes(scm)) cfg.sameCityMode = scm;
    // 城市：只有手填改动过才写（没动过就保留抓主页记下的 auto 值和 IP 属地）
    let cityNote = '';
    const cityInp = document.getElementById('diagCityInp');
    if (cityInp) {
      const val = String(cityInp.value || '').trim();
      if (val !== String(cityInp.dataset.init || '')) {
        const old = (cfg.myCity && typeof cfg.myCity === 'object') ? cfg.myCity : {};
        cfg.myCity = { city: val, ipLocation: old.ipLocation || '', source: 'manual', updatedAt: Date.now() };
        cityInp.dataset.init = val;
        cityNote = val ? ('同城城市记为你手填的「' + val + '」') : '同城城市已清空（不再做同城判断）';
      }
    }
    cfg.baseSavedAt = Date.now();
    const type = ((document.getElementById('diagAcctCustom') || {}).value || '').trim();
    cfg.diagnosis = cfg.diagnosis || {};
    const oldType = String(cfg.diagnosis.accountType || '');
    let planDropped = false;
    if (type !== oldType) {
      cfg.diagnosis.accountType = type;
      // 类型换了，规划就是按旧类型写的：清掉完成标记，催一次重新生成
      if (cfg.diagnosis.results && cfg.diagnosis.results.plan) { delete cfg.diagnosis.results.plan; planDropped = true; }
    }
    await _diagSaveCfg(cfg);
    _diagState.accountType = type;
    _diagState.baseSavedAt = cfg.baseSavedAt;
    _diagState.diagnosis = cfg.diagnosis;   // 类型换了会清掉规划标记，导航圈要立刻跟上
    _diagMsg('diagS1Msg', '✅ 已保存：基础配置已写回账号资料。'
      + (cityNote ? cityNote + '。' : '') + (planDropped ? '账号类型变了，规划要重新生成。' : ''));
    await diagCityPaint();   // 城市那行的来源说明跟着变（手填 / 清空）
  } catch (e) {
    _diagMsg('diagS1Msg', '❌ 保存失败：' + (e.message || e) + '，可重试。', true);
  } finally {
    _diagState.busy = ''; btn.disabled = false;
    _diagPaintNav();   // busy 清掉之后再画，否则左栏 tab 会一直卡在禁用态
  }
}
async function diagFetchProfile() {
  const msg = document.getElementById('diagFetchMsg'); const btn = document.getElementById('diagFetchBtn');
  if (!btn || _diagState.busy) return;
  _diagState.busy = 'fetch'; btn.disabled = true; btn.textContent = '正在抓取本人主页…'; if (msg) msg.textContent = '正在打开/读取，请稍候…';
  try {
    const r = await _diagSay('extractOwnProfile');
    if (!r || !r.ok || !r.profile) throw new Error((r && (r.reason || r.error)) || '抓取失败');
    	_diagState.profile = r.profile;
    // ★ 同城城市：把主页读到的城市/IP 属地记进配置（供评论助手做「同城」判定）；
    //   手填过的以手填为准，抓取不覆盖；主页上读不到就不动已有值
    try {
      const mc = await _diagGetMyCity();
      const city = String(r.profile.city || '').trim();
      const ip = String(r.profile.ipLocation || '').trim();
      if ((city || ip) && mc.source !== 'manual') {
        const cfg = await _diagGetCfg();
        cfg.myCity = { city: city || ip, ipLocation: ip, source: 'auto', updatedAt: Date.now() };
        await _diagSaveCfg(cfg);
        addLog('📍 同城城市已记录：' + (city || ip) + (ip ? ('（主页 IP 属地：' + ip + '）') : ''), 'info');
      } else if (!city && !ip) {
        addLog('📍 主页上没读到城市/属地，可在本页手填（评论助手「同城」判定用）', 'warn');
      }
    } catch (_) {}

    // ★ 防重复灌水：默认用抓到的号主个人身份（昵称优先，其次小红书号）兜底
    try {
      const cfg = await _diagGetCfg();
      const names = (cfg.myAccountNames && cfg.myAccountNames.length) ? cfg.myAccountNames : [];
      const acc = (r.profile.name || '').trim() || (r.profile.xhsId || '').trim();
      if (acc && !names.some(function (n) { return !n || n === acc; })) {
        if (names.length) names.push(acc); else names.push(acc);
        cfg.myAccountNames = names;
        await _diagSaveCfg(cfg);
      }
    } catch (_) {}
    // 抓完只重画主页区：基础配置的状态变了，_diagPaintNav 会跟着改完成圈；城市那行也顺手刷一次
    const ps = document.getElementById('diagS1Profile'); if (ps) diagRenderProfile(ps);
    await diagCityPaint();
  } catch (e) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '❌ 抓取失败：' + (e.message || e); } }
  finally {
    _diagState.busy = ''; btn.disabled = false; btn.textContent = '抓取我的主页';
    _diagPaintNav();   // 抓到主页这一页就算完成
  }
}
function diagRenderProfile(section) {
  if (!section) return;
  if (!_diagState.profile) {
    section.innerHTML = _dBtn('diagFetchBtn', '抓取我的主页', '(需已登录小红书)') + '<span id="diagFetchMsg" style="font-size:12px;color:#0a7b5a;"></span>';
    document.getElementById('diagFetchBtn')?.addEventListener('click', diagFetchProfile);
    return;
  }
  const p = _diagState.profile || {};
  const notes = (p.notes || []).map(function (n, i) { return (i + 1) + '. ' + (n.title || '（未命名）'); }).join('\n');
  const stat = function (v, l) { return '<div style="text-align:center;flex:1;"><div style="font-weight:700;font-size:15px;">' + _dEsc(v || '-') + '</div><div style="font-size:11px;color:#999;">' + l + '</div></div>'; };
  section.innerHTML = _diagCard(
    '<div style="display:flex;gap:12px;align-items:center;">' +
    '<div style="width:52px;height:52px;border-radius:50%;background:#f0f0f0;display:flex;align-items:center;justify-content:center;font-size:24px;flex:none;">👤</div>' +
    '<div style="flex:1;min-width:0;"><div style="font-weight:600;font-size:15px;">' + _dEsc(p.name || '未命名') + '</div>' +
    '<div style="font-size:11px;color:#999;">小红书号：' + _dEsc(p.xhsId || '-') + '</div>' +
    '<div style="font-size:12px;color:#666;margin-top:2px;white-space:pre-wrap;word-break:break-word;">' + _dEsc(p.desc || '（暂无简介）') + '</div></div></div>' +
    '<div style="display:flex;margin:10px 0 4px;">' + stat(p.fans, '粉丝') + stat(p.follows, '关注') + stat(p.likes, '获赞') + '</div>'
  ) + '<div style="margin-top:12px;border:1px solid #eee;border-radius:8px;padding:10px;background:#fafbfc;"><b style="font-size:13px;">发过的笔记 (' + (p.notes || []).length + ')</b><div style="white-space:pre-wrap;font-size:12px;color:#555;margin-top:4px;">' + _dEsc(notes || '（未读到）') + '</div></div>' +
'<div style="margin-top:14px;">' + _dBtn('diagRefetchBtn', '重新抓取', '', 'btn-outline') + '<span id="diagFetchMsg" style="font-size:12px;color:#0a7b5a;"></span></div>';
  document.getElementById('diagRefetchBtn')?.addEventListener('click', function () { _diagState.profile = null; diagGo(1); });
}

/* ── 说话风格（答 3 个问题 → AI 认出你的口吻；AI 写评论、私信时按这个走，少点 AI 味） ── */
const TONE_QUESTIONS = [
  { q: '随便写几句你平时会发的话', hint: '想到啥写啥，就当刷到一条同行的笔记、顺手回了一句的那种' },
  { q: '你跟人聊天、回私信是什么调性？', hint: '爱开玩笑还是正经讲干货、先共情还是直接给建议；有没有常挂在嘴边的话' },
  { q: '哪种腔调你一看就烦？', hint: '比如「亲」「宝子」、客服腔、老师腔、喊口号——识别时 AI 会避开这些' },
];
function _diagToneResultHtml(s) {
  const profile = String(s.toneProfile || '').trim();
  if (!profile) {
    return '<div style="font-size:11px;color:#999;line-height:1.7;">还没识别过口吻——答完上面 3 个问题，点「🧠 识别我的口吻」，AI 会把你的语感画像和口癖词存下来，往后写评论、私信都照着用。</div>';
  }
  const mz = String(s.toneMannerisms || '').trim();
  const samples = String(s.personaSample || '').trim();
  return '<div style="border:1px solid #e7eaf0;background:#f9fafb;border-radius:10px;padding:10px 12px;">' +
    '<div style="font-size:12px;font-weight:600;color:#1f2937;margin-bottom:4px;">我识别到的口吻</div>' +
    '<div style="font-size:12px;line-height:1.8;color:#333;white-space:pre-wrap;word-break:break-word;">' + _dEsc(profile) + '</div>' +
    (mz ? '<div style="font-size:11px;color:#888;margin-top:6px;white-space:pre-wrap;word-break:break-word;">口癖词：' + _dEsc(mz) + '</div>' : '') +
    (samples ? '<div style="font-size:11px;color:#888;margin-top:4px;line-height:1.7;white-space:pre-wrap;word-break:break-word;">仿写的评论样张：\n' + _dEsc(samples) + '</div>' : '') +
    '</div>';
}
function diagStepStyle(body) {
  if (!body) return;
  body.innerHTML = _diagCard(
    _diagStepTitle('说话风格 · 少点 AI 味 <span class="qhelp" tabindex="0" data-tip="答下面 3 个问题，点「🧠 识别我的口吻」，AI 会把你的语感画像和口癖词存下来，往后写评论、私信都照着用；不满意就改改回答再识别一次，口吻变了也回来重新识别。">?</span>',
      '<button type="button" id="diagToneRun" class="btn btn-primary" style="margin:0;">🧠 识别我的口吻</button>' +
      '<button type="button" id="diagStyleSave" class="btn btn-outline" style="margin:0;">💾 保存</button>') +
    '<div id="diagStyleMsg" role="status" style="font-size:12px;color:#0a7b5a;margin:6px 0;"></div>' +
    _diagLabel('AI 话术字数（评论 / 私信，超 300 字小红书发不出去）<span class="qhelp" tabindex="0" data-tip="AI 写的评论、私信、四个渠道话术都按这个范围；四个渠道基调那边只是只读显示这个值，改只改这里。">?</span>') +
    '<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">最少 <input id="diagMinC" type="number" min="20" max="500" step="10" style="width:70px;"> 最多 <input id="diagMaxC" type="number" min="50" max="500" step="10" style="width:70px;"></div>' +
    '<div style="font-size:12px;color:#333;margin-bottom:8px;">用大白话答这 3 个问题，AI 照着你的原话认口吻：</div>' +
    TONE_QUESTIONS.map(function (item, i) {
      return '<div style="margin-bottom:10px;">' +
        '<div style="font-size:12px;color:#333;margin-bottom:4px;">' + (i + 1) + '. ' + _dEsc(item.q) + '</div>' +
        '<textarea id="diagTq' + i + '" rows="2" placeholder="' + _dEsc(item.hint) + '" style="width:100%;box-sizing:border-box;"></textarea>' +
        '</div>';
    }).join('') +
    '<div id="diagToneResult" style="margin-top:2px;"></div>'
  );
  document.getElementById('diagToneRun')?.addEventListener('click', diagToneRun);
  document.getElementById('diagStyleSave')?.addEventListener('click', diagStyleSave);
  diagStylePrefill();
}
async function diagStylePrefill() {
  try {
    const cfg = await _diagGetCfg();
    const s = cfg.scriptStyle || {};
    _diagState.scriptStyle = s;
    const setV = function (id, v) { const el = document.getElementById(id); if (el && v != null) el.value = v; };
    setV('diagMinC', s.purposeMinChars); setV('diagMaxC', s.purposeMaxChars);
    const ans = Array.isArray(s.toneAnswers) ? s.toneAnswers : [];
    TONE_QUESTIONS.forEach(function (_, i) { setV('diagTq' + i, String(ans[i] || '')); });
    const box = document.getElementById('diagToneResult');
    if (box) box.innerHTML = _diagToneResultHtml(s);
  } catch (_) {}
}
function _diagToneAnswersFromPage() {
  return TONE_QUESTIONS.map(function (item, i) {
    return { q: item.q, answer: String(((document.getElementById('diagTq' + i) || {}).value) || '').trim() };
  });
}
async function diagStyleSave() {
  const btn = document.getElementById('diagStyleSave');
  if (!btn || _diagState.busy) return;
  _diagState.busy = 's6-save'; btn.disabled = true;
  _diagMsg('diagStyleMsg', '正在保存…');
  try {
    const cfg = await _diagGetCfg();
    cfg.scriptStyle = cfg.scriptStyle || {};
    cfg.scriptStyle.purposeMinChars = parseInt((document.getElementById('diagMinC') || {}).value, 10) || 100;
    cfg.scriptStyle.purposeMaxChars = parseInt((document.getElementById('diagMaxC') || {}).value, 10) || 300;
    cfg.scriptStyle.toneAnswers = _diagToneAnswersFromPage().map(function (a) { return a.answer; });
    await _diagSaveCfg(cfg);
    _diagState.scriptStyle = cfg.scriptStyle;
    _diagMsg('diagStyleMsg', '✅ 已保存（回答也一起存了，随时回来接着改）。');
  } catch (e) {
    _diagMsg('diagStyleMsg', '❌ 保存失败：' + (e.message || e) + '，可重试。', true);
  } finally {
    _diagState.busy = ''; btn.disabled = false;
    _diagPaintNav();
  }
}
/* 3 问回答 → AI 认口吻：口吻档案 + 口癖词 + 3 条仿写样张，连同字数一起落盘 */
async function diagToneRun() {
  const btn = document.getElementById('diagToneRun');
  if (!btn || _diagState.busy) return;
  const answers = _diagToneAnswersFromPage();
  if (answers.filter(function (a) { return a.answer; }).length < 2) {
    _diagMsg('diagStyleMsg', '先答 2 个以上问题（随便写几句就行），AI 才认得出你的口吻。', true);
    return;
  }
  _diagState.busy = 's6-tone'; btn.disabled = true; _diagPaintNav();
  _diagMsg('diagStyleMsg', '正在读你的回答、认口吻…');
  try {
    const r = await _diagSay('aiToneProfile', { answers: answers });
    if (!r || !r.ok || !r.toneProfile) throw new Error((r && r.error) || 'AI 没返回内容，请重试');
    const cfg = await _diagGetCfg();
    cfg.scriptStyle = cfg.scriptStyle || {};
    cfg.scriptStyle.purposeMinChars = parseInt((document.getElementById('diagMinC') || {}).value, 10) || 100;
    cfg.scriptStyle.purposeMaxChars = parseInt((document.getElementById('diagMaxC') || {}).value, 10) || 300;
    cfg.scriptStyle.toneAnswers = answers.map(function (a) { return a.answer; });
    cfg.scriptStyle.toneProfile = r.toneProfile;
    cfg.scriptStyle.toneMannerisms = r.toneMannerisms || '';
    cfg.scriptStyle.personaSample = r.personaSample || '';
    await _diagSaveCfg(cfg);
    _diagState.scriptStyle = cfg.scriptStyle;
    const box = document.getElementById('diagToneResult');
    if (box) box.innerHTML = _diagToneResultHtml(cfg.scriptStyle);
    _diagMsg('diagStyleMsg', '✅ 口吻已识别并保存，写评论和私信时都按它来。');
  } catch (e) {
    _diagMsg('diagStyleMsg', '❌ 识别失败：' + (e.message || e) + '，可重试。', true);
  } finally {
    _diagState.busy = ''; btn.disabled = false;
    _diagPaintNav();
  }
}
/* 各节点顶部只读的同步状态：只给一句话，不挂跳转按钮——问卷是唯一生成口，左栏「问卷」随时可点。
   tail＝同一行末尾补的短状态（如卖点的条数）；emptyText 传 '' 表示这一节点没内容时整行不显示 */
function _diagSyncLine(key, emptyText, tail) {
  const results = (_diagState.diagnosis && _diagState.diagnosis.results) || {};
  const result = results[key];
  const dirty = !!_diagState.quizDirty;
  let text, color = '#667085';
  if (_diagState.busy === 'sync') {
    text = '正在随问卷同步账号资料，请稍候…';
  } else if (result && result.status === 'error') {
    text = '⚠️ 上次同步失败' + (result.message ? '：' + result.message : '') + '——回左侧栏「问卷」重新提交即可补生成。';
    color = '#c62828';
  } else if (result && result.status === 'done') {
    if (dirty) { text = '问卷有改动还没提交；这里显示的是上次同步的内容。'; }
    else { text = '✅ 已随问卷自动生成并保存' + (result.message ? '：' + result.message : ''); color = '#0a7b5a'; }
  } else {
    if (emptyText === '') return '';   // 这一节点没内容时不摆说明（页顶已有的状态行说了）
    text = emptyText || '还没有内容——左侧栏「问卷」答完提交会自动生成并保存。';
  }
  return '<div class="diag-sync-line" style="color:' + color + ';">' + _dEsc(text) +
    (tail ? '<span style="color:#98a2b3;">　·　' + _dEsc(tail) + '</span>' : '') + '</div>';
}
/* 账号简介：以抓主页读到的本人简介为准；没抓过就沿用上次存的（问卷里不再放简介输入框） */
function _diagBio() {
  const desc = String((_diagState.profile || {}).desc || '').trim();
  if (desc) return desc;
  const saved = _diagState.userBio != null ? String(_diagState.userBio) : ((_diagState.diagnosis && _diagState.diagnosis.bio) || '');
  return String(saved || '').trim();
}
/* 「从问卷同步」的共用件：取问卷答案（没填过就只提示，不给跳转按钮——左侧栏「问卷」一直在） */
function _diagQuizAnswers() {
  const src = (_diagState.unifiedAnswers && _diagState.unifiedAnswers.length)
    ? _diagState.unifiedAnswers
    : ((_diagState.diagnosis && _diagState.diagnosis.answers) || []);
  const list = src.map(function (a, i) { return { q: a.q || DIAG_UNIFIED_QUESTIONS[i], answer: String(a.answer || '').trim() }; });
  return list.some(function (a) { return a.answer; }) ? list : null;
}
function _diagSyncNoQuiz(msg, emptyText) {
  if (msg) { msg.style.color = '#c62828'; msg.textContent = emptyText || '还没填过问卷——左侧栏「问卷」答完提交后，这里就能同步了。'; }
}
/* 只重生成并标记这一项，其余三项不动（区别于提交问卷的全量同步）；mutate 可在同一次写盘里顺带改配置 */
async function _diagMarkNode(key, message, mutate) {
  const cfg = await _diagGetCfg();
  if (mutate) mutate(cfg);
  cfg.diagnosis = cfg.diagnosis || {};
  cfg.diagnosis.results = cfg.diagnosis.results || {};
  cfg.diagnosis.results[key] = { status: 'done', message: message };
  cfg.diagnosis.updatedAt = Date.now();
  await _diagSaveCfg(cfg);
  _diagState.diagnosis = cfg.diagnosis;
}
function _diagRefreshQuizStatus() {
  const busy = _diagState.busy === 'sync';
  const msg = document.getElementById('diagQuizMsg');
  if (msg) {
    msg.textContent = busy ? '正在依次同步人设、卖点、知识库、规划；请保持页面打开，暂不能切换步骤。' : _diagState.syncMessage;
    msg.style.color = '#555';
  }
  const btn = document.getElementById('diagQuizNext');
  if (btn) { btn.disabled = busy; btn.textContent = busy ? '正在同步账号资料…' : '保存问卷并同步账号资料'; }
  document.querySelectorAll('.diagQuiz_Q').forEach(function (el) { el.disabled = busy; });
  document.querySelectorAll('.diagQuiz_chip').forEach(function (el) { el.disabled = busy; el.style.opacity = busy ? '.5' : ''; el.style.pointerEvents = busy ? 'none' : ''; });
  _diagPaintNav();
}
/* ── 问卷（唯一生成口；不依赖抓主页，随时可填） ── */
function diagStepQuiz(body) {
  if (!body) return;
  body.innerHTML = _diagCard(
    _diagStepTitle('问卷 · 13 题一次问清',
      '<button type="button" id="diagQuizNext" class="btn btn-primary" style="margin:0;">保存问卷并同步账号资料</button>') +
    '<div id="diagQuizMsg" role="status" style="font-size:12px;margin:8px 0;white-space:pre-wrap;"></div>' +
    '<div style="font-size:12px;color:#888;margin:4px 0;">能点的先点，想补再补一句。提交一次＝生成并保存人设、卖点、知识库、规划；改了再提交，只补没成的项。</div>' +
    '<div id="diagQuiz_Qs" style="margin-top:6px;"></div>'
  );
  const saved = _diagState.unifiedAnswers || [];
  body.querySelector('#diagQuiz_Qs').innerHTML = DIAG_QUIZ.map(function (item, i) {
    const hit = saved.find(function (a) { return a && a.q === item.q; }) || saved[i] || {};
    const sp = _diagSplitAnswer(hit.answer || '', item.opts);
    const head = item.group ? '<div style="font-size:12px;font-weight:600;color:#333;margin:14px 0 8px;padding-left:8px;border-left:3px solid var(--c-brand);">' + _dEsc(item.group) + '</div>' : '';
    const chips = (item.opts || []).map(function (o) {
      const on = sp.picked.indexOf(o) >= 0;
      return '<button type="button" class="diagQuiz_chip' + (on ? ' on' : '') + '" data-i="' + i + '" data-opt="' + _dEsc(o) + '"' +
        ' style="display:inline-block;padding:3px 10px;margin:0 6px 6px 0;font-size:12px;line-height:18px;border-radius:14px;cursor:pointer;' +
        (on ? 'border:1px solid var(--c-brand);color:var(--c-brand-text);background:var(--c-brand-soft);font-weight:600;' : 'border:1px solid #ddd;color:#444;background:#fff;') + '">' + _dEsc(o) + '</button>';
    }).join('');
    const tag = item.opts ? '<span style="font-weight:400;color:#999;margin-left:6px;">' + (item.multi ? '可多选' : '选一个') + '</span>' : '';
    const hint = item.hint ? '<div style="font-size:11px;color:#999;margin:2px 0 4px;">' + _dEsc(item.hint) + '</div>' : '';
    return '<div style="margin-bottom:10px;"><label for="diagQuizQ' + i + '" style="font-size:12px;">Q' + (i + 1) + '. ' + _dEsc(item.q) + tag + '</label>' +
      (chips ? '<div style="margin:6px 0 2px;">' + chips + '</div>' : '') + hint +
      '<textarea id="diagQuizQ' + i + '" class="diagQuiz_Q" data-i="' + i + '" rows="2" style="width:100%;box-sizing:border-box;" placeholder="' + (item.opts ? '补充说明（可不填）' : '你的回答…') + '">' + _dEsc(sp.rest) + '</textarea></div>';
  }).join('');
  body.querySelectorAll('.diagQuiz_Q').forEach(function (el) {
    el.addEventListener('input', function () { _diagCaptureQuiz(); _diagState.quizDirty = true; _diagState.syncMessage = '修改尚未提交，请保存问卷并同步。'; _diagRefreshQuizStatus(); });
  });
  body.querySelectorAll('.diagQuiz_chip').forEach(function (el) {
    el.addEventListener('click', function () {
      const i = el.getAttribute('data-i');
      const item = DIAG_QUIZ[Number(i)] || {};
      if (item.multi) {
        _diagPaintChip(el, !el.classList.contains('on'));
      } else {
        const wasOn = el.classList.contains('on');
        body.querySelectorAll('.diagQuiz_chip[data-i="' + i + '"]').forEach(function (o) { _diagPaintChip(o, false); });
        _diagPaintChip(el, !wasOn);
      }
      _diagCaptureQuiz();
      _diagState.quizDirty = true;
      _diagState.syncMessage = '修改尚未提交，请保存问卷并同步。';
      _diagRefreshQuizStatus();
    });
  });
  body.querySelector('#diagQuizNext').addEventListener('click', diagQuizSync);
  _diagRefreshQuizStatus();
}
function _diagPaintChip(el, on) {
  if (!el) return;
  el.classList.toggle('on', !!on);
  el.style.border = on ? '1px solid var(--c-brand)' : '1px solid #ddd';
  el.style.color = on ? 'var(--c-brand-text)' : '#444';
  el.style.background = on ? 'var(--c-brand-soft)' : '#fff';
  el.style.fontWeight = on ? '600' : '400';
}
function _diagCaptureQuiz() {
  _diagState.unifiedAnswers = DIAG_QUIZ.map(function (item, i) {
    const ta = document.getElementById('diagQuizQ' + i);
    const picked = Array.from(document.querySelectorAll('.diagQuiz_chip.on[data-i="' + i + '"]')).map(function (b) { return b.getAttribute('data-opt'); });
    const rest = String(ta && ta.value || '').trim();
    return { q: item.q, answer: picked.concat(rest ? [rest] : []).join('；') };
  });
}
async function diagQuizSync() {
  if (_diagState.busy) return;
  _diagCaptureQuiz();
  const answers = _diagState.unifiedAnswers.map(function (a, i) { return { q: a.q || DIAG_UNIFIED_QUESTIONS[i], answer: String(a.answer || '').trim() }; });
  if (!answers.some(function (a) { return a.answer; })) {
    _diagState.syncMessage = '请至少填写一题后再提交。';
    _diagRefreshQuizStatus();
    return;
  }
  _diagState.busy = 'sync';
  _diagRefreshQuizStatus();
  try {
    const r = await _diagSay('aiDiagnosisSync', { profile: _diagState.profile, bio: _diagBio(), answers: answers, accountType: _diagState.accountType || '' });
    if (r && r.diagnosis) { _diagState.diagnosis = r.diagnosis; _diagState.accountType = r.diagnosis.accountType || ''; _diagState.quizDirty = false; }
    if (r && r.persona && r.persona.text) _diagState.persona = r.persona.text;
    if (r && r.plan) _diagState.notePlan = r.plan;
    if (!r || !r.ok) throw new Error((r && r.error) || '同步未完成');
    if (r.complete) {
      _diagState.syncMessage = '问卷已保存，人设、产品卖点、知识库、排产表都已生成。人设 / 卖点 / 知识库在本页逐项看，排产表在「发笔记 → 笔记规划」。';
      // 答完诊断顺手配素材（两签改版 2026-10-15）：判这 18 类该不该有料 → 集合归类 → 用/停用；不拦在这儿等它，配完弹一条
      npAsConfigKinds(null, {}).catch(function () {});
    } else {
      const failed = [['persona', '人设'], ['product', '产品卖点'], ['knowledge', '知识库'], ['plan', '排产表']].filter(function (it) {
        const res = r.diagnosis && r.diagnosis.results && r.diagnosis.results[it[0]];
        return !res || res.status !== 'done';
      }).map(function (it) {
        const res = (r.diagnosis.results || {})[it[0]] || {};
        return it[1] + '：' + (res.message || '未完成');
      });
      _diagState.syncMessage = '问卷与成功项已保存，还有 ' + failed.length + ' 项没成，处理后再提交同一份问卷，只补失败项：\n· ' + failed.join('\n· ');
    }
  } catch (e) {
    try {
      const cfg = await _diagGetCfg();
      if (cfg.diagnosis) _diagState.diagnosis = cfg.diagnosis;
    } catch (_) {}
    _diagState.syncMessage = '同步未完成：' + (e.message || e) + '。回答仍保留，已成功的结果不会清空，可再次提交补齐。';
  } finally {
    _diagState.busy = '';
    _diagRefreshQuizStatus();
  }
}

/* ── 人设（五十二改：这一页内两个横 tab —— 👤 人设 / 🗣 说话风格）
      老板口径：「🔄 从问卷同步那颗按钮好奇怪，这个按钮应该不要了——它是回复完问卷就要自己带上的」
      「还未随问卷同步过的提示也不要了」「保存的按钮就直接叫保存」。
      所以：同步按钮与同步状态行整块撤（提交问卷时 aiDiagnosisSync 一次把 人设/卖点/知识库/规划 都生成），
      没答过问卷只在人设输入框的 placeholder 里提示先去答问卷；原「说话风格」那一节点搬进来当第二个 tab。 ── */
let _diagPersonaSec = 'persona';
function diagStepPersona(body) {
  if (!body) return;
  body.innerHTML = '<div class="dg-tabs" id="diagPersonaTabs">' +
    '<button type="button" class="dg-tab" data-sec="persona">👤 人设</button>' +
    '<button type="button" class="dg-tab" data-sec="style">🗣 说话风格</button>' +
    '</div><div id="diagPersonaSec" style="margin-top:10px;"></div>';
  document.getElementById('diagPersonaTabs')?.addEventListener('click', function (e) {
    const b = e.target.closest('[data-sec]');
    if (!b || b.getAttribute('data-sec') === _diagPersonaSec) return;
    _diagPersonaSec = b.getAttribute('data-sec');
    _diagPaintPersonaSec();
  });
  _diagPaintPersonaSec();
}
function _diagPaintPersonaSec() {
  const sec = document.getElementById('diagPersonaSec'); if (!sec) return;
  document.querySelectorAll('#diagPersonaTabs .dg-tab').forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-sec') === _diagPersonaSec);
  });
  if (_diagPersonaSec === 'style') { diagStepStyle(sec); return; }
  const asked = !!_diagQuizAnswers();
  sec.innerHTML = _diagCard(
    _diagStepTitle('人设 · 立住"你是谁"',
      '<button type="button" id="diagPEditSave" class="btn btn-primary" style="margin:0;">💾 保存</button>') +
    '<div id="diagPEditMsg" role="status" style="font-size:12px;color:#0a7b5a;margin:6px 0;"></div>' +
    '<div id="diagPStatus" style="font-size:12px;color:#666;margin:6px 0;"></div>' +
    '<div id="diagPCard"></div>' +
    '<textarea id="diagPEdit" rows="6" style="width:100%;box-sizing:border-box;white-space:pre-wrap;" placeholder="' +
      (asked ? '你的人设正文会出现在这里，可编辑…'
             : '还没答过问卷——先去左栏「问卷」答完提交一次，AI 会按你的回答自动带出人设；也可以直接在这里自己写一段。') +
    '"></textarea>'
  );
  document.getElementById('diagPEditSave')?.addEventListener('click', diagPersonaEditSave);
  document.getElementById('diagPEdit')?.addEventListener('input', function (e) { e.target.dataset.touched = '1'; });
  diagPersonaStatus();
}
async function diagPersonaStatus() {
  const st = document.getElementById('diagPStatus'); const edit = document.getElementById('diagPEdit');
  const cardBox = document.getElementById('diagPCard');
  try {
    const r = await _diagSay('getPersona'); const p = (r && r.persona) || null;
    if (!p || !p.text) { if (st) st.textContent = _diagQuizAnswers() ? '还没有已保存的人设——去左栏「问卷」再提交一次会自动生成，也可以直接在下面写并保存。' : ''; if (cardBox) cardBox.innerHTML = ''; return; }
    _diagState.persona = p.text;
    if (st) st.innerHTML = '✅ 已有保存的人设（' + (p.updatedAt ? new Date(p.updatedAt).toLocaleString('zh-CN') : '') + '）';
    if (cardBox) cardBox.innerHTML = p.card ? _diagPersonaCardHtml(p.card) : '';
    if (edit && !edit.dataset.touched) edit.value = p.text;
  } catch (_) {}
}
// 人设卡（结构化）：AI 从问卷提炼的字段，规划与写稿按这些字段约束，不再只靠一段正文
function _diagPersonaCardHtml(card) {
  const rows = [['identity', '身份'], ['proof', '凭据'], ['story', '来路'], ['stance', '立场'], ['catchphrase', '口头禅'], ['taboo', '雷区'], ['address', '称呼']];
  const items = rows.filter(function (r) { return String((card || {})[r[0]] || '').trim(); });
  if (!items.length) return '';
  return '<div style="margin:8px 0;padding:8px 10px;background:#f8fafd;border:1px solid #e5e8ee;border-radius:8px;font-size:12px;line-height:1.8;">' +
    '<div style="font-weight:700;">🧩 人设卡<span style="font-weight:400;color:#888;font-size:11px;margin-left:6px;">AI 从问卷提炼，规划与写稿都按它约束</span></div>' +
    items.map(function (r) { return '<div><span style="color:#888;">' + r[1] + '：</span>' + _dEsc(card[r[0]]) + '</div>'; }).join('') +
    '</div>';
}
async function diagPersonaEditSave() {
  const btn = document.getElementById('diagPEditSave'); const msg = document.getElementById('diagPEditMsg');
  const edit = document.getElementById('diagPEdit');
  if (!btn) return; const text = (edit && edit.value) ? edit.value.trim() : '';
  if (!text) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '人设内容不能为空'; } return; }
  btn.disabled = true; if (msg) msg.textContent = '';
  try {
    // 手改的只是正文：把已有的卡 / 封面短语 / 问卷答案原样带上，别一次保存把结构化信息抹掉
    let prev = {};
    try { const cur = await _diagSay('getPersona'); prev = (cur && cur.persona) || {}; } catch (_) {}
    const persona = Object.assign({}, prev, { text: text, bio: _diagState.profile ? _diagState.profile.desc : prev.bio, updatedAt: Date.now() });
    const saved = await _diagSay('setPersona', { persona: persona });
    if (!saved || !saved.ok) throw new Error('保存失败');
    _diagState.persona = text; if (edit) edit.dataset.touched = '';
    if (msg) { msg.style.color = '#0a7b5a'; msg.textContent = '✅ 已保存修改后的人设。'; }
  } catch (e) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '❌ ' + (e.message || e); } }
  finally { btn.disabled = false; }
}
/* ── 🎭 IP 角色（2026-10-30）
      一个账号可以建多个角色卡：写稿 ⑤ 出图的每一张、视频分镜都按同一个人的脸 / 发型 / 衣服 / 标志物来写，
      一篇文章在 ⑤ 里能换人。定妆图不限次数、不扣出图额度（老板 2026-10-30 定），只算全站当日总量。
      数据真源＝config.ipChars（popup.js 里 npCharsLoad / npCharsSave 管读写，这里只管画）。 ── */
let _ipcEditId = '';    // 弹窗里在编的角色 id（''＝新建）
let _ipcBusy = '';      // 正在出图 / 传图的角色 id
let _ipcPasteId = '';   // 点过照片的卡：复制图片后按 Ctrl+V 就换到这张上
function _ipcSay(text, color) {
  const m = document.getElementById('ipcMsg');
  if (!m) return;
  m.style.color = color || '#0a7b5a';
  m.textContent = text || '';
}
function diagStepIpChars(body) {
  if (!body) return;
  // 演示号只读：建角色的两颗钮干脆不摆（摆了也点不动，还留个清不掉的假待办）
  const demo = !!window.__xhsDemoAccount;
  body.innerHTML = _diagCard(
    _diagStepTitle('IP 角色 · 照片和视频里反复出现的这个人',
      demo ? '' :
      '<button type="button" class="btn btn-outline" id="ipcNew">➕ 自己填一个</button>' +
      '<button type="button" class="btn btn-primary" id="ipcAi">🎲 AI 帮我编一个</button>') +
    '<div style="font-size:12px;color:#6b7280;line-height:1.7;margin:2px 0 8px;">' +
      (demo
        ? '演示号里不能建角色。开自己的号后：建一张角色卡、出一张正面定妆照，写稿 ⑤ 出图和视频分镜就都按这同一个人的脸、发型、衣服和标志物去写。'
        : '建一张角色卡、说清这个人长什么样，写稿 ⑤ 出图的每一张和视频分镜就都按同一个人的脸、发型、衣服和标志物去写；一篇文章可以在 ⑤ 里换人。' +
          '一个角色一张定妆照就够，不扣出图额度；风格不满意随时换，换了再点一下重出。') + '</div>' +
    '<div id="ipcMsg" role="status" style="font-size:12px;color:#0a7b5a;margin:6px 0;"></div>' +
    '<div id="ipcList"></div>'
  );
  document.getElementById('ipcNew')?.addEventListener('click', function () { _ipcOpenEdit(null); });
  document.getElementById('ipcAi')?.addEventListener('click', _ipcAiBuild);
  document.getElementById('ipcList')?.addEventListener('click', _ipcListClick);
  document.getElementById('ipcList')?.addEventListener('change', _ipcStyleChange);
  if (!window.__ipcPasteBound) {
    window.__ipcPasteBound = true;
    document.addEventListener('paste', _ipcOnPaste);
  }
  _ipcPaint();
}
async function _ipcPaint() {
  const box = document.getElementById('ipcList'); if (!box) return;
  const st = await npCharsLoad(true);
  _diagPaintNav();   // 建过角色就把左栏这一项的完成圈点亮（这一步的判据就是 _npChars）
  if (!st.list.length) {
    box.innerHTML = '<div style="padding:18px 12px;text-align:center;color:#8a929e;font-size:12px;border:1px dashed #d8dee9;border-radius:10px;">' +
      (window.__xhsDemoAccount
        ? '演示号里还没有角色——开自己的号后，点「🎲 AI 帮我编一个」就能建，出一张定妆照就够用。'
        : '还没有角色。点右上「🎲 AI 帮我编一个」，它会照你的人设和行业编一个，改改就能用——也可以「➕ 自己填一个」。') +
      '</div>';
    return;
  }
  box.innerHTML = st.list.map(function (c) { return _ipcCardHtml(c, st); }).join('');
}
function _ipcCardHtml(c, st) {
  const main = c.id === st.mainId;
  const fullText = _ipcCharText(c).trim();
  const line = (fullText.length > 160 ? fullText.slice(0, 160) + '…' : fullText) ||
    '（外形还没写全，点「✏️ 改」补一句：多大年纪、发型、体型、平时穿什么）';
  // 老号可能还留着侧面 / 全身那两张：卡上只认正面这张，没有就取最后一张
  const p = (c.portraits || []).filter(function (x) { return x.angle === 'front'; }).slice(-1)[0] || (c.portraits || []).slice(-1)[0];
  const busy = _ipcBusy === c.id;
  const demo = !!window.__xhsDemoAccount;
  const attr = ' data-ipc-shot="' + _dEsc(c.id) + '"' + (_ipcBusy ? ' disabled' : '');
  const sel = _ipcPasteId === c.id;
  // 图就是换图入口：点一下选中这张卡，复制了图片按 Ctrl+V 就换上（http 页面读不了剪贴板，只能靠粘贴事件）
  const shot = '<div style="width:132px;flex:none;">' +
      '<div class="ipc-shot" data-ipc-pick="' + _dEsc(c.id) + '" title="点一下选中这张卡，复制图片后按 Ctrl+V 就换上"' +
      ' style="position:relative;border:1px solid ' + (sel ? '#c2410c' : '#e5e8ee') + ';box-shadow:' + (sel ? '0 0 0 2px #fff1e8' : 'none') +
      ';border-radius:9px;overflow:hidden;background:#f4f6f9;width:132px;cursor:' + (demo ? 'default' : 'pointer') + ';">' +
      (p
        ? '<img src="' + _dEsc(p.thumb || p.url || '') + '" alt="定妆照" style="width:100%;aspect-ratio:3/4;object-fit:cover;display:block;">' +
          '<span style="position:absolute;left:5px;bottom:5px;background:rgba(0,0,0,.55);color:#fff;font-size:10px;border-radius:4px;padding:1px 5px;">定妆照</span>'
        : '<div style="width:100%;aspect-ratio:3/4;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;background:#fafbfd;padding:6px;box-sizing:border-box;">' +
            '<span style="font-size:11px;color:#8a929e;text-align:center;line-height:1.5;">还没定妆照<br>' + (demo ? '' : '点这里选中后<br>复制图片按 Ctrl+V') + '</span></div>') +
      '</div>' +
      (demo ? '' : '<div style="margin-top:6px;"><button type="button" class="btn btn-sm" data-ipc-upload="' + _dEsc(c.id) + '"' + (_ipcBusy ? ' disabled' : '') +
        ' style="width:100%;padding:3px 6px;min-height:0;font-size:11px;">⬆ 换成自己的照片</button></div>') +
    '</div>';
  const hammers = (c.hammers || []).length
    ? '<div style="margin:2px 0 0;">' + c.hammers.map(function (h) {
        return '<span style="display:inline-block;background:#fff4ed;color:#b45309;border-radius:999px;padding:1px 8px;margin:0 4px 4px 0;font-size:11px;">' + _dEsc(h) + '</span>';
      }).join('') + '</div>'
    : '';
  // 风格 + 出图都摆在图外面：从上面那段文字描述出图，风格改完再出
  const styleRow = demo ? '' :
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;">' +
      '<select id="ipcStyle_' + _dEsc(c.id) + '" data-ipc-style="' + _dEsc(c.id) + '"' + (_ipcBusy ? ' disabled' : '') +
        ' style="padding:3px 6px;font-size:12px;border:1px solid #d8dee9;border-radius:7px;background:#fff;color:#374151;">' +
        NP_CHAR_STYLES.map(function (s) {
          return '<option value="' + s.k + '"' + (s.k === c.style ? ' selected' : '') + '>' + s.t + '</option>';
        }).join('') + '</select>' +
      '<button type="button" class="btn btn-sm btn-primary"' + attr + ' style="padding:3px 10px;min-height:0;font-size:12px;">' +
        (busy ? '⏳ 出图中' : (p ? '✨ 换个样子' : '✨ 出定妆照')) + '</button>' +
    '</div>';
  return '<div style="border:1px solid #e7eaf0;border-radius:12px;padding:12px 14px;margin-bottom:10px;background:#fff;">' +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
      '<b style="font-size:14px;">' + _dEsc(c.name || c.role || (c.desc ? String(c.desc).trim().slice(0, 10) : '未命名')) + '</b>' +
      (main ? '<span style="font-size:10px;background:#fff1e8;color:#c2410c;border-radius:999px;padding:1px 8px;">主角</span>' : '') +
      '<span style="font-size:11px;color:#8a929e;">' + _dEsc(c.role || '') + '</span>' +
      '<span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap;">' +
        (main ? '' : '<button type="button" class="btn btn-sm" data-ipc-main="' + _dEsc(c.id) + '">设为主角</button>') +
        '<button type="button" class="btn btn-sm" data-ipc-edit="' + _dEsc(c.id) + '">✏️ 改</button>' +
        '<button type="button" class="btn btn-sm" data-ipc-del="' + _dEsc(c.id) + '">🗑</button>' +
      '</span>' +
    '</div>' +
    '<div style="display:flex;gap:12px;align-items:flex-start;margin-top:8px;">' +
      shot +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-size:12px;color:#4b5563;line-height:1.7;">' + _dEsc(line) + '</div>' +
        hammers +
        styleRow +
      '</div>' +
    '</div>' +
    '</div>';
}
async function _ipcListClick(e) {
  // 图就是换图入口：点一下先把这张卡选中，再按 Ctrl+V 粘图（http 页面读不了剪贴板，只能靠粘贴事件）
  const pick = e.target.closest('[data-ipc-pick]');
  if (pick) return _ipcPastePick(pick.getAttribute('data-ipc-pick'));
  const t = e.target.closest('button'); if (!t) return;
  const shot = t.getAttribute('data-ipc-shot');
  if (shot) return _ipcShot(shot);
  const upId = t.getAttribute('data-ipc-upload');
  if (upId) return _ipcPickFile(upId);
  const editId = t.getAttribute('data-ipc-edit');
  if (editId) { const st = await npCharsLoad(true); return _ipcOpenEdit(st.list.find(function (x) { return x.id === editId; }) || null); }
  const mainId = t.getAttribute('data-ipc-main');
  if (mainId) {
    const st = await npCharsLoad(true);
    await npCharsSave({ mainId: mainId, list: st.list });
    _ipcSay('✅ 已设为主角——新写的稿默认就按这个人。', '#0a7b5a');
    return _ipcPaint();
  }
  const delId = t.getAttribute('data-ipc-del');
  if (delId) {
    const st = await npCharsLoad(true);
    const c = st.list.find(function (x) { return x.id === delId; });
    if (!c) return;
    if (!confirm('删掉角色「' + (c.name || c.role || '未命名') + '」？定妆图也一起删，已经写好的稿不受影响。')) return;
    const list = st.list.filter(function (x) { return x.id !== delId; });
    await npCharsSave({ mainId: st.mainId === delId ? (list[0] ? list[0].id : '') : st.mainId, list: list });
    _ipcSay('已删掉这个角色。', '#6b7280');
    return _ipcPaint();
  }
}
/* 点了照片 → 选中这张卡，等 Ctrl+V */
function _ipcPastePick(id) {
  if (window.__xhsDemoAccount) return;
  _ipcPasteId = String(id || '');
  const c = (typeof npCharById === 'function') ? npCharById(_ipcPasteId) : null;
  _ipcSay('已选中「' + ((c && (c.name || c.role)) || '这张卡') + '」——复制一张图片后按 Ctrl+V 就换上；要用电脑里的文件，点下面「⬆ 换成自己的照片」。', '#b45309');
  _ipcPaint();
}
/* 页面上的粘贴：只在这一页、只有图片才接；落在输入框里不抢 */
async function _ipcOnPaste(e) {
  const box = document.getElementById('ipcList');
  if (!box || !box.offsetParent) return;
  if (window.__xhsDemoAccount) return;
  const tg = e.target;
  if (tg && (/^(INPUT|TEXTAREA|SELECT)$/.test(String(tg.tagName || '')) || tg.isContentEditable)) return;
  const items = (e.clipboardData && e.clipboardData.items) || [];
  let file = null;
  for (let i = 0; i < items.length; i++) {
    if (items[i].kind === 'file' && /^image\//.test(String(items[i].type || ''))) { file = items[i].getAsFile(); if (file) break; }
  }
  if (!file) return;
  e.preventDefault();
  const st = await npCharsLoad();
  let id = _ipcPasteId;
  if (!id && st.list.length === 1) id = st.list[0].id;
  if (!id || !st.list.some(function (x) { return x.id === id; })) {
    _ipcSay('先点一下要换图的那张照片，再按 Ctrl+V。', '#c62828');
    return;
  }
  _ipcUploadDo(id, file);
}
/* 下拉里换风格：先落库，出图时按新风格拼提示词 */
async function _ipcStyleChange(e) {
  const el = e.target;
  const id = el && el.getAttribute ? String(el.getAttribute('data-ipc-style') || '') : '';
  if (!id) return;
  const st = await npCharsLoad(true);
  const next = { mainId: st.mainId, list: st.list.map(function (x) { return Object.assign({}, x); }) };
  const c = next.list.find(function (x) { return x.id === id; });
  if (!c) return;
  c.style = npCharStyle(c.kind, el.value);
  await npCharsSave(next);
  const s = NP_CHAR_STYLES.find(function (x) { return x.k === c.style; });
  _ipcSay('风格换成「' + (s ? s.t : c.style) + '」了——点右边那颗按钮就按这个风格出。', '#0a7b5a');
}
/* 出一张定妆照：按卡上那段描述、按刚选的风格出。旧定妆照只有当它已经是画的（styleV≥2）才带来当参考——旧真人图当参考容易又画成照片。就一张，重出＝换掉这张 */
async function _ipcShot(charId) {
  if (_ipcBusy) return;
  const st = await npCharsLoad(true);
  const c = st.list.find(function (x) { return x.id === charId; });
  if (!c) return;
  const live = document.getElementById('ipcStyle_' + charId);
  const use = Object.assign({}, c, { style: live ? npCharStyle(c.kind, live.value) : c.style });
  _ipcBusy = charId;
  _ipcSay('正在出定妆照——一张要几十秒，别关页面…', '#b45309');
  _ipcPaint();
  try {
    const r = await _diagSay('genCharImage', {
      charId: c.id,
      prompt: npCharPortraitPrompt(use, 'front'),
      size: '竖版 3:4',
      refs: Number(c.styleV || 0) >= 2 ? npCharRefIds(c) : [],
    });
    if (!r || r.ok === false || !r.url) throw new Error((r && r.error) || '没出成');
    const thumb = await _ipcThumb(r.url);
    const cur = await npCharsLoad(true);
    const next = { mainId: cur.mainId, list: cur.list.map(function (x) { return Object.assign({}, x); }) };
    const cc = next.list.find(function (x) { return x.id === charId; });
    if (!cc) throw new Error('角色不见了（可能刚被删）');
    cc.style = use.style; cc.kind = '卡通'; cc.styleV = 2;
    cc.portraits = [{ id: String(r.blobId || ''), url: String(r.url || ''), thumb: thumb || '', angle: 'front', at: Date.now() }];
    await npCharsSave(next);
    _ipcSay('✅ 定妆照出好了——这张会当后面配图的参考。', '#0a7b5a');
  } catch (e) {
    _ipcSay('❌ ' + ((e && e.message) || e), '#c62828');
  } finally {
    _ipcBusy = '';
    _ipcPaint();
  }
}
/* 上传自己的照片当定妆照：手上已经有像的照片就不用让 AI 画 */
function _ipcPickFile(charId) {
  if (_ipcBusy) return;
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.style.display = 'none';
  inp.addEventListener('change', function () {
    const f = inp.files && inp.files[0];
    inp.remove();
    if (f) _ipcUploadDo(charId, f);
  });
  document.body.appendChild(inp);
  inp.click();
}
/* 长边压到 1400 转 JPEG：手机原图动辄七八兆，服务器只把 ≤8MB 的图当参考图，压完一般几百 K */
async function _ipcShrink(file) {
  let bm;
  try { bm = await createImageBitmap(file); }
  catch (_) { throw new Error('这张图浏览器打不开（多半是 iPhone 的 HEIC 格式），换一张 JPG / PNG 的'); }
  const max = 1400;
  const sc = Math.min(1, max / Math.max(bm.width, bm.height));
  const w = Math.max(1, Math.round(bm.width * sc)), h = Math.max(1, Math.round(bm.height * sc));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(bm, 0, 0, w, h);
  try { bm.close(); } catch (_) {}
  return await new Promise(function (res, rej) {
    cv.toBlob(function (b) { b ? res(b) : rej(new Error('这张图处理不了，换一张试试')); }, 'image/jpeg', 0.9);
  });
}
async function _ipcUploadDo(charId, file) {
  if (_ipcBusy) return;
  const st = await npCharsLoad(true);
  const c = st.list.find(function (x) { return x.id === charId; });
  if (!c) return;
  if (!/^image\//.test(String(file.type || ''))) { _ipcSay('只收图片——JPG / PNG / WebP 都行', '#c62828'); return; }
  _ipcBusy = charId;
  _ipcSay('正在处理你上传的这张…', '#b45309');
  _ipcPaint();
  try {
    const blob = await _ipcShrink(file);
    const r = await fetch('api/blob/put?name=' + encodeURIComponent('定妆照.jpg') + '&mime=image/jpeg', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'image/jpeg' }, body: blob,
    }).then(function (x) { return x.json(); }).catch(function () { return null; });
    if (!r || !r.ok || !r.id) throw new Error((r && r.error) || '上传没成功，再试一次');
    const url = '/api/blob/' + r.id;
    const thumb = await _ipcThumb(url);
    const cur = await npCharsLoad(true);
    const next = { mainId: cur.mainId, list: cur.list.map(function (x) { return Object.assign({}, x); }) };
    const cc = next.list.find(function (x) { return x.id === charId; });
    if (!cc) throw new Error('角色不见了（可能刚被删）');
    cc.styleV = 2;   // 这张是本人挑的，一次性升级不要再拿 AI 图顶掉
    cc.portraits = [{ id: String(r.id), url: url, thumb: thumb || '', angle: 'front', at: Date.now() }];
    await npCharsSave(next);
    _ipcSay('✅ 换成你上传的这张了——出图时会当参考图一起递。', '#0a7b5a');
  } catch (e) {
    _ipcSay('❌ ' + ((e && e.message) || e), '#c62828');
  } finally {
    _ipcBusy = '';
    _ipcPaint();
  }
}
/* 服务器回的 /api/blob/<id> 缩成 120×160 小图存进配置：列表秒开，换台机器也看得见 */
async function _ipcThumb(url) {
  try {
    const abs = new URL(String(url || ''), location.href).href;
    const r = await fetch(abs, { credentials: 'include' });
    if (!r.ok) return '';
    const bm = await createImageBitmap(await r.blob());
    const cv = document.createElement('canvas'); cv.width = 120; cv.height = 160;
    const sc = Math.max(120 / bm.width, 160 / bm.height);
    cv.getContext('2d').drawImage(bm, (120 - bm.width * sc) / 2, (160 - bm.height * sc) / 2, bm.width * sc, bm.height * sc);
    try { bm.close(); } catch (_) {}
    return cv.toDataURL('image/jpeg', 0.72);
  } catch (_) { return ''; }
}
async function _ipcAiBuild() {
  const btn = document.getElementById('ipcAi');
  if (btn) btn.disabled = true;
  _ipcSay('AI 正在照你的人设和行业编一个角色…', '#b45309');
  try {
    const cfg = await _diagGetCfg();
    const p = (cfg && cfg.persona) || {};
    const st = await npCharsLoad(true);
    const r = await _diagSay('aiIpCharBuild', {
      profile: _diagState.profile || {},
      persona: String(p.text || _diagState.persona || ''),
      product: (cfg && cfg.product) || {},
      accountType: _diagState.accountType || (cfg && cfg.diagnosis && cfg.diagnosis.accountType) || '',
      existing: st.list.map(function (x) { return x.name; }).filter(Boolean),
      seed: String(Date.now()).slice(-5),
    });
    if (!r || r.ok === false || !r.char) throw new Error((r && r.error) || 'AI 没给出角色，再点一次试试');
    const g = r.char;
    const kind = '卡通';                       // 10-31 起只建画的 IP：不再出真人写实
    const next = { mainId: st.mainId, list: st.list.map(function (x) { return Object.assign({}, x); }) };
    const c = {
      id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: String(g.name || '').slice(0, 20),
      kind: kind,
      style: npCharStyle(kind, ''),
      role: String(g.role || '').slice(0, 30),
      age: String(g.age || '').slice(0, 20),
      hair: String(g.hair || '').slice(0, 40),
      body: String(g.body || '').slice(0, 40),
      cloth: String(g.cloth || '').slice(0, 60),
      hammers: (Array.isArray(g.hammers) ? g.hammers : []).map(function (s) { return String(s || '').trim(); }).filter(Boolean).slice(0, 3),
      voice: String(g.voice || '').slice(0, 120),
      desc: '',
      portraits: [], at: Date.now(),
    };
    // 编辑框里得看见一整段：AI 给的那句 desc 常常只概括一句，把拆出来的字段拼回去更全（拆不出来再用它那句）
    c.desc = _ipcCharText(c).slice(0, 1200) || String(g.desc || '').slice(0, 1200);
    next.list.push(c);
    if (!next.mainId) next.mainId = c.id;
    await npCharsSave(next);
    _ipcPaint();
    // 不弹表单：编好直接出第一张定妆照，不满意再点「✏️ 改」
    _ipcSay('编好了：「' + (c.name || c.role || '角色') + '」。正在出第一张定妆照，几十秒…', '#b45309');
    await _ipcShot(c.id);
  } catch (e) {
    _ipcSay('❌ ' + ((e && e.message) || e), '#c62828');
  } finally {
    if (btn) btn.disabled = false;
  }
}
/* 角色卡上那段话：desc 优先；老卡没 desc 就把拆好的字段拼回去 */
function _ipcCharText(c) {
  if (!c) return '';
  const t = String(c.desc || '').trim();
  if (t) return t;
  const bits = [c.name, c.role, c.age, c.hair, c.body].filter(Boolean).join('，');
  const h = (c.hammers || []).filter(Boolean);
  return (bits + (c.cloth ? '，穿' + c.cloth : '') + (h.length ? '。固定不变：' + h.join('、') : '')).trim();
}
/* 弹窗只有「名字 + 一段话 + 一颗按我说的改」：其余外形字段由 AI 在后台拆，不铺表单
   （老板 2026-10-30：「太多东西了」；11-02 加回名字，因为他要能直接改名）。 */
function _ipcOpenEdit(c) {
  _ipcEditId = c ? String(c.id || '') : '';
  const v = c || {};
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.id = 'ipcMask';
  mask.innerHTML = '<div class="modal-box" style="max-width:560px;max-height:86vh;overflow:auto;">' +
    '<h3 style="margin:0 0 4px;">' + (_ipcEditId ? '✏️ 改角色' : '➕ 新角色') + '</h3>' +
    '<div style="font-size:11.5px;color:#8a929e;line-height:1.6;margin-bottom:8px;">名字在上面直接改；下面一段话讲清这个人：多大年纪、做什么、发型、体型、平时穿什么，再加一两个一眼认得的物件（红色安全帽、腰上挂卷尺）。写得越具体，出的图越像同一个人。</div>' +
    '<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;">' +
      '<span style="font-size:12px;color:#6b7280;flex:none;">名字</span>' +
      '<input id="ipcF_name" maxlength="20" value="' + _dEsc(v.name || '') + '" placeholder="这个人叫什么（留空就让 AI 从下面那段话里认）" style="flex:1;min-width:0;box-sizing:border-box;font-size:13px;padding:6px 8px;border:1px solid #d8dee9;border-radius:7px;">' +
    '</div>' +
    '<textarea id="ipcF_text" rows="7" placeholder="例：小过，32 岁的装修师傅，短发两边推得很短，中等偏壮，常年穿深蓝工装，腰上挂卷尺，一顶红色安全帽。"' +
      ' style="width:100%;box-sizing:border-box;font-size:13px;line-height:1.7;padding:8px;border:1px solid #d8dee9;border-radius:8px;resize:vertical;">' + _dEsc(_ipcCharText(v)) + '</textarea>' +
    '<div style="display:flex;gap:6px;margin-top:8px;align-items:center;">' +
      '<input id="ipcF_ask" placeholder="想让 AI 怎么改？（例：再年轻点，换成长发）" style="flex:1;min-width:0;box-sizing:border-box;font-size:12px;padding:6px 8px;border:1px solid #d8dee9;border-radius:7px;">' +
      '<button type="button" class="btn btn-sm" id="ipcRevise" style="white-space:nowrap;">✨ 按我说的改</button>' +
    '</div>' +
    '<div id="ipcEditMsg" style="font-size:11.5px;color:#b45309;margin-top:6px;min-height:16px;"></div>' +
    '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px;">' +
      '<button type="button" class="btn" id="ipcCancel">取消</button>' +
      '<button type="button" class="btn btn-primary" id="ipcSave">💾 保存</button>' +
    '</div></div>';
  document.body.appendChild(mask);
  mask.classList.add('open');
  mask.addEventListener('click', function (e) { if (e.target === mask) _ipcCloseEdit(); });
  document.getElementById('ipcCancel')?.addEventListener('click', _ipcCloseEdit);
  document.getElementById('ipcSave')?.addEventListener('click', _ipcSaveEdit);
  document.getElementById('ipcRevise')?.addEventListener('click', _ipcRevise);
}
function _ipcCloseEdit() {
  const m = document.getElementById('ipcMask');
  if (m) m.remove();
  _ipcEditId = '';
}
function _ipcEditSay(text) {
  const m = document.getElementById('ipcEditMsg');
  if (m) m.textContent = text || '';
}
/* 「按我说的改」：把这段描述＋老板那句话交给 AI，改完换回文本框里，先给人看再保存 */
async function _ipcRevise() {
  const ta = document.getElementById('ipcF_text');
  const ask = document.getElementById('ipcF_ask');
  const btn = document.getElementById('ipcRevise');
  const text = ta ? String(ta.value || '').trim() : '';
  const want = ask ? String(ask.value || '').trim() : '';
  if (!text) { _ipcEditSay('先把这个人写一句，再让 AI 改'); return; }
  if (!want) { _ipcEditSay('写一句想怎么改，比如「再年轻点」「换成长发」「加一顶帽子」'); return; }
  if (btn) btn.disabled = true;
  _ipcEditSay('AI 正在按你说的改…');
  try {
    const r = await _diagSay('aiIpCharParse', { text: text, hint: want, revise: true });
    if (!r || r.ok === false || !String(r.text || '').trim()) throw new Error((r && r.error) || 'AI 没给出改好的版本');
    if (ta) ta.value = String(r.text).trim();
    if (ask) ask.value = '';
    _ipcEditSay('改好了——不满意可以再说一句，觉得可以就点「💾 保存」。');
  } catch (e) {
    _ipcEditSay('❌ ' + ((e && e.message) || e));
  } finally {
    if (btn) btn.disabled = false;
  }
}
async function _ipcSaveEdit() {
  const nameEl = document.getElementById('ipcF_name');
  const ta = document.getElementById('ipcF_text');
  const name = nameEl ? String(nameEl.value || '').trim().slice(0, 20) : '';
  const text = ta ? String(ta.value || '').trim() : '';
  if (!text) { _ipcEditSay('这个人长什么样，写一句也行'); return; }
  const st = await npCharsLoad(true);
  const next = { mainId: st.mainId, list: st.list.map(function (x) { return Object.assign({}, x); }) };
  let c = next.list.find(function (x) { return x.id === _ipcEditId; });
  if (!c) {
    c = { id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), portraits: [], at: Date.now() };
    next.list.push(c);
  }
  if (name) c.name = name;
  c.desc = text.slice(0, 1200);
  if (!next.mainId) next.mainId = c.id;
  await npCharsSave(next);
  _ipcCloseEdit();
  _ipcSay('存好了。正在整理发型、穿着、视觉锤这些细节…', '#b45309');
  _ipcPaint();
  await _ipcParseInto(c.id, text, name);
}
/* 后台把那段话拆成字段；拆不出来也不影响用——出图照样按那段话走。
   只补空：AI 没给或给空的字段保留原值，别把已经填好的外形冲掉（11-02）。 */
async function _ipcParseInto(charId, text, keepName) {
  try {
    const r = await _diagSay('aiIpCharParse', { text: text, hint: '' });
    if (!r || r.ok === false || !r.char) throw new Error((r && r.error) || '没拆成');
    const cur = await npCharsLoad(true);
    const next = { mainId: cur.mainId, list: cur.list.map(function (x) { return Object.assign({}, x); }) };
    const c = next.list.find(function (x) { return x.id === charId; });
    if (!c) throw new Error('角色不见了');
    const g = r.char;
    const nk = '卡通';                          // 10-31 起只建画的 IP：不再出真人写实
    const pick = function (v, old, max) {
      const s = String(v == null ? '' : v).trim();
      return (s || String(old || '').trim()).slice(0, max);
    };
    const hs = (Array.isArray(g.hammers) ? g.hammers : []).map(function (s) { return String(s || '').trim(); }).filter(Boolean).slice(0, 3);
    Object.assign(c, {
      name: pick(keepName || g.name, c.name, 20),
      kind: nk,
      style: npCharStyle(nk, c.style),
      role: pick(g.role, c.role, 30),
      age: pick(g.age, c.age, 20),
      hair: pick(g.hair, c.hair, 40),
      body: pick(g.body, c.body, 40),
      cloth: pick(g.cloth, c.cloth, 60),
      hammers: hs.length ? hs : (c.hammers || []),
      voice: pick(g.voice, c.voice, 120),
    });
    await npCharsSave(next);
    _ipcSay('✅ 存好了——点「✨ 出定妆照」就能出。', '#0a7b5a');
  } catch (e) {
    _ipcSay('已存好。外形细节这次没整理成，出图照样按你写的那段来。', '#b45309');
  }
  _ipcPaint();
}

function _diagMsg(id, text, error) {
  const el = document.getElementById(id);
  if (el) { el.textContent = text; el.style.color = error ? '#c62828' : '#0a7b5a'; }
}

var _diagSellState = { entries: [], loading: false, loaded: false, mode: '', editIndex: -1 };
// 卖点空库时的引导语：卡片顶部与同步状态行共用一条
const DIAG_SELL_EMPTY = '还没有卖点——点右上「新增卖点」自己写/导入，或到「问卷」提交一次自动生成。';
function diagSellRender() {
  const list = document.getElementById('diagSellList'); if (!list) return;
  const search = document.getElementById('diagSellSearch').value.trim().toLowerCase();
  const rows = _diagSellState.entries.map(function (entry, index) { return { entry: entry, index: index }; }).filter(function (row) {
    return [row.entry.title, row.entry.content].join('\n').toLowerCase().includes(search);
  });
  // 条数并进上面那行同步状态里（原来「已有 N 条」与「总数 N 条」各说一遍）；这里只在搜索时报命中数
  document.getElementById('diagSellStats').textContent = search ? ('匹配 ' + rows.length + ' 条') : '';
  list.innerHTML = '<table aria-label="产品卖点"><colgroup><col style="width:25%"><col style="width:43%"><col style="width:32%"></colgroup>' +
    '<thead><tr><th scope="col">卖点标题</th><th scope="col">内容摘要</th><th scope="col">操作</th></tr></thead>' +
    (rows.length ? rows.map(function (row) {
      const s = row.entry, content = String(s.content || '');
      return '<tbody class="diag-sell-item" data-index="' + row.index + '"><tr><td><b>' + _dEsc(s.title || '未命名卖点') + '</b>' + (s.image ? '<div class="diag-sell-note" style="color:#c026a3;">📷 已配图</div>' : '') + '</td>' +
        '<td>' + _dEsc(content.length > 80 ? content.slice(0, 80) + '…' : content) + '</td><td><div class="diag-sell-actions">' +
        '<button type="button" class="btn btn-outline diag-sell-view" aria-expanded="false" aria-controls="diagSellDetail' + row.index + '">查看</button>' +
        '<button type="button" class="btn btn-outline diag-sell-edit">编辑</button><button type="button" class="btn btn-outline diag-sell-delete">删除</button></div></td></tr>' +
        '<tr id="diagSellDetail' + row.index + '" class="diag-sell-detail" hidden><td colspan="3"><div class="diag-sell-full">' + _dEsc(content) + '</div></td></tr></tbody>';
    }).join('') : '<tbody><tr><td colspan="3">' + (_diagSellState.loading ? '正在读取卖点…' : !_diagSellState.loaded ? '卖点未读取，请点击“刷新列表”重试。' : _diagSellState.entries.length ? '没有匹配的卖点，请更换搜索词。' : '暂无卖点，点击「新增卖点」添加第一条。') + '</td></tr></tbody>') + '</table>';
  list.querySelectorAll('.diag-sell-item').forEach(function (row) {
    const index = Number(row.dataset.index), detail = row.querySelector('.diag-sell-detail'), view = row.querySelector('.diag-sell-view');
    view.onclick = function () {
      detail.hidden = !detail.hidden;
      view.textContent = detail.hidden ? '查看' : '收起';
      view.setAttribute('aria-expanded', String(!detail.hidden));
    };
    row.querySelector('.diag-sell-edit').onclick = function () { diagSellDialog('edit', index); };
    row.querySelector('.diag-sell-delete').onclick = async function () {
      if (_diagState.busy || !confirm('确定删除卖点“' + (_diagSellState.entries[index].title || '未命名卖点') + '”？')) return;
      await diagSellSaveEntries(_diagSellState.entries.filter(function (_, i) { return i !== index; }), '已删除卖点。', 'diagSellMsg');
    };
  });
  diagSellLock();
}
function diagSellMessage(id, text, error) {
  const el = document.getElementById(id);
  if (el) { el.textContent = text; el.style.color = error ? '#c62828' : '#0a7b5a'; }
}
function diagSellLock() {
  if (_diagStep !== 4) return;   // 节点 4＝产品卖点（popup.html #diagSubTabs 的 data-go）
  document.querySelectorAll('#diagBody button, #diagStepBody input, #diagStepBody textarea').forEach(function (el) {
    el.disabled = !!(_diagState.busy || _diagSellState.loading);
  });
  if (!_diagSellState.loaded) document.querySelectorAll('#diagSellAdd').forEach(function (el) { el.disabled = true; });
  const fileBtn = document.getElementById('diagSellFileImport');
  if (fileBtn) fileBtn.textContent = _diagState.busy === 'sell-file' ? (_diagState.sellFileLabel || '正在处理文件…') : '开始导入所选文件';
}
/* 卖点录入/编辑弹窗里的配图：Base64 直接存进卖点的 image（发笔记当素材用） */
function diagSellImgPaint() {
  const prev = document.getElementById('diagSellImgPrev'), clear = document.getElementById('diagSellImgClear');
  const src = String(_diagState.sellImage || '');
  if (prev) {
    if (src) { prev.src = src; prev.style.display = ''; }
    else { prev.removeAttribute('src'); prev.style.display = 'none'; }
  }
  if (clear) clear.style.display = src ? '' : 'none';
}
function diagSellDialog(mode, index) {
  if (_diagState.busy || _diagSellState.loading) return;
  const dialog = document.getElementById('diagSellDialog'); if (!dialog) return;
  if (!mode) {
    const editIndex = _diagSellState.editIndex;
    _diagSellState.mode = ''; _diagSellState.editIndex = -1;
    dialog.close();
    document.getElementById('diagSellAdd').setAttribute('aria-expanded', 'false');
    const edit = editIndex >= 0 && document.querySelector('#diagSellList [data-index="' + editIndex + '"] .diag-sell-edit');
    (edit || document.getElementById('diagSellAdd')).focus();
    return;
  }
  _diagSellState.mode = mode;
  _diagSellState.editIndex = mode === 'edit' ? index : -1;
  document.getElementById('diagSellDialogTitle').textContent = { quiz: '从问卷同步', manual: '录入添加', file: '文件导入', edit: '编辑卖点' }[mode] || '你想用哪种方式新增卖点？';
  document.getElementById('diagSellMethods').hidden = mode !== 'choose';
  dialog.querySelectorAll('[data-sell-form]').forEach(function (el) { el.hidden = el.dataset.sellForm !== (mode === 'edit' ? 'manual' : mode); });
  if (mode === 'manual' || mode === 'edit') {
    const entry = mode === 'edit' ? _diagSellState.entries[index] : _diagState.sellDraft;
    document.getElementById('diagSellTitle').value = entry.title || '';
    document.getElementById('diagSellContent').value = entry.content || '';
    _diagState.sellImage = String(entry.image || '');
    diagSellImgPaint();
    document.getElementById('diagSellSubmit').textContent = '保存';
    diagSellMessage('diagSellFormMsg', '');
  }
  // 进哪一种方式就停在那一种（老板：选了方式之后不要再来一排「重新选择方式」，要换方式先关闭再点「新增卖点」）
  const foot = dialog.querySelector('.diag-sell-modal-foot');
  if (foot) foot.style.borderTop = (mode === 'manual' || mode === 'edit') ? '1px solid #eef1f5' : 'none';
  document.getElementById('diagSellSubmit').hidden = !(mode === 'manual' || mode === 'edit');
  document.getElementById('diagSellAdd').setAttribute('aria-expanded', 'true');
  if (!dialog.open) dialog.showModal();
  document.getElementById(mode === 'manual' || mode === 'edit' ? 'diagSellTitle' : mode === 'file' ? 'diagSellFileBtn' : mode === 'quiz' ? 'diagSellQuizRun' : 'diagSellDialogTitle').focus();
}
/* extra 可带 name / guideText：问卷整理出的产品信息跟卖点一次写盘 */
async function _diagSellWrite(entries, extra) {
  const cfg = await _diagGetCfg();
  cfg.product = cfg.product || {};
  cfg.product.sellPoints = entries;
  cfg.product.description = entries.map(function (s) { return s.title && s.content ? s.title + '：' + s.content : s.title || s.content || ''; }).join('\n');
  if (extra) {
    // 问卷整理出的产品名：只在「是个新叫法」时提到主名位，别名跟着留；已经填过这个叫法就不动
    if (extra.name && _diagProdNamesOf(cfg.product)[0] !== extra.name) {
      const list = _diagProdNamesOf(cfg.product);
      _diagProdSetNames(cfg, [extra.name].concat(list.filter(function (v) { return v !== extra.name; })).join('\n'));
    }
    // 引导去向只在用户还没填时补（别把「基础配置」里手填的承接悄悄改掉）
    if (extra.guideText && !String(cfg.product.guideText || '').trim()) cfg.product.guideText = extra.guideText;
  }
  await _diagSaveCfg(cfg);
}
async function diagSellSaveEntries(entries, success, messageId, extra) {
  if (_diagState.busy || _diagSellState.loading || !_diagSellState.loaded) return false;
  if (entries.length > 10) { diagSellMessage(messageId, '最多保留 10 条卖点，请减少条目后重试；本次未保存。', true); return false; }
  _diagState.busy = 'product-save'; diagSellLock();
  diagSellMessage(messageId, '正在保存…');
  try {
    await _diagSellWrite(entries, extra);
    _diagSellState.entries = entries;
    diagSellRender();
    diagSellMessage('diagSellMsg', success);
    diagSellRefreshSyncLine();
    return true;
  } catch (e) {
    diagSellMessage(messageId, '保存失败：' + (e.message || e) + '。输入已保留，可重试。', true);
    return false;
  } finally { _diagState.busy = ''; diagSellLock(); }
}
/* 录入表单的草稿（切到别的「新增方式」再回来不丢输入；编辑态不写草稿） */
function _diagSellDraftSync() {
  if (_diagSellState.mode !== 'manual') return;
  _diagState.sellDraft = {
    title: document.getElementById('diagSellTitle').value,
    content: document.getElementById('diagSellContent').value,
    image: _diagState.sellImage || ''
  };
}
async function diagSellSubmit() {
  const title = document.getElementById('diagSellTitle').value.trim(), content = document.getElementById('diagSellContent').value.trim();
  if (!title || !content) { diagSellMessage('diagSellFormMsg', '标题和内容不能为空，请补充后保存。', true); return; }
  const index = _diagSellState.editIndex;
  if (_diagSellState.entries.some(function (s, i) { return i !== index && String(s.title || '').trim() === title; })) {
    diagSellMessage('diagSellFormMsg', '已有同名卖点，请编辑原条目或换一个标题。', true); return;
  }
  const entries = _diagSellState.entries.slice();
  const image = String(_diagState.sellImage || '');
  if (index >= 0) entries[index] = Object.assign({}, entries[index], { title: title, content: content, image: image });
  else entries.push({ title: title, content: content, image: image });
  if (await diagSellSaveEntries(entries, index >= 0 ? '已保存卖点修改。' : '已新增并保存 1 条卖点。', 'diagSellFormMsg')) {
    if (index < 0) { _diagState.sellDraft = { title: '', content: '', image: '' }; _diagState.sellImage = ''; }
    diagSellDialog('');
  }
}
/* ── 产品卖点 ── */
function diagStepSell(body) {
  if (!body) return;
  _diagSellState = { entries: [], loading: false, loaded: false, mode: '', editIndex: -1 };
  _diagState.sellFiles = [];
  body.innerHTML = '<style>' +
    '#diagStepBody .diag-sell-note{font-size:12px;color:#777;line-height:1.7;margin:6px 0;overflow-wrap:anywhere}' +
    '#diagSellList{overflow-x:auto;border:1px solid #e7eaf0;border-radius:10px;margin:8px 0}' +
    '#diagSellList table{width:100%;min-width:620px;table-layout:fixed;border-collapse:collapse;font-size:12px}' +
    '#diagSellList th,#diagSellList td{box-sizing:border-box;padding:11px 12px;text-align:left;vertical-align:top;overflow-wrap:anywhere;border-bottom:1px solid #e7eaf0}' +
    '#diagSellList thead{background:#f5f7fa;color:#667085}#diagSellList .diag-sell-actions{display:flex;gap:6px;flex-wrap:wrap}' +
    '#diagSellList .diag-sell-actions .btn{min-height:28px;padding:4px 8px}#diagSellList .diag-sell-delete{color:#c62828}' +
    '#diagSellList .diag-sell-detail{background:#f8fafd}#diagSellList .diag-sell-full{white-space:pre-wrap;line-height:1.7;overflow-wrap:anywhere}' +
    '#diagSellDialog [hidden],#diagSellDialog:not([open]){display:none}' +
    '#diagSellDialog{box-sizing:border-box;width:min(620px,calc(100vw - 32px));max-height:calc(100vh - 48px);margin:auto;padding:0;overflow:auto;overscroll-behavior:contain;background:#fff;color:#333;border:1px solid #dfe6f0;border-radius:14px;box-shadow:0 20px 70px rgba(15,23,42,.25)}' +
    '#diagSellDialog::backdrop{background:rgba(15,23,42,.42)}' +
    '#diagSellDialog .diag-sell-modal-head{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px;border-bottom:1px solid #e7eaf0;background:#fff}' +
    '#diagSellDialog .diag-sell-modal-body{padding:16px 20px 20px}#diagSellDialog input,#diagSellDialog textarea{width:100%;box-sizing:border-box;margin:4px 0 10px}' +
    '#diagSellMethods .btn{display:block;width:100%;text-align:left;margin-top:8px;padding:12px}#diagSellMethods span{display:block;font-size:12px;color:#777;font-weight:400;margin-top:4px}' +
    '#diagSellDialog .diag-sell-modal-foot{display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-top:12px;padding-top:12px;border-top:1px solid #eef1f5}' +
    '#diagSellDialog .diag-sell-modal-foot [hidden],#diagSellDialog .diag-sell-modal-foot button[hidden]{display:none}' +
    '</style>' + _diagCard(
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">' +
    _diagStepTitle('产品卖点') +
    '<button type="button" id="diagSellAdd" class="btn btn-primary" style="margin:0;" aria-haspopup="dialog" aria-expanded="false" aria-controls="diagSellDialog">新增卖点</button></div>' +
    '<div id="diagSellSyncLine" style="margin:6px 0 8px;">' + _diagSyncLine('product', DIAG_SELL_EMPTY) + '</div>' +
    '<div>' +
      '<div id="diagSellStats" class="diag-sell-note"></div>' +
      '<div style="display:flex;gap:8px;align-items:center;"><input id="diagSellSearch" type="search" aria-label="搜索卖点" placeholder="搜索卖点标题或内容" style="flex:1;min-width:0;box-sizing:border-box;"><button type="button" id="diagSellRefresh" class="btn btn-outline">刷新列表</button></div>' +
      '<div id="diagSellList"></div><div id="diagSellMsg" class="diag-sell-note" role="status"></div>' +
      '<dialog id="diagSellDialog" aria-labelledby="diagSellDialogTitle"><div class="diag-sell-modal-head"><h3 id="diagSellDialogTitle" tabindex="-1" style="font-size:15px;margin:0;">你想用哪种方式新增卖点？</h3></div><div class="diag-sell-modal-body">' +
      '<div id="diagSellMethods"><button type="button" class="btn btn-outline" data-sell-method="quiz"><b>从问卷同步</b><span>按问卷的内容重新提炼卖点，同标题更新、其他保留</span></button>' +
      '<button type="button" class="btn btn-outline" data-sell-method="file"><b>文件导入</b><span>一次丢一批 Word / Excel / TXT / JSON 文件，系统整理成卖点</span></button>' +
      '<button type="button" class="btn btn-outline" data-sell-method="manual"><b>录入添加</b><span>手动填写一条卖点的标题和内容</span></button></div>' +
      '<div data-sell-form="quiz" hidden><div class="diag-sell-note">拿问卷的内容重新提炼一遍卖点：同标题更新、新卖点追加 <span class="qhelp r" tabindex="0" data-tip="手工加的条目原样保留；合并后最多 10 条。">?</span></div>' +
      _dBtn('diagSellQuizRun', '开始同步') + '<div id="diagSellQuizMsg" role="status" class="diag-sell-note"></div></div>' +
      '<div data-sell-form="file" hidden><div class="diag-sell-note">Word / Excel / TXT / MD / CSV 由 AI 提炼成卖点，JSON 按卖点结构直接导入，同标题更新 <span class="qhelp r" tabindex="0" data-tip="一次最多 20 个，单个最大 2MB；其他卖点保留，合并后最多 10 条。旧版 .doc / .xls 请先另存为 .docx / .xlsx。">?</span></div>' +
      _dBtn('diagSellFileBtn', '选择文件（可多选）', '', 'btn-outline') + '<input type="file" id="diagSellFile" multiple accept=".docx,.xlsx,.json,.txt,.md,.markdown,.csv,.log,.text,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/json,text/plain,text/markdown,text/csv" style="display:none;">' +
      _dBtn('diagSellFileImport', '开始导入所选文件') + '<div id="diagSellFileName" class="diag-sell-note"></div><div id="diagSellFMsg" role="status" class="diag-sell-note"></div></div>' +
      '<div data-sell-form="manual" hidden><label for="diagSellTitle">卖点标题</label><input id="diagSellTitle" class="diagSellTitle" type="text" maxlength="40" placeholder="例如：提供试用体验">' +
      '<label for="diagSellContent">卖点内容</label><textarea id="diagSellContent" class="diagSellContent" rows="6" placeholder="说明具体优势、适用情况或服务内容"></textarea>' +
      '<div style="font-size:12px;color:#333;margin-bottom:4px;">配图（可选）<span style="color:#999;font-size:11px;">发笔记时可直接当素材用</span></div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin:4px 0 10px;flex-wrap:wrap;">' +
      '<button type="button" id="diagSellImgPick" class="btn btn-outline">选择图片</button>' +
      '<img id="diagSellImgPrev" alt="卖点配图预览" style="display:none;max-height:60px;max-width:140px;object-fit:cover;border-radius:6px;border:1px solid #e7eaf0;">' +
      '<button type="button" id="diagSellImgClear" class="btn btn-outline" style="display:none;">清除配图</button></div>' +
      '<input type="file" id="diagSellImgFile" accept="image/*" style="display:none;">' +
      '<div id="diagSellFormMsg" class="diag-sell-note" role="status"></div></div>' +
      '<div class="diag-sell-modal-foot"><button type="button" id="diagSellClose" class="btn btn-outline" aria-label="关闭卖点弹窗">关闭</button>' +
      '<button type="button" id="diagSellSubmit" class="btn btn-primary" hidden>保存</button></div></dialog>' +
    '</div>'
  );
  document.getElementById('diagSellFileBtn').onclick = function () {
    if (_diagState.busy) return;
    const input = document.getElementById('diagSellFile'); input.value = ''; input.click();
  };
  document.getElementById('diagSellFile').onchange = function (e) {
    _diagState.sellFiles = Array.prototype.slice.call(e.target.files || []);
    _diagSellFileName();
    if (_diagState.sellFiles.length) diagSellMessage('diagSellFMsg', '已选择 ' + _diagState.sellFiles.length + ' 个文件，点击“开始导入所选文件”逐个整理成卖点。');
  };
  document.getElementById('diagSellFileImport').onclick = diagSellImportFile;
  document.getElementById('diagSellQuizRun').onclick = diagSellSyncFromQuiz;
  document.getElementById('diagSellImgPick').onclick = function () {
    if (_diagState.busy) return;
    const input = document.getElementById('diagSellImgFile'); input.value = ''; input.click();
  };
  document.getElementById('diagSellImgFile').onchange = function (e) {
    const file = (e.target.files || [])[0];
    if (!file) return;
    if (!/^image\//.test(file.type || '')) { diagSellMessage('diagSellFormMsg', '请选择 JPG / PNG 等图片文件。', true); return; }
    if (file.size > 2 * 1024 * 1024) { diagSellMessage('diagSellFormMsg', '图片超过 2MB，请压缩后重试。', true); return; }
    const reader = new FileReader();
    reader.onload = function () {
      _diagState.sellImage = String(reader.result || '');
      _diagSellDraftSync();
      diagSellImgPaint();
      diagSellMessage('diagSellFormMsg', '');
    };
    reader.onerror = function () { diagSellMessage('diagSellFormMsg', '图片读取出错，请换一张重试。', true); };
    reader.readAsDataURL(file);
  };
  document.getElementById('diagSellImgClear').onclick = function () {
    if (_diagState.busy) return;
    _diagState.sellImage = '';
    _diagSellDraftSync();
    diagSellImgPaint();
  };
  document.getElementById('diagSellAdd').onclick = function () { diagSellDialog('choose'); };
  document.getElementById('diagSellClose').onclick = function () { diagSellDialog(''); };
  document.getElementById('diagSellSubmit').onclick = diagSellSubmit;
  document.getElementById('diagSellSearch').oninput = diagSellRender;
  document.getElementById('diagSellRefresh').onclick = function () { diagProdPrefill(true); };
  body.querySelectorAll('[data-sell-method]').forEach(function (el) { el.onclick = function () { diagSellDialog(el.dataset.sellMethod); }; });
  ['diagSellTitle', 'diagSellContent'].forEach(function (id) {
    document.getElementById(id).oninput = function () { _diagSellDraftSync(); };
  });
  const dialog = document.getElementById('diagSellDialog');
  dialog.oncancel = function (e) { e.preventDefault(); diagSellDialog(''); };
  dialog.onclick = function (e) {
    if (e.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) diagSellDialog('');
  };
  _diagSellFileName();
  diagProdPrefill();
}
/* JSON 卖点文件：title/name + content/desc，可选 image（Base64） */
function _diagSellParseItems(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch (_) { throw new Error('JSON 解析失败，请检查括号、引号和逗号'); }
  if (!Array.isArray(parsed)) throw new Error('JSON 必须是卖点数组');
  const items = parsed.map(function (s) {
    const entry = { title: s && (s.title || s.name), content: s && (s.content || s.desc) };
    if (s && Object.prototype.hasOwnProperty.call(s, 'image')) entry.image = s.image;
    return entry;
  });
  if (!items.length) throw new Error('没解析到有效卖点');
  return items.map(function (s) {
    if (typeof s.title !== 'string' || !s.title.trim() || typeof s.content !== 'string' || !s.content.trim()) throw new Error('每条卖点都需要文字标题和内容');
    const entry = { title: s.title.trim(), content: s.content.trim() };
    if (Object.prototype.hasOwnProperty.call(s, 'image')) {
      if (typeof s.image !== 'string' || (s.image && !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(s.image))) throw new Error('配图须为 PNG、JPEG、WebP 或 GIF 的 Base64 图片');
      entry.image = s.image;
    }
    return entry;
  });
}
/* 同标题更新、其他保留；原条目的 id / 配图不会被覆盖掉 */
function _diagSellMerge(entries, items) {
  let added = 0, updated = 0;
  items.forEach(function (s) {
    const index = entries.findIndex(function (e) { return String(e.title || '').trim() === s.title; });
    if (index < 0) { entries.push(Object.assign({ image: '' }, s)); added++; }
    else { entries[index] = Object.assign({}, entries[index], s); updated++; }
  });
  return { added: added, updated: updated };
}
function _diagSellFileName() {
  const el = document.getElementById('diagSellFileName'), files = _diagState.sellFiles || [];
  if (el) el.textContent = files.length ? '已选择 ' + files.length + ' 个文件：' + files.map(function (f) { return f.name + '（' + f.size + ' 字节）'; }).join('、') : '尚未选择文件';
}
async function diagSellImportFile() {
  if (_diagState.busy || _diagSellState.loading) return;
  const files = (_diagState.sellFiles || []).slice();
  if (!files.length) { diagSellMessage('diagSellFMsg', '请先选择要导入的文件，一次可选多个。', true); return; }
  if (files.length > 20) { diagSellMessage('diagSellFMsg', '一次最多导入 20 个文件（当前 ' + files.length + ' 个），请分批处理。', true); return; }
  if (!_diagSellState.loaded) { diagSellMessage('diagSellFMsg', '卖点还没读取完，请稍后再试。', true); return; }
  _diagState.busy = 'sell-file'; diagSellLock();
  const failures = [], done = [], entries = _diagSellState.entries.slice();
  let added = 0, updated = 0, saved = true;
  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      _diagState.sellFileLabel = '正在处理 ' + (i + 1) + '/' + files.length + '…';
      diagSellLock();
      diagSellMessage('diagSellFMsg', '正在处理第 ' + (i + 1) + '/' + files.length + ' 个文件：' + file.name + '…');
      const snapshot = entries.slice();
      try {
        if (file.size > 2 * 1024 * 1024) throw new Error('超过 2MB，请拆分后重试');
        let text = '';
        const kind = (typeof KbFile !== 'undefined') ? KbFile.kindOf(file.name) : 'text';
        if (kind === 'docx' || kind === 'xlsx') {
          // Word / Excel 在本机解包抽文字，原文件不上传；抽不出文字时由 KbFile 抛错
          text = (await KbFile.extract(file)).text;
        } else {
          if (kind === 'legacy') throw new Error('旧版 Office 格式读不了，请在 Word / Excel / WPS 里另存为 .docx / .xlsx 或 TXT 后重试');
          text = (await file.text()).replace(/^\uFEFF/, '');
          if (!text.trim()) throw new Error('文件为空');
          if (typeof CryptoBox !== 'undefined' && CryptoBox.isFileEnvelope(text)) throw new Error('这是加密的备份文件，卖点用不了，请另存为普通 JSON / TXT 后重试');
          if (text.indexOf('\u0000') >= 0) throw new Error('看起来不是文本文件，请另存为 TXT / MD / CSV，或把 Word / Excel 另存为 .docx / .xlsx');
        }
        let items;
        if (kind === 'json' || /^[\[{]/.test(text.trim())) {
          items = _diagSellParseItems(text);
        } else {
          const built = await _diagSay('aiSellPointBuild', { answers: [{ q: '产品资料文件：' + file.name, answer: text }], existing: entries.slice(0, 10) });
          if (!built || !built.ok) throw new Error((built && built.error) || '整理失败');
          items = (built.sellPoints || []).map(function (s) { return { title: String((s && s.title) || '').trim(), content: String((s && s.content) || '').trim() }; }).filter(function (s) { return s.title && s.content; });
          if (!items.length) throw new Error('AI 没整理出卖点，请在文件里写清产品优势或换一个文件');
        }
        const merged = _diagSellMerge(entries, items);
        if (entries.length > 10) throw new Error('合并后共 ' + entries.length + ' 条，超过 10 条上限，请先精简现有卖点');
        added += merged.added; updated += merged.updated;
        done.push(file.name);
      } catch (e) {
        entries.length = 0; Array.prototype.push.apply(entries, snapshot);
        failures.push({ file: file, why: e.message || String(e) });
      }
    }
    const summary = failures.length
      ? '处理完成，共 ' + files.length + ' 个文件：成功 ' + done.length + ' 个（新增 ' + added + ' 条，更新 ' + updated + ' 条' + (done.length ? '，' + done.join('、') : '') + '）；失败 ' + failures.length + ' 个：' + failures.map(function (f) { return f.file.name + '：' + f.why; }).join('；') + '。失败文件仍保留在列表，修正后可重新导入。'
      : '已导入 ' + files.length + ' 个文件：新增 ' + added + ' 条，更新 ' + updated + ' 条，其他卖点保留。';
    if (done.length) {
      _diagState.busy = '';
      saved = await diagSellSaveEntries(entries, summary, 'diagSellFMsg');
      // 摘要要留在弹窗里（保存失败时保留原有的失败原因）。
      if (saved) diagSellMessage('diagSellFMsg', summary, failures.length > 0);
    } else {
      diagSellMessage('diagSellFMsg', summary, true);
    }
  } finally {
    // 没写进库的话全部文件都留着重试，避免处理成功却被丢掉。
    _diagState.sellFiles = saved ? failures.map(function (f) { return f.file; }) : files;
    _diagState.sellFileLabel = '';
    _diagSellFileName();
    _diagState.busy = ''; diagSellLock();
    const panel = document.getElementById('diagSellDialog');
    if (panel && panel.open) document.getElementById('diagSellFileImport').focus();
  }
}
/* 「新增卖点 › 从问卷同步」：拿问卷答案重提炼卖点——同标题更新、新标题追加、其余手工条目保留（与文件导入同一口径） */
async function diagSellSyncFromQuiz() {
  if (_diagState.busy || _diagSellState.loading || !_diagSellState.loaded) return;
  const btn = document.getElementById('diagSellQuizRun'); const msg = document.getElementById('diagSellQuizMsg');
  const answers = _diagQuizAnswers();
  if (!answers) { _diagSyncNoQuiz(msg, '还没填过问卷——先去左栏「问卷」答完提交；也可以改用「文件导入」或「录入添加」自己写。'); return; }
  _diagState.busy = 'node-sync'; diagSellLock(); _diagPaintNav();
  if (msg) { msg.style.color = '#555'; msg.textContent = '正在按问卷重新提炼卖点…'; }
  let entries = null, extra = null, skipped = 0, stat = null;
  try {
    const r = await _diagSay('aiSellPointBuild', { answers: answers, existing: _diagSellState.entries.slice(0, 10) });
    if (!r || !r.ok || !Array.isArray(r.sellPoints) || !r.sellPoints.length) throw new Error((r && r.error) || 'AI 未返回卖点');
    entries = _diagSellState.entries.slice();
    stat = _diagSellMerge(entries, r.sellPoints);
    if (entries.length > 10) { skipped = entries.length - 10; entries.length = 10; }
    extra = { name: r.productName, guideText: r.guideText };
  } catch (e) {
    _diagState.busy = ''; diagSellLock(); _diagPaintNav(); if (btn) btn.disabled = false;
    if (msg) { msg.style.color = '#c62828'; msg.textContent = '❌ ' + (e.message || e) + '。可稍后重试，或改用「录入添加」自己写。'; }
    return;
  }
  _diagState.busy = '';   // 交给 diagSellSaveEntries 走标准写盘（它自己管锁与上限）
  const success = '✅ 已按问卷同步：新增 ' + stat.added + ' 条、更新 ' + stat.updated + ' 条' +
    (skipped ? '；超出 10 条上限的 ' + skipped + ' 条未写入，请先删几条' : '') + '。';
  const okSaved = await diagSellSaveEntries(entries, success, 'diagSellQuizMsg', extra);
  if (okSaved) {
    await _diagMarkNode('product', '已从问卷重新提炼');
    diagSellRefreshSyncLine();
    _diagPaintNav();   // 卖点完成态跟着变
    diagSellDialog('');                             // 同步完收起弹窗，回到表格看结果
    diagSellMessage('diagSellQuizMsg', '');
    diagSellMessage('diagSellMsg', success);
  }
  if (btn) btn.disabled = false;
}
function diagSellRefreshSyncLine() {
  const box = document.getElementById('diagSellSyncLine');
  if (!box) return;
  const result = ((_diagState.diagnosis && _diagState.diagnosis.results) || {}).product;
  const n = _diagSellState.entries.length;
  const tail = n ? ('卖点 ' + n + '/10 条') : '';
  box.innerHTML = _diagSyncLine('product', DIAG_SELL_EMPTY, tail);
}
async function diagProdPrefill(listOnly) {
  if (_diagState.busy || _diagSellState.loading) return;
  const list = document.getElementById('diagSellList'); if (!list) return;
  const state = _diagSellState;
  state.loading = true; diagSellRender();
  diagSellMessage('diagSellMsg', '正在读取…');
  try {
    const cfg = await _diagGetCfg(); const p = cfg.product || {};
    if (document.getElementById('diagSellList') !== list) return;
    state.entries = (p.sellPoints || []).filter(function (s) { return s && (s.title || s.content); });
    state.loaded = true;
    diagSellMessage('diagSellMsg', '');
    diagSellRefreshSyncLine();
  } catch (e) {
    if (document.getElementById('diagSellList') === list) diagSellMessage('diagSellMsg', '读取失败：' + (e.message || e) + '。请刷新列表重试。', true);
  } finally {
    state.loading = false;
    if (document.getElementById('diagSellList') === list) diagSellRender();
  }
}

/* ── 知识库 ── */
function diagStepKb(body) {
  if (!body) return;
  body.innerHTML = '<style>#diagStepBody .diag-kb-note{font-size:12px;color:#777;line-height:1.7;margin:5px 0;overflow-wrap:anywhere}#diagStepBody .diag-kb-full{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.7}#diagStepBody .diag-kb-edit input:not([type=checkbox]),#diagStepBody .diag-kb-edit textarea{width:100%;box-sizing:border-box;margin:4px 0 8px}#diagKList{overflow-x:auto;border:1px solid #e7eaf0;border-radius:10px}#diagKList table{width:100%;min-width:620px;table-layout:fixed;border-collapse:collapse;font-size:12px}#diagKList th,#diagKList td{box-sizing:border-box;padding:11px 12px;text-align:left;vertical-align:top;overflow-wrap:anywhere;border-bottom:1px solid #e7eaf0}#diagKList thead{background:#f5f7fa;color:#667085}#diagKList tbody:last-child tr:last-child td{border-bottom:0}#diagKList .diag-kb-row:hover{background:#fafbfe}#diagKList .diag-kb-actions{display:flex;gap:6px;flex-wrap:wrap}#diagKList .diag-kb-actions .btn{min-height:28px;padding:4px 8px}#diagKList .diag-kb-detail{background:#f8fafd}#diagKList .diag-kb-status{display:inline-block;padding:3px 7px;border-radius:5px;background:#e7f6ef;color:#087451;white-space:nowrap}#diagKList .diag-kb-status.off{background:#f0f1f4;color:#727885}#diagKAddPanel [hidden],#diagKAddPanel:not([open]),#diagKEditPanel [hidden],#diagKEditPanel:not([open]){display:none}#diagKAddPanel,#diagKEditPanel{box-sizing:border-box;width:min(620px,calc(100vw - 32px));max-height:calc(100vh - 48px);margin:auto;padding:0;overflow:auto;overscroll-behavior:contain;background:#fff;color:#333;border:1px solid #dfe6f0;border-radius:14px;box-shadow:0 20px 70px rgba(15,23,42,.25)}#diagKAddPanel::backdrop,#diagKEditPanel::backdrop{background:rgba(15,23,42,.42)}#diagKAddPanel .diag-kb-modal-head,#diagKEditPanel .diag-kb-modal-head{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:16px 20px;border-bottom:1px solid #e7eaf0;background:#fff}#diagKAddPanel .diag-kb-modal-content,#diagKEditPanel .diag-kb-modal-content{padding:16px 20px 20px}#diagKEditPanel .diag-kb-modal-foot{display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-top:12px;padding-top:12px;border-top:1px solid #eef1f5}#diagKEditPanel .diag-kb-modal-content>label{display:block;font-weight:600;font-size:12px;color:#4b5563;margin:10px 0 3px}#diagKEditPanel .diag-kb-modal-content>input:not([type=checkbox]),#diagKEditPanel .diag-kb-modal-content>textarea{display:block;width:100%;box-sizing:border-box;margin:0;padding:7px 9px;border:1px solid #dfe6f0;border-radius:8px;font-size:13px;font-family:inherit}#diagStepBody .diag-kb-pick{position:relative;display:inline-flex;flex:none}#diagStepBody .diag-kb-pick #diagKBackupBtn{border-top-right-radius:0;border-bottom-right-radius:0;margin-right:0}#diagStepBody .diag-kb-pick #diagKBkMenuBtn{border-top-left-radius:0;border-bottom-left-radius:0;margin-left:-1px;padding:7px 9px}#diagKBkPop{position:absolute;right:0;top:36px;z-index:40;min-width:210px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 10px 26px rgba(16,24,40,.14);padding:8px;text-align:left}#diagKBkPop .btn{display:block;width:100%;text-align:left;margin:0 0 6px;font-size:12px;padding:8px 10px}#diagKBkPop .btn:last-child{margin-bottom:0}#diagKBkPop .diag-kb-pop-hint{font-size:11px;color:#98a2b3;line-height:1.6;margin:2px 0 8px}#diagKMethods .btn{display:block;width:100%;text-align:left;margin-top:8px;padding:12px}#diagKMethods .btn span{display:block;margin-top:4px;font-size:12px;color:#777;font-weight:400}#diagStepBody .diag-kb-img-prev{max-width:180px;max-height:130px;border:1px solid #e7eaf0;border-radius:6px;display:block;margin:2px 0 6px}#diagStepBody .diag-kb-img-wrap[hidden]{display:none}</style>' +
    _diagCard('<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">' +
      _diagStepTitle('知识库') + '<div style="display:flex;gap:8px;align-items:center;">' +
      '<button type="button" id="diagKAddBtn" class="btn btn-primary" style="margin:0;" aria-expanded="false" aria-controls="diagKAddPanel">新增知识</button>' +
      '<span class="diag-kb-pick">' +
        '<button type="button" id="diagKBackupBtn" class="btn btn-outline" style="margin:0;" title="点一下直接导出本产品的备份文件（问卷、人设、卖点、知识库、规划；不含 AI Key）">📦 备份</button>' +
        '<button type="button" id="diagKBkMenuBtn" class="btn btn-outline" style="margin:0;" aria-haspopup="true" aria-expanded="false" aria-controls="diagKBkPop" title="备份的其他操作">▾</button>' +
        '<div id="diagKBkPop" hidden>' +
          '<div class="diag-kb-pop-hint">范围＝当前这一个产品；要连 AI Key、全部产品、获客/私信历史一起搬，用弹窗左栏「🛡️ 整机备份 / 恢复」。</div>' +
          '<button type="button" class="btn btn-outline" data-bk="merge">📥 导入备份（合并）</button>' +
          '<button type="button" class="btn btn-outline" data-bk="replace">📥 导入备份（覆盖）</button>' +
          '<button type="button" class="btn btn-outline" data-bk="kb">📤 只导出知识库</button>' +
          '<button type="button" class="btn btn-outline" data-bk="clear">🗑 清空知识库</button>' +
        '</div>' +
      '</span>' +
      '<input type="file" id="diagKBackupFile" accept=".json,application/json" style="display:none;"></div></div>' +
      '<dialog id="diagKAddPanel" aria-labelledby="diagKAddTitle">' +
      '<div class="diag-kb-modal-head"><h3 id="diagKAddTitle" tabindex="-1" style="font-size:15px;margin:0;">你想用哪种方式新增知识？</h3>' +
      '<button type="button" id="diagKAddCancel" class="btn btn-outline" aria-label="关闭新增知识弹窗">关闭</button></div>' +
      '<div class="diag-kb-modal-content"><div id="diagKMethods">' +
        '<button type="button" class="btn btn-outline" data-kb-method="text"><b>随意输入，AI 整理</b><span>直接输入或粘贴经验、聊天记录、产品说明</span></button>' +
        '<button type="button" class="btn btn-outline" data-kb-method="file"><b>文件导入</b><span>一次丢一批 Word / Excel / TXT / MD / CSV 文件，系统整理后入库</span></button>' +
      '</div>' +
      '<div data-kb-form="text" hidden>' +
      '<div class="diag-kb-note">经验、聊天记录、价格、产品说明都可以直接粘贴 <span class="qhelp r" tabindex="0" data-tip="不要求标题格式；AI 提炼后追加入库，原文保留供核对。">?</span></div>' +
      '<textarea id="diagKImp" rows="5" aria-label="知识素材" placeholder="把手头的经验、顾客问答、价格或产品说明粘贴到这里…" style="width:100%;box-sizing:border-box;">' + _dEsc(_diagState.kbDraft) + '</textarea>' +
      _dBtn('diagKImport', 'AI整理并入库') + '<div id="diagKIMsg" role="status" class="diag-kb-note"></div></div>' +
      '<div data-kb-form="file" hidden>' +
      '<div class="diag-kb-note">Word / Excel / TXT / MD / CSV 等由 AI 提炼入库，JSON 按知识条目直接导入，同标题更新 <span class="qhelp r" tabindex="0" data-tip="一次最多 20 个，单个最大 2MB；其他知识保留，不覆盖全库。旧版 .doc / .xls 请先另存为 .docx / .xlsx；加密备份文件请用旁边「📦 备份 ▾」里的「导入备份」恢复。">?</span></div>' +
      _dBtn('diagKFileBtn', '选择文件（可多选）', '', 'btn-outline') + '<input type="file" id="diagKFile" multiple accept=".docx,.xlsx,.json,.txt,.md,.markdown,.csv,.log,.text,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/json,text/plain,text/markdown,text/csv" style="display:none;">' +
      _dBtn('diagKFileImport', '开始导入所选文件') + '<div id="diagKFileName" class="diag-kb-note"></div><div id="diagKFMsg" role="status" class="diag-kb-note"></div></div>' +
      '</div></dialog>' +
      '<div id="diagKSyncLine">' + _diagSyncLine('knowledge', '') + '</div>' +
      '<div id="diagKStats" class="diag-kb-note">正在读取…</div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;"><input id="diagKSearch" type="search" aria-label="搜索知识库" placeholder="搜索标题、内容、分类或标签" style="flex:1;min-width:140px;box-sizing:border-box;" value="' + _dEsc(_diagState.kbSearch) + '">' +
      '<select id="diagKFilterCat" aria-label="按分类筛选" style="width:auto;font-size:12px;padding:5px 8px;"><option value="">全部分类</option></select>' +
      '<select id="diagKFilterStatus" aria-label="按状态筛选" style="width:auto;font-size:12px;padding:5px 8px;"><option value="">全部状态</option><option value="on">启用中</option><option value="off">已停用</option></select>' +
      '<button type="button" id="diagKBatchCat" class="btn btn-outline" title="对未归类条目调 AI，按标题 + 正文归到 8 类之一（一次 ≤ 30 条）">🤖 AI 批量归类</button>' +
      '<button type="button" id="diagKRefresh" class="btn btn-outline">刷新列表</button></div>' +
      '<div id="diagKListMsg" role="status" class="diag-kb-note"></div><div id="diagKList"></div>' +
      '<div id="diagKHistory" class="diag-kb-note" aria-live="polite"></div>' +
      /* 编辑知识：弹窗改（老板：「列表的编辑按钮做成弹出窗口好了，别在原列表进行修改，太奇怪了」） */
      '<dialog id="diagKEditPanel" aria-labelledby="diagKEditTitle">' +
      '<div class="diag-kb-modal-head"><h3 id="diagKEditTitle" tabindex="-1" style="font-size:15px;margin:0;">编辑知识</h3></div>' +
      '<div class="diag-kb-modal-content">' +
      '<label for="diagKEditTitleIn">标题</label><input id="diagKEditTitleIn" class="diag-kb-title" type="text" maxlength="80"><div id="diagKEditTitleCnt" class="diag-kb-cnt" aria-live="polite">0/80</div>' +
      '<label for="diagKEditContent">正文</label><textarea id="diagKEditContent" class="diag-kb-content" rows="8"></textarea>' +
      '<label for="diagKEditCat">分类</label><input id="diagKEditCat" class="diag-kb-category" list="diagKCatList"><div id="diagKEditCatTip" class="diag-kb-tip"></div>' +
      '<label for="diagKEditRole">角色（可选，评论里出现该角色的关键词时优先引用这条）</label><input id="diagKEditRole" class="diag-kb-role" list="diagKRoleList">' +
      '<label for="diagKEditTags">标签（逗号分隔，也可用 JSON 数组保留标签原文）</label><input id="diagKEditTags" class="diag-kb-tags"><div id="diagKEditTagsTip" class="diag-kb-tip">示例：流量焦虑、付费转化、复购</div>' +
      '<div class="diag-kb-note">配图（可选，引用这条知识时随评论一起发出）</div>' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:4px 0 8px;">' +
      '<button type="button" id="diagKEditImgPick" class="btn btn-outline">选择图片</button>' +
      '<input type="file" id="diagKEditImgFile" class="diag-kb-image-file" accept="image/png,image/jpeg,image/webp" style="display:none;">' +
      '<div class="diag-kb-img-wrap" id="diagKEditImgWrap" hidden><img id="diagKEditImgPrev" class="diag-kb-img-prev" alt="配图预览">' +
      '<button type="button" id="diagKEditImgDel" class="btn btn-outline diag-kb-img-del">删除图片</button></div>' +
      '<label style="display:flex;align-items:center;gap:6px;"><input class="diag-kb-active" type="checkbox">启用</label></div>' +
      '<div id="diagKEditMsg" role="status" class="diag-kb-note"></div>' +
      '<div class="diag-kb-modal-foot">' +
      '<button type="button" id="diagKEditCancel" class="btn btn-outline" aria-label="关闭编辑弹窗">关闭</button>' +
      '<button type="button" id="diagKEditSave" class="btn btn-primary">保存</button></div></div></dialog>' +
      /* 分类 / 角色下拉：分类＝lib/ai-providers.js 的 KB_CATEGORIES；角色＝config.roleKeywords 的键（真正参与 AI 匹配的那几个） */
      '<datalist id="diagKCatList">' + KB_CATEGORIES.map(function (c) { return '<option value="' + _dEsc(c) + '"></option>'; }).join('') + '</datalist>' +
      '<datalist id="diagKRoleList"></datalist>');
  body.querySelector('#diagKAddBtn').onclick = function () { if (!_diagState.busy) diagKbAddView('choose', true); };
  body.querySelector('#diagKAddCancel').onclick = function () { if (!_diagState.busy) diagKbAddView('', true); };
  body.querySelectorAll('[data-kb-method]').forEach(function (el) { el.onclick = function () { if (!_diagState.busy) diagKbAddView(el.dataset.kbMethod, true); }; });
  const dialog = body.querySelector('#diagKAddPanel');
  dialog.oncancel = function (e) { e.preventDefault(); if (!_diagState.busy) diagKbAddView('', true); };
  dialog.onclick = function (e) {
    if (e.target !== dialog || _diagState.busy) return;
    const rect = dialog.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) diagKbAddView('', true);
  };
  body.querySelector('#diagKImp').oninput = function (e) { _diagState.kbDraft = e.target.value; };
  body.querySelector('#diagKImport').onclick = diagKbImport;
  body.querySelector('#diagKFileBtn').onclick = function () {
    if (_diagState.busy) return;
    const input = body.querySelector('#diagKFile'); input.value = ''; input.click();
  };
  body.querySelector('#diagKFile').onchange = function (e) {
    _diagState.kbFiles = Array.prototype.slice.call((e.target.files || []));
    _diagKbFileName();
    if (_diagState.kbFiles.length) _diagKbMessage('diagKFMsg', '已选择 ' + _diagState.kbFiles.length + ' 个文件，点击“开始导入所选文件”逐个整理入库。');
  };
  body.querySelector('#diagKFileImport').onclick = diagKbImportFile;
  // 「📦 备份」点一下就直接出文件；旁边 ▾ 才是导入 / 只搬知识库 / 清空（老板：备份与导入拆开，点了就做事，不要再开一页）
  body.querySelector('#diagKBackupBtn').onclick = function () { if (!_diagState.busy) diagKbExport(); };
  body.querySelector('#diagKBkMenuBtn').onclick = function () {
    const pop = body.querySelector('#diagKBkPop'); if (!pop) return;
    _diagKbPop(pop, pop.hidden);
  };
  body.querySelectorAll('#diagKBkPop [data-bk]').forEach(function (el) {
    el.onclick = function () {
      if (_diagState.busy) return;
      _diagKbPop(body.querySelector('#diagKBkPop'), false);
      const act = el.dataset.bk;
      if (act === 'kb') { diagKbOnlyExport(); return; }
      if (act === 'clear') { diagKbOnlyClear(); return; }
      _diagState.kbBackupMode = act;   // merge / replace：选完文件立刻导入
      const input = body.querySelector('#diagKBackupFile'); input.value = ''; input.click();
    };
  });
  document.addEventListener('click', function (e) {
    const pop = document.getElementById('diagKBkPop');
    if (!pop || pop.hidden) return;
    if (e.target.closest('#diagKBkPop') || e.target.closest('#diagKBkMenuBtn')) return;
    _diagKbPop(pop, false);
  });
  body.querySelector('#diagKBackupFile').onchange = function (e) {
    _diagState.kbBackupFile = (e.target.files && e.target.files[0]) || null;
    if (!_diagState.kbBackupFile) return;
    const mode = _diagState.kbBackupMode === 'replace' ? 'replace' : 'merge';
    _diagState.kbBackupMode = '';
    diagKbBackupImport(mode);
  };
  /* 编辑知识弹窗 */
  body.querySelector('#diagKEditCancel').onclick = function () { if (!_diagState.busy) diagKbEditClose(); };
  body.querySelector('#diagKEditSave').onclick = function () { if (!_diagState.busy) diagKbEditSave(); };
  body.querySelector('#diagKEditImgPick').onclick = function () {
    if (_diagState.busy) return;
    const input = body.querySelector('#diagKEditImgFile'); input.value = ''; input.click();
  };
  body.querySelector('#diagKEditImgFile').onchange = function (e) {
    const f = (e.target.files || [])[0];
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/i.test(f.type || '')) { _diagKbMessage('diagKEditMsg', '配图只认 PNG / JPG / WebP。', true); e.target.value = ''; return; }
    const rd = new FileReader();
    rd.onload = function (ev) { _diagState.kbEditImage = String(ev.target.result || ''); _diagKbEditImgPaint(); _diagKbMessage('diagKEditMsg', ''); };
    rd.onerror = function () { _diagKbMessage('diagKEditMsg', '图片读取出错，请换一张重试。', true); };
    rd.readAsDataURL(f);
  };
  body.querySelector('#diagKEditImgDel').onclick = function () {
    if (_diagState.busy) return;
    _diagState.kbEditImage = '';
    const input = body.querySelector('#diagKEditImgFile'); if (input) input.value = '';
    _diagKbEditImgPaint();
  };
  const edPanel = body.querySelector('#diagKEditPanel');
  edPanel.oncancel = function (e) { e.preventDefault(); if (!_diagState.busy) diagKbEditClose(); };
  edPanel.onclick = function (e) {
    if (e.target !== edPanel || _diagState.busy) return;
    const rect = edPanel.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) diagKbEditClose();
  };
  body.querySelector('#diagKSearch').oninput = function (e) { _diagState.kbSearch = e.target.value; diagKbRenderList(); };
  body.querySelector('#diagKFilterCat').onchange = function (e) { _diagState.kbFilterCat = e.target.value; diagKbRenderList(); };
  body.querySelector('#diagKFilterStatus').onchange = function (e) { _diagState.kbFilterStatus = e.target.value; diagKbRenderList(); };
  body.querySelector('#diagKBatchCat').onclick = function () { if (!_diagState.busy) diagKbBatchCategorize(); };
  body.querySelector('#diagKRefresh').onclick = function () { if (!_diagState.busy && !_diagState.kbLoading) diagKbRefresh(); };
  /* ★ KB 输入实时校验：标题 / 正文 / 分类 / 标签 oninput 切红框 + 字数提示 + 默认警示 */
  const editInputs = ['diagKEditTitleIn', 'diagKEditContent', 'diagKEditCat', 'diagKEditTags'];
  editInputs.forEach(function (id) {
    const el = body.querySelector('#' + id);
    if (el && !el._diagKbValidateBound) {
      el._diagKbValidateBound = true;
      el.addEventListener('input', _diagKbValidateEdit);
    }
  });
  diagKbAddView(_diagState.busy ? _diagState.kbAddMode || '' : '');
  _diagKbFileName();
  _diagKbPop(body.querySelector('#diagKBkPop'), false);
  _diagKbRenderHistory();
  diagKbRefresh();
  diagKbLoadRoles();
  _diagKbLock();
}
function diagKbAddView(mode, focus) {
  _diagState.kbAddMode = mode;
  const panel = document.getElementById('diagKAddPanel');
  if (!panel) return;
  const add = document.getElementById('diagKAddBtn');
  add.setAttribute('aria-expanded', String(!!mode));
  document.getElementById('diagKMethods').hidden = mode !== 'choose';
  document.getElementById('diagKAddTitle').textContent = { text: '随意输入，AI 整理', file: '文件导入' }[mode] || '你想用哪种方式新增知识？';
  panel.querySelectorAll('[data-kb-form]').forEach(function (el) { el.hidden = el.dataset.kbForm !== mode; });
  if (mode && !panel.open) panel.showModal();
  else if (!mode && panel.open) panel.close();
  if (focus) {
    const id = mode === 'text' ? 'diagKImp' : mode === 'file' ? 'diagKFileBtn' : mode ? 'diagKAddTitle' : 'diagKAddBtn';
    document.getElementById(id).focus();
  }
}
/* 备份下拉：开合都收口在这一处（点外面也关） */
function _diagKbPop(pop, open) {
  if (!pop) return;
  pop.hidden = !open;
  const btn = document.getElementById('diagKBkMenuBtn');
  if (btn) btn.setAttribute('aria-expanded', String(!!open));
}
function _diagKbFileName() {
  const el = document.getElementById('diagKFileName'), files = _diagState.kbFiles || [];
  if (el) el.textContent = files.length ? '已选择 ' + files.length + ' 个文件：' + files.map(function (f) { return f.name + '（' + f.size + ' 字节）'; }).join('、') : '尚未选择文件';
}
// 角色下拉：选项＝config.roleKeywords 的键（只有这些角色名会参与 AI 的角色命中加分）。
// 走后台 getConfig 拿配置：那边已把 DEFAULT_CONFIG 深合并进来，弹窗里没有 storage.js 的默认表可用。
async function diagKbLoadRoles() {
  const dl = document.getElementById('diagKRoleList');
  if (!dl || dl.options.length) return;
  try {
    const r = await _diagSay('getConfig');
    const names = Object.keys((r && r.config && r.config.roleKeywords) || {});
    if (!names.length || !document.getElementById('diagKRoleList')) return;
    dl.innerHTML = names.map(function (n) { return '<option value="' + _dEsc(n) + '"></option>'; }).join('');
  } catch (_) {}
}
// 「只搬知识库」导出：文件里只有知识条目，导入走旁边「📦 备份 ▾」里的「导入备份」
async function diagKbOnlyExport() {
  if (_diagState.busy) return;
  if (typeof CryptoBox === 'undefined' || !CryptoBox.encryptFile) { _diagKbMessage('diagKListMsg', '当前版本不支持加密导出。', true); return; }
  _diagState.busy = 'kb-export'; _diagKbLock();
  _diagKbMessage('diagKListMsg', '正在读取知识库…');
  try {
    const r = await _diagSay('getKnowledgeBase');
    const entries = (r && r.ok && Array.isArray(r.entries)) ? r.entries : [];
    if (!entries.length) { _diagKbMessage('diagKListMsg', '知识库还是空的，没有可导出的条目。', true); return; }
    _diagKbMessage('diagKListMsg', '已读取 ' + entries.length + ' 条知识，请设置导出口令…');
    const pw = await CryptoBox.askPassword({ title: '设置导出口令', hint: '这份文件只装知识条目（角色 / 配图 / 标签一起走），导入时要用同一口令。', confirm: true, okText: '加密并导出' });
    if (!pw.ok) { _diagKbMessage('diagKListMsg', '已取消导出，知识库未改变。'); return; }
    const text = await CryptoBox.encryptFile(JSON.stringify(entries), pw.password);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = 'knowledge_base_enc_' + Date.now() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
    const summary = '已导出知识库 ' + entries.length + ' 条。换机器 / 换产品时用「📦 备份 ▾」里的「导入备份」：覆盖＝整库替换，合并＝按标题更新。';
    _diagKbMessage('diagKListMsg', summary);
    _diagKbRecord('知识库导出', summary);
  } catch (e) {
    const text = '导出失败：' + (e.message || e) + '。知识库未改变，可重试。';
    _diagKbMessage('diagKListMsg', text, true); _diagKbRecord('知识库导出', text, true);
  } finally {
    _diagState.busy = ''; _diagKbLock();
  }
}
async function diagKbOnlyClear() {
  if (_diagState.busy) return;
  const n = (_diagState.kbEntries || []).length;
  if (!n) { _diagKbMessage('diagKListMsg', '知识库已经是空的。', true); return; }
  if (!confirm('将清空当前产品的全部 ' + n + ' 条知识，不可撤销。\n\n建议先用「📤 只导出知识库」留一份。确定清空吗？')) { _diagKbMessage('diagKListMsg', '已取消清空，知识库未改变。'); return; }
  if (!confirm('再确认一次：真的要清空这 ' + n + ' 条知识吗？')) return;
  _diagState.busy = 'kb-clear'; _diagKbLock();
  _diagKbMessage('diagKListMsg', '正在清空知识库…');
  try {
    const r = await _diagSay('clearKnowledgeBase');
    if (!r || !r.ok) throw new Error((r && r.error) || '清空失败');
    const summary = '已清空知识库（原 ' + n + ' 条）。';
    _diagKbMessage('diagKListMsg', summary);
    _diagKbRecord('知识库清空', summary);
    await diagKbRefresh();
  } catch (e) {
    const text = '清空失败：' + (e.message || e) + '。知识库未改变，可重试。';
    _diagKbMessage('diagKListMsg', text, true); _diagKbRecord('知识库清空', text, true);
  } finally {
    _diagState.busy = ''; _diagKbLock();
  }
}
function _diagKbLock() {
  if (_diagStep !== 5) return;   // 节点 5＝知识库（popup.html #diagSubTabs 的 data-go）
  document.querySelectorAll('#diagBody button, #diagStepBody input, #diagStepBody textarea').forEach(function (el) { el.disabled = !!_diagState.busy; });
  document.querySelectorAll('#diagKRefresh, #diagKList button, #diagKList input, #diagKList textarea').forEach(function (el) { el.disabled = !!(_diagState.busy || _diagState.kbLoading); });
  const textBtn = document.getElementById('diagKImport'), fileBtn = document.getElementById('diagKFileImport');
  if (textBtn) textBtn.textContent = _diagState.busy === 'kb-text' ? '正在 AI 整理并入库…' : 'AI整理并入库';
  if (fileBtn) fileBtn.textContent = _diagState.busy === 'kb-file' ? (_diagState.kbFileLabel || '正在处理文件…') : '开始导入所选文件';
}
function _diagKbRecord(source, text, error) {
  _diagState.kbHistory.unshift({ source: source, text: text, error: !!error, at: Date.now() });
  _diagKbRenderHistory();
}
function _diagKbRenderHistory() {
  const box = document.getElementById('diagKHistory');
  if (box) box.innerHTML = _diagState.kbHistory.length ? '<details><summary>本次录入记录（' + _diagState.kbHistory.length + '）</summary>' + _diagState.kbHistory.map(function (row) {
    return '<div style="margin-top:5px;color:' + (row.error ? '#c62828' : '#555') + ';">' + _dEsc(new Date(row.at).toLocaleTimeString() + ' · ' + row.source + '：' + row.text) + '</div>';
  }).join('') + '</details>' : '';
}
function _diagKbResult(r) {
  return '新增 ' + (Number(r.added) || 0) + ' 条，更新 ' + (Number(r.updated) || 0) + ' 条，跳过 ' + (Number(r.skipped) || 0) + ' 条。' +
    ((Number(r.skipped) || 0) > 0 ? '跳过的是已存在且内容未变化的条目，其他知识均保留。' : '已保留其他知识，关闭弹窗后可在表格中核对整理结果。');
}
async function diagKbImport() {
  if (_diagState.busy) return;
  const input = document.getElementById('diagKImp');
  _diagState.kbDraft = input ? input.value : _diagState.kbDraft;
  if (!_diagState.kbDraft.trim()) { _diagKbMessage('diagKIMsg', '请先粘贴经验、聊天记录或产品说明等原料。', true); return; }
  _diagState.busy = 'kb-text'; _diagKbLock();
  _diagKbMessage('diagKIMsg', '正在整理全部原文并入库，请稍候…');
  try {
    const r = await _diagSay('aiKbImport', { text: _diagState.kbDraft });
    if (!r || !r.ok) throw new Error((r && r.error) || 'AI 整理失败');
    const result = _diagKbResult(r);
    _diagKbMessage('diagKIMsg', result + ' 原文未清空。');
    _diagKbRecord('粘贴粗料 / AI 整理', result);
    await diagKbRefresh();
  } catch (e) {
    const text = '整理失败：' + (e.message || e) + '。原文已保留，请检查 AI 配置或调整原料后重试。';
    _diagKbMessage('diagKIMsg', text, true); _diagKbRecord('粘贴粗料 / AI 整理', text, true);
  } finally { _diagState.busy = ''; _diagKbLock(); }
}
async function diagKbImportFile() {
  if (_diagState.busy) return;
  const files = (_diagState.kbFiles || []).slice();
  if (!files.length) { _diagKbMessage('diagKFMsg', '请先选择要导入的文件，一次可选多个。', true); return; }
  if (files.length > 20) { _diagKbMessage('diagKFMsg', '一次最多导入 20 个文件（当前 ' + files.length + ' 个），请分批处理。', true); return; }
  _diagState.busy = 'kb-file'; _diagKbLock();
  const failures = [], done = [];
  let added = 0, updated = 0, skipped = 0;
  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      _diagState.kbFileLabel = '正在处理 ' + (i + 1) + '/' + files.length + '…';
      _diagKbLock();
      _diagKbMessage('diagKFMsg', '正在处理第 ' + (i + 1) + '/' + files.length + ' 个文件：' + file.name + '…');
      try {
        if (file.size > 2 * 1024 * 1024) throw new Error('超过 2MB，请拆分后重试');
        let text;
        const kind = (typeof KbFile !== 'undefined') ? KbFile.kindOf(file.name) : 'text';
        if (kind === 'docx' || kind === 'xlsx') {
          // Word / Excel 在本机解包抽文字，原文件不上传；抽不出文字时由 KbFile 抛错
          text = (await KbFile.extract(file)).text;
        } else {
          if (kind === 'legacy') throw new Error('旧版 Office 格式读不了，请在 Word / Excel / WPS 里另存为 .docx / .xlsx 或 TXT 后重试');
          text = (await file.text()).replace(/^\uFEFF/, '');
          if (!text.trim()) throw new Error('文件为空');
          if (typeof CryptoBox !== 'undefined' && CryptoBox.isFileEnvelope(text)) throw new Error('这是加密备份文件，请用旁边「📦 备份 ▾」里的「导入备份」恢复');
          if (text.indexOf('\u0000') >= 0) throw new Error('看起来不是文本文件，请另存为 TXT / MD / CSV，或把 Word / Excel 另存为 .docx / .xlsx');
        }
        const r = await _diagSay('aiKbImport', { text: text, format: 'file', filename: file.name });
        if (!r || !r.ok) throw new Error((r && r.error) || '整理失败');
        added += Number(r.added) || 0; updated += Number(r.updated) || 0; skipped += Number(r.skipped) || 0;
        done.push(file.name);
      } catch (e) {
        failures.push({ file: file, why: e.message || String(e) });
      }
    }
    const summary = failures.length
      ? '处理完成，共 ' + files.length + ' 个文件：成功 ' + done.length + ' 个（新增 ' + added + ' 条，更新 ' + updated + ' 条，跳过 ' + skipped + ' 条' + (done.length ? '，' + done.join('、') : '') + '）；失败 ' + failures.length + ' 个：' + failures.map(function (f) { return f.file.name + '：' + f.why; }).join('；') + '。失败文件仍保留在列表，修正后可重新导入。'
      : '已导入 ' + files.length + ' 个文件：新增 ' + added + ' 条，更新 ' + updated + ' 条，跳过 ' + skipped + ' 条。';
    _diagKbMessage('diagKFMsg', summary, failures.length > 0);
    _diagKbRecord('批量文件 / ' + files.length + ' 个', summary, failures.length > 0);
    if (done.length) await diagKbRefresh();
  } finally {
    _diagState.kbFiles = failures.map(function (f) { return f.file; });
    _diagState.kbFileLabel = '';
    _diagKbFileName();
    _diagState.busy = ''; _diagKbLock();
    const panel = document.getElementById('diagKAddPanel');
    if (panel && panel.open) document.getElementById('diagKFileImport').focus();
  }
}
/* ── 备份体：当前产品的全套账号资料（问卷答案/人设/卖点/知识库/规划与评估），刻意不含 AI Key ── */
function _diagBkBuild(cfg, stored, entries) {
  return {
    type: 'xhs_profile_backup',
    version: 1,
    exportedAt: Date.now(),
    account: {
      myCity: (cfg && cfg.myCity) || null,
      myAccountNames: (cfg && Array.isArray(cfg.myAccountNames) && cfg.myAccountNames.length) ? cfg.myAccountNames : null,
    },
    diagnosis: (cfg && cfg.diagnosis) || null,
    persona: (cfg && cfg.persona) || null,
    scriptStyle: (cfg && cfg.scriptStyle) || null,
    product: (cfg && cfg.product) || null,
    knowledgeBase: Array.isArray(entries) ? entries : [],
    notePlan: (stored && stored.note_plan) || null,
    deepReport: (stored && stored.deep_report) || null,
  };
}
/** 只认带 type 标记的新版整套备份；旧版纯知识库/数组备份返回 null，走原来的知识库逻辑 */
function _diagBkRead(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.type !== 'xhs_profile_backup') return null;
  return {
    account: parsed.account || null,
    diagnosis: parsed.diagnosis || null,
    persona: parsed.persona || null,
    scriptStyle: parsed.scriptStyle || null,
    product: parsed.product || null,
    knowledgeBase: Array.isArray(parsed.knowledgeBase) ? parsed.knowledgeBase : [],
    notePlan: parsed.notePlan || null,
    deepReport: parsed.deepReport || null,
  };
}
function _diagBkDigest(b) {
  const d = b.diagnosis || {};
  const answers = (Array.isArray(d.answers) ? d.answers : []).filter(function (a) { return a && String(a.answer || '').trim(); }).length;
  const points = (b.product && Array.isArray(b.product.sellPoints)) ? b.product.sellPoints.length : 0;
  const kb = Array.isArray(b.knowledgeBase) ? b.knowledgeBase.length : 0;
  return '问卷 ' + answers + ' 题、人设' + ((b.persona && b.persona.text) ? '已生成' : '未生成') + '、卖点 ' + points + ' 条、知识库 ' + kb +
    ' 条、规划' + (b.notePlan ? '已生成' : '未生成') + '、评估报告' + (b.deepReport ? '已生成' : '未生成');
}
function _diagBkAny(b) {
  const acc = b.account || {};
  return !!((b.diagnosis && (((b.diagnosis.answers || []).length) || b.diagnosis.profile)) || (b.persona && b.persona.text) ||
    b.product || b.scriptStyle || b.notePlan || b.deepReport || (b.knowledgeBase || []).length || (acc.myCity && acc.myCity.city));
}
/** 写回账号资料：合并只补本机没有的资料，覆盖整份替换；知识库仍走 saveKnowledgeBase（合并按标题 / 覆盖整库） */
async function _diagBkApply(bundle, mode) {
  const replace = mode === 'replace';
  const cfg = await _diagGetCfg();
  const stored = await chrome.storage.local.get(['note_plan', 'deep_report']);
  const acc = bundle.account || {};
  const written = [], kept = [], write = {};
  const take = function (label, backup, hasLocal, set) {
    if (!backup) { if (replace) kept.push(label); return; }   // 备份里没这份资料，本机保留
    if (!replace && hasLocal) { kept.push(label); return; }   // 合并：本机已有就不动
    set(); written.push(label);
  };
  take('问卷答案', bundle.diagnosis, !!(cfg.diagnosis && (((cfg.diagnosis.answers || []).length) || cfg.diagnosis.profile)), function () { cfg.diagnosis = bundle.diagnosis; });
  take('人设', (bundle.persona && bundle.persona.text) ? bundle.persona : null, !!(cfg.persona && cfg.persona.text), function () { cfg.persona = bundle.persona; });
  take('产品卖点', bundle.product, !!(cfg.product && (((cfg.product.sellPoints || []).length) || cfg.product.name)), function () { cfg.product = bundle.product; });
  take('话术风格', bundle.scriptStyle, !!(cfg.scriptStyle && Object.keys(cfg.scriptStyle).length), function () { cfg.scriptStyle = bundle.scriptStyle; });
  take('同城城市', (acc.myCity && acc.myCity.city) ? acc.myCity : null, !!(cfg.myCity && cfg.myCity.city), function () { cfg.myCity = acc.myCity; });
  take('我的账号名', acc.myAccountNames, !!(Array.isArray(cfg.myAccountNames) && cfg.myAccountNames.length), function () { cfg.myAccountNames = acc.myAccountNames; });
  take('内容规划', bundle.notePlan, !!stored.note_plan, function () { write.note_plan = bundle.notePlan; });
  take('评估报告', bundle.deepReport, !!stored.deep_report, function () { write.deep_report = bundle.deepReport; });
  if (written.length) {
    if (Object.keys(write).length) await chrome.storage.local.set(write);
    await _diagSaveCfg(cfg);
  }
  if (!bundle.knowledgeBase.length) return { replace: replace, written: written, kept: kept, kbText: '备份里没带知识，本机知识库保留' };
  const r = await _diagSay('saveKnowledgeBase', { entries: bundle.knowledgeBase, mode: replace ? 'replace' : 'merge' });
  if (!r || !r.ok) throw new Error((r && r.error) || '写入知识库失败');
  return { replace: replace, written: written, kept: kept, kbText: r.mode === 'replace' ? ('知识库已覆盖，共 ' + r.total + ' 条') : _diagKbResult(r) };
}
/** 导入整套资料后把内存状态对齐盘上的数据，免得导航圈和后续页面还显示旧资料 */
async function _diagBkReloadState() {
  const r = await Promise.all([_diagGetCfg(), chrome.storage.local.get(['note_plan', 'deep_report'])]);
  const cfg = r[0], stored = r[1];
  _diagState.diagnosis = cfg.diagnosis || null;
  _diagState.baseSavedAt = _diagBaseSavedAtOf(cfg);
  _diagState.persona = (cfg.persona && cfg.persona.text) || _diagState.persona;
  _diagState.notePlan = stored.note_plan || null;
  _diagState.report = stored.deep_report || null;
  if (_diagState.diagnosis) {
    _diagState.profile = _diagState.diagnosis.profile || null;
    _diagState.userBio = _diagState.diagnosis.bio == null ? null : String(_diagState.diagnosis.bio);
    _diagState.unifiedAnswers = Array.isArray(_diagState.diagnosis.answers) ? _diagState.diagnosis.answers : [];
    _diagState.accountType = _diagState.diagnosis.accountType || '';
  }
  _diagState.quizDirty = false;
}
/* 「📦 备份」那一颗：点一下直接把当前产品的全套资料导成加密 JSON（不再开一页选来选去） */
async function diagKbExport() {
  if (_diagState.busy) return;
  if (typeof CryptoBox === 'undefined' || !CryptoBox.encryptFile) { _diagKbMessage('diagKListMsg', '当前版本不支持加密导出。', true); return; }
  _diagState.busy = 'kb-backup'; _diagKbLock();
  _diagKbMessage('diagKListMsg', '正在读取当前产品的资料…');
  try {
    const r = await Promise.all([_diagGetCfg(), chrome.storage.local.get(['note_plan', 'deep_report']), _diagSay('getKnowledgeBase')]);
    if (!r[2] || !r[2].ok || !Array.isArray(r[2].entries)) throw new Error((r[2] && r[2].error) || '未返回知识条目');
    const bundle = _diagBkBuild(r[0], r[1], r[2].entries);
    if (!_diagBkAny(bundle)) { _diagKbMessage('diagKListMsg', '账号资料还是空的，先去「问卷」答完提交一次，再来备份。', true); return; }
    const digest = _diagBkDigest(bundle);
    _diagKbMessage('diagKListMsg', '已读取全套账号资料（' + digest + '），请设置导出口令…');
    const pw = await CryptoBox.askPassword({ title: '设置导出口令', hint: '备份会用这个口令加密，恢复时输入同一口令即可，请自行记好。', confirm: true, okText: '加密并导出' });
    if (!pw.ok) { _diagKbMessage('diagKListMsg', '已取消导出，账号资料未改变。'); return; }
    const text = await CryptoBox.encryptFile(JSON.stringify(bundle), pw.password);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = 'xhs_profile_backup_enc_' + Date.now() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
    const summary = '已导出全套账号资料（' + digest + '）。';
    _diagKbMessage('diagKListMsg', summary);
    _diagKbRecord('备份导出', summary);
  } catch (e) {
    const text = '导出失败：' + (e.message || e) + '。账号资料未改变，可重试。';
    _diagKbMessage('diagKListMsg', text, true); _diagKbRecord('备份导出', text, true);
  } finally {
    _diagState.busy = ''; _diagKbLock();
  }
}
/* KB_CAT 升级：老档 category 兜底迁移 + AI 批量归类入口（一次性） */
async function diagKbBatchCategorize() {
  if (_diagState.busy) return { ok: false, error: '正在处理别的任务' };
  _diagState.busy = 'kb-cat'; _diagKbLock();
  _diagKbMessage('diagKListMsg', '正在读取未归类条目…');
  try {
    const r = await _diagSay('getKnowledgeBase');
    const list = ((r && r.entries) || []).filter(e => e && e.id);
    // 没 category / = 默认 / 不在 8 类里 ＝ 待归类
    const pending = list.filter(e => {
      const c = String(e.category || '').trim();
      if (!c) return true;
      if (c === '默认' || c === '未分类' || c === '通用') return true;
      return KB_CATEGORIES.indexOf(c) < 0;
    });
    if (!pending.length) { _diagKbMessage('diagKListMsg', '✅ 所有条目都已归到 8 类之一，无需批量归类。'); return { ok: true, assigned: 0, total: 0 }; }
    _diagKbMessage('diagKListMsg', '发现 ' + pending.length + ' 条未归类，正在分批调 AI（每批 ≤ 30 条）…');
    let assigned = 0, skipped = 0;
    for (let i = 0; i < pending.length; i += 30) {
      const batch = pending.slice(i, i + 30).map(e => ({ id: e.id, title: e.title || '', content: (e.content || '').slice(0, 300) }));
      let result = null;
      try { result = await _diagSay('aiCategorizeKb', { items: batch }); } catch (e) { console.error('[ai-categorize]', e); }
      const arr = (result && Array.isArray(result.assignments)) ? result.assignments : [];
      const byId = new Map(arr.map(a => [a.id, a.category]));
      for (const e of batch) {
        const cat = byId.get(e.id);
        if (!cat || KB_CATEGORIES.indexOf(cat) < 0) { skipped++; continue; }
        try {
          await _diagSay('updateKnowledgeEntry', { id: e.id, updates: { category: cat } });
          assigned++;
        } catch (_) { skipped++; }
      }
    }
    const summary = '✅ AI 批量归类完成：归了 ' + assigned + ' 条 / 跳过 ' + skipped + ' 条 / 共 ' + pending.length + ' 条。';
    _diagKbMessage('diagKListMsg', summary);
    _diagKbRecord('KB 批量归类', summary);
    await diagKbRefresh();
    return { ok: true, assigned, skipped, total: pending.length };
  } catch (e) {
    const msg = '❌ 批量归类失败：' + (e.message || e);
    _diagKbMessage('diagKListMsg', msg, true);
    return { ok: false, error: msg };
  } finally {
    _diagState.busy = ''; _diagKbLock();
  }
}

/* 「📦 备份 ▾ › 导入备份（合并 / 覆盖）」：选完文件立刻走这里，中间不留「已选择，再点一下开始」那一步 */
async function diagKbBackupImport(mode) {
  if (_diagState.busy) return;
  const file = _diagState.kbBackupFile;
  const label = mode === 'replace' ? '覆盖导入' : '合并导入';
  if (!file) { _diagKbMessage('diagKListMsg', '请先选择导出的 JSON 备份文件。', true); return; }
  _diagState.busy = 'kb-backup'; _diagKbLock();
  _diagKbMessage('diagKListMsg', '正在读取 ' + file.name + '…');
  let bundle = null;   // 新版整套备份；旧版纯知识库备份始终为 null，走下面的旧逻辑
  try {
    if (file.size > 32 * 1024 * 1024) throw new Error('备份文件超过 32MB，请拆分后再导入');
    let text = (await file.text()).replace(/^\uFEFF/, '');
    if (!text.trim()) throw new Error('文件为空，请重新选择备份文件');
    if (typeof CryptoBox !== 'undefined' && CryptoBox.isFileEnvelope(text)) {
      _diagKbMessage('diagKListMsg', '这是加密备份，请先输入口令…');
      const pw = await CryptoBox.askPassword({ title: '输入备份口令', hint: '请输入导出这份备份时设置的口令。', okText: '解密并导入' });
      if (!pw.ok) { _diagKbMessage('diagKListMsg', '已取消解密，账号资料未改变。'); return; }
      try { text = await CryptoBox.decryptFile(text, pw.password); }
      catch (_) { throw new Error('解密失败，请确认口令是否正确'); }
    }
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) { throw new Error('JSON 解析失败，请确认选择的是备份文件'); }
    bundle = _diagBkRead(parsed);
    const entries = bundle ? bundle.knowledgeBase : (Array.isArray(parsed) ? parsed : parsed && (parsed.entries || parsed.knowledge_base || parsed.knowledgeBase || parsed.items || parsed.data));
    if (bundle) {
      if (!_diagBkAny(bundle)) throw new Error('备份里没有可恢复的账号资料');
      if (mode === 'replace' && !confirm('将用备份里的账号资料（' + _diagBkDigest(bundle) + '）替换当前产品的问卷、人设、卖点、知识库与规划，本地已有的同类资料会被覆盖且不可撤销。确定覆盖吗？')) {
        _diagKbMessage('diagKListMsg', '已取消覆盖，账号资料未改变。'); return;
      }
      _diagKbMessage('diagKListMsg', '正在写入账号资料…');
      const applied = await _diagBkApply(bundle, mode);
      const head = (applied.replace ? '已用备份替换账号资料：' : '已合并账号资料：') +
        (applied.written.length ? (applied.replace ? applied.written.join('、') : '补上 ' + applied.written.join('、')) : '本机已有同类资料，均保留本机');
      const summary = head + (applied.kept.length ? '（' + applied.kept.join('、') + '保留本机）' : '') + '；' + applied.kbText + '。';
      await _diagBkReloadState();
      _diagKbMessage('diagKListMsg', file.name + '：' + summary);
      _diagKbRecord('备份' + label + ' / ' + file.name, summary);
      _diagState.kbBackupFile = null;
      const input = document.getElementById('diagKBackupFile'); if (input) input.value = '';
      await diagKbRefresh();
      return;
    }
    if (!Array.isArray(entries) || !entries.length) throw new Error('备份里没有知识条目');
    if (mode === 'replace' && !confirm('将用备份里的 ' + entries.length + ' 条知识覆盖当前全部知识，原有条目会被删除且不可撤销。确定覆盖吗？')) {
      _diagKbMessage('diagKListMsg', '已取消覆盖，知识库未改变。'); return;
    }
    _diagKbMessage('diagKListMsg', '正在写入知识库…');
    const r = await _diagSay('saveKnowledgeBase', { entries: entries, mode: mode });
    if (!r || !r.ok) throw new Error((r && r.error) || '导入失败');
    const summary = r.mode === 'replace' ? ('已用备份覆盖知识库，共 ' + r.total + ' 条。') : _diagKbResult(r);
    _diagKbMessage('diagKListMsg', file.name + '：' + summary);
    _diagKbRecord('备份' + label + ' / ' + file.name, summary);
    _diagState.kbBackupFile = null;
    const input = document.getElementById('diagKBackupFile'); if (input) input.value = '';
    await diagKbRefresh();
  } catch (e) {
    // 整套备份是资料+知识库分步写入的，中断时可能只写进去一部分，别谎报「未改变」
    const tail = bundle ? '导入可能只完成了一部分，请刷新列表核对后重试。' : '知识库未改变，可修正后重试。';
    const text = label + '失败：' + (e.message || e) + '。' + tail;
    _diagKbMessage('diagKListMsg', text, true); _diagKbRecord('备份' + label + ' / ' + file.name, text, true);
  } finally {
    _diagState.busy = ''; _diagKbLock();
    _diagPaintNav();   // 导入可能带来新的问卷/人设/规划，导航圈的完成态要跟着变
  }
}
var _diagKbLoadSeq = 0;
async function diagKbRefresh() {
  const box = document.getElementById('diagKList');
  if (!box) return;
  const seq = ++_diagKbLoadSeq;
  _diagState.kbLoading = true; _diagKbLock();
  const refresh = document.getElementById('diagKRefresh');
  if (refresh) refresh.textContent = '读取中…';
  _diagKbMessage('diagKListMsg', '正在读取知识库…');
  try {
    const r = await _diagSay('getKnowledgeBase');
    if (!r || !r.ok || !Array.isArray(r.entries)) throw new Error((r && r.error) || '未返回知识条目');
    if (document.getElementById('diagKList') !== box || seq !== _diagKbLoadSeq) return;
    _diagState.kbEntries = r.entries;
    _diagState.kbCount = r.entries.length;
    diagKbRenderList();
    _diagKbMessage('diagKListMsg', '');
  } catch (e) {
    if (document.getElementById('diagKList') === box && seq === _diagKbLoadSeq) _diagKbMessage('diagKListMsg', '读取失败：' + (e.message || e) + '。请点击“刷新列表”重试。', true);
  } finally {
    if (seq === _diagKbLoadSeq) {
      _diagState.kbLoading = false;
      if (refresh) refresh.textContent = '刷新列表';
      _diagKbLock();
    }
  }
}
/* 知识库分类下拉的选项随库里的分类重建（签名没变就不重建，免得把用户的选择冲掉） */
function diagKbFilterPaint() {
  const sel = document.getElementById('diagKFilterCat');
  if (!sel) return;
  const cats = [];
  (_diagState.kbEntries || []).forEach(function (e) {
    const c = String((e && e.category) || '').trim();
    if (c && cats.indexOf(c) < 0) cats.push(c);
  });
  cats.sort();
  const sig = cats.join('\u0001');
  if (sel.dataset.sig !== sig) {
    sel.dataset.sig = sig;
    sel.innerHTML = '<option value="">全部分类</option>' + cats.map(function (c) { return '<option value="' + _dEsc(c) + '">' + _dEsc(c) + '</option>'; }).join('');
  }
  if (cats.indexOf(_diagState.kbFilterCat || '') < 0) _diagState.kbFilterCat = '';
  sel.value = _diagState.kbFilterCat || '';
  const st = document.getElementById('diagKFilterStatus');
  if (st) st.value = _diagState.kbFilterStatus || '';
}
function diagKbRenderList() {
  const box = document.getElementById('diagKList');
  if (!box) return;
  const entries = _diagState.kbEntries || [], search = (_diagState.kbSearch || '').trim().toLowerCase();
  diagKbFilterPaint();
  const cat = _diagState.kbFilterCat || '', status = _diagState.kbFilterStatus || '';
  const tagsOf = function (e) { return Array.isArray(e.tags) ? e.tags.map(String) : e.tags ? [String(e.tags)] : []; };
  const filtered = entries.map(function (entry, index) { return { entry: entry, index: index }; }).filter(function (row) {
    const e = row.entry;
    if (!e) return false;
    if (cat && String(e.category || '').trim() !== cat) return false;
    if (status && (status === 'off') !== (e.isActive === false)) return false;
    return !search || [e.title, e.content, e.category].concat(tagsOf(e)).join('\n').toLowerCase().includes(search);
  });
  const stats = document.getElementById('diagKStats');
  if (stats) stats.textContent = '总数 ' + entries.length + ' 条 · 启用 ' + entries.filter(function (e) { return e && e.isActive !== false; }).length + ' 条 · 匹配 ' + filtered.length + ' 条';
  // 正文就摆在行里（限 80 字）：原来那颗「查看」点开了也只看正文，那不如直接显示（老板口径）
  box.innerHTML = '<table aria-label="知识库"><colgroup><col style="width:46%"><col style="width:13%"><col style="width:12%"><col style="width:29%"></colgroup>' +
    '<thead><tr><th scope="col">知识标题 / 正文 / 标签</th><th scope="col">分类</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>' +
    (filtered.length ? filtered.map(function (row) {
      const e = row.entry;
      const peek = String(e.content || '').replace(/\s+/g, ' ').trim();
      return '<tbody class="diag-kb-item" data-index="' + row.index + '"><tr class="diag-kb-row">' +
        '<td><b>' + _dEsc(e.title || '未命名知识') + '</b>' +
        (peek ? '<div class="diag-kb-note" style="color:#555;">' + _dEsc(peek.length > 80 ? peek.slice(0, 80) + '…' : peek) + '</div>' : '') +
        '<div class="diag-kb-note">' + _dEsc(tagsOf(e).join('、') || '无标签') + '</div></td>' +
        '<td>' + _dEsc(e.category || '未分类') + '</td><td><span class="diag-kb-status' + (e.isActive === false ? ' off' : '') + '">' + (e.isActive === false ? '已停用' : '启用中') + '</span></td>' +
        '<td><div class="diag-kb-actions"><button type="button" class="btn btn-outline diag-kb-edit-btn">编辑</button>' +
        '<button type="button" class="btn btn-outline diag-kb-toggle">' + (e.isActive === false ? '启用' : '停用') + '</button></div>' +
        '<div class="diag-kb-entry-msg diag-kb-note" role="status"></div></td></tr></tbody>';
    }).join('') : '<tbody><tr><td colspan="4" class="diag-kb-note">' + (entries.length ? '没有匹配的知识，换个搜索词或筛选项试试。' : '暂无知识，点击「新增知识」添加第一条。') + '</td></tr></tbody>') + '</table>';
  box.querySelectorAll('.diag-kb-item').forEach(function (row) {
    const entry = entries[Number(row.dataset.index)];
    const msg = row.querySelector('.diag-kb-entry-msg');
    row.querySelector('.diag-kb-toggle').onclick = function () {
      if (_diagState.busy || _diagState.kbLoading) return;
      diagKbUpdate(entry, { isActive: entry.isActive === false }, msg);
    };
    row.querySelector('.diag-kb-edit-btn').onclick = function () {
      if (_diagState.busy || _diagState.kbLoading) return;
      diagKbOpenEdit(entry);
    };
  });
  _diagKbLock();
}
/* 编辑知识弹窗：一次只改一条，字段灌进 dialog，保存后回列表（不再在原列表就地展开表单） */
function _diagKbEditEntry() {
  const id = _diagState.kbEditId;
  if (!id) return null;
  return (_diagState.kbEntries || []).filter(function (e) { return e && e.id === id; })[0] || null;
}
function _diagKbEditImgPaint() {
  const wrap = document.getElementById('diagKEditImgWrap'), prev = document.getElementById('diagKEditImgPrev');
  const src = String(_diagState.kbEditImage || '');
  if (wrap) wrap.hidden = !src;
  if (prev) { if (src) prev.src = src; else prev.removeAttribute('src'); }
}
/* ★ KB 输入实时校验：三个必填字段（标题 / 正文 / 分类）为空就加红框类
     调一次就能跑一次——打开编辑时跑一次（编辑老条目的也校验），
     三个字段 oninput 时跑一次，保存失败时也跑一次（让红框与红字同步）
     拓展：标题字数提示 / 分类=默认软警示 / tag 格式错红框 */
function _diagKbParseTags(raw) {
  const text = String(raw || '').trim();
  if (!text) return { ok: true, tags: [] };
  try {
    const v = text.startsWith('[') ? JSON.parse(text) : text.split(/[,，、\n]/).map(function (t) { return String(t).trim(); }).filter(Boolean);
    if (!Array.isArray(v) || v.some(function (t) { return typeof t !== 'string'; })) throw new Error();
    return { ok: true, tags: v };
  } catch (_) { return { ok: false, tags: [] }; }
}
function _diagKbValidateEdit() {
  const panel = document.getElementById('diagKEditPanel');
  if (!panel) return;
  /* 标题 / 正文 / 分类 三必填：空就红 */
  const required = ['diagKEditTitleIn', 'diagKEditContent', 'diagKEditCat'];
  required.forEach(function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    const bad = !String((el.value || '')).trim();
    el.classList.toggle('diag-kb-input-bad', bad);
  });
  /* 标题字数：右下提示，接近上限（≥64/80）变橙警示 */
  const tEl = document.getElementById('diagKEditTitleIn');
  const cnt = document.getElementById('diagKEditTitleCnt');
  if (tEl && cnt) {
    const len = String(tEl.value || '').length;
    const near = len >= 64;
    cnt.textContent = len + '/80';
    cnt.classList.toggle('warn', near);
  }
  /* 分类=「默认」：软警示（黄边 + 小字提示换 8 类）—— 这是 KB_CAT 升级的过渡态 */
  const cEl = document.getElementById('diagKEditCat');
  const cTip = document.getElementById('diagKEditCatTip');
  if (cEl) {
    const empty = !String(cEl.value || '').trim();
    const isDefault = !empty && String(cEl.value || '').trim() === '默认';
    cEl.classList.toggle('diag-kb-input-warn', isDefault);
    if (cTip) {
      if (isDefault) {
        cTip.textContent = '⚠ 「默认」= 未分类，建议换成 8 类之一（产品介绍 / 玩法与机制 / 数据·成本 / 顾客痛点 / 避坑经验 / 个人经历 / 使用技巧 / 笔记架构）';
        cTip.classList.add('warn');
      } else {
        cTip.textContent = '';
        cTip.classList.remove('warn');
      }
    }
  }
  /* tag 格式：解析失败 → 红 */
  const tagEl = document.getElementById('diagKEditTags');
  const tagTip = document.getElementById('diagKEditTagsTip');
  if (tagEl && tagTip) {
    const raw = String(tagEl.value || '');
    const r = _diagKbParseTags(raw);
    if (raw.trim() && !r.ok) {
      tagEl.classList.add('diag-kb-input-bad');
      tagTip.textContent = '❌ 标签格式有误：用逗号 / 顿号 / 换行分隔，或 JSON 数组（如 ["A","B"]）';
      tagTip.classList.add('warn');
    } else {
      tagEl.classList.remove('diag-kb-input-bad');
      tagTip.classList.remove('warn');
      tagTip.textContent = raw.trim() ? ('已解析 ' + r.tags.length + ' 个标签') : '示例：流量焦虑、付费转化、复购';
    }
  }
}
function diagKbOpenEdit(entry) {
  const panel = document.getElementById('diagKEditPanel');
  if (!panel || !entry) return;
  _diagState.kbEditId = entry.id;
  const set = function (id, v) { const el = document.getElementById(id); if (el) el.value = v == null ? '' : v; };
  set('diagKEditTitleIn', entry.title);
  set('diagKEditContent', entry.content);
  set('diagKEditCat', entry.category);
  set('diagKEditRole', entry.role);
  set('diagKEditTags', Array.isArray(entry.tags) ? entry.tags.join('、') : String(entry.tags || ''));
  const ck = panel.querySelector('.diag-kb-active');
  if (ck) ck.checked = entry.isActive !== false;
  const file = document.getElementById('diagKEditImgFile');
  if (file) file.value = '';
  _diagState.kbEditImage = String(entry.image || '');
  _diagKbEditImgPaint();
  _diagKbMessage('diagKEditMsg', '');
  if (!panel.open) panel.showModal();
  const t = document.getElementById('diagKEditTitleIn');
  if (t) t.focus();
  _diagKbValidateEdit();
}
function diagKbEditClose() {
  const panel = document.getElementById('diagKEditPanel');
  if (panel && panel.open) panel.close();
  _diagState.kbEditId = '';
  _diagState.kbEditImage = '';
}
async function diagKbEditSave() {
  const entry = _diagKbEditEntry();
  if (!entry) { diagKbEditClose(); return; }
  const val = function (id) { return String(((document.getElementById(id) || {}).value) || '').trim(); };
  const title = val('diagKEditTitleIn'), content = val('diagKEditContent');
  if (!title || !content) { _diagKbMessage('diagKEditMsg', '标题和正文不能为空，请补充后保存。', true); _diagKbValidateEdit(); return; }
  // ★ KB_CAT 升级：分类必填——不填就拒存 + 红字标
  const cat = val('diagKEditCat');
  if (!cat) { _diagKbMessage('diagKEditMsg', '分类不能为空。8 选 1 即可，不确定就点下拉里的「笔记架构」归到内容结构类。', true); _diagKbValidateEdit(); return; }
  let tags;
  const raw = String(((document.getElementById('diagKEditTags') || {}).value) || '');
  const tr = _diagKbParseTags(raw);
  if (!tr.ok) { _diagKbMessage('diagKEditMsg', '标签格式有误，请用逗号分隔或有效的 JSON 字符串数组。', true); _diagKbValidateEdit(); return; }
  tags = tr.tags;
  const ck = document.querySelector('#diagKEditPanel .diag-kb-active');
  const ok = await diagKbUpdate(entry, {
    title: title, content: content, category: cat, role: val('diagKEditRole'),
    tags: tags, isActive: !!(ck && ck.checked), image: _diagState.kbEditImage || null,
  }, document.getElementById('diagKEditMsg'));
  if (ok) diagKbEditClose();
}
async function diagKbUpdate(entry, updates, msg) {
  if (_diagState.busy) return false;
  if (!entry || !entry.id) {
    if (msg) { msg.style.color = '#c62828'; msg.textContent = '此条目缺少 ID，请刷新列表后再试。'; }
    return false;
  }
  _diagState.busy = 'kb-edit'; _diagKbLock();
  if (msg) { msg.style.color = '#0a7b5a'; msg.textContent = '正在保存…'; }
  try {
    const r = await _diagSay('updateKnowledgeEntry', { id: entry.id, updates: updates });
    if (!r || !r.ok) throw new Error((r && r.error) || '保存失败');
    if (msg) msg.textContent = '已保存';
    await diagKbRefresh();
    return true;
  } catch (e) {
    if (msg) { msg.style.color = '#c62828'; msg.textContent = '保存失败：' + (e.message || e) + '。修改仍保留，可重试。'; }
    return false;
  } finally {
    _diagState.busy = ''; _diagKbLock();
  }
}
/* ── 📄 内容基调 / 🎨 出图风格（账号默认）
      2026-10-21 老板定稿：不再单开「任务配置」一页——两张默认表搬回写稿：
      · 📄 内容基调 嵌在 ③ 挑稿页（打开时画进 #diagToneEmbed）；
      · 🎨 出图风格 嵌在 ⑤ 分镜确认页的「生成前定一次」（#diagLookEmbed）。
      两个嵌入块由发笔记那边开合、wbGate('diag') 把这一包请进来后调 diagStyleRestore() 画。
      · 内容基调＝4 基调一条一张卡：主行拖条拨 铺垫/广告（写法全跟主行走），写法只拨各自字数
        （账号默认存 config.noteStyle.lines / .kinds；一格清空＝删条＝回退上一档）；
      · 出图风格＝画面风格三小样（＋自己加一种）＋印记三选＋🗂 笔记分类开关＋配文版式 15 种＋172×230 预览
        （按「💾 保存出图风格」才落 config.imgLook）。 ── */
function _ntCfgSt() {
  if (!_diagState.ntCfg) _diagState.ntCfg = { linesOpen: true, kindsOpen: {}, motifOpen: false, motifErr: '', busy: false, err: '', dirty: false };
  return _diagState.ntCfg;
}
/* ── 🧬 笔记规划签：一段「怎么用发笔记」＋🗓 每周排法 ＋ 🧠 AI规划 ── */
function _diagPersonaTableHtml() {
  const kinds = ['知识', '引流'];
  const wkName = { '知识': '📚 知识', '引流': '🔥 引流' };
  const wp = _diagState.weekPlan || {};
  const dayRow = function (d) {
    const sel = wp[d[0]] || [];
    return '<div style="display:flex;align-items:center;gap:12px;padding:9px 2px;border-top:1px solid var(--line,#eceef0);">' +
      '<span style="flex:none;width:56px;font-size:13px;font-weight:700;color:#1f2329;">' + d[1] + '</span>' +
      '<span style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
        kinds.map(function (k) {
          return '<button type="button" class="npar-filter ntWeekChip' + (sel.indexOf(k) >= 0 ? ' on' : '') + '" data-day="' + d[0] + '" data-k="' + k + '" style="padding:7px 16px;font-size:12.5px;font-weight:700;">' + wkName[k] + '</button>';
        }).join('') +
        (sel.length ? '' : '<span style="font-size:11.5px;color:#b6bec9;">休</span>') +
      '</span></div>';
  };
  // 📌 阶段计划：当前阶段那档的发频（知识/引流/案例）＋多发方面两份输入（K 线 ① 那行读知识这条）
  const skey = NP_STAGES.indexOf(_ntStageKey()) >= 0 ? _ntStageKey() : 'cold';
  const spl = (_diagState.stagePlan || {})[skey] || npStagePlanDefaults(skey);
  const rateRow = function (label, line) {
    return '<div style="display:flex;align-items:center;gap:12px;padding:7px 2px;border-top:1px solid var(--line,#eceef0);">' +
      '<span style="flex:none;width:64px;font-size:12.5px;font-weight:700;color:#1f2329;">' + label + '</span>' +
      '<span style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
        ['主发', '常发', '少发'].map(function (v) {
          return '<button type="button" class="npar-filter spRate' + (spl[line] === v ? ' on' : '') + '" data-line="' + line + '" data-v="' + v + '" style="padding:7px 16px;font-size:12.5px;font-weight:700;">' + v + '</button>';
        }).join('') +
      '</span></div>';
  };
  const catsRow = function (label, field, ph) {
    return '<div style="display:flex;align-items:center;gap:12px;padding:7px 2px;border-top:1px solid var(--line,#eceef0);">' +
      '<span style="flex:none;width:64px;font-size:12.5px;font-weight:700;color:#1f2329;">' + label + '</span>' +
      '<input type="text" class="spCats" data-field="' + field + '" value="' + _dEsc((spl[field] || []).join('、')) + '" placeholder="' + _dEsc(ph) + '" style="flex:1;min-width:0;border:1px solid var(--line,#e2e6ec);border-radius:8px;padding:5px 9px;font-size:12px;font-family:inherit;box-sizing:border-box;">' +
      '</div>';
  };
  const cnt = { '知识': 0, '引流': 0 };
  let rest = 0;
  NP_WEEK_DAYS.forEach(function (d) { const s = wp[d] || []; if (!s.length) rest++; s.forEach(function (k) { if (cnt[k] != null) cnt[k]++; }); });
  const sum = kinds.map(function (k) { return cnt[k] ? (wkName[k] + ' ' + cnt[k] + ' 天') : ''; }).filter(Boolean).join(' · ') + (rest ? ' · 休 ' + rest + ' 天' : '');
  const st = _ntCfgSt();
  return '<div style="margin-top:10px;">' +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><b style="font-size:12.5px;color:#1f2329;">🧬 笔记规划</b>' +
      '<button type="button" class="btn btn-sm" id="diagStyleRun">' + (st.busy ? 'AI 正在排…' : '🧠 AI规划') + '</button></div>' +
    (st.err ? '<div style="font-size:11px;color:#c62828;margin-top:4px;">' + _dEsc(st.err) + '</div>' : '') +
    '<div style="margin-top:8px;padding:9px 12px;background:#fafbfc;border-radius:8px;font-size:12px;color:#4b5563;line-height:1.9;">' +
      '<b style="color:#374151;">怎么用发笔记</b>：前期先攒干货——新建笔记选「知识」，AI 出稿你过一遍再发，让人记住你是谁；有粉丝了掺引流，评论区把人接住；粉丝过千求稳，照下面的排法固定出，别为了流量乱写。交付形式（图文 / 视频 / 口播）看你自己顺手，没有统一规定。' +
    '</div>' +
    '<div style="margin-top:12px;border:1px solid var(--line,#eceef0);border-radius:10px;padding:10px 12px;background:#fff;">' +
      '<div style="font-size:12.5px;font-weight:700;color:#1f2329;">🗓 每周排法 <span class="note-xs">一天一条线：点另一类＝换成那类，再点一次＝那天休（写进「🗓 笔记规划」小红书那格；抖音/视频号那条视频线到那边改）</span></div>' +
      '<div style="margin-top:2px;">' + NP_WEEK_DAYS.map(function (d) { return dayRow([d, NP_WEEK_DAY_LABEL[d]]); }).join('') + '</div>' +
      '<div style="font-size:11px;color:#6b7280;margin-top:8px;">本周：' + _dEsc(sum || '还没排') + '</div>' +
    '</div>' +
    '<div style="margin-top:12px;border:1px solid var(--line,#eceef0);border-radius:10px;padding:10px 12px;background:#fff;">' +
      '<div style="font-size:12.5px;font-weight:700;color:#1f2329;">📌 阶段计划 <span class="note-xs">当前「' + _dEsc(_ntStageName()) + '」——账号换阶段自动跟着换；发笔记「挑知识」顶上那行读的就是知识这条</span></div>' +
      rateRow('📚 知识', 'k') + rateRow('🔥 引流', 'd') + rateRow('🎬 案例', 'c') +
      catsRow('多发知识', 'kbCats', '类名，用「、」隔开（例：免费测漏、材料保真）') +
      catsRow('多发引流', 'drainCats', '方向名，用「、」隔开（例：🔥 热点、😹 热梗）') +
    '</div>' +
  '</div>';
}
/** 勾/取消一天里的一类：先落内存再写库（写进三行表 weekPlanGrid），写完按库回读的规整值刷新 */
async function _ntWeekToggle(day, k) {
  const st = _ntCfgSt();
  const wp = Object.assign({}, _diagState.weekPlan || npWeekPlanEmpty());
  /* 一天一条线（2026-11-01 起写进「🗓 笔记规划」的三行表）：点另一类＝换成那类；再点当前那类＝这天休 */
  const arr = (wp[day] || []).slice();
  wp[day] = (arr[0] === k) ? [] : [k];
  _diagState.weekPlan = wp;
  st.err = '';
  diagRenderStyle();
  try { _diagState.weekPlan = await npPlanWeekViewSave(wp); }
  catch (e) { st.err = '周排保存失败：' + String((e && e.message) || e); diagRenderStyle(); }
}
/** 📌 阶段计划两拨键：发频（主发/常发/少发）与多发方面（「、」隔开的短名单）——都是先落内存再写库，写完按库回读的规整值重画 */
function _ntSpCur() {
  const skey = NP_STAGES.indexOf(_ntStageKey()) >= 0 ? _ntStageKey() : 'cold';
  return { skey: skey, cur: Object.assign({}, (_diagState.stagePlan || {})[skey] || npStagePlanDefaults(skey)) };
}
async function _ntSpRate(line, v) {
  if (['k', 'd', 'c'].indexOf(line) < 0 || ['主发', '常发', '少发'].indexOf(v) < 0) return;
  const p = _ntSpCur();
  if (p.cur[line] === v) return;
  const plan = Object.assign({}, _diagState.stagePlan || {});
  p.cur[line] = v;
  plan[p.skey] = p.cur;
  _diagState.stagePlan = plan;
  _ntCfgSt().err = '';
  diagRenderStyle();
  try { _diagState.stagePlan = await npStagePlanSave(plan); }
  catch (e) { _ntCfgSt().err = '阶段计划保存失败：' + String((e && e.message) || e); diagRenderStyle(); }
}
async function _ntSpCats(field, value) {
  if (field !== 'kbCats' && field !== 'drainCats') return;
  const p = _ntSpCur();
  const list = String(value || '').split(/[、,，\s]+/).map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 12);
  const plan = Object.assign({}, _diagState.stagePlan || {});
  p.cur[field] = list;
  plan[p.skey] = p.cur;
  _diagState.stagePlan = plan;
  _ntCfgSt().err = '';
  try { _diagState.stagePlan = await npStagePlanSave(plan); }
  catch (e) { _ntCfgSt().err = '阶段计划保存失败：' + String((e && e.message) || e); diagRenderStyle(); return; }
  diagRenderStyle();   // 回读后的规整值重画（分隔符统一成「、」，超 12 条被裁）
}
/** 一句话人设：问卷里自己写的为准，没写就看 AI 按资料写的那句（AI规划把它当上下文） */
async function _diagStyleRun() {
  const st = _ntCfgSt();
  if (st.busy) return;
  st.busy = true; st.err = '';
  diagRenderStyle();
  try {
    let prof = _diagState.profile;
    if (!prof) { try { const c = await _diagGetCfg(); prof = (c && c.diagnosis && c.diagnosis.profile) || null; } catch (_) {} }
    const r = await _diagSay('aiWeekPlan', { profile: prof, personaLine: _ntPersonaLine() });
    if (!r || r.ok === false || !r.weekPlan) throw new Error((r && r.error) || 'AI 没返回可用排法，请重试');
    _diagState.weekPlan = await npPlanWeekViewSave(r.weekPlan);
    toast('🧠 AI 排好了这一周的节奏——不满意就点格子改');
  } catch (e) {
    st.err = String((e && e.message) || e);
  }
  st.busy = false;
  diagRenderStyle();
}
/** 问卷里某一题的答案（按题面片段找，不写死下标；答案可能带补充，按分号拆） */
async function diagStyleRestore() {
  // 谁画着就恢复谁：写稿 ③ 的内容基调（#diagToneEmbed）/ 写稿 ⑤ 的出图风格（#diagLookEmbed）/ 发布台「🧬 笔记规划」签（#diagPersonaBox）
  if (!document.getElementById('diagToneEmbed') && !document.getElementById('diagLookEmbed')
      && !document.getElementById('diagPersonaBox')) return;
  try {
    const r = await Promise.all([_diagGetCfg(), chrome.storage.local.get('note_style_advice')]);
    _diagState.noteStyle = (r[0] && r[0].noteStyle) || null;
    _diagState.imgLook = npLookShape(Object.assign({}, NP_LOOK_XHS, (r[0] && r[0].imgLook) || {}));   // 🎨 出图默认：打底＝统一小红书（六十一改）
    await npLoadImgMotifs();                                   // 🎭 账号自加的画面流派（内置十条在 lib/visual-motif.js）
    _diagState.styleAdvice = (r[1] && r[1].note_style_advice) || null;
    _diagState.weekPlan = await npPlanWeekViewRead();         // 🗓 每周排法（真源三行表 weekPlanGrid）
    _diagState.stagePlan = await npStagePlanRead();            // 📌 阶段计划三档（真源 config.product.stagePlan；K 线 ① 那行读它）
  } catch (_) {}
  diagRenderStyle();
}
function diagRenderStyle() {
  // 发布台 · 🧬 笔记规划签：只画它自己那张盒子（页不在＝盒子不在；盒在页不在＝offsetParent 空，跳过）
  const pbox = document.getElementById('diagPersonaBox');
  if (pbox && pbox.offsetParent) {
    pbox.innerHTML = _diagPersonaTableHtml();
    _ntCfgBind(pbox);
  }
  // 写稿 ③ · 📄 内容基调（嵌入块，开着才在）
  const toneBox = document.getElementById('diagToneEmbed');
  if (toneBox && toneBox.offsetParent) {
    toneBox.innerHTML = _diagLinesHtml(true);
    _ntCfgBind(toneBox);
  }
  // 写稿 ⑤ · 🎨 出图风格（嵌入块，开着才在）
  const lookBox = document.getElementById('diagLookEmbed');
  if (lookBox && lookBox.offsetParent) {
    lookBox.innerHTML = _diagLookDefaultHtml(true);
    _ntCfgBind(lookBox);
  }
}
/** 内容基调的配比/字数覆盖挂在哪一格：'t:线key' → noteStyle.lines，'k:写法key' → noteStyle.kinds */
function _diagTargetParts(target) {
  const s = String(target || '');
  const rest = s.slice(2);
  if (s.slice(0, 2) === 'k:') {
    const k = NotePlan.kindOf(rest);
    return k ? { bag: 'kinds', key: k.key, type: k.type, name: k.name } : null;
  }
  if (s.slice(0, 2) === 't:') {
    const t = NotePlan.typeOf(rest);
    return t ? { bag: 'lines', key: t.key, type: t.key, name: t.name } : null;
  }
  return null;
}
/** 这一格的配比底座与字数档：线＝这条线自己改过的那份 → 阶段话术；写法＝写法改过的那份 → 所在那条线 → 出厂 */
function _ntShapeBase(target) {
  const p = _diagTargetParts(target);
  if (!p) return null;
  const ns = _diagState.noteStyle || {};
  const isKind = p.bag === 'kinds';
  const own = (ns[p.bag] || {})[p.key] || null;
  const lineOwn = isKind ? ((ns.lines || {})[p.type] || null) : null;
  const shape = (own && NotePlan.normShape(own.shape)) || (lineOwn && NotePlan.normShape(lineOwn.shape)) || NotePlan.talkShape(_ntTalkAdvice().talk);
  const words = NotePlan.wordsBaseOf(p.type, isKind ? p.key : '', ns);
  return { shape: shape, words: words };
}
/** 拨一格要存进账号默认的那一份：写法只记字数（配比全跟所在那条线走）；线记 {shape, words} */
function _ntShapeApply(target, shape, words) {
  const p = _diagTargetParts(target);
  if (!p) return null;
  const prev = (((_diagState.noteStyle || {})[p.bag]) || {})[p.key] || {};
  const d = _ntShapeBase(target) || {};
  if (p.bag === 'kinds') return { words: words || prev.words || d.words || '' };
  return { shape: shape || prev.shape || d.shape, words: words || prev.words || d.words || '' };
}
/* ── 📄 内容基调签（设计源＝demo _diagLinesHtml）：一条基调一张卡；拖条只在主行拨
      （写法全跟主行走、行里只拨各自字数）；广告占比跟账号阶段走 ── */
// 卡的显示序＝demo 的 [热点 热梗 情绪 感悟] 收尾挂知识·干货（NotePlan.TYPES 自带序不同，显式点名，别跟着 TYPES 走）
const TONE_ORDER = ['hot', 'meme', 'echo', 'tale'];
/* 引流六类料 × 基调挂靠（demo 同款）：引流起笔挑「料」，料挂在哪条基调上就显示在哪张卡上 */
const DRAIN_LINE_MAP = [
  { cats: ['🔥 热点'], line: '热点' },
  { cats: ['😹 热梗'], line: '热梗' },
  { cats: ['💢 情绪', '🎯 被生活打了一下'], line: '情绪' },
  { cats: ['🧭 生活场景', '🏘 本地感悟'], line: '感悟' },
];
/** 这一篇现在按哪档广告占比走：跟账号阶段（冷启动/成长/成熟）走，没抓到主页就先按轻带一句 */
function _ntTalkAdvice() {
  const stageKey = _ntStageKey();
  if (!stageKey) return { talk: NotePlan.sellTalkOf('light'), why: '还没抓到你的主页（不知道粉丝量），先按「轻带一句」走——去「账号规划 → 基础配置」抓一次主页再定。' };
  return NotePlan.talkAdviceFor(stageKey);
}
function _diagLinesHtml(embed) {
  const st = _ntCfgSt();
  const ns = _diagState.noteStyle || {};
  const mixTop = NotePlan.stageTopLines(_ntStageKey(), null, 12);
  const shapeCell = function (target, sh, hasCustom) {
    return '<div style="display:flex;align-items:center;gap:8px;">' +
      '<span style="flex:none;font-size:11px;font-weight:700;color:#8a93a6;">铺垫 <b id="shb_' + target + '" style="font-size:12.5px;color:#1f2329;">' + sh.build + '%</b></span>' +
      '<input type="range" min="0" max="100" step="5" value="' + sh.build + '" class="ntShapeDrag" data-target="' + target + '" style="flex:1;accent-color:var(--c-brand);">' +
      '<span style="flex:none;font-size:11px;font-weight:700;color:var(--c-brand-text);">广告 <b id="shs_' + target + '" style="font-size:12.5px;color:var(--c-brand-text);">' + sh.sell + '%</b></span>' +
      (hasCustom ? '<button type="button" class="btn btn-sm ntShapeReset" data-target="' + target + '" style="padding:1px 6px;font-size:10px;flex:none;" title="恢复默认——这条线不再覆盖，跟阶段那套走">↺</button>' : '') +
    '</div>';
  };
  const wordsCell = function (target, wd) {
    return '<div style="display:flex;gap:4px;flex-wrap:wrap;">' +
      NotePlan.WORDS.map(function (w) {
        return '<button type="button" class="npar-filter ntShapeWords' + (wd && wd.key === w.key ? ' on' : '') + '" data-target="' + target + '" data-w="' + w.key + '" style="padding:2px 8px;font-size:10.5px;">' + esc(w.name) + '</button>';
      }).join('') +
    '</div>' +
    (wd ? '<div class="ntWhat" style="margin-top:3px;">' + esc(wd.range) + '</div>' : '');
  };
  /* 写法折叠区一行一条：名字·说明一句话流下来，字数块贴右边 */
  const wordsInline = function (target, wd) {
    return '<div style="display:flex;gap:4px;align-items:center;flex-wrap:nowrap;">' +
      NotePlan.WORDS.map(function (w) {
        return '<button type="button" class="npar-filter ntShapeWords' + (wd && wd.key === w.key ? ' on' : '') + '" data-target="' + target + '" data-w="' + w.key + '" style="padding:2px 8px;font-size:10.5px;flex:none;">' + esc(w.name) + '</button>';
      }).join('') +
      (wd ? '<span style="font-size:10px;color:#98a1ad;white-space:nowrap;margin-left:2px;">' + esc(wd.range) + '</span>' : '') +
    '</div>';
  };
  const kindRowsHtml = function (t) {
    return (NotePlan.kindsOfType(t.key) || []).map(function (k) {
      const wd = NotePlan.wordsOf(NotePlan.wordsBaseOf(t.key, k.key, ns)) || NotePlan.wordsOf(NotePlan.WORDS_DEFAULT);
      return '<div style="display:flex;gap:12px;align-items:center;padding:6px 4px;border-top:1px dashed #e7eaf0;">' +
        '<div style="flex:1;min-width:0;font-size:11.5px;line-height:1.5;color:#374151;"><b>' + esc(k.name) + '</b><span style="color:#8a929e;">　' + esc(k.form || '') + '</span></div>' +
        '<div style="flex:none;">' + wordsInline('k:' + k.key, wd) + '</div>' +
      '</div>';
    }).join('');
  };
  const toneCard = function (t) {
    if (!t) return '';
    const mix = mixTop.filter(function (r) { return r.type === t.key; })[0];
    const custom = (ns.lines || {})[t.key] || null;
    const sh = (custom && NotePlan.normShape(custom.shape)) || NotePlan.talkShape(_ntTalkAdvice().talk);
    const wd = NotePlan.wordsOf(NotePlan.wordsBaseOf(t.key, '', ns)) || NotePlan.wordsOf(NotePlan.WORDS_DEFAULT);
    const kinds = NotePlan.kindsOfType(t.key) || [];
    const open = !!st.kindsOpen[t.key];
    const cats = DRAIN_LINE_MAP.filter(function (m) { return m.line === t.name; }).map(function (m) { return m.cats.join(' / '); }).join(' · ');
    return '<div style="border:1px solid var(--line,#eceef0);border-radius:12px;background:#fff;padding:12px 14px;margin-top:9px;">' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
        '<b style="font-size:13px;color:#1f2329;">' + (t.emoji || '') + ' ' + esc(t.name) + '</b>' +
        (mix ? '<span class="ntNum">本阶段 ' + mix.count + ' 篇</span>' : '<span class="ntNumOff ntNum">本阶段没排</span>') +
        (cats ? '<span class="ntNum" style="background:#f5f0ff;color:#6d28d9;">引流取料：' + esc(cats) + '</span>' : '') +
        '<span style="flex:1;"></span>' +
        (kinds.length ? '<button type="button" class="npar-filter ntToneFold" data-t="' + t.key + '" style="padding:2px 9px;font-size:10.5px;' + (open ? 'border-color:#6d28d9;background:#f5f0ff;color:#6d28d9;' : '') + '">' + (open ? '▾' : '▸') + ' ' + kinds.length + ' 种写法</button>' : '') +
      '</div>' +
      '<div class="ntWhat" style="margin-top:3px;">' + esc(t.what || '') + '</div>' +
      '<div style="margin-top:8px;">' + shapeCell('t:' + t.key, sh, !!custom) + '</div>' +
      '<div style="margin-top:8px;display:flex;gap:8px;align-items:flex-start;">' +
        '<span style="flex:none;font-size:11px;font-weight:700;color:#8a93a6;padding-top:3px;">🖋 字数</span>' +
        '<div style="flex:1;">' + wordsCell('t:' + t.key, wd) + '</div></div>' +
      (open ? '<div style="margin-top:8px;background:#fafbfd;border-radius:8px;padding:2px 10px;">' + kindRowsHtml(t) + '</div>' : '') +
    '</div>';
  };
  const ad = _ntTalkAdvice();
  const talkLine =
    '<div style="margin-top:10px;padding:8px 10px;background:#fafbfc;border-radius:8px;font-size:11px;color:#6b7280;line-height:1.8;">' +
    '🎚 <b style="color:#374151;">广告占比跟账号阶段走</b>：冷启动期一成 · 成长期两三成 · 成熟期五成——这篇现在按「<b style="color:#374151;">' + esc(_ntStageName()) + '</b>」走「<b style="color:#374151;">' + esc(ad.talk.name) + '</b>」' +
    '。哪种基调想不一样，拖那条卡的条；就一篇的临时拨在 ④ 挑稿页。</div>';
  const head = embed ? '' :
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><b style="font-size:12.5px;color:#1f2329;">📄 内容基调 · 热点 / 热梗 / 情绪 / 感悟</b>' +
    '<span class="qhelp" tabindex="0" data-tip="' + _dEsc('全系统内容基调就 4 种：热点 / 热梗 / 情绪 / 感悟。一张卡一条基调＝账号默认：铺垫/广告拖主行那根条（每种写法全跟主行走，只单独拨字数）；广告占比跟阶段话术走。引流起笔挑「料」（料挂在对应基调上），写法跟着料自动配。发笔记 ③④⑤ 全按这里走。') + '">?</span>' +
    '<span style="flex:1;"></span>' +
    '<button type="button" class="btn btn-sm" id="diagLinesToggle">' + (st.linesOpen ? '收起' : '展开看') + '</button></div>';
  const errLine = st.err ? '<div style="font-size:11px;color:#c62828;margin-top:4px;">' + _dEsc(st.err) + '</div>' : '';
  // demo 收起时连头一起藏（死路：合上就再也够不着）——扩展只留头，展开看够得着；嵌在 ③ 里就整块摊开
  if (!embed && !st.linesOpen) return '<div style="margin-top:10px;">' + head + errLine + '</div>';
  return '<div style="margin-top:' + (embed ? '0' : '10px') + ';">' + head + errLine +
    TONE_ORDER.map(function (k) { return toneCard(NotePlan.typeOf(k)); }).join('') +
    toneCard(NotePlan.typeOf('howto')) +
    talkLine + '</div>';
}
/** 账号默认覆盖的唯一写法：entry 里没内容就把这一格整条删掉（删掉＝回退到上一级默认） */
async function _diagStylePatch(target, entry) {
  const p = _diagTargetParts(target);
  if (!p) return false;
  const ns = Object.assign({}, _diagState.noteStyle || {});
  const bag = Object.assign({}, ns[p.bag] || {});
  const clean = {};
  Object.keys(entry || {}).forEach(function (k) {
    const v = entry[k];
    if (v === null || v === undefined || v === '') return;
    clean[k] = v;
  });
  if (Object.keys(clean).length) bag[p.key] = clean; else delete bag[p.key];
  ns[p.bag] = bag;
  ns.updatedAt = Date.now();
  try {
    await npSaveNoteStyle(ns);
    return true;
  } catch (e) {
    _ntCfgSt().err = '保存失败：' + String((e && e.message) || e);
    return false;
  }
}
/** 拨字数（主行与写法行共用）：那一档写进账号默认，写完整签重画 */
async function _ntShapeWords(target, wkey) {
  const e = _ntShapeApply(target, null, wkey);
  if (!e) return;
  await _diagStylePatch(target, e);
  diagRenderStyle();
}
/** 拖条拖动：只刷这一行两个数字（不整签重画、不掉焦点），松手 _ntShapeDragEnd 收账 */
function _ntShapeDrag(target, v) {
  const build = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  const p = _diagTargetParts(target);
  if (!p) return;
  const e = _ntShapeApply(target, { build: build, sell: 100 - build }, null);
  if (!e) return;
  const ns = Object.assign({}, _diagState.noteStyle || {});
  const bag = Object.assign({}, ns[p.bag] || {});
  bag[p.key] = e;                              // 只落内存：拖到一半别一直写库
  ns[p.bag] = bag;
  _diagState.noteStyle = ns;
  const b = document.getElementById('shb_' + target), s = document.getElementById('shs_' + target);
  if (b) b.textContent = build + '%';
  if (s) s.textContent = (100 - build) + '%';
}
async function _ntShapeDragEnd(target) {
  const p = _diagTargetParts(target);
  if (!p) return;
  const own = (((_diagState.noteStyle || {})[p.bag]) || {})[p.key] || null;
  if (!own) return;
  await _diagStylePatch(target, own);
  diagRenderStyle();
}
/** ↺ 恢复默认：这一格整条删掉（不再覆盖，跟所在那条线／出厂那套走） */
async function _ntShapeReset(target) {
  if (await _diagStylePatch(target, {})) toast('恢复默认——这一格不再覆盖，跟所在那条线／出厂那套走');
  diagRenderStyle();
}
/* 🖼 画面风格：内置三颗＋账号自加的一排平铺（150px 纯 CSS 小样；点哪张＝知识笔记的图长哪张的样子）
   设计源＝demo _diagMotifRowHtml（二十一改）：小样画的是「画面长什么样」不是排版示意；
   这套只管知识笔记的图，引流笔记不限风格（图跟着素材和热点走）。自加的只存名字（≤16 字），三句配方在出图那页补。 */
function _diagMotifRowHtml(embed) {
  const st = _ntCfgSt();
  const cur = (_diagState.imgLook || {}).motif || NP_LOOK_XHS.motif;
  const th = NP_THEME_STYLE[NP_LOOK_XHS.theme] || NP_THEME_STYLE['暗调实拍·单一暖光源'];
  const card = function (k) {
    const on = k === cur;
    return '<button type="button" class="ntMotifChip" data-k="' + _dEsc(k) + '" style="position:relative;text-align:left;width:150px;flex:none;border:1px solid ' + (on ? 'var(--c-brand-line)' : 'var(--c-line)') +
      ';border-radius:10px;overflow:hidden;cursor:pointer;background:#fff;padding:0;font-family:var(--font-ui);box-shadow:' + (on ? '0 0 0 2px var(--c-brand-soft);' : 'none;') + '">' +
      '<div style="position:relative;height:92px;background:' + th.bg + ';">' + cfgMotifSpecimen(k, th) +
        (on ? '<span style="position:absolute;right:6px;top:6px;background:var(--c-brand);color:var(--c-brand-on);font-size:10px;font-weight:800;border-radius:6px;padding:1px 6px;">✓ 在用</span>' : '') +
      '</div>' +
      '<div style="font-size:11.5px;font-weight:700;color:' + (on ? 'var(--c-brand-text)' : 'var(--ink)') + ';padding:6px 9px;">' + esc(k) + '</div>' +
    '</button>';
  };
  return '<div style="margin-top:10px;">' +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><b style="font-size:12.5px;color:var(--ink);">🖼 画面风格' + (embed ? ' · 账号默认' : '') + '</b>' +
      '<span style="font-size:11px;color:#98a1ad;">点哪张，知识笔记的图就长哪张的样子</span>' +
      '<span style="flex:1;"></span>' +
      '<button type="button" class="btn btn-sm ntMotifAdd" style="border:1px dashed #cbb8f0;color:#6d28d9;">＋ 自己加一种</button></div>' +
    '<div class="note-xs" style="margin-top:5px;">这套管的是<b>知识笔记</b>的图——讲事用场景、讲理用方案页、讲步骤用手写；<b>引流笔记不限风格</b>，图跟着素材和热点走。</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">' +
      NP_LOOK_MOTIFS.map(function (x) { return card(x.k); }).join('') +
      _npMotifs.map(function (x) { return card(x.k); }).join('') +
    '</div>' +
    (st.motifOpen ?
      '<div style="border:1px solid #e4dcf5;border-radius:10px;padding:10px;margin-top:8px;background:#fdfcff;">' +
        '<div style="font-size:12px;font-weight:700;color:#6d28d9;">＋ 自己加一种画面风格</div>' +
        '<div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap;">' +
          '<input class="input ntMotifK" id="ntMotifK" maxlength="16" placeholder="如：门店实拍＋大字" style="flex:1;min-width:180px;padding:4px 8px;font-size:12px;">' +
          '<button type="button" class="btn btn-primary btn-sm ntMotifSave">💾 存这一种</button>' +
          '<button type="button" class="btn btn-ghost btn-sm ntMotifAdd">取消</button>' +
          (st.motifErr ? '<span style="color:#c02;font-size:11px;">' + esc(st.motifErr) + '</span>' : '') +
        '</div></div>'
      : '') +
  '</div>';
}
/* 画面风格小样（二十一改：画「画面长什么样」不是排版示意——办公室照/PPT页/手写纸，纯 CSS；自加的名字认不出就摆 🎨） */
function cfgMotifSpecimen(motif, th) {
  if (motif === '人物工作场景' || motif === '真人工作场景') {
    return '<div style="position:absolute;inset:0;overflow:hidden;opacity:.9;">' +
      '<div style="position:absolute;right:4%;top:0;width:36%;height:62%;background:linear-gradient(200deg,rgba(255,238,190,.55),rgba(255,238,190,0));border-radius:8px;"></div>' +
      '<div style="position:absolute;left:10%;bottom:13%;width:80%;height:8%;background:' + th.band + ';border-radius:3px;"></div>' +
      '<div style="position:absolute;left:18%;bottom:21%;width:19%;height:22%;background:' + th.band + ';border-radius:3px 3px 0 0;"></div>' +
      '<div style="position:absolute;right:24%;bottom:21%;width:17%;height:36%;border-radius:46% 46% 12% 12%;background:' + th.band + ';"></div>' +
      '<div style="position:absolute;right:27.5%;bottom:55%;width:10%;height:13%;border-radius:50%;background:' + th.band + ';"></div>' +
      '<div style="position:absolute;left:7%;top:16%;width:7px;height:7px;border-radius:50%;background:' + th.accent + ';box-shadow:0 0 10px ' + th.accent + ';"></div></div>';
  }
  if (motif === '方案页') {
    return '<div style="position:absolute;inset:0;overflow:hidden;">' +
      '<div style="position:absolute;left:9%;top:7%;right:9%;bottom:12%;background:#fff;border-radius:6px;box-shadow:0 5px 16px rgba(0,0,0,.4);overflow:hidden;">' +
        '<div style="position:absolute;left:8%;top:11%;width:40%;height:9%;background:#1f2937;border-radius:2px;"></div>' +
        '<div style="position:absolute;left:8%;top:36%;width:50%;border-top:2px solid #d9dee6;"></div>' +
        '<div style="position:absolute;left:8%;top:50%;width:60%;border-top:2px solid #d9dee6;"></div>' +
        '<div style="position:absolute;left:8%;top:64%;width:42%;border-top:2px solid #d9dee6;"></div>' +
        '<div style="position:absolute;right:7%;top:28%;width:27%;height:42%;background:linear-gradient(160deg,#c9d6ea,#93a9c9);border-radius:4px;"></div>' +
        '<div style="position:absolute;right:8%;bottom:4%;font-size:8px;color:#9aa3af;font-family:var(--font-ui);">3 / 12</div>' +
      '</div></div>';
  }
  if (motif === '手写笔记·纸感') {
    let rows = '';
    for (let i = 0; i < 6; i++) rows += '<div style="position:absolute;left:14%;right:8%;top:' + (24 + i * 11) + '%;border-top:1px solid rgba(63,58,47,.16);"></div>';
    return '<div style="position:absolute;inset:0;overflow:hidden;">' +
      '<div style="position:absolute;left:9%;top:6%;right:9%;bottom:9%;background:linear-gradient(180deg,#f7efdc,#eee2c4);border-radius:5px;box-shadow:0 5px 16px rgba(0,0,0,.4);overflow:hidden;">' +
        '<div style="position:absolute;left:11%;top:0;bottom:0;border-left:2px solid rgba(200,80,60,.38);"></div>' + rows +
        '<div style="position:absolute;left:17%;top:9%;width:42%;height:4px;border-radius:2px;background:rgba(63,58,47,.55);transform:rotate(-1.5deg);"></div>' +
        '<div style="position:absolute;left:17%;top:27%;width:56%;height:3px;border-radius:2px;background:rgba(63,58,47,.38);transform:rotate(.8deg);"></div>' +
        '<div style="position:absolute;left:17%;top:55%;width:36%;height:3px;border-radius:2px;background:rgba(180,83,9,.55);transform:rotate(-.6deg);"></div>' +
      '</div></div>';
  }
  return '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:26px;opacity:.3;">🎨</div>';
}
/* 🎨 出图风格 · 账号默认（设计源＝demo _diagLookDefaultHtml，二十二改）：
   画面风格小样＋📷 画面形式＋🧍 主角一句＋印记三选（不印记 / 文字 / 传图）＋🗂 笔记分类开关＋配文版式 15 种；
   面板上改了都先进内存（dirty），按「💾 保存出图风格」才落 config.imgLook。 */
/* 📷 画面形式 ＋ 🧍 主角（七十一改，老板：「出图文的时候要把风格写清楚：究竟实拍还是随拍还是动漫」）
   这一轴以前只随尾巴出现、面板不摆，引擎读到「实拍」就往广告片靠。在这儿钉两格：
   形式＝界面上选那一个词，提示词只带这一句拍法；主角＝一句话在组头说一次，一套几张不会换六个人。 */
function _diagBornCastingHtml() {
  return '<div style="margin-top:8px;border:1px solid var(--c-brand-line);border-radius:10px;padding:10px 12px;background:#fff;">' +
    '<div style="font-size:12.5px;font-weight:700;color:var(--ink);">\uD83C\uDFA8 画风 <span class="note-xs">跟 IP 角色走</span></div>' +
    '<div style="font-size:11.5px;color:#555;line-height:1.75;margin-top:6px;">' +
      '出图不出真人写实：画风、主角、背景、道具全都跟「\uD83C\uDFAD IP 角色」里那个角色走——角色选的是哪种画风，整张图就按哪种画。' +
      '要换画风，去「\uD83E\uDDEC 账号规划 → \uD83C\uDFAD IP 角色」改那个角色的画风。</div>' +
  '</div>';
}

function _diagLookDefaultHtml(embed) {
  const st = _ntCfgSt();
  const look = _diagState.imgLook || {};
  const mark = look.mark || 'none';
  const classify = !!look.classify;
  const markChips =
    '<button type="button" class="npar-filter ntMarkPick' + (mark === 'none' ? ' on' : '') + '" data-mode="none">不印记</button>' +
    '<button type="button" class="npar-filter ntMarkPick' + (mark === 'text' ? ' on' : '') + '" data-mode="text">文字印记</button>' +
    '<label class="npar-filter ntMarkUp' + (mark === 'upload' ? ' on' : '') + '" style="cursor:pointer;">⬆ 传图<input type="file" accept="image/*" class="ntMarkFile" style="display:none;"></label>';
  let markInline = '';
  if (mark === 'text') {
    markInline = '<input class="input ntMarkText" value="' + _dEsc(look.markText || '') + '" placeholder="盖的字，比如：张师傅 · 防水 10 年" style="flex:1;min-width:160px;max-width:230px;">';
  } else if (mark === 'upload' && look.markImg) {
    markInline = '<img src="' + _dEsc(look.markImg) + '" alt="印记" style="width:30px;height:30px;object-fit:contain;border-radius:7px;border:1px solid var(--c-line);background:#fff;padding:2px;">';
  }
  const curLayout = look.layout || 'big';
  const tpl = npLayoutDef(curLayout);
  const layoutTiles = NP_CAP_LAYOUTS.map(function (x) {
    return '<button type="button" class="ntLayoutTile" data-k="' + x.k + '" style="text-align:left;width:158px;flex:none;border:1px solid ' + (x.k === curLayout ? 'var(--c-brand-line)' : 'var(--c-line)') +
    ';border-radius:10px;padding:8px 10px;cursor:pointer;font-family:var(--font-ui);background:' + (x.k === curLayout ? 'var(--c-brand-soft)' : '#fff') + ';">' +
      '<div style="font-size:12px;font-weight:700;color:' + (x.k === curLayout ? 'var(--c-brand-text)' : 'var(--ink)') + ';">' + (x.k === curLayout ? '✓ ' : '') + esc(x.t) + '</div>' +
      '<div style="font-size:10px;color:#8a929e;line-height:1.55;margin-top:3px;">' + esc(x.d) + '</div>' +
      '<div style="font-size:10px;color:#b6bec9;margin-top:2px;">装饰 ' + (x.dec ? esc(x.dec) : '无') + '</div>' +
    '</button>';
  }).join('');
  return '<div style="margin-top:' + (embed ? '0' : '10px') + ';">' +
    (embed ? '' : '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><b style="font-size:12.5px;color:var(--ink);">🎨 出图风格 · 账号默认</b>' +
      '<span style="font-size:11px;color:#98a1ad;">打底＝统一小红书那一挂（' + NP_LOOK_XHS.motif + '）</span>' +
      '<span class="qhelp" tabindex="0" data-tip="' + _dEsc('出图的账号默认：画面风格（三颗小样——管知识笔记的图，引流笔记不限风格）、印记（不盖 / 文字 / 传图）、笔记分类开关（图上自动盖「知识 / 案例」小标）、配文版式 15 种（每种自带装饰）。右边预览跟着所有选项实时变。改完按「💾 保存出图风格」才算数。') + '">?</span></div>') +
    _diagMotifRowHtml(embed) +
    _diagBornCastingHtml() +
    '<div style="margin-top:12px;border:1px solid var(--c-brand-line);border-radius:10px;padding:10px 12px;background:var(--c-brand-soft);">' +
      '<div style="font-size:12.5px;font-weight:700;color:var(--ink);">🏷 印记 <span class="note-xs">三选一——盖到每张卡上，认脸靠它</span></div>' +
      '<div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-top:8px;">' + markChips + markInline + '</div>' +
    '</div>' +
    '<div style="margin-top:8px;border:1px solid var(--c-line);border-radius:10px;padding:10px 12px;background:#fff;">' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
        '<div style="font-size:12.5px;font-weight:700;color:var(--ink);">🗂 笔记分类 <span class="note-xs">不算印记——单独一个开关</span></div>' +
        '<span class="qhelp" tabindex="0" data-tip="' + _dEsc('开了以后：知识笔记的图自动盖「知识」小标、案例笔记盖「案例」，引流笔记不盖。印记是盖你自己的字/图（认脸用），这个是标笔记类型，两件事分开配；印记位置、盖几张都不影响它。') + '">?</span>' +
        '<span style="flex:1;"></span>' +
        '<button type="button" class="npar-filter ntClassifyPick' + (classify ? '' : ' on') + '" data-v="0">关</button>' +
        '<button type="button" class="npar-filter ntClassifyPick' + (classify ? ' on' : '') + '" data-v="1">开——自动盖「知识 / 案例」小标</button>' +
      '</div>' +
    '</div>' +
    '<div style="margin-top:12px;">' +
      '<div style="font-size:12.5px;font-weight:700;color:var(--ink);">配文版式 <span class="note-xs">挑一个现成模板（' + NP_CAP_LAYOUTS.length + ' 种，装饰已并进每种）</span></div>' +
      '<div style="display:flex;gap:10px;align-items:flex-start;margin-top:6px;flex-wrap:wrap;">' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;flex:1;min-width:340px;">' + layoutTiles + '</div>' +
        _ntLayoutPreview() +
      '</div>' +
      '<div style="font-size:10px;color:#98a1ad;margin-top:6px;">版式定了配文引擎（' + npCapDef(tpl.cap).t + '）；就一篇想换，出图 ① 里单改。</div></div>' +
    '<div style="display:flex;gap:8px;align-items:center;margin-top:10px;">' +
      '<button type="button" class="btn btn-primary btn-sm ntLookSave">💾 保存出图风格</button>' +
      '<button type="button" class="btn btn-sm ntLookClear">↺ 改回统一小红书</button>' +
      '<span id="ntLookMsg" style="font-size:11px;color:#0a7b5a;"></span></div>' +
  '</div>';
}
/* 配文版式预览（demo cfgLayoutPreview）：172×230 一张卡，画面小样＋当前版式排的字＋印记层——面板改什么它跟着变 */
function _ntLayoutPreview() {
  const look = _diagState.imgLook || {};
  const tpl = npLayoutDef(look.layout || 'big');
  const th = NP_THEME_STYLE[look.theme || NP_LOOK_XHS.theme] || NP_THEME_STYLE[NP_LOOK_XHS.theme];
  const motif = look.motif || NP_LOOK_XHS.motif;
  const T = '蓄水 48 小时，一小时都不能少';
  const subs = ['闭水试验要盯满两整天', '少一小时都算白做'];
  let inner = '';
  if (tpl.k === 'only') {
    inner = '<div style="font-size:16px;font-weight:800;color:' + th.fg + ';line-height:1.45;">' + esc(T) + '</div>';
  } else if (tpl.k === 'whole') {
    inner = [T].concat(subs, ['闭水没做足，后头全是麻烦。']).map(function (l) {
      return '<div style="font-size:10.5px;font-weight:400;color:' + th.sub + ';line-height:1.7;">' + esc(l) + '</div>';
    }).join('');
  } else if (tpl.k === 'note') {
    inner = '<div style="font-size:14px;font-weight:700;color:' + th.fg + ';line-height:1.45;">' + esc(T) + '</div>' +
      subs.map(function (l) { return '<div style="font-size:10px;color:' + th.sub + ';margin-top:7px;">↘ ' + esc(l) + '</div>'; }).join('');
  } else if (tpl.k === 'bar') {
    inner = '<div style="flex:1;"></div>' +
      '<div style="margin:-14px -14px -14px;padding:10px 14px;background:' + th.band + ';">' +
        '<div style="font-size:13px;font-weight:700;color:' + th.fg + ';line-height:1.4;">' + esc(T) + '</div>' +
        subs.map(function (l) { return '<div style="font-size:9.5px;color:' + th.sub + ';margin-top:3px;">' + esc(l) + '</div>'; }).join('') +
      '</div>';
  } else if (tpl.k === 'corner') {
    inner = '<div style="flex:1;"></div>' +
      '<div style="font-size:10.5px;font-weight:700;color:' + th.fg + ';line-height:1.5;">' + esc(T) + '</div>' +
      '<div style="font-size:9px;color:' + th.sub + ';margin-top:3px;">' + esc(subs[0]) + '</div>';
  } else if (tpl.k === 'steps') {
    inner = ['闭水前：管道堵严', '蓄水到标记线', '盯满 48 小时'].map(function (l, i) {
      return '<div style="display:flex;gap:6px;align-items:baseline;' + (i ? 'margin-top:7px;' : '') + '">' +
        '<span style="flex:none;font-size:12px;font-weight:800;color:' + th.accent + ';">' + '➊➋➌'[i] + '</span>' +
        '<span style="font-size:11px;font-weight:600;color:' + th.fg + ';">' + esc(l) + '</span></div>';
    }).join('');
  } else if (tpl.k === 'quote') {
    inner = '<div style="font-size:22px;font-weight:800;color:' + th.accent + ';line-height:1;">❝</div>' +
      '<div style="font-size:14px;font-weight:700;color:' + th.fg + ';line-height:1.6;margin-top:4px;">' + esc(T) + '</div>';
  } else if (tpl.k === 'card') {
    inner = '<div style="font-size:14px;font-weight:700;color:' + th.fg + ';line-height:1.7;">蓄水 <span style="border:2px solid ' + th.accent + ';border-radius:7px;padding:0 4px;">48 小时</span>，<br>一小时都不能少</div>' +
      '<div style="font-size:10px;color:' + th.sub + ';margin-top:6px;">' + esc(subs[0]) + '</div>';
  } else if (tpl.k === 'film') {
    const hole = '<span style="display:inline-block;width:5px;height:5px;border-radius:2px;background:' + th.band + ';margin:0 3px;"></span>';
    inner = '<div style="margin:-14px -14px 8px;padding:6px 0;text-align:center;line-height:0;">' + hole.repeat(11) + '</div>' +
      [T].concat(subs, ['漏过一次的都知道：这几步省不得。']).map(function (l) {
        return '<div style="font-size:10.5px;color:' + th.sub + ';line-height:1.7;">' + esc(l) + '</div>';
      }).join('') +
      '<div style="margin:8px -14px -14px;padding:6px 0;text-align:center;line-height:0;">' + hole.repeat(11) + '</div>';
  } else if (tpl.k === 'stamp') {
    inner = '<div style="padding:12px 8px;border:2px dashed ' + th.band + ';border-radius:8px;text-align:center;">' +
      '<div style="font-size:13.5px;font-weight:800;color:' + th.fg + ';line-height:1.5;">' + esc(T) + '</div>' +
      '<div style="font-size:9px;color:' + th.sub + ';margin-top:5px;">' + esc(subs[0]) + '</div></div>';
  } else if (tpl.k === 'polar') {
    inner = '<div style="font-size:14px;font-weight:800;color:' + th.fg + ';line-height:1.5;">' + esc(T) + '</div>' +
      '<div style="flex:1;"></div>' +
      '<div style="margin:0 -14px -14px;background:rgba(255,255,255,.92);padding:8px 10px 15px;box-shadow:0 1px 5px rgba(0,0,0,.2);">' +
        '<div style="font-size:9.5px;color:#374151;font-style:italic;text-align:center;">' + esc(subs[0]) + '</div></div>';
  } else if (tpl.k === 'mag') {
    inner = '<div style="display:flex;justify-content:space-between;font-size:8.5px;letter-spacing:2px;color:' + th.sub + ';border-bottom:1px solid ' + th.sub + ';padding-bottom:4px;margin-bottom:10px;"><span>防水笔记</span><span>VOL.12</span></div>' +
      '<div style="font-size:14px;font-weight:800;color:' + th.fg + ';line-height:1.5;">' + esc(T) + '</div>' +
      '<div style="font-size:9.5px;color:' + th.sub + ';margin-top:6px;">↘ ' + esc(subs[0]) + '</div>';
  } else if (tpl.k === 'chat') {
    inner = '<div style="align-self:flex-start;background:' + th.band + ';border-radius:10px 10px 10px 2px;padding:9px 11px;max-width:88%;">' +
        '<div style="font-size:12.5px;font-weight:700;color:' + th.fg + ';line-height:1.55;">' + esc(T) + '</div></div>' +
      '<div style="align-self:flex-end;margin-top:7px;background:' + th.accent + ';border-radius:10px 10px 2px 10px;padding:6px 10px;max-width:70%;">' +
        '<div style="font-size:10px;color:#fff;line-height:1.5;">' + esc(subs[0]) + '</div></div>';
  } else if (tpl.k === 'check') {
    inner = [T, '管道口堵严再蓄水', '标记线拍照留底'].map(function (l, i) {
      return '<div style="display:flex;gap:6px;align-items:baseline;' + (i ? 'margin-top:7px;' : '') + '">' +
        '<span style="flex:none;font-size:11px;font-weight:800;color:' + th.accent + ';">✓</span>' +
        '<span style="font-size:11px;font-weight:600;color:' + th.fg + ';">' + esc(l) + '</span></div>';
    }).join('');
  } else {
    inner = '<div style="font-size:15px;font-weight:700;color:' + th.fg + ';line-height:1.5;">' + esc(T) + '</div>' +
      subs.map(function (l) { return '<div style="font-size:10.5px;color:' + th.sub + ';margin-top:5px;">' + esc(l) + '</div>'; }).join('');
  }
  return '<div style="width:172px;flex:none;">' +
    '<div style="position:relative;width:172px;height:230px;border-radius:12px;overflow:hidden;background:' + th.bg + ';box-shadow:0 2px 10px rgba(0,0,0,.14);display:flex;flex-direction:column;justify-content:center;padding:14px;box-sizing:border-box;">' +
      cfgMotifSpecimen(motif, th) +
      inner + '<span id="lpMarkHost">' + _ntLayoutMarkHtml() + '</span>' +
    '</div>' +
    '<div class="note-xs" style="margin-top:4px;text-align:center;">预览 · ' + esc(tpl.t) + '</div></div>';
}
/* 预览上的印记层（demo cfgLayoutMarkHtml）：文字/传图按 markPos 摆；🗂 笔记分类小标固定左下，跟印记互不占位 */
function _ntLayoutMarkHtml() {
  const sel = _diagState.imgLook || {};
  const at = sel.markPos === 'bl' ? 'left:8px;' : 'right:8px;';
  let mark = '';
  if (sel.mark === 'text') {
    const tx = String(sel.markText || '').trim();
    if (tx) mark = '<div style="position:absolute;' + at + 'bottom:22px;max-width:96px;background:rgba(255,255,255,.88);border-radius:7px;padding:3px 6px;font-size:8.5px;font-weight:700;color:#374151;line-height:1.45;white-space:pre-line;box-shadow:0 1px 4px rgba(0,0,0,.18);">' + esc(tx) + '</div>';
  } else if (sel.mark === 'upload' && sel.markImg) {
    mark = '<img src="' + _dEsc(sel.markImg) + '" alt="" style="position:absolute;' + at + 'bottom:22px;width:30px;height:30px;object-fit:contain;border-radius:7px;background:rgba(255,255,255,.85);padding:2px;">';
  }
  if (sel.classify) {
    const stack = (mark && sel.markPos === 'bl') ? 'bottom:44px;' : 'bottom:22px;';
    mark += '<div style="position:absolute;left:8px;' + stack + 'background:rgba(17,24,39,.82);color:#fff;font-size:8.5px;font-weight:700;border-radius:6px;padding:2px 7px;">知识</div>';
  }
  return mark;
}
/* 🎨 出图风格面板的六个处理器：改的都先进内存（dirty），只有「💾 保存出图风格」落 config.imgLook */
function _ntMotifPick(k) {
  if (!k) return;
  _diagState.imgLook = Object.assign({}, _diagState.imgLook, { motif: k });
  _ntCfgSt().dirty = true;
  diagRenderStyle();
}
function _ntMotifAdd() {
  const st = _ntCfgSt();
  st.motifOpen = !st.motifOpen; st.motifErr = '';
  diagRenderStyle();
}
async function _ntMotifSave() {
  const st = _ntCfgSt();
  const inp = document.getElementById('ntMotifK');
  const name = String((inp && inp.value) || '').trim().slice(0, 16);
  if (!name) { st.motifErr = '先给它起个名字（≤16 字，它就是这张卡的身份）'; diagRenderStyle(); return; }
  if (npMotifIsBuilt(name)) { st.motifErr = '这一种内置里已经有了，换个名字'; diagRenderStyle(); return; }
  const keep = _npMotifs.filter(function (x) { return x.k !== name; });
  keep.push({ k: name });
  try {
    await npSaveImgMotifs(keep);                              // 自加的当场落 config.imgMotifs（内置的删不掉、也盖不掉）
    _diagState.imgLook = Object.assign({}, _diagState.imgLook, { motif: name });
    st.motifOpen = false; st.motifErr = ''; st.dirty = true;
    diagRenderStyle();
    toast('画面风格「' + name + '」存好了——分镜按它取材');
  } catch (e) { st.motifErr = '存不下：' + String((e && e.message) || e); diagRenderStyle(); }
}
function _ntMarkPick(mode) {
  _diagState.imgLook = Object.assign({}, _diagState.imgLook, { mark: String(mode || 'none') });
  _ntCfgSt().dirty = true;
  diagRenderStyle();
}
function _ntClassify(v) {
  _diagState.imgLook = Object.assign({}, _diagState.imgLook, { classify: !!v });
  _ntCfgSt().dirty = true;
  diagRenderStyle();
}
function _ntMarkText(v) {
  _diagState.imgLook = Object.assign({}, _diagState.imgLook, { markText: String(v || '') });
  _ntCfgSt().dirty = true;
  const host = document.getElementById('lpMarkHost');         // 只刷预览上的印记层，不整页重画（不掉输入焦点）
  if (host) host.innerHTML = _ntLayoutMarkHtml();
}
async function _ntMarkUpFile(file) {
  if (!file) return;
  const st = _ntCfgSt();
  try {
    const t = await npAsThumb(file);                          // 原图不入库：存 ≤160px 小图防 config 膨胀
    _diagState.imgLook = Object.assign({}, _diagState.imgLook, { mark: 'upload', markImg: t.thumb });
    st.dirty = true;
    diagRenderStyle();
    toast('印记图传好了——盖到' + ((_diagState.imgLook.markPos === 'bl') ? '左下' : '右下'));
  } catch (e) { toast('这张图读不了：' + String((e && e.message) || e)); }
}
function _ntLayoutPick(k) {
  const def = npLayoutDef(k || 'big');
  _diagState.imgLook = Object.assign({}, _diagState.imgLook, { layout: def.k, cap: def.cap });   // 版式定了配文引擎
  _ntCfgSt().dirty = true;
  diagRenderStyle();
}
function _ntBornPick(v) {
  const next = Object.assign({}, _diagState.imgLook);
  const s = String(v || '').trim();
  if (s) next.born = s; else delete next.born;
  _diagState.imgLook = next;
  _ntCfgSt().dirty = true;
  diagRenderStyle();
}
function _ntCasting(v) {
  _diagState.imgLook = Object.assign({}, _diagState.imgLook, { casting: String(v || '') });
  _ntCfgSt().dirty = true;
}
async function _ntLookSave() {
  const st = _ntCfgSt();
  const msg = document.getElementById('ntLookMsg');
  if (msg) { msg.textContent = '保存中…'; msg.style.color = '#9aa0ac'; }
  try {
    await npSaveImgLook(_diagState.imgLook);
    _diagState.imgLook = npLookShape(_diagState.imgLook);
    st.dirty = false;
    if (msg) { msg.textContent = '✅ 已保存'; msg.style.color = '#0a7b5a'; }
    toast('出图风格已保存——出图整套按这版走');
  } catch (e) {
    if (msg) { msg.textContent = '保存失败：' + String((e && e.message) || e); msg.style.color = '#d33'; }
  }
}
function _ntLookClear() {
  _diagState.imgLook = { motif: NP_LOOK_XHS.motif, theme: NP_LOOK_XHS.theme, cap: NP_LOOK_XHS.cap, layout: 'big', mark: 'none', markText: '', markImg: '', markPos: 'br', classify: false };
  const st = _ntCfgSt(); st.dirty = true; st.motifOpen = false; st.motifErr = '';
  diagRenderStyle();
  toast('改回统一小红书那一挂');
}
/* 三签面板的全部事件绑定（扩展 CSP 禁 inline onclick：demo 的 onclick 一律转 class + data-*） */
function _ntCfgBind(box) {
  if (!box) return;
  const st = _ntCfgSt();
  // 🧬 笔记规划
  const run = box.querySelector('#diagStyleRun');
  if (run) run.addEventListener('click', _diagStyleRun);
  box.querySelectorAll('.ntWeekChip').forEach(function (b) {
    b.addEventListener('click', function () { _ntWeekToggle(b.getAttribute('data-day') || '', b.getAttribute('data-k') || ''); });
  });
  box.querySelectorAll('.spRate').forEach(function (b) {
    b.addEventListener('click', function () { _ntSpRate(b.getAttribute('data-line') || '', b.getAttribute('data-v') || ''); });
  });
  box.querySelectorAll('.spCats').forEach(function (ip) {
    ip.addEventListener('change', function () { _ntSpCats(ip.getAttribute('data-field') || '', ip.value); });
  });
  // 📄 内容基调
  const lt = box.querySelector('#diagLinesToggle');
  if (lt) lt.addEventListener('click', function () { st.linesOpen = !st.linesOpen; diagRenderStyle(); });
  box.querySelectorAll('.ntToneFold').forEach(function (b) {
    b.addEventListener('click', function () {
      const t = b.getAttribute('data-t') || '';
      st.kindsOpen[t] = !st.kindsOpen[t];
      diagRenderStyle();
    });
  });
  box.querySelectorAll('.ntShapeDrag').forEach(function (el) {
    el.addEventListener('input', function () { _ntShapeDrag(el.getAttribute('data-target') || '', el.value); });
    el.addEventListener('change', function () { _ntShapeDragEnd(el.getAttribute('data-target') || ''); });
  });
  box.querySelectorAll('.ntShapeWords').forEach(function (b) {
    b.addEventListener('click', function () { _ntShapeWords(b.getAttribute('data-target') || '', b.getAttribute('data-w') || ''); });
  });
  box.querySelectorAll('.ntShapeReset').forEach(function (b) {
    b.addEventListener('click', function () { _ntShapeReset(b.getAttribute('data-target') || ''); });
  });
  // 🎨 出图风格（画面风格 / 印记 / 笔记分类 / 配文版式）
  box.querySelectorAll('.ntMotifChip').forEach(function (b) {
    b.addEventListener('click', function () { _ntMotifPick(b.getAttribute('data-k') || ''); });
  });
  box.querySelectorAll('.ntMotifAdd').forEach(function (b) {
    b.addEventListener('click', function () { _ntMotifAdd(); });      // demo 同款：同一个 handler，再点一下收起
  });
  const mSave = box.querySelector('.ntMotifSave');
  if (mSave) mSave.addEventListener('click', _ntMotifSave);
  box.querySelectorAll('.ntMarkPick').forEach(function (b) {
    b.addEventListener('click', function () { _ntMarkPick(b.getAttribute('data-mode') || 'none'); });
  });
  const mText = box.querySelector('.ntMarkText');
  if (mText) mText.addEventListener('input', function () { _ntMarkText(mText.value); });
  const mFile = box.querySelector('.ntMarkFile');
  if (mFile) mFile.addEventListener('change', function () { _ntMarkUpFile(mFile.files && mFile.files[0]); });
  box.querySelectorAll('.ntClassifyPick').forEach(function (b) {
    b.addEventListener('click', function () { _ntClassify(b.getAttribute('data-v') === '1'); });
  });
  box.querySelectorAll('.ntLayoutTile').forEach(function (b) {
    b.addEventListener('click', function () { _ntLayoutPick(b.getAttribute('data-k') || 'big'); });
  });
  box.querySelectorAll('.ntBornPick').forEach(function (b) {
    b.addEventListener('click', function () { _ntBornPick(b.getAttribute('data-v') || ''); });
  });
  const castIn = box.querySelector('.ntCasting');
  if (castIn) castIn.addEventListener('input', function () { _ntCasting(castIn.value); });
  const lSave = box.querySelector('.ntLookSave');
  if (lSave) lSave.addEventListener('click', _ntLookSave);
  const lClear = box.querySelector('.ntLookClear');
  if (lClear) lClear.addEventListener('click', _ntLookClear);
}
/* ── 老「账号阶段 × 个人人设」三件套已随三签改版下线（_diagStyleBind / aiNoteStyleAdvice 版 _diagStyleRun /
     _diagStyleSetTalk / _diagToneSet / _diagStageCustom / _diagStageTotal / 旧 _diagPersonaTableHtml）── */

