import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadMaintainerConfig} from './validate-maintainer-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kitRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(kitRoot, '../..');
const remoteScriptsDir = path.join(kitRoot, 'remote');
const launcherPath = path.join(repoRoot, 'remote/launcher/slaif-launch');

function parseArgs(argv) {
  const args = {phase: 'discover', allowYolo: false, yoloAck: false};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config') {
      args.config = argv[++i];
    } else if (arg === '--phase') {
      args.phase = argv[++i];
    } else if (arg === '--allow-yolo') {
      args.allowYolo = true;
    } else if (arg === '--i-understand-this-runs-arbitrary-code') {
      args.yoloAck = true;
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

function q(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function sshTarget(config) {
  return `${config.username}@${config.selectedLoginHost}`;
}

function sshBaseArgs(config) {
  const knownHosts = path.resolve(expandHome(config.verifiedKnownHostsFile));
  const hostKeyAlias = config.hostKeyAlias || config.selectedLoginHost;
  const args = [
    '-o', 'BatchMode=no',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', `UserKnownHostsFile=${knownHosts}`,
    '-o', `HostKeyAlias=${hostKeyAlias}`,
    '-o', 'CheckHostIP=no',
  ];
  if (config.sshKeyPath && config.sshKeyPath !== 'REPLACE_ME') {
    args.push('-i', path.resolve(expandHome(config.sshKeyPath)));
  }
  return args;
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    env: options.env || process.env,
  });
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stdout || ''}${result.stderr || ''}` : '';
    throw new Error(`${command} failed with status ${result.status}${detail}`);
  }
  return result;
}

function remoteEnv(config, phase) {
  const slurm = config.slurm || {};
  const env = {
    REMOTE_BASE_DIR: config.remoteBaseDir,
    SLAIF_TEST_PHASE: phase,
    SLAIF_SLURM_ACCOUNT: slurm.account || '',
    SLAIF_SLURM_CPU_PARTITION: slurm.cpuPartition || '',
    SLAIF_SLURM_GPU_PARTITION: slurm.gpuPartition || '',
    SLAIF_SLURM_QOS: slurm.qos || '',
    SLAIF_SLURM_TIME_LIMIT: slurm.timeLimit || '00:05:00',
    SLAIF_SLURM_MEMORY: slurm.memory || '1G',
    SLAIF_SLURM_CPUS_PER_TASK: String(slurm.cpusPerTask ?? 1),
    SLAIF_SLURM_GPUS: String(slurm.gpus ?? 1),
    SLAIF_SLURM_GPU_GRES: slurm.gpuGres || '',
    SLAIF_WAIT_FOR_COMPLETION: config.tests?.waitForCompletion ? '1' : '0',
  };
  if (phase === 'yolo') {
    env.SLAIF_ALLOW_YOLO = config.yolo?.allowYolo ? '1' : '0';
    env.SLAIF_I_UNDERSTAND_THIS_RUNS_ARBITRARY_CODE =
        config.yolo?.iUnderstandThisRunsArbitraryCode ? '1' : '0';
    env.SLAIF_YOLO_COMMAND = config.yolo?.command || '';
  }
  return Object.entries(env).map(([key, value]) => `${key}=${q(value)}`).join(' ');
}

function uploadKit(config) {
  const target = sshTarget(config);
  const remoteBase = config.remoteBaseDir;
  runChecked('ssh', [
    ...sshBaseArgs(config),
    target,
    `mkdir -p ${q(remoteBase)}/kit/remote ${q(remoteBase)}/bin ${q(remoteBase)}/results`,
  ]);
  runChecked('scp', [
    ...sshBaseArgs(config),
    ...fs.readdirSync(remoteScriptsDir).map((entry) => path.join(remoteScriptsDir, entry)),
    `${target}:${remoteBase}/kit/remote/`,
  ]);
  runChecked('scp', [
    ...sshBaseArgs(config),
    launcherPath,
    `${target}:${remoteBase}/bin/slaif-launch`,
  ]);
  runChecked('ssh', [
    ...sshBaseArgs(config),
    target,
    `chmod 700 ${q(remoteBase)}/kit/remote/*.sh ${q(remoteBase)}/bin/slaif-launch`,
  ]);
}

function runRemotePhase(config, phase, bundleDir) {
  const scriptByPhase = {
    discover: 'slaif-hpc-test-discover.sh',
    cpu: 'slaif-hpc-test-cpu.sh',
    gpu: 'slaif-hpc-test-gpu.sh',
    launcher: 'slaif-hpc-test-launcher-dry-run.sh',
    yolo: 'slaif-hpc-test-yolo.sh',
  };
  const script = scriptByPhase[phase];
  if (!script) {
    throw new Error(`unsupported phase ${phase}`);
  }
  const command = `${remoteEnv(config, phase)} bash ${q(`${config.remoteBaseDir}/kit/remote/${script}`)}`;
  const result = runChecked('ssh', [
    ...sshBaseArgs(config),
    sshTarget(config),
    command,
  ], {capture: true});
  if (bundleDir) {
    fs.writeFileSync(path.join(bundleDir, `${phase}.stdout.txt`), result.stdout || '');
    fs.writeFileSync(path.join(bundleDir, `${phase}.stderr.txt`), result.stderr || '');
  }
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  return result;
}

function phasesFor(args, config) {
  if (args.phase === 'all-safe') {
    const phases = ['discover'];
    if (config.tests?.runCpuDiagnostics !== false) {
      phases.push('cpu');
    }
    if (config.tests?.runGpuDiagnostics) {
      phases.push('gpu');
    }
    if (config.tests?.runLauncherDryRun !== false) {
      phases.push('launcher');
    }
    return phases;
  }
  if (args.phase === 'all-with-yolo') {
    return [...phasesFor({...args, phase: 'all-safe'}, config), 'yolo'];
  }
  return [args.phase];
}

function assertYoloAllowed(args, config) {
  if (!['yolo', 'all-with-yolo'].includes(args.phase)) {
    return;
  }
  if (!args.allowYolo || !args.yoloAck) {
    throw new Error('YOLO phases require --allow-yolo and --i-understand-this-runs-arbitrary-code');
  }
  if (!config.tests?.runYolo || !config.yolo?.allowYolo || !config.yolo?.iUnderstandThisRunsArbitraryCode) {
    throw new Error('YOLO phases require config tests.runYolo and yolo gates');
  }
}

try {
  const args = parseArgs(process.argv);
  if (!args.config) {
    throw new Error('--config is required');
  }
  const config = loadMaintainerConfig(args.config, {
    allowCustomHost: args.allowCustomHost,
    requireVerifiedKnownHosts: true,
    phase: args.phase,
  });
  assertYoloAllowed(args, config);
  const bundleDir = path.join(repoRoot, 'maintainer-results', `${config.system}-${timestamp()}`);
  fs.mkdirSync(bundleDir, {recursive: true, mode: 0o700});
  uploadKit(config);
  const completedPhases = [];
  for (const phase of phasesFor(args, config)) {
    runRemotePhase(config, phase, bundleDir);
    completedPhases.push(phase);
  }
  fs.writeFileSync(path.join(bundleDir, 'summary.json'), `${JSON.stringify({
    type: 'slaif.maintainerHpcRunSummary',
    version: 1,
    createdAt: new Date().toISOString(),
    system: config.system,
    selectedLoginHost: config.selectedLoginHost,
    remoteBaseDir: config.remoteBaseDir,
    completedPhases,
    note: 'Remote result files remain under remoteBaseDir/results; use collect-result-bundle.mjs to copy them locally.',
  }, null, 2)}\n`);
  console.log(`local maintainer run summary: ${bundleDir}`);
  console.log('maintainer HPC test phase complete');
} catch (error) {
  console.error(`maintainer HPC test failed: ${error.message}`);
  process.exit(1);
}
