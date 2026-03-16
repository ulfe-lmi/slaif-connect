// Copyright 2026 The ChromiumOS Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import {lib} from '../../libdot/index.js';

import {punycode} from './deps_punycode.rollup.js';

const SLAIF_CONFIG_PATH = '/config/SLAIF.conf';

/**
 * @param {string} value
 * @return {string}
 */
function normalizeHostLike(value) {
  return punycode.toASCII(value).toLowerCase().replace(/\.$/, '');
}

/**
 * @param {string} text
 * @param {string} sectionName
 * @return {!Map<string, string>}
 */
function parseSlaifSection(text, sectionName) {
  const entries = new Map();
  let inSection = false;

  text.split(/\r?\n/u).forEach((rawLine) => {
    let line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) {
      return;
    }

    line = line.replace(/\s*[#;].*$/u, '').trim();
    if (!line) {
      return;
    }

    const section = line.match(/^\[([^\]]+)\]$/u);
    if (section) {
      inSection = section[1].trim().toLowerCase() === sectionName;
      return;
    }

    if (!inSection) {
      return;
    }

    const eq = line.indexOf('=');
    if (eq <= 0) {
      return;
    }

    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!key || !value) {
      return;
    }

    entries.set(key, value);
  });

  return entries;
}

/**
 * @return {!Promise<!Map<string, string>>}
 */
async function loadSlaifServices() {
  const response = await fetch(lib.f.getURL(SLAIF_CONFIG_PATH));
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = await response.text();
  return parseSlaifSection(text, 'services');
}

/**
 * @param {string} message
 */
function fail(message) {
  const status = document.querySelector('#status');
  if (status) {
    status.textContent = message;
  }
}

globalThis.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(globalThis.location.search);
  const hpc = params.get('host');
  if (!hpc) {
    fail('Connection blocked: missing host query parameter.');
    return;
  }

  // session is accepted for caller compatibility, but currently unused.
  params.get('session');

  let services;
  try {
    services = await loadSlaifServices();
  } catch (e) {
    fail(`Connection blocked: failed to load SLAIF services (${e.message}).`);
    return;
  }

  const referrer = document.referrer;
  if (referrer) {
    let referrerHost;
    try {
      referrerHost = new URL(referrer).hostname;
    } catch (e) {
      fail('Connection blocked: invalid referrer URL.');
      return;
    }

    const normalizedReferrer = normalizeHostLike(referrerHost);
    let trustedService = false;
    for (const [alias, host] of services.entries()) {
      if (normalizedReferrer === normalizeHostLike(alias) ||
          normalizedReferrer === normalizeHostLike(host)) {
        trustedService = true;
        break;
      }
    }

    if (!trustedService) {
      fail(`Connection blocked: referrer '${referrerHost}' is not in SLAIF ` +
          'services [services] section.');
      return;
    }
  }

  const uri = `uri:ssh://;hpc=${encodeURIComponent(hpc)}@invalid`;
  globalThis.location.replace(`${lib.f.getURL('/html/nassh.html')}#${uri}`);
});
