/**
 * pub-shadow-hook.js — 发布按钮「破壳」小钩子（MAIN world · document_start · 页内注入）
 *
 * 为什么要有它：小红书把底部「发布」按钮封在一颗 **closed** shadow 里
 * （自定义元素 <xhs-publish-btn>，shadowRoot 从页面 JS 里读不到）——
 * querySelectorAll / el.shadowRoot 都够不着，按钮就成了「看得见、抓不着」。
 *
 * 做法：抢在页面脚本之前把 Element.prototype.attachShadow 接过来，页面要开
 * shadow 时强制开成 open、顺手把根记进 window.__npaShadowRoots；
 * 之后 NPA_XHS_SEND 照常找按钮、点按钮。纯浏览器内的 DOM 手法，不碰任何站外接口。
 *
 * 注入方式：background._npPubBgEnsureShadowHook() 用 chrome.scripting.registerContentScripts
 * 注册（runAt:'document_start', world:'MAIN'）——必须早于页面自定义元素的定义。
 */
(() => {
  if (window.__npaShadowHookOn) return;
  window.__npaShadowHookOn = true;
  const roots = (window.__npaShadowRoots = []);
  const orig = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    try {
      const sr = orig.call(this, Object.assign({}, init || {}, { mode: 'open' }));
      try { roots.push(sr); } catch (e) {}
      return sr;
    } catch (e) {
      return orig.call(this, init);
    }
  };
})();
