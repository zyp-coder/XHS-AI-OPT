/**
 * crypto-box.js — 本地数据加解密（WebCrypto AES-GCM + PBKDF2-SHA256）
 *
 * 两种用法：
 *  ① 落盘加密：内建口令 + 每安装随机盐（chrome.storage.local: _crypt_salt_v1）派生密钥，
 *     密文统一带 `enc:v1:` 前缀（与后台服务端同口径）；无前缀的值按存量明文原样返回，
 *     下次写入时自动升级为密文。
 *  ② 导出加密：由用户设定口令，盐/IV 随机生成并随密文一起存放，换机器用同一口令即可解开。
 *
 * 边界说明：落盘密钥的盐随浏览器配置目录保存，防的是「拷贝数据文件 / 备份目录」这类离线读取，
 * 不防能直接操作本机的人（那种情况下数据本来就在他手上）。
 */

(function (root) {
  'use strict';

  const FMT = 'xhs-enc-v1';
  const PREFIX = 'enc:v1:';                  // 字段级密文前缀
  const PEPPER = 'xhs-local-vault-2026-09';  // 内建口令（与每安装随机盐一起派生落盘密钥）
  const SALT_KEY = '_crypt_salt_v1';
  const STORE_ITER = 120000;
  const FILE_ITER = 250000;

  /* ─── base64 / 随机数 ─── */
  function b64(bytes) {
    const u8 = new Uint8Array(bytes);
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(str) {
    const bin = atob(str);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  function rand(n) { return crypto.getRandomValues(new Uint8Array(n)); }

  async function deriveKey(password, saltBytes, iterations) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }
  async function aesEncrypt(key, text) {
    const iv = rand(12);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
    return { iv: b64(iv), ct: b64(ct) };
  }
  async function aesDecrypt(key, ivB64, ctB64) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivB64) }, key, unb64(ctB64));
    return new TextDecoder().decode(pt);
  }

  /* ─── 落盘密钥（内建口令 + 每安装随机盐） ─── */
  let _salt = null;          // 本上下文使用的盐（base64）
  let _saltPromise = null;
  let _keyPromise = null;
  let _testSalt = null;      // 仅供测试注入

  async function _readSalt() {
    if (_testSalt) return _testSalt;
    const d = await chrome.storage.local.get(SALT_KEY);
    return d[SALT_KEY] || null;
  }

  async function ensureSalt() {
    if (_salt) return _salt;
    if (_saltPromise) return _saltPromise;
    _saltPromise = (async () => {
      let cur = await _readSalt();
      if (!cur) {
        // 首次运行：生成随机盐并落盘；写完回读一次，避免多上下文同时初始化时各用各的盐
        await chrome.storage.local.set({ [SALT_KEY]: b64(rand(16)) });
        cur = await _readSalt();
      }
      if (!cur) throw new Error('无法初始化本机加密盐');
      _salt = cur;
      return cur;
    })();
    return _saltPromise;
  }

  async function storeKey() {
    if (_keyPromise) return _keyPromise;
    _keyPromise = (async () => {
      const salt = await ensureSalt();
      return deriveKey(PEPPER, unb64(salt), STORE_ITER);
    })();
    return _keyPromise;
  }

  /* ─── 落盘：加密 / 解密 ─── */
  function isLocked(v) {
    return typeof v === 'string' && v.indexOf(PREFIX) === 0;
  }

  async function lockText(plain) {
    if (plain === undefined || plain === null) return plain;
    let key = await storeKey();
    let saltUsed = _salt;
    let env = await aesEncrypt(key, String(plain));
    // 首次加密后校验盐未被其它上下文改写（改写则换新盐重来，否则这条数据将来解不开）
    const nowSalt = await _readSalt();
    if (nowSalt && nowSalt !== saltUsed) {
      _salt = nowSalt; _keyPromise = null; _saltPromise = null;
      key = await storeKey();
      env = await aesEncrypt(key, String(plain));
    }
    const body = JSON.stringify({ f: FMT, v: 1, i: env.iv, d: env.ct });
    return PREFIX + b64(new TextEncoder().encode(body));
  }

  /** 解密；非密文（存量明文）原样返回；解密失败返回 null 并告警 */
  async function unlockText(value) {
    if (typeof value !== 'string' || !isLocked(value)) return value;
    try {
      const env = JSON.parse(new TextDecoder().decode(unb64(value.slice(PREFIX.length))));
      if (!env || env.f !== FMT || !env.i || !env.d) return null;
      const key = await storeKey();
      return await aesDecrypt(key, env.i, env.d);
    } catch (e) {
      console.error('[crypto] 落盘密文解密失败：本机加密盐可能丢失或被重置（该条数据按空处理，未做覆盖）', e);
      return null;
    }
  }

  async function lockJSON(obj) {
    if (obj === undefined || obj === null) return obj;
    return lockText(JSON.stringify(obj));
  }

  /** 解出 JSON；失败/空返回 fallback */
  async function unlockJSON(value, fallback) {
    if (value === undefined || value === null) return fallback;
    const plain = await unlockText(value);
    if (plain === null || plain === undefined) return fallback;
    if (typeof plain !== 'string') return plain;   // 已是对象（未加密的存量数据）
    try { return JSON.parse(plain); } catch (_) { return fallback; }
  }

  /* ─── 导出文件：用户口令 ─── */
  async function encryptFile(text, password) {
    const salt = rand(16);
    const key = await deriveKey(password, salt, FILE_ITER);
    const env = await aesEncrypt(key, String(text));
    return JSON.stringify({
      fmt: FMT, mode: 'file', kdf: 'PBKDF2-SHA256', iter: FILE_ITER,
      salt: b64(salt), iv: env.iv, data: env.ct,
    }, null, 2);
  }

  function isFileEnvelope(text) {
    try {
      const o = JSON.parse(text);
      return !!(o && o.fmt === FMT && o.salt && o.data);
    } catch (_) { return false; }
  }

  async function decryptFile(text, password) {
    let o;
    try { o = JSON.parse(text); } catch (_) { throw new Error('文件不是合法的 JSON'); }
    if (!o || o.fmt !== FMT || !o.salt || !o.data) throw new Error('文件不是本工具的加密备份');
    const key = await deriveKey(password, unb64(o.salt), o.iter || FILE_ITER);
    try { return await aesDecrypt(key, o.iv, o.data); }
    catch (_) { throw new Error('口令不正确，或文件已损坏'); }
  }

  /* ─── 口令输入弹窗（仅页面上下文可用） ─── */
  function askPassword(opts) {
    const o = opts || {};
    return new Promise((resolve) => {
      if (typeof document === 'undefined') { resolve({ ok: false, password: '' }); return; }
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;inset:0;background:rgba(15,18,28,.55);z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:12px;';
      const needConfirm = o.confirm === true;
      wrap.innerHTML = `
        <div style="background:#fff;border-radius:14px;padding:18px 18px 14px;width:min(360px,100%);box-shadow:0 12px 40px rgba(0,0,0,.28);box-sizing:border-box;">
          <div style="font-size:15px;font-weight:700;color:#1f2430;margin-bottom:6px;">${o.title || '加密口令'}</div>
          <div style="font-size:12px;color:#6b7280;line-height:1.7;margin-bottom:12px;">${o.hint || ''}</div>
          <input type="password" id="cbPwd" placeholder="${o.placeholder || '请输入口令'}" autocomplete="new-password"
                 style="width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #dfe3ea;border-radius:9px;font-size:13px;outline:none;">
          ${needConfirm ? '<input type="password" id="cbPwd2" placeholder="再输一次确认" autocomplete="new-password" style="width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #dfe3ea;border-radius:9px;font-size:13px;outline:none;margin-top:8px;">' : ''}
          <div id="cbErr" style="font-size:12px;color:#c62828;min-height:16px;margin-top:6px;"></div>
          <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button id="cbCancel" style="font-size:13px;padding:8px 14px;border:1px solid #dfe3ea;background:#fff;color:#4b5563;border-radius:9px;cursor:pointer;">取消</button>
            <button id="cbOk" style="font-size:13px;padding:8px 16px;border:none;background:#ff274b;color:#fff;border-radius:9px;cursor:pointer;font-weight:600;">${o.okText || '确定'}</button>
          </div>
        </div>`;
      document.body.appendChild(wrap);
      const $ = (id) => wrap.querySelector('#' + id);
      const pwd = $('cbPwd'), pwd2 = $('cbPwd2'), err = $('cbErr');
      setTimeout(() => pwd.focus(), 30);
      const close = (val) => { wrap.remove(); resolve(val); };
      $('cbCancel').onclick = () => close({ ok: false, password: '' });
      wrap.onclick = (e) => { if (e.target === wrap) close({ ok: false, password: '' }); };
      const submit = () => {
        const v = String(pwd.value || '');
        if (!v) { err.textContent = '口令不能为空'; return; }
        if (needConfirm && v.length < 6) { err.textContent = '建议至少 6 位（口令无法找回）'; return; }
        if (needConfirm && v !== String(pwd2.value || '')) { err.textContent = '两次输入不一致'; return; }
        close({ ok: true, password: v });
      };
      $('cbOk').onclick = submit;
      wrap.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') submit();
        if (e.key === 'Escape') close({ ok: false, password: '' });
      });
    });
  }

  const CryptoBox = {
    FMT, PREFIX, SALT_KEY,
    isLocked, lockText, unlockText, lockJSON, unlockJSON,
    encryptFile, isFileEnvelope, decryptFile,
    askPassword,
    ensureSalt,
    /** 测试用：注入固定盐（避免依赖 chrome.storage） */
    _setTestSalt(b64salt) {
      _testSalt = b64salt; _salt = b64salt; _saltPromise = null; _keyPromise = null;
    },
    _reset() { _salt = null; _saltPromise = null; _keyPromise = null; },
  };

  root.CryptoBox = CryptoBox;
  if (typeof module !== 'undefined') module.exports = CryptoBox;
})(typeof self !== 'undefined' ? self : this);
