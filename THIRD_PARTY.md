# Third-Party Dependencies

This repository is designed to use Chromium `libapps` as a pinned build-time dependency.

Expected dependency:

```text
third_party/libapps → https://chromium.googlesource.com/apps/libapps
```

The exact pinned upstream commit is recorded in `UPSTREAM_LIBAPPS_COMMIT`, and
the upstream URL is recorded in `UPSTREAM_LIBAPPS_URL`.

When vendoring upstream runtime files into the extension package, preserve the upstream license files and attribution.

The scripts in `scripts/` create:

```text
extension/vendor/libapps/
extension/plugin/          # only if upstream plugin artifacts are present
```

from:

```text
third_party/libapps/
```

SLAIF-specific code should remain outside upstream directories.
