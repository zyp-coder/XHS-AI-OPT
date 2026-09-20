"""Playwright 浏览器引擎 - 单例 + 健康自愈 + 拟人化（Android 模拟器真实设备模式）"""
import asyncio
import json
import random
import shutil
import time as time_module
from typing import Optional

from config import (
    COOKIE_DIR,
    EMULATOR_ENABLED,
    ANDROID_SDK_ROOT,
    AVD_NAME, CHROME_CDP_PORT,
    EMULATOR_BOOT_TIMEOUT, CHROME_LAUNCH_TIMEOUT, ADB_TIMEOUT,
    EMULATOR_RAM_MB,
)
from app.core.crypto import encrypt_text, decrypt_text


def safe_print(*args, **kwargs):
    """安全打印：自动处理 GBK 编码错误"""
    try:
        print(*args, **kwargs)
    except (UnicodeEncodeError, UnicodeError):
        text = " ".join(str(a) for a in args)
        try:
            print(text.encode("gbk", errors="replace").decode("gbk"), **kwargs)
        except Exception:
            pass


class BrowserEngine:
    """浏览器引擎（全局单例）

    设计原则：
    - 仅支持 Android 模拟器模式（真实移动端 Chrome），不做桌面端兜底
    - 全局只启动一个浏览器，所有引流任务共用一个登录会话
    - 浏览器窗口保持打开，不会自行关闭
    - 内置健康检查 + 自动重启
    - 每次操作前检查页面和登录状态
    - 拟人化操作：随机延迟、阅读时间、鼠标轨迹、打字错误
    """

    def __init__(self):
        self.browser = None        # Browser
        self.context = None        # BrowserContext（存放cookies）
        self.page = None           # Page
        self._playwright = None
        self._lock = asyncio.Lock()
        self._account_id = None    # 当前登录的账号ID

        # 状态追踪
        self.status = "stopped"    # stopped / starting / running / crashed
        self.login_status = "unknown"  # unknown / logged_in / expired
        self.last_error = ""
        self._health_task = None   # 后台健康检查任务

        # ========== Android 模拟器相关 ==========
        self._emulator_process = None       # 模拟器进程
        self._adb_serial = None             # adb 设备串号 (emulator-5554)
        self._cdp_browser = None            # CDP 连接的 Browser 对象
        self._emulator_mode = False         # 是否正在使用真实模拟器
        self._emulator_boot_start = 0       # 启动时间戳

    # ==================== 公共方法 ====================

    async def start(self, account_id: Optional[int] = None) -> str:
        """启动浏览器（如果已运行则返回状态）

        Returns:
            "started" | "already_running" | "error:xxx"
        """
        async with self._lock:
            if await self._is_page_alive():
                if account_id:
                    self._account_id = account_id
                return "already_running"

            await self._cleanup()

            self.status = "starting"
            try:
                return await self._do_start(account_id)
            except Exception as e:
                self.status = "crashed"
                self.last_error = str(e)
                return f"error:{e}"

    async def ensure_ready(self, account_id: int) -> str:
        """确保浏览器就绪且已登录，供引流任务在执行前调用

        Returns:
            "ok" | "need_login" | "error:xxx"
        """
        alive = await self._is_page_alive()
        if not alive:
            result = await self.start(account_id)
            if result.startswith("error"):
                return result

        logged_in = await self._check_login()
        if not logged_in:
            if account_id:
                try:
                    await self.load_cookies(account_id)
                except Exception:
                    pass
                logged_in = await self._check_login()

            if not logged_in:
                self.login_status = "expired"
                return "need_login"

        self.login_status = "logged_in"
        return "ok"

    async def get_status(self) -> dict:
        """获取引擎状态（供前端轮询）"""
        alive = await self._is_page_alive() if self.page else False
        if not alive and self.status == "running":
            self.status = "crashed"
        return {
            "status": self.status,
            "login_status": self.login_status,
            "account_id": self._account_id,
            "page_alive": alive,
            "last_error": self.last_error,
        }

    async def close(self):
        """关闭浏览器并停止健康检查"""
        if self._health_task:
            self._health_task.cancel()
            self._health_task = None
        await self._cleanup()
        self.status = "stopped"
        self.login_status = "unknown"
        self._account_id = None

    # ==================== 启动与清理 ====================

    async def _do_start(self, account_id: Optional[int]) -> str:
        """启动浏览器（仅 Android 模拟器模式：真实移动端 Chrome）

        模拟器不可用时直接返回错误，不做桌面端兜底。
        """
        from playwright.async_api import async_playwright

        self._playwright = await async_playwright().start()

        if not EMULATOR_ENABLED:
            return "error:模拟器模式已禁用（EMULATOR_ENABLED=False）"

        try:
            result = await self._start_emulator_mode()
        except Exception as e:
            await self._cleanup_emulator()
            return f"error:模拟器启动异常: {e}"

        if result != "started":
            await self._cleanup_emulator()
            return f"error:模拟器启动失败（{result}）"

        safe_print("  Android 模拟器模式已启动（真实移动端 Chrome）")
        self.status = "running"
        self._account_id = account_id
        if account_id:
            try:
                await self.load_cookies(account_id)
            except Exception:
                pass
        self._start_health_check()
        return "started"

    # ==================== Android 模拟器 ====================

    async def _start_emulator_mode(self) -> str:
        """启动 Android 模拟器（Google AVD）
        Returns: "started" | "error:xxx"
        """
        adb = self._find_adb()
        if not adb:
            return "error:adb not found"
        return await self._start_avd_mode(adb)

    async def _start_avd_mode(self, adb: str) -> str:
        """启动 Google AVD 模拟器模式"""
        # 1. 检查系统镜像和 AVD 是否存在
        avd_dir = Path.home() / ".android" / "avd" / f"{AVD_NAME}.avd"
        if not avd_dir.exists():
            return f"error:AVD '{AVD_NAME}' not found (run setup_emulator.py first)"

        # 2. 检查是否已有模拟器在运行
        devices = await self._run_adb(adb, "devices")
        if AVD_NAME in devices or "emulator-5554" in devices:
            safe_print("  检测到已有模拟器在运行，尝试复用...")
            self._adb_serial = "emulator-5554"
            booted = await self._run_adb(adb, "shell getprop sys.boot_completed")
            if booted and booted.strip() == "1":
                safe_print("  复用已有模拟器")
                return await self._connect_chrome_cdp(adb)

        # 3. 启动模拟器进程
        safe_print("  启动 Android 模拟器...")
        emu_exe = ANDROID_SDK_ROOT / "emulator" / "emulator.exe"
        if not emu_exe.exists():
            return f"error:emulator.exe not found at {emu_exe}"

        self._emulator_boot_start = time_module.time()
        try:
            self._emulator_process = await asyncio.create_subprocess_exec(
                str(emu_exe),
                "-avd", AVD_NAME,
                "-no-snapshot",
                "-gpu", "host",
                "-no-audio",
                "-memory", str(EMULATOR_RAM_MB),
                "-netdelay", "none",
                "-netspeed", "full",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
        except Exception as e:
            return f"error:failed to start emulator: {e}"

        # 4. 等待启动完成
        safe_print(f"  等待模拟器启动（超时 {EMULATOR_BOOT_TIMEOUT}s）...")
        self._adb_serial = "emulator-5554"
        booted = await self._wait_for_boot(adb)
        if not booted:
            await self._cleanup_emulator()
            return "error:emulator boot timeout"

        elapsed = int(time_module.time() - self._emulator_boot_start)
        safe_print(f"  模拟器已启动（耗时 {elapsed}s）")

        # 5. 配置系统参数
        await self._configure_emulator(adb)

        # 6. 连接 Chrome CDP
        return await self._connect_chrome_cdp(adb)

    def _find_adb(self) -> Optional[str]:
        """查找 adb 可执行文件路径"""
        # 1. PATH 中查找
        adb = shutil.which("adb")
        if adb:
            return adb
        # 2. SDK 目录中查找
        candidates = [
            ANDROID_SDK_ROOT / "platform-tools" / "adb.exe",
            ANDROID_SDK_ROOT / "platform-tools" / "adb",
        ]
        for p in candidates:
            if p.exists():
                return str(p)
        return None

    async def _run_adb(self, adb: str, cmd: str, timeout: int = None) -> str:
        """运行 adb 命令，返回 stdout"""
        if timeout is None:
            timeout = ADB_TIMEOUT
        serial = self._adb_serial or "emulator-5554"
        full_cmd = f'"{adb}" -s {serial} {cmd}'
        try:
            proc = await asyncio.create_subprocess_shell(
                full_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=timeout
            )
            if proc.returncode != 0:
                return ""
            return stdout.decode("utf-8", errors="replace").strip()
        except (asyncio.TimeoutError, Exception):
            return ""

    async def _wait_for_boot(self, adb: str) -> bool:
        """等待模拟器启动完成"""
        start = time_module.time()
        expected_serial = self._adb_serial or "emulator-5554"
        while time_module.time() - start < EMULATOR_BOOT_TIMEOUT:
            # 检查设备是否在线
            devices = await self._run_adb(adb, "devices", timeout=5)
            if expected_serial not in devices or "device" not in devices:
                await asyncio.sleep(3)
                continue
            # 检查 boot_completed
            boot = await self._run_adb(adb, "shell getprop sys.boot_completed", timeout=5)
            if boot and boot.strip() == "1":
                # 额外确认 package manager 已就绪
                pm = await self._run_adb(adb, "shell pm path android", timeout=5)
                if pm:
                    return True
            elapsed = int(time_module.time() - start)
            if elapsed % 15 == 0:
                safe_print(f"    等待模拟器启动... {elapsed}s")
            await asyncio.sleep(5)
        return False

    async def _configure_emulator(self, adb: str):
        """配置模拟器系统参数"""
        safe_print("  配置模拟器系统参数...")
        # 语言
        await self._run_adb(adb, "shell setprop persist.sys.locale zh-CN", timeout=5)
        # 时区
        await self._run_adb(adb, "shell setprop persist.sys.timezone Asia/Shanghai", timeout=5)
        # 切换为移动网络（模拟 4G）
        await self._run_adb(adb, "shell svc wifi disable", timeout=5)
        await self._run_adb(adb, "shell svc data enable", timeout=5)
        safe_print("  系统参数已配置（zh-CN, Asia/Shanghai, 移动网络）")

    async def _connect_chrome_cdp(self, adb: str) -> str:
        """确保 Chrome 就绪并建立 CDP 连接"""
        # 1. 检查 Chrome 是否已安装
        pkg = await self._run_adb(adb, "shell pm list packages com.android.chrome", timeout=10)
        chrome_installed = "com.android.chrome" in pkg

        if not chrome_installed:
            # 尝试自动安装
            chrome_apk = ANDROID_SDK_ROOT / "chrome.apk"
            if chrome_apk.exists():
                safe_print("  安装 Chrome for Android...")
                result = await self._run_adb(
                    adb, f'install -r "{chrome_apk}"', timeout=120
                )
                if "Success" in result:
                    chrome_installed = True
                    safe_print("  Chrome 安装成功")
                else:
                    safe_print("  Chrome 安装失败，稍后可手动安装")
            else:
                safe_print("  Chrome APK 未找到，跳过安装")

        if not chrome_installed:
            safe_print("  ⚠ Chrome 未安装，模拟器模式下需手动安装后使用")

        # 2. 启动 Chrome
        safe_print("  启动 Chrome...")
        await self._run_adb(
            adb,
            "shell am start -n com.android.chrome/com.google.android.apps.chrome.Main",
            timeout=15,
        )
        await asyncio.sleep(3)

        # 3. 设置端口转发
        safe_print("  配置 CDP 端口转发...")
        # 先移除旧的转发
        await self._run_adb(adb, "forward --remove tcp:9222", timeout=5)

        # 尝试不同的 socket 名称
        forwarded = False
        for socket_name in [
            "localabstract:chrome_devtools_remote",
            "localabstract:chrome_devtools_remote_9222",
        ]:
            result = await self._run_adb(
                adb, f"forward tcp:{CHROME_CDP_PORT} {socket_name}", timeout=10
            )
            if "error" not in result.lower():
                forwarded = True
                break

        if not forwarded:
            return "error:cdp port forward failed"

        # 4. 等待 CDP 端点就绪并连接
        safe_print("  连接 Chrome DevTools...")
        return await self._wait_for_cdp()

    async def _wait_for_cdp(self) -> str:
        """等待 CDP 端点就绪并通过 Playwright 连接"""
        import urllib.request

        cdp_url = f"http://127.0.0.1:{CHROME_CDP_PORT}"

        # 等待端点可用
        for i in range(CHROME_LAUNCH_TIMEOUT):
            try:
                resp = urllib.request.urlopen(
                    f"{cdp_url}/json/version", timeout=3
                )
                data = json.loads(resp.read().decode())
                if "Browser" in data:
                    safe_print(f"  CDP 就绪: Chrome {data.get('Browser', '')}")
                    break
            except Exception:
                pass
            await asyncio.sleep(1)
        else:
            return "error:cdp endpoint not ready"

        # 通过 CDP 连接 Playwright
        try:
            self._cdp_browser = await self._playwright.chromium.connect_over_cdp(cdp_url)
            # 获取 context 和 page
            if self._cdp_browser.contexts:
                self.context = self._cdp_browser.contexts[0]
                pages = self.context.pages
                self.page = pages[0] if pages else await self.context.new_page()
            else:
                self.context = await self._cdp_browser.new_context()
                self.page = await self.context.new_page()

            self._emulator_mode = True
            self.browser = None
            safe_print("  ✅ Android 模拟器模式就绪")
            return "started"
        except Exception as e:
            return f"error:cdp connect failed: {e}"

    async def _stop_emulator(self):
        """停止模拟器（优雅）"""
        adb = self._find_adb()
        if adb:
            # 移除端口转发
            await self._run_adb(adb, "forward --remove tcp:9222", timeout=5)
            # 发送优雅关闭命令
            await self._run_adb(adb, "emu kill", timeout=10)

        # 管理模拟器进程
        if self._emulator_process and self._emulator_process.returncode is None:
            try:
                await asyncio.wait_for(self._emulator_process.wait(), timeout=10)
            except asyncio.TimeoutError:
                try:
                    self._emulator_process.terminate()
                    await asyncio.wait_for(self._emulator_process.wait(), timeout=10)
                except asyncio.TimeoutError:
                    try:
                        self._emulator_process.kill()
                        await asyncio.wait_for(self._emulator_process.wait(), timeout=5)
                    except Exception:
                        pass

    async def _cleanup_emulator(self):
        """强制清理模拟器资源（不等待）"""
        # 断开 CDP
        if self._cdp_browser:
            try:
                await self._cdp_browser.close()
            except Exception:
                pass
            self._cdp_browser = None

        # 清理 context 和 page
        for obj in [self.page, self.context]:
            if obj:
                try:
                    await obj.close()
                except Exception:
                    pass
        self.page = None
        self.context = None

        # 杀掉模拟器进程
        if self._emulator_process and self._emulator_process.returncode is None:
            try:
                self._emulator_process.kill()
            except Exception:
                pass
            self._emulator_process = None
        # 运行 adb emu kill 作为兜底
        adb = self._find_adb()
        if adb:
            await self._run_adb(adb, "emu kill", timeout=5)

        self._emulator_mode = False
        self._adb_serial = None

    async def _check_emulator_health(self) -> bool:
        """检查模拟器健康状况"""
        if not self._emulator_mode:
            return True

        # 检查模拟器进程是否还在运行
        if self._emulator_process and self._emulator_process.returncode is not None:
            self.last_error = "模拟器进程已退出"
            return False

        # 检查 adb 连通性
        adb = self._find_adb()
        if not adb:
            return False

        result = await self._run_adb(adb, "shell echo ping", timeout=5)
        if not result or "ping" not in result:
            self.last_error = "模拟器 adb 连接断开"
            return False

        # 检查 CDP 连接
        if self._cdp_browser:
            try:
                contexts = self._cdp_browser.contexts
                if contexts and contexts[0].pages:
                    return True
            except Exception:
                pass

        # 尝试重新连接 CDP
        try:
            result = await self._wait_for_cdp()
            return result == "started"
        except Exception:
            return False

    async def _cleanup(self):
        """安全清理所有资源（含模拟器）"""
        # 先清理模拟器
        if self._emulator_mode:
            await self._stop_emulator()
            self._emulator_mode = False

        # 清理 Playwright 对象
        for obj_name in ["page", "context", "browser", "_playwright"]:
            obj = getattr(self, obj_name, None)
            if obj:
                try:
                    if hasattr(obj, "close"):
                        await obj.close()
                    elif hasattr(obj, "stop"):
                        await obj.stop()
                except Exception:
                    pass
                setattr(self, obj_name, None)

        # 额外清理 CDP browser
        if self._cdp_browser:
            try:
                await self._cdp_browser.close()
            except Exception:
                pass
            self._cdp_browser = None

    async def _is_page_alive(self) -> bool:
        """检查页面是否还活着（支持 CDP 模式）"""
        # CDP 模式下的检查
        if self._emulator_mode and self._cdp_browser:
            try:
                contexts = self._cdp_browser.contexts
                if contexts:
                    pages = contexts[0].pages
                    return len(pages) > 0
                return False
            except Exception:
                return False

        # 常规 Playwright 模式下的检查
        if not self.page:
            return False
        try:
            await self.page.evaluate("1")
            return True
        except Exception:
            return False

    # ==================== 健康检查 ====================

    def _start_health_check(self):
        """启动后台健康检查（每60秒一次，含模拟器监控）"""

        async def _health_loop():
            while True:
                await asyncio.sleep(60)
                try:
                    # 模拟器模式下的额外检查
                    if self._emulator_mode:
                        emulator_ok = await self._check_emulator_health()
                        if not emulator_ok:
                            self.status = "crashed"
                            if not self.last_error:
                                self.last_error = "模拟器异常"
                            continue

                    # 常规页面存活检查
                    alive = await self._is_page_alive()
                    if not alive:
                        self.status = "crashed"
                        self.last_error = "浏览器页面已无响应（可能被手动关闭）"
                    elif self.status == "crashed":
                        self.status = "running"
                        self.last_error = ""
                except Exception:
                    pass

        self._health_task = asyncio.create_task(_health_loop())

    # ==================== 反拦截检测 ====================

    async def is_page_blocked(self) -> bool:
        """检测当前页面是否被小红书限制访问"""
        if not self.page:
            return False
        try:
            text = await self.page.text_content("body")
            if not text:
                return False
            block_keywords = [
                "当前笔记暂时无法浏览",
                "请打开小红书App扫码查看",
                "暂时无法浏览",
                "小红书如何扫码",
                "访问受限",
            ]
            for kw in block_keywords:
                if kw in text:
                    self.last_error = f"页面被限制: {kw}"
                    return True
            return False
        except Exception:
            return False

    async def safe_go_to(self, url: str, max_retries: int = 2) -> bool:
        """安全导航，检测是否被限制"""
        for attempt in range(max_retries):
            try:
                await self.page.goto(url, wait_until="domcontentloaded", timeout=30000)
                await self.random_delay(3, 6)
                if await self.is_page_blocked():
                    safe_print(f"  ⛔ 页面被限制，跳过: {url}")
                    return False
                return True
            except Exception as e:
                safe_print(f"  ⚠ 导航失败(尝试{attempt+1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    await self.random_delay(5, 10)
        return False

    # ==================== 登录管理 ====================

    async def _check_login(self) -> bool:
        """检查小红书是否已登录"""
        if not self.page:
            return False
        try:
            await self.page.goto(
                "https://www.xiaohongshu.com/explore",
                wait_until="domcontentloaded",
                timeout=20000,
            )
            await self.random_delay(3, 5)

            if await self.is_page_blocked():
                self.last_error = "小红书对当前浏览器环境进行了限制，请在浏览器窗口中手动处理"
                return False

            avatar = await self.page.query_selector('[class*="avatar"]')
            if avatar:
                self.login_status = "logged_in"
                return True

            current_url = self.page.url
            if "login" in current_url:
                self.login_status = "expired"
                return False

            login_btn = await self.page.query_selector(
                'text=登录, [class*="login"]'
            )
            if login_btn:
                self.login_status = "expired"
                return False

            self.login_status = "logged_in"
            return True
        except Exception as e:
            self.last_error = f"登录检查失败: {e}"
            return False

    async def wait_for_qr_login(self, timeout_seconds: int = 180) -> bool:
        """跳转到登录页，等待用户扫码登录"""
        if not self.page:
            raise RuntimeError("浏览器未启动")

        await self.page.goto(
            "https://www.xiaohongshu.com/login",
            wait_until="domcontentloaded",
        )
        await self.random_delay(3, 5)

        for i in range(timeout_seconds):
            await asyncio.sleep(1)
            try:
                current_url = self.page.url
                if "explore" in current_url:
                    if self._account_id:
                        await self.save_cookies(self._account_id)
                    self.login_status = "logged_in"
                    return True
                avatar = await self.page.query_selector('[class*="avatar"]')
                if avatar:
                    if self._account_id:
                        await self.save_cookies(self._account_id)
                    self.login_status = "logged_in"
                    return True
                if i > 0 and i % 15 == 0:
                    safe_print(f"  等待扫码中... 已等待{i}秒")
            except Exception:
                pass

        return False

    # ==================== Cookie 管理 ====================

    async def save_cookies(self, account_id: int):
        """保存 Cookie 到文件（支持 CDP 模式）"""
        path = COOKIE_DIR / f"account_{account_id}.json"
        try:
            # 优先使用 context API
            if self.context:
                cookies = await self.context.cookies()
            elif self._emulator_mode and self._cdp_browser:
                # CDP 模式回退：用 CDP 直接获取
                cookies = await self._cdp_browser.contexts[0].cookies()
            else:
                return

            with open(path, "w", encoding="utf-8") as f:
                f.write(encrypt_text(json.dumps(cookies, ensure_ascii=False, indent=2)))
            safe_print(f"  Cookie 已保存: {path.name}")
        except Exception as e:
            safe_print(f"保存 Cookie 失败: {e}")

    async def load_cookies(self, account_id: int) -> bool:
        """从文件加载 Cookie（支持 CDP 模式）"""
        path = COOKIE_DIR / f"account_{account_id}.json"
        if not path.exists():
            return False
        try:
            with open(path, "r", encoding="utf-8") as f:
                cookies = json.loads(decrypt_text(f.read().strip()))

            # 尝试用 context API
            if self.context:
                await self.context.add_cookies(cookies)
                return True
            elif self._emulator_mode and self._cdp_browser:
                await self._cdp_browser.contexts[0].add_cookies(cookies)
                return True

            return False
        except Exception as e:
            safe_print(f"加载 Cookie 失败: {e}")
            return False

    def has_cookies(self, account_id: int) -> bool:
        """检查是否有 Cookie 文件"""
        path = COOKIE_DIR / f"account_{account_id}.json"
        return path.exists()

    # ==================== 拟人化操作 ====================

    async def human_scroll(self, min_times: int = 1, max_times: int = 4):
        """模拟翻页节奏：随机滚动一段距离，停一下，再看"""
        if not self.page:
            return
        times = random.randint(min_times, max_times)
        for _ in range(times):
            try:
                # 随机滚动距离（200-700px）
                delta = random.randint(200, 700)
                await self.page.evaluate(f"window.scrollBy(0, {delta})")
                # 滚动后停顿一下，像在阅读
                await self.human_pause(0.8, 2.5)
            except Exception:
                break

    async def human_pause(self, min_s: float = 1.0, max_s: float = 4.0):
        """随机停顿，模拟自然的反应时间"""
        await asyncio.sleep(random.uniform(min_s, max_s))

    async def simulate_reading(self, min_s: float = 3.0, max_s: float = 10.0):
        """模拟阅读内容，随机停留一段时间"""
        # 短内容读得快，长内容读得慢
        base = random.uniform(min_s, max_s)
        # 偶尔走神（长时间停顿）
        if random.random() < 0.15:  # 15%概率走神
            base += random.uniform(3, 8)
        await asyncio.sleep(base)

    async def simulate_typing(self, input_element, text: str):
        """模拟自然打字：真实按键间隔 + 偶尔打错 + 思考停顿"""
        if not text:
            return

        # 先思考一下再开始打字
        await self.human_pause(0.5, 2.0)

        # 逐字输入
        for i, char in enumerate(text):
            # 每打几个字偶然停顿（像在思考）
            if i > 0 and i % random.randint(5, 15) == 0:
                await self.human_pause(0.3, 1.2)

            # 小概率打错字（约3%概率）
            if random.random() < 0.03 and len(text) > 5:
                # 输入一个错误字符
                wrong_char = random.choice("abcdefghijklmnopqrstuvwxyz，。！？了的")
                await input_element.type(wrong_char, delay=random.randint(80, 250))
                await self.human_pause(0.2, 0.6)
                # 按退格删除
                await self.page.keyboard.press("Backspace")
                await self.human_pause(0.2, 0.5)

            # 正常输入
            await input_element.type(char, delay=random.randint(60, 350))

        # 打完后停顿一下（检查自己打了什么）
        await self.human_pause(0.5, 1.5)

    async def simulate_mouse_move(self, element=None):
        """模拟鼠标移动（Playwright 自动模拟，这里加随机偏移）"""
        if not self.page:
            return
        try:
            # 随机鼠标位置微调
            x = random.randint(0, 100)
            y = random.randint(0, 50)
            await self.page.mouse.move(x, y)
            await self.human_pause(0.1, 0.3)
        except Exception:
            pass

    # ==================== 小红书操作 ====================

    async def go_to(self, url: str):
        """导航到页面"""
        await self.safe_go_to(url)

    async def search_notes(self, keyword: str, max_results: int = 8) -> list[dict]:
        """搜索笔记（拟人化：慢速搜索 + 翻页浏览）
        
        使用多种策略提取笔记信息，应对小红书动态类名
        """
        search_url = f"https://www.xiaohongshu.com/search_result?keyword={keyword}"
        ok = await self.safe_go_to(search_url)
        if not ok:
            return []

        # 先浏览搜索结果
        await self.human_scroll(2, 5)
        await self.simulate_reading(2, 5)

        notes = []

        # 策略1: 通过 explore 链接找笔记卡片
        try:
            # 等待页面加载笔记
            await asyncio.sleep(3)
            
            # 找所有 explore 链接
            all_links = await self.page.query_selector_all(
                'a[href*="/explore/"]'
            )
            
            seen_urls = set()
            for link in all_links:
                try:
                    href = await link.get_attribute("href")
                    if not href:
                        continue
                    
                    # 标准化 URL
                    if href.startswith("/"):
                        full_url = f"https://www.xiaohongshu.com{href}"
                    elif href.startswith("http"):
                        full_url = href
                    else:
                        continue
                    
                    if full_url in seen_urls:
                        continue
                    seen_urls.add(full_url)
                    
                    # 尝试从链接或其父级提取标题
                    title = ""
                    try:
                        # 尝试直接从链接取文本
                        title = (await link.inner_text()).strip()
                    except Exception:
                        pass
                    
                    if not title:
                        try:
                            # 尝试从父级取文本
                            parent = await link.evaluate("el => el.closest('section, div, li')")
                            if parent:
                                # 执行 JS 获取卡片中的标题文本
                                title = await self.page.evaluate("""
                                    (link) => {
                                        const card = link.closest('section, div, li, a');
                                        if (!card) return '';
                                        // 尝试多种选择器找标题
                                        const titleEl = card.querySelector('[class*="title"]') || 
                                                         card.querySelector('h1, h2, h3, h4') ||
                                                         card.querySelector('span') ||
                                                         link;
                                        return titleEl ? titleEl.textContent.trim() : '';
                                    }
                                """, link)
                        except Exception:
                            pass
                    
                    if not title:
                        title = ""  # 兜底
                    
                    notes.append({
                        "title": title[:100] if title else "",
                        "url": full_url,
                        "author": "",
                    })
                    
                    if len(notes) >= max_results:
                        break
                        
                except Exception:
                    continue
        except Exception as e:
            safe_print(f"  搜索笔记异常: {e}")

        # 策略2: 如果策略1没找到，用 JS 直接提取
        if not notes:
            try:
                note_data = await self.page.evaluate("""
                    () => {
                        const results = [];
                        // 找所有包含 /explore/ 的链接
                        const links = document.querySelectorAll('a[href*="/explore/"]');
                        const seen = new Set();
                        
                        for (const link of links) {
                            let href = link.getAttribute('href');
                            if (!href || seen.has(href)) continue;
                            seen.add(href);
                            
                            let url = href.startsWith('/') ? 'https://www.xiaohongshu.com' + href : href;
                            let title = link.textContent.trim() || '';
                            
                            // 尝试从附近元素找标题
                            if (!title) {
                                const parent = link.closest('section, div, li');
                                if (parent) {
                                    const t = parent.querySelector('[class*="title"], h1, h2, h3, h4, span');
                                    if (t) title = t.textContent.trim();
                                }
                            }
                            
                            results.push({title: title, url: url, author: ''});
                        }
                        return results;
                    }
                """)
                notes = note_data[:max_results]
            except Exception:
                pass

        safe_print(f"  搜索到 {len(notes)} 篇笔记")
        return notes

# ==================== 账号诊断·笔记采样 ====================

    async def get_user_notes(self, profile_url: str, max_results: int = 20) -> list[dict]:
        """采集某小红书用户主页的笔记列表（诊断他人的号用）

        打开主页 → 浏览 → 提取 /explore/ 笔记卡片（标题+URL+作者）。
        Returns: [{title, url, author}, ...]
        """
        ok = await self.safe_go_to(profile_url)
        if not ok:
            return []

        # 先浏览主页，翻几屏让列表加载
        await self.human_scroll(3, 8)
        await self.simulate_reading(2, 5)

        notes = []
        seen = set()
        try:
            items = await self.page.evaluate("""
                () => {
                    const out = [];
                    const seen = new Set();
                    const nodes = document.querySelectorAll('a[href*="/explore/"]');
                    for (const a of nodes) {
                        let href = a.getAttribute('href');
                        if (!href || seen.has(href)) continue;
                        seen.add(href);
                        let url = href.startsWith('/') ? 'https://www.xiaohongshu.com' + href : href;
                        let title = (a.textContent || '').trim();
                        if (!title) {
                            const card = a.closest('section, div, li');
                            if (card) {
                                const t = card.querySelector('[class*="title"], h1, h2, h3, [class*="footer"] > div');
                                if (t) title = t.textContent.trim();
                            }
                        }
                        // 作者：从附近问号/头像块里找昵称
                        let author = '';
                        const card = a.closest('section, div, li');
                        if (card) {
                            const au = card.querySelector('[class*="author"]');
                            if (au) author = au.textContent.trim();
                        }
                        out.push({title: (title||'').slice(0,120), url, author});
                    }
                    return out;
                }
            """)
            for it in items:
                if len(notes) >= max_results:
                    break
                if it['url'] in seen:
                    continue
                seen.add(it['url'])
                notes.append({
                    'title': it.get('title') or '',
                    'url': it.get('url') or '',
                    'author': it.get('author') or '',
                })
        except Exception as e:
            safe_print(f"  采集主页笔记异常: {e}")

        # 兜底：本页再抓一次 explore 链接
        if not notes:
            try:
                links = await self.page.query_selector_all('a[href*="/explore/"]')
                for link in links:
                    if len(notes) >= max_results:
                        break
                    href = await link.get_attribute("href")
                    if not href:
                        continue
                    url = href if href.startswith("http") else f"https://www.xiaohongshu.com{href}"
                    if url in seen:
                        continue
                    seen.add(url)
                    title = ""
                    try:
                        title = (await link.inner_text()).strip()
                    except Exception:
                        pass
                    notes.append({'title': title[:120], 'url': url, 'author': ''})
            except Exception:
                pass

        safe_print(f"  采集到用户主页笔记 {len(notes)} 篇")
        return notes

    async def get_note_content(self, note_url: str) -> dict:
        """获取单篇笔记内容（拟人化 + JS 提取，适配动态类名）"""
        ok = await self.safe_go_to(note_url)
        if not ok:
            return {"title": "", "content": "", "author": "", "_blocked": True}

        # 模拟阅读笔记：滚动，停顿
        await self.human_scroll(1, 3)
        await self.simulate_reading(3, 8)

        result = {"title": "", "content": "", "author": "", "_blocked": False}
        
        # 用 JS 提取内容，适配小红书动态类名
        try:
            page_data = await self.page.evaluate("""
                () => {
                    const data = { title: '', content: '', author: '' };
                    
                    // 从 og:title 取标题
                    const ogTitle = document.querySelector('meta[property="og:title"]');
                    if (ogTitle) data.title = ogTitle.getAttribute('content') || '';
                    
                    // 从页面标题取
                    if (!data.title && document.title) {
                        data.title = document.title.replace(/ - 小红书.*$/, '').trim();
                    }
                    
                    // 从 h1 取
                    if (!data.title) {
                        const h1 = document.querySelector('h1');
                        if (h1) data.title = h1.textContent.trim();
                    }
                    
                    // 从 og:description 取正文
                    const ogDesc = document.querySelector('meta[property="og:description"]');
                    if (ogDesc) data.content = ogDesc.getAttribute('content') || '';
                    
                    // 从 body 文本取正文
                    if (!data.content) {
                        const lines = document.body.innerText.split('\\n').filter(l => l.trim().length > 20);
                        for (const line of lines) {
                            if (line !== data.title) {
                                data.content = line;
                                break;
                            }
                        }
                    }
                    
                    // 提取作者
                    const authorMeta = document.querySelector('meta[name="author"]');
                    if (authorMeta) data.author = authorMeta.getAttribute('content') || '';
                    
                    return data;
                }
            """)
            result.update(page_data)
        except Exception as e:
            safe_print(f"获取笔记内容失败: {e}")
            
        return result

    # ================= 全场景截流：采集原语 =================

    @staticmethod
    def _num_of(text: str) -> int:
        """把小红书点赞/评论数字文本转成 int：'12'->12, '1.2万'->12000，空->0"""
        if not text:
            return 0
        t = (text or "").replace(",", "").replace("，", "").strip()
        if not t:
            return 0
        multi = 1
        if "万" in t:
            multi = 10000
            t = t.replace("万", "")
        try:
            return int(float(t) * multi)
        except Exception:
            return 0

    async def list_metrics(self, list_url: str, max_results: int = 20) -> list[dict]:
        """列表级采集(L1)：打开一个列表页(搜索/发现/同城)，抓取笔记卡片。
        列表页只能拿到 标题/作者/点赞/排名(顺序)，评论与收藏需点进(L2)。
        Returns: [{title, url, author, likes, rank}, ...]
        """
        ok = await self.safe_go_to(list_url)
        if not ok:
            return []
        await self.human_scroll(2, 5)
        await self.simulate_reading(2, 5)
        raw = []
        try:
            raw = await self.page.evaluate("""
                () => {
                    const cards = [];
                    const seen = new Set();
                    const nodes = document.querySelectorAll('a[href*="/explore/"]');
                    let rank = 0;
                    for (const a of nodes) {
                        let href = a.getAttribute('href');
                        if (!href) continue;
                        let url = href.startsWith('/') ? 'https://www.xiaohongshu.com' + href : href;
                        if (seen.has(url)) continue;
                        seen.add(url);
                        rank += 1;
                        const idm = href.match(/\\/explore\\/([^\\/#\\?]+)/);
                        const noteId = idm ? idm[1] : '';
                        const card = a.closest('section, div, li');
                        let title = (a.textContent || '').trim();
                        let author = '';
                        let likesText = '';
                        if (card) {
                            if (!title) {
                                const t = card.querySelector('[class*="title"], h1, h2, h3');
                                if (t) title = t.textContent.trim();
                            }
                            const au = card.querySelector('[class*="author"]');
                            if (au) author = au.textContent.trim();
                            // 点赞数：footer 里的数字/“xx赞”
                            const footer = card.querySelector('[class*="footer"]');
                            if (footer) {
                                const likeEl = footer.querySelector('[class*="like"],[class*="count"] svg, [class*="count"]');
                                if (likeEl) {
                                    const parent = likeEl.closest('[class*="footer"] > div, div');
                                    if (parent) likesText = parent.textContent.trim();
                                    if (!likesText) likesText = footer.textContent.trim();
                                }
                                if (!likesText) likesText = footer.textContent.trim();
                            }
                        }
                        cards.push({title: (title||'').slice(0,120), url, note_id: noteId, author: (author||'').slice(0,80), likesText, rank});
                    }
                    // 若没抓到点赞文本，回退取每个卡片 footer 里唯一的数字
                    return cards;
                }
            """)
        except Exception as e:
            safe_print(f"列表级采集异常: {e}")
        out = []
        seen = set()
        for it in raw:
            url = it.get("url") or ""
            if not url or url in seen:
                continue
            seen.add(url)
            out.append({
                "title": it.get("title") or "",
                "url": url,
                "note_id": it.get("note_id") or "",
                "author": it.get("author") or "",
                "likes": self._num_of(it.get("likesText")),
                "rank": int(it.get("rank") or 0),
            })
            if len(out) >= max_results:
                break
        return out

    async def point_metrics(self, note_url: str) -> dict:
        """点进级采集(L2)：进入单篇笔记，拿 点赞/评论/收藏/分享。返回 dict，失败时 likes=-1。"""
        ok = await self.safe_go_to(note_url)
        if not ok:
            return {"likes": -1, "comments": -1, "collects": -1, "shares": -1, "_blocked": True}
        await self.human_scroll(1, 3)
        await self.simulate_reading(3, 6)
        try:
            data = await self.page.evaluate("""
                () => {
                    const txt = document.body.innerText || '';
                    const m = (re) => { const v = txt.match(re); return v ? v[1] : ''; };
                    return {
                        likesText: m(/([\\d.,\\u4e07]+)\\s*(赞|次赞|喜欢)/),
                        commentsText: m(/([\\d.,\\u4e07]+)\\s*(评论)/),
                        collectsText: m(/([\\d.,\\u4e07]+)\\s*(收藏)/),
                        sharesText: m(/([\\d.,\\u4e07]+)\\s*(分享)/),
                        title: (document.querySelector('meta[property="og:title"]')||{}).content || document.title || '',
                    };
                }
            """)
            return {
                "likes": self._num_of(data.get("likesText")),
                "comments": self._num_of(data.get("commentsText")),
                "collects": self._num_of(data.get("collectsText")),
                "shares": self._num_of(data.get("sharesText")),
                "title": (data.get("title") or "").replace(" - 小红书", "").strip(),
                "_blocked": False,
            }
        except Exception as e:
            safe_print(f"点进级采集异常: {e}")
            return {"likes": -1, "comments": -1, "collects": -1, "shares": -1, "_blocked": True}

    async def hot_comment_top(self, note_url: str) -> dict:
        """取单篇笔记下点赞最高的热评(高V/话题用)。当前页须已停在笔记。"""
        await self.human_scroll(1, 2)
        try:
            data = await self.page.evaluate("""
                () => {
                    const items = document.querySelectorAll('[class*="comment"]');
                    let best = {likes: 0, author: '', content: '', found: false};
                    for (const it of items) {
                        const txt = it.textContent || '';
                        if (!it.querySelector('[class*="content"]') && txt.length < 4) continue;
                        const thumb = it.querySelector('[class*="like"],[class*="count"]');
                        const likeTxt = thumb ? (thumb.textContent || '').trim() : '';
                        const num = (() => { const v = likeTxt.replace(/[^0-9.\\u4e07]/g, ''); const mul = v.includes('万') ? 10000 : 1; const n = parseFloat(v) * mul; return isNaN(n) ? 0 : n; })();
                        if (num >= best.likes && (it.querySelector('[class*="content"]') || txt.length > 10)) {
                            best.likes = num;
                            best.found = true;
                            const c = it.querySelector('[class*="content"]');
                            best.content = c ? c.textContent.trim().slice(0,120) : txt.trim().slice(0,120);
                        }
                    }
                    return best;
                }
            """)
            return data or {"found": False, "likes": 0, "author": "", "content": ""}
        except Exception as e:
            safe_print(f"热评采集异常: {e}")
            return {"found": False, "likes": 0, "author": "", "content": ""}

    async def my_comment_status(self, our_comment_text: str) -> dict:
        """在已停在本笔记的页面上，按评论文本匹配查找我方评论，返回其 赞/回复/排序位置。
        找不到返回 {found: False}。用于活水判死与已爆判断。"""
        probe = (our_comment_text or "").strip()[:40]
        try:
            data = await self.page.evaluate("""
                (probe) => {
                    const items = Array.from(document.querySelectorAll('[class*="comment"]'));
                    for (let i = 0; i < items.length; i++) {
                        const it = items[i];
                        // 只取真正的一级评论内容块
                        const c = it.querySelector('[class*="content"]');
                        if (!c) continue;
                        const text = c.textContent.trim();
                        if (text && probe && (text.includes(probe) || probe.includes(text.slice(0,20)))) {
                            const thumb = it.querySelector('[class*="like"],[class*="count"]');
                            const likeText = thumb ? (thumb.textContent||'').trim() : '';
                            const v = likeText.replace(/[^0-9.\\u4e07]/g, '');
                            const likes = v.includes('万') ? Math.round(parseFloat(v)*10000) : (parseInt(v.replace(/[.,]/g,''))||0);
                            return {found: true, likes, replies: 0, rank: i+1, content: text.slice(0,60)};
                        }
                    }
                    return {found: false};
                }
            """, probe)
            return data or {"found": False}
        except Exception:
            return {"found": False}

    async def delete_comment(self, text_match: str) -> bool:
        """活水删除：在已停在本笔记的页面，定位匹配文本的评论并尝试删除。尽力而为。"""
        probe = (text_match or "").strip()[:40]
        try:
            target = await self.page.evaluate_handle(
                """(probe) => {
                    const items = Array.from(document.querySelectorAll('[class*="comment"]'));
                    for (const it of items) {
                        const c = it.querySelector('[class*="content"]');
                        if (!c) continue;
                        const text = c.textContent.trim();
                        if (text && probe && (text.includes(probe) || probe.includes(text.slice(0,20)))) {
                            return it;
                        }
                    }
                    return null;
                }""", probe)
        except Exception:
            return False
        if target is None:
            return False
        try:
            # 尝试悬停弹出更多/删除入口
            await target.hover()
            await self.human_pause(0.5, 1.2)
            clicked = False
            for sel in ['[class*="delete"]', '[class*="more"]', 'text=删除', 'text=更多']:
                btn = await self.page.query_selector(sel)
                if btn:
                    await btn.click()
                    await self.human_pause(0.4, 1.0)
                    clicked = True
                    break
            if not clicked:
                return False
            # 确认按钮
            for sel in ['button:has-text("删除")', '[class*="confirm"]:has-text("删除")', 'text="删除"']:
                try:
                    btn = await self.page.query_selector(sel)
                    if btn:
                        await btn.click()
                        await self.human_pause(1, 2)
                        return True
                except Exception:
                    continue
            return False
        except Exception:
            return False

    async def latest_note_of_user(self, profile_url: str) -> dict:
        """高V获取方式：取白名单用户主页最新一篇笔记。复用 get_user_notes，取第一篇。"""
        notes = await self.get_user_notes(profile_url, max_results=3)
        if not notes:
            return {}
        return notes[0]

    async def _find_comment_input(self):
        """多策略查找评论输入框（小红书动态类名兼容）"""
        if not self.page:
            return None
        selectors = [
            'div[contenteditable="true"]',
            '[contenteditable="true"]',
            'textarea',
            'input[type="text"]',
            '[class*="comment-input"]',
            '[class*="commentInput"]',
            '[class*="chat-input"]',
            '[class*="draft"]',
            '[placeholder*="评论"]',
            '[placeholder*="说点什么"]',
            '[placeholder*="写评论"]',
            '[placeholder*="回复"]',
            '[role="textbox"]',
            '.public-DraftEditor-content',
            '[data-testid="comment-input"]',
        ]
        for sel in selectors:
            try:
                el = await self.page.query_selector(sel)
                if el and await el.is_visible():
                    return el
            except Exception:
                continue
        return None

    async def _click_comment_area(self):
        """尝试点击评论区来激活输入框"""
        if not self.page:
            return
        selectors = [
            '[class*="comment-container"]',
            '[class*="interaction"]',
            '[class*="footer"]',
            'footer',
            '[class*="bottom"]',
        ]
        for sel in selectors:
            try:
                el = await self.page.query_selector(sel)
                if el and await el.is_visible():
                    await el.click()
                    return
            except Exception:
                continue

    async def _click_submit_button(self) -> bool:
        """多策略查找并点击发布/发送按钮"""
        if not self.page:
            return False
        selectors = [
            'button:has-text("发布")',
            'button:has-text("发送")',
            'button:has-text("评论")',
            '[class*="submit"]',
            '[class*="send"]',
            '[class*="publish"]',
            'div[class*="send-btn"]',
            'span:has-text("发布")',
            'button svg:last-child',
        ]
        for sel in selectors:
            try:
                btn = await self.page.query_selector(sel)
                if btn and await btn.is_visible():
                    await self.human_pause(0.5, 2)
                    await btn.click()
                    return True
            except Exception:
                continue
        return False

    async def comment_on_note(self, note_url: str, comment_text: str, skip_goto: bool = False) -> bool:
        """在笔记下评论（拟人化：阅读→思考→打字→检查→发布）
        skip_goto=True：页面已停在目标笔记（刚 get_note_content 过），跳过重复导航，避免同 URL 单周期重复加载"""
        if not skip_goto:
            ok = await self.safe_go_to(note_url)
            if not ok:
                return False

        # 1. 先阅读笔记内容
        await self.human_scroll(2, 4)
        await self.simulate_reading(5, 15)

        # 2. 找到评论输入框（小红书使用动态类名，多策略查找）
        try:
            comment_input = await self._find_comment_input()
            if not comment_input:
                await self._click_comment_area()
                await self.human_pause(1, 2)
                comment_input = await self._find_comment_input()

            if not comment_input:
                await self.page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                await self.human_pause(1, 2)
                comment_input = await self._find_comment_input()

            if not comment_input:
                safe_print("  ⚠️ 未找到评论输入框，跳过")
                return False

            # 3. 点击输入框，思考
            await self.simulate_mouse_move()
            await comment_input.click()
            await self.human_pause(1, 4)

            # 4. 先输入空格激活（小红书有时需要先点击激活）
            try:
                await comment_input.type(" ", delay=50)
                await self.human_pause(0.3, 0.8)
                await self.page.keyboard.press("Backspace")
                await self.human_pause(0.3, 0.8)
            except Exception:
                pass

            # 5. 逐字输入
            await self.simulate_typing(comment_input, comment_text)

            # 6. 输入完后停顿检查
            await self.human_pause(1, 3)

            # 7. 找发布按钮
            posted = await self._click_submit_button()
            if not posted:
                safe_print("  ⚠️ 未找到发布按钮，尝试 Ctrl+Enter")
                try:
                    await self.page.keyboard.press("Control+Enter")
                    await self.human_pause(1, 2)
                    posted = True  # Ctrl+Enter 可能成功
                except Exception:
                    pass

            # 8. 发布后停顿
            await self.human_pause(2, 4)
            return posted

        except Exception as e:
            safe_print(f"评论失败: {e}")
            return False

    async def reply_to_comment(self, note_url: str, reply_text: str) -> bool:
        """回复评论"""
        ok = await self.safe_go_to(note_url)
        if not ok:
            return False

        await self.human_scroll(1, 2)
        await self.simulate_reading(3, 8)

        try:
            # 多策略查找回复按钮
            reply_btns = None
            for sel in [
                '[class*="reply"]',
                'span:has-text("回复")',
                'div:has-text("回复")',
                'button:has-text("回复")',
            ]:
                reply_btns = await self.page.query_selector_all(sel)
                if reply_btns:
                    break

            if not reply_btns:
                return False

            await reply_btns[0].click()
            await self.human_pause(1, 2)

            input_box = await self._find_comment_input()
            if input_box:
                await self.simulate_typing(input_box, reply_text)
                await self.human_pause(1, 2)
                posted = await self._click_submit_button()
                await self.human_pause(2, 4)
                return posted

            return False
        except Exception as e:
            safe_print(f"回复失败: {e}")
            return False

    async def publish_note(self, title: str, content: str,
                           image_paths: list[str], tags: list[str]) -> bool:
        """发布图文笔记：进信息流 → 打开发布器(等就绪) → 上传多图(首图作封面) → 填标题 → 按段填正文 → 填话题标签 → 发布"""
        ok = await self.safe_go_to("https://www.xiaohongshu.com/explore")
        if not ok:
            return False

        await self.human_pause(2, 4)
        try:
            # 1) 找到并点开「发布」入口（等待元素出现，不用固定 sleep 猜）
            publish_btn = await self.wait_first(
                'button:has-text("发布"), [class*="publish"]', timeout=15000
            )
            if not publish_btn:
                safe_print("[发布] 未找到发布入口")
                return False
            try:
                await publish_btn.click()
            except Exception:
                await self.page.locator('button:has-text("发布"), [class*="publish"]').first.click(force=True)
            await self.human_pause(3, 5)

            # 2) 等发布编辑器就绪（出现标题/正文输入区），失败也继续尝试
            await self.wait_first(
                'input[placeholder*="标题"], [contenteditable="true"], [placeholder*="正文"]',
                timeout=15000,
            )
            await self.human_pause(2, 3)

            # 3) 上传多图（小红书默认第一张为封面；列表顺序 = 发布顺序）
            if image_paths:
                file_input = await self.wait_first('input[type="file"]', timeout=10000)
                if file_input:
                    await file_input.set_input_files(list(image_paths))
                    await self.human_pause(5, 8)  # 等待图片上传渲染
                    await self._wait_upload_stable()

            # 4) 标题（限制 20 字上下，防超限）
            title_input = await self.wait_first(
                'input[placeholder*="标题"], [class*="title"] input', timeout=10000
            )
            if title_input:
                await title_input.click()
                await self.simulate_typing(title_input, (title or "").strip())

            # 5) 正文（内容可含 \n 分段，逐段输入 + 回车换段）
            content_input = await self.wait_first(
                '[contenteditable="true"], [placeholder*="正文"]', timeout=10000
            )
            if content_input and content:
                await content_input.click()
                segments = (content or "").split("\n")
                for seg in segments:
                    seg = seg.strip()
                    if seg:
                        await self.simulate_typing(content_input, seg)
                    await self.page.keyboard.press("Enter")
                    await self.human_pause(0.2, 0.4)

            # 6) 话题标签（输入 + 回车加入）
            if tags:
                tag_input = await self.wait_first(
                    'input[placeholder*="话题"], [placeholder*="标签"]', timeout=8000
                )
                if tag_input:
                    for tag in tags:
                        t = str(tag).strip().lstrip("#")
                        if not t:
                            continue
                        await tag_input.click()
                        await self.simulate_typing(tag_input, t)
                        await self.page.keyboard.press("Enter")
                        await self.human_pause(0.5, 1.2)

            # 7) 点「发布」提交
            submit = await self.wait_first(
                'button:has-text("发布"), [class*="submit"]', timeout=10000
            )
            if not submit:
                safe_print("[发布] 未找到发布按钮")
                return False
            await self.human_pause(2, 4)
            await submit.click()
            await self.human_pause(4, 7)
            return True
        except Exception as e:
            safe_print(f"发布笔记失败: {e}")
            return False

    async def wait_first(self, selector: str, timeout: float = 10000):
        """等待元素出现并返回（Playwright），超时返回 None，不抛错"""
        try:
            return await self.page.wait_for_selector(selector, timeout=timeout)
        except Exception:
            return None

    async def _wait_upload_stable(self):
        """多图上传后等待图片缩略图渲染稳定，避免上传未完成就填文字导致顺序错乱"""
        try:
            await self.page.wait_for_timeout(2000)
        except Exception:
            pass

    # ==================== 工具 ====================

    async def random_delay(self, min_s: float = 2.0, max_s: float = 5.0):
        """随机延迟（比之前更慢）"""
        await asyncio.sleep(random.uniform(min_s, max_s))


# 全局单例
browser_engine = BrowserEngine()
