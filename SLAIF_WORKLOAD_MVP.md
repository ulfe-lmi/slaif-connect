# SLAIF Workload MVP and YOLO Mode

This document fixes the next product direction for SLAIF Connect:

1. SLAIF Connect should support **normal site-approved workloads** launched through Slurm from the login node.
2. The MVP should include both:
   - fast diagnostic workloads, such as GPU and CPU/memory reports; and
   - an interactive ChatGPT-like GaMS workload.
3. Compute nodes must **not** be reached by SSH.
4. Worker nodes may connect outbound to the SLAIF server over HTTPS/WSS.
5. A separate **YOLO mode** may exist for demo/development arbitrary commands, but only with strong visual warnings, explicit gates, and clear separation from normal mode.

This document is intended to guide future implementation PRs. It should not be treated as a production deployment claim.

---

## 1. Fixed MVP direction

The MVP is no longer only “run a diagnostic and return a job ID.” The fixed MVP should be:

> A ChatGPT-like web interface backed by a GaMS model running as a Slurm job on an HPC worker node, plus fast scheduler-launched diagnostics for GPU and CPU/memory information.

The MVP should prove that SLAIF can orchestrate useful HPC workloads while preserving the core SLAIF Connect security model:

```text
SLAIF web app
  -> Chrome extension external launch
  -> browser-side OpenSSH/WASM
  -> SSH to HPC login node
  -> fixed signed-policy remote launcher
  -> sbatch from login node
  -> Slurm allocates worker node
  -> workload runs under the authenticated HPC user
  -> result or workload channel returns to SLAIF
```

The key promise remains:

```text
SLAIF does not receive SSH passwords, OTPs, private keys, or decrypted SSH terminal sessions.
```

For interactive workloads, a new statement is also required:

```text
SLAIF does receive application-level prompts and responses by design.
```

That is a different privacy boundary from SSH credentials and must be documented and visible to users.

---

## 2. Non-negotiable execution rule: no SSH into worker nodes

SLAIF Connect must not SSH into compute/worker nodes.

The correct execution path is Slurm:

```text
browser-side SSH session
  -> login node
  -> /opt/slaif/bin/slaif-launch --session <SESSION_ID>
  -> sbatch
  -> Slurm worker allocation
  -> payload runs on allocated worker node
```

The SLAIF server must not directly SSH into login nodes or worker nodes.

The extension must not SSH into worker nodes.

Worker nodes may connect outbound to SLAIF for interactive payloads if the HPC center allows outbound TCP/WSS or provides a dedicated proxy for that purpose.

---

## 3. Component responsibilities

### 3.1 SLAIF web/API server

The SLAIF server may provide:

- session creation;
- session intent;
- payload selection;
- launch tokens;
- relay tokens;
- job-report tokens;
- workload tokens;
- session descriptor endpoint;
- WebSocket-to-TCP SSH byte relay;
- job report endpoint;
- workload registration endpoint;
- prompt/response broker for interactive workloads;
- audit-safe metadata;
- health/readiness checks.

The SLAIF server must not provide:

- SSH passwords;
- OTPs;
- SSH private keys;
- arbitrary SSH commands in normal mode;
- raw host keys or host aliases that override signed policy;
- arbitrary shell command execution in normal mode.

### 3.2 Chrome extension

The extension is responsible for:

- receiving approved web launch messages;
- validating signed HPC policy;
- validating session descriptors;
- running browser-side OpenSSH/WASM;
- authenticating the user to the HPC login node;
- running the fixed signed-policy remote launcher command;
- reporting safe job metadata;
- never accepting arbitrary command text from the web app in normal mode.

### 3.3 Remote launcher on login node

The remote launcher is the HPC-side entry point, normally:

```bash
/opt/slaif/bin/slaif-launch --session <SESSION_ID>
```

It runs under the authenticated HPC user account.

It should:

- validate the session ID;
- obtain session intent from SLAIF or local/site config;
- map `payloadId` to a site-approved payload profile;
- submit Slurm jobs using `sbatch`;
- emit parseable scheduler output and/or structured result metadata;
- never run arbitrary web-provided commands in normal mode.

### 3.4 Worker process

For fast diagnostics, the worker process may simply run a small script and write output to Slurm stdout/stderr.

For interactive GaMS chat, the worker process should:

- start the model runtime;
- connect outbound to SLAIF over WSS/HTTPS;
- authenticate with a scoped workload token;
- wait for prompts;
- stream responses;
- exit on cancellation, idle timeout, or max runtime.

---

## 4. Normal workload classes

SLAIF should support at least two normal workload classes.

### 4.1 Fast diagnostic workloads

These are short Slurm jobs that run to completion and return bounded structured output.

Examples:

```text
gpu_diagnostics_v1
cpu_memory_diagnostics_v1
cluster_inventory_v1
```

The purpose is to prove that SLAIF can launch useful workloads on real HPC systems without exposing SSH credentials.

#### GPU diagnostics

A GPU diagnostic workload may run, inside a Slurm GPU allocation:

```bash
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
```

The exact command should be site-approved and may be wrapped by a site script.

Expected result shape:

```json
{
  "type": "slaif.payloadResult",
  "version": 1,
  "sessionId": "sess_...",
  "hpc": "vegahpc",
  "payloadId": "gpu_diagnostics_v1",
  "scheduler": "slurm",
  "jobId": "12345",
  "status": "completed",
  "result": {
    "node": "gpu-node-01",
    "gpus": [
      {
        "name": "NVIDIA A100",
        "memoryTotalMiB": 40960,
        "driverVersion": "535.x"
      }
    ]
  }
}
```

#### CPU/memory diagnostics

A CPU/memory diagnostic workload may report:

- allocated node name;
- CPU count;
- memory total;
- optional architecture summary;
- optional scheduler partition/queue.

Expected result shape:

```json
{
  "type": "slaif.payloadResult",
  "version": 1,
  "sessionId": "sess_...",
  "hpc": "arneshpc",
  "payloadId": "cpu_memory_diagnostics_v1",
  "scheduler": "slurm",
  "jobId": "12345",
  "status": "completed",
  "result": {
    "node": "cpu-node-01",
    "cpuCount": 128,
    "memoryTotalMiB": 515000
  }
}
```

#### Collection path

Fast diagnostics do not require a worker-node callback.

Recommended path:

```text
remote launcher
  -> sbatch diagnostic script
  -> get job ID
  -> wait/poll for completion if short
  -> read bounded Slurm output
  -> emit structured result through SSH stdout
  -> extension reports result to SLAIF API
```

Alternative path:

```text
remote launcher
  -> sbatch diagnostic script
  -> return job ID immediately
  -> later result retrieval through another signed-policy-approved session
```

The first path is preferred for the demo if diagnostics complete quickly.

### 4.2 Interactive GaMS chat workload

The interactive MVP payload should be:

```text
gams_chat_v1
```

Goal:

> A ChatGPT-like web UI where prompts are sent to a GaMS model running as a Slurm job on an HPC GPU worker node.

The model target is:

```text
cjvt/GaMS3-12B-Instruct
```

The GaMS model card describes GaMS3-12B-Instruct as a Gemma 3-family instruct/chat model focused on Slovene and English, with Croatian, Bosnian, and Serbian as secondary languages. It also documents Transformers and vLLM usage and lists the license as Gemma.

Recommended runtime:

```text
vLLM, with a local OpenAI-compatible server bound to localhost inside the Slurm job
```

The worker node should not expose vLLM publicly.

Recommended worker layout:

```text
Slurm job on GPU node
  -> start vLLM server bound to 127.0.0.1:<local_port>
  -> start SLAIF workload agent
  -> workload agent connects outbound to SLAIF WSS
  -> workload agent forwards prompts to local vLLM
  -> workload agent streams responses back to SLAIF
```

---

## 5. GaMS chat flow

The end-to-end GaMS chat MVP should work like this:

```text
1. User opens SLAIF web UI.
2. User selects payloadId = gams_chat_v1.
3. SLAIF server creates a session.
4. Web UI asks extension to launch the session.
5. Extension validates signed policy and session descriptor.
6. Extension SSHes to login node using browser-side OpenSSH/WASM.
7. Extension runs fixed signed-policy command:
     /opt/slaif/bin/slaif-launch --session <SESSION_ID>
8. Launcher validates session and payload intent.
9. Launcher submits Slurm job using sbatch.
10. Slurm allocates GPU node.
11. Worker starts vLLM/GaMS runtime.
12. Worker connects outbound to SLAIF with workloadToken.
13. SLAIF UI shows model state: queued -> starting -> loading -> ready.
14. User sends prompt.
15. SLAIF server forwards prompt to worker.
16. Worker streams GaMS response back.
17. User can stop/cancel session.
18. Worker exits on stop, idle timeout, or max runtime.
```

The extension does not need to keep the SSH session open for the whole chat after the job has been submitted and the worker has connected back, unless a future site-specific fallback requires that.

---

## 6. Workload runtime protocol

Interactive workloads need a new protocol layer:

```text
SLAIF Workload Runtime Protocol
```

This protocol is between:

```text
SLAIF server <-> worker process inside Slurm job
```

It is not SSH.

It does not expose SSH credentials.

### 6.1 New token: workloadToken

Add a scoped token:

```text
workloadToken
```

Purpose:

```text
Allow one Slurm worker process to register with SLAIF for one session/payload/job.
```

Suggested scope:

```text
slaif.workload
```

Suggested token binding:

```json
{
  "scope": "slaif.workload",
  "sessionId": "sess_...",
  "hpc": "vegahpc",
  "payloadId": "gams_chat_v1",
  "jobId": "12345",
  "issuedAt": "...",
  "expiresAt": "...",
  "maxUses": 1
}
```

The workload token must not be logged, placed in URLs, printed to Slurm output, or passed as a visible command-line argument if avoidable.

Preferred token delivery into the Slurm job:

```text
user-owned temporary file with restrictive permissions
```

Avoid:

```text
world-readable files
Slurm job name
stdout/stderr
query strings
command-line args visible to other users
```

### 6.2 Worker hello

After the worker connects to SLAIF WSS:

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

SLAIF validates:

- workload token;
- session ID;
- HPC alias;
- payload ID;
- job ID if already known;
- token expiry;
- token one-use semantics.

### 6.3 Prompt message

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

### 6.4 Response stream

```json
{
  "type": "slaif.response.delta",
  "version": 1,
  "sessionId": "sess_...",
  "promptId": "prompt_...",
  "text": "partial response text"
}
```

Final response:

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

### 6.5 Stop/cancel

```json
{
  "type": "slaif.workload.stop",
  "version": 1,
  "sessionId": "sess_...",
  "reason": "user_cancelled"
}
```

The worker should:

- stop current generation if possible;
- terminate vLLM runtime if session is ending;
- exit cleanly;
- allow Slurm to complete/cancel the job.

---

## 7. Payload catalog

Normal workloads should be represented by a signed-policy-approved payload catalog.

Example:

```json
{
  "allowedPayloads": {
    "gpu_diagnostics_v1": {
      "type": "fast_diagnostic",
      "scheduler": "slurm",
      "requiresGpu": true,
      "maxRuntimeSeconds": 300,
      "maxOutputBytes": 65536,
      "resultSchema": "slaif.gpuDiagnosticsResult.v1"
    },
    "cpu_memory_diagnostics_v1": {
      "type": "fast_diagnostic",
      "scheduler": "slurm",
      "requiresGpu": false,
      "maxRuntimeSeconds": 300,
      "maxOutputBytes": 65536,
      "resultSchema": "slaif.cpuMemoryDiagnosticsResult.v1"
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

Important rule:

```text
Payload ID is allowed.
Arbitrary command is not.
```

---

## 8. Slurm templates

Each normal payload should map to a site-approved Slurm script or template.

### 8.1 GPU diagnostics template

Conceptual Slurm script:

```bash
#!/usr/bin/env bash
#SBATCH --job-name=slaif-gpu-diagnostics
#SBATCH --gres=gpu:1
#SBATCH --time=00:05:00
#SBATCH --output=slurm-%j.out

set -euo pipefail

hostname
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
```

Actual partition, account, QoS, modules, and GPU flags are site-specific.

### 8.2 CPU/memory diagnostics template

Conceptual Slurm script:

```bash
#!/usr/bin/env bash
#SBATCH --job-name=slaif-cpu-memory-diagnostics
#SBATCH --time=00:05:00
#SBATCH --output=slurm-%j.out

set -euo pipefail

hostname
nproc
free -m
```

Site-specific commands may replace these.

### 8.3 GaMS chat template

Conceptual Slurm script:

```bash
#!/usr/bin/env bash
#SBATCH --job-name=slaif-gams-chat
#SBATCH --gres=gpu:1
#SBATCH --time=01:00:00
#SBATCH --output=slurm-%j.out

set -euo pipefail

# Site-specific setup:
# module load ...
# source ...
# container runtime ...

# Start vLLM bound to localhost only.
vllm serve /path/to/GaMS3-12B-Instruct \
  --host 127.0.0.1 \
  --port 8000 \
  --dtype auto \
  --api-key "$SLAIF_LOCAL_VLLM_TOKEN" &

VLLM_PID=$!

# Wait for vLLM readiness here.

slaif-workload-agent \
  --session "$SLAIF_SESSION_ID" \
  --payload gams_chat_v1 \
  --workload-token-file "$SLAIF_WORKLOAD_TOKEN_FILE" \
  --local-openai-base http://127.0.0.1:8000/v1

kill "$VLLM_PID" || true
```

This script is conceptual. Real deployment must adapt to the HPC software environment.

---

## 9. GaMS runtime notes

The target model is:

```text
cjvt/GaMS3-12B-Instruct
```

The model card states:

- GaMS3-12B-Instruct is based on Google's Gemma 3 family;
- primary languages include Slovene and English;
- secondary languages include Croatian, Bosnian, and Serbian;
- the license is Gemma;
- examples are provided for Transformers and vLLM;
- the model is described as usable through vLLM because Gemma 3 architecture is supported there.

For MVP serving, prefer vLLM where the HPC environment can support it.

Do not require each Slurm job to download model weights from Hugging Face. Prefer:

- site-approved model cache;
- shared filesystem model path;
- prebuilt container image;
- local mirror;
- HPC-approved artifact staging.

---

## 10. YOLO mode

YOLO mode is a development/demo mode for arbitrary commands.

It exists because demos and debugging sometimes require quick command experiments.

It is also dangerous.

The normal product must not depend on YOLO mode.

### 10.1 Definition

YOLO mode means:

> A user intentionally asks SLAIF to run arbitrary command text under the user's own authenticated HPC account through the SLAIF launcher path.

YOLO mode must never be confused with normal mode.

Normal mode:

```text
payloadId -> signed policy -> site-approved Slurm template
```

YOLO mode:

```text
user-confirmed arbitrary command -> development-only Slurm wrapper -> runs as user's HPC account
```

### 10.2 Why this is a thin line

A user can already log in to an HPC account and run destructive commands manually.

However, a web application that helps run arbitrary commands changes the risk:

- the user may not understand which account/environment is affected;
- the server or UI could accidentally pre-fill a dangerous command;
- an XSS or compromised web page could try to trigger command execution;
- commands may be logged or stored accidentally;
- HPC admins may view this as an arbitrary remote-command facility;
- normal users may confuse YOLO mode with approved safe workloads.

Therefore YOLO mode must be intentionally inconvenient and visibly separate.

### 10.3 YOLO mode policy gates

YOLO mode must require multiple independent gates.

Required gates:

1. Build or runtime feature flag:

   ```text
   SLAIF_ENABLE_YOLO_MODE=1
   ```

2. Server environment must be non-production:

   ```text
   SLAIF_ENV=development
   ```

   or an explicitly named:

   ```text
   SLAIF_ENV=single-instance-pilot
   ```

3. Signed HPC policy must explicitly allow YOLO mode:

   ```json
   {
     "allowYoloMode": true,
     "yoloModeLabel": "DEVELOPMENT ONLY",
     "yoloMaxRuntimeSeconds": 300,
     "yoloMaxOutputBytes": 65536
   }
   ```

4. User must explicitly enable YOLO mode in the UI.

5. User must type an acknowledgement phrase, for example:

   ```text
   I UNDERSTAND THIS RUNS AS MY HPC USER
   ```

6. The extension must display the command before execution.

7. No hidden/autostart YOLO command is allowed.

8. YOLO mode must be disabled by default.

9. YOLO mode must be impossible in production configuration.

### 10.4 YOLO mode UI requirements

The UI must show a strong warning before execution.

Minimum warning text:

```text
⚠️ YOLO DEVELOPMENT MODE ⚠️

This is not a normal SLAIF workload.
This command will run under your authenticated HPC user account.
It may read, modify, or delete files that your HPC account can access.
SLAIF cannot make this command safe.
Use this only for development/testing and only if you understand the command.
```

The UI must:

- use a separate route or page;
- use red warning styling;
- show the HPC alias;
- show the SSH user if known;
- show the command exactly as it will be submitted;
- require manual confirmation;
- prevent accidental Enter-key submission;
- disallow command execution from URL parameters;
- disallow hidden commands;
- record audit metadata without recording secrets.

### 10.5 YOLO command source

Preferred safest form:

```text
The user types the command directly in the extension UI.
```

Acceptable demo form with more risk:

```text
The SLAIF server suggests a command, but the extension displays it and requires explicit user confirmation.
```

Forbidden:

```text
The SLAIF server silently supplies a command and the extension runs it automatically.
```

YOLO mode should not run from a normal session descriptor without an explicit YOLO session type.

### 10.6 YOLO execution path

Even in YOLO mode, avoid running arbitrary commands directly on the login node.

Preferred path:

```text
extension SSH -> login node -> remote launcher -> sbatch -> worker allocation -> command runs in Slurm job
```

The launcher can create a temporary Slurm script in a user-owned directory with restrictive permissions, submit it with `sbatch`, and bound output.

Rules:

- no sudo;
- no privilege escalation;
- no SSH into worker nodes;
- no direct execution on login node except minimal validation/submission;
- command runs as authenticated HPC user;
- output size is bounded;
- runtime is bounded;
- job resources are bounded by signed policy;
- output is treated as untrusted text.

### 10.7 YOLO audit events

Record audit-safe events:

```text
yolo_mode_enabled
yolo_command_confirmed
yolo_sbatch_submitted
yolo_job_reported
yolo_command_rejected
yolo_mode_disabled
```

Do not log:

- SSH password;
- OTP;
- private key;
- full command if policy decides command text is sensitive;
- large output;
- tokens.

If command text is logged for audit, this must be clearly documented and visible to the user.

### 10.8 YOLO mode must not poison normal mode

YOLO mode must not weaken normal-mode invariants.

Normal mode must continue to enforce:

- signed policy;
- fixed remote launcher;
- payload catalog;
- no arbitrary commands;
- host-key verification;
- scoped tokens;
- bounded reports;
- no transcript upload by default.

YOLO mode should be easy to remove from builds.

---

## 11. Implementation roadmap

Recommended PR order:

1. Add this workload MVP specification and AGENTS.md support.
2. Add workload token scope and workload runtime protocol docs/tests.
3. Add server workload registry and WebSocket broker.
4. Add remote workload agent skeleton.
5. Add fast diagnostic payload profiles and tests.
6. Add GaMS chat payload profile and mock worker tests.
7. Add browser E2E for ChatGPT-like GaMS flow using a fake/local model server.
8. Add site-specific real-HPC pilot scaffold for Vega/Arnes.
9. Add YOLO mode only after normal payload catalog and warnings are in place.

YOLO mode should not be implemented before the normal payload path is stable.

---

## 12. MVP acceptance criteria

### 12.1 Fast diagnostics

The demo succeeds when:

- user launches `gpu_diagnostics_v1` or `cpu_memory_diagnostics_v1`;
- extension authenticates user to login node;
- launcher submits Slurm job;
- job runs on worker allocation;
- no SSH into worker nodes occurs;
- structured result is returned;
- result is shown in SLAIF web UI;
- no SSH credentials reach SLAIF server.

### 12.2 GaMS chat

The demo succeeds when:

- user launches `gams_chat_v1`;
- extension authenticates user to login node;
- launcher submits Slurm GPU job;
- worker starts GaMS runtime;
- worker connects outbound to SLAIF server;
- SLAIF UI shows model ready;
- user sends prompt;
- GaMS response streams back;
- user can stop/cancel;
- job exits cleanly or times out;
- no SSH credentials reach SLAIF server.

### 12.3 YOLO mode

YOLO mode is acceptable only when:

- it is disabled by default;
- it is impossible in normal production configuration;
- it requires signed-policy approval;
- it requires explicit user acknowledgement;
- it runs through Slurm rather than SSH fan-out;
- it clearly warns that commands run as the user's HPC account;
- it does not weaken normal mode;
- it is tested separately from normal payloads.

---

## 13. References

- GaMS3-12B-Instruct model card: https://huggingface.co/cjvt/GaMS3-12B-Instruct
- vLLM OpenAI-compatible server docs: https://docs.vllm.ai/en/latest/serving/openai_compatible_server/
- Slurm sbatch documentation: https://slurm.schedmd.com/sbatch.html
- Example HPC guidance that compute nodes are addressed through Slurm rather than direct access: https://compendium.hpc.tu-dresden.de/jobs_and_resources/slurm/
