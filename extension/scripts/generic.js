// Generic Content Script - handles multiple platforms

const PLATFORMS = {
  'twitch.tv': {
    name: 'Twitch',
    detect: () => {
      const titleElement = document.querySelector('[data-test-selector="stream-title"]');
      const channelElement = document.querySelector('[data-test-selector="channel-header-desktop"] a');
      const video = document.querySelector('video');
      
      if (!titleElement) return null;
      
      const title = titleElement.textContent.trim();
      const channel = channelElement ? channelElement.textContent.trim() : 'Twitch';
      const isPlaying = video ? !video.paused : true;
      const currentTime = video && Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0;
      const duration = video && Number.isFinite(video.duration) ? Math.max(0, video.duration) : 0;
      const currentMinutes = Math.floor(currentTime / 60);
      const currentSeconds = Math.floor(currentTime % 60);
      const durationMinutes = Math.floor(duration / 60);
      const durationSeconds = Math.floor(duration % 60);
      const timeLabel = duration > 0
        ? ` • ${String(currentMinutes).padStart(2, '0')}:${String(currentSeconds).padStart(2, '0')} / ${String(durationMinutes).padStart(2, '0')}:${String(durationSeconds).padStart(2, '0')}`
        : '';
      
      return {
        platform: 'Twitch',
        details: title.substring(0, 128),
        state: `${isPlaying ? 'Playing' : 'Paused'}${timeLabel} • ${channel}`.substring(0, 128),
        largeImageKey: 'twitch',
        largeImageText: 'Watching on Twitch',
        isPlaying,
        mediaCurrentTime: currentTime,
        mediaDuration: duration
      };
    }
  },
  'discord.com': {
    name: 'Discord',
    detect: () => {
      const voiceChannel = document.querySelector('[class*="container-3baos1"]');
      if (!voiceChannel) return null;
      
      const channelName = document.querySelector('[class*="h5-18_1nd"]');
      const userName = document.querySelector('[class*="title-3sZWYQ"]');
      
      if (!channelName) return null;
      
      return {
        platform: 'Discord',
        details: `In ${channelName.textContent.trim()}`.substring(0, 128),
        state: 'Voice Call'.substring(0, 128),
        largeImageKey: 'discord',
        largeImageText: 'In a Discord Voice Call'
      };
    }
  },
  'github.com': {
    name: 'GitHub',
    detect: () => {
      const repoName = document.querySelector('[itemprop="name"] a');
      if (!repoName) return null;
      
      return {
        platform: 'GitHub',
        details: repoName.textContent.trim().substring(0, 128),
        state: 'Browsing Code',
        largeImageKey: 'github',
        largeImageText: 'Browsing on GitHub'
      };
    }
  },
  'chatgpt.com': {
    name: 'ChatGPT',
    detect: () => {
      const convTitle = document.querySelector('[class*="text-2xl"]');
      
      return {
        platform: 'ChatGPT',
        details: convTitle ? convTitle.textContent.trim().substring(0, 128) : 'Using ChatGPT',
        state: 'Chatting',
        largeImageKey: 'chatgpt',
        largeImageText: 'Chatting with ChatGPT'
      };
    }
  },
  'hotstar.com': {
    name: 'Hotstar',
    detect: () => {
      const titleElement = document.querySelector('[class*="title"]');
      if (!titleElement) return null;
      
      const title = titleElement.textContent.trim();
      const video = document.querySelector('video');
      const isPlaying = video && !video.paused;
      const currentTime = video && Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0;
      const duration = video && Number.isFinite(video.duration) ? Math.max(0, video.duration) : 0;
      const currentMinutes = Math.floor(currentTime / 60);
      const currentSeconds = Math.floor(currentTime % 60);
      const durationMinutes = Math.floor(duration / 60);
      const durationSeconds = Math.floor(duration % 60);
      const timeLabel = duration > 0
        ? ` • ${String(currentMinutes).padStart(2, '0')}:${String(currentSeconds).padStart(2, '0')} / ${String(durationMinutes).padStart(2, '0')}:${String(durationSeconds).padStart(2, '0')}`
        : '';
      
      let state = `${isPlaying ? 'Playing' : 'Paused'}${timeLabel}`;
      
      return {
        platform: 'Hotstar',
        details: title.substring(0, 128),
        state: state,
        largeImageKey: 'hotstar',
        largeImageText: 'Watching on Hotstar',
        isPlaying,
        mediaCurrentTime: currentTime,
        mediaDuration: duration
      };
    }
  },
  'crunchyroll.com': {
    name: 'Crunchyroll',
    detect: () => {
      const titleElement = document.querySelector('[class*="erc-player-header-title"]');
      if (!titleElement) return null;
      
      const title = titleElement.textContent.trim();
      const video = document.querySelector('video');
      const isPlaying = video && !video.paused;
      const currentTime = video && Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0;
      const duration = video && Number.isFinite(video.duration) ? Math.max(0, video.duration) : 0;
      const currentMinutes = Math.floor(currentTime / 60);
      const currentSeconds = Math.floor(currentTime % 60);
      const durationMinutes = Math.floor(duration / 60);
      const durationSeconds = Math.floor(duration % 60);
      const timeLabel = duration > 0
        ? ` • ${String(currentMinutes).padStart(2, '0')}:${String(currentSeconds).padStart(2, '0')} / ${String(durationMinutes).padStart(2, '0')}:${String(durationSeconds).padStart(2, '0')}`
        : '';
      
      let state = `${isPlaying ? 'Playing' : 'Paused'}${timeLabel}`;
      
      return {
        platform: 'Crunchyroll',
        details: title.substring(0, 128),
        state: state,
        largeImageKey: 'crunchyroll',
        largeImageText: 'Watching on Crunchyroll',
        isPlaying,
        mediaCurrentTime: currentTime,
        mediaDuration: duration
      };
    }
  },
  'wikipedia.org': {
    name: 'Wikipedia',
    detect: () => {
      const titleElement = document.querySelector('h1');
      if (!titleElement) return null;
      
      return {
        platform: 'Wikipedia',
        details: titleElement.textContent.trim().substring(0, 128),
        state: 'Reading Wikipedia',
        largeImageKey: 'wikipedia',
        largeImageText: 'Reading on Wikipedia'
      };
    }
  },
  'google.com': {
    name: 'Google',
    detect: () => {
      const searchInput = document.querySelector('input[name="q"]');
      const searchQuery = searchInput ? searchInput.value : '';
      
      return {
        platform: 'Google',
        details: searchQuery ? `Searching: ${searchQuery}`.substring(0, 128) : 'Browsing Google',
        state: 'Searching',
        largeImageKey: 'google',
        largeImageText: 'Searching on Google'
      };
    }
  }
};

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
