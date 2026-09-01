# Vega0 SLAIF Connect Test Target

This directory describes how to build a two-node Raspberry Pi 4 lab cluster
that reproduces the control-plane and user-facing complexity SLAIF Connect
expects from a Vega-like HPC target.

It is a test target, not a small production supercomputer. The point is to
exercise the same integration boundaries:

- SSH terminates only on a login node;
- the test user authenticates with an SSH key plus TOTP;
- identity is central and resolves on login and compute nodes;
- jobs reach compute nodes through Slurm, never through worker-node SSH;
- home and project paths are shared;
- Slurm accounts, partitions, cgroups, accounting, modules, MPI, and
  containers are present;
- service restart, node reboot, NFS recovery, and thermal limits are testable.

The reference target was manually built and validated on two Raspberry Pi 4
systems running Ubuntu Server 24.04. The validated topology was:

| Role | Hostname | Wi-Fi administration | Private fabric |
| --- | --- | --- | --- |
| Login/control | `vega0-login.vega0.test` | `192.168.1.200` | `10.10.0.1/24` |
| Compute | `vega0-worker.vega0.test` | `192.168.1.162` | `10.10.0.2/24` |

Wi-Fi remained DHCP-managed throughout preparation. A USB Ethernet adapter on
the login node was deliberately left unconfigured for a later public-ingress
experiment. The built-in `eth0` interfaces form the private cluster fabric.

## Read This In Order

1. [GOAL_AND_SCOPE.md](GOAL_AND_SCOPE.md)
2. [ARCHITECTURE.md](ARCHITECTURE.md)
3. [SOFTWARE.md](SOFTWARE.md)
4. [PREPARATION.md](PREPARATION.md)
5. [IDENTITY_AND_CREDENTIALS.md](IDENTITY_AND_CREDENTIALS.md)
6. [DEPLOYMENT_MAP.md](DEPLOYMENT_MAP.md)
7. [BUILD_CHECKLIST.md](BUILD_CHECKLIST.md)
8. [SLAIF_CONNECT_INTEGRATION.md](SLAIF_CONNECT_INTEGRATION.md)
9. [ACCEPTANCE.md](ACCEPTANCE.md)
10. [OPERATIONS_AND_RECOVERY.md](OPERATIONS_AND_RECOVERY.md)
11. [SOURCES.md](SOURCES.md)

Reference configuration lives under [config/](config/), node-side helper
programs under [node-scripts/](node-scripts/), and local acceptance helpers
under [acceptance/](acceptance/).

## Security And Credential Rule

No password, OTP seed, private key, host private key, database password, IPA
Directory Manager password, or signed-policy private key belongs in Git.
Placeholders in this directory must be replaced in local staging files or by
local environment variables. Test credentials may be intentionally disposable,
but they are still credentials.

## Proven Reference Behavior

Reference validation completed on 2026-08-31. With the Slurm queue empty, the
worker and then the login node were cleanly powered off and confirmed offline
after the final acceptance run.

The lab target passed all of the following before it was powered off:

- both nodes recovered from independent controlled reboots;
- FreeIPA DNS, Kerberos, HTTPS, SSSD, NFS, Slurm, MariaDB, and `slurmdbd`
  recovered automatically;
- the central `user` identity resolved to the same UID/GID on both nodes;
- key-plus-TOTP SSH login succeeded on the login node;
- direct SSH as `user` to the worker was denied;
- the pre-existing administrative account still authenticated on both nodes;
- `cpu`, `dev`, and two-node `all` partition jobs completed;
- a two-rank OpenMPI/PMIx job ran across both nodes;
- a 128 MiB Slurm cgroup-v2 memory limit was visible and effective;
- accounting recorded user, account, partition, state, resources, and nodes;
- per-job scratch was created with correct ownership and removed by epilog;
- the worker NFSv4 mount recovered after a login-node reboot;
- thermal monitoring remained active and job admission stopped at 75 C.

## Deliberate Differences From Vega

- NFSv4 emulates the shared POSIX namespace; it is not CephFS.
- There is one CPU worker and no GPU node.
- FreeIPA runs in a persistent Podman container on the login Pi.
- `SingularityCE` is exposed through both `singularity` and an `apptainer`
  compatibility command.
- The hardware is suitable for integration and failure testing, not
  performance or scale testing.
