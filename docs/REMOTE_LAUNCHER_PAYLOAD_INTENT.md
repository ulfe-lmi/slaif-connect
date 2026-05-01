# Remote Launcher Payload Intent

## Purpose

The remote launcher still receives only `sessionId` as the stable signed-policy
command argument:

```text
/opt/slaif/bin/slaif-launch --session sess_...
```

The launcher resolves session intent for that session, validates the
`payloadId`, maps it to a site-approved Slurm profile, submits with `sbatch`,
and emits parseable scheduler output. Normal mode never accepts arbitrary
command text from the web app, descriptor, relay, or user UI.

## Normal Flow

1. The extension SSHes to the login node.
2. The extension runs the fixed signed-policy command.
3. The launcher validates `sessionId`.
4. The launcher obtains session intent. This PR supports local/test
   `--intent-file`; production API fetching is future work.
5. The launcher validates `payloadId`.
6. The launcher resolves a site-approved Slurm profile.
7. The launcher writes a bounded Slurm script from a repository-owned template.
8. The launcher submits with `sbatch`.
9. The launcher emits `Submitted batch job 12345`.
10. Fast diagnostics may wait briefly, read bounded generated Slurm output, and
    emit structured payload results.
11. Interactive payload workers later connect outbound with `workloadToken`.

## Session Intent

```json
{
  "type": "slaif.sessionIntent",
  "version": 1,
  "sessionId": "sess_example123",
  "hpc": "vegahpc",
  "payloadId": "gpu_diagnostics_v1",
  "createdAt": "2026-05-01T12:00:00.000Z",
  "expiresAt": "2026-05-01T12:15:00.000Z",
  "launcher": {
    "mode": "normal"
  }
}
```

Session intent must not contain command text, shell script text, SSH
credentials, tokens, host keys, host aliases, SSH target overrides, or relay
target overrides. It references `payloadId`; it does not define how to run it as
shell code.

## Slurm Profile

```json
{
  "profileId": "gpu_diagnostics_v1_default",
  "payloadId": "gpu_diagnostics_v1",
  "scheduler": "slurm",
  "jobName": "slaif-gpu-diag",
  "timeLimit": "00:05:00",
  "cpusPerTask": 1,
  "memory": "1G",
  "partition": "",
  "account": "",
  "qos": "",
  "gres": "gpu:1",
  "gpus": 1,
  "maxOutputBytes": 65536,
  "template": "gpu_diagnostics_v1"
}
```

Profiles are site-approved resource metadata. They may include bounded
scheduler hints such as partition, account, QoS, time, memory, CPU, GPU, and
output limits. They must not contain arbitrary shell commands, Slurm script
text, SSH credentials, or tokens.

## Initial Mapping

| payloadId | Slurm profile |
| --- | --- |
| `cpu_memory_diagnostics_v1` | CPU/memory diagnostic profile and template |
| `gpu_diagnostics_v1` | GPU diagnostic profile and template |
| `gams_chat_v1` | Interactive LLM scaffold profile and template |

The `gams_chat_v1` template is a scaffold only. It does not start GaMS, vLLM,
or a workload broker.

## YOLO Separation

YOLO mode is not part of normal session intent. It must not be enabled by the
signed payload catalog, web launch, session descriptor, extension UI, or normal
launcher product path. Maintainer test-kit YOLO remains separate and explicitly
gated.

## Real HPC Mapping

Vega, Arnes, and NSC real profile values must come from maintainer-owned
testing and site approval: partition names from `sinfo`, account/QoS from site
config, GPU resource syntax from site testing, verified host keys from
out-of-band verification, and remote work directories under the user home.

This PR adds a local/mock reference path and maintainer dry-run alignment. It
does not claim live real-HPC validation.

The diagnostic result path is documented in
[DIAGNOSTIC_PAYLOAD_RESULTS.md](DIAGNOSTIC_PAYLOAD_RESULTS.md). It uses the
same payload-intent mapping and repository-owned templates; it only adds a
bounded `slaif.payloadResult` block for fast diagnostics.
