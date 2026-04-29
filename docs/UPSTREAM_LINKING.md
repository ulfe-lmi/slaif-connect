# Linking / Depending on Upstream libapps Without Forking

This project should not be a fork of `libapps` / `nassh`.

Instead, use upstream as a pinned build-time dependency.

## What “linking” means for a Chrome extension

A Chrome extension package must contain the executable JavaScript and WASM it runs. Therefore, do not runtime-load code from:

- GitHub;
- Chromium Gitiles;
- npm CDN;
- SLAIF web server;
- any other external URL.

For this project, “linking against upstream” means:

```text
1. pin upstream source as third_party/libapps
2. copy/build selected files into extension/vendor/libapps
3. package those files inside the extension
```

## Initialize upstream dependency

```bash
git submodule add https://chromium.googlesource.com/apps/libapps third_party/libapps
git submodule update --init --recursive
git -C third_party/libapps rev-parse HEAD > UPSTREAM_LIBAPPS_COMMIT
```

## Vendor selected files

```bash
./scripts/vendor-libapps.sh
```

Initial vendoring can be broad:

```text
hterm/
libdot/
wassh/
wasi-js-bindings/
selected nassh/js modules
plugin WASM artifacts
```

Later shrink it to only what the extension actually imports.

## Do not edit upstream files

SLAIF-specific code belongs in:

```text
extension/js/
extension/config/
server/relay/
```

If you absolutely must patch upstream, keep the patch as a small, explicit patch file under:

```text
patches/
```

But the preferred path is no patch.

## Updating upstream

```bash
git -C third_party/libapps fetch origin
git -C third_party/libapps checkout <new-known-good-commit>
git -C third_party/libapps rev-parse HEAD > UPSTREAM_LIBAPPS_COMMIT
./scripts/vendor-libapps.sh
npm test
```

Do not track upstream HEAD automatically in production builds.

## Target integration points

The final integration should wire your code to upstream pieces roughly like this:

```text
hterm                         terminal UI
ssh_client WASM               OpenSSH client runtime
wassh                         JS/WASI socket bridge
SLAIF Relay adapter           WebSocket-to-relay socket object
SLAIF Policy                  alias, host key, command template, relay URL
```

The relay adapter should be passed into the upstream SSH/WASM runtime rather than patching `nassh_command_instance.js`.

## MVP integration strategy

1. Vendor enough of upstream to start the WASM OpenSSH client.
2. Prove login to a local test `sshd` through the SLAIF relay.
3. Add strict host-key pinning.
4. Add fixed remote command execution.
5. Capture stdout and parse SLURM job id.
6. Shrink the vendored upstream set.

## Production build rule

Every packaged build should record:

```text
extension version
upstream libapps commit
policy version
relay API version
```

This makes later security review and incident response possible.
