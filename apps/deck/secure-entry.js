'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const STORE_FILE = path.join(ROOT, 'security-store.json');
const STORE_SCHEMA = 1;
const ROLE_RANK = { guest: 0, operator: 1, advanced: 2, admin: 3 };
const pendingDeviceTokens = new Map();
const pairingCodes = new Map();
const loginFailures = new Map();

function nowIso() { return new Date().toISOString(); }
function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
function sha256(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
function normalizeRole(value, fallback = 'guest') {
  const role = String(value || '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(ROLE_RANK, role) ? role : fallback;
}
function safeText(value, max = 100) { return String(value || '').trim().replace(/[\x00-\x1f\x7f]/g, '').slice(0, max); }

function defaultStore() {
  return {
    schemaVersion: STORE_SCHEMA,
    installationId: crypto.randomUUID(),
    sessionSecret: randomToken(48),
    admin: { salt: '', hash: '', setAt: null },
    devices: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function atomicWrite(next = store) {
  next.updatedAt = nowIso();
  const tmp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, STORE_FILE);
}

function loadStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid');
    parsed.schemaVersion = STORE_SCHEMA;
    parsed.installationId = safeText(parsed.installationId, 120) || crypto.randomUUID();
    parsed.sessionSecret = safeText(parsed.sessionSecret, 200) || randomToken(48);
    parsed.admin = parsed.admin && typeof parsed.admin === 'object' ? parsed.admin : { salt:'', hash:'', setAt:null };
    parsed.devices = Array.isArray(parsed.devices) ? parsed.devices : [];
    return parsed;
  } catch (_) {
    const fresh = defaultStore();
    atomicWrite(fresh);
    console.log('[Security] security-store.json criado automaticamente.');
    return fresh;
  }
}

let store;
store = defaultStore();
store = loadStore();

function remoteIp(req) {
  let ip = String(req.socket?.remoteAddress || '').toLowerCase();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

function isLoopback(req) {
  const ip = remoteIp(req);
  return ip === '127.0.0.1' || ip === '::1';
}

function isPrivateLan(req) {
  const ip = remoteIp(req);
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (/^10\./.test(ip) || /^192\.168\./.test(ip) || /^169\.254\./.test(ip)) return true;
  const m = /^172\.(\d+)\./.exec(ip);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (/^(fc|fd)[0-9a-f]{2}:/.test(ip)) return true;
  return false;
}

function deviceIdFrom(req) {
  const id = safeText(req.headers['x-worship-device-id'], 120);
  return /^[a-zA-Z0-9._:-]{8,120}$/.test(id) ? id : '';
}

function findDevice(id) { return store.devices.find(item => item.id === id) || null; }

function touchDevice(req) {
  if (isLoopback(req)) return null;
  const id = deviceIdFrom(req);
  if (!id) return null;
  const name = safeText(req.headers['x-worship-device-name'], 80) || 'Dispositivo';
  const ip = remoteIp(req);
  const ua = safeText(req.headers['user-agent'], 240);
  let device = findDevice(id);
  let changed = false;
  if (!device) {
    device = {
      id, name, role: 'guest', trusted: false, tokenHash: '',
      firstSeenAt: nowIso(), lastSeenAt: nowIso(), lastSeenMs: Date.now(), ip, userAgent: ua,
    };
    store.devices.push(device);
    changed = true;
  } else {
    if (name && device.name !== name) { device.name = name; changed = true; }
    if (ip && device.ip !== ip) { device.ip = ip; changed = true; }
    if (ua && device.userAgent !== ua) { device.userAgent = ua; changed = true; }
    const previousMs = Number(device.lastSeenMs || 0);
    device.lastSeenMs = Date.now();
    device.lastSeenAt = nowIso();
    if (Date.now() - previousMs > 30000) changed = true;
  }
  if (changed) atomicWrite();
  return device;
}

function tokenMatches(device, token) {
  if (!device?.trusted || !device.tokenHash || !token) return false;
  const a = Buffer.from(device.tokenHash, 'hex');
  const b = Buffer.from(sha256(token), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', store.sessionSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifySession(token, deviceId) {
  try {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return null;
    const expected = crypto.createHmac('sha256', store.sessionSecret).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data || Number(data.exp || 0) <= Date.now()) return null;
    if (deviceId && data.deviceId !== deviceId) return null;
    return data;
  } catch (_) { return null; }
}

function identityFor(req) {
  if (isLoopback(req)) {
    return { deviceId: 'local-pc', name: os.hostname(), role: 'admin', trusted: true, loopback: true, source: 'loopback' };
  }
  const device = touchDevice(req);
  const deviceId = device?.id || deviceIdFrom(req);
  const persistent = safeText(req.headers['x-worship-device-token'], 500);
  if (device && tokenMatches(device, persistent)) {
    return { deviceId, name: device.name, role: normalizeRole(device.role), trusted: true, loopback: false, source: 'device' };
  }
  const session = verifySession(req.headers['x-worship-session'], deviceId);
  if (session) {
    return { deviceId, name: device?.name || 'Dispositivo', role: normalizeRole(session.role), trusted: false, loopback: false, source: 'session' };
  }
  return { deviceId, name: device?.name || 'Dispositivo', role: 'guest', trusted: false, loopback: false, source: 'guest' };
}

function hasRole(identity, minimum) {
  return (ROLE_RANK[normalizeRole(identity?.role)] || 0) >= (ROLE_RANK[minimum] || 0);
}

function routeMinimumRole(req) {
  const method = String(req.method || 'GET').toUpperCase();
  const pathname = new URL(req.url, 'http://local').pathname;
  if (!pathname.startsWith('/api/')) return 'guest';
  if (pathname === '/api/runtime' || pathname.startsWith('/api/security/')) return 'guest';
  if (method === 'GET' && (pathname === '/api/status' || pathname === '/api/config')) return 'guest';
  if (method === 'POST' && pathname === '/api/control') return 'operator';
  if (pathname === '/api/favorites' || pathname === '/api/favorite') return 'operator';
  if (pathname === '/api/obs/status' || pathname === '/api/obs/screenshot' || pathname === '/api/obs/scene') return 'operator';
  if (pathname === '/api/obs/reconnect') return 'advanced';
  if (pathname.startsWith('/api/automation')) return 'advanced';
  if (pathname.startsWith('/api/agents')) return 'advanced';
  if (pathname.startsWith('/api/config')) return method === 'GET' ? 'guest' : 'admin';
  if (pathname.startsWith('/api/network')) return 'admin';
  if (pathname.startsWith('/api/diagnostics')) return 'admin';
  if (pathname.startsWith('/api/profiles')) return 'admin';
  if (pathname.startsWith('/api/backup')) return 'admin';
  if (pathname.startsWith('/api/cloud')) return 'admin';
  return 'admin';
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJson(req, limit = 128 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > limit) {
        reject(new Error('Body muito grande'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (_) { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

function publicDevice(device) {
  return {
    id: device.id,
    name: device.name || 'Dispositivo',
    role: normalizeRole(device.role),
    trusted: Boolean(device.trusted),
    ip: device.ip || '',
    firstSeenAt: device.firstSeenAt || null,
    lastSeenAt: device.lastSeenAt || null,
    online: Date.now() - Number(device.lastSeenMs || 0) < 20000,
    userAgent: device.userAgent || '',
  };
}

function adminConfigured() { return Boolean(store.admin?.salt && store.admin?.hash); }
function hashPassword(password, salt) { return crypto.scryptSync(String(password), String(salt), 64).toString('hex'); }

function verifyPassword(password) {
  if (!adminConfigured()) return false;
  try {
    const actual = Buffer.from(hashPassword(password, store.admin.salt), 'hex');
    const expected = Buffer.from(store.admin.hash, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (_) { return false; }
}

function checkLoginRate(req) {
  const key = remoteIp(req) || 'unknown';
  const entry = loginFailures.get(key);
  if (!entry) return;
  if (Date.now() - entry.startedAt > 5 * 60 * 1000) { loginFailures.delete(key); return; }
  if (entry.count >= 5 && Date.now() - entry.lastAt < 60 * 1000) {
    const error = new Error('Muitas tentativas. Aguarde um minuto e tente novamente.');
    error.statusCode = 429;
    throw error;
  }
}

function markLoginFailure(req) {
  const key = remoteIp(req) || 'unknown';
  const current = loginFailures.get(key);
  if (!current || Date.now() - current.startedAt > 5 * 60 * 1000) {
    loginFailures.set(key, { count: 1, startedAt: Date.now(), lastAt: Date.now() });
  } else {
    current.count += 1;
    current.lastAt = Date.now();
  }
}
function clearLoginFailures(req) { loginFailures.delete(remoteIp(req) || 'unknown'); }

function requireAdmin(req) {
  const identity = identityFor(req);
  if (!hasRole(identity, 'admin')) {
    const error = new Error('Acesso administrativo necessário.');
    error.statusCode = 403;
    throw error;
  }
  return identity;
}

function issuePersistentDeviceToken(device, role) {
  const token = randomToken(32);
  device.trusted = true;
  device.role = normalizeRole(role, 'operator');
  device.tokenHash = sha256(token);
  device.approvedAt = nowIso();
  device.revokedAt = null;
  atomicWrite();
  return token;
}

function securityStatus(req) {
  const identity = identityFor(req);
  const pending = identity.deviceId ? pendingDeviceTokens.get(identity.deviceId) : null;
  if (pending) pendingDeviceTokens.delete(identity.deviceId);
  return {
    status: 'ok', installationId: store.installationId, adminPasswordConfigured: adminConfigured(),
    identity: { deviceId: identity.deviceId || '', name: identity.name || 'Dispositivo', role: identity.role, trusted: identity.trusted, loopback: identity.loopback, source: identity.source },
    permissions: { operate: hasRole(identity, 'operator'), advanced: hasRole(identity, 'advanced'), admin: hasRole(identity, 'admin') },
    claimToken: pending?.token || '', claimRole: pending?.role || '',
  };
}

function localPairUrls(req, code) {
  const port = Number(req.socket?.localPort || 4177);
  const found = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const item of entries || []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      const address = item.address;
      if (!/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(address)) continue;
      found.push(`http://${address}:${port}/?pair=${encodeURIComponent(code)}`);
    }
  }
  return [...new Set(found)];
}

async function handleSecurityApi(req, res) {
  const url = new URL(req.url, 'http://local');
  const pathname = url.pathname;
  if (pathname === '/api/runtime' && req.method === 'GET') {
    sendJson(res, 200, {
      kind: 'local', apiContractVersion: 1, apiBase: '',
      capabilities: { holyrics:true, favorites:true, obs:true, automation:true, bridge:true, youtube:true, localPreview:true, agents:true, profiles:true, backup:true, localAdmin:true, devicePairing:true },
    });
    return true;
  }
  if (!pathname.startsWith('/api/security/')) return false;
  if (!isPrivateLan(req)) {
    sendJson(res, 403, { status:'error', error:'Segurança local disponível apenas na rede da igreja.' });
    return true;
  }

  if (pathname === '/api/security/status' && req.method === 'GET') {
    sendJson(res, 200, securityStatus(req));
    return true;
  }

  if (pathname === '/api/security/admin/setup' && req.method === 'POST') {
    const body = await readJson(req);
    if (adminConfigured()) requireAdmin(req);
    else if (!isLoopback(req)) {
      sendJson(res, 403, { status:'error', error:'A primeira senha administrativa deve ser criada no PC do Worship Deck.' });
      return true;
    }
    const password = String(body.password || '');
    if (password.length < 6 || password.length > 128) {
      sendJson(res, 400, { status:'error', error:'A senha deve ter entre 6 e 128 caracteres.' });
      return true;
    }
    const salt = randomToken(24);
    store.admin = { salt, hash: hashPassword(password, salt), setAt: nowIso() };
    store.sessionSecret = randomToken(48);
    atomicWrite();
    sendJson(res, 200, { status:'ok', adminPasswordConfigured:true });
    return true;
  }

  if (pathname === '/api/security/unlock' && req.method === 'POST') {
    checkLoginRate(req);
    if (!adminConfigured()) {
      sendJson(res, 409, { status:'error', error:'A senha administrativa ainda não foi criada no PC.' });
      return true;
    }
    const body = await readJson(req);
    const password = String(body.password || '');
    if (!verifyPassword(password)) {
      markLoginFailure(req);
      sendJson(res, 401, { status:'error', error:'Senha administrativa incorreta.' });
      return true;
    }
    clearLoginFailures(req);
    const device = touchDevice(req);
    const deviceId = device?.id || deviceIdFrom(req);
    if (!deviceId) {
      sendJson(res, 400, { status:'error', error:'Este navegador ainda não informou a identidade do dispositivo.' });
      return true;
    }
    const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
    const sessionToken = signSession({ deviceId, role:'admin', exp:expiresAt, nonce:randomToken(8) });
    sendJson(res, 200, { status:'ok', sessionToken, expiresAt, role:'admin' });
    return true;
  }

  if (pathname === '/api/security/devices' && req.method === 'GET') {
    requireAdmin(req);
    const devices = store.devices.map(publicDevice).sort((a,b) => Number(b.online)-Number(a.online) || String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')));
    sendJson(res, 200, { status:'ok', devices });
    return true;
  }

  if (pathname === '/api/security/devices/approve' && req.method === 'POST') {
    requireAdmin(req);
    const body = await readJson(req);
    const id = safeText(body.deviceId, 120);
    const role = normalizeRole(body.role, 'operator');
    if (role === 'guest') { sendJson(res, 400, { status:'error', error:'Escolha Operador, Avançado ou Admin.' }); return true; }
    const device = findDevice(id);
    if (!device) { sendJson(res, 404, { status:'error', error:'Dispositivo não encontrado. Abra o Worship Deck nele primeiro.' }); return true; }
    if (body.name) device.name = safeText(body.name, 80) || device.name;
    const token = issuePersistentDeviceToken(device, role);
    pendingDeviceTokens.set(device.id, { token, role:device.role, createdAt:Date.now() });
    sendJson(res, 200, { status:'ok', device:publicDevice(device), waitingForClaim:true });
    return true;
  }

  if (pathname === '/api/security/devices/role' && req.method === 'POST') {
    requireAdmin(req);
    const body = await readJson(req);
    const device = findDevice(safeText(body.deviceId, 120));
    if (!device) { sendJson(res, 404, {status:'error', error:'Dispositivo não encontrado.'}); return true; }
    const role = normalizeRole(body.role, device.role || 'operator');
    if (role === 'guest') { sendJson(res, 400, {status:'error', error:'Use REVOGAR para remover o acesso.'}); return true; }
    device.role = role;
    if (body.name) device.name = safeText(body.name, 80) || device.name;
    atomicWrite();
    sendJson(res, 200, { status:'ok', device:publicDevice(device) });
    return true;
  }

  if (pathname === '/api/security/devices/revoke' && req.method === 'POST') {
    requireAdmin(req);
    const body = await readJson(req);
    const device = findDevice(safeText(body.deviceId, 120));
    if (!device) { sendJson(res, 404, {status:'error', error:'Dispositivo não encontrado.'}); return true; }
    device.trusted = false; device.role = 'guest'; device.tokenHash = ''; device.revokedAt = nowIso();
    pendingDeviceTokens.delete(device.id); atomicWrite();
    sendJson(res, 200, { status:'ok', device:publicDevice(device) });
    return true;
  }

  if (pathname === '/api/security/pair/create' && req.method === 'POST') {
    requireAdmin(req);
    const body = await readJson(req);
    const role = normalizeRole(body.role, 'operator');
    if (role === 'guest') { sendJson(res, 400, {status:'error', error:'Escolha um perfil de acesso.'}); return true; }
    let code;
    do { code = crypto.randomBytes(5).toString('base64url').replace(/[^A-Z0-9]/gi, '').slice(0, 8).toUpperCase(); } while (pairingCodes.has(code));
    const expiresAt = Date.now() + 2 * 60 * 1000;
    pairingCodes.set(code, { role, expiresAt, createdBy:identityFor(req).deviceId || 'local-pc' });
    const urls = localPairUrls(req, code);
    sendJson(res, 200, { status:'ok', code, role, expiresAt, urls, qrText:urls[0] || code });
    return true;
  }

  if (pathname === '/api/security/pair/redeem' && req.method === 'POST') {
    const body = await readJson(req);
    const code = safeText(body.code, 20).toUpperCase();
    const pair = pairingCodes.get(code);
    if (!pair || pair.expiresAt <= Date.now()) {
      pairingCodes.delete(code);
      sendJson(res, 410, { status:'error', error:'Código de pareamento inválido ou expirado.' });
      return true;
    }
    const device = touchDevice(req);
    if (!device) { sendJson(res, 400, {status:'error', error:'Identidade do dispositivo ausente.'}); return true; }
    pairingCodes.delete(code);
    const token = issuePersistentDeviceToken(device, pair.role);
    sendJson(res, 200, { status:'ok', device:publicDevice(device), deviceToken:token });
    return true;
  }

  sendJson(res, 404, { status:'error', error:'Rota de segurança não encontrada.' });
  return true;
}

function authorizeApi(req, res) {
  const pathname = new URL(req.url, 'http://local').pathname;
  if (!pathname.startsWith('/api/')) return true;
  const required = routeMinimumRole(req);
  const identity = identityFor(req);
  if (hasRole(identity, required)) return true;
  sendJson(res, 403, {
    status:'error', code:'WORSHIP_AUTH_REQUIRED',
    error: required === 'operator' ? 'Este dispositivo ainda não tem permissão para operar o Worship Deck.' : required === 'advanced' ? 'Esta área exige permissão Avançado ou Admin.' : 'Esta área exige permissão de Administrador.',
    requiredRole: required, role: identity.role, trusted: identity.trusted,
  });
  return false;
}

function serveInjectedIndex(req, res) {
  if (String(req.method || 'GET').toUpperCase() !== 'GET') return false;
  const url = new URL(req.url, 'http://local');
  if (url.pathname !== '/') return false;
  try {
    let html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
    if (!html.includes('src="/runtime.js"')) html = html.replace('<script src="/app.js" defer></script>', '<script src="/runtime.js" defer></script>\n  <script src="/app.js" defer></script>');
    if (!html.includes('src="/security.js"')) html = html.replace('<script src="/app.js" defer></script>', '<script src="/security.js" defer></script>\n  <script src="/app.js" defer></script>');
    res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8', 'Content-Length':Buffer.byteLength(html), 'Cache-Control':'no-store' });
    res.end(html); return true;
  } catch (_) { return false; }
}

const originalCreateServer = http.createServer.bind(http);
http.createServer = function securedCreateServer(options, requestListener) {
  let listener = requestListener; let opts = options;
  if (typeof options === 'function') { listener = options; opts = undefined; }
  if (typeof listener !== 'function') return originalCreateServer(options, requestListener);
  const wrapped = async (req, res) => {
    try {
      if (await handleSecurityApi(req, res)) return;
      if (serveInjectedIndex(req, res)) return;
      if (!authorizeApi(req, res)) return;
      return listener(req, res);
    } catch (error) {
      if (res.headersSent) return res.end();
      return sendJson(res, Number(error.statusCode || 500), { status:'error', error:error.message || 'Erro de segurança' });
    }
  };
  return opts === undefined ? originalCreateServer(wrapped) : originalCreateServer(opts, wrapped);
};

console.log('[Security] Pareamento por dispositivo habilitado.');
require('./server.js');
