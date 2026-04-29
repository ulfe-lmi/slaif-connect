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

cat >/etc/ssh/sshd_config_slaif_test <<'EOF'
Port 22
ListenAddress 0.0.0.0
HostKey /keys/ssh_host_ed25519_key
PidFile /run/sshd.pid
AuthenticationMethods publickey
PubkeyAuthentication yes
PasswordAuthentication no
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
