"""账号管理 API"""
from fastapi import APIRouter, HTTPException
from sqlalchemy.orm import Session

from app.models.models import engine, Account
from app.schemas.schemas import AccountCreate, AccountResponse, MessageResponse
from app.core.browser import browser_engine

router = APIRouter()


@router.get("/", response_model=list[AccountResponse])
async def list_accounts():
    """获取所有账号"""
    with Session(engine) as session:
        accounts = session.query(Account).all()
        results = []
        for a in accounts:
            r = AccountResponse(
                id=a.id, nickname=a.nickname, phone=a.phone,
                is_active=a.is_active, created_at=a.created_at,
            )
            r.cookies_exists = browser_engine.has_cookies(a.id)
            results.append(r)
        return results


@router.post("/", response_model=AccountResponse)
async def create_account(data: AccountCreate):
    """创建账号"""
    with Session(engine) as session:
        account = Account(nickname=data.nickname, phone=data.phone)
        session.add(account)
        session.commit()
        session.refresh(account)
        r = AccountResponse(
            id=account.id, nickname=account.nickname,
            phone=account.phone, is_active=account.is_active,
            created_at=account.created_at,
        )
        r.cookies_exists = browser_engine.has_cookies(account.id)
        return r


@router.delete("/{account_id}", response_model=MessageResponse)
async def delete_account(account_id: int):
    """删除账号"""
    with Session(engine) as session:
        account = session.query(Account).filter_by(id=account_id).first()
        if not account:
            raise HTTPException(404, "账号不存在")
        session.delete(account)
        session.commit()
    return {"message": "删除成功"}


@router.post("/{account_id}/login", response_model=MessageResponse)
async def login_account(account_id: int):
    """登录小红书（扫码）"""
    try:
        result = await browser_engine.start(account_id)
        if result.startswith("error"):
            raise HTTPException(500, f"浏览器启动失败: {result}")

        # 先尝试 Cookie 登录
        loaded = await browser_engine.load_cookies(account_id)
        if loaded:
            ready = await browser_engine.ensure_ready(account_id)
            if ready == "ok":
                return {"message": "Cookie 有效，登录成功"}

        # 跳转到登录页，等待扫码
        await browser_engine.page.goto(
            "https://www.xiaohongshu.com/login",
            wait_until="domcontentloaded",
        )
        return {"message": "请在浏览器窗口中扫码登录，登录后程序会自动保存 Cookie"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"登录失败: {str(e)}")


@router.get("/{account_id}/check-login", response_model=MessageResponse)
async def check_login(account_id: int):
    """检查登录状态（供前端轮询）"""
    status = await browser_engine.get_status()
    if status.get("login_status") == "logged_in" and status.get("page_alive"):
        if status["account_id"] == account_id:
            try:
                await browser_engine.save_cookies(account_id)
            except Exception:
                pass
            return {"message": "已登录"}
        # 登录成功了但 account_id 没对上，保存一下
        try:
            await browser_engine.save_cookies(account_id)
        except Exception:
            pass
        return {"message": "已登录"}
    return {"message": "未登录"}


@router.post("/{account_id}/wait-login", response_model=MessageResponse)
async def wait_login(account_id: int):
    """等待扫码登录完成（最多等2分钟）"""
    success = await browser_engine.wait_for_qr_login(timeout_seconds=120)
    if success:
        await browser_engine.save_cookies(account_id)
        return {"message": "登录成功！"}
    return {"message": "登录超时，请重试"}
