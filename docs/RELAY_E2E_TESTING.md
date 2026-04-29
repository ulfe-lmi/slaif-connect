# Relay E2E Testing

This development harness proves that real SSH traffic can traverse the SLAIF
WebSocket-to-TCP relay while the relay only forwards bytes.

The local test path is:

```text
local OpenSSH client
  -> local dev TCP-to-WebSocket bridge
  -> SLAIF relay over WebSocket
  -> TCP connection from relay to test sshd container
  -> OpenSSH server inside container
```

The production path is still:

```text
SLAIF web page
  -> SLAIF Connect Chrome extension
  -> browser-side OpenSSH/WASM client
  -> WSS WebSocket-to-TCP relay
  -> real HPC sshd
```

The test uses the system `ssh` binary only as a local test client. It does not
wire browser-side OpenSSH/WASM and does not add direct TCP to the Chrome
extension.

## What The Harness Proves

- the relay requires a JSON auth message before accepting binary frames;
- the relay maps the relay token to a server-side approved alias;
- the WebSocket client never supplies a raw SSH host or port;
- the relay opens TCP only to the allowlisted target;
- encrypted SSH bytes can cross the relay and complete public-key auth;
- the relay does not terminate SSH, inspect SSH auth, or log SSH payload bytes;
- strict host-key verification remains effective through the relay.

The strict host-key negative test writes an intentionally wrong `known_hosts`
entry for `HostKeyAlias=slaif-test-sshd`. SSH must fail with host-key
verification enabled. This simulates the relay rerouting to a fake SSH server or
the expected host key changing unexpectedly.

## Prerequisites

```text
docker
ssh
ssh-keygen
npm install
```

The E2E script fails with a clear missing-prerequisite message when run
directly and a prerequisite is unavailable.

## Commands

Run the lightweight relay auth/security tests:

```bash
npm run test:relay
```

Run the Docker/OpenSSH relay E2E test:

```bash
npm run test:relay:e2e
```

`npm test` runs the lightweight project checks and `npm run test:relay`. It does
not require Docker.

## Dev Bridge

`tools/ws-tcp-bridge.js` is a development-only bridge that lets the system
OpenSSH client connect to a local TCP port and forward bytes to the WebSocket
relay.

It is not part of the extension runtime. The extension must continue to use the
browser-side relay adapter and, later, bundled OpenSSH/WASM.
