/**
 * auto-water-ui.js — 一键灌水 Popup 面板 UI 逻辑
 * 在 popup.html 中加载，管理灌水面板的交互
 */
(function () {
  const panel = document.getElementById('autoWaterPanel');
  const toggleBtn = document.getElementById('autoWaterToggle');
  const btnGroup = document.getElementById('awBtnGroup');
  const statusEl = document.getElementById('awStatus');
  const queueEl = document.getElementById('awQueue');
  const logEl = document.getElementById('awLog');

  if (!panel || !toggleBtn) return;

  let pollTimer = null;
  let panelVisible = false;

  // 切换面板显示
  toggleBtn.addEventListener('click', () => {
    panelVisible = !panelVisible;
    panel.classList.toggle('active', panelVisible);
    toggleBtn.style.background = panelVisible ? '#059669' : '#fff';
    toggleBtn.style.color = panelVisible ? '#fff' : '#059669';
    if (panelVisible) {
      refreshStatus();
      startPolling();
    } else {
      stopPolling();
    }
  });

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(refreshStatus, 2000);
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  async function refreshStatus() {
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'getAutoWaterStatus' });
      if (!resp || !resp.ok) {
        // 可能 service worker 还没加载 auto-water
        renderButtons({ phase: 'IDLE', licensed: false });
        return;
      }
      const status = { ...resp };
      renderButtons(status);
      renderStatus(status);
      renderQueue(status);
      renderLog(status);
    } catch (e) {
      renderButtons({ phase: 'IDLE', licensed: false });
    }
  }

  function renderButtons(status) {
    const { phase, licensed } = status;
    btnGroup.innerHTML = '';

    if (!licensed) {
      const tip = document.createElement('span');
      tip.style.cssText = 'font-size:12px;color:#dc2626;';
      tip.textContent = '请先在设置中激活会员密钥';
      btnGroup.appendChild(tip);
      return;
    }

    if (phase === 'IDLE' || phase === 'COMPLETED' || phase === 'STOPPED' || phase === 'ERROR') {
      const startBtn = mkBtn('▶ 开始灌水', 'aw-btn-start', () => sendCmd('startAutoWater'));
      btnGroup.appendChild(startBtn);
    }

    if (phase === 'SEARCHING' || phase === 'SCREENING' || phase === 'WATERING' || phase === 'WAITING') {
      const pauseBtn = mkBtn('⏸ 暂停', 'aw-btn-pause', () => sendCmd('pauseAutoWater'));
      const stopBtn = mkBtn('⏹ 停止', 'aw-btn-stop', () => sendCmd('stopAutoWater'));
      btnGroup.appendChild(pauseBtn);
      btnGroup.appendChild(stopBtn);
    }

    if (phase === 'PAUSED') {
      const resumeBtn = mkBtn('▶ 继续', 'aw-btn-start', () => sendCmd('resumeAutoWater'));
      const stopBtn = mkBtn('⏹ 停止', 'aw-btn-stop', () => sendCmd('stopAutoWater'));
      btnGroup.appendChild(resumeBtn);
      btnGroup.appendChild(stopBtn);
    }
  }

  function renderStatus(status) {
    const { phase, licensed, todayCount, dailyMax, currentKeywordIdx, keywords, totalWatered, totalSkipped, nextActionAt, completeReason } = status;

    if (!licensed) {
      statusEl.style.display = 'block';
      statusEl.textContent = '🔒 会员功能未激活，请在设置中输入密钥';
      return;
    }

    const phaseNames = {
      IDLE: '空闲',
      SEARCHING: '搜索中...',
      SCREENING: 'AI 筛选中...',
      WATERING: '灌水中...',
      WAITING: '等待中...',
      PAUSED: '已暂停',
      COMPLETED: '已完成',
      STOPPED: '已停止',
      ERROR: '出错',
    };

    let text = `状态: ${phaseNames[phase] || phase}`;
    text += ` | 今日: ${todayCount || 0}/${dailyMax || 20} 篇`;
    if (totalWatered) text += ` | 成功: ${totalWatered}`;
    if (totalSkipped) text += ` | 跳过: ${totalSkipped}`;

    if (phase === 'SEARCHING' && keywords && keywords[currentKeywordIdx]) {
      text += ` | 关键词: ${keywords[currentKeywordIdx]}`;
    }

    if (phase === 'WAITING' && nextActionAt) {
      const remain = Math.max(0, Math.round((nextActionAt - Date.now()) / 1000));
      text += ` | ${remain}秒后继续`;
    }

    if (phase === 'COMPLETED' && completeReason) {
      text += ` | ${completeReason}`;
    }

    if (phase === 'ERROR' && status.error) {
      text += ` | 错误: ${status.error}`;
    }

    statusEl.style.display = 'block';
    statusEl.style.color = (phase === 'ERROR') ? '#dc2626' : '#333';
    statusEl.textContent = text;
  }

  function renderQueue(status) {
    if (!status.queue || status.queue.length === 0) {
      queueEl.innerHTML = '';
      return;
    }

    const items = status.queue.map((item, i) => {
      const done = i < status.currentIndex;
      const current = i === status.currentIndex;
      const icon = done ? '✅' : current ? '👉' : '⏳';
      const style = done ? 'opacity:0.5;' : current ? 'border-color:#059669;background:#ecfdf5;' : '';
      return `<div class="aw-queue-item" style="${style}">
        <span>${icon} ${escHtml((item.title || '').slice(0, 25))}</span>
        <span style="color:#999;font-size:10px;">${item.reason || ''}</span>
      </div>`;
    });
    queueEl.innerHTML = items.join('');
  }

  function renderLog(status) {
    if (!status.logs || status.logs.length === 0) {
      logEl.innerHTML = '<div style="color:#999;">暂无日志</div>';
      return;
    }
    logEl.innerHTML = status.logs.slice(-20).reverse().map(l => `<div>${escHtml(l)}</div>`).join('');
  }

  function mkBtn(text, cls, onClick) {
    const btn = document.createElement('button');
    btn.className = cls;
    btn.textContent = text;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await onClick();
      btn.disabled = false;
      refreshStatus();
    });
    return btn;
  }

  async function sendCmd(action) {
    try {
      const resp = await chrome.runtime.sendMessage({ action });
      if (resp && !resp.ok) {
        // 显示错误到状态栏
        statusEl.style.display = 'block';
        statusEl.textContent = '❌ ' + (resp.error || '操作失败');
        statusEl.style.color = '#dc2626';
      }
    } catch (e) {
      console.error('[一键灌水]', action, e);
      statusEl.style.display = 'block';
      statusEl.textContent = '❌ 发送消息失败: ' + e.message;
      statusEl.style.color = '#dc2626';
    }
  }

  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }
})();
