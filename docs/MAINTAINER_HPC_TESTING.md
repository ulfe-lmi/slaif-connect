# Maintainer Real-HPC Testing

## Purpose

This is a maintainer-owned/manual testing path for real HPC systems. It exists to stop future implementation work from relying on guessed login-node behavior, guessed Slurm profiles, or unverified host-key material.

The path supports:

- Vega HPC;
- Arnes HPC;
- NSC;
- CPU diagnostics;
- GPU diagnostics where available;
- home-directory installation of a test kit;
- optional maintainer-only YOLO mode;
- collection of evidence/results for future MVP payload profiles and signed policies.

This is not CI, not production deployment, and not normal SLAIF Connect product behavior. The agent should not run these tests without real credentials, verified host keys, and user/account-specific Slurm configuration.

## Systems And Known Login Nodes

| System | Known login nodes | Notes |
| --- | --- | --- |
| Vega | `login.vega.izum.si`, `logincpu.vega.izum.si`, `logingpu.vega.izum.si` | SSH key access; use `logingpu` for GPU-oriented login if appropriate. |
| Arnes | `hpc-login.arnes.si`; `hpc-login3.arnes.si` / `hpc-login4.arnes.si` for general-purpose 2FA+SSH-key login; `hpc-login1.arnes.si` for workshop/training contexts | 2FA; do not assume the workshop node for production-style tests. |
| NSC | `nsc-login.ijs.si` | Discover partitions dynamically; older examples mention `gridlong`, but do not hardcode it as universally correct. |

Source notes:

- <https://doc.sling.si/en/navodila/clusters/>
- <https://doc.sling.si/en/workshops/supercomputing-essentials/01-intro/02-supercomputer/>
- <https://www.sling.si/en/arnes-hpc-cluster/>
- <https://doc.sling.si/en/workshops/supercomputing-essentials/02-slurm/01-tools/>
- <https://doc.vega.izum.si/login/>
- <https://doc.vega.izum.si/cluster-access/>
- <https://doc.vega.izum.si/sub-job/>
- <https://doc.vega.izum.si/slurm-partitions/>
- <https://www-old.sling.si/sling/en/vec/dogodki/vzd1-sling/>
- <https://www.ijs.si/ijsw/nsc>

## Required Maintainer Inputs

The maintainer must provide:

- local SSH username for each system;
- chosen login hostname;
- verified host-key or host-CA information;
- Slurm account/project if required;
- CPU partition/QoS if required;
- GPU partition/QoS/GRES if required;
- whether 2FA is required;
- preferred SSH key path, if not default;
- time/memory limits for tests;
- whether GPU tests should be attempted.

Do not write passwords, OTPs, passphrases, private keys, or token values into config files.

## Host-Key Verification

`ssh-keyscan` may collect candidate host keys. `ssh-keyscan` output is not proof of authenticity. The maintainer must verify fingerprints out of band before using them in signed policy, browser-side tests, or maintainer real-HPC runs.

Acceptable verification channels include:

- official HPC documentation;
- admin-provided fingerprint;
- host CA from the HPC center;
- DNS SSHFP with DNSSEC if trusted by the deployment;
- direct confirmation from site support.

The test kit may collect candidate keys and print fingerprints, but it labels them as unverified.

## Home-Directory Testing Model

All remote test files should live under:

```text
~/.slaif-connect/hpc-tests/
```

or a maintainer-provided directory that is still under the user account. The scripts must not require root, must not install system-wide packages, and must not write outside the chosen test directory except for normal Slurm output paths configured under that directory. Cleanup should be safe and scoped to the chosen test directory.

## Test Phases

1. Local config creation.
2. Host-key candidate collection.
3. SSH login check using verified known-host data.
4. Remote test-kit upload/install into the home directory.
5. Slurm discovery.
6. CPU diagnostic `sbatch`.
7. GPU diagnostic `sbatch` if available.
8. Structured CPU/GPU payload result JSON when completion waiting is enabled.
9. Remote launcher dry-run from the user home directory.
10. Remote launcher payload-intent dry-run from the user home directory.
11. Optional launcher payload-intent `sbatch`, only when the maintainer config explicitly enables it.
12. Maintainer-only YOLO test, explicitly gated.
13. Collect result bundle.
14. Convert findings into pilot config, signed policy inputs, or future MVP payload profiles.

The CPU/GPU phases emit `SLAIF_PAYLOAD_RESULT_BEGIN` /
`SLAIF_PAYLOAD_RESULT_END` markers where practical and may collect
`cpu_payload_result.json` or `gpu_payload_result.json` into the maintainer
result bundle. Raw Slurm output remains a maintainer-owned local artifact and
is not the normal SLAIF API payload.

## YOLO Mode Warning

YOLO mode is maintainer-only/manual. It allows a maintainer to run an arbitrary command from their own account for debugging. It requires explicit gates:

```text
--allow-yolo
--i-understand-this-runs-arbitrary-code
SLAIF_ALLOW_YOLO=1
SLAIF_I_UNDERSTAND_THIS_RUNS_ARBITRARY_CODE=1
```

YOLO must never be exposed through normal web launch, session descriptor, extension UI, signed normal payload catalog, or product remote launcher flows. It must not be enabled by default and must not substitute for the payloadId-based normal mode.

## What Maintainers Should Provide After Testing

Copy these non-secret artifacts into an issue/PR or private report:

- system name;
- login hostname used;
- verified host-key fingerprint and verification source;
- username redacted or included only if desired;
- Slurm version;
- `sinfo` summary;
- `scontrol` partition summary if collected;
- `sacctmgr`/`sacct` availability if relevant;
- CPU test job ID;
- CPU test result JSON;
- GPU test job ID if run;
- GPU test result JSON;
- launcher dry-run result;
- launcher payload-intent dry-run or explicit submit result;
- YOLO result if run;
- errors encountered;
- whether 2FA/browser-side SSH worked;
- suggested payload profile values.

Do not include SSH passwords, OTPs, private keys, local secret config files, or token values.

## Test Kit

See [../maintainer/hpc-test-kit/README.md](../maintainer/hpc-test-kit/README.md) for commands. The kit is intentionally homedir-scoped and requires strict known-host verification for SSH phases.
