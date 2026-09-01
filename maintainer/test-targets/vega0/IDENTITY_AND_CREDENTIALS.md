# Identity And Credential Recipe

This recipe creates only the disposable central test identity. It must not
modify the pre-existing administrative account.

Run IPA commands as an authenticated IPA administrator, either inside the
fido-ipa container or from an enrolled host with a valid admin Kerberos ticket.

## 1. Create Protected Local Test Material

Choose a directory outside this repository:

~~~bash
umask 077
VEGA0_CREDENTIAL_DIR=$HOME/.local/share/vega0-lab
install -d -m 0700 "$VEGA0_CREDENTIAL_DIR"
~~~

Generate an automation-only Ed25519 keypair:

~~~bash
ssh-keygen -t ed25519 \
  -N '' \
  -C vega0-lab-user \
  -f "$VEGA0_CREDENTIAL_DIR/user_ed25519"
chmod 0600 "$VEGA0_CREDENTIAL_DIR/user_ed25519"
chmod 0644 "$VEGA0_CREDENTIAL_DIR/user_ed25519.pub"
~~~

An unencrypted private key is acceptable only for this isolated disposable
test target. A production identity should use a protected key, agent, hardware
token, or site-approved credential mechanism.

Generate a random initial password and a 160-bit base32 TOTP seed:

~~~bash
python3 -c 'import secrets; print(secrets.token_urlsafe(24))' \
  > "$VEGA0_CREDENTIAL_DIR/user_password.txt"

python3 -c 'import base64,secrets; print(base64.b32encode(secrets.token_bytes(20)).decode().rstrip(\"=\"))' \
  > "$VEGA0_CREDENTIAL_DIR/user_totp_seed.txt"

chmod 0600 \
  "$VEGA0_CREDENTIAL_DIR/user_password.txt" \
  "$VEGA0_CREDENTIAL_DIR/user_totp_seed.txt"
~~~

Do not print these values into logs or copy them into issues, pull requests,
result bundles, shell scripts, JSON configs, or signed policy.

## 2. Acquire An IPA Admin Ticket

Inside the server container:

~~~bash
sudo podman exec -it fido-ipa bash
kinit admin
ipa ping
~~~

The remaining ipa commands in this document run in that authenticated shell.

## 3. Confirm Host And DNS Records

Client enrollment should create host entries. Verify:

~~~bash
ipa host-show vega0-login.vega0.test
ipa host-show vega0-worker.vega0.test
~~~

Create or correct private A records:

~~~bash
ipa dnsrecord-add vega0.test fido --a-rec=10.10.0.1
ipa dnsrecord-add vega0.test vega0-login --a-rec=10.10.0.1
ipa dnsrecord-add vega0.test vega0-worker --a-rec=10.10.0.2
~~~

If a record already exists, use dnsrecord-mod rather than creating a duplicate.
Verify the IPA-generated Kerberos SRV records:

~~~bash
ipa dnsrecord-show vega0.test _kerberos._tcp
ipa dnsrecord-show vega0.test _kpasswd._tcp
~~~

## 4. Create The HPC Group And User

~~~bash
ipa group-add hpc-users --desc='Vega0 lab HPC users'

ipa user-add user \
  --first=Vega \
  --last=Test \
  --homedir=/ceph/hpc/home/user \
  --shell=/bin/bash

ipa group-add-member hpc-users --users=user
~~~

Set the initial password interactively:

~~~bash
ipa passwd user
~~~

An administrator-set password can be marked for immediate change. For a fully
automated disposable target, explicitly set a bounded test-only expiration
after confirming the account policy:

~~~bash
ipa user-mod user \
  --setattr=krbPasswordExpiration=20301231235959Z
~~~

Do not copy that long-lived test behavior into production policy.

Attach the public key and require OTP authentication:

~~~bash
ipa user-mod user \
  --sshpubkey="$(cat /LOCAL/PATH/user_ed25519.pub)" \
  --user-auth-type=otp
~~~

When running inside the container, copy only the public key into a temporary
container-visible path or paste the public-key line. Never copy the private key
into the IPA container.

Verify:

~~~bash
ipa user-show user --all
ipa group-show hpc-users --all
~~~

## 5. Create The TOTP Token

Read the locally generated seed without echoing it:

~~~bash
read -rsp 'TOTP base32 seed: ' VEGA0_TOTP_SEED
printf '\n'
~~~

Create an admin-managed token:

~~~bash
ipa otptoken-add user-test \
  --owner=user \
  --type=totp \
  --algo=sha1 \
  --digits=6 \
  --interval=30 \
  --key="$VEGA0_TOTP_SEED" \
  --no-qrcode
unset VEGA0_TOTP_SEED
~~~

Verify metadata without exposing the key:

~~~bash
ipa otptoken-show user-test
~~~

FreeIPA treats the OTP as one-time: a code accepted once must not authenticate
again. Automated tests must wait for a fresh interval for each SSH login.

## 6. Create Login-Only HBAC

Create the login hostgroup and rule:

~~~bash
ipa hostgroup-add hpc-login --desc='Vega0 SSH login nodes'
ipa hostgroup-add-member hpc-login --hosts=vega0-login.vega0.test

ipa hbacrule-add hpc-users-login
ipa hbacrule-add-user hpc-users-login --group=hpc-users
ipa hbacrule-add-host hpc-users-login --hostgroup=hpc-login
ipa hbacrule-add-service hpc-users-login --hbacsvcs=sshd
~~~

Test both decisions before disabling the default rule:

~~~bash
ipa hbactest \
  --user=user \
  --host=vega0-login.vega0.test \
  --service=sshd \
  --rules=hpc-users-login

ipa hbactest \
  --user=user \
  --host=vega0-worker.vega0.test \
  --service=sshd \
  --rules=hpc-users-login
~~~

Expected results:

~~~text
login:  Access granted: True
worker: Access granted: False
~~~

Only after those results:

~~~bash
ipa hbacrule-disable allow_all
ipa hbacrule-show hpc-users-login
~~~

Open a second administrative SSH session before closing the first one. Confirm
the existing local administrative account still authenticates on both nodes.

## 7. Install The Login SSH Match Rule

Install config/ssh/60-ssh-user-vega.conf on the login node only.

~~~bash
sudo install -o root -g root -m 0644 \
  config/ssh/60-ssh-user-vega.conf \
  /etc/ssh/sshd_config.d/60-ssh-user-vega.conf

sudo sshd -t
sudo systemctl reload ssh
~~~

Inspect the effective Match result:

~~~bash
sudo sshd -T \
  -C user=user,host=vega0-login.vega0.test,addr=192.168.1.10 \
  | grep -E 'authenticationmethods|authorizedkeyscommand|passwordauthentication|kbdinteractiveauthentication|allowtcpforwarding'
~~~

The worker must not receive this drop-in. HBAC remains the authoritative worker
denial.

## 8. Resolve The User On Both Nodes

~~~bash
getent passwd user
id user
sssctl user-checks -a acct user
~~~

The numeric UID/GID values must match on both nodes before creating home/project
directories or submitting Slurm jobs.

Create storage using the resolved values:

~~~bash
TEST_UID=$(id -u user)
TEST_GID=$(id -g user)
sudo install -d -m 0700 -o "$TEST_UID" -g "$TEST_GID" /ceph/hpc/home/user
sudo install -d -m 2770 -o "$TEST_UID" -g "$TEST_GID" /ceph/hpc/project/demo-users
~~~

## 9. Create The Slurm Association

After SSSD resolution succeeds:

~~~bash
sudo sacctmgr -i add user user \
  Account=demo-users \
  DefaultAccount=demo-users \
  Fairshare=1000
~~~

Verify:

~~~bash
sacctmgr show assoc where cluster=vega0 account=demo-users user=user
sshare -A demo-users -a
~~~

## 10. Test Authentication

Positive:

~~~bash
ssh \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile="$VEGA0_CREDENTIAL_DIR/verified_known_hosts" \
  -o HostKeyAlias=vega0-lab \
  -i "$VEGA0_CREDENTIAL_DIR/user_ed25519" \
  user@192.168.1.200
~~~

At the PAM Password prompt, enter the account password immediately followed by
the current six-digit TOTP value, with no separator.

Negative:

~~~bash
ssh \
  -o BatchMode=yes \
  -o PreferredAuthentications=publickey \
  -o PasswordAuthentication=no \
  -i "$VEGA0_CREDENTIAL_DIR/user_ed25519" \
  user@192.168.1.162 true
~~~

The worker connection must fail.

## 11. Rotation And Teardown

For a rebuilt target:

- generate a new test key and TOTP seed;
- replace the IPA SSH key and OTP token;
- delete obsolete tokens;
- rotate user/IPA/database passwords;
- regenerate verified known-host data if host SSH keys changed;
- regenerate signed pilot policy when SSH identity or endpoint changes.

Before disposal, revoke/delete the IPA user and tokens and securely remove local
credential material.
