// SLAIF Connect background service worker.
// Receives launch requests from approved SLAIF web origins and opens a session page.

const ALLOWED_WEB_ORIGINS = new Set([
  'https://connect.slaif.si',
  'https://www.slaif.si',
  'https://stare.lmi.link',
]);

function send(sendResponse, body) {
  sendResponse(body);
}

function originFromSender(sender) {
  if (!sender || !sender.url) {
    return null;
  }
  try {
    return new URL(sender.url).origin;
  } catch (_e) {
    return null;
  }
}

function isSafeAlias(value) {
  return typeof value === 'string' && /^[a-z0-9_-]{1,64}$/i.test(value);
}

function isSafeSessionId(value) {
  return typeof value === 'string' && /^sess_[A-Za-z0-9_-]{8,128}$/.test(value);
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  const origin = originFromSender(sender);

  if (!origin || !ALLOWED_WEB_ORIGINS.has(origin)) {
    send(sendResponse, {ok: false, error: 'origin_not_allowed'});
    return false;
  }

  if (!message || message.type !== 'slaif.startSession') {
    send(sendResponse, {ok: false, error: 'unknown_message'});
    return false;
  }

  if (!isSafeAlias(message.hpc)) {
    send(sendResponse, {ok: false, error: 'invalid_hpc_alias'});
    return false;
  }

  if (!isSafeSessionId(message.sessionId)) {
    send(sendResponse, {ok: false, error: 'invalid_session_id'});
    return false;
  }

  const pending = {
    hpc: message.hpc,
    sessionId: message.sessionId,
    origin,
    createdAt: Date.now(),
  };

  chrome.storage.session.set({pendingSlaifSession: pending}, () => {
    if (chrome.runtime.lastError) {
      send(sendResponse, {ok: false, error: chrome.runtime.lastError.message});
      return;
    }

    chrome.windows.create({
      url: chrome.runtime.getURL('html/session.html'),
      type: 'popup',
      width: 1040,
      height: 760,
    }, () => {
      if (chrome.runtime.lastError) {
        send(sendResponse, {ok: false, error: chrome.runtime.lastError.message});
        return;
      }
      send(sendResponse, {ok: true});
    });
  });

  return true;
});
