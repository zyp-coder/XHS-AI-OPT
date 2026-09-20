# -*- coding: utf-8 -*-
"""长版竖屏页 → 短版 45s 页：整份复用长版的 CSS / 舞台 / 人物 / 驱动脚本，只换 7 幕场景。

用法：python3 scripts/dev/gen_short_page.py
产出：资料/视频/AI雕兄口播稿/短版45s/AI雕兄-短版-竖屏.html

改词只改下面的 SCENES 再跑一次；每幕 <p> 是唯一真源（配音对齐 / 渲染分幕都读它）。
脚本顺带打印每幕字数与"动画需要的最短时间"，检查幕时长够不够。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from render_video import MAT
from use_my_voice import scene_needs, GAP

SRC = MAT / 'AI雕兄-动效演示-竖屏.html'
DST = MAT / '短版45s' / 'AI雕兄-短版-竖屏.html'
RATE = 5.9   # 字/秒，长版实测（961 字 / 162.8s 纯说话）

SCENES = '''
<!-- 01 两个问题 -->
<section class="scene" data-name="两个问题">
  <div class="kicker anim">小生意做线上</div>
  <div class="inner">
    <h1 class="a-zoom" style="--t:.9s;font-size:106px;font-weight:900;line-height:1.2"><span class="sheen">两个问题<br>没想明白</span></h1>
    <div style="width:560px;height:5px;background:var(--gold);border-radius:3px;transform-origin:center;transform:scaleX(0);animation:barGrow .7s cubic-bezier(.2,.8,.2,1) .4s forwards"></div>
    <div class="a-left qcard" style="--d:.7s">
      <span class="qno">①</span>
      <div><b>只盯视频号</b><i>丢了搜索种草的流量</i></div>
    </div>
    <div class="a-right qcard" style="--d:1.05s">
      <span class="qno">②</span>
      <div><b>跟着流量博主学打法</b><i>拿错了武器</i></div>
    </div>
  </div>
  <div class="notes-src">
    <p>小生意做线上，两个问题没想明白。</p>
  </div>
</section>

<!-- 02 问题一 -->
<section class="scene" data-name="问题一 · 只盯视频号">
  <div class="kicker anim">问题一 · 只盯视频号</div>
  <div class="inner" style="padding-bottom:560px;gap:34px">
    <div class="cols" style="gap:34px">
      <div class="panel a-left" style="--d:.2s">
        <div class="ptag">视频号</div>
        <div class="prow">
          <div class="mark no a-stamp" style="--d:.9s;--t:.6s">×</div>
          <div class="ptxt">
            <div class="pbig dim">陌生人在自卖自夸</div>
            <div class="psub big">有曝光，无信任</div>
          </div>
        </div>
      </div>
      <div class="panel a-right" style="--d:.4s">
        <div class="ptag gold">小红书</div>
        <div class="prow">
          <div class="mark yes a-stamp" style="--d:1.2s;--t:.6s">✓</div>
          <div class="ptxt">
            <div class="pbig">他主动搜、主动问</div>
            <div class="psub big gold">正在找答案的人，就在这儿</div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="bottom-line a-fade" style="--d:1.9s">你不去 ——<br>丢的是<span class="red">正在找答案的人</span></div>
  <div class="notes-src">
    <p>第一，只盯视频号，丢了搜索种草的流量——用户主动搜、主动问，你不去就没了。</p>
  </div>
</section>

<!-- 03 问题二 -->
<section class="scene" data-name="问题二 · 拿错了武器">
  <div class="kicker anim">问题二 · 跟着流量博主学打法</div>
  <div class="inner" style="padding-bottom:560px">
    <div class="cols" style="align-items:center">
      <div class="count-card a-left" style="--d:.2s">
        <div class="ctag">流量博主</div>
        <div class="cnum" data-count="9999" data-suf="+" data-delay="700" data-dur="1500">0</div>
        <div class="csub">要的是播放量</div>
      </div>
      <div class="neq a-zoom" style="--d:1.55s;--t:.6s"><div class="shk" style="--d:1.7s">≠</div></div>
      <div class="count-card a-right" style="--d:.45s">
        <div class="ctag gold">做生意的你</div>
        <div class="cnum red"><span class="living" style="--live:beat;--lt:2.2s;font-size:110px">要的是客户</span></div>
        <div class="csub">要的是成交</div>
      </div>
    </div>
  </div>
  <div class="bottom-line a-fade" style="--d:2.4s">不是你不行 ——<br>是你<span class="red">拿错了武器</span></div>
  <div class="notes-src">
    <p>第二，做了小红书，却跟着流量博主学打法：他要播放量，你要客户，是你拿错了武器。</p>
  </div>
</section>

<!-- 04 真正的获客 -->
<section class="scene" data-name="真正的获客">
  <div class="kicker anim">真正的获客</div>
  <div class="inner" style="gap:44px">
    <div class="a-fade" style="--d:.15s;font-size:58px;line-height:1.42">去他<span class="gold">已经在搜</span>、<span class="gold">已经在问</span><br>的地方</div>
    <div class="a-fade" style="--d:.55s;font-size:38px;color:var(--dim)">机会不在你的笔记里 —— 在别人的评论区</div>
    <div class="a-zoom" style="--d:.95s;--t:.85s"><span class="sheen impact" style="font-size:124px">接住他</span></div>
  </div>
  <div class="notes-src">
    <p>真正的获客，是去他已经在搜、已经在问的地方接住他。</p>
  </div>
</section>

<!-- 05 怎么接 · 四步 -->
<section class="scene" data-name="怎么接 · 四步接住他">
  <div class="kicker anim">怎么接</div>
  <div class="inner" style="padding-bottom:400px;gap:32px">
    <div class="a-zoom" style="--d:.15s;--t:.9s"><span class="sheen impact" style="font-size:94px">四步接住他</span></div>
    <div class="rows-sm">
      <div class="row a-left" style="--d:.6s"><span class="rn">1</span><div><b>找到有商机的笔记</b><i>有人在搜、有人在问的</i></div></div>
      <div class="row a-left" style="--d:.75s"><span class="rn">2</span><div><b>评论区回句实在的</b><i>专业回一句，把需求接住</i></div></div>
      <div class="row a-left" style="--d:.9s"><span class="rn">3</span><div><b>主页让人三秒判断你靠谱</b><i>先给信任，再谈成交</i></div></div>
      <div class="row a-left" style="--d:1.05s"><span class="rn">4</span><div><b>私信接住需求</b><i>接住他，别让他凉</i></div></div>
    </div>
  </div>
  <div class="notes-src">
    <p>怎么接？找到有商机的笔记，评论区回句实在的，主页让人三秒判断你靠谱，私信接住需求。</p>
  </div>
</section>

<!-- 06 我的结果 -->
<section class="scene" data-name="我的结果">
  <div class="kicker anim">我的结果 · 后台实拍</div>
  <div class="inner" style="gap:26px">
    <div style="display:flex;gap:26px">
      <span class="chip anim" style="--d:.55s">没投广告</span>
      <span class="chip anim" style="--d:.7s">没买流量</span>
    </div>
    <div class="a-zoom" style="--d:.95s;--t:.9s;position:relative">
      <div class="num" data-count="1000" data-suf="+" data-delay="1100" data-dur="1500">0</div>
      <div class="sparks">
        <span class="spark" style="--tx:-400px;--ty:-140px;--d:1.5s"></span>
        <span class="spark" style="--tx:-260px;--ty:-280px;--d:1.6s"></span>
        <span class="spark" style="--tx:280px;--ty:-280px;--d:1.65s"></span>
        <span class="spark" style="--tx:410px;--ty:-130px;--d:1.55s"></span>
        <span class="spark" style="--tx:-360px;--ty:70px;--d:1.7s"></span>
        <span class="spark" style="--tx:370px;--ty:80px;--d:1.75s"></span>
      </div>
    </div>
    <div class="numlab a-fade" style="--d:1.1s">15 天 · 真人加到产品 / 私域</div>
    <div class="a-fade" style="--d:1.6s;font-size:52px;font-weight:800">四步<span class="gold">推自己的产品</span></div>
    <div class="tiny a-fade" style="--d:2.2s">个人实测数据 · 效果因人而异</div>
  </div>
  <div class="notes-src">
    <p>我用这四步推自己的产品，没投广告、没买流量，15天承接1000多个真人。</p>
  </div>
</section>

<!-- 07 收尾 -->
<section class="scene" data-name="收尾">
  <div class="kicker anim">AI 雕兄</div>
  <div class="inner" style="gap:34px">
    <div class="brand a-fade" style="--d:.1s">前大厂码农 · 江湖散人</div>
    <div class="a-zoom" style="--d:.5s;--t:.9s;line-height:1.25"><span class="sheen impact" style="font-size:104px">9.9<br>先做个账号诊断</span></div>
    <div class="sub a-fade" style="--d:1.15s">方向对不对，诊断了才知道 · 不合适，不勉强</div>
    <div class="guide a-fade" style="--d:1.7s">看<b>主页简介</b> / <b>私信我</b></div>
    <div class="tiny a-fade" style="--d:2.2s">一顿外卖钱，换一套跑通的打法 · 效果因人而异</div>
  </div>
  <div class="notes-src">
    <p>想跑通这套，9.9做次账号诊断——前大厂码农，方向对不对，诊断了才知道。私信我。</p>
  </div>
</section>
'''


def main():
    src = SRC.read_text(encoding='utf-8').split('\n')
    i_first_scene = next(i for i, l in enumerate(src) if '<!-- 01' in l)
    i_host = next(i for i, l in enumerate(src) if l.startswith('<div id="hostwrap">'))
    head = '\n'.join(src[:i_first_scene]).rstrip('\n').replace(
        '<title>AI 雕兄 · 动效演示</title>', '<title>AI 雕兄 · 短版 45s</title>')
    tail = '\n'.join(src[i_host:])
    DST.parent.mkdir(parents=True, exist_ok=True)
    DST.write_text(head + '\n\n' + SCENES.strip('\n') + '\n\n' + tail + '\n', encoding='utf-8')

    needs = scene_needs(DST)
    print('写出 %s（%.1f KB）' % (DST, DST.stat().st_size / 1024))
    print('%-26s %5s %9s %9s %9s' % ('幕', '字数', '预估说话', '需要动画', '幕间静默'))
    speech = gaps = 0.0
    for i, s in enumerate(needs, 1):
        dur = s['chars'] / RATE
        gap = max(GAP, s['need'] - dur) if i < len(needs) else 0.0
        speech += dur
        gaps += gap
        print('%2d %-23s %5d %8.1fs %8.1fs %8.2fs' % (i, s['name'], s['chars'], dur, s['need'], gap))
    print('合计 说话 %.1fs + 幕间 %.1fs + 头尾 2.2s ≈ %.1fs' % (speech, gaps, speech + gaps + 2.2))


if __name__ == '__main__':
    main()
