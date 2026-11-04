/* 音色清单：面板和扩展共用这一份。
   n（中文短名）同时是样音文件名（样音/<n>.m4a）和成片配音文件名（配音-<稿子>-<n>.m4a）的一部分，
   scripts/dev/render_style_film.py 里有一份同样的映射，改这里要同步改那边。
   字效编辑器「③ 音色」按 d（听感）与 use（适合）铺成一张表：选哪条看这两列，rec 标默认那条。

   k 标这声音在哪儿合成：
     doubao ＝ 豆包 2.0（服务器合成，按字数扣额度，客户浏览器拿不到凭据）；
     edge   ＝ 微软免费那条（客户机自己念，不扣字数，要 Edge 浏览器）。
   豆包念不成（没配凭据 / 额度用完 / 网络）时，出片会自动换回免费那条，不卡住。 */
window.VOICES = {
  list: [
    { v: 'zh_male_liufei_uranus_bigtts',        n: '刘飞 2.0',     k: 'doubao', d: '男声 · 新闻播报，字正腔圆', use: '知识、干货、正式讲解', rec: true },
    { v: 'zh_male_jieshuoxiaoming_uranus_bigtts', n: '解说小明 2.0', k: 'doubao', d: '男声 · 专题片旁白', use: '教程、案例、知识解说' },
    { v: 'zh_male_ruyaqingnian_uranus_bigtts',  n: '儒雅青年 2.0', k: 'doubao', d: '男声 · 沉稳、有质感', use: '知识、干货、长文讲读' },
    { v: 'zh_female_zhixingnv_uranus_bigtts',   n: '知性女声 2.0', k: 'doubao', d: '女声 · 清楚、专业不冷', use: '知识、教程、职场' },
    { v: 'zh_male_kailangdidi_uranus_bigtts',   n: '开朗弟弟 2.0', k: 'doubao', d: '男声 · 轻快、像朋友聊', use: '日常、种草、轻松向' },
    { v: 'zh_female_wenrouxiaoya_uranus_bigtts', n: '温柔小雅 2.0', k: 'doubao', d: '女声 · 柔和、慢一点', use: '情感、生活、治愈' },
    { v: 'zh-CN-XiaoxiaoNeural', n: '晓晓', k: 'edge', d: '女声 · 温和自然 · 免费', use: '讲干货、知识口播；最不挑稿子', free: true },
    { v: 'zh-CN-XiaoyiNeural',   n: '晓伊', k: 'edge', d: '女声 · 年轻 · 免费',     use: '种草、日常分享；软一点', free: true },
    { v: 'zh-CN-YunxiNeural',    n: '云希', k: 'edge', d: '男声 · 年轻 · 免费',     use: '聊经验、教程；像真人朋友', free: true },
    { v: 'zh-CN-YunyangNeural',  n: '云扬', k: 'edge', d: '男声 · 播报腔 · 免费',   use: '正式说明、品牌向；稳', free: true },
    { v: 'zh-CN-YunjianNeural',  n: '云健', k: 'edge', d: '男声 · 有力 · 免费',     use: '强观点、催行动；有劲', free: true },
  ],
  short: v => (window.VOICES.list.find(o => o.v === v) || {}).n || v,
  providerOf: v => (window.VOICES.list.find(o => o.v === v) || {}).k || 'edge',
  sample: n => '样音/' + n + '.m4a',
};
