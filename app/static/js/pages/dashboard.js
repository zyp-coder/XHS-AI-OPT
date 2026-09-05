/* 数据看板 */
async function renderDashboard(container) {
    container.innerHTML = `
        <div class="space-y-6">
            <!-- 统计卡片 -->
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4" id="stat-cards">
                <div class="stat-card"><div class="text-gray-500 text-xs mb-1">总笔记</div><div class="text-2xl font-bold" id="stat-notes">-</div></div>
                <div class="stat-card"><div class="text-gray-500 text-xs mb-1">获赞</div><div class="text-2xl font-bold" id="stat-likes">-</div></div>
                <div class="stat-card"><div class="text-gray-500 text-xs mb-1">总引流</div><div class="text-2xl font-bold" id="stat-drains">-</div></div>
                <div class="stat-card"><div class="text-gray-500 text-xs mb-1">AI调用</div><div class="text-2xl font-bold" id="stat-ai">-</div></div>
            </div>

            <!-- 图表 -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="card">
                    <div class="text-sm text-gray-400 mb-4">📈 笔记互动趋势（近7天）</div>
                    <canvas id="chart-notes" height="200"></canvas>
                </div>
                <div class="card">
                    <div class="text-sm text-gray-400 mb-4">🚀 引流趋势（近7天）</div>
                    <canvas id="chart-drain" height="200"></canvas>
                </div>
            </div>

            <!-- 最新记录 -->
            <div class="card">
                <div class="flex items-center justify-between mb-4">
                    <div class="text-sm text-gray-400">📋 最近引流记录</div>
                </div>
                <div class="table-wrap" id="recent-records">
                    <div class="loading">加载中</div>
                </div>
            </div>
        </div>
    `;

    try {
        const [dash, notesTrend, drainTrend, records] = await Promise.all([
            API.get('/analytics/dashboard'),
            API.get('/analytics/notes-trend?days=7'),
            API.get('/analytics/drain-trend?days=7'),
            API.get('/drain/records?limit=10'),
        ]);

        // 填充统计
        document.getElementById('stat-notes').textContent = dash.total_notes;
        document.getElementById('stat-likes').textContent = dash.total_likes;
        document.getElementById('stat-drains').textContent = dash.total_drains;
        document.getElementById('stat-ai').textContent = dash.api_calls_today;

        // 笔记趋势图
        const ctx1 = document.getElementById('chart-notes').getContext('2d');
        new Chart(ctx1, {
            type: 'line',
            data: {
                labels: notesTrend.days,
                datasets: [
                    { label: '笔记数', data: notesTrend.counts, borderColor: '#ef4444', tension: 0.3, fill: false },
                    { label: '点赞', data: notesTrend.likes, borderColor: '#3b82f6', tension: 0.3, fill: false },
                ]
            },
            options: {
                responsive: true,
                plugins: { legend: { labels: { color: '#9ca3af' } } },
                scales: {
                    x: { ticks: { color: '#6b7280' }, grid: { color: '#1f2937' } },
                    y: { ticks: { color: '#6b7280' }, grid: { color: '#1f2937' } },
                }
            }
        });

        // 引流趋势图
        const ctx2 = document.getElementById('chart-drain').getContext('2d');
        new Chart(ctx2, {
            type: 'bar',
            data: {
                labels: drainTrend.days,
                datasets: [{
                    label: '引流次数',
                    data: drainTrend.counts,
                    backgroundColor: '#ef444480',
                    borderColor: '#ef4444',
                    borderWidth: 1,
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { labels: { color: '#9ca3af' } } },
                scales: {
                    x: { ticks: { color: '#6b7280' }, grid: { color: '#1f2937' } },
                    y: { ticks: { color: '#6b7280' }, grid: { color: '#1f2937' } },
                }
            }
        });

        // 最近记录
        const recordsEl = document.getElementById('recent-records');
        if (records.length === 0) {
            showEmpty(recordsEl, '暂无引流记录，启动任务后这里会显示');
        } else {
            recordsEl.innerHTML = `
                <table>
                    <thead><tr><th>时间</th><th>目标笔记</th><th>AI评论</th><th>状态</th></tr></thead>
                    <tbody>
                        ${records.map(r => `
                            <tr>
                                <td class="text-gray-400 text-xs">${new Date(r.created_at).toLocaleString()}</td>
                                <td class="max-w-[200px] truncate">${escapeHtml(r.target_note_title || '未知')}</td>
                                <td class="max-w-[200px] truncate text-gray-400">${escapeHtml((r.comment_text || '').slice(0, 40))}</td>
                                <td>${r.success ? '<span class="tag-green">成功</span>' : '<span class="tag-red">失败</span>'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }
    } catch (e) {
        showError(container, '加载数据失败: ' + e.message);
    }
}
