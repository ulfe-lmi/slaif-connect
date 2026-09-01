# Build And Completion Checklist

Record date, operator, deviations, and evidence location outside Git.

## Hardware And Safety

- [ ] Both Raspberry Pi 4 systems run Ubuntu Server 24.04 ARM64.
- [ ] Power supplies and cooling are adequate.
- [ ] CPU temperatures are below 75 C before heavy work.
- [ ] The USB/public Ethernet interface is unplugged or unconfigured.
- [ ] A console/recovery method exists before networking changes.

## Administration And Private Fabric

- [ ] Administrative SSH works independently over wlan0 on both nodes.
- [ ] wlan0 remains DHCP-managed and owns the default route.
- [ ] Login eth0 is 10.10.0.1/24 with no default route.
- [ ] Worker eth0 is 10.10.0.2/24 with no default route.
- [ ] Private-link ping succeeds both directions.
- [ ] FQDN and short-name resolution returns private addresses.

## Time And Packages

- [ ] noble, noble-updates, and noble-security are enabled.
- [ ] Required package groups from SOFTWARE.md are installed.
- [ ] chrony is active and both clocks agree.
- [ ] Each node was upgraded/rebooted separately.
- [ ] Package/version evidence is recorded.

## MUNGE And Slurm

- [ ] One MUNGE key is installed mode 0400 on both nodes.
- [ ] Cross-node MUNGE succeeds in both directions.
- [ ] slurm.conf and cgroup.conf hashes match on both nodes.
- [ ] MariaDB and slurmdbd are active on login.
- [ ] Slurm cluster/account associations exist.
- [ ] Login slurmd, slurmctld, and worker slurmd are active.
- [ ] cpu, dev, and all partitions show expected nodes.

## FreeIPA And SSSD

- [ ] fido-ipa is owned by an enabled systemd service.
- [ ] FreeIPA container data is persistent under /var/lib/freeipa.
- [ ] CPUQuota=150% is effective for the container service.
- [ ] IPA DNS A and Kerberos SRV records resolve privately.
- [ ] Both hosts are enrolled with host keytabs.
- [ ] SSSD resolves the central user identically on both nodes.

## Test User And Authorization Wall

- [ ] Test key, password, and TOTP seed exist only outside Git.
- [ ] IPA group hpc-users exists.
- [ ] IPA user user has the shared home and /bin/bash shell.
- [ ] IPA stores only the public SSH key.
- [ ] User authentication type is OTP.
- [ ] A six-digit, 30-second TOTP token exists.
- [ ] HBAC grants user/sshd only to hpc-login.
- [ ] HBAC denies user/sshd to the worker.
- [ ] allow_all was disabled only after hbactest passed.
- [ ] Login sshd requires publickey plus keyboard-interactive PAM.
- [ ] Test-user SSH to login succeeds.
- [ ] Test-user SSH to worker fails.
- [ ] The pre-existing administrative account remains unchanged and usable.

## Shared Storage And Runtime

- [ ] /ceph/hpc is exported only to the worker over the private fabric.
- [ ] Operational NFS uses sec=sys and root_squash.
- [ ] Worker systemd automount resolves the shared home.
- [ ] Home/project ownership uses the central UID/GID.
- [ ] /scratch exists mode 1777 on both nodes.
- [ ] Prolog creates job scratch and thermal-checks the node.
- [ ] Epilog removes only /scratch/JOB_ID.
- [ ] Lmod modulefiles are visible to the test user.
- [ ] GNU/OpenMPI modules load.
- [ ] singularity and apptainer commands resolve.

## Firewall And Exposure

- [ ] UFW defaults to deny incoming and allow outgoing.
- [ ] wlan0 SSH is limited to the administration LAN.
- [ ] All private-fabric traffic is allowed only in on eth0 from 10.10.0.0/24.
- [ ] No allow rule exists for the USB/public interface.
- [ ] Slurm task I/O and PMIx complete without UFW blocks.

## Acceptance

- [ ] cpu job runs on vega0-worker.
- [ ] dev job runs on vega0-login.
- [ ] all/PMIx job has one rank on each node.
- [ ] 128 MiB cgroup memory limit is effective.
- [ ] NFS write and root-squash behavior are correct.
- [ ] Scratch is owned correctly and cleaned after the job.
- [ ] sacct records account, partition, resources, state, and nodes.
- [ ] Login reboot recovers IPA, DNS, NFS, Slurm, and SSSD.
- [ ] Existing worker NFS mount recovers after login reboot.
- [ ] Worker reboot recovers automount, SSSD, MUNGE, and slurmd.
- [ ] Thermal monitor is active on both nodes.

## SLAIF Connect Onboarding

- [ ] Login host key is independently verified.
- [ ] Worker is absent from the relay target allowlist.
- [ ] Maintainer discover and CPU phases pass.
- [ ] Launcher and payload-intent dry-runs pass.
- [ ] Signed pilot policy pins login endpoint and SSH identity.
- [ ] Browser strict-host-key positive/negative tests pass.
- [ ] Browser key-plus-TOTP interaction remains end-to-end SSH.
- [ ] Fixed launcher reaches the worker only through Slurm.

## Completion

- [ ] No password, OTP seed/value, private key, ticket, or token is committed.
- [ ] Deviations and software versions are documented.
- [ ] Acceptance evidence is stored in an approved non-secret location.
- [ ] Clean shutdown order was tested: worker first, then login.
