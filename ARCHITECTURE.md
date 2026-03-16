# SLAIF Extension — Architecture

This document explains the architecture of the **SLAIF browser SSH extension** and its interaction with the SLAIF service ("machine X") and HPC systems.

The goal is to provide a **secure, minimal, browser-based SSH bridge** between users and SLAIF compute assets.

---

# System Overview

The system consists of three main components:

1. **SLAIF Browser Extension**
2. **SLAIF Service ("machine X")**
3. **HPC Systems**

Optional component:

4. **WebSocket TCP relay**

The extension is responsible for:

- SSH communication with HPC
- receiving commands from the SLAIF service
- executing those commands on HPC
- reporting results back to the SLAIF service

The SLAIF service orchestrates workloads but **never sees user SSH credentials**.

---

# High-Level Architecture
```

User Browser  
│  
│ (SLAIF Extension)  
│  
├──────── SSH ────────► HPC sshd  
│  
└──── WebSocket ──────► SLAIF Service (machine X)

```

If a relay is used:
```

Extension  
│  
├─ WebSocket → Relay → TCP → HPC sshd  
│  
└─ WebSocket → machine X

```

---

# Security Model

The architecture enforces the following rules:

### Credentials stay local

SSH credentials must never leave the browser.

Private keys are stored locally in the extension.

Authentication occurs only between:
```

extension → sshd

```

The SLAIF service **must never receive SSH credentials**.

---

### End-to-End SSH Encryption

If a relay is used, it only forwards encrypted packets.
```

SSH client → encrypted packets → relay → sshd

```

The relay must not:

- terminate SSH
- inspect packets
- store credentials

---

# Connection Flow

## 1. Extension startup

The extension initializes:

- terminal UI
- SSH subsystem
- configuration loader

It loads the allowlist from:
```

nassh/config/SLAIF.conf

```

Only allowed hosts may be connected.

---

## 2. SSH connection

User initiates a connection using one of the predefined host aliases.

Example:
```

vegahpc

```

Alias resolution:
```

vegahpc → login.vega.izum.si

```

The extension validates the destination against the allowlist.

If validation fails, the connection is rejected.

---

## 3. SSH authentication

Authentication happens normally through the SSH client.

Supported methods:

- private key
- passphrase
- OTP

The extension never transmits credentials to any SLAIF server.

---

## 4. SLAIF service connection

After SSH session is established, the extension connects to the SLAIF service.
```

wss://machine-x/extension

```

The WebSocket is used for orchestration only.

---

## 5. Command dispatch

Machine X sends instructions to the extension.

Example:
```

run: sbatch /path/to/slaif-wrapper.sh SESSION\_ID

```

The extension executes the command in the SSH session.

---

## 6. Job launch

The HPC system schedules the job via SLURM.

Example:
```

Submitted batch job 123456

```

The extension parses the job ID.

---

## 7. Job reporting

The extension reports the job ID back to machine X.

Example message:
```

{  
"type": "job\_started",  
"session": "abc123",  
"job\_id": "123456"  
}

```

---

## 8. Job execution

The HPC job runs the SLAIF asset.

The asset communicates directly with machine X:
```

HPC job → machine X

```

The browser extension is no longer required.

---

# Relay Architecture (Optional)

If direct SSH sockets are not possible in the browser environment, a relay may be used.

Relay behavior:
```

WebSocket → TCP forwarder

```

Relay responsibilities:

- forward encrypted SSH packets
- enforce destination allowlist
- prevent arbitrary host access

Relay must not:

- parse SSH
- store credentials
- inspect commands

---

# Key Storage

Private keys are stored locally inside the browser extension.

Allowed storage:

- chrome.storage.local
- IndexedDB

Keys should be encrypted when stored.

Passphrases must never be stored in plaintext.

Keys must never be transmitted to the SLAIF service.

---

# Configuration

Connection rules are defined in:
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

Aliases are resolved before connection.

---

# Host Validation

Hostnames must be normalized before comparison:

1. punycode.toASCII()
2. lowercase
3. remove trailing dots

The normalized host must match the allowlist.

---

# Responsibilities Summary

## Extension

Handles:

- SSH session
- credential storage
- command execution
- job reporting
- WebSocket communication with SLAIF service

---

## SLAIF Service (machine X)

Handles:

- session orchestration
- workload definition
- job tracking
- HPC asset communication

Does NOT handle:

- SSH credentials
- SSH sessions

---

## HPC

Handles:

- authentication
- job scheduling
- compute execution

---

# Design Goals

The architecture is designed to provide:

- strong credential isolation
- minimal client complexity
- predictable HPC access
- strict destination control

The extension must remain focused on SLAIF workflows and avoid becoming a general SSH client.

---

# Future Extensions

Possible future additions:

- hardware token authentication
- improved key vault
- multiple SLAIF environments

These must preserve the security model described above.
