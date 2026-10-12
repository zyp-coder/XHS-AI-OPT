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
  const GEC_VERSION = '1-143.0.3650.75';       // 跟着 edge-tts 的 Chromium 版本号走，接口认这个
  const WIN_EPOCH = 11644473600;               // 1601-01-01 到 1970-01-01 的秒数
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p2 = n => String(n).padStart(2, '0');

  const rnd = n => {
    const b = crypto.getRandomValues(new Uint8Array(n));
    return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  };

  /* 时间戳要 Windows 文件时间（100ns 一格），向下取整到 5 分钟再哈希 —— 跟服务端对得上才不是 403。
     大整数会掉精度，但 Python 那边同样是双精度，按同一串运算走结果就一样。 */
  function gec(nowMs) {
    let t = (nowMs === undefined ? Date.now() : nowMs) / 1000 + WIN_EPOCH;
    t -= t % 300;
    t *= 1e7;
    return sha256(t.toFixed(0) + CLIENT_TOKEN);
  }

  async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
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
