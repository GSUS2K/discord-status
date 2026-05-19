const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const config = require('./activity-status.config.cjs');

let mainWindow;
let backendProcess;
let lastBackendLine = 'Starting...';

const isPackaged = app.isPackaged;
const bundledAppRoot = isPackaged ? path.join(process.resourcesPath, 'app.asar') : path.resolve(__dirname, '..');
const backendRoot = isPackaged ? process.resourcesPath : path.resolve(__dirname, '..');
const backendScript = path.join(backendRoot, 'backend', 'server.js');
const backendUrl = `http://localhost:${config.port || 3000}`;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 560,
    height: 520,
    minWidth: 480,
    minHeight: 420,
    title: 'Activity Status Companion',
    backgroundColor: '#101114',
    icon: path.join(bundledAppRoot, 'extension', 'icons', 'icon128.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
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
  });

  backendProcess.stderr.on('data', data => {
    lastBackendLine = data.toString().trim().split('\n').at(-1) || lastBackendLine;
    mainWindow?.webContents.send('backend-log', lastBackendLine);
  });

  backendProcess.on('exit', code => {
    const previousLine = lastBackendLine;
    backendProcess = null;
    lastBackendLine = `Backend stopped${Number.isFinite(code) ? ` with code ${code}` : ''}. Last message: ${previousLine}`;
    mainWindow?.webContents.send('backend-log', lastBackendLine);
  });
}

async function stopBackend() {
  if (!backendProcess) return;
  backendProcess.kill('SIGINT');
  backendProcess = null;
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

app.whenReady().then(() => {
  createWindow();
  startBackend();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', stopBackend);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
