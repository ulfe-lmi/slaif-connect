# Diagnostic Payload Results

## Purpose

Fast diagnostics are short Slurm jobs launched through the normal SLAIF Connect
path: browser-side SSH authenticates to the login node, the fixed signed-policy
launcher resolves `sessionId` to `payloadId`, and Slurm allocates the worker
node. They do not require the future workload broker or a long-running worker
callback.

For the MVP, diagnostics return bounded structured results through launcher
stdout. The extension parses only the framed JSON result, validates it, and
POSTs safe metadata/result JSON to the SLAIF API. Raw stdout, stderr, and
terminal transcript upload remain forbidden by default.

## Supported MVP Diagnostic Payloads

- `cpu_memory_diagnostics_v1`
- `gpu_diagnostics_v1`

`gams_chat_v1` is not a fast diagnostic result payload in this path.

## Result Envelope

```json
{
  "type": "slaif.payloadResult",
  "version": 1,
  "sessionId": "sess_example123",
  "hpc": "vegahpc",
  "payloadId": "cpu_memory_diagnostics_v1",
  "scheduler": "slurm",
  "jobId": "12345",
  "status": "completed",
  "result": {}
}
```

Allowed MVP status values:

- `completed`
- `failed`
- `no_gpu_detected`
- `timeout`
- `parse_error`

## CPU Result Shape

```json
{
  "node": "cpu-node-01",
  "cpuCount": 128,
  "memoryTotalMiB": 515000,
  "architecture": "x86_64",
  "slurmPartition": "optional"
}
```

`node` is a bounded string. `cpuCount` is a positive integer.
`memoryTotalMiB` is a positive integer when available. `architecture` and
`slurmPartition` are optional bounded strings. The result must not include
secrets, raw transcripts, stdout, or stderr.

## GPU Result Shape

```json
{
  "node": "gpu-node-01",
  "gpus": [
    {
      "name": "NVIDIA A100",
      "memoryTotalMiB": 40960,
      "driverVersion": "535.x"
    }
  ]
}
```

No-GPU result:

```json
{
  "node": "node-01",
  "gpus": [],
  "gpuAvailable": false,
  "reason": "nvidia-smi not available"
}
```

GPU diagnostics must gracefully handle missing `nvidia-smi`. Local CI and local
browser tests do not require GPUs; a structured `no_gpu_detected` result is
acceptable and does not prove real GPU validation.

## Result Framing In Launcher Stdout

```text
SLAIF_PAYLOAD_RESULT_BEGIN
{ ... one JSON object ... }
SLAIF_PAYLOAD_RESULT_END
```

Rules:

- parse JSON only between the exact markers;
- reject missing markers, malformed JSON, oversized output, and oversized JSON;
- reject multiple result blocks;
- ignore arbitrary JSON outside markers;
- reject forbidden fields such as tokens, credentials, command/script text,
  stdout, stderr, transcript, and raw output;
- never upload raw stdout/stderr/transcript as a payload result.

## Reporting API

Preferred endpoint:

```text
POST <apiBaseUrl>/api/connect/session/<sessionId>/payload-result
Authorization: Bearer <jobReportToken>
```

For the current MVP, `jobReportToken` authorizes safe scheduler and payload
result reporting. It remains a short-lived reporting token, not an SSH
credential. Tokens are sent only in the `Authorization` header, never in URLs or
metric labels, and token values must not be logged.

The report payload is the validated `slaif.payloadResult` object plus
`reportedAt`. It must not include launch, relay, job-report, workload, SSH, or
credential tokens, and it must not include arbitrary command text.

## Local Validation

The local/mock path uses the repository-owned diagnostic templates, a fake
`sbatch`, bounded generated Slurm output, the extension parser, and the mock
SLAIF API. Browser E2E runs through the real local OpenSSH/WASM relay path and
verifies the mock API receives exactly one structured payload result.

Real Vega, Arnes, or NSC validation remains manual maintainer work with
verified host keys and site-specific Slurm account/partition/GPU settings.
