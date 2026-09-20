# -*- coding: utf-8 -*-
"""形象放大 + 名牌 + 说明性小字专业化：一次性改写两个方向的 HTML

用法：
    python scripts/dev/host_v2.py           # 预演，只报告
    python scripts/dev/host_v2.py --apply   # 真正写入
"""
import re, sys, pathlib

BASE = pathlib.Path(r'd:\AIproject\小红书运营\资料\视频\AI雕兄口播稿')
FILES = [BASE / 'AI雕兄-动效演示-竖屏.html', BASE / 'AI雕兄-动效演示.html']

# 只改屏幕上显示的说明性小字；大标题金句、notes 讲稿不动
COPY = [
    ('凌晨还在发笔记 · 三个月过去', '一个人做小红书 · 坚持更新三个月'),
    ('>瞎使劲<', '>没有章法<'),
    ('<b>只盯视频号</b>', '<b>只做视频号</b>'),
    ('<i>丢了陌生人搜索种草的流量</i>', '<i>错失主动搜索的精准客群</i>'),
    ('<b>跟着流量博主刷笔记</b>', '<b>照搬流量博主打法</b>'),
    ('<i>在等流量</i>', '<i>被动等待流量</i>'),
    ('>陌生人自卖自夸<', '>陌生人自述，缺乏信任基础<'),
    ('>有曝光，没信任<', '>有曝光 · 无信任<'),
    ('>陌生人讲经验、讲感受<', '>陌生人分享真实经验<'),
    ('>主动在搜的人，反而更信真话<', '>主动搜索的用户，更信任真实经验<'),
    ('丢的是<span class="red">正在找答案的人</span>', '错失的是<span class="red">正在主动搜索的客群</span>'),
    ('>要的是流量<', '>目标是流量<'),
    ('>要的是客户<', '>目标是成交客户<'),
    ('>去他已经在搜、已经在问的地方<', '>去用户已经在搜、已经在问的地方<'),
    ('<i>找有商机的笔记，主动接人</i>', '<i>找有商机的笔记，主动承接需求</i>'),
    ('<i>让人一眼看出你专业、靠得住</i>', '<i>让人一眼看出专业与可信<'),
    ('<i>把人接住，不漏</i>', '<i>及时承接，不漏线索</i>'),
    ('>前大厂码农<', '>前大厂研发<'),
    ('>没投广告<', '>未投放广告<'),
    ('>没买流量<', '>未购买流量<'),
    ('15 天 · 承接真人到我产品 / 私域', '15 天 · 承接真实用户到产品 / 私域'),
    ('>个人测试，效果因账号、品类、执行而异<', '>个人实测数据，效果因账号、品类、执行而异<'),
    ('>没有关键词入口，天然流量起不来<', '>缺乏关键词入口，自然流量无法起量<'),
    ('>用户不信硬广<', '>用户不信任硬广<'),
    ('>信评论区里，像真人的那一句<', '>信任评论区里真实的那一句<'),
    ('专业回一句 · 真诚答一句', '专业回应 · 真诚解答'),
    ('他点开你主页', '用户主动点开主页'),
    ('>捞到人了 ✓<', '>已捞到人 ✓<'),
    ('平台只允许你说一句：', '平台只允许一种引导：'),
    ('>小红书不是他的核心聊天软件<', '>小红书不是他的核心沟通工具<'),
    ('>累死也跑不通<', '>投入不可控 · 无法复制<'),
    ('哪条内容在带人、哪个动作有效 —— 心里得有数', '哪条内容在带人、哪个动作有效 —— 要有数据支撑'),
    ('纯内容获客 · 15 天承接 1000+ 真人 · 效果因人而异', '纯内容获客 · 15 天承接 1000+ 真实用户 · 效果因人而异'),
    ('问题二 · 跟着流量博主刷笔记等流量', '问题二 · 照搬流量博主，被动等流量'),
    ('先说一下我是怎么做的', '先说一下我的做法'),
    ('>我从哪来<', '>我的起点<'),
    ('>找一个客户会主动搜、主动问的地方<', '>找到客户主动搜索、主动提问的地方<'),
    ('两套打法，别混用', '两套打法，不要混用'),
    ('>更现实的是<', '>更现实的问题<'),
]

HOST_MOTES = """<span class="h-mote" style="left:5%%;top:48%%;--mx:-22px;--ld:.2s;--lt:7.8s"></span>
<span class="h-mote" style="left:13%%;top:72%%;--mx:26px;--ld:2.4s;--lt:8.4s"></span>
<span class="h-mote" style="left:25%%;top:90%%;--mx:-18px;--ld:4.6s;--lt:7.2s"></span>
<span class="h-mote" style="left:41%%;top:97%%;--mx:22px;--ld:1.2s;--lt:8.8s"></span>
<span class="h-mote" style="left:58%%;top:99%%;--mx:-28px;--ld:3.2s;--lt:7.6s"></span>
<span class="h-mote" style="left:74%%;top:88%%;--mx:18px;--ld:5.4s;--lt:8.2s"></span>
<span class="h-mote" style="left:88%%;top:70%%;--mx:-24px;--ld:2.8s;--lt:7.4s"></span>
<span class="h-mote" style="left:96%%;top:52%%;--mx:20px;--ld:6.2s;--lt:8.6s"></span>
<span class="h-mote" style="left:66%%;top:77%%;--mx:-16px;--ld:4.0s;--lt:9.2s"></span>
<span class="h-mote" style="left:34%%;top:79%%;--mx:24px;--ld:7.0s;--lt:8.0s"></span>""" % ()

HOST_TMPL = """<div id="hostwrap">
<div id="host">
<span class="h-spot"></span><span class="h-glow"></span><span class="h-floor"></span>
<div class="h-fig"><img alt="" src="%(src)s"></div>
%(motes)s
</div>
<div id="nameplate"><span class="np-role">AI 运营教练</span><span class="np-name">AI杨小过</span></div>
</div>"""

HOST_RE = re.compile(r'<div id="host"><img alt="" src="(data:image/webp;base64,[A-Za-z0-9+/=]+)"></div>')


def main(apply):
    for path in FILES:
        text = path.read_text(encoding='utf-8')
        log = []

        for old, new in COPY:
            n = text.count(old)
            log.append((n, old, new))
            if n:
                text = text.replace(old, new)

        m = HOST_RE.search(text)
        host_n = 1 if m else 0
        if m:
            text = HOST_RE.sub(lambda mm: HOST_TMPL % {'src': mm.group(1), 'motes': HOST_MOTES}, text, count=1)

        print('===', path.name)
        bad = [x for x in log if x[0] != 1]
        for n, old, new in log:
            flag = '   ' if n == 1 else ('!! ' if n == 0 else '** ')
            if n != 1:
                print('%s%dx  %s  ->  %s' % (flag, n, old, new))
        print('    文案替换 %d/%d 条唯一命中；形象块 %d 处' % (len(COPY) - len(bad), len(COPY), host_n))
        if apply:
            path.write_text(text, encoding='utf-8')
            print('    -> 已写入 %d KB' % (path.stat().st_size // 1024))


if __name__ == '__main__':
    main('--apply' in sys.argv)
