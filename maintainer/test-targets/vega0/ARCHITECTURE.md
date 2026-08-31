# Architecture

## Node Responsibilities

| Capability | Login node | Worker node |
| --- | --- | --- |
| Administrative SSH over Wi-Fi | Yes | Yes |
| Test-user SSH | Yes, key + TOTP | Denied |
| Private `eth0` | `10.10.0.1/24` | `10.10.0.2/24` |
| FreeIPA server and integrated DNS | Podman container | Client only |
| SSSD/FreeIPA client | Yes | Yes |
| MUNGE | Yes | Yes |
| `slurmctld` | Yes | No |
| `slurmd` | Yes, for `dev` | Yes, for `cpu` |
| `slurmdbd` and MariaDB | Yes | No |
| NFSv4 | Server | Client/automount |
| Shared `/ceph/hpc` | Local/exported | Mounted from login |
| Local `/scratch` | Yes | Yes |
| Lmod/OpenMPI/container runtime | Yes | Yes |

## Logical Flow

```text
administration LAN (DHCP; never replace during remote setup)
  192.168.1.200 wlan0                         192.168.1.162 wlan0
          |                                           |
          v                                           v
  +------------------+      private eth0      +-------------------+
  | vega0-login      | 10.10.0.1 <----------> | vega0-worker      |
  |                  |                         | 10.10.0.2         |
  | sshd + MFA       |                         | no user SSH       |
  | FreeIPA + DNS    |                         | SSSD              |
  | Slurm controller |                         | Slurm compute     |
  | accounting DB    |                         | NFS client        |
  | NFS server       |                         | local scratch     |
  +------------------+                         +-------------------+
```

## Naming And Identity

Reference DNS domain and Kerberos realm:

```text
DNS domain: vega0.test
Kerberos realm: VEGA0.TEST
IPA server: fido.vega0.test -> 10.10.0.1
login host: vega0-login.vega0.test -> 10.10.0.1
worker host: vega0-worker.vega0.test -> 10.10.0.2
```

Reference central identities:

```text
IPA group: hpc-users
Slurm account: demo-users
test user: user
home: /ceph/hpc/home/user
shell: /bin/bash
```

The test user is an IPA/SSSD identity, not an independently maintained local
account. SSSD resolves it on both nodes so Slurm can set UID/GID correctly on
the worker.

## Network Trust Boundaries

- `wlan0` is the administration lifeline and remains DHCP-managed.
- `eth0` is a direct, isolated node-to-node fabric with no default route.
- UFW permits administrative SSH on `wlan0` only from the administration LAN.
- UFW permits all traffic from `10.10.0.0/24` only when it enters on `eth0`.
  This is required for Slurm reverse I/O and PMIx peer connections, which use
  dynamic ports even when `SrunPortRange` is bounded.
- The login USB Ethernet adapter has no address and receives no allow rule
  until a separate ingress design is reviewed.
- Services may listen broadly inside the host/container, but default-deny UFW
  keeps them inaccessible from Wi-Fi and future public interfaces.

## Shared Storage Choice

The operational export uses NFSv4 with `sec=sys` on the physically isolated
fabric. Batch steps do not normally carry a user Kerberos ticket, so advertising
`krb5p` alongside `sys` caused NFSv4 state-recovery failures after server
reboot in the reference build. Do not enable `krb5p` until ticket propagation,
GSS credentials, reboot recovery, and unattended jobs are tested end to end.

This is a lab approximation of Vega's shared POSIX namespace, not a claim that
NFS and CephFS have identical behavior.
