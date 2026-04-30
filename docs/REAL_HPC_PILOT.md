# Real-HPC Pilot Onboarding

This document describes the manual pilot path for testing SLAIF Connect against a real HPC SSH server while preserving the project security model:

```text
browser-side SSH client
  -> WSS relay
  -> real HPC sshd
```

The relay remains a byte forwarder. It does not terminate SSH, and the SLAIF server must not receive SSH passwords, OTPs, private keys, passphrases, decrypted SSH traffic, or arbitrary user shell access.

## Required Operator Inputs

A pilot operator must provide:

- pilot alias, for example `vegahpc-pilot`;
- display name;
- SSH hostname;
- SSH port, usually `22`;
- `HostKeyAlias`;
- verified `known_hosts` entry or verified host-CA entry;
- allowed API origin;
- allowed relay origin;
- fixed remote command template;
- optional username hint.

User passwords, OTPs, passphrases, and private keys are not pilot inputs. User authentication happens inside the browser-side SSH session.

## Host-Key Verification Requirement

`ssh-keyscan` can collect candidate host keys, but it does not prove authenticity. A network attacker can answer `ssh-keyscan` with attacker-controlled keys.

Candidate keys must be verified through an independent trusted channel before they are placed into a signed policy. Acceptable verification channels include:

- an HPC administrator-provided host-key fingerprint;
- official HPC documentation;
- an SSH host CA provided by the HPC center;
- DNS SSHFP with DNSSEC, if the environment supports and trusts it;
- direct confirmation from the HPC operations team.

Do not sign a policy using an unverified host key.

## Host CA Preference

Host CA trust is preferred where the HPC center supports OpenSSH host certificates. The supported policy format uses OpenSSH `known_hosts` lines. In the current alias-based launch path, host-CA entries must match the configured `HostKeyAlias`, for example:

```text
@cert-authority vegahpc-pilot ssh-ed25519 AAAA...
```

If an HPC site wants to use a wildcard pattern such as `@cert-authority *.example.edu ...`, confirm that the selected `HostKeyAlias` and OpenSSH/WASM known-hosts behavior match that pattern before signing the policy. Otherwise use an alias-specific cert-authority entry.

## Pilot Command Safety

The first pilot command should be harmless and fixed, for example:

```text
/bin/printf slaif-pilot-ok
```

Production-style command templates should include `${SESSION_ID}`, for example:

```text
/opt/slaif/bin/slaif-launch --session ${SESSION_ID}
```

Pilot tooling supports a fixed no-session command only when `--pilot-fixed-command` is explicitly provided. Do not use destructive commands, do not accept command strings from the web app, and do not allow the session descriptor to define the command.

## Manual Pilot Flow

1. Collect candidate SSH host keys:

   ```bash
   npm run pilot:collect-host-keys -- \
     --host login.example.edu \
     --port 22 \
     --alias examplehpc \
     --out config/pilot/examplehpc.candidate-known-hosts
   ```

2. Verify the candidate fingerprint out of band:

   ```bash
   npm run pilot:verify-host-key -- \
     --known-hosts config/pilot/examplehpc.candidate-known-hosts \
     --expected-sha256 SHA256:abc123...
   ```

3. Prepare a local pilot input JSON from [config/pilot/hpc-pilot.input.example.json](../config/pilot/hpc-pilot.input.example.json). Use independently verified host-key or host-CA data only. For the local stack defaults, use:

   ```json
   "allowedApiOrigins": ["http://127.0.0.1:18180"],
   "allowedRelayOrigins": ["ws://127.0.0.1:18181"]
   ```

4. Create an unsigned policy payload:

   ```bash
   npm run pilot:create-policy -- \
     --input config/pilot/examplehpc.local.json \
     --out config/pilot/examplehpc.policy.local.json \
     --policy-id slaif-hpc-policy-pilot \
     --sequence 1 \
     --valid-from 2026-04-30T00:00:00.000Z \
     --valid-until 2026-05-31T23:59:59.000Z \
     --pilot-fixed-command
   ```

5. Generate a local pilot signing key if you do not already have one:

   ```bash
   npm run policy:keygen:dev -- \
     --key-id slaif-policy-pilot \
     --private-key-out config/pilot/pilot.private-key.local.json \
     --trust-roots-out config/pilot/policy-trust-roots.local.json
   ```

   The private key is local pilot material and must not be committed.

6. Sign and verify the policy with the existing policy tools:

   ```bash
   npm run policy:sign -- \
     --payload config/pilot/examplehpc.policy.local.json \
     --private-key config/pilot/pilot.private-key.local.json \
     --key-id slaif-policy-pilot \
     --out config/pilot/examplehpc.signed.local.json

   npm run policy:verify -- \
     --policy config/pilot/examplehpc.signed.local.json \
     --trust-roots config/pilot/policy-trust-roots.local.json \
     --allow-local-dev
   ```

7. Build the extension:

   ```bash
   npm run build:extension
   ```

8. Start the manual pilot stack:

   ```bash
   npm run pilot:stack -- \
     --allow-real-hpc \
     --signed-policy config/pilot/examplehpc.signed.local.json \
     --trust-roots config/pilot/policy-trust-roots.local.json \
     --alias examplehpc \
     --username-hint your_hpc_username
   ```

9. Load `build/extension` as an unpacked Chrome/Chromium extension.
10. Open the printed launcher URL with `?extensionId=<extension-id>`.
11. Authenticate directly to the real HPC `sshd` inside the extension window.
12. Confirm the fixed command output appears.
13. If the command emits SLURM submission output, confirm the mock SLAIF API
    receives a safe job metadata report.

The pilot stack does not accept a host or port through CLI arguments. It resolves the SSH target from the verified signed policy.

For a real SLURM pilot, use a harmless site-approved launcher command first.
After that, a policy command may call a site-approved launcher that eventually
runs `sbatch` and prints the canonical SLURM line:

```text
Submitted batch job 12345
```

SLAIF Connect parses that line and reports scheduler metadata only. It does not
upload raw terminal output. Verify the reported job ID manually with HPC tooling
during the pilot.

## What This PR Does Not Solve

- no production SLAIF signing-key custody;
- no production deployment;
- no Chrome Web Store release;
- no real HPC credentials stored or automated;
- no automatic host-key trust;
- no production job launcher deployment;
- no real-HPC SLURM job reporting validation without operator-provided verified
  host trust and manual user authentication;
- no institutional approval workflow.
