<div style="text-align: center;">
  <a href="https://www.slaif.si">
    <img src="https://slaif.si/img/logos/SLAIF_logo_ANG_barve.svg" width="400" height="400">
  </a>
</div>

# SLAIF Connect

SLAIF Connect is a Chrome-compatible extension for launching approved SLAIF/HPC workloads through browser-side SSH. The SSH client runs in the extension, SSH credentials stay between the user's browser-side SSH client and the real HPC SSH server, and the SLAIF web server may act only as a WebSocket-to-TCP relay for encrypted SSH bytes.

The project currently has a locally validated browser-side OpenSSH/WASM relay prototype. It is not production-ready HPC integration yet.

## Why This Exists

SLAIF needs to initiate and track HPC workloads without becoming the user's SSH client or credential holder. Direct Chrome TCP sockets are not a reliable foundation for a new extension identity, so SLAIF Connect uses browser-side SSH over a mandatory WebSocket-to-TCP relay.

The current MVP direction is broader than job submission metadata: normal workloads are selected by signed-policy-approved `payloadId` values, launched through Slurm from the login node, and run on worker nodes allocated by Slurm. The initial workload targets are fast GPU and CPU/memory diagnostics plus an interactive ChatGPT-like GaMS chat payload. Arbitrary command text is not normal mode, and compute worker nodes are not reached by SSH. See [SLAIF_WORKLOAD_MVP.md](SLAIF_WORKLOAD_MVP.md).

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
- signed HPC policy verification and host-key rotation foundations are present;
- real-HPC pilot onboarding tooling and docs are present, but no real HPC target is validated yet;
- fixed-command SLURM job metadata reporting is locally validated through browser-side output parsing and a session-bound API report token;
- the remote launcher contract and a safe local/test reference launcher are present;
- token lifecycle and relay hardening foundations are present for short-lived scoped tokens, replay rejection, relay timeouts, and audit-safe logging;
- Redis-backed durable token storage is available for shared token state and distributed replay prevention;
- audit, metrics, observability, and readiness foundations are present for the API/relay reference stack;
- workload-token and workload runtime protocol foundations are present for outbound Slurm worker communication;
- signed HPC policy payload catalog validation is present for `gpu_diagnostics_v1`, `cpu_memory_diagnostics_v1`, and `gams_chat_v1`;
- maintainer-owned real-HPC test kit docs/scripts are present for manual Vega, Arnes HPC, and NSC discovery before adding site profiles;
- the next product phase is remote launcher payload intent and site-approved Slurm profiles;
- production deployment, real HPC integration, production trust-root operations, and release packaging are still pending.

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
- signed extension-side policy controls approved HPC aliases, SSH host, SSH port, host-key alias, known hosts / host CA, allowed API/relay origins, and fixed remote command template;
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
npm run test:policy
npm run test:jobs
npm run test:remote-launcher
npm run test:tokens
npm run test:workloads
npm run test:deployment
npm run test:observability
```

Redis token-store validation is explicit because it needs `REDIS_URL` or a
disposable Redis container:

```bash
npm run test:redis-token-store
```

Relay auth/security tests:

```bash
npm run test:relay
npm run test:relay-hardening
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
npm run test:browser:signed-policy
npm run test:browser:job-reporting
npm run test:browser:tokens
```

Browser and relay E2E tests require Docker, OpenSSH tooling, and Playwright Chromium. If Docker access fails with `/var/run/docker.sock: permission denied`, see [docs/BROWSER_E2E_TESTING.md](docs/BROWSER_E2E_TESTING.md) for the documented local passwordless-sudo wrapper.

Real-HPC pilot tooling is explicit and manual:

```bash
npm run pilot:collect-host-keys
npm run pilot:verify-host-key
npm run pilot:create-policy
npm run pilot:stack
npm run test:pilot
npm run test:maintainer-hpc
```

`ssh-keyscan` output is candidate data only. Do not sign a real-HPC pilot policy until the host key or host CA has been independently verified.
Maintainer-owned Vega/Arnes/NSC discovery and diagnostic commands live in
[docs/MAINTAINER_HPC_TESTING.md](docs/MAINTAINER_HPC_TESTING.md) and
[maintainer/hpc-test-kit/README.md](maintainer/hpc-test-kit/README.md). Those
manual tests require real accounts and verified known-host data and are not run
by CI.

## Important Docs

- [STATUS.md](STATUS.md): current progress, validation evidence, limitations, and roadmap.
- [SLAIF_WORKLOAD_MVP.md](SLAIF_WORKLOAD_MVP.md): current workload MVP direction, payload IDs, GaMS chat, worker outbound protocol, and deferred YOLO mode.
- [AGENTS.md](AGENTS.md): operational rules for coding agents.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): relay-only target architecture.
- [docs/SECURITY.md](docs/SECURITY.md): security model and boundaries.
- [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md): practical threat table.
- [docs/UPSTREAM_LINKING.md](docs/UPSTREAM_LINKING.md): upstream `libapps` vendoring model.
- [docs/HPC_POLICY.md](docs/HPC_POLICY.md): signed HPC policy format and tools.
- [docs/PAYLOAD_CATALOG.md](docs/PAYLOAD_CATALOG.md): signed-policy allowed payload catalog and host-level payload restrictions.
- [docs/MAINTAINER_HPC_TESTING.md](docs/MAINTAINER_HPC_TESTING.md): maintainer-owned real-HPC discovery, host-key verification, diagnostics, and result bundle flow.
- [docs/HOST_KEY_ROTATION.md](docs/HOST_KEY_ROTATION.md): host-key and host-CA rotation foundation.
- [docs/REAL_HPC_PILOT.md](docs/REAL_HPC_PILOT.md): manual real-HPC pilot onboarding flow.
- [docs/JOB_REPORTING.md](docs/JOB_REPORTING.md): fixed-command scheduler metadata reporting.
- [docs/REMOTE_LAUNCHER_CONTRACT.md](docs/REMOTE_LAUNCHER_CONTRACT.md): HPC-side launcher CLI, output, and deployment contract.
- [docs/WORKLOAD_RUNTIME_PROTOCOL.md](docs/WORKLOAD_RUNTIME_PROTOCOL.md): `slaif.workload` token binding and worker hello/prompt/response/stop protocol validators.
- [docs/TOKEN_LIFECYCLE.md](docs/TOKEN_LIFECYCLE.md): launch, relay, job-report, and workload token scope, expiry, replay, and logging rules.
- [docs/RELAY_HARDENING.md](docs/RELAY_HARDENING.md): relay timeout, allowlist, token, and audit controls.
- [docs/PRODUCTION_DEPLOYMENT_CONTRACT.md](docs/PRODUCTION_DEPLOYMENT_CONTRACT.md): API/relay deployment contract, durable token-store requirements, readiness, and unsafe-config rejection.
- [docs/PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md): production readiness checklist.
- [docs/OBSERVABILITY.md](docs/OBSERVABILITY.md): audit event schema, metrics model, readiness integration, and production observability rules.
- [docs/RELAY_E2E_TESTING.md](docs/RELAY_E2E_TESTING.md): local system-SSH relay tests.
- [docs/BROWSER_E2E_TESTING.md](docs/BROWSER_E2E_TESTING.md): Playwright/Chromium extension tests.
- [docs/BROWSER_WASSH_RELAY_PROTOTYPE.md](docs/BROWSER_WASSH_RELAY_PROTOTYPE.md): local browser prototype instructions.
- [docs/WASSH_INTEGRATION.md](docs/WASSH_INTEGRATION.md): OpenSSH/WASM integration notes.
- [docs/SESSION_LAUNCH_PROTOCOL.md](docs/SESSION_LAUNCH_PROTOCOL.md): external web launch and session descriptor protocol.

## Production Readiness

SLAIF Connect is not production-ready yet. Local validation now covers real SSH traffic through the relay, browser-side OpenSSH/WASM startup, strict host-key negative cases, and the product-shaped web launch/session descriptor flow. That is still not the same as deployment against real HPC infrastructure.

The next major product milestone is the normal payload-driven workload path described in [SLAIF_WORKLOAD_MVP.md](SLAIF_WORKLOAD_MVP.md): remote launcher payload intent, fast diagnostics, structured results, and the workload registry/broker. Real HPC pilots still require independently verified host-key or host-CA data and a site-approved installed launcher command. Production SLAIF trust roots, Redis/secret/audit/metrics operations, authentication UX, API/relay deployment, and release packaging remain pending.
