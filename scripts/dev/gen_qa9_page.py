# -*- coding: utf-8 -*-
"""A4 传单 9 问 → 9 问快闪竖屏页：复用长版的 CSS / 舞台 / 人物 / 驱动脚本，只换 11 幕场景。

用法：python3 scripts/dev/gen_qa9_page.py
产出：资料/视频/AI雕兄口播稿/9问快闪/AI雕兄-9问-竖屏.html

改词只改下面的 SCENES 再跑一次；每幕 <p>（只在 .notes-src 里）是口播唯一真源。
口径按 资料/推广物料/使用说明.md 的「口径」表：漏斗刀号 4300/月、私信「您点头才发」、
客户名单、白话化用语（捞客/加微信/真人节奏）、三档 239/399/539、效果因人而异。
"""
import base64
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from render_video import MAT
from use_my_voice import scene_needs, GAP

SRC = MAT / 'AI雕兄-动效演示-竖屏.html'
DST = MAT / '9问快闪' / 'AI雕兄-9问-竖屏.html'
RATE = 5.9   # 字/秒，长版实测（961 字 / 162.8s 纯说话）

# 第 8 问用两张后台原截图（与传单开头同源），内联避免相对路径失效
B64_CURVE = base64.b64encode((MAT / '配图' / '个人实战-曲线.jpg').read_bytes()).decode('ascii')
B64_IND = base64.b64encode((MAT / '配图' / '个人实战-指标.jpg').read_bytes()).decode('ascii')

BOX = ('flex:1;min-width:0;border:2px solid var(--line);border-radius:18px;'
       'padding:18px 6px;background:rgba(212,175,55,.08);text-align:center')
NUM = 'display:block;font-size:44px;font-weight:900;color:var(--gold);line-height:1.1'
LBL = 'display:block;margin-top:8px;font-size:20px;color:var(--gray)'
ARW = ('flex:none;display:flex;flex-direction:column;align-items:center;justify-content:center;'
       'font-size:20px;color:var(--gray);line-height:1.35')
CARD = ('flex:1;min-width:0;border:2px solid var(--line);border-radius:22px;padding:26px 16px;'
        'background:rgba(212,175,55,.05);text-align:center')
TNAME = 'font-size:28px;color:var(--gray);letter-spacing:.14em'
TPRICE = 'font-size:60px;font-weight:900;color:var(--gold);line-height:1.15;margin-top:10px'
TPRICE_I = 'font-style:normal;font-size:22px;font-weight:400;color:var(--gray)'
TSELL = 'font-size:22px;color:var(--dim);margin-top:12px;line-height:1.45;white-space:nowrap'

SCENES = '''
<!-- 01 开场 · 9 个问题 -->
<section class="scene" data-name="开场 · 9 个问题">
  <div class="kicker anim">AI 雕兄 · 小红书评论区获客</div>
  <div class="inner" style="gap:26px">
    <div class="brand a-fade" style="--d:.1s">前大厂码农 · 江湖散人</div>
    <div class="a-zoom" style="--d:.35s;--t:.7s;position:relative">
      <div class="num" data-count="1000" data-suf="+" data-delay="800" data-dur="1500">0</div>
      <div class="sparks">
        <span class="spark" style="--tx:-400px;--ty:-140px;--d:1.2s"></span>
        <span class="spark" style="--tx:-260px;--ty:-280px;--d:1.3s"></span>
        <span class="spark" style="--tx:280px;--ty:-280px;--d:1.35s"></span>
        <span class="spark" style="--tx:410px;--ty:-130px;--d:1.25s"></span>
        <span class="spark" style="--tx:-360px;--ty:70px;--d:1.4s"></span>
        <span class="spark" style="--tx:370px;--ty:80px;--d:1.45s"></span>
      </div>
    </div>
    <div class="numlab a-fade" style="--d:.95s">15 天 · 承接真人用户</div>
    <div style="display:flex;gap:26px">
      <span class="chip anim" style="--d:1.2s">没投广告</span>
      <span class="chip anim" style="--d:1.35s">没买流量</span>
    </div>
    <div class="a-zoom" style="--d:1.6s;--t:.85s"><span class="sheen impact" style="font-size:104px">9 个问题</span></div>
    <div class="sub a-fade" style="--d:2.1s">看完再决定 · 您先别急着答</div>
    <div class="tiny a-fade" style="--d:2.5s">个人实测数据 · 效果因人而异</div>
  </div>
  <div class="notes-src">
    <p>老板您好。没投广告、没买流量，15 天承接 1000 多个真人。做您这行，9 个问题绕不开。</p>
  </div>
</section>

<!-- 02 第 1 问 · 流量有多大 -->
<section class="scene" data-name="第 1 问 · 流量有多大">
  <div class="kicker anim">第 1 问 · 流量有多大</div>
  <div class="inner" style="gap:30px">
    <div class="a-fade" style="--d:.1s;font-size:56px;font-weight:900;line-height:1.3">本地咨询流量，每天到底有多大？</div>
    <div class="a-fade" style="--d:.45s;font-size:30px;color:var(--dim)">小红书月活 <span class="gold">4 亿</span> · 每天 <span class="gold">8 亿次</span>搜索 —— 按您的城市和行业，一刀一刀往下砍</div>
    <div class="a-fade" style="--d:.8s;display:flex;align-items:stretch;gap:8px;width:940px">
      <div style="''' + BOX + '''">
        <b style="''' + NUM + '''">4 亿</b><span style="''' + LBL + '''">全平台月活</span>
      </div>
      <span style="''' + ARW + '''"><i style="font-style:normal">第一刀</i><em style="font-style:normal;color:var(--gold);font-weight:900">×50%</em></span>
      <div style="''' + BOX + '''">
        <b style="''' + NUM + '''">2 亿</b><span style="''' + LBL + '''">带着购买意图</span>
      </div>
      <span style="''' + ARW + '''"><i style="font-style:normal">第二刀</i><em style="font-style:normal;color:var(--gold);font-weight:900">×0.2%</em></span>
      <div style="''' + BOX + '''">
        <b style="''' + NUM + '''">43 万</b><span style="''' + LBL + '''">同一个城市</span>
      </div>
      <span style="''' + ARW + '''"><i style="font-style:normal">第三刀</i><em style="font-style:normal;color:var(--gold);font-weight:900">×1%</em></span>
      <div style="''' + BOX + '''">
        <b style="''' + NUM + '''">4300</b><span style="''' + LBL + '''">同行业 / 月</span>
      </div>
    </div>
    <div class="a-zoom" style="--d:1.4s;--t:.8s"><span class="sheen impact" style="font-size:80px">每月 <em style="font-style:normal">4300</em> 个<br>带购买意图的人</span></div>
    <div class="a-fade" style="--d:1.9s;font-size:34px;color:var(--dim)">要接，就趁现在 —— 您一个都还没接</div>
  </div>
  <div class="notes-src">
    <p>第一问：流量到底多大？小红书每天 8 亿次搜索——砍到您的城市和行业，每月还有 4300 个带购买意图的人，您一个都没接。</p>
  </div>
</section>

<!-- 03 第 2 问 · 效果咋样 -->
<section class="scene" data-name="第 2 问 · 效果咋样">
  <div class="kicker anim">第 2 问 · 效果咋样</div>
  <div class="inner" style="gap:24px">
    <div class="a-fade" style="--d:.1s;font-size:56px;font-weight:900">效果会咋样？能测算吗？</div>
    <div class="msg a-left" style="--d:.4s"><span class="avatar"></span><span class="bubble">想找个靠谱的，哪家好？</span></div>
    <div class="msg a-left" style="--d:.75s"><span class="avatar" style="background:linear-gradient(180deg,#e0c268,#8a7020)"></span><span class="bubble" style="color:var(--gold)">我们做这行的，主页看看，聊两句？</span></div>
    <div class="a-fade" style="--d:1.15s;font-size:32px;color:var(--dim)">有人在评论区问 —— 您的号就在那儿接上话</div>
    <div class="a-zoom" style="--d:1.5s;--t:.8s"><span class="sheen impact" style="font-size:70px">系统每天替您干的就是这件事</span></div>
    <div style="display:flex;gap:22px">
      <span class="chip anim" style="--d:1.9s;font-size:26px;padding:14px 30px;white-space:nowrap">私信接着跟 · 您点头才发</span>
      <span class="chip anim" style="--d:2.05s;font-size:26px;padding:14px 30px;white-space:nowrap">客户名单 · 谈成没谈成看得见</span>
    </div>
  </div>
  <div class="notes-src">
    <p>第二问：效果咋样？有人发笔记问「哪家好」，您的号就接上话；私信接着跟，您点头才发。客户名单里看得见。</p>
  </div>
</section>

<!-- 04 第 3 问 · 怎么做的 -->
<section class="scene" data-name="第 3 问 · 怎么做的">
  <div class="kicker anim">第 3 问 · 怎么做的</div>
  <div class="inner" style="gap:30px">
    <div class="a-fade" style="--d:.1s;font-size:52px;font-weight:900">您这套是怎么做的？</div>
    <div class="rows-sm">
      <div class="row a-left" style="--d:.45s"><span class="rn">1</span><div><b>账号诊断</b><i>规划头像、简介、选题</i></div></div>
      <div class="row a-left" style="--d:.6s"><span class="rn">2</span><div><b>发笔记</b><i>用您的产品知识库出内容</i></div></div>
      <div class="row a-left" style="--d:.75s"><span class="rn">3</span><div><b>评论区捞客</b><i>只捞主动问「哪家好」的人</i></div></div>
      <div class="row a-left" style="--d:.9s"><span class="rn">4</span><div><b>客户名单</b><i>谁高意向、谁在跟、谁成交</i></div></div>
    </div>
    <div class="a-zoom" style="--d:1.2s;--t:.8s"><span class="sheen impact" style="font-size:72px">从内容到客户，一条链</span></div>
  </div>
  <div class="notes-src">
    <p>第三问：怎么做的？四步——账号诊断、发笔记、评论区捞客、客户名单。</p>
  </div>
</section>

<!-- 05 第 4 问 · 跟代运营、AI 工具比呢 -->
<section class="scene" data-name="第 4 问 · 跟代运营、AI 工具比呢">
  <div class="kicker anim">第 4 问 · 跟代运营、AI 工具比呢</div>
  <div class="inner" style="gap:28px">
    <div class="a-fade" style="--d:.1s;font-size:50px;font-weight:900">跟代运营、买 AI 工具的比呢？</div>
    <div class="cmp" style="gap:24px">
      <div class="cmp-item a-fade" style="--d:.4s;font-size:38px"><span class="mark no sm a-stamp" style="--d:.7s;--t:.5s">×</span><span class="dim">代运营</span><span style="font-size:28px;font-weight:400;color:var(--gray)">模板通用，不盯评论区</span></div>
      <div class="cmp-item a-fade" style="--d:.6s;font-size:38px"><span class="mark no sm a-stamp" style="--d:.9s;--t:.5s">×</span><span class="dim">AI 工具</span><span style="font-size:28px;font-weight:400;color:var(--gray)">按次收钱，不懂您行业</span></div>
      <div class="cmp-item a-fade" style="--d:.8s;font-size:38px"><span class="mark yes sm a-stamp" style="--d:1.1s;--t:.5s">✓</span><span class="gold">AI 雕兄</span><span style="font-size:28px;font-weight:400;color:var(--dim)">用您自己的资料，固定流程</span></div>
    </div>
    <div class="a-zoom" style="--d:1.4s;--t:.8s"><span class="sheen impact" style="font-size:72px">结果稳，还不外行</span></div>
  </div>
  <div class="notes-src">
    <p>第四问：跟代运营、AI 工具比呢？代运营是模板，AI 工具按次收钱；这套用您自己的资料。</p>
  </div>
</section>

<!-- 06 第 5 问 · 同行也在用吗 -->
<section class="scene" data-name="第 5 问 · 同行也在用吗">
  <div class="kicker anim">第 5 问 · 同行也在用吗</div>
  <div class="inner" style="gap:32px">
    <div class="a-fade" style="--d:.1s;font-size:52px;font-weight:900">同行也在用吗？会被发现吗？</div>
    <div class="a-zoom" style="--d:.5s;--t:.7s"><span class="stamp-chip a-stamp" style="--d:.5s;--t:.5s">同行在捞，您只是看不见</span></div>
    <div class="a-zoom" style="--d:.9s;--t:.85s"><span class="sheen impact" style="font-size:96px">拼的就是速度</span></div>
    <div class="a-fade" style="--d:1.4s;font-size:34px;color:var(--dim)">池子是公共的 —— 晚一天，少接一天</div>
  </div>
  <div class="notes-src">
    <p>第五问：同行也在用吗？同行在捞，您只是看不见。池子是公共的——晚一天，少接一天。</p>
  </div>
</section>

<!-- 07 第 6 问 · 我不懂小红书 -->
<section class="scene" data-name="第 6 问 · 我不懂小红书">
  <div class="kicker anim">第 6 问 · 我不懂小红书</div>
  <div class="inner" style="gap:24px">
    <div class="a-fade" style="--d:.1s;font-size:52px;font-weight:900">我不懂小红书，您全盘负责吗？</div>
    <div class="a-zoom" style="--d:.45s;--t:.8s">
      <div class="num" data-count="30" data-suf=" 分钟" data-delay="800" data-dur="1400" style="font-size:220px">0</div>
    </div>
    <div class="numlab a-fade" style="--d:.95s">您每天只需要花这么多时间</div>
    <div style="display:flex;gap:18px">
      <span class="chip anim" style="--d:1.25s;font-size:28px;padding:14px 30px">账号诊断</span>
      <span class="chip anim" style="--d:1.4s;font-size:28px;padding:14px 30px">发笔记</span>
      <span class="chip anim" style="--d:1.55s;font-size:28px;padding:14px 30px">评论区动作</span>
      <span class="chip anim" style="--d:1.7s;font-size:28px;padding:14px 30px">客户维护</span>
    </div>
    <div class="a-zoom" style="--d:2.0s;--t:.8s"><span class="sheen impact" style="font-size:70px">其余，全自动</span></div>
  </div>
  <div class="notes-src">
    <p>第六问：不懂小红书怎么办？账号、内容、评论区、客户，系统都管——您每天 30 分钟。</p>
  </div>
</section>

<!-- 08 第 7 问 · 会违规吗 -->
<section class="scene" data-name="第 7 问 · 会违规吗">
  <div class="kicker anim">第 7 问 · 会违规吗</div>
  <div class="inner" style="gap:30px">
    <div class="a-fade" style="--d:.1s;font-size:52px;font-weight:900">会涉及平台违规吗？</div>
    <div class="a-zoom" style="--d:.4s;--t:.7s"><span class="stamp-chip a-stamp" style="--d:.4s;--t:.5s">红线摆到明面上</span></div>
    <div class="cmp" style="gap:22px">
      <div class="cmp-item a-fade" style="--d:.9s"><span class="mark yes sm a-stamp" style="--d:1.2s;--t:.5s">✓</span><span>站内只走主页简介和私信</span></div>
      <div class="cmp-item a-fade" style="--d:1.1s"><span class="mark no sm a-stamp" style="--d:1.4s;--t:.5s">×</span><span class="dim">不刷量、不硬广</span></div>
    </div>
    <div class="a-fade" style="--d:1.7s;font-size:34px;color:var(--dim)">按真人节奏发布 · 评论区不直导站外</div>
  </div>
  <div class="notes-src">
    <p>第七问：会违规吗？红线摆明面上：站内只走主页简介和私信，不刷量、不硬广。</p>
  </div>
</section>

<!-- 09 第 8 问 · 凭什么信我 -->
<section class="scene" data-name="第 8 问 · 凭什么信我">
  <div class="kicker anim">第 8 问 · 凭什么信我</div>
  <div class="inner" style="gap:22px">
    <div class="a-fade" style="--d:.1s;font-size:52px;font-weight:900">我为什么信您？</div>
    <div class="shotrow" style="align-items:center;gap:24px">
      <span class="pfshot a-fade" style="--d:.45s;width:430px"><img alt="后台用户增长曲线" src="data:image/jpeg;base64,__CURVE__"></span>
      <span class="pfshot a-fade" style="--d:.6s;width:430px"><img alt="后台累计用户 1412" src="data:image/jpeg;base64,__IND__"></span>
    </div>
    <div class="a-fade" style="--d:.9s;font-size:28px;color:var(--gray)">后台实拍 · 累计 1,412 人 · 效果因人而异</div>
    <div class="a-fade" style="--d:1.2s;font-size:38px">这套系统，是我先给自己做的</div>
    <div class="a-zoom" style="--d:1.6s;--t:.8s"><span class="sheen impact" style="font-size:74px">信不信不要紧，先看东西</span></div>
  </div>
  <div class="notes-src">
    <p>第八问：凭什么信我？这套系统是我先给自己做的，弯路我先走一遍。后台数据我摆出来。</p>
  </div>
</section>

<!-- 10 第 9 问 · 价钱怎么算 -->
<section class="scene" data-name="第 9 问 · 价钱怎么算">
  <div class="kicker anim">第 9 问 · 价钱怎么算</div>
  <div class="inner" style="gap:26px">
    <div class="a-fade" style="--d:.1s;font-size:52px;font-weight:900">您的价钱是怎么算的？</div>
    <div class="a-fade" style="--d:.35s;font-size:30px;color:var(--dim)">按月付费 · 装在您自己的浏览器里 · 数据只存本机</div>
    <div style="display:flex;gap:20px;width:940px;align-items:stretch">
      <div class="a-left" style="--d:.55s;''' + CARD + '''">
        <div style="''' + TNAME + '''">基础版</div>
        <div style="''' + TPRICE + '''">239<i style="''' + TPRICE_I + '''">/月</i></div>
        <div style="''' + TSELL + '''">AI 写笔记稿，还能出片</div>
      </div>
      <div class="a-left" style="--d:.7s;''' + CARD + '''">
        <div style="''' + TNAME + '''">升级版</div>
        <div style="''' + TPRICE + '''">399<i style="''' + TPRICE_I + '''">/月</i></div>
        <div style="''' + TSELL + '''">AI 帮您去评论区捞客户</div>
      </div>
      <div class="a-left" style="--d:.85s;''' + CARD + '''">
        <div style="''' + TNAME + '''">全功能版</div>
        <div style="''' + TPRICE + '''">539<i style="''' + TPRICE_I + '''">/月</i></div>
        <div style="''' + TSELL + '''">聊得来的，私信接着跟</div>
      </div>
    </div>
    <div class="a-zoom" style="--d:1.35s;--t:.8s"><span class="sheen impact" style="font-size:70px">拿不准？免费做个测评</span></div>
  </div>
  <div class="notes-src">
    <p>第九问：价钱怎么算？按月付费，装在您自己的浏览器里：基础版 239、升级版 399、全功能 539。</p>
  </div>
</section>

<!-- 11 收口 · 免费测评 -->
<section class="scene" data-name="收口 · 免费测评">
  <div class="kicker anim">AI 雕兄 · 免费测评</div>
  <div class="inner" style="gap:30px">
    <div class="brand a-fade" style="--d:.1s">前大厂码农 · 江湖散人</div>
    <div class="a-zoom" style="--d:.45s;--t:.9s;line-height:1.25"><span class="sheen impact" style="font-size:110px">免费<br>先做个测评</span></div>
    <div class="sub a-fade" style="--d:1.05s">方向对不对，做一次就知道 · 不合适，不勉强</div>
    <div class="guide a-fade" style="--d:1.55s">看<b>主页简介</b> / <b>私信我</b></div>
    <div class="tiny a-fade" style="--d:2.0s">不花一分钱，换一套跑通的打法 · 效果因人而异</div>
  </div>
  <div class="notes-src">
    <p>拿不准选哪档？联系我免费做个测评。看主页简介，或私信我。</p>
  </div>
</section>
'''


def main():
    src = SRC.read_text(encoding='utf-8').split('\n')
    i_first_scene = next(i for i, l in enumerate(src) if '<!-- 01' in l)
    i_host = next(i for i, l in enumerate(src) if l.startswith('<div id="hostwrap">'))
    head = '\n'.join(src[:i_first_scene]).rstrip('\n').replace(
        '<title>AI 雕兄 · 动效演示</title>', '<title>AI 雕兄 · 9 问快闪</title>')
    tail = '\n'.join(src[i_host:])
    scenes = SCENES.strip('\n').replace('__CURVE__', B64_CURVE).replace('__IND__', B64_IND)
    DST.parent.mkdir(parents=True, exist_ok=True)
    DST.write_text(head + '\n\n' + scenes + '\n\n' + tail + '\n', encoding='utf-8')

    needs = scene_needs(DST)
    print('写出 %s（%.1f KB）' % (DST, DST.stat().st_size / 1024))
    print('%-30s %5s %9s %9s %9s' % ('幕', '字数', '预估说话', '需要动画', '幕间静默'))
    speech = gaps = 0.0
    for i, s in enumerate(needs, 1):
        dur = s['chars'] / RATE
        gap = max(GAP, s['need'] - dur) if i < len(needs) else 0.0
        speech += dur
        gaps += gap
        print('%2d %-27s %5d %8.1fs %8.1fs %8.2fs' % (i, s['name'], s['chars'], dur, s['need'], gap))
    print('合计 说话 %.1fs + 幕间 %.1fs + 头尾 2.2s ≈ %.1fs' % (speech, gaps, speech + gaps + 2.2))


if __name__ == '__main__':
    main()
