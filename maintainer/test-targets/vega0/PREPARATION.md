# Preparation Procedure

This is an operator procedure. It intentionally does not provide one
root-level script that rewrites networking, identity, storage, and
authentication in a single run.

Run each phase, verify its exit criteria, and keep a recovery path.

## 0. Hardware And Operator Inputs

Required hardware:

- two Raspberry Pi 4 systems with adequate power supplies;
- Ubuntu Server 24.04 ARM64 media for each;
- cooling suitable for sustained package installation and container startup;
- one direct Ethernet cable between built-in Ethernet ports;
- optional USB Ethernet adapter on the login node, left unplugged or
  unconfigured during the base build;
- a DHCP Wi-Fi administration network.

Choose and record local values without committing secrets:

~~~text
LOGIN_ADMIN_IP=192.168.1.200
WORKER_ADMIN_IP=192.168.1.162
ADMIN_LAN=192.168.1.0/24
LOGIN_PRIVATE_IP=10.10.0.1
WORKER_PRIVATE_IP=10.10.0.2
DNS_DOMAIN=vega0.test
KERBEROS_REALM=VEGA0.TEST
IPA_HOST=fido.vega0.test
LOGIN_HOST=vega0-login.vega0.test
WORKER_HOST=vega0-worker.vega0.test
TEST_USER=user
IPA_GROUP=hpc-users
SLURM_ACCOUNT=demo-users
~~~

Generate these locally and keep them outside Git:

- temporary administrative password;
- IPA admin and Directory Manager passwords;
- Slurm database password;
- test-user initial password;
- test-user Ed25519 keypair;
- test-user TOTP seed;
- verified SSH known-hosts file.

Do not modify the existing administrative account as part of the test-user
authorization work.

## 1. Establish The Administration Lifeline

Install Ubuntu Server 24.04 and confirm password or key SSH access to both Wi-Fi
DHCP addresses.

On each node:

~~~bash
hostname
ip -br address
ip route
cat /sys/class/thermal/thermal_zone0/temp
~~~

Exit criteria:

- both Wi-Fi addresses answer SSH independently;
- wlan0 owns the default route and shows DHCP in ip route;
- the administrator can run sudo;
- both CPUs are below 75 C.

Do not edit, replace, or re-render the wlan0 configuration. Preserve a copy of
/etc/netplan before adding the private interface.

## 2. Configure Only The Private Ethernet Fabric

Copy the matching file from config/netplan to
/etc/netplan/60-hpc-eth0.yaml on each node.

Validate before activating:

~~~bash
sudo netplan generate
~~~

Apply during a maintenance window with local console access when possible.
When working remotely, never use a broad generated network file that also
rewrites wlan0.

Verify:

~~~bash
ip -4 address show dev eth0
ip route show 10.10.0.0/24
ping -c 3 10.10.0.1
ping -c 3 10.10.0.2
~~~

There must be no default route on eth0.

## 3. Set Stable Hostnames And Private Name Resolution

Set the matching hostname on each node:

~~~bash
# login only
sudo hostnamectl set-hostname vega0-login.vega0.test

# worker only
sudo hostnamectl set-hostname vega0-worker.vega0.test
~~~

Install the appropriate config/hosts file as /etc/hosts on each node. If
cloud-init manages /etc/hosts, update its hosts template with the same records
or disable only that specific hosts-management behavior.

Required private records:

~~~text
10.10.0.1 fido.vega0.test fido vega0-login.vega0.test vega0-login login.vega0.test login
10.10.0.2 vega0-worker.vega0.test vega0-worker worker.vega0.test worker
~~~

Keep the 127.0.1.1 entry limited to the local short hostname. Do not map the
IPA FQDN to loopback.

Install config/systemd/vega-private-dns.service on both nodes after IPA DNS is
available. It adds a route-only systemd-resolved domain for vega0.test without
replacing Wi-Fi DNS.

## 4. Update The OS In A Thermally Controlled Sequence

Ensure noble, noble-updates, and noble-security are enabled. Upgrade one node at
a time, worker first.

Before and during a large package transaction:

~~~bash
awk '{printf "%.1f C\n", $1 / 1000}' /sys/class/thermal/thermal_zone0/temp
~~~

Pause heavy work at 75 C. Never upgrade both nodes simultaneously when Wi-Fi is
the only recovery path.

After each upgrade:

~~~bash
sudo dpkg --configure -a
sudo apt-get -f install
sudo systemctl reboot
~~~

Wait for that node to recover and verify SSH, wlan0 DHCP, eth0, and temperature
before touching the other node.

## 5. Install Time, Slurm, Identity, Storage, And Runtime Packages

Use the package groups in SOFTWARE.md. Install chrony on both nodes and verify:

~~~bash
systemctl is-active chrony
chronyc tracking
timedatectl
~~~

Kerberos and MUNGE both depend on close clock agreement. Do not continue if
the nodes differ materially.

## 6. Configure MUNGE

Create one MUNGE key on the login node and copy that exact key to the worker
over the administration channel.

On both nodes the final file must be:

~~~text
/etc/munge/munge.key
owner: munge
group: munge
mode: 0400
~~~

Enable and start MUNGE on both nodes. Prove both directions:

~~~bash
munge | ssh worker-admin unmunge
ssh worker-admin munge | unmunge
~~~

Both must report STATUS: Success.

## 7. Configure Slurm Control And Accounting

Install:

- config/slurm/slurm.conf on both nodes;
- config/slurm/cgroup.conf on both nodes;
- config/slurm/slurmdbd.conf.example as /etc/slurm/slurmdbd.conf on login
  after replacing the database password placeholder.

Set slurmdbd.conf ownership to slurm:slurm and mode 0600.

Create state/log directories with the ownership expected by Ubuntu's Slurm
packages. Install MariaDB tuning from config/mariadb/60-slurm.cnf.

Create the accounting database locally on the login node:

~~~sql
CREATE DATABASE slurm_acct_db;
CREATE USER 'slurm'@'localhost' IDENTIFIED BY 'REPLACE_LOCALLY';
GRANT ALL PRIVILEGES ON slurm_acct_db.* TO 'slurm'@'localhost';
FLUSH PRIVILEGES;
~~~

Enable services:

~~~text
login:  munge mariadb slurmdbd slurmctld slurmd
worker: munge slurmd
~~~

Create associations:

~~~bash
sudo sacctmgr -i add cluster vega0
sudo sacctmgr -i add account demo-users Cluster=vega0
~~~

Create the user association only after Phase 10, when the central user resolves
through SSSD.

## 8. Install FreeIPA Server In Podman

Complete hostname, time, and /etc/hosts work before this phase.

Create persistent storage:

~~~bash
sudo install -d -m 0755 /var/lib/freeipa
~~~

Verify the selected FreeIPA image has an ARM64 manifest. The validated image
was:

~~~text
quay.io/freeipa/freeipa-server:rocky-9-4.13.1
~~~

Read the passwords from a protected local source, then create the reference
container. The variables below must not be saved in this repository:

~~~bash
read -rsp 'IPA Directory Manager password: ' IPA_DM_PASSWORD
printf '\n'
read -rsp 'IPA admin password: ' IPA_ADMIN_PASSWORD
printf '\n'

sudo podman create \
  --name fido-ipa \
  --hostname fido.vega0.test \
  --network host \
  --privileged \
  --sysctl net.ipv6.conf.all.disable_ipv6=0 \
  --volume /sys/fs/cgroup:/sys/fs/cgroup:rw \
  --volume /var/lib/freeipa:/data:Z \
  quay.io/freeipa/freeipa-server:rocky-9-4.13.1 \
  -U \
  --realm=VEGA0.TEST \
  --domain=vega0.test \
  --no-ntp \
  --no-host-dns \
  --ip-address=10.10.0.1 \
  -p \"$IPA_DM_PASSWORD\" \
  -a \"$IPA_ADMIN_PASSWORD\"
~~~

The exact container privilege/cgroup options can change with Podman and the
FreeIPA image. Compare them with the current upstream FreeIPA container
documentation before each rebuild.

The initial container uses:

- name fido-ipa;
- hostname fido.vega0.test;
- persistent /var/lib/freeipa mounted at /data;
- realm VEGA0.TEST;
- domain vega0.test;
- address 10.10.0.1;
- no container NTP;
- no host-DNS precheck.

Pass IPA passwords from local operator state. Do not put values in this
repository, shell history, process logs, or result bundles.

Start it through systemd after installing
config/systemd/container-fido-ipa.service. After the base IPA install, add
integrated DNS inside the container:

~~~bash
sudo podman exec -it fido-ipa ipa-dns-install -U \
  --ip-address=10.10.0.1 \
  --no-forwarders \
  --no-reverse
~~~

Create A records for fido, login, and worker, plus the Kerberos SRV records.
Verify with dig against 10.10.0.1.

Install config/systemd/container-fido-ipa.service, enable it, and start the
container through systemd. The CPU quota is important on a Raspberry Pi: the
Dogtag CA/Java startup otherwise consumed several cores and briefly crossed the
75 C guard in the reference build.

## 9. Enroll Both Hosts In FreeIPA

Install FreeIPA client and SSSD packages. Enroll with each node's FQDN:

~~~text
vega0-login.vega0.test
vega0-worker.vega0.test
~~~

Use unattended enrollment only after the server, DNS, and clocks are verified.
Do not let ipa-client-install rewrite SSH configuration in this phase; the
test-user SSH policy is installed separately.

Reference enrollment command, run separately with the matching hostname on
each node:

~~~bash
sudo ipa-client-install \
  --unattended \
  --domain=vega0.test \
  --realm=VEGA0.TEST \
  --server=fido.vega0.test \
  --hostname=NODE_FQDN \
  --principal=admin \
  --password=\"$IPA_ADMIN_PASSWORD\" \
  --no-ntp \
  --no-ssh \
  --no-sshd \
  --force-join
~~~

Verify on both nodes:

~~~bash
systemctl is-active sssd
klist -k /etc/krb5.keytab
getent hosts fido.vega0.test
~~~

## 10. Create The Central Test User And Login-Only HBAC Rule

Follow [IDENTITY_AND_CREDENTIALS.md](IDENTITY_AND_CREDENTIALS.md) for the exact
credential generation, IPA CLI, HBAC test, SSH Match, and Slurm-association
commands. The summary below is the phase gate.

In IPA:

1. create group hpc-users;
2. create user user with home /ceph/hpc/home/user and shell /bin/bash;
3. add user to hpc-users;
4. store the test public SSH key in IPA;
5. set user authentication type to OTP;
6. create a six-digit, 30-second SHA1 TOTP token;
7. create hostgroup hpc-login containing only vega0-login.vega0.test;
8. create HBAC rule hpc-users-login for group hpc-users, hostgroup hpc-login,
   and service sshd;
9. disable IPA's default allow_all rule only after HBAC tests pass.

Test policy before changing the default:

~~~text
user -> vega0-login / sshd: allowed
user -> vega0-worker / sshd: denied
~~~

Create the shared home with the IPA UID/GID and mode 0700.

Now create the Slurm user association:

~~~bash
sudo sacctmgr -i add user user Account=demo-users DefaultAccount=demo-users Fairshare=1000
~~~

Install config/ssh/60-ssh-user-vega.conf on the login node only. Run sshd -t
before reloading sshd. Confirm the administrative account still logs in after
the reload.

Do not install an equivalent Match block on the worker. HBAC must still deny
the test user even if the user later creates ~/.ssh/authorized_keys on shared
storage.

## 11. Configure Shared Storage

On login:

~~~bash
sudo install -d -m 0755 /ceph/hpc/home /ceph/hpc/project /ceph/hpc/software
TEST_UID=$(id -u user)
TEST_GID=$(id -g user)
sudo install -d -m 0700 -o "$TEST_UID" -g "$TEST_GID" /ceph/hpc/home/user
sudo install -d -m 2770 -o "$TEST_UID" -g "$TEST_GID" /ceph/hpc/project/demo-users
unset TEST_UID TEST_GID
~~~

Install config/nfs/exports on login and export it. Append the NFS line from
config/nfs/fstab.worker.fragment to the worker's existing /etc/fstab. Never
replace the worker's root or boot filesystem entries.

The reference mount is NFSv4.2, hard, sec=sys, and systemd-automounted.

Verify:

~~~bash
sudo exportfs -v
sudo exportfs -ra
stat /ceph/hpc/home/user
findmnt /ceph/hpc
~~~

Reboot login while the worker mount exists, wait for NFS to return, and verify
the worker can stat the user home without remounting manually. This is a
required acceptance gate.

## 12. Install Scratch, Modules, MPI, And Containers

Create /scratch mode 1777 on both nodes.

Install node-scripts/vega-prolog, vega-task-prolog, vega-epilog,
vega-thermal-guard, and vega-thermal-watch under /usr/local/sbin.

Install the module tree:

~~~text
/ceph/hpc/software/modulefiles/gnu/13.3.0
/ceph/hpc/software/modulefiles/openmpi/4.1.6
/ceph/hpc/software/modulefiles/vega-test/1.0
~~~

Install config/modules/vega-modules.sh as /etc/profile.d/vega-modules.sh.

Install node-scripts/apptainer as /usr/local/bin/apptainer when Ubuntu provides
SingularityCE but not the literal apptainer command.

Enable config/systemd/vega-thermal-watch.service on both nodes.

## 13. Apply The Firewall Last

Confirm console or working administration SSH first.

On both nodes:

~~~bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow in on wlan0 from 192.168.1.0/24 to any port 22 proto tcp
sudo ufw allow in on eth0 from 10.10.0.0/24 comment 'Vega private fabric'
sudo ufw enable
~~~

The private-fabric allow rule is intentionally interface-bound. Do not replace
it with a global 10.10.0.0/24 allow rule.

Do not add any allow rule for the login USB Ethernet adapter until ingress,
relay placement, host-key identity, rate limiting, and exposure are reviewed.

## 14. Reboot And Acceptance Gate

With no active jobs:

1. reboot login;
2. wait for SSH, IPA DNS/HTTPS, NFS, Slurm, and SSSD;
3. verify the worker's existing NFS mount recovers;
4. run a short CPU job;
5. reboot worker;
6. verify NFS automount and Slurm registration;
7. run all tests in ACCEPTANCE.md.

Never reboot both nodes together during preparation.
