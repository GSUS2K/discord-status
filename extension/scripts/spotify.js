// Spotify Content Script

function detectSpotifyActivity() {
  // Get currently playing track info
  const trackNameElement = document.querySelector('a[data-testid="nowplaying-track-link"]');
  if (!trackNameElement) return null;
  
  const trackName = trackNameElement.textContent.trim();
  
  // Get artist info
  const artistElement = document.querySelector('a[data-testid="nowplaying-artist"]');
  const artist = artistElement ? artistElement.textContent.trim() : '';
  
  const audio = document.querySelector('audio');
  const isPlaying = audio ? !audio.paused : !document.querySelector('button[data-testid="control-button-play"]');
  const currentTime = audio && Number.isFinite(audio.currentTime) ? Math.max(0, audio.currentTime) : 0;
  const duration = audio && Number.isFinite(audio.duration) ? Math.max(0, audio.duration) : 0;
  const currentMinutes = Math.floor(currentTime / 60);
  const currentSeconds = Math.floor(currentTime % 60);
  const durationMinutes = Math.floor(duration / 60);
  const durationSeconds = Math.floor(duration % 60);
  const timeLabel = duration > 0
    ? ` • ${String(currentMinutes).padStart(2, '0')}:${String(currentSeconds).padStart(2, '0')} / ${String(durationMinutes).padStart(2, '0')}:${String(durationSeconds).padStart(2, '0')}`
    : '';
  
  let state = `${isPlaying ? 'Playing' : 'Paused'}${timeLabel}`;
  
  return {
    platform: 'Spotify',
    details: trackName.substring(0, 128),
    state: (artist ? `${artist} • ${state}` : state).substring(0, 128),
    largeImageKey: 'spotify',
    largeImageText: 'Listening on Spotify',
    url: window.location.href,
    isPlaying,
    mediaCurrentTime: currentTime,
    mediaDuration: duration
  };
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
