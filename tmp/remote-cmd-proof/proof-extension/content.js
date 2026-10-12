/* 演示扩展 · 页面脚本：等着后台（扩展的手）的招呼——改标题 + 挂一条黑底绿字横幅。 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'do-retitle') {
    document.title = msg.text;
    showBanner('📡 刚收到服务器远程指令（经过扩展的手）：' + msg.text);
    sendResponse({ ok: true, title: document.title });
  }
  return true;
});

function showBanner(text) {
  let el = document.getElementById('__remote_cmd_banner');
  if (!el) {
    el = document.createElement('div');
    el.id = '__remote_cmd_banner';
    el.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:99999;background:#111;' +
      'color:#4ade80;font:14px/1.6 ui-monospace,Consolas,monospace;padding:8px 14px;' +
      'border-bottom:2px solid #4ade80;';
    document.documentElement.appendChild(el);
  }
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  el.textContent = text + '（' + time + '）';
}
