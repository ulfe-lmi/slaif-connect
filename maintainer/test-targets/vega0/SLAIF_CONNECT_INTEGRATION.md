# SLAIF Connect Integration

Build and validate the cluster first. This phase onboards it as a SLAIF
Connect target without changing the core security model.

## 1. Choose The Reachable Login Endpoint

For a same-LAN lab run, the relay may reach the login Wi-Fi address. Do not use
the worker address.

Reference values:

~~~text
alias: vega0-lab
display name: Vega0 Raspberry Pi lab
SSH endpoint: 192.168.1.200:22
SSH identity hostname: vega0-login.vega0.test
SSH user: user
Slurm account: demo-users
CPU partition: cpu
development partition: dev
~~~

If the USB Ethernet adapter is later used for ingress, create a separate
network/exposure design. Do not silently move the signed policy to a new address
or weaken host-key checking.

## 2. Verify The Host Key Out Of Band

Collect candidate keys with the repository tool:

~~~bash
node scripts/pilot/collect-host-keys.mjs \
  --host 192.168.1.200 \
  --alias vega0-lab \
  --out ~/.slaif-connect/vega0-lab.candidate-known-hosts
~~~

Candidate output is not trusted. Compare its fingerprint with:

- ssh-keygen output read locally on the login node;
- a console-captured fingerprint;
- or an operator-maintained host CA/fingerprint record.

Save only independently verified lines to:

~~~text
~/.slaif-connect/vega0-lab.verified-known-hosts
~~~

Use a stable HostKeyAlias in signed policy so changing relay addressing cannot
change SSH identity.

## 3. Use The Maintainer HPC Test Kit

Copy acceptance/hpc-test-kit.vega0-lab.example.json outside the repository and
replace local paths:

~~~bash
mkdir -p ~/.slaif-connect
cp maintainer/test-targets/vega0/acceptance/hpc-test-kit.vega0-lab.example.json \
  ~/.slaif-connect/vega0-lab.local.json
~~~

Run discovery and CPU phases:

~~~bash
node maintainer/hpc-test-kit/local/run-maintainer-hpc-test.mjs \
  --config ~/.slaif-connect/vega0-lab.local.json \
  --phase discover

node maintainer/hpc-test-kit/local/run-maintainer-hpc-test.mjs \
  --config ~/.slaif-connect/vega0-lab.local.json \
  --phase cpu
~~~

The test kit uses local system SSH. For the key-plus-TOTP account, the operator
must complete the OTP prompt interactively. Passwords and OTPs do not belong in
the JSON config.

## 4. Remote Launcher

Start with the homedir-scoped launcher dry-run:

~~~bash
node maintainer/hpc-test-kit/local/run-maintainer-hpc-test.mjs \
  --config ~/.slaif-connect/vega0-lab.local.json \
  --phase launcher
~~~

Then run payload-intent dry-run. Real sbatch submission remains disabled until
the config explicitly enables it:

~~~bash
node maintainer/hpc-test-kit/local/run-maintainer-hpc-test.mjs \
  --config ~/.slaif-connect/vega0-lab.local.json \
  --phase launcher-intent
~~~

Installing /opt/slaif/bin/slaif-launch is a separate site-administration step.
Follow docs/REMOTE_LAUNCHER_CONTRACT.md and preserve:

- fixed command authority;
- payload-ID selection;
- site-owned Slurm profiles;
- no arbitrary web/session command text;
- no worker-node SSH.

## 5. Signed Pilot Policy

Create pilot input outside Git with:

- alias vega0-lab;
- the login endpoint only;
- the independently verified host key or host CA;
- the approved API and relay origins;
- allowed payload IDs;
- fixed remote launcher command template.

Generate/sign policy with the repository tooling. Keep signing private keys,
local policy files, SSH private keys, passwords, OTP seeds, and tokens out of
Git.

## 6. Relay Boundary

The relay allowlist maps vega0-lab to the login endpoint. It must not contain
the worker endpoint.

The relay:

- forwards encrypted SSH bytes;
- does not terminate SSH;
- does not see password, OTP, private key, passphrase, or decrypted terminal
  output;
- cannot override signed SSH identity or fixed command policy.

## 7. Browser Validation

Required browser-side evidence:

1. strict host-key success with the verified key;
2. strict host-key failure after presenting a different key;
3. key-plus-TOTP interaction entirely inside browser-side SSH;
4. fixed launcher command execution on the login node;
5. Slurm job ID/result parsing;
6. compute hostname proving payload execution on vega0-worker;
7. no direct worker SSH attempt from the extension or relay.

The lab target validates integration behavior. It does not replace a real Vega
pilot with site-provided account, partition, host-key, and policy data.
