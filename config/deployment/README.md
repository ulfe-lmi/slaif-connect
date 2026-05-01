# Deployment Configuration Examples

These files are examples for validating the SLAIF API/relay deployment contract.
They are not production secrets and they are not complete deployment manifests.

- `development.example.json` is suitable for local reference servers.
- `production.example.json` shows the required production shape with HTTPS/WSS,
  durable token-store mode, external rate limiting, audit logging, Prometheus
  metrics, health/readiness paths, signed policy, and relay allowlist paths.

The Redis token store is implemented as the first durable/shared token-state
adapter. The example uses a placeholder Redis URL; real credentials should be
provided by environment variables or a secret manager, not committed JSON.
Production Redis should run with TLS or on a trusted private network with
restricted access, monitoring, and retention/backups reviewed by operators.

The memory token store is only for development/test or an explicitly labeled
single-instance pilot. Postgres remains intentionally not implemented in this
repository.

Production audit and metrics settings are operational contracts, not a complete
monitoring deployment. Protect `/metrics` with network or platform controls,
route audit JSONL/events to an approved sink, and define retention and privacy
review outside committed configuration. Metrics must not use session IDs, token
values, token fingerprints, credentials, or SSH payloads as labels.

Local runtime configuration must use ignored files such as:

```text
config/deployment/development.local.json
config/deployment/production.secret.json
config/deployment/local.env
```

Do not commit real token-store URLs containing credentials, production secrets,
private signing keys, or local runtime configuration.
