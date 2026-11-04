/* 客户机自己出声：直连微软给 Edge「大声朗读」用的那条免费通道 —— 扩展里跑，不走服务端。
   帧格式就是官方那套：文本帧发 speech.config + SSML，二进制帧收 mp3（前两字节是头长，头后面才是音频）。
   WebSocket 的握手头浏览器不让我们改（Origin 由浏览器写成 chrome-extension://<本扩展ID>），
   所以令牌只能走 URL 查询参数——这也是官方自己的做法。

   ★ 客户机那边要用 Edge 打开扩展（Windows 自带 / Mac 免费下）：服务端按 UA 认浏览器，
   UA 里没有 Edg/ 一律握手 403，而浏览器不给网页改自己握手的 UA。

   const mp3 = await EdgeTTS.synth('要念的一整段', { voice: 'zh-CN-XiaoxiaoNeural', rate: '+20%' }); */
(function (g) {
  const CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
  const WSS = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
  const GEC_VERSION = '2-143.0.3650.75';       // 跟着 edge-tts 的 Chromium 版本号走，接口认这个
  const WIN_EPOCH = 11644473600;               // 1601-01-01 到 1970-01-01 的秒数
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p2 = n => String(n).padStart(2, '0');

  const rnd = n => {
    const b = crypto.getRandomValues(new Uint8Array(n));
    return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  };

  /* Sec-MS-GEC v2：微软 2025 改了令牌口径，要「CS64(16位)-SHA256(64位)」两段，
     跟 edge-tts 社区反推的实现同源；光算标准 SHA-256 会被握手 403。
     全是 32 位无符号运算，纯 JS 就能算——公网 http 没有 crypto.subtle 也不影响。 */
  const INITIAL = [0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19];
  const STATE = [0xFD9FBEA2, 0x91243CE7, 0xBE499094, 0xCD2E1E0A, 0x6C006F49, 0x04BD35AB, 0xFEB0A7E4, 0x03EFFBD2];
  const SCHEDULE = [0xEB24BF9E, 0x1558691F, 0xA0C09EE2, 0x0CFA32BA, 0xA622EE8C, 0xD1DD9491, 0xC0DD25A0, 0xF9E70AB6,
    0xF0C31573, 0x7058CE4E, 0x7188E606, 0x00E5AB33, 0xD258B060, 0x72766564];
  const RC = [0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
    0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
    0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
    0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
    0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
    0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
    0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
    0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2];
  const ADJ = 0xC9DC06A7;
  const BLOCK_RC = RC.slice(0, 14).concat([ADJ], RC.slice(15));
  const SIGMA0_ADJ = 0x059C0B80;
  const SIGMA1_ADJ = 0x000B92C0;
  const COEF = [
    [0xE82E91B1, 0xB32700D0], [0x44DE24C6, 0x88DFF51D], [0x3BEB65BC, 0x29514038], [0xC89C5933, 0xB328CBDF],
    [0x8D1EC211, 0xD405B4D5], [0x314EF5D5, 0x26E55F3C], [0xE92491B1, 0x607801C6], [0xF0A5B9D5, 0x82B2C1FB],
    [0x06064CF3, 0xFA51A3DA], [0xDA79FA60, 0x207CC464], [0xBED20560, 0x3C3C74F3], [0x89F9C9F8, 0xD2D14B61],
    [0x35FA38C6, 0xBB04A2C1], [0xCB49E3C6, 0xC5626167]];
  const CS_FACTOR = 0x82893933;
  const CS_ADJ0 = 0xF2F90B1A;
  const CS_ADJ1 = 0x0B1A0000;

  const rol16 = x => ((x << 16) | (x >>> 16)) >>> 0;
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  const s0 = x => ((x >>> 7) ^ (x << 25) ^ (x >>> 18) ^ (x << 14) ^ (x >>> 3)) >>> 0;
  const s1 = x => ((x >>> 17) ^ (x << 15) ^ (x >>> 19) ^ (x << 13) ^ (x >>> 10)) >>> 0;

  function expand(w, start) {
    for (let i = start; i < 64; i++) w[i] = (s1(w[i - 2]) + w[i - 7] + s0(w[i - 15]) + w[i - 16]) >>> 0;
  }

  function rounds(state, w, first) {
    let [a, b, c, d, e, f, g, h] = state;
    const K = first === 14 ? BLOCK_RC : RC;
    for (let i = first; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    return [a, b, c, d, e, f, g, h];
  }

  function initHash(head7) {
    const w = new Array(16).fill(0);
    w[14] = ((head7[0] << 16) | (head7[1] << 8) | head7[2]) >>> 0;
    w[15] = ((head7[3] << 24) | (head7[4] << 16) | (head7[5] << 8) | head7[6]) >>> 0;
    for (let i = 16; i < 30; i++) {
      let v = SCHEDULE[i - 16];
      v += i === 16 ? (s1(w[14]) ^ SIGMA1_ADJ) : s1(w[i - 2]);
      if (i - 7 >= 14) v += w[i - 7];
      if (i - 15 >= 14) v += i === 29 ? (s0(w[14]) ^ SIGMA0_ADJ) : s0(w[i - 15]);
      w[i] = v >>> 0;
    }
    w[30] = (s1(w[28]) + w[23] + s0(w[15]) + w[14] + ADJ - RC[14]) >>> 0;
    expand(w, 31);
    const working = rounds(STATE, w, 14);
    return INITIAL.map((x, i) => (x + working[i]) >>> 0);
  }

  function digest(data) {
    const length = 57 + data.length;
    const padZero = (((55 - length) % 64) + 64) % 64;
    const padded = new Uint8Array(data.length - 7 + 1 + padZero + 8);
    padded.set(data.slice(7));
    padded[data.length - 7] = 0x80;
    const dv = new DataView(padded.buffer);
    const bits = length * 8;
    dv.setUint32(padded.length - 8, Math.floor(bits / 4294967296), false);
    dv.setUint32(padded.length - 4, bits >>> 0, false);
    let state = initHash(data.slice(0, 7));
    const w = new Array(64);
    for (let off = 0; off < padded.length; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
      expand(w, 16);
      const working = rounds(state, w, 0);
      state = state.map((x, i) => (x + working[i]) >>> 0);
    }
    return state;
  }

  function cs64(data, state) {
    const raw = new Uint8Array(32);
    const dv = new DataView(raw.buffer);
    state.forEach((x, i) => dv.setUint32(i * 4, x, false));
    const keyA = (dv.getUint32(0, true) | 1) >>> 0;
    const keyB = (dv.getUint32(4, true) | 1) >>> 0;
    const factors = [Math.imul(keyA, CS_FACTOR) >>> 0, Math.imul(keyB, CS_FACTOR) >>> 0];
    const terms = COEF.map((c, i) => Math.imul(c[0], factors[i % 2]) >>> 0);
    const offsets = COEF.map(c => c[1] >>> 0);
    const buf = new Uint8Array(data.length + 1);
    buf.set(data, 1);
    const pad = new Uint8Array(buf.length + ((4 - buf.length % 4) % 4));
    pad.set(buf);
    const pdv = new DataView(pad.buffer);
    const words = [];
    for (let i = 0; i < pad.length; i += 4) words.push(pdv.getUint32(i, true));
    if (words.length % 2) words.push(0);
    words.forEach((word, i) => {
      let term = Math.imul(word, i % 2 === 0 ? keyA : keyB) >>> 0;
      let off = Math.imul(rol16(word), i % 2 === 0 ? 0xEF0569FB : 0xC31713DB) >>> 0;
      if (i === 0) {
        term = (term + Math.imul(CS_ADJ0, factors[0])) >>> 0;
        off = (off + CS_ADJ1) >>> 0;
      }
      terms.push(term);
      offsets.push(off);
    });
    let swapAcc = 0, swapLast = 0, st = 0, acc = 0;
    for (let i = 0; i < terms.length; i += 2) {
      const x = terms[i], y = terms[i + 1];
      let t = rol16((offsets[i] + x) >>> 0);
      let q = Math.imul(t, 0x76F50F34) >>> 0;
      swapAcc = (swapAcc + ((Math.imul(rol16(q), 0xC3EFEA97) + q) >>> 0)) >>> 0;
      t = rol16((offsets[i + 1] + y) >>> 0);
      q = Math.imul(t, 0x1881CE3C) >>> 0;
      swapLast = (Math.imul(rol16(q), 0x35BD1EC9) + q) >>> 0;
      swapAcc = (swapAcc + swapLast) >>> 0;

      st = (Math.imul(st, keyA) + x) >>> 0;
      st = Math.imul(rol16(st), 0xCF98B111) >>> 0;
      st = Math.imul(rol16(st), 0x87085B9F) >>> 0;
      st = Math.imul(rol16(st), 0x12CEB96D) >>> 0;
      st = Math.imul(rol16(st), 0x257E1D83) >>> 0;
      acc = (acc + st) >>> 0;
      t = (Math.imul(st, keyB) + y) >>> 0;
      t = Math.imul(rol16(t), 0xA27416F5) >>> 0;
      t = Math.imul(rol16(t), 0xD38396FF) >>> 0;
      st = Math.imul(rol16(Math.imul(rol16(t), 0x7C932B89) >>> 0), 0xBFA49F69) >>> 0;
      acc = (acc + st) >>> 0;
    }
    return [(swapLast ^ st) >>> 0, (swapAcc ^ acc) >>> 0];
  }

  /* 时间戳要 Windows 文件时间（100ns 一格），向下取整到 5 分钟再算 —— 跟服务端对得上才不是 403。 */
  function gec(nowMs) {
    let t = (nowMs === undefined ? Date.now() : nowMs) / 1000 + WIN_EPOCH;
    t -= t % 300;
    t *= 1e7;
    const data = new TextEncoder().encode(t.toFixed(0) + CLIENT_TOKEN);
    const state = digest(data);
    const cs = cs64(data, state);
    const csHex = cs.map(w => [w & 255, (w >>> 8) & 255, (w >>> 16) & 255, (w >>> 24) & 255]
      .map(b => b.toString(16).padStart(2, '0')).join('')).join('').toUpperCase();
    const shaHex = state.map(w => w.toString(16).padStart(8, '0')).join('').toUpperCase();
    return csHex + '-' + shaHex;
  }

  const jsDate = d =>
    `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${p2(d.getUTCDate())} ${d.getUTCFullYear()} ` +
    `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`;

  const xmlEsc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const clean = s => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ');   // 服务端不收这些控制符

  /* 实测：这条通道认「是不是 Edge」，UA 里没有 Edg/ 一律握手 403（Chrome 也一样）。
     浏览器不许网页改自己握手的 UA，DNR 的改头对 WebSocket 握手也不生效——所以 Chrome 里
     没辙，只能换 Edge 打开扩展（Windows 自带 Edge，Mac 官网免费下）。别提前拦，万一以后放开。 */
  const isEdge = () => / Edg\//.test(navigator.userAgent);
  const hint = () => isEdge() ? ''
    : '——这台浏览器不是 Edge：微软这条免费口子只认 Edge。用 Edge 打开扩展就能出声（Windows 自带，Mac 免费下载）。';

  function ssml(text, o) {
    return "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
      `<voice name='${o.voice}'>` +
      `<prosody pitch='${o.pitch}' rate='${o.rate}' volume='${o.volume}'>` +
      `${xmlEsc(clean(text))}` +
      '</prosody></voice></speak>';
  }

  const CONFIG =
    '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false",' +
    '"wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n';

  /* 念一段，回 Uint8Array（mp3）。一段一次连接：幕与幕之间另开一条，方便逐幕卡点。 */
  async function synth(text, opts) {
    const o = Object.assign(
      { voice: 'zh-CN-XiaoxiaoNeural', rate: '+0%', pitch: '+0Hz', volume: '+0%', timeout: 30000 }, opts);
    const token = await gec();                     // 哈希是异步的，忘了 await 就会把 [object Promise] 塞进查询串
    const url = `${WSS}?TrustedClientToken=${CLIENT_TOKEN}&ConnectionId=${rnd(16)}` +
      `&Sec-MS-GEC=${token}&Sec-MS-GEC-Version=${GEC_VERSION}`;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    const parts = [];
    let size = 0;

    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => fail(new Error('念超时了（30s 没收到完整音频）')), o.timeout);
      const fail = e => { if (done) return; done = true; clearTimeout(timer); try { ws.close(); } catch (_) {} reject(e); };
      const ok = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { ws.close(); } catch (_) {}
        const out = new Uint8Array(size);
        let at = 0;
        parts.forEach(p => { out.set(p, at); at += p.length; });
        if (!out.length) reject(new Error('服务端没返回音频'));
        else resolve(out);
      };

      ws.onopen = () => {
        const now = jsDate(new Date());
        ws.send(`X-Timestamp:${now}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${CONFIG}`);
        ws.send(`X-RequestId:${rnd(16)}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${now}Z\r\nPath:ssml\r\n\r\n${ssml(text, o)}`);
      };
      ws.onmessage = ev => {
        if (typeof ev.data === 'string') {
          if (ev.data.indexOf('Path:turn.end') >= 0) ok();     // 这条念完了
          return;
        }
        const buf = new Uint8Array(ev.data);
        if (buf.length < 2) return;
        const head = (buf[0] << 8) | buf[1];                   // 头两字节＝头部的长度
        const body = buf.subarray(2 + head);
        if (body.length) { parts.push(body); size += body.length; }
      };
      ws.onerror = () => fail(new Error('连不上语音服务（网络或接口抽风）' + hint()));
      ws.onclose = ev => {
        if (done) return;
        if (ev.code === 1000 || ev.code === 1005) ok();
        else fail(new Error(`连接被断开（${ev.code}）——多半是接口改了口径，我这边跟着 edge-tts 社区更新` + hint()));
      };
    });
  }

  g.EdgeTTS = { synth, gec, isEdge, VOICES: [
    ['zh-CN-XiaoxiaoNeural', '晓晓'], ['zh-CN-XiaoyiNeural', '晓伊'], ['zh-CN-YunxiNeural', '云希'],
    ['zh-CN-YunyangNeural', '云扬'], ['zh-CN-YunjianNeural', '云健'],
  ] };
})(typeof window !== 'undefined' ? window : self);
