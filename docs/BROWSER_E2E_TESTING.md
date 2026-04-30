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

The Playwright test loads `build/extension` as an unpacked MV3 extension in Chromium, starts the local dev relay stack, opens `html/session.html?dev=1`, enters the throwaway local test password into the extension page, and requires the real remote command output:

```text
slaif-browser-relay-ok
```

Seeing the page load, plugin verification pass, or the relay connect is not enough. The test must observe the fixed command output produced by the sshd container.

## Host-Key Verification

The dev stack writes a generated `known_hosts` line for `HostKeyAlias=test-sshd` into `build/extension/config/dev_runtime.local.json`.

The browser test also includes a negative case with an intentionally wrong known_hosts entry. That test expects OpenSSH/WASM to fail host-key verification and verifies that the fixed command output is not observed.

## Commands

```bash
npm run browser:install
npm run test:browser
npm run test:browser:headed
npm run test:browser:debug
npm run test:browser:hostkey-negative
```

`npm test` intentionally does not require Playwright or Chromium. Browser validation is explicit because it needs Chromium, Docker, and the generated extension build.

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
