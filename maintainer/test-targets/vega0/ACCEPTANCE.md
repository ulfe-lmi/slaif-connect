# Acceptance Tests

Run these tests after initial preparation and after changes to networking,
identity, storage, Slurm, or firewall policy.

Keep credentials in a local directory outside Git. The helpers under
acceptance/ require local OpenSSH, sshpass, Expect, and Python 3.

## 1. Baseline And Temperature

On both nodes:

~~~bash
hostname -f
ip -br -4 address
ip -4 route
systemctl is-active chrony munge slurmd sssd vega-thermal-watch
cat /sys/class/thermal/thermal_zone0/temp
~~~

Expected:

- wlan0 has its DHCP address and default route;
- eth0 has the expected 10.10.0.x/24 address and no default route;
- temperature is below 75000 millidegrees C;
- login-only services are not required on the worker.

## 2. Private DNS And Time

From both nodes:

~~~bash
dig +short @10.10.0.1 fido.vega0.test
dig +short @10.10.0.1 _kerberos._tcp.vega0.test SRV
chronyc tracking
~~~

Expected A address: 10.10.0.1. Expected Kerberos port: 88.

## 3. Central Identity

On both nodes:

~~~bash
getent passwd user
id user
~~~

UID, primary GID, supplementary hpc-users GID, home, and shell must match.

## 4. Login Authorization

Positive test:

- connect as user to the login node with the test Ed25519 private key;
- complete the TOTP/PAM prompt;
- verify hostname and HOME.

Negative test:

~~~bash
ssh -o BatchMode=yes \
  -o PreferredAuthentications=publickey \
  -o PasswordAuthentication=no \
  -i LOCAL_TEST_KEY \
  user@192.168.1.162 true
~~~

The worker test must fail.

Re-test the administrative account on both nodes. Its UID, groups, home, shell,
password/key login, and sudo access must remain usable.

## 5. Cross-Node MUNGE

~~~bash
ssh login-admin munge | ssh worker-admin unmunge
ssh worker-admin munge | ssh login-admin unmunge
~~~

Both directions must report Success.

## 6. Slurm State And Accounting

On login:

~~~bash
scontrol ping
sinfo -N -l
sacctmgr show assoc where cluster=vega0
sshare -A demo-users -a
~~~

Expected:

- vega0-login is idle in dev and all;
- vega0-worker is idle in cpu and all;
- user is associated with demo-users.

## 7. Worker CPU Job And Scratch

Through user SSH on login:

~~~bash
srun --account=demo-users --partition=cpu -N1 -n1 \
  bash -lc 'id; hostname; echo HOME=$HOME; echo WORKDIR=$WORKDIR; \
  test -d \"$WORKDIR\"; touch \"$WORKDIR/probe\"; stat -c \"%u:%g\" \"$WORKDIR/probe\"'
~~~

Expected hostname: vega0-worker. WORKDIR and TMPDIR must identify
/scratch/JOB_ID. After completion, that job directory must be absent.

## 8. Login Development Job

~~~bash
srun --account=demo-users --partition=dev -N1 -n1 hostname
~~~

Expected hostname: vega0-login.

## 9. Cgroup Enforcement

Run a 128 MiB job and inspect the first non-max memory.max value while walking
from the task cgroup toward its parents. The validated result was 134217728.

The task leaf may show max because it inherits the effective constraint from
the user/job parent. Do not treat only the leaf file as proof of no limit.

## 10. Shared Storage

From a worker Slurm job:

~~~bash
test -w /ceph/hpc/home/user
touch /ceph/hpc/project/demo-users/worker-write-test
~~~

On worker:

~~~bash
findmnt /ceph/hpc
~~~

Expected mount security flavor: sec=sys.

As root on the worker, verify root_squash prevents an unauthorized root-owned
write where permissions do not allow it.

## 11. Modules And MPI

Compile acceptance/mpi_hello.c into the shared project directory, then:

~~~bash
source /etc/profile.d/vega-modules.sh
module load gnu/13.3.0 openmpi/4.1.6
srun --mpi=pmix_v5 --account=demo-users --partition=all \
  -N2 -n2 --ntasks-per-node=1 \
  /ceph/hpc/project/demo-users/mpi_hello
~~~

Expected: one rank on login and one rank on worker.

If task I/O times out or PMIx cannot connect peers, inspect UFW logs first. The
isolated eth0 fabric must permit dynamic peer ports in both directions.

## 12. Container Interface

On both nodes:

~~~bash
apptainer --version
singularity --version
~~~

Both names must resolve to the installed SingularityCE runtime.

## 13. Accounting Evidence

For each acceptance job:

~~~bash
sacct -j JOB_ID \
  --format=JobIDRaw,User,Account,Partition,State,ExitCode,Elapsed,AllocTRES,NodeList
~~~

Expected: user, demo-users, correct partition, COMPLETED/0:0, and allocated
nodes/resources.

## 14. Reboot Recovery

With no active jobs:

1. ensure /ceph/hpc is currently mounted on the worker;
2. reboot login only;
3. wait for IPA, DNS, NFS, Slurm, and SSSD;
4. stat /ceph/hpc/home/user on worker without manual remount;
5. run a short cpu job;
6. reboot worker only;
7. verify NFS automount, SSSD, MUNGE, and slurmd;
8. rerun CPU and MPI tests.

This gate caught the mixed sec=sys:krb5p NFS recovery problem in the reference
build.

## 15. Thermal Gate

Verify:

~~~bash
systemctl is-active vega-thermal-watch
journalctl -t vega-thermal-watch
/usr/local/sbin/vega-thermal-guard
~~~

Do not synthetically heat the Pi to test rejection. Review the script threshold
and rely on normal installation/container-start observations.

## 16. Final Evidence

Record:

- date and software versions;
- sanitized sinfo and association output;
- successful job IDs and sacct output;
- login-only SSH result;
- reboot/NFS recovery result;
- maximum observed temperatures;
- any deviations from this reference configuration.

Never record passwords, OTP values/seeds, private keys, tickets, or tokens.
