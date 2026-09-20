/* 全场景智能截流系统 前端页面 */
/* 四个区块：场景配置 / 笔记监控列表 / 退出日志 / 手动扫描 */

const SCENARIO_LABELS = {
    burst: '爆发狙击', evergreen: '长尾常青', city: '同城精准',
    pain: '痛点猎杀', topic: '话题吃瓜', highv: '高V狙击',
};
const SCENARIO_ICONS = {
    burst: '🚀', evergreen: '🌲', city: '📍',
    pain: '🎯', topic: '🍿', highv: '👑',
};
const SCENARIO_DESC = {
    burst: '抓推荐流 · 起飞前抢C位',
    evergreen: '抓搜索流 · 长期霸占干货排名',
    city: '抓LBS流 · 同城本地信任截流',
    pain: '抓精准转化 · 命中求助用户',
    topic: '抓高曝光 · 蹭争议/情绪帖',
    highv: '抓溢出流量 · 借头部IP',
};
const MONITOR_STATE_LABELS = { monitoring: '监控中', actioned: '已干预', expired: '已退出', archived: '已归档' };
const EXIT_REASON_LABELS = {
    time_expired: '时间到期', no_potential: '判死退出',
    goal_done: '达成退出', replaced: '让位退出',
};

const interceptState = {
    configs: [],
    monitors: [],
    exits: [],
    scenarioFilter: '',
    activeOnly: true,
    activeTab: 'monitors',
};

/* 可编辑的场景配置字段 */
const CONFIG_FIELDS = [
    { key: 'enabled', label: '启用', type: 'bool' },
    { key: 'climb_likes_delta', label: '爆发Δ点赞阈值', type: 'number', step: 1 },
    { key: 'emotion_ratio', label: '话题情绪指数阈值', type: 'number', step: 0.1 },
    { key: 'top_n', label: 'TopN(卡位/高V)', type: 'number', step: 1 },
    { key: 'max_candidates', label: '单次候选入列数', type: 'number', step: 1 },
    { key: 'scan_interval_min', label: '扫描间隔(分钟)', type: 'number', step: 1 },
    { key: 'entry_ttl_hours', label: '监控有效期(小时,-1长期)', type: 'number', step: 1 },
    { key: 'no_climb_strikes', label: '判死连续次数', type: 'number', step: 1 },
    { key: 'target_comments', label: '每篇目标评论数', type: 'number', step: 1 },
    { key: 'max_comments', label: '每篇评论上限', type: 'number', step: 1 },
    { key: 'wash_hours', label: '活水审查周期(小时)', type: 'number', step: 1 },
    { key: 'wash_interval_days', label: '长尾复审周期(天)', type: 'number', step: 1 },
    { key: 'wash_likes_threshold', label: '已爆点赞阈值', type: 'number', step: 1 },
    { key: 'wash_replies_threshold', label: '已爆回复阈值', type: 'number', step: 1 },
    { key: 'exit_wait_weeks', label: '让位淘汰等待(周)', type: 'number', step: 1 },
    { key: 'region_hint', label: '地域信任词(同城)', type: 'text' },
    { key: 'intent_keywords', label: '求助关键词(逗号分隔)', type: 'text' },
];

function interceptFmtDate(d) {
    if (!d) return '—';
    const dt = new Date(d.replace(' ', 'T'));
    if (isNaN(dt)) return d;
    return `${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}
function interceptNum(v) {
    return (v == null) ? '0' : v;
}
function scenarioTag(sc) {
    return `<span class="tag-blue">${SCENARIO_ICONS[sc] || ''} ${SCENARIO_LABELS[sc] || sc}</span>`;
}

async function renderIntercept(container) {
    container.innerHTML = `
        <div class="mb-4 flex items-center justify-between flex-wrap gap-3">
            <div>
                <h2 class="text-lg font-medium">全场景智能截流系统</h2>
                <p class="text-xs text-gray-500">监控引擎发现 → 笔记监控列表 → 分级干预 → 活水清洗闭环</p>
            </div>
            <div class="flex items-center gap-2">
                <button onclick="interceptRunOnce()" class="btn-primary btn-sm">⚡ 立即扫描一轮</button>
                <button onclick="interceptOpenDebug()" class="btn-secondary btn-sm">🔬 干跑调试</button>
                <button onclick="interceptLoadAll()" class="btn-secondary btn-sm">🔄 刷新</button>
            </div>
        </div>

        <!-- Tab -->
        <div class="flex gap-2 mb-4">
            <button onclick="interceptSetTab('monitors')" id="tab-monitors" class="btn-secondary btn-sm">📋 笔记监控列表</button>
            <button onclick="interceptSetTab('config')" id="tab-config" class="btn-secondary btn-sm">⚙️ 场景配置</button>
            <button onclick="interceptSetTab('exits')" id="tab-exits" class="btn-secondary btn-sm">🚪 退出日志</button>
        </div>

        <div id="intercept-monitors"></div>
        <div id="intercept-config" style="display:none"></div>
        <div id="intercept-exits" style="display:none"></div>
    `;
    interceptSetTab(interceptState.activeTab);
    await Promise.all([
        interceptLoadConfigs(), interceptLoadMonitors(), interceptLoadExits(),
    ]);
}

function interceptSetTab(tab) {
    interceptState.activeTab = tab;
    ['monitors', 'config', 'exits'].forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        const box = document.getElementById(`intercept-${t}`);
        if (btn) btn.className = `btn-${t === tab ? 'primary' : 'secondary'} btn-sm`;
        if (box) box.style.display = t === tab ? 'block' : 'none';
    });
    if (tab === 'monitors') interceptRenderMonitors();
    if (tab === 'config') interceptRenderConfigs();
    if (tab === 'exits') interceptRenderExits();
}

async function interceptLoadAll() {
    await Promise.all([interceptLoadConfigs(), interceptLoadMonitors(), interceptLoadExits(), toast('已刷新')]);
}

/* ============ 数据加载 ============ */
async function interceptLoadConfigs() {
    try { interceptState.configs = ((await API.get('/intercept/configs')).scenarios || []); }
    catch (e) { toast(e.message, 'error'); }
}
async function interceptLoadMonitors() {
    try {
        const query = interceptState.activeOnly ? 'active=1' : 'active=0';
        if (interceptState.scenarioFilter) query += `&scenario=${interceptState.scenarioFilter}`;
        interceptState.monitors = await API.get(`/intercept/monitors?${query}`);
    } catch (e) { toast(e.message, 'error'); }
}
async function interceptLoadExits() {
    try { interceptState.exits = await API.get('/intercept/exits'); }
    catch (e) { toast(e.message, 'error'); }
}
async function interceptRunOnce() {
    const btn = event && event.target;
    if (btn) { btn.disabled = true; btn.textContent = '扫描中...'; }
    try {
        await API.post('/intercept/run-once', {});
        toast('已触发一轮扫描');
        await Promise.all([interceptLoadMonitors(), interceptLoadExits()]);
        interceptRenderMonitors(); interceptRenderExits();
    } catch (e) { toast(e.message, 'error'); }
    if (btn) { btn.disabled = false; btn.textContent = '⚡ 立即扫描一轮'; }
}

/* ============ 监控列表 Tab ============ */
function interceptRenderMonitors() {
    const el = document.getElementById('intercept-monitors');
    if (!el) return;
    const list = interceptState.monitors || [];
    el.innerHTML = `
        <div class="flex items-center gap-2 mb-3 flex-wrap">
            <select id="mon-scenario" class="input" style="width:auto;">
                <option value="">全部场景</option>
                ${Object.keys(SCENARIO_LABELS).map(s =>
                    `<option value="${s}" ${s === interceptState.scenarioFilter ? 'selected' : ''}>${SCENARIO_LABELS[s]}</option>`).join('')}
            </select>
            <label class="flex items-center gap-1 text-sm text-gray-400">
                <input type="checkbox" id="mon-active" ${interceptState.activeOnly ? 'checked' : ''} onchange="interceptToggleActive()">
                只看监控中
            </label>
            <span class="text-xs text-gray-500">共 ${list.filter(m => m.state !== 'expired' || !interceptState.activeOnly).length} 条</span>
        </div>
        <div class="card overflow-x-auto">
            ${list.length === 0 ? `<div class="empty-state"><div class="text">暂无监控笔记，等待引擎入口入列</div></div>` : `
            <table class="w-full text-sm">
                <thead>
                    <tr class="text-left text-gray-500 text-xs">
                        <th class="p-2">场景</th><th class="p-2">笔记</th><th class="p-2">点赞</th>
                        <th class="p-2">评论</th><th class="p-2">排名</th><th class="p-2">我评论</th>
                        <th class="p-2">状态</th><th class="p-2">入列/过期</th>
                    </tr>
                </thead>
                <tbody>
                    ${list.map(m => `
                        <tr class="border-t border-gray-800/60" style="vertical-align:top;">
                            <td class="p-2">${scenarioTag(m.scenario)}</td>
                            <td class="p-2 max-w-[220px]">
                                <div class="font-medium text-gray-200 break-words">${escapeHtml(m.title || '(无标题)')}</div>
                                <div class="text-xs text-gray-500 truncate">${escapeHtml(m.author || '')}</div>
                                <a href="${escapeHtml(m.note_url)}" target="_blank" class="text-xs text-blue-400 hover:underline">打开 ↗</a>
                            </td>
                            <td class="p-2 text-center">${interceptNum(m.last_likes)}</td>
                            <td class="p-2 text-center">${interceptNum(m.last_comments)}</td>
                            <td class="p-2 text-center">${m.last_view_rank ? '#' + m.last_view_rank : '—'}</td>
                            <td class="p-2 text-center">${interceptNum(m.our_comment_count)}</td>
                            <td class="p-2">
                                <span class="tag-${m.state === 'expired' ? 'gray' : (m.state === 'actioned' ? 'green' : 'blue')}">${MONITOR_STATE_LABELS[m.state] || m.state}</span>
                                ${m.consecutive_no_climb ? `<div class="text-xs text-yellow-500">无爬坡×${m.consecutive_no_climb}</div>` : ''}
                                ${m.exit_reason ? `<div class="text-xs text-gray-500">${EXIT_REASON_LABELS[m.exit_reason] || m.exit_reason}</div>` : ''}
                            </td>
                            <td class="p-2 text-xs text-gray-500">
                                <div>入列 ${interceptFmtDate(m.entry_at)}</div>
                                ${m.expire_at ? `<div>过期 ${interceptFmtDate(m.expire_at)}</div>` : '<div class="text-green-500">长期驻留</div>'}
                                ${m.exited_at ? `<div class="text-red-400">退出 ${interceptFmtDate(m.exited_at)}</div>` : ''}
                            </td>
                        </tr>`).join('')}
                </tbody>
            </table>`}
        </div>
    `;
    const sel = document.getElementById('mon-scenario');
    if (sel) sel.onchange = async (e) => {
        interceptState.scenarioFilter = e.target.value;
        await interceptLoadMonitors(); interceptRenderMonitors();
    };
}

function interceptToggleActive() {
    interceptState.activeOnly = document.getElementById('mon-active').checked;
    interceptLoadMonitors().then(interceptRenderMonitors);
}

/* ============ 场景配置 Tab ============ */
function interceptRenderConfigs() {
    const el = document.getElementById('intercept-config');
    if (!el) return;
    const list = interceptState.configs || [];
    if (list.length === 0) { el.innerHTML = '<div class="empty-state"><div class="text">暂无配置，请先初始化数据库</div></div>'; return; }
    el.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            ${list.map(c => {
                const sc = c.scenario;
                const off = !c.enabled;
                return `
                <div class="card p-4" style="${off ? 'opacity:0.6;' : ''}">
                    <div class="flex items-center justify-between mb-2">
                        <div class="flex items-center gap-2">
                            <span class="text-2xl">${SCENARIO_ICONS[sc] || '⚡'}</span>
                            <div>
                                <div class="font-medium">${SCENARIO_LABELS[sc] || sc}</div>
                                <div class="text-xs text-gray-500">${SCENARIO_DESC[sc] || ''}</div>
                            </div>
                        </div>
                        ${off ? '<span class="tag-gray">已停用</span>' : '<span class="tag-green">运行中</span>'}
                    </div>
                    <div class="text-xs space-y-1 text-gray-400 mb-3">
                        <div>监控周期：${c.entry_ttl_hours === -1 ? '长期驻留' : c.entry_ttl_hours + 'h'} · 扫描 ${c.scan_interval_min}min · TopN ${c.top_n}</div>
                        <div>评论 ${c.target_comments}~${c.max_comments}条/篇 · 活水 ${c.wash_hours}h</div>
                        <div>判死次数 ${c.no_climb_strikes} · 让位等待 ${c.exit_wait_weeks}周</div>
                    </div>
                    <button onclick="interceptEditConfig('${sc}')" class="btn-secondary btn-sm w-full">⚙️ 编辑参数</button>
                </div>`;
            }).join('')}
        </div>
    `;
}

/* 配置编辑模态框 */
async function interceptEditConfig(scenario) {
    const list = interceptState.configs || [];
    const cfg = list.find(c => c.scenario === scenario);
    if (!cfg) return;
    const fieldInputs = CONFIG_FIELDS.map(f => {
        const v = cfg[f.key];
        let input;
        if (f.type === 'bool') {
            input = `<input id="cf-${f.key}" type="checkbox" ${v ? 'checked' : ''} class="mt-1">`;
        } else if (f.type === 'text') {
            input = `<input id="cf-${f.key}" class="input mt-1" value="${escapeHtml(Array.isArray(v) ? (v || []).join(',') : v ?? '')}">`;
        } else {
            input = `<input id="cf-${f.key}" type="number" step="${f.step || 1}" class="input mt-1" value="${v ?? ''}">`;
        }
        return `<div>
            <label class="text-xs text-gray-400">${f.label}</label>
            ${input}
        </div>`;
    }).join('');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML = `
        <div class="modal max-w-2xl max-h-[85vh] overflow-y-auto">
            <h3 class="text-lg font-medium mb-4">⚙️ ${SCENARIO_ICONS[scenario]} ${SCENARIO_LABELS[scenario]} · 参数配置</h3>
            <div class="grid grid-cols-2 gap-3">${fieldInputs}</div>
            <div class="flex justify-end gap-2 mt-6">
                <button onclick="this.closest('.modal-overlay').remove()" class="btn-secondary btn-sm">取消</button>
                <button onclick="interceptSaveConfig('${scenario}')" class="btn-primary btn-sm">保存</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    window['intercept_save_scenario'] = scenario;
}

async function interceptSaveConfig(scenario) {
    const payload = {};
    for (const f of CONFIG_FIELDS) {
        const el = document.getElementById(`cf-${f.key}`);
        if (!el) continue;
        if (f.type === 'bool') payload[f.key] = el.checked;
        else if (f.type === 'text') {
            const val = el.value.trim();
            payload[f.key] = f.key === 'intent_keywords' ? val.split(/[,，]/).map(x => x.trim()).filter(Boolean) : val;
        }
        else {
            const n = parseFloat(el.value);
            payload[f.key] = isNaN(n) ? null : n;
        }
    }
    try {
        await API.post(`/intercept/configs/${scenario}`, payload);
        const overlay = document.querySelector('.modal-overlay');
        if (overlay) overlay.remove();
        toast('配置已保存');
        await interceptLoadConfigs(); interceptRenderConfigs();
    } catch (e) { toast(e.message, 'error'); }
}

/* ============ 退出日志 Tab ============ */
function interceptRenderExits() {
    const el = document.getElementById('intercept-exits');
    if (!el) return;
    const list = interceptState.exits || [];
    el.innerHTML = `
        <div class="card">
            ${list.length === 0 ? `<div class="empty-state"><div class="text">暂无退出记录</div></div>` : `
            <table class="w-full text-sm">
                <thead>
                    <tr class="text-left text-gray-500 text-xs">
                        <th class="p-2">时间</th><th class="p-2">场景</th><th class="p-2">退出原因</th>
                        <th class="p-2">说明</th><th class="p-2">笔记</th>
                    </tr>
                </thead>
                <tbody>
                    ${list.map(e => `
                        <tr class="border-t border-gray-800/60">
                            <td class="p-2 text-xs text-gray-500">${interceptFmtDate(e.created_at)}</td>
                            <td class="p-2">${scenarioTag(e.scenario)}</td>
                            <td class="p-2"><span class="tag-gray">${EXIT_REASON_LABELS[e.exit_reason] || e.exit_reason}</span></td>
                            <td class="p-2 text-xs text-gray-400 max-w-[260px]">${escapeHtml(e.detail || '')}</td>
                            <td class="p-2 text-xs max-w-[200px] truncate">
                                <a href="${escapeHtml(e.note_url)}" target="_blank" class="text-blue-400 hover:underline">${escapeHtml(e.note_url || '')}</a>
                            </td>
                        </tr>`).join('')}
                </tbody>
            </table>`}
        </div>
    `;
}

/* ============ 干跑调试 ============ */
function interceptOpenDebug() {
    let ov = document.getElementById('debug-probe-overlay');
    if (ov) { ov.style.display = 'flex'; return; }
    ov = document.createElement('div');
    ov.id = 'debug-probe-overlay';
    ov.className = 'modal-overlay';
    ov.style.display = 'flex';
    ov.innerHTML = `
        <div class="modal max-w-3xl max-h-[85vh] overflow-y-auto">
            <h3 class="text-lg font-medium mb-2">🔬 干跑调试 · 真机采集验证</h3>
            <p class="text-xs text-gray-500 mb-4">真机打开给定链接，把抓到的原始指标原样返回。只读、不评论、不写库。</p>
            <div class="space-y-3">
                <div>
                    <label class="text-xs text-gray-400">笔记链接（点进级 point_metrics + 热评）</label>
                    <input id="dp-note" class="input mt-1" placeholder="https://www.xiaohongshu.com/explore/xxxxxxxx">
                </div>
                <div>
                    <label class="text-xs text-gray-400">列表链接（列表级 list_metrics，可留空）</label>
                    <input id="dp-list" class="input mt-1" placeholder="如搜索页 /search_result?keyword=全网抓取">
                </div>
                <div class="flex justify-end gap-2">
                    <button onclick="document.getElementById('debug-probe-overlay').style.display='none'" class="btn-secondary btn-sm">关闭</button>
                    <button id="dp-run" onclick="interceptRunDebug()" class="btn-primary btn-sm">🔍 开始探测</button>
                </div>
            </div>
            <div id="dp-result" class="mt-4"><div class="text-xs text-gray-500">填入链接后点「开始探测」…</div></div>
        </div>`;
    document.body.appendChild(ov);
    ov.onclick = (e) => { if (e.target === ov) ov.style.display = 'none'; };
}

async function interceptRunDebug() {
    const note = document.getElementById('dp-note').value.trim();
    const list = document.getElementById('dp-list').value.trim();
    if (!note && !list) { toast('请至少填一个链接', 'error'); return; }
    const btn = document.getElementById('dp-run');
    const box = document.getElementById('dp-result');
    if (btn) { btn.disabled = true; btn.textContent = '探测中(浏览器正在打开页面)...'; }
    box.innerHTML = '<div class="loading">探测中…</div>';
    try {
        const r = await API.post('/intercept/debug/probe', { url: note, list_url: list });
        const fmt = (o) => '<pre class="p-2 bg-gray-900 rounded text-xs overflow-x-auto" style="white-space:pre-wrap;">' + escapeHtml(JSON.stringify(o, null, 2)) + '</pre>';
        box.innerHTML = `
            <div class="space-y-2">
                ${r.note ? `<div><div class="text-xs text-gray-400 mb-1">📄 笔记点进级指标</div>${fmt(r.note)}</div>` : ''}
                ${r.hot_comment ? `<div><div class="text-xs text-gray-400 mb-1">🔥 热评(top赞)</div>${fmt(r.hot_comment)}</div>` : ''}
                ${r.note_detail ? `<div><div class="text-xs text-gray-400 mb-1">🪧 笔记被限制，补充抓正文</div>${fmt(r.note_detail)}</div>` : ''}
                ${(r.list || []).length ? `<div><div class="text-xs text-gray-400 mb-1">📋 列表级指标(前15)</div>${fmt(r.list)}</div>` : ''}
                ${!r.note && !(r.list || []).length ? '<div class="text-sm text-gray-400">无有效结果</div>' : ''}
            </div>`;
    } catch (e) {
        box.innerHTML = `<div class="text-red-400 text-sm">探测失败：${escapeHtml(e.message)}</div>`;
    }
    if (btn) { btn.disabled = false; btn.textContent = '🔍 开始探测'; }
}