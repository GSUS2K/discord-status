// Generic Content Script - handles multiple platforms
const GENERIC_DEBUG = false;
let mediaStatusStyle = 'clean';

chrome.storage.local.get(['mediaStatusStyle'], (result) => {
  mediaStatusStyle = normalizeMediaStatusStyle(result.mediaStatusStyle);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.mediaStatusStyle) return;
  mediaStatusStyle = normalizeMediaStatusStyle(changes.mediaStatusStyle.newValue);
});

function debugGeneric(...args) {
  if (GENERIC_DEBUG) {
    console.debug('[Generic]', ...args);
  }
}

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
  'music.youtube.com': {
    name: 'YouTube Music',
    detect: () => createMediaActivity({
      platform: 'YouTube Music',
      selectors: ['ytmusic-player-bar .title', 'ytmusic-player-bar [class*="title"]'],
      fallbackSuffixes: ['YouTube Music'],
      mediaSelector: 'audio, video',
      largeImageKey: 'youtubemusic',
      largeImageText: 'Listening on YouTube Music'
    })
  },
  'primevideo.com': {
    name: 'Prime Video',
    detect: () => createVideoActivity({
      platform: 'Prime Video',
      titleSelectors: ['[data-automation-id*="title"]', '[class*="Title"]', 'h1'],
      titleFallbacks: ['Prime Video'],
      largeImageKey: 'primevideo',
      largeImageText: 'Watching on Prime Video'
    })
  },
  'amazon.com': {
    name: 'Prime Video',
    detect: () => {
      if (!window.location.pathname.includes('/video')) return null;
      return createVideoActivity({
        platform: 'Prime Video',
        titleSelectors: ['[data-automation-id*="title"]', '[class*="Title"]', 'h1'],
        titleFallbacks: ['Prime Video', 'Amazon'],
        largeImageKey: 'primevideo',
        largeImageText: 'Watching on Prime Video'
      });
    }
  },
  'hulu.com': {
    name: 'Hulu',
    detect: () => createVideoActivity({
      platform: 'Hulu',
      titleSelectors: ['[data-testid*="title"]', '[class*="Title"]', 'h1'],
      titleFallbacks: ['Hulu'],
      largeImageKey: 'hulu',
      largeImageText: 'Watching on Hulu'
    })
  },
  'disneyplus.com': {
    name: 'Disney+',
    detect: () => createVideoActivity({
      platform: 'Disney+',
      titleSelectors: ['[data-testid*="title"]', '[class*="title"]', 'h1'],
      titleFallbacks: ['Disney+', 'Disney Plus'],
      largeImageKey: 'disneyplus',
      largeImageText: 'Watching on Disney+'
    })
  },
  'tv.apple.com': {
    name: 'Apple TV',
    detect: () => createVideoActivity({
      platform: 'Apple TV',
      titleSelectors: ['[data-testid*="title"]', '[class*="title"]', 'h1'],
      titleFallbacks: ['Apple TV+'],
      largeImageKey: 'appletv',
      largeImageText: 'Watching on Apple TV'
    })
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
  'github.dev': {
    name: 'VS Code Web',
    detect: () => createPageActivity({
      platform: 'VS Code Web',
      state: 'Coding in browser',
      largeImageKey: 'vscode',
      largeImageText: 'Coding in VS Code Web',
      titleFallbacks: ['Visual Studio Code', 'GitHub']
    })
  },
  'vscode.dev': {
    name: 'VS Code Web',
    detect: () => createPageActivity({
      platform: 'VS Code Web',
      state: 'Coding in browser',
      largeImageKey: 'vscode',
      largeImageText: 'Coding in VS Code Web',
      titleFallbacks: ['Visual Studio Code']
    })
  },
  'linear.app': {
    name: 'Linear',
    detect: () => createPageActivity({
      platform: 'Linear',
      state: 'Managing issues',
      largeImageKey: 'linear',
      largeImageText: 'Working in Linear',
      titleFallbacks: ['Linear']
    })
  },
  'atlassian.net': {
    name: 'Jira',
    detect: () => createPageActivity({
      platform: 'Jira',
      state: 'Managing project work',
      largeImageKey: 'jira',
      largeImageText: 'Working in Jira',
      titleFallbacks: ['Jira']
    })
  },
  'notion.so': {
    name: 'Notion',
    detect: () => createPageActivity({
      platform: 'Notion',
      state: 'Writing notes',
      largeImageKey: 'notion',
      largeImageText: 'Working in Notion',
      titleFallbacks: ['Notion']
    })
  },
  'docs.google.com': {
    name: 'Google Docs',
    detect: () => createPageActivity({
      platform: 'Google Docs',
      state: 'Editing document',
      largeImageKey: 'googledocs',
      largeImageText: 'Working in Google Docs',
      titleFallbacks: ['Google Docs', 'Google Sheets', 'Google Slides']
    })
  },
  'figma.com': {
    name: 'Figma',
    detect: () => createPageActivity({
      platform: 'Figma',
      state: 'Designing',
      largeImageKey: 'figma',
      largeImageText: 'Designing in Figma',
      titleFallbacks: ['Figma']
    })
  },
  'canva.com': {
    name: 'Canva',
    detect: () => createPageActivity({
      platform: 'Canva',
      state: 'Designing',
      largeImageKey: 'canva',
      largeImageText: 'Designing in Canva',
      titleFallbacks: ['Canva']
    })
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
  'soundcloud.com': {
    name: 'SoundCloud',
    detect: () => createMediaActivity({
      platform: 'SoundCloud',
      selectors: ['[data-testid="playbackSoundTitle"]', '.playbackSoundBadge__titleLink', 'h1'],
      fallbackSuffixes: ['SoundCloud'],
      mediaSelector: 'audio',
      largeImageKey: 'soundcloud',
      largeImageText: 'Listening on SoundCloud'
    })
  },
  'music.apple.com': {
    name: 'Apple Music',
    detect: () => createMediaActivity({
      platform: 'Apple Music',
      selectors: ['[data-testid*="song-title"]', '[class*="song-name"]', 'h1'],
      fallbackSuffixes: ['Apple Music'],
      mediaSelector: 'audio, video',
      largeImageKey: 'applemusic',
      largeImageText: 'Listening on Apple Music'
    })
  },
  'bandcamp.com': {
    name: 'Bandcamp',
    detect: () => createMediaActivity({
      platform: 'Bandcamp',
      selectors: ['.trackTitle', 'h2.trackTitle', 'h1'],
      fallbackSuffixes: ['Bandcamp'],
      mediaSelector: 'audio',
      largeImageKey: 'bandcamp',
      largeImageText: 'Listening on Bandcamp'
    })
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
  'coursera.org': {
    name: 'Coursera',
    detect: () => createPageActivity({
      platform: 'Coursera',
      state: 'Learning',
      largeImageKey: 'coursera',
      largeImageText: 'Learning on Coursera',
      titleFallbacks: ['Coursera']
    })
  },
  'udemy.com': {
    name: 'Udemy',
    detect: () => createPageActivity({
      platform: 'Udemy',
      state: 'Learning',
      largeImageKey: 'udemy',
      largeImageText: 'Learning on Udemy',
      titleFallbacks: ['Udemy']
    })
  },
  'khanacademy.org': {
    name: 'Khan Academy',
    detect: () => createPageActivity({
      platform: 'Khan Academy',
      state: 'Learning',
      largeImageKey: 'khanacademy',
      largeImageText: 'Learning on Khan Academy',
      titleFallbacks: ['Khan Academy']
    })
  },
  'leetcode.com': {
    name: 'LeetCode',
    detect: () => createPageActivity({
      platform: 'LeetCode',
      state: 'Practicing code',
      largeImageKey: 'leetcode',
      largeImageText: 'Solving on LeetCode',
      titleFallbacks: ['LeetCode']
    })
  },
  'reddit.com': {
    name: 'Reddit',
    detect: () => createPageActivity({
      platform: 'Reddit',
      state: 'Browsing Reddit',
      largeImageKey: 'reddit',
      largeImageText: 'Browsing Reddit',
      titleFallbacks: ['Reddit']
    })
  },
  'x.com': {
    name: 'X',
    detect: () => createPageActivity({
      platform: 'X',
      state: 'Browsing X',
      largeImageKey: 'twitter',
      largeImageText: 'Browsing X',
      titleFallbacks: ['X']
    })
  },
  'twitter.com': {
    name: 'X',
    detect: () => createPageActivity({
      platform: 'X',
      state: 'Browsing X',
      largeImageKey: 'twitter',
      largeImageText: 'Browsing X',
      titleFallbacks: ['X', 'Twitter']
    })
  },
  'instagram.com': {
    name: 'Instagram',
    detect: () => createPageActivity({
      platform: 'Instagram',
      state: 'Browsing Instagram',
      largeImageKey: 'instagram',
      largeImageText: 'Browsing Instagram',
      titleFallbacks: ['Instagram']
    })
  },
  'linkedin.com': {
    name: 'LinkedIn',
    detect: () => createPageActivity({
      platform: 'LinkedIn',
      state: 'Browsing LinkedIn',
      largeImageKey: 'linkedin',
      largeImageText: 'Browsing LinkedIn',
      titleFallbacks: ['LinkedIn']
    })
  },
  'store.steampowered.com': {
    name: 'Steam',
    detect: () => createPageActivity({
      platform: 'Steam',
      state: 'Browsing games',
      largeImageKey: 'steam',
      largeImageText: 'Browsing Steam',
      titleFallbacks: ['Steam']
    })
  },
  'steamcommunity.com': {
    name: 'Steam',
    detect: () => createPageActivity({
      platform: 'Steam',
      state: 'Browsing community',
      largeImageKey: 'steam',
      largeImageText: 'Browsing Steam Community',
      titleFallbacks: ['Steam Community']
    })
  },
  'chess.com': {
    name: 'Chess.com',
    detect: () => createPageActivity({
      platform: 'Chess.com',
      state: 'Playing chess',
      largeImageKey: 'chess',
      largeImageText: 'Playing Chess.com',
      titleFallbacks: ['Chess.com']
    })
  },
  'lichess.org': {
    name: 'Lichess',
    detect: () => createPageActivity({
      platform: 'Lichess',
      state: 'Playing chess',
      largeImageKey: 'lichess',
      largeImageText: 'Playing Lichess',
      titleFallbacks: ['lichess.org', 'lichess']
    })
  },
  'skribbl.io': {
    name: 'Skribbl.io',
    detect: () => createPageActivity({
      platform: 'Skribbl.io',
      state: 'Playing drawing game',
      largeImageKey: 'skribbl',
      largeImageText: 'Playing Skribbl.io',
      titleFallbacks: ['skribbl.io']
    })
  },
  'geoguessr.com': {
    name: 'GeoGuessr',
    detect: () => createPageActivity({
      platform: 'GeoGuessr',
      state: 'Playing geography game',
      largeImageKey: 'geoguessr',
      largeImageText: 'Playing GeoGuessr',
      titleFallbacks: ['GeoGuessr']
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

function createPageActivity({ platform, state, largeImageKey, largeImageText, titleFallbacks = [] }) {
  const title = chooseTitle([
    getMetaTitle(),
    getFirstText(['h1']),
    cleanTitle(document.title, titleFallbacks)
  ], titleFallbacks);

  if (!title || title.toLowerCase() === platform.toLowerCase()) return null;

  return {
    platform,
    details: truncate(title),
    state,
    largeImageKey,
    largeImageText,
    thumbnailUrl: getThumbnailUrl(),
    url: window.location.href
  };
}

function createMediaActivity({ platform, selectors, fallbackSuffixes, mediaSelector, largeImageKey, largeImageText }) {
  const title = chooseTitle([
    getFirstText(selectors),
    getMetaTitle(),
    cleanTitle(document.title, fallbackSuffixes)
  ], fallbackSuffixes);
  const media = getMediaInfo(mediaSelector);

  if (!title) return null;
  const metadata = parseEpisodeMetadata(title);

  return {
    platform,
    details: truncate(metadata.seriesTitle),
    state: truncate(formatMediaState('Playing', media.isPlaying, media.currentTime, media.duration, metadata.episodeLabel)),
    seriesTitle: metadata.seriesTitle,
    seasonNumber: metadata.seasonNumber,
    episodeNumber: metadata.episodeNumber,
    episodeTitle: metadata.episodeTitle,
    episodeLabel: metadata.episodeLabel,
    largeImageKey,
    largeImageText,
    thumbnailUrl: getThumbnailUrl(),
    url: window.location.href,
    isPlaying: media.isPlaying,
    mediaCurrentTime: media.currentTime,
    mediaDuration: media.duration
  };
}

function createVideoActivity({ platform, titleSelectors, titleFallbacks, largeImageKey, largeImageText }) {
  const title = chooseTitle([
    getFirstText(titleSelectors),
    getMetaTitle(),
    cleanTitle(document.title, titleFallbacks)
  ], titleFallbacks);
  const media = getMediaInfo('video');

  if (!title || !document.querySelector('video')) {
    return null;
  }
  const metadata = parseEpisodeMetadata(title);

  return {
    platform,
    details: truncate(metadata.seriesTitle),
    state: truncate(formatMediaState('Watching', media.isPlaying, media.currentTime, media.duration, metadata.episodeLabel)),
    seriesTitle: metadata.seriesTitle,
    seasonNumber: metadata.seasonNumber,
    episodeNumber: metadata.episodeNumber,
    episodeTitle: metadata.episodeTitle,
    episodeLabel: metadata.episodeLabel,
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

  return {
    isPlaying,
    currentTime,
    duration,
    label: formatMediaState('Playing', isPlaying, currentTime, duration)
  };
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

  return parts.join(' - ');
}

function formatDuration(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const rest = Math.floor(safeSeconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function parseEpisodeMetadata(value) {
  const raw = normalizeTitleText(value);
  const match = raw.match(/^(.*?)\s+S(\d+)\s*E(\d+)(?:\s*[-:|.]?\s*)(.*)$/i);
  if (match) {
    const episodeTitle = normalizeTitleText(match[4] || '');
    return {
      seriesTitle: normalizeTitleText(match[1]),
      seasonNumber: Number(match[2]),
      episodeNumber: Number(match[3]),
      episodeTitle,
      episodeLabel: `S${match[2]} E${match[3]}${episodeTitle ? ` · ${episodeTitle}` : ''}`
    };
  }

  const episode = raw.match(/^(.*?)\s+E(\d+)(?:\s*[-:|.]?\s*)(.*)$/i)
    || raw.match(/^(.*?)\s+Episode\s*(\d+)(?:\s*[-:|.]?\s*)(.*)$/i);
  if (!episode) {
    return { seriesTitle: raw, seasonNumber: null, episodeNumber: null, episodeTitle: '', episodeLabel: '' };
  }

  const episodeTitle = normalizeTitleText(episode[3] || '');
  return {
    seriesTitle: normalizeTitleText(episode[1]),
    seasonNumber: null,
    episodeNumber: Number(episode[2]),
    episodeTitle,
    episodeLabel: `E${episode[2]}${episodeTitle ? ` · ${episodeTitle}` : ''}`
  };
}

function getFirstText(selectors) {
  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    for (const element of elements) {
      const text = normalizeTitleText(element?.textContent || element?.getAttribute?.('aria-label') || '');
      if (text) return text;
    }
  }
  return '';
}

function chooseTitle(candidates, fallbacks = []) {
  for (const candidate of candidates) {
    const text = normalizeTitleText(candidate);
    if (isMeaningfulTitle(text, fallbacks)) {
      return text;
    }
  }
  return '';
}

function normalizeTitleText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

function isMeaningfulTitle(value, fallbacks = []) {
  const text = normalizeTitleText(value);
  if (!text || text.length < 3) return false;

  const lower = text.toLowerCase();
  if (fallbacks.some(fallback => lower === normalizeTitleText(fallback).toLowerCase())) {
    return false;
  }

  const noisePatterns = [
    /^browse\b/i,
    /\bbrowse by languages?\b/i,
    /\bhome\b/i,
    /\bsearch\b/i,
    /\bsign in\b/i,
    /\bsign up\b/i,
    /\bsettings\b/i,
    /\bprofile\b/i,
    /\baccount\b/i,
    /\bmy list\b/i,
    /\bcontinue watching\b/i,
    /\brecommend(?:ed|ations?)\b/i,
    /\btrending\b/i,
    /\btop 10\b/i
  ];

  return !noisePatterns.some(pattern => pattern.test(text));
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
  const candidates = [
    document.querySelector('video[poster]')?.poster,
    getStructuredImage(),
    getVisibleMediaImage(),
    document.querySelector('meta[property="og:image"]')?.content,
    document.querySelector('meta[name="twitter:image"]')?.content,
    document.querySelector('link[rel="image_src"]')?.href
  ];

  return candidates
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .map(value => {
      try {
        return new URL(value, window.location.href).href;
      } catch {
        return '';
      }
    })
    .find(value => /^https?:\/\//i.test(value)) || '';
}

function getVisibleMediaImage() {
  const images = Array.from(document.querySelectorAll('img[src]'))
    .map(image => ({
      url: image.currentSrc || image.src || '',
      area: Number(image.naturalWidth || image.clientWidth || 0) * Number(image.naturalHeight || image.clientHeight || 0),
      ratio: Number(image.naturalHeight || image.clientHeight || 0) > 0
        ? Number(image.naturalWidth || image.clientWidth || 0) / Number(image.naturalHeight || image.clientHeight || 0)
        : 0
    }))
    .filter(image => /^https?:\/\//i.test(image.url))
    .filter(image => !/avatar|profile|logo|sprite|icon|badge/i.test(image.url))
    .filter(image => image.area > 24000 && image.ratio > .55 && image.ratio < 2.4)
    .sort((a, b) => b.area - a.area);
  return images[0]?.url || '';
}

function getStructuredImage() {
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const value = JSON.parse(script.textContent || 'null');
      const entries = Array.isArray(value) ? value : [value];
      for (const entry of entries) {
        const image = entry?.image;
        if (typeof image === 'string') return image;
        if (Array.isArray(image) && typeof image[0] === 'string') return image[0];
        if (image?.url) return image.url;
      }
    } catch {
      // Pages often contain partial JSON-LD while they are still loading.
    }
  }
  return '';
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
        debugGeneric(`Error detecting ${config.name} activity:`, error);
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
          debugGeneric('Send error:', error.message);
        }
      }
    );
  } catch (error) {
    if (!/Extension context invalidated/i.test(error.message || '')) {
      debugGeneric('Send error:', error.message);
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

