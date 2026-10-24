/* 音色清单：面板和扩展共用这一份。
   n（中文短名）同时是样音文件名（样音/<n>.m4a）和成片配音文件名（配音-<稿子>-<n>.m4a）的一部分，
   scripts/dev/render_style_film.py 里有一份同样的映射，改这里要同步改那边。
   字效编辑器「③ 音色」按 d（听感）与 use（适合）铺成一张表：选哪条看这两列，rec 标默认那条。 */
window.VOICES = {
  list: [
    { v: 'zh-CN-XiaoxiaoNeural', n: '晓晓', d: '女声 · 温和自然', use: '讲干货、知识口播；最不挑稿子', rec: true },
    { v: 'zh-CN-XiaoyiNeural',   n: '晓伊', d: '女声 · 年轻',     use: '种草、日常分享；软一点' },
    { v: 'zh-CN-YunxiNeural',    n: '云希', d: '男声 · 年轻',     use: '聊经验、教程；像真人朋友' },
    { v: 'zh-CN-YunyangNeural',  n: '云扬', d: '男声 · 播报腔',   use: '正式说明、品牌向；稳' },
    { v: 'zh-CN-YunjianNeural',  n: '云健', d: '男声 · 有力',     use: '强观点、催行动；有劲' },
  ],
  short: v => (window.VOICES.list.find(o => o.v === v) || {}).n || v,
  sample: n => '样音/' + n + '.m4a',
};
