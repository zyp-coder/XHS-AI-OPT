/* 中转 · 云端版（Cloudflare Worker）
 *
 * 和 relay/local/server.mjs 跑的是同一份 relay/core.mjs；这里只多两件事：
 *   ① HTTP 适配：Request → core 要的 {method,path,query,headers,body}
 *   ② KV 存储：Cloudflare KV → core 要的 {get,put,del,list}
 * 手机页由 wrangler.toml 的 [assets] 直接托管 relay/phone/，不用另找地方放。
 *
 * ── 部署（一次性，需要在 Cloudflare 有账号）──
 *   1) npm i -g wrangler        或之后一律用 npx wrangler
 *      （npm 官方源不通就加镜像：npm i -g wrangler --registry=https://registry.npmmirror.com）
 *   2) wrangler login
 *   3) wrangler kv namespace create RELAY_KV     ← 把打出来的 id 填进 wrangler.toml
 *   4) wrangler deploy                           ← 打出 https://<name>.<账号>.workers.dev
 * 之后把那个 https 地址填进手机桥弹窗的「中转地址」→ 保存（浏览器会弹一次授权确认）；
 * 手机页就是同一个域名：https://<name>.<账号>.workers.dev/#p=配对码
 * 注：`deploy --dry-run` 只验构建、不验账号，真要发上去还是得先 login。
 *
 * ── 两个要紧的注意 ──
 *   · 国内可达：*.workers.dev 在大陆常被 DNS 污染，手机可能打不开。要稳，
 *     就在 Cloudflare 绑一个自己的域名（wrangler.toml 里有注释的 routes 段）。
 *   · 免费额度：KV 免费版按「一天 1000 次写」算。桥那边已按最小必要频率推
 *     （跑着约 1 分钟一次、闲时 5 分钟一次心跳，见 bridge/background.js 的两个 GAP 常量），
 *     最坏一天 ~900 次，留了余量；要改频率先算这笔账。
 */
import { handle } from '../core.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

/* Cloudflare KV → core 要的 store。
   KV 的 list 只回键名（不像本地版回键值），所以还要一个个取回来；
   配对码顺手设 1 小时 TTL，云版就不用跑定时清扫了。 */
function kvStore(kv) {
  return {
    async get(k) { return (await kv.get(k, 'json')) || null; },
    async put(k, v) {
      const s = JSON.stringify(v);
      if (k.startsWith('pair:')) await kv.put(k, s, { expirationTtl: 3600 });
      else await kv.put(k, s);
    },
    async del(k) { await kv.delete(k); },
    async list(prefix) {
      const out = [];
      let cursor;
      do {
        const page = await kv.list({ prefix, cursor });
        for (const it of page.keys || []) out.push({ key: it.name, value: await kv.get(it.name, 'json') });
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
      return out;
    },
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    /* 手机页 / 图标等静态件交给 assets；只有接口走下面的 core */
    if (!path.startsWith('/api/') && path !== '/health') {
      const r = await env.ASSETS.fetch(request);
      /* 手机页要「改完就生效」：手机上别吃旧缓存（就一个页面，不给缓存也费不了什么流量） */
      const h = new Headers(r.headers);
      h.set('Cache-Control', 'no-store');
      return new Response(r.body, { status: r.status, headers: h });
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const headers = {};
    request.headers.forEach((v, k) => { headers[k] = v; });
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    const out = await handle(
      { method: request.method, path, query: Object.fromEntries(url.searchParams), headers, body },
      kvStore(env.RELAY_KV),
    );
    return new Response(out.body, {
      status: out.status,
      headers: { 'Content-Type': out.type, 'Cache-Control': 'no-store', ...CORS },
    });
  },
};
