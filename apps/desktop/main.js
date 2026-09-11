'use strict';

const { app, BrowserWindow, Menu, Tray, shell, dialog, nativeImage } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const http = require('http');
const path = require('path');

const APP_NAME = 'Worship Deck';
const DEFAULT_PORT = 4177;
const ICON_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA7UlEQVR4nO2XPQ7CMAyF3ahX4FTMSLCwcyJ2FpA6cyoO0U6hbn5tx24YeFuaNu/Li1MlAJ015Dpu73nWNLofh6RX9FDbuAayaWDz6fFUNT5dL0kIt4d5OCb2cqUXLSE2AJ7I0jyE8J5RAnvrDzCWOj+vdesczvz6oHzfPYEiAKbGs6GIml73BIo1UFNrjQAQEpAsAwdMvAQhDLdGmgG0JALIRSxJgQTAMeEWZtMSeAPpDmgG0BAZIJwlt90MYCXWn7A2K0ktdE/AAazHZHx0tpL38J5RApYQqbG/APiyYAGRu5j81tXMEiR3Oe2uBUPcZaKCPHmnAAAAAElFTkSuQmCC';
const startHidden = process.argv.includes('--background');
let mainWindow = null;
let tray = null;
let deckPort = DEFAULT_PORT;
let isQuitting = false;
let closeHintShown = false;
let manualUpdateCheck = false;
let updateState = 'idle';
let updateVersion = '';
let updateProgress = 0;

app.setName(APP_NAME);
app.setAppUserModelId('br.com.worshipdeck.app');
app.setPath('userData', path.join(app.getPath('appData'), APP_NAME));
process.env.WORSHIP_DECK_DATA_DIR = app.getPath('userData');

function readDeckPort() {
  try {
    const configPath = path.join(process.env.WORSHIP_DECK_DATA_DIR, 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const port = Number(config.deckPort);
    if (Number.isInteger(port) && port > 0 && port < 65536) return port;
  } catch {}
  return DEFAULT_PORT;
}

function waitForDeck(port, timeoutMs = 15000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get({ hostname:'127.0.0.1', port, path:'/api/runtime', timeout:800 }, response => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) return resolve();
        retry();
      });
      request.on('timeout', () => request.destroy());
      request.on('error', retry);
    };
    const retry = () => {
      if (Date.now() - startedAt >= timeoutMs) return reject(new Error('O servidor local não iniciou no tempo esperado.'));
      setTimeout(attempt, 180);
    };
    attempt();
  });
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.maximize();
  mainWindow.focus();
}

function showTrayMessage(title, content) {
  try { tray?.displayBalloon({ title, content }); } catch {}
}

function checkForUpdates(manual = false) {
  if (!app.isPackaged || updateState === 'checking' || updateState === 'downloading') return;
  manualUpdateCheck = manual;
  updateState = 'checking';
  rebuildTrayMenu();
  autoUpdater.checkForUpdates().catch(error => {
    updateState = 'idle';
    rebuildTrayMenu();
    if (manual) dialog.showMessageBox({ type:'warning', title:'Atualizações', message:'Não foi possível verificar atualizações.', detail:error.message });
  });
}

function rebuildTrayMenu() {
  if (!tray) return;
  const updateItems = [];
  if (updateState === 'available') {
    updateItems.push({
      label:`Baixar atualização ${updateVersion}`,
      click:() => {
        updateState = 'downloading';
        updateProgress = 0;
        rebuildTrayMenu();
        autoUpdater.downloadUpdate().catch(error => {
          updateState = 'available';
          rebuildTrayMenu();
          dialog.showMessageBox({ type:'warning', title:'Atualizações', message:'Não foi possível baixar a atualização.', detail:error.message });
        });
      }
    });
  } else if (updateState === 'downloading') {
    updateItems.push({ label:`Baixando atualização… ${updateProgress}%`, enabled:false });
  } else if (updateState === 'downloaded') {
    updateItems.push({
      label:`Instalar ${updateVersion} e reiniciar`,
      click:() => {
        isQuitting = true;
        autoUpdater.quitAndInstall(false, true);
      }
    });
  } else if (updateState === 'checking') {
    updateItems.push({ label:'Verificando atualizações…', enabled:false });
  } else {
    updateItems.push({ label:'Verificar atualizações', click:() => checkForUpdates(true) });
  }

  tray.setContextMenu(Menu.buildFromTemplate([
    { label:`Worship Deck ${app.getVersion()} ativo`, enabled:false },
    { label:`Celular: porta ${deckPort}`, enabled:false },
    { type:'separator' },
    { label:'Abrir Worship Deck', click:showWindow },
    ...updateItems,
    { label:'Inicia silenciosamente com o Windows', enabled:false },
    { type:'separator' },
    {
      label:'Encerrar Worship Deck',
      click:() => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
}

function createTray() {
  const icon = nativeImage.createFromBuffer(Buffer.from(ICON_BASE64, 'base64'));
  tray = new Tray(icon);
  tray.setToolTip(`${APP_NAME} ${app.getVersion()} — ativo na porta ${deckPort}`);
  tray.on('double-click', showWindow);
  rebuildTrayMenu();
}

function configureSilentStartup() {
  if (!app.isPackaged) return;
  try {
    const legacyShortcut = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Worship Deck.lnk');
    if (fs.existsSync(legacyShortcut)) fs.unlinkSync(legacyShortcut);
  } catch {}
  app.setLoginItemSettings({ openAtLogin:true, path:process.execPath, args:['--background'] });
}

function configureUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('update-available', info => {
    updateState = 'available';
    updateVersion = info.version || 'nova versão';
    rebuildTrayMenu();
    showTrayMessage('Atualização disponível', `A versão ${updateVersion} está disponível. Abra o menu do Worship Deck para baixar quando for conveniente.`);
  });
  autoUpdater.on('update-not-available', () => {
    updateState = 'idle';
    rebuildTrayMenu();
    if (manualUpdateCheck) showTrayMessage('Worship Deck atualizado', 'Você já está usando a versão mais recente.');
    manualUpdateCheck = false;
  });
  autoUpdater.on('download-progress', progress => {
    updateState = 'downloading';
    updateProgress = Math.max(0, Math.min(100, Math.round(progress.percent || 0)));
    rebuildTrayMenu();
  });
  autoUpdater.on('update-downloaded', info => {
    updateState = 'downloaded';
    updateVersion = info.version || updateVersion || 'nova versão';
    rebuildTrayMenu();
    showTrayMessage('Atualização pronta', `A versão ${updateVersion} foi baixada. Escolha “Instalar e reiniciar” no menu quando o culto permitir.`);
  });
  autoUpdater.on('error', error => {
    const wasManual = manualUpdateCheck;
    manualUpdateCheck = false;
    if (updateState !== 'available') updateState = 'idle';
    rebuildTrayMenu();
    if (wasManual) dialog.showMessageBox({ type:'warning', title:'Atualizações', message:'Não foi possível verificar atualizações.', detail:error.message });
  });
  setTimeout(() => checkForUpdates(false), 12000);
  setInterval(() => checkForUpdates(false), 6 * 60 * 60 * 1000);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title:APP_NAME,
    width:1440,
    height:900,
    minWidth:980,
    minHeight:640,
    backgroundColor:'#090b10',
    show:false,
    autoHideMenuBar:true,
    webPreferences:{ nodeIntegration:false, contextIsolation:true, sandbox:true, devTools:true }
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadURL(`http://127.0.0.1:${deckPort}/`);
  mainWindow.once('ready-to-show', () => { if (!startHidden) showWindow(); });
  mainWindow.on('close', event => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
    if (!closeHintShown && tray) {
      closeHintShown = true;
      showTrayMessage('Worship Deck continua ativo', 'A janela foi ocultada. O celular continua funcionando. Dê dois cliques no ícone para abrir novamente.');
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action:'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const localOrigin = `http://127.0.0.1:${deckPort}`;
    if (!url.startsWith(localOrigin)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('before-quit', () => { isQuitting = true; });

  app.whenReady().then(async () => {
    try {
      fs.mkdirSync(process.env.WORSHIP_DECK_DATA_DIR, { recursive:true });
      deckPort = readDeckPort();
      configureSilentStartup();
      require('../deck/secure-entry.js');
      await waitForDeck(deckPort);
      createTray();
      createWindow();
      configureUpdates();
    } catch (error) {
      dialog.showErrorBox(APP_NAME, `Não foi possível iniciar o Worship Deck.\n\n${error.message}`);
      isQuitting = true;
      app.quit();
    }
  });

  app.on('activate', showWindow);
  app.on('window-all-closed', () => {});
}
