# Payload Catalog

## Purpose

Normal SLAIF workloads are selected by `payloadId`. A `payloadId` maps to a signed-policy-approved workload profile; it is not arbitrary command text.

The SLAIF web app may request a `payloadId`, and the session descriptor may echo the same `payloadId`, but the extension and server validate it against the signed HPC policy before launch. The remote launcher will later map the validated payload intent to a site-approved Slurm profile. YOLO mode is separate, deferred, and not implemented in this path.

## Initial MVP Payloads

The initial normal payload IDs are:

- `gpu_diagnostics_v1`
- `cpu_memory_diagnostics_v1`
- `gams_chat_v1`

## Payload Classes

Initial payload classes are:

- `fast_diagnostic`
- `interactive_llm`

`gpu_diagnostics_v1` and `cpu_memory_diagnostics_v1` are `fast_diagnostic` payloads. They may complete through Slurm stdout and structured result reporting.

`gams_chat_v1` is an `interactive_llm` payload. It uses a `workloadToken` and an outbound worker connection from inside the Slurm allocation.

## Example Signed Policy Payload Catalog

```json
{
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
  }
}
```

Each host then opts into a subset:

```json
{
  "hosts": {
    "vegahpc": {
      "allowedPayloadIds": [
        "gpu_diagnostics_v1",
        "cpu_memory_diagnostics_v1",
        "gams_chat_v1"
      ]
    }
  }
}
```

Hosts with no `allowedPayloadIds` reject workload payload launches. There is no implicit default to all payloads.

## Security Rules

- `payloadId` is allowed.
- Arbitrary command text is not allowed.
- Signed policy is authoritative for the payload catalog.
- The session descriptor cannot provide command text.
- The web launch message cannot provide command text.
- Payload definitions must not contain shell commands.
- Payload definitions must not contain job script text.
- Payload definitions must not contain SSH credentials.
- Payload definitions must not contain tokens.
- Worker nodes are not reached by SSH.
- Interactive worker connections are outbound WSS/HTTPS application protocol connections.

## Future Site-Specific Slurm Profiles

Later PRs will map payload IDs to site-approved Slurm profiles or templates.
Real values for partition, account, QoS, time, memory, GPU request syntax, max
runtime, and max output should be informed by maintainer-owned real-HPC tests
rather than guesses. See [MAINTAINER_HPC_TESTING.md](MAINTAINER_HPC_TESTING.md).

The reference payload-intent launcher path now validates session intent,
resolves `payloadId` to a site-approved Slurm profile, and renders
repository-owned templates. That mapping must remain site-approved and
policy-controlled. It must not become arbitrary command execution.

Fast diagnostics now use the `slaif.payloadResult` envelope documented in
[DIAGNOSTIC_PAYLOAD_RESULTS.md](DIAGNOSTIC_PAYLOAD_RESULTS.md). The result
schema string names the expected validated result shape; it is not script text
or a command fragment.
