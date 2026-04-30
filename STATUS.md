# SLAIF Connect Status

SLAIF Connect is now a clean, no-fork, relay-only Chrome-compatible extension project. It is no longer just a starter skeleton, but it is still not production-ready.

The current main branch has locally validated browser-side OpenSSH/WASM over a WebSocket-to-TCP relay. The relay does not terminate SSH, and SSH remains end-to-end between browser-side OpenSSH/WASM and `sshd` in the local test harness. The project intentionally avoids a long-lived `nassh` / `libapps` fork by using pinned upstream Chromium `libapps` as a build-time dependency.

## Current Architecture

```text
SLAIF web app
  -> Chrome extension external launch message
  -> extension session page
  -> browser-side OpenSSH/WASM from bundled upstream libapps/wassh/nassh pieces
  -> WebSocket-to-TCP relay
  -> TCP to approved HPC/test sshd
  -> fixed remote command / job launcher
```

Core rule:

```text
The SLAIF server may relay encrypted SSH bytes, but it must not receive SSH
passwords, OTPs, private keys, decrypted terminal data, or arbitrary user shell
access.
```

## Completed Milestones

### 1. Clean non-fork repository baseline

The repository was reset around a SLAIF-owned extension, relay, scripts, tests, and docs structure instead of a long-lived `nassh` fork.

Main files and docs:

- [README.md](README.md)
- [AGENTS.md](AGENTS.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/SECURITY.md](docs/SECURITY.md)
- [docs/MIGRATION.md](docs/MIGRATION.md)

Validation:

```bash
npm test
```

### 2. Upstream Chromium libapps pinned as a build-time dependency

Upstream Chromium `libapps` is present as an untouched submodule under `third_party/libapps`.

Main files and docs:

- [.gitmodules](.gitmodules)
- [UPSTREAM_LIBAPPS_URL](UPSTREAM_LIBAPPS_URL)
- [UPSTREAM_LIBAPPS_COMMIT](UPSTREAM_LIBAPPS_COMMIT)
- [docs/UPSTREAM_LINKING.md](docs/UPSTREAM_LINKING.md)
- [third_party/libapps](third_party/libapps)

Current pinned commit:

```text
2a7d9a1e50c05e42c7a01bb053f09fc950414a7d
```

Validation:

```bash
git submodule update --init --recursive
npm run upstream:init
```

### 3. Generated vendoring/build flow

The repo can generate extension-local upstream runtime copies and build an unpacked extension directory without committing generated output.

Main files and docs:

- [scripts/vendor-libapps.sh](scripts/vendor-libapps.sh)
- [scripts/build-extension.sh](scripts/build-extension.sh)
- [scripts/check-vendor.mjs](scripts/check-vendor.mjs)
- [docs/UPSTREAM_LINKING.md](docs/UPSTREAM_LINKING.md)

Validation:

```bash
npm run vendor:libapps
npm run build:extension
npm run check:vendor
```

### 4. WebSocket-to-TCP relay skeleton and allowlist model

The relay requires a JSON auth message first, maps tokens to server-side aliases, looks up fixed host/port targets, and bridges WebSocket binary frames to TCP.

Main files and docs:

- [server/relay/relay.js](server/relay/relay.js)
- [server/relay/allowed_hpc_hosts.example.json](server/relay/allowed_hpc_hosts.example.json)
- [extension/js/slaif_relay.js](extension/js/slaif_relay.js)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/SECURITY.md](docs/SECURITY.md)

Validation:

```bash
npm run test:relay
```

### 5. Local system-SSH relay E2E test harness

The local harness proves real system OpenSSH traffic can cross the WebSocket-to-TCP relay without the relay terminating SSH.

Main files and docs:

- [tools/ws-tcp-bridge.js](tools/ws-tcp-bridge.js)
- [tests/relay/e2e-relay-ssh.mjs](tests/relay/e2e-relay-ssh.mjs)
- [tests/relay/sshd/Dockerfile](tests/relay/sshd/Dockerfile)
- [tests/relay/sshd/entrypoint.sh](tests/relay/sshd/entrypoint.sh)
- [docs/RELAY_E2E_TESTING.md](docs/RELAY_E2E_TESTING.md)

Validation:

```bash
npm run test:relay:e2e
```

### 6. Strict host-key negative test for relay reroute/fake SSH scenarios

The relay E2E harness includes a wrong-host-key case using strict OpenSSH host-key checking. It is local proof that a fake or rerouted SSH server is rejected when the expected host key does not match.

Main files and docs:

- [tests/relay/e2e-relay-ssh.mjs](tests/relay/e2e-relay-ssh.mjs)
- [docs/RELAY_E2E_TESTING.md](docs/RELAY_E2E_TESTING.md)
- [docs/SECURITY.md](docs/SECURITY.md)

Validation:

```bash
npm run test:relay:e2e
```

### 7. Browser-side OpenSSH/WASM plugin install/verification

The project can install and verify generated OpenSSH/WASM plugin artifacts for the extension build.

Main files and docs:

- [scripts/install-plugin.sh](scripts/install-plugin.sh)
- [scripts/verify-plugin.js](scripts/verify-plugin.js)
- [docs/WASSH_INTEGRATION.md](docs/WASSH_INTEGRATION.md)

Validation:

```bash
npm run plugin:install
npm run plugin:verify
```

### 8. Browser-side OpenSSH/WASM relay prototype

The extension contains a SLAIF-owned adapter that starts browser-side OpenSSH/WASM from bundled upstream pieces and connects it through the SLAIF relay adapter.

Main files and docs:

- [extension/js/slaif_ssh_client.js](extension/js/slaif_ssh_client.js)
- [extension/js/slaif_relay.js](extension/js/slaif_relay.js)
- [extension/js/session.js](extension/js/session.js)
- [tools/start-extension-dev-stack.mjs](tools/start-extension-dev-stack.mjs)
- [docs/BROWSER_WASSH_RELAY_PROTOTYPE.md](docs/BROWSER_WASSH_RELAY_PROTOTYPE.md)
- [docs/WASSH_INTEGRATION.md](docs/WASSH_INTEGRATION.md)

Validation:

```bash
npm run build:extension
npm run test:browser
```

### 9. Playwright/Chromium browser E2E validation

The browser E2E suite loads the built MV3 extension in Chromium, starts a local test sshd container and relay stack, and requires real remote command output from the extension page.

Main files and docs:

- [playwright.config.mjs](playwright.config.mjs)
- [tests/browser/extension-relay-smoke.spec.mjs](tests/browser/extension-relay-smoke.spec.mjs)
- [tests/browser/fixtures/extensionContext.mjs](tests/browser/fixtures/extensionContext.mjs)
- [tests/browser/helpers/devStack.mjs](tests/browser/helpers/devStack.mjs)
- [tests/browser/helpers/extensionPage.mjs](tests/browser/helpers/extensionPage.mjs)
- [docs/BROWSER_E2E_TESTING.md](docs/BROWSER_E2E_TESTING.md)

Validation:

```bash
npm run browser:install
npm run test:browser
```

### 10. Browser-side host-key negative validation

The browser E2E suite includes a changed/wrong host-key case and verifies that the expected command output is not observed.

Main files and docs:

- [tests/browser/extension-relay-smoke.spec.mjs](tests/browser/extension-relay-smoke.spec.mjs)
- [docs/BROWSER_E2E_TESTING.md](docs/BROWSER_E2E_TESTING.md)

Validation:

```bash
npm run test:browser:hostkey-negative
```

### 11. Production-style web launch/session descriptor flow

The current main branch includes the product-shaped launch boundary: approved web origin sends `slaif.startSession`, the service worker validates and stores a pending launch, the session page fetches a server-issued descriptor, descriptor fields are validated, and browser-side OpenSSH/WASM starts only after validation.

Main files and docs:

- [extension/js/background.js](extension/js/background.js)
- [extension/js/session.js](extension/js/session.js)
- [extension/js/slaif_session_descriptor.js](extension/js/slaif_session_descriptor.js)
- [tests/session_descriptor.test.mjs](tests/session_descriptor.test.mjs)
- [tests/browser/extension-launch-flow.spec.mjs](tests/browser/extension-launch-flow.spec.mjs)
- [docs/SESSION_LAUNCH_PROTOCOL.md](docs/SESSION_LAUNCH_PROTOCOL.md)

Validation:

```bash
npm run test:browser:launch-flow
npm test
```

### 12. Signed HPC policy verification and rotation foundation

The extension can verify signed HPC policy envelopes with bundled trust roots. Signed policy is now the authority for SSH host, port, host-key alias, known hosts / host CA, allowed API/relay origins, and fixed command templates.

Main files and docs:

- [extension/js/slaif_policy_signature.js](extension/js/slaif_policy_signature.js)
- [extension/js/slaif_policy.js](extension/js/slaif_policy.js)
- [scripts/policy/](scripts/policy)
- [tests/policy/](tests/policy)
- [tests/browser/extension-signed-policy.spec.mjs](tests/browser/extension-signed-policy.spec.mjs)
- [docs/HPC_POLICY.md](docs/HPC_POLICY.md)
- [docs/HOST_KEY_ROTATION.md](docs/HOST_KEY_ROTATION.md)

Validation:

```bash
npm run policy:verify
npm run test:policy
npm run test:browser:signed-policy
```

### 13. Real-HPC pilot onboarding support

The repository now includes a manual pilot path for preparing a signed policy for one real HPC target, collecting candidate host keys, verifying operator-provided fingerprints, and running a local mock SLAIF web/API plus relay stack that connects only to the signed-policy host and port.

Main files and docs:

- [docs/REAL_HPC_PILOT.md](docs/REAL_HPC_PILOT.md)
- [config/pilot/](config/pilot)
- [scripts/pilot/](scripts/pilot)
- [tools/start-real-hpc-pilot-stack.mjs](tools/start-real-hpc-pilot-stack.mjs)
- [tests/pilot/](tests/pilot)

Validation:

```bash
npm run test:pilot
```

This is onboarding support only. No real HPC host has been validated in this repository, and no real credentials or unverified host keys should be committed.

## What Is Validated

| Capability | Status | Evidence / command |
| --- | --- | --- |
| Relay forwards real SSH bytes | Working locally | `npm run test:relay:e2e` |
| Strict host-key failure blocks fake/rerouted SSH | Working locally | relay and browser host-key negative tests |
| Browser-side OpenSSH/WASM starts | Working locally | `npm run test:browser` |
| Browser observes real remote command output | Working locally | expected output: `slaif-browser-relay-ok` |
| Web launch/session descriptor flow | Working locally | `npm run test:browser:launch-flow` |
| Malicious launch fields are rejected | Working locally | `tests/session_descriptor.test.mjs`, browser launch-flow test |
| Malicious descriptor SSH-target fields are rejected | Working locally | `tests/session_descriptor.test.mjs` |
| Signed HPC policy verification | Working locally | `npm run policy:verify`, `npm run test:policy` |
| Tampered/wrong-signer/expired policy rejection | Working locally | policy unit tests and signed-policy browser tests |
| Relay origin constrained by signed policy | Working locally | signed-policy browser tests |
| Real-HPC pilot onboarding tooling | Scaffolded | `npm run test:pilot`; manual real-HPC run requires verified host data |
| Production HPC integration | Pending | not yet validated against real HPC |
| Production signed policy operations | Pending | real trust root and operational signing process not deployed |
| Production host-key rotation | Pending | foundation exists; real HPC rotation process not deployed |
| Production credential UX | Pending | browser E2E currently uses a disposable local-only dev password |
| Chrome Web Store packaging/release | Pending | no release workflow yet |

## Security Invariants

These rules are non-negotiable unless the project owner explicitly changes the architecture:

- no direct TCP from the Chrome extension;
- no `chrome.sockets` permission;
- no server-side SSH client;
- no long-lived `nassh` fork;
- no runtime remote JS/WASM loading;
- upstream `libapps` is pinned and bundled at build time;
- files under `third_party/libapps` are upstream-owned and must stay untouched;
- the relay must not accept arbitrary client-supplied host/port;
- signed extension-side policy is authoritative for SSH host, port, host-key alias, known hosts / host CA, allowed API/relay origins, and command template;
- host-key verification must happen before user authentication;
- changed host keys must not be accepted silently;
- no production trust-on-first-use unless explicitly approved later;
- no arbitrary web-supplied shell commands;
- no launch-token, relay-token, password, OTP, private-key, or raw SSH payload logging;
- no SSH agent forwarding;
- no X11 forwarding;
- no local, remote, or dynamic port forwarding unless explicitly justified later.

## Current Known Limitations

- SLAIF Connect is not production-ready.
- Real HPC hosts are not integrated or validated yet; pilot tooling exists for an operator-supplied verified host key or host CA.
- Signed policy verification exists, but production trust-root operations are not deployed.
- Production host-key rotation and emergency revocation procedures are documented as foundations, not operated against real HPC yet.
- Browser E2E uses a disposable local-only password for the test sshd container; this is not production credential storage.
- Chrome Web Store packaging and release workflow are not implemented.
- User-facing UX is still prototype-level.
- Job submission, job-id reporting, and result reporting are not production-integrated.
- Relay deployment hardening, observability, audit logging, rate limiting, and token lifecycle controls remain production work.
- The current browser prototype includes deterministic generated compatibility files for pinned upstream modules; a later build-system pass may replace these with a fuller upstream build flow.

## Next Milestones

1. Documentation/status refresh. This PR.
2. Real HPC pilot target with independently verified pinned host key or host CA.
3. Real SLAIF policy signing operations and production trust-root handling.
4. Production authentication UX.
5. Fixed SLAIF remote launcher and SLURM job-id reporting integration.
6. Relay deployment hardening.
7. Chrome extension packaging and release workflow.
8. Security review.

The production-style web launch/session descriptor flow is already present on `main`.

## PR History / Development Timeline

Merged PRs visible from GitHub at the time of this update:

| PR | Merged | Summary |
| --- | --- | --- |
| [#1 Bootstrap relay-only SLAIF Connect starter](https://github.com/ulfe-lmi/slaif-connect/pull/1) | 2026-04-29 | Established the no-fork relay-only baseline, starter docs, extension shell, relay skeleton, and policy examples. |
| [#2 Add pinned upstream libapps vendoring flow](https://github.com/ulfe-lmi/slaif-connect/pull/2) | 2026-04-29 | Added upstream Chromium `libapps` as a pinned submodule and implemented generated vendoring/build flow. |
| [#3 Add relay SSH end-to-end test harness](https://github.com/ulfe-lmi/slaif-connect/pull/3) | 2026-04-29 | Added system OpenSSH, dev TCP-to-WebSocket bridge, relay, and test sshd E2E coverage. |
| [#4 Fix relay SSH E2E harness execution](https://github.com/ulfe-lmi/slaif-connect/pull/4) | 2026-04-29 | Fixed Docker/OpenSSH relay harness execution issues after initial E2E work. |
| [#5 Wire browser-side OpenSSH WASM relay prototype](https://github.com/ulfe-lmi/slaif-connect/pull/5) | 2026-04-30 | Added the first browser-side OpenSSH/WASM relay prototype and local extension dev stack. |
| [#6 Add browser E2E validation for WASM relay prototype](https://github.com/ulfe-lmi/slaif-connect/pull/6) | 2026-04-30 | Added Playwright/Chromium validation for real browser-side remote command output and browser host-key negative coverage. |
| [#7 Add SLAIF web launch session flow](https://github.com/ulfe-lmi/slaif-connect/pull/7) | 2026-04-30 | Added external web launch validation, session descriptor validation, mock SLAIF launcher/API, and browser E2E coverage for the product-shaped flow. |
| [#8 Update README and project status documentation](https://github.com/ulfe-lmi/slaif-connect/pull/8) | 2026-04-30 | Rewrote the project README and added this status/roadmap document. |
| [#9 Add signed HPC policy verification](https://github.com/ulfe-lmi/slaif-connect/pull/9) | 2026-04-30 | Added signed policy verification, policy tooling, rollback foundations, signed local-dev policy, and signed-policy browser validation. |

## How To Read The Repository

- [README.md](README.md): public project overview and getting started.
- [STATUS.md](STATUS.md): current progress, validation evidence, limitations, and roadmap.
- [AGENTS.md](AGENTS.md): operational rules for coding agents.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): relay-only architecture.
- [docs/SECURITY.md](docs/SECURITY.md): security model and boundaries.
- [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md): threat table.
- [docs/HPC_POLICY.md](docs/HPC_POLICY.md): signed HPC policy format and tooling.
- [docs/HOST_KEY_ROTATION.md](docs/HOST_KEY_ROTATION.md): host-key and host-CA rotation foundation.
- [docs/REAL_HPC_PILOT.md](docs/REAL_HPC_PILOT.md): manual real-HPC pilot onboarding.
- [docs/UPSTREAM_LINKING.md](docs/UPSTREAM_LINKING.md): upstream `libapps` vendoring.
- [docs/RELAY_E2E_TESTING.md](docs/RELAY_E2E_TESTING.md): system SSH relay tests.
- [docs/BROWSER_E2E_TESTING.md](docs/BROWSER_E2E_TESTING.md): browser E2E tests.
- [docs/WASSH_INTEGRATION.md](docs/WASSH_INTEGRATION.md): OpenSSH/WASM integration notes.
- [docs/SESSION_LAUNCH_PROTOCOL.md](docs/SESSION_LAUNCH_PROTOCOL.md): web launch/session descriptor protocol.
