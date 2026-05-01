# Production API / Relay Deployment Contract

## Scope

This document defines the server-side deployment contract for the SLAIF Connect
API and relay:

- SLAIF API session descriptor endpoint;
- WebSocket-to-TCP relay endpoint;
- job report endpoint;
- token issuance, validation, expiry, and replay prevention;
- audit-safe logging and metrics exposition;
- operational health and readiness checks.

This repository provides reference code and validation for the contract. This
does not mean SLAIF Connect is production deployed.

## Production Architecture

```text
SLAIF web app
  -> extension launch message
  -> SLAIF API descriptor endpoint
  -> shared token store
  -> relay endpoint
  -> approved HPC sshd
  -> job report endpoint
  -> audit logs / metrics
```

The API and relay may run in one service or separate services. If multiple API
or relay instances are deployed, token state and replay prevention must be
shared. A relay token consumed on one instance must be unusable on every other
instance.

The relay egress path must be restricted to approved HPC login nodes. The
signed extension-side HPC policy remains authoritative for SSH host, SSH port,
host-key trust, relay origin, API origin, and remote command template. Session
descriptors still must not supply SSH host, host key, SSH options, or command.

## Required Server Endpoints

### `GET /api/connect/session/:sessionId`

Requires `Authorization: Bearer <launchToken>`.

The token scope must be `slaif.launch`, bound to the route `sessionId` and HPC
alias. The endpoint consumes the launch token when the descriptor is issued.

The response is a session descriptor containing relay URL, relay token, relay
token expiry, job report token, job report token expiry, HPC alias, session ID,
and optional username hint. It must not contain SSH target fields, host keys,
known_hosts, SSH options, or commands.

Do not log the launch token. Do not accept launch tokens in query strings.

### `POST /api/connect/session/:sessionId/job-report`

Requires `Authorization: Bearer <jobReportToken>`.

The token scope must be `slaif.jobReport`, bound to the route `sessionId` and
HPC alias. A final report token is one-use by default.

The request body contains safe job metadata only: session ID, HPC alias,
scheduler, job ID, status, SSH exit code, and timestamp. It must not contain
stdout, stderr, terminal transcript, passwords, OTPs, private keys, launch
tokens, relay tokens, or job report tokens.

### `WS /ssh-relay`

The extension opens the WebSocket and sends a small first JSON message:

```json
{"type":"auth","relayToken":"..."}
```

The token scope must be `slaif.relay`, bound to session ID and HPC alias, and
one-use by default. The relay maps the token server-side to the approved alias
and fixed target. Clients must not supply host or port.

Binary SSH bytes may be forwarded only after relay auth succeeds. Binary frames
before auth are rejected.

### `GET /healthz`

Liveness only. It means the process is alive.

### `GET /readyz`

Readiness means deployment configuration is valid, token store is reachable,
rate-limit dependency is ready, relay allowlist is loaded, audit sink and
metrics registry are healthy, required policy/trust-root files are configured,
and unsafe production config has been rejected.

## Durable Token Storage

Production must not rely on per-process memory if more than one API/relay
instance exists.

The token store must provide:

- atomic consume operation;
- expiry support;
- scope validation;
- session ID and HPC binding validation;
- max-use enforcement;
- revocation support;
- cleanup of expired tokens;
- safe token fingerprinting;
- no storage of raw token values if avoidable;
- no logging of raw token values.

Acceptable production options include Redis with atomic Lua/transactions,
Postgres with row-level locking or atomic updates, or another durable store with
equivalent atomic consume semantics. The current repository implements the
memory adapter for development/test and a Redis adapter for durable/shared token
state. Postgres remains an explicit failing placeholder and must not be treated
as implemented.

Redis deployment must be operated securely. Use TLS or a trusted private
network, protect Redis credentials through a secret manager, restrict network
access to the API/relay services, monitor latency and availability, and define
backup/retention expectations appropriate for short-lived token records. Redis
records are keyed by a token hash/fingerprint and must not contain raw token
values.

## Distributed Replay Prevention

The in-memory token registry is development/reference code only.

Multi-instance deployments require shared token state. Reusing a launch token,
relay token, or job report token must fail even if the second request reaches a
different API or relay instance.

## Rate Limiting and Abuse Controls

Production deployment must define limits for:

- descriptor fetches per session, user, origin, and source IP;
- relay connection attempts per session, token fingerprint, and source IP;
- concurrent relay connections per session;
- unauthenticated WebSocket duration;
- relay idle timeout;
- relay absolute lifetime;
- relay auth message size;
- job report body size;
- audit event size;
- optional global circuit breakers.

The reference package includes a memory rate limiter for development/test and
an explicit external placeholder. Production must use infrastructure-backed
rate limiting unless a single-instance pilot exception is explicitly approved.

## Audit-Safe Logging And Metrics

Required event types include:

- `descriptor.requested`
- `descriptor.issued`
- `descriptor.rejected`
- `token.issued`
- `token.validated`
- `token.consumed`
- `token.rejected`
- `token.revoked`
- `relay.auth.started`
- `relay.auth.accepted`
- `relay.auth.rejected`
- `relay.connected`
- `relay.closed`
- `relay.timeout`
- `relay.error`
- `jobReport.received`
- `jobReport.accepted`
- `jobReport.rejected`
- `rateLimit.rejected`
- `config.loaded`
- `config.rejected`
- `health.ready`
- `health.notReady`

Rules:

- never log raw token values;
- never log SSH payload bytes;
- never log raw terminal transcript;
- never log passwords, OTPs, private keys, or passphrases;
- log token fingerprints only;
- include session ID and HPC alias only as allowed by privacy policy;
- retain logs according to site policy;
- redact payload-like fields.

Metrics must be aggregate and low-cardinality. Prometheus-style metrics may use
labels such as `outcome`, `reason`, `scope`, `route`, `environment`, and
`tokenStoreType`. Metrics must not use session IDs, raw tokens, token
fingerprints, usernames, passwords, OTPs, private keys, SSH payloads,
transcripts, stdout, stderr, or raw command output as labels.

## Health and Readiness

`/healthz` reports only that the process is alive.

`/readyz` must fail if any required production dependency or safe configuration
is missing:

- deployment configuration valid;
- token store reachable;
- metrics registry healthy;
- signed policy and trust roots configured where required;
- relay target allowlist loaded;
- audit sink configured, or degraded mode explicitly approved;
- no required secret missing;
- no unsafe production config.

Readiness output must not include secrets or raw tokens.

## Production Configuration

Required environment/config fields:

```text
SLAIF_ENV=development|test|local-pilot|production
SLAIF_API_BASE_URL
SLAIF_RELAY_PUBLIC_URL
SLAIF_ALLOWED_WEB_ORIGINS
SLAIF_ALLOWED_RELAY_TARGETS_FILE
SLAIF_TOKEN_STORE=memory|redis|postgres
SLAIF_TOKEN_STORE_URL
SLAIF_REDIS_KEY_PREFIX
SLAIF_REDIS_CONNECT_TIMEOUT_MS
SLAIF_REDIS_COMMAND_TIMEOUT_MS
SLAIF_REDIS_TLS_ENABLED
SLAIF_AUDIT_LOG_MODE=stdout|file|memory|external|disabled
SLAIF_AUDIT_LOG_PATH
SLAIF_AUDIT_INCLUDE_SESSION_ID
SLAIF_METRICS_MODE=prometheus|external|disabled
SLAIF_METRICS_PATH
SLAIF_HEALTH_PATH
SLAIF_READY_PATH
SLAIF_METRICS_INCLUDE_HPC_LABEL
SLAIF_OBSERVABILITY_ENV_LABEL
SLAIF_RELAY_MAX_AUTH_BYTES
SLAIF_RELAY_UNAUTH_TIMEOUT_MS
SLAIF_RELAY_IDLE_TIMEOUT_MS
SLAIF_RELAY_ABSOLUTE_TIMEOUT_MS
SLAIF_JOB_REPORT_MAX_BYTES
SLAIF_RATE_LIMIT_MODE=disabled|memory|external
SLAIF_POLICY_TRUST_ROOTS_FILE
SLAIF_SIGNED_POLICY_FILE
```

Production must reject:

- memory token store unless explicitly labeled single-instance pilot mode;
- disabled rate limiting;
- disabled production metrics unless an explicitly external monitoring path is configured;
- memory audit sink in production unless explicitly labeled single-instance pilot mode;
- `http://` API base URLs;
- `ws://` relay public URLs;
- wildcard web origins;
- missing relay target allowlist;
- missing audit configuration;
- missing token store URL when Redis/Postgres is selected;
- invalid Redis URL or unsafe Redis key prefix when Redis is selected;
- unsafe timeout or size limits.

## Production Caveats

Future work remains:

- production Redis deployment and validation against the target environment;
- Postgres token-store adapter, if Postgres is selected later;
- production secret management;
- production policy signing key custody;
- production audit sink deployment and metrics scrape/alerting integration;
- institutional audit retention policy;
- infrastructure firewall rules;
- real-HPC pilot validation;
- Chrome Web Store or enterprise extension distribution.
