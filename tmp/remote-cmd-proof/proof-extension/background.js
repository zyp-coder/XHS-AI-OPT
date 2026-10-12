/* 演示扩展 · 后台脚本（MV3 服务工作者）
 * 开机就挂长轮询 /pull 等服务器命令；收到 → 执行 → /report 回报。
 * 这就是"服务器当大脑、扩展当手"里那只手的最小形态。 */
const BASE = 'http://127.0.0.1:8798';

async function rep(text) {
  try {
    await fetch(BASE + '/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch { /* 服务器没开就算了 */ }
}

async function tabFor(pathPrefix) {
  const tabs = await chrome.tabs.query({ url: BASE + pathPrefix + '*' });
  return tabs[0] || null;
}

async function doRetitle(text) {
  const newTitle = text.split('|')[1] || ('服务器改的 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }));
  const tab = await tabFor('/demo-page.html');
  if (!tab) throw new Error('没找到目标页面（demo-page.html 没开着）');
  await rep(`🎯 已定位目标页面（标签 #${tab.id}，现标题「${tab.title}」），动手改`);
  const resp = await poke(tab.id, { type: 'do-retitle', text: newTitle });
  await rep(`✅ 执行完毕：标题已改为「${resp.title}」（页面里的脚本当场确认的）`);
}

// 页面可能比扩展先加载好（脚本还没就位）——多敲几次门；实在没人应，把页面脚本补注进去再敲
async function poke(tabId, msg) {
  let lastErr;
  for (let i = 0; i < 4; i++) {
    try {
      return await chrome.tabs.sendMessage(tabId, msg);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  await rep('🔁 页面脚本还没就位，补注一次再试');
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch (e) {
    throw new Error(`页面里没有能接指令的脚本（${e.message}；之前：${lastErr.message}）`);
  }
}

async function doReportTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  await rep(`📋 报告：此刻的活动标签页是「${tab ? tab.title : '(没有)'}」，地址 ${tab ? tab.url : '-'}`);
}

async function doOpenTab() {
  const t = await chrome.tabs.create({ url: BASE + '/demo-page.html' });
  await rep(`🪟 已替服务器新开一个标签页（#${t.id}）`);
}

async function exec(cmd) {
  const text = cmd.text || '';
  if (text.startsWith('改标题')) return doRetitle(text);
  if (text === '报告标签页') return doReportTab();
  if (text === '开新标签页') return doOpenTab();
  await rep(`⚠️ 不认识的命令：${text}`);
}

async function loop() {
  for (;;) {
    let cmd = null;
    try {
      const r = await fetch(BASE + '/pull');
      cmd = (await r.json()).cmd;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (cmd) {
      await rep(`🤖 扩展收到服务器命令「${cmd.text}」，开始执行`);
      try {
        await exec(cmd);
      } catch (e) {
        await rep(`❌ 执行出错：${e.message}`);
      }
    }
  }
}

loop();

// 心跳：MV3 服务工作者闲 30 秒会被浏览器收走，20 秒碰一下浏览器 API 保持在线
setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);

chrome.runtime.onInstalled.addListener(() => rep('🟢 演示扩展已就位（浏览器里那只"手"开好了）'));
