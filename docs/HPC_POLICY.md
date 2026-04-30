# Signed HPC Policy

SLAIF Connect treats the HPC policy as trusted data, not executable code. The signed policy is the extension-side authority for SSH target identity and command construction.

The SLAIF web page and session descriptor must not define or override:

- SSH host or port;
- SSH host key, host CA, `known_hosts`, or `HostKeyAlias`;
- SSH options;
- remote command template or arbitrary shell command.

## Policy Envelope

Signed policies use ECDSA P-256 with SHA-256. The public trust root is bundled with the extension or generated into `build/extension/config` for local development. Private signing keys must never be committed.

```json
{
  "type": "slaif.signedHpcPolicy",
  "version": 1,
  "algorithm": "ECDSA-P256-SHA256",
  "keyId": "slaif-policy-dev-2026-04",
  "signedAt": "2026-04-30T12:00:00.000Z",
  "payload": {
    "type": "slaif.hpcPolicy",
    "version": 1,
    "policyId": "slaif-hpc-policy-dev",
    "sequence": 1,
    "validFrom": "2026-04-30T00:00:00.000Z",
    "validUntil": "2026-12-31T23:59:59.000Z",
    "allowedApiOrigins": ["https://connect.slaif.si"],
    "allowedRelayOrigins": ["wss://connect.slaif.si"],
    "hosts": {
      "vegahpc": {
        "displayName": "Vega HPC",
        "sshHost": "login.vega.example",
        "sshPort": 22,
        "hostKeyAlias": "vegahpc",
        "knownHosts": [
          "vegahpc ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA..."
        ],
        "remoteCommandTemplate": "/opt/slaif/bin/slaif-launch --session ${SESSION_ID}"
      }
    }
  },
  "signature": "base64url-signature"
}
```

## Trust Roots

Trust roots are configured separately:

```json
{
  "type": "slaif.policyTrustRoots",
  "version": 1,
  "keys": [
    {
      "keyId": "slaif-policy-dev-2026-04",
      "algorithm": "ECDSA-P256-SHA256",
      "publicKeySpkiBase64": "..."
    }
  ]
}
```

Production builds must reject unsigned policy, unknown signing keys, malformed signatures, expired policy, not-yet-valid policy, and rollback to older sequence numbers.

## Canonical Signing Input

The signed bytes are the canonical JSON representation of the policy envelope with `signature` excluded.

Canonicalization rules:

- object keys are sorted lexicographically;
- array order is preserved;
- strings, numbers, booleans, and null use `JSON.stringify` semantics;
- `undefined`, functions, dates, trailing commas, and non-finite numbers are not allowed;
- envelope metadata such as `type`, `version`, `algorithm`, `keyId`, `signedAt`, and `payload` are signed.

## Rotation Model

Host-key rotation should normally be done by publishing a new signed policy that contains both old and new host keys during an overlap window. After the HPC site finishes rotation, publish a later signed policy with a higher sequence number that removes the old key.

Host CA trust is preferred when an HPC center supports SSH host certificates. In that model, the policy pins a host CA entry instead of every login-node host key.

## Tools

```bash
npm run policy:keygen:dev
npm run policy:sign -- --payload policy.json --private-key dist/policy/key.json --key-id slaif-policy-dev-2026-04 --out signed.json
npm run policy:verify -- --policy signed.json --trust-roots trust-roots.json
```

Local development uses generated temporary signing keys and signed policy files in `build/extension/config`. That still verifies signatures and must not become a production bypass.
