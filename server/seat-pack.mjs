/**
 * seat-pack.mjs — 按账号现打「专属包」
 *
 * 公网上只发专属包（一账号一包、配对号已预填）。母版由 executor/pack.js 铺在
 * web/download/_proto/（三件双击脚本留 __SLUG__、装机说明留 {{NAME}}/{{CODE}} 占位）；
 * 这里按账号把占位替成真值、补一份 prefill.json、压成 zip 落到 web/download/customers/<id>.zip。
 *
 * 为什么在服务器上打：以前要人跑一条命令再把 zip 传上来，忘了就没有包。
 * 现在开档那一刻自己打；已开档的老号第一次下载时也现补一份。
 *
 * 纯 JS 打 zip（不调 PowerShell、不依赖系统 zip 命令）——服务器是 Linux。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('../web/', import.meta.url));
const PROTO_DIR = path.join(WEB, 'download', '_proto');
const PROTO_META = path.join(WEB, 'download', '_proto.json');
const OUT_DIR = path.join(WEB, 'download', 'customers');
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SERVER_BASE = String(process.env.PUBLIC_BASE || 'http://8.222.157.6/').replace(/\/+$/, '') + '/';

const inflight = new Map();

/* ── zip 写出（store/deflate 二选一，文件名按 UTF-8 标记） ── */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosStamp(d) {
  return {
    dtime: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | (Math.floor(d.getSeconds() / 2) & 31),
    ddate: (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31),
  };
}

function zipBuffer(entries) {
  const { dtime, ddate } = dosStamp(new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const raw = e.data;
    const crc = crc32(raw);
    let method = 8;
    let body = zlib.deflateRawSync(raw, { level: 9 });
    if (body.length >= raw.length) { method = 0; body = raw; }

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);          // bit 11：文件名是 UTF-8
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(dtime, 10);
    lh.writeUInt16LE(ddate, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(dtime, 12);
    ch.writeUInt16LE(ddate, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);

    offset += lh.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, eocd]);
}

/* ── 母版 → 逐件读出（路径用 / 分隔，前面套一层客户看到的文件夹） ── */
function walk(root, rel, out) {
  for (const ent of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? rel + '/' + ent.name : ent.name;
    if (ent.isDirectory()) walk(root, r, out);
    else out.push(r);
  }
  return out;
}

function readProto() {
  if (!fs.existsSync(PROTO_DIR)) return null;
  let meta = null;
  try { meta = JSON.parse(fs.readFileSync(PROTO_META, 'utf8')); } catch { return null; }
  if (!meta || !meta.version) return null;
  return { dir: PROTO_DIR, meta, files: walk(PROTO_DIR, '', []).sort() };
}

/* 字节级替占位：.bat 是 GBK，按 utf8 读会坏；latin1 一字节一字符，来回转不丢字节 */
function swapBytes(buf, from, to) {
  return Buffer.from(buf.toString('latin1').split(from).join(to), 'latin1');
}

function build(acc, proto, stamp, zipPath) {
  const folder = String(proto.meta.folder || '小红书助手-执行器') + '-' + acc.id;
  const entries = [];
  for (const rel of proto.files) {
    let data = fs.readFileSync(path.join(proto.dir, rel));
    if (rel === '装我.bat' || rel === '更新.bat' || rel === '卸载.bat') {
      data = swapBytes(data, '__SLUG__', acc.id);
    } else if (rel === '装机-看这里.txt') {
      const txt = data.toString('utf8')
        .split('{{NAME}}').join(String(acc.name || acc.id))
        .split('{{SLUG}}').join(acc.id)
        .split('{{CODE}}').join(stamp.code)
        .split('{{VERSION}}').join(stamp.version);
      data = Buffer.from(txt, 'utf8');
    }
    entries.push({ name: folder + '/' + rel, data });
  }
  entries.push({
    name: folder + '/prefill.json',
    data: Buffer.from(JSON.stringify({
      server: SERVER_BASE, code: stamp.code, slug: acc.id, name: String(acc.name || '')
    }, null, 2), 'utf8'),
  });

  const buf = zipBuffer(entries);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tmp = zipPath + '.' + process.pid + '.' + Date.now() + '.tmp';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, zipPath);
  return buf.length;
}

/* 出包入口：已经是最新的就直接用；不在就现打一份。
   永远不抛异常——调用方是网页请求，打不出来就当没包，别把请求打挂。 */
export async function ensureSeatPackage(acc) {
  try {
    if (!acc || !acc.id) return { ok: false, reason: 'no-account' };
    if (!ID_RE.test(String(acc.id))) return { ok: false, reason: 'bad-id' };
    if (!acc.pairCode) return { ok: false, reason: 'no-code' };
    const proto = readProto();
    if (!proto) return { ok: false, reason: 'no-proto' };

    const slug = String(acc.id);
    const stamp = {
      version: String(proto.meta.version),
      built: String(proto.meta.builtAt || ''),
      code: String(acc.pairCode),
      name: String(acc.name || ''),
    };
    const zipPath = path.join(OUT_DIR, slug + '.zip');
    const sidePath = path.join(OUT_DIR, slug + '.json');

    /* 侧车要连母版的出包时间一起比：母版改了但版本号没动（改说明、改教程）时，
       光看 version 会把旧包当成"已是最新"一直发下去。 */
    if (fs.existsSync(zipPath) && fs.existsSync(sidePath)) {
      try {
        const s = JSON.parse(fs.readFileSync(sidePath, 'utf8'));
        if (s.version === stamp.version && s.built === stamp.built
            && s.code === stamp.code && s.name === stamp.name) {
          return { ok: true, cached: true, zip: zipPath, size: fs.statSync(zipPath).size };
        }
      } catch { /* 侧车坏了就重打 */ }
    }
    if (inflight.has(slug)) return await inflight.get(slug);

    const job = (async () => {
      const size = build(acc, proto, stamp, zipPath);
      fs.writeFileSync(sidePath, JSON.stringify({
        slug, name: stamp.name, code: stamp.code, version: stamp.version, built: stamp.built,
        zip: slug + '.zip', builtAt: new Date().toISOString(), by: 'server',
      }, null, 2));
      console.log(`[seat] 专属包已出：${stamp.name || slug}（${slug}）${(size / 1048576).toFixed(2)} MB`);
      return { ok: true, cached: false, zip: zipPath, size };
    })().finally(() => inflight.delete(slug));

    inflight.set(slug, job);
    return await job;
  } catch (e) {
    console.error('[seat] 出包失败：' + (e && e.message));
    return { ok: false, reason: 'error', error: e && e.message };
  }
}

export function seatProtoInfo() {
  const p = readProto();
  return p ? { version: p.meta.version, files: p.files.length, builtAt: p.meta.builtAt } : null;
}
