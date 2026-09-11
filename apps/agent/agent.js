const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const APP_ROOT = __dirname;
const DATA_ROOT = process.env.WORSHIP_AGENT_DATA_DIR || APP_ROOT;
const CONFIG_FILE = path.join(DATA_ROOT, 'agent-config.json');
try { fs.mkdirSync(DATA_ROOT, { recursive: true }); } catch {}
const PORT = 4178;
const MULTICAST = '239.255.47.77';

function loadOrCreateConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return {
        id: String(parsed.id || crypto.randomUUID()),
        name: String(parsed.name || os.hostname()),
        obsPort: Number(parsed.obsPort || 4455),
      };
    } catch {}
  }
  const cfg = { id: crypto.randomUUID(), name: os.hostname(), obsPort: 4455 };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}

const cfg = loadOrCreateConfig();
const socket = dgram.createSocket('udp4');

socket.on('error', (err) => {
  console.error('[Agent] Erro UDP:', err.message);
});

function announce() {
  const payload = Buffer.from(JSON.stringify({
    type: 'worship-agent-v1',
    id: cfg.id,
    name: cfg.name,
    obsPort: cfg.obsPort,
    agentVersion: '1.0.2',
  }));
  socket.send(payload, 0, payload.length, PORT, MULTICAST, () => {});
}

socket.bind(0, () => {
  try { socket.setMulticastTTL(1); } catch {}
  console.log('=============================================');
  console.log('            WORSHIP AGENT V3');
  console.log('=============================================');
  console.log(`Agent: ${cfg.name}`);
  console.log(`OBS WebSocket: porta ${cfg.obsPort}`);
  console.log('Anunciando este PC para o Worship Deck na rede local.');
  console.log('Nenhuma senha/token e transmitido pelo Agent.');
  console.log('=============================================');
  announce();
  setInterval(announce, 2000);
});
