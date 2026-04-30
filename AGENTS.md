# AGENTS.md — SLAIF Connect Implementation Guide

This file is the operational guide for coding agents working on **SLAIF Connect**.

It captures the decisions already made in the design discussion and turns them into step-by-step implementation instructions. Treat this file as the first document to read before editing the repository.

SLAIF Connect is in an **early stage**. The goal is not to pretend the system is already complete. The goal is to build it deliberately, with the correct architecture, security boundaries, and test gates.

---

## Workflow rules

Every coding task must start from the latest `main` branch:

```bash
git checkout main
git pull --ff-only origin main
git checkout -b <feature-branch>
```

Do not push directly to `main`. Create a new feature branch for each task,
commit the intended changes, push the branch, and create a GitHub pull request
with `gh`. Do not merge your own PR.

Before committing, run the most relevant checks for the change. At minimum for
this starter repository, run:

```bash
npm test
```

## Project status documentation

`README.md` is the public project overview. `STATUS.md` is the current
progress and roadmap document.

Agents must update `STATUS.md` when a PR materially changes project state. Do
not claim a feature is working unless tests or explicit manual validation prove
it. Distinguish local prototype validation from production readiness, and do
not let `README.md` drift back into starter-skeleton language now that the
project has progressed.

---

## 0. One-sentence mission

Build a Chrome-compatible extension that lets SLAIF launch and track jobs on approved HPC systems while keeping SSH credentials local to the user's browser-side SSH client, using an end-to-end SSH session carried through a mandatory WebSocket-to-TCP relay.

The intended runtime path is:

```text
SLAIF web page
   ↓ externally_connectable message
SLAIF Connect Chrome extension
   ↓ SSH protocol over WSS
SLAIF web server relay endpoint
   ↓ raw TCP forwarding
HPC sshd
```

The extension is the SSH client. The HPC login node is the SSH server. The SLAIF web server may relay encrypted SSH bytes, but it must not terminate SSH and must not receive passwords, OTPs, passphrases, private keys, decrypted terminal I/O, or arbitrary SSH command authority.

---

## 1. Ground-truth decisions already made

Do not reopen these decisions unless explicitly instructed by the project owner.

### 1.1 The previous fork was a prototype, not the final architecture

The earlier `slaif-connect` project was a fork of Chromium `libapps` / Secure Shell (`nassh`). That fork helped clarify the product purpose and prototype useful ideas, especially:

- an approved-HPC alias model;
- `hpc` alias precedence over user-supplied host strings;
- browser-side SSH authentication;
- a desire to return job metadata such as SLURM job IDs;
- a strong security requirement that SLAIF must not receive SSH credentials.

The final direction is **not** to maintain a long-lived `nassh` fork.

The old fork may be used as a reference for ideas only. Do not copy the whole fork into this repository. Do not continue patching upstream `nassh` as the primary product.

### 1.2 The chosen route is the no-fork relay-only extension

The selected architecture is:

```text
New extension + mandatory WebSocket TCP relay
No long-lived nassh fork
Not direct TCP from Chrome
SSH over relay
Credentials local, if SSH is end-to-end
Extension-enforced allowlist
Extension-controlled command execution
```

This is the best true no-fork pure-extension route under the current constraints.

### 1.3 "No fork" does not mean "no upstream dependency"

SLAIF Connect may reuse upstream Chromium `libapps` components, but only as a **pinned build-time dependency**.

Correct:

```text
third_party/libapps        # upstream submodule, untouched
scripts/vendor-libapps.sh  # copies selected files into extension/vendor
extension/vendor           # generated vendored runtime files
```

Incorrect:

```text
the entire project is a fork of libapps
SLAIF-specific patches are applied directly inside third_party/libapps
remote JS/WASM is loaded from GitHub, Gitiles, CDN, or SLAIF server at runtime
```

Chrome extension executable code must be packaged with the extension. Runtime-loading executable JavaScript or WebAssembly from remote servers is not allowed for the product path.

### 1.3.1 Working with upstream libapps

Files under `third_party/libapps` are upstream-owned. Never edit them directly.
Never silently patch vendored upstream code.

SLAIF-specific code belongs under:

```text
extension/
server/
scripts/
tests/
docs/
```

Generated files under `extension/vendor` and `extension/plugin` are build
outputs. Do not commit them unless the project owner explicitly requests it.

Always preserve the no-fork direction:

- use build-time vendoring from the pinned upstream submodule;
- do not load executable JavaScript or WASM remotely at runtime;
- do not add `chrome.sockets` permissions;
- keep relay-only networking, with no direct TCP from the Chrome extension;
- future SSH integration must use the SLAIF relay adapter, not a direct TCP path.

If a future change appears to require changing `third_party/libapps`, stop and
propose one of these instead:

1. a local adapter around upstream APIs;
2. a minimal explicit patch-overlay strategy;
3. an upstreamable change.

### 1.3.2 Relay E2E harness

Before wiring browser-side OpenSSH/WASM, preserve the local relay E2E harness
and run it where the environment has Docker and OpenSSH available:

```bash
npm run test:relay
npm run test:relay:e2e
```

Do not weaken relay tests by accepting unknown host keys, accepting changed host
keys, disabling strict host-key checking, or treating host-key failures as
success. The host-key negative test is the local proof that a fake SSH server
behind the relay is rejected before trust is established.

`tools/ws-tcp-bridge.js` is development-only test code. Do not confuse it with
extension runtime code, and do not use it to justify direct TCP from the Chrome
extension. The production extension must use the relay adapter and bundled
browser-side OpenSSH/WASM.

### 1.4 Direct TCP from the extension is intentionally not the goal

Do not try to depend on `chrome.sockets.tcp`, raw TCP extension permissions, Secure Shell's special extension identity, or any direct-TCP capability.

The relay-only path exists specifically to avoid relying on Chrome raw TCP socket access.

The extension connects to:

```text
wss://<slaif-web-server>/ssh-relay
```

The SLAIF web server relay connects via TCP to the approved HPC `sshd`.

### 1.5 The relay can be the SLAIF web server

A separate TCP relay product is not required.

It is acceptable, and likely preferable, for the existing SLAIF web server to provide the WebSocket-to-TCP relay endpoint, provided it behaves as a byte-forwarding relay and does not terminate SSH.

The web server can be recognized by HPC as an approved relay/bastion source. That can improve perimeter control, auditing, and firewall policy. It must not replace normal SSH host authentication or user authentication.

### 1.6 "Yes, if SSH is end-to-end" has a strict meaning

End-to-end SSH means all of the following:

1. The SSH client runs inside the Chrome extension.
2. The SSH server is the real HPC `sshd`.
3. The SLAIF web server only forwards encrypted SSH bytes.
4. The SLAIF web server never receives SSH passwords, OTPs, passphrases, private keys, or decrypted SSH payloads.
5. The extension verifies the HPC host key or host CA before user authentication.
6. The extension does not let the web page or relay redefine the SSH host identity.
7. The remote command is chosen from extension policy, not arbitrary web-server input.

If any of these are false, the security model changes and must be reviewed.

---

## 2. Purpose of SLAIF Connect

SLAIF Connect exists to make SLAIF usable with HPC systems without turning the SLAIF server into an SSH credential holder.

The product should:

- accept launch requests only from approved SLAIF web origins;
- map a short HPC alias such as `vegahpc` to a fixed target from extension-side policy;
- connect to the HPC SSH server through the mandatory WebSocket relay;
- authenticate the user with their normal HPC mechanism;
- preserve the normal HPC trust model as much as possible;
- run a narrow, approved SLAIF launcher command;
- capture and return metadata such as a SLURM job ID;
- avoid becoming a generic SSH client.

The user-facing reasoning is:

```text
SLAIF can launch and track an HPC workload,
but SSH authentication remains between the user and the real HPC system.
```

---

## 3. Non-goals

Agents must not implement these unless the project owner explicitly changes the architecture.

SLAIF Connect is not:

- a general-purpose SSH extension;
- a replacement for Secure Shell;
- an arbitrary browser-based SSH terminal;
- a tool where the web page chooses any host and port;
- a server-side SSH client;
- a credential broker;
- an SSH password, OTP, passphrase, or private-key collector;
- a relay that logs SSH payloads;
- a relay that allows arbitrary TCP egress;
- a product that depends on direct TCP from a normal Chrome extension;
- a product that runtime-loads executable JS/WASM from remote servers.

---

## 4. Security model

### 4.1 Component trust table

| Component | Trusted for | Not trusted for |
|---|---|---|
| Extension | SSH client, user prompts, host-key verification, alias allowlist, command template enforcement | Trusting arbitrary web input, accepting changed host keys, arbitrary SSH destinations |
| SLAIF web page | Requesting a session launch, showing workflow state | Defining SSH host identity, providing arbitrary commands, receiving credentials |
| SLAIF web server | Session orchestration, issuing short-lived relay tokens, relaying encrypted bytes, metadata collection | Terminating SSH, seeing credentials, defining host keys by itself, arbitrary TCP proxying |
| Relay endpoint | Byte forwarding from WSS to TCP | Payload inspection, SSH authentication, arbitrary destination selection |
| HPC `sshd` | SSH server endpoint, user authentication, running approved command | Trusting only relay IP as proof of user identity |
| HPC center | Host keys / host CA, account policy, firewall policy | Requiring SLAIF to hold user credentials |

### 4.2 Data that may be visible to the SLAIF server

The relay/server may know:

```text
user/session identifier
requested approved HPC alias
relay token lifecycle
connection start and stop time
connection duration
traffic volume
job id, if extension reports it by design
workflow status, if extension reports it by design
```

The relay/server must not know:

```text
SSH password
OTP or keyboard-interactive response
private key
private-key passphrase
decrypted SSH stdin/stdout/stderr
terminal input/output
arbitrary user shell command
```

### 4.3 The main active attack: malicious relay reroutes to fake SSH server

A malicious or compromised relay could try:

```text
extension thinks: connect to vegahpc
relay actually connects to: attacker fake sshd
fake sshd presents attacker host key
```

This attack is blocked only if the extension performs strict host-key or host-CA verification before user authentication.

Therefore:

- never silently accept unknown host keys in production;
- never silently accept changed host keys;
- pin the expected host key or host CA in extension policy;
- make the SSH known-host identity be the HPC alias or configured host alias, not the relay host;
- reject fake-host-key connections before the user sees a password/OTP prompt.

A successful MITM test must prove:

```text
fake SSH server behind relay
↓
host key mismatch
↓
connection stops
↓
no credential prompt shown
```

### 4.4 Public-key authentication caveat

With normal SSH public-key authentication, a fake server should not receive the private key. It receives a signature for that session, not the key material.

Still, disable agent forwarding. If agent forwarding is enabled, a malicious remote endpoint may ask the forwarded agent to sign operations while the session is alive.

Hard rule:

```text
ForwardAgent=no
ForwardX11=no
ClearAllForwardings=yes
```

Do not enable SSH agent forwarding, X11 forwarding, local forwarding, remote forwarding, or dynamic forwarding unless a future signed-off design explicitly requires it.

### 4.5 Open proxy / SSRF risk

The relay must not accept arbitrary client-provided hosts or ports.

Bad:

```json
{
  "host": "anything.example",
  "port": 22
}
```

Good:

```text
client sends: short-lived relay token
server maps token → session → approved HPC alias → fixed host:port
```

Also apply network-level egress controls so the relay process can only connect to approved HPC login nodes.

### 4.6 Command injection risk

Do not let the server send arbitrary shell commands to the extension.

Bad:

```json
{
  "command": "sbatch user_supplied_string"
}
```

Good:

```text
extension policy contains:
  remoteCommandTemplate = "/opt/slaif/bin/slaif-launch --session ${SESSION_ID}"

server provides:
  sessionId only

extension validates:
  sessionId matches strict safe regex

extension constructs:
  /opt/slaif/bin/slaif-launch --session sess_abc123
```

Any value substituted into a command must be validated. Prefer non-shell argument passing when supported by the SSH invocation path. If a shell is unavoidable, use strict validation and shell-escaping.

### 4.7 Metadata risk

Even with perfect end-to-end SSH, the relay sees metadata. Treat relay logs as sensitive.

Relay logs may include:

```text
who connected
when
from where
which approved HPC alias
duration
amount of data
success/failure
```

Relay logs must not include:

```text
binary SSH payload
password prompts
typed answers
private key material
full terminal transcript
```

### 4.8 Availability risk

The relay can always drop, delay, throttle, or reset the connection.

SSH protects confidentiality and integrity. SSH does not make an untrusted relay reliable.

Design should make failures clear to the user and recoverable where possible.

---

## 5. Mandatory invariants

The following invariants must hold in all production-directed code.

### 5.1 Extension-side policy is authoritative for SSH identity

The extension must decide:

```text
allowed HPC aliases
ssh host
ssh port
host key alias
known host keys or host CA
remote command template
allowed relay origin
```

The SLAIF server may provide:

```text
sessionId
relayToken
workflow metadata
```

The SLAIF server must not be the sole source of truth for:

```text
target SSH hostname
target SSH port
expected SSH host key
expected SSH host CA
arbitrary remote command
```

### 5.2 Relay target is selected server-side from approved policy

The relay must map:

```text
relayToken → session → approved HPC alias → fixed host:port
```

The relay must reject requests where the client tries to supply host/port directly.

### 5.3 Web page launches extension via `externally_connectable`

Use extension external messaging:

```text
SLAIF page → chrome.runtime.sendMessage(extensionId, ...)
```

Do not expose a broadly web-accessible `connect.html?hpc=...` entry point.

Do not rely on `document.referrer` for security decisions.

### 5.4 WSS only

Extension-to-relay communication must use `wss://`, not `ws://`, outside local development.

Local development may use `ws://localhost` only with explicit dev configuration and never in production manifests.

### 5.5 No remote executable code

All JS and WASM used by the extension must be packaged with the extension.

No remote executable code from:

```text
GitHub
Gitiles
CDN
SLAIF server
any other runtime URL
```

### 5.6 No direct TCP dependency

Do not add production dependency on:

```text
chrome.sockets.tcp
Secure Shell extension ID
raw TCP permission
Direct Sockets
Chrome App APIs
native helper
```

Native helper and direct TCP are separate alternative architectures, not this chosen path.

### 5.7 Host key check happens before user authentication

The extension must reject host-key mismatch before password, OTP, keyboard-interactive, or private-key authentication proceeds.

If the integration path cannot prove this, stop and add tests before proceeding.

### 5.8 The extension must not be a general SSH client

There should be no UI that allows arbitrary:

```text
host
port
username@host
proxy command
identity import without policy
manual relay destination
```

The product may ask for username or identity-related input as needed, but the destination must remain an approved alias.

---

## 6. Repository structure

Target layout:

```text
slaif-connect/
  AGENTS.md
  README.md
  THIRD_PARTY.md
  package.json
  .gitignore
  .gitmodules

  docs/
    ARCHITECTURE.md
    SECURITY.md
    THREAT_MODEL.md
    MIGRATION.md
    UPSTREAM_LINKING.md
    PROTOTYPE_SNIPPETS.md
    HOST_KEY_ROTATION.md        # create if not present
    TEST_PLAN.md                # create if not present
    RELEASE_CHECKLIST.md        # create if not present

  extension/
    manifest.json
    html/
      session.html
      popup.html                # optional
    js/
      background.js
      session.js
      slaif_policy.js
      slaif_relay.js
      slaif_ssh.js              # create when integrating OpenSSH/WASSH
      job_output_parser.js
      session_descriptor.js     # optional
      host_keys.js              # optional
    config/
      hpc_hosts.example.json
      hpc_hosts.development.example.json
      hpc_hosts.signed.json     # production, eventually generated
      hpc_hosts_pubkey.pem      # production verification key, if using signed policy
    vendor/
      libapps/                  # generated by vendor script
      plugin/                   # generated/copied OpenSSH WASM plugin

  server/
    relay/
      relay.js
      package.json
      allowed_hpc_hosts.example.json
    api/
      sessions.js               # optional skeleton
      jobs.js                   # optional skeleton

  scripts/
    init-upstream.sh
    vendor-libapps.sh
    build-extension.sh
    verify-host-policy.js       # create when signed policy is implemented
    run-local-sshd.sh           # optional dev helper

  tests/
    README.md
    relay/
    extension/
    security/
    fixtures/
```

Do not create a top-level `nassh/` directory copied from upstream as project source. Upstream files must live under `third_party/libapps` or generated `extension/vendor`.

---

## 7. Upstream dependency model

### 7.1 Add libapps as a submodule

Use the official upstream source:

```bash
git submodule add https://chromium.googlesource.com/apps/libapps third_party/libapps
git submodule update --init --recursive
git -C third_party/libapps rev-parse HEAD > UPSTREAM_LIBAPPS_COMMIT
```

Pin a commit. Do not track upstream HEAD implicitly.

### 7.2 Do not edit upstream files

Never edit files under:

```text
third_party/libapps/
```

If an upstream change appears necessary, first try one of these:

1. write an adapter in `extension/js`;
2. vendor a selected file and wrap it without modifying it;
3. add a small SLAIF-specific module that calls upstream APIs;
4. document the missing upstream hook;
5. only as a last resort, create a patch file under `patches/` and mark it as temporary.

The preferred goal remains no patch stack.

### 7.3 Vendor only build-time artifacts

`scripts/vendor-libapps.sh` should copy selected runtime pieces into `extension/vendor`.

Likely useful upstream components:

```text
hterm
libdot
wassh
wasi-js-bindings
ssh_client / OpenSSH WASM plugin artifacts
selected nassh JS modules only if needed
```

Do not vendor unrelated Secure Shell features unless required:

```text
SFTP UI
generic profile manager
file system provider
Crosh support
general SSH destination UI
Chrome socket-specific paths
```

### 7.4 What "linking" means here

In this project, "link against upstream" means:

```text
fetch upstream at build time
copy/bundle selected source and WASM artifacts into extension package
call upstream modules from SLAIF-owned code
```

It does not mean:

```text
runtime import from remote URL
depend on official Secure Shell installed extension
modify upstream nassh in place
```

---

## 8. Extension architecture

### 8.1 Manifest

The manifest should be MV3.

It should include:

```json
{
  "manifest_version": 3,
  "name": "SLAIF Connect",
  "permissions": ["storage"],
  "host_permissions": ["https://connect.slaif.si/*"],
  "externally_connectable": {
    "matches": [
      "https://*.slaif.si/*",
      "https://stare.lmi.link/*"
    ]
  },
  "background": {
    "service_worker": "js/background.js",
    "type": "module"
  }
}
```

Adjust domains to the real deployment domains. Keep them narrow.

Do not add:

```json
"sockets": { ... }
```

Do not expose broad `web_accessible_resources` unless a specific file truly must be exposed.

### 8.2 Background service worker responsibilities

`extension/js/background.js` should:

1. receive launch messages from approved external origins;
2. validate `sender.url`;
3. validate message shape;
4. validate `hpc` alias syntax;
5. validate `sessionId` syntax;
6. store a pending session in `chrome.storage.session`;
7. open `extension/html/session.html` in a popup/window/tab;
8. return a simple success/failure response.

It must not:

- perform long-running SSH;
- hold a WebSocket for the whole SSH session if avoidable;
- trust the web page to supply SSH host/port/host key;
- accept arbitrary commands.

### 8.3 Session page responsibilities

`extension/html/session.html` and `extension/js/session.js` should:

1. load the pending session from `chrome.storage.session`;
2. fetch a session descriptor from the SLAIF server, if needed;
3. validate that descriptor against the pending session;
4. load extension-side HPC policy;
5. resolve the approved HPC alias;
6. obtain a short-lived relay token;
7. build a relay adapter;
8. initialize terminal UI;
9. start the OpenSSH/WASSH runtime;
10. enforce strict host-key verification;
11. run the fixed remote SLAIF command;
12. capture stdout/stderr as needed;
13. parse and report job metadata;
14. clear sensitive transient state on completion.

A visible session page is preferred for the long-running SSH process. Avoid relying on a background service worker for the whole session lifetime.

### 8.4 Policy module responsibilities

`extension/js/slaif_policy.js` should:

- load `extension/config/hpc_hosts.example.json` in development;
- later verify and load `hpc_hosts.signed.json`;
- expose `resolveHpcAlias(alias)`;
- reject unknown aliases;
- normalize alias casing consistently;
- validate known-host entries;
- validate remote command templates;
- build a safe command from template and session ID;
- enforce that web/server input cannot redefine target identity.

### 8.5 Relay adapter responsibilities

`extension/js/slaif_relay.js` should implement the browser side of:

```text
OpenSSH/WASSH socket request → WSS relay connection → binary frame forwarding
```

It should:

- open only configured `wss://` relay URLs;
- send relay token in the initial JSON auth message, not query string;
- switch to binary mode after relay auth success;
- refuse unexpected requested host/port;
- surface connection errors to the session UI;
- close cleanly on completion;
- never log SSH payload bytes.

### 8.6 SSH integration module

Create `extension/js/slaif_ssh.js` when integrating upstream WASSH/OpenSSH.

It should own:

- imports from vendored libapps;
- OpenSSH/WASSH process startup;
- hterm connection;
- known-host injection;
- relay injection;
- SSH arguments/options;
- stdout/stderr capture;
- authentication prompt handling;
- process lifecycle.

Keep this module separate so future agents can work on SSH runtime integration without mixing it with policy and messaging.

---

## 9. Relay server architecture

### 9.1 Endpoint shape

Use a dedicated WSS endpoint:

```text
wss://connect.slaif.si/ssh-relay
```

Do not use arbitrary host/port query parameters.

Bad:

```text
wss://connect.slaif.si/ssh-relay?host=login.example&port=22
```

Good:

```text
WSS connect
client sends {"type":"auth","relayToken":"..."}
server validates token
server maps token to approved HPC alias and fixed target
server connects TCP to that target
```

### 9.2 Relay handshake

Recommended sequence:

```text
1. Extension opens WSS to /ssh-relay.
2. Extension sends:
   {"type":"auth","relayToken":"<short-lived token>"}
3. Server validates token.
4. Server maps token to session and approved HPC alias.
5. Server looks up fixed host:port from server-side allowlist.
6. Server opens TCP to the target.
7. Server sends:
   {"type":"ok"}
8. Both sides switch to binary byte forwarding.
```

### 9.3 Relay token requirements

Relay tokens should be:

- short-lived;
- single-use or strongly session-bound;
- bound to user/session/HPC alias;
- not placed in URLs;
- not logged;
- invalidated on session completion;
- rejected if expired;
- rejected if reused after completion.

### 9.4 Relay allowlist

`server/relay/allowed_hpc_hosts.example.json` is a development skeleton only.

Production relay policy should map approved aliases to fixed host/port:

```json
{
  "vegahpc": {
    "host": "login.vega.example",
    "port": 22
  }
}
```

The server must not permit arbitrary destination selection by the extension.

The extension also has its own policy. Both sides should enforce allowlists. Defense in depth is intentional.

### 9.5 Relay logging

Safe logs:

```text
session id or internal request id
approved hpc alias
relay auth success/failure
connection start/stop
duration
bytes in/out counts
network errors
```

Unsafe logs:

```text
relay token
binary SSH payload
terminal text
password/OTP prompts
user-entered authentication responses
private key material
full command line if it may include secrets
```

### 9.6 Relay hardening

Production relay should add:

- TLS/WSS termination with modern configuration;
- authentication for relay token validation;
- rate limiting;
- per-session connection limit;
- maximum connection lifetime;
- maximum idle timeout;
- structured audit logging;
- egress firewall to approved HPC targets only;
- monitoring and alerts;
- no debug payload logging;
- clear error mapping that does not expose internal network details unnecessarily.

---

## 10. HPC policy and allowlist

### 10.1 Alias-first model

The extension should operate on aliases such as:

```text
stare
arneshpc
vegahpc
vegahpccpu
vegahpcgpu
```

Aliases are product-level names. They prevent arbitrary destination entry and keep the UI simple.

### 10.2 Example policy entry

```json
{
  "alias": "vegahpc",
  "displayName": "Vega HPC",
  "sshHost": "login.vega.example",
  "sshPort": 22,
  "hostKeyAlias": "vegahpc",
  "knownHosts": [
    "vegahpc ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA..."
  ],
  "remoteCommandTemplate": "/opt/slaif/bin/slaif-launch --session ${SESSION_ID}"
}
```

### 10.3 Host-key identity

The SSH host-key check should use the configured HPC identity, not the relay hostname.

If the SSH invocation sees `login.vega.example` but policy wants alias-based known-host matching, use equivalent behavior to:

```text
HostKeyAlias=vegahpc
CheckHostIP=no
StrictHostKeyChecking=yes
```

`CheckHostIP=no` is appropriate in relay mode because the extension is not directly connecting to the HPC IP.

### 10.4 Host-key or host-CA options

Preferred:

```text
HPC site uses SSH host certificates.
Extension pins the HPC host CA.
```

Good:

```text
Extension pins all accepted login-node host keys.
```

Prototype only:

```text
Trust-on-first-use with loud warnings.
```

Bad:

```text
Silently accept unknown host keys.
```

Unacceptable:

```text
Ignore changed host keys.
```

### 10.5 Host-key rotation

Create `docs/HOST_KEY_ROTATION.md` before production.

It should define:

- who may update host keys;
- how updates are signed;
- how old and new keys overlap;
- how users are informed;
- how emergency revocation works;
- how the extension rejects unexpected changes.

Do not make host-key rotation a hidden server-controlled operation unless the update is signed by a key already trusted by the extension.

---

## 11. Remote command model

### 11.1 First production direction: fixed launcher command

Prefer this model:

```text
ssh user@hpc /opt/slaif/bin/slaif-launch --session sess_abc123
```

The user authenticates normally. After authentication, `sshd` runs the fixed command.

### 11.2 Command comes from extension policy

The command template should live in extension policy:

```json
"remoteCommandTemplate": "/opt/slaif/bin/slaif-launch --session ${SESSION_ID}"
```

The server may provide:

```text
sessionId
```

The server must not provide:

```text
arbitrary command string
arbitrary shell fragment
arbitrary arguments without validation
```

### 11.3 Session ID validation

Use a strict safe regex, for example:

```js
/^sess_[A-Za-z0-9_-]{8,128}$/
```

Reject anything with:

```text
spaces
quotes
semicolons
dollar signs
backticks
parentheses
slashes unless explicitly needed
control characters
non-ASCII unless explicitly needed
```

### 11.4 Job ID parsing

The starter includes `job_output_parser.js`.

For SLURM, parse:

```text
Submitted batch job 123456
```

with a strict regex:

```js
/^Submitted batch job ([0-9]+)$/m
```

Do not treat arbitrary output as trusted. Report parsing failure clearly.

### 11.5 Later multi-command control

If the project later requires multiple commands inside one authenticated session, design a narrow command protocol.

Do not simply expose a generic shell where the web server can write arbitrary commands.

Possible safer model:

```text
extension supports command type: submit_slaif_job
allowed parameters: sessionId, workflowId
extension constructs the command locally
extension validates every parameter
```

---

## 12. OpenSSH/WASSH integration plan

### 12.1 Two possible tracks

Track A: Quick proof of concept.

Use more upstream `nassh` glue initially to prove:

```text
extension → WSS relay → TCP → test sshd
```

Do this only for rapid validation. Do not let it become the final architecture.

Track B: Clean SLAIF product path.

Use lower-level pieces:

```text
hterm
libdot
wasi-js-bindings
wassh
ssh_client / OpenSSH WASM plugin
selected process/subproc glue if needed
SLAIF-owned policy, relay, and session orchestration
```

The final product should be Track B.

### 12.2 Relay adapter concept

The OpenSSH/WASSH runtime needs a TCP-like socket. In this architecture the socket is backed by WebSocket frames.

Conceptual adapter:

```text
WASSH asks to open host:port
↓
SLAIF relay adapter verifies host:port equals extension policy
↓
adapter opens WSS to SLAIF relay
↓
adapter authenticates with relay token
↓
adapter forwards binary frames both ways
```

### 12.3 Expected adapter behavior

The adapter must:

- refuse host/port mismatch;
- open WSS to the configured relay URL;
- authenticate with token in a JSON message;
- switch to binary forwarding only after `{"type":"ok"}`;
- convert WebSocket binary frames to the byte representation expected by WASSH;
- close on either TCP or WSS close;
- report network errors clearly.

### 12.4 SSH options

When building the SSH invocation, include equivalent behavior to:

```text
StrictHostKeyChecking=yes
CheckHostIP=no
HostKeyAlias=<policy.hostKeyAlias>
ForwardAgent=no
ForwardX11=no
ClearAllForwardings=yes
```

Also avoid:

```text
ProxyCommand supplied by web server
UserKnownHostsFile controlled by web server
StrictHostKeyChecking=no
UserKnownHostsFile=/dev/null unless known hosts are injected elsewhere safely
```

### 12.5 Known-hosts injection

The extension must ensure OpenSSH sees the expected known-host entries.

Acceptable approaches:

- provide an in-memory known-hosts implementation if WASSH supports it;
- create a controlled virtual known-hosts file inside the WASM filesystem;
- use upstream-known mechanisms if available;
- map host identity with `HostKeyAlias`.

Do not rely on user accepting unknown host keys interactively in production.

---

## 13. Implementation phases

Agents should work through these phases in order. Do not skip security gates.

### Phase 0 — Read and confirm context

Read:

```text
AGENTS.md
README.md
docs/ARCHITECTURE.md
docs/SECURITY.md
docs/UPSTREAM_LINKING.md
docs/MIGRATION.md
docs/PROTOTYPE_SNIPPETS.md
extension/config/hpc_hosts.example.json
server/relay/relay.js
extension/js/slaif_policy.js
extension/js/slaif_relay.js
```

Confirm these are true:

```text
project is early-stage
old fork is only a reference
new path is no-fork relay-only
extension-side SSH client is required
server-side SSH client is forbidden
host-key verification is mandatory
```

Do not begin coding until the intended invariant for the change is clear.

### Phase 1 — Clean repository bootstrap

Goal:

```text
a clean non-fork repo with libapps pinned as upstream dependency
```

Tasks:

1. Ensure repo is not a fork of upstream `libapps`.
2. Add or verify `.gitmodules`.
3. Add `third_party/libapps` submodule.
4. Record pinned upstream commit in `UPSTREAM_LIBAPPS_COMMIT`.
5. Make `scripts/vendor-libapps.sh` idempotent.
6. Ensure `extension/vendor` is generated, not hand-edited.
7. Ensure starter docs are present.
8. Ensure old fork content is not copied wholesale.

Acceptance:

```text
git status clean after bootstrap except intended generated files
third_party/libapps exists and is untouched
README explains relay-only direction
AGENTS.md present
```

### Phase 2 — MV3 extension shell

Goal:

```text
extension can be loaded in Chrome and receive approved external launch messages
```

Tasks:

1. Validate `extension/manifest.json`.
2. Add narrow `externally_connectable.matches`.
3. Implement `background.js` external message validation.
4. Store pending session in `chrome.storage.session`.
5. Open `session.html`.
6. Add visible error handling.
7. Add basic popup only if useful.

Acceptance:

```text
approved origin can launch session
unapproved origin is rejected
malformed hpc rejected
malformed sessionId rejected
session.html opens only after valid request
no broad web_accessible_resources used
```

### Phase 3 — Extension policy

Goal:

```text
extension can resolve approved HPC aliases and reject everything else
```

Tasks:

1. Validate `hpc_hosts.example.json` structure.
2. Implement alias normalization.
3. Implement `resolveHpcAlias(alias)`.
4. Reject unknown aliases.
5. Validate `sshHost`, `sshPort`, `hostKeyAlias`, `knownHosts`.
6. Implement command template validation.
7. Implement session ID substitution.
8. Add tests for all validations.

Acceptance:

```text
vegahpc-style aliases resolve
arbitrary hostnames do not resolve
server cannot override host/port/host keys
bad command templates rejected
bad session ids rejected
```

### Phase 4 — Relay server MVP

Goal:

```text
WSS relay can forward bytes to an approved test SSH server
```

Tasks:

1. Implement WebSocket endpoint.
2. Require initial JSON auth message.
3. Validate relay token.
4. Map token to approved alias.
5. Lookup fixed host/port server-side.
6. Open TCP connection.
7. Forward binary frames both ways.
8. Close cleanly.
9. Add safe logs.
10. Reject arbitrary host/port.

Acceptance:

```text
valid token connects to approved target
missing token rejected
expired token rejected
unknown alias rejected
client-supplied host/port ignored or rejected
binary payload is not logged
```

### Phase 5 — Local SSH relay test

Goal:

```text
extension reaches a local test sshd through WSS relay
```

Tasks:

1. Create local test sshd container or dev helper.
2. Pin its host key in development policy.
3. Connect extension relay adapter to local relay.
4. Verify raw byte forwarding.
5. Verify SSH banner exchange.
6. Verify login prompt or auth path appears only after host-key verification.

Acceptance:

```text
WSS relay is used
direct TCP from extension is not used
test sshd receives TCP connection from relay
host key is checked
user can authenticate in test environment
```

### Phase 6 — Host-key security gate

Goal:

```text
MITM via malicious relay is blocked before credential prompt
```

Tasks:

1. Create fake SSH server with different host key.
2. Make relay route token to fake server intentionally.
3. Start extension session for the original alias.
4. Verify host-key mismatch stops the connection.
5. Verify no password/OTP prompt is displayed.
6. Add automated or semi-automated test.

Acceptance:

```text
fake SSH server cannot collect credentials
host-key mismatch is visible
connection terminates before auth
test is documented
```

Do not proceed to real HPC pilot until this phase passes.

### Phase 7 — OpenSSH/WASSH integration

Goal:

```text
WASM OpenSSH runs inside extension and uses SlaifRelay as its socket path
```

Tasks:

1. Vendor upstream runtime components.
2. Load hterm or suitable terminal UI.
3. Load OpenSSH WASM plugin artifacts.
4. Instantiate SSH process.
5. Inject relay adapter.
6. Inject known-hosts policy.
7. Construct SSH args with safe options.
8. Capture stdout/stderr.
9. Handle process exit.

Acceptance:

```text
no direct TCP
SSH runs from extension
relay adapter receives socket open request
known hosts are enforced
output capture works
exit status visible
```

### Phase 8 — Fixed remote command and job capture

Goal:

```text
after auth, extension runs fixed SLAIF launcher and captures job id
```

Tasks:

1. Build remote command from policy + session ID.
2. Validate session ID.
3. Run remote command after SSH authentication.
4. Capture stdout.
5. Parse SLURM job ID.
6. POST result to SLAIF API.
7. Handle no-job-id cases.
8. Handle job submission failure.

Acceptance:

```text
arbitrary command from server not possible
valid session submits job
job id parsed
job id reported to SLAIF
failure reported without leaking credentials
```

### Phase 9 — Server API integration

Goal:

```text
web server provides session descriptor and accepts job status
```

Tasks:

1. Define `/api/connect/session/:sessionId`.
2. Define `/api/connect/job-result`.
3. Include relay token issuance.
4. Bind token to user/session/hpc alias.
5. Include expiration.
6. Ensure descriptor does not define host key or arbitrary command.
7. Add auth checks.
8. Add audit logs.

Acceptance:

```text
extension can obtain relay token
token cannot be reused across sessions
job result accepted only for matching session
server never receives SSH credentials
```

### Phase 10 — Production hardening

Goal:

```text
safe pilot with approved HPC system
```

Tasks:

1. Coordinate with HPC center.
2. Obtain host keys or host CA.
3. Configure relay egress firewall.
4. Configure rate limits.
5. Configure TLS/WSS.
6. Configure monitoring.
7. Configure logs without payload.
8. Prepare incident response.
9. Prepare host-key rotation procedure.
10. Prepare release checklist.

Acceptance:

```text
HPC target approved
relay IP allowed if needed
host identity pinned
test MITM fails safely
real user can submit job
job metadata returns
credentials remain local
```

### Phase 11 — Packaging and release

Goal:

```text
Chrome-compatible packaged extension
```

Tasks:

1. Ensure all executable JS/WASM is bundled.
2. Remove dev-only hosts and policies.
3. Remove debug logging.
4. Verify manifest permissions are minimal.
5. Verify no direct TCP permissions.
6. Verify no broad web-accessible resources.
7. Build extension package.
8. Test install.
9. Run security checklist.
10. Document release version.

Acceptance:

```text
extension loads cleanly
only required permissions requested
no remote code
no direct socket permission
relay-only path works
security tests pass
```

---

## 14. Test plan requirements

Create tests as early as possible.

### 14.1 Policy tests

Test:

```text
known alias accepted
unknown alias rejected
alias casing handled as intended
bad sshHost rejected
bad sshPort rejected
empty knownHosts rejected for production
bad command template rejected
valid sessionId accepted
malicious sessionId rejected
```

Malicious session IDs:

```text
sess_abc;rm -rf ~
sess_abc$(curl evil)
sess_abc`evil`
sess_abc with spaces
sess_abc"quoted"
sess_abc/../../x
sess_abc
```

### 14.2 Relay tests

Test:

```text
missing auth rejected
bad JSON rejected
bad token rejected
expired token rejected
wrong session rejected
unknown alias rejected
client host/port rejected
binary before auth rejected
text after auth rejected unless control messages are explicitly supported
TCP close closes WSS
WSS close closes TCP
payload not logged
```

### 14.3 Security tests

Test:

```text
fake SSH host key rejected
changed host key rejected
unknown host key rejected in production
agent forwarding disabled
port forwarding disabled
X11 forwarding disabled
server cannot send arbitrary command
relay cannot connect to arbitrary internal service
unapproved web origin cannot launch extension
```

### 14.4 End-to-end tests

Local:

```text
extension → local WSS relay → test sshd container
```

Staging:

```text
extension → staging SLAIF relay → staging/test sshd
```

Pilot:

```text
extension → SLAIF relay → approved HPC login node
```

For every end-to-end test, record:

```text
extension version
libapps pinned commit
relay version
HPC alias
host key fingerprint or host CA
test user
auth method
command
job id result
failure mode if any
```

---

## 15. Development and coding guidelines

### 15.1 Keep changes small and intentional

Prefer changes that affect one layer at a time:

```text
policy only
relay only
extension launch only
SSH integration only
tests only
docs only
```

Do not combine major security model changes with large code rewrites.

### 15.2 Make security checks explicit

Avoid hidden assumptions. Code should visibly enforce:

```text
origin allowlist
alias allowlist
host/port matching
host-key checks
session ID validation
relay token validation
command template restrictions
```

### 15.3 Fail closed

When uncertain, reject.

Examples:

```text
unknown alias → reject
missing knownHosts → reject in production
unknown origin → reject
bad token → reject
bad command parameter → reject
host-key mismatch → reject
relay target mismatch → reject
```

### 15.4 Do not log secrets

Before adding any log, ask whether it might contain:

```text
relay token
password
OTP
private key
passphrase
SSH payload
terminal transcript
session cookie
authorization header
```

If yes, do not log it. If uncertain, do not log it.

### 15.5 Keep TODOs actionable

Bad TODO:

```text
TODO: security
```

Good TODO:

```text
TODO(security): replace development hpc_hosts.example.json with signed policy verification before production.
```

### 15.6 Use clear module boundaries

Policy code should not open sockets.

Relay code should not decide SSH host keys.

SSH code should not trust the server for host identity.

Background messaging code should not run the long SSH session.

### 15.7 Prefer typed schemas

Where possible, add JSON schema or runtime validators for:

```text
HPC policy
session descriptor
relay auth message
job result payload
```

### 15.8 Do not use production secrets

Development and test code must not contain:

```text
real user passwords
real private keys
real OTP seeds
production relay tokens
production signing keys
```

Host public keys are not secret, but they are security-sensitive. Treat policy changes carefully.

---

## 16. Prompting future coding agents

When asking an agent to work on this repo, provide a constrained task.

Good prompt pattern:

```text
Read AGENTS.md first. Work only on Phase <N>. Do not change the security model.
Implement <specific file/function>. Add tests. Preserve these invariants:
- no direct TCP from extension
- relay does not accept arbitrary host/port
- extension policy is authoritative for host identity
- no arbitrary command from server
Return a summary of changed files and tests run.
```

Avoid prompts like:

```text
Make the extension work.
Finish the SSH integration.
Improve security.
```

Those are too broad and likely to break invariants.

### 16.1 Prompt for Phase 2

```text
Read AGENTS.md first. Implement the MV3 external launch flow only.
Work in extension/manifest.json and extension/js/background.js.
The extension must accept messages only from allowed origins, validate hpc and sessionId, store a pending session in chrome.storage.session, and open html/session.html.
Do not implement SSH yet. Do not add direct TCP/socket permissions. Add basic tests or a manual test plan.
```

### 16.2 Prompt for Phase 3

```text
Read AGENTS.md first. Implement extension-side HPC policy validation.
Work in extension/js/slaif_policy.js and extension/config/hpc_hosts.example.json.
The extension policy must be authoritative for sshHost, sshPort, hostKeyAlias, knownHosts, and remoteCommandTemplate.
Reject unknown aliases and malicious session IDs. Do not let the server override host identity or commands.
Add tests for valid and invalid aliases, command templates, and session IDs.
```

### 16.3 Prompt for Phase 4

```text
Read AGENTS.md first. Implement the WSS-to-TCP relay MVP.
Work in server/relay only.
The relay must require an initial auth message with a relay token, map the token server-side to an approved HPC alias, connect only to the fixed host/port for that alias, and forward binary frames.
It must reject arbitrary host/port from the client and must not log binary SSH payloads or tokens.
Add tests for missing token, invalid token, unknown alias, binary-before-auth, and close behavior.
```

### 16.4 Prompt for Phase 6

```text
Read AGENTS.md first. Build the MITM host-key rejection test.
Set up a fake SSH server with a different host key behind the relay.
The extension must reject the connection before any password/OTP prompt appears.
Do not weaken StrictHostKeyChecking. Do not add TOFU acceptance for production.
Document the test in docs/TEST_PLAN.md.
```

### 16.5 Prompt for Phase 7

```text
Read AGENTS.md first. Integrate vendored libapps/WASSH/OpenSSH into the session page.
Keep SLAIF-specific logic in extension/js/slaif_ssh.js.
Use the SlaifRelay adapter for all network transport; do not use chrome.sockets.tcp.
Inject known-hosts from extension policy and use strict host-key checking.
Disable agent forwarding, X11 forwarding, and port forwarding.
Do not allow arbitrary SSH destinations.
```

### 16.6 Prompt for Phase 8

```text
Read AGENTS.md first. Implement fixed remote command execution and SLURM job ID capture.
The command template must come from extension policy. The server may provide only a validated sessionId.
Reject malicious session IDs. Parse "Submitted batch job <digits>" from stdout.
Report job result to the SLAIF API without sending SSH credentials or terminal transcript.
```

---

## 17. Review checklist for every pull request

Before considering any change acceptable, answer these questions.

### Architecture

- Does this preserve the relay-only architecture?
- Does this avoid a long-lived `nassh` fork?
- Does this avoid direct TCP from the extension?
- Does this keep the extension as the SSH client?
- Does this keep the HPC as the SSH server?

### Policy

- Is the extension policy still authoritative for SSH host identity?
- Are unknown aliases rejected?
- Can the web page or server override host/port/host key?
- Are command templates controlled by extension policy?

### Relay

- Does the relay require a short-lived token?
- Does the relay map token to approved alias server-side?
- Does the relay reject arbitrary host/port?
- Does the relay avoid logging payloads and tokens?
- Are close/error paths safe?

### SSH security

- Is host-key verification strict?
- Are changed/unknown host keys rejected in production?
- Is agent forwarding disabled?
- Is X11 forwarding disabled?
- Are port forwardings disabled?
- Does MITM rejection happen before credential prompts?

### Credentials

- Could any password, OTP, passphrase, private key, or decrypted SSH payload reach the SLAIF server?
- Could logs contain secrets?
- Could the web page collect credentials through a fake prompt?
- Are authentication prompts clearly from the extension/SSH client?

### Commands

- Can the server send arbitrary shell commands?
- Are session IDs validated?
- Are command parameters escaped or otherwise safe?
- Is output parsing strict?

### Chrome extension

- Does the manifest request minimal permissions?
- Are there no socket permissions?
- Are there no broad web-accessible resources?
- Is remote executable code avoided?
- Are allowed external origins narrow?

### Tests

- Were policy tests updated?
- Were relay tests updated?
- Was MITM/fake host-key behavior considered?
- Were command-injection cases tested?
- Was an end-to-end local relay test run or documented?

---

## 18. Known open implementation questions

These are unresolved engineering details, not reasons to change the architecture.

### 18.1 Exact WASSH integration API

Agents must inspect the pinned upstream `libapps` commit to determine the exact module imports and constructors needed.

Expected direction:

```text
SLAIF session page imports vendored hterm/WASSH/OpenSSH glue
SLAIF relay adapter provides TCP-like socket behavior
known-hosts are injected into the SSH runtime
```

Do not guess blindly. Read upstream code at the pinned commit.

### 18.2 Known-hosts injection mechanism

Need to confirm the cleanest way for the pinned WASSH/OpenSSH runtime to consume policy-known host keys.

Possible approaches:

- in-memory configuration accepted by upstream glue;
- virtual known_hosts file in WASM filesystem;
- selected upstream `nassh` known-hosts helper;
- a small adapter module.

Whichever approach is chosen must pass MITM rejection tests.

### 18.3 Identity/key storage

Need to decide how users provide SSH identities:

- browser-side imported key;
- existing upstream Secure Shell-style identity handling, if reused;
- password/keyboard-interactive only for first MVP;
- hardware-backed or OS-backed mechanisms later.

Do not let the SLAIF server store private keys.

### 18.4 Production host policy update

Need final design for signed `hpc_hosts.signed.json`.

The signing key should not live on the web server if the web server compromise is in the threat model for host identity.

### 18.5 HPC-side launcher

Need define the remote `/opt/slaif/bin/slaif-launch` contract:

- inputs;
- session verification;
- how it obtains job specification;
- how it calls SLURM;
- output format;
- error format;
- logging;
- permissions.

---

## 19. Early milestone definition of done

The first meaningful milestone is not "the whole product is done."

The first meaningful milestone is:

```text
Local end-to-end proof:
  Chrome extension session page
  → WSS relay
  → local test sshd
  → strict host-key verification
  → user authenticates
  → fixed command runs
  → output captured
```

The second meaningful milestone is:

```text
MITM proof:
  same alias
  relay routes to fake sshd
  fake host key is rejected
  no password/OTP prompt appears
```

Only after these should agents attempt real HPC integration.

---

## 20. What to preserve from the old prototype

Preserve the reasoning, not the fork.

Useful preserved ideas:

```text
approved HPC aliases
hpc parameter precedence over host strings
alias normalization and validation
SLAIF-specific connection intent
credential-local security goal
job metadata return path
service branding/docs
```

Do not preserve as final implementation:

```text
patched nassh_command_instance.js
entire upstream tree as project source
generic Secure Shell UI
direct TCP dependence
broad connect.html entry point
broad web_accessible_resources
Chrome sockets manifest permissions
```

---

## 21. Red flags that require stopping work

Stop and ask for explicit architectural review if a change would:

- make the SLAIF server the SSH client;
- send passwords, OTPs, passphrases, or private keys to the server;
- accept unknown or changed host keys in production;
- let the server provide arbitrary commands;
- let the web page choose arbitrary SSH host/port;
- turn the relay into an open TCP proxy;
- depend on `chrome.sockets.tcp`;
- require a permanent `nassh` fork;
- load remote executable JS/WASM at runtime;
- remove the MITM rejection gate;
- log SSH payloads;
- weaken extension origin checks.

---

## 22. Suggested first work items

For a new coding agent starting from the starter repository, the recommended first tasks are:

1. Add `docs/TEST_PLAN.md`.
2. Add JSON schema or runtime validation for `extension/config/hpc_hosts.example.json`.
3. Add unit tests for `extension/js/slaif_policy.js`.
4. Add unit tests for `extension/js/job_output_parser.js`.
5. Harden `server/relay/relay.js` token and target validation.
6. Add tests for relay auth and open-proxy rejection.
7. Add a local test sshd fixture.
8. Implement a minimal WSS byte-forwarding smoke test.
9. Inspect pinned `libapps` APIs for WASSH relay injection.
10. Create `extension/js/slaif_ssh.js` as the integration boundary.

Do not start with real HPC.

Do not start by copying the whole old fork.

---

## 23. Minimal local development scenario

A useful local loop should eventually be:

```bash
# Terminal 1: run test sshd
./scripts/run-local-sshd.sh

# Terminal 2: run relay
cd server/relay
npm install
npm run dev

# Terminal 3: build extension
npm install
./scripts/init-upstream.sh
./scripts/vendor-libapps.sh
./scripts/build-extension.sh
```

Then load the extension unpacked in Chrome and launch it from an allowed local development page.

Development-only relaxation may include:

```text
localhost relay
test sshd
development host key
development alias
test user
```

Development-only relaxation must not include:

```text
accept any host key
arbitrary host/port relay
logging passwords or SSH payloads
server-side SSH client
```

---

## 24. Documentation updates expected during implementation

Agents should update docs when behavior changes.

Required docs over time:

```text
README.md
docs/ARCHITECTURE.md
docs/SECURITY.md
docs/UPSTREAM_LINKING.md
docs/MIGRATION.md
docs/THREAT_MODEL.md
docs/TEST_PLAN.md
docs/HOST_KEY_ROTATION.md
docs/RELEASE_CHECKLIST.md
```

Any new security-relevant behavior must be documented.

Any temporary weakening must be marked:

```text
DEVELOPMENT ONLY
NOT FOR PRODUCTION
```

---

## 25. Final target state

The final product should be a clean SLAIF-specific Chrome extension and relay service with these properties:

```text
No permanent nassh fork.
Upstream libapps used as pinned build-time dependency.
No direct TCP from extension.
No remote executable code.
Web page launches extension through externally_connectable.
Extension enforces approved HPC aliases.
Extension verifies HPC host key or host CA.
Extension runs browser-side SSH client.
SLAIF web server relays encrypted SSH bytes only.
Relay cannot connect to arbitrary destinations.
SLAIF server never receives SSH credentials.
Remote command is fixed/template-based and extension-controlled.
Job ID is captured and reported.
MITM/fake SSH server is rejected before credential prompts.
Production host-key rotation is controlled and auditable.
```

This is the architecture to implement.

---

## Browser-side OpenSSH/WASM work rules

Before changing browser-side SSH code, inspect the pinned upstream APIs under
`third_party/libapps`. Do not guess the runtime interface and do not edit
upstream files.

Hard rules:

- never edit `third_party/libapps`;
- never add `chrome.sockets` or direct TCP from the extension;
- never bypass or weaken SSH host-key verification;
- never fake SSH success or claim browser SSH works without starting bundled OpenSSH/WASM;
- keep local development mode separate from production session launch;
- keep relay E2E tests intact and run them where possible;
- do not accept arbitrary shell commands from the web page or server;
- do not accept arbitrary host/port from the web page;
- future SSH integration must use the SLAIF relay adapter, not direct TCP.

Plugin artifacts are generated build output under `extension/plugin` and must
not be committed unless the project owner explicitly requests it. Use:

```bash
npm run plugin:install
npm run plugin:verify
```

Manual browser development uses `tools/start-extension-dev-stack.mjs` and
`build/extension/config/dev_runtime.local.json`. That generated config is local
development state only.

## Browser E2E validation rules

Automated browser validation must not be faked. A passing browser relay test
must load the built extension in Chromium and observe real command output from
the test sshd container.

Hard rules:

- do not mark browser validation successful based only on extension load,
  plugin verification, relay connection, or mocked output;
- keep dev password authentication local-only and do not turn it into
  production credential storage;
- do not send the dev password in relay auth JSON or to the SLAIF relay server;
- Playwright tests must not weaken manifest security, broaden external origins,
  add `chrome.sockets`, or enable direct TCP from the extension;
- do not bypass host-key verification to make browser tests pass;
- browser host-key mismatch tests must verify that the fixed command output is
  not observed.

## SLAIF web launch protocol rules

Future PRs must preserve the web launch/session descriptor boundary documented
in `docs/SESSION_LAUNCH_PROTOCOL.md`.

Hard rules:

- the web launch message may provide only `type`, `version`, `hpc`,
  `sessionId`, and `launchToken`;
- the web page must not provide SSH host, SSH port, known_hosts, host key alias,
  SSH options, or shell commands;
- the session descriptor may provide relay URL/token and token expiry only; it
  must not define SSH host, SSH port, known_hosts, host key alias, SSH options,
  or remote command;
- extension-side policy remains authoritative for SSH host identity, host-key
  verification, and fixed command templates;
- never put `launchToken` or `relayToken` in query strings;
- never log launch tokens, relay tokens, SSH credentials, private keys, or raw
  SSH payload bytes;
- do not broaden `externally_connectable` beyond explicit production origins
  and the narrow `http://127.0.0.1/*` local browser test allowance;
- malicious launch/descriptor field rejection tests must not be weakened.
