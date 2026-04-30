# Browser OpenSSH/WASM Relay Prototype

This prototype moves the relay test path toward the production architecture:

```text
Chrome extension session page
  -> bundled OpenSSH/WASM from pinned libapps
  -> SLAIF WebSocket-to-TCP relay
  -> local test sshd container
```

It is development-only. The production extension must still use approved SLAIF sessions, strict extension policy, WSS, and real HPC host keys or host CA policy.

## What It Proves

The prototype attempts to start upstream OpenSSH/WASM inside the extension and gives it a TCP-like relay object backed by the SLAIF WebSocket relay. The relay remains a byte forwarder and does not ask for SSH passwords, OTPs, private keys, or decrypted terminal output.

Strict host-key verification is still required. The local dev stack generates a host key and writes the matching known_hosts line into `build/extension/config/dev_runtime.local.json`.

## Setup

Install dependencies and plugin artifacts:

```bash
npm install
npm run upstream:init
npm run vendor:libapps
npm run plugin:install
npm run build:extension
npm run plugin:verify
```

Start the local browser development stack:

```bash
npm run dev:extension-stack
```

The stack starts:

- a local OpenSSH test container;
- the SLAIF relay server on `127.0.0.1`;
- a generated `build/extension/config/dev_runtime.local.json`.

It also prints the throwaway local password for `testuser`.

## Manual Chrome Test

1. Open Chrome extensions.
2. Enable developer mode.
3. Load `build/extension` as an unpacked extension.
4. Open the SLAIF Connect popup.
5. Click **Open local dev session**.
6. When OpenSSH prompts for the `testuser` password, enter the password printed by `npm run dev:extension-stack`.
7. Expected command output is:

```text
slaif-browser-relay-ok
```

The dev password is local-only and only exists inside the disposable test container. Production SLAIF Connect must not collect SSH passwords in the server or relay.

## Host-Key Negative Testing

The automated Docker/OpenSSH relay test still includes a strict host-key negative case:

```bash
npm run test:relay:e2e
```

For manual browser testing, changing the generated `knownHosts` line in `build/extension/config/dev_runtime.local.json` should cause OpenSSH/WASM to reject the server before trusting it.

## Limitations

This PR does not make SLAIF Connect a general SSH terminal and does not wire real SLAIF production sessions to OpenSSH/WASM yet.

The local dev stack may use password authentication for manual browser testing because browser-side private-key provisioning is not implemented yet. The existing Docker E2E test remains public-key-only.

If Chrome reports missing upstream generated `*.rollup.js` modules, a later PR should add a deterministic build-time generation step for those upstream dependency bundles without editing `third_party/libapps`.
