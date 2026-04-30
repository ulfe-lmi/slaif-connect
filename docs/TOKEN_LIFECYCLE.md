# Token Lifecycle

SLAIF Connect uses short-lived tokens to coordinate browser launch, relay access,
and job metadata reporting. These tokens are not SSH credentials. They must
never be treated as SSH passwords, OTPs, private keys, or private-key
passphrases.

## Purpose

`launchToken` allows the extension to fetch one session descriptor from the
SLAIF API after an approved web launch.

`relayToken` allows one approved WebSocket-to-TCP relay connection for one
session and one HPC alias.

`jobReportToken` allows the extension to post one safe scheduler metadata report
for one session.

None of these tokens grant SSH access by themselves. SSH authentication remains
between the browser-side OpenSSH/WASM client and the real `sshd`.

## Token Scopes

Tokens are scoped by purpose:

| Token | Scope |
| --- | --- |
| `launchToken` | `slaif.launch` |
| `relayToken` | `slaif.relay` |
| `jobReportToken` | `slaif.jobReport` |

A token with the wrong scope must be rejected. A launch token cannot open a
relay, a relay token cannot post a job report, and a job-report token cannot
fetch a session descriptor.

## Token Binding

Every token is bound to:

- `sessionId`;
- HPC alias;
- scope;
- issue time;
- expiry time;
- optional allowed web/API origin;
- optional extension/runtime audience;
- one-use or bounded-use count.

Relay tokens are also bound to the server-side relay alias and allowlist target.
The default relay-token policy is one relay connection and one total use.

Job-report tokens are bound to one report endpoint/session. The default
job-report-token policy is one final accepted report.

## Expiry Policy

Development defaults are intentionally short. Production values require
deployment review, but the recommended starting point is:

| Token | Recommended TTL |
| --- | --- |
| `launchToken` | 2-5 minutes |
| `relayToken` | 2-5 minutes to open, plus a relay connection max lifetime |
| `jobReportToken` | 5-15 minutes or until the final report is accepted |

Expired tokens must fail closed.

## Replay Prevention

The reference implementation consumes tokens on successful use:

- `launchToken` is consumed when the descriptor is fetched;
- `relayToken` is consumed when relay authentication accepts the connection;
- `jobReportToken` is consumed when the final job metadata report is accepted.

Reusing a consumed token fails. Failed attempts must not reveal full token
values.

## Logging

Never log full token values. Logs may include a short token fingerprint, such as
a SHA-256 prefix, plus safe metadata like `sessionId`, HPC alias, scope, event
type, and timestamp.

Logs must not include:

- SSH credentials;
- raw SSH payloads;
- terminal transcripts;
- passwords, OTPs, private keys, or passphrases;
- full launch, relay, or job-report token values.

## Reference Implementation

`server/tokens/token_registry.js` provides an in-memory development registry for
issuing, validating, consuming, revoking, and cleaning up scoped tokens. It is
used by the local browser dev stack and real-HPC pilot stack.

`server/tokens/token_store.js` defines the production-facing token-store
contract and wraps the in-memory registry for development/test. Redis and
Postgres modes are explicit not-implemented placeholders in this repository so
they cannot be mistaken for production-ready adapters.

This is not production key custody or a distributed token store. Production
deployment still needs durable storage, distributed replay prevention, key
management, rate limits, and operational audit policy. See
[PRODUCTION_DEPLOYMENT_CONTRACT.md](PRODUCTION_DEPLOYMENT_CONTRACT.md).
