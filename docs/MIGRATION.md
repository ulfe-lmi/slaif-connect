# Migration From the Old Fork

This file describes how to move from the current forked prototype into the no-fork relay-only project.

## Recommended sequence

Do not delete the old fork immediately.

1. Rename or archive the fork as:

   ```text
   slaif-connect-nassh-prototype
   ```

2. Create a new clean repository:

   ```text
   slaif-connect
   ```

3. Copy only the SLAIF-specific direction:

   - README purpose;
   - architecture and security model;
   - allowlist ideas;
   - hostname normalization / alias resolution snippets;
   - branding ideas if still useful.

4. Do not copy the whole upstream `libapps` tree into the new repository.

5. Add upstream as a submodule:

   ```bash
   git submodule add https://chromium.googlesource.com/apps/libapps third_party/libapps
   ```

6. Vendor selected upstream files during build:

   ```bash
   ./scripts/vendor-libapps.sh
   ```

7. Implement the extension around SLAIF-specific files under `extension/js`.

8. Implement the relay under `server/relay` or inside the existing SLAIF web server.

9. Keep the old fork until these tests pass:

   - local SSH login over relay;
   - fake SSH host-key rejection;
   - fixed remote command execution;
   - SLURM job-id capture;
   - job-id report back to SLAIF.

10. Archive or delete the fork after the new repository reaches functional parity for the SLAIF workflow.

## What to copy from the old fork

Copy/adapt:

- purpose: browser-side bridge between user, SLAIF, and approved HPC systems;
- security rule: SLAIF never receives SSH credentials;
- allowlist aliases such as `vegahpc`, `vegahpccpu`, `vegahpcgpu`, `arneshpc`;
- hostname normalization rule;
- alias-only connection model;
- job-id capture idea.

Do not copy as active product behavior:

- generic Secure Shell UI;
- arbitrary destination entry;
- Chrome raw socket dependency;
- SFTP/mount code unless explicitly required;
- direct patches to `nassh_command_instance.js`;
- broad `web_accessible_resources` launch model.

## First commit checklist

The first commit in the new repository should include:

```text
README.md
docs/ARCHITECTURE.md
docs/SECURITY.md
docs/UPSTREAM_LINKING.md
docs/MIGRATION.md
extension/manifest.json
extension/config/hpc_hosts.example.json
extension/js/background.js
extension/js/slaif_policy.js
extension/js/slaif_relay.js
server/relay/relay.js
scripts/init-upstream.sh
scripts/vendor-libapps.sh
```
