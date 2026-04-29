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

This repository uses the official Chromium Gitiles upstream as a git submodule:

```bash
git submodule update --init --recursive
npm run upstream:init
```

`UPSTREAM_LIBAPPS_COMMIT` records the exact pinned submodule commit, and
`UPSTREAM_LIBAPPS_URL` records the upstream URL:

```text
https://chromium.googlesource.com/apps/libapps
```

Do not use the old SLAIF fork as the dependency.

## Vendor selected files

```bash
npm run vendor:libapps
npm run build:extension
```

The generated local dependency model is:

```text
third_party/libapps        upstream submodule, pinned, untouched
extension/vendor/libapps   generated copy used for local development/builds
extension/plugin           generated/copied OpenSSH/WASM plugin artifacts, if available
build/extension            packaged unpacked extension directory
```

Generated vendor and plugin files are ignored by git. Regenerate them during
development or build instead of committing them.

This PR vendors only initial runtime source directories:

```text
hterm
libdot
wassh
wasi-js-bindings
nassh/js
```

It does not copy the upstream `nassh` manifest, HTML UI, images, locales, or
Secure Shell product wrapper. It also does not wire OpenSSH/WASM yet.

## Do not edit upstream files

Files under `third_party/libapps` are upstream-owned. Agents must not edit files
inside that directory.

SLAIF-specific code belongs in:

```text
extension/js/
extension/config/
server/relay/
scripts/
tests/
docs/
```

If a future change appears to require patching libapps, stop and propose one of:

- a local adapter around upstream APIs;
- a minimal explicit patch-overlay strategy;
- an upstreamable change.

Never silently patch vendored upstream code.

## Updating upstream

```bash
git -C third_party/libapps fetch origin
git -C third_party/libapps checkout <new-known-good-commit>
npm run upstream:init
npm run vendor:libapps
npm run build:extension
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

Expected generated paths:

```text
third_party/libapps       upstream submodule, untouched
extension/vendor/libapps  generated/copy output from build script
extension/plugin          generated/copied OpenSSH/WASM plugin artifacts
build/extension           unpacked extension package
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
