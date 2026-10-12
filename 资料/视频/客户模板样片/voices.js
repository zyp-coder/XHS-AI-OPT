/* 音色清单：面板和扩展共用这一份。
   n（中文短名）同时是样音文件名（样音/<n>.m4a）和成片配音文件名（配音-<稿子>-<n>.m4a）的一部分，
   scripts/dev/render_style_film.py 里有一份同样的映射，改这里要同步改那边。 */
window.VOICES = {
  list: [
    { v: 'zh-CN-XiaoxiaoNeural', n: '晓晓', d: '女声 · 温和自然' },
    { v: 'zh-CN-XiaoyiNeural',   n: '晓伊', d: '女声 · 年轻' },
    { v: 'zh-CN-YunxiNeural',    n: '云希', d: '男声 · 年轻' },
    { v: 'zh-CN-YunyangNeural',  n: '云扬', d: '男声 · 播报腔' },
    { v: 'zh-CN-YunjianNeural',  n: '云健', d: '男声 · 有力' },
  ],
  short: v => (window.VOICES.list.find(o => o.v === v) || {}).n || v,
  sample: n => '样音/' + n + '.m4a',
};
