/**
 * 中转核心：与运行环境无关的一份逻辑，本地 Node 与 Cloudflare Worker 共用。
 *
 * 它只干一件事：当"信箱"。电脑上的手机桥把快照推进来，手机来取。
 *   · 只存"最后一份"快照，不攒历史；24 小时没有新推送就把快照丢掉（记录留着，手机看到的是"离线"）。
 *   · 配对码是一次性的、10 分钟过期；认领后立刻作废。
 *   · 双方的长期令牌由手机桥生成，中转只做持有与比对（明文存 token 是为了能比对；
 *     它只是一个"取件凭证"，泄露也只能看到那几个进度数字）。
 *
 * 存储接口（由运行环境提供）：
 *   store.get(key) → 值或 null；store.put(key, value)；store.del(key)；store.list(prefix) → [{key, value}]
 */

const VER = '0.1.0';
const PAIR_TTL_MS = 10 * 60 * 1000;      // 配对码有效期
const SNAP_TTL_MS = 24 * 60 * 60 * 1000; // 快照保留时长（超过就当没有；手机看到"离线"）

const RE_ID = /^[a-z0-9]{8,64}$/i;       // deviceId / token / pairCode 的字符集约束

const json = (status, body) => ({ status, type: 'application/json; charset=utf-8', body: JSON.stringify(body) });

function nowOf(ctx) { return (ctx && ctx.now) || Date.now(); }

/* 从 'Bearer xxx' 里取令牌 */
function bearer(headers) {
  const raw = (headers && (headers['authorization'] || headers['Authorization'])) || '';
  const m = String(raw).match(/^Bearer\s+([A-Za-z0-9]+)$/);
  return m ? m[1] : '';
}

/**
 * 处理一次请求。
 * @param {{method:string, path:string, query:Object, headers:Object, body:any}} req
 * @param {{get:Function, put:Function, del:Function, list:Function}} store
 * @param {{now?:number}} [ctx] 便于测试注入时间
 * @returns {Promise<{status:number, type:string, body:string}>}
 */
export async function handle(req, store, ctx) {
  const now = nowOf(ctx);
  const method = String(req.method || 'GET').toUpperCase();
  const path = String(req.path || '/');
  const query = req.query || {};
  const body = req.body && typeof req.body === 'object' ? req.body : {};

  if (path === '/health') {
    // lan：本地版把「手机能直接开的地址」带回来（配对二维码要画的就是它）；云版不带
    return json(200, { ok: true, ver: VER, lan: (ctx && ctx.lan) || [] });
  }

  /* ① 电脑侧登记一次配对：把「一次性配对码 → 设备与令牌」记下来，等手机来认领 */
  if (path === '/api/pair/new' && method === 'POST') {
    const deviceId = String(body.deviceId || '');
    const token = String(body.token || '');
    const pairCode = String(body.pairCode || '').toUpperCase();
    if (!RE_ID.test(deviceId) || !RE_ID.test(token) || !RE_ID.test(pairCode)) return json(400, { ok: false, error: 'bad_params' });
    await store.put('dev:' + deviceId, {
      token,
      host: String(body.host || '').slice(0, 40),
      ver: String(body.ver || '').slice(0, 16),
      createdAt: now,
      lastPushAt: 0,
      snapshot: null,
    });
    await store.put('pair:' + pairCode, { deviceId, at: now });
    return json(200, { ok: true });
  }

  /* ② 手机侧用配对码换长期令牌（一次性） */
  if (path === '/api/pair/claim' && method === 'POST') {
    const pairCode = String(body.pairCode || '').toUpperCase();
    if (!RE_ID.test(pairCode)) return json(400, { ok: false, error: 'bad_params' });
    const rec = await store.get('pair:' + pairCode);
    if (!rec) return json(404, { ok: false, error: 'no_code' });
    await store.del('pair:' + pairCode);                     // 认领即作废，重放拿不到东西
    if (now - (Number(rec.at) || 0) > PAIR_TTL_MS) return json(410, { ok: false, error: 'expired' });
    const dev = await store.get('dev:' + rec.deviceId);
    if (!dev) return json(404, { ok: false, error: 'no_device' });
    return json(200, { ok: true, deviceId: rec.deviceId, token: dev.token, host: dev.host });
  }

  /* ③ 电脑侧推快照（手机桥每分钟来一次） */
  if (path === '/api/push' && method === 'POST') {
    const deviceId = String(body.deviceId || '');
    const token = bearer(req.headers);
    const dev = RE_ID.test(deviceId) ? await store.get('dev:' + deviceId) : null;
    if (!dev || !token || dev.token !== token) return json(401, { ok: false, error: 'unauthorized' });
    await store.put('dev:' + deviceId, {
      ...dev,
      host: String(body.host || dev.host || '').slice(0, 40),
      ver: String(body.ver || dev.ver || '').slice(0, 16),
      lastPushAt: now,
      snapshot: body.snapshot && typeof body.snapshot === 'object' ? body.snapshot : null,
    });
    return json(200, { ok: true, at: now });
  }

  /* ④ 手机侧读快照 */
  if (path === '/api/snap' && method === 'GET') {
    const deviceId = String(query.d || '');
    const token = bearer(req.headers);
    const dev = RE_ID.test(deviceId) ? await store.get('dev:' + deviceId) : null;
    if (!dev || !token || dev.token !== token) return json(401, { ok: false, error: 'unauthorized' });
    const fresh = dev.lastPushAt && (now - dev.lastPushAt) <= SNAP_TTL_MS;
    return json(200, {
      ok: true,
      host: dev.host || '',
      ver: dev.ver || '',
      at: dev.lastPushAt || 0,
      snapshot: fresh ? (dev.snapshot || null) : null,
    });
  }

  /* ⑤ 电脑侧解绑：删掉这条设备，手机的令牌立刻失效 */
  if (path === '/api/unbind' && method === 'POST') {
    const deviceId = String(body.deviceId || '');
    const token = bearer(req.headers);
    const dev = RE_ID.test(deviceId) ? await store.get('dev:' + deviceId) : null;
    if (!dev || !token || dev.token !== token) return json(401, { ok: false, error: 'unauthorized' });
    await store.del('dev:' + deviceId);
    return json(200, { ok: true });
  }

  return json(404, { ok: false, error: 'not_found' });
}

/** 清掉过期的配对码（本地版每次启动/定时调用；Worker 版靠 KV 的 TTL 也行） */
export async function sweep(store, ctx) {
  const now = nowOf(ctx);
  const pairs = await store.list('pair:');
  let n = 0;
  for (const it of pairs) {
    if (now - (Number(it.value && it.value.at) || 0) > PAIR_TTL_MS) { await store.del(it.key); n++; }
  }
  return n;
}

export const RELAY_VER = VER;
export const RELAY_TTLS = { PAIR_TTL_MS, SNAP_TTL_MS };
