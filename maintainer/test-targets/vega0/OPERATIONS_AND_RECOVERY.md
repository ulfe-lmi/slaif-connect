# Operations And Recovery

## Normal Health Check

~~~bash
# login
scontrol ping
sinfo -N -l
squeue -a
systemctl is-active container-fido-ipa slurmctld slurmd slurmdbd mariadb nfs-server sssd

# worker
systemctl is-active slurmd munge sssd
findmnt /ceph/hpc

# both
cat /sys/class/thermal/thermal_zone0/temp
~~~

## Clean Shutdown

Confirm squeue is empty. Power off worker first, then login:

~~~bash
sudo systemctl poweroff
~~~

Wait until both stop answering before removing power.

## Startup Order

Power login first. FreeIPA/Dogtag may need one or two minutes after SSH appears.
Wait for:

~~~bash
dig +short @10.10.0.1 fido.vega0.test
curl -k -I https://10.10.0.1/ipa/ui/
getent passwd user
scontrol ping
sudo exportfs -v
~~~

Then power worker and wait for slurmd registration and NFS automount.

## Temperature

- New jobs are refused at 75 C by vega-thermal-guard.
- vega-thermal-watch records cool/warning/critical transitions.
- The FreeIPA systemd unit has CPUQuota=150% to limit CA/Java startup load.
- Pause package builds, container startup experiments, or MPI stress work at
  the guard threshold.
- Improve physical cooling instead of raising the threshold.

## FreeIPA Container Recovery

The systemd service owns the root Podman container. Avoid starting fido-ipa
manually and leaving systemd inactive.

Check:

~~~bash
sudo systemctl status container-fido-ipa
sudo podman ps -a
sudo journalctl -u container-fido-ipa
~~~

If the container is running but the unit is inactive, stop only that container
and start it through systemd during a maintenance window. Expect temporary DNS,
Kerberos, LDAP, and TOTP outage while it restarts.

Do not delete /var/lib/freeipa. It is the persistent IPA database and CA state.

## NFS Client Recovery

The operational export must remain sec=sys unless Kerberos NFS is fully tested.

If worker access blocks:

~~~bash
journalctl -k | tail
findmnt /ceph/hpc
sudo exportfs -v
ss -nt | grep 2049
~~~

Do not force-unmount while Slurm jobs are using the filesystem. Drain the
worker and clear jobs first. A controlled worker reboot is the safest way to
discard unrecoverable NFSv4 client state in this lab.

## Slurm Task I/O Or PMIx Failure

Symptoms:

~~~text
Slurmd could not connect IO
Cannot establish direct connection to peer
~~~

Inspect:

~~~bash
journalctl -k | grep 'UFW BLOCK'
journalctl -u slurmd
ss -lnt
~~~

SrunPortRange bounds srun listener ports, but the packaged PMIx plugin also
opened ephemeral peer ports. Keep the all-traffic rule restricted to eth0 and
10.10.0.0/24; do not open high ports on wlan0 or a public interface.

## Node Stuck In COMPLETING

First identify the job and node:

~~~bash
squeue -a
scontrol show job JOB_ID
scontrol show node vega0-worker
~~~

If a blocked NFS task survives cancellation, reboot the worker after confirming
the job is disposable. Then, as root on login:

~~~bash
scancel -f JOB_ID
~~~

Wait for the node to register and return to IDLE. Do not use destructive Slurm
state-directory deletion as a first response.

## TOTP Replay

FreeIPA rejects reuse of an already accepted TOTP value. Automated tests must
wait for a fresh 30-second interval before each new SSH authentication.

Repeated Password prompts generally mean the OTP was stale/replayed, not that
Slurm failed. Stop the test instead of submitting the same value three times.

## Wi-Fi And USB Ethernet

The reference login Pi experienced 2.4 GHz Wi-Fi disruption with a USB 3
Ethernet adapter. Moving the adapter to a USB 2 port restored stable Wi-Fi.

Keep wlan0 configuration unchanged while it is the only administration path.
Do not activate the USB adapter as public ingress until firewall, relay,
host-key, and exposure controls are designed and tested.

## Backup

For a disposable rig, image-level backups are simplest. At minimum preserve:

- /var/lib/freeipa;
- /var/lib/slurm/slurmctld;
- MariaDB Slurm accounting database;
- /etc/slurm;
- /etc/munge/munge.key;
- /ceph/hpc;
- host SSH keys if stable host identity is required.

Backups containing credentials or CA/private-key material must be encrypted and
access-controlled.
