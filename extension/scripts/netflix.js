// Netflix Content Script

let lastGoodNetflixTitle = null;
let netflixIntervalId = null;
let netflixStopped = false;

function stopNetflixTracking() {
  if (netflixStopped) {
    return;
  }

  netflixStopped = true;

  if (netflixIntervalId) {
    clearInterval(netflixIntervalId);
    netflixIntervalId = null;
  }
}

function sendNetflixSafely(activity) {
  if (!activity || netflixStopped || !chrome?.runtime?.id) {
    return;
  }

  try {
    chrome.runtime.sendMessage(
      {
        action: 'activityDetected',
        activity
      },
      () => {
        const error = chrome.runtime.lastError;
        if (error && !isBenignRuntimeError(error.message || '')) {
          console.warn('[Netflix] Send error:', error.message);
        }
        if (error && /Extension context invalidated/i.test(error.message || '')) {
          stopNetflixTracking();
        }
      }
    );
  } catch (error) {
    if (!isBenignRuntimeError(error.message || '')) {
      console.warn('[Netflix] Send error:', error.message);
    } else {
      stopNetflixTracking();
    }
  }
}

function isBenignRuntimeError(message = '') {
  return /Extension context invalidated|message port closed before a response was received/i.test(message);
}

function detectNetflixActivity() {
  try {
    const titleCandidates = [];

    const addCandidate = (value, source = 'unknown') => {
      const text = value?.trim();
      if (text && text.length > 1 && !/^netflix$/i.test(text)) {
        titleCandidates.push({ text, source });
      }
    };

    const isLikelyTitle = (text) => {
      if (!text) return false;
      const cleaned = text.trim();
      if (cleaned.length < 3) return false;
      if (/^episode\s*\d+$/i.test(cleaned)) return false;
      if (/^season\s*\d+$/i.test(cleaned)) return false;
      if (/^audio description available$/i.test(cleaned)) return false;
      if (/^(skip intro|skip recap|next episode|play|pause|more like this|episodes|details)$/i.test(cleaned)) return false;
      if (/^(fine, you asked for it\.?|you asked for it\.?|new episode|continue watching)$/i.test(cleaned)) return false;
      if (/^(i|we|you|he|she|they|this|that|there)\b/i.test(cleaned) && /[.!?]$/.test(cleaned)) return false;
      if (cleaned.split(/\s+/).length > 9 && /[.!?]$/.test(cleaned)) return false;
      if (cleaned.length > 72 && /[.!?]$/.test(cleaned)) return false;
      if (/[“”"]/.test(cleaned) && /[.!?]$/.test(cleaned)) return false;
      if (/^[\w\s',.!?:;-]+$/.test(cleaned) && cleaned.split(/\s+/).length <= 2 && cleaned.length < 10) {
        return false;
      }
      if (/[.!?]$/.test(cleaned) && cleaned.split(/\s+/).length <= 6) {
        return false;
      }
      return true;
    };

    const rankTitle = (candidate) => {
      const text = candidate?.text;
      if (!text) return -1;
      let score = 0;
      const cleaned = text.trim();
      const source = candidate.source || 'unknown';
      if (/^(player|metadata|document|meta|title-ui)$/.test(source)) score += 5;
      if (source === 'last-good') score += 4;
      if (cleaned.length >= 4) score += 2;
      if (cleaned.length >= 10) score += 1;
      if (/\bseason\b/i.test(cleaned)) score += 1;
      if (/\bepisode\b/i.test(cleaned)) score += 1;
      if (/^[A-Z][\w\s',:-]+$/.test(cleaned)) score += 1;
      if (cleaned === document.title.trim()) score += 3;
      if (cleaned === lastGoodNetflixTitle) score += 2;
      if (!/[.!?]$/.test(cleaned)) score += 1;
      if (/^(subtitle|caption|visible-text)$/.test(source)) score -= 8;
      return score;
    };

    addCandidate(document.querySelector('[data-testid="player-title"]')?.textContent, 'player');
    addCandidate(document.querySelector('[data-uia="video-title"]')?.textContent, 'player');
    addCandidate(document.querySelector('[data-uia="episode-title"]')?.textContent, 'player');
    addCandidate(document.querySelector('[data-uia="video-title-text"]')?.textContent, 'player');
    addCandidate(document.querySelector('[data-uia="previewModal--boxart-title"]')?.textContent, 'title-ui');
    addCandidate(document.querySelector('[data-uia="title-info-title"]')?.textContent, 'title-ui');
    addCandidate(document.querySelector('[data-uia*="title"]')?.textContent, 'title-ui');
    addCandidate(document.querySelector('h1[class*="title"]')?.textContent, 'title-ui');
    addCandidate(document.querySelector('h1')?.textContent, 'title-ui');
    addCandidate(document.querySelector('[class*="video-title"]')?.textContent, 'player');
    addCandidate(document.querySelector('meta[property="og:title"]')?.content, 'meta');
    addCandidate(document.querySelector('meta[name="twitter:title"]')?.content, 'meta');

    const documentTitle = document.title.replace(/\s*[\-|\|]\s*Netflix.*$/i, '').trim();
    addCandidate(documentTitle, 'document');

    if (lastGoodNetflixTitle) {
      addCandidate(lastGoodNetflixTitle, 'last-good');
    }

    let title = null;

    if (titleCandidates.length > 0) {
      const scoredTitle = titleCandidates
        .filter(candidate => isLikelyTitle(candidate.text))
        .sort((left, right) => rankTitle(right) - rankTitle(left))[0]?.text;

      if (scoredTitle) {
        title = scoredTitle;
      }
    }

    if (title) {
      title = cleanNetflixTitle(title);

      if (/^audio description available$/i.test(title)) {
        title = lastGoodNetflixTitle || null;
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
      console.log('[Netflix] No reliable title found yet');
      return null;
    }
    
    // Check for video element
    const video = document.querySelector('video');
    if (!video) {
      console.log('[Netflix] No video element found');
      return null;
    }
    
    const isPlaying = !video.paused;
    const currentTime = Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0;
    const duration = Number.isFinite(video.duration) ? Math.max(0, video.duration) : 0;
    const currentMinutes = Math.floor(currentTime / 60);
    const currentSeconds = Math.floor(currentTime % 60);
    const durationMinutes = Math.floor(duration / 60);
    const durationSeconds = Math.floor(duration % 60);
    const timeLabel = duration > 0
      ? ` • ${String(currentMinutes).padStart(2, '0')}:${String(currentSeconds).padStart(2, '0')} / ${String(durationMinutes).padStart(2, '0')}:${String(durationSeconds).padStart(2, '0')}`
      : '';
    let state = `${isPlaying ? 'Playing' : 'Paused'}${timeLabel}`;
    
    const activity = {
      platform: 'Netflix',
      details: title.substring(0, 100),
      state: state,
      largeImageKey: 'netflix',
      largeImageText: 'Watching Netflix',
      thumbnailUrl: document.querySelector('meta[property="og:image"]')?.content?.trim() || '',
      url: window.location.href,
      isPlaying,
      mediaCurrentTime: currentTime,
      mediaDuration: duration
    };
    
    console.log('[Netflix] Detected:', activity);
    return activity;
  } catch (error) {
    console.log('[Netflix] Error:', error.message);
    return null;
  }
}

function cleanNetflixTitle(title) {
  return title
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Netflix] Message received:', request.action);
  if (request.action === 'detectActivity') {
    const found = sendNetflixActivity();
    sendResponse({ ok: true, found });
    return;
  }

  sendResponse({ ok: true, found: false });
});

function sendNetflixActivity() {
  if (netflixStopped) {
    return;
  }

  const activity = detectNetflixActivity();
  if (activity) {
    console.log('[Netflix] Sending activity detected');
    sendNetflixSafely(activity);
    return true;
  }

  return false;
}

sendNetflixActivity();

netflixIntervalId = setInterval(sendNetflixActivity, 3000);
