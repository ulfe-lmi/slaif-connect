# SLAIF Connect Production Checklist

This checklist is a deployment readiness aid. It is not evidence that SLAIF
Connect is already deployed in production.

## Extension

- [ ] Signed HPC policy is bundled.
- [ ] Policy trust root is bundled.
- [ ] Manifest has no `chrome.sockets` permission.
- [ ] Manifest has no broad `web_accessible_resources`.
- [ ] Extension loads no remote executable JS/WASM at runtime.
- [ ] External web origins are narrow and intentional.
- [ ] Browser E2E tests pass against the release build.

## Policy / Host Trust

- [ ] Real HPC host key or host CA is verified out of band.
- [ ] Signed policy sequence is correct and current.
- [ ] Signed policy includes an allowed payload catalog.
- [ ] Each HPC host has explicit `allowedPayloadIds`.
- [ ] Payload catalog entries contain bounded metadata only, not shell commands,
      Slurm scripts, credentials, tokens, or endpoint overrides.
- [ ] Host-key rotation plan exists.
- [ ] Emergency revocation process exists.
- [ ] Rollback protection is checked.

## API / Tokens

- [ ] Durable token store is configured.
- [ ] Redis token store, if selected, is reachable only over TLS or a trusted
      private network with credentials managed outside the repository.
- [ ] Distributed replay prevention is tested across instances.
- [ ] Token TTLs are reviewed.
- [ ] Token scopes are separated.
- [ ] Token values are not logged.
- [ ] Tokens are not placed in URLs.
- [ ] Token values and token fingerprints are not used as metrics labels.
- [ ] Redis or equivalent shared adapter is deployed if multiple instances run.
- [ ] Postgres is not selected unless a real adapter has been implemented and
      tested.

## Relay

- [ ] Egress is restricted to approved HPC login nodes.
- [ ] Relay never accepts client-supplied host/port.
- [ ] Unauthenticated, idle, and absolute timeouts are configured.
- [ ] Per-session connection limits are configured.
- [ ] Rate limits are configured.
- [ ] Audit-safe logs are configured.
- [ ] Metrics for relay auth, active connections, bytes, and timeouts are
      configured.
- [ ] SSH payload logging is disabled.

## Remote Launcher

- [ ] Launcher is installed by a trusted site/admin.
- [ ] Signed policy command points to the fixed launcher.
- [ ] Launcher does not execute arbitrary web-provided commands.
- [ ] SLURM output contract is verified.
- [ ] Launcher does not print secrets.

## Operations

- [ ] `/healthz` and `/readyz` are monitored.
- [ ] `/metrics` is scraped through protected network/platform controls.
- [ ] Audit retention policy is defined.
- [ ] Metrics alerting is configured for readiness, relay errors, token
      rejections, and job-report rejections.
- [ ] Observability privacy review confirms logs and metrics exclude tokens,
      credentials, SSH payloads, and transcripts.
- [ ] Incident response owner is defined.
- [ ] Chrome extension distribution path is decided.
- [ ] Real-HPC pilot is completed with verified host trust and real user auth.
