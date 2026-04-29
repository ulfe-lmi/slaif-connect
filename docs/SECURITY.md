# SLAIF Connect — Security Model and Threat Model

This document defines the security rules for the no-fork, mandatory WebSocket relay implementation.

## Core security principle

SLAIF must not become the SSH client and must not receive SSH credentials.

Allowed:

```text
extension SSH client  →  encrypted SSH transport  →  HPC sshd
```

Not allowed:

```text
browser  →  SLAIF server-side SSH client  →  HPC sshd
```

## Security guarantees

SLAIF Connect is designed around three guarantees:

1. SSH credentials remain local to the user's browser/extension environment.
2. SSH encryption remains end-to-end between the extension SSH client and the real HPC sshd.
3. Only approved SLAIF HPC aliases are reachable.

## Relay trust model

The SLAIF web server may act as the WebSocket-to-TCP relay.

The relay is trusted for:

- availability;
- session orchestration;
- server-side destination allowlist enforcement;
- metadata such as who connected, when, and to which approved alias.

The relay is not trusted for:

- SSH passwords;
- OTPs;
- private keys;
- passphrases;
- decrypted command output;
- choosing SSH host identity.

The relay must forward bytes only.

## What the relay can observe

Even with end-to-end SSH, the relay can observe metadata:

- connection time;
- duration;
- user/session id if encoded in the relay token mapping;
- selected HPC alias;
- traffic volume;
- connection failures.

It must not log binary SSH payloads.

## Main active attack: fake SSH endpoint

A malicious or compromised relay could try:

```text
extension asks for vegahpc
relay connects to attacker fake sshd
fake sshd asks user for password/OTP
```

This attack fails only if the extension verifies the HPC host key or host CA before authentication.

Required behavior:

```text
unknown host key       → reject before auth prompt
changed host key       → reject before auth prompt
wrong host certificate → reject before auth prompt
```

Prototype-only behavior:

```text
unknown host key → loud warning → manual accept
```

Production-prohibited behavior:

```text
silently accept unknown host keys
ignore changed host keys
StrictHostKeyChecking=no style behavior
```

## SSH host identity policy

Each approved HPC entry should include one of:

- pinned host key entries;
- a pinned SSH host CA public key;
- an enterprise-managed host-key source whose integrity is verified before use.

For multi-login-node HPC systems, host certificates signed by an HPC-operated host CA are preferred.

The SSH known-hosts lookup should use a stable alias such as `vegahpc`, not the relay hostname.

Recommended OpenSSH-style options:

```text
StrictHostKeyChecking=yes
CheckHostIP=no
HostKeyAlias=<hpc-alias>
ForwardAgent=no
ForwardX11=no
ClearAllForwardings=yes
```

## Agent and forwarding rules

Default production behavior:

```text
agent forwarding: disabled
X11 forwarding: disabled
local port forwarding: disabled
remote port forwarding: disabled
dynamic forwarding: disabled
SFTP subsystem: disabled unless required
```

Rationale: SLAIF Connect is a job launcher, not a general SSH workstation.

## Destination allowlist

The browser extension enforces an alias allowlist.

The relay also enforces a server-side allowlist.

Both are required:

```text
extension policy: blocks malicious web page / compromised page from asking arbitrary hosts
relay policy: prevents relay from becoming an open TCP proxy
```

The relay must not accept this:

```json
{"host":"anything.example","port":22}
```

It should accept this:

```json
{"relayToken":"short-lived-token"}
```

Then it resolves server-side:

```text
relayToken → approved session → approved HPC alias → fixed host:port
```

## Command execution policy

The web server must not send arbitrary shell commands.

Preferred design:

```text
extension policy contains fixed template
server provides only session id / workflow id
extension validates id
extension constructs command
```

Example:

```text
/opt/slaif/bin/slaif-launch --session sess_abc123
```

Session ids must be validated with a strict allowlist pattern before being placed into a command.

## Compromised component analysis

### Compromised SLAIF web page

Possible impact:

- requests connection to an allowed alias;
- tries malformed session ids;
- tries to trigger repeated sessions.

Mitigations:

- `externally_connectable` allowlist;
- runtime sender-origin verification;
- extension-side alias allowlist;
- strict session id validation;
- no arbitrary command strings accepted.

### Compromised SLAIF relay/web server

Possible impact:

- denial of service;
- traffic metadata exposure;
- rerouting to fake SSH server;
- issuing malicious workflow metadata.

Mitigations:

- extension-side host-key verification;
- extension-side command templates;
- no trust in server-provided host keys unless signed by trusted admin key;
- relay egress firewall;
- short-lived relay tokens.

### Compromised browser profile

Possible impact:

- stored SSH keys may be stolen;
- extension storage may be read by local malware.

Mitigations:

- encrypted private key storage;
- passphrase-protected keys;
- avoid storing passphrases;
- consider hardware-backed keys in future.

### Malicious extension impersonation

Possible impact:

- rogue extension tries to connect to relay.

Mitigations:

- relay token validation;
- extension id/origin checks where possible;
- user/session binding;
- short TTL;
- server-side authorization.

## Minimum security tests

Before real HPC testing, implement these:

1. Relay rejects missing, malformed, expired, and reused tokens.
2. Relay never accepts client-supplied host/port.
3. Relay egress firewall allows only approved HPC login nodes.
4. Fake SSH server with wrong host key is rejected before auth prompt.
5. Changed host key is rejected.
6. Malicious web origin cannot launch the extension.
7. Malformed session ids are rejected before SSH starts.
8. Relay logs do not include SSH binary payloads.
9. Agent forwarding is disabled.
10. X11 and port forwarding are disabled.

## Security review rule

Reject any change that weakens one of these properties:

```text
credentials stay local
SSH stays end-to-end
extension verifies HPC host identity
only approved aliases are reachable
server cannot send arbitrary shell
relay is not an open TCP proxy
```
