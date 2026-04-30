# SLAIF Job Reporting

SLAIF Connect reports scheduler metadata, not terminal transcripts.

## Purpose

The fixed remote launcher path connects browser-side SSH execution to SLAIF job tracking. After the user authenticates directly to the HPC `sshd`, the extension runs one signed-policy-approved command and reports safe metadata back to the SLAIF API.

The extension may report:

- `sessionId`;
- HPC alias;
- scheduler type;
- scheduler job ID;
- command completion status;
- SSH exit code, when available;
- `reportedAt` timestamp.

The extension must not report:

- SSH password, OTP, private key, or passphrase;
- raw terminal transcript by default;
- arbitrary stdout or stderr;
- arbitrary shell command;
- unvalidated user-supplied parameters.

## Architecture

```text
signed policy remoteCommandTemplate
  -> extension validates sessionId
  -> extension substitutes ${SESSION_ID}
  -> browser-side OpenSSH/WASM runs fixed command
  -> extension captures bounded output for parsing
  -> extension parses scheduler job ID
  -> extension POSTs safe metadata to SLAIF API
```

The captured output is used locally for parsing and UI diagnostics. It is not uploaded as the job report payload.

## Remote Command Source Of Truth

The signed HPC policy is authoritative for `remoteCommandTemplate`.

The preferred production command is the remote launcher contract:

```text
/opt/slaif/bin/slaif-launch --session ${SESSION_ID}
```

That launcher runs under the authenticated HPC user account, submits a site-approved workload, and emits parseable scheduler output. See [REMOTE_LAUNCHER_CONTRACT.md](REMOTE_LAUNCHER_CONTRACT.md).

The following components must not provide or override the remote command:

- SLAIF web launch message;
- session descriptor;
- relay;
- user-facing launcher UI.

The web launch message provides an HPC alias and session ID. The session descriptor provides relay and reporting tokens. Neither is allowed to provide `command`, `remoteCommand`, `jobCommand`, `schedulerCommand`, or equivalent fields.

Future interactive or administrator modes, if any, must be separate from this launcher path and must receive explicit security review.

## Initial Scheduler Support

Initial support is SLURM.

Accepted canonical output:

```text
Submitted batch job 12345
```

The parser also accepts:

```text
sbatch: Submitted batch job 12345
```

The job ID must be a numeric string. Output containing multiple different SLURM job IDs is rejected as ambiguous. Repeated identical job IDs are accepted.

The remote launcher should avoid printing multiple submission lines and must not print secrets. A real SLURM launcher should call a site-approved `sbatch` wrapper or script using argv-safe invocation, not untrusted shell string construction.

## Job Report API

Suggested endpoint:

```text
POST <apiBaseUrl>/api/connect/session/<sessionId>/job-report
Authorization: Bearer <jobReportToken>
```

Success payload:

```json
{
  "type": "slaif.jobReport",
  "version": 1,
  "sessionId": "sess_abcdefgh",
  "hpc": "vegahpc",
  "scheduler": "slurm",
  "jobId": "12345",
  "status": "submitted",
  "sshExitCode": 0,
  "reportedAt": "2026-04-30T12:00:00.000Z"
}
```

Failure/no-job-ID payload:

```json
{
  "type": "slaif.jobReport",
  "version": 1,
  "sessionId": "sess_abcdefgh",
  "hpc": "vegahpc",
  "status": "job_id_not_found",
  "sshExitCode": 0,
  "reportedAt": "2026-04-30T12:00:00.000Z"
}
```

Rules:

- `jobReportToken` is not an SSH credential.
- `jobReportToken` must be short-lived and session-bound.
- `jobReportToken` has scope `slaif.jobReport`.
- `jobReportToken` is one-use by default for the final accepted report.
- `jobReportToken` must not be logged.
- `jobReportToken` must not be placed in query strings.
- The report endpoint is derived from trusted API base and session ID.
- The API origin must be allowed by signed policy `allowedApiOrigins`.
- Raw stdout, stderr, and terminal transcripts are not reported by default.
- Debug excerpts, if ever added, need separate review, strict bounds, and redaction.

## Local Validation

The browser job-reporting E2E test starts the local signed-policy dev stack, mounts the reference launcher into the test sshd container, runs browser-side OpenSSH/WASM through the relay, observes real remote output, parses:

```text
Submitted batch job 424242
```

and verifies the mock SLAIF API receives exactly one metadata report without stdout, stderr, transcript, tokens, passwords, OTPs, or private keys.

The token lifecycle browser test also verifies that a consumed job-report token
cannot be replayed for a second accepted report.

Run:

```bash
npm run test:jobs
npm run test:browser:job-reporting
```
