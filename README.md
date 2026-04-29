<div style="text-align: center;">
  <a href="https://www.slaif.si">
    <img src="https://slaif.si/img/logos/SLAIF_logo_ANG_barve.svg" width="400" height="400">
  </a>
</div>

# SLAIF Connect

This is the clean, non-fork direction for **SLAIF Connect**.

The [previous prototype](https://github.com/ulfe-lmi/slaif-connect-nassh-prototype) started inside a fork of Chromium `libapps` / Secure Shell (`nassh`). This starter keeps the same product reasoning but changes the implementation model:

- no permanent `nassh` fork;
- upstream `libapps` will be used only as a pinned build-time dependency;
- the browser extension always speaks SSH over a WebSocket-to-TCP relay;
- SSH credentials stay inside the browser-side SSH client;
- the SLAIF web server may relay encrypted SSH bytes, but it must not terminate SSH or receive passwords, OTPs, passphrases, or private keys;
- only SLAIF-approved HPC aliases are reachable.

The core runtime path is:

```text
SLAIF web page
   ↓ chrome.runtime.sendMessage(...)
SLAIF Connect extension
   ↓ WSS carrying encrypted SSH bytes
SLAIF relay endpoint on the web server
   ↓ TCP
HPC sshd
```

The relay is mandatory in this architecture. That avoids relying on Chrome raw TCP socket permissions for a new extension ID.

## Status

This package is a starter repository skeleton, not a finished extension.

It contains the amended project documents, the converted allowlist/policy shape, and implementation boundaries for:

- external web-page-to-extension launch;
- extension-side HPC policy validation;
- WebSocket relay transport;
- Node-based WebSocket-to-TCP relay;
- SLURM job-id parsing;
- upstream `libapps` vendoring scripts.

The remaining implementation work is wiring the selected upstream `libapps`/`wassh`/`nassh` runtime pieces into `extension/js/session.js`.

## What changed from the old fork

Old prototype:

```text
forked libapps/nassh repository
SLAIF logic patched into nassh_command_instance.js
optional direct TCP or relay behavior
allowlist in nassh/config/SLAIF.conf
```

New direction:

```text
clean SLAIF-owned extension repository
upstream libapps pinned as third_party/libapps
SLAIF logic lives in extension/js/*
mandatory WSS relay
allowlist and host keys live in extension/config/hpc_hosts*.json
```

## Repository layout

```text
extension/
  manifest.json
  html/session.html
  js/background.js
  js/session.js
  js/slaif_policy.js
  js/slaif_relay.js
  js/job_output_parser.js
  config/hpc_hosts.example.json

server/relay/
  relay.js
  allowed_hpc_hosts.example.json
  package.json

scripts/
  init-upstream.sh
  vendor-libapps.sh
  build-extension.sh

docs/
  ARCHITECTURE.md
  SECURITY.md
  UPSTREAM_LINKING.md
  MIGRATION.md
  PROTOTYPE_SNIPPETS.md
```

## Development setup

Initialize the pinned upstream dependency, generate the local vendored copy, and
build the unpacked extension directory:

```bash
git submodule update --init --recursive
npm install
npm run upstream:init
npm run vendor:libapps
npm run build:extension
npm test
```

The generated extension can be inspected at:

```text
build/extension
```

SSH login is still a future milestone. The build currently packages the
extension scaffold and bundled upstream files only; it does not start
OpenSSH/WASM.

For local relay testing:

```bash
cd server/relay
npm install
cp allowed_hpc_hosts.example.json allowed_hpc_hosts.json
SLAIF_RELAY_DEMO=1 npm start
```

For extension testing:

```bash
./scripts/build-extension.sh
```

Then load `build/extension` as an unpacked extension in Chrome.

For the local relay/OpenSSH harness, see `docs/RELAY_E2E_TESTING.md`:

```bash
npm run test:relay
npm run test:relay:e2e
```

The E2E harness uses system OpenSSH and a test sshd container to prove relay byte
forwarding and strict host-key verification. It is a development test only; the
production extension will use browser-side OpenSSH/WASM later.

## Important production rules

1. Do not load executable JavaScript or WASM from the web at runtime. Vendor upstream code at build time.
2. Do not accept arbitrary SSH host/port values from the browser or from the web page.
3. The relay token must map server-side to a fixed, approved HPC alias.
4. The extension must verify the HPC SSH host key or host CA before the user authenticates.
5. The web server may relay SSH bytes, but must not become a server-side SSH client.
6. Remote commands must be template-based, not arbitrary shell sent by the web server.

## Current useful files

Start with these:

- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/UPSTREAM_LINKING.md`
- `extension/config/hpc_hosts.example.json`
- `extension/js/slaif_policy.js`
- `extension/js/slaif_relay.js`
- `server/relay/relay.js`
