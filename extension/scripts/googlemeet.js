// Google Meet Content Script

function detectGoogleMeetActivity() {
  // Check if in a meeting
  const meetingTitle = document.querySelector('[role="heading"]');
  if (!meetingTitle) return null;
  
  // Get participant count
  const participantElements = document.querySelectorAll('[data-participant-id]');
  const participantCount = participantElements.length;
  
  // Check if video/audio is on
  const videoButton = document.querySelector('[aria-label*="Turn off camera"], [aria-label*="Turn on camera"]');
  const audioButton = document.querySelector('[aria-label*="Turn off microphone"], [aria-label*="Turn on microphone"]');
  
  const videoLabel = videoButton?.getAttribute('aria-label') || '';
  const audioLabel = audioButton?.getAttribute('aria-label') || '';
  const videoOn = videoLabel.includes('Turn off');
  const audioOn = audioLabel.includes('Turn off');
  
  let state = 'In Meeting';
  if (participantCount > 0) {
    state += ` • ${participantCount} participant${participantCount !== 1 ? 's' : ''}`;
  }
  
  state += ` • ${videoOn ? '[Camera ON]' : '[Camera OFF]'} ${audioOn ? '[Mic ON]' : '[Mic OFF]'}`;
  
  return {
    platform: 'Google Meet',
    details: meetingTitle.textContent.trim().substring(0, 128),
    state: state.substring(0, 128),
    largeImageKey: 'meet',
    largeImageText: 'In a Google Meet',
    url: window.location.href
  };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'detectActivity') {
    const activity = detectGoogleMeetActivity();
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
  const activity = detectGoogleMeetActivity();
  if (activity) {
    chrome.runtime.sendMessage({
      action: 'activityDetected',
      activity: activity
    }).catch(() => {});
  }
}, 5000);
