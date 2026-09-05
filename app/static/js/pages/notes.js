/* 笔记管理 + 按产品库整理自动发笔记 */
let notesState = { list: [], loading: false };
let notesView = 'all';          // all | product
let productLibraryCache = [];   // 产品库（知识库条目）缓存
let scheduleList = [];          // 定时发布任务缓存
let noteImageList = [];         // 当前笔记已选图片素材 [{id,url,name}]，第一张为封面

async function renderNotes(container) {
    container.innerHTML = `
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <div class="text-sm text-gray-400">管理和发布小红书笔记（可按产品库整理并定时自动发布）</div>
                <div class="flex gap-2">
                    <button onclick="showAINoteModal()" class="btn-secondary btn-sm">🤖 AI 写笔记</button>
                    <button onclick="showNewNoteModal()" class="btn-primary btn-sm">+ 新建笔记</button>
                </div>
            </div>

            <div class="flex gap-2 border-b" style="border-bottom:1px solid #1f2937;padding-bottom:0.75rem;">
                <button id="notes-tab-all" onclick="switchNotesView('all')" class="btn-sm btn-tab active">全部笔记</button>
                <button id="notes-tab-product" onclick="switchNotesView('product')" class="btn-sm btn-tab">📦 按产品库整理</button>
            </div>

            <div id="notes-view"></div>
            <div id="schedule-section"></div>
        </div>

        <!-- 新建/编辑笔记模态框 -->
        <div id="note-modal" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeNoteModal()">
            <div class="modal max-w-2xl">
                <h3 class="text-lg font-medium mb-4" id="note-modal-title">新建笔记</h3>
                <div class="space-y-3">
                    <div>
                        <label class="text-xs text-gray-400">账号</label>
                        <select id="note-account" class="input mt-1"></select>
                    </div>
                    <div>
                        <label class="text-xs text-gray-400">所属产品（知识库条目，选填）</label>
                        <select id="note-product" class="input mt-1"></select>
                    </div>
                    <div>
                        <label class="text-xs text-gray-400">标题</label>
                        <input id="note-title" class="input mt-1" placeholder="笔记标题">
                    </div>
                    <div>
                        <label class="text-xs text-gray-400">正文</label>
                        <textarea id="note-content" class="input mt-1" rows="6" placeholder="笔记正文..."></textarea>
                    </div>
                    <div>
                        <label class="text-xs text-gray-400">话题标签（逗号分隔）</label>
                        <input id="note-tags" class="input mt-1" placeholder="房贷,利率,买房">
                    </div>
                    <div>
                        <label class="text-xs text-gray-400">图片素材（多图 · 第一张为封面）</label>
                        <div id="note-images" class="flex flex-wrap gap-2 mt-1"></div>
                        <div class="mt-1">
                            <input type="file" id="note-image-input" accept="image/*" multiple class="text-xs mt-1" onchange="uploadNoteImages(event)">
                            <div class="text-xs text-gray-500 mt-1" id="note-image-hint">可多选/重复选多张图；顺序即发布顺序，第一张为封面（点图设为封面，点「删」移除）。发布会自动带图。</div>
                        </div>
                    </div>
                </div>
                <div class="flex justify-between mt-6">
                    <button onclick="saveNoteDraft()" class="btn-secondary btn-sm">保存草稿</button>
                    <div class="flex gap-2">
                        <button onclick="closeNoteModal()" class="btn-secondary btn-sm">取消</button>
                        <button onclick="publishNoteDirect()" class="btn-primary btn-sm" id="publish-btn">发布到小红书</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- AI 写笔记模态框 -->
        <div id="ai-note-modal" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeAINoteModal()">
            <div class="modal max-w-2xl">
                <h3 class="text-lg font-medium mb-4">🤖 AI 生成笔记</h3>
                <div class="space-y-3">
                    <div>
                        <label class="text-xs text-gray-400">创作主题</label>
                        <input id="ai-topic" class="input mt-1" placeholder="如：房贷利率下调怎么选">
                    </div>
                    <div>
                        <label class="text-xs text-gray-400">补充说明（选填）</label>
                        <textarea id="ai-desc" class="input mt-1" rows="3" placeholder="补充更多细节..."></textarea>
                    </div>
                </div>
                <div class="flex justify-end gap-2 mt-4">
                    <button onclick="closeAINoteModal()" class="btn-secondary btn-sm">取消</button>
                    <button onclick="generateNoteByAI()" class="btn-primary btn-sm" id="ai-gen-btn">生成</button>
                </div>
                <div id="ai-result" class="mt-4" style="display:none">
                    <div class="bg-gray-800 rounded-lg p-4 text-sm whitespace-pre-wrap" id="ai-result-text"></div>
                    <button onclick="useAINote()" class="btn-primary btn-sm mt-3">使用到新建笔记</button>
                </div>
            </div>
        </div>

        <!-- 按产品批量生成草稿模态框 -->
        <div id="batch-note-modal" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeBatchNoteModal()">
            <div class="modal max-w-2xl">
                <h3 class="text-lg font-medium mb-4">📦 按产品批量生成草稿</h3>
                <div class="space-y-3">
                    <div>
                        <label class="text-xs text-gray-400">账号</label>
                        <select id="batch-account" class="input mt-1"></select>
                    </div>
                    <div>
                        <label class="text-xs text-gray-400">选择产品（知识库条目，可多选）</label>
                        <div id="batch-products" class="grid grid-cols-2 gap-2 mt-2 max-h-56 overflow-y-auto"></div>
                    </div>
                    <div>
                        <label class="text-xs text-gray-400">每个产品生成数量</label>
                        <input id="batch-count" type="number" min="1" max="10" value="1" class="input mt-1">
                    </div>
                    <div>
                        <label class="text-xs text-gray-400">补充要求（选填）</label>
                        <textarea id="batch-desc" class="input mt-1" rows="2" placeholder="如：突出性价比，结尾引导咨询"></textarea>
                    </div>
                </div>
                <div id="batch-result" class="mt-4" style="display:none">
                    <div class="text-sm text-gray-300" id="batch-result-text"></div>
                </div>
                <div class="flex justify-end gap-2 mt-4">
                    <button onclick="closeBatchNoteModal()" class="btn-secondary btn-sm">关闭</button>
                    <button class="btn-primary btn-sm" id="batch-gen-btn" onclick="doBatchGenerate()">开始批量生成</button>
                </div>
            </div>
        </div>

        <!-- 定时发布模态框 -->
        <div id="schedule-modal" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeScheduleModal()">
            <div class="modal max-w-md">
                <h3 class="text-lg font-medium mb-4">⏰ 定时自动发布</h3>
                <div class="text-sm text-gray-400 mb-2" id="schedule-note-title"></div>
                <div>
                    <label class="text-xs text-gray-400">发布时间（到点自动发布到小红书）</label>
                    <input id="schedule-datetime" type="datetime-local" class="input mt-1">
                </div>
                <div class="flex justify-end gap-2 mt-6">
                    <button onclick="closeScheduleModal()" class="btn-secondary btn-sm">取消</button>
                    <button onclick="confirmSchedule()" class="btn-primary btn-sm">设置排期</button>
                </div>
            </div>
        </div>
    `;

    // 加载账号列表到选择框 / 产品库选项
    try {
        const accounts = await API.get('/accounts');
        const sel = document.getElementById('note-account');
        const batchAcc = document.getElementById('batch-account');
        if (sel) {
            sel.innerHTML = accounts.map(a =>
                `<option value="${a.id}">${escapeHtml(a.nickname || '未命名')}</option>`
            ).join('');
        }
        if (batchAcc) {
            batchAcc.innerHTML = accounts.map(a =>
                `<option value="${a.id}">${escapeHtml(a.nickname || '未命名')}</option>`
            ).join('');
        }
    } catch (e) {}

    try {
        const prods = await API.get('/knowledge?page_size=100');
        productLibraryCache = (Array.isArray(prods) ? prods : []).map(p => ({ id: p.id, title: p.title, content: p.content, tags: p.tags || [] }));
        fillProductSelects();
    } catch (e) {}

    await reloadNotesView();
    await loadSchedules();
}

function fillProductSelects() {
    const prodOpts = productLibraryCache.map(p =>
        `<option value="${p.id}">${escapeHtml(String(p.title || '未命名'))}</option>`
    ).join('');
    const sel = document.getElementById('note-product');
    if (sel) sel.innerHTML = '<option value="">不关联产品</option>' + prodOpts;

    const box = document.getElementById('batch-products');
    if (box) {
        box.innerHTML = productLibraryCache.length
            ? productLibraryCache.map(p => `
                <label class="flex items-center gap-2 text-sm bg-gray-800 rounded p-2 cursor-pointer">
                    <input type="checkbox" value="${p.id}" class="product-pick">
                    <span class="truncate">${escapeHtml(String(p.title || '未命名'))}</span>
                </label>`).join('')
            : '<div class="text-sm text-gray-500 col-span-2">产品库为空，请先到「知识库」添加。</div>';
    }
}

function switchNotesView(v) {
    notesView = v;
    const a = document.getElementById('notes-tab-all');
    const b = document.getElementById('notes-tab-product');
    if (a) a.classList.toggle('active', v === 'all');
    if (b) b.classList.toggle('active', v === 'product');
    reloadNotesView();
}

async function reloadNotesView() {
    if (notesView === 'product') await loadProductLibrary();
    else await loadNotes();
}

/* ==================== 全部笔记视图 ==================== */
async function loadNotes() {
    const el = document.getElementById('notes-view');
    if (!el) return;
    showLoading(el);

    try {
        notesState.list = await API.get('/notes');

        if (notesState.list.length === 0) {
            showEmpty(el, '还没有笔记，点击右上角新建，或用「按产品库整理」批量生成');
            return;
        }

        el.innerHTML = `
            <div class="table-wrap">
                <table>
                    <thead><tr><th>标题</th><th>所属产品</th><th>状态</th><th>💗</th><th>💬</th><th>📌</th><th>时间</th><th>操作</th></tr></thead>
                    <tbody>
                        ${notesState.list.map(n => `
                            <tr>
                                <td class="max-w-[200px] truncate">${escapeHtml(n.title || '无标题')}</td>
                                <td class="max-w-[120px] truncate">${escapeHtml(productTitle(n.product_id))}</td>
                                <td>${statusTag(n.status)}</td>
                                <td>${n.likes}</td>
                                <td>${n.comments_count}</td>
                                <td>${n.collects}</td>
                                <td class="text-xs text-gray-500">${n.published_at ? new Date(n.published_at).toLocaleDateString() : '-'}</td>
                                <td>
                                    <div class="flex gap-1">
                                        ${n.status === 'draft' ? `<button onclick="publishNote(${n.id})" class="btn-success btn-sm">发布</button>
                                        <button onclick="showScheduleModal(${n.id}, '${escapeHtml(String(n.title || ''))}')" class="btn-secondary btn-sm">⏰排期</button>` : ''}
                                        <button onclick="deleteNote(${n.id})" class="btn-danger btn-sm">删除</button>
                                    </div>
                                </td>
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

function productTitle(productId) {
    if (!productId) return '-';
    const p = productLibraryCache.find(x => x.id === productId);
    return p ? p.title : `#${productId}`;
}

/* ==================== 按产品库整理视图 ==================== */
async function loadProductLibrary() {
    const el = document.getElementById('notes-view');
    if (!el) return;
    showLoading(el);

    try {
        // 拉取所有笔记并关联产品
        const notes = await API.get('/notes');
        let prods = productLibraryCache;
        if (!prods.length) {
            const r = await API.get('/knowledge?page_size=100');
            prods = (Array.isArray(r) ? r : []).map(p => ({ id: p.id, title: p.title, content: p.content, tags: p.tags || [] }));
            productLibraryCache = prods;
        }

        // 未关联产品的笔记
        const orphans = notes.filter(n => !n.product_id);

        if (prods.length === 0 && orphans.length === 0) {
            showEmpty(el, '产品库为空。请先到「知识库」添加产品条目，每个产品会自动生成一篇笔记。');
            return;
        }

        let html = `
            <div class="flex justify-end mb-3">
                <button onclick="showMortgageProfile()" class="btn-secondary btn-sm" style="border-color:#f6c453;color:#f6c453;margin-right:0.5rem;">🏠 房贷画像</button>
                <button onclick="showBatchNoteModal()" class="btn-primary btn-sm">📦 按产品批量生成草稿</button>
            </div>
            <div class="space-y-4">
        `;

        for (const p of prods) {
            const pNotes = notes.filter(n => n.product_id === p.id);
            if (pNotes.length === 0) {
                // 无笔记的产品也给提示卡片
                html += productCard(p.id, p.title, p.content, [], '未生成笔记，可批量生成');
            } else {
                html += productCard(p.id, p.title, p.content, pNotes, '');
            }
        }

        // 未关联产品的笔记
        if (orphans.length) {
            html += productCard(null, '未关联产品', '', orphans, '');
        }

        el.innerHTML = html + `</div>`;
    } catch (e) {
        showError(el, e.message);
    }
}

function productCard(pid, title, content, notes, hint) {
    const rows = notes.length ? notes.map(n => `
        <div class="flex items-center justify-between py-2" style="border-bottom:1px solid #1f2937;">
            <div class="flex-1 min-w-0">
                <div class="truncate">${escapeHtml(n.title || '无标题')} <span style="color:#6b7280;font-size:0.75rem;">${statusTag(n.status)}</span></div>
                ${n.published_at ? `<div class="text-xs" style="color:#6b7280;">${new Date(n.published_at).toLocaleString()}</div>` : ''}
            </div>
            <div class="flex gap-1 flex-shrink-0 ml-3">
                ${n.status === 'draft' ? `
                    <button onclick="publishNote(${n.id})" class="btn-success btn-sm">发布</button>
                    <button onclick="showScheduleModal(${n.id}, '${escapeHtml(String(n.title || ''))}')" class="btn-secondary btn-sm">⏰排期</button>
                ` : ''}
                <button onclick="deleteNote(${n.id})" class="btn-danger btn-sm">删除</button>
            </div>
        </div>
    `).join('') : `<div class="py-2 text-sm" style="color:#6b7280;">${hint || '暂无笔记'}</div>`;

    return `
        <div class="bg-gray-800 rounded-lg p-3">
            <div class="flex items-center justify-between mb-2">
                <div class="font-medium text-sm truncate">
                    ${pid ? `📦 ${escapeHtml(String(title || '未命名产品'))}` : '🗂 未关联产品'}
                </div>
                <div class="flex gap-2 flex-shrink-0 ml-3">
                    ${pid ? `<button onclick="showBatchNoteModal('${pid}')" class="btn-secondary btn-sm">为此产品生成</button>` : ''}
                </div>
            </div>
            ${pid && content ? `<div class="text-xs mb-2 line-clamp-2" style="color:#6b7280;">${escapeHtml(String(content).slice(0, 160))}</div>` : ''}
            <div class="text-xs mb-1" style="color:#4b5563;">${notes.length} 篇笔记</div>
            <div>${rows}</div>
        </div>
    `;
}

/* ==================== 新建/编辑 ==================== */
function showNewNoteModal() {
    document.getElementById('note-modal-title').textContent = '新建笔记';
    document.getElementById('note-title').value = '';
    document.getElementById('note-content').value = '';
    document.getElementById('note-tags').value = '';
    document.getElementById('note-product').value = '';
    noteImageList = [];
    renderNoteImages();
    document.getElementById('note-modal').style.display = 'flex';
}

/* ─── 多图上传（素材 → 素材库 → 发布时自动带图） ─── */
async function uploadNoteImages(ev) {
    const files = Array.from((ev && ev.target && ev.target.files) || []);
    if (!files.length) return;
    const hint = document.getElementById('note-image-hint');
    if (hint) hint.textContent = '上传中…';
    for (const f of files) {
        try {
            const fd = new FormData();
            fd.append('file', f);
            const resp = await fetch('/api/materials/upload', { method: 'POST', body: fd });
            const res = await resp.json();
            if (res && res.id) {
                const base = String(res.file_path || '').split(/[\\/]/).pop();
                noteImageList.push({ id: res.id, url: '/uploads/' + base, name: f.name });
            }
        } catch (_) {}
    }
    if (hint) hint.textContent = '可多选/重复选多张图；顺序即发布顺序，第一张为封面（点图设为封面，点「删」移除）。发布会自动带图。';
    renderNoteImages();
    if (ev && ev.target) ev.target.value = '';
}
function renderNoteImages() {
    const box = document.getElementById('note-images');
    if (!box) return;
    if (!noteImageList.length) {
        box.innerHTML = '<span class="text-xs" style="color:#6b7280;">未添加图片（可发纯文字）</span>';
        return;
    }
    box.innerHTML = noteImageList.map((img, i) => `
        <div style="position:relative;width:64px;height:64px;border-radius:8px;overflow:hidden;border:1px solid #374151;cursor:pointer;" title="${escapeHtml(img.name || '图片')}${i === 0 ? '（封面）' : '（点击设为封面）'}" onclick="setNoteCover(${i})">
            <img src="${escapeHtml(img.url)}" style="width:100%;height:100%;object-fit:cover;">
            <div style="position:absolute;top:0;left:0;right:0;background:rgba(0,0,0,0.55);color:#fff;font-size:9px;padding:1px 3px;text-align:center;">${i === 0 ? '封面' : '图' + (i + 1)}</div>
            <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(220,38,38,0.85);color:#fff;font-size:10px;text-align:center;padding:1px 0;" onclick="event.stopPropagation();removeNoteImage(${i})">删</div>
        </div>
    `).join('');
}
function setNoteCover(i) {
    if (i <= 0) return;
    const it = noteImageList.splice(i, 1)[0];
    noteImageList.unshift(it);
    renderNoteImages();
}
function removeNoteImage(i) {
    noteImageList.splice(i, 1);
    renderNoteImages();
}

function closeNoteModal() {
    document.getElementById('note-modal').style.display = 'none';
}

function getNoteFormPayload() {
    const accountId = document.getElementById('note-account')?.value;
    const title = document.getElementById('note-title')?.value;
    const content = document.getElementById('note-content')?.value;
    const tags = (document.getElementById('note-tags')?.value || '').split(',').map(t => t.trim()).filter(Boolean);
    const productId = document.getElementById('note-product')?.value;
    return {
        account_id: parseInt(accountId),
        product_id: productId ? parseInt(productId) : null,
        title, content, tags, image_ids: noteImageList.map(x => x.id),
    };
}

async function saveNoteDraft() {
    const p = getNoteFormPayload();
    if (!p.account_id) {
        toast('请选择账号', 'error');
        return;
    }
    try {
        await API.post('/notes', p);
        toast('草稿已保存');
        closeNoteModal();
        await reloadNotesView();
    } catch (e) {
        toast(e.message, 'error');
    }
}

async function publishNoteDirect() {
    const btn = document.getElementById('publish-btn');
    btn.disabled = true;
    btn.textContent = '发布中...';
    try {
        const p = getNoteFormPayload();
        const note = await API.post('/notes', p);
        await API.post(`/notes/${note.id}/publish`, {});
        toast('发布成功！');
        closeNoteModal();
        await reloadNotesView();
    } catch (e) {
        toast(e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '发布到小红书';
    }
}

async function publishNote(id) {
    if (!confirm('确定发布该笔记？')) return;
    try {
        await API.post(`/notes/${id}/publish`, {});
        toast('发布成功');
        await reloadNotesView();
    } catch (e) {
        toast(e.message, 'error');
    }
}

async function deleteNote(id) {
    if (!confirm('确定删除？')) return;
    try {
        await API.del(`/notes/${id}`);
        toast('已删除');
        await reloadNotesView();
    } catch (e) {
        toast(e.message, 'error');
    }
}

/* ==================== 按产品批量生成草稿 ==================== */
function showBatchNoteModal(preselectId) {
    if (!productLibraryCache.length) {
        toast('产品库为空，请先到「知识库」添加', 'error');
        return;
    }
    document.getElementById('batch-result').style.display = 'none';
    document.getElementById('batch-count').value = '1';
    document.getElementById('batch-desc').value = '';
    const box = document.getElementById('batch-products');
    if (box) {
        box.querySelectorAll('.product-pick').forEach(cb => cb.checked = false);
        if (preselectId) {
            box.querySelectorAll('.product-pick').forEach(cb => {
                if (cb.value == preselectId) cb.checked = true;
            });
        }
    }
    document.getElementById('batch-note-modal').style.display = 'flex';
}

function closeBatchNoteModal() {
    document.getElementById('batch-note-modal').style.display = 'none';
}

async function doBatchGenerate() {
    const accountId = document.getElementById('batch-account')?.value;
    const count = parseInt(document.getElementById('batch-count')?.value || '1');
    const desc = document.getElementById('batch-desc')?.value || '';
    const picked = Array.from(document.querySelectorAll('.product-pick:checked')).map(cb => parseInt(cb.value));

    if (!accountId) { toast('请选择账号', 'error'); return; }
    if (!picked.length) { toast('请至少选择一个产品', 'error'); return; }

    const btn = document.getElementById('batch-gen-btn');
    btn.disabled = true;
    btn.textContent = '生成中...';
    document.getElementById('batch-result').style.display = 'none';

    try {
        const res = await API.post('/notes/ai-generate-batch', {
            account_id: parseInt(accountId), product_ids: picked, count_per_product: count, description: desc,
        });
        const succ = (res.created || []).length;
        const fails = (res.errors || []).length;
        let txt = `✅ 已生成 ${succ} 篇草稿${fails ? `（${fails} 篇失败）` : ''}`;
        if (fails) {
            txt += '\n失败明细：\n' + (res.errors || []).map(e => `- ${e.product_title}: ${e.error}`).join('\n');
        }
        const box = document.getElementById('batch-result-text');
        box.textContent = txt;
        document.getElementById('batch-result').style.display = 'block';
        toast(`已生成 ${succ} 篇草稿`);
        await reloadNotesView();
        await loadSchedules();
    } catch (e) {
        toast(e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '开始批量生成';
    }
}

/* ==================== 定时发布 ==================== */
let _scheduleNoteId = null;

function showScheduleModal(noteId, title) {
    _scheduleNoteId = noteId;
    document.getElementById('schedule-note-title').textContent = `笔记：${title}`;
    document.getElementById('schedule-datetime').value = '';
    document.getElementById('schedule-modal').style.display = 'flex';
}

function closeScheduleModal() {
    document.getElementById('schedule-modal').style.display = 'none';
    _scheduleNoteId = null;
}

async function confirmSchedule() {
    const dt = document.getElementById('schedule-datetime')?.value;
    if (!dt) { toast('请选择发布时间', 'error'); return; }
    if (!_scheduleNoteId) return;
    try {
        const local = new Date(dt);
        await API.post('/schedule', { note_id: _scheduleNoteId, publish_at: local.toISOString() });
        toast('排期已设置');
        closeScheduleModal();
        await loadSchedules();
    } catch (e) {
        toast(e.message, 'error');
    }
}

async function deleteSchedule(id) {
    if (!confirm('确定删除该排期？')) return;
    try {
        await API.del(`/schedule/${id}`);
        toast('已删除排期');
        await loadSchedules();
    } catch (e) {
        toast(e.message, 'error');
    }
}

async function loadSchedules() {
    const el = document.getElementById('schedule-section');
    if (!el) return;
    try {
        scheduleList = await API.get('/schedule');
        const pending = scheduleList.filter(s => !s.is_published);
        if (pending.length === 0) { el.innerHTML = ''; return; }

        el.innerHTML = `
            <h4 class="text-sm font-medium mb-2" style="color:#9ca3af;">⏰ 待发布的定时任务</h4>
            <div class="bg-gray-800 rounded-lg p-3 divide-y" style="border:1px solid #1f2937;">
                ${pending.map(s => `
                    <div class="flex items-center justify-between py-2">
                        <div class="min-w-0">
                            <div class="truncate text-sm">${escapeHtml(s.title || `笔记 #${s.note_id}`)}</div>
                            <div class="text-xs" style="color:#6b7280;">将于 ${new Date(s.publish_at).toLocaleString()} 自动发布</div>
                            ${s.last_error ? `<div class="text-xs" style="color:#f87171;">上次失败：${escapeHtml(s.last_error)}</div>` : ''}
                        </div>
                        <button onclick="deleteSchedule(${s.id})" class="btn-danger btn-sm flex-shrink-0 ml-3">取消排期</button>
                    </div>
                `).join('')}
            </div>
        `;
    } catch (e) {
        el.innerHTML = '';
    }
}

/* ==================== AI 生成笔记（自由） ==================== */
let _aiGeneratedNote = '';

function showAINoteModal() {
    document.getElementById('ai-note-modal').style.display = 'flex';
    document.getElementById('ai-result').style.display = 'none';
    document.getElementById('ai-topic').value = '';
    document.getElementById('ai-desc').value = '';
    _aiGeneratedNote = '';
}

function closeAINoteModal() {
    document.getElementById('ai-note-modal').style.display = 'none';
}

async function generateNoteByAI() {
    const topic = document.getElementById('ai-topic')?.value;
    const desc = document.getElementById('ai-desc')?.value;
    const btn = document.getElementById('ai-gen-btn');
    if (!topic) { toast('请输入创作主题', 'error'); return; }

    btn.disabled = true;
    btn.textContent = '生成中...';

    try {
        const res = await API.post('/notes/ai-generate', { topic, description: desc });
        _aiGeneratedNote = res.content;
        document.getElementById('ai-result-text').textContent = res.content;
        document.getElementById('ai-result').style.display = 'block';
    } catch (e) {
        toast(e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '生成';
    }
}

function useAINote() {
    if (!_aiGeneratedNote) return;
    closeAINoteModal();
    showNewNoteModal();
    const lines = _aiGeneratedNote.split('\n');
    let title = '', content = '', inContent = false;
    for (const line of lines) {
        if (line.startsWith('#') || line.startsWith('##')) {
            title = line.replace(/^#+\s*/, '');
        } else if (line.startsWith('---') || line.startsWith('话题标签')) {
            break;
        } else {
            content += line + '\n';
        }
    }
    document.getElementById('note-title').value = title || '笔记标题';
    document.getElementById('note-content').value = content.trim() || _aiGeneratedNote;
    toast('已填充笔记内容，请检查后发布');
}