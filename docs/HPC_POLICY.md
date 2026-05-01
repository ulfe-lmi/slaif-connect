# Signed HPC Policy

SLAIF Connect treats the HPC policy as trusted data, not executable code. The signed policy is the extension-side authority for SSH target identity, command construction, relay/API origins, and allowed workload payload catalog.

The SLAIF web page and session descriptor must not define or override:

- SSH host or port;
- SSH host key, host CA, `known_hosts`, or `HostKeyAlias`;
- SSH options;
- remote command template or arbitrary shell command;
- payload definitions or site workload profiles.

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
    "allowedPayloads": {
      "gpu_diagnostics_v1": {
        "type": "fast_diagnostic",
        "scheduler": "slurm",
        "requiresGpu": true,
        "maxRuntimeSeconds": 300,
        "maxOutputBytes": 65536,
        "resultSchema": "slaif.payloadResult.gpuDiagnostics.v1"
      },
      "cpu_memory_diagnostics_v1": {
        "type": "fast_diagnostic",
        "scheduler": "slurm",
        "requiresGpu": false,
        "maxRuntimeSeconds": 300,
        "maxOutputBytes": 65536,
        "resultSchema": "slaif.payloadResult.cpuMemoryDiagnostics.v1"
      },
      "gams_chat_v1": {
        "type": "interactive_llm",
        "scheduler": "slurm",
        "model": "cjvt/GaMS3-12B-Instruct",
        "runtime": "vllm",
        "requiresGpu": true,
        "requiresOutboundWorkloadConnection": true,
        "maxSessionSeconds": 3600,
        "idleTimeoutSeconds": 300,
        "maxPromptBytes": 16000,
        "maxOutputTokens": 1024
      }
    },
    "hosts": {
      "vegahpc": {
        "displayName": "Vega HPC",
        "sshHost": "login.vega.example",
        "sshPort": 22,
        "hostKeyAlias": "vegahpc",
        "knownHosts": [
          "vegahpc ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA..."
        ],
        "remoteCommandTemplate": "/opt/slaif/bin/slaif-launch --session ${SESSION_ID}",
        "allowedPayloadIds": [
          "gpu_diagnostics_v1",
          "cpu_memory_diagnostics_v1",
          "gams_chat_v1"
        ]
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

## Payload Catalog

Signed policies must include a non-empty `allowedPayloads` object. Each host must explicitly list `allowedPayloadIds`; hosts without that list reject workload payload launches. There is no implicit "all payloads" default.

For the workload MVP, valid normal payload IDs are:

- `gpu_diagnostics_v1`
- `cpu_memory_diagnostics_v1`
- `gams_chat_v1`

Each host `allowedPayloadIds` entry must reference a key in `allowedPayloads`. Payload catalog entries are bounded metadata only. They must not contain shell commands, Slurm script text, SSH credentials, tokens, endpoint URLs, or arbitrary command fragments.

See [PAYLOAD_CATALOG.md](PAYLOAD_CATALOG.md) for the catalog contract.

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

## Real-HPC Pilot Tooling

Real-HPC pilots use the same signed policy format. Pilot helper scripts live under `scripts/pilot/`:

```bash
npm run pilot:collect-host-keys
npm run pilot:verify-host-key
npm run pilot:create-policy
npm run pilot:stack
npm run test:pilot
```

`pilot:collect-host-keys` uses `ssh-keyscan` only to collect candidate `known_hosts` lines. Candidate output is not trusted until an operator compares the fingerprint against an independent source. `pilot:create-policy` converts verified pilot input into an unsigned `slaif.hpcPolicy` payload, and the existing `policy:sign` / `policy:verify` tools sign and verify it.

Pilot fixed-command mode is local/manual only and must be requested with `--pilot-fixed-command`. Production command templates should include `${SESSION_ID}`.

Production policies should normally point at the HPC-side launcher contract:

```text
/opt/slaif/bin/slaif-launch --session ${SESSION_ID}
```

or a site-approved equivalent. The web launch message and session descriptor must never provide this command, a replacement command, or a job script path.

## Job Reporting Boundary

Signed policy remains the source of truth for the command whose output is
parsed for scheduler metadata. The session descriptor may provide a
short-lived `jobReportToken`, but it must not provide `jobCommand`,
`schedulerCommand`, stdout/transcript upload URLs, or command templates.

SLURM job reporting parses bounded output from the fixed command and reports
only safe metadata such as session ID, HPC alias, scheduler, job ID, status,
SSH exit code, and timestamp. Raw stdout/stderr and terminal transcripts are
not part of the policy-driven report payload.

## Deployment Contract Boundary

Signed policy defines what the extension trusts. The production API/relay
deployment must still enforce durable token storage, distributed replay
prevention, relay egress controls, rate limits, and readiness checks as defined
in [PRODUCTION_DEPLOYMENT_CONTRACT.md](PRODUCTION_DEPLOYMENT_CONTRACT.md).
