# SLAIF Maintainer HPC Test Kit

This directory contains maintainer-owned manual tooling for collecting real HPC evidence before SLAIF Connect policy/profile changes are made. It is not CI, not product runtime, and not a substitute for browser-side SSH validation.

The scripts use your local system `ssh` and `scp` clients. They require verified known-host data and never write passwords, OTPs, private keys, or token values into config files.

## Vega

Copy an example config:

```bash
mkdir -p ~/.slaif-connect
cp maintainer/hpc-test-kit/configs/vega.example.json ~/.slaif-connect/vega.local.json
```

Edit it:

```bash
${EDITOR:-vi} ~/.slaif-connect/vega.local.json
```

Collect candidate host keys:

```bash
node maintainer/hpc-test-kit/local/collect-host-key-candidates.mjs \
  --host login.vega.izum.si \
  --alias vega \
  --out ~/.slaif-connect/vega.candidate-known-hosts
```

Verify the fingerprint out of band. Candidate keys from `ssh-keyscan` are not trusted until verified through official docs, a site administrator, host CA material, or another approved independent source. Save the verified lines to:

```text
~/.slaif-connect/vega.verified-known-hosts
```

Run discovery:

```bash
node maintainer/hpc-test-kit/local/run-maintainer-hpc-test.mjs \
  --config ~/.slaif-connect/vega.local.json \
  --phase discover
```

Run CPU diagnostics:

```bash
node maintainer/hpc-test-kit/local/run-maintainer-hpc-test.mjs \
  --config ~/.slaif-connect/vega.local.json \
  --phase cpu
```

Run GPU diagnostics:

```bash
node maintainer/hpc-test-kit/local/run-maintainer-hpc-test.mjs \
  --config ~/.slaif-connect/vega.local.json \
  --phase gpu
```

Run launcher dry-run:

```bash
node maintainer/hpc-test-kit/local/run-maintainer-hpc-test.mjs \
  --config ~/.slaif-connect/vega.local.json \
  --phase launcher
```

Run YOLO only if explicitly intended:

```bash
node maintainer/hpc-test-kit/local/run-maintainer-hpc-test.mjs \
  --config ~/.slaif-connect/vega.local.json \
  --phase yolo \
  --allow-yolo \
  --i-understand-this-runs-arbitrary-code
```

Collect result bundle:

```bash
node maintainer/hpc-test-kit/local/collect-result-bundle.mjs \
  --config ~/.slaif-connect/vega.local.json
```

## Arnes HPC

Use the Arnes example and one of the documented login candidates:

```bash
cp maintainer/hpc-test-kit/configs/arnes.example.json ~/.slaif-connect/arnes.local.json
${EDITOR:-vi} ~/.slaif-connect/arnes.local.json
node maintainer/hpc-test-kit/local/collect-host-key-candidates.mjs \
  --host hpc-login3.arnes.si \
  --alias arnes \
  --out ~/.slaif-connect/arnes.candidate-known-hosts
```

After out-of-band fingerprint verification, run the same `discover`, `cpu`, `gpu`, `launcher`, and optional `yolo` phases with `--config ~/.slaif-connect/arnes.local.json`.

## NSC

Use the NSC example:

```bash
cp maintainer/hpc-test-kit/configs/nsc.example.json ~/.slaif-connect/nsc.local.json
${EDITOR:-vi} ~/.slaif-connect/nsc.local.json
node maintainer/hpc-test-kit/local/collect-host-key-candidates.mjs \
  --host nsc-login.ijs.si \
  --alias nsc \
  --out ~/.slaif-connect/nsc.candidate-known-hosts
```

Discover partitions dynamically with `sinfo`; do not assume old workshop partition examples apply to every account or time period.

## Safety Boundaries

- All remote files are uploaded under `remoteBaseDir`, normally `~/.slaif-connect/hpc-tests`.
- Real SSH phases require `StrictHostKeyChecking=yes` and `UserKnownHostsFile=<verifiedKnownHostsFile>`.
- The kit never auto-trusts `ssh-keyscan` output.
- The kit does not install system packages or write system-wide files.
- YOLO is maintainer-only/manual and requires both config gates and CLI gates.
- YOLO is not a normal payload, not in the signed payload catalog, and not exposed through extension launch/session descriptor flows.
