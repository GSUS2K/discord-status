import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import RPC from 'discord-rpc';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: __dirname + '/.env' });

const app = express();
const PORT = process.env.PORT || 17654;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const ENABLE_PRESENCE_BUTTONS = process.env.ENABLE_PRESENCE_BUTTONS !== 'false';
const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

// Middleware
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    log('info', 'HTTP request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - startedAt
    });
  });
  next();
});

// Discord RPC client
let rpc;
let isConnected = false;
let rpcRetryDelayMs = 5000;
let reconnectTimer = null;
let lastActivity = null;
let lastRpcError = null;
let isShuttingDown = false;
let suppressReconnect = false;

function log(level, message, details = {}) {
  const normalizedLevel = LOG_LEVELS[level] ? level : 'info';
  const currentLevel = LOG_LEVELS[LOG_LEVEL] ? LOG_LEVEL : 'info';
  if (LOG_LEVELS[normalizedLevel] < LOG_LEVELS[currentLevel]) {
    return;
  }

  const line = {
    timestamp: new Date().toISOString(),
    level: normalizedLevel,
    message,
    ...details
  };
  const method = normalizedLevel === 'error' ? 'error' : normalizedLevel === 'warn' ? 'warn' : 'log';
  console[method](JSON.stringify(line));
}

// Initialize Discord RPC
async function initializeRPC() {
  try {
    if (!CLIENT_ID) {
      log('error', 'DISCORD_CLIENT_ID is not set');
      return;
    }

    if (rpc) {
      try {
        suppressReconnect = true;
        await rpc.destroy();
      } catch (error) {
        log('debug', 'Ignoring RPC destroy error before reconnect', { error: error.message });
      } finally {
        suppressReconnect = false;
      }
    }

    rpc = new RPC.Client({ transport: 'ipc' });

    rpc.on('ready', () => {
      log('info', 'Discord RPC connected');
      isConnected = true;
      lastRpcError = null;
    });

    rpc.on('disconnected', () => {
      log('warn', 'Discord RPC disconnected');
      isConnected = false;
      lastRpcError = 'connection closed';
      if (!isShuttingDown && !suppressReconnect) {
        scheduleRPCReconnect();
      }
    });

    rpc.on('error', (error) => {
      lastRpcError = error?.message || 'Discord RPC error';
      log('warn', 'Discord RPC client error', { error: lastRpcError });
      isConnected = false;
      scheduleRPCReconnect();
    });

    await rpc.login({ clientId: CLIENT_ID });
    rpcRetryDelayMs = 5000;
  } catch (error) {
    lastRpcError = error.message;
    if (error?.code === 'RPC_CONNECTION_TIMEOUT' || /RPC_CONNECTION_TIMEOUT/i.test(error?.message || '')) {
      log('error', 'Discord RPC timed out. Make sure the Discord desktop app is open and logged in.');
    } else {
      log('error', 'Error initializing Discord RPC', { error: error.message });
    }
    isConnected = false;
    scheduleRPCReconnect();
  }
}

function scheduleRPCReconnect() {
  if (isShuttingDown) {
    return;
  }

  if (reconnectTimer) {
    return;
  }

  const delay = rpcRetryDelayMs;
  rpcRetryDelayMs = Math.min(rpcRetryDelayMs * 2, 60000);
  log('info', 'Scheduling Discord RPC reconnect', { delayMs: delay });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    initializeRPC();
  }, delay);
}

async function reconnectRPC() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  rpcRetryDelayMs = 5000;
  isConnected = false;
  lastRpcError = null;

  if (rpc) {
    try {
      suppressReconnect = true;
      await Promise.race([
        rpc.destroy(),
        new Promise(resolve => setTimeout(resolve, 1000))
      ]);
    } catch (error) {
      log('debug', 'Ignoring RPC destroy error before manual reconnect', { error: error.message });
    } finally {
      suppressReconnect = false;
    }
  }

  await initializeRPC();
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    discord_rpc: isConnected ? 'connected' : 'disconnected',
    last_rpc_error: lastRpcError,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/status', (req, res) => {
  res.json({
    discord_rpc: isConnected ? 'connected' : 'disconnected',
    last_rpc_error: lastRpcError,
    last_activity: lastActivity,
    uptime_seconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.post('/api/reconnect-rpc', async (req, res) => {
  try {
    await reconnectRPC();
    res.json({
      success: true,
      discord_rpc: isConnected ? 'connected' : 'disconnected',
      last_rpc_error: lastRpcError,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    lastRpcError = error.message;
    log('error', 'Manual RPC reconnect failed', { error: error.message });
    res.status(500).json({
      error: 'Failed to reconnect Discord RPC',
      message: error.message
    });
  }
});

// Update activity endpoint
app.post('/api/update-activity', async (req, res) => {
  try {
    const activity = req.body;

    if (!isConnected) {
      log('warn', 'Rejecting activity update because RPC is disconnected');
      return res.status(503).json({
        error: 'Discord RPC not connected',
        message: 'Backend server is running but Discord RPC is not initialized. Make sure Discord is running.'
      });
    }

    const details = truncatePresenceText(activity.details || '', 128);
    const state = truncatePresenceText(activity.state || 'Active', 128);

    // Prepare Discord rich presence
    const presence = {
      state,
      details,
      instance: false
    };

    const artworkUrl = isDiscordImageUrl(activity.thumbnailUrl) ? activity.thumbnailUrl : '';
    if (artworkUrl || activity.largeImageKey) {
      presence.largeImageKey = artworkUrl || activity.largeImageKey;
    }

    if (activity.largeImageText) {
      presence.largeImageText = activity.largeImageText;
    }

    presence.smallImageText = activity.platform || 'Browser';

    if (activity.smallImageKey) {
      presence.smallImageKey = activity.smallImageKey;
    }

    if (typeof activity.isPlaying === 'boolean' && activity.mediaCurrentTime != null && activity.isPlaying) {
      const currentSeconds = Math.max(0, Number(activity.mediaCurrentTime) || 0);
      const durationSeconds = Math.max(0, Number(activity.mediaDuration) || 0);
      const now = Date.now();

      presence.startTimestamp = new Date(now - currentSeconds * 1000);

      if (durationSeconds > currentSeconds) {
        presence.endTimestamp = new Date(now + (durationSeconds - currentSeconds) * 1000);
      }
    }

    const buttons = buildPresenceButtons(activity);
    if (buttons.length > 0) {
      presence.buttons = buttons;
    }

    // Update Discord presence
    await rpc.setActivity(presence);
    lastActivity = {
      platform: activity.platform || 'Browser',
      details: presence.details,
      state: presence.state,
      large_image_key: presence.largeImageKey || null,
      small_image_key: presence.smallImageKey || null,
      buttons: presence.buttons || [],
      updated_at: new Date().toISOString()
    };
    log('info', 'Discord activity updated', lastActivity);

    res.json({
      success: true,
      message: 'Activity updated',
      activity: presence,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    log('error', 'Error updating activity', { error: error.message });
    isConnected = false;
    lastRpcError = error.message;
    scheduleRPCReconnect();
    res.status(500).json({
      error: 'Failed to update activity',
      message: error.message
    });
  }
});

function truncatePresenceText(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1).trim()}…`;
}

function buildPresenceButtons(activity) {
  if (!ENABLE_PRESENCE_BUTTONS || !activity?.url || !isPublicHttpUrl(activity.url)) {
    return [];
  }

  const platform = truncatePresenceText(activity.platform || 'Page', 22);
  return [
    {
      label: `Open ${platform}`,
      url: activity.url
    }
  ];
}

function isPublicHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname);
  } catch (error) {
    return false;
  }
}

function isDiscordImageUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' && url.href.length <= 300;
  } catch {
    return false;
  }
}

// Clear activity endpoint
app.post('/api/clear-activity', async (req, res) => {
  try {
    if (rpc && isConnected) {
      await rpc.clearActivity();
      lastActivity = null;
      log('info', 'Discord activity cleared');
      res.json({ success: true, message: 'Activity cleared' });
    } else {
      log('warn', 'Clear requested while RPC is disconnected');
      res.status(503).json({ error: 'Discord RPC not connected' });
    }
  } catch (error) {
    log('error', 'Error clearing activity', { error: error.message });
    res.status(500).json({
      error: 'Failed to clear activity',
      message: error.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  log('info', 'Discord Activity Backend running', { url: `http://localhost:${PORT}` });
  log('info', 'Health check available', { url: `http://localhost:${PORT}/health` });
  
  // Initialize RPC connection
  initializeRPC();
});

// Graceful shutdown
process.on('SIGINT', async () => {
  isShuttingDown = true;
  log('info', 'Shutting down');
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }
  if (rpc) {
    try {
      await Promise.race([
        rpc.destroy(),
        new Promise(resolve => setTimeout(resolve, 1000))
      ]);
    } catch (error) {
      log('debug', 'Ignoring RPC destroy error during shutdown', { error: error.message });
    }
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  isShuttingDown = true;
  log('info', 'Shutting down');
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }
  if (rpc) {
    try {
      await Promise.race([
        rpc.destroy(),
        new Promise(resolve => setTimeout(resolve, 1000))
      ]);
    } catch (error) {
      log('debug', 'Ignoring RPC destroy error during shutdown', { error: error.message });
    }
  }
  process.exit(0);
});
