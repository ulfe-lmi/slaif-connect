# Relay Hardening

The SLAIF relay carries encrypted SSH bytes between the browser extension and an
approved SSH server:

```text
extension OpenSSH/WASM
  -> WSS relay
  -> TCP
  -> sshd
```

The relay is not an SSH endpoint. It does not decrypt SSH, authenticate to SSH
as the user, parse terminal data, or receive SSH credentials.

## Threats

The relay must be hardened against:

- open TCP proxy abuse;
- token replay;
- token theft;
- wrong-scope token use;
- expired token use;
- relay rerouting to an unexpected host;
- denial of service;
- excessive connection duration;
- excessive idle duration;
- accidental SSH payload logging;
- metadata leakage.

## Required Controls

The relay must enforce:

- server-side allowlist only;
- no client-supplied host or port;
- token-bound HPC alias;
- token expiry;
- token replay prevention;
- maximum unauthenticated WebSocket lifetime;
- maximum auth message size;
- binary frames rejected before auth;
- per-session relay connection limits;
- idle timeout after auth;
- absolute max connection lifetime;
- payload bytes never logged;
- audit-safe structured event logging;
- aggregate metrics for auth outcomes, connections, active connections, bytes,
  duration, and timeouts without token/session/credential labels;
- generic client errors that do not expose sensitive details;
- production TCP egress controls to approved HPC login nodes.

## Current Validation

This repository includes non-Docker relay hardening tests for:

- unauthenticated timeout;
- oversized auth rejection;
- binary-before-auth rejection;
- invalid, expired, replayed, and wrong-scope token rejection;
- client-supplied host/port rejection;
- missing allowlist target rejection;
- idle timeout;
- max lifetime timeout;
- audit logs that do not contain SSH payloads.
- metrics that do not contain tokens, session IDs, credentials, transcripts, or
  SSH payloads.

Run:

```bash
npm run test:relay-hardening
```

The local development implementation is a reference foundation. The Redis token
store provides durable/shared token state and atomic consume semantics for
distributed replay prevention when API/relay instances share the same Redis
deployment. Production deployment still needs secure Redis operations, rate
limits, WSS/TLS hardening, firewall egress rules, readiness checks, and
operational logging review. See
[PRODUCTION_DEPLOYMENT_CONTRACT.md](PRODUCTION_DEPLOYMENT_CONTRACT.md) and
[PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md). The audit and metrics
schema is defined in [OBSERVABILITY.md](OBSERVABILITY.md).
