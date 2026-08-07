// Spotify Content Script
let mediaStatusStyle = 'clean';

chrome.storage.local.get(['mediaStatusStyle'], (result) => {
  mediaStatusStyle = normalizeMediaStatusStyle(result.mediaStatusStyle);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.mediaStatusStyle) return;
  mediaStatusStyle = normalizeMediaStatusStyle(changes.mediaStatusStyle.newValue);
});

function detectSpotifyActivity() {
  const trackNameElement = document.querySelector('a[data-testid="nowplaying-track-link"]');
  if (!trackNameElement) return null;

  const trackName = trackNameElement.textContent.trim();
  const artistElement = document.querySelector('a[data-testid="nowplaying-artist"]');
  const artist = artistElement ? artistElement.textContent.trim() : '';

  const audio = document.querySelector('audio');
  const isPlaying = audio ? !audio.paused : !document.querySelector('button[data-testid="control-button-play"]');
  const currentTime = audio && Number.isFinite(audio.currentTime) ? Math.max(0, audio.currentTime) : 0;
  const duration = audio && Number.isFinite(audio.duration) ? Math.max(0, audio.duration) : 0;

  return {
    platform: 'Spotify',
    details: trackName.substring(0, 128),
    state: formatMediaState('Listening', isPlaying, currentTime, duration, artist),
    largeImageKey: 'spotify',
    largeImageText: 'Listening on Spotify',
    thumbnailUrl: getSpotifyCoverUrl(),
    url: window.location.href,
    isPlaying,
    mediaCurrentTime: currentTime,
    mediaDuration: duration
  };
}

function getSpotifyCoverUrl() {
  return document.querySelector('[data-testid="cover-art-image"] img')?.src
    || document.querySelector('img[data-testid="cover-art-image"]')?.src
    || document.querySelector('meta[property="og:image"]')?.content
    || '';
}

function normalizeMediaStatusStyle(value) {
  return value === 'detailed' ? 'detailed' : 'clean';
}

function formatMediaState(action, isPlaying, currentTime, duration, prefix = '') {
  const parts = [];
  const cleanPrefix = String(prefix || '').trim();

  if (cleanPrefix) {
    parts.push(cleanPrefix);
  }

  parts.push(isPlaying ? action : 'Paused');

  if (mediaStatusStyle === 'detailed' && duration > 0) {
    parts.push(`${formatDuration(currentTime)} / ${formatDuration(duration)}`);
  }

  return parts.join(' - ').substring(0, 128);
}

function formatDuration(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const rest = Math.floor(safeSeconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'detectActivity') {
    const activity = detectSpotifyActivity();
    if (activity) {
      chrome.runtime.sendMessage({
        action: 'activityDetected',
        activity: activity
      });
    }
    sendResponse({ ok: true, found: Boolean(activity) });
    return;
  }

  sendResponse({ ok: true, found: false });
});

setInterval(() => {
  const activity = detectSpotifyActivity();
  if (activity) {
    chrome.runtime.sendMessage({
      action: 'activityDetected',
      activity: activity
    }).catch(() => {});
  }
}, 5000);
