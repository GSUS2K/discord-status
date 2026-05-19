// Options page script

const DEFAULTS = {
  serverUrl: 'http://localhost:3000',
  updateInterval: 5,
  staleThresholdMs: 30000,
  enabledSites: 'youtube,netflix,hotstar,crunchyroll,spotify,twitch,discord,meet,github,chatgpt,google,wikipedia',
  logLevel: 'info'
};

const serverUrlInput = document.getElementById('serverUrl');
const updateIntervalInput = document.getElementById('updateInterval');
const staleThresholdMsInput = document.getElementById('staleThresholdMs');
const enabledSitesInput = document.getElementById('enabledSites');
const logLevelInput = document.getElementById('logLevel');
const backendStatusValue = document.getElementById('backendStatusValue');
const rpcStatusValue = document.getElementById('rpcStatusValue');
const lastActivityValue = document.getElementById('lastActivityValue');
const saveBtn = document.getElementById('saveBtn');
const testBtn = document.getElementById('testBtn');
const resetBtn = document.getElementById('resetBtn');
const statusMessage = document.getElementById('statusMessage');

chrome.storage.local.get(Object.keys(DEFAULTS), (result) => {
  setFormValues({ ...DEFAULTS, ...result });
  refreshStatusCards();
});

saveBtn.addEventListener('click', () => {
  const settings = readSettingsFromForm();
  const validationError = validateSettings(settings);

  if (validationError) {
    showMessage(validationError, 'error');
    return;
  }

  chrome.storage.local.set(settings, () => {
    showMessage('Settings saved. The background worker will pick them up automatically.', 'success');
  });
});

testBtn.addEventListener('click', async () => {
  const settings = readSettingsFromForm();
  const validationError = validateServerUrl(settings.serverUrl);

  if (validationError) {
    showMessage(validationError, 'error');
    return;
  }

  try {
    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';
    const response = await fetch(`${settings.serverUrl}/api/status`, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      showMessage(`Server responded with ${response.status}. Check the backend terminal logs.`, 'error');
      return;
    }

    const rpcStatus = payload.discord_rpc || 'unknown';
    updateStatusCards(payload);
    showMessage(`Backend is online. Discord RPC is ${rpcStatus}.`, rpcStatus === 'connected' ? 'success' : 'error');
  } catch (error) {
    showMessage(`Could not reach server: ${error.message}`, 'error');
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = 'Test Connection';
  }
});

resetBtn.addEventListener('click', () => {
  setFormValues(DEFAULTS);
  showMessage('Defaults restored in the form. Click Save Settings to apply them.', 'success');
});

function setFormValues(values) {
  serverUrlInput.value = values.serverUrl || DEFAULTS.serverUrl;
  updateIntervalInput.value = values.updateInterval || DEFAULTS.updateInterval;
  staleThresholdMsInput.value = Math.round((values.staleThresholdMs || DEFAULTS.staleThresholdMs) / 1000);
  enabledSitesInput.value = Array.isArray(values.enabledSites)
    ? values.enabledSites.join(',')
    : values.enabledSites || DEFAULTS.enabledSites;
  logLevelInput.value = values.logLevel || DEFAULTS.logLevel;
}

function readSettingsFromForm() {
  return {
    serverUrl: normalizeServerUrl(serverUrlInput.value),
    updateInterval: clampNumber(updateIntervalInput.value, 2, 60, DEFAULTS.updateInterval),
    staleThresholdMs: clampNumber(staleThresholdMsInput.value, 10, 300, 30) * 1000,
    enabledSites: enabledSitesInput.value
      .split(',')
      .map(site => site.trim().toLowerCase())
      .filter(Boolean),
    logLevel: ['debug', 'info', 'warn', 'error'].includes(logLevelInput.value) ? logLevelInput.value : DEFAULTS.logLevel
  };
}

function validateSettings(settings) {
  const serverError = validateServerUrl(settings.serverUrl);
  if (serverError) return serverError;

  if (settings.enabledSites.length === 0) {
    return 'Add at least one enabled site keyword.';
  }

  return '';
}

function validateServerUrl(serverUrl) {
  if (!serverUrl) {
    return 'Please enter a backend server URL.';
  }

  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(serverUrl)) {
    return 'Discord Rich Presence requires a local backend. Use http://localhost:3000 unless you have a local reverse proxy.';
  }

  return '';
}

function normalizeServerUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function clampNumber(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function showMessage(message, type) {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`;
  statusMessage.style.display = 'block';

  if (type === 'success') {
    setTimeout(() => {
      statusMessage.style.display = 'none';
    }, 3500);
  }
}

async function refreshStatusCards() {
  const serverUrl = normalizeServerUrl(serverUrlInput.value || DEFAULTS.serverUrl);
  try {
    const response = await fetch(`${serverUrl}/api/status`, { cache: 'no-store' });
    if (!response.ok) {
      updateStatusCards(null, `HTTP ${response.status}`);
      return;
    }

    updateStatusCards(await response.json());
  } catch (error) {
    updateStatusCards(null, 'Offline');
  }
}

function updateStatusCards(payload, backendLabel = 'Online') {
  if (!payload) {
    backendStatusValue.textContent = backendLabel;
    rpcStatusValue.textContent = 'Unknown';
    lastActivityValue.textContent = 'None';
    return;
  }

  backendStatusValue.textContent = backendLabel;
  rpcStatusValue.textContent = payload.discord_rpc || 'unknown';
  lastActivityValue.textContent = payload.last_activity?.details || 'None';
}
