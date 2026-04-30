# Browser E2E Testing

The browser E2E test validates the current development-only browser OpenSSH/WASM relay prototype.

It proves this local path:

```text
Chromium extension session page
  -> bundled OpenSSH/WASM from pinned libapps
  -> SLAIF WebSocket-to-TCP relay
  -> TCP from relay to test sshd container
  -> test sshd
```

The relay remains a byte-forwarder. It does not terminate SSH, ask for SSH credentials, parse authentication messages, or inspect decrypted terminal output.

## What Success Means

The Playwright test loads `build/extension` as an unpacked MV3 extension in Chromium, starts the local dev relay stack, opens `html/session.html?dev=1`, enters the throwaway local test password into the extension page, and requires real remote command output such as:

```text
Submitted batch job 424242
```

Seeing the page load, plugin verification pass, or the relay connect is not enough. The test must observe the fixed command output produced by the sshd container.

The web-launch E2E test additionally opens a mock SLAIF launcher page from
`http://127.0.0.1`, sends `chrome.runtime.sendMessage(extensionId, {
type: "slaif.startSession", ... })`, verifies the service worker accepts the
external launch, fetches a server-issued session descriptor, and then observes
the same real remote command output through browser-side OpenSSH/WASM.

## Signed Policy and Host-Key Verification

The dev stack generates a temporary ECDSA P-256 policy signing key, writes a
local trust root into `build/extension/config/policy_trust_roots.local.json`,
and writes a signed local HPC policy into
`build/extension/config/hpc_policy.local.json`.

The generated signed policy contains the `test-sshd` SSH host, port,
`HostKeyAlias`, `known_hosts` entry, allowed mock API origin, allowed relay
origin, and fixed command template. The unsigned runtime config carries launch
and relay tokens only.

The browser test also includes a negative case with an intentionally wrong known_hosts entry. That test expects OpenSSH/WASM to fail host-key verification and verifies that the fixed command output is not observed.

The signed-policy browser tests also reject tampered policy, wrong signer,
expired policy, and relay-origin mismatch before SSH starts.

The browser job-reporting test also verifies that the extension parses the
SLURM job ID from real remote output and that the mock SLAIF API receives one
safe metadata report. That report must not include stdout, stderr, terminal
transcript, tokens, passwords, OTPs, or private keys.

## Commands

```bash
npm run browser:install
npm run test:browser
npm run test:browser:headed
npm run test:browser:debug
npm run test:browser:hostkey-negative
npm run test:browser:launch-flow
npm run test:browser:signed-policy
npm run test:browser:job-reporting
```

The job-reporting browser test uses the generated signed local-dev policy to run the reference remote launcher mounted into the test sshd container. Success requires both real browser-side SSH output and a received metadata report at the mock SLAIF API.

`npm test` intentionally does not require Playwright or Chromium. Browser validation is explicit because it needs Chromium, Docker, and the generated extension build.

Real-HPC pilot testing is intentionally separate from the automated browser suite. Use [REAL_HPC_PILOT.md](REAL_HPC_PILOT.md) with operator-verified host-key or host-CA data. Do not make real-HPC access mandatory for `npm test` or `npm run test:browser`.

The Playwright config runs extension tests with one worker because the unpacked
extension directory is shared generated state and each dev stack writes
`build/extension/config/dev_runtime.local.json`.

Before running the browser test, build the extension:

```bash
npm install
npm run upstream:init
npm run vendor:libapps
npm run plugin:install
npm run plugin:verify
npm run build:extension
```

## Docker Access

The browser test starts the same disposable sshd container used by the local dev stack. The current host may require passwordless sudo for Docker. If direct Docker access fails with `/var/run/docker.sock: permission denied`, this local workaround can be used:

```bash
tmpbin="$(mktemp -d)"
printf '%s\n' '#!/bin/sh' 'exec sudo -n /usr/bin/docker "$@"' > "$tmpbin/docker"
chmod +x "$tmpbin/docker"
PATH="$tmpbin:$PATH" npm run test:browser
rm -rf "$tmpbin"
```

Do not hide Docker failures. If Docker or passwordless sudo is unavailable, report the exact prerequisite failure.

## Chromium Availability

Install Playwright Chromium with:

```bash
npm run browser:install
```

If Chromium cannot be installed or launched, keep the test code intact and report the exact install or launch error. Do not mark browser validation successful without observing the real remote command output in Chromium.

## Prototype Boundaries

The browser E2E uses a disposable local-only password for the test sshd container. That password is entered into the browser-side OpenSSH/WASM prompt. It is not sent in relay auth JSON and is not handled by the SLAIF relay server.

This is not production credential storage and must not become one. Production SLAIF Connect still needs approved session descriptors, real HPC host-key or host-CA policy, short-lived relay tokens, and no server-side SSH client.

The local mock SLAIF API returns only relay connection data. It does not return
SSH host, SSH port, known_hosts, SSH options, or remote commands. Those stay in
extension-side policy and are validated before OpenSSH/WASM starts.

For launch-flow job reporting, the descriptor also returns a short-lived
`jobReportToken`. That token authorizes posting scheduler metadata only; it is
not an SSH credential and must not be logged or placed in URLs.
