# -*- coding: utf-8 -*-
"""一次性：三档换盘（2026-10-09 五十四改）物料卡面重出。

老板已过目卡面文案（两条批复）：Q1「就按这版出」· Q2「发笔记行挪前（让勾读成阶梯）」。

新盘（价格/周期不变）：
  ① 基础版 ¥239/月 ＝ 共有 + 发笔记（写稿 / 素材库·笔记档案 / 出片台）＋ 账号诊断、AI 生成评论
  ② 升级版 ¥399/月 ＝ ① + 获客（一键评论 / 笔记列表 / 关键词维护）
  ③ 全功能版 ¥539/月 ＝ ② + 线索（线索触达 / 获客清单 / 客服话术）

改动文件（每处旧块整块替换）：
  1) 资料/推广物料/A4传单.html            三张档卡（① 3→4 条、②③ 换组）
  2) 资料/推广物料/方案与价格-打印版.html  卖点行重写；✍️ 发笔记行挪到 🎯 行上面并改 ✔✔✔；
                                          🎯 一键灌水→一键评论（—✔✔）；线索行 ——✔
  3) 资料/视频/推广PDF.html               三张档卡与传单同文案（.tt/.more 结构）
  4) 资料/视频/功能演示.html              卖点三格重写；行序同打印版；勾位 ✔✔✔/—✔✔/——✔；
                                          斑马纹随新行序重排；「拟人化节奏」→「停留时间」
  5) scripts/dev/gen_qa9_page.py          第 9 问三张卡 TSELL 换新盘文案（239/399/539 行做锚，防同串相撞）

刻意不动：推广 PDF 页 4 标题「一键灌水 · 全自动跑」——产品功能名场景（含 UI 截图），合规口径里
「灌水」只在传单/卡片类禁；功能演示、打印版、传单里不许有。

写盘：读字节 → utf-8 解码 → 按文件各自 EOL 规范化针脚 → 替换 → 全部断言过了才写 tmp → os.replace。
可重复跑：old 计数 0 且 new 已在 = 跳过；计数对不上整脚本报错、不写任何文件。
"""
import os
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]

# ── 1) A4 传单：三张档卡 ──────────────────────────────────────────────
A4_OLD = '''          <div class="tier">
            <div class="th"><span class="tn"><em>①</em> 基础版</span><span class="tp">¥239<i>/月</i></span></div>
            <div class="ts">AI 帮您写评论、回评论</div>
            <ul>
              <li><b>账号诊断</b>：规划头像、简介、选题</li>
              <li><b>AI 生成评论</b>：帮您触达商机客户</li>
              <li><b>获客</b>：自动找词、一键评论</li>
            </ul>
          </div>
          <div class="tier">
            <div class="th"><span class="tn"><em>②</em> 升级版</span><span class="tp">¥399<i>/月</i></span></div>
            <div class="ts">聊得来的，私信接着跟</div>
            <ul>
              <li><b>线索触达</b>：帮您私信商机客户</li>
              <li><b>获客清单</b>：帮您管理客户</li>
              <li>含基础版全部功能</li>
            </ul>
          </div>
          <div class="tier">
            <div class="th"><span class="tn"><em>③</em> 全功能版</span><span class="tp">¥539<i>/月</i></span></div>
            <div class="ts">AI 写笔记稿，还能出片</div>
            <ul>
              <li><b>发笔记</b>：AI 写稿、可改稿定稿</li>
              <li><b>素材库 · 笔记档案</b>：写过的留档</li>
              <li><b>出片台</b>：口播稿配成竖版视频</li>
              <li>含升级版全部功能</li>
            </ul>
          </div>'''

A4_NEW = '''          <div class="tier">
            <div class="th"><span class="tn"><em>①</em> 基础版</span><span class="tp">¥239<i>/月</i></span></div>
            <div class="ts">AI 写笔记稿，还能出片</div>
            <ul>
              <li><b>账号诊断</b>：规划头像、简介、选题</li>
              <li><b>AI 生成评论</b>：帮您触达商机客户</li>
              <li><b>发笔记</b>：AI 写稿、可改稿定稿</li>
              <li><b>出片台</b>：口播稿配成竖版视频</li>
            </ul>
          </div>
          <div class="tier">
            <div class="th"><span class="tn"><em>②</em> 升级版</span><span class="tp">¥399<i>/月</i></span></div>
            <div class="ts">AI 帮您去评论区捞客户</div>
            <ul>
              <li><b>获客</b>：自动找词、一键评论</li>
              <li><b>笔记列表</b>：帮您盯住流量大的笔记</li>
              <li>含基础版全部功能</li>
            </ul>
          </div>
          <div class="tier">
            <div class="th"><span class="tn"><em>③</em> 全功能版</span><span class="tp">¥539<i>/月</i></span></div>
            <div class="ts">聊得来的，私信接着跟</div>
            <ul>
              <li><b>线索触达</b>：帮您私信商机客户</li>
              <li><b>获客清单</b>：帮您管理客户</li>
              <li>含升级版全部功能</li>
            </ul>
          </div>'''

# ── 2) 方案与价格-打印版：五行表格（卖点 / 换序 / 改名 / 勾位） ──────────
TBL_OLD = '''      <tr><td>一句话卖点</td><td>AI 帮您写评论、回评论</td><td>聊得来的，私信接着跟</td><td>AI 写笔记稿，还能出片</td></tr>
      <tr><td>🩺 账号诊断 · 💬 AI 生成评论 · 📚 产品库 / 知识库</td><td class="feature">✔</td><td class="feature">✔</td><td class="feature">✔</td></tr>
      <tr><td>🎯 一键灌水 · 📋 笔记列表 · 🔑 关键词维护（数量不限）</td><td class="feature">✔</td><td class="feature">✔</td><td class="feature">✔</td></tr>
      <tr><td>👥 线索触达 · 🗂 获客清单 · 💬 客服话术</td><td class="no">—</td><td class="feature">✔</td><td class="feature">✔</td></tr>
      <tr><td>✍️ 笔记生成 · 🖼 素材库 / 笔记档案 · 🎬 出片台</td><td class="no">—</td><td class="no">—</td><td class="feature">✔</td></tr>'''

TBL_NEW = '''      <tr><td>一句话卖点</td><td>AI 写笔记稿，还能出片</td><td>AI 帮您去评论区捞客户</td><td>聊得来的，私信接着跟</td></tr>
      <tr><td>🩺 账号诊断 · 💬 AI 生成评论 · 📚 产品库 / 知识库</td><td class="feature">✔</td><td class="feature">✔</td><td class="feature">✔</td></tr>
      <tr><td>✍️ 笔记生成 · 🖼 素材库 / 笔记档案 · 🎬 出片台</td><td class="feature">✔</td><td class="feature">✔</td><td class="feature">✔</td></tr>
      <tr><td>🎯 一键评论 · 📋 笔记列表 · 🔑 关键词维护（数量不限）</td><td class="no">—</td><td class="feature">✔</td><td class="feature">✔</td></tr>
      <tr><td>👥 线索触达 · 🗂 获客清单 · 💬 客服话术</td><td class="no">—</td><td class="no">—</td><td class="feature">✔</td></tr>'''

# ── 3) 推广 PDF：三张档卡 ─────────────────────────────────────────────
PDF_OLD = '''    <div class="tier">
      <div class="tt">① 基础版</div>
      <div class="tp">¥239<i>/月</i></div>
      <div class="ts">AI 帮您写评论、回评论</div>
      <ul>
        <li><b>账号诊断</b>：规划头像、简介、选题</li>
        <li><b>AI 生成评论</b>：帮您触达商机客户</li>
        <li><b>获客</b>：自动找词、一键评论</li>
      </ul>
    </div>
    <div class="tier">
      <div class="tt">② 升级版</div>
      <div class="tp">¥399<i>/月</i></div>
      <div class="ts">聊得来的，私信接着跟</div>
      <ul>
        <li><b>线索触达</b>：帮您私信商机客户</li>
        <li><b>获客清单</b>：帮您管理客户</li>
        <li class="more">含基础版全部功能</li>
      </ul>
    </div>
    <div class="tier">
      <div class="tt">③ 全功能版</div>
      <div class="tp">¥539<i>/月</i></div>
      <div class="ts">AI 写笔记稿，还能出片</div>
      <ul>
        <li><b>发笔记</b>：AI 写稿、可改稿定稿</li>
        <li><b>素材库 · 笔记档案</b>：写过的留档</li>
        <li><b>出片台</b>：口播稿配成竖版视频</li>
        <li class="more">含升级版全部功能</li>
      </ul>
    </div>'''

PDF_NEW = '''    <div class="tier">
      <div class="tt">① 基础版</div>
      <div class="tp">¥239<i>/月</i></div>
      <div class="ts">AI 写笔记稿，还能出片</div>
      <ul>
        <li><b>账号诊断</b>：规划头像、简介、选题</li>
        <li><b>AI 生成评论</b>：帮您触达商机客户</li>
        <li><b>发笔记</b>：AI 写稿、可改稿定稿</li>
        <li><b>出片台</b>：口播稿配成竖版视频</li>
      </ul>
    </div>
    <div class="tier">
      <div class="tt">② 升级版</div>
      <div class="tp">¥399<i>/月</i></div>
      <div class="ts">AI 帮您去评论区捞客户</div>
      <ul>
        <li><b>获客</b>：自动找词、一键评论</li>
        <li><b>笔记列表</b>：帮您盯住流量大的笔记</li>
        <li class="more">含基础版全部功能</li>
      </ul>
    </div>
    <div class="tier">
      <div class="tt">③ 全功能版</div>
      <div class="tp">¥539<i>/月</i></div>
      <div class="ts">聊得来的，私信接着跟</div>
      <ul>
        <li><b>线索触达</b>：帮您私信商机客户</li>
        <li><b>获客清单</b>：帮您管理客户</li>
        <li class="more">含升级版全部功能</li>
      </ul>
    </div>'''

# ── 4) 功能演示：六行表格（含斑马纹重排 + 停留时间 + 勾位阶梯） ──────────
DEMO_OLD = '''      <tr>
        <td style="background:rgba(255,255,255,.05);color:#cfcfcf;padding:6px 10px;text-align:left;border-radius:8px;">✨ 一句话卖点</td>
        <td style="background:rgba(255,255,255,.05);color:#eef0f4;padding:6px 10px;border-radius:8px;">AI 帮您写评论、回评论</td>
        <td style="background:rgba(255,255,255,.05);color:#eef0f4;padding:6px 10px;border-radius:8px;">聊得来的，私信接着跟</td>
        <td style="background:rgba(255,36,66,.12);color:#ffb3c0;padding:6px 10px;border-radius:8px;">AI 写笔记稿，还能出片</td>
      </tr>
      <tr>
        <td style="background:rgba(255,255,255,.02);color:#cfcfcf;padding:6px 10px;text-align:left;border-radius:8px;">🩺 账号诊断 · 💬 AI 生成评论 · 📚 产品库/知识库</td>
        <td style="background:rgba(255,255,255,.02);color:#4fd07f;padding:6px 10px;border-radius:8px;font-weight:600;">✔</td>
        <td style="background:rgba(255,255,255,.02);color:#4fd07f;padding:6px 10px;border-radius:8px;font-weight:600;">✔</td>
        <td style="background:rgba(255,36,66,.06);color:#4fd07f;padding:6px 10px;border-radius:8px;font-weight:600;">✔</td>
      </tr>
      <tr>
        <td style="background:rgba(255,255,255,.05);color:#cfcfcf;padding:6px 10px;text-align:left;border-radius:8px;">🎯 一键评论 · 📋 笔记列表 · 🔑 关键词维护（数量不限）</td>
        <td style="background:rgba(255,255,255,.05);color:#4fd07f;padding:6px 10px;border-radius:8px;font-weight:600;">✔</td>
        <td style="background:rgba(255,255,255,.05);color:#4fd07f;padding:6px 10px;border-radius:8px;font-weight:600;">✔</td>
        <td style="background:rgba(255,36,66,.06);color:#4fd07f;padding:6px 10px;border-radius:8px;font-weight:600;">✔</td>
      </tr>
      <tr>
        <td style="background:rgba(255,255,255,.02);color:#cfcfcf;padding:6px 10px;text-align:left;border-radius:8px;">👥 线索触达 · 🗂 获客清单 · 💬 客服话术</td>
        <td style="background:rgba(255,255,255,.02);color:#c0c4cc;padding:6px 10px;border-radius:8px;">—</td>
        <td style="background:rgba(255,255,255,.02);color:#4fd07f;padding:6px 10px;border-radius:8px;font-weight:600;">✔</td>
        <td style="background:rgba(255,36,66,.06);color:#4fd07f;padding:6px 10px;border-radius:8px;font-weight:600;">✔</td>
      </tr>
      <tr>
        <td style="background:rgba(255,255,255,.05);color:#cfcfcf;padding:6px 10px;text-align:left;border-radius:8px;">✍️ 笔记生成 · 🖼 素材库/笔记档案 · 🎬 出片台</td>
        <td style="background:rgba(255,255,255,.05);color:#c0c4cc;padding:6px 10px;border-radius:8px;">—</td>
        <td style="background:rgba(255,255,255,.05);color:#c0c4cc;padding:6px 10px;border-radius:8px;">—</td>
        <td style="background:rgba(255,36,66,.06);color:#4fd07f;padding:6px 10px;border-radius:8px;font-weight:600;">✔</td>
      </tr>
      <tr>
        <td style="background:rgba(255,255,255,.05);color:#cfcfcf;padding:6px 10px;text-align:left;border-radius:8px;">🏢 多产品切换 · 数据只存本机 · 发送间隔与拟人化节奏自己设</td>
        <td style="background:rgba(255,255,255,.05);color:#4fd07f;padding:6px 10px;border-radius:8px;font-weight:600;">✔</td>
        <td style="background:rgba(255,255,255,.05);color:#4fd07f;padding:6px 10px;border-radius:8px;font-weight:600;">✔</td>
        <td style="background:rgba(255,36,66,.06);color:#4fd07f;padding:6px 10px;border-radius:8px;font-weight:600;">✔</td>
      </tr>'''

DEMO_NEW = '''      <tr>
        <td style="background:rgba(255,255,255,.05);color:#cfcfcf;padding:6px 10px;text-align:left;border-radius:8px;">✨ 一句话卖点</td>
        <td style="background:rgba(255,255,255,.05);color:#eef0f4;padding:6px 10px;border-radius:8px;">AI 写笔记稿，还能出片</td>
        <td style="background:rgba(255,255,255,.05);color:#eef0f4;padding:6px 10px;border-radius:8px;">AI 帮您去评论区捞客户</td>
        <td style="background:rgba(255,36,66,.12);color:#ffb3c0;padding:6px 10px;border-radius:8px;">聊得来的，私信接着跟</td>
      </tr>
      <tr>
        <td style="background:rgba(255,255,255,.02);color:#cfcfcf;padding:6px 10px;text-align:left;border-radius:8px;">🩺 账号诊断 · 💬 AI 生成评论 · 📚 产品库/知识库</td>
        <td style="background:rgba(255,255,255,.02);color:#4fd07f;padding:6px 10px;border-radius:8px;font-weight:600;">✔</td>
        <td style="background:rgba(255,255,255,.02);color:#4fd07f;padding:6px 10px;border-radius:8px;font-weight:600;">✔</td>
        <td style="background:rgba(255,36,66,.06);color:#4fd07f;padding:6px 10px;border-radius:8px;font-weight:600;">✔</td>
      </tr>
      <tr>
        <td style="background:rgba(255,255,255,.05);color:#cfcfcf;padding:6px 10px;text-align:left;border-radius:8px;">✍️ 笔记生成 · 🖼 素材库/笔记档案 · 🎬 出片台</td>
        <td style="background:rgba(255,255,255,.05);color:#4fd07f;padding:6px 10px;border-radius:8px;font-weight:600;">✔</td>
        <td style="background:rgba(255,255,255,.05);color:#4fd07f;padding:6px 10px;border-radius:8px;font-weight:600;">✔</td>
        <td style="background:rgba(255,36,66,.06);color:#4fd07f;padding:6px 10px;border-radius:8px;font-weight:600;">✔</td>
      </tr>
      <tr>
        <td style="background:rgba(255,255,255,.02);color:#cfcfcf;padding:6px 10px;text-align:left;border-radius:8px;">🎯 一键评论 · 📋 笔记列表 · 🔑 关键词维护（数量不限）</td>
        <td style="background:rgba(255,255,255,.02);color:#c0c4cc;padding:6px 10px;border-radius:8px;">—</td>
        <td style="background:rgba(255,255,255,.02);color:#4fd07f;padding:6px 10px;border-radius:8px;font-weight:600;">✔</td>
        <td style="background:rgba(255,36,66,.06);color:#4fd07f;padding:6px 10px;border-radius:8px;font-weight:600;">✔</td>
      </tr>
      <tr>
        <td style="background:rgba(255,255,255,.05);color:#cfcfcf;padding:6px 10px;text-align:left;border-radius:8px;">👥 线索触达 · 🗂 获客清单 · 💬 客服话术</td>
        <td style="background:rgba(255,255,255,.05);color:#c0c4cc;padding:6px 10px;border-radius:8px;">—</td>
        <td style="background:rgba(255,255,255,.05);color:#c0c4cc;padding:6px 10px;border-radius:8px;">—</td>
        <td style="background:rgba(255,36,66,.06);color:#4fd07f;padding:6px 10px;border-radius:8px;font-weight:600;">✔</td>
      </tr>
      <tr>
        <td style="background:rgba(255,255,255,.02);color:#cfcfcf;padding:6px 10px;text-align:left;border-radius:8px;">🏢 多产品切换 · 数据只存本机 · 发送间隔与停留时间自己设</td>
        <td style="background:rgba(255,255,255,.02);color:#4fd07f;padding:6px 10px;border-radius:8px;font-weight:600;">✔</td>
        <td style="background:rgba(255,255,255,.02);color:#4fd07f;padding:6px 10px;border-radius:8px;font-weight:600;">✔</td>
        <td style="background:rgba(255,36,66,.06);color:#4fd07f;padding:6px 10px;border-radius:8px;font-weight:600;">✔</td>
      </tr>'''

# ── 5) gen_qa9_page.py：第 9 问三张卡卖点句（TSELL 行） ─────────────────
QA9_A_OLD = """        <div style="''' + TNAME + '''">基础版</div>
        <div style="''' + TPRICE + '''">239<i style="''' + TPRICE_I + '''">/月</i></div>
        <div style="''' + TSELL + '''">AI 帮您写评论、回评论</div>"""
QA9_A_NEW = """        <div style="''' + TNAME + '''">基础版</div>
        <div style="''' + TPRICE + '''">239<i style="''' + TPRICE_I + '''">/月</i></div>
        <div style="''' + TSELL + '''">AI 写笔记稿，还能出片</div>"""

QA9_B_OLD = """        <div style="''' + TNAME + '''">升级版</div>
        <div style="''' + TPRICE + '''">399<i style="''' + TPRICE_I + '''">/月</i></div>
        <div style="''' + TSELL + '''">聊得来的，私信接着跟</div>"""
QA9_B_NEW = """        <div style="''' + TNAME + '''">升级版</div>
        <div style="''' + TPRICE + '''">399<i style="''' + TPRICE_I + '''">/月</i></div>
        <div style="''' + TSELL + '''">AI 帮您去评论区捞客户</div>"""

QA9_C_OLD = """        <div style="''' + TNAME + '''">全功能版</div>
        <div style="''' + TPRICE + '''">539<i style="''' + TPRICE_I + '''">/月</i></div>
        <div style="''' + TSELL + '''">AI 写笔记稿，还能出片</div>"""
QA9_C_NEW = """        <div style="''' + TNAME + '''">全功能版</div>
        <div style="''' + TPRICE + '''">539<i style="''' + TPRICE_I + '''">/月</i></div>
        <div style="''' + TSELL + '''">聊得来的，私信接着跟</div>"""

JOBS = [
    dict(path='资料/推广物料/A4传单.html', repls=[(A4_OLD, A4_NEW, 'A4 三张档卡')],
         forbid=['AI 帮您写评论、回评论', '灌水', '拟人'],
         require=['<div class="ts">AI 写笔记稿，还能出片</div>',
                  '<div class="ts">AI 帮您去评论区捞客户</div>',
                  '<div class="ts">聊得来的，私信接着跟</div>',
                  '<b>笔记列表</b>：帮您盯住流量大的笔记']),
    dict(path='资料/推广物料/方案与价格-打印版.html', repls=[(TBL_OLD, TBL_NEW, '打印版五行')],
         forbid=['一键灌水', 'AI 帮您写评论、回评论'],
         require=['<tr><td>一句话卖点</td><td>AI 写笔记稿，还能出片</td>',
                  '<td>🎯 一键评论 · 📋 笔记列表 · 🔑 关键词维护（数量不限）</td>',
                  '<tr><td>✍️ 笔记生成 · 🖼 素材库 / 笔记档案 · 🎬 出片台</td><td class="feature">✔</td><td class="feature">✔</td><td class="feature">✔</td></tr>']),
    dict(path='资料/视频/推广PDF.html', repls=[(PDF_OLD, PDF_NEW, 'PDF 三张档卡')],
         forbid=['AI 帮您写评论、回评论'],
         require=['<div class="ts">AI 写笔记稿，还能出片</div>',
                  '<div class="ts">AI 帮您去评论区捞客户</div>',
                  '<div class="ts">聊得来的，私信接着跟</div>',
                  '<li><b>笔记列表</b>：帮您盯住流量大的笔记</li>']),
    dict(path='资料/视频/功能演示.html', repls=[(DEMO_OLD, DEMO_NEW, '功能演示六行表')],
         forbid=['拟人', 'AI 帮您写评论、回评论'],
         require=['发送间隔与停留时间自己设',
                  '>AI 帮您去评论区捞客户</td>',
                  '>聊得来的，私信接着跟</td>']),
    dict(path='scripts/dev/gen_qa9_page.py',
         repls=[(QA9_A_OLD, QA9_A_NEW, 'qa9 ① 基础版'), (QA9_B_OLD, QA9_B_NEW, 'qa9 ② 升级版'),
                (QA9_C_OLD, QA9_C_NEW, 'qa9 ③ 全功能版')],
         forbid=['AI 帮您写评论、回评论'],
         require=["</i></div>\n        <div style=\"''' + TSELL + '''\">AI 写笔记稿，还能出片</div>",
                  "<div style=\"''' + TSELL + '''\">AI 帮您去评论区捞客户</div>",
                  "<div style=\"''' + TSELL + '''\">聊得来的，私信接着跟</div>"]),
]


def patch(job):
    p = ROOT / job['path']
    raw = p.read_bytes()
    nl = '\r\n' if b'\r\n' in raw else '\n'
    text = raw.decode('utf-8')
    print(f"== {job['path']}  (EOL {'CRLF' if nl == chr(13) + chr(10) else 'LF'} · {len(raw)} 字节)")
    for old, new, tag in job['repls']:
        o, nw = old.replace('\n', nl), new.replace('\n', nl)
        c = text.count(o)
        if c == 0:
            assert nw in text, f"[{tag}] 旧块不在、新块也没写进去——内容对不上，停"
            print(f"  · {tag}: 跳过（已是新文案）")
            continue
        assert c == 1, f"[{tag}] 旧块出现 {c} 次（期望 1 次），停"
        text = text.replace(o, nw, 1)
        print(f"  · {tag}: 已替换")
    for w in job.get('forbid', ()):
        assert w not in text, f"禁词仍在：{w}"
    for w in job.get('require', ()):
        assert w in text, f"缺新文案：{w}"
    if job['path'] == '资料/推广物料/方案与价格-打印版.html' or job['path'] == '资料/视频/功能演示.html':
        i_note = text.index('✍️ 笔记生成') if '✍️ 笔记生成' in text else text.index('笔记生成')
        i_get = text.index('🎯 一键评论')
        i_lead = text.index('👥 线索触达')
        assert i_note < i_get < i_lead, '行序不对：需要 发笔记 < 一键评论 < 线索'
        print('  · 行序 ✓ 发笔记 < 一键评论 < 线索')
    b = text.encode('utf-8')
    tmp = p.with_name(p.name + '.tmp')
    tmp.write_bytes(b)
    os.replace(tmp, p)
    print(f"  ✓ 写盘完成（{len(raw)} → {len(b)} 字节）")


def main():
    for job in JOBS:
        patch(job)
    print('全部完成：5 份文件已按新盘改写（可重复跑，已改的会跳过）。')


if __name__ == '__main__':
    main()
