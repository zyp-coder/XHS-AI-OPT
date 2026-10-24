/**
 * kb-file.js — 知识库「文件导入」的正文抽取：.docx / .xlsx → 纯文本
 *
 * 只在本机解包：Office 文件本身是 zip，用 DecompressionStream('deflate-raw') 解出内部 XML，
 * 再用 DOMParser 抽文字；原文件不上传，交给 AI 的只有抽出来的文字。
 * 抽不出文字（旧版 .doc/.xls、损坏文件、纯图片文档）时抛错，由调用方逐文件点名、不阻断整批。
 */
(function () {
  const ZIP_EOCD = 0x06054b50, ZIP_CENTRAL = 0x02014b50, ZIP_LOCAL = 0x04034b50;
  const MAX_COLS = 200;   // 一行最多还原到第 200 列，防止超宽表格拉出巨量制表符

  function findEocd(dv, len) {
    const min = Math.max(0, len - 22 - 0xffff);
    for (let i = len - 22; i >= min; i--) if (dv.getUint32(i, true) === ZIP_EOCD) return i;
    return -1;
  }

  async function openZip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    const eocd = findEocd(dv, u8.length);
    if (eocd < 0) throw new Error('文件已损坏，或它是旧版 .doc/.xls 改了扩展名——请在 Word / Excel / WPS 里另存为 .docx / .xlsx');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const index = Object.create(null);
    for (let i = 0; i < count && p + 46 <= u8.length; i++) {
      if (dv.getUint32(p, true) !== ZIP_CENTRAL) throw new Error('压缩包结构异常，无法读取');
      const nameLen = dv.getUint16(p + 28, true);
      index[new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen))] = {
        method: dv.getUint16(p + 10, true),
        compSize: dv.getUint32(p + 20, true),
        localOff: dv.getUint32(p + 42, true),
      };
      p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    }
    return { u8, dv, index };
  }

  async function readText(zip, name) {
    const e = zip.index[name];
    if (!e) return null;
    const { u8, dv } = zip;
    if (dv.getUint32(e.localOff, true) !== ZIP_LOCAL) throw new Error('压缩包结构异常，无法读取');
    const start = e.localOff + 30 + dv.getUint16(e.localOff + 26, true) + dv.getUint16(e.localOff + 28, true);
    const raw = u8.subarray(start, start + e.compSize);
    if (e.method === 0) return new TextDecoder().decode(raw);
    if (e.method !== 8) throw new Error('压缩方式不支持，请在 Word / Excel 里另存后重试');
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
  }

  function xmlDoc(xml, what) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error(what + '解析失败，请另存后重试');
    return doc;
  }

  /* ── Word：正文按段落、表格按行抽文本（制表符分列） ── */
  function paraText(p) {
    let s = '';
    (function walk(n) {
      for (const c of Array.from(n.children)) {
        const t = c.tagName;
        if (t === 'w:t') s += c.textContent || '';
        else if (t === 'w:tab') s += '\t';
        else if (t === 'w:br' || t === 'w:cr') s += '\n';
        else if (t !== 'w:pPr' && t !== 'w:rPr') walk(c);   // 越过 w:delText 等非正文节点
      }
    })(p);
    return s;
  }
  function tableRows(tbl, sink) {
    for (const tr of Array.from(tbl.children)) {
      if (tr.tagName !== 'w:tr') { collect(tr, sink); continue; }
      const cells = [];
      for (const tc of Array.from(tr.children)) {
        if (tc.tagName !== 'w:tc') continue;
        const parts = [];
        collect(tc, parts);
        cells.push(parts.join(' ').trim());
      }
      sink.push(cells.join('\t'));
    }
  }
  function collect(node, sink) {
    for (const c of Array.from(node.children)) {
      const t = c.tagName;
      if (t === 'w:p') sink.push(paraText(c));
      else if (t === 'w:tbl') tableRows(c, sink);
      else if (t === 'w:sectPr' || t === 'w:tblPr' || t === 'w:trPr' || t === 'w:tcPr') continue;
      else collect(c, sink);
    }
  }
  async function docxToText(zip) {
    const xml = await readText(zip, 'word/document.xml');
    if (!xml) throw new Error('这个文件里没有 Word 正文（可能是空文档或加密文档）');
    const doc = xmlDoc(xml, 'Word 正文');
    const lines = [];
    collect(doc.getElementsByTagName('w:body')[0] || doc.documentElement, lines);
    return lines.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ── Excel：共享字符串 + 各工作表，按行导出（制表符分列） ── */
  function colIndex(ref) {
    const m = /^([A-Z]+)/.exec(String(ref || '').toUpperCase());
    if (!m) return -1;
    let n = 0;
    for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }
  function cellText(c, shared) {
    const t = c.getAttribute('t');
    if (t === 's') {
      const v = c.getElementsByTagName('v')[0];
      return shared[v ? parseInt(v.textContent, 10) : -1] || '';
    }
    if (t === 'inlineStr') {
      let s = '';
      for (const x of Array.from(c.getElementsByTagName('t'))) s += x.textContent || '';
      return s;
    }
    const v = c.getElementsByTagName('v')[0];
    return v ? String(v.textContent || '') : '';
  }
  async function xlsxToText(zip) {
    const shared = [];
    const ss = await readText(zip, 'xl/sharedStrings.xml');
    if (ss) {
      const doc = xmlDoc(ss, 'Excel 共享字符串');
      for (const si of Array.from(doc.getElementsByTagName('si'))) {
        let s = '';
        for (const t of Array.from(si.getElementsByTagName('t'))) s += t.textContent || '';
        shared.push(s);
      }
    }
    const sheets = Object.keys(zip.index)
      .filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
      .sort((a, b) => parseInt(a.replace(/\D+/g, ''), 10) - parseInt(b.replace(/\D+/g, ''), 10));
    if (!sheets.length) throw new Error('这个文件里没有可读的工作表（可能是空表格或加密文件）');
    const out = [];
    for (const name of sheets) {
      const doc = xmlDoc(await readText(zip, name), 'Excel 工作表');
      for (const row of Array.from(doc.getElementsByTagName('row'))) {
        const cells = [];
        let auto = 0;
        for (const c of Array.from(row.children)) {
          if (c.tagName !== 'c') continue;
          const at = colIndex(c.getAttribute('r'));
          const pos = at >= 0 ? at : auto;
          auto = pos + 1;
          if (pos < MAX_COLS) cells[pos] = cellText(c, shared);
        }
        const line = [];
        for (let i = 0; i < cells.length; i++) line.push(cells[i] == null ? '' : cells[i]);
        if (line.join('').trim()) out.push(line.join('\t'));
      }
    }
    return out.join('\n').trim();
  }

  /** 'text' = 当文本读（含 JSON 备份）；docx/xlsx 走解包；legacy = 旧版二进制 Office，读不了 */
  function kindOf(name) {
    const n = String(name || '');
    if (/\.docx$/i.test(n)) return 'docx';
    if (/\.xlsx$/i.test(n)) return 'xlsx';
    if (/\.(doc|xls|ppt|pptx|wps|et|dps)$/i.test(n)) return 'legacy';
    return 'text';
  }

  async function extract(file) {
    const kind = kindOf(file && file.name);
    if (kind === 'legacy') throw new Error('旧版 Office 格式读不了，请在 Word / Excel / WPS 里另存为 .docx / .xlsx 或 TXT 后重试');
    if (kind === 'text') return { kind, text: await file.text() };
    const zip = await openZip(await file.arrayBuffer());
    const text = kind === 'docx' ? await docxToText(zip) : await xlsxToText(zip);
    if (!text) throw new Error(kind === 'docx' ? 'Word 正文是空的（纯图片文档请改用文字说明）' : '表格里没读到文字内容');
    return { kind, text };
  }

  window.KbFile = { kindOf, extract };
})();
