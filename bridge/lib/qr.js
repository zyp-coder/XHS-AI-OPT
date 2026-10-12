/* 离线二维码编码器（byte 模式 · 纠错 M · 版本 1–10 自动挑）
 *
 * 为什么自己写：手机桥要画配对二维码，而扩展不能联网取 JS（MV3 的 CSP 也不让），本地也不引 npm 依赖。
 * 所以按 ISO/IEC 18004 手写一份最小的：只支持 byte 模式 + 纠错 M，容量到版本 10（213 字节）
 * —— 配对链接最长也就 60 来个字符，富余得很。
 *
 * 用法：const qr = QR.encode('https://…/#p=ABCD1234');
 *       qr.size → 边长（模块数）；qr.get(x, y) → true=黑点；qr.rows() → ['0101…', …]
 * 自测：node scripts/dev/_gen_qr_samples.mjs 然后 python3 scripts/dev/_check_qr_roundtrip.py（zxing 解回来比对）
 */
(function (root) {
  'use strict';

  /* 版本 1–10 的纠错 M 分块表：[每块纠错码字, 组1块数, 组1数据码字, 组2块数, 组2数据码字] */
  const EC_M = {
    1: [10, 1, 16, 0, 0], 2: [16, 1, 28, 0, 0], 3: [26, 1, 44, 0, 0], 4: [18, 2, 32, 0, 0],
    5: [24, 2, 43, 0, 0], 6: [16, 4, 27, 0, 0], 7: [18, 4, 31, 0, 0], 8: [22, 2, 38, 2, 39],
    9: [22, 3, 36, 2, 37], 10: [26, 4, 43, 1, 44],
  };
  /* 对齐图案中心（版本 1 没有对齐图案），取全集后用定位图案那三处跳过 */
  const ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  };
  const MAX_VER = 10;

  const getBit = (x, i) => ((x >>> i) & 1) !== 0;
  function bitLen(x) { let n = 0; while (x !== 0) { n++; x >>>= 1; } return n; }

  /* ── GF(256)：α = 2，模 x^8+x^4+x^3+x^2+1（0x11D） ── */
  function gfMul(a, b) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((b >>> i) & 1) * a;
    }
    return z & 0xFF;
  }
  const ALPHA = (() => {
    const t = new Array(255);
    let v = 1;
    for (let i = 0; i < 255; i++) { t[i] = v; v = gfMul(v, 2); }
    return t;
  })();

  /* ── 二进制的长除法取余（BCH 用；系数只有 0/1，位掩码表示，bit i = x^i 的系数） ── */
  function polyRemainder(dividend, divisor) {
    const dl = bitLen(divisor);
    while (bitLen(dividend) >= dl) dividend ^= divisor << (bitLen(dividend) - dl);
    return dividend;
  }

  /* ── 一个数据块的纠错码字：数据 × x^degree 除以生成多项式 ∏(x + α^i) 取余 ── */
  function blockEcc(data, degree) {
    // 生成多项式：数组下标 = 次数（gen[0] 是 x^0 的系数），最后一位是 x^degree 的系数 1
    let gen = [1];
    for (let i = 0; i < degree; i++) {
      const next = new Array(gen.length + 1).fill(0);
      for (let j = 0; j < gen.length; j++) {
        next[j] ^= gfMul(gen[j], ALPHA[i]);   // ×α^i：留在原次数
        next[j + 1] ^= gen[j];                // ×x：升一次
      }
      gen = next;
    }
    const desc = gen.slice().reverse();       // 合成除法要「高次在前」
    const res = data.slice().concat(new Array(degree).fill(0));
    for (let i = 0; i < data.length; i++) {
      const factor = res[i];
      if (factor === 0) continue;
      for (let j = 0; j < desc.length; j++) res[i + j] ^= gfMul(desc[j], factor);
    }
    return res.slice(data.length);
  }

  /* 15 位格式信息：2 位纠错档 + 3 位掩码 → BCH(15,5) → 异或 0x5412（M 档 = 00） */
  function formatBits(ecIndex, mask) {
    const data = (ecIndex << 3) | mask;
    const rem = polyRemainder(data << 10, 0x537);
    return (((data << 10) | rem) ^ 0x5412) & 0x7FFF;
  }
  /* 18 位版本信息（版本 ≥ 7）：BCH(18,6) */
  function versionBits(ver) {
    return ((ver << 12) | polyRemainder(ver << 12, 0x1F25)) & 0x3FFFF;
  }

  function utf8Bytes(s) {
    const out = [];
    const str = String(s == null ? '' : s);
    for (let i = 0; i < str.length; i++) {
      const cp = str.codePointAt(i);
      if (cp > 0xFFFF) i++;
      if (cp < 0x80) out.push(cp);
      else if (cp < 0x800) out.push(0xC0 | (cp >> 6), 0x80 | (cp & 63));
      else if (cp < 0x10000) out.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      else out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
    return out;
  }

  const dataCodewords = (ver) => { const t = EC_M[ver]; return t[1] * t[2] + t[3] * t[4]; };
  const maxBytes = () => Math.floor((dataCodewords(MAX_VER) * 8 - 4 - 16) / 8);
  const countBitsOf = (ver) => (ver >= 10 ? 16 : 8);

  /* 挑版本：byte 模式的开销 = 4 位模式 + 长度（版本 ≥ 10 起 16 位） */
  function pickVersion(nBytes) {
    for (let v = 1; v <= MAX_VER; v++) {
      if (nBytes * 8 <= dataCodewords(v) * 8 - 4 - countBitsOf(v)) return v;
    }
    throw new Error('内容太长：最多 ' + maxBytes() + ' 字节，现在 ' + nBytes + ' 字节');
  }

  /* 数据码字：模式 + 长度 + 内容 + 结束符 + 补齐 + 填充字 0xEC/0x11 交替 */
  function buildCodewords(bytes, ver) {
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    const capBits = dataCodewords(ver) * 8;
    push(0b0100, 4);
    push(bytes.length, countBitsOf(ver));
    bytes.forEach(b => push(b, 8));
    push(0, Math.min(4, capBits - bits.length));
    while (bits.length % 8 !== 0) bits.push(0);
    const words = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      words.push(b);
    }
    for (let pad = 0xEC; words.length < capBits / 8; pad = (pad === 0xEC ? 0x11 : 0xEC)) words.push(pad);
    return words;
  }

  /* 分块算纠错 → 按规范交织（先各组数据字、再各组纠错字） */
  function interleave(words, ver) {
    const t = EC_M[ver];
    const eccLen = t[0];
    const blocks = [];
    let p = 0;
    for (let i = 0; i < t[1]; i++) { blocks.push({ data: words.slice(p, p + t[2]), ecc: null }); p += t[2]; }
    for (let i = 0; i < t[3]; i++) { blocks.push({ data: words.slice(p, p + t[4]), ecc: null }); p += t[4]; }
    blocks.forEach(b => { b.ecc = blockEcc(b.data, eccLen); });
    const out = [];
    const maxData = Math.max.apply(null, blocks.map(b => b.data.length));
    for (let i = 0; i < maxData; i++) blocks.forEach(b => { if (i < b.data.length) out.push(b.data[i]); });
    for (let i = 0; i < eccLen; i++) blocks.forEach(b => out.push(b.ecc[i]));
    return out;
  }

  function maskAt(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return false;
    }
  }

  /* 铺一张矩阵：功能图案 → 数据位之字形 → 掩码 → 格式信息 */
  function makeMatrix(ver, codewords, mask) {
    const size = ver * 4 + 17;
    const mod = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => { mod[y][x] = !!dark; fn[y][x] = true; };

    // 定位图案（7×7 三处）：外环黑、次环白、中心 3×3 黑；外圈再加一圈白当分隔带
    const putFinder = (cx, cy) => {
      for (let dy = -1; dy <= 7; dy++) {
        for (let dx = -1; dx <= 7; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
          set(x, y, ring !== 4 && ring !== 2);
        }
      }
    };
    putFinder(0, 0); putFinder(size - 7, 0); putFinder(0, size - 7);

    // 定时图案：第 6 行 / 第 6 列，从两头定位图案之间一黑一白交替
    for (let i = 8; i < size - 8; i++) {
      set(i, 6, i % 2 === 0);
      set(6, i, i % 2 === 0);
    }

    // 对齐图案：5×5，中心黑点外一圈白再一圈黑；与三个定位图案重叠的位置不画
    const centers = ALIGN[ver];
    for (const cy of centers) {
      for (const cx of centers) {
        if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }

    // 版本信息（≥ 7）：左下 3×6 与右上 6×3 两块
    if (ver >= 7) {
      const bits = versionBits(ver);
      for (let i = 0; i < 18; i++) {
        const bit = getBit(bits, i);
        const a = size - 11 + (i % 3), b = Math.floor(i / 3);
        set(a, b, bit);
        set(b, a, bit);
      }
    }

    // 格式信息的位置先占住（值要等掩码定了才知道），顺带那个固定的黑模块
    for (let i = 0; i <= 8; i++) { if (i !== 6) { set(8, i, false); set(i, 8, false); } }
    for (let i = 0; i < 8; i++) { set(size - 1 - i, 8, false); set(8, size - 1 - i, false); }
    set(8, size - 8, true);

    // 数据位：从右下角起、两列一组、上下往返之字形（第 6 列跳过）
    const totalBits = codewords.length * 8;
    let idx = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (fn[y][x]) continue;
          mod[y][x] = idx < totalBits ? getBit(codewords[idx >>> 3], 7 - (idx & 7)) : false;
          idx++;
        }
      }
    }

    // 掩码（只翻非功能模块）
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!fn[y][x] && maskAt(mask, x, y)) mod[y][x] = !mod[y][x];
      }
    }

    // 格式信息落两处（含右下角那两个副本），值取定下来的掩码
    const fbits = formatBits(0, mask);
    const putF = (x, y, dark) => { mod[y][x] = !!dark; fn[y][x] = true; };
    for (let i = 0; i <= 5; i++) putF(8, i, getBit(fbits, i));
    putF(8, 7, getBit(fbits, 6));
    putF(8, 8, getBit(fbits, 7));
    putF(7, 8, getBit(fbits, 8));
    for (let i = 9; i < 15; i++) putF(14 - i, 8, getBit(fbits, i));
    for (let i = 0; i < 8; i++) putF(size - 1 - i, 8, getBit(fbits, i));
    for (let i = 8; i < 15; i++) putF(8, size - 15 + i, getBit(fbits, i));
    putF(8, size - 8, true);
    return mod;
  }

  /* 罚分（选掩码用）：连续同色 / 2×2 同色块 / 像定位图案 / 黑白失衡 */
  function penalty(mod) {
    const size = mod.length;
    let score = 0;
    const runs = (line) => {
      let s = 0, run = 1;
      for (let i = 1; i < line.length; i++) {
        if (line[i] === line[i - 1]) run++;
        else { if (run >= 5) s += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) s += 3 + (run - 5);
      return s;
    };
    for (let y = 0; y < size; y++) score += runs(mod[y]);
    for (let x = 0; x < size; x++) score += runs(mod.map(r => r[x]));
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const v = mod[y][x];
        if (v === mod[y][x + 1] && v === mod[y + 1][x] && v === mod[y + 1][x + 1]) score += 3;
      }
    }
    const pat = [true, false, true, true, true, false, true];
    const hit = (line, i) => {
      for (let j = 0; j < 7; j++) if (line[i + j] !== pat[j]) return false;
      const before = i - 4 >= 0 && line.slice(i - 4, i).every(v => !v);
      const after = i + 11 <= line.length && line.slice(i + 7, i + 11).every(v => !v);
      return before || after;
    };
    for (let y = 0; y < size; y++) {
      for (let x = 0; x <= size - 7; x++) if (hit(mod[y], x)) score += 40;
    }
    for (let x = 0; x < size; x++) {
      const col = mod.map(r => r[x]);
      for (let y = 0; y <= size - 7; y++) if (hit(col, y)) score += 40;
    }
    let dark = 0;
    for (const row of mod) for (const v of row) if (v) dark++;
    score += Math.floor(Math.abs(dark * 100 / (size * size) - 50) / 5) * 10;
    return score;
  }

  /* 对外：编码 → { version, mask, size, get(x,y), rows() } */
  function encode(text) {
    const bytes = utf8Bytes(text);
    const ver = pickVersion(bytes.length);
    const words = interleave(buildCodewords(bytes, ver), ver);
    let best = null, bestMask = 0;
    for (let m = 0; m < 8; m++) {
      const mod = makeMatrix(ver, words, m);
      const p = penalty(mod);
      if (!best || p < best.p) { best = { mod, p }; bestMask = m; }
    }
    const mod = best.mod;
    return {
      version: ver, mask: bestMask, size: mod.length,
      get: (x, y) => !!mod[y][x],
      rows: () => mod.map(r => r.map(v => (v ? '1' : '0')).join('')),
    };
  }

  const QR = { encode, maxBytes };
  root.QR = QR;
  if (typeof module !== 'undefined' && module.exports) module.exports = QR;
})(typeof globalThis !== 'undefined' ? globalThis : this);
