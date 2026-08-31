# Goal And Scope

## Goal

Prepare a small, disposable HPC system that can act as a realistic SLAIF
Connect integration target when access to Vega or another production HPC site
is unavailable or inappropriate.

The target should force client and launcher code to deal with the same kinds of
boundaries as a real site:

```text
SLAIF web application
  -> SLAIF Connect browser-side SSH
  -> approved relay carrying encrypted SSH
  -> login-node sshd
  -> fixed remote launcher
  -> Slurm allocation
  -> compute-node process
```

The extension and relay must never SSH to the worker. Compute execution must
come from Slurm.

## Fidelity Requirements

The test target is complete only when it provides:

1. a login node and a separate worker node;
2. a private Ethernet fabric independent of the administration path;
3. centralized user identity with stable UID/GID values;
4. login-node-only SSH authorization for the test user;
5. SSH public-key authentication followed by PAM/TOTP;
6. Slurm control, worker execution, partitions, accounts, fair-share, cgroups,
   and accounting;
7. a shared home/project namespace and node-local per-job scratch;
8. environment modules, compiler/MPI support, and a container runtime;
9. private-fabric DNS and time synchronization;
10. default-deny host firewalls with unrestricted traffic only on the isolated
    cluster fabric, because Slurm I/O and PMIx use dynamic peer ports;
11. restart and reboot persistence;
12. temperature monitoring appropriate for Raspberry Pi hardware;
13. automated positive and negative acceptance evidence.

## Non-Goals

This target does not attempt to reproduce:

- Vega's performance, node count, GPU topology, interconnect, or storage
  throughput;
- production certificate, backup, monitoring, or high-availability practices;
- a production host CA or institutional identity lifecycle;
- production CephFS behavior;
- production network exposure;
- arbitrary remote shell execution as a normal SLAIF payload.

## Success Boundary

Success means SLAIF Connect can treat the target like an HPC site for SSH,
host-key, MFA, fixed-launcher, Slurm, result, and failure-path testing. It does
not mean a policy/profile proven on this target is automatically valid for
Vega. Real-site discovery and out-of-band host-key verification remain
mandatory.
