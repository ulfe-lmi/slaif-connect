# Browser OpenSSH/WASM Relay Prototype

This prototype moves the relay test path toward the production architecture:

```text
Chrome extension session page
  -> bundled OpenSSH/WASM from pinned libapps
  -> SLAIF WebSocket-to-TCP relay
  -> local test sshd container
```

It is development-only. The production extension must still use approved SLAIF sessions, signed extension policy, WSS, and real HPC host keys or host CA policy.

## What It Proves

The prototype attempts to start upstream OpenSSH/WASM inside the extension and gives it a TCP-like relay object backed by the SLAIF WebSocket relay. The relay remains a byte forwarder and does not ask for SSH passwords, OTPs, private keys, or decrypted terminal output.

Strict host-key verification is still required. The local dev stack generates a host key and writes the matching `known_hosts` line into a signed local policy under `build/extension/config/hpc_policy.local.json`.

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
- a mock SLAIF launcher/API server on `127.0.0.1`;
- a generated `build/extension/config/dev_runtime.local.json`;
- a generated signed local policy and trust root under `build/extension/config`.

It also prints the mock launcher URL and the throwaway local password for
`testuser`.

The mock SLAIF API returns only session descriptor data: `relayUrl`,
`relayToken`, token expiry, and a local username hint. It does not return SSH
host, SSH port, known_hosts entries, SSH options, or remote commands. Those stay
in signed extension-side policy.

## Manual Chrome Test

1. Open Chrome extensions.
2. Enable developer mode.
3. Load `build/extension` as an unpacked extension.
4. Open the mock launcher URL printed by `npm run dev:extension-stack` with
   `?extensionId=<your-extension-id>`.
5. Click **Launch SLAIF Connect**.
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

The browser E2E suite also includes a browser-side host-key negative case:

```bash
npm run test:browser:hostkey-negative
```

For manual browser testing, changing the generated signed policy payload after signing should make policy verification fail before SSH starts. Running the automated host-key negative test generates a wrong signed `known_hosts` entry and OpenSSH/WASM rejects the server before trusting it.

See `docs/BROWSER_E2E_TESTING.md` for the automated Chromium harness.

## Limitations

This prototype now exercises the product-shaped web launch/session descriptor
flow locally, but it still does not make SLAIF Connect a general SSH terminal or
wire real SLAIF production sessions.

The local dev stack may use password authentication for manual browser testing because browser-side private-key provisioning is not implemented yet. The existing Docker E2E test remains public-key-only.

The browser validation path currently uses deterministic generated compatibility files for the low-level upstream modules needed by this prototype. A later PR may replace those shims with a fuller upstream build step without editing `third_party/libapps`.
