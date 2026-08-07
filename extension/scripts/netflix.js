// Netflix Content Script
const NETFLIX_DEBUG = false;
let lastGoodNetflixTitle = '';
let netflixStopped = false;
let mediaStatusStyle = 'clean';

chrome.storage.local.get(['mediaStatusStyle'], (result) => {
  mediaStatusStyle = normalizeMediaStatusStyle(result.mediaStatusStyle);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.mediaStatusStyle) return;
  mediaStatusStyle = normalizeMediaStatusStyle(changes.mediaStatusStyle.newValue);
});

function debugNetflix(...args) {
  if (NETFLIX_DEBUG) {
    console.debug('[Netflix]', ...args);
  }
}

function detectNetflixActivity() {
  try {
    let title = getNetflixTitle();

    if (!title || !isLikelyTitle(title)) {
      const titleElement = document.querySelector('[data-uia*="video-title"]')
        || document.querySelector('.previewModal--player-titleTreatment-logo, h4');
      const fallbackTitle = titleElement?.textContent?.trim();
      if (fallbackTitle && isLikelyTitle(fallbackTitle)) {
        title = cleanNetflixTitle(fallbackTitle);
      }

      if (isLikelyTitle(title)) {
        lastGoodNetflixTitle = title;
      } else if (lastGoodNetflixTitle) {
        title = lastGoodNetflixTitle;
      }
    }

    if ((!title || !isLikelyTitle(title)) && lastGoodNetflixTitle) {
      title = lastGoodNetflixTitle;
    }

    if (!title) {
      debugNetflix('No reliable title found yet');
      return null;
    }

    const video = document.querySelector('video');
    if (!video) {
      debugNetflix('No video element found');
      return null;
    }

    const isPlaying = !video.paused;
    const currentTime = Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0;
    const duration = Number.isFinite(video.duration) ? Math.max(0, video.duration) : 0;

    const activity = {
      platform: 'Netflix',
      details: title.substring(0, 100),
      state: formatMediaState('Watching', isPlaying, currentTime, duration),
      largeImageKey: 'netflix',
      largeImageText: 'Watching Netflix',
      thumbnailUrl: document.querySelector('meta[property="og:image"]')?.content?.trim() || '',
      url: window.location.href,
      isPlaying,
      mediaCurrentTime: currentTime,
      mediaDuration: duration
    };

    debugNetflix('Detected:', activity);
    return activity;
  } catch (error) {
    debugNetflix('Error:', error.message);
    return null;
  }
}

function getNetflixTitle() {
  const titleSelectors = [
    '[data-uia*="video-title"]',
    '.watch-video--player-title',
    'h4'
  ];

  for (const selector of titleSelectors) {
    const text = document.querySelector(selector)?.textContent?.trim();
    if (text && isLikelyTitle(text)) {
      return cleanNetflixTitle(text);
    }
  }

  const pageTitle = document.title.replace(/\s*-\s*Netflix\s*$/i, '').trim();
  if (pageTitle && isLikelyTitle(pageTitle)) {
    return cleanNetflixTitle(pageTitle);
  }

  return null;
}

function isLikelyTitle(title) {
  if (!title) return false;
  const value = String(title).trim();
  if (!value) return false;
  if (/netflix/i.test(value) && value.length < 28) return false;
  if (/watch now|browse|home|sign in/i.test(value)) return false;
  return true;
}

function cleanNetflixTitle(title) {
  return String(title || '')
    .replace(/\s*[-|]\s*Netflix.*$/i, '')
    .replace(/\b([A-Za-z][A-Za-z0-9'’:-]*?)E(\d+)\s*Episode\s*\d+\b/i, '$1 Episode $2')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\bE(\d+)\s*Episode\b/ig, 'Episode $1')
    .replace(/\bS(\d+)\s*E(\d+)\b/ig, 'S$1 E$2')
    .replace(/\bEpisode\s*(\d+)\s*Episode\s*\1\b/ig, 'Episode $1')
    .replace(/\bSeason\s*\d+\b/ig, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
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
  debugNetflix('Message received:', request.action);
  if (request.action === 'detectActivity') {
    const found = sendNetflixActivity();
    sendResponse({ ok: true, found });
    return;
  }

  sendResponse({ ok: true, found: false });
});

function sendNetflixActivity() {
  if (netflixStopped) {
    return false;
  }

  const activity = detectNetflixActivity();
  if (activity) {
    debugNetflix('Sending activity detected');
    chrome.runtime.sendMessage({
      action: 'activityDetected',
      activity: activity
    }).catch(err => debugNetflix('Send error:', err.message));
    return true;
  }

  return false;
}

function stopNetflixDetection() {
  netflixStopped = true;
}

function startNetflixDetection() {
  netflixStopped = false;
  sendNetflixActivity();
}

setInterval(() => {
  if (!netflixStopped) {
    sendNetflixActivity();
  }
}, 5000);
