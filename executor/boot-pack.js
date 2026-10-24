/* 首屏提速·按页分包（扩展页禁内联脚本，这一段从 popup.html 里拎成文件）：
   ① 获客那三个文件（截流／灌水／机器人）＝你的主线，进门就和引擎文件一起下载，不再排队等；
   ② 诊断&配置、线索列表这些大块拆成独立文件，你点开那一页才下载；
   要用到已拆出去的那页，走 popup.js 里的 wbGate('包名', 干活的函数)——文件到了再画。 */
(function () {
  var FILES = {
    huoke: ['lib/scenario-drain.js', 'auto-water-app.js', 'auto-bot.js'],
    diag: ['lib/pg-diag.js'],
    state: ['lib/pg-state.js']
  };
  var LABEL = { diag: '诊断&配置', state: '线索列表' };
  var packs = {};
  function makePack(name) {
    var p = { files: FILES[name], done: [], failed: false, started: false, chain: null };
    p.go = function () {
      if (p.chain) return p.chain;
      p.started = true;
      p.chain = p.files.reduce(function (prev, src) {
        return prev.then(function () {
          return new Promise(function (res) {
            var s = document.createElement('script');
            s.src = src;
            s.onload = function () { p.done.push(src); res(); };
            s.onerror = function () { p.failed = true; p.done.push('缺 ' + src); res(); };
            document.body.appendChild(s);
          });
        });
      }, Promise.resolve());
      return p.chain;
    };
    packs[name] = p;
    return p;
  }
  Object.keys(FILES).forEach(function (n) { makePack(n); });

  window.__wbPacks = packs;
  window.__wbLabel = LABEL;
  var huoke = packs.huoke;
  window.__wbLazy = { wait: function () { return huoke.go(); }, failed: function () { return huoke.failed; }, done: huoke.done };
  huoke.go();   // 获客＝主线：进门就在后台下

  /* 兜底收罩：正常路径是 popup.js 画完第一屏自己调 __wbLoadHide()；
     这里垫一道——真到了 DOMContentLoaded 也收（万一 popup.js 半路炸了，别把罩子永久扣在页面上）。 */
  if (document.readyState !== 'loading') { window.__wbLoadHide && window.__wbLoadHide(); }
  else { document.addEventListener('DOMContentLoaded', function () { setTimeout(function () { window.__wbLoadHide && window.__wbLoadHide(); }, 60); }, { once: true }); }
})();
/* 首屏加载罩·进度：按「下完几个文件」计。
   注意 Chrome 的 performance 只在文件下载完那一刻才给出字节数（responseEnd 才填），
   所以不能拿它显示"已下多少 MB"——中途会一直冻在 2%%。改成数完成的文件数，条子会一格一格真走。 */
(function () {
  var ov = document.getElementById('wbLoadOverlay');
  if (!ov) return;
  var bar = ov.querySelector('.wb-load-bar i');
  var pct = ov.querySelector('.wb-load-pct');
  var t2 = ov.querySelector('.wb-load-t2');
  var HREFS = ['theme.js', 'lib/icons.js', 'lib/crypto-box.js', 'lib/data-privacy.js',
    'lib/delay-presets.js', 'lib/ai-providers.js', 'lib/note-trend.js', 'lib/note-tags.js', 'lib/kb-file.js',
    'lib/platforms.js', 'lib/visual-motif.js', 'lib/asset-kinds.js', 'lib/note-plan.js', 'lib/account-guard.js',
    'lib/video/tts-edge.js', 'lib/video/voices.js', 'popup.js', 'lib/daily-browse.js',
    'dropdown-ui.js',
    'lib/scenario-drain.js', 'auto-water-app.js', 'auto-bot.js'];
  var t0 = Date.now();
  var timer = setInterval(tick, 200);
  function tick() {
    if (ov.dataset.hidden) return;
    try {
      var done = 0;
      for (var i = 0; i < HREFS.length; i++) {
        var es = performance.getEntriesByName(HREFS[i]);
        for (var j = 0; j < es.length; j++) if (es[j].responseEnd > 0) { done++; break; }
      }
      var p = Math.max(2, Math.round(done / HREFS.length * 96));
      bar.style.width = p + '%';
      var sec = Math.round((Date.now() - t0) / 1000);
      pct.textContent = '已完成 ' + done + ' / ' + HREFS.length + ' 个文件 · 已等 ' + sec + ' 秒';
      if (sec > 25 && !t2.dataset.warned) {
        t2.dataset.warned = '1';
        t2.innerHTML = '网络好像不太顺，还在坚持下载中。<br>别关页面；实在等太久可以刷新一下重试。';
      }
    } catch (_) {}
  }
  window.__wbLoadHide = function () {
    if (ov.dataset.hidden) return;
    ov.dataset.hidden = '1';
    clearInterval(timer);
    bar.style.width = '100%';
    ov.classList.add('wb-load-hide');
    setTimeout(function () { ov.remove(); }, 450);
  };
  tick();
})();
