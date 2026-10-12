/* styles.js — 竖屏样片 canvas 渲染器（B2 方案：帧精确、纯代码绘制）
 *
 * 设计约束（与现有口播片一致）：
 *   · 一屏一句话，逐行入场；整屏内容都是 t 的纯函数 → 任意帧可重绘
 *   · 版式只有三个槽位：左上编号 / 主文案块 / 页脚小字（品牌 + 合规）
 *   · 风格不是写死的几套，而是「一组配置项」组装出来的：底色/主色/字体/质感/编号/节奏…
 *
 * 用法：
 *   Renderer.renderFrame(ctx, t, timeline, 'orange')                      // 预设键
 *   Renderer.renderFrame(ctx, t, timeline, Renderer.buildStyle(cfg))      // 自定义配置
 *   cfg 字段见 Renderer.FIELDS；调风格.html 就是这套配置的可视化旋钮
 *   timeline = { head, tail, dur, scenes:[{label, name, start, end, lines[], em[{l,t}], cta}] }
 */
(function (global) {
  'use strict';

  const W = 1080, H = 1920;
  const M = 108;                 // 左右安全边
  const SAFE = W - M * 2;        // 可排宽度
  const CY = 928;                // 主文案块视觉中心
  const CY_HEAD = 900;           // 片头品牌中心

  // 首选项是随包分发的内置字体（fonts.js 注册，OFL）；后面几个是系统回退，只在缺字时兜底
  const SANS = '"Noto Sans SC","HarmonyOS Sans SC","Microsoft YaHei","PingFang SC",sans-serif';
  const SERIF = '"Noto Serif SC","Source Han Serif SC","SimSun",serif';
  const KAI = '"KaiTi","STKaiti","Noto Serif SC",serif';
  const MONO = 'Consolas,"Noto Sans SC",monospace';

  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const eoc = p => 1 - Math.pow(1 - p, 3);
  const seg = (t, a, d) => clamp01((t - a) / d);
  const hexA = (hex, a) => {
    const h = String(hex).replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  };

  /* ---------------- 配置项字典（调风格面板按这份表自动生成旋钮） ---------------- */
  const BGS = {
    dark:  { l: '深黑', c: '#0F0F13', text: '#FFFFFF', sub: 'rgba(255,255,255,.44)', deep: true },
    navy:  { l: '藏蓝', c: '#0B1220', text: '#F1F5F9', sub: 'rgba(241,245,249,.45)', deep: true },
    paper: { l: '米白', c: '#F7F2E9', text: '#221F1A', sub: 'rgba(34,31,26,.44)', deep: false },
    light: { l: '浅灰', c: '#F3F5F8', text: '#0F1720', sub: 'rgba(15,23,32,.44)', deep: false },
  };
  const ACCENTS = [['#F97316', '品牌橙'], ['#D4AF37', '鎏金'], ['#B5542F', '砖红'],
    ['#2563EB', '科技蓝'], ['#14B8A6', '青绿'], ['#8B5CF6', '紫']];
  const FONTS = {
    sans:  { l: '黑体', head: SANS, weight: '700', labelFont: MONO, size: 96, labelSize: 28 },
    serif: { l: '宋体', head: SERIF, weight: '600', labelFont: SERIF, size: 92, labelSize: 30 },
    kai:   { l: '楷体', head: KAI, weight: '400', labelFont: SANS, size: 94, labelSize: 28 },
  };
  const WEIGHTS = { regular: '400', medium: '600', bold: '700' };
  const SIZE_K = { s: .86, m: 1, l: 1.12 };
  const LEADING = { tight: 1.52, normal: 1.62, loose: 1.76 };
  const ENTER = {
    slow:   { dy: 32, dx: 0,   dur: .80, stagger: .18 },
    normal: { dy: 36, dx: 0,   dur: .55, stagger: .13 },
    snappy: { dy: 10, dx: -46, dur: .40, stagger: .09 },
  };

  const DEFAULT_CFG = {
    bg: 'dark', accent: '#F97316', font: 'sans', weight: 'bold', size: 'm', leading: 'normal',
    em: 'tint', texture: 'none', glow: 'on', label: 'bar', pace: 'normal', foot: 'on',
    brand: 'AI杨小过',
    // 音色不参与画面渲染，但跟着同一条配置行走：出片时按它配音、并把分幕时间轴按这条音色重算
    voice: 'zh-CN-XiaoxiaoNeural',
  };

  const FIELDS = [
    { k: 'bg', t: '底色', type: 'chip', shape: 'box',
      opts: Object.keys(BGS).map(k => ({ v: k, l: BGS[k].l, c: BGS[k].c })) },
    { k: 'accent', t: '主色', type: 'chip', shape: 'dot',
      opts: ACCENTS.map(a => ({ v: a[0], l: a[1] })) },
    { k: 'font', t: '字体', type: 'seg', opts: Object.keys(FONTS).map(k => ({ v: k, l: FONTS[k].l })) },
    { k: 'weight', t: '字重', type: 'seg', opts: [{ v: 'regular', l: '常规' }, { v: 'medium', l: '中粗' }, { v: 'bold', l: '加粗' }] },
    { k: 'size', t: '字号', type: 'seg', opts: [{ v: 's', l: '小' }, { v: 'm', l: '中' }, { v: 'l', l: '大' }] },
    { k: 'leading', t: '行距', type: 'seg', opts: [{ v: 'tight', l: '紧' }, { v: 'normal', l: '中' }, { v: 'loose', l: '松' }] },
    { k: 'em', t: '重点词', type: 'seg', opts: [{ v: 'tint', l: '变色' }, { v: 'swipe', l: '记号笔' }] },
    { k: 'texture', t: '质感', type: 'seg', opts: [{ v: 'none', l: '纯净' }, { v: 'paper', l: '纸纹' }, { v: 'grid', l: '网格' }] },
    { k: 'glow', t: '光晕', type: 'seg', opts: [{ v: 'on', l: '开' }, { v: 'off', l: '关' }] },
    { k: 'label', t: '编号', type: 'seg', opts: [{ v: 'none', l: '不显示' }, { v: 'bar', l: '短横' }, { v: 'hair', l: '细线' }, { v: 'rule', l: '长线' }, { v: 'tag', l: '描边框' }] },
    { k: 'pace', t: '节奏', type: 'seg', opts: [{ v: 'slow', l: '稳' }, { v: 'normal', l: '适中' }, { v: 'snappy', l: '利落' }] },
    { k: 'brand', t: '品牌名', type: 'text' },
  ];

  /* 四套预设（= 四组配置值，面板上点一下就把旋钮拨到这套） */
  const PRESETS = {
    orange: { name: 'A · 深色品牌橙', cfg: { bg: 'dark', accent: '#F97316', font: 'sans', weight: 'bold', size: 'm', leading: 'tight', em: 'tint', texture: 'none', glow: 'on', label: 'bar', pace: 'normal', foot: 'on' } },
    gold:   { name: 'B · 深色鎏金', cfg: { bg: 'dark', accent: '#D4AF37', font: 'serif', weight: 'medium', size: 'm', leading: 'loose', em: 'tint', texture: 'none', glow: 'on', label: 'hair', pace: 'slow', foot: 'on' } },
    paper:  { name: 'C · 米白纸感', cfg: { bg: 'paper', accent: '#B5542F', font: 'serif', weight: 'medium', size: 'm', leading: 'normal', em: 'swipe', texture: 'paper', glow: 'on', label: 'tag', pace: 'normal', foot: 'on' } },
    tech:   { name: 'D · 浅灰科技', cfg: { bg: 'light', accent: '#2563EB', font: 'sans', weight: 'medium', size: 'm', leading: 'tight', em: 'tint', texture: 'grid', glow: 'on', label: 'rule', pace: 'snappy', foot: 'on' } },
  };

  /* ---------------- 配置 → 风格对象 ---------------- */
  function buildStyle(c) {
    c = Object.assign({}, DEFAULT_CFG, c || {});
    const B = BGS[c.bg] || BGS.dark;
    const F = FONTS[c.font] || FONTS.sans;
    const deep = B.deep;
    const A = /^#[0-9a-f]{3,8}$/i.test(c.accent || '') ? c.accent : DEFAULT_CFG.accent;
    const glows = c.glow === 'off' ? [] : (deep
      ? [{ c: hexA(A, .15), r: 760, x: .82, y: .14, ax: .06, ay: .04, p: 13 },
         { c: hexA(A, .07), r: 620, x: .16, y: .88, ax: .05, ay: .05, p: 17 }]
      : [{ c: hexA(A, .16), r: 900, x: .5, y: .5, ax: .08, ay: .05, p: 21 }]);
    const size = F.size * (SIZE_K[c.size] || 1);
    return {
      name: '自定义',
      bg: B.c, glows, deep,
      texture: c.texture === 'none' ? null : c.texture,
      text: B.text, sub: B.sub,
      accent: A,
      emMode: c.em === 'swipe' ? 'swipe' : 'tint',
      swipe: hexA(A, deep ? .24 : .17),
      headFont: F.head,
      headWeight: (c.weight && WEIGHTS[c.weight]) || F.weight,
      labelFont: F.labelFont, labelSize: F.labelSize,
      labelSpacing: F.labelFont === SERIF ? 10 : (c.label === 'rule' ? 2 : 6),
      labelStyle: c.label || 'none',
      enter: ENTER[c.pace] || ENTER.normal,
      maxFont: Math.round(size), minFont: Math.round(size * .64),
      lineHeight: LEADING[c.leading] || LEADING.normal,
      progress: !deep,
      brand: (c.brand && String(c.brand).trim()) || 'AI杨小过',
      foot: c.foot !== 'off',
    };
  }

  const STYLES = {};
  for (const k in PRESETS) { STYLES[k] = buildStyle(PRESETS[k].cfg); STYLES[k].name = PRESETS[k].name; }

  const BRAND = { name: 'AI杨小过', sub: '小红书获客系统' };
  const FOOT = '效果因人而异';

  const cfgLine = c => FIELDS.map(f => f.k + '=' + (c[f.k] === undefined ? DEFAULT_CFG[f.k] : c[f.k])).join('; ')
    + '; voice=' + (c.voice || DEFAULT_CFG.voice);
  const parseCfg = s => {
    const o = {};
    String(s).split(';').forEach(p => {
      const i = p.indexOf('=');
      if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim();
    });
    return Object.assign({}, DEFAULT_CFG, o);
  };

  /* ---------------- 纹理（一次性预渲染成离屏画布，按深浅各存一张） ---------------- */
  const textures = {};
  function noiseCanvas(deep) {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    let s = 20260921;
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 2600; i++) {
      c.fillStyle = deep
        ? 'rgba(255,246,230,' + (0.012 + rnd() * 0.016).toFixed(3) + ')'
        : 'rgba(120,100,70,' + (0.010 + rnd() * 0.014).toFixed(3) + ')';
      c.fillRect(rnd() * W, rnd() * H, 1, 1);
    }
    return cv;
  }
  function gridCanvas(deep) {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    c.strokeStyle = deep ? 'rgba(255,255,255,.05)' : 'rgba(15,23,32,.055)';
    c.lineWidth = 1;
    for (let x = 0; x <= W; x += 108) { c.beginPath(); c.moveTo(x + .5, 0); c.lineTo(x + .5, H); c.stroke(); }
    for (let y = 0; y <= H; y += 108) { c.beginPath(); c.moveTo(0, y + .5); c.lineTo(W, y + .5); c.stroke(); }
    return cv;
  }

  /* ---------------- 基础绘制 ---------------- */
  function drawGlows(ctx, t, S) {
    for (const g of S.glows) {
      const x = W * g.x + Math.sin(t / g.p * Math.PI * 2) * W * g.ax;
      const y = H * g.y + Math.cos(t / g.p * Math.PI * 2 * .8) * H * g.ay;
      const rg = ctx.createRadialGradient(x, y, 0, x, y, g.r);
      rg.addColorStop(0, g.c);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawTexture(ctx, S) {
    if (!S.texture) return;
    const key = S.texture + (S.deep ? '-d' : '-l');
    if (!textures[key]) textures[key] = S.texture === 'paper' ? noiseCanvas(S.deep) : gridCanvas(S.deep);
    ctx.drawImage(textures[key], 0, 0);
  }

  function setFont(ctx, weight, size, family, spacing) {
    ctx.font = weight + ' ' + size + 'px ' + family;
    try { ctx.letterSpacing = (spacing || 0) + 'px'; } catch (e) { /* 旧内核不支持就算了 */ }
  }

  /** 主文案每行字号：从 maxFont 往下试，取能塞进安全宽度的最大号 */
  function fitFont(ctx, lines, S) {
    for (let f = S.maxFont; f >= S.minFont; f -= 2) {
      setFont(ctx, S.headWeight, f, S.headFont, 0);
      let w = 0;
      for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
      if (w <= SAFE) return f;
    }
    return S.minFont;
  }

  const PUNCT = '，。、；：？！,.;:?!）》」';
  /** 单行超宽时自动断行：先按行数均分，再往标点上收口（只有用户自己填了长句才走到） */
  function wrapLine(ctx, line, maxW) {
    const W1 = ctx.measureText(line).width;
    if (W1 <= maxW) return [line];
    const out = [];
    let s = line;
    while (s.length > 1) {
      const sw = ctx.measureText(s).width;
      if (sw <= maxW) { out.push(s); s = ''; break; }
      const tgt = sw / Math.ceil(sw / maxW);      // 剩余部分要分几行，每行的目标宽度
      let cut = 1;
      for (let i = 1; i <= s.length; i++) {
        if (ctx.measureText(s.slice(0, i)).width > maxW) break;
        cut = i;
        if (ctx.measureText(s.slice(0, i)).width >= tgt) break;
      }
      let best = cut;                              // 附近 ±4 字内有标点就断在标点后
      for (let d = 1; d <= 4 && best === cut; d++) {
        for (const j of [cut - d, cut + d]) {
          if (j < 1 || j > s.length) continue;
          if (PUNCT.indexOf(s[j - 1]) >= 0 && ctx.measureText(s.slice(0, j)).width <= maxW) { best = j; break; }
        }
      }
      out.push(s.slice(0, best));
      s = s.slice(best);
    }
    if (s.length) out.push(s);
    return out;
  }

  /** 一幕的排版结果：{ f: 字号, rows: [{t, ems}] } */
  function buildRows(ctx, sc, f, S) {
    setFont(ctx, S.headWeight, f, S.headFont, 0);
    const rows = [];
    for (let i = 0; i < sc.lines.length; i++) {
      const ems = (sc.em || []).filter(m => m.l === i).map(m => m.t);
      const line = sc.lines[i];
      const pieces = ctx.measureText(line).width <= SAFE ? [line] : wrapLine(ctx, line, SAFE);
      for (const p of pieces) rows.push({ t: p, ems });
    }
    return rows;
  }

  /* 幕版式：同一份文案数据（lines / em）换排法。幕级属性，写在 timeline 的每幕上。 */
  const LAYOUTS = {
    center: { l: '居中一句话', k: 1,   lh: 1,    align: 'center' },
    left:   { l: '左对齐',     k: .92, lh: 1.08, align: 'left', rule: true },
    list:   { l: '要点列表',   k: .72, lh: 1.22, align: 'left', mark: true },
    number: { l: '数字幕',     k: .74, lh: 1.06, align: 'center', head: 1.85 },
  };

  /** 数字幕首行的字号：放大但不许出安全边 */
  function headSize(ctx, text, f, k, S) {
    let sz = Math.round(f * k);
    for (; sz > f; sz -= 2) {
      setFont(ctx, S.headWeight, sz, S.headFont, 2);
      if (ctx.measureText(text).width <= SAFE) break;
    }
    return Math.max(f, sz);
  }

  /** 一幕的排版结果：{ f: 正文号, rows: [{t, ems}], L: 版式 } */
  function layoutScene(ctx, sc, S) {
    const L = LAYOUTS[sc.layout] || LAYOUTS.center;
    const S2 = L.k === 1 ? S : Object.assign({}, S, {
      maxFont: Math.round(S.maxFont * L.k),
      minFont: Math.max(40, Math.round(S.minFont * L.k)),
    });
    let f = fitFont(ctx, sc.lines, S2);
    let rows = buildRows(ctx, sc, f, S);
    const maxH = 1180, h = rows.length * f * S.lineHeight * L.lh;
    if (h > maxH) { f = Math.max(40, Math.round(f * maxH / h)); rows = buildRows(ctx, sc, f, S); }
    return { f, rows, L };
  }

  /** 把一行拆成 [普通, 重点, 普通] 片段 */
  function runsOf(line, ems) {
    const marks = (ems || [])
      .map(e => ({ t: e, i: line.indexOf(e) }))
      .filter(e => e.i >= 0)
      .sort((a, b) => a.i - b.i);
    const out = [];
    let pos = 0;
    for (const m of marks) {
      if (m.i < pos) continue;
      if (m.i > pos) out.push({ t: line.slice(pos, m.i), em: false });
      out.push({ t: m.t, em: true });
      pos = m.i + m.t.length;
    }
    if (pos < line.length) out.push({ t: line.slice(pos), em: false });
    return out;
  }

  function drawRuns(ctx, line, ems, x, y, S, alpha, swipeP, emPulse) {
    const runs = runsOf(line, ems);
    let cx = x;
    for (const r of runs) {
      const w = ctx.measureText(r.t).width;
      const a = alpha * (r.em ? (emPulse || 1) : 1);
      if (r.em && S.emMode === 'swipe' && swipeP > 0) {
        const ww = w * eoc(swipeP);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = S.swipe;
        const bh = ctx.measureText('字').width * .95;
        roundRect(ctx, cx - 8, y - bh * .62, ww + 16, bh * 1.2, 10);
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = a;
      ctx.fillStyle = r.em ? S.accent : S.text;
      ctx.fillText(r.t, cx, y);
      cx += w;
    }
  }

  /** CTA 那一句的呼吸：只给重点词做极轻的明暗起伏，2.4s 一轮 */
  const emPulseAt = t => .84 + .16 * (.5 + .5 * Math.cos(t * Math.PI * 2 / 2.4));

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------------- 三个槽位 ---------------- */
  function drawLabel(ctx, t, sc, S, alpha) {
    if (S.labelStyle === 'none') return;
    const x = M, y = 216;
    ctx.save();
    ctx.globalAlpha = alpha * .92;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    setFont(ctx, '500', S.labelSize, S.labelFont, S.labelSpacing);
    ctx.fillStyle = S.accent;
    const tw = ctx.measureText(sc.label).width;

    if (S.labelStyle === 'tag') {
      const padX = 20, h = S.labelSize + 26;
      ctx.strokeStyle = S.accent;
      ctx.lineWidth = 2;
      ctx.globalAlpha = alpha * .55;
      roundRect(ctx, x, y - h / 2, tw + padX * 2, h, h / 2);
      ctx.stroke();
      ctx.globalAlpha = alpha * .95;
      ctx.fillText(sc.label, x + padX, y + 1);
    } else {
      ctx.fillText(sc.label, x, y + 1);
    }

    const p = eoc(seg(t, sc.start + .18, .55));
    if (S.labelStyle === 'bar' || S.labelStyle === 'rule') {
      const bw = (S.labelStyle === 'bar' ? 96 : 168) * p;
      ctx.globalAlpha = alpha * (S.labelStyle === 'bar' ? .95 : .5);
      ctx.fillStyle = S.accent;
      const wy = y + S.labelSize * .95;
      ctx.fillRect(S.labelStyle === 'bar' ? x : x + tw + 26, wy, bw, S.labelStyle === 'bar' ? 5 : 2);
    } else if (S.labelStyle === 'hair') {
      // 细线：编号左右各一条（— 02 —）；左边要给安全边留够，别顶到画布外
      const seg1 = Math.min(120, x - 30) * p;
      ctx.globalAlpha = alpha * .55;
      ctx.fillStyle = S.accent;
      ctx.fillRect(x + tw + 30, y - .5, seg1, 1);
      ctx.fillRect(x - 30 - seg1, y - .5, seg1, 1);
    }
    ctx.restore();
  }

  function drawFoot(ctx, S, alpha, t, tl) {
    ctx.save();
    ctx.textBaseline = 'middle';
    setFont(ctx, '400', 26, SANS, 1);
    ctx.textAlign = 'left';
    ctx.fillStyle = S.sub;
    const ba = seg(t, tl.head + .05, .5);      // 片头里已有大名，角标等片头过了再出
    if (ba > 0) { ctx.globalAlpha = ba * .95; ctx.fillText(S.brand, M, H - 268); }
    ctx.globalAlpha = alpha * .95;
    if (S.progress) {
      const y = 118, p = clamp01(t / tl.dur);
      ctx.globalAlpha = alpha * .9;
      ctx.fillStyle = S.deep ? 'rgba(255,255,255,.14)' : 'rgba(15,23,32,.10)';
      ctx.fillRect(M, y, SAFE, 3);
      ctx.fillStyle = S.accent;
      ctx.fillRect(M, y, SAFE * p, 3);
    }
    ctx.restore();
  }

  function drawHead(ctx, t, tl, S) {
    const a = 1 - seg(t, tl.head - .35, .35);
    if (a <= 0) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const p = eoc(seg(t, .06, .6));
    ctx.globalAlpha = a * p;
    let hf = 78;
    for (; hf >= 44; hf -= 2) {
      setFont(ctx, S.headWeight, hf, S.headFont, 6);
      if (ctx.measureText(S.brand).width <= SAFE) break;
    }
    ctx.fillStyle = S.text;
    ctx.fillText(S.brand, W / 2, CY_HEAD - 28 - (1 - p) * 18);
    ctx.restore();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = 210 * eoc(seg(t, .28, .6));
    ctx.globalAlpha = a * .9;
    ctx.fillStyle = S.accent;
    ctx.fillRect(W / 2 - w / 2, CY_HEAD + 46, w, 4);

    ctx.globalAlpha = a * .62;
    setFont(ctx, '400', 30, SANS, 8);
    ctx.fillStyle = S.text;
    ctx.fillText(BRAND.sub, W / 2, CY_HEAD + 104);
    ctx.restore();
  }

  /* ---------------- 主入口 ---------------- */
  function renderFrame(ctx, t, tl, style) {
    const S = typeof style === 'string' ? (STYLES[style] || STYLES.orange) : (style || STYLES.orange);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = S.bg;
    ctx.fillRect(0, 0, W, H);
    drawGlows(ctx, t, S);
    drawTexture(ctx, S);

    drawHead(ctx, t, tl, S);

    for (const sc of tl.scenes) {
      if (t < sc.start || t >= sc.end + 1e-6) continue;
      const fade = 1 - seg(t, sc.end - .34, .34);
      if (fade <= 0) continue;

      drawLabel(ctx, t, sc, S, fade);

      const LZ = layoutScene(ctx, sc, S);
      const f = LZ.f, rows = LZ.rows, L = LZ.L;
      const sizes = rows.map((r, i) => (L.head && i === 0) ? headSize(ctx, r.t, f, L.head, S) : f);
      const rhs = sizes.map(sz => sz * S.lineHeight * L.lh);
      const blockH = rhs.reduce((a, b) => a + b, 0);
      const blockTop = CY - blockH / 2;
      const swipeP = seg(t, sc.start + .42, .72);
      const pulse = sc.cta ? emPulseAt(t) : 1;

      // 左对齐版式：文本块左侧一条强调色竖线，跟块同高
      if (L.rule) {
        const rp = eoc(seg(t, sc.start + .1, .5));
        ctx.save();
        ctx.globalAlpha = fade * .85 * rp;
        ctx.fillStyle = S.accent;
        ctx.fillRect(M - 34, blockTop - 18, 6, (blockH + 36) * rp);
        ctx.restore();
      }

      ctx.save();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      let cur = blockTop;
      for (let i = 0; i < rows.length; i++) {
        const p = seg(t, sc.start + i * S.enter.stagger, S.enter.dur);
        const rh = rhs[i], yc = cur + rh / 2;
        cur += rh;
        if (p <= 0) continue;
        const e = eoc(p);
        setFont(ctx, S.headWeight, sizes[i], S.headFont, (L.head && i === 0) ? 2 : 0);
        const lw = ctx.measureText(rows[i].t).width;
        const x0 = L.align === 'left' ? M + (L.mark ? f * .78 : 0) : (W - lw) / 2;
        ctx.save();
        ctx.translate(x0 + S.enter.dx * (1 - e), yc + S.enter.dy * (1 - e));
        if (L.mark) {
          ctx.globalAlpha = fade * e * .9;
          ctx.fillStyle = S.accent;
          ctx.beginPath();
          ctx.arc(-f * .78, 0, Math.max(5, f * .1), 0, Math.PI * 2);
          ctx.fill();
        }
        if (L.head && i === 0) {
          ctx.globalAlpha = fade * e;
          ctx.fillStyle = S.accent;
          ctx.fillText(rows[i].t, 0, 0);
        } else {
          drawRuns(ctx, rows[i].t, rows[i].ems, 0, 0, S, fade * e, swipeP, pulse);
        }
        ctx.restore();
      }
      ctx.restore();

      // 合规小字：跟在内容块下方（不贴底，避开平台底部标题/按钮遮挡）；左对齐版式跟着左对齐
      const ca = S.foot ? seg(t, sc.start + .55, .6) * fade : 0;
      if (ca > 0) {
        const fx = L.align === 'left' ? M + (L.mark ? f * .78 : 0) : W / 2;
        ctx.save();
        ctx.globalAlpha = ca * .95;
        ctx.textAlign = L.align === 'left' ? 'left' : 'center';
        ctx.textBaseline = 'middle';
        setFont(ctx, '400', 26, SANS, 3);
        ctx.fillStyle = S.sub;
        ctx.fillText(FOOT, fx, blockTop + blockH + 54);
        ctx.restore();
      }
    }

    drawFoot(ctx, S, seg(t, .12, .5), t, tl);
  }

  global.Renderer = {
    W, H, SAFE, M, CY, FPS_DEFAULT: 30,
    STYLES, PRESETS, FIELDS, DEFAULT_CFG, BGS, ACCENTS, FONTS, LAYOUTS,
    buildStyle, cfgLine, parseCfg, hexA,
    renderFrame, fitFont, layoutScene, wrapLine, setFont,
    BRAND, FOOT,
    fonts: { SANS, SERIF, KAI, MONO },
  };
})(window);
