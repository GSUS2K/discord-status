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
    const metadata = getNetflixMetadata();
    let title = metadata.seriesTitle || metadata.episodeTitle;

    if (!title || !isLikelyTitle(title)) {
      if (lastGoodNetflixTitle && isLikelyTitle(lastGoodNetflixTitle)) {
        title = lastGoodNetflixTitle;
      }
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
      details: metadata.seriesTitle || title.substring(0, 100),
      state: formatMediaState('Watching', isPlaying, currentTime, duration, metadata.episodeLabel),
      seriesTitle: metadata.seriesTitle || title.substring(0, 100),
      seasonNumber: metadata.seasonNumber,
      episodeNumber: metadata.episodeNumber,
      episodeTitle: metadata.episodeTitle,
      episodeLabel: metadata.episodeLabel,
      largeImageKey: 'netflix',
      largeImageText: 'Watching Netflix',
      thumbnailUrl: getNetflixThumbnailUrl(),
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
  return getNetflixMetadata().rawTitle;
}

function getNetflixMetadata() {
  const selectors = [
    '[data-uia="video-title"]',
    '[data-uia*="video-title"]',
    '[data-uia*="episode-title"]',
    '[data-uia*="player-title"]',
    '[data-uia*="jawbone-title"]',
    '.watch-video--player-title',
    '[role="heading"]',
    'h1',
    'h2',
    'h3',
    'h4'
  ];

  const candidates = [];

  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      const text = normalizeTitleText(element?.textContent || element?.getAttribute?.('aria-label') || '');
      if (text) {
        candidates.push(text);
      }
    }
  }

  const metaTitle = normalizeTitleText(
    document.querySelector('meta[property="og:title"]')?.content
      || document.querySelector('meta[name="twitter:title"]')?.content
      || document.querySelector('meta[name="title"]')?.content
      || ''
  );
  if (metaTitle) {
    candidates.push(metaTitle);
  }

  const pageTitle = normalizeTitleText(document.title.replace(/\s*-\s*Netflix\s*$/i, ''));
  if (pageTitle) {
    candidates.push(pageTitle);
  }

  const rawTitle = pickNetflixRawTitle(candidates);
  const parsed = parseEpisodeTitle(rawTitle || lastGoodNetflixTitle || '');
  const chosen = parsed.seriesTitle || parsed.episodeTitle;
  if (chosen) {
    lastGoodNetflixTitle = chosen;
  }

  return { rawTitle, ...parsed };
}

function pickNetflixRawTitle(candidates) {
  const valid = candidates
    .map(normalizeTitleText)
    .filter(isLikelyTitle);

  if (!valid.length) {
    return null;
  }

  valid.sort((a, b) => scoreNetflixTitle(b) - scoreNetflixTitle(a));
  return valid[0] || '';
}

function scoreNetflixTitle(value) {
  let score = String(value || '').length;
  if (/\b(?:S\d+\s*)?E\d+\b|\bEpisode\s*\d+\b/i.test(value)) score += 80;
  if (/browse|home|profile|search/i.test(value)) score -= 100;
  return score;
}

function parseEpisodeTitle(value) {
  const raw = cleanNetflixTitle(value);
  if (!raw) return { seriesTitle: '', episodeTitle: '', seasonNumber: null, episodeNumber: null, episodeLabel: '' };

  const seasonEpisode = raw.match(/^(.*?)\s+S(\d+)\s*E(\d+)(?:\s*[-:|.]?\s*)(.*)$/i);
  const episodeOnly = raw.match(/^(.*?)\s+E(\d+)(?:\s*[-:|.]?\s*)(.*)$/i)
    || raw.match(/^(.*?)\s+Episode\s*(\d+)(?:\s*[-:|.]?\s*)(.*)$/i);

  if (!seasonEpisode && !episodeOnly) {
    return { seriesTitle: raw, episodeTitle: '', seasonNumber: null, episodeNumber: null, episodeLabel: '' };
  }

  const season = seasonEpisode ? Number(seasonEpisode[2]) : null;
  const episode = Number(seasonEpisode ? seasonEpisode[3] : episodeOnly[2]);
  const episodeTitle = normalizeTitleText(seasonEpisode ? seasonEpisode[4] : episodeOnly[3]);
  const label = `${season ? `S${season} ` : ''}E${episode}${episodeTitle ? ` · ${episodeTitle}` : ''}`;
  return {
    seriesTitle: normalizeTitleText(seasonEpisode ? seasonEpisode[1] : episodeOnly[1]),
    episodeTitle,
    seasonNumber: season,
    episodeNumber: episode,
    episodeLabel: label
  };
}

function getNetflixThumbnailUrl() {
  const candidates = [
    document.querySelector('meta[property="og:image"]')?.content,
    document.querySelector('meta[name="twitter:image"]')?.content,
    document.querySelector('video[poster]')?.poster
  ];
  return candidates.map(value => String(value || '').trim()).find(value => /^https?:\/\//i.test(value)) || '';
}

function isLikelyTitle(title) {
  const value = normalizeTitleText(title);
  if (!value || value.length < 3) return false;
  if (/netflix/i.test(value) && value.length < 28) return false;
  if (/browse by languages?/i.test(value)) return false;
  if (/^browse\b/i.test(value)) return false;
  if (/watch now|home|sign in|sign up|profile|account|my list|continue watching|settings|search|trending|top 10/i.test(value)) return false;
  return true;
}

function normalizeTitleText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

function cleanNetflixTitle(title) {
  return normalizeTitleText(title)
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
