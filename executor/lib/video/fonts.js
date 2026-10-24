/* 内置字体加载器：随包分发的 OFL 字体（授权见 fonts/OFL-*.txt），客户机不必装字体。
 *
 * 为什么是思源系（Noto Sans/Serif SC）：HarmonyOS Sans 的授权只许「免费商用 + 嵌入」，
 * 禁止修改（子集化算修改）与单独分发，打包进付费扩展不合规；楷体（KaiTi）是商业字体，
 * 同理不能打包，只作系统回退。Noto 两个家族都是 OFL 1.1，明文允许修改与再分发。
 *
 * 什么时候下：你电脑那份（扩展／本地文件）进页面就两款都下好，出片照旧等 Fonts.ready；
 * 公网那台（http）进页面一兆都不下——默认拿系统自带字体顶着，谁在 ⚙ 里切到「内置思源」
 * 才按需下这一档用得上的那款（Fonts.need），下完这台浏览器存着，第二次不用再下。
 *
 * 用法：<script src="fonts.js"></script>；window.Fonts = { ready, need, state, EAGER, FILES, MB }。
 */
(function (global) {
  const FILES = {
    'Noto Sans SC': 'fonts/NotoSansSC-subset.woff2',
    'Noto Serif SC': 'fonts/NotoSerifSC-subset.woff2',
  };
  const MB = { 'Noto Sans SC': 4, 'Noto Serif SC': 6 };   // 实测文件大小，只给提示语用
  const ALL = Object.keys(FILES);
  const LOCAL = location.protocol === 'chrome-extension:' || location.protocol === 'file:';
  const EAGER = LOCAL || !!global.FONTS_EAGER;             // 云端造片页也挂这个旗子：那边没人拨旋钮

  const jobs = {}, state = {};

  async function loadOne(fam) {
    try {
      document.fonts.add(await new FontFace(fam, 'url(' + FILES[fam] + ')').load());
      state[fam] = 'ok';
    } catch (e) {
      state[fam] = 'err';
      delete jobs[fam];                 // 没下成＝留个口子，再拨一次这一档能重试
      console.warn('内置字体没加载上，回退系统字体：' + fam + ' — ' + ((e && e.message) || e));
    }
  }

  /** 要这几款内置字体：已经在下的不重开，没下过的现在开始下；全部落定（成功或失败）才 resolve。 */
  function need(fams) {
    const list = (fams || ALL).filter(f => FILES[f]);
    const pending = list.filter(f => {
      if (!jobs[f]) { state[f] = 'down'; jobs[f] = loadOne(f); }
      return state[f] !== 'ok';
    });
    return Promise.all(pending.map(f => jobs[f])).then(() => document.fonts.ready);
  }

  global.Fonts = { ready: EAGER ? need(ALL) : Promise.resolve(), need, state, EAGER, FILES, MB, ALL };
})(window);
