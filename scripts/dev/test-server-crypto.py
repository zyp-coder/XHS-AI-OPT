# -*- coding: utf-8 -*-
"""自测：服务端字段级加密 + 盲索引 + 存量明文迁移（全程只跑临时库）

运行：PYTHONPATH=. python3 scripts/dev/test-server-crypto.py
"""
import os
import tempfile

os.environ['XHS_OPS_ENCRYPTION_KEY'] = 'roundtrip-test-key'

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.core.crypto import blind_index, decrypt_text
from app.models import models as M


def mk(name):
    return create_engine('sqlite:///' + os.path.join(tempfile.mkdtemp(), name),
                         connect_args={'check_same_thread': False})


# ---------- A/B/C：新库写入 → 落盘密文 → ORM 读回明文 ----------
eng = mk('fresh.db')
M.engine = eng
M.Base.metadata.create_all(eng)

with Session(eng) as s:
    conv = M.Conversation(product='P', conv_id='c1', partner_name='小明',
                          last_msg='你好，怎么卖？', note_title='房贷笔记', ai_tag='价格敏感')
    s.add(conv)
    s.flush()
    s.add(M.Message(conversation_id=conv.id, author='小明', text='想了解下'))
    s.add(M.CommentLog(note_title='某笔记', target_author='张三',
                       target_comment='多少钱', reply_text='私信我'))
    s.add(M.Account(nickname='号A', phone='13800000000', cookies='[]'))
    s.add(M.TargetAccount(nickname='竞品号', xhs_user_id='u1'))
    s.add(M.SendTask(text='您好，资料发您'))
    s.add(M.CustomerLead(email='A@x.com', nickname='张三', email_source_text='留个邮箱 A@x.com'))
    s.commit()
    cid = conv.id

with eng.connect() as conn:
    r = conn.execute(text(
        'SELECT partner_name, last_msg, note_title, ai_tag FROM conversations WHERE id=:i'), {'i': cid}).fetchone()
    assert all(str(x).startswith('enc:v1:') for x in r), r
    assert '小明' not in r[0] and '怎么卖' not in r[1]
    for tbl, cols in [('messages', 'author, text'), ('comment_logs', 'target_author, reply_text'),
                      ('accounts', 'nickname, phone, cookies'), ('target_accounts', 'nickname'),
                      ('send_tasks', 'text')]:
        row = conn.execute(text('SELECT %s FROM %s' % (cols, tbl))).fetchone()
        assert all(str(x).startswith('enc:v1:') for x in row), (tbl, row)
    lead = conn.execute(text(
        'SELECT nickname, email, email_hash, email_source_text FROM customer_leads')).fetchone()
    assert lead[0].startswith('enc:v1:') and lead[1].startswith('enc:v1:') and lead[3].startswith('enc:v1:')
    assert lead[2] and len(lead[2]) == 64 and '@' not in lead[2]
print('A 写入落盘密文 OK')

with Session(eng) as s:
    c = s.get(M.Conversation, cid)
    assert c.partner_name == '小明' and c.last_msg == '你好，怎么卖？' and c.ai_tag == '价格敏感'
    hit = s.query(M.CustomerLead).filter(M.CustomerLead.email_hash == blind_index('a@x.com')).first()
    assert hit is not None and hit.email == 'A@x.com', hit
    assert hit.email_hash == blind_index('A@X.COM')          # 大小写归一后同索引
    assert s.query(M.Message).first().text == '想了解下'
    assert s.query(M.CommentLog).first().reply_text == '私信我'
print('B 读取解密 / 盲索引去重 OK')

with Session(eng) as s:
    s.query(M.CustomerLead).first().nickname = '李四'
    s.get(M.Conversation, cid).last_msg = '改后的消息'
    s.commit()
with eng.connect() as conn:
    v = conn.execute(text('SELECT nickname FROM customer_leads')).scalar()
    m = conn.execute(text('SELECT last_msg FROM conversations WHERE id=:i'), {'i': cid}).scalar()
    assert v.startswith('enc:v1:') and '李四' not in v
    assert m.startswith('enc:v1:') and '改后' not in m
print('C 更新仍密文 OK')

# ---------- D：旧库（明文）迁移 + 幂等 ----------
eng2 = mk('legacy.db')
M.engine = eng2
with eng2.connect() as conn:
    conn.execute(text('CREATE TABLE conversations (id INTEGER PRIMARY KEY, conv_id VARCHAR(200), '
                      'partner_name VARCHAR(200), last_msg TEXT, note_title VARCHAR(300))'))
    conn.execute(text("INSERT INTO conversations VALUES (1,'c9','旧昵称','旧消息','旧标题')"))
    conn.execute(text('CREATE TABLE customer_leads (id INTEGER PRIMARY KEY, nickname VARCHAR(200), '
                      'email VARCHAR(200), email_source_text TEXT, note_title VARCHAR(300))'))
    conn.execute(text("INSERT INTO customer_leads VALUES (1,'老客户','Old@x.com','原文','来源')"))
    conn.execute(text('CREATE TABLE accounts (id INTEGER PRIMARY KEY, nickname VARCHAR(100), '
                      'phone VARCHAR(20), cookies TEXT)'))
    conn.execute(text("INSERT INTO accounts VALUES (1,'号A','13800000000','[]')"))
    conn.execute(text("INSERT INTO conversations VALUES (2,'c10','',NULL,'')"))
    conn.commit()

M._encrypt_existing_plaintext()
M._migrate_email_hash()
M._encrypt_existing_plaintext()      # 幂等：二次执行不应重复加密
M._migrate_email_hash()

with eng2.connect() as conn:
    r = conn.execute(text('SELECT partner_name, last_msg, note_title FROM conversations WHERE id=1')).fetchone()
    assert all(x.startswith('enc:v1:') for x in r), r
    assert decrypt_text(r[0]) == '旧昵称' and decrypt_text(r[1]) == '旧消息' and decrypt_text(r[2]) == '旧标题'
    r2 = conn.execute(text('SELECT partner_name, last_msg, note_title FROM conversations WHERE id=2')).fetchone()
    assert r2[0] == '' and r2[1] is None and r2[2] == '', r2       # 空值不加密
    l = conn.execute(text('SELECT nickname, email, email_source_text, email_hash FROM customer_leads')).fetchone()
    assert all(x.startswith('enc:v1:') for x in l[:3]) and decrypt_text(l[1]) == 'Old@x.com'
    assert l[3] == blind_index('old@x.com'), l[3]
    cols = {c[1] for c in conn.execute(text('PRAGMA table_info(customer_leads)')).fetchall()}
    assert 'email_hash' in cols
    idx = conn.execute(text("SELECT name FROM sqlite_master WHERE type='index' AND name='ix_customer_leads_email_hash'")).fetchone()
    assert idx is not None
    a = conn.execute(text('SELECT nickname, phone, cookies FROM accounts')).fetchone()
    assert all(x.startswith('enc:v1:') for x in a) and decrypt_text(a[1]) == '13800000000'
print('D 存量明文迁移 + 幂等 OK')

# ---------- E：搜索改造后的行为（内存过滤 + 盲索引） ----------
M.engine = eng
with Session(eng) as s:
    rows = s.query(M.Conversation).all()
    kw = '小明'
    hits = [r for r in rows if kw.lower() in (r.partner_name or '').lower()
            or kw.lower() in (r.last_msg or '').lower() or kw.lower() in (r.conv_id or '').lower()]
    assert len(hits) == 1, hits
    leads = s.query(M.CustomerLead).all()
    assert [x for x in leads if '李四' in (x.nickname or '')], leads
print('E 内存关键词过滤 OK')

print('ALL SERVER-SIDE CRYPTO TESTS PASSED')
