/* 账号管理 */
let accountsState = { list: [], showLogin: null, loading: false };

async function renderAccounts(container) {
    container.innerHTML = `
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <div class="text-sm text-gray-400">管理你的小红书账号</div>
                <button onclick="showAddAccountModal()" class="btn-primary btn-sm">+ 添加账号</button>
            </div>
            <div id="accounts-list" class="space-y-3"></div>
        </div>

        <!-- 添加账号模态框 -->
        <div id="add-account-modal" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeAddAccountModal()">
            <div class="modal">
                <h3 class="text-lg font-medium mb-4">添加小红书账号</h3>
                <div class="space-y-3">
                    <div><label class="text-xs text-gray-400">昵称</label><input id="new-nickname" class="input mt-1" placeholder="小红书昵称"></div>
                    <div><label class="text-xs text-gray-400">手机号（选填）</label><input id="new-phone" class="input mt-1" placeholder="登录手机号"></div>
                </div>
                <div class="flex justify-end gap-2 mt-6">
                    <button onclick="closeAddAccountModal()" class="btn-secondary btn-sm">取消</button>
                    <button onclick="addAccount()" class="btn-primary btn-sm">添加</button>
                </div>
            </div>
        </div>
    `;
    await loadAccounts();
}

async function loadAccounts() {
    const el = document.getElementById('accounts-list');
    if (!el) return;
    showLoading(el);

    try {
        accountsState.list = await API.get('/accounts');
        if (accountsState.list.length === 0) {
            showEmpty(el, '还没有账号，点击右上角添加');
            return;
        }

        el.innerHTML = accountsState.list.map(a => `
            <div class="card flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-lg">👤</div>
                    <div>
                        <div class="font-medium">${escapeHtml(a.nickname || '未命名')}</div>
                        <div class="text-xs text-gray-500">${a.phone || '未绑定手机'}</div>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <span class="text-xs ${a.cookies_exists ? 'tag-green' : 'tag-gray'}">${a.cookies_exists ? '已登录' : '未登录'}</span>
                    <button onclick="loginAccount(${a.id})" class="btn-secondary btn-sm">登录</button>
                    <button onclick="deleteAccount(${a.id})" class="btn-danger btn-sm">删除</button>
                </div>
            </div>
        `).join('');
    } catch (e) {
        showError(el, e.message);
    }
}

function showAddAccountModal() {
    const m = document.getElementById('add-account-modal');
    if (m) m.style.display = 'flex';
}

function closeAddAccountModal() {
    const m = document.getElementById('add-account-modal');
    if (m) m.style.display = 'none';
}

async function addAccount() {
    const nickname = document.getElementById('new-nickname')?.value || '未命名';
    const phone = document.getElementById('new-phone')?.value || '';
    try {
        await API.post('/accounts', { nickname, phone });
        toast('账号添加成功');
        closeAddAccountModal();
        await loadAccounts();
    } catch (e) {
        toast(e.message, 'error');
    }
}

async function loginAccount(id) {
    try {
        const result = await API.post(`/accounts/${id}/login`, {});
        toast(result.message, 'info');

        // 等待扫码登录（后端轮询）
        try {
            const waitResult = await API.post(`/accounts/${id}/wait-login`, {});
            toast(waitResult.message);
            await loadAccounts();
        } catch (e) {
            toast('登录等待超时', 'error');
        }
    } catch (e) {
        toast(e.message, 'error');
    }
}

async function deleteAccount(id) {
    if (!confirm('确定删除该账号？')) return;
    try {
        await API.del(`/accounts/${id}`);
        toast('已删除');
        await loadAccounts();
    } catch (e) {
        toast(e.message, 'error');
    }
}
