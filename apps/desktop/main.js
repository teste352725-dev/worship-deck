'use strict';

const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const fs = require('fs');
const http = require('http');
const path = require('path');

const APP_NAME = 'Worship Deck';
const DEFAULT_PORT = 4177;
let mainWindow = null;
let deckPort = DEFAULT_PORT;

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

function createWindow() {
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#090b10',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: true
    }
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadURL(`http://127.0.0.1:${deckPort}/`);
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
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
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    try {
      fs.mkdirSync(process.env.WORSHIP_DECK_DATA_DIR, { recursive:true });
      deckPort = readDeckPort();
      require('../deck/secure-entry.js');
      await waitForDeck(deckPort);
      createWindow();
    } catch (error) {
      dialog.showErrorBox(APP_NAME, `Não foi possível iniciar o Worship Deck.\n\n${error.message}`);
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
