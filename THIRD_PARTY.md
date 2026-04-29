# Third-Party Dependencies

This repository is designed to use Chromium `libapps` as a pinned build-time dependency.

Expected dependency:

```text
third_party/libapps → https://chromium.googlesource.com/apps/libapps
```

When vendoring upstream runtime files into the extension package, preserve the upstream license files and attribution.

The scripts in `scripts/` create:

```text
extension/vendor/libapps/
```

from:

```text
third_party/libapps/
```

SLAIF-specific code should remain outside upstream directories.
