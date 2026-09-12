/* 消息中心 — 私信会话工作台(单列)
   已同步会话 = 一行；显示状态 / 消息概述(带最后说话方) / AI建议；就地 AI 回复 + 一键发送。
   完整对话时间线收进"抽屉"，默认列表保持干净。
*/
const MSG_INTENT_LABEL = {
    logistics: '物流', product_detail: '产品细节', suitability: '适用性',
    price_compare: '比价', order: '下单', chat: '闲聊', other: '其他',
};
const MSG_STATUS_LABEL = {
    chunting: '触达中', selling: '销售中', won: '已成单', completed: '已完成',
    followup: '需跟进', lost: '流失',
};
const MSG_STATUS_COLOR = {
    chunting: 'gray', selling: 'blue', won: 'green', completed: 'green',
    followup: 'yellow', lost: 'red',
};

const _msg = { status: '', intent: '', recency: '', keyword: '', pendingOnly: false, rows: [], total: 0, timer: null };

async function renderMessages(container) {
    container.innerHTML = `
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <div class="text-sm text-gray-400">私信会话工作台 · 增量同步 · AI 意图识别 · 一键发送</div>
                <div class="flex items-center gap-2">
                    <button onclick="openMsgSettings()" class="btn-secondary btn-sm">⚙ 流失机制</button>
                    <button onclick="openQuickRepliesModal()" class="btn-secondary btn-sm">✎ 快捷话术</button>
                    <button onclick="syncMessages()" class="btn-primary btn-sm">↻ 同步小红书</button>
                </div>
            </div>

            <!-- 状态筛选 -->
            <div class="flex flex-wrap gap-2 border-b border-gray-800 pb-2" id="msg-status-tabs">
                ${tab(false, '全部')}
                ${tab(true, '待确认')}
                ${tab('chunting', '触达中')}
                ${tab('selling', '销售中')}
                ${tab('won', '已成单')}
                ${tab('followup', '需跟进')}
                ${tab('lost', '流失')}
                ${tab('completed', '已完成')}
            </div>

            <!-- 意图 + 时间/激活 + 搜索 -->
            <div class="flex flex-wrap items-center gap-3">
                <select id="msg-intent-sel" class="input w-36" onchange="msgFilterChanged()">
                    <option value="">全部意图</option>
                    ${Object.keys(MSG_INTENT_LABEL).map(k => `<option value="${k}">${MSG_INTENT_LABEL[k]}</option>`).join('')}
                </select>
                <select id="msg-recency-sel" class="input w-40" onchange="msgFilterChanged()">
                    <option value="">按激活时间·全部</option>
                    <option value="today">今日激活</option>
                    <option value="3d">近3天</option>
                    <option value="week">近7天</option>
                    <option value="older">沉没(7天+无互动)</option>
                </select>
                <input id="msg-keyword" class="input" style="min-width:200px;flex:1" placeholder="搜索昵称 / 消息内容..."
                       onkeydown="if(event.key==='Enter')msgFilterChanged()">
                <button onclick="msgFilterChanged()" class="btn-secondary btn-sm">搜索</button>
                <span class="text-xs text-gray-500" id="msg-total"></span>
            </div>

            <div id="msg-list"></div>
        </div>

        <!-- 会话时间线抽屉 -->
        <div id="msg-drawer" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeMsgDrawer()">
            <div class="modal" style="max-width:640px;max-height:85vh;display:flex;flex-direction:column;">
                <div class="flex items-center justify-between mb-3" id="msg-drawer-head"></div>
                <div id="msg-drawer-body" class="flex-1 overflow-y-auto" style="min-height:0"></div>
                <div id="msg-drawer-footer" class="mt-3 border-t border-gray-800 pt-3" style="display:none"></div>
            </div>
        </div>

        <!-- 快捷话术管理 -->
        <div id="qr-modal" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeQrModal()">
            <div class="modal" style="max-width:640px;max-height:85vh;display:flex;flex-direction:column;">
                <h3 class="text-lg font-medium mb-3">✎ 意图快捷话术</h3>
                <div class="flex gap-2 mb-3">
                    <select id="qr-intent" class="input">
                        ${Object.keys(MSG_INTENT_LABEL).map(k => `<option value="${k}">${MSG_INTENT_LABEL[k]}</option>`).join('')}
                    </select>
                    <input id="qr-title" class="input flex-1" placeholder="标题">
                    <input id="qr-content" class="input flex-1" placeholder="话术内容">
                    <button onclick="addQuickReply()" class="btn-primary btn-sm">新增</button>
                </div>
                <div id="qr-list" class="flex-1 overflow-y-auto" style="min-height:0"></div>
            </div>
        </div>

        <!-- 流失/激活机制 设置 -->
        <div id="ms-modal" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeMsgSettings()">
            <div class="modal" style="max-width:420px">
                <h3 class="text-lg font-medium mb-1">⚙ 激活 / 流失机制</h3>
                <p class="text-xs text-gray-500 mb-4">按最后互动时间自动给建议状态，人工确认后生效。</p>
                <div class="space-y-4">
                    <div>
                        <label class="text-xs text-gray-400">对方刚回话、且最后活跃在几日以内 → 视为「激活/待处理」</label>
                        <input id="ms-active" type="number" min="0" class="input mt-1 w-32" placeholder="天">
                    </div>
                    <div>
                        <label class="text-xs text-gray-400">对方 N 天无互动 → 建议「需跟进」</label>
                        <input id="ms-follow" type="number" min="0" class="input mt-1 w-32" placeholder="天">
                    </div>
                    <div>
                        <label class="text-xs text-gray-400">对方 N 天无互动 → 建议「流失」（只建议，不自动标记）</label>
                        <input id="ms-lost" type="number" min="0" class="input mt-1 w-32" placeholder="天">
                    </div>
                    <div class="text-xs text-gray-500">AI 只打标签（有效商机/待定/待复核），不会把任何会话挤掉或筛选掉。</div>
                </div>
                <div class="flex justify-end gap-2 mt-6">
                    <button onclick="closeMsgSettings()" class="btn-secondary btn-sm">取消</button>
                    <button onclick="saveMsgSettings()" class="btn-primary btn-sm">保存</button>
                </div>
            </div>
        </div>
    `;
    _msg.status = '';
    msgSyncTabUI();
    bindMsgStatusTabs();
    await loadConversations();
    clearInterval(_msg.timer);
    _msg.timer = setInterval(() => { if (!document.getElementById('msg-list')) { clearInterval(_msg.timer); return; } loadConversations(true); }, 60000);
}

function tab(cond, label) {
    return `<button data-cond="${cond}" onclick="msgTab(this)" class="px-3 py-1.5 text-sm rounded-lg">${label}</button>`;
}

function bindMsgStatusTabs() {
    document.querySelectorAll('#msg-status-tabs [data-cond]').forEach(b => {
        const c = b.getAttribute('data-cond');
        if (_msg.status === c || (c === 'true' && _msg.pendingOnly)) b.classList.add('bg-gray-800');
        else b.classList.add('text-gray-500');
    });
}

function msgSyncTabUI() {
    document.querySelectorAll('#msg-status-tabs [data-cond]').forEach(b => {
        const c = b.getAttribute('data-cond');
        const on = (_msg.status === c) || (c === 'true' && _msg.pendingOnly);
        b.classList.toggle('bg-gray-800', on);
        b.classList.toggle('text-gray-500', !on);
    });
}

function msgTab(btn) {
    const c = btn.getAttribute('data-cond');
    if (c === 'true') { _msg.pendingOnly = true; _msg.status = ''; }
    else { _msg.status = c; _msg.pendingOnly = false; }
    msgSyncTabUI();
    loadConversations();
}

function msgFilterChanged() {
    _msg.intent = document.getElementById('msg-intent-sel').value;
    _msg.recency = document.getElementById('msg-recency-sel').value;
    _msg.keyword = document.getElementById('msg-keyword').value.trim();
    loadConversations();
}

async function loadConversations(silent) {
    const el = document.getElementById('msg-list');
    if (!el) return;
    if (!silent) showLoading(el);
    try {
        const p = new URLSearchParams({ limit: 500 });
        if (_msg.status) p.set('status', _msg.status);
        if (_msg.intent) p.set('intent', _msg.intent);
        if (_msg.recency) p.set('recency', _msg.recency);
        if (_msg.keyword) p.set('keyword', _msg.keyword);
        if (_msg.pendingOnly) p.set('pending_confirmation', 'true');
        const data = await API.get('/messages?' + p.toString());
        _msg.rows = data.items || [];
        _msg.total = data.total || 0;
        const totalEl = document.getElementById('msg-total');
        if (totalEl) totalEl.textContent = `共 ${_msg.total} 会话`;
        if (_msg.rows.length === 0) { showEmpty(el, '暂无会话，点击右上角「同步小红书」获取'); return; }
        el.innerHTML = `<div class="space-y-2">${_msg.rows.map(rowHtml).join('')}</div>`;
    } catch (e) {
        showError(el, e.message);
    }
}

function timeFmt(s) {
    if (!s) return '';
    return new Date(s).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function intentBadge(intent) {
    const map = { price_compare: 'yellow', order: 'green', product_detail: 'blue', suitability: 'blue', logistics: 'blue', chat: 'gray', other: 'gray' };
    const c = map[intent] || 'gray';
    return `<span class="tag-${c}">📌${MSG_INTENT_LABEL[intent] || intent}</span>`;
}

function labelBadge(label) {
    if (!label) return '';
    const c = label === '有效商机' ? 'green' : (label === '待复核' ? 'yellow' : 'gray');
    return `<span class="tag-${c}">AI·${label}</span>`;
}

function rowHtml(r) {
    const statusC = MSG_STATUS_COLOR[r.status] || 'gray';
    const speaker = r.last_from === '对方' ? '<span class="text-red-400">对方</span>' :
        (r.last_from === '我' ? '<span class="text-blue-400">我✓</span>' : '');
    const suggest = r.has_pending_suggestion && r.suggested_status ? `
        <span class="tag-yellow" title="${escapeHtml(r.suggested_reason || '')}">⚠建议->${MSG_STATUS_LABEL[r.suggested_status] || r.suggested_status}</span>
        <button onclick="confirmSuggested('${escAttr(r.conv_id)}')" class="btn-primary btn-sm">✓确认</button>` : '';
    return `
        <div class="bg-gray-900 rounded-lg p-3 border border-gray-800 hover:border-gray-600 transition">
            <div class="flex items-center gap-2 flex-wrap">
                <span class="font-medium text-sm">${escapeHtml(r.partner_name || '未知名')}</span>
                <span class="text-xs text-gray-500">${timeFmt(r.last_at)}</span>
                ${r.unread_count > 0 && r.last_from === '对方' ? `<span class="tag-red">🔴${r.unread_count}</span>` : ''}
                ${intentBadge(r.intent)}
                ${labelBadge(r.label)}
                <span class="tag-${statusC}">${MSG_STATUS_LABEL[r.status] || r.status}</span>
                ${r.inactive_days > 0 ? `<span class="tag-gray">${r.inactive_days}天无互动</span>` : ''}
                ${suggest}
                <span class="flex-1"></span>
                <button onclick="toggleDetail('${escAttr(r.conv_id)}')" class="btn-secondary btn-sm">查看对话</button>
            </div>
            <div class="mt-2 text-sm text-gray-300 flex items-center gap-1">
                ${speaker}
                <span class="truncate">${escapeHtml(r.last_msg || '—')}</span>
            </div>
            <div class="mt-2 text-xs text-gray-500">${escapeHtml(r.source ? '来源：' + r.source : '')}${r.intent_reason ? ' · ' + escapeHtml(r.intent_reason) : ''}</div>
            <div class="mt-2 flex items-center gap-2 flex-wrap" id="actions-${escAttr(r.conv_id)}">
                <select onchange="setConvStatus('${escAttr(r.conv_id)}', this.value)" class="input w-36">
                    ${Object.entries(MSG_STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${v}</option>`).join('')}
                </select>
                <button onclick="toggleAIReply('${escAttr(r.conv_id)}')" class="btn-secondary btn-sm">🤖 AI回复</button>
                <div id="reply-${escAttr(r.conv_id)}" style="display:none" class="w-full"></div>
            </div>
        </div>`;
}

function escAttr(v) { return escapeHtml(String(v).replace(/["'`]/g, '')); }

async function toggleAIReply(convId) {
    const box = document.getElementById('reply-' + convId);
    const loading = !box || box.style.display === 'none';
    box.style.display = 'block';
    box.innerHTML = '<div class="text-sm text-gray-500">🤖 AI 生成中...</div>';
    try {
        const res = await API.post(`/messages/${convId}/ai-reply`, {});
        box.innerHTML = `
            <div class="bg-gray-800 rounded-lg p-3">
                <div class="text-xs text-gray-500 mb-2">AI 建议回复（${MSG_INTENT_LABEL[res.intent] || res.intent}）：
                    <button onclick="regenAIReply('${escAttr(convId)}')" class="btn-secondary btn-sm ml-2">换一条</button></div>
                <textarea id="draft-${escAttr(convId)}" rows="3" class="input w-full">${escapeHtml(res.reply)}</textarea>
                <div class="flex justify-end gap-2 mt-2">
                    <button onclick="copyDraft('${escAttr(convId)}')" class="btn-secondary btn-sm">复制</button>
                    <button onclick="sendDraft('${escAttr(convId)}')" class="btn-primary btn-sm">✓ 一键发送</button>
                </div>
            </div>`;
    } catch (e) {
        box.innerHTML = `<div class="text-sm text-red-400">${escapeHtml(e.message)}</div>`;
    }
}

async function regenAIReply(convId) {
    const box = document.getElementById('reply-' + convId);
    box.style.display = 'block';
    box.innerHTML = '<div class="text-sm text-gray-500">🤖 重新生成中...</div>';
    try {
        const res = await API.post(`/messages/${convId}/ai-reply`, {});
        const ta = document.getElementById('draft-' + convId);
        if (ta) ta.value = res.reply; else await toggleAIReply(convId);
    } catch (e) {
        box.innerHTML = `<div class="text-sm text-red-400">${escapeHtml(e.message)}</div>`;
    }
}

function copyDraft(convId) {
    const ta = document.getElementById('draft-' + convId);
    if (!ta) return;
    navigator.clipboard.writeText(ta.value).then(() => toast('已复制')).catch(() => toast('复制失败', 'error'));
}

async function sendDraft(convId) {
    const ta = document.getElementById('draft-' + convId);
    const text = (ta ? ta.value : '').trim();
    if (!text) { toast('内容为空', 'error'); return; }
    try {
        const res = await API.post(`/messages/${convId}/send`, { text });
        toast(`已排队发送 → 扩展将自动发出 (任务#${res.task_id})`);
        document.getElementById('reply-' + convId).style.display = 'none';
        await loadConversations(true);
    } catch (e) {
        toast(e.message, 'error');
    }
}

async function setConvStatus(convId, status) {
    try {
        await API.put(`/messages/${convId}/status`, { status });
        toast('状态已更新');
        await loadConversations(true);
    } catch (e) { toast(e.message, 'error'); }
}

async function confirmSuggested(convId) {
    try {
        await API.put(`/messages/${convId}/suggested`, {});
        toast('已确认建议状态');
        await loadConversations(true);
    } catch (e) { toast(e.message, 'error'); }
}

async function syncMessages() {
    const btn = event && event.target || null;
    if (btn) { btn.disabled = true; btn.textContent = '同步中...'; }
    try {
        // Web 发出"请同步"信号 → 扩展(alarm 循环)会主动拉取并同步小红书会话，完成后回写后端
        await API.post('/messages/request-sync', {});
        toast('已请求扩展同步小红书，稍后自动刷新', 'info');
        setTimeout(() => loadConversations(true), 8000);
    } catch (e) {
        toast(e.message, 'error');
        await loadConversations(true);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '↻ 同步小红书'; }
    }
}

/* ---- 激活/流失机制设置 ---- */
async function openMsgSettings() {
    document.getElementById('ms-modal').style.display = 'flex';
    try {
        const s = await API.get('/messages/settings');
        document.getElementById('ms-active').value = s.msg_active_days;
        document.getElementById('ms-follow').value = s.msg_followup_days;
        document.getElementById('ms-lost').value = s.msg_lost_days;
    } catch (e) { toast(e.message, 'error'); }
}
function closeMsgSettings() { document.getElementById('ms-modal').style.display = 'none'; }
async function saveMsgSettings() {
    try {
        const body = {
            msg_active_days: document.getElementById('ms-active').value,
            msg_followup_days: document.getElementById('ms-follow').value,
            msg_lost_days: document.getElementById('ms-lost').value,
        };
        await API.put('/messages/settings', body);
        toast('已保存流失/激活机制');
        closeMsgSettings();
        await loadConversations(true);
    } catch (e) { toast(e.message, 'error'); }
}

/* ---- 会话时间线抽屉 ---- */
let _drawerConvId = null;

async function toggleDetail(convId) {
    _drawerConvId = convId;
    const d = document.getElementById('msg-drawer');
    d.style.display = 'flex';
    const head = document.getElementById('msg-drawer-head');
    const body = document.getElementById('msg-drawer-body');
    const foot = document.getElementById('msg-drawer-footer');
    head.innerHTML = '<span class="text-lg font-medium">加载中...</span>';
    body.innerHTML = '';
    foot.style.display = 'none';
    try {
        const [conv, msgs] = await Promise.all([
            API.get(`/messages/${convId}`),
            API.get(`/messages/${convId}/messages`),
        ]);
        head.innerHTML = `
            <div>
                <div class="text-lg font-medium">${escapeHtml(conv.partner_name || '未知名')} ${intentBadge(conv.intent)}</div>
                <div class="text-xs text-gray-500">${escapeHtml(conv.source ? '来源：' + conv.source : '')} · 状态：${MSG_STATUS_LABEL[conv.status] || conv.status}</div>
            </div>
            <button onclick="closeMsgDrawer()" class="btn-secondary btn-sm">关闭</button>`;
        if (msgs.length === 0) { body.innerHTML = '<div class="text-sm text-gray-500">暂无消息（可能尚未展开同步完整对话）</div>'; }
        else {
            body.innerHTML = `<div class="space-y-2">${msgs.map(m => {
                const me = m.direction === 'me';
                return `<div class="flex ${me ? 'justify-end' : 'justify-start'}">
                    <div class="max-w-[80%] rounded-lg px-3 py-2 text-sm ${me ? 'bg-blue-900/60' : 'bg-gray-800'}">
                        <div class="text-xs text-gray-500 mb-1">${me ? '我' : escapeHtml(m.author || '对方')} · ${timeFmt(m.msg_at)}${m.ai_generated ? ' · AI' : ''}</div>
                        ${escapeHtml(m.text || '')}
                    </div>
                </div>`;
            }).join('')}</div>`;
        }
        foot.style.display = 'flex';
        foot.innerHTML = `
            <div class="w-full">
                <textarea id="drawer-draft" rows="2" class="input w-full" placeholder="写回复或点AI生成..."></textarea>
                <div class="flex justify-end gap-2 mt-2">
                    <button onclick="drawerAIReply()" class="btn-secondary btn-sm">🤖 AI生成</button>
                    <button onclick="drawerSend()" class="btn-primary btn-sm">✓ 一键发送</button>
                </div>
            </div>`;
    } catch (e) {
        head.innerHTML = `<div class="text-red-400">${escapeHtml(e.message)}</div><button onclick="closeMsgDrawer()" class="btn-secondary btn-sm">关闭</button>`;
    }
}

function closeMsgDrawer() { document.getElementById('msg-drawer').style.display = 'none'; }

async function drawerAIReply() {
    const ta = document.getElementById('drawer-draft');
    if (!ta || !_drawerConvId) return;
    ta.value = 'AI生成中...';
    try {
        const res = await API.post(`/messages/${_drawerConvId}/ai-reply`, {});
        ta.value = res.reply;
    } catch (e) { ta.value = '生成失败：' + e.message; }
}

async function drawerSend() {
    const ta = document.getElementById('drawer-draft');
    if (!ta || !_drawerConvId) return;
    const text = ta.value.trim();
    if (!text) { toast('内容为空', 'error'); return; }
    try {
        await API.post(`/messages/${_drawerConvId}/send`, { text });
        toast('已排队发送 → 扩展将自动发出');
        ta.value = '';
        await loadConversations(true);
    } catch (e) { toast(e.message, 'error'); }
}

/* ---- 快捷话术 ---- */
async function openQuickRepliesModal() {
    document.getElementById('qr-modal').style.display = 'flex';
    await loadQuickReplies();
}
function closeQrModal() { document.getElementById('qr-modal').style.display = 'none'; }

async function loadQuickReplies() {
    const el = document.getElementById('qr-list');
    if (!el) return;
    try {
        const rows = await API.get('/messages/quick-replies');
        if (rows.length === 0) { el.innerHTML = '<div class="text-sm text-gray-500">还没有快捷话术，先新增一条吧</div>'; return; }
        el.innerHTML = `<div class="space-y-2">${rows.map(r => `
            <div class="bg-gray-800 rounded-lg p-2 flex items-center gap-2">
                <span class="tag-${({price_compare:'yellow',order:'green'})[r.intent] || 'blue'} shrink-0">${MSG_INTENT_LABEL[r.intent] || r.intent}</span>
                <span class="text-xs text-gray-300 flex-1 truncate">${escapeHtml(r.title || '')} — ${escapeHtml(r.content)}</span>
                <button onclick="deleteQuickReply(${r.id})" class="btn-secondary btn-sm">删</button>
            </div>`).join('')}</div>`;
    } catch (e) { el.innerHTML = `<div class="text-red-400">${escapeHtml(e.message)}</div>`; }
}

async function addQuickReply() {
    const intent = document.getElementById('qr-intent').value;
    const title = document.getElementById('qr-title').value.trim();
    const content = document.getElementById('qr-content').value.trim();
    if (!content) { toast('话术内容不能为空', 'error'); return; }
    try {
        await API.post('/messages/quick-replies', { intent, title, content });
        document.getElementById('qr-title').value = '';
        document.getElementById('qr-content').value = '';
        toast('已新增');
        await loadQuickReplies();
    } catch (e) { toast(e.message, 'error'); }
}

async function deleteQuickReply(id) {
    try { await API.del(`/messages/quick-replies/${id}`); toast('已删除'); await loadQuickReplies(); }
    catch (e) { toast(e.message, 'error'); }
}