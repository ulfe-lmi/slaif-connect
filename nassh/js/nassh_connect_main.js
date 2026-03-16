// Copyright 2026 The ChromiumOS Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import {lib} from '../../libdot/index.js';

import {punycode} from './deps_punycode.rollup.js';
import {loadSlaifSection} from './nassh_slaif_config.js';

/**
 * @param {string} value
 * @return {string}
 */
function normalizeHostLike(value) {
  return punycode.toASCII(value).toLowerCase().replace(/\.$/, '');
}

/**
 * @return {!Promise<!Map<string, string>>}
 */
async function loadSlaifServices() {
  return loadSlaifSection('services');
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
