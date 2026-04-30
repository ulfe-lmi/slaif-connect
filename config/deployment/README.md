# Deployment Configuration Examples

These files are examples for validating the SLAIF API/relay deployment contract.
They are not production secrets and they are not complete deployment manifests.

- `development.example.json` is suitable for local reference servers.
- `production.example.json` shows the required production shape with HTTPS/WSS,
  durable token-store mode, external rate limiting, audit logging, signed policy,
  and relay allowlist paths.

Local runtime configuration must use ignored files such as:

```text
config/deployment/development.local.json
config/deployment/production.secret.json
config/deployment/local.env
```

Do not commit real token-store URLs containing credentials, production secrets,
private signing keys, or local runtime configuration.
