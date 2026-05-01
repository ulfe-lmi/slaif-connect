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
const launcherLibDir = path.join(repoRoot, 'remote/launcher/lib');
const launcherTemplatesDir = path.join(repoRoot, 'remote/launcher/templates');

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
  const intentSessionId = 'sess_maintainer_intent';
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
    SLAIF_LAUNCHER_INTENT_SESSION_ID: intentSessionId,
    SLAIF_LAUNCHER_INTENT_FILE: `${config.remoteBaseDir}/kit/launcher-intent/session-intent.json`,
    SLAIF_LAUNCHER_PROFILE_FILE: `${config.remoteBaseDir}/kit/launcher-intent/slurm-profiles.json`,
    SLAIF_LAUNCHER_INTENT_SUBMIT: config.tests?.runLauncherIntentSubmit ? '1' : '0',
    SLAIF_HPC_ALIAS: config.system === 'custom' ? 'customhpc' : `${config.system}hpc`,
  };
  if (phase === 'yolo') {
    env.SLAIF_ALLOW_YOLO = config.yolo?.allowYolo ? '1' : '0';
    env.SLAIF_I_UNDERSTAND_THIS_RUNS_ARBITRARY_CODE =
        config.yolo?.iUnderstandThisRunsArbitraryCode ? '1' : '0';
    env.SLAIF_YOLO_COMMAND = config.yolo?.command || '';
  }
  return Object.entries(env).map(([key, value]) => `${key}=${q(value)}`).join(' ');
}

function launcherIntentPayloadId(config) {
  const requested = config.tests?.launcherIntentPayloadId || 'cpu_memory_diagnostics_v1';
  if (!['cpu_memory_diagnostics_v1', 'gpu_diagnostics_v1', 'gams_chat_v1'].includes(requested)) {
    throw new Error('tests.launcherIntentPayloadId must be an allowed normal payloadId');
  }
  return requested;
}

export function buildMaintainerSessionIntent(config) {
  const payloadId = launcherIntentPayloadId(config);
  const now = new Date();
  const expires = new Date(now.getTime() + 15 * 60 * 1000);
  return {
    type: 'slaif.sessionIntent',
    version: 1,
    sessionId: 'sess_maintainer_intent',
    hpc: config.system === 'custom' ? 'customhpc' : `${config.system}hpc`,
    payloadId,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    launcher: {
      mode: 'normal',
    },
  };
}

function profileForPayload(config, payloadId) {
  const slurm = config.slurm || {};
  const gpuPayload = payloadId === 'gpu_diagnostics_v1' || payloadId === 'gams_chat_v1';
  const profileId = payloadId === 'gams_chat_v1' ? 'gams_chat_v1_scaffold' : `${payloadId}_maintainer`;
  return {
    profileId,
    payloadId,
    scheduler: 'slurm',
    jobName: payloadId === 'gams_chat_v1' ? 'slaif-gams-chat' :
      (gpuPayload ? 'slaif-gpu-diag' : 'slaif-cpu-diag'),
    timeLimit: slurm.timeLimit || (payloadId === 'gams_chat_v1' ? '00:10:00' : '00:05:00'),
    cpusPerTask: slurm.cpusPerTask ?? 1,
    memory: slurm.memory || (payloadId === 'gams_chat_v1' ? '2G' : '1G'),
    partition: gpuPayload ? (slurm.gpuPartition || '') : (slurm.cpuPartition || ''),
    account: slurm.account || '',
    qos: slurm.qos || '',
    ...(gpuPayload && slurm.gpuGres ? {gres: slurm.gpuGres} : {}),
    ...(gpuPayload && slurm.gpus ? {gpus: slurm.gpus} : {}),
    maxOutputBytes: 65536,
    template: payloadId === 'gams_chat_v1' ? 'gams_chat_v1_scaffold' : payloadId,
  };
}

export function buildMaintainerProfileCatalog(config) {
  const payloadId = launcherIntentPayloadId(config);
  return {
    type: 'slaif.slurmProfileCatalog',
    version: 1,
    profiles: {
      [payloadId]: profileForPayload(config, payloadId),
    },
  };
}

function writeLauncherIntentFiles(config, bundleDir) {
  const localDir = path.join(bundleDir, 'launcher-intent');
  fs.mkdirSync(localDir, {recursive: true, mode: 0o700});
  const intentPath = path.join(localDir, 'session-intent.json');
  const profilePath = path.join(localDir, 'slurm-profiles.json');
  fs.writeFileSync(intentPath, `${JSON.stringify(buildMaintainerSessionIntent(config), null, 2)}\n`);
  fs.writeFileSync(profilePath, `${JSON.stringify(buildMaintainerProfileCatalog(config), null, 2)}\n`);
  return {localDir, intentPath, profilePath};
}

function uploadKit(config) {
  const target = sshTarget(config);
  const remoteBase = config.remoteBaseDir;
  runChecked('ssh', [
    ...sshBaseArgs(config),
    target,
    `mkdir -p ${q(remoteBase)}/kit/remote ${q(remoteBase)}/kit/launcher-intent ${q(remoteBase)}/bin/lib ${q(remoteBase)}/bin/templates ${q(remoteBase)}/results`,
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
  runChecked('scp', [
    ...sshBaseArgs(config),
    ...fs.readdirSync(launcherLibDir).map((entry) => path.join(launcherLibDir, entry)),
    `${target}:${remoteBase}/bin/lib/`,
  ]);
  runChecked('scp', [
    ...sshBaseArgs(config),
    ...fs.readdirSync(launcherTemplatesDir).map((entry) => path.join(launcherTemplatesDir, entry)),
    `${target}:${remoteBase}/bin/templates/`,
  ]);
  runChecked('ssh', [
    ...sshBaseArgs(config),
    target,
    `chmod 700 ${q(remoteBase)}/kit/remote/*.sh ${q(remoteBase)}/bin/slaif-launch ${q(remoteBase)}/bin/lib/* ${q(remoteBase)}/bin/templates/*`,
  ]);
}

function uploadLauncherIntent(config, bundleDir) {
  const target = sshTarget(config);
  const files = writeLauncherIntentFiles(config, bundleDir);
  runChecked('scp', [
    ...sshBaseArgs(config),
    files.intentPath,
    files.profilePath,
    `${target}:${config.remoteBaseDir}/kit/launcher-intent/`,
  ]);
}

function runRemotePhase(config, phase, bundleDir) {
  const scriptByPhase = {
    discover: 'slaif-hpc-test-discover.sh',
    cpu: 'slaif-hpc-test-cpu.sh',
    gpu: 'slaif-hpc-test-gpu.sh',
    launcher: 'slaif-hpc-test-launcher-dry-run.sh',
    'launcher-intent': 'slaif-hpc-test-launcher-intent.sh',
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
    if (config.tests?.runLauncherIntentDryRun) {
      phases.push('launcher-intent');
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

export function runMaintainerHpcTestCli(argv = process.argv) {
  try {
    const args = parseArgs(argv);
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
    uploadLauncherIntent(config, bundleDir);
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
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMaintainerHpcTestCli(process.argv);
}
