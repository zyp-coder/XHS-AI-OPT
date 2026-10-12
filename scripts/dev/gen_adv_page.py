# -*- coding: utf-8 -*-
"""口播稿「系统优势总结版」→ 11 幕竖屏页：复用长版的 CSS / 舞台 / 人物 / 驱动脚本，只换场景。

用法：python3 scripts/dev/gen_adv_page.py
产出：资料/视频/AI雕兄口播稿/系统优势总结/AI雕兄-优势-竖屏.html

改词只改下面的 SCENES 再跑一次；每幕 <p>（只在 .notes-src 里）是口播唯一真源（与
资料/视频/AI雕兄口播稿/口播稿-系统优势总结.md 的分幕表逐字一致）。
口径按 资料/推广物料/使用说明.md 的「口径」表：捞客 / 客户名单 / 您点头才发、
三档 239/399/539、数据只存本机、效果因人而异；画面不出现「狙击/猎杀」等字样。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from render_video import MAT
from use_my_voice import scene_needs, GAP

SRC = MAT / 'AI雕兄-动效演示-竖屏.html'
DST = MAT / '系统优势总结' / 'AI雕兄-优势-竖屏.html'
RATE = 5.23  # 字/秒，晓晓 +20% 实测（9问 456 字 / 87.1s 纯说话）

BOX = ('flex:1;min-width:0;border:2px solid var(--line);border-radius:18px;'
       'padding:22px 10px;background:rgba(212,175,55,.08);text-align:center')
BX_B = 'display:block;font-size:40px;font-weight:900;color:var(--gold);line-height:1.15'
BX_S = 'display:block;margin-top:10px;font-size:20px;color:var(--gray);line-height:1.4'
ARW = ('flex:none;display:flex;align-items:center;justify-content:center;'
       'font-size:30px;color:var(--gold)')

SCENES = '''
<!-- 01 开场 · 8 句话 -->
<section class="scene" data-name="开场 · 8 句话">
  <div class="kicker anim">AI 雕兄 · 系统优势总结</div>
  <div class="inner" style="gap:28px">
    <div class="brand a-fade" style="--d:.1s">前大厂码农 · 江湖散人</div>
    <div class="a-fade" style="--d:.4s;font-size:52px;font-weight:900;line-height:1.32">很多人不知道<br>小红书怎么捞客</div>
    <div class="a-zoom" style="--d:.9s;--t:.85s"><span class="sheen impact" style="font-size:118px">重点在哪？</span></div>
    <div class="sub a-fade" style="--d:1.5s">8 句话，我给您说清</div>
  </div>
  <div class="notes-src">
    <p>很多人不知道小红书怎么捞客，重点在哪？八句话，我给您说清。</p>
  </div>
</section>

<!-- 02 第一 · 四件事全管 -->
<section class="scene" data-name="第一 · 四件事全管">
  <div class="kicker anim">第一 · 四件事全管</div>
  <div class="inner" style="gap:24px">
    <div class="a-fade" style="--d:.1s;font-size:50px;font-weight:900">别的工具只干一件事</div>
    <div class="rows-sm">
      <div class="row a-left" style="--d:.45s"><span class="rn">1</span><div><b>账号诊断</b><i>头像、简介、选题怎么规划</i></div></div>
      <div class="row a-left" style="--d:.6s"><span class="rn">2</span><div><b>发笔记</b><i>用您的产品知识库出内容</i></div></div>
      <div class="row a-left" style="--d:.75s"><span class="rn">3</span><div><b>评论区捞客</b><i>去有商机的笔记下面接话</i></div></div>
      <div class="row a-left" style="--d:.9s"><span class="rn">4</span><div><b>客户名单</b><i>谁在跟、谁成交，一眼看清</i></div></div>
    </div>
    <div class="a-zoom" style="--d:1.2s;--t:.8s"><span class="sheen impact" style="font-size:76px">四步一条龙</span></div>
  </div>
  <div class="notes-src">
    <p>第一，别的工具只干一件事，这套四件事全管：帮您诊断账号、帮您发笔记、去评论区里捞客户、把客户名单管起来——四步一条龙。</p>
  </div>
</section>

<!-- 03 第二 · 方法从哪来 -->
<section class="scene" data-name="第二 · 方法从哪来">
  <div class="kicker anim">第二 · 方法从哪来</div>
  <div class="inner" style="gap:26px">
    <div class="a-zoom" style="--d:.1s;--t:.7s"><span class="stamp-chip a-stamp" style="--d:.1s;--t:.5s">研究了大量的小红书评论</span></div>
    <div class="cmp" style="gap:24px">
      <div class="cmp-item a-fade" style="--d:.5s;font-size:36px"><span class="mark no sm a-stamp" style="--d:.8s;--t:.5s">×</span><span class="dim">打广告</span></div>
      <div class="cmp-item a-fade" style="--d:.7s;font-size:36px"><span class="mark yes sm a-stamp" style="--d:1.0s;--t:.5s">✓</span><span class="gold">接一句有用的话</span></div>
    </div>
    <div class="a-zoom" style="--d:1.3s;--t:.8s"><span class="sheen impact" style="font-size:78px">最有效的获客方法</span></div>
    <div class="a-fade" style="--d:1.8s;font-size:40px;color:var(--gold)">＝ 评论区接一句有用的话</div>
    <div class="a-fade" style="--d:2.1s;font-size:30px;color:var(--gray)">刷到的人，会顺手点开您的主页</div>
  </div>
  <div class="notes-src">
    <p>第二，我们研究了大量的小红书评论之后发现：最有效的获客方法，不是打广告，是去别人正在被看的笔记下面，接一句有用的话——刷到的人，会顺手点开您的主页。</p>
  </div>
</section>

<!-- 04 第三 · 说「您」的话 -->
<section class="scene" data-name="第三 · 说「您」的话">
  <div class="kicker anim">第三 · 说「您」的话</div>
  <div class="inner" style="gap:24px">
    <div class="a-fade" style="--d:.1s;font-size:50px;font-weight:900">它不说通用套话</div>
    <div class="a-fade" style="--d:.4s;display:flex;gap:10px;width:940px;align-items:stretch">
      <div style="''' + BOX + '''"><b style="''' + BX_B + '''">人设</b><span style="''' + BX_S + '''">你是谁 · 踩过哪些坑</span></div>
      <div style="''' + BOX + '''"><b style="''' + BX_B + '''">卖点</b><span style="''' + BX_S + '''">您的产品 · 拿手干货</span></div>
      <div style="''' + BOX + '''"><b style="''' + BX_B + '''">真资料</b><span style="''' + BX_S + '''">您自己的知识库</span></div>
    </div>
    <div class="a-fade" style="--d:1.0s;font-size:34px">＋ 说话的口气，照着您本人来</div>
    <div class="a-zoom" style="--d:1.5s;--t:.85s"><span class="sheen impact" style="font-size:82px">条条打在七寸上</span></div>
    <div class="a-fade" style="--d:2.0s;font-size:30px;color:var(--gray)">不像一眼假的 AI 广告，像懂您这行的老师傅</div>
  </div>
  <div class="notes-src">
    <p>第三，它不说通用套话，说的是「您」的话：您的人设、您的卖点、您踩过的坑，全熔进一句人话里——连说话的口气都照着您本人来，条条打在对方的七寸上。所以它不像一眼假的 AI 广告，像懂您这行的老师傅。</p>
  </div>
</section>

<!-- 05 第四 · 五种笔记五种聊法 -->
<section class="scene" data-name="第四 · 五种笔记五种聊法">
  <div class="kicker anim">第四 · 五种笔记，五种聊法</div>
  <div class="inner" style="gap:26px">
    <div class="a-fade" style="--d:.1s;font-size:50px;font-weight:900">不是一套话术刷到底</div>
    <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:18px;width:940px">
      <span class="chip anim" style="--d:.5s;font-size:26px;padding:16px 28px">刚冒头 · 抢C位</span>
      <span class="chip anim" style="--d:.62s;font-size:26px;padding:16px 28px">搜索老帖 · 占深度</span>
      <span class="chip anim" style="--d:.74s;font-size:26px;padding:16px 28px">同城帖 · 拉近乎</span>
      <span class="chip anim" style="--d:.86s;font-size:26px;padding:16px 28px">求助帖 · 给方案</span>
      <span class="chip anim" style="--d:.98s;font-size:26px;padding:16px 28px">大V帖 · 补干货</span>
    </div>
    <div class="a-zoom" style="--d:1.5s;--t:.8s"><span class="sheen impact" style="font-size:78px">五种笔记，五种聊法</span></div>
  </div>
  <div class="notes-src">
    <p>第四，它不是一套话术刷到底——对不同笔记说不同的话：刚冒头的抢前排、搜索老帖写深度解答、同城帖用本地口吻、求助帖给方案、大V帖补充干货。五种笔记，五种聊法。</p>
  </div>
</section>

<!-- 06 第五 · 看人下菜 -->
<section class="scene" data-name="第五 · 看人下菜">
  <div class="kicker anim">第五 · 看人下菜</div>
  <div class="inner" style="gap:20px">
    <div class="a-fade" style="--d:.1s;font-size:50px;font-weight:900">见什么人，说什么话</div>
    <div class="a-fade" style="--d:.4s;font-size:25px;color:var(--gray);letter-spacing:.1em">12 类买前心理，一眼认出</div>
    <div class="a-fade" style="--d:.55s;font-size:29px;color:var(--dim);line-height:1.5;width:940px;text-align:center">问价 · 冲动 · 求测评 · 被坑 · 求助 · 好辩<br>拖延 · 观望 · 高价值 · 货比三家 · 想学 · 沉默</div>
    <div class="a-fade" style="--d:1.0s;font-size:25px;color:var(--gray);letter-spacing:.1em">12 种聊法，挑最对味的上去</div>
    <div class="a-fade" style="--d:1.15s;font-size:29px;color:var(--dim);line-height:1.5;width:940px;text-align:center">教程 · 避坑 · 对比 · 数据 · 反驳 · 补充<br>共情 · 共鸣 · 热点 · 金句 · 提问 · 自嘲</div>
    <div class="a-fade" style="--d:1.6s;font-size:28px;color:var(--gray)">有的纯捧场、不带货也照发</div>
    <div class="a-zoom" style="--d:1.9s;--t:.8s"><span class="sheen impact" style="font-size:74px">不刷屏，不招黑</span></div>
  </div>
  <div class="notes-src">
    <p>第五，它见什么人说什么话。评论区里什么人都有：问价的、纠结的、被坑过的、货比三家的，十二种买前心理，它一眼认出是哪一种；再从十二种聊法里挑最对味的上去——要教程给教程，要共情给共情，有的纯捧场、不带货也照发。不刷屏，不招黑。</p>
  </div>
</section>

<!-- 07 第六 · 管到成交 -->
<section class="scene" data-name="第六 · 管到成交">
  <div class="kicker anim">第六 · 管到成交</div>
  <div class="inner" style="gap:26px">
    <div class="a-fade" style="--d:.1s;font-size:50px;font-weight:900">捞到的人，不漏</div>
    <div class="a-fade" style="--d:.4s;display:flex;align-items:stretch;gap:8px;width:940px">
      <div style="''' + BOX + '''"><b style="''' + BX_B + '''">客户名单</b><span style="''' + BX_S + '''">捞到就进名单</span></div>
      <div style="''' + ARW + '''">→</div>
      <div style="''' + BOX + '''"><b style="''' + BX_B + '''">AI 拟私信</b><span style="''' + BX_S + '''">您点头才发</span></div>
      <div style="''' + ARW + '''">→</div>
      <div style="''' + BOX + '''"><b style="''' + BX_B + '''">谈成与否</b><span style="''' + BX_S + '''">打开就看得见</span></div>
    </div>
    <div class="a-zoom" style="--d:1.1s;--t:.85s"><span class="sheen impact" style="font-size:78px">别人管发评论<br>这套管到成交</span></div>
  </div>
  <div class="notes-src">
    <p>第六，捞到的人不漏。进客户名单，AI 按对方的情况拟好私信——您点头才发；谈成没谈成，打开就看得见。别人管发评论，这套管到成交。</p>
  </div>
</section>

<!-- 08 第七 · 号在您自己手里 -->
<section class="scene" data-name="第七 · 号在您自己手里">
  <div class="kicker anim">第七 · 号在您自己手里</div>
  <div class="inner" style="gap:28px">
    <div class="a-fade" style="--d:.1s;font-size:50px;font-weight:900">东西装在您自己的浏览器里</div>
    <div class="cmp" style="gap:24px">
      <div class="cmp-item a-fade" style="--d:.5s;font-size:38px"><span class="mark no sm a-stamp" style="--d:.8s;--t:.5s">×</span><span class="dim">代运营</span><span style="font-size:28px;font-weight:400;color:var(--gray)">一个月几千，号在别人手里</span></div>
      <div class="cmp-item a-fade" style="--d:.7s;font-size:38px"><span class="mark yes sm a-stamp" style="--d:1.0s;--t:.5s">✓</span><span class="gold">这套系统</span><span style="font-size:28px;font-weight:400;color:var(--dim)">数据只存本机，客户名单是您的</span></div>
    </div>
    <div class="a-zoom" style="--d:1.4s;--t:.85s"><span class="sheen impact" style="font-size:100px">一个月 239 起</span></div>
    <div class="a-fade" style="--d:1.9s;font-size:28px;color:var(--gray)">239 / 399 / 539 每月 · 按月付费</div>
  </div>
  <div class="notes-src">
    <p>第七，东西全装在您自己的浏览器里，跟您的账号走：数据只存本机，客户名单也是您的。一个月 239 起——代运营一个月几千，号还在别人手里。</p>
  </div>
</section>

<!-- 09 第八 · 全自动 -->
<section class="scene" data-name="第八 · 全自动">
  <div class="kicker anim">第八 · 全自动</div>
  <div class="inner" style="gap:22px">
    <div style="display:flex;gap:20px">
      <span class="chip anim" style="--d:.1s;font-size:28px;padding:14px 30px">找商机</span>
      <span class="chip anim" style="--d:.25s;font-size:28px;padding:14px 30px">写评论</span>
      <span class="chip anim" style="--d:.4s;font-size:28px;padding:14px 30px">发私信</span>
    </div>
    <div class="a-zoom" style="--d:.7s;--t:.8s">
      <div class="num" data-count="30" data-suf=" 分钟" data-delay="800" data-dur="1400" style="font-size:220px">0</div>
    </div>
    <div class="numlab a-fade" style="--d:1.2s">您每天只要花这么多时间</div>
    <div class="a-zoom" style="--d:1.7s;--t:.8s"><span class="sheen impact" style="font-size:80px">其余，它自己跑</span></div>
  </div>
  <div class="notes-src">
    <p>第八，全自动：找商机、写评论、发私信，它自己跑。您每天只要三十分钟，点两下鼠标。</p>
  </div>
</section>

<!-- 10 压轴 · 我先给自己做的 -->
<section class="scene" data-name="压轴 · 我先给自己做的">
  <div class="kicker anim">这套系统 · 我先给自己做的</div>
  <div class="inner" style="gap:24px">
    <div class="a-zoom" style="--d:.1s;--t:.7s;position:relative">
      <div class="num" data-count="1000" data-suf="+" data-delay="600" data-dur="1500">0</div>
      <div class="sparks">
        <span class="spark" style="--tx:-400px;--ty:-140px;--d:1.2s"></span>
        <span class="spark" style="--tx:-260px;--ty:-280px;--d:1.3s"></span>
        <span class="spark" style="--tx:280px;--ty:-280px;--d:1.35s"></span>
        <span class="spark" style="--tx:410px;--ty:-130px;--d:1.25s"></span>
        <span class="spark" style="--tx:-360px;--ty:70px;--d:1.4s"></span>
        <span class="spark" style="--tx:370px;--ty:80px;--d:1.45s"></span>
      </div>
    </div>
    <div class="numlab a-fade" style="--d:.75s">15 天 · 承接真人用户</div>
    <div style="display:flex;gap:26px">
      <span class="chip anim" style="--d:1.0s">没投广告</span>
      <span class="chip anim" style="--d:1.15s">没买流量</span>
    </div>
    <div class="a-zoom" style="--d:1.5s;--t:.85s"><span class="sheen impact" style="font-size:72px">信不信不要紧，先看东西</span></div>
    <div class="tiny a-fade" style="--d:2.0s">个人实测数据 · 效果因人而异</div>
  </div>
  <div class="notes-src">
    <p>这套系统是我先给自己做的——没投广告、没买流量，15 天，1000 多个真人加进了我微信。</p>
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
    <p>拿不准？联系我免费做个测评——方向对不对，做一次就知道；不合适，不勉强。看主页简介，或者私信我。</p>
  </div>
</section>
'''


def main():
    src = SRC.read_text(encoding='utf-8').split('\n')
    i_first_scene = next(i for i, l in enumerate(src) if '<!-- 01' in l)
    i_host = next(i for i, l in enumerate(src) if l.startswith('<div id="hostwrap">'))
    head = '\n'.join(src[:i_first_scene]).rstrip('\n').replace(
        '<title>AI 雕兄 · 动效演示</title>', '<title>AI 雕兄 · 系统优势总结</title>')
    tail = '\n'.join(src[i_host:])
    DST.parent.mkdir(parents=True, exist_ok=True)
    DST.write_text(head + '\n\n' + SCENES.strip('\n') + '\n\n' + tail + '\n', encoding='utf-8')

    needs = scene_needs(DST)
    print('写出 %s（%.1f KB）' % (DST, DST.stat().st_size / 1024))
    print('%-32s %5s %9s %9s %9s' % ('幕', '字数', '预估说话', '需要动画', '幕间静默'))
    speech = gaps = 0.0
    for i, s in enumerate(needs, 1):
        dur = s['chars'] / RATE
        gap = max(GAP, s['need'] - dur) if i < len(needs) else 0.0
        speech += dur
        gaps += gap
        print('%2d %-29s %5d %8.1fs %8.1fs %8.2fs' % (i, s['name'], s['chars'], dur, s['need'], gap))
    print('合计 说话 %.1fs + 幕间 %.1fs + 头尾 2.2s ≈ %.1fs' % (speech, gaps, speech + gaps + 2.2))


if __name__ == '__main__':
    main()
