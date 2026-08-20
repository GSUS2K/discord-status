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
    window: { location: { href: 'https://example.test/watch' } },
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
if (netflixActivity?.details !== 'Chainsmoker Cat Episode 8') {
  throw new Error(`Netflix title regression: ${netflixActivity?.details || 'no activity'}`);
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

console.log('detector runtime checks passed');
