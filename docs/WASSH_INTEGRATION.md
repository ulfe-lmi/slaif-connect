# WASSH Integration Notes

This repository uses the pinned Chromium libapps submodule as a build-time dependency. The current pinned commit is recorded in `UPSTREAM_LIBAPPS_COMMIT`.

## Upstream Interfaces Inspected

- `third_party/libapps/nassh/js/nassh_subproc_ssh.js`
  - Exports `SshSubproc`, the low-level OpenSSH/WASM wrapper used by this prototype.
  - Accepts `argv`, `terminal`, `relay`, `knownHosts`, `secureInput`, `syncStorage`, and `captureStdout`.
- `third_party/libapps/nassh/js/nassh_subproc_wasm.js`
  - Exports `WasmSubproc`.
  - Creates the WASSH syscall handler and calls `relay.openSocket(address, port)` when OpenSSH opens a TCP connection.
- `third_party/libapps/wassh/js/sockets.js`
  - Exports socket abstractions including `RelaySocket`, whose callback shape is `write`, `close`, `onDataAvailable`, and `onClose`.
- `third_party/libapps/nassh/js/nassh_command_instance.js`
  - Shows how upstream Secure Shell starts `SshSubproc` and injects known hosts into `/etc/ssh/ssh_known_hosts2`.
  - It remains reference only; SLAIF does not instantiate the broad Secure Shell UI.
- `third_party/libapps/nassh/bin/plugin`
  - Downloads the upstream OpenSSH/WASM plugin tarball through `libdot.download_tarball_manifest`.
  - `scripts/install-plugin.sh` uses that same helper but writes into `extension/plugin` so `third_party/libapps` stays untouched.
- `third_party/libapps/ssh_client/README.md`
  - Documents that `./nassh/bin/plugin` installs recent plugin binaries, while full source builds live under `ssh_client/output/plugin`.

## Local Adapter

`extension/js/slaif_ssh_client.js` owns the SLAIF-specific launch path. It dynamically imports `SshSubproc` from the generated vendored tree and passes a `SlaifRelay` instance as the upstream relay object.

OpenSSH arguments are built with:

```text
-o StrictHostKeyChecking=yes
-o CheckHostIP=no
-o HostKeyAlias=<policy hostKeyAlias>
-o ForwardAgent=no
-o ForwardX11=no
-o ClearAllForwardings=yes
-p <policy sshPort>
-l <username>
<policy sshHost>
<fixed command from extension policy>
```

The relay adapter only allows the exact `sshHost` and `sshPort` from signed extension policy. The WebSocket client sends only a relay token; it never sends an arbitrary relay destination.

## Known Hosts

`SshSubproc` accepts a `knownHosts` string. Upstream injects that into `/etc/ssh/ssh_known_hosts2` inside the WASM filesystem. SLAIF builds this string from signed extension policy and rejects SSH launch when only placeholder known-host comments are available.

For relay mode, SSH uses `HostKeyAlias=<alias>` and `CheckHostIP=no`. The expected host-key identity is the HPC alias, not the relay hostname.

## Plugin Artifacts

Generated plugin artifacts are expected under:

```text
extension/plugin/wasm/ssh.wasm
```

They are installed with:

```bash
npm run plugin:install
npm run plugin:verify
```

`extension/plugin` is ignored by git. `npm run build:extension` copies it into `build/extension/plugin` when present.

## Browser Validation

`docs/BROWSER_E2E_TESTING.md` documents the automated Chromium harness. It loads `build/extension`, starts the local sshd/relay stack, enters the disposable local test password in the extension page, and requires the real remote output `slaif-browser-relay-ok`.

The browser suite also runs a wrong-host-key case and verifies the command output is not observed. The web-launch browser test starts a mock SLAIF launcher/API, sends the external `slaif.startSession` message, fetches the descriptor from `/api/connect/session/<sessionId>`, and then starts the same OpenSSH/WASM relay path.

Session descriptors are intentionally narrow. They supply relay connection data only. `SshSubproc` still receives SSH host, port, known_hosts, HostKeyAlias, allowed relay origin, and the fixed remote command from signed extension-side policy.

The local browser dev stack now generates a signed local policy and trust root
for `test-sshd`. Tampered policy, wrong signer, expired policy, and relay-origin
mismatch are rejected before OpenSSH/WASM starts.

## Current Uncertainties

This PR creates the first browser-side prototype path, but full manual Chrome validation depends on loading `build/extension` in Chrome with installed plugin artifacts and the local dev stack running.

The pinned upstream source imports generated dependency/resource bundles and starts the WASSH worker through a relative `../wassh/js/worker.js` path. The vendoring script currently creates deterministic generated local bundles and compatibility copies for the low-level prototype paths needed by `SshSubproc`:

- `deps_resources.rollup.js`;
- `deps_indexeddb-fs.rollup.js`;
- `deps_pkijs.rollup.js`;
- `hterm/dist/js/hterm_resources.js`;
- `hterm/js/deps_punycode.rollup.js`;
- `libdot/dist/js/libdot_resources.js`;
- root-level generated `extension/wassh` and `extension/wasi-js-bindings` compatibility copies.

A later PR may replace these with a fuller deterministic upstream dependency bundling step.

The relay and server still do not terminate SSH, parse SSH credentials, or inspect decrypted terminal data.
