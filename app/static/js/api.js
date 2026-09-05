/* API 请求封装 */
const API = {
    base: '/api',

    async get(path) {
        const res = await fetch(this.base + path);
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: res.statusText }));
            throw new Error(err.detail || '请求失败');
        }
        return res.json();
    },

    async post(path, data) {
        const res = await fetch(this.base + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: res.statusText }));
            throw new Error(err.detail || '请求失败');
        }
        return res.json();
    },

    async put(path, data) {
        const res = await fetch(this.base + path, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: res.statusText }));
            throw new Error(err.detail || '请求失败');
        }
        return res.json();
    },

    async del(path) {
        const res = await fetch(this.base + path, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: res.statusText }));
            throw new Error(err.detail || '请求失败');
        }
        return res.json();
    },

    async upload(path, formData) {
        const res = await fetch(this.base + path, {
            method: 'POST',
            body: formData,
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: res.statusText }));
            throw new Error(err.detail || '上传失败');
        }
        return res.json();
    }
};

/* 工具函数 */
function $(id) { return document.getElementById(id); }

function html(strings, ...values) {
    return strings.reduce((result, str, i) => result + str + (values[i] || ''), '');
}

function showLoading(container) {
    container.innerHTML = '<div class="loading">加载中</div>';
}

function showError(container, msg) {
    container.innerHTML = `<div class="text-center py-16 text-red-400"><div class="text-4xl mb-3">⚠</div><div class="text-sm">${msg}</div></div>`;
}

function showEmpty(container, msg = '暂无数据') {
    container.innerHTML = `<div class="empty-state"><div class="icon">📭</div><div class="text">${msg}</div></div>`;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
/* 短名别名 */
function escHtml(str) { return escapeHtml(str); }

function statusTag(status) {
    const map = {
        running: '<span class="tag-green">运行中</span>',
        paused: '<span class="tag-yellow">已暂停</span>',
        stopped: '<span class="tag-gray">已停止</span>',
        published: '<span class="tag-green">已发布</span>',
        draft: '<span class="tag-yellow">草稿</span>',
    };
    return map[status] || `<span class="tag-gray">${status}</span>`;
}

function taskTypeLabel(t) {
    const map = { self_reply: '自营回复', keyword: '关键词截流', account: '账号追踪' };
    return map[t] || t;
}

function toast(msg, type = 'success') {
    const bgColors = { success: '#059669', error: '#dc2626', info: '#2563eb' };
    const el = document.createElement('div');
    el.textContent = msg;
    Object.assign(el.style, {
        position: 'fixed',
        top: '16px',
        right: '16px',
        backgroundColor: bgColors[type] || '#374151',
        color: '#ffffff',
        padding: '10px 16px',
        borderRadius: '8px',
        fontSize: '14px',
        zIndex: 9999,
        transition: 'opacity 0.3s',
        boxShadow: '0 10px 15px -3px rgba(0,0,0,0.3)',
    });
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2500);
}
