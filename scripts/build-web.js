const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const source = path.join(ROOT, 'apps', 'deck', 'public');
const target = path.join(ROOT, 'apps', 'web', 'public');

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
fs.cpSync(source, target, { recursive: true });

// A interface visual continua vindo 100% de apps/deck/public.
// O build Web apenas garante que os adaptadores sejam carregados antes do app.js.
const indexFile = path.join(target, 'index.html');
let html = fs.readFileSync(indexFile, 'utf8');
const appTag = '<script src="/app.js" defer></script>';
if (!html.includes('src="/runtime.js"')) {
  html = html.replace(appTag, `<script src="/runtime.js" defer></script>\n  ${appTag}`);
}
if (!html.includes('src="/security.js"')) {
  html = html.replace(appTag, `<script src="/security.js" defer></script>\n  ${appTag}`);
}
fs.writeFileSync(indexFile, html, 'utf8');

console.log(`[Worship Deck] Frontend compartilhado copiado para ${target}`);
