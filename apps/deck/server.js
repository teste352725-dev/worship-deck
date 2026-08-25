const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const dgram = require('dgram');
const https = require('https');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const PROFILES_DIR = path.join(ROOT, 'profiles');
const VERSION = '3.0.0-alpha.4-rc';
try { fs.mkdirSync(PROFILES_DIR, { recursive: true }); } catch {}

const DEFAULT_CONFIG = {
  holyricsHost: '127.0.0.1',
  holyricsPort: 8091,
  token: '',
  deckPort: 4177,
  pluginHost: '127.0.0.1',
  pluginPort: 2026,
  previewMode: 'widescreen',
  obsHost: '127.0.0.1',
  obsPort: 4455,
  obsPassword: '',
  automationEnabled: false,
  autoSongScene: '',
  autoVerseScene: '',
  autoNoneScene: '',
  favoriteSceneMap: {},
  cloudEnabled: false,
  cloudBaseUrl: '',
  cloudBridgeSecret: '',
  cloudLastCommandSeq: 0,
  obsAutoDiscover: false,
  obsAgentId: '',
  mobileTheme: 'dark',
  mobilePortraitCols: 2,
  mobilePortraitRows: 3,
  mobileLandscapeCols: 5,
  mobileLandscapeRows: 2,
  mobileDefaultView: 'controls',
  mobileShowTabs: true,
  mobileMonitorMode: 'none',
  youtubeVideoId: '',
  mobileControlStyles: {},
  mobileFavoriteStyles: {},
  mobileObsStyles: {},
  activeProfile: 'Principal',
  onboardingComplete: false,
};


// -----------------------------------------------------------------------------
// Bootstrap da instalação
// Cria automaticamente os arquivos/pastas locais que não existirem.
// Arquivos existentes NUNCA são substituídos por esta rotina.
// -----------------------------------------------------------------------------
function bootstrapRuntime() {
  const dirs = [
    PROFILES_DIR,
    path.join(ROOT, 'backups'),
    path.join(ROOT, 'plugins'),
    path.join(ROOT, 'logs'),
  ];
  for (const dir of dirs) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  }

  if (!fs.existsSync(CONFIG_FILE)) {
    const firstConfig = {
      ...DEFAULT_CONFIG,
      configSchemaVersion: 1,
      installationCreatedAt: new Date().toISOString(),
    };
    const tmp = `${CONFIG_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(firstConfig, null, 2), 'utf8');
    fs.renameSync(tmp, CONFIG_FILE);
    console.log('[Bootstrap] config.json criado automaticamente para esta instalação.');
  }
}

bootstrapRuntime();

const ALLOWED_ACTIONS = new Set([
  'ActionNext',
  'ActionPrevious',
  'CloseCurrentPresentation',
  'GetCurrentPresentation',
  'GetF8', 'GetF9', 'GetF10',
  'SetF8', 'SetF9', 'SetF10',
  'GetFavorites', 'FavoriteAction',
]);


function sanitizeStyleMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [rawKey, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const key = String(rawKey).slice(0, 200);
    const entry = {};
    if (Object.prototype.hasOwnProperty.call(raw, 'label')) entry.label = String(raw.label || '').slice(0, 80);
    if (Object.prototype.hasOwnProperty.call(raw, 'icon')) entry.icon = String(raw.icon || '').slice(0, 16);
    if (Object.prototype.hasOwnProperty.call(raw, 'color')) {
      const color = String(raw.color || '').trim();
      if (/^#[0-9a-fA-F]{6}$/.test(color)) entry.color = color;
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'hidden')) entry.hidden = Boolean(raw.hidden);
    if (Object.prototype.hasOwnProperty.call(raw, 'order')) entry.order = Math.max(-999, Math.min(9999, Number(raw.order || 0)));
    out[key] = entry;
  }
  return out;
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function loadConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(next) {
  const current = loadConfig();
  const merged = {
    ...current,
    holyricsHost: String(next.holyricsHost || current.holyricsHost).trim(),
    holyricsPort: Number(next.holyricsPort || current.holyricsPort),
    pluginHost: String(next.pluginHost || current.pluginHost || '127.0.0.1').trim(),
    pluginPort: Number(next.pluginPort || current.pluginPort || 2026),
    previewMode: ['widescreen','standard','text','text2','text3','multiview'].includes(next.previewMode)
      ? next.previewMode
      : (current.previewMode || 'widescreen'),
    obsHost: String(next.obsHost || current.obsHost || '127.0.0.1').trim(),
    obsPort: Number(next.obsPort || current.obsPort || 4455),
    token: typeof next.token === 'string' && next.token.length ? next.token.trim() : current.token,
    obsPassword: typeof next.obsPassword === 'string' && next.obsPassword.length ? next.obsPassword : current.obsPassword,
    automationEnabled: typeof next.automationEnabled === 'boolean' ? next.automationEnabled : Boolean(current.automationEnabled),
    autoSongScene: Object.prototype.hasOwnProperty.call(next, 'autoSongScene') ? String(next.autoSongScene || '').trim() : String(current.autoSongScene || ''),
    autoVerseScene: Object.prototype.hasOwnProperty.call(next, 'autoVerseScene') ? String(next.autoVerseScene || '').trim() : String(current.autoVerseScene || ''),
    autoNoneScene: Object.prototype.hasOwnProperty.call(next, 'autoNoneScene') ? String(next.autoNoneScene || '').trim() : String(current.autoNoneScene || ''),
    favoriteSceneMap: (next.favoriteSceneMap && typeof next.favoriteSceneMap === 'object' && !Array.isArray(next.favoriteSceneMap))
      ? Object.fromEntries(Object.entries(next.favoriteSceneMap).map(([k,v]) => [String(k), String(v || '').trim()]).filter(([,v]) => v))
      : (current.favoriteSceneMap && typeof current.favoriteSceneMap === 'object' ? current.favoriteSceneMap : {}),
    cloudEnabled: typeof next.cloudEnabled === 'boolean' ? next.cloudEnabled : Boolean(current.cloudEnabled),
    cloudBaseUrl: Object.prototype.hasOwnProperty.call(next, 'cloudBaseUrl') ? String(next.cloudBaseUrl || '').trim().replace(/\/$/, '') : String(current.cloudBaseUrl || ''),
    cloudBridgeSecret: typeof next.cloudBridgeSecret === 'string' && next.cloudBridgeSecret.length ? next.cloudBridgeSecret : String(current.cloudBridgeSecret || ''),
    cloudLastCommandSeq: Object.prototype.hasOwnProperty.call(next, 'cloudLastCommandSeq') ? Math.max(0, Number(next.cloudLastCommandSeq || 0)) : Math.max(0, Number(current.cloudLastCommandSeq || 0)),
    obsAutoDiscover: typeof next.obsAutoDiscover === 'boolean' ? next.obsAutoDiscover : Boolean(current.obsAutoDiscover),
    obsAgentId: Object.prototype.hasOwnProperty.call(next, 'obsAgentId') ? String(next.obsAgentId || '').trim().slice(0, 120) : String(current.obsAgentId || ''),
    mobileTheme: ['dark','light','system'].includes(next.mobileTheme) ? next.mobileTheme : (['dark','light','system'].includes(current.mobileTheme) ? current.mobileTheme : 'dark'),
    mobilePortraitCols: clampInt(Object.prototype.hasOwnProperty.call(next, 'mobilePortraitCols') ? next.mobilePortraitCols : current.mobilePortraitCols, 2, 1, 6),
    mobilePortraitRows: clampInt(Object.prototype.hasOwnProperty.call(next, 'mobilePortraitRows') ? next.mobilePortraitRows : current.mobilePortraitRows, 3, 1, 8),
    mobileLandscapeCols: clampInt(Object.prototype.hasOwnProperty.call(next, 'mobileLandscapeCols') ? next.mobileLandscapeCols : current.mobileLandscapeCols, 5, 1, 8),
    mobileLandscapeRows: clampInt(Object.prototype.hasOwnProperty.call(next, 'mobileLandscapeRows') ? next.mobileLandscapeRows : current.mobileLandscapeRows, 2, 1, 6),
    mobileDefaultView: ['controls','favorites','obs','now','panel'].includes(next.mobileDefaultView) ? next.mobileDefaultView : (['controls','favorites','obs','now','panel'].includes(current.mobileDefaultView) ? current.mobileDefaultView : 'controls'),
    mobileShowTabs: typeof next.mobileShowTabs === 'boolean' ? next.mobileShowTabs : (current.mobileShowTabs !== false),
    mobileMonitorMode: ['none','holyrics','obs','youtube'].includes(next.mobileMonitorMode) ? next.mobileMonitorMode : (['none','holyrics','obs','youtube'].includes(current.mobileMonitorMode) ? current.mobileMonitorMode : 'none'),
    youtubeVideoId: Object.prototype.hasOwnProperty.call(next, 'youtubeVideoId') ? String(next.youtubeVideoId || '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) : String(current.youtubeVideoId || ''),
    mobileControlStyles: Object.prototype.hasOwnProperty.call(next, 'mobileControlStyles') ? sanitizeStyleMap(next.mobileControlStyles) : sanitizeStyleMap(current.mobileControlStyles),
    mobileFavoriteStyles: Object.prototype.hasOwnProperty.call(next, 'mobileFavoriteStyles') ? sanitizeStyleMap(next.mobileFavoriteStyles) : sanitizeStyleMap(current.mobileFavoriteStyles),
    mobileObsStyles: Object.prototype.hasOwnProperty.call(next, 'mobileObsStyles') ? sanitizeStyleMap(next.mobileObsStyles) : sanitizeStyleMap(current.mobileObsStyles),
    activeProfile: Object.prototype.hasOwnProperty.call(next, 'activeProfile') ? String(next.activeProfile || 'Principal').trim().slice(0, 80) : String(current.activeProfile || 'Principal'),
    onboardingComplete: typeof next.onboardingComplete === 'boolean' ? next.onboardingComplete : Boolean(current.onboardingComplete),
  };
  if (next.clearToken === true) merged.token = '';
  if (next.clearObsPassword === true) merged.obsPassword = '';
  if (next.clearCloudBridgeSecret === true) merged.cloudBridgeSecret = '';
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
  return merged;
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error('Body muito grande'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}


function isLoopbackRequest(req) {
  const addr = String(req.socket?.remoteAddress || '');
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function isPrivateLanRequest(req) {
  let addr = String(req.socket?.remoteAddress || '').toLowerCase();
  if (addr.startsWith('::ffff:')) addr = addr.slice(7);
  if (addr === '::1' || addr === '127.0.0.1') return true;
  if (/^10\./.test(addr)) return true;
  if (/^192\.168\./.test(addr)) return true;
  const m = /^172\.(\d+)\./.exec(addr);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (/^169\.254\./.test(addr)) return true;
  if (/^(fc|fd)[0-9a-f]{2}:/.test(addr)) return true;
  return false;
}

function requireLocalAdmin(req) {
  if (!isPrivateLanRequest(req)) throw new Error('Esta ação administrativa só pode ser executada no PC do Worship Deck ou na rede local da igreja.');
}

function safeProfileName(value) {
  const name = String(value || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\.+$/g, '').slice(0, 60);
  if (!name) throw new Error('Informe um nome para o perfil.');
  return name;
}

function profilePath(name) {
  const safe = safeProfileName(name);
  return path.join(PROFILES_DIR, `${safe}.json`);
}

function listProfiles() {
  try {
    return fs.readdirSync(PROFILES_DIR)
      .filter(name => name.toLowerCase().endsWith('.json'))
      .map(file => {
        const full = path.join(PROFILES_DIR, file);
        let data = {};
        try { data = JSON.parse(fs.readFileSync(full, 'utf8')); } catch {}
        const stat = fs.statSync(full);
        return {
          name: String(data.profileName || path.basename(file, '.json')),
          updatedAt: stat.mtime.toISOString(),
        };
      })
      .sort((a,b) => a.name.localeCompare(b.name, 'pt-BR'));
  } catch { return []; }
}

function writeProfile(name, config = loadConfig()) {
  const safe = safeProfileName(name);
  const snapshot = { ...config, activeProfile: safe };
  fs.writeFileSync(profilePath(safe), JSON.stringify({ profileName: safe, config: snapshot }, null, 2));
  return safe;
}

function readProfile(name) {
  const safe = safeProfileName(name);
  const parsed = JSON.parse(fs.readFileSync(profilePath(safe), 'utf8'));
  const cfg = parsed?.config && typeof parsed.config === 'object' ? parsed.config : parsed;
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('Perfil inválido.');
  return { name: safe, config: cfg };
}

function publicConfig(cfg = loadConfig()) {
  const effective = effectiveObsConfig();
  return {
    version: VERSION,
    holyricsHost: cfg.holyricsHost,
    holyricsPort: cfg.holyricsPort,
    pluginHost: cfg.pluginHost || '127.0.0.1',
    pluginPort: cfg.pluginPort,
    previewMode: cfg.previewMode,
    tokenConfigured: Boolean(cfg.token),
    obsHost: cfg.obsHost || '127.0.0.1',
    obsPort: cfg.obsPort || 4455,
    obsPasswordConfigured: Boolean(cfg.obsPassword),
    automationEnabled: Boolean(cfg.automationEnabled),
    autoSongScene: cfg.autoSongScene || '',
    autoVerseScene: cfg.autoVerseScene || '',
    autoNoneScene: cfg.autoNoneScene || '',
    cloudEnabled: Boolean(cfg.cloudEnabled),
    cloudBaseUrl: cfg.cloudBaseUrl || '',
    cloudBridgeSecretConfigured: Boolean(cfg.cloudBridgeSecret),
    obsAutoDiscover: Boolean(cfg.obsAutoDiscover),
    obsAgentId: cfg.obsAgentId || '',
    effectiveObs: effective.discovered ? { host: effective.host, port: effective.port, agent: effective.discovered } : null,
    mobileTheme: cfg.mobileTheme || 'dark',
    mobilePortraitCols: cfg.mobilePortraitCols || 2,
    mobilePortraitRows: cfg.mobilePortraitRows || 3,
    mobileLandscapeCols: cfg.mobileLandscapeCols || 5,
    mobileLandscapeRows: cfg.mobileLandscapeRows || 2,
    mobileDefaultView: cfg.mobileDefaultView || 'controls',
    mobileShowTabs: cfg.mobileShowTabs !== false,
    mobileMonitorMode: cfg.mobileMonitorMode || 'none',
    youtubeVideoId: cfg.youtubeVideoId || '',
    mobileControlStyles: cfg.mobileControlStyles || {},
    mobileFavoriteStyles: cfg.mobileFavoriteStyles || {},
    mobileObsStyles: cfg.mobileObsStyles || {},
    activeProfile: cfg.activeProfile || 'Principal',
    onboardingComplete: Boolean(cfg.onboardingComplete),
  };
}

function configForBackup(cfg, includeSecrets) {
  const copy = JSON.parse(JSON.stringify(cfg || {}));
  if (!includeSecrets) {
    delete copy.token;
    delete copy.obsPassword;
    delete copy.cloudBridgeSecret;
    copy.secretsExcluded = true;
  }
  return copy;
}

function sendJsonDownload(res, filename, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function tcpProbe(host, port, timeoutMs = 1600) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const socket = net.createConnection({ host, port: Number(port) });
    const done = (error) => {
      socket.destroy();
      if (error) reject(error); else resolve(Date.now() - started);
    };
    socket.setTimeout(timeoutMs, () => done(new Error('Tempo esgotado')));
    socket.once('connect', () => done());
    socket.once('error', done);
  });
}

async function diagnosticItem(id, label, fn, options = {}) {
  const started = Date.now();
  try {
    const detail = await fn();
    return { id, label, status: options.status || 'online', detail: String(detail || 'OK'), latencyMs: Date.now() - started };
  } catch (error) {
    return { id, label, status: 'offline', detail: error?.message || String(error), latencyMs: Date.now() - started };
  }
}

async function runDiagnostics() {
  const cfg = loadConfig();
  const effective = effectiveObsConfig();
  const agents = activeAgents();
  const localAddresses = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const item of entries || []) if (item.family === 'IPv4' && !item.internal) localAddresses.push(`${name}: ${item.address}`);
  }

  const [holyrics, plugin, obs, web] = await Promise.all([
    diagnosticItem('holyrics', 'Holyrics API', async () => {
      const st = await getHolyricsStatus();
      return st.presentation?.name ? `Online • ${st.presentation.name}` : 'Online • sem apresentação';
    }),
    diagnosticItem('plugin', 'Plugin / Preview Holyrics', async () => {
      const ms = await tcpProbe(cfg.pluginHost || '127.0.0.1', cfg.pluginPort || 2026);
      return `Online em ${cfg.pluginHost || '127.0.0.1'}:${cfg.pluginPort || 2026} • ${ms} ms`;
    }),
    diagnosticItem('obs', 'OBS WebSocket', async () => {
      const st = await getObsState();
      return `${st.currentProgramSceneName || 'Sem cena'} • ${effective.host}:${effective.port}${effective.discovered ? ` • Agent ${effective.discovered.name}` : ''}`;
    }),
    cfg.cloudEnabled
      ? diagnosticItem('web', 'Worship Deck Web / Bridge', async () => {
          await cloudRequest(`/api/bridge/pull?after=${encodeURIComponent(Math.max(0, Number(cfg.cloudLastCommandSeq || 0)))}`, 'GET');
          return cfg.cloudBaseUrl || 'Web conectada';
        })
      : Promise.resolve({ id:'web', label:'Worship Deck Web / Bridge', status:'disabled', detail:'Desativado nas Configurações', latencyMs:0 }),
  ]);

  const agent = cfg.obsAutoDiscover
    ? (effective.discovered
        ? { id:'agent', label:'Worship Agent', status:'online', detail:`${effective.discovered.name} • ${effective.discovered.address}:${effective.discovered.obsPort}`, latencyMs:0 }
        : { id:'agent', label:'Worship Agent', status:'offline', detail:'Descoberta automática ativa, mas nenhum Agent está disponível.', latencyMs:0 })
    : { id:'agent', label:'Worship Agent', status: agents.length ? 'warning' : 'disabled', detail: agents.length ? `${agents.length} Agent(s) detectado(s), mas descoberta automática está desligada.` : 'Descoberta automática desativada.', latencyMs:0 };

  return {
    status: 'ok',
    version: VERSION,
    checkedAt: new Date().toISOString(),
    services: [holyrics, plugin, obs, agent, web],
    system: {
      hostname: os.hostname(),
      platform: `${os.platform()} ${os.release()}`,
      node: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      addresses: localAddresses,
      activeProfile: cfg.activeProfile || 'Principal',
    },
  };
}

// -----------------------------------------------------------------------------
// Holyrics Local API
// -----------------------------------------------------------------------------
function holyricsRequest(action, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!ALLOWED_ACTIONS.has(action)) return reject(new Error('Ação não permitida pelo Deck'));

    const cfg = loadConfig();
    if (!cfg.token) return reject(new Error('Configure o token do Holyrics no botão Configurações.'));

    const body = JSON.stringify(payload || {});
    const queryToken = encodeURIComponent(cfg.token);
    const options = {
      hostname: cfg.holyricsHost,
      port: cfg.holyricsPort,
      path: `/api/${encodeURIComponent(action)}?token=${queryToken}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 2500,
    };

    const request = http.request(options, response => {
      let responseBody = '';
      response.on('data', chunk => responseBody += chunk);
      response.on('end', () => {
        let parsed;
        try { parsed = responseBody ? JSON.parse(responseBody) : { status: 'ok' }; }
        catch { parsed = { status: 'error', error: `Resposta inválida do Holyrics: ${responseBody.slice(0, 120)}` }; }

        if (response.statusCode >= 400 || parsed.status === 'error') {
          const detail = typeof parsed.error === 'string'
            ? parsed.error
            : parsed.error?.message || parsed.error?.key || `HTTP ${response.statusCode}`;
          return reject(new Error(detail));
        }
        resolve(parsed);
      });
    });

    request.on('timeout', () => request.destroy(new Error('Tempo esgotado ao conectar com o Holyrics.')));
    request.on('error', err => reject(new Error(`Não foi possível acessar ${cfg.holyricsHost}:${cfg.holyricsPort} — ${err.message}`)));
    request.write(body);
    request.end();
  });
}

async function getHolyricsStatus() {
  const [presentation, f8, f9, f10] = await Promise.all([
    holyricsRequest('GetCurrentPresentation', { include_slides: true, include_slide_comment: false }),
    holyricsRequest('GetF8', {}),
    holyricsRequest('GetF9', {}),
    holyricsRequest('GetF10', {}),
  ]);
  return {
    connected: true,
    presentation: presentation.data ?? null,
    f8: Boolean(f8.data),
    f9: Boolean(f9.data),
    f10: Boolean(f10.data),
  };
}

async function getFavorites() {
  const result = await holyricsRequest('GetFavorites', {});
  return Array.isArray(result.data) ? result.data : [];
}

async function runControl(body) {
  const cmd = body.command;
  switch (cmd) {
    case 'previous': return holyricsRequest('ActionPrevious', {});
    case 'next': return holyricsRequest('ActionNext', {});
    case 'close': return holyricsRequest('CloseCurrentPresentation', {});
    case 'wallpaper':
      await holyricsRequest('SetF9', { enable: false });
      await holyricsRequest('SetF10', { enable: false });
      return holyricsRequest('SetF8', { enable: true });
    case 'blank':
      await holyricsRequest('SetF8', { enable: false });
      await holyricsRequest('SetF10', { enable: false });
      return holyricsRequest('SetF9', { enable: true });
    case 'black':
      await holyricsRequest('SetF8', { enable: false });
      await holyricsRequest('SetF9', { enable: false });
      return holyricsRequest('SetF10', { enable: true });
    case 'normal':
      await holyricsRequest('SetF8', { enable: false });
      await holyricsRequest('SetF9', { enable: false });
      return holyricsRequest('SetF10', { enable: false });
    default:
      throw new Error('Comando desconhecido');
  }
}


// -----------------------------------------------------------------------------
// Worship Agent discovery (LAN). The Agent only announces its identity and OBS
// WebSocket port. Passwords/tokens are never broadcast.
// -----------------------------------------------------------------------------
const AGENT_DISCOVERY_PORT = 4178;
const AGENT_MULTICAST = '239.255.47.77';
const discoveredAgents = new Map();
let discoverySocket = null;

function activeAgents() {
  const now = Date.now();
  const list = [];
  for (const [id, agent] of discoveredAgents) {
    if (now - agent.lastSeen > 9000) {
      discoveredAgents.delete(id);
      continue;
    }
    list.push({ ...agent, ageMs: now - agent.lastSeen });
  }
  return list.sort((a,b) => String(a.name).localeCompare(String(b.name)));
}

function startAgentDiscovery() {
  try {
    discoverySocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    discoverySocket.on('message', (message, rinfo) => {
      try {
        const data = JSON.parse(message.toString('utf8'));
        if (data?.type !== 'worship-agent-v1' || !data.id) return;
        discoveredAgents.set(String(data.id), {
          id: String(data.id),
          name: String(data.name || 'PC OBS'),
          address: rinfo.address,
          obsPort: clampInt(data.obsPort, 4455, 1, 65535),
          obsVersion: String(data.obsVersion || ''),
          agentVersion: String(data.agentVersion || '3.0-alpha'),
          lastSeen: Date.now(),
        });
      } catch {}
    });
    discoverySocket.on('error', () => {});
    discoverySocket.bind(AGENT_DISCOVERY_PORT, '0.0.0.0', () => {
      try { discoverySocket.addMembership(AGENT_MULTICAST); } catch {}
    });
  } catch {}
}

function effectiveObsConfig() {
  const cfg = loadConfig();
  let host = String(cfg.obsHost || '127.0.0.1').trim();
  let port = Number(cfg.obsPort || 4455);
  let discovered = null;
  if (cfg.obsAutoDiscover) {
    const agents = activeAgents();
    discovered = agents.find(a => a.id === cfg.obsAgentId) || (cfg.obsAgentId ? null : agents[0]) || null;
    if (discovered) {
      host = discovered.address;
      port = discovered.obsPort || port;
    }
  }
  return { host, port, password: String(cfg.obsPassword || ''), discovered };
}

// -----------------------------------------------------------------------------
// Tiny WebSocket client (RFC 6455) + OBS WebSocket 5.x RPC.
// Sem dependências externas: continua bastando ter Node.js instalado.
// -----------------------------------------------------------------------------
class TinyObsWebSocketClient {
  constructor() {
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.state = 'closed';
    this.connectPromise = null;
    this.connectResolve = null;
    this.connectReject = null;
    this.pending = new Map();
    this.hello = null;
    this.configKey = '';
    this.fragmentOpcode = null;
    this.fragmentChunks = [];
  }

  currentConfig() {
    return effectiveObsConfig();
  }

  async ensureConnected() {
    const cfg = this.currentConfig();
    const nextKey = `${cfg.host}:${cfg.port}:${cfg.password}`;
    if (this.state === 'identified' && this.socket && !this.socket.destroyed && this.configKey === nextKey) return;
    if (this.connectPromise && this.configKey === nextKey) return this.connectPromise;
    this.disconnect();
    this.configKey = nextKey;
    this.state = 'connecting';
    this.connectPromise = new Promise((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
    });

    const socket = net.createConnection({ host: cfg.host, port: cfg.port });
    this.socket = socket;
    socket.setNoDelay(true);
    socket.setTimeout(5000);

    const wsKey = crypto.randomBytes(16).toString('base64');
    const expectedAccept = crypto.createHash('sha1')
      .update(wsKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    let handshakeDone = false;
    let handshakeBuffer = Buffer.alloc(0);

    const fail = (error) => {
      const err = error instanceof Error ? error : new Error(String(error));
      if (this.connectReject) this.connectReject(err);
      this.connectResolve = null;
      this.connectReject = null;
      this.connectPromise = null;
      this.state = 'closed';
      try { socket.destroy(); } catch {}
    };

    socket.once('connect', () => {
      const request = [
        'GET / HTTP/1.1',
        `Host: ${cfg.host}:${cfg.port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${wsKey}`,
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Protocol: obswebsocket.json',
        '\r\n',
      ].join('\r\n');
      socket.write(request);
    });

    socket.on('data', chunk => {
      if (!handshakeDone) {
        handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
        const split = handshakeBuffer.indexOf('\r\n\r\n');
        if (split === -1) return;

        const headerText = handshakeBuffer.subarray(0, split).toString('utf8');
        const rest = handshakeBuffer.subarray(split + 4);
        const lines = headerText.split('\r\n');
        if (!/^HTTP\/1\.1 101\b/.test(lines[0] || '')) {
          return fail(new Error(`OBS recusou o WebSocket (${lines[0] || 'resposta inválida'}).`));
        }
        const headers = {};
        for (const line of lines.slice(1)) {
          const idx = line.indexOf(':');
          if (idx > 0) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
        }
        if (headers['sec-websocket-accept'] !== expectedAccept) {
          return fail(new Error('Handshake WebSocket inválido recebido do OBS.'));
        }
        handshakeDone = true;
        socket.setTimeout(0);
        this.state = 'hello';
        if (rest.length) this._receiveFrames(rest, cfg);
        return;
      }
      this._receiveFrames(chunk, cfg);
    });

    socket.on('timeout', () => fail(new Error(`Tempo esgotado ao conectar com OBS em ${cfg.host}:${cfg.port}.`)));
    socket.on('error', error => {
      if (this.state !== 'identified') fail(new Error(`Não foi possível acessar OBS em ${cfg.host}:${cfg.port} — ${error.message}`));
      else this._handleDisconnect(error);
    });
    socket.on('close', () => {
      if (this.state !== 'closed') this._handleDisconnect(new Error('Conexão com o OBS foi encerrada.'));
    });

    return this.connectPromise;
  }

  _receiveFrames(chunk, cfg) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      if (this.buffer.length < 2) return;
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];
      const fin = Boolean(b0 & 0x80);
      const opcode = b0 & 0x0f;
      const masked = Boolean(b1 & 0x80);
      let length = b1 & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const big = this.buffer.readBigUInt64BE(2);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) return this._handleDisconnect(new Error('Frame WebSocket grande demais.'));
        length = Number(big);
        offset = 10;
      }
      let mask;
      if (masked) {
        if (this.buffer.length < offset + 4) return;
        mask = this.buffer.subarray(offset, offset + 4);
        offset += 4;
      }
      if (this.buffer.length < offset + length) return;
      let payload = Buffer.from(this.buffer.subarray(offset, offset + length));
      this.buffer = this.buffer.subarray(offset + length);
      if (masked && mask) {
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      }

      if (opcode === 0x8) {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
        const reason = payload.length > 2 ? payload.subarray(2).toString('utf8') : '';
        const friendly = code === 4009
          ? 'Senha do OBS WebSocket incorreta.'
          : `OBS encerrou a conexão (${code}${reason ? `: ${reason}` : ''}).`;
        this._handleDisconnect(new Error(friendly));
        return;
      }
      if (opcode === 0x9) { this._sendFrame(payload, 0xA); continue; }
      if (opcode === 0xA) continue;

      if (opcode === 0x0) {
        if (this.fragmentOpcode === null) continue;
        this.fragmentChunks.push(payload);
        if (fin) {
          const all = Buffer.concat(this.fragmentChunks);
          const originalOpcode = this.fragmentOpcode;
          this.fragmentOpcode = null;
          this.fragmentChunks = [];
          if (originalOpcode === 0x1) this._handleText(all.toString('utf8'), cfg);
        }
        continue;
      }

      if (!fin && (opcode === 0x1 || opcode === 0x2)) {
        this.fragmentOpcode = opcode;
        this.fragmentChunks = [payload];
        continue;
      }
      if (opcode === 0x1) this._handleText(payload.toString('utf8'), cfg);
    }
  }

  _handleText(text, cfg) {
    let msg;
    try { msg = JSON.parse(text); }
    catch { return; }

    if (msg.op === 0) {
      this.hello = msg.d || {};
      const identify = { rpcVersion: Math.min(Number(this.hello.rpcVersion || 1), 1), eventSubscriptions: 0 };
      if (this.hello.authentication) {
        if (!cfg.password) {
          this._handleDisconnect(new Error('O OBS exige senha. Informe a senha do WebSocket nas Configurações do Worship Deck.'));
          return;
        }
        const { salt, challenge } = this.hello.authentication;
        const secret = crypto.createHash('sha256').update(cfg.password + salt).digest('base64');
        identify.authentication = crypto.createHash('sha256').update(secret + challenge).digest('base64');
      }
      this._sendJson({ op: 1, d: identify });
      return;
    }

    if (msg.op === 2) {
      this.state = 'identified';
      const resolve = this.connectResolve;
      this.connectResolve = null;
      this.connectReject = null;
      this.connectPromise = Promise.resolve();
      if (resolve) resolve();
      return;
    }

    if (msg.op === 7 && msg.d?.requestId) {
      const pending = this.pending.get(msg.d.requestId);
      if (!pending) return;
      this.pending.delete(msg.d.requestId);
      clearTimeout(pending.timer);
      const status = msg.d.requestStatus || {};
      if (!status.result) {
        pending.reject(new Error(status.comment || `OBS recusou ${msg.d.requestType || 'a ação'} (código ${status.code ?? '?'})`));
      } else {
        pending.resolve(msg.d.responseData || {});
      }
    }
  }

  _sendJson(value) {
    this._sendFrame(Buffer.from(JSON.stringify(value), 'utf8'), 0x1);
  }

  _sendFrame(payload, opcode = 0x1) {
    if (!this.socket || this.socket.destroyed) throw new Error('OBS WebSocket não está conectado.');
    const length = payload.length;
    let header;
    if (length < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | length;
    } else if (length <= 0xffff) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    const mask = crypto.randomBytes(4);
    const maskedPayload = Buffer.alloc(length);
    for (let i = 0; i < length; i++) maskedPayload[i] = payload[i] ^ mask[i % 4];
    this.socket.write(Buffer.concat([header, mask, maskedPayload]));
  }

  async request(requestType, requestData = {}) {
    await this.ensureConnected();
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`OBS não respondeu a ${requestType} a tempo.`));
      }, 4000);
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this._sendJson({ op: 6, d: { requestType, requestId, requestData } });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }

  _handleDisconnect(error) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (this.connectReject) this.connectReject(err);
    this.connectResolve = null;
    this.connectReject = null;
    this.connectPromise = null;
    this.state = 'closed';
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
    try { this.socket?.destroy(); } catch {}
    this.socket = null;
  }

  disconnect() {
    if (this.socket && !this.socket.destroyed) {
      try { this.socket.destroy(); } catch {}
    }
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.state = 'closed';
    this.connectPromise = null;
    this.connectResolve = null;
    this.connectReject = null;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Configuração do OBS foi alterada. Reconectando.'));
    }
    this.pending.clear();
  }
}

const obsClient = new TinyObsWebSocketClient();

// -----------------------------------------------------------------------------
// OBS screenshots / previews
// Usa GetSourceScreenshot do obs-websocket. O cache reduz a quantidade de
// capturas pedidas ao OBS quando o painel está aberto por muito tempo.
// -----------------------------------------------------------------------------
const obsScreenshotCache = new Map();

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function decodeObsImageData(imageData) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(String(imageData || ''));
  if (!match) throw new Error('OBS retornou uma imagem de preview inválida.');
  const mime = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  return { mime, buffer: Buffer.from(match[2], 'base64') };
}

async function getObsScreenshot({ sourceName, width = 640, height = 360, quality = 55, ttlMs = 4000 }) {
  sourceName = String(sourceName || '').trim();
  if (!sourceName) throw new Error('Cena do OBS não informada para o preview.');
  width = clampNumber(width, 8, 1280, 640);
  height = clampNumber(height, 8, 720, 360);
  quality = clampNumber(quality, 10, 90, 55);
  ttlMs = clampNumber(ttlMs, 300, 15000, 4000);

  const key = `${sourceName}|${width}x${height}|q${quality}`;
  const cached = obsScreenshotCache.get(key);
  const now = Date.now();
  if (cached && now - cached.at < ttlMs) return cached.image;

  const result = await obsClient.request('GetSourceScreenshot', {
    sourceName,
    imageFormat: 'jpeg',
    imageWidth: width,
    imageHeight: height,
    imageCompressionQuality: quality,
  });
  const image = decodeObsImageData(result.imageData);
  obsScreenshotCache.set(key, { at: now, image });
  if (obsScreenshotCache.size > 100) {
    for (const [cacheKey, item] of obsScreenshotCache) {
      if (now - item.at > 30000) obsScreenshotCache.delete(cacheKey);
    }
  }
  return image;
}

async function getObsState() {
  const sceneList = await obsClient.request('GetSceneList', {});
  const scenes = Array.isArray(sceneList.scenes)
    ? sceneList.scenes.map(scene => ({
        sceneName: String(scene.sceneName || ''),
        sceneUuid: scene.sceneUuid ? String(scene.sceneUuid) : null,
      })).filter(scene => scene.sceneName)
    : [];
  return {
    connected: true,
    obsStudioVersion: obsClient.hello?.obsStudioVersion || '',
    obsWebSocketVersion: obsClient.hello?.obsWebSocketVersion || '',
    currentProgramSceneName: sceneList.currentProgramSceneName || null,
    currentProgramSceneUuid: sceneList.currentProgramSceneUuid || null,
    scenes,
  };
}

async function setObsScene(body) {
  const sceneName = String(body.sceneName || '').trim();
  const sceneUuid = String(body.sceneUuid || '').trim();
  if (!sceneName && !sceneUuid) throw new Error('Cena do OBS não informada.');
  const requestData = sceneUuid ? { sceneUuid } : { sceneName };
  await obsClient.request('SetCurrentProgramScene', requestData);
  return getObsState();
}


// -----------------------------------------------------------------------------
// Diretor automático Holyrics -> OBS
// Troca apenas quando o TIPO muda (música / Bíblia / sem apresentação), evitando
// repetir transições a cada slide. Favoritos mapeados valem SOMENTE enquanto
// a apresentação correspondente estiver realmente ativa no Holyrics. Ao fechar
// o favorito e ficar sem apresentação, o OBS volta automaticamente para LIMPA.
// -----------------------------------------------------------------------------
const directorState = {
  busy: false,
  lastClass: null,
  lastTargetScene: null,
  specialOverride: null,
  lastAction: 'Aguardando',
  lastError: '',
  lastChangeAt: null,
};

function presentationClass(presentation) {
  if (!presentation) return 'none';
  if (presentation.type === 'song') return 'song';
  if (presentation.type === 'verse') return 'verse';
  return 'other';
}

// Identidade estável do CONTEÚDO, ignorando número do slide.
// Assim avançar verso/refrão dentro da mesma música não encerra um momento especial.
function presentationIdentity(presentation) {
  if (!presentation) return 'none';
  const type = String(presentation.type || 'other');
  const stableId = presentation.id ?? presentation.uuid ?? presentation.lyrics_id ?? presentation.lyricsId ?? presentation.presentation_id ?? presentation.presentationId ?? '';
  const name = presentation.name ?? presentation.title ?? presentation.reference ?? '';
  return `${type}|${String(stableId)}|${String(name)}`;
}

// Comparação tolerante a caixa, acentos e espaços. Assim "PRIMÍCIAS" e
// "primicias" são tratados como o mesmo nome ao reconhecer um favorito
// executado diretamente dentro do Holyrics.
function normalizePresentationName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

const favoriteMetadataCache = {
  at: 0,
  items: [],
};

async function getFavoriteMetadataCached(force = false) {
  const now = Date.now();
  if (!force && favoriteMetadataCache.items.length && now - favoriteMetadataCache.at < 15000) {
    return favoriteMetadataCache.items;
  }
  const items = await getFavorites();
  favoriteMetadataCache.at = now;
  favoriteMetadataCache.items = Array.isArray(items) ? items : [];
  return favoriteMetadataCache.items;
}

// Se um favorito mapeado for executado NO PRÓPRIO HOLYRICS, o endpoint
// /api/favorite do Deck não é chamado. Nesse caso reconhecemos o item atual
// pelo nome retornado por GetCurrentPresentation. Isto é especialmente útil
// para anúncios como OFERTA e PRIMÍCIAS.
async function mappedFavoriteForPresentation(presentation, cfg) {
  if (!presentation) return null;
  const type = String(presentation.type || '');
  // Música e Bíblia continuam obedecendo às regras automáticas próprias.
  if (type === 'song' || type === 'verse') return null;

  const presentationName = normalizePresentationName(
    presentation.name ?? presentation.title ?? presentation.reference ?? ''
  );
  if (!presentationName) return null;

  const map = cfg.favoriteSceneMap && typeof cfg.favoriteSceneMap === 'object'
    ? cfg.favoriteSceneMap
    : {};
  if (!Object.keys(map).length) return null;

  const favorites = await getFavoriteMetadataCached();
  for (const favorite of favorites) {
    const id = String(favorite?.id ?? '');
    const sceneName = String(map[id] || '').trim();
    if (!id || !sceneName) continue;
    if (normalizePresentationName(favorite?.name) === presentationName) {
      return {
        id,
        name: String(favorite?.name || presentation.name || ''),
        sceneName,
        presentationType: type || 'other',
      };
    }
  }
  return null;
}

function targetForClass(cfg, cls) {
  if (cls === 'song') return String(cfg.autoSongScene || '');
  if (cls === 'verse') return String(cfg.autoVerseScene || '');
  if (cls === 'none') return String(cfg.autoNoneScene || '');
  return '';
}

function automationSnapshot() {
  const cfg = loadConfig();
  return {
    enabled: Boolean(cfg.automationEnabled),
    songScene: String(cfg.autoSongScene || ''),
    verseScene: String(cfg.autoVerseScene || ''),
    noneScene: String(cfg.autoNoneScene || ''),
    favoriteSceneMap: cfg.favoriteSceneMap && typeof cfg.favoriteSceneMap === 'object' ? cfg.favoriteSceneMap : {},
    state: {
      lastClass: directorState.lastClass,
      lastTargetScene: directorState.lastTargetScene,
      specialOverride: directorState.specialOverride,
      lastAction: directorState.lastAction,
      lastError: directorState.lastError,
      lastChangeAt: directorState.lastChangeAt,
    },
  };
}

async function runDirectorTick() {
  if (directorState.busy) return;
  const cfg = loadConfig();
  if (!cfg.automationEnabled) return;
  directorState.busy = true;
  try {
    const result = await holyricsRequest('GetCurrentPresentation', {});
    const presentation = result.data ?? null;
    const cls = presentationClass(presentation);

    // Favorito executado diretamente no Holyrics (fora do Worship Deck).
    // GetCurrentPresentation informa o tipo e o nome do item atual; se esse nome
    // corresponde a um favorito especial mapeado, trocamos a cena do OBS.
    // Ex.: announcement + "OFERTA" -> cena Oferta.
    const externalFavorite = await mappedFavoriteForPresentation(presentation, cfg);
    if (externalFavorite) {
      // Se o mesmo favorito foi disparado pelo próprio Deck, preserva o modo
      // especial já existente. Se for OUTRO favorito disparado diretamente no
      // Holyrics, ele assume o controle imediatamente.
      if (directorState.specialOverride && String(directorState.specialOverride.favoriteId) === String(externalFavorite.id)) {
        directorState.lastError = '';
        return;
      }
      if (directorState.specialOverride) directorState.specialOverride = null;

      const favoriteClass = `favorite:${externalFavorite.id}`;
      const target = externalFavorite.sceneName;
      if (directorState.lastClass !== favoriteClass || directorState.lastTargetScene !== target) {
        const obs = await getObsState();
        if (obs.currentProgramSceneName !== target) {
          await setObsScene({ sceneName: target });
        }
        directorState.lastClass = favoriteClass;
        directorState.lastTargetScene = target;
        directorState.lastAction = `Holyrics • ${externalFavorite.name} → ${target}`;
        directorState.lastError = '';
        directorState.lastChangeAt = new Date().toISOString();
      }
      return;
    }

    // AUTO contínuo: não seguramos favoritos especiais artificialmente.
    // O estado atual do Holyrics é sempre a fonte de verdade.
    if (directorState.specialOverride) {
      directorState.specialOverride = null;
      directorState.lastClass = null;
      directorState.lastTargetScene = null;
    }

    if (!['song', 'verse', 'none'].includes(cls)) return;
    const target = targetForClass(cfg, cls);
    if (!target) return;

    if (directorState.lastClass === cls && directorState.lastTargetScene === target) return;

    const obs = await getObsState();
    if (obs.currentProgramSceneName !== target) {
      await setObsScene({ sceneName: target });
    }
    directorState.lastClass = cls;
    directorState.lastTargetScene = target;
    directorState.lastAction = `${cls} → ${target}`;
    directorState.lastError = '';
    directorState.lastChangeAt = new Date().toISOString();
  } catch (error) {
    directorState.lastError = error.message || String(error);
  } finally {
    directorState.busy = false;
  }
}

async function activateFavoriteScene(favoriteId, favoriteName = '') {
  const cfg = loadConfig();
  if (!cfg.automationEnabled) return null;
  const sceneName = String((cfg.favoriteSceneMap || {})[String(favoriteId)] || '').trim();
  if (!sceneName) return null;

  // Troca imediatamente para a cena mapeada. Depois disso o diretor continua
  // 100% automático: enquanto o favorito estiver apresentado ele será reconhecido
  // por GetCurrentPresentation; quando fechar, `none` leva para a cena LIMPA.
  const state = await setObsScene({ sceneName });
  directorState.specialOverride = null;
  directorState.lastClass = `favorite:${favoriteId}`;
  directorState.lastTargetScene = sceneName;
  directorState.lastAction = `Favorito ${favoriteName || favoriteId} → ${sceneName}`;
  directorState.lastError = '';
  directorState.lastChangeAt = new Date().toISOString();
  return state;
}

// -----------------------------------------------------------------------------
// Worship Deck Web Bridge
// Conexão sempre sai de dentro da igreja para HTTPS. Nenhuma porta do OBS
// precisa ser exposta no roteador. O Bridge envia estado e busca comandos.
// -----------------------------------------------------------------------------
let cloudPushBusy = false;
let cloudPullBusy = false;
let cloudFavoriteCache = { at: 0, data: [] };

function cloudConfig() {
  const cfg = loadConfig();
  return {
    enabled: Boolean(cfg.cloudEnabled),
    baseUrl: String(cfg.cloudBaseUrl || '').trim().replace(/\/$/, ''),
    secret: String(cfg.cloudBridgeSecret || ''),
    after: Math.max(0, Number(cfg.cloudLastCommandSeq || 0)),
  };
}

function cloudRequest(pathname, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const cfg = cloudConfig();
    if (!cfg.enabled) return reject(new Error('Worship Deck Web desativado.'));
    if (!/^https:\/\//i.test(cfg.baseUrl)) return reject(new Error('URL Web deve começar com https://'));
    if (!cfg.secret) return reject(new Error('Configure o segredo do Bridge Web.'));
    const url = new URL(pathname, cfg.baseUrl + '/');
    const payload = body == null ? '' : JSON.stringify(body);
    const req = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${cfg.secret}`,
        'Accept': 'application/json',
        ...(payload ? {'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)} : {}),
      },
      timeout: 8000,
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch {}
        if ((res.statusCode || 500) >= 400 || data.status === 'error') {
          return reject(new Error(data.error || `Web HTTP ${res.statusCode}`));
        }
        resolve(data);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado ao acessar Worship Deck Web.')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function getCloudFavorites() {
  const now = Date.now();
  if (now - cloudFavoriteCache.at < 10000) return cloudFavoriteCache.data;
  try {
    cloudFavoriteCache = { at: now, data: await getFavorites() };
  } catch {
    cloudFavoriteCache = { at: now, data: [] };
  }
  return cloudFavoriteCache.data;
}

async function pushCloudState() {
  if (cloudPushBusy) return;
  const cfg = cloudConfig();
  if (!cfg.enabled || !cfg.baseUrl || !cfg.secret) return;
  cloudPushBusy = true;
  try {
    let holyrics, obs;
    try { holyrics = await getHolyricsStatus(); }
    catch (error) { holyrics = { connected:false, error:error.message }; }
    try { obs = await getObsState(); }
    catch (error) { obs = { connected:false, error:error.message, scenes:[] }; }
    await cloudRequest('/api/bridge/push', 'POST', {
      version: '2.0.0-bridge',
      at: Date.now(),
      holyrics,
      obs,
      favorites: await getCloudFavorites(),
      automation: automationSnapshot(),
      lastCommandSeq: cloudConfig().after,
    });
  } catch (error) {
    // Mantém silencioso no uso normal; o status local continua funcionando.
    if (process.env.WORSHIP_DECK_DEBUG_CLOUD === '1') console.error('[WEB PUSH]', error.message);
  } finally { cloudPushBusy = false; }
}

async function executeCloudCommand(item) {
  if (!item || Number(item.expiresAt || 0) <= Date.now()) return;
  switch (item.kind) {
    case 'obs.scene':
      await setObsScene({ sceneName: String(item.sceneName || '') });
      break;
    case 'holyrics.control':
      await runControl({ command: String(item.command || '') });
      break;
    case 'holyrics.favorite':
      await holyricsRequest('FavoriteAction', { id: String(item.id || '') });
      await activateFavoriteScene(String(item.id || ''), String(item.name || ''));
      break;
    default:
      throw new Error(`Comando Web desconhecido: ${item.kind}`);
  }
}

async function pullCloudCommands() {
  if (cloudPullBusy) return;
  const cfg = cloudConfig();
  if (!cfg.enabled || !cfg.baseUrl || !cfg.secret) return;
  cloudPullBusy = true;
  try {
    const data = await cloudRequest(`/api/bridge/pull?after=${encodeURIComponent(cfg.after)}`, 'GET');
    const items = Array.isArray(data.items) ? data.items : [];
    for (const item of items) {
      const seq = Math.max(0, Number(item.seq || 0));
      try {
        await executeCloudCommand(item);
      } catch (error) {
        console.error(`[WEB CMD ${seq}]`, error.message);
      }
      // Mesmo em erro, não repete para sempre uma ação de culto expirada.
      if (seq > cloudConfig().after) saveConfig({ cloudLastCommandSeq: seq });
    }
  } catch (error) {
    if (process.env.WORSHIP_DECK_DEBUG_CLOUD === '1') console.error('[WEB PULL]', error.message);
  } finally { cloudPullBusy = false; }
}

// -----------------------------------------------------------------------------
// Static files / HTTP API
// -----------------------------------------------------------------------------
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const safePath = path.normalize(urlPath).replace(/^([.][.][/\\])+/, '');
  let filePath = path.join(PUBLIC, safePath === '/' ? 'index.html' : safePath);
  if (!filePath.startsWith(PUBLIC)) return json(res, 403, { error: 'Acesso negado' });

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        if (urlPath !== '/') {
          fs.readFile(path.join(PUBLIC, 'index.html'), (fallbackErr, fallback) => {
            if (fallbackErr) return json(res, 404, { error: 'Não encontrado' });
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(fallback);
          });
        } else json(res, 404, { error: 'Não encontrado' });
        return;
      }
      res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
      res.end(content);
    });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url.startsWith('/api/config')) {
      return json(res, 200, publicConfig(loadConfig()));
    }

    if (req.method === 'POST' && req.url.startsWith('/api/config')) {
      const body = await readBody(req);
      const before = loadConfig();
      const cfg = saveConfig(body);
      if (before.obsHost !== cfg.obsHost || Number(before.obsPort) !== Number(cfg.obsPort) || before.obsPassword !== cfg.obsPassword || before.obsAutoDiscover !== cfg.obsAutoDiscover || before.obsAgentId !== cfg.obsAgentId) {
        obsClient.disconnect();
      }
      return json(res, 200, { status: 'ok', ...publicConfig(cfg) });
    }

    if (req.method === 'GET' && req.url.startsWith('/api/diagnostics')) {
      return json(res, 200, await runDiagnostics());
    }

    if (req.method === 'GET' && req.url.startsWith('/api/profiles')) {
      const cfg = loadConfig();
      return json(res, 200, { status:'ok', activeProfile: cfg.activeProfile || 'Principal', profiles: listProfiles() });
    }

    if (req.method === 'POST' && req.url.startsWith('/api/profiles')) {
      requireLocalAdmin(req);
      const body = await readBody(req);
      const action = String(body.action || '');
      if (action === 'create' || action === 'save') {
        const name = safeProfileName(body.name || loadConfig().activeProfile || 'Principal');
        writeProfile(name, { ...loadConfig(), activeProfile: name });
        const cfg = saveConfig({ activeProfile: name });
        return json(res, 200, { status:'ok', activeProfile:name, profiles:listProfiles(), config:publicConfig(cfg) });
      }
      if (action === 'switch') {
        const profile = readProfile(body.name);
        const before = loadConfig();
        const incoming = { ...profile.config, activeProfile: profile.name, deckPort: before.deckPort };
        fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...DEFAULT_CONFIG, ...incoming }, null, 2));
        obsClient.disconnect();
        return json(res, 200, { status:'ok', activeProfile:profile.name, profiles:listProfiles(), config:publicConfig(loadConfig()), restartRecommended: Number(profile.config.deckPort || before.deckPort) !== Number(before.deckPort) });
      }
      if (action === 'delete') {
        const name = safeProfileName(body.name);
        const file = profilePath(name);
        if (fs.existsSync(file)) fs.unlinkSync(file);
        const cfg = loadConfig();
        if (cfg.activeProfile === name) saveConfig({ activeProfile:'Principal' });
        return json(res, 200, { status:'ok', activeProfile:loadConfig().activeProfile || 'Principal', profiles:listProfiles() });
      }
      throw new Error('Ação de perfil desconhecida.');
    }

    if (req.method === 'POST' && req.url.startsWith('/api/backup/export')) {
      requireLocalAdmin(req);
      const body = await readBody(req);
      const includeSecrets = Boolean(body.includeSecrets);
      const cfg = loadConfig();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      return sendJsonDownload(res, `worship-deck-backup-${stamp}.json`, {
        format: 'worship-deck-backup',
        version: VERSION,
        exportedAt: new Date().toISOString(),
        includesSecrets: includeSecrets,
        config: configForBackup(cfg, includeSecrets),
      });
    }

    if (req.method === 'POST' && req.url.startsWith('/api/backup/import')) {
      requireLocalAdmin(req);
      const body = await readBody(req);
      const incoming = body?.config && typeof body.config === 'object' ? body.config : body;
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw new Error('Backup inválido.');
      const before = loadConfig();
      const cfg = saveConfig(incoming);
      if (before.obsHost !== cfg.obsHost || Number(before.obsPort) !== Number(cfg.obsPort) || before.obsPassword !== cfg.obsPassword || before.obsAutoDiscover !== cfg.obsAutoDiscover || before.obsAgentId !== cfg.obsAgentId) obsClient.disconnect();
      return json(res, 200, { status:'ok', config:publicConfig(cfg) });
    }

    if (req.method === 'POST' && req.url.startsWith('/api/cloud/test')) {
      const cfg = cloudConfig();
      if (!cfg.enabled) throw new Error('Ative a conexão com o Worship Deck Web nas Configurações.');
      const data = await cloudRequest(`/api/bridge/pull?after=${encodeURIComponent(cfg.after)}`, 'GET');
      return json(res, 200, { status: 'ok', message: 'Worship Deck Web conectado', seq: data.seq ?? cfg.after });
    }

    if (req.method === 'GET' && req.url.startsWith('/api/agents')) {
      const cfg = loadConfig();
      const effective = effectiveObsConfig();
      return json(res, 200, {
        agents: activeAgents(),
        autoDiscover: Boolean(cfg.obsAutoDiscover),
        selectedAgentId: cfg.obsAgentId || '',
        effective: { host: effective.host, port: effective.port, agentId: effective.discovered?.id || null },
      });
    }

    if (req.method === 'GET' && req.url.startsWith('/api/network')) {
      const cfg = loadConfig();
      const addresses = [];
      const nets = os.networkInterfaces();
      for (const [name, entries] of Object.entries(nets)) {
        for (const item of entries || []) {
          if (item.family === 'IPv4' && !item.internal) {
            addresses.push({ name, address: item.address, url: `http://${item.address}:${cfg.deckPort}` });
          }
        }
      }
      return json(res, 200, { deckPort: cfg.deckPort, localUrl: `http://localhost:${cfg.deckPort}`, addresses });
    }

    if (req.method === 'GET' && req.url.startsWith('/api/status')) {
      try { return json(res, 200, await getHolyricsStatus()); }
      catch (error) { return json(res, 200, { connected: false, error: error.message }); }
    }

    if (req.method === 'POST' && req.url.startsWith('/api/control')) {
      const body = await readBody(req);
      await runControl(body);
      return json(res, 200, { status: 'ok' });
    }

    if (req.method === 'GET' && req.url.startsWith('/api/favorites')) {
      try { return json(res, 200, { status: 'ok', data: await getFavorites() }); }
      catch (error) { return json(res, 200, { status: 'error', error: error.message, data: [] }); }
    }

    if (req.method === 'POST' && req.url.startsWith('/api/favorite')) {
      const body = await readBody(req);
      if (!body.id) throw new Error('Favorito sem ID');
      await holyricsRequest('FavoriteAction', { id: String(body.id) });
      const obs = await activateFavoriteScene(String(body.id), body.name || '');
      return json(res, 200, { status: 'ok', obsSceneChanged: Boolean(obs), automation: automationSnapshot() });
    }

    if (req.method === 'GET' && req.url.startsWith('/api/automation')) {
      return json(res, 200, { status: 'ok', ...automationSnapshot() });
    }

    if (req.method === 'POST' && req.url.startsWith('/api/automation/resume')) {
      directorState.specialOverride = null;
      directorState.lastClass = null;
      directorState.lastTargetScene = null;
      directorState.lastAction = 'Automação retomada';
      directorState.lastError = '';
      directorState.lastChangeAt = new Date().toISOString();
      setTimeout(() => runDirectorTick(), 20);
      return json(res, 200, { status: 'ok', ...automationSnapshot() });
    }

    if (req.method === 'POST' && req.url.startsWith('/api/automation')) {
      const body = await readBody(req);
      const cfg = saveConfig({
        automationEnabled: Boolean(body.enabled),
        autoSongScene: body.songScene || '',
        autoVerseScene: body.verseScene || '',
        autoNoneScene: body.noneScene || '',
        favoriteSceneMap: body.favoriteSceneMap || {},
      });
      directorState.specialOverride = null;
      directorState.lastClass = null;
      directorState.lastTargetScene = null;
      directorState.lastAction = cfg.automationEnabled ? 'Automação configurada' : 'Automação desligada';
      directorState.lastError = '';
      directorState.lastChangeAt = new Date().toISOString();
      if (cfg.automationEnabled) setTimeout(() => runDirectorTick(), 20);
      return json(res, 200, { status: 'ok', ...automationSnapshot() });
    }


    if (req.method === 'GET' && req.url.startsWith('/api/obs/screenshot')) {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const sceneName = String(url.searchParams.get('sceneName') || '').trim();
      const kind = url.searchParams.get('kind') === 'program' ? 'program' : 'thumb';
      const image = await getObsScreenshot({
        sourceName: sceneName,
        width: kind === 'program' ? 960 : 420,
        height: kind === 'program' ? 540 : 236,
        quality: kind === 'program' ? 62 : 48,
        ttlMs: kind === 'program' ? 700 : 6500,
      });
      res.writeHead(200, {
        'Content-Type': image.mime || 'image/jpeg',
        'Content-Length': image.buffer.length,
        'Cache-Control': kind === 'program' ? 'no-store' : 'private, max-age=5',
      });
      return res.end(image.buffer);
    }

    if (req.method === 'GET' && req.url.startsWith('/api/obs/status')) {
      try { return json(res, 200, await getObsState()); }
      catch (error) { return json(res, 200, { connected: false, error: error.message, scenes: [] }); }
    }

    if (req.method === 'POST' && req.url.startsWith('/api/obs/scene')) {
      const body = await readBody(req);
      const state = await setObsScene(body);
      return json(res, 200, { status: 'ok', ...state });
    }

    if (req.method === 'POST' && req.url.startsWith('/api/obs/reconnect')) {
      obsClient.disconnect();
      const state = await getObsState();
      return json(res, 200, { status: 'ok', ...state });
    }

    return serveStatic(req, res);
  } catch (error) {
    return json(res, 500, { status: 'error', error: error.message || 'Erro interno' });
  }
});

setInterval(() => runDirectorTick(), 900);
setInterval(() => pullCloudCommands(), 700);
setInterval(() => pushCloudState(), 1400);
setTimeout(() => { pullCloudCommands(); pushCloudState(); }, 1200);

startAgentDiscovery();
const configAtStart = loadConfig();
server.listen(configAtStart.deckPort, '0.0.0.0', () => {
  console.log('\n=============================================');
  console.log('       WORSHIP DECK V3 ALPHA 4 RC');
  console.log('=============================================');
  console.log(`PC local: http://localhost:${configAtStart.deckPort}`);
  const nets = os.networkInterfaces();
  const found = [];
  for (const entries of Object.values(nets)) {
    for (const item of entries || []) {
      if (item.family === 'IPv4' && !item.internal) found.push(item.address);
    }
  }
  for (const address of [...new Set(found)]) console.log(`Celular:  http://${address}:${configAtStart.deckPort}`);
  console.log('\nOBS em casa/no mesmo PC: 127.0.0.1:4455');
  console.log('OBS em outro PC: use o IPv4 do PC do OBS nas Configuracoes.');
  console.log('Nao abra a porta 4455 no roteador para a internet.');
  if (configAtStart.cloudEnabled) console.log(`Web Bridge: ${configAtStart.cloudBaseUrl || 'URL nao configurada'}`);
  console.log('=============================================\n');
});
