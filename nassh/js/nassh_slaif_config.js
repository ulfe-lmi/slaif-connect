// Copyright 2026 The ChromiumOS Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import {lib} from '../../libdot/index.js';

export const SLAIF_CONFIG_PATH = '/config/SLAIF.conf';

/**
 * @param {string} text
 * @param {string} sectionName
 * @return {!Map<string, string>}
 */
export function parseSlaifSection(text, sectionName) {
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
      inSection = section[1].trim().toLowerCase() === sectionName.toLowerCase();
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
 * @param {string} sectionName
 * @return {!Promise<!Map<string, string>>}
 */
export async function loadSlaifSection(sectionName) {
  const response = await fetch(lib.f.getURL(SLAIF_CONFIG_PATH));
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = await response.text();
  return parseSlaifSection(text, sectionName);
}

/**
 * @typedef {{
 *   productName: string,
 *   faqUrl: string,
 *   changelogUrl: string,
 *   popupTitle: string,
 *   showReleaseHighlights: boolean,
 *   showTipOfDay: boolean,
 * }}
 */
export let SlaifBranding;

/**
 * @typedef {{
 *   logoAnsiPath: string,
 * }}
 */
export let SlaifAssets;

/** @const {!SlaifBranding} */
const DEFAULT_BRANDING = {
  productName: 'SLAIF-connect',
  faqUrl: 'https://hterm.org/x/ssh/faq',
  changelogUrl: '/html/changelog.html',
  popupTitle: 'SLAIF-connect Extension Popup',
  showReleaseHighlights: true,
  showTipOfDay: true,
};

/** @const {!SlaifAssets} */
const DEFAULT_ASSETS = {
  logoAnsiPath: '/config/slaif_logo_ansi.txt',
};

/**
 * @param {string|undefined} value
 * @param {boolean} fallback
 * @return {boolean}
 */
function parseBoolean(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  switch (value.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true;
    case '0':
    case 'false':
    case 'no':
    case 'off':
      return false;
    default:
      return fallback;
  }
}

/**
 * @return {!Promise<!SlaifBranding>}
 */
export async function loadSlaifBranding() {
  const entries = await loadSlaifSection('branding');
  return {
    productName: entries.get('product_name') || DEFAULT_BRANDING.productName,
    faqUrl: entries.get('faq_url') || DEFAULT_BRANDING.faqUrl,
    changelogUrl: entries.get('changelog_url') || DEFAULT_BRANDING.changelogUrl,
    popupTitle: entries.get('popup_title') || DEFAULT_BRANDING.popupTitle,
    showReleaseHighlights: parseBoolean(entries.get('show_release_highlights'),
                                        DEFAULT_BRANDING.showReleaseHighlights),
    showTipOfDay: parseBoolean(entries.get('show_tip_of_day'),
                               DEFAULT_BRANDING.showTipOfDay),
  };
}

/**
 * @return {!Promise<!SlaifAssets>}
 */
export async function loadSlaifAssets() {
  const entries = await loadSlaifSection('assets');
  return {
    logoAnsiPath: entries.get('logo_ansi_path') || DEFAULT_ASSETS.logoAnsiPath,
  };
}
