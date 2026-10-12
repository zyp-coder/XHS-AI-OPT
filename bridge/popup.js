/* 手机桥 · 弹窗：配对二维码 + 三行状态 + 两个设置
   发消息给 background.js 做实际动作（配对登记 / 解绑 / 上报），这里只管显示。 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const send = (action, extra) => new Promise((resolve) => {
    chrome.runtime.sendMessage(Object.assign({ action }, extra || {}), (r) => {
      resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : (r || {}));
    });
  });
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ago = (ms) => {
    if (!ms) return '还没上报过';
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    return s < 60 ? (s + ' 秒前') : (s < 3600 ? (Math.round(s / 60) + ' 分钟前') : (Math.round(s / 3600) + ' 小时前'));
  };
  let pair = null, ttlTimer = null;

  /* 二维码画到 canvas：四周留 4 个模块的静区（少了手机扫不出来） */
  function drawQR(url) {
    const cv = $('qr');
    let qr;
    try { qr = QR.encode(url); }
    catch (e) { $('urlLine').innerHTML = '链接太长，画不了二维码：' + esc(e.message); return false; }
    const quiet = 4, total = qr.size + quiet * 2;
    const scale = Math.max(2, Math.floor(cv.width / total));
    const side = total * scale;
    cv.width = side; cv.height = side;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, side, side);
    g.fillStyle = '#141414';
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (qr.get(x, y)) g.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
      }
    }
    return true;
  }

  function paintTtl() {
    if (!pair || !pair.codeAt) return;
    const left = Math.max(0, 10 * 60 * 1000 - (Date.now() - pair.codeAt));
    const mm = Math.floor(left / 60000), ss = Math.floor((left % 60000) / 1000);
    const el = $('ttlLine');
    if (!left) {
      el.className = 'tip warn';
      el.textContent = '这张码已经过期了，点「重新生成」再来一张。';
    } else {
      el.className = 'tip';
      el.textContent = '这张码 ' + mm + ':' + String(ss).padStart(2, '0') + ' 内有效，扫一次就作废。';
    }
  }

  function showPair(p, viaLan) {
    pair = p;
    $('qrWrap').classList.remove('hidden');
    $('codeLine').classList.remove('hidden');
    $('urlLine').classList.remove('hidden');
    $('ttlLine').classList.remove('hidden');
    $('pairHint').classList.add('hidden');
    $('btnPair').classList.add('hidden');
    $('btnRebind').classList.remove('hidden');
    $('btnUnbind').classList.remove('hidden');
    $('codeLine').textContent = p.code;
    $('urlLine').innerHTML = '手机打开：<b>' + esc(p.url) + '</b>' +
      (viaLan ? '<br>（这是电脑的局域网地址，手机要和电脑连同一个 Wi-Fi）'
        : '<br>（用的是中转地址本身；手机上不去就说明中转没部署到外网）');
    if (drawQR(p.url) === false) $('qrWrap').classList.add('hidden');
    paintTtl();
    if (ttlTimer) clearInterval(ttlTimer);
    ttlTimer = setInterval(paintTtl, 1000);
  }

  function hidePair() {
    pair = null;
    ['qrWrap', 'codeLine', 'urlLine', 'ttlLine'].forEach((id) => $(id).classList.add('hidden'));
    $('pairHint').classList.remove('hidden');
    $('pairHint').className = 'tip';
    $('pairHint').textContent = '手机和电脑连同一个 Wi-Fi，用手机扫下面的码就能看队列。';
    $('btnPair').classList.remove('hidden');
    $('btnRebind').classList.add('hidden');
    $('btnUnbind').classList.add('hidden');
    if (ttlTimer) clearInterval(ttlTimer);
  }

  async function refresh() {
    const s = await send('bridgeStatus');
    if (!s.ok) return;
    /* 正在输入的那个框不碰：15 秒一次的自动刷新别把用户敲一半的字抹掉 */
    const setIfNotFocused = (id, val) => { const el = $(id); if (document.activeElement !== el) el.value = val; };
    setIfNotFocused('baseIn', s.base || '');
    setIfNotFocused('nameIn', s.name || '这台电脑');
    setIfNotFocused('mainIdIn', s.mainIdManual || '');
    $('relayLine').innerHTML = s.relay.ok
      ? '<span class="dot on"></span>通了（v' + esc(s.relay.ver || '') + '，' + (s.relay.lan && s.relay.lan.length ? '局域网可直连' : '公网地址') + '）'
      : '<span class="dot err"></span>连不上：' + esc(s.base);
    $('mainLine').innerHTML = s.main
      ? '<span class="dot on"></span>' + esc(s.main.name || '主扩展') + (s.main.ver ? ' v' + esc(s.main.ver) : '') + (s.main.auto ? '' : '（手填的 ID）')
      : '<span class="dot err"></span>没找到（先装并启用「小红书评论助手」）';
    $('lastLine').innerHTML = s.last
      ? esc(ago(s.last.at)) + (s.last.ok ? (s.last.err ? '<span style="color:#d97706;">　' + esc(s.last.err) + '</span>' : '　<span style="color:#0a8f4c;">正常</span>') : '<span style="color:#dc2626;">　' + esc(s.last.err || '上报失败') + '</span>')
      : '还没上报过';
    if (s.paired && s.pair) {
      showPair(Object.assign({}, s.pair, { codeAt: 0 }), /\/\/(192\.168\.|10\.)/.test(s.pair.url || ''));
      $('ttlLine').classList.add('hidden');   // 已配好的这份只是留个码备用，不再显示倒计时
    } else {
      hidePair();
    }
  }

  $('btnPair').onclick = async () => {
    $('pairHint').className = 'tip';
    $('pairHint').textContent = '正在向中转要一张配对码…';
    const r = await send('bridgePairNew');
    if (!r.ok) {
      $('pairHint').className = 'tip err';
      $('pairHint').textContent = r.error || '没拿到配对码';
      return;
    }
    showPair(r.pair, r.lan);
    if (!r.lan) {
      $('pairHint').className = 'tip warn';
    }
  };
  $('btnRebind').onclick = () => $('btnPair').onclick();
  $('btnUnbind').onclick = async () => {
    if (!confirm('解绑后这台手机就看不到电脑了，要重新扫码。')) return;
    const r = await send('bridgeUnbind');
    if (!r.ok) { alert(r.error || '解绑失败'); return; }
    hidePair();
    refresh();
  };
  $('btnPush').onclick = async () => {
    $('saveTip').textContent = '正在上报…';
    const r = await send('bridgePushNow');
    $('saveTip').textContent = r.ok ? '已上报。' : ('上报失败：' + (r.err || r.error || ''));
    refresh();
  };
  /* 换成云中转时要把该网址的访问权要下来（manifest 里只写了本机版；
     必须在这一下点击里问，交给后台代问会丢用户手势 → 浏览器直接拒） */
  async function ensureOrigin(base) {
    if (!/^https?:\/\//i.test(base)) return true;   // 格式不对就交给后台去报错，这里不抢话说
    let origin;
    try { origin = new URL(base).origin + '/*'; } catch (_) { return true; }
    try { return !!(await chrome.permissions.request({ origins: [origin] })); }
    catch (_) { return true; }   // 环境没有 permissions（开发预览桩）→ 不挡保存
  }

  $('btnSave').onclick = async () => {
    const want = ($('baseIn').value || '').trim();
    const permOk = await ensureOrigin(want);
    const a = await send('bridgeSetName', { name: $('nameIn').value });
    const b = permOk ? await send('bridgeSetRelay', { base: want })
      : { ok: false, error: '没拿到 ' + want + ' 的访问权（浏览器弹的确认框里点了拒绝？）' };
    const c = await send('bridgeSetMainId', { mainId: $('mainIdIn').value });
    const bits = [];
    if (a.ok) bits.push('叫「' + a.name + '」');
    bits.push(b.ok ? '中转 ' + b.base : (b.error || '中转地址没保存'));
    if (!c.ok) bits.push(c.error || '主扩展 ID 没保存');
    else if (c.mainId) bits.push('主扩展认到了');
    $('saveTip').textContent = bits.join('　');
    refresh();
  };

  refresh();
  setInterval(refresh, 15000);   // 弹窗开着时自己刷新状态
})();
