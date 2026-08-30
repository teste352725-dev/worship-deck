const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const source = path.join(ROOT, 'apps', 'deck', 'public');
const target = path.join(ROOT, 'apps', 'web', 'public');

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
fs.cpSync(source, target, { recursive: true });

// runtime.js pertence à camada de transporte. O visual continua vindo 100%
// de apps/deck/public; no build Web apenas ativamos o adaptador antes do app.
const indexFile = path.join(target, 'index.html');
let html = fs.readFileSync(indexFile, 'utf8');
if (!html.includes('src="/runtime.js"')) {
  html = html.replace(
    '<script src="/app.js" defer></script>',
    '<script src="/runtime.js" defer></script>\n  <script src="/app.js" defer></script>'
  );
  fs.writeFileSync(indexFile, html, 'utf8');
}

console.log(`[Worship Deck] Frontend compartilhado copiado para ${target}`);
