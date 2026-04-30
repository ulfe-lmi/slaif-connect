# SLAIF Connect

SLAIF Connect is a Chrome-compatible extension for launching approved SLAIF/HPC workflows through browser-side SSH. The SSH client runs in the extension, SSH credentials stay between the user's browser-side SSH client and the real HPC SSH server, and the SLAIF web server may act only as a WebSocket-to-TCP relay for encrypted SSH bytes.

The project currently has a locally validated browser-side OpenSSH/WASM relay prototype. It is not production-ready HPC integration yet.

## Why This Exists

SLAIF needs to initiate and track HPC workloads without becoming the user's SSH client or credential holder. Direct Chrome TCP sockets are not a reliable foundation for a new extension identity, so SLAIF Connect uses browser-side SSH over a mandatory WebSocket-to-TCP relay.

The project also avoids maintaining a long-lived fork of Chromium Secure Shell / `nassh`. Upstream Chromium `libapps` is pinned as a build-time dependency, selected runtime pieces are generated into the extension package, and SLAIF-specific behavior lives in this repository's own extension, relay, tooling, and tests.

## Current Status

See [STATUS.md](STATUS.md) for the detailed current state, completed milestones, validation evidence, known limitations, and roadmap.

Short version:

- the no-fork, relay-only architecture is established;
- upstream Chromium `libapps` is pinned at a known commit;
- vendoring, plugin installation, and unpacked-extension build flows exist;
- the WebSocket-to-TCP relay has local system-SSH E2E coverage;
- browser-side OpenSSH/WASM through the relay is validated locally with Playwright/Chromium;
- the product-shaped SLAIF web launch and session descriptor flow is validated locally;
- production deployment, real HPC integration, signed host policy, and release packaging are still pending.

## Architecture

```text
SLAIF web app
    |
    | chrome.runtime.sendMessage(...)
    v
SLAIF Connect extension
    |
    | browser-side OpenSSH/WASM
    | WSS carrying encrypted SSH bytes
    v
SLAIF relay endpoint
    |
    | TCP
    v
HPC sshd
```

The extension is the SSH client. The relay is a byte forwarder. The HPC login node is the SSH server.

The relay does not terminate SSH, does not ask for SSH credentials, and must not receive passwords, OTPs, private keys, passphrases, decrypted terminal output, or arbitrary user shell access.

## Security Model

Key rules:

- the relay does not terminate SSH;
- the extension verifies the HPC host key or host CA before user authentication;
- extension-side policy controls approved HPC aliases, SSH host, SSH port, host-key alias, known hosts / host CA, and fixed remote command template;
- the SLAIF web page cannot provide arbitrary SSH target details or arbitrary shell commands;
- session descriptors can provide relay connection data, but cannot override SSH host identity or command policy;
- there is no server-side SSH client;
- there is no direct TCP dependency or `chrome.sockets` permission;
- executable JavaScript and WebAssembly are bundled into the extension package, not loaded remotely at runtime.

For details, read [docs/SECURITY.md](docs/SECURITY.md) and [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## Repository Layout

```text
extension/             MV3 extension shell, session UI, policy, relay, SSH client adapter
server/relay/          Node WebSocket-to-TCP relay skeleton and allowlist model
tools/                 development-only relay/browser stack helpers
tests/                 unit, relay, Docker/OpenSSH, and Playwright browser tests
docs/                  architecture, security, integration, and testing documents
scripts/               upstream init, vendoring, plugin, build, and validation scripts
third_party/libapps/   pinned upstream Chromium libapps submodule, untouched
```

Generated output is intentionally ignored by git:

```text
extension/vendor/
extension/plugin/
extension/wassh/
extension/wasi-js-bindings/
build/
dist/
```

## Development Setup

```bash
git submodule update --init --recursive
npm install
npm run upstream:init
npm run vendor:libapps
npm run plugin:install
npm run plugin:verify
npm run build:extension
npm test
```

The unpacked extension build is generated at:

```text
build/extension
```

All executable JS/WASM used by the extension must be bundled into that package. Do not load remote executable code at runtime.

## Test Commands

Lightweight checks and unit tests:

```bash
npm test
```

Relay auth/security tests:

```bash
npm run test:relay
```

Docker/OpenSSH relay E2E test:

```bash
npm run test:relay:e2e
```

Browser E2E setup and tests:

```bash
npm run browser:install
npm run test:browser
npm run test:browser:launch-flow
npm run test:browser:hostkey-negative
```

Browser and relay E2E tests require Docker, OpenSSH tooling, and Playwright Chromium. If Docker access fails with `/var/run/docker.sock: permission denied`, see [docs/BROWSER_E2E_TESTING.md](docs/BROWSER_E2E_TESTING.md) for the documented local passwordless-sudo wrapper.

## Important Docs

- [STATUS.md](STATUS.md): current progress, validation evidence, limitations, and roadmap.
- [AGENTS.md](AGENTS.md): operational rules for coding agents.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): relay-only target architecture.
- [docs/SECURITY.md](docs/SECURITY.md): security model and boundaries.
- [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md): practical threat table.
- [docs/UPSTREAM_LINKING.md](docs/UPSTREAM_LINKING.md): upstream `libapps` vendoring model.
- [docs/RELAY_E2E_TESTING.md](docs/RELAY_E2E_TESTING.md): local system-SSH relay tests.
- [docs/BROWSER_E2E_TESTING.md](docs/BROWSER_E2E_TESTING.md): Playwright/Chromium extension tests.
- [docs/BROWSER_WASSH_RELAY_PROTOTYPE.md](docs/BROWSER_WASSH_RELAY_PROTOTYPE.md): local browser prototype instructions.
- [docs/WASSH_INTEGRATION.md](docs/WASSH_INTEGRATION.md): OpenSSH/WASM integration notes.
- [docs/SESSION_LAUNCH_PROTOCOL.md](docs/SESSION_LAUNCH_PROTOCOL.md): external web launch and session descriptor protocol.

## Production Readiness

SLAIF Connect is not production-ready yet. Local validation now covers real SSH traffic through the relay, browser-side OpenSSH/WASM startup, strict host-key negative cases, and the product-shaped web launch/session descriptor flow. That is still not the same as deployment against real HPC infrastructure.

The next major security milestone is signed HPC policy and host-key or host-CA trust/rotation, followed by a real HPC pilot target, production authentication UX, relay hardening, and release packaging.
