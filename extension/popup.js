// Popup script for Discord Activity Status extension

const toggleBtn = document.getElementById('toggleBtn');
const statusDiv = document.getElementById('status');
const modeBtns = document.querySelectorAll('.mode-btn');
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
const tabList = document.getElementById('tabList');
const logList = document.getElementById('logList');
const selectedTabLabel = document.getElementById('selectedTabLabel');
const rpcHealthBadge = document.getElementById('rpcHealthBadge');
const rpcHealthText = document.getElementById('rpcHealthText');

chrome.storage.local.get(['enabled', 'mode'], (result) => {
  updateToggle(result.enabled !== false);
  updateMode(result.mode || 'auto');
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

    const platform = document.createElement('div');
    platform.className = 'activity-platform';
    platform.textContent = activity.platform || 'Browser';

    const details = document.createElement('div');
    details.className = 'activity-details';
    details.textContent = activity.details || 'Unknown activity';

    const state = document.createElement('div');
    state.className = 'activity-state';
    state.textContent = activity.state || 'Active';

    statusDiv.append(platform, details, state);
  });
}

function updateSelectedTabLabel() {
  chrome.storage.local.get(['selectedTabId', 'detectedActivities'], (result) => {
    const selectedTabId = normalizeTabId(result.selectedTabId);
    const activities = Array.isArray(result.detectedActivities) ? result.detectedActivities : [];
    const selectedActivity = activities.find(activity => normalizeTabId(activity.tabId) === selectedTabId);

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
  chrome.storage.local.get(['discordRpcStatus', 'backendStatus'], (result) => {
    const rpcStatus = result.discordRpcStatus || 'disconnected';
    const backendStatus = result.backendStatus || 'unreachable';

    rpcHealthBadge.classList.remove('connected', 'disconnected');

    if (backendStatus !== 'connected') {
      rpcHealthBadge.classList.add('disconnected');
      rpcHealthText.textContent = 'Backend offline';
      return;
    }

    if (rpcStatus === 'connected') {
      rpcHealthBadge.classList.add('connected');
      rpcHealthText.textContent = 'Discord connected';
      return;
    }

    rpcHealthBadge.classList.add('disconnected');
    rpcHealthText.textContent = 'Discord disconnected';
  });
}

function renderDetectedTabs() {
  chrome.storage.local.get(['detectedActivities', 'selectedTabId'], (result) => {
    const activities = Array.isArray(result.detectedActivities) ? result.detectedActivities : [];
    const selectedTabId = normalizeTabId(result.selectedTabId);

    tabList.textContent = '';

    if (activities.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No supported tabs have reported activity yet.';
      tabList.appendChild(empty);
      return;
    }

    const sortedActivities = [...activities].sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));

    for (const activity of sortedActivities) {
      const tabId = normalizeTabId(activity.tabId);
      const isSelected = tabId !== null && tabId === selectedTabId;
      const card = document.createElement('div');
      card.className = `tab-card${isSelected ? ' active' : ''}`;

      const info = document.createElement('div');
      info.className = 'tab-info';

      const title = document.createElement('div');
      title.className = 'tab-title';
      title.textContent = `${activity.isActiveTab ? 'Current - ' : ''}${activity.platform || 'Browser'} - ${activity.details || 'Unknown activity'}`;

      const subtitle = document.createElement('div');
      subtitle.className = 'tab-subtitle';
      subtitle.textContent = formatSubtitle(activity);

      info.append(title, subtitle);

      const button = document.createElement('button');
      button.className = `tab-select${isSelected ? ' active' : ''}`;
      button.textContent = isSelected ? 'Selected' : 'Use';
      button.disabled = tabId === null;
      button.addEventListener('click', () => {
        sendRuntimeMessage({ action: 'selectActivityTab', tabId });
      });

      card.append(info, button);
      tabList.appendChild(card);
    }
  });
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
  });
});

function updateMode(mode) {
  modeBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  manualSection.style.display = mode === 'manual' ? 'grid' : 'none';
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
});

refreshBtn.addEventListener('click', () => {
  sendRuntimeMessage({ action: 'refreshSelectedActivity' });
});

clearBtn.addEventListener('click', () => {
  sendRuntimeMessage({ action: 'clearActivity' });
});

clearSelectionBtn.addEventListener('click', () => {
  sendRuntimeMessage({ action: 'selectActivityTab', tabId: null });
});

clearLogsBtn.addEventListener('click', () => {
  chrome.storage.local.set({ activityLogs: [] }, () => {
    renderLogs();
    sendRuntimeMessage({ action: 'clearLogs' });
  });
});

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
    activity.tabTitle,
    activity.lastSeen ? `${Math.max(0, Math.round((Date.now() - activity.lastSeen) / 1000))}s ago` : ''
  ].filter(Boolean);
  return parts.join(' - ');
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

refreshUi();
setInterval(refreshUi, 2000);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes.enabled) {
    updateToggle(changes.enabled.newValue !== false);
  }

  if (changes.mode) {
    updateMode(changes.mode.newValue || 'auto');
  }

  refreshUi();
});
