# SLAIF Remote Launcher Contract

The signed HPC policy normally runs:

```text
/opt/slaif/bin/slaif-launch --session ${SESSION_ID}
```

This document defines the production contract for that command.

## Purpose

The launcher is the HPC-side bridge between an authenticated user SSH session and the site-approved scheduler submission flow.

It should:

- run under the authenticated HPC user account;
- receive only a validated SLAIF session ID;
- submit or start a site-approved workload;
- emit scheduler output that SLAIF Connect can parse;
- avoid receiving SSH credentials;
- avoid accepting arbitrary shell commands from the browser, web app, descriptor, or relay.

The launcher is not an SSH client. It runs after the browser-side SSH client authenticates to the real HPC `sshd`.

The launcher contract is evolving from "submit a fixed test command and print a
SLURM job ID" toward the normal SLAIF workload path:

```text
sessionId -> session intent -> payloadId -> site-approved Slurm profile -> sbatch
```

That evolution is documented in [../SLAIF_WORKLOAD_MVP.md](../SLAIF_WORKLOAD_MVP.md)
and [PAYLOAD_CATALOG.md](PAYLOAD_CATALOG.md).
It is not permission to accept arbitrary commands. Payload intent must resolve
to a signed-policy-approved payload ID and site-approved profile, and worker
nodes must be reached through Slurm allocation rather than SSH.

The payload-intent foundation is now defined in
[REMOTE_LAUNCHER_PAYLOAD_INTENT.md](REMOTE_LAUNCHER_PAYLOAD_INTENT.md). The
reference launcher can validate local/test intent and profile files with
`--intent-file` and `--profile-file`, render repository-owned Slurm templates,
and submit through `sbatch`. The local browser dev stack exercises this path
with signed-policy fixed paths and a fake `sbatch`; the normal web launch and
session descriptor still do not carry command text or script text.

## Invocation Contract

Minimum stable CLI:

```bash
slaif-launch --session <SESSION_ID>
```

Optional safe flags:

```text
--api-base <URL>
--scheduler slurm
--intent-file <PATH>
--profile-file <PATH>
--work-dir <PATH>
--dry-run
--verbose
--version
--help
--wait-result
--result-timeout-seconds <N>
--max-output-bytes <N>
```

Rules:

- `--session` is required.
- The session ID must match the extension's strict session ID pattern: `sess_[A-Za-z0-9_-]{8,128}`.
- No arbitrary command argument is allowed.
- No arbitrary job script path from untrusted input is allowed.
- No shell evaluation of the session ID is allowed.
- No SSH credentials are accepted as CLI arguments.
- No tokens or passwords should be passed on the command line in production unless a later security review approves it.
- `--intent-file` and `--profile-file` are local/test/maintainer integration
  inputs and must contain safe JSON only.
- `--wait-result` is for fast diagnostic payloads. It must wait only for a
  bounded time and read only launcher-generated Slurm output under the work
  directory.

## Environment Contract

The reference launcher supports these non-secret environment variables:

```text
SLAIF_API_BASE
SLAIF_LAUNCHER_MODE
SLAIF_SCHEDULER
SLAIF_SLURM_SCRIPT
SLAIF_LAUNCHER_TEST_JOB_ID
```

Rules:

- Environment variables must not contain SSH passwords, OTPs, passphrases, or private keys.
- Sensitive API tokens, if ever needed, require a separate design review.
- The first contract version should work without extension-provided secrets.

## Output Contract

For SLURM success, stdout must include exactly one canonical scheduler submission line:

```text
Submitted batch job 12345
```

The launcher may print additional non-secret informational lines, but should avoid unnecessary output.
For fast diagnostics it may also print one framed `slaif.payloadResult` block
after the scheduler submission line. The block format is defined in
[DIAGNOSTIC_PAYLOAD_RESULTS.md](DIAGNOSTIC_PAYLOAD_RESULTS.md).

Rules:

- stdout must not contain secrets;
- stderr may contain diagnostic errors but must not contain secrets;
- if multiple different SLURM job IDs are printed, the extension parser rejects the output as ambiguous;
- the launcher should prefer one clear submission line.

## Exit-Code Contract

Expected exit codes:

| Code | Meaning |
| --- | --- |
| `0` | success; scheduler job submitted |
| `1` | general launcher failure |
| `2` | invalid arguments |
| `3` | invalid session ID |
| `4` | configuration error |
| `5` | scheduler submission failed |
| `6` | SLAIF API/spec lookup failed, if implemented later |
| `7` | permission or environment error |

## Scheduler Contract

Initial scheduler support is SLURM.

Production launcher deployments may call:

```bash
sbatch <site-approved-script>
```

or a site-specific wrapper.

Rules:

- The job script path must be site-approved.
- Job parameters must be validated.
- User-provided untrusted text must not be interpolated into shell commands.
- Prefer direct `exec`/argv-style invocation over shell string construction.
- If a shell is unavoidable, all arguments must be quoted safely and reviewed.

## SLAIF Job Spec Contract

For now, the launcher may use only the session ID and local/site configuration.
The next contract step is to resolve the session to a bounded workload intent
that includes a signed-policy-approved `payloadId`, initially
`gpu_diagnostics_v1`, `cpu_memory_diagnostics_v1`, or `gams_chat_v1`.

For interactive payloads, the launcher or SLAIF API may arrange delivery of a
`workloadToken` into the Slurm job so the worker process can connect outbound to
SLAIF using the workload runtime protocol. That token must be scoped
`slaif.workload`, bound to `sessionId`, HPC alias, `payloadId`, and `jobId` when
available, and delivered through a restrictive mechanism such as a user-owned
temporary file. It must not be printed to Slurm stdout/stderr, placed in URLs,
written to world-readable files, or used as permission for arbitrary commands.

The intended future mapping remains:

```text
sessionId -> session intent -> payloadId -> site-approved Slurm profile -> sbatch
```

If a future launcher fetches a job spec from the SLAIF API:

- it must authenticate using a site-approved mechanism;
- it must validate returned job specs;
- it must not blindly execute commands from the API;
- it must restrict execution to signed-policy-approved payload IDs and
  site-approved Slurm templates;
- this repository must add a separate reviewed contract before enabling that behavior.

## Security Invariants

- No arbitrary command execution.
- No SSH credential handling.
- No password, OTP, passphrase, or private-key storage.
- No terminal transcript upload.
- No untrusted shell interpolation.
- No accepting job scripts from the web launch message or session descriptor.
- No trusting unsigned policy.
- No bypassing host-key verification.
- No server-side SSH client.

## Deployment Guidance

Real deployment is site-specific. A typical production installation path is:

```text
/opt/slaif/bin/slaif-launch
```

Recommended ownership and permissions:

- owned by a trusted site administrator or deployment account;
- writable only by trusted administrators;
- readable and executable by authorized users;
- logs configured according to HPC site policy.

The first pilot should use a harmless command before deploying real `sbatch` behavior. A site can then configure a fixed, site-approved SLURM script or wrapper and verify that the launcher prints exactly one parseable submission line.

Before site installation under a production path, maintainers can test the
reference launcher from their own home directory with the maintainer HPC test
kit. The dry-run phase uploads the reference launcher under the configured
`remoteBaseDir`, runs it with a safe `sess_maintainer_test_*` session ID, and
checks for the canonical `Submitted batch job <id>` line. This is a manual
homedir test only; it is not a claim that the site production launcher has been
installed or validated.

The maintainer kit also has a `launcher-intent` phase that uploads the
reference launcher, repository-owned templates, and generated intent/profile
files under the configured home-directory test path. Dry-run is the default;
real `sbatch` submission requires explicit maintainer config.
