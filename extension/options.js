// Options page script

const DEFAULTS = {
  serverUrl: 'http://localhost:17654',
  updateInterval: 5,
  staleThresholdMs: 30000,
  enabledSites: 'youtube,youtubemusic,netflix,primevideo,hulu,disneyplus,appletv,hotstar,crunchyroll,spotify,soundcloud,applemusic,bandcamp,twitch,discord,meet,github,vscode,linear,jira,notion,googledocs,figma,canva,chatgpt,coursera,udemy,khanacademy,leetcode,reddit,twitter,instagram,linkedin,steam,chess,lichess,skribbl,geoguessr,google,wikipedia',
  logLevel: 'info',
  privacyMode: 'normal',
  mediaStatusStyle: 'clean',
  incognitoNever: true,
  requirePlayingSites: [],
  requirePlayingConfigured: false,
  playingOnlyCapableSites: ['youtube','youtubemusic','netflix','primevideo','hulu','disneyplus','appletv','hotstar','crunchyroll','spotify','soundcloud','applemusic','bandcamp','twitch'],
  blockedDomains: [],
  pauseDuringMeetings: false
};

const SUPPORTED_SITES = [
  ['youtube', 'YouTube'],
  ['youtubemusic', 'YouTube Music'],
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
  ['meet', 'Google Meet'],
  ['github', 'GitHub'],
  ['vscode', 'VS Code Web'],
  ['linear', 'Linear'],
  ['jira', 'Jira'],
  ['notion', 'Notion'],
  ['googledocs', 'Google Docs'],
  ['figma', 'Figma'],
  ['canva', 'Canva'],
  ['chatgpt', 'ChatGPT'],
  ['coursera', 'Coursera'],
  ['udemy', 'Udemy'],
  ['khanacademy', 'Khan Academy'],
  ['leetcode', 'LeetCode'],
  ['reddit', 'Reddit'],
  ['twitter', 'X/Twitter'],
  ['instagram', 'Instagram'],
  ['linkedin', 'LinkedIn'],
  ['steam', 'Steam'],
  ['chess', 'Chess.com'],
  ['lichess', 'Lichess'],
  ['skribbl', 'Skribbl.io'],
  ['geoguessr', 'GeoGuessr'],
  ['hotstar', 'Hotstar'],
  ['crunchyroll', 'Crunchyroll'],
  ['google', 'Google'],
  ['wikipedia', 'Wikipedia']
];

const serverUrlInput = document.getElementById('serverUrl');
const updateIntervalInput = document.getElementById('updateInterval');
const staleThresholdMsInput = document.getElementById('staleThresholdMs');
const enabledSitesList = document.getElementById('enabledSitesList');
const logLevelInput = document.getElementById('logLevel');
const privacyModeInput = document.getElementById('privacyMode');
const mediaStatusStyleInput = document.getElementById('mediaStatusStyle');
const incognitoNeverInput = document.getElementById('incognitoNever');
const requirePlayingInput = document.getElementById('requirePlaying');
const pauseDuringMeetingsInput = document.getElementById('pauseDuringMeetings');
const blockedDomainsInput = document.getElementById('blockedDomains');
const backendStatusValue = document.getElementById('backendStatusValue');
const rpcStatusValue = document.getElementById('rpcStatusValue');
const lastActivityValue = document.getElementById('lastActivityValue');
const saveBtn = document.getElementById('saveBtn');
const testBtn = document.getElementById('testBtn');
const resetBtn = document.getElementById('resetBtn');
const statusMessage = document.getElementById('statusMessage');

chrome.storage.local.get(Object.keys(DEFAULTS), (result) => {
  renderSupportedSiteOptions();
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
  setEnabledSiteValues(Array.isArray(values.enabledSites)
    ? values.enabledSites
    : String(values.enabledSites || DEFAULTS.enabledSites).split(','));
  logLevelInput.value = values.logLevel || DEFAULTS.logLevel;
  privacyModeInput.value = values.privacyMode || DEFAULTS.privacyMode;
  mediaStatusStyleInput.value = values.mediaStatusStyle || DEFAULTS.mediaStatusStyle;
  incognitoNeverInput.checked = values.incognitoNever !== false;
  pauseDuringMeetingsInput.checked = values.pauseDuringMeetings === true;
  const requirePlayingSites = values.requirePlayingConfigured === true && Array.isArray(values.requirePlayingSites)
    ? values.requirePlayingSites
    : DEFAULTS.requirePlayingSites;
  requirePlayingInput.checked = DEFAULTS.playingOnlyCapableSites.every(site => requirePlayingSites.includes(site));
  blockedDomainsInput.value = Array.isArray(values.blockedDomains)
    ? values.blockedDomains.join(', ')
    : String(values.blockedDomains || '');
}

function readSettingsFromForm() {
  const requirePlayingSites = requirePlayingInput.checked ? DEFAULTS.playingOnlyCapableSites : [];
  return {
    serverUrl: normalizeServerUrl(serverUrlInput.value),
    updateInterval: clampNumber(updateIntervalInput.value, 2, 60, DEFAULTS.updateInterval),
    staleThresholdMs: clampNumber(staleThresholdMsInput.value, 10, 300, 30) * 1000,
    enabledSites: getEnabledSiteValues(),
    logLevel: ['debug', 'info', 'warn', 'error'].includes(logLevelInput.value) ? logLevelInput.value : DEFAULTS.logLevel,
    privacyMode: ['normal', 'platform', 'private'].includes(privacyModeInput.value) ? privacyModeInput.value : DEFAULTS.privacyMode,
    mediaStatusStyle: ['clean', 'detailed'].includes(mediaStatusStyleInput.value) ? mediaStatusStyleInput.value : DEFAULTS.mediaStatusStyle,
    incognitoNever: incognitoNeverInput.checked,
    requirePlayingSites,
    requirePlayingConfigured: true,
    blockedDomains: blockedDomainsInput.value.split(',').map(value => value.trim().toLowerCase()).filter(Boolean),
    pauseDuringMeetings: pauseDuringMeetingsInput.checked
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
    return 'Discord Rich Presence requires a local backend. Use http://localhost:17654 unless you have a local reverse proxy.';
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

function renderSupportedSiteOptions() {
  enabledSitesList.textContent = '';

  for (const [value, label] of SUPPORTED_SITES) {
    const option = document.createElement('label');
    option.className = 'site-option';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = value;

    const text = document.createElement('span');
    text.textContent = label;

    option.append(input, text);
    enabledSitesList.appendChild(option);
  }
}

function getEnabledSiteValues() {
  return Array.from(enabledSitesList.querySelectorAll('input[type="checkbox"]:checked'))
    .map(input => input.value);
}

function setEnabledSiteValues(values) {
  const enabled = new Set(values.map(value => String(value).trim().toLowerCase()).filter(Boolean));
  for (const input of enabledSitesList.querySelectorAll('input[type="checkbox"]')) {
    input.checked = enabled.has(input.value);
  }
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
