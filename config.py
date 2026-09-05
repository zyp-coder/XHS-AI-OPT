"""应用配置"""
import os
from pathlib import Path

# 基础路径
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
COOKIE_DIR = DATA_DIR / "cookies"
UPLOAD_DIR = DATA_DIR / "uploads"
DB_PATH = DATA_DIR / "xhs_ops.db"

# 确保目录存在
for d in [DATA_DIR, COOKIE_DIR, UPLOAD_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# 数据库
DATABASE_URL = f"sqlite:///{DB_PATH}"

# 服务
HOST = "127.0.0.1"
PORT = 8000

# 加密密钥（用于加密 API Key）
# 优先读取环境变量 XHS_OPS_ENCRYPTION_KEY；未设置时回退旧默认值（保证存量数据可解密）。
# ⚠️ 生产/公开环境务必通过环境变量注入强随机密钥，不要用下面的占位缺省值。
ENCRYPTION_KEY = os.environ.get("XHS_OPS_ENCRYPTION_KEY", "xhs-ops-secret-key-2024-change-me")

# ==================== Android 模拟器 ====================
# 主开关
EMULATOR_ENABLED = True

# 模拟器类型: "ldplayer"（雷电模拟器）| "avd"（Google AVD）
# 雷电模拟器更快、界面更友好、国内网络兼容更好
EMULATOR_TYPE = "ldplayer"

# 自动检测 Android SDK 路径
_ANDROID_CANDIDATES = [
    Path(os.environ.get("ANDROID_SDK_ROOT", "D:/Android/Sdk")),
    Path(os.environ.get("ANDROID_HOME", "")),
    Path("D:/Android/Sdk"),
    Path("C:/Users") / os.environ.get("USERNAME", "") / "AppData/Local/Android/Sdk",
]
ANDROID_SDK_ROOT = next(
    (p for p in _ANDROID_CANDIDATES if p and p.exists()),
    Path("D:/Android/Sdk"),
)

# ---- 雷电模拟器 (LDPlayer) ----
# LDPlayer 安装路径自动检测
_LD_CANDIDATES = [
    Path("D:/leidian/LDPlayer9"),
    Path("D:/LDPlayer9"),
    Path("C:/Program Files/LDPlayer9"),
    Path("C:/Program Files (x86)/LDPlayer9"),
]
LDPLAYER_ROOT = next(
    (p for p in _LD_CANDIDATES if p and p.exists()),
    Path("D:/leidian/LDPlayer9"),
)
LDPLAYER_ADB_SERIAL = "127.0.0.1:5555"           # LDPlayer 实例 1 的 adb 地址
LDPLAYER_ADB_PORT = 5555                         # LDPlayer adb 端口

# ---- Google AVD ----
AVD_NAME = "xhs_phone"                          # AVD 名称
AVD_DEVICE = "pixel_6_pro"                      # 设备模板

# 端口
EMULATOR_PORT = 5554                             # Google AVD adb 端口
CHROME_CDP_PORT = 9222                           # Chrome DevTools 远程调试端口

# 超时
EMULATOR_BOOT_TIMEOUT = 180                      # 模拟器启动超时（秒）
CHROME_LAUNCH_TIMEOUT = 30                       # Chrome CDP 等待超时（秒）
ADB_TIMEOUT = 15                                 # 单次 adb 命令超时

# 模拟器资源
EMULATOR_RAM_MB = 3072                           # 模拟器内存 (MB)
EMULATOR_LOCALE = "zh-CN"                        # 系统语言
EMULATOR_TIMEZONE = "Asia/Shanghai"              # 系统时区
