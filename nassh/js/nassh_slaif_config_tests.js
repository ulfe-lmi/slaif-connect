// Copyright 2026 The ChromiumOS Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import {
  loadSlaifAssets,
  loadSlaifBranding,
  parseSlaifSection,
} from './nassh_slaif_config.js';

describe('parseSlaifSection', () => {
  it('reads only requested section', () => {
    const text = `
[allowlist]
a=b

[branding]
product_name=Runtime Name
show_tip_of_day=false
`;
    const entries = parseSlaifSection(text, 'branding');
    assert.equal('Runtime Name', entries.get('product_name'));
    assert.equal('false', entries.get('show_tip_of_day'));
    assert.isFalse(entries.has('a'));
  });
});

describe('loadSlaifBranding', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('applies branding section values', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      text: async () => `
[branding]
product_name=Test Product
faq_url=https://example.test/faq
changelog_url=https://example.test/changelog
popup_title=Popup Name
show_release_highlights=no
show_tip_of_day=0
`,
    });

    const branding = await loadSlaifBranding();
    assert.equal('Test Product', branding.productName);
    assert.equal('https://example.test/faq', branding.faqUrl);
    assert.equal('https://example.test/changelog', branding.changelogUrl);
    assert.equal('Popup Name', branding.popupTitle);
    assert.isFalse(branding.showReleaseHighlights);
    assert.isFalse(branding.showTipOfDay);
  });
});


describe('loadSlaifAssets', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('applies assets section values', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      text: async () => `
[assets]
logo_ansi_path=/config/custom_logo.txt
`,
    });

    const assets = await loadSlaifAssets();
    assert.equal('/config/custom_logo.txt', assets.logoAnsiPath);
  });
});
