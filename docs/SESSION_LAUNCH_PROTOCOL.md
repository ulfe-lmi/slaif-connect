# SLAIF Session Launch Protocol

This document defines the product-shaped launch boundary for SLAIF Connect.

## Flow

1. The user is on an approved SLAIF web origin.
2. The SLAIF web page calls `chrome.runtime.sendMessage(extensionId, ...)`.
3. The extension service worker receives the external message.
4. The service worker validates the sender origin.
5. The service worker validates the `hpc` alias and `sessionId`.
6. The service worker stores a pending launch in `chrome.storage.session`.
7. The service worker opens `html/session.html`.
8. The session page loads the pending launch.
9. The session page fetches a session descriptor from the SLAIF API.
10. The session page validates the descriptor against extension-side policy.
11. The session page starts browser-side OpenSSH/WASM through the WSS relay.
12. Browser-side SSH verifies the HPC host key or host CA.
13. The user authenticates to the SSH server.
14. The extension runs the fixed remote command template from policy.
15. Job/output metadata may be returned to SLAIF by explicit product design.

The SSH client is the extension. The SLAIF server provides orchestration and a byte relay; it does not become an SSH client.

## Launch Message

The web page may send only a launch request:

```json
{
  "type": "slaif.startSession",
  "version": 1,
  "hpc": "vegahpc",
  "sessionId": "sess_abcdefgh",
  "launchToken": "opaque-short-lived-token"
}
```

Rules:

- `hpc` is an alias only, never a hostname.
- `sessionId` must pass the strict extension validator.
- `launchToken` is not an SSH credential. It authorizes fetching one session descriptor.
- The launch token must not be placed in URLs or logged.
- The web page must not provide SSH target details, host keys, SSH options, or commands.

The extension rejects these fields if present in the launch message:

```text
sshHost, sshPort, host, port, knownHosts, known_hosts, hostKey,
hostKeyAlias, command, remoteCommand, sshOptions, relayHost, relayPort
```

## Session Descriptor

The session page fetches the descriptor using:

```text
GET <apiBaseUrl>/api/connect/session/<sessionId>
Authorization: Bearer <launchToken>
```

The descriptor shape is:

```json
{
  "type": "slaif.sessionDescriptor",
  "version": 1,
  "sessionId": "sess_abcdefgh",
  "hpc": "vegahpc",
  "relayUrl": "wss://connect.slaif.si/ssh-relay",
  "relayToken": "opaque-short-lived-relay-token",
  "relayTokenExpiresAt": "2026-04-30T12:00:00.000Z",
  "usernameHint": "optional-user-name",
  "mode": "launch"
}
```

Rules:

- Descriptor `hpc` must match the pending launch.
- Descriptor `sessionId` must match the pending launch.
- `relayToken` is not an SSH credential. It authorizes one relay connection.
- `relayToken` must be short-lived and session-bound.
- Production `relayUrl` must use `wss://`.
- Local browser E2E may use `ws://127.0.0.1:<port>` only with local-dev runtime config.
- Descriptor fields must not redefine SSH host, SSH port, host key, SSH options, or command.

The extension rejects these fields if present in the descriptor:

```text
sshHost, sshPort, host, port, knownHosts, known_hosts, hostKey,
hostKeyAlias, command, remoteCommand, sshOptions, relayHost, relayPort
```

Extension-side policy remains authoritative for:

```text
SSH host
SSH port
HostKeyAlias
known_hosts / host CA
remote command template
```

## Local Development Origin

The manifest and service worker allow `http://127.0.0.1/*` only for Playwright and manual local launcher testing. `localhost` is intentionally not accepted by the runtime origin check, so tests can cover disallowed-origin behavior without broadening the manifest.

Production launch origins must be HTTPS and listed narrowly in `externally_connectable`.
