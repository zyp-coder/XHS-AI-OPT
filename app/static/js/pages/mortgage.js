/* ============================================================
   房贷工具（以"方案"为中心）
   - 贷款计算 / 提前还款：算出即自动保存成"当前方案"；第二方案去"方案保存"另存
   - 省房贷（默认）：优先用"当前方案"生成消费/投资/省钱建议；无方案时给系统常规方案（标注模拟）
   ============================================================ */
const _STORAGE_KEY = 'xhs_mortgage_plans_v1';
let _mortgageRendered = false;
let _mortgageTab = 'save'; // save | loan | prepay | plans

/* 新用户没有任何方案时，省房贷给的系统常规方案（模拟） */
const _DEFAULT_PLAN = {
    name: '系统常规方案',
    loanWan: 100, rate: 3.60, years: 30, method: '等额本息',
    income: 20000, expense: 8000, note: '',
    simulated: true,
};

/* ---------- 持久化 ---------- */
function _loadPlans() {
    try {
        const raw = localStorage.getItem(_STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { current: null, library: [] };
}
function _savePlans(pl) {
    try { localStorage.setItem(_STORAGE_KEY, JSON.stringify(pl)); } catch (e) {}
}

/* 取"当前方案"；没有就落成默认常规方案（模拟），并提示 */
function _currentPlan() {
    const pl = _loadPlans();
    if (pl.current && pl.current.loanWan) {
        return { plan: pl.current, simulated: false };
    }
    return { plan: { ..._DEFAULT_PLAN, simulated: true }, simulated: true };
}

/* ---------- 贷款计算 ---------- */
function _pmt(principal, monthlyRate, n) {
    if (monthlyRate === 0) return principal / n;
    const p = Math.pow(1 + monthlyRate, n);
    return principal * monthlyRate * p / (p - 1);
}
function calLoan(amountWan, ratePct, years, method) {
    const P = amountWan * 10000;
    const r = ratePct / 100 / 12;
    const n = Math.round(years * 12);
    if (method === '等额本金') {
        const first = P / n + P * r;
        const ti = r * P * (n + 1) / 2;
        return { monthly: Math.round((P + ti) / n), firstMonth: Math.round(first), ti: Math.round(ti), total: Math.round(P + ti), type: '等额本金' };
    }
    const mo = _pmt(P, r, n);
    return { monthly: Math.round(mo), firstMonth: Math.round(mo), ti: Math.round(mo * n - P), total: Math.round(mo * n), type: '等额本息' };
}
function _pressureLevel(ratio) {
    if (!isFinite(ratio)) return { lv: '超出承受', color: '#ef4444' };
    if (ratio <= 0.20) return { lv: '非常轻松', color: '#10b981' };
    if (ratio <= 0.30) return { lv: '轻松', color: '#10b981' };
    if (ratio <= 0.40) return { lv: '适中偏紧', color: '#f59e0b' };
    if (ratio <= 0.50) return { lv: '压力较大', color: '#f97316' };
    return { lv: '超出承受', color: '#ef4444' };
}
function _money(x) { return '¥' + Math.round(x).toLocaleString('zh-CN'); }

/* ============================================================
   渲染：整体模态框
   ============================================================ */
function showMortgageProfile(tab) {
    if (!_mortgageRendered) { _mortgageRendered = true; _injectMortgageModal(); }
    _mortgageTab = tab || _mortgageTab || 'save';
    document.getElementById('mortgage-modal').style.display = 'flex';
    _renderMortgage();
}
function closeMortgageModal() {
    const m = document.getElementById('mortgage-modal');
    if (m) m.style.display = 'none';
}
function setMortgageTab(t) { _mortgageTab = t; _renderMortgage(); }

function _renderMortgage() {
    const tabs = [
        { id: 'save',  label: '💡 省房贷' },
        { id: 'loan',  label: '🧮 贷款计算' },
        { id: 'prepay',label: '↪ 提前还款' },
        { id: 'plans', label: '📁 方案保存' },
    ];
    document.getElementById('mortgage-tabs').innerHTML =
        tabs.map(t => `<button class="btn-sm btn-tab ${_mortgageTab === t.id ? 'active' : ''}" onclick="setMortgageTab('${t.id}')">${t.label}</button>`).join('');

    const body = document.getElementById('mortgage-body');
    const result = document.getElementById('mortgage-result');
    result.style.display = 'none';

    if (_mortgageTab === 'loan') { _renderLoanTab(body); }
    else if (_mortgageTab === 'prepay') { _renderPrepayTab(body); }
    else if (_mortgageTab === 'plans') { _renderPlansTab(body); }
    else { _renderSaveTab(body); }
}

/* ---------- Tab: 省房贷 ---------- */
function _renderSaveTab(body) {
    const { plan, simulated } = _currentPlan();
    const monthlyPay = calLoan(plan.loanWan, plan.rate, plan.years, plan.method).monthly;
    const income = plan.income || 0, expense = plan.expense || 0;
    const 结余 = income ? Math.round(income - expense - monthlyPay) : null;
    const 压力比 = income && (income - expense) > 0 ? monthlyPay / (income - expense) : null;
    const pressure = _pressureLevel(压力比);
    const keyAmount = 结余 !== null ? 结余 : monthlyPay;
    const L = calLoan(plan.loanWan, plan.rate, plan.years, plan.method);

    body.innerHTML = `
        ${simulated ? `
            <div style="background:rgba(246,196,83,0.10);border:1px solid rgba(246,196,83,0.35);color:#f6c453;border-radius:0.5rem;padding:0.6rem 0.85rem;font-size:0.8rem;margin-bottom:0.85rem;">
                🔔 当前为 <b>系统常规方案（模拟数据）</b>：贷款 ${plan.loanWan} 万 / 利率 ${plan.rate}% / ${plan.years} 年 / ${plan.method}，已直接帮你算好。下方已按此方案给出建议，可直接参考。
            </div>` : `
            <div style="background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.4);color:#10b981;border-radius:0.5rem;padding:0.6rem 0.85rem;font-size:0.8rem;margin-bottom:0.85rem;">
                ✅ 已使用你的自动保存方案：${plan.loanWan} 万 / 利率 ${plan.rate}% / ${plan.years} 年 / ${plan.method}
            </div>`}

        <!-- 关键结论金额（金色） -->
        <div class="profile-section" style="border:none;background:linear-gradient(135deg,rgba(246,196,83,0.10),rgba(17,24,39,0.7));text-align:center;margin-bottom:0.75rem;">
            <div style="font-size:0.78rem;color:#9ca3af;letter-spacing:0.05em;">每月可结余（可还 / 可投资关键金额 X）</div>
            <div class="gold-amount" style="font-size:2.6rem;line-height:1.1;margin:0.25rem 0;">${_money(keyAmount)}</div>
            <div style="font-size:0.75rem;color:#6b7280;">月供 ${_money(monthlyPay)} · 总利息 ${_money(L.ti)} · ${L.type}</div>
        </div>

        <div class="grid grid-cols-3 gap-2 mb-3" style="font-size:0.78rem;">
            <div class="profile-section" style="text-align:center;"><div style="color:#6b7280;">贷款期限</div><div class="font-medium">${plan.years} 年</div></div>
            <div class="profile-section" style="text-align:center;"><div style="color:#6b7280;">还款方式</div><div class="font-medium">${L.type}${L.type==='等额本金'?`<br><span style="color:#f97316;">首月 ${_money(L.firstMonth)}</span>`:''}</div></div>
            <div class="profile-section" style="text-align:center;"><div style="color:#6b7280;">压力等级</div><div class="font-medium" style="color:${pressure.color};">${pressure.lv}</div></div>
        </div>

        <div class="profile-section mb-2"><h5>💰 消费建议</h5><ul style="margin:0;padding-left:1rem;list-style:disc;">${_consumeTips(plan, income, expense, monthlyPay, 压力比, pressure, 结余).map(x=>`<li>${x}</li>`).join('')}</ul></div>
        <div class="profile-section mb-2"><h5>📈 投资建议</h5><ul style="margin:0;padding-left:1rem;list-style:disc;">${_investTips(plan, 结余).map(x=>`<li>${x}</li>`).join('')}</ul></div>
        ${_planSection(plan, L, monthlyPay)}
        <div style="text-align:right;margin-top:0.75rem;">
            <button class="btn-secondary btn-sm" onclick="setMortgageTab('loan')">想换成我的实际方案？点这里录入 →</button>
        </div>
    `;
}

function _consumeTips(plan, income, expense, monthlyPay, 压力比, pressure, 结余) {
    const tips = [];
    const 占 = 压力比 !== null ? Math.round(压力比 * 100) : null;
    if (占 !== null) {
        if (压力比 > 0.50) tips.push(`月供已占收入 ${占}%（${pressure.lv}），银行大概率拒贷。建议压低贷款额、提高首付或拉长年限，把月供控到收入 30% 以内（专家安全线）。`);
        else if (压力比 > 0.40) tips.push(`月供占收入 ${占}%，处于「压力较大」。建议优先降月供（商转公/延年限/改等额本金），月供占比压回 30% 更稳妥。`);
        else if (压力比 > 0.30) tips.push(`月供占收入 ${占}%，「适中偏紧」。建议日常消费收紧、坚持记账，先存下 3-6 个月家庭支出的应急金。`);
        else tips.push(`月供占收入 ${占}%，非常健康。可以把省下来的资金更多用于储蓄和投资。`);
    }
    if (income && expense && income < expense + monthlyPay) tips.push('每月收入不足以覆盖固定支出+月供，存在资金缺口，属高风险信号，建议先解决负现金流。');
    if (占 !== null && 占 <= 0.30) tips.push('参考分配：每月结余按「30% 生活消费 / 40% 稳健储蓄 / 30% 投资+提前还款」切分，先保生活再谈增值。');
    if (!tips.length) tips.push('请补充月收入/支出后，可获得更精确的消费预算建议。');
    return tips;
}
function _investTips(plan, 结余) {
    const tips = [];
    if (结余 !== null && 结余 > 0) {
        const annual = 0.05, m = annual / 12;
        const y10 = Math.round(结余 * ((Math.pow(1 + m, 120) - 1) / m));
        const y20 = Math.round(结余 * ((Math.pow(1 + m, 240) - 1) / m));
        tips.push(`每月 ${_money(结余)} 结余坚持定投、按估算年化 5% 复利——10 年后约 ${_money(y10)}，20 年后约 ${_money(y20)}（估算值）。`);
        tips.push('贷款仍在前 1/3「黄金期」内时，提前还款省息效率最高（每提前还 10 万、30 年利息约省 6.8 万）。建议结余按「提前还款 : 稳健投资 ≈ 4 : 6」分配。');
        if (plan.rate > 2.6) tips.push(`你的商贷利率（${plan.rate}%）高于公积金利率（首套 5 年以上约 2.60%）。满足缴存条件时优先「商转公」：以 80 万 25 年为例月供约可省 480 元/月、25 年合计省约 14.4 万利息。`);
    } else if (结余 !== null && 结余 <= 0) {
        tips.push('当前每月无结余，暂不建议投资。先调整月供结构（商转公/延长年限/改等额本金）释放现金流，再谈定投。');
    }
    if (!tips.length) tips.push('补充月收入后可获得投资建议。');
    return tips;
}
function _planSection(plan, L, monthlyPay) {
    if (plan.note && plan.note.trim()) {
        return `<div class="profile-section"><h5>💡 我的省钱方案</h5><p style="font-size:0.82rem;color:#d1d5db;white-space:pre-wrap;">${escapeHtml(plan.note)}</p></div>`;
    }
    const save1 = Math.round(monthlyPay * 0.10);
    const yearSave = save1 * 12;
    const payBack = Math.round(L.ti * 0.28);
    return `
        <div class="profile-section" style="border-color:rgba(246,196,83,0.45);">
            <h5>💡 系统模拟省钱方案 <span style="color:#9ca3af;font-weight:400;font-size:0.7rem;">（估算，未填方案时自动生成）</span></h5>
            <ol style="list-style:decimal;padding-left:1.1rem;margin:0 0 0.5rem;">
                <li>优先「商转公」：商贷利率 > 公积金利率（2.60%）时转贷，${plan.rate > 2.6 ? `按当前 ${plan.rate}% 测算，月供可降约${_money(save1)}、一年约省${_money(yearSave)}。` : `当前利率较低，此项可跳过。`}</li>
                <li>抓「提前还款黄金期」（贷款前 1/3）：将结余约 40% 提前还本金，还款周期内总利息约可省 <span class="gold-amount">${_money(payBack)}</span>。</li>
                <li>剩余 60% 结余做稳健定投，复利积累，兼顾流动性与增值。</li>
            </ol>
            <div style="font-size:0.75rem;color:#6b7280;">本方案由系统按通用房贷公式模拟，仅供测算参考。</div>
        </div>`;
}

/* ---------- Tab: 贷款计算（算出即自动保存方案） ---------- */
function _renderLoanTab(body) {
    const { plan } = _currentPlan();
    body.innerHTML = `
        <div class="grid grid-cols-2 gap-3">
            <div><label class="text-xs text-gray-400">贷款金额（万）</label><input id="ln-loan" type="number" class="input mt-1" value="${plan.loanWan || ''}"></div>
            <div><label class="text-xs text-gray-400">年利率（%）</label><input id="ln-rate" type="number" step="0.01" class="input mt-1" value="${plan.rate || ''}"></div>
            <div><label class="text-xs text-gray-400">贷款年限</label><input id="ln-years" type="number" class="input mt-1" value="${plan.years || ''}"></div>
            <div><label class="text-xs text-gray-400">还款方式</label>
                <select id="ln-method" class="input mt-1"><option>等额本息</option><option>等额本金</option></select></div>
            <div><label class="text-xs text-gray-400">月收入（元）</label><input id="ln-income" type="number" class="input mt-1" value="${plan.income || ''}"></div>
            <div><label class="text-xs text-gray-400">每月固定支出（元）</label><input id="ln-expense" type="number" class="input mt-1" value="${plan.expense || ''}"></div>
        </div>
        <div style="text-align:right;margin-top:0.85rem;">
            <button class="btn-primary btn-sm" onclick="doLoanCalc()">🧮 计算并自动保存方案</button>
        </div>
        <div id="loan-result" class="profile-section mt-3" style="display:none;"></div>
    `;
    const sel = body.querySelector('#ln-method');
    if (sel) sel.value = plan.method || '等额本息';
}
function doLoanCalc() {
    const input = {
        loanWan: parseFloat(document.getElementById('ln-loan')?.value) || 0,
        rate: parseFloat(document.getElementById('ln-rate')?.value) || 0,
        years: parseInt(document.getElementById('ln-years')?.value) || 0,
        method: document.getElementById('ln-method')?.value || '等额本息',
        income: parseFloat(document.getElementById('ln-income')?.value) || 0,
        expense: parseFloat(document.getElementById('ln-expense')?.value) || 0,
    };
    if (!input.loanWan || !input.rate || !input.years) { toast('请填写贷款金额、利率和年限', 'error'); return; }

    // 自动保存为当前方案
    const pl = _loadPlans();
    pl.current = { ...input, note: (pl.current && pl.current.note) || '', simulated: false, updatedAt: Date.now() };
    _savePlans(pl);

    const L = calLoan(input.loanWan, input.rate, input.years, input.method);
    const 压力比 = (input.income && (input.income - input.expense) > 0) ? L.monthly / (input.income - input.expense) : null;
    const pressure = _pressureLevel(压力比);
    const box = document.getElementById('loan-result');
    box.innerHTML = `
        <div style="color:#10b981;font-size:0.8rem;margin-bottom:0.6rem;">✅ 已自动保存为你的当前方案（去「📁 方案保存」可另存为新方案）</div>
        <div class="grid grid-cols-3 gap-2" style="font-size:0.8rem;">
            <div style="text-align:center;"><div style="color:#6b7280;">月供</div><div class="gold-amount" style="font-size:1.4rem;">${_money(L.monthly)}</div></div>
            <div style="text-align:center;"><div style="color:#6b7280;">总利息</div><div class="gold-amount" style="font-size:1.4rem;">${_money(L.ti)}</div></div>
            <div style="text-align:center;"><div style="color:#6b7280;">压力等级</div><div style="color:${pressure.color};font-size:1.1rem;font-weight:700;">${pressure.lv}</div></div>
        </div>
        <div style="font-size:0.75rem;color:#6b7280;text-align:center;margin-top:0.4rem;">${L.type} · 首月 ${_money(L.firstMonth)} · 总还款 ${_money(L.total)}</div>
        <div style="text-align:right;margin-top:0.5rem;"><button class="btn-secondary btn-sm" onclick="setMortgageTab('save')">去省房贷看建议 →</button></div>
    `;
    box.style.display = 'block';
    toast('方案已自动保存');
}

/* ---------- Tab: 提前还款（算出即自动保存方案） ---------- */
function _renderPrepayTab(body) {
    const { plan } = _currentPlan();
    const remWan = (plan.loanWan || 100);
    body.innerHTML = `
        <div class="grid grid-cols-2 gap-3">
            <div><label class="text-xs text-gray-400">剩余本金（万）</label><input id="pp-rem" type="number" class="input mt-1" value="${remWan}"></div>
            <div><label class="text-xs text-gray-400">年利率（%）</label><input id="pp-rate" type="number" step="0.01" class="input mt-1" value="${plan.rate || ''}"></div>
            <div><label class="text-xs text-gray-400">已还月数</label><input id="pp-paid" type="number" class="input mt-1" value="60"></div>
            <div><label class="text-xs text-gray-400">剩余年限</label><input id="pp-left-years" type="number" class="input mt-1" value="25"></div>
            <div><label class="text-xs text-gray-400">拟提前还款（万）</label><input id="pp-amt" type="number" class="input mt-1" value="10"></div>
            <div><label class="text-xs text-gray-400">方式</label>
                <select id="pp-method" class="input mt-1"><option>缩短年限</option><option>减少月供</option></select></div>
        </div>
        <div style="text-align:right;margin-top:0.85rem;">
            <button class="btn-primary btn-sm" onclick="doPrepayCalc()">↪ 计算并自动保存方案</button>
        </div>
        <div id="pp-result" class="profile-section mt-3" style="display:none;"></div>
    `;
}
function calPrepay(remWan, ratePct, paidMonths, leftYears, amtWan) {
    const R = remWan * 10000;             // 剩余本金
    const r = ratePct / 100 / 12;          // 月利率
    const n = leftYears * 12;              // 剩余期数
    const p = _pmt(R, r, n);               // 原月供
    const A = amtWan * 10000;              // 提前还款额
    // 原剩余总利息
    const oldInterest = p * n - R;
    // 缩期：月供不变、期数变短
    let newN = n;
    {   let lo = 1, hi = n;
        const cur = p;
        while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            if (cur * mid - (R - A) >= 0) { newN = mid; hi = mid - 1; } else { lo = mid + 1; }
        }
    }
    const shortInterest = Math.max(0, newN * p - (R - A));
    // 减月供：期数不变、月供变
    const newMonthly = _pmt(R - A, r, n);
    const reduceInterest = newMonthly * n - (R - A);

    const 已还占比 = paidMonths / (paidMonths + n);
    const 时期 = 已还占比 <= 1 / 3 ? '黄金期' : (已还占比 <= 1 / 2 ? '中段' : '末期');

    return {
        period: 时期, oldMonthly: Math.round(p),
        newMonthly: Math.round(newMonthly),
        shortY: Math.round((n - newN) / 12 * 10) / 10,
        saveShort: Math.round(oldInterest - shortInterest),
        saveReduce: Math.round(oldInterest - reduceInterest),
        shortInterest: Math.round(shortInterest), reduceInterest: Math.round(reduceInterest),
    };
}
function doPrepayCalc() {
    const input = {
        rem: parseFloat(document.getElementById('pp-rem')?.value) || 0,
        rate: parseFloat(document.getElementById('pp-rate')?.value) || 0,
        paid: parseInt(document.getElementById('pp-paid')?.value) || 0,
        leftYears: parseInt(document.getElementById('pp-left-years')?.value) || 0,
        amt: parseFloat(document.getElementById('pp-amt')?.value) || 0,
        method: document.getElementById('pp-method')?.value || '缩短年限',
    };
    if (!input.rem || !input.rate || !input.leftYears || !input.amt) { toast('请填写剩余本金、利率、剩余年限和提前还款金额', 'error'); return; }

    // 自动保存：把提前还款设定并入当前方案
    const pl = _loadPlans();
    pl.current = { ...(pl.current || {}), ...input, simulated: false, updatedAt: Date.now() };
    _savePlans(pl);

    const R = calPrepay(input.rem, input.rate, input.paid, input.leftYears, input.amt);
    const box = document.getElementById('pp-result');
    box.innerHTML = `
        <div style="color:#10b981;font-size:0.8rem;margin-bottom:0.6rem;">✅ 已自动保存为你的当前方案（去「📁 方案保存」可另存为新方案）</div>
        <div style="font-size:0.82rem;color:#f6c453;margin-bottom:0.6rem;">你现在处于提前还款 <b>${R.period}</b>${R.period==='末期'?'，提前还款省息意义已不大':''}</div>
        <div class="grid grid-cols-2 gap-2" style="font-size:0.8rem;">
            <div class="profile-section" style="text-align:center;"><div style="color:#6b7280;">缩期：共省息</div><div class="gold-amount" style="font-size:1.5rem;">${_money(R.saveShort)}</div><div style="font-size:0.75rem;color:#6b7280;">期限缩短 ${R.shortY} 年</div></div>
            <div class="profile-section" style="text-align:center;"><div style="color:#6b7280;">减月供：共省息</div><div class="gold-amount" style="font-size:1.5rem;">${_money(R.saveReduce)}</div><div style="font-size:0.75rem;color:#6b7280;">月供 ${_money(R.oldMonthly)}→${_money(R.newMonthly)}</div></div>
        </div>
        <div style="font-size:0.75rem;color:#6b7280;margin-top:0.4rem;">${input.method === '缩短年限' ? '你选了「缩短年限」：月供不变、总期数变短，省息最多。' : '你选了「减少月供」：期数不变、月供下降，月供压力更小。'}收入稳定选缩期、月供压力大选减月供。</div>
        <div style="text-align:right;margin-top:0.5rem;"><button class="btn-secondary btn-sm" onclick="setMortgageTab('save')">去省房贷看建议 →</button></div>
    `;
    box.style.display = 'block';
    toast('方案已自动保存');
}

/* ---------- Tab: 方案保存 ---------- */
function _renderPlansTab(body) {
    const pl = _loadPlans();
    const cur = pl.current;
    body.innerHTML = `
        <div class="profile-section mb-2">
            <h5>📌 当前自动方案</h5>
            ${cur && cur.loanWan ? `
                <div style="font-size:0.82rem;color:#d1d5db;">${cur.loanWan} 万 / 利率 ${cur.rate}% / ${cur.years} 年 / ${cur.method}<br>
                <span style="color:#6b7280;">收入 ${_money(cur.income||0)} · 支出 ${_money(cur.expense||0)}${cur.rem?' · 已测算提前还款 '+cur.rem+' 万':''}</span></div>
                <div style="margin-top:0.5rem;display:flex;gap:0.5rem;align-items:center;">
                    <input id="nw-name" class="input" placeholder="给方案起个名，如：方案一">
                    <button class="btn-primary btn-sm" onclick="saveCurrentAsNew()">＋ 另存为新方案</button>
                </div>` : `<div style="font-size:0.82rem;color:#6b7280;">还没有自动保存的方案，先去「🧮 贷款计算」或「↪ 提前还款」计算一次。</div>`}
        </div>
        <div class="profile-section">
            <h5>📁 已保存的方案（${pl.library.length}）</h5>
            ${pl.library.length ? pl.library.map((s, i) => `
                <div class="flex items-center justify-between" style="border-bottom:1px solid #1f2937;padding:0.5rem 0;">
                    <div style="min-width:0;">
                        <div style="font-size:0.85rem;">${escapeHtml(s.name || '未命名方案')}</div>
                        <div style="font-size:0.75rem;color:#6b7280;">${s.data.loanWan} 万 / ${s.data.rate}% / ${s.data.years} 年 / ${s.data.method} · 收入${_money(s.data.income||0)}</div>
                    </div>
                    <div class="flex gap-1 flex-shrink-0 ml-3">
                        <button class="btn-secondary btn-sm" onclick="applyPlan(${i})">应用</button>
                        <button class="btn-danger btn-sm" onclick="deletePlan(${i})">删除</button>
                    </div>
                </div>`).join('') : `<div style="font-size:0.82rem;color:#6b7280;">暂无已保存方案。</div>`}
        </div>
    `;
}
function saveCurrentAsNew() {
    const pl = _loadPlans();
    if (!pl.current || !pl.current.loanWan) { toast('当前没有可保存的方案', 'error'); return; }
    const name = (document.getElementById('nw-name')?.value || '').trim() || `方案${pl.library.length + 1}`;
    pl.library.push({ name, data: { ...pl.current }, savedAt: Date.now() });
    _savePlans(pl);
    toast('已另存为新方案');
    _renderMortgage();
}
function applyPlan(i) {
    const pl = _loadPlans();
    if (!pl.library[i]) return;
    const applied = { ...pl.library[i].data, simulated: false, updatedAt: Date.now() };
    pl.library[i] = { ...pl.library[i], data: applied };
    pl.current = applied;
    _savePlans(pl);
    toast('已应用该方案');
    setMortgageTab('save');
}
function deletePlan(i) {
    const pl = _loadPlans();
    if (!pl.library[i]) return;
    if (!confirm(`删除方案「${pl.library[i].name}」？`)) return;
    pl.library.splice(i, 1);
    _savePlans(pl);
    _renderMortgage();
}

/* ============================================================
   注入模态框
   ============================================================ */
function _injectMortgageModal() {
    const host = document.getElementById('page-content');
    if (!host) return;
    const div = document.createElement('div');
    div.id = 'mortgage-modal';
    div.className = 'modal-overlay';
    div.style.display = 'none';
    div.onclick = function (e) { if (e.target === this) closeMortgageModal(); };
    div.innerHTML = `
        <div class="modal max-w-2xl" style="max-height:92vh;overflow-y:auto;">
            <h3 class="text-lg font-medium mb-3">🏠 房贷工具</h3>
            <div id="mortgage-tabs" class="flex gap-2 mb-3" style="flex-wrap:wrap;"></div>
            <div id="mortgage-body"></div>
            <div id="mortgage-result" class="mt-4"></div>
            <div class="flex justify-end gap-2 mt-4">
                <button onclick="closeMortgageModal()" class="btn-secondary btn-sm">关闭</button>
            </div>
        </div>
    `;
    host.appendChild(div);
}