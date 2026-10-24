/**
 * theme.js — 界面主题（全站一套变量：预设 + 自定义色）
 *
 * 怎么工作：
 *   ① ui.css 里的 --c-brand 一组只是「theme.js 没来得及上色时的兜底」；这里按「当前主题」把同一批变量写到 <html> 的内联样式上。
 *      内联样式优先级最高 ⇒ 任何页面都不用改样式表就能换色，样式表里也不该再出现写死的品牌 hex。
 *   ② 主题值存在 chrome.storage.local 的 ui_theme（在 lib/tenant.js 的 TENANT_SCOPED_KEYS 里：
 *      跟着产品/租户切换，也进加密备份——将来抖音那条线切一套预设就是换个租户）。
 *   ③ 同一份值再往 localStorage 镜像一份：那边读是同步的，首帧就能上正确颜色，不然会先闪一下默认黑。
 *   ④ 监听 storage.onChanged：在设置页换了色，已经开着的弹窗 / 字效编辑器 / 内嵌 iframe 立刻跟着变，不用重开。
 *
 * 用法：页面 <head> 里挂一行 <script src="theme.js"></script>，别的什么都不用调。
 * 换主题（新平台一套配色）：改下面 PRESETS 一条，或让 build.js 给它一份默认 preset。
 */
(function () {
  'use strict';

  var KEY = 'ui_theme';          // chrome.storage.local 里的键
  var CACHE = 'ui_theme_cache';  // localStorage 镜像（只为首帧不闪）
  var DEFAULT = 'teal';         // 默认走 demo 那套绿（松石青）

  // 预设：只写基色，其余档全由基色混出来（各主题的浅底 / 淡边 / hover 深一档观感一致，不用逐个调）
  var PRESETS = [
    { id: 'graphite', name: '石墨黑', brand: '#1f2329', desc: '工具感最强，跟两个平台都不撞色' },
    { id: 'indigo', name: '靛蓝', brand: '#4f46e5', desc: '中性 SaaS 风，最不像某个平台' },
    { id: 'blue', name: '品牌蓝', brand: '#2563eb', desc: '跟状态色（成功/警告）最不打架' },
    { id: 'violet', name: '电光紫', brand: '#7c3aed', desc: '个性强，深浅都好认' },
    { id: 'magenta', name: '玫红', brand: '#e0218a', desc: '最艳的一档，压得住白底' },
    { id: 'pink', name: '桃粉', brand: '#f472b6', desc: '亮但轻，界面上偏柔' },
    { id: 'rose', name: '小红书红', brand: '#ff2442', desc: '换主题前的老配色' },
    { id: 'orange', name: '活力橙', brand: '#ff6a00', desc: '最抓眼，按钮和数字都跳出来' },
    { id: 'amber', name: '琥珀', brand: '#f59e0b', desc: '暖、亮，主按钮上走黑字' },
    { id: 'lime', name: '青柠', brand: '#84cc16', desc: '最亮的一档，字必须压黑' },
    { id: 'emerald', name: '翡翠绿', brand: '#10b981', desc: '清爽，像效率工具' },
    { id: 'teal', name: '松石青', brand: '#0d9488', desc: '默认；绿里偏蓝，比翡翠稳（跟 demo 一套）' },
    { id: 'cyan', name: '抖音青', brand: '#0ea5e9', desc: '给抖音那条线留的调子' },
  ];

  /* ── 颜色小工具：只认 #rrggbb ── */
  function parseHex(s) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(s || '').trim());
    if (!m) return null;
    var v = parseInt(m[1], 16);
    return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
  }
  function toHex(c) {
    var h = function (n) { var s = Math.max(0, Math.min(255, Math.round(n))).toString(16); return s.length < 2 ? '0' + s : s; };
    return '#' + h(c.r) + h(c.g) + h(c.b);
  }
  /** 往白（w=1）或黑（w=0）混：w＝白占的比例 */
  function mix(c, w) {
    return { r: c.r + (255 - c.r) * w, g: c.g + (255 - c.g) * w, b: c.b + (255 - c.b) * w };
  }
  /** 整体压暗（k＝留下的比例）：主色的「深一档」走这条，别拿 mix 往白混 */
  function shade(c, k) {
    return { r: c.r * k, g: c.g * k, b: c.b * k };
  }
  /** 相对亮度（sRGB 线性），用来定「主色块上的字是黑还是白」 */
  function luma(c) {
    var f = function (n) { n /= 255; return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function rgba(c, a) { return 'rgba(' + c.r + ', ' + c.g + ', ' + c.b + ', ' + a + ')'; }
  /** WCAG 对比度（对白底算文字够不够看得清） */
  function contrast(c) {
    var L = luma(c);
    return (1.05) / (L + 0.05);
  }
  /** 主色当文字用：白底上不够 4.5:1 就往黑压，一档 5%，最多压 15 档 */
  function textVersion(c) {
    var t = { r: c.r, g: c.g, b: c.b };
    for (var i = 0; i <= 15; i++) {
      if (contrast(t) >= 4.5) return t;
      t = { r: t.r * 0.95, g: t.g * 0.95, b: t.b * 0.95 };
    }
    return t;
  }

  function presetOf(id) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
    return null;
  }

  /** 主题值（{ preset, custom }）→ 一套 CSS 变量。preset='custom' 时用 custom 那个色值 */
  function tokensOf(v) {
    v = v || {};
    var hex = (v.preset === 'custom') ? String(v.custom || '') : ((presetOf(v.preset) || presetOf(DEFAULT)).brand);
    var c = parseHex(hex) || parseHex(presetOf(DEFAULT).brand);
    return {
      '--c-brand': toHex(c),
      '--c-brand-ink': toHex(shade(c, 0.75)),      // 深一档：整支压暗 25%（石墨黑算出来就是 #171a1f，跟样式表兜底一致）
      '--c-brand-hi': toHex(mix(c, 0.78)),        // 浅一档：白占 78%（渐变起点）
      '--c-brand-soft': toHex(mix(c, 0.92)),      // 极浅底：白占 92%
      '--c-brand-soft2': toHex(mix(c, 0.85)),
      '--c-brand-line': toHex(mix(c, 0.78)),
      '--c-brand-text': toHex(textVersion(c)),      // 主色当文字用：白底上不够 4.5:1 会自动压深
      '--c-brand-on': luma(c) > 0.3 ? '#1f2329' : '#ffffff',   // 浅色主题上要写黑字，否则白字看不见
      '--c-brand-a40': rgba(c, 0.4),
      '--c-brand-a15': rgba(c, 0.15),
      '--c-brand-a08': rgba(c, 0.08),
    };
  }

  /** 把变量写到 <html> 上（内联样式压过 ui.css 的 :root） */
  function apply(v) {
    var el = document.documentElement;
    if (!el) return;
    var t = tokensOf(v);
    for (var k in t) if (Object.prototype.hasOwnProperty.call(t, k)) el.style.setProperty(k, t[k]);
    el.dataset.theme = (v && v.preset === 'custom') ? 'custom' : ((presetOf(v && v.preset) || presetOf(DEFAULT)).id);
  }

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch (_) { return null; }
  }
  function writeCache(v) {
    try { localStorage.setItem(CACHE, JSON.stringify(v)); } catch (_) {}
  }

  /** 当前主题值（storage 是唯一的真源；缓存只为首帧） */
  function read() {
    return new Promise(function (resolve) {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return resolve(readCache() || { preset: DEFAULT, custom: '' });
      chrome.storage.local.get(KEY, function (d) {
        var v = d && d[KEY];
        // 没手动选过色就直接用默认档：别拿旧缓存顶——那份缓存只是上一次默认档的镜像，
        // 默认档一改（石墨黑→松石青），拿它顶就会看着「换了没生效」
        resolve((v && typeof v === 'object') ? v : { preset: DEFAULT, custom: '' });
      });
    });
  }

  /** 存 + 立即应用（写 storage 后各处靠 onChanged 自己跟上；本页直接 apply，不等事件） */
  function save(v) {
    apply(v);
    writeCache(v);
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      var w = {}; w[KEY] = v;
      try { chrome.storage.local.set(w); } catch (_) {}
    }
    return Promise.resolve(v);
  }

  function load() {
    return read().then(function (v) { apply(v); writeCache(v); return v; });
  }

  /* 首帧先按缓存上色（同步，不闪），再从 storage 校准一次 */
  apply(readCache() || { preset: DEFAULT, custom: '' });
  load();
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (chg, area) {
      if (area !== 'local' || !chg[KEY]) return;
      var v = chg[KEY].newValue;
      if (!v || typeof v !== 'object') v = { preset: DEFAULT, custom: '' };
      apply(v); writeCache(v);
    });
  }

  window.Theme = {
    KEY: KEY,
    DEFAULT: DEFAULT,
    PRESETS: PRESETS,
    presetOf: presetOf,
    tokensOf: tokensOf,
    apply: apply,
    read: read,
    save: save,
    load: load,
  };
})();
