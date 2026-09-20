# -*- coding: utf-8 -*-
"""过期数据自动清除（保留期）

与插件端 extension/lib/data-privacy.js 同一套口径，服务端库内一视同仁（成交客户不豁免）：
- 客户数据（客户邮箱线索 / 私信会话与消息 / 评论 / 回复日志 / 待发私信）：
  以「最后互动时间」为起点，静默满 CUSTOMER_DAYS 天自动清除。
- 运行数据（引流执行记录 / AI 调用日志 / 指标快照 / 退出日志）：
  按记录时间起算，满 RUNTIME_DAYS 天自动清除。

只清记录本身（不可恢复）。不在清除范围的自有内容：
账号 Cookie、知识库、话术、笔记、素材等，以及目标账号库（用户自己录入的盯人名单，
从不由采集流程自动写入，删除权在用户手上，见 DELETE /api/drain/target-accounts/{id}）。
"""
from datetime import datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import models as M

CUSTOMER_DAYS = 90   # 客户数据静默天数
RUNTIME_DAYS = 30    # 运行数据保留天数


def sweep_expired(now: datetime = None) -> dict:
    """执行一轮过期清除，返回 {类别: 删除条数}。

    判定用「所有可能代表最后互动的时间戳都早于截止线」（等价于 max(时间戳) < 截止线）；
    时间戳全为空的行不删（宁可保留也不误删）。
    """
    now = now or datetime.now()
    cust_cut = now - timedelta(days=CUSTOMER_DAYS)
    run_cut = now - timedelta(days=RUNTIME_DAYS)
    removed = {}

    with Session(M.engine) as session:
        # ---- 客户数据 ----
        removed["customer_leads"] = session.query(M.CustomerLead).filter(
            func.coalesce(M.CustomerLead.updated_at, M.CustomerLead.created_at) < cust_cut,
            func.coalesce(M.CustomerLead.pack_at, M.CustomerLead.created_at) < cust_cut,
            func.coalesce(M.CustomerLead.notify_at, M.CustomerLead.created_at) < cust_cut,
        ).delete(synchronize_session=False)

        stale_convs = session.query(M.Conversation).filter(
            func.coalesce(M.Conversation.last_at, M.Conversation.created_at) < cust_cut,
            func.coalesce(M.Conversation.last_dm_at, M.Conversation.created_at) < cust_cut,
            func.coalesce(M.Conversation.sync_at, M.Conversation.created_at) < cust_cut,
            func.coalesce(M.Conversation.updated_at, M.Conversation.created_at) < cust_cut,
        ).all()
        conv_ids = [c.id for c in stale_convs]

        msgs = send_tasks = 0
        if conv_ids:
            msgs = session.query(M.Message).filter(
                M.Message.conversation_id.in_(conv_ids)).delete(synchronize_session=False)
            send_tasks = session.query(M.SendTask).filter(
                M.SendTask.conversation_id.in_(conv_ids)).delete(synchronize_session=False)
            session.query(M.Conversation).filter(
                M.Conversation.id.in_(conv_ids)).delete(synchronize_session=False)

        # 会话仍在，但单条消息本身已静默过期（会话态与最近消息保留）
        msgs += session.query(M.Message).filter(
            func.coalesce(M.Message.msg_at, M.Message.received_at) < cust_cut,
        ).delete(synchronize_session=False)
        removed["conversations"] = len(conv_ids)
        removed["messages"] = msgs

        removed["comments"] = session.query(M.Comment).filter(
            func.coalesce(M.Comment.commented_at, M.Comment.created_at) < cust_cut,
        ).delete(synchronize_session=False)

        removed["comment_logs"] = session.query(M.CommentLog).filter(
            M.CommentLog.created_at < cust_cut,
        ).delete(synchronize_session=False)

        # 出站队列：未发送的(pending)不动，避免把待办清掉
        send_tasks += session.query(M.SendTask).filter(
            M.SendTask.status != "pending",
            func.coalesce(M.SendTask.sent_at, M.SendTask.created_at) < cust_cut,
        ).delete(synchronize_session=False)
        removed["send_tasks"] = send_tasks

        # ---- 运行数据 ----
        removed["drain_records"] = session.query(M.DrainRecord).filter(
            M.DrainRecord.created_at < run_cut,
        ).delete(synchronize_session=False)

        removed["prompt_logs"] = session.query(M.PromptLog).filter(
            M.PromptLog.created_at < run_cut,
        ).delete(synchronize_session=False)

        # 指标快照（纯数字时间序列）与退出日志（停止监控的原因记录）
        removed["radar_snapshots"] = session.query(M.RadarSnapshot).filter(
            M.RadarSnapshot.collected_at < run_cut,
        ).delete(synchronize_session=False)

        removed["exit_logs"] = session.query(M.ExitLog).filter(
            M.ExitLog.created_at < run_cut,
        ).delete(synchronize_session=False)

        session.commit()

    hit = {k: v for k, v in removed.items() if v}
    if hit:
        print("[保留期] 已清除过期数据: " + ", ".join("%s=%d" % (k, v) for k, v in hit.items()))
    return removed
