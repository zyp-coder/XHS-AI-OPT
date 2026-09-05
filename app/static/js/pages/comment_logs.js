/* 评论回复日志页面 */
function renderCommentLogs(container) {
    let state = {
        logs: [],
        page: 1,
        pageSize: 20,
        total: 0,
        filterSource: '',
        filterStatus: '',
    };

    async function load() {
        try {
            let url = `/comment-logs/?page=${state.page}&page_size=${state.pageSize}`;
            if (state.filterSource) url += `&source=${encodeURIComponent(state.filterSource)}`;
            if (state.filterStatus) url += `&status=${encodeURIComponent(state.filterStatus)}`;
            state.logs = await API.get(url);
            state.total = state.logs.length < state.pageSize
                ? (state.page - 1) * state.pageSize + state.logs.length
                : state.page * state.pageSize + 1; // approximate
        } catch (e) {
            state.logs = [];
        }
        render();
    }

    async function remove(id) {
        if (!confirm('确定删除此日志？')) return;
        try {
            await API.del(`/comment-logs/${id}`);
            load();
        } catch (e) {
            alert('删除失败');
        }
    }

    async function clearAll() {
        if (!confirm('确定清空所有日志？此操作不可恢复。')) return;
        try {
            await API.del('/comment-logs/');
            load();
        } catch (e) {
            alert('清空失败');
        }
    }

    function render() {
        container.innerHTML = `
            <div style="max-width:1200px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
                    <h3 style="font-size:1.25rem;font-weight:600;color:#e5e7eb;">评论回复日志</h3>
                    <button class="btn btn-sm" style="background:#7f1d1d;color:#fca5a5;"
                            onclick="window._logsClear()">
                        🗑 清空日志
                    </button>
                </div>

                <!-- 筛选 -->
                <div style="display:flex;gap:0.75rem;margin-bottom:1.5rem;flex-wrap:wrap;">
                    <select id="logs-source-filter" style="padding:0.5rem 0.75rem;border-radius:6px;background:#1f2937;color:#e5e7eb;border:1px solid #374151;"
                            onchange="window._logsFilterSource(this.value)">
                        <option value="">全部来源</option>
                        <option value="extension" ${state.filterSource === 'extension' ? 'selected' : ''}>扩展插件</option>
                        <option value="manual" ${state.filterSource === 'manual' ? 'selected' : ''}>手动录入</option>
                    </select>
                    <select id="logs-status-filter" style="padding:0.5rem 0.75rem;border-radius:6px;background:#1f2937;color:#e5e7eb;border:1px solid #374151;"
                            onchange="window._logsFilterStatus(this.value)">
                        <option value="">全部状态</option>
                        <option value="sent" ${state.filterStatus === 'sent' ? 'selected' : ''}>已发送</option>
                        <option value="failed" ${state.filterStatus === 'failed' ? 'selected' : ''}>失败</option>
                    </select>
                    <span style="color:#6b7280;font-size:0.875rem;line-height:2.25rem;">共 ${state.logs.length} 条</span>
                </div>

                <!-- 日志列表 -->
                ${state.logs.length === 0 ? `
                    <div style="text-align:center;padding:3rem;color:#6b7280;">
                        <p style="font-size:1rem;">暂无回复日志</p>
                        <p style="font-size:0.875rem;margin-top:0.5rem;">通过扩展插件发送回复后，日志会自动记录在此</p>
                    </div>
                ` : `
                    <div style="display:flex;flex-direction:column;gap:0.5rem;">
                        ${state.logs.map(log => `
                            <div style="background:#1f2937;border:1px solid #374151;border-radius:8px;padding:0.875rem;">
                                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.75rem;">
                                    <div style="flex:1;min-width:0;">
                                        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.375rem;flex-wrap:wrap;">
                                            <span style="font-weight:600;color:#e5e7eb;font-size:0.9375rem;">${escHtml(log.target_author)}</span>
                                            <span style="font-size:0.75rem;padding:0.125rem 0.5rem;border-radius:999px;
                                                ${log.status === 'sent' ? 'background:#064e3b;color:#6ee7b7;' : 'background:#7f1d1d;color:#fca5a5;'}">
                                                ${log.status === 'sent' ? '✅ 已发送' : '❌ 失败'}
                                            </span>
                                            <span style="font-size:0.75rem;padding:0.125rem 0.5rem;border-radius:999px;background:#374151;color:#9ca3af;">
                                                ${log.source === 'extension' ? '扩展' : '手动'}
                                            </span>
                                        </div>
                                        <div style="font-size:0.8125rem;color:#6b7280;margin-bottom:0.25rem;">
                                            笔记: <a href="${escHtml(log.note_url)}" target="_blank" style="color:#60a5fa;text-decoration:none;">${escHtml(log.note_title || log.note_url)}</a>
                                        </div>
                                        <div style="font-size:0.8125rem;color:#9ca3af;margin-bottom:0.25rem;">
                                            <span style="color:#6b7280;">用户评论:</span> ${escHtml(log.target_comment)}
                                        </div>
                                        <div style="font-size:0.8125rem;color:#d1d5db;">
                                            <span style="color:#6b7280;">回复内容:</span> ${escHtml(log.reply_text)}
                                        </div>
                                        ${log.screenshot_url ? `
                                        <div style="margin-top:0.5rem;">
                                            <img src="${escHtml(log.screenshot_url)}" style="max-width:240px;max-height:180px;border-radius:6px;border:1px solid #374151;cursor:pointer;"
                                                 onclick="window.open('${escHtml(log.screenshot_url)}','_blank')" />
                                        </div>
                                        ` : ''}
                                        <div style="font-size:0.75rem;color:#4b5563;margin-top:0.375rem;">
                                            ${new Date(log.created_at).toLocaleString('zh-CN')}
                                        </div>
                                    </div>
                                    <button class="btn btn-sm" style="background:#7f1d1d;color:#fca5a5;flex-shrink:0;"
                                            onclick="window._logsDel(${log.id})">删除</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `}

                <!-- 分页 -->
                ${state.logs.length >= state.pageSize ? `
                    <div style="display:flex;justify-content:center;gap:0.75rem;margin-top:1.5rem;">
                        <button class="btn btn-sm" style="background:#374151;color:#e5e7eb;"
                                onclick="window._logsPage(${state.page - 1})" ${state.page <= 1 ? 'disabled' : ''}>上一页</button>
                        <span style="color:#9ca3af;line-height:2rem;">第 ${state.page} 页</span>
                        <button class="btn btn-sm" style="background:#374151;color:#e5e7eb;"
                                onclick="window._logsPage(${state.page + 1})">下一页</button>
                    </div>
                ` : ''}
            </div>
        `;
    }

    window._logsDel = remove;
    window._logsClear = clearAll;
    window._logsFilterSource = (v) => { state.filterSource = v; state.page = 1; load(); };
    window._logsFilterStatus = (v) => { state.filterStatus = v; state.page = 1; load(); };
    window._logsPage = (p) => { state.page = Math.max(1, p); load(); };

    load();
}
