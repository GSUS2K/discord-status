// Generic Content Script - handles multiple platforms

const PLATFORMS = {
  'twitch.tv': {
    name: 'Twitch',
    detect: () => {
      const title = getText('[data-test-selector="stream-title"], h2[data-a-target="stream-title"]')
        || cleanTitle(document.title, ['Twitch']);
      const channel = getText('[data-test-selector="channel-header-desktop"] a, a[data-a-target="stream-game-link"], h1 a')
        || getPathParts()[0]
        || 'Twitch';
      const media = getMediaInfo('video');

      if (!title || /^twitch$/i.test(title)) return null;

      return {
        platform: 'Twitch',
        details: truncate(title),
        state: truncate(`${media.label} • ${channel}`),
        largeImageKey: 'twitch',
        largeImageText: 'Watching on Twitch',
        thumbnailUrl: getThumbnailUrl(),
        url: window.location.href,
        isPlaying: media.isPlaying,
        mediaCurrentTime: media.currentTime,
        mediaDuration: media.duration
      };
    }
  },
  'discord.com': {
    name: 'Discord',
    detect: () => {
      const title = cleanTitle(document.title, ['Discord']) || 'Discord';
      const channel = getText('[aria-label*="Channel header"] h1, [data-list-item-id*="channels"] [class*="name"], h1');

      return {
        platform: 'Discord',
        details: truncate(channel ? `In ${channel}` : title),
        state: channel ? 'Browsing Discord' : 'Using Discord',
        largeImageKey: 'discord',
        largeImageText: 'Using Discord',
        url: window.location.href
      };
    }
  },
  'github.com': {
    name: 'GitHub',
    detect: () => {
      const [owner, repo] = getPathParts();
      const repoLabel = owner && repo ? `${owner}/${repo}` : '';
      const pageTitle = cleanTitle(document.title, ['GitHub']);
      const details = repoLabel || pageTitle;

      if (!details) return null;

      return {
        platform: 'GitHub',
        details: truncate(details),
        state: repoLabel ? 'Browsing repository' : 'Browsing GitHub',
        largeImageKey: 'github',
        largeImageText: 'Browsing on GitHub',
        url: window.location.href
      };
    }
  },
  'chatgpt.com': {
    name: 'ChatGPT',
    detect: () => {
      const title = cleanTitle(document.title, ['ChatGPT', 'OpenAI'])
        || getText('main h1, [data-testid*="conversation"] h1')
        || 'Using ChatGPT';

      return {
        platform: 'ChatGPT',
        details: truncate(title),
        state: 'Chatting',
        largeImageKey: 'chatgpt',
        largeImageText: 'Chatting with ChatGPT',
        url: window.location.href
      };
    }
  },
  'hotstar.com': {
    name: 'Hotstar',
    detect: () => createVideoActivity({
      platform: 'Hotstar',
      titleSelectors: [
        '[data-testid*="title"]',
        '[class*="title"]',
        'h1'
      ],
      titleFallbacks: ['Disney+ Hotstar', 'Hotstar'],
      largeImageKey: 'hotstar',
      largeImageText: 'Watching on Hotstar'
    })
  },
  'crunchyroll.com': {
    name: 'Crunchyroll',
    detect: () => createVideoActivity({
      platform: 'Crunchyroll',
      titleSelectors: [
        '[class*="erc-player-header-title"]',
        '[data-t*="title"]',
        'h1'
      ],
      titleFallbacks: ['Crunchyroll'],
      largeImageKey: 'crunchyroll',
      largeImageText: 'Watching on Crunchyroll'
    })
  },
  'wikipedia.org': {
    name: 'Wikipedia',
    detect: () => {
      const title = getText('h1') || cleanTitle(document.title, ['Wikipedia']);
      if (!title) return null;

      return {
        platform: 'Wikipedia',
        details: truncate(title),
        state: 'Reading article',
        largeImageKey: 'wikipedia',
        largeImageText: 'Reading on Wikipedia',
        url: window.location.href
      };
    }
  },
  'google.com': {
    name: 'Google',
    detect: () => {
      const searchInput = document.querySelector('input[name="q"]');
      const searchQuery = searchInput?.value?.trim() || new URLSearchParams(window.location.search).get('q') || '';
      const isSearch = Boolean(searchQuery);

      return {
        platform: 'Google',
        details: truncate(isSearch ? searchQuery : 'Google'),
        state: isSearch ? 'Searching Google' : 'Browsing Google',
        largeImageKey: 'google',
        largeImageText: 'Searching on Google',
        url: window.location.href
      };
    }
  }
};

function createVideoActivity({ platform, titleSelectors, titleFallbacks, largeImageKey, largeImageText }) {
  const title = getFirstText(titleSelectors)
    || getMetaTitle()
    || cleanTitle(document.title, titleFallbacks);
  const media = getMediaInfo('video');

  if (!title || !document.querySelector('video')) {
    return null;
  }

  return {
    platform,
    details: truncate(title),
    state: truncate(media.label),
    largeImageKey,
    largeImageText,
    thumbnailUrl: getThumbnailUrl(),
    url: window.location.href,
    isPlaying: media.isPlaying,
    mediaCurrentTime: media.currentTime,
    mediaDuration: media.duration
  };
}

function getMediaInfo(selector) {
  const media = document.querySelector(selector);
  const isPlaying = media ? !media.paused : true;
  const currentTime = media && Number.isFinite(media.currentTime) ? Math.max(0, media.currentTime) : 0;
  const duration = media && Number.isFinite(media.duration) ? Math.max(0, media.duration) : 0;
  const timeLabel = duration > 0 ? ` • ${formatDuration(currentTime)} / ${formatDuration(duration)}` : '';

  return {
    isPlaying,
    currentTime,
    duration,
    label: `${isPlaying ? 'Playing' : 'Paused'}${timeLabel}`
  };
}

function formatDuration(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const rest = Math.floor(safeSeconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function getFirstText(selectors) {
  for (const selector of selectors) {
    const text = getText(selector);
    if (text) return text;
  }
  return '';
}

function getText(selector) {
  const text = document.querySelector(selector)?.textContent?.trim();
  return text && text.length > 1 ? text.replace(/\s+/g, ' ') : '';
}

function getMetaTitle() {
  return document.querySelector('meta[property="og:title"]')?.content?.trim()
    || document.querySelector('meta[name="twitter:title"]')?.content?.trim()
    || document.querySelector('meta[name="title"]')?.content?.trim()
    || '';
}

function getThumbnailUrl() {
  return document.querySelector('meta[property="og:image"]')?.content?.trim()
    || document.querySelector('meta[name="twitter:image"]')?.content?.trim()
    || document.querySelector('link[rel="image_src"]')?.href?.trim()
    || '';
}

function cleanTitle(title, suffixes = []) {
  let cleaned = String(title || '').trim();
  for (const suffix of suffixes) {
    cleaned = cleaned.replace(new RegExp(`\\s*[-|•]\\s*${escapeRegExp(suffix)}\\s*$`, 'i'), '');
  }
  return cleaned.replace(/\s+/g, ' ').trim();
}

function getPathParts() {
  return window.location.pathname.split('/').filter(Boolean).map(decodeURIComponent);
}

function truncate(value, maxLength = 128) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectActivity() {
  const hostname = window.location.hostname;
  
  for (const [domain, config] of Object.entries(PLATFORMS)) {
    if (hostname.includes(domain)) {
      try {
        return config.detect();
      } catch (error) {
        console.error(`Error detecting ${config.name} activity:`, error);
        return null;
      }
    }
  }
  
  return null;
}

function sendActivitySafely(activity) {
  if (!activity || !chrome?.runtime?.id) {
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
        if (error && !/Extension context invalidated/i.test(error.message || '')) {
          console.warn('[Generic] Send error:', error.message);
        }
      }
    );
  } catch (error) {
    if (!/Extension context invalidated/i.test(error.message || '')) {
      console.warn('[Generic] Send error:', error.message);
    }
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'detectActivity') {
    const activity = detectActivity();
    if (activity) {
      sendActivitySafely(activity);
    }
    sendResponse({ ok: true, found: Boolean(activity) });
    return;
  }

  sendResponse({ ok: true, found: false });
});

setInterval(() => {
  const activity = detectActivity();
  if (activity) {
    sendActivitySafely(activity);
  }
}, 5000);
