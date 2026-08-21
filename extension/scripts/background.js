// Background Service Worker

const DEFAULT_SERVER_URL = 'http://localhost:17654';
const LEGACY_SERVER_URL = 'http://localhost:3000';
const BACKEND_CANDIDATE_URLS = [
  DEFAULT_SERVER_URL,
  'http://127.0.0.1:17654',
  LEGACY_SERVER_URL,
  'http://127.0.0.1:3000'
];
const DEFAULT_UPDATE_INTERVAL_SECONDS = 5;
const DEFAULT_STALE_THRESHOLD_MS = 30000;
const DEFAULT_AUTO_PICK_MODE = 'smart';
const DEFAULT_ENABLED_SITES = [
  'youtube',
  'youtubemusic',
  'netflix',
  'primevideo',
  'hulu',
  'disneyplus',
  'appletv',
  'hotstar',
  'crunchyroll',
  'spotify',
  'soundcloud',
  'applemusic',
  'bandcamp',
  'twitch',
  'discord',
  'meet',
  'github',
  'vscode',
  'linear',
  'jira',
  'notion',
  'googledocs',
  'figma',
  'canva',
  'chatgpt',
  'coursera',
  'udemy',
  'khanacademy',
  'leetcode',
  'reddit',
  'twitter',
  'instagram',
  'linkedin',
  'steam',
  'chess',
  'lichess',
  'skribbl',
  'geoguessr',
  'google',
  'wikipedia'
];
const DEFAULT_REQUIRE_PLAYING_SITES = [];
const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_LOG_ENTRIES = 80;
const ACTIVE_TAB_GRACE_MS = 45000;
const EXTENSION_VERSION = chrome.runtime.getManifest().version;
const CONTENT_SCRIPT_FILES = {
  youtube: ['scripts/youtube.js'],
  netflix: ['scripts/netflix.js'],
  spotify: ['scripts/spotify.js'],
  meet: ['scripts/googlemeet.js'],
  generic: ['scripts/generic.js']
};

let isEnabled = true;
let mode = 'auto';
let autoPickMode = DEFAULT_AUTO_PICK_MODE;
let currentActivity = null;
let lastActivity = null;
let selectedTabId = null;
let activeTabId = null;
let companionManualModeActive = false;
let activityRegistry = {};
let pruneTimer = null;
let healthTimer = null;
let tickTimer = null;
let settings = {
  serverUrl: DEFAULT_SERVER_URL,
  updateInterval: DEFAULT_UPDATE_INTERVAL_SECONDS,
  enabledSites: DEFAULT_ENABLED_SITES,
  staleThresholdMs: DEFAULT_STALE_THRESHOLD_MS,
  logLevel: 'info',
  privacyMode: 'normal',
  incognitoNever: true,
  requirePlayingSites: DEFAULT_REQUIRE_PLAYING_SITES,
  blockedDomains: [],
  pauseDuringMeetings: false
};

log('info', 'Service worker started');

// Initialize
chrome.storage.local.get([
  'enabled',
  'mode',
  'autoPickMode',
  'selectedTabId',
  'detectedActivities',
  'serverUrl',
  'updateInterval',
  'enabledSites',
  'staleThresholdMs',
  'logLevel',
  'privacyMode',
  'incognitoNever',
  'requirePlayingSites',
  'requirePlayingConfigured',
  'blockedDomains',
  'pauseDuringMeetings'
], (result) => {
  isEnabled = result.enabled !== false;
  mode = normalizeMode(result.mode);
  autoPickMode = normalizeAutoPickMode(result.autoPickMode);
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
  if (request.action === 'clearLogs') {
    chrome.storage.local.set({ activityLogs: [] }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  log('debug', 'Message received', { action: request.action, from: sender.url || sender.tab?.url || 'extension' });
  
  if (request.action === 'toggleStatus') {
    isEnabled = Boolean(request.enabled);
    chrome.storage.local.set({ enabled: isEnabled });
    log('info', 'Status toggled', { enabled: isEnabled });

    if (!isEnabled) {
      currentActivity = null;
      clearDiscordStatus();
    } else if (mode === 'auto') {
      refreshOpenTabs();
      applyBestActivity();
    }
  } else if (request.action === 'changeMode') {
    mode = normalizeMode(request.mode);
    chrome.storage.local.set({ mode });
    log('info', 'Mode changed', { mode });

    if (mode === 'auto') {
      companionManualModeActive = false;
      selectedTabId = null;
      chrome.storage.local.set({ selectedTabId: null, companionSelectedActivityId: null });
      clearCompanionSelection();
      applyBestActivity();
    }
  } else if (request.action === 'changeAutoPickMode') {
    autoPickMode = normalizeAutoPickMode(request.autoPickMode);
    chrome.storage.local.set({ autoPickMode });
    log('info', 'Auto pick mode changed', { autoPickMode });

    if (mode === 'auto' && isEnabled) {
      applyBestActivity();
    }
  } else if (request.action === 'setEnabledSites') {
    const enabledSites = Array.isArray(request.enabledSites)
      ? request.enabledSites.map(site => String(site).trim().toLowerCase()).filter(Boolean)
      : DEFAULT_ENABLED_SITES;
    settings = { ...settings, enabledSites };
    chrome.storage.local.set({ enabledSites });
    log('info', 'Enabled sites changed', { enabledSites });
    removeDisabledActivities();
    refreshOpenTabs();

    if (mode === 'auto' && isEnabled) {
      applyBestActivity();
    }
  } else if (request.action === 'setPrivacyMode') {
    const privacyMode = normalizePrivacyMode(request.privacyMode);
    settings = { ...settings, privacyMode };
    chrome.storage.local.set({ privacyMode });
    log('info', 'Privacy mode changed', { privacyMode });
    applyBestActivity();
  } else if (request.action === 'setRequirePlayingSites') {
    const requirePlayingSites = Array.isArray(request.requirePlayingSites)
      ? normalizeStringList(request.requirePlayingSites)
      : DEFAULT_REQUIRE_PLAYING_SITES;
    settings = { ...settings, requirePlayingSites };
    chrome.storage.local.set({ requirePlayingSites, requirePlayingConfigured: true });
    log('info', 'Playing-only rules changed', { requirePlayingSites });
    applyBestActivity();
  } else if (request.action === 'setManualActivity') {
    if (!isEnabled) {
      log('warn', 'Manual activity ignored while disabled');
      sendResponse({ ok: false, reason: 'disabled' });
      return;
    }

    const activityName = String(request.title || request.activity || 'Custom Status').trim();
    const details = String(request.message || 'Custom activity').trim();
    const state = String(request.submessage || '').trim();

    currentActivity = {
      id: 'manual:extension',
      activityName,
      details,
      state,
      largeImageKey: 'manual',
      largeImageText: 'Custom Browser Presence',
      platform: 'Manual',
      lastSeen: Date.now()
    };
    mode = 'manual';
    companionManualModeActive = false;
    selectedTabId = null;
    chrome.storage.local.set({ mode, selectedTabId: null, companionSelectedActivityId: currentActivity.id });
    log('info', 'Manual activity set', { title: currentActivity.activityName });
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
      companionManualModeActive = false;
      mode = 'auto';
      chrome.storage.local.set({ mode });
      clearCompanionSelection();
      applyBestActivity();
      sendResponse({ ok: true });
      return;
    }

    const selectedActivity = activityRegistry[selectedTabId];
    if (selectedActivity) {
      mode = 'auto';
      companionManualModeActive = false;
      chrome.storage.local.set({ mode, companionSelectedActivityId: selectedActivity.id || `tab:${selectedTabId}` });
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
      id: `tab:${tabId}`,
      tabId,
      tabTitle: sender.tab?.title || request.activity?.details || 'Unknown tab',
      sourceUrl: sender.tab?.url || request.activity?.url || '',
      lastSeen: Date.now(),
      isActiveTab: tabId === activeTabId
    };

    if (settings.incognitoNever && sender.tab?.incognito) {
      delete activityRegistry[tabId];
      persistActivityRegistry();
      log('debug', 'Activity ignored because tab is incognito', { tabId });
      sendResponse({ ok: false, reason: 'incognito-disabled' });
      return;
    }

    if (!isSiteEnabled(enrichedActivity, sender.tab?.url)) {
      delete activityRegistry[tabId];
      persistActivityRegistry();
      log('debug', 'Activity ignored because site is disabled', { tabId, platform: enrichedActivity.platform });
      sendResponse({ ok: false, reason: 'site-disabled' });
      return;
    }

    const ruleReason = getRuleBlockReason(enrichedActivity);
    if (ruleReason) {
      delete activityRegistry[tabId];
      persistActivityRegistry();
      log('debug', 'Activity ignored by rule', { tabId, reason: ruleReason, platform: enrichedActivity.platform });
      if (currentActivity?.tabId === tabId) {
        applyBestActivity();
      }
      sendResponse({ ok: false, reason: ruleReason });
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

    if (isEnabled && (mode === 'auto' || selectedTabId === tabId)) {
      applyBestActivity();
    }
  } else if (request.action === 'refreshSelectedActivity') {
    refreshOpenTabs();
    if (mode === 'auto' || selectedTabId !== null) {
      applyBestActivity();
    }
  } else if (request.action === 'refreshBackendHealth') {
    refreshBackendHealth();
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
    'logLevel',
    'privacyMode',
    'incognitoNever',
    'requirePlayingSites',
    'requirePlayingConfigured',
    'blockedDomains',
    'pauseDuringMeetings'
  ].some(key => changes[key]);

  if (settingsChanged) {
    chrome.storage.local.get([
      'serverUrl',
      'updateInterval',
      'enabledSites',
      'staleThresholdMs',
      'logLevel',
      'privacyMode',
      'incognitoNever',
      'requirePlayingSites',
      'requirePlayingConfigured',
      'blockedDomains',
      'pauseDuringMeetings'
    ], (result) => {
      settings = normalizeSettings(result);
      log('info', 'Settings reloaded', { settings });
      removeDisabledActivities();
      startTimers();
      refreshBackendHealth();
    });
  }

  if (changes.autoPickMode) {
    autoPickMode = normalizeAutoPickMode(changes.autoPickMode.newValue);
  }

  if (changes.mode) {
    mode = normalizeMode(changes.mode.newValue);
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

function normalizeAutoPickMode(value) {
  return value === 'active' ? 'active' : DEFAULT_AUTO_PICK_MODE;
}

function normalizePrivacyMode(value) {
  return ['normal', 'platform', 'private'].includes(value) ? value : 'normal';
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
  const privacyMode = normalizePrivacyMode(values.privacyMode);
  const incognitoNever = values.incognitoNever !== false;
  const requirePlayingSites = values.requirePlayingConfigured === true && Array.isArray(values.requirePlayingSites)
    ? normalizeStringList(values.requirePlayingSites)
    : DEFAULT_REQUIRE_PLAYING_SITES;
  const blockedDomains = Array.isArray(values.blockedDomains)
    ? normalizeStringList(values.blockedDomains)
    : String(values.blockedDomains || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  const pauseDuringMeetings = values.pauseDuringMeetings === true;

  return {
    serverUrl: normalizeServerUrl(values.serverUrl || DEFAULT_SERVER_URL),
    updateInterval,
    enabledSites: enabledSites.map(site => site.trim().toLowerCase()).filter(Boolean),
    staleThresholdMs,
    logLevel,
    privacyMode,
    incognitoNever,
    requirePlayingSites,
    blockedDomains,
    pauseDuringMeetings
  };
}

function normalizeStringList(values = []) {
  return values.map(value => String(value).trim().toLowerCase()).filter(Boolean);
}

function normalizeServerUrl(url) {
  return String(url || DEFAULT_SERVER_URL).trim().replace(/\/+$/, '') || DEFAULT_SERVER_URL;
}

function backendCandidates(preferredUrl = settings.serverUrl) {
  return [...new Set([
    normalizeServerUrl(preferredUrl),
    ...BACKEND_CANDIDATE_URLS.map(normalizeServerUrl)
  ])];
}

function looksLikeCompanionStatus(payload) {
  return payload && typeof payload === 'object' && typeof payload.discord_rpc === 'string';
}

async function fetchCompanionHealth(serverUrl) {
  const response = await fetch(`${serverUrl}/health`, {
    cache: 'no-store',
    redirect: 'manual'
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json().catch(() => null);
  return looksLikeCompanionStatus(payload) ? payload : null;
}

async function discoverBackendServer() {
  for (const serverUrl of backendCandidates()) {
    try {
      const health = await fetchCompanionHealth(serverUrl);
      if (!health) {
        continue;
      }

      if (settings.serverUrl !== serverUrl) {
        settings.serverUrl = serverUrl;
        chrome.storage.local.set({ serverUrl });
        log('info', 'Companion backend discovered', { serverUrl });
      }

      return { serverUrl, health };
    } catch (error) {
      log('debug', 'Companion discovery probe failed', { serverUrl, error: error.message });
    }
  }

  return null;
}

async function clearCompanionSelection() {
  const discovered = await discoverBackendServer();
  if (!discovered) return;

  try {
    await fetch(`${discovered.serverUrl}/api/select-activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedActivityId: null })
    });
  } catch (error) {
    log('debug', 'Could not clear companion selection', { error: error.message });
  }
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

  if (autoPickMode === 'active') {
    return null;
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

function removeDisabledActivities() {
  let changed = false;

  for (const [tabId, activity] of Object.entries(activityRegistry)) {
    if (!isSiteEnabled(activity, activity.sourceUrl || activity.url || '')) {
      delete activityRegistry[tabId];
      changed = true;
    }
  }

  if (!changed) {
    return;
  }

  if (selectedTabId !== null && !activityRegistry[selectedTabId]) {
    selectedTabId = null;
    currentActivity = null;
    lastActivity = null;
  }

  if (mode === 'auto' && currentActivity?.tabId && !activityRegistry[currentActivity.tabId]) {
    currentActivity = null;
    lastActivity = null;
  }

  persistActivityRegistry();
}

function refreshOpenTabs() {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (!tab.id || !isUrlSupported(tab.url)) continue;
      ensureTabDetector(tab);
    }
  });
}

function ensureTabDetector(tab) {
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { action: 'detectActivity' }, () => {
    const error = chrome.runtime.lastError;
    if (!error) return;

    if (!/Receiving end does not exist/i.test(error.message || '')) {
      log('debug', 'Tab refresh failed', { tabId: tab.id, error: error.message });
      return;
    }

    injectTabDetector(tab);
  });
}

function injectTabDetector(tab) {
  if (!chrome.scripting?.executeScript || !tab?.id) {
    return;
  }

  const files = contentScriptsForUrl(tab.url);
  if (!files.length) return;

  chrome.scripting.executeScript({ target: { tabId: tab.id }, files }, () => {
    const error = chrome.runtime.lastError;
    if (error) {
      if (!/Cannot access|No tab with id|The extensions gallery/i.test(error.message || '')) {
        log('debug', 'Content script injection skipped', { tabId: tab.id, error: error.message });
      }
      return;
    }
    requestTabActivity(tab.id);
  });
}

function contentScriptsForUrl(url = '') {
  const lowerUrl = String(url || '').toLowerCase();
  if (lowerUrl.includes('netflix.com')) return CONTENT_SCRIPT_FILES.netflix;
  if (lowerUrl.includes('youtube.com') && !lowerUrl.includes('music.youtube.com')) return CONTENT_SCRIPT_FILES.youtube;
  if (lowerUrl.includes('spotify.com')) return CONTENT_SCRIPT_FILES.spotify;
  if (lowerUrl.includes('meet.google.com')) return CONTENT_SCRIPT_FILES.meet;
  return CONTENT_SCRIPT_FILES.generic;
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
  if (isBlockedDomain(url)) return false;
  return settings.enabledSites.some(site => siteMatchesUrl(site, url));
}

function isSiteEnabled(activity, url = '') {
  if (settings.enabledSites.length === 0) return false;
  const platform = String(activity?.platform || '').toLowerCase().replace(/\s+/g, '');
  const haystack = `${platform} ${url}`.toLowerCase();
  return settings.enabledSites.some(site => haystack.includes(site) || siteMatchesUrl(site, url));
}

function siteMatchesUrl(site, url = '') {
  const key = String(site || '').toLowerCase();
  const lowerUrl = String(url || '').toLowerCase();
  const aliases = {
    youtubemusic: ['music.youtube.com'],
    primevideo: ['primevideo.com', 'amazon.com/gp/video'],
    disneyplus: ['disneyplus.com'],
    appletv: ['tv.apple.com'],
    applemusic: ['music.apple.com'],
    googledocs: ['docs.google.com'],
    vscode: ['vscode.dev', 'github.dev'],
    jira: ['atlassian.net'],
    twitter: ['x.com', 'twitter.com'],
    chess: ['chess.com']
  };
  return lowerUrl.includes(key) || (aliases[key] || []).some(alias => lowerUrl.includes(alias));
}

function siteKeyForActivity(activity = {}) {
  const platform = String(activity.platform || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const source = String(activity.sourceUrl || activity.url || '').toLowerCase();
  const aliases = {
    googlemeet: 'meet',
    ytmusic: 'youtubemusic',
    youtube: source.includes('music.youtube.com') ? 'youtubemusic' : 'youtube',
    appletv: 'appletv',
    applemusic: 'applemusic',
    googledocs: 'googledocs',
    visualstudiocode: 'vscode',
    x: 'twitter'
  };
  return aliases[platform] || platform || '';
}

function isBlockedDomain(url = '') {
  if (!settings.blockedDomains?.length) return false;
  let hostname = '';
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    hostname = String(url).toLowerCase();
  }
  return settings.blockedDomains.some(domain => hostname.includes(domain));
}

function getRuleBlockReason(activity) {
  if (settings.privacyMode === 'private') {
    return 'private-mode';
  }

  if (isBlockedDomain(activity.sourceUrl || activity.url || '')) {
    return 'blocked-domain';
  }

  const siteKey = siteKeyForActivity(activity);
  if (settings.requirePlayingSites.includes(siteKey) && activity.isPlaying === false) {
    return 'not-playing';
  }

  if (settings.pauseDuringMeetings && ['meet', 'googlemeet'].includes(siteKey)) {
    return 'meeting-paused';
  }

  return '';
}

function privacyTransformActivity(activity) {
  if (!activity || settings.privacyMode === 'private') return null;

  if (settings.privacyMode !== 'platform') {
    return activity;
  }

  const platform = activity.platform || 'Browser';
  const action = activity.isPlaying === false ? 'Paused on' : actionForPlatform(platform);
  return {
    ...activity,
    details: `${action} ${platform}`,
    state: 'Private mode',
    tabTitle: platform
  };
}

function actionForPlatform(platform = '') {
  const key = platform.toLowerCase();
  if (/spotify|soundcloud|music|bandcamp/.test(key)) return 'Listening on';
  if (/youtube|netflix|prime|hulu|disney|apple tv|hotstar|crunchyroll|twitch/.test(key)) return 'Watching';
  if (/github|vscode|linear|jira/.test(key)) return 'Working in';
  if (/wikipedia|coursera|udemy|khan|leetcode|docs|notion/.test(key)) return 'Reading';
  return 'Using';
}

// Update Discord status
async function updateDiscordStatus(activity) {
  if (!isEnabled) {
    return;
  }

  const displayActivity = privacyTransformActivity(activity);
  if (!displayActivity) {
    currentActivity = null;
    await clearDiscordStatus();
    return;
  }

  try {
    let serverUrl = settings.serverUrl;
    const activityChanged = JSON.stringify(displayActivity) !== JSON.stringify(lastActivity);
    log('info', 'Updating Discord status', {
      platform: displayActivity.platform,
      details: displayActivity.details,
      state: displayActivity.state,
      serverUrl
    });
    
    // Store activity for popup to display
    chrome.storage.local.set({ currentActivity: displayActivity });
    
    let response = await reportActivitiesToBackend(serverUrl, displayActivity);

    if (!response.ok) {
      const discovered = await discoverBackendServer();
      if (discovered && discovered.serverUrl !== serverUrl) {
        serverUrl = discovered.serverUrl;
        response = await reportActivitiesToBackend(serverUrl, displayActivity);
      }
    }

    if (!response.ok) {
      chrome.storage.local.set({
        backendStatus: 'connected',
        discordRpcStatus: response.status === 503 ? 'disconnected' : 'unknown'
      });
      log('warn', 'Backend rejected activity update', { status: response.status, serverUrl });
      return;
    }

    if (activityChanged) {
      lastActivity = displayActivity;
    }
    chrome.storage.local.set({ backendStatus: 'connected', discordRpcStatus: 'connected' });
    log('info', 'Activity sent successfully', { serverUrl });
  } catch (error) {
    chrome.storage.local.set({ backendStatus: 'unreachable' });
    log('warn', 'Backend not reachable', { error: error.message });
  }
}

function sendActivityToBackend(serverUrl, activity) {
  return fetch(`${serverUrl}/api/update-activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalizeActivityForBackend(activity))
  });
}

async function reportActivitiesToBackend(serverUrl, fallbackActivity) {
  const activities = registryToArray()
    .map(privacyTransformActivity)
    .filter(Boolean)
    .map(normalizeActivityForBackend);
  if (fallbackActivity && !activities.some(activity => activity.id === (fallbackActivity.id || `tab:${fallbackActivity.tabId}`))) {
    activities.unshift(normalizeActivityForBackend(fallbackActivity));
  }

  const selectedActivity = selectedTabId !== null ? activityRegistry[selectedTabId] : null;
  const fallbackId = fallbackActivity
    ? normalizeActivityForBackend(fallbackActivity).id
    : null;
  const body = {
    activities,
    selectedActivityId: selectedActivity?.id
      || (selectedTabId !== null ? `tab:${selectedTabId}` : null)
      || (mode === 'manual' && !companionManualModeActive ? fallbackId : null),
    autoPickMode
  };

  const response = await fetch(`${serverUrl}/api/report-activities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (response.status === 404) {
    return sendActivityToBackend(serverUrl, fallbackActivity);
  }

  return response;
}

function normalizeActivityForBackend(activity) {
  const tabId = normalizeTabId(activity?.tabId);
  return {
    ...activity,
    id: activity?.id || (tabId !== null ? `tab:${tabId}` : 'manual'),
    tabId,
    tabTitle: activity?.tabTitle || activity?.details || activity?.platform || 'Activity',
    sourceUrl: activity?.sourceUrl || activity?.url || '',
    isActiveTab: tabId !== null && tabId === activeTabId,
    lastSeen: activity?.lastSeen || Date.now()
  };
}

async function clearDiscordStatus() {
  try {
    const discovered = await discoverBackendServer();
    const serverUrl = discovered?.serverUrl || settings.serverUrl;

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
    const discovered = await discoverBackendServer();
    if (!discovered) {
      chrome.storage.local.set({ backendStatus: 'unreachable', discordRpcStatus: 'disconnected' });
      log('warn', 'Health check failed', { serverUrl: settings.serverUrl });
      return;
    }

    syncCompanionSelection(discovered.health);

    chrome.storage.local.set({
      backendStatus: 'connected',
      discordRpcStatus: discovered.health.discord_rpc || 'disconnected',
      companionVersion: discovered.health.companion_version || null,
      companionExpectedExtensionVersion: discovered.health.expected_extension_version || null,
      extensionVersion: EXTENSION_VERSION
    });
    log('debug', 'Health check passed', {
      serverUrl: discovered.serverUrl,
      discordRpcStatus: discovered.health.discord_rpc || 'disconnected'
    });
  } catch (error) {
    chrome.storage.local.set({
      backendStatus: 'unreachable',
      discordRpcStatus: 'disconnected',
      companionVersion: null,
      companionExpectedExtensionVersion: null,
      extensionVersion: EXTENSION_VERSION
    });
    log('debug', 'Health check could not reach backend', { error: error.message });
  }
}

function syncCompanionSelection(health = {}) {
  const selectedId = typeof health.selected_activity_id === 'string' && health.selected_activity_id.trim()
    ? health.selected_activity_id.trim()
    : null;
  const selectedTab = selectedId?.startsWith('tab:')
    ? normalizeTabId(selectedId.slice(4))
    : null;

  if (selectedId) {
    const isBrowserTabSelection = selectedId.startsWith('tab:');
    companionManualModeActive = !isBrowserTabSelection;
    mode = isBrowserTabSelection ? 'auto' : 'manual';
    selectedTabId = selectedTab;
    const companionActivity = activityFromCompanionSnapshot(health.last_activity);
    if (companionActivity) {
      currentActivity = companionActivity;
    }
    chrome.storage.local.set({
      mode,
      selectedTabId,
      companionSelectedActivityId: selectedId,
      ...(companionActivity ? { currentActivity: companionActivity } : {})
    });
    return;
  }

  chrome.storage.local.set({ companionSelectedActivityId: null });

  if (selectedTabId !== null) {
    companionManualModeActive = false;
    mode = 'auto';
    selectedTabId = null;
    chrome.storage.local.set({ mode, selectedTabId });
    if (isEnabled) {
      applyBestActivity();
    }
    return;
  }

  if (companionManualModeActive) {
    companionManualModeActive = false;
    mode = 'auto';
    selectedTabId = null;
    chrome.storage.local.set({ mode, selectedTabId });
    if (isEnabled) {
      applyBestActivity();
    }
  }
}

function activityFromCompanionSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }

  return {
    id: snapshot.id || null,
    tabId: normalizeTabId(snapshot.tabId),
    tabTitle: snapshot.tabTitle || snapshot.details || snapshot.platform || 'Activity',
    platform: snapshot.platform || 'Activity',
    details: snapshot.details || 'Activity',
    state: snapshot.state || 'Active',
    url: snapshot.url || '',
    sourceUrl: snapshot.url || '',
    largeImageKey: snapshot.largeImageKey || null,
    smallImageKey: snapshot.smallImageKey || null,
    isActiveTab: Boolean(snapshot.isActiveTab),
    lastSeen: Date.now()
  };
}

function log(level, message, details = {}) {
  const normalizedLevel = LOG_LEVELS[level] ? level : 'info';
  const currentLevel = settings?.logLevel || 'info';
  const shouldStore = LOG_LEVELS[normalizedLevel] >= LOG_LEVELS[currentLevel];

  if (shouldStore) {
    const consoleMethod = normalizedLevel === 'error'
      ? 'error'
      : normalizedLevel === 'warn'
        ? 'warn'
        : 'log';
    console[consoleMethod](`[Background] ${message}`, details);
  }

  if (!shouldStore) {
    return;
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
