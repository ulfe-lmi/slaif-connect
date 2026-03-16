# SECURITY.md

# SLAIF Browser SSH Extension — Security Model

This document defines the security architecture and threat model of the SLAIF extension.

The extension provides a browser-based SSH client used to launch jobs on HPC systems while ensuring that **user credentials never pass through SLAIF infrastructure**.

---

# Core Security Principle

The SLAIF service must **never have access to user SSH credentials**.

All authentication occurs **directly between the browser extension and the HPC SSH server**.
```

extension → sshd

```

Never:
```

browser → SLAIF service → sshd

```

SLAIF servers must not:

- terminate SSH sessions
- store SSH keys
- proxy authentication
- impersonate users

---

# Credential Storage

SSH credentials are stored only on the user machine.

Allowed locations:

- browser extension storage (`chrome.storage.local`)
- IndexedDB

Credentials must never be transmitted to any SLAIF service.

Private keys should be stored encrypted when possible.

Passphrases must never be stored in plaintext.

---

# Authentication

Supported authentication methods:

- SSH private key
- passphrase
- OTP

The authentication process occurs entirely inside the SSH client.

SLAIF services are not involved in authentication.

---

# SSH Session Security

SSH encryption must be **end-to-end between extension and HPC sshd**.
```

extension SSH client → sshd

```

If a relay is used, it only forwards encrypted packets.
```

SSH client → encrypted packets → relay → sshd

```

The relay must not:

- inspect SSH packets
- terminate SSH sessions
- modify SSH traffic
- log SSH payloads

---

# Allowed Destinations

The extension must only connect to explicitly approved hosts.

Allowed hosts are defined in:
```

nassh/config/SLAIF.conf

```

Example:
```

\[allowlist\]

vegahpc=login.vega.izum.si  
vegahpccpu=logincpu.vega.izum.si  
vegahpcgpu=gpulogingpu.vega.izum.si  
arneshpc=hpc-login.arnes.si

```

Connections to any other host must be rejected.

This prevents the extension from being used as a general SSH client.

---

# Host Validation

Hostnames must be normalized before comparison:

1. `punycode.toASCII()`
2. lowercase
3. remove trailing dots

Only normalized hosts present in the allowlist are permitted.

---

# WebSocket Communication

The extension communicates with the SLAIF service via WebSocket.

Example:
```

wss://machine-x/extension

```

This channel is used for orchestration only.

The SLAIF service may send commands such as:
```

sbatch /path/to/slaif-wrapper.sh SESSION

```

The extension executes these commands inside the SSH session.

The WebSocket channel must never transmit:

- SSH private keys
- passphrases
- authentication tokens

---

# Job Execution

After job launch, the HPC system executes the SLAIF asset.

The asset communicates directly with the SLAIF service:
```

HPC job → SLAIF service

```

The browser extension is no longer involved.

---

# Threat Model

The system is designed to mitigate the following threats.

## Compromised SLAIF server

Impact:

- cannot obtain SSH credentials
- cannot impersonate users on HPC

Reason:

- SSH authentication never passes through SLAIF servers.

---

## Compromised relay

Impact:

- attacker sees encrypted SSH packets only.

Reason:

- SSH encryption is end-to-end.

Relay must never terminate SSH.

---

## Malicious web page

Impact:

- cannot force arbitrary SSH connections.

Reason:

- extension enforces strict allowlist.

---

## Stolen browser profile

Impact:

- attacker may obtain stored SSH keys.

Mitigation:

- encrypted key storage recommended
- passphrase protection recommended.

---

# Security Requirements for Code Changes

Any code changes must preserve:

1. end-to-end SSH encryption
2. local-only credential storage
3. strict destination allowlist
4. separation between SSH authentication and SLAIF services

Changes that violate these principles must be rejected.

---

# Reporting Security Issues

Security issues should be reported privately to the maintainers.

Do not disclose vulnerabilities publicly before a fix is available.

---

# Summary

The SLAIF extension enforces three critical security guarantees:

1. **Credentials remain local to the user machine**
2. **SSH encryption is end-to-end**
3. **Only approved HPC hosts are reachable**

These guarantees must not be weakened.
