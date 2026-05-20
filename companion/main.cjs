const { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const config = require('./activity-status.config.cjs');

let mainWindow;
let tray;
let backendProcess;
let lastBackendLine = 'Starting...';
let isQuitting = false;

const isPackaged = app.isPackaged;
const bundledAppRoot = isPackaged ? path.join(process.resourcesPath, 'app.asar') : path.resolve(__dirname, '..');
const backendRoot = isPackaged ? process.resourcesPath : path.resolve(__dirname, '..');
const backendScript = path.join(backendRoot, 'backend', 'server.js');
const backendUrl = `http://localhost:${config.port || 3000}`;
const iconPath = path.join(bundledAppRoot, 'extension', 'icons', 'icon128.png');
const trayIconPath = path.join(bundledAppRoot, 'extension', 'icons', process.platform === 'darwin' ? 'icon16.png' : 'icon48.png');
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', showWindow);

function createWindow() {
  if (mainWindow) return mainWindow;

  mainWindow = new BrowserWindow({
    width: 560,
    height: 520,
    minWidth: 480,
    minHeight: 420,
    show: false,
    title: 'Activity Status Companion',
    backgroundColor: '#101114',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('close', event => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });

  return mainWindow;
}

function showWindow() {
  const window = createWindow();
  window.show();
  window.focus();
}

function createTray() {
  if (tray) return;

  const image = nativeImage.createFromPath(trayIconPath).resize({ width: 18, height: 18 });
  tray = new Tray(image);
  tray.setToolTip('Activity Status Companion');
  tray.on('click', showWindow);
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;

  const menu = Menu.buildFromTemplate([
    {
      label: 'Open Activity Status Companion',
      click: showWindow
    },
    {
      label: backendProcess ? 'Backend: running' : 'Backend: stopped',
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Start Backend',
      enabled: !backendProcess,
      click: () => {
        startBackend();
        updateTrayMenu();
      }
    },
    {
      label: 'Stop Backend',
      enabled: Boolean(backendProcess),
      click: async () => {
        await stopBackend();
        updateTrayMenu();
      }
    },
    { type: 'separator' },
    {
      label: 'Launch at Login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: item => {
        setLaunchAtLogin(item.checked);
        updateTrayMenu();
      }
    },
    {
      label: 'Open Chrome Extensions',
      click: () => shell.openExternal('chrome://extensions')
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(menu);
}

function setLaunchAtLogin(openAtLogin) {
  app.setLoginItemSettings({
    openAtLogin,
    openAsHidden: true
  });
}

function startBackend() {
  if (backendProcess) return;

  const clientId = process.env.DISCORD_CLIENT_ID || config.discordClientId;
  const hasClientId = clientId && !/^REPLACE_WITH_/i.test(clientId);

  if (!hasClientId) {
    lastBackendLine = 'Missing Discord client ID. Set companion/activity-status.config.cjs before building.';
    return;
  }

  backendProcess = spawn(process.execPath, [backendScript], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      DISCORD_CLIENT_ID: clientId,
      PORT: String(config.port || 3000),
      LOG_LEVEL: process.env.LOG_LEVEL || 'info',
      ENABLE_PRESENCE_BUTTONS: process.env.ENABLE_PRESENCE_BUTTONS || 'true'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  backendProcess.stdout.on('data', data => {
    lastBackendLine = data.toString().trim().split('\n').at(-1) || lastBackendLine;
    mainWindow?.webContents.send('backend-log', lastBackendLine);
    updateTrayMenu();
  });

  backendProcess.stderr.on('data', data => {
    lastBackendLine = data.toString().trim().split('\n').at(-1) || lastBackendLine;
    mainWindow?.webContents.send('backend-log', lastBackendLine);
    updateTrayMenu();
  });

  backendProcess.on('exit', code => {
    const previousLine = lastBackendLine;
    backendProcess = null;
    lastBackendLine = `Backend stopped${Number.isFinite(code) ? ` with code ${code}` : ''}. Last message: ${previousLine}`;
    mainWindow?.webContents.send('backend-log', lastBackendLine);
    updateTrayMenu();
  });

  updateTrayMenu();
}

async function stopBackend() {
  if (!backendProcess) return;
  backendProcess.kill('SIGINT');
  backendProcess = null;
  updateTrayMenu();
}

async function getStatus() {
  try {
    const response = await fetch(`${backendUrl}/api/status`, { cache: 'no-store' });
    if (!response.ok) {
      return {
        backend: `HTTP ${response.status}`,
        discord: 'unknown',
        lastActivity: 'None',
        log: lastBackendLine
      };
    }

    const payload = await response.json();
    return {
      backend: 'online',
      discord: payload.discord_rpc || 'unknown',
      lastActivity: payload.last_activity?.details || 'None',
      log: lastBackendLine,
      url: backendUrl
    };
  } catch (error) {
    return {
      backend: backendProcess ? 'starting' : 'offline',
      discord: 'unknown',
      lastActivity: 'None',
      log: lastBackendLine,
      url: backendUrl
    };
  }
}

ipcMain.handle('status:get', getStatus);
ipcMain.handle('backend:start', () => {
  startBackend();
  return getStatus();
});
ipcMain.handle('backend:stop', async () => {
  await stopBackend();
  return getStatus();
});
ipcMain.handle('open:extensions', () => {
  shell.openExternal('chrome://extensions');
});
ipcMain.handle('window:hide', () => {
  mainWindow?.hide();
});
ipcMain.handle('launch-at-login:get', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('launch-at-login:set', (_event, openAtLogin) => {
  setLaunchAtLogin(Boolean(openAtLogin));
  updateTrayMenu();
  return app.getLoginItemSettings().openAtLogin;
});

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  createWindow();
  createTray();
  startBackend();

  app.on('activate', () => {
    showWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  stopBackend();
});

app.on('window-all-closed', () => {
  // Keep the tray/background helper alive until the user explicitly quits.
});
