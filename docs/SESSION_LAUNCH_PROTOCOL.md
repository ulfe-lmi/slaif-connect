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
10. The session page verifies signed HPC policy and validates the descriptor against that policy.
11. The session page starts browser-side OpenSSH/WASM through the WSS relay.
12. Browser-side SSH verifies the HPC host key or host CA.
13. The user authenticates to the SSH server.
14. The extension runs the fixed remote command template from policy.
15. The extension parses scheduler output from that fixed command.
16. The extension reports safe job metadata to SLAIF by explicit product design.

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
- The launch token has scope `slaif.launch` and is consumed when the descriptor
  is fetched in the reference implementation.
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
  "jobReportToken": "opaque-short-lived-job-report-token",
  "jobReportTokenExpiresAt": "2026-04-30T12:00:00.000Z",
  "usernameHint": "optional-user-name",
  "mode": "launch"
}
```

Rules:

- Descriptor `hpc` must match the pending launch.
- Descriptor `sessionId` must match the pending launch.
- `relayToken` is not an SSH credential. It authorizes one relay connection.
- `relayToken` must be short-lived and session-bound.
- `relayToken` has scope `slaif.relay` and cannot be reused after a relay
  connection is accepted.
- `jobReportToken` is not an SSH credential. It authorizes posting one session-bound job metadata report.
- `jobReportToken` must be short-lived and session-bound.
- `jobReportToken` is required for launch-flow job reporting.
- `jobReportToken` has scope `slaif.jobReport` and is consumed when the final
  job metadata report is accepted.
- Production `relayUrl` must use `wss://`.
- Local browser E2E may use `ws://127.0.0.1:<port>` only with local-dev runtime config.
- Descriptor `relayUrl` origin must be listed in signed policy `allowedRelayOrigins`.
- Descriptor fetch origin must be listed in signed policy `allowedApiOrigins`.
- Descriptor fields must not redefine SSH host, SSH port, host key, SSH options, or command.

The extension rejects these fields if present in the descriptor:

```text
sshHost, sshPort, host, port, knownHosts, known_hosts, hostKey,
hostKeyAlias, command, remoteCommand, sshOptions, relayHost, relayPort,
jobCommand, schedulerCommand, stdoutUploadUrl, transcriptUploadUrl,
reportUrl, jobReportUrl
```

Signed extension-side policy remains authoritative for:

```text
SSH host
SSH port
HostKeyAlias
known_hosts / host CA
allowed API origins
allowed relay origins
remote command template
```

The preferred production remote command template is the HPC-side launcher
contract:

```text
/opt/slaif/bin/slaif-launch --session ${SESSION_ID}
```

The launcher contract is documented in
[REMOTE_LAUNCHER_CONTRACT.md](REMOTE_LAUNCHER_CONTRACT.md). Neither the web
launch message nor the descriptor may provide launcher arguments, job scripts,
or shell fragments.

Job reports are posted to:

```text
POST <apiBaseUrl>/api/connect/session/<sessionId>/job-report
Authorization: Bearer <jobReportToken>
```

The report endpoint is derived from the trusted API base and `sessionId`; the
descriptor cannot provide arbitrary upload URLs. Report payloads contain
scheduler metadata such as SLURM job ID and status, not raw terminal
transcripts.

Token lifecycle rules are documented in
[TOKEN_LIFECYCLE.md](TOKEN_LIFECYCLE.md). The reference development stack
rejects wrong-scope, expired, and replayed launch, relay, and job-report
tokens.

The signed policy prevents a compromised web page or session descriptor API from
silently changing the SSH target, host trust, relay origin, or command template.

The same boundary applies to real-HPC pilots. The mock pilot API may issue a
session descriptor with `relayUrl`, `relayToken`, expiry, and optional
`usernameHint`, but it must not define or override SSH target details. The
pilot relay target is resolved from verified signed policy, not from the web
launch message, descriptor, or CLI host/port arguments.

## Local Development Origin

The manifest and service worker allow `http://127.0.0.1/*` only for Playwright and manual local launcher testing. `localhost` is intentionally not accepted by the runtime origin check, so tests can cover disallowed-origin behavior without broadening the manifest.

Production launch origins must be HTTPS and listed narrowly in `externally_connectable`.

## Production API / Relay Deployment

Production API and relay services must follow
[PRODUCTION_DEPLOYMENT_CONTRACT.md](PRODUCTION_DEPLOYMENT_CONTRACT.md). The
descriptor endpoint, relay endpoint, and job-report endpoint require durable
token storage, distributed replay prevention, rate limits, audit-safe logging,
and readiness checks in production.

The in-memory token registry used by local development is not sufficient for a
multi-instance production deployment.
