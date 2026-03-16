# URI ssh:// links

You can create `ssh://` links that will automatically open Secure Shell.

`ssh://user[;option=value]@host[:port][@proxyhost[:proxyport]]`

Multiple option=value pairs are supported as long as they are delimited by
semi-colons.

[TOC]

## Supported Options

### Fingerprint

This is the remote server's key fingerprint.

Format: `fingerprint=<fingerprint value>`

*** note
This option is parsed out of the URI, but not currently used.
Star https://crbug.com/706536 for updates.
***

### Secure Shell arguments

Secure Shell specific arguments.

See [options](options.md) for more details.

Format: `-nassh-args=<parameters>`

The following options are always accepted without prompting the user:
`--config` `--proxy-mode` `--proxy-host` `--proxy-port` `--proxy-user`
`--ssh-agent` `--no-welcome`

*** note
All other options are parsed out but then currently ignored.
Star https://crbug.com/217785 for updates.
***

### SSH arguments

SSH command line arguments.
See [ssh(1)](https://man.openbsd.org/ssh.1) for details in general.

Format: `-nassh-ssh-args=<parameters>`

The following options are always accepted without prompting the user:
`-4` `-6` `-a` `-A` `-C` `-q` `-v` `-V`

*** note
All other options are parsed out but then currently ignored.
Star https://crbug.com/217785 for updates.
***

### SLAIF HPC target

SLAIF builds support an `hpc` URI option for selecting an approved HPC target
from the SLAIF allowlist.

Format: `hpc=<allowlist-alias>`

Example:

`ssh://user;hpc=arneshpc@ignored-host`

In this example, `ignored-host` is not used for connection targeting when
`hpc` is present.

#### Precedence rule

If both `hpc` and a URI hostname are present, `hpc` takes precedence for target
selection.

`ssh://user;hpc=arneshpc@anything.example`

connects to the host resolved from `hpc=arneshpc`, not `anything.example`.

#### SLAIF allowlist requirement

`hpc` must resolve through `nassh/config/SLAIF.conf` in the `[allowlist]`
section.

Valid values are:

* an alias key from `[allowlist]` (e.g. `arneshpc`)

#### Security behavior

Unknown `hpc` aliases are rejected.  Host values from `[allowlist]` are not
accepted as `hpc` input.
If `hpc` cannot be resolved in the
SLAIF allowlist, the connection is blocked.

### SLAIF connect.html launcher

SLAIF builds also support direct extension launches via:

`chrome-extension://<id>/connect.html?host=<hpc-alias>&session=<opaque-id>`

Behavior:

* `host` is required and mapped to the URI `hpc` option.
* `session` is currently accepted but unused.
* referrer host validation is enforced against `[services]` entries in
  `nassh/config/SLAIF.conf` when a referrer exists.
* all connection validation still resolves through `[allowlist]`.

## Future Work

See these bugs for future work in this area:
* [user](https://crbug.com/609303)

## References

We try to be compliant with these specifications:

* [IANA spec](https://www.iana.org/assignments/uri-schemes/prov/ssh)
* [Uniform Resource Identifier for Secure Shell](https://tools.ietf.org/html/draft-ietf-secsh-scp-sftp-ssh-uri-04)
