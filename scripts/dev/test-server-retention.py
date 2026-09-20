# -*- coding: utf-8 -*-
"""自测：服务端过期清除（客户数据 90 天 / 运行数据 30 天，全程只跑临时库）

运行：PYTHONPATH=. python3 scripts/dev/test-server-retention.py
"""
import os
import tempfile
from datetime import datetime, timedelta

os.environ['XHS_OPS_ENCRYPTION_KEY'] = 'retention-test-key'

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.retention import sweep_expired
from app.models import models as M

tmpdir = tempfile.mkdtemp()
eng = create_engine('sqlite:///' + os.path.join(tmpdir, 'r.db'),
                    connect_args={'check_same_thread': False})
M.engine = eng
# 安全闸：确保后面扫的是临时库，绝不碰 data/xhs_ops.db
assert str(eng.url.database).replace('\\', '/').startswith(tmpdir.replace('\\', '/')), eng.url.database
assert 'xhs_ops' not in str(eng.url.database)
M.Base.metadata.create_all(eng)

now = datetime.now()
old = now - timedelta(days=100)
mid = now - timedelta(days=60)
recent = now - timedelta(days=10)

with Session(eng) as s:
    c1 = M.Conversation(conv_id='old', partner_name='甲', last_msg='旧',
                        last_at=old, last_dm_at=old, sync_at=old, created_at=old, updated_at=old)
    c2 = M.Conversation(conv_id='new', partner_name='乙', last_msg='新',
                        last_at=recent, created_at=recent, updated_at=recent)
    s.add_all([c1, c2])
    s.flush()
    s.add_all([
        M.Message(conversation_id=c1.id, text='旧会话消息', msg_at=old, received_at=old),
        M.Message(conversation_id=c2.id, text='新消息', msg_at=recent, received_at=recent),
        M.Message(conversation_id=c2.id, text='活跃会话里的老消息', msg_at=old, received_at=old),
        M.SendTask(conversation_id=c1.id, text='旧待发', status='pending', created_at=old),
        M.SendTask(conversation_id=c2.id, text='已发送老任务', status='sent', created_at=old, sent_at=old),
        M.SendTask(conversation_id=c2.id, text='待发任务', status='pending', created_at=old),
        M.Comment(note_id=1, xhs_comment_id='k1', author_name='丙', content='老评论',
                  commented_at=old, created_at=old),
        M.Comment(note_id=1, xhs_comment_id='k2', author_name='丁', content='新评论',
                  commented_at=recent, created_at=recent),
        M.CommentLog(target_author='戊', target_comment='c', reply_text='r', created_at=old),
        M.CommentLog(target_author='己', target_comment='c', reply_text='r', created_at=recent),
        M.CustomerLead(email='old@x.com', nickname='老王', created_at=old, updated_at=old),
        M.CustomerLead(email='new@x.com', nickname='小新', created_at=recent, updated_at=recent),
        M.DrainRecord(task_id=1, target_author='庚', created_at=mid),
        M.DrainRecord(task_id=1, target_author='辛', created_at=recent),
        M.PromptLog(scene='s', prompt='p', response='r', created_at=now - timedelta(days=25)),
        M.PromptLog(scene='s', prompt='p2', response='r2', created_at=mid),
        M.Account(nickname='号', phone='1', cookies='[]'),
    ])
    s.commit()

assert M.engine is eng, '引擎被换掉了，拒绝执行'
r = sweep_expired(now)
print('清除结果:', {k: v for k, v in r.items() if v})

assert r['customer_leads'] == 1, r
assert r['conversations'] == 1, r
assert r['messages'] == 2, r          # 旧会话那条 + 活跃会话里的老消息
assert r['send_tasks'] == 2, r        # 旧会话的待发 + 已发送的老任务
assert r['comments'] == 1 and r['comment_logs'] == 1, r
assert r['drain_records'] == 1 and r['prompt_logs'] == 1, r

with Session(eng) as s:
    assert [c.conv_id for c in s.query(M.Conversation).all()] == ['new']
    assert [m.text for m in s.query(M.Message).all()] == ['新消息']
    tasks = [(t.text, t.status) for t in s.query(M.SendTask).all()]
    assert tasks == [('待发任务', 'pending')], tasks        # 未发送的待办不被清掉
    leads = [l.email for l in s.query(M.CustomerLead).all()]
    assert leads == ['new@x.com'], leads
    assert [c.content for c in s.query(M.Comment).all()] == ['新评论']
    assert [x.target_author for x in s.query(M.CommentLog).all()] == ['己']
    assert [d.target_author for d in s.query(M.DrainRecord).all()] == ['辛']
    assert s.query(M.PromptLog).count() == 1
    assert s.query(M.Account).count() == 1                  # 自有内容不动
    assert s.get(M.Conversation, 2).partner_name == '乙'    # 加密列仍可正常解密

# 幂等：再跑一轮不应再删
r2 = sweep_expired(now)
assert not {k: v for k, v in r2.items() if v}, r2
print('ALL RETENTION TESTS PASSED')
