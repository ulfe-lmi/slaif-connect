# Software Inventory

## Validated Reference Versions

These versions describe the hardware validation run. Exact Ubuntu package
revisions will move over time; record the versions used by each new build.

| Component | Validated version/source | Role |
| --- | --- | --- |
| Ubuntu Server | 24.04.4 LTS, ARM64 | Both nodes |
| Raspberry Pi kernel | `6.8.0-1063-raspi` | Both nodes |
| Slurm | 23.11.4 Ubuntu packages | Controller, worker, clients |
| MUNGE | Ubuntu 24.04 package | Slurm authentication |
| MariaDB | 10.11.14 | Slurm accounting backend |
| `slurmdbd` | 23.11.4 | Accounting service |
| FreeIPA server | `quay.io/freeipa/freeipa-server:rocky-9-4.13.1` ARM64 | Container on login |
| FreeIPA client | 4.11.1 | Both nodes |
| SSSD | 2.9.4 | Central identity/HBAC |
| Chrony | Ubuntu 24.04 package | Clock synchronization |
| NFS | Ubuntu `nfs-kernel-server` / `nfs-common` | Shared namespace |
| GCC/GFortran | 13.3.0 | Build toolchain |
| OpenMPI | 4.1.6 with Slurm/PMIx support | Multi-node MPI |
| Lmod | Ubuntu 24.04 package | Environment modules |
| SingularityCE | 4.1.1 | Container runtime |
| Podman | Ubuntu 24.04 package | FreeIPA container |
| UFW | Ubuntu 24.04 package | Host firewall |

## Package Groups

Install from Ubuntu 24.04 repositories after enabling `noble-updates` and
`noble-security`:

### Both nodes

Install:

    sudo apt-get update
    sudo apt-get install \
      chrony munge slurm-client slurmd \
      freeipa-client sssd sssd-tools nfs-common \
      lmod singularity-container \
      gcc g++ gfortran openmpi-bin libopenmpi-dev \
      ufw dnsutils

```text
chrony
munge
slurm-client
slurmd
freeipa-client
sssd
sssd-tools
nfs-common
lmod
singularity-container
gcc
g++
gfortran
openmpi-bin
libopenmpi-dev
ufw
dnsutils
```

### Login node only

Install:

    sudo apt-get install \
      slurmctld slurmdbd mariadb-server nfs-kernel-server podman

```text
slurmctld
slurmdbd
mariadb-server
nfs-kernel-server
podman
```

Package names can vary across Ubuntu updates. Confirm ARM64 availability with
`apt-cache policy` before changing the procedure.

On the local operator workstation, the optional automated acceptance wrapper
also requires OpenSSH, Python 3, Expect, and sshpass. Those tools are not part
of SLAIF Connect product runtime.

## Version Evidence To Capture

```bash
lsb_release -a
uname -a
scontrol --version
munge --version
sssd --version
ipa --version
mpirun --version
gcc --version
singularity --version
podman --version
mariadb --version
```

Save non-secret output in the acceptance report. Never save command output that
contains passwords, OTP seeds, key material, Kerberos tickets, or tokens.
