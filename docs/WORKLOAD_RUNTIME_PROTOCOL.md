# Workload Runtime Protocol

## Purpose

This document defines the application-level protocol between the SLAIF server
and a worker process running inside a Slurm allocation.

This protocol is not SSH. The browser extension remains the SSH client, the
relay still forwards encrypted SSH bytes only, and the remote launcher still
runs from the login node under the authenticated HPC user before submitting a
Slurm job.

Fast diagnostics complete through Slurm stdout and structured
`slaif.payloadResult` reporting. Interactive workloads need a worker process inside the allocation to
connect outbound to SLAIF over WSS or HTTPS. The first interactive MVP payload
is `gams_chat_v1`.

Normal workload payloads must be selected by signed-policy-approved
`payloadId` values. The initial payload catalog is defined in
[PAYLOAD_CATALOG.md](PAYLOAD_CATALOG.md), and future brokers must reject
payloads that are not allowed by signed policy for the selected HPC alias.

SLAIF receives application-level prompts and responses by design for
interactive workloads. SLAIF still must not receive SSH passwords, OTPs, private
keys, decrypted SSH terminal sessions, or arbitrary shell command authority.

## Workload Token

`workloadToken` authenticates one worker process running inside one Slurm
allocation for one session, payload, and scheduler job.

Scope:

```text
slaif.workload
```

Required binding:

- scope = `slaif.workload`;
- `sessionId`;
- HPC alias;
- `payloadId`;
- `jobId` when available;
- issue time;
- expiry time;
- `maxUses`, normally 1;
- optional worker connection audience;
- optional allowed worker origin or network metadata when available.

Rules:

- `workloadToken` is not an SSH credential.
- `workloadToken` must not be printed to Slurm stdout or stderr.
- `workloadToken` must not be placed in URLs.
- `workloadToken` must not be logged.
- `workloadToken` must not be exposed in metrics.
- `workloadToken` must not be passed as a visible command-line argument if avoidable.
- Preferred token delivery into the Slurm job is a user-owned temporary file with restrictive permissions.
- Avoid world-readable files, Slurm job names, query strings, command-line arguments, and shell history.

## Worker Registration / Hello

Worker registration starts with a hello message after the WSS/HTTPS channel is
authenticated by `workloadToken`.

```json
{
  "type": "slaif.workload.hello",
  "version": 1,
  "sessionId": "sess_...",
  "hpc": "vegahpc",
  "payloadId": "gams_chat_v1",
  "jobId": "12345",
  "runtime": "vllm",
  "model": "cjvt/GaMS3-12B-Instruct"
}
```

Validation:

- token scope is `slaif.workload`;
- `sessionId` matches the token;
- HPC alias matches the token;
- `payloadId` matches the token;
- `jobId` matches the token when the token is job-bound;
- token is not expired;
- token max-use and replay rules are enforced;
- `payloadId` is allowed by signed policy once payload catalog support is added.

## Prompt Message

```json
{
  "type": "slaif.prompt",
  "version": 1,
  "sessionId": "sess_...",
  "promptId": "prompt_...",
  "messages": [
    {"role": "user", "content": "..."}
  ],
  "options": {
    "maxTokens": 1024,
    "temperature": 0.6,
    "topP": 0.9
  }
}
```

Validation:

- strict `promptId` syntax;
- strict `sessionId` syntax;
- roles are bounded to `system`, `user`, and `assistant`;
- message count is bounded;
- content size is bounded;
- `maxTokens` is bounded;
- `temperature` and `topP` are range-checked;
- protocol fields must not contain tokens, SSH credentials, or command fields.

## Response Streaming

Delta message:

```json
{
  "type": "slaif.response.delta",
  "version": 1,
  "sessionId": "sess_...",
  "promptId": "prompt_...",
  "text": "partial response text"
}
```

Final message:

```json
{
  "type": "slaif.response.done",
  "version": 1,
  "sessionId": "sess_...",
  "promptId": "prompt_...",
  "finishReason": "stop",
  "usage": {
    "inputTokens": 123,
    "outputTokens": 456
  }
}
```

Validation:

- `promptId` must match the active prompt when an active prompt is expected;
- response delta text is bounded;
- usage values are non-negative bounded integers;
- `finishReason` is from the allowed set.

## Stop / Cancel

```json
{
  "type": "slaif.workload.stop",
  "version": 1,
  "sessionId": "sess_...",
  "reason": "user_cancelled"
}
```

Allowed reasons:

- `user_cancelled`;
- `idle_timeout`;
- `max_runtime`;
- `server_shutdown`;
- `policy_violation`;
- `worker_error`.

## Error Messages

```json
{
  "type": "slaif.workload.error",
  "version": 1,
  "sessionId": "sess_...",
  "code": "invalid_prompt",
  "message": "Safe user-facing message"
}
```

Rules:

- errors must not include tokens;
- errors must not include SSH credentials;
- errors must not include raw stack traces in production;
- errors must not include raw private config.

## Future Broker

This PR does not implement the workload registry, broker, remote worker agent,
GaMS/vLLM serving, or YOLO mode. The next implementation phase should add a
workload registry and WebSocket broker that use this token scope and message
validation foundation without adding arbitrary command execution.

Maintainer real-HPC diagnostics in this repository currently exercise Slurm
discovery, CPU/GPU diagnostic jobs, and launcher dry-run behavior. Interactive
worker runtime tests, outbound worker connections, GaMS/vLLM serving, and the
broker are not part of the maintainer test kit foundation.

The remote launcher payload-intent path is the login-node precursor to this
runtime protocol. It validates `payloadId`, maps it to a site-approved Slurm
profile, and submits the job. The workload broker, remote workload agent, and
GaMS/vLLM serving remain future work.
