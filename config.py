"""应用配置"""
import os
import secrets
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

# 加密密钥（用于加密 API Key / Cookie 等敏感数据，加解密见 app/core/crypto.py）
# 优先读取环境变量 XHS_OPS_ENCRYPTION_KEY；未设置时使用 data/.secret.key（首次运行自动生成）。
# ⚠️ 备份 / 迁移时请连 data/.secret.key 一起拷贝，否则已加密的数据无法解密。
_SECRET_KEY_FILE = DATA_DIR / ".secret.key"


def _load_encryption_key() -> str:
    env_key = os.environ.get("XHS_OPS_ENCRYPTION_KEY")
    if env_key:
        return env_key
    if _SECRET_KEY_FILE.exists():
        saved = _SECRET_KEY_FILE.read_text(encoding="utf-8").strip()
        if saved:
            return saved
    key = secrets.token_urlsafe(32)
    _SECRET_KEY_FILE.write_text(key, encoding="utf-8")
    try:
        os.chmod(_SECRET_KEY_FILE, 0o600)
    except OSError:
        pass
    return key


ENCRYPTION_KEY = _load_encryption_key()

# ==================== Android 模拟器 ====================
# 主开关
EMULATOR_ENABLED = True

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

# ---- Google AVD ----
AVD_NAME = "xhs_phone"                          # AVD 名称
AVD_DEVICE = "pixel_6_pro"                      # 设备模板

# Chrome DevTools 端口
CHROME_CDP_PORT = 9222                           # Chrome DevTools 远程调试端口

# 超时
EMULATOR_BOOT_TIMEOUT = 180                      # 模拟器启动超时（秒）
CHROME_LAUNCH_TIMEOUT = 30                       # Chrome CDP 等待超时（秒）
ADB_TIMEOUT = 15                                 # 单次 adb 命令超时

# 模拟器资源
EMULATOR_RAM_MB = 3072                           # 模拟器内存 (MB)
