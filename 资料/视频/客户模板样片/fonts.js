/* 内置字体加载器：随包分发的 OFL 字体（授权见 fonts/OFL-*.txt），客户机不必装字体。
 *
 * 为什么是思源系（Noto Sans/Serif SC）：HarmonyOS Sans 的授权只许「免费商用 + 嵌入」，
 * 禁止修改（子集化算修改）与单独分发，打包进付费扩展不合规；楷体（KaiTi）是商业字体，
 * 同理不能打包，只作系统回退。Noto 两个家族都是 OFL 1.1，明文允许修改与再分发。
 *
 * 用法：<script src="fonts.js"></script>，需要确定性出片的地方等 window.Fonts.ready。
 */
(function (global) {
  const FILES = [
    ['Noto Sans SC', 'fonts/NotoSansSC-subset.woff2'],
    ['Noto Serif SC', 'fonts/NotoSerifSC-subset.woff2'],
  ];
  const ready = Promise.all(FILES.map(async ([fam, url]) => {
    try {
      document.fonts.add(await new FontFace(fam, 'url(' + url + ')').load());
    } catch (e) {
      console.warn('内置字体没加载上，回退系统字体：' + fam + ' — ' + ((e && e.message) || e));
    }
  })).then(() => document.fonts.ready);

  global.Fonts = { ready, FILES };
})(window);
