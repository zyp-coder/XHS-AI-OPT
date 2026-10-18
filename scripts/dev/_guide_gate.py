# -*- coding: utf-8 -*-
"""自检进系统首页的共用入口：2026-10-16 起大窗首页有一道新手引导门
   （扩展侧 popup.js extPreGate ／ 公网那台 gate.js popupGate）。
   新号（四步问卷没做完、这一档/这个号还没看过引导）会被 location.replace 弹去 guide.html，
   而这道门是脚本加载完才异步跳的——goto 刚回来时 URL 还挂着 popup.html，得等一拍才知道落在哪。
   自检要的是系统本身：撞上就照引导页那句记一笔「看过引导」（localStorage，跟着临时档案走），再进一次。

用法：from _guide_gate import goto_big
      goto_big(page, target)
      target 三种都给认：扩展 id（'abcdef'）、扩展/公网的页面前缀（'chrome-extension://x'、
      'http://127.0.0.1:8000'）、或整条已经拼好的 popup.html?mode=big 地址（原样用）。
      额外的 page.goto 参数（wait_until / timeout）原样透传。
"""
SYSTEM_UP = '() => !!document.querySelector(".main-tab")'   # 左栏一级项：只有系统本体会画
MARK_SEEN = '''async () => {
    let who = 'default';
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const d = await chrome.storage.local.get('current_tenant_id');
            if (d && d.current_tenant_id) who = d.current_tenant_id;
        }
    } catch (_) {}
    try {
        if (who === 'default' && location.protocol.indexOf('http') === 0) {
            const r = await fetch('/api/auth/me', { method: 'POST',
                headers: { 'Content-Type': 'application/json' }, body: '{}' });
            const j = await r.json();
            if (j && j.account && j.account.id) who = j.account.id;
        }
    } catch (_) {}
    localStorage.setItem('xhs_guide_seen:' + who, '1');
}'''


def big_url_of(target):
    if 'popup.html' in target:
        return target
    base = target if '://' in target else 'chrome-extension://' + target
    return base.rstrip('/') + '/popup.html?mode=big'


def _land(page):
    """等门跳完：'guide'＝被弹去引导页，'system'＝站稳在系统里，'unknown'＝两边都没等到。"""
    for _ in range(60):
        if 'guide.html' in page.url:
            return 'guide'
        try:
            up = bool(page.evaluate(SYSTEM_UP))
        except Exception:
            up = False
        if up:
            page.wait_for_timeout(800)                   # 门是异步跳的：站稳一拍再认
            return 'system' if 'guide.html' not in page.url else 'guide'
        page.wait_for_timeout(300)
    return 'unknown'


def goto_big(page, target, **kw):
    url = big_url_of(target)
    for _ in range(3):
        page.goto(url, **kw)
        if _land(page) != 'guide':
            return page
        try:
            page.evaluate(MARK_SEEN)
        except Exception:
            pass
    return page
