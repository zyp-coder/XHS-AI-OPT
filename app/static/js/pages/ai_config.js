/* AI 配置 */
async function renderAIConfig(container) {
    container.innerHTML = `
        <div class="space-y-6">
            <!-- 主模型配置 -->
            <div class="card max-w-2xl">
                <h3 class="text-lg font-medium mb-4">🤖 主模型配置（优先使用）</h3>
                <p class="text-xs text-gray-500 mb-4">优先使用主模型，当主模型不可用时自动切换到备用模型</p>
                <div class="space-y-4">
                    <div>
                        <label class="text-xs text-gray-400">API Key</label>
                        <div class="flex gap-2 mt-1">
                            <input id="cfg-api-key" type="password" class="input flex-1" placeholder="sk-...">
                            <button onclick="toggleKeyVisible()" class="btn-secondary btn-sm">👁</button>
                        </div>
                    </div>
                    <div>
                        <label class="text-xs text-gray-400">API Base URL</label>
                        <input id="cfg-base-url" class="input mt-1" placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1">
                    </div>
                    <div class="grid grid-cols-3 gap-3">
                        <div>
                            <label class="text-xs text-gray-400">模型</label>
                            <input id="cfg-model" class="input mt-1" placeholder="qwen-plus">
                        </div>
                        <div>
                            <label class="text-xs text-gray-400">温度</label>
                            <input id="cfg-temp" type="number" step="0.1" class="input mt-1" placeholder="0.8">
                        </div>
                        <div>
                            <label class="text-xs text-gray-400">Max Tokens</label>
                            <input id="cfg-tokens" type="number" class="input mt-1" placeholder="500">
                        </div>
                    </div>
                </div>
            </div>

            <!-- 备用模型配置 -->
            <div class="card max-w-2xl">
                <h3 class="text-lg font-medium mb-4">🔄 备用模型（主模型失败时自动切换）</h3>
                <p class="text-xs text-gray-500 mb-4">当主模型连接失败、额度耗尽时，自动切换到备用模型</p>
                <div class="space-y-4">
                    <div>
                        <label class="text-xs text-gray-400">备用 API Key</label>
                        <div class="flex gap-2 mt-1">
                            <input id="cfg-fallback-api-key" type="password" class="input flex-1" placeholder="sk-...（可选）">
                            <button onclick="toggleFallbackKeyVisible()" class="btn-secondary btn-sm">👁</button>
                        </div>
                    </div>
                    <div>
                        <label class="text-xs text-gray-400">备用 API Base URL</label>
                        <input id="cfg-fallback-base-url" class="input mt-1" placeholder="https://api.deepseek.com">
                    </div>
                    <div>
                        <label class="text-xs text-gray-400">备用模型</label>
                        <input id="cfg-fallback-model" class="input mt-1" placeholder="deepseek-chat">
                    </div>
                </div>
            </div>

            <!-- 操作按钮 -->
            <div class="card max-w-2xl">
                <div class="flex justify-end gap-2">
                    <button onclick="testAIConnection()" class="btn-secondary btn-sm" id="test-ai-btn">🔌 测试连接</button>
                    <button onclick="saveAIConfig()" class="btn-primary btn-sm" id="save-ai-btn">保存配置</button>
                </div>
                <div id="ai-test-result" class="hidden"></div>
            </div>

            <!-- 使用统计 -->
            <div class="card max-w-2xl">
                <h3 class="text-lg font-medium mb-4">📊 AI 使用统计</h3>
                <div id="ai-stats-content"><div class="loading">加载中</div></div>
            </div>

            <!-- Prompt 管理 -->
            <div class="card max-w-2xl">
                <h3 class="text-lg font-medium mb-4">📝 Prompt 模板管理</h3>
                <div class="space-y-3" id="prompts-list"><div class="loading">加载中</div></div>
            </div>
        </div>
    `;

    // 加载当前配置
    try {
        const cfg = await API.get('/ai/config');
        document.getElementById('cfg-api-key').value = '';  // 不显示已有 Key
        document.getElementById('cfg-base-url').value = cfg.api_base_url || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
        document.getElementById('cfg-model').value = cfg.model || 'qwen-plus';
        document.getElementById('cfg-temp').value = cfg.temperature || 0.8;
        document.getElementById('cfg-tokens').value = cfg.max_tokens || 500;

        // 加载备用模型配置
        document.getElementById('cfg-fallback-api-key').value = '';  // 不显示已有 Key
        document.getElementById('cfg-fallback-base-url').value = cfg.fallback_api_base_url || '';
        document.getElementById('cfg-fallback-model').value = cfg.fallback_model || '';

        if (cfg.has_key) {
            document.querySelector('#save-ai-btn').textContent = '更新配置';
        }
    } catch (e) {}

    // 加载统计
    await loadAIStats();
    // 加载 Prompt
    await loadPrompts();
}

async function loadAIStats() {
    const el = document.getElementById('ai-stats-content');
    if (!el) return;
    try {
        const stats = await API.get('/analytics/ai-stats');
        el.innerHTML = `
            <div class="grid grid-cols-4 gap-4 text-center">
                <div class="bg-gray-800 rounded-lg p-3">
                    <div class="text-2xl font-bold">${stats.total_calls}</div>
                    <div class="text-xs text-gray-500">总调用</div>
                </div>
                <div class="bg-gray-800 rounded-lg p-3">
                    <div class="text-2xl font-bold">${stats.today_calls}</div>
                    <div class="text-xs text-gray-500">今日调用</div>
                </div>
                <div class="bg-gray-800 rounded-lg p-3">
                    <div class="text-2xl font-bold">${(stats.total_tokens / 1000).toFixed(1)}K</div>
                    <div class="text-xs text-gray-500">总 Tokens</div>
                </div>
                <div class="bg-gray-800 rounded-lg p-3">
                    <div class="text-2xl font-bold">${(stats.today_tokens / 1000).toFixed(1)}K</div>
                    <div class="text-xs text-gray-500">今日 Tokens</div>
                </div>
            </div>
            ${stats.by_scene && stats.by_scene.length ? `
                <div class="mt-3">
                    <div class="text-xs text-gray-500 mb-2">按场景分布：</div>
                    <div class="flex flex-wrap gap-2">
                        ${stats.by_scene.map(s => `
                            <span class="bg-gray-800 px-2 py-1 rounded text-xs">
                                ${s.scene}: ${s.count}次 (${(s.tokens/1000).toFixed(1)}K tokens)
                            </span>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
        `;
    } catch (e) {
        el.innerHTML = `<div class="text-red-400 text-sm">加载失败</div>`;
    }
}

async function loadPrompts() {
    const el = document.getElementById('prompts-list');
    if (!el) return;
    try {
        const prompts = await API.get('/ai/prompts');
        el.innerHTML = prompts.map(p => `
            <div class="bg-gray-800 rounded-lg p-3">
                <div class="flex items-center justify-between mb-2">
                    <div>
                        <span class="font-medium text-sm">${escapeHtml(p.scene_name)}</span>
                        <span class="tag-gray text-xs ml-2">${p.scene}</span>
                        ${p.is_default ? '<span class="tag-blue text-xs">默认</span>' : '<span class="tag-yellow text-xs">已自定义</span>'}
                    </div>
                    <button onclick="editPrompt('${p.scene}')" class="btn-secondary btn-sm">编辑</button>
                </div>
                <div class="text-xs text-gray-500 truncate">System: ${escapeHtml(p.system_prompt.slice(0, 80))}...</div>
            </div>
        `).join('');
    } catch (e) {
        el.innerHTML = `<div class="text-red-400 text-sm">加载失败</div>`;
    }
}

// AI 配置操作
let _keyVisible = false;
let _fallbackKeyVisible = false;

function toggleKeyVisible() {
    const input = document.getElementById('cfg-api-key');
    _keyVisible = !_keyVisible;
    input.type = _keyVisible ? 'text' : 'password';
}

function toggleFallbackKeyVisible() {
    const input = document.getElementById('cfg-fallback-api-key');
    _fallbackKeyVisible = !_fallbackKeyVisible;
    input.type = _fallbackKeyVisible ? 'text' : 'password';
}

async function saveAIConfig() {
    const apiKey = document.getElementById('cfg-api-key')?.value;
    const apiBaseUrl = document.getElementById('cfg-base-url')?.value || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    const model = document.getElementById('cfg-model')?.value || 'qwen-plus';
    const temperature = parseFloat(document.getElementById('cfg-temp')?.value || 0.8);
    const maxTokens = parseInt(document.getElementById('cfg-tokens')?.value || 500);

    // 备用模型配置
    const fallbackApiKey = document.getElementById('cfg-fallback-api-key')?.value || '';
    const fallbackBaseUrl = document.getElementById('cfg-fallback-base-url')?.value || '';
    const fallbackModel = document.getElementById('cfg-fallback-model')?.value || '';

    if (!apiKey) { toast('请输入主模型 API Key', 'error'); return; }

    const btn = document.getElementById('save-ai-btn');
    btn.disabled = true;
    btn.textContent = '保存中...';

    try {
        await API.put('/ai/config', {
            api_key: apiKey,
            api_base_url: apiBaseUrl,
            model,
            temperature,
            max_tokens: maxTokens,
            fallback_api_key: fallbackApiKey,
            fallback_api_base_url: fallbackBaseUrl,
            fallback_model: fallbackModel,
        });
        toast('配置已保存');
    } catch (e) {
        toast(e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '保存配置';
    }
}

async function testAIConnection() {
    const btn = document.getElementById('test-ai-btn');
    const result = document.getElementById('ai-test-result');

    btn.disabled = true;
    btn.textContent = '测试中...';
    result.className = 'mt-3 p-3 rounded-lg text-sm';

    // 先保存配置再测试
    const apiKey = document.getElementById('cfg-api-key')?.value;
    if (!apiKey) {
        result.className = 'mt-3 p-3 rounded-lg text-sm bg-red-500/10 text-red-400';
        result.textContent = '请先输入主模型 API Key';
        result.style.display = 'block';
        btn.disabled = false;
        btn.textContent = '🔌 测试连接';
        return;
    }

    try {
        // 先保存
        await API.put('/ai/config', {
            api_key: apiKey,
            api_base_url: document.getElementById('cfg-base-url')?.value || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            model: document.getElementById('cfg-model')?.value || 'qwen-plus',
            temperature: parseFloat(document.getElementById('cfg-temp')?.value || 0.8),
            max_tokens: parseInt(document.getElementById('cfg-tokens')?.value || 500),
            fallback_api_key: document.getElementById('cfg-fallback-api-key')?.value || '',
            fallback_api_base_url: document.getElementById('cfg-fallback-base-url')?.value || '',
            fallback_model: document.getElementById('cfg-fallback-model')?.value || '',
        });

        // 测试对话
        const res = await API.post('/ai/chat', { message: '你好，请回复"连接成功！AI 配置正常。"' });
        result.className = 'mt-3 p-3 rounded-lg text-sm bg-emerald-500/10 text-emerald-400';
        result.textContent = `✅ 连接成功！ AI 回复: ${res.reply.slice(0, 100)}`;
    } catch (e) {
        result.className = 'mt-3 p-3 rounded-lg text-sm bg-red-500/10 text-red-400';
        result.textContent = `❌ 连接失败: ${e.message}`;
    }

    result.style.display = 'block';
    btn.disabled = false;
    btn.textContent = '🔌 测试连接';
}

async function editPrompt(scene) {
    // 获取当前 prompt 数据
    let promptData;
    try {
        promptData = await API.get(`/ai/prompts/${scene}`);
    } catch (e) {
        toast('加载 Prompt 失败', 'error');
        return;
    }

    // 创建 Modal
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:1000;';

    const escHtml = (s) => {
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    };

    modal.innerHTML = `
        <div style="background:#1f2937;border:1px solid #374151;border-radius:12px;padding:1.5rem;width:720px;max-width:90vw;max-height:90vh;overflow-y:auto;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;">
                <div>
                    <h4 style="font-size:1.125rem;font-weight:600;color:#e5e7eb;">编辑 Prompt</h4>
                    <p style="font-size:0.8125rem;color:#6b7280;margin-top:0.25rem;">
                        ${escHtml(promptData.scene_name)} <span style="color:#4b5563;">(${escHtml(promptData.scene)})</span>
                        ${promptData.is_default ? '<span style="margin-left:0.5rem;padding:0.125rem 0.5rem;border-radius:999px;background:#1e3a5f;color:#60a5fa;font-size:0.75rem;">默认</span>' : ''}
                    </p>
                </div>
                <button style="background:none;border:none;color:#9ca3af;font-size:1.5rem;cursor:pointer;" onclick="this.closest('div[style^=\"position:fixed\"]').remove()">&times;</button>
            </div>

            <div style="display:flex;flex-direction:column;gap:0.75rem;">
                <div>
                    <label style="display:flex;justify-content:space-between;font-size:0.875rem;color:#9ca3af;margin-bottom:0.375rem;">
                        <span>System Prompt</span>
                        <span id="sys-char-count" style="color:#4b5563;">0 字</span>
                    </label>
                    <textarea id="modal-system-prompt" rows="6"
                        style="width:100%;padding:0.625rem;border-radius:6px;background:#111827;color:#e5e7eb;border:1px solid #374151;resize:vertical;font-size:0.875rem;line-height:1.5;font-family:monospace;">${escHtml(promptData.system_prompt)}</textarea>
                </div>
                <div>
                    <label style="display:flex;justify-content:space-between;font-size:0.875rem;color:#9ca3af;margin-bottom:0.375rem;">
                        <span>User Prompt Template</span>
                        <span id="user-char-count" style="color:#4b5563;">0 字</span>
                    </label>
                    <textarea id="modal-user-prompt" rows="8"
                        style="width:100%;padding:0.625rem;border-radius:6px;background:#111827;color:#e5e7eb;border:1px solid #374151;resize:vertical;font-size:0.875rem;line-height:1.5;font-family:monospace;">${escHtml(promptData.user_prompt_template)}</textarea>
                </div>
                <div style="font-size:0.75rem;color:#4b5563;">
                    提示：使用 <code style="background:#374151;padding:0.125rem 0.375rem;border-radius:4px;color:#60a5fa;">{变量名}</code> 作为上下文变量占位符
                </div>
                <div style="display:flex;gap:0.75rem;justify-content:space-between;margin-top:0.5rem;">
                    <div>
                        ${!promptData.is_default ? `
                            <button id="reset-prompt-btn" class="btn btn-sm" style="background:#7f1d1d;color:#fca5a5;"
                                    onclick="window._resetPrompt('${scene}')">↺ 恢复默认</button>
                        ` : ''}
                    </div>
                    <div style="display:flex;gap:0.75rem;">
                        <button class="btn" style="background:#374151;color:#9ca3af;" onclick="this.closest('div[style^=\"position:fixed\"]').remove()">取消</button>
                        <button id="save-prompt-btn" class="btn btn-primary" onclick="window._savePrompt('${scene}')">保存 Prompt</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // 字数统计
    function updateCharCount() {
        const sys = document.getElementById('modal-system-prompt');
        const user = document.getElementById('modal-user-prompt');
        if (sys) document.getElementById('sys-char-count').textContent = `${sys.value.length} 字`;
        if (user) document.getElementById('user-char-count').textContent = `${user.value.length} 字`;
    }
    modal.querySelectorAll('textarea').forEach(ta => {
        ta.addEventListener('input', updateCharCount);
    });
    updateCharCount();

    // 全局保存函数
    window._savePrompt = async (s) => {
        const system = document.getElementById('modal-system-prompt')?.value || '';
        const user = document.getElementById('modal-user-prompt')?.value || '';
        if (!system.trim() || !user.trim()) {
            toast('System Prompt 和 User Prompt 不能为空', 'error');
            return;
        }
        const btn = document.getElementById('save-prompt-btn');
        btn.disabled = true;
        btn.textContent = '保存中...';
        try {
            await API.put(`/ai/prompts/${s}`, {
                scene: s,
                system_prompt: system,
                user_prompt_template: user,
            });
            toast('Prompt 已保存');
            modal.remove();
            loadPrompts();
        } catch (e) {
            toast('保存失败: ' + (e.message || e), 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = '保存 Prompt';
        }
    };

    window._resetPrompt = async (s) => {
        if (!confirm('确定恢复为默认 Prompt？自定义内容将丢失。')) return;
        try {
            const result = await API.post(`/ai/prompts/${s}/reset`);
            toast('已恢复默认 Prompt');
            modal.remove();
            loadPrompts();
        } catch (e) {
            toast('恢复失败: ' + (e.message || e), 'error');
        }
    };
}

// 保留旧函数名兼容
const oldEditPrompt = editPrompt;
