# Useful Prototype Snippets Carried Forward

This file records the small SLAIF-specific ideas worth preserving from the old fork.

Do not copy the whole `nassh` fork. Copy these concepts.

## 1. Project purpose

Old direction preserved:

```text
SLAIF Connect is a browser-side SSH bridge for approved HPC systems.
It authenticates the user with normal HPC credentials, executes a SLAIF workload command, and returns job metadata such as SLURM job ids.
It is not a general-purpose SSH client.
```

New direction:

```text
Same purpose, but implemented as a clean extension using a mandatory WSS→TCP relay and upstream libapps as a build-time dependency.
```

## 2. Legacy allowlist content

The current prototype's `nassh/config/SLAIF.conf` contains the useful alias set.

Converted into readable form:

```ini
[allowlist]
vpnhome=192.168.1.9
dhcplmi=192.168.90.3
stare=stare.lmi.link
arneshpc=hpc-login.arnes.si
vegahpc=login.vega.izum.si
vegahpccpu=logincpu.vega.izum.si
vegahpcgpu=gpulogingpu.vega.izum.si

[services]
stare=stare.lmi.link

[branding]
product_name=SLAIF-connect
faq_url=https://hterm.org/x/ssh/faq
changelog_url=/html/changelog.html
popup_title=SLAIF-connect Extension Popup
show_release_highlights=false
show_tip_of_day=false

[assets]
logo_ansi_path=/config/slaif_logo_ansi.txt
```

For the new architecture, this becomes `extension/config/hpc_hosts.example.json`.

## 3. HPC alias takes precedence

Old idea:

```js
export function applyConnectTargetPrecedence(params) {
  if (params.hpc) {
    params.hostname = params.hpc;
  }
  return params;
}
```

New version:

```js
const alias = requireKnownHpcAlias(message.hpc);
const policyHost = policy.hosts[alias];
```

The extension should not accept a browser-supplied hostname at all. It should accept only an alias.

## 4. Hostname normalization

Old idea:

```js
function normalizeHostLike(value) {
  return punycode.toASCII(value).toLowerCase().replace(/\.$/, '');
}
```

New version lives in `extension/js/slaif_policy.js`.

The important concept is preserved:

```text
canonicalize before comparison
compare aliases and hosts in normalized form
trim trailing dots
use ASCII/punycode form where possible
```

## 5. Alias-only allowlist validation

Old behavior:

```text
input hpc alias → normalize → compare against [allowlist] keys → resolve to host
```

New behavior:

```text
message.hpc → validate alias syntax → lookup extension policy → get fixed sshHost/sshPort/hostKeyAlias
```

The new extension should not allow direct host/IP entry from the web page.

## 6. Job-id capture

Old workflow preserved:

```text
execute SLAIF launcher command on HPC
capture output
parse output such as: Submitted batch job 123456
POST job id back to SLAIF
```

New helper:

```text
extension/js/job_output_parser.js
```

## 7. Branding

Branding can be copied later, but it should stay separate from upstream code:

```text
extension/assets/
extension/_locales/
extension/manifest.json
```

Do not patch upstream Secure Shell welcome logic just for branding.
