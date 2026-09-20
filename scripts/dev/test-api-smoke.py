# -*- coding: utf-8 -*-
"""冒烟自测：临时库跑通 init_db + 客户接口 + 加密后的搜索改造（全程只跑临时库）

运行：PYTHONPATH=. python3 scripts/dev/test-api-smoke.py
"""
import os
import tempfile

os.environ['XHS_OPS_ENCRYPTION_KEY'] = 'smoke-test-key'

import config

_tmpdir = tempfile.mkdtemp()
_db = os.path.join(_tmpdir, 'smoke.db').replace('\\', '/')
config.DATABASE_URL = 'sqlite:///' + _db

from sqlalchemy import text
from sqlalchemy.orm import Session

import app.models.models as M

assert 'smoke.db' in str(M.engine.url), M.engine.url
M.init_db()

from datetime import datetime, timedelta

from fastapi.testclient import TestClient

import main

with Session(M.engine) as s:
    s.add(M.Conversation(product='P', conv_id='conv-abc', partner_name='小明',
                         last_msg='你好，这个怎么卖？', last_at=datetime.now()))
    s.add(M.Conversation(product='P', conv_id='conv-xyz', partner_name='小红',
                         last_msg='谢谢', last_at=datetime.now() - timedelta(days=200)))
    s.commit()

with TestClient(main.app) as client:
    # 客户上报 → 新建
    r = client.post('/api/customers/report', json={
        'email': 'A@x.com', 'nickname': '张三', 'text': '留个邮箱 A@x.com', 'product': 'P'})
    assert r.status_code == 200 and r.json()['created'] is True, r.text

    # 同邮箱（大小写不同）→ 盲索引去重，不新建
    r = client.post('/api/customers/report', json={'email': 'a@x.com', 'nickname': '张三'})
    assert r.status_code == 200 and r.json()['created'] is False, r.text

    # 新邮箱 → 新建
    r = client.post('/api/customers/report', json={'email': 'b@x.com', 'nickname': '李四'})
    assert r.json()['created'] is True, r.text

    # 列表：返回明文（读取解密）
    r = client.get('/api/customers')
    items = r.json()['items']
    assert r.json()['total'] == 2 and sorted(i['email'] for i in items) == ['a@x.com', 'b@x.com'], items
    assert any(i['nickname'] == '张三' for i in items), items

    # 关键词搜索：昵称 / 邮箱（内存过滤）
    assert client.get('/api/customers', params={'keyword': '张'}).json()['total'] == 1
    assert client.get('/api/customers', params={'keyword': 'b@x'}).json()['total'] == 1
    assert client.get('/api/customers', params={'keyword': '查无此人'}).json()['total'] == 0

    # 落盘确认：邮箱/昵称在库里是密文，且有盲索引
    with M.engine.connect() as c:
        row = c.execute(text('SELECT nickname, email, email_hash, email_source_text FROM customer_leads '
                             'WHERE email_hash != "" ORDER BY id')).fetchall()
        assert len(row) == 2, row
        assert all(str(x[0]).startswith('enc:v1:') and str(x[1]).startswith('enc:v1:')
                   and (x[3] == '' or str(x[3]).startswith('enc:v1:')) for x in row), row
        assert all(len(x[2]) == 64 and '@' not in x[2] for x in row), row

    # 会话搜索：昵称 / 最后消息（内存过滤）
    assert client.get('/api/messages', params={'keyword': '小明'}).json()['total'] == 1
    assert client.get('/api/messages', params={'keyword': '怎么卖'}).json()['total'] == 1
    assert client.get('/api/messages', params={'keyword': 'conv-xyz'}).json()['total'] == 1
    assert client.get('/api/messages', params={'keyword': '查无此词'}).json()['total'] == 0
    # 关键词 + 时间筛选并存
    r = client.get('/api/messages', params={'keyword': '小明', 'recency': 'today'}).json()
    assert r['total'] == 1, r
    r = client.get('/api/messages', params={'keyword': '小明', 'recency': 'older'}).json()
    assert r['total'] == 0, r

    # 会话内容读取解密
    r = client.get('/api/messages').json()
    assert {i['partner_name'] for i in r['items']} == {'小明', '小红'}, r
    assert any(i['last_msg'] == '你好，这个怎么卖？' for i in r['items']), r

    # 健康检查
    assert client.get('/api/health').json()['status'] == 'ok'

print('ALL SERVER SMOKE TESTS PASSED')
