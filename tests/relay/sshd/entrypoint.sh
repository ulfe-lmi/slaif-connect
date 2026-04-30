#!/bin/sh
set -eu

if [ ! -f /keys/ssh_host_ed25519_key ]; then
  echo "missing /keys/ssh_host_ed25519_key" >&2
  exit 1
fi

if [ ! -f /keys/authorized_keys ]; then
  echo "missing /keys/authorized_keys" >&2
  exit 1
fi

cp /keys/authorized_keys /home/testuser/.ssh/authorized_keys
chown testuser:testuser /home/testuser/.ssh/authorized_keys
chmod 600 /home/testuser/.ssh/authorized_keys

auth_methods="publickey"
password_auth="no"
if [ "${SLAIF_TEST_PASSWORD:-}" ]; then
  echo "testuser:${SLAIF_TEST_PASSWORD}" | chpasswd
  auth_methods="password"
  password_auth="yes"
fi

cat >/etc/ssh/sshd_config_slaif_test <<EOF
Port 22
ListenAddress 0.0.0.0
HostKey /keys/ssh_host_ed25519_key
PidFile /run/sshd.pid
AuthenticationMethods ${auth_methods}
PubkeyAuthentication yes
PasswordAuthentication ${password_auth}
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PermitRootLogin no
AllowUsers testuser
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding no
PermitTunnel no
PermitTTY no
StrictModes no
LogLevel VERBOSE
EOF

exec /usr/sbin/sshd -D -e -f /etc/ssh/sshd_config_slaif_test
