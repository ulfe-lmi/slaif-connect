# SLAIF Connect

**SLAIF Connect** is a browser-based SSH extension for launching and controlling
**SLAIF workloads on approved HPC systems**.

This repository started as a fork of Chromium's **libapps / Secure Shell (`nassh`)**
codebase, but its purpose is now much narrower:

- connect only to approved SLAIF HPC login nodes,
- authenticate the user with their normal HPC credentials,
- open a control channel to the SLAIF service,
- receive commands from the SLAIF service,
- execute those commands on the HPC system,
- return job metadata (for example SLURM job IDs) back to the SLAIF service.

This project is **not** a general-purpose SSH client.

---

## What SLAIF Connect does

SLAIF Connect acts as the browser-side bridge between:

1. the **user**,
2. the **SLAIF service** ("machine X"),
3. and the **target HPC systems**.

The extension establishes:

- an **SSH session** to the selected HPC login node, and
- a **WebSocket control connection** to the SLAIF service.

The SLAIF service tells the extension what should be executed on the HPC system.
The extension executes that command inside the SSH session and reports results
such as job IDs back to the SLAIF service.

---

## Architecture

High-level architecture:

```text
User Browser
   │
   ├── SSH ───────────────────────────────► HPC sshd
   │
   └── WebSocket ─────────────────────────► SLAIF service ("machine X")
````

Optional deployment if browser networking requires a relay:

```
Extension ── WebSocket ──► dumb relay ── TCP ──► HPC sshd
         └─ WebSocket ──► machine X
```

### Important security rule

The SLAIF service must **never terminate SSH** and must **never receive SSH credentials**.

SSH authentication always happens directly between the browser SSH client and the  
HPC SSH server.

* * *

Security model
--------------

SLAIF Connect is built around three core guarantees:

1.  **Credentials stay local to the user machine**
    *   private keys remain in browser-managed local storage,
    *   passphrases must not be stored in plaintext,
    *   OTP or other interactive prompts happen only in the SSH flow.
2.  **SSH remains end-to-end**
    *   if a relay is used, it must be a **dumb TCP forwarder only**,
    *   the relay may enforce destination allowlists,
    *   the relay must not inspect or terminate SSH.
3.  **Only approved hosts are reachable**
    *   this extension must not allow arbitrary SSH destinations,
    *   it is intentionally restricted to SLAIF-approved targets.

For the full threat model, see `SECURITY.md`.

* * *

Allowed SSH destinations
------------------------

Allowed destinations are defined in:

```
nassh/config/SLAIF.conf
```

Only the `[allowlist]` section is currently used.

Example:

```
[allowlist]
arneshpc=hpc-login.arnes.si
vegahpc=login.vega.izum.si
vegahpccpu=logincpu.vega.izum.si
vegahpcgpu=gpulogingpu.vega.izum.si
```

The allowlist serves two purposes:

*   **whitelist**: direct host/IP values listed there are allowed,
*   **predefined connection names**: alias keys such as `vegahpc` are accepted and  
    resolved to their mapped host before connection.

Host validation and alias resolution are implemented in:

```
nassh/js/nassh_command_instance.js
```

Hostname normalization follows existing `nassh` behavior:

1.  `punycode.toASCII(...)`
2.  lowercase
3.  trim trailing dots

* * *

SLAIF workflow
--------------

A typical SLAIF workflow looks like this:

1.  The user opens a SLAIF web page.
2.  The extension connects to an approved HPC login node.
3.  The user authenticates with their normal HPC credentials.
4.  The extension opens a WebSocket connection to the SLAIF service.
5.  The SLAIF service sends the command that should be executed on HPC.
6.  The extension executes that command in the SSH session.
7.  If the command starts a SLURM job, the extension captures the returned job ID.
8.  The extension sends the job ID back to the SLAIF service.
9.  The HPC-side SLAIF asset later communicates directly with the SLAIF service.

In short:

*   **SSH** is used for secure execution on HPC,
*   **WebSocket** is used for SLAIF orchestration.

* * *

Repository structure
--------------------

This repository still contains upstream libapps components, but only some of them  
are central to SLAIF Connect.

### Main SLAIF-relevant directories

*   [`nassh/`](./nassh/) — the main browser SSH extension codebase and the primary  
    area for SLAIF-specific development.
*   `nassh/config/SLAIF.conf` — SLAIF host allowlist  
    and alias definitions.
*   [`hterm/`](./hterm/) — terminal emulator used by the SSH client.
*   [`libdot/`](./libdot/) — shared JS utility code inherited from upstream.

### Upstream runtime components

*   [`ssh_client/`](./ssh_client/) — WASM port of OpenSSH.
*   [`wassh/`](./wassh/) — JS portion of the WASM OpenSSH runtime.
*   [`wasi-js-bindings/`](./wasi-js-bindings/) — WASI JS bindings used by the runtime.

### Components not central to SLAIF Connect

*   [`terminal/`](./terminal/) — upstream ChromeOS Terminal application code.  
    This repository is **not** developing the general ChromeOS terminal product.

* * *

Documentation
-------------

Before making changes, read:

*   `AGENTS.md` — instructions for coding agents / Codex
*   `ARCHITECTURE.md` — system design and runtime flow
*   `SECURITY.md` — security guarantees and threat model

These documents define the intended direction of the project.

* * *

Development goals
-----------------

When working on this project, prioritize:

1.  security,
2.  minimal footprint,
3.  simplicity,
4.  maintainability.

Avoid turning SLAIF Connect into a feature-rich generic SSH client.

If a proposed change makes the extension more like a general SSH product,  
it is probably the wrong change.

* * *

Upstream origin
---------------

This repository is based on Chromium's **libapps / Secure Shell (`nassh`)**  
codebase.

Relevant upstream project:

*   [https://chromium.googlesource.com/apps/libapps](https://chromium.googlesource.com/apps/libapps)

SLAIF Connect keeps selected upstream components, but the product direction here  
is SLAIF-specific and differs from the upstream generic Secure Shell project.
