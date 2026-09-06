'use strict';

const { app, Menu, Tray, dialog, nativeImage } = require('electron');
const os = require('os');
const path = require('path');

const APP_NAME = 'Worship Agent';
const ICON_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA7UlEQVR4nO2XPQ7CMAyF3ahX4FTMSLCwcyJ2FpA6cyoO0U6hbn5tx24YeFuaNu/Li1MlAJ015Dpu73nWNLofh6RX9FDbuAayaWDz6fFUNT5dL0kIt4d5OCb2cqUXLSE2AJ7I0jyE8J5RAnvrDzCWOj+vdesczvz6oHzfPYEiAKbGs6GIml73BIo1UFNrjQAQEpAsAwdMvAQhDLdGmgG0JALIRSxJgQTAMeEWZtMSeAPpDmgG0BAZIJwlt90MYCXWn7A2K0ktdE/AAazHZHx0tpL38J5RApYQqbG/APiyYAGRu5j81tXMEiR3Oe2uBUPcZaKCPHmnAAAAAElFTkSuQmCC';
let tray = null;

app.setName(APP_NAME);
app.setAppUserModelId('br.com.worshipdeck.agent');
app.setPath('userData', path.join(app.getPath('appData'), APP_NAME));
process.env.WORSHIP_AGENT_DATA_DIR = app.getPath('userData');

function loginEnabled() {
  return app.getLoginItemSettings().openAtLogin;
}

function rebuildMenu() {
  tray.setContextMenu(Menu.buildFromTemplate([
    { label:'Worship Agent ativo', enabled:false },
    { label:`Computador: ${os.hostname()}`, enabled:false },
    { label:'OBS WebSocket: porta 4455', enabled:false },
    { type:'separator' },
    {
      label:'Iniciar com o Windows',
      type:'checkbox',
      checked:loginEnabled(),
      click:item => {
        app.setLoginItemSettings({ openAtLogin:item.checked, path:process.execPath });
        rebuildMenu();
      }
    },
    {
      label:'Ver status',
      click:() => dialog.showMessageBox({
        type:'info',
        title:APP_NAME,
        message:'Worship Agent está ativo',
        detail:`Computador: ${os.hostname()}\nOBS WebSocket: porta 4455\nAnunciando este computador na rede local.`
      })
    },
    { type:'separator' },
    { label:'Encerrar Worship Agent', click:() => app.quit() }
  ]));
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    dialog.showMessageBox({ type:'info', title:APP_NAME, message:'O Worship Agent já está funcionando em segundo plano.' });
  });

  app.whenReady().then(() => {
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin:true, path:process.execPath });
    require('./agent.js');
    const icon = nativeImage.createFromBuffer(Buffer.from(ICON_BASE64, 'base64'));
    tray = new Tray(icon);
    tray.setToolTip(`${APP_NAME} — ativo em ${os.hostname()}`);
    tray.on('double-click', () => {
      dialog.showMessageBox({
        type:'info',
        title:APP_NAME,
        message:'Worship Agent está ativo',
        detail:'O Deck pode localizar este computador e conectar ao OBS pela rede local.'
      });
    });
    rebuildMenu();
  });

  app.on('window-all-closed', event => event.preventDefault());
}
