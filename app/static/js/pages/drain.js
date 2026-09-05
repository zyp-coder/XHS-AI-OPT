/* 引流任务 */
let drainState = { tasks: [], records: [] };

async function renderDrain(container) {
    container.innerHTML = `
        <div class="space-y-6">
            <!-- 任务列表 -->
            <div class="card">
                <div class="flex items-center justify-between mb-4">
                    <div class="text-sm text-gray-400">🚀 引流任务</div>
                    <button onclick="showCreateTaskModal()" class="btn-primary btn-sm">+ 新建任务</button>
                </div>
                <div id="tasks-list"></div>
            </div>

            <!-- 目标账号 -->
            <div class="card">
                <div class="flex items-center justify-between mb-4">
                    <div class="text-sm text-gray-400">🎯 目标账号管理（中介/竞品）</div>
                    <button onclick="showAddTargetModal()" class="btn-secondary btn-sm">+ 添加</button>
                </div>
                <div id="target-accounts-list"><div class="loading">加载中</div></div>
            </div>

            <!-- 关键词 -->
            <div class="card">
                <div class="flex items-center justify-between mb-4">
                    <div class="text-sm text-gray-400">🔑 目标关键词</div>
                    <button onclick="showAddKeywordModal()" class="btn-secondary btn-sm">+ 添加</button>
                </div>
                <div id="keywords-list"><div class="loading">加载中</div></div>
            </div>
        </div>

        <!-- 新建任务模态框 -->
        <div id="create-task-modal" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeTaskModal()">
            <div class="modal max-w-xl">
                <h3 class="text-lg font-medium mb-4">新建引流任务</h3>
                <div class="space-y-3">
                    <div>
                        <label class="text-xs text-gray-400">任务名称</label>
                        <input id="task-name" class="input mt-1" placeholder="如：关键词截流-房贷利率">
                    </div>
                    <div>
                        <label class="text-xs text-gray-400">小红书账号</label>
                        <select id="task-account" class="input mt-1"></select>
                    </div>
                    <div>
                        <label class="text-xs text-gray-400">任务类型</label>
                        <select id="task-type" class="input mt-1" onchange="onTaskTypeChange()">
                            <option value="keyword">关键词截流</option>
                            <option value="account">账号追踪</option>
                            <option value="self_reply">自营笔记回复</option>
                        </select>
                    </div>
                    <div id="task-keywords-config">
                        <label class="text-xs text-gray-400">关键词（逗号分隔）</label>
                        <input id="task-keywords" class="input mt-1" placeholder="房贷利率,提前还款,买房攻略">
                    </div>
                    <div id="task-accounts-config" style="display:none">
                        <label class="text-xs text-gray-400">目标账号（选择已有目标账号）</label>
                        <select id="task-target-accounts" class="input mt-1" multiple></select>
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="text-xs text-gray-400">每日上限</label>
                            <input id="task-limit" type="number" class="input mt-1" value="50">
                        </div>
                        <div>
                            <label class="text-xs text-gray-400">评论风格</label>
                            <input id="task-style" class="input mt-1" value="自然" placeholder="自然/专业/亲切">
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="text-xs text-gray-400">开始时段</label>
                            <input id="task-time-start" type="time" class="input mt-1" value="09:00">
                        </div>
                        <div>
                            <label class="text-xs text-gray-400">结束时段</label>
                            <input id="task-time-end" type="time" class="input mt-1" value="22:00">
                        </div>
                    </div>
                </div>
                <div class="flex justify-end gap-2 mt-6">
                    <button onclick="closeTaskModal()" class="btn-secondary btn-sm">取消</button>
                    <button onclick="createDrainTask()" class="btn-primary btn-sm">创建</button>
                </div>
            </div>
        </div>

        <!-- 添加目标账号模态框 -->
        <div id="add-target-modal" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeTargetModal()">
            <div class="modal">
                <h3 class="text-lg font-medium mb-4">添加目标账号</h3>
                <div class="space-y-3">
                    <div><label class="text-xs text-gray-400">小红书用户ID</label><input id="target-user-id" class="input mt-1"></div>
                    <div><label class="text-xs text-gray-400">昵称</label><input id="target-nickname" class="input mt-1"></div>
                    <div><label class="text-xs text-gray-400">主页链接</label><input id="target-url" class="input mt-1"></div>
                    <div>
                        <label class="text-xs text-gray-400">分类</label>
                        <select id="target-category" class="input mt-1">
                            <option value="agent">房产中介</option>
                            <option value="compete">竞品账号</option>
                        </select>
                    </div>
                </div>
                <div class="flex justify-end gap-2 mt-6">
                    <button onclick="closeTargetModal()" class="btn-secondary btn-sm">取消</button>
                    <button onclick="createTargetAccount()" class="btn-primary btn-sm">添加</button>
                </div>
            </div>
        </div>

        <!-- 添加关键词模态框 -->
        <div id="add-keyword-modal" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeKeywordModal()">
            <div class="modal">
                <h3 class="text-lg font-medium mb-4">添加关键词</h3>
                <input id="new-keyword" class="input" placeholder="输入关键词">
                <div class="flex justify-end gap-2 mt-6">
                    <button onclick="closeKeywordModal()" class="btn-secondary btn-sm">取消</button>
                    <button onclick="createKeyword()" class="btn-primary btn-sm">添加</button>
                </div>
            </div>
        </div>

        <!-- 记录模态框 -->
        <div id="records-modal" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeRecordsModal()">
            <div class="modal max-w-3xl max-h-[80vh]">
                <h3 class="text-lg font-medium mb-4">📋 执行记录</h3>
                <div id="records-content"><div class="loading">加载中</div></div>
            </div>
        </div>
    `;

    // 加载账号列表到选择框
    try {
        const accounts = await API.get('/accounts');
        const sel = document.getElementById('task-account');
        if (sel) {
            sel.innerHTML = accounts.map(a =>
                `<option value="${a.id}">${escapeHtml(a.nickname || '未命名')}</option>`
            ).join('');
        }
    } catch (e) {}

    // 加载目标账号
    try {
        const targets = await API.get('/drain/target-accounts');
        const sel2 = document.getElementById('task-target-accounts');
        if (sel2) {
            sel2.innerHTML = targets.map(t =>
                `<option value="${t.id}">${escapeHtml(t.nickname)}</option>`
            ).join('');
        }
    } catch (e) {}

    await Promise.all([loadTasks(), loadTargetAccounts(), loadKeywords()]);
}

async function loadTasks() {
    const el = document.getElementById('tasks-list');
    if (!el) return;
    showLoading(el);

    try {
        drainState.tasks = await API.get('/drain/tasks');
        if (drainState.tasks.length === 0) {
            showEmpty(el, '还没有引流任务，点击右上角新建');
            return;
        }
        el.innerHTML = drainState.tasks.map(t => `
            <div class="bg-gray-800/50 rounded-lg p-4 mb-3">
                <div class="flex items-center justify-between mb-2">
                    <div class="flex items-center gap-2">
                        <span class="status-${t.status}"></span>
                        <span class="font-medium">${escapeHtml(t.name)}</span>
                        <span class="tag-blue">${taskTypeLabel(t.task_type)}</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="text-xs text-gray-500">今日 ${t.today_count}/${t.daily_limit}</span>
                        <span class="text-xs text-gray-500">总计 ${t.total_count}</span>
                    </div>
                </div>
                <div class="flex items-center justify-between">
                    <div class="text-xs text-gray-500">
                        时段 ${t.time_start}-${t.time_end} | 间隔 ${t.interval_min}-${t.interval_max}s
                    </div>
                    <div class="flex gap-1">
                        ${t.status === 'stopped' || t.status === 'paused'
                            ? `<button data-start="${t.id}" onclick="startTask(${t.id})" class="btn-success btn-sm">▶ 启动</button>`
                            : `<button data-stop="${t.id}" onclick="stopTask(${t.id})" class="btn-danger btn-sm">⏹ 停止</button>`
                        }
                        <button onclick="showTaskRecords(${t.id})" class="btn-secondary btn-sm">记录</button>
                        ${t.status === 'stopped' ? `<button onclick="deleteTask(${t.id})" class="btn-danger btn-sm">删除</button>` : ''}
                    </div>
                </div>
            </div>
        `).join('');
    } catch (e) {
        showError(el, e.message);
    }
}

async function loadTargetAccounts() {
    const el = document.getElementById('target-accounts-list');
    if (!el) return;
    try {
        const list = await API.get('/drain/target-accounts');
        if (list.length === 0) {
            el.innerHTML = '<div class="text-center py-6 text-gray-600 text-sm">暂无目标账号</div>';
            return;
        }
        el.innerHTML = `
            <div class="flex flex-wrap gap-2">
                ${list.map(a => `
                    <span class="bg-gray-800 px-3 py-1.5 rounded-lg text-sm flex items-center gap-2">
                        ${escapeHtml(a.nickname)}
                        <span class="tag-${a.category === 'agent' ? 'yellow' : 'blue'} text-xs">${a.category === 'agent' ? '中介' : '竞品'}</span>
                        <button onclick="deleteTargetAccount(${a.id})" class="text-red-400 hover:text-red-300 text-xs">✕</button>
                    </span>
                `).join('')}
            </div>
        `;
    } catch (e) {
        el.innerHTML = `<div class="text-red-400 text-sm">加载失败</div>`;
    }
}

async function loadKeywords() {
    const el = document.getElementById('keywords-list');
    if (!el) return;
    try {
        const list = await API.get('/drain/keywords');
        if (list.length === 0) {
            el.innerHTML = '<div class="text-center py-6 text-gray-600 text-sm">暂无关键词</div>';
            return;
        }
        el.innerHTML = `
            <div class="flex flex-wrap gap-2">
                ${list.map(k => `
                    <span class="bg-gray-800 px-3 py-1.5 rounded-lg text-sm flex items-center gap-2">
                        🔑 ${escapeHtml(k.keyword)}
                        <button onclick="deleteKeyword(${k.id})" class="text-red-400 hover:text-red-300 text-xs">✕</button>
                    </span>
                `).join('')}
            </div>
        `;
    } catch (e) {
        el.innerHTML = `<div class="text-red-400 text-sm">加载失败</div>`;
    }
}

// 任务 CRUD
function showCreateTaskModal() {
    document.getElementById('create-task-modal').style.display = 'flex';
}

function closeTaskModal() {
    document.getElementById('create-task-modal').style.display = 'none';
}

function onTaskTypeChange() {
    const type = document.getElementById('task-type')?.value;
    const kw = document.getElementById('task-keywords-config');
    const ac = document.getElementById('task-accounts-config');
    kw.style.display = type === 'keyword' ? 'block' : 'none';
    ac.style.display = type === 'account' ? 'block' : 'none';
}

async function createDrainTask() {
    const accountId = document.getElementById('task-account')?.value;
    const name = document.getElementById('task-name')?.value;
    const taskType = document.getElementById('task-type')?.value;
    const keywords = (document.getElementById('task-keywords')?.value || '').split(',').map(t => t.trim()).filter(Boolean);
    const dailyLimit = parseInt(document.getElementById('task-limit')?.value || 50);
    const timeStart = document.getElementById('task-time-start')?.value || '09:00';
    const timeEnd = document.getElementById('task-time-end')?.value || '22:00';
    const commentStyle = document.getElementById('task-style')?.value || '自然';
    const targetSelect = document.getElementById('task-target-accounts');
    const targetAccountIds = targetSelect ? Array.from(targetSelect.selectedOptions).map(o => parseInt(o.value)) : [];

    if (!accountId || !name) { toast('请填写必要信息', 'error'); return; }

    try {
        await API.post('/drain/tasks', {
            account_id: parseInt(accountId), name, task_type: taskType,
            keywords, target_account_ids: targetAccountIds,
            daily_limit: dailyLimit, time_start: timeStart, time_end: timeEnd,
            comment_style: commentStyle, note_ids: [],
        });
        toast('任务创建成功');
        closeTaskModal();
        await loadTasks();
    } catch (e) {
        toast(e.message, 'error');
    }
}

async function startTask(id) {
    const btn = document.querySelector(`[data-start="${id}"]`);
    if (btn) { btn.disabled = true; btn.textContent = '启动中...'; }
    try {
        await API.post(`/drain/tasks/${id}/start`, {});
        toast('任务已启动');
        await loadTasks();
    } catch (e) {
        toast(e.message, 'error');
        await loadTasks();
    }
}

async function stopTask(id) {
    const btn = document.querySelector(`[data-stop="${id}"]`);
    if (btn) { btn.disabled = true; btn.textContent = '停止中...'; }
    try {
        await API.post(`/drain/tasks/${id}/stop`, {});
        toast('任务已停止');
        await loadTasks();
    } catch (e) {
        toast(e.message, 'error');
        await loadTasks();
    }
}

async function deleteTask(id) {
    if (!confirm('确定删除该任务？')) return;
    try {
        await API.del(`/drain/tasks/${id}`);
        toast('已删除');
        await loadTasks();
    } catch (e) {
        toast(e.message, 'error');
    }
}

// 记录
let _currentRecordTaskId = null;

async function showTaskRecords(taskId) {
    _currentRecordTaskId = taskId;
    document.getElementById('records-modal').style.display = 'flex';

    const el = document.getElementById('records-content');
    showLoading(el);

    try {
        const records = await API.get(`/drain/records?task_id=${taskId}&limit=50`);
        if (records.length === 0) {
            showEmpty(el, '暂无执行记录');
            return;
        }
        el.innerHTML = `
            <div class="table-wrap">
                <table>
                    <thead><tr><th>时间</th><th>目标</th><th>AI评论</th><th>结果</th></tr></thead>
                    <tbody>
                        ${records.map(r => `
                            <tr>
                                <td class="text-xs text-gray-500 whitespace-nowrap">${new Date(r.created_at).toLocaleString()}</td>
                                <td class="max-w-[150px] truncate">${escapeHtml(r.target_note_title || '未知')}</td>
                                <td class="max-w-[200px] truncate text-gray-400">${escapeHtml((r.comment_text || '').slice(0, 50))}</td>
                                <td>${r.success ? '<span class="tag-green">成功</span>' : `<span class="tag-red" title="${escapeHtml(r.error_msg || '')}">失败</span>`}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    } catch (e) {
        showError(el, e.message);
    }
}

function closeRecordsModal() {
    document.getElementById('records-modal').style.display = 'none';
}

// 目标账号
function showAddTargetModal() {
    document.getElementById('add-target-modal').style.display = 'flex';
}

function closeTargetModal() {
    document.getElementById('add-target-modal').style.display = 'none';
}

async function createTargetAccount() {
    const xhsUserId = document.getElementById('target-user-id')?.value;
    const nickname = document.getElementById('target-nickname')?.value;
    const noteUrl = document.getElementById('target-url')?.value;
    const category = document.getElementById('target-category')?.value;

    if (!nickname) { toast('请输入昵称', 'error'); return; }

    try {
        await API.post('/drain/target-accounts', { xhs_user_id: xhsUserId, nickname, note_url: noteUrl, category });
        toast('添加成功');
        closeTargetModal();
        await loadTargetAccounts();
    } catch (e) {
        toast(e.message, 'error');
    }
}

async function deleteTargetAccount(id) {
    if (!confirm('确定删除？')) return;
    try {
        await API.del(`/drain/target-accounts/${id}`);
        toast('已删除');
        await loadTargetAccounts();
    } catch (e) {
        toast(e.message, 'error');
    }
}

// 关键词
function showAddKeywordModal() {
    document.getElementById('add-keyword-modal').style.display = 'flex';
}

function closeKeywordModal() {
    document.getElementById('add-keyword-modal').style.display = 'none';
}

async function createKeyword() {
    const keyword = document.getElementById('new-keyword')?.value;
    if (!keyword) { toast('请输入关键词', 'error'); return; }

    try {
        await API.post('/drain/keywords', { keyword });
        toast('添加成功');
        closeKeywordModal();
        await loadKeywords();
    } catch (e) {
        toast(e.message, 'error');
    }
}

async function deleteKeyword(id) {
    if (!confirm('确定删除？')) return;
    try {
        await API.del(`/drain/keywords/${id}`);
        toast('已删除');
        await loadKeywords();
    } catch (e) {
        toast(e.message, 'error');
    }
}
