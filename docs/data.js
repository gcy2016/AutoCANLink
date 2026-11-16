// 用户资料（配置包）：诊断问卷 + DBC 信号定义 + 控制器 / 安全算法等配置，全部由使用者自己导入，网页不内置任何车型资料。
// 配置包是一个 JSON 文件（tools 或他人按 canlink-pack/1 格式打包）：{ secrets: 加密包, data: 加密包 }，
// 加密方案 PBKDF2-SHA256 + AES-256-GCM（data 部分明文先 gzip），密码由使用者自己保管、不进仓库。
// 导入后配置包（密文）记在本机浏览器里，密码也记在本机时下次打开自动解锁；主页面和“离线数据”页共用。
(function (root) {
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function decrypt(enc, pin) {
    const k0 = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(enc.salt), iterations: enc.iter },
      k0, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    let pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, key, b64(enc.ct));
    if (enc.v === 2) pt = await new Response(new Blob([pt]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    return JSON.parse(new TextDecoder().decode(pt));
  }

  const PACK_KEY = 'canlink.pack', PIN_KEY = 'canlink.pin';
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 存不下就算了 */ } };
  const lsDel = k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } };

  function savedPack() {
    try { const p = JSON.parse(lsGet(PACK_KEY)); return (p && (p.secrets || p.data)) ? p : null; } catch (e) { return null; }
  }
  function savedPin() {
    try { return JSON.parse(lsGet(PIN_KEY)) || ''; } catch (e) { return ''; }
  }

  let cache = null;        // 解开的 data 部分 { models, dbcs }
  let secretsCache = null; // 解开的 secrets 部分 { ctrls / ctrl, secCode, tester, flow }
  let unlocking = null;

  // 用 pin 解开本机存着的配置包；成功返回 secrets 部分（可能为 null），失败抛错
  async function unlock(pin) {
    const pack = savedPack();
    if (!pack) throw new Error('本机还没有导入配置包');
    if (pack.data) cache = await decrypt(pack.data, pin);
    if (pack.secrets) secretsCache = await decrypt(pack.secrets, pin);
    lsSet(PIN_KEY, JSON.stringify(pin));
    return secretsCache;
  }

  // 本机记着密码时自动解开（主页面和离线页共用，只解一次）
  function autoUnlock() {
    if (cache || secretsCache) return Promise.resolve(secretsCache);
    if (!unlocking) {
      unlocking = (async () => {
        const pin = savedPin();
        if (!pin || !savedPack()) return null;
        try { return await unlock(pin); } catch (e) { return null; }
      })();
      unlocking.catch(() => { unlocking = null; });
    }
    return unlocking;
  }

  // 取用户资料 { models: [{ model, items, dbc }], dbcs: { 名字: DBC } }；没导入 / 没解锁就是 null（页面自己上传文件也能用）
  async function get() {
    if (!cache) await autoUnlock();
    return cache;
  }

  // 导入配置包文件内容（对象或 JSON 文本）；只存密文，密码随后用 unlock / 界面输入
  function storePack(pack) {
    if (typeof pack === 'string') pack = JSON.parse(pack);
    if (!pack || typeof pack !== 'object' || (!pack.secrets && !pack.data)) throw new Error('不是配置包文件（缺 secrets / data）');
    lsSet(PACK_KEY, JSON.stringify({ secrets: pack.secrets || null, data: pack.data || null }));
    cache = null; secretsCache = null; unlocking = null;
  }

  function clearPack() {
    lsDel(PACK_KEY); lsDel(PIN_KEY);
    cache = null; secretsCache = null; unlocking = null;
  }

  root.CanlinkData = {
    get, decrypt, unlock, autoUnlock, storePack, clearPack,
    hasPack: () => !!savedPack(),
    unlocked: () => !!(cache || secretsCache),
    secrets: () => secretsCache,
  };
})(globalThis);
