import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {spawnSync} from 'node:child_process';
import {loadMaintainerConfig} from './validate-maintainer-config.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config') {
      args.config = argv[++i];
    } else if (arg === '--out-dir') {
      args.outDir = argv[++i];
    } else if (arg === '--allow-custom-host') {
      args.allowCustomHost = true;
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  return args;
}

function expandHome(value) {
  return value.replace(/^~(?=$|\/)/, os.homedir());
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function sshBaseArgs(config) {
  const knownHosts = path.resolve(expandHome(config.verifiedKnownHostsFile));
  return [
    '-o', 'BatchMode=no',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', `UserKnownHostsFile=${knownHosts}`,
    '-o', `HostKeyAlias=${config.hostKeyAlias || config.selectedLoginHost}`,
    '-o', 'CheckHostIP=no',
  ];
}

export function buildResultBundleNextSteps(config) {
  return `# SLAIF Maintainer HPC Result Bundle Next Steps

Copy the non-secret findings into the next issue, PR, or private maintainer report:

- system: ${config.system}
- login hostname used: ${config.selectedLoginHost}
- verified host-key fingerprint and out-of-band verification source
- Slurm discovery summary
- CPU diagnostic job ID and result JSON
- GPU diagnostic job ID and result JSON, if run
- cpu_payload_result.json / gpu_payload_result.json when completion waiting was enabled
- launcher dry-run result
- launcher payload-intent dry-run or explicit submit result
- YOLO result only if intentionally run
- errors encountered
- whether 2FA/browser-side SSH worked
- suggested payload profile values for signed policy

Do not include SSH passwords, OTPs, private keys, token values, or local secret config files.
`;
}

export function safeBundleSummary(config) {
  return {
    type: 'slaif.maintainerHpcResultBundle',
    version: 1,
    createdAt: new Date().toISOString(),
    system: config.system,
    selectedLoginHost: config.selectedLoginHost,
    remoteBaseDir: config.remoteBaseDir,
    includesSecrets: false,
    notes: [
      'Host keys in reports must be treated as candidate data unless a verification source is recorded.',
      'Private keys, passwords, OTPs, and token values must not be included.',
    ],
  };
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${result.status}`);
  }
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv);
    if (!args.config) {
      throw new Error('--config is required');
    }
    const config = loadMaintainerConfig(args.config, {
      allowCustomHost: args.allowCustomHost,
      requireVerifiedKnownHosts: true,
    });
    const localRoot = path.resolve(args.outDir || 'maintainer-results');
    const bundleDir = path.join(localRoot, `${config.system}-${timestamp()}`);
    fs.mkdirSync(bundleDir, {recursive: true, mode: 0o700});

    runChecked('scp', [
      '-r',
      ...sshBaseArgs(config),
      `${config.username}@${config.selectedLoginHost}:${config.remoteBaseDir}/results`,
      path.join(bundleDir, 'results'),
    ]);

    fs.writeFileSync(path.join(bundleDir, 'summary.json'),
        `${JSON.stringify(safeBundleSummary(config), null, 2)}\n`);
    fs.writeFileSync(path.join(bundleDir, 'README_NEXT_STEPS.md'),
        buildResultBundleNextSteps(config));
    console.log(`Wrote maintainer result bundle to ${bundleDir}`);
  } catch (error) {
    console.error(`collect result bundle failed: ${error.message}`);
    process.exit(1);
  }
}
