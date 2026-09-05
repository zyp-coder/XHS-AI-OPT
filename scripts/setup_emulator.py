#!/usr/bin/env python3
"""
小红书运营助手 - Android 模拟器环境安装脚本
一键安装 Android SDK、创建 AVD、安装 Chrome for Android

用法:
    python3 scripts/setup_emulator.py              # 正常安装
    python3 scripts/setup_emulator.py --sdk D:/Android/Sdk  # 自定义 SDK 目录
    python3 scripts/setup_emulator.py --skip-download       # 跳过 SDK 下载（已有 SDK）

要求:
    - Python 3.8+
    - 管理员权限（用于启用 Hyper-V / WHPX）
    - 约 10GB 可用磁盘空间
"""
import asyncio
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

# ============================================================
# 配置
# ============================================================

# SDK 安装目录（D: 盘空间充足）
ANDROID_SDK_ROOT = Path(os.environ.get("ANDROID_SDK_ROOT", "D:/Android/Sdk"))
AVD_NAME = "xhs_phone"
AVD_DEVICE = "pixel_6_pro"
API_LEVEL = "34"
SYSTEM_IMAGE = f"system-images;android-{API_LEVEL};google_apis;x86_64"
EMULATOR_RAM_MB = 3072

# 临时文件目录
TEMP_DIR = Path("D:/Android/setup_temp")

# Chrome APK 下载（x86_64 架构）
# 优先使用官方 CDN，失败时提示手动下载
CHROME_APK_URLS = [
    "https://dl.google.com/android/chrome/latest/x86_64-chrome.apk",
    "https://dl.google.com/android/chrome/latest/chrome.apk",
]
CHROME_APK_PATH = ANDROID_SDK_ROOT / "chrome.apk"

# 超时
BOOT_TIMEOUT = 300     # 模拟器首次启动超时（秒）
ADB_TIMEOUT = 15       # 单次 adb 命令超时
CMD_TIMEOUT = 120      # sdkmanager 命令超时

# ============================================================
# 颜色输出
# ============================================================

def color(text, code):
    if sys.platform == "win32":
        return text
    return f"\033[{code}m{text}\033[0m"

def green(text): return color(text, "32")
def yellow(text): return color(text, "33")
def red(text): return color(text, "31")
def blue(text): return color(text, "34")

def step(msg):
    print(f"\n  {blue('->')} {msg}")

def ok(msg):
    print(f"  [+] {msg}")

def warn(msg):
    print(f"  [!] {msg}")

def fail(msg):
    print(f"  [-] {msg}")

# ============================================================
# 工具函数
# ============================================================

def run_cmd(cmd, timeout=CMD_TIMEOUT, check=True, capture=False):
    """运行系统命令"""
    try:
        if capture:
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=timeout, shell=True
            )
            return result.stdout.strip()
        result = subprocess.run(cmd, timeout=timeout, shell=True)
        if check and result.returncode != 0:
            return None
        return result.returncode
    except subprocess.TimeoutExpired:
        warn(f"命令超时: {cmd[:60]}...")
        return None
    except Exception as e:
        warn(f"命令失败: {e}")
        return None

def check_exe(name):
    """检查可执行文件是否存在"""
    path = shutil.which(name)
    if path:
        return path
    # 在 SDK 目录中查找
    for p in [
        ANDROID_SDK_ROOT / "platform-tools" / f"{name}.exe",
        ANDROID_SDK_ROOT / "emulator" / f"{name}.exe",
        ANDROID_SDK_ROOT / "cmdline-tools" / "latest" / "bin" / f"{name}.bat",
    ]:
        if p.exists():
            return str(p)
    return None

def download_file(url, dest, desc="文件"):
    """下载文件，带进度显示"""
    try:
        step(f"下载 {desc}...")
        print(f"    来源: {url}")
        
        def report(block, total, done):
            if total > 0:
                pct = done * block * 100 / total
                if pct > 100: pct = 100
                print(f"    \r    进度: {pct:.0f}%", end="")
        
        urllib.request.urlretrieve(url, dest, report)
        print()
        size_mb = os.path.getsize(dest) / (1024 * 1024)
        ok(f"{desc} 下载完成 ({size_mb:.1f} MB)")
        return True
    except Exception as e:
        warn(f"下载失败: {e}")
        return False

# ============================================================
# 步骤 1: 环境检测
# ============================================================

def step_check_environment():
    """检查系统环境"""
    print()
    print("  " + "=" * 56)
    print("  步骤 1/6: 系统环境检测")
    print("  " + "=" * 56)
    
    all_ok = True
    
    # Python 版本
    if sys.version_info < (3, 8):
        fail(f"需要 Python 3.8+，当前: {sys.version.split()[0]}")
        all_ok = False
    else:
        ok(f"Python {sys.version.split()[0]}")
    
    # 操作系统
    is_win = sys.platform == "win32"
    if not is_win:
        warn(f"当前系统: {platform.system()}（本脚本主要面向 Windows）")
    
    win_ver = platform.version()
    ok(f"系统: {platform.system()} {platform.release()} (build {win_ver})")
    
    # 虚拟化检测（Windows）
    if is_win:
        try:
            result = subprocess.run(
                "systeminfo | findstr /i 'Hyper-V'",
                capture_output=True, text=True, timeout=10, shell=True
            )
            if "Hyper-V" in result.stdout:
                ok("Hyper-V / WHPX 已启用（硬件加速可用）")
            else:
                warn("Hyper-V 未检测到，模拟器可能运行缓慢")
                warn("请在 BIOS 中启用虚拟化技术 (VT-x/AMD-V)")
                warn("或运行: bcdedit /set hypervisorlaunchtype auto")
        except Exception:
            warn("无法检测虚拟化状态")
    
    # 磁盘空间
    for drive in ["D:", "C:"]:
        drive_path = f"{drive}\\"
        try:
            import ctypes
            free = ctypes.c_ulonglong(0)
            ctypes.windll.kernel32.GetDiskFreeSpaceExW(
                drive_path, None, None, ctypes.byref(free)
            )
            free_gb = free.value / (1024**3)
            tag = "[OK]" if free_gb > 10 else "[!]"
            print(f"  {tag} {drive} 盘剩余: {free_gb:.1f} GB")
            if drive == "D:":
                if free_gb < 5:
                    fail(f"D: 盘空间不足（<5GB），SDK 安装需要 ~10GB")
                    all_ok = False
                elif free_gb < 10:
                    warn(f"D: 盘空间有限，建议清理")
        except Exception:
            warn(f"无法检测 {drive} 盘空间")
    
    if all_ok:
        ok("环境检测通过")
    return all_ok


# ============================================================
# 步骤 2: 安装 Android SDK
# ============================================================

def step_install_sdk(skip_download=False):
    """安装 Android SDK"""
    print()
    print("  " + "=" * 56)
    print("  步骤 2/6: 安装 Android SDK")
    print("  " + "=" * 56)
    
    if skip_download:
        warn("跳过 SDK 下载（--skip-download）")
        if not ANDROID_SDK_ROOT.exists():
            fail(f"SDK 目录不存在: {ANDROID_SDK_ROOT}")
            return False
        ok(f"使用现有 SDK: {ANDROID_SDK_ROOT}")
        return _install_sdk_components()
    
    # 创建 SDK 目录
    ANDROID_SDK_ROOT.mkdir(parents=True, exist_ok=True)
    ok(f"SDK 目录: {ANDROID_SDK_ROOT}")
    
    # 检查是否已有 SDK
    if (ANDROID_SDK_ROOT / "platform-tools" / "adb.exe").exists():
        ok("检测到已有 SDK")
        return _install_sdk_components()
    
    # 下载 commandlinetools
    cmdline_tools_dir = ANDROID_SDK_ROOT / "cmdline-tools" / "latest" / "bin"
    sdkmanager_path = cmdline_tools_dir / "sdkmanager.bat"
    
    if not sdkmanager_path.exists():
        # 创建临时目录
        TEMP_DIR.mkdir(parents=True, exist_ok=True)
        zip_path = TEMP_DIR / "commandlinetools.zip"
        
        # 下载
        url = (
            "https://dl.google.com/android/repository/"
            "commandlinetools-win-11076708_latest.zip"
        )
        if not download_file(url, zip_path, "Android commandlinetools"):
            warn("下载 commandlinetools 失败")
            warn("请手动下载后解压到: " + str(cmdline_tools_dir.parent))
            warn("下载地址: https://developer.android.com/studio#command-line-tools-only")
            return False
        
        # 解压
        step("解压 commandlinetools...")
        try:
            with zipfile.ZipFile(zip_path, "r") as zf:
                zf.extractall(TEMP_DIR)
        except Exception as e:
            fail(f"解压失败: {e}")
            return False
        
        # 移动目录
        extracted = TEMP_DIR / "cmdline-tools"
        if extracted.exists():
            dest = ANDROID_SDK_ROOT / "cmdline-tools" / "latest"
            if dest.exists():
                shutil.rmtree(dest)
            shutil.copytree(extracted, dest, dirs_exist_ok=True)
            ok(f"cmdline-tools 安装完成")
        
        # 清理临时文件
        try:
            shutil.rmtree(TEMP_DIR)
        except Exception:
            pass
    else:
        ok("cmdline-tools 已存在")
    
    # 接受许可证
    step("接受 Android SDK 许可证...")
    run_cmd(f'echo yes | "{sdkmanager_path}" --licenses', timeout=30, check=False)
    
    return _install_sdk_components()


def _install_sdk_components():
    """安装 SDK 组件"""
    sdkmanager = (
        ANDROID_SDK_ROOT / "cmdline-tools" / "latest" / "bin" / "sdkmanager.bat"
    )
    if not sdkmanager.exists():
        fail("sdkmanager 未找到")
        return False
    
    # 安装必要的组件
    components = [
        "platform-tools",
        f"platforms;android-{API_LEVEL}",
        "emulator",
        "build-tools;34.0.0",
    ]
    
    for comp in components:
        step(f"安装 {comp}...")
        result = run_cmd(
            f'echo yes | "{sdkmanager}" "{comp}"',
            timeout=CMD_TIMEOUT,
            check=False,
        )
        if result is not None:
            ok(f"{comp} 安装完成")
        else:
            warn(f"{comp} 安装可能失败，请检查日志")
    
    # 安装系统镜像（较大，单独处理）
    step(f"安装系统镜像 {SYSTEM_IMAGE}...（约 1-2GB，可能需要较长时间）")
    result = run_cmd(
        f'echo yes | "{sdkmanager}" "{SYSTEM_IMAGE}"',
        timeout=600,  # 10 分钟超时
        check=False,
    )
    if result is not None:
        ok("系统镜像安装完成")
    else:
        warn("系统镜像安装可能失败")
        warn(f"可手动运行: sdkmanager {SYSTEM_IMAGE}")
    
    # 验证 adb
    adb_path = ANDROID_SDK_ROOT / "platform-tools" / "adb.exe"
    if adb_path.exists():
        # 添加到 PATH
        os.environ["PATH"] = str(adb_path.parent) + os.pathsep + os.environ.get("PATH", "")
        ok(f"adb: {adb_path}")
    
    # 验证 emulator
    emu_path = ANDROID_SDK_ROOT / "emulator" / "emulator.exe"
    if emu_path.exists():
        os.environ["PATH"] = str(emu_path.parent) + os.pathsep + os.environ.get("PATH", "")
        ok(f"emulator: {emu_path}")
    
    return True


# ============================================================
# 步骤 3: 创建 AVD
# ============================================================

def step_create_avd():
    """创建 Android 虚拟设备"""
    print()
    print("  " + "=" * 56)
    print("  步骤 3/6: 创建 AVD")
    print("  " + "=" * 56)
    
    avdmanager = (
        ANDROID_SDK_ROOT / "cmdline-tools" / "latest" / "bin" / "avdmanager.bat"
    )
    
    if not avdmanager.exists():
        warn("avdmanager 未找到，尝试用 sdkmanager 替代方案")
        return _create_avd_manual()
    
    # 检查是否已存在
    avd_dir = Path.home() / ".android" / "avd" / f"{AVD_NAME}.avd"
    if avd_dir.exists():
        ok(f"AVD '{AVD_NAME}' 已存在")
        return True
    
    step("创建 AVD...")
    cmd = (
        f'echo no | "{avdmanager}" create avd '
        f'-n {AVD_NAME} '
        f'-k "{SYSTEM_IMAGE}" '
        f'-d {AVD_DEVICE} '
        f'--force'
    )
    result = run_cmd(cmd, timeout=120, check=False)
    if result is None:
        warn("AVD 创建失败，尝试手动配置")
        return _create_avd_manual()
    
    ok(f"AVD '{AVD_NAME}' 创建成功 ({AVD_DEVICE})")
    
    # 配置 AVD 硬件参数
    _configure_avd()
    return True


def _create_avd_manual():
    """手动方式创建 AVD（如果 avdmanager 不可用）"""
    warn("使用备用方式创建 AVD...")
    
    avd_dir = Path.home() / ".android" / "avd" / f"{AVD_NAME}.avd"
    avd_dir.mkdir(parents=True, exist_ok=True)
    
    # 创建 config.ini
    config = {
        "avd.ini.encoding": "UTF-8",
        "AvdId": AVD_NAME,
        "abi.type": "x86_64",
        "tag.id": "google_apis",
        "image.sysdir.1": f"system-images\\android-{API_LEVEL}\\google_apis\\x86_64\\",
        "hw.device.name": AVD_DEVICE,
        "hw.ramSize": str(EMULATOR_RAM_MB),
    }
    ini_path = Path.home() / ".android" / "avd" / f"{AVD_NAME}.ini"
    with open(ini_path, "w", encoding="utf-8") as f:
        f.write(f"avd.ini.encoding=UTF-8\n")
        f.write(f"path={avd_dir}\n")
        f.write(f"path.rel=avd\\{AVD_NAME}.avd\n")
        f.write(f"target=android-{API_LEVEL}\n")
    
    _configure_avd()
    ok(f"AVD '{AVD_NAME}' 手动创建完成")
    return True


def _configure_avd():
    """配置 AVD 硬件参数"""
    config_path = (
        Path.home() / ".android" / "avd" / f"{AVD_NAME}.avd" / "config.ini"
    )
    if not config_path.parent.exists():
        return
    
    # 读取现有配置
    config = {}
    if config_path.exists():
        with open(config_path, "r", encoding="utf-8") as f:
            for line in f:
                if "=" in line:
                    k, v = line.strip().split("=", 1)
                    config[k] = v
    
    # 更新配置
    config.update({
        "hw.ramSize": str(EMULATOR_RAM_MB),
        "hw.heapSize": "512",
        "hw.gpu.enabled": "yes",
        "hw.gpu.mode": "host",
        "hw.sdCard": "yes",
        "hw.sdCard.size": "2048M",
        "hw.camera": "yes",
        "hw.camera.back": "virtualscene",
        "hw.camera.front": "emulated",
        "hw.keyboard": "yes",
        "hw.mainKeys": "no",
        "hw.sensors.proximity": "yes",
        "hw.battery": "yes",
        "hw.gsmModem": "yes",
        "hw.gps": "yes",
        "skin.dynamic": "yes",
        "skin.name": "1080x1920",
        "skin.path": "1080x1920",
        "hw.lcd.density": "420",
        "hw.lcd.height": "1920",
        "hw.lcd.width": "1080",
        "fastboot.forceColdBoot": "yes",
    })
    
    with open(config_path, "w", encoding="utf-8") as f:
        for k, v in config.items():
            f.write(f"{k}={v}\n")
    
    ok("AVD 硬件参数已配置")


# ============================================================
# 步骤 4: 下载 Chrome APK
# ============================================================

def step_download_chrome():
    """下载 Chrome for Android APK"""
    print()
    print("  " + "=" * 56)
    print("  步骤 4/6: 下载 Chrome APK")
    print("  " + "=" * 56)
    
    if CHROME_APK_PATH.exists():
        size_mb = CHROME_APK_PATH.stat().st_size / (1024 * 1024)
        ok(f"Chrome APK 已存在 ({size_mb:.1f} MB)")
        return True
    
    # 尝试从多个 URL 下载
    for url in CHROME_APK_URLS:
        if download_file(url, CHROME_APK_PATH, "Chrome APK"):
            return True
    
    # 下载失败，给出手动安装指引
    warn("Chrome APK 自动下载失败")
    warn("请手动下载 Chrome for Android (x86_64) 后放置到:")
    warn(f"  {CHROME_APK_PATH}")
    warn("下载来源推荐:")
    warn("  - https://www.apkmirror.com/ 搜索 'Chrome Stable'")
    warn("  - 选择 x86_64 或 universal 版本")
    warn("  - 或使用手机上的 Chrome APK 提取工具")
    print()
    warn("你也可以跳过此步骤，稍后通过 Play Store 安装")
    return False


# ============================================================
# 步骤 5: 首次启动 + 安装 Chrome
# ============================================================

def step_first_boot():
    """首次启动模拟器并安装 Chrome"""
    print()
    print("  " + "=" * 56)
    print("  步骤 5/6: 首次启动模拟器 & 安装 Chrome")
    print("  " + "=" * 56)
    
    emu_exe = ANDROID_SDK_ROOT / "emulator" / "emulator.exe"
    if not emu_exe.exists():
        fail("emulator.exe 未找到")
        warn("请确认 Android SDK 安装完整")
        return False
    
    adb_exe = ANDROID_SDK_ROOT / "platform-tools" / "adb.exe"
    if not adb_exe.exists():
        fail("adb.exe 未找到")
        return False
    
    # 检查是否已有模拟器运行
    result = run_cmd(f'"{adb_exe}" devices', capture=True)
    if AVD_NAME in result or "emulator-5554" in result:
        warn("模拟器似乎已在运行")
        answer = input("  是否重启模拟器? (y/N): ").strip().lower()
        if answer != "y":
            ok("使用现有模拟器")
            return _install_chrome_on_device(adb_exe)
        # 关闭现有模拟器
        run_cmd(f'"{adb_exe}" emu kill', timeout=10, check=False)
        time.sleep(5)
    
    # 启动模拟器
    step("启动模拟器（首次启动可能需要 3-5 分钟）...")
    print(f"    设备: {AVD_DEVICE}")
    print(f"    系统: Android {API_LEVEL} (x86_64)")
    print(f"    内存: {EMULATOR_RAM_MB}MB")
    print(f"    GPU: host (硬件加速)")
    
    emu_cmd = (
        f'start /B "" "{emu_exe}" '
        f'-avd {AVD_NAME} '
        f'-no-snapshot '
        f'-gpu host '
        f'-no-audio '
        f'-memory {EMULATOR_RAM_MB} '
        f'-netdelay none '
        f'-netspeed full'
    )
    result = run_cmd(emu_cmd, timeout=10, check=False)
    
    if result is None:
        warn("模拟器启动命令发送失败")
        warn("请手动启动: " + emu_cmd)
        return False
    
    ok("模拟器启动中...（请等待模拟器窗口出现）")
    
    # 等待模拟器就绪
    step("等待模拟器启动...")
    boot_start = time.time()
    booted = False
    
    while time.time() - boot_start < BOOT_TIMEOUT:
        # 检查 adb 连接
        devices = run_cmd(f'"{adb_exe}" devices', capture=True)
        if "emulator-5554" in devices and "device" in devices:
            # 检查 boot_completed
            boot = run_cmd(
                f'"{adb_exe}" -s emulator-5554 shell getprop sys.boot_completed',
                timeout=5,
                capture=True,
            )
            if boot and boot.strip() == "1":
                booted = True
                break
        elapsed = int(time.time() - boot_start)
        print(f"    \r    等待中... {elapsed}s", end="")
        time.sleep(5)
    
    print()
    if not booted:
        fail(f"模拟器启动超时（{BOOT_TIMEOUT}s）")
        warn("可尝试手动启动后重试")
        return False
    
    ok(f"模拟器已启动（耗时 {int(time.time() - boot_start)}s）")
    
    # 配置 locale 和时区
    step("配置系统参数...")
    run_cmd(
        f'"{adb_exe}" -s emulator-5554 shell setprop persist.sys.locale zh-CN',
        timeout=5, check=False
    )
    run_cmd(
        f'"{adb_exe}" -s emulator-5554 shell setprop persist.sys.timezone Asia/Shanghai',
        timeout=5, check=False
    )
    ok("系统参数已配置")
    
    # 安装 Chrome
    return _install_chrome_on_device(adb_exe)


def _install_chrome_on_device(adb_exe):
    """在 Android 设备上安装 Chrome"""
    if not CHROME_APK_PATH.exists():
        warn("Chrome APK 不存在，跳过安装")
        warn("启动后可通过 Play Store 或手动安装 Chrome")
        return True
    
    # 检查是否已安装
    pkg_check = run_cmd(
        f'"{adb_exe}" -s emulator-5554 shell pm list packages com.android.chrome',
        capture=True,
        timeout=10,
    )
    if pkg_check and "com.android.chrome" in pkg_check:
        ok("Chrome 已安装")
        return True
    
    # 安装 Chrome
    step("安装 Chrome...（可能需要 1-2 分钟）")
    result = run_cmd(
        f'"{adb_exe}" -s emulator-5554 install -r "{CHROME_APK_PATH}"',
        timeout=120,
        check=False,
    )
    if result is not None:
        ok("Chrome 安装成功")
        return True
    else:
        warn("Chrome 安装失败")
        warn("请手动安装: adb install -r " + str(CHROME_APK_PATH))
        return False


# ============================================================
# 步骤 6: 验证 CDP 连接
# ============================================================

def step_verify_cdp():
    """验证 Chrome DevTools Protocol 连接"""
    print()
    print("  " + "=" * 56)
    print("  步骤 6/6: 验证 CDP 连接")
    print("  " + "=" * 56)
    
    adb_exe = ANDROID_SDK_ROOT / "platform-tools" / "adb.exe"
    if not adb_exe.exists():
        fail("adb 未找到")
        return False
    
    # 启动 Chrome
    step("启动 Chrome...")
    run_cmd(
        f'"{adb_exe}" -s emulator-5554 shell am start -n '
        f'com.android.chrome/com.google.android.apps.chrome.Main',
        timeout=10,
        check=False,
    )
    time.sleep(3)
    
    # 设置端口转发
    step("配置端口转发...")
    # 先移除旧的转发
    run_cmd(f'"{adb_exe}" forward --remove tcp:9222', timeout=5, check=False)
    # 建立新转发
    result = run_cmd(
        f'"{adb_exe}" -s emulator-5554 forward tcp:9222 localabstract:chrome_devtools_remote',
        timeout=10,
        capture=True,
    )
    if result is None:
        # 尝试另一种 socket 名称
        result = run_cmd(
            f'"{adb_exe}" -s emulator-5554 forward tcp:9222 localabstract:chrome_devtools_remote_9222',
            timeout=10,
            check=False,
        )
    
    # 等待 CDP 端点可用
    step("等待 CDP 端点就绪...")
    import urllib.request
    
    for i in range(30):
        try:
            resp = urllib.request.urlopen("http://127.0.0.1:9222/json/version", timeout=5)
            data = json.loads(resp.read().decode())
            if "Browser" in data:
                ok(f"CDP 连接成功！Chrome 版本: {data.get('Browser', 'unknown')}")
                print(f"    User-Agent: {data.get('User-Agent', 'N/A')[:80]}...")
                return True
        except Exception:
            pass
        time.sleep(1)
    
    # 如果 9222 不行，尝试列出转发
    warn("CDP 端点未在 9222 端口就绪")
    warn("请手动验证:")
    warn(f"  1. 确认模拟器已启动: {adb_exe} devices")
    warn(f"  2. 确认 Chrome 已打开")
    warn(f"  3. 运行: {adb_exe} forward --list")
    warn(f"  4. 运行: curl http://127.0.0.1:9222/json/version")
    return False


# ============================================================
# 主流程
# ============================================================

def main():
    skip_download = "--skip-download" in sys.argv
    if "--sdk" in sys.argv:
        idx = sys.argv.index("--sdk")
        if idx + 1 < len(sys.argv):
            global ANDROID_SDK_ROOT
            ANDROID_SDK_ROOT = Path(sys.argv[idx + 1])
    
    print()
    print(f"  {blue('════════════════════════════════════════════════')}")
    print(f"  {blue('  小红书 Android 模拟器环境安装')}")
    print(f"  {blue('  SDK 目录:')} {ANDROID_SDK_ROOT}")
    print(f"  {blue('  AVD 名称:')} {AVD_NAME} ({AVD_DEVICE})")
    print(f"  {blue('  系统镜像:')} Android {API_LEVEL} (x86_64)")
    print(f"  {blue('════════════════════════════════════════════════')}")
    
    steps = [
        ("系统环境检测", step_check_environment),
        ("安装 Android SDK", lambda: step_install_sdk(skip_download)),
        ("创建 AVD", step_create_avd),
        ("下载 Chrome APK", step_download_chrome),
        ("首次启动 & 安装 Chrome", step_first_boot),
        ("验证 CDP 连接", step_verify_cdp),
    ]
    
    success = True
    for name, func in steps:
        try:
            if not func():
                warn(f"步骤 '{name}' 未完全成功")
                if name in ("系统环境检测",):
                    success = False
                    break
        except KeyboardInterrupt:
            print()
            warn("用户中断")
            success = False
            break
        except Exception as e:
            fail(f"步骤 '{name}' 异常: {e}")
            import traceback
            traceback.print_exc()
    
    print()
    print("  " + "=" * 56)
    if success:
        print(f"  {green('安装完成！')}")
        print()
        print(f"  下一步:")
        print(f"  1. 确认模拟器正在运行（窗口可见）")
        print(f"  2. 启动服务: python3 main.py")
        print(f"  3. 登录小红书账号")
        print(f"  4. 启动引流任务")
        print()
        print(f"  手机模拟器已就绪，小红书将识别为 Android 真机。")
    else:
        print(f"  {red('安装未完全成功')}")
        print()
        print(f"  请根据上面的错误信息修复问题后重试。")
        print(f"  常见问题:")
        print(f"  - 确保 BIOS 中启用了虚拟化 (VT-x)")
        print(f"  - 确保 Windows Hyper-V 已启用")
        print(f"  - 以管理员身份运行此脚本")
    print("  " + "=" * 56)


if __name__ == "__main__":
    main()
