/* 评论互动 */
async function renderComments(container) {
    container.innerHTML = `
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <div class="text-sm text-gray-400">AI 驱动的评论管理和主动引流</div>
                <button onclick="showActiveCommentModal()" class="btn-primary btn-sm">🎯 主动评论</button>
            </div>

            <!-- 标签切换 -->
            <div class="flex gap-2 border-b border-gray-800 pb-2">
                <button onclick="switchCommentTab('received')" class="px-3 py-1.5 text-sm rounded-lg" id="tab-received">收到的评论</button>
                <button onclick="switchCommentTab('sent')" class="px-3 py-1.5 text-sm rounded-lg text-gray-500" id="tab-sent">发出的评论</button>
            </div>

            <div id="comments-content"></div>
        </div>

        <!-- 主动评论模态框 -->
        <div id="active-comment-modal" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeActiveCommentModal()">
            <div class="modal">
                <h3 class="text-lg font-medium mb-4">🎯 主动评论引流</h3>
                <div class="space-y-3">
                    <div>
                        <label class="text-xs text-gray-400">笔记链接</label>
                        <input id="ac-note-url" class="input mt-1" placeholder="https://www.xiaohongshu.com/explore/...">
                    </div>
                    <div>
                        <label class="text-xs text-gray-400">评论场景</label>
                        <select id="ac-scene" class="input mt-1">
                            <option value="intercept_comment">同类笔记截流</option>
                            <option value="agent_comment">中介笔记精准评论</option>
                        </select>
                    </div>
                </div>
                <div id="ac-result" class="mt-4" style="display:none">
                    <div class="bg-gray-800 rounded-lg p-3">
                        <div class="text-xs text-gray-400 mb-2">AI 生成的评论：</div>
                        <div class="text-sm" id="ac-comment-text"></div>
                    </div>
                </div>
                <div class="flex justify-end gap-2 mt-6">
                    <button onclick="closeActiveCommentModal()" class="btn-secondary btn-sm">取消</button>
                    <button onclick="executeActiveComment()" class="btn-primary btn-sm" id="ac-btn">AI 生成并评论</button>
                </div>
            </div>
        </div>
    `;

    await switchCommentTab('received');
}

let _currentCommentTab = 'received';

async function switchCommentTab(tab) {
    _currentCommentTab = tab;
    document.querySelectorAll('[id^="tab-"]').forEach(el => {
        el.classList.toggle('bg-gray-800', el.id === `tab-${tab}`);
        el.classList.toggle('text-gray-500', el.id !== `tab-${tab}`);
    });

    const el = document.getElementById('comments-content');
    if (!el) return;
    showLoading(el);

    try {
        const comments = await API.get(`/comments?direction=${tab}&limit=50`);

        if (comments.length === 0) {
            showEmpty(el, '暂无评论记录');
            return;
        }

        el.innerHTML = `
            <div class="table-wrap">
                <table>
                    <thead><tr><th>作者</th><th>评论内容</th><th>AI回复</th><th>情感</th><th>时间</th><th>操作</th></tr></thead>
                    <tbody>
                        ${comments.map(c => `
                            <tr>
                                <td class="text-xs">${escapeHtml(c.author_name || '匿名')}</td>
                                <td class="max-w-[250px] truncate">${escapeHtml(c.content)}</td>
                                <td class="max-w-[200px] truncate text-gray-500 text-xs">
                                    ${c.reply_content ? escapeHtml(c.reply_content) : '<span class="text-gray-600">未回复</span>'}
                                </td>
                                <td>${c.sentiment ? `<span class="tag-${c.sentiment === 'positive' ? 'green' : c.sentiment === 'negative' ? 'red' : 'yellow'}">${c.sentiment}</span>` : '-'}</td>
                                <td class="text-xs text-gray-500">${c.commented_at ? new Date(c.commented_at).toLocaleString() : '-'}</td>
                                <td>
                                    <div class="flex gap-1">
                                        ${!c.reply_content ? `<button onclick="aiReplyComment(${c.id})" class="btn-secondary btn-sm">🤖 AI回复</button>` : ''}
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            ${tab === 'received' ? `
                <div class="flex justify-end mt-3">
                    <button onclick="batchAIReply()" class="btn-primary btn-sm">🤖 AI 批量回复未回复评论</button>
                </div>
            ` : ''}
        `;
    } catch (e) {
        showError(el, e.message);
    }
}

async function aiReplyComment(commentId) {
    try {
        const res = await API.post('/comments/ai-reply', { comment_ids: [commentId] });
        if (res.length > 0) {
            toast('AI 回复成功');
            await switchCommentTab(_currentCommentTab);
        }
    } catch (e) {
        toast(e.message, 'error');
    }
}

async function batchAIReply() {
    const el = document.getElementById('comments-content');
    try {
        const comments = await API.get('/comments?direction=received&limit=100');
        const unresponded = comments.filter(c => !c.reply_content);
        if (unresponded.length === 0) {
            toast('没有未回复的评论');
            return;
        }
        const ids = unresponded.map(c => c.id);
        const res = await API.post('/comments/ai-reply', { comment_ids: ids });
        toast(`已 AI 回复 ${res.length} 条评论`);
        await switchCommentTab(_currentCommentTab);
    } catch (e) {
        toast(e.message, 'error');
    }
}

function showActiveCommentModal() {
    document.getElementById('active-comment-modal').style.display = 'flex';
    document.getElementById('ac-result').style.display = 'none';
    document.getElementById('ac-note-url').value = '';
}

function closeActiveCommentModal() {
    document.getElementById('active-comment-modal').style.display = 'none';
}

async function executeActiveComment() {
    const url = document.getElementById('ac-note-url')?.value;
    const scene = document.getElementById('ac-scene')?.value;
    const btn = document.getElementById('ac-btn');

    if (!url) { toast('请输入笔记链接', 'error'); return; }

    btn.disabled = true;
    btn.textContent = 'AI 生成中...';

    try {
        const res = await API.post(`/comments/active-comment?note_url=${encodeURIComponent(url)}&scene=${scene}`, {});
        document.getElementById('ac-comment-text').textContent = res.comment;
        document.getElementById('ac-result').style.display = 'block';
        btn.textContent = '评论已发布 ✅';
        toast('评论发布成功！');
    } catch (e) {
        toast(e.message, 'error');
        btn.disabled = false;
        btn.textContent = 'AI 生成并评论';
    }

    setTimeout(() => {
        btn.disabled = false;
        btn.textContent = 'AI 生成并评论';
    }, 3000);
}
