/* 口播稿 → 分幕。新笔记从口播稿现生成，不复用上一支片子的分幕。
   规则口径是照着手写样片量出来的（每幕 ≤28 字、每行 ≤14 字、一句一行、幕名取首句、重点词挑末句或收口的 CTA）。
   离线版（Scenes.fromScript）不要网、不要 key，面板里点「生成分幕」用的就是它；
   扩展里接 AI 时用 Scenes.PROMPT 让它吐同样结构的 JSON，再过 Scenes.normalize 兜住格式。 */
(function (g) {
  const PUNC = '，。！？；：、—…';
  const TAIL = /[，。！？；：、—…"'）】]+$/;
  const LEAD = /^(?:(?:是|就|都|也|还|在|要|把|给|和|跟|又|才|只))+/;   // 虚词连着剥，但「不/没」留着（否定是信息）
  const CTA = /(私信我|联系我|评论区|主页|找我)/;
  const PUNCH = /(不|没|都|只|最|才|就|全)/;
  const MAX_LINE = 14;          // 一行最多这么多字；宽了也还有画布的自动断行兜底
  const MIN_SCENE = 14;         // 一幕至少这么多字（到句末才切）
  const MAX_SCENE = 32;         // 一幕最多这么多字，超了在最近的意群边界切
  const MERGE_LINE = 12;        // 两个短句合一行，合起来不超过这么多字

  const cn = s => [...s].length;
  const strip = s => s.replace(TAIL, '');
  const num = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  function cn2num(s) {                       // 十二 → 12、二十 → 20、三 → 3（够用就行，复杂的原样留着）
    const t = s.replace(/^一十/, '十');
    if (/^十[一二三四五六七八九]?$/.test(t)) return '1' + (num[t[1]] || 0);
    if (/^[二三四五六七八九]十[一二三四五六七八九]?$/.test(t)) return num[t[0]] + '' + (num[t[2]] || 0);
    if (/^[二三四五六七八九]十$/.test(t)) return num[t[0]] + '0';
    if (t.length === 1 && num[t]) return String(num[t]);
    return s;
  }

  const cut = (t, punc) => {                // 按给定标点切，标点留在前一段里
    const out = []; let cur = '';
    for (const ch of t) {
      cur += ch;
      if (punc.indexOf(ch) >= 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; }
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };
  const clauses = t => cut(t, PUNC);                    // 意群（顿号、逗号也断）
  const sentences = t => cut(t, '。！？…');              // 句子（只断句末）

  /* 一句一行；两个短句合一行；一句里再按意群装不下就断在标点上 */
  function linesOf(text) {
    const out = [];
    sentences(text).forEach(s => {
      const cs = clauses(s);
      if (!cs.length) return;
      if (cs.length === 1) {
        const one = cs[0];
        if (out.length && cn(out[out.length - 1]) <= 6 && cn(out[out.length - 1]) + cn(one) <= MERGE_LINE) {
          out[out.length - 1] += one;
        } else out.push(one);
        return;
      }
      let cur = '';
      cs.forEach(c => {
        if (cur && cn(cur) + cn(c) > MAX_LINE) { out.push(cur); cur = ''; }   // 标点也占宽，按实际字格算
        cur += c;
      });
      if (cur) out.push(cur);
    });
    return out.map(s => s.trim()).filter(Boolean);
  }

  /* 分幕：段落各成边界；一段太长就攒到句末切（≥14 字才切），攒不到硬顶 32 字 */
  function splitScenes(text) {
    const out = [];
    String(text).split(/\n+/).map(s => s.trim()).filter(Boolean).forEach(para => {
      if (cn(para) <= MAX_SCENE) { out.push(para); return; }
      let cur = '';
      clauses(para).forEach(c => {
        if (cur && cn(cur) + cn(c) > MAX_SCENE) { out.push(cur); cur = ''; }
        cur += c;
        if (/[。！？…]$/.test(c) && cn(cur) >= MIN_SCENE) { out.push(cur); cur = ''; }
      });
      if (cur) {
        if (out.length && cn(cur) < MIN_SCENE * .6) out[out.length - 1] += cur;   // 尾巴太短并进上一幕
        else out.push(cur);
      }
    });
    return out;
  }

  /* 「下一步 / 进一步 / 有一点 / 这一点」里的数词不是数量，别把这种句子当数字幕 */
  const NOT_COUNT = { 步: /[下上前后进同]/, 点: /[有差这那]/ };
  function countMatch(text) {
    const re = /(\d+|[一二两三四五六七八九十]+)\s*(种|步|招|条|套|类|式|点)/g;
    let m;
    while ((m = re.exec(text))) {
      const bad = NOT_COUNT[m[2]];
      if (bad && bad.test(text[m.index - 1] || '')) continue;
      return m;
    }
    return null;
  }

  function pickLayout(cs, i, n, text) {
    const bodies = cs.map(strip);
    if (i === n - 1) return 'center';                                    // 收口统一居中
    if (cs.some(c => /[：:]$/.test(c))) return 'list';                   // 冒号带出来的并列，就是列表幕
    if (bodies.length >= 3
        && bodies.filter(b => cn(b) <= 4).length >= 2
        && bodies.filter(b => cn(b) >= 10).length <= 1) return 'list';
    if (cn(text) <= 26 && countMatch(text)) return 'number';
    return cn(text) <= 18 ? 'center' : 'left';
  }

  function pickEm(cs, layout, text) {
    const m = text.match(CTA);
    if (m) return m[1];
    if (layout === 'list' || layout === 'number') return '';             // 列表/数字幕靠版式本身，不另标
    const last = strip(cs[cs.length - 1] || '').replace(LEAD, '');
    if (cn(last) >= 2 && cn(last) <= 7 && (cn(last) <= 4 || PUNCH.test(last))) return last;
    if (cn(last) <= 7) return '';
    const tail = last.slice(last.lastIndexOf('的') + 1);                 // 末句太长：优先「的」后面那个词
    if (cn(tail) >= 2 && cn(tail) <= 5) return tail;
    const t3 = last.slice(-3).replace(/^[的地得了着]/, '');                // 再不行取尾部三字，别把「的」带上屏
    return cn(t3) >= 2 ? t3 : '';
  }

  function packList(cs) {                                                 // 列表幕：一条一行，去掉尾巴标点
    return cs.filter(c => !/[：:]$/.test(c)).map(strip).filter(Boolean);
  }
  function packNumber(cs, text) {                                        // 数字幕：首行「12 种打法」，其余另起
    const m = countMatch(text);
    if (!m) return linesOf(text);
    const after = text.slice(m.index + m[0].length).replace(/^[\s，、]*/, '');
    const noun = (after.match(/^[^，。！？；：、\s]{1,3}/) || [''])[0];     // 量词后面跟的名词，如「打法」
    const head = (/\d/.test(m[1]) ? m[1] : cn2num(m[1])) + ' ' + m[2] + noun;
    const at = cs.findIndex(c => c.indexOf(m[0]) >= 0);
    const tail = cs.slice(at + 1).join('') || '';                        // 数字那句话本身不再上屏，避免和首行重复
    return [head].concat(linesOf(tail).map(strip).map(s => s.replace(LEAD, '')).filter(Boolean));
  }

  /* 这一幕的「调」：混剪那一路字弹出来那一下响什么音用它（坑→闷一下，好处→轻亮一下，平常→轻轻带）。
     AI 分幕时让它顺手标（PROMPT / SCRIPT_PROMPT 里带 tone），没标／没配 AI 就照下面的词表判。 */
  const TONE_LOW = /(坑|踩|亏|贵|慢|差|失望|翻车|麻烦|愁|累|头疼|闹心|糟心|返工|后悔|风险|出错|问题|漏水|开裂|返潮|脏|破|旧|难|卡住|卡壳|超支|白花钱|焦虑|别急|小心|注意)/;
  const TONE_HIGH = /(省|划算|便宜|快|干净|亮堂|舒心|舒服|满意|省心|翻倍|涨|新|值|好|赞|爆|多|免费|到手|拿下|搞定|一次过|好看|好用|提升|超出|没想到|惊喜|稳|轻松)/;
  function toneOf(text, emTxt) {
    const t = String(emTxt || text || '');
    if (TONE_LOW.test(t)) return 'low';
    if (TONE_HIGH.test(t)) return 'high';
    return 'flat';
  }
  const toneOk = v => (v === 'low' || v === 'high' || v === 'flat' ? v : '');

  function fromScript(text) {
    const scenes = splitScenes(text);
    return scenes.map((t, i) => {
      const cs = clauses(t);
      const layout = pickLayout(cs, i, scenes.length, t);
      const lines = layout === 'list' ? packList(cs)
        : layout === 'number' ? packNumber(cs, t)
        : linesOf(t);
      const emTxt = pickEm(cs, layout, t);
      const li = emTxt ? lines.findIndex(l => l.indexOf(emTxt) >= 0) : -1;
      return {
        label: String(i + 1).padStart(2, '0'),
        name: '',
        text: t,
        lines,
        em: li >= 0 ? [{ l: li, t: emTxt }] : [],
        layout,
        tone: toneOf(t, emTxt),
        estSec: Math.max(1.2, +(cn(t) / 4.5).toFixed(2)),   // 按 +20% 语速约 4.5 字/秒估的，出片时按真配音重算
      };
    });
  }

  /* 给 AI 的提示词：扩里接模型时用，让它吐同样结构的 JSON（多轮改分幕也走这个）
     2026-10-10 四条改版（①）：出片前先提重点——PICKS_PROMPT 标重点（与拆段出词同一口径），
     客户改完重点走 SCRIPT_PROMPT：按重点出「出片稿」＋同一个结构的分幕（background 侧
     genNoteFilmPicks / genNoteFilmScript 两发 action 按这两段口径发；离线版仍是 fromScript）。 */
  const PICKS_PROMPT = [
    '通读这篇口播稿，标出「要讲的点」——视频就围着它们讲。只输出 JSON，不要解释。',
    '结构：{"重点":[{"句":"稿子里的核心短句（≤16 字，原样摘字）","为什么":"一句白话，为什么它是重点"}]}',
    '规则：最多 5 个，按重要程度排；「句」从稿子里原样摘、别改写。',
  ].join('\n');

  const PROMPT = [
    '把这段口播稿切成幕，只输出 JSON，不要解释。',
    '结构：{"scenes":[{"label":"01","name":"两个字左右的幕名","text":"这一幕的口播原文（不改词）",'
      + '"lines":["屏幕上显示的一行"],"em":[{"l":0,"t":"重点词"}],"layout":"center","tone":"flat"}]}',
    '规则：每幕 14~28 字，台词原样保留；lines 是把这一幕拆成屏幕上的短行，每行不超过 14 字，'
      + '去掉口语虚词、保留信息；em 每幕最多一个重点词（l 是它在 lines 里的行号）；'
      + 'layout 从 center（一句话居中）/ left（长句左对齐）/ list（并列要点）/ number（数字幕）里选；'
      + 'tone 说这一幕的调：讲坑、讲麻烦、讲不好的 → low；讲好处、讲亮点 → high；平常一句 → flat；'
      + '最后一幕是收口，layout 用 center。',
  ].join('\n');

  const SCRIPT_PROMPT = [
    '按给定的重点，把这篇口播稿改成一版「出片稿」，再把它切成幕。只输出 JSON，不要解释。',
    '结构：{"出片稿":"按重点改好的整篇稿（重点留、水话合并、句子顺；不改人称、不加新信息）",'
      + '"scenes":[{"label":"01","name":"两个字左右的幕名","text":"这一幕的口播原文（从出片稿原样摘）",'
      + '"lines":["屏幕上显示的一行"],"em":[{"l":0,"t":"重点词"}],"layout":"center","tone":"flat"}]}',
    '规则：每幕 14~28 字，到句末才切；lines 每行不超过 14 字；em 每幕最多一个重点词（l 是它在 lines 里的行号）；',
    'layout 从 center / left / list / number 里选；tone 是这一幕的调（讲坑→low，讲好处→high，平常→flat）；最后一幕是收口，layout 用 center。',
  ].join('\n');

  function normalize(o) {                     // AI 返回的兜一下：字段缺、行超宽、em 找不到行
    const out = ((o && o.scenes) || []).map((s, i) => {
      const lines = (s.lines || []).map(x => String(x).trim()).filter(Boolean);
      const text = String(s.text || lines.join('') || '').trim();
      const em = (s.em || []).map(e => ({ l: Number(e.l) || 0, t: String(e.t || '').trim() }))
        .filter(e => e.t)
        .map(e => (lines[e.l] && lines[e.l].indexOf(e.t) >= 0 ? e
          : { l: lines.findIndex(l => l.indexOf(e.t) >= 0), t: e.t }))
        .filter(e => e.l >= 0)
        .slice(0, 1);
      const layout = ['center', 'left', 'list', 'number'].indexOf(s.layout) >= 0 ? s.layout : 'center';
      return {
        label: String(s.label || i + 1).padStart(2, '0'),
        name: String(s.name || lines[0] || '').slice(0, 6),
        text, lines: lines.length ? lines : [text], em, layout,
        tone: toneOk(s.tone) || toneOf(text, em[0] && em[0].t),
        estSec: Math.max(1.2, +(cn(text) / 4.5).toFixed(2)),
      };
    });
    return out;
  }

  g.Scenes = { fromScript, normalize, toneOf, PROMPT, PICKS_PROMPT, SCRIPT_PROMPT, toJSON: list => ({
    scenes: list.map(({ label, name, text, lines, em, layout, tone }) => ({
      label, name: name || '', text: (text || lines.join('')).trim(), lines, em, layout, tone: tone || 'flat',
    })),
  }) };
})(window);
