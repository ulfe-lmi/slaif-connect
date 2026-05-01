# SLAIF Connect Observability

## Scope

This document covers server-side observability for the SLAIF API descriptor
endpoint, WebSocket-to-TCP relay, token issuance/validation/consumption, job
report endpoint, rate limiting, health/readiness, and deployment diagnostics.

This PR adds reference observability modules and tests. It does not by itself
deploy a production monitoring stack.

As the product moves from job-ID-only reporting to payload-driven Slurm
workloads, observability must remain aggregate and safe. Future diagnostic
  payload results and interactive GaMS worker events may add audit event types and
metrics, but they must not expose SSH credentials, workload tokens, raw prompts
where policy forbids them, terminal transcripts, or high-cardinality metric
labels. The workload roadmap is defined in
[../SLAIF_WORKLOAD_MVP.md](../SLAIF_WORKLOAD_MVP.md).

## Non-Negotiable Privacy And Security Rules

- No raw `launchToken`, `relayToken`, or `jobReportToken` values in logs.
- No raw `workloadToken` values in logs.
- No token values or token fingerprints in metrics labels.
- No SSH passwords, OTPs, private keys, or private-key passphrases in logs or metrics.
- No raw SSH payload bytes.
- No decrypted terminal transcript.
- No raw stdout/stderr upload.
- No arbitrary command strings.
- No Redis URL credentials in logs.
- No high-cardinality `sessionId` labels in metrics.

## Audit Vs Metrics

Audit events are structured security-relevant records. They may include a
session ID if deployment privacy policy permits it, and they may include a safe
token fingerprint for investigation.

Metrics are aggregate counters, gauges, and summaries. They use low-cardinality
labels only. Metrics must not include session IDs, token values, token
fingerprints, usernames, credentials, raw commands, or raw output.

## Audit Event Schema

Audit events use a stable JSON shape:

```json
{
  "type": "slaif.auditEvent",
  "version": 1,
  "event": "relay.auth.accepted",
  "timestamp": "2026-04-30T12:00:00.000Z",
  "requestId": "req_...",
  "sessionId": "sess_...",
  "hpc": "vegahpc",
  "scope": "slaif.relay",
  "tokenFingerprint": "sha256:...",
  "outcome": "accepted",
  "reason": "optional_reason_code",
  "remoteAddress": "optional_redacted_or_allowed_value",
  "durationMs": 123,
  "metadata": {}
}
```

Allowed fields include event identity, timestamp, request ID, session ID where
policy allows, bounded HPC alias, token scope, safe token fingerprint, outcome,
reason code, bounded duration, and non-secret metadata.

Forbidden fields include raw tokens, Authorization headers, passwords, OTPs,
private keys, raw SSH payloads, terminal transcripts, raw stdout/stderr, and
Redis URLs containing credentials. The audit helper redacts token-like and
payload-like fields before writing to a sink.

## Required Audit Events

The reference implementation emits or supports these event names:

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
- `rateLimit.accepted`
- `rateLimit.rejected`
- `health.ready`
- `health.notReady`
- `config.loaded`
- `config.rejected`
- `workload.token.issued`
- `workload.token.consumed`
- `workload.hello.received`
- `workload.hello.accepted`
- `workload.hello.rejected`
- `workload.connected`
- `workload.disconnected`
- `workload.prompt.received`
- `workload.response.delta`
- `workload.response.done`
- `workload.stop.requested`
- `workload.error`

## Required Metrics

The reference metrics registry exposes Prometheus-style text for:

- `slaif_descriptor_requests_total`
- `slaif_descriptor_rejections_total`
- `slaif_tokens_issued_total`
- `slaif_tokens_consumed_total`
- `slaif_tokens_rejected_total`
- `slaif_relay_auth_total`
- `slaif_relay_connections_total`
- `slaif_relay_active_connections`
- `slaif_relay_connection_duration_seconds`
- `slaif_relay_bytes_total`
- `slaif_relay_timeouts_total`
- `slaif_job_reports_total`
- `slaif_job_report_rejections_total`
- `slaif_rate_limit_rejections_total`
- `slaif_workload_tokens_issued_total`
- `slaif_workload_registrations_total`
- `slaif_workload_active_connections`
- `slaif_workload_prompts_total`
- `slaif_workload_responses_total`
- `slaif_workload_errors_total`
- `slaif_readiness_status`
- `slaif_token_store_health`
- `slaif_audit_sink_health`

Allowed labels are low-cardinality values such as `outcome`, `reason`, `scope`,
bounded `hpc` aliases when explicitly enabled, `environment`, `route`, and
`tokenStoreType`. Workload metrics may also use bounded low-cardinality labels
such as `payloadId`, `runtime`, `outcome`, and `reason`.

Forbidden labels include raw tokens, token fingerprints, `sessionId`, username,
password, OTP, private key, untrusted raw hostnames, raw commands, stdout,
stderr, transcripts, prompt IDs, raw prompt text, raw response text, and output
text.

## Production Operations

The reference HTTP helper supports:

```text
GET /metrics
GET /healthz
GET /readyz
```

Production deployments must protect the metrics endpoint with network,
ingress, or monitoring-platform controls. `/healthz` should prove process
liveness only. `/readyz` should fail when deployment config, token store,
rate limiter, audit sink, metrics registry, relay allowlist, signed policy, or
trust roots are unhealthy or missing.

Useful alert examples:

- relay auth rejection rate rises above baseline;
- relay active connections approach configured limits;
- token rejection reason changes suddenly;
- readiness is not OK;
- audit sink health is not OK;
- token store health is not OK;
- job report rejection rate rises.

Retention, privacy review, SIEM routing, and incident response ownership are
deployment decisions. The reference code provides safe event and metrics
formats; it does not provide production log rotation, retention, access control,
or monitoring infrastructure.
