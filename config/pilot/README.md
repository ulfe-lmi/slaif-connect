# Real-HPC Pilot Config Templates

This directory contains templates for manually onboarding a real HPC pilot target.

Do not commit local pilot files, private signing keys, candidate host-key scans, verified host-key files, or signed pilot policies. The ignored `*.local.json`, `*.signed.json`, `*.private-key.*`, `*.candidate-known-hosts`, `*.verified-known-hosts`, and `*.fingerprints` patterns are for operator-local material only.

The example input file contains placeholders. Replace them only with host-key or host-CA data verified through an independent trusted channel. `ssh-keyscan` output is candidate data, not proof of authenticity.

Pilot inputs must never include SSH passwords, OTPs, private keys, passphrases, or arbitrary command strings from the SLAIF web app.

Production-style pilot inputs should normally use a fixed launcher command:

```text
/opt/slaif/bin/slaif-launch --session ${SESSION_ID}
```

The launcher must be installed and controlled by the HPC site. See [docs/REMOTE_LAUNCHER_CONTRACT.md](../../docs/REMOTE_LAUNCHER_CONTRACT.md) for the remote-side contract.
