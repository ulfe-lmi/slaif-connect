# SLAIF Extension — AGENTS.md

This file defines the **mission, architecture, and coding constraints** for AI agents working in this repository.

The repository is a fork of Chromium's **Secure Shell (nassh)** codebase adapted to implement a **minimal SLAIF browser SSH client**.

Agents must follow the rules below strictly.

For system design see:
ARCHITECTURE.md

For security constraints see:
SECURITY.md

---

# Mission

This extension provides a **browser-based SSH client specialized for SLAIF workflows**.

Its purpose is **NOT** to be a general SSH client.

Instead, it enables the following workflow:

1. Connect to an approved HPC login node
2. Authenticate with **SSH key + OTP**
3. Receive a command from the SLAIF service ("machine X")
4. Execute that command on the HPC system
5. Return job information back to the SLAIF service
6. Allow the HPC job to communicate directly with the SLAIF service

The extension acts as a **secure bridge between the user browser and the HPC system**.

---

# Security Model

The following rules are **non-negotiable**:

## Credentials never leave the browser

SSH credentials must remain on the user machine.

Specifically:

- private keys remain in browser storage
- passphrases are never stored in plaintext
- OTP/password prompts occur only inside the SSH client
- SLAIF servers must never receive credentials

The SSH handshake must always be:

browser SSH client → sshd on HPC

Never:

browser → SLAIF server → sshd

The SLAIF server **must never terminate SSH sessions**.

---

# Allowed SSH destinations

The extension must never allow arbitrary SSH connections.

Allowed hosts are defined in:
```

nassh/config/SLAIF.conf

```

Example allowlist:
```

\[allowlist\]  
vpnhome=192.168.1.9  
dhcplmi=192.168.90.3  
stare=stare.lmi.link  
arneshpc=hpc-login.arnes.si  
vegahpc=login.vega.izum.si  
vegahpccpu=logincpu.vega.izum.si  
vegahpcgpu=gpulogingpu.vega.izum.si

```

Connections are validated at runtime.

---

# Host validation logic

Validation occurs in:
```

nassh/js/nassh\_command\_instance.js

```

The validation process:

1. Load `SLAIF.conf`
2. Parse only the `[allowlist]` section
3. Accept either:

   - hostnames listed directly
   - alias keys defined in the file

Example:
```

vegahpc

```

resolves to
```

login.vega.izum.si

```

before final connection.

---

# Host normalization

All host comparisons must normalize hostnames exactly as the existing implementation does.

Required normalization steps:

1. `punycode.toASCII(host)`
2. convert to lowercase
3. remove trailing dots

No other comparison logic should be used.

---

# Communication with SLAIF service (machine X)

After establishing the SSH session, the extension connects to the SLAIF service via **WebSocket**.

The SLAIF service is referred to as **machine X**.

The WebSocket connection is used to:

1. identify the browser session
2. receive commands to execute on the HPC system
3. report job IDs or command results

Example conceptual flow:
```

browser extension  
│  
├── SSH → HPC  
│  
└── WebSocket → machine X

```

Machine X sends commands such as:
```

sbatch /path/to/slaif-wrapper.sh <session>

```

The extension executes the command in the SSH session.

---

# Relay architecture (if used)

If a relay is deployed:
```

extension → websocket relay → HPC sshd

```

The relay must be a **dumb TCP forwarder**.

It must:

- not parse SSH packets
- not terminate SSH
- not store credentials
- enforce destination allowlists only

---

# Key management

SSH keys must remain local.

Allowed storage mechanisms:

- `chrome.storage.local`
- `IndexedDB`

Keys must never be transmitted to any SLAIF server.

Preferred key handling:

- encrypted storage
- unlock per session

Passphrases must never be stored unencrypted.

---

# UI scope

The UI must remain minimal.

Allowed UI elements:

- terminal
- login prompt
- optional key import

Avoid implementing:

- full SSH configuration panels
- multi-host SSH management
- SCP / file transfer
- port forwarding
- tunneling

This extension is **SLAIF-specific**, not a general SSH client.

---

# Coding priorities

When making design decisions, prioritize:

1. Security
2. Simplicity
3. Minimal footprint
4. Maintainability

Agents should prefer **removing code rather than adding complexity**.

---

# Forbidden changes

Agents must not introduce:

- arbitrary SSH connections
- server-side credential handling
- SSH termination on SLAIF servers
- unnecessary UI complexity
- new generic SSH features

---

# Development expectations for AI agents

Agents modifying the repository should:

1. preserve the SLAIF security model
2. keep the extension minimal
3. avoid feature creep
4. prefer small, auditable changes

When in doubt, ask:

> Does this make the extension a general SSH client?

If the answer is yes, the change is probably wrong.
