# SLAIF Connect — Relay-Only Architecture

This document replaces the old fork-oriented architecture with the no-fork, mandatory-relay design.

SLAIF Connect is a browser-side SSH launcher for approved HPC systems. It is not a general-purpose SSH product. Its purpose is to let SLAIF launch and track HPC workloads while keeping the user's SSH credentials out of SLAIF infrastructure.

## Core idea

```text
SLAIF web page
   │
   │ externally_connectable message
   ▼
SLAIF Connect Chrome extension
   │
   │ WSS carrying encrypted SSH packets
   ▼
SLAIF web server relay endpoint
   │
   │ TCP
   ▼
HPC sshd
```

The extension runs the SSH client. The HPC login node runs the SSH server. The web server forwards bytes.

The safe form is:

```text
extension SSH client  ← encrypted SSH transport →  HPC sshd
```

The unsafe form, which this project must avoid, is:

```text
browser  →  SLAIF server-side SSH client  →  HPC sshd
```

## Components

### 1. SLAIF web page

Responsible for:

- starting a SLAIF workflow;
- asking the extension to connect to a named HPC alias;
- providing a short-lived session id or relay token;
- receiving job metadata after job launch.

Not trusted for:

- defining arbitrary SSH hosts;
- supplying arbitrary remote shell commands;
- supplying trusted SSH host keys.

### 2. SLAIF Connect extension

Responsible for:

- enforcing approved HPC aliases;
- loading and verifying signed HPC policy;
- verifying the SSH host key or host CA for the selected HPC alias;
- opening the SSH client runtime;
- authenticating the user through normal SSH flows;
- running the fixed SLAIF launcher command;
- parsing job metadata such as SLURM job ids;
- reporting job metadata back to SLAIF.

Trusted with:

- SSH private keys, if the user stores them in the extension;
- passphrase/OTP prompts during the SSH authentication flow;
- host-key verification decisions.

### 3. SLAIF web server relay

Responsible for:

- accepting WSS relay connections from the extension;
- validating short-lived relay tokens;
- mapping each token to a server-side approved HPC alias;
- opening TCP to the fixed HPC host/port for that alias;
- forwarding bytes in both directions.

Not trusted with:

- SSH passwords;
- OTPs;
- passphrases;
- private keys;
- decrypted SSH terminal traffic.

The relay must not expose an arbitrary TCP proxy API.

### 4. HPC sshd

Responsible for:

- SSH host identity;
- user authentication;
- HPC-side authorization;
- job submission and scheduling;
- remote execution.

## Runtime flow

### Step 1 — web page asks extension to start

```js
chrome.runtime.sendMessage(EXTENSION_ID, {
  type: 'slaif.startSession',
  hpc: 'vegahpc',
  sessionId: 'sess_abc123'
});
```

The extension validates the sender origin through `externally_connectable` and its own runtime checks.

### Step 2 — extension resolves the HPC alias

The extension loads `extension/config/hpc_hosts*.json` and resolves:

```text
vegahpc → login.vega.izum.si:22
```

The web page and relay are not allowed to redefine this host.

### Step 3 — extension obtains relay session details

The extension calls the SLAIF API for a short-lived relay token bound to:

```text
user/session/hpc alias
```

The relay token must not contain an arbitrary client-provided host or port.

### Step 4 — extension opens WSS to relay

```text
extension → wss://connect.slaif.si/ssh-relay
```

The first message authenticates the relay token. After success, the connection switches to binary SSH byte forwarding.

### Step 5 — relay opens TCP to approved HPC login node

The relay performs server-side lookup:

```text
relay token → hpc alias → fixed host:port
```

Then:

```text
relay → TCP → login.vega.izum.si:22
```

### Step 6 — SSH handshakes end-to-end

The extension SSH client and HPC sshd establish the encrypted SSH transport. The relay only forwards packets.

The extension verifies the SSH host identity before authentication:

```text
expected alias: vegahpc
expected host key or host CA: from extension policy
presented host key: from HPC sshd
```

If the host key does not match, the extension must fail before the user sees a password or OTP prompt.

### Step 7 — user authenticates

The user authenticates normally through the SSH client:

- private key;
- passphrase;
- password;
- keyboard-interactive / OTP;
- institutional MFA flow supported by SSH.

SLAIF infrastructure must not receive those secrets.

### Step 8 — fixed SLAIF command runs

The extension should prefer a fixed remote command template:

```text
/opt/slaif/bin/slaif-launch --session sess_abc123
```

The web server should not be allowed to send arbitrary shell.

### Step 9 — extension captures metadata

Example SLURM output:

```text
Submitted batch job 123456
```

The extension parses the job id and reports it back to SLAIF:

```json
{
  "type": "job_started",
  "sessionId": "sess_abc123",
  "hpc": "vegahpc",
  "jobId": "123456"
}
```

### Step 10 — HPC job continues independently

After submission, the HPC-side SLAIF asset can communicate directly with SLAIF. The extension does not need to stay connected unless the workflow requires an interactive session.

## Dependency architecture

The project does not fork `nassh`.

It uses upstream `libapps` as a build-time dependency:

```text
third_party/libapps       upstream submodule, untouched
extension/vendor/libapps  generated copy used by the packaged extension
extension/plugin          generated/copied OpenSSH/WASM plugin artifacts
extension/js              SLAIF-specific logic
```

The extension must package all JavaScript and WASM locally. Runtime loading of upstream executable code from GitHub, Gitiles, CDN, or the SLAIF server is not allowed.

## Policy files

Signed policy shape:

```text
extension/config/hpc_policy.signed.example.json
extension/config/policy_trust_roots.example.json
```

Each host entry contains:

- alias;
- SSH hostname;
- SSH port;
- host-key alias;
- pinned known-hosts entries or host CA;
- fixed command template;
- relay policy metadata.

`hpc_hosts.example.json` remains documentation/example fallback data. Production-directed launch flow must use signed policy. The session descriptor may provide relay URL and relay token only within signed policy origin constraints.

## Security boundary

The critical security boundary is SSH host identity verification.

A malicious relay can try to route the connection to a fake SSH server. It cannot read a valid SSH session to the real HPC server, but it can trick the user into authenticating to the wrong server if the extension accepts an unknown or changed host key.

Therefore:

```text
No production connection may proceed with an unknown or mismatched host key.
```

The relay can improve perimeter security if the HPC center recognizes the SLAIF
web server as an approved relay or bastion source. For example, HPC firewall
rules may permit SSH only from the relay IP. That network control is useful, but
it must not replace normal SSH user authentication or extension-side host-key
verification.

## Non-goals

This project should not implement:

- a general SSH client UI;
- arbitrary SSH destination entry;
- arbitrary shell execution controlled by the web server;
- direct TCP sockets from Chrome extension;
- SFTP, port forwarding, X11 forwarding, or agent forwarding unless explicitly required by SLAIF.

## Future work

Possible later additions:

- signed remote policy updates;
- SSH host CA support;
- multiple SLAIF deployment environments;
- native helper fallback;
- enterprise policy integration;
- hardware-backed key storage.

All future additions must preserve the rule that SSH credentials do not pass through SLAIF infrastructure.
