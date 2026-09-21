/* 全场景截流 · 扩展自带「笔记监控列表」维护工具
 *
 * 同时被 background 与 popup 使用：
 *  - background.js importScripts：提供 SCENARIO_DRAIN 话术库 + handleDrainComment（调 AI）
 *  - popup <script>：renderScenarioDrain 渲染「截流」Tab 的笔记监控列表
 *
 * 设计：扫到/手动加入的笔记进本地监控列表(evaluations 存在 chrome.storage.local)，
 * 每行按场景判据打状态标签（爬坡/卡位/同城命中/求助命中/高活跃/借V监控），
 * 可刷新判断、生成各场景评论、移除。
 */

const SCENARIO_DRAIN = [
  {
    scenario: 'burst',
    label: '爆发狙击',
    icon: '🚀',
    tag: '抓推荐流 · 起飞前抢C位',
    desc: '最新发布的笔记刚冒头，Δ点赞爬坡时抢前排，发干货钩子抢C位。',
    system: `你是发现页里一个真实的小红书用户，正赶上一篇刚起飞的笔记。你的评论目标：在她起飞前抢到前排 C 位，用干货钩子让人记住你。
要求：
1. 紧扣笔记内容，给出真正有用的干货/经验/数据支撑
2. 观点鲜明，先说真实看法（[说实话][以我的经验]开头）
3. 自然把「{product}」放在「我当时就是靠这个测出来的」的语境里（只提产品名，不写小程序/微信等站外渠道词、不发链接，导流用“我主页/私信”承接）
4. 简短有力，40-60 字，像真人抢热评
5. 不能像广告，不能有模板痕迹`,
    user: `【笔记标题】{title}\n【笔记内容】{content}\n\n这篇笔记刚起飞，我要抢前排评论。请生成一条含干货钩子、观点鲜明、能让人记住我的评论（40-60 字，自然带出「{product}」，不写站外渠道词、不发链接）。直接返回评论文本。`,
  },
  {
    scenario: 'evergreen',
    label: '长尾常青',
    icon: '🌲',
    tag: '抓搜索流 · 长期霸占干货排名',
    desc: '干货搜索词下的老笔记，长期占位的极专业解决方案评论（可 3-5 条，定期活水）。',
    system: `你是这个领域真正懂行的老手，在干货搜索词下面写极度专业的解决方案评论，目的：长期占据高质量评论位置。
要求：
1. 极度专业、结构清晰，给出能直接解决问题的完整方案/清单
2. 用具体数据支撑，不空话
3. 把「{product}」作为解决方案工具箱里自然的一员（只提产品名，不写站外渠道词、不发链接）
4. 篇幅可稍长（80-150 字），因为这里是搜索流量、用户要干货
5. 专业但有温度，像真人的深度回答，不是广告文案`,
    user: `【搜索关键词】{keyword}\n【笔记标题】{title}\n【笔记内容】{content}\n\n这是搜索「{keyword}」排名靠前的老笔记，我要写专业方案评论长期占位。请给出一条极度专业、能解决问题的评论（80-150 字），自然带出「{product}」（只提产品名，不写站外渠道词、不发链接）。直接返回评论文本。`,
  },
  {
    scenario: 'city',
    label: '同城精准',
    icon: '📍',
    tag: '抓LBS流 · 同城本地信任截流',
    desc: '关键词+城市抓本地新帖，注入「同在XX区」地域信任词，截流同城刚需。',
    system: `你是本地一个真实用户，刚刷到同城的一篇探店/本地笔记。评论目标：借本地信任感截流同城刚需。
要求：
1. 必须注入地域信任词（如「同在{city}」「我家就住{region}附近」），显得是本地真人
2. 说本地人才懂的口吻，自然而然
3. 在合适语境带出「{product}」（只提产品名，不写站外渠道词、不发链接）
4. 40-60 字，真实接地气`,
    user: `【城市】{city}\n【地域/区】{region}\n【笔记标题】{title}\n【笔记内容】{content}\n\n这是同城笔记，我以本地人身份评论，必须自然注入地域信任词。请生成一条带本地特征的同城信任评论（40-60 字），自然带出「{product}」（只提产品名，不写站外渠道词、不发链接）。直接返回评论文本。`,
  },
  {
    scenario: 'pain',
    label: '痛点猎杀',
    icon: '🎯',
    tag: '抓精准转化 · 命中求助用户',
    desc: '抓「求推荐/听劝/怎么办」的求助帖，给对症解决路径，把求助者推向行动。',
    system: `评论区里有个正在四处求助的精准用户，这条评论要正中他痛处、给针对性极强的解决路径，把他从「我再看看」推向「我要试」。
逻辑：
1. 先准确复述/共情他的具体困扰（呼应他的原话）
2. 给出有数据支撑的具体解决步骤，把「{product}」作为对症的工具（只提产品名，不写站外渠道词、不发链接，要产品用“我主页/私信”承接）
3. 简短直接有力量，50-90 字，像内行给建议
4. 不能像广告，要让求助者觉得你真懂他`,
    user: `【求助者原话】{pain}\n【笔记标题】{title}\n【笔记内容】{content}\n\n这位用户在精准求助。请生成一条共情到位、给针对性解决路径、能覆盖求助转化的评论（50-90 字），自然带出「{product}」对症解决（只提产品名，不写站外渠道词、不发链接）。直接返回评论文本。`,
  },
  {
    scenario: 'topic',
    label: '话题吃瓜',
    icon: '🍿',
    tag: '抓高曝光 · 蹭争议/情绪帖',
    desc: '评论区吵得很热闹的高讨论笔记，发神回复/情绪共鸣蹭曝光，只保证不评自己、不删。',
    system: `这是评论区吵得很热闹的高活跃笔记，我的目标是蹭高曝光。评论要：
1. 神回复/扎心共鸣，观点犀利，能让人想点赞或接话
2. 先亮鲜明观点（[说实话][我个人觉得]），说普通人想说的话
3. 不带硬广：产品只能以「我当时用’{product}‘测了下」的语境极轻地带出（只提产品名，不写站外渠道词、不发链接），甚至可以完全不提
4. 短而狠，30-50 字
5. 绝不像广告，纯像一个真人的情绪观点`,
    user: `【笔记标题】{title}\n【笔记内容】{content}\n\n这是高讨论度笔记，请生成一条观点犀利、能引起共鸣/接话的神回复（30-50 字），可带可不带「{product}」（一旦带就极轻、只提产品名、不写站外渠道词、不发链接）。直接返回评论文本。`,
  },
  {
    scenario: 'highv',
    label: '高V狙击',
    icon: '👑',
    tag: '抓溢出流量 · 借头部IP',
    desc: '白名单用户清单的最新笔记，写极度赞同+补充干货的降维打击，借头部 IP 溢出流量。',
    system: `这是头部高V博主的笔记，下面已经一堆人附和。我的目标：在他评论区借溢出流量被大家看到。
策略（降维打击）：
1. 先「极度赞同」博主：接住他最亮那句观点，表明我真的深入看过
2. 再「补充干货」：给出博主没讲到的、有数据支撑的增量信息，让评论区觉得「这人比博主还懂」
3. 把「{product}」放成「我当时就是用XX验证出来的」的语境（只提产品名，不写站外渠道词、不发链接）
4. 60-100 字，专业又谦逊，像同行高手
5. 不能像拍马屁，要真的提供增量价值`,
    user: `【高V笔记标题】{title}\n【高V笔记内容】{content}\n【高V作者】{author}\n\n这是头部博主笔记，我在他评论区抢溢出流量。请生成一条「极度赞同+补充干货」的降维打击评论（60-100 字），自然带出「{product}」（只提产品名，不写站外渠道词、不发链接）。直接返回评论文本。`,
  },
];

const DRAIN_KEY = 'drain_notes';
const DRAIN_SCAN_KEY = 'drain_scan_cfg';
const DRAIN_PAIN_WORDS = ['求推荐', '听劝', '怎么办', '求建议', '求助', '怎么选', '避雷'];
const DRAIN_SEARCH_URL = (term) => 'https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(term) + '&source=web_search_result_note';

/* ================= 存储 ================= */
function _uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
async function drainLoad() {
  const d = await chrome.storage.local.get(DRAIN_KEY);
  return Array.isArray(d[DRAIN_KEY]) ? d[DRAIN_KEY] : [];
}
async function drainSave(a) { await chrome.storage.local.set({ [DRAIN_KEY]: a }); }
async function drainGetScanCfg() {
  const d = await chrome.storage.local.get(DRAIN_SCAN_KEY);
  return (d && d[DRAIN_SCAN_KEY]) || { sources: [], autoScanMin: 0, lastScanAt: 0, lastScanSummary: null };
}
async function drainSaveScanCfg(c) { await chrome.storage.local.set({ [DRAIN_SCAN_KEY]: c }); }

/* ================= 判断：按场景读到的指标打状态 =================
   signals = { likes, comments, collects, delta, rank, title }
   这里的"判断"是可解释启发式，够支撑维护体验。 */
function drainJudge(scenario, signals) {
  const t = String((signals && signals.title) || '');
  const likes = Number((signals && signals.likes) || 0);
  const comments = Number((signals && signals.comments) || 0);
  const delta = Number((signals && signals.delta) || 0);
  const rank = Number((signals && signals.rank) || 0);
  switch (scenario) {
    case 'burst':
      if (delta >= 50) return { verdict: '起飞机', tone: 'green' };
      return likes > 0 ? { verdict: '监控·爬坡观察', tone: 'blue' } : { verdict: '监控·待观察', tone: 'gray' };
    case 'evergreen':
      if (rank > 0 && rank <= 3) return { verdict: '黄金位·前3', tone: 'green' };
      if (rank > 0 && rank <= 20) return { verdict: '卡位中·Top' + rank, tone: 'blue' };
      return { verdict: '监控·占位', tone: 'gray' };
    case 'city':
      return { verdict: '同城监控·LBS', tone: 'blue' };
    case 'pain':
      return DRAIN_PAIN_WORDS.some(w => t.includes(w))
        ? { verdict: '求助命中·精准', tone: 'green' }
        : { verdict: '监控·意图待定', tone: 'gray' };
    case 'topic': {
      const ratio = likes > 0 ? comments / likes : 0;
      return ratio > 1
        ? { verdict: '高活跃·吃瓜', tone: 'purple' }
        : { verdict: '监控·热度观察(Q/P=' + Number(ratio).toFixed(2) + ')', tone: 'gray' };
    }
    case 'highv':
      return { verdict: '借V监控·溢出', tone: 'purple' };
    default:
      return { verdict: '监控', tone: 'gray' };
  }
}

/* ================= 弹窗渲染：笔记监控列表 ================= */
async function renderScenarioDrain(container) {
  if (!container) return;
  const _sel = (id) => document.getElementById(id);
  let notes = await drainLoad();
  const st = { scenario: 'all', showDead: true, busyGrab: false };

  container.innerHTML = `
    <style>
      .sx-wrap{padding:14px;font-size:13px;color:var(--ink,#1f2937);}
      .sx-bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px;}
      .sx-bar select,.sx-in{font-size:12px;padding:6px 8px;border:1px solid #e5e7eb;border-radius:8px;color:#1f2937;background:#fff;outline:none;}
      .sx-hint{font-size:11px;color:#8a8f99;line-height:1.7;margin:8px 0;}
      .sx-count{font-size:12px;color:#6b7280;}
      .sx-row{border:1px solid #eef0f3;border-radius:10px;padding:9px 10px;margin-bottom:8px;background:#fff;}
      .sx-row-top{display:flex;align-items:center;gap:8px;}
      .sx-title{flex:1;min-width:0;font-size:13px;color:#1f2937;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .sx-title a{color:#1f2937;text-decoration:none;}
      .sx-title a:hover{color:#ff2442;}
      .sx-meta{font-size:11px;color:#8a8f99;margin:3px 0 0 0;display:flex;gap:8px;flex-wrap:wrap;}
      .sx-ops{display:flex;gap:5px;margin-top:6px;flex-wrap:wrap;}
      .sx-empty{text-align:center;color:#9ca3af;padding:30px 10px;font-size:12px;line-height:2;}
      .sx-judge{font-size:10px;padding:2px 8px;border-radius:20px;font-weight:600;white-space:nowrap;}
      .sx-judge.green{background:#e9fcf2;color:#0a8f4c;}
      .sx-judge.blue{background:#eff6ff;color:#2563eb;}
      .sx-judge.gray{background:#f3f4f6;color:#6b7280;}
      .sx-judge.purple{background:#f5f3ff;color:#7c3aed;}
      .sx-chip{font-size:11px;padding:2px 8px;border-radius:20px;background:#fff0f3;color:#d64052;font-weight:600;}
      .sx-input{width:100%;box-sizing:border-box;margin-top:6px;}
      .sx-out{position:fixed;left:0;right:0;bottom:0;z-index:999;background:#fff;border-top:1px solid #e5e7eb;padding:12px 14px;max-height:50vh;overflow:auto;box-shadow:0 -4px 20px rgba(0,0,0,.08);}
      .sx-out-bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}
      .sx-out-text{font-size:12px;color:#334155;white-space:pre-wrap;line-height:1.8;background:#f9fafb;border:1px solid #eef0f3;border-radius:8px;padding:8px 10px;}
    </style>
    <div class="sx-wrap">
      <div class="sx-hint">获客＝扫描笔记列表→进监控池→逐篇判断→截流/转获客。点「🔍 扫描一轮」按来源抓列表并入池；扫描会做存量对账——这次没被打开的老笔记按ID/标题补开刷新，不丢失。来源在「⚙️ 扫描来源」里配（关键词/城市/高V）。</div>
      <div class="sx-bar">
        <button type="button" class="btn btn-sm btn-primary" id="sxScan">🔍 扫描一轮</button>
        <button type="button" class="btn btn-sm" id="sxScanCfg">⚙️ 扫描来源</button>
        <button type="button" class="btn btn-sm" id="sxReplenish">🔁 补开未打开</button>
        <button type="button" class="btn btn-sm" id="sxReplCfg">🧮 决策配置表</button>
        <span class="sx-count" id="sxLastScan"></span>
      </div>
      <div id="sxScanCfgPanel" style="display:none;border:1px solid #eef0f3;border-radius:10px;padding:10px;margin-bottom:10px;"></div>
      <div id="sxReplCfgPanel" style="display:none;border:1px solid #eef0f3;border-radius:10px;padding:10px;margin-bottom:10px;"></div>
      <div class="sx-bar">
        <select id="sxFilter" class="sx-in">
          <option value="all">全部场景</option>
          ${SCENARIO_DRAIN.map(s => `<option value="${s.scenario}">${s.icon} ${s.label}</option>`).join('')}
        </select>
        <button type="button" class="btn btn-sm btn-primary" id="sxGrab">📥 抓当前笔记入列</button>
        <button type="button" class="btn btn-sm" id="sxRefreshAll">🔄 全量刷新判断</button>
      </div>
      <div class="sx-bar">
        <input class="sx-in" id="sxUrl" placeholder="或粘贴笔记链接后回车加入（当前场景）" style="flex:1;">
      </div>
      <div class="sx-count" id="sxCount"></div>
      <div id="sxList"></div>
      <div id="sxOut" class="sx-out" style="display:none;"></div>
    </div>
  `;

  /* ---- 扫描来源配置面板 ---- */
  const renderScanCfg = async () => {
    const r = await chrome.runtime.sendMessage({ action: 'drainGetScanCfg' });
    const cfg = (r && r.ok && r.cfg) || { sources: [] };
    const panel = _sel('sxScanCfgPanel');
    if (!panel) return;
    panel.innerHTML = `
      <div style="font-size:12px;font-weight:600;color:#1f2937;margin-bottom:6px;">扫描来源（关键词/城市/高V）</div>
      <div id="sxSrcList" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
        ${(cfg.sources || []).map((s, i) => {
          const sc = SCENARIO_DRAIN.find(x => x.scenario === s.scenario);
          return `<span style="display:inline-flex;align-items:center;gap:4px;background:#fff0f3;color:#d64052;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:600;">
            ${sc ? sc.icon + ' ' + sc.label : s.kind} · ${escHtml(s.term)}
            <button data-srcdel="${i}" style="border:none;background:none;cursor:pointer;color:#d64052;font-size:12px;">✕</button>
          </span>`;
        }).join('') || '<span style="color:#9ca3af;font-size:11px;">暂无来源，加一个（会自动用现有关键词种子）</span>'}
      </div>
      <div style="display:flex;gap:6px;">
        <select class="sx-in" id="sxSrcScenario" style="flex:0 0 120px;padding:6px;">
          ${SCENARIO_DRAIN.map(s => `<option value="${s.scenario}">${s.icon} ${s.label}</option>`).join('')}
        </select>
        <input class="sx-in" id="sxSrcTerm" placeholder="关键词 / 城市词 / 高V主页链接" style="flex:1;margin-top:0;">
        <button type="button" class="btn btn-sm btn-primary" id="sxSrcAdd">＋ 加来源</button>
      </div>
    `;
    panel.querySelectorAll('[data-srcdel]').forEach(b => b.onclick = async () => {
      const i = parseInt(b.getAttribute('data-srcdel'), 10);
      cfg.sources.splice(i, 1);
      await chrome.runtime.sendMessage({ action: 'drainSaveScanCfg', cfg });
      renderScanCfg();
    });
    _sel('sxSrcAdd').onclick = async () => {
      const term = _sel('sxSrcTerm').value.trim();
      if (!term) { drainToast('请输入来源词/链接', 'warn'); return; }
      cfg.sources.push({ scenario: _sel('sxSrcScenario').value, term, kind: String(term).startsWith('http') ? 'profile' : 'search' });
      _sel('sxSrcTerm').value = '';
      await chrome.runtime.sendMessage({ action: 'drainSaveScanCfg', cfg });
      renderScanCfg();
    };
  };

  /* ---- 扫描一轮 ---- */
  const runScan = async () => {
    const btn = _sel('sxScan');
    btn.disabled = true; btn.textContent = '⏳ 扫描中(后台开小红书页)...';
    try {
      const r = await chrome.runtime.sendMessage({ action: 'drainScan' });
      if (r && r.ok) {
        const s = r.summary || {};
        drainToast(`扫描完成：新${s.foundNew} 并入获客${s.imported || 0} 补开${s.backfilled}（共${s.total}）`);
        notes.length = 0; notes.push(...await drainLoad());
        // 如果没有扫到任何新笔记，把诊断写到标签/提示里，方便定位
        if (!s.foundNew) {
          const dl = (s.detail || []).map(d => `${d.term}: ${d.got}篇${d.err ? ' [' + d.err + ']' : ''}`).join('\n');
          const sv = _sel('sxLastScan');
          if (sv) sv.textContent = '⚠️ 本次未发现新笔记。来源明细：\n' + (dl || '(无来源)') + (s.note ? '\n' + s.note : '');
          sv.style.whiteSpace = 'pre-line'; sv.style.color = '#d97706';
        } else {
          const sv = _sel('sxLastScan'); if (sv) sv.textContent = `本次扫描：新${s.foundNew} 刷${s.refreshed} 补${s.backfilled} 共${s.total}`;
        }
        await renderScanCfg();
      } else {
        drainToast('扫描失败：' + ((r && r.error) || '未知'), 'error');
      }
    } catch (e) { drainToast('扫描失败：' + (e.message || e), 'error'); }
    btn.disabled = false; btn.textContent = '🔍 扫描一轮';
    render();
  };

  _sel('sxScan').onclick = runScan;
  _sel('sxScanCfg').onclick = () => { const p = _sel('sxScanCfgPanel'); p.style.display = p.style.display === 'none' ? 'block' : 'none'; if (p.style.display === 'block') renderScanCfg(); };
  renderScanCfg();

  /* ---- 决策配置表（补开：哪些场景打开/不开/淘汰） ---- */
  const MODE_LABEL = { always: '总开', ttl: 'TTL内开', interval: '按间隔开' };
  const renderReplCfg = async () => {
    const r = await chrome.runtime.sendMessage({ action: 'drainGetReplenishCfg' });
    const repl = (r && r.ok && r.repl) || {};
    const panel = _sel('sxReplCfgPanel');
    if (!panel || !SCENARIO_DRAIN) return;
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <span style="font-size:12px;font-weight:600;color:#1f2937;">🧮 补开决策配置表</span>
        <label style="font-size:11px;color:#374151;display:inline-flex;align-items:center;gap:4px;">
          <input type="checkbox" id="replEnabled" ${repl.enabled !== false ? 'checked' : ''}> 启用自动补开
        </label>
        <span class="sx-count" id="replLast"></span>
      </div>
      ${SCENARIO_DRAIN.map(s => {
        const sc = repl.strategy && repl.strategy[s.scenario] || { mode: 'interval', intervalHours: 12 };
        const m = sc.mode || 'interval';
        return `<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#374151;padding:4px 0;border-bottom:1px solid #f6f7f9;">
          <span style="width:74px;font-weight:600;">${s.icon} ${s.label}</span>
          <select id="repl-${s.scenario}-mode" style="font-size:11px;padding:4px 6px;border:1px solid #e5e7eb;border-radius:6px;">
            <option value="always" ${m === 'always' ? 'selected' : ''}>总开</option>
            <option value="ttl" ${m === 'ttl' ? 'selected' : ''}>TTL内开</option>
            <option value="interval" ${m === 'interval' ? 'selected' : ''}>按间隔开</option>
          </select>
          <span style="opacity:.7;">TTL(时)<input id="repl-${s.scenario}-ttl" type="number" min="1" value="${sc.ttlHours || 24}" style="width:44px;margin:0 4px;padding:3px;border:1px solid #e5e7eb;border-radius:6px;"></span>
          <span style="opacity:.7;">间隔(时)<input id="repl-${s.scenario}-iv" type="number" min="1" value="${sc.intervalHours || 12}" style="width:44px;margin:0 4px;padding:3px;border:1px solid #e5e7eb;border-radius:6px;"></span>
          ${s.scenario === 'topic' ? `<span style="opacity:.7;">热度阈值<input id="repl-topic-emo" type="number" step="0.1" min="0.1" value="${sc.emotionRatio != null ? sc.emotionRatio : 1.0}" style="width:48px;margin:0 4px;padding:3px;border:1px solid #e5e7eb;border-radius:6px;"></span>` : ''}
        </div>`;
      }).join('')}
      <div style="display:flex;gap:6px;margin-top:8px;">
        <button type="button" class="btn btn-sm btn-primary" id="replSave">保存决策表</button>
      </div>`;
    _sel('replSave').onclick = async () => {
      const repl2 = { enabled: _sel('replEnabled').checked, strategy: {}, lastReplenishAt: repl.lastReplenishAt, lastReplenishSummary: repl.lastReplenishSummary };
      SCENARIO_DRAIN.forEach(s => {
        const m = _sel(`repl-${s.scenario}-mode`).value;
        const o = { mode: m };
        if (m === 'ttl') o.ttlHours = parseInt(_sel(`repl-${s.scenario}-ttl`).value, 10) || 24;
        if (m === 'interval') o.intervalHours = parseInt(_sel(`repl-${s.scenario}-iv`).value, 10) || 12;
        if (s.scenario === 'topic') o.emotionRatio = parseFloat(_sel('repl-topic-emo').value) || 1.0;
        repl2.strategy[s.scenario] = o;
      });
      await chrome.runtime.sendMessage({ action: 'drainSaveReplenishCfg', repl: repl2 });
      drainToast('决策配置表已保存');
    };
    const sm = repl.lastReplenishSummary;
    if (sm) _sel('replLast').textContent = `上次补开：开${sm.opened} 淘汰${sm.expired} 失败${sm.failed}`;
  };

  /* ---- 补开本轮未打开 ---- */
  const runReplenish = async (fromAuto) => {
    const btn = _sel('sxReplenish');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 补开中...'; }
    try {
      const r = await chrome.runtime.sendMessage({ action: 'drainReplenish', round: true });
      if (r && r.ok && r.disabled) {
        drainToast('补开未启用（决策配置表里开关）', 'warn');
      } else if (r && r.ok && r.busy) {
        drainToast('补开正在进行中，稍等…', 'info');
      } else if (r && r.ok) {
        const s = r.summary || {};
        drainToast(`补开完成：开${s.opened} 跳${s.skipped} 淘汰${s.expired} 失败${s.failed}`);
        notes.length = 0; notes.push(...await drainLoad());
      } else {
        drainToast('补开失败：' + ((r && r.error) || '未知'), 'error');
      }
    } catch (e) { drainToast('补开失败：' + (e.message || e), 'error'); }
    if (btn) { btn.disabled = false; btn.textContent = '🔁 补开未打开'; }
    render(); await renderReplCfg();
  };
  _sel('sxReplenish').onclick = () => runReplenish();
  _sel('sxReplCfg').onclick = () => { const p = _sel('sxReplCfgPanel'); p.style.display = p.style.display === 'none' ? 'block' : 'none'; if (p.style.display === 'block') renderReplCfg(); };
  renderReplCfg();
  (async () => { const r = await chrome.runtime.sendMessage({ action: 'drainGetScanCfg' }); const sm = r && r.ok && r.cfg.lastScanSummary; if (sm) _sel('sxLastScan').textContent = `上次扫描：新${sm.foundNew} 并入获客${sm.imported || 0} 补${sm.backfilled} 共${sm.total}`; })();

  const render = () => {
    const lst = notes.filter(n => (st.scenario === 'all' || n.scenario === st.scenario));
    _sel('sxCount').textContent = `共 ${notes.length} 篇（当前 ${st.scenario === 'all' ? '全部场景' : SCENARIO_DRAIN.find(s => s.scenario === st.scenario).label} ${lst.length} 篇）`;
    if (!lst.length) { _sel('sxList').innerHTML = '<div class="sx-empty">列表为空<br/>点「📥 抓当前笔记入列」把正在看的小红书笔记加入监控，或粘贴链接。</div>'; return; }
    _sel('sxList').innerHTML = lst.map(n => {
      const s = SCENARIO_DRAIN.find(x => x.scenario === n.scenario);
      const j = drainJudge(n.scenario, n.signals || {});
      return `
        <div class="sx-row">
          <div class="sx-row-top">
            <span class="sx-chip">${s.icon} ${s.label}</span>
            <div class="sx-title"><a href="${escAttr(n.url)}" target="_blank">${escHtml(n.title || '(无标题)')}</a></div>
            <span class="sx-judge ${j.tone}">${j.verdict}</span>
          </div>
          <div class="sx-meta">
            <span>👍 ${n.signals && n.signals.likes != null ? n.signals.likes : '—'}</span>
            <span>💬 ${n.signals && n.signals.comments != null ? n.signals.comments : '—'}</span>
            <span>📌 ${n.signals && n.signals.collects != null ? n.signals.collects : '—'}</span>
            ${n.signals && n.signals.rank ? `<span>#${n.signals.rank}</span>` : ''}
            <span>入列 ${fmtTime(n.addedAt)}</span>
            ${n.lastJudgedAt ? `<span>判于 ${fmtTime(n.lastJudgedAt)}</span>` : ''}
          </div>
          <div class="sx-ops">
            <button class="btn btn-sm btn-primary" data-act="judge" data-id="${n.id}">🔍 刷新判断</button>
            <button class="btn btn-sm" data-act="gen" data-id="${n.id}">💬 生成${s.label}评论</button>
            <button class="btn btn-sm" data-act="toPros" data-id="${n.id}">💼 评论区转获客</button>
            <button class="btn btn-sm" data-act="drop" data-id="${n.id}" style="color:#d32f2f;">移除</button>
          </div>
        </div>`;
    }).join('');
    _sel('sxList').querySelectorAll('button[data-act]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-id');
        const note = notes.find(n => n.id === id);
        if (!note) return;
        if (btn.getAttribute('data-act') === 'judge') drainJudgeNote(note);
        else if (btn.getAttribute('data-act') === 'gen') drainOpenGen(note);
        else if (btn.getAttribute('data-act') === 'toPros') drainNoteToProspects(note);
        else if (btn.getAttribute('data-act') === 'drop') { notes = notes.filter(n => n.id !== id); drainSave(notes); render(); }
      };
    });
  };

  // 抓当前页笔记（脚本读 current tab 的标题/指标）
  _sel('sxGrab').onclick = async () => {
    if (st.busyGrab) return;
    st.busyGrab = true; _sel('sxGrab').textContent = '抓取中…';
    try {
      const data = await drainGrabActiveNote();
      if (!data) { drainToast('当前不是小红书笔记页（需打开一篇 /explore/ 的笔记）', 'warn'); }
      else {
        const exists = notes.find(n => n.url === data.url);
        if (exists) { drainToast('该笔记已在监控列表'); }
        else {
          const sc = st.scenario === 'all' ? 'burst' : st.scenario;
          const sig = { likes: data.likes != null ? data.likes : null, comments: data.comments, collects: data.collects, rank: 0, delta: 0, title: data.title };
          notes.unshift({ id: _uid(), scenario: sc, url: data.url, title: data.title, author: data.author, signals: sig, addedAt: Date.now(), lastJudgedAt: Date.now() });
          await drainSave(notes);
          drainToast(`已加入 → ${SCENARIO_DRAIN.find(x => x.scenario === sc).label}`);
        }
      }
    } catch (e) { drainToast('抓取失败：' + (e.message || e), 'warn'); }
    st.busyGrab = false; _sel('sxGrab').textContent = '📥 抓当前笔记入列';
    render();
  };

  // 粘贴链接加入
  _sel('sxUrl').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const url = _sel('sxUrl').value.trim();
    if (!/xhs|xiaohongshu/.test(url)) { drainToast('不是小红书链接', 'warn'); return; }
    _sel('sxUrl').value = '';
    if (notes.find(n => n.url === url)) { drainToast('已在列表'); return; }
    const sc = st.scenario === 'all' ? 'burst' : st.scenario;
    notes.unshift({ id: _uid(), scenario: sc, url, title: '（待抓取标题）', signals: {}, addedAt: Date.now() });
    drainSave(notes); drainToast('已按链接加入，请打开后点「刷新判断」读指标'); render();
  });

  // 刷新判断：读当前 tab，若 tab 即该笔记则读取指标并判定
  async function drainJudgeNote(note) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url || tab.url.split('?')[0] !== note.url.split('?')[0]) {
        drainToast('请先在浏览器打开该笔记，再点「刷新判断」', 'warn'); return;
      }
      const m = await drainReadTabMetrics(tab.id);
      const prev = (note.signals && note.signals.likes) || 0;
      const sig = Object.assign({}, note.signals, m, { delta: m.likes != null && prev != null ? (m.likes - prev) : 0 });
      note.signals = sig; note.lastJudgedAt = Date.now();
      await drainSave(notes);
      drainToast('已刷新判断：' + (drainJudge(note.scenario, sig).verdict));
    } catch (e) { drainToast('刷新判断失败：' + (e.message || e), 'warn'); }
    render();
  }

  _sel('sxRefreshAll').onclick = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) { drainToast('请先把要刷新的笔记页打开为当前页', 'warn'); return; }
    let hit = 0;
    for (const n of notes) {
      if (n.url.split('?')[0] === tab.url.split('?')[0]) {
        try {
          const m = await drainReadTabMetrics(tab.id);
          const prev = (n.signals && n.signals.likes) || 0;
          n.signals = Object.assign({}, n.signals, m, { delta: m.likes != null && prev != null ? (m.likes - prev) : 0 });
          n.lastJudgedAt = Date.now(); hit++;
        } catch (e) {}
      }
    }
    await drainSave(notes); render();
    drainToast(hit ? `已刷新 ${hit} 篇（当前页）` : '当前页不在列表，或读指标失败', hit ? 'ok' : 'warn');
  };

  _sel('sxFilter').onchange = (e) => { st.scenario = e.target.value; render(); };
  render();

  // 💼 评论区转获客：读当前页该笔记本的评论者 → 过滤 → 进获客清单
  async function drainNoteToProspects(note) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id || !String(tab.url || '').includes('xiaohongshu.com')) { drainToast('请打开该笔记页再转获客', 'warn'); return; }
      const r = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const out = [];
          const seen = new Set();
          document.querySelectorAll('[class*="comment"]').forEach((it) => {
            const c = it.querySelector('[class*="content"], [class*="text"]');
            const text = c ? (c.textContent || '').trim() : '';
            if (!text || text.length < 4) return;
            let author = '';
            const nameEl = it.querySelector('[class*="user"], [class*="author"], [class*="name"]');
            if (nameEl && nameEl.textContent) author = (nameEl.textContent.trim().split(/\s+/).filter(Boolean))[0] || '';
            if (!author || seen.has(author)) return;
            seen.add(author);
            out.push({ author, text: text.slice(0, 140) });
          });
          return out;
        },
      });
      const comments = (r && r[0] && r[0].result) || [];
      const hits = comments.filter(cm => {
        const t = cm.text || '';
        if (note.scenario === 'pain') return DRAIN_PAIN_WORDS.some(w => t.includes(w));
        return t.length >= 8; // 其他场景：有实质内容的评论者都算可触达
      });
      if (!hits.length) { drainToast('没捞到可转的评论者（请确保当前页是该笔记）', 'warn'); render(); return; }
      let added = 0, skip = 0;
      for (const h of hits) {
        const kw = DRAIN_PAIN_WORDS.find(w => (h.text || '').includes(w)) || null;
        const res = await chrome.runtime.sendMessage({
          action: 'addProspect',
          userId: '',
          nickname: h.author,
          source: { type: 'drain', scenario: note.scenario, noteUrl: note.url, noteTitle: note.title },
          keywordHit: kw,
          likedComment: h.text,
          origin: note.title,
        });
        if (res && res.ok) { added++; } else { skip++; }
      }
      drainToast(`已转 ${added} 人到获客清单${skip ? `(${skip} 已在/跳过)` : ''}（去 🎯获客·用户清单 触达）`);
    } catch (e) { drainToast('转获客失败：' + (e.message || e), 'warn'); }
    render();
  }

  // 生成评论弹层（复用 background handleDrainComment）
  function drainOpenGen(note) {
    const sc = SCENARIO_DRAIN.find(x => x.scenario === note.scenario);
    const box = _sel('sxOut');
    let area;
    box.style.display = 'block';
    box.innerHTML = `
      <div class="sx-out-bar">
        <span style="font-weight:600;color:#1f2937;">${sc.icon} ${sc.label} · 对这篇生成评论</span>
        <button class="btn btn-sm" data-close="1">✕ 收起</button>
      </div>
      <div style="margin-bottom:8px;">
        <input class="sx-in" id="genKw" placeholder="搜索关键词（${sc.scenario === 'evergreen' ? '长尾' : '可选'}）" value="" style="width:100%;margin:0 0 6px;">
        ${sc.scenario === 'city' ? '<div style="display:flex;gap:6px;"><input class="sx-in" id="genCity" placeholder="城市" style="flex:1;"><input class="sx-in" id="genRegion" placeholder="区域" style="flex:1;"></div>' : ''}
      </div>
      <div style="display:flex;gap:6px;margin-bottom:8px;">
        <button class="btn btn-sm btn-primary" id="genDo">✨ 生成</button>
        <button class="btn btn-sm" id="genCopy">📋 复制</button>
      </div>
      <div class="sx-out-text" id="genResult">生成中…</div>`;
    box.querySelector('[data-close]').onclick = () => { box.style.display = 'none'; };
    const run = async () => {
      const res = _sel('genResult'); res.textContent = 'AI 生成中…';
      const r = await chrome.runtime.sendMessage({
        action: 'drainComment',
        scenario: note.scenario,
        noteTitle: note.title || '',
        noteContent: '',
        noteAuthor: (note.author || ''),
        keyword: (_sel('genKw') && _sel('genKw').value) || '',
        city: (_sel('genCity') && _sel('genCity').value) || '',
        region: (_sel('genRegion') && _sel('genRegion').value) || '',
      });
      res.textContent = (r && r.ok) ? (r.comment || '(空)') : ('生成失败：' + ((r && r.error) || '未知'));
      res._txt = res.textContent;
    };
    _sel('genDo').onclick = run;
    _sel('genCopy').onclick = () => {
      const txt = _sel('genResult')._txt || '';
      if (txt) { navigator.clipboard.writeText(txt).then(() => drainToast('已复制')).catch(() => drainToast('复制失败')); }
    };
    run();
  }
}

/* ============ 工具 ============ */
function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escAttr(s) { return escHtml(s); }
function fmtTime(ts) { if (!ts) return '—'; const d = new Date(ts); if (isNaN(d)) return '—'; return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function drainToast(msg, type) {
  const el = document.createElement('div');
  const bg = { ok: '#059669', warn: '#d97706', error: '#dc2626' };
  el.textContent = msg;
  Object.assign(el.style, { position: 'fixed', bottom: '16px', left: '50%', transform: 'translateX(-50%)', background: bg[type] || '#059669', color: '#fff', padding: '8px 14px', borderRadius: '8px', fontSize: '12px', zIndex: 99999, boxShadow: '0 4px 12px rgba(0,0,0,.15)' });
  document.body.appendChild(el);
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 2600);
}

/* 抓当前页笔记（active tab：读 og 标题 + 正文 + 计数） */
async function drainGrabActiveNote() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || !tab.id || !String(tab.url || '').includes('xiaohongshu.com')) return null;
  const m = await drainReadTabMetrics(tab.id);
  const url = (tab.url || '').split('#')[0];
  if (!/\/explore\//.test(url)) return null;
  return Object.assign({ url, title: m.title || '', author: m.author || '' }, m);
}

/* 往目标 tab 注入读 title/计数（笔记页才能拿到赞/评/藏） */
async function drainReadTabMetrics(tabId) {
  const r = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const q = (s) => { const e = document.querySelector(s); return e ? ((e.getAttribute('content')) || (e.textContent || '')).trim() : ''; };
      const ogTitle = q('meta[property="og:title"]').replace(/ - 小红书.*$/, '').trim();
      const ogDesc = q('meta[property="og:description"]');
      const txt = (document.body && document.body.innerText) || '';
      const num = (re) => { const m = txt.match(re); if (!m || !m[1]) return null; let v = m[1].replace(/,,/g, '') ; const w = v.includes('万') ? 10000 : 1; const n = parseFloat(v) * w; return isNaN(n) ? 0 : Math.round(n); };
      const author = (document.querySelector('meta[name="author"]') || {}).content || '';
      return {
        title: ogTitle || document.title.replace(/ - 小红书.*$/, '').trim(),
        content: ogDesc || '',
        author: (author || '').trim(),
        likes: num(/([\d.,万]+)\s*(赞|次赞|喜欢)/),
        comments: num(/([\d.,万]+)\s*(评论)/),
        collects: num(/([\d.,万]+)\s*(收藏)/),
      };
    },
  });
  const res = r && r[0] && r[0].result;
  return res || {};
}

/* =====================================================================
 * 获客扫描(ScanEngine) —— background 侧
 * 复用 auto-water 的搜索tab + extractSearchResults：
 *  来源 → 开搜索/主页tab → 读列表卡片(noteId/标题/赞/排名) → 入池 drain_notes
 *  扫描完做「存量对账补齐」：本次没被打开的存量笔记按 noteId/标题补开刷新
 * ===================================================================== */
async function _scanExtractList(tab, url) {
  if (!tab) return { notes: [], ok: false, err: '未找到小红书标签页' };
  try {
    await chrome.tabs.update(tab.id, { url });
    await AutoWater._waitForTabLoad(tab.id, 15000);
    await AutoWater._sleep(1300);
    let res, triedInject = false;
    try {
      res = await AutoWater._send(tab.id, { action: 'extractSearchResults' }, 15000);
    } catch (e) {
      triedInject = true;
      try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }); } catch (_) {}
      await AutoWater._sleep(800);
      try { res = await AutoWater._send(tab.id, { action: 'extractSearchResults' }, 15000); } catch (e2) { res = null; }
    }
    const notes = (res && res.notes) || [];
    if (!notes.length) {
      return { notes: [], ok: true, err: (triedInject ? '已重注入内容脚本；' : '') + '未提取到笔记（多半是未登录/风控/页面没加载出来）' };
    }
    return { notes, ok: true, err: '' };
  } catch (e) {
    return { notes: [], ok: false, err: e && e.message || String(e) };
  }
}
async function _mergeAutoWaterFound() {
  // 把获客/办公自动灌水扫描已发现的笔记并入截流池（去重按 noteId）
  let imported = 0;
  try {
    const st = await Storage.getAutoWaterState();
    const found = (st && st.searchState && st.searchState.foundNotes) || [];
    if (!found.length) return 0;
    const notes = await drainLoad();
    const add = [];
    for (const n of found) {
      if (!n || !n.noteId) continue;
      if (notes.some(x => x.noteId === n.noteId)) continue;
      add.push({
        id: _uid(), scenario: 'burst', noteId: n.noteId,
        url: n.url || 'https://www.xiaohongshu.com/explore/' + n.noteId,
        title: n.title || '（待抓取标题）', author: n.author || '',
        signals: { likes: n.likes || 0, rank: 0, delta: 0 }, state: 'monitoring',
        addedAt: Date.now(), lastSeenAt: Date.now(), lastJudgedAt: Date.now(), missRounds: 0,
      });
    }
    if (add.length) { notes.push.apply(notes, add); await drainSave(notes); imported = add.length; }
  } catch (e) {}
  return imported;
}

async function _scanBackfill(note, tab) {
  try {
    if (note.noteId) {
      await chrome.tabs.update(tab.id, { url: 'https://www.xiaohongshu.com/explore/' + note.noteId });
      await AutoWater._waitForTabLoad(tab.id, 15000);
      await AutoWater._sleep(1800);
      const m = await drainReadTabMetrics(tab.id);
      if (!m || m.likes == null) return false;
      const prev = (note.signals && note.signals.likes) || 0;
      note.signals = Object.assign({}, note.signals, m, { delta: (m.likes != null && prev != null) ? (m.likes - prev) : 0 });
      if (m.title) note.title = m.title;
      note.missRounds = 0;
      note.lastJudgedAt = Date.now();
      return true;
    }
    if (note.title) {
      const r = await _scanExtractList(tab, DRAIN_SEARCH_URL(note.title));
      const list = r.notes || [];
      const hit = list.find(x => x.noteId && note.noteId === x.noteId) ||
                  list.find(x => x.title && note.title && String(x.title).replace(/\s+/g, '') === String(note.title).replace(/\s+/g, ''));
      if (hit) { note.noteId = hit.noteId; note.url = hit.url || note.url; note.missRounds = 0; note.lastSeenAt = Date.now(); return true; }
      return false;
    }
    return false;
  } catch (e) { return false; }
}

/* 在获客里打开/分析一篇笔记 → 登记/更新进截流监控池
   （获客是主要使用路径：打开一篇就该出现在截流列表，增或更新） */
async function handleDrainTrackNote(data) {
  data = data || {};
  const url = String(data.url || '').split('#')[0];
  let noteId = data.noteId || (url && (url.match(/\/explore\/([a-f0-9]+)/) || url.match(/\/note\/([a-f0-9]+)/) || [])[1]) || '';
  if (!noteId && !url) return { ok: false, error: '缺笔记信息' };
  const notes = await drainLoad();
  const norm = (s) => String(s || '').replace(/[?#].*$/, '');
  const exist = notes.find(x =>
    (noteId && x.noteId === noteId) ||
    (url && x.url && norm(x.url) === norm(url)));
  if (exist) {
    if (data.title) exist.title = data.title;
    if (data.author) exist.author = data.author;
    if (!exist.noteId && noteId) exist.noteId = noteId;
    exist.signals = Object.assign({}, exist.signals, {
      likes: (data.likes != null) ? data.likes : exist.signals.likes,
      comments: (data.commentsCount != null) ? data.commentsCount : exist.signals.comments,
    });
    exist.lastSeenAt = Date.now();
    if (exist.missRounds) exist.missRounds = 0;
  } else {
    notes.unshift({
      id: _uid(), scenario: 'burst', noteId: noteId || '', url: url || ('https://www.xiaohongshu.com/explore/' + noteId),
      title: data.title || '（待抓取标题）', author: data.author || '',
      signals: { likes: data.likes || 0, comments: data.commentsCount || 0, rank: 0, delta: 0 },
      state: 'monitoring', addedAt: Date.now(), lastSeenAt: Date.now(), lastJudgedAt: Date.now(), missRounds: 0,
    });
  }
  await drainSave(notes);
  return { ok: true, total: notes.length };
}

async function handleDrainScan(data) {
  let cfg = await drainGetScanCfg();
  // 首次：从现有关键词种子扫描来源
  if (!cfg.sources || !cfg.sources.length) {
    const config = await Storage.getConfig();
    const kws = (config.keywords || []).filter(Boolean).slice(0, 10);
    cfg.sources = kws.map(k => ({ scenario: 'burst', term: k, kind: 'search' }));
    if (!cfg.sources.length) cfg.sources = [{ scenario: 'burst', term: '金融理财', kind: 'search' }];
  }

  // ★ 先并入获客/灌水已扫到的笔记（auto-water foundNotes），让"获客扫完→截流可见"成立
  const importedWater = await _mergeAutoWaterFound();

  const notes = await drainLoad();
  const seen = new Set();

  // ★ 扫描只用【专用小红书标签页】并按来源逐词导航搜索 —— 绝不抓用户当前正看的任意页面。
  let tab = await AutoWater._getXhsTab();
  if (!tab) throw new Error('未找到小红书标签页，请先打开一个小红书页面');

  let foundNew = 0, refreshed = 0;
  let allEmpty = 0, anyFail = false;
  const detail = [];
  const srcs = cfg.sources || [];
  for (let i = 0; i < srcs.length; i++) {
    const src = srcs[i];
    const url = src.kind === 'profile'
      ? (String(src.term).startsWith('http') ? src.term : 'https://www.xiaohongshu.com' + String(src.term))
      : DRAIN_SEARCH_URL(src.term);
    const r = await _scanExtractList(tab, url);
    const list = r.notes || [];
    if (!r.ok) anyFail = true;
    if (!list.length) allEmpty++;
    detail.push({ term: src.term, kind: src.kind || 'search', got: list.length, ok: r.ok, err: r.err || '' });
    for (const n of list) {
      const noteId = n.noteId;
      if (!noteId) continue;
      seen.add(noteId);
      const key = (x) => x.noteId === noteId || (n.noteId && x.url && x.url.includes(noteId));
      const exist = notes.find(key);
      if (exist) {
        exist.signals = Object.assign({}, exist.signals, { likes: n.likes || exist.signals.likes, rank: exist.signals.rank || 0 });
        if (n.title) exist.title = n.title;
        if (n.author) exist.author = n.author;
        exist.lastSeenAt = Date.now();
        if (exist.missRounds) { exist.missRounds = 0; }
        refreshed++;
      } else {
        notes.push({
          id: _uid(), scenario: src.scenario || 'burst', noteId, url: n.url || 'https://www.xiaohongshu.com/explore/' + noteId,
          title: n.title || '（待抓取标题）', author: n.author || '',
          signals: { likes: n.likes || 0, rank: 0, delta: 0 }, state: 'monitoring',
          addedAt: Date.now(), lastSeenAt: Date.now(), lastJudgedAt: Date.now(), missRounds: 0,
        });
        foundNew++;
      }
    }
    await drainSave(notes);
  }

  // 增量对账补齐：本次没被打开的存量笔记补开
  let backfilled = 0, missDiscarded = 0;
  const MISS_CAP = 3;
  for (const note of notes) {
    if (!note.noteId) continue;
    if (seen.has(note.noteId)) { if (note.missRounds) note.missRounds = 0; continue; }
    const ok = await _scanBackfill(note, tab);
    if (ok) { backfilled++; }
    else {
      note.missRounds = (note.missRounds || 0) + 1;
      if (note.missRounds >= MISS_CAP) missDiscarded++;
    }
  }
  await drainSave(notes);

  cfg.lastScanAt = Date.now();
  let note = '';
  if (foundNew === 0 && !notes.length) {
    note = allEmpty >= srcs.length
      ? '所有来源都未提取到笔记：多半是浏览器未登录小红书，或那个标签页没在有结果的搜索页。请登录后重试。'
      : '没有新笔记（本轮来源已扫描）。详情见下方。';
  }
  cfg.lastScanSummary = { foundNew, refreshed, backfilled, missDiscarded, total: notes.length, at: Date.now(), detail, note, imported: importedWater };
  if ((data && data.autoScanMin) != null) cfg.autoScanMin = data.autoScanMin;
  await drainSaveScanCfg(cfg);

  return { ok: true, summary: cfg.lastScanSummary };
}

async function handleDrainGetScanCfg() {
  return { ok: true, cfg: await drainGetScanCfg() };
}
async function handleDrainSaveScanCfg(data) {
  const cfg = data && data.cfg;
  if (!cfg || !Array.isArray(cfg.sources)) throw new Error('配置格式不对');
  // 去掉空来源
  cfg.sources = (cfg.sources || []).filter(s => s && String(s.term || '').trim());
  await drainSaveScanCfg(cfg);
  return { ok: true, cfg };
}

/* =====================================================================
 * 补开对账引擎（每轮获客后：对本轮未打开的池内笔记，按决策配置表决定开/不开并更新）
 * ===================================================================== */
function _drainReplenishDefaults() {
  return {
    enabled: true,
    strategy: {
      evergreen: { mode: 'always' },
      highv: { mode: 'always' },
      burst: { mode: 'ttl', ttlHours: 24 },
      city: { mode: 'ttl', ttlHours: 24 },
      pain: { mode: 'interval', intervalHours: 12 },
      topic: { mode: 'interval', intervalHours: 6, emotionRatio: 1.0 },
    },
    lastReplenishAt: 0,
    lastReplenishSummary: null,
  };
}
async function drainGetReplenishCfg() {
  const cfg = await drainGetScanCfg();
  return Object.assign(_drainReplenishDefaults(), cfg.replenish || {});
}
async function drainSaveReplenishCfg(repl) {
  const cfg = await drainGetScanCfg();
  cfg.replenish = repl || _drainReplenishDefaults();
  await drainSaveScanCfg(cfg);
  return cfg.replenish;
}

/* 决策：根据场景策略返回 'open' | 'skip' | 'expire' */
function drainDecideOpen(scenario, note, now, stratCfg) {
  const last = Number(note.replenishedAt || note.lastSeenAt || 0);
  const mode = (stratCfg && stratCfg.mode) || 'interval';
  const ivMs = ((stratCfg && stratCfg.intervalHours) || 12) * 3600 * 1000;
  const ttlMs = ((stratCfg && stratCfg.ttlHours) || 24) * 3600 * 1000;
  if (mode === 'always') return 'open';
  if (mode === 'ttl') {
    // 只在 TTL 内打开刷新；超期且已被打开过 → 淘汰（不再开）
    if (last > 0 && (now - last) > ttlMs) return 'expire';
    return 'open';
  }
  // interval
  if (last === 0) return 'open';
  return (now - last) >= ivMs ? 'open' : 'skip';
}

/* 打开一篇待补笔记刷新指标；topic 打开后若热度跌破则淘汰 */
async function _drainReopenNote(note, tab, strategCfg) {
  try {
    if (!note.noteId) return { ok: false };
    await chrome.tabs.update(tab.id, { url: 'https://www.xiaohongshu.com/explore/' + note.noteId });
    await AutoWater._waitForTabLoad(tab.id, 15000);
    await AutoWater._sleep(1800);
    const m = await drainReadTabMetrics(tab.id);
    if (!m || m.likes == null) return { ok: false };
    const prev = (note.signals && note.signals.likes) || 0;
    note.signals = Object.assign({}, note.signals, m, { delta: (m.likes != null && prev != null) ? (m.likes - prev) : 0 });
    if (m.title) note.title = m.title;
    // topic：打开后重判情绪，跌破阈值 → 淘汰
    if (note.scenario === 'topic') {
      const likes = m.likes || 1, comments = m.comments || 0;
      const ratio = likes > 0 ? comments / likes : 0;
      const need = Number((strategCfg && strategCfg.emotionRatio) != null ? strategCfg.emotionRatio : 1.0);
      if (ratio < need) return { ok: true, expire: true };
    }
    note.replenishedAt = Date.now();
    note.lastSeenAt = Date.now();
    note.lastJudgedAt = Date.now();
    note.missRounds = 0;
    return { ok: true };
  } catch (e) { return { ok: false }; }
}

let _drainReplenishing = false;
async function handleDrainReplenish(data) {
  if (_drainReplenishing) return { ok: true, busy: true };
  _drainReplenishing = true;
  try {
    let repl = await drainGetReplenishCfg();
    if (repl.enabled === false) return { ok: true, disabled: true };
    const strat = repl.strategy || _drainReplenishDefaults().strategy;
    const notes = await drainLoad();
    const now = Date.now();
    const tab = await AutoWater._getXhsTab();
    let opened = 0, skipped = 0, expired = 0, failed = 0, candidates = 0;
    const seen = new Set(); // 本轮已补开的 noteId 去重

    for (const note of notes) {
      if (note.state === 'expired' || note.is_active === false) continue;
      const sc = note.scenario || 'burst';
      const scStrat = strat[sc] || { mode: 'interval', intervalHours: 12 };
      const decision = drainDecideOpen(sc, note, now, scStrat);
      if (decision === 'skip') { skipped++; continue; }
      if (decision === 'expire') { note.state = 'expired'; note.exit_reason = 'no_potential'; note.exitedAt = now; expired++; continue; }
      // open
      candidates++;
      if (!note.noteId || seen.has(note.noteId)) { skipped++; continue; }
      seen.add(note.noteId);
      const r = await _drainReopenNote(note, tab, scStrat);
      if (r && r.ok) {
        if (r.expire) { note.state = 'expired'; note.exit_reason = 'topic_cold'; note.exitedAt = now; expired++; }
        else opened++;
      } else { note.missRounds = (note.missRounds || 0) + 1; failed++; }
    }
    await drainSave(notes);

    repl.lastReplenishAt = now;
    repl.lastReplenishSummary = { opened, skipped, expired, failed, candidates, at: now };
    await drainSaveReplenishCfg(repl);

    return { ok: true, summary: repl.lastReplenishSummary };
  } finally {
    _drainReplenishing = false;
  }
}
async function handleDrainGetReplenishCfg() { return { ok: true, repl: await drainGetReplenishCfg() }; }
async function handleDrainSaveReplenishCfg(data) { const repl = await drainSaveReplenishCfg(data && data.repl); return { ok: true, repl }; }

/* =====================================================================
 * background 侧：真正调 AI 生成某场景评论（onMessage 'drainComment'）
 * ===================================================================== */
function _fillSentiment(pick, data) {
  const product = (data && data.product) || '本产品';
  const cheap = (s) => String(s || '')
    .replace(/\{product\}/g, product)
    .replace(/\{title\}/g, (data && data.noteTitle) || '（这篇笔记的主题）')
    .replace(/\{content\}/g, (data && data.noteContent) || '（未提供正文，基于标题发挥）')
    .replace(/\{author\}/g, (data && data.noteAuthor) || '博主')
    .replace(/\{keyword\}/g, (data && data.keyword) || '示例关键词')
    .replace(/\{city\}/g, (data && data.city) || '深圳')
    .replace(/\{region\}/g, (data && data.region) || '这边')
    .replace(/\{pain\}/g, (data && data.painText) || (data && data.noteTitle) || '用户正在求助的原文');
  return cheap(pick);
}

async function handleDrainComment(data) {
  const sc = (SCENARIO_DRAIN || []).find(s => s.scenario === (data && data.scenario));
  if (!sc) throw new Error('未知截流场景: ' + (data && data.scenario));
  const config = await Storage.getConfig();
  const aiCfg = Object.assign({}, config.ai || {}, { maxTokens: 900 });
  if (!aiCfg.apiKey && !aiCfg.fallbackApiKey) throw new Error('尚未配置 AI（请在设置里填 API Key）');
  const product = (config.product && config.product.name) || '本产品';
  const payload = Object.assign({}, data, { product });
  const r = await AiClient.chatCompletion(aiCfg, _fillSentiment(sc.system, payload), _fillSentiment(sc.user, payload));
  let text = String((r && r.content) || '').trim();
  text = text.replace(/^(```(?:json|text)?|"""|''')/, '').replace(/(```|"""|''')$/, '').trim();
  text = text.replace(/^["']|["']$/g, '').trim();
  return { comment: text, scenario: data.scenario };
}