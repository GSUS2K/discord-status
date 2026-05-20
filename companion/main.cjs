const { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, screen, shell, Tray } = require('electron');
const { spawn } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const config = require('./activity-status.config.cjs');

let popoverWindow;
let settingsWindow;
let tray;
let backendProcess;
let lastBackendLine = 'Starting...';
let isQuitting = false;
let cachedStatus = {
  backend: 'offline',
  discord: 'unknown',
  lastActivity: 'None',
  lastRpcError: null,
  url: `http://localhost:${config.port || 3000}`
};

const isPackaged = app.isPackaged;
const bundledAppRoot = isPackaged ? path.join(process.resourcesPath, 'app.asar') : path.resolve(__dirname, '..');
const backendRoot = isPackaged ? process.resourcesPath : path.resolve(__dirname, '..');
const backendScript = path.join(backendRoot, 'backend', 'server.js');
const backendUrl = `http://localhost:${config.port || 3000}`;
const iconPath = path.join(bundledAppRoot, 'extension', 'icons', 'icon128.png');
const trayIconPath = path.join(bundledAppRoot, 'extension', 'icons', process.platform === 'darwin' ? 'icon16.png' : 'icon48.png');
const settingsPath = path.join(app.getPath('userData'), 'companion-settings.json');
const defaultSettings = {
  autoStartBackend: true,
  launchAtLogin: false,
  hidePopoverOnBlur: true
};

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', togglePopover);

function readSettings() {
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    return { ...defaultSettings, ...settings, launchAtLogin: app.getLoginItemSettings().openAtLogin };
  } catch (error) {
    return { ...defaultSettings, launchAtLogin: app.getLoginItemSettings().openAtLogin };
  }
}

function saveSettings(nextSettings) {
  const settings = { ...readSettings(), ...nextSettings };
  setLaunchAtLogin(Boolean(settings.launchAtLogin));
  writeFileSync(settingsPath, JSON.stringify({
    autoStartBackend: Boolean(settings.autoStartBackend),
    hidePopoverOnBlur: Boolean(settings.hidePopoverOnBlur)
  }, null, 2));
  return readSettings();
}

function createPopoverWindow() {
  if (popoverWindow) return popoverWindow;

  popoverWindow = new BrowserWindow({
    width: 360,
    height: 540,
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'Activity Status Companion',
    backgroundColor: '#101114',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  popoverWindow.loadFile(path.join(__dirname, 'index.html'));

  popoverWindow.on('blur', () => {
    if (readSettings().hidePopoverOnBlur) {
      popoverWindow.hide();
    }
  });

  popoverWindow.on('close', event => {
    if (isQuitting) return;
    event.preventDefault();
    popoverWindow.hide();
  });

  return popoverWindow;
}

function createSettingsWindow() {
  if (settingsWindow) return settingsWindow;

  settingsWindow = new BrowserWindow({
    width: 860,
    height: 620,
    minWidth: 720,
    minHeight: 520,
    show: false,
    title: 'Activity Status Companion Settings',
    backgroundColor: '#101114',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));

  settingsWindow.on('close', event => {
    if (isQuitting) return;
    event.preventDefault();
    settingsWindow.hide();
  });

  return settingsWindow;
}

function showSettingsWindow() {
  const window = createSettingsWindow();
  window.show();
  window.focus();
  popoverWindow?.hide();
}

function createTray() {
  if (tray) return;

  const image = nativeImage.createFromPath(trayIconPath).resize({ width: 18, height: 18 });
  tray = new Tray(image);
  tray.setToolTip('Activity Status Companion');
  tray.on('click', togglePopover);
  tray.on('right-click', showNativeTrayMenu);
}

function togglePopover() {
  const window = createPopoverWindow();
  if (window.isVisible()) {
    window.hide();
    return;
  }

  positionPopover(window);
  window.show();
  window.focus();
  pushStatusToRenderers();
}

function positionPopover(window) {
  const trayBounds = tray?.getBounds();
  const windowBounds = window.getBounds();
  const display = trayBounds
    ? screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y })
    : screen.getPrimaryDisplay();
  const area = display.workArea;

  let x = area.x + area.width - windowBounds.width - 12;
  let y = area.y + area.height - windowBounds.height - 12;

  if (trayBounds && process.platform === 'darwin') {
    x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2);
    y = Math.round(trayBounds.y + trayBounds.height + 8);
  } else if (trayBounds) {
    x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2);
    y = trayBounds.y < area.y + area.height / 2
      ? Math.round(trayBounds.y + trayBounds.height + 8)
      : Math.round(trayBounds.y - windowBounds.height - 8);
  }

  x = Math.max(area.x + 8, Math.min(x, area.x + area.width - windowBounds.width - 8));
  y = Math.max(area.y + 8, Math.min(y, area.y + area.height - windowBounds.height - 8));
  window.setPosition(x, y, false);
}

function showNativeTrayMenu() {
  const menu = Menu.buildFromTemplate([
    { label: 'Open Controls', click: togglePopover },
    { label: backendProcess ? 'Backend: running' : 'Backend: stopped', enabled: false },
    { type: 'separator' },
    { label: 'Start Backend', enabled: !backendProcess, click: startBackend },
    { label: 'Stop Backend', enabled: Boolean(backendProcess), click: stopBackend },
    { label: 'Restart Backend', click: restartBackend },
    { type: 'separator' },
    { label: 'Settings...', click: showSettingsWindow },
    { label: 'Open Chrome Extensions', click: () => shell.openExternal('chrome://extensions') },
    { type: 'separator' },
    { label: 'Quit', click: quitApp }
  ]);
  tray.popUpContextMenu(menu);
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
    pushStatusToRenderers();
    return;
  }

  lastBackendLine = 'Starting backend...';
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
    pushStatusToRenderers();
  });

  backendProcess.stderr.on('data', data => {
    lastBackendLine = data.toString().trim().split('\n').at(-1) || lastBackendLine;
    pushStatusToRenderers();
  });

  backendProcess.on('exit', code => {
    const previousLine = lastBackendLine;
    backendProcess = null;
    lastBackendLine = `Backend stopped${Number.isFinite(code) ? ` with code ${code}` : ''}. Last message: ${previousLine}`;
    pushStatusToRenderers();
  });

  pushStatusToRenderers();
}

async function stopBackend() {
  if (!backendProcess) return;
  backendProcess.kill('SIGINT');
  backendProcess = null;
  lastBackendLine = 'Backend stopped by user.';
  pushStatusToRenderers();
}

async function restartBackend() {
  await stopBackend();
  startBackend();
}

async function getStatus() {
  try {
    const response = await fetch(`${backendUrl}/api/status`, { cache: 'no-store' });
    if (!response.ok) {
      cachedStatus = {
        backend: `HTTP ${response.status}`,
        discord: 'unknown',
        lastActivity: 'None',
        lastRpcError: null,
        log: lastBackendLine,
        url: backendUrl
      };
      return cachedStatus;
    }

    const payload = await response.json();
    cachedStatus = {
      backend: 'online',
      discord: payload.discord_rpc || 'unknown',
      lastActivity: payload.last_activity?.details || 'None',
      lastRpcError: payload.last_rpc_error || null,
      log: lastBackendLine,
      url: backendUrl
    };
    return cachedStatus;
  } catch (error) {
    cachedStatus = {
      backend: backendProcess ? 'starting' : 'offline',
      discord: 'unknown',
      lastActivity: 'None',
      lastRpcError: null,
      log: lastBackendLine,
      url: backendUrl
    };
    return cachedStatus;
  }
}

async function pushStatusToRenderers() {
  const status = await getStatus();
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('status:update', status);
  }
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

ipcMain.handle('status:get', getStatus);
ipcMain.handle('backend:start', async () => {
  startBackend();
  return getStatus();
});
ipcMain.handle('backend:stop', async () => {
  await stopBackend();
  return getStatus();
});
ipcMain.handle('backend:restart', async () => {
  await restartBackend();
  return getStatus();
});
ipcMain.handle('open:extensions', () => {
  shell.openExternal('chrome://extensions');
});
ipcMain.handle('window:hide', () => {
  popoverWindow?.hide();
});
ipcMain.handle('settings:open', () => {
  showSettingsWindow();
});
ipcMain.handle('quit', quitApp);
ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:set', (_event, settings) => saveSettings(settings));
ipcMain.handle('clipboard:copy', (_event, text) => {
  clipboard.writeText(String(text || ''));
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  createTray();
  createPopoverWindow();

  if (readSettings().autoStartBackend) {
    startBackend();
  }

  setInterval(pushStatusToRenderers, 3000);

  app.on('activate', togglePopover);
});

app.on('before-quit', () => {
  isQuitting = true;
  stopBackend();
});

app.on('window-all-closed', () => {
  // Keep the tray/background helper alive until the user explicitly quits.
});
