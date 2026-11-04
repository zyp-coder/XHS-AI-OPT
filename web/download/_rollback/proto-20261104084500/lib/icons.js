/* icons.js — 线性图标（单一来源，注入 sprite 到页面）
 *
 * 用法：<svg class="ic"><use href="#i-search"/></svg>
 *      或 JS 里：Ic('search')  → 同上（自动带 class="ic"）
 *      Ic('play', 'ic-lg')    → 指定尺寸
 * 图标一律 24×24 线性描边、stroke=currentColor，颜色跟随文字色。
 */
(function () {
  if (typeof window === 'undefined') return;

  var PATHS = {
    'search':     '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.9-3.9"/>',
    'spark':      '<path d="M12 3l1.9 4.7L18.6 9.6l-4.7 1.9L12 16.2l-1.9-4.7L5.4 9.6l4.7-1.9z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
    'hash':       '<path d="M9 3L7 21M17 3l-2 18M4 8.5h15.5M3.5 15.5H19"/>',
    'target':     '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
    'play':       '<path d="M7 4.8v14.4a.6.6 0 0 0 .92.5l11.3-7.2a.6.6 0 0 0 0-1L7.92 4.3A.6.6 0 0 0 7 4.8z"/>',
    'stop':       '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    'refresh':    '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5.5V11h-5.5"/>',
    'list':       '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    'inbox':      '<path d="M3.5 12.5h4l1.5 2.5h6l1.5-2.5h4"/><path d="M5.6 5.4h12.8l1.6 7.1v5.1a1.4 1.4 0 0 1-1.4 1.4H5.4A1.4 1.4 0 0 1 4 17.6v-5.1z"/>',
    'users':      '<circle cx="9.5" cy="8.5" r="3.5"/><path d="M3.5 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16.5 5.6a3.4 3.4 0 0 1 0 6.3"/><path d="M18 14.9c2 .7 3.5 2.4 3.5 5.1"/>',
    'chat':       '<path d="M20.5 12a7.5 7.5 0 0 1-7.5 7.5H9L4.5 22l.9-3.9A7.5 7.5 0 0 1 13 4.5 7.5 7.5 0 0 1 20.5 12z"/>',
    'bell':       '<path d="M18 9.5a6 6 0 1 0-12 0c0 4.6-1.6 6.2-1.6 6.2h15.2S18 14.1 18 9.5z"/><path d="M13.7 19.2a2 2 0 0 1-3.4 0"/>',
    'mail':       '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4.2 7.2l7.8 5.3 7.8-5.3"/>',
    'note':       '<path d="M7 3.5h7l5 5v12a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20.5v-15A1.5 1.5 0 0 1 7 3.5z"/><path d="M14 3.5v5h5"/>',
    'pen':        '<path d="M16.5 4.2l3.3 3.3L8.3 19H5v-3.3z"/><path d="M14 6.7l3.3 3.3"/>',
    'gear':       '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a1.9 1.9 0 0 1-3.8 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3.4a1.9 1.9 0 0 1 0-3.8h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5V3.4a1.9 1.9 0 0 1 3.8 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1h.2a1.9 1.9 0 0 1 0 3.8h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
    'pulse':      '<path d="M3.5 12.5h4l2-6 3.5 11 2.5-7 1.6 3h3.4"/>',
    'chart':      '<path d="M4.5 19.5V10M10 19.5V4.5M15.5 19.5v-6M21 19.5V8"/>',
    'trash':      '<path d="M4.5 6.5h15M9.5 6.5V4.8a1.3 1.3 0 0 1 1.3-1.3h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7"/><path d="M6.5 6.5l.9 12.2a1.5 1.5 0 0 0 1.5 1.3h6.2a1.5 1.5 0 0 0 1.5-1.3l.9-12.2"/>',
    'upload':     '<path d="M12 16V4.5M7.5 9L12 4.5 16.5 9"/><path d="M4.5 15.5v3a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-3"/>',
    'download':   '<path d="M12 4.5V16M7.5 11.5L12 16l4.5-4.5"/><path d="M4.5 15.5v3a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-3"/>',
    'external':   '<path d="M14 4.5h5.5V10"/><path d="M19.5 4.5L11 13"/><path d="M18 14.5v4a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6h4"/>',
    'check':      '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    'close':      '<path d="M6 6l12 12M18 6L6 18"/>',
    'plus':       '<path d="M12 5v14M5 12h14"/>',
    'minus':      '<path d="M5 12h14"/>',
    'chev-down':  '<path d="M6.5 9.5L12 15l5.5-5.5"/>',
    'chev-right': '<path d="M9.5 6.5L15 12l-5.5 5.5"/>',
    'chev-left':  '<path d="M14.5 6.5L9 12l5.5 5.5"/>',
    'arrow-left': '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    'more':       '<circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/>',
    'clock':      '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>',
    'droplet':    '<path d="M12 3.5s5.5 5.6 5.5 9.4a5.5 5.5 0 0 1-11 0C6.5 9.1 12 3.5 12 3.5z"/>',
    'leaf':       '<path d="M20 4.5s.8 8.4-4 12.2c-3.2 2.5-7.4 2-9-.4-1.5-2.3-.3-5.6 3-7.2C13.6 7.2 20 4.5 20 4.5z"/><path d="M4.5 20s3-6 8-9.5"/>',
    'shield':     '<path d="M12 3.5l7 2.6v6c0 4.3-2.9 7.6-7 8.9-4.1-1.3-7-4.6-7-8.9v-6z"/>',
    'terminal':   '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M7.5 10l2.5 2.5-2.5 2.5M13 15h4"/>',
    'code':       '<path d="M9 7.5L4.5 12 9 16.5M15 7.5L19.5 12 15 16.5"/>',
    'bot':        '<rect x="4.5" y="8" width="15" height="11" rx="3"/><path d="M12 8V4.5M9 13h.01M15 13h.01"/><path d="M2.5 12.5v3M21.5 12.5v3"/>',
    'building':   '<path d="M5 20.5V4.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v16"/><path d="M14 10h4a1 1 0 0 1 1 1v9.5"/><path d="M3.5 20.5h17"/><path d="M8 7.5h2M8 11h2M8 14.5h2"/>',
    'bolt':       '<path d="M13.5 3L5.5 13.5h6L10.5 21l8-10.5h-6z"/>',
    'tag':        '<path d="M11.6 3.5H19a1.5 1.5 0 0 1 1.5 1.5v7.4a1.5 1.5 0 0 1-.44 1.06l-7.1 7.1a1.5 1.5 0 0 1-2.12 0l-7.4-7.4a1.5 1.5 0 0 1 0-2.12l8.1-8.1a1.5 1.5 0 0 1 1.06-.44z"/><circle cx="16" cy="8" r="1.2"/>',
    'filter':     '<path d="M4.5 6h15M7 12h10M10 18h4"/>',
    'window':     '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9h17"/><path d="M12 12.5h5.5v4"/>',
    'alert':      '<path d="M12 4.5l8.5 14.5h-17z"/><path d="M12 10v4M12 16.6h.01"/>',
    'info':       '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8h.01"/>',
    'link':       '<path d="M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 1 0-5.7-5.7L11.4 6.4"/><path d="M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 1 0 5.7 5.7l1.4-1.4"/>',
    'send':       '<path d="M21 3.5L10.5 14"/><path d="M21 3.5l-6.6 17-3.9-6.5-6.5-3.9z"/>',
    'eye':        '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    'layers':     '<path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z"/><path d="M3.5 12.5L12 17l8.5-4.5"/><path d="M3.5 16.5L12 21l8.5-4.5"/>',
    'key':        '<circle cx="8" cy="14" r="4"/><path d="M11 11l8-8M16.5 5.5l2 2M14 8l2 2"/>',
    'db':         '<ellipse cx="12" cy="6.5" rx="7.5" ry="2.8"/><path d="M4.5 6.5v11c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-11"/><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>',
    'pause':      '<rect x="8" y="5.5" width="3" height="13" rx="1"/><rect x="13" y="5.5" width="3" height="13" rx="1"/>',
    'copy':       '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
    'image':      '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="8.7" cy="9.7" r="1.6"/><path d="M4 16.6l4.4-4.4a1.5 1.5 0 0 1 2.1 0l3.9 3.9"/><path d="M13.6 14.3l1.8-1.8a1.5 1.5 0 0 1 2.1 0l2.3 2.3"/>',
    'save':       '<path d="M5.5 3.5h10l3 3v13a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z"/><path d="M8.5 3.5v5h6v-5M8.5 20.5v-6h7v6"/>',
    'palette':    '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.8-.5-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6h1.8c2.3 0 4.2-1.9 4.2-4.3C20.5 6.9 16.6 3.5 12 3.5z"/><circle cx="7.9" cy="11.6" r="1.1"/><circle cx="10.6" cy="8.1" r="1.1"/><circle cx="14.6" cy="8.7" r="1.1"/>'
  };

  var parts = [];
  for (var k in PATHS) {
    if (Object.prototype.hasOwnProperty.call(PATHS, k)) {
      parts.push('<symbol id="i-' + k + '" viewBox="0 0 24 24">' + PATHS[k] + '</symbol>');
    }
  }
  var sprite = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">' + parts.join('') + '</svg>';

  function mount() {
    if (document.getElementById('__ic_sprite')) return;
    var d = document.createElement('div');
    d.id = '__ic_sprite';
    d.setAttribute('aria-hidden', 'true');
    d.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';
    d.innerHTML = sprite;
    (document.body || document.documentElement).appendChild(d);
  }

  /** 返回图标 HTML；cls 是尺寸/颜色修饰类，基础 .ic 恒定带上（否则没有描边样式，会渲染成实心黑块） */
  function Ic(name, cls) {
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  }

  window.Ic = Ic;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
