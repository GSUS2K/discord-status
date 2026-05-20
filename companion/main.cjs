const { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, screen, shell, Tray } = require('electron');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');
const config = require('./activity-status.config.cjs');

let popoverWindow;
let settingsWindow;
let tray;
let backendProcess;
let backendState = 'stopped';
let lastBackendLine = 'Companion ready.';
let isQuitting = false;
let didQuitCleanup = false;
let lifecycleLock = Promise.resolve();
let updateStatus = {
  state: app.isPackaged ? 'idle' : 'dev',
  message: app.isPackaged ? 'Updates ready' : 'Updates are available in release builds.',
  version: app.getVersion(),
  availableVersion: null,
  progress: null
};
let cachedStatus = {
  backend: 'offline',
  discord: 'unknown',
  lastActivity: 'None',
  lastRpcError: null,
  url: `http://localhost:${config.port || 3000}`,
  log: lastBackendLine,
  update: updateStatus
};

const isPackaged = app.isPackaged;
const bundledAppRoot = isPackaged ? path.join(process.resourcesPath, 'app.asar') : path.resolve(__dirname, '..');
const backendRoot = isPackaged ? process.resourcesPath : path.resolve(__dirname, '..');
const backendScript = path.join(backendRoot, 'backend', 'server.js');
const iconPath = path.join(bundledAppRoot, 'extension', 'icons', 'icon128.png');
const trayIconPath = path.join(bundledAppRoot, 'extension', 'icons', process.platform === 'darwin' ? 'icon16.png' : 'icon48.png');
const settingsPath = path.join(app.getPath('userData'), 'companion-settings.json');
const defaultPort = Number(config.port || 3000);
const defaultSettings = {
  autoStartBackend: true,
  launchAtLogin: false,
  hidePopoverOnBlur: true,
  port: defaultPort
};

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', () => togglePopover());

function readSettings() {
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    return {
      ...defaultSettings,
      ...settings,
      port: normalizePort(settings.port),
      launchAtLogin: app.getLoginItemSettings().openAtLogin
    };
  } catch (error) {
    return { ...defaultSettings, launchAtLogin: app.getLoginItemSettings().openAtLogin };
  }
}

function saveSettings(nextSettings) {
  const settings = { ...readSettings(), ...nextSettings };
  setLaunchAtLogin(Boolean(settings.launchAtLogin));
  mkdirSync(path.dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify({
    autoStartBackend: Boolean(settings.autoStartBackend),
    hidePopoverOnBlur: Boolean(settings.hidePopoverOnBlur),
    port: normalizePort(settings.port)
  }, null, 2));
  return readSettings();
}

function normalizePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    return defaultPort;
  }
  return port;
}

function getBackendPort() {
  return normalizePort(readSettings().port);
}

function getBackendUrl() {
  return `http://localhost:${getBackendPort()}`;
}

function createPopoverWindow() {
  if (popoverWindow) return popoverWindow;

  popoverWindow = new BrowserWindow({
    width: 382,
    height: 560,
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    title: 'Activity Status Companion',
    backgroundColor: '#00000000',
    vibrancy: process.platform === 'darwin' ? 'popover' : undefined,
    visualEffectState: process.platform === 'darwin' ? 'active' : undefined,
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
    width: 930,
    height: 680,
    minWidth: 760,
    minHeight: 560,
    show: false,
    title: 'Activity Status Companion Settings',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#101114',
    vibrancy: process.platform === 'darwin' ? 'sidebar' : undefined,
    visualEffectState: process.platform === 'darwin' ? 'active' : undefined,
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
  popoverWindow?.hide();
  window.show();
  window.focus();
  pushStatusToRenderers();
}

function createTray() {
  if (tray) return;

  const image = nativeImage.createFromPath(trayIconPath).resize({ width: 18, height: 18 });
  image.setTemplateImage(process.platform === 'darwin');
  tray = new Tray(image);
  tray.setToolTip('Activity Status Companion');
  tray.on('click', () => togglePopover());
  tray.on('right-click', () => showNativeTrayMenu());
}

function setupAutoUpdater() {
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'GSUS2K',
    repo: 'discord-status'
  });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    setUpdateStatus('checking', 'Checking for updates...');
  });

  autoUpdater.on('update-available', info => {
    setUpdateStatus('available', `Downloading ${info.version}...`, { availableVersion: info.version });
  });

  autoUpdater.on('download-progress', progress => {
    setUpdateStatus('downloading', `Downloading update (${Math.round(progress.percent || 0)}%)`, {
      progress: Math.round(progress.percent || 0)
    });
  });

  autoUpdater.on('update-downloaded', info => {
    setUpdateStatus('downloaded', `Update ${info.version} is ready to install.`, {
      availableVersion: info.version,
      progress: 100
    });
  });

  autoUpdater.on('update-not-available', () => {
    setUpdateStatus('idle', 'You are on the latest version.', { availableVersion: null, progress: null });
  });

  autoUpdater.on('error', error => {
    setUpdateStatus('error', `Update check failed: ${error.message}`, { progress: null });
  });
}

function setUpdateStatus(state, message, extra = {}) {
  updateStatus = {
    ...updateStatus,
    ...extra,
    state,
    message,
    version: app.getVersion()
  };
  pushStatusToRenderers();
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
    { label: 'Open Controls', click: () => togglePopover() },
    { label: `Backend: ${backendState}`, enabled: false },
    { type: 'separator' },
    { label: 'Start Backend', enabled: !backendProcess && backendState !== 'starting', click: () => startBackend() },
    { label: 'Stop Backend', enabled: Boolean(backendProcess), click: () => stopBackend() },
    { label: 'Restart Backend', click: () => restartBackend() },
    { label: 'Reconnect Discord RPC', click: () => reconnectRpc() },
    { type: 'separator' },
    { label: readSettings().launchAtLogin ? 'Launch at Login: On' : 'Launch at Login: Off', enabled: false },
    { label: 'Settings...', click: () => showSettingsWindow() },
    { label: 'Open Chrome Extensions', click: () => openChromeExtensions() },
    { label: 'Check for Updates', click: () => checkForUpdates() },
    { label: 'Install Downloaded Update', enabled: updateStatus.state === 'downloaded', click: () => installUpdate() },
    { type: 'separator' },
    { label: 'Quit', click: () => quitApp() }
  ]);
  tray.popUpContextMenu(menu);
}

function setLaunchAtLogin(openAtLogin) {
  app.setLoginItemSettings({
    openAtLogin,
    openAsHidden: true
  });
}

function withLifecycle(task) {
  lifecycleLock = lifecycleLock.then(task, task);
  return lifecycleLock;
}

async function startBackend() {
  return withLifecycle(startBackendUnlocked);
}

async function stopBackend() {
  return withLifecycle(async () => {
    if (!backendProcess) {
      backendState = 'stopped';
      lastBackendLine = 'Backend is already stopped.';
      await pushStatusToRenderers();
      return getStatus();
    }

    const processToStop = backendProcess;
    backendState = 'stopping';
    lastBackendLine = 'Stopping backend...';
    await pushStatusToRenderers();

    processToStop.kill('SIGINT');
    const exited = await waitForExit(processToStop, 2500);
    if (!exited && !processToStop.killed) {
      processToStop.kill('SIGKILL');
      await waitForExit(processToStop, 1000);
    }

    if (backendProcess === processToStop) {
      backendProcess = null;
    }
    backendState = 'stopped';
    lastBackendLine = 'Backend stopped by user.';
    await delay(250);
    return getStatus();
  });
}

async function restartBackend() {
  return withLifecycle(async () => {
    await stopBackendUnlocked();
    await delay(350);
    return startBackendUnlocked();
  });
}

async function startBackendUnlocked() {
  if (backendProcess) {
    lastBackendLine = backendState === 'running' ? 'Backend already running.' : lastBackendLine;
    return getStatus();
  }

  const clientId = process.env.DISCORD_CLIENT_ID || config.discordClientId;
  const hasClientId = clientId && !/^REPLACE_WITH_/i.test(clientId);

  if (!hasClientId) {
    backendState = 'stopped';
    lastBackendLine = 'Missing Discord client ID. Update companion/activity-status.config.cjs before building.';
    await pushStatusToRenderers();
    return getStatus();
  }

  backendState = 'starting';
  lastBackendLine = 'Starting backend...';
  await pushStatusToRenderers();

  backendProcess = spawn(process.execPath, [backendScript], {
    cwd: backendRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      DISCORD_CLIENT_ID: clientId,
        PORT: String(getBackendPort()),
      LOG_LEVEL: process.env.LOG_LEVEL || 'info',
      ENABLE_PRESENCE_BUTTONS: process.env.ENABLE_PRESENCE_BUTTONS || 'true'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  backendProcess.stdout.on('data', data => {
    lastBackendLine = data.toString().trim().split('\n').at(-1) || lastBackendLine;
    if (lastBackendLine.includes('Backend running') || lastBackendLine.includes('HTTP request')) {
      backendState = 'running';
    }
    pushStatusToRenderers();
  });

  backendProcess.stderr.on('data', data => {
    lastBackendLine = data.toString().trim().split('\n').at(-1) || lastBackendLine;
    pushStatusToRenderers();
  });

  backendProcess.on('spawn', () => {
    backendState = 'running';
    lastBackendLine = 'Backend process started.';
    pushStatusToRenderers();
  });

  backendProcess.on('error', error => {
    backendState = 'stopped';
    backendProcess = null;
    lastBackendLine = `Backend failed to start: ${error.message}`;
    pushStatusToRenderers();
  });

  backendProcess.on('exit', (code, signal) => {
    const previousLine = lastBackendLine;
    backendProcess = null;
    backendState = 'stopped';
    lastBackendLine = `Backend stopped${signal ? ` by ${signal}` : Number.isFinite(code) ? ` with code ${code}` : ''}. Last message: ${previousLine}`;
    pushStatusToRenderers();
  });

  await delay(500);
  return getStatus();
}

async function stopBackendUnlocked() {
  if (!backendProcess) {
    backendState = 'stopped';
    lastBackendLine = 'Backend is already stopped.';
    await pushStatusToRenderers();
    return;
  }

  const processToStop = backendProcess;
  backendState = 'stopping';
  lastBackendLine = 'Stopping backend...';
  await pushStatusToRenderers();
  processToStop.kill('SIGINT');
  const exited = await waitForExit(processToStop, 2500);
  if (!exited && !processToStop.killed) {
    processToStop.kill('SIGKILL');
    await waitForExit(processToStop, 1000);
  }
  if (backendProcess === processToStop) {
    backendProcess = null;
  }
  backendState = 'stopped';
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise(resolve => {
    let settled = false;
    const done = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      resolve(value);
    };
    const onExit = () => done(true);
    const timer = setTimeout(() => done(false), timeoutMs);
    child.once('exit', onExit);
  });
}

async function reconnectRpc() {
  try {
    if (!backendProcess && cachedStatus.backend !== 'online') {
      await startBackend();
    }
    const backendUrl = getBackendUrl();
    const response = await fetch(`${backendUrl}/api/reconnect-rpc`, { method: 'POST' });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.message || `HTTP ${response.status}`);
    }
    lastBackendLine = 'Discord RPC reconnect requested.';
  } catch (error) {
    lastBackendLine = `Discord RPC reconnect failed: ${error.message}`;
  }
  await pushStatusToRenderers();
  return getStatus();
}

async function checkForUpdates() {
  if (!app.isPackaged) {
    setUpdateStatus('dev', 'Updates are available in installed release builds only.');
    return getStatus();
  }

  try {
    setUpdateStatus('checking', 'Checking for updates...');
    await autoUpdater.checkForUpdates();
  } catch (error) {
    setUpdateStatus('error', `Update check failed: ${error.message}`);
  }
  return getStatus();
}

function installUpdate() {
  if (updateStatus.state !== 'downloaded') {
    setUpdateStatus(updateStatus.state, 'No downloaded update is ready yet.');
    return false;
  }

  isQuitting = true;
  autoUpdater.quitAndInstall(false, true);
  return true;
}

async function getStatus() {
  const backendUrl = getBackendUrl();
  try {
    const response = await fetch(`${backendUrl}/api/status`, { cache: 'no-store' });
    if (!response.ok) {
      cachedStatus = {
        backend: `HTTP ${response.status}`,
        discord: 'unknown',
        lastActivity: 'None',
        lastRpcError: null,
        log: lastBackendLine,
        url: backendUrl,
        update: updateStatus
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
      url: backendUrl,
      uptimeSeconds: payload.uptime_seconds || 0,
      update: updateStatus
    };
    return cachedStatus;
  } catch (error) {
    cachedStatus = {
      backend: backendProcess ? backendState : 'offline',
      discord: 'unknown',
      lastActivity: 'None',
      lastRpcError: backendProcess ? null : 'backend offline',
      log: lastBackendLine,
      url: backendUrl,
      update: updateStatus
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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function openChromeExtensions() {
  const chromeUrl = 'chrome://extensions/';
  if (process.platform === 'darwin') {
    const opener = spawn('open', ['-a', 'Google Chrome', chromeUrl], {
      detached: true,
      stdio: 'ignore'
    });
    opener.on('error', () => shell.openExternal('https://support.google.com/chrome_webstore/answer/2664769'));
    opener.unref();
    return;
  }

  if (process.platform === 'win32') {
    const opener = spawn('cmd', ['/c', 'start', '', chromeUrl], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    opener.on('error', () => shell.openExternal('https://support.google.com/chrome_webstore/answer/2664769'));
    opener.unref();
    return;
  }

  const opener = spawn('google-chrome', [chromeUrl], {
    detached: true,
    stdio: 'ignore'
  });
  opener.on('error', () => {
    const chromium = spawn('chromium', [chromeUrl], { detached: true, stdio: 'ignore' });
    chromium.on('error', () => shell.openExternal('https://support.google.com/chrome_webstore/answer/2664769'));
    chromium.unref();
  });
  opener.unref();
}

function quitApp() {
  if (didQuitCleanup) return;
  didQuitCleanup = true;
  isQuitting = true;
  stopBackend().finally(() => app.quit());
}

ipcMain.handle('status:get', getStatus);
ipcMain.handle('backend:start', startBackend);
ipcMain.handle('backend:stop', stopBackend);
ipcMain.handle('backend:restart', restartBackend);
ipcMain.handle('rpc:reconnect', reconnectRpc);
ipcMain.handle('update:check', checkForUpdates);
ipcMain.handle('update:install', installUpdate);
ipcMain.handle('open:extensions', () => openChromeExtensions());
ipcMain.handle('window:hide', () => popoverWindow?.hide());
ipcMain.handle('settings:open', () => showSettingsWindow());
ipcMain.handle('quit', quitApp);
ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:set', (_event, settings) => saveSettings(settings));
ipcMain.handle('clipboard:copy', (_event, text) => {
  clipboard.writeText(String(text || ''));
  return true;
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  createTray();
  createPopoverWindow();
  setupAutoUpdater();

  if (readSettings().autoStartBackend) {
    startBackend();
  }

  setInterval(() => pushStatusToRenderers(), 3000);
});

app.on('activate', () => togglePopover());

app.on('before-quit', event => {
  if (didQuitCleanup) return;
  event.preventDefault();
  quitApp();
});

app.on('window-all-closed', () => {
  // Keep the tray/background helper alive until the user explicitly quits.
});
