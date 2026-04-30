# SLAIF Remote Launcher Reference

This directory contains a safe reference implementation of the HPC-side launcher contract documented in [docs/REMOTE_LAUNCHER_CONTRACT.md](../../docs/REMOTE_LAUNCHER_CONTRACT.md).

Production policy should normally run a site-installed command like:

```text
/opt/slaif/bin/slaif-launch --session ${SESSION_ID}
```

The launcher runs on the HPC side after the user authenticates through browser-side SSH. It is site-controlled code, not code supplied by the SLAIF web page, session descriptor, or relay.

## Reference Implementation

[slaif-launch](slaif-launch) is a POSIX shell reference launcher. It:

- requires `--session <SESSION_ID>`;
- validates the same strict session ID pattern used by the extension;
- rejects unknown flags, including arbitrary command/script flags;
- accepts no SSH credentials, passwords, OTPs, private keys, launch tokens, relay tokens, or job-report tokens;
- uses test/dry-run mode to print `Submitted batch job <id>`;
- can call `sbatch "$SLAIF_SLURM_SCRIPT"` only when a site-owned absolute script path is configured.

Local test mode:

```bash
SLAIF_LAUNCHER_TEST_JOB_ID=424242 ./remote/launcher/slaif-launch --session sess_manual123
```

Dry run:

```bash
./remote/launcher/slaif-launch --dry-run --session sess_manual123
```

Real SLURM mode requires an HPC site-owned script:

```bash
SLAIF_SLURM_SCRIPT=/opt/slaif/jobs/approved-launch.sh \
  /opt/slaif/bin/slaif-launch --session sess_manual123
```

Do not install a launcher that executes arbitrary commands, accepts web-provided scripts, or stores SSH credentials.
