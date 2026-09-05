/* 知识库管理页面 */
function renderKnowledge(container) {
    let state = {
        items: [],
        categories: ['通用', '产品介绍', '常见问题', '使用教程', '题库内容', '球星资料', '推广话术', '个人经历'],
        filterCategory: '',
        searchKeyword: '',
        editing: null,
        showForm: false,
        form: { title: '', content: '', category: '通用', keywords: '', tags: '', images: [] },
        uploading: false,
    };

    async function load() {
        let url = '/knowledge/?page=1&page_size=100';
        if (state.filterCategory) url += `&category=${encodeURIComponent(state.filterCategory)}`;
        if (state.searchKeyword) url += `&keyword=${encodeURIComponent(state.searchKeyword)}`;
        try {
            state.items = await API.get(url);
        } catch (e) { state.items = []; }
        render();
    }

    function openCreate() {
        state.editing = null;
        state.form = { title: '', content: '', category: '通用', keywords: '', tags: '', images: [] };
        state.showForm = true;
        render();
    }

    function openEdit(item) {
        state.editing = item;
        state.form = {
            title: item.title || '',
            content: item.content || '',
            category: item.category || '通用',
            keywords: (item.keywords || []).join(', '),
            tags: (item.tags || []).join(', '),
            images: item.images || [],
        };
        state.showForm = true;
        render();
    }

    function closeForm() {
        state.showForm = false;
        state.editing = null;
        render();
    }

    async function save() {
        if (!state.form.title.trim() || !state.form.content.trim()) {
            alert('标题和内容不能为空');
            return;
        }
        const body = {
            title: state.form.title.trim(),
            content: state.form.content.trim(),
            category: state.form.category,
            keywords: state.form.keywords.split(',').map(s => s.trim()).filter(Boolean),
            tags: state.form.tags.split(',').map(s => s.trim()).filter(Boolean),
            images: state.form.images,
        };
        try {
            if (state.editing) {
                await API.put(`/knowledge/${state.editing.id}`, body);
            } else {
                await API.post('/knowledge/', body);
            }
            closeForm();
            load();
        } catch (e) {
            alert('保存失败: ' + (e.message || e));
        }
    }

    async function remove(id) {
        if (!confirm('确定删除此条目？')) return;
        try {
            await API.del(`/knowledge/${id}`);
            load();
        } catch (e) {
            alert('删除失败');
        }
    }

    async function uploadImage(file) {
        state.uploading = true;
        renderForm();
        const formData = new FormData();
        formData.append('file', file);
        try {
            const resp = await fetch('/api/knowledge/upload-image', { method: 'POST', body: formData });
            const data = await resp.json();
            if (data.url) {
                state.form.images.push(data.url);
            }
        } catch (e) {
            alert('上传失败: ' + (e.message || e));
        }
        state.uploading = false;
        renderForm();
    }

    function removeImage(idx) {
        state.form.images.splice(idx, 1);
        renderForm();
    }

    function render() {
        container.innerHTML = `
            <div style="max-width:1200px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
                    <h3 style="font-size:1.25rem;font-weight:600;color:#e5e7eb;">知识库管理</h3>
                    <button class="btn btn-primary" onclick="window._knowledgeOpenCreate()">+ 新增条目</button>
                </div>

                <div style="display:flex;gap:0.75rem;margin-bottom:1.5rem;flex-wrap:wrap;">
                    <select id="kb-category-filter" style="padding:0.5rem 0.75rem;border-radius:6px;background:#1f2937;color:#e5e7eb;border:1px solid #374151;min-width:120px;"
                            onchange="window._knowledgeFilter(this.value)">
                        <option value="">全部分类</option>
                        ${state.categories.map(c => `<option value="${c}" ${state.filterCategory === c ? 'selected' : ''}>${c}</option>`).join('')}
                    </select>
                    <input type="text" placeholder="搜索标题/内容/关键词..." value="${state.searchKeyword}"
                           style="flex:1;min-width:200px;padding:0.5rem 0.75rem;border-radius:6px;background:#1f2937;color:#e5e7eb;border:1px solid #374151;"
                           oninput="window._knowledgeSearch(this.value)" />
                </div>

                <div style="display:flex;flex-direction:column;gap:0.75rem;">
                    ${state.items.length === 0 ? `
                        <div style="text-align:center;padding:3rem;color:#6b7280;">
                            <p style="font-size:1rem;">暂无知识库条目</p>
                            <p style="font-size:0.875rem;margin-top:0.5rem;">点击右上角「新增条目」添加产品信息</p>
                        </div>
                    ` : state.items.map(item => `
                        <div style="background:#1f2937;border:1px solid #374151;border-radius:8px;padding:1rem;">
                            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                                <div style="flex:1;">
                                    <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
                                        <span style="font-weight:600;color:#e5e7eb;font-size:1rem;">${escHtml(item.title)}</span>
                                        <span style="font-size:0.75rem;padding:0.125rem 0.5rem;border-radius:999px;background:#374151;color:#9ca3af;">${escHtml(item.category)}</span>
                                    </div>
                                    <p style="color:#9ca3af;font-size:0.875rem;line-height:1.5;margin-bottom:0.5rem;white-space:pre-wrap;">${escHtml(item.content)}</p>
                                    ${item.images && item.images.length ? `
                                        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.5rem;">
                                            ${item.images.map(url => `
                                                <img src="${escHtml(url)}" style="width:120px;height:90px;object-fit:cover;border-radius:6px;border:1px solid #374151;cursor:pointer;"
                                                     onclick="window.open('${escHtml(url)}','_blank')" />
                                            `).join('')}
                                        </div>
                                    ` : ''}
                                    ${item.keywords && item.keywords.length ? `
                                        <div style="display:flex;gap:0.375rem;flex-wrap:wrap;margin-bottom:0.375rem;">
                                            ${item.keywords.map(k => `<span style="font-size:0.75rem;padding:0.125rem 0.375rem;border-radius:4px;background:#374151;color:#60a5fa;">${escHtml(k)}</span>`).join('')}
                                        </div>
                                    ` : ''}
                                    <div style="font-size:0.75rem;color:#6b7280;">
                                        ${new Date(item.updated_at).toLocaleString('zh-CN')} 更新
                                    </div>
                                </div>
                                <div style="display:flex;gap:0.5rem;flex-shrink:0;margin-left:1rem;">
                                    <button class="btn btn-sm" style="background:#374151;color:#e5e7eb;" onclick="window._knowledgeEdit(${item.id})">编辑</button>
                                    <button class="btn btn-sm" style="background:#7f1d1d;color:#fca5a5;" onclick="window._knowledgeDel(${item.id})">删除</button>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        if (state.showForm) renderForm();
    }

    function renderForm() {
        const isEdit = !!state.editing;
        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:1000;';
        modal.innerHTML = `
            <div style="background:#1f2937;border:1px solid #374151;border-radius:12px;padding:1.5rem;width:680px;max-width:90vw;max-height:85vh;overflow-y:auto;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;">
                    <h4 style="font-size:1.125rem;font-weight:600;color:#e5e7eb;">${isEdit ? '编辑条目' : '新增条目'}</h4>
                    <button style="background:none;border:none;color:#9ca3af;font-size:1.5rem;cursor:pointer;" onclick="window._knowledgeCloseForm()">&times;</button>
                </div>
                <div style="display:flex;flex-direction:column;gap:0.75rem;">
                    <div>
                        <label style="display:block;font-size:0.875rem;color:#9ca3af;margin-bottom:0.25rem;">标题</label>
                        <input type="text" id="kb-form-title" value="${escHtml(state.form.title)}"
                               style="width:100%;padding:0.5rem 0.75rem;border-radius:6px;background:#111827;color:#e5e7eb;border:1px solid #374151;" />
                    </div>
                    <div>
                        <label style="display:block;font-size:0.875rem;color:#9ca3af;margin-bottom:0.25rem;">分类</label>
                        <select id="kb-form-category"
                                style="width:100%;padding:0.5rem 0.75rem;border-radius:6px;background:#111827;color:#e5e7eb;border:1px solid #374151;">
                            ${state.categories.map(c => `<option value="${c}" ${state.form.category === c ? 'selected' : ''}>${c}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label style="display:block;font-size:0.875rem;color:#9ca3af;margin-bottom:0.25rem;">内容</label>
                        <textarea id="kb-form-content" rows="6"
                                  style="width:100%;padding:0.5rem 0.75rem;border-radius:6px;background:#111827;color:#e5e7eb;border:1px solid #374151;resize:vertical;">${escHtml(state.form.content)}</textarea>
                    </div>
                    <div>
                        <label style="display:block;font-size:0.875rem;color:#9ca3af;margin-bottom:0.25rem;">截图</label>
                        <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.5rem;">
                            ${state.form.images.map((url, idx) => `
                                <div style="position:relative;width:100px;height:75px;">
                                    <img src="${escHtml(url)}" style="width:100%;height:100%;object-fit:cover;border-radius:4px;border:1px solid #374151;" />
                                    <button style="position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;background:#ef4444;color:#fff;border:none;font-size:11px;line-height:18px;text-align:center;cursor:pointer;"
                                            onclick="window._knowledgeRemoveImage(${idx})">&times;</button>
                                </div>
                            `).join('')}
                        </div>
                        <div style="display:flex;gap:0.5rem;align-items:center;">
                            <label class="btn btn-sm" style="background:#374151;color:#e5e7eb;cursor:pointer;${state.uploading ? 'opacity:0.5;pointer-events:none;' : ''}">
                                ${state.uploading ? '上传中...' : '📷 上传截图'}
                                <input type="file" accept="image/*" style="display:none;" onchange="window._knowledgeUploadImage(this.files[0])" />
                            </label>
                            <span style="font-size:0.75rem;color:#6b7280;">支持 JPG/PNG/WebP</span>
                        </div>
                    </div>
                    <div>
                        <label style="display:block;font-size:0.875rem;color:#9ca3af;margin-bottom:0.25rem;">关键词（逗号分隔）</label>
                        <input type="text" id="kb-form-keywords" value="${escHtml(state.form.keywords)}"
                               style="width:100%;padding:0.5rem 0.75rem;border-radius:6px;background:#111827;color:#e5e7eb;border:1px solid #374151;"
                               placeholder="如: 房贷,利率,月供" />
                    </div>
                    <div>
                        <label style="display:block;font-size:0.875rem;color:#9ca3af;margin-bottom:0.25rem;">标签（逗号分隔）</label>
                        <input type="text" id="kb-form-tags" value="${escHtml(state.form.tags)}"
                               style="width:100%;padding:0.5rem 0.75rem;border-radius:6px;background:#111827;color:#e5e7eb;border:1px solid #374151;" />
                    </div>
                    <div style="display:flex;gap:0.75rem;justify-content:flex-end;margin-top:0.5rem;">
                        <button class="btn" style="background:#374151;color:#9ca3af;" onclick="window._knowledgeCloseForm()">取消</button>
                        <button class="btn btn-primary" onclick="window._knowledgeSaveFromForm()">${isEdit ? '保存修改' : '新增'}</button>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(modal);
    }

    window._knowledgeOpenCreate = openCreate;
    window._knowledgeEdit = (id) => openEdit(state.items.find(i => i.id === id));
    window._knowledgeDel = remove;
    window._knowledgeFilter = (v) => { state.filterCategory = v; load(); };
    window._knowledgeSearch = (v) => { state.searchKeyword = v; load(); };
    window._knowledgeCloseForm = closeForm;
    window._knowledgeRemoveImage = removeImage;
    window._knowledgeUploadImage = (file) => { if (file) uploadImage(file); };
    window._knowledgeSaveFromForm = () => {
        const title = document.getElementById('kb-form-title')?.value || '';
        const content = document.getElementById('kb-form-content')?.value || '';
        const category = document.getElementById('kb-form-category')?.value || '通用';
        const keywords = document.getElementById('kb-form-keywords')?.value || '';
        const tags = document.getElementById('kb-form-tags')?.value || '';
        state.form = { title, content, category, keywords, tags, images: state.form.images };
        save();
    };

    load();
}
