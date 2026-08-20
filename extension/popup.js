// Popup script for Discord Activity Status extension

const toggleBtn = document.getElementById('toggleBtn');
const statusDiv = document.getElementById('status');
const modeBtns = document.querySelectorAll('.mode-btn');
const pickBtns = document.querySelectorAll('.pick-btn');
const autoPickSection = document.getElementById('autoPickSection');
const manualSection = document.getElementById('manualSection');
const manualTitleInput = document.getElementById('manualTitleInput');
const manualMessageInput = document.getElementById('manualMessageInput');
const setActivityBtn = document.getElementById('setActivityBtn');
const settingsBtn = document.getElementById('settingsBtn');
const reconnectBtn = document.getElementById('reconnectBtn');
const refreshBtn = document.getElementById('refreshBtn');
const clearBtn = document.getElementById('clearBtn');
const clearSelectionBtn = document.getElementById('clearSelectionBtn');
const clearLogsBtn = document.getElementById('clearLogsBtn');
const allSitesBtn = document.getElementById('allSitesBtn');
const supportBtn = document.getElementById('supportBtn');
const repoBtn = document.getElementById('repoBtn');
const setupGuideBtn = document.getElementById('setupGuideBtn');
const tabList = document.getElementById('tabList');
const logList = document.getElementById('logList');
const siteList = document.getElementById('siteList');
const activitySearchInput = document.getElementById('activitySearchInput');
const selectedTabLabel = document.getElementById('selectedTabLabel');
const rpcHealthBadge = document.getElementById('rpcHealthBadge');
const rpcHealthText = document.getElementById('rpcHealthText');
const setupChecklist = document.getElementById('setupChecklist');
const quickStart = document.getElementById('quickStart');
const quickStartBtn = document.getElementById('quickStartBtn');
const quickStartGuide = document.getElementById('quickStartGuide');
const quickStartClose = document.getElementById('quickStartClose');
const toastRoot = document.getElementById('toastRoot');

const REPO_URL = 'https://github.com/GSUS2K/discord-status';
const ISSUES_URL = `${REPO_URL}/issues`;
const COMPANION_URL = `${REPO_URL}/releases/latest`;
const SETUP_GUIDE_URL = 'https://gsus2k.github.io/discord-status/';
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
const SUPPORTED_SITES = [
  ['youtube', 'YouTube'],
  ['youtubemusic', 'YT Music'],
  ['netflix', 'Netflix'],
  ['primevideo', 'Prime Video'],
  ['hulu', 'Hulu'],
  ['disneyplus', 'Disney+'],
  ['appletv', 'Apple TV'],
  ['spotify', 'Spotify'],
  ['soundcloud', 'SoundCloud'],
  ['applemusic', 'Apple Music'],
  ['bandcamp', 'Bandcamp'],
  ['twitch', 'Twitch'],
  ['discord', 'Discord'],
  ['meet', 'Meet'],
  ['github', 'GitHub'],
  ['vscode', 'VS Code'],
  ['linear', 'Linear'],
  ['jira', 'Jira'],
  ['notion', 'Notion'],
  ['googledocs', 'Docs'],
  ['figma', 'Figma'],
  ['canva', 'Canva'],
  ['chatgpt', 'ChatGPT'],
  ['coursera', 'Coursera'],
  ['udemy', 'Udemy'],
  ['khanacademy', 'Khan'],
  ['leetcode', 'LeetCode'],
  ['reddit', 'Reddit'],
  ['twitter', 'X/Twitter'],
  ['instagram', 'Instagram'],
  ['linkedin', 'LinkedIn'],
  ['steam', 'Steam'],
  ['chess', 'Chess.com'],
  ['lichess', 'Lichess'],
  ['skribbl', 'Skribbl'],
  ['geoguessr', 'GeoGuessr'],
  ['hotstar', 'Hotstar'],
  ['crunchyroll', 'Crunchyroll'],
  ['google', 'Google'],
  ['wikipedia', 'Wikipedia']
];
const SITE_ICON_ALIASES = {
  googlemeet: 'meet',
  manualactivity: 'manual',
  youtubemusic: 'youtube',
  primevideo: 'manual',
  disney: 'manual',
  disneyplus: 'manual',
  appletv: 'manual',
  applemusic: 'manual',
  soundcloud: 'manual',
  bandcamp: 'manual',
  vscode: 'github',
  visualstudiocode: 'github',
  googledocs: 'google',
  twitter: 'manual',
  x: 'manual'
};

chrome.storage.local.get(['enabled', 'mode', 'autoPickMode'], (result) => {
  updateToggle(result.enabled !== false);
  updateMode(result.mode || 'auto');
  updateAutoPickMode(result.autoPickMode || 'smart');
});

function sendRuntimeMessage(message) {
  chrome.runtime.sendMessage(message, () => {
    const error = chrome.runtime.lastError;
    if (error && !isBenignMessageError(error.message)) {
      console.warn('[Popup] Message failed:', error.message);
    }
  });
}

function isBenignMessageError(message = '') {
  return /message port closed before a response was received/i.test(message);
}

function updateStatus() {
  chrome.storage.local.get(['currentActivity'], (result) => {
    const activity = result.currentActivity;
    if (!activity) {
      statusDiv.classList.add('empty');
      statusDiv.textContent = 'No activity detected yet. Open a supported tab or set a manual activity.';
      return;
    }

    statusDiv.classList.remove('empty');
    statusDiv.textContent = '';

    const row = document.createElement('div');
    row.className = 'activity-row';

    const icon = createSiteIcon(activity.platform);
    const copy = document.createElement('div');
    copy.className = 'activity-copy';

    const platform = document.createElement('div');
    platform.className = 'activity-platform';
    platform.textContent = activity.platform || 'Browser';

    const details = document.createElement('div');
    details.className = 'activity-details';
    details.textContent = activity.details || 'Unknown activity';

    const state = document.createElement('div');
    state.className = 'activity-state';
    state.textContent = activity.state || 'Active';

    const artwork = createActivityArtwork(activity);
    copy.append(platform, details, state);
    row.append(icon, copy, artwork);
    statusDiv.append(row);
  });
}

function updateSelectedTabLabel() {
  chrome.storage.local.get(['selectedTabId', 'detectedActivities', 'companionSelectedActivityId', 'currentActivity'], (result) => {
    const companionSelectedActivityId = typeof result.companionSelectedActivityId === 'string'
      ? result.companionSelectedActivityId
      : null;
    const selectedTabId = normalizeTabId(result.selectedTabId);
    const activities = Array.isArray(result.detectedActivities) ? result.detectedActivities : [];
    const selectedActivity = activities.find(activity => normalizeTabId(activity.tabId) === selectedTabId);

    if (companionSelectedActivityId && selectedTabId === null) {
      const activity = result.currentActivity;
      selectedTabLabel.textContent = activity
        ? `Manual: ${activity.platform || 'Activity'} - ${activity.details || 'Selected in companion'}`
        : 'Manual: selected in companion';
      return;
    }

    if (selectedTabId === null) {
      const activeActivity = activities.find(activity => activity.isActiveTab);
      if (activeActivity) {
        selectedTabLabel.textContent = `Auto: current tab - ${activeActivity.tabTitle || activeActivity.platform || 'Detected activity'}`;
        return;
      }

      selectedTabLabel.textContent = 'Auto: waiting for the current tab, then falling back to recent activity';
      return;
    }

    if (!selectedActivity) {
      selectedTabLabel.textContent = 'Selected tab: Waiting for that tab to report again';
      return;
    }

    const tabTitle = selectedActivity.tabTitle || selectedActivity.platform || 'Unknown';
    selectedTabLabel.textContent = `Selected tab: ${tabTitle}`;
  });
}

function updateRpcHealthBadge() {
  chrome.storage.local.get([
    'discordRpcStatus',
    'backendStatus',
    'companionVersion',
    'companionExpectedExtensionVersion',
    'extensionVersion'
  ], (result) => {
    const rpcStatus = result.discordRpcStatus || 'disconnected';
    const backendStatus = result.backendStatus || 'unreachable';
    const versionInfo = {
      extensionVersion: result.extensionVersion || chrome.runtime.getManifest().version,
      companionVersion: result.companionVersion || null,
      companionExpectedExtensionVersion: result.companionExpectedExtensionVersion || null
    };

    rpcHealthBadge.classList.remove('connected', 'disconnected');

    if (backendStatus !== 'connected') {
      rpcHealthBadge.classList.add('disconnected');
      rpcHealthText.textContent = 'Backend offline';
      renderSetupChecklist(backendStatus, rpcStatus, versionInfo);
      return;
    }

    if (rpcStatus === 'connected') {
      rpcHealthBadge.classList.add('connected');
      rpcHealthText.textContent = 'Discord connected';
      renderSetupChecklist(backendStatus, rpcStatus, versionInfo);
      return;
    }

    rpcHealthBadge.classList.add('disconnected');
    rpcHealthText.textContent = 'Discord disconnected';
    renderSetupChecklist(backendStatus, rpcStatus, versionInfo);
  });
}

function renderSetupChecklist(backendStatus, rpcStatus, versionInfo = {}) {
  if (!setupChecklist) return;
  const versionOk = backendStatus === 'connected'
    && versionInfo.companionVersion
    && versionInfo.companionExpectedExtensionVersion === versionInfo.extensionVersion;
  const rows = [
    ['Extension installed', true, 'Ready'],
    ['Companion running', backendStatus === 'connected', backendStatus === 'connected' ? 'Online' : 'Install or start'],
    ['Discord desktop connected', backendStatus === 'connected' && rpcStatus === 'connected', rpcStatus === 'connected' ? 'Connected' : 'Open Discord'],
    [
      'Version match',
      versionOk,
      versionInfo.companionVersion
        ? `Ext ${versionInfo.extensionVersion} / App ${versionInfo.companionVersion}`
        : `Ext ${versionInfo.extensionVersion}`
    ]
  ];

  setupChecklist.textContent = '';
  for (const [label, ok, action] of rows) {
    const row = document.createElement('div');
    row.className = `check-row${ok ? ' ok' : ''}`;
    row.innerHTML = `<span class="check-dot"></span><span>${label}</span><strong>${action}</strong>`;
    setupChecklist.appendChild(row);
  }

  if (backendStatus !== 'connected') {
    const install = document.createElement('button');
    install.className = 'setup-link';
    install.textContent = 'Install the companion app';
    install.addEventListener('click', () => chrome.tabs.create({ url: COMPANION_URL }));
    setupChecklist.appendChild(install);
  } else if (!versionOk) {
    const update = document.createElement('button');
    update.className = 'setup-link';
    update.textContent = 'Update the companion app and extension';
    update.addEventListener('click', () => chrome.tabs.create({ url: COMPANION_URL }));
    setupChecklist.appendChild(update);
  }
}

function renderDetectedTabs() {
  chrome.storage.local.get(['detectedActivities', 'selectedTabId'], (result) => {
    const activities = Array.isArray(result.detectedActivities) ? result.detectedActivities : [];
    const selectedTabId = normalizeTabId(result.selectedTabId);
    const query = String(activitySearchInput?.value || '').trim().toLowerCase();

    tabList.textContent = '';

    if (activities.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No supported tabs have reported activity yet.';
      tabList.appendChild(empty);
      return;
    }

    const sortedActivities = [...activities].sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    const filteredActivities = query
      ? sortedActivities.filter(activity => matchesActivitySearch(activity, query))
      : sortedActivities;

    if (filteredActivities.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = query ? 'No matching activity found.' : 'No tabs detected yet.';
      tabList.appendChild(empty);
      return;
    }

    for (const activity of filteredActivities) {
      const tabId = normalizeTabId(activity.tabId);
      const isSelected = tabId !== null && tabId === selectedTabId;
      const card = document.createElement('div');
      card.className = `tab-card${isSelected ? ' active' : ''}`;

      const main = document.createElement('div');
      main.className = 'tab-main';

      const icon = createSiteIcon(activity.platform);

      const artwork = createActivityArtwork(activity);

      const info = document.createElement('div');
      info.className = 'tab-info';

      const title = document.createElement('div');
      title.className = 'tab-title';
      title.textContent = `${activity.isActiveTab ? 'Current - ' : ''}${activity.platform || 'Browser'} - ${activity.details || 'Unknown activity'}`;

      const subtitle = document.createElement('div');
      subtitle.className = 'tab-subtitle';
      subtitle.textContent = formatSubtitle(activity);

      info.append(title, subtitle);
      main.append(icon, info, artwork);

      const button = document.createElement('button');
      button.className = `tab-select${isSelected ? ' active' : ''}`;
      button.textContent = isSelected ? 'Selected' : 'Use';
      button.disabled = tabId === null;
      button.addEventListener('click', () => {
        sendRuntimeMessage({ action: 'selectActivityTab', tabId });
        showToast(`Showing ${activity.platform || 'activity'} in Discord`);
      });

      card.append(main, button);
      tabList.appendChild(card);
    }
  });
}

function createActivityArtwork(activity) {
  const image = document.createElement('img');
  image.className = 'activity-artwork hidden';
  image.alt = '';
  const source = String(activity.thumbnailUrl || '').trim();
  if (!/^https?:\/\//i.test(source)) return image;
  image.src = source;
  image.addEventListener('load', () => image.classList.remove('hidden'), { once: true });
  image.addEventListener('error', () => image.remove(), { once: true });
  return image;
}

function renderSiteToggles() {
  chrome.storage.local.get(['enabledSites'], (result) => {
    const enabled = new Set(Array.isArray(result.enabledSites)
      ? result.enabledSites
      : DEFAULT_ENABLED_SITES);

    siteList.textContent = '';

    for (const [value, label] of SUPPORTED_SITES) {
      const chip = document.createElement('label');
      chip.className = 'site-chip';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = value;
      input.checked = enabled.has(value);
      input.addEventListener('change', saveSiteToggles);

      const text = document.createElement('span');
      text.textContent = label;

      chip.append(input, createSiteIcon(value), text);
      siteList.appendChild(chip);
    }
  });
}

function createSiteIcon(platform) {
  const key = siteIconKey(platform);
  const img = document.createElement('img');
  img.className = 'site-icon';
  img.alt = `${platform || 'Activity'} logo`;
  img.src = chrome.runtime.getURL(`site-icons/${key}.png`);
  img.addEventListener('error', () => {
    img.src = makeFallbackIcon(platform);
  }, { once: true });
  return img;
}

function makeFallbackIcon(platform = 'Activity') {
  const label = String(platform || 'Activity').trim();
  const letters = label
    .replace(/[^a-z0-9\s+]/gi, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0].toUpperCase())
    .join('') || 'A';
  const hue = Math.abs([...label].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="hsl(${hue} 58% 24%)"/><circle cx="50" cy="14" r="7" fill="hsl(${(hue + 120) % 360} 80% 58%)"/><text x="32" y="39" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="22" font-weight="800" fill="#fff">${letters}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function siteIconKey(platform = '') {
  const normalized = String(platform)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return SITE_ICON_ALIASES[normalized] || normalized || 'manual';
}

function renderLogs() {
  chrome.storage.local.get(['activityLogs'], (result) => {
    const logs = Array.isArray(result.activityLogs) ? result.activityLogs : [];
    logList.textContent = '';

    if (logs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No logs yet.';
      logList.appendChild(empty);
      return;
    }

    for (const entry of logs.slice(0, 12)) {
      const line = document.createElement('div');
      line.className = `log-line ${entry.level || 'info'}`;
      line.title = JSON.stringify(entry.details || {});
      line.textContent = `${formatTime(entry.timestamp)} ${String(entry.level || 'info').toUpperCase()} ${entry.message}`;
      logList.appendChild(line);
    }
  });
}

toggleBtn.addEventListener('click', () => {
  chrome.storage.local.get(['enabled'], (result) => {
    const currentlyEnabled = result.enabled !== false;
    const newState = !currentlyEnabled;
    chrome.storage.local.set({ enabled: newState });
    updateToggle(newState);
    sendRuntimeMessage({ action: 'toggleStatus', enabled: newState });
    showToast(newState ? 'Discord status enabled' : 'Discord status paused');
  });
});

function updateToggle(enabled) {
  toggleBtn.classList.toggle('active', enabled);
  toggleBtn.setAttribute('aria-pressed', String(enabled));
}

modeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    chrome.storage.local.set({ mode });
    updateMode(mode);
    sendRuntimeMessage({ action: 'changeMode', mode });
    showToast(mode === 'manual' ? 'Manual mode enabled' : 'Auto detect enabled');
  });
});

pickBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const autoPickMode = btn.dataset.autoPickMode;
    chrome.storage.local.set({ autoPickMode });
    updateAutoPickMode(autoPickMode);
    sendRuntimeMessage({ action: 'changeAutoPickMode', autoPickMode });
    showToast(autoPickMode === 'active' ? 'Only active tab will update' : 'Smart auto pick enabled');
  });
});

function updateMode(mode) {
  modeBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  manualSection.style.display = mode === 'manual' ? 'grid' : 'none';
  autoPickSection.style.display = mode === 'auto' ? 'grid' : 'none';
}

function updateAutoPickMode(autoPickMode) {
  const normalized = autoPickMode === 'active' ? 'active' : 'smart';
  pickBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.autoPickMode === normalized);
  });
}

setActivityBtn.addEventListener('click', () => {
  const title = manualTitleInput.value.trim();
  const message = manualMessageInput.value.trim();
  if (!title && !message) return;

  sendRuntimeMessage({
    action: 'setManualActivity',
    title,
    message
  });
  manualTitleInput.value = '';
  manualMessageInput.value = '';
  showToast('Manual activity sent');
});

for (const input of [manualTitleInput, manualMessageInput]) {
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      setActivityBtn.click();
    }
  });
}

settingsBtn.addEventListener('click', async () => {
  try {
    if (chrome.runtime.openOptionsPage) {
      await chrome.runtime.openOptionsPage();
      return;
    }

    await chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
  } catch (error) {
    console.error('[Popup] Failed to open settings page:', error);
  }
});

reconnectBtn.addEventListener('click', () => {
  sendRuntimeMessage({ action: 'refreshBackendHealth' });
  showToast('Checking companion connection');
});

refreshBtn.addEventListener('click', () => {
  sendRuntimeMessage({ action: 'refreshSelectedActivity' });
  showToast('Refreshing detected tabs');
});

clearBtn.addEventListener('click', () => {
  sendRuntimeMessage({ action: 'clearActivity' });
  showToast('Discord activity cleared');
});

clearSelectionBtn.addEventListener('click', () => {
  sendRuntimeMessage({ action: 'selectActivityTab', tabId: null });
  showToast('Companion returned to auto pick');
});

clearLogsBtn.addEventListener('click', () => {
  chrome.storage.local.set({ activityLogs: [] }, () => {
    renderLogs();
    sendRuntimeMessage({ action: 'clearLogs' });
    showToast('Logs cleared');
  });
});

allSitesBtn.addEventListener('click', () => {
  chrome.storage.local.set({ enabledSites: DEFAULT_ENABLED_SITES }, () => {
    renderSiteToggles();
    sendRuntimeMessage({ action: 'setEnabledSites', enabledSites: DEFAULT_ENABLED_SITES });
    showToast('All supported sites enabled');
  });
});

supportBtn.addEventListener('click', () => chrome.tabs.create({ url: ISSUES_URL }));
repoBtn.addEventListener('click', () => chrome.tabs.create({ url: REPO_URL }));
setupGuideBtn.addEventListener('click', () => chrome.tabs.create({ url: SETUP_GUIDE_URL }));
quickStartBtn.addEventListener('click', () => quickStart.removeAttribute('hidden'));
quickStartClose.addEventListener('click', () => {
  quickStart.setAttribute('hidden', '');
  chrome.storage.local.set({ quickStartSeen: true });
});
quickStartGuide.addEventListener('click', () => chrome.tabs.create({ url: SETUP_GUIDE_URL }));

chrome.storage.local.get(['quickStartSeen'], result => {
  if (!result.quickStartSeen) quickStart.removeAttribute('hidden');
});

function saveSiteToggles() {
  const enabledSites = Array.from(siteList.querySelectorAll('input[type="checkbox"]:checked'))
    .map(input => input.value);
  chrome.storage.local.set({ enabledSites }, () => {
    sendRuntimeMessage({ action: 'setEnabledSites', enabledSites });
    showToast('Site toggles saved');
  });
}

function showToast(message, type = 'info') {
  if (!toastRoot || !message) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastRoot.appendChild(toast);
  setTimeout(() => toast.classList.add('visible'), 10);
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 180);
  }, 2200);
}

function normalizeTabId(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const tabId = Number(value);
  return Number.isFinite(tabId) ? tabId : null;
}

function formatSubtitle(activity) {
  const parts = [
    activity.state,
    activity.lastSeen ? `${Math.max(0, Math.round((Date.now() - activity.lastSeen) / 1000))}s ago` : ''
  ].filter(Boolean);
  return parts.join(' - ');
}

function matchesActivitySearch(activity, query) {
  const haystack = [
    activity.platform,
    activity.details,
    activity.state,
    activity.tabTitle,
    activity.sourceUrl
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(query);
}

function formatTime(timestamp) {
  const date = timestamp ? new Date(timestamp) : new Date();
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function refreshUi() {
  updateStatus();
  renderDetectedTabs();
  updateSelectedTabLabel();
  updateRpcHealthBadge();
  renderLogs();
}

renderSiteToggles();
sendRuntimeMessage({ action: 'refreshBackendHealth' });
refreshUi();
setInterval(refreshUi, 2000);
setInterval(() => sendRuntimeMessage({ action: 'refreshBackendHealth' }), 5000);

if (activitySearchInput) {
  activitySearchInput.addEventListener('input', () => renderDetectedTabs());
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes.enabled) {
    updateToggle(changes.enabled.newValue !== false);
  }

  if (changes.mode) {
    updateMode(changes.mode.newValue || 'auto');
  }

  if (changes.autoPickMode) {
    updateAutoPickMode(changes.autoPickMode.newValue || 'smart');
  }

  if (changes.enabledSites) {
    renderSiteToggles();
  }

  refreshUi();
});
