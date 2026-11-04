// 🎭 IP 角色自检（2026-10-30）：服务器这一层——AI 编角色 / 拆字段 / 出定妆图 / 参考图真的递给了方舟 /
// 定妆照不限次数、不扣客户额度（2026-10-30 晚老板改的口径）。
// 不起浏览器：直接打 /api/action，出图与 AI 都拨到本机小桩，绝不碰真 Key。
// 用法：node scripts/dev/check_ipchar.mjs
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = join(REPO, 'tmp', 'ipchar-check', 'data');
const PORT = 8896;
const BASE = 'http://127.0.0.1:' + PORT;

let fails = 0;
const ok = (m) => console.log('  PASS ' + m);
const bad = (m) => { fails++; console.log('  FAIL ' + m); };

// 1×1 的 PNG，够服务器按文件头认类型
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const seen = { img: [], ai: [] };
function readBody(req) {
  return new Promise((res) => { const cs = []; req.on('data', (c) => cs.push(c)); req.on('end', () => res(Buffer.concat(cs).toString('utf8'))); });
}
const imgStub = createServer(async (req, res) => {
  seen.img.push({ url: req.url, body: JSON.parse((await readBody(req)) || '{}') });
  const out = JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(out);
});
const aiStub = createServer(async (req, res) => {
  const body = JSON.parse((await readBody(req)) || '{}');
  seen.ai.push(body);
  const msgs = JSON.stringify(body.messages || '');
  // 两种请求：拆字段（要 JSON）/ 按老板一句话改那段描述（要纯文本）
  const content = /改稿助手/.test(msgs)
    ? '小过，28 岁的装修师傅，短发两边推得很短，中等偏壮，穿深蓝工装，腰上挂卷尺。'
    : JSON.stringify({
      name: '小过', kind: '真人', role: '做了十年的装修师傅', age: '35 岁上下',
      hair: '短发，鬓角有点白', body: '中等偏壮', cloth: '深蓝色短袖工装',
      hammers: ['红色安全帽', '腰上挂卷尺', '左手一块旧手表'], voice: '说话慢，爱用「我跟你说」开头',
      desc: '工地上一眼能认出来的那种师傅。',
    });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content } }] }));
});

let cookie = '';
async function action(name, data) {
  const r = await fetch(BASE + '/api/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ action: name, data: data || {} }),
  });
  const setC = r.headers.get('set-cookie');
  if (setC) cookie = setC.split(';')[0];
  return r.json();
}

async function main() {
  console.log('── 🎭 IP 角色：AI 编角色 / 拆字段 / 定妆照（不计额度）/ 参考图 ──');
  rmSync(join(REPO, 'tmp', 'ipchar-check'), { recursive: true, force: true });
  mkdirSync(DATA, { recursive: true });
  await new Promise((r) => imgStub.listen(0, '127.0.0.1', r));
  await new Promise((r) => aiStub.listen(0, '127.0.0.1', r));

  const env = {
    ...process.env,
    DEMO_DATA_DIR: DATA,
    PORT: String(PORT),
    DEMO_AI_KEY: 'check-only',
    DEMO_AI_BASE: 'http://127.0.0.1:' + aiStub.address().port + '/v1',
    IMAGE_API_KEY: 'check-only',
    IMAGE_API_BASE: 'http://127.0.0.1:' + imgStub.address().port + '/api/v3',
    IMAGE_QUOTA_TRIAL: '10',
    IMAGE_DAILY_CAP: '500',
  };
  const srv = spawn('node', [join(REPO, 'server', 'dev-server.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  srv.stdout.on('data', (d) => { log += d; });
  srv.stderr.on('data', (d) => { log += d; });
  try {
    for (let i = 0; i < 80; i++) {
      try { await fetch(BASE + '/'); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
    }
    const up = await fetch(BASE + '/api/auth/signup', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'IP角色自检号', phone: '13900000002', password: 'check123' }),
    }).then((r) => { const c = r.headers.get('set-cookie'); if (c) cookie = c.split(';')[0]; return r.json(); });
    if (!up || !up.ok) { bad('真号没开成：' + JSON.stringify(up)); return; }

    // ① AI 编一个角色
    const built = await action('aiIpCharBuild', { profile: { desc: '做装修的' }, persona: '我是干了十年的装修师傅', product: { name: '旧房翻新' }, accountType: '个人IP/创始人型', existing: [], seed: '1234' });
    const ch = built && built.result && built.result.char;
    if (built.ok && ch && ch.name === '小过' && ch.kind === '真人' && (ch.hammers || []).length === 3) ok('AI 编角色：回了名字 / 类型 / 3 个视觉锤（' + (ch && ch.name) + '）');
    else bad('AI 编角色不对：' + JSON.stringify(built).slice(0, 300));
    if (seen.ai.length && /视觉锤/.test(JSON.stringify(seen.ai[0].messages || '')) && /只输出严格 JSON/.test(JSON.stringify(seen.ai[0].messages || ''))) ok('AI 提示词里带着「视觉锤」硬要求与 JSON 契约');
    else bad('AI 提示词没带硬要求：' + JSON.stringify(seen.ai[0]).slice(0, 300));

    // ② 定妆照：不计客户额度
    const CHAR = 'c_demo_check1';
    const first = await action('genCharImage', { charId: CHAR, prompt: '角色定妆照', size: '竖版 3:4', refs: [] });
    const r1 = first && first.result;
    if (first.ok && r1 && r1.ok && r1.url && r1.blobId) ok('出定妆图：回了同源链接 /api/blob/<id>（' + r1.blobId + '）');
    else bad('出定妆图没回图：' + JSON.stringify(first).slice(0, 300));
    if (seen.img.length === 1 && !seen.img[0].body.image) ok('没有参考图时，请求体不带 image 字段');
    else bad('没参考图却带了 image：' + JSON.stringify(seen.img[0].body).slice(0, 200));

    // ③ 重出时带上刚才那张当参考（同一张脸）
    const second = await action('genCharImage', { charId: CHAR, prompt: '角色定妆照（重出，带参考图）', size: '竖版 3:4', refs: [r1 && r1.blobId] });
    if (second.ok && second.result && second.result.ok) ok('重出成功（带参考图）');
    else bad('带参考图出图失败：' + JSON.stringify(second).slice(0, 300));
    const imgField = seen.img[1] && seen.img[1].body.image;
    if (Array.isArray(imgField) && imgField.length === 1 && /^data:image\//.test(String(imgField[0]))) ok('参考图按 data URL 递给了方舟（服务器自己读文件，不靠外网抓 /api/blob）');
    else bad('参考图没递对：' + JSON.stringify(imgField).slice(0, 200));

    // ④ 不限次数：出到第 4 张、再换一个角色，客户额度一张没动
    const third = await action('genCharImage', { charId: CHAR, prompt: '角色定妆照（再重出）', size: '竖版 3:4', refs: [r1 && r1.blobId] });
    const fourth = await action('genCharImage', { charId: CHAR, prompt: '角色定妆照（第 4 次）', size: '竖版 3:4', refs: [] });
    const other = await action('genCharImage', { charId: 'c_demo_check2', prompt: '角色定妆照', size: '竖版 3:4', refs: [] });
    const q4 = (await action('getImageQuota', {})).result || {};
    if (third.ok && third.result.ok && fourth.ok && fourth.result.ok && other.ok && other.result.ok && q4.used === 0 && q4.left === 10) {
      ok('定妆照不限次数：同一角色 4 张＋另一个角色 1 张，客户额度还是 0/10');
    } else bad('定妆照扣了客户额度：used=' + q4.used + ' left=' + q4.left);

    // ⑤ 普通配图（不带 charId）照旧扣额度，参考图也照收
    const note = await action('genNoteImage', { prompt: '这一篇的一张配图', size: '竖版 3:4', refs: [r1 && r1.blobId] });
    const q6 = (await action('getImageQuota', {})).result || {};
    if (note.ok && note.result.ok && q6.used === 1) ok('普通配图照旧扣 1 张（1/10）；参考图同样递得进去');
    else bad('普通配图口径不对：used=' + q6.used);
    if (Array.isArray(seen.img[seen.img.length - 1].body.image)) ok('普通配图也带上了角色定妆图当参考');
    else bad('普通配图没带参考图');

    // ⑥ 拆字段 / 按一句话改：新动作两头都能用
    const parsed = await action('aiIpCharParse', { text: '小过，32 岁的装修师傅，短发，穿深蓝工装，腰上挂卷尺。', hint: '' });
    const pc = parsed && parsed.result && parsed.result.char;
    if (parsed.ok && pc && pc.name === '小过' && (pc.hammers || []).length === 3) ok('aiIpCharParse 拆字段：回了名字与视觉锤');
    else bad('aiIpCharParse 拆字段不对：' + JSON.stringify(parsed).slice(0, 300));
    const revised = await action('aiIpCharParse', { text: '小过，32 岁的装修师傅。', hint: '再年轻一点', revise: true });
    const rt = revised && revised.result && revised.result.text;
    if (revised.ok && rt && /28 岁/.test(rt)) ok('aiIpCharParse 改稿：按老板那句话回了新的一段');
    else bad('aiIpCharParse 改稿不对：' + JSON.stringify(revised).slice(0, 300));

    // ⑦ 账本：定妆照只记 total，不记 trialUsed / charFree
    const store = JSON.parse(readFileSync(join(DATA, 'store.json'), 'utf8'));
    const rec = (store.image_quota.by || {})[Object.keys(store.image_quota.by || {})[0]] || {};
    if (rec.trialUsed === 1 && rec.total === 6 && !(rec.charFree && (rec.charFree[CHAR] || rec.charFree.c_demo_check2))) {
      ok('账本对：试用扣 1 张；5 张定妆照只进 total（6），不记 charFree');
    } else bad('账本不对：' + JSON.stringify(rec));

    // ⑦ 白名单
    const unknown = await action('genCharImage2', {});
    const ur = (unknown && unknown.result) || unknown || {};
    if (ur.ok === false && /扩展/.test(String(ur.error || ''))) ok('白名单外照旧拦住');
    else bad('白名单没拦住未知动作：' + JSON.stringify(unknown).slice(0, 200));
  } finally {
    srv.kill();
    imgStub.close();
    aiStub.close();
  }
  if (fails) console.log('\n服务器日志尾部：\n' + log.slice(-1500));
  console.log('\n结果：' + (fails === 0 ? '全过' : fails + ' 项没过'));
  process.exit(fails ? 1 : 0);
}

main();
