"""发布测试窗口：常驻 Edge（带本仓库扩展 + 调试端口 9333），接三个创作者后台登录。

发布台「页面发布动作」联调用：
  1) python3 scripts/dev/open_pubtest.py        # 开窗口（已开着就只报状态，不会重开）
  2) 老板在窗口里各扫一次码：小红书创作中心 / 视频号助手 / 抖音创作者中心
  3) 之后探页 / 写适配 / 跑发布全流程的脚本用 connect_over_cdp('http://127.0.0.1:9333') 挂上去

登录态存 data/pubtest_profile（data/ 已在 .gitignore，cookie 不进仓库）。
窗口脚本退出也常驻；要换全新 profile 先手动关掉窗口，再删目录重跑。
"""
import json
import pathlib
import subprocess
import sys
import time
import urllib.request

try:  # Windows 控制台默认 GBK
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / 'extension'
PROFILE = ROOT / 'data' / 'pubtest_profile'
PORT = 9333
MSEDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
URLS = [
    'https://creator.xiaohongshu.com/publish/publish?source=official',
    'https://channels.weixin.qq.com/platform/post/create',
    'https://creator.douyin.com/creator-micro/content/manage',
]


def cdp_get(path, timeout=1.5):
    with urllib.request.urlopen(f'http://127.0.0.1:{PORT}{path}', timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8'))


def report():
    targets = cdp_get('/json/list')
    pages = [t for t in targets if t.get('type') == 'page']
    ext_t = [t for t in targets if str(t.get('url', '')).startswith('chrome-extension://')]
    print(f'窗口在（调试端口 {PORT}），已开 {len(pages)} 个页面：')
    for t in pages:
        print(f'  - {t.get("url")}')
    if ext_t:
        print(f'扩展已加载：{ext_t[0]["url"].split("/")[2]}（{len(ext_t)} 个扩展目标）')
    else:
        print('⚠ 暂未看到 chrome-extension:// 目标（service worker 可能在休眠，页面里验证也行）')
    return pages


def main():
    try:
        ver = cdp_get('/json/version')
        if 'Edg' not in str(ver.get('Browser', '')):
            print(f'⚠ 端口 {PORT} 被非 Edge 浏览器占着：{ver.get("Browser")}，先处理再说')
            return 1
        print('窗口已经开着，不重开。')
        report()
        return 0
    except Exception:
        pass

    if not pathlib.Path(MSEDGE).exists():
        print(f'⚠ 找不到 Edge：{MSEDGE}')
        return 1
    PROFILE.mkdir(parents=True, exist_ok=True)

    args = [
        MSEDGE,
        f'--user-data-dir={PROFILE}',
        f'--remote-debugging-port={PORT}',
        f'--disable-extensions-except={EXT}',
        f'--load-extension={EXT}',
        '--no-first-run', '--no-default-browser-check',
        '--start-maximized', '--disable-session-crashed-bubble',
        *URLS,
    ]
    subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL, close_fds=True,
                     creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP)
    print('正在开测试窗口…')
    for _ in range(60):
        time.sleep(0.5)
        try:
            cdp_get('/json/version', timeout=1)
            break
        except Exception:
            continue
    else:
        print('⚠ 30 秒内没等到调试端口，看下 Edge 是不是弹了什么框')
        return 1
    time.sleep(1.5)  # 等三个标签页都报出来
    report()
    print()
    print('窗口开好了。接下来：三个页面里各扫一次码登录（小红书 / 视频号 / 抖音）。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
