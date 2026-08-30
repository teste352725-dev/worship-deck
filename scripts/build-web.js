const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const source = path.join(ROOT, 'apps', 'deck', 'public');
const target = path.join(ROOT, 'apps', 'web', 'public');

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
fs.cpSync(source, target, { recursive: true });

console.log(`[Worship Deck] Frontend compartilhado copiado para ${target}`);
