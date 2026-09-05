/* 前端路由 */
function app() {
    return {
        currentPage: 'dashboard',
        navItems: [
            { id: 'dashboard', label: '数据看板', icon: '📊' },
            { id: 'diagnosis', label: '账号诊断', icon: '🔍' },
            { id: 'accounts', label: '账号管理', icon: '👤' },
            { id: 'notes', label: '笔记管理', icon: '📝' },
            { id: 'comments', label: '评论互动', icon: '💬' },
            { id: 'drain', label: '引流任务', icon: '🚀' },
            { id: 'knowledge', label: '知识库', icon: '📚' },
            { id: 'ai_config', label: 'AI 配置', icon: '🤖' },
            { id: 'comment_logs', label: '回复日志', icon: '📋' },
        ],
        dashStats: { today_drains: 0 },
        aiStats: { today_calls: 0 },
        aiReady: false,
        browserStatus: { status: 'stopped', login_status: 'unknown', page_alive: false },

        get currentPageTitle() {
            const item = this.navItems.find(n => n.id === this.currentPage);
            return item ? item.label : '';
        },

        get browserStatusText() {
            const s = this.browserStatus;
            if (s.status === 'running' && s.login_status === 'logged_in') return '浏览器在线 ✓';
            if (s.status === 'running' && s.login_status === 'expired') return '未登录';
            if (s.status === 'starting') return '启动中...';
            if (s.status === 'crashed') return '浏览器已关闭';
            return '未启动';
        },

        get browserStatusColor() {
            const s = this.browserStatus;
            if (s.status === 'running' && s.login_status === 'logged_in') return '#10b981';
            if (s.status === 'running' && s.login_status === 'expired') return '#f59e0b';
            if (s.status === 'starting') return '#3b82f6';
            if (s.status === 'crashed') return '#ef4444';
            return '#6b7280';
        },

        async init() {
            // 加载初始数据
            try {
                const [dash, ai, browserSt] = await Promise.all([
                    API.get('/analytics/dashboard'),
                    API.get('/analytics/ai-stats').catch(() => ({ today_calls: 0 })),
                    API.get('/analytics/browser-status').catch(() => ({})),
                ]);
                this.dashStats = dash;
                this.aiStats = ai;
                if (browserSt.status) this.browserStatus = browserSt;
            } catch (e) {}

            try {
                const cfg = await API.get('/ai/config');
                this.aiReady = cfg.has_key;
            } catch (e) {}

            // 渲染默认页面
            this.renderPage('dashboard');

            // 定时刷新顶部状态
            setInterval(async () => {
                try {
                    const [dash, browserSt] = await Promise.all([
                        API.get('/analytics/dashboard'),
                        API.get('/analytics/browser-status').catch(() => ({})),
                    ]);
                    this.dashStats = dash;
                    if (browserSt.status) this.browserStatus = browserSt;
                } catch (e) {}
            }, 30000);
        },

        navigate(page) {
            this.currentPage = page;
            this.renderPage(page);
        },

        renderPage(page) {
            const container = document.getElementById('page-content');
            if (!container) return;
            switch (page) {
                case 'dashboard': renderDashboard(container); break;
                case 'diagnosis': renderDiagnosis(container); break;
                case 'accounts': renderAccounts(container); break;
                case 'notes': renderNotes(container); break;
                case 'comments': renderComments(container); break;
                case 'drain': renderDrain(container); break;
                case 'knowledge': renderKnowledge(container); break;
                case 'ai_config': renderAIConfig(container); break;
                case 'comment_logs': renderCommentLogs(container); break;
                default: container.innerHTML = '<div class="text-center py-16 text-gray-500">页面不存在</div>';
            }
        }
    };
}
