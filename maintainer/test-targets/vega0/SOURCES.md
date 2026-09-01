# Authoritative Sources And Design Mapping

These sources explain the production-facing concepts that the lab target
approximates. Review current upstream documentation before rebuilding because
software, package names, and site policy can change.

## Vega And SLING

- Vega login and SSH access:
  https://doc.vega.izum.si/login/
- Vega cluster overview:
  https://doc.vega.izum.si/summary/
- Vega mount points/shared filesystem:
  https://doc.vega.izum.si/mountpoints/
- Vega modules:
  https://doc.vega.izum.si/modules/
- Vega Slurm partitions:
  https://doc.vega.izum.si/slurm-partitions/
- Vega billing/accounting:
  https://doc.vega.izum.si/billing/
- Vega multi-process/MPI guidance:
  https://doc.vega.izum.si/mpu/
- SLING cluster access:
  https://doc.sling.si/en/navodila/dostop/

Mapping:

- key/TOTP login and login-node-only access model the user-facing boundary;
- Slurm account/partition/accounting model scheduler and billing semantics;
- /ceph/hpc plus modules/MPI model the namespace and environment expected by
  site workloads.

The lab does not claim identical site policy or performance.

## Slurm

- Main configuration:
  https://slurm.schedmd.com/slurm.conf.html
- Cgroup v2:
  https://slurm.schedmd.com/cgroup_v2.html
- Accounting/slurmdbd:
  https://slurm.schedmd.com/accounting.html
- Multifactor priority/fair-share:
  https://slurm.schedmd.com/priority_multifactor.html
- MPI/PMIx:
  https://slurm.schedmd.com/mpi_guide.html
- Prolog/epilog:
  https://slurm.schedmd.com/prolog_epilog.html

Mapping:

- the committed Slurm files use cgroup task tracking, consumable CPU/memory,
  slurmdbd associations, multifactor priority, and PMIx;
- the private-fabric firewall decision reflects real srun/stepd/PMIx peer
  behavior observed on the Ubuntu ARM packages.

## FreeIPA And SSSD

- FreeIPA container:
  https://github.com/freeipa/freeipa-container
- OTP behavior and CLI options:
  https://www.freeipa.org/page/V4/OTP
- OTP token API:
  https://freeipa.readthedocs.io/en/latest/api/otptoken_add.html
- HBAC guide:
  https://freeipa.readthedocs.io/en/ipa-4-11/api/hbac_guide.html
- HBAC workshop/CLI examples:
  https://freeipa.readthedocs.io/en/ipa-4-11/workshop/4-hbac.html

Mapping:

- IPA supplies central UID/GID, SSH public keys, TOTP, DNS/Kerberos, and HBAC;
- SSSD resolves the same user on login and worker;
- OTP replay protection is reflected in the acceptance helper.

## Ubuntu And NFS

- Ubuntu NFS server/client guidance:
  https://documentation.ubuntu.com/server/how-to/networking/install-nfs/
- Ubuntu Netplan:
  https://documentation.ubuntu.com/server/explanation/networking/configuring-networks/
- systemd-resolved:
  https://www.freedesktop.org/software/systemd/man/latest/systemd-resolved.service.html

Mapping:

- separate Netplan fragments preserve Wi-Fi DHCP while adding static eth0;
- systemd-resolved uses a route-only private domain;
- NFSv4 with sec=sys over the isolated fabric supports unattended Slurm jobs.

## SLAIF Connect Repository Contracts

- [Architecture](../../../docs/ARCHITECTURE.md)
- [Security](../../../docs/SECURITY.md)
- [Signed HPC policy](../../../docs/HPC_POLICY.md)
- [Real-HPC pilot](../../../docs/REAL_HPC_PILOT.md)
- [Remote launcher contract](../../../docs/REMOTE_LAUNCHER_CONTRACT.md)
- [Remote launcher payload intent](../../../docs/REMOTE_LAUNCHER_PAYLOAD_INTENT.md)
- [Maintainer HPC testing](../../../docs/MAINTAINER_HPC_TESTING.md)
- [Maintainer HPC test kit](../../hpc-test-kit/README.md)

Mapping:

- browser-side SSH terminates at the login node;
- signed policy fixes SSH identity and remote command authority;
- the relay forwards encrypted bytes only;
- payload IDs and site-owned Slurm profiles reach the worker through Slurm,
  never worker SSH.
