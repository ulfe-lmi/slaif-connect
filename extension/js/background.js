// SLAIF Connect background service worker.
// Receives launch requests from approved SLAIF web origins and opens a session page.

import {validateLaunchMessage} from './slaif_session_descriptor.js';

const ALLOWED_WEB_ORIGINS = new Set([
  'https://connect.slaif.si',
  'https://www.slaif.si',
  'https://stare.lmi.link',
]);

function send(sendResponse, body) {
  sendResponse(body);
}

export function originFromSender(sender) {
  if (!sender || !sender.url) {
    return null;
  }
  try {
    return new URL(sender.url).origin;
  } catch (_e) {
    return null;
  }
}

export function isAllowedExternalOrigin(origin) {
  if (ALLOWED_WEB_ORIGINS.has(origin)) {
    return true;
  }
  try {
    const url = new URL(origin);
    // Local browser E2E launcher only. Production launch origins must remain HTTPS.
    return url.protocol === 'http:' && url.hostname === '127.0.0.1';
  } catch (_e) {
    return false;
  }
}

function createLaunchId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `launch_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function errorResponse(error) {
  return {
    ok: false,
    error: error.message || String(error),
  };
}

export function buildPendingLaunch(message, sender, now = Date.now()) {
  const origin = originFromSender(sender);

  if (!origin || !isAllowedExternalOrigin(origin)) {
    throw new Error('origin_not_allowed');
  }

  const launch = validateLaunchMessage(message);

  return {
    ...launch,
    launchId: createLaunchId(),
    origin,
    createdAt: now,
  };
}

function handleExternalMessage(message, sender, sendResponse) {
  let pending;
  try {
    pending = buildPendingLaunch(message, sender);
  } catch (error) {
    send(sendResponse, errorResponse(error));
    return false;
  }

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
      send(sendResponse, {ok: true, launchId: pending.launchId});
    });
  });

  return true;
}

if (globalThis.chrome?.runtime?.onMessageExternal) {
  chrome.runtime.onMessageExternal.addListener(handleExternalMessage);
}
