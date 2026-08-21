import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function element(text = '', extra = {}) {
  return {
    textContent: text,
    getAttribute: name => extra[name] || '',
    ...extra
  };
}

function loadDetector(path, document) {
  const listeners = [];
  const context = {
    console,
    URL,
    navigator: { mediaSession: { metadata: null } },
    window: { location: { href: 'https://example.test/watch', hostname: 'example.test', pathname: '/watch' } },
    document,
    setInterval: () => 0,
    setTimeout: () => 0,
    chrome: {
      storage: {
        local: { get: (_keys, callback) => callback({}), set: () => {} },
        onChanged: { addListener: () => {} }
      },
      runtime: {
        onMessage: { addListener: listener => listeners.push(listener) },
        sendMessage: () => Promise.resolve()
      }
    }
  };
  vm.runInNewContext(readFileSync(path, 'utf8'), context, { filename: path });
  return context;
}

const netflixDocument = {
  title: 'Chainsmoker Cat Episode 8 - Netflix',
  querySelectorAll: selector => {
    if (selector === '[data-uia="video-title"]') return [element('Browse by Languages')];
    if (selector === 'h1') return [element('Chainsmoker Cat Episode 8')];
    return [];
  },
  querySelector: selector => {
    if (selector === 'video') return { paused: false, currentTime: 124, duration: 1422 };
    if (selector === 'meta[property="og:image"]') return { content: 'https://image.example/show.jpg' };
    return null;
  }
};
const netflix = loadDetector('extension/scripts/netflix.js', netflixDocument);
const netflixActivity = netflix.detectNetflixActivity();
if (netflixActivity?.details !== 'Chainsmoker Cat' || netflixActivity?.episodeLabel !== 'E8') {
  throw new Error(`Netflix metadata regression: ${netflixActivity?.details || 'no activity'} ${netflixActivity?.episodeLabel || ''}`);
}
if (netflixActivity.thumbnailUrl !== 'https://image.example/show.jpg') {
  throw new Error(`Netflix artwork regression: ${netflixActivity.thumbnailUrl || 'no artwork'}`);
}

const netflixMediaSessionDocument = {
  title: 'First Party Performance and Functional Cookies - Netflix',
  querySelectorAll: selector => selector === 'h1' ? [element('First Party Performance and Functional Cookies')] : [],
  querySelector: selector => selector === 'video'
    ? { paused: false, currentTime: 305, duration: 1432 }
    : null
};
const netflixMediaSession = loadDetector('extension/scripts/netflix.js', netflixMediaSessionDocument);
netflixMediaSession.navigator.mediaSession.metadata = {
  title: 'E21 The Headless Star',
  artist: 'Bleach',
  album: 'Bleach',
  artwork: [{ src: 'https://image.example/bleach.jpg' }]
};
const netflixMediaSessionActivity = netflixMediaSession.detectNetflixActivity();
if (netflixMediaSessionActivity?.details !== 'Bleach' || !/Headless Star/.test(netflixMediaSessionActivity?.episodeLabel || '')) {
  throw new Error(`Netflix Media Session regression: ${netflixMediaSessionActivity?.details || 'no activity'} ${netflixMediaSessionActivity?.episodeLabel || ''}`);
}
if (netflixMediaSessionActivity.thumbnailUrl !== 'https://image.example/bleach.jpg') {
  throw new Error(`Netflix Media Session artwork regression: ${netflixMediaSessionActivity.thumbnailUrl || 'no artwork'}`);
}

const spotifyDocument = {
  querySelector: selector => {
    if (selector === 'a[data-testid="nowplaying-track-link"]') return element('Quiet Hours');
    if (selector === 'a[data-testid="nowplaying-artist"]') return element('Example Artist');
    if (selector === 'audio') return { paused: true, currentTime: 12, duration: 180 };
    if (selector === 'button[data-testid="control-button-pause"]') return null;
    if (selector === 'button[data-testid="control-button-play"]') return element();
    if (selector.includes('cover-art-image')) return { src: 'https://image.example/album.jpg' };
    if (selector === 'meta[property="og:image"]') return { content: '' };
    return null;
  }
};
const spotify = loadDetector('extension/scripts/spotify.js', spotifyDocument);
const spotifyActivity = spotify.detectSpotifyActivity();
if (spotifyActivity?.isPlaying !== false) {
  throw new Error('Spotify pause-state regression: paused media was reported as playing');
}

const genericDocument = {
  title: 'Chainsmoker Cat Episode 8 - Netflix',
  querySelectorAll: selector => {
    if (selector === '[class*="erc-player-header-title"]') return [element('Browse by Languages')];
    if (selector === 'h1') return [element('Chainsmoker Cat Episode 8')];
    if (selector === 'script[type="application/ld+json"]') return [];
    return [];
  },
  querySelector: selector => {
    if (selector === 'video') return { paused: false, currentTime: 124, duration: 1422 };
    if (selector === 'meta[property="og:title"]') return { content: 'Chainsmoker Cat Episode 8' };
    if (selector === 'meta[property="og:image"]') return { content: 'https://image.example/show.jpg' };
    return null;
  }
};
const generic = loadDetector('extension/scripts/generic.js', genericDocument);
generic.window.location.hostname = 'crunchyroll.com';
const genericActivity = generic.detectActivity();
if (genericActivity?.details === 'Browse by Languages' || genericActivity?.details !== 'Chainsmoker Cat' || genericActivity?.episodeLabel !== 'E8') {
  throw new Error(`Generic metadata regression: ${genericActivity?.details || 'no activity'} ${genericActivity?.episodeLabel || ''}`);
}
if (genericActivity.thumbnailUrl !== 'https://image.example/show.jpg') {
  throw new Error(`Generic artwork regression: ${genericActivity.thumbnailUrl || 'no artwork'}`);
}

const genericMediaSessionDocument = {
  title: 'First Party Performance and Functional Cookies',
  querySelectorAll: selector => selector === 'h1' ? [element('First Party Performance and Functional Cookies')] : [],
  querySelector: selector => selector === 'video'
    ? { paused: false, currentTime: 305, duration: 1432 }
    : null
};
const genericMediaSession = loadDetector('extension/scripts/generic.js', genericMediaSessionDocument);
genericMediaSession.window.location.hostname = 'hotstar.com';
genericMediaSession.navigator.mediaSession.metadata = {
  title: 'E21 The Headless Star',
  artist: 'Bleach',
  album: 'Bleach',
  artwork: [{ src: 'https://image.example/bleach.jpg' }]
};
const genericMediaSessionActivity = genericMediaSession.detectActivity();
if (genericMediaSessionActivity?.details !== 'Bleach' || !/Headless Star/.test(genericMediaSessionActivity?.episodeLabel || '')) {
  throw new Error(`Generic Media Session regression: ${genericMediaSessionActivity?.details || 'no activity'} ${genericMediaSessionActivity?.episodeLabel || ''}`);
}
if (genericMediaSessionActivity.thumbnailUrl !== 'https://image.example/bleach.jpg') {
  throw new Error(`Generic Media Session artwork regression: ${genericMediaSessionActivity.thumbnailUrl || 'no artwork'}`);
}

const videoDomains = [
  ['primevideo.com', '/detail/watch', 'Prime Video'],
  ['amazon.com', '/gp/video/detail/watch', 'Prime Video'],
  ['hulu.com', '/watch/example', 'Hulu'],
  ['disneyplus.com', '/video/example', 'Disney+'],
  ['tv.apple.com', '/show/example', 'Apple TV'],
  ['hotstar.com', '/in/shows/example', 'Hotstar'],
  ['crunchyroll.com', '/watch/example', 'Crunchyroll']
];
for (const [hostname, pathname, platform] of videoDomains) {
  const detector = loadDetector('extension/scripts/generic.js', genericMediaSessionDocument);
  detector.window.location.hostname = hostname;
  detector.window.location.pathname = pathname;
  detector.navigator.mediaSession.metadata = genericMediaSession.navigator.mediaSession.metadata;
  const activity = detector.detectActivity();
  if (activity?.platform !== platform || activity?.details !== 'Bleach' || !/Headless Star/.test(activity?.episodeLabel || '')) {
    throw new Error(`${platform} metadata regression: ${activity?.details || 'no activity'} ${activity?.episodeLabel || ''}`);
  }
  if (activity.thumbnailUrl !== 'https://image.example/bleach.jpg') {
    throw new Error(`${platform} artwork regression: ${activity.thumbnailUrl || 'no artwork'}`);
  }
}

const musicDocument = {
  title: 'Cookie Settings',
  querySelectorAll: selector => selector === 'script[type="application/ld+json"]' ? [] : [],
  querySelector: selector => /audio|video/.test(selector)
    ? { paused: false, currentTime: 82, duration: 244 }
    : null
};
const musicDomains = [
  ['music.youtube.com', 'YouTube Music'],
  ['soundcloud.com', 'SoundCloud'],
  ['music.apple.com', 'Apple Music'],
  ['bandcamp.com', 'Bandcamp']
];
for (const [hostname, platform] of musicDomains) {
  const detector = loadDetector('extension/scripts/generic.js', musicDocument);
  detector.window.location.hostname = hostname;
  detector.navigator.mediaSession.metadata = {
    title: 'Headlights',
    artist: 'The Midnight',
    album: 'Endless Summer',
    artwork: [{ src: 'https://image.example/headlights.jpg' }]
  };
  const activity = detector.detectActivity();
  if (activity?.platform !== platform || activity?.details !== 'Headlights' || !/The Midnight.*Listening/.test(activity?.state || '')) {
    throw new Error(`${platform} music metadata regression: ${activity?.details || 'no activity'} ${activity?.state || ''}`);
  }
  if (activity.thumbnailUrl !== 'https://image.example/headlights.jpg') {
    throw new Error(`${platform} artwork regression: ${activity.thumbnailUrl || 'no artwork'}`);
  }
}

console.log('detector runtime checks passed');
