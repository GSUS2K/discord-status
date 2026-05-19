// Background Service Worker

const DEFAULT_SERVER_URL = 'http://localhost:3000';
const DEFAULT_UPDATE_INTERVAL_SECONDS = 5;
const DEFAULT_STALE_THRESHOLD_MS = 30000;
const DEFAULT_ENABLED_SITES = [
  'youtube',
  'netflix',
  'hotstar',
  'crunchyroll',
  'spotify',
  'twitch',
  'discord',
  'meet',
  'github',
  'chatgpt',
  'google',
  'wikipedia'
];
const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_LOG_ENTRIES = 80;
const ACTIVE_TAB_GRACE_MS = 45000;

let isEnabled = true;
let mode = 'auto';
let currentActivity = null;
let lastActivity = null;
let selectedTabId = null;
let activeTabId = null;
let activityRegistry = {};
let pruneTimer = null;
let healthTimer = null;
let tickTimer = null;
let settings = {
  serverUrl: DEFAULT_SERVER_URL,
  updateInterval: DEFAULT_UPDATE_INTERVAL_SECONDS,
  enabledSites: DEFAULT_ENABLED_SITES,
  staleThresholdMs: DEFAULT_STALE_THRESHOLD_MS,
  logLevel: 'info'
};

log('info', 'Service worker started');

// Initialize
chrome.storage.local.get([
  'enabled',
  'mode',
  'selectedTabId',
  'detectedActivities',
  'serverUrl',
  'updateInterval',
  'enabledSites',
  'staleThresholdMs',
  'logLevel'
], (result) => {
  isEnabled = result.enabled !== false;
  mode = normalizeMode(result.mode);
  selectedTabId = normalizeTabId(result.selectedTabId);
  settings = normalizeSettings(result);
  activityRegistry = arrayToRegistry(result.detectedActivities || []);
  log('info', 'Initialized', { enabled: isEnabled, mode, selectedTabId, settings });
  startTimers();
  refreshBackendHealth();
  syncActiveTab();
  refreshOpenTabs();
});

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  log('debug', 'Message received', { action: request.action, from: sender.url || sender.tab?.url || 'extension' });
  
  if (request.action === 'toggleStatus') {
    isEnabled = Boolean(request.enabled);
    chrome.storage.local.set({ enabled: isEnabled });
    log('info', 'Status toggled', { enabled: isEnabled });

    if (!isEnabled) {
      currentActivity = null;
      clearDiscordStatus();
    } else if (mode === 'auto') {
      applyBestActivity();
    }
  } else if (request.action === 'changeMode') {
    mode = normalizeMode(request.mode);
    chrome.storage.local.set({ mode });
    log('info', 'Mode changed', { mode });

    if (mode === 'auto') {
      applyBestActivity();
    }
  } else if (request.action === 'setManualActivity') {
    if (!isEnabled) {
      log('warn', 'Manual activity ignored while disabled');
      sendResponse({ ok: false, reason: 'disabled' });
      return;
    }

    currentActivity = {
      details: request.activity,
      state: 'Manual Activity',
      largeImageKey: 'manual',
      largeImageText: 'Custom Activity',
      platform: 'Manual',
      lastSeen: Date.now()
    };
    log('info', 'Manual activity set', { details: currentActivity.details });
    updateDiscordStatus(currentActivity);
  } else if (request.action === 'clearActivity') {
    currentActivity = null;
    lastActivity = null;
    selectedTabId = null;
    chrome.storage.local.set({ selectedTabId: null });
    clearDiscordStatus();
  } else if (request.action === 'selectActivityTab') {
    selectedTabId = normalizeTabId(request.tabId);
    chrome.storage.local.set({ selectedTabId });

    if (selectedTabId === null) {
      applyBestActivity();
      sendResponse({ ok: true });
      return;
    }

    const selectedActivity = activityRegistry[selectedTabId];
    if (selectedActivity) {
      currentActivity = selectedActivity;
      updateDiscordStatus(currentActivity);
    } else {
      currentActivity = null;
      clearDiscordStatus();
    }
  } else if (request.action === 'activityDetected') {
    const tabId = sender.tab?.id;
    if (!Number.isFinite(tabId)) {
      log('warn', 'Ignoring activity without a sender tab', { activity: request.activity });
      sendResponse({ ok: false, reason: 'missing-tab' });
      return;
    }

    const enrichedActivity = {
      ...request.activity,
      tabId,
      tabTitle: sender.tab?.title || request.activity?.details || 'Unknown tab',
      lastSeen: Date.now(),
      isActiveTab: tabId === activeTabId
    };

    if (!isSiteEnabled(enrichedActivity, sender.tab?.url)) {
      delete activityRegistry[tabId];
      persistActivityRegistry();
      log('debug', 'Activity ignored because site is disabled', { tabId, platform: enrichedActivity.platform });
      sendResponse({ ok: false, reason: 'site-disabled' });
      return;
    }

    activityRegistry[tabId] = enrichedActivity;
    persistActivityRegistry();
    log('debug', 'Activity detected', {
      tabId,
      platform: enrichedActivity.platform,
      details: enrichedActivity.details,
      state: enrichedActivity.state
    });

    if (mode === 'auto' && isEnabled) {
      applyBestActivity();
    }
  } else if (request.action === 'refreshSelectedActivity') {
    refreshOpenTabs();
    applyBestActivity();
  } else if (request.action === 'refreshBackendHealth') {
    refreshBackendHealth();
  } else if (request.action === 'clearLogs') {
    chrome.storage.local.set({ activityLogs: [] });
  }

  sendResponse({ ok: true });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  const settingsChanged = [
    'serverUrl',
    'updateInterval',
    'enabledSites',
    'staleThresholdMs',
    'logLevel'
  ].some(key => changes[key]);

  if (settingsChanged) {
    chrome.storage.local.get([
      'serverUrl',
      'updateInterval',
      'enabledSites',
      'staleThresholdMs',
      'logLevel'
    ], (result) => {
      settings = normalizeSettings(result);
      log('info', 'Settings reloaded', { settings });
      startTimers();
      refreshBackendHealth();
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (activityRegistry[tabId]) {
    delete activityRegistry[tabId];
    persistActivityRegistry();
  }

  if (selectedTabId === tabId) {
    selectedTabId = null;
    chrome.storage.local.set({ selectedTabId });
    currentActivity = null;
    lastActivity = null;
    clearDiscordStatus();
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  activeTabId = activeInfo.tabId;
  markActiveActivity();
  log('debug', 'Active tab changed', { tabId: activeTabId });

  if (mode === 'auto' && isEnabled) {
    requestTabActivity(activeTabId);
    applyBestActivity();
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId !== activeTabId || !changeInfo.url) {
    return;
  }

  if (!isUrlSupported(changeInfo.url)) {
    delete activityRegistry[tabId];
    persistActivityRegistry();
  }

  if (mode === 'auto' && isEnabled) {
    requestTabActivity(tabId);
    applyBestActivity();
  }
});

function normalizeMode(value) {
  return value === 'manual' ? 'manual' : 'auto';
}

function normalizeTabId(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const tabId = Number(value);
  return Number.isFinite(tabId) ? tabId : null;
}

function normalizeSettings(values = {}) {
  const updateInterval = Math.min(
    60,
    Math.max(2, Number.parseInt(values.updateInterval, 10) || DEFAULT_UPDATE_INTERVAL_SECONDS)
  );
  const enabledSites = Array.isArray(values.enabledSites)
    ? values.enabledSites
    : String(values.enabledSites || DEFAULT_ENABLED_SITES.join(',')).split(',');
  const staleThresholdMs = Math.min(
    300000,
    Math.max(10000, Number.parseInt(values.staleThresholdMs, 10) || DEFAULT_STALE_THRESHOLD_MS)
  );
  const logLevel = LOG_LEVELS[values.logLevel] ? values.logLevel : 'info';

  return {
    serverUrl: normalizeServerUrl(values.serverUrl || DEFAULT_SERVER_URL),
    updateInterval,
    enabledSites: enabledSites.map(site => site.trim().toLowerCase()).filter(Boolean),
    staleThresholdMs,
    logLevel
  };
}

function normalizeServerUrl(url) {
  return String(url || DEFAULT_SERVER_URL).trim().replace(/\/+$/, '') || DEFAULT_SERVER_URL;
}

function startTimers() {
  if (pruneTimer) clearInterval(pruneTimer);
  if (healthTimer) clearInterval(healthTimer);
  if (tickTimer) clearInterval(tickTimer);

  pruneTimer = setInterval(pruneStaleActivities, 5000);
  healthTimer = setInterval(refreshBackendHealth, 15000);
  tickTimer = setInterval(() => {
    refreshOpenTabs();
    if (mode === 'auto' && isEnabled) {
      applyBestActivity();
    }
  }, settings.updateInterval * 1000);
}

function arrayToRegistry(entries) {
  const registry = {};
  for (const entry of entries) {
    const tabId = normalizeTabId(entry?.tabId);
    if (entry && tabId !== null) {
      registry[tabId] = { ...entry, tabId };
    }
  }
  return registry;
}

function registryToArray() {
  return Object.values(activityRegistry).sort((a, b) => {
    if (a.tabId === activeTabId && b.tabId !== activeTabId) return -1;
    if (b.tabId === activeTabId && a.tabId !== activeTabId) return 1;
    return b.lastSeen - a.lastSeen;
  });
}

function persistActivityRegistry() {
  chrome.storage.local.set({
    detectedActivities: registryToArray(),
    currentActivity,
    selectedTabId
  });
}

function pickAutoActivity() {
  const activeActivity = getFreshActiveActivity();
  if (activeActivity) {
    return activeActivity;
  }

  const entries = registryToArray();
  return entries.length > 0 ? entries[0] : null;
}

function applyBestActivity() {
  const selectedActivity = selectedTabId !== null ? activityRegistry[selectedTabId] : null;
  currentActivity = selectedActivity || pickAutoActivity();

  if (currentActivity) {
    updateDiscordStatus(currentActivity);
  } else {
    clearDiscordStatus();
  }
}

function getFreshActiveActivity() {
  if (activeTabId === null) {
    return null;
  }

  const activity = activityRegistry[activeTabId];
  if (!activity?.lastSeen) {
    return null;
  }

  if (Date.now() - activity.lastSeen > ACTIVE_TAB_GRACE_MS) {
    return null;
  }

  return activity;
}

function markActiveActivity() {
  for (const activity of Object.values(activityRegistry)) {
    activity.isActiveTab = activity.tabId === activeTabId;
  }
  persistActivityRegistry();
}

function pruneStaleActivities() {
  const now = Date.now();
  let changed = false;

  for (const [tabId, activity] of Object.entries(activityRegistry)) {
    if (!activity?.lastSeen || now - activity.lastSeen > settings.staleThresholdMs) {
      delete activityRegistry[tabId];
      changed = true;
    }
  }

  if (!changed) {
    return;
  }

  persistActivityRegistry();

  if (selectedTabId !== null && !activityRegistry[selectedTabId]) {
    selectedTabId = null;
    chrome.storage.local.set({ selectedTabId });
    currentActivity = null;
    lastActivity = null;
    clearDiscordStatus();
  }
}

function refreshOpenTabs() {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (!tab.id || !isUrlSupported(tab.url)) continue;
      requestTabActivity(tab.id);
    }
  });
}

function requestTabActivity(tabId) {
  chrome.tabs.sendMessage(tabId, { action: 'detectActivity' }, () => {
    const error = chrome.runtime.lastError;
    if (error && !/Receiving end does not exist/i.test(error.message || '')) {
      log('debug', 'Tab refresh failed', { tabId, error: error.message });
    }
  });
}

function syncActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    activeTabId = Number.isFinite(tab?.id) ? tab.id : null;
    markActiveActivity();
    if (activeTabId !== null) {
      requestTabActivity(activeTabId);
    }
  });
}

function isUrlSupported(url = '') {
  if (!/^https?:\/\//i.test(url)) return false;
  return settings.enabledSites.some(site => url.toLowerCase().includes(site));
}

function isSiteEnabled(activity, url = '') {
  if (settings.enabledSites.length === 0) return true;
  const platform = String(activity?.platform || '').toLowerCase().replace(/\s+/g, '');
  const haystack = `${platform} ${url}`.toLowerCase();
  return settings.enabledSites.some(site => haystack.includes(site));
}

// Update Discord status
async function updateDiscordStatus(activity) {
  if (!isEnabled) {
    return;
  }

  if (JSON.stringify(activity) === JSON.stringify(lastActivity)) {
    return; // Activity hasn't changed
  }
  
  lastActivity = activity;
  
  try {
    const serverUrl = settings.serverUrl;
    log('info', 'Updating Discord status', {
      platform: activity.platform,
      details: activity.details,
      state: activity.state,
      serverUrl
    });
    
    // Store activity for popup to display
    chrome.storage.local.set({ currentActivity: activity });
    
    // Send to backend
    const response = await fetch(`${serverUrl}/api/update-activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(activity)
    });

    if (!response.ok) {
      chrome.storage.local.set({ backendStatus: 'unreachable' });
      log('warn', 'Backend rejected activity update', { status: response.status });
      return;
    }

    chrome.storage.local.set({ backendStatus: 'connected' });
    log('info', 'Activity sent successfully');
  } catch (error) {
    chrome.storage.local.set({ backendStatus: 'unreachable' });
    log('warn', 'Backend not reachable', { error: error.message });
  }
}

async function clearDiscordStatus() {
  try {
    const serverUrl = settings.serverUrl;

    await fetch(`${serverUrl}/api/clear-activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    chrome.storage.local.set({ currentActivity: null });
    lastActivity = null;
    log('info', 'Activity cleared');
  } catch (error) {
    chrome.storage.local.set({ currentActivity: null });
    log('warn', 'Failed to clear activity', { error: error.message });
  }
}

async function refreshBackendHealth() {
  try {
    const serverUrl = settings.serverUrl;

    const response = await fetch(`${serverUrl}/health`, { cache: 'no-store' });
    if (!response.ok) {
      chrome.storage.local.set({ backendStatus: 'unreachable', discordRpcStatus: 'disconnected' });
      log('warn', 'Health check failed', { status: response.status });
      return;
    }

    const health = await response.json();
    chrome.storage.local.set({
      backendStatus: 'connected',
      discordRpcStatus: health.discord_rpc || 'disconnected'
    });
    log('debug', 'Health check passed', { discordRpcStatus: health.discord_rpc || 'disconnected' });
  } catch (error) {
    chrome.storage.local.set({ backendStatus: 'unreachable', discordRpcStatus: 'disconnected' });
    log('debug', 'Health check could not reach backend', { error: error.message });
  }
}

function log(level, message, details = {}) {
  const normalizedLevel = LOG_LEVELS[level] ? level : 'info';
  const currentLevel = settings?.logLevel || 'info';

  if (LOG_LEVELS[normalizedLevel] >= LOG_LEVELS[currentLevel]) {
    const consoleMethod = normalizedLevel === 'error'
      ? 'error'
      : normalizedLevel === 'warn'
        ? 'warn'
        : 'log';
    console[consoleMethod](`[Background] ${message}`, details);
  }

  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: new Date().toISOString(),
    level: normalizedLevel,
    message,
    details
  };

  chrome.storage.local.get(['activityLogs'], (result) => {
    const logs = Array.isArray(result.activityLogs) ? result.activityLogs : [];
    logs.unshift(entry);
    chrome.storage.local.set({ activityLogs: logs.slice(0, MAX_LOG_ENTRIES) });
  });
}
