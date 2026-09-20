"""敏感数据加解密（Fernet）

API Key / Cookie 等敏感内容落盘前加密，读取时解密：
- 密文统一带 `enc:v1:` 前缀；无前缀的值按「存量明文」原样返回，下次写入时自动升级为密文。
- 密钥取自 config.ENCRYPTION_KEY（环境变量 XHS_OPS_ENCRYPTION_KEY 或 data/.secret.key）。

另提供：
- `EncryptedText`：SQLAlchemy 列类型，写入自动加密 / 读取自动解密（昵称、会话内容、评论正文等）。
- `blind_index()`：确定性盲索引，供加密列做等值查询（如邮箱去重），密文列本身无法 SQL 比较。
"""
import base64
import hashlib
import hmac

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import Text
from sqlalchemy.types import TypeDecorator

from config import ENCRYPTION_KEY

_PREFIX = "enc:v1:"


def _fernet() -> Fernet:
    digest = hashlib.sha256(ENCRYPTION_KEY.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_text(plain: str) -> str:
    """加密字符串；空值原样返回。"""
    if not plain:
        return plain
    return _PREFIX + _fernet().encrypt(plain.encode("utf-8")).decode("ascii")


def decrypt_text(value: str) -> str:
    """解密字符串。

    - 无 `enc:v1:` 前缀：视为存量明文，原样返回（兼容旧数据）。
    - 解密失败（密钥变更/文件损坏）：提示并返回空串，由调用方按「未配置/需重新登录」处理。
    """
    if not value:
        return value
    if not value.startswith(_PREFIX):
        return value
    try:
        return _fernet().decrypt(value[len(_PREFIX):].encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        print("[crypto] 密文解密失败：加密密钥可能已变更（检查 XHS_OPS_ENCRYPTION_KEY / data/.secret.key）")
        return ""


class EncryptedText(TypeDecorator):
    """落盘自动加密、读取自动解密的文本列。

    - 写入：明文 → `enc:v1:...`；已是密文则原样写入（幂等，避免二次加密）。
    - 读取：密文 → 明文；无前缀的存量数据原样返回（兼容旧库，下次写入自动升级）。
    - 密文长度约为原文 1.6 倍，且列值不可用于 SQL 比较/排序/模糊匹配；
      等值查询请另建 `blind_index()` 盲索引列（如 customer_leads.email_hash）。
    """

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if not isinstance(value, str) or not value or value.startswith(_PREFIX):
            return value
        return encrypt_text(value)

    def process_result_value(self, value, dialect):
        return decrypt_text(value) if isinstance(value, str) else value


def blind_index(value: str) -> str:
    """确定性盲索引（HMAC-SHA256）：同明文恒定同索引，用于加密列的等值查询。

    归一化（去空白 + 小写）后计算，密钥取自 ENCRYPTION_KEY，无法从索引反推明文。
    """
    text = (value or "").strip().lower()
    if not text:
        return ""
    return hmac.new(ENCRYPTION_KEY.encode("utf-8"), text.encode("utf-8"), hashlib.sha256).hexdigest()
