// YouTube Content Script

function getYouTubeTitle() {
  const titleSelectors = [
    'ytd-watch-metadata h1 yt-formatted-string',
    '#title h1 yt-formatted-string',
    'h1 yt-formatted-string',
    'h1.title yt-formatted-string'
  ];

  for (const selector of titleSelectors) {
    const element = document.querySelector(selector);
    const text = element?.textContent?.trim();
    if (text && text.length > 2) {
      return text;
    }
  }

  const metaTitle = document.querySelector('meta[name="title"]')?.content?.trim();
  if (metaTitle && metaTitle.length > 2) {
    return metaTitle;
  }

  const pageTitle = document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim();
  if (pageTitle && pageTitle.length > 2 && !/^YouTube$/i.test(pageTitle)) {
    return pageTitle;
  }

  return null;
}

function detectYouTubeActivity() {
  try {
    const title = getYouTubeTitle();
    if (!title) {
      console.log('[YouTube] Title not ready yet');
      return null;
    }

    const video = document.querySelector('video');
    if (!video) {
      console.log('[YouTube] No video element found');
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
    const state = `${isPlaying ? 'Playing' : 'Paused'}${timeLabel}`;

    const activity = {
      platform: 'YouTube',
      details: title.substring(0, 100),
      state: state,
      largeImageKey: 'youtube',
      largeImageText: 'Watching YouTube',
      url: window.location.href,
      isPlaying,
      mediaCurrentTime: currentTime,
      mediaDuration: duration
    };

    console.log('[YouTube] Detected:', activity);
    return activity;
  } catch (error) {
    console.log('[YouTube] Error:', error.message);
    return null;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[YouTube] Message received:', request.action);
  if (request.action === 'detectActivity') {
    const activity = detectYouTubeActivity();
    if (activity) {
      console.log('[YouTube] Sending activity detected');
      chrome.runtime.sendMessage({
        action: 'activityDetected',
        activity: activity
      }).catch(err => console.log('[YouTube] Send error:', err.message));
    }
    sendResponse({ ok: true, found: Boolean(activity) });
    return;
  }

  sendResponse({ ok: true, found: false });
});

function sendDetectedActivity() {
  const activity = detectYouTubeActivity();
  if (activity) {
    chrome.runtime.sendMessage({
      action: 'activityDetected',
      activity: activity
    }).catch(err => console.log('[YouTube] Send error:', err.message));
  }
}

// Retry a few times because YouTube loads the title late
setTimeout(sendDetectedActivity, 2000);
setInterval(sendDetectedActivity, 5000);
