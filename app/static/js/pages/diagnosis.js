/* 账号诊断：频率建议 + 选题 + 笔记规划 */
async function renderDiagnosis(container) {
    container.innerHTML = `
        <div class="space-y-6">
            <div class="card">
                <div class="text-sm text-gray-400 mb-1 inline-flex items-center gap-2">
                    <span style="background:#ef4444;color:#fff;border-radius:6px;padding:1px 8px;font-size:11px;">断症 + 练剑</span>
                    <span>账号诊断 · 笔记规划</span>
                </div>
                <div class="text-lg font-bold mb-2">AI 诊断你的账号，给出发笔记频率 & 选题 & 一份短期→中期→后期的笔记规划 & 笔记结构符合度 & 架构建议</div>
                <p class="text-xs text-gray-500 mb-5">AI 会读取你近期笔记表现 + 最新导入的知识库产品资料，产出可执行规划（短期/中期/后期），检查已发笔记是否符合「对应品类页数与每页功能」结构，并按最新知识库给出笔记架构建议。也可输入他人主页进行分析。建议先填号，再点生成。</p>

                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label class="block text-xs text-gray-400 mb-1">账号阶段</label>
                        <select id="dg-stage" class="w-full" style="background:#111827;border:1px solid #374151;border-radius:8px;padding:8px 10px;color:#d1d5db;">
                            <option value="起步期">起步期（刚建号/笔记不多）</option>
                            <option value="成长期">成长期（有内容、想放大）</option>
                            <option value="成熟期">成熟期（稳定更新、想提转化）</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs text-gray-400 mb-1">当前 / 期望发笔记频率</label>
                        <input id="dg-frequency" type="text" placeholder="如：每周 2 篇" class="w-full" style="background:#111827;border:1px solid #374151;border-radius:8px;padding:8px 10px;color:#d1d5db;">
                    </div>
                    <div>
                        <label class="block text-xs text-gray-400 mb-1">想服务的人群 / 补充</label>
                        <input id="dg-audience" type="text" placeholder="如：准备买房、怕被中介坑的年轻人" class="w-full" style="background:#111827;border:1px solid #374151;border-radius:8px;padding:8px 10px;color:#d1d5db;">
                    </div>
                </div>
                <div class="mt-3">
                    <label class="block text-xs text-gray-400 mb-1">分析对象（默认=自己的账号）</label>
                    <input id="dg-target" type="text" placeholder="留空=分析自己的账号；想分析别人，粘对方的主页链接或某篇笔记链接" class="w-full" style="background:#111827;border:1px solid #374151;border-radius:8px;padding:8px 10px;color:#d1d5db;">
                </div>

                <button id="btn-diagnose" class="mt-5" style="background:#ef4444;color:#fff;border:none;border-radius:8px;padding:10px 22px;font-weight:700;cursor:pointer;">✨ 生成账号诊断 + 笔记规划</button>
            </div>

            <div id="dg-result"></div>
        </div>
    `;

    document.getElementById('btn-diagnose').addEventListener('click', async () => {
        const btn = document.getElementById('btn-diagnose');
        const result = document.getElementById('dg-result');
        btn.disabled = true;
        btn.textContent = 'AI 诊断中，请稍候…';
        result.innerHTML = '<div class="loading">AI 正在分析你的账号与笔记…</div>';

        const payload = {
            stage: document.getElementById('dg-stage').value,
            frequency: document.getElementById('dg-frequency').value || '',
            audience: document.getElementById('dg-audience').value || '',
            target_url: document.getElementById('dg-target').value.trim() || '',
        };

        try {
            const data = await API.post('/diagnosis/account', payload);
            window.__xhsDgData = {
                data: data,
                stage: payload.stage,
                frequency: payload.frequency,
                audience: payload.audience,
                at: new Date().toLocaleString('zh-CN'),
            };
            result.innerHTML = renderResult(data);
        } catch (e) {
            result.innerHTML = `<div class="empty-state"><div class="icon">⚠</div><div class="text" style="color:#f87171;">${escapeHtml(e.message)}</div></div>`;
        } finally {
            btn.disabled = false;
            btn.textContent = '✨ 生成账号诊断 + 笔记规划';
        }
    });
}

function renderResult(d) {
    const freq = d.frequency_advice || {};
    const topics = d.topics || [];
    const plan = (d.plan || []).slice().sort((a, b) => (a.step || 0) - (b.step || 0));
    const planPhases = d.plan_phases || [];
    const archAdvice = d.architecture_advice || [];

    const typeColor = { '引流探饵': '#3b82f6', '信任干货': '#10b981', '转化成交': '#f59e0b' };
    const arch = d.architecture || {};

    const archScoreColor = (lv) => lv === '高' ? '#10b981' : (lv === '中' ? '#f59e0b' : '#ef4444');

    return `
        <div class="space-y-6">

            <div class="flex items-center justify-between">
                <div class="text-sm text-gray-400">已生成诊断报告</div>
                <button id="btn-export-pdf" style="background:#0ea5e9;color:#fff;border:none;border-radius:8px;padding:8px 16px;font-weight:700;cursor:pointer;" onclick="exportDiagnosisPdf()">📄 导出 PDF</button>
            </div>
            <div id="dg-pdf-src"></div>

            <div class="card">
                <div class="text-sm text-gray-400 mb-1 inline-flex items-center gap-2">
                    <span style="background:#8b5cf6;color:#fff;border-radius:6px;padding:1px 8px;font-size:11px;">笔记结构</span>
                    <span>你的笔记是否符合该品类的页数结构</span>
                </div>
                ${arch.matched ? `<div class="text-xs text-gray-500 mb-3" style="color:#8b5cf6;">${escapeHtml(arch.matched)}</div>` : ''}
                <div class="flex items-center gap-4 mb-3">
                    <div>
                        <div class="text-xs text-gray-500 mb-1">结构符合度</div>
                        <div class="text-2xl font-bold" style="color:${archScoreColor(arch.level)};">${arch.overall_score != null ? arch.overall_score + ' / 100' : '—'}</div>
                    </div>
                    ${arch.level ? `<div><div class="text-xs text-gray-500 mb-1">判定等级</div><div class="text-lg font-bold" style="color:${archScoreColor(arch.level)};">${escapeHtml(arch.level)}</div></div>` : ''}
                    ${(arch.category || arch.product_type) ? `<div><div class="text-xs text-gray-500 mb-1">所属品类</div><div class="text-lg font-bold">${escapeHtml(arch.category || arch.product_type)}</div></div>` : ''}
                </div>
                ${(arch.notes_review || []).length ? `
                    <div class="text-xs text-gray-500 mb-2">逐篇检查（${arch.notes_review.length} 篇）· <span style="color:#0ea5e9;">点标题可打开单篇检查</span>${arch.source === 'target' ? '' : ''}</div>
                    <div class="space-y-1.5">
                        ${arch.notes_review.map((r, i) => {
                            const it = (arch.review_items && arch.review_items[i]) || {};
                            const url = it.url || '';
                            return `
                            <div class="flex items-start gap-2 text-sm">
                                <span class="flex-none" style="margin-top:4px;color:${r.conforms ? '#10b981' : '#ef4444'};">${r.conforms ? '✓' : '✕'}</span>
                                <div class="flex-1">
                                    <div>
                                        <a href="javascript:void(0)" onclick="window.checkThisNote(${i})" style="${url ? 'color:#0ea5e9;' : 'color:#9ca3af;'}text-decoration:none;cursor:pointer;">${escapeHtml(r.title || '')}</a>
                                        <span class="text-xs text-gray-600">[${escapeHtml(r.notes_type || '')}]</span> ${r.estimate_pages ? `<span class="text-xs text-gray-500">（估计 ${escapeHtml(r.estimate_pages)}）</span>` : ''}
                                    </div>
                                    ${r.reason ? `<div class="text-xs text-gray-500">${escapeHtml(r.reason)}</div>` : ''}
                                </div>
                            </div>`;
                        }).join('')}
                    </div>
                    <div class="mt-2 flex items-center gap-2">
                        <input id="dg-check-url" type="text" placeholder="粘贴一篇小红书笔记链接，点『检查这篇』单独看结构" style="flex:1;background:#111827;border:1px solid #374151;border-radius:8px;padding:6px 10px;color:#d1d5db;font-size:12px;">
                        <button onclick="window.checkThisUrl()" style="background:#0ea5e9;color:#fff;border:none;border-radius:8px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;">检查这篇</button>
                    </div>
                ` : ''}
                ${(arch.gaps || []).length ? `
                    <div class="text-xs text-gray-500 mt-3 mb-1">差距所在</div>
                    <div class="space-y-1">${arch.gaps.map(g => `<div class="text-xs text-gray-400">· ${escapeHtml(g)}</div>`).join('')}</div>
                ` : ''}
                ${arch.advice ? `<div class="mt-3 text-xs" style="color:#8b5cf6;">💡 ${escapeHtml(arch.advice)}</div>` : ''}
                ${!arch.matched && arch.overall_score == null ? '<div class="text-xs text-gray-500">暂无已发布笔记，先发几篇再回来查架构符合度。</div>' : ''}
            </div>

            ${archAdvice.length ? `
            <div class="card">
                <div class="text-sm text-gray-400 mb-1 inline-flex items-center gap-2">
                    <span style="background:#10b981;color:#fff;border-radius:6px;padding:1px 8px;font-size:11px;">架构建议</span>
                    <span>根据最新导入的知识库给出的笔记架构建议</span>
                </div>
                <div class="space-y-2">
                    ${archAdvice.map(a => `
                        <div style="border-bottom:1px solid #1f2937;padding-bottom:10px;">
                            <div class="flex flex-wrap items-center gap-2">
                                <b class="text-sm" style="color:#10b981;">${escapeHtml(a['品类'] || '')}</b>
                                ${a['页数结构'] ? `<span class="text-xs" style="color:#3b82f6;">${escapeHtml(a['页数结构'])}</span>` : ''}
                            </div>
                            ${a['每页功能'] ? `<div class="text-sm text-gray-300 mt-1">${escapeHtml(a['每页功能'])}</div>` : ''}
                            ${a['依据'] ? `<div class="text-xs text-gray-500 mt-1" style="color:#6b7280;">依据：${escapeHtml(a['依据'])}</div>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>` : ''}

            <div class="card">
                <div class="text-sm text-gray-400 mb-3">📅 发笔记频率建议</div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    ${freq['建议频率'] ? `<div><div class="text-xs text-gray-500 mb-1">建议频率</div><div class="text-2xl font-bold" style="color:#ef4444;">${escapeHtml(freq['建议频率'])}</div></div>` : ''}
                    ${freq['最佳发布时段'] ? `<div><div class="text-xs text-gray-500 mb-1">最佳发布时段</div><div class="text-lg font-bold">${escapeHtml(freq['最佳发布时段'])}</div></div>` : ''}
                </div>
                ${freq['理由'] ? `<div class="mt-3 text-sm text-gray-400">· ${escapeHtml(freq['理由'])}</div>` : ''}
                ${freq['节奏提醒'] ? `<div class="mt-2 text-xs text-gray-500" style="color:#f59e0b;">⚠ ${escapeHtml(freq['节奏提醒'])}</div>` : ''}
            </div>

            <div class="card">
                <div class="text-sm text-gray-400 mb-3">🎯 选题建议 <span class="text-xs text-gray-600">（${topics.length} 个）</span></div>
                <div class="space-y-2">
                    ${topics.map(t => `
                        <div class="flex items-start gap-3" style="border-bottom:1px solid #1f2937;padding-bottom:10px;">
                            <span class="flex-none" style="width:4px;height:4px;margin-top:8px;background:${typeColor[t['类型']] || '#6b7280'};border-radius:999px;display:inline-block;"></span>
                            <div class="flex-1">
                                <div class="text-sm"><b>${escapeHtml(t['选题'] || '')}</b> <span class="text-xs" style="color:${typeColor[t['类型']] || '#6b7280'};">${escapeHtml(t['类型'] || '')}</span></div>
                                ${t['为什么'] ? `<div class="text-xs text-gray-500 mt-1">${escapeHtml(t['为什么'])}</div>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>

            ${planPhases.length ? `
            <div class="card">
                <div class="text-sm text-gray-400 mb-1">🗂 笔记规划（短期 → 中期 → 后期，分阶段）</div>
                ${d.sequence_logic ? `<div class="text-xs text-gray-500 mb-3" style="color:#10b981;">顺序逻辑：${escapeHtml(d.sequence_logic)}</div>` : '<div class="mb-3"></div>'}
                <div class="space-y-4">
                    ${planPhases.map((ph, pi) => `
                        <div>
                            <div class="flex items-center gap-2 mb-2">
                                <span style="background:${['#3b82f6', '#10b981', '#f59e0b'][pi % 3]};color:#fff;border-radius:6px;padding:2px 10px;font-size:12px;font-weight:700;">${escapeHtml(ph.phase || ('阶段' + (pi + 1)))}</span>
                                <b class="text-sm">${escapeHtml(ph.theme || '')}</b>
                                ${ph.timeline ? `<span class="text-xs" style="color:#6b7280;">${escapeHtml(ph.timeline)}</span>` : ''}
                            </div>
                            <div class="space-y-2">
                                ${(ph.notes || []).map((p, i) => `
                                    <div class="flex gap-3">
                                        <div class="flex-none" style="width:24px;height:24px;border-radius:6px;background:#1f2937;color:#d1d5db;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;">${i + 1}</div>
                                        <div class="flex-1">
                                            <div class="flex flex-wrap items-center gap-2">
                                                <b class="text-sm">${escapeHtml(p['选题'] || '')}</b>
                                                ${p['所属品类'] ? `<span class="text-xs" style="color:#8b5cf6;">${escapeHtml(p['所属品类'])}</span>` : ''}
                                                ${p['页数结构'] ? `<span class="text-xs" style="color:#3b82f6;">${escapeHtml(p['页数结构'])}</span>` : ''}
                                            </div>
                                            ${p['目的'] ? `<div class="text-xs text-gray-500 mt-1">目的：${escapeHtml(p['目的'])}</div>` : ''}
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>` : `
            <div class="card">
                <div class="text-sm text-gray-400 mb-1">🗂 笔记规划（先说什么、后说什么）</div>
                ${d.sequence_logic ? `<div class="text-xs text-gray-500 mb-3" style="color:#10b981;">顺序逻辑：${escapeHtml(d.sequence_logic)}</div>` : '<div class="mb-3"></div>'}
                <div class="space-y-3">
                    ${plan.map((p, i) => `
                        <div class="flex gap-3">
                            <div class="flex-none" style="width:28px;height:28px;border-radius:8px;background:#1f2937;color:#ef4444;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;">${i + 1}</div>
                            <div class="flex-1">
                                <div class="flex flex-wrap items-center gap-2">
<b class="text-sm">${escapeHtml(p['选题'] || '')}</b>
                                    <span class="text-xs" style="background:#111827;border:1px solid #374151;border-radius:999px;padding:0 8px;color:#9ca3af;">${escapeHtml(p['阶段'] || '')}</span>
                                    ${p['所属品类'] ? `<span class="text-xs" style="color:#8b5cf6;">${escapeHtml(p['所属品类'])}</span>` : ''}
                                    ${p['页数结构'] ? `<span class="text-xs" style="color:#3b82f6;">${escapeHtml(p['页数结构'])}</span>` : ''}
                                </div>
                                ${p['目的'] ? `<div class="text-xs text-gray-500 mt-1">目的：${escapeHtml(p['目的'])}</div>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>`}

        </div>
    `;
}

/* ═══════════ 导出 PDF：把诊断结果渲染成 A4 打印版，唤起浏览器「另存为 PDF」 ═══════════ */
function exportDiagnosisPdf() {
    const meta = window.__xhsDgData;
    const d = (meta && meta.data) || null;
    if (!d) { alert('还没有诊断结果，请先生成一次诊断。'); return; }

    const esc = (s) => escapeHtml(String(s == null ? '' : s));
    const arr = (a) => Array.isArray(a) ? a : [];
    const nl = (s) => esc(s).replace(/\r?\n/g, '<br>');

    const freq = d.frequency_advice || {};
    const topics = arr(d.topics);
    const plan = arr(d.plan).slice().sort((a, b) => (a.step || 0) - (b.step || 0));
    const arch = d.architecture || {};
    const archAdvice = arr(d.architecture_advice);

    // 各区块 HTML
    let html = '';

    // 笔记结构符合度
    html += `<section>
        <h2>一、笔记结构符合度（对应品类：${esc(arch.category || arch.product_type || '未判定')}）</h2>
        ${arch.matched ? `<p class="matched">${nl(arch.matched)}</p>` : ''}
        <div class="kv">
            <div><span>符合度</span><b>${arch.overall_score != null ? esc(arch.overall_score) + ' / 100' : '—'}</b></div>
            <div><span>等级</span><b>${esc(arch.level || '—')}</b></div>
        </div>
        ${arr(arch.notes_review).length ? `
            <table class="tbl">
                <tr><th style="width:34%">标题</th><th>像哪个品类 / 估计页数</th><th style="width:12%">是否达标</th><th>原因</th></tr>
                ${arr(arch.notes_review).map(r => `<tr>
                    <td>${esc(r.title)}</td>
                    <td>${esc(r.notes_type || '')}${r.estimate_pages ? '（约 ' + esc(r.estimate_pages) + '）' : ''}</td>
                    <td>${r.conforms ? '✓ 符合' : '✕ 不符'}</td>
                    <td>${esc(r.reason || '')}</td>
                </tr>`).join('')}
            </table>` : ''}
        ${arr(arch.gaps).length ? `<div class="block"><b>差距所在：</b>${arr(arch.gaps).map(g => esc(g)).join('；')}</div>` : ''}
        ${arch.advice ? `<div class="block advice"><b>改进建议：</b>${esc(arch.advice)}</div>` : ''}
    </section>`;

    // 笔记架构建议（基于最新知识库）
    if (archAdvice.length) {
        html += `<section>
        <h2>二、笔记架构建议（基于最新导入的知识库）</h2>
        ${archAdvice.map(a => `
            <div style="margin-bottom:8px;">
                <b>${esc(a['品类'] || '')}</b>${a['页数结构'] ? `<span style="color:#3b82f6;"> · ${esc(a['页数结构'])}</span>` : ''}
                ${a['每页功能'] ? `<div>${nl(a['每页功能'])}</div>` : ''}
                ${a['依据'] ? `<div class="matched">依据：${esc(a['依据'])}</div>` : ''}
            </div>`).join('')}
        </section>`;
    }

    // 频率建议
    html += `<section>
        <h2>${archAdvice.length ? '三' : '二'}、发笔记频率建议</h2>
        <div class="kv">
            ${freq['建议频率'] ? `<div><span>建议频率</span><b>${esc(freq['建议频率'])}</b></div>` : ''}
            ${freq['最佳发布时段'] ? `<div><span>最佳发布时段</span><b>${esc(freq['最佳发布时段'])}</b></div>` : ''}
        </div>
        ${freq['理由'] ? `<div class="block"><b>理由：</b>${nl(freq['理由'])}</div>` : ''}
        ${freq['节奏提醒'] ? `<div class="block warn"><b>节奏提醒：</b>${esc(freq['节奏提醒'])}</div>` : ''}
    </section>`;

    // 选题建议
    html += `<section>
        <h2>${archAdvice.length ? '四' : '三'}、选题建议（共 ${topics.length} 条）</h2>
        <table class="tbl">
            <tr><th style="width:8%">序号</th><th>选题</th><th style="width:18%">类型</th><th>为什么</th></tr>
            ${topics.map((t, i) => `<tr>
                <td>${i + 1}</td>
                <td>${esc(t['选题'])}</td>
                <td>${esc(t['类型'] || '')}</td>
                <td>${esc(t['为什么'] || '')}</td>
            </tr>`).join('')}
        </table>
    </section>`;

    // 笔记规划（分阶段）
    const planPhases = arr(d.plan_phases);
    const phaseColor = ['#3b82f6', '#10b981', '#f59e0b'];
    html += `<section>
        <h2>${archAdvice.length ? '五' : '四'}、笔记规划（短期 → 中期 → 后期）</h2>
        ${d.sequence_logic ? `<div class="block"><b>顺序逻辑：</b>${esc(d.sequence_logic)}</div>` : ''}
        ${planPhases.length ? planPhases.map((ph, pi) => `
            <div style="margin-top:12px;">
                <div style="font-weight:700;margin-bottom:6px;"><span style="display:inline-block;background:${phaseColor[pi % 3]};color:#fff;border-radius:6px;padding:2px 10px;font-size:12px;">${esc(ph.phase || ('阶段' + (pi + 1)))}</span>
                <span style="color:#111827;"> ${esc(ph.theme || '')}</span>
                ${ph.timeline ? `<span style="color:#6b7280;font-size:12px;"> ${esc(ph.timeline)}</span>` : ''}</div>
                <table class="tbl">
                    <tr><th style="width:6%">#</th><th style="width:40%">选题</th><th style="width:18%">所属品类</th><th style="width:22%">页数结构</th><th>目的</th></tr>
                    ${(ph.notes || []).map((p, i) => `<tr>
                        <td>${i + 1}</td>
                        <td>${esc(p['选题'] || '')}</td>
                        <td>${esc(p['所属品类'] || '')}</td>
                        <td>${esc(p['页数结构'] || '')}</td>
                        <td>${esc(p['目的'] || '')}</td>
                    </tr>`).join('')}
                </table>
            </div>`).join('') : `
            <table class="tbl">
                <tr><th style="width:6%">#</th><th>阶段</th><th style="width:24%">选题</th><th style="width:16%">所属品类</th><th style="width:22%">页数结构</th><th>目的</th></tr>
                ${plan.map((p, i) => `<tr>
                    <td>${i + 1}</td>
                    <td>${esc(p['阶段'] || '')}</td>
                    <td>${esc(p['选题'] || '')}</td>
                    <td>${esc(p['所属品类'] || '')}</td>
                    <td>${esc(p['页数结构'] || '')}</td>
                    <td>${esc(p['目的'] || '')}</td>
                </tr>`).join('')}
            </table>`}
    </section>`;

    const summary = [
        `${meta ? meta.stage : ''}`,
        `${meta && meta.frequency ? '期望频率：' + meta.frequency + ' · ' : ''}`,
        `${meta && meta.audience ? '人群：' + meta.audience : ''}`,
    ].filter(Boolean).join('　');

    const doc = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>账号诊断报告</title>
<style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; color:#111827; font-size:13px; line-height:1.7; padding:40px 46px; }
    header { border-bottom:3px solid #ef4444; padding-bottom:14px; margin-bottom:22px; }
    h1 { font-size:24px; color:#111827; }
    .meta { color:#6b7280; font-size:12px; margin-top:6px; }
    section { margin-bottom:24px; page-break-inside: avoid; }
    h2 { font-size:16px; color:#111827; margin-bottom:10px; padding-left:10px; border-left:4px solid #ef4444; }
    .kv { display:flex; gap:28px; margin:10px 0; }
    .kv span { color:#6b7280; font-size:12px; display:block; }
    .kv b { font-size:16px; color:#111827; }
    .block { margin:8px 0; color:#111827; }
    .block b { color:#111827; }
    .matched { color:#6b7280; font-size:12px; margin-bottom:8px; }
    .advice { color:#7c3aed; }
    .warn { color:#b45309; }
    .tbl { width:100%; border-collapse:collapse; margin-top:8px; }
    .tbl th, .tbl td { border:1px solid #e5e7eb; padding:6px 8px; text-align:left; vertical-align:top; word-break:break-word; }
    .tbl th { background:#f9fafb; color:#374151; font-weight:700; }
    .analysis { border:1px solid #f3d7dc; background:#fff5f6; border-radius:10px; padding:12px 14px; margin-bottom:20px; font-size:12.5px; }
    .analysis b { color:#c2233f; }
    .analysis .grid { display:grid; grid-template-columns:1fr 1fr; gap:4px 18px; margin-top:8px; }
    .analysis span { color:#5b5f66; }
    @media print { header img, .no-print { display:none; } .analysis { background:#fff5f6; } }
</style>
</head>
<body>
<header>
    <h1>小红书账号诊断报告</h1>
    <div class="meta">${esc(summary)}${meta && meta.at ? '　生成时间：' + esc(meta.at) : ''}</div>
</header>
<div class="analysis">
    <b>📌 本次诊断覆盖的分析点</b>
    <div class="grid">
        <span>① 发笔记频率：一周几篇、时段、节奏与理由</span>
        <span>② 选题建议：引流探饵 / 信任干货 / 转化成交</span>
        <span>③ 笔记规划：短期→中期→后期的分阶段安排</span>
        <span>④ 笔记架构建议：品类页数与每页功能（依据最新知识库）</span>
        <span>⑤ 笔记结构符合度：按品类逐篇检查已发笔记（可点开单篇）</span>
        <span>⑥ 分析对象：自己的账号 / 输入他人主页也可</span>
    </div>
</div>
${html}
</body>
</html>`;

    const win = window.open('', '_blank');
    if (!win) { alert('请允许浏览器弹出窗口后重试。'); return; }
    win.document.open();
    win.document.write(doc);
    win.document.close();
    win.focus();
    // 等渲染完再唤起打印，用户选择「另存为 PDF」即可保存
    setTimeout(() => { win.print(); }, 400);
}

/* ═══════════ 单篇笔记检查：点击某篇 → 抓正文 + AI 判断是否符合品类页数结构 ═══════════ */
function _dgReviewItems() {
    const resp = window.__xhsDgData && window.__xhsDgData.data;
    return (resp && resp.architecture && resp.architecture.review_items) || [];
}

async function checkThisNote(index) {
    const items = _dgReviewItems();
    const it = items[index] || {};
    if (!it.url) {
        toast(it.title ? `「${it.title}」没有可打开的链接，请在下方粘贴链接检查` : '该篇没有链接', 'error');
        const inp = document.getElementById('dg-check-url');
        if (inp && it.title) inp.value = it.title;
        return;
    }
    await openCheckNote(it.url, it.title || '');
}

async function checkThisUrl() {
    const inp = document.getElementById('dg-check-url');
    const url = (inp && inp.value || '').trim();
    if (!url) { toast('请粘贴一篇小红书笔记链接', 'error'); return; }
    await openCheckNote(url, '');
}

async function openCheckNote(url, title) {
    showDgModal(`
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
            <b style="color:#0ea5e9;">正在检查笔记…</b>
            <button onclick="window.closeDgModal()" style="background:none;border:none;color:#6b7280;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div style="color:#9ca3af;font-size:13px;">小🍠浏览器会在后台打开这篇笔记抓取内容，请稍候几秒…<br><span style="color:#6b7280;font-size:12px;">${escapeHtml(title || url)}</span></div>`);
    try {
        const res = await API.post('/diagnosis/check-note', { url: url, title: title || '' });
        renderCheckModal(res);
    } catch (e) {
        showDgModal(`
            <div style="color:#f87171;font-weight:700;margin-bottom:10px;">检查失败</div>
            <div style="color:#d1d5db;font-size:13px;">${escapeHtml(e.message)}</div>
            <div style="margin-top:14px;text-align:right;"><button onclick="window.closeDgModal()" style="background:#374151;color:#fff;border:none;border-radius:8px;padding:8px 18px;cursor:pointer;">关闭</button></div>`);
    }
}

function renderCheckModal(res) {
    const note = res.note || {};
    const c = res.check || {};
    const issues = Array.isArray(c.issues) ? c.issues : [];
    const suggested = Array.isArray(c.suggested_structure) ? c.suggested_structure : [];
    const scoreColor = c.level === '高' ? '#10b981' : (c.level === '中' ? '#f59e0b' : '#ef4444');
    const sc = (s) => escapeHtml(String(s == null ? '' : s));
    showDgModal(`
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <b style="font-size:15px;">逐篇结构检查</b>
            <button onclick="window.closeDgModal()" style="background:none;border:none;color:#6b7280;font-size:18px;cursor:pointer;">✕</button>
        </div>

        <div style="background:#111827;border:1px solid #1f2937;border-radius:8px;padding:10px;margin-bottom:12px;">
            <div style="font-size:14px;font-weight:700;">${sc(note.title || '(无标题)')}</div>
            ${note.author ? `<div style="color:#6b7280;font-size:12px;margin-top:2px;">@${sc(note.author)}</div>` : ''}
            ${note.url ? `<div style="margin-top:4px;"><a href="${sc(note.url)}" target="_blank" rel="noreferrer" style="color:#0ea5e9;font-size:12px;">打开原文 ↗</a></div>` : ''}
        </div>

        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
            <span style="background:#1f2937;border-radius:999px;padding:2px 10px;font-size:12px;color:#9ca3af;">品类：${sc(c.category || '—')}</span>
            <span style="background:#1f2937;border-radius:999px;padding:2px 10px;font-size:12px;color:#9ca3af;">当前约 ${sc(c.estimated_pages || '?')} 页</span>
            <span style="border-radius:999px;padding:2px 10px;font-size:12px;color:#fff;background:${scoreColor};">结构分 ${c.score != null ? sc(c.score) + '/100' : '—'}</span>
        </div>
        ${c.expected ? `<div style="color:#8b5cf6;font-size:12px;margin-bottom:10px;">应改为：${sc(c.expected)}</div>` : ''}

        ${note.content ? `<div style="background:#111827;border:1px solid #1f2937;border-radius:8px;padding:10px;max-height:150px;overflow:auto;font-size:12px;color:#d1d5db;white-space:pre-wrap;word-break:break-word;margin-bottom:12px;">${sc(note.content)}</div>` : ''}
        ${note.blocked ? `<div style="color:#f59e0b;font-size:12px;margin-bottom:10px;">⚠ 该笔记可能受访问限制，只取到了部分内容。</div>` : ''}

        ${issues.length ? `
            <div style="font-size:12px;color:#9ca3af;margin-bottom:4px;">差距所在</div>
            <div style="margin-bottom:12px;">${issues.map(g => `<div style="color:#ef4444;font-size:13px;">· ${sc(g)}</div>`).join('')}</div>` : ''}

        ${suggested.length ? `
            <div style="font-size:12px;color:#9ca3af;margin-bottom:4px;">建议页数结构（照这个重排）</div>
            <div style="margin-bottom:12px;">${suggested.map(s => `<div style="color:#10b981;font-size:13px;">· ${sc(s)}</div>`).join('')}</div>` : ''}

        ${c.advice ? `<div style="color:#8b5cf6;font-size:13px;border-top:1px solid #1f2937;padding-top:10px;">💡 改法：${sc(c.advice)}</div>` : ''}

        <div style="margin-top:14px;text-align:right;"><button onclick="window.closeDgModal()" style="background:#374151;color:#fff;border:none;border-radius:8px;padding:8px 18px;cursor:pointer;">关闭</button></div>`);
}

function showDgModal(innerHTML) {
    let mask = document.getElementById('dg-modal-mask');
    if (!mask) {
        mask = document.createElement('div');
        mask.id = 'dg-modal-mask';
        Object.assign(mask.style, { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' });
        mask.onclick = (e) => { if (e.target === mask) window.closeDgModal(); };
        document.body.appendChild(mask);
    }
    mask.innerHTML = `<div style="width:min(560px,96vw);max-height:86vh;overflow:auto;background:#151a24;border:1px solid #2a3342;border-radius:12px;padding:18px;color:#e5e7eb;">${innerHTML}</div>`;
}

function closeDgModal() {
    const mask = document.getElementById('dg-modal-mask');
    if (mask) mask.remove();
}

// 暴露给 inline onclick
window.checkThisNote = checkThisNote;
window.checkThisUrl = checkThisUrl;
window.openCheckNote = openCheckNote;
window.closeDgModal = closeDgModal;